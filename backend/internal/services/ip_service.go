package services

import (
	"bytes"
	"encoding/json"
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
	// DHCPClients is the number of leases this node needs for devices that are
	// not on the canvas: seats at a LAN table, Wi-Fi clients on an access point.
	DHCPClients int `json:"dhcp_clients,omitempty"`
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
	ID          string `json:"id"`
	GatewayIP   string `json:"gateway_ip"`
	Subnet      string `json:"subnet"`
	DHCPStart   string `json:"dhcp_start,omitempty"`
	DHCPEnd     string `json:"dhcp_end,omitempty"`
	DHCPSize    int    `json:"dhcp_size,omitempty"`
	DHCPClients int    `json:"dhcp_clients,omitempty"`
}

// withDHCPPool writes the address pool hlbIPAM carved for a gateway into its
// details, or removes a stale one when the gateway hands out no leases.
func withDHCPPool(raw json.RawMessage, pool *ipamRouterResult) (json.RawMessage, error) {
	details := map[string]any{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &details); err != nil || details == nil {
			return raw, nil // details that are not an object are left alone
		}
	}
	_, had := details["dhcp_pool"]
	// With DHCP off there is no pool, but devices may still expect a lease:
	// that count is kept so the gaming report can say so.
	if pool == nil || (pool.DHCPStart == "" && pool.DHCPClients == 0) {
		if !had {
			return raw, nil
		}
		delete(details, "dhcp_pool")
	} else {
		details["dhcp_pool"] = map[string]any{
			"start":   pool.DHCPStart,
			"end":     pool.DHCPEnd,
			"size":    pool.DHCPSize,
			"clients": pool.DHCPClients,
		}
	}
	return json.Marshal(details)
}

// nodeDHCPClients reads the lease demand of a stored node.
func nodeDHCPClients(node models.Node) int {
	details, _ := detailsMap(node.Details)
	return dhcpClientsOf(node.Type, details)
}

type ipamResponse struct {
	Routers []ipamRouterResult `json:"routers"`
	Nodes   []ipamNodeResult   `json:"nodes"`
}

// ─── Non-network types that don't receive IPs ───────────────────────────────

var nonNetworkTypes = map[string]bool{
	"disk": true, "gpu": true, "hba": true, "pcie": true, "pdu": true, "ups": true, "rack": true,
	// A LAN table has no address of its own: its seats take leases from the pool.
	nodeTypeLANTable: true,
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

// loadTopology reads a build's nodes, guests and edges in the order they were
// saved. hlbIPAM hands out addresses in the order it is given the devices, so
// an unordered read would let two devices of the same type swap addresses
// between saves whenever the database returns the rows differently.
func loadTopology(db *gorm.DB, buildID uuid.UUID) ([]models.Node, []models.Edge, error) {
	var nodes []models.Node
	err := db.
		Preload("VirtualMachines", func(guests *gorm.DB) *gorm.DB { return guests.Order("created_at, id") }).
		Where("build_id = ?", buildID).Order("created_at, id").Find(&nodes).Error
	if err != nil {
		return nil, nil, err
	}
	// Edge ids change on every save; their endpoints do not.
	var edges []models.Edge
	err = db.Where("build_id = ?", buildID).Order("created_at, source_node_id, target_node_id").Find(&edges).Error
	if err != nil {
		return nil, nil, err
	}
	return nodes, edges, nil
}

// networkDetails are the node settings that shape address allocation.
type networkDetails struct {
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

// ipamPlan is the hlbIPAM request for a stored topology, together with the
// lookups CalculateNetwork needs to write the answer back.
type ipamPlan struct {
	request        ipamRequest
	detailsByID    map[string]networkDetails
	realGatewayIDs map[string]bool
	// natGatewayIDs maps a NAT-capable node to the id of the LAN router it
	// opens; natNodeByRouterID is the reverse.
	natGatewayIDs     map[string]string
	natNodeByRouterID map[string]string
}

// handleNumber reads the digits of a handle as one number ("eth10" is 10,
// "target-0" is 0); a handle without digits is 0. Neighbours are ordered by it.
func handleNumber(handle string) int {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, handle)
	index, _ := strconv.Atoi(digits)
	return index
}

// planIPAM builds the request hlbIPAM gets for a topology. Allocation and
// validation send the same request, so a validation reports on exactly what a
// save allocates.
func planIPAM(nodes []models.Node, edges []models.Edge) ipamPlan {
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

	// Adjacency from edges (as connection lists per node). NAT-capable gateway
	// nodes only traverse LAN/downstream edges, so a NAT boundary creates a real
	// downstream allocation island instead of one flattened subnet.
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
		sourcePort, targetPort := handleNumber(e.SourceHandle), handleNumber(e.TargetHandle)

		if natRouterID, ok := natGatewayIDs[src]; ok {
			if direction == "lan" || (direction == "auto" && isAutoLANPort(e.SourceHandle, true) && !isUpstreamAnchor(tgt)) {
				addConnection(natRouterID, tgt, sourcePort)
				addConnection(tgt, natRouterID, targetPort)
			} else {
				addConnection(src, tgt, sourcePort)
				addConnection(tgt, src, targetPort)
			}
			continue
		}

		if natRouterID, ok := natGatewayIDs[tgt]; ok {
			if direction == "lan" || (direction == "auto" && isAutoLANPort(e.TargetHandle, false) && !isUpstreamAnchor(src)) {
				addConnection(natRouterID, src, targetPort)
				addConnection(src, natRouterID, sourcePort)
			} else {
				addConnection(src, tgt, sourcePort)
				addConnection(tgt, src, targetPort)
			}
			continue
		}

		addConnection(src, tgt, sourcePort)
		addConnection(tgt, src, targetPort)
	}

	// Sort adj arrays by port index. Note that React Flow edges might be drawn:
	// Switch(ethX) -> Server(target-0) OR Server(eth0) -> Switch(target-0).
	// We want to sort primarily by the port number ON the current node.
	for nodeID, neighbors := range adj {
		sort.Slice(neighbors, func(i, j int) bool {
			return edgePorts[nodeID][neighbors[i]] < edgePorts[nodeID][neighbors[j]]
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

	req := ipamRequest{
		Routers: make([]ipamRouter, 0),
		Nodes:   make([]ipamNode, 0, len(nodes)),
	}

	for _, n := range nodes {
		nid := n.ID.String()
		if !realGatewayIDs[nid] {
			continue
		}
		details := detailsByID[nid]
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
		natRouterID, ok := natGatewayIDs[nid]
		if !ok {
			continue
		}
		details := detailsByID[nid]
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

		// Gateways and locked static addresses are kept; devices that are not
		// on the network own no address.
		existingIP := ""
		switch {
		case nonNetworkTypes[n.Type]:
		case realGatewayIDs[nid]:
			existingIP = n.IP
		case details.DHCPLocked:
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
				existingIP = n.IP
			}
		}

		req.Nodes = append(req.Nodes, ipamNode{
			ID:          nid,
			Type:        n.Type,
			Connections: adj[nid],
			ExistingIP:  existingIP,
			VMs:         virtualIPAMGuests(n),
			DHCPClients: nodeDHCPClients(n),
		})
	}

	return ipamPlan{
		request:           req,
		detailsByID:       detailsByID,
		realGatewayIDs:    realGatewayIDs,
		natGatewayIDs:     natGatewayIDs,
		natNodeByRouterID: natNodeByRouterID,
	}
}

// ─── Public API ─────────────────────────────────────────────────────────────

// CalculateNetwork loads the build's topology from the DB, sends it to
// hlbIPAM for allocation, and writes the assigned IPs back.
func (s *IPService) CalculateNetwork(buildID uuid.UUID) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		nodes, edges, err := loadTopology(tx, buildID)
		if err != nil {
			return err
		}
		if len(nodes) == 0 {
			return nil
		}

		plan := planIPAM(nodes, edges)
		detailsByID, realGatewayIDs, natGatewayIDs := plan.detailsByID, plan.realGatewayIDs, plan.natGatewayIDs

		result, err := s.callIPAM(plan.request)
		if err != nil {
			return fmt.Errorf("hlbIPAM call failed: %w", err)
		}

		// Index what hlbIPAM assigned
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
		poolByNodeID := make(map[string]ipamRouterResult, len(result.Routers))
		for _, rr := range result.Routers {
			if rr.GatewayIP != "" {
				routerIPByID[rr.ID] = rr.GatewayIP
			}
			if nodeID, ok := plan.natNodeByRouterID[rr.ID]; ok {
				poolByNodeID[nodeID] = rr
				natLANByNodeID[nodeID] = natInterfaceAllocation{
					gatewayIP: rr.GatewayIP,
					subnet:    rr.Subnet,
				}
			} else {
				poolByNodeID[rr.ID] = rr
			}
		}

		// Persist assigned IPs
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
				details, _ := detailsMap(nodes[i].Details)

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
			var pool *ipamRouterResult
			if found, ok := poolByNodeID[nid]; ok {
				pool = &found
			}
			withPool, err := withDHCPPool(nodes[i].Details, pool)
			if err != nil {
				return fmt.Errorf("marshal node details: %w", err)
			}
			nodes[i].Details = withPool
			for j := range nodes[i].VirtualMachines {
				vmid := nodes[i].VirtualMachines[j].ID.String()
				nodes[i].VirtualMachines[j].IP = vmIPByID[vmid]
			}
			network, _ := readVirtualNetwork(nodes[i].Details)
			if network != nil {
				reached := virtualReachable(network)
				for _, vm := range nodes[i].VirtualMachines {
					requested := requestedVMIP(vm)
					if reached[vm.ID.String()] && nodes[i].IP != "" && requested != "" && vm.IP != requested {
						return fmt.Errorf("%w: requested IP %s for %s is unavailable or outside the host subnet", ErrInvalidTopology, requested, vm.Name)
					}
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

// WithDB returns a copy of the service bound to db, usually an open transaction.
func (s *IPService) WithDB(db *gorm.DB) *IPService {
	scoped := *s
	scoped.db = db
	return &scoped
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
	nodes, edges, err := loadTopology(s.db, buildID)
	if err != nil {
		return nil, err
	}

	payload, err := json.Marshal(planIPAM(nodes, edges).request)
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
