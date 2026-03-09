package core

import (
	"fmt"
	"testing"

	"github.com/Butterski/hlbipam/internal/models"
)

func TestAllocate_SingleRouterLinearTopology(t *testing.T) {
	req := models.AllocateRequest{
		Routers: []models.RouterDTO{
			{ID: "r1", GatewayIP: "192.168.1.1", Subnet: "192.168.1.0/24"},
		},
		Nodes: []models.NodeDTO{
			{ID: "sw1", Type: "switch", Connections: []string{"r1", "srv1", "pc1"}},
			{ID: "srv1", Type: "server", Connections: []string{"sw1"},
				VMs: []models.VMDTO{{ID: "vm1"}, {ID: "vm2"}}},
			{ID: "pc1", Type: "pc", Connections: []string{"sw1"}},
		},
	}

	resp := Allocate(req)

	assertIP(t, resp, "sw1", "192.168.1.10")
	// VMHostTypeOrder: nas, server, pc, minipc, sbc
	assertIP(t, resp, "srv1", "192.168.1.100")
	assertIP(t, resp, "pc1", "192.168.1.150")

	vmIPs := findVMIPs(resp, "srv1")
	if len(vmIPs) != 2 {
		t.Fatalf("expected 2 VM IPs, got %d", len(vmIPs))
	}
	if vmIPs[0] != "192.168.1.101" {
		t.Errorf("vm1 expected .101, got %s", vmIPs[0])
	}
	if vmIPs[1] != "192.168.1.102" {
		t.Errorf("vm2 expected .102, got %s", vmIPs[1])
	}

	if len(resp.Conflicts) != 0 {
		t.Errorf("unexpected conflicts: %v", resp.Conflicts)
	}
}

func TestAllocate_ExistingIPsPreserved(t *testing.T) {
	req := models.AllocateRequest{
		Routers: []models.RouterDTO{
			{ID: "r1", GatewayIP: "192.168.1.1"},
		},
		Nodes: []models.NodeDTO{
			{ID: "sw1", Type: "switch", Connections: []string{"r1", "srv1"}, ExistingIP: "192.168.1.15"},
			{ID: "srv1", Type: "server", Connections: []string{"sw1"}},
		},
	}

	resp := Allocate(req)
	assertIP(t, resp, "sw1", "192.168.1.15")
	assertIP(t, resp, "srv1", "192.168.1.100")
}

func TestAllocate_MultipleRoutersMultipleSubnets(t *testing.T) {
	req := models.AllocateRequest{
		Routers: []models.RouterDTO{
			{ID: "r1", GatewayIP: "192.168.1.1"},
			{ID: "r2", GatewayIP: "10.0.0.1"},
		},
		Nodes: []models.NodeDTO{
			{ID: "sw1", Type: "switch", Connections: []string{"r1"}},
			{ID: "sw2", Type: "switch", Connections: []string{"r2"}},
		},
	}

	resp := Allocate(req)

	ip1 := findNodeIP(resp, "sw1")
	ip2 := findNodeIP(resp, "sw2")

	if ip1 != "192.168.1.10" {
		t.Errorf("sw1 expected 192.168.1.10, got %s", ip1)
	}
	if ip2 != "10.0.0.10" {
		t.Errorf("sw2 expected 10.0.0.10, got %s", ip2)
	}
}

func TestAllocate_DHCPExclusionRange(t *testing.T) {
	req := models.AllocateRequest{
		Routers: []models.RouterDTO{
			{ID: "r1", GatewayIP: "192.168.1.1", DHCPEnabled: true},
		},
		Nodes: []models.NodeDTO{
			{ID: "ap1", Type: "access_point", Connections: []string{"r1"}},
			{ID: "nas1", Type: "nas", Connections: []string{"r1"}},
		},
	}

	resp := Allocate(req)

	if findNodeIP(resp, "ap1") != "192.168.1.20" {
		t.Errorf("ap1 expected .20, got %s", findNodeIP(resp, "ap1"))
	}
	if findNodeIP(resp, "nas1") != "192.168.1.136" {
		t.Errorf("nas1 expected .100, got %s", findNodeIP(resp, "nas1"))
	}
}

func TestAllocate_MultipleServersGetSeparateBlocks(t *testing.T) {
	req := models.AllocateRequest{
		Routers: []models.RouterDTO{
			{ID: "r1", GatewayIP: "192.168.1.1"},
		},
		Nodes: []models.NodeDTO{
			{ID: "sw1", Type: "switch", Connections: []string{"r1", "srv1", "srv2"}},
			{ID: "srv1", Type: "server", Connections: []string{"sw1"},
				VMs: []models.VMDTO{{ID: "vm1"}}},
			{ID: "srv2", Type: "server", Connections: []string{"sw1"},
				VMs: []models.VMDTO{{ID: "vm2"}}},
		},
	}

	resp := Allocate(req)
	ip1 := findNodeIP(resp, "srv1")
	ip2 := findNodeIP(resp, "srv2")

	if ip1 == ip2 {
		t.Fatalf("two servers got same IP: %s", ip1)
	}
	if ip1 == "" || ip2 == "" {
		t.Fatalf("servers must have IPs: srv1=%s, srv2=%s", ip1, ip2)
	}
}

func TestAllocate_NonNetworkTypesSkipped(t *testing.T) {
	req := models.AllocateRequest{
		Routers: []models.RouterDTO{
			{ID: "r1", GatewayIP: "192.168.1.1"},
		},
		Nodes: []models.NodeDTO{
			{ID: "gpu1", Type: "gpu", Connections: []string{"r1"}},
			{ID: "hba1", Type: "hba", Connections: []string{"r1"}},
		},
	}

	resp := Allocate(req)
	for _, n := range resp.Nodes {
		if n.AssignedIP != "" {
			t.Errorf("non-network device %s should not have IP, got %s", n.ID, n.AssignedIP)
		}
	}
}

func TestAllocate_DefaultGatewayAssigned(t *testing.T) {
	req := models.AllocateRequest{
		Routers: []models.RouterDTO{{ID: "r1"}},
		Nodes: []models.NodeDTO{
			{ID: "sw1", Type: "switch", Connections: []string{"r1"}},
		},
	}

	resp := Allocate(req)

	if resp.Routers[0].GatewayIP != "192.168.1.1" {
		t.Errorf("expected default gateway 192.168.1.1, got %s", resp.Routers[0].GatewayIP)
	}
	assertIP(t, resp, "sw1", "192.168.1.10")
}

// ── Helpers ──

func assertIP(t *testing.T, resp models.AllocateResponse, nodeID, expectedIP string) {
	t.Helper()
	ip := findNodeIP(resp, nodeID)
	if ip != expectedIP {
		t.Errorf("node %s: expected IP %s, got %s", nodeID, expectedIP, ip)
	}
}

func findNodeIP(resp models.AllocateResponse, nodeID string) string {
	for _, n := range resp.Nodes {
		if n.ID == nodeID {
			return n.AssignedIP
		}
	}
	return ""
}

func findVMIPs(resp models.AllocateResponse, hostID string) []string {
	for _, n := range resp.Nodes {
		if n.ID == hostID {
			ips := make([]string, len(n.VMs))
			for i, vm := range n.VMs {
				ips[i] = vm.AssignedIP
			}
			return ips
		}
	}
	return nil
}

func TestAllocate_24PortScale(t *testing.T) {
	req := models.AllocateRequest{
		Routers: []models.RouterDTO{
			{ID: "r1", GatewayIP: "192.168.1.1", DHCPEnabled: true}, // Uses 70 IPs (.30-.99)
		},
		Nodes: []models.NodeDTO{
			{ID: "sw1", Type: "switch", Connections: []string{"r1"}},
		},
	}

	for i := 1; i <= 24; i++ {
		srvID := fmt.Sprintf("srv%d", i)
		req.Nodes[0].Connections = append(req.Nodes[0].Connections, srvID) // Add to sw1
		req.Nodes = append(req.Nodes, models.NodeDTO{
			ID:          srvID,
			Type:        "server",
			Connections: []string{"sw1"},
			VMs:         []models.VMDTO{{ID: fmt.Sprintf("vm%d", i)}},
		})
	}

	resp := Allocate(req)

	if len(resp.Warnings) > 0 {
		t.Logf("Warnings generated in scale test: %v", resp.Warnings)
	}

	assignedSet := make(map[string]bool)
	hostCount := 0
	vmCount := 0

	for _, n := range resp.Nodes {
		if n.AssignedIP == "" {
			t.Errorf("node %s did not get an IP", n.ID)
		} else {
			t.Logf("Node %s got IP %s", n.ID, n.AssignedIP)
			if assignedSet[n.AssignedIP] {
				t.Errorf("duplicate IP assigned: %s on node %s", n.AssignedIP, n.ID)
			}
			assignedSet[n.AssignedIP] = true
			if n.Type == "server" {
				hostCount++
			}
		}

		for _, vm := range n.VMs {
			if vm.AssignedIP == "" {
				t.Errorf("vm %s under host %s did not get an IP", vm.ID, n.ID)
			} else {
				t.Logf("VM %s under host %s got IP %s", vm.ID, n.ID, vm.AssignedIP)
				if assignedSet[vm.AssignedIP] {
					t.Errorf("duplicate IP assigned to VM: %s on vm %s", vm.AssignedIP, vm.ID)
				}
				assignedSet[vm.AssignedIP] = true
				vmCount++
			}
		}
	}

	if hostCount != 24 {
		t.Errorf("expected 24 hosts allocated, got %d", hostCount)
	}
	if vmCount != 24 {
		t.Errorf("expected 24 VMs allocated, got %d", vmCount)
	}
}
