package handlers

import (
	"fmt"
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type ConfigHandler struct {
	service *services.ConfigService
}

func NewConfigHandler(service *services.ConfigService) *ConfigHandler {
	return &ConfigHandler{
		service: service,
	}
}

func (h *ConfigHandler) GenerateConfig(c *gin.Context) {
	userIDVal, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	buildIDStr := c.Param("id")
	buildID, err := uuid.Parse(buildIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid build ID"})
		return
	}

	bundle, err := h.service.GenerateAll(buildID, userIDVal.(uuid.UUID))
	if err != nil {
		fmt.Printf("Config Generate Error: %v\n", err)
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, bundle)
}
