package handlers

import (
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type HardwareBlueprintHandler struct {
	svc *services.HardwareBlueprintService
}

func NewHardwareBlueprintHandler(svc *services.HardwareBlueprintService) *HardwareBlueprintHandler {
	return &HardwareBlueprintHandler{svc: svc}
}

func (h *HardwareBlueprintHandler) ListMine(c *gin.Context) {
	userID, err := getHwBlueprintUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}
	blueprints, err := h.svc.ListMine(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch blueprints"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": blueprints})
}

func (h *HardwareBlueprintHandler) ListCommunity(c *gin.Context) {
	blueprints, err := h.svc.ListCommunity()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch community blueprints"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": blueprints})
}

func (h *HardwareBlueprintHandler) Create(c *gin.Context) {
	userID, err := getHwBlueprintUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
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
	userID, err := getHwBlueprintUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid blueprint ID"})
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
	userID, err := getHwBlueprintUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid blueprint ID"})
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
	userID, err := getHwBlueprintUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid blueprint ID"})
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
	userID, err := getHwBlueprintUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
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

func (h *HardwareBlueprintHandler) Vote(c *gin.Context) {
	userID, err := getHwBlueprintUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid blueprint ID"})
		return
	}
	var body struct {
		Value int `json:"value"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	blueprint, err := h.svc.Vote(userID, id, body.Value)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": blueprint})
}

func (h *HardwareBlueprintHandler) Review(c *gin.Context) {
	userID, err := getHwBlueprintUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid blueprint ID"})
		return
	}
	var input services.HardwareBlueprintReviewInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	review, err := h.svc.Review(userID, id, input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save review"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": review})
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

func (h *HardwareBlueprintHandler) AdminSetVisibility(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid blueprint ID"})
		return
	}
	var body struct {
		Visibility string `json:"visibility"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	blueprint, err := h.svc.SetVisibility(id, body.Visibility)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": blueprint})
}

func (h *HardwareBlueprintHandler) AdminModerate(c *gin.Context) {
	reviewerID, err := getHwBlueprintUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid blueprint ID"})
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

func getHwBlueprintUserID(c *gin.Context) (uuid.UUID, error) {
	userIDVal, exists := c.Get("user_id")
	if !exists {
		return uuid.Nil, http.ErrNoCookie
	}
	userID, ok := userIDVal.(uuid.UUID)
	if !ok {
		return uuid.Nil, http.ErrNoCookie
	}
	return userID, nil
}
