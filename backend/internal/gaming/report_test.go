package gaming

import (
	"strings"
	"testing"
)

// ─── Fixtures ────────────────────────────────────────────────────────────────

func gameGuest(id, name, profile string, players int, exposure string, offset int) ReportGuest {
	return ReportGuest{ID: id, Name: name, Type: "container", Game: &Instance{Profile: profile, Players: players, Exposure: exposure, PortOffset: offset}}
}

// homeNetwork is modem - router - switch - server, the usual place a game
// server for friends ends up.
func homeNetwork(plan Plan, guests ...ReportGuest) ReportInput {
	return ReportInput{
		Kind: KindGameServer, Revision: 7, Plan: plan,
		Nodes: []ReportNode{
			{ID: "modem", Name: "Modem", Type: "modem", IsInternetEdge: true},
			{ID: "router", Name: "Router", Type: "router", IP: "192.168.1.1", IsRouter: true, IsHub: true, PortsTotal: 4, PortsUsed: 2,
				DHCP: &DHCPPool{Enabled: true, Start: "192.168.1.50", End: "192.168.1.135", Size: 86}},
			{ID: "switch", Name: "Switch", Type: "switch", IP: "192.168.1.10", IsHub: true, PortsTotal: 8, PortsUsed: 2},
			{ID: "server", Name: "Game host", Type: "server_v2", IP: "192.168.1.150", CPUCores: 8, RAMMB: 32768, Guests: guests},
		},
		Links: []ReportLink{
			{A: "modem", B: "router", Kind: LinkEthernet, Gbps: 1},
			{A: "router", B: "switch", Kind: LinkEthernet, Gbps: 1},
			{A: "switch", B: "server", Kind: LinkEthernet, Gbps: 1},
		},
	}
}

func issueCodes(report Report) []string {
	codes := make([]string, len(report.Issues))
	for i, issue := range report.Issues {
		codes[i] = issue.Code
	}
	return codes
}

func findIssue(report Report, code string) (Issue, bool) {
	for _, issue := range report.Issues {
		if issue.Code == code {
			return issue, true
		}
	}
	return Issue{}, false
}

func wantIssue(t *testing.T, report Report, code, severity string) Issue {
	t.Helper()
	issue, ok := findIssue(report, code)
	if !ok {
		t.Fatalf("expected issue %q, got %v", code, issueCodes(report))
	}
	if issue.Severity != severity {
		t.Fatalf("issue %q: expected severity %s, got %s", code, severity, issue.Severity)
	}
	return issue
}

func wantNoIssue(t *testing.T, report Report, code string) {
	t.Helper()
	if issue, ok := findIssue(report, code); ok {
		t.Fatalf("unexpected issue %q: %s", code, issue.Message)
	}
}

// ─── Game servers ────────────────────────────────────────────────────────────

func TestReport_GameServerForFriends(t *testing.T) {
	plan := Plan{Uplink: Uplink{DownMbps: 300, UpMbps: 20, CGNAT: "no", PublicHost: "play.example.org"}}
	report := ComputeReport(homeNetwork(plan, gameGuest("vm1", "Valheim", "valheim", 10, ExposurePortForward, 0)))

	if report.Status != StatusOK || len(report.Issues) != 0 {
		t.Fatalf("a well-sized server on a good line should have nothing to fix: %v", report.Issues)
	}
	if report.Kind != KindGameServer || report.Revision != 7 || report.Party != nil {
		t.Fatalf("unexpected report header: %+v", report)
	}

	server := report.Servers[0]
	if server.Game != "Valheim Server" || server.HostName != "Game host" || server.Players != 10 {
		t.Fatalf("server = %+v", server)
	}
	if server.Needed.RAMMB != 4608 || server.Needed.CPUCores != 2.5 {
		t.Fatalf("sizing = %+v", server.Needed)
	}
	// A container publishes on the host, and friends use the public name.
	if server.TargetIP != "192.168.1.150" || server.Address != "play.example.org:2456" {
		t.Fatalf("addresses = %q %q", server.TargetIP, server.Address)
	}

	if len(report.PortForwards) != 2 {
		t.Fatalf("Valheim needs two forwards, got %+v", report.PortForwards)
	}
	for i, port := range []int{2456, 2457} {
		forward := report.PortForwards[i]
		if forward.RouterID != "router" || forward.Proto != "udp" || forward.ExternalPort != port || forward.TargetPort != port || forward.TargetIP != "192.168.1.150" || forward.Hop != 1 {
			t.Errorf("forward %d = %+v", i, forward)
		}
	}
	// 10 remote players at 150 kbps each.
	if report.Uplink == nil || report.Uplink.NeededUpMbps != 1.5 || report.Uplink.UsedPct != 7.5 {
		t.Fatalf("uplink = %+v", report.Uplink)
	}
}

func TestReport_UploadAndCGNAT(t *testing.T) {
	server := gameGuest("vm1", "Valheim", "valheim", 10, ExposurePortForward, 0)

	short := ComputeReport(homeNetwork(Plan{Uplink: Uplink{UpMbps: 1, CGNAT: "no"}}, server))
	wantIssue(t, short, "upload_short", SeverityError)
	if short.Status != StatusError {
		t.Errorf("status = %s", short.Status)
	}

	tight := ComputeReport(homeNetwork(Plan{Uplink: Uplink{UpMbps: 1.8, CGNAT: "no"}}, server))
	wantIssue(t, tight, "upload_tight", SeverityWarning)
	if tight.Status != StatusWarning {
		t.Errorf("status = %s", tight.Status)
	}

	// Nothing filled in: the report says what to enter and what to check, without alarm.
	blank := ComputeReport(homeNetwork(Plan{}, server))
	wantIssue(t, blank, "uplink_unknown", SeverityInfo)
	hint := wantIssue(t, blank, "cgnat_unknown", SeverityInfo)
	if !strings.Contains(hint.Fix, "Router") {
		t.Errorf("the hint should name the router to look at: %q", hint.Fix)
	}
	if blank.Status != StatusOK {
		t.Errorf("hints alone must not turn the status, got %s", blank.Status)
	}
	if blank.Servers[0].Address != "your public address:2456" {
		t.Errorf("address without a public host = %q", blank.Servers[0].Address)
	}

	cgnat := ComputeReport(homeNetwork(Plan{Uplink: Uplink{UpMbps: 20, CGNAT: "yes"}}, server))
	blocked := wantIssue(t, cgnat, "cgnat_port_forward", SeverityError)
	if !strings.Contains(blocked.Fix, "VPN") {
		t.Errorf("the fix should point at the alternatives: %q", blocked.Fix)
	}
	// Errors come first.
	if cgnat.Issues[0].Severity != SeverityError {
		t.Errorf("issues are not sorted by severity: %v", issueCodes(cgnat))
	}
}

func TestReport_ExposureDecidesWhatIsNeeded(t *testing.T) {
	plan := Plan{Uplink: Uplink{UpMbps: 20, CGNAT: "yes"}}

	lan := ComputeReport(homeNetwork(plan, gameGuest("vm1", "Valheim", "valheim", 10, ExposureLAN, 0)))
	if lan.Uplink != nil || len(lan.PortForwards) != 0 || len(lan.Issues) != 0 {
		t.Fatalf("a LAN-only server needs nothing from the internet line: %+v %v", lan.Uplink, lan.Issues)
	}
	if lan.Servers[0].Address != "192.168.1.150:2456" {
		t.Errorf("LAN address = %q", lan.Servers[0].Address)
	}

	// A VPN works behind carrier-grade NAT and needs no forward, but still uses upload.
	vpn := ComputeReport(homeNetwork(plan, gameGuest("vm1", "Valheim", "valheim", 10, ExposureVPN, 0)))
	if len(vpn.PortForwards) != 0 || vpn.Uplink == nil || vpn.Uplink.NeededUpMbps != 1.5 {
		t.Fatalf("vpn: %+v %+v", vpn.PortForwards, vpn.Uplink)
	}
	wantNoIssue(t, vpn, "cgnat_port_forward")
	if vpn.Servers[0].Address != "192.168.1.150:2456 (over the VPN)" {
		t.Errorf("VPN address = %q", vpn.Servers[0].Address)
	}

	relay := ComputeReport(homeNetwork(plan, gameGuest("vm1", "Valheim", "valheim", 10, ExposureRelay, 0)))
	if len(relay.PortForwards) != 0 || !strings.Contains(relay.Servers[0].Address, "relay") {
		t.Fatalf("relay: %+v", relay.Servers[0])
	}
}

func TestReport_PortConflictsAndOffsets(t *testing.T) {
	plan := Plan{Uplink: Uplink{UpMbps: 50, CGNAT: "no"}}

	clash := ComputeReport(homeNetwork(plan,
		gameGuest("vm1", "Survival", "minecraft_java", 10, ExposurePortForward, 0),
		gameGuest("vm2", "Creative", "minecraft_java", 10, ExposurePortForward, 0),
	))
	wantIssue(t, clash, "host_port_conflict", SeverityError)
	conflict := wantIssue(t, clash, "port_conflict", SeverityError)
	if !strings.Contains(conflict.Message, "Survival") || !strings.Contains(conflict.Message, "Creative") || conflict.VMID != "vm2" {
		t.Errorf("the conflict should name both servers: %+v", conflict)
	}

	fixed := ComputeReport(homeNetwork(plan,
		gameGuest("vm1", "Survival", "minecraft_java", 10, ExposurePortForward, 0),
		gameGuest("vm2", "Creative", "minecraft_java", 10, ExposurePortForward, 1),
	))
	wantNoIssue(t, fixed, "host_port_conflict")
	wantNoIssue(t, fixed, "port_conflict")
	if len(fixed.PortForwards) != 2 || fixed.PortForwards[0].ExternalPort != 25565 || fixed.PortForwards[1].ExternalPort != 25566 {
		t.Fatalf("forwards with an offset = %+v", fixed.PortForwards)
	}
	if fixed.Servers[1].Address != "your public address:25566" {
		t.Errorf("the second server is joined on its own port, got %q", fixed.Servers[1].Address)
	}

	// Two VMs have their own addresses, so only the router sees the clash.
	vms := homeNetwork(plan,
		gameGuest("vm1", "Survival", "minecraft_java", 10, ExposurePortForward, 0),
		gameGuest("vm2", "Creative", "minecraft_java", 10, ExposurePortForward, 0),
	)
	for i := range vms.Nodes[3].Guests {
		vms.Nodes[3].Guests[i].Type = "vm"
		vms.Nodes[3].Guests[i].IP = []string{"192.168.1.151", "192.168.1.152"}[i]
	}
	report := ComputeReport(vms)
	wantNoIssue(t, report, "host_port_conflict")
	wantIssue(t, report, "port_conflict", SeverityError)
	if report.Servers[1].TargetIP != "192.168.1.152" {
		t.Errorf("a VM is the target of its own forward, got %q", report.Servers[1].TargetIP)
	}
}

func TestReport_DoubleNATAndPaths(t *testing.T) {
	plan := Plan{Uplink: Uplink{UpMbps: 50, CGNAT: "no"}}
	server := gameGuest("vm1", "Valheim", "valheim", 5, ExposurePortForward, 0)

	nested := homeNetwork(plan, server)
	nested.Nodes = append(nested.Nodes, ReportNode{ID: "inner", Name: "Mesh router", Type: "router", IP: "192.168.1.20", IsRouter: true})
	nested.Links = []ReportLink{
		{A: "modem", B: "router", Kind: LinkEthernet},
		{A: "router", B: "inner", Kind: LinkEthernet},
		{A: "inner", B: "server", Kind: LinkEthernet},
	}
	report := ComputeReport(nested)
	wantIssue(t, report, "double_nat", SeverityWarning)
	if len(report.PortForwards) != 4 {
		t.Fatalf("two ports through two routers are four rules, got %+v", report.PortForwards)
	}
	outer, inner := report.PortForwards[0], report.PortForwards[1]
	// The outer router forwards to the inner router, which forwards to the host.
	if outer.RouterID != "router" || outer.Hop != 1 || outer.TargetIP != "192.168.1.20" {
		t.Errorf("outer rule = %+v", outer)
	}
	if inner.RouterID != "inner" || inner.Hop != 2 || inner.TargetIP != "192.168.1.150" {
		t.Errorf("inner rule = %+v", inner)
	}

	// Without a modem on the canvas the first router is taken as the edge.
	noModem := homeNetwork(plan, server)
	noModem.Nodes = noModem.Nodes[1:]
	noModem.Links = noModem.Links[1:]
	if report := ComputeReport(noModem); len(report.PortForwards) != 2 || report.PortForwards[0].RouterID != "router" {
		t.Fatalf("expected the router to be the edge: %+v", report.PortForwards)
	}

	// A host that is not plugged in cannot be reached at all.
	island := homeNetwork(plan, server)
	island.Links = island.Links[:2]
	unreachable := wantIssue(t, ComputeReport(island), "no_wan_path", SeverityError)
	if unreachable.NodeID != "server" || unreachable.VMID != "vm1" {
		t.Errorf("the issue should point at the host and the server: %+v", unreachable)
	}

	// A VPN tunnel is not a path for a port forward.
	tunnel := homeNetwork(plan, server)
	tunnel.Links[2].Kind = LinkVPN
	wantIssue(t, ComputeReport(tunnel), "no_wan_path", SeverityError)

	// A rented server already has a public address.
	vps := ReportInput{Kind: KindGameServer, Plan: plan, Nodes: []ReportNode{
		{ID: "vps", Name: "VPS", Type: "vps", IP: "10.0.0.5", PublicIP: "203.0.113.5", IsInternetEdge: true, Guests: []ReportGuest{server}},
	}}
	direct := ComputeReport(vps)
	wantIssue(t, direct, "public_host_direct", SeverityInfo)
	wantNoIssue(t, direct, "cgnat_unknown")
	if len(direct.PortForwards) != 0 || direct.Servers[0].Address != "203.0.113.5:2456" {
		t.Fatalf("a VPS needs no forward: %+v %q", direct.PortForwards, direct.Servers[0].Address)
	}
}

func TestReport_SizingAgainstTheHost(t *testing.T) {
	plan := Plan{}

	small := gameGuest("vm1", "Valheim", "valheim", 10, ExposureLAN, 0)
	small.RAMMB, small.CPUCores = 2048, 1
	undersized := wantIssue(t, ComputeReport(homeNetwork(plan, small)), "server_undersized", SeverityWarning)
	if !strings.Contains(undersized.Message, "2 GB") || !strings.Contains(undersized.Message, "4.5 GB") {
		t.Errorf("the message should compare what is set with what is needed: %q", undersized.Message)
	}

	// Palworld alone wants about 15 GB: too much for an 8 GB mini PC.
	tiny := homeNetwork(plan, gameGuest("vm1", "Palworld", "palworld", 8, ExposureLAN, 0))
	tiny.Nodes[3].RAMMB, tiny.Nodes[3].CPUCores = 8192, 4
	wantIssue(t, ComputeReport(tiny), "host_ram_short", SeverityError)

	// Other services on the host count too.
	shared := homeNetwork(plan, gameGuest("vm1", "Valheim", "valheim", 10, ExposureLAN, 0), ReportGuest{ID: "vm2", Name: "Plex", Type: "container", RAMMB: 10240, CPUCores: 6})
	shared.Nodes[3].RAMMB, shared.Nodes[3].CPUCores = 16384, 8
	report := ComputeReport(shared)
	wantIssue(t, report, "host_ram_tight", SeverityWarning)
	wantIssue(t, report, "host_cpu_short", SeverityWarning)

	// A host whose size is not filled in is not judged.
	unknown := homeNetwork(plan, gameGuest("vm1", "Palworld", "palworld", 8, ExposureLAN, 0))
	unknown.Nodes[3].RAMMB, unknown.Nodes[3].CPUCores = 0, 0
	if report := ComputeReport(unknown); len(report.Issues) != 0 {
		t.Errorf("unexpected issues for a host of unknown size: %v", issueCodes(report))
	}

	wantIssue(t, ComputeReport(homeNetwork(plan, gameGuest("vm1", "Valheim", "valheim", 20, ExposureLAN, 0))), "players_above_estimate", SeverityWarning)

	broken := ComputeReport(homeNetwork(plan, gameGuest("vm1", "Mystery", "pong", 4, ExposureLAN, 0)))
	wantIssue(t, broken, "game_settings_invalid", SeverityError)
	if len(broken.Servers) != 0 {
		t.Errorf("a server with unknown settings is not listed: %+v", broken.Servers)
	}

	empty := wantIssue(t, ComputeReport(homeNetwork(plan)), "no_game_servers", SeverityInfo)
	if empty.Fix == "" {
		t.Error("the empty state should say what to do next")
	}
	// A homelab without games is just a homelab.
	lab := homeNetwork(plan)
	lab.Kind = KindHomelab
	if report := ComputeReport(lab); len(report.Issues) != 0 || report.Party != nil {
		t.Errorf("a homelab without games has no gaming findings: %v", issueCodes(report))
	}
}

// ─── LAN party ───────────────────────────────────────────────────────────────

func table(id string, seats int, circuit string) ReportNode {
	return ReportNode{ID: id, Name: "Table " + id, Type: "lan_table", Seats: seats, SwitchPorts: 16, SwitchGbps: 1,
		PowerDraw: float64(seats*350 + 10), Circuit: circuit}
}

// partyNetwork is a router and a core switch with the given tables on it.
func partyNetwork(plan Plan, tables ...ReportNode) ReportInput {
	seats := 0
	for _, node := range tables {
		seats += node.Seats
	}
	input := ReportInput{
		Kind: KindLANParty, Plan: plan,
		Nodes: []ReportNode{
			{ID: "router", Name: "Router", Type: "router", IP: "192.168.1.1", IsRouter: true, IsHub: true, PortsTotal: 4, PortsUsed: 1,
				DHCP: &DHCPPool{Enabled: true, Start: "192.168.1.50", End: "192.168.1.149", Size: 100, Clients: seats}},
			{ID: "core", Name: "Core switch", Type: "switch", IsHub: true, PortsTotal: 24, PortsUsed: 1 + len(tables)},
		},
		Links: []ReportLink{{A: "router", B: "core", Kind: LinkEthernet, Gbps: 1}},
	}
	for _, node := range tables {
		input.Nodes = append(input.Nodes, node)
		input.Links = append(input.Links, ReportLink{A: "core", B: node.ID, Kind: LinkEthernet, Gbps: 1})
	}
	return input
}

func venue() Plan {
	return Plan{
		Uplink: Uplink{DownMbps: 500, UpMbps: 50},
		Power: Power{MainsVoltage: 230, Circuits: []Circuit{
			{ID: "c1", Label: "Hall left", BreakerAmps: 16},
			{ID: "c2", Label: "Hall right", BreakerAmps: 16},
		}},
		Event: Event{Date: "2026-11-14", Hours: 24},
	}
}

func TestReport_PartyThatFits(t *testing.T) {
	// Four tables of 4 on two 16 A circuits: 2820 W each, under the 2944 W that is safe for hours.
	report := ComputeReport(partyNetwork(venue(), table("a", 4, "c1"), table("b", 4, "c1"), table("c", 4, "c2"), table("d", 4, "c2")))

	party := report.Party
	if party == nil || party.Seats != 16 || len(party.Tables) != 4 {
		t.Fatalf("party = %+v", party)
	}
	if party.TotalWatts != 5640 || party.UnassignedWatts != 0 || party.EnergyKWh != 135.4 {
		t.Fatalf("power totals = %v W, %v W unassigned, %v kWh", party.TotalWatts, party.UnassignedWatts, party.EnergyKWh)
	}
	left := party.Circuits[0]
	if left.ID != "c1" || left.Watts != 2820 || left.CapacityWatts != 3680 || left.ContinuousWatts != 2944 || left.UsedPct != 76.6 {
		t.Fatalf("circuit = %+v", left)
	}
	if party.Tables[0].UplinkTo != "Core switch" || party.Tables[0].UplinkGbps != 1 {
		t.Errorf("table uplink = %+v", party.Tables[0])
	}
	if len(party.Switches) != 2 || party.Switches[1].Free != 19 {
		t.Errorf("switch ports = %+v", party.Switches)
	}
	if len(party.DHCP) != 1 || party.DHCP[0].Needed != 16 || party.DHCP[0].Size != 100 {
		t.Errorf("leases = %+v", party.DHCP)
	}
	// The only finding is a suggestion.
	if report.Status != StatusOK {
		t.Fatalf("status = %s: %v", report.Status, report.Issues)
	}
	wantIssue(t, report, "lancache_suggested", SeverityInfo)
	if len(report.Issues) != 1 {
		t.Errorf("unexpected issues: %v", issueCodes(report))
	}
}

func TestReport_PartyPower(t *testing.T) {
	// Three tables of 4 on one 16 A circuit is 4230 W: the breaker trips at 3680 W.
	overloaded := ComputeReport(partyNetwork(venue(), table("a", 4, "c1"), table("b", 4, "c1"), table("c", 4, "c1")))
	tripped := wantIssue(t, overloaded, "circuit_overloaded", SeverityError)
	if !strings.Contains(tripped.Message, "Hall left") || !strings.Contains(tripped.Message, "4230") {
		t.Errorf("message = %q", tripped.Message)
	}

	// 3160 W holds, but not for a whole night.
	warm := ComputeReport(partyNetwork(venue(), table("a", 5, "c1"), table("b", 4, "c1")))
	wantIssue(t, warm, "circuit_over_80", SeverityWarning)
	wantNoIssue(t, warm, "circuit_overloaded")

	unassigned := ComputeReport(partyNetwork(venue(), table("a", 4, "c1"), table("b", 4, "")))
	loose := wantIssue(t, unassigned, "power_unassigned", SeverityWarning)
	if !strings.Contains(loose.Message, "1410") {
		t.Errorf("message = %q", loose.Message)
	}

	wantIssue(t, ComputeReport(partyNetwork(venue(), table("a", 4, "garage"))), "circuit_unknown", SeverityWarning)

	noVoltage := venue()
	noVoltage.Power.MainsVoltage = 0
	report := ComputeReport(partyNetwork(noVoltage, table("a", 4, "c1")))
	wantIssue(t, report, "mains_voltage_missing", SeverityWarning)
	if report.Party.Circuits[0].CapacityWatts != 0 {
		t.Errorf("no capacity can be known without the voltage: %+v", report.Party.Circuits[0])
	}

	noCircuits := venue()
	noCircuits.Power.Circuits = nil
	total := wantIssue(t, ComputeReport(partyNetwork(noCircuits, table("a", 4, ""))), "power_no_circuits", SeverityInfo)
	if !strings.Contains(total.Message, "1410") {
		t.Errorf("message = %q", total.Message)
	}
}

func TestReport_PartyNetwork(t *testing.T) {
	plan := venue()

	// A table nobody plugged in.
	loose := partyNetwork(plan, table("a", 8, "c1"))
	loose.Links = loose.Links[:1]
	wantIssue(t, ComputeReport(loose), "table_no_uplink", SeverityError)

	// Eight players on an 8-port switch leave no port for the uplink.
	cramped := table("a", 8, "c1")
	cramped.SwitchPorts = 8
	small := wantIssue(t, ComputeReport(partyNetwork(plan, cramped)), "table_switch_small", SeverityError)
	if !strings.Contains(small.Message, "9 ports") {
		t.Errorf("message = %q", small.Message)
	}

	slow := partyNetwork(plan, table("a", 8, "c1"))
	slow.Links[1].Gbps = 0.1
	wantIssue(t, ComputeReport(slow), "table_uplink_slow", SeverityWarning)

	fast := table("a", 8, "c1")
	fast.SwitchGbps = 2.5
	wantIssue(t, ComputeReport(partyNetwork(plan, fast)), "table_uplink_bottleneck", SeverityInfo)

	off := partyNetwork(plan, table("a", 8, "c1"))
	off.Nodes[0].DHCP = &DHCPPool{Clients: 8}
	wantIssue(t, ComputeReport(off), "dhcp_off", SeverityError)

	crowded := partyNetwork(plan, table("a", 8, "c1"))
	crowded.Nodes[0].DHCP.Clients = 240
	leases := wantIssue(t, ComputeReport(crowded), "dhcp_pool_short", SeverityError)
	if !strings.Contains(leases.Fix, "255.255.254.0") {
		t.Errorf("fix = %q", leases.Fix)
	}

	headless := partyNetwork(plan, table("a", 8, "c1"))
	headless.Nodes[0].IsRouter, headless.Nodes[0].DHCP = false, nil
	wantIssue(t, ComputeReport(headless), "no_router", SeverityError)

	// More unplugged tables than free ports.
	full := partyNetwork(plan, table("a", 8, "c1"), table("b", 8, "c2"))
	full.Links = full.Links[:1]
	full.Nodes[0].PortsUsed, full.Nodes[1].PortsUsed = 4, 23
	wantIssue(t, ComputeReport(full), "switch_ports_short", SeverityWarning)

	thin := venue()
	thin.Uplink.DownMbps = 50
	share := wantIssue(t, ComputeReport(partyNetwork(thin, table("a", 8, "c1"), table("b", 8, "c2"))), "download_per_seat_low", SeverityWarning)
	if !strings.Contains(share.Message, "3.1 Mbps each") {
		t.Errorf("message = %q", share.Message)
	}

	blank := venue()
	blank.Uplink = Uplink{}
	wantIssue(t, ComputeReport(partyNetwork(blank, table("a", 4, "c1"))), "download_unknown", SeverityInfo)

	wantIssue(t, ComputeReport(partyNetwork(plan)), "no_seats", SeverityInfo)
}

func TestReport_PartySeatsBeyondTables(t *testing.T) {
	input := partyNetwork(venue(), table("a", 8, "c1"))
	input.Nodes = append(input.Nodes,
		ReportNode{ID: "ap", Name: "AP", Type: "access_point", WifiClients: 20},
		ReportNode{ID: "ps5", Name: "PS5", Type: "console", PowerDraw: 200, Circuit: "c2"},
		ReportNode{ID: "deck", Name: "Deck", Type: "console", PowerDraw: 25, Circuit: "c2"},
		ReportNode{ID: "cache", Name: "Cache box", Type: "server_v2", PowerDraw: 120, Circuit: "c2",
			Guests: []ReportGuest{gameGuest("vm1", "LANCache", "lancache", 0, ExposureLAN, 0)}},
	)
	input.Links = append(input.Links,
		ReportLink{A: "core", B: "ap", Kind: LinkWireless},
		ReportLink{A: "core", B: "ps5", Kind: LinkEthernet, Gbps: 1},
		ReportLink{A: "ap", B: "deck", Kind: LinkWireless},
		ReportLink{A: "core", B: "cache", Kind: LinkEthernet, Gbps: 1},
	)

	report := ComputeReport(input)
	party := report.Party
	// Eight seats at the table, plus the two consoles drawn on their own.
	if party.Seats != 10 || party.WifiPlayers != 1 || party.WifiClients != 20 {
		t.Fatalf("seats=%d wifi players=%d wifi clients=%d", party.Seats, party.WifiPlayers, party.WifiClients)
	}
	wifi := wantIssue(t, report, "wifi_players", SeverityWarning)
	if !strings.Contains(wifi.Message, "1 players") {
		t.Errorf("message = %q", wifi.Message)
	}
	if !party.HasLANCache {
		t.Error("the cache on the server should be found")
	}
	wantNoIssue(t, report, "lancache_suggested")
	// The cache is a tool: listed as a server, never asked to be forwarded.
	if len(report.Servers) != 1 || report.Servers[0].Role != RoleTool || len(report.PortForwards) != 0 {
		t.Fatalf("servers = %+v", report.Servers)
	}
	if party.Circuits[1].Watts != 345 {
		t.Errorf("every powered device counts towards its circuit, got %v W", party.Circuits[1].Watts)
	}

	// The party checks also run for a homelab that has a table in it.
	input.Kind = KindHomelab
	if ComputeReport(input).Party == nil {
		t.Error("a build with a LAN table gets the party checks")
	}
}
