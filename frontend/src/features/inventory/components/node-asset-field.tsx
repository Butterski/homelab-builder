import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { HardwareNode } from '@/types';
import { assetIdOf, withoutAssetLink } from '@/lib/asset-link';
import { Button } from '@/components/ui/button';
import { useBuilderStore } from '@/features/builder/store/builder-store';
import { useInventory, type InventoryInput, type InventoryItem } from '../api/inventory';
import {
  canBeInventoried,
  canvasUsage,
  inventoryItemToDragData,
  keptWhere,
  nodeToInventoryInput,
  statusLabel,
} from '../lib/inventory';
import { ramUpgradeHints, upgradeHintText } from '../lib/upgrade-hints';
import { installItem } from '../lib/place';
import { InventoryItemDialog } from './inventory-item-dialog';

const SELECT_CLASS =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/** Latest details of a node, so a write here does not undo one made elsewhere a moment ago. */
const latestDetails = (nodeId: string) =>
  useBuilderStore.getState().hardwareNodes.find(node => node.id === nodeId)?.details ?? {};

/**
 * The physical machine behind a device on the canvas. The device's name is its
 * role in this project; the machine is an item of the owner's inventory, and
 * the two are told apart here. A device that is nobody's yet can be linked to
 * an item, or become one.
 */
export function NodeAssetField({ node }: { node: HardwareNode }) {
  const { data } = useInventory();
  const hardwareNodes = useBuilderStore(state => state.hardwareNodes);
  const updateHardware = useBuilderStore(state => state.updateHardware);
  const [adding, setAdding] = useState<Partial<InventoryInput> | null>(null);
  const [editing, setEditing] = useState<InventoryItem | null>(null);

  const items = useMemo(() => data?.items ?? [], [data]);
  const usage = useMemo(() => canvasUsage(hardwareNodes), [hardwareNodes]);
  const assetId = assetIdOf(node.details);
  const item = assetId ? items.find(entry => entry.id === assetId) : undefined;
  const hint = useMemo(
    () => ramUpgradeHints(hardwareNodes, items, usage).find(entry => entry.nodeId === node.id),
    [hardwareNodes, items, usage, node.id],
  );

  if (!canBeInventoried(node.type)) return null;

  // Machines of this kind that are not on this canvas yet.
  const type = node.type === 'server' ? 'server_v2' : node.type;
  const free = items.filter(
    entry =>
      entry.kind === 'device' &&
      entry.type === type &&
      entry.status !== 'sold' &&
      entry.status !== 'broken' &&
      !usage.has(entry.id),
  );

  const link = (target: InventoryItem) => {
    const asset = inventoryItemToDragData(target).details;
    const current = latestDetails(node.id);
    // The machine says what it is made of; what the plan already says of the
    // device's role (ports in use, rack slot, what it routes) stays.
    updateHardware(node.id, {
      details: { ...asset, ...current, inventory_item_id: target.id, inventory_label: target.name },
      ...(node.mac_address ? {} : { mac_address: target.mac_addresses[0] }),
    });
    toast.success(`${node.name} is your ${target.name}.`);
  };

  const unlink = () => {
    updateHardware(node.id, { details: withoutAssetLink(latestDetails(node.id)) });
  };

  const useMemory = () => {
    if (!hint) return;
    const result = installItem(node.id, hint.item, hint.units);
    (result.ok ? toast.success : toast.error)(result.message);
  };

  const label = node.details?.inventory_label;

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium">Physical machine</span>
        {assetId && (
          <button
            type="button"
            className="text-[10px] text-muted-foreground underline underline-offset-2 hover:cursor-pointer hover:text-foreground"
            onClick={unlink}
          >
            Unlink
          </button>
        )}
      </div>

      {assetId ? (
        <div className="text-xs">
          {item ? (
            <>
              <button
                type="button"
                className="text-left font-semibold underline-offset-2 hover:cursor-pointer hover:underline"
                onClick={() => setEditing(item)}
                title="Edit the item"
              >
                {item.name}
              </button>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Yours. {statusLabel(item.state)}, kept {keptWhere(item.location)}.
                {item.deployment
                  ? ` Runs as ${item.deployment.ref}${item.deployment.online === true ? ', online' : item.deployment.online === false ? ', offline' : ''}.`
                  : ''}
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">{label || 'An item of an inventory'}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {data ? 'This item is no longer in your inventory.' : 'Loading your inventory…'}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Not one of your machines yet, so it counts as something to buy.
          </p>
          {free.length > 0 && (
            <select
              aria-label="Link to a machine you own"
              className={SELECT_CLASS}
              value=""
              onChange={event => {
                const target = free.find(entry => entry.id === event.target.value);
                if (target) link(target);
              }}
            >
              <option value="">This is one of mine…</option>
              {free.map(entry => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-full text-xs"
            onClick={() => setAdding(nodeToInventoryInput(node))}
          >
            I own this: add it to my inventory
          </Button>
        </div>
      )}

      {hint && (
        <div className="border-t pt-2 text-[11px] leading-relaxed">
          <p>{upgradeHintText(hint)}</p>
          {!hint.fits && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              What memory they are is not noted on both sides: check that the modules fit the
              machine.
            </p>
          )}
          <Button size="sm" className="mt-2 h-7 text-xs" onClick={useMemory}>
            Put it in
          </Button>
        </div>
      )}

      <InventoryItemDialog
        open={adding !== null || editing !== null}
        onOpenChange={open => {
          if (!open) {
            setAdding(null);
            setEditing(null);
          }
        }}
        item={editing}
        initial={adding ?? undefined}
        onSaved={saved => {
          // A device that was just added to the inventory is that item.
          if (adding)
            link({
              ...saved,
              placements: saved.placements ?? [],
              mac_addresses: saved.mac_addresses ?? [],
            });
        }}
      />
    </div>
  );
}
