package handlers

import (
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type AdminHandler struct {
	db             *gorm.DB
	serviceService *services.ServiceService
}

func NewAdminHandler(db *gorm.DB, serviceService *services.ServiceService) *AdminHandler {
	return &AdminHandler{db: db, serviceService: serviceService}
}

// Dashboard - basic stats
func (h *AdminHandler) Dashboard(c *gin.Context) {
	var serviceCount int64
	h.db.Model(&models.Service{}).Where("is_active = ?", true).Count(&serviceCount)

	var userCount int64
	h.db.Model(&models.User{}).Count(&userCount)

	var eventCount int64
	h.db.Model(&models.Event{}).Count(&eventCount)

	// Most popular services (by selection count)
	type PopularService struct {
		ServiceName string `json:"service_name"`
		Count       int    `json:"count"`
	}
	var popular []PopularService
	h.db.Raw(`
		SELECT s.name as service_name, COUNT(us.id) as count
		FROM user_selections us
		JOIN services s ON s.id = us.service_id
		GROUP BY s.name
		ORDER BY count DESC
		LIMIT 5
	`).Scan(&popular)

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"service_count":    serviceCount,
			"user_count":       userCount,
			"event_count":      eventCount,
			"popular_services": popular,
		},
	})
}

// ListUsers - list all users
func (h *AdminHandler) ListUsers(c *gin.Context) {
	var users []models.User
	h.db.Order("created_at DESC").Limit(100).Find(&users)
	c.JSON(http.StatusOK, gin.H{"data": users})
}

// ListAllServices - list all services including inactive
func (h *AdminHandler) ListAllServices(c *gin.Context) {
	var svcs []models.Service
	h.db.Preload("Requirements").Order("category, name").Find(&svcs)
	c.JSON(http.StatusOK, gin.H{"data": svcs})
}

// ToggleServiceActive - activate/deactivate a service
func (h *AdminHandler) ToggleServiceActive(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid service ID"})
		return
	}

	var service models.Service
	if err := h.db.First(&service, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Service not found"})
		return
	}

	service.IsActive = !service.IsActive
	h.db.Save(&service)

	c.JSON(http.StatusOK, gin.H{"data": service, "message": "Service toggled"})
}

// RecentEvents - get recent analytics events
func (h *AdminHandler) RecentEvents(c *gin.Context) {
	var events []models.Event
	h.db.Order("created_at DESC").Limit(50).Find(&events)
	c.JSON(http.StatusOK, gin.H{"data": events})
}

// UpdateServiceFull - full PUT for an existing service (including requirements)
func (h *AdminHandler) UpdateServiceFull(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid service ID"})
		return
	}

	var input services.UpdateServiceInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	service, err := h.serviceService.Update(id, input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update service"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": service, "message": "Service updated"})
}

// DeleteService - hard delete for a service
func (h *AdminHandler) DeleteService(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid service ID"})
		return
	}

	if err := h.serviceService.HardDelete(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete service"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Service permanently deleted"})
}
