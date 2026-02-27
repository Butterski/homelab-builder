package handlers

import (
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type CatalogComponentHandler struct {
	svc *services.CatalogComponentService
}

func NewCatalogComponentHandler(svc *services.CatalogComponentService) *CatalogComponentHandler {
	return &CatalogComponentHandler{svc: svc}
}

// GET /api/admin/catalog-components
func (h *CatalogComponentHandler) GetAll(c *gin.Context) {
	comps, err := h.svc.GetAll()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch catalog components"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": comps})
}

// POST /api/admin/catalog-components
func (h *CatalogComponentHandler) Create(c *gin.Context) {
	var input services.CreateCatalogComponentInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	comp, err := h.svc.Create(input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create catalog component"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": comp})
}

// PUT /api/admin/catalog-components/:id
func (h *CatalogComponentHandler) Update(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	var input services.UpdateCatalogComponentInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	comp, err := h.svc.Update(id, input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update catalog component"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": comp})
}

// DELETE /api/admin/catalog-components/:id
func (h *CatalogComponentHandler) Delete(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	if err := h.svc.Delete(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete catalog component"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Deleted"})
}
