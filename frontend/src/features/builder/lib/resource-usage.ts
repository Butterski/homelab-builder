import type { VirtualMachine } from '../../../types';

export type ResourceUsage = {
  cpu: number;
  ramMb: number;
  storageGb: number;
};

export const vmConsumesHostResources = (vm: VirtualMachine): boolean => vm.status !== 'stopped';

export const getVmResourceUsage = (vms: VirtualMachine[] = []): ResourceUsage =>
  vms.reduce<ResourceUsage>(
    (usage, vm) => {
      if (!vmConsumesHostResources(vm)) {
        return usage;
      }

      usage.cpu += vm.cpu_cores || 1;
      usage.ramMb += vm.ram_mb || 512;
      usage.storageGb += 10;
      return usage;
    },
    { cpu: 0, ramMb: 0, storageGb: 0 },
  );