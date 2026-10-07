package proxmox

import (
	"strings"
	"testing"
)

// homelab is the cluster of the examples: one host, three guests.
func homelab() *Snapshot {
	return &Snapshot{
		Source: SourceAPI,
		Nodes: []Node{{
			Name: "pve01", Online: true, CPUModel: "AMD Ryzen 5 PRO 4650GE", Cores: 6, Threads: 12, MemoryMB: 31985, DiskGB: 58,
		}},
		Guests: []Guest{
			{VMID: 100, Name: "homeassistant", Kind: GuestLXC, Node: "pve01", Status: StatusRunning, CPUs: 2, MemoryMB: 4096, DiskGB: 32, IP: "192.168.1.15"},
			{VMID: 101, Name: "pihole", Kind: GuestLXC, Node: "pve01", Status: StatusRunning, CPUs: 1, MemoryMB: 512, DiskGB: 8},
			{VMID: 102, Name: "grafana", Kind: GuestLXC, Node: "pve01", Status: StatusRunning, CPUs: 2, MemoryMB: 2048, DiskGB: 16},
			{VMID: 103, Name: "docker", Kind: GuestVM, Node: "pve01", Status: StatusStopped, CPUs: 4, MemoryMB: 8192, DiskGB: 64},
			{VMID: 900, Name: "template", Kind: GuestVM, Node: "pve01", Status: StatusStopped, Template: true, CPUs: 1, MemoryMB: 1024},
		},
		Storage: []Storage{
			{Name: "local", Node: "pve01", TotalGB: 58},
			{Name: "local-lvm", Node: "pve01", TotalGB: 160},
			{Name: "nas", Node: "pve01", Shared: true, TotalGB: 8000},
		},
	}
}

func plannedM75q() PlannedHost {
	return PlannedHost{
		ID: "node-1", Name: "M75q", CPUs: 12, RAMGB: 32, StorageGB: 240,
		Guests: []PlannedGuest{
			{ID: "g-ha", Name: "Home Assistant", Kind: "container", CPUs: 2, MemoryMB: 4096, Status: StatusRunning},
			{ID: "g-pi", Name: "Pi-hole", Kind: "container", CPUs: 1, MemoryMB: 1024, Status: StatusRunning},
			{ID: "g-jf", Name: "Jellyfin", Kind: "container", CPUs: 4, MemoryMB: 4096, Status: StatusRunning},
		},
	}
}

func rowsByName(report HostReport) map[string]GuestRow {
	rows := map[string]GuestRow{}
	for _, row := range report.Guests {
		rows[row.Name] = row
	}
	return rows
}

func TestPairHosts(t *testing.T) {
	nodes := []Node{{Name: "pve01"}, {Name: "pve02"}, {Name: "pve03"}, {Name: "pve04"}}
	planned := []PlannedHost{
		{ID: "a", Name: "Rack server", ProxmoxNode: "pve02"},
		{ID: "b", Name: "Mini", ItemID: "item-b"},
		{ID: "c", Name: "PVE-03"},
		{ID: "d", Name: "Spare"},
	}
	itemNode := map[string]string{"item-b": "pve01"}

	pairs := PairHosts(nodes, planned, itemNode, nil)
	want := map[string]Pairing{
		"pve01": {PlannedID: "b", By: PairedByInventory},
		"pve02": {PlannedID: "a", By: PairedByLink},
		"pve03": {PlannedID: "c", By: PairedByName},
		"pve04": {},
	}
	for node, pairing := range want {
		if pairs[node] != pairing {
			t.Errorf("%s: %+v, want %+v", node, pairs[node], pairing)
		}
	}

	// What the owner says comes first, and a device is one host only.
	pairs = PairHosts(nodes, planned, itemNode, map[string]string{"pve04": "a", "pve03": ChoiceSkip, "pve01": ChoiceNew})
	if pairs["pve04"] != (Pairing{PlannedID: "a", By: PairedByChoice}) {
		t.Errorf("a chosen device: %+v", pairs["pve04"])
	}
	if pairs["pve02"].PlannedID != "" {
		t.Errorf("the device was taken by the owner's choice, so pve02 is new: %+v", pairs["pve02"])
	}
	if !pairs["pve03"].Skip || pairs["pve01"].PlannedID != "" {
		t.Errorf("skip and new: %+v, %+v", pairs["pve03"], pairs["pve01"])
	}
	// A choice that names nothing in the plan is no choice.
	pairs = PairHosts(nodes, planned, itemNode, map[string]string{"pve04": "gone"})
	if pairs["pve04"].PlannedID != "" {
		t.Errorf("an unknown device: %+v", pairs["pve04"])
	}
}

func TestReconcileComparesPlanAndCluster(t *testing.T) {
	snapshot := homelab()
	planned := []PlannedHost{plannedM75q()}
	pairs := PairHosts(snapshot.Nodes, planned, nil, map[string]string{"pve01": "node-1"})
	result := Reconcile(snapshot, planned, pairs)

	if len(result.Hosts) != 1 {
		t.Fatalf("hosts: %+v", result.Hosts)
	}
	host := result.Hosts[0]
	if host.PlannedID != "node-1" || host.PairedBy != PairedByChoice {
		t.Fatalf("pairing: %+v", host)
	}
	// 32 GB planned, 31.2 shown: the same machine. 240 GB planned, 218 usable: the same disk.
	if host.RAMGB.State != FigureSame || host.CPUs.State != FigureSame || host.StorageGB.State != FigureSame {
		t.Fatalf("hardware: cpu %+v, ram %+v, storage %+v", host.CPUs, host.RAMGB, host.StorageGB)
	}
	if host.StorageGB.Actual != 218 {
		t.Fatalf("storage is what lives in the host: %v", host.StorageGB.Actual)
	}

	if result.Counts != (Counts{Matched: 2, Differing: 1, Discovered: 2, Missing: 1}) {
		t.Fatalf("counts: %+v", result.Counts)
	}
	rows := rowsByName(host)
	if row := rows["homeassistant"]; row.State != GuestMatched || row.PlannedID != "g-ha" || row.Differs || row.MatchedBy != "name" {
		t.Fatalf("Home Assistant is on both sides and the same: %+v", row)
	}
	if row := rows["pihole"]; row.State != GuestMatched || !row.Differs || row.MemoryMB.State != FigureDiffers {
		t.Fatalf("Pi-hole runs with other memory than planned: %+v", row)
	}
	if row := rows["grafana"]; row.State != GuestDiscovered || row.PlannedID != "" {
		t.Fatalf("Grafana is not in the plan: %+v", row)
	}
	if row := rows["Jellyfin"]; row.State != GuestMissing || row.PlannedID != "g-jf" {
		t.Fatalf("Jellyfin is planned and not there: %+v", row)
	}
	if _, listed := rows["template"]; listed {
		t.Fatal("a template is not a guest")
	}

	// Memory: the plan gives 4096 + 1024 + 4096; running guests take 4096 + 512 + 2048.
	if host.MemoryMB.Planned != 9216 || host.MemoryMB.Actual != 6656 || host.MemoryMB.Capacity != 31985 {
		t.Fatalf("memory load: %+v", host.MemoryMB)
	}
	if host.VCPUs.Planned != 7 || host.VCPUs.Actual != 5 || host.VCPUs.Capacity != 12 {
		t.Fatalf("processor load: %+v", host.VCPUs)
	}
	// A stopped guest takes no memory, but its disk is there.
	if host.DiskGB.Actual != 120 {
		t.Fatalf("disks: %+v", host.DiskGB)
	}
	if host.HeadroomPercent != 71 || len(host.Warnings) != 0 {
		t.Fatalf("headroom: %d%%, %v", host.HeadroomPercent, host.Warnings)
	}
	if result.Totals.MemoryMB != host.MemoryMB {
		t.Fatalf("totals: %+v", result.Totals)
	}
}

func TestReconcileRemembersAGuestByItsID(t *testing.T) {
	snapshot := homelab()
	host := plannedM75q()
	// Imported earlier as guest 102, renamed in the plan since.
	host.Guests = append(host.Guests, PlannedGuest{ID: "g-mon", Name: "Monitoring", Kind: "lxc", CPUs: 2, MemoryMB: 2048, Status: StatusRunning, VMID: 102})
	// A planned guest that carries another id is not this one, whatever its name.
	host.Guests = append(host.Guests, PlannedGuest{ID: "g-old", Name: "docker", Kind: "vm", VMID: 555})
	planned := []PlannedHost{host}
	result := Reconcile(snapshot, planned, PairHosts(snapshot.Nodes, planned, nil, map[string]string{"pve01": "node-1"}))

	rows := rowsByName(result.Hosts[0])
	if row := rows["grafana"]; row.State != GuestMatched || row.PlannedID != "g-mon" || row.MatchedBy != "id" || row.Differs {
		t.Fatalf("guest 102 is the planned Monitoring: %+v", row)
	}
	if row := rows["docker"]; row.State != GuestDiscovered && row.State != GuestMissing {
		t.Fatalf("unexpected row for docker: %+v", row)
	}
	discovered, missing := 0, 0
	for _, row := range result.Hosts[0].Guests {
		if strings.EqualFold(row.Name, "docker") {
			if row.State == GuestDiscovered {
				discovered++
			}
			if row.State == GuestMissing {
				missing++
			}
		}
	}
	if discovered != 1 || missing != 1 {
		t.Fatalf("the running docker is discovered, the planned one with id 555 is missing: %d, %d", discovered, missing)
	}
}

func TestReconcileAHostThatIsNotInThePlan(t *testing.T) {
	snapshot := homelab()
	result := Reconcile(snapshot, nil, PairHosts(snapshot.Nodes, nil, nil, nil))
	host := result.Hosts[0]
	if host.PlannedID != "" || host.RAMGB.State != FigureUnknown || host.RAMGB.Actual == 0 {
		t.Fatalf("a new host has figures and no plan: %+v", host)
	}
	if result.Counts.Discovered != 4 || result.Counts.Matched != 0 || result.Counts.Missing != 0 {
		t.Fatalf("every guest is discovered: %+v", result.Counts)
	}
}

func TestReconcileLeavesASkippedHostOut(t *testing.T) {
	snapshot := homelab()
	planned := []PlannedHost{plannedM75q()}
	result := Reconcile(snapshot, planned, PairHosts(snapshot.Nodes, planned, nil, map[string]string{"pve01": ChoiceSkip}))
	if !result.Hosts[0].Skipped || len(result.Hosts[0].Guests) != 0 || result.Counts != (Counts{}) {
		t.Fatalf("a skipped host: %+v, %+v", result.Hosts[0], result.Counts)
	}
}

func TestReconcileWarnsWhenAHostIsFull(t *testing.T) {
	snapshot := homelab()
	snapshot.Guests = append(snapshot.Guests, Guest{VMID: 110, Name: "big", Kind: GuestVM, Node: "pve01", Status: StatusRunning, CPUs: 8, MemoryMB: 20480, DiskGB: 50})
	result := Reconcile(snapshot, nil, PairHosts(snapshot.Nodes, nil, nil, nil))
	host := result.Hosts[0]
	// 4096 + 512 + 2048 + 20480 of 31985 MB: 15 % left.
	if host.HeadroomPercent != 15 || len(host.Warnings) != 1 || !strings.Contains(host.Warnings[0], "close to full") {
		t.Fatalf("headroom %d%%, warnings %v", host.HeadroomPercent, host.Warnings)
	}

	snapshot.Guests = append(snapshot.Guests, Guest{VMID: 111, Name: "bigger", Kind: GuestVM, Node: "pve01", Status: StatusRunning, CPUs: 8, MemoryMB: 16384})
	host = Reconcile(snapshot, nil, PairHosts(snapshot.Nodes, nil, nil, nil)).Hosts[0]
	if host.HeadroomPercent >= 0 || !strings.Contains(host.Warnings[0], "more memory than the host has") {
		t.Fatalf("an overcommitted host: %d%%, %v", host.HeadroomPercent, host.Warnings)
	}
}

func TestNominalRAMGB(t *testing.T) {
	for shownMB, want := range map[int]float64{
		31985: 32, 15900: 16, 7600: 8, 3800: 4, 64200: 64, 128500: 128, 11900: 12, 257000: 256, 515000: 512, 0: 0,
	} {
		if got := NominalRAMGB(shownMB); got != want {
			t.Errorf("NominalRAMGB(%d) = %v, want %v", shownMB, got, want)
		}
	}
}
