package services

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

func TestPowerLoadsAndValidationWarnings(t *testing.T) {
	tx := testTx(t)
	builds := NewBuildService(tx)
	user := models.User{Email: uuid.NewString() + "@power.test", GoogleID: uuid.NewString()}
	if err := tx.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	build, err := builds.Create(user.ID, SyncGraphInput{Name: "Power"})
	if err != nil {
		t.Fatalf("create build: %v", err)
	}
	saved, err := builds.UpdateAndCalculate(build.ID, user.ID, SyncGraphInput{
		Name:     "Power",
		Revision: build.Revision,
		Nodes: []NodeDTO{
			{ID: "router", Type: "router", Name: "Router"},
			{ID: "ups", Type: "ups", Name: "UPS", Details: map[string]any{"capacity_w": float64(900)}},
			{ID: "server", Type: "server_v2", Name: "Server", PowerDraw: 1150},
		},
		Edges: []EdgeDTO{
			{Source: "router", SourceHandle: "eth0", Target: "server", TargetHandle: TargetHandle},
			{Source: "ups", SourceHandle: "pwr-out-0", Target: "server", TargetHandle: "pwr-in-0", Type: "power"},
		},
	}, newIPAMStub(t, tx))
	if err != nil {
		t.Fatalf("save: %v", err)
	}

	ids := map[string]string{}
	for _, node := range saved.Nodes {
		ids[node.Name] = node.ID.String()
	}
	var stored models.Node
	if err := tx.First(&stored, "id = ?", ids["UPS"]).Error; err != nil {
		t.Fatalf("reload ups: %v", err)
	}
	upsDetails := stored.Details
	var details struct {
		PowerLoad struct {
			LoadW       int  `json:"load_w"`
			CapacityW   *int `json:"capacity_w"`
			SocketsUsed int  `json:"sockets_used"`
			Sockets     int  `json:"sockets"`
		} `json:"power_load"`
	}
	if err := json.Unmarshal(upsDetails, &details); err != nil {
		t.Fatalf("decode details: %v", err)
	}
	if load := details.PowerLoad; load.LoadW != 1150 || load.CapacityW == nil || *load.CapacityW != 900 || load.SocketsUsed != 1 || load.Sockets != 6 {
		t.Fatalf("unexpected power_load: %s", upsDetails)
	}

	ipam := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"valid":false,"errors":[{"node_id":"` + ids["Router"] + `:lan","message":"lan conflict"}],"warnings":[]}`))
	}))
	defer ipam.Close()
	raw, err := (&IPService{db: tx, client: ipam.Client(), ipamURL: ipam.URL}).ValidateNetwork(build.ID)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	var result struct {
		Valid    bool              `json:"valid"`
		Errors   []validationIssue `json:"errors"`
		Warnings []validationIssue `json:"warnings"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatalf("decode validation: %v", err)
	}
	if result.Valid || len(result.Errors) != 1 || result.Errors[0].NodeID != ids["Router"] {
		t.Fatalf("expected the :lan suffix to be cut: %s", raw)
	}
	found := false
	for _, warning := range result.Warnings {
		if warning.NodeID == ids["UPS"] && warning.Message == "UPS is overloaded: 1150 W on 900 W" {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing overload warning: %s", raw)
	}
}
