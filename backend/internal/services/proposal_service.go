package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	ProposalPending    = "pending"
	ProposalApplied    = "applied"
	ProposalRejected   = "rejected"
	ProposalSuperseded = "superseded"
	ProposalConflict   = "conflict"

	ProposalSourceMCP  = "mcp"
	ProposalSourceChat = "chat"

	maxProposalSummaryLength = 500
	// keptResolvedProposals bounds the per-build history of settled proposals.
	keptResolvedProposals = 20
)

var (
	ErrProposalNotFound   = errors.New("proposal not found")
	ErrProposalNotPending = errors.New("proposal is no longer pending")
	// ErrProposalConflict means the build changed so the proposal no longer applies.
	ErrProposalConflict = errors.New("proposal conflicts with the current build")
)

// ProposalService stages LLM-suggested changes. Nothing reaches a build until
// its owner applies the proposal.
type ProposalService struct {
	db      *gorm.DB
	builds  *BuildService
	ip      *IPService
	catalog CatalogLookup
}

func NewProposalService(db *gorm.DB, builds *BuildService, ip *IPService) *ProposalService {
	return &ProposalService{db: db, builds: builds, ip: ip, catalog: dbCatalog{db: db}}
}

type ProposeInput struct {
	BuildID     uuid.UUID
	UserID      uuid.UUID
	Source      string
	SourceLabel string
	Summary     string
	TokenID     *uuid.UUID
	ThreadID    *uuid.UUID
	Ops         []TopologyOp
}

// ProposalSummary is the light view used by lists and the builder's poll.
type ProposalSummary struct {
	ID              uuid.UUID  `json:"id"`
	BuildID         uuid.UUID  `json:"build_id"`
	Summary         string     `json:"summary"`
	Source          string     `json:"source"`
	SourceLabel     string     `json:"source_label"`
	Status          string     `json:"status"`
	StatusReason    string     `json:"status_reason,omitempty"`
	Counts          DiffCounts `json:"counts"`
	BaseRevision    uint64     `json:"base_revision"`
	AppliedRevision *uint64    `json:"applied_revision,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	ResolvedAt      *time.Time `json:"resolved_at,omitempty"`
}

// SyncState is what an open builder polls to notice outside changes.
type SyncState struct {
	Revision  uint64            `json:"revision"`
	UpdatedAt time.Time         `json:"updated_at"`
	Pending   *ProposalSummary  `json:"pending"`
	Recent    []ProposalSummary `json:"recent"`
}

// ProposalPreview is the stored dry-run result: the build as it would look.
type ProposalPreview struct {
	Build      *models.Build   `json:"build"`
	Validation json.RawMessage `json:"validation,omitempty"`
}

func SummarizeProposal(proposal *models.BuildProposal) ProposalSummary {
	var diff struct {
		Counts DiffCounts `json:"counts"`
	}
	_ = json.Unmarshal(proposal.Diff, &diff)
	return ProposalSummary{
		ID: proposal.ID, BuildID: proposal.BuildID, Summary: proposal.Summary,
		Source: proposal.Source, SourceLabel: proposal.SourceLabel,
		Status: proposal.Status, StatusReason: proposal.StatusReason, Counts: diff.Counts,
		BaseRevision: proposal.BaseRevision, AppliedRevision: proposal.AppliedRevision,
		CreatedAt: proposal.CreatedAt, ResolvedAt: proposal.ResolvedAt,
	}
}

// Propose validates ops against the current build with a dry run and stores
// them as the build's pending proposal. The build itself is not modified.
func (s *ProposalService) Propose(in ProposeInput) (*models.BuildProposal, error) {
	// Created ids are assigned by the server; never trust ids from the caller.
	ops := make([]TopologyOp, len(in.Ops))
	for i, op := range in.Ops {
		op.ID = ""
		ops[i] = op
	}

	var (
		build   *models.Build
		applied *AppliedTopology
		preview *TopologyPreview
		err     error
	)
	// A save can land between reading the build and the dry run; read again once.
	for attempt := 0; attempt < 2; attempt++ {
		if build, err = s.builds.GetOwned(in.BuildID, in.UserID); err != nil {
			return nil, err
		}
		input, convertErr := BuildToSyncInput(build)
		if convertErr != nil {
			return nil, convertErr
		}
		if applied, err = ApplyTopologyOps(input, ops, s.applyOptions(in.UserID)); err != nil {
			return nil, err
		}
		preview, err = s.builds.PreviewTopology(in.BuildID, in.UserID, applied.Input, s.ip)
		if !errors.Is(err, ErrBuildRevisionConflict) {
			break
		}
	}
	if err != nil {
		return nil, err
	}

	diff := DiffBuilds(build, preview.Build)
	if diff.Counts.Total == 0 {
		return nil, &OpError{Index: -1, Message: noChangeMessage}
	}
	summary := strings.TrimSpace(in.Summary)
	if summary == "" {
		summary = diff.Counts.Summary()
	}
	if runes := []rune(summary); len(runes) > maxProposalSummaryLength {
		summary = string(runes[:maxProposalSummaryLength])
	}

	operations, err := json.Marshal(applied.Resolved)
	if err != nil {
		return nil, err
	}
	// Thumbnails are large and irrelevant to a preview.
	preview.Build.Thumbnail = ""
	previewJSON, err := json.Marshal(ProposalPreview{Build: preview.Build, Validation: preview.Validation})
	if err != nil {
		return nil, err
	}

	proposal := &models.BuildProposal{
		BuildID: in.BuildID, UserID: in.UserID,
		Source: in.Source, SourceLabel: strings.TrimSpace(in.SourceLabel),
		TokenID: in.TokenID, ThreadID: in.ThreadID,
		Summary: summary, Operations: operations, BaseRevision: build.Revision,
		Diff: marshalDiff(diff), Preview: previewJSON, Status: ProposalPending,
	}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		if err := tx.Model(&models.BuildProposal{}).
			Where("build_id = ? AND status = ?", in.BuildID, ProposalPending).
			Updates(map[string]any{"status": ProposalSuperseded, "status_reason": "Replaced by a newer proposal", "resolved_at": now}).Error; err != nil {
			return err
		}
		if err := tx.Create(proposal).Error; err != nil {
			return err
		}
		return s.pruneResolved(tx, in.BuildID)
	})
	if err != nil {
		return nil, err
	}
	RecordEvent(s.db, &in.UserID, "proposal.created", map[string]any{
		"proposal_id": proposal.ID, "build_id": in.BuildID, "source": in.Source, "changes": diff.Counts.Total,
	})
	return proposal, nil
}

// pruneResolved drops the oldest settled proposals of a build beyond the cap.
func (s *ProposalService) pruneResolved(tx *gorm.DB, buildID uuid.UUID) error {
	var stale []uuid.UUID
	if err := tx.Model(&models.BuildProposal{}).
		Where("build_id = ? AND status <> ?", buildID, ProposalPending).
		Order("created_at desc").Offset(keptResolvedProposals).Limit(500).
		Pluck("id", &stale).Error; err != nil {
		return err
	}
	if len(stale) == 0 {
		return nil
	}
	return tx.Where("id IN ?", stale).Delete(&models.BuildProposal{}).Error
}

// Get returns a proposal of a build the user owns.
func (s *ProposalService) Get(buildID, proposalID, userID uuid.UUID) (*models.BuildProposal, error) {
	var proposal models.BuildProposal
	err := s.db.First(&proposal, "id = ? AND build_id = ? AND user_id = ?", proposalID, buildID, userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrProposalNotFound
	}
	if err != nil {
		return nil, err
	}
	return &proposal, nil
}

// Refresh returns a proposal for review. When the build was saved after a
// pending proposal was created, its preview and diff are recalculated against
// the latest revision, so the owner reviews exactly what Apply would write. A
// proposal that no longer fits the build is marked as a conflict.
func (s *ProposalService) Refresh(buildID, proposalID, userID uuid.UUID) (*models.BuildProposal, error) {
	proposal, err := s.Get(buildID, proposalID, userID)
	if err != nil || proposal.Status != ProposalPending {
		return proposal, err
	}
	build, err := s.builds.GetOwned(buildID, userID)
	if err != nil {
		return nil, err
	}
	if build.Revision == proposal.BaseRevision {
		return proposal, nil
	}
	input, err := BuildToSyncInput(build)
	if err != nil {
		return nil, err
	}
	var ops []TopologyOp
	if err := json.Unmarshal(proposal.Operations, &ops); err != nil {
		return nil, err
	}

	var preview *TopologyPreview
	applied, err := ApplyTopologyOps(input, ops, s.applyOptions(userID))
	if err == nil {
		preview, err = s.builds.PreviewTopology(buildID, userID, applied.Input, s.ip)
	}
	pendingRow := s.db.Model(&models.BuildProposal{}).Where("id = ? AND status = ?", proposal.ID, ProposalPending)
	switch {
	case errors.Is(err, ErrBuildRevisionConflict):
		// A save landed mid-refresh; the stored preview is shown and the next
		// review picks the change up.
		return proposal, nil
	case err != nil && isTopologyRejection(err):
		if err := pendingRow.Updates(map[string]any{
			"status": ProposalConflict, "status_reason": conflictReason(err), "resolved_at": time.Now(),
		}).Error; err != nil {
			return nil, err
		}
		return s.Get(buildID, proposalID, userID)
	case err != nil:
		return nil, err
	}

	preview.Build.Thumbnail = ""
	previewJSON, err := json.Marshal(ProposalPreview{Build: preview.Build, Validation: preview.Validation})
	if err != nil {
		return nil, err
	}
	if err := pendingRow.Updates(map[string]any{
		"diff": marshalDiff(DiffBuilds(build, preview.Build)), "preview": previewJSON, "base_revision": build.Revision,
	}).Error; err != nil {
		return nil, err
	}
	return s.Get(buildID, proposalID, userID)
}

// GetForUser finds a proposal by id alone, for callers that only hold its id.
func (s *ProposalService) GetForUser(proposalID, userID uuid.UUID) (*models.BuildProposal, error) {
	var proposal models.BuildProposal
	err := s.db.First(&proposal, "id = ? AND user_id = ?", proposalID, userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrProposalNotFound
	}
	if err != nil {
		return nil, err
	}
	return &proposal, nil
}

// List returns light summaries of a build's proposals, newest first.
func (s *ProposalService) List(buildID, userID uuid.UUID, limit int) ([]ProposalSummary, error) {
	if limit <= 0 || limit > keptResolvedProposals+1 {
		limit = keptResolvedProposals + 1
	}
	return s.summaries(s.db.Where("build_id = ? AND user_id = ?", buildID, userID).
		Order("created_at desc").Limit(limit))
}

// SyncState reports the build revision and its proposals with two small queries.
func (s *ProposalService) SyncState(buildID, userID uuid.UUID) (*SyncState, error) {
	var build models.Build
	err := s.db.Select("id", "user_id", "revision", "updated_at").First(&build, "id = ?", buildID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && build.UserID != userID) {
		return nil, ErrBuildNotFound
	}
	if err != nil {
		return nil, err
	}
	summaries, err := s.List(buildID, userID, 4)
	if err != nil {
		return nil, err
	}
	state := &SyncState{Revision: build.Revision, UpdatedAt: build.UpdatedAt, Recent: []ProposalSummary{}}
	for i := range summaries {
		if summaries[i].Status == ProposalPending && state.Pending == nil {
			pending := summaries[i]
			state.Pending = &pending
			continue
		}
		if len(state.Recent) < 3 {
			state.Recent = append(state.Recent, summaries[i])
		}
	}
	return state, nil
}

// Apply writes a pending proposal to its build. The operations are replayed on
// the latest revision, so edits made after the proposal was created are kept.
func (s *ProposalService) Apply(buildID, proposalID, userID uuid.UUID) (*models.Build, json.RawMessage, error) {
	var conflict error
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var proposal models.BuildProposal
		if err := lockPending(tx, &proposal, buildID, proposalID, userID); err != nil {
			return err
		}
		// Lock the build before reading it so a concurrent autosave cannot slip
		// in between the read and the save below.
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").
			First(&models.Build{}, "id = ? AND user_id = ?", buildID, userID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrBuildNotFound
			}
			return err
		}
		build, err := s.builds.withDB(tx).GetOwned(buildID, userID)
		if err != nil {
			return err
		}
		input, err := BuildToSyncInput(build)
		if err != nil {
			return err
		}
		var ops []TopologyOp
		if err := json.Unmarshal(proposal.Operations, &ops); err != nil {
			return err
		}

		applied, applyErr := ApplyTopologyOps(input, ops, s.applyOptions(userID))
		if applyErr == nil {
			// The savepoint keeps a failed save from poisoning the outer
			// transaction, which still has to record the conflict.
			applyErr = tx.Transaction(func(inner *gorm.DB) error {
				return s.builds.SaveAndCalculateTx(inner, buildID, userID, applied.Input, s.ip)
			})
		}
		now := time.Now()
		if applyErr != nil {
			if !isTopologyRejection(applyErr) {
				return applyErr
			}
			conflict = applyErr
			return tx.Model(&proposal).Updates(map[string]any{
				"status": ProposalConflict, "status_reason": conflictReason(applyErr), "resolved_at": now,
			}).Error
		}
		appliedRevision := build.Revision + 1
		return tx.Model(&proposal).Updates(map[string]any{
			"status": ProposalApplied, "status_reason": "", "applied_revision": appliedRevision, "resolved_at": now,
		}).Error
	})
	if err != nil {
		return nil, nil, err
	}
	if conflict != nil {
		RecordEvent(s.db, &userID, "proposal.conflict", map[string]any{"proposal_id": proposalID, "build_id": buildID})
		return nil, nil, fmt.Errorf("%w: %s", ErrProposalConflict, conflictReason(conflict))
	}

	build, err := s.builds.GetByID(buildID)
	if err != nil {
		return nil, nil, err
	}
	RecordEvent(s.db, &userID, "proposal.applied", map[string]any{"proposal_id": proposalID, "build_id": buildID, "revision": build.Revision})
	// The save is committed; a failed validation call must not undo that.
	validation, _ := s.ip.ValidateNetwork(buildID)
	return build, validation, nil
}

// Reject closes a pending proposal without touching the build.
func (s *ProposalService) Reject(buildID, proposalID, userID uuid.UUID, reason string) (*models.BuildProposal, error) {
	reason = strings.TrimSpace(reason)
	if runes := []rune(reason); len(runes) > maxProposalSummaryLength {
		reason = string(runes[:maxProposalSummaryLength])
	}
	var proposal models.BuildProposal
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := lockPending(tx, &proposal, buildID, proposalID, userID); err != nil {
			return err
		}
		now := time.Now()
		proposal.Status, proposal.StatusReason, proposal.ResolvedAt = ProposalRejected, reason, &now
		return tx.Model(&proposal).Updates(map[string]any{
			"status": ProposalRejected, "status_reason": reason, "resolved_at": now,
		}).Error
	})
	if err != nil {
		return nil, err
	}
	RecordEvent(s.db, &userID, "proposal.rejected", map[string]any{"proposal_id": proposalID, "build_id": buildID})
	return &proposal, nil
}

// ResolvedForThread lists proposals of an assistant thread settled after since,
// so the next chat turn can tell the model what the user decided.
func (s *ProposalService) ResolvedForThread(threadID uuid.UUID, since time.Time) ([]ProposalSummary, error) {
	return s.summaries(s.db.Where("thread_id = ? AND status <> ? AND resolved_at > ?", threadID, ProposalPending, since).
		Order("resolved_at asc").Limit(10))
}

// lockPending locks a proposal of the build for update and refuses one that
// is already resolved.
func lockPending(tx *gorm.DB, proposal *models.BuildProposal, buildID, proposalID, userID uuid.UUID) error {
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		First(proposal, "id = ? AND build_id = ? AND user_id = ?", proposalID, buildID, userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrProposalNotFound
	}
	if err != nil {
		return err
	}
	if proposal.Status != ProposalPending {
		return ErrProposalNotPending
	}
	return nil
}

// summaries runs query over the summary columns only; the operations stay unread.
func (s *ProposalService) summaries(query *gorm.DB) ([]ProposalSummary, error) {
	var proposals []models.BuildProposal
	err := query.Select("id", "build_id", "summary", "source", "source_label", "status", "status_reason",
		"diff", "base_revision", "applied_revision", "created_at", "resolved_at").Find(&proposals).Error
	if err != nil {
		return nil, err
	}
	summaries := make([]ProposalSummary, 0, len(proposals))
	for i := range proposals {
		summaries = append(summaries, SummarizeProposal(&proposals[i]))
	}
	return summaries, nil
}

func (s *ProposalService) applyOptions(userID uuid.UUID) ApplyOptions {
	return ApplyOptions{Catalog: s.catalog, UserID: userID, AllowLoops: s.userIgnoresLoops(userID)}
}

// userIgnoresLoops reads the builder's "ignore network loops" preference.
func (s *ProposalService) userIgnoresLoops(userID uuid.UUID) bool {
	var user models.User
	if err := s.db.Select("id", "preferences").First(&user, "id = ?", userID).Error; err != nil {
		return false
	}
	var preferences struct {
		EdgePreferences struct {
			IgnoreNetworkLoops bool `json:"ignoreNetworkLoops"`
		} `json:"edgePreferences"`
	}
	_ = json.Unmarshal(user.Preferences, &preferences)
	return preferences.EdgePreferences.IgnoreNetworkLoops
}

// noChangeMessage is what a change set is refused with when the build would
// look the same after it.
const noChangeMessage = "the operations do not change the build"

// isNoChange reports a change set that was refused because it changes nothing.
func isNoChange(err error) bool {
	var opErr *OpError
	return errors.As(err, &opErr) && opErr.Index < 0 && opErr.Message == noChangeMessage
}

// isTopologyRejection reports errors caused by the change set itself rather
// than by the infrastructure.
func isTopologyRejection(err error) bool {
	return errors.Is(err, ErrInvalidOperations) || errors.Is(err, ErrInvalidTopology) || errors.Is(err, ErrInvalidEdgeReferences)
}

// IsTopologyRejection is isTopologyRejection for callers outside the package.
func IsTopologyRejection(err error) bool { return isTopologyRejection(err) }

func conflictReason(err error) string {
	var opErr *OpError
	if errors.As(err, &opErr) {
		return opErr.Error()
	}
	return err.Error()
}

// RecordEvent appends an audit row. Failures are ignored: auditing must never
// break the action it records.
func RecordEvent(db *gorm.DB, userID *uuid.UUID, eventType string, payload map[string]any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		raw = []byte("{}")
	}
	_ = db.Create(&models.Event{UserID: userID, EventType: eventType, Payload: string(raw)}).Error
}

// dbCatalog resolves catalog shortcuts against the database.
type dbCatalog struct{ db *gorm.DB }

func (c dbCatalog) HardwareByID(id uuid.UUID) (*models.HardwareComponent, error) {
	var hardware models.HardwareComponent
	if err := c.db.First(&hardware, "id = ? AND approved = true", id).Error; err != nil {
		return nil, err
	}
	return &hardware, nil
}

func (c dbCatalog) ServiceForUser(id, userID uuid.UUID) (*models.Service, error) {
	var service models.Service
	err := c.db.Preload("Requirements").
		Where("id = ? AND is_active = ? AND ((user_id IS NULL AND visibility = ?) OR user_id = ?)", id, true, "public", userID).
		First(&service).Error
	if err != nil {
		return nil, err
	}
	return &service, nil
}
