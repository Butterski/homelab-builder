package core

import (
	"fmt"
	"net"

	"github.com/Butterski/hlbipam/internal/models"
	"github.com/Butterski/hlbipam/internal/utils"
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
			Label:      k,
		}
	}
	return zones
}

func Allocate(req models.AllocateRequest) models.AllocateResponse {
	resp := models.AllocateResponse{
		Conflicts: make([]models.Issue, 0),
		Warnings:  make([]models.Issue, 0),
	}

	zones := mergeZones(req.CustomZones)
	totalNodes := len(req.Nodes)

	type nodeEntry struct {
		dto *models.NodeDTO
		idx int
	}
	nodeIndex := make(map[string]nodeEntry, totalNodes)
	for i := range req.Nodes {
		nodeIndex[req.Nodes[i].ID] = nodeEntry{dto: &req.Nodes[i], idx: i}
	}

	adj := make(map[string][]string, totalNodes)
	isRouter := make(map[string]bool, len(req.Routers))
	for i := range req.Routers {
		isRouter[req.Routers[i].ID] = true
	}

	for i := range req.Nodes {
		n := &req.Nodes[i]
		adj[n.ID] = n.Connections
		for _, neighbor := range n.Connections {
			if isRouter[neighbor] {
				adj[neighbor] = append(adj[neighbor], n.ID)
			}
		}
	}

	for i := range req.Routers {
		r := &req.Routers[i]
		if r.GatewayIP == "" {
			r.GatewayIP = fmt.Sprintf("192.168.%d.1", i+1)
		}
		if r.Subnet == "" {
			r.Subnet = fmt.Sprintf("%s/24", r.GatewayIP)
		}
	}

	type preReserve struct {
		ipUint uint32
	}
	var preReserves []preReserve
	for i := range req.Nodes {
		n := &req.Nodes[i]
		if n.ExistingIP != "" && utils.IsValidIPv4(n.ExistingIP) {
			preReserves = append(preReserves, preReserve{ipUint: utils.IPToUint32(net.ParseIP(n.ExistingIP))})
		}
		for j := range n.VMs {
			vm := &n.VMs[j]
			if vm.ExistingIP != "" && utils.IsValidIPv4(vm.ExistingIP) {
				preReserves = append(preReserves, preReserve{ipUint: utils.IPToUint32(net.ParseIP(vm.ExistingIP))})
			}
		}
	}

	visited := make(map[string]bool, totalNodes+len(req.Routers))

	results := make([]models.NodeResult, totalNodes)
	for i := range req.Nodes {
		results[i] = models.NodeResult{
			ID:   req.Nodes[i].ID,
			Type: req.Nodes[i].Type,
			VMs:  make([]models.VMResult, len(req.Nodes[i].VMs)),
		}
		for j := range req.Nodes[i].VMs {
			results[i].VMs[j].ID = req.Nodes[i].VMs[j].ID
		}
	}

	routerResults := make([]models.RouterResult, len(req.Routers))
	for i := range req.Routers {
		routerResults[i] = models.RouterResult{
			ID:        req.Routers[i].ID,
			GatewayIP: req.Routers[i].GatewayIP,
			Subnet:    req.Routers[i].Subnet,
		}
	}

	for ri := range req.Routers {
		r := &req.Routers[ri]
		if visited[r.ID] {
			continue
		}
		visited[r.ID] = true

		vmHostCount := 0
		for i := range req.Nodes {
			n := &req.Nodes[i]
			if NonNetworkTypes[n.Type] {
				continue
			}
			zone := GetZone(n.Type, zones)
			if zone.CanHostVMs {
				vmHostCount++
			}
		}

		sa := NewSubnetAllocator(r.Subnet, r.GatewayIP, zones, r.DHCPEnabled)
		
		dhcpReserved := uint32(0)
		if r.DHCPEnabled {
			dhcpReserved = sa.DHCPEnd - sa.DHCPStart + 1
		}
		dynamicStep := CalculateDynamicStep(vmHostCount, sa.Capacity, dhcpReserved)

		subnetZones := make(map[string]ZoneConfig)
		for t, z := range zones {
			if z.CanHostVMs {
				z.Step = dynamicStep
			}
			subnetZones[t] = z
		}
		sa.Zones = subnetZones

		for _, pr := range preReserves {
			if pr.ipUint >= sa.Network && pr.ipUint <= sa.Network+sa.Capacity {
				sa.Reserve(pr.ipUint)
			}
		}

		type pendingNode struct {
			entry nodeEntry
			dto   *models.NodeDTO
		}
		var infraNodes []pendingNode
		vmHostsByType := make(map[string][]pendingNode)

		queue := make([]string, 0, totalNodes)
		queue = append(queue, r.ID)

		routerSubnet := make(map[string]int)
		for idx, rr := range req.Routers {
			routerSubnet[rr.ID] = idx
		}

		for len(queue) > 0 {
			cur := queue[0]
			queue = queue[1:]

			for _, neighborID := range adj[cur] {
				if visited[neighborID] {
					continue
				}
				visited[neighborID] = true

				if _, isRtr := routerSubnet[neighborID]; isRtr {
					queue = append(queue, neighborID)
					continue
				}

				entry, ok := nodeIndex[neighborID]
				if !ok {
					queue = append(queue, neighborID)
					continue
				}
				n := entry.dto
				queue = append(queue, neighborID)

				if NonNetworkTypes[n.Type] {
					continue
				}

				zone := GetZone(n.Type, sa.Zones)
				pn := pendingNode{entry: entry, dto: n}
				if zone.CanHostVMs {
					vmHostsByType[n.Type] = append(vmHostsByType[n.Type], pn)
				} else {
					infraNodes = append(infraNodes, pn)
				}
			}
		}

		for _, pn := range infraNodes {
			n := pn.dto
			res := &results[pn.entry.idx]
			zone := GetZone(n.Type, sa.Zones)

			if n.ExistingIP != "" && utils.IsValidIPv4(n.ExistingIP) {
				res.AssignedIP = n.ExistingIP
				sa.Reserve(utils.IPToUint32(net.ParseIP(n.ExistingIP)))
			} else {
				ip := sa.AllocateSlot(zone.BaseOffset)
				if ip == 0 {
					resp.Warnings = append(resp.Warnings, models.Issue{
						NodeID:  n.ID,
						Message: fmt.Sprintf("subnet exhausted for infra type %q", n.Type),
					})
					continue
				}
				res.AssignedIP = sa.FormatIP(ip)
				sa.Reserve(ip)
			}
		}

		nextZoneStart := sa.Network + uint32(VMHostStartOffset)
		if r.DHCPEnabled && nextZoneStart >= sa.DHCPStart && nextZoneStart <= sa.DHCPEnd {
			nextZoneStart = sa.DHCPEnd + 1
		}

		for _, typeName := range VMHostTypeOrder {
			hosts, exists := vmHostsByType[typeName]
			if !exists || len(hosts) == 0 {
				continue
			}

			zone := GetZone(typeName, sa.Zones)

			for _, pn := range hosts {
				n := pn.dto
				res := &results[pn.entry.idx]

				var hostIP uint32

				if n.ExistingIP != "" && utils.IsValidIPv4(n.ExistingIP) {
					res.AssignedIP = n.ExistingIP
					hostIP = utils.IPToUint32(net.ParseIP(n.ExistingIP))
					sa.Reserve(hostIP)
				} else {
					hostIP = sa.AllocateSlot(int(nextZoneStart - sa.Network))
					if hostIP == 0 {
						resp.Warnings = append(resp.Warnings, models.Issue{
							NodeID:  n.ID,
							Message: fmt.Sprintf("subnet exhausted for VM host type %q", n.Type),
						})
						continue
					}
					res.AssignedIP = sa.FormatIP(hostIP)
					sa.Reserve(hostIP)
				}

				if zone.CanHostVMs && len(n.VMs) > 0 {
					for j := range n.VMs {
						vm := &n.VMs[j]
						if vm.ExistingIP != "" && utils.IsValidIPv4(vm.ExistingIP) {
							res.VMs[j].AssignedIP = vm.ExistingIP
							sa.Reserve(utils.IPToUint32(net.ParseIP(vm.ExistingIP)))
						} else {
							vmIP := sa.AllocateSlot(int(hostIP - sa.Network + 1))
							if vmIP != 0 {
								res.VMs[j].AssignedIP = sa.FormatIP(vmIP)
								sa.Reserve(vmIP)
							} else {
								resp.Warnings = append(resp.Warnings, models.Issue{
									NodeID:  vm.ID,
									Message: "exhausted IP space for VM",
								})
							}
						}
					}
				}
				
				// SEAL the block
				for k := 1; k < zone.Step; k++ {
					sa.Reserve(hostIP + uint32(k))
				}
			}
		}
	}

	resp.Routers = routerResults
	resp.Nodes = results
	return resp
}
