package assistant

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/gaming"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/google/uuid"
)

const maxCreatedBuildsPerDay = 20

func buildTools() []*Tool {
	return []*Tool{
		{
			Name:        "list_builds",
			Title:       "List builds",
			Description: "List the homelab builds this connection can access, newest first. Start here to find a build_id.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`),
			Scope:       ScopeRead,
			ReadOnly:    true,
			handler:     listBuilds,
		},
		{
			Name:  "get_build",
			Title: "Read a build",
			Description: "Read a build's full topology: nodes (with ids, types, addresses, key specs, free ports, rack placement), " +
				"the VMs/containers and internal components on each node, the connections between nodes, total power draw, " +
				"and the status of recent proposals. Call this before proposing changes and again after the user applies or rejects one.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"build_id":{"type":"string","description":"Build id from list_builds."}},"required":["build_id"],"additionalProperties":false}`),
			Scope:       ScopeRead,
			ReadOnly:    true,
			handler:     getBuild,
		},
		{
			Name:  "validate_build",
			Title: "Validate a build's network",
			Description: "Run the IP address manager's checks on the saved build: unreachable devices, address conflicts, " +
				"exhausted subnets, addresses inside a DHCP pool. Returns errors and warnings per node.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"build_id":{"type":"string"}},"required":["build_id"],"additionalProperties":false}`),
			Scope:       ScopeRead,
			ReadOnly:    true,
			handler:     validateBuild,
		},
		{
			Name:  "generate_configs",
			Title: "Generate deployment files",
			Description: "Generate starter deployment files from the saved build: docker-compose.yml, .env, an Ansible inventory and an " +
				"Nginx reverse-proxy config. Secrets are placeholders the user must fill in.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"build_id":{"type":"string"}},"required":["build_id"],"additionalProperties":false}`),
			Scope:       ScopeRead,
			ReadOnly:    true,
			handler:     generateConfigs,
		},
		{
			Name:  "gaming_report",
			Title: "Check a gaming build",
			Description: "Check the saved build as a game server or LAN party plan. For game servers: what each needs for its players, whether the host is " +
				"large enough, the port forwards to add on which router, the upload remote players need, and what blocks them (carrier-grade NAT, " +
				"port conflicts, no path to the internet). For a LAN party: seats against the DHCP pool, free switch ports, table uplinks and " +
				"the load on each power circuit. Every issue has a severity, a message and a fix.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"build_id":{"type":"string"}},"required":["build_id"],"additionalProperties":false}`),
			Scope:       ScopeRead,
			ReadOnly:    true,
			handler:     gamingReport,
		},
		{
			Name:  "create_build",
			Title: "Create an empty build",
			Description: "Create a new, empty build in the user's account and return its id. " +
				"Fill it afterwards with propose_changes; the user still approves that content.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":120,"description":"Name shown in the user's project list."},"kind":{"type":"string","enum":["homelab","lan_party","game_server"],"description":"What the build is planned for. Defaults to homelab."}},"required":["name"],"additionalProperties":false}`),
			Scope:       ScopePropose,
			Contexts:    []string{ContextMCP},
			AccountWide: true,
			handler:     createBuild,
		},
	}
}

type buildListItem struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Kind      string    `json:"kind"`
	Nodes     int       `json:"nodes"`
	Revision  uint64    `json:"revision"`
	UpdatedAt time.Time `json:"updated_at"`
	URL       string    `json:"url"`
}

func listBuilds(_ context.Context, r *Registry, actor Actor, _ json.RawMessage) (*Result, error) {
	builds, err := r.deps.Builds.ListByUser(actor.UserID)
	if err != nil {
		return nil, err
	}
	items := make([]buildListItem, 0, len(builds))
	for _, build := range builds {
		if !actor.CanAccess(build.ID) {
			continue
		}
		items = append(items, buildListItem{
			ID: build.ID, Name: build.Name, Kind: build.Kind, Nodes: len(build.Nodes), Revision: build.Revision,
			UpdatedAt: build.UpdatedAt, URL: reviewURL(actor, build.ID, nil),
		})
	}
	return &Result{Data: map[string]any{"builds": items}}, nil
}

type guestView struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Type           string  `json:"type"`
	Status         string  `json:"status,omitempty"`
	IP             string  `json:"ip,omitempty"`
	StaticIP       string  `json:"static_ip,omitempty"`
	CPUCores       float64 `json:"cpu_cores,omitempty"`
	RAMMB          int     `json:"ram_mb,omitempty"`
	OS             string  `json:"os,omitempty"`
	CatalogService string  `json:"catalog_service,omitempty"`
	// Game is set on game servers: profile, players, exposure and port offset.
	Game *gaming.Instance `json:"game,omitempty"`
}

type componentView struct {
	ID        string         `json:"id"`
	Type      string         `json:"type"`
	Name      string         `json:"name"`
	PowerDraw float64        `json:"power_draw_w,omitempty"`
	Details   map[string]any `json:"details,omitempty"`
}

type nodeView struct {
	ID         string              `json:"id"`
	Type       string              `json:"type"`
	Name       string              `json:"name"`
	IP         string              `json:"ip,omitempty"`
	Rack       string              `json:"rack,omitempty"`
	RackSlot   *int                `json:"rack_slot,omitempty"`
	PowerDraw  float64             `json:"power_draw_w,omitempty"`
	Ports      *services.PortUsage `json:"ports,omitempty"`
	Details    map[string]any      `json:"details,omitempty"`
	VMs        []guestView         `json:"vms,omitempty"`
	Components []componentView     `json:"components,omitempty"`
	// VirtualNetwork is true when the host has a virtual switch layout; guests
	// added through propose_changes are attached to its first virtual switch.
	VirtualNetwork bool `json:"virtual_network,omitempty"`
}

type connectionView struct {
	Source           string `json:"source"`
	SourceName       string `json:"source_name"`
	SourcePort       string `json:"source_port,omitempty"`
	Target           string `json:"target"`
	TargetName       string `json:"target_name"`
	TargetPort       string `json:"target_port,omitempty"`
	Type             string `json:"type"`
	Speed            string `json:"speed,omitempty"`
	Direction        string `json:"direction,omitempty"`
	WirelessStandard string `json:"wireless_standard,omitempty"`
	Subnet           string `json:"subnet,omitempty"`
}

type buildView struct {
	ID          uuid.UUID        `json:"id"`
	Name        string           `json:"name"`
	Kind        string           `json:"kind"`
	GamingPlan  *gaming.Plan     `json:"gaming_plan,omitempty"`
	Revision    uint64           `json:"revision"`
	UpdatedAt   time.Time        `json:"updated_at"`
	TotalPowerW float64          `json:"total_power_w"`
	URL         string           `json:"url"`
	Nodes       []nodeView       `json:"nodes"`
	Connections []connectionView `json:"connections"`
	Proposals   proposalsView    `json:"proposals"`
}

type proposalsView struct {
	Pending *services.ProposalSummary  `json:"pending"`
	Recent  []services.ProposalSummary `json:"recent"`
}

func getBuild(_ context.Context, r *Registry, actor Actor, args json.RawMessage) (*Result, error) {
	var in struct {
		BuildID string `json:"build_id"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	buildID, err := ownedBuildID(actor, in.BuildID)
	if err != nil {
		return nil, err
	}
	build, err := r.deps.Builds.GetOwned(buildID, actor.UserID)
	if err != nil {
		return nil, err
	}
	view, err := describeBuild(build)
	if err != nil {
		return nil, err
	}
	view.URL = reviewURL(actor, build.ID, nil)
	if state, err := r.deps.Proposals.SyncState(buildID, actor.UserID); err == nil {
		view.Proposals = proposalsView{Pending: state.Pending, Recent: state.Recent}
	}
	return &Result{Data: view}, nil
}

// describeBuild renders a build the way an LLM needs it: ids for every entity,
// readable names next to them, and free ports so connections can be planned.
func describeBuild(build *models.Build) (*buildView, error) {
	input, err := services.BuildToSyncInput(build)
	if err != nil {
		return nil, err
	}
	ports := services.NodePortUsage(input)
	names := make(map[string]string, len(input.Nodes))
	for _, node := range input.Nodes {
		names[node.ID] = node.Name
	}

	view := &buildView{
		ID: build.ID, Name: build.Name, Kind: input.Kind, Revision: build.Revision, UpdatedAt: build.UpdatedAt,
		TotalPowerW: build.TotalPower,
		Nodes:       make([]nodeView, 0, len(input.Nodes)),
		Connections: make([]connectionView, 0, len(input.Edges)),
		Proposals:   proposalsView{Recent: []services.ProposalSummary{}},
	}
	// The plan is part of the picture only for builds that use it.
	if gaming.Kind(input.Kind).IsGaming() {
		view.GamingPlan = input.GamingPlan
	}
	for _, node := range input.Nodes {
		entry := nodeView{ID: node.ID, Type: node.Type, Name: node.Name, IP: node.IP, PowerDraw: node.PowerDraw}
		if usage, ok := ports[node.ID]; ok {
			entry.Ports = &usage
		}
		if node.ParentID != nil {
			entry.Rack = *node.ParentID
			if slot, ok := node.Details["rack_position"].(float64); ok {
				value := int(slot)
				entry.RackSlot = &value
			}
		}
		entry.Details = map[string]any{}
		for key, value := range node.Details {
			switch key {
			case "virtual_network":
				entry.VirtualNetwork = true
			case "rack_position":
				// shown as rack_slot
			default:
				entry.Details[key] = value
			}
		}
		if len(entry.Details) == 0 {
			entry.Details = nil
		}
		for _, vm := range node.VMs {
			guest := guestView{
				ID: vm.ID, Name: vm.Name, Type: vm.Type, Status: vm.Status, IP: vm.IP,
				CPUCores: vm.CPUCores, RAMMB: vm.RAMMB, OS: vm.OS,
			}
			guest.StaticIP, _ = vm.Details["static_ip"].(string)
			guest.CatalogService, _ = vm.Details["catalog_service_name"].(string)
			if instance, found, err := gaming.ParseInstance(vm.Details[gaming.InstanceKey]); found && err == nil {
				guest.Game = &instance
			}
			entry.VMs = append(entry.VMs, guest)
		}
		for _, component := range node.InternalComponents {
			details := component.Details
			if len(details) == 0 {
				details = nil
			}
			entry.Components = append(entry.Components, componentView{
				ID: component.ID, Type: component.Type, Name: component.Name, PowerDraw: component.PowerDraw, Details: details,
			})
		}
		view.Nodes = append(view.Nodes, entry)
	}
	for _, edge := range input.Edges {
		view.Connections = append(view.Connections, connectionView{
			Source: edge.Source, SourceName: names[edge.Source], SourcePort: edge.SourceHandle,
			Target: edge.Target, TargetName: names[edge.Target], TargetPort: edge.TargetHandle,
			Type: edge.Type, Speed: edge.Speed, Direction: edge.Direction,
			WirelessStandard: edge.WirelessStandard, Subnet: edge.Subnet,
		})
	}
	return view, nil
}

type validationIssue struct {
	NodeID   string `json:"node_id,omitempty"`
	NodeName string `json:"node_name,omitempty"`
	Message  string `json:"message"`
}

type validationView struct {
	Valid    bool              `json:"valid"`
	Errors   []validationIssue `json:"errors"`
	Warnings []validationIssue `json:"warnings"`
}

// describeValidation adds node names to an IPAM validation report.
func describeValidation(raw json.RawMessage, build *models.Build) validationView {
	view := validationView{Errors: []validationIssue{}, Warnings: []validationIssue{}}
	if len(raw) == 0 {
		return view
	}
	var report struct {
		Valid    bool              `json:"valid"`
		Errors   []validationIssue `json:"errors"`
		Warnings []validationIssue `json:"warnings"`
	}
	if err := json.Unmarshal(raw, &report); err != nil {
		return view
	}
	names := map[string]string{}
	if build != nil {
		for _, node := range build.Nodes {
			names[node.ID.String()] = node.Name
			for _, vm := range node.VirtualMachines {
				names[vm.ID.String()] = vm.Name
			}
		}
	}
	// IPAM labels the LAN side of a NAT gateway as "<node id>:lan".
	label := func(issues []validationIssue) []validationIssue {
		out := make([]validationIssue, 0, len(issues))
		for _, issue := range issues {
			issue.NodeName = names[strings.TrimSuffix(issue.NodeID, ":lan")]
			out = append(out, issue)
		}
		return out
	}
	view.Valid = report.Valid
	view.Errors = label(report.Errors)
	view.Warnings = label(report.Warnings)
	return view
}

func validateBuild(_ context.Context, r *Registry, actor Actor, args json.RawMessage) (*Result, error) {
	var in struct {
		BuildID string `json:"build_id"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	buildID, err := ownedBuildID(actor, in.BuildID)
	if err != nil {
		return nil, err
	}
	build, err := r.deps.Builds.GetOwned(buildID, actor.UserID)
	if err != nil {
		return nil, err
	}
	raw, err := r.deps.IP.ValidateNetwork(buildID)
	if err != nil {
		return nil, err
	}
	return &Result{Data: describeValidation(raw, build)}, nil
}

func generateConfigs(_ context.Context, r *Registry, actor Actor, args json.RawMessage) (*Result, error) {
	var in struct {
		BuildID string `json:"build_id"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	buildID, err := ownedBuildID(actor, in.BuildID)
	if err != nil {
		return nil, err
	}
	if _, err := r.deps.Builds.GetOwned(buildID, actor.UserID); err != nil {
		return nil, err
	}
	bundle, err := r.deps.Config.GenerateAll(buildID, actor.UserID)
	if err != nil {
		return nil, err
	}
	return &Result{Data: bundle}, nil
}

func gamingReport(_ context.Context, r *Registry, actor Actor, args json.RawMessage) (*Result, error) {
	var in struct {
		BuildID string `json:"build_id"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	buildID, err := ownedBuildID(actor, in.BuildID)
	if err != nil {
		return nil, err
	}
	report, err := r.deps.Gaming.Report(buildID, actor.UserID)
	if err != nil {
		return nil, err
	}
	return &Result{Data: report}, nil
}

func createBuild(_ context.Context, r *Registry, actor Actor, args json.RawMessage) (*Result, error) {
	var in struct {
		Name string `json:"name"`
		Kind string `json:"kind"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, toolErrorf("name is required")
	}
	// Each successful call leaves an audit event; count those to cap the rate.
	var created int64
	if err := r.deps.DB.Model(&models.Event{}).
		Where("user_id = ? AND event_type = ? AND created_at > ? AND payload->>'tool' = ? AND payload->>'ok' = 'true'",
			actor.UserID, auditEventType(actor), time.Now().Add(-24*time.Hour), "create_build").
		Count(&created).Error; err != nil {
		return nil, err
	}
	if created >= maxCreatedBuildsPerDay {
		return nil, toolErrorf("build limit reached: at most %d builds can be created through this connection per day", maxCreatedBuildsPerDay)
	}
	build, err := r.deps.Builds.Create(actor.UserID, services.SyncGraphInput{Name: name, Kind: in.Kind, Settings: map[string]any{}})
	if err != nil {
		return nil, err
	}
	return &Result{Data: map[string]any{
		"id": build.ID, "name": build.Name, "kind": build.Kind, "revision": build.Revision, "url": reviewURL(actor, build.ID, nil),
		"next": "The build is empty. Add nodes and connections with propose_changes; the user approves them in the builder.",
	}}, nil
}
