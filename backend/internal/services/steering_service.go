package services

import (
	"encoding/json"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"gorm.io/gorm"
)

type SteeringService struct {
	db *gorm.DB
}

func NewSteeringService(db *gorm.DB) *SteeringService {
	return &SteeringService{db: db}
}

func (s *SteeringService) GetAll() ([]models.SteeringRule, error) {
	var rules []models.SteeringRule
	if err := s.db.Order("category").Find(&rules).Error; err != nil {
		return nil, err
	}
	return rules, nil
}

func (s *SteeringService) GetByCategory(category string) (*models.SteeringRule, error) {
	var rule models.SteeringRule
	if err := s.db.First(&rule, "category = ?", category).Error; err != nil {
		return nil, err
	}
	return &rule, nil
}

type UpsertSteeringRuleInput struct {
	RetailerOrder json.RawMessage `json:"retailer_order" binding:"required"`
}

func (s *SteeringService) Upsert(category string, input UpsertSteeringRuleInput) (*models.SteeringRule, error) {
	var rule models.SteeringRule
	err := s.db.Where(models.SteeringRule{Category: category}).
		Assign(models.SteeringRule{RetailerOrder: input.RetailerOrder}).
		FirstOrCreate(&rule).Error

	if err != nil {
		return nil, err
	}
	return &rule, nil
}

func (s *SteeringService) Delete(category string) error {
	return s.db.Delete(&models.SteeringRule{}, "category = ?", category).Error
}
