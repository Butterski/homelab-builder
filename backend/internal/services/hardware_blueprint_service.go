package services

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	BlueprintVisibilityPrivate   = "private"
	BlueprintVisibilityPending   = "pending"
	BlueprintVisibilityCommunity = "community"

	BlueprintModerationNone     = "none"
	BlueprintModerationPending  = "pending"
	BlueprintModerationApproved = "approved"
	BlueprintModerationRejected = "rejected"
)

type HardwareBlueprintService struct {
	db *gorm.DB
}

func NewHardwareBlueprintService(db *gorm.DB) *HardwareBlueprintService {
	return &HardwareBlueprintService{db: db}
}

type HardwareBlueprintInput struct {
	Name        string          `json:"name" binding:"required"`
	Description string          `json:"description"`
	Category    string          `json:"category" binding:"required"`
	NodeType    string          `json:"node_type"`
	Tags        json.RawMessage `json:"tags"`
	NodeData    json.RawMessage `json:"node_data"`
	Services    json.RawMessage `json:"services"`
}

type HardwareBlueprintModerationInput struct {
	Action string `json:"action"`
	Note   string `json:"note"`
}

func (s *HardwareBlueprintService) Create(userID uuid.UUID, input HardwareBlueprintInput) (*models.HardwareBlueprint, error) {
	tags := json.RawMessage("[]")
	if len(input.Tags) > 0 {
		tags = input.Tags
	}
	nodeData := json.RawMessage("{}")
	if len(input.NodeData) > 0 {
		nodeData = input.NodeData
	}
	services := json.RawMessage("[]")
	if len(input.Services) > 0 {
		services = input.Services
	}

	category := NormalizeHardwareCategory(input.Category)
	nodeType := input.NodeType
	if nodeType == "" {
		nodeType = HardwareCategoryToNodeType(category)
	}

	blueprint := models.HardwareBlueprint{
		UserID:           userID,
		Name:             input.Name,
		Description:      input.Description,
		Category:         category,
		NodeType:         nodeType,
		Visibility:       BlueprintVisibilityPrivate,
		ModerationStatus: BlueprintModerationNone,
		Tags:             tags,
		NodeData:         nodeData,
		Services:         services,
	}
	if err := s.db.Create(&blueprint).Error; err != nil {
		return nil, err
	}
	blueprints := []models.HardwareBlueprint{blueprint}
	s.attachFitScores(&userID, blueprints)
	return &blueprints[0], nil
}

func (s *HardwareBlueprintService) ListMine(userID uuid.UUID) ([]models.HardwareBlueprint, error) {
	var blueprints []models.HardwareBlueprint
	err := s.db.Where("user_id = ?", userID).
		Order("updated_at DESC, name").
		Find(&blueprints).Error
	if err == nil {
		s.attachFitScores(&userID, blueprints)
	}
	return blueprints, err
}

func (s *HardwareBlueprintService) ListModerationQueue(status string) ([]models.HardwareBlueprint, error) {
	var blueprints []models.HardwareBlueprint
	query := s.db.Model(&models.HardwareBlueprint{})
	if status != "" && status != "all" {
		query = query.Where("moderation_status = ?", status)
	}
	err := query.
		Order("updated_at DESC").
		Find(&blueprints).Error
	if err == nil {
		s.attachFitScores(nil, blueprints)
	}
	return blueprints, err
}

func (s *HardwareBlueprintService) SubmitToCommunity(userID, blueprintID uuid.UUID) (*models.HardwareBlueprint, error) {
	var blueprint models.HardwareBlueprint
	if err := s.db.First(&blueprint, "id = ? AND user_id = ?", blueprintID, userID).Error; err != nil {
		return nil, err
	}
	blueprint.Visibility = BlueprintVisibilityPending
	blueprint.ModerationStatus = BlueprintModerationPending
	blueprint.ModerationNote = ""
	blueprint.ReviewedBy = nil
	blueprint.ReviewedAt = nil
	if err := s.db.Save(&blueprint).Error; err != nil {
		return nil, err
	}
	return &blueprint, nil
}

func (s *HardwareBlueprintService) Moderate(blueprintID, reviewerID uuid.UUID, input HardwareBlueprintModerationInput) (*models.HardwareBlueprint, error) {
	var blueprint models.HardwareBlueprint
	if err := s.db.First(&blueprint, "id = ?", blueprintID).Error; err != nil {
		return nil, err
	}

	now := time.Now()
	switch input.Action {
	case "approve", BlueprintModerationApproved:
		blueprint.Visibility = BlueprintVisibilityCommunity
		blueprint.ModerationStatus = BlueprintModerationApproved
	case "reject", BlueprintModerationRejected:
		blueprint.Visibility = BlueprintVisibilityPrivate
		blueprint.ModerationStatus = BlueprintModerationRejected
	case BlueprintModerationPending:
		blueprint.Visibility = BlueprintVisibilityPending
		blueprint.ModerationStatus = BlueprintModerationPending
	default:
		return nil, errors.New("moderation action must be approve, reject, or pending")
	}

	blueprint.ModerationNote = input.Note
	blueprint.ReviewedBy = &reviewerID
	blueprint.ReviewedAt = &now
	if err := s.db.Save(&blueprint).Error; err != nil {
		return nil, err
	}
	blueprints := []models.HardwareBlueprint{blueprint}
	s.attachFitScores(nil, blueprints)
	return &blueprints[0], nil
}
