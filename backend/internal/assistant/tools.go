// Package assistant holds the tools LLMs use to read and plan HLBuilder builds.
// The same registry serves the MCP endpoint and the in-app chat, so both see
// identical behaviour and the same access rules.
package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"
	"unicode"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/google/jsonschema-go/jsonschema"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Scope is what an actor may do. Nothing an actor does writes to a build:
// ScopePropose only allows staging changes the owner still has to approve.
type Scope int

const (
	ScopeRead Scope = iota + 1
	ScopePropose
)

// Tool contexts.
const (
	ContextMCP  = "mcp"
	ContextChat = "chat"
)

// Actor is the authenticated caller of a tool.
type Actor struct {
	UserID uuid.UUID
	Scope  Scope
	// BuildID, when set, confines the actor to a single build.
	BuildID     *uuid.UUID
	Source      string // services.ProposalSourceMCP or services.ProposalSourceChat
	SourceLabel string // shown to the owner, e.g. the token name
	TokenID     *uuid.UUID
	ThreadID    *uuid.UUID
	// AppURL is the browser-facing origin used in review links.
	AppURL string
}

// CanAccess reports whether the actor's restriction allows this build.
// Ownership is checked separately against the database.
func (a Actor) CanAccess(buildID uuid.UUID) bool {
	return a.BuildID == nil || *a.BuildID == buildID
}

// ToolError is a failure the model should read and correct, such as a missing
// build or an invalid operation. It is returned as a tool result, not as a
// transport error.
type ToolError struct{ Message string }

func (e *ToolError) Error() string { return e.Message }

func toolErrorf(format string, args ...any) *ToolError {
	return &ToolError{Message: fmt.Sprintf(format, args...)}
}

// Result is a successful tool call. Data must marshal to a JSON object.
type Result struct {
	Data       any
	ProposalID *uuid.UUID
	// Summary is the outcome in a few words, for the chat's list of steps
	// ("14 devices", "1 error, 2 warnings"). MCP clients get Data only.
	Summary string
	// Focus lists nodes of the build the call was about, so the canvas can
	// point at them while the assistant works. Ids come from the server's own
	// data, never from the arguments.
	Focus []string
}

// Text renders the result as the JSON text handed to the model.
func (r *Result) Text() string {
	raw, err := json.Marshal(r.Data)
	if err != nil {
		return "{}"
	}
	return string(raw)
}

type toolHandler func(ctx context.Context, r *Registry, actor Actor, args json.RawMessage) (*Result, error)

// Tool is one capability exposed to LLM clients.
type Tool struct {
	Name        string
	Title       string
	Description string
	InputSchema json.RawMessage
	Scope       Scope
	// ReadOnly tools never change stored state.
	ReadOnly bool
	// Contexts limits where the tool is offered; empty means everywhere.
	Contexts []string
	// AccountWide tools act on the whole account and are withheld from actors
	// confined to one build.
	AccountWide bool

	handler toolHandler
	// describe says what a call is about from its arguments; see Registry.Describe.
	describe func(args json.RawMessage) string
	schema   *jsonschema.Resolved
}

// Deps are the services the tools are built on.
type Deps struct {
	DB              *gorm.DB
	Builds          *services.BuildService
	IP              *services.IPService
	Proposals       *services.ProposalService
	Hardware        *services.HardwareService
	Services        *services.ServiceService
	Recommendations *services.RecommendationService
	Config          *services.ConfigService
	Gaming          *services.GamingService
}

// Registry owns the tool set and enforces access on every call.
type Registry struct {
	deps   Deps
	tools  []*Tool
	byName map[string]*Tool
}

// NewRegistry builds the tool set. Tool schemas are compiled here, so a
// malformed schema fails at startup instead of on the first call.
func NewRegistry(deps Deps) *Registry {
	r := &Registry{deps: deps, byName: map[string]*Tool{}}
	for _, group := range [][]*Tool{buildTools(), catalogTools(), proposalTools()} {
		for _, tool := range group {
			var schema jsonschema.Schema
			if err := json.Unmarshal(tool.InputSchema, &schema); err != nil {
				panic(fmt.Errorf("assistant tool %q: invalid input schema: %w", tool.Name, err))
			}
			resolved, err := schema.Resolve(nil)
			if err != nil {
				panic(fmt.Errorf("assistant tool %q: unresolvable input schema: %w", tool.Name, err))
			}
			tool.schema = resolved
			r.tools = append(r.tools, tool)
			r.byName[tool.Name] = tool
		}
	}
	return r
}

// maxStepText bounds the short texts the chat shows next to a step.
const maxStepText = 80

// Describe says in a few words what a call is about, from its arguments alone:
// "2.5G switch" for a catalog search, "5 operations" for a proposal. The words
// are the model's, so the text is cut short, kept on one line, and has to be
// shown as plain text.
func (r *Registry) Describe(name string, args json.RawMessage) string {
	tool, ok := r.byName[name]
	if !ok || tool.describe == nil || !json.Valid(args) {
		return ""
	}
	return brief(tool.describe(args))
}

// brief turns a text into a short one-line label.
func brief(text string) string {
	text = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, text)
	return truncate(strings.Join(strings.Fields(text), " "), maxStepText)
}

// count renders "1 device" or "3 devices".
func count(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %s", n, many)
}

// maxFocusNodes bounds how many nodes one step can point at.
const maxFocusNodes = 40

// focusOn collects node ids for Result.Focus: valid ids only, each once.
func focusOn(ids ...string) []string {
	seen := map[string]bool{}
	focus := []string{}
	for _, id := range ids {
		if len(focus) == maxFocusNodes {
			break
		}
		if _, err := uuid.Parse(id); err != nil || seen[id] {
			continue
		}
		seen[id] = true
		focus = append(focus, id)
	}
	return focus
}

func (t *Tool) offeredIn(toolContext string) bool {
	if len(t.Contexts) == 0 {
		return true
	}
	for _, allowed := range t.Contexts {
		if allowed == toolContext {
			return true
		}
	}
	return false
}

func (t *Tool) allowedFor(actor Actor, toolContext string) bool {
	if !t.offeredIn(toolContext) || actor.Scope < t.Scope {
		return false
	}
	return !(t.AccountWide && actor.BuildID != nil)
}

// For lists the tools an actor may use in a context. A caller only ever sees
// tools it is allowed to call.
func (r *Registry) For(actor Actor, toolContext string) []*Tool {
	allowed := make([]*Tool, 0, len(r.tools))
	for _, tool := range r.tools {
		if tool.allowedFor(actor, toolContext) {
			allowed = append(allowed, tool)
		}
	}
	return allowed
}

// Call runs a tool for an actor. It returns a *ToolError for anything the model
// can fix, and a plain error only for failures on our side.
func (r *Registry) Call(ctx context.Context, actor Actor, toolContext, name string, args json.RawMessage) (*Result, error) {
	tool, ok := r.byName[name]
	if !ok || !tool.allowedFor(actor, toolContext) {
		return nil, toolErrorf("unknown tool %q", name)
	}
	if len(strings.TrimSpace(string(args))) == 0 || string(args) == "null" {
		args = json.RawMessage("{}")
	}
	var instance map[string]any
	if err := json.Unmarshal(args, &instance); err != nil {
		return nil, toolErrorf("arguments must be a JSON object: %v", err)
	}
	// The database cannot hold a NUL character, in a query or in a name.
	if hasNUL(instance) {
		return nil, toolErrorf("arguments must not contain NUL characters")
	}
	if err := tool.schema.Validate(instance); err != nil {
		return nil, toolErrorf("invalid arguments for %s: %v", name, err)
	}

	started := time.Now()
	result, err := tool.handler(ctx, r, actor, args)
	err = classifyError(err)
	if !tool.ReadOnly {
		r.audit(actor, tool.Name, args, result, err, time.Since(started))
	}
	if err != nil {
		var toolErr *ToolError
		if !errors.As(err, &toolErr) {
			log.Printf("assistant tool %s failed: %v", name, err)
		}
		return nil, err
	}
	return result, nil
}

// hasNUL reports whether any string in a decoded JSON value holds a NUL.
func hasNUL(value any) bool {
	switch typed := value.(type) {
	case string:
		return strings.ContainsRune(typed, 0)
	case []any:
		for _, child := range typed {
			if hasNUL(child) {
				return true
			}
		}
	case map[string]any:
		for key, child := range typed {
			if strings.ContainsRune(key, 0) || hasNUL(child) {
				return true
			}
		}
	}
	return false
}

// classifyError turns domain errors into messages the model can act on.
func classifyError(err error) error {
	if err == nil {
		return nil
	}
	var toolErr *ToolError
	switch {
	case errors.As(err, &toolErr):
		return err
	case errors.Is(err, services.ErrBuildNotFound), errors.Is(err, gorm.ErrRecordNotFound):
		return toolErrorf("build not found; use list_builds to see the builds this connection can access")
	case errors.Is(err, services.ErrProposalNotFound):
		return toolErrorf("proposal not found")
	case services.IsTopologyRejection(err):
		return &ToolError{Message: err.Error()}
	}
	return err
}

// audit records state-changing tool calls so owners and operators can see what
// an LLM client did. Arguments are not stored; proposals keep their own copy.
func (r *Registry) audit(actor Actor, tool string, args json.RawMessage, result *Result, err error, took time.Duration) {
	payload := map[string]any{"tool": tool, "ok": err == nil, "duration_ms": took.Milliseconds()}
	var target struct {
		BuildID string `json:"build_id"`
	}
	if json.Unmarshal(args, &target) == nil && target.BuildID != "" {
		payload["build_id"] = target.BuildID
	}
	if actor.TokenID != nil {
		payload["token_id"] = actor.TokenID
	}
	if result != nil && result.ProposalID != nil {
		payload["proposal_id"] = result.ProposalID
	}
	if err != nil {
		payload["error"] = truncate(err.Error(), 300)
	}
	userID := actor.UserID
	services.RecordEvent(r.deps.DB, &userID, auditEventType(actor), payload)
}

func auditEventType(actor Actor) string {
	if actor.Source == services.ProposalSourceChat {
		return "assistant.tool_call"
	}
	return "mcp.tool_call"
}

// ownedBuildID parses a build id argument and applies the actor's restriction.
// Ownership itself is enforced by the service call that follows.
func ownedBuildID(actor Actor, raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil {
		return uuid.Nil, toolErrorf("build_id must be a build id from list_builds")
	}
	if !actor.CanAccess(id) {
		return uuid.Nil, services.ErrBuildNotFound
	}
	return id, nil
}

func decodeArgs(args json.RawMessage, target any) error {
	if err := json.Unmarshal(args, target); err != nil {
		return toolErrorf("could not read the arguments: %v", err)
	}
	return nil
}

func truncate(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit]) + "…"
}

// reviewURL is where the owner reviews a proposal in the builder.
func reviewURL(actor Actor, buildID uuid.UUID, proposalID *uuid.UUID) string {
	url := strings.TrimRight(actor.AppURL, "/") + "/builder/" + buildID.String()
	if proposalID != nil {
		url += "?proposal=" + proposalID.String()
	}
	return url
}
