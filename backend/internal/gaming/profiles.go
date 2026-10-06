package gaming

// Profile is everything the planner knows about one game server or gaming
// tool. It is the single source for the service catalog entry, the sizing, the
// port-forward table and the generated compose file.
type Profile struct {
	Slug      string `json:"slug"`
	ServiceID string `json:"service_id"`
	Name      string `json:"name"`
	// Role is "game" for a server players join, "tool" for panels, caches and voice.
	Role string `json:"role"`

	Description string   `json:"description"`
	Icon        string   `json:"icon"`
	Website     string   `json:"website"`
	Docs        string   `json:"docs"`
	Tags        []string `json:"tags"`

	// DefaultPlayers is the group size planned for when the owner gives none.
	// MaxPlayers is the largest group the estimate covers.
	DefaultPlayers int `json:"default_players"`
	MaxPlayers     int `json:"max_players"`

	// Sizing: a fixed part plus a part per connected player. These are planning
	// estimates, not publisher guarantees.
	BaseRAMMB         int     `json:"base_ram_mb"`
	RAMMBPerPlayer    int     `json:"ram_mb_per_player"`
	BaseCPUCores      float64 `json:"base_cpu_cores"`
	CPUCoresPerPlayer float64 `json:"cpu_cores_per_player"`
	StorageGB         int     `json:"storage_gb"`
	// UploadKbpsPerPlayer is what the server sends to one remote player.
	UploadKbpsPerPlayer int `json:"upload_kbps_per_player"`
	// SingleThread marks servers whose tick runs on one core: clock speed matters
	// more than core count.
	SingleThread bool `json:"single_thread"`

	Ports []PortSpec `json:"ports"`

	// Image is empty when no container image is recommended.
	Image string `json:"image"`
	// Env holds KEY=VALUE lines for the container. ${NAME} is a value the owner
	// fills in; {players} and {ram_mb} are replaced from the plan.
	Env     []string `json:"env"`
	Volumes []string `json:"volumes"`
	Notes   string   `json:"notes"`
}

// PortSpec is one listening port of a server.
type PortSpec struct {
	Name  string `json:"name"`
	Port  int    `json:"port"`
	Proto string `json:"proto"` // tcp | udp
	// Forward is true when a player outside the LAN needs this port to join.
	Forward bool `json:"forward"`
	// Env names the container variable that sets this port. It is filled in for
	// servers that announce their own port to players or a server list, where
	// the port inside the container must equal the one players connect to.
	Env string `json:"env,omitempty"`
}

// AnnouncesPorts reports whether the server tells clients which port to use.
// Such a server cannot be moved by remapping the port on the host alone.
func (p Profile) AnnouncesPorts() bool {
	for _, spec := range p.Ports {
		if spec.Env != "" {
			return true
		}
	}
	return false
}

const (
	RoleGame = "game"
	RoleTool = "tool"
)

var (
	bySlug      = map[string]*Profile{}
	byServiceID = map[string]*Profile{}
)

func init() {
	for i := range registry {
		profile := &registry[i]
		bySlug[profile.Slug] = profile
		byServiceID[profile.ServiceID] = profile
	}
}

// Profiles returns every profile, games first, in catalog order.
func Profiles() []Profile {
	return append([]Profile(nil), registry...)
}

// ProfileBySlug finds a profile by its slug, e.g. "valheim".
func ProfileBySlug(slug string) (Profile, bool) {
	profile, ok := bySlug[slug]
	if !ok {
		return Profile{}, false
	}
	return *profile, true
}

// ProfileByServiceID finds the profile behind a service catalog entry.
func ProfileByServiceID(serviceID string) (Profile, bool) {
	profile, ok := byServiceID[serviceID]
	if !ok {
		return Profile{}, false
	}
	return *profile, true
}
