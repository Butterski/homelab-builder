package services

import (
	"errors"
	"fmt"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/wiring"
)

// ── Connections ─────────────────────────────────────────────────────────────

func (ed *topologyEditor) connect(op TopologyOp) (TopologyOp, error) {
	sourceID, err := ed.resolveNode(op.Source, "source")
	if err != nil {
		return op, err
	}
	targetID, err := ed.resolveNode(op.Target, "target")
	if err != nil {
		return op, err
	}
	if sourceID == targetID {
		return op, errors.New("a node cannot be connected to itself")
	}
	source := ed.graph.Nodes[ed.nodeIndex(sourceID)]
	target := ed.graph.Nodes[ed.nodeIndex(targetID)]
	if source.Type == "rack" || target.Type == "rack" {
		return op, errors.New("racks are enclosures and cannot be cabled; mount devices in them with parent")
	}

	hasPowerSource := wiring.IsPowerSource(source.Type) || wiring.IsPowerSource(target.Type)
	wifiClient := isWifiAssociation(source.Type, target.Type)
	connectionType := "ethernet"
	if hasPowerSource {
		connectionType = wiring.EdgeTypePower
	} else if source.Type == "access_point" || target.Type == "access_point" {
		connectionType = "wireless"
	}
	if op.ConnectionType != nil {
		if connectionType, err = cleanEnum("connection_type", *op.ConnectionType, connectionTypes); err != nil {
			return op, err
		}
	}
	power := connectionType == wiring.EdgeTypePower
	if power && !hasPowerSource {
		return op, errors.New("a power cable needs a UPS, PDU or power outlet at one end")
	}
	if !power {
		for _, endpoint := range []NodeDTO{source, target} {
			if wiring.IsPowerSource(endpoint.Type) {
				return op, fmt.Errorf("%q has no network port; use connection_type power", endpoint.Name)
			}
		}
	}
	if power {
		return ed.connectPower(op, source, target)
	}
	if ed.edgeIndex(sourceID, targetID) >= 0 {
		return op, fmt.Errorf("%q and %q are already connected; use update_connection to change that link", source.Name, target.Name)
	}
	if wifiClient && connectionType != "wireless" {
		return op, fmt.Errorf("%q joins %q over Wi-Fi; leave connection_type out or set it to wireless", source.Name, target.Name)
	}
	for _, endpoint := range []NodeDTO{source, target} {
		if uncabledNodeTypes[endpoint.Type] {
			return op, fmt.Errorf("%q is a %s and cannot be cabled", endpoint.Name, endpoint.Type)
		}
	}
	if !wifiClient && !hubNodeTypes[source.Type] && !hubNodeTypes[target.Type] {
		return op, fmt.Errorf("%q (%s) and %q (%s) cannot be cabled directly; connect each to a switch, router, firewall or modem", source.Name, source.Type, target.Name, target.Type)
	}
	for _, endpoint := range []NodeDTO{source, target} {
		if endpoint.Type != nodeTypeLANTable {
			continue
		}
		if connectionType != "ethernet" {
			return op, fmt.Errorf("%q is a LAN table and needs a cabled uplink", endpoint.Name)
		}
		if ed.networkLinkCount(endpoint.ID) > 0 {
			return op, fmt.Errorf("%q already has its uplink; a LAN table connects to one switch", endpoint.Name)
		}
	}
	if err := checkWireless(connectionType, source, target); err != nil {
		return op, err
	}
	if connectionType != "vpn" && !ed.opts.AllowLoops && ed.physicalPathExists(sourceID, targetID) {
		return op, fmt.Errorf("connecting %q and %q would create a network loop: they already reach each other through other devices", source.Name, target.Name)
	}

	sourceHandle := strings.TrimSpace(op.SourceHandle)
	targetHandle := strings.TrimSpace(op.TargetHandle)
	if sourceHandle == "" && targetHandle == "" {
		// Draw cables from the upstream device (bottom port) to the downstream
		// device (top port), the way the canvas and IPAM read direction.
		if upstreamRank(target) < upstreamRank(source) {
			source, target = target, source
		}
	}
	sourceHandle, targetHandle, reversed, err := ed.pickHandles(source, target, sourceHandle, targetHandle)
	if err != nil {
		return op, err
	}
	if reversed {
		source, target = target, source
	}

	edge := EdgeDTO{
		Source: source.ID, SourceHandle: sourceHandle,
		Target: target.ID, TargetHandle: targetHandle,
		Type: connectionType, Speed: "1 GbE", Direction: "auto",
	}
	if connectionType == "wireless" {
		edge.WirelessStandard = "Wi-Fi 6"
	}
	if err := applyConnectionFields(&edge, op); err != nil {
		return op, err
	}
	ed.graph.Edges = append(ed.graph.Edges, edge)

	resolved := op
	resolved.Source, resolved.Target = sourceID, targetID
	return resolved, nil
}

// powerSourceRank orders power sources from the wall inwards; when both ends
// of a power cable are sources the lower rank feeds the other.
var powerSourceRank = map[string]int{"power_outlet": 0, "ups": 1, "pdu": 2}

// connectPower plugs a device into a free socket. The cable always runs from
// a socket (pwr-out-N) of the source to a power input (pwr-in-N).
func (ed *topologyEditor) connectPower(op TopologyOp, source, target NodeDTO) (TopologyOp, error) {
	sourceHandle := strings.TrimSpace(op.SourceHandle)
	targetHandle := strings.TrimSpace(op.TargetHandle)
	swap := false
	switch sourceIsSource, targetIsSource := wiring.IsPowerSource(source.Type), wiring.IsPowerSource(target.Type); {
	case sourceIsSource && targetIsSource:
		swap = powerSourceRank[target.Type] < powerSourceRank[source.Type]
	default:
		swap = targetIsSource
	}
	if swap {
		source, target = target, source
		sourceHandle, targetHandle = targetHandle, sourceHandle
	}
	if wiring.PowerInputCount(target.Type, target.Details) == 0 {
		return op, fmt.Errorf("%q takes no power input", target.Name)
	}
	if ed.powerPathExists(target.ID, source.ID) {
		return op, fmt.Errorf("connecting %q to %q would loop the power back into itself", source.Name, target.Name)
	}
	sourceHandle, targetHandle, err := ed.pickPowerHandles(source, target, sourceHandle, targetHandle)
	if err != nil {
		return op, err
	}
	ed.graph.Edges = append(ed.graph.Edges, EdgeDTO{
		Source: source.ID, SourceHandle: sourceHandle,
		Target: target.ID, TargetHandle: targetHandle,
		Type: wiring.EdgeTypePower, Direction: "auto",
	})
	resolved := op
	resolved.Source, resolved.Target = source.ID, target.ID
	return resolved, nil
}

// pickPowerHandles validates explicit power handles or takes the first free
// socket and the first free power input.
func (ed *topologyEditor) pickPowerHandles(source, target NodeDTO, wantSource, wantTarget string) (string, string, error) {
	used := map[string]bool{}
	for _, edge := range ed.graph.Edges {
		if edge.Type != wiring.EdgeTypePower {
			continue
		}
		used[edge.Source+"|"+edge.SourceHandle] = true
		used[edge.Target+"|"+edge.TargetHandle] = true
	}
	pick := func(node NodeDTO, want, prefix string, count int, full string) (string, error) {
		if want != "" {
			if wiring.PowerHandleIndex(want, prefix) < 0 || !stringInList(ValidHandles(node.Type, node.Details), want) {
				return "", fmt.Errorf("%q has no power handle %q (it has %s)", node.Name, want, strings.Join(ValidHandles(node.Type, node.Details), ", "))
			}
			if used[node.ID+"|"+want] {
				return "", fmt.Errorf("%s on %q already carries a power cable", want, node.Name)
			}
			return want, nil
		}
		for i := range count {
			if handle := fmt.Sprintf("%s%d", prefix, i); !used[node.ID+"|"+handle] {
				return handle, nil
			}
		}
		return "", errors.New(full)
	}
	outputs := wiring.PowerOutputCount(source.Type, source.Details)
	sourceHandle, err := pick(source, wantSource, wiring.PowerOutPrefix, outputs,
		fmt.Sprintf("%q has no free socket (%d in use); raise details.outlets", source.Name, outputs))
	if err != nil {
		return "", "", err
	}
	inputs := wiring.PowerInputCount(target.Type, target.Details)
	targetHandle, err := pick(target, wantTarget, wiring.PowerInPrefix, inputs,
		fmt.Sprintf("%q has no free power input (%d); raise details.psu_count", target.Name, inputs))
	if err != nil {
		return "", "", err
	}
	return sourceHandle, targetHandle, nil
}

// powerPathExists reports whether power already flows from one node to
// another along power cables.
func (ed *topologyEditor) powerPathExists(from, to string) bool {
	next := map[string][]string{}
	for _, edge := range ed.graph.Edges {
		if edge.Type == wiring.EdgeTypePower {
			next[edge.Source] = append(next[edge.Source], edge.Target)
		}
	}
	visited := map[string]bool{from: true}
	queue := []string{from}
	for i := 0; i < len(queue); i++ {
		if queue[i] == to {
			return true
		}
		for _, n := range next[queue[i]] {
			if !visited[n] {
				visited[n] = true
				queue = append(queue, n)
			}
		}
	}
	return false
}

// networkLinkCount counts the network links of a node, leaving out power cables.
func (ed *topologyEditor) networkLinkCount(nodeID string) int {
	count := 0
	for _, edge := range ed.graph.Edges {
		if (edge.Source == nodeID || edge.Target == nodeID) && edge.Type != wiring.EdgeTypePower {
			count++
		}
	}
	return count
}

func (ed *topologyEditor) disconnect(op TopologyOp) (TopologyOp, error) {
	sourceID, targetID, edgeIdx, err := ed.resolveConnection(op)
	if err != nil {
		return op, err
	}
	ed.graph.Edges = append(ed.graph.Edges[:edgeIdx], ed.graph.Edges[edgeIdx+1:]...)
	resolved := op
	resolved.Source, resolved.Target = sourceID, targetID
	return resolved, nil
}

func (ed *topologyEditor) updateConnection(op TopologyOp) (TopologyOp, error) {
	sourceID, targetID, edgeIdx, err := ed.resolveConnection(op)
	if err != nil {
		return op, err
	}
	edge := &ed.graph.Edges[edgeIdx]
	if op.ConnectionType != nil {
		connectionType, err := cleanEnum("connection_type", *op.ConnectionType, connectionTypes)
		if err != nil {
			return op, err
		}
		if edge.Type == wiring.EdgeTypePower && connectionType != wiring.EdgeTypePower {
			return op, errors.New("a power cable stays a power cable")
		}
		if edge.Type != wiring.EdgeTypePower && connectionType == wiring.EdgeTypePower {
			return op, errors.New("draw a power cable with connect")
		}
		source := ed.graph.Nodes[ed.nodeIndex(edge.Source)]
		target := ed.graph.Nodes[ed.nodeIndex(edge.Target)]
		if err := checkWireless(connectionType, source, target); err != nil {
			return op, err
		}
		if isWifiAssociation(source.Type, target.Type) && connectionType != "wireless" {
			return op, fmt.Errorf("%q joins %q over Wi-Fi; that link stays wireless", source.Name, target.Name)
		}
		if (source.Type == nodeTypeLANTable || target.Type == nodeTypeLANTable) && connectionType != "ethernet" {
			return op, errors.New("a LAN table needs a cabled uplink")
		}
		edge.Type = connectionType
		if connectionType != "wireless" {
			edge.WirelessStandard = ""
		} else if edge.WirelessStandard == "" {
			edge.WirelessStandard = "Wi-Fi 6"
		}
	}
	if err := applyConnectionFields(edge, op); err != nil {
		return op, err
	}
	resolved := op
	resolved.Source, resolved.Target = sourceID, targetID
	return resolved, nil
}

func (ed *topologyEditor) resolveConnection(op TopologyOp) (string, string, int, error) {
	sourceID, err := ed.resolveNode(op.Source, "source")
	if err != nil {
		return "", "", -1, err
	}
	targetID, err := ed.resolveNode(op.Target, "target")
	if err != nil {
		return "", "", -1, err
	}
	edgeIdx := ed.edgeIndex(sourceID, targetID)
	if edgeIdx < 0 {
		return "", "", -1, fmt.Errorf("%q and %q are not connected", ed.graph.Nodes[ed.nodeIndex(sourceID)].Name, ed.graph.Nodes[ed.nodeIndex(targetID)].Name)
	}
	return sourceID, targetID, edgeIdx, nil
}

func checkWireless(connectionType string, source, target NodeDTO) error {
	if connectionType != "wireless" {
		return nil
	}
	for _, nodeType := range []string{source.Type, target.Type} {
		if nodeType == "access_point" || nodeType == "iot" {
			return nil
		}
	}
	return errors.New("a wireless connection needs an access point or IoT device on one end")
}

func applyConnectionFields(edge *EdgeDTO, op TopologyOp) error {
	if op.Speed != nil {
		speed, err := cleanText("speed", *op.Speed, 40)
		if err != nil {
			return err
		}
		edge.Speed = speed
	}
	if op.Direction != nil {
		direction, err := cleanEnum("direction", *op.Direction, connectionDirections)
		if err != nil {
			return err
		}
		edge.Direction = direction
	}
	if op.WirelessStandard != nil {
		standard, err := cleanText("wireless_standard", *op.WirelessStandard, 40)
		if err != nil {
			return err
		}
		edge.WirelessStandard = standard
	}
	if op.Subnet != nil {
		subnet, err := cleanText("subnet", *op.Subnet, 64)
		if err != nil {
			return err
		}
		edge.Subnet = subnet
	}
	return nil
}

// pickHandles chooses the port handles for a new cable. Explicit handles are
// validated; missing ones are auto-picked. reversed reports that the cable had
// to be drawn target-to-source to find free ports.
func (ed *topologyEditor) pickHandles(source, target NodeDTO, wantSource, wantTarget string) (string, string, bool, error) {
	types := ed.nodeTypes()
	usedSource := usedHandles(source.ID, types, ed.graph.Edges)
	usedTarget := usedHandles(target.ID, types, ed.graph.Edges)

	check := func(node NodeDTO, handle string, used map[string]bool) error {
		if strings.HasPrefix(handle, "pwr-") {
			return fmt.Errorf("%s on %q is a power port; use connection_type power", handle, node.Name)
		}
		if !stringInList(ValidHandles(node.Type, node.Details), handle) {
			return fmt.Errorf("%q has no port %q (it has %s)", node.Name, handle, strings.Join(ValidHandles(node.Type, node.Details), ", "))
		}
		if used[handle] {
			return fmt.Errorf("port %s on %q already carries a cable", handle, node.Name)
		}
		return nil
	}
	if wantSource != "" {
		if err := check(source, wantSource, usedSource); err != nil {
			return "", "", false, err
		}
	}
	if wantTarget != "" {
		if err := check(target, wantTarget, usedTarget); err != nil {
			return "", "", false, err
		}
	}

	fullError := func(node NodeDTO) error {
		count := PortCount(node.Type, node.Details)
		if HasDynamicPorts(node.Type) {
			return fmt.Errorf("%q has no free port (%d in use); raise details.ports with update_node or connect through a switch", node.Name, count)
		}
		return fmt.Errorf("%q (%s) has a single network port and it is in use; connect it through a switch", node.Name, node.Type)
	}

	switch {
	case wantSource != "" && wantTarget != "":
		return wantSource, wantTarget, false, nil
	case wantSource != "":
		if !usedTarget[TargetHandle] {
			return wantSource, TargetHandle, false, nil
		}
		if handle, ok := firstFreePort(target.Type, target.Details, usedTarget); ok {
			return wantSource, handle, false, nil
		}
		return "", "", false, fullError(target)
	case wantTarget != "":
		if handle, ok := firstFreePort(source.Type, source.Details, usedSource); ok {
			return handle, wantTarget, false, nil
		}
		return "", "", false, fullError(source)
	}

	sourcePort, sourceHasPort := firstFreePort(source.Type, source.Details, usedSource)
	if sourceHasPort {
		if !usedTarget[TargetHandle] {
			return sourcePort, TargetHandle, false, nil
		}
		if handle, ok := firstFreePort(target.Type, target.Details, usedTarget); ok {
			return sourcePort, handle, false, nil
		}
		return "", "", false, fullError(target)
	}
	// The upstream device is out of bottom ports: draw the cable the other way
	// if the downstream device has one and the upstream top port is free.
	if targetPort, ok := firstFreePort(target.Type, target.Details, usedTarget); ok && !usedSource[TargetHandle] {
		return targetPort, TargetHandle, true, nil
	}
	return "", "", false, fullError(source)
}

// physicalPathExists reports whether two nodes already reach each other over
// network cables. Power feeds and VPN overlays are not part of that graph.
func (ed *topologyEditor) physicalPathExists(from, to string) bool {
	adjacency := map[string][]string{}
	for _, edge := range ed.graph.Edges {
		if edge.Type == "vpn" || edge.Type == wiring.EdgeTypePower {
			continue
		}
		adjacency[edge.Source] = append(adjacency[edge.Source], edge.Target)
		adjacency[edge.Target] = append(adjacency[edge.Target], edge.Source)
	}
	visited := map[string]bool{from: true}
	queue := []string{from}
	for i := 0; i < len(queue); i++ {
		if queue[i] == to {
			return true
		}
		for _, next := range adjacency[queue[i]] {
			if !visited[next] {
				visited[next] = true
				queue = append(queue, next)
			}
		}
	}
	return false
}

func detailBool(details map[string]any, key string) bool {
	value, _ := details[key].(bool)
	return value
}

// isNATGateway mirrors the IPAM rule for nodes that open a downstream subnet.
func isNATGateway(node NodeDTO) bool {
	if node.Type != "server_v2" && node.Type != "vps" && node.Type != "firewall" {
		return false
	}
	return detailBool(node.Details, "nat_enabled") ||
		(detailBool(node.Details, "routing_enabled") && detailBool(node.Details, "dhcp_enabled"))
}

// upstreamRank orders devices from the internet edge inwards; a lower rank is
// drawn as the source (upstream) end of a cable.
func upstreamRank(node NodeDTO) int {
	switch node.Type {
	case "modem":
		return 0
	case "router":
		return 1
	case "firewall":
		return 2
	case "switch":
		return 3
	case "access_point":
		return 4
	}
	if isNATGateway(node) {
		return 2
	}
	return 5
}
