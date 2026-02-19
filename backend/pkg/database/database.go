package database

import (
	"fmt"
	"log"

	"github.com/Butterski/homelab-builder/backend/internal/config"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/glebarez/sqlite"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func Connect(cfg *config.Config) (*gorm.DB, error) {
	var dialector gorm.Dialector

	if cfg.DBType == "postgres" {
		dsn := fmt.Sprintf(
			"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
			cfg.DBHost, cfg.DBPort, cfg.DBUser, cfg.DBPassword, cfg.DBName, cfg.DBSSLMode,
		)
		dialector = postgres.Open(dsn)
	} else {
		// SQLite default
		dialector = sqlite.Open(cfg.DBFile)
	}

	db, err := gorm.Open(dialector, &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	// Auto-migrate schema for development (SQLite or Postgres)
	if cfg.DBType == "sqlite" || cfg.DBType == "postgres" {
		log.Printf("Running auto-migration for %s...", cfg.DBType)
		if err := db.AutoMigrate(
			&models.User{},
			&models.Service{},
			&models.ServiceRequirement{},
			&models.UserSelection{},
			&models.HardwareRecommendation{},
			&models.ShoppingList{},
			&models.ShoppingListItem{},
			&models.Event{},
			&models.Build{},
			&models.HardwareComponent{},
			&models.HardwareReview{},
			&models.Node{},
			&models.Edge{},
			&models.ServiceInstance{},
			&models.VirtualMachine{},
		); err != nil {
			// Don't fail connection on migration error, just log it
			log.Printf("Warning: failed to auto-migrate database: %v", err)
		}
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get underlying sql.DB: %w", err)
	}

	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetMaxOpenConns(100)

	log.Println("Database connected successfully")
	return db, nil
}
