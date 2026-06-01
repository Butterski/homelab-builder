package services

import (
	"encoding/json"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

func TestHardwareBlueprintService_CreateListsPrivateBlueprintForOwnerOnly(t *testing.T) {
	tx := testTx(t)
	svc := NewHardwareBlueprintService(tx)
	owner := models.User{Email: "blueprint_owner@example.com", GoogleID: "blueprint-owner", Name: "Owner"}
	other := models.User{Email: "blueprint_other@example.com", GoogleID: "blueprint-other", Name: "Other"}
	if err := tx.Create(&owner).Error; err != nil {
		t.Fatalf("failed to create owner: %v", err)
	}
	if err := tx.Create(&other).Error; err != nil {
		t.Fatalf("failed to create other user: %v", err)
	}

	created, err := svc.Create(owner.ID, HardwareBlueprintInput{
		Name:     "N100 Lab Box",
		Category: "mini pcs",
		Tags:     json.RawMessage(`["quiet","useful"]`),
		NodeData: json.RawMessage(`{"details":{"cpu":4,"ram":16}}`),
		Services: json.RawMessage(`[]`),
	})
	if err != nil {
		t.Fatalf("failed to create blueprint: %v", err)
	}
	if created.Category != "minipc" {
		t.Fatalf("expected normalized category minipc, got %s", created.Category)
	}
	if created.NodeType != "minipc" {
		t.Fatalf("expected node type minipc, got %s", created.NodeType)
	}
	if created.Visibility != BlueprintVisibilityPrivate {
		t.Fatalf("expected private visibility, got %s", created.Visibility)
	}

	mine, err := svc.ListMine(owner.ID)
	if err != nil {
		t.Fatalf("failed to list owner blueprints: %v", err)
	}
	if len(mine) != 1 || mine[0].ID != created.ID {
		t.Fatalf("expected owner to see one blueprint, got %+v", mine)
	}

	others, err := svc.ListMine(other.ID)
	if err != nil {
		t.Fatalf("failed to list other blueprints: %v", err)
	}
	if len(others) != 0 {
		t.Fatalf("expected other user to see no private blueprints, got %d", len(others))
	}
}

func TestHardwareBlueprintService_SubmitAndAdminPublish(t *testing.T) {
	tx := testTx(t)
	svc := NewHardwareBlueprintService(tx)
	user := models.User{Email: "blueprint_submit@example.com", GoogleID: "blueprint-submit", Name: "Owner"}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	created, err := svc.Create(user.ID, HardwareBlueprintInput{
		Name:     "NAS Build",
		Category: "nas",
		NodeData: json.RawMessage(`{"details":{"storage":4096}}`),
	})
	if err != nil {
		t.Fatalf("failed to create blueprint: %v", err)
	}

	submitted, err := svc.SubmitToCommunity(user.ID, created.ID)
	if err != nil {
		t.Fatalf("failed to submit blueprint: %v", err)
	}
	if submitted.Visibility != BlueprintVisibilityPending {
		t.Fatalf("expected pending visibility, got %s", submitted.Visibility)
	}
	if submitted.ModerationStatus != BlueprintModerationPending {
		t.Fatalf("expected pending moderation status, got %s", submitted.ModerationStatus)
	}

	pending, err := svc.ListPending()
	if err != nil {
		t.Fatalf("failed to list pending: %v", err)
	}
	if len(pending) != 1 || pending[0].ID != created.ID {
		t.Fatalf("expected submitted blueprint in pending list, got %+v", pending)
	}

	published, err := svc.SetVisibility(created.ID, BlueprintVisibilityCommunity)
	if err != nil {
		t.Fatalf("failed to publish blueprint: %v", err)
	}
	if published.Visibility != BlueprintVisibilityCommunity {
		t.Fatalf("expected community visibility, got %s", published.Visibility)
	}

	community, err := svc.ListCommunity()
	if err != nil {
		t.Fatalf("failed to list community: %v", err)
	}
	if len(community) != 1 || community[0].ID != created.ID {
		t.Fatalf("expected published blueprint in community list, got %+v", community)
	}
}

func TestHardwareBlueprintService_ModerateApproveAndReject(t *testing.T) {
	tx := testTx(t)
	svc := NewHardwareBlueprintService(tx)
	owner := models.User{Email: "blueprint_mod_owner@example.com", GoogleID: "blueprint-mod-owner", Name: "Owner"}
	reviewer := models.User{Email: "blueprint_mod_admin@example.com", GoogleID: "blueprint-mod-admin", Name: "Admin", IsAdmin: true}
	if err := tx.Create(&owner).Error; err != nil {
		t.Fatalf("failed to create owner: %v", err)
	}
	if err := tx.Create(&reviewer).Error; err != nil {
		t.Fatalf("failed to create reviewer: %v", err)
	}

	created, err := svc.Create(owner.ID, HardwareBlueprintInput{Name: "Review Me", Category: "server"})
	if err != nil {
		t.Fatalf("failed to create blueprint: %v", err)
	}
	if _, err := svc.SubmitToCommunity(owner.ID, created.ID); err != nil {
		t.Fatalf("failed to submit blueprint: %v", err)
	}

	approved, err := svc.Moderate(created.ID, reviewer.ID, HardwareBlueprintModerationInput{Action: "approve", Note: "Looks complete"})
	if err != nil {
		t.Fatalf("failed to approve blueprint: %v", err)
	}
	if approved.Visibility != BlueprintVisibilityCommunity || approved.ModerationStatus != BlueprintModerationApproved {
		t.Fatalf("expected approved community blueprint, got %+v", approved)
	}
	if approved.ReviewedBy == nil || *approved.ReviewedBy != reviewer.ID || approved.ReviewedAt == nil {
		t.Fatalf("expected reviewer metadata, got %+v", approved)
	}

	rejected, err := svc.Moderate(created.ID, reviewer.ID, HardwareBlueprintModerationInput{Action: "reject", Note: "Needs photos"})
	if err != nil {
		t.Fatalf("failed to reject blueprint: %v", err)
	}
	if rejected.Visibility != BlueprintVisibilityPrivate || rejected.ModerationStatus != BlueprintModerationRejected {
		t.Fatalf("expected rejected private blueprint, got %+v", rejected)
	}
	if rejected.ModerationNote != "Needs photos" {
		t.Fatalf("expected moderation note to be saved, got %q", rejected.ModerationNote)
	}
}

func TestHardwareBlueprintService_VoteRecalculatesCounts(t *testing.T) {
	tx := testTx(t)
	svc := NewHardwareBlueprintService(tx)
	owner := models.User{Email: "blueprint_vote_owner@example.com", GoogleID: "blueprint-vote-owner", Name: "Owner"}
	upvoter := models.User{Email: "blueprint_vote_up@example.com", GoogleID: "blueprint-vote-up", Name: "Up"}
	downvoter := models.User{Email: "blueprint_vote_down@example.com", GoogleID: "blueprint-vote-down", Name: "Down"}
	if err := tx.Create(&owner).Error; err != nil {
		t.Fatalf("failed to create owner: %v", err)
	}
	if err := tx.Create(&upvoter).Error; err != nil {
		t.Fatalf("failed to create upvoter: %v", err)
	}
	if err := tx.Create(&downvoter).Error; err != nil {
		t.Fatalf("failed to create downvoter: %v", err)
	}

	created, err := svc.Create(owner.ID, HardwareBlueprintInput{Name: "Firewall", Category: "router"})
	if err != nil {
		t.Fatalf("failed to create blueprint: %v", err)
	}
	if _, err := svc.Vote(upvoter.ID, created.ID, 1); err != nil {
		t.Fatalf("failed to upvote: %v", err)
	}
	voted, err := svc.Vote(downvoter.ID, created.ID, -1)
	if err != nil {
		t.Fatalf("failed to downvote: %v", err)
	}
	if voted.Upvotes != 1 || voted.Downvotes != 1 {
		t.Fatalf("expected 1 upvote and 1 downvote, got %+v", voted)
	}

	changed, err := svc.Vote(downvoter.ID, created.ID, 1)
	if err != nil {
		t.Fatalf("failed to change vote: %v", err)
	}
	if changed.Upvotes != 2 || changed.Downvotes != 0 {
		t.Fatalf("expected changed vote to recalc to 2/0, got %+v", changed)
	}
}

func TestHardwareBlueprintService_ReviewUpsertsStructuredTags(t *testing.T) {
	tx := testTx(t)
	svc := NewHardwareBlueprintService(tx)
	user := models.User{Email: "blueprint_review@example.com", GoogleID: "blueprint-review", Name: "Reviewer"}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("failed to create user: %v", err)
	}
	created, err := svc.Create(user.ID, HardwareBlueprintInput{Name: "Media Box", Category: "minipc"})
	if err != nil {
		t.Fatalf("failed to create blueprint: %v", err)
	}

	review, err := svc.Review(user.ID, created.ID, HardwareBlueprintReviewInput{
		UseCase:         "media",
		Stability:       "good",
		Noise:           "quiet",
		Power:           "low",
		WouldBuildAgain: true,
		Tags:            json.RawMessage(`["useful","fun"]`),
	})
	if err != nil {
		t.Fatalf("failed to save review: %v", err)
	}

	updated, err := svc.Review(user.ID, created.ID, HardwareBlueprintReviewInput{
		UseCase:   "storage",
		Stability: "okay",
		Tags:      json.RawMessage(`["cheap"]`),
	})
	if err != nil {
		t.Fatalf("failed to update review: %v", err)
	}
	if updated.ID != review.ID {
		t.Fatalf("expected review upsert to preserve ID")
	}
	if updated.UseCase != "storage" || updated.Stability != "okay" {
		t.Fatalf("expected updated structured review, got %+v", updated)
	}
}

func TestHardwareBlueprintService_FitScoreExtractsCapacityDemandAndComponents(t *testing.T) {
	tx := testTx(t)
	svc := NewHardwareBlueprintService(tx)
	user := models.User{Email: "blueprint_fit@example.com", GoogleID: "blueprint-fit", Name: "Owner"}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	created, err := svc.Create(user.ID, HardwareBlueprintInput{
		Name:     "Media Workhorse",
		Category: "minipc",
		NodeData: json.RawMessage(`{
			"details":{"cpu":"2x 4-core","ram":"32GB","storage":"512GB","ports":"4x GbE","port_speed":"2.5GbE","drive_bays":2},
			"power_draw":35,
			"internal_components":[
				{"type":"disk","name":"Media Pool","power_draw":6,"details":{"storage":"2x 2TB"}},
				{"type":"gpu","name":"Arc A310","power_draw":35,"details":{"ram":"6GB"}}
			]
		}`),
		Services: json.RawMessage(`[
			{"name":"Jellyfin","category":"media","requirements":{"recommended_cpu_cores":2,"recommended_ram_mb":2048,"recommended_storage_gb":20}},
			{"name":"WireGuard","category":"networking","requirements":{"recommended_cpu_cores":1,"recommended_ram_mb":256,"recommended_storage_gb":2}}
		]`),
	})
	if err != nil {
		t.Fatalf("failed to create blueprint: %v", err)
	}
	if created.Fit == nil {
		t.Fatalf("expected create response to include fit")
	}

	fit := created.Fit
	if fit.Capacity.CPUCores != 8 {
		t.Fatalf("expected 8 CPU cores parsed from 2x 4-core, got %.1f", fit.Capacity.CPUCores)
	}
	if fit.Capacity.RAMGB != 32 {
		t.Fatalf("expected 32GB RAM, got %.1f", fit.Capacity.RAMGB)
	}
	if fit.Capacity.StorageGB != 4608 {
		t.Fatalf("expected base storage plus disks to equal 4608GB, got %.1f", fit.Capacity.StorageGB)
	}
	if fit.Capacity.Disks != 1 || fit.Capacity.GPUs != 1 {
		t.Fatalf("expected one disk and one GPU, got %+v", fit.Capacity)
	}
	if fit.Capacity.NetworkGbps != 10 || fit.Capacity.DriveBays != 2 {
		t.Fatalf("expected network and drive bay capacity, got %+v", fit.Capacity)
	}
	if fit.Demand.CPUCores != 3 {
		t.Fatalf("expected service CPU demand of 3 cores, got %.1f", fit.Demand.CPUCores)
	}
	if fit.Demand.RAMGB <= 2.1 || fit.Demand.StorageGB != 22 {
		t.Fatalf("expected service demand to include RAM/storage, got %+v", fit.Demand)
	}
	if fit.Score < 70 || fit.Grade == "" || len(fit.Factors) < 6 {
		t.Fatalf("expected useful fit result, got %+v", fit)
	}
}

func TestHardwareBlueprintService_ExportShareCodeAndImport(t *testing.T) {
	tx := testTx(t)
	svc := NewHardwareBlueprintService(tx)
	owner := models.User{Email: "blueprint_export_owner@example.com", GoogleID: "blueprint-export-owner", Name: "Owner"}
	friend := models.User{Email: "blueprint_export_friend@example.com", GoogleID: "blueprint-export-friend", Name: "Friend"}
	if err := tx.Create(&owner).Error; err != nil {
		t.Fatalf("failed to create owner: %v", err)
	}
	if err := tx.Create(&friend).Error; err != nil {
		t.Fatalf("failed to create friend: %v", err)
	}

	created, err := svc.Create(owner.ID, HardwareBlueprintInput{
		Name:     "Shareable NAS",
		Category: "nas",
		Tags:     json.RawMessage(`["storage"]`),
		NodeData: json.RawMessage(`{"details":{"storage":"4TB"},"internal_components":[{"type":"disk","name":"Disk","details":{"storage":"4TB"}}]}`),
		Services: json.RawMessage(`[]`),
	})
	if err != nil {
		t.Fatalf("failed to create blueprint: %v", err)
	}

	exported, err := svc.Export(owner.ID, created.ID)
	if err != nil {
		t.Fatalf("failed to export blueprint: %v", err)
	}
	if exported.Kind != hardwareBlueprintExportKind || exported.Version != 1 || exported.ShareCode == "" {
		t.Fatalf("expected export metadata and share code, got %+v", exported)
	}

	importedFromCode, err := svc.Import(friend.ID, HardwareBlueprintImportInput{ImportCode: exported.ShareCode})
	if err != nil {
		t.Fatalf("failed to import by code: %v", err)
	}
	if importedFromCode.UserID != friend.ID || importedFromCode.Visibility != BlueprintVisibilityPrivate {
		t.Fatalf("expected private clone owned by friend, got %+v", importedFromCode)
	}
	if importedFromCode.ShareCode != nil {
		t.Fatalf("expected imported clone not to reuse share code")
	}

	importedFromJSON, err := svc.Import(friend.ID, HardwareBlueprintImportInput{Blueprint: exported})
	if err != nil {
		t.Fatalf("failed to import by JSON: %v", err)
	}
	if importedFromJSON.Name != "Shareable NAS (Imported)" {
		t.Fatalf("expected imported suffix, got %q", importedFromJSON.Name)
	}
}

func TestHardwareBlueprintService_FitScorePenalizesOverloadedServiceStack(t *testing.T) {
	tx := testTx(t)
	svc := NewHardwareBlueprintService(tx)
	user := models.User{Email: "blueprint_overloaded@example.com", GoogleID: "blueprint-overloaded", Name: "Owner"}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	created, err := svc.Create(user.ID, HardwareBlueprintInput{
		Name:     "Tiny Box",
		Category: "minipc",
		NodeData: json.RawMessage(`{"details":{"cpu":1,"ram":1,"storage":16,"ports":1},"power_draw":8}`),
		Services: json.RawMessage(`[
			{"name":"Heavy AI","category":"management","requirements":{"recommended_cpu_cores":8,"recommended_ram_mb":16384,"recommended_storage_gb":80}}
		]`),
	})
	if err != nil {
		t.Fatalf("failed to create blueprint: %v", err)
	}
	if created.Fit == nil {
		t.Fatalf("expected fit")
	}
	if created.Fit.Score > 58 || created.Fit.Grade != "risky" {
		t.Fatalf("expected overloaded blueprint to be risky, got %+v", created.Fit)
	}
	if created.Fit.Utilization.CPU <= 1 || created.Fit.Utilization.RAM <= 1 || created.Fit.Utilization.Storage <= 1 {
		t.Fatalf("expected overloaded utilization, got %+v", created.Fit.Utilization)
	}
}

func TestHardwareBlueprintService_FitScoreUsesSavedLabShape(t *testing.T) {
	tx := testTx(t)
	svc := NewHardwareBlueprintService(tx)
	user := models.User{Email: "blueprint_lab_fit@example.com", GoogleID: "blueprint-lab-fit", Name: "Owner"}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("failed to create user: %v", err)
	}
	build := models.Build{ID: uuid.New(), UserID: user.ID, Name: "Current Lab"}
	if err := tx.Create(&build).Error; err != nil {
		t.Fatalf("failed to create build: %v", err)
	}
	details := json.RawMessage(`{"cpu":2,"ram":8,"storage":128,"ports":1}`)
	node := models.Node{ID: uuid.New(), BuildID: build.ID, Type: "minipc", Name: "Existing Mini", Details: details, PowerDraw: 12}
	if err := tx.Create(&node).Error; err != nil {
		t.Fatalf("failed to create node: %v", err)
	}

	created, err := svc.Create(user.ID, HardwareBlueprintInput{
		Name:     "Storage Shelf",
		Category: "nas",
		NodeData: json.RawMessage(`{
			"details":{"cpu":4,"ram":16,"storage":"512GB","ports":2},
			"internal_components":[{"type":"disk","name":"Array","details":{"storage":"4x 4TB"}}]
		}`),
	})
	if err != nil {
		t.Fatalf("failed to create blueprint: %v", err)
	}
	if created.Fit == nil {
		t.Fatalf("expected fit")
	}
	factor := findFitFactor(created.Fit.Factors, "lab_gap")
	if factor == nil {
		t.Fatalf("expected lab gap factor, got %+v", created.Fit.Factors)
	}
	if factor.Score < 88 {
		t.Fatalf("expected NAS to score as a strong lab gap fit for storage-poor lab, got %+v", factor)
	}
}

func findFitFactor(factors []models.HardwareBlueprintFitFactor, key string) *models.HardwareBlueprintFitFactor {
	for i := range factors {
		if factors[i].Key == key {
			return &factors[i]
		}
	}
	return nil
}
