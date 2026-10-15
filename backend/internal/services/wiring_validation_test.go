package services

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestSaveRefusesInvalidPortSettings(t *testing.T) {
	svc, user := newKindTestUser(t)
	router := func(portConfig map[string]any) SyncGraphInput {
		return SyncGraphInput{Name: "Ports", Nodes: []NodeDTO{{
			ID:   uuid.NewString(),
			Type: "router",
			Name: "Edge",
			Details: map[string]any{
				"ports":       4,
				"port_config": portConfig,
			},
		}}}
	}

	_, err := svc.Create(user.ID, router(map[string]any{"eth1": map[string]any{"role": "lan", "address": "192.168.10.0/24"}}))
	if !errors.Is(err, ErrInvalidTopology) {
		t.Fatalf("expected ErrInvalidTopology for a network address, got %v", err)
	}

	if _, err := svc.Create(user.ID, router(map[string]any{"eth1": map[string]any{"role": "lan", "address": "192.168.10.1/24", "dhcp": true}})); err != nil {
		t.Fatalf("a valid port address was refused: %v", err)
	}
}

func TestSaveRefusesUndefinedSwitchVLAN(t *testing.T) {
	svc, user := newKindTestUser(t)
	input := SyncGraphInput{Name: "VLANs", Nodes: []NodeDTO{{
		ID:   uuid.NewString(),
		Type: "switch",
		Name: "Core",
		Details: map[string]any{
			"ports":       8,
			"vlans":       []any{map[string]any{"id": 10, "name": "Users"}},
			"port_config": map[string]any{"eth0": map[string]any{"untagged_vlan": 20}},
		},
	}}}
	if _, err := svc.Create(user.ID, input); !errors.Is(err, ErrInvalidTopology) {
		t.Fatalf("expected ErrInvalidTopology for an undefined VLAN, got %v", err)
	}
}
