package services

import (
	"encoding/json"
	"testing"
)

func TestSteeringService_CRUD(t *testing.T) {
	tx := testTx(t)
	s := NewSteeringService(tx)

	// Test Upsert (Create)
	cat := "router"
	order := json.RawMessage(`["morele", "amazon"]`)
	rule, err := s.Upsert(cat, UpsertSteeringRuleInput{RetailerOrder: order})
	if err != nil {
		t.Fatalf("failed to upsert steering rule: %v", err)
	}
	if rule.Category != cat {
		t.Errorf("expected category %s, got %s", cat, rule.Category)
	}

	// Test GetByCategory
	fetched, err := s.GetByCategory(cat)
	if err != nil {
		t.Fatalf("failed to get by category: %v", err)
	}
	if string(fetched.RetailerOrder) != string(order) {
		t.Errorf("expected order %s, got %s", string(order), string(fetched.RetailerOrder))
	}

	// Test Upsert (Update)
	newOrder := json.RawMessage(`["x-kom", "morele"]`)
	updated, err := s.Upsert(cat, UpsertSteeringRuleInput{RetailerOrder: newOrder})
	if err != nil {
		t.Fatalf("failed to update steering rule: %v", err)
	}
	if string(updated.RetailerOrder) != string(newOrder) {
		t.Errorf("expected updated order %s, got %s", string(newOrder), string(updated.RetailerOrder))
	}

	// Test GetAll
	all, err := s.GetAll()
	if err != nil {
		t.Fatalf("failed to get all steering rules: %v", err)
	}
	if len(all) != 1 {
		t.Errorf("expected 1 rule, got %d", len(all))
	}

	// Test Delete
	if err := s.Delete(cat); err != nil {
		t.Fatalf("failed to delete steering rule: %v", err)
	}

	_, err = s.GetByCategory(cat)
	if err == nil {
		t.Errorf("expected error after deleting rule, got none")
	}
}
