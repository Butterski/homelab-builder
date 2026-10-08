package handlers

import (
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
)

type SelectionHandler struct {
	service *services.SelectionService
}

func NewSelectionHandler(service *services.SelectionService) *SelectionHandler {
	return &SelectionHandler{service: service}
}

func (h *SelectionHandler) GetSelections(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
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
	userID, ok := currentUser(c)
	if !ok {
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
	userID, ok := currentUser(c)
	if !ok {
		return
	}

	selectionID, ok := uuidParam(c, "id")
	if !ok {
		return
	}

	if err := h.service.RemoveSelection(userID, selectionID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Selection not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Selection removed"})
}
