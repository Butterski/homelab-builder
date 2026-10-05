package services

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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

	build, _ := svc.Create(user.ID, SyncGraphInput{Name: "B1", Nodes: []NodeDTO{{ID: "n1", Type: "server", Name: "A", Details: map[string]any{"model": "R1"}}}})

	_, err := svc.Update(build.ID, user.ID, SyncGraphInput{
		Name:     "Updated",
		Revision: build.Revision,
		Nodes: []NodeDTO{
			{ID: build.Nodes[0].ID.String(), Type: "server", Name: "A-Updated", Details: map[string]any{"model": "R2"}}, // Keep ID
			{ID: "n2", Type: "server", Name: "B"}, // New
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
			Type: "server",
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

func TestBuildService_DeleteRemovesTopology(t *testing.T) {
	tx := testTx(t)
	svc := NewBuildService(tx)
	user := models.User{Email: uuid.NewString() + "@t.com", GoogleID: uuid.NewString()}
	tx.Create(&user)

	build, err := svc.Create(user.ID, SyncGraphInput{
		Name: "Del with nodes",
		Nodes: []NodeDTO{
			{ID: "router", Type: "router", Name: "Router"},
			{ID: "server", Type: "server_v2", Name: "Server",
				VMs:                []VMDTO{{ID: uuid.NewString(), Name: "VM", Type: "vm"}},
				InternalComponents: []ComponentDTO{{ID: uuid.NewString(), Type: "disk", Name: "Disk"}}},
		},
		Edges: []EdgeDTO{{Source: "router", SourceHandle: "eth0", Target: "server", TargetHandle: "target-0"}},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := svc.Delete(build.ID, uuid.New()); err == nil {
		t.Fatal("another user must not delete the build")
	}
	if err := svc.Delete(build.ID, user.ID); err != nil {
		t.Fatalf("deleting a build with nodes failed: %v", err)
	}
	var nodes, edges int64
	tx.Model(&models.Node{}).Where("build_id = ?", build.ID).Count(&nodes)
	tx.Model(&models.Edge{}).Where("build_id = ?", build.ID).Count(&edges)
	if nodes != 0 || edges != 0 {
		t.Fatalf("topology rows left behind: %d nodes, %d edges", nodes, edges)
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
		Name:     "Should Fail",
		Revision: initial.Revision,
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

func TestBuildService_PreservesConnectionMetadata(t *testing.T) {
	tx := testTx(t)
	svc := NewBuildService(tx)
	user := models.User{Email: uuid.NewString() + "@t.com", Name: "EdgeTest", GoogleID: uuid.NewString()}
	tx.Create(&user)

	build, err := svc.Create(user.ID, SyncGraphInput{
		Name: "Wireless Build",
		Nodes: []NodeDTO{
			{ID: "router-1", Type: "router", Name: "Router"},
			{ID: "ap-1", Type: "access_point", Name: "Access Point"},
		},
		Edges: []EdgeDTO{{
			Source:           "router-1",
			Target:           "ap-1",
			Type:             "wireless",
			Speed:            "1 GbE",
			WirelessStandard: "Wi-Fi 6",
			Direction:        "lan",
		}},
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	loaded, err := svc.GetByID(build.ID)
	if err != nil {
		t.Fatalf("GetByID failed: %v", err)
	}
	if len(loaded.Edges) != 1 {
		t.Fatalf("expected 1 edge, got %d", len(loaded.Edges))
	}
	edge := loaded.Edges[0]
	if edge.Type != "wireless" || edge.WirelessStandard != "Wi-Fi 6" || edge.Direction != "lan" {
		t.Fatalf("edge metadata was not preserved: %+v", edge)
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
		Name:     "Power Update Build",
		Revision: build.Revision,
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
		Name:     "Project One Updated",
		Revision: build1.Revision,
		Nodes:    []NodeDTO{{ID: build1.Nodes[0].ID.String(), Type: "server", Name: "Server 1"}},
	})
	if err != nil {
		t.Fatalf("Update build1 failed: %v", err)
	}

	// Update build 2 - ensure it updates without errors too
	_, err = svc.Update(build2.ID, user2.ID, SyncGraphInput{
		Name:     "Project Two Updated",
		Revision: build2.Revision,
		Nodes:    []NodeDTO{{ID: build2.Nodes[0].ID.String(), Type: "server", Name: "Server 2"}},
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

func TestValidateTopologyRules(t *testing.T) {
	router := NodeDTO{ID: "router", Type: "router"}
	switchOne := NodeDTO{ID: "switch-1", Type: "switch"}
	switchTwo := NodeDTO{ID: "switch-2", Type: "switch"}
	server := NodeDTO{ID: "server", Type: "server"}
	nas := NodeDTO{ID: "nas", Type: "nas"}

	tests := []struct {
		name  string
		nodes []NodeDTO
		edges []EdgeDTO
	}{
		{"self connection", []NodeDTO{router}, []EdgeDTO{{Source: "router", Target: "router"}}},
		{"duplicate pair", []NodeDTO{router, switchOne}, []EdgeDTO{{Source: "router", Target: "switch-1"}, {Source: "switch-1", Target: "router"}}},
		{"reused port", []NodeDTO{router, switchOne, switchTwo}, []EdgeDTO{{Source: "router", SourceHandle: "eth1", Target: "switch-1"}, {Source: "router", SourceHandle: "eth1", Target: "switch-2"}}},
		{"direct endpoint link", []NodeDTO{server, nas}, []EdgeDTO{{Source: "server", Target: "nas"}}},
		{"wireless without radio endpoint", []NodeDTO{router, switchOne}, []EdgeDTO{{Source: "router", Target: "switch-1", Type: "wireless"}}},
		{"unsupported node type", []NodeDTO{{ID: "unknown", Type: "banana"}}, nil},
		{"service on non-compute node", []NodeDTO{{ID: "switch", Type: "switch", VMs: []VMDTO{{ID: "service"}}}}, nil},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := validateEdgeEndpoints(test.nodes, test.edges); !errors.Is(err, ErrInvalidTopology) {
				t.Fatalf("expected ErrInvalidTopology, got %v", err)
			}
		})
	}

	validEdges := []EdgeDTO{
		{Source: "router", SourceHandle: "eth1", Target: "switch-1", TargetHandle: "eth0"},
		{Source: "switch-1", SourceHandle: "eth1", Target: "server", TargetHandle: "eth0"},
	}
	if err := validateEdgeEndpoints([]NodeDTO{router, switchOne, server}, validEdges); err != nil {
		t.Fatalf("expected valid topology, got %v", err)
	}
}

func TestBuildService_RenamePreservesTopologyAndRejectsStaleRevision(t *testing.T) {
	tx := testTx(t)
	svc := NewBuildService(tx)
	user := models.User{Email: uuid.NewString() + "@t.com", GoogleID: uuid.NewString()}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	build, err := svc.Create(user.ID, SyncGraphInput{
		Name:  "Before",
		Nodes: []NodeDTO{{ID: "router", Type: "router", Name: "Router"}},
	})
	if err != nil {
		t.Fatalf("create build: %v", err)
	}

	renamed, err := svc.Rename(build.ID, user.ID, "After", build.Revision)
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if renamed.Name != "After" || len(renamed.Nodes) != 1 || renamed.Revision != build.Revision+1 {
		t.Fatalf("rename changed unexpected state: name=%q nodes=%d revision=%d", renamed.Name, len(renamed.Nodes), renamed.Revision)
	}
	if _, err := svc.Rename(build.ID, user.ID, "Stale", build.Revision); !errors.Is(err, ErrBuildRevisionConflict) {
		t.Fatalf("expected revision conflict, got %v", err)
	}
}

func TestBuildService_UpdateAndCalculateRollsBackWhenIPAMFails(t *testing.T) {
	tx := testTx(t)
	buildSvc := NewBuildService(tx)
	user := models.User{Email: uuid.NewString() + "@atomic.test", GoogleID: uuid.NewString()}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	build, err := buildSvc.Create(user.ID, SyncGraphInput{Name: "Before"})
	if err != nil {
		t.Fatalf("create build: %v", err)
	}

	ipam := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "allocation unavailable", http.StatusServiceUnavailable)
	}))
	defer ipam.Close()
	ipService := &IPService{db: tx, client: ipam.Client(), ipamURL: ipam.URL}

	_, err = buildSvc.UpdateAndCalculate(build.ID, user.ID, SyncGraphInput{
		Name:     "Should Roll Back",
		Revision: build.Revision,
		Nodes:    []NodeDTO{{ID: "router", Type: "router", Name: "Router"}},
	}, ipService)
	if err == nil {
		t.Fatal("expected IPAM failure")
	}

	reloaded, err := buildSvc.GetByID(build.ID)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if reloaded.Name != "Before" || reloaded.Revision != build.Revision || len(reloaded.Nodes) != 0 {
		t.Fatalf("failed topology update was partially committed: name=%q revision=%d nodes=%d", reloaded.Name, reloaded.Revision, len(reloaded.Nodes))
	}
}
