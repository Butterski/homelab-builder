package handlers

import (
	"fmt"
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type SelectionHandler struct {
	service *services.SelectionService
}

func NewSelectionHandler(service *services.SelectionService) *SelectionHandler {
	return &SelectionHandler{service: service}
}

func (h *SelectionHandler) GetSelections(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	selections, err := h.service.GetUserSelections(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch selections"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": selections})
}

func (h *SelectionHandler) AddSelection(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	var input services.AddSelectionInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	selection, err := h.service.AddSelection(userID, input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": selection})
}

func (h *SelectionHandler) RemoveSelection(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	selectionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid selection ID"})
		return
	}

	if err := h.service.RemoveSelection(userID, selectionID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Selection not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Selection removed"})
}

func getUserID(c *gin.Context) (uuid.UUID, error) {
	userIDVal, exists := c.Get("user_id")
	if !exists {
		return uuid.Nil, fmt.Errorf("user_id not found in context")
	}
	userID, ok := userIDVal.(uuid.UUID)
	if !ok {
		return uuid.Nil, fmt.Errorf("invalid user_id type")
	}
	return userID, nil
}
