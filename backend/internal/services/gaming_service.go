package services

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/gaming"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

// GamingService turns a stored build into the gaming report and the game
// deployment files. The maths lives in the gaming package; this file only
// reads the build.
type GamingService struct {
	builds *BuildService
}

func NewGamingService(builds *BuildService) *GamingService {
	return &GamingService{builds: builds}
}

// Report returns the gaming report of a build the user owns.
func (s *GamingService) Report(buildID, userID uuid.UUID) (*gaming.Report, error) {
	build, err := s.builds.GetOwned(buildID, userID)
	if err != nil {
		return nil, err
	}
	report, err := GamingReportForBuild(build)
	if err != nil {
		return nil, err
	}
	return &report, nil
}

// GamingReportForBuild computes the report for a loaded build. It also works on
// the preview of a proposal, which is how a proposed change is checked.
func GamingReportForBuild(build *models.Build) (gaming.Report, error) {
	input, err := gamingReportInput(build)
	if err != nil {
		return gaming.Report{}, err
	}
	return gaming.ComputeReport(input), nil
}

// guestGame reads the game instance of a guest, if it is a game server.
func guestGame(details map[string]any) *gaming.Instance {
	instance, found, err := gaming.ParseInstance(details[gaming.InstanceKey])
	if !found {
		return nil
	}
	if err != nil {
		// Keep it visible: the report turns an unknown profile into an issue.
		return &gaming.Instance{}
	}
	return &instance
}

func isInternetEdge(node NodeDTO) bool {
	if node.Type == "modem" {
		return true
	}
	if publicIP, _ := node.Details["public_ip"].(string); strings.TrimSpace(publicIP) != "" {
		return true
	}
	zone, _ := node.Details["network_zone"].(string)
	return zone == "wan" || zone == "cloud"
}

func gamingReportInput(build *models.Build) (gaming.ReportInput, error) {
	graph, err := BuildToSyncInput(build)
	if err != nil {
		return gaming.ReportInput{}, err
	}
	plan, err := gaming.ParsePlan(build.GamingPlan)
	if err != nil {
		return gaming.ReportInput{}, err
	}
	kind := gaming.Kind(build.Kind)
	if kind == "" {
		kind = gaming.KindHomelab
	}
	input := gaming.ReportInput{Kind: kind, Revision: build.Revision, Plan: plan}

	// Stored rows carry the calculated addresses; the DTO has the same ids.
	stored := make(map[string]models.Node, len(build.Nodes))
	for _, node := range build.Nodes {
		stored[node.ID.String()] = node
	}
	usage := NodePortUsage(graph)
	types := make(map[string]string, len(graph.Nodes))

	for _, node := range graph.Nodes {
		types[node.ID] = node.Type
		power := node.PowerDraw
		for _, component := range node.InternalComponents {
			power += component.PowerDraw
		}
		entry := gaming.ReportNode{
			ID: node.ID, Name: node.Name, Type: node.Type, IP: node.IP, PowerDraw: power,
			CPUCores:       parseCoreCount(node.Details["cpu"]),
			RAMMB:          int(parseCapacityGB(node.Details["ram"]) * 1024),
			IsRouter:       node.Type == "router",
			IsNATGateway:   isNATGateway(node),
			IsInternetEdge: isInternetEdge(node),
		}
		entry.PublicIP, _ = node.Details["public_ip"].(string)
		entry.Circuit, _ = node.Details["circuit"].(string)

		if node.Type == "switch" || node.Type == "router" {
			entry.IsHub = true
			entry.PortsTotal = usage[node.ID].Total
			entry.PortsUsed = len(usage[node.ID].Used)
		}
		if node.Type == nodeTypeLANTable {
			entry.Seats = tableSeats(node.Details)
			entry.SwitchPorts = tableSwitchPortsFor(entry.Seats)
			if ports, ok := detailInt(node.Details, "switch_ports"); ok {
				entry.SwitchPorts = ports
			}
			entry.SwitchGbps = parseNetworkGbps(node.Details["switch_speed"])
		}
		if node.Type == "access_point" {
			entry.WifiClients = dhcpClientsOf(node.Type, node.Details)
		}

		if entry.IsRouter || entry.IsNATGateway {
			pool := &gaming.DHCPPool{}
			if raw, ok := node.Details["dhcp_pool"].(map[string]any); ok {
				pool.Start, _ = raw["start"].(string)
				pool.End, _ = raw["end"].(string)
				pool.Size, _ = detailInt(raw, "size")
				pool.Clients, _ = detailInt(raw, "clients")
			}
			pool.Enabled = pool.Start != ""
			entry.DHCP = pool
		}

		for _, vm := range node.VMs {
			entry.Guests = append(entry.Guests, gaming.ReportGuest{
				ID: vm.ID, Name: vm.Name, Type: vm.Type, IP: vm.IP,
				CPUCores: vm.CPUCores, RAMMB: vm.RAMMB, Game: guestGame(vm.Details),
			})
		}
		input.Nodes = append(input.Nodes, entry)
	}

	for _, edge := range graph.Edges {
		kind := edge.Type
		switch {
		case isPowerEdge(types[edge.Source], types[edge.Target]):
			kind = gaming.LinkPower
		case kind == "":
			kind = gaming.LinkEthernet
		}
		input.Links = append(input.Links, gaming.ReportLink{A: edge.Source, B: edge.Target, Kind: kind, Gbps: parseNetworkGbps(edge.Speed)})
	}
	return input, nil
}

// ── Deployment files ────────────────────────────────────────────────────────

// GameComposeFile is the compose file for the game servers on one host.
type GameComposeFile struct {
	HostID   string `json:"host_id"`
	Host     string `json:"host"`
	Folder   string `json:"folder"`
	Compose  string `json:"compose"`
	Env      string `json:"env"`
	Services int    `json:"services"`
}

// isGameGuest reports whether a stored guest is a game server or gaming tool.
func isGameGuest(vm models.VirtualMachine) bool {
	details, err := detailsMap(vm.Details)
	if err != nil {
		return false
	}
	return guestGame(details) != nil
}

// GameComposeFiles writes one compose file per host that runs game servers in
// containers. They are separate from the homelab compose file: game servers
// publish their ports on the host instead of joining a shared bridge.
func GameComposeFiles(build *models.Build) []GameComposeFile {
	files := []GameComposeFile{}
	folders := map[string]bool{}
	nodes := append([]models.Node(nil), build.Nodes...)
	sort.SliceStable(nodes, func(i, j int) bool { return nodes[i].Name < nodes[j].Name })

	for _, node := range nodes {
		servers := []gaming.ComposeServer{}
		vms := append([]models.VirtualMachine(nil), node.VirtualMachines...)
		sort.SliceStable(vms, func(i, j int) bool { return vms[i].Name < vms[j].Name })
		for _, vm := range vms {
			if vm.Type != "container" && vm.Type != "lxc" {
				continue
			}
			details, err := detailsMap(vm.Details)
			if err != nil {
				continue
			}
			if instance := guestGame(details); instance != nil {
				servers = append(servers, gaming.ComposeServer{Name: vm.Name, Instance: *instance})
			}
		}
		if len(servers) == 0 {
			continue
		}
		folder := sanitizeExportName(node.Name)
		for n := 2; folders[folder]; n++ {
			folder = fmt.Sprintf("%s-%d", sanitizeExportName(node.Name), n)
		}
		folders[folder] = true
		compose := gaming.BuildHostCompose(node.Name, servers)
		files = append(files, GameComposeFile{
			HostID: node.ID.String(), Host: node.Name, Folder: folder,
			Compose: compose.Compose, Env: compose.EnvExample, Services: len(servers) - len(compose.Skipped),
		})
	}
	return files
}

// ── Export files ────────────────────────────────────────────────────────────

func exportPortForwards(report gaming.Report) []byte {
	rows := [][]string{{"hop", "router", "server", "port", "protocol", "external_port", "forward_to_ip", "forward_to_port"}}
	for _, forward := range report.PortForwards {
		rows = append(rows, []string{
			strconv.Itoa(forward.Hop), forward.RouterName, forward.Server, forward.PortName, strings.ToUpper(forward.Proto),
			strconv.Itoa(forward.ExternalPort), forward.TargetIP, strconv.Itoa(forward.TargetPort),
		})
	}
	var buffer bytes.Buffer
	writer := csv.NewWriter(&buffer)
	_ = writer.WriteAll(rows)
	return buffer.Bytes()
}

var exposureLabels = map[string]string{
	gaming.ExposureLAN:         "LAN only",
	gaming.ExposurePortForward: "Port forward",
	gaming.ExposureVPN:         "VPN",
	gaming.ExposureRelay:       "Relay",
}

func writeIssues(output *strings.Builder, issues []gaming.Issue) {
	if len(issues) == 0 {
		output.WriteString("Nothing to fix.\n")
		return
	}
	for _, issue := range issues {
		fmt.Fprintf(output, "- **%s** %s", strings.ToUpper(issue.Severity), issue.Message)
		if issue.Fix != "" {
			fmt.Fprintf(output, " %s", issue.Fix)
		}
		output.WriteString("\n")
	}
}

// exportConnectSheet is the page to send to the people who will play.
func exportConnectSheet(build models.Build, report gaming.Report) string {
	var output strings.Builder
	fmt.Fprintf(&output, "# How to join - %s\n\n", build.Name)
	output.WriteString("Send this page to your players. Passwords are not included: share them separately.\n\n")
	for _, server := range report.Servers {
		if server.Role != gaming.RoleGame {
			continue
		}
		fmt.Fprintf(&output, "## %s\n\n", server.Name)
		fmt.Fprintf(&output, "- Game: %s\n", strings.TrimSuffix(server.Game, " Server"))
		fmt.Fprintf(&output, "- Address: `%s`\n", server.Address)
		fmt.Fprintf(&output, "- Reachable: %s\n", exposureLabels[server.Exposure])
		fmt.Fprintf(&output, "- Room for: %d players\n", server.Players)
		switch server.Exposure {
		case gaming.ExposureVPN:
			output.WriteString("- Connect to the VPN first, then use the address above.\n")
		case gaming.ExposureLAN:
			output.WriteString("- You must be on the same network as the server.\n")
		}
		output.WriteString("\n")
	}
	voice := false
	for _, server := range report.Servers {
		if server.Role == gaming.RoleTool && (server.Profile == "mumble" || server.Profile == "teamspeak") {
			if !voice {
				output.WriteString("## Voice chat\n\n")
				voice = true
			}
			fmt.Fprintf(&output, "- %s: `%s`\n", server.Name, server.Address)
		}
	}
	return output.String()
}

// exportPartyPlan is the sheet for whoever sets up the room.
func exportPartyPlan(build models.Build, report gaming.Report) string {
	party := report.Party
	var output strings.Builder
	fmt.Fprintf(&output, "# LAN party plan - %s\n\n", build.Name)
	fmt.Fprintf(&output, "- Seats: %d\n", party.Seats)
	if party.WifiPlayers > 0 {
		fmt.Fprintf(&output, "- Players on Wi-Fi only: %d\n", party.WifiPlayers)
	}
	if party.WifiClients > 0 {
		fmt.Fprintf(&output, "- Other Wi-Fi devices expected: %d\n", party.WifiClients)
	}
	fmt.Fprintf(&output, "- Total power: %d W\n", int(party.TotalWatts))
	if party.EnergyKWh > 0 {
		fmt.Fprintf(&output, "- Energy for the event: %.1f kWh\n", party.EnergyKWh)
	}

	if len(party.Tables) > 0 {
		output.WriteString("\n## Tables\n\n| Table | Seats | Table switch | Uplink | Power | Circuit |\n|---|---|---|---|---|---|\n")
		for _, table := range party.Tables {
			uplink := "not plugged in"
			if table.UplinkTo != "" {
				uplink = table.UplinkTo
			}
			circuit := table.Circuit
			if circuit == "" {
				circuit = "-"
			}
			fmt.Fprintf(&output, "| %s | %d | %d ports | %s | %d W | %s |\n", table.Name, table.Seats, table.SwitchPorts, uplink, int(table.Watts), circuit)
		}
	}
	if len(party.DHCP) > 0 {
		output.WriteString("\n## Addresses\n\n")
		for _, pool := range party.DHCP {
			if !pool.Enabled {
				fmt.Fprintf(&output, "- %s: DHCP is off, %d devices expect an address\n", pool.RouterName, pool.Needed)
				continue
			}
			fmt.Fprintf(&output, "- %s hands out %s to %s (%d addresses) for %d expected devices\n", pool.RouterName, pool.Start, pool.End, pool.Size, pool.Needed)
		}
	}
	if len(party.Switches) > 0 {
		output.WriteString("\n## Switch ports\n\n| Device | Ports | Used | Free |\n|---|---|---|---|\n")
		for _, hub := range party.Switches {
			fmt.Fprintf(&output, "| %s | %d | %d | %d |\n", hub.Name, hub.Total, hub.Used, hub.Free)
		}
	}
	if len(party.Circuits) > 0 {
		output.WriteString("\n## Power circuits\n\n| Circuit | Breaker | Load | Safe for hours | Used |\n|---|---|---|---|---|\n")
		for _, circuit := range party.Circuits {
			name := circuit.Label
			if name == "" {
				name = circuit.ID
			}
			fmt.Fprintf(&output, "| %s | %g A | %d W | %d W | %.0f%% |\n", name, circuit.BreakerAmps, int(circuit.Watts), int(circuit.ContinuousWatts), circuit.UsedPct)
		}
	}
	output.WriteString("\n## To fix before the event\n\n")
	writeIssues(&output, report.Issues)
	return output.String()
}

// gamingExportFiles returns the files a gaming build adds to the export bundle.
// A homelab without game servers adds nothing.
func gamingExportFiles(build models.Build) (map[string][]byte, error) {
	files := map[string][]byte{}
	report, err := GamingReportForBuild(&build)
	if err != nil {
		return nil, err
	}
	if len(report.PortForwards) > 0 {
		files["gaming/port-forwards.csv"] = exportPortForwards(report)
	}
	if len(report.Servers) > 0 {
		files["gaming/connect-sheet.md"] = []byte(exportConnectSheet(build, report))
	}
	if report.Party != nil {
		files["gaming/party-plan.md"] = []byte(exportPartyPlan(build, report))
	}
	for _, file := range GameComposeFiles(&build) {
		files["gaming/"+file.Folder+"/docker-compose.yml"] = []byte(file.Compose)
		files["gaming/"+file.Folder+"/.env.example"] = []byte(file.Env)
	}
	return files, nil
}
