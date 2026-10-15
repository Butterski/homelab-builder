package wiring

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// Node is a device as the checks see it. DrawW is its own power draw plus
// the draw of its components.
type Node struct {
	ID, Name, Type string
	Details        map[string]any
	DrawW          float64
}

// Edge is one cable of the build.
type Edge struct {
	Source, SourceHandle, Target, TargetHandle, Type string
}

// Issue is one plan warning, attached to a node.
type Issue struct {
	NodeID, Message string
}

// SourceLoad is what a UPS, PDU or outlet feeds, stored as details.power_load.
type SourceLoad struct {
	LoadW       int  `json:"load_w"`
	CapacityW   *int `json:"capacity_w"`
	SocketsUsed int  `json:"sockets_used"`
	Sockets     int  `json:"sockets"`
}

// feed is one power cable into a node, by input index.
type feed struct {
	source string
	input  int
}

// powerGraph indexes the nodes and the power cables between them.
type powerGraph struct {
	nodes map[string]*Node
	// in lists each node's feeds sorted by input index; out the cables
	// leaving each source, in edge order.
	in  map[string][]feed
	out map[string][]Edge
}

func newPowerGraph(nodes []Node, edges []Edge) *powerGraph {
	graph := &powerGraph{nodes: make(map[string]*Node, len(nodes)), in: map[string][]feed{}, out: map[string][]Edge{}}
	for i := range nodes {
		graph.nodes[nodes[i].ID] = &nodes[i]
	}
	for _, edge := range edges {
		if edge.Type != EdgeTypePower || graph.nodes[edge.Source] == nil || graph.nodes[edge.Target] == nil {
			continue
		}
		graph.out[edge.Source] = append(graph.out[edge.Source], edge)
		graph.in[edge.Target] = append(graph.in[edge.Target], feed{source: edge.Source, input: PowerHandleIndex(edge.TargetHandle, PowerInPrefix)})
	}
	for id := range graph.in {
		feeds := graph.in[id]
		sort.SliceStable(feeds, func(a, b int) bool { return feeds[a].input < feeds[b].input })
	}
	return graph
}

// pluggedInputs counts the distinct inputs of a node that have a cable.
func (g *powerGraph) pluggedInputs(id string) int {
	seen := map[int]bool{}
	for _, f := range g.in[id] {
		seen[f.input] = true
	}
	return len(seen)
}

// chainVoltage walks up from a node through its first connected input until
// it reaches a wall outlet, and returns that outlet's voltage (230 V if none).
func (g *powerGraph) chainVoltage(id string) float64 {
	visited := map[string]bool{}
	for current := id; !visited[current]; {
		visited[current] = true
		node := g.nodes[current]
		if node.Type == "power_outlet" {
			return outletVoltage(node.Details)
		}
		feeds := g.in[current]
		if len(feeds) == 0 {
			break
		}
		current = feeds[0].source
	}
	return defaultVoltage
}

// loadCalc computes the load of every source, memoised. Each cable into a
// device carries its demand split evenly over the inputs that are plugged in.
type loadCalc struct {
	graph    *powerGraph
	demand   map[string]float64
	load     map[string]float64
	visiting map[string]bool
}

func (c *loadCalc) loadOf(id string) float64 {
	if value, done := c.load[id]; done {
		return value
	}
	if c.visiting[id] {
		return 0
	}
	c.visiting[id] = true
	total := 0.0
	for _, edge := range c.graph.out[id] {
		plugged := c.graph.pluggedInputs(edge.Target)
		if plugged == 0 {
			continue
		}
		total += c.demandOf(edge.Target) / float64(plugged)
	}
	delete(c.visiting, id)
	c.load[id] = total
	return total
}

func (c *loadCalc) demandOf(id string) float64 {
	if value, done := c.demand[id]; done {
		return value
	}
	if c.visiting[id] {
		return 0
	}
	node := c.graph.nodes[id]
	value := node.DrawW
	if IsPowerSource(node.Type) {
		value += c.loadOf(id)
	}
	c.demand[id] = value
	return value
}

// PowerLoads returns the load, capacity and socket use of every power source.
func PowerLoads(nodes []Node, edges []Edge) map[string]SourceLoad {
	graph := newPowerGraph(nodes, edges)
	return graph.sourceLoads(nodes)
}

func (g *powerGraph) sourceLoads(nodes []Node) map[string]SourceLoad {
	calc := &loadCalc{graph: g, demand: map[string]float64{}, load: map[string]float64{}, visiting: map[string]bool{}}
	out := map[string]SourceLoad{}
	for _, node := range nodes {
		if !IsPowerSource(node.Type) {
			continue
		}
		entry := SourceLoad{
			LoadW:       int(math.Round(calc.loadOf(node.ID))),
			SocketsUsed: len(g.out[node.ID]),
			Sockets:     PowerOutputCount(node.Type, node.Details),
		}
		voltage := 0.0
		if node.Type == "pdu" {
			voltage = g.chainVoltage(node.ID)
		}
		if capacity := int(math.Round(CapacityW(node.Type, node.Details, voltage))); capacity > 0 {
			entry.CapacityW = &capacity
		}
		out[node.ID] = entry
	}
	return out
}

// Warnings returns the plan warnings about power, port roles and VLANs:
// first per node in input order, then per cable in edge order.
func Warnings(nodes []Node, edges []Edge) []Issue {
	graph := newPowerGraph(nodes, edges)
	loads := graph.sourceLoads(nodes)
	var issues []Issue
	for _, node := range nodes {
		name := displayName(&node)
		if load, ok := loads[node.ID]; ok {
			if load.CapacityW != nil && load.LoadW > *load.CapacityW {
				issues = append(issues, Issue{node.ID, fmt.Sprintf("%s is overloaded: %d W on %d W", name, load.LoadW, *load.CapacityW)})
			}
			if load.Sockets > 0 && load.SocketsUsed >= load.Sockets {
				issues = append(issues, Issue{node.ID, fmt.Sprintf("All %d sockets of %s are in use", load.Sockets, name)})
			}
		}
		inputs := PowerInputCount(node.Type, node.Details)
		plugged := graph.pluggedInputs(node.ID)
		if inputs >= 2 && plugged >= 1 && plugged < inputs {
			issues = append(issues, Issue{node.ID, fmt.Sprintf("%s has %d power supplies and %d plugged in", name, inputs, plugged)})
		}
		if plugged >= 2 {
			if message, found := graph.sharedDependency(node.ID, name); found {
				issues = append(issues, Issue{node.ID, message})
			}
		}
	}
	for _, edge := range edges {
		issues = append(issues, cableIssues(graph, edge)...)
	}
	return issues
}

// sharedDependency finds the first pair of power supplies of a node whose
// chains up to the wall meet in the same source or circuit.
func (g *powerGraph) sharedDependency(id, name string) (string, bool) {
	type chain struct {
		input  int
		tokens []string
	}
	var chains []chain
	seenInput := map[int]bool{}
	for _, f := range g.in[id] {
		if seenInput[f.input] {
			continue
		}
		seenInput[f.input] = true
		chains = append(chains, chain{input: f.input, tokens: g.upstreamTokens(f.source)})
	}
	for i := range chains {
		for j := i + 1; j < len(chains); j++ {
			later := map[string]bool{}
			for _, token := range chains[j].tokens {
				later[token] = true
			}
			for _, token := range chains[i].tokens {
				if later[token] {
					return fmt.Sprintf("Power supplies %d and %d of %s both depend on %s", chains[i].input+1, chains[j].input+1, name, g.tokenName(token)), true
				}
			}
		}
	}
	return "", false
}

// upstreamTokens lists, in BFS order, the source and everything that feeds
// it; after each node with a circuit comes the token "circuit:<id>".
func (g *powerGraph) upstreamTokens(start string) []string {
	var tokens []string
	visited := map[string]bool{start: true}
	queue := []string{start}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		tokens = append(tokens, current)
		if circuit := circuitOf(g.nodes[current].Details); circuit != "" {
			tokens = append(tokens, "circuit:"+circuit)
		}
		for _, f := range g.in[current] {
			if !visited[f.source] {
				visited[f.source] = true
				queue = append(queue, f.source)
			}
		}
	}
	return tokens
}

func (g *powerGraph) tokenName(token string) string {
	if circuit, ok := strings.CutPrefix(token, "circuit:"); ok {
		return "circuit " + circuit
	}
	return displayName(g.nodes[token])
}

func circuitOf(details map[string]any) string {
	switch value := details["circuit"].(type) {
	case string:
		return strings.TrimSpace(value)
	case nil:
		return ""
	default:
		if n, ok := number(value); ok {
			return strconv.FormatFloat(n, 'f', -1, 64)
		}
	}
	return ""
}

// cableIssues reports a cable on a port marked unused and a cable whose ends
// share no VLAN.
func cableIssues(graph *powerGraph, edge Edge) []Issue {
	if edge.Type == EdgeTypePower {
		return nil
	}
	source, target := graph.nodes[edge.Source], graph.nodes[edge.Target]
	if source == nil || target == nil {
		return nil
	}
	sourceHandle, targetHandle := defaultHandles(edge.SourceHandle, edge.TargetHandle)
	var issues []Issue
	for _, end := range []struct {
		node   *Node
		handle string
	}{{source, sourceHandle}, {target, targetHandle}} {
		if !isGateway(end.node.Type) {
			continue
		}
		role := ReadPortConfig(end.node.Details)[end.handle].Role
		if role == "" {
			role = DefaultRole(end.handle)
		}
		if role == "unused" {
			issues = append(issues, Issue{end.node.ID, fmt.Sprintf("%s of %s is marked unused but carries a cable", end.handle, displayName(end.node))})
		}
	}
	if edge.Type == "wireless" {
		return issues
	}
	if _, _, mismatch := CableVLAN(source.Type, source.Details, sourceHandle, target.Type, target.Details, targetHandle); mismatch {
		message := fmt.Sprintf("No shared VLAN between %s %s (%s) and %s %s (%s)",
			displayName(source), sourceHandle, joinIDs(VLANSet(source.Type, source.Details, sourceHandle)),
			displayName(target), targetHandle, joinIDs(VLANSet(target.Type, target.Details, targetHandle)))
		issues = append(issues, Issue{source.ID, message}, Issue{target.ID, message})
	}
	return issues
}

// CableVLAN works out which VLANs a cable carries and its colour. Each end
// carries the VLAN set of its port; both present without overlap is a
// mismatch. The colour is the switch end's untagged VLAN colour when that
// VLAN is carried, otherwise the lowest carried id with a colour at either end.
func CableVLAN(srcType string, srcDetails map[string]any, srcHandle string, tgtType string, tgtDetails map[string]any, tgtHandle string) (vlans []int, color string, mismatch bool) {
	srcHandle, tgtHandle = defaultHandles(srcHandle, tgtHandle)
	srcSet := VLANSet(srcType, srcDetails, srcHandle)
	tgtSet := VLANSet(tgtType, tgtDetails, tgtHandle)
	switch {
	case srcSet != nil && tgtSet != nil:
		inTarget := map[int]bool{}
		for _, id := range tgtSet {
			inTarget[id] = true
		}
		for _, id := range srcSet {
			if inTarget[id] {
				vlans = append(vlans, id)
			}
		}
		if len(vlans) == 0 {
			return nil, "", true
		}
	case srcSet != nil:
		vlans = srcSet
	case tgtSet != nil:
		vlans = tgtSet
	default:
		return nil, "", false
	}
	shown := map[int]bool{}
	for _, id := range vlans {
		shown[id] = true
	}
	ends := []struct {
		nodeType string
		details  map[string]any
		handle   string
	}{{srcType, srcDetails, srcHandle}, {tgtType, tgtDetails, tgtHandle}}
	for _, end := range ends {
		if end.nodeType != "switch" {
			continue
		}
		untagged := ReadPortConfig(end.details)[end.handle].UntaggedVLAN
		if shown[untagged] {
			if c := vlanColor(end.details, untagged); c != "" {
				return vlans, c, false
			}
		}
	}
	for _, id := range vlans {
		for _, end := range ends {
			if c := vlanColor(end.details, id); c != "" {
				return vlans, c, false
			}
		}
	}
	return vlans, "", false
}

func vlanColor(details map[string]any, id int) string {
	for _, vlan := range ReadVLANs(details) {
		if vlan.ID == id && colorPattern.MatchString(vlan.Color) {
			return vlan.Color
		}
	}
	return ""
}

// defaultHandles fills in the handles React Flow leaves empty: eth0 at the
// source and target-0 at the target.
func defaultHandles(source, target string) (string, string) {
	if source == "" {
		source = "eth0"
	}
	if target == "" {
		target = "target-0"
	}
	return source, target
}

func joinIDs(ids []int) string {
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = strconv.Itoa(id)
	}
	return strings.Join(parts, ", ")
}

func displayName(node *Node) string {
	if strings.TrimSpace(node.Name) != "" {
		return node.Name
	}
	return node.ID
}
