package models

import (
	"encoding/json"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/gaming"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type User struct {
	ID          uuid.UUID       `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	GoogleID    string          `gorm:"unique;column:google_id" json:"google_id,omitempty"`
	Email       string          `gorm:"unique;not null" json:"email"`
	Name        string          `gorm:"not null;default:''" json:"name"`
	AvatarURL   string          `gorm:"default:''" json:"avatar_url,omitempty"`
	IsAdmin     bool            `gorm:"default:false" json:"is_admin"`
	Preferences json.RawMessage `gorm:"type:jsonb;default:'{}'" json:"preferences"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
	DeletedAt   gorm.DeletedAt  `gorm:"index" json:"-"`
}

type Service struct {
	ID              uuid.UUID           `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	UserID          *uuid.UUID          `gorm:"type:uuid;index" json:"user_id,omitempty"`
	Name            string              `gorm:"not null" json:"name"`
	Description     string              `gorm:"default:''" json:"description"`
	Category        string              `gorm:"not null;default:'other'" json:"category"`
	Icon            string              `gorm:"default:''" json:"icon"`
	OfficialWebsite string              `gorm:"default:''" json:"official_website,omitempty"`
	DocsURL         string              `gorm:"default:''" json:"docs_url,omitempty"`
	GithubURL       string              `gorm:"default:''" json:"github_url,omitempty"`
	Tags            string              `gorm:"type:jsonb;default:'[]'" json:"tags"`
	DockerSupport   bool                `gorm:"default:true" json:"docker_support"`
	IsActive        bool                `gorm:"default:true" json:"is_active"`
	Visibility      string              `gorm:"not null;default:'public';index" json:"visibility"`
	User            *User               `gorm:"foreignKey:UserID" json:"-"`
	Requirements    *ServiceRequirement `gorm:"foreignKey:ServiceID" json:"requirements,omitempty"`
	Game            *gaming.Profile     `gorm:"-" json:"game,omitempty"` // Transient, set for game servers and gaming tools
	CreatedAt       time.Time           `json:"created_at"`
	UpdatedAt       time.Time           `json:"updated_at"`
}

// AfterFind attaches the game profile to catalog entries that have one. The
// profile lives in code, so it is never stale and never user-supplied.
func (s *Service) AfterFind(*gorm.DB) error {
	if profile, ok := gaming.ProfileByServiceID(s.ID.String()); ok {
		s.Game = &profile
	}
	return nil
}

type ServiceRequirement struct {
	ID                   uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	ServiceID            uuid.UUID `gorm:"type:uuid;unique;not null" json:"service_id"`
	MinRAMMB             int       `gorm:"column:min_ram_mb;not null;default:256" json:"min_ram_mb"`
	RecommendedRAMMB     int       `gorm:"column:recommended_ram_mb;not null;default:512" json:"recommended_ram_mb"`
	MinCPUCores          float32   `gorm:"not null;default:0.5" json:"min_cpu_cores"`
	RecommendedCPUCores  float32   `gorm:"not null;default:1.0" json:"recommended_cpu_cores"`
	MinStorageGB         int       `gorm:"not null;default:1" json:"min_storage_gb"`
	RecommendedStorageGB int       `gorm:"not null;default:5" json:"recommended_storage_gb"`
	CreatedAt            time.Time `json:"created_at"`
}

type UserSelection struct {
	ID        uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null" json:"user_id"`
	ServiceID uuid.UUID `gorm:"type:uuid;not null" json:"service_id"`
	User      *User     `gorm:"foreignKey:UserID" json:"-"`
	Service   *Service  `gorm:"foreignKey:ServiceID" json:"service,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type Event struct {
	ID        uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	UserID    *uuid.UUID `gorm:"type:uuid" json:"user_id,omitempty"`
	EventType string     `gorm:"not null" json:"event_type"`
	Payload   string     `gorm:"type:jsonb;default:'{}'" json:"payload"`
	CreatedAt time.Time  `json:"created_at"`
}

type HardwareComponent struct {
	ID          uuid.UUID       `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	Category    string          `gorm:"not null;index" json:"category"`
	Brand       string          `gorm:"not null;index" json:"brand"`
	Model       string          `gorm:"not null" json:"model"`
	PowerDraw   float64         `gorm:"default:0" json:"power_draw"`
	Spec        json.RawMessage `gorm:"type:jsonb;not null;default:'{}'" json:"spec"`
	PriceEst    float64         `gorm:"default:0" json:"price_est"`
	Currency    string          `gorm:"default:'EUR'" json:"currency"`
	BuyURLs     json.RawMessage `gorm:"type:jsonb;default:'[]'" json:"buy_urls"`
	ImageURL    string          `gorm:"default:''" json:"image_url"`
	SubmittedBy *uuid.UUID      `gorm:"type:uuid" json:"submitted_by,omitempty"`
	Approved    *bool           `gorm:"default:false;index" json:"approved"`
	Likes       int             `gorm:"default:0" json:"likes"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

func (HardwareComponent) TableName() string { return "hardware_components" }

type HardwareBlueprint struct {
	ID               uuid.UUID             `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	UserID           uuid.UUID             `gorm:"type:uuid;not null;index" json:"user_id"`
	Name             string                `gorm:"not null" json:"name"`
	Description      string                `gorm:"type:text;default:''" json:"description"`
	Category         string                `gorm:"not null;index" json:"category"`
	NodeType         string                `gorm:"not null;index" json:"node_type"`
	Visibility       string                `gorm:"not null;default:'private';index" json:"visibility"`
	Tags             json.RawMessage       `gorm:"type:jsonb;not null;default:'[]'" json:"tags"`
	NodeData         json.RawMessage       `gorm:"type:jsonb;not null;default:'{}'" json:"node_data"`
	Services         json.RawMessage       `gorm:"type:jsonb;not null;default:'[]'" json:"services"`
	ShareCode        *string               `gorm:"uniqueIndex" json:"share_code,omitempty"`
	ModerationStatus string                `gorm:"not null;default:'none';index" json:"moderation_status"`
	ModerationNote   string                `gorm:"type:text;default:''" json:"moderation_note"`
	ReviewedBy       *uuid.UUID            `gorm:"type:uuid" json:"reviewed_by,omitempty"`
	ReviewedAt       *time.Time            `json:"reviewed_at,omitempty"`
	Fit              *HardwareBlueprintFit `gorm:"-" json:"fit,omitempty"`
	User             *User                 `gorm:"foreignKey:UserID" json:"-"`
	CreatedAt        time.Time             `json:"created_at"`
	UpdatedAt        time.Time             `json:"updated_at"`
}

func (HardwareBlueprint) TableName() string { return "hardware_blueprints" }

type HardwareBlueprintFit struct {
	Score       int                          `json:"score"`
	Grade       string                       `json:"grade"`
	Label       string                       `json:"label"`
	Summary     string                       `json:"summary"`
	Capacity    HardwareBlueprintFitResource `json:"capacity"`
	Demand      HardwareBlueprintFitResource `json:"demand"`
	Utilization HardwareBlueprintUtilization `json:"utilization"`
	Factors     []HardwareBlueprintFitFactor `json:"factors"`
}

type HardwareBlueprintFitResource struct {
	CPUCores    float64 `json:"cpu_cores"`
	RAMGB       float64 `json:"ram_gb"`
	StorageGB   float64 `json:"storage_gb"`
	PowerW      float64 `json:"power_w"`
	Ports       float64 `json:"ports"`
	NetworkGbps float64 `json:"network_gbps"`
	DriveBays   int     `json:"drive_bays"`
	Disks       int     `json:"disks"`
	GPUs        int     `json:"gpus"`
}

type HardwareBlueprintUtilization struct {
	CPU     float64 `json:"cpu"`
	RAM     float64 `json:"ram"`
	Storage float64 `json:"storage"`
	Ports   float64 `json:"ports"`
	Network float64 `json:"network"`
}

type HardwareBlueprintFitFactor struct {
	Key    string  `json:"key"`
	Label  string  `json:"label"`
	Score  float64 `json:"score"`
	Weight float64 `json:"weight"`
	Note   string  `json:"note"`
}

// Build represents a saved visual builder project
type Build struct {
	ID             uuid.UUID       `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	UserID         uuid.UUID       `gorm:"type:uuid;not null;index" json:"user_id"` // Owner
	Name           string          `gorm:"not null" json:"name"`
	Kind           string          `gorm:"not null;default:'homelab';index" json:"kind"`        // homelab, lan_party, game_server
	GamingPlan     json.RawMessage `gorm:"type:jsonb;not null;default:'{}'" json:"gaming_plan"` // gaming.Plan: uplink, power circuits, event
	Settings       json.RawMessage `gorm:"type:jsonb;default:'{}'" json:"settings"`             // UI state e.g. boughtItems
	Thumbnail      string          `gorm:"default:''" json:"thumbnail"`                         // Base64 or URL
	TotalPower     float64         `gorm:"-" json:"total_power"`                                // Transient, calculated on fetch
	Revision       uint64          `gorm:"not null;default:1" json:"revision"`                  // Optimistic topology version
	ShareToken     *string         `gorm:"uniqueIndex;default:null" json:"share_token,omitempty"`
	IsShared       bool            `gorm:"default:false" json:"is_shared"`
	SharedEditable bool            `gorm:"default:false" json:"shared_editable"`
	User           *User           `gorm:"foreignKey:UserID" json:"-"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`

	// Relations
	Nodes []Node `gorm:"foreignKey:BuildID" json:"nodes,omitempty"`
	Edges []Edge `gorm:"foreignKey:BuildID" json:"edges,omitempty"`
}

func (Build) TableName() string { return "builds" }

// Node represents a hardware node in the graph
type Node struct {
	ID         uuid.UUID       `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	BuildID    uuid.UUID       `gorm:"type:uuid;not null;index" json:"build_id"`
	Type       string          `gorm:"not null" json:"type"` // server, router, switch
	Name       string          `gorm:"not null" json:"name"`
	X          float64         `gorm:"not null;default:0" json:"x"`
	Y          float64         `gorm:"not null;default:0" json:"y"`
	PowerDraw  float64         `gorm:"default:0" json:"power_draw"`
	IP         string          `gorm:"default:''" json:"ip"`
	MacAddress string          `gorm:"default:''" json:"mac_address"`
	Details    json.RawMessage `gorm:"type:jsonb;default:'{}'" json:"details"` // Hardware specs
	ParentID   *uuid.UUID      `gorm:"type:uuid" json:"parent_id,omitempty"`   // For nested components
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`

	ServiceInstances   []ServiceInstance `gorm:"foreignKey:NodeID;constraint:OnDelete:CASCADE;" json:"service_instances,omitempty"`
	VirtualMachines    []VirtualMachine  `gorm:"foreignKey:NodeID;constraint:OnDelete:CASCADE;" json:"virtual_machines,omitempty"`
	InternalComponents []NodeComponent   `gorm:"foreignKey:NodeID;constraint:OnDelete:CASCADE;" json:"internal_components,omitempty"`
}

func (Node) TableName() string { return "nodes" }

// NodeComponent represents an internal hardware piece (e.g. disk, GPU) inside a Node
type NodeComponent struct {
	ID        uuid.UUID       `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	NodeID    uuid.UUID       `gorm:"type:uuid;not null;index" json:"node_id"`
	Type      string          `gorm:"not null" json:"type"` // disk, gpu, hba etc.
	Name      string          `gorm:"not null" json:"name"`
	PowerDraw float64         `gorm:"default:0" json:"power_draw"`
	Details   json.RawMessage `gorm:"type:jsonb;default:'{}'" json:"details"` // Component specs
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

func (NodeComponent) TableName() string { return "node_components" }

// CatalogComponent represents a template/reference for NodeComponent creation
type CatalogComponent struct {
	ID        uuid.UUID       `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	Type      string          `gorm:"not null;index" json:"type"` // disk, gpu, ram, etc.
	Name      string          `gorm:"not null" json:"name"`
	PowerDraw float64         `gorm:"default:0" json:"power_draw"`
	Details   json.RawMessage `gorm:"type:jsonb;default:'{}'" json:"details"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

func (CatalogComponent) TableName() string { return "catalog_components" }

// VirtualMachine represents a nested VM/Container on a node
type VirtualMachine struct {
	ID         uuid.UUID       `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	NodeID     uuid.UUID       `gorm:"type:uuid;not null;index" json:"node_id"`
	Name       string          `gorm:"not null" json:"name"`
	Type       string          `gorm:"not null" json:"type"` // vm, container, lxc
	IP         string          `gorm:"default:''" json:"ip"`
	MacAddress string          `gorm:"default:''" json:"mac_address"`
	OS         string          `gorm:"default:''" json:"os"`
	CPUCores   float64         `gorm:"default:0" json:"cpu_cores"`
	RAMMB      int             `gorm:"default:0" json:"ram_mb"`
	Status     string          `gorm:"default:'stopped'" json:"status"`
	Details    json.RawMessage `gorm:"type:jsonb;default:'{}'" json:"details"`
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`
}

func (VirtualMachine) TableName() string { return "virtual_machines" }

// Edge represents a connection between nodes
type Edge struct {
	ID               uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	BuildID          uuid.UUID `gorm:"type:uuid;not null;index" json:"build_id"`
	SourceNodeID     uuid.UUID `gorm:"type:uuid;not null" json:"source_node_id"`
	SourceHandle     string    `json:"source_handle,omitempty"`
	TargetNodeID     uuid.UUID `gorm:"type:uuid;not null" json:"target_node_id"`
	TargetHandle     string    `json:"target_handle,omitempty"`
	Type             string    `gorm:"default:'ethernet'" json:"type"`
	Speed            string    `gorm:"default:'1 GbE'" json:"speed"`
	Subnet           string    `gorm:"default:''" json:"subnet"`
	WirelessStandard string    `gorm:"default:''" json:"wireless_standard"`
	Direction        string    `gorm:"default:'auto'" json:"direction"`
	CreatedAt        time.Time `json:"created_at"`
}

func (Edge) TableName() string { return "edges" }

// ServiceInstance represents a deployed service on a node (or unassigned in backlog)
type ServiceInstance struct {
	ID               uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	BuildID          uuid.UUID  `gorm:"type:uuid;not null;index" json:"build_id"`
	NodeID           *uuid.UUID `gorm:"type:uuid;index" json:"node_id,omitempty"` // Null if in backlog
	CatalogServiceID uuid.UUID  `gorm:"type:uuid;not null" json:"catalog_service_id"`
	Name             string     `gorm:"not null" json:"name"`
	IP               string     `gorm:"default:''" json:"ip"`
	Port             int        `gorm:"default:0" json:"port"`
	Status           string     `gorm:"default:'stopped'" json:"status"` // running, stopped
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`

	CatalogService *Service `gorm:"foreignKey:CatalogServiceID" json:"catalog_service,omitempty"`
}

func (ServiceInstance) TableName() string { return "service_instances" }

// ─── BETA_SURVEY ──────────────────────────────────────────────────────────────
// BetaSurvey stores one response per user for the open-beta feedback survey.
// Remove this model and migrate away after beta ends.
type BetaSurvey struct {
	ID                 uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	UserID             uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"user_id"` // 1 per user
	Rating             int       `gorm:"default:0" json:"rating"`                       // 1-5
	WillUseApp         string    `gorm:"default:''" json:"will_use_app"`                // yes | no | maybe
	FeatureWishlist    string    `gorm:"type:text;default:''" json:"feature_wishlist"`
	OpenSourceInterest string    `gorm:"default:''" json:"open_source_interest"` // yes | no
	ContributionIntent string    `gorm:"default:''" json:"contribution_intent"`  // contribute | selfhost
	DiscordHandle      string    `gorm:"default:''" json:"discord_handle"`
	HearAboutUs        string    `gorm:"default:''" json:"hear_about_us"`    // reddit | github | friend | other
	ExperienceLevel    string    `gorm:"default:''" json:"experience_level"` // beginner | intermediate | expert
	PrimaryUseCase     string    `gorm:"default:''" json:"primary_use_case"` // homeserver | development | learning | other
	IsCompany          bool      `gorm:"default:false" json:"is_company"`
	CompanyContact     string    `gorm:"type:text;default:''" json:"company_contact"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

func (BetaSurvey) TableName() string { return "beta_surveys" } // BETA_SURVEY
// ─── END BETA_SURVEY ──────────────────────────────────────────────────────────

type UserHardwareFavorite struct {
	ID                  uuid.UUID          `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	UserID              uuid.UUID          `gorm:"type:uuid;not null;uniqueIndex:idx_user_hw_fav" json:"user_id"`
	HardwareComponentID uuid.UUID          `gorm:"type:uuid;not null;uniqueIndex:idx_user_hw_fav" json:"hardware_component_id"`
	User                *User              `gorm:"foreignKey:UserID" json:"-"`
	HardwareComponent   *HardwareComponent `gorm:"foreignKey:HardwareComponentID" json:"hardware_component,omitempty"`
	CreatedAt           time.Time          `json:"created_at"`
}

func (UserHardwareFavorite) TableName() string { return "user_hardware_favorites" }

// APIToken is a personal access token used by MCP clients. Only the SHA-256
// hash of the token is stored; the plaintext is shown once at creation.
type APIToken struct {
	ID         uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	UserID     uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	Name       string     `gorm:"not null" json:"name"`
	Prefix     string     `gorm:"not null" json:"prefix"` // display only, e.g. "hlb_AbCd"
	TokenHash  string     `gorm:"not null;uniqueIndex" json:"-"`
	Scope      string     `gorm:"not null;default:'read'" json:"scope"`      // read | propose
	BuildID    *uuid.UUID `gorm:"type:uuid;index" json:"build_id,omitempty"` // optional single-build restriction
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	LastUsedIP string     `gorm:"default:''" json:"last_used_ip,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`

	User  *User  `gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE" json:"-"`
	Build *Build `gorm:"foreignKey:BuildID;constraint:OnDelete:CASCADE" json:"-"`
}

func (APIToken) TableName() string { return "api_tokens" }

// BuildProposal is a change set an LLM (MCP client or in-app assistant) suggested
// for a build. Nothing is written to the build until its owner applies it.
type BuildProposal struct {
	ID              uuid.UUID       `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	BuildID         uuid.UUID       `gorm:"type:uuid;not null;index" json:"build_id"`
	UserID          uuid.UUID       `gorm:"type:uuid;not null;index" json:"user_id"`
	Source          string          `gorm:"not null" json:"source"` // mcp | chat
	SourceLabel     string          `gorm:"default:''" json:"source_label"`
	TokenID         *uuid.UUID      `gorm:"type:uuid" json:"token_id,omitempty"`
	ThreadID        *uuid.UUID      `gorm:"type:uuid;index" json:"thread_id,omitempty"`
	Summary         string          `gorm:"type:text;default:''" json:"summary"`
	Operations      json.RawMessage `gorm:"type:jsonb;not null;default:'[]'" json:"operations"` // resolved ops
	BaseRevision    uint64          `gorm:"not null;default:0" json:"base_revision"`
	Diff            json.RawMessage `gorm:"type:jsonb;not null;default:'{}'" json:"diff"`
	Preview         json.RawMessage `gorm:"type:jsonb;not null;default:'{}'" json:"preview,omitempty"` // proposed build + validation
	Status          string          `gorm:"not null;default:'pending';index" json:"status"`            // pending | applied | rejected | superseded | conflict
	StatusReason    string          `gorm:"type:text;default:''" json:"status_reason"`
	AppliedRevision *uint64         `json:"applied_revision,omitempty"`
	ResolvedAt      *time.Time      `json:"resolved_at,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`

	Build *Build `gorm:"foreignKey:BuildID;constraint:OnDelete:CASCADE" json:"-"`
	User  *User  `gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE" json:"-"`
}

func (BuildProposal) TableName() string { return "build_proposals" }

// AssistantSettings holds a user's bring-your-own-key assistant configuration.
// The provider key is AES-256-GCM encrypted and never serialized to JSON.
type AssistantSettings struct {
	UserID        uuid.UUID  `gorm:"type:uuid;primaryKey" json:"user_id"`
	Enabled       bool       `gorm:"not null;default:false" json:"enabled"`
	Provider      string     `gorm:"default:''" json:"provider"`
	Model         string     `gorm:"default:''" json:"model"`
	BaseURL       string     `gorm:"default:''" json:"base_url"`
	KeyCiphertext []byte     `gorm:"type:bytea" json:"-"`
	KeyNonce      []byte     `gorm:"type:bytea" json:"-"`
	KeyVersion    int        `gorm:"not null;default:0" json:"-"`
	KeyHint       string     `gorm:"default:''" json:"-"`
	KeyStoredAt   *time.Time `json:"-"`
	KeyLastUsedAt *time.Time `json:"-"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`

	User *User `gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE" json:"-"`
}

func (AssistantSettings) TableName() string { return "assistant_settings" }

// AssistantThread is the single assistant conversation a user has about a build.
type AssistantThread struct {
	ID        uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_assistant_thread_user_build" json:"user_id"`
	BuildID   uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_assistant_thread_user_build" json:"build_id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	User  *User  `gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE" json:"-"`
	Build *Build `gorm:"foreignKey:BuildID;constraint:OnDelete:CASCADE" json:"-"`
}

func (AssistantThread) TableName() string { return "assistant_threads" }

// AssistantMessage is one turn in a thread. Parts is the provider-neutral
// transcript shown in the UI; Native keeps the provider's own response message
// so history can be replayed unchanged to the same provider and model.
type AssistantMessage struct {
	ID          uuid.UUID       `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	ThreadID    uuid.UUID       `gorm:"type:uuid;not null;index" json:"thread_id"`
	Seq         int             `gorm:"not null;default:0" json:"seq"`
	Role        string          `gorm:"not null" json:"role"` // user | assistant | tool
	Provider    string          `gorm:"default:''" json:"provider,omitempty"`
	Model       string          `gorm:"default:''" json:"model,omitempty"`
	Parts       json.RawMessage `gorm:"type:jsonb;not null;default:'[]'" json:"parts"`
	Native      json.RawMessage `gorm:"type:jsonb" json:"-"`
	Interrupted bool            `gorm:"not null;default:false" json:"interrupted"`
	CreatedAt   time.Time       `json:"created_at"`

	Thread *AssistantThread `gorm:"foreignKey:ThreadID;constraint:OnDelete:CASCADE" json:"-"`
}

func (AssistantMessage) TableName() string { return "assistant_messages" }

// InventoryItem is a piece of hardware the user owns: a whole device, a
// component in a drawer, an accessory. It belongs to the account, not to a
// build, so the same device can be planned into several builds. A node placed
// from it carries the item's id in details.inventory_item_id.
type InventoryItem struct {
	ID           uuid.UUID       `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	UserID       uuid.UUID       `gorm:"type:uuid;not null;index" json:"user_id"`
	Kind         string          `gorm:"not null;default:'device';index" json:"kind"` // device | component | accessory
	Type         string          `gorm:"not null" json:"type"`                        // minipc, switch, ram, disk, dac, ...
	Name         string          `gorm:"not null" json:"name"`
	Manufacturer string          `gorm:"default:''" json:"manufacturer"`
	Model        string          `gorm:"default:''" json:"model"`
	Quantity     int             `gorm:"not null;default:1" json:"quantity"`
	Status       string          `gorm:"not null;default:'available';index" json:"status"` // available | in_use | reserved | broken | sold
	Location     string          `gorm:"not null;default:'other'" json:"location"`         // rack | shelf | drawer | storage | other
	Specs        json.RawMessage `gorm:"type:jsonb;not null;default:'{}'" json:"specs"`    // inventory.Specs
	MacAddresses json.RawMessage `gorm:"type:jsonb;not null;default:'[]'" json:"mac_addresses"`
	PowerDraw    float64         `gorm:"default:0" json:"power_draw"`
	Notes        string          `gorm:"type:text;default:''" json:"notes"`
	// Set when the item is the machine behind a host an integration reports
	// (IntegrationRef is the Proxmox node name).
	IntegrationID  *uuid.UUID `gorm:"type:uuid;index" json:"integration_id,omitempty"`
	IntegrationRef string     `gorm:"default:''" json:"integration_ref,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`

	User *User `gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE" json:"-"`
}

func (InventoryItem) TableName() string { return "inventory_items" }

// Integration is a connection to a system that knows what really runs on the
// user's hardware (a Proxmox VE cluster). The API token secret is AES-256-GCM
// encrypted and never serialized to JSON; Snapshot is what was read last.
type Integration struct {
	ID               uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	UserID           uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	Kind             string     `gorm:"not null;default:'proxmox'" json:"kind"`
	Name             string     `gorm:"not null" json:"name"`
	Source           string     `gorm:"not null;default:'api'" json:"source"` // api | paste
	BaseURL          string     `gorm:"default:''" json:"base_url"`
	TokenID          string     `gorm:"default:''" json:"token_id"` // user@realm!tokenname
	SecretCiphertext []byte     `gorm:"type:bytea" json:"-"`
	SecretNonce      []byte     `gorm:"type:bytea" json:"-"`
	SecretVersion    int        `gorm:"not null;default:0" json:"-"`
	SecretStoredAt   *time.Time `json:"-"`
	// TLSFingerprint pins the server certificate (SHA-256, hex) when it is not
	// signed by a public authority, which is the default on a Proxmox host.
	TLSFingerprint string          `gorm:"default:''" json:"tls_fingerprint"`
	Snapshot       json.RawMessage `gorm:"type:jsonb" json:"-"`
	SyncedAt       *time.Time      `json:"synced_at,omitempty"`
	LastError      string          `gorm:"type:text;default:''" json:"last_error"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`

	User *User `gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE" json:"-"`
}

func (Integration) TableName() string { return "integrations" }

// SystemSetting stores instance-level values such as a generated secrets key.
type SystemSetting struct {
	Key       string    `gorm:"primaryKey" json:"key"`
	Value     string    `gorm:"type:text;not null;default:''" json:"-"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (SystemSetting) TableName() string { return "system_settings" }
