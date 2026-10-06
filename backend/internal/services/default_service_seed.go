package services

import (
	"encoding/json"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/gaming"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type defaultServiceSeed struct {
	ID          string
	Name        string
	Description string
	Category    string
	Icon        string
	Website     string
	Docs        string
	Github      string
	Tags        string
	MinRAM      int
	RecRAM      int
	MinCPU      float32
	RecCPU      float32
	MinStorage  int
	RecStorage  int
}

// gamingServiceSeeds derives the catalog entries for game servers and gaming
// tools from the profile registry, so the catalog cannot drift from the sizing.
// The minimum is sized for half the usual group, the recommendation for all of it.
func gamingServiceSeeds() []defaultServiceSeed {
	profiles := gaming.Profiles()
	seeds := make([]defaultServiceSeed, 0, len(profiles))
	for _, profile := range profiles {
		usual := profile.PlayersOrDefault(0)
		small := gaming.SizeServer(profile, (usual+1)/2)
		full := gaming.SizeServer(profile, usual)
		tags, _ := json.Marshal(profile.Tags)
		github := ""
		if strings.HasPrefix(profile.Docs, "https://github.com/") {
			github = profile.Docs
		}
		seeds = append(seeds, defaultServiceSeed{
			ID: profile.ServiceID, Name: profile.Name, Description: profile.Description,
			Category: "gaming", Icon: profile.Icon, Website: profile.Website, Docs: profile.Docs, Github: github,
			Tags:   string(tags),
			MinRAM: small.RAMMB, RecRAM: full.RAMMB,
			MinCPU: float32(small.CPUCores), RecCPU: float32(full.CPUCores),
			MinStorage: profile.StorageGB, RecStorage: profile.StorageGB * 2,
		})
	}
	return seeds
}

func SeedExpandedDefaultServices(db *gorm.DB) error {
	seeds := []defaultServiceSeed{
		{"a1000000-0000-0000-0000-000000000001", "Plex", "Stream your personal media collection to any device. Supports transcoding for remote access.", "media", "plex", "https://www.plex.tv", "https://support.plex.tv", "", `["transcoding","media","streaming"]`, 1024, 4096, 1, 4, 10, 50},
		{"a1000000-0000-0000-0000-000000000002", "Jellyfin", "Free open-source media server. Browse and stream your media without any subscription.", "media", "jellyfin", "https://jellyfin.org", "https://jellyfin.org/docs/", "https://github.com/jellyfin/jellyfin", `["open-source","media","streaming"]`, 512, 2048, 1, 2, 10, 30},
		{"a1000000-0000-0000-0000-000000000003", "Home Assistant", "Open-source home automation platform. Control all your smart home devices from one place.", "home_automation", "home-assistant", "https://www.home-assistant.io", "https://www.home-assistant.io/docs/", "https://github.com/home-assistant/core", `["automation","smarthome"]`, 512, 2048, 1, 2, 10, 32},
		{"a1000000-0000-0000-0000-000000000004", "Pi-hole", "Network-wide ad blocking. Blocks ads and trackers at the DNS level for all devices.", "networking", "pi-hole", "https://pi-hole.net", "https://docs.pi-hole.net", "https://github.com/pi-hole", `["dns","ad-blocker","privacy"]`, 128, 256, 0.5, 1, 2, 5},
		{"a1000000-0000-0000-0000-000000000005", "Traefik", "Modern reverse proxy and load balancer. Auto-discovers services and handles SSL.", "networking", "traefik", "https://traefik.io", "https://doc.traefik.io/traefik/", "https://github.com/traefik/traefik", `["proxy","ssl","load-balancer"]`, 128, 256, 0.5, 1, 1, 2},
		{"a1000000-0000-0000-0000-000000000006", "Nextcloud", "Self-hosted cloud storage and collaboration platform. Your own Google Drive alternative.", "storage", "nextcloud", "https://nextcloud.com", "https://docs.nextcloud.com", "https://github.com/nextcloud/server", `["cloud","files","sync"]`, 1024, 4096, 1, 2, 20, 100},
		{"a1000000-0000-0000-0000-000000000007", "Portainer", "Web-based Docker management UI. Easily manage containers, images, and networks.", "management", "portainer", "https://www.portainer.io", "https://docs.portainer.io", "https://github.com/portainer/portainer", `["docker","gui","management"]`, 256, 512, 0.5, 1, 2, 5},
		{"a1000000-0000-0000-0000-000000000008", "AdGuard Home", "Network-wide ad and tracker blocking with DNS-over-HTTPS support.", "networking", "adguard", "https://adguard.com/adguard-home.html", "https://github.com/AdguardTeam/AdGuardHome/wiki", "https://github.com/AdguardTeam/AdGuardHome", `["dns","ad-blocker","privacy"]`, 128, 256, 0.5, 1, 2, 5},
		{"a1000000-0000-0000-0000-000000000009", "Grafana", "Beautiful dashboards for monitoring. Visualize metrics from Prometheus, InfluxDB, and more.", "monitoring", "grafana", "https://grafana.com", "https://grafana.com/docs/", "https://github.com/grafana/grafana", `["monitoring","dashboards","metrics"]`, 256, 512, 0.5, 1, 2, 10},
		{"a1000000-0000-0000-0000-000000000010", "Uptime Kuma", "Self-hosted monitoring tool. Track uptime of your services with beautiful status pages.", "monitoring", "uptime-kuma", "https://github.com/louislam/uptime-kuma", "https://github.com/louislam/uptime-kuma/wiki", "https://github.com/louislam/uptime-kuma", `["uptime","monitoring","status"]`, 128, 256, 0.5, 1, 1, 3},
		{"a1000000-0000-0000-0000-000000000012", "Nginx Proxy Manager", "Easy-to-use reverse proxy with a web UI. Manage SSL certificates and proxy hosts visually.", "networking", "nginx", "https://nginxproxymanager.com", "https://nginxproxymanager.com/guide/", "https://github.com/NginxProxyManager/nginx-proxy-manager", `["proxy","nginx","ssl"]`, 128, 256, 0.5, 1, 1, 2},
		{"a1000000-0000-0000-0000-000000000013", "Prometheus", "Time-series monitoring and alerting. Collect metrics from your infrastructure and services.", "monitoring", "prometheus", "https://prometheus.io", "https://prometheus.io/docs/introduction/overview/", "https://github.com/prometheus/prometheus", `["metrics","monitoring","time-series"]`, 512, 2048, 1, 2, 10, 50},
		{"a1000000-0000-0000-0000-000000000014", "Vaultwarden", "Self-hosted password manager compatible with Bitwarden clients. Lightweight and secure.", "management", "bitwarden", "https://github.com/dani-garcia/vaultwarden", "https://github.com/dani-garcia/vaultwarden/wiki", "https://github.com/dani-garcia/vaultwarden", `["passwords","security","bitwarden"]`, 64, 256, 0.5, 1, 1, 3},
		{"a1000000-0000-0000-0000-000000000015", "Immich", "Self-hosted photo and video backup. Google Photos alternative with AI-powered features.", "media", "immich", "https://immich.app", "https://immich.app/docs/overview/quick-start", "https://github.com/immich-app/immich", `["photos","backup","ai"]`, 2048, 6144, 2, 4, 20, 100},
		{"a1000000-0000-0000-0000-000000000016", "WireGuard Easy", "Simple WireGuard VPN manager with a web UI for peers, QR codes, and tunnel configuration.", "networking", "wireguard", "https://github.com/wg-easy/wg-easy", "https://github.com/wg-easy/wg-easy", "https://github.com/wg-easy/wg-easy", `["vpn","wireguard","remote-access"]`, 128, 256, 0.5, 1, 1, 2},
		{"a1000000-0000-0000-0000-000000000017", "Homepage", "Fast self-hosted dashboard for services, widgets, bookmarks, and infrastructure links.", "management", "homepage", "https://gethomepage.dev", "https://gethomepage.dev/latest/", "https://github.com/gethomepage/homepage", `["dashboard","bookmarks","widgets"]`, 128, 256, 0.5, 1, 1, 2},
		{"a1000000-0000-0000-0000-000000000018", "Paperless-ngx", "Document management with OCR, tagging, search, and archival workflows for scanned paperwork.", "management", "paperless", "https://docs.paperless-ngx.com", "https://docs.paperless-ngx.com", "https://github.com/paperless-ngx/paperless-ngx", `["documents","ocr","archive"]`, 1024, 2048, 1, 2, 10, 50},
		{"a1000000-0000-0000-0000-000000000019", "Gitea", "Lightweight self-hosted Git service with repositories, issues, pull requests, and packages.", "management", "gitea", "https://gitea.io", "https://docs.gitea.com", "https://github.com/go-gitea/gitea", `["git","code","ci"]`, 512, 1024, 1, 2, 5, 20},
		{"a1000000-0000-0000-0000-000000000020", "Syncthing", "Continuous peer-to-peer file synchronization between desktops, servers, and mobile devices.", "storage", "syncthing", "https://syncthing.net", "https://docs.syncthing.net", "https://github.com/syncthing/syncthing", `["sync","files","p2p"]`, 128, 512, 0.5, 1, 1, 10},
		{"a1000000-0000-0000-0000-000000000021", "MinIO", "S3-compatible object storage for backups, media pipelines, and application data.", "storage", "minio", "https://min.io", "https://min.io/docs/minio/container/index.html", "https://github.com/minio/minio", `["s3","object-storage","backup"]`, 512, 2048, 1, 2, 10, 100},
		{"a1000000-0000-0000-0000-000000000022", "qBittorrent", "Web-managed BitTorrent client commonly used in media automation stacks.", "media", "qbittorrent", "https://www.qbittorrent.org", "https://github.com/qbittorrent/qBittorrent/wiki", "https://github.com/qbittorrent/qBittorrent", `["torrent","downloads","media"]`, 256, 512, 0.5, 1, 5, 20},
		{"a1000000-0000-0000-0000-000000000023", "Sonarr", "TV library automation for monitoring releases, grabbing episodes, and organizing media files.", "media", "sonarr", "https://sonarr.tv", "https://wiki.servarr.com/sonarr", "https://github.com/Sonarr/Sonarr", `["media","automation","tv"]`, 256, 512, 0.5, 1, 1, 5},
		{"a1000000-0000-0000-0000-000000000024", "Radarr", "Movie library automation for monitoring releases, grabbing movies, and organizing media files.", "media", "radarr", "https://radarr.video", "https://wiki.servarr.com/radarr", "https://github.com/Radarr/Radarr", `["media","automation","movies"]`, 256, 512, 0.5, 1, 1, 5},
		{"a1000000-0000-0000-0000-000000000025", "Frigate", "Network video recorder with real-time object detection for security cameras.", "home_automation", "frigate", "https://frigate.video", "https://docs.frigate.video", "https://github.com/blakeblackshear/frigate", `["nvr","cameras","object-detection"]`, 2048, 4096, 2, 4, 20, 200},
		{"a1000000-0000-0000-0000-000000000026", "Mosquitto", "Lightweight MQTT broker for IoT devices, sensors, and home automation messaging.", "home_automation", "mqtt", "https://mosquitto.org", "https://mosquitto.org/documentation/", "https://github.com/eclipse/mosquitto", `["mqtt","iot","broker"]`, 64, 128, 0.25, 0.5, 1, 2},
		{"a1000000-0000-0000-0000-000000000027", "Node-RED", "Flow-based automation tool for wiring devices, APIs, schedules, and smart home logic.", "home_automation", "node-red", "https://nodered.org", "https://nodered.org/docs/", "https://github.com/node-red/node-red", `["automation","flows","iot"]`, 256, 512, 0.5, 1, 1, 5},
		{"a1000000-0000-0000-0000-000000000028", "Authentik", "Identity provider for SSO, OAuth, SAML, forward auth, and homelab access control.", "management", "authentik", "https://goauthentik.io", "https://docs.goauthentik.io", "https://github.com/goauthentik/authentik", `["sso","identity","security"]`, 1024, 2048, 1, 2, 5, 20},
		{"a1000000-0000-0000-0000-000000000029", "Netdata", "Real-time infrastructure monitoring with host metrics, alerts, dashboards, and collectors.", "monitoring", "netdata", "https://www.netdata.cloud", "https://learn.netdata.cloud/docs/", "https://github.com/netdata/netdata", `["monitoring","metrics","alerts"]`, 256, 512, 0.5, 1, 1, 5},
		{"a1000000-0000-0000-0000-000000000030", "Loki", "Log aggregation system designed to pair with Grafana for searchable homelab logs.", "monitoring", "loki", "https://grafana.com/oss/loki/", "https://grafana.com/docs/loki/latest/", "https://github.com/grafana/loki", `["logs","grafana","observability"]`, 512, 1024, 1, 2, 10, 50},
		{"a1000000-0000-0000-0000-000000000031", "Mealie", "Recipe manager and meal planner with shopping lists, imports, and household organization.", "management", "mealie", "https://mealie.io", "https://docs.mealie.io", "https://github.com/mealie-recipes/mealie", `["recipes","planning","household"]`, 512, 1024, 1, 2, 2, 10},
		{"a1000000-0000-0000-0000-000000000032", "BookStack", "Simple wiki and documentation platform for runbooks, notes, and household knowledge bases.", "management", "bookstack", "https://www.bookstackapp.com", "https://www.bookstackapp.com/docs/", "https://github.com/BookStackApp/BookStack", `["wiki","docs","knowledge-base"]`, 512, 1024, 1, 2, 2, 10},
		{"a1000000-0000-0000-0000-000000000033", "Open WebUI", "Self-hosted AI chat interface for local and remote language model backends.", "management", "open-webui", "https://openwebui.com", "https://docs.openwebui.com", "https://github.com/open-webui/open-webui", `["ai","llm","chat"]`, 1024, 2048, 1, 2, 5, 20},
		{"a1000000-0000-0000-0000-000000000034", "Ollama", "Local model runtime for serving LLMs on CPU or GPU-backed homelab hardware.", "management", "ollama", "https://ollama.com", "https://github.com/ollama/ollama/tree/main/docs", "https://github.com/ollama/ollama", `["ai","llm","gpu"]`, 4096, 16384, 2, 8, 20, 200},
	}

	seeds = append(seeds, gamingServiceSeeds()...)

	for _, seed := range seeds {
		id := uuid.MustParse(seed.ID)
		service := models.Service{
			ID:              id,
			Name:            seed.Name,
			Description:     seed.Description,
			Category:        seed.Category,
			Icon:            seed.Icon,
			OfficialWebsite: seed.Website,
			DocsURL:         seed.Docs,
			GithubURL:       seed.Github,
			Tags:            seed.Tags,
			DockerSupport:   true,
			IsActive:        true,
			Visibility:      "public",
		}
		if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&service).Error; err != nil {
			return err
		}

		req := models.ServiceRequirement{
			ServiceID:            id,
			MinRAMMB:             seed.MinRAM,
			RecommendedRAMMB:     seed.RecRAM,
			MinCPUCores:          seed.MinCPU,
			RecommendedCPUCores:  seed.RecCPU,
			MinStorageGB:         seed.MinStorage,
			RecommendedStorageGB: seed.RecStorage,
		}
		if err := db.Where("service_id = ?", id).FirstOrCreate(&req).Error; err != nil {
			return err
		}
	}

	return nil
}
