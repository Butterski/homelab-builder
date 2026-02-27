package services

import (
	"fmt"
	"os"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// testDB is the package-level database handle shared across all tests.
// Each test wraps its work in a rolled-back transaction for full isolation.
var testDB *gorm.DB

// TestMain creates / migrates the test database and runs all tests.
// Run from inside the backend container:
//
//	docker compose exec backend go test ./internal/services/... -v
func TestMain(m *testing.M) {
	db, err := connectTestDB()
	if err != nil {
		fmt.Fprintf(os.Stderr, "TestMain: cannot connect to test DB: %v\n", err)
		os.Exit(1)
	}
	if err := migrateTestDB(db); err != nil {
		fmt.Fprintf(os.Stderr, "TestMain: migration failed: %v\n", err)
		os.Exit(1)
	}
	testDB = db
	os.Exit(m.Run())
}

// connectTestDB opens a connection to the test PostgreSQL database.
// It reads the same env vars the backend uses (set by docker-compose) but
// overrides DB_NAME with TEST_DB_NAME (default: homelab_builder_test).
func connectTestDB() (*gorm.DB, error) {
	host := envOr("DB_HOST", "postgres")
	port := envOr("DB_PORT", "5432")
	user := envOr("DB_USER", "homelab")
	pass := envOr("DB_PASSWORD", "homelab_password")
	testDBName := envOr("TEST_DB_NAME", "homelab_builder_test")
	sslMode := envOr("DB_SSLMODE", "disable")

	// Connect to the postgres admin DB to run CREATE DATABASE (non-transactional).
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
	// Ignore "already exists" error.
	adminDB.Exec(fmt.Sprintf(`CREATE DATABASE "%s"`, testDBName))
	sqlAdmin, _ := adminDB.DB()
	sqlAdmin.Close()

	// Connect to the test database.
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		host, port, user, pass, testDBName, sslMode,
	)
	return gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
}

// migrateTestDB runs AutoMigrate for all relevant models against PostgreSQL.
// GORM only adds missing tables/columns, so this is safe to call repeatedly.
func migrateTestDB(db *gorm.DB) error {
	// Enable the uuid-ossp extension required for uuid_generate_v4().
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

// testTx starts an isolated transaction for a single test.
// The transaction is always rolled back in t.Cleanup, so tests are fully
// isolated regardless of pass/fail — no manual teardown needed.
//
// Usage:
//
//	tx := testTx(t)
//	svc := NewIPService(tx)
func testTx(t *testing.T) *gorm.DB {
	t.Helper()
	tx := testDB.Begin()
	if tx.Error != nil {
		t.Fatalf("testTx: begin transaction: %v", tx.Error)
	}
	t.Cleanup(func() {
		tx.Rollback() //nolint:errcheck
	})
	return tx
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
