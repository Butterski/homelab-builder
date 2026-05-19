package services

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const MaxServicesPerRequest = 50

type RecommendationService struct {
	db *gorm.DB
}

func NewRecommendationService(db *gorm.DB) *RecommendationService {
	return &RecommendationService{db: db}
}

type RecommendationRequest struct {
	ServiceIDs []uuid.UUID `json:"service_ids" binding:"required"`
}

type Spec struct {
	TotalRAMMB        int                        `json:"total_ram_mb"`
	TotalCPUCores     float32                    `json:"total_cpu_cores"`
	TotalStorageGB    int                        `json:"total_storage_gb"`
	CPUSuggestion     string                     `json:"cpu_suggestion"`
	RAMSuggestion     string                     `json:"ram_suggestion"`
	StorageSuggestion string                     `json:"storage_suggestion"`
	NetworkSuggestion string                     `json:"network_suggestion"`
	Rationale         string                     `json:"rationale"`
	EstimatedCostMin  int                        `json:"estimated_cost_min"`
	EstimatedCostMax  int                        `json:"estimated_cost_max"`
	HardwareMatches   []models.HardwareComponent `json:"hardware_matches"`
}

type ServiceInsight struct {
	Name          string `json:"name"`
	Note          string `json:"note"`
	RAMPercentage int    `json:"ram_percentage"` // how much % of total RAM this service uses
}

type RecommendationResponse struct {
	MinimalSpec      Spec             `json:"minimal_spec"`
	RecommendedSpec  Spec             `json:"recommended_spec"`
	OptimalSpec      Spec             `json:"optimal_spec"`
	SelectedServices []models.Service `json:"selected_services"`
	Summary          string           `json:"summary"`
	Insights         []ServiceInsight `json:"insights"`
	HeaviestService  string           `json:"heaviest_service"`
	TierComparison   string           `json:"tier_comparison"`
}

// Per-service hardware notes (context-aware advice)
var serviceNotes = map[string]string{
	"Plex":                "Plex benefits from Intel QuickSync (iGPU) for hardware transcoding. Avoid AMD CPUs without integrated graphics.",
	"Jellyfin":            "Jellyfin supports VAAPI hardware transcoding. Intel N100/N305 are excellent low-power choices.",
	"Immich":              "Immich uses machine learning for photo recognition - it's RAM-hungry. Consider 8+ GB dedicated.",
	"Home Assistant":      "Home Assistant runs best with host networking. USB passthrough needed for Zigbee/Z-Wave dongles.",
	"Pi-hole":             "Pi-hole is lightweight but needs to be reliable. Consider a UPS for DNS availability.",
	"Minecraft Server":    "Minecraft server RAM scales with player count and world size. Paper server is recommended for performance.",
	"Nextcloud":           "Nextcloud benefits from SSD storage and a dedicated database (PostgreSQL). Pair with a reverse proxy for HTTPS.",
	"Grafana":             "Grafana itself is lightweight, but pair it with Prometheus for full observability.",
	"Uptime Kuma":         "Uptime Kuma is very lightweight. Great first service to ensure everything else is running.",
	"Vaultwarden":         "Vaultwarden handles sensitive data - prioritize server security and regular backups.",
	"Traefik":             "Traefik auto-discovers Docker services and manages SSL certificates. Central to your network setup.",
	"Nginx Proxy Manager": "Nginx Proxy Manager offers a GUI for reverse proxy. Choose either Traefik or NPM, not both.",
	"AdGuard Home":        "AdGuard Home is a Pi-hole alternative with a modern UI. Supports DNS-over-HTTPS natively.",
	"Portainer":           "Portainer makes Docker management visual. Essential for beginners, optional for CLI power users.",
	"Prometheus":          "Prometheus scrapes metrics from all services. Pair with Grafana dashboards for visualization.",
}

func (s *RecommendationService) Generate(req RecommendationRequest) (*RecommendationResponse, error) {
	// Validation
	if len(req.ServiceIDs) == 0 {
		return nil, fmt.Errorf("at least one service must be selected")
	}
	if len(req.ServiceIDs) > MaxServicesPerRequest {
		return nil, fmt.Errorf("maximum %d services per request (got %d)", MaxServicesPerRequest, len(req.ServiceIDs))
	}

	// Fetch all selected services with their requirements
	var svcs []models.Service
	err := s.db.Where("id IN ?", req.ServiceIDs).
		Where("is_active = ?", true).
		Preload("Requirements").
		Find(&svcs).Error
	if err != nil {
		return nil, fmt.Errorf("failed to fetch services: %w", err)
	}

	if len(svcs) == 0 {
		return nil, fmt.Errorf("no valid services found for the given IDs")
	}

	// Calculate totals
	var (
		minRAM, recRAM         int
		minCPU, recCPU         float32
		minStorage, recStorage int
	)

	// Track per-service RAM for insights
	var svcRAMs []svcRAMEntry

	for _, svc := range svcs {
		if svc.Requirements != nil {
			minRAM += svc.Requirements.MinRAMMB
			recRAM += svc.Requirements.RecommendedRAMMB
			minCPU += svc.Requirements.MinCPUCores
			recCPU += svc.Requirements.RecommendedCPUCores
			minStorage += svc.Requirements.MinStorageGB
			recStorage += svc.Requirements.RecommendedStorageGB
			svcRAMs = append(svcRAMs, svcRAMEntry{name: svc.Name, ramMB: svc.Requirements.RecommendedRAMMB})
		}
	}

	// Add system overhead (OS, Docker, etc.)
	sysOverheadRAM := 1024   // 1 GB for OS/Docker
	sysOverheadStorage := 20 // 20 GB for OS
	sysOverheadCPU := float32(0.5)

	minRAM += sysOverheadRAM
	recRAM += sysOverheadRAM
	minCPU += sysOverheadCPU
	recCPU += sysOverheadCPU
	minStorage += sysOverheadStorage
	recStorage += sysOverheadStorage

	minimalSpec := buildSpec(minRAM, minCPU, minStorage, "minimal")
	minimalSpec.HardwareMatches = s.matchHardware(minRAM, minCPU, minStorage)

	recommendedSpec := buildSpec(recRAM, recCPU, recStorage, "recommended")
	recommendedSpec.HardwareMatches = s.matchHardware(recRAM, recCPU, recStorage)

	optimalSpec := buildSpec(
		int(float64(recRAM)*1.5),
		recCPU*1.5,
		int(float64(recStorage)*1.5),
		"optimal",
	)
	optimalSpec.HardwareMatches = s.matchHardware(optimalSpec.TotalRAMMB, optimalSpec.TotalCPUCores, optimalSpec.TotalStorageGB)

	// Build per-service insights
	insights := buildInsights(svcs, svcRAMs, recRAM)

	// Find heaviest service
	heaviest := ""
	if len(svcRAMs) > 0 {
		sort.Slice(svcRAMs, func(i, j int) bool { return svcRAMs[i].ramMB > svcRAMs[j].ramMB })
		ramGB := float64(svcRAMs[0].ramMB) / 1024
		heaviest = fmt.Sprintf("%s dominates your RAM needs (%.1f GB recommended)", svcRAMs[0].name, ramGB)
	}

	// Tier comparison text
	savingsMinimal := recommendedSpec.EstimatedCostMin - minimalSpec.EstimatedCostMin
	extraOptimal := optimalSpec.EstimatedCostMin - recommendedSpec.EstimatedCostMin
	tierComparison := fmt.Sprintf(
		"Minimal tier saves ~%d PLN vs recommended but may struggle under load. Optimal adds ~%d PLN for future-proofing.",
		savingsMinimal, extraOptimal,
	)

	summary := fmt.Sprintf(
		"Based on %d selected services, you need at minimum %d MB RAM, %.1f CPU cores, and %d GB storage. We recommend %d MB RAM, %.1f CPU cores, and %d GB storage for comfortable performance.",
		len(svcs), minRAM, minCPU, minStorage, recRAM, recCPU, recStorage,
	)

	return &RecommendationResponse{
		MinimalSpec:      minimalSpec,
		RecommendedSpec:  recommendedSpec,
		OptimalSpec:      optimalSpec,
		SelectedServices: svcs,
		Summary:          summary,
		Insights:         insights,
		HeaviestService:  heaviest,
		TierComparison:   tierComparison,
	}, nil
}

type svcRAMEntry struct {
	name  string
	ramMB int
}

func buildInsights(svcs []models.Service, svcRAMs []svcRAMEntry, totalRAM int) []ServiceInsight {
	var insights []ServiceInsight
	for _, svc := range svcs {
		note, ok := serviceNotes[svc.Name]
		if !ok {
			note = fmt.Sprintf("%s is ready to run in Docker.", svc.Name)
		}

		ramPct := 0
		for _, sr := range svcRAMs {
			if sr.name == svc.Name && totalRAM > 0 {
				ramPct = int(float64(sr.ramMB) / float64(totalRAM) * 100)
				break
			}
		}

		insights = append(insights, ServiceInsight{
			Name:          svc.Name,
			Note:          note,
			RAMPercentage: ramPct,
		})
	}
	return insights
}

func buildSpec(ramMB int, cpuCores float32, storageGB int, tier string) Spec {
	spec := Spec{
		TotalRAMMB:     ramMB,
		TotalCPUCores:  cpuCores,
		TotalStorageGB: storageGB,
	}

	// CPU suggestions based on cores needed
	roundedCPU := int(math.Ceil(float64(cpuCores)))
	switch {
	case roundedCPU <= 2:
		spec.CPUSuggestion = "Intel N100 / AMD Athlon 3000G"
	case roundedCPU <= 4:
		spec.CPUSuggestion = "Intel N305 / Intel i3-12100 / AMD Ryzen 3 5300G"
	case roundedCPU <= 8:
		spec.CPUSuggestion = "Intel i5-12400 / AMD Ryzen 5 5600G"
	default:
		spec.CPUSuggestion = "Intel i7-12700 / AMD Ryzen 7 5700G / Xeon E5-2680 v4"
	}

	// RAM suggestions
	ramGB := int(math.Ceil(float64(ramMB) / 1024))
	nextPow2RAM := nextPowerOf2(ramGB)
	spec.RAMSuggestion = fmt.Sprintf("%d GB DDR4", nextPow2RAM)

	// Storage suggestions
	switch {
	case storageGB <= 128:
		spec.StorageSuggestion = fmt.Sprintf("%d GB NVMe SSD", nextPowerOf2(storageGB))
	case storageGB <= 512:
		spec.StorageSuggestion = fmt.Sprintf("%d GB NVMe SSD", nextPowerOf2(storageGB))
	default:
		spec.StorageSuggestion = fmt.Sprintf("%d GB NVMe SSD + HDD for data", nextPowerOf2(storageGB))
	}

	// Network suggestions
	spec.NetworkSuggestion = "Gigabit Ethernet (1 GbE)"
	if tier == "optimal" {
		spec.NetworkSuggestion = "2.5 GbE or 10 GbE recommended"
	}

	// Context-aware rationale
	switch tier {
	case "minimal":
		var parts []string
		parts = append(parts, "Bare minimum to run your services.")
		if cpuCores <= 2 {
			parts = append(parts, "Only 2 cores - multitasking will be limited.")
		}
		if ramMB < 4096 {
			parts = append(parts, "Under 4 GB RAM - some services may struggle under load.")
		}
		spec.Rationale = strings.Join(parts, " ")
		spec.EstimatedCostMin = estimateCost(ramMB, cpuCores, storageGB, 0.6)
		spec.EstimatedCostMax = estimateCost(ramMB, cpuCores, storageGB, 0.8)
	case "recommended":
		spec.Rationale = "Comfortable performance with headroom for updates and occasional spikes. Good balance of cost and capability."
		spec.EstimatedCostMin = estimateCost(ramMB, cpuCores, storageGB, 0.8)
		spec.EstimatedCostMax = estimateCost(ramMB, cpuCores, storageGB, 1.2)
	case "optimal":
		spec.Rationale = "Future-proof setup with 50% extra headroom. Ideal for growing your homelab - you can add 3-5 more services without upgrading."
		spec.EstimatedCostMin = estimateCost(ramMB, cpuCores, storageGB, 1.2)
		spec.EstimatedCostMax = estimateCost(ramMB, cpuCores, storageGB, 1.8)
	}

	return spec
}

func nextPowerOf2(n int) int {
	if n <= 0 {
		return 1
	}
	p := 1
	for p < n {
		p *= 2
	}
	return p
}

func estimateCost(ramMB int, cpuCores float32, storageGB int, multiplier float64) int {
	// Estimation in PLN
	ramCost := float64(ramMB) / 1024 * 80   // ~80 PLN per GB DDR4
	cpuCost := float64(cpuCores) * 150      // ~150 PLN per core equivalent
	storageCost := float64(storageGB) * 0.5 // ~0.5 PLN per GB SSD
	baseCost := 200.0                       // case, PSU, etc.

	total := (ramCost + cpuCost + storageCost + baseCost) * multiplier
	return int(math.Round(total/50) * 50)
}

func (s *RecommendationService) SaveRecommendation(userID *uuid.UUID, spec Spec, tier string, serviceIDs []uuid.UUID) (*models.HardwareRecommendation, error) {
	rec := models.HardwareRecommendation{
		UserID:            userID,
		Tier:              tier,
		TotalRAMMB:        spec.TotalRAMMB,
		TotalCPUCores:     spec.TotalCPUCores,
		TotalStorageGB:    spec.TotalStorageGB,
		CPUSuggestion:     spec.CPUSuggestion,
		RAMSuggestion:     spec.RAMSuggestion,
		StorageSuggestion: spec.StorageSuggestion,
		NetworkSuggestion: spec.NetworkSuggestion,
		Rationale:         spec.Rationale,
		EstimatedCostMin:  spec.EstimatedCostMin,
		EstimatedCostMax:  spec.EstimatedCostMax,
	}

	if err := s.db.Create(&rec).Error; err != nil {
		return nil, fmt.Errorf("failed to save recommendation: %w", err)
	}

	return &rec, nil
}

func (s *RecommendationService) matchHardware(ramMB int, cpuCores float32, storageGB int) []models.HardwareComponent {
	var raw []models.HardwareComponent
	// Only check compute / main categories
	s.db.Where("category IN ?", []string{"server", "minipc", "nas", "sbc"}).
		Where("approved = ?", true).
		Find(&raw)

	type scored struct {
		component models.HardwareComponent
		score     float64
	}

	var scoredList []scored

	for _, c := range raw {
		var specMap map[string]interface{}
		if err := json.Unmarshal(c.Spec, &specMap); err != nil {
			continue
		}

		cRam := extractGB(specMap["ram"]) * 1024
		if cRam == 0 {
			cRam = extractGB(specMap["capacity"]) * 1024
		}
		cCPU := extractCores(specMap["cpu"])

		// log extraction
		fmt.Printf("Parsed %s %s - RAM: %d, CPU: %.1f from Spec: %+v\n", c.Brand, c.Model, cRam, cCPU, specMap)

		// Basic eligibility: Must have at least 50% of required RAM and CPU to even be considered
		if float64(cRam) < float64(ramMB)*0.5 && ramMB > 0 {
			fmt.Printf("Skipped %s %s - RAM too low (%d < %f)\n", c.Brand, c.Model, cRam, float64(ramMB)*0.5)
			continue
		}
		if cCPU < cpuCores*0.5 && cpuCores > 0 && cCPU != 0 {
			fmt.Printf("Skipped %s %s - CPU too low (%f < %f)\n", c.Brand, c.Model, cCPU, cpuCores*0.5)
			continue
		}

		score := 0.0

		// Closer RAM is better. If it has less RAM, big penalty. If it has somewhat more, small penalty.
		if cRam < ramMB {
			score += float64(ramMB-cRam) * 0.5
		} else {
			score += float64(cRam-ramMB) * 0.1
		}

		// CPU Cores proximity
		if cCPU < cpuCores {
			score += float64(cpuCores-cCPU) * 500
		} else {
			score += float64(cCPU-cpuCores) * 100
		}

		// Prefer cheaper components if they satisfy needs
		score += c.PriceEst * 1.0

		scoredList = append(scoredList, scored{component: c, score: score})
	}

	sort.Slice(scoredList, func(i, j int) bool {
		return scoredList[i].score < scoredList[j].score
	})

	var matches []models.HardwareComponent
	for i := 0; i < len(scoredList) && i < 3; i++ {
		matches = append(matches, scoredList[i].component)
	}
	return matches
}

func extractGB(val interface{}) int {
	if val == nil {
		return 0
	}
	str := strings.ToUpper(fmt.Sprintf("%v", val))

	reGB := regexp.MustCompile(`(\d+)\s*GB`)
	if m := reGB.FindStringSubmatch(str); len(m) > 1 {
		v, _ := strconv.Atoi(m[1])
		return v
	}
	reTB := regexp.MustCompile(`(\d+)\s*TB`)
	if m := reTB.FindStringSubmatch(str); len(m) > 1 {
		v, _ := strconv.Atoi(m[1])
		return v * 1024
	}
	reNum := regexp.MustCompile(`^(\d+)$`)
	if m := reNum.FindStringSubmatch(str); len(m) > 1 {
		v, _ := strconv.Atoi(m[1])
		return v
	}
	return 0
}

func extractCores(val interface{}) float32 {
	if val == nil {
		return 0
	}
	str := strings.ToLower(fmt.Sprintf("%v", val))

	reCore := regexp.MustCompile(`(\d+)\s*-?core`)
	if m := reCore.FindStringSubmatch(str); len(m) > 1 {
		v, _ := strconv.ParseFloat(m[1], 32)
		return float32(v)
	}
	if strings.Contains(str, "quad-core") || strings.Contains(str, "quad") {
		return 4
	}
	if strings.Contains(str, "dual-core") || strings.Contains(str, "dual") {
		return 2
	}
	if strings.Contains(str, "octa-core") || strings.Contains(str, "octa") {
		return 8
	}

	// Specific fallback for server CPUs
	if strings.Contains(str, "4314") {
		return 16
	}
	if strings.Contains(str, "4310") {
		return 12
	}
	if strings.Contains(str, "4208") {
		return 8
	}
	if strings.Contains(str, "2680v4") || strings.Contains(str, "2680 v4") {
		if strings.Contains(str, "2x") {
			return 28
		}
		return 14
	}
	if strings.Contains(str, "2660v2") || strings.Contains(str, "2660 v2") {
		if strings.Contains(str, "2x") {
			return 20
		}
		return 10
	}
	if strings.Contains(str, "2640v2") || strings.Contains(str, "2640 v2") {
		if strings.Contains(str, "2x") {
			return 16
		}
		return 8
	}

	return 0
}
