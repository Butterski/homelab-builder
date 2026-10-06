package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/llm"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/secrets"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/Butterski/homelab-builder/backend/internal/testutil"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ─── Fixtures ────────────────────────────────────────────────────────────────

const userProviderKey = "sk-ant-user-owned-key-7c2d"

type scriptedTurn func(req llm.TurnRequest, onText func(string)) (*llm.TurnResult, error)

// scriptedProvider plays back prepared model replies and records every request.
type scriptedProvider struct {
	turns    []scriptedTurn
	requests []llm.TurnRequest
	// fallback answers once the script is exhausted.
	fallback scriptedTurn
}

func (p *scriptedProvider) ID() string { return "anthropic/claude-opus-5" }

func (p *scriptedProvider) ListModels(context.Context) ([]string, error) {
	return []string{"claude-opus-5", "claude-sonnet-5"}, nil
}

func (p *scriptedProvider) Stream(_ context.Context, req llm.TurnRequest, onText func(string)) (*llm.TurnResult, error) {
	// Copy: the agent keeps appending to the same slice.
	req.Messages = append([]llm.Message(nil), req.Messages...)
	p.requests = append(p.requests, req)
	index := len(p.requests) - 1
	if index < len(p.turns) {
		return p.turns[index](req, onText)
	}
	if p.fallback != nil {
		return p.fallback(req, onText)
	}
	return say("Done.")(req, onText)
}

func say(text string) scriptedTurn {
	return func(_ llm.TurnRequest, onText func(string)) (*llm.TurnResult, error) {
		for _, word := range strings.SplitAfter(text, " ") {
			onText(word)
		}
		return &llm.TurnResult{Text: text, StopReason: llm.StopEnd, Native: json.RawMessage(`{"role":"assistant","content":[{"type":"text","text":"` + text + `"}]}`)}, nil
	}
}

func callTool(text, id, name string, input any) scriptedTurn {
	return func(_ llm.TurnRequest, onText func(string)) (*llm.TurnResult, error) {
		if text != "" {
			onText(text)
		}
		raw, _ := json.Marshal(input)
		return &llm.TurnResult{
			Text: text, StopReason: llm.StopToolUse,
			ToolCalls: []llm.ToolCall{{ID: id, Name: name, Input: raw}},
			Native:    json.RawMessage(`{"role":"assistant","content":[{"type":"thinking","thinking":"","signature":"sig-` + id + `"}]}`),
		}, nil
	}
}

type agentEnv struct {
	tx        *gorm.DB
	agent     *Agent
	provider  *scriptedProvider
	configs   []llm.Config
	settings  *services.AssistantSettingsService
	proposals *services.ProposalService
	builds    *services.BuildService
	threads   *services.AssistantThreadService
	userID    uuid.UUID
	build     *models.Build
}

func stringPtr(value string) *string { return &value }
func truePtr() *bool                 { enabled := true; return &enabled }

func newAgentEnv(t *testing.T) *agentEnv {
	t.Helper()
	tx := testutil.Tx(t)
	t.Setenv("IPAM_URL", testutil.IPAMStub(t))

	encoded, _ := secrets.GenerateKey()
	key, _ := secrets.ParseKey(encoded)
	keyring, _ := secrets.NewKeyring(1, key, secrets.SourceEnv)

	e := &agentEnv{tx: tx, provider: &scriptedProvider{}}
	e.builds = services.NewBuildService(tx)
	ip := services.NewIPService(tx)
	e.proposals = services.NewProposalService(tx, e.builds, ip)
	e.settings = services.NewAssistantSettingsService(tx, keyring, true, false)
	e.threads = services.NewAssistantThreadService(tx)
	registry := NewRegistry(Deps{
		DB: tx, Builds: e.builds, IP: ip, Proposals: e.proposals,
		Hardware: services.NewHardwareService(tx), Services: services.NewServiceService(tx),
		Recommendations: services.NewRecommendationService(tx), Config: services.NewConfigService(tx),
		Gaming: services.NewGamingService(e.builds),
	})
	e.agent = NewAgent(AgentDeps{
		Registry: registry, Settings: e.settings, Threads: e.threads, Proposals: e.proposals, Builds: e.builds,
		PublicAppURL: "https://lab.example",
		NewProvider: func(cfg llm.Config) (llm.Provider, error) {
			e.configs = append(e.configs, cfg)
			return e.provider, nil
		},
	})

	e.userID = testutil.User(t, tx).ID
	e.build = e.seedBuild(t, e.userID)
	if _, err := e.settings.Update(e.userID, services.UpdateAssistantSettingsInput{
		Enabled: truePtr(), Provider: stringPtr(llm.ProviderAnthropic), APIKey: stringPtr(userProviderKey),
	}); err != nil {
		t.Fatalf("configure assistant: %v", err)
	}
	return e
}

func (e *agentEnv) seedBuild(t *testing.T, userID uuid.UUID) *models.Build {
	t.Helper()
	created, err := e.builds.Create(userID, services.SyncGraphInput{Name: "Home Lab"})
	if err != nil {
		t.Fatalf("create build: %v", err)
	}
	router, sw := uuid.NewString(), uuid.NewString()
	build, err := e.builds.UpdateAndCalculate(created.ID, userID, services.SyncGraphInput{
		Name: "Home Lab", Revision: created.Revision, Settings: map[string]any{},
		Nodes: []services.NodeDTO{
			{ID: router, Type: "router", Name: "Router", X: 80, Y: 80, IP: "192.168.1.1", Details: map[string]any{"ports": 4}},
			{ID: sw, Type: "switch", Name: "Switch", X: 80, Y: 340, Details: map[string]any{"ports": 8}},
		},
		Edges: []services.EdgeDTO{{Source: router, SourceHandle: "eth0", Target: sw, TargetHandle: services.TargetHandle, Type: "ethernet"}},
	}, services.NewIPService(e.tx))
	if err != nil {
		t.Fatalf("seed topology: %v", err)
	}
	return build
}

// chat runs one full turn and returns its events.
func (e *agentEnv) chat(t *testing.T, text string) []Event {
	t.Helper()
	turn, err := e.agent.Prepare(e.userID, e.build.ID, text)
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	var events []Event
	turn.Run(context.Background(), func(event Event) { events = append(events, event) })
	return events
}

func eventTypes(events []Event) string {
	types := make([]string, 0, len(events))
	for _, event := range events {
		if event.Type == EventTextDelta && len(types) > 0 && types[len(types)-1] == EventTextDelta {
			continue // collapse consecutive text deltas
		}
		types = append(types, event.Type)
	}
	return strings.Join(types, " ")
}

func eventData(t *testing.T, events []Event, eventType string) map[string]any {
	t.Helper()
	for _, event := range events {
		if event.Type == eventType {
			raw, _ := json.Marshal(event.Data)
			data := map[string]any{}
			_ = json.Unmarshal(raw, &data)
			return data
		}
	}
	t.Fatalf("no %s event in %s", eventType, eventTypes(events))
	return nil
}

func addNASArgs(buildID uuid.UUID) map[string]any {
	return map[string]any{
		"build_id": buildID.String(), "summary": "Add a NAS for backups",
		"operations": []any{
			map[string]any{"op": "add_node", "ref": "nas", "type": "nas", "name": "Backup NAS"},
			map[string]any{"op": "connect", "source": "Switch", "target": "nas"},
		},
	}
}

// ─── A full turn ─────────────────────────────────────────────────────────────

func TestAgent_ReadsTheBuildThenProposes(t *testing.T) {
	e := newAgentEnv(t)
	e.provider.turns = []scriptedTurn{
		callTool("", "toolu_1", "get_build", map[string]any{"build_id": e.build.ID.String()}),
		callTool("I will add a NAS. ", "toolu_2", "propose_changes", addNASArgs(e.build.ID)),
		say("I proposed a NAS on the switch. Review it on the canvas."),
	}

	events := e.chat(t, "  Add a NAS for backups  ")

	if got, want := eventTypes(events), "turn_start tool_call tool_result text_delta tool_call tool_result proposal text_delta done"; got != want {
		t.Fatalf("events:\n got %s\nwant %s", got, want)
	}
	if call := eventData(t, events, EventToolCall); call["name"] != "get_build" || call["title"] != "Read a build" {
		t.Fatalf("tool_call event: %v", call)
	}
	proposalEvent := eventData(t, events, EventProposal)["proposal"].(map[string]any)
	if proposalEvent["status"] != "pending" || proposalEvent["source"] != "chat" || proposalEvent["summary"] != "Add a NAS for backups" {
		t.Fatalf("proposal event: %v", proposalEvent)
	}

	// The user's key reached the provider client, and only there.
	if len(e.configs) != 1 || e.configs[0].APIKey != userProviderKey || e.configs[0].Model != "claude-opus-5" || e.configs[0].HTTPClient == nil {
		t.Fatalf("provider config: %+v", e.configs)
	}
	for _, event := range events {
		if raw, _ := json.Marshal(event.Data); strings.Contains(string(raw), userProviderKey) {
			t.Fatalf("an event leaks the key: %s", raw)
		}
	}

	// What the model was given.
	first := e.provider.requests[0]
	if first.System != ChatInstructions {
		t.Fatal("the chat system prompt must be the fixed assistant instructions")
	}
	toolNames := []string{}
	for _, tool := range first.Tools {
		toolNames = append(toolNames, tool.Name)
	}
	if joined := strings.Join(toolNames, ","); !strings.Contains(joined, "propose_changes") || strings.Contains(joined, "create_build") {
		t.Fatalf("chat tools: %s", joined)
	}
	userText := first.Messages[0].Text
	if !strings.Contains(userText, e.build.ID.String()) || !strings.Contains(userText, `"Home Lab"`) || !strings.HasSuffix(userText, "Add a NAS for backups") {
		t.Fatalf("the user message should carry the build context: %q", userText)
	}
	// The second call saw the first tool result; the third saw the proposal result.
	second := e.provider.requests[1].Messages
	if len(second) != 3 || second[2].Role != llm.RoleTool || !strings.Contains(second[2].ToolResults[0].Content, `"name":"Switch"`) {
		t.Fatalf("get_build result did not reach the model: %+v", second)
	}
	third := e.provider.requests[2].Messages
	proposalResult := third[len(third)-1].ToolResults[0]
	if proposalResult.IsError || !strings.Contains(proposalResult.Content, `"status":"pending"`) || !strings.Contains(proposalResult.Content, "Nothing has changed in the build yet") {
		t.Fatalf("propose_changes result: %+v", proposalResult)
	}

	// Nothing was written to the build; a pending proposal linked to the thread exists.
	current, _ := e.builds.GetByID(e.build.ID)
	if current.Revision != e.build.Revision || len(current.Nodes) != 2 {
		t.Fatalf("the build must be untouched: revision %d, %d nodes", current.Revision, len(current.Nodes))
	}
	thread, _ := e.threads.Find(e.userID, e.build.ID)
	var proposal models.BuildProposal
	if err := e.tx.First(&proposal, "build_id = ?", e.build.ID).Error; err != nil {
		t.Fatalf("load proposal: %v", err)
	}
	if proposal.Status != services.ProposalPending || proposal.Source != services.ProposalSourceChat || proposal.ThreadID == nil || *proposal.ThreadID != thread.ID {
		t.Fatalf("unexpected proposal: %+v", proposal)
	}

	// The whole turn is stored, in order.
	rows, _ := e.threads.Messages(thread.ID)
	roles := []string{}
	for _, row := range rows {
		roles = append(roles, row.Role)
	}
	if strings.Join(roles, " ") != "user assistant tool assistant tool assistant" {
		t.Fatalf("stored roles: %v", roles)
	}
	if rows[1].Provider != "anthropic" || rows[1].Model != "claude-opus-5" || !strings.Contains(string(rows[1].Native), "sig-toolu_1") {
		t.Fatalf("the reply should be stored with its native form: %+v", rows[1])
	}
}

func TestAgent_ThreadViewHidesContextAndToolContent(t *testing.T) {
	e := newAgentEnv(t)
	e.provider.turns = []scriptedTurn{
		callTool("", "toolu_1", "get_build", map[string]any{"build_id": e.build.ID.String()}),
		callTool("", "toolu_2", "propose_changes", addNASArgs(e.build.ID)),
		say("Proposed."),
	}
	e.chat(t, "Add a NAS")

	view, err := e.agent.Thread(e.userID, e.build.ID)
	if err != nil || view.ThreadID == nil || view.Full {
		t.Fatalf("thread: %+v, %v", view, err)
	}
	raw, _ := json.Marshal(view)
	text := string(raw)
	for _, hidden := range []string{"[Context:", `"content"`, "192.168.1.1", "sig-toolu", "native"} {
		if strings.Contains(text, hidden) {
			t.Errorf("the thread view should not contain %q: %s", hidden, text)
		}
	}
	if view.Messages[0].Role != "user" || len(view.Messages[0].Parts) != 1 || view.Messages[0].Parts[0].Text != "Add a NAS" {
		t.Fatalf("user message: %+v", view.Messages[0])
	}
	var sawProposal, sawResult bool
	for _, message := range view.Messages {
		for _, part := range message.Parts {
			if part.Type == services.PartProposal && part.Proposal != nil && part.Proposal.Status == services.ProposalPending {
				sawProposal = true
			}
			if part.Type == services.PartToolResult && part.OK != nil && *part.OK {
				sawResult = true
			}
			if part.Type == services.PartToolCall && part.Title == "" {
				t.Errorf("tool call %s should carry a readable title", part.Name)
			}
		}
	}
	if !sawProposal || !sawResult {
		t.Fatalf("expected a proposal card and tool steps in the view: %s", text)
	}

	// The card follows the proposal's status after the user decides.
	proposalID := uuid.MustParse(eventProposalID(t, e))
	if _, err := e.proposals.Reject(e.build.ID, proposalID, e.userID, "too big"); err != nil {
		t.Fatalf("reject: %v", err)
	}
	view, _ = e.agent.Thread(e.userID, e.build.ID)
	if raw, _ := json.Marshal(view); !strings.Contains(string(raw), `"status":"rejected"`) {
		t.Fatalf("the proposal card should show the current status: %s", raw)
	}

	// Strangers see nothing; clearing removes the conversation.
	if _, err := e.agent.Thread(testutil.User(t, e.tx).ID, e.build.ID); !errors.Is(err, services.ErrBuildNotFound) {
		t.Fatalf("thread of a foreign build: %v", err)
	}
	if err := e.agent.ClearThread(e.userID, e.build.ID); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if view, _ := e.agent.Thread(e.userID, e.build.ID); len(view.Messages) != 0 || view.ThreadID != nil {
		t.Fatalf("thread after clearing: %+v", view)
	}
}

func eventProposalID(t *testing.T, e *agentEnv) string {
	t.Helper()
	var proposal models.BuildProposal
	if err := e.tx.Order("created_at desc").First(&proposal, "build_id = ?", e.build.ID).Error; err != nil {
		t.Fatalf("load proposal: %v", err)
	}
	return proposal.ID.String()
}

// ─── Following turns ─────────────────────────────────────────────────────────

func TestAgent_NextTurnReplaysHistoryAndTellsTheModelWhatTheUserDecided(t *testing.T) {
	e := newAgentEnv(t)
	e.provider.turns = []scriptedTurn{
		callTool("", "toolu_1", "propose_changes", addNASArgs(e.build.ID)),
		say("Proposed a NAS."),
	}
	e.chat(t, "Add a NAS")
	if _, err := e.proposals.Reject(e.build.ID, uuid.MustParse(eventProposalID(t, e)), e.userID, "use the mini PC instead"); err != nil {
		t.Fatalf("reject: %v", err)
	}

	e.chat(t, "Then what do you suggest?")

	request := e.provider.requests[len(e.provider.requests)-1]
	roles := []string{}
	for _, message := range request.Messages {
		roles = append(roles, message.Role)
	}
	if strings.Join(roles, " ") != "user assistant tool assistant user" {
		t.Fatalf("replayed roles: %v", roles)
	}
	// Earlier replies go back in the provider's own form, for the same model.
	replayed := request.Messages[1]
	if !strings.Contains(string(replayed.Native), "sig-toolu_1") || replayed.NativeFor != "anthropic/claude-opus-5" || len(replayed.ToolCalls) != 1 {
		t.Fatalf("the earlier reply must be replayed unchanged: %+v", replayed)
	}
	if request.Messages[2].ToolResults[0].CallID != "toolu_1" {
		t.Fatalf("tool results must be replayed with their call: %+v", request.Messages[2])
	}
	// The first user message is byte-identical to what was sent the first time.
	if request.Messages[0].Text != e.provider.requests[0].Messages[0].Text {
		t.Fatal("history must be replayed exactly, not regenerated")
	}
	latest := request.Messages[4].Text
	if !strings.Contains(latest, `rejected your proposal "Add a NAS for backups"`) || !strings.Contains(latest, `"use the mini PC instead"`) {
		t.Fatalf("the model should learn the proposal was rejected and why: %q", latest)
	}

	// After switching model, the stored native messages belong to another model.
	if _, err := e.settings.Update(e.userID, services.UpdateAssistantSettingsInput{Model: stringPtr("claude-sonnet-5")}); err != nil {
		t.Fatalf("switch model: %v", err)
	}
	e.chat(t, "And now?")
	switched := e.provider.requests[len(e.provider.requests)-1]
	if switched.Messages[1].NativeFor != "anthropic/claude-opus-5" || e.configs[len(e.configs)-1].Model != "claude-sonnet-5" {
		t.Fatalf("native messages must stay tagged with the model that wrote them: %+v", switched.Messages[1])
	}
}

func TestAgent_AppliedProposalIsReported(t *testing.T) {
	e := newAgentEnv(t)
	e.provider.turns = []scriptedTurn{callTool("", "toolu_1", "propose_changes", addNASArgs(e.build.ID)), say("Proposed.")}
	e.chat(t, "Add a NAS")
	if _, _, err := e.proposals.Apply(e.build.ID, uuid.MustParse(eventProposalID(t, e)), e.userID); err != nil {
		t.Fatalf("apply: %v", err)
	}
	e.chat(t, "Thanks. Anything else?")
	latest := e.provider.requests[len(e.provider.requests)-1].Messages
	text := latest[len(latest)-1].Text
	if !strings.Contains(text, `applied your proposal "Add a NAS for backups"`) || !strings.Contains(text, fmt.Sprintf("revision %d", e.build.Revision+1)) || !strings.Contains(text, "3 nodes") {
		t.Fatalf("the model should see the applied proposal and the new revision: %q", text)
	}
}

// ─── Failures the model can fix ──────────────────────────────────────────────

func TestAgent_ToolErrorsGoBackToTheModel(t *testing.T) {
	e := newAgentEnv(t)
	other := e.seedBuild(t, e.userID)
	e.provider.turns = []scriptedTurn{
		// An invalid operation, a build outside the conversation, a tool that does not exist here, bad JSON.
		callTool("", "c1", "propose_changes", map[string]any{"build_id": e.build.ID.String(), "summary": "x",
			"operations": []any{map[string]any{"op": "connect", "source": "Switch", "target": "ghost"}}}),
		callTool("", "c2", "get_build", map[string]any{"build_id": other.ID.String()}),
		callTool("", "c3", "create_build", map[string]any{"name": "Another"}),
		func(llm.TurnRequest, func(string)) (*llm.TurnResult, error) {
			return &llm.TurnResult{StopReason: llm.StopToolUse, ToolCalls: []llm.ToolCall{{ID: "c4", Name: "get_build", Input: json.RawMessage(`{"build_id":`)}}}, nil
		},
		say("I could not do that."),
	}

	events := e.chat(t, "Do several impossible things")

	if got := eventTypes(events); got != "turn_start tool_call tool_result tool_call tool_result tool_call tool_result tool_call tool_result text_delta done" {
		t.Fatalf("events: %s", got)
	}
	wantErrors := []string{"operations[0] (connect)", "build not found", `unknown tool "create_build"`, "arguments must be a JSON object"}
	for i, want := range wantErrors {
		messages := e.provider.requests[i+1].Messages
		result := messages[len(messages)-1].ToolResults[0]
		if !result.IsError || !strings.Contains(result.Content, want) {
			t.Errorf("call %d: the model should be told %q, got %+v", i+1, want, result)
		}
	}
	for _, event := range events {
		if event.Type == EventToolResult {
			if data, _ := event.Data.(map[string]any); data["ok"] != false || data["error"] == "" {
				t.Errorf("tool_result event should report the failure: %v", data)
			}
		}
	}
	var proposals, builds int64
	e.tx.Model(&models.BuildProposal{}).Where("user_id = ?", e.userID).Count(&proposals)
	e.tx.Model(&models.Build{}).Where("user_id = ?", e.userID).Count(&builds)
	if proposals != 0 || builds != 2 {
		t.Fatalf("failed calls must change nothing: %d proposals, %d builds", proposals, builds)
	}
}

func TestAgent_CutOffAndDeclinedRepliesNeverRunTools(t *testing.T) {
	for _, stop := range []string{llm.StopMaxTokens, llm.StopRefusal} {
		e := newAgentEnv(t)
		e.provider.turns = []scriptedTurn{func(_ llm.TurnRequest, onText func(string)) (*llm.TurnResult, error) {
			onText("Let me ")
			raw, _ := json.Marshal(addNASArgs(e.build.ID))
			return &llm.TurnResult{
				Text: "Let me ", StopReason: stop, StopDetail: "policy",
				ToolCalls: []llm.ToolCall{{ID: "c1", Name: "propose_changes", Input: raw}},
				Native:    json.RawMessage(`{"role":"assistant","content":[{"type":"tool_use","id":"c1"}]}`),
			}, nil
		}}

		events := e.chat(t, "Add a NAS")

		if got := eventTypes(events); got != "turn_start text_delta error" {
			t.Fatalf("%s: events %s", stop, got)
		}
		failure := eventData(t, events, EventError)
		if stop == llm.StopRefusal && (failure["code"] != "refusal" || !strings.Contains(failure["message"].(string), "declined")) {
			t.Fatalf("refusal: %v", failure)
		}
		if stop == llm.StopMaxTokens && failure["code"] != "truncated" {
			t.Fatalf("truncation: %v", failure)
		}
		var proposals int64
		e.tx.Model(&models.BuildProposal{}).Where("build_id = ?", e.build.ID).Count(&proposals)
		if proposals != 0 {
			t.Fatalf("%s: a tool call from an unfinished reply was executed", stop)
		}

		// The stored reply holds no unanswered tool call, so the next turn is valid.
		e.chat(t, "Try again")
		replay := e.provider.requests[len(e.provider.requests)-1].Messages
		for _, message := range replay {
			if len(message.ToolCalls) > 0 || len(message.Native) > 0 {
				t.Fatalf("%s: unfinished tool calls were replayed: %+v", stop, message)
			}
		}
		if replay[1].Role != llm.RoleAssistant || replay[1].Text != "Let me " {
			t.Fatalf("%s: the partial text should remain in the history: %+v", stop, replay)
		}
	}
}

func TestAgent_ProviderFailureIsExplained(t *testing.T) {
	e := newAgentEnv(t)
	e.provider.turns = []scriptedTurn{func(llm.TurnRequest, func(string)) (*llm.TurnResult, error) {
		return nil, &llm.ProviderError{Kind: llm.KindAuth, Status: 401, Message: "invalid x-api-key"}
	}}
	events := e.chat(t, "Hello")
	if got := eventTypes(events); got != "turn_start error" {
		t.Fatalf("events: %s", got)
	}
	failure := eventData(t, events, EventError)
	if failure["code"] != llm.KindAuth || !strings.Contains(failure["message"].(string), "API key") {
		t.Fatalf("error event: %v", failure)
	}
	// The slot is free again and the conversation continues.
	e.provider.turns = nil
	if got := eventTypes(e.chat(t, "Hello again")); got != "turn_start text_delta done" {
		t.Fatalf("after a failure: %s", got)
	}
}

func TestAgent_StopsAfterTheStepLimit(t *testing.T) {
	e := newAgentEnv(t)
	step := 0
	e.provider.fallback = func(req llm.TurnRequest, onText func(string)) (*llm.TurnResult, error) {
		step++
		return callTool("", fmt.Sprintf("loop_%d", step), "list_builds", map[string]any{})(req, onText)
	}
	events := e.chat(t, "Loop forever")
	if len(e.provider.requests) != maxAgentSteps {
		t.Fatalf("expected %d model calls, got %d", maxAgentSteps, len(e.provider.requests))
	}
	if last := events[len(events)-2]; last.Type != EventNotice {
		t.Fatalf("the user should be told the turn was stopped: %s", eventTypes(events))
	}
	// The notice is for the user only; it is not sent to the model next time.
	e.provider.fallback = nil
	e.chat(t, "Stop")
	for _, message := range e.provider.requests[len(e.provider.requests)-1].Messages {
		if strings.Contains(message.Text, "I stopped after") {
			t.Fatal("notices must not be replayed to the model")
		}
	}
}

// ─── Requests refused before any model call ──────────────────────────────────

func TestAgent_PrepareRefusals(t *testing.T) {
	e := newAgentEnv(t)
	stranger := testutil.User(t, e.tx).ID

	if _, err := e.agent.Prepare(e.userID, e.build.ID, "   "); !errors.Is(err, ErrMessageInvalid) {
		t.Fatalf("empty message: %v", err)
	}
	if _, err := e.agent.Prepare(e.userID, e.build.ID, strings.Repeat("x", MaxUserMessageChars+1)); !errors.Is(err, ErrMessageInvalid) {
		t.Fatalf("long message: %v", err)
	}
	// A stranger has no assistant set up, and could not reach the build anyway.
	if _, err := e.agent.Prepare(stranger, e.build.ID, "hi"); !errors.Is(err, services.ErrAssistantDisabled) {
		t.Fatalf("stranger without settings: %v", err)
	}
	if _, err := e.settings.Update(stranger, services.UpdateAssistantSettingsInput{Enabled: truePtr(), Provider: stringPtr(llm.ProviderAnthropic), APIKey: stringPtr("sk-ant-stranger-key-0000")}); err != nil {
		t.Fatalf("configure stranger: %v", err)
	}
	if _, err := e.agent.Prepare(stranger, e.build.ID, "hi"); !errors.Is(err, services.ErrBuildNotFound) {
		t.Fatalf("foreign build: %v", err)
	}
	if _, err := e.settings.DeleteKey(e.userID); err != nil {
		t.Fatalf("delete key: %v", err)
	}
	if _, err := e.agent.Prepare(e.userID, e.build.ID, "hi"); !errors.Is(err, services.ErrAssistantNotConfigured) {
		t.Fatalf("missing key: %v", err)
	}
	if len(e.provider.requests) != 0 || len(e.configs) != 0 {
		t.Fatal("no model client may be created for a refused request")
	}

	// One turn at a time per user.
	if _, err := e.settings.Update(e.userID, services.UpdateAssistantSettingsInput{APIKey: stringPtr(userProviderKey)}); err != nil {
		t.Fatalf("restore key: %v", err)
	}
	turn, err := e.agent.Prepare(e.userID, e.build.ID, "first")
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if _, err := e.agent.Prepare(e.userID, e.build.ID, "second"); !errors.Is(err, ErrBusy) {
		t.Fatalf("second concurrent turn: %v", err)
	}
	if err := e.agent.ClearThread(e.userID, e.build.ID); !errors.Is(err, ErrBusy) {
		t.Fatalf("clearing during a turn: %v", err)
	}
	turn.Run(context.Background(), func(Event) {})
	if _, err := e.agent.Prepare(e.userID, e.build.ID, "third"); err != nil {
		t.Fatalf("the slot must be released after a turn: %v", err)
	}
}

func TestAgent_TestProviderListsModelsWithoutChatting(t *testing.T) {
	e := newAgentEnv(t)
	// Works before the assistant is switched on, right after a key was entered.
	disabled := false
	if _, err := e.settings.Update(e.userID, services.UpdateAssistantSettingsInput{Enabled: &disabled}); err != nil {
		t.Fatalf("disable: %v", err)
	}
	models, err := e.agent.TestProvider(context.Background(), e.userID)
	if err != nil || len(models) != 2 || len(e.provider.requests) != 0 {
		t.Fatalf("test provider: %v, %v", models, err)
	}
	if _, err := e.agent.TestProvider(context.Background(), testutil.User(t, e.tx).ID); !errors.Is(err, services.ErrAssistantNotConfigured) {
		t.Fatalf("unconfigured user: %v", err)
	}
}

// ─── History rebuilding ──────────────────────────────────────────────────────

func TestConversationFromMessages_DropsUnansweredToolCalls(t *testing.T) {
	parts := func(items ...services.MessagePart) json.RawMessage {
		raw, _ := json.Marshal(items)
		return raw
	}
	native := json.RawMessage(`{"role":"assistant"}`)
	rows := []models.AssistantMessage{
		{Role: services.AssistantRoleUser, Parts: parts(services.MessagePart{Type: services.PartContext, Text: "[ctx]"}, services.MessagePart{Type: services.PartText, Text: "hi"})},
		// Answered call: kept with its native form.
		{Role: services.AssistantRoleAssistant, Provider: "anthropic", Model: "m", Native: native,
			Parts: parts(services.MessagePart{Type: services.PartToolCall, ID: "a", Name: "get_build", Input: json.RawMessage(`{}`)})},
		{Role: services.AssistantRoleTool, Parts: parts(
			services.MessagePart{Type: services.PartToolResult, ID: "a", Name: "get_build", Content: "{}"},
			services.MessagePart{Type: services.PartProposal, ProposalID: uuid.NewString()})},
		// The server stopped between storing this reply and its tool results.
		{Role: services.AssistantRoleAssistant, Provider: "anthropic", Model: "m", Native: native,
			Parts: parts(services.MessagePart{Type: services.PartText, Text: "Working on it"}, services.MessagePart{Type: services.PartToolCall, ID: "b", Name: "propose_changes"})},
		{Role: services.AssistantRoleUser, Parts: parts(services.MessagePart{Type: services.PartText, Text: "still there?"})},
		// Display-only rows never reach the model.
		{Role: services.AssistantRoleAssistant, Interrupted: true, Parts: parts(services.MessagePart{Type: services.PartNotice, Text: "stopped"})},
	}

	conversation := ConversationFromMessages(rows)

	if len(conversation) != 5 {
		t.Fatalf("expected 5 messages, got %d: %+v", len(conversation), conversation)
	}
	if conversation[0].Text != "[ctx]\n\nhi" {
		t.Fatalf("user text: %q", conversation[0].Text)
	}
	if len(conversation[1].ToolCalls) != 1 || conversation[1].NativeFor != "anthropic/m" || len(conversation[1].Native) == 0 {
		t.Fatalf("answered call: %+v", conversation[1])
	}
	if len(conversation[2].ToolResults) != 1 || conversation[2].ToolResults[0].CallID != "a" {
		t.Fatalf("tool results: %+v", conversation[2])
	}
	if unanswered := conversation[3]; unanswered.Text != "Working on it" || len(unanswered.ToolCalls) != 0 || len(unanswered.Native) != 0 {
		t.Fatalf("an unanswered call must be dropped together with its native form: %+v", unanswered)
	}
	if conversation[4].Role != llm.RoleUser {
		t.Fatalf("last message: %+v", conversation[4])
	}
}
