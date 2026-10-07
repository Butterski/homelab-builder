package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/inventory"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/proxmox"
	"github.com/google/uuid"
)

// importCluster is one Proxmox host with three guests. Its real network is
// 192.168.10.0/24; one guest happens to sit in 192.168.1.0/24, the network the
// test builds plan.
func importCluster() proxmox.Snapshot {
	return proxmox.Snapshot{
		Source: proxmox.SourceAPI, FetchedAt: time.Now().UTC(), Version: "8.2.4", Cluster: "homelab",
		Nodes: []proxmox.Node{{
			Name: "pve01", Online: true, Address: "192.168.10.10", Gateway: "192.168.10.1", CIDR: "192.168.10.10/24",
			CPUModel: "AMD Ryzen 5 PRO 4650GE with Radeon Graphics", Cores: 6, Threads: 12, MemoryMB: 31985, DiskGB: 58,
		}},
		Guests: []proxmox.Guest{
			{VMID: 100, Name: "homeassistant", Kind: proxmox.GuestLXC, Node: "pve01", Status: proxmox.StatusRunning,
				CPUs: 2, MemoryMB: 4096, DiskGB: 32, IP: "192.168.10.15", MAC: "BC:24:11:00:01:00", OS: "Debian"},
			{VMID: 102, Name: "grafana", Kind: proxmox.GuestLXC, Node: "pve01", Status: proxmox.StatusRunning,
				CPUs: 2, MemoryMB: 2048, DiskGB: 16, IP: "192.168.1.60", MAC: "BC:24:11:00:01:02", OS: "Debian"},
			{VMID: 103, Name: "docker", Kind: proxmox.GuestVM, Node: "pve01", Status: proxmox.StatusStopped,
				CPUs: 4, MemoryMB: 8192, DiskGB: 64, OS: "Linux"},
		},
		Storage: []proxmox.Storage{{Name: "local-lvm", Node: "pve01", TotalGB: 220}, {Name: "nas", Node: "pve01", Shared: true, TotalGB: 8000}},
	}
}

type importFixture struct {
	*proposalFixture
	imports       *ProxmoxImportService
	integrations  *IntegrationService
	inventory     *InventoryService
	integrationID uuid.UUID
}

// newImportFixture is a build with a router and a switch, and an integration
// that has read snapshot.
func newImportFixture(t *testing.T, snapshot proxmox.Snapshot) *importFixture {
	t.Helper()
	base := newProposalFixture(t)
	f := &importFixture{proposalFixture: base, inventory: NewInventoryService(base.tx)}
	f.integrations = NewIntegrationService(base.tx, testKeyring(t, 1), true, true)
	f.imports = NewProxmoxImportService(base.tx, f.integrations, base.builds, base.ip, base.proposals)

	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	now := time.Now()
	integration := models.Integration{
		ID: uuid.New(), UserID: base.userID, Kind: IntegrationKindProxmox, Name: "Homelab",
		Source: proxmox.SourceAPI, Snapshot: raw, SyncedAt: &now,
	}
	if err := base.tx.Create(&integration).Error; err != nil {
		t.Fatalf("create integration: %v", err)
	}
	f.integrationID = integration.ID
	return f
}

// addHost saves a planned host with its guests into the fixture's build,
// cabled to the switch. It returns the host's id and its guests' ids by name.
func (f *importFixture) addHost(t *testing.T, name string, details map[string]any, guests ...VMDTO) (string, map[string]string) {
	t.Helper()
	input, err := BuildToSyncInput(f.reload(t))
	if err != nil {
		t.Fatalf("read build: %v", err)
	}
	hostID := uuid.NewString()
	ids := map[string]string{}
	for i := range guests {
		guests[i].ID = uuid.NewString()
		ids[guests[i].Name] = guests[i].ID
	}
	input.Nodes = append(input.Nodes, NodeDTO{ID: hostID, Type: "minipc", Name: name, X: 80, Y: 600, Details: details, VMs: guests})
	input.Edges = append(input.Edges, EdgeDTO{Source: f.sw, SourceHandle: "eth0", Target: hostID, TargetHandle: TargetHandle, Type: "ethernet"})
	if f.build, err = f.builds.UpdateAndCalculate(f.build.ID, f.userID, input, f.ip); err != nil {
		t.Fatalf("save host: %v", err)
	}
	return hostID, ids
}

func (f *importFixture) plan(t *testing.T, req ImportPlanRequest) *ImportPlan {
	t.Helper()
	plan, err := f.imports.Plan(f.userID, f.integrationID, req)
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	return plan
}

func nodeNamed(build *models.Build, name string) *models.Node {
	for i := range build.Nodes {
		if build.Nodes[i].Name == name {
			return &build.Nodes[i]
		}
	}
	return nil
}

func guestNamed(node *models.Node, name string) *models.VirtualMachine {
	for i := range node.VirtualMachines {
		if node.VirtualMachines[i].Name == name {
			return &node.VirtualMachines[i]
		}
	}
	return nil
}

func detailsOf(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	details, err := detailsMap(raw)
	if err != nil {
		t.Fatalf("details: %v", err)
	}
	return details
}

func plannedGuests() []VMDTO {
	return []VMDTO{
		{Name: "Home Assistant", Type: "container", Status: "running", CPUCores: 2, RAMMB: 2048},
		{Name: "Jellyfin", Type: "container", Status: "running", CPUCores: 4, RAMMB: 4096},
	}
}

func TestImport_PlanComparesABuildWithTheCluster(t *testing.T) {
	f := newImportFixture(t, importCluster())
	hostID, guests := f.addHost(t, "PVE-01", map[string]any{"cpu": 12, "ram": 32, "storage": 240}, plannedGuests()...)
	machine := mustCreateItem(t, f.inventory, f.userID, m75qInput("Lenovo M75q #1"))
	before := f.reload(t).Revision

	plan := f.plan(t, ImportPlanRequest{BuildID: &f.build.ID})
	if plan.Build == nil || plan.Build.ID != f.build.ID || len(plan.Hosts) != 1 || plan.OperationLimit != MaxTopologyOps {
		t.Fatalf("plan: %+v", plan)
	}
	// The only device that can run guests is offered as what the host may be.
	if len(plan.Candidates) != 1 || plan.Candidates[0].ID != hostID || plan.Candidates[0].Type != "minipc" {
		t.Fatalf("candidates: %+v", plan.Candidates)
	}
	host := plan.Hosts[0]
	if host.Node != "pve01" || host.PlannedID != hostID || host.PairedBy != proxmox.PairedByName {
		t.Fatalf("the host is paired by its name: %+v", host.HostReport)
	}
	if host.RAMGB.State != proxmox.FigureSame || host.CPUs.State != proxmox.FigureSame || host.StorageGB.State != proxmox.FigureSame {
		t.Fatalf("hardware: %+v %+v %+v", host.CPUs, host.RAMGB, host.StorageGB)
	}
	if host.Facts.CPUModel == "" || len(host.Storage) != 2 {
		t.Fatalf("the host comes with what it is made of: %+v, %+v", host.Facts, host.Storage)
	}
	if plan.Counts != (proxmox.Counts{Matched: 1, Differing: 1, Discovered: 2, Missing: 1}) {
		t.Fatalf("counts: %+v", plan.Counts)
	}
	states := map[string]string{}
	for _, row := range host.Guests {
		states[row.Name] = row.State
		if row.Name == "Jellyfin" && row.PlannedID != guests["Jellyfin"] {
			t.Fatalf("a missing guest names the planned one: %+v", row)
		}
	}
	want := map[string]string{"homeassistant": "matched", "grafana": "discovered", "docker": "discovered", "Jellyfin": "missing"}
	for name, state := range want {
		if states[name] != state {
			t.Fatalf("guest %s is %q, want %q (%v)", name, states[name], state, states)
		}
	}
	// The inventory knows a machine with this processor and memory.
	if host.LinkedItem != nil || len(host.Suggestions) != 1 || host.Suggestions[0].ItemID != machine.ID.String() || host.Suggestions[0].Confidence != 98 {
		t.Fatalf("inventory suggestion: %+v", host.Suggestions)
	}

	// Once linked, the item is named and no longer guessed.
	if err := f.integrations.LinkItem(f.userID, f.integrationID, "pve01", &machine.ID); err != nil {
		t.Fatalf("link: %v", err)
	}
	linked := f.plan(t, ImportPlanRequest{BuildID: &f.build.ID}).Hosts[0]
	if linked.LinkedItem == nil || linked.LinkedItem.ID != machine.ID || len(linked.Suggestions) != 0 {
		t.Fatalf("a linked host: %+v", linked)
	}

	// The owner's choice wins over the name.
	asNew := f.plan(t, ImportPlanRequest{BuildID: &f.build.ID, Hosts: map[string]string{"pve01": proxmox.ChoiceNew}}).Hosts[0]
	if asNew.PlannedID != "" || len(asNew.Guests) != 3 {
		t.Fatalf("a host taken as new has only discovered guests: %+v", asNew.HostReport)
	}
	// Without a build every host is new.
	alone := f.plan(t, ImportPlanRequest{})
	if alone.Build != nil || len(alone.Candidates) != 0 || alone.Counts.Discovered != 3 {
		t.Fatalf("a plan for a new build: %+v", alone)
	}

	// Planning changes nothing.
	if after := f.reload(t).Revision; after != before {
		t.Fatalf("a comparison changed the build: revision %d -> %d", before, after)
	}
}

func TestImport_IntoAnExistingBuildIsAProposal(t *testing.T) {
	f := newImportFixture(t, importCluster())
	hostID, guests := f.addHost(t, "PVE-01", map[string]any{"cpu": 8, "ram": 16}, plannedGuests()...)
	before := f.reload(t)

	result, err := f.imports.Import(f.userID, f.integrationID, ImportDecision{
		BuildID:        &f.build.ID,
		UseActualSpecs: []string{"pve01"},
		AddGuests:      []int{102, 103},
		UpdateGuests:   []int{100},
		RemoveGuests:   []string{guests["Jellyfin"]},
	})
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if result.Outcome != ImportOutcomeProposal || result.ProposalID == nil || result.BuildID == nil || *result.BuildID != f.build.ID {
		t.Fatalf("result: %+v", result)
	}

	// Nothing reached the build: it waits for the owner.
	unchanged := f.reload(t)
	if unchanged.Revision != before.Revision || guestNamed(nodeNamed(unchanged, "PVE-01"), "grafana") != nil {
		t.Fatalf("an import must not write to an existing build")
	}
	proposal, err := f.proposals.Get(f.build.ID, *result.ProposalID, f.userID)
	if err != nil || proposal.Status != ProposalPending || proposal.Source != ProposalSourceImport || proposal.SourceLabel != "Homelab" {
		t.Fatalf("proposal: %+v, %v", proposal, err)
	}
	var diff ProposalDiff
	if err := json.Unmarshal(proposal.Diff, &diff); err != nil {
		t.Fatalf("diff: %v", err)
	}
	if diff.Counts.VMsAdded != 2 || diff.Counts.VMsRemoved != 1 || diff.Counts.VMsChanged != 1 || diff.Counts.NodesChanged != 1 || diff.Counts.NodesAdded != 0 {
		t.Fatalf("diff counts: %+v", diff.Counts)
	}

	applied, _, err := f.proposals.Apply(f.build.ID, proposal.ID, f.userID)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	host := nodeNamed(applied, "PVE-01")
	if host == nil || host.ID.String() != hostID {
		t.Fatalf("the planned host stays the same device: %+v", host)
	}
	hostDetails := detailsOf(t, host.Details)
	if hostDetails[DetailProxmoxNode] != "pve01" || hostDetails["cpu"] != 12.0 || hostDetails["ram"] != 32.0 || hostDetails["storage"] != 220.0 {
		t.Fatalf("the host now says what the machine is: %v", hostDetails)
	}
	if guestNamed(host, "Jellyfin") != nil {
		t.Fatal("the guest the owner removed is gone")
	}
	grafana := guestNamed(host, "grafana")
	if grafana == nil || grafana.Type != "lxc" || grafana.CPUCores != 2 || grafana.RAMMB != 2048 || grafana.OS != "Debian" ||
		grafana.Status != "running" || grafana.MacAddress != "BC:24:11:00:01:02" {
		t.Fatalf("an added guest: %+v", grafana)
	}
	grafanaDetails := detailsOf(t, grafana.Details)
	// Its real address lies in the planned network, so it is kept.
	if grafanaDetails[guestVMIDKey] != 102.0 || grafanaDetails[guestDiskKey] != 16.0 || grafanaDetails["static_ip"] != "192.168.1.60" || grafana.IP != "192.168.1.60" {
		t.Fatalf("an added guest remembers where it came from: %v, ip %s", grafanaDetails, grafana.IP)
	}
	if docker := guestNamed(host, "docker"); docker == nil || docker.Type != "vm" || docker.Status != "stopped" || docker.RAMMB != 8192 {
		t.Fatalf("a stopped guest is imported as stopped: %+v", docker)
	}
	// The matched guest took the real size and remembers its id; its name is the plan's.
	assistant := guestNamed(host, "Home Assistant")
	if assistant == nil || assistant.RAMMB != 4096 || detailsOf(t, assistant.Details)[guestVMIDKey] != 100.0 {
		t.Fatalf("an updated guest: %+v", assistant)
	}
	// Its real address is in another network: the build keeps its own plan.
	if _, pinned := detailsOf(t, assistant.Details)["static_ip"]; pinned {
		t.Fatalf("an address outside the planned network must not be pinned: %v", assistant.Details)
	}

	// A second comparison finds everything in place, by id.
	again := f.plan(t, ImportPlanRequest{BuildID: &f.build.ID})
	if again.Counts != (proxmox.Counts{Matched: 3}) || again.Hosts[0].PairedBy != proxmox.PairedByLink {
		t.Fatalf("after the import the plan says what the cluster runs: %+v, paired by %s", again.Counts, again.Hosts[0].PairedBy)
	}
	for _, row := range again.Hosts[0].Guests {
		if row.MatchedBy != "id" {
			t.Fatalf("guests are found by their id now: %+v", row)
		}
	}
	nothing, err := f.imports.Import(f.userID, f.integrationID, ImportDecision{BuildID: &f.build.ID, UpdateGuests: []int{100, 102, 103}})
	if err != nil || nothing.Outcome != ImportOutcomeNothing || nothing.ProposalID != nil {
		t.Fatalf("an import with nothing to do: %+v, %v", nothing, err)
	}
}

func TestImport_ANewHostArrivesCabledAndIsItsInventoryItem(t *testing.T) {
	f := newImportFixture(t, importCluster())
	machine := mustCreateItem(t, f.inventory, f.userID, m75qInput("Lenovo M75q #1"))
	if err := f.integrations.LinkItem(f.userID, f.integrationID, "pve01", &machine.ID); err != nil {
		t.Fatalf("link: %v", err)
	}

	result, err := f.imports.Import(f.userID, f.integrationID, ImportDecision{BuildID: &f.build.ID, AddGuests: []int{100}})
	if err != nil || result.Outcome != ImportOutcomeProposal {
		t.Fatalf("import: %+v, %v", result, err)
	}
	applied, _, err := f.proposals.Apply(f.build.ID, *result.ProposalID, f.userID)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	host := nodeNamed(applied, "pve01")
	if host == nil {
		t.Fatalf("the host was added: %+v", applied.Nodes)
	}
	// The node is the machine: its type, its figures, its hardware address.
	details := detailsOf(t, host.Details)
	if host.Type != "minipc" || host.MacAddress != "AA:BB:CC:DD:EE:FF" || details[inventory.DetailItemID] != machine.ID.String() ||
		details[inventory.DetailLabel] != "Lenovo M75q #1" || details[DetailProxmoxNode] != "pve01" || details["cpu"] != 12.0 || details["ram"] != 32.0 {
		t.Fatalf("a host that is an inventory item: type %s, mac %s, %v", host.Type, host.MacAddress, details)
	}
	cabled := false
	for _, edge := range applied.Edges {
		if edge.SourceNodeID.String() == f.sw && edge.TargetNodeID == host.ID {
			cabled = true
		}
	}
	if !cabled {
		t.Fatalf("a new host is plugged into the switch: %+v", applied.Edges)
	}
	if guestNamed(host, "homeassistant") == nil || guestNamed(host, "grafana") != nil {
		t.Fatalf("only the chosen guest came along: %+v", host.VirtualMachines)
	}
	// The inventory now knows where the machine is planned.
	placements := viewOf(t, f.inventory, f.userID, machine.ID).Placements
	if len(placements) != 1 || placements[0].NodeName != "pve01" {
		t.Fatalf("placements: %+v", placements)
	}
}

func TestImport_AHostWithoutAnInventoryItemIsAServer(t *testing.T) {
	f := newImportFixture(t, importCluster())
	result, err := f.imports.Import(f.userID, f.integrationID, ImportDecision{BuildID: &f.build.ID})
	if err != nil || result.Outcome != ImportOutcomeProposal {
		t.Fatalf("import: %+v, %v", result, err)
	}
	applied, _, err := f.proposals.Apply(f.build.ID, *result.ProposalID, f.userID)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	host := nodeNamed(applied, "pve01")
	details := detailsOf(t, host.Details)
	if host.Type != "server_v2" || details["hypervisor_enabled"] != true || details["model"] != "AMD Ryzen 5 PRO 4650GE with Radeon Graphics" ||
		details["cpu"] != 12.0 || details["ram"] != 32.0 || details["storage"] != 220.0 {
		t.Fatalf("an unknown host is a hypervisor with the measured figures: %s, %v", host.Type, details)
	}
	if len(host.VirtualMachines) != 0 {
		t.Fatalf("no guest was chosen: %+v", host.VirtualMachines)
	}
	// A skipped host is left alone.
	skipped, err := f.imports.Import(f.userID, f.integrationID, ImportDecision{BuildID: &f.build.ID, Hosts: map[string]string{"pve01": proxmox.ChoiceSkip}, AddGuests: []int{100}})
	if err != nil || skipped.Outcome != ImportOutcomeNothing {
		t.Fatalf("an import of a skipped host: %+v, %v", skipped, err)
	}
}

func TestImport_ANewBuildIsWrittenDirectly(t *testing.T) {
	f := newImportFixture(t, importCluster())
	result, err := f.imports.Import(f.userID, f.integrationID, ImportDecision{BuildName: "What I really run", AddGuests: []int{100, 102, 103}})
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if result.Outcome != ImportOutcomeBuild || result.BuildID == nil || result.ProposalID != nil || *result.BuildID == f.build.ID {
		t.Fatalf("result: %+v", result)
	}
	build, err := f.builds.GetOwned(*result.BuildID, f.userID)
	if err != nil {
		t.Fatalf("the new build: %v", err)
	}
	if build.Name != "What I really run" || build.Kind != "homelab" || len(build.Nodes) != 3 || len(build.Edges) != 2 {
		t.Fatalf("a router, a switch and the host: %s, %d nodes, %d edges", build.Name, len(build.Nodes), len(build.Edges))
	}
	// The router stands at the hosts' real gateway, so real addresses fit.
	router := nodeNamed(build, "Router")
	if router == nil || router.IP != "192.168.10.1" {
		t.Fatalf("router: %+v", router)
	}
	host := nodeNamed(build, "pve01")
	if host == nil || host.IP != "192.168.10.10" || !detailBool(detailsOf(t, host.Details), "dhcp_locked") {
		t.Fatalf("the host keeps its real address: %+v", host)
	}
	assistant := guestNamed(host, "homeassistant")
	if assistant == nil || assistant.IP != "192.168.10.15" || detailsOf(t, assistant.Details)["static_ip"] != "192.168.10.15" {
		t.Fatalf("a guest keeps its real address: %+v", assistant)
	}
	// This one's address is in another network than the gateway's: left to the plan.
	if grafana := guestNamed(host, "grafana"); grafana == nil || detailsOf(t, grafana.Details)["static_ip"] != nil {
		t.Fatalf("an address outside the network is not pinned: %+v", grafana)
	}
	if len(host.VirtualMachines) != 3 {
		t.Fatalf("guests: %+v", host.VirtualMachines)
	}

	// Without a name the cluster's is used.
	unnamed, err := f.imports.Import(f.userID, f.integrationID, ImportDecision{})
	if err != nil {
		t.Fatalf("import without a name: %v", err)
	}
	if build, _ := f.builds.GetOwned(*unnamed.BuildID, f.userID); build.Name != "Proxmox homelab" {
		t.Fatalf("default name: %q", build.Name)
	}
}

// poolIPAM is hlbIPAM as far as an import is concerned: it hands out
// 192.168.10.x behind the gateway it is given, keeps .50 to .135 for DHCP, and
// answers a request for an address in that range with another one.
func poolIPAM(t *testing.T, f *importFixture) {
	t.Helper()
	inPool := func(address string) bool {
		ip, ok := ipv4Number(address)
		first, _ := ipv4Number("192.168.10.50")
		last, _ := ipv4Number("192.168.10.135")
		return ok && ip >= first && ip <= last
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/v1/validate" {
			_, _ = w.Write([]byte(`{"valid":true,"errors":[],"warnings":[]}`))
			return
		}
		var req ipamRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		resp := ipamResponse{}
		for _, router := range req.Routers {
			resp.Routers = append(resp.Routers, ipamRouterResult{
				ID: router.ID, GatewayIP: router.GatewayIP, Subnet: "192.168.10.0/24",
				DHCPStart: "192.168.10.50", DHCPEnd: "192.168.10.135", DHCPSize: 86,
			})
		}
		next := 200
		safe := func(wanted string) string {
			if wanted != "" && !inPool(wanted) {
				return wanted
			}
			next++
			return fmt.Sprintf("192.168.10.%d", next)
		}
		for _, node := range req.Nodes {
			result := ipamNodeResult{ID: node.ID, Type: node.Type}
			if !nonNetworkTypes[node.Type] && (len(node.Connections) > 0 || node.ExistingIP != "") {
				result.AssignedIP = safe(node.ExistingIP)
			}
			for _, vm := range node.VMs {
				result.VMs = append(result.VMs, ipamVMResult{ID: vm.ID, AssignedIP: safe(vm.ExistingIP)})
			}
			resp.Nodes = append(resp.Nodes, result)
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	t.Cleanup(server.Close)
	ip := &IPService{db: f.tx, client: server.Client(), ipamURL: server.URL}
	f.ip = ip
	f.proposals = NewProposalService(f.tx, f.builds, ip)
	f.imports = NewProxmoxImportService(f.tx, f.integrations, f.builds, ip, f.proposals)
}

func TestImport_TheAddressBookPinsNothingInADHCPRange(t *testing.T) {
	router := NodeDTO{ID: "r", Type: "router", IP: "192.168.10.1", Details: map[string]any{
		"dhcp_pool": map[string]any{"start": "192.168.10.50", "end": "192.168.10.135", "size": 86.0, "clients": 0.0},
	}}
	taken := NodeDTO{ID: "n", Type: "nas", IP: "192.168.10.100", VMs: []VMDTO{{ID: "v", IP: "192.168.10.101", Details: map[string]any{"static_ip": "192.168.10.30"}}}}
	book := newAddressBook(SyncGraphInput{Nodes: []NodeDTO{router, taken}}, pinning{enabled: true})

	for _, c := range []struct {
		address string
		want    bool
		why     string
	}{
		{"192.168.10.20", true, "a free address of the network"},
		{"192.168.10.20", false, "an address is given to one machine"},
		{"192.168.10.49", true, "the address before the range"},
		{"192.168.10.50", false, "the first address of the range"},
		{"192.168.10.135", false, "the last address of the range"},
		{"192.168.10.136", true, "the address after the range"},
		{"192.168.10.1", false, "the router's own address"},
		{"192.168.10.30", false, "an address a guest asked for"},
		{"192.168.20.20", false, "another network"},
		{"", false, "no address"},
	} {
		if got := book.take(c.address); got != c.want {
			t.Errorf("%s (%q): got %v", c.why, c.address, got)
		}
	}
	if book.inPool != 2 {
		t.Fatalf("two addresses lay in the range, counted %d", book.inPool)
	}

	// With pinning off nothing is taken; what was seen to be refused is refused.
	if off := newAddressBook(SyncGraphInput{Nodes: []NodeDTO{router}}, pinning{}); off.take("192.168.10.20") {
		t.Fatal("pinning is off")
	}
	barring := newAddressBook(SyncGraphInput{Nodes: []NodeDTO{{Type: "router", IP: "192.168.10.1", Details: map[string]any{}}}},
		pinning{enabled: true, barred: map[string]bool{"192.168.10.60": true}})
	if barring.take("192.168.10.60") || !barring.take("192.168.10.61") || barring.inPool != 1 {
		t.Fatalf("a barred address: %+v", barring)
	}
}

// poolCluster is importCluster with every guest in the hosts' own network, one
// of them at an address a router would hand out by DHCP.
func poolCluster() proxmox.Snapshot {
	snapshot := importCluster()
	snapshot.Guests[1].IP = "192.168.10.60"
	snapshot.Guests[2].Status, snapshot.Guests[2].IP = proxmox.StatusRunning, "192.168.10.22"
	return snapshot
}

func TestImport_ANewBuildDoesNotAskForAddressesItsRouterHandsOut(t *testing.T) {
	f := newImportFixture(t, poolCluster())
	poolIPAM(t, f)

	result, err := f.imports.Import(f.userID, f.integrationID, ImportDecision{AddGuests: []int{100, 102, 103}})
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if result.Outcome != ImportOutcomeBuild || result.AddressesLeftOut || result.AddressesInPool != 1 {
		t.Fatalf("one address lies in the new router's DHCP range: %+v", result)
	}
	build, err := f.builds.GetOwned(*result.BuildID, f.userID)
	if err != nil {
		t.Fatalf("the new build: %v", err)
	}
	host := nodeNamed(build, "pve01")
	if host == nil || host.IP != "192.168.10.10" || len(host.VirtualMachines) != 3 {
		t.Fatalf("host: %+v", host)
	}
	// What the address plan would not pin is not asked for: the guest shows
	// the address it was given and claims no other.
	grafana := guestNamed(host, "grafana")
	if grafana == nil || grafana.IP == "" || grafana.IP == "192.168.10.60" || detailsOf(t, grafana.Details)["static_ip"] != nil {
		t.Fatalf("a guest whose real address is in the DHCP range: %+v", grafana)
	}
	for name, address := range map[string]string{"homeassistant": "192.168.10.15", "docker": "192.168.10.22"} {
		guest := guestNamed(host, name)
		if guest == nil || guest.IP != address || detailsOf(t, guest.Details)["static_ip"] != address {
			t.Fatalf("%s keeps its real address %s: %+v", name, address, guest)
		}
	}
	// Written twice, the build is still one build with one router and one switch.
	if len(build.Nodes) != 3 || len(build.Edges) != 2 {
		t.Fatalf("%d nodes, %d edges", len(build.Nodes), len(build.Edges))
	}
	if pool, _ := detailsOf(t, nodeNamed(build, "Router").Details)["dhcp_pool"].(map[string]any); pool["start"] != "192.168.10.50" {
		t.Fatalf("the router's DHCP range: %+v", pool)
	}
}

func TestImport_AProposalDoesNotAskForAddressesTheRouterHandsOut(t *testing.T) {
	f := newImportFixture(t, poolCluster())
	poolIPAM(t, f)
	// The fixture's router moves to the cluster's network; saving it stores its DHCP range.
	input, err := BuildToSyncInput(f.reload(t))
	if err != nil {
		t.Fatalf("read build: %v", err)
	}
	for i := range input.Nodes {
		if input.Nodes[i].Type == "router" {
			input.Nodes[i].IP = "192.168.10.1"
		}
	}
	if f.build, err = f.builds.UpdateAndCalculate(f.build.ID, f.userID, input, f.ip); err != nil {
		t.Fatalf("move the router: %v", err)
	}

	result, err := f.imports.Import(f.userID, f.integrationID, ImportDecision{BuildID: &f.build.ID, AddGuests: []int{100, 102}})
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if result.Outcome != ImportOutcomeProposal || result.AddressesLeftOut || result.AddressesInPool != 1 {
		t.Fatalf("one address lies in the router's DHCP range: %+v", result)
	}
	applied, _, err := f.proposals.Apply(f.build.ID, *result.ProposalID, f.userID)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	host := nodeNamed(applied, "pve01")
	if host == nil || host.IP != "192.168.10.10" {
		t.Fatalf("the new host keeps its real address: %+v", host)
	}
	assistant, grafana := guestNamed(host, "homeassistant"), guestNamed(host, "grafana")
	if assistant == nil || assistant.IP != "192.168.10.15" || detailsOf(t, assistant.Details)["static_ip"] != "192.168.10.15" {
		t.Fatalf("a guest outside the range keeps its real address: %+v", assistant)
	}
	if grafana == nil || grafana.IP == "192.168.10.60" || detailsOf(t, grafana.Details)["static_ip"] != nil {
		t.Fatalf("a guest inside the range asks for nothing: %+v", grafana)
	}
}

// manyGuests is a cluster of two hosts with count guests each.
func manyGuests(count int) (proxmox.Snapshot, []int) {
	snapshot := proxmox.Snapshot{Source: proxmox.SourcePaste, FetchedAt: time.Now().UTC()}
	ids := []int{}
	for h, name := range []string{"pve01", "pve02"} {
		snapshot.Nodes = append(snapshot.Nodes, proxmox.Node{Name: name, Online: true, Threads: 64, MemoryMB: 256000})
		for i := 0; i < count; i++ {
			id := 1000*(h+1) + i
			ids = append(ids, id)
			snapshot.Guests = append(snapshot.Guests, proxmox.Guest{
				VMID: id, Name: fmt.Sprintf("guest-%d", id), Kind: proxmox.GuestLXC, Node: name,
				Status: proxmox.StatusRunning, CPUs: 1, MemoryMB: 512, DiskGB: 4,
			})
		}
	}
	return snapshot, ids
}

func TestImport_SizeLimits(t *testing.T) {
	snapshot, ids := manyGuests(60)
	f := newImportFixture(t, snapshot)

	// Into an existing build an import is one proposal, and a proposal has a size.
	_, err := f.imports.Import(f.userID, f.integrationID, ImportDecision{BuildID: &f.build.ID, AddGuests: ids})
	if !errors.Is(err, ErrImportTooLarge) {
		t.Fatalf("an import of 120 guests into an existing build: %v", err)
	}
	if state, _ := f.proposals.SyncState(f.build.ID, f.userID); state.Pending != nil {
		t.Fatalf("a refused import leaves no proposal: %+v", state.Pending)
	}
	// Fewer guests fit.
	result, err := f.imports.Import(f.userID, f.integrationID, ImportDecision{BuildID: &f.build.ID, AddGuests: ids[:40]})
	if err != nil || result.Outcome != ImportOutcomeProposal {
		t.Fatalf("an import of 40 guests: %+v, %v", result, err)
	}

	// A new build is written as a whole, however large.
	created, err := f.imports.Import(f.userID, f.integrationID, ImportDecision{BuildName: "Everything", AddGuests: ids})
	if err != nil || created.Outcome != ImportOutcomeBuild {
		t.Fatalf("a new build with 120 guests: %+v, %v", created, err)
	}
	build, _ := f.builds.GetOwned(*created.BuildID, f.userID)
	total := 0
	for _, node := range build.Nodes {
		total += len(node.VirtualMachines)
	}
	if total != 120 || len(build.Nodes) != 4 {
		t.Fatalf("the new build holds every guest: %d guests on %d nodes", total, len(build.Nodes))
	}
}

func TestImport_IsForTheOwnerOnly(t *testing.T) {
	f := newImportFixture(t, importCluster())
	stranger := newTestUser(t, f.tx).ID

	if _, err := f.imports.Plan(stranger, f.integrationID, ImportPlanRequest{}); !errors.Is(err, ErrIntegrationNotFound) {
		t.Fatalf("somebody else's integration: %v", err)
	}
	if _, err := f.imports.Import(stranger, f.integrationID, ImportDecision{}); !errors.Is(err, ErrIntegrationNotFound) {
		t.Fatalf("importing from somebody else's integration: %v", err)
	}
	// One's own integration, somebody else's build.
	other := NewBuildService(f.tx)
	foreign, err := other.Create(stranger, SyncGraphInput{Name: "Not mine"})
	if err != nil {
		t.Fatalf("create build: %v", err)
	}
	if _, err := f.imports.Plan(f.userID, f.integrationID, ImportPlanRequest{BuildID: &foreign.ID}); !errors.Is(err, ErrBuildNotFound) {
		t.Fatalf("a comparison with somebody else's build: %v", err)
	}
	if _, err := f.imports.Import(f.userID, f.integrationID, ImportDecision{BuildID: &foreign.ID, AddGuests: []int{100}}); !errors.Is(err, ErrBuildNotFound) {
		t.Fatalf("an import into somebody else's build: %v", err)
	}
	// An integration nothing was read from has nothing to compare.
	empty := models.Integration{ID: uuid.New(), UserID: f.userID, Kind: IntegrationKindProxmox, Name: "Empty"}
	if err := f.tx.Create(&empty).Error; err != nil {
		t.Fatalf("create integration: %v", err)
	}
	if _, err := f.imports.Plan(f.userID, empty.ID, ImportPlanRequest{}); !errors.Is(err, ErrIntegrationNoSnapshot) {
		t.Fatalf("a comparison without a snapshot: %v", err)
	}
}

func TestTopologyOps_KeepWhatAnImportKnows(t *testing.T) {
	base := SyncGraphInput{Name: "Lab", Nodes: []NodeDTO{{ID: uuid.NewString(), Type: "minipc", Name: "Host", Details: map[string]any{}}}}
	applied := mustApply(t, base,
		TopologyOp{Op: "update_node", Node: "Host", MacAddress: strPtr("aa-bb-cc-dd-ee-ff")},
		TopologyOp{Op: "add_vm", Ref: "ha", Host: "Host", Name: strPtr("homeassistant"), Type: "lxc",
			MacAddress: strPtr("bc:24:11:00:01:00"), DiskGB: numPtr(32), VMID: numPtr(100)},
	)
	host := applied.Input.Nodes[0]
	if host.MacAddress != "AA:BB:CC:DD:EE:FF" {
		t.Fatalf("a node's hardware address is written one way: %q", host.MacAddress)
	}
	guest := host.VMs[0]
	if guest.MacAddress != "BC:24:11:00:01:00" || guest.Details[guestDiskKey] != 32.0 || guest.Details[guestVMIDKey] != 100.0 {
		t.Fatalf("a guest keeps its address, disk and id: %+v", guest)
	}

	cleared := mustApply(t, applied.Input, TopologyOp{Op: "update_vm", VM: guest.ID, VMID: numPtr(0), DiskGB: numPtr(0), MacAddress: strPtr("")})
	guest = cleared.Input.Nodes[0].VMs[0]
	if guest.MacAddress != "" || len(guest.Details) != 0 {
		t.Fatalf("zero and empty clear them: %+v", guest)
	}

	for name, op := range map[string]TopologyOp{
		"a hardware address that is none": {Op: "update_node", Node: "Host", MacAddress: strPtr("not-a-mac")},
		"half an id":                      {Op: "update_vm", VM: guest.ID, VMID: numPtr(1.5)},
		"a negative disk":                 {Op: "update_vm", VM: guest.ID, DiskGB: numPtr(-1)},
	} {
		if opErr := applyError(t, cleared.Input, ApplyOptions{}, op); opErr == nil {
			t.Errorf("%s must be refused", name)
		}
	}
}
