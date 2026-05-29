package services

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// IPService proxies IP calculation requests to the hlbIPAM microservice
// and persists results back into the database.
type IPService struct {
	db      *gorm.DB
	client  *http.Client
	ipamURL string
}

func NewIPService(db *gorm.DB) *IPService {
	url := os.Getenv("IPAM_URL")
	if url == "" {
		url = "http://localhost:8081"
	}
	return &IPService{
		db:      db,
		client:  &http.Client{Timeout: 10 * time.Second},
		ipamURL: url,
	}
}

// ── hlbIPAM request/response DTOs ──────────────────────────────────────────

type ipamRouter struct {
	ID          string `json:"id"`
	GatewayIP   string `json:"gateway_ip,omitempty"`
	Subnet      string `json:"subnet,omitempty"`
	DHCPEnabled bool   `json:"dhcp_enabled,omitempty"`
}

type ipamVM struct {
	ID         string `json:"id"`
	ExistingIP string `json:"existing_ip,omitempty"`
}

type ipamNode struct {
	ID          string   `json:"id"`
	Type        string   `json:"type"`
	Connections []string `json:"connections"`
	ExistingIP  string   `json:"existing_ip,omitempty"`
	VMs         []ipamVM `json:"vms,omitempty"`
}

type ipamRequest struct {
	Routers []ipamRouter `json:"routers"`
	Nodes   []ipamNode   `json:"nodes"`
}

type ipamVMResult struct {
	ID         string `json:"id"`
	AssignedIP string `json:"assigned_ip"`
}

type ipamNodeResult struct {
	ID         string         `json:"id"`
	Type       string         `json:"type"`
	AssignedIP string         `json:"assigned_ip"`
	VMs        []ipamVMResult `json:"vms,omitempty"`
}

type ipamRouterResult struct {
	ID        string `json:"id"`
	GatewayIP string `json:"gateway_ip"`
	Subnet    string `json:"subnet"`
}

type ipamResponse struct {
	Routers []ipamRouterResult `json:"routers"`
	Nodes   []ipamNodeResult   `json:"nodes"`
}

// ─── Non-network types that don't receive IPs ───────────────────────────────

var nonNetworkTypes = map[string]bool{
	"disk": true, "gpu": true, "hba": true, "pcie": true, "pdu": true, "ups": true, "rack": true,
}

func ipInGatewaySubnet(ipValue string, gatewayValue string, maskValue string) bool {
	ip := net.ParseIP(ipValue).To4()
	gateway := net.ParseIP(gatewayValue).To4()
	if ip == nil || gateway == nil {
		return false
	}

	if maskValue == "" {
		maskValue = "255.255.255.0"
	}

	var mask net.IPMask
	if strings.Contains(maskValue, ".") {
		maskIP := net.ParseIP(maskValue).To4()
		if maskIP == nil {
			return false
		}
		mask = net.IPMask(maskIP)
	} else {
		_, subnet, err := net.ParseCIDR(gatewayValue + "/" + maskValue)
		if err != nil {
			return false
		}
		mask = subnet.Mask
	}

	return (&net.IPNet{IP: gateway.Mask(mask), Mask: mask}).Contains(ip)
}

// ─── Public API ─────────────────────────────────────────────────────────────

// CalculateNetwork loads the build's topology from the DB, sends it to
// hlbIPAM for allocation, and writes the assigned IPs back.
func (s *IPService) CalculateNetwork(buildID uuid.UUID) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		// 1. Load nodes and edges
		var nodes []models.Node
		if err := tx.Preload("VirtualMachines").Where("build_id = ?", buildID).Find(&nodes).Error; err != nil {
			return err
		}
		if len(nodes) == 0 {
			return nil
		}

		var edges []models.Edge
		if err := tx.Where("build_id = ?", buildID).Find(&edges).Error; err != nil {
			return err
		}

		// Helper to extract numeric port from handle string (e.g. "eth0" -> 0, "eth10" -> 10)
		extractPort := func(h string) int {
			var numStr string
			for _, c := range h {
				if c >= '0' && c <= '9' {
					numStr += string(c)
				}
			}
			if numStr == "" {
				return 0
			}
			val, _ := strconv.Atoi(numStr)
			return val
		}

		type networkDetails struct {
			DHCPEnabled     bool   `json:"dhcp_enabled"`
			DHCPLocked      bool   `json:"dhcp_locked"`
			SubnetMask      string `json:"subnet_mask"`
			NATEnabled      bool   `json:"nat_enabled"`
			RoutingEnabled  bool   `json:"routing_enabled"`
			FirewallEnabled bool   `json:"firewall_enabled"`
			NetworkZone     string `json:"network_zone"`
			PublicIP        string `json:"public_ip"`
			LANGatewayIP    string `json:"lan_gateway_ip"`
			LANSubnet       string `json:"lan_subnet"`
		}

		nodeByID := make(map[string]models.Node, len(nodes))
		detailsByID := make(map[string]networkDetails, len(nodes))
		realGatewayIDs := make(map[string]bool, len(nodes))
		natGatewayIDs := make(map[string]string, len(nodes))
		natNodeByRouterID := make(map[string]string, len(nodes))
		for _, n := range nodes {
			nid := n.ID.String()
			var details networkDetails
			_ = json.Unmarshal(n.Details, &details)
			nodeByID[nid] = n
			detailsByID[nid] = details
			realGatewayIDs[nid] = n.Type == "router"
			if (n.Type == "server_v2" || n.Type == "vps" || n.Type == "firewall") &&
				(details.NATEnabled || (details.RoutingEnabled && details.DHCPEnabled)) {
				natGatewayIDs[nid] = nid + ":lan"
				natNodeByRouterID[nid+":lan"] = nid
			}
		}

		isUpstreamAnchor := func(id string) bool {
			n, ok := nodeByID[id]
			if !ok {
				return false
			}
			d := detailsByID[id]
			return n.Type == "router" || n.Type == "modem" || d.PublicIP != "" || d.NetworkZone == "wan" || d.NetworkZone == "cloud"
		}

		// 2. Build adjacency from edges (as connection lists per node). NAT-capable
		// gateway nodes only traverse LAN/downstream edges, so a NAT boundary creates
		// a real downstream allocation island instead of one flattened subnet.
		adj := make(map[string][]string, len(nodes))

		// Map: nodeID -> neighborID -> port index
		edgePorts := make(map[string]map[string]int, len(nodes))

		addConnection := func(src, tgt string, port int) {
			adj[src] = append(adj[src], tgt)
			if edgePorts[src] == nil {
				edgePorts[src] = make(map[string]int)
			}
			edgePorts[src][tgt] = port
		}
		isAutoLANPort := func(handle string, isSourceEndpoint bool) bool {
			if handle == "" {
				return isSourceEndpoint
			}
			return handle != "target-0"
		}

		for _, e := range edges {
			if e.Type == "vpn" {
				continue
			}
			src := e.SourceNodeID.String()
			tgt := e.TargetNodeID.String()
			direction := e.Direction
			if direction == "" {
				direction = "auto"
			}

			if natRouterID, ok := natGatewayIDs[src]; ok {
				natHandle := e.SourceHandle
				downstream := direction == "lan" ||
					(direction == "auto" && isAutoLANPort(natHandle, true) && !isUpstreamAnchor(tgt))
				if downstream {
					addConnection(natRouterID, tgt, extractPort(e.SourceHandle))
					addConnection(tgt, natRouterID, extractPort(e.TargetHandle))
				} else {
					addConnection(src, tgt, extractPort(e.SourceHandle))
					addConnection(tgt, src, extractPort(e.TargetHandle))
				}
				continue
			}

			if natRouterID, ok := natGatewayIDs[tgt]; ok {
				natHandle := e.TargetHandle
				downstream := direction == "lan" ||
					(direction == "auto" && isAutoLANPort(natHandle, false) && !isUpstreamAnchor(src))
				if downstream {
					addConnection(natRouterID, src, extractPort(e.TargetHandle))
					addConnection(src, natRouterID, extractPort(e.SourceHandle))
				} else {
					addConnection(src, tgt, extractPort(e.SourceHandle))
					addConnection(tgt, src, extractPort(e.TargetHandle))
				}
				continue
			}

			addConnection(src, tgt, extractPort(e.SourceHandle))
			addConnection(tgt, src, extractPort(e.TargetHandle))
		}

		// Sort adj arrays by port index. Note that React Flow edges might be drawn:
		// Switch(ethX) -> Server(target-0) OR Server(eth0) -> Switch(target-0).
		// We want to sort primarily by the port number ON the current node.
		for nodeID, neighbors := range adj {
			sort.Slice(neighbors, func(i, j int) bool {
				p1 := edgePorts[nodeID][neighbors[i]]
				p2 := edgePorts[nodeID][neighbors[j]]
				return p1 < p2
			})
		}

		usedGatewayIPs := make(map[string]bool, len(nodes))
		for _, n := range nodes {
			if n.IP != "" {
				usedGatewayIPs[n.IP] = true
			}
			if details := detailsByID[n.ID.String()]; details.LANGatewayIP != "" {
				usedGatewayIPs[details.LANGatewayIP] = true
			}
		}
		nextNATLAN := func(nid string) (string, string) {
			details := detailsByID[nid]
			if details.LANGatewayIP != "" {
				return details.LANGatewayIP, details.LANSubnet
			}
			for _, neighborID := range adj[nid] {
				if !realGatewayIDs[neighborID] {
					continue
				}
				parent := net.ParseIP(nodeByID[neighborID].IP).To4()
				if parent == nil {
					continue
				}
				for offset := 1; offset < 255; offset++ {
					third := (int(parent[2]) + offset) % 255
					if third == 0 {
						third = 1
					}
					gateway := fmt.Sprintf("%d.%d.%d.1", parent[0], parent[1], third)
					if !usedGatewayIPs[gateway] {
						usedGatewayIPs[gateway] = true
						return gateway, gateway + "/24"
					}
				}
			}
			return "", ""
		}

		// 3. Build hlbIPAM request
		req := ipamRequest{
			Routers: make([]ipamRouter, 0),
			Nodes:   make([]ipamNode, 0, len(nodes)),
		}

		for _, n := range nodes {
			nid := n.ID.String()
			details := detailsByID[nid]
			if !realGatewayIDs[nid] {
				continue
			}

			subnet := ""
			if n.IP != "" && details.SubnetMask != "" {
				subnet = n.IP + "/" + details.SubnetMask // IPAM can parse IP and Mask
			}

			req.Routers = append(req.Routers, ipamRouter{
				ID:          nid,
				GatewayIP:   n.IP,
				Subnet:      subnet,
				DHCPEnabled: details.DHCPEnabled,
			})
		}

		for _, n := range nodes {
			nid := n.ID.String()
			details := detailsByID[nid]
			natRouterID, ok := natGatewayIDs[nid]
			if !ok {
				continue
			}
			lanGateway, lanSubnet := nextNATLAN(nid)
			if lanSubnet == "" && lanGateway != "" {
				lanSubnet = lanGateway + "/24"
			}

			req.Routers = append(req.Routers, ipamRouter{
				ID:          natRouterID,
				GatewayIP:   lanGateway,
				Subnet:      lanSubnet,
				DHCPEnabled: details.DHCPEnabled || details.NATEnabled,
			})
		}

		for _, n := range nodes {
			nid := n.ID.String()
			details := detailsByID[nid]
			vms := make([]ipamVM, 0, len(n.VirtualMachines))
			for _, vm := range n.VirtualMachines {
				vms = append(vms, ipamVM{
					ID:         vm.ID.String(),
					ExistingIP: vm.IP,
				})
			}

			existingIP := ""

			// Extract DHCPLocked from node details
			if nonNetworkTypes[n.Type] {
				// Don't send existing IP for non-network types
			} else if realGatewayIDs[nid] {
				existingIP = n.IP // preserve gateway IPs as existing
			} else if details.DHCPLocked {
				preserveLocked := true
				if _, isNATGateway := natGatewayIDs[nid]; isNATGateway {
					preserveLocked = false
					for _, neighborID := range adj[nid] {
						if realGatewayIDs[neighborID] &&
							ipInGatewaySubnet(n.IP, nodeByID[neighborID].IP, detailsByID[neighborID].SubnetMask) {
							preserveLocked = true
							break
						}
					}
				}
				if preserveLocked {
					existingIP = n.IP // preserve locked static IPs
				}
			}

			req.Nodes = append(req.Nodes, ipamNode{
				ID:          nid,
				Type:        n.Type,
				Connections: adj[nid],
				ExistingIP:  existingIP,
				VMs:         vms,
			})
		}

		// 4. Call hlbIPAM
		result, err := s.callIPAM(req)
		if err != nil {
			return fmt.Errorf("hlbIPAM call failed: %w", err)
		}

		// 5. Build a lookup from hlbIPAM results
		ipByID := make(map[string]string, len(result.Nodes))
		vmIPByID := make(map[string]string)
		for _, nr := range result.Nodes {
			if nr.AssignedIP != "" {
				ipByID[nr.ID] = nr.AssignedIP
			}
			for _, vmr := range nr.VMs {
				if vmr.AssignedIP != "" {
					vmIPByID[vmr.ID] = vmr.AssignedIP
				}
			}
		}

		// Map router gateway IPs from hlbIPAM response
		routerIPByID := make(map[string]string, len(result.Routers))
		type natInterfaceAllocation struct {
			gatewayIP string
			subnet    string
		}
		natLANByNodeID := make(map[string]natInterfaceAllocation, len(natGatewayIDs))
		for _, rr := range result.Routers {
			if rr.GatewayIP != "" {
				routerIPByID[rr.ID] = rr.GatewayIP
			}
			if nodeID, ok := natNodeByRouterID[rr.ID]; ok {
				natLANByNodeID[nodeID] = natInterfaceAllocation{
					gatewayIP: rr.GatewayIP,
					subnet:    rr.Subnet,
				}
			}
		}

		// 6. Persist assigned IPs
		for i := range nodes {
			nid := nodes[i].ID.String()
			if ip, ok := ipByID[nid]; ok {
				nodes[i].IP = ip
			} else if !nonNetworkTypes[nodes[i].Type] && !realGatewayIDs[nid] && !detailsByID[nid].DHCPLocked {
				nodes[i].IP = ""
			}
			// Also update router gateway IPs from hlbIPAM
			if ip, ok := routerIPByID[nid]; ok {
				nodes[i].IP = ip
			}
			if _, isNatCapable := natGatewayIDs[nid]; isNatCapable || nodes[i].Type == "server_v2" || nodes[i].Type == "vps" {
				var details map[string]any
				if len(nodes[i].Details) > 0 {
					_ = json.Unmarshal(nodes[i].Details, &details)
				}
				if details == nil {
					details = make(map[string]any)
				}

				if lan, ok := natLANByNodeID[nid]; ok && lan.gatewayIP != "" {
					dhcpEnabled := detailsByID[nid].DHCPEnabled || detailsByID[nid].NATEnabled
					details["wan_ip"] = nodes[i].IP
					details["lan_gateway_ip"] = lan.gatewayIP
					details["lan_subnet"] = lan.subnet

					interfaces := make([]map[string]any, 0, 3)
					if existing, ok := details["interfaces"].([]any); ok {
						for _, item := range existing {
							if iface, ok := item.(map[string]any); ok {
								role, _ := iface["role"].(string)
								if role != "wan" && role != "lan" {
									interfaces = append(interfaces, iface)
								}
							}
						}
					}
					interfaces = append(interfaces,
						map[string]any{
							"name": "WAN",
							"role": "wan",
							"ip":   nodes[i].IP,
						},
						map[string]any{
							"name":         "LAN",
							"role":         "lan",
							"ip":           lan.gatewayIP,
							"subnet":       lan.subnet,
							"dhcp_enabled": dhcpEnabled,
						},
					)
					details["interfaces"] = interfaces
				} else {
					delete(details, "wan_ip")
					delete(details, "lan_gateway_ip")
					delete(details, "lan_subnet")
					delete(details, "interfaces")
				}

				updatedDetails, err := json.Marshal(details)
				if err != nil {
					return fmt.Errorf("marshal node details: %w", err)
				}
				nodes[i].Details = updatedDetails
			}
			for j := range nodes[i].VirtualMachines {
				vmid := nodes[i].VirtualMachines[j].ID.String()
				if ip, ok := vmIPByID[vmid]; ok {
					nodes[i].VirtualMachines[j].IP = ip
				}
			}

			if err := tx.Save(&nodes[i]).Error; err != nil {
				return err
			}
			for j := range nodes[i].VirtualMachines {
				if err := tx.Save(&nodes[i].VirtualMachines[j]).Error; err != nil {
					return err
				}
			}
		}

		return nil
	})
}

// callIPAM sends a topology to the hlbIPAM /allocate endpoint and returns the result.
func (s *IPService) callIPAM(req ipamRequest) (*ipamResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := s.ipamURL + "/api/v1/allocate"
	log.Printf("Calling hlbIPAM at %s (%d routers, %d nodes)", url, len(req.Routers), len(req.Nodes))

	resp, err := s.client.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("POST %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("hlbIPAM returned %d: %s", resp.StatusCode, string(errBody))
	}

	var result ipamResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &result, nil
}

// ValidateNetwork sends the current topology to the hlbIPAM validate endpoint
// and returns the raw validation response directly to the caller.
func (s *IPService) ValidateNetwork(buildID uuid.UUID) (json.RawMessage, error) {
	var nodes []models.Node
	if err := s.db.Preload("VirtualMachines").Where("build_id = ?", buildID).Find(&nodes).Error; err != nil {
		return nil, err
	}

	var edges []models.Edge
	if err := s.db.Where("build_id = ?", buildID).Find(&edges).Error; err != nil {
		return nil, err
	}

	type validateDetails struct {
		DHCPEnabled    bool   `json:"dhcp_enabled"`
		DHCPLocked     bool   `json:"dhcp_locked"`
		SubnetMask     string `json:"subnet_mask"`
		NATEnabled     bool   `json:"nat_enabled"`
		RoutingEnabled bool   `json:"routing_enabled"`
		NetworkZone    string `json:"network_zone"`
		PublicIP       string `json:"public_ip"`
		LANGatewayIP   string `json:"lan_gateway_ip"`
		LANSubnet      string `json:"lan_subnet"`
	}
	nodeByID := make(map[string]models.Node, len(nodes))
	detailsByID := make(map[string]validateDetails, len(nodes))
	natGatewayIDs := make(map[string]string, len(nodes))
	for _, n := range nodes {
		nid := n.ID.String()
		var details validateDetails
		_ = json.Unmarshal(n.Details, &details)
		nodeByID[nid] = n
		detailsByID[nid] = details
		if (n.Type == "server_v2" || n.Type == "vps" || n.Type == "firewall") &&
			(details.NATEnabled || (details.RoutingEnabled && details.DHCPEnabled)) {
			natGatewayIDs[nid] = nid + ":lan"
		}
	}

	isUpstreamAnchor := func(id string) bool {
		n, ok := nodeByID[id]
		if !ok {
			return false
		}
		d := detailsByID[id]
		return n.Type == "router" || n.Type == "modem" || d.PublicIP != "" || d.NetworkZone == "wan" || d.NetworkZone == "cloud"
	}

	adj := make(map[string][]string, len(nodes))
	addConnection := func(src, tgt string) {
		adj[src] = append(adj[src], tgt)
	}
	isAutoLANPort := func(handle string, isSourceEndpoint bool) bool {
		if handle == "" {
			return isSourceEndpoint
		}
		return handle != "target-0"
	}
	for _, e := range edges {
		if e.Type == "vpn" {
			continue
		}
		src := e.SourceNodeID.String()
		tgt := e.TargetNodeID.String()
		direction := e.Direction
		if direction == "" {
			direction = "auto"
		}

		if natRouterID, ok := natGatewayIDs[src]; ok {
			natHandle := e.SourceHandle
			if direction == "lan" || (direction == "auto" && isAutoLANPort(natHandle, true) && !isUpstreamAnchor(tgt)) {
				addConnection(natRouterID, tgt)
				addConnection(tgt, natRouterID)
			} else {
				addConnection(src, tgt)
				addConnection(tgt, src)
			}
			continue
		}
		if natRouterID, ok := natGatewayIDs[tgt]; ok {
			natHandle := e.TargetHandle
			if direction == "lan" || (direction == "auto" && isAutoLANPort(natHandle, false) && !isUpstreamAnchor(src)) {
				addConnection(natRouterID, src)
				addConnection(src, natRouterID)
			} else {
				addConnection(src, tgt)
				addConnection(tgt, src)
			}
			continue
		}
		addConnection(src, tgt)
		addConnection(tgt, src)
	}

	usedGatewayIPs := make(map[string]bool, len(nodes))
	for _, n := range nodes {
		if n.IP != "" {
			usedGatewayIPs[n.IP] = true
		}
		if details := detailsByID[n.ID.String()]; details.LANGatewayIP != "" {
			usedGatewayIPs[details.LANGatewayIP] = true
		}
	}
	nextNATLAN := func(nid string) (string, string) {
		details := detailsByID[nid]
		if details.LANGatewayIP != "" {
			return details.LANGatewayIP, details.LANSubnet
		}
		for _, neighborID := range adj[nid] {
			if n := nodeByID[neighborID]; n.Type != "router" && n.Type != "firewall" {
				continue
			}
			parent := net.ParseIP(nodeByID[neighborID].IP).To4()
			if parent == nil {
				continue
			}
			for offset := 1; offset < 255; offset++ {
				third := (int(parent[2]) + offset) % 255
				if third == 0 {
					third = 1
				}
				gateway := fmt.Sprintf("%d.%d.%d.1", parent[0], parent[1], third)
				if !usedGatewayIPs[gateway] {
					usedGatewayIPs[gateway] = true
					return gateway, gateway + "/24"
				}
			}
		}
		return "", ""
	}

	req := ipamRequest{
		Routers: make([]ipamRouter, 0),
		Nodes:   make([]ipamNode, 0, len(nodes)),
	}

	for _, n := range nodes {
		nid := n.ID.String()
		details := detailsByID[nid]
		isGateway := n.Type == "router"
		if isGateway {
			subnet := ""
			if n.IP != "" && details.SubnetMask != "" {
				subnet = n.IP + "/" + details.SubnetMask
			}

			req.Routers = append(req.Routers, ipamRouter{
				ID:          nid,
				GatewayIP:   n.IP,
				Subnet:      subnet,
				DHCPEnabled: details.DHCPEnabled,
			})
		}
		if natRouterID, ok := natGatewayIDs[nid]; ok {
			lanGateway, lanSubnet := nextNATLAN(nid)
			if lanSubnet == "" && lanGateway != "" {
				lanSubnet = lanGateway + "/24"
			}
			req.Routers = append(req.Routers, ipamRouter{
				ID:          natRouterID,
				GatewayIP:   lanGateway,
				Subnet:      lanSubnet,
				DHCPEnabled: details.DHCPEnabled || details.NATEnabled,
			})
		}

		vms := make([]ipamVM, 0, len(n.VirtualMachines))
		for _, vm := range n.VirtualMachines {
			vms = append(vms, ipamVM{
				ID:         vm.ID.String(),
				ExistingIP: vm.IP,
			})
		}

		existingIP := ""
		if nonNetworkTypes[n.Type] {
			// non-network devices do not own addresses
		} else if isGateway {
			existingIP = n.IP
		} else if details.DHCPLocked {
			preserveLocked := true
			if _, isNATGateway := natGatewayIDs[nid]; isNATGateway {
				preserveLocked = false
				for _, neighborID := range adj[nid] {
					neighbor := nodeByID[neighborID]
					if neighbor.Type == "router" &&
						ipInGatewaySubnet(n.IP, neighbor.IP, detailsByID[neighborID].SubnetMask) {
						preserveLocked = true
						break
					}
				}
			}
			if preserveLocked {
				existingIP = n.IP
			}
		}

		req.Nodes = append(req.Nodes, ipamNode{
			ID:          nid,
			Type:        n.Type,
			Connections: adj[nid],
			ExistingIP:  existingIP,
			VMs:         vms,
		})
	}

	payload, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal validation payload: %w", err)
	}

	resp, err := s.client.Post(s.ipamURL+"/api/v1/validate", "application/json", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("failed to call hlbIPAM validate: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("ipam service returned %d: %s", resp.StatusCode, string(body))
	}

	rawResp, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read validation response: %w", err)
	}

	return json.RawMessage(rawResp), nil
}

// FallbackCalculateNetwork is kept as a safety net - if hlbIPAM is unreachable,
// the system can fall back to this inline implementation.
// Currently unused; wire it in if you need offline resilience.
func (s *IPService) FallbackCalculateNetwork(buildID uuid.UUID) error {
	return errors.New("hlbIPAM service unavailable and no fallback configured")
}
