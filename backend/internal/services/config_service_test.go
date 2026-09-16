package services

import (
	"archive/zip"
	"bytes"
	"io"
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

func TestConfigService_GenerateCompleteExport(t *testing.T) {
	tx := testTx(t)
	buildSvc := NewBuildService(tx)
	configSvc := NewConfigService(tx)
	user := models.User{Email: uuid.NewString() + "@export.test", GoogleID: uuid.NewString()}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	build, err := buildSvc.Create(user.ID, SyncGraphInput{
		Name: "Export Lab",
		Nodes: []NodeDTO{
			{ID: "router", Type: "router", Name: "Router", IP: "192.168.1.1"},
			{ID: "server", Type: "server", Name: "Server", IP: "192.168.1.150", VMs: []VMDTO{
				{ID: "pihole", Type: "container", Name: "Pi-hole", IP: "192.168.1.151"},
				{ID: "unknown", Type: "container", Name: "Unverified Service", IP: "192.168.1.152"},
			}},
		},
		Edges: []EdgeDTO{{Source: "router", Target: "server"}},
	})
	if err != nil {
		t.Fatalf("create build: %v", err)
	}

	archive, filename, err := configSvc.GenerateCompleteExport(build.ID, user.ID)
	if err != nil {
		t.Fatalf("generate export: %v", err)
	}
	if filename != "export-lab-export.zip" {
		t.Fatalf("unexpected filename %q", filename)
	}
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	entries := make(map[string]string, len(reader.File))
	for _, file := range reader.File {
		stream, openErr := file.Open()
		if openErr != nil {
			t.Fatalf("open %s: %v", file.Name, openErr)
		}
		contents, readErr := io.ReadAll(stream)
		_ = stream.Close()
		if readErr != nil {
			t.Fatalf("read %s: %v", file.Name, readErr)
		}
		entries[file.Name] = string(contents)
	}
	for _, required := range []string{
		"manifest.json", "topology.json", "network/ip-plan.csv", "network/port-map.csv",
		"hardware/rack-plan.csv", "hardware/power-budget.csv", "hardware/shopping-list.csv",
		"deployment/docker-compose.yml", "deployment/.env.example", "implementation-checklist.md",
	} {
		if _, exists := entries[required]; !exists {
			t.Errorf("missing export entry %s", required)
		}
	}
	if strings.Contains(entries["deployment/docker-compose.yml"], "unverified-service") {
		t.Error("unverified service must not receive an invented image")
	}
	if !strings.Contains(entries["deployment/.env.example"], "WEBPASSWORD=CHANGE_ME_WEBPASSWORD") {
		t.Error("secret template is missing a CHANGE_ME placeholder")
	}
	if !strings.Contains(entries["manifest.json"], "no verified image metadata") {
		t.Error("manifest should explain why an unverified service was omitted")
	}
	if strings.Contains(entries["deployment/docker-compose.yml"], "changeme") {
		t.Error("Docker Compose must not contain a hard-coded default secret")
	}
	if !strings.Contains(entries["deployment/docker-compose.yml"], "WEBPASSWORD=${WEBPASSWORD}") {
		t.Error("Docker Compose must reference the explicit environment placeholder")
	}
	if !strings.Contains(entries["proxy/nginx.conf"], "CHANGE_ME_pi-hole_DOMAIN") {
		t.Error("Nginx config must expose an explicit domain placeholder")
	}
}
