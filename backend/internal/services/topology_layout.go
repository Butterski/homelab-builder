package services

import (
	"fmt"
	"math"
)

// Canvas geometry, mirrored from the builder (rack-node-constants.ts and the
// rendered node cards) so server-placed nodes land where a person would drop them.
const (
	layoutGrid        = 20.0
	layoutStepX       = 280.0
	layoutStepY       = 260.0
	layoutNodeWidth   = 250.0
	layoutNodeHeight  = 210.0
	layoutOriginX     = 80.0
	layoutOriginY     = 80.0
	rackUnitHeightPx  = 90.0
	rackWidthPx       = 280.0
	rackHeaderPx      = 40.0
	rackFooterPx      = 8.0
	rackRailWidthPx   = 28.0
	defaultRackSizeU  = 24
	maxRackSizeU      = 60
	layoutSearchSteps = 12
)

var defaultRackUnits = map[string]int{
	"server": 2, "server_v2": 2, "firewall": 1, "vps": 1, "switch": 1, "router": 2,
	"nas": 2, "pc": 4, "minipc": 1, "sbc": 1, "access_point": 1, "ups": 4, "pdu": 1,
	"hba": 1, "gpu": 2, "cpu": 1, "disk": 1, "pcie": 1, "iot": 1, "modem": 1,
}

type layoutBox struct{ x, y, w, h float64 }

func (b layoutBox) overlaps(other layoutBox) bool {
	return b.x < other.x+other.w && other.x < b.x+b.w && b.y < other.y+other.h && other.y < b.y+b.h
}

func snapToGrid(value float64) float64 {
	return math.Round(value/layoutGrid) * layoutGrid
}

func rackSizeOf(rack NodeDTO) int {
	if size, ok := asNumber(rack.Details["rack_size"]); ok && size >= 1 {
		return int(size)
	}
	return defaultRackSizeU
}

func rackUnitsOf(node NodeDTO) int {
	if units, ok := asNumber(node.Details["rack_units"]); ok && units >= 1 {
		return int(units)
	}
	if units, ok := defaultRackUnits[node.Type]; ok {
		return units
	}
	return 1
}

// rackSlotOf returns the U slot a racked node occupies (0 = top).
func rackSlotOf(node NodeDTO) int {
	if slot, ok := asNumber(node.Details["rack_position"]); ok && slot >= 0 {
		return int(slot)
	}
	slot := int(math.Round((node.Y - rackHeaderPx) / rackUnitHeightPx))
	if slot < 0 {
		return 0
	}
	return slot
}

// allocateRackSlot finds where a device of the given height fits in a rack.
// requested pins a specific slot; nil takes the first gap from the top.
func allocateRackSlot(nodes []NodeDTO, rack NodeDTO, deviceID, deviceName string, units int, requested *int) (int, error) {
	size := rackSizeOf(rack)
	if units > size {
		return 0, fmt.Errorf("%q needs %dU but rack %q only has %dU", deviceName, units, rack.Name, size)
	}
	occupied := make([]bool, size)
	for _, node := range nodes {
		if node.ParentID == nil || *node.ParentID != rack.ID || node.ID == deviceID {
			continue
		}
		start := rackSlotOf(node)
		for slot := start; slot < start+rackUnitsOf(node) && slot < size; slot++ {
			occupied[slot] = true
		}
	}
	fits := func(start int) bool {
		if start < 0 || start+units > size {
			return false
		}
		for slot := start; slot < start+units; slot++ {
			if occupied[slot] {
				return false
			}
		}
		return true
	}
	if requested != nil {
		if !fits(*requested) {
			return 0, fmt.Errorf("rack %q has no room for %dU at slot %d (slots are 0-%d from the top)", rack.Name, units, *requested, size-1)
		}
		return *requested, nil
	}
	for start := 0; start+units <= size; start++ {
		if fits(start) {
			return start, nil
		}
	}
	return 0, fmt.Errorf("rack %q is full: no free %dU gap in %dU", rack.Name, units, size)
}

func rackSlotPosition(slot int) (float64, float64) {
	return rackRailWidthPx, rackHeaderPx + float64(slot)*rackUnitHeightPx
}

// absolutePosition resolves a node's canvas position; racked nodes store
// coordinates relative to their rack.
func absolutePosition(node NodeDTO, byID map[string]NodeDTO) (float64, float64) {
	if node.ParentID != nil {
		if parent, ok := byID[*node.ParentID]; ok {
			return parent.X + node.X, parent.Y + node.Y
		}
	}
	return node.X, node.Y
}

func nodeBox(node NodeDTO) layoutBox {
	if node.Type == "rack" {
		height := rackHeaderPx + float64(rackSizeOf(node))*rackUnitHeightPx + rackFooterPx
		return layoutBox{node.X, node.Y, rackWidthPx, height}
	}
	return layoutBox{node.X, node.Y, layoutNodeWidth, layoutNodeHeight}
}

// placeNodes assigns canvas positions to the nodes in pending, in order. A node
// goes below a neighbour it is cabled to (upstream first); unconnected nodes
// start a row under everything else, and racks go to the right.
func placeNodes(nodes []NodeDTO, edges []EdgeDTO, pending []string) {
	if len(pending) == 0 {
		return
	}
	index := make(map[string]int, len(nodes))
	for i, node := range nodes {
		index[node.ID] = i
	}
	waiting := make(map[string]bool, len(pending))
	for _, id := range pending {
		waiting[id] = true
	}

	placedBoxes := func() []layoutBox {
		boxes := make([]layoutBox, 0, len(nodes))
		for _, node := range nodes {
			if waiting[node.ID] || node.ParentID != nil {
				continue
			}
			boxes = append(boxes, nodeBox(node))
		}
		return boxes
	}
	isFree := func(candidate layoutBox, boxes []layoutBox) bool {
		for _, box := range boxes {
			if candidate.overlaps(box) {
				return false
			}
		}
		return true
	}
	byID := func() map[string]NodeDTO {
		lookup := make(map[string]NodeDTO, len(nodes))
		for _, node := range nodes {
			lookup[node.ID] = node
		}
		return lookup
	}
	// anchorFor returns a placed neighbour, preferring the upstream (source) side.
	anchorFor := func(id string) (NodeDTO, bool) {
		var fallback *NodeDTO
		for _, edge := range edges {
			if edge.Target == id && !waiting[edge.Source] {
				if i, ok := index[edge.Source]; ok {
					return nodes[i], true
				}
			}
			if edge.Source == id && !waiting[edge.Target] && fallback == nil {
				if i, ok := index[edge.Target]; ok {
					neighbour := nodes[i]
					fallback = &neighbour
				}
			}
		}
		if fallback != nil {
			return *fallback, true
		}
		return NodeDTO{}, false
	}

	remaining := append([]string(nil), pending...)
	for len(remaining) > 0 {
		// Place nodes that already have a positioned neighbour first, so chains
		// unfold from the existing topology outwards.
		pick := 0
		for i, id := range remaining {
			if _, ok := anchorFor(id); ok {
				pick = i
				break
			}
		}
		id := remaining[pick]
		remaining = append(remaining[:pick], remaining[pick+1:]...)
		i, ok := index[id]
		if !ok {
			continue
		}

		boxes := placedBoxes()
		minX, minY, maxX, maxY := layoutOriginX, layoutOriginY, layoutOriginX, layoutOriginY
		for n, box := range boxes {
			if n == 0 {
				minX, minY, maxX, maxY = box.x, box.y, box.x+box.w, box.y+box.h
				continue
			}
			minX, minY = math.Min(minX, box.x), math.Min(minY, box.y)
			maxX, maxY = math.Max(maxX, box.x+box.w), math.Max(maxY, box.y+box.h)
		}

		node := &nodes[i]
		size := nodeBox(*node)
		place := func(x, y float64) bool {
			candidate := layoutBox{snapToGrid(x), snapToGrid(y), size.w, size.h}
			if !isFree(candidate, boxes) {
				return false
			}
			node.X, node.Y = candidate.x, candidate.y
			return true
		}

		placed := false
		switch {
		case node.Type == "rack":
			x := layoutOriginX
			if len(boxes) > 0 {
				x = maxX + 60
			}
			for step := 0; step < layoutSearchSteps*4 && !placed; step++ {
				placed = place(x+float64(step)*(rackWidthPx+40), minY)
			}
		case len(boxes) == 0:
			placed = place(layoutOriginX, layoutOriginY)
		default:
			if anchor, hasAnchor := anchorFor(id); hasAnchor {
				ax, ay := absolutePosition(anchor, byID())
				for row := 1; row <= 3 && !placed; row++ {
					y := ay + float64(row)*layoutStepY
					for step := 0; step <= layoutSearchSteps && !placed; step++ {
						placed = place(ax+float64(step)*layoutStepX, y)
						if !placed && step > 0 {
							placed = place(ax-float64(step)*layoutStepX, y)
						}
					}
				}
			}
			for step := 0; step < layoutSearchSteps*8 && !placed; step++ {
				placed = place(minX+float64(step)*layoutStepX, maxY+50)
			}
		}
		if !placed {
			node.X, node.Y = snapToGrid(maxX+60), snapToGrid(maxY+50)
		}
		delete(waiting, id)
	}
}
