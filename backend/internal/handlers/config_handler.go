package handlers

import (
	"fmt"
	"log"
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
)

type ConfigHandler struct {
	service *services.ConfigService
}

func NewConfigHandler(service *services.ConfigService) *ConfigHandler {
	return &ConfigHandler{service: service}
}

func (h *ConfigHandler) GenerateConfig(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}

	buildID, ok := uuidParam(c, "id")
	if !ok {
		return
	}

	bundle, err := h.service.GenerateAll(buildID, userID)
	if err != nil {
		log.Printf("Config Generate Error: %v", err)
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, bundle)
}

func (h *ConfigHandler) DownloadBundle(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	buildID, ok := uuidParam(c, "id")
	if !ok {
		return
	}

	archive, filename, err := h.service.GenerateCompleteExport(buildID, userID)
	if err != nil {
		log.Printf("Complete Export Error: %v", err)
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, "application/zip", archive)
}
