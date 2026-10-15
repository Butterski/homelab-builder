package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/version"
	"github.com/Butterski/homelab-builder/backend/internal/wiring"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Before power wiring, a UPS had network ports and any cable with a UPS at one
// end was its power feed. Such a cable is stored as an ethernet (or wireless,
// or vpn) edge between network handles. A UPS has sockets only now, so the
// canvas cannot draw that cable, nothing can remove it, and every save of the
// build is refused ("UPS is a ups and has no network port").

// LegacyPowerReport says what ConvertLegacyPowerCables changed.
type LegacyPowerReport struct {
	Builds    int // builds that had such cables
	Converted int // cables that became power cables
	Dropped   int // cables that had nothing left to say
}

// ConvertLegacyPowerCables turns every stored cable between a power source and
// another device that is not a power cable into one: from a free socket of
// the source to a free power input of the device, as the old model meant it.
// A cable is dropped when the device has no power input, or every input is
// already plugged in, or a power cable already joins the two, or it would
// close a loop. Each build changes in a transaction of its own and gets a new
// revision, so an open canvas loads it again. It is safe to run on every
// startup: a converted build is not touched again.
func ConvertLegacyPowerCables(db *gorm.DB) (LegacyPowerReport, error) {
	var report LegacyPowerReport
	sources := wiring.PowerSourceTypes()
	var buildIDs []uuid.UUID
	err := db.Raw(`SELECT DISTINCT e.build_id FROM edges e
		JOIN nodes s ON s.id = e.source_node_id
		JOIN nodes t ON t.id = e.target_node_id
		WHERE COALESCE(e.type, '') <> ? AND (s.type IN ? OR t.type IN ?)`,
		wiring.EdgeTypePower, sources, sources).Scan(&buildIDs).Error
	if err != nil {
		return report, err
	}
	var failures []error
	for _, buildID := range buildIDs {
		var plan legacyPowerPlan
		err := db.Transaction(func(tx *gorm.DB) error {
			var err error
			plan, err = convertLegacyPowerCablesTx(tx, buildID)
			return err
		})
		if err != nil {
			failures = append(failures, fmt.Errorf("build %s: %w", buildID, err))
			continue
		}
		if plan.empty() {
			continue
		}
		report.Builds++
		report.Converted += len(plan.converted)
		report.Dropped += len(plan.dropped)
	}
	return report, errors.Join(failures...)
}

func convertLegacyPowerCablesTx(tx *gorm.DB, buildID uuid.UUID) (legacyPowerPlan, error) {
	// The same lock a save takes: the plan is made from what is stored now.
	var build models.Build
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "user_id", "name").First(&build, "id = ?", buildID).Error; err != nil {
		return legacyPowerPlan{}, err
	}
	nodes, edges, err := loadTopology(tx, buildID)
	if err != nil {
		return legacyPowerPlan{}, err
	}
	plan := planLegacyPowerCables(nodes, edges)
	if plan.empty() {
		return plan, nil
	}
	for _, edge := range plan.converted {
		err := tx.Model(&models.Edge{}).Where("id = ?", edge.ID).Updates(map[string]any{
			"type":           edge.Type,
			"source_node_id": edge.SourceNodeID,
			"source_handle":  edge.SourceHandle,
			"target_node_id": edge.TargetNodeID,
			"target_handle":  edge.TargetHandle,
		}).Error
		if err != nil {
			return plan, err
		}
	}
	if len(plan.dropped) > 0 {
		if err := tx.Where("id IN ?", plan.dropped).Delete(&models.Edge{}).Error; err != nil {
			return plan, err
		}
	}
	for _, node := range nodes {
		outlets, grown := plan.outlets[node.ID]
		if !grown {
			continue
		}
		details, err := detailsMap(node.Details)
		if err != nil {
			return plan, fmt.Errorf("details of %s: %w", node.Name, err)
		}
		details["outlets"] = outlets
		raw, err := json.Marshal(details)
		if err != nil {
			return plan, err
		}
		if err := tx.Model(&models.Node{}).Where("id = ?", node.ID).Update("details", json.RawMessage(raw)).Error; err != nil {
			return plan, err
		}
	}
	if err := writePowerLoads(tx, buildID); err != nil {
		return plan, err
	}
	// The owner is told in the What's new dialog.
	details, err := json.Marshal(plan.notice)
	if err != nil {
		return plan, err
	}
	notice := models.UserNotice{
		UserID: build.UserID, BuildID: build.ID, BuildName: build.Name,
		Kind: NoticePowerCables, Version: version.Version, Details: details,
	}
	if err := tx.Create(&notice).Error; err != nil {
		return plan, err
	}
	// updated_at stays: the owner did not edit the build.
	return plan, tx.Model(&models.Build{}).Where("id = ?", buildID).
		UpdateColumn("revision", gorm.Expr("revision + 1")).Error
}

// NoticePowerCables is the kind of the UserNotice the conversion writes.
const NoticePowerCables = "power_cables"

// Why an old cable was removed instead of converted.
const (
	DropNoPowerInput  = "no_power_input"    // the device takes no power cable
	DropInputsInUse   = "inputs_in_use"     // every power input is plugged in already
	DropAlreadyJoined = "already_connected" // a power cable joins the two already
	DropLoop          = "loop"              // it would close a power loop
	DropNoSocket      = "no_socket"         // the source has every socket it can have in use
)

// PowerCablesNotice is the Details of a "power_cables" notice.
type PowerCablesNotice struct {
	Converted []NoticeCable `json:"converted"`
	Dropped   []NoticeCable `json:"dropped"`
}

// NoticeCable names a cable by its two devices as they were named then. The
// source is the end that feeds.
type NoticeCable struct {
	SourceID string `json:"source_id"`
	Source   string `json:"source"`
	TargetID string `json:"target_id"`
	Target   string `json:"target"`
	Reason   string `json:"reason,omitempty"`
}

// legacyPowerPlan is what becomes of the old cables of one build.
type legacyPowerPlan struct {
	converted []models.Edge     // rewritten as power cables, same ids
	dropped   []uuid.UUID       // removed
	outlets   map[uuid.UUID]int // sources that need more sockets: the new count
	notice    PowerCablesNotice // what the owner is told
}

func (p legacyPowerPlan) empty() bool {
	return len(p.converted) == 0 && len(p.dropped) == 0
}

// feedOrder is how power flows when both ends of an old cable are power
// sources: from the wall to a UPS to a PDU.
var feedOrder = []string{"power_outlet", "ups", "pdu"}

// planLegacyPowerCables works out the plan from a build's nodes and its edges
// in stored order. Power cables already drawn keep their sockets and inputs.
func planLegacyPowerCables(nodes []models.Node, edges []models.Edge) legacyPowerPlan {
	plan := legacyPowerPlan{
		outlets: map[uuid.UUID]int{},
		notice:  PowerCablesNotice{Converted: []NoticeCable{}, Dropped: []NoticeCable{}},
	}
	byID := make(map[uuid.UUID]models.Node, len(nodes))
	details := make(map[uuid.UUID]map[string]any, len(nodes))
	for _, node := range nodes {
		byID[node.ID] = node
		details[node.ID], _ = detailsMap(node.Details)
	}
	usedOut := map[uuid.UUID]map[int]bool{}
	usedIn := map[uuid.UUID]map[int]bool{}
	feeds := map[uuid.UUID][]uuid.UUID{}
	plug := func(feeder uuid.UUID, socket int, fed uuid.UUID, input int) {
		if usedOut[feeder] == nil {
			usedOut[feeder] = map[int]bool{}
		}
		if usedIn[fed] == nil {
			usedIn[fed] = map[int]bool{}
		}
		usedOut[feeder][socket] = true
		usedIn[fed][input] = true
		feeds[feeder] = append(feeds[feeder], fed)
	}
	for _, edge := range edges {
		if edge.Type == wiring.EdgeTypePower {
			plug(edge.SourceNodeID,
				wiring.PowerHandleIndex(edge.SourceHandle, wiring.PowerOutPrefix),
				edge.TargetNodeID,
				wiring.PowerHandleIndex(edge.TargetHandle, wiring.PowerInPrefix))
		}
	}

	for _, edge := range edges {
		if edge.Type == wiring.EdgeTypePower {
			continue
		}
		source, okSource := byID[edge.SourceNodeID]
		target, okTarget := byID[edge.TargetNodeID]
		if !okSource || !okTarget || (!wiring.IsPowerSource(source.Type) && !wiring.IsPowerSource(target.Type)) {
			continue
		}
		feeder, fed := source, target
		if feedsInstead(target.Type, source.Type) {
			feeder, fed = target, source
		}
		cable := NoticeCable{SourceID: feeder.ID.String(), Source: feeder.Name, TargetID: fed.ID.String(), Target: fed.Name}
		drop := func(reason string) {
			cable.Reason = reason
			plan.dropped = append(plan.dropped, edge.ID)
			plan.notice.Dropped = append(plan.notice.Dropped, cable)
		}
		inputs := wiring.PowerInputCount(fed.Type, details[fed.ID])
		input := firstFree(usedIn[fed.ID], inputs)
		socket := firstFree(usedOut[feeder.ID], wiring.MaxPowerOutputs)
		switch {
		case inputs == 0:
			drop(DropNoPowerInput)
			continue
		case slices.Contains(feeds[feeder.ID], fed.ID):
			drop(DropAlreadyJoined)
			continue
		case input < 0:
			drop(DropInputsInUse)
			continue
		case powerReaches(feeds, fed.ID, feeder.ID):
			drop(DropLoop)
			continue
		case socket < 0:
			drop(DropNoSocket)
			continue
		}
		sockets := wiring.PowerOutputCount(feeder.Type, details[feeder.ID])
		if grown, ok := plan.outlets[feeder.ID]; ok {
			sockets = grown
		}
		if socket >= sockets {
			plan.outlets[feeder.ID] = socket + 1
		}
		plug(feeder.ID, socket, fed.ID, input)
		converted := edge
		converted.Type = wiring.EdgeTypePower
		converted.SourceNodeID, converted.SourceHandle = feeder.ID, wiring.PowerOutPrefix+strconv.Itoa(socket)
		converted.TargetNodeID, converted.TargetHandle = fed.ID, wiring.PowerInPrefix+strconv.Itoa(input)
		plan.converted = append(plan.converted, converted)
		plan.notice.Converted = append(plan.notice.Converted, cable)
	}
	return plan
}

// feedsInstead reports whether the drawn target of an old cable is the one
// that feeds: it is a power source and the drawn source is not, or it comes
// first in feedOrder.
func feedsInstead(targetType, sourceType string) bool {
	if !wiring.IsPowerSource(targetType) {
		return false
	}
	if !wiring.IsPowerSource(sourceType) {
		return true
	}
	return slices.Index(feedOrder, targetType) < slices.Index(feedOrder, sourceType)
}

// firstFree is the lowest index below limit that is not used, or -1.
func firstFree(used map[int]bool, limit int) int {
	for index := range limit {
		if !used[index] {
			return index
		}
	}
	return -1
}

// powerReaches reports whether power already flows from one node to another.
func powerReaches(feeds map[uuid.UUID][]uuid.UUID, from, to uuid.UUID) bool {
	seen := map[uuid.UUID]bool{}
	stack := []uuid.UUID{from}
	for len(stack) > 0 {
		node := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if node == to {
			return true
		}
		if seen[node] {
			continue
		}
		seen[node] = true
		stack = append(stack, feeds[node]...)
	}
	return false
}
