import { Gamepad2, Home, Server, type LucideIcon } from 'lucide-react';
import type { BuildKind, GamingPlan } from '../../../types';

interface BuildKindInfo {
  kind: BuildKind;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const BUILD_KINDS: BuildKindInfo[] = [
  {
    kind: 'homelab',
    label: 'Homelab',
    description: 'Servers, storage and self-hosted services at home.',
    icon: Home,
  },
  {
    kind: 'lan_party',
    label: 'LAN party',
    description: 'Seats, switches, power and uplink for an event.',
    icon: Gamepad2,
  },
  {
    kind: 'game_server',
    label: 'Game server',
    description: 'A server to play on with friends, at home or online.',
    icon: Server,
  },
];

export function buildKindInfo(kind: BuildKind | undefined): BuildKindInfo {
  return BUILD_KINDS.find(entry => entry.kind === kind) ?? BUILD_KINDS[0];
}

export function isGamingKind(kind: BuildKind | undefined): boolean {
  return kind === 'lan_party' || kind === 'game_server';
}

/**
 * Fills the gaps of a stored plan for display and editing. The store keeps the
 * plan exactly as loaded; call this where a complete object is needed.
 */
export function completePlan(plan: Partial<GamingPlan> | undefined): GamingPlan {
  return {
    uplink: {
      down_mbps: plan?.uplink?.down_mbps ?? 0,
      up_mbps: plan?.uplink?.up_mbps ?? 0,
      cgnat: plan?.uplink?.cgnat ?? '',
      public_host: plan?.uplink?.public_host ?? '',
    },
    power: {
      mains_voltage: plan?.power?.mains_voltage ?? 0,
      circuits: plan?.power?.circuits ?? [],
    },
    event: {
      date: plan?.event?.date ?? '',
      hours: plan?.event?.hours ?? 0,
    },
  };
}
