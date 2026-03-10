package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/middleware"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var handlersTestDB *gorm.DB

func TestMain(m *testing.M) {
	db, err := connectHandlersTestDB()
	if err != nil {
		fmt.Fprintf(os.Stderr, "handlers TestMain: cannot connect to test DB: %v\n", err)
		os.Exit(1)
	}
	if err := migrateHandlersTestDB(db); err != nil {
		fmt.Fprintf(os.Stderr, "handlers TestMain: migration failed: %v\n", err)
		os.Exit(1)
	}
	handlersTestDB = db
	os.Exit(m.Run())
}

func connectHandlersTestDB() (*gorm.DB, error) {
	host := handlersEnvOr("DB_HOST", "postgres")
	port := handlersEnvOr("DB_PORT", "5432")
	user := handlersEnvOr("DB_USER", "homelab")
	pass := handlersEnvOr("DB_PASSWORD", "homelab_password")
	testDBName := handlersEnvOr("TEST_DB_NAME", "homelab_builder_test")
	sslMode := handlersEnvOr("DB_SSLMODE", "disable")

	adminDSN := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=postgres sslmode=%s",
		host, port, user, pass, sslMode,
	)
	adminDB, err := gorm.Open(postgres.Open(adminDSN), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, fmt.Errorf("connect to postgres admin db: %w", err)
	}
	adminDB.Exec(fmt.Sprintf(`CREATE DATABASE "%s"`, testDBName))
	sqlAdmin, _ := adminDB.DB()
	sqlAdmin.Close()

	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		host, port, user, pass, testDBName, sslMode,
	)
	return gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
}

func migrateHandlersTestDB(db *gorm.DB) error {
	db.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`)
	return db.AutoMigrate(
		&models.User{},
		&models.Service{},
		&models.ServiceRequirement{},
		&models.Build{},
		&models.Node{},
		&models.NodeComponent{},
		&models.VirtualMachine{},
		&models.Edge{},
		&models.ServiceInstance{},
		&models.HardwareComponent{},
		&models.SteeringRule{},
		&models.CatalogComponent{},
		&models.HardwareRecommendation{},
		&models.ShoppingList{},
		&models.ShoppingListItem{},
	)
}

func handlersTestTx(t *testing.T) *gorm.DB {
	t.Helper()
	tx := handlersTestDB.Begin()
	if tx.Error != nil {
		t.Fatalf("handlersTestTx: begin transaction: %v", tx.Error)
	}
	t.Cleanup(func() {
		tx.Rollback() //nolint:errcheck
	})
	return tx
}

func handlersEnvOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func createThemeTestUser(t *testing.T, tx *gorm.DB) models.User {
	t.Helper()
	user := models.User{
		GoogleID: "handler-theme-user-" + uuid.NewString(),
		Email:    uuid.NewString() + "@example.com",
		Name:     "Handler Theme User",
	}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("createThemeTestUser: %v", err)
	}
	return user
}

func validThemeTokens() map[string]string {
	return map[string]string{
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
	}
}

func TestAuthHandler_ThemesRoundTrip(t *testing.T) {
	tx := handlersTestTx(t)
	handler := NewAuthHandler(services.NewAuthService(tx), middleware.NewRateLimiter())
	user := createThemeTestUser(t, tx)

	input := services.ThemeSettings{
		ActiveThemeID: "midnight-lab",
		CustomThemes: []services.StoredTheme{
			{
				ID:          "midnight-lab",
				Name:        "Midnight Lab",
				Description: "Handler-level roundtrip test",
				Mode:        "dark",
				Tokens:      validThemeTokens(),
			},
		},
	}

	rawBody, _ := json.Marshal(input)
	updateReq, _ := http.NewRequest(http.MethodPut, "/auth/themes", bytes.NewReader(rawBody))
	updateReq.Header.Set("Content-Type", "application/json")
	updateRecorder := httptest.NewRecorder()
	updateCtx, _ := ginCreateTestContext(updateRecorder, updateReq)
	updateCtx.Set("user_id", user.ID)

	handler.UpdateThemeSettings(updateCtx)

	if updateRecorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", updateRecorder.Code, updateRecorder.Body.String())
	}

	getReq, _ := http.NewRequest(http.MethodGet, "/auth/themes", nil)
	getRecorder := httptest.NewRecorder()
	getCtx, _ := ginCreateTestContext(getRecorder, getReq)
	getCtx.Set("user_id", user.ID)

	handler.GetThemeSettings(getCtx)

	if getRecorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", getRecorder.Code, getRecorder.Body.String())
	}

	var output services.ThemeSettings
	if err := json.Unmarshal(getRecorder.Body.Bytes(), &output); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if output.ActiveThemeID != "midnight-lab" {
		t.Fatalf("expected activeThemeId midnight-lab, got %q", output.ActiveThemeID)
	}
	if len(output.CustomThemes) != 1 {
		t.Fatalf("expected 1 custom theme, got %d", len(output.CustomThemes))
	}
}

func TestAuthHandler_UpdateThemeSettingsRejectsInvalidPayload(t *testing.T) {
	tx := handlersTestTx(t)
	handler := NewAuthHandler(services.NewAuthService(tx), middleware.NewRateLimiter())
	user := createThemeTestUser(t, tx)

	invalid := map[string]interface{}{
		"activeThemeId": "broken-theme",
		"customThemes": []map[string]interface{}{
			{
				"id":   "broken-theme",
				"name": "Broken Theme",
				"mode": "rainbow",
				"tokens": map[string]string{
					"background": "#000",
				},
			},
		},
	}

	rawBody, _ := json.Marshal(invalid)
	req, _ := http.NewRequest(http.MethodPut, "/auth/themes", bytes.NewReader(rawBody))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	ctx, _ := ginCreateTestContext(recorder, req)
	ctx.Set("user_id", user.ID)

	handler.UpdateThemeSettings(ctx)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func ginCreateTestContext(recorder *httptest.ResponseRecorder, req *http.Request) (*gin.Context, *gin.Engine) {
	engine := gin.New()
	ctx := gin.CreateTestContextOnly(recorder, engine)
	ctx.Request = req
	return ctx, engine
}
