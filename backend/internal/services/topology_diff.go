package services

import (
	"encoding/json"
	"fmt"
	"reflect"
	"sort"

	"github.com/Butterski/homelab-builder/backend/internal/models"
)

// ProposalDiff describes what a proposal changes, grouped the way the review
// panel shows it. Entity ids match the preview build so the canvas can
// highlight them.
type ProposalDiff struct {
	Counts      DiffCounts      `json:"counts"`
	BuildName   *FieldChange    `json:"build_name,omitempty"`
	Nodes       NodeDiffs       `json:"nodes"`
	Connections ConnectionDiffs `json:"connections"`
	VMs         GuestDiffs      `json:"vms"`
	Components  ComponentDiffs  `json:"components"`
	IPChanges   []AddressChange `json:"ip_changes"`
}

type DiffCounts struct {
	NodesAdded         int `json:"nodes_added"`
	NodesRemoved       int `json:"nodes_removed"`
	NodesChanged       int `json:"nodes_changed"`
	ConnectionsAdded   int `json:"connections_added"`
	ConnectionsRemoved int `json:"connections_removed"`
	ConnectionsChanged int `json:"connections_changed"`
	VMsAdded           int `json:"vms_added"`
	VMsRemoved         int `json:"vms_removed"`
	VMsChanged         int `json:"vms_changed"`
	ComponentsAdded    int `json:"components_added"`
	ComponentsRemoved  int `json:"components_removed"`
	IPChanges          int `json:"ip_changes"`
	// Total counts structural changes; recalculated addresses alone are not a change.
	Total int `json:"total"`
}

type FieldChange struct {
	Field  string `json:"field"`
	Before any    `json:"before"`
	After  any    `json:"after"`
}

type NodeDiff struct {
	ID       string        `json:"id"`
	Name     string        `json:"name"`
	Type     string        `json:"type"`
	IP       string        `json:"ip,omitempty"`
	ParentID string        `json:"parent_id,omitempty"`
	Changes  []FieldChange `json:"changes,omitempty"`
}

type NodeDiffs struct {
	Added   []NodeDiff `json:"added"`
	Removed []NodeDiff `json:"removed"`
	Changed []NodeDiff `json:"changed"`
}

type ConnectionDiff struct {
	Source       string        `json:"source"`
	Target       string        `json:"target"`
	SourceName   string        `json:"source_name"`
	TargetName   string        `json:"target_name"`
	SourceHandle string        `json:"source_handle,omitempty"`
	TargetHandle string        `json:"target_handle,omitempty"`
	Type         string        `json:"type"`
	Speed        string        `json:"speed,omitempty"`
	Changes      []FieldChange `json:"changes,omitempty"`
}

type ConnectionDiffs struct {
	Added   []ConnectionDiff `json:"added"`
	Removed []ConnectionDiff `json:"removed"`
	Changed []ConnectionDiff `json:"changed"`
}

type GuestDiff struct {
	ID       string        `json:"id"`
	Name     string        `json:"name"`
	Type     string        `json:"type"`
	HostID   string        `json:"host_id"`
	HostName string        `json:"host_name"`
	IP       string        `json:"ip,omitempty"`
	Changes  []FieldChange `json:"changes,omitempty"`
}

type GuestDiffs struct {
	Added   []GuestDiff `json:"added"`
	Removed []GuestDiff `json:"removed"`
	Changed []GuestDiff `json:"changed"`
}

type ComponentDiff struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	HostID   string `json:"host_id"`
	HostName string `json:"host_name"`
}

type ComponentDiffs struct {
	Added   []ComponentDiff `json:"added"`
	Removed []ComponentDiff `json:"removed"`
}

type AddressChange struct {
	Kind   string `json:"kind"` // node | vm
	ID     string `json:"id"`
	Name   string `json:"name"`
	Before string `json:"before"`
	After  string `json:"after"`
}

// Details keys IPAM or the canvas derive; they never count as a proposed change.
var derivedDetailKeys = map[string]bool{
	"wan_ip": true, "lan_gateway_ip": true, "lan_subnet": true, "interfaces": true,
	"virtual_network": true, "dhcp_locked": true, "rack_position": true,
}

// DiffBuilds compares a build with its proposed successor.
func DiffBuilds(before, after *models.Build) ProposalDiff {
	diff := ProposalDiff{
		Nodes:       NodeDiffs{Added: []NodeDiff{}, Removed: []NodeDiff{}, Changed: []NodeDiff{}},
		Connections: ConnectionDiffs{Added: []ConnectionDiff{}, Removed: []ConnectionDiff{}, Changed: []ConnectionDiff{}},
		VMs:         GuestDiffs{Added: []GuestDiff{}, Removed: []GuestDiff{}, Changed: []GuestDiff{}},
		Components:  ComponentDiffs{Added: []ComponentDiff{}, Removed: []ComponentDiff{}},
		IPChanges:   []AddressChange{},
	}
	if before.Name != after.Name {
		diff.BuildName = &FieldChange{Field: "name", Before: before.Name, After: after.Name}
	}

	beforeNodes := indexNodes(before.Nodes)
	afterNodes := indexNodes(after.Nodes)
	names := map[string]string{}
	for id, node := range beforeNodes {
		names[id] = node.Name
	}
	for id, node := range afterNodes {
		names[id] = node.Name
	}

	for _, node := range sortedNodes(after.Nodes) {
		id := node.ID.String()
		previous, existed := beforeNodes[id]
		if !existed {
			diff.Nodes.Added = append(diff.Nodes.Added, describeNode(node))
			continue
		}
		if changes := nodeChanges(previous, node, names); len(changes) > 0 {
			entry := describeNode(node)
			entry.Changes = changes
			diff.Nodes.Changed = append(diff.Nodes.Changed, entry)
		}
		if previous.IP != node.IP {
			diff.IPChanges = append(diff.IPChanges, AddressChange{Kind: "node", ID: id, Name: node.Name, Before: previous.IP, After: node.IP})
		}
	}
	for _, node := range sortedNodes(before.Nodes) {
		if _, kept := afterNodes[node.ID.String()]; !kept {
			diff.Nodes.Removed = append(diff.Nodes.Removed, describeNode(node))
		}
	}

	diffGuests(&diff, before, after)
	diffComponents(&diff, before, after)
	diffConnections(&diff, before, after, names)

	counts := DiffCounts{
		NodesAdded: len(diff.Nodes.Added), NodesRemoved: len(diff.Nodes.Removed), NodesChanged: len(diff.Nodes.Changed),
		ConnectionsAdded: len(diff.Connections.Added), ConnectionsRemoved: len(diff.Connections.Removed), ConnectionsChanged: len(diff.Connections.Changed),
		VMsAdded: len(diff.VMs.Added), VMsRemoved: len(diff.VMs.Removed), VMsChanged: len(diff.VMs.Changed),
		ComponentsAdded: len(diff.Components.Added), ComponentsRemoved: len(diff.Components.Removed),
		IPChanges: len(diff.IPChanges),
	}
	counts.Total = counts.NodesAdded + counts.NodesRemoved + counts.NodesChanged +
		counts.ConnectionsAdded + counts.ConnectionsRemoved + counts.ConnectionsChanged +
		counts.VMsAdded + counts.VMsRemoved + counts.VMsChanged +
		counts.ComponentsAdded + counts.ComponentsRemoved
	if diff.BuildName != nil {
		counts.Total++
	}
	diff.Counts = counts
	return diff
}

// Summary is a one-line description such as "2 nodes added, 1 connection added".
func (c DiffCounts) Summary() string {
	parts := []string{}
	add := func(count int, singular, plural, verb string) {
		if count == 1 {
			parts = append(parts, fmt.Sprintf("1 %s %s", singular, verb))
		} else if count > 1 {
			parts = append(parts, fmt.Sprintf("%d %s %s", count, plural, verb))
		}
	}
	add(c.NodesAdded, "node", "nodes", "added")
	add(c.NodesChanged, "node", "nodes", "changed")
	add(c.NodesRemoved, "node", "nodes", "removed")
	add(c.ConnectionsAdded, "connection", "connections", "added")
	add(c.ConnectionsChanged, "connection", "connections", "changed")
	add(c.ConnectionsRemoved, "connection", "connections", "removed")
	add(c.VMsAdded, "service", "services", "added")
	add(c.VMsChanged, "service", "services", "changed")
	add(c.VMsRemoved, "service", "services", "removed")
	add(c.ComponentsAdded, "component", "components", "added")
	add(c.ComponentsRemoved, "component", "components", "removed")
	if len(parts) == 0 {
		return "no changes"
	}
	summary := parts[0]
	for _, part := range parts[1:] {
		summary += ", " + part
	}
	return summary
}

func indexNodes(nodes []models.Node) map[string]models.Node {
	index := make(map[string]models.Node, len(nodes))
	for _, node := range nodes {
		index[node.ID.String()] = node
	}
	return index
}

func sortedNodes(nodes []models.Node) []models.Node {
	sorted := append([]models.Node(nil), nodes...)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].Name != sorted[j].Name {
			return sorted[i].Name < sorted[j].Name
		}
		return sorted[i].ID.String() < sorted[j].ID.String()
	})
	return sorted
}

func describeNode(node models.Node) NodeDiff {
	entry := NodeDiff{ID: node.ID.String(), Name: node.Name, Type: node.Type, IP: node.IP}
	if node.ParentID != nil {
		entry.ParentID = node.ParentID.String()
	}
	return entry
}

func nodeChanges(before, after models.Node, names map[string]string) []FieldChange {
	changes := []FieldChange{}
	if before.Name != after.Name {
		changes = append(changes, FieldChange{Field: "name", Before: before.Name, After: after.Name})
	}
	if before.PowerDraw != after.PowerDraw {
		changes = append(changes, FieldChange{Field: "power_draw", Before: before.PowerDraw, After: after.PowerDraw})
	}
	beforeParent, afterParent := "", ""
	if before.ParentID != nil {
		beforeParent = before.ParentID.String()
	}
	if after.ParentID != nil {
		afterParent = after.ParentID.String()
	}
	if beforeParent != afterParent {
		changes = append(changes, FieldChange{Field: "rack", Before: nameOrNil(names, beforeParent), After: nameOrNil(names, afterParent)})
	} else if before.X != after.X || before.Y != after.Y {
		changes = append(changes, FieldChange{
			Field:  "position",
			Before: map[string]float64{"x": before.X, "y": before.Y},
			After:  map[string]float64{"x": after.X, "y": after.Y},
		})
	}

	beforeDetails, _ := detailsMap(before.Details)
	afterDetails, _ := detailsMap(after.Details)
	// A static address shows up as a lock; report it as one readable field.
	if beforeLocked, afterLocked := detailBool(beforeDetails, "dhcp_locked"), detailBool(afterDetails, "dhcp_locked"); beforeLocked != afterLocked {
		changes = append(changes, FieldChange{Field: "static_ip", Before: beforeLocked, After: afterLocked})
	}
	keys := map[string]bool{}
	for key := range beforeDetails {
		keys[key] = true
	}
	for key := range afterDetails {
		keys[key] = true
	}
	ordered := make([]string, 0, len(keys))
	for key := range keys {
		if !derivedDetailKeys[key] {
			ordered = append(ordered, key)
		}
	}
	sort.Strings(ordered)
	for _, key := range ordered {
		previous, hadPrevious := beforeDetails[key]
		next, hasNext := afterDetails[key]
		if hadPrevious == hasNext && reflect.DeepEqual(previous, next) {
			continue
		}
		changes = append(changes, FieldChange{Field: "details." + key, Before: previous, After: next})
	}
	return changes
}

func nameOrNil(names map[string]string, id string) any {
	if id == "" {
		return nil
	}
	if name, ok := names[id]; ok {
		return name
	}
	return id
}

type guestRef struct {
	vm   models.VirtualMachine
	host models.Node
}

func indexGuests(nodes []models.Node) map[string]guestRef {
	index := map[string]guestRef{}
	for _, node := range nodes {
		for _, vm := range node.VirtualMachines {
			index[vm.ID.String()] = guestRef{vm: vm, host: node}
		}
	}
	return index
}

func describeGuest(ref guestRef) GuestDiff {
	return GuestDiff{
		ID: ref.vm.ID.String(), Name: ref.vm.Name, Type: ref.vm.Type,
		HostID: ref.host.ID.String(), HostName: ref.host.Name, IP: ref.vm.IP,
	}
}

func diffGuests(diff *ProposalDiff, before, after *models.Build) {
	beforeGuests := indexGuests(before.Nodes)
	afterGuests := indexGuests(after.Nodes)

	for _, id := range sortedKeys(afterGuests) {
		current := afterGuests[id]
		previous, existed := beforeGuests[id]
		if !existed {
			diff.VMs.Added = append(diff.VMs.Added, describeGuest(current))
			continue
		}
		changes := []FieldChange{}
		compare := func(field string, a, b any) {
			if !reflect.DeepEqual(a, b) {
				changes = append(changes, FieldChange{Field: field, Before: a, After: b})
			}
		}
		compare("name", previous.vm.Name, current.vm.Name)
		compare("type", previous.vm.Type, current.vm.Type)
		compare("cpu_cores", previous.vm.CPUCores, current.vm.CPUCores)
		compare("ram_mb", previous.vm.RAMMB, current.vm.RAMMB)
		compare("os", previous.vm.OS, current.vm.OS)
		compare("status", previous.vm.Status, current.vm.Status)
		compare("static_ip", requestedVMIP(previous.vm), requestedVMIP(current.vm))
		if previous.host.ID != current.host.ID {
			compare("host", previous.host.Name, current.host.Name)
		}
		if len(changes) > 0 {
			entry := describeGuest(current)
			entry.Changes = changes
			diff.VMs.Changed = append(diff.VMs.Changed, entry)
		}
		if previous.vm.IP != current.vm.IP {
			diff.IPChanges = append(diff.IPChanges, AddressChange{Kind: "vm", ID: id, Name: current.vm.Name, Before: previous.vm.IP, After: current.vm.IP})
		}
	}
	for _, id := range sortedKeys(beforeGuests) {
		if _, kept := afterGuests[id]; !kept {
			diff.VMs.Removed = append(diff.VMs.Removed, describeGuest(beforeGuests[id]))
		}
	}
}

func indexComponents(nodes []models.Node) map[string]ComponentDiff {
	index := map[string]ComponentDiff{}
	for _, node := range nodes {
		for _, component := range node.InternalComponents {
			index[component.ID.String()] = ComponentDiff{
				ID: component.ID.String(), Name: component.Name, Type: component.Type,
				HostID: node.ID.String(), HostName: node.Name,
			}
		}
	}
	return index
}

func diffComponents(diff *ProposalDiff, before, after *models.Build) {
	beforeComponents := indexComponents(before.Nodes)
	afterComponents := indexComponents(after.Nodes)
	for _, id := range sortedKeys(afterComponents) {
		if _, existed := beforeComponents[id]; !existed {
			diff.Components.Added = append(diff.Components.Added, afterComponents[id])
		}
	}
	for _, id := range sortedKeys(beforeComponents) {
		if _, kept := afterComponents[id]; !kept {
			diff.Components.Removed = append(diff.Components.Removed, beforeComponents[id])
		}
	}
}

// connectionKey identifies a cable by its unordered node pair: edge ids are
// regenerated on every save and cannot be compared across revisions.
func connectionKey(edge models.Edge) string {
	a, b := edge.SourceNodeID.String(), edge.TargetNodeID.String()
	if b < a {
		a, b = b, a
	}
	return a + "|" + b
}

func describeConnection(edge models.Edge, names map[string]string) ConnectionDiff {
	source, target := edge.SourceNodeID.String(), edge.TargetNodeID.String()
	return ConnectionDiff{
		Source: source, Target: target,
		SourceName: names[source], TargetName: names[target],
		SourceHandle: edge.SourceHandle, TargetHandle: edge.TargetHandle,
		Type: edge.Type, Speed: edge.Speed,
	}
}

func diffConnections(diff *ProposalDiff, before, after *models.Build, names map[string]string) {
	beforeEdges := map[string]models.Edge{}
	for _, edge := range before.Edges {
		beforeEdges[connectionKey(edge)] = edge
	}
	afterEdges := map[string]models.Edge{}
	for _, edge := range after.Edges {
		afterEdges[connectionKey(edge)] = edge
	}

	for _, key := range sortedKeys(afterEdges) {
		current := afterEdges[key]
		previous, existed := beforeEdges[key]
		if !existed {
			diff.Connections.Added = append(diff.Connections.Added, describeConnection(current, names))
			continue
		}
		changes := []FieldChange{}
		compare := func(field, a, b string) {
			if a != b {
				changes = append(changes, FieldChange{Field: field, Before: a, After: b})
			}
		}
		compare("type", previous.Type, current.Type)
		compare("speed", previous.Speed, current.Speed)
		compare("direction", previous.Direction, current.Direction)
		compare("wireless_standard", previous.WirelessStandard, current.WirelessStandard)
		compare("subnet", previous.Subnet, current.Subnet)
		if len(changes) > 0 {
			entry := describeConnection(current, names)
			entry.Changes = changes
			diff.Connections.Changed = append(diff.Connections.Changed, entry)
		}
	}
	for _, key := range sortedKeys(beforeEdges) {
		if _, kept := afterEdges[key]; !kept {
			diff.Connections.Removed = append(diff.Connections.Removed, describeConnection(beforeEdges[key], names))
		}
	}
}

func sortedKeys[V any](items map[string]V) []string {
	keys := make([]string, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// marshalDiff is a small helper so callers store exactly what they return.
func marshalDiff(diff ProposalDiff) json.RawMessage {
	raw, err := json.Marshal(diff)
	if err != nil {
		return json.RawMessage("{}")
	}
	return raw
}
