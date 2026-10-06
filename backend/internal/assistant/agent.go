package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/Butterski/homelab-builder/backend/internal/gaming"
	"github.com/Butterski/homelab-builder/backend/internal/llm"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/google/uuid"
)

const (
	// maxAgentSteps bounds the model calls of one user turn.
	maxAgentSteps = 12
	// MaxUserMessageChars bounds one chat message.
	MaxUserMessageChars = 8000
	// maxThreadMessages bounds a conversation; past it the user starts a new one.
	// History is never trimmed silently: providers that attach reasoning to a
	// turn require it to be sent back unchanged.
	maxThreadMessages  = 160
	maxToolResultChars = 60000
	turnTimeout        = 5 * time.Minute
	toolTimeout        = 90 * time.Second
	// maxSelectedNodes bounds how many selected devices are named to the model.
	maxSelectedNodes = 5
	// pendingInterval is how often the growth of a tool call is reported while
	// the model is still writing it.
	pendingInterval = 300 * time.Millisecond

	chatSourceLabel = "In-app assistant"
)

var (
	// ErrBusy means the user already has a chat turn running.
	ErrBusy = errors.New("the assistant is still working on your previous message")
	// ErrMessageInvalid means the chat message is empty or too long.
	ErrMessageInvalid = errors.New("invalid message")
	// ErrThreadFull means the conversation reached its length limit.
	ErrThreadFull = errors.New("this conversation is too long; clear the chat to start a new one")
)

// Event is one server-sent event of a chat turn.
type Event struct {
	Type string
	Data any
}

// Event types.
const (
	EventTurnStart = "turn_start"
	EventTextDelta = "text_delta"
	// EventToolPending says the model has begun a tool call and how much of it
	// is written. The call itself follows as EventToolCall once it is complete.
	EventToolPending = "tool_pending"
	EventToolCall    = "tool_call"
	EventToolResult  = "tool_result"
	EventProposal    = "proposal"
	EventNotice      = "notice"
	EventError       = "error"
	EventDone        = "done"
)

// AgentDeps are the collaborators of the chat agent.
type AgentDeps struct {
	Registry  *Registry
	Settings  *services.AssistantSettingsService
	Threads   *services.AssistantThreadService
	Proposals *services.ProposalService
	Builds    *services.BuildService
	// PublicAppURL is the browser-facing origin, used in review links.
	PublicAppURL string
	// NewProvider builds the model client; llm.New unless replaced in tests.
	NewProvider func(llm.Config) (llm.Provider, error)
}

// Agent runs the in-app assistant: it sends the conversation to the user's
// model, executes the tools the model calls, and stores the turn.
type Agent struct {
	deps    AgentDeps
	running sync.Map // user id -> build id of the turn in progress: one turn at a time per user
}

func NewAgent(deps AgentDeps) *Agent {
	if deps.NewProvider == nil {
		deps.NewProvider = llm.New
	}
	return &Agent{deps: deps}
}

// Turn is a prepared chat turn. Everything that can be refused up front has
// been checked; Run does the streaming work.
type Turn struct {
	agent    *Agent
	userID   uuid.UUID
	build    *models.Build
	thread   *models.AssistantThread
	history  []models.AssistantMessage
	provider llm.Provider
	creds    *services.AssistantCredentials
	text     string
	// selected are the devices the user had selected on the canvas, as the
	// build has them.
	selected []models.Node
	release  func()
}

// Prepare validates a chat request and reserves the user's single turn slot.
// The caller must run the returned turn, which releases the slot. selection
// holds node ids the user has selected on the canvas; ids that are not nodes
// of this build are ignored.
func (a *Agent) Prepare(userID, buildID uuid.UUID, text string, selection []string) (*Turn, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, fmt.Errorf("%w: the message is empty", ErrMessageInvalid)
	}
	if utf8.RuneCountInString(text) > MaxUserMessageChars {
		return nil, fmt.Errorf("%w: the message is longer than %d characters", ErrMessageInvalid, MaxUserMessageChars)
	}
	creds, err := a.deps.Settings.ResolveCredentials(userID)
	if err != nil {
		return nil, err
	}
	build, err := a.deps.Builds.GetOwned(buildID, userID)
	if err != nil {
		return nil, err
	}
	if _, busy := a.running.LoadOrStore(userID, buildID); busy {
		return nil, ErrBusy
	}
	release := func() { a.running.Delete(userID) }

	turn, err := a.prepareLocked(userID, build, creds, text)
	if err != nil {
		release()
		return nil, err
	}
	turn.selected = selectedNodes(build, selection)
	turn.release = release
	return turn, nil
}

// selectedNodes resolves a selection sent by the browser against the build.
// Only nodes the build really has are kept, in the order given, so nothing the
// client made up reaches the model.
func selectedNodes(build *models.Build, selection []string) []models.Node {
	byID := make(map[string]models.Node, len(build.Nodes))
	for _, node := range build.Nodes {
		byID[node.ID.String()] = node
	}
	selected := []models.Node{}
	seen := map[string]bool{}
	for _, id := range selection {
		node, ok := byID[strings.ToLower(strings.TrimSpace(id))]
		if !ok || seen[node.ID.String()] {
			continue
		}
		seen[node.ID.String()] = true
		selected = append(selected, node)
		if len(selected) == maxSelectedNodes {
			break
		}
	}
	return selected
}

func (a *Agent) prepareLocked(userID uuid.UUID, build *models.Build, creds *services.AssistantCredentials, text string) (*Turn, error) {
	thread, err := a.deps.Threads.GetOrCreate(userID, build.ID)
	if err != nil {
		return nil, err
	}
	history, err := a.deps.Threads.Messages(thread.ID)
	if err != nil {
		return nil, err
	}
	if len(history) >= maxThreadMessages {
		return nil, ErrThreadFull
	}
	provider, err := a.deps.NewProvider(llm.Config{
		Provider: creds.Provider, Model: creds.Model, BaseURL: creds.BaseURL, APIKey: creds.APIKey,
		HTTPClient: a.deps.Settings.HTTPClient(),
	})
	if err != nil {
		return nil, fmt.Errorf("%w: %s", services.ErrAssistantNotConfigured, err.Error())
	}
	return &Turn{agent: a, userID: userID, build: build, thread: thread, history: history, provider: provider, creds: creds, text: text}, nil
}

// contextNote tells the model which build is open and what happened to its
// earlier proposals. It travels with the user message and is stored with it,
// so the conversation replays identically later.
func (t *Turn) contextNote() string {
	var note strings.Builder
	fmt.Fprintf(&note, "[Context: the open build is %q, build_id %s, revision %d, %d nodes.",
		t.build.Name, t.build.ID, t.build.Revision, len(t.build.Nodes))
	// The kind goes here, with the message, so the system prompt stays the same
	// for every build and keeps its cache.
	if kind := gaming.Kind(t.build.Kind); kind.IsGaming() {
		fmt.Fprintf(&note, " It is a %s plan.", strings.ReplaceAll(string(kind), "_", " "))
	}

	var since time.Time
	if len(t.history) > 0 {
		since = t.history[len(t.history)-1].CreatedAt
		resolved, err := t.agent.deps.Proposals.ResolvedForThread(t.thread.ID, since)
		if err == nil {
			for _, proposal := range resolved {
				switch proposal.Status {
				case services.ProposalApplied:
					fmt.Fprintf(&note, " The user applied your proposal %q.", proposal.Summary)
				case services.ProposalRejected:
					fmt.Fprintf(&note, " The user rejected your proposal %q", proposal.Summary)
					if proposal.StatusReason != "" {
						fmt.Fprintf(&note, " with the reason: %q", proposal.StatusReason)
					}
					note.WriteString(".")
				case services.ProposalConflict:
					fmt.Fprintf(&note, " Your proposal %q no longer fits the build and was closed.", proposal.Summary)
				}
			}
		}
	}
	if len(t.selected) > 0 {
		names := make([]string, 0, len(t.selected))
		for _, node := range t.selected {
			names = append(names, fmt.Sprintf("%q (%s, id %s)", node.Name, node.Type, node.ID))
		}
		fmt.Fprintf(&note, " The user has selected on the canvas: %s.", strings.Join(names, ", "))
	}
	note.WriteString(" Call get_build for the current state before proposing changes.]")
	return note.String()
}

func (t *Turn) actor() Actor {
	buildID, threadID := t.build.ID, t.thread.ID
	return Actor{
		UserID: t.userID, Scope: ScopePropose, BuildID: &buildID,
		Source: services.ProposalSourceChat, SourceLabel: chatSourceLabel,
		ThreadID: &threadID, AppURL: t.agent.deps.PublicAppURL,
	}
}

// Run executes the turn, reporting progress through emit. Failures after this
// point are reported as error events; the conversation stays consistent.
func (t *Turn) Run(ctx context.Context, emit func(Event)) {
	defer t.release()
	ctx, cancel := context.WithTimeout(ctx, turnTimeout)
	defer cancel()

	deps := t.agent.deps
	actor := t.actor()
	fail := func(code, message string) {
		emit(Event{Type: EventError, Data: map[string]any{"code": code, "message": message}})
	}

	contextNote := t.contextNote()
	userMessage, err := deps.Threads.Append(t.thread.ID, services.AssistantRoleUser, "", "", []services.MessagePart{
		{Type: services.PartContext, Text: contextNote},
		{Type: services.PartText, Text: t.text},
	}, nil, false)
	if err != nil {
		log.Printf("assistant: storing user message failed: %v", err)
		fail("internal", "Could not save your message. Try again.")
		return
	}
	emit(Event{Type: EventTurnStart, Data: map[string]any{
		"thread_id": t.thread.ID, "message_id": userMessage.ID, "provider": t.creds.Provider, "model": t.creds.Model,
	}})

	conversation := ConversationFromMessages(append(t.history, *userMessage))
	tools := []llm.ToolDef{}
	titles := map[string]string{}
	for _, tool := range deps.Registry.For(actor, ContextChat) {
		tools = append(tools, llm.ToolDef{Name: tool.Name, Description: tool.Description, InputSchema: tool.InputSchema})
		titles[tool.Name] = tool.Title
	}

	done := func() {
		emit(Event{Type: EventDone, Data: map[string]any{"full": t.threadFull()}})
	}

	for step := 0; step < maxAgentSteps; step++ {
		var written strings.Builder
		lastPending := map[int]time.Time{}
		pending := func(index int, name string, bytes int) {
			lastPending[index] = time.Now()
			emit(Event{Type: EventToolPending, Data: map[string]any{
				"step": step, "index": index, "name": brief(name), "title": titles[name], "bytes": bytes,
			}})
		}
		pendingNames := map[int]string{}
		result, err := t.provider.Stream(ctx, llm.TurnRequest{System: ChatInstructions, Messages: conversation, Tools: tools},
			llm.StreamHandlers{
				Text: func(delta string) {
					written.WriteString(delta)
					emit(Event{Type: EventTextDelta, Data: map[string]any{"text": delta}})
				},
				// A long tool call (a proposal with many operations) takes the
				// model a while to write. Saying so beats a silent spinner.
				ToolStart: func(index int, name string) {
					pendingNames[index] = name
					pending(index, name, 0)
				},
				ToolProgress: func(index int, bytes int) {
					if time.Since(lastPending[index]) >= pendingInterval {
						pending(index, pendingNames[index], bytes)
					}
				},
			})
		if err != nil {
			// What was written before the stop is what the user saw: keep it,
			// marked as unfinished, so the transcript and the next turn agree.
			if text := written.String(); strings.TrimSpace(text) != "" {
				if _, storeErr := deps.Threads.Append(t.thread.ID, services.AssistantRoleAssistant, t.creds.Provider, t.creds.Model,
					[]services.MessagePart{{Type: services.PartText, Text: text}}, nil, true); storeErr != nil {
					log.Printf("assistant: storing interrupted reply failed: %v", storeErr)
				}
			}
			t.reportProviderError(ctx, err, fail)
			return
		}

		parts := []services.MessagePart{}
		if result.Text != "" {
			parts = append(parts, services.MessagePart{Type: services.PartText, Text: result.Text})
		}
		// A cut-off or declined reply may carry incomplete tool calls: never run them.
		if result.StopReason == llm.StopMaxTokens || result.StopReason == llm.StopRefusal {
			notice := "The reply was cut off before it finished. Ask again, perhaps for a smaller change."
			code := "truncated"
			if result.StopReason == llm.StopRefusal {
				notice, code = "The model declined this request.", "refusal"
				if result.StopDetail != "" {
					notice += " " + result.StopDetail
				}
			}
			parts = append(parts, services.MessagePart{Type: services.PartNotice, Text: notice})
			// Stored without the provider's native form: that one still holds
			// the tool calls we are not answering.
			if _, err := deps.Threads.Append(t.thread.ID, services.AssistantRoleAssistant, t.creds.Provider, t.creds.Model, parts, nil, true); err != nil {
				log.Printf("assistant: storing reply failed: %v", err)
			}
			fail(code, notice)
			return
		}

		// A model can emit arguments that are not valid JSON. The tool is still
		// called with them, so the model is told what was wrong, but the stored
		// conversation keeps an empty object: malformed arguments cannot be
		// stored or sent back to a provider.
		recorded := make([]llm.ToolCall, len(result.ToolCalls))
		for i, call := range result.ToolCalls {
			recorded[i] = call
			if !json.Valid(call.Input) {
				recorded[i].Input = json.RawMessage("{}")
			}
			parts = append(parts, services.MessagePart{Type: services.PartToolCall, ID: call.ID, Name: call.Name, Input: recorded[i].Input})
		}
		if _, err := deps.Threads.Append(t.thread.ID, services.AssistantRoleAssistant, t.creds.Provider, t.creds.Model, parts, result.Native, false); err != nil {
			log.Printf("assistant: storing reply failed: %v", err)
			fail("internal", "Could not save the reply. Try again.")
			return
		}
		conversation = append(conversation, llm.Message{
			Role: llm.RoleAssistant, Text: result.Text, ToolCalls: recorded,
			Native: result.Native, NativeFor: t.provider.ID(),
		})
		if len(result.ToolCalls) == 0 {
			done()
			return
		}

		// Tools run to completion even if the browser went away, so every call
		// stored above gets its result and the conversation stays replayable.
		toolCtx, cancelTools := context.WithTimeout(context.WithoutCancel(ctx), toolTimeout)
		toolParts := []services.MessagePart{}
		toolResults := []llm.ToolResult{}
		for index, call := range result.ToolCalls {
			emit(Event{Type: EventToolCall, Data: map[string]any{
				"id": call.ID, "name": brief(call.Name), "title": titles[call.Name],
				"detail": deps.Registry.Describe(call.Name, recorded[index].Input),
				"step":   step, "index": index,
			}})
			started := time.Now()
			outcome := t.runTool(toolCtx, actor, call)
			took := time.Since(started).Milliseconds()
			toolParts = append(toolParts, services.MessagePart{
				Type: services.PartToolResult, ID: call.ID, Name: call.Name, Content: outcome.content, IsError: outcome.isError,
				Summary: outcome.summary, DurationMS: took,
			})
			toolResults = append(toolResults, llm.ToolResult{CallID: call.ID, Name: call.Name, Content: outcome.content, IsError: outcome.isError})
			payload := map[string]any{"id": call.ID, "name": brief(call.Name), "ok": !outcome.isError, "duration_ms": took}
			if outcome.isError {
				payload["error"] = truncate(outcome.content, 300)
			} else {
				payload["summary"] = outcome.summary
				if len(outcome.focus) > 0 {
					payload["focus"] = outcome.focus
				}
			}
			emit(Event{Type: EventToolResult, Data: payload})
			if outcome.proposalID != nil {
				toolParts = append(toolParts, services.MessagePart{Type: services.PartProposal, ProposalID: outcome.proposalID.String()})
				if proposal, err := deps.Proposals.GetForUser(*outcome.proposalID, t.userID); err == nil {
					emit(Event{Type: EventProposal, Data: map[string]any{"proposal": services.SummarizeProposal(proposal)}})
				}
			}
		}
		cancelTools()
		if _, err := deps.Threads.Append(t.thread.ID, services.AssistantRoleTool, "", "", toolParts, nil, false); err != nil {
			log.Printf("assistant: storing tool results failed: %v", err)
			fail("internal", "Could not save the tool results. Try again.")
			return
		}
		conversation = append(conversation, llm.Message{Role: llm.RoleTool, ToolResults: toolResults})

		if ctx.Err() != nil {
			// The user stopped the turn or it ran out of time; the state is consistent.
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				fail("timeout", "The assistant took too long and was stopped.")
			}
			return
		}
	}

	notice := fmt.Sprintf("I stopped after %d steps without finishing. Tell me how to continue.", maxAgentSteps)
	if _, err := deps.Threads.Append(t.thread.ID, services.AssistantRoleAssistant, t.creds.Provider, t.creds.Model,
		[]services.MessagePart{{Type: services.PartNotice, Text: notice}}, nil, true); err != nil {
		log.Printf("assistant: storing notice failed: %v", err)
	}
	emit(Event{Type: EventNotice, Data: map[string]any{"text": notice}})
	done()
}

// threadFull reports whether the conversation reached its length limit with
// this turn, so the panel can say so without reading the thread again.
func (t *Turn) threadFull() bool {
	rows, err := t.agent.deps.Threads.Messages(t.thread.ID)
	return err == nil && len(rows) >= maxThreadMessages
}

func (t *Turn) reportProviderError(ctx context.Context, err error, fail func(code, message string)) {
	var providerErr *llm.ProviderError
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		fail("timeout", "The model took too long to answer and was stopped.")
	case ctx.Err() != nil:
		// The user stopped the turn; nobody is listening for an error.
	case errors.As(err, &providerErr):
		fail(providerErr.Kind, providerErr.UserMessage())
	default:
		log.Printf("assistant: provider call failed: %v", err)
		fail("provider", "The model request failed. Try again in a moment.")
	}
}

// toolOutcome is what one tool call came to.
type toolOutcome struct {
	// content is the text handed back to the model.
	content    string
	isError    bool
	proposalID *uuid.UUID
	// summary and focus are for the chat panel only.
	summary string
	focus   []string
}

// runTool executes one tool call.
func (t *Turn) runTool(ctx context.Context, actor Actor, call llm.ToolCall) toolOutcome {
	result, err := t.agent.deps.Registry.Call(ctx, actor, ContextChat, call.Name, call.Input)
	if err != nil {
		var toolErr *ToolError
		if errors.As(err, &toolErr) {
			return toolOutcome{content: toolErr.Message, isError: true}
		}
		return toolOutcome{content: "HLBuilder could not complete this call. Try again or take a different approach.", isError: true}
	}
	return toolOutcome{
		content: truncateToolResult(result.Text()), proposalID: result.ProposalID,
		summary: brief(result.Summary), focus: result.Focus,
	}
}

func truncateToolResult(text string) string {
	if len(text) <= maxToolResultChars {
		return text
	}
	return text[:maxToolResultChars] + "\n[The result was cut off because it is very large.]"
}

// ConversationFromMessages rebuilds the model-facing conversation from stored
// messages. It skips anything that is only for display, and drops tool calls
// that never got an answer (a turn interrupted between two writes), because
// providers reject a conversation with unanswered calls.
func ConversationFromMessages(rows []models.AssistantMessage) []llm.Message {
	conversation := make([]llm.Message, 0, len(rows))
	for i, row := range rows {
		parts := services.DecodeParts(row)
		switch row.Role {
		case services.AssistantRoleUser:
			var text []string
			for _, part := range parts {
				if (part.Type == services.PartContext || part.Type == services.PartText) && part.Text != "" {
					text = append(text, part.Text)
				}
			}
			if len(text) > 0 {
				conversation = append(conversation, llm.Message{Role: llm.RoleUser, Text: strings.Join(text, "\n\n")})
			}
		case services.AssistantRoleAssistant:
			message := llm.Message{Role: llm.RoleAssistant}
			for _, part := range parts {
				switch part.Type {
				case services.PartText:
					message.Text += part.Text
				case services.PartToolCall:
					message.ToolCalls = append(message.ToolCalls, llm.ToolCall{ID: part.ID, Name: part.Name, Input: part.Input})
				}
			}
			answered := len(message.ToolCalls) == 0 || (i+1 < len(rows) && answersAll(rows[i+1], message.ToolCalls))
			if answered && !row.Interrupted {
				message.Native, message.NativeFor = row.Native, row.Provider+"/"+row.Model
			} else {
				message.ToolCalls = nil
			}
			if message.Text != "" || len(message.ToolCalls) > 0 {
				conversation = append(conversation, message)
			}
		case services.AssistantRoleTool:
			// Results only count when the calls they answer were kept.
			if len(conversation) == 0 || len(conversation[len(conversation)-1].ToolCalls) == 0 {
				continue
			}
			message := llm.Message{Role: llm.RoleTool}
			for _, part := range parts {
				if part.Type == services.PartToolResult {
					message.ToolResults = append(message.ToolResults, llm.ToolResult{CallID: part.ID, Name: part.Name, Content: part.Content, IsError: part.IsError})
				}
			}
			conversation = append(conversation, message)
		}
	}
	return conversation
}

func answersAll(row models.AssistantMessage, calls []llm.ToolCall) bool {
	if row.Role != services.AssistantRoleTool {
		return false
	}
	answered := map[string]bool{}
	for _, part := range services.DecodeParts(row) {
		if part.Type == services.PartToolResult {
			answered[part.ID] = true
		}
	}
	for _, call := range calls {
		if !answered[call.ID] {
			return false
		}
	}
	return true
}

// PartView is a message part as the chat panel shows it. Tool calls carry no
// arguments and tool results no content: the panel shows what a step was
// about, whether it worked, and what came of it in a few words.
type PartView struct {
	Type  string `json:"type"`
	Text  string `json:"text,omitempty"`
	ID    string `json:"id,omitempty"`
	Name  string `json:"name,omitempty"`
	Title string `json:"title,omitempty"`
	// Detail (tool_call) is what the call was about; Summary and DurationMS
	// (tool_result) what came of it. All are plain text.
	Detail     string                    `json:"detail,omitempty"`
	OK         *bool                     `json:"ok,omitempty"`
	Error      string                    `json:"error,omitempty"`
	Summary    string                    `json:"summary,omitempty"`
	DurationMS int64                     `json:"duration_ms,omitempty"`
	Proposal   *services.ProposalSummary `json:"proposal,omitempty"`
}

// MessageView is a stored message as the chat panel shows it.
type MessageView struct {
	ID          uuid.UUID  `json:"id"`
	Role        string     `json:"role"`
	Parts       []PartView `json:"parts"`
	Interrupted bool       `json:"interrupted,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

// ThreadView is the user's conversation about a build.
type ThreadView struct {
	ThreadID *uuid.UUID    `json:"thread_id"`
	Messages []MessageView `json:"messages"`
	// Full is true when the conversation reached its length limit.
	Full bool `json:"full"`
	// Running is true while a turn on this build is still being worked on, for
	// example in another tab or after the page was reloaded mid-turn.
	Running bool `json:"running"`
}

// Thread returns the stored conversation for display.
func (a *Agent) Thread(userID, buildID uuid.UUID) (*ThreadView, error) {
	if _, err := a.deps.Builds.GetOwned(buildID, userID); err != nil {
		return nil, err
	}
	view := &ThreadView{Messages: []MessageView{}}
	if running, ok := a.running.Load(userID); ok && running == buildID {
		view.Running = true
	}
	thread, err := a.deps.Threads.Find(userID, buildID)
	if err != nil || thread == nil {
		return view, err
	}
	rows, err := a.deps.Threads.Messages(thread.ID)
	if err != nil {
		return nil, err
	}
	view.ThreadID = &thread.ID
	view.Full = len(rows) >= maxThreadMessages
	titles := map[string]string{}
	for _, tool := range a.deps.Registry.tools {
		titles[tool.Name] = tool.Title
	}
	for _, row := range rows {
		message := MessageView{ID: row.ID, Role: row.Role, Interrupted: row.Interrupted, CreatedAt: row.CreatedAt, Parts: []PartView{}}
		for _, part := range services.DecodeParts(row) {
			switch part.Type {
			case services.PartText, services.PartNotice:
				message.Parts = append(message.Parts, PartView{Type: part.Type, Text: part.Text})
			case services.PartToolCall:
				message.Parts = append(message.Parts, PartView{
					Type: part.Type, ID: part.ID, Name: brief(part.Name), Title: titles[part.Name],
					Detail: a.deps.Registry.Describe(part.Name, part.Input),
				})
			case services.PartToolResult:
				ok := !part.IsError
				entry := PartView{Type: part.Type, ID: part.ID, Name: brief(part.Name), OK: &ok, DurationMS: part.DurationMS}
				if part.IsError {
					entry.Error = truncate(part.Content, 300)
				} else {
					entry.Summary = brief(part.Summary)
				}
				message.Parts = append(message.Parts, entry)
			case services.PartProposal:
				proposalID, err := uuid.Parse(part.ProposalID)
				if err != nil {
					continue
				}
				// Shown with its current status; old proposals may have been pruned.
				if proposal, err := a.deps.Proposals.GetForUser(proposalID, userID); err == nil {
					summary := services.SummarizeProposal(proposal)
					message.Parts = append(message.Parts, PartView{Type: part.Type, Proposal: &summary})
				}
			}
		}
		if len(message.Parts) > 0 {
			view.Messages = append(view.Messages, message)
		}
	}
	return view, nil
}

// ClearThread deletes the user's conversation about a build.
func (a *Agent) ClearThread(userID, buildID uuid.UUID) error {
	if _, err := a.deps.Builds.GetOwned(buildID, userID); err != nil {
		return err
	}
	if _, busy := a.running.Load(userID); busy {
		return ErrBusy
	}
	return a.deps.Threads.Clear(userID, buildID)
}

// TestProvider checks the stored credentials by listing the provider's models.
// It costs no tokens.
func (a *Agent) TestProvider(ctx context.Context, userID uuid.UUID) ([]string, error) {
	creds, err := a.deps.Settings.ResolveCredentialsForTest(userID)
	if err != nil {
		return nil, err
	}
	provider, err := a.deps.NewProvider(llm.Config{
		Provider: creds.Provider, Model: creds.Model, BaseURL: creds.BaseURL, APIKey: creds.APIKey,
		HTTPClient: a.deps.Settings.HTTPClient(),
	})
	if err != nil {
		return nil, fmt.Errorf("%w: %s", services.ErrAssistantNotConfigured, err.Error())
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	return provider.ListModels(ctx)
}

// Encode renders an event as a server-sent event frame.
func (e Event) Encode() []byte {
	data, err := json.Marshal(e.Data)
	if err != nil {
		data = []byte("{}")
	}
	return []byte("event: " + e.Type + "\ndata: " + string(data) + "\n\n")
}
