package services

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// IPService handles network calculations
type IPService struct {
	db *gorm.DB
}

func NewIPService(db *gorm.DB) *IPService {
	return &IPService{db: db}
}

// ─── Constants (Ported from builder-store.ts) ────────────────────────────────

type ZoneConfig struct {
	Base  int
	Step  int
	Label string
}

var ROLE_ZONE = map[string]ZoneConfig{
	"router":       {Base: 1, Step: 1, Label: "Router"},
	"switch":       {Base: 10, Step: 1, Label: "Switch"},
	"access_point": {Base: 50, Step: 1, Label: "AP"},
	"ups":          {Base: 80, Step: 1, Label: "UPS"},
	"pdu":          {Base: 85, Step: 1, Label: "PDU"},
	"disk":         {Base: 90, Step: 1, Label: "Disk"},
	"nas":          {Base: 100, Step: 10, Label: "NAS"},
	"server":       {Base: 150, Step: 10, Label: "Server"},
	"pc":           {Base: 160, Step: 10, Label: "PC"},
	"minipc":       {Base: 170, Step: 10, Label: "Mini PC"},
	"sbc":          {Base: 180, Step: 10, Label: "SBC"},
	"gpu":          {Base: 190, Step: 1, Label: "GPU"},
	"hba":          {Base: 195, Step: 1, Label: "HBA"},
	"pcie":         {Base: 198, Step: 1, Label: "PCIe"},
}

var FALLBACK_ZONE = ZoneConfig{Base: 200, Step: 1, Label: "Device"}

var NON_NETWORK_TYPES = map[string]bool{
	"disk": true, "gpu": true, "hba": true, "pcie": true, "pdu": true, "ups": true,
}

// ─── Public API ─────────────────────────────────────────────────────────────

// CalculateNetwork reassigns IPs for the entire build
func (s *IPService) CalculateNetwork(buildID uuid.UUID) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		// 1. Fetch all nodes with their VMs
		var nodes []models.Node
		if err := tx.Preload("VirtualMachines").Where("build_id = ?", buildID).Find(&nodes).Error; err != nil {
			return err
		}

		// 2. Find Gateway
		gateway := s.findGateway(nodes)
		if gateway == "" {
			// No router with IP? Try to find a router and assign default
			for i, n := range nodes {
				if n.Type == "router" {
					nodes[i].IP = "192.168.1.1"
					gateway = "192.168.1.1"
					// Save immediately
					if err := tx.Save(&nodes[i]).Error; err != nil {
						return err
					}
					break
				}
			}
		}

		if gateway == "" {
			return errors.New("no router found to establish gateway")
		}

		// 3. Reset IPs for non-routers (optional? or just recalculate gaps?)
		// The requirement is "Reassign IPs", which implies a full recalculation or filling gaps.
		// "builder-store.ts" logic: Resets all non-static IPs and re-assigns sequentially.
		// To be safe and deterministic, let's clear IPs (except routers) and re-assign.

		// In Go, we are working with a slice of structs.
		// We need to keep router IPs.

		// Create a working set of nodes to update
		// We need to process them: Routers first, then others.

		// Separate routers (keep them as anchors)
		// Actually, builder-store logic: "Reset all non-static IPs... First pass: add routers... Second pass: assign others"

		// Let's implement the logic:
		// 1. Identify used offsets (from routers)
		// 2. Iterate others and assign

		// Note: We need to update the `nodes` slice in place and save later?
		// Or save one by one?
		// Saving one by one is safer for the loop state.

		// Reset phase
		for i := range nodes {
			if nodes[i].Type != "router" && !NON_NETWORK_TYPES[nodes[i].Type] {
				nodes[i].IP = ""
			}
			// Also reset VMs
			for j := range nodes[i].VirtualMachines {
				nodes[i].VirtualMachines[j].IP = ""
			}
		}

		// We need a helper to get current state of "Used IPs" dynamically as we assign
		// But passing the whole slice by value/pointer is tricky if we update it.
		// Let's keep the slice updated.

		for i := range nodes {
			if nodes[i].Type == "router" {
				continue
			} // Already has IP (or we kept it)
			if NON_NETWORK_TYPES[nodes[i].Type] {
				continue
			}

			// Assign Node IP
			newIP := s.assignIP(nodes[i].Type, gateway, nodes) // Pass all nodes (some have IPs, some empty)
			if newIP != "" {
				nodes[i].IP = newIP
			}

			// Assign VM IPs
			if len(nodes[i].VirtualMachines) > 0 && nodes[i].IP != "" {
				for j := range nodes[i].VirtualMachines {
					vmIP := s.assignVMIP(&nodes[i], nodes) // Pass host and all nodes
					if vmIP != "" {
						nodes[i].VirtualMachines[j].IP = vmIP
					}
				}
			}
		}

		// 4. Save changes
		for _, n := range nodes {
			if err := tx.Updates(&n).Error; err != nil {
				return err
			}
			for _, vm := range n.VirtualMachines {
				if err := tx.Updates(&vm).Error; err != nil {
					return err
				}
			}
		}

		return nil
	})
}

// ─── Helpers ────────────────────────────────────────────────────────────────

func (s *IPService) findGateway(nodes []models.Node) string {
	for _, n := range nodes {
		if n.Type == "router" && n.IP != "" {
			return n.IP
		}
	}
	return ""
}

func (s *IPService) subnetPrefix(gateway string) string {
	parts := strings.Split(gateway, ".")
	if len(parts) >= 3 {
		return strings.Join(parts[0:3], ".")
	}
	return "192.168.1"
}

func (s *IPService) collectUsedOffsets(nodes []models.Node) map[int]bool {
	used := make(map[int]bool)
	for _, n := range nodes {
		if n.IP != "" {
			lastOctet := parseLastOctet(n.IP)
			if lastOctet != -1 {
				zone, ok := ROLE_ZONE[n.Type]
				if !ok {
					zone = FALLBACK_ZONE
				}

				// Reserve block
				for i := 0; i < zone.Step; i++ {
					used[lastOctet+i] = true
				}
			}
		}
		// Also reserved explicitly assigned VM IPs?
		// In ts: "Also reserve any explicitly assigned VM IPs"
		// Only if they fall outside the block?
		// If they are in the block, they are covered.
		// If they are static IPs elsewhere, they should be marked.
		for _, vm := range n.VirtualMachines {
			if vm.IP != "" {
				octet := parseLastOctet(vm.IP)
				if octet != -1 {
					used[octet] = true
				}
			}
		}
	}
	return used
}

func (s *IPService) collectUsedIPs(nodes []models.Node) map[int]bool {
	used := make(map[int]bool)
	for _, n := range nodes {
		if n.IP != "" {
			octet := parseLastOctet(n.IP)
			if octet != -1 {
				used[octet] = true
			}
		}
		for _, vm := range n.VirtualMachines {
			if vm.IP != "" {
				octet := parseLastOctet(vm.IP)
				if octet != -1 {
					used[octet] = true
				}
			}
		}
	}
	return used
}

func (s *IPService) assignIP(hwType string, gateway string, nodes []models.Node) string {
	if NON_NETWORK_TYPES[hwType] {
		return ""
	}

	prefix := s.subnetPrefix(gateway)
	zone, ok := ROLE_ZONE[hwType]
	if !ok {
		zone = FALLBACK_ZONE
	}

	usedOffsets := s.collectUsedOffsets(nodes)

	// Find next free slot in zone
	for offset := zone.Base; offset < 250; offset += zone.Step {
		blockFree := true
		for i := 0; i < zone.Step; i++ {
			if usedOffsets[offset+i] {
				blockFree = false
				break
			}
		}
		if blockFree {
			return fmt.Sprintf("%s.%d", prefix, offset)
		}
	}

	return ""
}

func (s *IPService) assignVMIP(hostNode *models.Node, allNodes []models.Node) string {
	usedIPs := s.collectUsedIPs(allNodes)

	if hostNode.IP != "" {
		prefix := s.subnetPrefix(hostNode.IP)
		hostOctet := parseLastOctet(hostNode.IP)
		if hostOctet == -1 {
			return ""
		}

		zone, ok := ROLE_ZONE[hostNode.Type]
		if !ok {
			zone = FALLBACK_ZONE
		}

		// Container IPs start at host+1
		for i := 1; i < zone.Step; i++ {
			candidate := hostOctet + i
			if !usedIPs[candidate] {
				return fmt.Sprintf("%s.%d", prefix, candidate)
			}
		}
	}
	// Fallback? TS logic: "if host has no IP... assignIP(hostNode.Type...)"
	// But host SHOULD have IP by now.
	return ""
}

func parseLastOctet(ip string) int {
	parts := strings.Split(ip, ".")
	if len(parts) != 4 {
		return -1
	}
	val, err := strconv.Atoi(parts[3])
	if err != nil {
		return -1
	}
	return val
}
