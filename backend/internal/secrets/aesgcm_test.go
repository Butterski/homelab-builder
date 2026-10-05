package secrets

import (
	"bytes"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
)

func testKeyring(t *testing.T, version int) *Keyring {
	t.Helper()
	encoded, err := GenerateKey()
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	key, err := ParseKey(encoded)
	if err != nil {
		t.Fatalf("parse key: %v", err)
	}
	keyring, err := NewKeyring(version, key, SourceEnv)
	if err != nil {
		t.Fatalf("keyring: %v", err)
	}
	return keyring
}

func TestSealOpenRoundTrip(t *testing.T) {
	keyring := testKeyring(t, 3)
	secret := []byte("sk-ant-api03-very-secret-value")
	aad := []byte("hlb:assistant-key:v1|user:1111")

	ciphertext, nonce, version, err := keyring.Seal(secret, aad)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	if version != 3 || len(nonce) != NonceSize {
		t.Fatalf("version %d, nonce %d bytes", version, len(nonce))
	}
	if bytes.Contains(ciphertext, secret) || bytes.Contains(ciphertext, []byte("secret")) {
		t.Fatal("ciphertext contains the plaintext")
	}
	// GCM appends a 16-byte authentication tag.
	if len(ciphertext) != len(secret)+16 {
		t.Fatalf("unexpected ciphertext length %d", len(ciphertext))
	}

	opened, err := keyring.Open(ciphertext, nonce, version, aad)
	if err != nil || !bytes.Equal(opened, secret) {
		t.Fatalf("open: %q, %v", opened, err)
	}
}

func TestOpenRejectsTamperingAndWrongOwner(t *testing.T) {
	keyring := testKeyring(t, 1)
	aad := []byte("hlb:assistant-key:v1|user:alice")
	ciphertext, nonce, version, _ := keyring.Seal([]byte("secret-key"), aad)

	flipped := append([]byte(nil), ciphertext...)
	flipped[0] ^= 0x01
	badNonce := append([]byte(nil), nonce...)
	badNonce[0] ^= 0x01

	cases := map[string]func() ([]byte, error){
		"altered ciphertext": func() ([]byte, error) { return keyring.Open(flipped, nonce, version, aad) },
		"altered nonce":      func() ([]byte, error) { return keyring.Open(ciphertext, badNonce, version, aad) },
		"truncated":          func() ([]byte, error) { return keyring.Open(ciphertext[:len(ciphertext)-1], nonce, version, aad) },
		"short nonce":        func() ([]byte, error) { return keyring.Open(ciphertext, nonce[:8], version, aad) },
		// The row was copied to another account: the owner binding no longer matches.
		"another owner": func() ([]byte, error) {
			return keyring.Open(ciphertext, nonce, version, []byte("hlb:assistant-key:v1|user:mallory"))
		},
		"missing aad": func() ([]byte, error) { return keyring.Open(ciphertext, nonce, version, nil) },
	}
	for name, open := range cases {
		if plaintext, err := open(); !errors.Is(err, ErrDecrypt) || plaintext != nil {
			t.Errorf("%s: got %q, %v; want ErrDecrypt", name, plaintext, err)
		}
	}

	// A different master key cannot open it either.
	if _, err := testKeyring(t, 1).Open(ciphertext, nonce, version, aad); !errors.Is(err, ErrDecrypt) {
		t.Fatalf("other master key: %v", err)
	}
	// An unknown key version is reported as such, so the UI can ask for the key again.
	if _, err := keyring.Open(ciphertext, nonce, 2, aad); !errors.Is(err, ErrKeyUnavailable) {
		t.Fatalf("unknown version: %v", err)
	}
}

func TestSealUsesAFreshNonceEveryTime(t *testing.T) {
	keyring := testKeyring(t, 1)
	seen := map[string]bool{}
	var first []byte
	for i := 0; i < 200; i++ {
		ciphertext, nonce, _, err := keyring.Seal([]byte("same secret"), []byte("aad"))
		if err != nil {
			t.Fatalf("seal: %v", err)
		}
		if seen[string(nonce)] {
			t.Fatal("nonce reused")
		}
		seen[string(nonce)] = true
		if first == nil {
			first = ciphertext
		} else if i == 1 && bytes.Equal(first, ciphertext) {
			t.Fatal("equal plaintexts must not produce equal ciphertexts")
		}
	}
}

func TestParseKey(t *testing.T) {
	raw := bytes.Repeat([]byte{0xAB}, KeySize)
	for name, encoded := range map[string]string{
		"standard":        base64.StdEncoding.EncodeToString(raw),
		"url safe":        base64.URLEncoding.EncodeToString(raw),
		"unpadded":        base64.RawStdEncoding.EncodeToString(raw),
		"with whitespace": "  " + base64.StdEncoding.EncodeToString(raw) + "\n",
	} {
		key, err := ParseKey(encoded)
		if err != nil || !bytes.Equal(key, raw) {
			t.Errorf("%s: %v", name, err)
		}
	}

	for name, encoded := range map[string]string{
		"empty":      "",
		"not base64": "not a key!!",
		"too short":  base64.StdEncoding.EncodeToString(raw[:16]),
		"too long":   base64.StdEncoding.EncodeToString(append(raw, 1)),
	} {
		if _, err := ParseKey(encoded); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
	if _, err := NewKeyring(1, raw[:8], SourceEnv); err == nil || !strings.Contains(err.Error(), "32 bytes") {
		t.Fatalf("short key accepted: %v", err)
	}
}
