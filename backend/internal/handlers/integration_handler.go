package handlers

import (
	"errors"
	"log"
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/inventory"
	"github.com/Butterski/homelab-builder/backend/internal/proxmox"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// A pasted export is the largest body these routes take.
const maxIntegrationBody = proxmox.MaxExportBytes + 64*1024

// IntegrationHandler serves a user's connections to Proxmox and what is done
// with what they report: matching hosts to the inventory, comparing a build
// with the cluster, importing the differences the owner chooses.
//
// Its routes sit behind the session middleware only. The token secret is
// write-only: no response contains it.
type IntegrationHandler struct {
	integrations *services.IntegrationService
	inventory    *services.InventoryService
	imports      *services.ProxmoxImportService
}

func NewIntegrationHandler(integrations *services.IntegrationService, inventory *services.InventoryService, imports *services.ProxmoxImportService) *IntegrationHandler {
	return &IntegrationHandler{integrations: integrations, inventory: inventory, imports: imports}
}

func (h *IntegrationHandler) respondError(c *gin.Context, err error) {
	var remote *proxmox.Error
	switch {
	case errors.Is(err, services.ErrIntegrationsUnavailable):
		c.JSON(http.StatusForbidden, gin.H{"code": "unavailable", "error": err.Error()})
	case errors.Is(err, services.ErrIntegrationNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Integration not found"})
	case errors.Is(err, services.ErrInventoryItemNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Inventory item not found"})
	case errors.Is(err, services.ErrBuildNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Build not found"})
	case errors.Is(err, services.ErrIntegrationInput), errors.Is(err, inventory.ErrInvalid), errors.Is(err, services.ErrIntegrationNoStore):
		c.JSON(http.StatusBadRequest, gin.H{"error": readable(err, services.ErrIntegrationInput, inventory.ErrInvalid)})
	case errors.Is(err, services.ErrIntegrationLimit), errors.Is(err, services.ErrInventoryLimit):
		c.JSON(http.StatusConflict, gin.H{"code": "limit", "error": err.Error()})
	case errors.Is(err, services.ErrIntegrationNoSecret):
		c.JSON(http.StatusConflict, gin.H{"code": "no_secret", "error": err.Error()})
	case errors.Is(err, services.ErrIntegrationNoSnapshot):
		c.JSON(http.StatusConflict, gin.H{"code": "no_snapshot", "error": err.Error()})
	case errors.Is(err, services.ErrIntegrationBusy):
		c.JSON(http.StatusTooManyRequests, gin.H{"code": "busy", "error": err.Error()})
	case errors.Is(err, services.ErrImportTooLarge), services.IsTopologyRejection(err):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
	case errors.Is(err, services.ErrBuildRevisionConflict):
		c.JSON(http.StatusConflict, gin.H{"code": "revision", "error": "The project was changed while the import was prepared. Try again."})
	case errors.As(err, &remote):
		// The cluster could not be read. The message is written for the owner
		// and never contains the secret.
		body := gin.H{"code": remote.Kind, "error": remote.Message}
		if remote.Certificate != nil {
			body["certificate"] = remote.Certificate
		}
		c.JSON(http.StatusBadGateway, body)
	default:
		log.Printf("Integration error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process the integration"})
	}
}

// integrationID reads the caller and the integration id of the route.
func integrationID(c *gin.Context) (userID, id uuid.UUID, ok bool) {
	userID, ok = currentUser(c)
	if !ok {
		return
	}
	id, ok = uuidParam(c, "id")
	return userID, id, ok
}

func (h *IntegrationHandler) List(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	integrations, err := h.integrations.List(userID)
	if err != nil {
		h.respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"integrations": integrations, "availability": h.integrations.Availability()})
}

// Test tries a connection without storing it.
func (h *IntegrationHandler) Test(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	var req services.IntegrationTestInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result, err := h.integrations.Test(c.Request.Context(), userID, req)
	if err != nil {
		h.respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

// bindIntegrationInput reads a create or update body; an export can be large,
// so the body is capped before it is read.
func bindIntegrationInput(c *gin.Context) (services.IntegrationInput, bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxIntegrationBody)
	var req services.IntegrationInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "The request is not valid or too large."})
		return req, false
	}
	return req, true
}

// Create stores a connection or a pasted export. A connection is read at once,
// so what comes back already says what is behind it; if that reading fails the
// integration is kept and carries the reason.
func (h *IntegrationHandler) Create(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	req, ok := bindIntegrationInput(c)
	if !ok {
		return
	}
	view, err := h.integrations.Create(userID, req)
	if err != nil {
		h.respondError(c, err)
		return
	}
	c.JSON(http.StatusCreated, h.readAfterSave(c, userID, view))
}

// readAfterSave reads the cluster with the connection that was just stored and
// returns the integration as it stands then. A reading that fails is not an
// error of the save: the integration is kept and carries the reason.
func (h *IntegrationHandler) readAfterSave(c *gin.Context, userID uuid.UUID, view *services.IntegrationView) *services.IntegrationView {
	if view.Source != proxmox.SourceAPI || !view.SecretUsable {
		return view
	}
	if synced, err := h.integrations.Sync(c.Request.Context(), userID, view.ID); err == nil {
		return synced
	}
	if latest, err := h.integrations.Get(userID, view.ID); err == nil {
		return latest
	}
	return view
}

func (h *IntegrationHandler) Update(c *gin.Context) {
	userID, id, ok := integrationID(c)
	if !ok {
		return
	}
	req, ok := bindIntegrationInput(c)
	if !ok {
		return
	}
	view, err := h.integrations.Update(userID, id, req)
	if err != nil {
		h.respondError(c, err)
		return
	}
	// A changed connection is read at once, like a new one: what the owner sees
	// next is what these settings give, not what the old ones last read (or
	// failed to read).
	if req.BaseURL != nil || req.TokenID != nil || req.Secret != nil || req.TLSFingerprint != nil {
		view = h.readAfterSave(c, userID, view)
	}
	c.JSON(http.StatusOK, view)
}

func (h *IntegrationHandler) Delete(c *gin.Context) {
	userID, id, ok := integrationID(c)
	if !ok {
		return
	}
	if err := h.integrations.Delete(userID, id); err != nil {
		h.respondError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// Sync reads the cluster again.
func (h *IntegrationHandler) Sync(c *gin.Context) {
	userID, id, ok := integrationID(c)
	if !ok {
		return
	}
	view, err := h.integrations.Sync(c.Request.Context(), userID, id)
	if err != nil {
		h.respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, view)
}

// Reconcile compares what was read with a build, or with nothing when the
// request names no build. It changes nothing.
func (h *IntegrationHandler) Reconcile(c *gin.Context) {
	userID, id, ok := integrationID(c)
	if !ok {
		return
	}
	var req services.ImportPlanRequest
	// The body is optional: without it every host is compared with nothing.
	_ = c.ShouldBindJSON(&req)
	plan, err := h.imports.Plan(userID, id, req)
	if err != nil {
		h.respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, plan)
}

// Link says which inventory item is the machine behind a host; a null item
// removes the link.
func (h *IntegrationHandler) Link(c *gin.Context) {
	userID, id, ok := integrationID(c)
	if !ok {
		return
	}
	var req struct {
		Node   string     `json:"node" binding:"required"`
		ItemID *uuid.UUID `json:"item_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.integrations.LinkItem(userID, id, req.Node, req.ItemID); err != nil {
		h.respondError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// CreateItem adds a host the inventory does not know as a new item.
func (h *IntegrationHandler) CreateItem(c *gin.Context) {
	userID, id, ok := integrationID(c)
	if !ok {
		return
	}
	var req services.HostItemInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	item, err := h.integrations.CreateItemFromHost(userID, id, req, h.inventory)
	if err != nil {
		h.respondError(c, err)
		return
	}
	c.JSON(http.StatusCreated, item)
}

// Import takes over what the owner chose: a proposal for an existing build, a
// new build otherwise.
func (h *IntegrationHandler) Import(c *gin.Context) {
	userID, id, ok := integrationID(c)
	if !ok {
		return
	}
	var req services.ImportDecision
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result, err := h.imports.Import(userID, id, req)
	if err != nil {
		h.respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
