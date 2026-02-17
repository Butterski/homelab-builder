package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type User struct {
	ID        uuid.UUID      `gorm:"type:uuid;default:uuid_generate_v4();primaryKey" json:"id"`
	GoogleID  string         `gorm:"uniqueIndex;column:google_id" json:"google_id,omitempty"`
	Email     string         `gorm:"uniqueIndex;not null" json:"email"`
	Name      string         `gorm:"not null;default:''" json:"name"`
	AvatarURL string         `gorm:"default:''" json:"avatar_url,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

type Service struct {
	ID              uuid.UUID           `gorm:"type:uuid;default:uuid_generate_v4();primaryKey" json:"id"`
	Name            string              `gorm:"not null" json:"name"`
	Description     string              `gorm:"default:''" json:"description"`
	Category        string              `gorm:"not null;default:'other'" json:"category"`
	Icon            string              `gorm:"default:''" json:"icon"`
	OfficialWebsite string              `gorm:"default:''" json:"official_website,omitempty"`
	DockerSupport   bool                `gorm:"default:true" json:"docker_support"`
	IsActive        bool                `gorm:"default:true" json:"is_active"`
	Requirements    *ServiceRequirement `gorm:"foreignKey:ServiceID" json:"requirements,omitempty"`
	CreatedAt       time.Time           `json:"created_at"`
	UpdatedAt       time.Time           `json:"updated_at"`
}

type ServiceRequirement struct {
	ID                  uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey" json:"id"`
	ServiceID           uuid.UUID `gorm:"type:uuid;uniqueIndex;not null" json:"service_id"`
	MinRAMMB            int       `gorm:"column:min_ram_mb;not null;default:256" json:"min_ram_mb"`
	RecommendedRAMMB    int       `gorm:"column:recommended_ram_mb;not null;default:512" json:"recommended_ram_mb"`
	MinCPUCores         float32   `gorm:"not null;default:0.5" json:"min_cpu_cores"`
	RecommendedCPUCores float32   `gorm:"not null;default:1.0" json:"recommended_cpu_cores"`
	MinStorageGB        int       `gorm:"not null;default:1" json:"min_storage_gb"`
	RecommendedStorageGB int      `gorm:"not null;default:5" json:"recommended_storage_gb"`
	CreatedAt           time.Time `json:"created_at"`
}

type UserSelection struct {
	ID        uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey" json:"id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null" json:"user_id"`
	ServiceID uuid.UUID `gorm:"type:uuid;not null" json:"service_id"`
	User      *User     `gorm:"foreignKey:UserID" json:"-"`
	Service   *Service  `gorm:"foreignKey:ServiceID" json:"service,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type HardwareRecommendation struct {
	ID                uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey" json:"id"`
	UserID            *uuid.UUID `gorm:"type:uuid" json:"user_id,omitempty"`
	Tier              string    `gorm:"not null;default:'recommended'" json:"tier"`
	TotalRAMMB        int       `gorm:"column:total_ram_mb;not null;default:0" json:"total_ram_mb"`
	TotalCPUCores     float32   `gorm:"not null;default:0" json:"total_cpu_cores"`
	TotalStorageGB    int       `gorm:"not null;default:0" json:"total_storage_gb"`
	CPUSuggestion     string    `gorm:"default:''" json:"cpu_suggestion"`
	RAMSuggestion     string    `gorm:"column:ram_suggestion;default:''" json:"ram_suggestion"`
	StorageSuggestion string    `gorm:"default:''" json:"storage_suggestion"`
	NetworkSuggestion string    `gorm:"default:''" json:"network_suggestion"`
	Rationale         string    `gorm:"default:''" json:"rationale"`
	EstimatedCostMin  int       `gorm:"default:0" json:"estimated_cost_min"`
	EstimatedCostMax  int       `gorm:"default:0" json:"estimated_cost_max"`
	CreatedAt         time.Time `json:"created_at"`
}

type ShoppingList struct {
	ID                 uuid.UUID          `gorm:"type:uuid;default:uuid_generate_v4();primaryKey" json:"id"`
	RecommendationID   uuid.UUID          `gorm:"type:uuid;not null" json:"recommendation_id"`
	UserID             *uuid.UUID         `gorm:"type:uuid" json:"user_id,omitempty"`
	TotalEstimatedCost int                `gorm:"default:0" json:"total_estimated_cost"`
	Items              []ShoppingListItem `gorm:"foreignKey:ShoppingListID" json:"items,omitempty"`
	CreatedAt          time.Time          `json:"created_at"`
}

type ShoppingListItem struct {
	ID             uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey" json:"id"`
	ShoppingListID uuid.UUID `gorm:"type:uuid;not null" json:"shopping_list_id"`
	Name           string    `gorm:"not null" json:"name"`
	Category       string    `gorm:"not null;default:'other'" json:"category"`
	EstimatedPrice int       `gorm:"default:0" json:"estimated_price"`
	Priority       string    `gorm:"default:'essential'" json:"priority"`
	PurchaseLinks  string    `gorm:"type:jsonb;default:'[]'" json:"purchase_links"`
	CreatedAt      time.Time `json:"created_at"`
}
