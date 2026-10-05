package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	ServerPort     string
	DBHost         string
	DBPort         string
	DBUser         string
	DBPassword     string
	DBName         string
	DBSSLMode      string
	DBType         string
	DBFile         string
	GoogleClientID string
	AuthDisabled   bool

	// MCPEnabled exposes the /mcp endpoint for external LLM clients.
	MCPEnabled bool
	// MCPAllowedOrigins lists browser origins allowed to call /mcp cross-origin.
	MCPAllowedOrigins []string
	// AssistantEnabled exposes the in-app bring-your-own-key assistant.
	AssistantEnabled bool
	// SecretsKey is the base64 master key (32 bytes) that encrypts stored provider keys.
	SecretsKey        string
	SecretsKeyVersion int
	// AssistantAllowPrivateEndpoints lets provider base URLs resolve to private
	// addresses (a LAN Ollama). Defaults to on only for auth-disabled self-hosting.
	AssistantAllowPrivateEndpoints bool
	// PublicAppURL is the browser-facing origin used in proposal review links.
	PublicAppURL string
}

func Load() *Config {
	clientId := getEnv("GOOGLE_CLIENT_ID", "")
	isAuthDisabled := clientId == "" || clientId == "your-client-id" || clientId == "your_client_id_here"

	return &Config{
		ServerPort:     getEnv("SERVER_PORT", "8080"),
		DBHost:         getEnv("DB_HOST", "postgres"),
		DBPort:         getEnv("DB_PORT", "5432"),
		DBUser:         getEnv("DB_USER", "homelab"),
		DBPassword:     getEnv("DB_PASSWORD", "homelab_password"),
		DBName:         getEnv("DB_NAME", "homelab_builder"),
		DBSSLMode:      getEnv("DB_SSLMODE", "disable"),
		DBType:         getEnv("DB_TYPE", "postgres"),
		DBFile:         getEnv("DB_FILE", "homelab.db"),
		GoogleClientID: clientId,
		AuthDisabled:   isAuthDisabled,

		MCPEnabled:                     getEnvBool("MCP_ENABLED", true),
		MCPAllowedOrigins:              getEnvList("MCP_ALLOWED_ORIGINS"),
		AssistantEnabled:               getEnvBool("ASSISTANT_ENABLED", true),
		SecretsKey:                     strings.TrimSpace(getEnv("SECRETS_KEY", "")),
		SecretsKeyVersion:              getEnvInt("SECRETS_KEY_VERSION", 1),
		AssistantAllowPrivateEndpoints: getEnvBool("ASSISTANT_ALLOW_PRIVATE_ENDPOINTS", isAuthDisabled),
		PublicAppURL:                   strings.TrimRight(strings.TrimSpace(getEnv("PUBLIC_APP_URL", "")), "/"),
	}
}

func (c *Config) DatabaseDSN() string {
	return fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		c.DBHost, c.DBPort, c.DBUser, c.DBPassword, c.DBName, c.DBSSLMode,
	)
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool {
	value, exists := os.LookupEnv(key)
	if !exists || strings.TrimSpace(value) == "" {
		return defaultValue
	}
	parsed, err := strconv.ParseBool(strings.TrimSpace(value))
	if err != nil {
		return defaultValue
	}
	return parsed
}

// getEnvList reads a comma-separated value into its non-empty entries.
func getEnvList(key string) []string {
	values := []string{}
	for _, part := range strings.Split(getEnv(key, ""), ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			values = append(values, trimmed)
		}
	}
	return values
}

func getEnvInt(key string, defaultValue int) int {
	value, exists := os.LookupEnv(key)
	if !exists || strings.TrimSpace(value) == "" {
		return defaultValue
	}
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed < 1 {
		return defaultValue
	}
	return parsed
}

// Update the database hostname for tests
const TestDBHost = "homelab-builder-db"

// Ensure the IPAM_URL is set for tests
const TestIPAMURL = "http://hlbipam:8081"
