package services

import (
	"fmt"

	"github.com/Butterski/homelab-builder/backend/internal/wiring"
)

// validateWiringDetails checks the per-port settings and VLAN definitions a
// save carries in node details.
func validateWiringDetails(nodes []NodeDTO) error {
	for _, node := range nodes {
		if err := wiring.ValidatePortConfig(node.Type, node.Details, PortCount(node.Type, node.Details)); err != nil {
			return fmt.Errorf("%w: %s: %v", ErrInvalidTopology, node.Name, err)
		}
		if err := wiring.ValidateVLANs(node.Type, node.Details); err != nil {
			return fmt.Errorf("%w: %s: %v", ErrInvalidTopology, node.Name, err)
		}
	}
	return nil
}
