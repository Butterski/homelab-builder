import type { HardwareType } from '../types';

export const HARDWARE_CATEGORY_LABELS: Record<string, string> = {
  router: 'Routers',
  switch: 'Switches',
  nas: 'NAS',
  server: 'Servers',
  server_v2: 'Servers',
  minipc: 'Mini PCs',
  sbc: 'SBCs',
  access_point: 'Access Points',
  ups: 'UPS',
  pdu: 'PDUs',
  storage: 'Storage',
  disk: 'Storage',
  ram: 'RAM',
  gpu: 'GPUs',
  hba: 'HBA Cards',
  nic: 'NICs',
  pcie: 'PCIe Cards',
  accessory: 'Accessories',
  rack: 'Racks',
  iot: 'IoT',
  modem: 'Modems',
  firewall: 'Firewalls',
  vps: 'Cloud/VPS',
  pc: 'PCs',
  console: 'Consoles',
};

/** What one device of a type is called in a sentence or a table. */
const HARDWARE_TYPE_NAMES: Partial<Record<HardwareType, string>> = {
  router: 'Router',
  switch: 'Switch',
  firewall: 'Firewall',
  modem: 'Modem',
  access_point: 'Access point',
  server: 'Server',
  server_v2: 'Server',
  minipc: 'Mini PC',
  sbc: 'SBC',
  pc: 'PC',
  nas: 'NAS',
  vps: 'VPS',
  iot: 'IoT device',
  console: 'Console',
  ups: 'UPS',
  pdu: 'PDU',
  lan_table: 'LAN table',
  rack: 'Rack',
  disk: 'Disk',
  gpu: 'GPU',
  hba: 'HBA card',
  pcie: 'PCIe card',
};

export function hardwareTypeName(type: HardwareType | string): string {
  return HARDWARE_TYPE_NAMES[type as HardwareType] ?? type.replace(/_/g, ' ');
}

export const CREATOR_HARDWARE_TYPES: Array<{ type: HardwareType; label: string }> = [
  { type: 'router', label: 'Router' },
  { type: 'switch', label: 'Switch' },
  { type: 'firewall', label: 'Firewall' },
  { type: 'server_v2', label: 'Server' },
  { type: 'minipc', label: 'Mini PC' },
  { type: 'pc', label: 'PC' },
  { type: 'console', label: 'Console' },
  { type: 'nas', label: 'NAS' },
  { type: 'sbc', label: 'SBC' },
  { type: 'vps', label: 'VPS' },
  { type: 'access_point', label: 'Access Point' },
  { type: 'rack', label: 'Rack' },
  { type: 'iot', label: 'IoT' },
  { type: 'ups', label: 'UPS' },
];

export function normalizeHardwareCategory(category: string) {
  const normalized = category.trim().toLowerCase().replace(/[-\s]+/g, '_');
  switch (normalized) {
    case 'mini_pc':
    case 'mini_pcs':
    case 'minipcs':
    case 'sff':
    case 'sff_pc':
      return 'minipc';
    case 'servers':
    case 'server_v2':
      return 'server';
    case 'accesspoint':
    case 'access_points':
    case 'ap':
    case 'aps':
      return 'access_point';
    case 'storage_drive':
    case 'storage_drives':
    case 'drive':
    case 'drives':
      return 'storage';
    case 'network_card':
    case 'network_cards':
    case 'nics':
      return 'nic';
    case 'hbas':
      return 'hba';
    case 'gpus':
      return 'gpu';
    case 'routers':
      return 'router';
    case 'switches':
      return 'switch';
    case 'single_board_computer':
    case 'single_board_computers':
      return 'sbc';
    case 'pcs':
    case 'desktop':
    case 'desktops':
    case 'workstation':
    case 'workstations':
    case 'gaming_pc':
    case 'gaming_pcs':
      return 'pc';
    case 'consoles':
    case 'game_console':
    case 'game_consoles':
    case 'handheld':
    case 'handhelds':
      return 'console';
    default:
      return normalized;
  }
}

export function hardwareCategoryLabel(category: string) {
  const key = normalizeHardwareCategory(category);
  return HARDWARE_CATEGORY_LABELS[key] ?? category;
}

export function hardwareCategoryToNodeType(category: string): HardwareType {
  const key = normalizeHardwareCategory(category);
  if (key === 'server') return 'server_v2';
  if (key === 'storage') return 'disk';
  if (key === 'nic') return 'hba';
  return key as HardwareType;
}

export function nodeTypeToCatalogCategory(type: HardwareType) {
  if (type === 'server_v2') return 'server';
  if (type === 'disk') return 'storage';
  if (type === 'hba') return 'hba';
  return normalizeHardwareCategory(type);
}

