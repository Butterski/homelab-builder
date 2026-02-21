package handlers

import (
	"log"
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type BuildHandler struct {
	service   *services.BuildService
	ipService *services.IPService
}

func NewBuildHandler(service *services.BuildService, ipService *services.IPService) *BuildHandler {
	return &BuildHandler{
		service:   service,
		ipService: ipService,
	}
}

type CreateBuildRequest struct {
	Name      string `json:"name" binding:"required"`
	Data      string `json:"data" binding:"required"` // Assuming JSON string
	Thumbnail string `json:"thumbnail"`
}

func (h *BuildHandler) Create(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req CreateBuildRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	build, err := h.service.Create(userID.(uuid.UUID), req.Name, req.Data, req.Thumbnail)
	if err != nil {
		log.Printf("Build Create Error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create build"})
		return
	}

	c.JSON(http.StatusCreated, build)
}

func (h *BuildHandler) Get(c *gin.Context) {
	idParam := c.Param("id")
	id, err := uuid.Parse(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	build, err := h.service.GetByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Build not found"})
		return
	}

	c.JSON(http.StatusOK, build)
}

func (h *BuildHandler) List(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	builds, err := h.service.ListByUser(userID.(uuid.UUID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list builds"})
		return
	}

	c.JSON(http.StatusOK, builds)
}

func (h *BuildHandler) Update(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	idParam := c.Param("id")
	id, err := uuid.Parse(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	var req CreateBuildRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	build, err := h.service.Update(id, userID.(uuid.UUID), req.Name, req.Data, req.Thumbnail)
	if err != nil {
		log.Printf("Build Update Error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update build"})
		return
	}

	c.JSON(http.StatusOK, build)
}

func (h *BuildHandler) Delete(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	idParam := c.Param("id")
	id, err := uuid.Parse(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	if err := h.service.Delete(id, userID.(uuid.UUID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete build"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Build deleted"})
}

func (h *BuildHandler) CalculateNetwork(c *gin.Context) {
	idParam := c.Param("id")
	id, err := uuid.Parse(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	if err := h.ipService.CalculateNetwork(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to calculate network: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":  "Network calculated successfully",
		"build_id": id,
	})
}

func (h *BuildHandler) Duplicate(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	idParam := c.Param("id")
	id, err := uuid.Parse(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	build, err := h.service.Duplicate(id, userID.(uuid.UUID))
	if err != nil {
		log.Printf("Build Duplicate Error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to duplicate build"})
		return
	}

	c.JSON(http.StatusCreated, build)
}
