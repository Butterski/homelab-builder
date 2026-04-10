package services

import (
	"crypto/rand"
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

func getServiceConfig(name string) ServiceConfig {
	if cfg, ok := serviceImages[name]; ok {
		return cfg
	}
	// Case-insensitive partial match
	for k, v := range serviceImages {
		if strings.Contains(strings.ToLower(name), strings.ToLower(k)) || strings.Contains(strings.ToLower(k), strings.ToLower(name)) {
			return v
		}
	}

	// Fallback
	slug := strings.ReplaceAll(strings.ToLower(name), " ", "-")
	return ServiceConfig{
		Image:   fmt.Sprintf("%s:latest", slug),
		Ports:   []string{"8080:8080"},
		Volumes: []string{fmt.Sprintf("%s_data:/data", slug)},
		Env:     []string{},
	}
}

func randomSecret(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, length)
	rand.Read(b)
	for i := range b {
		b[i] = charset[int(b[i])%len(charset)]
	}
	return string(b)
}

// GenerateDockerCompose generates a Docker Compose YAML string for a build ID
func (s *ConfigService) GenerateDockerCompose(buildID uuid.UUID) (string, error) {
	var build models.Build
	if err := s.db.Preload("Nodes.VirtualMachines").First(&build, "id = ?", buildID).Error; err != nil {
		return "", err
	}

	composeStr := "services:\n"

	hasVMs := false
	allVolumes := make(map[string]bool)
	var subnet string

	for _, node := range build.Nodes {
		// Attempt to extract root subnet from router IP
		if node.Type == "router" && node.IP != "" && subnet == "" {
			parts := strings.Split(node.IP, ".")
			if len(parts) == 4 {
				subnet = fmt.Sprintf("%s.%s.%s.0/24", parts[0], parts[1], parts[2])
			}
		}

		for _, vm := range node.VirtualMachines {
			hasVMs = true
			cfg := getServiceConfig(vm.Name)
			slug := strings.ReplaceAll(strings.ToLower(vm.Name), " ", "_")

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
					composeStr += fmt.Sprintf("      - %s\n", e)
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
		return "services: {}\n", nil
	}

	return composeStr, nil
}

// GenerateEnv generates a .env file string for the given build ID based on VMs requiring passwords/secrets
func (s *ConfigService) GenerateEnv(buildID uuid.UUID) (string, error) {
	var build models.Build
	if err := s.db.Preload("Nodes.VirtualMachines").First(&build, "id = ?", buildID).Error; err != nil {
		return "", err
	}

	envStr := "# Generated by HLBuilder Backend\n"
	envStr += "HOMELAB_DOMAIN=homelab.local\n"
	envStr += "PUID=1000\n"
	envStr += "PGID=1000\n"
	envStr += "TZ=Europe/Warsaw\n\n"

	seen := make(map[string]bool)
	for _, node := range build.Nodes {
		for _, vm := range node.VirtualMachines {
			cfg := getServiceConfig(vm.Name)

			var relevant []string
			for _, e := range cfg.Env {
				if strings.Contains(e, "PASSWORD") || strings.Contains(e, "SECRET") || strings.Contains(e, "TOKEN") || strings.Contains(e, "KEY") {
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
					isSecret := strings.Contains(key, "SECRET") || strings.Contains(key, "TOKEN") || strings.Contains(key, "KEY")
					val := "changeme_" + strings.ToLower(key)
					if isSecret {
						val = randomSecret(32)
					}
					envStr += fmt.Sprintf("%s=%s\n", key, val)
				}
			}
			envStr += "\n"
		}
	}

	return envStr, nil
}

// GenerateAnsibleInventory generates an Ansible inventory string for the hardware nodes
func (s *ConfigService) GenerateAnsibleInventory(buildID uuid.UUID) (string, error) {
	var build models.Build
	if err := s.db.Preload("Nodes.VirtualMachines").First(&build, "id = ?", buildID).Error; err != nil {
		return "", err
	}

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

	return invStr, nil
}

// ConfigBundle wraps all generated strings into a single JSON response
type ConfigBundle struct {
	DockerCompose    string `json:"docker_compose"`
	DotEnv           string `json:"env"`
	AnsibleInventory string `json:"ansible_inventory"`
	Nginx            string `json:"nginx"`
}

// GenerateNginxConfig generates an Nginx reverse proxy configuration string
func (s *ConfigService) GenerateNginxConfig(buildID uuid.UUID) (string, error) {
	// Simple stub for now
	nginxStr := "# Generated by HLBuilder Backend\n\n"
	nginxStr += "server {\n"
	nginxStr += "    listen 80;\n"
	nginxStr += "    server_name example.homelab.local;\n"
	nginxStr += "    location / {\n"
	nginxStr += "        proxy_pass http://127.0.0.1:8080;\n"
	nginxStr += "    }\n}\n"
	return nginxStr, nil
}

// GenerateAll generates all configurations for a build returning a ConfigBundle
func (s *ConfigService) GenerateAll(buildID uuid.UUID) (*ConfigBundle, error) {
	composeStr, err := s.GenerateDockerCompose(buildID)
	if err != nil {
		return nil, err
	}

	envStr, err := s.GenerateEnv(buildID)
	if err != nil {
		return nil, err
	}

	ansibleStr, err := s.GenerateAnsibleInventory(buildID)
	if err != nil {
		return nil, err
	}

	nginxStr, err := s.GenerateNginxConfig(buildID)
	if err != nil {
		return nil, err
	}

	return &ConfigBundle{
		DockerCompose:    composeStr,
		DotEnv:           envStr,
		AnsibleInventory: ansibleStr,
		Nginx:            nginxStr,
	}, nil
}
