package handlers

import (
	"errors"
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

// We no longer define CreateBuildRequest locally.
// We bind directly to the new structured DTO `services.SyncGraphInput`.

func (h *BuildHandler) Create(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req services.SyncGraphInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.Nodes) > 0 || len(req.Edges) > 0 || len(req.Services) > 0 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "create the project first, then submit topology through the atomic topology endpoint"})
		return
	}

	build, err := h.service.Create(userID.(uuid.UUID), req)
	if err != nil {
		log.Printf("Build Create Error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create build"})
		return
	}

	c.JSON(http.StatusCreated, build)
}

func (h *BuildHandler) Get(c *gin.Context) {
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

	build, err := h.service.GetByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Build not found"})
		return
	}

	if build.UserID != userID.(uuid.UUID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Unauthorized to access this build"})
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

func (h *BuildHandler) Rename(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}
	var req struct {
		Name     string `json:"name" binding:"required"`
		Revision uint64 `json:"revision"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	build, err := h.service.Rename(id, userID.(uuid.UUID), req.Name, req.Revision)
	if errors.Is(err, services.ErrBuildRevisionConflict) {
		latest, _ := h.service.GetByID(id)
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "build": latest})
		return
	}
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, build)
}

// UpdateTopology is the builder's canonical mutation endpoint. It serializes
// writers by build revision and only commits when IP allocation also succeeds.
func (h *BuildHandler) UpdateTopology(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	var req services.SyncGraphInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	build, err := h.service.UpdateAndCalculate(id, userID.(uuid.UUID), req, h.ipService)
	if err == nil {
		validation, validationErr := h.ipService.ValidateNetwork(id)
		if validationErr != nil {
			log.Printf("Build validation after topology update failed: %v", validationErr)
			c.JSON(http.StatusOK, gin.H{"build": build})
			return
		}
		c.JSON(http.StatusOK, gin.H{"build": build, "validation": validation})
		return
	}

	log.Printf("Topology Update Error: %v", err)
	if errors.Is(err, services.ErrBuildRevisionConflict) {
		latest, _ := h.service.GetByID(id)
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "build": latest})
		return
	}
	if errors.Is(err, services.ErrInvalidEdgeReferences) || errors.Is(err, services.ErrInvalidTopology) {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save and calculate topology: " + err.Error()})
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

	build, err := h.service.GetByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Build not found"})
		return
	}

	if build.UserID != userID.(uuid.UUID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Unauthorized to access this build"})
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

func (h *BuildHandler) ValidateNetwork(c *gin.Context) {
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

	build, err := h.service.GetByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Build not found"})
		return
	}

	if build.UserID != userID.(uuid.UUID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Unauthorized to access this build"})
		return
	}

	result, err := h.ipService.ValidateNetwork(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to validate network: " + err.Error()})
		return
	}

	c.Data(http.StatusOK, "application/json", result)
}

func (h *BuildHandler) Share(c *gin.Context) {
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

	build, err := h.service.ShareBuild(id, userID.(uuid.UUID))
	if err != nil {
		if err == services.ErrBuildNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Build not found"})
			return
		}
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, build)
}

func (h *BuildHandler) Unshare(c *gin.Context) {
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

	build, err := h.service.UnshareBuild(id, userID.(uuid.UUID))
	if err != nil {
		if err == services.ErrBuildNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Build not found"})
			return
		}
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, build)
}

func (h *BuildHandler) GetShared(c *gin.Context) {
	token := c.Param("token")
	build, err := h.service.GetByShareToken(token)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Shared build not found"})
		return
	}
	c.JSON(http.StatusOK, build)
}

type shareSettingsRequest struct {
	Editable bool `json:"editable"`
}

func (h *BuildHandler) SetShareEditable(c *gin.Context) {
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

	var req shareSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	build, err := h.service.SetShareEditable(id, userID.(uuid.UUID), req.Editable)
	if err != nil {
		if err == services.ErrBuildNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Build not found"})
			return
		}
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, build)
}

func (h *BuildHandler) UpdateShared(c *gin.Context) {
	token := c.Param("token")

	var req services.SyncGraphInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	build, err := h.service.UpdateByShareToken(token, req, h.ipService)
	if err != nil {
		if err == services.ErrBuildNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Shared build not found or editing not allowed"})
			return
		}
		if errors.Is(err, services.ErrBuildRevisionConflict) {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, services.ErrInvalidEdgeReferences) || errors.Is(err, services.ErrInvalidTopology) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}

		log.Printf("UpdateShared Error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update shared build"})
		return
	}

	c.JSON(http.StatusOK, build)
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
