package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/shared"
)

// openAIProvider speaks the OpenAI chat completions API. Besides OpenAI it
// serves every endpoint that implements that API: Gemini's compatibility
// endpoint, OpenRouter, Ollama, LM Studio and others. Those differ in small
// ways, so streamed tool calls are assembled here rather than by the SDK's
// accumulator, which assumes OpenAI's exact chunk shape.
type openAIProvider struct {
	chat   openai.ChatCompletionService
	models openai.ModelService
	model  string
	preset Preset
}

func newOpenAICompatible(cfg Config, preset Preset) *openAIProvider {
	baseURL := cfg.BaseURL
	if !strings.HasSuffix(baseURL, "/") {
		baseURL += "/"
	}
	// Explicit options only: the default client would also apply OPENAI_*
	// variables from the server's environment to a user's request.
	opts := []option.RequestOption{
		option.WithBaseURL(baseURL),
		option.WithHTTPClient(cfg.HTTPClient),
		option.WithMaxRetries(2),
	}
	if cfg.APIKey != "" {
		opts = append(opts, option.WithAPIKey(cfg.APIKey))
	}
	return &openAIProvider{
		chat:   openai.NewChatCompletionService(opts...),
		models: openai.NewModelService(opts...),
		model:  cfg.Model,
		preset: preset,
	}
}

func (p *openAIProvider) ID() string { return p.preset.ID + "/" + p.model }

// Schema keywords Gemini's compatibility endpoint rejects. Arguments are
// validated against the full schema on our side either way.
var geminiUnsupportedKeywords = map[string]bool{
	"additionalProperties": true, "minLength": true, "maxLength": true,
	"minimum": true, "maximum": true, "minItems": true, "maxItems": true,
}

func stripKeywords(value any, drop map[string]bool) any {
	switch typed := value.(type) {
	case map[string]any:
		cleaned := make(map[string]any, len(typed))
		for key, child := range typed {
			if drop[key] {
				continue
			}
			// "properties" maps property names to schemas; a property may
			// legitimately share its name with a keyword.
			if key == "properties" {
				if properties, ok := child.(map[string]any); ok {
					kept := make(map[string]any, len(properties))
					for name, schema := range properties {
						kept[name] = stripKeywords(schema, drop)
					}
					cleaned[key] = kept
					continue
				}
			}
			cleaned[key] = stripKeywords(child, drop)
		}
		return cleaned
	case []any:
		cleaned := make([]any, len(typed))
		for i, child := range typed {
			cleaned[i] = stripKeywords(child, drop)
		}
		return cleaned
	}
	return value
}

func (p *openAIProvider) tools(defs []ToolDef) []openai.ChatCompletionToolUnionParam {
	if len(defs) == 0 {
		return nil
	}
	tools := make([]openai.ChatCompletionToolUnionParam, 0, len(defs))
	for _, def := range defs {
		schema := map[string]any{}
		_ = json.Unmarshal(def.InputSchema, &schema)
		if p.preset.ID == ProviderGemini {
			schema, _ = stripKeywords(schema, geminiUnsupportedKeywords).(map[string]any)
		}
		tools = append(tools, openai.ChatCompletionFunctionTool(shared.FunctionDefinitionParam{
			Name:        def.Name,
			Description: openai.String(def.Description),
			Parameters:  shared.FunctionParameters(schema),
		}))
	}
	return tools
}

func (p *openAIProvider) history(system string, messages []Message) []openai.ChatCompletionMessageParamUnion {
	history := []openai.ChatCompletionMessageParamUnion{openai.SystemMessage(system)}
	for _, message := range messages {
		switch message.Role {
		case RoleUser:
			history = append(history, openai.UserMessage(message.Text))
		case RoleAssistant:
			assistant := openai.ChatCompletionAssistantMessageParam{}
			if message.Text != "" {
				assistant.Content.OfString = openai.String(message.Text)
			}
			for _, call := range message.ToolCalls {
				arguments := string(call.Input)
				if strings.TrimSpace(arguments) == "" {
					arguments = "{}"
				}
				assistant.ToolCalls = append(assistant.ToolCalls, openai.ChatCompletionMessageToolCallUnionParam{
					OfFunction: &openai.ChatCompletionMessageFunctionToolCallParam{
						ID:       call.ID,
						Function: openai.ChatCompletionMessageFunctionToolCallFunctionParam{Name: call.Name, Arguments: arguments},
					},
				})
			}
			if message.Text == "" && len(assistant.ToolCalls) == 0 {
				continue
			}
			history = append(history, openai.ChatCompletionMessageParamUnion{OfAssistant: &assistant})
		case RoleTool:
			for _, result := range message.ToolResults {
				content := result.Content
				if result.IsError {
					content = "Error: " + content
				}
				history = append(history, openai.ToolMessage(content, result.CallID))
			}
		}
	}
	return history
}

type pendingToolCall struct {
	id        string
	name      string
	arguments strings.Builder
}

func (p *openAIProvider) Stream(ctx context.Context, req TurnRequest, onText func(string)) (*TurnResult, error) {
	params := openai.ChatCompletionNewParams{
		Model:    shared.ChatModel(p.model),
		Messages: p.history(req.System, req.Messages),
		Tools:    p.tools(req.Tools),
	}
	stream := p.chat.NewStreaming(ctx, params)
	defer stream.Close()

	var text strings.Builder
	calls := []*pendingToolCall{}
	slotByIndex := map[int64]int{}
	finish := ""
	result := &TurnResult{}

	for stream.Next() {
		chunk := stream.Current()
		if chunk.Usage.TotalTokens > 0 {
			result.InputTokens, result.OutputTokens = chunk.Usage.PromptTokens, chunk.Usage.CompletionTokens
		}
		for _, choice := range chunk.Choices {
			if choice.Index != 0 {
				continue
			}
			if choice.Delta.Content != "" {
				text.WriteString(choice.Delta.Content)
				if onText != nil {
					onText(choice.Delta.Content)
				}
			}
			for _, delta := range choice.Delta.ToolCalls {
				slot, known := slotByIndex[delta.Index]
				// Some endpoints send every call whole and reuse index 0; a new
				// id on a known index starts a new call.
				if !known || (delta.ID != "" && calls[slot].id != "" && calls[slot].id != delta.ID) {
					calls = append(calls, &pendingToolCall{})
					slot = len(calls) - 1
					slotByIndex[delta.Index] = slot
				}
				call := calls[slot]
				if delta.ID != "" {
					call.id = delta.ID
				}
				if delta.Function.Name != "" {
					call.name = delta.Function.Name
				}
				call.arguments.WriteString(delta.Function.Arguments)
			}
			if choice.FinishReason != "" {
				finish = choice.FinishReason
			}
		}
	}
	if err := stream.Err(); err != nil {
		return nil, convertOpenAIError(ctx, err)
	}

	result.Text = text.String()
	for i, call := range calls {
		if call.name == "" {
			continue
		}
		id := call.id
		if id == "" {
			id = fmt.Sprintf("call_%d", i+1)
		}
		arguments := strings.TrimSpace(call.arguments.String())
		if arguments == "" {
			arguments = "{}"
		}
		result.ToolCalls = append(result.ToolCalls, ToolCall{ID: id, Name: call.name, Input: json.RawMessage(arguments)})
	}

	switch {
	case finish == "length":
		result.StopReason = StopMaxTokens
	case finish == "content_filter":
		result.StopReason = StopRefusal
	case len(result.ToolCalls) > 0:
		// Not every endpoint reports "tool_calls" as the finish reason.
		result.StopReason = StopToolUse
	default:
		result.StopReason = StopEnd
	}
	return result, nil
}

func convertOpenAIError(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	var apiErr *openai.Error
	if errors.As(err, &apiErr) {
		message := apiErr.Message
		if message == "" {
			message = apiErr.Error()
		}
		return &ProviderError{Kind: classifyStatus(apiErr.StatusCode), Status: apiErr.StatusCode, Message: message}
	}
	if errors.Is(err, ErrPrivateEndpoint) {
		return &ProviderError{Kind: KindNetwork, Message: ErrPrivateEndpoint.Error()}
	}
	return &ProviderError{Kind: KindNetwork, Message: err.Error()}
}

func (p *openAIProvider) ListModels(ctx context.Context) ([]string, error) {
	pager := p.models.ListAutoPaging(ctx)
	ids := []string{}
	for pager.Next() && len(ids) < 500 {
		ids = append(ids, pager.Current().ID)
	}
	if err := pager.Err(); err != nil {
		return nil, convertOpenAIError(ctx, err)
	}
	sort.Strings(ids)
	return ids, nil
}
