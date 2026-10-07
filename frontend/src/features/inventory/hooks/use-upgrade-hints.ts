import { useMemo } from 'react';
import { useBuilderStore } from '@/features/builder/store/builder-store';
import { useInventory } from '../api/inventory';
import { canvasUsage } from '../lib/inventory';
import { ramUpgradeHints, type UpgradeHint } from '../lib/upgrade-hints';

/**
 * The hosts of the open canvas that are short of memory, each with memory the
 * owner already has that would cover it.
 */
export function useUpgradeHints(): UpgradeHint[] {
  const { data } = useInventory();
  const hardwareNodes = useBuilderStore(state => state.hardwareNodes);
  return useMemo(
    () => (data ? ramUpgradeHints(hardwareNodes, data.items, canvasUsage(hardwareNodes)) : []),
    [data, hardwareNodes],
  );
}
