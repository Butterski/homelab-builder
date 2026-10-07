import type { InventoryItem } from '../api/inventory';

/** An inventory item for a test: a mini PC on the shelf unless said otherwise. */
export function makeItem(
  overrides: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>,
): InventoryItem {
  const item = {
    kind: 'device' as const,
    type: 'minipc',
    manufacturer: '',
    model: '',
    quantity: 1,
    status: 'available' as const,
    location: 'shelf' as const,
    specs: {},
    mac_addresses: [],
    power_draw: 0,
    notes: '',
    placements: [],
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    ...overrides,
  };
  // The server works the state out; a test that says nothing gets the status.
  return { ...item, state: overrides.state ?? item.status };
}

/** The inventory of the examples: two machines, a switch, memory, disks and cables. */
export const M75Q = makeItem({
  id: 'm75q',
  name: 'Lenovo M75q #1',
  manufacturer: 'Lenovo',
  model: 'ThinkCentre M75q',
  specs: {
    cpu_model: 'Ryzen 5 PRO 4650GE',
    cpu_cores: 6,
    cpu_threads: 12,
    ram_gb: 32,
    ram_type: 'DDR4 SODIMM',
    storage_gb: 240,
  },
  mac_addresses: ['AA:BB:CC:DD:EE:FF'],
  power_draw: 20,
});

export const SG108 = makeItem({
  id: 'sg108',
  name: 'TP-Link SG108',
  type: 'switch',
  specs: { ports: 8, port_speed: '1 GbE' },
});

export const RAM_KIT = makeItem({
  id: 'ram',
  name: '16 GB DDR4 SODIMM',
  kind: 'component',
  type: 'ram',
  quantity: 2,
  location: 'drawer',
  specs: { ram_gb: 16, ram_type: 'DDR4 SODIMM' },
});

export const NVME = makeItem({
  id: 'nvme',
  name: 'Samsung 970 EVO',
  kind: 'component',
  type: 'disk',
  quantity: 2,
  location: 'drawer',
  specs: { storage_gb: 1000, storage_type: 'NVMe' },
});

export const DAC = makeItem({
  id: 'dac',
  name: 'DAC 1 m',
  kind: 'accessory',
  type: 'dac',
  quantity: 3,
  location: 'drawer',
});
