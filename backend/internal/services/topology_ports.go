package services

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// The builder canvas only renders a connection when both of its port handles
// exist on the node cards. These tables mirror the frontend's HARDWARE_FEATURES
// (frontend/src/lib/hardware-config.ts) and port-count.ts so server-built
// topologies render exactly like hand-drawn ones.

// TargetHandle is the single "uplink" handle every hardware card has on top.
const TargetHandle = "target-0"

var dynamicPortTypes = map[string]bool{
	"server": true, "server_v2": true, "firewall": true, "vps": true,
	"router": true, "switch": true, "modem": true, "ups": true,
}

var defaultPortCounts = map[string]int{
	"router": 4, "switch": 4, "server": 4, "server_v2": 4,
	"firewall": 4, "vps": 2, "modem": 4, "ups": 2,
}

// vmHostNodeTypes can run virtual machines, containers and services.
var vmHostNodeTypes = map[string]bool{
	"server": true, "server_v2": true, "vps": true, "pc": true,
	"minipc": true, "sbc": true, "nas": true, "iot": true,
}

// componentHostNodeTypes can hold internal components (disks, GPUs, cards).
var componentHostNodeTypes = map[string]bool{
	"server": true, "server_v2": true, "vps": true, "pc": true,
	"minipc": true, "sbc": true, "iot": true, "nas": true,
}

var componentTypes = map[string]bool{"disk": true, "gpu": true, "hba": true, "pcie": true}

// hubNodeTypes may be cabled to anything; every other pair needs one of them.
var hubNodeTypes = map[string]bool{
	"router": true, "switch": true, "modem": true, "firewall": true,
	"server_v2": true, "vps": true, "iot": true, "ups": true,
}

var uncabledNodeTypes = map[string]bool{
	"disk": true, "gpu": true, "hba": true, "pcie": true, "pdu": true, "rack": true,
}

var multiplierPattern = regexp.MustCompile(`(?i)(\d+)\s*[x×]`)
var firstIntegerPattern = regexp.MustCompile(`\d+`)

// HasDynamicPorts reports whether a node type renders one handle per port.
func HasDynamicPorts(nodeType string) bool {
	return dynamicPortTypes[nodeType]
}

// ParsePortCount reads a ports value the way the canvas does: a positive
// number, a numeric string, "2x SFP+ / 4x RJ45" style sums, or the first integer.
func ParsePortCount(value any) (int, bool) {
	switch v := value.(type) {
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) || v <= 0 {
			return 0, false
		}
		return int(v), int(v) > 0
	case int:
		return v, v > 0
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return 0, false
		}
		if direct, err := strconv.ParseFloat(trimmed, 64); err == nil && !math.IsInf(direct, 0) && direct > 0 {
			return int(direct), int(direct) > 0
		}
		if matches := multiplierPattern.FindAllStringSubmatch(trimmed, -1); len(matches) > 0 {
			total := 0
			for _, match := range matches {
				n, _ := strconv.Atoi(match[1])
				total += n
			}
			return total, total > 0
		}
		if first := firstIntegerPattern.FindString(trimmed); first != "" {
			n, _ := strconv.Atoi(first)
			return n, n > 0
		}
	}
	return 0, false
}

// PortCount is the number of ethN source handles the canvas renders for a node.
func PortCount(nodeType string, details map[string]any) int {
	if !HasDynamicPorts(nodeType) {
		return 1
	}
	if parsed, ok := ParsePortCount(details["ports"]); ok {
		return parsed
	}
	if fallback, ok := defaultPortCounts[nodeType]; ok {
		return fallback
	}
	return 1
}

// ValidHandles lists every handle id that exists on a node card.
func ValidHandles(nodeType string, details map[string]any) []string {
	if nodeType == "rack" {
		return nil
	}
	count := PortCount(nodeType, details)
	handles := make([]string, 0, count+1)
	handles = append(handles, TargetHandle)
	for i := 0; i < count; i++ {
		handles = append(handles, fmt.Sprintf("eth%d", i))
	}
	return handles
}

// handlePortIndex returns N for "ethN", or -1 for any other handle.
func handlePortIndex(handle string) int {
	if !strings.HasPrefix(handle, "eth") {
		return -1
	}
	n, err := strconv.Atoi(strings.TrimPrefix(handle, "eth"))
	if err != nil || n < 0 {
		return -1
	}
	return n
}

// isPowerEdge reports whether a connection is a UPS power feed. Power cables do
// not occupy network ports.
func isPowerEdge(sourceType, targetType string) bool {
	return sourceType == "ups" || targetType == "ups"
}

// usedHandles collects the handles on nodeID that already carry a cable.
// Power feeds are ignored; VPN links count because the canvas draws them.
func usedHandles(nodeID string, nodeTypes map[string]string, edges []EdgeDTO) map[string]bool {
	used := map[string]bool{}
	for _, edge := range edges {
		if isPowerEdge(nodeTypes[edge.Source], nodeTypes[edge.Target]) {
			continue
		}
		// Wi-Fi clients do not take the access point's port; it carries the uplink.
		if nodeTypes[nodeID] == "access_point" && isWifiAssociation(nodeTypes[edge.Source], nodeTypes[edge.Target]) {
			continue
		}
		if edge.Source == nodeID && edge.SourceHandle != "" {
			used[edge.SourceHandle] = true
		}
		if edge.Target == nodeID && edge.TargetHandle != "" {
			used[edge.TargetHandle] = true
		}
	}
	return used
}

// firstFreePort returns the lowest ethN handle on a node that carries no cable.
func firstFreePort(nodeType string, details map[string]any, used map[string]bool) (string, bool) {
	for i := 0; i < PortCount(nodeType, details); i++ {
		handle := fmt.Sprintf("eth%d", i)
		if !used[handle] {
			return handle, true
		}
	}
	return "", false
}

// highestUsedPort returns the largest ethN index in use on a node, or -1.
func highestUsedPort(nodeID string, edges []EdgeDTO) int {
	highest := -1
	for _, edge := range edges {
		if edge.Source == nodeID {
			if index := handlePortIndex(edge.SourceHandle); index > highest {
				highest = index
			}
		}
		if edge.Target == nodeID {
			if index := handlePortIndex(edge.TargetHandle); index > highest {
				highest = index
			}
		}
	}
	return highest
}

// PortUsage summarises a node's cable ports for views shown to LLM clients.
type PortUsage struct {
	Total int      `json:"total"`
	Used  []string `json:"used"`
	Free  []string `json:"free"`
}

// NodePortUsage reports, per cabled node, which ethN ports carry a cable and
// which are free, using the same rules as the automatic port picker.
func NodePortUsage(input SyncGraphInput) map[string]PortUsage {
	types := make(map[string]string, len(input.Nodes))
	for _, node := range input.Nodes {
		types[node.ID] = node.Type
	}
	usage := make(map[string]PortUsage, len(input.Nodes))
	for _, node := range input.Nodes {
		if uncabledNodeTypes[node.Type] {
			continue
		}
		used := usedHandles(node.ID, types, input.Edges)
		ports := PortUsage{Total: PortCount(node.Type, node.Details), Used: []string{}, Free: []string{}}
		for i := 0; i < ports.Total; i++ {
			handle := fmt.Sprintf("eth%d", i)
			if used[handle] {
				ports.Used = append(ports.Used, handle)
			} else {
				ports.Free = append(ports.Free, handle)
			}
		}
		usage[node.ID] = ports
	}
	return usage
}
