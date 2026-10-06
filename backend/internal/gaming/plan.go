package gaming

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// Plan is what the owner tells us about a gaming build that the canvas cannot
// show: the internet line, the power circuits at the venue, and the event.
type Plan struct {
	Uplink Uplink `json:"uplink"`
	Power  Power  `json:"power"`
	Event  Event  `json:"event"`
}

// Uplink describes the internet line. Zero speeds mean "not filled in".
type Uplink struct {
	DownMbps float64 `json:"down_mbps"`
	UpMbps   float64 `json:"up_mbps"`
	// CGNAT is "yes", "no" or "" when the owner does not know. Behind
	// carrier-grade NAT a port forward on the home router is not reachable.
	CGNAT string `json:"cgnat"`
	// PublicHost is the address friends connect to: a DDNS name or an IP.
	PublicHost string `json:"public_host"`
}

// Power describes the mains supply the gear is plugged into.
type Power struct {
	MainsVoltage int       `json:"mains_voltage"`
	Circuits     []Circuit `json:"circuits"`
}

// Circuit is one breaker. Nodes name the circuit they are plugged into by ID.
type Circuit struct {
	ID          string  `json:"id"`
	Label       string  `json:"label"`
	BreakerAmps float64 `json:"breaker_amps"`
}

// Event is the LAN party itself.
type Event struct {
	Date  string  `json:"date"`
	Hours float64 `json:"hours"`
}

const (
	maxCircuits     = 32
	maxMbps         = 100000
	maxEventHours   = 24 * 14
	maxPublicHost   = 253
	maxCircuitID    = 40
	maxCircuitLabel = 60
)

var (
	publicHostPattern = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9.:\-]*[A-Za-z0-9])?$`)
	circuitIDPattern  = regexp.MustCompile(`^[A-Za-z0-9_\-]+$`)
)

// Normalize checks a plan and returns it in the form that is stored: trimmed
// strings and an empty, non-nil circuit list. It never fills in defaults, so a
// plan that is stored and read back is unchanged.
func (p Plan) Normalize() (Plan, error) {
	if p.Uplink.DownMbps < 0 || p.Uplink.DownMbps > maxMbps || p.Uplink.UpMbps < 0 || p.Uplink.UpMbps > maxMbps {
		return p, fmt.Errorf("uplink speeds must be between 0 and %d Mbps", maxMbps)
	}
	switch p.Uplink.CGNAT {
	case "", "yes", "no":
	default:
		return p, fmt.Errorf("uplink.cgnat must be yes, no or empty")
	}
	p.Uplink.PublicHost = strings.TrimSpace(p.Uplink.PublicHost)
	if host := p.Uplink.PublicHost; host != "" {
		if len(host) > maxPublicHost || !publicHostPattern.MatchString(host) {
			return p, fmt.Errorf("uplink.public_host must be a host name or an IP address")
		}
	}

	if v := p.Power.MainsVoltage; v != 0 && (v < 100 || v > 240) {
		return p, fmt.Errorf("power.mains_voltage must be between 100 and 240")
	}
	if len(p.Power.Circuits) > maxCircuits {
		return p, fmt.Errorf("a plan can have at most %d circuits", maxCircuits)
	}
	circuits := make([]Circuit, 0, len(p.Power.Circuits))
	seen := make(map[string]bool, len(p.Power.Circuits))
	for _, circuit := range p.Power.Circuits {
		circuit.ID = strings.TrimSpace(circuit.ID)
		circuit.Label = strings.TrimSpace(circuit.Label)
		if circuit.ID == "" || len(circuit.ID) > maxCircuitID || !circuitIDPattern.MatchString(circuit.ID) {
			return p, fmt.Errorf("circuit id %q must be 1-%d letters, digits, dashes or underscores", circuit.ID, maxCircuitID)
		}
		if seen[circuit.ID] {
			return p, fmt.Errorf("circuit id %q is used twice", circuit.ID)
		}
		seen[circuit.ID] = true
		if len(circuit.Label) > maxCircuitLabel {
			return p, fmt.Errorf("circuit label is longer than %d characters", maxCircuitLabel)
		}
		if circuit.BreakerAmps < 1 || circuit.BreakerAmps > 125 {
			return p, fmt.Errorf("circuit %q needs a breaker rating between 1 and 125 A", circuit.ID)
		}
		circuits = append(circuits, circuit)
	}
	p.Power.Circuits = circuits

	p.Event.Date = strings.TrimSpace(p.Event.Date)
	if p.Event.Date != "" {
		if _, err := time.Parse("2006-01-02", p.Event.Date); err != nil {
			return p, fmt.Errorf("event.date must be YYYY-MM-DD")
		}
	}
	if p.Event.Hours < 0 || p.Event.Hours > maxEventHours {
		return p, fmt.Errorf("event.hours must be between 0 and %d", maxEventHours)
	}
	return p, nil
}

// ParsePlan reads a stored plan. An empty column is an empty plan.
func ParsePlan(raw json.RawMessage) (Plan, error) {
	plan := Plan{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &plan); err != nil {
			return plan, fmt.Errorf("stored gaming plan is not valid JSON: %w", err)
		}
	}
	if plan.Power.Circuits == nil {
		plan.Power.Circuits = []Circuit{}
	}
	return plan, nil
}

// Circuit returns the circuit with the given ID.
func (p Plan) Circuit(id string) (Circuit, bool) {
	for _, circuit := range p.Power.Circuits {
		if circuit.ID == id {
			return circuit, true
		}
	}
	return Circuit{}, false
}
