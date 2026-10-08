package gaming

import (
	"fmt"
	"math"
	"sort"
)

// seatTypes are devices that are one player's seat when drawn on their own.
var seatTypes = map[string]bool{"pc": true, "console": true}

// lanCacheSeats is the party size from which a download cache pays off.
const lanCacheSeats = 8

func (b *reportBuilder) checkParty() {
	party := &PartyReport{
		DHCP: []DHCPCheck{}, Switches: []SwitchPorts{}, Tables: []TableReport{}, Circuits: []CircuitLoad{},
	}
	b.report.Party = party

	// Which links each node has, by kind.
	type linkInfo struct {
		wired, wireless int
		peer            string
		gbps            float64
	}
	links := map[string]*linkInfo{}
	info := func(id string) *linkInfo {
		if links[id] == nil {
			links[id] = &linkInfo{}
		}
		return links[id]
	}
	for _, link := range b.input.Links {
		if link.Kind == LinkPower || link.Kind == LinkVPN {
			continue
		}
		for _, end := range [][2]string{{link.A, link.B}, {link.B, link.A}} {
			entry := info(end[0])
			if link.Kind == LinkWireless {
				entry.wireless++
			} else {
				entry.wired++
				entry.peer, entry.gbps = end[1], link.Gbps
			}
		}
	}

	unplugged := 0
	for _, node := range b.input.Nodes {
		entry := info(node.ID)
		party.WifiClients += node.WifiClients
		for _, guest := range node.Guests {
			if guest.Game != nil && guest.Game.Profile == "lancache" {
				party.HasLANCache = true
			}
		}

		switch {
		case node.Type == "lan_table":
			party.Seats += node.Seats
			table := TableReport{
				ID: node.ID, Name: node.Name, Seats: node.Seats, SwitchPorts: node.SwitchPorts,
				Watts: node.PowerDraw, Circuit: node.Circuit, UplinkGbps: entry.gbps,
			}
			if peer := b.nodes[entry.peer]; peer != nil {
				table.UplinkTo = peer.Name
			}
			party.Tables = append(party.Tables, table)

			if entry.wired == 0 {
				unplugged++
				b.add(Issue{Code: "table_no_uplink", Severity: SeverityError, NodeID: node.ID,
					Message: fmt.Sprintf("%s is not plugged in: its %d seats have no network.", node.Name, node.Seats),
					Fix:     "Connect the table to a switch or to the router."})
			}
			if node.SwitchPorts < node.Seats+1 {
				b.add(Issue{Code: "table_switch_small", Severity: SeverityError, NodeID: node.ID,
					Message: fmt.Sprintf("%s seats %d players on a %d-port switch; it needs %d ports with the uplink.", node.Name, node.Seats, node.SwitchPorts, node.Seats+1),
					Fix:     "Use a bigger table switch or split the table."})
			}
			if entry.wired > 0 && entry.gbps > 0 {
				switch {
				case entry.gbps < 1:
					b.add(Issue{Code: "table_uplink_slow", Severity: SeverityWarning, NodeID: node.ID,
						Message: fmt.Sprintf("%s shares a %s uplink between %d seats.", node.Name, formatGbps(entry.gbps), node.Seats),
						Fix:     "Use a gigabit link to the table."})
				case node.SwitchGbps > entry.gbps:
					b.add(Issue{Code: "table_uplink_bottleneck", Severity: SeverityInfo, NodeID: node.ID,
						Message: fmt.Sprintf("%s has a %s switch on a %s uplink: traffic between tables is limited by the uplink.", node.Name, formatGbps(node.SwitchGbps), formatGbps(entry.gbps))})
				}
			}
		case seatTypes[node.Type]:
			party.Seats++
			if entry.wired == 0 && entry.wireless > 0 {
				party.WifiPlayers++
			}
			if entry.wired == 0 && entry.wireless == 0 {
				unplugged++
			}
		}

		if node.IsHub && node.PortsTotal > 0 {
			party.Switches = append(party.Switches, SwitchPorts{
				ID: node.ID, Name: node.Name, Total: node.PortsTotal, Used: node.PortsUsed,
				Free: node.PortsTotal - node.PortsUsed,
			})
		}
		if node.DHCP != nil {
			party.DHCP = append(party.DHCP, DHCPCheck{
				RouterID: node.ID, RouterName: node.Name, Enabled: node.DHCP.Enabled,
				Start: node.DHCP.Start, End: node.DHCP.End, Size: node.DHCP.Size, Needed: node.DHCP.Clients,
			})
		}
	}

	// ── Seats and network ────────────────────────────────────────────────────
	if party.Seats == 0 && b.report.Kind == KindLANParty {
		b.add(Issue{Code: "no_seats", Severity: SeverityInfo,
			Message: "This plan has no seats yet.",
			Fix:     "Add LAN tables, or single PCs and consoles, from the toolbox."})
	}
	if len(party.DHCP) == 0 && party.Seats > 0 {
		b.add(Issue{Code: "no_router", Severity: SeverityError,
			Message: "There is no router on the plan, so nobody gets an address.",
			Fix:     "Add a router and connect the switches to it."})
	}
	for _, pool := range party.DHCP {
		switch {
		case pool.Needed > 0 && !pool.Enabled:
			b.add(Issue{Code: "dhcp_off", Severity: SeverityError, NodeID: pool.RouterID,
				Message: fmt.Sprintf("%d devices expect an address from %s, but DHCP is off there.", pool.Needed, pool.RouterName),
				Fix:     "Turn DHCP on for that router."})
		case pool.Needed > pool.Size:
			b.add(Issue{Code: "dhcp_pool_short", Severity: SeverityError, NodeID: pool.RouterID,
				Message: fmt.Sprintf("%s can hand out %d addresses, but %d devices expect one.", pool.RouterName, pool.Size, pool.Needed),
				Fix:     "Set the router's subnet mask to 255.255.254.0 for about 500 addresses."})
		}
	}
	free := 0
	for _, hub := range party.Switches {
		free += hub.Free
	}
	if unplugged > 0 && unplugged > free {
		b.add(Issue{Code: "switch_ports_short", Severity: SeverityWarning,
			Message: fmt.Sprintf("%d tables or seats are not plugged in and only %d switch ports are free.", unplugged, free),
			Fix:     "Add a switch, or raise the port count of an existing one."})
	}
	if party.WifiPlayers > 0 {
		b.add(Issue{Code: "wifi_players", Severity: SeverityWarning,
			Message: fmt.Sprintf("%d players are on Wi-Fi only. Latency on Wi-Fi jumps when the room fills up.", party.WifiPlayers),
			Fix:     "Cable them to a table switch where you can."})
	}

	// ── Internet line ────────────────────────────────────────────────────────
	plan := b.input.Plan
	if party.Seats > 0 {
		if plan.Uplink.DownMbps <= 0 {
			b.add(Issue{Code: "download_unknown", Severity: SeverityInfo,
				Message: "The download speed of the venue's line is not filled in.",
				Fix:     "Enter it in the game plan to see how far it goes for everyone."})
		} else if perSeat := plan.Uplink.DownMbps / float64(party.Seats); perSeat < 5 {
			b.add(Issue{Code: "download_per_seat_low", Severity: SeverityWarning,
				Message: fmt.Sprintf("%s Mbps of download shared by %d seats is %s Mbps each.", formatNumber(plan.Uplink.DownMbps), party.Seats, formatNumber(round1(perSeat))),
				Fix:     "Ask players to install and update their games before they arrive."})
		}
		if party.Seats >= lanCacheSeats && !party.HasLANCache {
			b.add(Issue{Code: "lancache_suggested", Severity: SeverityInfo,
				Message: fmt.Sprintf("With %d seats, the same game update is downloaded many times over.", party.Seats),
				Fix:     "Run LANCache on a server so a game is downloaded once and served at LAN speed."})
		}
	}

	// ── Power ────────────────────────────────────────────────────────────────
	loads := map[string]float64{}
	unknown := map[string]bool{}
	for _, node := range b.input.Nodes {
		if node.PowerDraw <= 0 {
			continue
		}
		party.TotalWatts += node.PowerDraw
		if node.Circuit == "" {
			party.UnassignedWatts += node.PowerDraw
			continue
		}
		if _, ok := plan.Circuit(node.Circuit); !ok {
			party.UnassignedWatts += node.PowerDraw
			if !unknown[node.Circuit] {
				unknown[node.Circuit] = true
				b.add(Issue{Code: "circuit_unknown", Severity: SeverityWarning, NodeID: node.ID,
					Message: fmt.Sprintf("%s is on circuit %q, which is not in the game plan.", node.Name, node.Circuit),
					Fix:     "Pick an existing circuit for it, or add that circuit to the plan."})
			}
			continue
		}
		loads[node.Circuit] += node.PowerDraw
	}
	if plan.Event.Hours > 0 {
		party.EnergyKWh = round1(party.TotalWatts * plan.Event.Hours / 1000)
	}

	circuits := append([]Circuit(nil), plan.Power.Circuits...)
	sort.SliceStable(circuits, func(i, j int) bool { return circuits[i].ID < circuits[j].ID })
	if len(circuits) > 0 && plan.Power.MainsVoltage == 0 {
		b.add(Issue{Code: "mains_voltage_missing", Severity: SeverityWarning,
			Message: "The mains voltage is not filled in, so the load on the breakers cannot be checked.",
			Fix:     "Enter 230 or 120 in the game plan."})
	}
	for _, circuit := range circuits {
		load := CircuitLoad{ID: circuit.ID, Label: circuit.Label, BreakerAmps: circuit.BreakerAmps, Watts: loads[circuit.ID]}
		if plan.Power.MainsVoltage > 0 {
			load.CapacityWatts = float64(plan.Power.MainsVoltage) * circuit.BreakerAmps
			load.ContinuousWatts = math.Floor(load.CapacityWatts * continuousLoadShare)
			load.UsedPct = round1(load.Watts / load.CapacityWatts * 100)
			name := circuit.Label
			if name == "" {
				name = "Circuit " + circuit.ID
			}
			switch {
			case load.Watts > load.CapacityWatts:
				b.add(Issue{Code: "circuit_overloaded", Severity: SeverityError,
					Message: fmt.Sprintf("%s carries %d W on a %s A breaker that trips at %d W.", name, int(load.Watts), formatNumber(circuit.BreakerAmps), int(load.CapacityWatts)),
					Fix:     "Move tables to another circuit."})
			case load.Watts > load.ContinuousWatts:
				b.add(Issue{Code: "circuit_over_80", Severity: SeverityWarning,
					Message: fmt.Sprintf("%s carries %d W, over the %d W a %s A breaker should carry for hours.", name, int(load.Watts), int(load.ContinuousWatts), formatNumber(circuit.BreakerAmps)),
					Fix:     "Move something to another circuit to stay under 80% of the breaker."})
			}
		}
		party.Circuits = append(party.Circuits, load)
	}
	switch {
	case party.TotalWatts <= 0:
	case len(circuits) == 0:
		b.add(Issue{Code: "power_no_circuits", Severity: SeverityInfo,
			Message: fmt.Sprintf("The plan draws about %d W in total. No power circuits are filled in.", int(party.TotalWatts)),
			Fix:     "Add the venue's circuits to the game plan and assign tables to them to see whether the breakers hold."})
	case party.UnassignedWatts > 0:
		b.add(Issue{Code: "power_unassigned", Severity: SeverityWarning,
			Message: fmt.Sprintf("%d W of equipment is not assigned to a circuit.", int(party.UnassignedWatts)),
			Fix:     "Pick a circuit for each table and device."})
	}
}

func formatGbps(gbps float64) string {
	if gbps < 1 {
		return fmt.Sprintf("%d Mb", int(gbps*1000+0.5))
	}
	return formatNumber(gbps) + " Gb"
}
