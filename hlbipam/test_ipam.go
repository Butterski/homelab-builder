//go:build ignore

package main

import (
	"encoding/json"
	"fmt"

	"github.com/Butterski/hlbipam/internal/core"
	"github.com/Butterski/hlbipam/internal/models"
)

func main() {
	req := models.AllocateRequest{
		Routers: []models.RouterDTO{
			{ID: "router", GatewayIP: "192.168.1.1", DHCPEnabled: true},
		},
		Nodes: []models.NodeDTO{
			{ID: "switch", Type: "switch", Connections: []string{"router", "pc1", "pc2", "pc3", "pc4", "pc5", "pc6", "pc7", "pc8"}},
			{ID: "pc1", Type: "pc", Connections: []string{"switch"}},
			{ID: "pc2", Type: "pc", Connections: []string{"switch"}},
			{ID: "pc3", Type: "pc", Connections: []string{"switch"}},
			{ID: "pc4", Type: "pc", Connections: []string{"switch"}},
			{ID: "pc5", Type: "pc", Connections: []string{"switch"}},
			{ID: "pc6", Type: "pc", Connections: []string{"switch"}},
			{ID: "pc7", Type: "pc", Connections: []string{"switch"}},
			{ID: "pc8", Type: "pc", Connections: []string{"switch"}},
		},
	}
	res := core.Allocate(req)
	out, _ := json.MarshalIndent(res, "", "  ")
	fmt.Println(string(out))
}
