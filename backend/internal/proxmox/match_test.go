package proxmox

import "testing"

func TestCPUKey(t *testing.T) {
	same := [][]string{
		{"AMD Ryzen 5 PRO 4650GE with Radeon Graphics", "Ryzen 5 PRO 4650GE", "Ryzen 4650GE", "ryzen 5 pro 4650ge"},
		{"Intel(R) Core(TM) i5-9500T CPU @ 2.20GHz", "i5-9500T", "Intel Core i5 9500T"},
		{"Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz", "2× Xeon E5-2680v4", "Xeon E5-2680 v4"},
		{"12th Gen Intel(R) Core(TM) i5-12500T", "i5-12500T"},
		{"AMD EPYC 7302P 16-Core Processor", "EPYC 7302P"},
		{"Intel(R) N100", "Intel N100", "N100"},
	}
	for _, group := range same {
		want := cpuKey(group[0])
		if want == "" {
			t.Errorf("no key for %q", group[0])
		}
		for _, model := range group[1:] {
			if got := cpuKey(model); got != want {
				t.Errorf("cpuKey(%q) = %q, but cpuKey(%q) = %q", model, got, group[0], want)
			}
		}
	}
	different := [][2]string{
		{"Ryzen 5 PRO 4650GE", "Ryzen 5 PRO 4650G"},
		{"i5-9500T", "i5-9500"},
		{"i5-9500T", "i5-8500T"},
		{"Xeon E5-2680 v4", "Xeon E5-2690 v4"},
	}
	for _, pair := range different {
		if cpuKey(pair[0]) == cpuKey(pair[1]) {
			t.Errorf("%q and %q are different processors", pair[0], pair[1])
		}
	}
	if cpuKey("") != "" || cpuKey("Ryzen 5") != "" {
		t.Error("a name without a model number has no key")
	}
}

func pve01() Node {
	return Node{
		Name: "pve01", Online: true, CPUModel: "AMD Ryzen 5 PRO 4650GE with Radeon Graphics",
		Cores: 6, Threads: 12, MemoryMB: 31985,
	}
}

func m75q(id, name string) Candidate {
	return Candidate{ID: id, Name: name, CPUModel: "Ryzen 5 PRO 4650GE", Cores: 6, Threads: 12, RAMGB: 32}
}

func TestSuggestFindsTheMachine(t *testing.T) {
	suggestions := Suggest(pve01(), []Candidate{
		m75q("m75q", "Lenovo M75q #1"),
		{ID: "m920q", Name: "Lenovo M920q #1", CPUModel: "i5-9500T", Cores: 6, Threads: 6, RAMGB: 32},
		{ID: "pi", Name: "Raspberry Pi 4", Cores: 4, RAMGB: 8},
	})
	if len(suggestions) == 0 || suggestions[0].ItemID != "m75q" {
		t.Fatalf("suggestions: %+v", suggestions)
	}
	// Processor, memory and threads agree: as sure as figures alone can be.
	if suggestions[0].Confidence != 98 {
		t.Fatalf("confidence = %d, want 98", suggestions[0].Confidence)
	}
	for _, suggestion := range suggestions {
		if suggestion.ItemID == "pi" {
			t.Fatalf("a machine that fits nothing is not suggested: %+v", suggestion)
		}
	}
	agreeing := 0
	for _, reason := range suggestions[0].Reasons {
		if reason.Agrees {
			agreeing++
		}
	}
	if agreeing != 3 {
		t.Fatalf("three reasons agree: %+v", suggestions[0].Reasons)
	}
}

func TestTwoMachinesOfOneModelCannotBeToldApart(t *testing.T) {
	suggestions := Suggest(pve01(), []Candidate{m75q("a", "M75q #1"), m75q("b", "M75q #2")})
	if len(suggestions) != 2 {
		t.Fatalf("both are offered: %+v", suggestions)
	}
	for _, suggestion := range suggestions {
		if suggestion.Confidence > 70 {
			t.Fatalf("an ambiguous match is not called sure: %+v", suggestion)
		}
		last := suggestion.Reasons[len(suggestion.Reasons)-1]
		if last.Signal != "tie" {
			t.Fatalf("the tie is said: %+v", suggestion.Reasons)
		}
	}
	// The host name in the item's name settles it.
	named := m75q("b", "M75q #2 (pve01)")
	suggestions = Suggest(pve01(), []Candidate{m75q("a", "M75q #1"), named})
	if suggestions[0].ItemID != "b" || suggestions[0].Confidence != 98 {
		t.Fatalf("the item that names the host wins: %+v", suggestions)
	}
}

func TestALinkOrAHardwareAddressIsCertain(t *testing.T) {
	linked := Candidate{ID: "linked", Name: "Old box", LinkedNode: "pve01"}
	if got := Suggest(pve01(), []Candidate{linked}); len(got) != 1 || got[0].Confidence != 100 || got[0].Reasons[0].Signal != "linked" {
		t.Fatalf("a link made before: %+v", got)
	}

	node := pve01()
	node.Interfaces = []Interface{{Name: "eno1", MAC: "aa:bb:cc:dd:ee:ff"}}
	byMAC := Candidate{ID: "mac", Name: "Box", MACs: []string{"AA:BB:CC:DD:EE:FF"}}
	if got := Suggest(node, []Candidate{byMAC}); len(got) != 1 || got[0].Confidence != 100 {
		t.Fatalf("the same hardware address: %+v", got)
	}
	// Another address on a machine whose addresses are known: it is not that machine,
	// however well the figures fit.
	other := m75q("other", "M75q #2")
	other.MACs = []string{"00:11:22:33:44:55"}
	if got := Suggest(node, []Candidate{other}); len(got) != 0 {
		t.Fatalf("a different hardware address rules a machine out: %+v", got)
	}
}

func TestItemsThatStandForAnotherMachineAreLeftOut(t *testing.T) {
	elsewhere := m75q("x", "M75q at the office")
	elsewhere.LinkedElsewhere = true
	otherHost := m75q("y", "M75q #2")
	otherHost.LinkedNode = "pve02"
	if got := Suggest(pve01(), []Candidate{elsewhere, otherHost}); len(got) != 0 {
		t.Fatalf("suggestions: %+v", got)
	}
}

func TestOneFigureAloneIsThinEvidence(t *testing.T) {
	// Only the memory is known on both sides.
	node := Node{Name: "pve04", Online: true, MemoryMB: 64000}
	got := Suggest(node, []Candidate{{ID: "r730", Name: "Dell R730", RAMGB: 64}})
	if len(got) != 1 || got[0].Confidence > 60 {
		t.Fatalf("memory alone: %+v", got)
	}
	// And a host an export knows nothing about suggests nothing.
	if got := Suggest(Node{Name: "pve05"}, []Candidate{m75q("a", "M75q")}); len(got) != 0 {
		t.Fatalf("no evidence, no suggestion: %+v", got)
	}
}

func TestOnlyCoresNoted(t *testing.T) {
	candidate := Candidate{ID: "c", Name: "Box", CPUModel: "Ryzen 5 PRO 4650GE", Cores: 6, RAMGB: 32}
	got := Suggest(pve01(), []Candidate{candidate})
	if len(got) != 1 || got[0].Confidence != 98 {
		t.Fatalf("six cores fit a host with twelve threads: %+v", got)
	}
}

func TestMemoryFits(t *testing.T) {
	fits := map[int]float64{31985: 32, 30500: 32, 15900: 16, 64200: 64, 7600: 8}
	for actual, nominal := range fits {
		if !memoryFits(actual, nominal) {
			t.Errorf("%d MB is a %v GB machine", actual, nominal)
		}
	}
	for _, pair := range []struct {
		actual  int
		nominal float64
	}{{15900, 32}, {31985, 16}, {0, 32}, {31985, 0}} {
		if memoryFits(pair.actual, pair.nominal) {
			t.Errorf("%d MB is not a %v GB machine", pair.actual, pair.nominal)
		}
	}
}
