package services

import (
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"sort"
	"strings"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/inventory"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/proxmox"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// An import never writes to an existing build. It compares the build with what
// an integration read, takes the owner's decisions about the differences, and
// hands them to the proposal service as a change set: the same review on the
// canvas, the same Apply, the same undo step as a proposal from an LLM. Only a
// build that did not exist before is written directly.

const (
	// ProposalSourceImport marks a proposal made by an import.
	ProposalSourceImport = "import"

	// DetailProxmoxNode is the key in a node's details that names the Proxmox
	// host the device is.
	DetailProxmoxNode = "proxmox_node"

	ImportOutcomeProposal = "proposal"
	ImportOutcomeBuild    = "build"
	ImportOutcomeNothing  = "nothing"
)

// ErrImportTooLarge means one import would make more changes than a proposal holds.
var ErrImportTooLarge = errors.New("the import is too large for one proposal")

// ProxmoxImportService compares builds with Proxmox snapshots and imports what
// the owner chooses.
type ProxmoxImportService struct {
	db           *gorm.DB
	integrations *IntegrationService
	builds       *BuildService
	ip           *IPService
	proposals    *ProposalService
}

func NewProxmoxImportService(db *gorm.DB, integrations *IntegrationService, builds *BuildService, ip *IPService, proposals *ProposalService) *ProxmoxImportService {
	return &ProxmoxImportService{db: db, integrations: integrations, builds: builds, ip: ip, proposals: proposals}
}

// ImportPlanRequest asks for a comparison. Hosts holds the owner's choices:
// for a Proxmox host, the id of the planned device it is, "new" or "skip".
type ImportPlanRequest struct {
	BuildID *uuid.UUID        `json:"build_id"`
	Hosts   map[string]string `json:"hosts"`
}

// ImportItemRef names an inventory item.
type ImportItemRef struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	Type string    `json:"type"`
}

// ImportHost is one Proxmox host in a comparison: how it compares with the
// plan, what it is made of, and which inventory item it may be.
type ImportHost struct {
	proxmox.HostReport
	Facts       proxmox.Node         `json:"facts"`
	Storage     []proxmox.Storage    `json:"storage"`
	LinkedItem  *ImportItemRef       `json:"linked_item"`
	Suggestions []proxmox.Suggestion `json:"suggestions"`
}

// ImportCandidate is a device of the build a Proxmox host could be.
type ImportCandidate struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}

// ImportBuildRef names the build a comparison was made with.
type ImportBuildRef struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	Revision uint64    `json:"revision"`
}

// ImportPlan is a comparison of a snapshot with a build (or with nothing, for
// a build that is yet to be made).
type ImportPlan struct {
	Integration *IntegrationView  `json:"integration"`
	FetchedAt   time.Time         `json:"fetched_at"`
	Build       *ImportBuildRef   `json:"build"`
	Hosts       []ImportHost      `json:"hosts"`
	Candidates  []ImportCandidate `json:"candidates"`
	Totals      proxmox.Totals    `json:"totals"`
	Counts      proxmox.Counts    `json:"counts"`
	Notes       []string          `json:"notes"`
	// OperationLimit is how many changes one import into an existing build can make.
	OperationLimit int `json:"operation_limit"`
}

// importState is everything a comparison is made from.
type importState struct {
	integration *models.Integration
	snapshot    *proxmox.Snapshot
	build       *models.Build
	input       SyncGraphInput
	planned     []proxmox.PlannedHost
	pairs       map[string]proxmox.Pairing
	report      proxmox.Reconciliation
	items       []models.InventoryItem
	// linked maps a host name to the inventory item that stands for it.
	linked map[string]models.InventoryItem
}

func detailFloat(details map[string]any, key string) float64 {
	number, ok := asNumber(details[key])
	if !ok || number < 0 {
		return 0
	}
	return number
}

// plannedHosts lists the devices of a build that can run guests, with their guests.
func plannedHosts(input SyncGraphInput) []proxmox.PlannedHost {
	hosts := []proxmox.PlannedHost{}
	for _, node := range input.Nodes {
		if !vmHostNodeTypes[node.Type] {
			continue
		}
		host := proxmox.PlannedHost{
			ID: node.ID, Name: node.Name,
			CPUs: parseCoreCount(node.Details["cpu"]), RAMGB: parseCapacityGB(node.Details["ram"]),
			StorageGB: parseCapacityGB(node.Details["storage"]),
		}
		host.ProxmoxNode, _ = node.Details[DetailProxmoxNode].(string)
		host.ItemID, _ = node.Details[inventory.DetailItemID].(string)
		for _, component := range node.InternalComponents {
			if component.Type == "disk" {
				host.StorageGB += parseCapacityGB(component.Details["storage"])
			}
		}
		for _, vm := range node.VMs {
			host.Guests = append(host.Guests, proxmox.PlannedGuest{
				ID: vm.ID, Name: vm.Name, Kind: vm.Type, CPUs: vm.CPUCores, MemoryMB: vm.RAMMB,
				Status: vm.Status, DiskGB: detailFloat(vm.Details, guestDiskKey), VMID: int(detailFloat(vm.Details, guestVMIDKey)),
			})
		}
		hosts = append(hosts, host)
	}
	return hosts
}

func (s *ProxmoxImportService) prepare(userID, integrationID uuid.UUID, buildID *uuid.UUID, choices map[string]string) (*importState, error) {
	integration, snapshot, err := s.integrations.Snapshot(userID, integrationID)
	if err != nil {
		return nil, err
	}
	state := &importState{
		integration: integration, snapshot: snapshot, linked: map[string]models.InventoryItem{},
		input: SyncGraphInput{Settings: map[string]any{}, Nodes: []NodeDTO{}, Edges: []EdgeDTO{}},
	}
	if buildID != nil {
		if state.build, err = s.builds.GetOwned(*buildID, userID); err != nil {
			return nil, err
		}
		if state.input, err = BuildToSyncInput(state.build); err != nil {
			return nil, err
		}
	}
	if err := s.db.Where("user_id = ?", userID).Find(&state.items).Error; err != nil {
		return nil, err
	}
	state.items = sortedInventory(state.items)

	itemNode := map[string]string{}
	for _, item := range state.items {
		if item.IntegrationID != nil && *item.IntegrationID == integration.ID && item.IntegrationRef != "" {
			itemNode[item.ID.String()] = item.IntegrationRef
			state.linked[item.IntegrationRef] = item
		}
	}
	state.planned = plannedHosts(state.input)
	state.pairs = proxmox.PairHosts(snapshot.Nodes, state.planned, itemNode, choices)
	state.report = proxmox.Reconcile(snapshot, state.planned, state.pairs)
	return state, nil
}

// suggestionCandidates lists the inventory devices a hypervisor could be.
func (state *importState) suggestionCandidates() []proxmox.Candidate {
	candidates := []proxmox.Candidate{}
	for _, row := range state.items {
		if row.Kind != inventory.KindDevice || !vmHostNodeTypes[row.Type] ||
			row.Status == inventory.StatusSold || row.Status == inventory.StatusBroken {
			continue
		}
		item := InventoryItemOf(row)
		candidate := proxmox.Candidate{
			ID: row.ID.String(), Name: row.Name, Notes: row.Notes,
			CPUModel: item.Specs.CPUModel, Cores: item.Specs.CPUCores, Threads: item.Specs.CPUThreads,
			RAMGB: item.Specs.RAMGB, MACs: item.MacAddresses,
		}
		if row.IntegrationID != nil && row.IntegrationRef != "" {
			if *row.IntegrationID == state.integration.ID {
				candidate.LinkedNode = row.IntegrationRef
			} else {
				candidate.LinkedElsewhere = true
			}
		}
		candidates = append(candidates, candidate)
	}
	return candidates
}

// Plan compares what an integration read with a build. It changes nothing.
func (s *ProxmoxImportService) Plan(userID, integrationID uuid.UUID, req ImportPlanRequest) (*ImportPlan, error) {
	state, err := s.prepare(userID, integrationID, req.BuildID, req.Hosts)
	if err != nil {
		return nil, err
	}
	plan := &ImportPlan{
		Integration: s.integrations.view(state.integration), FetchedAt: state.snapshot.FetchedAt,
		Hosts: []ImportHost{}, Candidates: []ImportCandidate{},
		Totals: state.report.Totals, Counts: state.report.Counts,
		Notes: state.snapshot.Notes, OperationLimit: MaxTopologyOps,
	}
	if plan.Notes == nil {
		plan.Notes = []string{}
	}
	if state.build != nil {
		plan.Build = &ImportBuildRef{ID: state.build.ID, Name: state.build.Name, Revision: state.build.Revision}
	}
	types := map[string]string{}
	for _, node := range state.input.Nodes {
		types[node.ID] = node.Type
	}
	for _, host := range state.planned {
		plan.Candidates = append(plan.Candidates, ImportCandidate{ID: host.ID, Name: host.Name, Type: types[host.ID]})
	}

	candidates := state.suggestionCandidates()
	for _, report := range state.report.Hosts {
		node, _ := state.snapshot.Node(report.Node)
		host := ImportHost{HostReport: report, Facts: node, Storage: []proxmox.Storage{}, Suggestions: []proxmox.Suggestion{}}
		for _, storage := range state.snapshot.Storage {
			if storage.Node == node.Name {
				host.Storage = append(host.Storage, storage)
			}
		}
		if item, ok := state.linked[node.Name]; ok {
			host.LinkedItem = &ImportItemRef{ID: item.ID, Name: item.Name, Type: item.Type}
		} else {
			host.Suggestions = proxmox.Suggest(node, candidates)
		}
		plan.Hosts = append(plan.Hosts, host)
	}
	return plan, nil
}

// ImportDecision is what the owner chose to take over from a comparison.
type ImportDecision struct {
	// BuildID is the build to change; nil makes a new build named BuildName.
	BuildID   *uuid.UUID `json:"build_id"`
	BuildName string     `json:"build_name"`
	// Hosts are the same choices the comparison was made with.
	Hosts map[string]string `json:"hosts"`
	// UseActualSpecs lists hosts whose planned figures give way to the real ones.
	UseActualSpecs []string `json:"use_actual_specs"`
	// AddGuests and UpdateGuests are Proxmox ids: guests to add to the plan, and
	// planned guests to bring in line with what runs.
	AddGuests    []int `json:"add_guests"`
	UpdateGuests []int `json:"update_guests"`
	// RemoveGuests are ids of planned guests that are not on Proxmox and are to go.
	RemoveGuests []string `json:"remove_guests"`
}

// ImportResult says what an import led to.
type ImportResult struct {
	// Outcome is "proposal" (review it on the canvas), "build" (a new build was
	// made) or "nothing" (the plan already says what the cluster does).
	Outcome    string     `json:"outcome"`
	BuildID    *uuid.UUID `json:"build_id,omitempty"`
	ProposalID *uuid.UUID `json:"proposal_id,omitempty"`
	Summary    string     `json:"summary"`
	// AddressesLeftOut: the real addresses did not fit the planned network, so
	// the build keeps the addresses it calculates itself.
	AddressesLeftOut bool `json:"addresses_left_out"`
	// AddressesInPool counts real addresses that were not taken over because
	// they lie in the DHCP range of the build's router, where the address plan
	// pins nothing. Those machines get the address the plan gives them.
	AddressesInPool int `json:"addresses_in_pool"`
}

func ptrTo[T any](value T) *T { return &value }

// importTally counts what an import does, for its summary.
type importTally struct {
	hostsAdded, hostsUpdated                  int
	guestsAdded, guestsUpdated, guestsRemoved int
}

func (t importTally) summary(source string) string {
	parts := []string{}
	add := func(count int, singular, plural, verb string) {
		if count == 1 {
			parts = append(parts, "1 "+singular+" "+verb)
		} else if count > 1 {
			parts = append(parts, fmt.Sprintf("%d %s %s", count, plural, verb))
		}
	}
	add(t.hostsAdded, "host", "hosts", "added")
	add(t.hostsUpdated, "host", "hosts", "updated")
	add(t.guestsAdded, "guest", "guests", "added")
	add(t.guestsUpdated, "guest", "guests", "updated")
	add(t.guestsRemoved, "guest", "guests", "removed")
	if len(parts) == 0 {
		return "Import from " + source
	}
	return "Import from " + source + ": " + strings.Join(parts, ", ")
}

// pinning says which real addresses an import may take over.
type pinning struct {
	enabled bool
	// barred are addresses the address plan was seen to hand to nobody.
	barred map[string]bool
}

// addressBook decides which real addresses a build can take over. An address
// is kept only when it lies in the network of a router of the build, outside
// that router's DHCP range, and nothing else holds it; any other is left to
// the address plan.
//
// The DHCP range matters because the address plan pins nothing inside it:
// hlbIPAM answers such a request with another address. A device that asked for
// .50 and shows .14 would be a contradiction on the canvas, so the request is
// not made.
type addressBook struct {
	enabled bool
	routers []NodeDTO
	used    map[string]bool
	barred  map[string]bool
	// inPool counts the addresses turned down for lying in a DHCP range.
	inPool int
}

func ipv4Number(address string) (uint32, bool) {
	ip := net.ParseIP(strings.TrimSpace(address)).To4()
	if ip == nil {
		return 0, false
	}
	return binary.BigEndian.Uint32(ip), true
}

// inDHCPPool reports whether an address lies in the range a router hands out,
// as the last address calculation stored it on the router (details.dhcp_pool).
func inDHCPPool(router NodeDTO, address string) bool {
	pool, _ := router.Details["dhcp_pool"].(map[string]any)
	start, _ := pool["start"].(string)
	end, _ := pool["end"].(string)
	first, okFirst := ipv4Number(start)
	last, okLast := ipv4Number(end)
	ip, okIP := ipv4Number(address)
	return okFirst && okLast && okIP && ip >= first && ip <= last
}

func newAddressBook(input SyncGraphInput, pins pinning) *addressBook {
	book := &addressBook{enabled: pins.enabled, used: map[string]bool{}, barred: pins.barred}
	for _, node := range input.Nodes {
		if node.IP != "" {
			book.used[node.IP] = true
		}
		if node.Type == "router" && node.IP != "" {
			book.routers = append(book.routers, node)
		}
		for _, vm := range node.VMs {
			if vm.IP != "" {
				book.used[vm.IP] = true
			}
			if static, _ := vm.Details["static_ip"].(string); static != "" {
				book.used[static] = true
			}
		}
	}
	return book
}

// take reports whether the address can be pinned, and reserves it.
func (book *addressBook) take(address string) bool {
	if !book.enabled || address == "" || book.used[address] {
		return false
	}
	if book.barred[address] {
		book.inPool++
		return false
	}
	for _, router := range book.routers {
		mask, _ := router.Details["subnet_mask"].(string)
		if !ipInGatewaySubnet(address, router.IP, mask) {
			continue
		}
		if inDHCPPool(router, address) {
			book.inPool++
			return false
		}
		book.used[address] = true
		return true
	}
	return false
}

// uplinks hands out free ports of the build's switches and routers, so a new
// host arrives cabled where there is room.
type uplinks struct {
	hubs []string
	free map[string]int
}

func newUplinks(input SyncGraphInput) *uplinks {
	result := &uplinks{free: map[string]int{}}
	usage := NodePortUsage(input)
	rank := map[string]int{"switch": 0, "router": 1}
	nodes := append([]NodeDTO(nil), input.Nodes...)
	sort.SliceStable(nodes, func(i, j int) bool {
		if rank[nodes[i].Type] != rank[nodes[j].Type] {
			return rank[nodes[i].Type] < rank[nodes[j].Type]
		}
		return len(usage[nodes[i].ID].Free) > len(usage[nodes[j].ID].Free)
	})
	for _, node := range nodes {
		if _, isHub := rank[node.Type]; !isHub {
			continue
		}
		if free := len(usage[node.ID].Free); free > 0 {
			result.hubs = append(result.hubs, node.ID)
			result.free[node.ID] = free
		}
	}
	return result
}

func (u *uplinks) next() (string, bool) {
	for _, hub := range u.hubs {
		if u.free[hub] > 0 {
			u.free[hub]--
			return hub, true
		}
	}
	return "", false
}

type importOps struct {
	ops   []TopologyOp
	tally importTally
	// pinned: at least one real address was taken over.
	pinned bool
	// inPool: how many real addresses were left to the address plan because
	// they lie in a DHCP range.
	inPool int
}

func listHasString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func listHasInt(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

// newHostDetails are the details a host gets when it comes into a build: what
// its inventory item says about the machine, then what the cluster measured.
func (state *importState) newHostDetails(node proxmox.Node) (nodeType string, details map[string]any, mac string) {
	nodeType, details = "server_v2", map[string]any{}
	if row, linked := state.linked[node.Name]; linked {
		item := InventoryItemOf(row)
		details = item.NodeDetails(row.ID.String())
		if vmHostNodeTypes[row.Type] {
			nodeType = row.Type
		}
		if len(item.MacAddresses) > 0 {
			mac = item.MacAddresses[0]
		}
	}
	details[DetailProxmoxNode] = node.Name
	if node.Threads > 0 {
		details["cpu"] = node.Threads
	}
	if _, known := details["ram"]; !known {
		if ram := proxmox.NominalRAMGB(node.MemoryMB); ram > 0 {
			details["ram"] = ram
		}
	}
	if _, known := details["storage"]; !known {
		if storage := state.snapshot.LocalStorageGB(node.Name); storage > 0 {
			details["storage"] = float64(int(storage + 0.5))
		} else if node.DiskGB > 0 {
			details["storage"] = float64(int(node.DiskGB + 0.5))
		}
	}
	if _, known := details["model"]; !known && node.CPUModel != "" {
		details["model"] = node.CPUModel
	}
	if nodeType == "server_v2" {
		details["server_profile"] = "hypervisor"
		details["hypervisor_enabled"] = true
		details["app_host_enabled"] = true
	}
	return nodeType, details, mac
}

// buildOps turns the owner's decisions into a change set. newBuild lays a
// router and a switch first, since there is nothing to plug the hosts into.
func (state *importState) buildOps(decision ImportDecision, pins pinning) importOps {
	result := importOps{}
	newBuild := state.build == nil
	input := state.input
	book := newAddressBook(input, pins)

	// A new build has no network yet: a router at the hosts' real gateway and
	// a switch large enough for all of them.
	tokens := map[string]string{} // host name -> how later operations name the node
	// reference names a node an earlier operation of this import adds. A new
	// build is written in batches, which only share ids; a proposal is one
	// batch, and the ids of what it adds are given by the server.
	reference := func(ref string) (id, token string) {
		if newBuild {
			id = uuid.NewString()
			return id, id
		}
		return "", ref
	}

	switchToken := ""
	if newBuild {
		gateway := ""
		hosts := 0
		for _, report := range state.report.Hosts {
			if report.Skipped {
				continue
			}
			hosts++
			if node, ok := state.snapshot.Node(report.Node); ok && gateway == "" && node.Gateway != "" {
				gateway = node.Gateway
			}
		}
		routerID, routerToken := reference("router")
		router := TopologyOp{Op: "add_node", ID: routerID, Ref: "router", Type: "router", Name: ptrTo("Router"),
			Details: map[string]any{"ports": 4.0, "dhcp_enabled": true}}
		if gateway != "" {
			router.IP = ptrTo(gateway)
			book.routers = append(book.routers, NodeDTO{Type: "router", IP: gateway, Details: map[string]any{}})
			book.used[gateway] = true
		}
		ports := 8.0
		for float64(hosts) > ports {
			ports += 8
		}
		switchID, token := reference("switch")
		switchToken = token
		result.ops = append(result.ops, router,
			TopologyOp{Op: "add_node", ID: switchID, Ref: "switch", Type: "switch", Name: ptrTo("Switch"), Details: map[string]any{"ports": ports}},
			TopologyOp{Op: "connect", Source: routerToken, Target: switchToken},
		)
	}
	free := newUplinks(input)
	nodeByID := map[string]NodeDTO{}
	for _, node := range input.Nodes {
		nodeByID[node.ID] = node
	}

	// Hosts first, so their guests have somewhere to go.
	for index, report := range state.report.Hosts {
		if report.Skipped {
			continue
		}
		node, _ := state.snapshot.Node(report.Node)
		if report.PlannedID == "" {
			nodeType, details, mac := state.newHostDetails(node)
			ref := fmt.Sprintf("host%d", index+1)
			id, token := reference(ref)
			tokens[node.Name] = token
			op := TopologyOp{Op: "add_node", ID: id, Ref: ref, Type: nodeType, Name: ptrTo(node.Name), Details: details}
			if mac != "" {
				op.MacAddress = ptrTo(mac)
			}
			if book.take(node.Address) {
				op.IP = ptrTo(node.Address)
				result.pinned = true
			}
			result.ops = append(result.ops, op)
			result.tally.hostsAdded++
			switch {
			case newBuild:
				result.ops = append(result.ops, TopologyOp{Op: "connect", Source: switchToken, Target: token})
			default:
				if hub, ok := free.next(); ok {
					result.ops = append(result.ops, TopologyOp{Op: "connect", Source: hub, Target: token})
				}
			}
			continue
		}

		tokens[node.Name] = report.PlannedID
		existing := nodeByID[report.PlannedID]
		patch := map[string]any{}
		if current, _ := existing.Details[DetailProxmoxNode].(string); current != node.Name {
			patch[DetailProxmoxNode] = node.Name
		}
		// The device is the machine its host is linked to.
		if row, linked := state.linked[node.Name]; linked {
			if current, _ := existing.Details[inventory.DetailItemID].(string); current != row.ID.String() {
				patch[inventory.DetailItemID] = row.ID.String()
				patch[inventory.DetailLabel] = row.Name
			}
		}
		if listHasString(decision.UseActualSpecs, node.Name) {
			if report.CPUs.State != proxmox.FigureSame && node.Threads > 0 {
				patch["cpu"] = float64(node.Threads)
			}
			if report.RAMGB.State != proxmox.FigureSame && node.MemoryMB > 0 {
				patch["ram"] = proxmox.NominalRAMGB(node.MemoryMB)
			}
			if report.StorageGB.State != proxmox.FigureSame && report.StorageGB.Actual > 0 {
				patch["storage"] = report.StorageGB.Actual
			}
		}
		if len(patch) > 0 {
			result.ops = append(result.ops, TopologyOp{Op: "update_node", Node: report.PlannedID, Details: patch})
			result.tally.hostsUpdated++
		}
	}

	// Guests: what goes, what changes, what comes.
	linkOnly := []TopologyOp{}
	for _, report := range state.report.Hosts {
		host, placed := tokens[report.Node]
		if report.Skipped || !placed {
			continue
		}
		room := maxVMsPerNode - len(nodeByID[report.PlannedID].VMs)
		for _, row := range report.Guests {
			switch row.State {
			case proxmox.GuestMissing:
				if listHasString(decision.RemoveGuests, row.PlannedID) {
					result.ops = append(result.ops, TopologyOp{Op: "remove_vm", VM: row.PlannedID})
					result.tally.guestsRemoved++
					room++
				}
			case proxmox.GuestMatched:
				guest, _ := state.snapshot.Guest(row.VMID)
				link := TopologyOp{Op: "update_vm", VM: row.PlannedID, VMID: ptrTo(float64(row.VMID))}
				if !listHasInt(decision.UpdateGuests, row.VMID) || !row.Differs {
					// Nothing to change, but remember which guest this is, so the
					// next comparison finds it whatever it is called by then.
					if row.MatchedBy != "id" {
						linkOnly = append(linkOnly, link)
					}
					continue
				}
				link.CPUCores, link.RAMMB = ptrTo(guest.CPUs), ptrTo(float64(guest.MemoryMB))
				link.Status = ptrTo(guest.Status)
				if guest.DiskGB > 0 {
					link.DiskGB = ptrTo(guest.DiskGB)
				}
				result.ops = append(result.ops, link)
				result.tally.guestsUpdated++
			case proxmox.GuestDiscovered:
				if !listHasInt(decision.AddGuests, row.VMID) || room <= 0 {
					continue
				}
				guest, _ := state.snapshot.Guest(row.VMID)
				room--
				op := TopologyOp{
					Op: "add_vm", Host: host, Type: guest.Kind, Name: ptrTo(guest.Name),
					CPUCores: ptrTo(guest.CPUs), RAMMB: ptrTo(float64(guest.MemoryMB)),
					Status: ptrTo(guest.Status), VMID: ptrTo(float64(guest.VMID)),
				}
				if guest.OS != "" {
					op.OS = ptrTo(guest.OS)
				}
				if guest.DiskGB > 0 {
					op.DiskGB = ptrTo(guest.DiskGB)
				}
				if guest.MAC != "" {
					op.MacAddress = ptrTo(guest.MAC)
				}
				if book.take(guest.IP) {
					op.StaticIP = ptrTo(guest.IP)
					result.pinned = true
				}
				result.ops = append(result.ops, op)
				result.tally.guestsAdded++
			}
		}
	}
	// Links ride along with real changes; alone they would be a proposal that
	// shows nothing to review.
	if len(result.ops) > 0 {
		for _, link := range linkOnly {
			if !newBuild && len(result.ops) >= MaxTopologyOps {
				break
			}
			result.ops = append(result.ops, link)
		}
	}
	result.inPool = book.inPool
	return result
}

// unhonoured lists the addresses a saved build gave to somebody else than the
// import asked: the address plan refuses what lies in a DHCP range and hands
// out another. A build that did not exist before has no range to check
// beforehand, so this is read off the first writing of it.
func unhonoured(build *models.Build, ops []TopologyOp) map[string]bool {
	asked := map[string]string{}
	for _, op := range ops {
		if op.Op == "add_node" && op.Type != "router" && op.IP != nil && op.ID != "" {
			asked[op.ID] = *op.IP
		}
	}
	refused := map[string]bool{}
	for _, node := range build.Nodes {
		if want := asked[node.ID.String()]; want != "" && node.IP != want {
			refused[want] = true
		}
		for _, vm := range node.VirtualMachines {
			if want := requestedVMIP(vm); want != "" && vm.IP != want {
				refused[want] = true
			}
		}
	}
	return refused
}

func (state *importState) sourceLabel() string {
	if state.integration.Name != "" {
		return state.integration.Name
	}
	return "Proxmox"
}

// Import takes over what the owner chose. For an existing build the result is
// a proposal waiting for review; for a new one, the build.
func (s *ProxmoxImportService) Import(userID, integrationID uuid.UUID, decision ImportDecision) (*ImportResult, error) {
	state, err := s.prepare(userID, integrationID, decision.BuildID, decision.Hosts)
	if err != nil {
		return nil, err
	}
	plan := state.buildOps(decision, pinning{enabled: true})
	if len(plan.ops) == 0 {
		return &ImportResult{Outcome: ImportOutcomeNothing, BuildID: decision.BuildID, Summary: "The plan already says what the cluster runs."}, nil
	}
	summary := plan.tally.summary(state.sourceLabel())

	if state.build == nil {
		build, leftOut, inPool, err := s.createBuild(userID, state, decision, plan)
		if err != nil {
			return nil, err
		}
		return &ImportResult{
			Outcome: ImportOutcomeBuild, BuildID: &build.ID, Summary: summary,
			AddressesLeftOut: leftOut, AddressesInPool: inPool,
		}, nil
	}

	propose := func(ops []TopologyOp) (*models.BuildProposal, error) {
		if len(ops) > MaxTopologyOps {
			return nil, fmt.Errorf("%w: it makes %d changes and one import holds %d. Leave some guests out and import them next", ErrImportTooLarge, len(ops), MaxTopologyOps)
		}
		return s.proposals.Propose(ProposeInput{
			BuildID: state.build.ID, UserID: userID, Source: ProposalSourceImport,
			SourceLabel: state.sourceLabel(), Summary: summary, Ops: ops,
		})
	}
	leftOut, inPool := false, plan.inPool
	proposal, err := propose(plan.ops)
	if err != nil && plan.pinned && isTopologyRejection(err) && !isNoChange(err) {
		// A real address did not fit the planned network after all: import
		// without them and let the build keep its own address plan.
		leftOut, inPool = true, 0
		proposal, err = propose(state.buildOps(decision, pinning{}).ops)
	}
	if isNoChange(err) {
		return &ImportResult{Outcome: ImportOutcomeNothing, BuildID: decision.BuildID, Summary: "The plan already says what the cluster runs."}, nil
	}
	if err != nil {
		return nil, err
	}
	return &ImportResult{
		Outcome: ImportOutcomeProposal, BuildID: &state.build.ID, ProposalID: &proposal.ID,
		Summary: proposal.Summary, AddressesLeftOut: leftOut, AddressesInPool: inPool,
	}, nil
}

// createBuild writes a build that did not exist: the hosts and guests the
// owner chose, behind a router and a switch. It reports whether the real
// addresses were left out altogether, and how many were left to the address
// plan because they lie in the new router's DHCP range.
func (s *ProxmoxImportService) createBuild(userID uuid.UUID, state *importState, decision ImportDecision, plan importOps) (*models.Build, bool, int, error) {
	name, err := cleanName(decision.BuildName, strings.TrimSpace("Proxmox "+state.snapshot.Cluster))
	if err != nil {
		return nil, false, 0, fmt.Errorf("%w: %v", ErrIntegrationInput, err)
	}
	assemble := func(ops []TopologyOp) (SyncGraphInput, error) {
		graph := SyncGraphInput{Name: name, Kind: "homelab", Settings: map[string]any{}, Nodes: []NodeDTO{}, Edges: []EdgeDTO{}}
		for start := 0; start < len(ops); start += MaxTopologyOps {
			end := start + MaxTopologyOps
			if end > len(ops) {
				end = len(ops)
			}
			applied, err := ApplyTopologyOps(graph, ops[start:end], s.proposals.applyOptions(userID))
			if err != nil {
				return graph, err
			}
			graph = applied.Input
		}
		return graph, nil
	}

	created, err := s.builds.Create(userID, SyncGraphInput{Name: name, Kind: "homelab", Settings: map[string]any{}})
	if err != nil {
		return nil, false, 0, err
	}
	// write replaces what the build holds. A writing that fails changes nothing.
	write := func(build *models.Build, ops []TopologyOp) (*models.Build, error) {
		graph, err := assemble(ops)
		if err != nil {
			return nil, err
		}
		graph.Revision = build.Revision
		return s.builds.UpdateAndCalculate(build.ID, userID, graph, s.ip)
	}
	fail := func(err error) (*models.Build, bool, int, error) {
		// Nothing of a failed import is left behind.
		_ = s.builds.Delete(created.ID, userID)
		return nil, false, 0, err
	}

	leftOut, inPool := false, 0
	build, err := write(created, plan.ops)
	if err != nil && plan.pinned && isTopologyRejection(err) {
		leftOut = true
		build, err = write(created, state.buildOps(decision, pinning{}).ops)
	}
	if err != nil {
		return fail(err)
	}
	if !leftOut && plan.pinned {
		// The router of this build was made a moment ago, so its DHCP range is
		// only known now. What the address plan gave another address than the
		// real one is written again without asking for it.
		if barred := unhonoured(build, plan.ops); len(barred) > 0 {
			again := state.buildOps(decision, pinning{enabled: true, barred: barred})
			if build, err = write(build, again.ops); err != nil {
				return fail(err)
			}
			inPool = again.inPool
		}
	}
	RecordEvent(s.db, &userID, "integration.build_created", map[string]any{"integration_id": state.integration.ID, "build_id": build.ID})
	return build, leftOut, inPool, nil
}
