package services

import (
	"errors"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/version"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func whatsNewUser(t *testing.T, tx *gorm.DB) models.User {
	t.Helper()
	user := models.User{Email: uuid.NewString() + "@news.test", GoogleID: uuid.NewString()}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return user
}

func TestWhatsNew_NewAccountHasSeenTheRunningRelease(t *testing.T) {
	tx := testTx(t)
	svc := NewWhatsNewService(tx)
	user := whatsNewUser(t, tx)
	state, err := svc.Get(user.ID)
	if err != nil || state.Seen != version.Version || len(state.Notices) != 0 {
		t.Fatalf("new account: %+v, %v", state, err)
	}
}

func TestWhatsNew_MarkSeen(t *testing.T) {
	tx := testTx(t)
	svc := NewWhatsNewService(tx)
	user, other := whatsNewUser(t, tx), whatsNewUser(t, tx)
	// An account from before the dialog existed.
	if err := tx.Model(&user).UpdateColumn("whats_new_seen", "").Error; err != nil {
		t.Fatalf("reset seen: %v", err)
	}
	for _, owner := range []models.User{user, other} {
		notice := models.UserNotice{UserID: owner.ID, BuildID: uuid.New(), BuildName: "Lab", Kind: NoticePowerCables, Version: "1.4.0", Details: []byte(`{}`)}
		if err := tx.Create(&notice).Error; err != nil {
			t.Fatalf("create notice: %v", err)
		}
	}

	for _, bad := range []string{"1.4", "v1.4.0", "1.04.0", "1.4.0-rc1", ""} {
		if err := svc.MarkSeen(user.ID, bad); !errors.Is(err, ErrInvalidVersion) {
			t.Fatalf("MarkSeen(%q): %v", bad, err)
		}
	}
	if err := svc.MarkSeen(user.ID, "1.10.0"); err != nil {
		t.Fatalf("mark seen: %v", err)
	}
	// A tab still on an older release does not take it back.
	if err := svc.MarkSeen(user.ID, "1.9.3"); err != nil {
		t.Fatalf("mark older seen: %v", err)
	}
	state, err := svc.Get(user.ID)
	if err != nil || state.Seen != "1.10.0" || len(state.Notices) != 1 || state.Notices[0].SeenAt == nil {
		t.Fatalf("after seen: %+v, %v", state, err)
	}
	// A build id that is no build of the account offers nothing to open.
	if state.Notices[0].BuildID != nil || state.Notices[0].BuildName != "Lab" {
		t.Fatalf("notice without its build: %+v", state.Notices[0])
	}
	otherState, err := svc.Get(other.ID)
	if err != nil || len(otherState.Notices) != 1 || otherState.Notices[0].SeenAt != nil {
		t.Fatalf("another account's notice changed: %+v, %v", otherState, err)
	}
}
