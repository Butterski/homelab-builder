package core

import (
	"fmt"
	"net"
	"sort"
	"strings"

	"github.com/Butterski/hlbipam/internal/models"
)

func mergeZones(custom map[string]models.ZoneOverride) map[string]ZoneConfig {
	zones := make(map[string]ZoneConfig)
	for k, v := range DefaultDeviceZones {
		zones[k] = v
	}
	for k, v := range custom {
		zones[k] = ZoneConfig{
			BaseOffset: v.BaseOffset,
			Step:       v.Step,
			CanHostVMs: v.CanHostVMs,
		}
	}
	return zones
}

type allocationDomain struct {
	nodeIndexes []int
	allocator   *SubnetAllocator
	owners      map[uint32]string
}

func Allocate(req models.AllocateRequest) models.AllocateResponse {
	resp := models.AllocateResponse{
		Conflicts: make([]models.Issue, 0),
		Warnings:  make([]models.Issue, 0),
		Nodes:     make([]models.NodeResult, len(req.Nodes)),
		Routers:   make([]models.RouterResult, len(req.Routers)),
	}
	for i := range req.Nodes {
		resp.Nodes[i] = models.NodeResult{
			ID:   req.Nodes[i].ID,
			Type: req.Nodes[i].Type,
			VMs:  make([]models.VMResult, len(req.Nodes[i].VMs)),
		}
		for j := range req.Nodes[i].VMs {
			resp.Nodes[i].VMs[j].ID = req.Nodes[i].VMs[j].ID
		}
	}

	if len(req.Routers) == 0 {
		resp.Conflicts = append(resp.Conflicts, models.Issue{Message: "topology requires at least one router"})
		return resp
	}

	zones := mergeZones(req.CustomZones)
	routerIndex := make(map[string]int, len(req.Routers))
	routerDomain := make([]string, len(req.Routers))
	domainDHCP := make(map[string]bool)
	globalGateways := make(map[string]string)

	for i := range req.Routers {
		r := &req.Routers[i]
		defaultGateway := fmt.Sprintf("192.168.%d.1", i+1)
		if r.GatewayIP == "" {
			r.GatewayIP = defaultGateway
		} else if !isValidIPv4(r.GatewayIP) {
			resp.Conflicts = append(resp.Conflicts, models.Issue{NodeID: r.ID, Message: fmt.Sprintf("invalid gateway IPv4 address %q; using %s", r.GatewayIP, defaultGateway)})
			r.GatewayIP = defaultGateway
		}
		if r.Subnet == "" {
			r.Subnet = r.GatewayIP + "/24"
		}

		network, capacity, mask, err := parseCIDR(r.Subnet)
		gateway := ipToUint32(net.ParseIP(r.GatewayIP))
		if err != nil || capacity <= 1 || gateway <= network || gateway >= network+capacity {
			resp.Conflicts = append(resp.Conflicts, models.Issue{NodeID: r.ID, Message: fmt.Sprintf("gateway %s is not a usable address in subnet %s; using its /24", r.GatewayIP, r.Subnet)})
			r.Subnet = r.GatewayIP + "/24"
			network, _, mask, _ = parseCIDR(r.Subnet)
		}

		key := fmt.Sprintf("%08x/%08x", network, mask)
		routerDomain[i] = key
		domainDHCP[key] = domainDHCP[key] || r.DHCPEnabled
		routerIndex[r.ID] = i
		resp.Routers[i] = models.RouterResult{ID: r.ID, GatewayIP: r.GatewayIP, Subnet: r.Subnet}

		if owner, exists := globalGateways[r.GatewayIP]; exists {
			resp.Conflicts = append(resp.Conflicts, models.Issue{NodeID: r.ID, Message: fmt.Sprintf("gateway IP %s conflicts with %s", r.GatewayIP, owner)})
		} else {
			globalGateways[r.GatewayIP] = r.ID
		}
	}

	nodeIndex := make(map[string]int, len(req.Nodes))
	adjacency := make(map[string][]string, len(req.Nodes)+len(req.Routers))
	for i := range req.Nodes {
		n := &req.Nodes[i]
		nodeIndex[n.ID] = i
		if _, exists := adjacency[n.ID]; !exists {
			adjacency[n.ID] = nil
		}
		for _, neighbor := range n.Connections {
			adjacency[n.ID] = appendUnique(adjacency[n.ID], neighbor)
			adjacency[neighbor] = appendUnique(adjacency[neighbor], n.ID)
		}
	}

	ownerRouter := make(map[string]int, len(req.Nodes))
	for ri := range req.Routers {
		routerID := req.Routers[ri].ID
		seen := map[string]bool{routerID: true}
		queue := []string{routerID}
		for len(queue) > 0 {
			current := queue[0]
			queue = queue[1:]
			for _, neighbor := range adjacency[current] {
				if seen[neighbor] || skipNATBoundary(routerID, current, neighbor) {
					continue
				}
				seen[neighbor] = true
				if _, isRouter := routerIndex[neighbor]; isRouter {
					continue
				}
				idx, isNode := nodeIndex[neighbor]
				if !isNode {
					continue
				}
				if _, owned := ownerRouter[neighbor]; !owned {
					ownerRouter[neighbor] = ri
				}
				if !NonNetworkTypes[req.Nodes[idx].Type] {
					queue = append(queue, neighbor)
				}
			}
		}
	}

	// Lease demand per subnet: devices that exist only as a count on a node.
	domainDemand := make(map[string]int)
	for i := range req.Nodes {
		if req.Nodes[i].DHCPClients <= 0 {
			continue
		}
		if ri, reachable := ownerRouter[req.Nodes[i].ID]; reachable {
			domainDemand[routerDomain[ri]] += req.Nodes[i].DHCPClients
		}
	}

	domainByKey := make(map[string]*allocationDomain)
	domainOrder := make([]string, 0, len(req.Routers))
	for ri := range req.Routers {
		key := routerDomain[ri]
		domain, exists := domainByKey[key]
		if !exists {
			r := req.Routers[ri]
			sa := NewSubnetAllocator(r.Subnet, r.GatewayIP, domainDHCP[key], domainDemand[key])
			domain = &allocationDomain{
				allocator: sa,
				owners: map[uint32]string{
					sa.Network:               "network address",
					sa.Network + sa.Capacity: "broadcast address",
				},
			}
			domainByKey[key] = domain
			domainOrder = append(domainOrder, key)

			demand := domainDemand[key]
			switch {
			case demand > 0 && sa.DHCPStart == 0:
				resp.Warnings = append(resp.Warnings, models.Issue{NodeID: r.ID, Message: fmt.Sprintf("%d devices expect an address from DHCP, but DHCP is off on this network", demand)})
			case demand > sa.DHCPPoolSize():
				resp.Warnings = append(resp.Warnings, models.Issue{NodeID: r.ID, Message: fmt.Sprintf("the DHCP pool holds %d addresses but %d devices expect one; use a larger subnet such as 255.255.254.0", sa.DHCPPoolSize(), demand)})
			}
		}
		if sa := domain.allocator; sa.DHCPStart != 0 {
			resp.Routers[ri].DHCPStart = sa.FormatIP(sa.DHCPStart)
			resp.Routers[ri].DHCPEnd = sa.FormatIP(sa.DHCPEnd)
			resp.Routers[ri].DHCPSize = sa.DHCPPoolSize()
		}
		resp.Routers[ri].DHCPClients = domainDemand[key]
		gateway := ipToUint32(net.ParseIP(req.Routers[ri].GatewayIP))
		if previous, exists := domain.owners[gateway]; exists {
			resp.Conflicts = append(resp.Conflicts, models.Issue{NodeID: req.Routers[ri].ID, Message: fmt.Sprintf("gateway IP %s conflicts with %s", req.Routers[ri].GatewayIP, previous)})
		} else {
			domain.allocator.Used[gateway] = true
			domain.owners[gateway] = req.Routers[ri].ID
		}
	}
	for i := range req.Nodes {
		ri, reachable := ownerRouter[req.Nodes[i].ID]
		if !reachable {
			_, declaredRouter := routerIndex[req.Nodes[i].ID]
			if req.Nodes[i].Type != "router" && !declaredRouter && !NonNetworkTypes[req.Nodes[i].Type] {
				resp.Warnings = append(resp.Warnings, models.Issue{NodeID: req.Nodes[i].ID, Message: "node is not reachable from a router"})
			}
			continue
		}
		domainByKey[routerDomain[ri]].nodeIndexes = append(domainByKey[routerDomain[ri]].nodeIndexes, i)
	}

	for _, key := range domainOrder {
		allocateDomain(domainByKey[key], req.Nodes, zones, &resp)
	}

	return resp
}

func allocateDomain(domain *allocationDomain, nodes []models.NodeDTO, zones map[string]ZoneConfig, resp *models.AllocateResponse) {
	sa := domain.allocator
	hostCount := 0
	for _, idx := range domain.nodeIndexes {
		if !NonNetworkTypes[nodes[idx].Type] && GetZone(nodes[idx].Type, zones).CanHostVMs {
			hostCount++
		}
	}

	dhcpReserved := uint32(0)
	if sa.DHCPStart != 0 {
		dhcpReserved = sa.DHCPEnd - sa.DHCPStart + 1
	}
	dynamicStep := CalculateDynamicStep(hostCount, sa.Capacity, dhcpReserved)
	domainZones := make(map[string]ZoneConfig, len(zones))
	for kind, zone := range zones {
		if zone.CanHostVMs {
			zone.Step = dynamicStep
		}
		domainZones[kind] = zone
	}

	acceptedExisting := make(map[string]uint32)
	for _, idx := range domain.nodeIndexes {
		node := &nodes[idx]
		if NonNetworkTypes[node.Type] {
			continue
		}
		preReserveExisting(node.ID, node.ExistingIP, sa, domain.owners, acceptedExisting, resp)
		for i := range node.VMs {
			preReserveExisting(node.VMs[i].ID, node.VMs[i].ExistingIP, sa, domain.owners, acceptedExisting, resp)
		}
	}

	infra := make([]int, 0)
	hostByType := make(map[string][]int)
	for _, idx := range domain.nodeIndexes {
		node := &nodes[idx]
		if NonNetworkTypes[node.Type] {
			continue
		}
		zone := GetZone(node.Type, domainZones)
		if zone.CanHostVMs {
			hostByType[node.Type] = append(hostByType[node.Type], idx)
		} else {
			infra = append(infra, idx)
			if len(node.VMs) > 0 {
				resp.Conflicts = append(resp.Conflicts, models.Issue{NodeID: node.ID, Message: fmt.Sprintf("%s nodes cannot host virtual machines or services", node.Type)})
			}
		}
	}

	for _, idx := range infra {
		node := &nodes[idx]
		result := &resp.Nodes[idx]
		if ip, ok := acceptedExisting[node.ID]; ok {
			result.AssignedIP = sa.FormatIP(ip)
			continue
		}
		zone := GetZone(node.Type, domainZones)
		ip := sa.AllocateSlot(zone.BaseOffset)
		if ip == 0 {
			resp.Warnings = append(resp.Warnings, models.Issue{NodeID: node.ID, Message: fmt.Sprintf("subnet exhausted for infrastructure type %q", node.Type)})
			continue
		}
		sa.Used[ip] = true
		domain.owners[ip] = node.ID
		result.AssignedIP = sa.FormatIP(ip)
	}

	orderedTypes := append([]string(nil), VMHostTypeOrder...)
	known := make(map[string]bool, len(orderedTypes))
	for _, kind := range orderedTypes {
		known[kind] = true
	}
	var extraTypes []string
	for kind := range hostByType {
		if !known[kind] {
			extraTypes = append(extraTypes, kind)
		}
	}
	sort.Strings(extraTypes)
	orderedTypes = append(orderedTypes, extraTypes...)

	nextOffset := VMHostStartOffset
	if sa.IsDHCPReserved(sa.Network + uint32(nextOffset)) {
		nextOffset = int(sa.DHCPEnd-sa.Network) + 1
	}

	for _, kind := range orderedTypes {
		zone := GetZone(kind, domainZones)
		for _, idx := range hostByType[kind] {
			node := &nodes[idx]
			result := &resp.Nodes[idx]
			hostIP, hasExisting := acceptedExisting[node.ID]
			if !hasExisting {
				hostIP = sa.AllocateSlot(nextOffset)
				if hostIP == 0 {
					resp.Warnings = append(resp.Warnings, models.Issue{NodeID: node.ID, Message: fmt.Sprintf("subnet exhausted for VM host type %q", node.Type)})
					continue
				}
				sa.Used[hostIP] = true
				domain.owners[hostIP] = node.ID
			}
			result.AssignedIP = sa.FormatIP(hostIP)

			blockEnd := hostIP + uint32(zone.Step) - 1
			lastUsable := sa.Network + sa.Capacity - 1
			if blockEnd > lastUsable || blockEnd < hostIP {
				blockEnd = lastUsable
			}
			for vi := range node.VMs {
				vm := &node.VMs[vi]
				if ip, ok := acceptedExisting[vm.ID]; ok {
					result.VMs[vi].AssignedIP = sa.FormatIP(ip)
					continue
				}
				vmIP := allocateInRange(sa, hostIP+1, blockEnd)
				if vmIP == 0 {
					resp.Warnings = append(resp.Warnings, models.Issue{NodeID: vm.ID, Message: fmt.Sprintf("IP block for host %s is exhausted", node.ID)})
					continue
				}
				sa.Used[vmIP] = true
				domain.owners[vmIP] = vm.ID
				result.VMs[vi].AssignedIP = sa.FormatIP(vmIP)
			}
			for ip := hostIP + 1; ip <= blockEnd && ip > hostIP; ip++ {
				if !sa.IsDHCPReserved(ip) {
					sa.Used[ip] = true
				}
			}
			offset := int(hostIP-sa.Network) + zone.Step
			if offset > nextOffset {
				nextOffset = offset
			}
		}
	}
}

func preReserveExisting(entityID, value string, sa *SubnetAllocator, owners map[uint32]string, accepted map[string]uint32, resp *models.AllocateResponse) {
	if value == "" {
		return
	}
	if !isValidIPv4(value) {
		resp.Conflicts = append(resp.Conflicts, models.Issue{NodeID: entityID, Message: fmt.Sprintf("invalid IPv4 address %q; a safe address was assigned instead", value)})
		return
	}
	ip := ipToUint32(net.ParseIP(value))
	if !sa.IsUsable(ip) {
		resp.Conflicts = append(resp.Conflicts, models.Issue{NodeID: entityID, Message: fmt.Sprintf("IP %s is outside the assigned subnet; a safe address was assigned instead", value)})
		return
	}
	if sa.IsDHCPReserved(ip) {
		resp.Conflicts = append(resp.Conflicts, models.Issue{NodeID: entityID, Message: fmt.Sprintf("IP %s is inside the DHCP pool; a safe address was assigned instead", value)})
		return
	}
	if owner, used := owners[ip]; used || sa.Used[ip] {
		if owner == "" {
			owner = "another reservation"
		}
		resp.Conflicts = append(resp.Conflicts, models.Issue{NodeID: entityID, Message: fmt.Sprintf("IP %s conflicts with %s; a safe address was assigned instead", value, owner)})
		return
	}
	sa.Used[ip] = true
	owners[ip] = entityID
	accepted[entityID] = ip
}

func allocateInRange(sa *SubnetAllocator, start, end uint32) uint32 {
	if start <= sa.Network {
		start = sa.Network + 1
	}
	if sa.Capacity <= 1 {
		return 0
	}
	lastUsable := sa.Network + sa.Capacity - 1
	if end > lastUsable {
		end = lastUsable
	}
	for ip := start; ip <= end && ip >= start; ip++ {
		if sa.IsAvailable(ip) {
			return ip
		}
	}
	return 0
}

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func skipNATBoundary(routerID, current, neighbor string) bool {
	return strings.HasSuffix(routerID, ":lan") &&
		current == routerID &&
		neighbor == strings.TrimSuffix(routerID, ":lan")
}
