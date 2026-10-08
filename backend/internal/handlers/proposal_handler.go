package handlers

import (
	"errors"
	"log"
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ProposalHandler lets a build's owner review the change sets LLM clients
// suggested. Applying one is the only way those changes reach the build.
type ProposalHandler struct {
	service *services.ProposalService
}

func NewProposalHandler(service *services.ProposalService) *ProposalHandler {
	return &ProposalHandler{service: service}
}

// proposalParams reads the caller and the build id, plus the proposal id when
// the route has one. It writes the error response itself when it returns false.
func proposalParams(c *gin.Context, withProposal bool) (userID, buildID, proposalID uuid.UUID, ok bool) {
	if userID, ok = currentUser(c); !ok {
		return
	}
	if buildID, ok = uuidParam(c, "id"); !ok {
		return
	}
	if withProposal {
		if proposalID, ok = uuidParam(c, "pid"); !ok {
			return
		}
	}
	return userID, buildID, proposalID, true
}

func (h *ProposalHandler) respondError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, services.ErrBuildNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Build not found"})
	case errors.Is(err, services.ErrProposalNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Proposal not found"})
	case errors.Is(err, services.ErrProposalNotPending):
		c.JSON(http.StatusConflict, gin.H{"code": "not_pending", "error": "This proposal was already applied, rejected or replaced."})
	case errors.Is(err, services.ErrProposalConflict):
		c.JSON(http.StatusConflict, gin.H{"code": "proposal_conflict", "error": err.Error()})
	default:
		log.Printf("Proposal error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process the proposal: " + err.Error()})
	}
}

// SyncState is polled by an open builder to notice new proposals and saves
// made elsewhere.
func (h *ProposalHandler) SyncState(c *gin.Context) {
	userID, buildID, _, ok := proposalParams(c, false)
	if !ok {
		return
	}
	state, err := h.service.SyncState(buildID, userID)
	if err != nil {
		h.respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, state)
}

// Get returns a proposal for review, rebased on the build's latest revision.
func (h *ProposalHandler) Get(c *gin.Context) {
	userID, buildID, proposalID, ok := proposalParams(c, true)
	if !ok {
		return
	}
	proposal, err := h.service.Refresh(buildID, proposalID, userID)
	if err != nil {
		h.respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, proposal)
}

func (h *ProposalHandler) Apply(c *gin.Context) {
	userID, buildID, proposalID, ok := proposalParams(c, true)
	if !ok {
		return
	}
	build, validation, err := h.service.Apply(buildID, proposalID, userID)
	if err != nil {
		h.respondError(c, err)
		return
	}
	response := gin.H{"build": build}
	if len(validation) > 0 {
		response["validation"] = validation
	}
	c.JSON(http.StatusOK, response)
}

func (h *ProposalHandler) Reject(c *gin.Context) {
	userID, buildID, proposalID, ok := proposalParams(c, true)
	if !ok {
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	// The body is optional; an empty one rejects without a reason.
	_ = c.ShouldBindJSON(&req)
	proposal, err := h.service.Reject(buildID, proposalID, userID, req.Reason)
	if err != nil {
		h.respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, services.SummarizeProposal(proposal))
}
