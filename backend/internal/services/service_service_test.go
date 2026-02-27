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
