package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/gaming"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/Butterski/homelab-builder/backend/internal/testutil"
	"github.com/google/uuid"
)

// asMap renders a tool result the way a model receives it.
func asMap(t *testing.T, result *Result) map[string]any {
	t.Helper()
	var data map[string]any
	if err := json.Unmarshal([]byte(result.Text()), &data); err != nil {
		t.Fatalf("tool result is not a JSON object: %v\n%s", err, result.Text())
	}
	return data
}

func TestGamingTools_PlanAGameServerEndToEnd(t *testing.T) {
	registry, tx, _ := newRegistry(t)
	if err := services.SeedExpandedDefaultServices(tx); err != nil {
		t.Fatalf("seed catalog: %v", err)
	}
	owner := testutil.User(t, tx)
	actor := Actor{UserID: owner.ID, Scope: ScopePropose, Source: services.ProposalSourceMCP, SourceLabel: "Claude Code"}
	ctx := context.Background()
	valheim, _ := gaming.ProfileBySlug("valheim")

	// A build can be created for what it is planned for.
	created, err := registry.Call(ctx, actor, ContextMCP, "create_build", json.RawMessage(`{"name":"Friends","kind":"game_server"}`))
	if err != nil {
		t.Fatalf("create_build: %v", err)
	}
	if asMap(t, created)["kind"] != "game_server" {
		t.Fatalf("create_build result = %s", created.Text())
	}
	buildID := uuid.MustParse(asMap(t, created)["id"].(string))

	listed, err := registry.Call(ctx, actor, ContextMCP, "list_builds", json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("list_builds: %v", err)
	}
	if !strings.Contains(listed.Text(), `"kind":"game_server"`) {
		t.Fatalf("list_builds should show the kind: %s", listed.Text())
	}

	// One proposal: the network, the host, the game server and the plan.
	proposed, err := registry.Call(ctx, actor, ContextMCP, "propose_changes", json.RawMessage(`{
		"build_id":"`+buildID.String()+`",
		"summary":"Valheim for ten friends",
		"operations":[
			{"op":"add_node","ref":"router","type":"router","name":"Router","ip":"192.168.1.1"},
			{"op":"add_node","ref":"host","type":"minipc","name":"Game Host","details":{"cpu":8,"ram":16}},
			{"op":"connect","source":"router","target":"host"},
			{"op":"add_vm","host":"host","catalog_service_id":"`+valheim.ServiceID+`","players":10,"exposure":"port_forward"},
			{"op":"set_plan","plan":{"uplink":{"up_mbps":20,"cgnat":"yes"}}}
		]}`))
	if err != nil {
		t.Fatalf("propose_changes: %v", err)
	}
	result := asMap(t, proposed)
	// The answer already says what the gaming report will say once applied, so
	// the caller can correct the plan before the owner looks at it.
	preview, ok := result["gaming"].(map[string]any)
	if !ok || preview["status"] != "error" {
		t.Fatalf("expected the gaming preview to flag the plan: %v", result["gaming"])
	}
	if !strings.Contains(proposed.Text(), "cgnat_port_forward") {
		t.Fatalf("port forwarding behind carrier-grade NAT should be flagged: %s", proposed.Text())
	}
	changes := result["changes"].(map[string]any)
	if counts := changes["counts"].(map[string]any); counts["plan_changed"] != float64(2) || counts["vms_added"] != float64(1) {
		t.Fatalf("counts = %v", counts)
	}

	// Nothing is saved yet: the report of the stored build is still empty.
	before, err := registry.Call(ctx, actor, ContextMCP, "gaming_report", json.RawMessage(`{"build_id":"`+buildID.String()+`"}`))
	if err != nil {
		t.Fatalf("gaming_report: %v", err)
	}
	if servers := asMap(t, before)["servers"].([]any); len(servers) != 0 {
		t.Fatalf("a proposal must not change the build: %s", before.Text())
	}

	if _, _, err := registry.deps.Proposals.Apply(buildID, *proposed.ProposalID, owner.ID); err != nil {
		t.Fatalf("apply: %v", err)
	}

	report, err := registry.Call(ctx, actor, ContextMCP, "gaming_report", json.RawMessage(`{"build_id":"`+buildID.String()+`"}`))
	if err != nil {
		t.Fatalf("gaming_report: %v", err)
	}
	after := asMap(t, report)
	if after["kind"] != "game_server" || after["status"] != "error" {
		t.Fatalf("report header = %v / %v", after["kind"], after["status"])
	}
	server := after["servers"].([]any)[0].(map[string]any)
	if server["players"] != float64(10) || server["exposure"] != "port_forward" || server["host_name"] != "Game Host" {
		t.Fatalf("server = %v", server)
	}
	if needed := server["needed"].(map[string]any); needed["ram_mb"] != float64(4608) {
		t.Fatalf("sizing = %v", needed)
	}
	if forwards := after["port_forwards"].([]any); len(forwards) != 2 || forwards[0].(map[string]any)["router_name"] != "Router" {
		t.Fatalf("port forwards = %v", after["port_forwards"])
	}

	// get_build shows what a model needs to plan the next change.
	view, err := registry.Call(ctx, actor, ContextMCP, "get_build", json.RawMessage(`{"build_id":"`+buildID.String()+`"}`))
	if err != nil {
		t.Fatalf("get_build: %v", err)
	}
	build := asMap(t, view)
	if build["kind"] != "game_server" {
		t.Fatalf("get_build kind = %v", build["kind"])
	}
	if plan := build["gaming_plan"].(map[string]any)["uplink"].(map[string]any); plan["cgnat"] != "yes" || plan["up_mbps"] != float64(20) {
		t.Fatalf("get_build plan = %v", build["gaming_plan"])
	}
	if !strings.Contains(view.Text(), `"game":{"profile":"valheim","players":10,"exposure":"port_forward","port_offset":0}`) {
		t.Fatalf("get_build should show the game settings of the server: %s", view.Text())
	}

	// The fix the report suggests is one more proposal away.
	fixed, err := registry.Call(ctx, actor, ContextMCP, "propose_changes", json.RawMessage(`{
		"build_id":"`+buildID.String()+`",
		"summary":"Reach the server over a VPN instead",
		"operations":[{"op":"update_vm","vm":"Valheim Server","exposure":"vpn"}]}`))
	if err != nil {
		t.Fatalf("propose the fix: %v", err)
	}
	if strings.Contains(fixed.Text(), "cgnat_port_forward") {
		t.Fatalf("a VPN needs no public address: %s", fixed.Text())
	}
}

func TestGamingTools_HomelabStaysQuiet(t *testing.T) {
	registry, tx, builds := newRegistry(t)
	owner := testutil.User(t, tx)
	build, err := builds.Create(owner.ID, services.SyncGraphInput{Name: "Lab"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	actor := Actor{UserID: owner.ID, Scope: ScopePropose, BuildID: &build.ID, Source: services.ProposalSourceChat}
	ctx := context.Background()

	proposed, err := registry.Call(ctx, actor, ContextChat, "propose_changes", json.RawMessage(
		`{"build_id":"`+build.ID.String()+`","summary":"Start with a router","operations":[{"op":"add_node","type":"router","name":"Edge"}]}`))
	if err != nil {
		t.Fatalf("propose: %v", err)
	}
	// A homelab without game servers gets no gaming section at all.
	if _, present := asMap(t, proposed)["gaming"]; present {
		t.Fatalf("unexpected gaming section for a homelab: %s", proposed.Text())
	}

	view, err := registry.Call(ctx, actor, ContextChat, "get_build", json.RawMessage(`{"build_id":"`+build.ID.String()+`"}`))
	if err != nil {
		t.Fatalf("get_build: %v", err)
	}
	if data := asMap(t, view); data["kind"] != "homelab" || data["gaming_plan"] != nil {
		t.Fatalf("a homelab shows its kind and no plan: %v / %v", data["kind"], data["gaming_plan"])
	}

	// The report is available in the chat too, and it is read-only.
	if _, err := registry.Call(ctx, actor, ContextChat, "gaming_report", json.RawMessage(`{"build_id":"`+build.ID.String()+`"}`)); err != nil {
		t.Fatalf("gaming_report in chat: %v", err)
	}

	// Another account cannot read it.
	stranger := Actor{UserID: testutil.User(t, tx).ID, Scope: ScopeRead, Source: services.ProposalSourceMCP}
	_, err = registry.Call(ctx, stranger, ContextMCP, "gaming_report", json.RawMessage(`{"build_id":"`+build.ID.String()+`"}`))
	var toolErr *ToolError
	if !errors.As(err, &toolErr) || !strings.Contains(toolErr.Message, "build not found") {
		t.Fatalf("expected a build-not-found tool error for another account, got %v", err)
	}
}

func TestGamingTools_SchemaRejectsWhatTheEngineWould(t *testing.T) {
	registry, tx, builds := newRegistry(t)
	owner := testutil.User(t, tx)
	build, _ := builds.Create(owner.ID, services.SyncGraphInput{Name: "Lab"})
	actor := Actor{UserID: owner.ID, Scope: ScopePropose, Source: services.ProposalSourceMCP}
	ctx := context.Background()

	call := func(operations string) error {
		_, err := registry.Call(ctx, actor, ContextMCP, "propose_changes", json.RawMessage(
			`{"build_id":"`+build.ID.String()+`","summary":"x","operations":[`+operations+`]}`))
		return err
	}
	for name, operation := range map[string]string{
		"unknown exposure": `{"op":"update_vm","vm":"x","exposure":"public"}`,
		"unknown kind":     `{"op":"set_plan","kind":"arcade"}`,
		"zero players":     `{"op":"update_vm","vm":"x","players":0}`,
	} {
		err := call(operation)
		var toolErr *ToolError
		if !errors.As(err, &toolErr) || !strings.Contains(toolErr.Message, "invalid arguments") {
			t.Errorf("%s: the schema should reject it, got %v", name, err)
		}
	}
	// A console and a LAN table are node types a caller may add.
	if err := call(`{"op":"add_node","type":"router","name":"R"},{"op":"add_node","type":"switch","ref":"sw"},{"op":"connect","source":"R","target":"sw"},{"op":"add_node","type":"lan_table","ref":"t","details":{"seats":6}},{"op":"connect","source":"sw","target":"t"},{"op":"add_node","type":"console","ref":"ps5","details":{"platform":"playstation"}},{"op":"connect","source":"sw","target":"ps5"}`); err != nil {
		t.Fatalf("adding a table and a console: %v", err)
	}
}
