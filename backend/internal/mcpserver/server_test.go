package mcpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/assistant"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/Butterski/homelab-builder/backend/internal/testutil"
	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/gorm"
)

// ─── Fixtures ────────────────────────────────────────────────────────────────

type env struct {
	tx       *gorm.DB
	server   *httptest.Server
	tokens   *services.APITokenService
	builds   *services.BuildService
	ip       *services.IPService
	owner    models.User
	build    *models.Build
	routerID string
}

type bearerTransport struct {
	token   string
	headers map[string]string
}

func (b bearerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	if b.token != "" {
		clone.Header.Set("Authorization", "Bearer "+b.token)
	}
	for key, value := range b.headers {
		clone.Header.Set(key, value)
	}
	return http.DefaultTransport.RoundTrip(clone)
}

func newEnv(t *testing.T, allowedOrigins ...string) *env {
	t.Helper()
	tx := testutil.Tx(t)
	t.Setenv("IPAM_URL", testutil.IPAMStub(t))

	e := &env{tx: tx, tokens: services.NewAPITokenService(tx), builds: services.NewBuildService(tx), routerID: uuid.NewString()}
	e.ip = services.NewIPService(tx)
	proposals := services.NewProposalService(tx, e.builds, e.ip)
	registry := assistant.NewRegistry(assistant.Deps{
		DB: tx, Builds: e.builds, IP: e.ip, Proposals: proposals,
		Hardware: services.NewHardwareService(tx), Services: services.NewServiceService(tx),
		Recommendations: services.NewRecommendationService(tx), Config: services.NewConfigService(tx),
		Gaming: services.NewGamingService(e.builds),
	})
	handler := NewHandler(Deps{Registry: registry, Tokens: e.tokens, PublicAppURL: "https://lab.example", AllowedOrigins: allowedOrigins})

	// Every request shares the test's single transaction, so serve them one at a time.
	var mu sync.Mutex
	e.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		handler.ServeHTTP(w, r)
	}))
	t.Cleanup(e.server.Close)

	e.owner = testutil.User(t, tx)
	e.build = e.seedBuild(t, e.owner.ID, "Home Lab")
	return e
}

func (e *env) seedBuild(t *testing.T, userID uuid.UUID, name string) *models.Build {
	t.Helper()
	created, err := e.builds.Create(userID, services.SyncGraphInput{Name: name})
	if err != nil {
		t.Fatalf("create build: %v", err)
	}
	switchID := uuid.NewString()
	build, err := e.builds.UpdateAndCalculate(created.ID, userID, services.SyncGraphInput{
		Name: name, Revision: created.Revision, Settings: map[string]any{},
		Nodes: []services.NodeDTO{
			{ID: e.routerID, Type: "router", Name: "Router", X: 80, Y: 80, IP: "192.168.1.1", Details: map[string]any{"ports": 4}},
			{ID: switchID, Type: "switch", Name: "Switch", X: 80, Y: 340, Details: map[string]any{"ports": 8}},
		},
		Edges: []services.EdgeDTO{{Source: e.routerID, SourceHandle: "eth0", Target: switchID, TargetHandle: services.TargetHandle, Type: "ethernet"}},
	}, e.ip)
	if err != nil {
		t.Fatalf("seed topology: %v", err)
	}
	// Each build needs its own router id; refresh for the next seed.
	e.routerID = uuid.NewString()
	return build
}

func (e *env) token(t *testing.T, userID uuid.UUID, scope string, buildID *uuid.UUID) string {
	t.Helper()
	plaintext, _, err := e.tokens.Create(userID, services.CreateTokenInput{Name: "Claude Code", Scope: scope, BuildID: buildID})
	if err != nil {
		t.Fatalf("create token: %v", err)
	}
	return plaintext
}

func (e *env) connect(t *testing.T, token string) *mcp.ClientSession {
	t.Helper()
	client := mcp.NewClient(&mcp.Implementation{Name: "hlbuilder-test", Version: "1.0.0"}, nil)
	session, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{
		Endpoint:             e.server.URL,
		HTTPClient:           &http.Client{Transport: bearerTransport{token: token}},
		DisableStandaloneSSE: true,
	}, nil)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { session.Close() })
	return session
}

func toolNames(t *testing.T, session *mcp.ClientSession) map[string]*mcp.Tool {
	t.Helper()
	listed, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("list tools: %v", err)
	}
	names := map[string]*mcp.Tool{}
	for _, tool := range listed.Tools {
		names[tool.Name] = tool
	}
	return names
}

func call(t *testing.T, session *mcp.ClientSession, name string, args map[string]any) (map[string]any, *mcp.CallToolResult) {
	t.Helper()
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("call %s: %v", name, err)
	}
	if len(result.Content) == 0 {
		t.Fatalf("call %s returned no content", name)
	}
	text := result.Content[0].(*mcp.TextContent).Text
	decoded := map[string]any{}
	if !result.IsError {
		if err := json.Unmarshal([]byte(text), &decoded); err != nil {
			t.Fatalf("call %s: result is not JSON: %s", name, text)
		}
	} else {
		decoded["error"] = text
	}
	return decoded, result
}

// rawPost sends one stand-alone JSON-RPC request, the way a stateless client does.
func (e *env) rawPost(t *testing.T, token string, headers map[string]string) *http.Response {
	t.Helper()
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`
	req, err := http.NewRequest(http.MethodPost, e.server.URL, strings.NewReader(body))
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for key, value := range headers {
		if key == "Host" {
			req.Host = value
			continue
		}
		req.Header.Set(key, value)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

// ─── Authentication ──────────────────────────────────────────────────────────

func TestMCP_RequiresAValidToken(t *testing.T) {
	e := newEnv(t)

	missing := e.rawPost(t, "", nil)
	if missing.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no token: status %d", missing.StatusCode)
	}
	challenge := missing.Header.Get("WWW-Authenticate")
	if !strings.HasPrefix(challenge, "Bearer ") || strings.Contains(challenge, "resource_metadata") {
		t.Fatalf("unexpected challenge %q: tokens only, no OAuth discovery", challenge)
	}
	if status := e.rawPost(t, "hlb_"+strings.Repeat("A", 43), nil).StatusCode; status != http.StatusUnauthorized {
		t.Fatalf("unknown token: status %d", status)
	}

	plaintext, record, err := e.tokens.Create(e.owner.ID, services.CreateTokenInput{Name: "Temp", Scope: services.TokenScopeRead})
	if err != nil {
		t.Fatalf("create token: %v", err)
	}
	if status := e.rawPost(t, plaintext, nil).StatusCode; status != http.StatusOK {
		t.Fatalf("valid token: status %d", status)
	}
	if err := e.tokens.Revoke(e.owner.ID, record.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if status := e.rawPost(t, plaintext, nil).StatusCode; status != http.StatusUnauthorized {
		t.Fatalf("revoked token: status %d", status)
	}
}

func TestMCP_RepeatedBadTokensAreSlowedDown(t *testing.T) {
	e := newEnv(t)
	sawLimit := false
	for i := 0; i < authFailureBurst+3; i++ {
		status := e.rawPost(t, "hlb_"+strings.Repeat("B", 43), nil).StatusCode
		if status == http.StatusTooManyRequests {
			sawLimit = true
			break
		}
		if status != http.StatusUnauthorized {
			t.Fatalf("attempt %d: status %d", i, status)
		}
	}
	if !sawLimit {
		t.Fatal("repeated failures from one address must hit the limiter")
	}
	// A blocked address is refused even with a good token until the window passes.
	good := e.token(t, e.owner.ID, services.TokenScopeRead, nil)
	if status := e.rawPost(t, good, nil).StatusCode; status != http.StatusTooManyRequests {
		t.Fatalf("blocked address: status %d", status)
	}
}

func TestMCP_TokenRateLimit(t *testing.T) {
	e := newEnv(t)
	token := e.token(t, e.owner.ID, services.TokenScopeRead, nil)
	limited := 0
	for i := 0; i < requestBurst+10; i++ {
		switch status := e.rawPost(t, token, nil).StatusCode; status {
		case http.StatusOK:
		case http.StatusTooManyRequests:
			limited++
		default:
			t.Fatalf("request %d: status %d", i, status)
		}
	}
	if limited == 0 {
		t.Fatalf("expected the per-token limit after %d rapid requests", requestBurst)
	}
}

func TestMCP_BrowserCrossOriginRequestsAreRefused(t *testing.T) {
	e := newEnv(t, "https://trusted.example")
	token := e.token(t, e.owner.ID, services.TokenScopeRead, nil)

	evil := map[string]string{"Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site"}
	if status := e.rawPost(t, token, evil).StatusCode; status != http.StatusForbidden {
		t.Fatalf("cross-origin browser request: status %d", status)
	}
	trusted := map[string]string{"Origin": "https://trusted.example", "Sec-Fetch-Site": "cross-site"}
	if status := e.rawPost(t, token, trusted).StatusCode; status != http.StatusOK {
		t.Fatalf("allowed origin: status %d", status)
	}
	// A reverse proxy forwards the public Host over loopback; that must work.
	proxied := map[string]string{"Host": "hlbldr.com", "X-Forwarded-Host": "hlbldr.com", "X-Forwarded-Proto": "https"}
	if status := e.rawPost(t, token, proxied).StatusCode; status != http.StatusOK {
		t.Fatalf("proxied request: status %d", status)
	}
}

// ─── Scopes ──────────────────────────────────────────────────────────────────

func TestMCP_ReadTokenOnlySeesReadTools(t *testing.T) {
	e := newEnv(t)
	session := e.connect(t, e.token(t, e.owner.ID, services.TokenScopeRead, nil))

	tools := toolNames(t, session)
	for _, name := range []string{"list_builds", "get_build", "validate_build", "generate_configs", "gaming_report", "search_hardware", "list_services", "recommend_hardware", "get_proposal"} {
		tool, ok := tools[name]
		if !ok {
			t.Errorf("read token should see %s", name)
			continue
		}
		if tool.Annotations == nil || !tool.Annotations.ReadOnlyHint {
			t.Errorf("%s should be annotated read-only", name)
		}
	}
	for _, name := range []string{"propose_changes", "create_build"} {
		if _, ok := tools[name]; ok {
			t.Errorf("read token must not see %s", name)
		}
	}
	// Calling a hidden tool fails; it is not merely unlisted.
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "propose_changes", Arguments: map[string]any{
		"build_id": e.build.ID.String(), "summary": "x", "operations": []any{map[string]any{"op": "add_node", "type": "nas"}},
	}})
	if err == nil && (result == nil || !result.IsError) {
		t.Fatal("a read token must not be able to propose changes")
	}
	var proposals int64
	e.tx.Model(&models.BuildProposal{}).Where("build_id = ?", e.build.ID).Count(&proposals)
	if proposals != 0 {
		t.Fatal("no proposal may be stored for a read token")
	}

	if got := session.InitializeResult().Instructions; !strings.Contains(got, "propose_changes stages a change set") {
		t.Fatalf("server instructions missing the primer: %q", got)
	}
}

func TestMCP_ReadsAreScopedToTheTokenOwner(t *testing.T) {
	e := newEnv(t)
	stranger := testutil.User(t, e.tx)
	foreign := e.seedBuild(t, stranger.ID, "Someone else")
	session := e.connect(t, e.token(t, e.owner.ID, services.TokenScopeRead, nil))

	listed, _ := call(t, session, "list_builds", nil)
	builds := listed["builds"].([]any)
	if len(builds) != 1 || builds[0].(map[string]any)["id"] != e.build.ID.String() {
		t.Fatalf("list_builds must only return the owner's builds: %v", builds)
	}

	build, result := call(t, session, "get_build", map[string]any{"build_id": e.build.ID.String()})
	if result.StructuredContent == nil {
		t.Fatal("get_build should also return structured content")
	}
	nodes := build["nodes"].([]any)
	if len(nodes) != 2 || build["name"] != "Home Lab" || build["url"] != "https://lab.example/builder/"+e.build.ID.String() {
		t.Fatalf("unexpected build view: %v", build)
	}
	sw := nodes[1].(map[string]any)
	ports := sw["ports"].(map[string]any)
	if sw["name"] != "Switch" || ports["total"] != float64(8) || len(ports["free"].([]any)) != 8 || sw["ip"] == "" {
		t.Fatalf("switch should list its address and free ports: %v", sw)
	}
	if connections := build["connections"].([]any); len(connections) != 1 || connections[0].(map[string]any)["source_name"] != "Router" {
		t.Fatalf("unexpected connections: %v", build["connections"])
	}

	for _, name := range []string{"get_build", "validate_build", "generate_configs"} {
		refused, result := call(t, session, name, map[string]any{"build_id": foreign.ID.String()})
		if !result.IsError || !strings.Contains(refused["error"].(string), "build not found") {
			t.Fatalf("%s on a foreign build must look missing, got %v", name, refused)
		}
	}
	if refused, result := call(t, session, "get_build", map[string]any{"build_id": "not-a-uuid"}); !result.IsError {
		t.Fatalf("malformed id must be a tool error, got %v", refused)
	}
	if refused, result := call(t, session, "get_build", map[string]any{}); !result.IsError || !strings.Contains(refused["error"].(string), "invalid arguments") {
		t.Fatalf("missing argument must be a tool error, got %v", refused)
	}

	validation, _ := call(t, session, "validate_build", map[string]any{"build_id": e.build.ID.String()})
	if validation["valid"] != true {
		t.Fatalf("unexpected validation: %v", validation)
	}
}

func TestMCP_ProposeCreatesAPendingProposalAndLeavesTheBuildAlone(t *testing.T) {
	e := newEnv(t)
	session := e.connect(t, e.token(t, e.owner.ID, services.TokenScopePropose, nil))
	if _, ok := toolNames(t, session)["propose_changes"]; !ok {
		t.Fatal("a propose token should see propose_changes")
	}

	// An invalid operation comes back as a readable tool error.
	invalid, result := call(t, session, "propose_changes", map[string]any{
		"build_id": e.build.ID.String(), "summary": "Add a NAS",
		"operations": []any{map[string]any{"op": "connect", "source": "Switch", "target": "ghost"}},
	})
	if !result.IsError || !strings.Contains(invalid["error"].(string), "operations[0] (connect)") {
		t.Fatalf("expected an operation error, got %v", invalid)
	}

	proposed, _ := call(t, session, "propose_changes", map[string]any{
		"build_id": e.build.ID.String(), "summary": "Add a NAS for backups",
		"operations": []any{
			map[string]any{"op": "add_node", "ref": "nas", "type": "nas", "name": "Backup NAS", "details": map[string]any{"storage": 8000}},
			map[string]any{"op": "connect", "source": "Switch", "target": "nas"},
		},
	})
	proposalID, _ := proposed["proposal_id"].(string)
	if proposed["status"] != "pending" || proposalID == "" {
		t.Fatalf("unexpected result: %v", proposed)
	}
	if want := "https://lab.example/builder/" + e.build.ID.String() + "?proposal=" + proposalID; proposed["review_url"] != want {
		t.Fatalf("review_url = %v, want %s", proposed["review_url"], want)
	}
	added := proposed["changes"].(map[string]any)["nodes"].(map[string]any)["added"].([]any)[0].(map[string]any)
	if added["name"] != "Backup NAS" || added["ip"] == "" {
		t.Fatalf("the result should show the new node with its predicted address: %v", added)
	}
	if proposed["validation"].(map[string]any)["valid"] != true {
		t.Fatalf("unexpected validation: %v", proposed["validation"])
	}

	var stored models.BuildProposal
	if err := e.tx.First(&stored, "id = ?", proposalID).Error; err != nil {
		t.Fatalf("load proposal: %v", err)
	}
	if stored.Status != services.ProposalPending || stored.Source != services.ProposalSourceMCP || stored.SourceLabel != "Claude Code" || stored.TokenID == nil || stored.UserID != e.owner.ID {
		t.Fatalf("unexpected stored proposal: %+v", stored)
	}
	current, _ := e.builds.GetByID(e.build.ID)
	if current.Revision != e.build.Revision || len(current.Nodes) != 2 {
		t.Fatalf("the build must be untouched: revision %d, %d nodes", current.Revision, len(current.Nodes))
	}

	status, _ := call(t, session, "get_proposal", map[string]any{"proposal_id": proposalID})
	if status["status"] != "pending" || status["build_id"] != e.build.ID.String() {
		t.Fatalf("unexpected get_proposal: %v", status)
	}
	if view, _ := call(t, session, "get_build", map[string]any{"build_id": e.build.ID.String()}); view["proposals"].(map[string]any)["pending"] == nil {
		t.Fatal("get_build should report the pending proposal")
	}

	var audited int64
	e.tx.Model(&models.Event{}).Where("user_id = ? AND event_type = ?", e.owner.ID, "mcp.tool_call").Count(&audited)
	if audited != 2 {
		t.Fatalf("both propose_changes calls should be audited, got %d events", audited)
	}

	// Another account cannot see or propose on this build.
	stranger := testutil.User(t, e.tx)
	other := e.connect(t, e.token(t, stranger.ID, services.TokenScopePropose, nil))
	if refused, result := call(t, other, "get_proposal", map[string]any{"proposal_id": proposalID}); !result.IsError {
		t.Fatalf("a stranger must not read the proposal: %v", refused)
	}
	if refused, result := call(t, other, "propose_changes", map[string]any{
		"build_id": e.build.ID.String(), "summary": "x", "operations": []any{map[string]any{"op": "add_node", "type": "nas"}},
	}); !result.IsError || !strings.Contains(refused["error"].(string), "build not found") {
		t.Fatalf("a stranger must not propose: %v", refused)
	}
}

func TestMCP_CreateBuild(t *testing.T) {
	e := newEnv(t)
	session := e.connect(t, e.token(t, e.owner.ID, services.TokenScopePropose, nil))
	created, _ := call(t, session, "create_build", map[string]any{"name": "Rack Lab"})
	id, _ := created["id"].(string)
	build, err := e.builds.GetOwned(uuid.MustParse(id), e.owner.ID)
	if err != nil || build.Name != "Rack Lab" || len(build.Nodes) != 0 {
		t.Fatalf("unexpected created build: %+v, %v", build, err)
	}
}

func TestMCP_BuildRestrictedTokenIsConfined(t *testing.T) {
	e := newEnv(t)
	second := e.seedBuild(t, e.owner.ID, "Second Lab")
	session := e.connect(t, e.token(t, e.owner.ID, services.TokenScopePropose, &e.build.ID))

	if _, ok := toolNames(t, session)["create_build"]; ok {
		t.Fatal("a build-restricted token must not create builds")
	}
	listed, _ := call(t, session, "list_builds", nil)
	if builds := listed["builds"].([]any); len(builds) != 1 || builds[0].(map[string]any)["id"] != e.build.ID.String() {
		t.Fatalf("restricted token should list only its build: %v", builds)
	}
	if refused, result := call(t, session, "get_build", map[string]any{"build_id": second.ID.String()}); !result.IsError {
		t.Fatalf("restricted token read another build: %v", refused)
	}
	if refused, result := call(t, session, "propose_changes", map[string]any{
		"build_id": second.ID.String(), "summary": "x", "operations": []any{map[string]any{"op": "add_node", "type": "nas"}},
	}); !result.IsError {
		t.Fatalf("restricted token proposed on another build: %v", refused)
	}
	if _, result := call(t, session, "get_build", map[string]any{"build_id": e.build.ID.String()}); result.IsError {
		t.Fatal("restricted token must still reach its own build")
	}
}

func TestMCP_CatalogTools(t *testing.T) {
	e := newEnv(t)
	approved := true
	hardware := models.HardwareComponent{Category: "nas", Brand: "Synology", Model: "DS923+", PriceEst: 550, Approved: &approved, Spec: json.RawMessage(`{"cpu":"4-core Ryzen","ram":"4GB"}`)}
	hidden := false
	pending := models.HardwareComponent{Category: "nas", Brand: "Synology", Model: "Unreleased", Approved: &hidden, Spec: json.RawMessage(`{}`)}
	service := models.Service{Name: "Jellyfin Test", Category: "media", Description: "Media server", IsActive: true, Visibility: "public", Tags: "[]"}
	for _, row := range []any{&hardware, &pending, &service} {
		if err := e.tx.Create(row).Error; err != nil {
			t.Fatalf("seed catalog: %v", err)
		}
	}
	if err := e.tx.Create(&models.ServiceRequirement{ServiceID: service.ID, MinRAMMB: 1024, RecommendedRAMMB: 2048, MinCPUCores: 1, RecommendedCPUCores: 2}).Error; err != nil {
		t.Fatalf("seed requirements: %v", err)
	}
	session := e.connect(t, e.token(t, e.owner.ID, services.TokenScopePropose, nil))

	found, _ := call(t, session, "search_hardware", map[string]any{"query": "synology", "category": "nas"})
	items := found["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["model"] != "DS923+" || items[0].(map[string]any)["add_with"] != "add_node" {
		t.Fatalf("search must return approved catalog items only: %v", items)
	}

	listed, _ := call(t, session, "list_services", map[string]any{"query": "jellyfin test"})
	services_ := listed["items"].([]any)
	if len(services_) != 1 || services_[0].(map[string]any)["recommended_ram_mb"] != float64(2048) {
		t.Fatalf("unexpected services: %v", services_)
	}

	// Catalog ids flow straight into a proposal.
	proposed, result := call(t, session, "propose_changes", map[string]any{
		"build_id": e.build.ID.String(), "summary": "Add a Synology running Jellyfin",
		"operations": []any{
			map[string]any{"op": "add_node", "ref": "nas", "hardware_id": hardware.ID.String()},
			map[string]any{"op": "connect", "source": "Switch", "target": "nas"},
			map[string]any{"op": "add_vm", "host": "nas", "catalog_service_id": service.ID.String()},
		},
	})
	if result.IsError {
		t.Fatalf("catalog proposal failed: %v", proposed)
	}
	changes := proposed["changes"].(map[string]any)
	if name := changes["nodes"].(map[string]any)["added"].([]any)[0].(map[string]any)["name"]; name != "Synology DS923+" {
		t.Fatalf("catalog node name = %v", name)
	}
	if name := changes["vms"].(map[string]any)["added"].([]any)[0].(map[string]any)["name"]; name != "Jellyfin Test" {
		t.Fatalf("catalog service name = %v", name)
	}

	if refused, result := call(t, session, "propose_changes", map[string]any{
		"build_id": e.build.ID.String(), "summary": "x",
		"operations": []any{map[string]any{"op": "add_node", "hardware_id": pending.ID.String()}},
	}); !result.IsError {
		t.Fatalf("unapproved hardware must not be usable: %v", refused)
	}
}
