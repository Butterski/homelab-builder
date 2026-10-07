package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/inventory"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/proxmox"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// MaxInventoryItems bounds what one account can keep.
const MaxInventoryItems = 500

var (
	ErrInventoryItemNotFound = errors.New("inventory item not found")
	ErrInventoryLimit        = fmt.Errorf("an inventory holds at most %d items", MaxInventoryItems)
)

// InventoryService keeps the hardware a user owns. An item belongs to the
// account; which builds plan it is read from the builds, never stored twice.
type InventoryService struct {
	db *gorm.DB
}

func NewInventoryService(db *gorm.DB) *InventoryService {
	return &InventoryService{db: db}
}

// InventoryInput is an item as the client sends it.
type InventoryInput struct {
	Kind         string          `json:"kind"`
	Type         string          `json:"type"`
	Name         string          `json:"name"`
	Manufacturer string          `json:"manufacturer"`
	Model        string          `json:"model"`
	Quantity     int             `json:"quantity"`
	Status       string          `json:"status"`
	Location     string          `json:"location"`
	Specs        inventory.Specs `json:"specs"`
	MacAddresses []string        `json:"mac_addresses"`
	PowerDraw    float64         `json:"power_draw"`
	Notes        string          `json:"notes"`
}

func (in InventoryInput) item() inventory.Item {
	return inventory.Item{
		Kind: in.Kind, Type: in.Type, Name: in.Name, Manufacturer: in.Manufacturer, Model: in.Model,
		Quantity: in.Quantity, Status: in.Status, Location: in.Location, Specs: in.Specs,
		MacAddresses: in.MacAddresses, PowerDraw: in.PowerDraw, Notes: in.Notes,
	}
}

// InventoryPlacement is one place an item is planned: a node of a build, or a
// component inside one.
type InventoryPlacement struct {
	BuildID   uuid.UUID `json:"build_id"`
	BuildName string    `json:"build_name"`
	NodeID    uuid.UUID `json:"node_id"`
	// NodeName is the role the item plays there ("proxmox-01"), or the host a
	// component sits in.
	NodeName string `json:"node_name"`
	// Component is true when the item is inside that node rather than the node itself.
	Component bool `json:"component"`
	Quantity  int  `json:"quantity"`
}

// InventoryDeployment says what an integration reports about the machine an
// item is linked to. Online is nil when the last snapshot does not list it.
type InventoryDeployment struct {
	IntegrationID   uuid.UUID  `json:"integration_id"`
	IntegrationName string     `json:"integration_name"`
	Kind            string     `json:"kind"`
	Ref             string     `json:"ref"`
	Online          *bool      `json:"online"`
	Version         string     `json:"version,omitempty"`
	Guests          int        `json:"guests"`
	SyncedAt        *time.Time `json:"synced_at"`
}

// InventoryItemView is an item with where it is planned and what runs on it.
type InventoryItemView struct {
	models.InventoryItem
	// State is how the item stands: its status, or "in_use" when a build plans
	// it or a host runs on it (inventory.State). Status stays what the owner set.
	State      string               `json:"state"`
	Placements []InventoryPlacement `json:"placements"`
	Deployment *InventoryDeployment `json:"deployment,omitempty"`
}

// plannedUnits is the most units of an item any one build plans.
func plannedUnits(placements []InventoryPlacement) int {
	perBuild := map[uuid.UUID]int{}
	most := 0
	for _, placement := range placements {
		perBuild[placement.BuildID] += placement.Quantity
		if perBuild[placement.BuildID] > most {
			most = perBuild[placement.BuildID]
		}
	}
	return most
}

func applyInventoryItem(row *models.InventoryItem, item inventory.Item) error {
	specs, err := json.Marshal(item.Specs)
	if err != nil {
		return err
	}
	macs, err := json.Marshal(item.MacAddresses)
	if err != nil {
		return err
	}
	row.Kind, row.Type, row.Name = item.Kind, item.Type, item.Name
	row.Manufacturer, row.Model = item.Manufacturer, item.Model
	row.Quantity, row.Status, row.Location = item.Quantity, item.Status, item.Location
	row.Specs, row.MacAddresses = specs, macs
	row.PowerDraw, row.Notes = item.PowerDraw, item.Notes
	return nil
}

// InventoryItemOf reads a stored row back into the form the rules work on.
func InventoryItemOf(row models.InventoryItem) inventory.Item {
	item := inventory.Item{
		Kind: row.Kind, Type: row.Type, Name: row.Name, Manufacturer: row.Manufacturer, Model: row.Model,
		Quantity: row.Quantity, Status: row.Status, Location: row.Location,
		PowerDraw: row.PowerDraw, Notes: row.Notes, MacAddresses: []string{},
	}
	if len(row.Specs) > 0 {
		_ = json.Unmarshal(row.Specs, &item.Specs)
	}
	if len(row.MacAddresses) > 0 {
		_ = json.Unmarshal(row.MacAddresses, &item.MacAddresses)
	}
	return item
}

// List returns the user's items, oldest first, each with its placements and
// what its integration last reported.
func (s *InventoryService) List(userID uuid.UUID) ([]InventoryItemView, error) {
	var rows []models.InventoryItem
	if err := s.db.Where("user_id = ?", userID).Order("created_at, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	placements, err := s.placements(userID)
	if err != nil {
		return nil, err
	}
	deployments, err := s.deployments(userID, rows)
	if err != nil {
		return nil, err
	}
	views := make([]InventoryItemView, 0, len(rows))
	for _, row := range rows {
		view := InventoryItemView{InventoryItem: row, Placements: placements[row.ID.String()]}
		if view.Placements == nil {
			view.Placements = []InventoryPlacement{}
		}
		if deployment, ok := deployments[row.ID]; ok {
			view.Deployment = deployment
		}
		view.State = inventory.State(row.Status, row.Quantity, plannedUnits(view.Placements), view.Deployment != nil)
		views = append(views, view)
	}
	return views, nil
}

type placementRow struct {
	ItemID    string
	Quantity  string
	NodeID    uuid.UUID
	NodeName  string
	BuildID   uuid.UUID
	BuildName string
}

// placements reads, from the user's builds, every node and component that
// stands for an inventory item.
func (s *InventoryService) placements(userID uuid.UUID) (map[string][]InventoryPlacement, error) {
	result := map[string][]InventoryPlacement{}
	collect := func(rows []placementRow, component bool) {
		for _, row := range rows {
			quantity, err := strconv.Atoi(row.Quantity)
			if err != nil || quantity < 1 {
				quantity = 1
			}
			result[row.ItemID] = append(result[row.ItemID], InventoryPlacement{
				BuildID: row.BuildID, BuildName: row.BuildName, NodeID: row.NodeID, NodeName: row.NodeName,
				Component: component, Quantity: quantity,
			})
		}
	}

	var nodes []placementRow
	err := s.db.Raw(`
		SELECT n.details->>'inventory_item_id' AS item_id, '1' AS quantity,
		       n.id AS node_id, n.name AS node_name, b.id AS build_id, b.name AS build_name
		FROM nodes n JOIN builds b ON b.id = n.build_id
		WHERE b.user_id = ? AND COALESCE(n.details->>'inventory_item_id', '') <> ''
		ORDER BY b.updated_at DESC, n.name`, userID).Scan(&nodes).Error
	if err != nil {
		return nil, err
	}
	collect(nodes, false)

	var components []placementRow
	err = s.db.Raw(`
		SELECT c.details->>'inventory_item_id' AS item_id, COALESCE(c.details->>'inventory_quantity', '1') AS quantity,
		       n.id AS node_id, n.name AS node_name, b.id AS build_id, b.name AS build_name
		FROM node_components c JOIN nodes n ON n.id = c.node_id JOIN builds b ON b.id = n.build_id
		WHERE b.user_id = ? AND COALESCE(c.details->>'inventory_item_id', '') <> ''
		ORDER BY b.updated_at DESC, n.name`, userID).Scan(&components).Error
	if err != nil {
		return nil, err
	}
	collect(components, true)
	return result, nil
}

// deployments reads what each linked integration last saw of the machines the
// items stand for.
func (s *InventoryService) deployments(userID uuid.UUID, rows []models.InventoryItem) (map[uuid.UUID]*InventoryDeployment, error) {
	result := map[uuid.UUID]*InventoryDeployment{}
	wanted := map[uuid.UUID]bool{}
	for _, row := range rows {
		if row.IntegrationID != nil && row.IntegrationRef != "" {
			wanted[*row.IntegrationID] = true
		}
	}
	if len(wanted) == 0 {
		return result, nil
	}
	ids := make([]uuid.UUID, 0, len(wanted))
	for id := range wanted {
		ids = append(ids, id)
	}
	var integrations []models.Integration
	if err := s.db.Where("user_id = ? AND id IN ?", userID, ids).Find(&integrations).Error; err != nil {
		return nil, err
	}
	type seen struct {
		integration models.Integration
		snapshot    *proxmox.Snapshot
	}
	byID := map[uuid.UUID]seen{}
	for _, integration := range integrations {
		entry := seen{integration: integration}
		if len(integration.Snapshot) > 0 {
			var snapshot proxmox.Snapshot
			if json.Unmarshal(integration.Snapshot, &snapshot) == nil {
				entry.snapshot = &snapshot
			}
		}
		byID[integration.ID] = entry
	}
	for _, row := range rows {
		if row.IntegrationID == nil || row.IntegrationRef == "" {
			continue
		}
		entry, ok := byID[*row.IntegrationID]
		if !ok {
			continue
		}
		deployment := &InventoryDeployment{
			IntegrationID: entry.integration.ID, IntegrationName: entry.integration.Name,
			Kind: entry.integration.Kind, Ref: row.IntegrationRef, SyncedAt: entry.integration.SyncedAt,
		}
		if entry.snapshot != nil {
			if node, found := entry.snapshot.Node(row.IntegrationRef); found {
				online := node.Online
				deployment.Online = &online
				deployment.Version = node.Version
				deployment.Guests = len(entry.snapshot.GuestsOn(node.Name))
			}
		}
		result[row.ID] = deployment
	}
	return result, nil
}

// Get returns one item of the user.
func (s *InventoryService) Get(userID, itemID uuid.UUID) (*models.InventoryItem, error) {
	var row models.InventoryItem
	err := s.db.First(&row, "id = ? AND user_id = ?", itemID, userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrInventoryItemNotFound
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// Create adds an item to the user's inventory.
func (s *InventoryService) Create(userID uuid.UUID, in InventoryInput) (*models.InventoryItem, error) {
	item, err := in.item().Normalize()
	if err != nil {
		return nil, err
	}
	var count int64
	if err := s.db.Model(&models.InventoryItem{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
		return nil, err
	}
	if count >= MaxInventoryItems {
		return nil, ErrInventoryLimit
	}
	row := models.InventoryItem{ID: uuid.New(), UserID: userID}
	if err := applyInventoryItem(&row, item); err != nil {
		return nil, err
	}
	if err := s.db.Create(&row).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

// Update replaces what the user entered about an item. Its link to an
// integration is kept: that is changed where the machines are matched.
func (s *InventoryService) Update(userID, itemID uuid.UUID, in InventoryInput) (*models.InventoryItem, error) {
	row, err := s.Get(userID, itemID)
	if err != nil {
		return nil, err
	}
	item, err := in.item().Normalize()
	if err != nil {
		return nil, err
	}
	if err := applyInventoryItem(row, item); err != nil {
		return nil, err
	}
	if err := s.db.Save(row).Error; err != nil {
		return nil, err
	}
	return row, nil
}

// Delete removes an item. Nodes that stood for it keep their place in their
// builds and the name of what they were (details.inventory_label).
func (s *InventoryService) Delete(userID, itemID uuid.UUID) error {
	result := s.db.Where("id = ? AND user_id = ?", itemID, userID).Delete(&models.InventoryItem{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrInventoryItemNotFound
	}
	return nil
}

// sortedInventory returns rows in a fixed order, for anything that picks
// "the first match".
func sortedInventory(rows []models.InventoryItem) []models.InventoryItem {
	sorted := append([]models.InventoryItem(nil), rows...)
	sort.SliceStable(sorted, func(i, j int) bool {
		if !sorted[i].CreatedAt.Equal(sorted[j].CreatedAt) {
			return sorted[i].CreatedAt.Before(sorted[j].CreatedAt)
		}
		return sorted[i].ID.String() < sorted[j].ID.String()
	})
	return sorted
}
