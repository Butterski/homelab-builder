package handlers

import (
	"errors"
	"log"
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
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
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	buildID, ok := uuidParam(c, "id")
	if !ok {
		return
	}

	report, err := h.service.Report(buildID, userID)
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
