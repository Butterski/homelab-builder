import { describe, expect, it } from 'vitest';
import type { Service, ServiceRequirement } from '../../../types';
import type { HardwareComponent } from '../../catalog/api/use-hardware';
import type { HardwareBlueprint } from '../../catalog/api/use-hardware-blueprints';
import {
  hardwareBlueprintToDragData,
  hardwareComponentToDragData,
  parseCatalogSpec,
  serviceToVm,
} from './catalog-mapper';
import { hardwareCategoryToNodeType, normalizeHardwareCategory } from '../../../lib/hardware-taxonomy';

describe('hardware taxonomy', () => {
  it('normalizes Mini PC aliases into one category', () => {
    expect(normalizeHardwareCategory('Mini PCs')).toBe('minipc');
    expect(normalizeHardwareCategory('mini-pc')).toBe('minipc');
    expect(normalizeHardwareCategory('mini_pc')).toBe('minipc');
  });

  it('maps catalog categories to builder node types', () => {
    expect(hardwareCategoryToNodeType('server')).toBe('server_v2');
    expect(hardwareCategoryToNodeType('storage')).toBe('disk');
    expect(hardwareCategoryToNodeType('nic')).toBe('hba');
    expect(hardwareCategoryToNodeType('minipc')).toBe('minipc');
  });
});

describe('catalog mapper', () => {
  it('parses catalog specs into numeric builder details', () => {
    const parsed = parseCatalogSpec({
      cpu: '2x Intel Xeon E5-2680v4 14-core',
      ram: '64GB DDR4',
      storage: '2x 1TB NVMe',
      ports: '4x GbE + 2x SFP+',
      form_factor: '2U rack',
    });

    expect(parsed.cpu).toBe(28);
    expect(parsed.ram).toBe(64);
    expect(parsed.storage).toBe(2048);
    expect(parsed.ports).toBe(6);
    expect(parsed.rack_units).toBe(2);
  });

  it('converts hardware components into draggable builder data', () => {
    const component: HardwareComponent = {
      id: 'hw-1',
      category: 'server',
      brand: 'Dell',
      model: 'PowerEdge R730',
      spec: { cpu: '2x 14-core', ram: '64GB', storage: '1TB', ports: '4x GbE' },
      price_est: 400,
      currency: 'EUR',
      buy_urls: [],
      image_url: '',
      approved: true,
      likes: 0,
      created_at: '',
    };

    const dragData = hardwareComponentToDragData(component);

    expect(dragData.type).toBe('server_v2');
    expect(dragData.name).toBe('Dell PowerEdge R730');
    expect(dragData.details?.cpu).toBe(28);
    expect(dragData.details?.ram).toBe(64);
    expect(dragData.details?.price_est).toBe(400);
  });

  it('converts services into VM/container defaults', () => {
    const service = makeService({
      id: 'svc-1',
      name: 'Jellyfin',
      recommended_cpu_cores: 2,
      recommended_ram_mb: 2048,
    });

    const vm = serviceToVm(service);

    expect(vm.id).toBe('vm-svc-1');
    expect(vm.name).toBe('Jellyfin');
    expect(vm.type).toBe('container');
    expect(vm.cpu_cores).toBe(2);
    expect(vm.ram_mb).toBe(2048);
  });

  it('converts blueprints into reusable nodes with bundled services', () => {
    const blueprint: HardwareBlueprint = {
      id: 'bp-1',
      user_id: 'user-1',
      name: 'Media N100',
      description: '',
      category: 'minipc',
      node_type: 'minipc',
      visibility: 'private',
      tags: ['quiet'],
      node_data: {
        details: { cpu: 4, ram: 16, storage: 512 },
        vms: [{ id: 'vm-existing', name: 'Existing', type: 'container', status: 'running' }],
        internal_components: [{ id: 'disk-1', type: 'disk', name: 'SSD' }],
      },
      services: [makeService({ id: 'svc-1', name: 'Pi-hole', recommended_ram_mb: 256 })],
      upvotes: 0,
      downvotes: 0,
      created_at: '',
      updated_at: '',
    };

    const dragData = hardwareBlueprintToDragData(blueprint);

    expect(dragData.type).toBe('minipc');
    expect(dragData.details?.blueprint_id).toBe('bp-1');
    expect(dragData.internal_components).toHaveLength(1);
    expect(dragData.vms).toHaveLength(2);
    expect(dragData.vms?.some(vm => vm.name === 'Pi-hole')).toBe(true);
  });
});

function makeService(overrides: Partial<ServiceRequirement> & Partial<Service>): Service {
  return {
    id: overrides.id || 'svc',
    name: overrides.name || 'Service',
    description: '',
    category: 'management',
    icon: '',
    official_website: '',
    docker_support: true,
    is_active: true,
    requirements: {
      id: 'req-1',
      service_id: overrides.id || 'svc',
      min_cpu_cores: overrides.min_cpu_cores || 0.5,
      recommended_cpu_cores: overrides.recommended_cpu_cores || 1,
      min_ram_mb: overrides.min_ram_mb || 128,
      recommended_ram_mb: overrides.recommended_ram_mb || 512,
      min_storage_gb: overrides.min_storage_gb || 1,
      recommended_storage_gb: overrides.recommended_storage_gb || 5,
    },
    created_at: '',
  };
}
