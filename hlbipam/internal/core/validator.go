package core

import (
	"fmt"
	"net"

	"github.com/Butterski/hlbipam/internal/models"
	"github.com/Butterski/hlbipam/internal/utils"
)

func Validate(req models.AllocateRequest) models.ValidateResponse {
	resp := models.ValidateResponse{
		Valid:    true,
		Errors:   make([]models.Issue, 0),
		Warnings: make([]models.Issue, 0),
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
	for i := range req.Nodes {
		n := &req.Nodes[i]
		for _, connID := range n.Connections {
			adj[n.ID] = append(adj[n.ID], connID)
			adj[connID] = append(adj[connID], n.ID)
		}
	}

	routerSubnet := make(map[string]int, len(req.Routers))
	for i := range req.Routers {
		r := &req.Routers[i]
		if r.GatewayIP == "" {
			r.GatewayIP = fmt.Sprintf("192.168.%d.1", i+1)
		}
		if r.Subnet == "" {
			r.Subnet = fmt.Sprintf("%s/24", r.GatewayIP)
		}
		routerSubnet[r.ID] = i
	}

	globalIPs := make(map[string]string, totalNodes*2)

	for i := range req.Routers {
		r := &req.Routers[i]
		if r.GatewayIP != "" {
			if owner, exists := globalIPs[r.GatewayIP]; exists {
				addError(&resp, r.ID, fmt.Sprintf("gateway IP %s conflicts with %s", r.GatewayIP, owner))
			} else {
				globalIPs[r.GatewayIP] = r.ID
			}
		}
	}

	visited := make(map[string]bool, totalNodes+len(req.Routers))

	for ri := range req.Routers {
		r := &req.Routers[ri]
		if visited[r.ID] {
			continue
		}
		visited[r.ID] = true

		network, capacity, _, err := utils.ParseCIDR(r.Subnet)
		if err != nil {
			network, capacity, _, _ = utils.ParseCIDR(r.GatewayIP + "/24")
		}
		
		sa := NewSubnetAllocator(r.Subnet, r.GatewayIP, zones, r.DHCPEnabled)

		queue := make([]string, 0, totalNodes)
		queue = append(queue, r.ID)

		for len(queue) > 0 {
			cur := queue[0]
			queue = queue[1:]

			for _, neighborID := range adj[cur] {
				if visited[neighborID] {
					continue
				}
				visited[neighborID] = true
				queue = append(queue, neighborID)

				if _, isRouter := routerSubnet[neighborID]; isRouter {
					continue
				}

				entry, ok := nodeIndex[neighborID]
				if !ok {
					continue
				}
				n := entry.dto

				if NonNetworkTypes[n.Type] {
					continue
				}

				ip := n.ExistingIP
				if ip == "" {
					continue
				}

				if !utils.IsValidIPv4(ip) {
					addError(&resp, n.ID, fmt.Sprintf("invalid IPv4 address: %s", ip))
					continue
				}

				ipUint := utils.IPToUint32(net.ParseIP(ip))

				if ipUint < network || ipUint >= network+capacity {
					addError(&resp, n.ID, fmt.Sprintf("IP %s is outside subnet %s", ip, r.Subnet))
				}

				if sa.DHCPStart > 0 && ipUint >= sa.DHCPStart && ipUint <= sa.DHCPEnd {
					addError(&resp, n.ID, fmt.Sprintf("IP %s falls within DHCP range %s–%s", ip, utils.Uint32ToIP(sa.DHCPStart), utils.Uint32ToIP(sa.DHCPEnd)))
				}

				if owner, exists := globalIPs[ip]; exists {
					addError(&resp, n.ID, fmt.Sprintf("IP %s conflicts with %s", ip, owner))
				} else {
					globalIPs[ip] = n.ID
				}

				for j := range n.VMs {
					vm := &n.VMs[j]
					vmIP := vm.ExistingIP
					if vmIP == "" {
						continue
					}
					if !utils.IsValidIPv4(vmIP) {
						addError(&resp, vm.ID, fmt.Sprintf("invalid IPv4 address: %s", vmIP))
						continue
					}
					vmUint := utils.IPToUint32(net.ParseIP(vmIP))
					if vmUint < network || vmUint >= network+capacity {
						addError(&resp, vm.ID, fmt.Sprintf("VM IP %s is outside subnet %s", vmIP, r.Subnet))
					}
					if sa.DHCPStart > 0 && vmUint >= sa.DHCPStart && vmUint <= sa.DHCPEnd {
						addError(&resp, vm.ID, fmt.Sprintf("VM IP %s falls within DHCP range %s–%s", vmIP, utils.Uint32ToIP(sa.DHCPStart), utils.Uint32ToIP(sa.DHCPEnd)))
					}
					if owner, exists := globalIPs[vmIP]; exists {
						addError(&resp, vm.ID, fmt.Sprintf("VM IP %s conflicts with %s", vmIP, owner))
					} else {
						globalIPs[vmIP] = vm.ID
					}
				}
			}
		}
	}

	return resp
}

func addError(resp *models.ValidateResponse, nodeID, message string) {
	resp.Valid = false
	resp.Errors = append(resp.Errors, models.Issue{NodeID: nodeID, Message: message})
}
