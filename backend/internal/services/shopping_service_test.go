package services

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

func TestShoppingService_GenerateWithSteering(t *testing.T) {
	tx := testTx(t)
	s := NewShoppingListService(tx)
	steeringSvc := NewSteeringService(tx)

	// Set up Steering Rules for CPU
	steeringSvc.Upsert("cpu", UpsertSteeringRuleInput{
		RetailerOrder: json.RawMessage(`["Amazon", "Morele"]`),
	})

	// Make Hardware Component representing a CPU
	hwCpu := models.HardwareComponent{
		Category:     "cpu",
		Brand:        "AMD",
		Model:        "Ryzen 5",
		AffiliateTag: "hlbtest-20",
		BuyURLs:      json.RawMessage(`[{"store": "Morele", "url": "http://m.io/1"}, {"store": "Amazon", "url": "http://a.com/2"}]`),
	}
	if err := tx.Create(&hwCpu).Error; err != nil {
		t.Fatalf("failed to create hardware component: %v", err)
	}

	// Set up properly formatted Hardware Recommendation
	rec := models.HardwareRecommendation{
		ID:             uuid.New(),
		Tier:           "recommended",
		TotalCPUCores:  6.0,
		TotalRAMMB:     16384,
		TotalStorageGB: 512,
		CPUSuggestion:  "Ryzen 5",
		CreatedAt:      time.Now(),
	}
	if err := tx.Create(&rec).Error; err != nil {
		t.Fatalf("failed to create recommendation: %v", err)
	}

	// Call Generate
	req := ShoppingListRequest{RecommendationID: rec.ID}
	resp, err := s.Generate(req)
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}

	// Verify links and ordering
	if len(resp.Items) == 0 {
		t.Fatalf("expected non-empty shopping list")
	}

	cpuFound := false
	for _, item := range resp.Items {
		if item.Category == "cpu" {
			cpuFound = true
			if len(item.PurchaseLinks) != 2 {
				t.Errorf("expected 2 purchase links, got %d", len(item.PurchaseLinks))
			}
			// Amazon should be first due to steering rules
			if item.PurchaseLinks[0].Store != "Amazon" {
				t.Errorf("expected first store to be Amazon, got %s", item.PurchaseLinks[0].Store)
			}
			if item.PurchaseLinks[1].Store != "Morele" {
				t.Errorf("expected second store to be Morele, got %s", item.PurchaseLinks[1].Store)
			}

			// Verify affiliate destination rewriting
			if len(item.PurchaseLinks) > 0 && item.PurchaseLinks[0].URL == "" {
				t.Errorf("URL rewriting failed completely")
			}
		}
	}

	if !cpuFound {
		t.Errorf("expected to find cpu item in generated list")
	}
}
