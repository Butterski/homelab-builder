package handlers

import (
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
)

type HardwareBlueprintHandler struct {
	svc *services.HardwareBlueprintService
}

func NewHardwareBlueprintHandler(svc *services.HardwareBlueprintService) *HardwareBlueprintHandler {
	return &HardwareBlueprintHandler{svc: svc}
}

func (h *HardwareBlueprintHandler) ListMine(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	blueprints, err := h.svc.ListMine(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch blueprints"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": blueprints})
}

func (h *HardwareBlueprintHandler) Create(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}

	var input services.HardwareBlueprintInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	blueprint, err := h.svc.Create(userID, input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create blueprint"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": blueprint})
}

func (h *HardwareBlueprintHandler) Submit(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	id, ok := uuidParam(c, "id")
	if !ok {
		return
	}

	blueprint, err := h.svc.SubmitToCommunity(userID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to submit blueprint"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": blueprint})
}

func (h *HardwareBlueprintHandler) Export(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	id, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	exported, err := h.svc.Export(userID, id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Blueprint not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": exported})
}

func (h *HardwareBlueprintHandler) CreateShareCode(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	id, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	blueprint, err := h.svc.CreateShareCode(userID, id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Blueprint not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": blueprint})
}

func (h *HardwareBlueprintHandler) Import(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	var input services.HardwareBlueprintImportInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	blueprint, err := h.svc.Import(userID, input)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": blueprint})
}

func (h *HardwareBlueprintHandler) AdminListPending(c *gin.Context) {
	status := c.Query("status")
	if status == "" {
		status = services.BlueprintModerationPending
	}
	blueprints, err := h.svc.ListModerationQueue(status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch pending blueprints"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": blueprints})
}

func (h *HardwareBlueprintHandler) AdminModerate(c *gin.Context) {
	reviewerID, ok := currentUser(c)
	if !ok {
		return
	}
	id, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	var input services.HardwareBlueprintModerationInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	blueprint, err := h.svc.Moderate(id, reviewerID, input)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": blueprint})
}
