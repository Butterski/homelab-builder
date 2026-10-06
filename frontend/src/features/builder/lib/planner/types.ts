import type { GameExposure } from '../../../../types';

// ─── Homelab ─────────────────────────────────────────────────────────────────

export type Goal = 'backup' | 'media' | 'home' | 'network' | 'development' | 'security';
export type Footprint = 'compact' | 'desk' | 'rack' | 'cloud';
export type Budget = 'starter' | 'balanced' | 'enthusiast';
export type Reliability = 'simple' | 'resilient';

export type PlannerAnswers = {
  goals: Goal[];
  footprint: Footprint;
  budget: Budget;
  reliability: Reliability;
  name: string;
};

export const GOAL_LABELS: Record<Goal, string> = {
  backup: 'Backups & storage',
  media: 'Media streaming',
  home: 'Smart home',
  network: 'Better networking',
  development: 'Development',
  security: 'Remote access',
};

// ─── LAN party ───────────────────────────────────────────────────────────────

export type LanPartyAnswers = {
  name: string;
  /** Players seated at tables. */
  seats: number;
  /** Consoles plugged in on their own, next to the tables. */
  consoles: number;
  /** An access point for phones, handhelds and laptops. */
  wifi: boolean;
  mainsVoltage: number;
  breakerAmps: number;
  /** How many separate circuits the venue offers. */
  circuits: number;
  downMbps: number;
  upMbps: number;
  hours: number;
  /** Game profile slugs to host on a local server. */
  games: string[];
  lancache: boolean;
};

// ─── Game server ─────────────────────────────────────────────────────────────

export type GameServerAnswers = {
  name: string;
  games: Array<{ slug: string; players: number }>;
  /** Where the server runs: a box at home, or a rented VPS. */
  location: 'home' | 'vps';
  /** How friends reach a server at home. A VPS is always public. */
  exposure: GameExposure;
  downMbps: number;
  upMbps: number;
  cgnat: '' | 'yes' | 'no';
  voice: boolean;
};

// ─── Generated topology ──────────────────────────────────────────────────────

export type PlannedVM = {
  id: string;
  name: string;
  type: 'container';
  status: 'running';
  cpu_cores?: number;
  ram_mb?: number;
  details: Record<string, unknown>;
};

export type PlannedNode = {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  ip?: string;
  power_draw?: number;
  parent_id?: string;
  details: Record<string, unknown>;
  vms: PlannedVM[];
  internal_components: unknown[];
};

export type PlannedEdge = {
  source: string;
  source_handle: string;
  target: string;
  target_handle: string;
  type: string;
  speed: string;
  direction: string;
  wireless_standard?: string;
};
