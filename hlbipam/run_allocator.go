package main

import (
	"encoding/json"
	"fmt"
	"log"

	"github.com/Butterski/hlbipam/internal/core"
	"github.com/Butterski/hlbipam/internal/models"
)

func main() {
	req := models.AllocateRequest{
		Routers: []models.RouterDTO{
			{
				ID:          "r",
				GatewayIP:   "192.168.0.1",
				DHCPEnabled: true,
			},
		},
		Nodes: []models.NodeDTO{
			{ID: "r", Type: "router", Connections: []string{"sw", "ups", "pc", "ap"}},
			{ID: "sw", Type: "switch", Connections: []string{"r", "o1", "o2", "srv"}},
			{ID: "pc", Type: "pc", Connections: []string{"r"}},
			{ID: "o1", Type: "minipc", Connections: []string{"sw"}},
			{ID: "o2", Type: "minipc", Connections: []string{"sw"}},
			{ID: "srv", Type: "server", Connections: []string{"sw"}},
			{ID: "ap", Type: "access_point", Connections: []string{"r"}},
			{ID: "ups", Type: "ups", Connections: []string{"r"}},
		},
	}

	resp := core.Allocate(req)

	out, err := json.MarshalIndent(resp, "", "  ")
	if err != nil {
		log.Fatalf("failed to marshal response: %v", err)
	}

	fmt.Println(string(out))
}
