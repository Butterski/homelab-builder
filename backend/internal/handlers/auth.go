package handlers

import (
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

	// Check if IP is locked out — return same error as invalid creds
	if h.rateLimiter.IsBlocked(ip) {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Invalid credentials",
			"code":  "invalid_credentials",
		})
		return
	}

	var input services.GoogleLoginInput
	if err := c.ShouldBindJSON(&input); err != nil {
		// Record as failed attempt (malformed request = suspicious)
		h.rateLimiter.RecordFailure(ip)
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid credentials",
			"code":  "invalid_credentials",
		})
		return
	}

	result, err := h.service.GoogleLogin(input)
	if err != nil {
		// Record failure
		locked := h.rateLimiter.RecordFailure(ip)
		if locked {
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
	c.JSON(http.StatusOK, gin.H{"data": result})
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

	c.JSON(http.StatusOK, gin.H{"data": user})
}
