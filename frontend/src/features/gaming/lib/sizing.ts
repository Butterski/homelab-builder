import type { GameInstance, GamePort, GameProfile, Service } from '../../../types';

// Mirrors backend/internal/gaming/sizing.go. The backend report is the
// authority; this copy gives instant feedback while editing.

export const MAX_PORT_OFFSET = 1000;
export const MAX_INSTANCE_PLAYERS = 1000;

export const EXPOSURES: Array<{ value: GameInstance['exposure']; label: string; hint: string }> = [
  { value: 'lan', label: 'LAN only', hint: 'Only devices on this network can join.' },
  {
    value: 'port_forward',
    label: 'Port forward',
    hint: 'Friends join over the internet through your router. Needs a public address.',
  },
  {
    value: 'vpn',
    label: 'VPN',
    hint: 'Friends join a private network first (Tailscale, WireGuard). Works behind CGNAT.',
  },
  {
    value: 'relay',
    label: 'Relay',
    hint: 'A relay service publishes the server for you. Works behind CGNAT.',
  },
];

export interface GameSizing {
  cpu_cores: number;
  ram_mb: number;
  storage_gb: number;
  upload_kbps: number;
}

export function playersOrDefault(profile: GameProfile, players: number | undefined): number {
  if (players && players > 0) return players;
  return profile.default_players > 0 ? profile.default_players : 1;
}

/** RAM is rounded up to 512 MB and CPU to half a core, the steps people provision in. */
export function sizeServer(profile: GameProfile, players?: number): GameSizing {
  const count = playersOrDefault(profile, players);
  const ram = profile.base_ram_mb + profile.ram_mb_per_player * count;
  const cpu = profile.base_cpu_cores + profile.cpu_cores_per_player * count;
  return {
    cpu_cores: Math.max(0.5, Math.ceil(cpu * 2) / 2),
    ram_mb: Math.max(512, Math.ceil(ram / 512) * 512),
    storage_gb: profile.storage_gb,
    upload_kbps: profile.upload_kbps_per_player * count,
  };
}

/** The largest offset that keeps every port of the profile at or below 65535. */
export function maxPortOffset(profile: GameProfile): number {
  return profile.ports.reduce((limit, port) => Math.min(limit, 65535 - port.port), MAX_PORT_OFFSET);
}

export function resolvePorts(profile: GameProfile, offset = 0): GamePort[] {
  return profile.ports.map(port => ({ ...port, port: port.port + offset }));
}

/** The game settings a server starts with: the usual group, reachable on the LAN only. */
export function newGameInstance(
  profile: GameProfile,
  overrides: Partial<GameInstance> = {},
): GameInstance {
  return {
    profile: profile.slug,
    players: playersOrDefault(profile, overrides.players),
    exposure: overrides.exposure ?? 'lan',
    port_offset: overrides.port_offset ?? 0,
  };
}

/** Reads the game settings stored in a guest's details. */
export function readGameInstance(
  details: Record<string, unknown> | undefined,
): GameInstance | null {
  const raw = details?.game;
  if (!raw || typeof raw !== 'object') return null;
  const game = raw as Partial<GameInstance>;
  if (typeof game.profile !== 'string' || !game.profile) return null;
  return {
    profile: game.profile,
    players: Number(game.players) || 0,
    exposure: (game.exposure as GameInstance['exposure']) || 'lan',
    port_offset: Number(game.port_offset) || 0,
  };
}

export function findGameProfile(services: Service[], slug: string): GameProfile | undefined {
  return services.find(service => service.game?.slug === slug)?.game;
}

export function formatMemory(mb: number): string {
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  }
  return `${mb} MB`;
}
