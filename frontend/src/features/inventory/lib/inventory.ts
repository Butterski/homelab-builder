import type {
  ComponentType,
  HardwareComponent,
  HardwareNode,
  HardwareSpec,
  HardwareType,
} from '@/types';
import { assetIdOf } from '@/lib/asset-link';
import type {
  InventoryInput,
  InventoryItem,
  InventoryKind,
  InventoryLocation,
  InventorySpecs,
  InventoryStatus,
} from '../api/inventory';

// Kinds, types, states and places mirror backend/internal/inventory. Change them together.

export const KINDS: { id: InventoryKind; label: string; plural: string }[] = [
  { id: 'device', label: 'Device', plural: 'Devices' },
  { id: 'component', label: 'Component', plural: 'Components' },
  { id: 'accessory', label: 'Accessory', plural: 'Accessories' },
];

/** A device type is also the node type it becomes on the canvas. */
export const TYPES: Record<InventoryKind, { id: string; label: string }[]> = {
  device: [
    { id: 'server_v2', label: 'Server' },
    { id: 'minipc', label: 'Mini PC' },
    { id: 'pc', label: 'PC' },
    { id: 'sbc', label: 'Single-board computer' },
    { id: 'nas', label: 'NAS' },
    { id: 'router', label: 'Router' },
    { id: 'switch', label: 'Switch' },
    { id: 'firewall', label: 'Firewall' },
    { id: 'access_point', label: 'Access point' },
    { id: 'modem', label: 'Modem' },
    { id: 'ups', label: 'UPS' },
    { id: 'pdu', label: 'PDU' },
    { id: 'rack', label: 'Rack' },
    { id: 'console', label: 'Console' },
    { id: 'iot', label: 'IoT device' },
  ],
  component: [
    { id: 'ram', label: 'Memory' },
    { id: 'disk', label: 'Disk' },
    { id: 'gpu', label: 'Graphics card' },
    { id: 'nic', label: 'Network card' },
    { id: 'hba', label: 'HBA' },
    { id: 'cpu', label: 'Processor' },
  ],
  accessory: [
    { id: 'dac', label: 'DAC cable' },
    { id: 'sfp', label: 'SFP module' },
    { id: 'cable', label: 'Cable' },
    { id: 'rack_shelf', label: 'Rack shelf' },
    { id: 'power_adapter', label: 'Power adapter' },
    { id: 'other', label: 'Other' },
  ],
};

export const STATUSES: { id: InventoryStatus; label: string }[] = [
  { id: 'available', label: 'Available' },
  { id: 'in_use', label: 'In use' },
  { id: 'reserved', label: 'Reserved' },
  { id: 'broken', label: 'Broken' },
  { id: 'sold', label: 'Sold' },
];

export const LOCATIONS: { id: InventoryLocation; label: string }[] = [
  { id: 'rack', label: 'Rack' },
  { id: 'shelf', label: 'Shelf' },
  { id: 'drawer', label: 'Drawer' },
  { id: 'storage', label: 'Storage' },
  { id: 'other', label: 'Elsewhere' },
];

const labelIn = (list: { id: string; label: string }[], id: string) =>
  list.find(entry => entry.id === id)?.label ?? id.replace(/_/g, ' ');

export const typeLabel = (kind: InventoryKind, type: string) => labelIn(TYPES[kind] ?? [], type);
export const statusLabel = (status: string) => labelIn(STATUSES, status);
export const locationLabel = (location: string) => labelIn(LOCATIONS, location);

const KEPT: Record<string, string> = {
  rack: 'in the rack',
  shelf: 'on the shelf',
  drawer: 'in a drawer',
  storage: 'in storage',
  other: 'elsewhere',
};

/** Where an item is kept, as it reads in a sentence: "in the rack", "on the shelf". */
export const keptWhere = (location: string) =>
  KEPT[location] ?? locationLabel(location).toLowerCase();

/** Which figures an item of a type has, and so which fields its form shows. */
export type SpecField = 'cpu' | 'ram' | 'storage' | 'ports' | 'rack_units' | 'rack_size' | 'macs';

const COMPUTE_TYPES = new Set(['server_v2', 'minipc', 'pc', 'sbc', 'nas']);

const SPEC_FIELDS: Record<string, SpecField[]> = {
  server_v2: ['cpu', 'ram', 'storage', 'rack_units', 'macs'],
  minipc: ['cpu', 'ram', 'storage', 'macs'],
  pc: ['cpu', 'ram', 'storage', 'macs'],
  sbc: ['cpu', 'ram', 'storage', 'macs'],
  nas: ['cpu', 'ram', 'storage', 'rack_units', 'macs'],
  router: ['ports', 'rack_units', 'macs'],
  switch: ['ports', 'rack_units', 'macs'],
  firewall: ['ports', 'rack_units', 'macs'],
  modem: ['ports', 'macs'],
  access_point: ['macs'],
  ups: ['rack_units'],
  pdu: ['rack_units'],
  rack: ['rack_size'],
  console: ['macs'],
  iot: ['macs'],
  ram: ['ram'],
  disk: ['storage'],
  gpu: ['ram'],
  nic: ['ports'],
  hba: ['ports'],
  cpu: ['cpu'],
};

export const specFieldsOf = (type: string): SpecField[] => SPEC_FIELDS[type] ?? [];

/** What an owned component is inside a host on the canvas. A processor has no such form. */
const COMPONENT_NODE_TYPES: Record<string, ComponentType> = {
  ram: 'ram',
  disk: 'disk',
  gpu: 'gpu',
  nic: 'pcie',
  hba: 'hba',
};

/** Where an item can go on a canvas: as a device, inside one, or nowhere. */
export function placementOf(
  item: Pick<InventoryItem, 'kind' | 'type'>,
): 'node' | 'inside' | 'none' {
  if (item.kind === 'device') return 'node';
  if (item.kind === 'component' && COMPONENT_NODE_TYPES[item.type]) return 'inside';
  return 'none';
}

/** Something broken or sold is kept on the list, not planned with. */
export const isPlannable = (item: Pick<InventoryItem, 'status'>) =>
  item.status !== 'broken' && item.status !== 'sold';

/** Sizes are written the way the canvas writes them: 1000 GB is 1 TB. */
export function formatGB(gb: number): string {
  if (!Number.isFinite(gb) || gb <= 0) return '';
  if (gb >= 1000) {
    const tb = gb / 1000;
    return `${Number.isInteger(tb) ? tb : tb.toFixed(1)} TB`;
  }
  return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
}

/** Manufacturer and model, and the processor where that says more than the box does. */
export function modelLine(item: Pick<InventoryItem, 'manufacturer' | 'model' | 'specs'>): string {
  const box = `${item.manufacturer ?? ''} ${item.model ?? ''}`.trim();
  const cpu = item.specs?.cpu_model ?? '';
  if (box && cpu) return `${box} (${cpu})`;
  return box || cpu;
}

/** The threads a host offers its guests; cores where threads are not noted. */
export const logicalCpus = (specs: InventorySpecs) => specs.cpu_threads || specs.cpu_cores || 0;

/** An item in two short lines, the way it is listed beside the canvas. */
export function itemFacts(item: InventoryItem): string[] {
  const specs = item.specs ?? {};
  const facts: string[] = [];
  const sizes = [
    specs.ram_gb ? formatGB(specs.ram_gb) : '',
    specs.storage_gb ? formatGB(specs.storage_gb) : '',
  ];

  if (item.kind === 'device' && COMPUTE_TYPES.has(item.type)) {
    if (specs.cpu_model) facts.push(specs.cpu_model);
    else if (logicalCpus(specs)) facts.push(`${logicalCpus(specs)} threads`);
    if (sizes.some(Boolean)) facts.push(sizes.filter(Boolean).join(' / '));
  } else if (specs.ports) {
    facts.push(`${specs.ports} × ${specs.port_speed || 'ports'}`);
  } else if (item.type === 'ram' && specs.ram_gb) {
    facts.push([formatGB(specs.ram_gb), specs.ram_type].filter(Boolean).join(' '));
  } else if (item.type === 'disk' && specs.storage_gb) {
    facts.push([formatGB(specs.storage_gb), specs.storage_type].filter(Boolean).join(' '));
  } else if (item.type === 'gpu' && specs.ram_gb) {
    facts.push(`${formatGB(specs.ram_gb)} VRAM`);
  } else if (item.type === 'cpu') {
    if (specs.cpu_model) facts.push(specs.cpu_model);
    if (specs.cpu_cores || specs.cpu_threads) {
      facts.push(
        [
          specs.cpu_cores && `${specs.cpu_cores} cores`,
          specs.cpu_threads && `${specs.cpu_threads} threads`,
        ]
          .filter(Boolean)
          .join(' / '),
      );
    }
  } else if (item.type === 'rack' && specs.rack_size) {
    facts.push(`${specs.rack_size}U`);
  }
  if (facts.length === 0) {
    const box = `${item.manufacturer ?? ''} ${item.model ?? ''}`.trim();
    if (box) facts.push(box);
  }
  return facts;
}

/** "2× 16 GB DDR4" for a kit, the plain name for one of a thing. */
export const countedName = (name: string, units: number) =>
  units > 1 ? `${units}× ${name}` : name;

/** How an item is used on one canvas. */
export type CanvasUse = {
  units: number;
  /** The devices it is, or sits in. */
  nodes: { id: string; name: string; inside: boolean }[];
};

/** Reads from a canvas which inventory items it uses, and how many units of each. */
export function canvasUsage(hardwareNodes: HardwareNode[]): Map<string, CanvasUse> {
  const usage = new Map<string, CanvasUse>();
  const note = (itemId: string, units: number, node: HardwareNode, inside: boolean) => {
    const use = usage.get(itemId) ?? { units: 0, nodes: [] };
    use.units += units;
    use.nodes.push({ id: node.id, name: node.name, inside });
    usage.set(itemId, use);
  };
  for (const node of hardwareNodes) {
    const own = assetIdOf(node.details);
    if (own) note(own, 1, node, false);
    for (const component of node.internal_components ?? []) {
      const part = assetIdOf(component.details);
      if (part)
        note(part, Math.max(1, Number(component.details?.inventory_quantity) || 1), node, true);
    }
  }
  return usage;
}

/** How many units of an item are still free to place on this canvas. */
export function unitsLeft(item: InventoryItem, usage: Map<string, CanvasUse>): number {
  return Math.max(0, item.quantity - (usage.get(item.id)?.units ?? 0));
}

/**
 * Memory after a kit goes in. A kit at least as large as what is fitted takes
 * its place (a small machine has two slots and they are full); a smaller one is
 * added to it.
 */
export function ramAfterInstall(currentGb: number, kitGb: number): number {
  return kitGb >= currentGb ? kitGb : currentGb + kitGb;
}

/** What is put on the drag, or handed to the canvas on a click. */
export type InventoryDragData = {
  type: HardwareType | ComponentType;
  name: string;
  details: HardwareSpec;
  power_draw?: number;
  mac_address?: string;
  /** Says the thing comes from the inventory, and how it may be placed. */
  inventory: { id: string; kind: InventoryKind; units: number };
};

/**
 * An item as the canvas takes it. A device becomes a node that carries the
 * item's id: the node's name is its role in the build and can be changed, the
 * asset keeps its own.
 *
 * backend/internal/inventory (NodeDetails) builds the same details when an
 * import places a device. Change them together.
 */
export function inventoryItemToDragData(item: InventoryItem, units = 1): InventoryDragData {
  const specs = item.specs ?? {};
  const details: HardwareSpec = { inventory_item_id: item.id, inventory_label: item.name };
  const model = modelLine(item);
  if (model) details.model = model;

  if (item.kind !== 'device') {
    const type = COMPONENT_NODE_TYPES[item.type] ?? 'pcie';
    details.inventory_quantity = units;
    if (specs.ram_gb) details.ram = specs.ram_gb * (item.type === 'ram' ? units : 1);
    if (specs.ram_type) details.ram_type = specs.ram_type;
    if (specs.storage_gb) details.storage = specs.storage_gb;
    if (specs.ports) details.ports = specs.ports;
    return {
      type,
      name: countedName(item.name, units),
      details,
      power_draw: item.power_draw ? item.power_draw * units : undefined,
      inventory: { id: item.id, kind: item.kind, units },
    };
  }

  const cpus = logicalCpus(specs);
  if (cpus) details.cpu = cpus;
  if (specs.ram_gb) details.ram = specs.ram_gb;
  if (specs.ram_type) details.ram_type = specs.ram_type;
  if (specs.storage_gb) details.storage = specs.storage_gb;
  if (specs.ports) details.ports = specs.ports;
  if (specs.rack_units) details.rack_units = specs.rack_units;
  if (item.type === 'rack' && specs.rack_size) details.rack_size = specs.rack_size;
  // A server of one's own does what servers placed from the library do.
  if (item.type === 'server_v2') {
    details.hypervisor_enabled = true;
    details.app_host_enabled = true;
  }
  return {
    type: item.type as HardwareType,
    name: item.name,
    details,
    power_draw: item.power_draw || undefined,
    mac_address: item.mac_addresses?.[0],
    inventory: { id: item.id, kind: item.kind, units: 1 },
  };
}

/** The component an item becomes inside a host. */
export function itemAsComponent(item: InventoryItem, units: number): HardwareComponent {
  const data = inventoryItemToDragData(item, units);
  return {
    id: crypto.randomUUID(),
    type: data.type as ComponentType,
    name: data.name,
    power_draw: data.power_draw,
    details: data.details,
  };
}

const DEVICE_TYPES = new Set(TYPES.device.map(type => type.id));

/** Whether a device on a canvas can be kept as an inventory item. */
export const canBeInventoried = (type: string) =>
  DEVICE_TYPES.has(type === 'server' ? 'server_v2' : type);

/** A device on a canvas as the item it would be in the inventory. */
export function nodeToInventoryInput(node: HardwareNode): InventoryInput {
  const details = node.details ?? {};
  const number = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };
  return {
    kind: 'device',
    type: node.type === 'server' ? 'server_v2' : node.type,
    name: node.name,
    model: details.model ?? '',
    status: 'available',
    location: node.parent_id ? 'rack' : 'other',
    specs: {
      cpu_threads: number(details.cpu),
      ram_gb: number(details.ram),
      ram_type: details.ram_type,
      storage_gb: number(details.storage),
      ports: number(details.ports),
      rack_units: number(details.rack_units),
      rack_size: node.type === 'rack' ? number(details.rack_size) : undefined,
    },
    mac_addresses: node.mac_address ? [node.mac_address] : [],
    power_draw: number(node.power_draw),
  };
}

/** What the builder lists beside the canvas: what can be planned with, devices first. */
export function plannableItems(items: InventoryItem[]): InventoryItem[] {
  const rank = (item: InventoryItem) => (item.kind === 'device' ? 0 : 1);
  return items
    .filter(item => isPlannable(item) && placementOf(item) !== 'none')
    .toSorted(
      (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
}

export type ItemFilter = { status?: InventoryStatus | ''; search?: string };

export function filterItems(items: InventoryItem[], filter: ItemFilter): InventoryItem[] {
  const words = (filter.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => {
    if (filter.status && item.state !== filter.status) return false;
    if (words.length === 0) return true;
    const text = [
      item.name,
      item.manufacturer,
      item.model,
      item.notes,
      item.specs?.cpu_model,
      item.integration_ref,
      typeLabel(item.kind, item.type),
      ...itemFacts(item),
    ]
      .join(' ')
      .toLowerCase();
    return words.every(word => text.includes(word));
  });
}

export function countByStatus(items: InventoryItem[]): Record<InventoryStatus, number> {
  const counts: Record<InventoryStatus, number> = {
    available: 0,
    in_use: 0,
    reserved: 0,
    broken: 0,
    sold: 0,
  };
  for (const item of items) counts[item.state] = (counts[item.state] ?? 0) + 1;
  return counts;
}

/** The other projects that plan an item, by name, each once. */
export function plannedElsewhere(item: InventoryItem, buildId: string | null): string[] {
  const names = item.placements
    .filter(placement => placement.build_id !== buildId)
    .map(placement => placement.build_name);
  return [...new Set(names)];
}

export type ItemGroup = { id: string; label: string; items: InventoryItem[] };

/** Items under the place they are kept in, or under what they are. Empty groups are left out. */
export function groupItems(items: InventoryItem[], by: 'location' | 'kind'): ItemGroup[] {
  const order: { id: string; label: string }[] =
    by === 'location' ? LOCATIONS : KINDS.map(kind => ({ id: kind.id, label: kind.plural }));
  return order
    .map(entry => ({
      id: entry.id,
      label: entry.label,
      items: items
        .filter(item => (by === 'location' ? item.location : item.kind) === entry.id)
        .toSorted((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    }))
    .filter(group => group.items.length > 0);
}
