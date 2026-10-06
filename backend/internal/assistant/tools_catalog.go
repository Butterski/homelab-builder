package assistant

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/google/uuid"
)

const (
	maxHardwareResults = 20
	maxServiceResults  = 100
)

func catalogTools() []*Tool {
	return []*Tool{
		{
			Name:  "search_hardware",
			Title: "Search the hardware catalog",
			Description: "Search HLBuilder's hardware catalog (servers, mini PCs, NAS, routers, switches, access points, disks, GPUs, cards...). " +
				"Returns ids you can pass as hardware_id to add_node or add_component in propose_changes, with specs and estimated prices. " +
				"The response lists the available categories.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{
				"query":{"type":"string","description":"Text matched against brand and model."},
				"category":{"type":"string","description":"Catalog category, e.g. server, minipc, nas, router, switch, access_point, storage, gpu."},
				"brand":{"type":"string"},
				"min_price":{"type":"number","minimum":0},
				"max_price":{"type":"number","minimum":0},
				"limit":{"type":"number","minimum":1,"maximum":20,"description":"Results per page, 20 at most (default 10)."},
				"offset":{"type":"number","minimum":0}
			},"additionalProperties":false}`),
			Scope:    ScopeRead,
			ReadOnly: true,
			handler:  searchHardware,
			describe: describeSearch,
		},
		{
			Name:  "list_services",
			Title: "List self-hosted services",
			Description: "List the self-hosted services HLBuilder knows (Jellyfin, Home Assistant, Pi-hole...) with their RAM, CPU and storage needs. " +
				"Returns ids you can pass as catalog_service_id to add_vm in propose_changes, or to recommend_hardware.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{
				"query":{"type":"string","description":"Text matched against name, description and tags."},
				"category":{"type":"string","description":"Service category from the response's categories list."},
				"limit":{"type":"number","minimum":1,"maximum":100,"description":"Default 40."}
			},"additionalProperties":false}`),
			Scope:    ScopeRead,
			ReadOnly: true,
			handler:  listServices,
			describe: describeSearch,
		},
		{
			Name:  "recommend_hardware",
			Title: "Size hardware for services",
			Description: "Given service ids from list_services, add up their resource needs and return minimal, recommended and optimal " +
				"hardware profiles (RAM, CPU, storage, cost range) with matching catalog hardware.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{
				"service_ids":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":50,"description":"Service ids from list_services."}
			},"required":["service_ids"],"additionalProperties":false}`),
			Scope:    ScopeRead,
			ReadOnly: true,
			handler:  recommendHardware,
			describe: func(args json.RawMessage) string {
				var in struct {
					ServiceIDs []string `json:"service_ids"`
				}
				if json.Unmarshal(args, &in) != nil || len(in.ServiceIDs) == 0 {
					return ""
				}
				return count(len(in.ServiceIDs), "service", "services")
			},
		},
	}
}

// describeSearch names what a catalog search looks for.
func describeSearch(args json.RawMessage) string {
	var in struct {
		Query    string `json:"query"`
		Category string `json:"category"`
		Brand    string `json:"brand"`
	}
	if json.Unmarshal(args, &in) != nil {
		return ""
	}
	words := []string{}
	for _, word := range []string{in.Query, in.Brand, in.Category} {
		if word = strings.TrimSpace(word); word != "" {
			words = append(words, word)
		}
	}
	return strings.Join(words, ", ")
}

// found says how many results a search returned, and out of how many.
func found(shown, total int, one, many string) string {
	if total > shown {
		return fmt.Sprintf("%d of %d %s", shown, total, many)
	}
	return count(shown, one, many)
}

type hardwareView struct {
	ID        uuid.UUID      `json:"id"`
	Category  string         `json:"category"`
	NodeType  string         `json:"node_type"`
	AddWith   string         `json:"add_with"`
	Brand     string         `json:"brand"`
	Model     string         `json:"model"`
	PriceEst  float64        `json:"price_est,omitempty"`
	Currency  string         `json:"currency,omitempty"`
	PowerDraw float64        `json:"power_draw_w,omitempty"`
	Spec      map[string]any `json:"spec,omitempty"`
}

func describeHardware(item models.HardwareComponent) hardwareView {
	nodeType := services.HardwareCategoryToNodeType(item.Category)
	view := hardwareView{
		ID: item.ID, Category: item.Category, NodeType: nodeType, AddWith: "add_node",
		Brand: item.Brand, Model: item.Model, PriceEst: item.PriceEst, Currency: item.Currency, PowerDraw: item.PowerDraw,
	}
	switch nodeType {
	case "disk", "gpu", "hba", "pcie":
		view.AddWith = "add_component"
	}
	if len(item.Spec) > 0 {
		_ = json.Unmarshal(item.Spec, &view.Spec)
	}
	return view
}

func searchHardware(_ context.Context, r *Registry, _ Actor, args json.RawMessage) (*Result, error) {
	var in struct {
		Query    string  `json:"query"`
		Category string  `json:"category"`
		Brand    string  `json:"brand"`
		MinPrice float64 `json:"min_price"`
		MaxPrice float64 `json:"max_price"`
		Limit    float64 `json:"limit"`
		Offset   float64 `json:"offset"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	limit := int(in.Limit)
	if limit <= 0 {
		limit = 10
	}
	if limit > maxHardwareResults {
		limit = maxHardwareResults
	}
	page, err := r.deps.Hardware.GetAll(services.HardwareFilter{
		Category: strings.TrimSpace(in.Category), Brand: strings.TrimSpace(in.Brand), Search: strings.TrimSpace(in.Query),
		MinPrice: in.MinPrice, MaxPrice: in.MaxPrice, Limit: limit, Offset: int(in.Offset),
	})
	if err != nil {
		return nil, err
	}
	items := make([]hardwareView, 0, len(page.Data))
	for _, item := range page.Data {
		items = append(items, describeHardware(item))
	}
	categories, err := r.deps.Hardware.GetCategories()
	if err != nil {
		return nil, err
	}
	return &Result{
		Data:    map[string]any{"total": page.Total, "items": items, "categories": categories},
		Summary: found(len(items), int(page.Total), "result", "results"),
	}, nil
}

type serviceView struct {
	ID            uuid.UUID `json:"id"`
	Name          string    `json:"name"`
	Category      string    `json:"category"`
	Description   string    `json:"description,omitempty"`
	DockerSupport bool      `json:"docker_support"`
	MinRAMMB      int       `json:"min_ram_mb,omitempty"`
	RecRAMMB      int       `json:"recommended_ram_mb,omitempty"`
	MinCPUCores   float32   `json:"min_cpu_cores,omitempty"`
	RecCPUCores   float32   `json:"recommended_cpu_cores,omitempty"`
	MinStorageGB  int       `json:"min_storage_gb,omitempty"`
	RecStorageGB  int       `json:"recommended_storage_gb,omitempty"`
}

func describeService(service models.Service) serviceView {
	view := serviceView{
		ID: service.ID, Name: service.Name, Category: service.Category,
		Description: truncate(service.Description, 220), DockerSupport: service.DockerSupport,
	}
	if requirements := service.Requirements; requirements != nil {
		view.MinRAMMB, view.RecRAMMB = requirements.MinRAMMB, requirements.RecommendedRAMMB
		view.MinCPUCores, view.RecCPUCores = requirements.MinCPUCores, requirements.RecommendedCPUCores
		view.MinStorageGB, view.RecStorageGB = requirements.MinStorageGB, requirements.RecommendedStorageGB
	}
	return view
}

func listServices(_ context.Context, r *Registry, actor Actor, args json.RawMessage) (*Result, error) {
	var in struct {
		Query    string  `json:"query"`
		Category string  `json:"category"`
		Limit    float64 `json:"limit"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	limit := int(in.Limit)
	if limit <= 0 {
		limit = 40
	}
	if limit > maxServiceResults {
		limit = maxServiceResults
	}
	all, err := r.deps.Services.GetAllForUser(actor.UserID)
	if err != nil {
		return nil, err
	}
	query := strings.ToLower(strings.TrimSpace(in.Query))
	category := strings.ToLower(strings.TrimSpace(in.Category))
	categorySet := map[string]bool{}
	matched := make([]serviceView, 0, limit)
	total := 0
	for _, service := range all {
		categorySet[service.Category] = true
		if category != "" && strings.ToLower(service.Category) != category {
			continue
		}
		if query != "" && !strings.Contains(strings.ToLower(service.Name+" "+service.Description+" "+service.Tags), query) {
			continue
		}
		total++
		if len(matched) < limit {
			matched = append(matched, describeService(service))
		}
	}
	categories := make([]string, 0, len(categorySet))
	for name := range categorySet {
		categories = append(categories, name)
	}
	sort.Strings(categories)
	return &Result{
		Data:    map[string]any{"total": total, "items": matched, "categories": categories},
		Summary: found(len(matched), total, "service", "services"),
	}, nil
}

type specView struct {
	TotalRAMMB        int            `json:"total_ram_mb"`
	TotalCPUCores     float32        `json:"total_cpu_cores"`
	TotalStorageGB    int            `json:"total_storage_gb"`
	CPUSuggestion     string         `json:"cpu_suggestion,omitempty"`
	RAMSuggestion     string         `json:"ram_suggestion,omitempty"`
	StorageSuggestion string         `json:"storage_suggestion,omitempty"`
	NetworkSuggestion string         `json:"network_suggestion,omitempty"`
	Rationale         string         `json:"rationale,omitempty"`
	EstimatedCostMin  int            `json:"estimated_cost_min,omitempty"`
	EstimatedCostMax  int            `json:"estimated_cost_max,omitempty"`
	HardwareMatches   []hardwareView `json:"hardware_matches"`
}

func describeSpec(spec services.Spec) specView {
	view := specView{
		TotalRAMMB: spec.TotalRAMMB, TotalCPUCores: spec.TotalCPUCores, TotalStorageGB: spec.TotalStorageGB,
		CPUSuggestion: spec.CPUSuggestion, RAMSuggestion: spec.RAMSuggestion, StorageSuggestion: spec.StorageSuggestion,
		NetworkSuggestion: spec.NetworkSuggestion, Rationale: spec.Rationale,
		EstimatedCostMin: spec.EstimatedCostMin, EstimatedCostMax: spec.EstimatedCostMax,
		HardwareMatches: make([]hardwareView, 0, len(spec.HardwareMatches)),
	}
	for _, match := range spec.HardwareMatches {
		view.HardwareMatches = append(view.HardwareMatches, describeHardware(match))
	}
	return view
}

func recommendHardware(_ context.Context, r *Registry, actor Actor, args json.RawMessage) (*Result, error) {
	var in struct {
		ServiceIDs []string `json:"service_ids"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	// Only services this user can see may be sized; ids alone are not enough.
	visible, err := r.deps.Services.GetAllForUser(actor.UserID)
	if err != nil {
		return nil, err
	}
	allowed := make(map[uuid.UUID]bool, len(visible))
	for _, service := range visible {
		allowed[service.ID] = true
	}
	ids := make([]uuid.UUID, 0, len(in.ServiceIDs))
	for _, raw := range in.ServiceIDs {
		id, err := uuid.Parse(strings.TrimSpace(raw))
		if err != nil || !allowed[id] {
			return nil, toolErrorf("service %q is not in the catalog; use ids from list_services", raw)
		}
		ids = append(ids, id)
	}
	recommendation, err := r.deps.Recommendations.Generate(services.RecommendationRequest{ServiceIDs: ids})
	if err != nil {
		return nil, &ToolError{Message: err.Error()}
	}
	selected := make([]string, 0, len(recommendation.SelectedServices))
	for _, service := range recommendation.SelectedServices {
		selected = append(selected, service.Name)
	}
	return &Result{Summary: "3 hardware profiles", Data: map[string]any{
		"services":         selected,
		"summary":          recommendation.Summary,
		"minimal":          describeSpec(recommendation.MinimalSpec),
		"recommended":      describeSpec(recommendation.RecommendedSpec),
		"optimal":          describeSpec(recommendation.OptimalSpec),
		"insights":         recommendation.Insights,
		"heaviest_service": recommendation.HeaviestService,
		"tier_comparison":  recommendation.TierComparison,
	}}, nil
}
