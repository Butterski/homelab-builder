package gaming

import (
	"fmt"
	"math"
	"strings"
)

// natChain lists the devices that translate addresses between a host and the
// internet, outermost first. direct is true when the host itself sits on a
// public address; reachable is false when no path to a router exists.
func (b *reportBuilder) natChain(hostID string) (chain []*ReportNode, direct, reachable bool) {
	host := b.nodes[hostID]
	if host == nil {
		return nil, false, false
	}
	if host.IsInternetEdge {
		return nil, true, true
	}
	path := b.pathTo(hostID, func(node *ReportNode) bool { return node.IsInternetEdge })
	if path == nil {
		// No modem or public address is drawn: the first router is the edge.
		path = b.pathTo(hostID, func(node *ReportNode) bool { return node.IsRouter })
	}
	if path == nil {
		return nil, false, false
	}
	for i := len(path) - 1; i >= 1; i-- {
		if node := b.nodes[path[i]]; node != nil && (node.IsRouter || node.IsNATGateway) {
			chain = append(chain, node)
		}
	}
	return chain, len(chain) == 0, true
}

// primaryPort is the port a player types: the first one that is forwarded.
func primaryPort(ports []ResolvedPort) (ResolvedPort, bool) {
	for _, port := range ports {
		if port.Forward {
			return port, true
		}
	}
	if len(ports) > 0 {
		return ports[0], true
	}
	return ResolvedPort{}, false
}

func withPort(host string, port ResolvedPort, hasPort bool) string {
	if !hasPort || host == "" {
		return host
	}
	return fmt.Sprintf("%s:%d", host, port.Port)
}

func (b *reportBuilder) checkServers() {
	type hostLoad struct {
		cpu float64
		ram int
	}
	loads := map[string]*hostLoad{}
	hostPorts := map[string]string{}   // host|proto|port -> server name
	forwardKeys := map[string]string{} // router|proto|port -> server name
	neededUpKbps := 0
	remoteServers, forwarded, games := 0, 0, 0
	var edgeNames []string

	for _, host := range b.input.Nodes {
		load := &hostLoad{}
		loads[host.ID] = load
		for _, guest := range host.Guests {
			cpu, ram := guest.CPUCores, guest.RAMMB
			if guest.Game == nil {
				load.cpu += cpu
				load.ram += ram
				continue
			}
			instance, profile, err := guest.Game.Normalize()
			if err != nil {
				b.add(Issue{Code: "game_settings_invalid", Severity: SeverityError, NodeID: host.ID, VMID: guest.ID,
					Message: fmt.Sprintf("%s on %s: %v.", guest.Name, host.Name, err),
					Fix:     "Open the service and pick the game again."})
				load.cpu += cpu
				load.ram += ram
				continue
			}
			if profile.Role == RoleGame {
				games++
			}
			needed := SizeServer(profile, instance.Players)
			ports := ResolvePorts(profile, instance.PortOffset)

			// A container publishes its ports on the host; a VM or LXC has its own address.
			targetIP := guest.IP
			if guest.Type == "container" || targetIP == "" {
				targetIP = host.IP
			}

			server := ServerReport{
				VMID: guest.ID, Name: guest.Name, Profile: profile.Slug, Game: profile.Name, Role: profile.Role,
				HostID: host.ID, HostName: host.Name, Players: instance.Players, Exposure: instance.Exposure,
				Needed: needed, AllocatedCPU: cpu, AllocatedRAMMB: ram, Ports: ports, TargetIP: targetIP,
			}

			// The host is loaded with whichever is larger: what was set or what is needed.
			load.cpu += math.Max(cpu, needed.CPUCores)
			if ram > needed.RAMMB {
				load.ram += ram
			} else {
				load.ram += needed.RAMMB
			}

			if profile.MaxPlayers > 0 && instance.Players > profile.MaxPlayers {
				b.add(Issue{Code: "players_above_estimate", Severity: SeverityWarning, NodeID: host.ID, VMID: guest.ID,
					Message: fmt.Sprintf("%s is planned for %d players; the estimate for %s covers up to %d.", guest.Name, instance.Players, profile.Name, profile.MaxPlayers),
					Fix:     "Split the group over two servers, or treat the sizing as a lower bound."})
			}
			if (ram > 0 && ram < needed.RAMMB) || (cpu > 0 && cpu < needed.CPUCores) {
				b.add(Issue{Code: "server_undersized", Severity: SeverityWarning, NodeID: host.ID, VMID: guest.ID,
					Message: fmt.Sprintf("%s has %s and %s cores; %d players need about %s and %s cores.", guest.Name, formatMB(ram), formatNumber(cpu), instance.Players, formatMB(needed.RAMMB), formatNumber(needed.CPUCores)),
					Fix:     "Raise the memory and cores of the service, or lower the player count."})
			}

			if guest.Type == "container" {
				for _, port := range ports {
					key := fmt.Sprintf("%s|%s|%d", host.ID, port.Proto, port.Port)
					if other, taken := hostPorts[key]; taken && other != guest.Name {
						b.add(Issue{Code: "host_port_conflict", Severity: SeverityError, NodeID: host.ID, VMID: guest.ID,
							Message: fmt.Sprintf("%s and %s both listen on %d/%s on %s.", other, guest.Name, port.Port, port.Proto, host.Name),
							Fix:     "Give one of them a port offset."})
						break
					}
					hostPorts[key] = guest.Name
				}
			}

			primary, hasPrimary := primaryPort(ports)
			switch instance.Exposure {
			case ExposureLAN:
				server.Address = withPort(targetIP, primary, hasPrimary)
			case ExposureVPN:
				remoteServers++
				neededUpKbps += needed.UploadKbps
				server.Address = withPort(targetIP, primary, hasPrimary)
				if server.Address != "" {
					server.Address += " (over the VPN)"
				}
			case ExposureRelay:
				remoteServers++
				neededUpKbps += needed.UploadKbps
				server.Address = "the address the relay service gives you"
			case ExposurePortForward:
				remoteServers++
				forwarded++
				neededUpKbps += needed.UploadKbps
				chain, direct, reachable := b.natChain(host.ID)
				publicHost := b.input.Plan.Uplink.PublicHost
				switch {
				case !reachable:
					b.add(Issue{Code: "no_wan_path", Severity: SeverityError, NodeID: host.ID, VMID: guest.ID,
						Message: fmt.Sprintf("%s is set to port forwarding, but %s is not connected to a router.", guest.Name, host.Name),
						Fix:     "Connect the host to your router, directly or through a switch."})
				case direct:
					if publicHost == "" {
						publicHost = host.PublicIP
					}
					b.add(Issue{Code: "public_host_direct", Severity: SeverityInfo, NodeID: host.ID, VMID: guest.ID,
						Message: fmt.Sprintf("%s runs on a host with a public address: no port forward is needed.", guest.Name),
						Fix:     "Open the listed ports in the host's firewall."})
				default:
					if targetIP == "" {
						b.add(Issue{Code: "server_no_address", Severity: SeverityWarning, NodeID: host.ID, VMID: guest.ID,
							Message: fmt.Sprintf("%s has no address yet, so the port forward has no target.", guest.Name),
							Fix:     "Save the build so addresses are assigned."})
					}
					edge := chain[0]
					if publicHost == "" {
						publicHost = edge.PublicIP
					}
					edgeNames = append(edgeNames, edge.Name)
					for _, port := range ports {
						if !port.Forward {
							continue
						}
						key := fmt.Sprintf("%s|%s|%d", edge.ID, port.Proto, port.Port)
						if other, taken := forwardKeys[key]; taken && other != guest.Name {
							b.add(Issue{Code: "port_conflict", Severity: SeverityError, NodeID: host.ID, VMID: guest.ID,
								Message: fmt.Sprintf("%s and %s both need %d/%s forwarded on %s; a router can send a port to one server only.", other, guest.Name, port.Port, port.Proto, edge.Name),
								Fix:     "Give one of them a port offset."})
						}
						forwardKeys[key] = guest.Name
						for hop, router := range chain {
							target := targetIP
							if hop+1 < len(chain) {
								target = chain[hop+1].IP
							}
							b.report.PortForwards = append(b.report.PortForwards, PortForward{
								RouterID: router.ID, RouterName: router.Name, VMID: guest.ID, Server: guest.Name,
								PortName: port.Name, Proto: port.Proto, ExternalPort: port.Port,
								TargetIP: target, TargetPort: port.Port, Hop: hop + 1,
							})
						}
					}
					if len(chain) > 1 {
						names := make([]string, len(chain))
						for i, router := range chain {
							names[i] = router.Name
						}
						b.add(Issue{Code: "double_nat", Severity: SeverityWarning, NodeID: host.ID, VMID: guest.ID,
							Message: fmt.Sprintf("%s sits behind %d address translations (%s); every one of them needs the forward.", guest.Name, len(chain), strings.Join(names, ", ")),
							Fix:     "Put the inner router in bridge or access point mode, or move the host to the outer network."})
					}
				}
				if publicHost == "" {
					publicHost = "your public address"
				}
				server.Address = withPort(publicHost, primary, hasPrimary)
			}
			b.report.Servers = append(b.report.Servers, server)
		}
	}

	// Host capacity, for hosts whose size is filled in.
	for _, host := range b.input.Nodes {
		load := loads[host.ID]
		if load == nil || len(host.Guests) == 0 {
			continue
		}
		if host.RAMMB > 0 {
			switch {
			case load.ram > host.RAMMB:
				b.add(Issue{Code: "host_ram_short", Severity: SeverityError, NodeID: host.ID,
					Message: fmt.Sprintf("%s has %s of memory; what runs on it needs %s.", host.Name, formatMB(host.RAMMB), formatMB(load.ram)),
					Fix:     "Add memory, move a service to another host, or plan for fewer players."})
			case float64(load.ram) > float64(host.RAMMB)*0.85:
				b.add(Issue{Code: "host_ram_tight", Severity: SeverityWarning, NodeID: host.ID,
					Message: fmt.Sprintf("%s would use %s of its %s of memory, leaving little for the system.", host.Name, formatMB(load.ram), formatMB(host.RAMMB))})
			}
		}
		if host.CPUCores > 0 && load.cpu > host.CPUCores {
			b.add(Issue{Code: "host_cpu_short", Severity: SeverityWarning, NodeID: host.ID,
				Message: fmt.Sprintf("%s has %s cores; what runs on it wants %s.", host.Name, formatNumber(host.CPUCores), formatNumber(load.cpu)),
				Fix:     "Servers share cores when they are not all busy at once; plan a faster CPU if they are."})
		}
	}

	if b.report.Kind == KindGameServer && games == 0 {
		b.add(Issue{Code: "no_game_servers", Severity: SeverityInfo,
			Message: "This plan has no game server yet.",
			Fix:     "Drag a game from the Services tab onto a server, PC or mini PC."})
	}

	// The internet line only matters when someone outside connects.
	if remoteServers == 0 {
		return
	}
	plan := b.input.Plan.Uplink
	uplink := &UplinkReport{
		UpMbps: plan.UpMbps, DownMbps: plan.DownMbps, CGNAT: plan.CGNAT,
		NeededUpMbps: round1(float64(neededUpKbps) / 1000),
	}
	b.report.Uplink = uplink
	if plan.UpMbps <= 0 {
		b.add(Issue{Code: "uplink_unknown", Severity: SeverityInfo,
			Message: fmt.Sprintf("Remote players need about %s Mbps of upload. The upload speed of your line is not filled in.", formatNumber(uplink.NeededUpMbps)),
			Fix:     "Enter your upload speed in the game plan."})
	} else {
		uplink.UsedPct = round1(uplink.NeededUpMbps / plan.UpMbps * 100)
		switch {
		case uplink.NeededUpMbps > plan.UpMbps:
			b.add(Issue{Code: "upload_short", Severity: SeverityError,
				Message: fmt.Sprintf("Remote players need about %s Mbps of upload; your line has %s Mbps.", formatNumber(uplink.NeededUpMbps), formatNumber(plan.UpMbps)),
				Fix:     "Plan for fewer remote players, rent a VPS for the server, or get a faster line."})
		case uplink.NeededUpMbps > plan.UpMbps*continuousLoadShare:
			b.add(Issue{Code: "upload_tight", Severity: SeverityWarning,
				Message: fmt.Sprintf("Remote players would use %s of your %s Mbps upload; anything else on the line will cause lag.", formatNumber(uplink.NeededUpMbps), formatNumber(plan.UpMbps))})
		}
	}

	if forwarded == 0 {
		return
	}
	switch plan.CGNAT {
	case "yes":
		b.add(Issue{Code: "cgnat_port_forward", Severity: SeverityError,
			Message: "Your line is behind carrier-grade NAT: a port forward on your router cannot be reached from the internet.",
			Fix:     "Switch the servers to VPN or relay, rent a VPS, or ask your provider for a public IPv4 address."})
	case "":
		edge := "your router"
		if len(edgeNames) > 0 {
			edge = edgeNames[0]
		}
		b.add(Issue{Code: "cgnat_unknown", Severity: SeverityInfo,
			Message: "Port forwarding only works with a public address on your line.",
			Fix:     fmt.Sprintf("Compare the WAN address shown on %s with what a \"what is my IP\" site reports. If they differ you are behind carrier-grade NAT.", edge)})
	}
}

func formatMB(mb int) string {
	if mb >= 1024 {
		return formatNumber(float64(mb)/1024) + " GB"
	}
	return fmt.Sprintf("%d MB", mb)
}

// formatNumber writes a whole number without decimals and anything else with one.
func formatNumber(value float64) string {
	if value == math.Trunc(value) {
		return fmt.Sprintf("%d", int(value))
	}
	return fmt.Sprintf("%.1f", value)
}
