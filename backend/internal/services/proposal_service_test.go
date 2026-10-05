package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ─── Fixtures ────────────────────────────────────────────────────────────────

// newIPAMStub is a deterministic stand-in for hlbIPAM: it keeps requested
// addresses and hands out 192.168.1.x to every connected, networked node.
func newIPAMStub(t *testing.T, db *gorm.DB) *IPService {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/v1/validate" {
			_, _ = w.Write([]byte(`{"valid":true,"errors":[],"warnings":[]}`))
			return
		}
		var req ipamRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		resp := ipamResponse{}
		for _, router := range req.Routers {
			gateway := router.GatewayIP
			if gateway == "" {
				gateway = "192.168.1.1"
			}
			resp.Routers = append(resp.Routers, ipamRouterResult{ID: router.ID, GatewayIP: gateway, Subnet: gateway + "/24"})
		}
		for i, node := range req.Nodes {
			result := ipamNodeResult{ID: node.ID, Type: node.Type}
			switch {
			case node.ExistingIP != "":
				result.AssignedIP = node.ExistingIP
			case !nonNetworkTypes[node.Type] && len(node.Connections) > 0:
				result.AssignedIP = fmt.Sprintf("192.168.1.%d", 10+i)
			}
			for j, vm := range node.VMs {
				address := vm.ExistingIP
				if address == "" {
					address = fmt.Sprintf("192.168.1.%d", 100+i*10+j)
				}
				result.VMs = append(result.VMs, ipamVMResult{ID: vm.ID, AssignedIP: address})
			}
			resp.Nodes = append(resp.Nodes, result)
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	t.Cleanup(server.Close)
	return &IPService{db: db, client: server.Client(), ipamURL: server.URL}
}

type proposalFixture struct {
	tx        *gorm.DB
	builds    *BuildService
	ip        *IPService
	proposals *ProposalService
	userID    uuid.UUID
	build     *models.Build
	router    string
	sw        string
}

func newTestUser(t *testing.T, tx *gorm.DB) models.User {
	t.Helper()
	user := models.User{Email: uuid.NewString() + "@proposal.test", GoogleID: uuid.NewString()}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return user
}

// newProposalFixture saves a build with a router cabled to a switch.
func newProposalFixture(t *testing.T) *proposalFixture {
	t.Helper()
	tx := testTx(t)
	f := &proposalFixture{tx: tx, builds: NewBuildService(tx), router: uuid.NewString(), sw: uuid.NewString()}
	f.ip = newIPAMStub(t, tx)
	f.proposals = NewProposalService(tx, f.builds, f.ip)
	f.userID = newTestUser(t, tx).ID

	created, err := f.builds.Create(f.userID, SyncGraphInput{Name: "Home Lab"})
	if err != nil {
		t.Fatalf("create build: %v", err)
	}
	f.build, err = f.builds.UpdateAndCalculate(created.ID, f.userID, SyncGraphInput{
		Name:     "Home Lab",
		Revision: created.Revision,
		Settings: map[string]any{"showBought": true},
		Nodes: []NodeDTO{
			{ID: f.router, Type: "router", Name: "Router", X: 80, Y: 80, IP: "192.168.1.1", Details: map[string]any{"ports": 4, "dhcp_enabled": true}},
			{ID: f.sw, Type: "switch", Name: "Switch", X: 80, Y: 340, Details: map[string]any{"ports": 8}},
		},
		Edges: []EdgeDTO{{Source: f.router, SourceHandle: "eth0", Target: f.sw, TargetHandle: TargetHandle, Type: "ethernet", Speed: "1 GbE", Direction: "auto"}},
	}, f.ip)
	if err != nil {
		t.Fatalf("seed topology: %v", err)
	}
	return f
}

func (f *proposalFixture) reload(t *testing.T) *models.Build {
	t.Helper()
	build, err := f.builds.GetByID(f.build.ID)
	if err != nil {
		t.Fatalf("reload build: %v", err)
	}
	return build
}

func (f *proposalFixture) propose(t *testing.T, ops ...TopologyOp) *models.BuildProposal {
	t.Helper()
	proposal, err := f.proposals.Propose(ProposeInput{
		BuildID: f.build.ID, UserID: f.userID, Source: ProposalSourceMCP, SourceLabel: "Claude Code", Ops: ops,
	})
	if err != nil {
		t.Fatalf("propose: %v", err)
	}
	return proposal
}

func addNASOps() []TopologyOp {
	return []TopologyOp{
		{Op: "add_node", Ref: "nas", Type: "nas", Name: strPtr("Storage NAS")},
		{Op: "connect", Source: "Switch", Target: "nas"},
		{Op: "add_vm", Host: "nas", Name: strPtr("Jellyfin"), RAMMB: numPtr(2048)},
	}
}

func nodeByName(t *testing.T, build *models.Build, name string) models.Node {
	t.Helper()
	for _, node := range build.Nodes {
		if node.Name == name {
			return node
		}
	}
	t.Fatalf("node %q not found", name)
	return models.Node{}
}

// ─── Snapshot and dry run ────────────────────────────────────────────────────

func TestBuildToSyncInput_RoundTripKeepsIdentity(t *testing.T) {
	f := newProposalFixture(t)
	serverID, vmID, componentID := uuid.NewString(), uuid.NewString(), uuid.NewString()

	input, err := BuildToSyncInput(f.build)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	input.Nodes = append(input.Nodes, NodeDTO{
		ID: serverID, Type: "server_v2", Name: "PVE", X: 360, Y: 600, PowerDraw: 115,
		Details:            map[string]any{"cpu": 8, "ram": 32, "notes": "rack B"},
		VMs:                []VMDTO{{ID: vmID, Name: "DNS", Type: "lxc", Status: "running", CPUCores: 1, RAMMB: 512, OS: "Alpine", Details: map[string]any{"catalog_service_name": "Pi-hole"}}},
		InternalComponents: []ComponentDTO{{ID: componentID, Type: "disk", Name: "Exos", PowerDraw: 9, Details: map[string]any{"storage": 8000}}},
	})
	input.Edges = append(input.Edges, EdgeDTO{Source: f.sw, SourceHandle: "eth3", Target: serverID, TargetHandle: TargetHandle, Type: "ethernet", Speed: "10 GbE", Direction: "lan", Subnet: "vlan20"})
	saved, err := f.builds.UpdateAndCalculate(f.build.ID, f.userID, input, f.ip)
	if err != nil {
		t.Fatalf("save: %v", err)
	}

	first, err := BuildToSyncInput(saved)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	resaved, err := f.builds.UpdateAndCalculate(f.build.ID, f.userID, first, f.ip)
	if err != nil {
		t.Fatalf("re-save of an unchanged snapshot must succeed: %v", err)
	}
	second, err := BuildToSyncInput(resaved)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}

	// Only the revision moves; ids, cables, details and settings survive.
	first.Revision, second.Revision = 0, 0
	before, _ := json.Marshal(first)
	after, _ := json.Marshal(second)
	if string(before) != string(after) {
		t.Fatalf("round trip changed the build:\n before %s\n after  %s", before, after)
	}
	if len(second.Nodes) != 3 || len(second.Edges) != 2 || second.Settings["showBought"] != true {
		t.Fatalf("unexpected snapshot: %s", after)
	}
	server := findNode(t, second, serverID)
	if server.VMs[0].ID != vmID || server.InternalComponents[0].ID != componentID || server.PowerDraw != 115 || server.Details["notes"] != "rack B" {
		t.Fatalf("server lost data: %+v", server)
	}
	if edge := findEdge(t, second, f.sw, serverID); edge.SourceHandle != "eth3" || edge.Speed != "10 GbE" || edge.Direction != "lan" || edge.Subnet != "vlan20" {
		t.Fatalf("cable lost data: %+v", edge)
	}
}

func TestPreviewTopology_LeavesDatabaseUntouched(t *testing.T) {
	f := newProposalFixture(t)
	input, _ := BuildToSyncInput(f.build)
	applied, err := ApplyTopologyOps(input, addNASOps(), ApplyOptions{})
	if err != nil {
		t.Fatalf("apply ops: %v", err)
	}

	preview, err := f.builds.PreviewTopology(f.build.ID, f.userID, applied.Input, f.ip)
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	nas := nodeByName(t, preview.Build, "Storage NAS")
	if nas.IP == "" || len(nas.VirtualMachines) != 1 || nas.VirtualMachines[0].IP == "" {
		t.Fatalf("preview should carry calculated addresses: %+v", nas)
	}
	if preview.Build.Revision != f.build.Revision+1 || !strings.Contains(string(preview.Validation), `"valid":true`) {
		t.Fatalf("unexpected preview: revision %d, validation %s", preview.Build.Revision, preview.Validation)
	}

	current := f.reload(t)
	if current.Revision != f.build.Revision || len(current.Nodes) != 2 || len(current.Edges) != 1 {
		t.Fatalf("dry run leaked into the database: revision %d, %d nodes, %d edges", current.Revision, len(current.Nodes), len(current.Edges))
	}
	var guests int64
	f.tx.Model(&models.VirtualMachine{}).Where("name = ?", "Jellyfin").Count(&guests)
	if guests != 0 {
		t.Fatal("dry run left a virtual machine behind")
	}

	// Foreign and stale callers are refused before anything is calculated.
	if _, err := f.builds.PreviewTopology(f.build.ID, uuid.New(), applied.Input, f.ip); err == nil {
		t.Fatal("preview for another user must fail")
	}
	stale := applied.Input
	stale.Revision--
	if _, err := f.builds.PreviewTopology(f.build.ID, f.userID, stale, f.ip); !errors.Is(err, ErrBuildRevisionConflict) {
		t.Fatalf("expected a revision conflict, got %v", err)
	}
}

func TestGetOwned_HidesForeignBuilds(t *testing.T) {
	f := newProposalFixture(t)
	if _, err := f.builds.GetOwned(f.build.ID, f.userID); err != nil {
		t.Fatalf("owner must load the build: %v", err)
	}
	if _, err := f.builds.GetOwned(f.build.ID, uuid.New()); !errors.Is(err, ErrBuildNotFound) {
		t.Fatalf("foreign build must look missing, got %v", err)
	}
	if _, err := f.builds.GetOwned(uuid.New(), f.userID); !errors.Is(err, ErrBuildNotFound) {
		t.Fatalf("missing build: got %v", err)
	}
}

// ─── Proposals ───────────────────────────────────────────────────────────────

func TestProposal_ProposeStoresPreviewWithoutTouchingBuild(t *testing.T) {
	f := newProposalFixture(t)
	proposal := f.propose(t, addNASOps()...)

	if proposal.Status != ProposalPending || proposal.BaseRevision != f.build.Revision || proposal.Source != ProposalSourceMCP {
		t.Fatalf("unexpected proposal: %+v", proposal)
	}
	if proposal.Summary != "1 node added, 1 connection added, 1 service added" {
		t.Fatalf("default summary = %q", proposal.Summary)
	}

	var diff ProposalDiff
	if err := json.Unmarshal(proposal.Diff, &diff); err != nil {
		t.Fatalf("diff: %v", err)
	}
	if diff.Counts.NodesAdded != 1 || diff.Counts.ConnectionsAdded != 1 || diff.Counts.VMsAdded != 1 || diff.Counts.Total != 3 {
		t.Fatalf("unexpected counts: %+v", diff.Counts)
	}
	added := diff.Nodes.Added[0]
	if added.Name != "Storage NAS" || added.IP == "" {
		t.Fatalf("added node should carry its predicted address: %+v", added)
	}
	if link := diff.Connections.Added[0]; link.SourceName != "Switch" || link.TargetName != "Storage NAS" || link.SourceHandle != "eth0" {
		t.Fatalf("unexpected connection diff: %+v", link)
	}

	var preview ProposalPreview
	if err := json.Unmarshal(proposal.Preview, &preview); err != nil {
		t.Fatalf("preview: %v", err)
	}
	if len(preview.Build.Nodes) != 3 || nodeByName(t, preview.Build, "Storage NAS").ID.String() != added.ID {
		t.Fatal("preview build must contain the proposed node under the id used in the diff")
	}

	// Stored operations are resolved: server ids, no dangling refs.
	var ops []TopologyOp
	if err := json.Unmarshal(proposal.Operations, &ops); err != nil {
		t.Fatalf("operations: %v", err)
	}
	if ops[0].ID != added.ID || ops[1].Target != added.ID || ops[1].Source != f.sw {
		t.Fatalf("operations were not resolved: %+v", ops)
	}

	if current := f.reload(t); current.Revision != f.build.Revision || len(current.Nodes) != 2 {
		t.Fatalf("proposing must not change the build: revision %d, %d nodes", current.Revision, len(current.Nodes))
	}
	var events int64
	f.tx.Model(&models.Event{}).Where("event_type = ? AND user_id = ?", "proposal.created", f.userID).Count(&events)
	if events != 1 {
		t.Fatalf("expected one audit event, got %d", events)
	}
}

func TestProposal_CallerSuppliedIDsAreIgnored(t *testing.T) {
	f := newProposalFixture(t)
	forged := uuid.NewString()
	proposal := f.propose(t, TopologyOp{Op: "add_node", ID: forged, Type: "nas"})
	var ops []TopologyOp
	_ = json.Unmarshal(proposal.Operations, &ops)
	if ops[0].ID == forged || ops[0].ID == "" {
		t.Fatalf("the server must assign ids, got %q", ops[0].ID)
	}
}

func TestProposal_InvalidOrEmptyChangesAreNotStored(t *testing.T) {
	f := newProposalFixture(t)
	propose := func(ops ...TopologyOp) error {
		_, err := f.proposals.Propose(ProposeInput{BuildID: f.build.ID, UserID: f.userID, Source: ProposalSourceChat, Ops: ops})
		return err
	}

	err := propose(TopologyOp{Op: "connect", Source: "Switch", Target: "ghost"})
	var opErr *OpError
	if !errors.As(err, &opErr) || opErr.Index != 0 || !IsTopologyRejection(err) {
		t.Fatalf("expected an operation error, got %v", err)
	}
	if err := propose(TopologyOp{Op: "update_node", Node: "Switch", Name: strPtr("Switch")}); err == nil || !strings.Contains(err.Error(), "do not change the build") {
		t.Fatalf("a no-op must be refused, got %v", err)
	}

	var stored int64
	f.tx.Model(&models.BuildProposal{}).Where("build_id = ?", f.build.ID).Count(&stored)
	if stored != 0 {
		t.Fatalf("rejected change sets must not be stored, found %d", stored)
	}
}

func TestProposal_ForeignBuildLooksMissing(t *testing.T) {
	f := newProposalFixture(t)
	stranger := newTestUser(t, f.tx).ID
	_, err := f.proposals.Propose(ProposeInput{BuildID: f.build.ID, UserID: stranger, Source: ProposalSourceMCP, Ops: addNASOps()})
	if !errors.Is(err, ErrBuildNotFound) {
		t.Fatalf("expected ErrBuildNotFound, got %v", err)
	}

	proposal := f.propose(t, addNASOps()...)
	if _, err := f.proposals.Get(f.build.ID, proposal.ID, stranger); !errors.Is(err, ErrProposalNotFound) {
		t.Fatalf("Get: %v", err)
	}
	if _, err := f.proposals.GetForUser(proposal.ID, stranger); !errors.Is(err, ErrProposalNotFound) {
		t.Fatalf("GetForUser: %v", err)
	}
	if _, _, err := f.proposals.Apply(f.build.ID, proposal.ID, stranger); !errors.Is(err, ErrProposalNotFound) {
		t.Fatalf("Apply: %v", err)
	}
	if _, err := f.proposals.Reject(f.build.ID, proposal.ID, stranger, ""); !errors.Is(err, ErrProposalNotFound) {
		t.Fatalf("Reject: %v", err)
	}
	if _, err := f.proposals.SyncState(f.build.ID, stranger); !errors.Is(err, ErrBuildNotFound) {
		t.Fatalf("SyncState: %v", err)
	}
	if got, _ := f.proposals.Get(f.build.ID, proposal.ID, f.userID); got == nil || got.Status != ProposalPending {
		t.Fatal("a stranger's attempts must leave the proposal pending")
	}
}

func TestProposal_NewProposalSupersedesPendingAndSyncStateReportsIt(t *testing.T) {
	f := newProposalFixture(t)
	first := f.propose(t, addNASOps()...)
	second := f.propose(t, TopologyOp{Op: "add_node", Type: "access_point"})

	reloaded, _ := f.proposals.Get(f.build.ID, first.ID, f.userID)
	if reloaded.Status != ProposalSuperseded || reloaded.ResolvedAt == nil {
		t.Fatalf("older proposal should be superseded: %+v", reloaded)
	}

	state, err := f.proposals.SyncState(f.build.ID, f.userID)
	if err != nil {
		t.Fatalf("sync state: %v", err)
	}
	if state.Revision != f.build.Revision || state.Pending == nil || state.Pending.ID != second.ID || state.Pending.Counts.NodesAdded != 1 {
		t.Fatalf("unexpected sync state: %+v", state)
	}
	if len(state.Recent) != 1 || state.Recent[0].ID != first.ID || state.Recent[0].Status != ProposalSuperseded {
		t.Fatalf("unexpected recent list: %+v", state.Recent)
	}
}

func TestProposal_ApplyReplaysOnLatestRevision(t *testing.T) {
	f := newProposalFixture(t)
	proposal := f.propose(t, addNASOps()...)

	// The owner keeps editing after the proposal was made.
	input, _ := BuildToSyncInput(f.reload(t))
	input.Nodes[1].Name = "Core Switch"
	input.Nodes = append(input.Nodes, NodeDTO{ID: uuid.NewString(), Type: "minipc", Name: "My NUC", X: 600, Y: 600, Details: map[string]any{}})
	edited, err := f.builds.UpdateAndCalculate(f.build.ID, f.userID, input, f.ip)
	if err != nil {
		t.Fatalf("user edit: %v", err)
	}

	build, validation, err := f.proposals.Apply(f.build.ID, proposal.ID, f.userID)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if build.Revision != edited.Revision+1 || len(build.Nodes) != 4 || !strings.Contains(string(validation), "valid") {
		t.Fatalf("unexpected result: revision %d, %d nodes, validation %s", build.Revision, len(build.Nodes), validation)
	}
	nodeByName(t, build, "My NUC")      // the user's node survived
	nodeByName(t, build, "Core Switch") // and so did the rename
	nas := nodeByName(t, build, "Storage NAS")
	if nas.IP == "" || len(nas.VirtualMachines) != 1 {
		t.Fatalf("proposed node not applied with addresses: %+v", nas)
	}
	// Ids match what the preview showed, so the canvas highlight stays valid.
	var diff ProposalDiff
	_ = json.Unmarshal(proposal.Diff, &diff)
	if nas.ID.String() != diff.Nodes.Added[0].ID {
		t.Fatal("applied node id differs from the previewed id")
	}

	applied, _ := f.proposals.Get(f.build.ID, proposal.ID, f.userID)
	if applied.Status != ProposalApplied || applied.AppliedRevision == nil || *applied.AppliedRevision != build.Revision || applied.ResolvedAt == nil {
		t.Fatalf("proposal not marked applied: %+v", applied)
	}

	if _, _, err := f.proposals.Apply(f.build.ID, proposal.ID, f.userID); !errors.Is(err, ErrProposalNotPending) {
		t.Fatalf("second apply: %v", err)
	}
	if _, err := f.proposals.Reject(f.build.ID, proposal.ID, f.userID, "too late"); !errors.Is(err, ErrProposalNotPending) {
		t.Fatalf("reject after apply: %v", err)
	}
	if state, _ := f.proposals.SyncState(f.build.ID, f.userID); state.Pending != nil || state.Revision != build.Revision {
		t.Fatalf("sync state after apply: %+v", state)
	}
}

func TestProposal_ApplyConflictLeavesBuildUntouched(t *testing.T) {
	f := newProposalFixture(t)
	proposal := f.propose(t, addNASOps()...)

	// The switch the proposal cables into is deleted before it is applied.
	input, _ := BuildToSyncInput(f.reload(t))
	input.Nodes = input.Nodes[:1]
	input.Edges = nil
	edited, err := f.builds.UpdateAndCalculate(f.build.ID, f.userID, input, f.ip)
	if err != nil {
		t.Fatalf("user edit: %v", err)
	}

	_, _, err = f.proposals.Apply(f.build.ID, proposal.ID, f.userID)
	if !errors.Is(err, ErrProposalConflict) || !strings.Contains(err.Error(), "operations[1]") {
		t.Fatalf("expected a conflict that names the failing operation, got %v", err)
	}
	conflicted, _ := f.proposals.Get(f.build.ID, proposal.ID, f.userID)
	if conflicted.Status != ProposalConflict || conflicted.StatusReason == "" || conflicted.ResolvedAt == nil {
		t.Fatalf("proposal should record the conflict: %+v", conflicted)
	}
	if current := f.reload(t); current.Revision != edited.Revision || len(current.Nodes) != 1 {
		t.Fatalf("a conflicting proposal must not change the build: revision %d, %d nodes", current.Revision, len(current.Nodes))
	}
}

func TestProposal_RefreshRebasesThePreviewOnLaterEdits(t *testing.T) {
	f := newProposalFixture(t)
	proposal := f.propose(t, addNASOps()...)

	// Unchanged build: the stored preview is returned as is.
	same, err := f.proposals.Refresh(f.build.ID, proposal.ID, f.userID)
	if err != nil || same.BaseRevision != proposal.BaseRevision || string(same.Preview) != string(proposal.Preview) {
		t.Fatalf("refresh of an up-to-date proposal should be a no-op: %v", err)
	}

	input, _ := BuildToSyncInput(f.reload(t))
	input.Nodes = append(input.Nodes, NodeDTO{ID: uuid.NewString(), Type: "minipc", Name: "My NUC", X: 600, Y: 600, Details: map[string]any{}})
	edited, err := f.builds.UpdateAndCalculate(f.build.ID, f.userID, input, f.ip)
	if err != nil {
		t.Fatalf("user edit: %v", err)
	}

	refreshed, err := f.proposals.Refresh(f.build.ID, proposal.ID, f.userID)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if refreshed.Status != ProposalPending || refreshed.BaseRevision != edited.Revision {
		t.Fatalf("proposal should be rebased on revision %d: %+v", edited.Revision, refreshed)
	}
	var preview ProposalPreview
	_ = json.Unmarshal(refreshed.Preview, &preview)
	nodeByName(t, preview.Build, "My NUC")
	nodeByName(t, preview.Build, "Storage NAS")
	var diff ProposalDiff
	_ = json.Unmarshal(refreshed.Diff, &diff)
	if diff.Counts.NodesAdded != 1 || diff.Nodes.Added[0].Name != "Storage NAS" {
		t.Fatalf("the diff must still describe only the proposal: %+v", diff.Counts)
	}
	if current := f.reload(t); current.Revision != edited.Revision || len(current.Nodes) != 3 {
		t.Fatal("refreshing must not change the build")
	}

	// Once the switch it cables into is gone, the proposal is a conflict.
	input, _ = BuildToSyncInput(f.reload(t))
	kept := input.Nodes[:0]
	for _, node := range input.Nodes {
		if node.ID != f.sw {
			kept = append(kept, node)
		}
	}
	input.Nodes, input.Edges = kept, nil
	if _, err := f.builds.UpdateAndCalculate(f.build.ID, f.userID, input, f.ip); err != nil {
		t.Fatalf("user edit: %v", err)
	}
	conflicted, err := f.proposals.Refresh(f.build.ID, proposal.ID, f.userID)
	if err != nil || conflicted.Status != ProposalConflict || conflicted.StatusReason == "" {
		t.Fatalf("expected a recorded conflict, got %+v, %v", conflicted, err)
	}
	if _, _, err := f.proposals.Apply(f.build.ID, proposal.ID, f.userID); !errors.Is(err, ErrProposalNotPending) {
		t.Fatalf("a conflicted proposal cannot be applied: %v", err)
	}
}

func TestProposal_RejectStoresReason(t *testing.T) {
	f := newProposalFixture(t)
	proposal := f.propose(t, addNASOps()...)
	rejected, err := f.proposals.Reject(f.build.ID, proposal.ID, f.userID, "  use the mini PC instead  ")
	if err != nil {
		t.Fatalf("reject: %v", err)
	}
	if rejected.Status != ProposalRejected || rejected.StatusReason != "use the mini PC instead" || rejected.ResolvedAt == nil {
		t.Fatalf("unexpected proposal: %+v", rejected)
	}
	if current := f.reload(t); current.Revision != f.build.Revision {
		t.Fatal("rejecting must not change the build")
	}
	if _, _, err := f.proposals.Apply(f.build.ID, proposal.ID, f.userID); !errors.Is(err, ErrProposalNotPending) {
		t.Fatalf("apply after reject: %v", err)
	}
}

func TestProposal_FollowsTheLoopPreference(t *testing.T) {
	f := newProposalFixture(t)
	f.propose(t, addNASOps()...)
	// A second cable from the router to the NAS closes a loop through the switch.
	withNAS := func() []TopologyOp {
		return append(addNASOps(), TopologyOp{Op: "connect", Source: "Router", Target: "nas"})
	}
	_, err := f.proposals.Propose(ProposeInput{BuildID: f.build.ID, UserID: f.userID, Source: ProposalSourceMCP, Ops: withNAS()})
	if err == nil || !strings.Contains(err.Error(), "network loop") {
		t.Fatalf("loops are refused by default, got %v", err)
	}
	if err := f.tx.Model(&models.User{}).Where("id = ?", f.userID).
		Update("preferences", json.RawMessage(`{"edgePreferences":{"ignoreNetworkLoops":true}}`)).Error; err != nil {
		t.Fatalf("set preference: %v", err)
	}
	f.propose(t, withNAS()...)
}

func TestProposal_HistoryIsBounded(t *testing.T) {
	f := newProposalFixture(t)
	for i := 0; i < keptResolvedProposals+4; i++ {
		f.propose(t, TopologyOp{Op: "add_node", Type: "nas", Name: strPtr(fmt.Sprintf("NAS %d", i))})
	}
	var total, pending int64
	f.tx.Model(&models.BuildProposal{}).Where("build_id = ?", f.build.ID).Count(&total)
	f.tx.Model(&models.BuildProposal{}).Where("build_id = ? AND status = ?", f.build.ID, ProposalPending).Count(&pending)
	if pending != 1 || total != keptResolvedProposals+1 {
		t.Fatalf("expected 1 pending and %d settled proposals, got %d pending of %d", keptResolvedProposals, pending, total)
	}
}

func TestProposal_ResolvedForThread(t *testing.T) {
	f := newProposalFixture(t)
	threadID := uuid.New()
	proposal, err := f.proposals.Propose(ProposeInput{
		BuildID: f.build.ID, UserID: f.userID, Source: ProposalSourceChat, ThreadID: &threadID, Ops: addNASOps(),
	})
	if err != nil {
		t.Fatalf("propose: %v", err)
	}
	if resolved, _ := f.proposals.ResolvedForThread(threadID, proposal.CreatedAt.Add(-1)); len(resolved) != 0 {
		t.Fatalf("a pending proposal is not resolved: %+v", resolved)
	}
	if _, err := f.proposals.Reject(f.build.ID, proposal.ID, f.userID, "no NAS"); err != nil {
		t.Fatalf("reject: %v", err)
	}
	resolved, err := f.proposals.ResolvedForThread(threadID, proposal.CreatedAt.Add(-1))
	if err != nil || len(resolved) != 1 || resolved[0].Status != ProposalRejected || resolved[0].StatusReason != "no NAS" {
		t.Fatalf("unexpected resolved list: %+v, %v", resolved, err)
	}
}

func TestProposal_DeletedWithItsBuild(t *testing.T) {
	f := newProposalFixture(t)
	created, _ := f.builds.Create(f.userID, SyncGraphInput{Name: "Scratch"})
	if _, err := f.proposals.Propose(ProposeInput{
		BuildID: created.ID, UserID: f.userID, Source: ProposalSourceMCP,
		Ops: []TopologyOp{{Op: "rename_build", Name: strPtr("Renamed")}},
	}); err != nil {
		t.Fatalf("propose: %v", err)
	}
	if err := f.builds.Delete(created.ID, f.userID); err != nil {
		t.Fatalf("delete build: %v", err)
	}
	var left int64
	f.tx.Model(&models.BuildProposal{}).Where("build_id = ?", created.ID).Count(&left)
	if left != 0 {
		t.Fatalf("proposals must be deleted with their build, %d left", left)
	}
}

// With the real hlbIPAM the preview must carry addresses from the router's subnet.
func TestProposal_PreviewUsesRealIPAM(t *testing.T) {
	skipWithoutIPAM(t)
	f := newProposalFixture(t)
	f.ip = NewIPService(f.tx)
	f.proposals = NewProposalService(f.tx, f.builds, f.ip)

	proposal := f.propose(t, addNASOps()...)
	var preview ProposalPreview
	if err := json.Unmarshal(proposal.Preview, &preview); err != nil {
		t.Fatalf("preview: %v", err)
	}
	nas := nodeByName(t, preview.Build, "Storage NAS")
	if !strings.HasPrefix(nas.IP, "192.168.1.") || !strings.HasPrefix(nas.VirtualMachines[0].IP, "192.168.1.") {
		t.Fatalf("expected addresses in the router subnet, got node %q vm %q", nas.IP, nas.VirtualMachines[0].IP)
	}
	if len(preview.Validation) == 0 {
		t.Fatal("preview should include the IPAM validation report")
	}
}
