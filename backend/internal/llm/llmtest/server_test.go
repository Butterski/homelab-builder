package llmtest_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/llm"
	"github.com/Butterski/homelab-builder/backend/internal/llm/llmtest"
)

const buildID = "5f0c1f0e-6a43-4a57-9a39-0d1c7f1f2a10"

func scripted(t *testing.T) llm.Provider {
	t.Helper()
	server := httptest.NewServer(llmtest.NewHandler(llmtest.Options{}))
	t.Cleanup(server.Close)
	provider, err := llm.New(llm.Config{
		Provider: llm.ProviderOpenAICompatible, Model: llmtest.Model, BaseURL: server.URL + "/v1",
		HTTPClient: llm.SafeHTTPClient(true),
	})
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	return provider
}

func ask(text string) llm.Message {
	return llm.Message{Role: llm.RoleUser, Text: "[Context: the open build is \"Lab\", build_id " + buildID + ", revision 3, 2 nodes.]\n\n" + text}
}

// The stand-in has to hold up against the real adapter: what it streams is
// what the assistant sees in a browser session driven by it.
func TestScriptedProvider_WalksThroughAProposal(t *testing.T) {
	provider := scripted(t)
	models, err := provider.ListModels(context.Background())
	if err != nil || len(models) != 1 || models[0] != llmtest.Model {
		t.Fatalf("models: %v %v", models, err)
	}

	conversation := []llm.Message{ask("Please add a NAS for backups")}
	var announced []string
	step := func() *llm.TurnResult {
		t.Helper()
		result, err := provider.Stream(context.Background(), llm.TurnRequest{System: "s", Messages: conversation}, llm.StreamHandlers{
			ToolStart: func(_ int, name string) { announced = append(announced, name) },
		})
		if err != nil {
			t.Fatalf("stream: %v", err)
		}
		conversation = append(conversation, llm.Message{Role: llm.RoleAssistant, Text: result.Text, ToolCalls: result.ToolCalls})
		return result
	}
	answer := func(call llm.ToolCall, content string) {
		conversation = append(conversation, llm.Message{Role: llm.RoleTool, ToolResults: []llm.ToolResult{{CallID: call.ID, Name: call.Name, Content: content}}})
	}

	first := step()
	if len(first.ToolCalls) != 1 || first.ToolCalls[0].Name != "get_build" || !strings.Contains(string(first.ToolCalls[0].Input), buildID) {
		t.Fatalf("first it reads the build named in the context: %+v", first)
	}
	answer(first.ToolCalls[0], `{"nodes":[{"id":"r-1","type":"router"},{"id":"s-1","type":"switch"}]}`)

	second := step()
	if len(second.ToolCalls) != 1 || second.ToolCalls[0].Name != "propose_changes" {
		t.Fatalf("then it proposes: %+v", second)
	}
	var proposal struct {
		BuildID    string           `json:"build_id"`
		Operations []map[string]any `json:"operations"`
	}
	if err := json.Unmarshal(second.ToolCalls[0].Input, &proposal); err != nil {
		t.Fatalf("the arguments, sent in pieces, must add up to JSON: %v", err)
	}
	if proposal.BuildID != buildID || len(proposal.Operations) != 3 || proposal.Operations[1]["source"] != "s-1" {
		t.Fatalf("the NAS goes on the switch of this build: %+v", proposal)
	}
	answer(second.ToolCalls[0], `{"status":"pending"}`)

	last := step()
	if len(last.ToolCalls) != 0 || last.StopReason != llm.StopEnd || !strings.Contains(last.Text, "Backup NAS") {
		t.Fatalf("finally it says what it did: %+v", last)
	}
	if strings.Join(announced, ",") != "get_build,propose_changes" {
		t.Fatalf("calls announced while streaming: %v", announced)
	}
}

func TestScriptedProvider_OtherRequests(t *testing.T) {
	provider := scripted(t)
	run := func(messages ...llm.Message) (*llm.TurnResult, error) {
		return provider.Stream(context.Background(), llm.TurnRequest{System: "s", Messages: messages}, llm.StreamHandlers{})
	}

	if result, err := run(ask("hello")); err != nil || len(result.ToolCalls) != 0 || !strings.Contains(result.Text, "stand-in") {
		t.Fatalf("small talk: %+v %v", result, err)
	}
	if result, err := run(ask("validate my network")); err != nil || len(result.ToolCalls) != 1 || result.ToolCalls[0].Name != "validate_build" {
		t.Fatalf("validate: %+v %v", result, err)
	}
	result, err := run(ask("search for 2.5G switch"))
	if err != nil || len(result.ToolCalls) != 1 || !strings.Contains(string(result.ToolCalls[0].Input), `"query":"2.5g switch"`) {
		t.Fatalf("search: %+v %v", result, err)
	}
	if _, err := run(ask("please fail now")); err == nil {
		t.Fatal("a failure was asked for")
	}
}
