package llm

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/shared/constant"
)

// Output budgets tried in order. Current models take the first; an older model
// with a smaller output limit rejects it and is retried with the next.
var anthropicMaxTokens = []int64{32000, 8192, 4096}

type anthropicProvider struct {
	messages anthropic.BetaMessageService
	models   anthropic.ModelService
	model    string
}

func newAnthropic(cfg Config) *anthropicProvider {
	// Build the services from explicit options only. The SDK's default client
	// also reads ANTHROPIC_* variables from the server's environment, and a
	// user's request must never run on the operator's credentials or endpoint.
	opts := []option.RequestOption{
		option.WithEnvironmentProduction(),
		option.WithHTTPClient(cfg.HTTPClient),
		option.WithAPIKey(cfg.APIKey),
		option.WithMaxRetries(2),
	}
	if cfg.anthropicBaseURL != "" {
		opts = append(opts, option.WithBaseURL(cfg.anthropicBaseURL))
	}
	return &anthropicProvider{
		messages: anthropic.NewBetaMessageService(opts...),
		models:   anthropic.NewModelService(opts...),
		model:    cfg.Model,
	}
}

func (p *anthropicProvider) ID() string { return ProviderAnthropic + "/" + p.model }

// usesRefusalFallback reports whether the model runs safety classifiers that
// can decline a request. For those, a declined request is re-served by another
// model on Anthropic's side instead of ending the turn.
func usesRefusalFallback(model string) bool {
	for _, prefix := range []string{"claude-opus-5", "claude-fable", "claude-mythos"} {
		if strings.HasPrefix(model, prefix) {
			return true
		}
	}
	return false
}

func (p *anthropicProvider) tools(defs []ToolDef) []anthropic.BetaToolUnionParam {
	if len(defs) == 0 {
		return nil
	}
	tools := make([]anthropic.BetaToolUnionParam, 0, len(defs))
	for _, def := range defs {
		var schema struct {
			Properties           map[string]any `json:"properties"`
			Required             []string       `json:"required"`
			AdditionalProperties *bool          `json:"additionalProperties"`
		}
		_ = json.Unmarshal(def.InputSchema, &schema)
		if schema.Properties == nil {
			schema.Properties = map[string]any{}
		}
		input := anthropic.BetaToolInputSchemaParam{Properties: schema.Properties, Required: schema.Required}
		if schema.AdditionalProperties != nil {
			input.ExtraFields = map[string]any{"additionalProperties": *schema.AdditionalProperties}
		}
		tools = append(tools, anthropic.BetaToolUnionParam{OfTool: &anthropic.BetaToolParam{
			Name:        def.Name,
			Description: anthropic.String(def.Description),
			InputSchema: input,
			// Stream large tool inputs as they are written. The caller validates
			// every input against its schema before running the tool.
			EagerInputStreaming: anthropic.Bool(true),
		}})
	}
	return tools
}

func (p *anthropicProvider) history(messages []Message) []anthropic.BetaMessageParam {
	history := make([]anthropic.BetaMessageParam, 0, len(messages))
	for _, message := range messages {
		switch message.Role {
		case RoleUser:
			history = append(history, anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock(message.Text)))
		case RoleAssistant:
			// Replay the provider's own message when it came from this model, so
			// its reasoning blocks are returned exactly as they were issued.
			if len(message.Native) > 0 && message.NativeFor == p.ID() {
				var original anthropic.BetaMessage
				if err := json.Unmarshal(message.Native, &original); err == nil && len(original.Content) > 0 {
					history = append(history, original.ToParam())
					continue
				}
			}
			blocks := []anthropic.BetaContentBlockParamUnion{}
			if strings.TrimSpace(message.Text) != "" {
				blocks = append(blocks, anthropic.NewBetaTextBlock(message.Text))
			}
			for _, call := range message.ToolCalls {
				var input any = map[string]any{}
				if len(call.Input) > 0 {
					_ = json.Unmarshal(call.Input, &input)
				}
				blocks = append(blocks, anthropic.NewBetaToolUseBlock(call.ID, input, call.Name))
			}
			if len(blocks) == 0 {
				continue
			}
			history = append(history, anthropic.BetaMessageParam{Role: anthropic.BetaMessageParamRoleAssistant, Content: blocks})
		case RoleTool:
			// All results of one assistant turn go back in a single user message.
			blocks := make([]anthropic.BetaContentBlockParamUnion, 0, len(message.ToolResults))
			for _, result := range message.ToolResults {
				blocks = append(blocks, anthropic.NewBetaToolResultBlock(result.CallID, result.Content, result.IsError))
			}
			if len(blocks) > 0 {
				history = append(history, anthropic.NewBetaUserMessage(blocks...))
			}
		}
	}
	return history
}

func (p *anthropicProvider) Stream(ctx context.Context, req TurnRequest, onText func(string)) (*TurnResult, error) {
	params := anthropic.BetaMessageNewParams{
		Model:    anthropic.Model(p.model),
		Messages: p.history(req.Messages),
		Tools:    p.tools(req.Tools),
		// The system prompt and tool list never change between turns, so one
		// breakpoint on the system block caches both.
		System: []anthropic.BetaTextBlockParam{{Text: req.System, CacheControl: anthropic.NewBetaCacheControlEphemeralParam()}},
	}
	// Thinking is left at each model's default: adaptive on the current models,
	// off on older ones that would reject the adaptive setting.
	if usesRefusalFallback(p.model) {
		params.Fallbacks = anthropic.BetaFallbacksParamUnion{OfDefault: constant.ValueOf[constant.Default]()}
		params.Betas = []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01}
	}

	var lastErr error
	for _, maxTokens := range anthropicMaxTokens {
		params.MaxTokens = maxTokens
		result, emitted, err := p.streamOnce(ctx, params, onText)
		if err == nil {
			return result, nil
		}
		lastErr = err
		var providerErr *ProviderError
		tooLarge := errors.As(err, &providerErr) && providerErr.Status == 400 && strings.Contains(providerErr.Message, "max_tokens")
		if emitted || !tooLarge {
			break
		}
	}
	return nil, lastErr
}

// streamOnce runs one request. emitted reports whether any text reached the
// caller, in which case the request must not be retried.
func (p *anthropicProvider) streamOnce(ctx context.Context, params anthropic.BetaMessageNewParams, onText func(string)) (*TurnResult, bool, error) {
	stream := p.messages.NewStreaming(ctx, params)
	defer stream.Close()

	message := anthropic.BetaMessage{}
	emitted := false
	for stream.Next() {
		event := stream.Current()
		if err := message.Accumulate(event); err != nil {
			return nil, emitted, &ProviderError{Kind: KindUnavailable, Message: "the provider sent a malformed stream: " + err.Error()}
		}
		if event.Type == "content_block_delta" && event.Delta.Type == "text_delta" && event.Delta.Text != "" {
			emitted = true
			if onText != nil {
				onText(event.Delta.Text)
			}
		}
	}
	if err := stream.Err(); err != nil {
		return nil, emitted, convertAnthropicError(ctx, err)
	}

	result := &TurnResult{
		Native:       json.RawMessage(message.RawJSON()),
		InputTokens:  message.Usage.InputTokens,
		OutputTokens: message.Usage.OutputTokens,
	}
	var text strings.Builder
	for _, block := range message.Content {
		switch block.Type {
		case "text":
			text.WriteString(block.Text)
		case "tool_use":
			input := json.RawMessage(block.Input)
			if len(input) == 0 {
				input = json.RawMessage("{}")
			}
			result.ToolCalls = append(result.ToolCalls, ToolCall{ID: block.ID, Name: block.Name, Input: input})
		}
	}
	result.Text = text.String()

	switch message.StopReason {
	case anthropic.BetaStopReasonToolUse:
		result.StopReason = StopToolUse
	case anthropic.BetaStopReasonMaxTokens, anthropic.BetaStopReasonModelContextWindowExceeded:
		result.StopReason = StopMaxTokens
	case anthropic.BetaStopReasonRefusal:
		result.StopReason = StopRefusal
		result.StopDetail = message.StopDetails.Explanation
	default:
		result.StopReason = StopEnd
	}
	return result, emitted, nil
}

func convertAnthropicError(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	var apiErr *anthropic.Error
	if errors.As(err, &apiErr) {
		message := apiErr.Error()
		var body struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal([]byte(apiErr.RawJSON()), &body) == nil && body.Error.Message != "" {
			message = body.Error.Message
		}
		return &ProviderError{Kind: classifyStatus(apiErr.StatusCode), Status: apiErr.StatusCode, Message: message}
	}
	return &ProviderError{Kind: KindNetwork, Message: err.Error()}
}

func (p *anthropicProvider) ListModels(ctx context.Context) ([]string, error) {
	pager := p.models.ListAutoPaging(ctx, anthropic.ModelListParams{})
	ids := []string{}
	for pager.Next() && len(ids) < 300 {
		ids = append(ids, pager.Current().ID)
	}
	if err := pager.Err(); err != nil {
		return nil, convertAnthropicError(ctx, err)
	}
	sort.Strings(ids)
	return ids, nil
}
