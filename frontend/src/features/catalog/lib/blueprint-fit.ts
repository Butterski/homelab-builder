import type { HardwareComponent, HardwareNode, Service } from '../../../types';
import type { HardwareBlueprintFit, HardwareBlueprintFitResource } from '../api/use-hardware-blueprints';

export type BlueprintMetric = {
  label: string;
  used: number;
  total: number;
  unit: string;
  percent: number;
};

export function estimateBlueprintFit(
  nodeData: Partial<HardwareNode>,
  services: Service[],
): Pick<HardwareBlueprintFit, 'capacity' | 'demand' | 'utilization'> {
  const details = nodeData.details || {};
  const detailsRecord = details as Record<string, unknown>;
  const internalComponents = Array.isArray(nodeData.internal_components) ? nodeData.internal_components : [];
  const vms = Array.isArray(nodeData.vms) ? nodeData.vms : [];

  const capacity: HardwareBlueprintFitResource = {
    cpu_cores: parseNumber(details.cpu ?? details.cpu_cores),
    ram_gb: parseCapacityGB(details.ram),
    storage_gb: parseCapacityGB(details.storage),
    power_w: parseNumber(nodeData.power_draw ?? detailsRecord.power_w ?? detailsRecord.tdp_w),
    ports: parsePortCount(details.ports),
    network_gbps: parseNetworkGbps(detailsRecord.network_gbps ?? detailsRecord.port_speed ?? detailsRecord.speed),
    drive_bays: parseNumber(detailsRecord.drive_bays ?? detailsRecord.bays ?? detailsRecord.disk_bays),
    disks: 0,
    gpus: 0,
  };

  internalComponents.forEach(component => {
    const componentDetails = (component.details || {}) as Record<string, unknown>;
    capacity.power_w += parseNumber(component.power_draw ?? componentDetails.power_w ?? componentDetails.tdp_w);
    if (component.type === 'disk') {
      capacity.disks += 1;
      capacity.storage_gb += parseCapacityGB(component.details?.storage ?? componentDetails.capacity);
    }
    if (component.type === 'gpu') {
      capacity.gpus += 1;
    }
    if (component.type === 'hba' || component.type === 'pcie') {
      capacity.ports += parsePortCount(component.details?.ports);
      capacity.network_gbps += parseNetworkGbps(componentDetails.network_gbps ?? componentDetails.port_speed ?? componentDetails.speed);
    }
  });
  if (capacity.drive_bays < capacity.disks) capacity.drive_bays = capacity.disks;

  const demand: HardwareBlueprintFitResource = {
    cpu_cores: 0,
    ram_gb: 0,
    storage_gb: 0,
    power_w: 0,
    ports: services.length > 0 ? 1 + Math.ceil(services.length / 8) : 0,
    network_gbps: 0,
    drive_bays: 0,
    disks: 0,
    gpus: 0,
  };

  services.forEach(service => {
    const req = service.requirements;
    demand.cpu_cores += req?.recommended_cpu_cores || req?.min_cpu_cores || 0;
    demand.ram_gb += (req?.recommended_ram_mb || req?.min_ram_mb || 0) / 1024;
    demand.storage_gb += req?.recommended_storage_gb || req?.min_storage_gb || 0;
    if (service.category === 'networking') {
      demand.ports += 1;
      demand.network_gbps += 0.25;
    }
    if (service.category === 'media') demand.network_gbps += 0.1;
    if (service.category === 'monitoring') demand.network_gbps += 0.05;
  });

  vms.forEach(vm => {
    demand.cpu_cores += vm.cpu_cores || 0;
    demand.ram_gb += (vm.ram_mb || 0) / 1024;
  });

  return {
    capacity,
    demand,
    utilization: {
      cpu: ratio(demand.cpu_cores, capacity.cpu_cores),
      ram: ratio(demand.ram_gb, capacity.ram_gb),
      storage: ratio(demand.storage_gb, capacity.storage_gb),
      ports: ratio(demand.ports, capacity.ports),
      network: ratio(demand.network_gbps, capacity.network_gbps),
    },
  };
}

export function blueprintMetricBars(
  fit: Pick<HardwareBlueprintFit, 'capacity' | 'demand' | 'utilization'>,
): BlueprintMetric[] {
  return [
    metric('CPU', fit.demand.cpu_cores, fit.capacity.cpu_cores, 'cores'),
    metric('RAM', fit.demand.ram_gb, fit.capacity.ram_gb, 'GB'),
    metric('Storage', fit.demand.storage_gb, fit.capacity.storage_gb, 'GB'),
    metric('Ports', fit.demand.ports, fit.capacity.ports, ''),
    metric('Network', fit.demand.network_gbps, fit.capacity.network_gbps, 'Gbps'),
    metric('Power', fit.capacity.power_w, fit.capacity.power_w, 'W'),
  ];
}

export function componentSummary(components: HardwareComponent[] = []) {
  return components.reduce(
    (summary, component) => {
      if (component.type === 'disk') summary.disks += 1;
      if (component.type === 'gpu') summary.gpus += 1;
      if (component.type === 'hba' || component.type === 'pcie') summary.cards += 1;
      return summary;
    },
    { disks: 0, gpus: 0, cards: 0 },
  );
}

export function formatMetric(value: number, unit: string) {
  if (!Number.isFinite(value) || value <= 0) return unit ? `0${unit}` : '0';
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  if (unit === 'GB' && rounded >= 1024) return `${Math.round((rounded / 1024) * 10) / 10}TB`;
  return unit ? `${rounded}${unit}` : String(rounded);
}

export function fitTone(grade?: HardwareBlueprintFit['grade']) {
  switch (grade) {
    case 'excellent':
      return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
    case 'good':
      return 'bg-green-500/10 text-green-600 border-green-500/20';
    case 'tight':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20';
    case 'risky':
      return 'bg-red-500/10 text-red-600 border-red-500/20';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function metric(label: string, used: number, total: number, unit: string): BlueprintMetric {
  const percent = total <= 0 ? 0 : Math.min(100, Math.round((used / total) * 100));
  return { label, used, total, unit, percent };
}

function ratio(used: number, total: number) {
  if (used <= 0) return 0;
  if (total <= 0) return 1.5;
  return used / total;
}

function parseNumber(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value;
  const text = String(value).toLowerCase();
  const coreMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:-|\s)?core/);
  if (coreMatch) {
    const cores = Number(coreMatch[1]);
    const multi = text.match(/^(\d+)\s*x/);
    return multi ? Number(multi[1]) * cores : cores;
  }
  const number = text.match(/\d+(?:\.\d+)?/);
  return number ? Number(number[0]) : 0;
}

function parseCapacityGB(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value;
  const text = String(value).toUpperCase();
  const multi = text.match(/^(\d+)\s*X\s*(\d+(?:\.\d+)?)\s*(TB|GB|MB)/);
  if (multi) {
    const multiplier = Number(multi[1]);
    let amount = Number(multi[2]);
    if (multi[3] === 'TB') amount *= 1024;
    if (multi[3] === 'MB') amount /= 1024;
    return multiplier * amount;
  }
  const number = text.match(/\d+(?:\.\d+)?/);
  if (!number) return 0;
  let amount = Number(number[0]);
  if (text.includes('TB')) amount *= 1024;
  if (text.includes('MB')) amount /= 1024;
  return amount;
}

function parsePortCount(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value;
  const text = String(value);
  const matches = [...text.matchAll(/(\d+)\s*x/gi)];
  if (matches.length > 0) {
    return matches.reduce((total, match) => total + Number(match[1]), 0);
  }
  return parseNumber(value);
}

function parseNetworkGbps(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const text = String(value).toLowerCase();
  if (text.includes('100gbe') || text.includes('100 gb')) return 100;
  if (text.includes('40gbe') || text.includes('40 gb')) return 40;
  if (text.includes('25gbe') || text.includes('25 gb')) return 25;
  if (text.includes('10gbe') || text.includes('10 gb') || text.includes('sfp+')) return 10;
  if (text.includes('2.5gbe') || text.includes('2.5 gb')) return 2.5;
  if (text.includes('100mb') || text.includes('100 mb')) return 0.1;
  return parseNumber(value);
}
