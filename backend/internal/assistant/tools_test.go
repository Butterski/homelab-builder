package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/Butterski/homelab-builder/backend/internal/testutil"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func newRegistry(t *testing.T) (*Registry, *gorm.DB, *services.BuildService) {
	t.Helper()
	tx := testutil.Tx(t)
	t.Setenv("IPAM_URL", testutil.IPAMStub(t))
	builds := services.NewBuildService(tx)
	ip := services.NewIPService(tx)
	registry := NewRegistry(Deps{
		DB: tx, Builds: builds, IP: ip, Proposals: services.NewProposalService(tx, builds, ip),
		Hardware: services.NewHardwareService(tx), Services: services.NewServiceService(tx),
		Recommendations: services.NewRecommendationService(tx), Config: services.NewConfigService(tx),
	})
	return registry, tx, builds
}

func names(tools []*Tool) string {
	list := make([]string, 0, len(tools))
	for _, tool := range tools {
		list = append(list, tool.Name)
	}
	return strings.Join(list, ",")
}

func TestRegistry_ToolsFollowScopeContextAndRestriction(t *testing.T) {
	registry, _, _ := newRegistry(t)
	buildID := uuid.New()
	user := uuid.New()

	read := names(registry.For(Actor{UserID: user, Scope: ScopeRead}, ContextMCP))
	if strings.Contains(read, "propose_changes") || strings.Contains(read, "create_build") || !strings.Contains(read, "get_build") {
		t.Fatalf("read scope tools: %s", read)
	}
	propose := names(registry.For(Actor{UserID: user, Scope: ScopePropose}, ContextMCP))
	if !strings.Contains(propose, "propose_changes") || !strings.Contains(propose, "create_build") {
		t.Fatalf("propose scope tools: %s", propose)
	}
	// The in-app assistant works on the open build only; it never creates builds.
	chat := names(registry.For(Actor{UserID: user, Scope: ScopePropose, BuildID: &buildID}, ContextChat))
	if !strings.Contains(chat, "propose_changes") || strings.Contains(chat, "create_build") {
		t.Fatalf("chat tools: %s", chat)
	}
	restricted := names(registry.For(Actor{UserID: user, Scope: ScopePropose, BuildID: &buildID}, ContextMCP))
	if strings.Contains(restricted, "create_build") {
		t.Fatalf("a build-restricted actor must not get account-wide tools: %s", restricted)
	}

	// Every schema is a JSON object schema with a description for the model.
	for _, tool := range registry.For(Actor{UserID: user, Scope: ScopePropose}, ContextMCP) {
		var schema map[string]any
		if err := json.Unmarshal(tool.InputSchema, &schema); err != nil || schema["type"] != "object" {
			t.Errorf("%s: input schema must be an object schema (%v)", tool.Name, err)
		}
		if len(tool.Description) < 40 || tool.Title == "" {
			t.Errorf("%s: needs a title and a real description", tool.Name)
		}
	}
}

func TestRegistry_CallEnforcesAccessAndValidatesArguments(t *testing.T) {
	registry, tx, builds := newRegistry(t)
	owner := testutil.User(t, tx)
	build, err := builds.Create(owner.ID, services.SyncGraphInput{Name: "Lab"})
	if err != nil {
		t.Fatalf("create build: %v", err)
	}
	other, err := builds.Create(owner.ID, services.SyncGraphInput{Name: "Other"})
	if err != nil {
		t.Fatalf("create build: %v", err)
	}
	ctx := context.Background()
	asToolError := func(err error) string {
		t.Helper()
		var toolErr *ToolError
		if !errors.As(err, &toolErr) {
			t.Fatalf("expected a ToolError, got %T: %v", err, err)
		}
		return toolErr.Message
	}
	args := func(buildID uuid.UUID) json.RawMessage {
		return json.RawMessage(`{"build_id":"` + buildID.String() + `"}`)
	}

	reader := Actor{UserID: owner.ID, Scope: ScopeRead, Source: services.ProposalSourceMCP}
	if _, err := registry.Call(ctx, reader, ContextMCP, "get_build", args(build.ID)); err != nil {
		t.Fatalf("owner read: %v", err)
	}
	// Out-of-scope and out-of-context tools do not exist for the caller.
	propose := json.RawMessage(`{"build_id":"` + build.ID.String() + `","summary":"x","operations":[{"op":"add_node","type":"nas"}]}`)
	if _, err := registry.Call(ctx, reader, ContextMCP, "propose_changes", propose); !strings.Contains(asToolError(err), "unknown tool") {
		t.Fatalf("read scope must not propose: %v", err)
	}
	chatActor := Actor{UserID: owner.ID, Scope: ScopePropose, BuildID: &build.ID, Source: services.ProposalSourceChat}
	if _, err := registry.Call(ctx, chatActor, ContextChat, "create_build", json.RawMessage(`{"name":"x"}`)); !strings.Contains(asToolError(err), "unknown tool") {
		t.Fatalf("chat must not create builds: %v", err)
	}
	// A restricted actor cannot reach another build of the same account.
	if _, err := registry.Call(ctx, chatActor, ContextChat, "get_build", args(other.ID)); !strings.Contains(asToolError(err), "build not found") {
		t.Fatalf("restriction not enforced: %v", err)
	}
	// Another account sees nothing.
	stranger := Actor{UserID: testutil.User(t, tx).ID, Scope: ScopePropose, Source: services.ProposalSourceMCP}
	if _, err := registry.Call(ctx, stranger, ContextMCP, "get_build", args(build.ID)); !strings.Contains(asToolError(err), "build not found") {
		t.Fatalf("ownership not enforced: %v", err)
	}

	for _, bad := range []string{`{}`, `{"build_id":7}`, `{"build_id":"x","extra":true}`, `[1]`, `not json`} {
		if _, err := registry.Call(ctx, reader, ContextMCP, "get_build", json.RawMessage(bad)); err == nil {
			t.Errorf("arguments %s should be rejected", bad)
		} else {
			asToolError(err)
		}
	}
	// Unknown operation fields are caught by the schema before anything runs.
	typo := json.RawMessage(`{"build_id":"` + build.ID.String() + `","summary":"x","operations":[{"op":"add_node","typ":"nas"}]}`)
	writer := Actor{UserID: owner.ID, Scope: ScopePropose, Source: services.ProposalSourceMCP}
	if _, err := registry.Call(ctx, writer, ContextMCP, "propose_changes", typo); !strings.Contains(asToolError(err), "invalid arguments") {
		t.Fatalf("schema should reject unknown fields: %v", err)
	}
}

func TestRegistry_OnlyStateChangingCallsAreAudited(t *testing.T) {
	registry, tx, builds := newRegistry(t)
	owner := testutil.User(t, tx)
	build, _ := builds.Create(owner.ID, services.SyncGraphInput{Name: "Lab"})
	threadID := uuid.New()
	actor := Actor{UserID: owner.ID, Scope: ScopePropose, BuildID: &build.ID, Source: services.ProposalSourceChat, SourceLabel: "In-app assistant", ThreadID: &threadID}
	ctx := context.Background()

	if _, err := registry.Call(ctx, actor, ContextChat, "get_build", json.RawMessage(`{"build_id":"`+build.ID.String()+`"}`)); err != nil {
		t.Fatalf("get_build: %v", err)
	}
	result, err := registry.Call(ctx, actor, ContextChat, "propose_changes", json.RawMessage(
		`{"build_id":"`+build.ID.String()+`","summary":"Start with a router","operations":[{"op":"add_node","type":"router","name":"Edge"}]}`))
	if err != nil || result.ProposalID == nil {
		t.Fatalf("propose: %v", err)
	}

	var events []models.Event
	tx.Where("user_id = ? AND event_type LIKE ?", owner.ID, "%.tool_call").Find(&events)
	if len(events) != 1 || events[0].EventType != "assistant.tool_call" {
		t.Fatalf("expected one assistant.tool_call event, got %+v", events)
	}
	var payload map[string]any
	_ = json.Unmarshal([]byte(events[0].Payload), &payload)
	if payload["tool"] != "propose_changes" || payload["ok"] != true || payload["proposal_id"] != result.ProposalID.String() || payload["build_id"] != build.ID.String() {
		t.Fatalf("unexpected audit payload: %v", payload)
	}
	// The audit trail never stores what was proposed, only that it happened.
	if strings.Contains(events[0].Payload, "Edge") {
		t.Fatalf("audit payload must not contain the arguments: %s", events[0].Payload)
	}

	var proposal models.BuildProposal
	tx.First(&proposal, "id = ?", result.ProposalID)
	if proposal.Source != services.ProposalSourceChat || proposal.ThreadID == nil || *proposal.ThreadID != threadID {
		t.Fatalf("proposal should be linked to the chat thread: %+v", proposal)
	}
}
