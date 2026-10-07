package services

import (
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/gaming"
)

// ── Virtual machines and services ───────────────────────────────────────────

// Details an import leaves on a guest: the id it has on the system it was read
// from, and the size of its disk there.
const (
	guestVMIDKey = "proxmox_vmid"
	guestDiskKey = "disk_gb"
)

func (ed *topologyEditor) addVM(op TopologyOp) (TopologyOp, error) {
	hostID, err := ed.resolveNode(op.Host, "host")
	if err != nil {
		return op, err
	}
	host := &ed.graph.Nodes[ed.nodeIndex(hostID)]
	if !vmHostNodeTypes[host.Type] {
		return op, fmt.Errorf("%q is a %s and cannot run VMs or services; use a server, mini PC, PC, NAS, SBC, VPS or IoT host", host.Name, host.Type)
	}
	if len(host.VMs) >= maxVMsPerNode {
		return op, fmt.Errorf("%q already runs %d VMs and services", host.Name, maxVMsPerNode)
	}

	vm := VMDTO{Type: "container", Status: "running", Details: map[string]any{}}
	if strings.TrimSpace(op.CatalogServiceID) != "" {
		service, err := ed.catalogService(op.CatalogServiceID)
		if err != nil {
			return op, err
		}
		vm.Name = service.Name
		vm.Details["catalog_service_id"] = service.ID.String()
		vm.Details["catalog_service_name"] = service.Name
		if requirements := service.Requirements; requirements != nil {
			vm.CPUCores = float64(requirements.RecommendedCPUCores)
			if vm.CPUCores == 0 {
				vm.CPUCores = float64(requirements.MinCPUCores)
			}
			vm.RAMMB = requirements.RecommendedRAMMB
			if vm.RAMMB == 0 {
				vm.RAMMB = requirements.MinRAMMB
			}
		}
		if service.Game != nil {
			// A game from the catalog becomes a game server, LAN-only until told otherwise.
			vm.Details[gaming.InstanceKey] = gaming.Instance{Profile: service.Game.Slug}.Details()
		}
	}
	if err := applyVMFields(&vm, op); err != nil {
		return op, err
	}
	if err := applyGameFields(&vm, op, true); err != nil {
		return op, err
	}
	if vm.Name, err = cleanName(vm.Name, ""); err != nil {
		return op, err
	}
	if vm.ID, err = ed.newEntityID(op.ID); err != nil {
		return op, err
	}
	if err := ed.registerRef(op.Ref, vm.ID, "vm"); err != nil {
		return op, err
	}
	host.VMs = append(host.VMs, vm)
	wireVirtualGuest(host.Details, vm.ID)

	resolved := op
	resolved.ID = vm.ID
	resolved.Host = hostID
	return resolved, nil
}

func (ed *topologyEditor) updateVM(op TopologyOp) (TopologyOp, error) {
	nodeIdx, vmIdx, err := ed.resolveVM(op.VM)
	if err != nil {
		return op, err
	}
	vm := &ed.graph.Nodes[nodeIdx].VMs[vmIdx]
	if vm.Details == nil {
		vm.Details = map[string]any{}
	}
	if err := applyVMFields(vm, op); err != nil {
		return op, err
	}
	if err := applyGameFields(vm, op, false); err != nil {
		return op, err
	}
	resolved := op
	resolved.VM = vm.ID
	return resolved, nil
}

// applyGameFields sets the game server settings of a guest and sizes it for
// its players. Memory and cores given in the same operation are kept; on a new
// server they are sized even when no game field is given.
func applyGameFields(vm *VMDTO, op TopologyOp, created bool) error {
	instance, isGame, err := gaming.ParseInstance(vm.Details[gaming.InstanceKey])
	if err != nil {
		return err
	}
	changed := op.Players != nil || op.Exposure != nil || op.PortOffset != nil
	if !isGame {
		if changed {
			return fmt.Errorf("%q is not a game server; players, exposure and port_offset apply to services added from a game in the catalog (see list_services)", vm.Name)
		}
		return nil
	}
	if !changed && !created {
		return nil
	}
	if op.Players != nil {
		if *op.Players != math.Trunc(*op.Players) || *op.Players < 1 {
			return fmt.Errorf("players must be a whole number of at least 1")
		}
		instance.Players = int(*op.Players)
	}
	if op.Exposure != nil {
		instance.Exposure = strings.ToLower(strings.TrimSpace(*op.Exposure))
	}
	if op.PortOffset != nil {
		if *op.PortOffset != math.Trunc(*op.PortOffset) {
			return errors.New("port_offset must be a whole number")
		}
		instance.PortOffset = int(*op.PortOffset)
	}
	instance, profile, err := instance.Normalize()
	if err != nil {
		return err
	}
	vm.Details[gaming.InstanceKey] = instance.Details()

	if created || op.Players != nil {
		needed := gaming.SizeServer(profile, instance.Players)
		if op.CPUCores == nil {
			vm.CPUCores = needed.CPUCores
		}
		if op.RAMMB == nil {
			vm.RAMMB = needed.RAMMB
		}
	}
	return nil
}

func (ed *topologyEditor) removeVM(op TopologyOp) (TopologyOp, error) {
	nodeIdx, vmIdx, err := ed.resolveVM(op.VM)
	if err != nil {
		return op, err
	}
	host := &ed.graph.Nodes[nodeIdx]
	vmID := host.VMs[vmIdx].ID
	host.VMs = append(host.VMs[:vmIdx], host.VMs[vmIdx+1:]...)
	unwireVirtualGuest(host.Details, vmID)
	resolved := op
	resolved.VM = vmID
	return resolved, nil
}

func applyVMFields(vm *VMDTO, op TopologyOp) error {
	if op.Type != "" {
		vmType, err := cleanEnum("type", op.Type, vmTypes)
		if err != nil {
			return err
		}
		vm.Type = vmType
	}
	if op.Name != nil {
		name, err := cleanName(*op.Name, "")
		if err != nil {
			return err
		}
		vm.Name = name
	}
	if op.CPUCores != nil {
		if err := checkRange("cpu_cores", *op.CPUCores, 0, 1024); err != nil {
			return err
		}
		vm.CPUCores = *op.CPUCores
	}
	if op.RAMMB != nil {
		if err := checkRange("ram_mb", *op.RAMMB, 0, 16*1024*1024); err != nil {
			return err
		}
		vm.RAMMB = int(math.Round(*op.RAMMB))
	}
	if op.OS != nil {
		os, err := cleanText("os", *op.OS, 80)
		if err != nil {
			return err
		}
		vm.OS = os
	}
	if op.Status != nil {
		status, err := cleanEnum("status", *op.Status, vmStatuses)
		if err != nil {
			return err
		}
		vm.Status = status
	}
	if op.MacAddress != nil {
		mac, err := cleanMAC(*op.MacAddress)
		if err != nil {
			return err
		}
		vm.MacAddress = mac
	}
	if op.DiskGB != nil {
		if err := checkRange("disk_gb", *op.DiskGB, 0, 4_000_000); err != nil {
			return err
		}
		if *op.DiskGB == 0 {
			delete(vm.Details, guestDiskKey)
		} else {
			vm.Details[guestDiskKey] = *op.DiskGB
		}
	}
	if op.VMID != nil {
		if *op.VMID != math.Trunc(*op.VMID) || *op.VMID < 0 || *op.VMID > 999_999_999 {
			return errors.New("vmid must be a whole number")
		}
		if *op.VMID == 0 {
			delete(vm.Details, guestVMIDKey)
		} else {
			vm.Details[guestVMIDKey] = *op.VMID
		}
	}
	if op.StaticIP != nil {
		static := strings.TrimSpace(*op.StaticIP)
		if static == "" {
			delete(vm.Details, "static_ip")
			vm.IP = ""
		} else {
			if !isIPv4(static) {
				return fmt.Errorf("static_ip %q is not an IPv4 address", static)
			}
			vm.Details["static_ip"] = static
			vm.IP = static
		}
	}
	return nil
}

// wireVirtualGuest plugs a new guest into the host's virtual network so IPAM
// reaches it; hosts without a virtual network attach guests implicitly.
func wireVirtualGuest(details map[string]any, vmID string) {
	network, ok := details["virtual_network"].(map[string]any)
	if !ok {
		return
	}
	upstream := "uplink"
	if switches, ok := network["switches"].([]any); ok && len(switches) > 0 {
		if first, ok := switches[0].(map[string]any); ok {
			if id, ok := first["id"].(string); ok && id != "" {
				upstream = id
			}
		}
	}
	edges, _ := network["edges"].([]any)
	network["edges"] = append(edges, map[string]any{"id": "bridge-" + vmID, "source": upstream, "target": vmID})
}

func unwireVirtualGuest(details map[string]any, vmID string) {
	network, ok := details["virtual_network"].(map[string]any)
	if !ok {
		return
	}
	if edges, ok := network["edges"].([]any); ok {
		kept := make([]any, 0, len(edges))
		for _, item := range edges {
			edge, _ := item.(map[string]any)
			if edge != nil && (edge["source"] == vmID || edge["target"] == vmID) {
				continue
			}
			kept = append(kept, item)
		}
		network["edges"] = kept
	}
	if positions, ok := network["positions"].(map[string]any); ok {
		delete(positions, vmID)
	}
}

// ── Internal components ─────────────────────────────────────────────────────

func (ed *topologyEditor) addComponent(op TopologyOp) (TopologyOp, error) {
	nodeID, err := ed.resolveNode(op.Node, "node")
	if err != nil {
		return op, err
	}
	node := &ed.graph.Nodes[ed.nodeIndex(nodeID)]
	if !componentHostNodeTypes[node.Type] {
		return op, fmt.Errorf("%q is a %s and cannot hold internal components", node.Name, node.Type)
	}
	if len(node.InternalComponents) >= maxComponentsPerNode {
		return op, fmt.Errorf("%q already holds %d components", node.Name, maxComponentsPerNode)
	}

	component := ComponentDTO{Type: strings.ToLower(strings.TrimSpace(op.Type)), Details: map[string]any{}}
	if strings.TrimSpace(op.HardwareID) != "" {
		hardware, err := ed.catalogHardware(op.HardwareID)
		if err != nil {
			return op, err
		}
		catalogType := HardwareCategoryToNodeType(hardware.Category)
		if !componentTypes[catalogType] {
			return op, fmt.Errorf("%s %s is a %s, not an internal component; add it with add_node", hardware.Brand, hardware.Model, catalogType)
		}
		if component.Type == "" {
			component.Type = catalogType
		}
		component.Name = strings.TrimSpace(hardware.Brand + " " + hardware.Model)
		component.Details, component.PowerDraw = catalogHardwareDetails(hardware)
	}
	if !componentTypes[component.Type] {
		return op, fmt.Errorf("unsupported component type %q; use disk, gpu, hba or pcie", component.Type)
	}
	if op.Name != nil {
		component.Name = *op.Name
	}
	if component.Name, err = cleanName(component.Name, ""); err != nil {
		return op, err
	}
	if err := mergeDetails(component.Details, op.Details, component.Type); err != nil {
		return op, err
	}
	if op.PowerDraw != nil {
		if err := checkRange("power_draw", *op.PowerDraw, 0, 100000); err != nil {
			return op, err
		}
		component.PowerDraw = *op.PowerDraw
	}
	if component.ID, err = ed.newEntityID(op.ID); err != nil {
		return op, err
	}
	if err := ed.registerRef(op.Ref, component.ID, "component"); err != nil {
		return op, err
	}
	node.InternalComponents = append(node.InternalComponents, component)

	resolved := op
	resolved.ID = component.ID
	resolved.Node = nodeID
	resolved.Type = component.Type
	return resolved, nil
}

func (ed *topologyEditor) removeComponent(op TopologyOp) (TopologyOp, error) {
	nodeIdx, componentIdx, err := ed.resolveComponent(op.Component)
	if err != nil {
		return op, err
	}
	node := &ed.graph.Nodes[nodeIdx]
	componentID := node.InternalComponents[componentIdx].ID
	node.InternalComponents = append(node.InternalComponents[:componentIdx], node.InternalComponents[componentIdx+1:]...)
	resolved := op
	resolved.Component = componentID
	return resolved, nil
}

func (ed *topologyEditor) renameBuild(op TopologyOp) (TopologyOp, error) {
	if op.Name == nil {
		return op, errors.New("name is required")
	}
	name, err := cleanName(*op.Name, "")
	if err != nil {
		return op, err
	}
	ed.graph.Name = name
	return op, nil
}
