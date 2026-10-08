package services

import (
	"fmt"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ConfigService struct {
	db *gorm.DB
}

func NewConfigService(db *gorm.DB) *ConfigService {
	return &ConfigService{db: db}
}

type ServiceConfig struct {
	Image   string
	Ports   []string
	Volumes []string
	Env     []string
}

// Hardcoded library mirroring the frontend typescript map
var serviceImages = map[string]ServiceConfig{
	"Plex":                {Image: "plexinc/pms-docker:latest", Ports: []string{"32400:32400"}, Volumes: []string{"plex_config:/config", "plex_media:/media"}, Env: []string{"PLEX_CLAIM="}},
	"Jellyfin":            {Image: "jellyfin/jellyfin:latest", Ports: []string{"8096:8096"}, Volumes: []string{"jellyfin_config:/config", "jellyfin_media:/media"}, Env: []string{}},
	"Sonarr":              {Image: "linuxserver/sonarr:latest", Ports: []string{"8989:8989"}, Volumes: []string{"sonarr_config:/config", "media:/tv"}, Env: []string{"PUID=1000", "PGID=1000"}},
	"Radarr":              {Image: "linuxserver/radarr:latest", Ports: []string{"7878:7878"}, Volumes: []string{"radarr_config:/config", "media:/movies"}, Env: []string{"PUID=1000", "PGID=1000"}},
	"Prowlarr":            {Image: "linuxserver/prowlarr:latest", Ports: []string{"9696:9696"}, Volumes: []string{"prowlarr_config:/config"}, Env: []string{"PUID=1000", "PGID=1000"}},
	"qBittorrent":         {Image: "linuxserver/qbittorrent:latest", Ports: []string{"8080:8080", "6881:6881"}, Volumes: []string{"qbt_config:/config", "downloads:/downloads"}, Env: []string{"PUID=1000", "PGID=1000"}},
	"Portainer":           {Image: "portainer/portainer-ce:latest", Ports: []string{"9000:9000", "9443:9443"}, Volumes: []string{"/var/run/docker.sock:/var/run/docker.sock", "portainer_data:/data"}, Env: []string{}},
	"Nginx Proxy Manager": {Image: "jc21/nginx-proxy-manager:latest", Ports: []string{"80:80", "443:443", "81:81"}, Volumes: []string{"npm_data:/data", "npm_letsencrypt:/etc/letsencrypt"}, Env: []string{}},
	"Traefik":             {Image: "traefik:v3.0", Ports: []string{"80:80", "443:443", "8080:8080"}, Volumes: []string{"/var/run/docker.sock:/var/run/docker.sock", "traefik_certs:/certs"}, Env: []string{}},
	"Grafana":             {Image: "grafana/grafana:latest", Ports: []string{"3000:3000"}, Volumes: []string{"grafana_data:/var/lib/grafana"}, Env: []string{"GF_SECURITY_ADMIN_PASSWORD=changeme"}},
	"Prometheus":          {Image: "prom/prometheus:latest", Ports: []string{"9090:9090"}, Volumes: []string{"prometheus_data:/prometheus", "./prometheus.yml:/etc/prometheus/prometheus.yml:ro"}, Env: []string{}},
	"Home Assistant":      {Image: "ghcr.io/home-assistant/home-assistant:stable", Ports: []string{"8123:8123"}, Volumes: []string{"ha_config:/config"}, Env: []string{}},
	"Nextcloud":           {Image: "nextcloud:latest", Ports: []string{"8080:80"}, Volumes: []string{"nextcloud_data:/var/www/html"}, Env: []string{"MYSQL_HOST=db", "MYSQL_DATABASE=nextcloud", "MYSQL_USER=nextcloud", "MYSQL_PASSWORD=changeme"}},
	"Vaultwarden":         {Image: "vaultwarden/server:latest", Ports: []string{"8080:80"}, Volumes: []string{"vaultwarden_data:/data"}, Env: []string{"ADMIN_TOKEN=changeme"}},
	"Gitea":               {Image: "gitea/gitea:latest", Ports: []string{"3000:3000", "2222:22"}, Volumes: []string{"gitea_data:/data"}, Env: []string{}},
	"Pi-hole":             {Image: "pihole/pihole:latest", Ports: []string{"53:53/tcp", "53:53/udp", "80:80"}, Volumes: []string{"pihole_etc:/etc/pihole", "pihole_dnsmasq:/etc/dnsmasq.d"}, Env: []string{"WEBPASSWORD=changeme"}},
	"AdGuard Home":        {Image: "adguard/adguardhome:latest", Ports: []string{"53:53/tcp", "53:53/udp", "3000:3000", "80:80"}, Volumes: []string{"adguard_work:/opt/adguardhome/work", "adguard_conf:/opt/adguardhome/conf"}, Env: []string{}},
	"Uptime Kuma":         {Image: "louislam/uptime-kuma:latest", Ports: []string{"3001:3001"}, Volumes: []string{"uptime_kuma_data:/app/data"}, Env: []string{}},
	"Immich":              {Image: "ghcr.io/immich-app/immich-server:release", Ports: []string{"2283:3001"}, Volumes: []string{"immich_upload:/usr/src/app/upload"}, Env: []string{"DB_PASSWORD=changeme", "REDIS_HOSTNAME=redis"}},
	"Paperless-ngx":       {Image: "ghcr.io/paperless-ngx/paperless-ngx:latest", Ports: []string{"8000:8000"}, Volumes: []string{"paperless_data:/usr/src/paperless/data", "paperless_media:/usr/src/paperless/media"}, Env: []string{"PAPERLESS_SECRET_KEY=changeme"}},
}

func getServiceConfig(name string) (ServiceConfig, bool) {
	name = strings.TrimSpace(name)
	if name == "" {
		return ServiceConfig{}, false
	}
	for knownName, cfg := range serviceImages {
		if strings.EqualFold(name, knownName) {
			return cfg, true
		}
	}
	return ServiceConfig{}, false
}

func envEntryKey(entry string) string {
	return strings.TrimSpace(strings.SplitN(entry, "=", 2)[0])
}

func isSecretEnvKey(key string) bool {
	upper := strings.ToUpper(key)
	for _, marker := range []string{"PASSWORD", "SECRET", "TOKEN", "KEY", "CLAIM"} {
		if strings.Contains(upper, marker) {
			return true
		}
	}
	return false
}

func renderComposeEnvEntry(entry string) string {
	key := envEntryKey(entry)
	if isSecretEnvKey(key) {
		return fmt.Sprintf("%s=${%s}", key, key)
	}
	return entry
}

func mappedContainerPort(mapping string) string {
	withoutProtocol := strings.SplitN(mapping, "/", 2)[0]
	parts := strings.Split(withoutProtocol, ":")
	return parts[len(parts)-1]
}

// dockerCompose renders a Docker Compose YAML string for a build loaded with Nodes.VirtualMachines.
func dockerCompose(build *models.Build) string {
	composeStr := "services:\n"

	hasVMs := false
	allVolumes := make(map[string]bool)
	var subnet string

	usedServices := make(map[string]int)

	for _, node := range build.Nodes {
		// Attempt to extract root subnet from router IP
		if node.Type == "router" && node.IP != "" && subnet == "" {
			parts := strings.Split(node.IP, ".")
			if len(parts) == 4 {
				subnet = fmt.Sprintf("%s.%s.%s.0/24", parts[0], parts[1], parts[2])
			}
		}

		for _, vm := range node.VirtualMachines {
			if isGameGuest(vm) {
				composeStr += fmt.Sprintf("  # %s is a game server: see the game server files for %s.\n", vm.Name, node.Name)
				continue
			}
			if vm.Type != "container" && vm.Type != "lxc" {
				composeStr += fmt.Sprintf("  # Skipped %s: it is a VM, not a container image.\n", vm.Name)
				continue
			}
			cfg, known := getServiceConfig(vm.Name)
			if !known {
				composeStr += fmt.Sprintf("  # Skipped %s: no verified container image metadata is available.\n", vm.Name)
				continue
			}
			hasVMs = true
			slug := strings.ReplaceAll(strings.ToLower(vm.Name), " ", "_")

			if count, exists := usedServices[slug]; exists {
				usedServices[slug] = count + 1
				slug = fmt.Sprintf("%s_%d", slug, count+1)
			} else {
				usedServices[slug] = 1
			}

			composeStr += fmt.Sprintf("  %s:\n", slug)
			composeStr += fmt.Sprintf("    image: %s\n", cfg.Image)
			composeStr += fmt.Sprintf("    container_name: %s\n", slug)
			composeStr += "    restart: unless-stopped\n"

			if len(cfg.Ports) > 0 {
				composeStr += "    ports:\n"
				for _, p := range cfg.Ports {
					composeStr += fmt.Sprintf("      - \"%s\"\n", p)
				}
			}

			if len(cfg.Volumes) > 0 {
				composeStr += "    volumes:\n"
				for _, v := range cfg.Volumes {
					composeStr += fmt.Sprintf("      - %s\n", v)
					name := strings.SplitN(v, ":", 2)[0]
					if !strings.HasPrefix(name, "/") && !strings.HasPrefix(name, ".") {
						allVolumes[name] = true
					}
				}
			}

			if len(cfg.Env) > 0 {
				composeStr += "    environment:\n"
				for _, e := range cfg.Env {
					composeStr += fmt.Sprintf("      - %s\n", renderComposeEnvEntry(e))
				}
			}

			// If it has an IP assigned
			if vm.IP != "" {
				composeStr += "    networks:\n"
				composeStr += "      homelab_net:\n"
				composeStr += fmt.Sprintf("        ipv4_address: %s\n", vm.IP)
				if vm.MacAddress != "" {
					composeStr += fmt.Sprintf("    mac_address: %s\n", vm.MacAddress)
				}

				if subnet == "" {
					parts := strings.Split(vm.IP, ".")
					if len(parts) == 4 {
						subnet = fmt.Sprintf("%s.%s.%s.0/24", parts[0], parts[1], parts[2])
					}
				}
			} else {
				composeStr += "    networks:\n"
				composeStr += "      - homelab_net\n"
			}
			composeStr += "\n"
		}
	}

	if len(allVolumes) > 0 {
		composeStr += "volumes:\n"
		for vol := range allVolumes {
			composeStr += fmt.Sprintf("  %s:\n", vol)
		}
		composeStr += "\n"
	}

	if hasVMs {
		if subnet == "" {
			subnet = "192.168.1.0/24" // final fallback
		}
		composeStr += "networks:\n"
		composeStr += "  homelab_net:\n"
		composeStr += "    driver: bridge\n"
		composeStr += "    ipam:\n"
		composeStr += "      config:\n"
		composeStr += fmt.Sprintf("        - subnet: %s\n", subnet)
	}

	if !hasVMs {
		return "services: {}\n"
	}

	return composeStr
}

// dotEnv renders a .env file for the guests of a build that need passwords/secrets.
func dotEnv(build *models.Build) string {
	envStr := "# Generated by HLBuilder Backend\n"
	envStr += "HOMELAB_DOMAIN=CHANGE_ME_DOMAIN\n"
	envStr += "PUID=1000\n"
	envStr += "PGID=1000\n"
	envStr += "TZ=Europe/Warsaw\n\n"

	seen := make(map[string]bool)
	for _, node := range build.Nodes {
		for _, vm := range node.VirtualMachines {
			cfg, known := getServiceConfig(vm.Name)
			if !known {
				continue
			}

			var relevant []string
			for _, e := range cfg.Env {
				if isSecretEnvKey(envEntryKey(e)) {
					relevant = append(relevant, e)
				}
			}

			if len(relevant) == 0 {
				continue
			}

			envStr += fmt.Sprintf("# ── %s ──────────────────────────────────────────────────────────\n", vm.Name)
			for _, e := range relevant {
				parts := strings.SplitN(e, "=", 2)
				key := parts[0]
				if !seen[key] {
					seen[key] = true
					val := "CHANGE_ME_" + strings.ToUpper(key)
					envStr += fmt.Sprintf("%s=%s\n", key, val)
				}
			}
			envStr += "\n"
		}
	}

	return envStr
}

// ansibleInventory renders an Ansible inventory for the hardware nodes and guests of a build.
func ansibleInventory(build *models.Build) string {
	invStr := "[homelab]\n"
	for _, node := range build.Nodes {
		if node.IP != "" {
			macStr := ""
			if node.MacAddress != "" {
				macStr = fmt.Sprintf(" mac_address=%s", node.MacAddress)
			}
			invStr += fmt.Sprintf("node_%s ansible_host=%s ansible_user=ubuntu%s\n", node.ID.String()[:8], node.IP, macStr)
		}
		for _, vm := range node.VirtualMachines {
			if vm.IP != "" {
				macStr := ""
				if vm.MacAddress != "" {
					macStr = fmt.Sprintf(" mac_address=%s", vm.MacAddress)
				}
				invStr += fmt.Sprintf("%s ansible_host=%s ansible_user=ubuntu%s\n", vm.Name, vm.IP, macStr)
			}
		}
	}

	return invStr
}

// ConfigBundle wraps all generated strings into a single JSON response
type ConfigBundle struct {
	DockerCompose    string `json:"docker_compose"`
	DotEnv           string `json:"env"`
	AnsibleInventory string `json:"ansible_inventory"`
	Nginx            string `json:"nginx"`
	// GameCompose holds one compose file per host that runs game servers.
	GameCompose []GameComposeFile `json:"game_compose"`
}

// nginxConfig renders an Nginx reverse proxy configuration for a build.
func nginxConfig(build *models.Build) string {
	var output strings.Builder
	output.WriteString("# Generated from services with known ports and assigned IPs only.\n\n")
	generated := 0
	for _, node := range build.Nodes {
		for _, vm := range node.VirtualMachines {
			cfg, known := getServiceConfig(vm.Name)
			if !known || vm.IP == "" || len(cfg.Ports) == 0 {
				continue
			}
			servicePort := mappedContainerPort(cfg.Ports[0])
			slug := strings.Trim(strings.Map(func(r rune) rune {
				if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
					return r
				}
				if r >= 'A' && r <= 'Z' {
					return r + ('a' - 'A')
				}
				return '-'
			}, vm.Name), "-")
			output.WriteString(fmt.Sprintf(`server {
    listen 80;
    server_name CHANGE_ME_%s_DOMAIN;
    location / {
        proxy_pass http://%s:%s;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}

`, slug, vm.IP, servicePort))
			generated++
		}
	}
	if generated == 0 {
		output.WriteString("# No proxy entries were generated: add an IP and a catalog-backed container service first.\n")
	}
	return output.String()
}

// GenerateAll generates all configurations for a build the user owns.
func (s *ConfigService) GenerateAll(buildID uuid.UUID, userID uuid.UUID) (*ConfigBundle, error) {
	var build models.Build
	if err := s.db.Preload("Nodes.VirtualMachines").First(&build, "id = ?", buildID).Error; err != nil {
		return nil, err
	}
	if build.UserID != userID {
		return nil, fmt.Errorf("unauthorized to access this build config")
	}
	return configBundle(&build), nil
}

func configBundle(build *models.Build) *ConfigBundle {
	return &ConfigBundle{
		DockerCompose:    dockerCompose(build),
		DotEnv:           dotEnv(build),
		AnsibleInventory: ansibleInventory(build),
		Nginx:            nginxConfig(build),
		GameCompose:      GameComposeFiles(build),
	}
}
