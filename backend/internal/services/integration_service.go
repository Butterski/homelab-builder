package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/inventory"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/proxmox"
	"github.com/Butterski/homelab-builder/backend/internal/secrets"
	"github.com/google/uuid"
	"golang.org/x/time/rate"
	"gorm.io/gorm"
)

const (
	IntegrationKindProxmox = "proxmox"
	// MaxIntegrations bounds the connections one account keeps.
	MaxIntegrations = 5

	maxIntegrationNameLength = 80
	// A user may have the server call out this often: one call every ten
	// seconds on average, a handful in a row while a connection is being set up.
	outboundCallsPerMinute = 6
	outboundCallBurst      = 12
)

var (
	// ErrIntegrationsUnavailable means the instance has integrations switched off.
	ErrIntegrationsUnavailable = errors.New("integrations are turned off on this instance")
	ErrIntegrationNotFound     = errors.New("integration not found")
	ErrIntegrationLimit        = fmt.Errorf("an account holds at most %d integrations", MaxIntegrations)
	// ErrIntegrationInput marks settings that cannot be stored as given.
	ErrIntegrationInput = errors.New("invalid integration settings")
	// ErrIntegrationNoSecret means the token secret is missing or can no longer be read.
	ErrIntegrationNoSecret = errors.New("the token secret is missing or can no longer be read; enter it again")
	// ErrIntegrationNoStore means this instance cannot keep a token secret.
	ErrIntegrationNoStore = errors.New("this instance cannot store a token secret: it has no master key (SECRETS_KEY). Paste an export instead")
	// ErrIntegrationBusy means the user asked for too many calls in a short time.
	ErrIntegrationBusy = errors.New("too many connection attempts; wait a moment and try again")
	// ErrIntegrationNoSnapshot means nothing was read from the integration yet.
	ErrIntegrationNoSnapshot = errors.New("nothing has been read from this integration yet")
)

// IntegrationService keeps a user's connections to the systems that know what
// runs on their hardware, and what was last read from each.
//
// A token secret is encrypted before it is written and leaves this service
// only inside a Proxmox client, for the length of one reading. It is never
// logged, returned or sent to an address other than the one it was entered for.
type IntegrationService struct {
	db           *gorm.DB
	keyring      *secrets.Keyring
	enabled      bool
	allowPrivate bool

	mu       sync.Mutex
	limiters map[uuid.UUID]*rate.Limiter
}

// NewIntegrationService wires the service. keyring may be nil: an instance
// without a master key cannot store a token secret and offers pasted exports only.
func NewIntegrationService(db *gorm.DB, keyring *secrets.Keyring, enabled, allowPrivate bool) *IntegrationService {
	return &IntegrationService{
		db: db, keyring: keyring, enabled: enabled, allowPrivate: allowPrivate,
		limiters: map[uuid.UUID]*rate.Limiter{},
	}
}

// IntegrationAvailability tells the client what this instance can do, so the
// screen can say it before anything is typed.
type IntegrationAvailability struct {
	Enabled bool `json:"enabled"`
	// Live: the instance can keep a token secret and read a cluster over its API.
	Live bool `json:"live"`
	// AllowPrivate: the instance may call private addresses, which is where a
	// Proxmox host on a home network is.
	AllowPrivate    bool   `json:"allow_private"`
	MasterKeySource string `json:"master_key_source,omitempty"`
	Limit           int    `json:"limit"`
}

func (s *IntegrationService) Availability() IntegrationAvailability {
	availability := IntegrationAvailability{
		Enabled: s.enabled, Live: s.enabled && s.keyring != nil, AllowPrivate: s.allowPrivate, Limit: MaxIntegrations,
	}
	if s.keyring != nil {
		availability.MasterKeySource = s.keyring.Source
	}
	return availability
}

// IntegrationView is an integration as the client sees it. It never contains
// the secret.
type IntegrationView struct {
	ID             uuid.UUID        `json:"id"`
	Kind           string           `json:"kind"`
	Name           string           `json:"name"`
	Source         string           `json:"source"`
	BaseURL        string           `json:"base_url"`
	TokenID        string           `json:"token_id"`
	HasSecret      bool             `json:"has_secret"`
	SecretUsable   bool             `json:"secret_usable"`
	TLSFingerprint string           `json:"tls_fingerprint"`
	SyncedAt       *time.Time       `json:"synced_at"`
	LastError      string           `json:"last_error"`
	Summary        *proxmox.Summary `json:"summary"`
	Notes          []string         `json:"notes"`
	CreatedAt      time.Time        `json:"created_at"`
}

// IntegrationInput changes the fields that are set. Secret is write-only.
type IntegrationInput struct {
	Name    *string `json:"name"`
	BaseURL *string `json:"base_url"`
	TokenID *string `json:"token_id"`
	Secret  *string `json:"secret"`
	// TLSFingerprint is the certificate the owner chose to trust; "" stops pinning.
	TLSFingerprint *string `json:"tls_fingerprint"`
	// Export is pasted output of pvesh; it makes or refreshes a pasted source.
	Export *string `json:"export"`
}

func integrationSecretAAD(userID, integrationID uuid.UUID) []byte {
	return []byte("hlb:integration-secret:v1|user:" + userID.String() + "|integration:" + integrationID.String())
}

func inputError(err error) error {
	var own *proxmox.Error
	if errors.As(err, &own) {
		return fmt.Errorf("%w: %s", ErrIntegrationInput, own.Message)
	}
	return fmt.Errorf("%w: %s", ErrIntegrationInput, err.Error())
}

func readSnapshot(raw json.RawMessage) *proxmox.Snapshot {
	if len(raw) == 0 {
		return nil
	}
	var snapshot proxmox.Snapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return nil
	}
	return &snapshot
}

func (s *IntegrationService) secretUsable(row *models.Integration) bool {
	if len(row.SecretCiphertext) == 0 || s.keyring == nil {
		return false
	}
	_, err := s.keyring.Open(row.SecretCiphertext, row.SecretNonce, row.SecretVersion, integrationSecretAAD(row.UserID, row.ID))
	return err == nil
}

func (s *IntegrationService) view(row *models.Integration) *IntegrationView {
	view := &IntegrationView{
		ID: row.ID, Kind: row.Kind, Name: row.Name, Source: row.Source, BaseURL: row.BaseURL, TokenID: row.TokenID,
		HasSecret: len(row.SecretCiphertext) > 0, SecretUsable: s.secretUsable(row),
		TLSFingerprint: row.TLSFingerprint, SyncedAt: row.SyncedAt, LastError: row.LastError,
		Notes: []string{}, CreatedAt: row.CreatedAt,
	}
	if snapshot := readSnapshot(row.Snapshot); snapshot != nil {
		summary := snapshot.Summarize()
		view.Summary = &summary
		if snapshot.Notes != nil {
			view.Notes = snapshot.Notes
		}
	}
	return view
}

func (s *IntegrationService) load(userID, id uuid.UUID) (*models.Integration, error) {
	var row models.Integration
	err := s.db.First(&row, "id = ? AND user_id = ?", id, userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrIntegrationNotFound
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// List returns the user's integrations, oldest first.
func (s *IntegrationService) List(userID uuid.UUID) ([]*IntegrationView, error) {
	var rows []models.Integration
	if err := s.db.Where("user_id = ?", userID).Order("created_at, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	views := make([]*IntegrationView, 0, len(rows))
	for i := range rows {
		views = append(views, s.view(&rows[i]))
	}
	return views, nil
}

// Get returns one integration of the user.
func (s *IntegrationService) Get(userID, id uuid.UUID) (*IntegrationView, error) {
	row, err := s.load(userID, id)
	if err != nil {
		return nil, err
	}
	return s.view(row), nil
}

func cleanIntegrationName(value, fallback string) (string, error) {
	name := strings.TrimSpace(value)
	if name == "" {
		name = fallback
	}
	if strings.ContainsRune(name, 0) || len([]rune(name)) > maxIntegrationNameLength {
		return "", fmt.Errorf("%w: the name is too long (%d characters at most)", ErrIntegrationInput, maxIntegrationNameLength)
	}
	return name, nil
}

func wipeIntegrationSecret(row *models.Integration) {
	row.SecretCiphertext, row.SecretNonce = nil, nil
	row.SecretVersion, row.SecretStoredAt = 0, nil
}

// apply writes the given fields onto a row. A secret belongs to the address
// and the token it was entered for: when either changes, the stored secret and
// the trusted certificate are dropped unless new ones come in the same request.
func (s *IntegrationService) apply(row *models.Integration, in IntegrationInput) (secretStored, secretDropped bool, err error) {
	if in.Name != nil {
		if row.Name, err = cleanIntegrationName(*in.Name, "Proxmox"); err != nil {
			return false, false, err
		}
	}
	if in.Export != nil {
		if in.BaseURL != nil || in.TokenID != nil || in.Secret != nil || row.BaseURL != "" {
			return false, false, fmt.Errorf("%w: an export is for a source without a connection; this one reads the API", ErrIntegrationInput)
		}
		snapshot, parseErr := proxmox.ParseExport([]byte(*in.Export), time.Now())
		if parseErr != nil {
			return false, false, fmt.Errorf("%w: %s", ErrIntegrationInput, parseErr.Error())
		}
		raw, marshalErr := json.Marshal(snapshot)
		if marshalErr != nil {
			return false, false, marshalErr
		}
		now := time.Now()
		row.Snapshot, row.SyncedAt, row.LastError = raw, &now, ""
		row.Source = proxmox.SourcePaste
	}

	destinationChanged := false
	if in.BaseURL != nil {
		baseURL, urlErr := proxmox.NormalizeBaseURL(*in.BaseURL, s.allowPrivate)
		if urlErr != nil {
			return false, false, inputError(urlErr)
		}
		if baseURL != row.BaseURL {
			destinationChanged = true
			row.BaseURL = baseURL
			row.TLSFingerprint = ""
		}
		row.Source = proxmox.SourceAPI
	}
	if in.TokenID != nil {
		tokenID, tokenErr := proxmox.NormalizeTokenID(*in.TokenID)
		if tokenErr != nil {
			return false, false, inputError(tokenErr)
		}
		if tokenID != row.TokenID {
			destinationChanged = true
			row.TokenID = tokenID
		}
	}
	if in.TLSFingerprint != nil {
		fingerprint := ""
		if strings.TrimSpace(*in.TLSFingerprint) != "" {
			if fingerprint = proxmox.NormalizeFingerprint(*in.TLSFingerprint); fingerprint == "" {
				return false, false, fmt.Errorf("%w: the certificate fingerprint is not a SHA-256", ErrIntegrationInput)
			}
		}
		row.TLSFingerprint = fingerprint
	}

	newSecret := ""
	if in.Secret != nil && strings.TrimSpace(*in.Secret) != "" {
		secret, secretErr := proxmox.NormalizeSecret(*in.Secret)
		if secretErr != nil {
			return false, false, inputError(secretErr)
		}
		newSecret = secret
	}
	if destinationChanged && newSecret == "" && len(row.SecretCiphertext) > 0 {
		wipeIntegrationSecret(row)
		secretDropped = true
	}
	if newSecret != "" {
		if s.keyring == nil {
			return false, false, ErrIntegrationNoStore
		}
		if row.BaseURL == "" || row.TokenID == "" {
			return false, false, fmt.Errorf("%w: enter the address and the token id with the secret", ErrIntegrationInput)
		}
		ciphertext, nonce, version, sealErr := s.keyring.Seal([]byte(newSecret), integrationSecretAAD(row.UserID, row.ID))
		if sealErr != nil {
			return false, false, sealErr
		}
		now := time.Now()
		row.SecretCiphertext, row.SecretNonce, row.SecretVersion, row.SecretStoredAt = ciphertext, nonce, version, &now
		secretStored = true
	}
	return secretStored, secretDropped, nil
}

// Create stores a new integration: a connection to the API (address, token id
// and secret) or a pasted export.
func (s *IntegrationService) Create(userID uuid.UUID, in IntegrationInput) (*IntegrationView, error) {
	if !s.enabled {
		return nil, ErrIntegrationsUnavailable
	}
	var count int64
	if err := s.db.Model(&models.Integration{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
		return nil, err
	}
	if count >= MaxIntegrations {
		return nil, ErrIntegrationLimit
	}
	row := &models.Integration{ID: uuid.New(), UserID: userID, Kind: IntegrationKindProxmox, Name: "Proxmox", Source: proxmox.SourceAPI}
	secretStored, _, err := s.apply(row, in)
	if err != nil {
		return nil, err
	}
	if row.Source == proxmox.SourceAPI && (row.BaseURL == "" || row.TokenID == "" || !secretStored) {
		return nil, fmt.Errorf("%w: enter the address, the token id and the secret, or paste an export", ErrIntegrationInput)
	}
	if err := s.db.Create(row).Error; err != nil {
		return nil, err
	}
	RecordEvent(s.db, &userID, "integration.created", map[string]any{"integration_id": row.ID, "kind": row.Kind, "source": row.Source})
	return s.view(row), nil
}

// Update changes an integration.
func (s *IntegrationService) Update(userID, id uuid.UUID, in IntegrationInput) (*IntegrationView, error) {
	if !s.enabled {
		return nil, ErrIntegrationsUnavailable
	}
	row, err := s.load(userID, id)
	if err != nil {
		return nil, err
	}
	secretStored, secretDropped, err := s.apply(row, in)
	if err != nil {
		return nil, err
	}
	if err := s.db.Save(row).Error; err != nil {
		return nil, err
	}
	// The audit log records that a secret was stored or removed, never the secret.
	if secretStored {
		RecordEvent(s.db, &userID, "integration.secret_stored", map[string]any{"integration_id": row.ID})
	}
	if secretDropped {
		RecordEvent(s.db, &userID, "integration.secret_deleted", map[string]any{"integration_id": row.ID, "reason": "address or token changed"})
	}
	return s.view(row), nil
}

// Delete removes an integration with its secret and what was read from it.
// Inventory items that were linked to its hosts stay, without the link.
func (s *IntegrationService) Delete(userID, id uuid.UUID) error {
	err := s.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Where("id = ? AND user_id = ?", id, userID).Delete(&models.Integration{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrIntegrationNotFound
		}
		return tx.Model(&models.InventoryItem{}).Where("user_id = ? AND integration_id = ?", userID, id).
			Updates(map[string]any{"integration_id": nil, "integration_ref": ""}).Error
	})
	if err != nil {
		return err
	}
	RecordEvent(s.db, &userID, "integration.deleted", map[string]any{"integration_id": id})
	return nil
}

// allowCall spends one outbound call of the user's budget.
func (s *IntegrationService) allowCall(userID uuid.UUID) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	limiter, ok := s.limiters[userID]
	if !ok {
		if len(s.limiters) > 4096 {
			s.limiters = map[uuid.UUID]*rate.Limiter{}
		}
		limiter = rate.NewLimiter(rate.Limit(float64(outboundCallsPerMinute)/60), outboundCallBurst)
		s.limiters[userID] = limiter
	}
	return limiter.Allow()
}

// IntegrationTestInput is a connection to try before it is saved. With
// IntegrationID set and no secret, the stored secret is used, but only for the
// address it was stored for.
type IntegrationTestInput struct {
	IntegrationID  *uuid.UUID `json:"integration_id"`
	BaseURL        string     `json:"base_url"`
	TokenID        string     `json:"token_id"`
	Secret         string     `json:"secret"`
	TLSFingerprint string     `json:"tls_fingerprint"`
}

// IntegrationTestResult says whether a connection works and, when it does not,
// what to do about it.
type IntegrationTestResult struct {
	OK      bool             `json:"ok"`
	Summary *proxmox.Summary `json:"summary,omitempty"`
	Notes   []string         `json:"notes"`
	// Certificate is what the host presented. With ErrorKind "certificate" the
	// owner can check its fingerprint and send it back as the one to trust.
	Certificate *proxmox.Certificate `json:"certificate,omitempty"`
	ErrorKind   string               `json:"error_kind,omitempty"`
	Error       string               `json:"error,omitempty"`
}

func failedTest(err error, certificate *proxmox.Certificate) *IntegrationTestResult {
	result := &IntegrationTestResult{Notes: []string{}, Certificate: certificate}
	var own *proxmox.Error
	if errors.As(err, &own) {
		result.ErrorKind, result.Error = own.Kind, own.Message
		if own.Certificate != nil {
			result.Certificate = own.Certificate
		}
		return result
	}
	result.ErrorKind, result.Error = proxmox.KindInvalid, err.Error()
	return result
}

// Test tries a connection without storing anything.
func (s *IntegrationService) Test(ctx context.Context, userID uuid.UUID, in IntegrationTestInput) (*IntegrationTestResult, error) {
	if !s.enabled {
		return nil, ErrIntegrationsUnavailable
	}
	baseURL, err := proxmox.NormalizeBaseURL(in.BaseURL, s.allowPrivate)
	if err != nil {
		return failedTest(err, nil), nil
	}
	tokenID, err := proxmox.NormalizeTokenID(in.TokenID)
	if err != nil {
		return failedTest(err, nil), nil
	}
	secret := ""
	if strings.TrimSpace(in.Secret) != "" {
		if secret, err = proxmox.NormalizeSecret(in.Secret); err != nil {
			return failedTest(err, nil), nil
		}
	} else if in.IntegrationID != nil {
		row, loadErr := s.load(userID, *in.IntegrationID)
		if loadErr != nil {
			return nil, loadErr
		}
		// A stored secret goes only where it was entered for.
		if row.BaseURL != baseURL || row.TokenID != tokenID {
			return failedTest(&proxmox.Error{Kind: proxmox.KindInvalid, Message: "The address or the token changed: enter the token secret again."}, nil), nil
		}
		if secret, err = s.openSecret(row); err != nil {
			return failedTest(&proxmox.Error{Kind: proxmox.KindInvalid, Message: ErrIntegrationNoSecret.Error()}, nil), nil
		}
	} else {
		return failedTest(&proxmox.Error{Kind: proxmox.KindInvalid, Message: "Enter the token secret."}, nil), nil
	}
	if !s.allowCall(userID) {
		return nil, ErrIntegrationBusy
	}

	client := proxmox.NewClient(proxmox.Options{
		BaseURL: baseURL, TokenID: tokenID, Secret: secret,
		AllowPrivate: s.allowPrivate, Fingerprint: in.TLSFingerprint,
	})
	snapshot, err := client.Overview(ctx)
	if err != nil {
		return failedTest(err, client.Presented()), nil
	}
	summary := snapshot.Summarize()
	notes := snapshot.Notes
	if notes == nil {
		notes = []string{}
	}
	return &IntegrationTestResult{OK: true, Summary: &summary, Notes: notes, Certificate: client.Presented()}, nil
}

func (s *IntegrationService) openSecret(row *models.Integration) (string, error) {
	if len(row.SecretCiphertext) == 0 || s.keyring == nil {
		return "", ErrIntegrationNoSecret
	}
	plaintext, err := s.keyring.Open(row.SecretCiphertext, row.SecretNonce, row.SecretVersion, integrationSecretAAD(row.UserID, row.ID))
	if err != nil {
		return "", ErrIntegrationNoSecret
	}
	return string(plaintext), nil
}

// Sync reads the cluster again and keeps what it finds. A failure is returned
// and also kept, in words, so the integration shows why it is out of date.
func (s *IntegrationService) Sync(ctx context.Context, userID, id uuid.UUID) (*IntegrationView, error) {
	if !s.enabled {
		return nil, ErrIntegrationsUnavailable
	}
	row, err := s.load(userID, id)
	if err != nil {
		return nil, err
	}
	if row.Source != proxmox.SourceAPI {
		return nil, fmt.Errorf("%w: this source is a pasted export; paste a new one to refresh it", ErrIntegrationInput)
	}
	secret, err := s.openSecret(row)
	if err != nil {
		return nil, err
	}
	// Enforced again at use: the instance's policy may have changed since it was saved.
	baseURL, err := proxmox.NormalizeBaseURL(row.BaseURL, s.allowPrivate)
	if err != nil {
		return nil, inputError(err)
	}
	if !s.allowCall(userID) {
		return nil, ErrIntegrationBusy
	}

	client := proxmox.NewClient(proxmox.Options{
		BaseURL: baseURL, TokenID: row.TokenID, Secret: secret,
		AllowPrivate: s.allowPrivate, Fingerprint: row.TLSFingerprint,
	})
	snapshot, fetchErr := client.Fetch(ctx)
	if fetchErr != nil {
		message := fetchErr.Error()
		if err := s.db.Model(&models.Integration{}).Where("id = ?", row.ID).Update("last_error", message).Error; err != nil {
			return nil, err
		}
		return nil, fetchErr
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	row.Snapshot, row.SyncedAt, row.LastError = raw, &now, ""
	if err := s.db.Model(&models.Integration{}).Where("id = ?", row.ID).
		Updates(map[string]any{"snapshot": raw, "synced_at": now, "last_error": ""}).Error; err != nil {
		return nil, err
	}
	return s.view(row), nil
}

// Snapshot returns what was last read from an integration.
func (s *IntegrationService) Snapshot(userID, id uuid.UUID) (*models.Integration, *proxmox.Snapshot, error) {
	row, err := s.load(userID, id)
	if err != nil {
		return nil, nil, err
	}
	snapshot := readSnapshot(row.Snapshot)
	if snapshot == nil {
		return row, nil, ErrIntegrationNoSnapshot
	}
	return row, snapshot, nil
}

// LinkItem says which inventory item is the machine behind a host, or, with a
// nil item, that none is. A host has one item and an item one host.
func (s *IntegrationService) LinkItem(userID, id uuid.UUID, node string, itemID *uuid.UUID) error {
	row, snapshot, err := s.Snapshot(userID, id)
	if err != nil {
		return err
	}
	if _, known := snapshot.Node(node); !known {
		return fmt.Errorf("%w: %q is not a host of this integration", ErrIntegrationInput, node)
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		unlink := map[string]any{"integration_id": nil, "integration_ref": ""}
		if err := tx.Model(&models.InventoryItem{}).
			Where("user_id = ? AND integration_id = ? AND integration_ref = ?", userID, row.ID, node).
			Updates(unlink).Error; err != nil {
			return err
		}
		if itemID == nil {
			return nil
		}
		var item models.InventoryItem
		if err := tx.First(&item, "id = ? AND user_id = ?", *itemID, userID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrInventoryItemNotFound
			}
			return err
		}
		if item.Kind != inventory.KindDevice {
			return fmt.Errorf("%w: only a device can be the machine behind a host", ErrIntegrationInput)
		}
		// The status the owner set is left alone: a linked machine reads as in
		// use for as long as it is linked (inventory.State), and no longer.
		return tx.Model(&models.InventoryItem{}).Where("id = ?", item.ID).
			Updates(map[string]any{"integration_id": row.ID, "integration_ref": node}).Error
	})
}

// HostItemInput is what the owner adds to a host's figures when it becomes an
// inventory item: what the machine is, which the cluster cannot know.
type HostItemInput struct {
	Node         string `json:"node"`
	Name         string `json:"name"`
	Type         string `json:"type"`
	Manufacturer string `json:"manufacturer"`
	Model        string `json:"model"`
	Location     string `json:"location"`
}

// hostItem describes a host as an inventory item, from what the cluster reports.
func hostItem(snapshot *proxmox.Snapshot, node proxmox.Node) inventory.Item {
	item := inventory.Item{
		Kind: inventory.KindDevice, Type: "server_v2", Name: node.Name, Quantity: 1,
		Status: inventory.StatusAvailable, Location: "other",
		Specs: inventory.Specs{
			CPUModel: node.CPUModel, CPUCores: node.Cores, CPUThreads: node.Threads,
			RAMGB: proxmox.NominalRAMGB(node.MemoryMB),
		},
	}
	if storage := snapshot.LocalStorageGB(node.Name); storage > 0 {
		item.Specs.StorageGB = math.Round(storage)
	} else {
		item.Specs.StorageGB = math.Round(node.DiskGB)
	}
	if item.Specs.CPUCores > item.Specs.CPUThreads {
		item.Specs.CPUCores = 0
	}
	for _, iface := range node.Interfaces {
		if iface.MAC != "" {
			item.MacAddresses = append(item.MacAddresses, iface.MAC)
		}
	}
	return item
}

// CreateItemFromHost adds a host the inventory does not know as a new item,
// filled with what the cluster reports, and links the two.
func (s *IntegrationService) CreateItemFromHost(userID, id uuid.UUID, in HostItemInput, inventoryService *InventoryService) (*models.InventoryItem, error) {
	_, snapshot, err := s.Snapshot(userID, id)
	if err != nil {
		return nil, err
	}
	node, known := snapshot.Node(in.Node)
	if !known {
		return nil, fmt.Errorf("%w: %q is not a host of this integration", ErrIntegrationInput, in.Node)
	}
	item := hostItem(snapshot, node)
	if strings.TrimSpace(in.Name) != "" {
		item.Name = in.Name
	}
	if strings.TrimSpace(in.Type) != "" {
		item.Type = in.Type
	}
	if strings.TrimSpace(in.Location) != "" {
		item.Location = in.Location
	}
	item.Manufacturer, item.Model = in.Manufacturer, in.Model
	created, err := inventoryService.Create(userID, InventoryInput{
		Kind: item.Kind, Type: item.Type, Name: item.Name, Manufacturer: item.Manufacturer, Model: item.Model,
		Quantity: 1, Status: item.Status, Location: item.Location, Specs: item.Specs, MacAddresses: item.MacAddresses,
	})
	if err != nil {
		return nil, err
	}
	if err := s.LinkItem(userID, id, node.Name, &created.ID); err != nil {
		return nil, err
	}
	return inventoryService.Get(userID, created.ID)
}
