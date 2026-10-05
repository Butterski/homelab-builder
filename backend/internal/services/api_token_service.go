package services

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	// APITokenPrefix makes tokens recognisable to people and secret scanners.
	APITokenPrefix = "hlb_"

	TokenScopeRead    = "read"
	TokenScopePropose = "propose"

	MaxAPITokensPerUser = 20
	maxTokenNameLength  = 80
	maxTokenLifetime    = 366 // days
	tokenBodyLength     = 43  // base62 characters, about 256 bits
	tokenDisplayLength  = 8   // characters kept for display, prefix included
	// lastUsedInterval limits how often a busy token writes its last-used time.
	lastUsedInterval = time.Minute
)

var (
	ErrTokenNotFound = errors.New("token not found")
	ErrTokenInvalid  = errors.New("invalid or expired token")
	ErrTokenLimit    = fmt.Errorf("token limit reached (%d per account)", MaxAPITokensPerUser)
	ErrTokenInput    = errors.New("invalid token request")
)

const base62Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// APITokenService issues and verifies personal access tokens for MCP clients.
// Only a SHA-256 hash of each token is stored; the plaintext exists once, in
// the response that creates it.
type APITokenService struct {
	db *gorm.DB
}

func NewAPITokenService(db *gorm.DB) *APITokenService {
	return &APITokenService{db: db}
}

type CreateTokenInput struct {
	Name          string     `json:"name"`
	Scope         string     `json:"scope"`
	BuildID       *uuid.UUID `json:"build_id"`
	ExpiresInDays *int       `json:"expires_in_days"`
}

// HashAPIToken is the lookup key stored for a token. Tokens carry about 256 bits
// of entropy, so a fast hash is enough and no per-token salt is needed.
func HashAPIToken(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(sum[:])
}

func generateAPIToken() (string, error) {
	limit := big.NewInt(int64(len(base62Alphabet)))
	body := make([]byte, tokenBodyLength)
	for i := range body {
		n, err := rand.Int(rand.Reader, limit)
		if err != nil {
			return "", err
		}
		body[i] = base62Alphabet[n.Int64()]
	}
	return APITokenPrefix + string(body), nil
}

// Create issues a token and returns its plaintext, which is never stored.
func (s *APITokenService) Create(userID uuid.UUID, in CreateTokenInput) (string, *models.APIToken, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" || len([]rune(name)) > maxTokenNameLength {
		return "", nil, fmt.Errorf("%w: name is required (%d characters at most)", ErrTokenInput, maxTokenNameLength)
	}
	scope := strings.ToLower(strings.TrimSpace(in.Scope))
	if scope != TokenScopeRead && scope != TokenScopePropose {
		return "", nil, fmt.Errorf("%w: scope must be %q or %q", ErrTokenInput, TokenScopeRead, TokenScopePropose)
	}
	var expiresAt *time.Time
	if in.ExpiresInDays != nil {
		if *in.ExpiresInDays < 1 || *in.ExpiresInDays > maxTokenLifetime {
			return "", nil, fmt.Errorf("%w: expires_in_days must be between 1 and %d", ErrTokenInput, maxTokenLifetime)
		}
		expiry := time.Now().Add(time.Duration(*in.ExpiresInDays) * 24 * time.Hour)
		expiresAt = &expiry
	}
	if in.BuildID != nil {
		var owned int64
		if err := s.db.Model(&models.Build{}).Where("id = ? AND user_id = ?", *in.BuildID, userID).Count(&owned).Error; err != nil {
			return "", nil, err
		}
		if owned == 0 {
			return "", nil, fmt.Errorf("%w: build not found", ErrTokenInput)
		}
	}
	var existing int64
	if err := s.db.Model(&models.APIToken{}).Where("user_id = ?", userID).Count(&existing).Error; err != nil {
		return "", nil, err
	}
	if existing >= MaxAPITokensPerUser {
		return "", nil, ErrTokenLimit
	}

	plaintext, err := generateAPIToken()
	if err != nil {
		return "", nil, err
	}
	token := &models.APIToken{
		UserID:    userID,
		Name:      name,
		Prefix:    plaintext[:tokenDisplayLength],
		TokenHash: HashAPIToken(plaintext),
		Scope:     scope,
		BuildID:   in.BuildID,
		ExpiresAt: expiresAt,
	}
	if err := s.db.Create(token).Error; err != nil {
		return "", nil, err
	}
	RecordEvent(s.db, &userID, "api_token.created", map[string]any{"token_id": token.ID, "scope": scope, "build_id": in.BuildID})
	return plaintext, token, nil
}

func (s *APITokenService) List(userID uuid.UUID) ([]models.APIToken, error) {
	tokens := []models.APIToken{}
	err := s.db.Where("user_id = ?", userID).Order("created_at desc").Find(&tokens).Error
	return tokens, err
}

// Revoke deletes a token; it stops working immediately.
func (s *APITokenService) Revoke(userID, tokenID uuid.UUID) error {
	result := s.db.Where("id = ? AND user_id = ?", tokenID, userID).Delete(&models.APIToken{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrTokenNotFound
	}
	RecordEvent(s.db, &userID, "api_token.revoked", map[string]any{"token_id": tokenID})
	return nil
}

// Authenticate resolves a presented token. Unknown, malformed and expired
// tokens are indistinguishable to the caller.
func (s *APITokenService) Authenticate(plaintext, clientIP string) (*models.APIToken, error) {
	plaintext = strings.TrimSpace(plaintext)
	if !strings.HasPrefix(plaintext, APITokenPrefix) || len(plaintext) != len(APITokenPrefix)+tokenBodyLength {
		return nil, ErrTokenInvalid
	}
	var token models.APIToken
	err := s.db.First(&token, "token_hash = ?", HashAPIToken(plaintext)).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrTokenInvalid
	}
	if err != nil {
		return nil, err
	}
	now := time.Now()
	if token.ExpiresAt != nil && !token.ExpiresAt.After(now) {
		return nil, ErrTokenInvalid
	}
	if token.LastUsedAt == nil || now.Sub(*token.LastUsedAt) >= lastUsedInterval {
		token.LastUsedAt, token.LastUsedIP = &now, clientIP
		_ = s.db.Model(&models.APIToken{}).Where("id = ?", token.ID).
			Updates(map[string]any{"last_used_at": now, "last_used_ip": clientIP}).Error
	}
	return &token, nil
}
