import type { HardwareNode, HardwareSpec, HardwareType, Service, VirtualMachine } from '../../../types';
import type { HardwareBlueprint } from '../../catalog/api/use-hardware-blueprints';
import type { HardwareComponent } from '../../catalog/api/use-hardware';
import { hardwareCategoryToNodeType } from '../../../lib/hardware-taxonomy';
import { parsePortCount } from './port-count';

type BlueprintDragData = Partial<HardwareNode> & {
  type: HardwareType;
  name: string;
};

function parseCoreCount(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return value;

  const text = String(value).toLowerCase();
  const direct = text.match(/(\d+(?:\.\d+)?)\s*(?:-|\s)?core/);
  if (direct) {
    const base = Number(direct[1]);
    const multi = text.match(/^(\d+)\s*x/);
    return multi ? base * Number(multi[1]) : base;
  }
  if (text.includes('quad-core')) return 4;
  if (text.includes('dual-core')) return 2;
  if (text.includes('octa-core')) return 8;

  const leading = text.match(/^(\d+(?:\.\d+)?)/);
  return leading ? Number(leading[1]) : undefined;
}

function parseCapacityGB(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return value;

  const text = String(value).toUpperCase();
  const multiCapacity = text.match(/^(\d+)\s*X\s*(\d+(?:\.\d+)?)\s*(TB|GB|MB)/);
  if (multiCapacity) {
    let amount = Number(multiCapacity[2]);
    if (multiCapacity[3] === 'TB') amount *= 1024;
    if (multiCapacity[3] === 'MB') amount /= 1024;
    return amount * Number(multiCapacity[1]);
  }

  const number = text.match(/(\d+(?:\.\d+)?)/);
  if (!number) return undefined;
  let amount = Number(number[1]);
  if (text.includes('TB')) amount *= 1024;
  if (text.includes('MB')) amount /= 1024;

  const multi = text.match(/^(\d+)\s*X/);
  return multi ? amount * Number(multi[1]) : amount;
}

function parseRackUnits(spec: Record<string, unknown>) {
  const direct = spec.rack_units ?? spec.units;
  if (direct !== undefined && direct !== null && direct !== '') return Number(direct);

  const formFactor = spec.form_factor ? String(spec.form_factor) : '';
  const match = formFactor.match(/(\d+)\s*u/i);
  return match ? Number(match[1]) : undefined;
}

export function parseCatalogSpec(spec: Record<string, unknown>): HardwareSpec {
  const parsed: HardwareSpec = { ...spec } as HardwareSpec;
  const cpu = parseCoreCount(spec.cpu ?? spec.cpu_cores);
  const ram = parseCapacityGB(spec.ram);
  const storage = parseCapacityGB(spec.storage ?? spec.capacity);
  const ports = parsePortCount(spec.ports);
  const rackUnits = parseRackUnits(spec);

  if (cpu !== undefined) parsed.cpu = cpu;
  if (ram !== undefined) parsed.ram = ram;
  if (storage !== undefined) parsed.storage = storage;
  if (ports !== undefined) parsed.ports = ports;
  if (rackUnits !== undefined) parsed.rack_units = rackUnits;

  return parsed;
}

export function hardwareComponentToDragData(component: HardwareComponent): BlueprintDragData {
  const type = hardwareCategoryToNodeType(component.category);
  const details = {
    model: `${component.brand} ${component.model}`,
    price_est: component.price_est,
    currency: component.currency,
    ...(component.spec || {}),
    ...parseCatalogSpec(component.spec || {}),
  };

  return {
    type,
    name: `${component.brand} ${component.model}`,
    details,
    power_draw: Number((component.spec as Record<string, unknown>)?.tdp_w || 0),
  };
}

export function serviceToVm(service: Service): VirtualMachine {
  const req = service.requirements;
  return {
    id: `vm-${service.id}`,
    name: service.name,
    type: 'container',
    status: 'running',
    cpu_cores: req?.recommended_cpu_cores || req?.min_cpu_cores || undefined,
    ram_mb: req?.recommended_ram_mb || req?.min_ram_mb || undefined,
  };
}

export function hardwareBlueprintToDragData(blueprint: HardwareBlueprint): BlueprintDragData {
  const nodeData = blueprint.node_data || {};
  const nodeDetails = (nodeData.details || {}) as HardwareSpec;
  const services = Array.isArray(blueprint.services) ? blueprint.services : [];
  const vmsFromServices = services.map(serviceToVm);
  const existingVms = Array.isArray(nodeData.vms) ? nodeData.vms : [];

  return {
    type: blueprint.node_type,
    name: blueprint.name,
    details: {
      ...nodeDetails,
      blueprint_id: blueprint.id,
      blueprint_visibility: blueprint.visibility,
    } as HardwareSpec,
    internal_components: Array.isArray(nodeData.internal_components)
      ? nodeData.internal_components
      : [],
    vms: [...existingVms, ...vmsFromServices],
    power_draw: nodeData.power_draw,
  };
}
