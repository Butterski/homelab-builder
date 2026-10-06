import { describe, expect, it } from 'vitest';
import type { GameProfile, HardwareNode, Service } from '../../../types';
import { gamingSetupSteps } from './setup-steps';

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
  image: '',
  notes: '',
  ...overrides,
});

const services = [
  { id: 'svc-valheim', name: 'Valheim Server', game: profile({}) },
  {
    id: 'svc-mc',
    name: 'Minecraft Java Server',
    game: profile({
      slug: 'minecraft_java',
      ports: [{ name: 'game', port: 25565, proto: 'tcp', forward: true }],
    }),
  },
  {
    id: 'svc-cache',
    name: 'LANCache',
    game: profile({
      slug: 'lancache',
      role: 'tool',
      ports: [{ name: 'http', port: 80, proto: 'tcp', forward: false }],
    }),
  },
] as unknown as Service[];

const game = (slug: string, exposure: string, port_offset = 0) => ({
  game: { profile: slug, players: 8, exposure, port_offset },
});

const host = (vms: HardwareNode['vms']): HardwareNode => ({
  id: 'host',
  type: 'minipc',
  name: 'Game Host',
  ip: '192.168.1.170',
  x: 0,
  y: 0,
  vms,
});

const texts = (items: Array<{ text: string }>) => items.map(item => item.text).join('\n');

describe('gamingSetupSteps', () => {
  it('adds nothing to a build without game servers or tables', () => {
    const lab: HardwareNode[] = [
      { id: 'r', type: 'router', name: 'Router', x: 0, y: 0 },
      {
        ...host([{ id: 'vm', name: 'Jellyfin', type: 'container', status: 'running' }]),
      },
    ];
    expect(gamingSetupSteps(lab, {}, services)).toEqual([]);
  });

  it('says how players reach each server, by how it is exposed', () => {
    const nodes = [
      host([
        { id: 'a', name: 'Valheim', type: 'container', status: 'running', details: game('valheim', 'port_forward') },
        { id: 'b', name: 'Creative', type: 'container', status: 'running', details: game('minecraft_java', 'vpn', 1) },
        { id: 'c', name: 'Survival', type: 'vm', status: 'running', ip: '192.168.1.171', details: game('minecraft_java', 'lan') },
        { id: 'd', name: 'Skyblock', type: 'container', status: 'running', details: game('minecraft_java', 'relay', 2) },
      ]),
    ];
    const [step, ...rest] = gamingSetupSteps(
      nodes,
      { uplink: { down_mbps: 0, up_mbps: 0, cgnat: '', public_host: 'play.example.org' } },
      services,
    );
    expect(rest).toEqual([]);
    expect(step.id).toBe('game-servers');
    const text = texts(step.items);

    // The forward goes to the host of a container, on the ports of that server.
    expect(text).toContain(
      'Valheim: on your router, forward 2456/UDP, 2457/UDP to 192.168.1.170. Friends connect to play.example.org:2456.',
    );
    // A port offset moves the port players use.
    expect(text).toContain('Creative: invite your friends to your VPN');
    expect(text).toContain('they join 192.168.1.170:25566.');
    // A VM is reached at its own address.
    expect(text).toContain('Survival: players on your network join 192.168.1.171:25565.');
    expect(text).toContain('Skyblock: create a tunnel with a relay service that points at 192.168.1.170:25567');
    // Anything reachable from outside should be tried from outside.
    expect(text).toContain('Test from outside your network');
    expect(step.items[1].code).toContain('docker compose up -d');
  });

  it('does not ask for an outside test when everything stays on the LAN', () => {
    const [step] = gamingSetupSteps(
      [host([{ id: 'a', name: 'Valheim', type: 'container', status: 'running', details: game('valheim', 'lan') }])],
      {},
      services,
    );
    expect(texts(step.items)).not.toContain('Test from outside');
    expect(texts(step.items)).toContain('Valheim: players on your network join 192.168.1.170:2456.');
  });

  it('prepares the room for a LAN party from the plan', () => {
    const nodes: HardwareNode[] = [
      {
        id: 'r',
        type: 'router',
        name: 'Router',
        x: 0,
        y: 0,
        details: { dhcp_pool: { start: '192.168.1.50', end: '192.168.1.149', size: 100, clients: 16 } },
      },
      { id: 't1', type: 'lan_table', name: 'Table 1', x: 0, y: 0, details: { seats: 8, circuit: 'c1' } },
      { id: 't2', type: 'lan_table', name: 'Table 2', x: 0, y: 0, details: { seats: 8, circuit: 'c2' } },
      host([{ id: 'c', name: 'LANCache', type: 'container', status: 'running', details: game('lancache', 'lan') }]),
    ];
    const steps = gamingSetupSteps(
      nodes,
      {
        power: {
          mains_voltage: 230,
          circuits: [
            { id: 'c1', label: 'Hall left', breaker_amps: 16 },
            { id: 'c2', label: '', breaker_amps: 16 },
          ],
        },
      },
      services,
    );
    // The cache is a tool, not a server players join: only the party step is added.
    expect(steps.map(step => step.id)).toEqual(['lan-party']);
    const party = steps[0];
    expect(party.description).toBe('Preparing the room for 16 seats at 2 tables.');
    expect(party.items[0].code).toBe('Hall left: Table 1\nc2: Table 2');
    const text = texts(party.items);
    expect(text).toContain(
      'Set the DHCP range on your router to 192.168.1.50 - 192.168.1.149 (100 addresses for 16 expected devices).',
    );
    expect(text).toContain('Bring 2 long cables for the table uplinks and 16 patch cables');
    expect(text).toContain('LANCache only works when clients use its DNS server');
  });

  it('asks for the circuits when tables are not assigned yet', () => {
    const [party] = gamingSetupSteps(
      [{ id: 't1', type: 'lan_table', name: 'Table 1', x: 0, y: 0, details: { seats: 6 } }],
      {},
      services,
    );
    const text = texts(party.items);
    expect(text).toContain('Find out which sockets are on which breaker');
    // Without a calculated pool the guide still says how many addresses are needed.
    expect(text).toContain('room for at least 8 addresses');
    expect(party.description).toBe('Preparing the room for 6 seats at 1 table.');
  });
});
