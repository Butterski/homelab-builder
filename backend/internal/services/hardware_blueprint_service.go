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

type HardwareBlueprintReviewInput struct {
	UseCase         string          `json:"use_case"`
	Stability       string          `json:"stability"`
	Noise           string          `json:"noise"`
	Power           string          `json:"power"`
	WouldBuildAgain bool            `json:"would_build_again"`
	Tags            json.RawMessage `json:"tags"`
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

func (s *HardwareBlueprintService) ListCommunity() ([]models.HardwareBlueprint, error) {
	var blueprints []models.HardwareBlueprint
	err := s.db.Where("visibility = ?", BlueprintVisibilityCommunity).
		Order("(upvotes - downvotes) DESC, updated_at DESC").
		Find(&blueprints).Error
	if err == nil {
		s.attachFitScores(nil, blueprints)
	}
	return blueprints, err
}

func (s *HardwareBlueprintService) ListPending() ([]models.HardwareBlueprint, error) {
	return s.ListModerationQueue(BlueprintModerationPending)
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

func (s *HardwareBlueprintService) SetVisibility(blueprintID uuid.UUID, visibility string) (*models.HardwareBlueprint, error) {
	if visibility != BlueprintVisibilityPrivate &&
		visibility != BlueprintVisibilityPending &&
		visibility != BlueprintVisibilityCommunity {
		return nil, errors.New("invalid visibility")
	}

	var blueprint models.HardwareBlueprint
	if err := s.db.First(&blueprint, "id = ?", blueprintID).Error; err != nil {
		return nil, err
	}
	blueprint.Visibility = visibility
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

func (s *HardwareBlueprintService) Vote(userID, blueprintID uuid.UUID, value int) (*models.HardwareBlueprint, error) {
	if value != 1 && value != -1 && value != 0 {
		return nil, errors.New("vote must be -1, 0, or 1")
	}

	err := s.db.Transaction(func(tx *gorm.DB) error {
		var existing models.HardwareBlueprintVote
		err := tx.Where("blueprint_id = ? AND user_id = ?", blueprintID, userID).First(&existing).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		if value == 0 {
			if err == nil {
				if err := tx.Delete(&existing).Error; err != nil {
					return err
				}
			}
		} else if err == nil {
			existing.Value = value
			if err := tx.Save(&existing).Error; err != nil {
				return err
			}
		} else {
			vote := models.HardwareBlueprintVote{
				BlueprintID: blueprintID,
				UserID:      userID,
				Value:       value,
			}
			if err := tx.Create(&vote).Error; err != nil {
				return err
			}
		}

		var upvotes int64
		var downvotes int64
		if err := tx.Model(&models.HardwareBlueprintVote{}).
			Where("blueprint_id = ? AND value = 1", blueprintID).
			Count(&upvotes).Error; err != nil {
			return err
		}
		if err := tx.Model(&models.HardwareBlueprintVote{}).
			Where("blueprint_id = ? AND value = -1", blueprintID).
			Count(&downvotes).Error; err != nil {
			return err
		}
		return tx.Model(&models.HardwareBlueprint{}).
			Where("id = ?", blueprintID).
			Updates(map[string]interface{}{"upvotes": upvotes, "downvotes": downvotes}).Error
	})
	if err != nil {
		return nil, err
	}

	var blueprint models.HardwareBlueprint
	if err := s.db.First(&blueprint, "id = ?", blueprintID).Error; err != nil {
		return nil, err
	}
	return &blueprint, nil
}

func (s *HardwareBlueprintService) Review(userID, blueprintID uuid.UUID, input HardwareBlueprintReviewInput) (*models.HardwareBlueprintReview, error) {
	tags := json.RawMessage("[]")
	if len(input.Tags) > 0 {
		tags = input.Tags
	}

	var review models.HardwareBlueprintReview
	err := s.db.Where("blueprint_id = ? AND user_id = ?", blueprintID, userID).First(&review).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	review.BlueprintID = blueprintID
	review.UserID = userID
	review.UseCase = input.UseCase
	review.Stability = input.Stability
	review.Noise = input.Noise
	review.Power = input.Power
	review.WouldBuildAgain = input.WouldBuildAgain
	review.Tags = tags

	if errors.Is(err, gorm.ErrRecordNotFound) {
		if err := s.db.Create(&review).Error; err != nil {
			return nil, err
		}
	} else if err := s.db.Save(&review).Error; err != nil {
		return nil, err
	}
	return &review, nil
}
