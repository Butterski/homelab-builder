// Package wiring holds the rules for power cables, port settings and VLANs
// that the save validation, the change-set engine and the plan warnings share.
package wiring

import (
	"encoding/json"
	"math"
	"slices"
	"strconv"
	"strings"
)

const (
	// EdgeTypePower marks a power cable. It always runs from a socket
	// (pwr-out-N) of a power source to a power input (pwr-in-N) of a device.
	EdgeTypePower  = "power"
	PowerInPrefix  = "pwr-in-"
	PowerOutPrefix = "pwr-out-"

	maxPowerInputs = 4
	// MaxPowerOutputs is the most sockets a power source can have.
	MaxPowerOutputs = 48
	defaultVoltage  = 230
	defaultBreakerA = 16
)

// noPowerInputTypes never take a power cable: a wall outlet is the start of
// the chain, a rack is furniture, components draw through their host and a
// VPS runs elsewhere.
var noPowerInputTypes = map[string]bool{
	"power_outlet": true, "rack": true, "disk": true, "gpu": true, "cpu": true, "hba": true, "pcie": true, "vps": true,
}

var defaultOutlets = map[string]int{"ups": 6, "pdu": 8, "power_outlet": 2}

// IsPowerSource reports whether the type has sockets instead of network ports.
func IsPowerSource(nodeType string) bool {
	_, ok := defaultOutlets[nodeType]
	return ok
}

// PowerSourceTypes lists the types that have sockets, sorted.
func PowerSourceTypes() []string {
	types := make([]string, 0, len(defaultOutlets))
	for nodeType := range defaultOutlets {
		types = append(types, nodeType)
	}
	slices.Sort(types)
	return types
}

// PowerInputCount is the number of power inputs (one per PSU) of a node.
func PowerInputCount(nodeType string, details map[string]any) int {
	if noPowerInputTypes[nodeType] {
		return 0
	}
	return clamp(countDetail(details, "psu_count", 1), 0, maxPowerInputs)
}

// PowerOutputCount is the number of sockets of a power source, 0 for any other type.
func PowerOutputCount(nodeType string, details map[string]any) int {
	fallback, ok := defaultOutlets[nodeType]
	if !ok {
		return 0
	}
	return clamp(countDetail(details, "outlets", fallback), 1, MaxPowerOutputs)
}

// PowerHandleIndex returns N for a handle "<prefix>N", or -1 when the handle
// does not have that prefix or N is not a plain number.
func PowerHandleIndex(handle, prefix string) int {
	rest, ok := strings.CutPrefix(handle, prefix)
	if !ok {
		return -1
	}
	return plainIndex(rest)
}

// CapacityW is the power a source can deliver in watts, 0 when unknown.
// A PDU's rating depends on the voltage of the outlet it hangs off; a
// chainVoltage of 0 or less means 230 V.
func CapacityW(nodeType string, details map[string]any, chainVoltage float64) float64 {
	switch nodeType {
	case "ups":
		if watts, _ := number(details["capacity_w"]); watts > 0 {
			return watts
		}
		if va, _ := number(details["capacity_va"]); va > 0 {
			return math.Round(va * 0.6)
		}
	case "pdu":
		if chainVoltage <= 0 {
			chainVoltage = defaultVoltage
		}
		if amps, _ := number(details["amps"]); amps > 0 {
			return amps * chainVoltage
		}
	case "power_outlet":
		return positiveOr(details, "breaker_amps", defaultBreakerA) * outletVoltage(details)
	}
	return 0
}

// outletVoltage is the voltage of a wall outlet, 230 V when not set.
func outletVoltage(details map[string]any) float64 {
	return positiveOr(details, "voltage", defaultVoltage)
}

func positiveOr(details map[string]any, key string, fallback float64) float64 {
	if value, ok := number(details[key]); ok && value > 0 {
		return value
	}
	return fallback
}

// countDetail reads a count, truncated toward zero; a missing or unreadable
// value gives the fallback.
func countDetail(details map[string]any, key string, fallback int) int {
	value, ok := number(details[key])
	if !ok {
		return fallback
	}
	return int(math.Trunc(value))
}

// number reads a JSON number in any of the forms it arrives in: float64 from
// decoded jsonb, json.Number, Go integers in tests, or a numeric string.
func number(value any) (float64, bool) {
	var out float64
	switch v := value.(type) {
	case float64:
		out = v
	case float32:
		out = float64(v)
	case int:
		out = float64(v)
	case int32:
		out = float64(v)
	case int64:
		out = float64(v)
	case uint:
		out = float64(v)
	case uint32:
		out = float64(v)
	case uint64:
		out = float64(v)
	case json.Number:
		parsed, err := v.Float64()
		if err != nil {
			return 0, false
		}
		out = parsed
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
		if err != nil {
			return 0, false
		}
		out = parsed
	default:
		return 0, false
	}
	if math.IsNaN(out) || math.IsInf(out, 0) {
		return 0, false
	}
	return out, true
}

// integer reads a whole JSON number; strings and fractions are not integers.
func integer(value any) (int, bool) {
	if _, isText := value.(string); isText {
		return 0, false
	}
	parsed, ok := number(value)
	if !ok || parsed != math.Trunc(parsed) || math.Abs(parsed) > 1<<31 {
		return 0, false
	}
	return int(parsed), true
}

// plainIndex parses a decimal index without sign or leading zeros, -1 otherwise.
func plainIndex(text string) int {
	if text == "" || (len(text) > 1 && text[0] == '0') || len(text) > 6 {
		return -1
	}
	n := 0
	for _, r := range text {
		if r < '0' || r > '9' {
			return -1
		}
		n = n*10 + int(r-'0')
	}
	return n
}

func clamp(value, low, high int) int {
	return max(low, min(high, value))
}
