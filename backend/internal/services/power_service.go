package services

import (
	"encoding/json"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/wiring"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// wiringInput loads a saved build as the input of the wiring checks. Each
// node's draw includes the draw of its internal components.
func wiringInput(db *gorm.DB, buildID uuid.UUID) ([]wiring.Node, []wiring.Edge, error) {
	nodes, edges, err := loadTopology(db, buildID)
	if err != nil {
		return nil, nil, err
	}
	ids := make([]uuid.UUID, len(nodes))
	for i, node := range nodes {
		ids[i] = node.ID
	}
	componentDraw := map[uuid.UUID]float64{}
	if len(ids) > 0 {
		var rows []struct {
			NodeID uuid.UUID
			Total  float64
		}
		err := db.Model(&models.NodeComponent{}).
			Select("node_id, COALESCE(SUM(power_draw), 0) AS total").
			Where("node_id IN ?", ids).Group("node_id").Scan(&rows).Error
		if err != nil {
			return nil, nil, err
		}
		for _, row := range rows {
			componentDraw[row.NodeID] = row.Total
		}
	}

	out := make([]wiring.Node, len(nodes))
	for i, node := range nodes {
		details, _ := detailsMap(node.Details)
		out[i] = wiring.Node{
			ID: node.ID.String(), Name: node.Name, Type: node.Type, Details: details,
			DrawW: node.PowerDraw + componentDraw[node.ID],
		}
	}
	links := make([]wiring.Edge, len(edges))
	for i, edge := range edges {
		links[i] = wiring.Edge{
			Source: edge.SourceNodeID.String(), SourceHandle: edge.SourceHandle,
			Target: edge.TargetNodeID.String(), TargetHandle: edge.TargetHandle,
			Type: edge.Type,
		}
	}
	return out, links, nil
}

// writePowerLoads stores details.power_load on every power source of a build
// and removes stale ones from nodes that are no longer power sources.
func writePowerLoads(tx *gorm.DB, buildID uuid.UUID) error {
	nodes, edges, err := wiringInput(tx, buildID)
	if err != nil {
		return err
	}
	loads := wiring.PowerLoads(nodes, edges)
	for _, node := range nodes {
		load, isSource := loads[node.ID]
		_, stale := node.Details["power_load"]
		if !isSource && !stale {
			continue
		}
		details := node.Details
		if details == nil {
			details = map[string]any{}
		}
		if isSource {
			details["power_load"] = load
		} else {
			delete(details, "power_load")
		}
		raw, err := json.Marshal(details)
		if err != nil {
			return err
		}
		if err := tx.Model(&models.Node{}).Where("id = ?", node.ID).Update("details", json.RawMessage(raw)).Error; err != nil {
			return err
		}
	}
	return nil
}
