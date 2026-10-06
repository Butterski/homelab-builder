package gaming

import (
	"encoding/json"
	"fmt"
)

// MaxInstancePlayers bounds the player count of one server.
const MaxInstancePlayers = 1000

// InstanceKey is the key in a guest's details that holds its Instance.
const InstanceKey = "game"

// ParseInstance reads the "game" value of a guest's details. found is false
// when the guest is not a game server.
func ParseInstance(value any) (instance Instance, found bool, err error) {
	if value == nil {
		return Instance{}, false, nil
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return Instance{}, true, fmt.Errorf("game settings are not valid: %w", err)
	}
	if err := json.Unmarshal(raw, &instance); err != nil {
		return Instance{}, true, fmt.Errorf("game settings must be an object with profile, players, exposure and port_offset")
	}
	return instance, true, nil
}

// Normalize checks an instance against its profile and fills in what was left
// out: the usual group size and LAN-only exposure.
func (i Instance) Normalize() (Instance, Profile, error) {
	profile, ok := ProfileBySlug(i.Profile)
	if !ok {
		return i, Profile{}, fmt.Errorf("unknown game profile %q", i.Profile)
	}
	if i.Players < 0 || i.Players > MaxInstancePlayers {
		return i, profile, fmt.Errorf("players must be between 1 and %d", MaxInstancePlayers)
	}
	i.Players = profile.PlayersOrDefault(i.Players)
	if i.Exposure == "" {
		i.Exposure = ExposureLAN
	}
	if !ValidExposure(i.Exposure) {
		return i, profile, fmt.Errorf("exposure must be one of lan, port_forward, vpn or relay")
	}
	if limit := profile.MaxOffset(); i.PortOffset < 0 || i.PortOffset > limit {
		return i, profile, fmt.Errorf("port_offset for %s must be between 0 and %d", profile.Name, limit)
	}
	return i, profile, nil
}

// Details is the form an instance is stored in.
func (i Instance) Details() map[string]any {
	return map[string]any{
		"profile":     i.Profile,
		"players":     float64(i.Players),
		"exposure":    i.Exposure,
		"port_offset": float64(i.PortOffset),
	}
}
