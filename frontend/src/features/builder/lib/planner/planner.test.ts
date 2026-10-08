import { describe, expect, it } from 'vitest';
import type { GameInstance, GameProfile, Service } from '../../../../types';
import { checkConnection } from '../connection-rules';
import { buildGameServerPlan } from './game-server-plan';
import { buildHomelabPlan } from './homelab-plan';
import {
  buildLanPartyPlan,
  circuitsNeeded,
  seatsPerTable,
  tableSizes,
} from './lan-party-plan';
import type { GameServerAnswers, LanPartyAnswers, Plan } from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const profile = (overrides: Partial<GameProfile>): GameProfile => ({
  slug: 'valheim',
  service_id: 'svc-valheim',
  name: 'Valheim Server',
  role: 'game',
  default_players: 5,
  max_players: 10,
  base_ram_mb: 3072,
  ram_mb_per_player: 150,
  base_cpu_cores: 1.5,
  cpu_cores_per_player: 0.1,
  storage_gb: 5,
  upload_kbps_per_player: 150,
  single_thread: true,
  ports: [
    { name: 'game', port: 2456, proto: 'udp', forward: true, env: 'SERVER_PORT' },
    { name: 'query', port: 2457, proto: 'udp', forward: true },
  ],
  image: 'ghcr.io/community-valheim-tools/valheim-server:latest',
  notes: '',
  ...overrides,
});

const service = (game: GameProfile): Service => ({
  id: game.service_id,
  name: game.name,
  description: '',
  category: 'gaming',
  icon: '',
  official_website: '',
  docker_support: true,
  is_active: true,
  requirements: null,
  game,
  created_at: '',
});

const catalog: Service[] = [
  service(profile({})),
  service(
    profile({
      slug: 'cs2',
      service_id: 'svc-cs2',
      name: 'Counter-Strike 2 Server',
      default_players: 10,
      max_players: 64,
      base_ram_mb: 2048,
      ram_mb_per_player: 64,
      base_cpu_cores: 2,
      cpu_cores_per_player: 0.05,
      ports: [{ name: 'game', port: 27015, proto: 'udp', forward: true, env: 'CS2_PORT' }],
    }),
  ),
  service(
    profile({
      slug: 'palworld',
      service_id: 'svc-palworld',
      name: 'Palworld Server',
      default_players: 8,
      max_players: 32,
      base_ram_mb: 14336,
      ram_mb_per_player: 128,
      base_cpu_cores: 2,
      cpu_cores_per_player: 0.15,
    }),
  ),
  service(
    profile({
      slug: 'lancache',
      service_id: 'svc-lancache',
      name: 'LANCache',
      role: 'tool',
      default_players: 0,
      max_players: 0,
      base_ram_mb: 2048,
      ram_mb_per_player: 0,
      base_cpu_cores: 1,
      cpu_cores_per_player: 0,
      upload_kbps_per_player: 0,
      ports: [{ name: 'http', port: 80, proto: 'tcp', forward: false }],
    }),
  ),
  service(
    profile({
      slug: 'mumble',
      service_id: 'svc-mumble',
      name: 'Mumble Server',
      role: 'tool',
      default_players: 10,
      max_players: 100,
      base_ram_mb: 128,
      ram_mb_per_player: 4,
      base_cpu_cores: 0.5,
      cpu_cores_per_player: 0.01,
      ports: [{ name: 'voice', port: 64738, proto: 'udp', forward: true }],
    }),
  ),
];

const party = (overrides: Partial<LanPartyAnswers> = {}): LanPartyAnswers => ({
  name: 'Autumn LAN',
  seats: 16,
  consoles: 0,
  wifi: false,
  mainsVoltage: 230,
  breakerAmps: 16,
  circuits: 2,
  downMbps: 500,
  upMbps: 50,
  hours: 24,
  games: [],
  lancache: false,
  ...overrides,
});

const friends = (overrides: Partial<GameServerAnswers> = {}): GameServerAnswers => ({
  name: 'Friends',
  games: [{ slug: 'valheim', players: 10 }],
  location: 'home',
  exposure: 'port_forward',
  downMbps: 300,
  upMbps: 20,
  cgnat: 'no',
  voice: false,
  ...overrides,
});

const ofType = (plan: Plan, type: string) => plan.nodes.filter(node => node.type === type);

/**
 * What the wizard generates must be drawable by hand: every link has to pass
 * the same rules the canvas applies, on ports that exist.
 */
function expectDrawable({ nodes, edges }: Plan) {
  const ids = new Set(nodes.map(node => node.id));
  expect(ids.size).toBe(nodes.length);

  const drawn: Array<{
    source: string;
    target: string;
    sourceHandle: string;
    targetHandle: string;
  }> = [];
  for (const edge of edges) {
    const source = nodes.find(node => node.id === edge.source)!;
    expect(source, `edge from unknown node ${edge.source}`).toBeDefined();
    expect(ids.has(edge.target)).toBe(true);
    if (edge.source_handle.startsWith('eth')) {
      const port = Number(edge.source_handle.slice(3));
      expect(port).toBeLessThan(Number(source.details.ports ?? 1));
    }
    const link = {
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.source_handle,
      targetHandle: edge.target_handle,
    };
    const result = checkConnection(link, nodes as never, drawn);
    expect(result, `${source.name} -> ${edge.target}`).toEqual({ ok: true });
    drawn.push(link);
  }
}

// ─── LAN party ───────────────────────────────────────────────────────────────

describe('LAN party seating', () => {
  it('seats as many per table as one circuit carries for hours', () => {
    // 230 V x 16 A x 80% = 2944 W: eight 350 W seats and the switch are 2810 W.
    expect(seatsPerTable(230, 16)).toBe(8);
    // 120 V x 15 A x 80% = 1440 W: four seats.
    expect(seatsPerTable(120, 15)).toBe(4);
    expect(seatsPerTable(120, 20)).toBe(5);
    expect(seatsPerTable(230, 10)).toBe(5);
    // A circuit too weak for one PC still seats one: the report flags the breaker.
    expect(seatsPerTable(120, 2)).toBe(1);
  });

  it('fills tables in order and puts the rest on the last one', () => {
    expect(tableSizes(16, 8)).toEqual([8, 8]);
    expect(tableSizes(20, 8)).toEqual([8, 8, 4]);
    expect(tableSizes(3, 8)).toEqual([3]);
    expect(circuitsNeeded(party({ seats: 64 }))).toBe(8);
    expect(circuitsNeeded(party({ seats: 64, mainsVoltage: 120, breakerAmps: 15 }))).toBe(16);
    // A server draws more than a full table leaves spare, so it gets its own circuit.
    expect(circuitsNeeded(party({ seats: 64, lancache: true }))).toBe(9);
    expect(circuitsNeeded(party({ seats: 64, games: ['cs2'] }))).toBe(9);
  });
});

describe('buildLanPartyPlan', () => {
  it('lays out tables on a core switch behind one router', () => {
    const plan = buildLanPartyPlan(party(), catalog);

    expect(plan.kind).toBe('lan_party');
    expect(plan.name).toBe('Autumn LAN');
    expect(ofType(plan, 'router')).toHaveLength(1);
    expect(ofType(plan, 'switch')).toHaveLength(1);
    const tables = ofType(plan, 'lan_table');
    expect(tables.map(table => table.details.seats)).toEqual([8, 8]);
    // A full table: 8 seats at 350 W plus the switch, on a 16-port switch.
    expect(tables[0]).toMatchObject({
      name: 'Table 1',
      power_draw: 2810,
      details: { seat_watts: 350, switch_ports: 16, switch_speed: '1 GbE' },
    });
    expectDrawable(plan);

    // Two tables get a circuit each; the small gear goes to whichever is lighter.
    expect(tables.map(table => table.details.circuit).sort()).toEqual(['c1', 'c2']);
    expect(plan.gaming_plan).toEqual({
      uplink: { down_mbps: 500, up_mbps: 50, cgnat: '', public_host: '' },
      power: {
        mains_voltage: 230,
        circuits: [
          { id: 'c1', label: 'Circuit 1', breaker_amps: 16 },
          { id: 'c2', label: 'Circuit 2', breaker_amps: 16 },
        ],
      },
      event: { date: '', hours: 24 },
    });
    // Every powered device names a circuit that exists.
    for (const node of plan.nodes) {
      expect(['c1', 'c2']).toContain(node.details.circuit);
    }
  });

  it('plans a full 64-seat party in a subnet that has room for it', () => {
    const plan = buildLanPartyPlan(party({ seats: 64, wifi: true, circuits: 8 }), catalog);

    const tables = ofType(plan, 'lan_table');
    expect(tables).toHaveLength(8);
    expect(tables.reduce((sum, table) => sum + Number(table.details.seats), 0)).toBe(64);
    expectDrawable(plan);

    // 64 seats and as many phones are 160 leases with headroom: more than a /24 holds.
    const [router] = ofType(plan, 'router');
    expect(router.ip).toBe('192.168.0.1');
    expect(router.details).toMatchObject({ subnet_mask: '255.255.254.0', dhcp_enabled: true });
    const [ap] = ofType(plan, 'access_point');
    expect(ap.details.wifi_clients).toBe(64);
    // The core switch has a port for every table and for the access point.
    expect(Number(ofType(plan, 'switch')[0].details.ports)).toBeGreaterThanOrEqual(9);
    // One table per circuit.
    expect(new Set(tables.map(table => table.details.circuit)).size).toBe(8);
  });

  it('keeps a small party in a /24', () => {
    const [router] = ofType(buildLanPartyPlan(party({ seats: 8, wifi: true }), catalog), 'router');
    expect(router.ip).toBe('192.168.1.1');
    expect(router.details.subnet_mask).toBe('255.255.255.0');
  });

  it('adds what was asked for: a local server, a cache and consoles', () => {
    const plan = buildLanPartyPlan(
      party({ seats: 12, consoles: 2, games: ['cs2'], lancache: true }),
      catalog,
    );
    expectDrawable(plan);

    expect(ofType(plan, 'console')).toHaveLength(2);
    const host = plan.nodes.find(node => node.vms.length > 0)!;
    expect(host.name).toBe('Party Server');
    expect(host.vms.map(vm => vm.name)).toEqual(['Counter-Strike 2 Server', 'LANCache']);
    // Everyone in the room plays on it, and nobody outside.
    expect(host.vms[0].details.game).toEqual({
      profile: 'cs2',
      players: 14,
      exposure: 'lan',
      port_offset: 0,
    });
    // 2048 + 14 x 64 MB is 2944 MB, provisioned as 3072.
    expect(host.vms[0]).toMatchObject({ ram_mb: 3072, cpu_cores: 3 });
    expect(host.vms[0].details.catalog_service_id).toBe('svc-cs2');
  });

  it('never plans more players on a server than the estimate covers', () => {
    const plan = buildLanPartyPlan(party({ seats: 40, games: ['valheim'] }), catalog);
    const host = plan.nodes.find(node => node.vms.length > 0)!;
    expect((host.vms[0].details.game as { players: number }).players).toBe(10);
  });

  it('spreads tables over the circuits there are, even when there are too few', () => {
    // Four tables on two circuits: two each. The report will say each is overloaded.
    const plan = buildLanPartyPlan(party({ seats: 32, circuits: 2 }), catalog);
    const perCircuit = new Map<string, number>();
    for (const table of ofType(plan, 'lan_table')) {
      const circuit = String(table.details.circuit);
      perCircuit.set(circuit, (perCircuit.get(circuit) ?? 0) + 1);
    }
    expect([...perCircuit.values()]).toEqual([2, 2]);
  });

  it('stays inside the supported range whatever is typed', () => {
    expect(
      ofType(buildLanPartyPlan(party({ seats: 500 }), catalog), 'lan_table').reduce(
        (sum, table) => sum + Number(table.details.seats),
        0,
      ),
    ).toBe(64);
    expect(ofType(buildLanPartyPlan(party({ seats: 0 }), catalog), 'lan_table')).toHaveLength(1);
    expect(buildLanPartyPlan(party({ name: '  ' }), catalog).name).toBe('LAN Party');
    // Unknown games are left out instead of becoming placeholders.
    const plan = buildLanPartyPlan(party({ games: ['pong'] }), catalog);
    expect(plan.nodes.every(node => node.vms.length === 0)).toBe(true);
  });
});

// ─── Game server ─────────────────────────────────────────────────────────────

describe('buildGameServerPlan', () => {
  it('puts a sized host behind the home router', () => {
    const plan = buildGameServerPlan(friends(), catalog);

    expect(plan.kind).toBe('game_server');
    expectDrawable(plan);
    expect(plan.nodes.map(node => node.type)).toEqual(['modem', 'router', 'minipc']);
    const host = plan.nodes[2];
    // Valheim for 10 needs 4608 MB and 2.5 cores: an 8 GB, 4-core mini PC has room.
    expect(host.details).toMatchObject({ ram: 8, cpu: 4 });
    expect(host.vms[0]).toMatchObject({ name: 'Valheim Server', ram_mb: 4608, cpu_cores: 2.5 });
    expect(host.vms[0].details.game).toEqual({
      profile: 'valheim',
      players: 10,
      exposure: 'port_forward',
      port_offset: 0,
    });
    expect(plan.gaming_plan?.uplink).toEqual({
      down_mbps: 300,
      up_mbps: 20,
      cgnat: 'no',
      public_host: '',
    });
  });

  it('moves up to a server when the games need one', () => {
    const plan = buildGameServerPlan(
      friends({ games: [{ slug: 'palworld', players: 16 }, { slug: 'valheim', players: 10 }] }),
      catalog,
    );
    const host = plan.nodes[2];
    // 16384 + 4608 MB with a quarter of headroom needs a 32 GB box, and
    // 7 cores with headroom need more than the 8 a mini PC has.
    expect(host.type).toBe('server_v2');
    expect(host.details).toMatchObject({ ram: 32, cpu: 16 });

    const bigger = buildGameServerPlan(
      friends({
        games: [
          { slug: 'palworld', players: 32 },
          { slug: 'palworld', players: 32 },
        ],
      }),
      catalog,
    );
    expect(bigger.nodes[2].type).toBe('server_v2');
    expectDrawable(bigger);
    // Two servers of the same game on one host cannot share a port.
    const offsets = bigger.nodes[2].vms.map(vm => (vm.details.game as GameInstance).port_offset);
    expect(offsets).toEqual([0, 1]);
  });

  it('plans a VPS as a public host', () => {
    const plan = buildGameServerPlan(friends({ location: 'vps', exposure: 'vpn' }), catalog);
    expectDrawable(plan);

    const vps = plan.nodes.find(node => node.type === 'vps')!;
    expect(vps.details.network_zone).toBe('cloud');
    expect(vps.power_draw).toBe(0);
    // On a VPS the server is open on its public address, whatever was picked for home.
    expect((vps.vms[0].details.game as GameInstance).exposure).toBe('port_forward');
    expect(plan.edges.find(edge => edge.target === vps.id)?.type).toBe('vpn');
  });

  it('adds voice chat sized for the largest group', () => {
    const plan = buildGameServerPlan(
      friends({ voice: true, games: [{ slug: 'valheim', players: 10 }, { slug: 'cs2', players: 20 }] }),
      catalog,
    );
    const voice = plan.nodes[2].vms.find(vm => vm.name === 'Mumble Server')!;
    expect((voice.details.game as GameInstance).players).toBe(20);
  });

  it('keeps the chosen way in for a server at home', () => {
    const plan = buildGameServerPlan(friends({ exposure: 'vpn', cgnat: 'yes' }), catalog);
    expect((plan.nodes[2].vms[0].details.game as GameInstance).exposure).toBe('vpn');
    expect(plan.gaming_plan?.uplink?.cgnat).toBe('yes');
  });
});

// ─── Homelab (moved out of the page unchanged) ───────────────────────────────

describe('buildHomelabPlan', () => {
  it('still builds the homelab the planner always built', () => {
    const plan = buildHomelabPlan(
      {
        goals: ['backup', 'network'],
        footprint: 'compact',
        budget: 'balanced',
        reliability: 'simple',
        name: 'My Guided Homelab',
      },
      [],
    );
    expect(plan.name).toBe('My Guided Homelab');
    // No kind is set, so the server keeps its default: a homelab.
    expect(plan.kind).toBeUndefined();
    expect(plan.nodes.map(node => node.type)).toEqual([
      'router',
      'switch',
      'minipc',
      'nas',
      'access_point',
    ]);
    expect(plan.nodes[2].vms.map(vm => vm.name)).toEqual([
      'Backups & storage',
      'Better networking',
    ]);
    expect(plan.settings.planner?.goals).toEqual(['backup', 'network']);
  });
});
