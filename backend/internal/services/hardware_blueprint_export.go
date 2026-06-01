package services

import (
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const hardwareBlueprintExportKind = "hlbuilder.hardware_blueprint"

type HardwareBlueprintExport struct {
	Version     int             `json:"version"`
	Kind        string          `json:"kind"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Category    string          `json:"category"`
	NodeType    string          `json:"node_type"`
	Tags        json.RawMessage `json:"tags"`
	NodeData    json.RawMessage `json:"node_data"`
	Services    json.RawMessage `json:"services"`
	ShareCode   string          `json:"share_code,omitempty"`
	ExportedAt  time.Time       `json:"exported_at"`
	SourceID    string          `json:"source_id,omitempty"`
}

type HardwareBlueprintImportInput struct {
	ImportCode string                   `json:"import_code"`
	Blueprint  *HardwareBlueprintExport `json:"blueprint"`
}

func (s *HardwareBlueprintService) Export(userID, blueprintID uuid.UUID) (*HardwareBlueprintExport, error) {
	var blueprint models.HardwareBlueprint
	if err := s.db.First(&blueprint, "id = ? AND user_id = ?", blueprintID, userID).Error; err != nil {
		return nil, err
	}
	if err := s.ensureShareCode(&blueprint); err != nil {
		return nil, err
	}
	return blueprintToExport(blueprint), nil
}

func (s *HardwareBlueprintService) CreateShareCode(userID, blueprintID uuid.UUID) (*models.HardwareBlueprint, error) {
	var blueprint models.HardwareBlueprint
	if err := s.db.First(&blueprint, "id = ? AND user_id = ?", blueprintID, userID).Error; err != nil {
		return nil, err
	}
	if err := s.ensureShareCode(&blueprint); err != nil {
		return nil, err
	}
	blueprints := []models.HardwareBlueprint{blueprint}
	s.attachFitScores(&userID, blueprints)
	return &blueprints[0], nil
}

func (s *HardwareBlueprintService) Import(userID uuid.UUID, input HardwareBlueprintImportInput) (*models.HardwareBlueprint, error) {
	if strings.TrimSpace(input.ImportCode) != "" {
		var source models.HardwareBlueprint
		code := normalizeShareCode(input.ImportCode)
		if err := s.db.First(&source, "share_code = ?", code).Error; err != nil {
			return nil, err
		}
		return s.cloneImportedBlueprint(userID, blueprintToExport(source))
	}

	if input.Blueprint == nil {
		return nil, errors.New("import_code or blueprint is required")
	}
	return s.cloneImportedBlueprint(userID, input.Blueprint)
}

func (s *HardwareBlueprintService) cloneImportedBlueprint(userID uuid.UUID, exported *HardwareBlueprintExport) (*models.HardwareBlueprint, error) {
	if exported.Version != 1 || exported.Kind != hardwareBlueprintExportKind {
		return nil, errors.New("unsupported blueprint export format")
	}
	if strings.TrimSpace(exported.Name) == "" {
		return nil, errors.New("blueprint export is missing a name")
	}

	imported, err := s.Create(userID, HardwareBlueprintInput{
		Name:        importedBlueprintName(exported.Name),
		Description: exported.Description,
		Category:    exported.Category,
		NodeType:    exported.NodeType,
		Tags:        validRawOrDefault(exported.Tags, "[]"),
		NodeData:    validRawOrDefault(exported.NodeData, "{}"),
		Services:    validRawOrDefault(exported.Services, "[]"),
	})
	if err != nil {
		return nil, err
	}
	return imported, nil
}

func (s *HardwareBlueprintService) ensureShareCode(blueprint *models.HardwareBlueprint) error {
	if blueprint.ShareCode != nil && *blueprint.ShareCode != "" {
		return nil
	}

	for i := 0; i < 8; i++ {
		code, err := generateBlueprintShareCode()
		if err != nil {
			return err
		}
		var count int64
		if err := s.db.Model(&models.HardwareBlueprint{}).Where("share_code = ?", code).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			continue
		}
		blueprint.ShareCode = &code
		return s.db.Save(blueprint).Error
	}

	return errors.New("could not generate a unique share code")
}

func blueprintToExport(blueprint models.HardwareBlueprint) *HardwareBlueprintExport {
	shareCode := ""
	if blueprint.ShareCode != nil {
		shareCode = *blueprint.ShareCode
	}
	return &HardwareBlueprintExport{
		Version:     1,
		Kind:        hardwareBlueprintExportKind,
		Name:        blueprint.Name,
		Description: blueprint.Description,
		Category:    blueprint.Category,
		NodeType:    blueprint.NodeType,
		Tags:        validRawOrDefault(blueprint.Tags, "[]"),
		NodeData:    validRawOrDefault(blueprint.NodeData, "{}"),
		Services:    validRawOrDefault(blueprint.Services, "[]"),
		ShareCode:   shareCode,
		ExportedAt:  time.Now(),
		SourceID:    blueprint.ID.String(),
	}
}

func validRawOrDefault(value json.RawMessage, fallback string) json.RawMessage {
	if len(value) == 0 || !json.Valid(value) {
		return json.RawMessage(fallback)
	}
	return value
}

func importedBlueprintName(name string) string {
	name = strings.TrimSpace(name)
	if strings.Contains(strings.ToLower(name), "imported") {
		return name
	}
	return name + " (Imported)"
}

func generateBlueprintShareCode() (string, error) {
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	token := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(bytes)
	return "HLB-" + token, nil
}

func normalizeShareCode(code string) string {
	return strings.ToUpper(strings.TrimSpace(code))
}

func IsNotFoundError(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}
