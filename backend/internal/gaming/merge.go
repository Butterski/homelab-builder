package gaming

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// MergePlan applies a JSON merge patch to a plan: listed keys are set, a null
// value clears a key, objects are merged and lists are replaced as a whole.
// Because it is a patch, a stored change can be replayed on a plan that was
// edited in the meantime without undoing those edits.
func MergePlan(current Plan, patch map[string]any) (Plan, error) {
	raw, err := json.Marshal(current)
	if err != nil {
		return current, err
	}
	base := map[string]any{}
	if err := json.Unmarshal(raw, &base); err != nil {
		return current, err
	}
	merged, err := json.Marshal(mergePatch(base, patch))
	if err != nil {
		return current, err
	}

	var plan Plan
	decoder := json.NewDecoder(bytes.NewReader(merged))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&plan); err != nil {
		return current, fmt.Errorf("plan: %s; it has uplink (down_mbps, up_mbps, cgnat, public_host), power (mains_voltage, circuits) and event (date, hours)", err.Error())
	}
	return plan.Normalize()
}

func mergePatch(target map[string]any, patch map[string]any) map[string]any {
	for key, value := range patch {
		if value == nil {
			delete(target, key)
			continue
		}
		if object, isObject := value.(map[string]any); isObject {
			existing, _ := target[key].(map[string]any)
			if existing == nil {
				existing = map[string]any{}
			}
			target[key] = mergePatch(existing, object)
			continue
		}
		target[key] = value
	}
	return target
}

// PlanChange is one difference between two plans.
type PlanChange struct {
	Field  string
	Before any
	After  any
}

// DiffPlans lists what differs between two plans, one entry per setting.
func DiffPlans(before, after Plan) []PlanChange {
	changes := []PlanChange{}
	add := func(field string, a, b any, equal bool) {
		if !equal {
			changes = append(changes, PlanChange{Field: field, Before: a, After: b})
		}
	}
	add("uplink.down_mbps", before.Uplink.DownMbps, after.Uplink.DownMbps, before.Uplink.DownMbps == after.Uplink.DownMbps)
	add("uplink.up_mbps", before.Uplink.UpMbps, after.Uplink.UpMbps, before.Uplink.UpMbps == after.Uplink.UpMbps)
	add("uplink.cgnat", before.Uplink.CGNAT, after.Uplink.CGNAT, before.Uplink.CGNAT == after.Uplink.CGNAT)
	add("uplink.public_host", before.Uplink.PublicHost, after.Uplink.PublicHost, before.Uplink.PublicHost == after.Uplink.PublicHost)
	add("power.mains_voltage", before.Power.MainsVoltage, after.Power.MainsVoltage, before.Power.MainsVoltage == after.Power.MainsVoltage)
	add("power.circuits", before.Power.Circuits, after.Power.Circuits, sameCircuits(before.Power.Circuits, after.Power.Circuits))
	add("event.date", before.Event.Date, after.Event.Date, before.Event.Date == after.Event.Date)
	add("event.hours", before.Event.Hours, after.Event.Hours, before.Event.Hours == after.Event.Hours)
	return changes
}

func sameCircuits(a, b []Circuit) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
