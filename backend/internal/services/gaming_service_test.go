package services

import (
	"archive/zip"
	"bytes"
	"errors"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/gaming"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

func gameService(slug string) *models.Service {
	profile, _ := gaming.ProfileBySlug(slug)
	return &models.Service{ID: uuid.MustParse(profile.ServiceID), Name: profile.Name, Category: "gaming", Game: &profile}
}

// ─── Proposal engine ─────────────────────────────────────────────────────────

func TestApplyOps_GameServerSizing(t *testing.T) {
	f := newOpsFixture()
	valheim, jellyfinID := gameService("valheim"), uuid.New()
	opts := ApplyOptions{UserID: uuid.New(), Catalog: fakeCatalog{services: map[uuid.UUID]*models.Service{
		valheim.ID: valheim,
		jellyfinID: {ID: jellyfinID, Name: "Jellyfin"},
	}}}

	result, err := ApplyTopologyOps(f.base, []TopologyOp{
		{Op: "add_vm", Ref: "game", Host: f.server, CatalogServiceID: valheim.ID.String()},
		{Op: "add_vm", Ref: "media", Host: f.server, CatalogServiceID: jellyfinID.String()},
	}, opts)
	if err != nil {
		t.Fatalf("add game server: %v", err)
	}
	host := findNode(t, result.Input, f.server)
	server := host.VMs[0]
	// A game from the catalog is a LAN-only server for the usual group, sized for it.
	instance, found, err := gaming.ParseInstance(server.Details[gaming.InstanceKey])
	if err != nil || !found || instance != (gaming.Instance{Profile: "valheim", Players: 5, Exposure: gaming.ExposureLAN}) {
		t.Fatalf("instance = %+v found=%v err=%v", instance, found, err)
	}
	if server.RAMMB != 4096 || server.CPUCores != 2 || server.Name != "Valheim Server" {
		t.Fatalf("server sized for 5 players = %+v", server)
	}
	if _, isGame := host.VMs[1].Details[gaming.InstanceKey]; isGame {
		t.Fatalf("an ordinary service must not become a game server: %+v", host.VMs[1])
	}

	// More players resize it; opening it to friends is one field.
	grown, err := ApplyTopologyOps(result.Input, []TopologyOp{
		{Op: "update_vm", VM: server.ID, Players: numPtr(10), Exposure: strPtr("Port_Forward"), PortOffset: numPtr(10)},
	}, opts)
	if err != nil {
		t.Fatalf("resize: %v", err)
	}
	bigger := findNode(t, grown.Input, f.server).VMs[0]
	instance, _, _ = gaming.ParseInstance(bigger.Details[gaming.InstanceKey])
	if instance != (gaming.Instance{Profile: "valheim", Players: 10, Exposure: gaming.ExposurePortForward, PortOffset: 10}) {
		t.Fatalf("instance after update = %+v", instance)
	}
	if bigger.RAMMB != 4608 || bigger.CPUCores != 2.5 {
		t.Fatalf("server sized for 10 players = %d MB / %v cores", bigger.RAMMB, bigger.CPUCores)
	}

	// Memory given in the same operation is the user's call.
	pinned, err := ApplyTopologyOps(result.Input, []TopologyOp{{Op: "update_vm", VM: server.ID, Players: numPtr(10), RAMMB: numPtr(8192)}}, opts)
	if err != nil {
		t.Fatalf("pinned: %v", err)
	}
	if vm := findNode(t, pinned.Input, f.server).VMs[0]; vm.RAMMB != 8192 || vm.CPUCores != 2.5 {
		t.Fatalf("explicit memory must win: %+v", vm)
	}
	// Changing only the exposure leaves the size alone.
	exposed, err := ApplyTopologyOps(pinned.Input, []TopologyOp{{Op: "update_vm", VM: server.ID, Exposure: strPtr("vpn")}}, opts)
	if err != nil {
		t.Fatalf("exposure: %v", err)
	}
	if vm := findNode(t, exposed.Input, f.server).VMs[0]; vm.RAMMB != 8192 {
		t.Fatalf("exposure must not resize the server: %+v", vm)
	}

	rejected := []struct {
		name string
		op   TopologyOp
		want string
	}{
		{"players on an ordinary service", TopologyOp{Op: "update_vm", VM: host.VMs[1].ID, Players: numPtr(4)}, "not a game server"},
		{"unknown exposure", TopologyOp{Op: "update_vm", VM: server.ID, Exposure: strPtr("public")}, "exposure must be one of"},
		{"half a player", TopologyOp{Op: "update_vm", VM: server.ID, Players: numPtr(2.5)}, "whole number"},
		{"offset out of range", TopologyOp{Op: "update_vm", VM: server.ID, PortOffset: numPtr(5000)}, "port_offset"},
	}
	for _, test := range rejected {
		t.Run(test.name, func(t *testing.T) {
			if err := applyError(t, result.Input, opts, test.op); !strings.Contains(err.Message, test.want) {
				t.Fatalf("expected %q in %q", test.want, err.Message)
			}
		})
	}
}

func TestValidateTopologyRules_GameSettings(t *testing.T) {
	server := func(game map[string]any) []NodeDTO {
		return []NodeDTO{{ID: "server", Type: "server_v2", Name: "Host", VMs: []VMDTO{{ID: "vm", Name: "Game", Details: map[string]any{"game": game}}}}}
	}
	if err := validateEdgeEndpoints(server(map[string]any{"profile": "valheim", "players": float64(8), "exposure": "port_forward", "port_offset": float64(0)}), nil); err != nil {
		t.Fatalf("valid game settings rejected: %v", err)
	}
	for name, game := range map[string]map[string]any{
		"unknown profile":  {"profile": "pong"},
		"unknown exposure": {"profile": "valheim", "exposure": "public"},
		"too many players": {"profile": "valheim", "players": float64(99999)},
	} {
		if err := validateEdgeEndpoints(server(game), nil); !errors.Is(err, ErrInvalidTopology) {
			t.Errorf("%s: expected ErrInvalidTopology, got %v", name, err)
		}
	}
}

// ─── Report and export, end to end ───────────────────────────────────────────

func readZip(t *testing.T, archive []byte) map[string]string {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	entries := map[string]string{}
	for _, file := range reader.File {
		stream, err := file.Open()
		if err != nil {
			t.Fatalf("open %s: %v", file.Name, err)
		}
		contents, _ := io.ReadAll(stream)
		_ = stream.Close()
		entries[file.Name] = string(contents)
	}
	return entries
}

func TestGamingService_GameServerPlan(t *testing.T) {
	if os.Getenv("IPAM_URL") == "" {
		t.Skip("skipping: IPAM_URL not set (hlbIPAM not running)")
	}
	tx := testTx(t)
	builds := NewBuildService(tx)
	user := models.User{Email: uuid.NewString() + "@game.test", GoogleID: uuid.NewString()}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	plan := &gaming.Plan{Uplink: gaming.Uplink{DownMbps: 300, UpMbps: 20, CGNAT: "no", PublicHost: "play.example.org"}}
	build, err := builds.Create(user.ID, SyncGraphInput{Name: "Friends server", Kind: "game_server", GamingPlan: plan})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	modem, router, host := uuid.NewString(), uuid.NewString(), uuid.NewString()
	valheim, minecraft, pihole := uuid.NewString(), uuid.NewString(), uuid.NewString()
	instance := func(profile string, players int, exposure string) map[string]any {
		return map[string]any{"game": gaming.Instance{Profile: profile, Players: players, Exposure: exposure}.Details()}
	}
	saved, err := builds.UpdateAndCalculate(build.ID, user.ID, SyncGraphInput{
		Name: "Friends server", Revision: build.Revision,
		Nodes: []NodeDTO{
			{ID: modem, Type: "modem", Name: "Modem", Details: map[string]any{"ports": float64(2)}},
			{ID: router, Type: "router", Name: "Router", IP: "192.168.1.1", Details: map[string]any{"dhcp_enabled": true, "ports": float64(4)}},
			{ID: host, Type: "server_v2", Name: "Game Host", Details: map[string]any{"cpu": float64(8), "ram": float64(32)}, VMs: []VMDTO{
				{ID: valheim, Name: "Valheim", Type: "container", Status: "running", CPUCores: 2.5, RAMMB: 4608, Details: instance("valheim", 10, "port_forward")},
				{ID: minecraft, Name: "Minecraft", Type: "container", Status: "running", Details: instance("minecraft_java", 10, "lan")},
				{ID: pihole, Name: "Pi-hole", Type: "container", Status: "running"},
			}},
		},
		Edges: []EdgeDTO{
			{Source: modem, SourceHandle: "eth0", Target: router, TargetHandle: TargetHandle},
			{Source: router, SourceHandle: "eth0", Target: host, TargetHandle: TargetHandle},
		},
	}, NewIPService(tx))
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	hostIP := ""
	for _, node := range saved.Nodes {
		if node.ID.String() == host {
			hostIP = node.IP
		}
	}
	if hostIP == "" {
		t.Fatal("the host should have an address after the save")
	}

	service := NewGamingService(builds)
	report, err := service.Report(build.ID, user.ID)
	if err != nil {
		t.Fatalf("report: %v", err)
	}
	if report.Kind != gaming.KindGameServer || report.Revision != saved.Revision || report.Status != gaming.StatusOK {
		t.Fatalf("report header = %+v, issues %v", report, report.Issues)
	}
	if len(report.Servers) != 2 || len(report.PortForwards) != 2 {
		t.Fatalf("expected two game servers and Valheim's two forwards, got %+v / %+v", report.Servers, report.PortForwards)
	}
	forward := report.PortForwards[0]
	if forward.RouterName != "Router" || forward.TargetIP != hostIP || forward.ExternalPort != 2456 || forward.Proto != "udp" {
		t.Fatalf("forward = %+v", forward)
	}
	if report.Servers[0].Address != "play.example.org:2456" || report.Uplink.NeededUpMbps != 1.5 {
		t.Fatalf("address %q, uplink %+v", report.Servers[0].Address, report.Uplink)
	}

	// The report is the owner's alone.
	if _, err := service.Report(build.ID, uuid.New()); !errors.Is(err, ErrBuildNotFound) {
		t.Fatalf("expected ErrBuildNotFound for another user, got %v", err)
	}

	// Deployment files: game servers get their own compose file per host.
	configs := NewConfigService(tx)
	bundle, err := configs.GenerateAll(build.ID, user.ID)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if len(bundle.GameCompose) != 1 || bundle.GameCompose[0].Host != "Game Host" || bundle.GameCompose[0].Folder != "game-host" || bundle.GameCompose[0].Services != 2 {
		t.Fatalf("game compose = %+v", bundle.GameCompose)
	}
	game := bundle.GameCompose[0].Compose
	if !strings.Contains(game, "ghcr.io/community-valheim-tools/valheim-server") || !strings.Contains(game, `"2456:2456/udp"`) || !strings.Contains(game, "itzg/minecraft-server") {
		t.Fatalf("game compose content:\n%s", game)
	}
	// The homelab compose keeps the ordinary service and only points at the game files.
	if !strings.Contains(bundle.DockerCompose, "pihole/pihole") || strings.Contains(bundle.DockerCompose, "valheim-server") {
		t.Fatalf("homelab compose content:\n%s", bundle.DockerCompose)
	}
	if !strings.Contains(bundle.DockerCompose, "# Valheim is a game server") {
		t.Fatalf("the homelab compose should say where the game servers went:\n%s", bundle.DockerCompose)
	}

	archive, _, err := configs.GenerateCompleteExport(build.ID, user.ID)
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	entries := readZip(t, archive)
	for _, required := range []string{"gaming/port-forwards.csv", "gaming/connect-sheet.md", "gaming/game-host/docker-compose.yml", "gaming/game-host/.env.example"} {
		if _, exists := entries[required]; !exists {
			t.Errorf("missing export entry %s", required)
		}
	}
	if _, exists := entries["gaming/party-plan.md"]; exists {
		t.Error("a game server plan has no party sheet")
	}
	if !strings.Contains(entries["gaming/port-forwards.csv"], "1,Router,Valheim,game,UDP,2456,"+hostIP+",2456") {
		t.Errorf("port forwards:\n%s", entries["gaming/port-forwards.csv"])
	}
	sheet := entries["gaming/connect-sheet.md"]
	if !strings.Contains(sheet, "`play.example.org:2456`") || !strings.Contains(sheet, "## Minecraft") || strings.Contains(sheet, "Pi-hole") {
		t.Errorf("connect sheet:\n%s", sheet)
	}
	if strings.Contains(entries["manifest.json"], "Valheim has no verified image") {
		t.Error("a game server is not an unverified service")
	}
}

func TestGamingService_PartyPlanExport(t *testing.T) {
	if os.Getenv("IPAM_URL") == "" {
		t.Skip("skipping: IPAM_URL not set (hlbIPAM not running)")
	}
	tx := testTx(t)
	builds := NewBuildService(tx)
	user := models.User{Email: uuid.NewString() + "@party.test", GoogleID: uuid.NewString()}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	plan := partyPlan()
	plan.Power.Circuits = append(plan.Power.Circuits, gaming.Circuit{ID: "c2", Label: "Stage", BreakerAmps: 16})
	build, err := builds.Create(user.ID, SyncGraphInput{Name: "Autumn LAN", Kind: "lan_party", GamingPlan: plan})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	router, core := uuid.NewString(), uuid.NewString()
	input := SyncGraphInput{
		Name: "Autumn LAN", Revision: build.Revision,
		Nodes: []NodeDTO{
			{ID: router, Type: "router", Name: "Router", IP: "192.168.1.1", Details: map[string]any{"dhcp_enabled": true, "ports": float64(4)}},
			{ID: core, Type: "switch", Name: "Core", Details: map[string]any{"ports": float64(24)}},
		},
		Edges: []EdgeDTO{{Source: router, SourceHandle: "eth0", Target: core, TargetHandle: TargetHandle}},
	}
	// Three tables of 4 on the first circuit overload it; the fourth is on the second.
	for i, circuit := range []string{"c1", "c1", "c1", "c2"} {
		id := uuid.NewString()
		details := map[string]any{"seats": float64(4), "seat_watts": float64(350), "switch_ports": float64(5), "circuit": circuit}
		input.Nodes = append(input.Nodes, NodeDTO{ID: id, Type: "lan_table", Name: "Table " + string(rune('A'+i)), PowerDraw: tablePowerDraw(details), Details: details})
		input.Edges = append(input.Edges, EdgeDTO{Source: core, SourceHandle: "eth" + string(rune('0'+i)), Target: id, TargetHandle: TargetHandle, Speed: "1 GbE"})
	}
	if _, err := builds.UpdateAndCalculate(build.ID, user.ID, input, NewIPService(tx)); err != nil {
		t.Fatalf("save: %v", err)
	}

	report, err := NewGamingService(builds).Report(build.ID, user.ID)
	if err != nil {
		t.Fatalf("report: %v", err)
	}
	party := report.Party
	if party == nil || party.Seats != 16 || party.TotalWatts != 5640 {
		t.Fatalf("party = %+v", party)
	}
	if len(party.DHCP) != 1 || !party.DHCP[0].Enabled || party.DHCP[0].Needed != 16 || party.DHCP[0].Size < 16 {
		t.Fatalf("leases = %+v", party.DHCP)
	}
	if party.Tables[0].UplinkTo != "Core" || party.Tables[0].UplinkGbps != 1 || party.Tables[0].SwitchPorts != 5 {
		t.Fatalf("table = %+v", party.Tables[0])
	}
	if party.Switches[0].Name != "Router" && party.Switches[1].Name != "Router" {
		t.Fatalf("switch ports should list the router and the core switch: %+v", party.Switches)
	}
	overloaded := false
	for _, issue := range report.Issues {
		overloaded = overloaded || issue.Code == "circuit_overloaded"
	}
	if !overloaded || report.Status != gaming.StatusError {
		t.Fatalf("4230 W on a 16 A circuit must be an error: %v", report.Issues)
	}

	archive, _, err := NewConfigService(tx).GenerateCompleteExport(build.ID, user.ID)
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	entries := readZip(t, archive)
	sheet, exists := entries["gaming/party-plan.md"]
	if !exists {
		t.Fatalf("missing gaming/party-plan.md, got %v", len(entries))
	}
	for _, want := range []string{"- Seats: 16", "| Table A | 4 | 5 ports | Core | 1410 W | c1 |", "| Hall | 16 A | 4230 W | 2944 W | 115% |", "**ERROR** Hall carries 4230 W"} {
		if !strings.Contains(sheet, want) {
			t.Errorf("party plan is missing %q:\n%s", want, sheet)
		}
	}
	if _, exists := entries["gaming/port-forwards.csv"]; exists {
		t.Error("a party without game servers has no port forwards file")
	}
}

func TestExport_HomelabGetsNoGamingFiles(t *testing.T) {
	tx := testTx(t)
	builds := NewBuildService(tx)
	user := models.User{Email: uuid.NewString() + "@lab.test", GoogleID: uuid.NewString()}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	build, err := builds.Create(user.ID, SyncGraphInput{Name: "Lab", Nodes: []NodeDTO{
		{ID: "router", Type: "router", Name: "Router", IP: "192.168.1.1"},
		{ID: "server", Type: "server", Name: "Server", VMs: []VMDTO{{ID: "pihole", Type: "container", Name: "Pi-hole"}}},
	}, Edges: []EdgeDTO{{Source: "router", Target: "server"}}})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	archive, _, err := NewConfigService(tx).GenerateCompleteExport(build.ID, user.ID)
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	for name := range readZip(t, archive) {
		if strings.HasPrefix(name, "gaming/") {
			t.Errorf("a homelab export must be unchanged, found %s", name)
		}
	}
}
