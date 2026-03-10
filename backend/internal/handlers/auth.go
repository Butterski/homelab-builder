package handlers

import (
	"errors"
	"log"
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/middleware"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type AuthHandler struct {
	service     *services.AuthService
	rateLimiter *middleware.RateLimiter
}

func NewAuthHandler(service *services.AuthService, rateLimiter *middleware.RateLimiter) *AuthHandler {
	return &AuthHandler{
		service:     service,
		rateLimiter: rateLimiter,
	}
}

func (h *AuthHandler) GoogleLogin(c *gin.Context) {
	ip := c.ClientIP()

	var input services.GoogleLoginInput
	if err := c.ShouldBindJSON(&input); err != nil {
		// Record as failed attempt (malformed request = suspicious)
		h.rateLimiter.RecordFailure(ip)
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid payload. Expected 'credential' field.",
			"code":  "invalid_payload",
		})
		return
	}

	result, err := h.service.GoogleLogin(input)
	if err != nil {
		log.Printf("Google Login Error: %v", err)

		// Record failure
		locked := h.rateLimiter.RecordFailure(ip)
		if locked {
			log.Printf("Rate limit locked IP: %s", ip)
			// Just locked — return same generic error
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid credentials",
				"code":  "invalid_credentials",
			})
			return
		}
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Invalid credentials",
			"code":  "invalid_credentials",
		})
		return
	}

	// Success — clear attempt counter
	h.rateLimiter.ClearAttempts(ip)
	// Return result directly without "data" wrapper to match frontend expectation
	c.JSON(http.StatusOK, result)
}

func (h *AuthHandler) DevLogin(c *gin.Context) {
	var input struct {
		Email string `json:"email" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Email is required"})
		return
	}

	result, err := h.service.DevLogin(input.Email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Login failed"})
		return
	}

	// Return result directly without "data" wrapper
	c.JSON(http.StatusOK, result)
}

func (h *AuthHandler) GetCurrentUser(c *gin.Context) {
	userIDStr, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	userID, ok := userIDStr.(uuid.UUID)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid user session"})
		return
	}

	user, err := h.service.GetCurrentUser(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Return result directly without "data" wrapper
	c.JSON(http.StatusOK, user)
}

func (h *AuthHandler) UpdatePreferences(c *gin.Context) {
	userIDStr, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	userID, ok := userIDStr.(uuid.UUID)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid user session"})
		return
	}

	var input struct {
		Preferences map[string]interface{} `json:"preferences" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Preferences mapping is required"})
		return
	}

	user, err := h.service.UpdatePreferences(userID, input.Preferences)
	if err != nil {
		if errors.Is(err, services.ErrInvalidThemeSettings) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, user)
}

func (h *AuthHandler) GetThemeSettings(c *gin.Context) {
	userIDStr, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	userID, ok := userIDStr.(uuid.UUID)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid user session"})
		return
	}

	themeSettings, err := h.service.GetThemeSettings(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, themeSettings)
}

func (h *AuthHandler) UpdateThemeSettings(c *gin.Context) {
	userIDStr, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	userID, ok := userIDStr.(uuid.UUID)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid user session"})
		return
	}

	var input services.ThemeSettings
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Theme settings payload is required"})
		return
	}

	themeSettings, err := h.service.UpdateThemeSettings(userID, input)
	if err != nil {
		if errors.Is(err, services.ErrInvalidThemeSettings) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, themeSettings)
}
