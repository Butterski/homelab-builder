import { describe, expect, it } from 'vitest';
import type { HardwareNode } from '@/types';
import { DAC, M75Q, NVME, RAM_KIT, SG108, makeItem } from '../testing/items';
import {
  canBeInventoried,
  canvasUsage,
  countByStatus,
  countedName,
  filterItems,
  formatGB,
  groupItems,
  inventoryItemToDragData,
  isPlannable,
  itemAsComponent,
  itemFacts,
  keptWhere,
  modelLine,
  nodeToInventoryInput,
  placementOf,
  plannableItems,
  plannedElsewhere,
  ramAfterInstall,
  specFieldsOf,
  unitsLeft,
} from './inventory';
import { ramUpgradeHints, upgradeHintText } from './upgrade-hints';

const item = makeItem;
const m75q = M75Q;
const sg108 = SG108;
const ramKit = RAM_KIT;
const nvme = NVME;
const dac = DAC;

const host = (overrides: Partial<HardwareNode>): HardwareNode => ({
  id: 'host',
  type: 'minipc',
  name: 'pve02',
  x: 0,
  y: 0,
  details: { cpu: 6, ram: 16 },
  vms: [],
  internal_components: [],
  ...overrides,
});

describe('how an item reads', () => {
  it('says a machine in two lines, a switch by its ports, a module by its size', () => {
    expect(itemFacts(m75q)).toEqual(['Ryzen 5 PRO 4650GE', '32 GB / 240 GB']);
    expect(itemFacts(sg108)).toEqual(['8 × 1 GbE']);
    expect(itemFacts(ramKit)).toEqual(['16 GB DDR4 SODIMM']);
    expect(itemFacts(nvme)).toEqual(['1 TB NVMe']);
    expect(itemFacts(dac)).toEqual([]);
    expect(itemFacts(item({ id: 'x', name: 'Box', specs: { cpu_threads: 4, ram_gb: 8 } }))).toEqual(
      ['4 threads', '8 GB'],
    );
  });

  it('names the hardware by box and processor', () => {
    expect(modelLine(m75q)).toBe('Lenovo ThinkCentre M75q (Ryzen 5 PRO 4650GE)');
    expect(modelLine(sg108)).toBe('');
    expect(modelLine(item({ id: 'x', name: 'Box', specs: { cpu_model: 'N100' } }))).toBe('N100');
    expect(countedName('16 GB DDR4', 2)).toBe('2× 16 GB DDR4');
    expect(countedName('M75q', 1)).toBe('M75q');
    expect(formatGB(240)).toBe('240 GB');
    expect(formatGB(1000)).toBe('1 TB');
    expect(formatGB(1500)).toBe('1.5 TB');
    expect(formatGB(0)).toBe('');
  });

  it('asks for the figures a thing has', () => {
    expect(specFieldsOf('minipc')).toEqual(['cpu', 'ram', 'storage', 'macs']);
    expect(specFieldsOf('switch')).toContain('ports');
    expect(specFieldsOf('ram')).toEqual(['ram']);
    expect(specFieldsOf('dac')).toEqual([]);
  });
});

describe('placing an item on a canvas', () => {
  it('knows where a thing can go', () => {
    expect(placementOf(m75q)).toBe('node');
    expect(placementOf(ramKit)).toBe('inside');
    expect(placementOf(item({ id: 'cpu', name: 'i5', kind: 'component', type: 'cpu' }))).toBe(
      'none',
    );
    expect(placementOf(dac)).toBe('none');
    expect(isPlannable(item({ id: 'x', name: 'x', status: 'sold' }))).toBe(false);
    expect(isPlannable(item({ id: 'x', name: 'x', status: 'reserved' }))).toBe(true);
  });

  it('turns a device into a node that is that machine', () => {
    const data = inventoryItemToDragData(m75q);
    expect(data).toMatchObject({
      type: 'minipc',
      name: 'Lenovo M75q #1',
      mac_address: 'AA:BB:CC:DD:EE:FF',
      power_draw: 20,
      inventory: { id: 'm75q', kind: 'device', units: 1 },
    });
    // Guests are given threads, so that is what the canvas counts.
    expect(data.details).toEqual({
      inventory_item_id: 'm75q',
      inventory_label: 'Lenovo M75q #1',
      model: 'Lenovo ThinkCentre M75q (Ryzen 5 PRO 4650GE)',
      cpu: 12,
      ram: 32,
      ram_type: 'DDR4 SODIMM',
      storage: 240,
    });
    expect(inventoryItemToDragData(sg108).details).toMatchObject({
      ports: 8,
      inventory_item_id: 'sg108',
    });
  });

  it('turns a kit of memory into one component that says how many modules it is', () => {
    const component = itemAsComponent(ramKit, 2);
    expect(component).toMatchObject({
      type: 'ram',
      name: '2× 16 GB DDR4 SODIMM',
      details: {
        inventory_item_id: 'ram',
        inventory_quantity: 2,
        ram: 32,
        ram_type: 'DDR4 SODIMM',
      },
    });
    expect(component.id).toMatch(/[0-9a-f-]{36}/);
    // A disk goes in one at a time; a network card is a card.
    expect(itemAsComponent(nvme, 1)).toMatchObject({
      type: 'disk',
      name: 'Samsung 970 EVO',
      details: { storage: 1000, inventory_quantity: 1 },
    });
    expect(
      itemAsComponent(
        item({ id: 'nic', name: 'X520', kind: 'component', type: 'nic', specs: { ports: 2 } }),
        1,
      ).type,
    ).toBe('pcie');
  });

  it('reads from a canvas what it uses and what is left', () => {
    const nodes = [
      host({ id: 'a', name: 'proxmox-01', details: { inventory_item_id: 'm75q' } }),
      host({
        id: 'b',
        name: 'pve02',
        internal_components: [
          {
            id: 'c1',
            type: 'ram',
            name: '2× 16 GB',
            details: { inventory_item_id: 'ram', inventory_quantity: 2 },
          },
          {
            id: 'c2',
            type: 'disk',
            name: 'Samsung 970 EVO',
            details: { inventory_item_id: 'nvme' },
          },
        ],
      }),
    ];
    const usage = canvasUsage(nodes);
    expect(usage.get('m75q')).toEqual({
      units: 1,
      nodes: [{ id: 'a', name: 'proxmox-01', inside: false }],
    });
    expect(usage.get('ram')?.units).toBe(2);
    expect(usage.get('nvme')).toEqual({
      units: 1,
      nodes: [{ id: 'b', name: 'pve02', inside: true }],
    });

    expect(unitsLeft(m75q, usage)).toBe(0);
    expect(unitsLeft(ramKit, usage)).toBe(0);
    expect(unitsLeft(nvme, usage)).toBe(1);
    expect(unitsLeft(sg108, usage)).toBe(1);
  });

  it('lists beside the canvas what can be planned with, machines first', () => {
    const sold = item({ id: 'old', name: 'Old NAS', type: 'nas', status: 'sold' });
    expect(plannableItems([dac, nvme, sold, sg108, m75q, ramKit]).map(entry => entry.id)).toEqual([
      'm75q',
      'sg108',
      'ram',
      'nvme',
    ]);
  });

  it('describes a device of the canvas as the item it would be', () => {
    const input = nodeToInventoryInput(
      host({
        name: 'pve02',
        mac_address: '00:11:22:33:44:55',
        power_draw: 35,
        details: { cpu: 6, ram: 16, storage: 512, model: 'M920q', ram_type: 'DDR4 SODIMM' },
      }),
    );
    expect(input).toMatchObject({
      kind: 'device',
      type: 'minipc',
      name: 'pve02',
      model: 'M920q',
      specs: { cpu_threads: 6, ram_gb: 16, storage_gb: 512, ram_type: 'DDR4 SODIMM' },
      mac_addresses: ['00:11:22:33:44:55'],
      power_draw: 35,
    });
    expect(nodeToInventoryInput(host({ type: 'server' })).type).toBe('server_v2');
    expect(canBeInventoried('switch')).toBe(true);
    expect(canBeInventoried('lan_table')).toBe(false);
    expect(canBeInventoried('disk')).toBe(false);
  });
});

describe('the full list', () => {
  const all = [
    m75q,
    sg108,
    ramKit,
    nvme,
    dac,
    item({ id: 'old', name: 'Old NAS', type: 'nas', status: 'sold', location: 'storage' }),
  ];

  it('groups by where things are kept, or by what they are, and leaves empty groups out', () => {
    expect(groupItems(all, 'location').map(group => [group.label, group.items.length])).toEqual([
      ['Shelf', 2],
      ['Drawer', 3],
      ['Storage', 1],
    ]);
    expect(groupItems(all, 'kind').map(group => [group.label, group.items.length])).toEqual([
      ['Devices', 3],
      ['Components', 2],
      ['Accessories', 1],
    ]);
  });

  it('filters by state and by any word of an item', () => {
    expect(filterItems(all, { status: 'sold' }).map(entry => entry.id)).toEqual(['old']);
    expect(filterItems(all, { search: 'ryzen' }).map(entry => entry.id)).toEqual(['m75q']);
    expect(filterItems(all, { search: 'ddr4 16' }).map(entry => entry.id)).toEqual(['ram']);
    expect(filterItems(all, { search: 'switch' }).map(entry => entry.id)).toEqual(['sg108']);
    expect(filterItems(all, { search: '  ' })).toHaveLength(all.length);
    expect(countByStatus(all)).toEqual({
      available: 5,
      in_use: 0,
      reserved: 0,
      broken: 0,
      sold: 1,
    });
  });

  it('counts and filters by how an item stands, not by what was last written down', () => {
    // The owner never marked the machine; a project plans it, so the server lists it as in use.
    const planned = { ...m75q, state: 'in_use' as const };
    expect(planned.status).toBe('available');
    expect(countByStatus([planned, sg108])).toMatchObject({ available: 1, in_use: 1 });
    expect(filterItems([planned, sg108], { status: 'in_use' }).map(entry => entry.id)).toEqual([
      'm75q',
    ]);
    expect(filterItems([planned, sg108], { status: 'available' }).map(entry => entry.id)).toEqual([
      'sg108',
    ]);
    // It can still be planned with: another project may be a variant of this one.
    expect(plannableItems([planned]).map(entry => entry.id)).toEqual(['m75q']);
  });

  it('names the other projects that plan an item, each once', () => {
    const place = (build: string, name: string) => ({
      build_id: build,
      build_name: name,
      node_id: `${build}-node`,
      node_name: 'pve01',
      component: false,
      quantity: 1,
    });
    const planned = {
      ...m75q,
      placements: [
        place('b1', 'Main Homelab'),
        place('b2', 'Future Upgrade'),
        place('b2', 'Future Upgrade'),
      ],
    };
    expect(plannedElsewhere(planned, 'b1')).toEqual(['Future Upgrade']);
    expect(plannedElsewhere(planned, null)).toEqual(['Main Homelab', 'Future Upgrade']);
    expect(plannedElsewhere(sg108, 'b1')).toEqual([]);
  });

  it('says where a thing is kept the way a sentence needs it', () => {
    expect(['rack', 'shelf', 'drawer', 'storage', 'other'].map(keptWhere)).toEqual([
      'in the rack',
      'on the shelf',
      'in a drawer',
      'in storage',
      'elsewhere',
    ]);
  });
});

describe('memory the owner already has', () => {
  const guests = (ramMb: number) => [
    {
      id: 'g',
      name: 'vm',
      type: 'vm' as const,
      status: 'running' as const,
      cpu_cores: 2,
      ram_mb: ramMb,
    },
  ];

  it('replaces what is fitted when the kit is at least as large, and is added otherwise', () => {
    expect(ramAfterInstall(16, 32)).toBe(32);
    expect(ramAfterInstall(16, 16)).toBe(16);
    expect(ramAfterInstall(64, 32)).toBe(96);
    expect(ramAfterInstall(0, 16)).toBe(16);
  });

  it('offers spare memory to a host that is short of it', () => {
    const short = host({
      vms: guests(24 * 1024),
      details: { cpu: 6, ram: 16, ram_type: 'DDR4 SODIMM' },
    });
    const [hint] = ramUpgradeHints([short], [m75q, ramKit], new Map());
    expect(hint).toMatchObject({
      nodeId: 'host',
      haveGb: 16,
      needGb: 24,
      units: 2,
      resultGb: 32,
      fits: true,
    });
    expect(upgradeHintText(hint)).toBe(
      'pve02 gives its guests 24 GB and has 16 GB. You own 2× 16 GB DDR4 SODIMM (drawer): with it the host has 32 GB. Nothing to buy.',
    );
  });

  it('offers nothing where nothing is short, nothing fits, or the memory is gone', () => {
    const fine = host({ vms: guests(8 * 1024) });
    expect(ramUpgradeHints([fine], [ramKit], new Map())).toEqual([]);

    const short = host({
      vms: guests(24 * 1024),
      details: { cpu: 6, ram: 16, ram_type: 'DDR5 SODIMM' },
    });
    expect(ramUpgradeHints([short], [ramKit], new Map())).toEqual([]);

    // Not enough to cover the need.
    const hungry = host({ vms: guests(100 * 1024) });
    expect(ramUpgradeHints([hungry], [ramKit], new Map())).toEqual([]);

    // Already in another machine of this canvas, sold, or not memory at all.
    const used = new Map([['ram', { units: 2, nodes: [] }]]);
    const needy = host({ vms: guests(24 * 1024) });
    expect(ramUpgradeHints([needy], [ramKit], used)).toEqual([]);
    expect(ramUpgradeHints([needy], [{ ...ramKit, status: 'sold' }, nvme], new Map())).toEqual([]);
  });

  it('says so when it cannot tell that the memory fits, and gives one kit to one host', () => {
    const a = host({ id: 'a', name: 'a', vms: guests(24 * 1024) });
    const b = host({ id: 'b', name: 'b', vms: guests(24 * 1024) });
    const hints = ramUpgradeHints([a, b], [ramKit], new Map());
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ nodeId: 'a', fits: false });
  });
});
