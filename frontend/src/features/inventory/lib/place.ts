import type { HardwareComponent, HardwareNode } from '@/types';
import { canNodeHostNested } from '@/lib/hardware-config';
import { useBuilderStore } from '@/features/builder/store/builder-store';
import { withFreshChildIds } from '@/features/builder/lib/hardware-instance';
import type { InventoryItem } from '../api/inventory';
import {
  type InventoryDragData,
  formatGB,
  inventoryItemToDragData,
  itemAsComponent,
  ramAfterInstall,
} from './inventory';

/** What placing something from the inventory led to, in words for a toast. */
export type PlaceResult = { ok: boolean; message: string };

/** The node on the open canvas that already stands for an item. */
export function nodeOfItem(itemId: string): HardwareNode | undefined {
  return useBuilderStore
    .getState()
    .hardwareNodes.find(node => node.details?.inventory_item_id === itemId);
}

/**
 * Puts an owned device on the canvas. One physical machine is one node: a
 * device that is on the canvas already is shown, not placed again.
 */
export function placeDevice(
  data: InventoryDragData,
  position: { x: number; y: number },
  extra: Partial<HardwareNode> = {},
): PlaceResult {
  const store = useBuilderStore.getState();
  const existing = nodeOfItem(data.inventory.id);
  if (existing) {
    store.selectNode(existing.id);
    store.requestCanvasFocus([existing.id]);
    return {
      ok: false,
      message: `${data.details.inventory_label ?? data.name} is on this canvas already, as ${existing.name}.`,
    };
  }
  store.addHardware(
    withFreshChildIds({
      id: crypto.randomUUID(),
      type: data.type as HardwareNode['type'],
      name: data.name,
      x: position.x,
      y: position.y,
      details: data.details,
      mac_address: data.mac_address,
      power_draw: data.power_draw,
      internal_components: [],
      vms: [],
      ...extra,
    }),
  );
  return { ok: true, message: `Added ${data.name} from your inventory.` };
}

/** Puts an owned device where the library puts what is clicked rather than dragged. */
export function placeDeviceFromItem(item: InventoryItem): PlaceResult {
  const index = useBuilderStore.getState().hardwareNodes.length;
  return placeDevice(inventoryItemToDragData(item), {
    x: 180 + (index % 4) * 250,
    y: 160 + Math.floor(index / 4) * 190,
  });
}

/**
 * Puts an owned component into a host. Memory also changes what the host has:
 * a kit at least as large as what is fitted takes its place, a smaller one is
 * added. Both happen in one undo step.
 */
export function installComponent(hostId: string, component: HardwareComponent): PlaceResult {
  const store = useBuilderStore.getState();
  const host = store.hardwareNodes.find(node => node.id === hostId);
  if (!host || !canNodeHostNested(host.type)) {
    return {
      ok: false,
      message: 'Drop it on a server, PC, mini PC or NAS: a component goes inside a machine.',
    };
  }
  // Adding the component records the undo step; the memory figure rides along.
  store.addInternalComponent(hostId, component);
  if (component.type !== 'ram') {
    return { ok: true, message: `Put ${component.name} into ${host.name}.` };
  }
  const kitGb = Number(component.details?.ram) || 0;
  const current = Number(host.details?.ram) || 0;
  const next = ramAfterInstall(current, kitGb);
  const details =
    useBuilderStore.getState().hardwareNodes.find(node => node.id === hostId)?.details ?? {};
  store.updateHardware(hostId, {
    details: { ...details, ram: next, ram_type: details.ram_type ?? component.details?.ram_type },
  });
  return {
    ok: true,
    message: `Put ${component.name} into ${host.name}: it now has ${formatGB(next)}.`,
  };
}

/** Puts units of an owned component into a host. */
export function installItem(hostId: string, item: InventoryItem, units: number): PlaceResult {
  return installComponent(hostId, itemAsComponent(item, units));
}
