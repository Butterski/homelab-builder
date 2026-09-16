package services

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

func virtualFixture() SyncGraphInput {
	vm1, vm2 := uuid.NewString(), uuid.NewString()
	host, router := uuid.NewString(), uuid.NewString()
	return SyncGraphInput{Name: "Virtual lab", Nodes: []NodeDTO{
		{ID: router, Type: "router", Name: "Router", IP: "192.168.1.1"},
		{ID: host, Type: "server", Name: "Hypervisor", Details: map[string]any{"virtual_network": map[string]any{
			"switches":  []map[string]any{{"id": "bridge", "name": "vmbr0", "x": 100, "y": 180}},
			"positions": map[string]any{vm1: map[string]any{"x": 250, "y": 320}},
			"edges":     []map[string]any{{"id": "up", "source": "uplink", "target": "bridge"}, {"id": "vm", "source": "bridge", "target": vm1}},
		}}, VMs: []VMDTO{{ID: vm1, Name: "Connected", Type: "vm", Status: "running"}, {ID: vm2, Name: "Isolated", Type: "vm", Status: "stopped", IP: "192.168.1.155"}}},
	}, Edges: []EdgeDTO{{Source: router, Target: host, Type: "ethernet"}}}
}

func TestVirtualNetworkSaveAndDuplicate(t *testing.T) {
	tx := testTx(t)
	user := models.User{Email: uuid.NewString() + "@test.local"}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	svc := NewBuildService(tx)
	input := virtualFixture()
	build, err := svc.Create(user.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	copy, err := svc.Duplicate(build.ID, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, candidate := range []*models.Build{build, copy} {
		for _, host := range candidate.Nodes {
			if host.Type != "server" {
				continue
			}
			network, err := readVirtualNetwork(host.Details)
			if err != nil || network == nil {
				t.Fatalf("missing saved network: %v", err)
			}
			var connectedID string
			for _, vm := range host.VirtualMachines {
				if vm.Name == "Connected" {
					connectedID = vm.ID.String()
				}
			}
			if !virtualReachable(network)[connectedID] {
				t.Fatal("VM connection lost during save or copy")
			}
			if network.Positions[connectedID].X != 250 {
				t.Fatal("VM position lost")
			}
			if candidate.ID == copy.ID && connectedID == input.Nodes[1].VMs[0].ID {
				t.Fatal("copy reused VM ID")
			}
		}
	}
}

func TestVirtualNetworkRejectsForeignEndpoints(t *testing.T) {
	input := virtualFixture()
	network := input.Nodes[1].Details["virtual_network"].(map[string]any)
	network["edges"] = []map[string]any{{"id": "foreign", "source": "uplink", "target": input.Nodes[0].ID}}
	if !errors.Is(validateVirtualNetworks(input.Nodes), ErrInvalidTopology) {
		t.Fatal("accepted a physical endpoint in a virtual network")
	}
}

func TestVirtualNetworkAutomaticIPsSurviveVMReordering(t *testing.T) {
	skipWithoutIPAM(t)
	tx := testTx(t)
	user := models.User{Email: uuid.NewString() + "@test.local"}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	svc := NewBuildService(tx)
	input := virtualFixture()
	network := input.Nodes[1].Details["virtual_network"].(map[string]any)
	network["edges"] = append(network["edges"].([]map[string]any), map[string]any{
		"id": "second-vm", "source": "bridge", "target": input.Nodes[1].VMs[1].ID,
	})
	build, err := svc.Create(user.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	ipam := NewIPService(tx)
	if err := ipam.CalculateNetwork(build.ID); err != nil {
		t.Fatal(err)
	}
	var before []models.VirtualMachine
	if err := tx.Where("node_id = ?", input.Nodes[1].ID).Find(&before).Error; err != nil {
		t.Fatal(err)
	}
	input.Revision = build.Revision
	input.Nodes[1].VMs[0], input.Nodes[1].VMs[1] = input.Nodes[1].VMs[1], input.Nodes[1].VMs[0]
	if _, err := svc.UpdateAndCalculate(build.ID, user.ID, input, ipam); err != nil {
		t.Fatal(err)
	}
	for _, previous := range before {
		var current models.VirtualMachine
		if err := tx.First(&current, "id = ?", previous.ID).Error; err != nil {
			t.Fatal(err)
		}
		if current.IP == "" || current.IP != previous.IP {
			t.Fatalf("VM address changed: %s -> %s", previous.IP, current.IP)
		}
	}
}

func TestVirtualNetworkDoesNotForwardThroughVM(t *testing.T) {
	var network virtualNetwork
	err := json.Unmarshal([]byte(`{"switches":[{"id":"isolated"}],"edges":[{"source":"uplink","target":"vm1"},{"source":"vm1","target":"isolated"},{"source":"isolated","target":"vm2"}]}`), &network)
	if err != nil {
		t.Fatal(err)
	}
	reached := virtualReachable(&network)
	if !reached["vm1"] || reached["vm2"] {
		t.Fatal("VM forwarded traffic")
	}
}

func TestVirtualNetworkAllocationAndDisconnect(t *testing.T) {
	skipWithoutIPAM(t)
	tx := testTx(t)
	user := models.User{Email: uuid.NewString() + "@test.local"}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	svc := NewBuildService(tx)
	input := virtualFixture()
	build, err := svc.Create(user.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	ipam := NewIPService(tx)
	if err := ipam.CalculateNetwork(build.ID); err != nil {
		t.Fatal(err)
	}
	var connected, isolated models.VirtualMachine
	if err := tx.First(&connected, "id = ?", input.Nodes[1].VMs[0].ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := tx.First(&isolated, "id = ?", input.Nodes[1].VMs[1].ID).Error; err != nil {
		t.Fatal(err)
	}
	if connected.IP == "" || isolated.IP != "" {
		t.Fatalf("connected=%q isolated=%q", connected.IP, isolated.IP)
	}
	input.Revision = build.Revision
	input.Nodes[1].VMs[0].Details = map[string]any{"static_ip": "192.168.1.220"}
	build, err = svc.UpdateAndCalculate(build.ID, user.ID, input, ipam)
	if err != nil {
		t.Fatal(err)
	}
	tx.First(&connected, "id = ?", connected.ID)
	if connected.IP != "192.168.1.220" {
		t.Fatalf("static IP not assigned: %s", connected.IP)
	}

	input.Revision = build.Revision
	input.Nodes[1].VMs[0].Details["static_ip"] = "192.168.1.1"
	if _, err := svc.UpdateAndCalculate(build.ID, user.ID, input, ipam); !errors.Is(err, ErrInvalidTopology) {
		t.Fatalf("accepted conflicting IP: %v", err)
	}
	unchanged, err := svc.GetByID(build.ID)
	if err != nil || unchanged.Revision != build.Revision {
		t.Fatal("invalid IP changed saved revision")
	}

	input.Nodes[1].VMs[0].Details["static_ip"] = ""
	input.Nodes[1].VMs[0].IP = connected.IP
	input.Nodes[1].Details["virtual_network"].(map[string]any)["edges"] = []any{}
	if _, err := svc.UpdateAndCalculate(build.ID, user.ID, input, ipam); err != nil {
		t.Fatal(err)
	}
	tx.First(&connected, "id = ?", connected.ID)
	if connected.IP != "" {
		t.Fatalf("disconnected VM retained IP: %s", connected.IP)
	}
}
