package gaming

import "math"

// Instance is how one game server on the canvas is configured. It is stored in
// the guest's details under the "game" key.
type Instance struct {
	Profile string `json:"profile"`
	Players int    `json:"players"`
	// Exposure says who can reach the server: lan, port_forward, vpn or relay.
	Exposure string `json:"exposure"`
	// PortOffset is added to every port of the profile, so two servers of the
	// same game can share a host and a router.
	PortOffset int `json:"port_offset"`
}

const (
	ExposureLAN         = "lan"
	ExposurePortForward = "port_forward"
	ExposureVPN         = "vpn"
	ExposureRelay       = "relay"

	MaxPortOffset = 1000
)

// Exposures lists the allowed exposure values.
var Exposures = []string{ExposureLAN, ExposurePortForward, ExposureVPN, ExposureRelay}

// ValidExposure reports whether value is one of Exposures.
func ValidExposure(value string) bool {
	for _, exposure := range Exposures {
		if exposure == value {
			return true
		}
	}
	return false
}

// Sizing is what one server needs for a given number of players.
type Sizing struct {
	CPUCores   float64 `json:"cpu_cores"`
	RAMMB      int     `json:"ram_mb"`
	StorageGB  int     `json:"storage_gb"`
	UploadKbps int     `json:"upload_kbps"`
}

// PlayersOrDefault returns the player count to plan for.
func (p Profile) PlayersOrDefault(players int) int {
	if players > 0 {
		return players
	}
	if p.DefaultPlayers > 0 {
		return p.DefaultPlayers
	}
	return 1
}

// SizeServer estimates the resources for players concurrent players. RAM is
// rounded up to 512 MB and CPU to half a core, the steps people provision in.
func SizeServer(profile Profile, players int) Sizing {
	players = profile.PlayersOrDefault(players)
	ram := profile.BaseRAMMB + profile.RAMMBPerPlayer*players
	cpu := profile.BaseCPUCores + profile.CPUCoresPerPlayer*float64(players)
	return Sizing{
		CPUCores:   math.Max(0.5, math.Ceil(cpu*2)/2),
		RAMMB:      int(math.Max(512, math.Ceil(float64(ram)/512)*512)),
		StorageGB:  profile.StorageGB,
		UploadKbps: profile.UploadKbpsPerPlayer * players,
	}
}

// MaxOffset is the largest port offset an instance of this profile can use
// without pushing a port past 65535.
func (p Profile) MaxOffset() int {
	limit := MaxPortOffset
	for _, spec := range p.Ports {
		if room := 65535 - spec.Port; room < limit {
			limit = room
		}
	}
	return limit
}

// ResolvedPort is a profile port with the instance's offset applied.
type ResolvedPort struct {
	PortSpec
	// Base is the profile's default port, before the offset.
	Base int `json:"base"`
}

// ResolvePorts applies an instance's port offset to the profile's ports.
func ResolvePorts(profile Profile, offset int) []ResolvedPort {
	ports := make([]ResolvedPort, 0, len(profile.Ports))
	for _, spec := range profile.Ports {
		resolved := ResolvedPort{PortSpec: spec, Base: spec.Port}
		resolved.Port = spec.Port + offset
		ports = append(ports, resolved)
	}
	return ports
}
