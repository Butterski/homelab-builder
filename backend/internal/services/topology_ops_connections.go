package services

import (
	"errors"
	"fmt"
	"strings"
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
	if ed.edgeIndex(sourceID, targetID) >= 0 {
		return op, fmt.Errorf("%q and %q are already connected; use update_connection to change that link", source.Name, target.Name)
	}
	if source.Type == "rack" || target.Type == "rack" {
		return op, errors.New("racks are enclosures and cannot be cabled; mount devices in them with parent")
	}

	power := isPowerEdge(source.Type, target.Type)
	connectionType := "ethernet"
	if source.Type == "access_point" || target.Type == "access_point" {
		connectionType = "wireless"
	}
	if op.ConnectionType != nil {
		if connectionType, err = cleanEnum("connection_type", *op.ConnectionType, connectionTypes); err != nil {
			return op, err
		}
	}
	if !power {
		for _, endpoint := range []NodeDTO{source, target} {
			if uncabledNodeTypes[endpoint.Type] {
				return op, fmt.Errorf("%q is a %s and cannot be cabled", endpoint.Name, endpoint.Type)
			}
		}
		if !hubNodeTypes[source.Type] && !hubNodeTypes[target.Type] {
			return op, fmt.Errorf("%q (%s) and %q (%s) cannot be cabled directly; connect each to a switch, router, firewall or modem", source.Name, source.Type, target.Name, target.Type)
		}
	}
	if err := checkWireless(connectionType, source, target); err != nil {
		return op, err
	}
	if !power && connectionType != "vpn" && !ed.opts.AllowLoops && ed.physicalPathExists(sourceID, targetID) {
		return op, fmt.Errorf("connecting %q and %q would create a network loop: they already reach each other through other devices", source.Name, target.Name)
	}

	sourceHandle := strings.TrimSpace(op.SourceHandle)
	targetHandle := strings.TrimSpace(op.TargetHandle)
	if sourceHandle == "" && targetHandle == "" {
		// Draw cables from the upstream device (bottom port) to the downstream
		// device (top port), the way the canvas and IPAM read direction.
		swap := upstreamRank(target) < upstreamRank(source)
		if power {
			swap = target.Type == "ups" && source.Type != "ups"
		}
		if swap {
			source, target = target, source
		}
	}
	sourceHandle, targetHandle, reversed, err := ed.pickHandles(source, target, sourceHandle, targetHandle, power)
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
		source := ed.graph.Nodes[ed.nodeIndex(edge.Source)]
		target := ed.graph.Nodes[ed.nodeIndex(edge.Target)]
		if err := checkWireless(connectionType, source, target); err != nil {
			return op, err
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
func (ed *topologyEditor) pickHandles(source, target NodeDTO, wantSource, wantTarget string, power bool) (string, string, bool, error) {
	types := ed.nodeTypes()
	usedSource := usedHandles(source.ID, types, ed.graph.Edges)
	usedTarget := usedHandles(target.ID, types, ed.graph.Edges)

	check := func(node NodeDTO, handle string, used map[string]bool) error {
		if !stringInList(ValidHandles(node.Type, node.Details), handle) {
			return fmt.Errorf("%q has no port %q (it has %s)", node.Name, handle, strings.Join(ValidHandles(node.Type, node.Details), ", "))
		}
		if !power && used[handle] {
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

	if power {
		// Power feeds share ports with network cables, so spread them over the
		// UPS outlets instead of looking for an unused one.
		if wantSource == "" {
			outlets := 0
			for _, edge := range ed.graph.Edges {
				if edge.Source == source.ID {
					outlets++
				}
			}
			wantSource = fmt.Sprintf("eth%d", outlets%PortCount(source.Type, source.Details))
		}
		if wantTarget == "" {
			wantTarget = TargetHandle
		}
		return wantSource, wantTarget, false, nil
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
	types := ed.nodeTypes()
	adjacency := map[string][]string{}
	for _, edge := range ed.graph.Edges {
		if edge.Type == "vpn" || isPowerEdge(types[edge.Source], types[edge.Target]) {
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
