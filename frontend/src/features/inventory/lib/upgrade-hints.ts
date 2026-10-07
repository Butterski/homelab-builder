import type { HardwareNode } from '@/types';
import { isComputeNode } from '@/lib/hardware-config';
import { getVmResourceUsage } from '@/features/builder/lib/resource-usage';
import type { InventoryItem } from '../api/inventory';
import {
  type CanvasUse,
  countedName,
  formatGB,
  isPlannable,
  locationLabel,
  ramAfterInstall,
  unitsLeft,
} from './inventory';

/**
 * A host whose guests need more memory than it has, and memory the owner
 * already has lying around that would cover it.
 */
export type UpgradeHint = {
  nodeId: string;
  nodeName: string;
  /** Memory the host has, and what its guests are given, in GB. */
  haveGb: number;
  needGb: number;
  item: InventoryItem;
  /** How many units of the item go in. */
  units: number;
  /** Memory of the host once they are in. */
  resultGb: number;
  /** Both sides say what memory they are and it is the same. */
  fits: boolean;
};

const sameKind = (a?: string, b?: string) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The memory of a host in GB, read the way the canvas reads it. */
function hostRamGb(node: HardwareNode): number {
  const ram = Number(node.details?.ram) || 0;
  return ram >= 1000 ? ram / 1024 : ram;
}

/**
 * For every host that is short of memory, the owned memory that closes the gap
 * with the least left over. Memory that is known to be of another kind than the
 * host takes is never offered.
 */
export function ramUpgradeHints(
  hardwareNodes: HardwareNode[],
  items: InventoryItem[],
  usage: Map<string, CanvasUse>,
): UpgradeHint[] {
  const modules = items.filter(
    item =>
      item.kind === 'component' &&
      item.type === 'ram' &&
      isPlannable(item) &&
      (item.specs?.ram_gb ?? 0) > 0,
  );
  if (modules.length === 0) return [];

  // What an earlier hint in this list would take is not offered twice.
  const left = new Map(modules.map(item => [item.id, unitsLeft(item, usage)]));
  const hints: UpgradeHint[] = [];

  for (const node of hardwareNodes) {
    if (!isComputeNode(node.type)) continue;
    const haveGb = hostRamGb(node);
    if (haveGb <= 0) continue;
    const needGb = Math.ceil(getVmResourceUsage(node.vms ?? []).ramMb / 1024);
    if (needGb <= haveGb) continue;

    let best: UpgradeHint | null = null;
    for (const item of modules) {
      const units = left.get(item.id) ?? 0;
      if (units <= 0) continue;
      const hostKind = node.details?.ram_type;
      const itemKind = item.specs.ram_type;
      if (hostKind && itemKind && !sameKind(hostKind, itemKind)) continue;

      const resultGb = ramAfterInstall(haveGb, (item.specs.ram_gb ?? 0) * units);
      if (resultGb < needGb) continue;
      const candidate: UpgradeHint = {
        nodeId: node.id,
        nodeName: node.name,
        haveGb,
        needGb,
        item,
        units,
        resultGb,
        fits: sameKind(hostKind, itemKind),
      };
      // Memory known to fit comes first; among equals, the one that leaves the least unused.
      if (
        !best ||
        (candidate.fits && !best.fits) ||
        (candidate.fits === best.fits && candidate.resultGb < best.resultGb)
      ) {
        best = candidate;
      }
    }
    if (best) {
      left.set(best.item.id, 0);
      hints.push(best);
    }
  }
  return hints;
}

/** A hint in a sentence. */
export function upgradeHintText(hint: UpgradeHint): string {
  const kit = countedName(hint.item.name, hint.units);
  const where = locationLabel(hint.item.location).toLowerCase();
  return (
    `${hint.nodeName} gives its guests ${formatGB(hint.needGb)} and has ${formatGB(hint.haveGb)}. ` +
    `You own ${kit} (${where}): with it the host has ${formatGB(hint.resultGb)}. Nothing to buy.`
  );
}
