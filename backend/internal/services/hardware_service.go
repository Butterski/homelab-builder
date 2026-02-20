package services

import (
	"encoding/json"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type HardwareService struct {
	db *gorm.DB
}

func NewHardwareService(db *gorm.DB) *HardwareService {
	return &HardwareService{db: db}
}

type HardwareFilter struct {
	Category string
	Brand    string
	Search   string
	MinPrice float64
	MaxPrice float64
	Approved *bool
	Limit    int
	Offset   int
}

type HardwareListResult struct {
	Data  []models.HardwareComponent `json:"data"`
	Total int64                      `json:"total"`
}

func (s *HardwareService) GetAll(f HardwareFilter) (*HardwareListResult, error) {
	q := s.db.Model(&models.HardwareComponent{})

	if f.Category != "" {
		q = q.Where("category = ?", f.Category)
	}
	if f.Brand != "" {
		q = q.Where("LOWER(brand) = LOWER(?)", f.Brand)
	}
	if f.Search != "" {
		like := "%" + strings.ToLower(f.Search) + "%"
		q = q.Where("LOWER(brand) LIKE ? OR LOWER(model) LIKE ?", like, like)
	}
	if f.MinPrice > 0 {
		q = q.Where("price_est >= ?", f.MinPrice)
	}
	if f.MaxPrice > 0 {
		q = q.Where("price_est <= ?", f.MaxPrice)
	}
	if f.Approved != nil {
		q = q.Where("approved = ?", *f.Approved)
	} else {
		// Default: only show approved
		q = q.Where("approved = true")
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, err
	}

	limit := f.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	var items []models.HardwareComponent
	err := q.Order("category, brand, model").
		Limit(limit).
		Offset(f.Offset).
		Find(&items).Error
	if err != nil {
		return nil, err
	}

	return &HardwareListResult{Data: items, Total: total}, nil
}

func (s *HardwareService) GetByID(id uuid.UUID) (*models.HardwareComponent, error) {
	var c models.HardwareComponent
	if err := s.db.First(&c, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *HardwareService) GetCategories() ([]string, error) {
	var cats []string
	err := s.db.Model(&models.HardwareComponent{}).
		Where("approved = true").
		Distinct("category").
		Order("category").
		Pluck("category", &cats).Error
	return cats, err
}

func (s *HardwareService) GetBrands(category string) ([]string, error) {
	q := s.db.Model(&models.HardwareComponent{}).Where("approved = true")
	if category != "" {
		q = q.Where("category = ?", category)
	}
	var brands []string
	err := q.Distinct("brand").Order("brand").Pluck("brand", &brands).Error
	return brands, err
}

type CreateHardwareInput struct {
	Category string          `json:"category" binding:"required"`
	Brand    string          `json:"brand" binding:"required"`
	Model    string          `json:"model" binding:"required"`
	Spec     json.RawMessage `json:"spec"`
	PriceEst float64         `json:"price_est"`
	Currency string          `json:"currency"`
	BuyURLs  json.RawMessage `json:"buy_urls"`
	ImageURL string          `json:"image_url"`
}

func (s *HardwareService) Create(input CreateHardwareInput, submittedBy *uuid.UUID, autoApprove bool) (*models.HardwareComponent, error) {
	spec := json.RawMessage("{}")
	if input.Spec != nil {
		spec = input.Spec
	}
	buyURLs := json.RawMessage("[]")
	if input.BuyURLs != nil {
		buyURLs = input.BuyURLs
	}
	currency := input.Currency
	if currency == "" {
		currency = "EUR"
	}

	c := models.HardwareComponent{
		Category:    input.Category,
		Brand:       input.Brand,
		Model:       input.Model,
		Spec:        spec,
		PriceEst:    input.PriceEst,
		Currency:    currency,
		BuyURLs:     buyURLs,
		ImageURL:    input.ImageURL,
		SubmittedBy: submittedBy,
		Approved:    autoApprove,
	}
	if err := s.db.Create(&c).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *HardwareService) Update(id uuid.UUID, input CreateHardwareInput) (*models.HardwareComponent, error) {
	var c models.HardwareComponent
	if err := s.db.First(&c, "id = ?", id).Error; err != nil {
		return nil, err
	}
	spec := c.Spec
	if input.Spec != nil {
		spec = input.Spec
	}
	buyURLs := c.BuyURLs
	if input.BuyURLs != nil {
		buyURLs = input.BuyURLs
	}
	c.Category = input.Category
	c.Brand = input.Brand
	c.Model = input.Model
	c.Spec = spec
	c.PriceEst = input.PriceEst
	c.Currency = input.Currency
	c.BuyURLs = buyURLs
	c.ImageURL = input.ImageURL
	if err := s.db.Save(&c).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *HardwareService) Approve(id uuid.UUID, approved bool) error {
	return s.db.Model(&models.HardwareComponent{}).
		Where("id = ?", id).
		Update("approved", approved).Error
}

func (s *HardwareService) Delete(id uuid.UUID) error {
	return s.db.Delete(&models.HardwareComponent{}, "id = ?", id).Error
}

func (s *HardwareService) Like(id uuid.UUID) error {
	return s.db.Model(&models.HardwareComponent{}).
		Where("id = ?", id).
		UpdateColumn("likes", gorm.Expr("likes + 1")).Error
}

// BulkImport inserts many components at once (admin only)
func (s *HardwareService) BulkImport(items []CreateHardwareInput, submittedBy *uuid.UUID) (int, error) {
	var components []models.HardwareComponent
	for _, input := range items {
		spec := json.RawMessage("{}")
		if input.Spec != nil {
			spec = input.Spec
		}
		buyURLs := json.RawMessage("[]")
		if input.BuyURLs != nil {
			buyURLs = input.BuyURLs
		}
		currency := input.Currency
		if currency == "" {
			currency = "EUR"
		}
		components = append(components, models.HardwareComponent{
			Category:    input.Category,
			Brand:       input.Brand,
			Model:       input.Model,
			Spec:        spec,
			PriceEst:    input.PriceEst,
			Currency:    currency,
			BuyURLs:     buyURLs,
			ImageURL:    input.ImageURL,
			SubmittedBy: submittedBy,
			Approved:    true,
		})
	}
	if err := s.db.CreateInBatches(&components, 50).Error; err != nil {
		return 0, err
	}
	return len(components), nil
}
