package config

import (
	"fmt"
	"os"
)

type Config struct {
	ServerPort   string
	DBHost       string
	DBPort       string
	DBUser       string
	DBPassword   string
	DBName       string
	DBSSLMode    string
	DBType       string
	DBFile       string
	AuthDisabled bool
}

func Load() *Config {
	return &Config{
		ServerPort:   getEnv("SERVER_PORT", "8080"),
		DBHost:       getEnv("DB_HOST", "localhost"),
		DBPort:       getEnv("DB_PORT", "5432"),
		DBUser:       getEnv("DB_USER", "homelab"),
		DBPassword:   getEnv("DB_PASSWORD", "homelab_password"),
		DBName:       getEnv("DB_NAME", "homelab_builder"),
		DBSSLMode:    getEnv("DB_SSLMODE", "disable"),
		DBType:       getEnv("DB_TYPE", "sqlite"), // Default to sqlite
		DBFile:       getEnv("DB_FILE", "homelab.db"),
		AuthDisabled: getEnv("GOOGLE_CLIENT_ID", "") == "", // Disable auth if no Google client ID
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
