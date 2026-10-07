import { useMemo, useState } from 'react';
import { ChevronDown, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { canNodeHostNested } from '@/lib/hardware-config';
import { useBuilderStore } from '@/features/builder/store/builder-store';
import { useInventory, type InventoryItem } from '../api/inventory';
import {
  canvasUsage,
  countedName,
  inventoryItemToDragData,
  itemFacts,
  locationLabel,
  placementOf,
  plannableItems,
  plannedElsewhere,
  statusLabel,
  unitsLeft,
  type CanvasUse,
} from '../lib/inventory';
import { installItem, placeDeviceFromItem } from '../lib/place';
import { InventoryDialog } from './inventory-dialog';
import { InventoryItemDialog } from './inventory-item-dialog';
import { ItemIcon } from './item-icon';

const OPEN_KEY = 'hlb-inventory-panel';

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== 'closed';
  } catch {
    return true;
  }
}

/**
 * What a row says under the item: where it is on this canvas, then where else
 * it runs or is planned, then how it stands and where it is kept.
 */
function stateLine(
  item: InventoryItem,
  use: CanvasUse | undefined,
  left: number,
  elsewhere: string[],
): string {
  const kept = `${statusLabel(item.state)}, ${locationLabel(item.location).toLowerCase()}`;
  if (placementOf(item) === 'node') {
    if (use) return `On this canvas as ${use.nodes[0].name}`;
    if (item.deployment) return `Runs as ${item.deployment.ref}`;
  } else {
    if (use && left === 0) return `In ${use.nodes.map(node => node.name).join(', ')}`;
    if (use) return `${left} of ${item.quantity} free`;
  }
  // Still free to place here: another project that plans it may be a variant of this one.
  if (elsewhere.length > 0) return `Planned in ${elsewhere.join(', ')}`;
  return kept;
}

function Row({
  item,
  use,
  buildId,
  onEdit,
}: {
  item: InventoryItem;
  use: CanvasUse | undefined;
  buildId: string | null;
  onEdit: (item: InventoryItem) => void;
}) {
  const kind = placementOf(item);
  const left = kind === 'node' ? (use ? 0 : 1) : Math.max(0, item.quantity - (use?.units ?? 0));
  // Memory goes in as the kit it is; anything else one at a time.
  const units = item.type === 'ram' ? left : 1;
  const free = left > 0;
  const online = item.deployment?.online;

  const act = () => {
    const store = useBuilderStore.getState();
    if (kind === 'node') {
      const result = placeDeviceFromItem(item);
      (result.ok ? toast.success : toast.info)(result.message);
      return;
    }
    if (!free) {
      const host = use?.nodes[0];
      if (host) {
        store.selectNode(host.id);
        store.requestCanvasFocus([host.id]);
      }
      return;
    }
    const host = store.hardwareNodes.find(node => node.id === store.selectedNodeId);
    if (!host || !canNodeHostNested(host.type)) {
      toast.info(`Drag ${item.name} onto a server, PC, mini PC or NAS, or select one first.`);
      return;
    }
    const result = installItem(host.id, item, units);
    (result.ok ? toast.success : toast.error)(result.message);
  };

  return (
    <li className="group flex items-start gap-1 rounded-md hover:bg-primary/5">
      <button
        type="button"
        draggable={free}
        onDragStart={event => {
          const data = inventoryItemToDragData(item, units);
          event.dataTransfer.setData('application/reactflow', data.type);
          event.dataTransfer.setData('application/reactflow-data', JSON.stringify(data));
          event.dataTransfer.effectAllowed = 'move';
        }}
        onClick={act}
        title={
          kind === 'node'
            ? free
              ? 'Drag onto the canvas, or click to add'
              : 'Show on the canvas'
            : free
              ? 'Drag onto a machine, or select one and click'
              : 'Show where it is'
        }
        className={cn(
          'flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
          free ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        )}
      >
        <ItemIcon
          type={item.type}
          className={cn(
            'mt-0.5 size-3.5 shrink-0',
            free ? 'text-primary' : 'text-muted-foreground',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-semibold leading-tight">
            {countedName(item.name, item.kind === 'device' ? 1 : item.quantity)}
          </span>
          {itemFacts(item).map(fact => (
            <span
              key={fact}
              className="block truncate font-mono text-[10px] leading-snug text-muted-foreground"
            >
              {fact}
            </span>
          ))}
          <span className="mt-0.5 flex items-center gap-1.5 text-[10px] leading-snug text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                online === true
                  ? 'bg-status-ok'
                  : online === false
                    ? 'bg-status-warn'
                    : use || item.state === 'in_use'
                      ? 'bg-foreground/60'
                      : 'border border-muted-foreground/70',
              )}
            />
            <span className="truncate">
              {stateLine(item, use, left, plannedElsewhere(item, buildId))}
              {online === true && !use ? ', online' : online === false && !use ? ', offline' : ''}
            </span>
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => onEdit(item)}
        aria-label={`Edit ${item.name}`}
        title="Edit"
        className="mt-1 grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 hover:cursor-pointer hover:bg-background/60 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100"
      >
        <Pencil className="size-3" aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * The owner's hardware beside the canvas: what they have, whether it is on this
 * canvas, and a drag away from being on it. A device becomes a node that is
 * that machine; a component goes into a machine.
 */
export function InventoryPanel() {
  const { data, isLoading, isError } = useInventory();
  const hardwareNodes = useBuilderStore(state => state.hardwareNodes);
  const buildId = useBuilderStore(state => state.currentBuildId);
  const [open, setOpen] = useState(readOpen);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const items = useMemo(() => plannableItems(data?.items ?? []), [data]);
  const usage = useMemo(() => canvasUsage(hardwareNodes), [hardwareNodes]);
  const unused = items.filter(item => unitsLeft(item, usage) > 0).length;
  const total = data?.items.length ?? 0;

  const toggle = () => {
    setOpen(current => {
      try {
        localStorage.setItem(OPEN_KEY, current ? 'closed' : 'open');
      } catch {
        // The choice is only remembered where storage is available.
      }
      return !current;
    });
  };

  return (
    <section
      className={cn(
        'flex flex-col overflow-hidden border-t',
        // With a list in it the section may shrink to one item and the link under it.
        open && items.length > 0 ? 'min-h-[7.5rem] shrink' : 'shrink-0',
      )}
      aria-label="My inventory"
    >
      <div className="flex shrink-0 items-center gap-2 px-4 py-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-bold uppercase tracking-wider hover:cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <ChevronDown
            className={cn('size-3 shrink-0 transition-transform', !open && '-rotate-90')}
            aria-hidden="true"
          />
          <span className="truncate">My inventory</span>
        </button>
        {total > 0 && (
          <span
            className="shrink-0 text-[10px] text-muted-foreground"
            title="Items that are not on this canvas yet"
          >
            {unused} unused
          </span>
        )}
        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label="Add an item to your inventory"
          title="Add an item"
          className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:cursor-pointer hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      {open && (
        <>
          {isLoading && (
            <p className="shrink-0 px-4 pb-3 text-[11px] text-muted-foreground">
              Loading your inventory…
            </p>
          )}
          {isError && (
            <p className="shrink-0 px-4 pb-3 text-[11px] text-destructive">
              Your inventory could not be loaded.
            </p>
          )}
          {!isLoading && !isError && items.length === 0 && (
            <p className="shrink-0 px-4 pb-2.5 text-[11px] leading-snug text-muted-foreground">
              {total === 0
                ? 'List the hardware you own, then drag it onto the canvas.'
                : 'Nothing here can be placed. Cables, sold and broken items are in the full list.'}
            </p>
          )}
          {items.length > 0 && (
            // As tall as three items and a half; in a short window it shrinks to
            // one, before the catalog above loses its room.
            <ul className="max-h-56 min-h-14 space-y-0.5 overflow-y-auto px-2 pb-1">
              {items.map(item => (
                <Row
                  key={item.id}
                  item={item}
                  use={usage.get(item.id)}
                  buildId={buildId}
                  onEdit={setEditing}
                />
              ))}
            </ul>
          )}
          {total > 0 && (
            <div className="shrink-0 px-4 pb-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="text-[10px] font-medium text-muted-foreground underline underline-offset-2 hover:cursor-pointer hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                View all inventory ({total})
              </button>
            </div>
          )}
        </>
      )}

      <InventoryItemDialog
        open={adding || editing !== null}
        onOpenChange={next => {
          if (!next) {
            setAdding(false);
            setEditing(null);
          }
        }}
        item={editing}
      />
      <InventoryDialog open={showAll} onOpenChange={setShowAll} />
    </section>
  );
}
