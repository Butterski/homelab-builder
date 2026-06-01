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

func TestHardwareService_Favorites(t *testing.T) {
	tx := testTx(t)
	s := NewHardwareService(tx)

	// Create dummy user
	u := models.User{
		Email: "fav_user@example.com",
		Name:  "Fav User",
	}
	if err := tx.Create(&u).Error; err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	// Create dummy hardware components
	hw1 := models.HardwareComponent{
		Category: "router",
		Brand:    "Brand A",
		Model:    "Model A",
		Likes:    0,
	}
	hw2 := models.HardwareComponent{
		Category: "switch",
		Brand:    "Brand B",
		Model:    "Model B",
		Likes:    5,
	}
	if err := tx.Create(&hw1).Error; err != nil || tx.Create(&hw2).Error != nil {
		t.Fatalf("failed to setup test hardware: %v", err)
	}

	// 1. Add Favorite
	fav, err := s.AddHardwareFavorite(u.ID, hw1.ID)
	if err != nil {
		t.Fatalf("failed to add hardware favorite: %v", err)
	}
	if fav.HardwareComponentID != hw1.ID || fav.UserID != u.ID {
		t.Errorf("unexpected favorite output: %+v", fav)
	}

	// Verify component likes got incremented
	var fetchedHw1 models.HardwareComponent
	tx.First(&fetchedHw1, "id = ?", hw1.ID)
	if fetchedHw1.Likes != 1 {
		t.Errorf("expected likes to increment to 1, got %d", fetchedHw1.Likes)
	}

	// 2. Add same favorite again (should not duplicate, but return existing)
	favDup, err := s.AddHardwareFavorite(u.ID, hw1.ID)
	if err != nil {
		t.Fatalf("failed to add duplicate hardware favorite: %v", err)
	}
	if favDup.ID != fav.ID {
		t.Errorf("expected existing favorite ID to be returned, got different ID")
	}

	// 3. Get Favorites
	favs, err := s.GetHardwareFavorites(u.ID)
	if err != nil {
		t.Fatalf("failed to fetch hardware favorites: %v", err)
	}
	if len(favs) != 1 || favs[0].HardwareComponentID != hw1.ID {
		t.Errorf("unexpected favorites list size or content: %+v", favs)
	}
	if favs[0].HardwareComponent.Brand != "Brand A" {
		t.Errorf("expected preloaded HardwareComponent to have brand 'Brand A', got %s", favs[0].HardwareComponent.Brand)
	}

	// 4. Remove Favorite
	if err := s.RemoveHardwareFavorite(u.ID, hw1.ID); err != nil {
		t.Fatalf("failed to remove hardware favorite: %v", err)
	}

	// Verify component likes got decremented
	tx.First(&fetchedHw1, "id = ?", hw1.ID)
	if fetchedHw1.Likes != 0 {
		t.Errorf("expected likes to decrement back to 0, got %d", fetchedHw1.Likes)
	}

	// Verify favorites list is now empty
	favsEmpty, err := s.GetHardwareFavorites(u.ID)
	if err != nil {
		t.Fatalf("failed to fetch hardware favorites: %v", err)
	}
	if len(favsEmpty) != 0 {
		t.Errorf("expected empty favorites list, got %d items", len(favsEmpty))
	}
}

func TestHardwareService_NormalizesCategories(t *testing.T) {
	tx := testTx(t)
	s := NewHardwareService(tx)

	approved := true
	components := []models.HardwareComponent{
		{Category: "mini pcs", Brand: "Brand", Model: "One", Approved: &approved},
		{Category: "mini_pc", Brand: "Brand", Model: "Two", Approved: &approved},
		{Category: "server_v2", Brand: "Brand", Model: "Three", Approved: &approved},
	}
	for _, component := range components {
		if _, err := s.Create(CreateHardwareInput{
			Category: component.Category,
			Brand:    component.Brand,
			Model:    component.Model,
		}, nil, true); err != nil {
			t.Fatalf("failed to create component: %v", err)
		}
	}

	cats, err := s.GetCategories()
	if err != nil {
		t.Fatalf("failed to get categories: %v", err)
	}
	if !containsString(cats, "minipc") {
		t.Fatalf("expected normalized minipc category, got %+v", cats)
	}
	if containsString(cats, "mini_pc") || containsString(cats, "mini pcs") {
		t.Fatalf("expected aliases to be removed, got %+v", cats)
	}

	result, err := s.GetAll(HardwareFilter{Category: "Mini PCs"})
	if err != nil {
		t.Fatalf("failed to get filtered hardware: %v", err)
	}
	if result.Total != 2 {
		t.Fatalf("expected category alias filter to return 2 mini PCs, got %d", result.Total)
	}
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
