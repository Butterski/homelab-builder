package services

import "strings"

func NormalizeHardwareCategory(category string) string {
	c := strings.ToLower(strings.TrimSpace(category))
	c = strings.ReplaceAll(c, "-", "_")
	c = strings.ReplaceAll(c, " ", "_")

	switch c {
	case "mini_pc", "mini_pcs", "minipcs", "sff", "sff_pc":
		return "minipc"
	case "servers", "server_v2":
		return "server"
	case "accesspoint", "access_points", "ap", "aps":
		return "access_point"
	case "storage_drive", "storage_drives", "drives", "drive":
		return "storage"
	case "nics", "network_card", "network_cards":
		return "nic"
	case "hbas":
		return "hba"
	case "gpus":
		return "gpu"
	case "routers":
		return "router"
	case "switches":
		return "switch"
	case "single_board_computer", "single_board_computers":
		return "sbc"
	default:
		return c
	}
}

func HardwareCategoryToNodeType(category string) string {
	switch NormalizeHardwareCategory(category) {
	case "server":
		return "server_v2"
	case "storage":
		return "disk"
	case "nic":
		return "hba"
	default:
		return NormalizeHardwareCategory(category)
	}
}
