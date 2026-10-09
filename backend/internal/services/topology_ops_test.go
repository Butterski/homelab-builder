package services

import (
	"errors"
	"strings"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

// ─── Fixtures ────────────────────────────────────────────────────────────────

type opsFixture struct {
	router, sw, server string
	base               SyncGraphInput
}

// newOpsFixture is a saved build: router eth0 -> switch, switch eth0 -> server.
func newOpsFixture() opsFixture {
	f := opsFixture{router: uuid.NewString(), sw: uuid.NewString(), server: uuid.NewString()}
	f.base = SyncGraphInput{
		Name:     "Lab",
		Revision: 4,
		Settings: map[string]any{},
		Nodes: []NodeDTO{
			{ID: f.router, Type: "router", Name: "Edge Router", X: 80, Y: 80, IP: "192.168.1.1", Details: map[string]any{"ports": float64(4)}},
			{ID: f.sw, Type: "switch", Name: "Core Switch", X: 80, Y: 340, Details: map[string]any{"ports": float64(4)}},
			{ID: f.server, Type: "server_v2", Name: "PVE", X: 80, Y: 600, Details: map[string]any{"cpu": float64(8), "ram": float64(32)}},
		},
		Edges: []EdgeDTO{
			{Source: f.router, SourceHandle: "eth0", Target: f.sw, TargetHandle: TargetHandle, Type: "ethernet", Speed: "1 GbE", Direction: "auto"},
			{Source: f.sw, SourceHandle: "eth0", Target: f.server, TargetHandle: TargetHandle, Type: "ethernet", Speed: "1 GbE", Direction: "auto"},
		},
	}
	return f
}

func strPtr(value string) *string   { return &value }
func numPtr(value float64) *float64 { return &value }

func mustApply(t *testing.T, base SyncGraphInput, ops ...TopologyOp) *AppliedTopology {
	t.Helper()
	result, err := ApplyTopologyOps(base, ops, ApplyOptions{})
	if err != nil {
		t.Fatalf("ApplyTopologyOps: %v", err)
	}
	return result
}

func applyError(t *testing.T, base SyncGraphInput, opts ApplyOptions, ops ...TopologyOp) *OpError {
	t.Helper()
	_, err := ApplyTopologyOps(base, ops, opts)
	if err == nil {
		t.Fatal("expected the operations to be rejected")
	}
	var opErr *OpError
	if !errors.As(err, &opErr) {
		t.Fatalf("expected *OpError, got %T: %v", err, err)
	}
	if !errors.Is(err, ErrInvalidOperations) {
		t.Fatalf("OpError must unwrap to ErrInvalidOperations, got %v", err)
	}
	return opErr
}

func findNode(t *testing.T, input SyncGraphInput, id string) NodeDTO {
	t.Helper()
	for _, node := range input.Nodes {
		if node.ID == id {
			return node
		}
	}
	t.Fatalf("node %s not found", id)
	return NodeDTO{}
}

func findEdge(t *testing.T, input SyncGraphInput, a, b string) EdgeDTO {
	t.Helper()
	for _, edge := range input.Edges {
		if (edge.Source == a && edge.Target == b) || (edge.Source == b && edge.Target == a) {
			return edge
		}
	}
	t.Fatalf("edge %s<->%s not found", a, b)
	return EdgeDTO{}
}

type fakeCatalog struct {
	hardware map[uuid.UUID]*models.HardwareComponent
	services map[uuid.UUID]*models.Service
}

func (c fakeCatalog) HardwareByID(id uuid.UUID) (*models.HardwareComponent, error) {
	if item, ok := c.hardware[id]; ok {
		return item, nil
	}
	return nil, errors.New("not found")
}

func (c fakeCatalog) ServiceForUser(id, _ uuid.UUID) (*models.Service, error) {
	if item, ok := c.services[id]; ok {
		return item, nil
	}
	return nil, errors.New("not found")
}

// ─── Ports ───────────────────────────────────────────────────────────────────

// Vectors mirror frontend/src/features/builder/lib/port-count.test.ts.
func TestPortCountMatchesCanvas(t *testing.T) {
	parseCases := []struct {
		value any
		want  int
	}{
		{float64(8), 8}, {"24", 24}, {"4x GbE", 4}, {"8x GbE + 2x SFP+", 10},
		{"2× 10GbE RJ45", 2}, {"4 ports", 4},
	}
	for _, tc := range parseCases {
		got, ok := ParsePortCount(tc.value)
		if !ok || got != tc.want {
			t.Errorf("ParsePortCount(%v) = %d, %v; want %d", tc.value, got, ok, tc.want)
		}
	}
	for _, value := range []any{nil, "", "none", float64(0), float64(-2)} {
		if _, ok := ParsePortCount(value); ok {
			t.Errorf("ParsePortCount(%v) should not parse", value)
		}
	}

	countCases := []struct {
		nodeType string
		ports    any
		want     int
	}{
		{"router", "5x GbE + 1x SFP", 6}, {"server", float64(6), 6},
		{"router", nil, 4}, {"server", nil, 4}, {"ups", nil, 2}, {"modem", nil, 4}, {"vps", nil, 2},
		// Fixed-port types always render a single eth0, whatever details say.
		{"minipc", float64(8), 1}, {"nas", nil, 1}, {"access_point", nil, 1},
	}
	for _, tc := range countCases {
		details := map[string]any{}
		if tc.ports != nil {
			details["ports"] = tc.ports
		}
		if got := PortCount(tc.nodeType, details); got != tc.want {
			t.Errorf("PortCount(%s, %v) = %d, want %d", tc.nodeType, tc.ports, got, tc.want)
		}
	}

	if handles := ValidHandles("switch", map[string]any{"ports": float64(2)}); strings.Join(handles, ",") != "target-0,eth0,eth1" {
		t.Errorf("switch handles = %v", handles)
	}
	if handles := ValidHandles("rack", nil); len(handles) != 0 {
		t.Errorf("racks have no handles, got %v", handles)
	}
}

// ─── Nodes and refs ──────────────────────────────────────────────────────────

func TestApplyOps_RefsAutoHandlesAndLayout(t *testing.T) {
	f := newOpsFixture()
	result := mustApply(t, f.base,
		TopologyOp{Op: "add_node", Ref: "nas1", Type: "nas", Name: strPtr("Storage NAS"), Details: map[string]any{"storage": float64(8000)}},
		TopologyOp{Op: "connect", Source: f.sw, Target: "nas1"},
	)

	nasID := result.Refs["nas1"]
	if _, err := uuid.Parse(nasID); err != nil {
		t.Fatalf("new node must get a UUID, got %q", nasID)
	}
	nas := findNode(t, result.Input, nasID)
	if nas.Name != "Storage NAS" || nas.Type != "nas" {
		t.Fatalf("unexpected node: %+v", nas)
	}
	edge := findEdge(t, result.Input, f.sw, nasID)
	// eth0 on the switch already feeds the server, so the next free port is eth1.
	if edge.Source != f.sw || edge.SourceHandle != "eth1" || edge.Target != nasID || edge.TargetHandle != TargetHandle {
		t.Fatalf("unexpected cable: %+v", edge)
	}
	if edge.Type != "ethernet" || edge.Speed != "1 GbE" || edge.Direction != "auto" {
		t.Fatalf("unexpected cable defaults: %+v", edge)
	}

	// Auto layout: on the grid, and not on top of an existing card.
	if nas.X != snapToGrid(nas.X) || nas.Y != snapToGrid(nas.Y) {
		t.Fatalf("position must snap to the grid: %v,%v", nas.X, nas.Y)
	}
	for _, other := range result.Input.Nodes {
		if other.ID != nasID && nodeBox(other).overlaps(nodeBox(nas)) {
			t.Fatalf("NAS at %v,%v overlaps %s at %v,%v", nas.X, nas.Y, other.Name, other.X, other.Y)
		}
	}

	// The resolved operations carry the generated id, with refs replaced by
	// UUIDs, so they can be replayed on a newer revision. A position the server
	// chose is not part of them: it is chosen again on the canvas as it is then.
	added := result.Resolved[0]
	if added.ID != nasID {
		t.Fatalf("resolved add_node lost its id: %+v", added)
	}
	if added.X != nil || added.Y != nil {
		t.Fatalf("resolved add_node must not freeze an automatic position: %+v", added)
	}
	if result.Resolved[1].Target != nasID {
		t.Fatalf("resolved connect must reference the UUID, got %q", result.Resolved[1].Target)
	}

	replayed := mustApply(t, f.base, result.Resolved...)
	replayedNAS := findNode(t, replayed.Input, nasID)
	if replayedNAS.X != nas.X || replayedNAS.Y != nas.Y {
		t.Fatalf("replay moved the node: %v,%v vs %v,%v", replayedNAS.X, replayedNAS.Y, nas.X, nas.Y)
	}
	if got := findEdge(t, replayed.Input, f.sw, nasID); got != edge {
		t.Fatalf("replay changed the cable: %+v vs %+v", got, edge)
	}

	// The input passed in is never mutated.
	if len(f.base.Nodes) != 3 || len(f.base.Edges) != 2 {
		t.Fatal("ApplyTopologyOps mutated its input")
	}
}

// A proposal is applied on the build as it is at that moment. If the canvas was
// rearranged since the proposal was made, a new device goes where there is room
// now, next to what it is cabled to, not where there was room before.
func TestApplyOps_ReplayPlacesNewNodesOnTheCurrentCanvas(t *testing.T) {
	f := newOpsFixture()
	result := mustApply(t, f.base,
		TopologyOp{Op: "add_node", Ref: "nas1", Type: "nas", Name: strPtr("Storage NAS")},
		TopologyOp{Op: "connect", Source: f.sw, Target: "nas1"},
	)
	nasID := result.Refs["nas1"]
	before := findNode(t, result.Input, nasID)

	// Meanwhile the owner moved the switch and its server across the canvas and
	// put another device exactly where the NAS was going to be.
	rearranged, err := cloneSyncInput(f.base)
	if err != nil {
		t.Fatal(err)
	}
	for i := range rearranged.Nodes {
		if rearranged.Nodes[i].ID == f.sw || rearranged.Nodes[i].ID == f.server {
			rearranged.Nodes[i].X += 1200
		}
	}
	squatter := NodeDTO{ID: uuid.NewString(), Type: "pc", Name: "Desk PC", X: before.X, Y: before.Y, Details: map[string]any{}}
	rearranged.Nodes = append(rearranged.Nodes, squatter)

	replayed := mustApply(t, rearranged, result.Resolved...)
	after := findNode(t, replayed.Input, nasID)
	for _, other := range replayed.Input.Nodes {
		if other.ID != nasID && nodeBox(other).overlaps(nodeBox(after)) {
			t.Fatalf("NAS at %v,%v landed on %s at %v,%v", after.X, after.Y, other.Name, other.X, other.Y)
		}
	}
	sw := findNode(t, replayed.Input, f.sw)
	if after.X < sw.X-layoutNodeWidth || after.Y <= sw.Y {
		t.Fatalf("NAS at %v,%v did not follow its switch to %v,%v", after.X, after.Y, sw.X, sw.Y)
	}

	// An explicit position is the model's choice and stays.
	pinned := mustApply(t, f.base,
		TopologyOp{Op: "add_node", Ref: "pc1", Type: "pc", Name: strPtr("Pinned PC"), X: numPtr(905), Y: numPtr(415)},
	)
	if op := pinned.Resolved[0]; op.X == nil || op.Y == nil {
		t.Fatalf("an explicit position must stay in the resolved operation: %+v", op)
	}
	pc := findNode(t, mustApply(t, rearranged, pinned.Resolved...).Input, pinned.Refs["pc1"])
	if pc.X != snapToGrid(905) || pc.Y != snapToGrid(415) {
		t.Fatalf("explicit position changed on replay: %v,%v", pc.X, pc.Y)
	}
}

func TestApplyOps_OrientsCablesUpstreamToDownstream(t *testing.T) {
	f := newOpsFixture()
	// Asked for "mini PC -> switch"; the switch is upstream, so it becomes the source.
	result := mustApply(t, f.base,
		TopologyOp{Op: "add_node", Ref: "pc", Type: "minipc", Name: strPtr("NUC")},
		TopologyOp{Op: "connect", Source: "pc", Target: f.sw},
	)
	edge := findEdge(t, result.Input, f.sw, result.Refs["pc"])
	if edge.Source != f.sw || edge.SourceHandle != "eth1" || edge.TargetHandle != TargetHandle {
		t.Fatalf("expected switch(eth1) -> NUC(target-0), got %+v", edge)
	}
}

func TestApplyOps_ReversesCableWhenUpstreamPortsAreFull(t *testing.T) {
	f := newOpsFixture()
	f.base.Nodes[1].Details["ports"] = float64(1) // the switch's only port feeds the server
	result := mustApply(t, f.base,
		TopologyOp{Op: "add_node", Ref: "sw2", Type: "switch", Name: strPtr("Second Switch")},
		TopologyOp{Op: "disconnect", Source: f.router, Target: f.sw},
		TopologyOp{Op: "connect", Source: f.sw, Target: "sw2"},
	)
	edge := findEdge(t, result.Input, f.sw, result.Refs["sw2"])
	if edge.Source != result.Refs["sw2"] || edge.SourceHandle != "eth0" || edge.Target != f.sw || edge.TargetHandle != TargetHandle {
		t.Fatalf("expected the cable to be drawn from the new switch, got %+v", edge)
	}
}

func TestApplyOps_NoFreePortIsExplained(t *testing.T) {
	f := newOpsFixture()
	f.base.Nodes[1].Details["ports"] = float64(1)
	opErr := applyError(t, f.base, ApplyOptions{},
		TopologyOp{Op: "add_node", Ref: "nas1", Type: "nas"},
		TopologyOp{Op: "connect", Source: f.sw, Target: "nas1"},
	)
	if opErr.Index != 1 || opErr.Op != "connect" || !strings.Contains(opErr.Message, "no free port") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
}

func TestApplyOps_ExplicitHandlesAreValidated(t *testing.T) {
	f := newOpsFixture()
	add := TopologyOp{Op: "add_node", Ref: "nas1", Type: "nas"}

	result := mustApply(t, f.base, add, TopologyOp{Op: "connect", Source: f.sw, Target: "nas1", SourceHandle: "eth3"})
	if edge := findEdge(t, result.Input, f.sw, result.Refs["nas1"]); edge.SourceHandle != "eth3" || edge.TargetHandle != TargetHandle {
		t.Fatalf("explicit handle ignored: %+v", edge)
	}

	if opErr := applyError(t, f.base, ApplyOptions{}, add, TopologyOp{Op: "connect", Source: f.sw, Target: "nas1", SourceHandle: "eth9"}); !strings.Contains(opErr.Message, "has no port") {
		t.Fatalf("missing handle not reported: %+v", opErr)
	}
	if opErr := applyError(t, f.base, ApplyOptions{}, add, TopologyOp{Op: "connect", Source: f.sw, Target: "nas1", SourceHandle: "eth0"}); !strings.Contains(opErr.Message, "already carries a cable") {
		t.Fatalf("occupied handle not reported: %+v", opErr)
	}
}

func TestApplyOps_UnknownReferenceReportsOperationIndex(t *testing.T) {
	f := newOpsFixture()
	opErr := applyError(t, f.base, ApplyOptions{},
		TopologyOp{Op: "add_node", Ref: "nas1", Type: "nas"},
		TopologyOp{Op: "connect", Source: f.sw, Target: "nas2"},
	)
	if opErr.Index != 1 || !strings.Contains(opErr.Message, `"nas2"`) {
		t.Fatalf("unexpected error: %+v", opErr)
	}
	if !strings.HasPrefix(opErr.Error(), "operations[1] (connect):") {
		t.Fatalf("error text should point at the operation, got %q", opErr.Error())
	}

	missing := uuid.NewString()
	if opErr := applyError(t, f.base, ApplyOptions{}, TopologyOp{Op: "remove_node", Node: missing}); !strings.Contains(opErr.Message, "does not exist") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
	if opErr := applyError(t, f.base, ApplyOptions{}, TopologyOp{Op: "teleport"}); !strings.Contains(opErr.Message, "unknown op") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
}

func TestApplyOps_ResolvesUniqueNodeNames(t *testing.T) {
	f := newOpsFixture()
	result := mustApply(t, f.base, TopologyOp{Op: "update_node", Node: "core switch", Name: strPtr("Distribution Switch")})
	if got := findNode(t, result.Input, f.sw).Name; got != "Distribution Switch" {
		t.Fatalf("rename by name failed: %q", got)
	}

	f.base.Nodes[2].Name = "Core Switch" // now ambiguous
	if opErr := applyError(t, f.base, ApplyOptions{}, TopologyOp{Op: "remove_node", Node: "Core Switch"}); !strings.Contains(opErr.Message, "more than one") {
		t.Fatalf("ambiguous name not reported: %+v", opErr)
	}
}

func TestApplyOps_NodeTypeRules(t *testing.T) {
	f := newOpsFixture()
	if opErr := applyError(t, f.base, ApplyOptions{}, TopologyOp{Op: "add_node", Type: "disk"}); !strings.Contains(opErr.Message, "add_component") {
		t.Fatalf("components must be redirected to add_component: %+v", opErr)
	}
	if opErr := applyError(t, f.base, ApplyOptions{}, TopologyOp{Op: "add_node"}); !strings.Contains(opErr.Message, "type is required") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
	if opErr := applyError(t, f.base, ApplyOptions{}, TopologyOp{Op: "update_node", Node: f.sw, Type: "router"}); !strings.Contains(opErr.Message, "type cannot change") {
		t.Fatalf("unexpected error: %+v", opErr)
	}

	result := mustApply(t, f.base, TopologyOp{Op: "add_node", Type: "access_point"})
	if got := result.Input.Nodes[3].Name; got != "Access Point" {
		t.Fatalf("default name = %q", got)
	}
}

func TestApplyOps_DetailsMergePatchAndReservedKeys(t *testing.T) {
	f := newOpsFixture()
	result := mustApply(t, f.base, TopologyOp{Op: "update_node", Node: f.server, Details: map[string]any{
		"ram": float64(64), "cpu": nil, "nat_enabled": true, "network_zone": "DMZ", "notes": "rack B",
	}})
	details := findNode(t, result.Input, f.server).Details
	if details["ram"] != float64(64) || details["nat_enabled"] != true || details["network_zone"] != "dmz" || details["notes"] != "rack B" {
		t.Fatalf("patch not applied: %v", details)
	}
	if _, exists := details["cpu"]; exists {
		t.Fatalf("null must delete the key: %v", details)
	}

	rejected := []map[string]any{
		{"virtual_network": map[string]any{}},
		{"lan_gateway_ip": "10.0.0.1"},
		{"rack_position": float64(2)},
		{"blueprint_id": "x"},
		{"ram": "lots"},
		{"ports": float64(0)},
		{"ports": float64(2.5)},
		{"nat_enabled": "yes"},
		{"network_zone": "space"},
		{"public_ip": "999.1.1.1"},
		{"subnet_mask": "255.0.255.0"},
		{"rack_size": float64(12)}, // not a rack
		{"extra": []any{"nested"}},
	}
	for _, patch := range rejected {
		if opErr := applyError(t, f.base, ApplyOptions{}, TopologyOp{Op: "update_node", Node: f.server, Details: patch}); opErr.Index != 0 {
			t.Fatalf("patch %v: unexpected error %+v", patch, opErr)
		}
	}
}

func TestApplyOps_LoweringPortsBelowUsedPortIsRejected(t *testing.T) {
	f := newOpsFixture()
	f.base.Edges[1].SourceHandle = "eth3"
	opErr := applyError(t, f.base, ApplyOptions{}, TopologyOp{Op: "update_node", Node: f.sw, Details: map[string]any{"ports": float64(2)}})
	if !strings.Contains(opErr.Message, "eth3") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
	mustApply(t, f.base, TopologyOp{Op: "update_node", Node: f.sw, Details: map[string]any{"ports": float64(8)}})
}

func TestApplyOps_NodeIPRules(t *testing.T) {
	f := newOpsFixture()
	result := mustApply(t, f.base,
		TopologyOp{Op: "update_node", Node: f.router, IP: strPtr("10.0.0.1")},
		TopologyOp{Op: "update_node", Node: f.server, IP: strPtr("10.0.0.50")},
	)
	router := findNode(t, result.Input, f.router)
	if router.IP != "10.0.0.1" || router.Details["dhcp_locked"] != nil {
		t.Fatalf("router gateway not set cleanly: %+v", router)
	}
	server := findNode(t, result.Input, f.server)
	if server.IP != "10.0.0.50" || server.Details["dhcp_locked"] != true {
		t.Fatalf("static address must lock the device: %+v", server)
	}

	released := mustApply(t, result.Input, TopologyOp{Op: "update_node", Node: f.server, IP: strPtr("")})
	server = findNode(t, released.Input, f.server)
	if server.IP != "" || server.Details["dhcp_locked"] != nil {
		t.Fatalf("empty ip must release the address: %+v", server)
	}

	if opErr := applyError(t, f.base, ApplyOptions{}, TopologyOp{Op: "update_node", Node: f.server, IP: strPtr("not-an-ip")}); !strings.Contains(opErr.Message, "IPv4") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
	if opErr := applyError(t, f.base, ApplyOptions{}, TopologyOp{Op: "add_node", Type: "ups", IP: strPtr("10.0.0.9")}); !strings.Contains(opErr.Message, "do not get IP") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
}

func TestApplyOps_RemoveNodeDropsItsCables(t *testing.T) {
	f := newOpsFixture()
	result := mustApply(t, f.base, TopologyOp{Op: "remove_node", Node: f.sw})
	if len(result.Input.Nodes) != 2 || len(result.Input.Edges) != 0 {
		t.Fatalf("expected 2 nodes and no cables, got %d and %d", len(result.Input.Nodes), len(result.Input.Edges))
	}
}

// ─── Connections ─────────────────────────────────────────────────────────────

func TestApplyOps_ConnectionRules(t *testing.T) {
	f := newOpsFixture()
	addTwoPCs := []TopologyOp{
		{Op: "add_node", Ref: "a", Type: "minipc", Name: strPtr("A")},
		{Op: "add_node", Ref: "b", Type: "nas", Name: strPtr("B")},
	}

	cases := []struct {
		name string
		ops  []TopologyOp
		want string
	}{
		{"self", []TopologyOp{{Op: "connect", Source: f.sw, Target: f.sw}}, "itself"},
		{"duplicate pair", []TopologyOp{{Op: "connect", Source: f.sw, Target: f.router}}, "already connected"},
		{"needs a hub", append(addTwoPCs, TopologyOp{Op: "connect", Source: "a", Target: "b"}), "cannot be cabled directly"},
		{"wireless needs an AP", []TopologyOp{{Op: "add_node", Ref: "a", Type: "minipc"}, {Op: "connect", Source: f.sw, Target: "a", ConnectionType: strPtr("wireless")}}, "access point"},
		{"rack", []TopologyOp{{Op: "add_node", Ref: "r", Type: "rack"}, {Op: "connect", Source: f.sw, Target: "r"}}, "racks are enclosures"},
		{"bad type", []TopologyOp{{Op: "add_node", Ref: "a", Type: "minipc"}, {Op: "connect", Source: f.sw, Target: "a", ConnectionType: strPtr("fiber")}}, "connection_type must be one of"},
		{"bad direction", []TopologyOp{{Op: "update_connection", Source: f.sw, Target: f.router, Direction: strPtr("sideways")}}, "direction must be one of"},
		{"not connected", []TopologyOp{{Op: "disconnect", Source: f.router, Target: f.server}}, "are not connected"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			opErr := applyError(t, f.base, ApplyOptions{}, tc.ops...)
			if !strings.Contains(opErr.Message, tc.want) {
				t.Fatalf("want message containing %q, got %q", tc.want, opErr.Message)
			}
			if opErr.Index != len(tc.ops)-1 {
				t.Fatalf("error should point at the last operation, got index %d", opErr.Index)
			}
		})
	}
}

func TestApplyOps_NetworkLoopsFollowTheBuilderPreference(t *testing.T) {
	f := newOpsFixture()
	loop := TopologyOp{Op: "connect", Source: f.router, Target: f.server}
	if opErr := applyError(t, f.base, ApplyOptions{}, loop); !strings.Contains(opErr.Message, "network loop") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
	if _, err := ApplyTopologyOps(f.base, []TopologyOp{loop}, ApplyOptions{AllowLoops: true}); err != nil {
		t.Fatalf("loops must be allowed when the user ignores them: %v", err)
	}
	// A VPN overlay is not a physical loop.
	vpn := loop
	vpn.ConnectionType = strPtr("vpn")
	mustApply(t, f.base, vpn)
}

func TestApplyOps_AccessPointsDefaultToWireless(t *testing.T) {
	f := newOpsFixture()
	result := mustApply(t, f.base,
		TopologyOp{Op: "add_node", Ref: "ap", Type: "access_point"},
		TopologyOp{Op: "connect", Source: f.sw, Target: "ap"},
		TopologyOp{Op: "update_connection", Source: f.sw, Target: f.server, Speed: strPtr("10 GbE"), Direction: strPtr("LAN")},
	)
	edge := findEdge(t, result.Input, f.sw, result.Refs["ap"])
	if edge.Type != "wireless" || edge.WirelessStandard != "Wi-Fi 6" {
		t.Fatalf("unexpected AP link: %+v", edge)
	}
	updated := findEdge(t, result.Input, f.sw, f.server)
	if updated.Speed != "10 GbE" || updated.Direction != "lan" {
		t.Fatalf("update_connection not applied: %+v", updated)
	}
}

func TestApplyOps_UPSFeedsShareNetworkPorts(t *testing.T) {
	f := newOpsFixture()
	result := mustApply(t, f.base,
		TopologyOp{Op: "add_node", Ref: "ups", Type: "ups"},
		TopologyOp{Op: "connect", Source: f.server, Target: "ups"},
		TopologyOp{Op: "connect", Source: "ups", Target: f.sw},
		TopologyOp{Op: "connect", Source: "ups", Target: f.router},
	)
	upsID := result.Refs["ups"]
	toServer := findEdge(t, result.Input, upsID, f.server)
	// The server's top port already carries its uplink; power may share it.
	if toServer.Source != upsID || toServer.SourceHandle != "eth0" || toServer.TargetHandle != TargetHandle {
		t.Fatalf("unexpected power feed: %+v", toServer)
	}
	if got := findEdge(t, result.Input, upsID, f.sw).SourceHandle; got != "eth1" {
		t.Fatalf("second feed should use the next outlet, got %s", got)
	}
	if got := findEdge(t, result.Input, upsID, f.router).SourceHandle; got != "eth0" {
		t.Fatalf("outlets wrap around a 2-port UPS, got %s", got)
	}

	// A power feed never blocks a later network cable.
	mustApply(t, result.Input,
		TopologyOp{Op: "add_node", Ref: "nas", Type: "nas"},
		TopologyOp{Op: "connect", Source: f.sw, Target: "nas"},
	)
}

// ─── Racks ───────────────────────────────────────────────────────────────────

func TestApplyOps_RackMountingIsFirstFit(t *testing.T) {
	f := newOpsFixture()
	result := mustApply(t, f.base,
		TopologyOp{Op: "add_node", Ref: "rack", Type: "rack", Name: strPtr("Lab Rack"), Details: map[string]any{"rack_size": float64(6)}},
		TopologyOp{Op: "update_node", Node: f.server, Parent: strPtr("rack")},                            // 2U at slot 0
		TopologyOp{Op: "add_node", Ref: "nas", Type: "nas", Parent: strPtr("rack")},                      // 2U at slot 2
		TopologyOp{Op: "add_node", Ref: "pdu", Type: "pdu", Parent: strPtr("rack"), RackSlot: numPtr(5)}, // 1U pinned
	)
	rackID := result.Refs["rack"]

	server := findNode(t, result.Input, f.server)
	if server.ParentID == nil || *server.ParentID != rackID || server.X != 28 || server.Y != 40 || server.Details["rack_position"] != 0 {
		t.Fatalf("server not mounted at the top: %+v", server)
	}
	nas := findNode(t, result.Input, result.Refs["nas"])
	if nas.Y != 40+2*90 || nas.Details["rack_position"] != 2 {
		t.Fatalf("NAS should take the first gap (slot 2): %+v", nas)
	}
	if pdu := findNode(t, result.Input, result.Refs["pdu"]); pdu.Details["rack_position"] != 5 {
		t.Fatalf("pinned slot ignored: %+v", pdu)
	}

	// One free U is left (slot 4); a 2U device no longer fits.
	if opErr := applyError(t, result.Input, ApplyOptions{}, TopologyOp{Op: "add_node", Type: "router", Parent: strPtr(rackID)}); !strings.Contains(opErr.Message, "is full") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
	if opErr := applyError(t, result.Input, ApplyOptions{}, TopologyOp{Op: "add_node", Type: "switch", Parent: strPtr(rackID), RackSlot: numPtr(2)}); !strings.Contains(opErr.Message, "no room") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
	if opErr := applyError(t, result.Input, ApplyOptions{}, TopologyOp{Op: "update_node", Node: rackID, Details: map[string]any{"rack_size": float64(4)}}); !strings.Contains(opErr.Message, "cannot shrink") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
	if opErr := applyError(t, result.Input, ApplyOptions{}, TopologyOp{Op: "add_node", Type: "rack", Parent: strPtr(rackID)}); !strings.Contains(opErr.Message, "inside other racks") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
	if opErr := applyError(t, result.Input, ApplyOptions{}, TopologyOp{Op: "add_node", Type: "nas", Parent: strPtr(f.sw)}); !strings.Contains(opErr.Message, "not a rack") {
		t.Fatalf("unexpected error: %+v", opErr)
	}

	// Un-racking restores an absolute canvas position.
	rack := findNode(t, result.Input, rackID)
	unracked := mustApply(t, result.Input, TopologyOp{Op: "update_node", Node: f.server, Parent: strPtr("")})
	server = findNode(t, unracked.Input, f.server)
	if server.ParentID != nil || server.X != rack.X+28 || server.Y != rack.Y+40 {
		t.Fatalf("unexpected position after un-racking: %+v (rack at %v,%v)", server, rack.X, rack.Y)
	}
	if _, exists := server.Details["rack_position"]; exists {
		t.Fatal("rack_position must be cleared when a device leaves its rack")
	}

	// Removing a rack removes what is mounted in it, as on the canvas.
	removed := mustApply(t, result.Input, TopologyOp{Op: "remove_node", Node: rackID})
	if len(removed.Input.Nodes) != 2 {
		t.Fatalf("rack children should be removed, %d nodes left", len(removed.Input.Nodes))
	}
	if len(removed.Input.Edges) != 1 {
		t.Fatalf("cables to removed devices should go too, %d left", len(removed.Input.Edges))
	}
}

// ─── Virtual machines, services and components ───────────────────────────────

func TestApplyOps_VMRules(t *testing.T) {
	f := newOpsFixture()
	result := mustApply(t, f.base,
		TopologyOp{Op: "add_vm", Ref: "jf", Host: f.server, Name: strPtr("Jellyfin"), CPUCores: numPtr(2), RAMMB: numPtr(2048), StaticIP: strPtr("192.168.1.155")},
		TopologyOp{Op: "add_vm", Ref: "ha", Host: f.server, Name: strPtr("Home Assistant"), Type: "vm", OS: strPtr("HAOS"), Status: strPtr("stopped")},
		TopologyOp{Op: "update_vm", VM: "jf", RAMMB: numPtr(4096)},
		TopologyOp{Op: "remove_vm", VM: "Home Assistant"},
	)
	vms := findNode(t, result.Input, f.server).VMs
	if len(vms) != 1 {
		t.Fatalf("expected 1 VM, got %d", len(vms))
	}
	vm := vms[0]
	if vm.ID != result.Refs["jf"] || vm.Type != "container" || vm.Status != "running" || vm.RAMMB != 4096 || vm.CPUCores != 2 {
		t.Fatalf("unexpected VM: %+v", vm)
	}
	if vm.IP != "192.168.1.155" || vm.Details["static_ip"] != "192.168.1.155" {
		t.Fatalf("static address not requested: %+v", vm)
	}

	if opErr := applyError(t, f.base, ApplyOptions{}, TopologyOp{Op: "add_vm", Host: f.sw, Name: strPtr("x")}); !strings.Contains(opErr.Message, "cannot run VMs") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
	if opErr := applyError(t, f.base, ApplyOptions{}, TopologyOp{Op: "add_vm", Host: f.server}); !strings.Contains(opErr.Message, "name is required") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
	if opErr := applyError(t, f.base, ApplyOptions{}, TopologyOp{Op: "add_vm", Host: f.server, Name: strPtr("x"), Type: "jail"}); !strings.Contains(opErr.Message, "type must be one of") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
	if opErr := applyError(t, f.base, ApplyOptions{}, TopologyOp{Op: "add_vm", Host: f.server, Name: strPtr("x"), StaticIP: strPtr("nope")}); !strings.Contains(opErr.Message, "IPv4") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
}

func TestApplyOps_VMsAreWiredIntoVirtualNetworks(t *testing.T) {
	f := newOpsFixture()
	existingVM := uuid.NewString()
	f.base.Nodes[2].VMs = []VMDTO{{ID: existingVM, Name: "DNS", Type: "container", Status: "running", Details: map[string]any{}}}
	f.base.Nodes[2].Details["virtual_network"] = map[string]any{
		"switches":  []any{map[string]any{"id": "bridge-0", "name": "vmbr0", "x": float64(280), "y": float64(180)}},
		"positions": map[string]any{existingVM: map[string]any{"x": float64(10), "y": float64(20)}},
		"edges": []any{
			map[string]any{"id": "uplink-bridge", "source": "uplink", "target": "bridge-0"},
			map[string]any{"id": "bridge-" + existingVM, "source": "bridge-0", "target": existingVM},
		},
	}

	result := mustApply(t, f.base,
		TopologyOp{Op: "add_vm", Ref: "new", Host: f.server, Name: strPtr("Grafana")},
		TopologyOp{Op: "remove_vm", VM: existingVM},
	)
	network := findNode(t, result.Input, f.server).Details["virtual_network"].(map[string]any)
	edges := network["edges"].([]any)
	if len(edges) != 2 {
		t.Fatalf("expected uplink + the new guest, got %v", edges)
	}
	wired := edges[1].(map[string]any)
	if wired["source"] != "bridge-0" || wired["target"] != result.Refs["new"] || wired["id"] != "bridge-"+result.Refs["new"] {
		t.Fatalf("new guest not attached to the first virtual switch: %v", wired)
	}
	if positions := network["positions"].(map[string]any); len(positions) != 0 {
		t.Fatalf("removed guest left a position behind: %v", positions)
	}
	// The result must still satisfy the save-time virtual network validation.
	if err := validateVirtualNetworks(result.Input.Nodes); err != nil {
		t.Fatalf("virtual network invalid after ops: %v", err)
	}
}

func TestApplyOps_ComponentRules(t *testing.T) {
	f := newOpsFixture()
	result := mustApply(t, f.base,
		TopologyOp{Op: "add_component", Ref: "gpu", Node: f.server, Type: "gpu", Name: strPtr("Arc A380"), PowerDraw: numPtr(75)},
		TopologyOp{Op: "add_component", Ref: "cpu", Node: f.server, Type: "cpu", Name: strPtr("Xeon Silver"), Details: map[string]any{"cpu": float64(16)}},
		TopologyOp{Op: "add_component", Ref: "pcie", Node: f.server, Type: "pcie", Name: strPtr("10GbE NIC"), Details: map[string]any{"model": "PCIe 3.0 x8"}},
		TopologyOp{Op: "add_component", Ref: "disk", Node: f.server, Type: "disk", Name: strPtr("Exos 8TB"), Details: map[string]any{"storage": float64(8000)}},
		TopologyOp{Op: "remove_component", Component: "gpu"},
	)
	components := findNode(t, result.Input, f.server).InternalComponents
	if len(components) != 3 {
		t.Fatalf("unexpected components: %+v", components)
	}
	byID := make(map[string]ComponentDTO, len(components))
	for _, component := range components {
		byID[component.ID] = component
	}
	if cpu := byID[result.Refs["cpu"]]; cpu.Type != "cpu" || cpu.Name != "Xeon Silver" || cpu.Details["cpu"] != float64(16) {
		t.Errorf("CPU component was not retained: %+v", cpu)
	}
	if pcie := byID[result.Refs["pcie"]]; pcie.Type != "pcie" || pcie.Name != "10GbE NIC" || pcie.Details["model"] != "PCIe 3.0 x8" {
		t.Errorf("PCIe component was not retained: %+v", pcie)
	}
	if disk := byID[result.Refs["disk"]]; disk.Type != "disk" || disk.Details["storage"] != float64(8000) {
		t.Errorf("disk component changed while adding CPU: %+v", disk)
	}

	if opErr := applyError(t, f.base, ApplyOptions{}, TopologyOp{Op: "add_component", Node: f.sw, Type: "disk", Name: strPtr("x")}); !strings.Contains(opErr.Message, "cannot hold internal components") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
	if opErr := applyError(t, f.base, ApplyOptions{}, TopologyOp{Op: "add_component", Node: f.server, Type: "ram", Name: strPtr("x")}); !strings.Contains(opErr.Message, "unsupported component type") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
}

func TestApplyOps_CPUNodeAndRackSize(t *testing.T) {
	f := newOpsFixture()
	result := mustApply(t, f.base, TopologyOp{Op: "add_node", Ref: "cpu", Type: "cpu"})
	cpu := findNode(t, result.Input, result.Refs["cpu"])
	if cpu.Type != "cpu" || cpu.Name != "CPU" {
		t.Fatalf("unexpected CPU node: %+v", cpu)
	}
	if got := rackUnitsOf(NodeDTO{Type: "cpu", Details: map[string]any{}}); got != 1 {
		t.Fatalf("CPU default rack size = %dU, want 1U", got)
	}
}

func TestApplyOps_CatalogShortcuts(t *testing.T) {
	f := newOpsFixture()
	serverID, diskID, serviceID := uuid.New(), uuid.New(), uuid.New()
	catalog := fakeCatalog{
		hardware: map[uuid.UUID]*models.HardwareComponent{
			serverID: {ID: serverID, Category: "server", Brand: "Dell", Model: "R730", PriceEst: 450, Currency: "EUR",
				Spec: []byte(`{"cpu":"2x 14-core Xeon","ram":"128GB","storage":"2x 4TB","ports":"4x GbE + 2x SFP+","form_factor":"2U rack","tdp_w":180}`)},
			diskID: {ID: diskID, Category: "storage", Brand: "Seagate", Model: "Exos 8TB", PowerDraw: 9, Spec: []byte(`{"capacity":"8TB"}`)},
		},
		services: map[uuid.UUID]*models.Service{
			serviceID: {ID: serviceID, Name: "Jellyfin", Requirements: &models.ServiceRequirement{MinRAMMB: 1024, RecommendedRAMMB: 4096, MinCPUCores: 1, RecommendedCPUCores: 2}},
		},
	}
	opts := ApplyOptions{Catalog: catalog, UserID: uuid.New()}

	result, err := ApplyTopologyOps(f.base, []TopologyOp{
		{Op: "add_node", Ref: "r730", HardwareID: serverID.String()},
		{Op: "add_component", Node: "r730", HardwareID: diskID.String()},
		{Op: "add_vm", Host: "r730", CatalogServiceID: serviceID.String()},
	}, opts)
	if err != nil {
		t.Fatalf("catalog ops: %v", err)
	}
	node := findNode(t, result.Input, result.Refs["r730"])
	if node.Type != "server_v2" || node.Name != "Dell R730" || node.PowerDraw != 180 {
		t.Fatalf("unexpected catalog node: %+v", node)
	}
	want := map[string]any{"cpu": float64(28), "ram": float64(128), "storage": float64(8192), "ports": 6, "rack_units": 2, "model": "Dell R730", "price_est": float64(450), "currency": "EUR"}
	for key, value := range want {
		if node.Details[key] != value {
			t.Errorf("details.%s = %v (%T), want %v", key, node.Details[key], node.Details[key], value)
		}
	}
	if component := node.InternalComponents[0]; component.Type != "disk" || component.Name != "Seagate Exos 8TB" || component.PowerDraw != 9 || component.Details["storage"] != float64(8192) {
		t.Fatalf("unexpected catalog component: %+v", component)
	}
	vm := node.VMs[0]
	if vm.Name != "Jellyfin" || vm.RAMMB != 4096 || vm.CPUCores != 2 || vm.Details["catalog_service_id"] != serviceID.String() || vm.Type != "container" || vm.Status != "running" {
		t.Fatalf("unexpected catalog service: %+v", vm)
	}

	if opErr := applyError(t, f.base, opts, TopologyOp{Op: "add_node", HardwareID: diskID.String()}); !strings.Contains(opErr.Message, "add_component") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
	if opErr := applyError(t, f.base, opts, TopologyOp{Op: "add_component", Node: f.server, HardwareID: serverID.String()}); !strings.Contains(opErr.Message, "add_node") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
	if opErr := applyError(t, f.base, opts, TopologyOp{Op: "add_node", HardwareID: uuid.NewString()}); !strings.Contains(opErr.Message, "search_hardware") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
}

// ─── Batch limits ────────────────────────────────────────────────────────────

func TestApplyOps_BatchLimitsAndRename(t *testing.T) {
	f := newOpsFixture()
	if opErr := applyError(t, f.base, ApplyOptions{}); opErr.Index != -1 {
		t.Fatalf("empty batch: %+v", opErr)
	}
	tooMany := make([]TopologyOp, MaxTopologyOps+1)
	for i := range tooMany {
		tooMany[i] = TopologyOp{Op: "rename_build", Name: strPtr("x")}
	}
	if opErr := applyError(t, f.base, ApplyOptions{}, tooMany...); !strings.Contains(opErr.Message, "too many operations") {
		t.Fatalf("unexpected error: %+v", opErr)
	}
	if opErr := applyError(t, f.base, ApplyOptions{},
		TopologyOp{Op: "add_node", Ref: "dup", Type: "nas"},
		TopologyOp{Op: "add_node", Ref: "dup", Type: "nas"},
	); !strings.Contains(opErr.Message, "already used") {
		t.Fatalf("unexpected error: %+v", opErr)
	}

	result := mustApply(t, f.base, TopologyOp{Op: "rename_build", Name: strPtr("  Rack Lab  ")})
	if result.Input.Name != "Rack Lab" || result.Input.Revision != 4 {
		t.Fatalf("unexpected build header: %q rev %d", result.Input.Name, result.Input.Revision)
	}
}

func TestApplyOps_LayoutSpreadsUnconnectedNodes(t *testing.T) {
	result := mustApply(t, SyncGraphInput{Name: "Empty", Settings: map[string]any{}},
		TopologyOp{Op: "add_node", Ref: "r", Type: "router"},
		TopologyOp{Op: "add_node", Ref: "s", Type: "switch"},
		TopologyOp{Op: "add_node", Ref: "a", Type: "minipc"},
		TopologyOp{Op: "add_node", Ref: "b", Type: "nas"},
		TopologyOp{Op: "add_node", Ref: "rack", Type: "rack"},
		TopologyOp{Op: "connect", Source: "r", Target: "s"},
		TopologyOp{Op: "connect", Source: "s", Target: "a"},
		TopologyOp{Op: "connect", Source: "s", Target: "b"},
	)
	nodes := result.Input.Nodes
	for i := range nodes {
		for j := i + 1; j < len(nodes); j++ {
			if nodeBox(nodes[i]).overlaps(nodeBox(nodes[j])) {
				t.Fatalf("%s and %s overlap at %v,%v / %v,%v", nodes[i].Name, nodes[j].Name, nodes[i].X, nodes[i].Y, nodes[j].X, nodes[j].Y)
			}
		}
	}
	router, sw, pc := findNode(t, result.Input, result.Refs["r"]), findNode(t, result.Input, result.Refs["s"]), findNode(t, result.Input, result.Refs["a"])
	if !(router.Y < sw.Y && sw.Y < pc.Y) {
		t.Fatalf("downstream devices should sit below upstream ones: router %v, switch %v, pc %v", router.Y, sw.Y, pc.Y)
	}
}
