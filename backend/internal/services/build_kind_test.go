package services

import (
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/gaming"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

func newKindTestUser(t *testing.T) (*BuildService, models.User) {
	t.Helper()
	tx := testTx(t)
	user := models.User{Email: uuid.NewString() + "@kind.test", GoogleID: uuid.NewString()}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return NewBuildService(tx), user
}

func partyPlan() *gaming.Plan {
	return &gaming.Plan{
		Uplink: gaming.Uplink{DownMbps: 500, UpMbps: 50, CGNAT: "no", PublicHost: "lan.example.org"},
		Power:  gaming.Power{MainsVoltage: 230, Circuits: []gaming.Circuit{{ID: "c1", Label: "Hall", BreakerAmps: 16}}},
		Event:  gaming.Event{Date: "2026-11-14", Hours: 24},
	}
}

func TestBuildService_KindAndPlanRoundTrip(t *testing.T) {
	svc, user := newKindTestUser(t)

	plain, err := svc.Create(user.ID, SyncGraphInput{Name: "Lab"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if plain.Kind != string(gaming.KindHomelab) {
		t.Fatalf("a build without a kind should be a homelab, got %q", plain.Kind)
	}

	party, err := svc.Create(user.ID, SyncGraphInput{Name: "Party", Kind: "lan_party", GamingPlan: partyPlan()})
	if err != nil {
		t.Fatalf("create party: %v", err)
	}
	if party.Kind != "lan_party" {
		t.Fatalf("expected lan_party, got %q", party.Kind)
	}
	stored, err := gaming.ParsePlan(party.GamingPlan)
	if err != nil {
		t.Fatalf("parse stored plan: %v", err)
	}
	if stored.Uplink.UpMbps != 50 || stored.Power.Circuits[0].Label != "Hall" || stored.Event.Hours != 24 {
		t.Fatalf("plan was not stored: %+v", stored)
	}

	// What the server returns is exactly what a second save would store.
	again, err := svc.Update(party.ID, user.ID, SyncGraphInput{Name: "Party", Revision: party.Revision, Kind: "lan_party", GamingPlan: &stored})
	if err != nil {
		t.Fatalf("save again: %v", err)
	}
	var before, after any
	_ = json.Unmarshal(party.GamingPlan, &before)
	_ = json.Unmarshal(again.GamingPlan, &after)
	beforeJSON, _ := json.Marshal(before)
	afterJSON, _ := json.Marshal(after)
	if string(beforeJSON) != string(afterJSON) {
		t.Fatalf("plan changed on an unchanged save:\n%s\n%s", beforeJSON, afterJSON)
	}
}

func TestBuildService_EmptyKindAndNilPlanKeepStoredValues(t *testing.T) {
	svc, user := newKindTestUser(t)
	party, err := svc.Create(user.ID, SyncGraphInput{Name: "Party", Kind: "lan_party", GamingPlan: partyPlan()})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// A client that knows nothing about gaming builds sends neither field.
	saved, err := svc.Update(party.ID, user.ID, SyncGraphInput{
		Name: "Party", Revision: party.Revision,
		Nodes: []NodeDTO{{ID: uuid.NewString(), Type: "router", Name: "Router"}},
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if saved.Kind != "lan_party" {
		t.Fatalf("kind was wiped: %q", saved.Kind)
	}
	plan, _ := gaming.ParsePlan(saved.GamingPlan)
	if plan.Uplink.UpMbps != 50 || len(plan.Power.Circuits) != 1 {
		t.Fatalf("plan was wiped: %+v", plan)
	}

	// The kind can change later: adding a game server to a homelab is the usual way in.
	changed, err := svc.Update(party.ID, user.ID, SyncGraphInput{Name: "Party", Revision: saved.Revision, Kind: "game_server"})
	if err != nil {
		t.Fatalf("change kind: %v", err)
	}
	if changed.Kind != "game_server" || len(changed.Nodes) != 0 {
		t.Fatalf("expected the kind to change with the save, got %q", changed.Kind)
	}
}

func TestBuildService_RejectsUnknownKindAndInvalidPlan(t *testing.T) {
	svc, user := newKindTestUser(t)

	if _, err := svc.Create(user.ID, SyncGraphInput{Name: "X", Kind: "arcade"}); !errors.Is(err, ErrInvalidTopology) {
		t.Fatalf("expected an invalid topology error for an unknown kind, got %v", err)
	}

	build, err := svc.Create(user.ID, SyncGraphInput{Name: "X"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	bad := partyPlan()
	bad.Power.Circuits[0].BreakerAmps = 0
	if _, err := svc.Update(build.ID, user.ID, SyncGraphInput{Name: "X", Revision: build.Revision, GamingPlan: bad}); !errors.Is(err, ErrInvalidTopology) {
		t.Fatalf("expected an invalid topology error for a bad plan, got %v", err)
	}
	reloaded, _ := svc.GetByID(build.ID)
	if reloaded.Revision != build.Revision {
		t.Fatalf("a rejected save must not bump the revision")
	}
}

func TestBuildToSyncInput_KeepsKindAndPlan(t *testing.T) {
	svc, user := newKindTestUser(t)
	party, err := svc.Create(user.ID, SyncGraphInput{Name: "Party", Kind: "lan_party", GamingPlan: partyPlan()})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	input, err := BuildToSyncInput(party)
	if err != nil {
		t.Fatalf("BuildToSyncInput: %v", err)
	}
	if input.Kind != "lan_party" || input.GamingPlan == nil || input.GamingPlan.Uplink.PublicHost != "lan.example.org" {
		t.Fatalf("kind and plan must survive the snapshot a proposal is built on: %+v", input)
	}

	// The engine clones the snapshot through JSON before applying operations.
	clone, err := cloneSyncInput(input)
	if err != nil {
		t.Fatalf("clone: %v", err)
	}
	if clone.Kind != "lan_party" || clone.GamingPlan == nil || len(clone.GamingPlan.Power.Circuits) != 1 {
		t.Fatalf("clone lost the plan: %+v", clone)
	}
}

func TestBuildService_DuplicateKeepsKindAndPlan(t *testing.T) {
	svc, user := newKindTestUser(t)
	party, err := svc.Create(user.ID, SyncGraphInput{Name: "Party", Kind: "lan_party", GamingPlan: partyPlan()})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	dup, err := svc.Duplicate(party.ID, user.ID)
	if err != nil {
		t.Fatalf("duplicate: %v", err)
	}
	plan, _ := gaming.ParsePlan(dup.GamingPlan)
	if dup.Kind != "lan_party" || plan.Event.Date != "2026-11-14" {
		t.Fatalf("copy lost kind or plan: %q %+v", dup.Kind, plan)
	}
}

func TestBuildService_SharedReadHidesThePublicHost(t *testing.T) {
	svc, user := newKindTestUser(t)
	party, err := svc.Create(user.ID, SyncGraphInput{Name: "Party", Kind: "game_server", GamingPlan: partyPlan()})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	shared, err := svc.ShareBuild(party.ID, user.ID)
	if err != nil {
		t.Fatalf("share: %v", err)
	}

	public, err := svc.GetByShareToken(*shared.ShareToken)
	if err != nil {
		t.Fatalf("shared read: %v", err)
	}
	plan, _ := gaming.ParsePlan(public.GamingPlan)
	if plan.Uplink.PublicHost != "" {
		t.Fatalf("the shared view must not show where the owner lives on the internet, got %q", plan.Uplink.PublicHost)
	}
	if plan.Uplink.UpMbps != 50 || public.Kind != "game_server" {
		t.Fatalf("the rest of the plan should still be shared: %+v", plan)
	}

	// The owner still sees it, and the redaction is not written back.
	owned, _ := svc.GetByID(party.ID)
	ownPlan, _ := gaming.ParsePlan(owned.GamingPlan)
	if ownPlan.Uplink.PublicHost != "lan.example.org" {
		t.Fatalf("owner lost the public host: %+v", ownPlan)
	}
}

func TestBuildService_SharedSaveHidesThePublicHostAndKeepsThePlan(t *testing.T) {
	if os.Getenv("IPAM_URL") == "" {
		t.Skip("skipping: IPAM_URL not set (hlbIPAM not running)")
	}
	tx := testTx(t)
	svc := NewBuildService(tx)
	user := models.User{Email: uuid.NewString() + "@kind.test", GoogleID: uuid.NewString()}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	party, err := svc.Create(user.ID, SyncGraphInput{Name: "Party", Kind: "game_server", GamingPlan: partyPlan()})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := svc.ShareBuild(party.ID, user.ID); err != nil {
		t.Fatalf("share: %v", err)
	}
	shared, err := svc.SetShareEditable(party.ID, user.ID, true)
	if err != nil {
		t.Fatalf("allow editing: %v", err)
	}

	// Someone with the link saves, and sends a kind and a plan of their own along.
	theirs := partyPlan()
	theirs.Uplink.PublicHost = "elsewhere.example.org"
	theirs.Uplink.UpMbps = 1
	saved, err := svc.UpdateByShareToken(*shared.ShareToken, SyncGraphInput{
		Name: "Party", Revision: shared.Revision, Kind: "homelab", GamingPlan: theirs,
		Nodes: []NodeDTO{{ID: uuid.NewString(), Type: "router", Name: "Router", IP: "192.168.1.1"}},
	}, NewIPService(tx))
	if err != nil {
		t.Fatalf("shared save: %v", err)
	}
	if len(saved.Nodes) != 1 {
		t.Fatalf("the shared save should store the graph, got %d nodes", len(saved.Nodes))
	}
	answer, _ := gaming.ParsePlan(saved.GamingPlan)
	if answer.Uplink.PublicHost != "" {
		t.Fatalf("the answer to a shared save must not carry the owner's address, got %q", answer.Uplink.PublicHost)
	}

	// The kind and the plan are the owner's: a share link cannot change them.
	owned, _ := svc.GetByID(party.ID)
	ownPlan, _ := gaming.ParsePlan(owned.GamingPlan)
	if owned.Kind != "game_server" || ownPlan.Uplink.PublicHost != "lan.example.org" || ownPlan.Uplink.UpMbps != 50 {
		t.Fatalf("a shared save changed the owner's plan: %q %+v", owned.Kind, ownPlan.Uplink)
	}
}

func TestSeedExpandedDefaultServices_GameServersCarryTheirProfile(t *testing.T) {
	tx := testTx(t)
	if err := SeedExpandedDefaultServices(tx); err != nil {
		t.Fatalf("seed: %v", err)
	}

	catalog, err := NewServiceService(tx).GetAll()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	byID := map[string]models.Service{}
	for _, service := range catalog {
		byID[service.ID.String()] = service
	}

	for _, profile := range gaming.Profiles() {
		service, ok := byID[profile.ServiceID]
		if !ok {
			t.Errorf("%s is not in the public catalog", profile.Name)
			continue
		}
		if service.Category != "gaming" {
			t.Errorf("%s: category %q", profile.Name, service.Category)
		}
		if service.Game == nil || service.Game.Slug != profile.Slug {
			t.Errorf("%s: the profile is not attached to the catalog entry", profile.Name)
		}
		if service.Requirements == nil || service.Requirements.RecommendedRAMMB < service.Requirements.MinRAMMB || service.Requirements.MinRAMMB < 512 {
			t.Errorf("%s: requirements %+v", profile.Name, service.Requirements)
		}
	}

	// Ordinary services have no profile.
	jellyfin := byID["a1000000-0000-0000-0000-000000000002"]
	if jellyfin.Name != "Jellyfin" || jellyfin.Game != nil {
		t.Errorf("Jellyfin should be seeded without a game profile: %+v", jellyfin)
	}
}
