import { describe, expect, it } from 'vitest';
import type { PlannedEdge, PlannedNode } from '../../builder/lib/planner/types';
import { previewAddresses } from './demo-addresses';
import { DEFAULT_HOMELAB, DEFAULT_PARTY, homelabDemo, partyDemo } from './demo-plan';

function node(id: string, type: string, extra: Partial<PlannedNode> = {}): PlannedNode {
  return { id, type, name: id, x: 0, y: 0, details: {}, vms: [], internal_components: [], ...extra };
}

function cable(source: string, target: string): PlannedEdge {
  return {
    source,
    source_handle: 'eth0',
    target,
    target_handle: 'target-0',
    type: 'ethernet',
    speed: '1 GbE',
    direction: 'lan',
  };
}

const guest = (id: string) => ({
  id,
  name: id,
  type: 'container' as const,
  status: 'running' as const,
  details: {},
});

describe('previewAddresses', () => {
  it('gives each device the range of its role and guests the addresses after their host', () => {
    const nodes = previewAddresses(
      [
        node('router', 'router', { ip: '192.168.1.1' }),
        node('switch', 'switch'),
        node('ap', 'access_point'),
        node('nas', 'nas'),
        node('server', 'server_v2', { vms: [guest('a'), guest('b')] }),
        node('mini', 'minipc'),
        node('table', 'lan_table'),
      ],
      [
        cable('router', 'switch'),
        cable('switch', 'ap'),
        cable('switch', 'nas'),
        cable('switch', 'server'),
        cable('switch', 'mini'),
        cable('switch', 'table'),
      ],
    );
    const ip = (id: string) => nodes.find(item => item.id === id)?.ip;

    expect(ip('switch')).toBe('192.168.1.10');
    expect(ip('ap')).toBe('192.168.1.20');
    expect(ip('nas')).toBe('192.168.1.100');
    expect(ip('server')).toBe('192.168.1.150');
    expect(ip('mini')).toBe('192.168.1.170');
    // A table has no address of its own: its seats take leases.
    expect(ip('table')).toBeUndefined();

    const server = nodes.find(item => item.id === 'server');
    expect(server?.vms.map(vm => (vm as { ip?: string }).ip)).toEqual([
      '192.168.1.151',
      '192.168.1.152',
    ]);
  });

  it('keeps two devices of one role apart and leaves an unconnected one without an address', () => {
    const nodes = previewAddresses(
      [
        node('router', 'router', { ip: '10.0.0.1' }),
        node('nas-a', 'nas'),
        node('nas-b', 'nas'),
        node('loose', 'minipc'),
      ],
      [cable('router', 'nas-a'), cable('router', 'nas-b')],
    );
    const ip = (id: string) => nodes.find(item => item.id === id)?.ip;

    expect(ip('nas-a')).toBe('10.0.0.100');
    expect(ip('nas-b')).toBe('10.0.0.110');
    expect(ip('loose')).toBeUndefined();
  });
});

describe('the landing demo', () => {
  it('draws a homelab from the real planner, with addresses on every networked device', () => {
    const plan = homelabDemo(DEFAULT_HOMELAB);
    const ids = new Set(plan.nodes.map(item => item.id));

    expect(plan.nodes.length).toBeGreaterThan(3);
    expect(plan.edges.every(edge => ids.has(edge.source) && ids.has(edge.target))).toBe(true);
    expect(plan.hardwareNodes.find(item => item.type === 'switch')?.ip).toMatch(/\.10$/);
    // One service per goal, each with an address next to its host.
    const guests = plan.hardwareNodes.flatMap(item => item.vms ?? []);
    expect(guests).toHaveLength(DEFAULT_HOMELAB.goals.length);
    expect(guests.every(vm => Boolean(vm.ip))).toBe(true);
    expect(plan.stats.map(stat => stat.label)).toEqual([
      'Devices',
      'Services',
      'Addresses',
      'Power',
    ]);
  });

  it('adds a second node and a UPS when asked for resilience', () => {
    const simple = homelabDemo({ ...DEFAULT_HOMELAB, resilient: false });
    const resilient = homelabDemo({ ...DEFAULT_HOMELAB, resilient: true });

    expect(resilient.nodes.length).toBe(simple.nodes.length + 2);
    expect(resilient.hardwareNodes.some(item => item.type === 'ups')).toBe(true);
  });

  it('seats a party at tables that one circuit can carry', () => {
    const plan = partyDemo({ ...DEFAULT_PARTY, seats: 24, consoles: 2, wifi: true });
    const tables = plan.hardwareNodes.filter(item => item.type === 'lan_table');

    expect(tables).toHaveLength(3);
    expect(plan.hardwareNodes.filter(item => item.type === 'console')).toHaveLength(2);
    expect(plan.stats[0]).toMatchObject({ label: 'Tables', value: '3' });
    // 24 seats and 24 Wi-Fi devices, with a quarter of headroom.
    expect(plan.stats[2]).toMatchObject({ label: 'DHCP pool', value: '60' });
  });

  it('seats fewer players per table on a 120 V circuit', () => {
    const eu = partyDemo({ ...DEFAULT_PARTY, seats: 16, mains: 'eu' });
    const us = partyDemo({ ...DEFAULT_PARTY, seats: 16, mains: 'us' });
    const tables = (plan: typeof eu) =>
      plan.hardwareNodes.filter(item => item.type === 'lan_table').length;

    expect(tables(us)).toBeGreaterThan(tables(eu));
  });
});
