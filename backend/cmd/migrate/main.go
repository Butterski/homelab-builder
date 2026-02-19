package main

import (
	"log"

	"github.com/Butterski/homelab-builder/backend/internal/config"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/pkg/database"
)

func main() {
	// Load config
	cfg := config.Load()

	// Connect to DB
	db, err := database.Connect(cfg)
	if err != nil {
		log.Fatalf("Failed to connect to DB: %v", err)
	}

	// Force migration of Node table
	log.Println("Migrating Node table...")
	if err := db.AutoMigrate(&models.Node{}); err != nil {
		log.Fatalf("Failed to migrate Node table: %v", err)
	}
	log.Println("Node table migrated successfully.")

	// Force migration of other related tables just in case
	log.Println("Migrating related tables...")
	if err := db.AutoMigrate(&models.Edge{}, &models.VirtualMachine{}, &models.ServiceInstance{}); err != nil {
		log.Fatalf("Failed to migrate related tables: %v", err)
	}
	log.Println("All tables migrated.")
}
