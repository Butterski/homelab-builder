package services

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func validCustomTheme() StoredTheme {
	return StoredTheme{
		ID:          "midnight-lab",
		Name:        "Midnight Lab",
		Description: "Custom theme stored on backend",
		Mode:        "dark",
		Tokens: map[string]string{
			"background":                 "#09141a",
			"foreground":                 "#ecfeff",
			"card":                       "#10212b",
			"card-foreground":            "#ecfeff",
			"popover":                    "#10212b",
			"popover-foreground":         "#ecfeff",
			"primary":                    "#67e8f9",
			"primary-foreground":         "#082f49",
			"secondary":                  "#1e293b",
			"secondary-foreground":       "#ecfeff",
			"muted":                      "#17222c",
			"muted-foreground":           "#94a3b8",
			"accent":                     "#155e75",
			"accent-foreground":          "#ecfeff",
			"destructive":                "#ef4444",
			"border":                     "#1f3a47",
			"input":                      "#1f3a47",
			"ring":                       "#67e8f9",
			"chart-1":                    "#67e8f9",
			"chart-2":                    "#34d399",
			"chart-3":                    "#f59e0b",
			"chart-4":                    "#818cf8",
			"chart-5":                    "#f472b6",
			"sidebar":                    "#081118",
			"sidebar-foreground":         "#ecfeff",
			"sidebar-primary":            "#67e8f9",
			"sidebar-primary-foreground": "#082f49",
			"sidebar-accent":             "#10212b",
			"sidebar-accent-foreground":  "#ecfeff",
			"sidebar-border":             "#1f3a47",
			"sidebar-ring":               "#67e8f9",
		},
	}
}

func TestAuthService_UpdatePreferences(t *testing.T) {
	// Let's use the actual DB container via the test Tx method defined in testhelpers_test.go
	tx := testTx(t)

	// Set Env variables since NewAuthService loads from ENV now
	os.Setenv("JWT_SECRET", "test-secret-key-12345")
	os.Setenv("GOOGLE_CLIENT_ID", "test-client-id")

	authSvc := NewAuthService(tx)

	user := models.User{
		GoogleID: "google-123",
		Email:    "test@example.com",
		Name:     "Test User",
	}

	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("Failed to create user: %v", err)
	}

	// Initial Preferences should be empty JSON "{}"
	loadedUser, err := authSvc.GetCurrentUser(user.ID)
	if err != nil {
		t.Fatalf("Failed to fetch user: %v", err)
	}

	if string(loadedUser.Preferences) != "{}" && string(loadedUser.Preferences) != "" && string(loadedUser.Preferences) != "null" {
		t.Errorf("Expected initial preferences to be empty, got: %v", string(loadedUser.Preferences))
	}

	// Perform Update
	newPrefs := map[string]interface{}{
		"theme":     "dark",
		"showHints": false,
		"timezone":  "UTC",
	}

	updatedUser, err := authSvc.UpdatePreferences(user.ID, newPrefs)
	if err != nil {
		t.Fatalf("UpdatePreferences failed: %v", err)
	}

	// Verify the object returned by the update
	var unmarshaledPrefs map[string]interface{}
	if err := json.Unmarshal(updatedUser.Preferences, &unmarshaledPrefs); err != nil {
		t.Fatalf("Failed to unmarshal returned preferences: %v", err)
	}

	if unmarshaledPrefs["theme"] != "dark" {
		t.Errorf("Expected theme 'dark', got %v", unmarshaledPrefs["theme"])
	}
	// Note: JSON unmarshals false bools as bool, and numeric strings as float64 usually,
	// checking `showHints` safely:
	if hints, ok := unmarshaledPrefs["showHints"].(bool); !ok || hints != false {
		t.Errorf("Expected showHints to be false, got %v", unmarshaledPrefs["showHints"])
	}

	// Verify persistence in DB
	persistedUser, _ := authSvc.GetCurrentUser(user.ID)

	var persistedPrefs map[string]interface{}
	json.Unmarshal(persistedUser.Preferences, &persistedPrefs)

	if !reflect.DeepEqual(unmarshaledPrefs, persistedPrefs) {
		t.Errorf("Persisted preferences do not match updated preferences. \nGot: %v \nWant: %v", persistedPrefs, unmarshaledPrefs)
	}
}

func TestAuthService_UpdateThemeSettings(t *testing.T) {
	tx := testTx(t)
	os.Setenv("JWT_SECRET", "test-secret-key-12345")
	os.Setenv("GOOGLE_CLIENT_ID", "test-client-id")

	authSvc := NewAuthService(tx)
	user := models.User{
		GoogleID: "google-theme-123",
		Email:    "theme@example.com",
		Name:     "Theme User",
	}

	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("Failed to create user: %v", err)
	}

	input := ThemeSettings{
		ActiveThemeID: "midnight-lab",
		CustomThemes:  []StoredTheme{validCustomTheme()},
	}

	storedSettings, err := authSvc.UpdateThemeSettings(user.ID, input)
	if err != nil {
		t.Fatalf("UpdateThemeSettings failed: %v", err)
	}

	if storedSettings.ActiveThemeID != "midnight-lab" {
		t.Fatalf("expected active theme midnight-lab, got %q", storedSettings.ActiveThemeID)
	}
	if len(storedSettings.CustomThemes) != 1 {
		t.Fatalf("expected one custom theme, got %d", len(storedSettings.CustomThemes))
	}

	persistedUser, err := authSvc.GetCurrentUser(user.ID)
	if err != nil {
		t.Fatalf("Failed to load persisted user: %v", err)
	}

	var persistedPrefs map[string]interface{}
	if err := json.Unmarshal(persistedUser.Preferences, &persistedPrefs); err != nil {
		t.Fatalf("Failed to unmarshal persisted preferences: %v", err)
	}

	if persistedPrefs["theme"] != "midnight-lab" {
		t.Fatalf("expected legacy theme field midnight-lab, got %v", persistedPrefs["theme"])
	}

	loadedSettings, err := authSvc.GetThemeSettings(user.ID)
	if err != nil {
		t.Fatalf("GetThemeSettings failed: %v", err)
	}

	if !reflect.DeepEqual(*storedSettings, *loadedSettings) {
		t.Fatalf("loaded theme settings mismatch. got %#v want %#v", *loadedSettings, *storedSettings)
	}
}

func TestAuthService_UpdateThemeSettings_RejectsInvalidCustomTheme(t *testing.T) {
	tx := testTx(t)
	os.Setenv("JWT_SECRET", "test-secret-key-12345")
	os.Setenv("GOOGLE_CLIENT_ID", "test-client-id")

	authSvc := NewAuthService(tx)
	user := models.User{
		GoogleID: "google-invalid-theme-123",
		Email:    "invalid-theme@example.com",
		Name:     "Invalid Theme User",
	}

	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("Failed to create user: %v", err)
	}

	invalidTheme := validCustomTheme()
	invalidTheme.Mode = "nocturne"
	delete(invalidTheme.Tokens, "ring")

	_, err := authSvc.UpdateThemeSettings(user.ID, ThemeSettings{
		ActiveThemeID: "midnight-lab",
		CustomThemes:  []StoredTheme{invalidTheme},
	})
	if err == nil {
		t.Fatal("expected invalid theme settings error")
	}
}

func TestAuthService_GetThemeSettings_FallsBackToLegacyThemePreference(t *testing.T) {
	tx := testTx(t)
	os.Setenv("JWT_SECRET", "test-secret-key-12345")
	os.Setenv("GOOGLE_CLIENT_ID", "test-client-id")

	authSvc := NewAuthService(tx)
	rawPrefs := json.RawMessage(`{"theme":"light"}`)
	user := models.User{
		GoogleID:    "google-legacy-theme-123",
		Email:       "legacy-theme@example.com",
		Name:        "Legacy Theme User",
		Preferences: rawPrefs,
	}

	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("Failed to create user: %v", err)
	}

	settings, err := authSvc.GetThemeSettings(user.ID)
	if err != nil {
		t.Fatalf("GetThemeSettings failed: %v", err)
	}

	if settings.ActiveThemeID != "light" {
		t.Fatalf("expected light active theme, got %q", settings.ActiveThemeID)
	}
	if len(settings.CustomThemes) != 0 {
		t.Fatalf("expected no custom themes, got %d", len(settings.CustomThemes))
	}
}

func TestAuthService_UpdatePreferences_NormalizesThemeSettings(t *testing.T) {
	tx := testTx(t)
	os.Setenv("JWT_SECRET", "test-secret-key-12345")
	os.Setenv("GOOGLE_CLIENT_ID", "test-client-id")

	authSvc := NewAuthService(tx)
	user := models.User{
		GoogleID: "google-theme-prefs-123",
		Email:    "theme-prefs@example.com",
		Name:     "Theme Prefs User",
	}

	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("Failed to create user: %v", err)
	}

	_, err := authSvc.UpdatePreferences(user.ID, map[string]interface{}{
		"timezone": "UTC",
		"themeSettings": map[string]interface{}{
			"activeThemeId": "midnight lab",
			"customThemes": []map[string]interface{}{
				{
					"id":          "Midnight Lab",
					"name":        "Midnight Lab",
					"description": "Custom theme stored on backend",
					"mode":        "dark",
					"tokens":      validCustomTheme().Tokens,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("UpdatePreferences failed: %v", err)
	}

	loadedSettings, err := authSvc.GetThemeSettings(user.ID)
	if err != nil {
		t.Fatalf("GetThemeSettings failed: %v", err)
	}

	if loadedSettings.ActiveThemeID != "midnight-lab" {
		t.Fatalf("expected normalized active theme id midnight-lab, got %q", loadedSettings.ActiveThemeID)
	}

	persistedUser, err := authSvc.GetCurrentUser(user.ID)
	if err != nil {
		t.Fatalf("Failed to load persisted user: %v", err)
	}

	var persistedPrefs map[string]interface{}
	if err := json.Unmarshal(persistedUser.Preferences, &persistedPrefs); err != nil {
		t.Fatalf("Failed to unmarshal persisted preferences: %v", err)
	}

	if persistedPrefs["timezone"] != "UTC" {
		t.Fatalf("expected timezone to be preserved, got %v", persistedPrefs["timezone"])
	}
	if persistedPrefs["theme"] != "midnight-lab" {
		t.Fatalf("expected normalized theme field midnight-lab, got %v", persistedPrefs["theme"])
	}
}

func TestAuthService_ValidateToken(t *testing.T) {
	tx := testTx(t)

	os.Setenv("JWT_SECRET", "test-secret-key-12345")
	os.Setenv("GOOGLE_CLIENT_ID", "test-client-id")
	authSvc := NewAuthService(tx)

	user := models.User{
		ID:    uuid.New(),
		Email: "tokenuser@test.com",
	}

	token, err := authSvc.generateToken(user)
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	claims, err := authSvc.ValidateToken(token)
	if err != nil {
		t.Fatalf("ValidateToken failed on valid token: %v", err)
	}

	if claims.UserID != user.ID {
		t.Errorf("Claim UserID mismatch. Want %s, got %s", user.ID, claims.UserID)
	}
	if claims.Email != user.Email {
		t.Errorf("Claim Email mismatch. Want %s, got %s", user.Email, claims.Email)
	}

	// Test Invalid Secret
	os.Setenv("JWT_SECRET", "wrong-secret-key")
	invalidAuthSvc := NewAuthService(tx)
	_, err = invalidAuthSvc.ValidateToken(token)
	if err == nil {
		t.Error("ValidateToken should fail with incorrect secret")
	}

	// Test Expired Token
	// Manually generate an expired token for testing
	expiredClaims := TokenClaims{
		UserID: user.ID,
		Email:  user.Email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)), // Expired 1 hr ago
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
			Issuer:    "homelab-builder",
		},
	}
	expiredToken, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, expiredClaims).SignedString([]byte("test-secret-key-12345"))

	// Ensure authSvc used for expired validation is using right secret
	os.Setenv("JWT_SECRET", "test-secret-key-12345")
	validAuthSvc := NewAuthService(tx)

	_, err = validAuthSvc.ValidateToken(expiredToken)
	if err == nil {
		t.Error("ValidateToken should fail on expired token")
	}
}
