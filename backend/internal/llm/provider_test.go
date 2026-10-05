package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// ─── Fake provider servers ───────────────────────────────────────────────────

type recorded struct {
	mu       sync.Mutex
	requests []recordedRequest
}

type recordedRequest struct {
	Path   string
	Header http.Header
	Body   map[string]any
}

func (r *recorded) add(req *http.Request) map[string]any {
	raw, _ := io.ReadAll(req.Body)
	body := map[string]any{}
	_ = json.Unmarshal(raw, &body)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.requests = append(r.requests, recordedRequest{Path: req.URL.Path, Header: req.Header.Clone(), Body: body})
	return body
}

func (r *recorded) last(t *testing.T) recordedRequest {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.requests) == 0 {
		t.Fatal("the provider was never called")
	}
	return r.requests[len(r.requests)-1]
}

func sse(w http.ResponseWriter, events ...string) {
	w.Header().Set("Content-Type", "text/event-stream")
	for _, event := range events {
		_, _ = io.WriteString(w, event)
	}
}

func anthropicEvent(name string, data any) string {
	raw, _ := json.Marshal(data)
	return fmt.Sprintf("event: %s\ndata: %s\n\n", name, raw)
}

// anthropicToolTurn is a streamed reply with a thinking block, a sentence of
// text and one tool call whose input arrives in two fragments.
func anthropicToolTurn(model string) []string {
	return []string{
		anthropicEvent("message_start", map[string]any{"type": "message_start", "message": map[string]any{
			"id": "msg_1", "type": "message", "role": "assistant", "model": model, "content": []any{},
			"stop_reason": nil, "stop_sequence": nil, "usage": map[string]any{"input_tokens": 120, "output_tokens": 1},
		}}),
		anthropicEvent("content_block_start", map[string]any{"type": "content_block_start", "index": 0,
			"content_block": map[string]any{"type": "thinking", "thinking": "", "signature": ""}}),
		anthropicEvent("content_block_delta", map[string]any{"type": "content_block_delta", "index": 0,
			"delta": map[string]any{"type": "signature_delta", "signature": "sig-abc"}}),
		anthropicEvent("content_block_stop", map[string]any{"type": "content_block_stop", "index": 0}),
		anthropicEvent("content_block_start", map[string]any{"type": "content_block_start", "index": 1,
			"content_block": map[string]any{"type": "text", "text": ""}}),
		anthropicEvent("content_block_delta", map[string]any{"type": "content_block_delta", "index": 1,
			"delta": map[string]any{"type": "text_delta", "text": "Let me look "}}),
		anthropicEvent("content_block_delta", map[string]any{"type": "content_block_delta", "index": 1,
			"delta": map[string]any{"type": "text_delta", "text": "at the build."}}),
		anthropicEvent("content_block_stop", map[string]any{"type": "content_block_stop", "index": 1}),
		anthropicEvent("content_block_start", map[string]any{"type": "content_block_start", "index": 2,
			"content_block": map[string]any{"type": "tool_use", "id": "toolu_1", "name": "get_build", "input": map[string]any{}}}),
		anthropicEvent("content_block_delta", map[string]any{"type": "content_block_delta", "index": 2,
			"delta": map[string]any{"type": "input_json_delta", "partial_json": `{"build_id":`}}),
		anthropicEvent("content_block_delta", map[string]any{"type": "content_block_delta", "index": 2,
			"delta": map[string]any{"type": "input_json_delta", "partial_json": `"b-1"}`}}),
		anthropicEvent("content_block_stop", map[string]any{"type": "content_block_stop", "index": 2}),
		anthropicEvent("message_delta", map[string]any{"type": "message_delta",
			"delta": map[string]any{"stop_reason": "tool_use", "stop_sequence": nil}, "usage": map[string]any{"output_tokens": 42}}),
		anthropicEvent("message_stop", map[string]any{"type": "message_stop"}),
	}
}

func newAnthropicForTest(t *testing.T, model string, handler http.HandlerFunc) (Provider, *recorded) {
	t.Helper()
	log := &recorded{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			body := log.add(r)
			r.Body = io.NopCloser(strings.NewReader(mustJSON(body)))
		} else {
			log.add(r)
		}
		handler(w, r)
	}))
	t.Cleanup(server.Close)
	provider, err := New(Config{
		Provider: ProviderAnthropic, Model: model, APIKey: "sk-ant-user-key",
		HTTPClient: SafeHTTPClient(true), anthropicBaseURL: server.URL,
	})
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	return provider, log
}

func mustJSON(value any) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

var testTools = []ToolDef{{
	Name: "get_build", Description: "Read a build",
	InputSchema: json.RawMessage(`{"type":"object","properties":{"build_id":{"type":"string","minLength":1}},"required":["build_id"],"additionalProperties":false}`),
}}

// ─── Anthropic ───────────────────────────────────────────────────────────────

func TestAnthropic_StreamsTextAndToolCalls(t *testing.T) {
	// The operator's own credentials must never be used for a user's request.
	t.Setenv("ANTHROPIC_API_KEY", "sk-ant-OPERATOR-key")
	t.Setenv("ANTHROPIC_AUTH_TOKEN", "operator-token")
	t.Setenv("ANTHROPIC_BASE_URL", "http://127.0.0.1:1")
	t.Setenv("ANTHROPIC_CUSTOM_HEADERS", "X-Operator: secret")

	provider, log := newAnthropicForTest(t, "claude-opus-5", func(w http.ResponseWriter, _ *http.Request) {
		sse(w, anthropicToolTurn("claude-opus-5")...)
	})

	var deltas []string
	result, err := provider.Stream(context.Background(), TurnRequest{
		System:   "You are the HLBuilder assistant.",
		Messages: []Message{{Role: RoleUser, Text: "What is in my lab?"}},
		Tools:    testTools,
	}, func(delta string) { deltas = append(deltas, delta) })
	if err != nil {
		t.Fatalf("stream: %v", err)
	}

	if strings.Join(deltas, "|") != "Let me look |at the build." || result.Text != "Let me look at the build." {
		t.Fatalf("text not streamed as generated: %q / %q", deltas, result.Text)
	}
	if result.StopReason != StopToolUse || len(result.ToolCalls) != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if call := result.ToolCalls[0]; call.ID != "toolu_1" || call.Name != "get_build" || string(call.Input) != `{"build_id":"b-1"}` {
		t.Fatalf("tool input fragments not assembled: %+v", call)
	}
	if result.InputTokens != 120 || result.OutputTokens != 42 {
		t.Fatalf("usage: %d in, %d out", result.InputTokens, result.OutputTokens)
	}
	// The native message keeps the reasoning block and its signature for replay.
	if !strings.Contains(string(result.Native), "sig-abc") || !strings.Contains(string(result.Native), "toolu_1") {
		t.Fatalf("native message is incomplete: %s", result.Native)
	}

	request := log.last(t)
	if request.Path != "/v1/messages" {
		t.Fatalf("path %q", request.Path)
	}
	if got := request.Header.Get("X-Api-Key"); got != "sk-ant-user-key" {
		t.Fatalf("request used key %q instead of the user's", got)
	}
	if request.Header.Get("Authorization") != "" || request.Header.Get("X-Operator") != "" {
		t.Fatalf("operator environment leaked into the request: %v", request.Header)
	}
	if request.Body["model"] != "claude-opus-5" || request.Body["stream"] != true || request.Body["max_tokens"] != float64(32000) {
		t.Fatalf("unexpected request: %v", request.Body)
	}
	if _, set := request.Body["thinking"]; set {
		t.Fatal("thinking is left at the model default, not forced")
	}
	// Refusals on this model are re-served by a fallback instead of ending the turn.
	if request.Body["fallbacks"] != "default" || !strings.Contains(request.Header.Get("Anthropic-Beta"), "server-side-fallback-2026-07-01") {
		t.Fatalf("refusal fallback not requested: fallbacks=%v beta=%q", request.Body["fallbacks"], request.Header.Get("Anthropic-Beta"))
	}
	system := request.Body["system"].([]any)[0].(map[string]any)
	if system["text"] != "You are the HLBuilder assistant." || system["cache_control"] == nil {
		t.Fatalf("system prompt should be sent with a cache breakpoint: %v", system)
	}
	tool := request.Body["tools"].([]any)[0].(map[string]any)
	schema := tool["input_schema"].(map[string]any)
	if tool["name"] != "get_build" || tool["eager_input_streaming"] != true || schema["type"] != "object" || schema["additionalProperties"] != false {
		t.Fatalf("unexpected tool definition: %v", tool)
	}
}

func TestAnthropic_ReplaysNativeMessagesOnlyForTheSameModel(t *testing.T) {
	provider, log := newAnthropicForTest(t, "claude-opus-5", func(w http.ResponseWriter, _ *http.Request) {
		sse(w, anthropicToolTurn("claude-opus-5")...)
	})
	first, err := provider.Stream(context.Background(), TurnRequest{
		System: "s", Messages: []Message{{Role: RoleUser, Text: "hi"}}, Tools: testTools,
	}, nil)
	if err != nil {
		t.Fatalf("stream: %v", err)
	}

	conversation := []Message{
		{Role: RoleUser, Text: "hi"},
		{Role: RoleAssistant, Text: first.Text, ToolCalls: first.ToolCalls, Native: first.Native, NativeFor: provider.ID()},
		{Role: RoleTool, ToolResults: []ToolResult{{CallID: "toolu_1", Name: "get_build", Content: `{"nodes":[]}`}}},
	}
	if _, err := provider.Stream(context.Background(), TurnRequest{System: "s", Messages: conversation, Tools: testTools}, nil); err != nil {
		t.Fatalf("second turn: %v", err)
	}
	messages := log.last(t).Body["messages"].([]any)
	if len(messages) != 3 {
		t.Fatalf("expected 3 messages, got %d", len(messages))
	}
	assistant := messages[1].(map[string]any)["content"].([]any)
	if len(assistant) != 3 || assistant[0].(map[string]any)["type"] != "thinking" || assistant[0].(map[string]any)["signature"] != "sig-abc" {
		t.Fatalf("reasoning block must be replayed unchanged: %v", assistant)
	}
	results := messages[2].(map[string]any)
	if results["role"] != "user" || results["content"].([]any)[0].(map[string]any)["tool_use_id"] != "toolu_1" {
		t.Fatalf("tool results must go back in one user message: %v", results)
	}

	// Another model cannot verify those reasoning blocks: send the plain form.
	conversation[1].NativeFor = "anthropic/claude-sonnet-5"
	if _, err := provider.Stream(context.Background(), TurnRequest{System: "s", Messages: conversation, Tools: testTools}, nil); err != nil {
		t.Fatalf("third turn: %v", err)
	}
	rebuilt := log.last(t).Body["messages"].([]any)[1].(map[string]any)["content"].([]any)
	if len(rebuilt) != 2 || rebuilt[0].(map[string]any)["type"] != "text" || rebuilt[1].(map[string]any)["type"] != "tool_use" {
		t.Fatalf("expected text + tool_use without reasoning, got %v", rebuilt)
	}
	if input := rebuilt[1].(map[string]any)["input"].(map[string]any); input["build_id"] != "b-1" {
		t.Fatalf("tool input lost in the rebuilt message: %v", input)
	}
}

func TestAnthropic_ModelSpecificBehaviour(t *testing.T) {
	// An older model has no refusal classifiers: no fallback, no beta header.
	provider, log := newAnthropicForTest(t, "claude-haiku-4-5", func(w http.ResponseWriter, _ *http.Request) {
		sse(w, anthropicToolTurn("claude-haiku-4-5")...)
	})
	if _, err := provider.Stream(context.Background(), TurnRequest{System: "s", Messages: []Message{{Role: RoleUser, Text: "hi"}}}, nil); err != nil {
		t.Fatalf("stream: %v", err)
	}
	request := log.last(t)
	if _, set := request.Body["fallbacks"]; set || strings.Contains(request.Header.Get("Anthropic-Beta"), "fallback") {
		t.Fatalf("fallbacks must only be requested where they apply: %v", request.Body["fallbacks"])
	}
	if _, set := request.Body["tools"]; set {
		t.Fatal("no tools were given, none should be sent")
	}

	// A model with a small output limit rejects the first budget and gets a smaller one.
	attempts := 0
	small, smallLog := newAnthropicForTest(t, "claude-legacy", func(w http.ResponseWriter, r *http.Request) {
		attempts++
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["max_tokens"].(float64) > 8192 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, `{"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: 32000 > 8192, which is the maximum allowed"}}`)
			return
		}
		sse(w, anthropicToolTurn("claude-legacy")...)
	})
	if _, err := small.Stream(context.Background(), TurnRequest{System: "s", Messages: []Message{{Role: RoleUser, Text: "hi"}}}, nil); err != nil {
		t.Fatalf("stream with a smaller budget: %v", err)
	}
	if attempts != 2 || smallLog.last(t).Body["max_tokens"] != float64(8192) {
		t.Fatalf("expected a retry with 8192 tokens, got %d attempts", attempts)
	}
}

func TestAnthropic_RefusalAndErrors(t *testing.T) {
	refusing, _ := newAnthropicForTest(t, "claude-opus-5", func(w http.ResponseWriter, _ *http.Request) {
		sse(w,
			anthropicEvent("message_start", map[string]any{"type": "message_start", "message": map[string]any{
				"id": "msg_2", "type": "message", "role": "assistant", "model": "claude-opus-5", "content": []any{},
				"usage": map[string]any{"input_tokens": 5, "output_tokens": 0}}}),
			anthropicEvent("message_delta", map[string]any{"type": "message_delta",
				"delta": map[string]any{"stop_reason": "refusal", "stop_details": map[string]any{"type": "refusal", "category": "cyber", "explanation": "declined"}},
				"usage": map[string]any{"output_tokens": 0}}),
			anthropicEvent("message_stop", map[string]any{"type": "message_stop"}),
		)
	})
	result, err := refusing.Stream(context.Background(), TurnRequest{System: "s", Messages: []Message{{Role: RoleUser, Text: "hi"}}}, nil)
	if err != nil || result.StopReason != StopRefusal || result.StopDetail != "declined" || len(result.ToolCalls) != 0 {
		t.Fatalf("refusal not reported: %+v, %v", result, err)
	}

	cases := map[int]string{
		http.StatusUnauthorized:    KindAuth,
		http.StatusForbidden:       KindAuth,
		http.StatusNotFound:        KindModel,
		http.StatusTooManyRequests: KindRateLimit,
		http.StatusBadRequest:      KindRequest,
	}
	for status, kind := range cases {
		failing, _ := newAnthropicForTest(t, "claude-opus-5", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(status)
			_, _ = io.WriteString(w, `{"type":"error","error":{"type":"some_error","message":"provider says no"}}`)
		})
		_, err := failing.Stream(context.Background(), TurnRequest{System: "s", Messages: []Message{{Role: RoleUser, Text: "hi"}}}, nil)
		var providerErr *ProviderError
		if !errors.As(err, &providerErr) || providerErr.Kind != kind || providerErr.Status != status {
			t.Errorf("status %d: got %v, want kind %s", status, err, kind)
			continue
		}
		if providerErr.Message != "provider says no" || providerErr.UserMessage() == "" {
			t.Errorf("status %d: message %q", status, providerErr.Message)
		}
		// Messages shown to the user never echo the key.
		if strings.Contains(providerErr.UserMessage(), "sk-ant") {
			t.Errorf("status %d: user message leaks the key", status)
		}
	}
}

func TestAnthropic_ListModels(t *testing.T) {
	provider, log := newAnthropicForTest(t, "claude-opus-5", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[{"id":"claude-sonnet-5","type":"model","display_name":"Sonnet"},{"id":"claude-opus-5","type":"model","display_name":"Opus"}],"has_more":false,"first_id":"a","last_id":"b"}`)
	})
	models, err := provider.ListModels(context.Background())
	if err != nil || strings.Join(models, ",") != "claude-opus-5,claude-sonnet-5" {
		t.Fatalf("models: %v, %v", models, err)
	}
	if request := log.last(t); request.Path != "/v1/models" || request.Header.Get("X-Api-Key") != "sk-ant-user-key" {
		t.Fatalf("unexpected models request: %s %v", request.Path, request.Header)
	}
}

// ─── OpenAI-compatible ───────────────────────────────────────────────────────

func chunk(delta map[string]any, finish any) string {
	raw, _ := json.Marshal(map[string]any{
		"id": "chatcmpl-1", "object": "chat.completion.chunk", "created": 1, "model": "m",
		"choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}},
	})
	return "data: " + string(raw) + "\n\n"
}

func newCompatibleForTest(t *testing.T, providerID, key string, handler http.HandlerFunc) (Provider, *recorded) {
	t.Helper()
	log := &recorded{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.add(r)
		handler(w, r)
	}))
	t.Cleanup(server.Close)
	provider, err := New(Config{Provider: providerID, Model: "llama3.1", APIKey: key, BaseURL: server.URL + "/v1", HTTPClient: SafeHTTPClient(true)})
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	return provider, log
}

func TestOpenAICompatible_StreamsTextAndAssemblesToolCalls(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "sk-OPERATOR")
	t.Setenv("OPENAI_ORG_ID", "org-operator")
	t.Setenv("OPENAI_BASE_URL", "http://127.0.0.1:1")

	provider, log := newCompatibleForTest(t, ProviderOpenAICompatible, "sk-user", func(w http.ResponseWriter, _ *http.Request) {
		sse(w,
			chunk(map[string]any{"role": "assistant", "content": "Checking "}, nil),
			chunk(map[string]any{"content": "the build."}, nil),
			chunk(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "call_a", "type": "function", "function": map[string]any{"name": "get_build", "arguments": `{"build`}}}}, nil),
			chunk(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "function": map[string]any{"arguments": `_id":"b-1"}`}}}}, nil),
			chunk(map[string]any{"tool_calls": []any{map[string]any{"index": 1, "id": "call_b", "type": "function", "function": map[string]any{"name": "validate_build", "arguments": `{"build_id":"b-1"}`}}}}, nil),
			chunk(map[string]any{}, "tool_calls"),
			"data: [DONE]\n\n",
		)
	})

	var deltas []string
	result, err := provider.Stream(context.Background(), TurnRequest{
		System: "system text",
		Messages: []Message{
			{Role: RoleUser, Text: "hello"},
			{Role: RoleAssistant, Text: "one moment", ToolCalls: []ToolCall{{ID: "call_0", Name: "list_builds", Input: json.RawMessage(`{}`)}}},
			{Role: RoleTool, ToolResults: []ToolResult{{CallID: "call_0", Name: "list_builds", Content: "boom", IsError: true}}},
		},
		Tools: testTools,
	}, func(delta string) { deltas = append(deltas, delta) })
	if err != nil {
		t.Fatalf("stream: %v", err)
	}
	if strings.Join(deltas, "|") != "Checking |the build." || result.Text != "Checking the build." || result.StopReason != StopToolUse {
		t.Fatalf("unexpected result: %q %+v", deltas, result)
	}
	if len(result.ToolCalls) != 2 ||
		result.ToolCalls[0].ID != "call_a" || string(result.ToolCalls[0].Input) != `{"build_id":"b-1"}` ||
		result.ToolCalls[1].Name != "validate_build" {
		t.Fatalf("tool calls not assembled: %+v", result.ToolCalls)
	}

	request := log.last(t)
	if request.Path != "/v1/chat/completions" || request.Header.Get("Authorization") != "Bearer sk-user" {
		t.Fatalf("unexpected request: %s auth=%q", request.Path, request.Header.Get("Authorization"))
	}
	if request.Header.Get("Openai-Organization") != "" {
		t.Fatal("operator environment leaked into the request")
	}
	messages := request.Body["messages"].([]any)
	roles := []string{}
	for _, message := range messages {
		roles = append(roles, message.(map[string]any)["role"].(string))
	}
	if strings.Join(roles, ",") != "system,user,assistant,tool" {
		t.Fatalf("roles: %v", roles)
	}
	assistant := messages[2].(map[string]any)
	if assistant["content"] != "one moment" || assistant["tool_calls"].([]any)[0].(map[string]any)["id"] != "call_0" {
		t.Fatalf("assistant turn: %v", assistant)
	}
	if tool := messages[3].(map[string]any); tool["tool_call_id"] != "call_0" || tool["content"] != "Error: boom" {
		t.Fatalf("tool turn: %v", tool)
	}
	parameters := request.Body["tools"].([]any)[0].(map[string]any)["function"].(map[string]any)["parameters"].(map[string]any)
	if parameters["additionalProperties"] != false {
		t.Fatalf("the full schema should reach OpenAI-style endpoints: %v", parameters)
	}
}

func TestOpenAICompatible_ToleratesProviderQuirks(t *testing.T) {
	// Whole tool calls on a reused index, no ids, and "stop" as the finish reason.
	provider, log := newCompatibleForTest(t, ProviderOllama, "", func(w http.ResponseWriter, _ *http.Request) {
		sse(w,
			chunk(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "x1", "function": map[string]any{"name": "get_build", "arguments": `{"build_id":"b-1"}`}}}}, nil),
			chunk(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "x2", "function": map[string]any{"name": "validate_build", "arguments": ""}}}}, nil),
			chunk(map[string]any{}, "stop"),
			"data: [DONE]\n\n",
		)
	})
	result, err := provider.Stream(context.Background(), TurnRequest{System: "s", Messages: []Message{{Role: RoleUser, Text: "hi"}}, Tools: testTools}, nil)
	if err != nil {
		t.Fatalf("stream: %v", err)
	}
	if len(result.ToolCalls) != 2 || result.ToolCalls[1].ID != "x2" || string(result.ToolCalls[1].Input) != "{}" || result.StopReason != StopToolUse {
		t.Fatalf("unexpected result: %+v", result)
	}
	// A keyless local endpoint gets no Authorization header at all.
	if auth := log.last(t).Header.Get("Authorization"); auth != "" {
		t.Fatalf("unexpected Authorization header %q", auth)
	}
	if provider.ID() != "ollama/llama3.1" {
		t.Fatalf("id %q", provider.ID())
	}

	truncated, _ := newCompatibleForTest(t, ProviderOpenAICompatible, "k", func(w http.ResponseWriter, _ *http.Request) {
		sse(w, chunk(map[string]any{"content": "partial"}, "length"), "data: [DONE]\n\n")
	})
	if result, err := truncated.Stream(context.Background(), TurnRequest{System: "s", Messages: []Message{{Role: RoleUser, Text: "hi"}}}, nil); err != nil || result.StopReason != StopMaxTokens {
		t.Fatalf("length finish: %+v, %v", result, err)
	}
}

func TestOpenAICompatible_GeminiSchemaIsReduced(t *testing.T) {
	provider, log := newCompatibleForTest(t, ProviderOpenAICompatible, "k", func(w http.ResponseWriter, _ *http.Request) {
		sse(w, chunk(map[string]any{"content": "ok"}, "stop"), "data: [DONE]\n\n")
	})
	// Same server, but configured as Gemini.
	gemini := provider.(*openAIProvider)
	gemini.preset, _ = PresetByID(ProviderGemini)

	tools := []ToolDef{{Name: "propose", Description: "d", InputSchema: json.RawMessage(`{
		"type":"object","additionalProperties":false,"required":["operations"],
		"properties":{
			"maximum":{"type":"number","minimum":0,"maximum":10},
			"operations":{"type":"array","minItems":1,"maxItems":100,"items":{"type":"object","additionalProperties":false,
				"properties":{"name":{"type":"string","maxLength":120},"op":{"type":"string","enum":["add_node"]}}}}}}`)}}
	if _, err := gemini.Stream(context.Background(), TurnRequest{System: "s", Messages: []Message{{Role: RoleUser, Text: "hi"}}, Tools: tools}, nil); err != nil {
		t.Fatalf("stream: %v", err)
	}
	parameters := log.last(t).Body["tools"].([]any)[0].(map[string]any)["function"].(map[string]any)["parameters"].(map[string]any)
	raw := mustJSON(parameters)
	for _, keyword := range []string{"additionalProperties", "minItems", "maxItems", "maxLength", `"minimum"`} {
		if strings.Contains(raw, keyword) {
			t.Errorf("%s should be removed for Gemini: %s", keyword, raw)
		}
	}
	properties := parameters["properties"].(map[string]any)
	// A property that happens to be called "maximum" is a property, not a keyword.
	if _, kept := properties["maximum"]; !kept {
		t.Fatalf("property named like a keyword was dropped: %s", raw)
	}
	operation := properties["operations"].(map[string]any)["items"].(map[string]any)["properties"].(map[string]any)
	if operation["op"].(map[string]any)["enum"] == nil || parameters["required"] == nil {
		t.Fatalf("supported keywords must survive: %s", raw)
	}
}

func TestOpenAICompatible_ErrorsAndModels(t *testing.T) {
	failing, _ := newCompatibleForTest(t, ProviderOpenAICompatible, "sk-bad", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":{"message":"Incorrect API key provided","type":"invalid_request_error","code":"invalid_api_key"}}`)
	})
	_, err := failing.Stream(context.Background(), TurnRequest{System: "s", Messages: []Message{{Role: RoleUser, Text: "hi"}}}, nil)
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) || providerErr.Kind != KindAuth || !strings.Contains(providerErr.UserMessage(), "API key") {
		t.Fatalf("expected an auth error, got %v", err)
	}

	listing, log := newCompatibleForTest(t, ProviderOpenAICompatible, "sk-user", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"object":"list","data":[{"id":"zeta","object":"model"},{"id":"alpha","object":"model"}]}`)
	})
	models, err := listing.ListModels(context.Background())
	if err != nil || strings.Join(models, ",") != "alpha,zeta" {
		t.Fatalf("models: %v, %v", models, err)
	}
	if log.last(t).Path != "/v1/models" {
		t.Fatalf("path %q", log.last(t).Path)
	}

	// Cancelling the request surfaces as the context error, not as a provider failure.
	ctx, cancel := context.WithCancel(context.Background())
	hanging, _ := newCompatibleForTest(t, ProviderOpenAICompatible, "k", func(w http.ResponseWriter, r *http.Request) {
		sse(w, chunk(map[string]any{"content": "start"}, nil))
		w.(http.Flusher).Flush()
		cancel()
		<-r.Context().Done()
	})
	if _, err := hanging.Stream(ctx, TurnRequest{System: "s", Messages: []Message{{Role: RoleUser, Text: "hi"}}}, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
}

func TestNew_ValidatesTheConfiguration(t *testing.T) {
	client := SafeHTTPClient(true)
	if _, err := New(Config{Provider: "skynet", Model: "m", HTTPClient: client}); err == nil {
		t.Fatal("unknown provider accepted")
	}
	if _, err := New(Config{Provider: ProviderOpenAI, Model: "m"}); err == nil {
		t.Fatal("a provider needs an HTTP client")
	}
	if _, err := New(Config{Provider: ProviderOpenAICompatible, Model: "m", HTTPClient: client}); err == nil {
		t.Fatal("a custom endpoint needs an address")
	}
	// Fixed providers ignore a base URL: a user cannot redirect "OpenAI" elsewhere.
	fixed, err := New(Config{Provider: ProviderOpenAI, Model: "m", BaseURL: "https://evil.example/v1", APIKey: "k", HTTPClient: client})
	if err != nil {
		t.Fatalf("new: %v", err)
	}
	if fixed.ID() != "openai/m" {
		t.Fatalf("id %q", fixed.ID())
	}
	for _, preset := range Presets {
		if preset.Label == "" || (!preset.CustomBaseURL && preset.BaseURL == "") {
			t.Errorf("preset %s is incomplete", preset.ID)
		}
		if preset.KeyRequired && preset.KeyHelpURL == "" {
			t.Errorf("preset %s should say where to get a key", preset.ID)
		}
	}
}
