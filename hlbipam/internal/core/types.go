package core

// ZoneConfig defines the IP offset range for a device type within a /24 subnet.
type ZoneConfig struct {
	BaseOffset int    `json:"base_offset"`
	Step       int    `json:"step"`
	CanHostVMs bool   `json:"can_host_vms"`
	Label      string `json:"label"`
}

// DefaultDeviceZones are the built-in role-based IP zones.
// Users can override these per-request via the allocate payload.
var DefaultDeviceZones = map[string]ZoneConfig{
	"router":       {BaseOffset: 1, Step: 1, CanHostVMs: false, Label: "Router"},
	"switch":       {BaseOffset: 10, Step: 1, CanHostVMs: false, Label: "Switch"},
	"access_point": {BaseOffset: 20, Step: 1, CanHostVMs: false, Label: "AP"},
	"ups":          {BaseOffset: 80, Step: 1, CanHostVMs: false, Label: "UPS"},
	"pdu":          {BaseOffset: 85, Step: 1, CanHostVMs: false, Label: "PDU"},
	"disk":         {BaseOffset: 90, Step: 1, CanHostVMs: false, Label: "Disk"},
	"nas":          {BaseOffset: 100, Step: 10, CanHostVMs: true, Label: "NAS"},
	"server":       {BaseOffset: 150, Step: 10, CanHostVMs: true, Label: "Server"},
	"pc":           {BaseOffset: 160, Step: 10, CanHostVMs: true, Label: "PC"},
	"minipc":       {BaseOffset: 170, Step: 10, CanHostVMs: true, Label: "Mini PC"},
	"sbc":          {BaseOffset: 180, Step: 10, CanHostVMs: true, Label: "SBC"},
	"gpu":          {BaseOffset: 190, Step: 1, CanHostVMs: false, Label: "GPU"},
	"hba":          {BaseOffset: 195, Step: 1, CanHostVMs: false, Label: "HBA"},
	"pcie":         {BaseOffset: 198, Step: 1, CanHostVMs: false, Label: "PCIe"},
	"iot":          {BaseOffset: 200, Step: 10, CanHostVMs: true, Label: "IoT"},
	"modem":        {BaseOffset: 5, Step: 1, CanHostVMs: false, Label: "Modem"},
}

var FallbackZone = ZoneConfig{BaseOffset: 220, Step: 1, CanHostVMs: false, Label: "Device"}

// VMHostTypeOrder defines the deterministic order in which VM-hosting
// device types are laid out in the address space. Core infra first.
var VMHostTypeOrder = []string{"nas", "server", "pc", "minipc", "sbc", "iot"}

// NonNetworkTypes are device types that don't receive an IP address.
var NonNetworkTypes = map[string]bool{
	"disk": true, "gpu": true, "hba": true, "pcie": true, "pdu": true, "ups": true,
}

// DefaultDHCPRange defines the DHCP pool that should be excluded from static allocation.
var DefaultDHCPStart = 30
var DefaultDHCPEnd = 99

// GetZone returns the zone config for a device type, falling back to FallbackZone.
func GetZone(deviceType string, zones map[string]ZoneConfig) ZoneConfig {
	if zones != nil {
		if z, ok := zones[deviceType]; ok {
			return z
		}
	}
	if z, ok := DefaultDeviceZones[deviceType]; ok {
		return z
	}
	return FallbackZone
}

const (
	// MaxDynamicStep is the upper bound for pool size per VM-hosting device.
	MaxDynamicStep = 20
	// MinDynamicStep is the lower bound — every host gets at least 1 VM slot.
	MinDynamicStep = 2
	// ReservedInfra is the number of addresses set aside for infrastructure
	// (gateway, switches, APs, broadcast, etc.) when calculating dynamic steps.
	ReservedInfra = 30
	// VMHostStartOffset is where VM-hosting devices begin packing contiguously.
	// Infrastructure devices (router, switch, AP, etc.) live below this.
	VMHostStartOffset = 100
)

// CalculateDynamicStep calculates the optimal per-device pool step size based
// on how many VM-hosting devices exist in the subnet and how much address
// space is available. Fewer devices → bigger pools; many devices → smaller pools.
func CalculateDynamicStep(vmHostCount int, dhcpReserved int) int {
	if vmHostCount <= 0 {
		return MaxDynamicStep
	}

	// Total usable addresses in a /24: 254 (1–254), minus gateway(1), broadcast is already excluded
	usable := 254 - ReservedInfra - dhcpReserved
	if usable < vmHostCount*MinDynamicStep {
		return MinDynamicStep
	}

	step := usable / vmHostCount
	if step > MaxDynamicStep {
		return MaxDynamicStep
	}
	if step < MinDynamicStep {
		return MinDynamicStep
	}
	return step
}
