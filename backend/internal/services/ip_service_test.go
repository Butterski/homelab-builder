package services

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// skipWithoutIPAM skips tests that require the hlbIPAM service to be running.
// In Docker-compose test mode, IPAM_URL is set; locally it is usually absent.
func skipWithoutIPAM(t *testing.T) {
	t.Helper()
	if os.Getenv("IPAM_URL") == "" {
		t.Skip("skipping: IPAM_URL not set (hlbIPAM not running)")
	}
}

// ─── Test helpers ────────────────────────────────────────────────────────────

func createNode(t *testing.T, db *gorm.DB, buildID uuid.UUID, hwType, name, ip string) models.Node {
	t.Helper()
	n := models.Node{
		BuildID: buildID,
		Type:    hwType,
		Name:    name,
		IP:      ip,
		Details: json.RawMessage("{}"),
	}
	if err := db.Create(&n).Error; err != nil {
		t.Fatalf("createNode(%s): %v", name, err)
	}
	return n
}

func connectNodes(t *testing.T, db *gorm.DB, buildID, srcID, dstID uuid.UUID) {
	t.Helper()
	e := models.Edge{
		BuildID:      buildID,
		SourceNodeID: srcID,
		TargetNodeID: dstID,
		Type:         "ethernet",
	}
	if err := db.Create(&e).Error; err != nil {
		t.Fatalf("connectNodes: %v", err)
	}
}

func fetchIP(t *testing.T, db *gorm.DB, nodeID uuid.UUID) string {
	t.Helper()
	var n models.Node
	if err := db.First(&n, "id = ?", nodeID).Error; err != nil {
		t.Fatalf("fetchIP: %v", err)
	}
	return n.IP
}

func newBuildID(t *testing.T, db *gorm.DB) uuid.UUID {
	t.Helper()
	user := models.User{Email: uuid.NewString() + "@test.com", Name: "T", GoogleID: uuid.NewString()}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("newBuildID: create user: %v", err)
	}
	build := models.Build{UserID: user.ID, Name: "test"}
	if err := db.Create(&build).Error; err != nil {
		t.Fatalf("newBuildID: create build: %v", err)
	}
	return build.ID
}

// ─── Integration tests (require hlbIPAM to be running) ──────────────────────

func TestCalculateNetwork_NoNodes(t *testing.T) {
	skipWithoutIPAM(t)
	svc := NewIPService(testTx(t))
	if err := svc.CalculateNetwork(uuid.New()); err != nil {
		t.Errorf("expected nil error for empty build, got: %v", err)
	}
}

func TestCalculateNetwork_RouterWithNoIP_GetsDefault192168(t *testing.T) {
	skipWithoutIPAM(t)
	tx := testTx(t)
	svc := NewIPService(tx)
	buildID := newBuildID(t, tx)

	router := createNode(t, tx, buildID, "router", "Router", "")

	if err := svc.CalculateNetwork(buildID); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ip := fetchIP(t, tx, router.ID); ip != "192.168.1.1" {
		t.Errorf("expected router IP 192.168.1.1, got %q", ip)
	}
}

func TestCalculateNetwork_SingleRouter_ConnectedNodesGetSubnetIPs(t *testing.T) {
	skipWithoutIPAM(t)
	tx := testTx(t)
	svc := NewIPService(tx)
	buildID := newBuildID(t, tx)

	router := createNode(t, tx, buildID, "router", "Router", "192.168.1.1")
	sw := createNode(t, tx, buildID, "switch", "Switch", "")
	server := createNode(t, tx, buildID, "server", "Server", "")

	connectNodes(t, tx, buildID, router.ID, sw.ID)
	connectNodes(t, tx, buildID, sw.ID, server.ID)

	if err := svc.CalculateNetwork(buildID); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	swIP := fetchIP(t, tx, sw.ID)
	serverIP := fetchIP(t, tx, server.ID)

	if swIP == "" {
		t.Error("switch should have an IP, got empty")
	}
	if serverIP == "" {
		t.Error("server should have an IP, got empty")
	}
	if swIP == serverIP {
		t.Errorf("switch and server must not share IP %q", swIP)
	}
	if swIP != "192.168.1.10" {
		t.Errorf("switch expected 192.168.1.10, got %q", swIP)
	}
	if serverIP != "192.168.1.100" {
		t.Errorf("server expected 192.168.1.100, got %q", serverIP)
	}
}

func TestCalculateNetwork_OrphanNodes_GetNoIP(t *testing.T) {
	skipWithoutIPAM(t)
	tx := testTx(t)
	svc := NewIPService(tx)
	buildID := newBuildID(t, tx)

	router := createNode(t, tx, buildID, "router", "Router", "192.168.1.1")
	connected := createNode(t, tx, buildID, "switch", "Connected Switch", "")
	orphan := createNode(t, tx, buildID, "server", "Orphan Server", "")

	connectNodes(t, tx, buildID, router.ID, connected.ID)

	if err := svc.CalculateNetwork(buildID); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ip := fetchIP(t, tx, connected.ID); ip == "" {
		t.Error("connected switch should have an IP")
	}
	if ip := fetchIP(t, tx, orphan.ID); ip != "" {
		t.Errorf("orphan server should have no IP, got %q", ip)
	}
}

func TestCalculateNetwork_TwoRouters_IndependentSubnets(t *testing.T) {
	skipWithoutIPAM(t)
	tx := testTx(t)
	svc := NewIPService(tx)
	buildID := newBuildID(t, tx)

	routerA := createNode(t, tx, buildID, "router", "Router A", "192.168.0.1")
	swA := createNode(t, tx, buildID, "switch", "Switch A", "")
	routerB := createNode(t, tx, buildID, "router", "Router B", "192.168.2.1")
	swB := createNode(t, tx, buildID, "switch", "Switch B", "")

	connectNodes(t, tx, buildID, routerA.ID, swA.ID)
	connectNodes(t, tx, buildID, routerB.ID, swB.ID)

	if err := svc.CalculateNetwork(buildID); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ipA := fetchIP(t, tx, swA.ID)
	ipB := fetchIP(t, tx, swB.ID)

	if ipA != "192.168.0.10" {
		t.Errorf("Switch A expected 192.168.0.10, got %q", ipA)
	}
	if ipB != "192.168.2.10" {
		t.Errorf("Switch B expected 192.168.2.10, got %q", ipB)
	}
}

func TestCalculateNetwork_RouterIPPreserved(t *testing.T) {
	skipWithoutIPAM(t)
	tx := testTx(t)
	svc := NewIPService(tx)
	buildID := newBuildID(t, tx)

	router := createNode(t, tx, buildID, "router", "Router", "10.0.0.1")
	sw := createNode(t, tx, buildID, "switch", "Switch", "")
	connectNodes(t, tx, buildID, router.ID, sw.ID)

	if err := svc.CalculateNetwork(buildID); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ip := fetchIP(t, tx, router.ID); ip != "10.0.0.1" {
		t.Errorf("router IP should remain 10.0.0.1, got %q", ip)
	}
	if swIP := fetchIP(t, tx, sw.ID); !hasPrefix(swIP, "10.0.0.") {
		t.Errorf("switch should be in 10.0.0.x, got %q", swIP)
	}
}

func TestCalculateNetwork_NonNetworkTypes_SkipIP(t *testing.T) {
	skipWithoutIPAM(t)
	tx := testTx(t)
	svc := NewIPService(tx)
	buildID := newBuildID(t, tx)

	router := createNode(t, tx, buildID, "router", "Router", "192.168.1.1")
	gpu := createNode(t, tx, buildID, "gpu", "GPU", "")
	disk := createNode(t, tx, buildID, "disk", "Disk", "")

	connectNodes(t, tx, buildID, router.ID, gpu.ID)
	connectNodes(t, tx, buildID, router.ID, disk.ID)

	if err := svc.CalculateNetwork(buildID); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ip := fetchIP(t, tx, gpu.ID); ip != "" {
		t.Errorf("GPU should never get an IP, got %q", ip)
	}
	if ip := fetchIP(t, tx, disk.ID); ip != "" {
		t.Errorf("Disk should never get an IP, got %q", ip)
	}
}

func TestCalculateNetwork_VMsGetSubnetIPs(t *testing.T) {
	skipWithoutIPAM(t)
	tx := testTx(t)
	svc := NewIPService(tx)
	buildID := newBuildID(t, tx)

	router := createNode(t, tx, buildID, "router", "Router", "192.168.1.1")
	server := createNode(t, tx, buildID, "server", "Server", "")

	vm := models.VirtualMachine{
		NodeID: server.ID,
		Name:   "nginx",
		Type:   "container",
		Status: "stopped",
	}
	if err := tx.Create(&vm).Error; err != nil {
		t.Fatalf("create vm: %v", err)
	}

	connectNodes(t, tx, buildID, router.ID, server.ID)

	if err := svc.CalculateNetwork(buildID); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	serverIP := fetchIP(t, tx, server.ID)
	if serverIP == "" {
		t.Fatal("server should have an IP")
	}

	var updatedVM models.VirtualMachine
	if err := tx.First(&updatedVM, "id = ?", vm.ID).Error; err != nil {
		t.Fatalf("reload vm: %v", err)
	}
	if !hasPrefix(updatedVM.IP, "192.168.1.") {
		t.Errorf("VM should be in 192.168.1.x, got %q (server has %q)", updatedVM.IP, serverIP)
	}
	if updatedVM.IP == serverIP {
		t.Errorf("VM must not share IP %q with its host", serverIP)
	}
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

func hasPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}

// ─── Rack node tests ──────────────────────────────────────────────────────────

func TestCalculateNetwork_RackNode_SkippedForIP(t *testing.T) {
	skipWithoutIPAM(t)
	tx := testTx(t)
	svc := NewIPService(tx)
	buildID := newBuildID(t, tx)

	router := createNode(t, tx, buildID, "router", "Router", "192.168.1.1")
	rack := createNode(t, tx, buildID, "rack", "Main Rack", "")

	connectNodes(t, tx, buildID, router.ID, rack.ID)

	if err := svc.CalculateNetwork(buildID); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ip := fetchIP(t, tx, rack.ID); ip != "" {
		t.Errorf("rack should never get an IP, got %q", ip)
	}
}

func TestCalculateNetwork_DeviceInsideRack_GetsIP(t *testing.T) {
	skipWithoutIPAM(t)
	tx := testTx(t)
	svc := NewIPService(tx)
	buildID := newBuildID(t, tx)

	router := createNode(t, tx, buildID, "router", "Router", "192.168.1.1")
	// Create a switch that is "inside" a rack — it has a parent_id on the model
	// but for IP assignment, parent_id doesn't matter; connectivity (edges) does
	sw := createNode(t, tx, buildID, "switch", "Rack Switch", "")
	rack := createNode(t, tx, buildID, "rack", "Main Rack", "")
	// Set the switch's parent to the rack
	sw.ParentID = &rack.ID
	if err := tx.Save(&sw).Error; err != nil {
		t.Fatalf("set parent_id: %v", err)
	}

	// Connect the switch directly to the router (through the rack logically)
	connectNodes(t, tx, buildID, router.ID, sw.ID)

	if err := svc.CalculateNetwork(buildID); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ip := fetchIP(t, tx, sw.ID); ip == "" {
		t.Error("switch inside rack should have an IP")
	}
	if ip := fetchIP(t, tx, rack.ID); ip != "" {
		t.Errorf("rack should never get an IP, got %q", ip)
	}
}
