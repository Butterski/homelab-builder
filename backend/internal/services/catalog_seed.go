package services

import (
	"fmt"

	"gorm.io/gorm"
)

// SeedCatalog fills the service and hardware catalogs a fresh database starts
// with. It is safe to run on every startup.
func SeedCatalog(db *gorm.DB) error {
	if err := SeedExpandedDefaultServices(db); err != nil {
		return fmt.Errorf("seed services: %w", err)
	}
	if err := SeedDefaultHardware(db); err != nil {
		return fmt.Errorf("seed hardware: %w", err)
	}
	return nil
}
