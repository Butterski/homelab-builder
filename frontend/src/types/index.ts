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
  requirements: ServiceRequirement | null;
  created_at: string;
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
  | 'rack';

export interface HardwareSpec {
  model?: string;
  cpu?: string | number;
  cpu_cores?: number;
  ram?: string | number;
  storage?: string | number;
  ports?: number | string;
  price_est?: number;
  currency?: string;
  url?: string;
  dhcp_enabled?: boolean;
  dhcp_locked?: boolean;
  rack_size?: number;     // Total U capacity of a rack (e.g. 24, 42)
  rack_units?: number;    // How many U this device occupies (e.g. 1, 2, 4)
  rack_position?: number; // U-slot position within the rack (0-indexed from top)
}

export type VMType = 'vm' | 'container' | 'lxc';

export interface VirtualMachine {
  id: string;
  name: string;
  type: VMType;
  ip?: string;
  os?: string; // e.g. "Ubuntu 22.04", "Alpine Linux"
  cpu_cores?: number;
  ram_mb?: number;
  status: 'running' | 'stopped' | 'paused';
}

export interface HardwareComponent {
  id: string;
  type: HardwareType;
  name: string;
  details?: HardwareSpec;
}

export interface HardwareNode {
  id: string;
  type: HardwareType;
  name: string;
  ip?: string;
  subnet_mask?: string;
  gateway?: string;
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
