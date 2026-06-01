-- Seed data: Common homelab services with realistic hardware requirements
-- Categories: media, home_automation, networking, storage, monitoring, gaming, management

-- Plex Media Server
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000001', 'Plex', 'Stream your personal media collection to any device. Supports transcoding for remote access.', 'media', 'plex', 'https://www.plex.tv', 'https://support.plex.tv', '', '["transcoding", "media", "streaming"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000001', 1024, 4096, 1, 4, 10, 50);

-- Jellyfin
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000002', 'Jellyfin', 'Free open-source media server. Browse and stream your media without any subscription.', 'media', 'jellyfin', 'https://jellyfin.org', 'https://jellyfin.org/docs/', 'https://github.com/jellyfin/jellyfin', '["open-source", "media", "streaming"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000002', 512, 2048, 1, 2, 10, 30);

-- Home Assistant
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000003', 'Home Assistant', 'Open-source home automation platform. Control all your smart home devices from one place.', 'home_automation', 'home-assistant', 'https://www.home-assistant.io', 'https://www.home-assistant.io/docs/', 'https://github.com/home-assistant/core', '["automation", "smarthome"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000003', 512, 2048, 1, 2, 10, 32);

-- Pi-hole
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000004', 'Pi-hole', 'Network-wide ad blocking. Blocks ads and trackers at the DNS level for all devices.', 'networking', 'pi-hole', 'https://pi-hole.net', 'https://docs.pi-hole.net', 'https://github.com/pi-hole', '["dns", "ad-blocker", "privacy"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000004', 128, 256, 0.5, 1, 2, 5);

-- Traefik
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000005', 'Traefik', 'Modern reverse proxy and load balancer. Auto-discovers services and handles SSL.', 'networking', 'traefik', 'https://traefik.io', 'https://doc.traefik.io/traefik/', 'https://github.com/traefik/traefik', '["proxy", "ssl", "load-balancer"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000005', 128, 256, 0.5, 1, 1, 2);

-- Nextcloud
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000006', 'Nextcloud', 'Self-hosted cloud storage and collaboration platform. Your own Google Drive alternative.', 'storage', 'nextcloud', 'https://nextcloud.com', 'https://docs.nextcloud.com', 'https://github.com/nextcloud/server', '["cloud", "files", "sync"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000006', 1024, 4096, 1, 2, 20, 100);

-- Portainer
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000007', 'Portainer', 'Web-based Docker management UI. Easily manage containers, images, and networks.', 'management', 'portainer', 'https://www.portainer.io', 'https://docs.portainer.io', 'https://github.com/portainer/portainer', '["docker", "gui", "management"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000007', 256, 512, 0.5, 1, 2, 5);

-- AdGuard Home
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000008', 'AdGuard Home', 'Network-wide ad and tracker blocking with DNS-over-HTTPS support.', 'networking', 'adguard', 'https://adguard.com/adguard-home.html', 'https://github.com/AdguardTeam/AdGuardHome/wiki', 'https://github.com/AdguardTeam/AdGuardHome', '["dns", "ad-blocker", "privacy"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000008', 128, 256, 0.5, 1, 2, 5);

-- Grafana
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000009', 'Grafana', 'Beautiful dashboards for monitoring. Visualize metrics from Prometheus, InfluxDB, and more.', 'monitoring', 'grafana', 'https://grafana.com', 'https://grafana.com/docs/', 'https://github.com/grafana/grafana', '["monitoring", "dashboards", "metrics"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000009', 256, 512, 0.5, 1, 2, 10);

-- Uptime Kuma
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000010', 'Uptime Kuma', 'Self-hosted monitoring tool. Track uptime of your services with beautiful status pages.', 'monitoring', 'uptime-kuma', 'https://github.com/louislam/uptime-kuma', 'https://github.com/louislam/uptime-kuma/wiki', 'https://github.com/louislam/uptime-kuma', '["uptime", "monitoring", "status"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000010', 128, 256, 0.5, 1, 1, 3);

-- Minecraft Server
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000011', 'Minecraft Server', 'Host your own Minecraft server. Support for Java and Bedrock editions.', 'gaming', 'minecraft', 'https://www.minecraft.net', 'https://minecraft.fandom.com/wiki/Server', '', '["game", "multiplayer", "java"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000011', 2048, 4096, 2, 4, 5, 20);

-- Nginx Proxy Manager
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000012', 'Nginx Proxy Manager', 'Easy-to-use reverse proxy with a web UI. Manage SSL certificates and proxy hosts visually.', 'networking', 'nginx', 'https://nginxproxymanager.com', 'https://nginxproxymanager.com/guide/', 'https://github.com/NginxProxyManager/nginx-proxy-manager', '["proxy", "nginx", "ssl"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000012', 128, 256, 0.5, 1, 1, 2);

-- Prometheus
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000013', 'Prometheus', 'Time-series monitoring and alerting. Collect metrics from your infrastructure and services.', 'monitoring', 'prometheus', 'https://prometheus.io', 'https://prometheus.io/docs/introduction/overview/', 'https://github.com/prometheus/prometheus', '["metrics", "monitoring", "time-series"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000013', 512, 2048, 1, 2, 10, 50);

-- Vaultwarden (Bitwarden)
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000014', 'Vaultwarden', 'Self-hosted password manager compatible with Bitwarden clients. Lightweight and secure.', 'management', 'bitwarden', 'https://github.com/dani-garcia/vaultwarden', 'https://github.com/dani-garcia/vaultwarden/wiki', 'https://github.com/dani-garcia/vaultwarden', '["passwords", "security", "bitwarden"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000014', 64, 256, 0.5, 1, 1, 3);

-- Immich (Photo management)
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000015', 'Immich', 'Self-hosted photo and video backup. Google Photos alternative with AI-powered features.', 'media', 'immich', 'https://immich.app', 'https://immich.app/docs/overview/quick-start', 'https://github.com/immich-app/immich', '["photos", "backup", "ai"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000015', 2048, 6144, 2, 4, 20, 100);

-- WireGuard Easy
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000016', 'WireGuard Easy', 'Simple WireGuard VPN manager with a web UI for peers, QR codes, and tunnel configuration.', 'networking', 'wireguard', 'https://github.com/wg-easy/wg-easy', 'https://github.com/wg-easy/wg-easy', 'https://github.com/wg-easy/wg-easy', '["vpn", "wireguard", "remote-access"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000016', 128, 256, 0.5, 1, 1, 2);

-- Homepage
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000017', 'Homepage', 'Fast self-hosted dashboard for services, widgets, bookmarks, and infrastructure links.', 'management', 'homepage', 'https://gethomepage.dev', 'https://gethomepage.dev/latest/', 'https://github.com/gethomepage/homepage', '["dashboard", "bookmarks", "widgets"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000017', 128, 256, 0.5, 1, 1, 2);

-- Paperless-ngx
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000018', 'Paperless-ngx', 'Document management with OCR, tagging, search, and archival workflows for scanned paperwork.', 'management', 'paperless', 'https://docs.paperless-ngx.com', 'https://docs.paperless-ngx.com', 'https://github.com/paperless-ngx/paperless-ngx', '["documents", "ocr", "archive"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000018', 1024, 2048, 1, 2, 10, 50);

-- Gitea
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000019', 'Gitea', 'Lightweight self-hosted Git service with repositories, issues, pull requests, and packages.', 'management', 'gitea', 'https://gitea.io', 'https://docs.gitea.com', 'https://github.com/go-gitea/gitea', '["git", "code", "ci"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000019', 512, 1024, 1, 2, 5, 20);

-- Syncthing
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000020', 'Syncthing', 'Continuous peer-to-peer file synchronization between desktops, servers, and mobile devices.', 'storage', 'syncthing', 'https://syncthing.net', 'https://docs.syncthing.net', 'https://github.com/syncthing/syncthing', '["sync", "files", "p2p"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000020', 128, 512, 0.5, 1, 1, 10);

-- MinIO
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000021', 'MinIO', 'S3-compatible object storage for backups, media pipelines, and application data.', 'storage', 'minio', 'https://min.io', 'https://min.io/docs/minio/container/index.html', 'https://github.com/minio/minio', '["s3", "object-storage", "backup"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000021', 512, 2048, 1, 2, 10, 100);

-- qBittorrent
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000022', 'qBittorrent', 'Web-managed BitTorrent client commonly used in media automation stacks.', 'media', 'qbittorrent', 'https://www.qbittorrent.org', 'https://github.com/qbittorrent/qBittorrent/wiki', 'https://github.com/qbittorrent/qBittorrent', '["torrent", "downloads", "media"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000022', 256, 512, 0.5, 1, 5, 20);

-- Sonarr
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000023', 'Sonarr', 'TV library automation for monitoring releases, grabbing episodes, and organizing media files.', 'media', 'sonarr', 'https://sonarr.tv', 'https://wiki.servarr.com/sonarr', 'https://github.com/Sonarr/Sonarr', '["media", "automation", "tv"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000023', 256, 512, 0.5, 1, 1, 5);

-- Radarr
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000024', 'Radarr', 'Movie library automation for monitoring releases, grabbing movies, and organizing media files.', 'media', 'radarr', 'https://radarr.video', 'https://wiki.servarr.com/radarr', 'https://github.com/Radarr/Radarr', '["media", "automation", "movies"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000024', 256, 512, 0.5, 1, 1, 5);

-- Frigate
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000025', 'Frigate', 'Network video recorder with real-time object detection for security cameras.', 'home_automation', 'frigate', 'https://frigate.video', 'https://docs.frigate.video', 'https://github.com/blakeblackshear/frigate', '["nvr", "cameras", "object-detection"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000025', 2048, 4096, 2, 4, 20, 200);

-- Mosquitto
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000026', 'Mosquitto', 'Lightweight MQTT broker for IoT devices, sensors, and home automation messaging.', 'home_automation', 'mqtt', 'https://mosquitto.org', 'https://mosquitto.org/documentation/', 'https://github.com/eclipse/mosquitto', '["mqtt", "iot", "broker"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000026', 64, 128, 0.25, 0.5, 1, 2);

-- Node-RED
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000027', 'Node-RED', 'Flow-based automation tool for wiring devices, APIs, schedules, and smart home logic.', 'home_automation', 'node-red', 'https://nodered.org', 'https://nodered.org/docs/', 'https://github.com/node-red/node-red', '["automation", "flows", "iot"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000027', 256, 512, 0.5, 1, 1, 5);

-- Authentik
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000028', 'Authentik', 'Identity provider for SSO, OAuth, SAML, forward auth, and homelab access control.', 'management', 'authentik', 'https://goauthentik.io', 'https://docs.goauthentik.io', 'https://github.com/goauthentik/authentik', '["sso", "identity", "security"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000028', 1024, 2048, 1, 2, 5, 20);

-- Netdata
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000029', 'Netdata', 'Real-time infrastructure monitoring with host metrics, alerts, dashboards, and collectors.', 'monitoring', 'netdata', 'https://www.netdata.cloud', 'https://learn.netdata.cloud/docs/', 'https://github.com/netdata/netdata', '["monitoring", "metrics", "alerts"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000029', 256, 512, 0.5, 1, 1, 5);

-- Loki
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000030', 'Loki', 'Log aggregation system designed to pair with Grafana for searchable homelab logs.', 'monitoring', 'loki', 'https://grafana.com/oss/loki/', 'https://grafana.com/docs/loki/latest/', 'https://github.com/grafana/loki', '["logs", "grafana", "observability"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000030', 512, 1024, 1, 2, 10, 50);

-- Mealie
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000031', 'Mealie', 'Recipe manager and meal planner with shopping lists, imports, and household organization.', 'management', 'mealie', 'https://mealie.io', 'https://docs.mealie.io', 'https://github.com/mealie-recipes/mealie', '["recipes", "planning", "household"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000031', 512, 1024, 1, 2, 2, 10);

-- BookStack
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000032', 'BookStack', 'Simple wiki and documentation platform for runbooks, notes, and household knowledge bases.', 'management', 'bookstack', 'https://www.bookstackapp.com', 'https://www.bookstackapp.com/docs/', 'https://github.com/BookStackApp/BookStack', '["wiki", "docs", "knowledge-base"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000032', 512, 1024, 1, 2, 2, 10);

-- Open WebUI
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000033', 'Open WebUI', 'Self-hosted AI chat interface for local and remote language model backends.', 'management', 'open-webui', 'https://openwebui.com', 'https://docs.openwebui.com', 'https://github.com/open-webui/open-webui', '["ai", "llm", "chat"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000033', 1024, 2048, 1, 2, 5, 20);

-- Ollama
INSERT INTO services (id, name, description, category, icon, official_website, docs_url, github_url, tags, docker_support)
VALUES ('a1000000-0000-0000-0000-000000000034', 'Ollama', 'Local model runtime for serving LLMs on CPU or GPU-backed homelab hardware.', 'management', 'ollama', 'https://ollama.com', 'https://github.com/ollama/ollama/tree/main/docs', 'https://github.com/ollama/ollama', '["ai", "llm", "gpu"]', true);
INSERT INTO service_requirements (service_id, min_ram_mb, recommended_ram_mb, min_cpu_cores, recommended_cpu_cores, min_storage_gb, recommended_storage_gb)
VALUES ('a1000000-0000-0000-0000-000000000034', 4096, 16384, 2, 8, 20, 200);
