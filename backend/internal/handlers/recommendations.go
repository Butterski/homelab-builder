package handlers

import (
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
)

type RecommendationHandler struct {
	service *services.RecommendationService
}

func NewRecommendationHandler(service *services.RecommendationService) *RecommendationHandler {
	return &RecommendationHandler{service: service}
}

func (h *RecommendationHandler) Generate(c *gin.Context) {
	var req services.RecommendationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "service_ids is required"})
		return
	}

	if len(req.ServiceIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at least one service must be selected"})
		return
	}

	result, err := h.service.Generate(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}
