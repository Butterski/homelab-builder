import { describe, expect, it } from 'vitest';
import {
  connectedVirtualMachines,
  initialVirtualNetwork,
  removeVirtualEndpoints,
} from './virtual-network';
import type { HardwareNode } from '../../../types';

const host: HardwareNode = {
  id: 'host',
  name: 'Hypervisor',
  type: 'server',
  x: 0,
  y: 0,
  vms: [{ id: 'vm-1', name: 'App', type: 'vm', status: 'running' }],
};

describe('virtual networks', () => {
  it('shows the existing host connections on first open', () => {
    expect(connectedVirtualMachines(initialVirtualNetwork(host)).has('vm-1')).toBe(true);
  });
  it('disconnects VMs when a switch is removed and cleans saved positions', () => {
    const network = initialVirtualNetwork(host);
    network.positions['bridge-0'] = { x: 30, y: 90 };
    const removed = removeVirtualEndpoints(network, new Set(['bridge-0']));
    expect(removed.edges).toEqual([]);
    expect(removed.positions).toEqual({});
    expect(connectedVirtualMachines(removed).has('vm-1')).toBe(false);
  });
  it('does not treat a VM as a switch', () => {
    const network = initialVirtualNetwork(host);
    network.edges.push({ id: 'vm-peer', source: 'vm-1', target: 'vm-2' });
    expect(connectedVirtualMachines(network).has('vm-2')).toBe(false);
  });
});
