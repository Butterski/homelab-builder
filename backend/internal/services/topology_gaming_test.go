package services

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

// ─── Save path ───────────────────────────────────────────────────────────────

func TestValidateTopologyRules_GamingNodes(t *testing.T) {
	router := NodeDTO{ID: "router", Type: "router"}
	sw := NodeDTO{ID: "switch", Type: "switch"}
	sw2 := NodeDTO{ID: "switch-2", Type: "switch"}
	ap := NodeDTO{ID: "ap", Type: "access_point"}
	table := NodeDTO{ID: "table", Type: "lan_table", Name: "Table", Details: map[string]any{"seats": float64(8), "switch_ports": float64(16)}}
	console := NodeDTO{ID: "console", Type: "console", Name: "PS5"}
	deck := NodeDTO{ID: "deck", Type: "console", Name: "Deck"}
	pc := NodeDTO{ID: "pc", Type: "pc", Name: "PC"}
	rack := NodeDTO{ID: "rack", Type: "rack"}
	rackID := "rack"

	rejected := []struct {
		name  string
		nodes []NodeDTO
		edges []EdgeDTO
	}{
		{"table with two uplinks", []NodeDTO{sw, sw2, table}, []EdgeDTO{
			{Source: "switch", SourceHandle: "eth0", Target: "table", TargetHandle: "target-0"},
			{Source: "switch-2", SourceHandle: "eth0", Target: "table", TargetHandle: "eth0"},
		}},
		{"table on Wi-Fi", []NodeDTO{ap, table}, []EdgeDTO{{Source: "ap", Target: "table", Type: "wireless"}}},
		{"table straight to a PC", []NodeDTO{pc, table}, []EdgeDTO{{Source: "pc", Target: "table"}}},
		{"table in a rack", []NodeDTO{rack, {ID: "table", Type: "lan_table", ParentID: &rackID}}, nil},
		{"console in a rack", []NodeDTO{rack, {ID: "console", Type: "console", ParentID: &rackID}}, nil},
		{"table hosting a service", []NodeDTO{{ID: "table", Type: "lan_table", VMs: []VMDTO{{ID: "vm"}}}}, nil},
		{"console with a GPU", []NodeDTO{{ID: "console", Type: "console", InternalComponents: []ComponentDTO{{ID: "gpu", Type: "gpu"}}}}, nil},
		{"too many seats", []NodeDTO{{ID: "table", Type: "lan_table", Details: map[string]any{"seats": float64(40)}}}, nil},
		{"switch smaller than the seats", []NodeDTO{{ID: "table", Type: "lan_table", Details: map[string]any{"seats": float64(8), "switch_ports": float64(8)}}}, nil},
		{"seats on a switch", []NodeDTO{{ID: "switch", Type: "switch", Details: map[string]any{"seats": float64(8)}}}, nil},
		{"unknown console platform", []NodeDTO{{ID: "console", Type: "console", Details: map[string]any{"platform": "dreamcast"}}}, nil},
		{"cabled link to an access point for a client", []NodeDTO{ap, console}, []EdgeDTO{{Source: "ap", Target: "console", Type: "ethernet"}}},
		{"two PCs cabled together", []NodeDTO{pc, console}, []EdgeDTO{{Source: "pc", Target: "console"}}},
		{"client with two links on one port", []NodeDTO{sw, ap, console}, []EdgeDTO{
			{Source: "switch", SourceHandle: "eth0", Target: "console", TargetHandle: "target-0"},
			{Source: "ap", SourceHandle: "eth0", Target: "console", TargetHandle: "target-0", Type: "wireless"},
		}},
	}
	for _, test := range rejected {
		t.Run(test.name, func(t *testing.T) {
			if err := validateEdgeEndpoints(test.nodes, test.edges); !errors.Is(err, ErrInvalidTopology) {
				t.Fatalf("expected ErrInvalidTopology, got %v", err)
			}
		})
	}

	// A LAN party in one picture: a table and a console on the switch, and two
	// Wi-Fi clients sharing the access point's port with its own uplink.
	valid := []EdgeDTO{
		{Source: "router", SourceHandle: "eth0", Target: "switch", TargetHandle: "target-0"},
		{Source: "switch", SourceHandle: "eth0", Target: "table", TargetHandle: "target-0"},
		{Source: "switch", SourceHandle: "eth1", Target: "console", TargetHandle: "target-0"},
		{Source: "switch", SourceHandle: "eth2", Target: "ap", TargetHandle: "target-0", Type: "wireless"},
		{Source: "ap", SourceHandle: "eth0", Target: "deck", TargetHandle: "target-0", Type: "wireless"},
		{Source: "ap", SourceHandle: "eth0", Target: "pc", TargetHandle: "target-0", Type: "wireless"},
	}
	if err := validateEdgeEndpoints([]NodeDTO{router, sw, ap, table, console, deck, pc}, valid); err != nil {
		t.Fatalf("expected a valid LAN party topology, got %v", err)
	}
}

// ─── Proposal engine ─────────────────────────────────────────────────────────

func TestApplyOps_LanTableDefaultsAndPower(t *testing.T) {
	f := newOpsFixture()

	result := mustApply(t, f.base,
		TopologyOp{Op: "add_node", Ref: "t1", Type: "lan_table", Details: map[string]any{"seats": float64(6)}},
		TopologyOp{Op: "connect", Source: f.sw, Target: "t1"},
	)
	table := findNode(t, result.Input, result.Refs["t1"])
	if table.Name != "LAN Table" {
		t.Errorf("default name = %q", table.Name)
	}
	// 6 seats need 7 ports with the uplink; the next switch size sold is 8.
	if table.Details["seats"] != float64(6) || table.Details["switch_ports"] != float64(8) || table.Details["seat_watts"] != float64(350) || table.Details["switch_speed"] != "1 GbE" {
		t.Errorf("table defaults = %+v", table.Details)
	}
	if table.PowerDraw != 6*350+10 {
		t.Errorf("a full table draws every seat plus the switch, got %v", table.PowerDraw)
	}
	edge := findEdge(t, result.Input, f.sw, table.ID)
	if edge.Source != f.sw || edge.TargetHandle != TargetHandle || edge.Type != "ethernet" {
		t.Errorf("the switch should feed the table's uplink: %+v", edge)
	}

	// More seats resize the switch and the power figure together.
	grown := mustApply(t, result.Input, TopologyOp{Op: "update_node", Node: table.ID, Details: map[string]any{"seats": float64(12)}})
	bigger := findNode(t, grown.Input, table.ID)
	if bigger.Details["switch_ports"] != float64(16) || bigger.PowerDraw != 12*350+10 {
		t.Errorf("after growing to 12 seats: ports=%v power=%v", bigger.Details["switch_ports"], bigger.PowerDraw)
	}

	// A power figure the user set is kept.
	measured := mustApply(t, result.Input, TopologyOp{Op: "update_node", Node: table.ID, Details: map[string]any{"seat_watts": float64(500)}, PowerDraw: numPtr(1800)})
	if findNode(t, measured.Input, table.ID).PowerDraw != 1800 {
		t.Errorf("an explicit power draw must win")
	}

	explicit := mustApply(t, f.base, TopologyOp{Op: "add_node", Type: "lan_table", Details: map[string]any{"seats": float64(4), "switch_ports": float64(24), "switch_speed": "2.5 GbE"}})
	last := explicit.Input.Nodes[len(explicit.Input.Nodes)-1]
	if last.Details["switch_ports"] != float64(24) || last.Details["switch_speed"] != "2.5 GbE" {
		t.Errorf("explicit switch settings must be kept: %+v", last.Details)
	}
}

func TestApplyOps_LanTableRules(t *testing.T) {
	f := newOpsFixture()
	cases := []struct {
		name string
		ops  []TopologyOp
		want string
	}{
		{"too many seats", []TopologyOp{{Op: "add_node", Type: "lan_table", Details: map[string]any{"seats": float64(30)}}}, "whole number from 1 to 24"},
		{"switch too small", []TopologyOp{{Op: "add_node", Type: "lan_table", Details: map[string]any{"seats": float64(8), "switch_ports": float64(8)}}}, "at least 9 ports"},
		{"unknown switch speed", []TopologyOp{{Op: "add_node", Type: "lan_table", Details: map[string]any{"switch_speed": "40 GbE"}}}, "switch_speed"},
		{"seats on a server", []TopologyOp{{Op: "update_node", Node: f.server, Details: map[string]any{"seats": float64(4)}}}, "only applies to lan_table"},
		{"second uplink", []TopologyOp{
			{Op: "add_node", Ref: "t", Type: "lan_table"},
			{Op: "connect", Source: f.sw, Target: "t"},
			{Op: "connect", Source: f.router, Target: "t"},
		}, "already has its uplink"},
		{"wireless uplink", []TopologyOp{
			{Op: "add_node", Ref: "t", Type: "lan_table"},
			{Op: "connect", Source: f.sw, Target: "t", ConnectionType: strPtr("wireless")},
		}, "cabled uplink"},
		{"table to server", []TopologyOp{
			{Op: "add_node", Ref: "t", Type: "lan_table"},
			{Op: "add_node", Ref: "pc", Type: "pc"},
			{Op: "connect", Source: "pc", Target: "t"},
		}, "cannot be cabled directly"},
		{"service on a table", []TopologyOp{
			{Op: "add_node", Ref: "t", Type: "lan_table"},
			{Op: "add_vm", Host: "t", Name: strPtr("Minecraft")},
		}, "lan_table"},
		{"table in a rack", []TopologyOp{
			{Op: "add_node", Ref: "rack", Type: "rack"},
			{Op: "add_node", Type: "lan_table", Parent: strPtr("rack")},
		}, "cannot be mounted in a rack"},
		{"address for a table", []TopologyOp{{Op: "add_node", Type: "lan_table", IP: strPtr("192.168.1.60")}}, "do not get IP addresses"},
		{"writing the derived pool", []TopologyOp{{Op: "update_node", Node: f.router, Details: map[string]any{"dhcp_pool": "x"}}}, "managed by the builder"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if err := applyError(t, f.base, ApplyOptions{}, test.ops...); !strings.Contains(err.Message, test.want) {
				t.Fatalf("expected %q in %q", test.want, err.Message)
			}
		})
	}
}

func TestApplyOps_WifiAssociation(t *testing.T) {
	f := newOpsFixture()

	result := mustApply(t, f.base,
		TopologyOp{Op: "add_node", Ref: "ap", Type: "access_point", Details: map[string]any{"wifi_clients": float64(30)}},
		TopologyOp{Op: "connect", Source: f.sw, Target: "ap"},
		TopologyOp{Op: "add_node", Ref: "deck", Type: "console", Details: map[string]any{"platform": "Handheld"}},
		TopologyOp{Op: "add_node", Ref: "laptop", Type: "pc"},
		TopologyOp{Op: "connect", Source: "deck", Target: "ap"},
		TopologyOp{Op: "connect", Source: "ap", Target: "laptop"},
	)
	apID, deckID, laptopID := result.Refs["ap"], result.Refs["deck"], result.Refs["laptop"]

	deck := findNode(t, result.Input, deckID)
	if deck.Name != "Console" || deck.Details["platform"] != "handheld" {
		t.Errorf("console defaults = %q %+v", deck.Name, deck.Details)
	}
	for _, client := range []string{deckID, laptopID} {
		edge := findEdge(t, result.Input, apID, client)
		// Every client hangs off the access point's one port; its uplink keeps the top handle.
		if edge.Type != "wireless" || edge.Source != apID || edge.SourceHandle != "eth0" || edge.TargetHandle != TargetHandle {
			t.Errorf("Wi-Fi link to %s: %+v", client, edge)
		}
	}
	// What the engine builds must pass the same rules a save from the canvas does.
	if err := validateEdgeEndpoints(result.Input.Nodes, result.Input.Edges); err != nil {
		t.Fatalf("engine output rejected on save: %v", err)
	}
	if usage := NodePortUsage(result.Input)[apID]; len(usage.Used) != 0 {
		t.Errorf("Wi-Fi clients must not use up the access point's port: %+v", usage)
	}

	if err := applyError(t, result.Input, ApplyOptions{}, TopologyOp{Op: "update_connection", Source: apID, Target: deckID, ConnectionType: strPtr("ethernet")}); !strings.Contains(err.Message, "stays wireless") {
		t.Errorf("a Wi-Fi client cannot be recabled in place: %q", err.Message)
	}
	if err := applyError(t, f.base, ApplyOptions{},
		TopologyOp{Op: "add_node", Ref: "ap", Type: "access_point"},
		TopologyOp{Op: "add_node", Ref: "ps5", Type: "console"},
		TopologyOp{Op: "connect", Source: "ap", Target: "ps5", ConnectionType: strPtr("ethernet")},
	); !strings.Contains(err.Message, "over Wi-Fi") {
		t.Errorf("a cable to an access point is not how a client joins: %q", err.Message)
	}
	// Two clients still cannot be wired to each other.
	if err := applyError(t, f.base, ApplyOptions{},
		TopologyOp{Op: "add_node", Ref: "a", Type: "console"},
		TopologyOp{Op: "add_node", Ref: "b", Type: "pc"},
		TopologyOp{Op: "connect", Source: "a", Target: "b"},
	); !strings.Contains(err.Message, "cannot be cabled directly") {
		t.Errorf("unexpected message: %q", err.Message)
	}
	// A console is a leaf: no services, no components, no rack.
	if err := applyError(t, f.base, ApplyOptions{},
		TopologyOp{Op: "add_node", Ref: "ps5", Type: "console"},
		TopologyOp{Op: "add_vm", Host: "ps5", Name: strPtr("Plex")},
	); !strings.Contains(err.Message, "console") {
		t.Errorf("unexpected message: %q", err.Message)
	}
	if err := applyError(t, f.base, ApplyOptions{}, TopologyOp{Op: "update_node", Node: f.sw, Details: map[string]any{"wifi_clients": float64(5)}}); !strings.Contains(err.Message, "only applies to access_point") {
		t.Errorf("unexpected message: %q", err.Message)
	}
}

func TestDHCPClientsOf(t *testing.T) {
	if got := dhcpClientsOf("lan_table", map[string]any{"seats": float64(12)}); got != 12 {
		t.Errorf("table = %d", got)
	}
	if got := dhcpClientsOf("lan_table", map[string]any{}); got != defaultTableSeats {
		t.Errorf("a table without a seat count plans for the default, got %d", got)
	}
	if got := dhcpClientsOf("access_point", map[string]any{"wifi_clients": float64(30)}); got != 30 {
		t.Errorf("access point = %d", got)
	}
	if got := dhcpClientsOf("access_point", map[string]any{}); got != 0 {
		t.Errorf("an access point announces no clients by default, got %d", got)
	}
	if got := dhcpClientsOf("server_v2", map[string]any{"seats": float64(12)}); got != 0 {
		t.Errorf("other node types announce nothing, got %d", got)
	}
}

// ─── IPAM integration ────────────────────────────────────────────────────────

func nodeDetails(t *testing.T, node models.Node) map[string]any {
	t.Helper()
	details := map[string]any{}
	if err := json.Unmarshal(node.Details, &details); err != nil {
		t.Fatalf("details of %s: %v", node.Name, err)
	}
	return details
}

func TestIPService_PersistsDHCPPoolAndSkipsTables(t *testing.T) {
	if os.Getenv("IPAM_URL") == "" {
		t.Skip("skipping: IPAM_URL not set (hlbIPAM not running)")
	}
	tx := testTx(t)
	buildSvc := NewBuildService(tx)
	ipSvc := NewIPService(tx)
	user := models.User{Email: uuid.NewString() + "@party.test", GoogleID: uuid.NewString()}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	build, err := buildSvc.Create(user.ID, SyncGraphInput{Name: "Party", Kind: "lan_party"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	router, sw, ap, deck, server := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	input := SyncGraphInput{
		Name: "Party", Revision: build.Revision,
		Nodes: []NodeDTO{
			{ID: router, Type: "router", Name: "Router", IP: "192.168.1.1", Details: map[string]any{"dhcp_enabled": true, "ports": float64(4)}},
			{ID: sw, Type: "switch", Name: "Core", Details: map[string]any{"ports": float64(24)}},
			{ID: ap, Type: "access_point", Name: "AP", Details: map[string]any{"wifi_clients": float64(20)}},
			{ID: deck, Type: "console", Name: "Deck"},
			{ID: server, Type: "server_v2", Name: "Game host"},
		},
		Edges: []EdgeDTO{
			{Source: router, SourceHandle: "eth0", Target: sw, TargetHandle: TargetHandle},
			{Source: sw, SourceHandle: "eth0", Target: ap, TargetHandle: TargetHandle, Type: "wireless"},
			{Source: ap, SourceHandle: "eth0", Target: deck, TargetHandle: TargetHandle, Type: "wireless"},
			{Source: sw, SourceHandle: "eth1", Target: server, TargetHandle: TargetHandle},
		},
	}
	tableIDs := []string{}
	for i := 0; i < 8; i++ {
		id := uuid.NewString()
		tableIDs = append(tableIDs, id)
		input.Nodes = append(input.Nodes, NodeDTO{ID: id, Type: "lan_table", Name: "Table", Details: map[string]any{"seats": float64(8), "switch_ports": float64(16)}})
		input.Edges = append(input.Edges, EdgeDTO{Source: sw, SourceHandle: "eth" + string(rune('2'+i)), Target: id, TargetHandle: TargetHandle})
	}

	saved, err := buildSvc.UpdateAndCalculate(build.ID, user.ID, input, ipSvc)
	if err != nil {
		t.Fatalf("save and calculate: %v", err)
	}

	byID := map[string]models.Node{}
	for _, node := range saved.Nodes {
		byID[node.ID.String()] = node
	}
	// 64 seats and 20 Wi-Fi clients are 84 leases; with headroom that is 105 addresses.
	pool, ok := nodeDetails(t, byID[router])["dhcp_pool"].(map[string]any)
	if !ok {
		t.Fatalf("the router should show the pool hlbIPAM carved: %s", byID[router].Details)
	}
	if pool["clients"] != float64(84) || pool["size"] != float64(105) || pool["start"] != "192.168.1.50" || pool["end"] != "192.168.1.154" {
		t.Fatalf("pool = %+v", pool)
	}
	for _, id := range tableIDs {
		if byID[id].IP != "" {
			t.Fatalf("a LAN table must not get an address, got %q", byID[id].IP)
		}
	}
	if byID[deck].IP != "192.168.1.30" {
		t.Errorf("a console on the access point's Wi-Fi gets a console address, got %q", byID[deck].IP)
	}
	if byID[server].IP != "192.168.1.155" {
		t.Errorf("static hosts sit behind the grown pool, got %q", byID[server].IP)
	}

	// Turning DHCP off removes the pool instead of leaving a stale one behind.
	next, err := BuildToSyncInput(saved)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	for i := range next.Nodes {
		if next.Nodes[i].ID == router {
			next.Nodes[i].Details["dhcp_enabled"] = false
		}
	}
	off, err := buildSvc.UpdateAndCalculate(build.ID, user.ID, next, ipSvc)
	if err != nil {
		t.Fatalf("save with DHCP off: %v", err)
	}
	for _, node := range off.Nodes {
		if node.ID.String() == router {
			// No pool is left, only the count of devices still waiting for a lease.
			stale, _ := nodeDetails(t, node)["dhcp_pool"].(map[string]any)
			if stale["start"] != "" || stale["size"] != float64(0) || stale["clients"] != float64(84) {
				t.Fatalf("after DHCP was switched off the pool should be empty with 84 waiting: %s", node.Details)
			}
		}
	}
	validation, err := ipSvc.ValidateNetwork(build.ID)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if !strings.Contains(string(validation), "DHCP is off") {
		t.Fatalf("expected the validation report to say that DHCP is off, got %s", validation)
	}
}
