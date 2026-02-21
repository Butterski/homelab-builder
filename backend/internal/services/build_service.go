package services

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type BuildService struct {
	db *gorm.DB
}

func NewBuildService(db *gorm.DB) *BuildService {
	return &BuildService{db: db}
}

func (s *BuildService) Create(userID uuid.UUID, name, data, thumbnail string) (*models.Build, error) {
	build := &models.Build{
		UserID:    userID,
		Name:      name,
		Data:      data,
		Thumbnail: thumbnail,
	}
	result := s.db.Create(build)
	return build, result.Error
}

func (s *BuildService) Update(buildID uuid.UUID, userID uuid.UUID, name, data, thumbnail string) (*models.Build, error) {
	var build models.Build
	if err := s.db.First(&build, "id = ?", buildID).Error; err != nil {
		return nil, err
	}

	if build.UserID != userID {
		return nil, errors.New("unauthorized")
	}

	build.Name = name
	build.Data = data
	if thumbnail != "" {
		build.Thumbnail = thumbnail
	}

	// Transaction to update build AND sync relational data
	err := s.db.Transaction(func(tx *gorm.DB) error {
		// 1. Delete existing nodes/edges/services (cleanup)
		if err := tx.Where("build_id = ?", build.ID).Delete(&models.Edge{}).Error; err != nil {
			return err
		}
		if err := tx.Where("build_id = ?", build.ID).Delete(&models.ServiceInstance{}).Error; err != nil {
			return err
		}
		if err := tx.Where("node_id IN (?)", tx.Model(&models.Node{}).Select("id").Where("build_id = ?", build.ID)).Delete(&models.VirtualMachine{}).Error; err != nil {
			return err
		}
		if err := tx.Where("build_id = ?", build.ID).Delete(&models.Node{}).Error; err != nil {
			return err
		}

		// 2. Re-insert from JSON and get updated data (with corrected UUIDs)
		updatedData, err := s.syncDataFromJSON(tx, &build)
		if err != nil {
			return err
		}

		// 3. Update the JSON blob on the build object to match the generated UUIDs
		if updatedData != nil {
			newJSON, err := json.Marshal(updatedData)
			if err != nil {
				return err
			}
			build.Data = string(newJSON)
		}

		// 4. Save the Build record (with new Data and potential Name/Thumbnail changes)
		if err := tx.Save(&build).Error; err != nil {
			return err
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return &build, nil
}

func (s *BuildService) syncDataFromJSON(tx *gorm.DB, build *models.Build) (*LegacyBuildData, error) {
	var data LegacyBuildData
	if err := json.Unmarshal([]byte(build.Data), &data); err != nil {
		return nil, err
	}

	idMap := make(map[string]uuid.UUID)

	// 1. Nodes
	for i, ln := range data.HardwareNodes {
		// Try to parse existing ID, otherwise generate new
		var uid uuid.UUID
		if parsed, err := uuid.Parse(ln.ID); err == nil {
			uid = parsed
		} else {
			uid = uuid.New()
		}

		// Update the JSON object with the tailored ID (canonical source of truth)
		data.HardwareNodes[i].ID = uid.String()
		idMap[ln.ID] = uid // Map old ID (if it was different/temp) to new UUID for edges

		detailsJSON, _ := json.Marshal(ln.Details)

		node := models.Node{
			ID:      uid,
			BuildID: build.ID,
			Type:    ln.Type,
			Name:    ln.Name,
			X:       ln.X,
			Y:       ln.Y,
			IP:      ln.IP,
			Details: string(detailsJSON),
		}
		if err := tx.Create(&node).Error; err != nil {
			return nil, err
		}

		// 1.1 VMs
		for j, vm := range ln.VMs {
			var vmUID uuid.UUID
			if parsed, err := uuid.Parse(vm.ID); err == nil {
				vmUID = parsed
			} else {
				vmUID = uuid.New()
			}
			data.HardwareNodes[i].VMs[j].ID = vmUID.String()

			vModel := models.VirtualMachine{
				ID:       vmUID,
				NodeID:   uid,
				Name:     vm.Name,
				Type:     vm.Type,
				IP:       vm.IP,
				OS:       vm.OS,
				CPUCores: vm.CPUCores,
				RAMMB:    vm.RAMMB,
				Status:   vm.Status,
			}
			if err := tx.Create(&vModel).Error; err != nil {
				return nil, err
			}
		}
	}

	// 2. Edges
	for i, le := range data.Edges {
		sourceStr, _ := le["source"].(string)
		targetStr, _ := le["target"].(string)

		sourceUUID, ok1 := idMap[sourceStr]
		targetUUID, ok2 := idMap[targetStr]

		// Update edge IDs in the JSON to match the new UUIDs
		if ok1 {
			data.Edges[i]["source"] = sourceUUID.String()
		}
		if ok2 {
			data.Edges[i]["target"] = targetUUID.String()
		}

		if ok1 && ok2 {
			edge := models.Edge{
				BuildID:      build.ID,
				SourceNodeID: sourceUUID,
				TargetNodeID: targetUUID,
				Type:         "ethernet",
			}
			if err := tx.Create(&edge).Error; err != nil {
				return nil, err
			}
		}
	}

	// 2.5 Ensure React Flow Nodes IDs are also updated
	for i, n := range data.Nodes {
		idStr, _ := n["id"].(string)
		if newUUID, ok := idMap[idStr]; ok {
			data.Nodes[i]["id"] = newUUID.String()
		}
	}

	// 3. Services
	for _, ls := range data.Services {
		catalogID, err := uuid.Parse(ls.ID)
		if err == nil {
			svc := models.ServiceInstance{
				BuildID:          build.ID,
				CatalogServiceID: catalogID,
				Name:             ls.Name,
				Status:           "stopped",
			}
			if err := tx.Create(&svc).Error; err != nil {
				return nil, err
			}
		}
	}

	return &data, nil
}

func (s *BuildService) GetByID(buildID uuid.UUID) (*models.Build, error) {
	var build models.Build
	if err := s.db.Preload("User").Preload("Nodes").Preload("Nodes.VirtualMachines").Preload("Edges").Preload("Nodes.ServiceInstances").First(&build, "id = ?", buildID).Error; err != nil {
		return nil, err
	}

	if build.Data != "" && build.Data != "{}" && len(build.Nodes) == 0 {
		if err := s.migrateLegacyData(&build); err != nil {
			// Migration failed — return legacy data as fallback
		} else {
			_ = s.db.Preload("User").Preload("Nodes").Preload("Nodes.VirtualMachines").Preload("Edges").Preload("Nodes.ServiceInstances").First(&build, "id = ?", buildID)
		}
	}

	return &build, nil
}

// Legacy structures for parsing JSON blob
type LegacyBuildData struct {
	HardwareNodes []LegacyNode     `json:"hardwareNodes"`
	Edges         []map[string]any `json:"edges"`
	Services      []LegacyService  `json:"selectedServices,omitempty"`
	Nodes         []map[string]any `json:"nodes"`
	BoughtItems   any              `json:"boughtItems,omitempty"`
	ShowBought    any              `json:"showBought,omitempty"`
}

type LegacyNode struct {
	ID      string     `json:"id"`
	Type    string     `json:"type"`
	Name    string     `json:"name"`
	X       float64    `json:"x"`
	Y       float64    `json:"y"`
	IP      string     `json:"ip"`
	Details any        `json:"details"`
	VMs     []LegacyVM `json:"vms"`
}

type LegacyVM struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	IP       string `json:"ip"`
	OS       string `json:"os"`
	CPUCores int    `json:"cpu_cores"`
	RAMMB    int    `json:"ram_mb"`
	Status   string `json:"status"`
}

type LegacyService struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (s *BuildService) migrateLegacyData(build *models.Build) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		updatedData, err := s.syncDataFromJSON(tx, build)
		if err != nil {
			return err
		}

		// Update the build's data with the consolidated IDs
		if updatedData != nil {
			newJSON, err := json.Marshal(updatedData)
			if err != nil {
				return err
			}
			build.Data = string(newJSON)
			// Save the updated JSON back to the DB so we don't migrate again
			if err := tx.Save(build).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *BuildService) ListByUser(userID uuid.UUID) ([]models.Build, error) {
	var builds []models.Build
	// Omit the heavy Data blob but still load the relational Nodes for counting.
	// Note: GORM Preload doesn't work when Select() omits the primary key columns;
	// the fix is to NOT use Select() column filtering and instead omit Data via the model.
	// We fetch full rows but the Data column on the struct is populated; to avoid sending
	// megabytes over the wire we clear it after loading.
	if err := s.db.Preload("Nodes").Where("user_id = ?", userID).Order("updated_at desc").Find(&builds).Error; err != nil {
		return nil, err
	}
	// Strip data blob to reduce payload size - frontend doesn't need it for the list view
	for i := range builds {
		builds[i].Data = ""
	}
	return builds, nil
}

func (s *BuildService) Delete(buildID uuid.UUID, userID uuid.UUID) error {
	result := s.db.Where("id = ? AND user_id = ?", buildID, userID).Delete(&models.Build{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("build not found or unauthorized")
	}
	return nil
}

func (s *BuildService) Duplicate(buildID uuid.UUID, userID uuid.UUID) (*models.Build, error) {
	// First fetch the full build that we want to copy
	build, err := s.GetByID(buildID)
	if err != nil {
		return nil, err
	}

	if build.UserID != userID {
		return nil, errors.New("unauthorized to duplicate this build")
	}

	// Create a new independent copy with a new UUID
	newBuild := &models.Build{
		UserID:    userID,
		Name:      build.Name + " (Copy)",
		Data:      build.Data,
		Thumbnail: build.Thumbnail,
	}

	// Start a transaction to insert the new build and sync its data
	err = s.db.Transaction(func(tx *gorm.DB) error {
		// Insert the new base build row to get its ID
		if err := tx.Create(newBuild).Error; err != nil {
			return err
		}

		// Force new UUIDs by string-replacing old IDs with new ones in the JSON blob,
		// then call syncDataFromJSON which will insert them against the new buildID.
		idMap := make(map[string]string)

		// Map node and VM IDs
		var data LegacyBuildData
		if err := json.Unmarshal([]byte(build.Data), &data); err == nil {
			for _, n := range data.HardwareNodes {
				idMap[n.ID] = uuid.New().String()
				for _, vm := range n.VMs {
					idMap[vm.ID] = uuid.New().String()
				}
			}
			for _, n := range data.Nodes {
				if idStr, ok := n["id"].(string); ok {
					if _, exists := idMap[idStr]; !exists {
						idMap[idStr] = uuid.New().String()
					}
				}
			}
		}

		// Regex/String replace the old IDs with new IDs in the JSON string
		newDataStr := build.Data
		for oldID, newID := range idMap {
			// Basic string replacement. Safe since UUIDs are unique and won't overlap with other text
			newDataStr = strings.ReplaceAll(newDataStr, oldID, newID)
		}

		newBuild.Data = newDataStr

		// Update the build row with the rewritten JSON
		if err := tx.Save(newBuild).Error; err != nil {
			return err
		}

		// Now we can safely sync relations for the new build, because its JSON has fresh unique UUIDs
		updatedData, err := s.syncDataFromJSON(tx, newBuild)
		if err != nil {
			return err
		}

		if updatedData != nil {
			finalJSON, err := json.Marshal(updatedData)
			if err == nil {
				newBuild.Data = string(finalJSON)
				tx.Save(newBuild)
			}
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return newBuild, nil
}
