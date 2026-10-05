package services

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

func TestAPIToken_CreateStoresOnlyAHash(t *testing.T) {
	tx := testTx(t)
	svc := NewAPITokenService(tx)
	user := newTestUser(t, tx)

	plaintext, token, err := svc.Create(user.ID, CreateTokenInput{Name: "  Claude Code  ", Scope: "PROPOSE"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !strings.HasPrefix(plaintext, APITokenPrefix) || len(plaintext) != len(APITokenPrefix)+tokenBodyLength {
		t.Fatalf("unexpected token shape: %d characters", len(plaintext))
	}
	if token.Name != "Claude Code" || token.Scope != TokenScopePropose || token.Prefix != plaintext[:tokenDisplayLength] {
		t.Fatalf("unexpected token record: %+v", token)
	}

	var stored models.APIToken
	if err := tx.First(&stored, "id = ?", token.ID).Error; err != nil {
		t.Fatalf("load: %v", err)
	}
	if stored.TokenHash != HashAPIToken(plaintext) || len(stored.TokenHash) != 64 {
		t.Fatal("the stored value must be the SHA-256 of the token")
	}
	var leaked int64
	tx.Raw(`SELECT count(*) FROM api_tokens WHERE id = ? AND (token_hash LIKE ? OR name LIKE ? OR prefix = ?)`,
		token.ID, "%"+plaintext[tokenDisplayLength:]+"%", "%"+plaintext+"%", plaintext).Scan(&leaked)
	if leaked != 0 {
		t.Fatal("the plaintext token must never be stored")
	}

	other, _, err := svc.Create(user.ID, CreateTokenInput{Name: "Second", Scope: TokenScopeRead})
	if err != nil || other == plaintext {
		t.Fatalf("tokens must be unique: %v", err)
	}
}

func TestAPIToken_AuthenticateRevokeAndExpiry(t *testing.T) {
	tx := testTx(t)
	svc := NewAPITokenService(tx)
	user := newTestUser(t, tx)
	plaintext, token, err := svc.Create(user.ID, CreateTokenInput{Name: "Cursor", Scope: TokenScopeRead})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	authenticated, err := svc.Authenticate(plaintext, "10.0.0.7")
	if err != nil {
		t.Fatalf("authenticate: %v", err)
	}
	if authenticated.ID != token.ID || authenticated.UserID != user.ID || authenticated.Scope != TokenScopeRead {
		t.Fatalf("unexpected token: %+v", authenticated)
	}
	var stored models.APIToken
	tx.First(&stored, "id = ?", token.ID)
	if stored.LastUsedAt == nil || stored.LastUsedIP != "10.0.0.7" {
		t.Fatalf("last use not recorded: %+v", stored)
	}
	// A second call inside the write interval keeps the first record.
	if _, err := svc.Authenticate(plaintext, "10.0.0.8"); err != nil {
		t.Fatalf("authenticate again: %v", err)
	}
	tx.First(&stored, "id = ?", token.ID)
	if stored.LastUsedIP != "10.0.0.7" {
		t.Fatalf("last use should be written at most once a minute, got %s", stored.LastUsedIP)
	}

	malformed := []string{"", "hlb_", "hlb_short", strings.Repeat("x", len(plaintext)), plaintext + "x", "Bearer " + plaintext,
		APITokenPrefix + strings.Repeat("A", tokenBodyLength)}
	for _, candidate := range malformed {
		if _, err := svc.Authenticate(candidate, ""); !errors.Is(err, ErrTokenInvalid) {
			t.Errorf("Authenticate(%q) = %v, want ErrTokenInvalid", candidate, err)
		}
	}

	if err := tx.Model(&models.APIToken{}).Where("id = ?", token.ID).Update("expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatalf("expire: %v", err)
	}
	if _, err := svc.Authenticate(plaintext, ""); !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("expired token must be refused, got %v", err)
	}
	tx.Model(&models.APIToken{}).Where("id = ?", token.ID).Update("expires_at", time.Now().Add(time.Hour))
	if _, err := svc.Authenticate(plaintext, ""); err != nil {
		t.Fatalf("unexpired token: %v", err)
	}

	if err := svc.Revoke(uuid.New(), token.ID); !errors.Is(err, ErrTokenNotFound) {
		t.Fatalf("another user must not revoke the token, got %v", err)
	}
	if err := svc.Revoke(user.ID, token.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, err := svc.Authenticate(plaintext, ""); !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("revoked token must be refused, got %v", err)
	}
	if err := svc.Revoke(user.ID, token.ID); !errors.Is(err, ErrTokenNotFound) {
		t.Fatalf("second revoke: %v", err)
	}
}

func TestAPIToken_InputRulesAndLimit(t *testing.T) {
	tx := testTx(t)
	svc := NewAPITokenService(tx)
	user := newTestUser(t, tx)
	days := func(n int) *int { return &n }

	invalid := []CreateTokenInput{
		{Name: "", Scope: TokenScopeRead},
		{Name: strings.Repeat("n", maxTokenNameLength+1), Scope: TokenScopeRead},
		{Name: "x", Scope: "admin"},
		{Name: "x", Scope: TokenScopeRead, ExpiresInDays: days(0)},
		{Name: "x", Scope: TokenScopeRead, ExpiresInDays: days(maxTokenLifetime + 1)},
	}
	for _, input := range invalid {
		if _, _, err := svc.Create(user.ID, input); !errors.Is(err, ErrTokenInput) {
			t.Errorf("Create(%+v) = %v, want ErrTokenInput", input, err)
		}
	}

	_, expiring, err := svc.Create(user.ID, CreateTokenInput{Name: "Short lived", Scope: TokenScopeRead, ExpiresInDays: days(30)})
	if err != nil || expiring.ExpiresAt == nil {
		t.Fatalf("create expiring token: %v", err)
	}
	if left := time.Until(*expiring.ExpiresAt); left < 29*24*time.Hour || left > 31*24*time.Hour {
		t.Fatalf("unexpected expiry: %v", left)
	}

	for i := 1; i < MaxAPITokensPerUser; i++ {
		if _, _, err := svc.Create(user.ID, CreateTokenInput{Name: "bulk", Scope: TokenScopeRead}); err != nil {
			t.Fatalf("create token %d: %v", i, err)
		}
	}
	if _, _, err := svc.Create(user.ID, CreateTokenInput{Name: "one too many", Scope: TokenScopeRead}); !errors.Is(err, ErrTokenLimit) {
		t.Fatalf("expected the per-account limit, got %v", err)
	}
	tokens, err := svc.List(user.ID)
	if err != nil || len(tokens) != MaxAPITokensPerUser {
		t.Fatalf("list: %d tokens, %v", len(tokens), err)
	}
	// The limit is per account.
	if _, _, err := svc.Create(newTestUser(t, tx).ID, CreateTokenInput{Name: "other account", Scope: TokenScopeRead}); err != nil {
		t.Fatalf("another account must not be affected: %v", err)
	}
}

func TestAPIToken_BuildRestriction(t *testing.T) {
	tx := testTx(t)
	svc := NewAPITokenService(tx)
	builds := NewBuildService(tx)
	owner, stranger := newTestUser(t, tx), newTestUser(t, tx)
	build, err := builds.Create(owner.ID, SyncGraphInput{Name: "Lab"})
	if err != nil {
		t.Fatalf("create build: %v", err)
	}

	if _, _, err := svc.Create(stranger.ID, CreateTokenInput{Name: "x", Scope: TokenScopeRead, BuildID: &build.ID}); !errors.Is(err, ErrTokenInput) {
		t.Fatalf("a token cannot be pinned to another account's build, got %v", err)
	}
	plaintext, token, err := svc.Create(owner.ID, CreateTokenInput{Name: "Lab only", Scope: TokenScopePropose, BuildID: &build.ID})
	if err != nil || token.BuildID == nil || *token.BuildID != build.ID {
		t.Fatalf("create restricted token: %+v, %v", token, err)
	}

	// Deleting the build removes the tokens that could only reach it.
	if err := builds.Delete(build.ID, owner.ID); err != nil {
		t.Fatalf("delete build: %v", err)
	}
	if _, err := svc.Authenticate(plaintext, ""); !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("token of a deleted build must stop working, got %v", err)
	}
}
