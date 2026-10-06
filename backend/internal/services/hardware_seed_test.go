package services

import (
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/models"
)

func TestSeedDefaultHardware_IdempotentAndApproved(t *testing.T) {
	tx := testTx(t)
	seeds, err := loadHardwareSeeds()
	if err != nil {
		t.Fatalf("load seeds: %v", err)
	}
	if len(seeds) < 101 {
		t.Fatalf("expected at least the 101 ported components, got %d", len(seeds))
	}

	var before int64
	tx.Model(&models.HardwareComponent{}).Count(&before)

	if err := SeedDefaultHardware(tx); err != nil {
		t.Fatalf("seed hardware: %v", err)
	}
	var afterFirst int64
	tx.Model(&models.HardwareComponent{}).Count(&afterFirst)
	if afterFirst-before != int64(len(seeds)) {
		t.Fatalf("expected %d new components, got %d", len(seeds), afterFirst-before)
	}

	if err := SeedDefaultHardware(tx); err != nil {
		t.Fatalf("seed hardware twice: %v", err)
	}
	var afterSecond int64
	tx.Model(&models.HardwareComponent{}).Count(&afterSecond)
	if afterSecond != afterFirst {
		t.Fatalf("second seed added rows: %d -> %d", afterFirst, afterSecond)
	}

	var unapproved int64
	tx.Model(&models.HardwareComponent{}).Where("approved IS NOT TRUE").Count(&unapproved)
	if unapproved != 0 {
		t.Fatalf("expected every seeded component to be approved, %d are not", unapproved)
	}

	for _, category := range []string{"pc", "console", "switch", "gpu", "router", "server"} {
		var count int64
		tx.Model(&models.HardwareComponent{}).Where("category = ?", category).Count(&count)
		if count == 0 {
			t.Errorf("expected seeded components in category %q", category)
		}
	}

	// The public catalog only lists approved rows, so this is what a fresh install shows.
	approved := true
	listed, err := NewHardwareService(tx).GetAll(HardwareFilter{Category: "consoles", Approved: &approved})
	if err != nil {
		t.Fatalf("list consoles: %v", err)
	}
	if listed.Total == 0 || len(listed.Data) == 0 {
		t.Fatalf("expected consoles in the public catalog")
	}
	for _, component := range listed.Data {
		if component.PowerDraw <= 0 {
			t.Errorf("%s %s has no power draw", component.Brand, component.Model)
		}
	}
}

func TestSeedDefaultHardware_KeepsAnExistingListing(t *testing.T) {
	tx := testTx(t)
	approved := true
	edited := models.HardwareComponent{Category: "console", Brand: "Sony", Model: "PlayStation 5 (Slim)", PriceEst: 1, Approved: &approved}
	if err := tx.Create(&edited).Error; err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := SeedDefaultHardware(tx); err != nil {
		t.Fatalf("seed hardware: %v", err)
	}

	var rows []models.HardwareComponent
	tx.Where("category = ? AND brand = ? AND model = ?", "console", "Sony", "PlayStation 5 (Slim)").Find(&rows)
	if len(rows) != 1 || rows[0].PriceEst != 1 {
		t.Fatalf("expected the existing listing to be kept as is, got %+v", rows)
	}
}

func TestModels_CoverEveryCatalogTable(t *testing.T) {
	tx := testTx(t)
	// Both tables were once missing from database.Models(), which only showed on a fresh install.
	if err := tx.Create(&models.SteeringRule{Category: "seed-check"}).Error; err != nil {
		t.Fatalf("steering_rules is not migrated: %v", err)
	}
	if err := tx.Create(&models.CatalogComponent{Type: "disk", Name: "seed-check"}).Error; err != nil {
		t.Fatalf("catalog_components is not migrated: %v", err)
	}
}
