package core

type ZoneConfig struct {
	BaseOffset int    `json:"base_offset"`
	Step       int    `json:"step"`
	CanHostVMs bool   `json:"can_host_vms"`
	Label      string `json:"label"`
}

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

var VMHostTypeOrder = []string{"nas", "server", "pc", "minipc", "sbc", "iot"}

var NonNetworkTypes = map[string]bool{
	"disk": true, "gpu": true, "hba": true, "pcie": true, "pdu": true, "ups": true, "rack": true,
}

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
