// Package secrets encrypts small secrets, such as a user's LLM provider key,
// before they are stored in the database.
//
// The scheme is AES-256-GCM with a random 96-bit nonce per value. The master
// key is supplied by the operator and never stored next to the ciphertext
// (see services.LoadKeyring for where it comes from). Every ciphertext is bound
// to its owner through the additional authenticated data, so a row copied to
// another account fails to decrypt instead of leaking the secret.
package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

const (
	// Algorithm names the scheme for display next to a stored secret.
	Algorithm = "AES-256-GCM"
	// KeySize is the master key length in bytes.
	KeySize = 32
	// NonceSize is the GCM nonce length in bytes.
	NonceSize = 12

	// SourceEnv means the master key comes from the SECRETS_KEY environment variable.
	SourceEnv = "env"
	// SourceDatabase means the instance generated its master key and keeps it in
	// its own database. That protects against a leaked table dump, not against
	// someone who can read the whole database.
	SourceDatabase = "database"
)

var (
	// ErrKeyUnavailable means a value was encrypted under a master key version
	// this instance does not hold. The secret has to be entered again.
	ErrKeyUnavailable = errors.New("secret was encrypted with a master key that is no longer available")
	// ErrDecrypt means the ciphertext, nonce or owner binding did not verify.
	ErrDecrypt = errors.New("secret could not be decrypted")
)

// Keyring holds the master keys by version. New values use the current version.
type Keyring struct {
	current int
	keys    map[int][]byte
	// Source says where the current master key comes from.
	Source string
}

// ParseKey decodes a base64 master key and checks it is exactly 32 bytes.
// Generate one with: openssl rand -base64 32
func ParseKey(encoded string) ([]byte, error) {
	encoded = strings.TrimSpace(encoded)
	for _, encoding := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if key, err := encoding.DecodeString(encoded); err == nil {
			if len(key) != KeySize {
				return nil, fmt.Errorf("master key must be %d bytes, got %d", KeySize, len(key))
			}
			return key, nil
		}
	}
	return nil, errors.New("master key is not valid base64")
}

// GenerateKey returns a new random master key, base64 encoded.
func GenerateKey() (string, error) {
	key := make([]byte, KeySize)
	if _, err := rand.Read(key); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(key), nil
}

// NewKeyring builds a keyring with a single master key.
func NewKeyring(version int, key []byte, source string) (*Keyring, error) {
	if len(key) != KeySize {
		return nil, fmt.Errorf("master key must be %d bytes, got %d", KeySize, len(key))
	}
	return &Keyring{current: version, keys: map[int][]byte{version: append([]byte(nil), key...)}, Source: source}, nil
}

// CurrentVersion is the master key version new values are sealed with.
func (k *Keyring) CurrentVersion() int { return k.current }

func (k *Keyring) aead(version int) (cipher.AEAD, error) {
	key, ok := k.keys[version]
	if !ok {
		return nil, ErrKeyUnavailable
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// Seal encrypts plaintext under the current master key. aad is authenticated but
// not encrypted; the same aad must be presented to Open.
func (k *Keyring) Seal(plaintext, aad []byte) (ciphertext, nonce []byte, version int, err error) {
	aead, err := k.aead(k.current)
	if err != nil {
		return nil, nil, 0, err
	}
	nonce = make([]byte, NonceSize)
	if _, err := rand.Read(nonce); err != nil {
		return nil, nil, 0, err
	}
	return aead.Seal(nil, nonce, plaintext, aad), nonce, k.current, nil
}

// Open decrypts a value sealed by Seal. It fails when the ciphertext or nonce
// was altered, or when aad differs from the one used to seal.
func (k *Keyring) Open(ciphertext, nonce []byte, version int, aad []byte) ([]byte, error) {
	aead, err := k.aead(version)
	if err != nil {
		return nil, err
	}
	if len(nonce) != NonceSize {
		return nil, ErrDecrypt
	}
	plaintext, err := aead.Open(nil, nonce, ciphertext, aad)
	if err != nil {
		return nil, ErrDecrypt
	}
	return plaintext, nil
}
