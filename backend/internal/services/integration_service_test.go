package services

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/inventory"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/proxmox"
	"github.com/Butterski/homelab-builder/backend/internal/proxmox/pvetest"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type integrationFixture struct {
	tx          *gorm.DB
	svc         *IntegrationService
	inventory   *InventoryService
	userID      uuid.UUID
	server      *httptest.Server
	fake        *pvetest.Server
	fingerprint string
}

func fingerprintOfServer(server *httptest.Server) string {
	sum := sha256.Sum256(server.Certificate().Raw)
	return proxmox.FormatFingerprint(sum[:])
}

// newIntegrationFixture is a self-hosted instance (private addresses allowed)
// next to a Proxmox host with the certificate it made for itself.
func newIntegrationFixture(t *testing.T) *integrationFixture {
	t.Helper()
	tx := testTx(t)
	fake := pvetest.New()
	server := httptest.NewTLSServer(fake)
	t.Cleanup(server.Close)
	return &integrationFixture{
		tx: tx, svc: NewIntegrationService(tx, testKeyring(t, 1), true, true), inventory: NewInventoryService(tx),
		userID: newTestUser(t, tx).ID, server: server, fake: fake, fingerprint: fingerprintOfServer(server),
	}
}

func (f *integrationFixture) connection() IntegrationInput {
	return IntegrationInput{
		Name: strPtr("Homelab"), BaseURL: strPtr(f.server.URL), TokenID: strPtr(pvetest.TokenID),
		Secret: strPtr("  " + pvetest.Secret + "\n"), TLSFingerprint: strPtr(f.fingerprint),
	}
}

func (f *integrationFixture) create(t *testing.T) *IntegrationView {
	t.Helper()
	view, err := f.svc.Create(f.userID, f.connection())
	if err != nil {
		t.Fatalf("create integration: %v", err)
	}
	return view
}

func (f *integrationFixture) row(t *testing.T, id uuid.UUID) models.Integration {
	t.Helper()
	var row models.Integration
	if err := f.tx.First(&row, "id = ?", id).Error; err != nil {
		t.Fatalf("load integration: %v", err)
	}
	return row
}

func TestIntegration_SecretIsEncryptedAndNeverReturned(t *testing.T) {
	f := newIntegrationFixture(t)
	view := f.create(t)
	if !view.HasSecret || !view.SecretUsable || view.Source != proxmox.SourceAPI || view.TokenID != pvetest.TokenID || view.TLSFingerprint != f.fingerprint {
		t.Fatalf("view: %+v", view)
	}

	// Nothing the API returns contains the secret.
	raw, _ := json.Marshal(view)
	if strings.Contains(string(raw), pvetest.Secret) {
		t.Fatalf("the view leaks the secret: %s", raw)
	}
	row := f.row(t, view.ID)
	if len(row.SecretCiphertext) == 0 || strings.Contains(string(row.SecretCiphertext), pvetest.Secret) {
		t.Fatalf("the row must hold ciphertext only: %q", row.SecretCiphertext)
	}
	// Nor does the row itself, should it ever be serialized.
	rowJSON, _ := json.Marshal(row)
	for _, forbidden := range []string{pvetest.Secret, "secret_ciphertext", "SecretCiphertext", "snapshot"} {
		if strings.Contains(string(rowJSON), forbidden) {
			t.Fatalf("a serialized row contains %q: %s", forbidden, rowJSON)
		}
	}

	// The ciphertext is bound to its owner and its row: copied elsewhere it does not open.
	stranger := newTestUser(t, f.tx).ID
	copied := models.Integration{
		ID: uuid.New(), UserID: stranger, Kind: row.Kind, Name: "Stolen", Source: row.Source, BaseURL: row.BaseURL, TokenID: row.TokenID,
		SecretCiphertext: row.SecretCiphertext, SecretNonce: row.SecretNonce, SecretVersion: row.SecretVersion,
	}
	if err := f.tx.Create(&copied).Error; err != nil {
		t.Fatalf("copy row: %v", err)
	}
	stolen, err := f.svc.Get(stranger, copied.ID)
	if err != nil || !stolen.HasSecret || stolen.SecretUsable {
		t.Fatalf("a copied ciphertext must not be usable: %+v, %v", stolen, err)
	}
	if _, err := f.svc.Sync(context.Background(), stranger, copied.ID); !errors.Is(err, ErrIntegrationNoSecret) {
		t.Fatalf("sync with a copied ciphertext: %v", err)
	}
	// And another account cannot reach the original at all.
	if _, err := f.svc.Get(stranger, view.ID); !errors.Is(err, ErrIntegrationNotFound) {
		t.Fatalf("another account: %v", err)
	}
}

func TestIntegration_SyncReadsTheClusterAndOnlyReads(t *testing.T) {
	f := newIntegrationFixture(t)
	view := f.create(t)
	if view.Summary != nil || view.SyncedAt != nil {
		t.Fatalf("nothing was read yet: %+v", view)
	}

	synced, err := f.svc.Sync(context.Background(), f.userID, view.ID)
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if synced.Summary == nil || synced.Summary.Version != "8.2.4" || synced.Summary.Cluster != "homelab" ||
		synced.Summary.Nodes != 2 || synced.Summary.VMs != 1 || synced.Summary.Containers != 2 || synced.SyncedAt == nil || synced.LastError != "" {
		t.Fatalf("after a reading: %+v", synced.Summary)
	}
	_, snapshot, err := f.svc.Snapshot(f.userID, view.ID)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if node, _ := snapshot.Node("pve01"); node.CPUModel == "" || node.Gateway != "192.168.10.1" {
		t.Fatalf("the snapshot has the host's details: %+v", node)
	}

	methods, _ := f.fake.Requests()
	if len(methods) != 1 || methods[http.MethodGet] == 0 {
		t.Fatalf("a reading sends GET and nothing else: %v", methods)
	}

	// A reading that fails says why, and what was read before stays.
	f.fake.Deny("/version")
	if _, err := f.svc.Sync(context.Background(), f.userID, view.ID); err == nil {
		t.Fatal("a refused reading must be an error")
	}
	after, _ := f.svc.Get(f.userID, view.ID)
	if after.LastError == "" || after.Summary == nil || strings.Contains(after.LastError, pvetest.Secret) {
		t.Fatalf("after a failed reading: %+v", after)
	}
}

func TestIntegration_ASecretGoesOnlyWhereItWasEnteredFor(t *testing.T) {
	f := newIntegrationFixture(t)
	view := f.create(t)

	elsewhere := pvetest.New()
	other := httptest.NewTLSServer(elsewhere)
	defer other.Close()

	// Trying another address with the stored secret is refused before any call.
	result, err := f.svc.Test(context.Background(), f.userID, IntegrationTestInput{
		IntegrationID: &view.ID, BaseURL: other.URL, TokenID: pvetest.TokenID, TLSFingerprint: fingerprintOfServer(other),
	})
	if err != nil || result.OK || result.ErrorKind != proxmox.KindInvalid {
		t.Fatalf("test against another address: %+v, %v", result, err)
	}
	if _, paths := elsewhere.Requests(); len(paths) != 0 {
		t.Fatalf("the stored secret was sent to another address: %v", paths)
	}
	// The same address works without typing the secret again.
	result, err = f.svc.Test(context.Background(), f.userID, IntegrationTestInput{
		IntegrationID: &view.ID, BaseURL: f.server.URL, TokenID: pvetest.TokenID, TLSFingerprint: f.fingerprint,
	})
	if err != nil || !result.OK || result.Summary == nil || result.Summary.Nodes != 2 {
		t.Fatalf("test with the stored secret: %+v, %v", result, err)
	}

	// Changing the address drops the secret and the trusted certificate.
	moved, err := f.svc.Update(f.userID, view.ID, IntegrationInput{BaseURL: strPtr(other.URL)})
	if err != nil || moved.HasSecret || moved.TLSFingerprint != "" || moved.BaseURL != other.URL {
		t.Fatalf("after moving: %+v, %v", moved, err)
	}
	if _, err := f.svc.Sync(context.Background(), f.userID, view.ID); !errors.Is(err, ErrIntegrationNoSecret) {
		t.Fatalf("sync without a secret: %v", err)
	}
	if _, paths := elsewhere.Requests(); len(paths) != 0 {
		t.Fatalf("a request reached the new address without a secret: %v", paths)
	}
	// With a new secret in the same request it stays.
	kept, err := f.svc.Update(f.userID, view.ID, IntegrationInput{
		BaseURL: strPtr(f.server.URL), Secret: strPtr(pvetest.Secret), TLSFingerprint: strPtr(f.fingerprint),
	})
	if err != nil || !kept.HasSecret || !kept.SecretUsable || kept.TLSFingerprint != f.fingerprint {
		t.Fatalf("a new secret with a new address: %+v, %v", kept, err)
	}
	// So does a change of the token.
	if retokened, err := f.svc.Update(f.userID, view.ID, IntegrationInput{TokenID: strPtr("root@pam!other")}); err != nil || retokened.HasSecret {
		t.Fatalf("after changing the token: %+v, %v", retokened, err)
	}
}

func TestIntegration_AnUnknownCertificateIsShownForTrust(t *testing.T) {
	f := newIntegrationFixture(t)
	input := IntegrationTestInput{BaseURL: f.server.URL, TokenID: pvetest.TokenID, Secret: pvetest.Secret}

	result, err := f.svc.Test(context.Background(), f.userID, input)
	if err != nil || result.OK || result.ErrorKind != proxmox.KindCertificate {
		t.Fatalf("an unknown certificate: %+v, %v", result, err)
	}
	if result.Certificate == nil || result.Certificate.Fingerprint != f.fingerprint {
		t.Fatalf("the result carries the fingerprint to check: %+v", result.Certificate)
	}
	if _, paths := f.fake.Requests(); len(paths) != 0 {
		t.Fatalf("the token reached a host that was not trusted: %v", paths)
	}

	input.TLSFingerprint = result.Certificate.Fingerprint
	result, err = f.svc.Test(context.Background(), f.userID, input)
	if err != nil || !result.OK || result.Summary.Cluster != "homelab" {
		t.Fatalf("after trusting it: %+v, %v", result, err)
	}

	input.Secret = "wrong-secret"
	if result, _ := f.svc.Test(context.Background(), f.userID, input); result.OK || result.ErrorKind != proxmox.KindAuth {
		t.Fatalf("a wrong secret: %+v", result)
	}
	input.Secret, input.TokenID = pvetest.Secret, "not a token"
	if result, _ := f.svc.Test(context.Background(), f.userID, input); result.OK || result.ErrorKind != proxmox.KindInvalid {
		t.Fatalf("a malformed token id: %+v", result)
	}
}

func TestIntegration_ASharedInstanceReachesNoPrivateAddress(t *testing.T) {
	tx := testTx(t)
	svc := NewIntegrationService(tx, testKeyring(t, 1), true, false)
	userID := newTestUser(t, tx).ID
	fake := pvetest.New()
	server := httptest.NewTLSServer(fake)
	defer server.Close()

	if availability := svc.Availability(); availability.AllowPrivate || !availability.Live || !availability.Enabled {
		t.Fatalf("availability: %+v", availability)
	}
	for _, address := range []string{server.URL, "https://192.168.10.10:8006", "https://pve.local:8006", "http://pve.example.com:8006"} {
		_, err := svc.Create(userID, IntegrationInput{BaseURL: strPtr(address), TokenID: strPtr(pvetest.TokenID), Secret: strPtr(pvetest.Secret)})
		if !errors.Is(err, ErrIntegrationInput) {
			t.Errorf("create with %s: %v", address, err)
		}
		result, err := svc.Test(context.Background(), userID, IntegrationTestInput{BaseURL: address, TokenID: pvetest.TokenID, Secret: pvetest.Secret})
		if err != nil || result.OK {
			t.Errorf("test with %s: %+v, %v", address, result, err)
		}
	}
	if _, paths := fake.Requests(); len(paths) != 0 {
		t.Fatalf("a shared instance called a private address: %v", paths)
	}
	// An address stored while private addresses were allowed is checked again at use.
	row := models.Integration{ID: uuid.New(), UserID: userID, Kind: IntegrationKindProxmox, Name: "Old", Source: proxmox.SourceAPI, BaseURL: server.URL, TokenID: pvetest.TokenID}
	ciphertext, nonce, version, _ := svc.keyring.Seal([]byte(pvetest.Secret), integrationSecretAAD(userID, row.ID))
	row.SecretCiphertext, row.SecretNonce, row.SecretVersion = ciphertext, nonce, version
	if err := tx.Create(&row).Error; err != nil {
		t.Fatalf("create row: %v", err)
	}
	if _, err := svc.Sync(context.Background(), userID, row.ID); !errors.Is(err, ErrIntegrationInput) {
		t.Fatalf("sync to a private address on a shared instance: %v", err)
	}
	if _, paths := fake.Requests(); len(paths) != 0 {
		t.Fatalf("a shared instance called a private address: %v", paths)
	}
}

const testExport = `[
	{"type":"node","node":"pve01","status":"online","maxcpu":12,"maxmem":33539072000,"maxdisk":63000000000},
	{"type":"lxc","vmid":100,"name":"homeassistant","node":"pve01","status":"running","maxcpu":2,"maxmem":4294967296,"maxdisk":34359738368},
	{"type":"qemu","vmid":101,"name":"docker","node":"pve01","status":"stopped","maxcpu":4,"maxmem":8589934592,"maxdisk":68719476736}]`

func TestIntegration_APastedExportNeedsNoConnection(t *testing.T) {
	tx := testTx(t)
	// No master key: this instance cannot keep a secret, and does not need to.
	svc := NewIntegrationService(tx, nil, true, false)
	userID := newTestUser(t, tx).ID
	if availability := svc.Availability(); availability.Live || !availability.Enabled {
		t.Fatalf("availability without a master key: %+v", availability)
	}

	view, err := svc.Create(userID, IntegrationInput{Name: strPtr("From the shell"), Export: strPtr(testExport)})
	if err != nil {
		t.Fatalf("create from an export: %v", err)
	}
	if view.Source != proxmox.SourcePaste || view.HasSecret || view.BaseURL != "" || view.Summary == nil ||
		view.Summary.Nodes != 1 || view.Summary.VMs != 1 || view.Summary.Containers != 1 || view.SyncedAt == nil || len(view.Notes) == 0 {
		t.Fatalf("a pasted source: %+v", view)
	}
	if _, err := svc.Sync(context.Background(), userID, view.ID); !errors.Is(err, ErrIntegrationInput) {
		t.Fatalf("a pasted source cannot be read again by itself: %v", err)
	}
	// A new export replaces the old one.
	refreshed, err := svc.Update(userID, view.ID, IntegrationInput{Export: strPtr(`[{"type":"node","node":"pve09","status":"online","maxcpu":4,"maxmem":8000000000}]`)})
	if err != nil || refreshed.Summary.VMs != 0 {
		t.Fatalf("a refreshed export: %+v, %v", refreshed, err)
	}

	if _, err := svc.Create(userID, IntegrationInput{Export: strPtr("pve01 online")}); !errors.Is(err, ErrIntegrationInput) {
		t.Fatalf("text that is no export: %v", err)
	}
	if _, err := svc.Create(userID, IntegrationInput{Export: strPtr(testExport), BaseURL: strPtr("https://pve.example.com:8006")}); !errors.Is(err, ErrIntegrationInput) {
		t.Fatalf("an export together with a connection: %v", err)
	}
	// A connection would need to keep a secret, which this instance cannot.
	_, err = svc.Create(userID, IntegrationInput{BaseURL: strPtr("https://pve.example.com:8006"), TokenID: strPtr(pvetest.TokenID), Secret: strPtr(pvetest.Secret)})
	if !errors.Is(err, ErrIntegrationNoStore) {
		t.Fatalf("a connection without a master key: %v", err)
	}
	if _, err := svc.Create(userID, IntegrationInput{Name: strPtr("Empty")}); !errors.Is(err, ErrIntegrationInput) {
		t.Fatalf("neither a connection nor an export: %v", err)
	}
}

func TestIntegration_AnExportDoesNotReplaceAConnection(t *testing.T) {
	f := newIntegrationFixture(t)
	view := f.create(t)
	if _, err := f.svc.Update(f.userID, view.ID, IntegrationInput{Export: strPtr(testExport)}); !errors.Is(err, ErrIntegrationInput) {
		t.Fatalf("an export for a source that reads the API: %v", err)
	}
}

func TestIntegration_LinksHostsToInventoryItems(t *testing.T) {
	f := newIntegrationFixture(t)
	view := f.create(t)
	if err := f.svc.LinkItem(f.userID, view.ID, "pve01", nil); !errors.Is(err, ErrIntegrationNoSnapshot) {
		t.Fatalf("linking before anything was read: %v", err)
	}
	if _, err := f.svc.Sync(context.Background(), f.userID, view.ID); err != nil {
		t.Fatalf("sync: %v", err)
	}
	first := mustCreateItem(t, f.inventory, f.userID, m75qInput("Lenovo M75q #1"))
	second := mustCreateItem(t, f.inventory, f.userID, m75qInput("Lenovo M75q #2"))
	module := mustCreateItem(t, f.inventory, f.userID, InventoryInput{Kind: inventory.KindComponent, Type: "ram", Name: "16 GB DDR4"})

	if err := f.svc.LinkItem(f.userID, view.ID, "pve01", &first.ID); err != nil {
		t.Fatalf("link: %v", err)
	}
	linked, _ := f.inventory.Get(f.userID, first.ID)
	if linked.IntegrationID == nil || *linked.IntegrationID != view.ID || linked.IntegrationRef != "pve01" {
		t.Fatalf("the link: %+v", linked)
	}
	// A linked machine reads as in use; what the owner set is not overwritten.
	if linked.Status != inventory.StatusAvailable || inventoryState(t, f.inventory, f.userID, first.ID) != inventory.StatusInUse {
		t.Fatalf("a linked machine: status %q, state %q", linked.Status, inventoryState(t, f.inventory, f.userID, first.ID))
	}
	// A host is one machine: linking another takes the first one's place.
	if err := f.svc.LinkItem(f.userID, view.ID, "pve01", &second.ID); err != nil {
		t.Fatalf("relink: %v", err)
	}
	if was, _ := f.inventory.Get(f.userID, first.ID); was.IntegrationID != nil || was.IntegrationRef != "" {
		t.Fatalf("the first item lost the link: %+v", was)
	}
	if state := inventoryState(t, f.inventory, f.userID, first.ID); state != inventory.StatusAvailable {
		t.Fatalf("an unlinked machine is free again, got %q", state)
	}
	if err := f.svc.LinkItem(f.userID, view.ID, "pve01", &module.ID); !errors.Is(err, ErrIntegrationInput) {
		t.Fatalf("a memory module is no host: %v", err)
	}
	if err := f.svc.LinkItem(f.userID, view.ID, "pve77", &first.ID); !errors.Is(err, ErrIntegrationInput) {
		t.Fatalf("a host the integration does not have: %v", err)
	}
	strangerItem := mustCreateItem(t, f.inventory, newTestUser(t, f.tx).ID, m75qInput("Not yours"))
	if err := f.svc.LinkItem(f.userID, view.ID, "pve02", &strangerItem.ID); !errors.Is(err, ErrInventoryItemNotFound) {
		t.Fatalf("somebody else's item: %v", err)
	}

	// A host the inventory does not know becomes an item, filled with what was read.
	created, err := f.svc.CreateItemFromHost(f.userID, view.ID, HostItemInput{Node: "pve01", Name: "Lenovo M75q #3", Type: "minipc", Model: "M75q", Location: "rack"}, f.inventory)
	if err != nil {
		t.Fatalf("create item from host: %v", err)
	}
	item := InventoryItemOf(*created)
	if created.Type != "minipc" || created.Location != "rack" || created.IntegrationRef != "pve01" ||
		item.Specs.CPUModel == "" || item.Specs.CPUThreads != 12 || item.Specs.CPUCores != 6 || item.Specs.RAMGB != 32 || item.Specs.StorageGB != 220 {
		t.Fatalf("an item made from a host: %+v, specs %+v", created, item.Specs)
	}
	if state := inventoryState(t, f.inventory, f.userID, created.ID); state != inventory.StatusInUse {
		t.Fatalf("an item made from a running host is in use, got %q", state)
	}
	if replaced, _ := f.inventory.Get(f.userID, second.ID); replaced.IntegrationRef != "" {
		t.Fatalf("the new item took the host: %+v", replaced)
	}

	// Removing the integration leaves the items, without the link.
	if err := f.svc.Delete(f.userID, view.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if kept, err := f.inventory.Get(f.userID, created.ID); err != nil || kept.IntegrationID != nil || kept.IntegrationRef != "" {
		t.Fatalf("after deleting the integration: %+v, %v", kept, err)
	}
	if state := inventoryState(t, f.inventory, f.userID, created.ID); state != inventory.StatusAvailable {
		t.Fatalf("with the integration gone the machine is free, got %q", state)
	}
	if _, err := f.svc.Get(f.userID, view.ID); !errors.Is(err, ErrIntegrationNotFound) {
		t.Fatalf("a deleted integration: %v", err)
	}
}

func TestIntegration_LimitsAndSwitches(t *testing.T) {
	f := newIntegrationFixture(t)
	for i := 0; i < MaxIntegrations; i++ {
		f.create(t)
	}
	if _, err := f.svc.Create(f.userID, f.connection()); !errors.Is(err, ErrIntegrationLimit) {
		t.Fatalf("one integration too many: %v", err)
	}

	// The server calls out for a user only so often.
	input := IntegrationTestInput{BaseURL: f.server.URL, TokenID: pvetest.TokenID, Secret: pvetest.Secret, TLSFingerprint: f.fingerprint}
	busy := false
	for i := 0; i < outboundCallBurst+2; i++ {
		if _, err := f.svc.Test(context.Background(), f.userID, input); errors.Is(err, ErrIntegrationBusy) {
			busy = true
			break
		}
	}
	if !busy {
		t.Fatal("endless connection attempts must be slowed down")
	}
	// Another user has a budget of their own.
	if _, err := f.svc.Test(context.Background(), newTestUser(t, f.tx).ID, input); err != nil {
		t.Fatalf("another user's attempt: %v", err)
	}

	off := NewIntegrationService(f.tx, testKeyring(t, 1), false, true)
	if _, err := off.Create(f.userID, f.connection()); !errors.Is(err, ErrIntegrationsUnavailable) {
		t.Fatalf("create on an instance without integrations: %v", err)
	}
	if _, err := off.Test(context.Background(), f.userID, input); !errors.Is(err, ErrIntegrationsUnavailable) {
		t.Fatalf("test on an instance without integrations: %v", err)
	}
}
