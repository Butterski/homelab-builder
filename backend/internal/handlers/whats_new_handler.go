package handlers

import (
	"errors"
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
)

// WhatsNewHandler serves the state of the What's new dialog.
type WhatsNewHandler struct {
	service *services.WhatsNewService
}

func NewWhatsNewHandler(service *services.WhatsNewService) *WhatsNewHandler {
	return &WhatsNewHandler{service: service}
}

// Get returns the last release the caller saw and the notices of its builds.
func (h *WhatsNewHandler) Get(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	state, err := h.service.Get(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not read what is new"})
		return
	}
	c.JSON(http.StatusOK, state)
}

// MarkSeen records that the caller was shown a release and its notices.
func (h *WhatsNewHandler) MarkSeen(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	var input struct {
		Version string `json:"version" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "version is required"})
		return
	}
	switch err := h.service.MarkSeen(userID, input.Version); {
	case errors.Is(err, services.ErrInvalidVersion):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not record what was seen"})
	default:
		c.Status(http.StatusNoContent)
	}
}
