import { describe, expect, it } from 'vitest';

import type { VirtualMachine } from '../../../types';
import { getHostLoad, getVmResourceUsage, vmConsumesHostResources } from './resource-usage';

const makeVm = (overrides: Partial<VirtualMachine> = {}): VirtualMachine => ({
  id: overrides.id ?? 'vm-1',
  name: overrides.name ?? 'workload',
  type: overrides.type ?? 'container',
  status: overrides.status ?? 'running',
  cpu_cores: overrides.cpu_cores,
  ram_mb: overrides.ram_mb,
  ip: overrides.ip,
  os: overrides.os,
  details: overrides.details,
});

describe('vmConsumesHostResources', () => {
  it('returns false for stopped workloads', () => {
    expect(vmConsumesHostResources(makeVm({ status: 'stopped' }))).toBe(false);
  });

  it('returns true for running workloads', () => {
    expect(vmConsumesHostResources(makeVm({ status: 'running' }))).toBe(true);
  });
});

describe('getVmResourceUsage', () => {
  it('ignores stopped workloads in cpu and ram totals', () => {
    const usage = getVmResourceUsage([
      makeVm({ id: 'vm-running', status: 'running', cpu_cores: 2, ram_mb: 2048 }),
      makeVm({ id: 'vm-stopped', status: 'stopped', cpu_cores: 4, ram_mb: 4096 }),
    ]);

    expect(usage).toEqual({ cpu: 2, ramMb: 2048, storageGb: 20 });
  });

  it('applies existing fallback values only to active workloads', () => {
    const usage = getVmResourceUsage([
      makeVm({ id: 'vm-defaults', status: 'running', cpu_cores: 0, ram_mb: 0 }),
      makeVm({ id: 'vm-stopped-defaults', status: 'stopped', cpu_cores: 0, ram_mb: 0 }),
    ]);

    expect(usage).toEqual({ cpu: 1, ramMb: 512, storageGb: 20 });
  });
});

describe('getHostLoad', () => {
  it('counts the disks of every guest against the host storage', () => {
    const load = getHostLoad({ storage: 500 }, [
      makeVm({ id: 'a', status: 'running', details: { disk_gb: 300 } }),
      makeVm({ id: 'b', status: 'stopped', details: { disk_gb: 400 } }),
    ]);

    expect(load.usedStorageGb).toBe(700);
    expect(load.totalStorageGb).toBe(500);
    expect(load.storageWarning).toBe(true);
  });

  it('counts a guest without a disk size as 10 GB and adds disk components', () => {
    const load = getHostLoad({ storage: 5 }, [makeVm()], [
      { id: 'd', type: 'disk', name: 'SSD', details: { storage: 100 } },
    ]);

    expect(load.usedStorageGb).toBe(10);
    expect(load.totalStorageGb).toBe(105);
    expect(load.storageWarning).toBe(false);
  });
});