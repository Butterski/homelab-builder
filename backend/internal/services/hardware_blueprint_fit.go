package services

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

type blueprintFitNodeData struct {
	Details            map[string]any                  `json:"details"`
	PowerDraw          float64                         `json:"power_draw"`
	InternalComponents []blueprintFitInternalComponent `json:"internal_components"`
	VMs                []blueprintFitVM                `json:"vms"`
}

type blueprintFitInternalComponent struct {
	Type      string         `json:"type"`
	Name      string         `json:"name"`
	PowerDraw float64        `json:"power_draw"`
	Details   map[string]any `json:"details"`
}

type blueprintFitVM struct {
	CPUCores float64 `json:"cpu_cores"`
	RAMMB    int     `json:"ram_mb"`
}

type blueprintFitServicePayload struct {
	Name         string                          `json:"name"`
	Category     string                          `json:"category"`
	Requirements *blueprintFitServiceRequirement `json:"requirements"`
}

type blueprintFitServiceRequirement struct {
	MinRAMMB             int     `json:"min_ram_mb"`
	RecommendedRAMMB     int     `json:"recommended_ram_mb"`
	MinCPUCores          float64 `json:"min_cpu_cores"`
	RecommendedCPUCores  float64 `json:"recommended_cpu_cores"`
	MinStorageGB         int     `json:"min_storage_gb"`
	RecommendedStorageGB int     `json:"recommended_storage_gb"`
}

type blueprintLabProfile struct {
	HasData      bool
	TypeCounts   map[string]int
	NodeCount    int
	ServiceCount int
	EdgeCount    int
	CPUCores     float64
	RAMGB        float64
	StorageGB    float64
	PowerW       float64
	Ports        float64
	NetworkGbps  float64
	DriveBays    int
	Disks        int
	GPUs         int
}

func (s *HardwareBlueprintService) attachFitScores(userID *uuid.UUID, blueprints []models.HardwareBlueprint) {
	profile := s.loadBlueprintLabProfile(userID)
	for i := range blueprints {
		fit := scoreHardwareBlueprintFit(blueprints[i], profile)
		blueprints[i].Fit = &fit
	}
}

func (s *HardwareBlueprintService) loadBlueprintLabProfile(userID *uuid.UUID) blueprintLabProfile {
	profile := blueprintLabProfile{TypeCounts: map[string]int{}}
	if userID == nil {
		return profile
	}

	var builds []models.Build
	if err := s.db.
		Preload("Nodes").
		Preload("Nodes.InternalComponents").
		Preload("Nodes.ServiceInstances").
		Preload("Edges").
		Where("user_id = ?", *userID).
		Find(&builds).Error; err != nil {
		return profile
	}

	for _, build := range builds {
		profile.HasData = true
		profile.EdgeCount += len(build.Edges)
		for _, node := range build.Nodes {
			profile.NodeCount++
			profile.TypeCounts[node.Type]++
			profile.ServiceCount += len(node.ServiceInstances)
			profile.PowerW += node.PowerDraw
			profile.EdgeCount += 0

			var details map[string]any
			_ = json.Unmarshal(node.Details, &details)
			profile.CPUCores += numberFromDetails(details, "cpu", "cpu_cores")
			profile.RAMGB += capacityGBFromDetails(details, "ram", "memory")
			profile.StorageGB += capacityGBFromDetails(details, "storage", "capacity")
			profile.Ports += portCountFromDetails(details, "ports", "network_ports")
			profile.NetworkGbps += networkGbpsFromDetails(details, "network_gbps", "port_speed", "speed")
			profile.DriveBays += int(numberFromDetails(details, "drive_bays", "bays", "disk_bays"))

			for _, component := range node.InternalComponents {
				var componentDetails map[string]any
				_ = json.Unmarshal(component.Details, &componentDetails)
				profile.PowerW += component.PowerDraw
				switch component.Type {
				case "disk":
					profile.Disks++
					profile.StorageGB += capacityGBFromDetails(componentDetails, "storage", "capacity")
				case "gpu":
					profile.GPUs++
				case "hba", "pcie":
					profile.Ports += portCountFromDetails(componentDetails, "ports", "network_ports")
				}
			}
		}
	}

	return profile
}

func scoreHardwareBlueprintFit(blueprint models.HardwareBlueprint, profile blueprintLabProfile) models.HardwareBlueprintFit {
	capacity, demand, serviceCount := blueprintResources(blueprint)
	utilization := models.HardwareBlueprintUtilization{
		CPU:     utilizationRatio(demand.CPUCores, capacity.CPUCores),
		RAM:     utilizationRatio(demand.RAMGB, capacity.RAMGB),
		Storage: utilizationRatio(demand.StorageGB, capacity.StorageGB),
		Ports:   utilizationRatio(demand.Ports, capacity.Ports),
		Network: utilizationRatio(demand.NetworkGbps, capacity.NetworkGbps),
	}

	headroomScore := weightedAverage([]weightedScore{
		{scoreResourceUtilization(demand.CPUCores, capacity.CPUCores), 0.28},
		{scoreResourceUtilization(demand.RAMGB, capacity.RAMGB), 0.32},
		{scoreResourceUtilization(demand.StorageGB, capacity.StorageGB), 0.22},
		{scoreResourceUtilization(demand.Ports, capacity.Ports), 0.10},
		{scoreResourceUtilization(demand.NetworkGbps, capacity.NetworkGbps), 0.08},
	})
	bottleneckScore := scoreBottleneck(utilization)
	powerScore := scorePowerEfficiency(blueprint.NodeType, capacity)
	portScore := scorePortFit(blueprint.NodeType, demand.Ports, capacity.Ports)
	labGapScore := scoreLabComplement(blueprint.NodeType, capacity, profile)
	expansionScore := scoreExpansionCapacity(capacity)
	roleScore := scoreRoleFit(blueprint.NodeType, capacity, demand, serviceCount)
	resilienceScore := scoreResilience(blueprint.NodeType, capacity)
	confidenceScore := scoreBlueprintConfidence(capacity, serviceCount)
	communityScore := scoreCommunitySignal(blueprint.Upvotes, blueprint.Downvotes)

	factors := []models.HardwareBlueprintFitFactor{
		{Key: "headroom", Label: "Resource headroom", Score: headroomScore, Weight: 0.22, Note: headroomNote(utilization)},
		{Key: "bottleneck", Label: "Bottleneck risk", Score: bottleneckScore, Weight: 0.15, Note: bottleneckNote(utilization)},
		{Key: "role", Label: "Role match", Score: roleScore, Weight: 0.13, Note: roleNote(blueprint.NodeType, capacity)},
		{Key: "power", Label: "Power efficiency", Score: powerScore, Weight: 0.12, Note: powerNote(capacity.PowerW)},
		{Key: "ports", Label: "Network ports", Score: portScore, Weight: 0.10, Note: portNote(demand.Ports, capacity.Ports)},
		{Key: "lab_gap", Label: "Lab fit", Score: labGapScore, Weight: 0.14, Note: labGapNote(blueprint.NodeType, profile)},
		{Key: "expansion", Label: "Expansion", Score: expansionScore, Weight: 0.06, Note: expansionNote(capacity)},
		{Key: "resilience", Label: "Resilience", Score: resilienceScore, Weight: 0.04, Note: resilienceNote(blueprint.NodeType, capacity)},
		{Key: "confidence", Label: "Data confidence", Score: confidenceScore, Weight: 0.03, Note: "more complete specs produce a more reliable fit"},
		{Key: "community", Label: "Community signal", Score: communityScore, Weight: 0.01, Note: communityNote(blueprint.Upvotes, blueprint.Downvotes)},
	}

	score := int(math.Round(weightedAverageFromFactors(factors)))
	if max4(utilization.CPU, utilization.RAM, utilization.Storage, utilization.Network) > 1.35 {
		score = minInt(score, 58)
	} else if max4(utilization.CPU, utilization.RAM, utilization.Storage, utilization.Network) > 1.05 {
		score = minInt(score, 72)
	}
	score = int(clamp(float64(score), 0, 100))
	grade, label := fitGrade(score)

	return models.HardwareBlueprintFit{
		Score:       score,
		Grade:       grade,
		Label:       label,
		Summary:     fitSummary(label, headroomScore, labGapScore, capacity, demand),
		Capacity:    capacity,
		Demand:      demand,
		Utilization: utilization,
		Factors:     factors,
	}
}

func blueprintResources(blueprint models.HardwareBlueprint) (models.HardwareBlueprintFitResource, models.HardwareBlueprintFitResource, int) {
	var nodeData blueprintFitNodeData
	_ = json.Unmarshal(blueprint.NodeData, &nodeData)
	if nodeData.Details == nil {
		nodeData.Details = map[string]any{}
	}

	capacity := models.HardwareBlueprintFitResource{
		CPUCores:    numberFromDetails(nodeData.Details, "cpu", "cpu_cores", "cores"),
		RAMGB:       capacityGBFromDetails(nodeData.Details, "ram", "memory"),
		StorageGB:   capacityGBFromDetails(nodeData.Details, "storage", "capacity"),
		Ports:       portCountFromDetails(nodeData.Details, "ports", "network_ports"),
		NetworkGbps: networkGbpsFromDetails(nodeData.Details, "network_gbps", "port_speed", "speed"),
		DriveBays:   int(numberFromDetails(nodeData.Details, "drive_bays", "bays", "disk_bays")),
		PowerW:      firstNumber(nodeData.PowerDraw, numberFromDetails(nodeData.Details, "power", "power_w", "tdp_w", "idle_w")),
	}

	for _, component := range nodeData.InternalComponents {
		capacity.PowerW += firstNumber(component.PowerDraw, numberFromDetails(component.Details, "power", "power_w", "tdp_w", "idle_w"))
		switch component.Type {
		case "disk":
			capacity.Disks++
			capacity.StorageGB += capacityGBFromDetails(component.Details, "storage", "capacity")
		case "gpu":
			capacity.GPUs++
		case "hba", "pcie":
			capacity.Ports += portCountFromDetails(component.Details, "ports", "network_ports")
			capacity.NetworkGbps += networkGbpsFromDetails(component.Details, "network_gbps", "port_speed", "speed")
		}
	}
	if capacity.DriveBays < capacity.Disks {
		capacity.DriveBays = capacity.Disks
	}

	demand := models.HardwareBlueprintFitResource{}
	for _, vm := range nodeData.VMs {
		demand.CPUCores += vm.CPUCores
		demand.RAMGB += float64(vm.RAMMB) / 1024
	}

	var services []blueprintFitServicePayload
	_ = json.Unmarshal(blueprint.Services, &services)
	for _, service := range services {
		if service.Requirements == nil {
			continue
		}
		req := service.Requirements
		demand.CPUCores += firstNumber(req.RecommendedCPUCores, req.MinCPUCores)
		demand.RAMGB += float64(firstInt(req.RecommendedRAMMB, req.MinRAMMB)) / 1024
		demand.StorageGB += float64(firstInt(req.RecommendedStorageGB, req.MinStorageGB))
		if strings.EqualFold(service.Category, "networking") {
			demand.Ports += 1
			demand.NetworkGbps += 0.25
		}
		if strings.EqualFold(service.Category, "media") {
			demand.NetworkGbps += 0.1
		}
		if strings.EqualFold(service.Category, "monitoring") {
			demand.NetworkGbps += 0.05
		}
	}
	if len(services) > 0 {
		demand.Ports += 1 + math.Ceil(float64(len(services))/8)
	}

	return capacity, demand, len(services)
}

type weightedScore struct {
	score  float64
	weight float64
}

func weightedAverage(scores []weightedScore) float64 {
	var total float64
	var weight float64
	for _, item := range scores {
		total += item.score * item.weight
		weight += item.weight
	}
	if weight == 0 {
		return 0
	}
	return total / weight
}

func weightedAverageFromFactors(factors []models.HardwareBlueprintFitFactor) float64 {
	var scores []weightedScore
	for _, factor := range factors {
		scores = append(scores, weightedScore{score: factor.Score, weight: factor.Weight})
	}
	return weightedAverage(scores)
}

func scoreResourceUtilization(demand, capacity float64) float64 {
	if demand <= 0 {
		if capacity > 0 {
			return 82
		}
		return 56
	}
	if capacity <= 0 {
		return 8
	}

	ratio := demand / capacity
	switch {
	case ratio <= 0.55:
		return 96 - ratio*18
	case ratio <= 0.85:
		return 86 - (ratio-0.55)*70
	case ratio <= 1:
		return 65 - (ratio-0.85)*120
	default:
		return clamp(46-(ratio-1)*48, 0, 46)
	}
}

func scoreBottleneck(util models.HardwareBlueprintUtilization) float64 {
	values := []float64{util.CPU, util.RAM, util.Storage, util.Ports, util.Network}
	peak := 0.0
	sum := 0.0
	active := 0.0
	for _, value := range values {
		if value <= 0 {
			continue
		}
		active++
		sum += value
		if value > peak {
			peak = value
		}
	}
	if active == 0 {
		return 74
	}
	avg := sum / active
	spread := peak - avg
	score := 96 - peak*40 - spread*32
	if peak > 1 {
		score -= (peak - 1) * 60
	}
	return clamp(score, 0, 96)
}

func scorePowerEfficiency(nodeType string, capacity models.HardwareBlueprintFitResource) float64 {
	if capacity.PowerW <= 0 {
		return 58
	}

	usefulCapacity := capacity.CPUCores*12 + capacity.RAMGB*1.4 + capacity.StorageGB/80 + capacity.Ports*3 + float64(capacity.GPUs)*22
	density := usefulCapacity / capacity.PowerW
	score := 48 + density*16

	switch nodeType {
	case "minipc", "sbc":
		if capacity.PowerW <= 18 {
			score += 12
		}
	case "server", "server_v2":
		if capacity.PowerW > 180 {
			score -= 8
		}
	case "router", "switch", "firewall":
		if capacity.PowerW <= 30 {
			score += 8
		}
	}

	return clamp(score, 18, 98)
}

func scorePortFit(nodeType string, demand, capacity float64) float64 {
	switch nodeType {
	case "router", "switch", "firewall", "access_point":
		if capacity >= 8 {
			return 92
		}
		if capacity >= 4 {
			return 78
		}
		if capacity > 0 {
			return 58
		}
		return 24
	}
	return scoreResourceUtilization(demand, capacity)
}

func scoreRoleFit(nodeType string, capacity, demand models.HardwareBlueprintFitResource, serviceCount int) float64 {
	switch nodeType {
	case "nas":
		score := 52 + math.Min(28, capacity.StorageGB/300) + math.Min(12, float64(capacity.Disks)*4)
		if capacity.DriveBays >= 4 {
			score += 8
		}
		if capacity.NetworkGbps >= 2.5 {
			score += 8
		}
		return clamp(score, 35, 98)
	case "server", "server_v2", "minipc", "pc":
		score := 48 + math.Min(24, capacity.CPUCores*3) + math.Min(20, capacity.RAMGB/2)
		if serviceCount > 0 && demand.CPUCores > 0 && demand.RAMGB > 0 {
			score += 8
		}
		if capacity.GPUs > 0 {
			score += 6
		}
		return clamp(score, 35, 98)
	case "router", "switch", "firewall", "access_point":
		score := 45 + math.Min(28, capacity.Ports*5) + math.Min(18, capacity.NetworkGbps*2)
		if capacity.PowerW > 0 && capacity.PowerW <= 35 {
			score += 7
		}
		return clamp(score, 25, 98)
	case "gpu":
		if capacity.GPUs > 0 {
			return 86
		}
		return 64
	default:
		if capacity.CPUCores+capacity.RAMGB+capacity.StorageGB+capacity.Ports > 0 {
			return 72
		}
		return 52
	}
}

func scoreResilience(nodeType string, capacity models.HardwareBlueprintFitResource) float64 {
	switch nodeType {
	case "nas":
		if capacity.Disks >= 4 || capacity.DriveBays >= 4 {
			return 92
		}
		if capacity.Disks >= 2 || capacity.DriveBays >= 2 {
			return 78
		}
		if capacity.StorageGB > 0 {
			return 52
		}
		return 35
	case "server", "server_v2":
		if capacity.Disks >= 2 && capacity.Ports >= 2 {
			return 84
		}
		if capacity.Disks >= 1 || capacity.Ports >= 2 {
			return 68
		}
		return 54
	case "router", "switch", "firewall":
		if capacity.Ports >= 4 && capacity.PowerW <= 45 {
			return 78
		}
		return 60
	default:
		return 64
	}
}

func scoreLabComplement(nodeType string, capacity models.HardwareBlueprintFitResource, profile blueprintLabProfile) float64 {
	if !profile.HasData {
		return 70
	}

	computeNodes := profile.TypeCounts["server"] + profile.TypeCounts["server_v2"] + profile.TypeCounts["minipc"] + profile.TypeCounts["pc"]
	portPressure := 0.0
	if profile.Ports > 0 {
		portPressure = float64(profile.EdgeCount*2) / profile.Ports
	}

	switch nodeType {
	case "nas", "disk":
		if profile.Disks == 0 || profile.StorageGB < 1024 {
			return 90
		}
		if capacity.StorageGB > profile.StorageGB*0.5 {
			return 78
		}
		return 64
	case "server", "server_v2", "minipc", "pc":
		if computeNodes == 0 {
			return 92
		}
		if profile.ServiceCount > computeNodes*4 {
			return 86
		}
		if capacity.CPUCores > profile.CPUCores*0.35 || capacity.RAMGB > profile.RAMGB*0.35 {
			return 80
		}
		return 66
	case "router", "switch", "firewall", "access_point":
		if profile.Ports <= 0 || portPressure > 0.75 {
			return 90
		}
		if portPressure > 0.55 {
			return 82
		}
		return 64
	case "gpu":
		if profile.GPUs == 0 {
			return 88
		}
		return 63
	default:
		if profile.TypeCounts[nodeType] == 0 {
			return 78
		}
		return 63
	}
}

func scoreExpansionCapacity(capacity models.HardwareBlueprintFitResource) float64 {
	score := 54.0
	score += math.Min(22, float64(capacity.Disks)*8)
	score += math.Min(16, float64(capacity.GPUs)*10)
	if capacity.Ports >= 4 {
		score += 10
	}
	if capacity.StorageGB >= 2000 {
		score += 7
	}
	if capacity.RAMGB >= 32 {
		score += 6
	}
	return clamp(score, 30, 96)
}

func scoreBlueprintConfidence(capacity models.HardwareBlueprintFitResource, serviceCount int) float64 {
	score := 42.0
	if capacity.CPUCores > 0 {
		score += 9
	}
	if capacity.RAMGB > 0 {
		score += 9
	}
	if capacity.StorageGB > 0 {
		score += 9
	}
	if capacity.Ports > 0 {
		score += 9
	}
	if capacity.PowerW > 0 {
		score += 10
	}
	if capacity.Disks > 0 || capacity.GPUs > 0 {
		score += 6
	}
	if serviceCount > 0 {
		score += 6
	}
	return clamp(score, 35, 100)
}

func scoreCommunitySignal(upvotes, downvotes int) float64 {
	total := upvotes + downvotes
	if total == 0 {
		return 65
	}
	score := 65 + math.Min(18, float64(upvotes-downvotes)*4) + math.Min(8, float64(total)) - math.Min(18, float64(downvotes)*6)
	return clamp(score, 25, 95)
}

func utilizationRatio(demand, capacity float64) float64 {
	if demand <= 0 {
		return 0
	}
	if capacity <= 0 {
		return 1.5
	}
	return demand / capacity
}

func fitGrade(score int) (string, string) {
	switch {
	case score >= 86:
		return "excellent", "Strong fit"
	case score >= 74:
		return "good", "Good fit"
	case score >= 60:
		return "tight", "Tight fit"
	default:
		return "risky", "Risky fit"
	}
}

func fitSummary(label string, headroomScore, labGapScore float64, capacity, demand models.HardwareBlueprintFitResource) string {
	if demand.CPUCores == 0 && demand.RAMGB == 0 && demand.StorageGB == 0 {
		return fmt.Sprintf("%s based on hardware capacity, expansion room, power, and your saved lab shape.", label)
	}
	if headroomScore >= 78 && labGapScore >= 78 {
		return fmt.Sprintf("%s with healthy service headroom and useful coverage for the current lab.", label)
	}
	if headroomScore < 58 {
		return fmt.Sprintf("%s because bundled services press close to the available CPU, RAM, or storage.", label)
	}
	return fmt.Sprintf("%s across service load, power, ports, expansion, and lab complementarity.", label)
}

func headroomNote(util models.HardwareBlueprintUtilization) string {
	peak := max4(util.CPU, util.RAM, util.Storage, util.Network)
	switch {
	case peak == 0:
		return "no bundled services, scored from available capacity"
	case peak <= 0.7:
		return "bundled services leave comfortable headroom"
	case peak <= 1:
		return "bundled services fit but use a meaningful share of capacity"
	default:
		return "bundled services exceed at least one resource"
	}
}

func bottleneckNote(util models.HardwareBlueprintUtilization) string {
	peak := max4(util.CPU, util.RAM, util.Storage, util.Network)
	switch {
	case peak <= 0:
		return "no active service demand yet"
	case peak <= 0.7:
		return "no single resource dominates the fit"
	case peak <= 1:
		return "one resource is becoming the limiting factor"
	default:
		return "at least one resource is over capacity"
	}
}

func roleNote(nodeType string, capacity models.HardwareBlueprintFitResource) string {
	switch nodeType {
	case "nas":
		return fmt.Sprintf("%.0fGB storage, %d disks, %d bays", capacity.StorageGB, capacity.Disks, capacity.DriveBays)
	case "server", "server_v2", "minipc", "pc":
		return fmt.Sprintf("%.1f cores and %.0fGB RAM for app hosting", capacity.CPUCores, capacity.RAMGB)
	case "router", "switch", "firewall", "access_point":
		return fmt.Sprintf("%.0f ports and %.1fGbps network capacity", capacity.Ports, capacity.NetworkGbps)
	default:
		return "role-specific capacity checked"
	}
}

func powerNote(powerW float64) string {
	if powerW <= 0 {
		return "power draw was not provided"
	}
	return fmt.Sprintf("%.0fW estimated draw included in scoring", powerW)
}

func portNote(demand, capacity float64) string {
	if capacity <= 0 {
		return "no port capacity was provided"
	}
	if demand <= 0 {
		return fmt.Sprintf("%.0f ports available", capacity)
	}
	return fmt.Sprintf("%.0f of %.0f estimated ports needed", demand, capacity)
}

func labGapNote(nodeType string, profile blueprintLabProfile) string {
	if !profile.HasData {
		return "no saved lab profile yet, using intrinsic fit"
	}
	if profile.TypeCounts[nodeType] == 0 {
		return "fills a hardware role that is missing from the saved lab"
	}
	return "compared against saved build resources, services, and port pressure"
}

func expansionNote(capacity models.HardwareBlueprintFitResource) string {
	parts := []string{}
	if capacity.Disks > 0 {
		parts = append(parts, fmt.Sprintf("%d disks", capacity.Disks))
	}
	if capacity.GPUs > 0 {
		parts = append(parts, fmt.Sprintf("%d GPUs", capacity.GPUs))
	}
	if capacity.Ports > 0 {
		parts = append(parts, fmt.Sprintf("%.0f ports", capacity.Ports))
	}
	if capacity.DriveBays > 0 {
		parts = append(parts, fmt.Sprintf("%d bays", capacity.DriveBays))
	}
	if len(parts) == 0 {
		return "no expansion components recorded"
	}
	return strings.Join(parts, ", ")
}

func resilienceNote(nodeType string, capacity models.HardwareBlueprintFitResource) string {
	if nodeType == "nas" {
		return fmt.Sprintf("%d disks across %d known bays", capacity.Disks, capacity.DriveBays)
	}
	return "redundancy and expansion signals checked for this role"
}

func communityNote(upvotes, downvotes int) string {
	if upvotes+downvotes == 0 {
		return "not enough votes yet"
	}
	return fmt.Sprintf("%d upvotes, %d downvotes", upvotes, downvotes)
}

func numberFromDetails(details map[string]any, keys ...string) float64 {
	for _, key := range keys {
		if details == nil {
			continue
		}
		if value, ok := details[key]; ok {
			parsed := parseNumber(value)
			if key == "cpu" || key == "cpu_cores" || key == "cores" {
				parsed = parseCoreCount(value)
			}
			if parsed > 0 {
				return parsed
			}
		}
	}
	return 0
}

func capacityGBFromDetails(details map[string]any, keys ...string) float64 {
	for _, key := range keys {
		if details == nil {
			continue
		}
		if value, ok := details[key]; ok {
			if parsed := parseCapacityGB(value); parsed > 0 {
				return parsed
			}
		}
	}
	return 0
}

func portCountFromDetails(details map[string]any, keys ...string) float64 {
	for _, key := range keys {
		if details == nil {
			continue
		}
		if value, ok := details[key]; ok {
			if parsed := parsePortCount(value); parsed > 0 {
				return parsed
			}
		}
	}
	return 0
}

func networkGbpsFromDetails(details map[string]any, keys ...string) float64 {
	for _, key := range keys {
		if details == nil {
			continue
		}
		if value, ok := details[key]; ok {
			if parsed := parseNetworkGbps(value); parsed > 0 {
				ports := portCountFromDetails(details, "ports", "network_ports")
				if ports > 1 && key != "network_gbps" {
					return parsed * ports
				}
				return parsed
			}
		}
	}
	return 0
}

func parseNumber(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		parsed, _ := typed.Float64()
		return parsed
	case string:
		number := regexp.MustCompile(`\d+(?:\.\d+)?`).FindString(typed)
		if number == "" {
			return 0
		}
		parsed, _ := strconv.ParseFloat(number, 64)
		if strings.Contains(strings.ToLower(typed), "x ") || strings.Contains(strings.ToLower(typed), "x") {
			multiplier := regexp.MustCompile(`(?i)^(\d+)\s*x`).FindStringSubmatch(typed)
			if len(multiplier) == 2 {
				multi, _ := strconv.ParseFloat(multiplier[1], 64)
				return parsed * multi
			}
		}
		return parsed
	default:
		return 0
	}
}

func parseCoreCount(value any) float64 {
	if numeric := parseNumber(value); numeric > 0 {
		text := strings.ToLower(fmt.Sprint(value))
		coreMatch := regexp.MustCompile(`(\d+(?:\.\d+)?)\s*(?:-|\s)?core`).FindStringSubmatch(text)
		if len(coreMatch) == 2 {
			cores, _ := strconv.ParseFloat(coreMatch[1], 64)
			if multiplier := regexp.MustCompile(`^(\d+)\s*x`).FindStringSubmatch(text); len(multiplier) == 2 {
				multi, _ := strconv.ParseFloat(multiplier[1], 64)
				return cores * multi
			}
			return cores
		}
		switch {
		case strings.Contains(text, "dual-core"):
			return 2
		case strings.Contains(text, "quad-core"):
			return 4
		case strings.Contains(text, "octa-core"):
			return 8
		}
		return numeric
	}
	return 0
}

func parseCapacityGB(value any) float64 {
	if number, ok := value.(float64); ok {
		return number
	}
	if number, ok := value.(int); ok {
		return float64(number)
	}

	text := strings.ToUpper(fmt.Sprint(value))
	if text == "" || text == "<NIL>" {
		return 0
	}

	multiCapacity := regexp.MustCompile(`(?i)^(\d+)\s*X\s*(\d+(?:\.\d+)?)\s*(TB|GB|MB)`).FindStringSubmatch(text)
	if len(multiCapacity) == 4 {
		multiplier, _ := strconv.ParseFloat(multiCapacity[1], 64)
		amount, _ := strconv.ParseFloat(multiCapacity[2], 64)
		switch multiCapacity[3] {
		case "TB":
			amount *= 1024
		case "MB":
			amount /= 1024
		}
		return multiplier * amount
	}

	number := regexp.MustCompile(`\d+(?:\.\d+)?`).FindString(text)
	if number == "" {
		return 0
	}
	amount, _ := strconv.ParseFloat(number, 64)
	if strings.Contains(text, "TB") {
		amount *= 1024
	}
	if strings.Contains(text, "MB") {
		amount /= 1024
	}
	return amount
}

func parsePortCount(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case int:
		return float64(typed)
	case string:
		text := strings.ToLower(typed)
		matches := regexp.MustCompile(`(\d+)\s*x`).FindAllStringSubmatch(text, -1)
		if len(matches) > 0 {
			var total float64
			for _, match := range matches {
				count, _ := strconv.ParseFloat(match[1], 64)
				total += count
			}
			return total
		}
		return parseNumber(typed)
	default:
		return 0
	}
}

func parseNetworkGbps(value any) float64 {
	if parsed := parseNumber(value); parsed > 0 {
		text := strings.ToLower(fmt.Sprint(value))
		switch {
		case strings.Contains(text, "100gbe"), strings.Contains(text, "100 gb"):
			return 100
		case strings.Contains(text, "40gbe"), strings.Contains(text, "40 gb"):
			return 40
		case strings.Contains(text, "25gbe"), strings.Contains(text, "25 gb"):
			return 25
		case strings.Contains(text, "10gbe"), strings.Contains(text, "10 gb"), strings.Contains(text, "sfp+"):
			return 10
		case strings.Contains(text, "2.5gbe"), strings.Contains(text, "2.5 gb"):
			return 2.5
		case strings.Contains(text, "100mb"), strings.Contains(text, "100 mb"):
			return 0.1
		case strings.Contains(text, "gbe"), strings.Contains(text, "gb"):
			return parsed
		default:
			return parsed
		}
	}
	return 0
}

func firstNumber(values ...float64) float64 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func firstInt(values ...int) int {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func clamp(value, min, max float64) float64 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func max3(a, b, c float64) float64 {
	return math.Max(a, math.Max(b, c))
}

func max4(a, b, c, d float64) float64 {
	return math.Max(max3(a, b, c), d)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
