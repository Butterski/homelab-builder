package gaming

import (
	"strings"
	"testing"
)

func venuePlan() Plan {
	return Plan{
		Uplink: Uplink{DownMbps: 300, UpMbps: 20, CGNAT: "no", PublicHost: "play.example.org"},
		Power: Power{MainsVoltage: 230, Circuits: []Circuit{
			{ID: "c1", Label: "Hall", BreakerAmps: 16},
			{ID: "c2", Label: "Stage", BreakerAmps: 10},
		}},
		Event: Event{Date: "2026-11-14", Hours: 24},
	}
}

func TestMergePlan_SetsWhatIsNamedAndKeepsTheRest(t *testing.T) {
	// Numbers arrive from JSON as float64.
	merged, err := MergePlan(venuePlan(), map[string]any{
		"uplink": map[string]any{"up_mbps": float64(50)},
		"event":  map[string]any{"hours": float64(36)},
	})
	if err != nil {
		t.Fatalf("MergePlan: %v", err)
	}
	if merged.Uplink.UpMbps != 50 || merged.Event.Hours != 36 {
		t.Errorf("named keys were not set: %+v", merged)
	}
	if merged.Uplink.DownMbps != 300 || merged.Uplink.PublicHost != "play.example.org" || merged.Event.Date != "2026-11-14" || len(merged.Power.Circuits) != 2 {
		t.Errorf("other keys must stay: %+v", merged)
	}
}

func TestMergePlan_ListsAreReplacedAndNullClears(t *testing.T) {
	merged, err := MergePlan(venuePlan(), map[string]any{
		"power":  map[string]any{"circuits": []any{map[string]any{"id": "main", "label": "Main", "breaker_amps": float64(20)}}},
		"uplink": map[string]any{"public_host": nil, "cgnat": nil},
	})
	if err != nil {
		t.Fatalf("MergePlan: %v", err)
	}
	// A list has no keys to merge by, so it is taken as a whole.
	if len(merged.Power.Circuits) != 1 || merged.Power.Circuits[0] != (Circuit{ID: "main", Label: "Main", BreakerAmps: 20}) {
		t.Errorf("circuits = %+v", merged.Power.Circuits)
	}
	if merged.Power.MainsVoltage != 230 {
		t.Errorf("the voltage next to the list must stay: %d", merged.Power.MainsVoltage)
	}
	if merged.Uplink.PublicHost != "" || merged.Uplink.CGNAT != "" {
		t.Errorf("null should clear a setting: %+v", merged.Uplink)
	}
}

func TestMergePlan_StartsFromAnEmptyPlan(t *testing.T) {
	merged, err := MergePlan(Plan{}, map[string]any{"uplink": map[string]any{"up_mbps": float64(20)}})
	if err != nil {
		t.Fatalf("MergePlan: %v", err)
	}
	if merged.Uplink.UpMbps != 20 || merged.Power.Circuits == nil {
		t.Errorf("merged = %+v", merged)
	}
}

func TestMergePlan_RejectsWhatThePlanCannotHold(t *testing.T) {
	cases := map[string]map[string]any{
		"unknown section":  {"venue": map[string]any{"name": "Hall"}},
		"unknown setting":  {"uplink": map[string]any{"speed": float64(20)}},
		"wrong type":       {"uplink": map[string]any{"up_mbps": "fast"}},
		"invalid value":    {"uplink": map[string]any{"cgnat": "maybe"}},
		"duplicate id":     {"power": map[string]any{"circuits": []any{map[string]any{"id": "c1", "breaker_amps": float64(16)}, map[string]any{"id": "c1", "breaker_amps": float64(16)}}}},
		"breaker too weak": {"power": map[string]any{"circuits": []any{map[string]any{"id": "c1", "breaker_amps": float64(0)}}}},
	}
	for name, patch := range cases {
		if _, err := MergePlan(venuePlan(), patch); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
	// The message tells the caller what a plan does hold.
	_, err := MergePlan(Plan{}, map[string]any{"uplink": map[string]any{"speed": float64(20)}})
	if err == nil || !strings.Contains(err.Error(), "up_mbps") {
		t.Errorf("the error should list the settings: %v", err)
	}
}

func TestDiffPlans(t *testing.T) {
	before := venuePlan()
	if changes := DiffPlans(before, venuePlan()); len(changes) != 0 {
		t.Fatalf("equal plans differ: %+v", changes)
	}

	after := venuePlan()
	after.Uplink.UpMbps = 50
	after.Uplink.CGNAT = "yes"
	after.Power.Circuits[1].BreakerAmps = 16
	after.Event.Date = ""
	changes := DiffPlans(before, after)

	fields := map[string]PlanChange{}
	for _, change := range changes {
		fields[change.Field] = change
	}
	if len(changes) != 4 {
		t.Fatalf("expected four changes, got %+v", changes)
	}
	if up := fields["uplink.up_mbps"]; up.Before != float64(20) || up.After != float64(50) {
		t.Errorf("upload change = %+v", up)
	}
	if nat := fields["uplink.cgnat"]; nat.Before != "no" || nat.After != "yes" {
		t.Errorf("cgnat change = %+v", nat)
	}
	if _, ok := fields["power.circuits"]; !ok {
		t.Errorf("a changed breaker is a change to the circuits: %+v", changes)
	}
	if date := fields["event.date"]; date.Before != "2026-11-14" || date.After != "" {
		t.Errorf("date change = %+v", date)
	}

	// An empty and a missing circuit list are the same plan.
	empty := Plan{}
	listed := Plan{Power: Power{Circuits: []Circuit{}}}
	if changes := DiffPlans(empty, listed); len(changes) != 0 {
		t.Errorf("nil and empty circuits must not differ: %+v", changes)
	}
}
