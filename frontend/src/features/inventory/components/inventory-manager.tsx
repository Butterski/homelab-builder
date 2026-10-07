import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useInventory, type InventoryItem, type InventoryStatus } from '../api/inventory';
import {
  STATUSES,
  countByStatus,
  filterItems,
  groupItems,
  itemFacts,
  modelLine,
  statusLabel,
  typeLabel,
} from '../lib/inventory';
import { InventoryItemDialog } from './inventory-item-dialog';

type Grouping = 'location' | 'kind';

/** Where an item is planned, in a line: "Main Homelab as proxmox-01". */
function PlannedIn({ item, onNavigate }: { item: InventoryItem; onNavigate?: () => void }) {
  if (item.placements.length === 0)
    return <span className="text-muted-foreground">Not planned</span>;
  return (
    <ul className="grid gap-0.5">
      {item.placements.map(placement => (
        <li key={`${placement.build_id}-${placement.node_id}-${placement.component}`}>
          <Link to={`/builder/${placement.build_id}`} className="app-link" onClick={onNavigate}>
            {placement.build_name}
          </Link>{' '}
          <span className="text-muted-foreground">
            {placement.component ? 'in' : 'as'} {placement.node_name}
            {placement.quantity > 1 ? `, ${placement.quantity} of them` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The state of an item, and what its integration says runs on it. */
function State({ item }: { item: InventoryItem }) {
  const deployment = item.deployment;
  return (
    <>
      <span
        className={cn(
          item.state === 'in_use' && 'text-status-ok',
          item.state === 'broken' && 'text-status-warn',
          item.state === 'sold' && 'text-muted-foreground line-through',
        )}
      >
        {statusLabel(item.state)}
      </span>
      {deployment && (
        <span className="block text-xs text-muted-foreground">
          Runs as <span className="app-figure text-foreground">{deployment.ref}</span>
          {deployment.online === true && ', online'}
          {deployment.online === false && ', offline'}
          {deployment.online === null && ', not seen at the last reading'}
          {deployment.online !== null && deployment.guests > 0 && `, ${deployment.guests} guests`}
        </span>
      )}
    </>
  );
}

type InventoryManagerProps = {
  /** In a dialog the filters stand above the table instead of beside it. */
  compact?: boolean;
  /** Called when a link leads away, so a dialog around the manager can close. */
  onNavigate?: () => void;
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
};

/**
 * Everything the owner has, as a table: what it is, its figures, its state,
 * where it is kept and which projects plan it. The rows are grouped by the
 * place a thing is kept in, which is how one looks for it, or by what it is.
 */
export function InventoryManager({
  compact,
  onNavigate,
  adding,
  onAddingChange,
}: InventoryManagerProps) {
  const { data, isLoading, isError } = useInventory();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<InventoryStatus | ''>('');
  const [grouping, setGrouping] = useState<Grouping>('location');
  const [editing, setEditing] = useState<InventoryItem | null>(null);

  const all = useMemo(() => data?.items ?? [], [data]);
  const counts = useMemo(() => countByStatus(all), [all]);
  const shown = useMemo(() => filterItems(all, { status, search }), [all, status, search]);
  const groups = useMemo(() => groupItems(shown, grouping), [shown, grouping]);

  const filters = [
    { id: '' as const, label: 'Everything', count: all.length },
    ...STATUSES.map(entry => ({ id: entry.id, label: entry.label, count: counts[entry.id] })),
  ];
  const narrowed = Boolean(search.trim() || status);

  const filterRail = (
    <div className={cn('grid h-fit gap-4', !compact && 'lg:sticky lg:top-6')}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label="Search your inventory"
          placeholder="Search your inventory"
          className="pl-9"
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
      </div>
      <nav
        aria-label="Filter by state"
        className={cn('flex flex-wrap gap-2', !compact && 'lg:grid lg:gap-0.5')}
      >
        {filters.map(filter => (
          <button
            key={filter.id || 'all'}
            type="button"
            aria-pressed={status === filter.id}
            onClick={() => setStatus(filter.id)}
            className={cn(
              'flex min-h-8 shrink-0 items-center justify-between gap-3 rounded-md border px-3 text-sm transition-colors hover:cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              !compact && 'lg:w-full lg:border-transparent lg:px-2.5',
              status === filter.id
                ? cn('border-foreground font-medium text-foreground', !compact && 'lg:bg-muted')
                : cn(
                    'text-muted-foreground hover:text-foreground',
                    !compact && 'lg:hover:bg-muted/50',
                  ),
            )}
          >
            <span className="truncate">{filter.label}</span>
            <span className="app-figure text-xs font-normal text-muted-foreground">
              {filter.count}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );

  return (
    <>
      <InventoryItemDialog
        open={adding || editing !== null}
        onOpenChange={next => {
          if (!next) {
            onAddingChange(false);
            setEditing(null);
          }
        }}
        item={editing}
      />

      <div
        className={cn('grid gap-x-10 gap-y-5', !compact && 'lg:grid-cols-[13rem_minmax(0,1fr)]')}
      >
        {filterRail}

        <div className="min-w-0">
          <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="flex items-center gap-4 text-sm text-muted-foreground" aria-live="polite">
              {!isLoading && !isError && (
                <span>
                  {shown.length} {shown.length === 1 ? 'item' : 'items'}
                  {status ? `, ${statusLabel(status).toLowerCase()}` : ''}
                  {search.trim() ? ` matching “${search.trim()}”` : ''}
                </span>
              )}
              {narrowed && (
                <button
                  type="button"
                  className="app-link hover:cursor-pointer"
                  onClick={() => {
                    setSearch('');
                    setStatus('');
                  }}
                >
                  Show all
                </button>
              )}
            </p>
            {all.length > 0 && (
              <div
                className="flex items-center gap-2 text-sm text-muted-foreground"
                role="group"
                aria-label="Group the list"
              >
                <span>Group by</span>
                {(
                  [
                    ['location', 'Place'],
                    ['kind', 'Kind'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className="app-filter"
                    aria-pressed={grouping === id}
                    onClick={() => setGrouping(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="grid gap-px pt-2" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-12 animate-pulse border-b bg-muted/30" />
              ))}
            </div>
          ) : isError ? (
            <p className="pt-4 text-sm text-destructive" role="alert">
              Your inventory could not be loaded. Reload the page to try again.
            </p>
          ) : all.length === 0 ? (
            <div className="app-empty-state mt-2 px-6 py-10">
              <h2 className="font-semibold">Nothing listed yet</h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                List what you own: the machines, the switch, the memory and disks in the drawer.
                Then a project can be planned with the hardware you have, and only what is missing
                is left to buy.
              </p>
              <Button className="mt-4" onClick={() => onAddingChange(true)}>
                Add an item
              </Button>
            </div>
          ) : shown.length === 0 ? (
            <div className="app-empty-state mt-2 px-6 py-10">
              <h2 className="font-semibold">No item matches</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Try another word, or another state.
              </p>
            </div>
          ) : (
            <div className="app-table-scroll">
              <table className="app-table min-w-[46rem]">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Type</th>
                    <th scope="col">Figures</th>
                    <th scope="col">State</th>
                    <th scope="col">Planned in</th>
                    <th scope="col">
                      <span className="sr-only">Edit</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(group => (
                    <Fragment key={group.id}>
                      <tr>
                        <th
                          scope="colgroup"
                          colSpan={6}
                          className="pt-6 text-xs font-medium text-muted-foreground"
                        >
                          {group.label} <span className="app-figure">{group.items.length}</span>
                        </th>
                      </tr>
                      {group.items.map(item => (
                        <tr key={item.id}>
                          <th scope="row">
                            {item.quantity > 1 && (
                              <span className="app-figure text-muted-foreground">
                                {item.quantity}×{' '}
                              </span>
                            )}
                            {item.name}
                            {modelLine(item) &&
                              modelLine(item).toLowerCase() !== item.name.toLowerCase() && (
                                <span className="block text-xs font-normal text-muted-foreground">
                                  {modelLine(item)}
                                </span>
                              )}
                          </th>
                          <td className="whitespace-nowrap">{typeLabel(item.kind, item.type)}</td>
                          <td className="is-figure">
                            {/* The processor already stands under the name. */}
                            {itemFacts(item)
                              .filter(
                                fact => fact !== item.specs?.cpu_model && fact !== modelLine(item),
                              )
                              .join(', ')}
                          </td>
                          <td>
                            <State item={item} />
                          </td>
                          <td>
                            <PlannedIn item={item} onNavigate={onNavigate} />
                          </td>
                          <td className="is-end">
                            <button
                              type="button"
                              className="app-link hover:cursor-pointer"
                              onClick={() => setEditing(item)}
                              aria-label={`Edit ${item.name}`}
                            >
                              Edit
                            </button>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
