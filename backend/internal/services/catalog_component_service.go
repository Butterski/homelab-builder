package services

import (
	"encoding/json"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type CatalogComponentService struct {
	db *gorm.DB
}

func NewCatalogComponentService(db *gorm.DB) *CatalogComponentService {
	return &CatalogComponentService{db: db}
}

func (s *CatalogComponentService) GetAll() ([]models.CatalogComponent, error) {
	var comps []models.CatalogComponent
	err := s.db.Order("type, name").Find(&comps).Error
	return comps, err
}

type CreateCatalogComponentInput struct {
	Type    string          `json:"type" binding:"required"`
	Name    string          `json:"name" binding:"required"`
	Details json.RawMessage `json:"details"`
}

func (s *CatalogComponentService) Create(input CreateCatalogComponentInput) (*models.CatalogComponent, error) {
	details := json.RawMessage("{}")
	if input.Details != nil {
		details = input.Details
	}

	comp := models.CatalogComponent{
		Type:    input.Type,
		Name:    input.Name,
		Details: details,
	}

	if err := s.db.Create(&comp).Error; err != nil {
		return nil, err
	}
	return &comp, nil
}

type UpdateCatalogComponentInput struct {
	Type    *string          `json:"type"`
	Name    *string          `json:"name"`
	Details *json.RawMessage `json:"details"`
}

func (s *CatalogComponentService) Update(id uuid.UUID, input UpdateCatalogComponentInput) (*models.CatalogComponent, error) {
	var comp models.CatalogComponent
	if err := s.db.First(&comp, "id = ?", id).Error; err != nil {
		return nil, err
	}

	updates := map[string]interface{}{}
	if input.Type != nil {
		updates["type"] = *input.Type
	}
	if input.Name != nil {
		updates["name"] = *input.Name
	}
	if input.Details != nil {
		updates["details"] = *input.Details
	}

	if len(updates) > 0 {
		if err := s.db.Model(&comp).Updates(updates).Error; err != nil {
			return nil, err
		}
	}

	// Refresh from DB
	s.db.First(&comp, "id = ?", id)
	return &comp, nil
}

func (s *CatalogComponentService) Delete(id uuid.UUID) error {
	return s.db.Delete(&models.CatalogComponent{}, "id = ?", id).Error
}
