package wiring

import (
	"reflect"
	"testing"
)

func power(source string, out int, target string, in int) Edge {
	return Edge{Source: source, SourceHandle: PowerOutPrefix + itoa(out), Target: target, TargetHandle: PowerInPrefix + itoa(in), Type: EdgeTypePower}
}

func itoa(n int) string {
	return string(rune('0' + n))
}

func messages(issues []Issue) []string {
	out := []string{}
	for _, issue := range issues {
		out = append(out, issue.Message)
	}
	return out
}

// chain is outlet → UPS → PDU → server with both server PSUs on the PDU.
func chain() ([]Node, []Edge) {
	nodes := []Node{
		{ID: "o1", Name: "Outlet", Type: "power_outlet", Details: map[string]any{"breaker_amps": float64(16), "voltage": float64(230), "outlets": float64(2)}},
		{ID: "u", Name: "UPS", Type: "ups", Details: map[string]any{"capacity_w": float64(900), "outlets": float64(6)}, DrawW: 20},
		{ID: "p", Name: "PDU", Type: "pdu", Details: map[string]any{"amps": float64(10)}, DrawW: 5},
		{ID: "s", Name: "server", Type: "server", Details: map[string]any{"psu_count": float64(2)}, DrawW: 600},
	}
	edges := []Edge{power("o1", 0, "u", 0), power("u", 0, "p", 0), power("p", 0, "s", 0), power("p", 1, "s", 1)}
	return nodes, edges
}

func TestPowerLoads_Chain(t *testing.T) {
	nodes, edges := chain()
	loads := PowerLoads(nodes, edges)
	if got := loads["p"]; got.LoadW != 600 || got.SocketsUsed != 2 || got.Sockets != 8 || got.CapacityW == nil || *got.CapacityW != 2300 {
		t.Errorf("PDU = %+v", got)
	}
	if got := loads["u"]; got.LoadW != 605 || *got.CapacityW != 900 || got.Sockets != 6 {
		t.Errorf("UPS = %+v", got)
	}
	if got := loads["o1"]; got.LoadW != 625 || *got.CapacityW != 3680 || got.SocketsUsed != 1 || got.Sockets != 2 {
		t.Errorf("outlet = %+v", got)
	}
	if _, ok := loads["s"]; ok {
		t.Error("a server is not a power source")
	}
	want := []string{"Power supplies 1 and 2 of server both depend on PDU"}
	if got := messages(Warnings(nodes, edges)); !reflect.DeepEqual(got, want) {
		t.Errorf("warnings = %q", got)
	}
}

func TestPowerLoads_SecondOutlet(t *testing.T) {
	nodes, edges := chain()
	nodes = append(nodes, Node{ID: "o2", Name: "Outlet 2", Type: "power_outlet", Details: map[string]any{}})
	edges[3] = power("o2", 0, "s", 1)
	loads := PowerLoads(nodes, edges)
	if loads["p"].LoadW != 300 || loads["o2"].LoadW != 300 {
		t.Errorf("loads = %+v %+v", loads["p"], loads["o2"])
	}
	if got := Warnings(nodes, edges); len(got) != 0 {
		t.Errorf("warnings = %q", messages(got))
	}

	// Two outlets on the same breaker are still one dependency.
	nodes[0].Details["circuit"] = "c1"
	nodes[4].Details["circuit"] = "c1"
	want := []string{"Power supplies 1 and 2 of server both depend on circuit c1"}
	if got := messages(Warnings(nodes, edges)); !reflect.DeepEqual(got, want) {
		t.Errorf("warnings = %q", got)
	}
}

func TestWarnings_OverloadAndSockets(t *testing.T) {
	nodes := []Node{{ID: "u", Name: "UPS", Type: "ups", Details: map[string]any{"capacity_w": 900}}}
	var edges []Edge
	for i := range 6 {
		id := "d" + itoa(i)
		draw := 0.0
		if i == 0 {
			draw = 1150
		}
		nodes = append(nodes, Node{ID: id, Name: id, Type: "server", DrawW: draw})
		edges = append(edges, power("u", i, id, 0))
	}
	want := []string{"UPS is overloaded: 1150 W on 900 W", "All 6 sockets of UPS are in use"}
	got := Warnings(nodes, edges)
	if !reflect.DeepEqual(messages(got), want) || got[0].NodeID != "u" || got[1].NodeID != "u" {
		t.Errorf("warnings = %+v", got)
	}
}

func TestWarnings_PartlyPlugged(t *testing.T) {
	nodes := []Node{
		{ID: "u", Name: "UPS", Type: "ups", Details: map[string]any{}},
		{ID: "s", Name: "server", Type: "server", Details: map[string]any{"psu_count": float64(2)}, DrawW: 100},
		{ID: "n", Name: "nas", Type: "nas", Details: map[string]any{"psu_count": float64(2)}},
	}
	edges := []Edge{power("u", 0, "s", 1)}
	got := Warnings(nodes, edges)
	if !reflect.DeepEqual(messages(got), []string{"server has 2 power supplies and 1 plugged in"}) || got[0].NodeID != "s" {
		t.Errorf("warnings = %+v", got)
	}
	// One PSU plugged in carries the whole draw; the UPS capacity is unknown.
	if load := PowerLoads(nodes, edges)["u"]; load.LoadW != 100 || load.CapacityW != nil {
		t.Errorf("UPS = %+v", load)
	}
}

func TestCapacityAndChainVoltage(t *testing.T) {
	if got := CapacityW("ups", map[string]any{"capacity_va": float64(1500)}, 0); got != 900 {
		t.Errorf("UPS from VA = %v", got)
	}
	if got := CapacityW("ups", map[string]any{}, 0); got != 0 {
		t.Errorf("UPS unknown = %v", got)
	}
	if got := CapacityW("power_outlet", nil, 0); got != 16*230 {
		t.Errorf("outlet default = %v", got)
	}
	nodes := []Node{
		{ID: "o", Type: "power_outlet", Details: map[string]any{"voltage": float64(120), "breaker_amps": float64(15)}},
		{ID: "u", Type: "ups", Details: map[string]any{"psu_count": float64(2)}},
		{ID: "p", Type: "pdu", Details: map[string]any{"amps": float64(10)}},
		{ID: "q", Type: "pdu", Details: map[string]any{"amps": float64(10)}},
	}
	// The UPS hangs off the outlet through its second input only.
	edges := []Edge{power("o", 0, "u", 1), power("u", 0, "p", 0)}
	loads := PowerLoads(nodes, edges)
	if *loads["p"].CapacityW != 1200 || *loads["q"].CapacityW != 2300 || *loads["o"].CapacityW != 1800 {
		t.Errorf("capacities = %v %v %v", *loads["p"].CapacityW, *loads["q"].CapacityW, *loads["o"].CapacityW)
	}
}

func TestPowerLoads_LoopDoesNotHang(t *testing.T) {
	nodes := []Node{{ID: "a", Type: "ups", DrawW: 10}, {ID: "b", Type: "pdu", DrawW: 5}}
	edges := []Edge{power("a", 0, "b", 0), power("b", 0, "a", 0)}
	loads := PowerLoads(nodes, edges)
	if loads["a"].SocketsUsed != 1 || loads["b"].SocketsUsed != 1 {
		t.Errorf("loads = %+v", loads)
	}
	_ = Warnings(nodes, edges)
}

func vlanSwitch(id, name string, port map[string]any) Node {
	return Node{ID: id, Name: name, Type: "switch", Details: map[string]any{
		"vlans":       []any{map[string]any{"id": float64(10), "name": "Lab", "color": "#ff0000"}, map[string]any{"id": float64(20), "name": "IoT", "color": "#00ff00"}, map[string]any{"id": float64(30), "name": "Guest"}},
		"port_config": port,
	}}
}

func TestWarnings_VLANMismatch(t *testing.T) {
	nodes := []Node{
		vlanSwitch("a", "Core", map[string]any{"eth3": map[string]any{"untagged_vlan": float64(10)}}),
		vlanSwitch("b", "Edge", map[string]any{"eth0": map[string]any{"tagged_vlans": []any{float64(30), float64(20)}}}),
	}
	edges := []Edge{{Source: "a", SourceHandle: "eth3", Target: "b", TargetHandle: "eth0", Type: "ethernet"}}
	got := Warnings(nodes, edges)
	message := "No shared VLAN between Core eth3 (10) and Edge eth0 (20, 30)"
	if len(got) != 2 || got[0] != (Issue{"a", message}) || got[1] != (Issue{"b", message}) {
		t.Errorf("warnings = %+v", got)
	}

	// Wireless cables carry no VLAN check.
	edges[0].Type = "wireless"
	if got := Warnings(nodes, edges); len(got) != 0 {
		t.Errorf("wireless warnings = %+v", got)
	}

	nodes[1].Details["port_config"] = map[string]any{"eth0": map[string]any{"tagged_vlans": []any{float64(10), float64(20)}}}
	edges[0].Type = "ethernet"
	if got := Warnings(nodes, edges); len(got) != 0 {
		t.Errorf("shared VLAN warnings = %+v", got)
	}
}

func TestWarnings_UnusedPort(t *testing.T) {
	nodes := []Node{
		{ID: "r", Name: "Gateway", Type: "router", Details: map[string]any{"port_config": map[string]any{
			"eth0": map[string]any{"role": "unused"}, "eth1": map[string]any{"role": "unused"},
		}}},
		{ID: "s", Name: "Switch", Type: "switch", Details: map[string]any{}},
		{ID: "u", Name: "UPS", Type: "ups", Details: map[string]any{}},
	}
	edges := []Edge{
		{Source: "r", SourceHandle: "", Target: "s", TargetHandle: "", Type: "ethernet"},
		power("u", 0, "r", 0),
	}
	got := Warnings(nodes, edges)
	if len(got) != 1 || got[0] != (Issue{"r", "eth0 of Gateway is marked unused but carries a cable"}) {
		t.Errorf("warnings = %+v", got)
	}
}

func TestCableVLAN(t *testing.T) {
	core := vlanSwitch("a", "Core", map[string]any{
		"eth0": map[string]any{"untagged_vlan": float64(20), "tagged_vlans": []any{float64(10)}},
		"eth1": map[string]any{"untagged_vlan": float64(30), "tagged_vlans": []any{float64(20), float64(10)}},
	})
	router := map[string]any{"port_config": map[string]any{"eth2": map[string]any{"untagged_vlan": float64(10)}}}

	// The switch end's untagged VLAN wins when the cable carries it.
	vlans, color, mismatch := CableVLAN("switch", core.Details, "eth0", "server", nil, "")
	if !reflect.DeepEqual(vlans, []int{10, 20}) || color != "#00ff00" || mismatch {
		t.Errorf("untagged colour = %v %q %v", vlans, color, mismatch)
	}
	// An untagged VLAN without a colour falls back to the lowest coloured id.
	vlans, color, _ = CableVLAN("switch", core.Details, "eth1", "server", nil, "")
	if !reflect.DeepEqual(vlans, []int{10, 20, 30}) || color != "#ff0000" {
		t.Errorf("lowest colour = %v %q", vlans, color)
	}
	// Only the shared VLANs are shown; the router end is the source here.
	vlans, color, mismatch = CableVLAN("router", router, "eth2", "switch", core.Details, "eth0")
	if !reflect.DeepEqual(vlans, []int{10}) || color != "#ff0000" || mismatch {
		t.Errorf("shared = %v %q %v", vlans, color, mismatch)
	}
	// A router port only has an untagged VLAN; servers carry none.
	if vlans, color, mismatch := CableVLAN("server", nil, "eth0", "pc", nil, "target-0"); vlans != nil || color != "" || mismatch {
		t.Errorf("plain cable = %v %q %v", vlans, color, mismatch)
	}
	if _, _, mismatch := CableVLAN("router", router, "eth2", "switch", core.Details, "eth1"); mismatch {
		t.Error("VLAN 10 is tagged on eth1")
	}
	if vlans, _, mismatch := CableVLAN("router", router, "eth2", "switch", vlanSwitch("b", "B", map[string]any{"target-0": map[string]any{"untagged_vlan": float64(30)}}).Details, ""); !mismatch || vlans != nil {
		t.Errorf("mismatch = %v %v", vlans, mismatch)
	}
}
