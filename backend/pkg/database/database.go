package database

import (
	"fmt"
	"log"
	"os"
	"time"

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
		dialector = sqlite.Open(cfg.DBFile)
	}

	// Statements are logged with placeholders only: parameter values (chat
	// text, key ciphertext, token hashes) never reach the SQL log. Release
	// instances additionally log only slow or failed statements.
	logLevel := logger.Info
	if os.Getenv("GIN_MODE") == "release" {
		logLevel = logger.Warn
	}
	sqlLogger := logger.New(log.New(os.Stdout, "\r\n", log.LstdFlags), logger.Config{
		SlowThreshold:             200 * time.Millisecond,
		LogLevel:                  logLevel,
		IgnoreRecordNotFoundError: true,
		ParameterizedQueries:      true,
	})

	db, err := gorm.Open(dialector, &gorm.Config{Logger: sqlLogger})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	if cfg.DBType == "postgres" {
		if err := db.Exec(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`).Error; err != nil {
			log.Printf("Warning: failed to enable pgcrypto extension: %v", err)
		}
	}

	// Auto-migrate schema for development (SQLite or Postgres)
	if cfg.DBType == "sqlite" || cfg.DBType == "postgres" {
		log.Printf("Running auto-migration for %s...", cfg.DBType)
		if err := db.AutoMigrate(Models()...); err != nil {
			return nil, fmt.Errorf("auto-migrate database: %w", err)
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

// Models lists every table the application owns. The server migrates them at
// startup and the package tests migrate the same set.
func Models() []any {
	return []any{
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
		&models.HardwareBlueprint{},
		&models.HardwareBlueprintVote{},
		&models.HardwareBlueprintReview{},
		&models.HardwareReview{},
		&models.SteeringRule{},
		&models.CatalogComponent{},
		&models.Node{},
		&models.Edge{},
		&models.NodeComponent{},
		&models.ServiceInstance{},
		&models.VirtualMachine{},
		&models.BetaSurvey{}, // BETA_SURVEY
		&models.UserHardwareFavorite{},
		&models.APIToken{},
		&models.BuildProposal{},
		&models.AssistantSettings{},
		&models.AssistantThread{},
		&models.AssistantMessage{},
		&models.SystemSetting{},
	}
}
