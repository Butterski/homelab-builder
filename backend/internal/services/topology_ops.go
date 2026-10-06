package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

// Topology operations are the change sets LLM clients propose. They are applied
// in memory to a SyncGraphInput, so the result goes through exactly the same
// save, IPAM and validation path as a build edited on the canvas.

const (
	MaxTopologyOps        = 100
	MaxTopologyNodes      = 300
	maxVMsPerNode         = 100
	maxComponentsPerNode  = 50
	maxNameLength         = 120
	maxDetailKeys         = 60
	maxDetailStringLength = 2000
)

// ErrInvalidOperations marks a change set that cannot be applied to the build.
var ErrInvalidOperations = errors.New("invalid operations")

// OpError points at the operation that failed so the caller can correct it.
// Index is -1 when the combined result is invalid rather than one operation.
type OpError struct {
	Index   int    `json:"index"`
	Op      string `json:"op,omitempty"`
	Message string `json:"message"`
}

func (e *OpError) Error() string {
	if e.Index < 0 {
		return e.Message
	}
	return fmt.Sprintf("operations[%d] (%s): %s", e.Index, e.Op, e.Message)
}

func (e *OpError) Unwrap() error { return ErrInvalidOperations }

// TopologyOp is one flat, op-tagged change. Fields that name an existing entity
// accept its UUID or a ref introduced by an earlier operation in the same batch.
type TopologyOp struct {
	Op string `json:"op"`
	// ID is the server-assigned UUID of the entity an add_* operation creates.
	ID  string `json:"id,omitempty"`
	Ref string `json:"ref,omitempty"`

	Node      string  `json:"node,omitempty"`
	Host      string  `json:"host,omitempty"`
	VM        string  `json:"vm,omitempty"`
	Component string  `json:"component,omitempty"`
	Source    string  `json:"source,omitempty"`
	Target    string  `json:"target,omitempty"`
	Parent    *string `json:"parent,omitempty"`

	Type       string         `json:"type,omitempty"`
	Name       *string        `json:"name,omitempty"`
	Details    map[string]any `json:"details,omitempty"`
	IP         *string        `json:"ip,omitempty"`
	PowerDraw  *float64       `json:"power_draw,omitempty"`
	X          *float64       `json:"x,omitempty"`
	Y          *float64       `json:"y,omitempty"`
	RackSlot   *float64       `json:"rack_slot,omitempty"`
	HardwareID string         `json:"hardware_id,omitempty"`

	ConnectionType   *string `json:"connection_type,omitempty"`
	Speed            *string `json:"speed,omitempty"`
	Direction        *string `json:"direction,omitempty"`
	WirelessStandard *string `json:"wireless_standard,omitempty"`
	Subnet           *string `json:"subnet,omitempty"`
	SourceHandle     string  `json:"source_handle,omitempty"`
	TargetHandle     string  `json:"target_handle,omitempty"`

	CPUCores         *float64 `json:"cpu_cores,omitempty"`
	RAMMB            *float64 `json:"ram_mb,omitempty"`
	OS               *string  `json:"os,omitempty"`
	Status           *string  `json:"status,omitempty"`
	StaticIP         *string  `json:"static_ip,omitempty"`
	CatalogServiceID string   `json:"catalog_service_id,omitempty"`

	// Game server settings of a service added from a game in the catalog.
	Players    *float64 `json:"players,omitempty"`
	Exposure   *string  `json:"exposure,omitempty"`
	PortOffset *float64 `json:"port_offset,omitempty"`

	// set_plan: the build kind and a merge patch for the gaming plan.
	Kind string         `json:"kind,omitempty"`
	Plan map[string]any `json:"plan,omitempty"`
}

// CatalogLookup resolves catalog shortcuts (hardware_id, catalog_service_id).
type CatalogLookup interface {
	HardwareByID(id uuid.UUID) (*models.HardwareComponent, error)
	ServiceForUser(id, userID uuid.UUID) (*models.Service, error)
}

type ApplyOptions struct {
	Catalog CatalogLookup
	UserID  uuid.UUID
	// AllowLoops mirrors the builder's "ignore network loops" preference.
	AllowLoops bool
}

// AppliedTopology is the outcome of ApplyTopologyOps.
type AppliedTopology struct {
	Input SyncGraphInput
	// Resolved repeats the operations with refs replaced by UUIDs and created
	// ids and positions filled in, so they can be re-applied to a newer revision.
	Resolved []TopologyOp
	Refs     map[string]string
}

var addableNodeTypes = map[string]bool{
	"router": true, "switch": true, "firewall": true, "server_v2": true, "minipc": true,
	"pc": true, "nas": true, "sbc": true, "vps": true, "access_point": true, "rack": true,
	"iot": true, "ups": true, "modem": true, "pdu": true,
	nodeTypeConsole: true, nodeTypeLANTable: true,
}

var defaultNodeNames = map[string]string{
	"router": "Router", "switch": "Switch", "firewall": "Firewall", "server_v2": "Server",
	"minipc": "Mini PC", "pc": "PC", "nas": "NAS", "sbc": "SBC", "vps": "VPS",
	"access_point": "Access Point", "rack": "Rack", "iot": "IoT Device", "ups": "UPS",
	"modem": "Modem", "pdu": "PDU", nodeTypeConsole: "Console", nodeTypeLANTable: "LAN Table",
}

// Details keys the canvas and IPAM own; operations may not write them.
var reservedDetailKeys = map[string]bool{
	"virtual_network": true, "interfaces": true, "wan_ip": true,
	"lan_gateway_ip": true, "lan_subnet": true, "rack_position": true,
	"dhcp_pool": true,
}

var numberDetailKeys = map[string]bool{
	"cpu": true, "cpu_cores": true, "ram": true, "storage": true, "ports": true,
	"rack_size": true, "rack_units": true, "price_est": true, "capacity_va": true,
}

var boolDetailKeys = map[string]bool{
	"dhcp_enabled": true, "dhcp_locked": true, "routing_enabled": true, "nat_enabled": true,
	"firewall_enabled": true, "hypervisor_enabled": true, "app_host_enabled": true,
	"storage_enabled": true, "managed": true,
}

var enumDetailKeys = map[string][]string{
	"network_zone":   {"wan", "lan", "dmz", "cloud"},
	"server_profile": {"general", "hypervisor", "storage", "gateway"},
}

var rackUnitPattern = regexp.MustCompile(`(?i)(\d+)\s*u`)

var connectionTypes = []string{"ethernet", "wireless", "vpn"}
var connectionDirections = []string{"auto", "lan", "wan"}
var vmTypes = []string{"vm", "container", "lxc"}
var vmStatuses = []string{"running", "stopped", "paused"}

type topologyEditor struct {
	graph    SyncGraphInput
	opts     ApplyOptions
	refs     map[string]string
	refKinds map[string]string
	// pending lists nodes waiting for automatic placement, with the operation
	// that created each so the chosen position can be written back.
	pending   []string
	pendingOp map[string]int
}

// ApplyTopologyOps applies ops in order to a copy of base. The whole batch is
// rejected on the first invalid operation; nothing is partially applied.
func ApplyTopologyOps(base SyncGraphInput, ops []TopologyOp, opts ApplyOptions) (*AppliedTopology, error) {
	if len(ops) == 0 {
		return nil, &OpError{Index: -1, Message: "operations must contain at least one change"}
	}
	if len(ops) > MaxTopologyOps {
		return nil, &OpError{Index: -1, Message: fmt.Sprintf("too many operations: %d (limit %d); split the change into smaller proposals", len(ops), MaxTopologyOps)}
	}
	graph, err := cloneSyncInput(base)
	if err != nil {
		return nil, err
	}
	editor := &topologyEditor{
		graph:     graph,
		opts:      opts,
		refs:      map[string]string{},
		refKinds:  map[string]string{},
		pendingOp: map[string]int{},
	}

	resolved := make([]TopologyOp, len(ops))
	for i, op := range ops {
		op.Op = strings.ToLower(strings.TrimSpace(op.Op))
		result, err := editor.apply(i, op)
		if err != nil {
			return nil, &OpError{Index: i, Op: op.Op, Message: err.Error()}
		}
		resolved[i] = result
	}

	placeNodes(editor.graph.Nodes, editor.graph.Edges, editor.pending)
	for _, id := range editor.pending {
		if i := editor.nodeIndex(id); i >= 0 {
			x, y := editor.graph.Nodes[i].X, editor.graph.Nodes[i].Y
			resolved[editor.pendingOp[id]].X = &x
			resolved[editor.pendingOp[id]].Y = &y
		}
	}

	if err := validateVirtualNetworks(editor.graph.Nodes); err != nil {
		return nil, &OpError{Index: -1, Message: err.Error()}
	}
	if err := validateEdgeEndpoints(editor.graph.Nodes, editor.graph.Edges); err != nil {
		return nil, &OpError{Index: -1, Message: err.Error()}
	}
	return &AppliedTopology{Input: editor.graph, Resolved: resolved, Refs: editor.refs}, nil
}

func cloneSyncInput(input SyncGraphInput) (SyncGraphInput, error) {
	raw, err := json.Marshal(input)
	if err != nil {
		return SyncGraphInput{}, err
	}
	var clone SyncGraphInput
	if err := json.Unmarshal(raw, &clone); err != nil {
		return SyncGraphInput{}, err
	}
	if clone.Settings == nil {
		clone.Settings = map[string]any{}
	}
	for i := range clone.Nodes {
		if clone.Nodes[i].Details == nil {
			clone.Nodes[i].Details = map[string]any{}
		}
	}
	return clone, nil
}

func (ed *topologyEditor) apply(index int, op TopologyOp) (TopologyOp, error) {
	switch op.Op {
	case "add_node":
		return ed.addNode(index, op)
	case "update_node":
		return ed.updateNode(op)
	case "remove_node":
		return ed.removeNode(op)
	case "connect":
		return ed.connect(op)
	case "disconnect":
		return ed.disconnect(op)
	case "update_connection":
		return ed.updateConnection(op)
	case "add_vm":
		return ed.addVM(op)
	case "update_vm":
		return ed.updateVM(op)
	case "remove_vm":
		return ed.removeVM(op)
	case "add_component":
		return ed.addComponent(op)
	case "remove_component":
		return ed.removeComponent(op)
	case "rename_build":
		return ed.renameBuild(op)
	case "set_plan":
		return ed.setPlan(op)
	case "":
		return op, errors.New("op is required")
	default:
		return op, fmt.Errorf("unknown op %q; use add_node, update_node, remove_node, connect, disconnect, update_connection, add_vm, update_vm, remove_vm, add_component, remove_component, rename_build or set_plan", op.Op)
	}
}

// ── Lookups ─────────────────────────────────────────────────────────────────

func (ed *topologyEditor) nodeIndex(id string) int {
	for i := range ed.graph.Nodes {
		if ed.graph.Nodes[i].ID == id {
			return i
		}
	}
	return -1
}

func (ed *topologyEditor) nodeTypes() map[string]string {
	types := make(map[string]string, len(ed.graph.Nodes))
	for _, node := range ed.graph.Nodes {
		types[node.ID] = node.Type
	}
	return types
}

func (ed *topologyEditor) edgeIndex(a, b string) int {
	for i, edge := range ed.graph.Edges {
		if (edge.Source == a && edge.Target == b) || (edge.Source == b && edge.Target == a) {
			return i
		}
	}
	return -1
}

func (ed *topologyEditor) idInUse(id string) bool {
	for _, node := range ed.graph.Nodes {
		if node.ID == id {
			return true
		}
		for _, vm := range node.VMs {
			if vm.ID == id {
				return true
			}
		}
		for _, component := range node.InternalComponents {
			if component.ID == id {
				return true
			}
		}
	}
	return false
}

func (ed *topologyEditor) newEntityID(preset string) (string, error) {
	preset = strings.TrimSpace(preset)
	if preset == "" {
		return uuid.NewString(), nil
	}
	parsed, err := uuid.Parse(preset)
	if err != nil {
		return "", errors.New("id must be a UUID")
	}
	if ed.idInUse(parsed.String()) {
		return "", fmt.Errorf("id %s already exists in this build", parsed)
	}
	return parsed.String(), nil
}

func (ed *topologyEditor) registerRef(ref, id, kind string) error {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil
	}
	if len(ref) > 64 {
		return errors.New("ref is too long (64 characters at most)")
	}
	if _, err := uuid.Parse(ref); err == nil {
		return errors.New("ref must be a short label such as \"nas1\", not a UUID")
	}
	if _, exists := ed.refs[ref]; exists {
		return fmt.Errorf("ref %q is already used in this batch", ref)
	}
	ed.refs[ref] = id
	ed.refKinds[ref] = kind
	return nil
}

// resolveNode accepts a batch ref, a node UUID, or a node name that is unique.
func (ed *topologyEditor) resolveNode(token, field string) (string, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return "", fmt.Errorf("%s is required", field)
	}
	if id, ok := ed.refs[token]; ok && ed.refKinds[token] == "node" {
		if ed.nodeIndex(id) >= 0 {
			return id, nil
		}
		return "", fmt.Errorf("%s %q was removed earlier in this batch", field, token)
	}
	if parsed, err := uuid.Parse(token); err == nil {
		if ed.nodeIndex(parsed.String()) >= 0 {
			return parsed.String(), nil
		}
		return "", fmt.Errorf("%s %s does not exist in this build", field, parsed)
	}
	match := ""
	for _, node := range ed.graph.Nodes {
		if strings.EqualFold(node.Name, token) {
			if match != "" {
				return "", fmt.Errorf("%s %q matches more than one node; use the node id", field, token)
			}
			match = node.ID
		}
	}
	if match != "" {
		return match, nil
	}
	return "", fmt.Errorf("unknown %s %q: use a node id from get_build or a ref set by an earlier add_node in this batch", field, token)
}

func (ed *topologyEditor) resolveVM(token string) (int, int, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return -1, -1, errors.New("vm is required")
	}
	id := token
	if ref, ok := ed.refs[token]; ok && ed.refKinds[token] == "vm" {
		id = ref
	} else if parsed, err := uuid.Parse(token); err == nil {
		id = parsed.String()
	}
	nameNode, nameVM, nameMatches := -1, -1, 0
	for n := range ed.graph.Nodes {
		for v, vm := range ed.graph.Nodes[n].VMs {
			if vm.ID == id {
				return n, v, nil
			}
			if strings.EqualFold(vm.Name, token) {
				nameNode, nameVM = n, v
				nameMatches++
			}
		}
	}
	if nameMatches == 1 {
		return nameNode, nameVM, nil
	}
	if nameMatches > 1 {
		return -1, -1, fmt.Errorf("vm %q matches more than one service; use its id", token)
	}
	return -1, -1, fmt.Errorf("unknown vm %q: use a vm id from get_build or a ref set by an earlier add_vm", token)
}

func (ed *topologyEditor) resolveComponent(token string) (int, int, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return -1, -1, errors.New("component is required")
	}
	id := token
	if ref, ok := ed.refs[token]; ok && ed.refKinds[token] == "component" {
		id = ref
	} else if parsed, err := uuid.Parse(token); err == nil {
		id = parsed.String()
	}
	for n := range ed.graph.Nodes {
		for c, component := range ed.graph.Nodes[n].InternalComponents {
			if component.ID == id {
				return n, c, nil
			}
		}
	}
	return -1, -1, fmt.Errorf("unknown component %q: use a component id from get_build or a ref set by an earlier add_component", token)
}

// ── Nodes ───────────────────────────────────────────────────────────────────

func (ed *topologyEditor) addNode(index int, op TopologyOp) (TopologyOp, error) {
	if len(ed.graph.Nodes) >= MaxTopologyNodes {
		return op, fmt.Errorf("a build can hold at most %d nodes", MaxTopologyNodes)
	}
	nodeType := strings.ToLower(strings.TrimSpace(op.Type))
	name := ""
	details := map[string]any{}
	power := 0.0

	if strings.TrimSpace(op.HardwareID) != "" {
		hardware, err := ed.catalogHardware(op.HardwareID)
		if err != nil {
			return op, err
		}
		catalogType := HardwareCategoryToNodeType(hardware.Category)
		if componentTypes[catalogType] {
			return op, fmt.Errorf("%s %s is a %s component; add it to a host with add_component", hardware.Brand, hardware.Model, catalogType)
		}
		if nodeType == "" {
			nodeType = catalogType
		}
		name = strings.TrimSpace(hardware.Brand + " " + hardware.Model)
		details, power = catalogHardwareDetails(hardware)
	}
	if nodeType == "" {
		return op, errors.New("type is required (or pass hardware_id from search_hardware)")
	}
	if !addableNodeTypes[nodeType] {
		return op, fmt.Errorf("unsupported node type %q; use one of %s. Disks, GPUs and cards are added with add_component", nodeType, joinKeys(addableNodeTypes))
	}
	if op.Name != nil {
		name = *op.Name
	}
	name, err := cleanName(name, defaultNodeNames[nodeType])
	if err != nil {
		return op, err
	}
	if err := mergeDetails(details, op.Details, nodeType); err != nil {
		return op, err
	}
	if nodeType == nodeTypeLANTable {
		if err := applyTableDefaults(details); err != nil {
			return op, err
		}
		power = tablePowerDraw(details)
	}
	if op.PowerDraw != nil {
		if err := checkRange("power_draw", *op.PowerDraw, 0, 100000); err != nil {
			return op, err
		}
		power = *op.PowerDraw
	}
	id, err := ed.newEntityID(op.ID)
	if err != nil {
		return op, err
	}
	if err := ed.registerRef(op.Ref, id, "node"); err != nil {
		return op, err
	}

	node := NodeDTO{
		ID: id, Type: nodeType, Name: name, PowerDraw: power, Details: details,
		VMs: []VMDTO{}, InternalComponents: []ComponentDTO{},
	}
	if op.IP != nil {
		if err := setNodeIP(&node, *op.IP); err != nil {
			return op, err
		}
	}
	ed.graph.Nodes = append(ed.graph.Nodes, node)
	nodeIdx := len(ed.graph.Nodes) - 1

	resolved := op
	resolved.ID = id
	resolved.Type = nodeType
	switch {
	case op.Parent != nil && strings.TrimSpace(*op.Parent) != "":
		rackID, err := ed.rackNode(nodeIdx, *op.Parent, op.RackSlot)
		if err != nil {
			return op, err
		}
		resolved.Parent = &rackID
	case op.X != nil && op.Y != nil:
		ed.graph.Nodes[nodeIdx].X = snapToGrid(*op.X)
		ed.graph.Nodes[nodeIdx].Y = snapToGrid(*op.Y)
	default:
		ed.pending = append(ed.pending, id)
		ed.pendingOp[id] = index
	}
	return resolved, nil
}

func (ed *topologyEditor) updateNode(op TopologyOp) (TopologyOp, error) {
	id, err := ed.resolveNode(op.Node, "node")
	if err != nil {
		return op, err
	}
	nodeIdx := ed.nodeIndex(id)
	node := &ed.graph.Nodes[nodeIdx]
	resolved := op
	resolved.Node = id

	if op.Type != "" && strings.ToLower(strings.TrimSpace(op.Type)) != node.Type {
		return op, fmt.Errorf("a node's type cannot change (%q is a %s); remove it and add a new node instead", node.Name, node.Type)
	}
	if op.Name != nil {
		name, err := cleanName(*op.Name, "")
		if err != nil {
			return op, err
		}
		node.Name = name
	}
	if len(op.Details) > 0 {
		if err := mergeDetails(node.Details, op.Details, node.Type); err != nil {
			return op, err
		}
		if highest := highestUsedPort(id, ed.graph.Edges); highest >= PortCount(node.Type, node.Details) {
			return op, fmt.Errorf("%q has a cable on port eth%d; it needs at least %d ports", node.Name, highest, highest+1)
		}
		if node.Type == nodeTypeLANTable {
			// Changing the seats resizes the switch unless the same change sets it.
			if _, seatsChanged := op.Details["seats"]; seatsChanged {
				if _, portsGiven := op.Details["switch_ports"]; !portsGiven {
					delete(node.Details, "switch_ports")
				}
			}
			if err := applyTableDefaults(node.Details); err != nil {
				return op, err
			}
			_, seatsChanged := op.Details["seats"]
			_, wattsChanged := op.Details["seat_watts"]
			if (seatsChanged || wattsChanged) && op.PowerDraw == nil {
				node.PowerDraw = tablePowerDraw(node.Details)
			}
		}
		if node.Type == "rack" {
			size := rackSizeOf(*node)
			for _, child := range ed.graph.Nodes {
				if child.ParentID != nil && *child.ParentID == id && rackSlotOf(child)+rackUnitsOf(child) > size {
					return op, fmt.Errorf("rack %q cannot shrink to %dU: %q sits in slots %d-%d", node.Name, size, child.Name, rackSlotOf(child), rackSlotOf(child)+rackUnitsOf(child)-1)
				}
			}
		}
		if node.ParentID != nil {
			// A changed height must still fit where the device sits.
			if rackIdx := ed.nodeIndex(*node.ParentID); rackIdx >= 0 {
				slot := rackSlotOf(*node)
				if _, err := allocateRackSlot(ed.graph.Nodes, ed.graph.Nodes[rackIdx], id, node.Name, rackUnitsOf(*node), &slot); err != nil {
					return op, err
				}
			}
		}
	}
	if op.PowerDraw != nil {
		if err := checkRange("power_draw", *op.PowerDraw, 0, 100000); err != nil {
			return op, err
		}
		node.PowerDraw = *op.PowerDraw
	}
	if op.IP != nil {
		if err := setNodeIP(node, *op.IP); err != nil {
			return op, err
		}
	}

	switch {
	case op.Parent != nil && strings.TrimSpace(*op.Parent) == "":
		if node.ParentID != nil {
			if rackIdx := ed.nodeIndex(*node.ParentID); rackIdx >= 0 {
				node.X += ed.graph.Nodes[rackIdx].X
				node.Y += ed.graph.Nodes[rackIdx].Y
			}
			node.ParentID = nil
			delete(node.Details, "rack_position")
		}
		if op.X != nil && op.Y != nil {
			node.X, node.Y = snapToGrid(*op.X), snapToGrid(*op.Y)
		}
	case op.Parent != nil:
		rackID, err := ed.resolveNode(*op.Parent, "parent")
		if err != nil {
			return op, err
		}
		resolved.Parent = &rackID
		alreadyThere := node.ParentID != nil && *node.ParentID == rackID
		if !alreadyThere || op.RackSlot != nil {
			if _, err := ed.rackNode(nodeIdx, rackID, op.RackSlot); err != nil {
				return op, err
			}
		}
	case op.RackSlot != nil:
		if node.ParentID == nil {
			return op, fmt.Errorf("%q is not in a rack; set parent to a rack to mount it", node.Name)
		}
		if _, err := ed.rackNode(nodeIdx, *node.ParentID, op.RackSlot); err != nil {
			return op, err
		}
	case op.X != nil || op.Y != nil:
		if node.ParentID != nil {
			return op, fmt.Errorf("%q is mounted in a rack; move it with rack_slot or set parent to \"\" first", node.Name)
		}
		if op.X != nil {
			node.X = snapToGrid(*op.X)
		}
		if op.Y != nil {
			node.Y = snapToGrid(*op.Y)
		}
	}
	return resolved, nil
}

// rackNode mounts a node in a rack and returns the rack's id.
func (ed *topologyEditor) rackNode(nodeIdx int, parentToken string, slot *float64) (string, error) {
	rackID, err := ed.resolveNode(parentToken, "parent")
	if err != nil {
		return "", err
	}
	rack := ed.graph.Nodes[ed.nodeIndex(rackID)]
	node := &ed.graph.Nodes[nodeIdx]
	if rack.Type != "rack" {
		return "", fmt.Errorf("parent %q is a %s, not a rack", rack.Name, rack.Type)
	}
	if node.Type == "rack" {
		return "", errors.New("racks cannot be placed inside other racks")
	}
	if floorNodeTypes[node.Type] {
		return "", fmt.Errorf("%q is a %s and cannot be mounted in a rack", node.Name, node.Type)
	}
	var requested *int
	if slot != nil {
		value := int(math.Round(*slot))
		requested = &value
	}
	chosen, err := allocateRackSlot(ed.graph.Nodes, rack, node.ID, node.Name, rackUnitsOf(*node), requested)
	if err != nil {
		return "", err
	}
	node.ParentID = &rackID
	node.X, node.Y = rackSlotPosition(chosen)
	node.Details["rack_position"] = chosen
	ed.dropPending(node.ID)
	return rackID, nil
}

func (ed *topologyEditor) dropPending(id string) {
	for i, pendingID := range ed.pending {
		if pendingID == id {
			ed.pending = append(ed.pending[:i], ed.pending[i+1:]...)
			delete(ed.pendingOp, id)
			return
		}
	}
}

func (ed *topologyEditor) removeNode(op TopologyOp) (TopologyOp, error) {
	id, err := ed.resolveNode(op.Node, "node")
	if err != nil {
		return op, err
	}
	removed := map[string]bool{id: true}
	if ed.graph.Nodes[ed.nodeIndex(id)].Type == "rack" {
		// Removing a rack removes the devices mounted in it, as on the canvas.
		for _, node := range ed.graph.Nodes {
			if node.ParentID != nil && *node.ParentID == id {
				removed[node.ID] = true
			}
		}
	}
	nodes := ed.graph.Nodes[:0]
	for _, node := range ed.graph.Nodes {
		if !removed[node.ID] {
			nodes = append(nodes, node)
		}
	}
	ed.graph.Nodes = nodes
	edges := ed.graph.Edges[:0]
	for _, edge := range ed.graph.Edges {
		if !removed[edge.Source] && !removed[edge.Target] {
			edges = append(edges, edge)
		}
	}
	ed.graph.Edges = edges
	for removedID := range removed {
		ed.dropPending(removedID)
	}
	resolved := op
	resolved.Node = id
	return resolved, nil
}

// setNodeIP pins an address: the gateway address of a router, or a static
// address that IPAM keeps for any other networked device. "" releases it.
func setNodeIP(node *NodeDTO, value string) error {
	value = strings.TrimSpace(value)
	if nonNetworkTypes[node.Type] {
		return fmt.Errorf("%s nodes do not get IP addresses", node.Type)
	}
	if value == "" {
		node.IP = ""
		delete(node.Details, "dhcp_locked")
		return nil
	}
	if !isIPv4(value) {
		return fmt.Errorf("ip %q is not an IPv4 address", value)
	}
	node.IP = value
	if node.Type != "router" {
		node.Details["dhcp_locked"] = true
	}
	return nil
}
