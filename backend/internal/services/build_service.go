package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/gaming"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrBuildNotFound = errors.New("build not found")
var ErrBuildRevisionConflict = errors.New("build revision conflict")

type BuildService struct {
	db *gorm.DB
}

var ErrInvalidEdgeReferences = errors.New("invalid edge references")
var ErrInvalidTopology = errors.New("invalid topology")

func NewBuildService(db *gorm.DB) *BuildService {
	return &BuildService{db: db}
}

func (s *BuildService) Create(userID uuid.UUID, input SyncGraphInput) (*models.Build, error) {
	settingsJSON, _ := json.Marshal(input.Settings)

	build := &models.Build{
		UserID:    userID,
		Name:      input.Name,
		Thumbnail: input.Thumbnail,
		Settings:  settingsJSON,
	}
	if err := applyKindAndPlan(build, input); err != nil {
		return nil, err
	}

	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(build).Error; err != nil {
			return err
		}
		return s.syncGraph(tx, build.ID, input)
	})

	if err != nil {
		return nil, err
	}

	return s.GetByID(build.ID)
}

// Rename updates only build metadata and never rewrites topology rows.
func (s *BuildService) Rename(buildID, userID uuid.UUID, name string, revision uint64) (*models.Build, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("build name is required")
	}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var build models.Build
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&build, "id = ?", buildID).Error; err != nil {
			return err
		}
		if build.UserID != userID {
			return errors.New("unauthorized")
		}
		if revision != build.Revision {
			return fmt.Errorf("%w: expected %d, received %d", ErrBuildRevisionConflict, build.Revision, revision)
		}
		build.Name = name
		build.Revision++
		return tx.Save(&build).Error
	})
	if err != nil {
		return nil, err
	}
	return s.GetByID(buildID)
}

// UpdateAndCalculate commits the submitted graph and its calculated addresses as
// one revision. The row lock serializes concurrent writers for the same build.
func (s *BuildService) UpdateAndCalculate(buildID, userID uuid.UUID, input SyncGraphInput, ipService *IPService) (*models.Build, error) {
	err := s.db.Transaction(func(tx *gorm.DB) error {
		return s.SaveAndCalculateTx(tx, buildID, userID, input, ipService)
	})
	if err != nil {
		return nil, err
	}
	return s.GetByID(buildID)
}

// SaveAndCalculateTx writes the graph and its calculated addresses inside an
// already open transaction, so callers can commit it or roll it back as a unit.
func (s *BuildService) SaveAndCalculateTx(tx *gorm.DB, buildID, userID uuid.UUID, input SyncGraphInput, ipService *IPService) error {
	var build models.Build
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&build, "id = ?", buildID).Error; err != nil {
		return err
	}
	if build.UserID != userID {
		return errors.New("unauthorized")
	}
	return s.saveRevisionTx(tx, &build, input, ipService)
}

// saveRevisionTx writes the next revision of a locked build: its metadata, its
// graph and the addresses calculated for it.
func (s *BuildService) saveRevisionTx(tx *gorm.DB, build *models.Build, input SyncGraphInput, ipService *IPService) error {
	if input.Revision != build.Revision {
		return fmt.Errorf("%w: expected %d, received %d", ErrBuildRevisionConflict, build.Revision, input.Revision)
	}

	settingsJSON, _ := json.Marshal(input.Settings)
	build.Name = input.Name
	build.Settings = settingsJSON
	build.Revision++
	if input.Thumbnail != "" {
		build.Thumbnail = input.Thumbnail
	}
	if err := applyKindAndPlan(build, input); err != nil {
		return err
	}
	if err := tx.Save(build).Error; err != nil {
		return err
	}
	if err := s.syncGraph(tx, build.ID, input); err != nil {
		return err
	}
	return ipService.WithDB(tx).CalculateNetwork(build.ID)
}

// applyKindAndPlan copies the build kind and the gaming plan from a save onto
// the build row. Both are optional in the DTO: an empty kind and a nil plan
// leave the stored values alone, so a client that does not know about them
// cannot wipe them.
func applyKindAndPlan(build *models.Build, input SyncGraphInput) error {
	if input.Kind != "" {
		kind, err := gaming.ParseKind(input.Kind)
		if err != nil {
			return fmt.Errorf("%w: %v", ErrInvalidTopology, err)
		}
		build.Kind = string(kind)
	}
	if input.GamingPlan != nil {
		plan, err := input.GamingPlan.Normalize()
		if err != nil {
			return fmt.Errorf("%w: gaming plan: %v", ErrInvalidTopology, err)
		}
		planJSON, err := json.Marshal(plan)
		if err != nil {
			return err
		}
		build.GamingPlan = planJSON
	}
	return nil
}

func (s *BuildService) syncGraph(tx *gorm.DB, buildID uuid.UUID, input SyncGraphInput) error {
	if err := validateVirtualNetworks(input.Nodes); err != nil {
		return err
	}
	if err := validateEdgeEndpoints(input.Nodes, input.Edges); err != nil {
		return err
	}

	// 1. Delete existing nodes/edges/services (cleanup)
	if err := deleteGraph(tx, buildID); err != nil {
		return err
	}

	idMap := make(map[string]uuid.UUID)
	for _, n := range input.Nodes {
		if parsed, err := uuid.Parse(n.ID); err == nil {
			idMap[n.ID] = parsed
		} else {
			idMap[n.ID] = uuid.New()
		}
	}

	// 2. Insert Nodes
	for _, n := range input.Nodes {
		uid := idMap[n.ID]
		if n.Details == nil {
			n.Details = make(map[string]any)
		}
		if n.SubnetMask != "" {
			n.Details["subnet_mask"] = n.SubnetMask
		}
		if n.Gateway != "" {
			n.Details["gateway"] = n.Gateway
		}
		detailsJSON, _ := json.Marshal(n.Details)

		node := models.Node{
			ID:         uid,
			BuildID:    buildID,
			Type:       n.Type,
			Name:       n.Name,
			X:          n.X,
			Y:          n.Y,
			PowerDraw:  n.PowerDraw,
			IP:         n.IP,
			MacAddress: n.MacAddress,
			Details:    detailsJSON,
		}
		if n.ParentID != nil && *n.ParentID != "" {
			if parentID, ok := idMap[*n.ParentID]; ok {
				node.ParentID = &parentID
			}
		}

		if err := tx.Create(&node).Error; err != nil {
			return err
		}

		// 2.1 VMs
		for _, vm := range n.VMs {
			vmUID := uuid.New()
			if parsed, err := uuid.Parse(vm.ID); err == nil {
				vmUID = parsed
			}
			vmDetails, _ := json.Marshal(vm.Details)

			vModel := models.VirtualMachine{
				ID:         vmUID,
				NodeID:     uid,
				Name:       vm.Name,
				Type:       vm.Type,
				IP:         vm.IP,
				MacAddress: vm.MacAddress,
				OS:         vm.OS,
				CPUCores:   vm.CPUCores,
				RAMMB:      vm.RAMMB,
				Status:     vm.Status,
				Details:    vmDetails,
			}
			if err := tx.Create(&vModel).Error; err != nil {
				return err
			}
		}

		// 2.2 Internal Components
		for _, comp := range n.InternalComponents {
			compUID := uuid.New()
			if parsed, err := uuid.Parse(comp.ID); err == nil {
				compUID = parsed
			}
			compDetailsJSON, _ := json.Marshal(comp.Details)
			cModel := models.NodeComponent{
				ID:        compUID,
				NodeID:    uid,
				Type:      comp.Type,
				Name:      comp.Name,
				PowerDraw: comp.PowerDraw,
				Details:   compDetailsJSON,
			}
			if err := tx.Create(&cModel).Error; err != nil {
				return err
			}
		}
	}

	// 3. Insert Edges
	for _, le := range input.Edges {
		sourceUUID, ok1 := idMap[le.Source]
		targetUUID, ok2 := idMap[le.Target]

		if ok1 && ok2 {
			edge := models.Edge{
				BuildID:          buildID,
				SourceNodeID:     sourceUUID,
				SourceHandle:     le.SourceHandle,
				TargetNodeID:     targetUUID,
				TargetHandle:     le.TargetHandle,
				Type:             defaultString(le.Type, "ethernet"),
				Speed:            le.Speed,
				Subnet:           le.Subnet,
				WirelessStandard: le.WirelessStandard,
				Direction:        defaultString(le.Direction, "auto"),
			}
			if err := tx.Create(&edge).Error; err != nil {
				return err
			}
		}
	}

	// 4. Insert Service Instances
	for _, ls := range input.Services {
		catalogID, err := uuid.Parse(ls.ID)
		if err == nil {
			svc := models.ServiceInstance{
				BuildID:          buildID,
				CatalogServiceID: catalogID,
				Name:             ls.Name,
				Status:           "stopped",
			}
			if err := tx.Create(&svc).Error; err != nil {
				return err
			}
		}
	}

	return nil
}

// deleteGraph removes every topology row of a build, children first, so it
// works whether or not the foreign keys cascade.
func deleteGraph(tx *gorm.DB, buildID uuid.UUID) error {
	if err := tx.Where("build_id = ?", buildID).Delete(&models.Edge{}).Error; err != nil {
		return err
	}
	if err := tx.Where("build_id = ?", buildID).Delete(&models.ServiceInstance{}).Error; err != nil {
		return err
	}
	if err := tx.Where("node_id IN (?)", tx.Model(&models.Node{}).Select("id").Where("build_id = ?", buildID)).Delete(&models.VirtualMachine{}).Error; err != nil {
		return err
	}
	if err := tx.Where("node_id IN (?)", tx.Model(&models.Node{}).Select("id").Where("build_id = ?", buildID)).Delete(&models.NodeComponent{}).Error; err != nil {
		return err
	}
	return tx.Where("build_id = ?", buildID).Delete(&models.Node{}).Error
}

func validateEdgeEndpoints(nodes []NodeDTO, edges []EdgeDTO) error {
	nodesByID := make(map[string]NodeDTO, len(nodes))
	issues := make([]string, 0)
	knownNodeTypes := map[string]bool{
		"router": true, "switch": true, "access_point": true, "modem": true, "firewall": true,
		"server": true, "server_v2": true, "vps": true, "pc": true, "minipc": true,
		"sbc": true, "nas": true, "iot": true, "ups": true, "pdu": true, "rack": true,
		"disk": true, "gpu": true, "hba": true, "pcie": true,
		nodeTypeConsole: true, nodeTypeLANTable: true,
	}
	vmHostTypes := map[string]bool{"server": true, "server_v2": true, "vps": true, "pc": true, "minipc": true, "sbc": true, "nas": true, "iot": true}
	vmIDs := make(map[string]struct{})
	for _, node := range nodes {
		if strings.TrimSpace(node.ID) == "" {
			issues = append(issues, "node has an empty id")
			continue
		}
		if _, exists := nodesByID[node.ID]; exists {
			issues = append(issues, fmt.Sprintf("duplicate node id %q", node.ID))
			continue
		}
		if !knownNodeTypes[node.Type] {
			issues = append(issues, fmt.Sprintf("node %s has unsupported type %q", node.ID, node.Type))
		}
		if len(node.VMs) > 0 && !vmHostTypes[node.Type] {
			issues = append(issues, fmt.Sprintf("%s nodes cannot host virtual machines or services", node.Type))
		}
		issues = append(issues, gamingNodeIssues(node)...)
		for _, vm := range node.VMs {
			if strings.TrimSpace(vm.ID) == "" {
				issues = append(issues, fmt.Sprintf("service on %s has an empty id", node.ID))
				continue
			}
			if _, exists := vmIDs[vm.ID]; exists {
				issues = append(issues, fmt.Sprintf("duplicate virtual machine id %q", vm.ID))
			} else {
				vmIDs[vm.ID] = struct{}{}
			}
		}
		nodesByID[node.ID] = node
	}

	for _, node := range nodes {
		if node.ParentID == nil || *node.ParentID == "" {
			continue
		}
		if *node.ParentID == node.ID {
			issues = append(issues, fmt.Sprintf("%s cannot contain itself", node.ID))
			continue
		}
		parent, exists := nodesByID[*node.ParentID]
		if !exists {
			issues = append(issues, fmt.Sprintf("%s references missing parent %s", node.ID, *node.ParentID))
			continue
		}
		if parent.Type != "rack" {
			issues = append(issues, fmt.Sprintf("%s can only be placed inside a rack", node.ID))
		}
		if node.Type == "rack" {
			issues = append(issues, fmt.Sprintf("rack %s cannot be nested", node.ID))
		}
		if floorNodeTypes[node.Type] {
			issues = append(issues, fmt.Sprintf("%s nodes cannot be mounted in a rack", node.Type))
		}
	}

	allowedEdgeTypes := map[string]bool{"": true, "ethernet": true, "wireless": true, "vpn": true}
	connectsFreely := map[string]bool{
		"router": true, "switch": true, "modem": true, "firewall": true,
		"server_v2": true, "vps": true, "iot": true, "ups": true,
	}
	nestedOnly := map[string]bool{"disk": true, "gpu": true, "hba": true, "pcie": true, "pdu": true, "rack": true}
	seenPairs := make(map[string]struct{}, len(edges))
	usedPorts := make(map[string]struct{})
	tableUplinks := make(map[string]int)
	missingRefs := make([]string, 0)

	for _, edge := range edges {
		source, hasSource := nodesByID[edge.Source]
		target, hasTarget := nodesByID[edge.Target]
		if !hasSource || !hasTarget {
			missing := "source"
			if hasSource {
				missing = "target"
			} else if !hasTarget {
				missing = "source and target"
			}
			missingRefs = append(missingRefs, fmt.Sprintf("%s->%s (missing %s)", edge.Source, edge.Target, missing))
			continue
		}
		if edge.Source == edge.Target {
			issues = append(issues, fmt.Sprintf("self connection on %s", edge.Source))
			continue
		}
		if !allowedEdgeTypes[edge.Type] {
			issues = append(issues, fmt.Sprintf("%s->%s uses unsupported connection type %q", edge.Source, edge.Target, edge.Type))
		}

		left, right := edge.Source, edge.Target
		if right < left {
			left, right = right, left
		}
		pair := left + "\x00" + right
		if _, duplicate := seenPairs[pair]; duplicate {
			issues = append(issues, fmt.Sprintf("duplicate connection between %s and %s", left, right))
		} else {
			seenPairs[pair] = struct{}{}
		}

		isPower := source.Type == "ups" || target.Type == "ups"
		isLogical := edge.Type == "vpn"
		// A client on an access point's Wi-Fi: no cable, and the access point's
		// port stays free for its uplink.
		isWifiClient := isWifiAssociation(source.Type, target.Type)
		if !isPower && (nestedOnly[source.Type] || nestedOnly[target.Type]) {
			issues = append(issues, fmt.Sprintf("%s->%s connects a nested-only component", edge.Source, edge.Target))
		}
		if !isPower && !isWifiClient && !connectsFreely[source.Type] && !connectsFreely[target.Type] {
			issues = append(issues, fmt.Sprintf("%s and %s must connect through a router, switch, firewall, modem, or gateway", edge.Source, edge.Target))
		}
		if isWifiClient && edge.Type != "wireless" {
			issues = append(issues, fmt.Sprintf("%s->%s joins an access point and must be a wireless connection", edge.Source, edge.Target))
		}
		if !isPower {
			for _, endpoint := range []NodeDTO{source, target} {
				if endpoint.Type != nodeTypeLANTable {
					continue
				}
				if edge.Type == "wireless" || edge.Type == "vpn" {
					issues = append(issues, fmt.Sprintf("LAN table %s needs a cabled uplink", endpoint.ID))
				}
				tableUplinks[endpoint.ID]++
				if tableUplinks[endpoint.ID] == 2 {
					issues = append(issues, fmt.Sprintf("LAN table %s has more than one uplink", endpoint.ID))
				}
			}
		}
		if edge.Type == "wireless" && source.Type != "access_point" && target.Type != "access_point" && source.Type != "iot" && target.Type != "iot" {
			issues = append(issues, fmt.Sprintf("wireless connection %s->%s requires an access point or IoT endpoint", edge.Source, edge.Target))
		}

		if !isPower && !isLogical {
			for _, endpoint := range []struct{ nodeID, handle string }{{edge.Source, edge.SourceHandle}, {edge.Target, edge.TargetHandle}} {
				if endpoint.handle == "" {
					continue
				}
				if isWifiClient && nodesByID[endpoint.nodeID].Type == "access_point" {
					continue
				}
				port := endpoint.nodeID + "\x00" + endpoint.handle
				if _, used := usedPorts[port]; used {
					issues = append(issues, fmt.Sprintf("port %s on %s is used more than once", endpoint.handle, endpoint.nodeID))
				} else {
					usedPorts[port] = struct{}{}
				}
			}
		}
	}

	if len(missingRefs) > 0 {
		return fmt.Errorf("%w: %s", ErrInvalidEdgeReferences, summarizeTopologyIssues(missingRefs))
	}
	if len(issues) > 0 {
		return fmt.Errorf("%w: %s", ErrInvalidTopology, summarizeTopologyIssues(issues))
	}
	return nil
}

func summarizeTopologyIssues(issues []string) string {
	const maxExamples = 5
	shown := issues
	if len(shown) > maxExamples {
		shown = shown[:maxExamples]
	}
	summary := strings.Join(shown, "; ")
	if len(issues) > len(shown) {
		summary += fmt.Sprintf("; ... +%d more", len(issues)-len(shown))
	}
	return summary
}

func (s *BuildService) GetByID(buildID uuid.UUID) (*models.Build, error) {
	var build models.Build
	if err := s.db.Preload("User").
		Preload("Nodes").
		Preload("Nodes.VirtualMachines").
		Preload("Nodes.InternalComponents").
		Preload("Edges").
		Preload("Nodes.ServiceInstances").
		First(&build, "id = ?", buildID).Error; err != nil {
		return nil, err
	}

	var totalPower float64
	for _, n := range build.Nodes {
		totalPower += n.PowerDraw
		for _, comp := range n.InternalComponents {
			totalPower += comp.PowerDraw
		}
	}
	build.TotalPower = totalPower

	return &build, nil
}

type SyncGraphInput struct {
	Name      string         `json:"name" binding:"required"`
	Thumbnail string         `json:"thumbnail"`
	Settings  map[string]any `json:"settings"`
	Revision  uint64         `json:"revision"`
	Nodes     []NodeDTO      `json:"nodes"`
	Edges     []EdgeDTO      `json:"edges"`
	Services  []ServiceDTO   `json:"services"`
	// Kind and GamingPlan are optional: "" and nil keep what the build has.
	Kind       string       `json:"kind,omitempty"`
	GamingPlan *gaming.Plan `json:"gaming_plan,omitempty"`
}

type NodeDTO struct {
	ID                 string         `json:"id"`
	Type               string         `json:"type"`
	Name               string         `json:"name"`
	X                  float64        `json:"x"`
	Y                  float64        `json:"y"`
	PowerDraw          float64        `json:"power_draw"`
	IP                 string         `json:"ip"`
	MacAddress         string         `json:"mac_address"`
	SubnetMask         string         `json:"subnet_mask,omitempty"`
	Gateway            string         `json:"gateway,omitempty"`
	Details            map[string]any `json:"details"`
	VMs                []VMDTO        `json:"vms"`
	InternalComponents []ComponentDTO `json:"internal_components"`
	ParentID           *string        `json:"parent_id,omitempty"`
}

type ComponentDTO struct {
	ID        string         `json:"id"`
	Type      string         `json:"type"`
	Name      string         `json:"name"`
	PowerDraw float64        `json:"power_draw"`
	Details   map[string]any `json:"details"`
}

type VMDTO struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Type       string         `json:"type"`
	IP         string         `json:"ip"`
	MacAddress string         `json:"mac_address"`
	OS         string         `json:"os"`
	CPUCores   float64        `json:"cpu_cores"`
	RAMMB      int            `json:"ram_mb"`
	Status     string         `json:"status"`
	Details    map[string]any `json:"details"`
}

type ServiceDTO struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type EdgeDTO struct {
	Source           string `json:"source"`
	SourceHandle     string `json:"source_handle"`
	Target           string `json:"target"`
	TargetHandle     string `json:"target_handle"`
	Type             string `json:"type"`
	Speed            string `json:"speed"`
	Subnet           string `json:"subnet"`
	WirelessStandard string `json:"wireless_standard"`
	Direction        string `json:"direction"`
}

func defaultString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

// ShareBuild enables public sharing for a build and returns the share token.
func (s *BuildService) ShareBuild(buildID uuid.UUID, userID uuid.UUID) (*models.Build, error) {
	return s.updateSharing(buildID, userID, func(build *models.Build) map[string]any {
		fields := map[string]any{"is_shared": true}
		if build.ShareToken == nil || *build.ShareToken == "" {
			fields["share_token"] = uuid.New().String()
		}
		return fields
	})
}

// UnshareBuild disables public sharing for a build.
func (s *BuildService) UnshareBuild(buildID uuid.UUID, userID uuid.UUID) (*models.Build, error) {
	return s.updateSharing(buildID, userID, func(*models.Build) map[string]any {
		return map[string]any{"is_shared": false}
	})
}

// SetShareEditable sets whether collaborators with the share link can edit the build.
func (s *BuildService) SetShareEditable(buildID uuid.UUID, userID uuid.UUID, editable bool) (*models.Build, error) {
	return s.updateSharing(buildID, userID, func(*models.Build) map[string]any {
		return map[string]any{"shared_editable": editable}
	})
}

// updateSharing writes only the sharing columns of a build its owner asked to
// change, so it cannot undo a topology save that commits in between.
func (s *BuildService) updateSharing(buildID, userID uuid.UUID, fields func(*models.Build) map[string]any) (*models.Build, error) {
	var build models.Build
	if err := s.db.First(&build, "id = ?", buildID).Error; err != nil {
		return nil, ErrBuildNotFound
	}
	if build.UserID != userID {
		return nil, errors.New("unauthorized")
	}
	if err := s.db.Model(&build).Updates(fields(&build)).Error; err != nil {
		return nil, err
	}
	return s.GetByID(buildID)
}

// UpdateByShareToken atomically saves and calculates a shared editable topology.
func (s *BuildService) UpdateByShareToken(token string, input SyncGraphInput, ipService *IPService) (*models.Build, error) {
	var buildID uuid.UUID
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var build models.Build
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("share_token = ? AND is_shared = true AND shared_editable = true", token).First(&build).Error; err != nil {
			return ErrBuildNotFound
		}
		// A save through a share link never changes the kind or the plan.
		input.Kind, input.GamingPlan = "", nil
		if err := s.saveRevisionTx(tx, &build, input, ipService); err != nil {
			return err
		}
		buildID = build.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	saved, err := s.GetByID(buildID)
	if err != nil {
		return nil, err
	}
	return asSharedView(saved)
}

// GetByShareToken fetches a publicly shared build by its token.
func (s *BuildService) GetByShareToken(token string) (*models.Build, error) {
	var build models.Build
	if err := s.db.Where("share_token = ? AND is_shared = true", token).First(&build).Error; err != nil {
		return nil, ErrBuildNotFound
	}
	shared, err := s.GetByID(build.ID)
	if err != nil {
		return nil, err
	}
	return asSharedView(shared)
}

// asSharedView is a build as someone holding its share link gets it, on a read
// and in the answer to a save. The address friends connect to is the home
// address of the owner, so it is left out. Only the copy in memory changes.
func asSharedView(build *models.Build) (*models.Build, error) {
	plan, err := gaming.ParsePlan(build.GamingPlan)
	if err != nil {
		return nil, err
	}
	if plan.Uplink.PublicHost != "" {
		plan.Uplink.PublicHost = ""
		if build.GamingPlan, err = json.Marshal(plan); err != nil {
			return nil, err
		}
	}
	return build, nil
}

func (s *BuildService) ListByUser(userID uuid.UUID) ([]models.Build, error) {
	var builds []models.Build
	// Nodes and edges are enough to draw each build in miniature; guests are not listed.
	if err := s.db.Preload("Nodes").Preload("Edges").Where("user_id = ?", userID).Order("updated_at desc").Find(&builds).Error; err != nil {
		return nil, err
	}
	return builds, nil
}

func (s *BuildService) Delete(buildID uuid.UUID, userID uuid.UUID) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		var owned int64
		if err := tx.Model(&models.Build{}).Where("id = ? AND user_id = ?", buildID, userID).Count(&owned).Error; err != nil {
			return err
		}
		if owned == 0 {
			return errors.New("build not found or unauthorized")
		}
		// The nodes foreign key does not cascade, so clear the topology first.
		if err := deleteGraph(tx, buildID); err != nil {
			return err
		}
		return tx.Where("id = ? AND user_id = ?", buildID, userID).Delete(&models.Build{}).Error
	})
}

func (s *BuildService) Duplicate(buildID uuid.UUID, userID uuid.UUID) (*models.Build, error) {
	build, err := s.GetByID(buildID)
	if err != nil {
		return nil, err
	}

	if build.UserID != userID {
		return nil, errors.New("unauthorized to duplicate this build")
	}

	// Create a new independent copy with a new UUID
	newBuild := &models.Build{
		UserID:     userID,
		Name:       build.Name + " (Copy)",
		Kind:       build.Kind,
		GamingPlan: build.GamingPlan,
		Thumbnail:  build.Thumbnail,
		Settings:   build.Settings,
	}

	// Start a transaction to insert the new build and sync its data
	err = s.db.Transaction(func(tx *gorm.DB) error {
		// Insert the new base build row to get its ID
		if err := tx.Create(newBuild).Error; err != nil {
			return err
		}

		idMap := make(map[uuid.UUID]uuid.UUID, len(build.Nodes))
		for _, node := range build.Nodes {
			idMap[node.ID] = uuid.New()
		}

		for _, node := range build.Nodes {
			newUID := idMap[node.ID]

			// Guests get their new ids first, so the copied virtual network can
			// point at them when the node is written.
			vmIDs := make(map[string]string, len(node.VirtualMachines))
			newVMs := make([]models.VirtualMachine, len(node.VirtualMachines))
			for i, vm := range node.VirtualMachines {
				newVM := vm
				newVM.ID = uuid.New()
				newVM.NodeID = newUID
				vmIDs[vm.ID.String()] = newVM.ID.String()
				newVMs[i] = newVM
			}
			details, err := remapVirtualNetwork(node.Details, vmIDs)
			if err != nil {
				return err
			}

			newNode := models.Node{
				ID:         newUID,
				BuildID:    newBuild.ID,
				Type:       node.Type,
				Name:       node.Name,
				X:          node.X,
				Y:          node.Y,
				PowerDraw:  node.PowerDraw,
				IP:         node.IP,
				MacAddress: node.MacAddress,
				Details:    details,
			}
			// Rack-mounted copies point at the copied rack, not the original one.
			if node.ParentID != nil {
				if parentID, ok := idMap[*node.ParentID]; ok {
					newNode.ParentID = &parentID
				}
			}
			if err := tx.Create(&newNode).Error; err != nil {
				return err
			}

			for i := range newVMs {
				if err := tx.Create(&newVMs[i]).Error; err != nil {
					return err
				}
			}

			for _, comp := range node.InternalComponents {
				newComp := comp
				newComp.ID = uuid.New()
				newComp.NodeID = newUID
				if err := tx.Create(&newComp).Error; err != nil {
					return err
				}
			}

			for _, svc := range node.ServiceInstances {
				newSvc := svc
				newSvc.ID = uuid.New()
				newSvc.BuildID = newBuild.ID
				nodeIDPtr := newUID
				newSvc.NodeID = &nodeIDPtr
				if err := tx.Create(&newSvc).Error; err != nil {
					return err
				}
			}
		}

		for _, edge := range build.Edges {
			sourceUUID, ok1 := idMap[edge.SourceNodeID]
			targetUUID, ok2 := idMap[edge.TargetNodeID]

			if ok1 && ok2 {
				newEdge := models.Edge{
					ID:               uuid.New(),
					BuildID:          newBuild.ID,
					SourceNodeID:     sourceUUID,
					SourceHandle:     edge.SourceHandle,
					TargetNodeID:     targetUUID,
					TargetHandle:     edge.TargetHandle,
					Type:             edge.Type,
					Speed:            edge.Speed,
					Subnet:           edge.Subnet,
					WirelessStandard: edge.WirelessStandard,
					Direction:        edge.Direction,
				}
				if err := tx.Create(&newEdge).Error; err != nil {
					return err
				}
			}
		}

		// Backlog service instances belong to no node.
		var globalServices []models.ServiceInstance
		if err := tx.Where("build_id = ? AND node_id IS NULL", buildID).Find(&globalServices).Error; err != nil {
			return err
		}
		for _, svc := range globalServices {
			newSvc := svc
			newSvc.ID = uuid.New()
			newSvc.BuildID = newBuild.ID
			if err := tx.Create(&newSvc).Error; err != nil {
				return err
			}
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return s.GetByID(newBuild.ID)
}
