package services

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/gaming"
)

// Node types and rules that gaming builds add. The canvas mirrors them in
// frontend/src/lib/hardware-config.ts and features/gaming/lib/table.ts.

const (
	nodeTypeConsole  = "console"
	nodeTypeLANTable = "lan_table"

	// A LAN table stands for a row of seats and the small switch on it.
	maxTableSeats     = 24
	defaultTableSeats = 8
	defaultSeatWatts  = 350
	minSeatWatts      = 50
	maxSeatWatts      = 2000
	tableSwitchWatts  = 10
	maxTableSwitch    = 52
	maxWifiClients    = 500
)

// tableSwitchSizes are the port counts small unmanaged switches are sold in.
var tableSwitchSizes = []int{5, 8, 16, 24, 48}

var tableSwitchSpeeds = []string{"1 GbE", "2.5 GbE", "10 GbE"}

var consolePlatforms = []string{"playstation", "xbox", "switch", "handheld", "other"}

var circuitRefPattern = regexp.MustCompile(`^[A-Za-z0-9_\-]{1,40}$`)

// wifiClientNodeTypes can join an access point's network without a cable.
var wifiClientNodeTypes = map[string]bool{"pc": true, "minipc": true, "sbc": true, nodeTypeConsole: true}

// floorNodeTypes stand on a desk or the floor and cannot be mounted in a rack.
var floorNodeTypes = map[string]bool{nodeTypeConsole: true, nodeTypeLANTable: true}

// isWifiAssociation reports whether a link is a client joining an access
// point's Wi-Fi. It is keyed on the two device types, not on the connection
// type, because an access point's own uplink is also drawn as wireless.
func isWifiAssociation(typeA, typeB string) bool {
	return (typeA == "access_point" && wifiClientNodeTypes[typeB]) ||
		(typeB == "access_point" && wifiClientNodeTypes[typeA])
}

// detailInt reads a whole number from details, whatever numeric type it has.
func detailInt(details map[string]any, key string) (int, bool) {
	number, ok := asNumber(details[key])
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) {
		return 0, false
	}
	return int(math.Round(number)), true
}

// tableSwitchPortsFor returns the smallest common switch that seats every
// player and still has a port left for the uplink.
func tableSwitchPortsFor(seats int) int {
	for _, size := range tableSwitchSizes {
		if size >= seats+1 {
			return size
		}
	}
	return seats + 1
}

// tableSeats is the number of seats at a LAN table.
func tableSeats(details map[string]any) int {
	if seats, ok := detailInt(details, "seats"); ok && seats > 0 {
		return seats
	}
	return defaultTableSeats
}

// tablePowerDraw is what a full table pulls: every seat plus the table switch.
func tablePowerDraw(details map[string]any) float64 {
	watts := float64(defaultSeatWatts)
	if value, ok := asNumber(details["seat_watts"]); ok && value > 0 {
		watts = value
	}
	return float64(tableSeats(details))*watts + tableSwitchWatts
}

// applyTableDefaults fills in what a LAN table needs to be planned and checks
// that its switch can take every seat.
func applyTableDefaults(details map[string]any) error {
	if _, ok := detailInt(details, "seats"); !ok {
		details["seats"] = float64(defaultTableSeats)
	}
	if _, ok := asNumber(details["seat_watts"]); !ok {
		details["seat_watts"] = float64(defaultSeatWatts)
	}
	seats := tableSeats(details)
	ports, ok := detailInt(details, "switch_ports")
	if !ok {
		ports = tableSwitchPortsFor(seats)
		details["switch_ports"] = float64(ports)
	}
	if ports < seats+1 {
		return fmt.Errorf("a table with %d seats needs a switch with at least %d ports (one is the uplink); details.switch_ports is %d", seats, seats+1, ports)
	}
	if _, ok := details["switch_speed"].(string); !ok {
		details["switch_speed"] = tableSwitchSpeeds[0]
	}
	return nil
}

// cleanGamingDetail validates the details keys gaming builds add. handled is
// false for every other key.
func cleanGamingDetail(key string, value any, nodeType string) (cleaned any, handled bool, err error) {
	whole := func(low, high int) (any, bool, error) {
		number, ok := asNumber(value)
		if !ok || number != math.Trunc(number) || number < float64(low) || number > float64(high) {
			return nil, true, fmt.Errorf("details.%s must be a whole number from %d to %d", key, low, high)
		}
		return number, true, nil
	}
	switch key {
	case "seats":
		if nodeType != nodeTypeLANTable {
			return nil, true, errors.New("details.seats only applies to lan_table nodes")
		}
		return whole(1, maxTableSeats)
	case "seat_watts":
		if nodeType != nodeTypeLANTable {
			return nil, true, errors.New("details.seat_watts only applies to lan_table nodes")
		}
		return whole(minSeatWatts, maxSeatWatts)
	case "switch_ports":
		if nodeType != nodeTypeLANTable {
			return nil, true, errors.New("details.switch_ports only applies to lan_table nodes")
		}
		return whole(2, maxTableSwitch)
	case "switch_speed":
		if nodeType != nodeTypeLANTable {
			return nil, true, errors.New("details.switch_speed only applies to lan_table nodes")
		}
		text, _ := value.(string)
		if !stringInList(tableSwitchSpeeds, text) {
			return nil, true, errors.New("details.switch_speed must be one of 1 GbE, 2.5 GbE, 10 GbE")
		}
		return text, true, nil
	case "wifi_clients":
		if nodeType != "access_point" {
			return nil, true, errors.New("details.wifi_clients only applies to access_point nodes")
		}
		return whole(0, maxWifiClients)
	case "platform":
		if nodeType != nodeTypeConsole {
			return nil, true, errors.New("details.platform only applies to console nodes")
		}
		text, _ := value.(string)
		platform, err := cleanEnum("details.platform", text, consolePlatforms)
		return platform, true, err
	case "circuit":
		text, _ := value.(string)
		if !circuitRefPattern.MatchString(text) {
			return nil, true, errors.New("details.circuit must be the id of a circuit in the gaming plan")
		}
		return text, true, nil
	}
	return nil, false, nil
}

// gamingNodeIssues checks a saved node against the rules of the gaming node
// types, whoever built the graph: the canvas, an import or a proposal.
func gamingNodeIssues(node NodeDTO) []string {
	var issues []string
	if floorNodeTypes[node.Type] && len(node.InternalComponents) > 0 {
		issues = append(issues, fmt.Sprintf("%s nodes cannot hold internal components", node.Type))
	}
	for _, key := range []string{"seats", "seat_watts", "switch_ports", "switch_speed", "wifi_clients", "platform", "circuit"} {
		value, present := node.Details[key]
		if !present || value == nil {
			continue
		}
		if _, _, err := cleanGamingDetail(key, value, node.Type); err != nil {
			issues = append(issues, fmt.Sprintf("%s: %v", node.Name, err))
		}
	}
	if node.Type == nodeTypeLANTable {
		seats := tableSeats(node.Details)
		if ports, ok := detailInt(node.Details, "switch_ports"); ok && ports < seats+1 {
			issues = append(issues, fmt.Sprintf("%s: %d seats need a switch with at least %d ports", node.Name, seats, seats+1))
		}
	}
	for _, vm := range node.VMs {
		instance, found, err := gaming.ParseInstance(vm.Details[gaming.InstanceKey])
		if !found {
			continue
		}
		if err == nil {
			_, _, err = instance.Normalize()
		}
		if err != nil {
			issues = append(issues, fmt.Sprintf("%s on %s: %v", vm.Name, node.Name, err))
		}
	}
	return issues
}

// setPlan changes what a build is planned for and merges a patch into its
// gaming plan. The patch is kept as given, so applying the proposal later
// leaves settings the owner changed in the meantime alone.
func (ed *topologyEditor) setPlan(op TopologyOp) (TopologyOp, error) {
	if strings.TrimSpace(op.Kind) == "" && len(op.Plan) == 0 {
		return op, errors.New("set_plan needs kind, plan or both")
	}
	if strings.TrimSpace(op.Kind) != "" {
		kind, err := gaming.ParseKind(strings.ToLower(strings.TrimSpace(op.Kind)))
		if err != nil {
			return op, err
		}
		ed.graph.Kind = string(kind)
	}
	if len(op.Plan) > 0 {
		current := gaming.Plan{}
		if ed.graph.GamingPlan != nil {
			current = *ed.graph.GamingPlan
		}
		merged, err := gaming.MergePlan(current, op.Plan)
		if err != nil {
			return op, err
		}
		ed.graph.GamingPlan = &merged
	}
	return op, nil
}

// dhcpClientsOf is the number of leases a node will ask the DHCP server for on
// behalf of devices that are not drawn on the canvas: the seats of a LAN table
// and the phones and laptops expected on an access point.
func dhcpClientsOf(nodeType string, details map[string]any) int {
	switch nodeType {
	case nodeTypeLANTable:
		return tableSeats(details)
	case "access_point":
		if clients, ok := detailInt(details, "wifi_clients"); ok && clients > 0 {
			return clients
		}
	}
	return 0
}
