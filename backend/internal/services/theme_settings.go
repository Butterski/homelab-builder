package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

var ErrInvalidThemeSettings = errors.New("invalid theme settings")

const defaultThemeID = "dark"
const maxCustomThemes = 50

var allowedThemeTokenKeys = []string{
	"background",
	"foreground",
	"card",
	"card-foreground",
	"popover",
	"popover-foreground",
	"primary",
	"primary-foreground",
	"secondary",
	"secondary-foreground",
	"muted",
	"muted-foreground",
	"accent",
	"accent-foreground",
	"destructive",
	"border",
	"input",
	"ring",
	"chart-1",
	"chart-2",
	"chart-3",
	"chart-4",
	"chart-5",
	"sidebar",
	"sidebar-foreground",
	"sidebar-primary",
	"sidebar-primary-foreground",
	"sidebar-accent",
	"sidebar-accent-foreground",
	"sidebar-border",
	"sidebar-ring",
}

var allowedThemeTokenSet = func() map[string]struct{} {
	result := make(map[string]struct{}, len(allowedThemeTokenKeys))
	for _, key := range allowedThemeTokenKeys {
		result[key] = struct{}{}
	}
	return result
}()

type StoredTheme struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	Mode        string            `json:"mode"`
	Tokens      map[string]string `json:"tokens"`
}

type ThemeSettings struct {
	ActiveThemeID string        `json:"activeThemeId"`
	CustomThemes  []StoredTheme `json:"customThemes"`
}

func normalizeThemeID(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	var builder strings.Builder
	lastDash := false

	for _, char := range value {
		switch {
		case char >= 'a' && char <= 'z':
			builder.WriteRune(char)
			lastDash = false
		case char >= '0' && char <= '9':
			builder.WriteRune(char)
			lastDash = false
		default:
			if builder.Len() > 0 && !lastDash {
				builder.WriteRune('-')
				lastDash = true
			}
		}
	}

	return strings.Trim(builder.String(), "-")
}

func defaultThemeSettings() ThemeSettings {
	return ThemeSettings{
		ActiveThemeID: defaultThemeID,
		CustomThemes:  []StoredTheme{},
	}
}

func normalizeThemeSettingsInput(input ThemeSettings) (ThemeSettings, error) {
	activeThemeID := normalizeThemeID(input.ActiveThemeID)
	if activeThemeID == "" {
		return ThemeSettings{}, fmt.Errorf("%w: activeThemeId is required", ErrInvalidThemeSettings)
	}

	if len(input.CustomThemes) > maxCustomThemes {
		return ThemeSettings{}, fmt.Errorf("%w: too many custom themes", ErrInvalidThemeSettings)
	}

	customThemes := make([]StoredTheme, 0, len(input.CustomThemes))
	seenThemeIDs := make(map[string]struct{}, len(input.CustomThemes))

	for _, theme := range input.CustomThemes {
		normalizedThemeID := normalizeThemeID(theme.ID)
		if normalizedThemeID == "" {
			return ThemeSettings{}, fmt.Errorf("%w: custom theme id is required", ErrInvalidThemeSettings)
		}
		if _, exists := seenThemeIDs[normalizedThemeID]; exists {
			return ThemeSettings{}, fmt.Errorf("%w: duplicate custom theme id %q", ErrInvalidThemeSettings, normalizedThemeID)
		}
		seenThemeIDs[normalizedThemeID] = struct{}{}

		name := strings.TrimSpace(theme.Name)
		if name == "" {
			return ThemeSettings{}, fmt.Errorf("%w: custom theme name is required", ErrInvalidThemeSettings)
		}

		mode := strings.TrimSpace(strings.ToLower(theme.Mode))
		if mode != "dark" && mode != "light" {
			return ThemeSettings{}, fmt.Errorf("%w: custom theme mode must be dark or light", ErrInvalidThemeSettings)
		}

		if len(theme.Tokens) != len(allowedThemeTokenKeys) {
			return ThemeSettings{}, fmt.Errorf("%w: custom theme %q must include exactly %d tokens", ErrInvalidThemeSettings, normalizedThemeID, len(allowedThemeTokenKeys))
		}

		normalizedTokens := make(map[string]string, len(theme.Tokens))
		for key, value := range theme.Tokens {
			if _, ok := allowedThemeTokenSet[key]; !ok {
				return ThemeSettings{}, fmt.Errorf("%w: unsupported theme token %q", ErrInvalidThemeSettings, key)
			}
			trimmedValue := strings.TrimSpace(value)
			if trimmedValue == "" {
				return ThemeSettings{}, fmt.Errorf("%w: theme token %q cannot be empty", ErrInvalidThemeSettings, key)
			}
			normalizedTokens[key] = trimmedValue
		}

		for _, key := range allowedThemeTokenKeys {
			if _, ok := normalizedTokens[key]; !ok {
				return ThemeSettings{}, fmt.Errorf("%w: missing theme token %q", ErrInvalidThemeSettings, key)
			}
		}

		customThemes = append(customThemes, StoredTheme{
			ID:          normalizedThemeID,
			Name:        name,
			Description: strings.TrimSpace(theme.Description),
			Mode:        mode,
			Tokens:      normalizedTokens,
		})
	}

	return ThemeSettings{
		ActiveThemeID: activeThemeID,
		CustomThemes:  customThemes,
	}, nil
}

func decodeThemeSettings(value interface{}) (ThemeSettings, error) {
	rawValue, err := json.Marshal(value)
	if err != nil {
		return ThemeSettings{}, fmt.Errorf("%w: failed to encode theme settings", ErrInvalidThemeSettings)
	}

	var input ThemeSettings
	if err := json.Unmarshal(rawValue, &input); err != nil {
		return ThemeSettings{}, fmt.Errorf("%w: malformed theme settings payload", ErrInvalidThemeSettings)
	}

	return normalizeThemeSettingsInput(input)
}

func extractThemeSettings(preferences map[string]interface{}) ThemeSettings {
	if preferences == nil {
		return defaultThemeSettings()
	}

	if rawThemeSettings, ok := preferences["themeSettings"]; ok {
		if normalizedThemeSettings, err := decodeThemeSettings(rawThemeSettings); err == nil {
			return normalizedThemeSettings
		}
	}

	if rawThemeID, ok := preferences["theme"].(string); ok {
		normalizedThemeID := normalizeThemeID(rawThemeID)
		if normalizedThemeID != "" {
			return ThemeSettings{
				ActiveThemeID: normalizedThemeID,
				CustomThemes:  []StoredTheme{},
			}
		}
	}

	return defaultThemeSettings()
}

func normalizeThemePreferences(preferences map[string]interface{}) error {
	_, hasThemeSettings := preferences["themeSettings"]
	_, hasTheme := preferences["theme"]
	if !hasThemeSettings && !hasTheme {
		return nil
	}

	var themeSettings ThemeSettings
	if hasThemeSettings {
		normalizedThemeSettings, err := decodeThemeSettings(preferences["themeSettings"])
		if err != nil {
			return err
		}
		themeSettings = normalizedThemeSettings
	} else {
		rawThemeID, ok := preferences["theme"].(string)
		if !ok {
			return fmt.Errorf("%w: theme must be a string", ErrInvalidThemeSettings)
		}
		normalizedThemeID := normalizeThemeID(rawThemeID)
		if normalizedThemeID == "" {
			return fmt.Errorf("%w: theme is required", ErrInvalidThemeSettings)
		}
		themeSettings = ThemeSettings{
			ActiveThemeID: normalizedThemeID,
			CustomThemes:  []StoredTheme{},
		}
	}

	preferences["theme"] = themeSettings.ActiveThemeID
	preferences["themeSettings"] = themeSettings
	return nil
}

func (s *AuthService) loadUserPreferences(userID uuid.UUID) (*models.User, map[string]interface{}, error) {
	var user models.User
	if err := s.db.First(&user, "id = ?", userID).Error; err != nil {
		return nil, nil, err
	}

	preferences := make(map[string]interface{})
	if len(user.Preferences) > 0 {
		if err := json.Unmarshal(user.Preferences, &preferences); err != nil {
			preferences = make(map[string]interface{})
		}
	}

	return &user, preferences, nil
}

func (s *AuthService) saveUserPreferences(user *models.User, preferences map[string]interface{}) error {
	rawPreferences, err := json.Marshal(preferences)
	if err != nil {
		return fmt.Errorf("invalid preferences payload: %w", err)
	}

	user.Preferences = rawPreferences
	if err := s.db.Save(user).Error; err != nil {
		return fmt.Errorf("failed to save preferences: %w", err)
	}

	return nil
}

func (s *AuthService) GetThemeSettings(userID uuid.UUID) (*ThemeSettings, error) {
	_, preferences, err := s.loadUserPreferences(userID)
	if err != nil {
		return nil, err
	}

	themeSettings := extractThemeSettings(preferences)
	return &themeSettings, nil
}

func (s *AuthService) UpdateThemeSettings(userID uuid.UUID, input ThemeSettings) (*ThemeSettings, error) {
	normalizedThemeSettings, err := normalizeThemeSettingsInput(input)
	if err != nil {
		return nil, err
	}

	user, preferences, err := s.loadUserPreferences(userID)
	if err != nil {
		return nil, err
	}

	preferences["theme"] = normalizedThemeSettings.ActiveThemeID
	preferences["themeSettings"] = normalizedThemeSettings
	if err := s.saveUserPreferences(user, preferences); err != nil {
		return nil, err
	}

	return &normalizedThemeSettings, nil
}
