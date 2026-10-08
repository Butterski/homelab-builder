package inventory

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestNormalizeFillsDefaults(t *testing.T) {
	item, err := Item{Type: "minipc", Name: "  Lenovo M75q #1 "}.Normalize()
	if err != nil {
		t.Fatalf("Normalize: %v", err)
	}
	if item.Kind != KindDevice || item.Quantity != 1 || item.Status != StatusAvailable || item.Location != "other" {
		t.Fatalf("defaults not applied: %+v", item)
	}
	if item.Name != "Lenovo M75q #1" {
		t.Fatalf("name not trimmed: %q", item.Name)
	}
	if item.MacAddresses == nil {
		t.Fatal("mac_addresses must be a list, not null")
	}
}

func TestNormalizeRejectsWhatCannotBeStored(t *testing.T) {
	cases := map[string]Item{
		"unknown kind":         {Kind: "furniture", Type: "minipc", Name: "x"},
		"type of another kind": {Kind: KindComponent, Type: "minipc", Name: "x"},
		"no name":              {Type: "switch", Name: "   "},
		"two of a device":      {Type: "minipc", Name: "M920q", Quantity: 2},
		"unknown status":       {Type: "minipc", Name: "x", Status: "lost"},
		"unknown location":     {Type: "minipc", Name: "x", Location: "attic"},
		"bad mac":              {Type: "minipc", Name: "x", MacAddresses: []string{"not-a-mac"}},
		"more cores than threads": {Type: "minipc", Name: "x",
			Specs: Specs{CPUCores: 12, CPUThreads: 6}},
		"negative memory": {Type: "minipc", Name: "x", Specs: Specs{RAMGB: -4}},
		"a NUL in a name": {Type: "minipc", Name: "bad\x00name"},
		"endless notes":   {Type: "minipc", Name: "x", Notes: strings.Repeat("n", maxNotesLength+1)},
	}
	for name, item := range cases {
		if _, err := item.Normalize(); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: expected ErrInvalid, got %v", name, err)
		}
	}
}

func TestNormalizeWritesHardwareAddressesOneWay(t *testing.T) {
	item, err := Item{
		Type: "minipc", Name: "M75q",
		MacAddresses: []string{"aa-bb-cc-dd-ee-ff", " AA:BB:CC:DD:EE:FF ", "", "00:11:22:33:44:55"},
	}.Normalize()
	if err != nil {
		t.Fatalf("Normalize: %v", err)
	}
	want := []string{"00:11:22:33:44:55", "AA:BB:CC:DD:EE:FF"}
	if !reflect.DeepEqual(item.MacAddresses, want) {
		t.Fatalf("mac addresses = %v, want %v", item.MacAddresses, want)
	}
}

func TestComponentsAndAccessoriesComeInNumbers(t *testing.T) {
	ram, err := Item{Kind: KindComponent, Type: "ram", Name: "16 GB DDR4 SODIMM", Quantity: 2,
		Specs: Specs{RAMGB: 16, RAMType: "DDR4 SODIMM"}, Location: "drawer"}.Normalize()
	if err != nil || ram.Quantity != 2 {
		t.Fatalf("a kit of two modules: %+v, %v", ram, err)
	}
	if _, err := (Item{Kind: KindAccessory, Type: "dac", Name: "DAC 1 m", Quantity: 3}).Normalize(); err != nil {
		t.Fatalf("three cables: %v", err)
	}
}

func TestNodeDetailsDescribeTheMachine(t *testing.T) {
	item := Item{
		Kind: KindDevice, Type: "minipc", Name: "Lenovo M75q #1", Manufacturer: "Lenovo", Model: "ThinkCentre M75q",
		Specs: Specs{CPUModel: "Ryzen 5 PRO 4650GE", CPUCores: 6, CPUThreads: 12, RAMGB: 32, RAMType: "DDR4 SODIMM", StorageGB: 240},
	}
	details := item.NodeDetails("item-1")
	want := map[string]any{
		DetailItemID: "item-1", DetailLabel: "Lenovo M75q #1",
		"model": "Lenovo ThinkCentre M75q (Ryzen 5 PRO 4650GE)",
		// Guests are given threads, so that is what the canvas counts.
		"cpu": 12, "ram": 32.0, "ram_type": "DDR4 SODIMM", "storage": 240.0,
	}
	if !reflect.DeepEqual(details, want) {
		t.Fatalf("details = %#v\nwant      %#v", details, want)
	}

	sw := Item{Kind: KindDevice, Type: "switch", Name: "TP-Link SG108", Specs: Specs{Ports: 8, PortSpeed: "1 GbE"}}
	if got := sw.NodeDetails("s")["ports"]; got != 8 {
		t.Fatalf("a switch brings its ports: %v", got)
	}
	// Only cores are known: they are what the host offers.
	cores := Item{Type: "sbc", Name: "Pi", Specs: Specs{CPUCores: 4}}
	if got := cores.NodeDetails("p")["cpu"]; got != 4 {
		t.Fatalf("cores stand in for threads: %v", got)
	}
}

func TestEveryKindHasTypes(t *testing.T) {
	for _, kind := range []string{KindDevice, KindComponent, KindAccessory} {
		if len(typesByKind[kind]) == 0 {
			t.Errorf("%s has no types", kind)
		}
	}
}

func TestState(t *testing.T) {
	cases := []struct {
		name     string
		status   string
		quantity int
		planned  int
		deployed bool
		want     string
	}{
		{"nothing known", StatusAvailable, 1, 0, false, StatusAvailable},
		{"a planned machine", StatusAvailable, 1, 1, false, StatusInUse},
		{"the machine behind a host", StatusAvailable, 1, 0, true, StatusInUse},
		{"every module planned", StatusAvailable, 2, 2, false, StatusInUse},
		{"two of four modules planned", StatusAvailable, 4, 2, false, StatusAvailable},
		{"more planned than owned", StatusAvailable, 2, 3, false, StatusInUse},
		{"reserved for a plan", StatusReserved, 1, 1, false, StatusReserved},
		{"reserved, yet running", StatusReserved, 1, 0, true, StatusInUse},
		{"marked in use by hand", StatusInUse, 1, 0, false, StatusInUse},
		{"broken stays broken", StatusBroken, 1, 1, true, StatusBroken},
		{"sold stays sold", StatusSold, 1, 1, false, StatusSold},
		{"no status yet", "", 1, 0, false, StatusAvailable},
	}
	for _, c := range cases {
		if got := State(c.status, c.quantity, c.planned, c.deployed); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}
