import type { Position } from '@xyflow/react';

export interface ServiceRequirement {
  id: string;
  service_id: string;
  min_ram_mb: number;
  recommended_ram_mb: number;
  min_cpu_cores: number;
  recommended_cpu_cores: number;
  min_storage_gb: number;
  recommended_storage_gb: number;
}

export type ServiceCategory =
  | 'media'
  | 'networking'
  | 'monitoring'
  | 'storage'
  | 'management'
  | 'home_automation'
  | 'gaming'
  | 'other';

export interface Service {
  id: string;
  user_id?: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  official_website: string;
  docs_url?: string;
  github_url?: string;
  tags?: string;
  docker_support: boolean;
  is_active: boolean;
  visibility?: 'public' | 'private' | 'pending';
  requirements: ServiceRequirement | null;
  /** Set by the backend for game servers and gaming tools. */
  game?: GameProfile;
  created_at: string;
}

// ─── Gaming builds ───────────────────────────────────────────────────────────
// Mirrors backend/internal/gaming.

export type BuildKind = 'homelab' | 'lan_party' | 'game_server';

export interface PowerCircuit {
  id: string;
  label: string;
  breaker_amps: number;
}

/** What the owner tells us that the canvas cannot show. Zero and '' mean "not filled in". */
export interface GamingPlan {
  uplink: { down_mbps: number; up_mbps: number; cgnat: '' | 'yes' | 'no'; public_host: string };
  power: { mains_voltage: number; circuits: PowerCircuit[] };
  event: { date: string; hours: number };
}

export interface GamePort {
  name: string;
  port: number;
  proto: 'tcp' | 'udp';
  /** A player outside the LAN needs this port to join. */
  forward: boolean;
  env?: string;
}

export interface GameProfile {
  slug: string;
  service_id: string;
  name: string;
  role: 'game' | 'tool';
  default_players: number;
  max_players: number;
  base_ram_mb: number;
  ram_mb_per_player: number;
  base_cpu_cores: number;
  cpu_cores_per_player: number;
  storage_gb: number;
  upload_kbps_per_player: number;
  single_thread: boolean;
  ports: GamePort[];
  image: string;
  notes: string;
}

export type GameExposure = 'lan' | 'port_forward' | 'vpn' | 'relay';

/** Stored in a guest's details under `game`. */
export interface GameInstance {
  profile: string;
  players: number;
  exposure: GameExposure;
  port_offset: number;
}

export interface CatalogComponent {
  id: string;
  category: string;
  brand: string;
  model: string;
  spec: Record<string, any>;
  price_est: number;
  currency: string;
  affiliate_tag: string;
  buy_urls: PurchaseLink[];
  image_url: string;
  submitted_by?: string;
  approved: boolean;
  likes: number;
  created_at: string;
  updated_at: string;
}

export interface Spec {
  total_ram_mb: number;
  total_cpu_cores: number;
  total_storage_gb: number;
  cpu_suggestion: string;
  ram_suggestion: string;
  storage_suggestion: string;
  network_suggestion: string;
  rationale: string;
  estimated_cost_min: number;
  estimated_cost_max: number;
  hardware_matches?: CatalogComponent[];
}

export interface ServiceInsight {
  name: string;
  note: string;
  ram_percentage: number;
}

export interface RecommendationResponse {
  minimal_spec: Spec;
  recommended_spec: Spec;
  optimal_spec: Spec;
  selected_services: Service[];
  summary: string;
  insights: ServiceInsight[];
  heaviest_service: string;
  tier_comparison: string;
}

export interface PurchaseLink {
  store: string;
  url: string;
}

export interface ShoppingListItem {
  name: string;
  category: string;
  estimated_price: number;
  priority: string;
  purchase_links: PurchaseLink[];
}

export interface ShoppingListResponse {
  items: ShoppingListItem[];
  total_estimated_cost: number;
  recommendation_id: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string;
  is_admin?: boolean;
}

export interface UserSelection {
  id: string;
  user_id: string;
  service_id: string;
  service: Service;
  created_at: string;
}

export type HardwareType =
  | 'router'
  | 'switch'
  | 'nas'
  | 'server'
  | 'server_v2'
  | 'firewall'
  | 'vps'
  | 'pc'
  | 'access_point'
  | 'disk'
  | 'gpu'
  | 'hba'
  | 'pcie'
  | 'ups'
  | 'pdu'
  | 'sbc'
  | 'minipc'
  | 'iot'
  | 'modem'
  | 'rack'
  | 'console'
  | 'lan_table';

export interface HardwareSpec {
  virtual_network?: VirtualNetwork;
  model?: string;
  cpu?: string | number;
  cpu_cores?: number;
  ram?: string | number;
  storage?: string | number;
  ports?: number | string;
  price_est?: number;
  currency?: string;
  url?: string;
  blueprint_id?: string;
  blueprint_visibility?: string;
  dhcp_enabled?: boolean;
  dhcp_locked?: boolean;
  rack_size?: number; // Total U capacity of a rack (e.g. 24, 42)
  rack_units?: number; // How many U this device occupies (e.g. 1, 2, 4)
  rack_position?: number; // U-slot position within the rack (0-indexed from top)
  server_profile?: string;
  hypervisor_enabled?: boolean;
  app_host_enabled?: boolean;
  storage_enabled?: boolean;
  routing_enabled?: boolean;
  nat_enabled?: boolean;
  firewall_enabled?: boolean;
  network_zone?: 'wan' | 'lan' | 'dmz' | 'cloud';
  public_ip?: string;
  provider?: string;
  region?: string;
  wan_ip?: string;
  lan_gateway_ip?: string;
  lan_subnet?: string;
  interfaces?: Array<{
    name?: string;
    role?: 'wan' | 'lan' | 'dmz' | 'vpn' | string;
    ip?: string;
    subnet?: string;
    dhcp_enabled?: boolean;
  }>;
  // Gaming builds
  seats?: number; // LAN table: players seated at it
  seat_watts?: number; // LAN table: power per seat
  switch_ports?: number; // LAN table: ports of the switch on the table
  switch_speed?: string; // LAN table: '1 GbE' | '2.5 GbE' | '10 GbE'
  platform?: string; // Console: playstation | xbox | switch | handheld | other
  wifi_clients?: number; // Access point: devices expected on its Wi-Fi
  circuit?: string; // Id of the power circuit in the gaming plan
  /** Derived by IPAM on gateways that hand out leases. */
  dhcp_pool?: { start: string; end: string; size: number; clients: number };
}

export type VMType = 'vm' | 'container' | 'lxc';

export interface VirtualNetwork {
  switches: Array<{ id: string; name: string; x: number; y: number }>;
  positions: Record<string, { x: number; y: number }>;
  edges: Array<{ id: string; source: string; target: string }>;
}

export interface VirtualMachine {
  id: string;
  name: string;
  type: VMType;
  ip?: string;
  mac_address?: string;
  details?: Record<string, unknown>;
  os?: string; // e.g. "Ubuntu 22.04", "Alpine Linux"
  cpu_cores?: number;
  ram_mb?: number;
  status: 'running' | 'stopped' | 'paused';
}

export interface HardwareComponent {
  id: string;
  type: HardwareType;
  name: string;
  power_draw?: number;
  details?: HardwareSpec;
}

export interface HardwareNode {
  id: string;
  type: HardwareType;
  name: string;
  ip?: string;
  mac_address?: string;
  subnet_mask?: string;
  gateway?: string;
  power_draw?: number;
  x: number;
  y: number;
  details?: HardwareSpec;
  vms?: VirtualMachine[]; // Nested VMs / Containers
  internal_components?: HardwareComponent[]; // Nested hardware (GPU, Disk, etc)
  parent_id?: string; // If inside a rack, the rack node's ID
}

export type HardwareNodeValidationIssue = {
  node_id: string;
  message: string;
  type: 'error' | 'warning';
};

export type EdgeParams = {
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetX: number;
  targetY: number;
  targetPosition: Position;
  borderRadius?: number;
};
