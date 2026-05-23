package services

import (
	"strings"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

func TestConfigService_GenerateDockerCompose_DuplicateKeys(t *testing.T) {
	tx := testTx(t)
	buildSvc := NewBuildService(tx)
	configSvc := NewConfigService(tx)

	user := models.User{Email: uuid.NewString() + "@t.com", Name: "Tester", GoogleID: uuid.NewString()}
	tx.Create(&user)

	// Create a build with multiple VMs of the same type (same name: Pi-hole)
	build, err := buildSvc.Create(user.ID, SyncGraphInput{
		Name: "Duplicate Services Build",
		Nodes: []NodeDTO{
			{
				ID:   uuid.NewString(),
				Type: "server",
				Name: "Server 1",
				VMs: []VMDTO{
					{ID: uuid.NewString(), Type: "container", Name: "Pi-hole"},
					{ID: uuid.NewString(), Type: "container", Name: "Pi-hole"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Create build failed: %v", err)
	}

	composeStr, err := configSvc.GenerateDockerCompose(build.ID)
	if err != nil {
		t.Fatalf("GenerateDockerCompose failed: %v", err)
	}

	// Verify both unique service keys exist in the generated YAML
	if !strings.Contains(composeStr, "  pi-hole:") {
		t.Errorf("expected service pi-hole key to exist in compose")
	}
	if !strings.Contains(composeStr, "  pi-hole_2:") {
		t.Errorf("expected uniquely suffixed service pi-hole_2 key to exist in compose")
	}

	// Verify container names are also unique
	if !strings.Contains(composeStr, "    container_name: pi-hole\n") {
		t.Errorf("expected container_name: pi-hole")
	}
	if !strings.Contains(composeStr, "    container_name: pi-hole_2\n") {
		t.Errorf("expected container_name: pi-hole_2")
	}
}

func TestConfigService_GenerateAll_Authorization(t *testing.T) {
	tx := testTx(t)
	buildSvc := NewBuildService(tx)
	configSvc := NewConfigService(tx)

	// User 1 owns the build
	user1 := models.User{Email: uuid.NewString() + "@u1.com", Name: "U1", GoogleID: uuid.NewString()}
	tx.Create(&user1)
	build, err := buildSvc.Create(user1.ID, SyncGraphInput{
		Name: "Private Build",
		Nodes: []NodeDTO{
			{ID: uuid.NewString(), Type: "server", Name: "S1", VMs: []VMDTO{{ID: uuid.NewString(), Type: "container", Name: "Pi-hole"}}},
		},
	})
	if err != nil {
		t.Fatalf("Create build failed: %v", err)
	}

	// User 2 tries to generate config
	user2 := models.User{Email: uuid.NewString() + "@u2.com", Name: "U2", GoogleID: uuid.NewString()}
	tx.Create(&user2)

	// Generate config with owner ID should succeed
	_, err = configSvc.GenerateAll(build.ID, user1.ID)
	if err != nil {
		t.Errorf("expected owner to succeed, got error: %v", err)
	}

	// Generate config with attacker ID should fail
	_, err = configSvc.GenerateAll(build.ID, user2.ID)
	if err == nil {
		t.Error("expected non-owner request to be rejected with error, but it succeeded")
	} else if !strings.Contains(err.Error(), "unauthorized") {
		t.Errorf("expected unauthorized error, got: %v", err)
	}
}
