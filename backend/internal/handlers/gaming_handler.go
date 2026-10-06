package handlers

import (
	"errors"
	"log"
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type GamingHandler struct {
	service *services.GamingService
}

func NewGamingHandler(service *services.GamingService) *GamingHandler {
	return &GamingHandler{service: service}
}

// Report returns the gaming report of a build: game server sizing, port
// forwards and uplink, and for LAN parties seats, leases, switch ports and power.
func (h *GamingHandler) Report(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	buildID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	report, err := h.service.Report(buildID, userID.(uuid.UUID))
	if errors.Is(err, services.ErrBuildNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Build not found"})
		return
	}
	if err != nil {
		log.Printf("Gaming report error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to build the gaming report"})
		return
	}
	c.JSON(http.StatusOK, report)
}
