import { describe, expect, it } from 'vitest';
import { withFreshChildIds } from './hardware-instance';
import { initialVirtualNetwork } from './virtual-network';
import type { HardwareNode } from '../../../types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const template: HardwareNode = {
  id: 'node',
  type: 'server',
  name: 'Blueprint host',
  x: 0,
  y: 0,
  vms: [{ id: 'vm-svc-1', name: 'Pi-hole', type: 'container', status: 'running' }],
  internal_components: [{ id: 'component-1', type: 'disk', name: 'SSD' }],
};

describe('withFreshChildIds', () => {
  it('gives VMs and components UUIDs the backend keeps', () => {
    const node = withFreshChildIds(template);
    expect(node.vms![0].id).toMatch(UUID);
    expect(node.internal_components![0].id).toMatch(UUID);
    expect(node.vms![0].name).toBe('Pi-hole');
  });

  it('never reuses IDs when the same template is placed twice', () => {
    const first = withFreshChildIds(template);
    const second = withFreshChildIds(template);
    expect(first.vms![0].id).not.toBe(second.vms![0].id);
    expect(first.internal_components![0].id).not.toBe(second.internal_components![0].id);
  });

  it('keeps virtual network links pointing at the renamed VMs', () => {
    const network = initialVirtualNetwork(template);
    network.positions['vm-svc-1'] = { x: 10, y: 20 };
    const node = withFreshChildIds({ ...template, details: { virtual_network: network } });
    const vmId = node.vms![0].id;
    const remapped = node.details!.virtual_network!;
    expect(remapped.edges.some(edge => edge.target === vmId)).toBe(true);
    expect(remapped.edges.some(edge => edge.target === 'vm-svc-1')).toBe(false);
    expect(remapped.positions[vmId]).toEqual({ x: 10, y: 20 });
  });
});
