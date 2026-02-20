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
