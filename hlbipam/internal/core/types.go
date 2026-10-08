package core

type ZoneConfig struct {
	BaseOffset int
	Step       int
	CanHostVMs bool
}

var DefaultDeviceZones = map[string]ZoneConfig{
	"router":       {BaseOffset: 1, Step: 1, CanHostVMs: false},
	"switch":       {BaseOffset: 10, Step: 1, CanHostVMs: false},
	"access_point": {BaseOffset: 20, Step: 1, CanHostVMs: false},
	"ups":          {BaseOffset: 80, Step: 1, CanHostVMs: false},
	"pdu":          {BaseOffset: 85, Step: 1, CanHostVMs: false},
	"disk":         {BaseOffset: 90, Step: 1, CanHostVMs: false},
	"nas":          {BaseOffset: 100, Step: 10, CanHostVMs: true},
	"server":       {BaseOffset: 150, Step: 10, CanHostVMs: true},
	"server_v2":    {BaseOffset: 150, Step: 10, CanHostVMs: true},
	"firewall":     {BaseOffset: 2, Step: 1, CanHostVMs: false},
	"vps":          {BaseOffset: 120, Step: 10, CanHostVMs: true},
	"pc":           {BaseOffset: 160, Step: 10, CanHostVMs: true},
	"minipc":       {BaseOffset: 170, Step: 10, CanHostVMs: true},
	"sbc":          {BaseOffset: 180, Step: 10, CanHostVMs: true},
	"gpu":          {BaseOffset: 190, Step: 1, CanHostVMs: false},
	"hba":          {BaseOffset: 195, Step: 1, CanHostVMs: false},
	"pcie":         {BaseOffset: 198, Step: 1, CanHostVMs: false},
	"iot":          {BaseOffset: 200, Step: 10, CanHostVMs: true},
	"modem":        {BaseOffset: 5, Step: 1, CanHostVMs: false},
	"console":      {BaseOffset: 30, Step: 1, CanHostVMs: false},
}

var FallbackZone = ZoneConfig{BaseOffset: 220, Step: 1, CanHostVMs: false}

var VMHostTypeOrder = []string{"nas", "vps", "server_v2", "server", "pc", "minipc", "sbc", "iot"}

// A lan_table has no address of its own: its seats take leases from the pool.
var NonNetworkTypes = map[string]bool{
	"disk": true, "gpu": true, "hba": true, "pcie": true, "pdu": true, "ups": true, "rack": true,
	"lan_table": true,
}

// DHCPHeadroom is the share of spare leases kept on top of the announced
// demand, for phones, guests and devices that renew under a new identity.
const DHCPHeadroom = 1.25

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

const VMHostStartOffset = 100

func CalculateDynamicStep(vmHostCount int, capacity uint32, dhcpReserved uint32) int {
	if vmHostCount <= 0 {
		return 20
	}
	var usable uint32 = 0
	if capacity > 30+dhcpReserved {
		usable = capacity - 30 - dhcpReserved
	}
	if usable < uint32(vmHostCount)*2 {
		return 2
	}
	step := usable / uint32(vmHostCount)
	if step > 50 {
		return 50
	}
	if step < 2 {
		return 2
	}
	return int(step)
}
