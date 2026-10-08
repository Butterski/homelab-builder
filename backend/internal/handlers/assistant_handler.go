package handlers

import (
	"errors"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/assistant"
	"github.com/Butterski/homelab-builder/backend/internal/llm"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	chatKeepAlive = 15 * time.Second
	// maxChatSelection bounds the selection a chat request may carry.
	maxChatSelection = 50
)

// AssistantHandler serves the in-app assistant: its per-user settings and the
// chat stream. All routes use the browser session.
type AssistantHandler struct {
	settings *services.AssistantSettingsService
	agent    *assistant.Agent
}

func NewAssistantHandler(settings *services.AssistantSettingsService, agent *assistant.Agent) *AssistantHandler {
	return &AssistantHandler{settings: settings, agent: agent}
}

func respondAssistantError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, assistant.ErrMessageInvalid), errors.Is(err, services.ErrAssistantInput):
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid", "error": err.Error()})
	case errors.Is(err, services.ErrAssistantUnavailable):
		c.JSON(http.StatusForbidden, gin.H{"code": "assistant_unavailable", "error": "The assistant is not available on this instance."})
	case errors.Is(err, services.ErrAssistantDisabled):
		c.JSON(http.StatusConflict, gin.H{"code": "assistant_disabled", "error": "Turn the assistant on in Settings first."})
	case errors.Is(err, services.ErrAssistantNotConfigured), errors.Is(err, services.ErrAssistantKeyUnusable):
		c.JSON(http.StatusConflict, gin.H{"code": "assistant_not_configured", "error": err.Error()})
	case errors.Is(err, assistant.ErrBusy):
		c.JSON(http.StatusConflict, gin.H{"code": "busy", "error": "The assistant is still working on your previous message."})
	case errors.Is(err, assistant.ErrThreadFull):
		c.JSON(http.StatusConflict, gin.H{"code": "thread_full", "error": "This conversation is too long. Clear the chat to start a new one."})
	case errors.Is(err, services.ErrBuildNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Build not found"})
	default:
		log.Printf("Assistant error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "The assistant request failed."})
	}
}

func (h *AssistantHandler) GetSettings(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	view, err := h.settings.Get(userID)
	if err != nil {
		respondAssistantError(c, err)
		return
	}
	c.JSON(http.StatusOK, view)
}

// UpdateSettings accepts a new key but never returns one: the response is the
// same view GetSettings gives, with the key reduced to a hint.
func (h *AssistantHandler) UpdateSettings(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	var req services.UpdateAssistantSettingsInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid settings"})
		return
	}
	view, err := h.settings.Update(userID, req)
	if err != nil {
		respondAssistantError(c, err)
		return
	}
	c.JSON(http.StatusOK, view)
}

func (h *AssistantHandler) DeleteKey(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	view, err := h.settings.DeleteKey(userID)
	if err != nil {
		respondAssistantError(c, err)
		return
	}
	c.JSON(http.StatusOK, view)
}

func (h *AssistantHandler) ResetSettings(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	if err := h.settings.Reset(userID); err != nil {
		respondAssistantError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// TestSettings checks the stored key by listing the provider's models, which
// costs nothing. A provider-side failure is a normal answer here, not an error.
func (h *AssistantHandler) TestSettings(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	models, err := h.agent.TestProvider(c.Request.Context(), userID)
	var providerErr *llm.ProviderError
	switch {
	case err == nil:
		c.JSON(http.StatusOK, gin.H{"ok": true, "models": models})
	case errors.As(err, &providerErr):
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": providerErr.UserMessage(), "models": []string{}})
	default:
		respondAssistantError(c, err)
	}
}

func (h *AssistantHandler) GetThread(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	buildID, ok := uuidParam(c, "buildId")
	if !ok {
		return
	}
	thread, err := h.agent.Thread(userID, buildID)
	if err != nil {
		respondAssistantError(c, err)
		return
	}
	c.JSON(http.StatusOK, thread)
}

func (h *AssistantHandler) ClearThread(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	buildID, ok := uuidParam(c, "buildId")
	if !ok {
		return
	}
	if err := h.agent.ClearThread(userID, buildID); err != nil {
		respondAssistantError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// Chat runs one assistant turn and streams it as server-sent events. Anything
// that can be refused is refused with a normal JSON error before the stream
// starts; after that, problems arrive as "error" events.
func (h *AssistantHandler) Chat(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	var req struct {
		BuildID string `json:"build_id"`
		Message string `json:"message"`
		// Selection is what the user has selected on the canvas. It is checked
		// against the build; the model is told about it from the build's data.
		Selection []string `json:"selection"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	buildID, err := uuid.Parse(req.BuildID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid build ID"})
		return
	}
	if len(req.Selection) > maxChatSelection {
		req.Selection = req.Selection[:maxChatSelection]
	}
	turn, err := h.agent.Prepare(userID, buildID, req.Message, req.Selection)
	if err != nil {
		respondAssistantError(c, err)
		return
	}

	header := c.Writer.Header()
	header.Set("Content-Type", "text/event-stream")
	header.Set("Cache-Control", "no-cache, no-transform")
	header.Set("Connection", "keep-alive")
	// Tells nginx not to buffer the stream.
	header.Set("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(http.StatusOK)
	c.Writer.Flush()

	// The keep-alive ticker and the turn write to the same response.
	var mu sync.Mutex
	closed := false
	write := func(frame []byte) {
		mu.Lock()
		defer mu.Unlock()
		if closed {
			return
		}
		if _, err := c.Writer.Write(frame); err == nil {
			c.Writer.Flush()
		}
	}
	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(chatKeepAlive)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				write([]byte(": ping\n\n"))
			case <-stop:
				return
			}
		}
	}()

	turn.Run(c.Request.Context(), func(event assistant.Event) { write(event.Encode()) })

	close(stop)
	mu.Lock()
	closed = true
	mu.Unlock()
}
