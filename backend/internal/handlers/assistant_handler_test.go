package handlers

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/assistant"
	"github.com/Butterski/homelab-builder/backend/internal/llm"
	"github.com/Butterski/homelab-builder/backend/internal/middleware"
	"github.com/Butterski/homelab-builder/backend/internal/secrets"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/Butterski/homelab-builder/backend/internal/testutil"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const handlerTestKey = "sk-ant-handler-test-key-4e1b"

// replyProvider answers every model call with one sentence.
type replyProvider struct{ calls int }

func (p *replyProvider) ID() string { return "anthropic/claude-opus-5" }
func (p *replyProvider) ListModels(context.Context) ([]string, error) {
	return []string{"claude-opus-5"}, nil
}
func (p *replyProvider) Stream(_ context.Context, _ llm.TurnRequest, onText func(string)) (*llm.TurnResult, error) {
	p.calls++
	onText("Your lab has ")
	onText("two devices.")
	return &llm.TurnResult{Text: "Your lab has two devices.", StopReason: llm.StopEnd}, nil
}

type assistantAPI struct {
	tx       *gorm.DB
	router   *gin.Engine
	provider *replyProvider
	userID   uuid.UUID
	buildID  uuid.UUID
	tokens   *services.APITokenService
}

// newAssistantAPI serves the assistant and token routes the way the server
// does, with the session replaced by a fixed user.
func newAssistantAPI(t *testing.T) *assistantAPI {
	t.Helper()
	gin.SetMode(gin.TestMode)
	tx := testutil.Tx(t)
	t.Setenv("IPAM_URL", testutil.IPAMStub(t))

	encoded, _ := secrets.GenerateKey()
	key, _ := secrets.ParseKey(encoded)
	keyring, _ := secrets.NewKeyring(1, key, secrets.SourceEnv)

	builds := services.NewBuildService(tx)
	ip := services.NewIPService(tx)
	proposals := services.NewProposalService(tx, builds, ip)
	settings := services.NewAssistantSettingsService(tx, keyring, true, false)
	registry := assistant.NewRegistry(assistant.Deps{
		DB: tx, Builds: builds, IP: ip, Proposals: proposals,
		Hardware: services.NewHardwareService(tx), Services: services.NewServiceService(tx),
		Recommendations: services.NewRecommendationService(tx), Config: services.NewConfigService(tx),
	})
	api := &assistantAPI{tx: tx, provider: &replyProvider{}, tokens: services.NewAPITokenService(tx)}
	agent := assistant.NewAgent(assistant.AgentDeps{
		Registry: registry, Settings: settings, Threads: services.NewAssistantThreadService(tx),
		Proposals: proposals, Builds: builds,
		NewProvider: func(llm.Config) (llm.Provider, error) { return api.provider, nil },
	})

	api.userID = testutil.User(t, tx).ID
	build, err := builds.Create(api.userID, services.SyncGraphInput{Name: "Lab"})
	if err != nil {
		t.Fatalf("create build: %v", err)
	}
	api.buildID = build.ID

	handler := NewAssistantHandler(settings, agent)
	tokenHandler := NewAPITokenHandler(api.tokens)
	api.router = gin.New()
	session := api.router.Group("/api", func(c *gin.Context) {
		// The caller is taken from a header so tests can act as different users.
		id := api.userID
		if other := c.GetHeader("X-Test-User"); other != "" {
			id = uuid.MustParse(other)
		}
		c.Set("user_id", id)
	})
	session.GET("/assistant/settings", handler.GetSettings)
	session.PUT("/assistant/settings", handler.UpdateSettings)
	session.DELETE("/assistant/settings", handler.ResetSettings)
	session.DELETE("/assistant/settings/key", handler.DeleteKey)
	session.POST("/assistant/settings/test", handler.TestSettings)
	session.GET("/assistant/threads/:buildId", handler.GetThread)
	session.DELETE("/assistant/threads/:buildId", handler.ClearThread)
	session.POST("/assistant/chat", handler.Chat)

	// The real session middleware in front of the token routes.
	real := api.router.Group("/real", middleware.AuthMiddleware(services.NewAuthService(tx), false))
	real.GET("/tokens", tokenHandler.List)
	real.POST("/tokens", tokenHandler.Create)
	return api
}

func (a *assistantAPI) do(method, path, body string, headers ...string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	for i := 0; i+1 < len(headers); i += 2 {
		request.Header.Set(headers[i], headers[i+1])
	}
	recorder := httptest.NewRecorder()
	a.router.ServeHTTP(recorder, request)
	return recorder
}

func decode(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	body := map[string]any{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON (%d): %s", recorder.Code, recorder.Body.String())
	}
	return body
}

func (a *assistantAPI) configure(t *testing.T) {
	t.Helper()
	response := a.do(http.MethodPut, "/api/assistant/settings", `{"enabled":true,"provider":"anthropic","api_key":"`+handlerTestKey+`"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("configure: %d %s", response.Code, response.Body.String())
	}
}

type sseFrame struct {
	Event string
	Data  map[string]any
}

func parseSSE(t *testing.T, body string) []sseFrame {
	t.Helper()
	frames := []sseFrame{}
	current := sseFrame{}
	scanner := bufio.NewScanner(strings.NewReader(body))
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			current.Event = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &current.Data); err != nil {
				t.Fatalf("event data is not JSON: %q", line)
			}
		case line == "" && current.Event != "":
			frames = append(frames, current)
			current = sseFrame{}
		case strings.HasPrefix(line, ":"):
			// keep-alive comment
		case line != "":
			t.Fatalf("unexpected line in the event stream: %q", line)
		}
	}
	return frames
}

func TestAssistantAPI_SettingsNeverReturnTheKey(t *testing.T) {
	api := newAssistantAPI(t)

	initial := decode(t, api.do(http.MethodGet, "/api/assistant/settings", ""))
	if initial["available"] != true || initial["enabled"] != false || initial["has_key"] != false {
		t.Fatalf("initial settings: %v", initial)
	}

	saved := api.do(http.MethodPut, "/api/assistant/settings", `{"enabled":true,"provider":"anthropic","api_key":"`+handlerTestKey+`"}`)
	if saved.Code != http.StatusOK {
		t.Fatalf("save: %d %s", saved.Code, saved.Body.String())
	}
	for name, response := range map[string]*httptest.ResponseRecorder{
		"PUT":  saved,
		"GET":  api.do(http.MethodGet, "/api/assistant/settings", ""),
		"test": api.do(http.MethodPost, "/api/assistant/settings/test", ""),
	} {
		if text := response.Body.String(); strings.Contains(text, handlerTestKey) || strings.Contains(text, "handler-test-key") {
			t.Fatalf("%s response contains the key: %s", name, text)
		}
	}
	view := decode(t, api.do(http.MethodGet, "/api/assistant/settings", ""))
	storage, _ := view["key_storage"].(map[string]any)
	if view["has_key"] != true || view["key_hint"] != "4e1b" || view["ready"] != true || storage == nil || storage["algorithm"] != "AES-256-GCM" {
		t.Fatalf("settings after saving: %v", view)
	}
	if _, present := view["api_key"]; present {
		t.Fatal("the settings view must not have an api_key field at all")
	}

	tested := decode(t, api.do(http.MethodPost, "/api/assistant/settings/test", ""))
	if tested["ok"] != true || len(tested["models"].([]any)) != 1 {
		t.Fatalf("test endpoint: %v", tested)
	}

	if bad := api.do(http.MethodPut, "/api/assistant/settings", `{"provider":"skynet"}`); bad.Code != http.StatusBadRequest {
		t.Fatalf("invalid provider: %d", bad.Code)
	}
	removed := decode(t, api.do(http.MethodDelete, "/api/assistant/settings/key", ""))
	if removed["has_key"] != false || removed["key_storage"] != nil || removed["ready"] != false {
		t.Fatalf("after deleting the key: %v", removed)
	}
	if reset := api.do(http.MethodDelete, "/api/assistant/settings", ""); reset.Code != http.StatusNoContent {
		t.Fatalf("reset: %d", reset.Code)
	}
}

func TestAssistantAPI_ChatStreamsServerSentEvents(t *testing.T) {
	api := newAssistantAPI(t)
	api.configure(t)

	response := api.do(http.MethodPost, "/api/assistant/chat", `{"build_id":"`+api.buildID.String()+`","message":"What is in my lab?"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("chat: %d %s", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("content type %q", got)
	}
	// Proxies must pass the stream through as it is written.
	if response.Header().Get("X-Accel-Buffering") != "no" || !strings.Contains(response.Header().Get("Cache-Control"), "no-cache") {
		t.Fatalf("stream headers: %v", response.Header())
	}

	frames := parseSSE(t, response.Body.String())
	events := []string{}
	text := ""
	for _, frame := range frames {
		events = append(events, frame.Event)
		if frame.Event == "text_delta" {
			text += frame.Data["text"].(string)
		}
	}
	if strings.Join(events, " ") != "turn_start text_delta text_delta done" || text != "Your lab has two devices." {
		t.Fatalf("events %v, text %q", events, text)
	}
	if start := frames[0].Data; start["provider"] != "anthropic" || start["model"] != "claude-opus-5" || start["thread_id"] == "" {
		t.Fatalf("turn_start: %v", start)
	}
	if strings.Contains(response.Body.String(), handlerTestKey) {
		t.Fatal("the stream contains the key")
	}

	// The turn is stored and can be loaded again, then cleared.
	thread := decode(t, api.do(http.MethodGet, "/api/assistant/threads/"+api.buildID.String(), ""))
	messages := thread["messages"].([]any)
	if len(messages) != 2 || messages[0].(map[string]any)["role"] != "user" || messages[1].(map[string]any)["role"] != "assistant" {
		t.Fatalf("stored thread: %v", thread)
	}
	if cleared := api.do(http.MethodDelete, "/api/assistant/threads/"+api.buildID.String(), ""); cleared.Code != http.StatusNoContent {
		t.Fatalf("clear: %d", cleared.Code)
	}
	if after := decode(t, api.do(http.MethodGet, "/api/assistant/threads/"+api.buildID.String(), "")); len(after["messages"].([]any)) != 0 {
		t.Fatalf("thread after clearing: %v", after)
	}
}

func TestAssistantAPI_RefusalsArePlainJSONBeforeAnyStream(t *testing.T) {
	api := newAssistantAPI(t)
	chat := func(body string, headers ...string) *httptest.ResponseRecorder {
		return api.do(http.MethodPost, "/api/assistant/chat", body, headers...)
	}
	valid := `{"build_id":"` + api.buildID.String() + `","message":"hi"}`

	// Not switched on yet.
	if response := chat(valid); response.Code != http.StatusConflict || decode(t, response)["code"] != "assistant_disabled" {
		t.Fatalf("disabled: %d %s", response.Code, response.Body.String())
	}
	api.configure(t)

	cases := []struct {
		name   string
		body   string
		status int
		code   string
	}{
		{"malformed body", `{`, http.StatusBadRequest, ""},
		{"bad build id", `{"build_id":"nope","message":"hi"}`, http.StatusBadRequest, ""},
		{"empty message", `{"build_id":"` + api.buildID.String() + `","message":"  "}`, http.StatusBadRequest, "invalid"},
		{"unknown build", `{"build_id":"` + uuid.NewString() + `","message":"hi"}`, http.StatusNotFound, ""},
	}
	for _, tc := range cases {
		response := chat(tc.body)
		if response.Code != tc.status || response.Header().Get("Content-Type") == "text/event-stream" {
			t.Errorf("%s: status %d, content type %q", tc.name, response.Code, response.Header().Get("Content-Type"))
			continue
		}
		if tc.code != "" && decode(t, response)["code"] != tc.code {
			t.Errorf("%s: body %s", tc.name, response.Body.String())
		}
	}
	if api.provider.calls != 0 {
		t.Fatal("a refused request must not reach the model")
	}

	// Another account cannot chat about, read or clear this build's conversation.
	stranger := testutil.User(t, api.tx).ID.String()
	api.do(http.MethodPut, "/api/assistant/settings", `{"enabled":true,"provider":"anthropic","api_key":"sk-ant-stranger-key-0000"}`, "X-Test-User", stranger)
	if response := chat(valid, "X-Test-User", stranger); response.Code != http.StatusNotFound {
		t.Fatalf("foreign build chat: %d", response.Code)
	}
	for _, method := range []string{http.MethodGet, http.MethodDelete} {
		if response := api.do(method, "/api/assistant/threads/"+api.buildID.String(), "", "X-Test-User", stranger); response.Code != http.StatusNotFound {
			t.Fatalf("foreign thread %s: %d", method, response.Code)
		}
	}
	// Settings are per account: the stranger's view never shows the owner's key hint.
	if view := decode(t, api.do(http.MethodGet, "/api/assistant/settings", "", "X-Test-User", stranger)); view["key_hint"] != "0000" {
		t.Fatalf("stranger settings: %v", view)
	}
}

func TestAPITokenRoutes_RejectAccessTokens(t *testing.T) {
	api := newAssistantAPI(t)
	plaintext, _, err := api.tokens.Create(api.userID, services.CreateTokenInput{Name: "MCP", Scope: services.TokenScopePropose})
	if err != nil {
		t.Fatalf("create token: %v", err)
	}
	// A personal access token is for /mcp only. It is not a session, so it can
	// neither list nor create tokens.
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		response := api.do(method, "/real/tokens", `{"name":"escalate","scope":"propose"}`, "Authorization", "Bearer "+plaintext)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("%s /tokens with an access token: %d %s", method, response.Code, response.Body.String())
		}
	}
	if tokens, _ := api.tokens.List(api.userID); len(tokens) != 1 {
		t.Fatalf("an access token created another token: %d tokens", len(tokens))
	}
}
