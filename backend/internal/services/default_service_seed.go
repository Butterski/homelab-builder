package services

import (
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

func SeedExpandedDefaultServices(db *gorm.DB) error {
	seeds := []defaultServiceSeed{
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
