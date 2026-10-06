package gaming

import (
	"sort"
)

// The gaming report answers the questions a plan has to settle before anyone
// buys or wires anything. It is computed from a flat description of the build,
// so the same code serves the web UI, the export bundle, the assistant and the
// preview of a proposed change.

const (
	SeverityError   = "error"
	SeverityWarning = "warning"
	SeverityInfo    = "info"

	StatusOK      = "ok"
	StatusWarning = "warning"
	StatusError   = "error"

	// continuousLoadShare is how much of a breaker's rating a load that runs for
	// hours should use.
	continuousLoadShare = 0.8
)

// ReportInput is everything the report needs to know about a build.
type ReportInput struct {
	Kind     Kind
	Revision uint64
	Plan     Plan
	Nodes    []ReportNode
	Links    []ReportLink
}

// ReportNode is one device on the canvas.
type ReportNode struct {
	ID   string
	Name string
	Type string
	IP   string
	// PowerDraw includes the node's internal components.
	PowerDraw float64
	// CPUCores and RAMMB are the node's capacity; zero when not filled in.
	CPUCores float64
	RAMMB    int

	// IsHub marks devices that other devices plug into: switches and routers.
	IsHub      bool
	PortsTotal int
	PortsUsed  int

	IsRouter       bool
	IsNATGateway   bool
	IsInternetEdge bool
	PublicIP       string
	// DHCP is set on gateways that IPAM calculated a subnet for.
	DHCP *DHCPPool

	// LAN table fields.
	Seats       int
	SwitchPorts int
	SwitchGbps  float64

	WifiClients int
	Circuit     string
	Guests      []ReportGuest
}

// DHCPPool is the lease pool of one gateway.
type DHCPPool struct {
	Enabled bool
	Start   string
	End     string
	Size    int
	Clients int
}

// ReportGuest is a VM, container or LXC on a host.
type ReportGuest struct {
	ID       string
	Name     string
	Type     string
	IP       string
	CPUCores float64
	RAMMB    int
	Game     *Instance
}

// ReportLink is one connection between two nodes.
type ReportLink struct {
	A, B string
	// Kind is ethernet, wireless, vpn or power.
	Kind string
	Gbps float64
}

const (
	LinkEthernet = "ethernet"
	LinkWireless = "wireless"
	LinkVPN      = "vpn"
	LinkPower    = "power"
)

// Report is the result shown to the owner.
type Report struct {
	Kind         Kind           `json:"kind"`
	Revision     uint64         `json:"revision"`
	Status       string         `json:"status"`
	Servers      []ServerReport `json:"servers"`
	PortForwards []PortForward  `json:"port_forwards"`
	Uplink       *UplinkReport  `json:"uplink,omitempty"`
	Party        *PartyReport   `json:"party,omitempty"`
	Issues       []Issue        `json:"issues"`
}

// Issue is one finding. Code is stable so clients can key on it.
type Issue struct {
	Code     string `json:"code"`
	Severity string `json:"severity"`
	NodeID   string `json:"node_id,omitempty"`
	VMID     string `json:"vm_id,omitempty"`
	Message  string `json:"message"`
	Fix      string `json:"fix,omitempty"`
}

// ServerReport describes one game server or gaming tool.
type ServerReport struct {
	VMID     string `json:"vm_id"`
	Name     string `json:"name"`
	Profile  string `json:"profile"`
	Game     string `json:"game"`
	Role     string `json:"role"`
	HostID   string `json:"host_id"`
	HostName string `json:"host_name"`
	Players  int    `json:"players"`
	Exposure string `json:"exposure"`
	Needed   Sizing `json:"needed"`
	// Allocated is what the guest is given on the canvas; zero means not set.
	AllocatedCPU   float64        `json:"allocated_cpu"`
	AllocatedRAMMB int            `json:"allocated_ram_mb"`
	Ports          []ResolvedPort `json:"ports"`
	// TargetIP is where the server listens inside the network.
	TargetIP string `json:"target_ip"`
	// Address is what a player types to join.
	Address string `json:"address"`
}

// PortForward is one rule to add on a router.
type PortForward struct {
	RouterID     string `json:"router_id"`
	RouterName   string `json:"router_name"`
	VMID         string `json:"vm_id"`
	Server       string `json:"server"`
	PortName     string `json:"port_name"`
	Proto        string `json:"proto"`
	ExternalPort int    `json:"external_port"`
	TargetIP     string `json:"target_ip"`
	TargetPort   int    `json:"target_port"`
	// Hop is 1 on the router facing the internet and counts inwards.
	Hop int `json:"hop"`
}

// UplinkReport compares what remote players pull with the upload on the plan.
type UplinkReport struct {
	UpMbps       float64 `json:"up_mbps"`
	DownMbps     float64 `json:"down_mbps"`
	NeededUpMbps float64 `json:"needed_up_mbps"`
	UsedPct      float64 `json:"used_pct"`
	CGNAT        string  `json:"cgnat"`
}

// PartyReport is the LAN party side of a plan.
type PartyReport struct {
	Seats       int           `json:"seats"`
	WifiPlayers int           `json:"wifi_players"`
	WifiClients int           `json:"wifi_clients"`
	DHCP        []DHCPCheck   `json:"dhcp"`
	Switches    []SwitchPorts `json:"switches"`
	Tables      []TableReport `json:"tables"`
	Circuits    []CircuitLoad `json:"circuits"`
	TotalWatts  float64       `json:"total_watts"`
	// UnassignedWatts is the draw of devices that name no circuit.
	UnassignedWatts float64 `json:"unassigned_watts"`
	EnergyKWh       float64 `json:"energy_kwh"`
	HasLANCache     bool    `json:"has_lancache"`
}

// DHCPCheck is the lease pool of one gateway against the devices expecting a lease.
type DHCPCheck struct {
	RouterID   string `json:"router_id"`
	RouterName string `json:"router_name"`
	Enabled    bool   `json:"enabled"`
	Start      string `json:"start"`
	End        string `json:"end"`
	Size       int    `json:"size"`
	Needed     int    `json:"needed"`
}

// SwitchPorts is the port budget of one switch or router.
type SwitchPorts struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Total int    `json:"total"`
	Used  int    `json:"used"`
	Free  int    `json:"free"`
}

// TableReport is one LAN table.
type TableReport struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Seats       int     `json:"seats"`
	SwitchPorts int     `json:"switch_ports"`
	UplinkGbps  float64 `json:"uplink_gbps"`
	UplinkTo    string  `json:"uplink_to"`
	Watts       float64 `json:"watts"`
	Circuit     string  `json:"circuit"`
}

// CircuitLoad is the load on one breaker.
type CircuitLoad struct {
	ID          string  `json:"id"`
	Label       string  `json:"label"`
	BreakerAmps float64 `json:"breaker_amps"`
	Watts       float64 `json:"watts"`
	// CapacityWatts is what the breaker carries; ContinuousWatts is 80% of it.
	CapacityWatts   float64 `json:"capacity_watts"`
	ContinuousWatts float64 `json:"continuous_watts"`
	UsedPct         float64 `json:"used_pct"`
}

// reportBuilder collects the result while the checks run.
type reportBuilder struct {
	input  ReportInput
	nodes  map[string]*ReportNode
	graph  map[string][]string
	report Report
}

// ComputeReport runs every check that applies to the build's kind. Game
// servers are checked in any build that has one; the party checks run for LAN
// party builds and for any build with a LAN table.
func ComputeReport(input ReportInput) Report {
	b := &reportBuilder{
		input: input,
		nodes: make(map[string]*ReportNode, len(input.Nodes)),
		graph: make(map[string][]string, len(input.Nodes)),
		report: Report{
			Kind:         input.Kind,
			Revision:     input.Revision,
			Servers:      []ServerReport{},
			PortForwards: []PortForward{},
			Issues:       []Issue{},
		},
	}
	if b.report.Kind == "" {
		b.report.Kind = KindHomelab
	}
	for i := range input.Nodes {
		b.nodes[input.Nodes[i].ID] = &input.Nodes[i]
	}
	// Physical reachability: power feeds and VPN overlays are not a path.
	for _, link := range input.Links {
		if link.Kind == LinkPower || link.Kind == LinkVPN {
			continue
		}
		b.graph[link.A] = append(b.graph[link.A], link.B)
		b.graph[link.B] = append(b.graph[link.B], link.A)
	}

	b.checkServers()
	if b.report.Kind == KindLANParty || b.hasTables() {
		b.checkParty()
	}

	sort.SliceStable(b.report.Issues, func(i, j int) bool {
		return severityRank(b.report.Issues[i].Severity) < severityRank(b.report.Issues[j].Severity)
	})
	b.report.Status = StatusOK
	for _, issue := range b.report.Issues {
		if issue.Severity == SeverityError {
			b.report.Status = StatusError
			break
		}
		if issue.Severity == SeverityWarning {
			b.report.Status = StatusWarning
		}
	}
	return b.report
}

func severityRank(severity string) int {
	switch severity {
	case SeverityError:
		return 0
	case SeverityWarning:
		return 1
	}
	return 2
}

func (b *reportBuilder) add(issue Issue) {
	b.report.Issues = append(b.report.Issues, issue)
}

func (b *reportBuilder) hasTables() bool {
	for _, node := range b.input.Nodes {
		if node.Type == "lan_table" {
			return true
		}
	}
	return false
}

// pathTo is the shortest physical path from a node to the nearest node that
// matches, both ends included. It is nil when there is none.
func (b *reportBuilder) pathTo(from string, match func(*ReportNode) bool) []string {
	previous := map[string]string{from: ""}
	queue := []string{from}
	for i := 0; i < len(queue); i++ {
		current := queue[i]
		if node := b.nodes[current]; node != nil && current != from && match(node) {
			path := []string{}
			for id := current; id != ""; id = previous[id] {
				path = append(path, id)
			}
			for l, r := 0, len(path)-1; l < r; l, r = l+1, r-1 {
				path[l], path[r] = path[r], path[l]
			}
			return path
		}
		neighbors := append([]string(nil), b.graph[current]...)
		sort.Strings(neighbors) // the same build always gives the same path
		for _, next := range neighbors {
			if _, seen := previous[next]; !seen {
				previous[next] = current
				queue = append(queue, next)
			}
		}
	}
	return nil
}

func round1(value float64) float64 {
	return float64(int(value*10+0.5)) / 10
}
