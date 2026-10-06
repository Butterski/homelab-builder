import type { GameExposure, Service } from '../../../../types';
import { newGameInstance, sizeServer } from '../../../gaming/lib/sizing';
import type { PlannedNode, PlannedVM } from './types';

/** Finds the catalog entry of a game or gaming tool by its profile slug. */
export function gameService(services: Service[], slug: string): Service | undefined {
  return services.find(service => service.game?.slug === slug);
}

/** A game server as a container, sized for its players. */
export function gameServerVM(
  service: Service,
  players: number | undefined,
  exposure: GameExposure,
  portOffset = 0,
): PlannedVM {
  const profile = service.game!;
  const instance = newGameInstance(profile, { players, exposure, port_offset: portOffset });
  const sizing = sizeServer(profile, instance.players);
  return {
    id: crypto.randomUUID(),
    name: service.name,
    type: 'container',
    status: 'running',
    cpu_cores: sizing.cpu_cores,
    ram_mb: sizing.ram_mb,
    details: {
      catalog_service_id: service.id,
      catalog_service_name: service.name,
      game: instance,
    },
  };
}

/** Gives each further server of the same game the next free port offset. */
export function nextPortOffsets(): (slug: string) => number {
  const used = new Map<string, number>();
  return slug => {
    const offset = used.get(slug) ?? 0;
    used.set(slug, offset + 1);
    return offset;
  };
}

const RAM_SIZES_GB = [8, 16, 32, 64, 128, 256];
const CORE_SIZES = [4, 8, 16, 32, 64];

const atLeast = (sizes: number[], needed: number) =>
  sizes.find(size => size >= needed) ?? sizes[sizes.length - 1];

/**
 * A host with a quarter of headroom over what its servers need. Up to 32 GB it
 * is a mini PC; beyond that a server.
 */
export function gameHost(
  name: string,
  vms: PlannedVM[],
  position: { x: number; y: number },
): PlannedNode {
  const ramMB = vms.reduce((sum, vm) => sum + (vm.ram_mb ?? 0), 0);
  const cores = vms.reduce((sum, vm) => sum + (vm.cpu_cores ?? 0), 0);
  // Leave room for the system even when nothing is planned yet.
  const ram = atLeast(RAM_SIZES_GB, Math.max(8, (ramMB / 1024) * 1.25 + 2));
  const cpu = atLeast(CORE_SIZES, Math.max(4, cores * 1.25));
  const isServer = ram > 32 || cpu > 8;
  return {
    id: crypto.randomUUID(),
    type: isServer ? 'server_v2' : 'minipc',
    name,
    ...position,
    power_draw: isServer ? 150 : 35,
    details: {
      cpu,
      ram,
      storage: Math.max(256, vms.length * 100),
      ...(isServer ? { ports: 2 } : {}),
      app_host_enabled: true,
      planner_role: 'game-host',
    },
    vms,
    internal_components: [],
  };
}
