package handlers

import (
	"errors"
	"log"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/Butterski/homelab-builder/backend/internal/inventory"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
)

// InventoryHandler serves the hardware a user owns. The inventory belongs to
// the account, so none of its routes name a build.
type InventoryHandler struct {
	service *services.InventoryService
}

func NewInventoryHandler(service *services.InventoryService) *InventoryHandler {
	return &InventoryHandler{service: service}
}

// readable is an error as its reader is told: without the label the service
// wrapped it in ("invalid inventory item: "), and starting with a capital.
// What follows the label is written for the owner.
func readable(err error, labels ...error) string {
	message := err.Error()
	for _, label := range labels {
		message = strings.TrimPrefix(message, label.Error()+": ")
	}
	first, size := utf8.DecodeRuneInString(message)
	if size == 0 {
		return message
	}
	return string(unicode.ToUpper(first)) + message[size:]
}

func (h *InventoryHandler) respondError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, services.ErrInventoryItemNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Inventory item not found"})
	case errors.Is(err, inventory.ErrInvalid):
		c.JSON(http.StatusBadRequest, gin.H{"error": readable(err, inventory.ErrInvalid)})
	case errors.Is(err, services.ErrInventoryLimit):
		c.JSON(http.StatusConflict, gin.H{"code": "inventory_limit", "error": err.Error()})
	default:
		log.Printf("Inventory error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process the inventory"})
	}
}

func (h *InventoryHandler) List(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	items, err := h.service.List(userID)
	if err != nil {
		h.respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "limit": services.MaxInventoryItems})
}

func (h *InventoryHandler) Create(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	var req services.InventoryInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	item, err := h.service.Create(userID, req)
	if err != nil {
		h.respondError(c, err)
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *InventoryHandler) Update(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	itemID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	var req services.InventoryInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	item, err := h.service.Update(userID, itemID, req)
	if err != nil {
		h.respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *InventoryHandler) Delete(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	itemID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	if err := h.service.Delete(userID, itemID); err != nil {
		h.respondError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
