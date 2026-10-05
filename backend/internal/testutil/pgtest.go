// Package testutil gives packages outside services the same test database
// pattern: a real PostgreSQL instance and one rolled-back transaction per test.
package testutil

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/pkg/database"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// migrationLock serialises AutoMigrate between test binaries, which Go runs in
// parallel and which share this database.
const migrationLock = 7204251

var (
	once    sync.Once
	shared  *gorm.DB
	initErr error
)

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func connect() (*gorm.DB, error) {
	host := envOr("DB_HOST", "postgres")
	port := envOr("DB_PORT", "5432")
	user := envOr("DB_USER", "homelab")
	password := envOr("DB_PASSWORD", "homelab_password")
	sslMode := envOr("DB_SSLMODE", "disable")
	name := envOr("PKG_TEST_DB_NAME", "homelab_builder_pkg_test")
	quiet := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}

	admin, err := gorm.Open(postgres.Open(fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=postgres sslmode=%s", host, port, user, password, sslMode)), quiet)
	if err != nil {
		return nil, fmt.Errorf("connect to postgres admin db: %w", err)
	}
	// Ignore "already exists": another test binary may have created it first.
	admin.Exec(fmt.Sprintf(`CREATE DATABASE "%s"`, name))
	if sqlAdmin, err := admin.DB(); err == nil {
		sqlAdmin.Close()
	}

	db, err := gorm.Open(postgres.Open(fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s", host, port, user, password, name, sslMode)), quiet)
	if err != nil {
		return nil, fmt.Errorf("connect to %s: %w", name, err)
	}
	// Advisory locks belong to a session, so migrate on one pinned connection.
	err = db.Connection(func(conn *gorm.DB) error {
		if err := conn.Exec("SELECT pg_advisory_lock(?)", migrationLock).Error; err != nil {
			return err
		}
		defer conn.Exec("SELECT pg_advisory_unlock(?)", migrationLock)
		conn.Exec(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`)
		tables := append(database.Models(), &models.SteeringRule{}, &models.CatalogComponent{})
		return conn.AutoMigrate(tables...)
	})
	if err != nil {
		return nil, fmt.Errorf("migrate %s: %w", name, err)
	}
	return db, nil
}

// Tx returns a transaction on the shared test database that is rolled back when
// the test ends, so tests never see each other's rows.
func Tx(t testing.TB) *gorm.DB {
	t.Helper()
	once.Do(func() { shared, initErr = connect() })
	if initErr != nil {
		t.Fatalf("test database: %v", initErr)
	}
	tx := shared.Begin()
	if tx.Error != nil {
		t.Fatalf("begin transaction: %v", tx.Error)
	}
	t.Cleanup(func() { tx.Rollback() })
	return tx
}

// User inserts a throwaway account.
func User(t testing.TB, db *gorm.DB) models.User {
	t.Helper()
	user := models.User{Email: uuid.NewString() + "@test.hlbuilder", GoogleID: uuid.NewString()}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return user
}

// IPAMStub starts a deterministic stand-in for hlbIPAM and returns its URL. It
// keeps requested addresses and gives every connected, networked node a
// 192.168.1.x address. Point services.NewIPService at it with
// t.Setenv("IPAM_URL", url).
func IPAMStub(t testing.TB) string {
	t.Helper()
	offline := map[string]bool{"disk": true, "gpu": true, "hba": true, "pcie": true, "pdu": true, "ups": true, "rack": true}
	type guest struct {
		ID         string `json:"id"`
		ExistingIP string `json:"existing_ip,omitempty"`
		AssignedIP string `json:"assigned_ip,omitempty"`
	}
	type request struct {
		Routers []struct {
			ID        string `json:"id"`
			GatewayIP string `json:"gateway_ip"`
		} `json:"routers"`
		Nodes []struct {
			ID          string   `json:"id"`
			Type        string   `json:"type"`
			Connections []string `json:"connections"`
			ExistingIP  string   `json:"existing_ip"`
			VMs         []guest  `json:"vms"`
		} `json:"nodes"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/v1/validate" {
			_, _ = w.Write([]byte(`{"valid":true,"errors":[],"warnings":[]}`))
			return
		}
		var req request
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		routers := []map[string]any{}
		for _, router := range req.Routers {
			gateway := router.GatewayIP
			if gateway == "" {
				gateway = "192.168.1.1"
			}
			routers = append(routers, map[string]any{"id": router.ID, "gateway_ip": gateway, "subnet": gateway + "/24"})
		}
		nodes := []map[string]any{}
		for i, node := range req.Nodes {
			assigned := node.ExistingIP
			if assigned == "" && !offline[node.Type] && len(node.Connections) > 0 {
				assigned = fmt.Sprintf("192.168.1.%d", 10+i)
			}
			guests := []guest{}
			for j, vm := range node.VMs {
				address := vm.ExistingIP
				if address == "" {
					address = fmt.Sprintf("192.168.1.%d", 100+i*10+j)
				}
				guests = append(guests, guest{ID: vm.ID, AssignedIP: address})
			}
			nodes = append(nodes, map[string]any{"id": node.ID, "type": node.Type, "assigned_ip": assigned, "vms": guests})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"routers": routers, "nodes": nodes})
	}))
	t.Cleanup(server.Close)
	return server.URL
}
