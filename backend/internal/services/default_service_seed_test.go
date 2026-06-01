package services

import (
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

func TestSeedExpandedDefaultServices_IdempotentAndPublic(t *testing.T) {
	tx := testTx(t)

	if err := SeedExpandedDefaultServices(tx); err != nil {
		t.Fatalf("failed to seed default services: %v", err)
	}
	if err := SeedExpandedDefaultServices(tx); err != nil {
		t.Fatalf("failed to seed default services twice: %v", err)
	}

	seedIDs := []uuid.UUID{
		uuid.MustParse("a1000000-0000-0000-0000-000000000016"),
		uuid.MustParse("a1000000-0000-0000-0000-000000000017"),
		uuid.MustParse("a1000000-0000-0000-0000-000000000018"),
		uuid.MustParse("a1000000-0000-0000-0000-000000000019"),
		uuid.MustParse("a1000000-0000-0000-0000-000000000020"),
		uuid.MustParse("a1000000-0000-0000-0000-000000000021"),
		uuid.MustParse("a1000000-0000-0000-0000-000000000022"),
		uuid.MustParse("a1000000-0000-0000-0000-000000000023"),
		uuid.MustParse("a1000000-0000-0000-0000-000000000024"),
		uuid.MustParse("a1000000-0000-0000-0000-000000000025"),
		uuid.MustParse("a1000000-0000-0000-0000-000000000026"),
		uuid.MustParse("a1000000-0000-0000-0000-000000000027"),
		uuid.MustParse("a1000000-0000-0000-0000-000000000028"),
		uuid.MustParse("a1000000-0000-0000-0000-000000000029"),
		uuid.MustParse("a1000000-0000-0000-0000-000000000030"),
		uuid.MustParse("a1000000-0000-0000-0000-000000000031"),
		uuid.MustParse("a1000000-0000-0000-0000-000000000032"),
		uuid.MustParse("a1000000-0000-0000-0000-000000000033"),
		uuid.MustParse("a1000000-0000-0000-0000-000000000034"),
	}

	var serviceCount int64
	if err := tx.Model(&models.Service{}).
		Where("id IN ? AND visibility = ? AND user_id IS NULL AND is_active = ?", seedIDs, "public", true).
		Count(&serviceCount).Error; err != nil {
		t.Fatalf("failed to count seeded services: %v", err)
	}
	if serviceCount != int64(len(seedIDs)) {
		t.Fatalf("expected %d seeded public services, got %d", len(seedIDs), serviceCount)
	}

	var requirementCount int64
	if err := tx.Model(&models.ServiceRequirement{}).
		Where("service_id IN ?", seedIDs).
		Count(&requirementCount).Error; err != nil {
		t.Fatalf("failed to count seeded requirements: %v", err)
	}
	if requirementCount != int64(len(seedIDs)) {
		t.Fatalf("expected %d seeded requirements, got %d", len(seedIDs), requirementCount)
	}

	catalog, err := NewServiceService(tx).GetAll()
	if err != nil {
		t.Fatalf("failed to list service catalog: %v", err)
	}
	if !containsService(catalog, uuid.MustParse("a1000000-0000-0000-0000-000000000016")) {
		t.Fatalf("expected seeded WireGuard Easy to be in the public catalog")
	}
	if !containsService(catalog, uuid.MustParse("a1000000-0000-0000-0000-000000000034")) {
		t.Fatalf("expected seeded Ollama to be in the public catalog")
	}
}
