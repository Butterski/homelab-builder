package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// currentUser reads the caller the auth middleware stored. It writes the 401
// itself when it returns false.
func currentUser(c *gin.Context) (uuid.UUID, bool) {
	raw, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return uuid.Nil, false
	}
	return raw.(uuid.UUID), true
}

// uuidParam parses the named path parameter. It writes the 400 itself when it
// returns false.
func uuidParam(c *gin.Context, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(name))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return uuid.Nil, false
	}
	return id, true
}
