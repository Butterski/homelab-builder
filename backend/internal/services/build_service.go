package services

import (
	"encoding/json"
	"errors"
	"fmt"
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

func (s *BuildService) Create(userID uuid.UUID, input SyncGraphInput) (*models.Build, error) {
	settingsJSON, _ := json.Marshal(input.Settings)

	build := &models.Build{
		UserID:    userID,
		Name:      input.Name,
		Thumbnail: input.Thumbnail,
		Settings:  settingsJSON,
	}

	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(build).Error; err != nil {
			return err
		}
		return s.syncGraph(tx, build.ID, input)
	})

	if err != nil {
		return nil, err
	}

	return s.GetByID(build.ID)
}

func (s *BuildService) Update(buildID uuid.UUID, userID uuid.UUID, input SyncGraphInput) (*models.Build, error) {
	var build models.Build
	if err := s.db.First(&build, "id = ?", buildID).Error; err != nil {
		return nil, err
	}

	if build.UserID != userID {
		return nil, errors.New("unauthorized")
	}

	settingsJSON, _ := json.Marshal(input.Settings)
	build.Name = input.Name
	build.Settings = settingsJSON
	if input.Thumbnail != "" {
		build.Thumbnail = input.Thumbnail
	}

	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&build).Error; err != nil {
			return err
		}
		return s.syncGraph(tx, build.ID, input)
	})

	if err != nil {
		return nil, err
	}

	return s.GetByID(buildID)
}

func (s *BuildService) syncGraph(tx *gorm.DB, buildID uuid.UUID, input SyncGraphInput) error {
	if err := validateEdgeEndpoints(input.Nodes, input.Edges); err != nil {
		return err
	}

	// 1. Delete existing nodes/edges/services (cleanup)
	if err := tx.Where("build_id = ?", buildID).Delete(&models.Edge{}).Error; err != nil {
		return err
	}
	if err := tx.Where("build_id = ?", buildID).Delete(&models.ServiceInstance{}).Error; err != nil {
		return err
	}
	if err := tx.Where("node_id IN (?)", tx.Model(&models.Node{}).Select("id").Where("build_id = ?", buildID)).Delete(&models.VirtualMachine{}).Error; err != nil {
		return err
	}
	if err := tx.Where("node_id IN (?)", tx.Model(&models.Node{}).Select("id").Where("build_id = ?", buildID)).Delete(&models.NodeComponent{}).Error; err != nil {
		return err
	}
	if err := tx.Where("build_id = ?", buildID).Delete(&models.Node{}).Error; err != nil {
		return err
	}

	idMap := make(map[string]uuid.UUID)

	// 2. Insert Nodes
	for _, n := range input.Nodes {
		var uid uuid.UUID
		if parsed, err := uuid.Parse(n.ID); err == nil {
			uid = parsed
		} else {
			uid = uuid.New()
		}
		idMap[n.ID] = uid

		if n.Details == nil {
			n.Details = make(map[string]any)
		}
		if n.SubnetMask != "" {
			n.Details["subnet_mask"] = n.SubnetMask
		}
		if n.Gateway != "" {
			n.Details["gateway"] = n.Gateway
		}
		detailsJSON, _ := json.Marshal(n.Details)

		node := models.Node{
			ID:      uid,
			BuildID: buildID,
			Type:    n.Type,
			Name:    n.Name,
			X:       n.X,
			Y:       n.Y,
			IP:      n.IP,
			Details: detailsJSON,
		}
		if n.ParentID != nil && *n.ParentID != "" {
			if parsed, err := uuid.Parse(*n.ParentID); err == nil {
				node.ParentID = &parsed
			}
		}

		if err := tx.Create(&node).Error; err != nil {
			return err
		}

		// 2.1 VMs
		for _, vm := range n.VMs {
			vmUID := uuid.New()
			if parsed, err := uuid.Parse(vm.ID); err == nil {
				vmUID = parsed
			}

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
				return err
			}
		}

		// 2.2 Internal Components
		for _, comp := range n.InternalComponents {
			compUID := uuid.New()
			if parsed, err := uuid.Parse(comp.ID); err == nil {
				compUID = parsed
			}
			compDetailsJSON, _ := json.Marshal(comp.Details)
			cModel := models.NodeComponent{
				ID:      compUID,
				NodeID:  uid,
				Type:    comp.Type,
				Name:    comp.Name,
				Details: compDetailsJSON,
			}
			if err := tx.Create(&cModel).Error; err != nil {
				return err
			}
		}
	}

	// 3. Insert Edges
	for _, le := range input.Edges {
		sourceUUID, ok1 := idMap[le.Source]
		targetUUID, ok2 := idMap[le.Target]

		if ok1 && ok2 {
			edge := models.Edge{
				BuildID:      buildID,
				SourceNodeID: sourceUUID,
				SourceHandle: le.SourceHandle,
				TargetNodeID: targetUUID,
				TargetHandle: le.TargetHandle,
				Type:         "ethernet",
				Speed:        le.Speed,
				Subnet:       le.Subnet,
			}
			if err := tx.Create(&edge).Error; err != nil {
				return err
			}
		}
	}

	// 4. Insert Service Instances
	for _, ls := range input.Services {
		catalogID, err := uuid.Parse(ls.ID)
		if err == nil {
			svc := models.ServiceInstance{
				BuildID:          buildID,
				CatalogServiceID: catalogID,
				Name:             ls.Name,
				Status:           "stopped",
			}
			if err := tx.Create(&svc).Error; err != nil {
				return err
			}
		}
	}

	return nil
}

func validateEdgeEndpoints(nodes []NodeDTO, edges []EdgeDTO) error {
	nodeIDs := make(map[string]struct{}, len(nodes))
	for _, node := range nodes {
		nodeIDs[node.ID] = struct{}{}
	}

	invalidRefs := make([]string, 0)
	for _, edge := range edges {
		_, hasSource := nodeIDs[edge.Source]
		_, hasTarget := nodeIDs[edge.Target]
		if hasSource && hasTarget {
			continue
		}

		if !hasSource && !hasTarget {
			invalidRefs = append(invalidRefs, fmt.Sprintf("%s->%s (missing source and target)", edge.Source, edge.Target))
			continue
		}
		if !hasSource {
			invalidRefs = append(invalidRefs, fmt.Sprintf("%s->%s (missing source)", edge.Source, edge.Target))
			continue
		}
		invalidRefs = append(invalidRefs, fmt.Sprintf("%s->%s (missing target)", edge.Source, edge.Target))
	}

	if len(invalidRefs) == 0 {
		return nil
	}

	maxExamples := 5
	if len(invalidRefs) < maxExamples {
		maxExamples = len(invalidRefs)
	}

	examples := strings.Join(invalidRefs[:maxExamples], "; ")
	if len(invalidRefs) > maxExamples {
		examples += fmt.Sprintf("; ... +%d more", len(invalidRefs)-maxExamples)
	}

	return fmt.Errorf("invalid edge references: %d edge(s) reference missing node(s): %s", len(invalidRefs), examples)
}

func (s *BuildService) GetByID(buildID uuid.UUID) (*models.Build, error) {
	var build models.Build
	if err := s.db.Preload("User").
		Preload("Nodes").
		Preload("Nodes.VirtualMachines").
		Preload("Nodes.InternalComponents").
		Preload("Edges").
		Preload("Nodes.ServiceInstances").
		First(&build, "id = ?", buildID).Error; err != nil {
		return nil, err
	}
	return &build, nil
}

type SyncGraphInput struct {
	Name      string         `json:"name" binding:"required"`
	Thumbnail string         `json:"thumbnail"`
	Settings  map[string]any `json:"settings"`
	Nodes     []NodeDTO      `json:"nodes"`
	Edges     []EdgeDTO      `json:"edges"`
	Services  []ServiceDTO   `json:"services"`
}

type NodeDTO struct {
	ID                 string         `json:"id"`
	Type               string         `json:"type"`
	Name               string         `json:"name"`
	X                  float64        `json:"x"`
	Y                  float64        `json:"y"`
	IP                 string         `json:"ip"`
	SubnetMask         string         `json:"subnet_mask,omitempty"`
	Gateway            string         `json:"gateway,omitempty"`
	Details            map[string]any `json:"details"`
	VMs                []VMDTO        `json:"vms"`
	InternalComponents []ComponentDTO `json:"internal_components"`
	ParentID           *string        `json:"parent_id,omitempty"`
}

type ComponentDTO struct {
	ID      string         `json:"id"`
	Type    string         `json:"type"`
	Name    string         `json:"name"`
	Details map[string]any `json:"details"`
}

type VMDTO struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Type     string  `json:"type"`
	IP       string  `json:"ip"`
	OS       string  `json:"os"`
	CPUCores float64 `json:"cpu_cores"`
	RAMMB    int     `json:"ram_mb"`
	Status   string  `json:"status"`
}

type ServiceDTO struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type EdgeDTO struct {
	Source       string `json:"source"`
	SourceHandle string `json:"source_handle"`
	Target       string `json:"target"`
	TargetHandle string `json:"target_handle"`
	Speed        string `json:"speed"`
	Subnet       string `json:"subnet"`
}

func (s *BuildService) ListByUser(userID uuid.UUID) ([]models.Build, error) {
	var builds []models.Build
	if err := s.db.Preload("Nodes").Where("user_id = ?", userID).Order("updated_at desc").Find(&builds).Error; err != nil {
		return nil, err
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
		Thumbnail: build.Thumbnail,
		Settings:  build.Settings,
	}

	// Start a transaction to insert the new build and sync its data
	err = s.db.Transaction(func(tx *gorm.DB) error {
		// Insert the new base build row to get its ID
		if err := tx.Create(newBuild).Error; err != nil {
			return err
		}

		// Relational Clone:
		idMap := make(map[uuid.UUID]uuid.UUID)

		// 1. Clone Nodes
		for _, node := range build.Nodes {
			newUID := uuid.New()
			idMap[node.ID] = newUID

			newNode := models.Node{
				ID:       newUID,
				BuildID:  newBuild.ID,
				Type:     node.Type,
				Name:     node.Name,
				X:        node.X,
				Y:        node.Y,
				IP:       node.IP,
				Details:  node.Details,
				ParentID: node.ParentID,
			}
			if err := tx.Create(&newNode).Error; err != nil {
				return err
			}

			// 1.1 Clone VMs
			for _, vm := range node.VirtualMachines {
				newVM := vm // struct copy
				newVM.ID = uuid.New()
				newVM.NodeID = newUID
				if err := tx.Create(&newVM).Error; err != nil {
					return err
				}
			}

			// 1.2 Clone Internal Components
			for _, comp := range node.InternalComponents {
				newComp := comp
				newComp.ID = uuid.New()
				newComp.NodeID = newUID
				if err := tx.Create(&newComp).Error; err != nil {
					return err
				}
			}

			// 1.3 Clone Service Instances (Node bound)
			for _, svc := range node.ServiceInstances {
				newSvc := svc
				newSvc.ID = uuid.New()
				newSvc.BuildID = newBuild.ID
				nodeIDPtr := newUID
				newSvc.NodeID = &nodeIDPtr
				if err := tx.Create(&newSvc).Error; err != nil {
					return err
				}
			}
		}

		// 2. Clone Edges
		for _, edge := range build.Edges {
			sourceUUID, ok1 := idMap[edge.SourceNodeID]
			targetUUID, ok2 := idMap[edge.TargetNodeID]

			if ok1 && ok2 {
				newEdge := models.Edge{
					ID:           uuid.New(),
					BuildID:      newBuild.ID,
					SourceNodeID: sourceUUID,
					SourceHandle: edge.SourceHandle,
					TargetNodeID: targetUUID,
					TargetHandle: edge.TargetHandle,
					Type:         edge.Type,
					Speed:        edge.Speed,
					Subnet:       edge.Subnet,
				}
				if err := tx.Create(&newEdge).Error; err != nil {
					return err
				}
			}
		}

		// 3. Clone Global Service Instances (Backlog / NodeID is null)
		var globalServices []models.ServiceInstance
		if err := tx.Where("build_id = ? AND node_id IS NULL", buildID).Find(&globalServices).Error; err == nil {
			for _, svc := range globalServices {
				newSvc := svc
				newSvc.ID = uuid.New()
				newSvc.BuildID = newBuild.ID
				if err := tx.Create(&newSvc).Error; err != nil {
					return err
				}
			}
		}

		// Fix ParentIDs on cloned Nodes
		var clonedNodes []models.Node
		if err := tx.Where("build_id = ?", newBuild.ID).Find(&clonedNodes).Error; err == nil {
			for _, cn := range clonedNodes {
				if cn.ParentID != nil {
					if mappedParent, ok := idMap[*cn.ParentID]; ok {
						cn.ParentID = &mappedParent
						tx.Save(&cn)
					}
				}
			}
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return s.GetByID(newBuild.ID)
}
