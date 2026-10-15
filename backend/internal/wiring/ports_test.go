package wiring

import (
	"encoding/json"
	"reflect"
	"testing"
)

func portConfig(entries map[string]any) map[string]any {
	return map[string]any{"ports": float64(4), "port_config": entries}
}

func TestValidatePortConfig(t *testing.T) {
	ok := portConfig(map[string]any{"eth1": map[string]any{"role": "dmz", "address": "172.16.0.1/30", "dhcp": true}})
	if err := ValidatePortConfig("router", ok, 4); err != nil {
		t.Errorf("valid DMZ port refused: %v", err)
	}
	if err := ValidatePortConfig("server", map[string]any{}, 4); err != nil {
		t.Errorf("no port_config refused: %v", err)
	}

	for name, entries := range map[string]map[string]any{
		"network address":   {"eth0": map[string]any{"address": "192.168.10.0/24"}},
		"broadcast address": {"eth0": map[string]any{"address": "192.168.10.255/24"}},
		"prefix too long":   {"eth0": map[string]any{"address": "10.0.0.1/31"}},
		"not an address":    {"eth0": map[string]any{"address": "lan"}},
		"unknown role":      {"eth0": map[string]any{"role": "x"}},
		"port too high":     {"eth9": map[string]any{"role": "lan"}},
		"odd handle":        {"port1": map[string]any{"role": "lan"}},
		"tagged on router":  {"eth0": map[string]any{"tagged_vlans": []any{float64(10)}}},
		"vlan out of range": {"eth0": map[string]any{"untagged_vlan": float64(5000)}},
		"dhcp not bool":     {"eth0": map[string]any{"dhcp": "yes"}},
		"long comment":      {"eth0": map[string]any{"comment": string(make([]byte, 81))}},
		"unknown key":       {"eth0": map[string]any{"speed": "10G"}},
	} {
		if err := ValidatePortConfig("router", portConfig(entries), 4); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}

	sw := map[string]any{
		"vlans":       []any{map[string]any{"id": float64(10), "name": "Lab"}, map[string]any{"id": float64(20), "name": "IoT"}},
		"port_config": map[string]any{"target-0": map[string]any{"untagged_vlan": float64(10), "tagged_vlans": []any{float64(20)}, "comment": "uplink"}},
	}
	if err := ValidatePortConfig("switch", sw, 8); err != nil {
		t.Errorf("valid switch port refused: %v", err)
	}
	for name, entry := range map[string]map[string]any{
		"undefined untagged": {"untagged_vlan": float64(30)},
		"undefined tagged":   {"tagged_vlans": []any{float64(30)}},
		"duplicate tagged":   {"tagged_vlans": []any{float64(10), float64(10)}},
		"role on switch":     {"role": "lan"},
		"address on switch":  {"address": "10.0.0.1/24"},
	} {
		sw["port_config"] = map[string]any{"eth0": entry}
		if err := ValidatePortConfig("switch", sw, 8); err == nil {
			t.Errorf("switch %s: accepted", name)
		}
	}
	if err := ValidatePortConfig("server", portConfig(map[string]any{}), 4); err == nil {
		t.Error("port settings on a server accepted")
	}
}

func TestValidateVLANs(t *testing.T) {
	good := map[string]any{"vlans": []any{
		map[string]any{"id": float64(10), "name": "Lab", "color": "#3b82f6", "subnet": "192.168.10.0/24"},
		map[string]any{"id": json.Number("20"), "name": "IoT"},
	}}
	if err := ValidateVLANs("switch", good); err != nil {
		t.Errorf("valid VLANs refused: %v", err)
	}
	if err := ValidateVLANs("router", good); err == nil {
		t.Error("VLANs on a router accepted")
	}
	for name, vlan := range map[string]map[string]any{
		"id zero":     {"id": float64(0), "name": "x"},
		"fraction":    {"id": 10.5, "name": "x"},
		"no name":     {"id": float64(10)},
		"blank name":  {"id": float64(10), "name": "  "},
		"long name":   {"id": float64(10), "name": "abcdefghijklmnopqrstuvwxyz0123456"},
		"bad colour":  {"id": float64(10), "name": "x", "color": "red"},
		"bad subnet":  {"id": float64(10), "name": "x", "subnet": "10.0.0.0/4"},
		"unknown key": {"id": float64(10), "name": "x", "tag": true},
	} {
		if err := ValidateVLANs("switch", map[string]any{"vlans": []any{vlan}}); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	twice := map[string]any{"vlans": []any{map[string]any{"id": 10, "name": "a"}, map[string]any{"id": 10, "name": "b"}}}
	if err := ValidateVLANs("switch", twice); err == nil {
		t.Error("duplicate VLAN id accepted")
	}
}

func TestIsIPv4CIDR(t *testing.T) {
	for text, want := range map[string]bool{
		"192.168.10.1/24": true, "10.0.0.1/8": true, "172.16.0.2/30": true,
		"172.16.0.3/30": false, "192.168.010.1/24": false, "192.168.10.1": false,
		"192.168.10.1/7": false, "192.168.10.1/024": false, "::1/64": false,
	} {
		if got := IsIPv4CIDR(text); got != want {
			t.Errorf("IsIPv4CIDR(%q) = %v", text, got)
		}
	}
	if !IsIPv4Subnet("192.168.10.0/24") || IsIPv4Subnet("192.168.10.0/31") {
		t.Error("IsIPv4Subnet")
	}
}

func TestPrunePortConfigAndVLANSet(t *testing.T) {
	details := portConfig(map[string]any{
		"target-0": map[string]any{"untagged_vlan": float64(5)},
		"eth1":     map[string]any{"untagged_vlan": float64(10), "tagged_vlans": []any{float64(30), float64(20), float64(10)}},
		"eth3":     map[string]any{"comment": "x"},
	})
	if got := VLANSet("switch", details, "eth1"); !reflect.DeepEqual(got, []int{10, 20, 30}) {
		t.Errorf("switch set = %v", got)
	}
	if got := VLANSet("router", details, "eth1"); !reflect.DeepEqual(got, []int{10}) {
		t.Errorf("router set = %v", got)
	}
	if VLANSet("server", details, "eth1") != nil || VLANSet("switch", details, "eth3") != nil || VLANSet("switch", details, "eth0") != nil {
		t.Error("ports without VLANs must give nil")
	}

	PrunePortConfig(details, 2)
	config := details["port_config"].(map[string]any)
	if _, ok := config["eth3"]; ok || len(config) != 2 {
		t.Errorf("pruned = %v", config)
	}
	delete(config, "eth1")
	delete(config, "target-0")
	config["eth2"] = map[string]any{"comment": "y"}
	PrunePortConfig(details, 2)
	if _, ok := details["port_config"]; ok {
		t.Error("an empty port_config must be removed")
	}
}

func TestPowerCounts(t *testing.T) {
	cases := []struct {
		nodeType     string
		details      map[string]any
		inputs, outs int
	}{
		{"server", nil, 1, 0},
		{"server", map[string]any{"psu_count": float64(9)}, 4, 0},
		{"server", map[string]any{"psu_count": "2"}, 2, 0},
		{"nas", map[string]any{"psu_count": float64(0)}, 0, 0},
		{"ups", nil, 1, 6},
		{"pdu", map[string]any{"outlets": float64(100)}, 1, 48},
		{"power_outlet", map[string]any{"psu_count": float64(2), "outlets": float64(0)}, 0, 1},
		{"rack", nil, 0, 0},
		{"disk", nil, 0, 0},
		{"vps", nil, 0, 0},
	}
	for _, c := range cases {
		if in, out := PowerInputCount(c.nodeType, c.details), PowerOutputCount(c.nodeType, c.details); in != c.inputs || out != c.outs {
			t.Errorf("%s %v: inputs %d outputs %d", c.nodeType, c.details, in, out)
		}
	}
	for handle, want := range map[string]int{"pwr-in-0": 0, "pwr-in-3": 3, "pwr-in-": -1, "pwr-in-01": -1, "pwr-in-x": -1, "eth0": -1, "pwr-out-2": -1} {
		if got := PowerHandleIndex(handle, PowerInPrefix); got != want {
			t.Errorf("PowerHandleIndex(%q) = %d", handle, got)
		}
	}
	if !IsPowerSource("power_outlet") || IsPowerSource("server") || DefaultRole("target-0") != "wan" || DefaultRole("eth0") != "lan" {
		t.Error("type helpers")
	}
}
