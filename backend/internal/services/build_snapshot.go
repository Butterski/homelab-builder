package services

import (
	"encoding/json"
	"errors"
	"sort"

	"github.com/Butterski/homelab-builder/backend/internal/gaming"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// TopologyPreview is the result of a dry run: the build as it would look after a
// save, with calculated addresses and the IPAM validation report.
type TopologyPreview struct {
	Build      *models.Build
	Validation json.RawMessage
}

// errDryRun rolls a preview transaction back after its result has been read.
var errDryRun = errors.New("dry run rollback")

func (s *BuildService) withDB(db *gorm.DB) *BuildService {
	return &BuildService{db: db}
}

// GetOwned loads a build only when it belongs to userID. Missing and foreign
// builds are indistinguishable to the caller.
func (s *BuildService) GetOwned(buildID, userID uuid.UUID) (*models.Build, error) {
	build, err := s.GetByID(buildID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrBuildNotFound
		}
		return nil, err
	}
	if build.UserID != userID {
		return nil, ErrBuildNotFound
	}
	return build, nil
}

// PreviewTopology saves and calculates input inside a transaction that is always
// rolled back, so nothing it computes is persisted.
func (s *BuildService) PreviewTopology(buildID, userID uuid.UUID, input SyncGraphInput, ipService *IPService) (*TopologyPreview, error) {
	var preview *TopologyPreview
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := s.SaveAndCalculateTx(tx, buildID, userID, input, ipService); err != nil {
			return err
		}
		build, err := s.withDB(tx).GetByID(buildID)
		if err != nil {
			return err
		}
		validation, err := ipService.WithDB(tx).ValidateNetwork(buildID)
		if err != nil {
			return err
		}
		preview = &TopologyPreview{Build: build, Validation: validation}
		return errDryRun
	})
	if !errors.Is(err, errDryRun) {
		if err == nil {
			err = errors.New("preview transaction committed unexpectedly")
		}
		return nil, err
	}
	return preview, nil
}

// BuildToSyncInput converts a loaded build back into the save DTO. Node, VM and
// component UUIDs are kept, so a round trip through syncGraph preserves them.
func BuildToSyncInput(build *models.Build) (SyncGraphInput, error) {
	input := SyncGraphInput{
		Name:     build.Name,
		Revision: build.Revision,
		Kind:     build.Kind,
		Settings: map[string]any{},
		Nodes:    make([]NodeDTO, 0, len(build.Nodes)),
		Edges:    make([]EdgeDTO, 0, len(build.Edges)),
	}
	plan, err := gaming.ParsePlan(build.GamingPlan)
	if err != nil {
		return input, err
	}
	input.GamingPlan = &plan
	if len(build.Settings) > 0 {
		if err := json.Unmarshal(build.Settings, &input.Settings); err != nil {
			return input, err
		}
		if input.Settings == nil {
			input.Settings = map[string]any{}
		}
	}

	// Preload order is not stable; keep insertion order so saves stay deterministic.
	nodes := append([]models.Node(nil), build.Nodes...)
	sort.SliceStable(nodes, func(i, j int) bool {
		if !nodes[i].CreatedAt.Equal(nodes[j].CreatedAt) {
			return nodes[i].CreatedAt.Before(nodes[j].CreatedAt)
		}
		return nodes[i].ID.String() < nodes[j].ID.String()
	})
	for _, node := range nodes {
		details, err := detailsMap(node.Details)
		if err != nil {
			return input, err
		}
		dto := NodeDTO{
			ID:                 node.ID.String(),
			Type:               node.Type,
			Name:               node.Name,
			X:                  node.X,
			Y:                  node.Y,
			PowerDraw:          node.PowerDraw,
			IP:                 node.IP,
			MacAddress:         node.MacAddress,
			Details:            details,
			VMs:                make([]VMDTO, 0, len(node.VirtualMachines)),
			InternalComponents: make([]ComponentDTO, 0, len(node.InternalComponents)),
		}
		if node.ParentID != nil {
			parent := node.ParentID.String()
			dto.ParentID = &parent
		}

		vms := append([]models.VirtualMachine(nil), node.VirtualMachines...)
		sort.SliceStable(vms, func(i, j int) bool {
			if !vms[i].CreatedAt.Equal(vms[j].CreatedAt) {
				return vms[i].CreatedAt.Before(vms[j].CreatedAt)
			}
			return vms[i].ID.String() < vms[j].ID.String()
		})
		for _, vm := range vms {
			vmDetails, err := detailsMap(vm.Details)
			if err != nil {
				return input, err
			}
			dto.VMs = append(dto.VMs, VMDTO{
				ID:         vm.ID.String(),
				Name:       vm.Name,
				Type:       vm.Type,
				IP:         vm.IP,
				MacAddress: vm.MacAddress,
				OS:         vm.OS,
				CPUCores:   vm.CPUCores,
				RAMMB:      vm.RAMMB,
				Status:     vm.Status,
				Details:    vmDetails,
			})
		}

		components := append([]models.NodeComponent(nil), node.InternalComponents...)
		sort.SliceStable(components, func(i, j int) bool {
			if !components[i].CreatedAt.Equal(components[j].CreatedAt) {
				return components[i].CreatedAt.Before(components[j].CreatedAt)
			}
			return components[i].ID.String() < components[j].ID.String()
		})
		for _, component := range components {
			componentDetails, err := detailsMap(component.Details)
			if err != nil {
				return input, err
			}
			dto.InternalComponents = append(dto.InternalComponents, ComponentDTO{
				ID:        component.ID.String(),
				Type:      component.Type,
				Name:      component.Name,
				PowerDraw: component.PowerDraw,
				Details:   componentDetails,
			})
		}
		input.Nodes = append(input.Nodes, dto)
	}

	edges := append([]models.Edge(nil), build.Edges...)
	sort.SliceStable(edges, func(i, j int) bool {
		if !edges[i].CreatedAt.Equal(edges[j].CreatedAt) {
			return edges[i].CreatedAt.Before(edges[j].CreatedAt)
		}
		return edges[i].ID.String() < edges[j].ID.String()
	})
	for _, edge := range edges {
		input.Edges = append(input.Edges, EdgeDTO{
			Source:           edge.SourceNodeID.String(),
			SourceHandle:     edge.SourceHandle,
			Target:           edge.TargetNodeID.String(),
			TargetHandle:     edge.TargetHandle,
			Type:             edge.Type,
			Speed:            edge.Speed,
			Subnet:           edge.Subnet,
			WirelessStandard: edge.WirelessStandard,
			Direction:        edge.Direction,
		})
	}
	return input, nil
}

func detailsMap(raw json.RawMessage) (map[string]any, error) {
	details := map[string]any{}
	if len(raw) == 0 {
		return details, nil
	}
	if err := json.Unmarshal(raw, &details); err != nil {
		return nil, err
	}
	if details == nil {
		details = map[string]any{}
	}
	return details, nil
}
