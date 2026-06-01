package services

import (
	"testing"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

func TestServiceService_HardDelete(t *testing.T) {
	tx := testTx(t)
	s := NewServiceService(tx)

	svc := models.Service{
		ID:          uuid.New(),
		Name:        "Docker Test",
		Description: "Test Description",
		IsActive:    true,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	if err := tx.Create(&svc).Error; err != nil {
		t.Fatalf("Failed to setup service: %v", err)
	}

	req := models.ServiceRequirement{
		ID:           uuid.New(),
		ServiceID:    svc.ID,
		MinCPUCores:  1.0,
		MinRAMMB:     512,
		MinStorageGB: 10,
	}
	if err := tx.Create(&req).Error; err != nil {
		t.Fatalf("Failed to setup requirement: %v", err)
	}

	// HardDelete should wipe both
	if err := s.HardDelete(svc.ID); err != nil {
		t.Fatalf("HardDelete failed: %v", err)
	}

	// Verify Service is gone
	var count int64
	tx.Model(&models.Service{}).Where("id = ?", svc.ID).Count(&count)
	if count != 0 {
		t.Error("expected service to be deleted")
	}

	// Verify Requirements cascade delete
	var reqCount int64
	tx.Model(&models.ServiceRequirement{}).Where("service_id = ?", svc.ID).Count(&reqCount)
	if reqCount != 0 {
		t.Error("expected service requirement to be cascade deleted")
	}
}

func TestServiceService_CreatePrivateVisibleOnlyToOwner(t *testing.T) {
	tx := testTx(t)
	s := NewServiceService(tx)

	owner := models.User{Email: "custom_service_owner@example.com", GoogleID: "custom-service-owner", Name: "Owner"}
	other := models.User{Email: "custom_service_other@example.com", GoogleID: "custom-service-other", Name: "Other"}
	if err := tx.Create(&owner).Error; err != nil {
		t.Fatalf("failed to create owner: %v", err)
	}
	if err := tx.Create(&other).Error; err != nil {
		t.Fatalf("failed to create other user: %v", err)
	}

	publicSvc, err := s.Create(CreateServiceInput{
		Name:                 "Public Dashboard",
		Description:          "Visible to everyone",
		Category:             "management",
		Tags:                 `["dashboard"]`,
		DockerSupport:        true,
		MinRAMMB:             128,
		RecommendedRAMMB:     256,
		MinCPUCores:          0.5,
		RecommendedCPUCores:  1,
		MinStorageGB:         1,
		RecommendedStorageGB: 2,
	})
	if err != nil {
		t.Fatalf("failed to create public service: %v", err)
	}

	privateSvc, err := s.CreatePrivate(owner.ID, CreateServiceInput{
		Name:                 "My Weird Exporter",
		Description:          "Only this owner should see it",
		Category:             "monitoring",
		Tags:                 `["custom"]`,
		DockerSupport:        true,
		MinRAMMB:             64,
		RecommendedRAMMB:     128,
		MinCPUCores:          0.25,
		RecommendedCPUCores:  0.5,
		MinStorageGB:         1,
		RecommendedStorageGB: 1,
	})
	if err != nil {
		t.Fatalf("failed to create private service: %v", err)
	}
	if privateSvc.UserID == nil || *privateSvc.UserID != owner.ID {
		t.Fatalf("expected private service owner, got %+v", privateSvc.UserID)
	}
	if privateSvc.Visibility != "private" {
		t.Fatalf("expected private visibility, got %s", privateSvc.Visibility)
	}

	ownerServices, err := s.GetAllForUser(owner.ID)
	if err != nil {
		t.Fatalf("failed to list owner services: %v", err)
	}
	if !containsService(ownerServices, publicSvc.ID) || !containsService(ownerServices, privateSvc.ID) {
		t.Fatalf("expected owner to see public and private services, got %+v", ownerServices)
	}

	otherServices, err := s.GetAllForUser(other.ID)
	if err != nil {
		t.Fatalf("failed to list other services: %v", err)
	}
	if !containsService(otherServices, publicSvc.ID) {
		t.Fatalf("expected other user to see public service")
	}
	if containsService(otherServices, privateSvc.ID) {
		t.Fatalf("expected other user not to see owner's private service")
	}
}

func TestServiceService_SubmitPrivateToCommunityKeepsOwnerAccess(t *testing.T) {
	tx := testTx(t)
	s := NewServiceService(tx)

	owner := models.User{Email: "custom_service_submit@example.com", GoogleID: "custom-service-submit", Name: "Owner"}
	if err := tx.Create(&owner).Error; err != nil {
		t.Fatalf("failed to create owner: %v", err)
	}

	privateSvc, err := s.CreatePrivate(owner.ID, CreateServiceInput{
		Name:                 "Garage Door Brain",
		Description:          "Custom MQTT automation service",
		Category:             "home_automation",
		Tags:                 `["mqtt"]`,
		DockerSupport:        true,
		MinRAMMB:             128,
		RecommendedRAMMB:     256,
		MinCPUCores:          0.5,
		RecommendedCPUCores:  1,
		MinStorageGB:         1,
		RecommendedStorageGB: 2,
	})
	if err != nil {
		t.Fatalf("failed to create private service: %v", err)
	}

	submitted, err := s.SubmitPrivateToCommunity(privateSvc.ID, owner.ID)
	if err != nil {
		t.Fatalf("failed to submit service: %v", err)
	}
	if submitted.Visibility != "pending" {
		t.Fatalf("expected pending visibility, got %s", submitted.Visibility)
	}

	ownerServices, err := s.GetAllForUser(owner.ID)
	if err != nil {
		t.Fatalf("failed to list owner services: %v", err)
	}
	if !containsService(ownerServices, privateSvc.ID) {
		t.Fatalf("expected owner to keep access after submitting to community")
	}

	publicServices, err := s.GetAll()
	if err != nil {
		t.Fatalf("failed to list public services: %v", err)
	}
	if containsService(publicServices, privateSvc.ID) {
		t.Fatalf("expected pending custom service to stay out of public catalog")
	}
}

func containsService(services []models.Service, id uuid.UUID) bool {
	for _, service := range services {
		if service.ID == id {
			return true
		}
	}
	return false
}
