package middleware

import (
	"net/http"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
)

// AuthMiddleware puts the caller's id into the context as "user_id".
func AuthMiddleware(authService *services.AuthService, authDisabled bool) gin.HandlerFunc {
	return authenticate(authService, authDisabled, false)
}

// AuthMiddlewareWithUser also loads the full User model into the context as
// "user", which the admin check needs.
func AuthMiddlewareWithUser(authService *services.AuthService, authDisabled bool) gin.HandlerFunc {
	return authenticate(authService, authDisabled, true)
}

func authenticate(authService *services.AuthService, authDisabled, withUser bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		if authDisabled {
			user, err := authService.GetOrCreateLocalAdmin()
			if err != nil {
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Failed to provision local admin"})
				return
			}
			c.Set("user_id", user.ID)
			if withUser {
				c.Set("user", user)
			}
			c.Next()
			return
		}

		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization format. Use: Bearer <token>"})
			return
		}

		claims, err := authService.ValidateToken(parts[1])
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			return
		}

		c.Set("user_id", claims.UserID)
		if withUser {
			user, err := authService.GetCurrentUser(claims.UserID)
			if err != nil {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "User account not found"})
				return
			}
			c.Set("user", user)
		}
		c.Next()
	}
}
