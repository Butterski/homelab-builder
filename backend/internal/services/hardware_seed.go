package services

import (
	_ "embed"
	"encoding/json"
	"fmt"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

//go:embed hardware_seed.json
var hardwareSeedJSON []byte

// hardwareSeedNamespace makes seeded rows get the same ID on every instance.
var hardwareSeedNamespace = uuid.MustParse("b2000000-0000-0000-0000-000000000000")

type hardwareSeed struct {
	Category  string          `json:"category"`
	Brand     string          `json:"brand"`
	Model     string          `json:"model"`
	Spec      json.RawMessage `json:"spec"`
	PriceEst  float64         `json:"price_est"`
	Currency  string          `json:"currency"`
	PowerDraw float64         `json:"power_draw"`
	BuyURLs   json.RawMessage `json:"buy_urls"`
}

func hardwareSeedKey(category, brand, model string) string {
	return category + "|" + brand + "|" + model
}

func loadHardwareSeeds() ([]hardwareSeed, error) {
	var seeds []hardwareSeed
	if err := json.Unmarshal(hardwareSeedJSON, &seeds); err != nil {
		return nil, fmt.Errorf("parse hardware seed: %w", err)
	}
	return seeds, nil
}

// SeedDefaultHardware fills the hardware catalog with the built-in, approved
// components. A component that is already listed (same category, brand and
// model) is left alone, so admin edits survive a restart.
func SeedDefaultHardware(db *gorm.DB) error {
	seeds, err := loadHardwareSeeds()
	if err != nil {
		return err
	}

	var existing []models.HardwareComponent
	if err := db.Select("category", "brand", "model").Find(&existing).Error; err != nil {
		return err
	}
	listed := make(map[string]bool, len(existing))
	for _, component := range existing {
		listed[hardwareSeedKey(component.Category, component.Brand, component.Model)] = true
	}

	approved := true
	rows := make([]models.HardwareComponent, 0, len(seeds))
	for _, seed := range seeds {
		key := hardwareSeedKey(seed.Category, seed.Brand, seed.Model)
		if listed[key] {
			continue
		}
		listed[key] = true
		rows = append(rows, models.HardwareComponent{
			ID:        uuid.NewSHA1(hardwareSeedNamespace, []byte(key)),
			Category:  seed.Category,
			Brand:     seed.Brand,
			Model:     seed.Model,
			PowerDraw: seed.PowerDraw,
			Spec:      seed.Spec,
			PriceEst:  seed.PriceEst,
			Currency:  seed.Currency,
			BuyURLs:   seed.BuyURLs,
			Approved:  &approved,
		})
	}
	if len(rows) == 0 {
		return nil
	}
	return db.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(rows, 50).Error
}
