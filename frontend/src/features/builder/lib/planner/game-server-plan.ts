import type { GameExposure, GamingPlan, Service } from '../../../../types';
import { arrangePlan } from './arrange';
import { gameHost, gameServerVM, gameService, nextPortOffsets } from './game-hosts';
import type { GameServerAnswers, Plan, PlannedEdge, PlannedNode, PlannedVM } from './types';

export const MAX_PLANNED_GAMES = 8;

/** Builds a game server for friends: a host at home behind the router, or a rented VPS. */
export function buildGameServerPlan(
  answers: GameServerAnswers,
  services: Service[],
): Plan {
  const nodes: PlannedNode[] = [];
  const edges: PlannedEdge[] = [];
  const onVPS = answers.location === 'vps';
  // A VPS has a public address: its servers are simply open on it.
  const exposure: GameExposure = onVPS ? 'port_forward' : answers.exposure;

  const offsetFor = nextPortOffsets();
  const vms: PlannedVM[] = [];
  for (const game of answers.games.slice(0, MAX_PLANNED_GAMES)) {
    const service = gameService(services, game.slug);
    if (service?.game) {
      vms.push(gameServerVM(service, game.players, exposure, offsetFor(game.slug)));
    }
  }
  if (answers.voice) {
    const voice = gameService(services, 'mumble');
    if (voice?.game) {
      const players = Math.max(0, ...answers.games.map(game => game.players));
      vms.push(gameServerVM(voice, players || undefined, exposure));
    }
  }

  const routerID = crypto.randomUUID();
  const router: PlannedNode = {
    id: routerID,
    type: 'router',
    name: 'Home Router',
    x: 360,
    y: 80,
    ip: '192.168.1.1',
    power_draw: 12,
    details: {
      ports: 4,
      dhcp_enabled: true,
      subnet_mask: '255.255.255.0',
      network_zone: 'lan',
      planner_role: 'gateway',
    },
    vms: [],
    internal_components: [],
  };
  const modem: PlannedNode = {
    id: crypto.randomUUID(),
    type: 'modem',
    name: 'Internet',
    x: 80,
    y: 80,
    power_draw: 8,
    details: { ports: 2, network_zone: 'wan', planner_role: 'internet' },
    vms: [],
    internal_components: [],
  };
  nodes.push(modem, router);
  edges.push({
    source: modem.id,
    source_handle: 'eth0',
    target: routerID,
    target_handle: 'target-0',
    type: 'ethernet',
    speed: '1 GbE',
    direction: 'wan',
  });

  if (onVPS) {
    const host = gameHost('Game VPS', vms, { x: 640, y: 80 });
    nodes.push({
      ...host,
      type: 'vps',
      power_draw: 0,
      details: {
        ...host.details,
        ports: 2,
        provider: 'Choose a provider',
        network_zone: 'cloud',
      },
    });
    // The VPS is managed from home over a tunnel; players go straight to it.
    edges.push({
      source: routerID,
      source_handle: 'eth0',
      target: host.id,
      target_handle: 'target-0',
      type: 'vpn',
      speed: '1 GbE',
      direction: 'auto',
    });
  } else {
    const host = gameHost('Game Host', vms, { x: 640, y: 80 });
    nodes.push(host);
    edges.push({
      source: routerID,
      source_handle: 'eth0',
      target: host.id,
      target_handle: 'target-0',
      type: 'ethernet',
      speed: '1 GbE',
      direction: 'lan',
    });
  }

  const gaming_plan: GamingPlan = {
    uplink: {
      down_mbps: Math.max(0, answers.downMbps || 0),
      up_mbps: Math.max(0, answers.upMbps || 0),
      cgnat: answers.cgnat,
      public_host: '',
    },
    power: { mains_voltage: 0, circuits: [] },
    event: { date: '', hours: 0 },
  };

  return arrangePlan({
    name: answers.name.trim() || 'Game Server',
    thumbnail: '',
    kind: 'game_server',
    gaming_plan,
    settings: { planner: { kind: 'game_server', ...answers } },
    nodes,
    edges,
    services: [],
  });
}
