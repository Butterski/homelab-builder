package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type AdminHandler struct {
	db             *gorm.DB
	serviceService *services.ServiceService
}

func NewAdminHandler(db *gorm.DB, serviceService *services.ServiceService) *AdminHandler {
	return &AdminHandler{db: db, serviceService: serviceService}
}

// Dashboard - basic stats
func (h *AdminHandler) Dashboard(c *gin.Context) {
	var serviceCount int64
	h.db.Model(&models.Service{}).Where("is_active = ?", true).Count(&serviceCount)

	var userCount int64
	h.db.Model(&models.User{}).Count(&userCount)

	var eventCount int64
	h.db.Model(&models.Event{}).Count(&eventCount)

	var buildCount int64
	h.db.Model(&models.Build{}).Count(&buildCount)

	var avgNodes float64
	var avgVMs float64
	if buildCount > 0 {
		var nodeCount int64
		h.db.Model(&models.Node{}).Count(&nodeCount)
		avgNodes = float64(nodeCount) / float64(buildCount)

		var vmCount int64
		h.db.Model(&models.VirtualMachine{}).Count(&vmCount)
		avgVMs = float64(vmCount) / float64(buildCount)
	}

	// Standalone Node Type Distribution
	type NodeDist struct {
		Type  string `json:"type"`
		Count int64  `json:"count"`
	}
	var nodeDist []NodeDist
	h.db.Model(&models.Node{}).Select("type, count(id) as count").Group("type").Order("count DESC").Scan(&nodeDist)

	// Brand Market Share (Based on node details and titles)
	type BrandShare struct {
		Brand string `json:"brand"`
		Count int64  `json:"count"`
	}
	var brandShare []BrandShare
	h.db.Raw(`
		SELECT COALESCE(NULLIF(details->>'brand', ''), split_part(name, ' ', 1)) as brand, COUNT(id) as count
		FROM nodes
		WHERE COALESCE(NULLIF(details->>'brand', ''), split_part(name, ' ', 1)) IS NOT NULL AND COALESCE(NULLIF(details->>'brand', ''), split_part(name, ' ', 1)) != ''
		GROUP BY brand
		ORDER BY count DESC
		LIMIT 10
	`).Scan(&brandShare)

	// Most popular services active in designs
	type ActiveServiceDist struct {
		Name  string `json:"name"`
		Count int64  `json:"count"`
	}
	var activeServiceDist []ActiveServiceDist
	h.db.Model(&models.ServiceInstance{}).Select("name, count(id) as count").Group("name").Order("count DESC").Limit(10).Scan(&activeServiceDist)

	// Most popular services (by catalog selection count)
	type PopularService struct {
		ServiceName string `json:"service_name"`
		Count       int    `json:"count"`
	}
	var popular []PopularService
	h.db.Raw(`
		SELECT s.name as service_name, COUNT(us.id) as count
		FROM user_selections us
		JOIN services s ON s.id = us.service_id
		GROUP BY s.name
		ORDER BY count DESC
		LIMIT 5
	`).Scan(&popular)

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"total_services":               serviceCount,
			"total_users":                  userCount,
			"total_selections":             eventCount,
			"total_builds":                 buildCount,
			"avg_nodes_per_build":          avgNodes,
			"avg_vms_per_build":            avgVMs,
			"node_distribution":            nodeDist,
			"brand_market_share":           brandShare,
			"active_services_distribution": activeServiceDist,
			"popular_services":             popular,
		},
	})
}

// ListUsers - list all users with enriched statistics (privacy safe: only counts)
func (h *AdminHandler) ListUsers(c *gin.Context) {
	type UserStat struct {
		ID          uuid.UUID `json:"id"`
		Email       string    `json:"email"`
		Name        string    `json:"name"`
		AvatarURL   string    `json:"avatar_url"`
		IsAdmin     bool      `json:"is_admin"`
		CreatedAt   time.Time `json:"created_at"`
		BuildsCount int64     `json:"builds_count"`
		NodesCount  int64     `json:"nodes_count"`
		VMsCount    int64     `json:"vms_count"`
	}
	var userStats []UserStat
	err := h.db.Raw(`
		SELECT u.id, u.email, u.name, u.avatar_url, u.is_admin, u.created_at,
		       (SELECT COUNT(*) FROM builds b WHERE b.user_id = u.id) as builds_count,
		       (SELECT COUNT(*) FROM nodes n JOIN builds b ON n.build_id = b.id WHERE b.user_id = u.id) as nodes_count,
		       (SELECT COUNT(*) FROM virtual_machines vm JOIN nodes n ON vm.node_id = n.id JOIN builds b ON n.build_id = b.id WHERE b.user_id = u.id) as vms_count
		FROM users u
		ORDER BY u.created_at DESC
		LIMIT 100
	`).Scan(&userStats).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query active homelabers"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": userStats})
}

// ListAllServices - list all services including inactive
func (h *AdminHandler) ListAllServices(c *gin.Context) {
	var svcs []models.Service
	h.db.Preload("Requirements").Order("category, name").Find(&svcs)
	c.JSON(http.StatusOK, gin.H{"data": svcs})
}

// ToggleServiceActive - activate/deactivate a service
func (h *AdminHandler) ToggleServiceActive(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid service ID"})
		return
	}

	var service models.Service
	if err := h.db.First(&service, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Service not found"})
		return
	}

	service.IsActive = !service.IsActive
	h.db.Save(&service)

	c.JSON(http.StatusOK, gin.H{"data": service, "message": "Service toggled"})
}

// RecentEvents - get recent analytics events
func (h *AdminHandler) RecentEvents(c *gin.Context) {
	var events []models.Event
	h.db.Order("created_at DESC").Limit(50).Find(&events)
	c.JSON(http.StatusOK, gin.H{"data": events})
}

// UpdateServiceFull - full PUT for an existing service (including requirements)
func (h *AdminHandler) UpdateServiceFull(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid service ID"})
		return
	}

	var input services.UpdateServiceInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	service, err := h.serviceService.Update(id, input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update service"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": service, "message": "Service updated"})
}

// DeleteService - hard delete for a service
func (h *AdminHandler) DeleteService(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid service ID"})
		return
	}

	if err := h.serviceService.HardDelete(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete service"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Service permanently deleted"})
}

// ExportAnonymizedTopologies - exports privacy-safe, fully anonymous visual builds data (no user or network PII)
func (h *AdminHandler) ExportAnonymizedTopologies(c *gin.Context) {
	var builds []models.Build
	if err := h.db.Preload("Nodes").Preload("Edges").Preload("Nodes.VirtualMachines").Preload("Nodes.ServiceInstances").Find(&builds).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to compile anonymous topology data"})
		return
	}

	type ExportedNode struct {
		Type     string   `json:"type"`
		Brand    string   `json:"brand"`
		Model    string   `json:"model"`
		Power    float64  `json:"power_draw"`
		VMsCount int      `json:"vms_count"`
		Services []string `json:"services"`
	}

	type ExportedEdge struct {
		SourceType string `json:"source_type"`
		TargetType string `json:"target_type"`
		Type       string `json:"connection_type"`
		Speed      string `json:"speed"`
	}

	type ExportedBuild struct {
		BuildID string         `json:"build_id"`
		Nodes   []ExportedNode `json:"nodes"`
		Edges   []ExportedEdge `json:"edges"`
	}

	var dataset []ExportedBuild

	for _, b := range builds {
		nodeMap := make(map[uuid.UUID]models.Node)
		for _, n := range b.Nodes {
			nodeMap[n.ID] = n
		}

		var eNodes []ExportedNode
		for _, n := range b.Nodes {
			var services []string
			for _, s := range n.ServiceInstances {
				services = append(services, s.Name)
			}

			// Extract brand/model from name or details
			brand := n.Type
			model := n.Name
			hNodes := make(map[string]interface{})
			if len(n.Details) > 0 {
				_ = json.Unmarshal(n.Details, &hNodes)
			}
			if bVal, ok := hNodes["brand"].(string); ok && bVal != "" {
				brand = bVal
			}
			if mVal, ok := hNodes["model"].(string); ok && mVal != "" {
				model = mVal
			}

			eNodes = append(eNodes, ExportedNode{
				Type:     n.Type,
				Brand:    brand,
				Model:    model,
				Power:    n.PowerDraw,
				VMsCount: len(n.VirtualMachines),
				Services: services,
			})
		}

		var eEdges []ExportedEdge
		for _, e := range b.Edges {
			src, srcOk := nodeMap[e.SourceNodeID]
			tgt, tgtOk := nodeMap[e.TargetNodeID]
			if srcOk && tgtOk {
				eEdges = append(eEdges, ExportedEdge{
					SourceType: src.Type,
					TargetType: tgt.Type,
					Type:       e.Type,
					Speed:      e.Speed,
				})
			}
		}

		dataset = append(dataset, ExportedBuild{
			BuildID: b.ID.String(),
			Nodes:   eNodes,
			Edges:   eEdges,
		})
	}

	c.Header("Content-Disposition", "attachment; filename=homelab_topologies_anonymized.json")
	c.JSON(http.StatusOK, dataset)
}

