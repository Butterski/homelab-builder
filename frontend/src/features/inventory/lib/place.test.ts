import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/builder/api/builds', () => ({ buildApi: {} }));
vi.mock('@/features/builder/api/proposals', () => ({ proposalApi: {} }));
vi.mock('@/services/api', () => ({
  api: { getServices: vi.fn().mockResolvedValue({ data: [] }) },
}));

import type { HardwareNode } from '@/types';
import { useBuilderStore } from '@/features/builder/store/builder-store';
import { M75Q, NVME, RAM_KIT } from '../testing/items';
import { inventoryItemToDragData } from './inventory';
import { installItem, nodeOfItem, placeDevice, placeDeviceFromItem } from './place';

const host = (overrides: Partial<HardwareNode> = {}): HardwareNode => ({
  id: 'host-1',
  type: 'minipc',
  name: 'pve02',
  x: 100,
  y: 100,
  details: { cpu: 6, ram: 16 },
  vms: [],
  internal_components: [],
  ...overrides,
});

const store = () => useBuilderStore.getState();

beforeEach(() => {
  store().clearCurrentBuild();
  useBuilderStore.setState({ currentBuildId: 'build-1', buildStatus: 'ready' });
});

describe('placing what one owns', () => {
  it('puts a device on the canvas as a node that is that machine', () => {
    const result = placeDeviceFromItem(M75Q);
    expect(result.ok).toBe(true);

    const [node] = store().hardwareNodes;
    expect(node).toMatchObject({
      type: 'minipc',
      name: 'Lenovo M75q #1',
      mac_address: 'AA:BB:CC:DD:EE:FF',
      power_draw: 20,
      details: { inventory_item_id: 'm75q', inventory_label: 'Lenovo M75q #1', cpu: 12, ram: 32 },
    });
    // The canvas draws it, and it is what a save sends.
    expect(store().nodes).toHaveLength(1);
    expect(store().getBuildData().nodes[0].details.inventory_item_id).toBe('m75q');
    expect(nodeOfItem('m75q')?.id).toBe(node.id);
  });

  it('shows a machine that is on the canvas already instead of placing it twice', () => {
    placeDeviceFromItem(M75Q);
    const first = store().hardwareNodes[0];
    store().updateHardware(first.id, { name: 'proxmox-01' });

    const again = placeDevice(inventoryItemToDragData(M75Q), { x: 500, y: 500 });
    expect(again.ok).toBe(false);
    expect(again.message).toBe('Lenovo M75q #1 is on this canvas already, as proxmox-01.');
    expect(store().hardwareNodes).toHaveLength(1);
    expect(store().selectedNodeId).toBe(first.id);
    expect(store().canvasFocus?.ids).toEqual([first.id]);
  });

  it('puts memory into a host and gives the host that memory, as one undo step', () => {
    store().addHardware(host());
    const before = store().historyPast.length;

    const result = installItem('host-1', RAM_KIT, 2);
    expect(result).toEqual({
      ok: true,
      message: 'Put 2× 16 GB DDR4 SODIMM into pve02: it now has 32 GB.',
    });

    const upgraded = store().hardwareNodes[0];
    // A kit as large as what was fitted takes its place.
    expect(upgraded.details).toMatchObject({ ram: 32, ram_type: 'DDR4 SODIMM' });
    expect(upgraded.internal_components).toHaveLength(1);
    expect(upgraded.internal_components?.[0]).toMatchObject({
      type: 'ram',
      details: { inventory_item_id: 'ram', inventory_quantity: 2 },
    });
    expect(store().historyPast.length).toBe(before + 1);

    store().undo();
    expect(store().hardwareNodes[0].details?.ram).toBe(16);
    expect(store().hardwareNodes[0].internal_components).toHaveLength(0);
  });

  it('adds a smaller kit to what is fitted, and a disk without touching the memory', () => {
    store().addHardware(host({ details: { cpu: 16, ram: 64 } }));
    installItem('host-1', RAM_KIT, 2);
    expect(store().hardwareNodes[0].details?.ram).toBe(96);

    const disk = installItem('host-1', NVME, 1);
    expect(disk.message).toBe('Put Samsung 970 EVO into pve02.');
    expect(store().hardwareNodes[0].details?.ram).toBe(96);
    expect(store().hardwareNodes[0].internal_components?.map(component => component.type)).toEqual([
      'ram',
      'disk',
    ]);
  });

  it('refuses what is not a machine', () => {
    store().addHardware(host({ id: 'sw', type: 'switch', name: 'Switch', details: { ports: 8 } }));
    expect(installItem('sw', RAM_KIT, 2).ok).toBe(false);
    expect(installItem('nowhere', RAM_KIT, 2).ok).toBe(false);
    expect(store().hardwareNodes[0].internal_components).toHaveLength(0);
  });
});

describe('a copy of a device', () => {
  it('is another device: it does not stand for the same machine or hold the same parts', () => {
    placeDeviceFromItem(M75Q);
    const original = store().hardwareNodes[0];
    installItem(original.id, NVME, 1);

    store().duplicateHardware(original.id);
    const copy = store().hardwareNodes[1];
    expect(copy.name).toBe('Lenovo M75q #1 (copy)');
    expect(copy.details?.inventory_item_id).toBeUndefined();
    expect(copy.details?.inventory_label).toBeUndefined();
    expect(copy.mac_address).toBe('');
    // What the machine is made of is copied; whose it is, is not.
    expect(copy.details).toMatchObject({ cpu: 12, ram: 32 });
    expect(copy.internal_components?.[0].details?.inventory_item_id).toBeUndefined();
    expect(store().hardwareNodes[0].details?.inventory_item_id).toBe('m75q');
  });
});
