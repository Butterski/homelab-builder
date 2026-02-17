package services

import (
	"fmt"
	"math"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

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
	TotalRAMMB     int     `json:"total_ram_mb"`
	TotalCPUCores  float32 `json:"total_cpu_cores"`
	TotalStorageGB int     `json:"total_storage_gb"`
	CPUSuggestion  string  `json:"cpu_suggestion"`
	RAMSuggestion  string  `json:"ram_suggestion"`
	StorageSuggestion string `json:"storage_suggestion"`
	NetworkSuggestion string `json:"network_suggestion"`
	Rationale      string  `json:"rationale"`
	EstimatedCostMin int   `json:"estimated_cost_min"`
	EstimatedCostMax int   `json:"estimated_cost_max"`
}

type RecommendationResponse struct {
	MinimalSpec     Spec     `json:"minimal_spec"`
	RecommendedSpec Spec     `json:"recommended_spec"`
	OptimalSpec     Spec     `json:"optimal_spec"`
	SelectedServices []models.Service `json:"selected_services"`
	Summary         string   `json:"summary"`
}

func (s *RecommendationService) Generate(req RecommendationRequest) (*RecommendationResponse, error) {
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
		minRAM, recRAM             int
		minCPU, recCPU             float32
		minStorage, recStorage     int
	)

	for _, svc := range svcs {
		if svc.Requirements != nil {
			minRAM += svc.Requirements.MinRAMMB
			recRAM += svc.Requirements.RecommendedRAMMB
			minCPU += svc.Requirements.MinCPUCores
			recCPU += svc.Requirements.RecommendedCPUCores
			minStorage += svc.Requirements.MinStorageGB
			recStorage += svc.Requirements.RecommendedStorageGB
		}
	}

	// Add system overhead (OS, Docker, etc.)
	sysOverheadRAM := 1024   // 1 GB for OS/Docker
	sysOverheadStorage := 20  // 20 GB for OS
	sysOverheadCPU := float32(0.5) // 0.5 cores for OS

	minRAM += sysOverheadRAM
	recRAM += sysOverheadRAM
	minCPU += sysOverheadCPU
	recCPU += sysOverheadCPU
	minStorage += sysOverheadStorage
	recStorage += sysOverheadStorage

	// Generate three tiers
	minimalSpec := buildSpec(minRAM, minCPU, minStorage, "minimal")
	recommendedSpec := buildSpec(recRAM, recCPU, recStorage, "recommended")
	optimalSpec := buildSpec(
		int(float64(recRAM)*1.5),
		recCPU*1.5,
		int(float64(recStorage)*1.5),
		"optimal",
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
	}, nil
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

	// Rationale
	switch tier {
	case "minimal":
		spec.Rationale = "Bare minimum to run your services. May experience slowdowns under heavy load."
		spec.EstimatedCostMin = estimateCost(ramMB, cpuCores, storageGB, 0.6)
		spec.EstimatedCostMax = estimateCost(ramMB, cpuCores, storageGB, 0.8)
	case "recommended":
		spec.Rationale = "Comfortable performance with headroom for updates and occasional spikes."
		spec.EstimatedCostMin = estimateCost(ramMB, cpuCores, storageGB, 0.8)
		spec.EstimatedCostMax = estimateCost(ramMB, cpuCores, storageGB, 1.2)
	case "optimal":
		spec.Rationale = "Future-proof setup with room to grow. Ideal for adding more services later."
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
	// Very rough estimation in PLN
	ramCost := float64(ramMB) / 1024 * 80    // ~80 PLN per GB DDR4
	cpuCost := float64(cpuCores) * 150        // ~150 PLN per core equivalent
	storageCost := float64(storageGB) * 0.5   // ~0.5 PLN per GB SSD
	baseCost := 200.0                          // case, PSU, etc.

	total := (ramCost + cpuCost + storageCost + baseCost) * multiplier
	return int(math.Round(total/50) * 50) // Round to nearest 50
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
