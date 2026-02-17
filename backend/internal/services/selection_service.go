package services

import (
	"fmt"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type SelectionService struct {
	db *gorm.DB
}

func NewSelectionService(db *gorm.DB) *SelectionService {
	return &SelectionService{db: db}
}

type AddSelectionInput struct {
	ServiceID uuid.UUID `json:"service_id" binding:"required"`
}

func (s *SelectionService) GetUserSelections(userID uuid.UUID) ([]models.UserSelection, error) {
	var selections []models.UserSelection
	err := s.db.Where("user_id = ?", userID).
		Preload("Service").
		Preload("Service.Requirements").
		Order("created_at DESC").
		Find(&selections).Error
	return selections, err
}

func (s *SelectionService) AddSelection(userID uuid.UUID, input AddSelectionInput) (*models.UserSelection, error) {
	// Verify service exists
	var service models.Service
	if err := s.db.First(&service, "id = ? AND is_active = ?", input.ServiceID, true).Error; err != nil {
		return nil, fmt.Errorf("service not found: %w", err)
	}

	selection := models.UserSelection{
		UserID:    userID,
		ServiceID: input.ServiceID,
	}

	if err := s.db.Create(&selection).Error; err != nil {
		return nil, fmt.Errorf("failed to add selection (may already exist): %w", err)
	}

	// Reload with service data
	s.db.Preload("Service").Preload("Service.Requirements").First(&selection, "id = ?", selection.ID)

	return &selection, nil
}

func (s *SelectionService) RemoveSelection(userID uuid.UUID, selectionID uuid.UUID) error {
	result := s.db.Where("id = ? AND user_id = ?", selectionID, userID).Delete(&models.UserSelection{})
	if result.RowsAffected == 0 {
		return fmt.Errorf("selection not found")
	}
	return result.Error
}
