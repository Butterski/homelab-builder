package services

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

type exportManifest struct {
	SchemaVersion int      `json:"schema_version"`
	BuildID       string   `json:"build_id"`
	BuildName     string   `json:"build_name"`
	Revision      uint64   `json:"revision"`
	GeneratedAt   string   `json:"generated_at"`
	DeviceCount   int      `json:"device_count"`
	EdgeCount     int      `json:"edge_count"`
	ServiceCount  int      `json:"service_count"`
	Warnings      []string `json:"warnings"`
}

func (s *ConfigService) GenerateCompleteExport(buildID, userID uuid.UUID) ([]byte, string, error) {
	var build models.Build
	if err := s.db.Preload("Nodes.VirtualMachines").Preload("Nodes.InternalComponents").Preload("Edges").First(&build, "id = ?", buildID).Error; err != nil {
		return nil, "", err
	}
	if build.UserID != userID {
		return nil, "", fmt.Errorf("unauthorized to export this build")
	}
	configs, err := s.GenerateAll(buildID, userID)
	if err != nil {
		return nil, "", err
	}

	nodesByID := make(map[uuid.UUID]models.Node, len(build.Nodes))
	warnings := make([]string, 0)
	serviceCount := 0
	hasRouter := false
	for _, node := range build.Nodes {
		nodesByID[node.ID] = node
		hasRouter = hasRouter || node.Type == "router"
		if !nonNetworkTypes[node.Type] && node.Type != "router" && node.IP == "" {
			warnings = append(warnings, fmt.Sprintf("%s has no assigned IP", node.Name))
		}
		for _, vm := range node.VirtualMachines {
			serviceCount++
			if vm.IP == "" {
				warnings = append(warnings, fmt.Sprintf("%s on %s has no assigned IP", vm.Name, node.Name))
			}
			_, known := getServiceConfig(vm.Name)
			if vm.Type != "container" && vm.Type != "lxc" {
				warnings = append(warnings, fmt.Sprintf("%s is a VM and was intentionally omitted from Docker Compose", vm.Name))
			} else if !known {
				warnings = append(warnings, fmt.Sprintf("%s has no verified image metadata and was omitted from Docker Compose", vm.Name))
			}
		}
	}
	if !hasRouter {
		warnings = append(warnings, "Topology has no router; gateway-dependent files are incomplete")
	}
	sort.Strings(warnings)

	manifest := exportManifest{
		SchemaVersion: 1,
		BuildID:       build.ID.String(),
		BuildName:     build.Name,
		Revision:      build.Revision,
		GeneratedAt:   time.Now().UTC().Format(time.RFC3339),
		DeviceCount:   len(build.Nodes),
		EdgeCount:     len(build.Edges),
		ServiceCount:  serviceCount,
		Warnings:      warnings,
	}
	manifestJSON, _ := json.MarshalIndent(manifest, "", "  ")
	topologyJSON, _ := json.MarshalIndent(build, "", "  ")

	files := map[string][]byte{
		"README.md":                        []byte(exportReadme(build, manifest)),
		"manifest.json":                    manifestJSON,
		"topology.json":                    topologyJSON,
		"network/ip-plan.csv":              exportIPPlan(build),
		"network/port-map.csv":             exportPortMap(build, nodesByID),
		"hardware/rack-plan.csv":           exportRackPlan(build, nodesByID),
		"hardware/power-budget.csv":        exportPowerBudget(build),
		"hardware/shopping-list.csv":       exportShoppingList(build),
		"deployment/docker-compose.yml":    []byte(configs.DockerCompose),
		"deployment/.env.example":          []byte(configs.DotEnv),
		"automation/ansible-inventory.ini": []byte(configs.AnsibleInventory),
		"proxy/nginx.conf":                 []byte(configs.Nginx),
		"implementation-checklist.md":      []byte(exportChecklist(build)),
	}

	var archive bytes.Buffer
	zipWriter := zip.NewWriter(&archive)
	paths := make([]string, 0, len(files))
	for path := range files {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		entry, createErr := zipWriter.Create(path)
		if createErr != nil {
			return nil, "", createErr
		}
		if _, writeErr := entry.Write(files[path]); writeErr != nil {
			return nil, "", writeErr
		}
	}
	if err := zipWriter.Close(); err != nil {
		return nil, "", err
	}
	return archive.Bytes(), sanitizeExportName(build.Name) + "-export.zip", nil
}

func exportReadme(build models.Build, manifest exportManifest) string {
	var output strings.Builder
	output.WriteString(fmt.Sprintf("# %s - complete lab export\n\n", build.Name))
	output.WriteString(fmt.Sprintf("Generated from revision %d. Deployable container and proxy entries are emitted only when image, port, and IP data are known.\n\n", build.Revision))
	output.WriteString("Contents: topology.json, network plans, hardware plans, deployment files, automation inventory, proxy configuration, and an implementation checklist.\n\n")
	if len(manifest.Warnings) == 0 {
		output.WriteString("No export blockers were detected.\n")
		return output.String()
	}
	output.WriteString("## Warnings to resolve\n\n")
	for _, warning := range manifest.Warnings {
		output.WriteString("- " + warning + "\n")
	}
	return output.String()
}

func exportIPPlan(build models.Build) []byte {
	rows := [][]string{{"kind", "host", "name", "type", "ip", "mac_address"}}
	for _, node := range build.Nodes {
		rows = append(rows, []string{"device", "", node.Name, node.Type, node.IP, node.MacAddress})
		for _, vm := range node.VirtualMachines {
			rows = append(rows, []string{"guest", node.Name, vm.Name, vm.Type, vm.IP, vm.MacAddress})
		}
	}
	return encodeCSV(rows)
}

func exportPortMap(build models.Build, nodes map[uuid.UUID]models.Node) []byte {
	rows := [][]string{{"source", "source_port", "target", "target_port", "type", "speed", "direction", "subnet"}}
	for _, edge := range build.Edges {
		rows = append(rows, []string{
			nodes[edge.SourceNodeID].Name, edge.SourceHandle,
			nodes[edge.TargetNodeID].Name, edge.TargetHandle,
			edge.Type, edge.Speed, edge.Direction, edge.Subnet,
		})
	}
	return encodeCSV(rows)
}

func exportRackPlan(build models.Build, nodes map[uuid.UUID]models.Node) []byte {
	rows := [][]string{{"rack", "device", "type", "position_u", "rack_units"}}
	for _, node := range build.Nodes {
		if node.ParentID == nil {
			continue
		}
		details := decodeDetails(node.Details)
		rows = append(rows, []string{
			nodes[*node.ParentID].Name, node.Name, node.Type,
			detailString(details, "rack_position"), detailString(details, "rack_units"),
		})
	}
	return encodeCSV(rows)
}

func exportPowerBudget(build models.Build) []byte {
	rows := [][]string{{"device", "type", "base_watts", "component_watts", "total_watts"}}
	for _, node := range build.Nodes {
		componentWatts := 0.0
		for _, component := range node.InternalComponents {
			componentWatts += component.PowerDraw
		}
		rows = append(rows, []string{
			node.Name, node.Type, formatNumber(node.PowerDraw),
			formatNumber(componentWatts), formatNumber(node.PowerDraw + componentWatts),
		})
	}
	return encodeCSV(rows)
}

func exportShoppingList(build models.Build) []byte {
	rows := [][]string{{"item", "category", "model", "quantity", "estimated_unit_price", "currency", "source"}}
	for _, node := range build.Nodes {
		details := decodeDetails(node.Details)
		rows = append(rows, shoppingRow(node.Name, node.Type, details, "topology"))
		for _, component := range node.InternalComponents {
			rows = append(rows, shoppingRow(component.Name, component.Type, decodeDetails(component.Details), node.Name))
		}
	}
	return encodeCSV(rows)
}

func shoppingRow(name, category string, details map[string]any, source string) []string {
	return []string{
		name, category, detailString(details, "model"), "1",
		detailString(details, "price_est"), defaultString(detailString(details, "currency"), "USD"), source,
	}
}

func exportChecklist(build models.Build) string {
	var output strings.Builder
	output.WriteString(`# Implementation checklist

## Validate
- [ ] Resolve every warning in manifest.json
- [ ] Verify port labels and static IP assignments

## Stage hardware
- [ ] Label devices and cables
- [ ] Verify rack placement and UPS capacity

## Configure network
`)
	for _, node := range build.Nodes {
		if node.IP != "" {
			output.WriteString(fmt.Sprintf("- [ ] Configure %s (%s) at %s\n", node.Name, node.Type, node.IP))
		}
	}
	output.WriteString(`
## Deploy and verify
- [ ] Replace every CHANGE_ME value
- [ ] Review image tags, volumes, and ports
- [ ] Test service health, DNS, gateway, and remote access
- [ ] Test a backup restore
`)
	return output.String()
}

func encodeCSV(rows [][]string) []byte {
	var output bytes.Buffer
	writer := csv.NewWriter(&output)
	_ = writer.WriteAll(rows)
	writer.Flush()
	return output.Bytes()
}

func decodeDetails(raw json.RawMessage) map[string]any {
	var details map[string]any
	_ = json.Unmarshal(raw, &details)
	if details == nil {
		details = make(map[string]any)
	}
	return details
}

func detailString(details map[string]any, key string) string {
	value, exists := details[key]
	if !exists || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case float64:
		return formatNumber(typed)
	case bool:
		return strconv.FormatBool(typed)
	default:
		encoded, _ := json.Marshal(typed)
		return string(encoded)
	}
}

func formatNumber(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func sanitizeExportName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			return r
		}
		return '-'
	}, value)
	value = strings.Trim(value, "-")
	if value == "" {
		return "homelab"
	}
	return value
}
