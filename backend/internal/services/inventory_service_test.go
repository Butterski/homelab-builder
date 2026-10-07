package services

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/inventory"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/proxmox"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func m75qInput(name string) InventoryInput {
	return InventoryInput{
		Kind: inventory.KindDevice, Type: "minipc", Name: name, Manufacturer: "Lenovo", Model: "ThinkCentre M75q",
		Location: "shelf", MacAddresses: []string{"aa:bb:cc:dd:ee:ff"},
		Specs: inventory.Specs{CPUModel: "Ryzen 5 PRO 4650GE", CPUCores: 6, CPUThreads: 12, RAMGB: 32, StorageGB: 240},
	}
}

func mustCreateItem(t *testing.T, svc *InventoryService, userID uuid.UUID, in InventoryInput) *models.InventoryItem {
	t.Helper()
	item, err := svc.Create(userID, in)
	if err != nil {
		t.Fatalf("create %q: %v", in.Name, err)
	}
	return item
}

func viewOf(t *testing.T, svc *InventoryService, userID, itemID uuid.UUID) InventoryItemView {
	t.Helper()
	views, err := svc.List(userID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	for _, view := range views {
		if view.ID == itemID {
			return view
		}
	}
	t.Fatalf("item %s is not listed", itemID)
	return InventoryItemView{}
}

// inventoryState is how the list says an item stands.
func inventoryState(t *testing.T, svc *InventoryService, userID, itemID uuid.UUID) string {
	t.Helper()
	return viewOf(t, svc, userID, itemID).State
}

func TestInventory_BelongsToTheAccount(t *testing.T) {
	tx := testTx(t)
	svc := NewInventoryService(tx)
	owner, stranger := newTestUser(t, tx).ID, newTestUser(t, tx).ID

	item := mustCreateItem(t, svc, owner, m75qInput("Lenovo M75q #1"))
	if item.Status != inventory.StatusAvailable || item.Quantity != 1 || item.Location != "shelf" {
		t.Fatalf("stored item: %+v", item)
	}
	var macs []string
	if err := json.Unmarshal(item.MacAddresses, &macs); err != nil || len(macs) != 1 || macs[0] != "AA:BB:CC:DD:EE:FF" {
		t.Fatalf("hardware addresses are stored one way: %s", item.MacAddresses)
	}

	mine, err := svc.List(owner)
	if err != nil || len(mine) != 1 || len(mine[0].Placements) != 0 || mine[0].Deployment != nil {
		t.Fatalf("owner's list: %+v, %v", mine, err)
	}
	if theirs, err := svc.List(stranger); err != nil || len(theirs) != 0 {
		t.Fatalf("another account sees nothing: %+v, %v", theirs, err)
	}

	// Another account can neither read, change nor delete it.
	if _, err := svc.Get(stranger, item.ID); !errors.Is(err, ErrInventoryItemNotFound) {
		t.Fatalf("get by a stranger: %v", err)
	}
	if _, err := svc.Update(stranger, item.ID, m75qInput("Mine now")); !errors.Is(err, ErrInventoryItemNotFound) {
		t.Fatalf("update by a stranger: %v", err)
	}
	if err := svc.Delete(stranger, item.ID); !errors.Is(err, ErrInventoryItemNotFound) {
		t.Fatalf("delete by a stranger: %v", err)
	}

	changed := m75qInput("Lenovo M75q #1")
	changed.Status, changed.Location = inventory.StatusBroken, "drawer"
	updated, err := svc.Update(owner, item.ID, changed)
	if err != nil || updated.Status != inventory.StatusBroken || updated.Location != "drawer" {
		t.Fatalf("update: %+v, %v", updated, err)
	}
	if _, err := svc.Create(owner, InventoryInput{Type: "minipc"}); !errors.Is(err, inventory.ErrInvalid) {
		t.Fatalf("an item without a name: %v", err)
	}

	if err := svc.Delete(owner, item.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if left, _ := svc.List(owner); len(left) != 0 {
		t.Fatalf("still listed after delete: %+v", left)
	}
}

// buildWithItems saves a build whose host stands for hostItem and holds a
// component that stands for partItem.
func buildWithItems(t *testing.T, tx *gorm.DB, userID uuid.UUID, name, hostItem, partItem string) *models.Build {
	t.Helper()
	builds := NewBuildService(tx)
	ip := newIPAMStub(t, tx)
	created, err := builds.Create(userID, SyncGraphInput{Name: name})
	if err != nil {
		t.Fatalf("create build: %v", err)
	}
	router, host := uuid.NewString(), uuid.NewString()
	build, err := builds.UpdateAndCalculate(created.ID, userID, SyncGraphInput{
		Name: name, Revision: created.Revision,
		Nodes: []NodeDTO{
			{ID: router, Type: "router", Name: "Router", IP: "192.168.1.1", Details: map[string]any{"ports": 4}},
			{ID: host, Type: "minipc", Name: "proxmox-01", X: 0, Y: 260,
				Details: map[string]any{inventory.DetailItemID: hostItem, inventory.DetailLabel: "Lenovo M75q #1", "cpu": 12, "ram": 32},
				InternalComponents: []ComponentDTO{{
					ID: uuid.NewString(), Type: "ram", Name: "16 GB DDR4 SODIMM",
					Details: map[string]any{inventory.DetailItemID: partItem, inventory.DetailQuantity: 2},
				}},
			},
		},
		Edges: []EdgeDTO{{Source: router, SourceHandle: "eth0", Target: host, TargetHandle: TargetHandle, Type: "ethernet"}},
	}, ip)
	if err != nil {
		t.Fatalf("save build: %v", err)
	}
	return build
}

func TestInventory_PlacementsAreReadFromTheBuilds(t *testing.T) {
	tx := testTx(t)
	svc := NewInventoryService(tx)
	owner, other := newTestUser(t, tx).ID, newTestUser(t, tx).ID

	machine := mustCreateItem(t, svc, owner, m75qInput("Lenovo M75q #1"))
	memory := mustCreateItem(t, svc, owner, InventoryInput{
		Kind: inventory.KindComponent, Type: "ram", Name: "16 GB DDR4 SODIMM", Quantity: 2, Location: "drawer",
		Specs: inventory.Specs{RAMGB: 16, RAMType: "DDR4 SODIMM"},
	})
	spare := mustCreateItem(t, svc, owner, m75qInput("Lenovo M920q #2"))

	// The same machine is planned in two builds; that is the point of an inventory.
	buildWithItems(t, tx, owner, "Current Homelab", machine.ID.String(), memory.ID.String())
	buildWithItems(t, tx, owner, "Future Upgrade", machine.ID.String(), memory.ID.String())
	// Somebody else's build that names the same id says nothing about this inventory.
	buildWithItems(t, tx, other, "Not mine", machine.ID.String(), memory.ID.String())

	placed := viewOf(t, svc, owner, machine.ID).Placements
	if len(placed) != 2 {
		t.Fatalf("the machine is planned twice: %+v", placed)
	}
	names := map[string]bool{}
	for _, placement := range placed {
		names[placement.BuildName] = true
		if placement.NodeName != "proxmox-01" || placement.Component || placement.Quantity != 1 {
			t.Fatalf("a device placement names its role: %+v", placement)
		}
	}
	if !names["Current Homelab"] || !names["Future Upgrade"] || names["Not mine"] {
		t.Fatalf("builds of the placements: %v", names)
	}

	parts := viewOf(t, svc, owner, memory.ID).Placements
	if len(parts) != 2 || !parts[0].Component || parts[0].Quantity != 2 || parts[0].NodeName != "proxmox-01" {
		t.Fatalf("the modules sit in the host, two of them: %+v", parts)
	}
	if unused := viewOf(t, svc, owner, spare.ID).Placements; len(unused) != 0 {
		t.Fatalf("an item nobody planned has no placement: %+v", unused)
	}

	// What a build plans is in use, though the list still says "available".
	// Two builds that plan the same two modules are variants: they use two, not four.
	for name, want := range map[string]struct {
		id    uuid.UUID
		state string
	}{
		"planned machine": {machine.ID, inventory.StatusInUse},
		"planned memory":  {memory.ID, inventory.StatusInUse},
		"spare machine":   {spare.ID, inventory.StatusAvailable},
	} {
		view := viewOf(t, svc, owner, want.id)
		if view.Status != inventory.StatusAvailable || view.State != want.state {
			t.Fatalf("%s: status %q, state %q, want state %q", name, view.Status, view.State, want.state)
		}
	}
	// What the owner says of a broken machine stays, planned or not.
	broken := m75qInput("Lenovo M75q #1")
	broken.Status = inventory.StatusBroken
	if _, err := svc.Update(owner, machine.ID, broken); err != nil {
		t.Fatalf("mark broken: %v", err)
	}
	if state := inventoryState(t, svc, owner, machine.ID); state != inventory.StatusBroken {
		t.Fatalf("a broken machine that is planned is still broken, got %q", state)
	}
}

func TestInventory_ShowsWhatItsIntegrationReports(t *testing.T) {
	tx := testTx(t)
	svc := NewInventoryService(tx)
	owner := newTestUser(t, tx).ID
	machine := mustCreateItem(t, svc, owner, m75qInput("Lenovo M75q #1"))

	snapshot, _ := json.Marshal(proxmox.Snapshot{
		Source: proxmox.SourceAPI,
		Nodes:  []proxmox.Node{{Name: "pve01", Online: true, Version: "8.2.4"}, {Name: "pve02", Online: false}},
		Guests: []proxmox.Guest{
			{VMID: 100, Name: "a", Node: "pve01"}, {VMID: 101, Name: "b", Node: "pve01"},
			{VMID: 900, Name: "template", Node: "pve01", Template: true},
		},
	})
	synced := time.Now()
	integration := models.Integration{ID: uuid.New(), UserID: owner, Kind: IntegrationKindProxmox, Name: "Homelab", Snapshot: snapshot, SyncedAt: &synced}
	if err := tx.Create(&integration).Error; err != nil {
		t.Fatalf("create integration: %v", err)
	}
	if err := tx.Model(&models.InventoryItem{}).Where("id = ?", machine.ID).
		Updates(map[string]any{"integration_id": integration.ID, "integration_ref": "pve01"}).Error; err != nil {
		t.Fatalf("link: %v", err)
	}

	deployment := viewOf(t, svc, owner, machine.ID).Deployment
	if deployment == nil || deployment.Ref != "pve01" || deployment.IntegrationName != "Homelab" ||
		deployment.Online == nil || !*deployment.Online || deployment.Version != "8.2.4" || deployment.Guests != 2 {
		t.Fatalf("deployment: %+v", deployment)
	}
	if state := inventoryState(t, svc, owner, machine.ID); state != inventory.StatusInUse {
		t.Fatalf("the machine behind a host is in use, got %q", state)
	}

	// A host the last reading no longer lists: linked, state unknown.
	if err := tx.Model(&models.InventoryItem{}).Where("id = ?", machine.ID).Update("integration_ref", "pve09").Error; err != nil {
		t.Fatalf("relink: %v", err)
	}
	if gone := viewOf(t, svc, owner, machine.ID).Deployment; gone == nil || gone.Online != nil {
		t.Fatalf("a host that is not in the snapshot has no state: %+v", gone)
	}
}
