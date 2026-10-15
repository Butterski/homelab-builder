import { describe, expect, it } from 'vitest';

import {
  cableVlan,
  defaultRole,
  highestCabledPort,
  isIpv4Cidr,
  isIpv4Subnet,
  readPortConfig,
  vlanSet,
  withPortCount,
} from './port-config';

describe('isIpv4Cidr', () => {
  it('accepts host addresses with a prefix of 8 to 30', () => {
    expect(isIpv4Cidr('192.168.10.1/24')).toBe(true);
    expect(isIpv4Cidr('172.16.0.1/30')).toBe(true);
    expect(isIpv4Cidr('10.1.2.3/8')).toBe(true);
  });

  it('refuses network and broadcast addresses, bad prefixes and malformed text', () => {
    expect(isIpv4Cidr('192.168.10.0/24')).toBe(false);
    expect(isIpv4Cidr('192.168.10.255/24')).toBe(false);
    expect(isIpv4Cidr('172.16.0.3/30')).toBe(false);
    expect(isIpv4Cidr('192.168.10.1/31')).toBe(false);
    expect(isIpv4Cidr('192.168.10.1/7')).toBe(false);
    expect(isIpv4Cidr('192.168.10.1')).toBe(false);
    expect(isIpv4Cidr('192.168.010.1/24')).toBe(false);
    expect(isIpv4Cidr('256.1.1.1/24')).toBe(false);
    expect(isIpv4Cidr('')).toBe(false);
  });

  it('accepts network addresses as VLAN subnets', () => {
    expect(isIpv4Subnet('192.168.10.0/24')).toBe(true);
    expect(isIpv4Subnet('192.168.10.0/31')).toBe(false);
  });
});

describe('port settings', () => {
  it('reads valid settings and defaults the role by handle', () => {
    const config = readPortConfig({
      port_config: { eth1: { role: 'dmz', address: '172.16.0.1/30', dhcp: true, untagged_vlan: 5000, tagged_vlans: [10, 0] } },
    });
    expect(config).toEqual({ eth1: { role: 'dmz', address: '172.16.0.1/30', dhcp: true, tagged_vlans: [10] } });
    expect(defaultRole('target-0')).toBe('wan');
    expect(defaultRole('eth2')).toBe('lan');
  });

  it('gives the sorted VLAN set of a port, or null', () => {
    const node = { type: 'switch', details: { port_config: { eth0: { untagged_vlan: 30, tagged_vlans: [20, 10] } } } };
    expect(vlanSet(node, 'eth0')).toEqual([10, 20, 30]);
    expect(vlanSet(node, 'eth1')).toBeNull();
    expect(vlanSet({ type: 'server', details: node.details }, 'eth0')).toBeNull();
  });
});

describe('withPortCount', () => {
  const router = {
    id: 'r1',
    type: 'router',
    details: { ports: 6, port_config: { eth3: { comment: 'nas' }, 'target-0': { role: 'wan' as const } } },
  };

  it('keeps every cabled port', () => {
    const edges = [
      { source: 'r1', sourceHandle: 'eth5', target: 'sw', targetHandle: 'target-0' },
      { source: 'ups', sourceHandle: 'pwr-out-0', target: 'r1', targetHandle: 'pwr-in-0' },
    ];
    expect(highestCabledPort('r1', edges)).toBe(5);
    const result = withPortCount(router, edges, 2);
    expect(result.count).toBe(6);
    expect(result.clamped).toBe(true);
    expect(result.details.ports).toBe(6);
  });

  it('prunes settings of removed ports', () => {
    const result = withPortCount(router, [], 3);
    expect(result).toEqual({
      details: { ports: 3, port_config: { 'target-0': { role: 'wan' } } },
      count: 3,
      clamped: false,
    });
    expect(router.details.port_config.eth3).toBeDefined();
  });

  it('drops an empty port_config and caps at 96', () => {
    const node = { id: 'r1', type: 'router', details: { port_config: { eth3: { comment: 'x' } } } };
    expect(withPortCount(node, [], 1).details).toEqual({ ports: 1 });
    expect(withPortCount(node, [], 200)).toMatchObject({ count: 96, clamped: true });
  });
});

describe('cableVlan', () => {
  const core = {
    type: 'switch',
    details: {
      vlans: [
        { id: 10, name: 'Servers', color: '#ef4444' },
        { id: 20, name: 'Clients', color: '#3b82f6' },
      ],
      port_config: { eth3: { untagged_vlan: 20, tagged_vlans: [10] } },
    },
  };

  it('takes the colour of the switch end untagged VLAN', () => {
    const edge = { type: 'switch', details: { port_config: { eth0: { tagged_vlans: [10, 20] } } } };
    expect(cableVlan(core, 'eth3', edge, 'eth0')).toEqual({ vlans: [10, 20], color: '#3b82f6', mismatch: false });
  });

  it('falls back to the lowest coloured id when the untagged VLAN is not shown', () => {
    const edge = { type: 'switch', details: { port_config: { eth0: { tagged_vlans: [10] } } } };
    expect(cableVlan(core, 'eth3', edge, 'eth0')).toEqual({ vlans: [10], color: '#ef4444', mismatch: false });
  });

  it('flags ends that share no VLAN', () => {
    const edge = { type: 'switch', details: { port_config: { eth0: { tagged_vlans: [30] } } } };
    expect(cableVlan(core, 'eth3', edge, 'eth0')).toEqual({ vlans: [], mismatch: true });
  });

  it('shows the one set there is and defaults empty handles', () => {
    const server = { type: 'server', details: {} };
    expect(cableVlan(server, null, core, 'eth3')).toEqual({ vlans: [10, 20], color: '#3b82f6', mismatch: false });
    const router = { type: 'router', details: { port_config: { eth0: { untagged_vlan: 10 } } } };
    expect(cableVlan(router, '', server, '')).toEqual({ vlans: [10], mismatch: false });
  });

  it('ignores power cables', () => {
    expect(cableVlan(core, 'pwr-out-0', core, 'pwr-in-0')).toEqual({ vlans: [], mismatch: false });
  });
});
