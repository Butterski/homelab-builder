package core

import (
	"fmt"
	"strings"
	"testing"

	"github.com/Butterski/hlbipam/internal/models"
)

// partyTopology is a router, a core switch, one server and a row of LAN tables.
func partyTopology(subnet string, dhcp bool, tables, seats int) models.AllocateRequest {
	req := models.AllocateRequest{
		Routers: []models.RouterDTO{{ID: "r1", GatewayIP: "192.168.1.1", Subnet: subnet, DHCPEnabled: dhcp}},
		Nodes: []models.NodeDTO{
			{ID: "sw1", Type: "switch", Connections: []string{"r1", "srv1"}},
			{ID: "srv1", Type: "server_v2", Connections: []string{"sw1"}},
		},
	}
	for i := 0; i < tables; i++ {
		id := fmt.Sprintf("table%d", i+1)
		req.Nodes[0].Connections = append(req.Nodes[0].Connections, id)
		req.Nodes = append(req.Nodes, models.NodeDTO{ID: id, Type: "lan_table", Connections: []string{"sw1"}, DHCPClients: seats})
	}
	return req
}

func warningsFor(resp models.AllocateResponse, nodeID string) []string {
	var messages []string
	for _, warning := range resp.Warnings {
		if warning.NodeID == nodeID {
			messages = append(messages, warning.Message)
		}
	}
	return messages
}

func TestAllocate_ZeroDemandKeepsDefaultPool(t *testing.T) {
	resp := Allocate(partyTopology("192.168.1.0/24", true, 0, 0))

	router := resp.Routers[0]
	if router.DHCPStart != "192.168.1.50" || router.DHCPEnd != "192.168.1.135" || router.DHCPSize != 86 || router.DHCPClients != 0 {
		t.Fatalf("the default pool must not move for builds without lease demand, got %+v", router)
	}
	// The first static host still starts right after the default pool.
	assertIP(t, resp, "srv1", "192.168.1.136")
	if len(resp.Warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", resp.Warnings)
	}
}

func TestAllocate_DHCPDemandGrowsPool(t *testing.T) {
	// 10 tables of 8 seats: 80 leases plus a quarter of headroom is 100,
	// more than the 86 addresses of the default pool.
	resp := Allocate(partyTopology("192.168.1.0/24", true, 10, 8))

	router := resp.Routers[0]
	if router.DHCPClients != 80 {
		t.Fatalf("expected a demand of 80 leases, got %d", router.DHCPClients)
	}
	if router.DHCPStart != "192.168.1.50" || router.DHCPEnd != "192.168.1.149" || router.DHCPSize != 100 {
		t.Fatalf("expected the pool to grow to .50-.149, got %+v", router)
	}
	// Static hosts move up behind the larger pool instead of landing inside it.
	assertIP(t, resp, "srv1", "192.168.1.150")
	assertIP(t, resp, "sw1", "192.168.1.10")
	if len(resp.Warnings) != 0 || len(resp.Conflicts) != 0 {
		t.Fatalf("unexpected issues: %v %v", resp.Warnings, resp.Conflicts)
	}
}

func TestAllocate_SmallDemandFitsTheDefaultPool(t *testing.T) {
	resp := Allocate(partyTopology("192.168.1.0/24", true, 2, 8))
	router := resp.Routers[0]
	if router.DHCPSize != 86 || router.DHCPClients != 16 {
		t.Fatalf("16 leases fit the default pool, got %+v", router)
	}
}

func TestAllocate_LanTableGetsNoAddress(t *testing.T) {
	req := partyTopology("192.168.1.0/24", true, 2, 8)
	// A table that is not plugged in asks for nothing and is not an error here.
	req.Nodes = append(req.Nodes, models.NodeDTO{ID: "loose", Type: "lan_table", DHCPClients: 8})

	resp := Allocate(req)

	for _, id := range []string{"table1", "table2", "loose"} {
		if ip := findNodeIP(resp, id); ip != "" {
			t.Errorf("%s is a LAN table and must not get an address, got %s", id, ip)
		}
		if messages := warningsFor(resp, id); len(messages) != 0 {
			t.Errorf("%s: unexpected warnings %v", id, messages)
		}
	}
	if resp.Routers[0].DHCPClients != 16 {
		t.Errorf("only cabled tables count towards the demand, got %d", resp.Routers[0].DHCPClients)
	}
}

func TestAllocate_DemandTooLargeWarns(t *testing.T) {
	// 240 seats cannot get a lease each in a /24, whatever the pool size.
	resp := Allocate(partyTopology("192.168.1.0/24", true, 10, 24))

	messages := warningsFor(resp, "r1")
	if len(messages) != 1 || !strings.Contains(messages[0], "255.255.254.0") || !strings.Contains(messages[0], "240") {
		t.Fatalf("expected one warning that names the demand and a larger subnet, got %v (all: %v)", messages, resp.Warnings)
	}
	if resp.Routers[0].DHCPSize >= 240 {
		t.Fatalf("the pool cannot hold 240 leases in a /24, got %d", resp.Routers[0].DHCPSize)
	}
}

func TestAllocate_LargerSubnetHoldsABigParty(t *testing.T) {
	req := partyTopology("192.168.0.0/23", true, 10, 20)
	req.Routers[0].GatewayIP = "192.168.0.1"

	resp := Allocate(req)

	router := resp.Routers[0]
	// 200 leases plus headroom is 250 addresses, starting at .0.50.
	if router.DHCPStart != "192.168.0.50" || router.DHCPEnd != "192.168.1.43" || router.DHCPSize != 250 {
		t.Fatalf("expected a 250-address pool across the /23, got %+v", router)
	}
	if len(resp.Warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", resp.Warnings)
	}
	assertIP(t, resp, "srv1", "192.168.1.44")
}

func TestAllocate_DemandWithDHCPOffWarns(t *testing.T) {
	resp := Allocate(partyTopology("192.168.1.0/24", false, 2, 8))

	messages := warningsFor(resp, "r1")
	if len(messages) != 1 || !strings.Contains(messages[0], "DHCP is off") {
		t.Fatalf("expected a warning that DHCP is off, got %v", resp.Warnings)
	}
	if resp.Routers[0].DHCPStart != "" || resp.Routers[0].DHCPSize != 0 || resp.Routers[0].DHCPClients != 16 {
		t.Fatalf("no pool without DHCP, but the demand is still reported: %+v", resp.Routers[0])
	}
}

func TestAllocate_WifiClientsCountTowardsTheDemand(t *testing.T) {
	req := partyTopology("192.168.1.0/24", true, 8, 8)
	req.Nodes[0].Connections = append(req.Nodes[0].Connections, "ap1")
	req.Nodes = append(req.Nodes, models.NodeDTO{ID: "ap1", Type: "access_point", Connections: []string{"sw1"}, DHCPClients: 30})

	resp := Allocate(req)

	if resp.Routers[0].DHCPClients != 94 {
		t.Fatalf("expected 64 seats and 30 Wi-Fi clients, got %d", resp.Routers[0].DHCPClients)
	}
	// The access point itself keeps its fixed address.
	assertIP(t, resp, "ap1", "192.168.1.20")
}

func TestAllocate_ConsoleZone(t *testing.T) {
	req := models.AllocateRequest{
		Routers: []models.RouterDTO{{ID: "r1", GatewayIP: "192.168.1.1", DHCPEnabled: true}},
		Nodes: []models.NodeDTO{
			{ID: "sw1", Type: "switch", Connections: []string{"r1", "ps5", "ap1"}},
			{ID: "ps5", Type: "console", Connections: []string{"sw1"}},
			{ID: "ap1", Type: "access_point", Connections: []string{"sw1", "deck"}},
			// A handheld on the access point's Wi-Fi is reached through it.
			{ID: "deck", Type: "console", Connections: []string{"ap1"}},
		},
	}

	resp := Allocate(req)

	assertIP(t, resp, "ps5", "192.168.1.30")
	assertIP(t, resp, "deck", "192.168.1.31")
	if len(resp.Warnings) != 0 || len(resp.Conflicts) != 0 {
		t.Fatalf("unexpected issues: %v %v", resp.Warnings, resp.Conflicts)
	}
}
