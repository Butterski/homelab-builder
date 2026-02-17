package services

import (
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ServiceService struct {
	db *gorm.DB
}

func NewServiceService(db *gorm.DB) *ServiceService {
	return &ServiceService{db: db}
}

func (s *ServiceService) GetAll() ([]models.Service, error) {
	var services []models.Service
	err := s.db.Where("is_active = ?", true).
		Preload("Requirements").
		Order("category, name").
		Find(&services).Error
	return services, err
}

func (s *ServiceService) GetByID(id uuid.UUID) (*models.Service, error) {
	var service models.Service
	err := s.db.Preload("Requirements").First(&service, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &service, nil
}

type CreateServiceInput struct {
	Name            string  `json:"name" binding:"required"`
	Description     string  `json:"description"`
	Category        string  `json:"category" binding:"required"`
	Icon            string  `json:"icon"`
	OfficialWebsite string  `json:"official_website"`
	DockerSupport   bool    `json:"docker_support"`
	MinRAMMB        int     `json:"min_ram_mb"`
	RecommendedRAMMB int    `json:"recommended_ram_mb"`
	MinCPUCores     float32 `json:"min_cpu_cores"`
	RecommendedCPUCores float32 `json:"recommended_cpu_cores"`
	MinStorageGB    int     `json:"min_storage_gb"`
	RecommendedStorageGB int `json:"recommended_storage_gb"`
}

func (s *ServiceService) Create(input CreateServiceInput) (*models.Service, error) {
	service := models.Service{
		Name:            input.Name,
		Description:     input.Description,
		Category:        input.Category,
		Icon:            input.Icon,
		OfficialWebsite: input.OfficialWebsite,
		DockerSupport:   input.DockerSupport,
		IsActive:        true,
	}

	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&service).Error; err != nil {
			return err
		}

		req := models.ServiceRequirement{
			ServiceID:           service.ID,
			MinRAMMB:            input.MinRAMMB,
			RecommendedRAMMB:    input.RecommendedRAMMB,
			MinCPUCores:         input.MinCPUCores,
			RecommendedCPUCores: input.RecommendedCPUCores,
			MinStorageGB:        input.MinStorageGB,
			RecommendedStorageGB: input.RecommendedStorageGB,
		}
		if err := tx.Create(&req).Error; err != nil {
			return err
		}

		service.Requirements = &req
		return nil
	})

	return &service, err
}

type UpdateServiceInput struct {
	Name            *string  `json:"name"`
	Description     *string  `json:"description"`
	Category        *string  `json:"category"`
	Icon            *string  `json:"icon"`
	OfficialWebsite *string  `json:"official_website"`
	DockerSupport   *bool    `json:"docker_support"`
	MinRAMMB        *int     `json:"min_ram_mb"`
	RecommendedRAMMB *int    `json:"recommended_ram_mb"`
	MinCPUCores     *float32 `json:"min_cpu_cores"`
	RecommendedCPUCores *float32 `json:"recommended_cpu_cores"`
	MinStorageGB    *int     `json:"min_storage_gb"`
	RecommendedStorageGB *int `json:"recommended_storage_gb"`
}

func (s *ServiceService) Update(id uuid.UUID, input UpdateServiceInput) (*models.Service, error) {
	var service models.Service
	if err := s.db.First(&service, "id = ?", id).Error; err != nil {
		return nil, err
	}

	err := s.db.Transaction(func(tx *gorm.DB) error {
		serviceUpdates := map[string]interface{}{}
		if input.Name != nil {
			serviceUpdates["name"] = *input.Name
		}
		if input.Description != nil {
			serviceUpdates["description"] = *input.Description
		}
		if input.Category != nil {
			serviceUpdates["category"] = *input.Category
		}
		if input.Icon != nil {
			serviceUpdates["icon"] = *input.Icon
		}
		if input.OfficialWebsite != nil {
			serviceUpdates["official_website"] = *input.OfficialWebsite
		}
		if input.DockerSupport != nil {
			serviceUpdates["docker_support"] = *input.DockerSupport
		}

		if len(serviceUpdates) > 0 {
			if err := tx.Model(&service).Updates(serviceUpdates).Error; err != nil {
				return err
			}
		}

		reqUpdates := map[string]interface{}{}
		if input.MinRAMMB != nil {
			reqUpdates["min_ram_mb"] = *input.MinRAMMB
		}
		if input.RecommendedRAMMB != nil {
			reqUpdates["recommended_ram_mb"] = *input.RecommendedRAMMB
		}
		if input.MinCPUCores != nil {
			reqUpdates["min_cpu_cores"] = *input.MinCPUCores
		}
		if input.RecommendedCPUCores != nil {
			reqUpdates["recommended_cpu_cores"] = *input.RecommendedCPUCores
		}
		if input.MinStorageGB != nil {
			reqUpdates["min_storage_gb"] = *input.MinStorageGB
		}
		if input.RecommendedStorageGB != nil {
			reqUpdates["recommended_storage_gb"] = *input.RecommendedStorageGB
		}

		if len(reqUpdates) > 0 {
			if err := tx.Model(&models.ServiceRequirement{}).
				Where("service_id = ?", id).
				Updates(reqUpdates).Error; err != nil {
				return err
			}
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return s.GetByID(id)
}

func (s *ServiceService) Delete(id uuid.UUID) error {
	return s.db.Model(&models.Service{}).
		Where("id = ?", id).
		Update("is_active", false).Error
}
