// Package llm talks to the model provider a user configured for the in-app
// assistant. It hides the differences between provider APIs behind one small
// interface: send the conversation and the tool list, stream text back, and
// report the tool calls the model wants to make.
package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// ToolDef describes a tool the model may call.
type ToolDef struct {
	Name        string
	Description string
	InputSchema json.RawMessage
}

// ToolCall is a tool invocation requested by the model.
type ToolCall struct {
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
}

// ToolResult answers a ToolCall.
type ToolResult struct {
	CallID  string
	Name    string
	Content string
	IsError bool
}

// Roles of a conversation message.
const (
	RoleUser      = "user"
	RoleAssistant = "assistant"
	RoleTool      = "tool"
)

// Message is one turn of the conversation in provider-neutral form.
type Message struct {
	Role string
	// Text is the user's text or the assistant's visible reply.
	Text string
	// ToolCalls are set on assistant messages that call tools.
	ToolCalls []ToolCall
	// ToolResults are set on tool messages; they answer the preceding assistant message.
	ToolResults []ToolResult
	// Native is the assistant message exactly as the provider returned it. When
	// NativeFor matches the provider and model in use, it is replayed unchanged
	// so reasoning the provider attached to the turn stays valid.
	Native    json.RawMessage
	NativeFor string
}

// TurnRequest is one model call.
type TurnRequest struct {
	System   string
	Messages []Message
	Tools    []ToolDef
}

// Stop reasons, normalised across providers.
const (
	StopEnd       = "end"
	StopToolUse   = "tool_use"
	StopMaxTokens = "max_tokens"
	StopRefusal   = "refusal"
)

// TurnResult is the model's reply to one call.
type TurnResult struct {
	Text       string
	ToolCalls  []ToolCall
	StopReason string
	// StopDetail carries the provider's explanation for a refusal, if any.
	StopDetail string
	// Native is the assistant message in the provider's own form, for replay.
	Native       json.RawMessage
	InputTokens  int64
	OutputTokens int64
}

// Provider is a configured model endpoint.
type Provider interface {
	// Stream runs one model call. onText receives the visible reply as it is
	// generated; the complete reply is also in the result.
	Stream(ctx context.Context, req TurnRequest, onText func(delta string)) (*TurnResult, error)
	// ListModels returns the model ids the key can use. It costs no tokens and
	// doubles as a credentials check.
	ListModels(ctx context.Context) ([]string, error)
	// ID identifies the provider and model, to decide whether stored native
	// messages can be replayed.
	ID() string
}

// Config selects and authenticates a provider.
type Config struct {
	Provider string
	Model    string
	// BaseURL overrides the preset's endpoint for providers that allow it.
	BaseURL string
	APIKey  string
	// HTTPClient performs the requests; see SafeHTTPClient.
	HTTPClient *http.Client

	// anthropicBaseURL points the Anthropic adapter at a stand-in server in
	// tests. It is unexported: outside this package the endpoint is fixed.
	anthropicBaseURL string
}

// Error kinds, used to tell the user what to fix.
const (
	KindAuth        = "auth"
	KindRateLimit   = "rate_limit"
	KindModel       = "model"
	KindRequest     = "request"
	KindUnavailable = "unavailable"
	KindNetwork     = "network"
)

// ProviderError is a failure reported by, or on the way to, the provider.
type ProviderError struct {
	Kind    string
	Status  int
	Message string
}

func (e *ProviderError) Error() string { return e.Message }

// UserMessage explains the failure in terms of what the user can do about it.
func (e *ProviderError) UserMessage() string {
	switch e.Kind {
	case KindAuth:
		return "The provider rejected the API key. Check the key in Settings."
	case KindRateLimit:
		return "The provider is rate limiting this key or the account is out of credit. Try again in a moment."
	case KindModel:
		return "The provider does not know this model, or the key cannot use it. Pick another model in Settings."
	case KindUnavailable:
		return "The provider is having trouble right now. Try again in a moment."
	case KindNetwork:
		return "Could not reach the provider. Check the endpoint address in Settings."
	}
	if e.Message != "" {
		return "The provider refused the request: " + truncate(e.Message, 300)
	}
	return "The provider refused the request."
}

// classifyStatus maps an HTTP status from a provider to an error kind.
func classifyStatus(status int) string {
	switch {
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return KindAuth
	case status == http.StatusTooManyRequests || status == http.StatusPaymentRequired:
		return KindRateLimit
	case status == http.StatusNotFound:
		return KindModel
	case status >= 500:
		return KindUnavailable
	}
	return KindRequest
}

func truncate(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit]) + "…"
}

// New builds the provider for a configuration.
func New(cfg Config) (Provider, error) {
	preset, ok := PresetByID(cfg.Provider)
	if !ok {
		return nil, fmt.Errorf("unknown provider %q", cfg.Provider)
	}
	if cfg.HTTPClient == nil {
		return nil, errors.New("llm: an HTTP client is required")
	}
	cfg.Model = strings.TrimSpace(cfg.Model)
	if preset.ID == ProviderAnthropic {
		return newAnthropic(cfg), nil
	}
	baseURL := preset.BaseURL
	if preset.CustomBaseURL && strings.TrimSpace(cfg.BaseURL) != "" {
		baseURL = strings.TrimSpace(cfg.BaseURL)
	}
	if baseURL == "" {
		return nil, errors.New("this provider needs an endpoint address")
	}
	cfg.BaseURL = baseURL
	return newOpenAICompatible(cfg, preset), nil
}
