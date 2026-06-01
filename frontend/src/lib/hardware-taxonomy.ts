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
};

export const CREATOR_HARDWARE_TYPES: Array<{ type: HardwareType; label: string }> = [
  { type: 'router', label: 'Router' },
  { type: 'switch', label: 'Switch' },
  { type: 'firewall', label: 'Firewall' },
  { type: 'server_v2', label: 'Server' },
  { type: 'minipc', label: 'Mini PC' },
  { type: 'pc', label: 'PC' },
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

