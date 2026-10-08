package handlers

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
)

var allowedCategories = map[string]bool{
	"media":           true,
	"networking":      true,
	"monitoring":      true,
	"storage":         true,
	"management":      true,
	"home_automation": true,
	"gaming":          true,
	"other":           true,
}

type ServiceHandler struct {
	service *services.ServiceService
}

func NewServiceHandler(service *services.ServiceService) *ServiceHandler {
	return &ServiceHandler{service: service}
}

func (h *ServiceHandler) GetAll(c *gin.Context) {
	svcs, err := h.service.GetAll()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to fetch services. Please try again.",
			"code":  "internal_error",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": svcs})
}

func (h *ServiceHandler) GetAllForCurrentUser(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	svcs, err := h.service.GetAllForUser(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to fetch services. Please try again.",
			"code":  "internal_error",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": svcs})
}

func (h *ServiceHandler) Create(c *gin.Context) {
	input, ok := bindServiceInput(c)
	if !ok {
		return
	}

	svc, err := h.service.Create(input)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "unique") {
			c.JSON(http.StatusConflict, gin.H{
				"error": "A service with this name already exists",
				"code":  "duplicate",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to create service. Please try again.",
			"code":  "internal_error",
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": svc})
}

func (h *ServiceHandler) CreatePrivate(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}

	input, ok := bindServiceInput(c)
	if !ok {
		return
	}

	svc, err := h.service.CreatePrivate(userID, input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to create service. Please try again.",
			"code":  "internal_error",
		})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": svc})
}

func (h *ServiceHandler) SubmitPrivateToCommunity(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	id, ok := uuidParam(c, "id")
	if !ok {
		return
	}

	svc, err := h.service.SubmitPrivateToCommunity(id, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to submit service. Please try again.",
			"code":  "internal_error",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": svc, "message": "Service submitted for review"})
}

// bindServiceInput reads and validates a new service. It writes the 400 itself
// when it returns false.
func bindServiceInput(c *gin.Context) (services.CreateServiceInput, bool) {
	var input services.CreateServiceInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid request body. Name and category are required.",
			"code":  "validation_error",
		})
		return input, false
	}

	if errs := validateServiceInput(input.Name, input.Category, input.MinRAMMB, input.RecommendedRAMMB, input.MinCPUCores, input.RecommendedCPUCores, input.MinStorageGB, input.RecommendedStorageGB); len(errs) > 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":  "Validation failed",
			"code":   "validation_error",
			"errors": errs,
		})
		return input, false
	}
	return input, true
}

type fieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

func validateServiceInput(name, category string, minRAM, recRAM int, minCPU, recCPU float32, minStorage, recStorage int) []fieldError {
	var errs []fieldError

	if len(name) < 2 || len(name) > 255 {
		errs = append(errs, fieldError{Field: "name", Message: "Name must be between 2 and 255 characters"})
	}
	if !allowedCategories[category] {
		errs = append(errs, fieldError{Field: "category", Message: fmt.Sprintf("Invalid category. Allowed: %s", strings.Join(getAllowedCategories(), ", "))})
	}
	if minRAM < 0 || minRAM > 1048576 { // max 1 TB
		errs = append(errs, fieldError{Field: "min_ram_mb", Message: "RAM must be between 0 and 1,048,576 MB"})
	}
	if recRAM < 0 || recRAM > 1048576 {
		errs = append(errs, fieldError{Field: "recommended_ram_mb", Message: "RAM must be between 0 and 1,048,576 MB"})
	}
	if minRAM > recRAM && recRAM > 0 {
		errs = append(errs, fieldError{Field: "min_ram_mb", Message: "Minimum RAM cannot exceed recommended RAM"})
	}
	if minCPU < 0 || minCPU > 256 {
		errs = append(errs, fieldError{Field: "min_cpu_cores", Message: "CPU cores must be between 0 and 256"})
	}
	if recCPU < 0 || recCPU > 256 {
		errs = append(errs, fieldError{Field: "recommended_cpu_cores", Message: "CPU cores must be between 0 and 256"})
	}
	if minStorage < 0 || minStorage > 100000 {
		errs = append(errs, fieldError{Field: "min_storage_gb", Message: "Storage must be between 0 and 100,000 GB"})
	}
	if recStorage < 0 || recStorage > 100000 {
		errs = append(errs, fieldError{Field: "recommended_storage_gb", Message: "Storage must be between 0 and 100,000 GB"})
	}

	return errs
}

func getAllowedCategories() []string {
	cats := make([]string, 0, len(allowedCategories))
	for cat := range allowedCategories {
		cats = append(cats, cat)
	}
	return cats
}
