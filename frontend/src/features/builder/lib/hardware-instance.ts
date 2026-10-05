import type { HardwareNode } from '../../../types';
import { remapVirtualEndpoints } from './virtual-network';

// Blueprint and copied nodes carry VM/component IDs that already exist elsewhere or
// are not UUIDs. The backend replaces non-UUID IDs on save, so the IPs it assigns
// could never be matched back onto local VMs. Every placed node gets its own IDs.
export function withFreshChildIds(node: HardwareNode): HardwareNode {
  const vmIds = new Map<string, string>();
  const vms = (node.vms ?? []).map(vm => {
    const id = crypto.randomUUID();
    if (!vmIds.has(vm.id)) vmIds.set(vm.id, id);
    return { ...vm, id };
  });
  const network = node.details?.virtual_network;

  return {
    ...node,
    vms,
    internal_components: (node.internal_components ?? []).map(component => ({
      ...component,
      id: crypto.randomUUID(),
    })),
    ...(network
      ? { details: { ...node.details, virtual_network: remapVirtualEndpoints(network, vmIds) } }
      : {}),
  };
}
