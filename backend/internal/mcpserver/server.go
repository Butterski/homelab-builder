// Package mcpserver exposes HLBuilder to LLM clients over the Model Context
// Protocol (streamable HTTP). Every request must carry a personal access token;
// the tools a client sees and may call follow from that token's scope.
package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/assistant"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	maxRequestBodyBytes = 1 << 20

	// Per token: sustained requests per minute and the burst a client may spend at once.
	requestsPerMinute = 120
	requestBurst      = 30
	// Proposals run a dry run against the IP manager, so they get a tighter budget.
	proposalsPerMinute = 20
	proposalBurst      = 10
	// Per client address: failed authentications before the address is slowed down.
	authFailuresPerMinute = 20
	authFailureBurst      = 20
)

// Deps are the collaborators of the MCP endpoint.
type Deps struct {
	Registry *assistant.Registry
	Tokens   *services.APITokenService
	// PublicAppURL is the browser-facing origin for review links. When empty it
	// is derived from the request's forwarded host.
	PublicAppURL string
	// AllowedOrigins lists browser origins that may call the endpoint
	// cross-origin. Native clients send no Origin and are unaffected.
	AllowedOrigins []string
	Version        string
}

type server struct {
	deps      Deps
	requests  *keyedLimiter
	proposals *keyedLimiter
	failures  *keyedLimiter
}

type contextKey string

const (
	actorContextKey    contextKey = "mcp-actor"
	clientIPContextKey contextKey = "mcp-client-ip"
)

// WithClientIP records the caller's address as resolved by the outer router,
// which knows which proxies to trust.
func WithClientIP(ctx context.Context, ip string) context.Context {
	return context.WithValue(ctx, clientIPContextKey, ip)
}

func clientIP(r *http.Request) string {
	if ip, ok := r.Context().Value(clientIPContextKey).(string); ok && ip != "" {
		return ip
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// NewHandler builds the /mcp endpoint.
func NewHandler(deps Deps) http.Handler {
	if deps.Version == "" {
		deps.Version = "1.0.0"
	}
	s := &server{
		deps:      deps,
		requests:  newKeyedLimiter(requestsPerMinute, requestBurst),
		proposals: newKeyedLimiter(proposalsPerMinute, proposalBurst),
		failures:  newKeyedLimiter(authFailuresPerMinute, authFailureBurst),
	}

	streamable := mcp.NewStreamableHTTPHandler(s.serverFor, &mcp.StreamableHTTPOptions{
		// Each request stands alone: no server-side sessions to pin to one
		// backend instance, and plain JSON responses that proxies never buffer.
		Stateless:           true,
		JSONResponse:        true,
		MaxRequestBodyBytes: maxRequestBodyBytes,
		// The SDK's localhost check rejects loopback connections whose Host is
		// not localhost, which is exactly how a reverse proxy in the same
		// container reaches us. It guards unauthenticated local servers against
		// DNS rebinding; here every request needs a bearer token instead.
		DisableLocalhostProtection: true,
	})

	// Browsers may only call the endpoint from an allowed origin. Clients that
	// are not browsers send neither Origin nor Sec-Fetch-Site and pass.
	protection := http.NewCrossOriginProtection()
	for _, origin := range deps.AllowedOrigins {
		if origin = strings.TrimSpace(origin); origin != "" {
			if err := protection.AddTrustedOrigin(origin); err != nil {
				log.Printf("mcp: ignoring invalid allowed origin %q: %v", origin, err)
			}
		}
	}
	return protection.Handler(s.authenticate(streamable))
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func bearerToken(r *http.Request) string {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(header) < 7 || !strings.EqualFold(header[:7], "Bearer ") {
		return ""
	}
	return strings.TrimSpace(header[7:])
}

// authenticate resolves the personal access token into an actor. It does not
// advertise OAuth metadata: tokens are created in HLBuilder's settings.
func (s *server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		if s.failures.exhausted(ip) {
			w.Header().Set("Retry-After", "60")
			writeJSONError(w, http.StatusTooManyRequests, "Too many failed attempts. Try again in a minute.")
			return
		}
		token, err := s.deps.Tokens.Authenticate(bearerToken(r), ip)
		if errors.Is(err, services.ErrTokenInvalid) {
			s.failures.allow(ip)
			w.Header().Set("WWW-Authenticate", `Bearer realm="hlbuilder", error="invalid_token"`)
			writeJSONError(w, http.StatusUnauthorized, "A valid HLBuilder access token is required. Create one under Settings > MCP Access and send it as \"Authorization: Bearer <token>\".")
			return
		}
		if err != nil {
			log.Printf("mcp: token lookup failed: %v", err)
			writeJSONError(w, http.StatusInternalServerError, "Could not verify the access token.")
			return
		}
		if !s.requests.allow(token.ID.String()) {
			w.Header().Set("Retry-After", "5")
			writeJSONError(w, http.StatusTooManyRequests, "Rate limit reached for this token. Slow down and retry.")
			return
		}
		ctx := context.WithValue(r.Context(), actorContextKey, s.actorFor(token, r))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *server) actorFor(token *models.APIToken, r *http.Request) assistant.Actor {
	scope := assistant.ScopeRead
	if token.Scope == services.TokenScopePropose {
		scope = assistant.ScopePropose
	}
	tokenID := token.ID
	return assistant.Actor{
		UserID:      token.UserID,
		Scope:       scope,
		BuildID:     token.BuildID,
		Source:      services.ProposalSourceMCP,
		SourceLabel: token.Name,
		TokenID:     &tokenID,
		AppURL:      s.appURL(r),
	}
}

// appURL is the origin a person would open in a browser to reach this instance.
func (s *server) appURL(r *http.Request) string {
	if s.deps.PublicAppURL != "" {
		return s.deps.PublicAppURL
	}
	scheme := "http"
	if forwarded := r.Header.Get("X-Forwarded-Proto"); forwarded != "" {
		scheme = strings.TrimSpace(strings.Split(forwarded, ",")[0])
	} else if r.TLS != nil {
		scheme = "https"
	}
	host := r.Host
	if forwarded := r.Header.Get("X-Forwarded-Host"); forwarded != "" {
		host = strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	return scheme + "://" + host
}

// serverFor builds the MCP server for one request. It only registers the tools
// the caller's token allows, so a read-only token cannot even list the rest.
func (s *server) serverFor(r *http.Request) *mcp.Server {
	actor, ok := r.Context().Value(actorContextKey).(assistant.Actor)
	if !ok {
		return nil
	}
	mcpServer := mcp.NewServer(
		&mcp.Implementation{Name: "hlbuilder", Title: "HLBuilder", Version: s.deps.Version},
		&mcp.ServerOptions{Instructions: assistant.Instructions},
	)
	closedWorld := false
	notDestructive := false
	for _, tool := range s.deps.Registry.For(actor, assistant.ContextMCP) {
		mcpServer.AddTool(&mcp.Tool{
			Name:        tool.Name,
			Title:       tool.Title,
			Description: tool.Description,
			InputSchema: tool.InputSchema,
			Annotations: &mcp.ToolAnnotations{
				Title:           tool.Title,
				ReadOnlyHint:    tool.ReadOnly,
				DestructiveHint: &notDestructive,
				OpenWorldHint:   &closedWorld,
			},
		}, s.toolHandler(tool.Name, actor))
	}
	return mcpServer
}

func textResult(text string, isError bool) *mcp.CallToolResult {
	return &mcp.CallToolResult{IsError: isError, Content: []mcp.Content{&mcp.TextContent{Text: text}}}
}

func (s *server) toolHandler(name string, actor assistant.Actor) mcp.ToolHandler {
	return func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		if name == "propose_changes" && actor.TokenID != nil && !s.proposals.allow(actor.TokenID.String()) {
			return textResult("Too many proposals in a short time. Wait a minute, then send one combined proposal.", true), nil
		}
		result, err := s.deps.Registry.Call(ctx, actor, assistant.ContextMCP, name, req.Params.Arguments)
		if err != nil {
			// Tool failures go back as results so the model can read and fix them.
			var toolErr *assistant.ToolError
			if errors.As(err, &toolErr) {
				return textResult(toolErr.Message, true), nil
			}
			return textResult("HLBuilder could not complete this call. Try again in a moment.", true), nil
		}
		response := textResult(result.Text(), false)
		response.StructuredContent = result.Data
		return response, nil
	}
}
