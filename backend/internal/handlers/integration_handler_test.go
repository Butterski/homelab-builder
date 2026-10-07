package handlers

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/proxmox"
	"github.com/Butterski/homelab-builder/backend/internal/proxmox/pvetest"
	"github.com/Butterski/homelab-builder/backend/internal/secrets"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/Butterski/homelab-builder/backend/internal/testutil"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type integrationAPI struct {
	router      *gin.Engine
	userID      uuid.UUID
	buildID     uuid.UUID
	pve         *httptest.Server
	fake        *pvetest.Server
	fingerprint string
}

// newIntegrationAPI serves the inventory and integration routes the way the
// server does on a self-hosted instance, next to a made-up Proxmox host.
func newIntegrationAPI(t *testing.T) *integrationAPI {
	t.Helper()
	gin.SetMode(gin.TestMode)
	tx := testutil.Tx(t)
	t.Setenv("IPAM_URL", testutil.IPAMStub(t))

	encoded, _ := secrets.GenerateKey()
	key, _ := secrets.ParseKey(encoded)
	keyring, _ := secrets.NewKeyring(1, key, secrets.SourceEnv)

	builds := services.NewBuildService(tx)
	ip := services.NewIPService(tx)
	proposals := services.NewProposalService(tx, builds, ip)
	inventory := services.NewInventoryService(tx)
	integrations := services.NewIntegrationService(tx, keyring, true, true)
	imports := services.NewProxmoxImportService(tx, integrations, builds, ip, proposals)

	api := &integrationAPI{userID: testutil.User(t, tx).ID, fake: pvetest.New()}
	api.pve = httptest.NewTLSServer(api.fake)
	t.Cleanup(api.pve.Close)
	sum := sha256.Sum256(api.pve.Certificate().Raw)
	api.fingerprint = proxmox.FormatFingerprint(sum[:])

	build, err := builds.Create(api.userID, services.SyncGraphInput{Name: "Lab"})
	if err != nil {
		t.Fatalf("create build: %v", err)
	}
	api.buildID = build.ID

	inventoryHandler := NewInventoryHandler(inventory)
	handler := NewIntegrationHandler(integrations, inventory, imports)
	api.router = gin.New()
	session := api.router.Group("/api", func(c *gin.Context) {
		id := api.userID
		if other := c.GetHeader("X-Test-User"); other != "" {
			id = uuid.MustParse(other)
		}
		c.Set("user_id", id)
	})
	session.GET("/inventory", inventoryHandler.List)
	session.POST("/inventory", inventoryHandler.Create)
	session.PUT("/inventory/:id", inventoryHandler.Update)
	session.DELETE("/inventory/:id", inventoryHandler.Delete)
	session.GET("/integrations", handler.List)
	session.POST("/integrations", handler.Create)
	session.POST("/integrations/test", handler.Test)
	session.PUT("/integrations/:id", handler.Update)
	session.DELETE("/integrations/:id", handler.Delete)
	session.POST("/integrations/:id/sync", handler.Sync)
	session.POST("/integrations/:id/reconcile", handler.Reconcile)
	session.POST("/integrations/:id/link", handler.Link)
	session.POST("/integrations/:id/inventory", handler.CreateItem)
	session.POST("/integrations/:id/import", handler.Import)
	return api
}

func (api *integrationAPI) call(t *testing.T, method, path string, body any, as ...uuid.UUID) (int, string) {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&payload).Encode(body); err != nil {
			t.Fatalf("encode body: %v", err)
		}
	}
	request := httptest.NewRequest(method, path, &payload)
	request.Header.Set("Content-Type", "application/json")
	if len(as) > 0 {
		request.Header.Set("X-Test-User", as[0].String())
	}
	recorder := httptest.NewRecorder()
	api.router.ServeHTTP(recorder, request)
	return recorder.Code, recorder.Body.String()
}

func decodeJSON[T any](t *testing.T, body string) T {
	t.Helper()
	var out T
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatalf("decode %q: %v", body, err)
	}
	return out
}

func (api *integrationAPI) connection() gin.H {
	return gin.H{
		"name": "Homelab", "base_url": api.pve.URL, "token_id": pvetest.TokenID,
		"secret": pvetest.Secret, "tls_fingerprint": api.fingerprint,
	}
}

func TestIntegrationAPI_NeverReturnsTheSecret(t *testing.T) {
	api := newIntegrationAPI(t)

	// An unknown certificate is reported with its fingerprint, not accepted.
	untrusted := api.connection()
	delete(untrusted, "tls_fingerprint")
	status, body := api.call(t, http.MethodPost, "/api/integrations/test", untrusted)
	result := decodeJSON[services.IntegrationTestResult](t, body)
	if status != http.StatusOK || result.OK || result.ErrorKind != proxmox.KindCertificate || result.Certificate == nil || result.Certificate.Fingerprint != api.fingerprint {
		t.Fatalf("test without a trusted certificate: %d %s", status, body)
	}

	// Saving a connection reads the cluster at once.
	status, body = api.call(t, http.MethodPost, "/api/integrations", api.connection())
	if status != http.StatusCreated {
		t.Fatalf("create: %d %s", status, body)
	}
	created := decodeJSON[services.IntegrationView](t, body)
	if !created.HasSecret || created.Summary == nil || created.Summary.Nodes != 2 || created.SyncedAt == nil {
		t.Fatalf("a saved connection is read at once: %s", body)
	}
	bodies := []string{body}

	status, body = api.call(t, http.MethodGet, "/api/integrations", nil)
	listed := decodeJSON[struct {
		Integrations []services.IntegrationView       `json:"integrations"`
		Availability services.IntegrationAvailability `json:"availability"`
	}](t, body)
	if status != http.StatusOK || len(listed.Integrations) != 1 || !listed.Availability.Live || !listed.Availability.AllowPrivate {
		t.Fatalf("list: %d %s", status, body)
	}
	bodies = append(bodies, body)

	for _, path := range []string{"/sync", "/reconcile"} {
		status, body = api.call(t, http.MethodPost, "/api/integrations/"+created.ID.String()+path, gin.H{})
		if status != http.StatusOK {
			t.Fatalf("%s: %d %s", path, status, body)
		}
		bodies = append(bodies, body)
	}
	status, body = api.call(t, http.MethodPut, "/api/integrations/"+created.ID.String(), gin.H{"name": "Renamed"})
	if status != http.StatusOK || decodeJSON[services.IntegrationView](t, body).Name != "Renamed" {
		t.Fatalf("rename: %d %s", status, body)
	}
	bodies = append(bodies, body)

	for _, answer := range bodies {
		if strings.Contains(answer, pvetest.Secret) || strings.Contains(strings.ToLower(answer), "ciphertext") {
			t.Fatalf("a response contains the secret: %s", answer)
		}
	}

	// Another account reaches none of it.
	stranger := uuid.New()
	for method, path := range map[string]string{
		http.MethodPut: "", http.MethodDelete: "", http.MethodPost: "/sync",
	} {
		if status, body := api.call(t, method, "/api/integrations/"+created.ID.String()+path, gin.H{}, stranger); status != http.StatusNotFound {
			t.Fatalf("%s %s by another account: %d %s", method, path, status, body)
		}
	}

	// What is refused is said in words for the owner, without the label the
	// service files it under.
	status, body = api.call(t, http.MethodPost, "/api/integrations", gin.H{"name": "Not an export", "export": `{"hello": 1}`})
	if refusal := decodeJSON[map[string]any](t, body)["error"]; status != http.StatusBadRequest || refusal != "This is not the output of: pvesh get /cluster/resources --output-format json" {
		t.Fatalf("something that is no export: %d %s", status, body)
	}
	status, body = api.call(t, http.MethodPost, "/api/inventory", gin.H{"kind": "device", "type": "minipc"})
	if refusal, _ := decodeJSON[map[string]any](t, body)["error"].(string); status != http.StatusBadRequest || refusal == "" || strings.HasPrefix(refusal, "invalid inventory item") {
		t.Fatalf("an item without a name: %d %s", status, body)
	}

	// A cluster that cannot be read is a gateway error with a reason, not a crash.
	api.fake.Deny("/version")
	status, body = api.call(t, http.MethodPost, "/api/integrations/"+created.ID.String()+"/sync", nil)
	failure := decodeJSON[map[string]any](t, body)
	if status != http.StatusBadGateway || failure["code"] != proxmox.KindPermission || failure["error"] == "" {
		t.Fatalf("sync against a host that refuses: %d %s", status, body)
	}

	// The owner puts it right and saves the connection: it is read at once, so
	// the integration no longer says that the last reading failed. The stored
	// secret is used; the request carries none.
	status, body = api.call(t, http.MethodGet, "/api/integrations", nil)
	if !strings.Contains(body, `"last_error":"The token may not read the cluster`) {
		t.Fatalf("a failed reading is kept with its reason: %d %s", status, body)
	}
	api.fake.Allow("/version")
	_, before := api.fake.Requests()
	settings := api.connection()
	delete(settings, "secret")
	status, body = api.call(t, http.MethodPut, "/api/integrations/"+created.ID.String(), settings)
	saved := decodeJSON[services.IntegrationView](t, body)
	_, after := api.fake.Requests()
	if status != http.StatusOK || saved.LastError != "" || saved.SyncedAt == nil || !saved.SyncedAt.After(*created.SyncedAt) || len(after) <= len(before) {
		t.Fatalf("saving a connection reads the cluster again: %d %s", status, body)
	}
	if strings.Contains(body, pvetest.Secret) {
		t.Fatalf("a response contains the secret: %s", body)
	}
	// A new name alone is no reason to call the cluster.
	_, before = api.fake.Requests()
	if status, body = api.call(t, http.MethodPut, "/api/integrations/"+created.ID.String(), gin.H{"name": "Homelab"}); status != http.StatusOK {
		t.Fatalf("rename: %d %s", status, body)
	}
	if _, after = api.fake.Requests(); len(after) != len(before) {
		t.Fatalf("a rename called the cluster %d times", len(after)-len(before))
	}

	if status, _ := api.call(t, http.MethodDelete, "/api/integrations/"+created.ID.String(), nil); status != http.StatusNoContent {
		t.Fatalf("delete: %d", status)
	}
	if status, _ := api.call(t, http.MethodPost, "/api/integrations/not-an-id/sync", nil); status != http.StatusBadRequest {
		t.Fatalf("a malformed id: %d", status)
	}
}

func TestIntegrationAPI_ImportsThroughAProposal(t *testing.T) {
	api := newIntegrationAPI(t)
	status, body := api.call(t, http.MethodPost, "/api/integrations", api.connection())
	if status != http.StatusCreated {
		t.Fatalf("create: %d %s", status, body)
	}
	id := decodeJSON[services.IntegrationView](t, body).ID.String()

	// The inventory gets the host as an item, and the comparison names it.
	status, body = api.call(t, http.MethodPost, "/api/integrations/"+id+"/inventory", gin.H{"node": "pve01", "name": "Lenovo M75q #1", "type": "minipc"})
	if status != http.StatusCreated {
		t.Fatalf("create item from host: %d %s", status, body)
	}
	itemID := decodeJSON[map[string]any](t, body)["id"].(string)

	status, body = api.call(t, http.MethodPost, "/api/integrations/"+id+"/reconcile", gin.H{"build_id": api.buildID})
	plan := decodeJSON[services.ImportPlan](t, body)
	if status != http.StatusOK || len(plan.Hosts) != 2 || plan.Build == nil {
		t.Fatalf("reconcile: %d %s", status, body)
	}
	for _, host := range plan.Hosts {
		if host.Node == "pve01" && (host.LinkedItem == nil || host.LinkedItem.ID.String() != itemID) {
			t.Fatalf("the host is linked to its new item: %s", body)
		}
	}

	status, body = api.call(t, http.MethodPost, "/api/integrations/"+id+"/import", gin.H{
		"build_id": api.buildID, "hosts": gin.H{"pve02": "skip"}, "add_guests": []int{101, 103},
	})
	result := decodeJSON[services.ImportResult](t, body)
	if status != http.StatusOK || result.Outcome != services.ImportOutcomeProposal || result.ProposalID == nil {
		t.Fatalf("import: %d %s", status, body)
	}

	// Unlinking is a link to nothing.
	if status, body := api.call(t, http.MethodPost, "/api/integrations/"+id+"/link", gin.H{"node": "pve01", "item_id": nil}); status != http.StatusNoContent {
		t.Fatalf("unlink: %d %s", status, body)
	}
	if status, body := api.call(t, http.MethodPost, "/api/integrations/"+id+"/link", gin.H{"node": "pve01", "item_id": uuid.New()}); status != http.StatusNotFound {
		t.Fatalf("linking an item that does not exist: %d %s", status, body)
	}
	if status, body := api.call(t, http.MethodPost, "/api/integrations/"+id+"/import", gin.H{"build_id": uuid.New()}); status != http.StatusNotFound {
		t.Fatalf("an import into a build that does not exist: %d %s", status, body)
	}
}

func TestInventoryAPI(t *testing.T) {
	api := newIntegrationAPI(t)
	item := gin.H{
		"kind": "component", "type": "ram", "name": "16 GB DDR4 SODIMM", "quantity": 2, "location": "drawer",
		"specs": gin.H{"ram_gb": 16, "ram_type": "DDR4 SODIMM"},
	}
	status, body := api.call(t, http.MethodPost, "/api/inventory", item)
	if status != http.StatusCreated {
		t.Fatalf("create: %d %s", status, body)
	}
	id := decodeJSON[map[string]any](t, body)["id"].(string)

	status, body = api.call(t, http.MethodGet, "/api/inventory", nil)
	listed := decodeJSON[struct {
		Items []services.InventoryItemView `json:"items"`
		Limit int                          `json:"limit"`
	}](t, body)
	if status != http.StatusOK || len(listed.Items) != 1 || listed.Items[0].Quantity != 2 || listed.Items[0].Placements == nil || listed.Limit != services.MaxInventoryItems {
		t.Fatalf("list: %d %s", status, body)
	}

	item["status"] = "reserved"
	if status, body := api.call(t, http.MethodPut, "/api/inventory/"+id, item); status != http.StatusOK || decodeJSON[map[string]any](t, body)["status"] != "reserved" {
		t.Fatalf("update: %d %s", status, body)
	}
	item["type"] = "spaceship"
	if status, body := api.call(t, http.MethodPut, "/api/inventory/"+id, item); status != http.StatusBadRequest {
		t.Fatalf("an unknown type: %d %s", status, body)
	}

	stranger := uuid.New()
	if status, _ := api.call(t, http.MethodDelete, "/api/inventory/"+id, nil, stranger); status != http.StatusNotFound {
		t.Fatalf("delete by another account: %d", status)
	}
	if status, body := api.call(t, http.MethodGet, "/api/inventory", nil, stranger); status != http.StatusOK || !strings.Contains(body, `"items":[]`) {
		t.Fatalf("another account's inventory is empty: %d %s", status, body)
	}
	if status, _ := api.call(t, http.MethodDelete, "/api/inventory/"+id, nil); status != http.StatusNoContent {
		t.Fatalf("delete: %d", status)
	}
}
