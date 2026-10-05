package services

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/llm"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/secrets"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const testProviderKey = "sk-ant-api03-THIS-IS-A-SECRET-KEY-9f3a"

func testKeyring(t *testing.T, version int) *secrets.Keyring {
	t.Helper()
	encoded, err := secrets.GenerateKey()
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	key, _ := secrets.ParseKey(encoded)
	keyring, err := secrets.NewKeyring(version, key, secrets.SourceEnv)
	if err != nil {
		t.Fatalf("keyring: %v", err)
	}
	return keyring
}

func boolPtr(value bool) *bool { return &value }

// newAssistantSettings returns a service on a shared (public) instance: private
// endpoints are not allowed.
func newAssistantSettings(t *testing.T) (*AssistantSettingsService, *gorm.DB, uuid.UUID) {
	t.Helper()
	tx := testTx(t)
	return NewAssistantSettingsService(tx, testKeyring(t, 1), true, false), tx, newTestUser(t, tx).ID
}

func TestAssistantSettings_KeyIsEncryptedAndNeverReturned(t *testing.T) {
	svc, tx, userID := newAssistantSettings(t)

	empty, err := svc.Get(userID)
	if err != nil || empty.Enabled || empty.HasKey || empty.Ready || !empty.Available || empty.KeyStorage != nil {
		t.Fatalf("fresh settings: %+v, %v", empty, err)
	}
	if len(empty.Providers) != len(llm.Presets) {
		t.Fatalf("the view should list the supported providers, got %d", len(empty.Providers))
	}

	view, err := svc.Update(userID, UpdateAssistantSettingsInput{
		Enabled: boolPtr(true), Provider: strPtr(llm.ProviderAnthropic), APIKey: strPtr("  " + testProviderKey + "\n"),
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if !view.Enabled || !view.HasKey || !view.KeyUsable || !view.Ready || view.Model != "claude-opus-5" || view.KeyHint != "9f3a" {
		t.Fatalf("unexpected view: %+v", view)
	}

	// Nothing the API returns contains the key.
	raw, _ := json.Marshal(view)
	if strings.Contains(string(raw), testProviderKey) || strings.Contains(string(raw), "THIS-IS-A-SECRET") {
		t.Fatalf("the settings view leaks the key: %s", raw)
	}
	storage := view.KeyStorage
	if storage == nil || storage.Algorithm != "AES-256-GCM" || storage.MasterKeySource != secrets.SourceEnv ||
		len(storage.NonceHex) != 24 || storage.CiphertextBytes != len(testProviderKey)+16 || storage.StoredAt == nil ||
		!strings.Contains(storage.BoundTo, userID.String()) {
		t.Fatalf("unexpected key storage description: %+v", storage)
	}

	// The database row holds ciphertext only.
	var row models.AssistantSettings
	if err := tx.First(&row, "user_id = ?", userID).Error; err != nil {
		t.Fatalf("load row: %v", err)
	}
	if bytes.Contains(row.KeyCiphertext, []byte(testProviderKey)) || bytes.Contains(row.KeyCiphertext, []byte("SECRET")) {
		t.Fatal("the key is stored in the clear")
	}
	var leaked int64
	tx.Raw(`SELECT count(*) FROM assistant_settings WHERE user_id = ? AND (
		encode(key_ciphertext, 'escape') LIKE ? OR provider LIKE ? OR model LIKE ? OR base_url LIKE ? OR key_hint LIKE ?)`,
		userID, "%SECRET%", "%SECRET%", "%SECRET%", "%SECRET%", "%SECRET%").Scan(&leaked)
	if leaked != 0 {
		t.Fatal("part of the key is readable in the settings row")
	}
	if strings.HasPrefix(storage.CiphertextPreview, "736b2d") { // hex of "sk-"
		t.Fatal("the storage preview must show ciphertext, not the key")
	}
	// The model itself is never serialised with key material either.
	rowJSON, _ := json.Marshal(row)
	if strings.Contains(string(rowJSON), "key_ciphertext") || strings.Contains(string(rowJSON), "9f3a") {
		t.Fatalf("the model must not expose key fields in JSON: %s", rowJSON)
	}

	credentials, err := svc.ResolveCredentials(userID)
	if err != nil || credentials.APIKey != testProviderKey || credentials.Provider != llm.ProviderAnthropic || credentials.BaseURL != "" {
		t.Fatalf("resolve: %+v, %v", credentials, err)
	}
	if after, _ := svc.Get(userID); after.KeyStorage.LastUsedAt == nil {
		t.Fatal("using the key should record when it was last used")
	}
}

func TestAssistantSettings_KeyIsBoundToItsOwnerAndMasterKey(t *testing.T) {
	svc, tx, alice := newAssistantSettings(t)
	bob := newTestUser(t, tx).ID
	for _, userID := range []uuid.UUID{alice, bob} {
		if _, err := svc.Update(userID, UpdateAssistantSettingsInput{
			Enabled: boolPtr(true), Provider: strPtr(llm.ProviderAnthropic), APIKey: strPtr(testProviderKey + userID.String()[:4]),
		}); err != nil {
			t.Fatalf("update: %v", err)
		}
	}

	// Copy Alice's encrypted key into Bob's row, as someone with database
	// write access might: it must not decrypt under Bob's account.
	var aliceRow models.AssistantSettings
	tx.First(&aliceRow, "user_id = ?", alice)
	if err := tx.Model(&models.AssistantSettings{}).Where("user_id = ?", bob).Updates(map[string]any{
		"key_ciphertext": aliceRow.KeyCiphertext, "key_nonce": aliceRow.KeyNonce, "key_version": aliceRow.KeyVersion,
	}).Error; err != nil {
		t.Fatalf("swap: %v", err)
	}
	if _, err := svc.ResolveCredentials(bob); !errors.Is(err, ErrAssistantKeyUnusable) {
		t.Fatalf("a copied ciphertext must not decrypt for another account, got %v", err)
	}
	if view, _ := svc.Get(bob); view.KeyUsable || view.Ready || !view.HasKey {
		t.Fatalf("the view should ask for the key again: %+v", view)
	}

	// A different master key (rotated or wrong SECRETS_KEY) cannot read old keys.
	rotated := NewAssistantSettingsService(tx, testKeyring(t, 2), true, false)
	if _, err := rotated.ResolveCredentials(alice); !errors.Is(err, ErrAssistantKeyUnusable) {
		t.Fatalf("expected the key to be unusable after rotation, got %v", err)
	}
	// Entering the key again seals it under the current master key.
	view, err := rotated.Update(alice, UpdateAssistantSettingsInput{APIKey: strPtr(testProviderKey)})
	if err != nil || !view.KeyUsable || view.KeyStorage.MasterKeyVersion != 2 {
		t.Fatalf("re-entering the key: %+v, %v", view, err)
	}
}

func TestAssistantSettings_KeyNeverFollowsAChangeOfDestination(t *testing.T) {
	svc, _, userID := newAssistantSettings(t)
	configure := func() {
		t.Helper()
		if _, err := svc.Update(userID, UpdateAssistantSettingsInput{
			Enabled: boolPtr(true), Provider: strPtr(llm.ProviderOpenAICompatible),
			BaseURL: strPtr("https://llm.example.com/v1"), Model: strPtr("my-model"), APIKey: strPtr(testProviderKey),
		}); err != nil {
			t.Fatalf("configure: %v", err)
		}
	}

	configure()
	// Pointing the same provider at another address drops the key...
	view, err := svc.Update(userID, UpdateAssistantSettingsInput{BaseURL: strPtr("https://attacker.example/v1")})
	if err != nil || view.HasKey || view.KeyStorage != nil || view.BaseURL != "https://attacker.example/v1" {
		t.Fatalf("the key must not move to a new endpoint: %+v, %v", view, err)
	}
	// This kind of endpoint may run without a key, so it is still usable, but
	// the old key is gone: nothing is sent to the new address.
	if credentials, err := svc.ResolveCredentials(userID); err != nil || credentials.APIKey != "" {
		t.Fatalf("the new endpoint must not receive the old key: %+v, %v", credentials, err)
	}

	configure()
	// ...and so does switching provider.
	view, err = svc.Update(userID, UpdateAssistantSettingsInput{Provider: strPtr(llm.ProviderOpenAI)})
	if err != nil || view.HasKey || view.BaseURL != "" || view.Model != "" {
		t.Fatalf("the key must not move to a new provider: %+v, %v", view, err)
	}

	configure()
	// Unless a new key comes with the same request.
	view, err = svc.Update(userID, UpdateAssistantSettingsInput{Provider: strPtr(llm.ProviderOpenAI), Model: strPtr("some-model"), APIKey: strPtr("sk-new-key-for-openai-1234")})
	if err != nil || !view.HasKey || view.KeyHint != "1234" || !view.Ready {
		t.Fatalf("a key sent with the change should be stored: %+v, %v", view, err)
	}
	// Changing only the model or the on/off switch keeps it.
	view, _ = svc.Update(userID, UpdateAssistantSettingsInput{Model: strPtr("another-model"), Enabled: boolPtr(false)})
	if !view.HasKey || view.Enabled || view.Ready {
		t.Fatalf("unexpected view: %+v", view)
	}
	if _, err := svc.ResolveCredentials(userID); !errors.Is(err, ErrAssistantDisabled) {
		t.Fatalf("a switched-off assistant must not resolve credentials: %v", err)
	}
	// Testing a key works before the assistant is switched on.
	if credentials, err := svc.ResolveCredentialsForTest(userID); err != nil || credentials.APIKey == "" {
		t.Fatalf("resolve for test: %v", err)
	}

	view, err = svc.DeleteKey(userID)
	if err != nil || view.HasKey || view.KeyStorage != nil || view.Provider != llm.ProviderOpenAI {
		t.Fatalf("delete key: %+v, %v", view, err)
	}
	if err := svc.Reset(userID); err != nil {
		t.Fatalf("reset: %v", err)
	}
	if view, _ := svc.Get(userID); view.Provider != "" || view.Enabled {
		t.Fatalf("reset should clear everything: %+v", view)
	}
}

func TestAssistantSettings_EndpointPolicy(t *testing.T) {
	shared, _, userID := newAssistantSettings(t)

	// A public instance never calls private addresses for a user.
	for _, address := range []string{"http://192.168.1.50:11434/v1", "https://10.0.0.1/v1", "https://169.254.169.254/", "http://llm.example.com/v1", "https://localhost/v1"} {
		_, err := shared.Update(userID, UpdateAssistantSettingsInput{Provider: strPtr(llm.ProviderOpenAICompatible), BaseURL: strPtr(address)})
		if !errors.Is(err, ErrAssistantInput) {
			t.Errorf("%s must be refused on a shared instance, got %v", address, err)
		}
	}
	// Ollama's suggested address is private, so it is not pre-filled there.
	view, err := shared.Update(userID, UpdateAssistantSettingsInput{Enabled: boolPtr(true), Provider: strPtr(llm.ProviderOllama), Model: strPtr("llama3.1")})
	if err != nil || view.BaseURL != "" || view.Ready || view.AllowPrivateEndpoints {
		t.Fatalf("unexpected view: %+v, %v", view, err)
	}
	if _, err := shared.ResolveCredentials(userID); !errors.Is(err, ErrAssistantNotConfigured) {
		t.Fatalf("resolve without an endpoint: %v", err)
	}
	// Fixed providers ignore an address: "OpenAI" cannot be pointed elsewhere.
	view, err = shared.Update(userID, UpdateAssistantSettingsInput{Provider: strPtr(llm.ProviderOpenAI), BaseURL: strPtr("https://evil.example/v1")})
	if err != nil || view.BaseURL != "" {
		t.Fatalf("fixed provider accepted an address: %+v, %v", view, err)
	}

	// A self-hosted instance may use its own network, and Ollama needs no key.
	tx := testTx(t)
	selfHosted := NewAssistantSettingsService(tx, testKeyring(t, 1), true, true)
	owner := newTestUser(t, tx).ID
	view, err = selfHosted.Update(owner, UpdateAssistantSettingsInput{Enabled: boolPtr(true), Provider: strPtr(llm.ProviderOllama), Model: strPtr("llama3.1")})
	if err != nil || view.BaseURL != "http://host.docker.internal:11434/v1" || !view.Ready || view.HasKey || !view.AllowPrivateEndpoints {
		t.Fatalf("unexpected self-hosted view: %+v, %v", view, err)
	}
	credentials, err := selfHosted.ResolveCredentials(owner)
	if err != nil || credentials.APIKey != "" || credentials.BaseURL != "http://host.docker.internal:11434/v1" {
		t.Fatalf("resolve: %+v, %v", credentials, err)
	}
	// A setting saved while private endpoints were allowed stops working once they are not.
	if _, err := NewAssistantSettingsService(tx, testKeyring(t, 1), true, false).ResolveCredentials(owner); !errors.Is(err, ErrAssistantNotConfigured) {
		t.Fatalf("the endpoint policy must be enforced at use, got %v", err)
	}
}

func TestAssistantSettings_ValidationAndAvailability(t *testing.T) {
	svc, tx, userID := newAssistantSettings(t)
	invalid := []UpdateAssistantSettingsInput{
		{Provider: strPtr("skynet")},
		{Provider: strPtr(llm.ProviderOpenAI), APIKey: strPtr("has a space")},
		{Provider: strPtr(llm.ProviderOpenAI), APIKey: strPtr(strings.Repeat("k", maxProviderKeyLength+1))},
		{Provider: strPtr(llm.ProviderOpenAI), Model: strPtr(strings.Repeat("m", maxModelNameLength+1))},
		{APIKey: strPtr("sk-key-without-provider-0000")},
	}
	for _, input := range invalid {
		if _, err := svc.Update(userID, input); !errors.Is(err, ErrAssistantInput) {
			t.Errorf("Update(%+v) = %v, want ErrAssistantInput", input, err)
		}
	}
	var rows int64
	tx.Model(&models.AssistantSettings{}).Where("user_id = ?", userID).Count(&rows)
	if rows != 0 {
		t.Fatal("rejected input must not be stored")
	}
	// An empty key field means "leave the stored key alone".
	if _, err := svc.Update(userID, UpdateAssistantSettingsInput{Provider: strPtr(llm.ProviderOpenAI), APIKey: strPtr(testProviderKey)}); err != nil {
		t.Fatalf("update: %v", err)
	}
	if view, err := svc.Update(userID, UpdateAssistantSettingsInput{Model: strPtr("m"), APIKey: strPtr("   ")}); err != nil || !view.HasKey {
		t.Fatalf("blank key should keep the stored one: %+v, %v", view, err)
	}

	// With the instance switch off, nothing can be saved or used.
	off := NewAssistantSettingsService(tx, testKeyring(t, 1), false, false)
	if view, _ := off.Get(userID); view.Available || view.Enabled || view.Ready {
		t.Fatalf("unavailable instance: %+v", view)
	}
	if _, err := off.Update(userID, UpdateAssistantSettingsInput{Enabled: boolPtr(true)}); !errors.Is(err, ErrAssistantUnavailable) {
		t.Fatalf("update: %v", err)
	}
	if _, err := off.ResolveCredentials(userID); !errors.Is(err, ErrAssistantUnavailable) {
		t.Fatalf("resolve: %v", err)
	}
	// No master key means no assistant, even if the switch is on.
	if view, _ := NewAssistantSettingsService(tx, nil, true, false).Get(userID); view.Available {
		t.Fatal("the assistant cannot be available without a master key")
	}
}

func TestAssistantSettings_KeyChangesAreAuditedWithoutTheKey(t *testing.T) {
	svc, tx, userID := newAssistantSettings(t)

	events := func() []models.Event {
		var rows []models.Event
		if err := tx.Where("user_id = ? AND event_type LIKE ?", userID, "assistant.key_%").Order("created_at, id").Find(&rows).Error; err != nil {
			t.Fatalf("load events: %v", err)
		}
		return rows
	}
	types := func(rows []models.Event) []string {
		names := make([]string, len(rows))
		for i, row := range rows {
			names[i] = row.EventType
		}
		return names
	}

	if _, err := svc.Update(userID, UpdateAssistantSettingsInput{Provider: strPtr(llm.ProviderAnthropic), APIKey: strPtr(testProviderKey)}); err != nil {
		t.Fatalf("store key: %v", err)
	}
	// Changing only the model touches neither the key nor the audit log.
	if _, err := svc.Update(userID, UpdateAssistantSettingsInput{Model: strPtr("claude-sonnet-5")}); err != nil {
		t.Fatalf("change model: %v", err)
	}
	if got := types(events()); len(got) != 1 || got[0] != "assistant.key_stored" {
		t.Fatalf("expected one key_stored event, got %v", got)
	}

	// Switching provider drops the key, and that is recorded too.
	if _, err := svc.Update(userID, UpdateAssistantSettingsInput{Provider: strPtr(llm.ProviderOpenAI)}); err != nil {
		t.Fatalf("switch provider: %v", err)
	}
	// Deleting when nothing is stored records nothing.
	if _, err := svc.DeleteKey(userID); err != nil {
		t.Fatalf("delete key: %v", err)
	}
	if _, err := svc.Update(userID, UpdateAssistantSettingsInput{APIKey: strPtr(testProviderKey)}); err != nil {
		t.Fatalf("store key again: %v", err)
	}
	if _, err := svc.DeleteKey(userID); err != nil {
		t.Fatalf("delete key: %v", err)
	}

	rows := events()
	want := []string{"assistant.key_stored", "assistant.key_deleted", "assistant.key_stored", "assistant.key_deleted"}
	if got := types(rows); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("audit trail = %v, want %v", got, want)
	}
	for _, row := range rows {
		if strings.Contains(row.Payload, testProviderKey) || strings.Contains(row.Payload, "SECRET") {
			t.Fatalf("audit event %s contains key material: %s", row.EventType, row.Payload)
		}
	}
}

func TestLoadKeyring(t *testing.T) {
	tx := testTx(t)
	encoded, _ := secrets.GenerateKey()

	fromEnv, err := LoadKeyring(tx, encoded, 3, true)
	if err != nil || fromEnv.Source != secrets.SourceEnv || fromEnv.CurrentVersion() != 3 {
		t.Fatalf("env key: %+v, %v", fromEnv, err)
	}
	var stored int64
	tx.Model(&models.SystemSetting{}).Count(&stored)
	if stored != 0 {
		t.Fatal("a key from the environment must never be written to the database")
	}
	if _, err := LoadKeyring(tx, "too-short", 1, false); err == nil || !strings.Contains(err.Error(), "SECRETS_KEY") {
		t.Fatalf("a malformed key must be reported: %v", err)
	}
	// A public instance refuses to fall back to a key kept in the database.
	if _, err := LoadKeyring(tx, "", 1, true); err == nil || !strings.Contains(err.Error(), "SECRETS_KEY is required") {
		t.Fatalf("expected a clear error, got %v", err)
	}

	// A self-hosted instance generates its key once and reuses it.
	first, err := LoadKeyring(tx, "", 1, false)
	if err != nil || first.Source != secrets.SourceDatabase {
		t.Fatalf("generated key: %+v, %v", first, err)
	}
	second, err := LoadKeyring(tx, "", 1, false)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	ciphertext, nonce, version, _ := first.Seal([]byte("secret"), []byte("aad"))
	if opened, err := second.Open(ciphertext, nonce, version, []byte("aad")); err != nil || string(opened) != "secret" {
		t.Fatalf("the generated key must be stable across restarts: %v", err)
	}
	tx.Model(&models.SystemSetting{}).Count(&stored)
	if stored != 1 {
		t.Fatalf("expected one stored key, found %d", stored)
	}
}

func TestAssistantThreads_AppendOrderAndClear(t *testing.T) {
	f := newProposalFixture(t)
	threads := NewAssistantThreadService(f.tx)

	if thread, err := threads.Find(f.userID, f.build.ID); err != nil || thread != nil {
		t.Fatalf("no thread yet: %+v, %v", thread, err)
	}
	thread, err := threads.GetOrCreate(f.userID, f.build.ID)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	again, _ := threads.GetOrCreate(f.userID, f.build.ID)
	if again.ID != thread.ID {
		t.Fatal("a user has one thread per build")
	}

	native := json.RawMessage(`{"role":"assistant","content":[{"type":"text","text":"hi"}]}`)
	if _, err := threads.Append(thread.ID, AssistantRoleUser, "", "", []MessagePart{{Type: PartContext, Text: "[ctx]"}, {Type: PartText, Text: "hello"}}, nil, false); err != nil {
		t.Fatalf("append: %v", err)
	}
	reply, err := threads.Append(thread.ID, AssistantRoleAssistant, "anthropic", "claude-opus-5",
		[]MessagePart{{Type: PartText, Text: "hi"}, {Type: PartToolCall, ID: "t1", Name: "get_build", Input: json.RawMessage(`{"build_id":"x"}`)}}, native, false)
	if err != nil || reply.Seq != 2 {
		t.Fatalf("append reply: %+v, %v", reply, err)
	}
	messages, err := threads.Messages(thread.ID)
	if err != nil || len(messages) != 2 || messages[0].Seq != 1 || messages[1].Role != AssistantRoleAssistant {
		t.Fatalf("messages: %+v, %v", messages, err)
	}
	parts := DecodeParts(messages[1])
	var input map[string]string
	if len(parts) != 2 || parts[1].Name != "get_build" || json.Unmarshal(parts[1].Input, &input) != nil || input["build_id"] != "x" {
		t.Fatalf("parts not stored faithfully: %+v", parts)
	}
	if len(messages[1].Native) == 0 || messages[1].Provider != "anthropic" || messages[1].Model != "claude-opus-5" {
		t.Fatalf("the provider's own message should be kept with its origin: %+v", messages[1])
	}
	// The provider's native message is kept for replay but never serialised to clients.
	if raw, _ := json.Marshal(messages[1]); strings.Contains(string(raw), "native") {
		t.Fatalf("native message leaked into JSON: %s", raw)
	}

	// Another user's thread for the same build id is separate (and empty).
	if other, _ := threads.Find(newTestUser(t, f.tx).ID, f.build.ID); other != nil {
		t.Fatal("threads are per user")
	}

	if err := threads.Clear(f.userID, f.build.ID); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if left, _ := threads.Messages(thread.ID); len(left) != 0 {
		t.Fatalf("%d messages left after clearing", len(left))
	}
	if err := threads.Clear(f.userID, f.build.ID); err != nil {
		t.Fatalf("clearing an empty conversation should be fine: %v", err)
	}

	// Deleting the build removes its conversation.
	thread, _ = threads.GetOrCreate(f.userID, f.build.ID)
	_, _ = threads.Append(thread.ID, AssistantRoleUser, "", "", []MessagePart{{Type: PartText, Text: "hello"}}, nil, false)
	if err := f.builds.Delete(f.build.ID, f.userID); err != nil {
		t.Fatalf("delete build: %v", err)
	}
	var threadsLeft, messagesLeft int64
	f.tx.Model(&models.AssistantThread{}).Where("build_id = ?", f.build.ID).Count(&threadsLeft)
	f.tx.Model(&models.AssistantMessage{}).Where("thread_id = ?", thread.ID).Count(&messagesLeft)
	if threadsLeft != 0 || messagesLeft != 0 {
		t.Fatalf("conversation must be deleted with its build: %d threads, %d messages", threadsLeft, messagesLeft)
	}
}
