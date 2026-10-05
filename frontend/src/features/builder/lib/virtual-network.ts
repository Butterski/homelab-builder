import type { HardwareNode, VirtualNetwork } from '../../../types';

export const UPLINK_ID = 'uplink';

export function initialVirtualNetwork(host: HardwareNode): VirtualNetwork {
  return {
    switches: [{ id: 'bridge-0', name: 'vmbr0', x: 280, y: 180 }],
    positions: {},
    edges: [
      { id: 'uplink-bridge', source: UPLINK_ID, target: 'bridge-0' },
      ...(host.vms || []).map(vm => ({ id: `bridge-${vm.id}`, source: 'bridge-0', target: vm.id })),
    ],
  };
}

export function connectedVirtualMachines(network: VirtualNetwork): Set<string> {
  const switches = new Set(network.switches.map(node => node.id));
  const reached = new Set([UPLINK_ID]);
  const queue = [UPLINK_ID];
  for (let i = 0; i < queue.length; i++) {
    for (const edge of network.edges) {
      const next =
        edge.source === queue[i] ? edge.target : edge.target === queue[i] ? edge.source : null;
      if (!next || reached.has(next)) continue;
      reached.add(next);
      // A VM is an endpoint. It does not forward traffic between switches.
      if (switches.has(next)) queue.push(next);
    }
  }
  return reached;
}

export function remapVirtualEndpoints(
  network: VirtualNetwork,
  ids: Map<string, string>,
): VirtualNetwork {
  const remap = (id: string) => ids.get(id) ?? id;
  return {
    switches: network.switches,
    positions: Object.fromEntries(
      Object.entries(network.positions).map(([id, position]) => [remap(id), position]),
    ),
    edges: network.edges.map(edge => ({
      ...edge,
      source: remap(edge.source),
      target: remap(edge.target),
    })),
  };
}

export function removeVirtualEndpoints(network: VirtualNetwork, ids: Set<string>): VirtualNetwork {
  return {
    switches: network.switches.filter(node => !ids.has(node.id)),
    positions: Object.fromEntries(Object.entries(network.positions).filter(([id]) => !ids.has(id))),
    edges: network.edges.filter(edge => !ids.has(edge.source) && !ids.has(edge.target)),
  };
}
