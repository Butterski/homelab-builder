package core

import (
	"testing"

	"github.com/Butterski/hlbipam/internal/models"
)

func TestAllocate_RequiresRouter(t *testing.T) {
	req := models.AllocateRequest{
		Nodes: []models.NodeDTO{{ID: "server-1", Type: "server"}},
	}

	allocated := Allocate(req)
	if len(allocated.Conflicts) == 0 {
		t.Fatal("expected allocation conflict when topology has no router")
	}
	if Validate(req).Valid {
		t.Fatal("expected topology without a router to be invalid")
	}
}

func TestAllocate_DoesNotReportRouterAsUnreachable(t *testing.T) {
	req := models.AllocateRequest{
		Routers: []models.RouterDTO{{ID: "router", GatewayIP: "192.168.1.1"}},
		Nodes: []models.NodeDTO{
			{ID: "router", Type: "router"},
			{ID: "orphan-switch", Type: "switch"},
		},
	}

	resp := Allocate(req)
	foundOrphanWarning := false
	for _, warning := range resp.Warnings {
		if warning.NodeID == "router" {
			t.Fatalf("router must not be reported as unreachable: %v", warning)
		}
		if warning.NodeID == "orphan-switch" {
			foundOrphanWarning = true
		}
	}
	if !foundOrphanWarning {
		t.Fatal("expected a genuinely disconnected switch to remain warned")
	}
}

func TestAllocate_RoutersSharingSubnetShareReservations(t *testing.T) {
	req := models.AllocateRequest{
		Routers: []models.RouterDTO{
			{ID: "router-a", GatewayIP: "192.168.50.1", Subnet: "192.168.50.0/24"},
			{ID: "router-b", GatewayIP: "192.168.50.2", Subnet: "192.168.50.0/24"},
		},
		Nodes: []models.NodeDTO{
			{ID: "switch-a", Type: "switch", Connections: []string{"router-a"}},
			{ID: "switch-b", Type: "switch", Connections: []string{"router-b"}},
		},
	}

	resp := Allocate(req)
	first := findNodeIP(resp, "switch-a")
	second := findNodeIP(resp, "switch-b")
	if first == "" || second == "" {
		t.Fatalf("both switches need addresses, got %q and %q", first, second)
	}
	if first == second {
		t.Fatalf("routers sharing a subnet assigned duplicate IP %s", first)
	}
}

func TestAllocate_DuplicateExistingIPIsRepaired(t *testing.T) {
	req := models.AllocateRequest{
		Routers: []models.RouterDTO{{ID: "router", GatewayIP: "10.20.30.1", Subnet: "10.20.30.0/24"}},
		Nodes: []models.NodeDTO{
			{ID: "switch-a", Type: "switch", Connections: []string{"router"}, ExistingIP: "10.20.30.10"},
			{ID: "switch-b", Type: "switch", Connections: []string{"router"}, ExistingIP: "10.20.30.10"},
		},
	}

	resp := Allocate(req)
	if len(resp.Conflicts) == 0 {
		t.Fatal("expected a conflict for the duplicate existing address")
	}
	if findNodeIP(resp, "switch-a") != "10.20.30.10" {
		t.Fatal("the first valid reservation should be preserved")
	}
	if repaired := findNodeIP(resp, "switch-b"); repaired == "" || repaired == "10.20.30.10" {
		t.Fatalf("duplicate address was not repaired, got %q", repaired)
	}
}

func TestAllocate_InvalidExistingIPIsRepaired(t *testing.T) {
	req := models.AllocateRequest{
		Routers: []models.RouterDTO{{ID: "router", GatewayIP: "192.168.8.1", Subnet: "192.168.8.0/24"}},
		Nodes: []models.NodeDTO{
			{ID: "server", Type: "server", Connections: []string{"router"}, ExistingIP: "10.0.0.50"},
		},
	}

	resp := Allocate(req)
	if len(resp.Conflicts) == 0 {
		t.Fatal("expected wrong-subnet existing address to be reported")
	}
	if ip := findNodeIP(resp, "server"); ip == "" || ip == "10.0.0.50" {
		t.Fatalf("expected a safe replacement in the router subnet, got %q", ip)
	}
}

func TestValidate_VMAddressWithoutHostAddress(t *testing.T) {
	req := models.AllocateRequest{
		Routers: []models.RouterDTO{{ID: "router", GatewayIP: "192.168.4.1", Subnet: "192.168.4.0/24"}},
		Nodes: []models.NodeDTO{{
			ID:          "server",
			Type:        "server",
			Connections: []string{"router"},
			VMs:         []models.VMDTO{{ID: "vm", ExistingIP: "not-an-ip"}},
		}},
	}

	resp := Validate(req)
	if resp.Valid {
		t.Fatal("expected invalid VM address to be caught even when the host has no fixed IP")
	}
}

func TestSubnetAllocator_DHCPRangeDoesNotMaterializeEveryAddress(t *testing.T) {
	sa := NewSubnetAllocator("10.0.0.0/8", "10.0.0.1", true, 0)
	if got := len(sa.Used); got > 3 {
		t.Fatalf("expected constant-size reservation map for a large subnet, got %d entries", got)
	}
	if !sa.IsDHCPReserved(sa.DHCPStart) || !sa.IsDHCPReserved(sa.DHCPEnd) {
		t.Fatal("DHCP interval should still be enforced without materializing it")
	}
}

func TestAllocate_NeverAssignsBroadcastAddress(t *testing.T) {
	req := models.AllocateRequest{
		Routers: []models.RouterDTO{{ID: "router", GatewayIP: "192.168.90.1", Subnet: "192.168.90.0/30"}},
		Nodes: []models.NodeDTO{
			{ID: "switch-a", Type: "switch", Connections: []string{"router"}},
			{ID: "switch-b", Type: "switch", Connections: []string{"router"}},
		},
	}

	resp := Allocate(req)
	first := findNodeIP(resp, "switch-a")
	second := findNodeIP(resp, "switch-b")
	if first == "192.168.90.3" || second == "192.168.90.3" {
		t.Fatal("broadcast address was allocated")
	}
	if first != "192.168.90.2" || second != "" {
		t.Fatalf("expected the only usable host address then exhaustion, got %q and %q", first, second)
	}
}
