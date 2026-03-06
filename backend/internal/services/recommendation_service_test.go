package services_test

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	host := os.Getenv("DB_HOST")
	if host == "" {
		host = "localhost"
	}
	dbName := os.Getenv("TEST_DB_NAME")
	if dbName == "" {
		dbName = "homelab_builder_test"
	}

	dsn := fmt.Sprintf("host=%s user=homelab password=homelab_password dbname=%s port=5432 sslmode=disable", host, dbName)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	require.NoError(t, err)

	// Tests run in transaction and rollback to keep DB clean
	tx := db.Begin()
	t.Cleanup(func() {
		tx.Rollback()
	})

	// Run auto-migration for the test database
	err = tx.AutoMigrate(&models.HardwareComponent{}, &models.Service{}, &models.ServiceRequirement{})
	require.NoError(t, err)

	return tx
}

func TestRecommendationService_Generate(t *testing.T) {
	db := setupTestDB(t)
	svcService := services.NewRecommendationService(db)

	// Seed Hardware Components
	approvedTrue := true
	hw1 := models.HardwareComponent{
		ID:       uuid.New(),
		Category: "server",
		Brand:    "Dell",
		Model:    "R720",
		PriceEst: 100,
		Approved: &approvedTrue,
		Spec:     json.RawMessage(`{"cpu":"2x Intel Xeon E5-2660v2","ram":"32GB DDR3"}`),
	}
	hw2 := models.HardwareComponent{
		ID:       uuid.New(),
		Category: "minipc",
		Brand:    "Intel",
		Model:    "NUC",
		PriceEst: 500,
		Approved: &approvedTrue,
		Spec:     json.RawMessage(`{"cpu":"Intel Core i5-1340P 12-core","ram":"16GB DDR4"}`),
	}
	hw3 := models.HardwareComponent{
		ID:       uuid.New(),
		Category: "sbc",
		Brand:    "Raspberry Pi",
		Model:    "5",
		PriceEst: 80,
		Approved: &approvedTrue,
		Spec:     json.RawMessage(`{"cpu":"ARM 4-core","ram":"8GB"}`),
	}
	require.NoError(t, db.Create(&[]models.HardwareComponent{hw1, hw2, hw3}).Error)

	// Seed Services
	svc1 := models.Service{
		ID:       uuid.New(),
		Name:     "Plex",
		IsActive: true,
	}
	require.NoError(t, db.Create(&svc1).Error)
	req1 := models.ServiceRequirement{
		ServiceID:            svc1.ID,
		MinRAMMB:             1024,
		RecommendedRAMMB:     4096,
		MinCPUCores:          1,
		RecommendedCPUCores:  4,
		MinStorageGB:         10,
		RecommendedStorageGB: 50,
	}
	require.NoError(t, db.Create(&req1).Error)

	svc2 := models.Service{
		ID:       uuid.New(),
		Name:     "Nextcloud",
		IsActive: true,
	}
	require.NoError(t, db.Create(&svc2).Error)
	req2 := models.ServiceRequirement{
		ServiceID:            svc2.ID,
		MinRAMMB:             1024,
		RecommendedRAMMB:     4096,
		MinCPUCores:          1,
		RecommendedCPUCores:  2,
		MinStorageGB:         20,
		RecommendedStorageGB: 100,
	}
	require.NoError(t, db.Create(&req2).Error)

	t.Run("Valid Recommendation Generation", func(t *testing.T) {
		req := services.RecommendationRequest{
			ServiceIDs: []uuid.UUID{svc1.ID, svc2.ID},
		}

		resp, err := svcService.Generate(req)
		require.NoError(t, err)
		require.NotNil(t, resp)

		// Assert totals (including overhead 1024MB RAM, 0.5 CPU, 20GB Storage)
		// Minimal RAM: 1024 + 1024 + 1024 = 3072 MB
		// Recommended RAM: 4096 + 4096 + 1024 = 9216 MB
		assert.Equal(t, 3072, resp.MinimalSpec.TotalRAMMB)
		assert.Equal(t, float32(2.5), resp.MinimalSpec.TotalCPUCores)
		assert.Equal(t, 9216, resp.RecommendedSpec.TotalRAMMB)
		assert.Equal(t, float32(6.5), resp.RecommendedSpec.TotalCPUCores)

		// Assert that hardware matching found results
		assert.NotEmpty(t, resp.RecommendedSpec.HardwareMatches)
		assert.NotEmpty(t, resp.MinimalSpec.HardwareMatches)

		// We should find some hardware that fulfills 9.2GB RAM and 6.5 CPUs.
		// It might be the actual DB seed data (e.g., Orange Pi, Lenovo Tiny), or our test seeded hardware.
		// As long as we get 3 matches and they have enough RAM/CPU, the scoring works.
		assert.LessOrEqual(t, len(resp.RecommendedSpec.HardwareMatches), 3)

		for _, match := range resp.RecommendedSpec.HardwareMatches {
			var specMap map[string]interface{}
			err := json.Unmarshal(match.Spec, &specMap)
			require.NoError(t, err)
			assert.NotEmpty(t, specMap["cpu"])
			assert.NotEmpty(t, specMap["ram"])
		}
	})

	t.Run("Empty Services", func(t *testing.T) {
		req := services.RecommendationRequest{
			ServiceIDs: []uuid.UUID{},
		}
		_, err := svcService.Generate(req)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "at least one service must be selected")
	})

	t.Run("Too Many Services", func(t *testing.T) {
		req := services.RecommendationRequest{}
		for i := 0; i < 51; i++ {
			req.ServiceIDs = append(req.ServiceIDs, uuid.New())
		}
		_, err := svcService.Generate(req)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "maximum 50 services")
	})
}
