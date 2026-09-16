package services

import (
	"encoding/json"
	"fmt"
	"net"
	"sort"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

// Virtual networks belong to one host. Switches forward traffic; VMs are endpoints.
type virtualNetwork struct {
	Switches []struct {
		ID   string  `json:"id"`
		Name string  `json:"name"`
		X    float64 `json:"x"`
		Y    float64 `json:"y"`
	} `json:"switches"`
	Positions map[string]struct {
		X float64 `json:"x"`
		Y float64 `json:"y"`
	} `json:"positions"`
	Edges []struct {
		ID     string `json:"id"`
		Source string `json:"source"`
		Target string `json:"target"`
	} `json:"edges"`
}

func readVirtualNetwork(details json.RawMessage) (*virtualNetwork, error) {
	var wrapper struct {
		Network *virtualNetwork `json:"virtual_network"`
	}
	if err := json.Unmarshal(details, &wrapper); err != nil {
		return nil, err
	}
	return wrapper.Network, nil
}

func virtualReachable(network *virtualNetwork) map[string]bool {
	reached := map[string]bool{"uplink": true}
	switches := map[string]bool{"uplink": true}
	for _, sw := range network.Switches {
		switches[sw.ID] = true
	}
	adjacency := map[string][]string{}
	for _, edge := range network.Edges {
		adjacency[edge.Source] = append(adjacency[edge.Source], edge.Target)
		adjacency[edge.Target] = append(adjacency[edge.Target], edge.Source)
	}
	queue := []string{"uplink"}
	for i := 0; i < len(queue); i++ {
		for _, next := range adjacency[queue[i]] {
			if reached[next] {
				continue
			}
			reached[next] = true
			if switches[next] {
				queue = append(queue, next)
			}
		}
	}
	return reached
}

func validateVirtualNetworks(nodes []NodeDTO) error {
	for _, node := range nodes {
		details, err := json.Marshal(node.Details)
		if err != nil {
			return fmt.Errorf("%w: invalid host details", ErrInvalidTopology)
		}
		network, err := readVirtualNetwork(details)
		if err != nil {
			return fmt.Errorf("%w: invalid virtual network for %s", ErrInvalidTopology, node.Name)
		}
		if network == nil {
			continue
		}
		if network.Switches == nil || network.Edges == nil || network.Positions == nil {
			return fmt.Errorf("%w: virtual networks require switches, edges, and positions", ErrInvalidTopology)
		}
		endpoints := map[string]bool{"uplink": true}
		for _, vm := range node.VMs {
			if _, err := uuid.Parse(vm.ID); err != nil {
				return fmt.Errorf("%w: virtual machine IDs must be UUIDs", ErrInvalidTopology)
			}
			if endpoints[vm.ID] {
				return fmt.Errorf("%w: duplicate virtual endpoint", ErrInvalidTopology)
			}
			endpoints[vm.ID] = true
			if value, exists := vm.Details["static_ip"]; exists && value != "" {
				ip, ok := value.(string)
				if !ok || net.ParseIP(ip).To4() == nil {
					return fmt.Errorf("%w: invalid IPv4 address for %s", ErrInvalidTopology, vm.Name)
				}
			}
		}
		for _, sw := range network.Switches {
			if sw.ID == "" || endpoints[sw.ID] {
				return fmt.Errorf("%w: invalid virtual switch ID", ErrInvalidTopology)
			}
			endpoints[sw.ID] = true
		}
		edgeIDs := map[string]bool{}
		pairs := map[string]bool{}
		for _, edge := range network.Edges {
			pair, reverse := edge.Source+"/"+edge.Target, edge.Target+"/"+edge.Source
			if !endpoints[edge.Source] || !endpoints[edge.Target] || edge.Source == edge.Target || edge.ID == "" || edgeIDs[edge.ID] || pairs[pair] || pairs[reverse] {
				return fmt.Errorf("%w: invalid virtual connection on %s", ErrInvalidTopology, node.Name)
			}
			edgeIDs[edge.ID], pairs[pair] = true, true
		}
		for id := range network.Positions {
			if !endpoints[id] {
				return fmt.Errorf("%w: unknown virtual endpoint position", ErrInvalidTopology)
			}
		}
	}
	return nil
}

func requestedVMIP(vm models.VirtualMachine) string {
	var details struct {
		StaticIP string `json:"static_ip"`
	}
	_ = json.Unmarshal(vm.Details, &details)
	return details.StaticIP
}

func virtualIPAMGuests(node models.Node) []ipamVM {
	network, _ := readVirtualNetwork(node.Details)
	var reached map[string]bool
	if network != nil {
		reached = virtualReachable(network)
	}
	guests := make([]ipamVM, 0, len(node.VirtualMachines))
	for _, vm := range node.VirtualMachines {
		if network != nil && !reached[vm.ID.String()] {
			continue
		}
		ip := vm.IP
		if network != nil {
			ip = requestedVMIP(vm)
		}
		guests = append(guests, ipamVM{ID: vm.ID.String(), ExistingIP: ip})
	}
	// Database preload order is not stable. Keep automatic addresses stable across saves.
	if network != nil {
		sort.Slice(guests, func(i, j int) bool { return guests[i].ID < guests[j].ID })
	}
	return guests
}

func remapVirtualNetwork(details json.RawMessage, ids map[string]string) (json.RawMessage, error) {
	network, err := readVirtualNetwork(details)
	if err != nil || network == nil {
		return details, err
	}
	for i := range network.Edges {
		if id, ok := ids[network.Edges[i].Source]; ok {
			network.Edges[i].Source = id
		}
		if id, ok := ids[network.Edges[i].Target]; ok {
			network.Edges[i].Target = id
		}
	}
	for old, id := range ids {
		if position, ok := network.Positions[old]; ok {
			network.Positions[id] = position
			delete(network.Positions, old)
		}
	}
	var wrapper map[string]any
	if err := json.Unmarshal(details, &wrapper); err != nil {
		return nil, err
	}
	wrapper["virtual_network"] = network
	return json.Marshal(wrapper)
}
