package handlers

import (
	"errors"
	"log"
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
)

// APITokenHandler manages personal access tokens for MCP clients. Its routes
// sit behind the session middleware only, so a token can never mint tokens.
type APITokenHandler struct {
	service *services.APITokenService
}

func NewAPITokenHandler(service *services.APITokenService) *APITokenHandler {
	return &APITokenHandler{service: service}
}

func (h *APITokenHandler) List(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	tokens, err := h.service.List(userID)
	if err != nil {
		log.Printf("Token list error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list tokens"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"tokens": tokens, "limit": services.MaxAPITokensPerUser})
}

// Create returns the plaintext token exactly once; it cannot be read again.
func (h *APITokenHandler) Create(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	var req services.CreateTokenInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	plaintext, token, err := h.service.Create(userID, req)
	switch {
	case errors.Is(err, services.ErrTokenInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, services.ErrTokenLimit):
		c.JSON(http.StatusConflict, gin.H{"code": "token_limit", "error": err.Error()})
	case err != nil:
		log.Printf("Token create error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create token"})
	default:
		c.JSON(http.StatusCreated, gin.H{"token": plaintext, "record": token})
	}
}

func (h *APITokenHandler) Revoke(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	tokenID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	err := h.service.Revoke(userID, tokenID)
	switch {
	case errors.Is(err, services.ErrTokenNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Token not found"})
	case err != nil:
		log.Printf("Token revoke error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to revoke token"})
	default:
		c.Status(http.StatusNoContent)
	}
}
