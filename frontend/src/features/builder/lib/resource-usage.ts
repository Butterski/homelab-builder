import type { HardwareComponent, HardwareSpec, VirtualMachine } from '../../../types';

type ResourceUsage = {
  cpu: number;
  ramMb: number;
  storageGb: number;
};

/** A guest without a disk size is counted as 10 GB. */
const DEFAULT_GUEST_DISK_GB = 10;

export const vmConsumesHostResources = (vm: VirtualMachine): boolean => vm.status !== 'stopped';

/**
 * What a host's guests use. CPU and RAM count running guests only; a disk is
 * taken whether the guest runs or not, as on a Proxmox host.
 */
export const getVmResourceUsage = (vms: VirtualMachine[] = []): ResourceUsage =>
  vms.reduce<ResourceUsage>(
    (usage, vm) => {
      usage.storageGb += Number(vm.details?.disk_gb) || DEFAULT_GUEST_DISK_GB;
      if (!vmConsumesHostResources(vm)) {
        return usage;
      }

      usage.cpu += vm.cpu_cores || 1;
      usage.ramMb += vm.ram_mb || 512;
      return usage;
    },
    { cpu: 0, ramMb: 0, storageGb: 0 },
  );

/** A size as stored: a number, or text that starts with one ("500GB"). */
function sizeGb(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const match = value.match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

/** A host's storage in GB: its own plus that of the disks inside it. */
export function hostStorageGb(details: HardwareSpec | undefined, components: HardwareComponent[] = []): number {
  return components.reduce(
    (total, component) => (component.type === 'disk' ? total + sizeGb(component.details?.storage) : total),
    sizeGb(details?.storage),
  );
}

/**
 * What a host's guests use against what it has. RAM in the details is taken
 * as GB below 1000 and as MB from there.
 */
export function getHostLoad(
  details: HardwareSpec | undefined,
  vms: VirtualMachine[] = [],
  components: HardwareComponent[] = [],
) {
  const { cpu: usedCpu, ramMb: usedRamMb, storageGb: usedStorageGb } = getVmResourceUsage(vms);
  const totalCpu = Number(details?.cpu) || 0;
  const totalRam = Number(details?.ram) || 0;
  const totalRamMb = totalRam < 1000 ? totalRam * 1024 : totalRam;
  const totalStorageGb = hostStorageGb(details, components);
  return {
    usedCpu,
    usedRamMb,
    usedStorageGb,
    totalCpu,
    totalRamMb,
    totalStorageGb,
    cpuWarning: totalCpu > 0 && usedCpu > totalCpu,
    ramWarning: totalRamMb > 0 && usedRamMb > totalRamMb,
    storageWarning: totalStorageGb > 0 && usedStorageGb > totalStorageGb,
  };
}
