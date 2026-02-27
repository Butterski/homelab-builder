package services

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ShoppingListService struct {
	db *gorm.DB
}

func NewShoppingListService(db *gorm.DB) *ShoppingListService {
	return &ShoppingListService{db: db}
}

type ShoppingListRequest struct {
	RecommendationID uuid.UUID `json:"recommendation_id" binding:"required"`
}

type ShoppingListItem struct {
	Name           string         `json:"name"`
	Category       string         `json:"category"`
	EstimatedPrice int            `json:"estimated_price"`
	Priority       string         `json:"priority"`
	PurchaseLinks  []PurchaseLink `json:"purchase_links"`
}

type PurchaseLink struct {
	Store string `json:"store"`
	URL   string `json:"url"`
}

type ShoppingListResponse struct {
	Items              []ShoppingListItem `json:"items"`
	TotalEstimatedCost int                `json:"total_estimated_cost"`
	RecommendationID   uuid.UUID          `json:"recommendation_id"`
}

func (s *ShoppingListService) Generate(req ShoppingListRequest) (*ShoppingListResponse, error) {
	var rec models.HardwareRecommendation
	if err := s.db.First(&rec, "id = ?", req.RecommendationID).Error; err != nil {
		return nil, fmt.Errorf("recommendation not found: %w", err)
	}

	items := s.generateItems(rec)

	totalCost := 0
	for _, item := range items {
		totalCost += item.EstimatedPrice
	}

	return &ShoppingListResponse{
		Items:              items,
		TotalEstimatedCost: totalCost,
		RecommendationID:   req.RecommendationID,
	}, nil
}

func (s *ShoppingListService) GenerateFromSpec(spec Spec) *ShoppingListResponse {
	rec := models.HardwareRecommendation{
		TotalRAMMB:        spec.TotalRAMMB,
		TotalCPUCores:     spec.TotalCPUCores,
		TotalStorageGB:    spec.TotalStorageGB,
		CPUSuggestion:     spec.CPUSuggestion,
		RAMSuggestion:     spec.RAMSuggestion,
		StorageSuggestion: spec.StorageSuggestion,
	}

	items := s.generateItems(rec)

	totalCost := 0
	for _, item := range items {
		totalCost += item.EstimatedPrice
	}

	return &ShoppingListResponse{
		Items:              items,
		TotalEstimatedCost: totalCost,
	}
}

func (s *ShoppingListService) generateItems(rec models.HardwareRecommendation) []ShoppingListItem {
	var items []ShoppingListItem

	// CPU
	cpuPrice := estimateCPUPrice(rec.TotalCPUCores)
	items = append(items, ShoppingListItem{
		Name:           rec.CPUSuggestion,
		Category:       "cpu",
		EstimatedPrice: cpuPrice,
		Priority:       "essential",
		PurchaseLinks:  generateCPULinks(rec.CPUSuggestion),
	})

	// RAM
	ramGB := nextPowerOf2(int(rec.TotalRAMMB / 1024))
	if ramGB < 4 {
		ramGB = 4
	}
	ramPrice := ramGB * 80
	items = append(items, ShoppingListItem{
		Name:           fmt.Sprintf("%d GB DDR4 RAM", ramGB),
		Category:       "ram",
		EstimatedPrice: ramPrice,
		Priority:       "essential",
		PurchaseLinks: []PurchaseLink{
			{Store: "Amazon", URL: fmt.Sprintf("https://www.amazon.pl/s?k=%dGB+DDR4+RAM", ramGB)},
			{Store: "Allegro", URL: fmt.Sprintf("https://allegro.pl/listing?string=%dGB+DDR4", ramGB)},
			{Store: "x-kom", URL: fmt.Sprintf("https://www.x-kom.pl/szukaj?q=%dGB+DDR4", ramGB)},
		},
	})

	// Storage
	storageGB := nextPowerOf2(rec.TotalStorageGB)
	if storageGB < 128 {
		storageGB = 128
	}
	storagePrice := int(float64(storageGB) * 0.6)
	items = append(items, ShoppingListItem{
		Name:           fmt.Sprintf("%d GB NVMe SSD", storageGB),
		Category:       "storage",
		EstimatedPrice: storagePrice,
		Priority:       "essential",
		PurchaseLinks: []PurchaseLink{
			{Store: "Amazon", URL: fmt.Sprintf("https://www.amazon.pl/s?k=%dGB+NVMe+SSD", storageGB)},
			{Store: "Allegro", URL: fmt.Sprintf("https://allegro.pl/listing?string=%dGB+NVMe+SSD", storageGB)},
			{Store: "x-kom", URL: fmt.Sprintf("https://www.x-kom.pl/szukaj?q=%dGB+NVMe", storageGB)},
		},
	})

	// Case + PSU (Mini PC or case depending on CPU)
	if rec.TotalCPUCores <= 4 {
		items = append(items, ShoppingListItem{
			Name:           "Mini PC Case (compact)",
			Category:       "case",
			EstimatedPrice: 200,
			Priority:       "essential",
			PurchaseLinks: []PurchaseLink{
				{Store: "Amazon", URL: "https://www.amazon.pl/s?k=mini+PC+case"},
				{Store: "Allegro", URL: "https://allegro.pl/listing?string=obudowa+mini+ITX"},
			},
		})
	} else {
		items = append(items, ShoppingListItem{
			Name:           "Micro-ATX Case + 450W PSU",
			Category:       "case",
			EstimatedPrice: 350,
			Priority:       "essential",
			PurchaseLinks: []PurchaseLink{
				{Store: "Amazon", URL: "https://www.amazon.pl/s?k=micro+ATX+case+PSU"},
				{Store: "x-kom", URL: "https://www.x-kom.pl/szukaj?q=obudowa+micro+ATX+zasilacz"},
			},
		})
	}

	// Network cable
	items = append(items, ShoppingListItem{
		Name:           "Ethernet Cable CAT6 (2m)",
		Category:       "network",
		EstimatedPrice: 20,
		Priority:       "essential",
		PurchaseLinks: []PurchaseLink{
			{Store: "Amazon", URL: "https://www.amazon.pl/s?k=kabel+ethernet+cat6"},
			{Store: "Allegro", URL: "https://allegro.pl/listing?string=kabel+ethernet+cat6+2m"},
		},
	})

	// USB drive for OS installation (optional)
	items = append(items, ShoppingListItem{
		Name:           "USB Flash Drive 16GB (for OS installation)",
		Category:       "accessories",
		EstimatedPrice: 25,
		Priority:       "optional",
		PurchaseLinks: []PurchaseLink{
			{Store: "Amazon", URL: "https://www.amazon.pl/s?k=pendrive+16GB"},
			{Store: "Allegro", URL: "https://allegro.pl/listing?string=pendrive+16GB"},
		},
	})

	// Enhance items with real hardware database BuyURLs if they exist
	s.enrichWithHardwareDB(items)
	return items
}

func (s *ShoppingListService) enrichWithHardwareDB(items []ShoppingListItem) {
	// Look up steering rules
	var rules []models.SteeringRule
	s.db.Find(&rules)
	ruleMap := make(map[string][]string)
	for _, r := range rules {
		var order []string
		if err := json.Unmarshal(r.RetailerOrder, &order); err == nil {
			ruleMap[r.Category] = order
		}
	}

	// For each item, look for a matching hardware component by category/name
	for i := range items {
		item := &items[i]
		var comp models.HardwareComponent

		// If we find a real component that has BuyURLs, we override the hardcoded ones
		query := s.db.Where("category = ? AND jsonb_array_length(buy_urls) > 0", item.Category)
		if item.Category == "cpu" {
			query = query.Where("model ILIKE ?", "%"+item.Name+"%")
		}

		if err := query.First(&comp).Error; err == nil {
			var rawLinks []PurchaseLink
			if err := json.Unmarshal(comp.BuyURLs, &rawLinks); err == nil && len(rawLinks) > 0 {
				orderRef, hasRule := ruleMap[item.Category]
				orderedLinks := applySteering(rawLinks, orderRef, hasRule)

				var finalLinks []PurchaseLink
				for _, link := range orderedLinks {
					proxyURL := fmt.Sprintf("https://affiliate.hlb.mock/redirect?ref=hlb&dest=%s&tag=%s", url.QueryEscape(link.URL), url.QueryEscape(comp.AffiliateTag))
					finalLinks = append(finalLinks, PurchaseLink{Store: link.Store, URL: proxyURL})
				}
				item.PurchaseLinks = finalLinks
			}
		}
	}
}

func applySteering(links []PurchaseLink, order []string, active bool) []PurchaseLink {
	if !active || len(order) == 0 {
		return links
	}

	scoreMap := make(map[string]int)
	for i, store := range order {
		scoreMap[strings.ToLower(store)] = len(order) - i // higher score = better
	}

	// Simple bubble sort for stable store ordering based on scoreMap
	for i := 0; i < len(links)-1; i++ {
		for j := i + 1; j < len(links); j++ {
			s1 := scoreMap[strings.ToLower(links[i].Store)]
			s2 := scoreMap[strings.ToLower(links[j].Store)]
			if s2 > s1 {
				links[i], links[j] = links[j], links[i]
			}
		}
	}
	return links
}

func estimateCPUPrice(cores float32) int {
	switch {
	case cores <= 2:
		return 400 // N100 range
	case cores <= 4:
		return 600 // i3 / Ryzen 3 range
	case cores <= 8:
		return 900 // i5 / Ryzen 5 range
	default:
		return 1200 // i7 / Ryzen 7 range
	}
}

func generateCPULinks(cpuName string) []PurchaseLink {
	return []PurchaseLink{
		{Store: "Amazon", URL: fmt.Sprintf("https://www.amazon.pl/s?k=%s", cpuName)},
		{Store: "Allegro", URL: fmt.Sprintf("https://allegro.pl/listing?string=%s", cpuName)},
		{Store: "x-kom", URL: fmt.Sprintf("https://www.x-kom.pl/szukaj?q=%s", cpuName)},
	}
}
