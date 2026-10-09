package assistant

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/google/uuid"
)

// proposeChangesSchema describes operations as one flat object tagged by "op"
// (no oneOf/anyOf), which every provider's function-calling schema accepts.
const proposeChangesSchema = `{
"type":"object",
"properties":{
  "build_id":{"type":"string","description":"Build id from list_builds."},
  "summary":{"type":"string","maxLength":500,"description":"One or two sentences for the user: what this change does and why."},
  "operations":{
    "type":"array","minItems":1,"maxItems":100,
    "description":"Changes applied in order as one atomic set. If any operation is invalid, nothing is proposed.",
    "items":{
      "type":"object",
      "properties":{
        "op":{"type":"string","enum":["add_node","update_node","remove_node","connect","disconnect","update_connection","add_vm","update_vm","remove_vm","add_component","remove_component","rename_build","set_plan"]},
        "ref":{"type":"string","maxLength":64,"description":"add_node, add_vm, add_component: a short label for the new entity (e.g. \"nas1\") that later operations in this call can use in place of an id."},
        "node":{"type":"string","description":"update_node, remove_node, add_component: the node, as an id from get_build, a ref from this call, or its exact unique name."},
        "host":{"type":"string","description":"add_vm: the node that runs the VM, container or service."},
        "vm":{"type":"string","description":"update_vm, remove_vm: the VM, container or service (id, ref or unique name)."},
        "component":{"type":"string","description":"remove_component: the component id or ref."},
        "source":{"type":"string","description":"connect, disconnect, update_connection: one end of the connection (node id, ref or unique name)."},
        "target":{"type":"string","description":"connect, disconnect, update_connection: the other end."},
        "parent":{"type":"string","description":"add_node, update_node: the rack to mount this device in. On update_node, \"\" takes it out of its rack."},
        "rack_slot":{"type":"number","minimum":0,"description":"U slot inside the rack, 0 is the top. Omit to use the first free gap."},
        "type":{"type":"string","description":"add_node: node type (router, switch, firewall, modem, access_point, server_v2, minipc, pc, nas, sbc, vps, iot, cpu, console, lan_table, ups, pdu, rack). add_vm, update_vm: vm, container or lxc. add_component: disk, cpu, gpu, hba or pcie."},
        "name":{"type":"string","maxLength":120,"description":"Display name. Required for add_vm and add_component unless a catalog id supplies it; rename_build takes the new build name."},
        "details":{"type":"object","description":"add_node, update_node, add_component: specs to set, e.g. {\"cpu\":8,\"ram\":32,\"storage\":1000,\"ports\":8,\"model\":\"...\",\"notes\":\"...\"}. On update_node this is a merge patch: listed keys are set, a null value removes a key, other keys stay. A lan_table takes seats, seat_watts, switch_ports and switch_speed; a console takes platform; an access_point takes wifi_clients; circuit names the power circuit of the gaming plan a device is plugged into."},
        "ip":{"type":"string","description":"add_node, update_node: a router's gateway address, or a static address for another device. \"\" releases a static address. Leave out to let the IP manager assign one."},
        "power_draw":{"type":"number","minimum":0,"description":"Typical power draw in watts."},
        "x":{"type":"number","description":"Canvas position. Omit x and y for automatic placement."},
        "y":{"type":"number"},
        "hardware_id":{"type":"string","description":"add_node, add_component: catalog id from search_hardware. Fills in name, specs, power draw and price."},
        "connection_type":{"type":"string","enum":["ethernet","wireless","vpn"],"description":"connect, update_connection. Defaults to wireless when one end is an access point, otherwise ethernet."},
        "speed":{"type":"string","maxLength":40,"description":"Link speed label, e.g. \"1 GbE\", \"2.5 GbE\", \"10 GbE\"."},
        "direction":{"type":"string","enum":["auto","lan","wan"],"description":"Which side of a NAT gateway (firewall, gateway server, VPS) this connection is on. auto decides from the ports used."},
        "wireless_standard":{"type":"string","maxLength":40,"description":"e.g. \"Wi-Fi 6\"."},
        "subnet":{"type":"string","maxLength":64,"description":"Free-form label for the link, e.g. a VLAN name."},
        "source_handle":{"type":"string","description":"connect: port on the source (eth0, eth1, ... or target-0 for its top port). Omit to use the next free port."},
        "target_handle":{"type":"string","description":"connect: port on the target. Omit to use the next free port."},
        "cpu_cores":{"type":"number","minimum":0,"description":"add_vm, update_vm."},
        "ram_mb":{"type":"number","minimum":0,"description":"add_vm, update_vm: memory in MB."},
        "os":{"type":"string","maxLength":80,"description":"add_vm, update_vm: e.g. \"Debian 12\"."},
        "status":{"type":"string","enum":["running","stopped","paused"],"description":"add_vm, update_vm."},
        "static_ip":{"type":"string","description":"add_vm, update_vm: request a fixed address inside the host's subnet. \"\" clears it."},
        "catalog_service_id":{"type":"string","description":"add_vm: service id from list_services. Fills in the name and resource needs. A game from the gaming category becomes a game server."},
        "players":{"type":"number","minimum":1,"description":"add_vm, update_vm on a game server: players online at once. Sizes memory and cores unless cpu_cores or ram_mb are given."},
        "exposure":{"type":"string","enum":["lan","port_forward","vpn","relay"],"description":"add_vm, update_vm on a game server: who can reach it. lan is the default; port_forward needs a public address on the user's line."},
        "port_offset":{"type":"number","minimum":0,"description":"add_vm, update_vm on a game server: added to every port, so two servers of the same game can share a host or a router."},
        "kind":{"type":"string","enum":["homelab","lan_party","game_server"],"description":"set_plan: what the build is planned for."},
        "plan":{"type":"object","description":"set_plan: merge patch for the gaming plan, e.g. {\"uplink\":{\"down_mbps\":300,\"up_mbps\":20,\"cgnat\":\"no\",\"public_host\":\"play.example.org\"},\"power\":{\"mains_voltage\":230,\"circuits\":[{\"id\":\"c1\",\"label\":\"Hall\",\"breaker_amps\":16}]},\"event\":{\"date\":\"2026-11-14\",\"hours\":24}}. Listed keys are set and other keys stay; circuits is replaced as a whole. cgnat is yes, no or \"\" for unknown."}
      },
      "required":["op"],
      "additionalProperties":false
    }
  }
},
"required":["build_id","summary","operations"],
"additionalProperties":false
}`

func proposalTools() []*Tool {
	return []*Tool{
		{
			Name:  "propose_changes",
			Title: "Propose changes to a build",
			Description: "Stage a set of changes to a build for the user to approve. Nothing is written to the build: the user sees a diff and a " +
				"canvas preview in HLBuilder and clicks Apply or Reject. The call validates the change set first and returns the resulting diff, " +
				"the IP addresses the devices would get, and network warnings; if an operation is invalid the call fails and names it, so fix it " +
				"and call again. A new proposal replaces the build's pending one, so put everything for one request in a single call.",
			InputSchema: json.RawMessage(proposeChangesSchema),
			Scope:       ScopePropose,
			handler:     proposeChanges,
			describe: func(args json.RawMessage) string {
				var in struct {
					Operations []json.RawMessage `json:"operations"`
				}
				if json.Unmarshal(args, &in) != nil || len(in.Operations) == 0 {
					return ""
				}
				return count(len(in.Operations), "operation", "operations")
			},
		},
		{
			Name:        "get_proposal",
			Title:       "Check a proposal",
			Description: "Check whether a proposal is still pending or was applied, rejected (with the user's reason), replaced, or no longer fits the build.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"proposal_id":{"type":"string","description":"Id returned by propose_changes."}},"required":["proposal_id"],"additionalProperties":false}`),
			Scope:       ScopeRead,
			ReadOnly:    true,
			handler:     getProposal,
		},
	}
}

func proposeChanges(_ context.Context, r *Registry, actor Actor, args json.RawMessage) (*Result, error) {
	var in struct {
		BuildID    string                `json:"build_id"`
		Summary    string                `json:"summary"`
		Operations []services.TopologyOp `json:"operations"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	buildID, err := ownedBuildID(actor, in.BuildID)
	if err != nil {
		return nil, err
	}
	proposal, err := r.deps.Proposals.Propose(services.ProposeInput{
		BuildID: buildID, UserID: actor.UserID,
		Source: actor.Source, SourceLabel: actor.SourceLabel,
		TokenID: actor.TokenID, ThreadID: actor.ThreadID,
		Summary: in.Summary, Ops: in.Operations,
	})
	if err != nil {
		return nil, err
	}

	var preview services.ProposalPreview
	_ = json.Unmarshal(proposal.Preview, &preview)
	next := "Nothing has changed in the build yet. Ask the user to review this proposal at review_url and apply or reject it, " +
		"then call get_proposal to see what they decided."
	if actor.Source == services.ProposalSourceChat {
		next = "Nothing has changed in the build yet. The user now sees this proposal in the builder with Apply and Reject buttons; " +
			"tell them briefly what it does and wait for their decision."
	}
	validation := describeValidation(preview.Validation, preview.Build)
	data := map[string]any{
		"proposal_id": proposal.ID,
		"status":      proposal.Status,
		"summary":     proposal.Summary,
		"review_url":  reviewURL(actor, buildID, &proposal.ID),
		"changes":     json.RawMessage(proposal.Diff),
		"validation":  validation,
		"next":        next,
	}
	// What the gaming report would say once the proposal is applied, so the
	// caller can correct the plan before the user reviews it.
	if preview.Build != nil {
		if report, err := services.GamingReportForBuild(preview.Build); err == nil && (report.Kind.IsGaming() || len(report.Issues) > 0) {
			data["gaming"] = map[string]any{"status": report.Status, "issues": report.Issues}
		}
	}
	summary := count(services.SummarizeProposal(proposal).Counts.Total, "change", "changes")
	if len(validation.Errors)+len(validation.Warnings) > 0 {
		summary += ", " + validation.summary()
	}
	return &Result{ProposalID: &proposal.ID, Data: data, Summary: summary, Focus: touchedNodes(proposal.Diff)}, nil
}

// touchedNodes lists the nodes a proposal adds, changes or removes, including
// the ends of its connections and the hosts of its guests and components.
func touchedNodes(raw json.RawMessage) []string {
	var diff services.ProposalDiff
	if json.Unmarshal(raw, &diff) != nil {
		return nil
	}
	ids := []string{}
	for _, group := range [][]services.NodeDiff{diff.Nodes.Added, diff.Nodes.Changed, diff.Nodes.Removed} {
		for _, node := range group {
			ids = append(ids, node.ID)
		}
	}
	for _, group := range [][]services.ConnectionDiff{diff.Connections.Added, diff.Connections.Changed, diff.Connections.Removed} {
		for _, connection := range group {
			ids = append(ids, connection.Source, connection.Target)
		}
	}
	for _, group := range [][]services.GuestDiff{diff.VMs.Added, diff.VMs.Changed, diff.VMs.Removed} {
		for _, guest := range group {
			ids = append(ids, guest.HostID)
		}
	}
	for _, group := range [][]services.ComponentDiff{diff.Components.Added, diff.Components.Removed} {
		for _, component := range group {
			ids = append(ids, component.HostID)
		}
	}
	return focusOn(ids...)
}

func getProposal(_ context.Context, r *Registry, actor Actor, args json.RawMessage) (*Result, error) {
	var in struct {
		ProposalID string `json:"proposal_id"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	proposalID, err := uuid.Parse(strings.TrimSpace(in.ProposalID))
	if err != nil {
		return nil, toolErrorf("proposal_id must be an id returned by propose_changes")
	}
	proposal, err := r.deps.Proposals.GetForUser(proposalID, actor.UserID)
	if err != nil {
		return nil, err
	}
	if !actor.CanAccess(proposal.BuildID) {
		return nil, services.ErrProposalNotFound
	}
	summary := services.SummarizeProposal(proposal)
	data := map[string]any{
		"proposal_id": proposal.ID,
		"build_id":    proposal.BuildID,
		"status":      proposal.Status,
		"summary":     proposal.Summary,
		"counts":      summary.Counts,
		"changes":     json.RawMessage(proposal.Diff),
		"created_at":  proposal.CreatedAt,
		"review_url":  reviewURL(actor, proposal.BuildID, &proposal.ID),
	}
	if proposal.StatusReason != "" {
		data["status_reason"] = proposal.StatusReason
	}
	if proposal.ResolvedAt != nil {
		data["resolved_at"] = proposal.ResolvedAt
	}
	if proposal.AppliedRevision != nil {
		data["applied_revision"] = proposal.AppliedRevision
	}
	return &Result{Data: data, Summary: strings.ReplaceAll(proposal.Status, "_", " ")}, nil
}
