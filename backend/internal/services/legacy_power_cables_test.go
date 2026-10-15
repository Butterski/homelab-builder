package services

import (
	"encoding/json"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/version"
	"github.com/google/uuid"
)

// A build saved before power wiring, with the cables the old canvas stored
// for a UPS, refuses every save until they are converted.
func TestConvertLegacyPowerCables_BuildSavesAgain(t *testing.T) {
	tx := testTx(t)
	builds := NewBuildService(tx)
	ipam := newIPAMStub(t, tx)
	user := models.User{Email: uuid.NewString() + "@legacy.test", GoogleID: uuid.NewString()}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	build, err := builds.Create(user.ID, SyncGraphInput{Name: "Old rack"})
	if err != nil {
		t.Fatalf("create build: %v", err)
	}
	saved, err := builds.UpdateAndCalculate(build.ID, user.ID, SyncGraphInput{
		Name:     "Old rack",
		Revision: build.Revision,
		Nodes: []NodeDTO{
			{ID: "router", Type: "router", Name: "Router"},
			{ID: "switch", Type: "switch", Name: "Switch"},
			{ID: "ups", Type: "ups", Name: "UPS"},
			{ID: "pdu", Type: "pdu", Name: "PDU"},
			{ID: "vps", Type: "vps", Name: "VPS"},
		},
		Edges: []EdgeDTO{
			{Source: "router", SourceHandle: "eth0", Target: "switch", TargetHandle: TargetHandle},
			// Drawn after the upgrade, next to the old cable between the same two.
			{Source: "ups", SourceHandle: "pwr-out-0", Target: "router", TargetHandle: "pwr-in-0", Type: "power"},
		},
	}, ipam)
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	id := map[string]uuid.UUID{}
	for _, node := range saved.Nodes {
		id[node.Name] = node.ID
	}

	// What the old canvas stored: a UPS cable is an ethernet edge between
	// network handles, in whichever direction it was drawn.
	for i, old := range []models.Edge{
		{SourceNodeID: id["UPS"], SourceHandle: "eth0", TargetNodeID: id["Router"], TargetHandle: TargetHandle},
		{SourceNodeID: id["Switch"], SourceHandle: "eth3", TargetNodeID: id["UPS"], TargetHandle: TargetHandle},
		{SourceNodeID: id["PDU"], SourceHandle: "eth0", TargetNodeID: id["UPS"], TargetHandle: TargetHandle},
		{SourceNodeID: id["UPS"], SourceHandle: "eth1", TargetNodeID: id["VPS"], TargetHandle: TargetHandle},
	} {
		old.BuildID, old.Type, old.Speed = build.ID, "ethernet", "1 GbE"
		old.CreatedAt = time.Now().Add(time.Duration(i+1) * time.Second)
		if err := tx.Create(&old).Error; err != nil {
			t.Fatalf("store old cable: %v", err)
		}
	}
	resave := func() error {
		t.Helper()
		current, err := builds.GetByID(build.ID)
		if err != nil {
			t.Fatalf("load: %v", err)
		}
		input, err := BuildToSyncInput(current)
		if err != nil {
			t.Fatalf("snapshot: %v", err)
		}
		_, err = builds.UpdateAndCalculate(build.ID, user.ID, input, ipam)
		return err
	}
	if err := resave(); !errors.Is(err, ErrInvalidTopology) {
		t.Fatalf("expected the old cables to be refused, got %v", err)
	}

	report, err := ConvertLegacyPowerCables(tx)
	if err != nil {
		t.Fatalf("convert: %v", err)
	}
	if report != (LegacyPowerReport{Builds: 1, Converted: 2, Dropped: 2}) {
		t.Fatalf("unexpected report: %+v", report)
	}

	var edges []models.Edge
	if err := tx.Where("build_id = ? AND type = ?", build.ID, "power").Find(&edges).Error; err != nil {
		t.Fatalf("load cables: %v", err)
	}
	name := map[uuid.UUID]string{}
	for n, nodeID := range id {
		name[nodeID] = n
	}
	got := map[string]bool{}
	for _, edge := range edges {
		got[name[edge.SourceNodeID]+" "+edge.SourceHandle+" -> "+name[edge.TargetNodeID]+" "+edge.TargetHandle] = true
	}
	want := map[string]bool{
		"UPS pwr-out-0 -> Router pwr-in-0": true, // the one drawn since; the old one is gone
		"UPS pwr-out-1 -> Switch pwr-in-0": true, // drawn from the switch: the UPS still feeds it
		"UPS pwr-out-2 -> PDU pwr-in-0":    true, // a UPS feeds a PDU, not the other way round
	}
	if len(got) != len(want) || len(edges) != len(want) {
		t.Fatalf("power cables %v, want %v", got, want)
	}
	for cable := range want {
		if !got[cable] {
			t.Fatalf("power cables %v, want %v", got, want)
		}
	}
	var others int64
	tx.Model(&models.Edge{}).Where("build_id = ? AND type <> ?", build.ID, "power").Count(&others)
	if others != 1 {
		t.Fatalf("expected only the router-switch cable besides power, got %d", others)
	}

	var ups models.Node
	if err := tx.First(&ups, "id = ?", id["UPS"]).Error; err != nil {
		t.Fatalf("reload ups: %v", err)
	}
	var details struct {
		PowerLoad struct {
			SocketsUsed int `json:"sockets_used"`
		} `json:"power_load"`
	}
	if err := json.Unmarshal(ups.Details, &details); err != nil || details.PowerLoad.SocketsUsed != 3 {
		t.Fatalf("power_load not written: %s", ups.Details)
	}
	var after models.Build
	if err := tx.First(&after, "id = ?", build.ID).Error; err != nil {
		t.Fatalf("reload build: %v", err)
	}
	if after.Revision != saved.Revision+1 {
		t.Fatalf("revision %d, want %d so an open canvas reloads", after.Revision, saved.Revision+1)
	}

	if err := resave(); err != nil {
		t.Fatalf("save after conversion: %v", err)
	}
	if report, err := ConvertLegacyPowerCables(tx); err != nil || report != (LegacyPowerReport{}) {
		t.Fatalf("second run changed something: %+v, %v", report, err)
	}

	// The owner is told once what became of each old cable, by the names the
	// devices had.
	whatsNew := NewWhatsNewService(tx)
	state, err := whatsNew.Get(user.ID)
	if err != nil {
		t.Fatalf("what's new: %v", err)
	}
	if len(state.Notices) != 1 {
		t.Fatalf("expected one notice, got %+v", state.Notices)
	}
	notice := state.Notices[0]
	if notice.Kind != NoticePowerCables || notice.Version != version.Version || notice.SeenAt != nil ||
		notice.BuildID == nil || *notice.BuildID != build.ID || notice.BuildName != "Old rack" {
		t.Fatalf("unexpected notice: %+v", notice)
	}
	var told PowerCablesNotice
	if err := json.Unmarshal(notice.Details, &told); err != nil {
		t.Fatalf("decode notice: %v", err)
	}
	var lines []string
	for _, cable := range told.Converted {
		lines = append(lines, cable.Source+" > "+cable.Target)
	}
	for _, cable := range told.Dropped {
		lines = append(lines, cable.Source+" > "+cable.Target+": "+cable.Reason)
	}
	wantLines := []string{"UPS > Switch", "UPS > PDU", "UPS > Router: " + DropAlreadyJoined, "UPS > VPS: " + DropNoPowerInput}
	if !slices.Equal(lines, wantLines) {
		t.Fatalf("notice says %q, want %q", lines, wantLines)
	}
	if told.Converted[0].SourceID != id["UPS"].String() || told.Converted[0].TargetID != id["Switch"].String() {
		t.Fatalf("notice cables lost their devices: %+v", told.Converted[0])
	}

	// A deleted build is still named, and offers nothing to open.
	if err := builds.Delete(build.ID, user.ID); err != nil {
		t.Fatalf("delete build: %v", err)
	}
	state, err = whatsNew.Get(user.ID)
	if err != nil || len(state.Notices) != 1 || state.Notices[0].BuildID != nil || state.Notices[0].BuildName != "Old rack" {
		t.Fatalf("notice of a deleted build: %+v, %v", state, err)
	}
}

func TestPlanLegacyPowerCables_SocketsAndLoops(t *testing.T) {
	node := func(nodeType, details string) models.Node {
		return models.Node{ID: uuid.New(), Type: nodeType, Name: nodeType, Details: json.RawMessage(details)}
	}
	ups, pdu := node("ups", `{"outlets": 1}`), node("pdu", `{}`)
	serverA, serverB := node("server", `{}`), node("server", `{}`)
	cable := func(source, target models.Node, kind, sourceHandle, targetHandle string) models.Edge {
		return models.Edge{ID: uuid.New(), SourceNodeID: source.ID, TargetNodeID: target.ID, Type: kind, SourceHandle: sourceHandle, TargetHandle: targetHandle}
	}
	full := cable(ups, serverA, "power", "pwr-out-0", "pwr-in-0")
	extra := cable(ups, serverB, "ethernet", "eth0", TargetHandle)
	plan := planLegacyPowerCables([]models.Node{ups, serverA, serverB}, []models.Edge{full, extra})
	// The only socket is taken: the UPS gets one more rather than losing the cable.
	if len(plan.converted) != 1 || plan.converted[0].SourceHandle != "pwr-out-1" || plan.outlets[ups.ID] != 2 {
		t.Fatalf("unexpected plan: %+v", plan)
	}

	// The PDU already feeds the UPS: the old cable between them would close a loop.
	feed := cable(pdu, ups, "power", "pwr-out-0", "pwr-in-0")
	old := cable(ups, pdu, "ethernet", "eth0", TargetHandle)
	plan = planLegacyPowerCables([]models.Node{ups, pdu}, []models.Edge{feed, old})
	if len(plan.converted) != 0 || len(plan.dropped) != 1 || plan.dropped[0] != old.ID {
		t.Fatalf("unexpected plan: %+v", plan)
	}
}
