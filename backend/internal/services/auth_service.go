package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"google.golang.org/api/idtoken"
	"gorm.io/gorm"
)

type AuthService struct {
	db        *gorm.DB
	jwtSecret []byte
	clientID  string
}

func NewAuthService(db *gorm.DB) *AuthService {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "homelab-builder-dev-secret-change-in-production"
	}
	clientID := os.Getenv("GOOGLE_CLIENT_ID")
	return &AuthService{
		db:        db,
		jwtSecret: []byte(secret),
		clientID:  clientID,
	}
}

// ... (TokenClaims struct remains same)

type TokenClaims struct {
	UserID uuid.UUID `json:"user_id"`
	Email  string    `json:"email"`
	jwt.RegisteredClaims
}

type GoogleLoginInput struct {
	Credential string `json:"credential" binding:"required"` // The ID Token from frontend
}

type AuthResponse struct {
	Token string      `json:"token"`
	User  models.User `json:"user"`
}

func (s *AuthService) GoogleLogin(input GoogleLoginInput) (*AuthResponse, error) {
	if s.clientID == "" {
		return nil, errors.New("GOOGLE_CLIENT_ID not configured on backend")
	}

	// Verify the ID Token
	payload, err := idtoken.Validate(context.Background(), input.Credential, s.clientID)
	if err != nil {
		return nil, fmt.Errorf("invalid google token: %w", err)
	}

	// Extract user data from payload
	email, ok := payload.Claims["email"].(string)
	if !ok {
		return nil, errors.New("token missing email")
	}
	googleID, ok := payload.Claims["sub"].(string)
	if !ok {
		return nil, errors.New("token missing sub (google_id)")
	}
	name, _ := payload.Claims["name"].(string)
	picture, _ := payload.Claims["picture"].(string)

	return s.loginOrRegister(email, name, googleID, picture)
}

// GetOrCreateLocalAdmin provides a static user for self-hosted instances with AuthDisabled=true
func (s *AuthService) GetOrCreateLocalAdmin() (*models.User, error) {
	const localEmail = "local@homelab.local"
	const localName = "Local Admin"
	const localGoogleID = "local-auth-disabled"
	const localAvatarURL = "https://api.dicebear.com/7.x/avataaars/svg?seed=local-admin"

	var user models.User
	err := s.db.Where("email = ?", localEmail).First(&user).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			user = models.User{
				GoogleID:  localGoogleID,
				Email:     localEmail,
				Name:      localName,
				AvatarURL: localAvatarURL,
			}
			if createErr := s.db.Create(&user).Error; createErr != nil {
				return nil, fmt.Errorf("failed to create local admin: %w", createErr)
			}
			return &user, nil
		}
		return nil, fmt.Errorf("database error checking local admin: %w", err)
	}

	// Local admin already exists
	return &user, nil
}

// DevLogin bypasses Google Auth for local development
func (s *AuthService) DevLogin(email string) (*AuthResponse, error) {
	if email == "" {
		return nil, errors.New("email required")
	}

	// Mock a Google ID based on email
	mockGoogleID := "dev-" + email
	name := "Dev User (" + email + ")"
	avatarURL := "https://api.dicebear.com/7.x/avataaars/svg?seed=" + email

	return s.loginOrRegister(email, name, mockGoogleID, avatarURL)
}

func (s *AuthService) loginOrRegister(email, name, googleID, avatarURL string) (*AuthResponse, error) {
	var user models.User

	// 1. Try to find by Google ID
	err := s.db.Where("google_id = ?", googleID).First(&user).Error

	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// 2. Not found by Google ID — check if email exists
			emailErr := s.db.Where("email = ?", email).First(&user).Error

			if emailErr == nil {
				// Found by email! Link this account to the Google ID
				// This handles the "Seed User" case where GoogleID was empty
				user.GoogleID = googleID
				user.Name = name
				user.AvatarURL = avatarURL
				if saveErr := s.db.Save(&user).Error; saveErr != nil {
					return nil, fmt.Errorf("failed to link existing user: %w", saveErr)
				}
			} else if errors.Is(emailErr, gorm.ErrRecordNotFound) {
				// 3. Not found by Email either — Create new user
				user = models.User{
					GoogleID:  googleID,
					Email:     email,
					Name:      name,
					AvatarURL: avatarURL,
				}
				if createErr := s.db.Create(&user).Error; createErr != nil {
					return nil, fmt.Errorf("failed to create user: %w", createErr)
				}
			} else {
				// DB error on email check
				return nil, fmt.Errorf("database error checking email: %w", emailErr)
			}
		} else {
			// DB error on google_id check
			return nil, fmt.Errorf("database error checking google_id: %w", err)
		}
	} else {
		// Found by Google ID — Update details
		updates := map[string]interface{}{
			"email":      email,
			"name":       name,
			"avatar_url": avatarURL,
		}
		s.db.Model(&user).Updates(updates)
	}

	token, err := s.generateToken(user)
	if err != nil {
		return nil, err
	}

	return &AuthResponse{
		Token: token,
		User:  user,
	}, nil
}

func (s *AuthService) GetCurrentUser(userID uuid.UUID) (*models.User, error) {
	var user models.User
	if err := s.db.First(&user, "id = ?", userID).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *AuthService) UpdatePreferences(userID uuid.UUID, prefs map[string]interface{}) (*models.User, error) {
	var user models.User
	if err := s.db.First(&user, "id = ?", userID).Error; err != nil {
		return nil, err
	}

	// Unmarshal existing preferences to merge
	var existingPrefs map[string]interface{}
	if len(user.Preferences) > 0 {
		if err := json.Unmarshal(user.Preferences, &existingPrefs); err != nil {
			existingPrefs = make(map[string]interface{})
		}
	} else {
		existingPrefs = make(map[string]interface{})
	}

	// Merge incoming prefs
	for k, v := range prefs {
		existingPrefs[k] = v
	}

	rawPrefs, err := json.Marshal(existingPrefs)
	if err != nil {
		return nil, fmt.Errorf("invalid preferences payload: %w", err)
	}

	user.Preferences = rawPrefs
	if err := s.db.Save(&user).Error; err != nil {
		return nil, fmt.Errorf("failed to save preferences: %w", err)
	}

	return &user, nil
}

func (s *AuthService) generateToken(user models.User) (string, error) {
	claims := TokenClaims{
		UserID: user.ID,
		Email:  user.Email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(7 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "homelab-builder",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.jwtSecret)
}

func (s *AuthService) ValidateToken(tokenString string) (*TokenClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &TokenClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return s.jwtSecret, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*TokenClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token claims")
}
