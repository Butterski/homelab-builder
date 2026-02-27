package handlers

import (
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
)

type SteeringHandler struct {
	svc *services.SteeringService
}

func NewSteeringHandler(svc *services.SteeringService) *SteeringHandler {
	return &SteeringHandler{svc: svc}
}

// GET /api/admin/steering
func (h *SteeringHandler) GetAll(c *gin.Context) {
	rules, err := h.svc.GetAll()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch steering rules"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rules})
}

// PUT /api/admin/steering/:category
func (h *SteeringHandler) Upsert(c *gin.Context) {
	category := c.Param("category")
	var input services.UpsertSteeringRuleInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	rule, err := h.svc.Upsert(category, input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update steering rule"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": rule})
}

// DELETE /api/admin/steering/:category
func (h *SteeringHandler) Delete(c *gin.Context) {
	category := c.Param("category")
	if err := h.svc.Delete(category); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete steering rule"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Deleted"})
}
