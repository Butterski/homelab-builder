import type { HardwareSpec, VirtualMachine } from '../../../types';

type ResourceUsage = {
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

/**
 * What a host's running VMs use against what it has. RAM in the details is
 * taken as GB below 1000 and as MB from there.
 */
export function getHostLoad(details: HardwareSpec | undefined, vms: VirtualMachine[] = []) {
  const { cpu: usedCpu, ramMb: usedRamMb } = getVmResourceUsage(vms);
  const totalCpu = Number(details?.cpu) || 0;
  const totalRam = Number(details?.ram) || 0;
  const totalRamMb = totalRam < 1000 ? totalRam * 1024 : totalRam;
  return {
    usedCpu,
    usedRamMb,
    totalCpu,
    totalRamMb,
    cpuWarning: totalCpu > 0 && usedCpu > totalCpu,
    ramWarning: totalRamMb > 0 && usedRamMb > totalRamMb,
  };
}