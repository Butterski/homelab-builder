// Package llmtest is a stand-in for a model provider: an HTTP handler that
// speaks the OpenAI chat completions API and answers from a small script. With
// it the assistant can be exercised end to end, in tests and in a browser,
// without a key and without a model. cmd/fakellm serves it.
//
// The script reads the last thing the user wrote:
//
//	"... nas ..."       reads the build, then proposes a NAS on its first switch
//	"... validate ..."  validates the build and reports
//	"... search X"      searches the hardware catalog for X
//	"... slow ..."      a long reply, to try Stop on
//	"... fail ..."      an error from the provider
//	anything else       a short reply
package llmtest

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// Model is the only model the stand-in offers.
const Model = "scripted-1"

// Options tune the stand-in.
type Options struct {
	// Delay is the pause between two pieces of a streamed reply. Zero streams
	// at once, which suits tests; a browser wants something to watch.
	Delay time.Duration
}

type message struct {
	Role       string     `json:"role"`
	Content    any        `json:"content"`
	ToolCalls  []toolCall `json:"tool_calls"`
	ToolCallID string     `json:"tool_call_id"`
}

type toolCall struct {
	ID       string `json:"id"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type request struct {
	Messages []message `json:"messages"`
	Stream   bool      `json:"stream"`
}

// reply is one scripted answer: text, a tool call, or both.
type reply struct {
	text string
	tool string
	args any
	// status, when set, makes the request fail with this HTTP status.
	status int
}

// NewHandler returns the stand-in provider.
func NewHandler(opts Options) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/models", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"object": "list", "data": []any{map[string]any{"id": Model, "object": "model", "owned_by": "hlbuilder"}},
		})
	})
	mux.HandleFunc("POST /v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		var req request
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": map[string]any{"message": "invalid request body"}})
			return
		}
		answer := script(req.Messages)
		if answer.status != 0 {
			writeJSON(w, answer.status, map[string]any{"error": map[string]any{"message": "the scripted provider was asked to fail"}})
			return
		}
		stream(w, r, answer, opts.Delay)
	})
	return mux
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func textOf(content any) string {
	switch typed := content.(type) {
	case string:
		return typed
	case []any:
		var text strings.Builder
		for _, part := range typed {
			if block, ok := part.(map[string]any); ok {
				if value, ok := block["text"].(string); ok {
					text.WriteString(value)
				}
			}
		}
		return text.String()
	}
	return ""
}

var buildIDPattern = regexp.MustCompile(`build_id ([0-9a-fA-F-]{36})`)

// script decides the next reply from the conversation so far.
func script(messages []message) reply {
	lastUser := -1
	for i, m := range messages {
		if m.Role == "user" {
			lastUser = i
		}
	}
	if lastUser < 0 {
		return reply{text: "Ask me about the build that is open."}
	}
	asked := textOf(messages[lastUser].Content)
	buildID := ""
	if match := buildIDPattern.FindStringSubmatch(asked); match != nil {
		buildID = match[1]
	}
	// The build context comes first, in brackets; the user's words follow it.
	words := asked
	if end := strings.LastIndex(asked, "]"); end >= 0 {
		words = asked[end+1:]
	}
	words = strings.ToLower(strings.TrimSpace(words))

	// What this turn has done already.
	results := map[string]string{}
	called := map[string]string{}
	for _, m := range messages[lastUser+1:] {
		for _, call := range m.ToolCalls {
			called[call.ID] = call.Function.Name
		}
		if m.Role == "tool" {
			results[called[m.ToolCallID]] = textOf(m.Content)
		}
	}

	switch {
	case strings.Contains(words, "fail"):
		return reply{status: http.StatusInternalServerError}
	case strings.Contains(words, "slow"):
		return reply{text: strings.Repeat("This is a long answer, written one word at a time so there is something to stop. ", 12)}
	case strings.Contains(words, "nas"):
		if _, done := results["propose_changes"]; done {
			return reply{text: "I proposed a **Backup NAS** on your switch, with a backup service on it. Nothing is saved yet: have a look at the canvas and apply it if it fits."}
		}
		if build, read := results["get_build"]; read {
			return reply{
				text: "The switch has a free port. ",
				tool: "propose_changes",
				args: map[string]any{
					"build_id": buildID,
					"summary":  "Add a NAS for backups on the switch",
					"operations": []any{
						map[string]any{"op": "add_node", "ref": "nas", "type": "nas", "name": "Backup NAS", "details": map[string]any{"storage": 8000, "model": "4-bay NAS"}},
						map[string]any{"op": "connect", "source": uplinkFor(build), "target": "nas"},
						map[string]any{"op": "add_vm", "host": "nas", "name": "Backups", "type": "container", "ram_mb": 1024},
					},
				},
			}
		}
		return reply{text: "Let me look at the build first. ", tool: "get_build", args: map[string]any{"build_id": buildID}}
	case strings.Contains(words, "validate") || strings.Contains(words, "check"):
		if report, done := results["validate_build"]; done {
			var parsed struct {
				Errors   []any `json:"errors"`
				Warnings []any `json:"warnings"`
			}
			_ = json.Unmarshal([]byte(report), &parsed)
			if len(parsed.Errors)+len(parsed.Warnings) == 0 {
				return reply{text: "The network checks out: no errors and no warnings."}
			}
			return reply{text: fmt.Sprintf("I found %d errors and %d warnings. The devices concerned are marked on the canvas.", len(parsed.Errors), len(parsed.Warnings))}
		}
		return reply{tool: "validate_build", args: map[string]any{"build_id": buildID}}
	case strings.Contains(words, "search"):
		if _, done := results["search_hardware"]; done {
			return reply{text: "Those are the closest matches in the catalog. Tell me which one to add."}
		}
		query := strings.TrimSpace(strings.SplitN(words, "search", 2)[1])
		return reply{tool: "search_hardware", args: map[string]any{"query": strings.TrimPrefix(query, "for "), "limit": 5}}
	}
	return reply{text: "I am the scripted stand-in for a model. Ask me to add a NAS, to validate the network, or to search the catalog."}
}

// uplinkFor picks the device a new NAS is plugged into: the first switch of
// the build, or failing that its first router.
func uplinkFor(build string) string {
	var view struct {
		Nodes []struct {
			ID   string `json:"id"`
			Type string `json:"type"`
		} `json:"nodes"`
	}
	_ = json.Unmarshal([]byte(build), &view)
	for _, wanted := range []string{"switch", "router"} {
		for _, node := range view.Nodes {
			if node.Type == wanted {
				return node.ID
			}
		}
	}
	return ""
}

func stream(w http.ResponseWriter, r *http.Request, answer reply, delay time.Duration) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)

	send := func(delta map[string]any, finish any) bool {
		raw, _ := json.Marshal(map[string]any{
			"id": "chatcmpl-scripted", "object": "chat.completion.chunk", "created": time.Now().Unix(), "model": Model,
			"choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}},
		})
		if _, err := fmt.Fprintf(w, "data: %s\n\n", raw); err != nil {
			return false
		}
		if flusher != nil {
			flusher.Flush()
		}
		if delay > 0 {
			select {
			case <-r.Context().Done():
				return false
			case <-time.After(delay):
			}
		}
		return r.Context().Err() == nil
	}

	if !send(map[string]any{"role": "assistant", "content": ""}, nil) {
		return
	}
	for _, word := range strings.SplitAfter(answer.text, " ") {
		if word != "" && !send(map[string]any{"content": word}, nil) {
			return
		}
	}
	finish := "stop"
	if answer.tool != "" {
		finish = "tool_calls"
		arguments, _ := json.Marshal(answer.args)
		// The name first, then the arguments a few bytes at a time, the way a
		// model writes a long call.
		first := map[string]any{"index": 0, "id": "call_" + answer.tool, "type": "function", "function": map[string]any{"name": answer.tool, "arguments": ""}}
		if !send(map[string]any{"tool_calls": []any{first}}, nil) {
			return
		}
		const piece = 24
		for start := 0; start < len(arguments); start += piece {
			end := min(start+piece, len(arguments))
			part := map[string]any{"index": 0, "function": map[string]any{"arguments": string(arguments[start:end])}}
			if !send(map[string]any{"tool_calls": []any{part}}, nil) {
				return
			}
		}
	}
	if !send(map[string]any{}, finish) {
		return
	}
	_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	if flusher != nil {
		flusher.Flush()
	}
}
