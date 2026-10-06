package services

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/gaming"
)

func proposalDiff(t *testing.T, raw json.RawMessage) ProposalDiff {
	t.Helper()
	var diff ProposalDiff
	if err := json.Unmarshal(raw, &diff); err != nil {
		t.Fatalf("diff: %v", err)
	}
	return diff
}

func fieldChange(changes []FieldChange, field string) (FieldChange, bool) {
	for _, change := range changes {
		if change.Field == field {
			return change, true
		}
	}
	return FieldChange{}, false
}

func TestProposal_SetPlanAloneIsAChange(t *testing.T) {
	f := newProposalFixture(t)

	proposal := f.propose(t, TopologyOp{Op: "set_plan", Kind: "game_server", Plan: map[string]any{
		"uplink": map[string]any{"up_mbps": float64(20), "cgnat": "no"},
	}})
	if proposal.Summary != "3 plan settings changed" {
		t.Fatalf("default summary = %q", proposal.Summary)
	}
	diff := proposalDiff(t, proposal.Diff)
	if diff.Counts.PlanChanged != 3 || diff.Counts.Total != 3 {
		t.Fatalf("counts = %+v", diff.Counts)
	}
	if change, ok := fieldChange(diff.Plan, "kind"); !ok || change.Before != "homelab" || change.After != "game_server" {
		t.Fatalf("kind change = %+v", diff.Plan)
	}
	if change, ok := fieldChange(diff.Plan, "uplink.up_mbps"); !ok || change.After != float64(20) {
		t.Fatalf("upload change = %+v", diff.Plan)
	}

	// Nothing is written until the owner applies it.
	untouched, _ := f.builds.GetByID(f.build.ID)
	if untouched.Kind != "homelab" || untouched.Revision != f.build.Revision {
		t.Fatalf("a proposal must not change the build: %q rev %d", untouched.Kind, untouched.Revision)
	}

	// The owner fills in another part of the plan before applying.
	edited, err := BuildToSyncInput(untouched)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	edited.GamingPlan.Uplink.PublicHost = "play.example.org"
	edited.GamingPlan.Uplink.UpMbps = 5
	if _, err := f.builds.UpdateAndCalculate(f.build.ID, f.userID, edited, f.ip); err != nil {
		t.Fatalf("owner edit: %v", err)
	}

	applied, _, err := f.proposals.Apply(f.build.ID, proposal.ID, f.userID)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	plan, _ := gaming.ParsePlan(applied.GamingPlan)
	if applied.Kind != "game_server" {
		t.Fatalf("kind after apply = %q", applied.Kind)
	}
	// The patch sets what it names and leaves the owner's later edit alone.
	if plan.Uplink.UpMbps != 20 || plan.Uplink.CGNAT != "no" || plan.Uplink.PublicHost != "play.example.org" {
		t.Fatalf("plan after apply = %+v", plan.Uplink)
	}
}

func TestProposal_SetPlanIsValidated(t *testing.T) {
	f := newProposalFixture(t)
	cases := map[string]TopologyOp{
		"nothing to set":   {Op: "set_plan"},
		"unknown kind":     {Op: "set_plan", Kind: "arcade"},
		"unknown plan key": {Op: "set_plan", Plan: map[string]any{"uplink": map[string]any{"speed": float64(20)}}},
		"breaker of zero":  {Op: "set_plan", Plan: map[string]any{"power": map[string]any{"circuits": []any{map[string]any{"id": "c1", "breaker_amps": float64(0)}}}}},
		"host with a path": {Op: "set_plan", Plan: map[string]any{"uplink": map[string]any{"public_host": "example.org/join"}}},
	}
	for name, op := range cases {
		if _, err := f.proposals.Propose(ProposeInput{BuildID: f.build.ID, UserID: f.userID, Source: ProposalSourceMCP, Ops: []TopologyOp{op}}); !errors.Is(err, ErrInvalidOperations) {
			t.Errorf("%s: expected ErrInvalidOperations, got %v", name, err)
		}
	}

	// Setting the plan to what it already is changes nothing.
	_, err := f.proposals.Propose(ProposeInput{BuildID: f.build.ID, UserID: f.userID, Source: ProposalSourceMCP, Ops: []TopologyOp{{Op: "set_plan", Kind: "homelab"}}})
	var opErr *OpError
	if !errors.As(err, &opErr) || !strings.Contains(opErr.Message, "do not change the build") {
		t.Fatalf("expected an unchanged plan to be refused, got %v", err)
	}
}

func TestProposal_GameSettingsAreDiffed(t *testing.T) {
	f := newProposalFixture(t)
	// The proposal engine resolves catalog ids against the real catalog.
	if err := SeedExpandedDefaultServices(f.tx); err != nil {
		t.Fatalf("seed: %v", err)
	}
	valheim, _ := gaming.ProfileBySlug("valheim")

	added := f.propose(t,
		TopologyOp{Op: "add_node", Ref: "host", Type: "minipc", Name: strPtr("Game Host"), Details: map[string]any{"cpu": float64(8), "ram": float64(16)}},
		TopologyOp{Op: "connect", Source: f.sw, Target: "host"},
		TopologyOp{Op: "add_vm", Host: "host", CatalogServiceID: valheim.ServiceID, Players: numPtr(10)},
	)
	build, _, err := f.proposals.Apply(f.build.ID, added.ID, f.userID)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	server := nodeByName(t, build, "Game Host").VirtualMachines[0]
	if server.RAMMB != 4608 || server.CPUCores != 2.5 {
		t.Fatalf("the server should be sized for 10 players, got %d MB / %v cores", server.RAMMB, server.CPUCores)
	}

	// Opening the server to friends changes neither memory nor cores, and is
	// still a change the owner has to approve.
	exposed := f.propose(t, TopologyOp{Op: "update_vm", VM: server.ID.String(), Exposure: strPtr("port_forward")})
	diff := proposalDiff(t, exposed.Diff)
	if diff.Counts.VMsChanged != 1 || diff.Counts.Total != 1 {
		t.Fatalf("counts = %+v", diff.Counts)
	}
	change, ok := fieldChange(diff.VMs.Changed[0].Changes, "exposure")
	if !ok || change.Before != "lan" || change.After != "port_forward" {
		t.Fatalf("exposure change = %+v", diff.VMs.Changed[0].Changes)
	}
	if _, resized := fieldChange(diff.VMs.Changed[0].Changes, "ram_mb"); resized {
		t.Fatalf("exposure alone must not resize the server: %+v", diff.VMs.Changed[0].Changes)
	}

	// The preview is a full build, so the gaming report can run on it before anyone applies.
	var preview ProposalPreview
	if err := json.Unmarshal(exposed.Preview, &preview); err != nil {
		t.Fatalf("preview: %v", err)
	}
	report, err := GamingReportForBuild(preview.Build)
	if err != nil {
		t.Fatalf("report on the preview: %v", err)
	}
	if len(report.Servers) != 1 || report.Servers[0].Exposure != gaming.ExposurePortForward || len(report.PortForwards) != 2 {
		t.Fatalf("report on the preview = %+v / %+v", report.Servers, report.PortForwards)
	}
	if report.PortForwards[0].RouterName != "Router" {
		t.Fatalf("the forward belongs on the build's router: %+v", report.PortForwards[0])
	}
}

func TestDiffCounts_SummaryMentionsThePlan(t *testing.T) {
	if got := (DiffCounts{PlanChanged: 1}).Summary(); got != "1 plan setting changed" {
		t.Errorf("summary = %q", got)
	}
	if got := (DiffCounts{NodesAdded: 2, PlanChanged: 3}).Summary(); got != "2 nodes added, 3 plan settings changed" {
		t.Errorf("summary = %q", got)
	}
}
