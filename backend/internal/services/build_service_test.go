package services

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

func TestBuildService_Create(t *testing.T) {
	tx := testTx(t)
	svc := NewBuildService(tx)
	user := models.User{Email: uuid.NewString() + "@t.com", Name: "T", GoogleID: uuid.NewString()}
	tx.Create(&user)

	input := SyncGraphInput{
		Name: "My Build",
		Nodes: []NodeDTO{
			{ID: "n1", Type: "router", Name: "Router"},
		},
	}
	build, err := svc.Create(user.ID, input)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	loaded, err := svc.GetByID(build.ID)
	if err != nil {
		t.Fatalf("GetByID failed: %v", err)
	}

	if len(loaded.Nodes) != 1 {
		t.Fatalf("expected 1 node, got %d", len(loaded.Nodes))
	}
	if loaded.Nodes[0].Name != "Router" {
		t.Errorf("expected node name Router, got %s", loaded.Nodes[0].Name)
	}
}

func TestBuildService_Update(t *testing.T) {
	tx := testTx(t)
	svc := NewBuildService(tx)
	user := models.User{Email: uuid.NewString() + "@t.com"}
	tx.Create(&user)

	build, _ := svc.Create(user.ID, SyncGraphInput{Name: "B1", Nodes: []NodeDTO{{ID: "n1", Name: "A", Details: map[string]any{"model": "R1"}}}})

	_, err := svc.Update(build.ID, user.ID, SyncGraphInput{
		Name: "Updated",
		Nodes: []NodeDTO{
			{ID: build.Nodes[0].ID.String(), Name: "A-Updated", Details: map[string]any{"model": "R2"}}, // Keep ID
			{ID: "n2", Name: "B"}, // New
		},
	})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	loaded, _ := svc.GetByID(build.ID)
	if loaded.Name != "Updated" {
		t.Errorf("name not updated")
	}
	if len(loaded.Nodes) != 2 {
		t.Errorf("expected 2 nodes")
	}
	if loaded.Nodes[0].Name != "A-Updated" {
		t.Errorf("expected old node to be updated, got %s", loaded.Nodes[0].Name)
	}

	serialized, err := json.Marshal(loaded)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	if !strings.Contains(string(serialized), `"details":{"model":"R2"}`) {
		t.Fatalf("expected node details to serialize as object, got %s", string(serialized))
	}
}

func TestBuildService_Duplicate(t *testing.T) {
	tx := testTx(t)
	svc := NewBuildService(tx)
	user := models.User{Email: uuid.NewString() + "@t.com"}
	tx.Create(&user)

	build, _ := svc.Create(user.ID, SyncGraphInput{
		Name: "Original",
		Nodes: []NodeDTO{{
			ID:   "n1",
			Name: "R1",
			VMs:  []VMDTO{{ID: "v1", Name: "VM1"}},
		}},
	})

	dup, err := svc.Duplicate(build.ID, user.ID)
	if err != nil {
		t.Fatalf("Duplicate failed: %v", err)
	}

	if dup.Name != "Original (Copy)" {
		t.Errorf("expected copied name")
	}
	if dup.ID == build.ID {
		t.Errorf("duplicate has same ID")
	}
	if len(dup.Nodes) != 1 || dup.Nodes[0].ID == build.Nodes[0].ID {
		t.Errorf("nodes not cloned correctly")
	}
	if len(dup.Nodes[0].VirtualMachines) != 1 {
		t.Errorf("vms not cloned correctly")
	}
}

func TestBuildService_Delete(t *testing.T) {
	tx := testTx(t)
	svc := NewBuildService(tx)
	user := models.User{Email: uuid.NewString() + "@t.com"}
	tx.Create(&user)

	build, _ := svc.Create(user.ID, SyncGraphInput{Name: "Del"})
	err := svc.Delete(build.ID, user.ID)
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	_, err = svc.GetByID(build.ID)
	if err == nil {
		t.Errorf("expected error fetching deleted build")
	}
}

func TestBuildService_Update_InvalidEdgeReferenceRollsBack(t *testing.T) {
	tx := testTx(t)
	svc := NewBuildService(tx)
	user := models.User{Email: uuid.NewString() + "@t.com", Name: "Tester", GoogleID: uuid.NewString()}
	tx.Create(&user)

	initial, err := svc.Create(user.ID, SyncGraphInput{
		Name: "Original",
		Nodes: []NodeDTO{
			{ID: "router-1", Type: "router", Name: "Router"},
			{ID: "switch-1", Type: "switch", Name: "Switch"},
		},
		Edges: []EdgeDTO{{Source: "router-1", Target: "switch-1", Speed: "1 GbE"}},
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	_, err = svc.Update(initial.ID, user.ID, SyncGraphInput{
		Name: "Should Fail",
		Nodes: []NodeDTO{
			{ID: "router-1", Type: "router", Name: "Router Updated"},
		},
		Edges: []EdgeDTO{{Source: "router-1", Target: "missing-switch", Speed: "10 GbE"}},
	})
	if err == nil {
		t.Fatalf("expected validation error for invalid edge reference")
	}
	if !strings.Contains(err.Error(), "invalid edge references") {
		t.Fatalf("expected invalid edge references error, got: %v", err)
	}

	reloaded, err := svc.GetByID(initial.ID)
	if err != nil {
		t.Fatalf("GetByID failed: %v", err)
	}

	if reloaded.Name != "Original" {
		t.Fatalf("expected build name rollback to Original, got %q", reloaded.Name)
	}
	if len(reloaded.Nodes) != 2 {
		t.Fatalf("expected original nodes to remain, got %d", len(reloaded.Nodes))
	}
	if len(reloaded.Edges) != 1 {
		t.Fatalf("expected original edge to remain, got %d", len(reloaded.Edges))
	}
}

func TestBuildService_TotalPower(t *testing.T) {
	tx := testTx(t)
	svc := NewBuildService(tx)
	user := models.User{Email: uuid.NewString() + "@t.com", Name: "PowerTest", GoogleID: uuid.NewString()}
	tx.Create(&user)

	input := SyncGraphInput{
		Name: "Power Build",
		Nodes: []NodeDTO{
			{
				ID: "n1", Type: "server", Name: "Server 1", PowerDraw: 150.5,
				InternalComponents: []ComponentDTO{
					{ID: "c1", Type: "disk", Name: "HDD", PowerDraw: 10.0},
					{ID: "c2", Type: "gpu", Name: "GPU", PowerDraw: 250.0},
				},
			},
			{ID: "n2", Type: "switch", Name: "Switch 1", PowerDraw: 25.0},
		},
	}
	build, err := svc.Create(user.ID, input)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	loaded, err := svc.GetByID(build.ID)
	if err != nil {
		t.Fatalf("GetByID failed: %v", err)
	}

	expectedPower := 150.5 + 10.0 + 250.0 + 25.0
	if loaded.TotalPower != expectedPower {
		t.Errorf("expected TotalPower %f, got %f", expectedPower, loaded.TotalPower)
	}
}

func TestBuildService_Update_PowerDraw(t *testing.T) {
	tx := testTx(t)
	svc := NewBuildService(tx)
	user := models.User{Email: uuid.NewString() + "@t.com", Name: "UpdatePowerTest", GoogleID: uuid.NewString()}
	tx.Create(&user)

	// Initial Build
	build, _ := svc.Create(user.ID, SyncGraphInput{
		Name: "Power Update Build",
		Nodes: []NodeDTO{
			{ID: "n1", Type: "server", Name: "Server Initial", PowerDraw: 100.0},
		},
	})

	// Update Build with new node and new power
	updatedBuild, err := svc.Update(build.ID, user.ID, SyncGraphInput{
		Name: "Power Update Build",
		Nodes: []NodeDTO{
			{ID: "n1", Type: "server", Name: "Server Updated", PowerDraw: 150.0},
			{ID: "n2", Type: "switch", Name: "Switch New", PowerDraw: 40.0},
		},
	})

	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	// Fetch to confirm calculations
	loaded, err := svc.GetByID(updatedBuild.ID)
	if err != nil {
		t.Fatalf("GetByID failed: %v", err)
	}

	expectedPower := 150.0 + 40.0
	if loaded.TotalPower != expectedPower {
		t.Errorf("expected TotalPower %f after update, got %f", expectedPower, loaded.TotalPower)
	}
}

func TestBuildService_MultipleEmptyShareTokens(t *testing.T) {
	tx := testTx(t)
	svc := NewBuildService(tx)

	// Create user 1 and user 2
	user1 := models.User{Email: uuid.NewString() + "@t1.com", Name: "U1", GoogleID: uuid.NewString()}
	tx.Create(&user1)
	user2 := models.User{Email: uuid.NewString() + "@t2.com", Name: "U2", GoogleID: uuid.NewString()}
	tx.Create(&user2)

	// Create build 1 for user 1 (will have empty/nil ShareToken)
	build1, err := svc.Create(user1.ID, SyncGraphInput{
		Name:  "Project One",
		Nodes: []NodeDTO{{ID: uuid.NewString(), Type: "server", Name: "Server 1"}},
	})
	if err != nil {
		t.Fatalf("Create build1 failed: %v", err)
	}

	// Create build 2 for user 2 (will also have empty/nil ShareToken)
	build2, err := svc.Create(user2.ID, SyncGraphInput{
		Name:  "Project Two",
		Nodes: []NodeDTO{{ID: uuid.NewString(), Type: "server", Name: "Server 2"}},
	})
	if err != nil {
		t.Fatalf("Create build2 failed: %v", err)
	}

	// Update build 1 - this triggers tx.Save which previously crashed on empty string ShareToken index violation
	_, err = svc.Update(build1.ID, user1.ID, SyncGraphInput{
		Name:  "Project One Updated",
		Nodes: []NodeDTO{{ID: build1.Nodes[0].ID.String(), Type: "server", Name: "Server 1"}},
	})
	if err != nil {
		t.Fatalf("Update build1 failed: %v", err)
	}

	// Update build 2 - ensure it updates without errors too
	_, err = svc.Update(build2.ID, user2.ID, SyncGraphInput{
		Name:  "Project Two Updated",
		Nodes: []NodeDTO{{ID: build2.Nodes[0].ID.String(), Type: "server", Name: "Server 2"}},
	})
	if err != nil {
		t.Fatalf("Update build2 failed: %v", err)
	}

	// Verify both share tokens are nil in the DB
	var b1, b2 models.Build
	if err := tx.First(&b1, "id = ?", build1.ID).Error; err != nil {
		t.Fatalf("Fetch b1: %v", err)
	}
	if err := tx.First(&b2, "id = ?", build2.ID).Error; err != nil {
		t.Fatalf("Fetch b2: %v", err)
	}

	if b1.ShareToken != nil {
		t.Errorf("expected b1.ShareToken to be nil, got %q", *b1.ShareToken)
	}
	if b2.ShareToken != nil {
		t.Errorf("expected b2.ShareToken to be nil, got %q", *b2.ShareToken)
	}
}

func TestBuildService_RackNodeSaving(t *testing.T) {
	tx := testTx(t)
	svc := NewBuildService(tx)
	user := models.User{Email: uuid.NewString() + "@t.com", Name: "RackTest", GoogleID: uuid.NewString()}
	tx.Create(&user)

	rackID := uuid.NewString()
	serverID := uuid.NewString()

	// Create a build with a rack node and nested server node
	build, err := svc.Create(user.ID, SyncGraphInput{
		Name: "Rack Build",
		Nodes: []NodeDTO{
			{ID: rackID, Type: "rack", Name: "Main Rack", PowerDraw: 0},
			{ID: serverID, Type: "server", Name: "Server 1", ParentID: &rackID},
		},
	})
	if err != nil {
		t.Fatalf("Create build with rack failed: %v", err)
	}

	// Verify build was saved and preloaded
	loaded, err := svc.GetByID(build.ID)
	if err != nil {
		t.Fatalf("GetByID failed: %v", err)
	}

	if len(loaded.Nodes) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(loaded.Nodes))
	}

	var rackNode, serverNode *models.Node
	for i := range loaded.Nodes {
		if loaded.Nodes[i].Type == "rack" {
			rackNode = &loaded.Nodes[i]
		} else if loaded.Nodes[i].Type == "server" {
			serverNode = &loaded.Nodes[i]
		}
	}

	if rackNode == nil {
		t.Fatal("rack node was not saved")
	}
	if serverNode == nil {
		t.Fatal("server node was not saved")
	}

	if serverNode.ParentID == nil || *serverNode.ParentID != rackNode.ID {
		t.Errorf("server parent ID expected %s, got %v", rackNode.ID, serverNode.ParentID)
	}
}
