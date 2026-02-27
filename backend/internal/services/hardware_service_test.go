package services

import (
	"encoding/json"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/models"
)

func TestHardwareService_UpdateBuyURLs(t *testing.T) {
	tx := testTx(t)
	s := NewHardwareService(tx)

	// Setup a dummy hardware component
	hw := models.HardwareComponent{
		Category: "router",
		Brand:    "Test Brand",
		Model:    "Test Router",
	}
	if err := tx.Create(&hw).Error; err != nil {
		t.Fatalf("failed to setup test hardware: %v", err)
	}

	// Update buy URLs and affiliate tag
	buyURLs := json.RawMessage(`[{"store": "Amazon", "url": "http://amazon.com/dp/xxx"}]`)
	tag := "my-tag-20"

	if err := s.UpdateBuyURLs(hw.ID, buyURLs, tag); err != nil {
		t.Fatalf("failed to update buy urls: %v", err)
	}

	// Verify persistence
	var fetched models.HardwareComponent
	if err := tx.First(&fetched, "id = ?", hw.ID).Error; err != nil {
		t.Fatalf("failed to fetch updated hardware: %v", err)
	}

	var savedURLs []map[string]string
	if err := json.Unmarshal(fetched.BuyURLs, &savedURLs); err != nil {
		t.Fatalf("failed to unmarshal saved urls: %v", err)
	}

	if len(savedURLs) != 1 || savedURLs[0]["store"] != "Amazon" || savedURLs[0]["url"] != "http://amazon.com/dp/xxx" {
		t.Errorf("unexpected buy URLs: %v", string(fetched.BuyURLs))
	}
	if fetched.AffiliateTag != tag {
		t.Errorf("expected affiliate tag %s, got %s", tag, fetched.AffiliateTag)
	}
}
