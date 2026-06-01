import { describe, expect, it } from 'vitest';
import type { HardwareNode, Service } from '../../../types';
import { blueprintMetricBars, componentSummary, estimateBlueprintFit, formatMetric } from './blueprint-fit';

describe('blueprint fit metrics', () => {
  it('estimates capacity from node specs and internal components', () => {
    const nodeData: Partial<HardwareNode> = {
      details: { cpu: '2x 4-core', ram: '32GB', storage: '512GB', ports: '4x GbE' },
      power_draw: 35,
      internal_components: [
        { id: 'disk-1', type: 'disk', name: 'Pool', power_draw: 6, details: { storage: '2x 2TB' } },
        { id: 'gpu-1', type: 'gpu', name: 'Transcoder', power_draw: 35, details: { ram: '6GB' } },
      ],
    };

    const fit = estimateBlueprintFit(nodeData, [makeService('Jellyfin', 2, 2048, 20)]);

    expect(fit.capacity.cpu_cores).toBe(8);
    expect(fit.capacity.ram_gb).toBe(32);
    expect(fit.capacity.storage_gb).toBe(4608);
    expect(fit.capacity.power_w).toBe(76);
    expect(fit.capacity.ports).toBe(4);
    expect(fit.capacity.disks).toBe(1);
    expect(fit.capacity.gpus).toBe(1);
    expect(fit.demand.cpu_cores).toBe(2);
    expect(fit.demand.ram_gb).toBe(2);
  });

  it('builds stable metric bars and formats large storage', () => {
    const fit = estimateBlueprintFit(
      { details: { cpu: 4, ram: 16, storage: 2048, ports: 2 }, power_draw: 12 },
      [makeService('Pi-hole', 1, 512, 2)],
    );

    const bars = blueprintMetricBars(fit);

    expect(bars.map(bar => bar.label)).toEqual(['CPU', 'RAM', 'Storage', 'Ports', 'Network', 'Power']);
    expect(bars[0].percent).toBe(25);
    expect(formatMetric(2048, 'GB')).toBe('2TB');
  });

  it('summarizes disks, GPUs, and expansion cards', () => {
    const summary = componentSummary([
      { id: 'd1', type: 'disk', name: 'SSD' },
      { id: 'g1', type: 'gpu', name: 'GPU' },
      { id: 'h1', type: 'hba', name: 'HBA' },
    ]);

    expect(summary).toEqual({ disks: 1, gpus: 1, cards: 1 });
  });
});

function makeService(name: string, cpu: number, ramMb: number, storageGb: number): Service {
  return {
    id: name.toLowerCase(),
    name,
    description: '',
    category: 'media',
    icon: '',
    official_website: '',
    docker_support: true,
    is_active: true,
    requirements: {
      id: `${name}-req`,
      service_id: name.toLowerCase(),
      min_cpu_cores: cpu / 2,
      recommended_cpu_cores: cpu,
      min_ram_mb: ramMb / 2,
      recommended_ram_mb: ramMb,
      min_storage_gb: Math.max(1, storageGb / 2),
      recommended_storage_gb: storageGb,
    },
    created_at: '',
  };
}
