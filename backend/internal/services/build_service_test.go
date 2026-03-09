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
			{ID: "n2", Name: "B"},                                                                     // New
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
