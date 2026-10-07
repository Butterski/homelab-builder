import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useInventory, type InventoryItem } from '@/features/inventory/api/inventory';
import { InventoryItemDialog } from '@/features/inventory/components/inventory-item-dialog';
import { formatGB } from '@/features/inventory/lib/inventory';
import {
  useCreateItemFromHost,
  useImportPlan,
  useLinkHost,
  type ImportHost,
  type Integration,
} from '../api/integrations';
import { formatMemory } from '../lib/import-selection';

const SELECT_CLASS =
  'h-8 max-w-48 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

/** Machines that can be a hypervisor. */
const HOST_TYPES = new Set(['server_v2', 'minipc', 'pc', 'sbc', 'nas']);

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

function hostStorageGb(host: ImportHost): number {
  const local = host.storage
    .filter(storage => !storage.shared)
    .reduce((sum, storage) => sum + storage.total_gb, 0);
  return Math.round(local || host.facts.disk_gb || 0);
}

type HostRowProps = {
  host: ImportHost;
  /** Items the host could be linked to by hand. */
  choices: InventoryItem[];
  busy: boolean;
  onLink: (node: string, itemId: string | null) => void;
  onCreate: (node: string) => void;
};

function InventoryCell({ host, choices, busy, onLink, onCreate }: HostRowProps) {
  const best = host.suggestions[0];
  const others = choices.filter(item => item.id !== best?.item_id);

  const manual = (label: string) =>
    others.length > 0 && (
      <select
        aria-label={`${label} for ${host.node}`}
        className={SELECT_CLASS}
        value=""
        disabled={busy}
        onChange={event => event.target.value && onLink(host.node, event.target.value)}
      >
        <option value="">{label}</option>
        {others.map(item => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    );

  if (host.linked_item) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{host.linked_item.name}</span>
        <button
          type="button"
          className="app-link text-muted-foreground hover:cursor-pointer"
          disabled={busy}
          onClick={() => onLink(host.node, null)}
        >
          Unlink
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {best ? (
        <div>
          <p>
            <span className="font-medium">{best.item_name}</span>{' '}
            <span className="app-figure text-muted-foreground">{best.confidence}% match</span>
          </p>
          <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
            {best.reasons.map(reason => (
              <li key={reason.text} className={cn(!reason.agrees && 'text-status-warn')}>
                {reason.text}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground">Nothing in your inventory looks like this machine.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {best && (
          <Button size="sm" disabled={busy} onClick={() => onLink(host.node, best.item_id)}>
            Link
          </Button>
        )}
        {manual(best ? 'Choose another' : 'Match manually')}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onCreate(host.node)}>
          Add to inventory
        </Button>
      </div>
    </div>
  );
}

type ProxmoxHostsProps = {
  integration: Integration;
};

/**
 * The hosts a cluster reported, each beside the machine in the inventory it is
 * or may be. A match is offered with its reasons and never made by itself: the
 * owner links, picks another item, or adds the host as a new one.
 */
export function ProxmoxHosts({ integration }: ProxmoxHostsProps) {
  const plan = useImportPlan(integration.id, null, {});
  const inventory = useInventory();
  const linkHost = useLinkHost(integration.id);
  const createItem = useCreateItemFromHost(integration.id);
  const [editing, setEditing] = useState<InventoryItem | null>(null);

  // What can be linked by hand: machines that are not the machine of another host.
  const choices = useMemo(
    () =>
      (inventory.data?.items ?? []).filter(
        item =>
          item.kind === 'device' &&
          HOST_TYPES.has(item.type) &&
          item.status !== 'sold' &&
          item.status !== 'broken' &&
          !item.integration_ref,
      ),
    [inventory.data],
  );
  const busy = linkHost.isPending || createItem.isPending;

  const link = (node: string, itemId: string | null) => {
    linkHost.mutate(
      { node, itemId },
      {
        onSuccess: () =>
          toast.success(itemId ? `Linked ${node} to its machine.` : `Unlinked ${node}.`),
        onError: cause => toast.error(messageOf(cause, 'The link could not be changed.')),
      },
    );
  };

  // The cluster knows the figures; what the box is, only its owner does.
  const create = (node: string) => {
    createItem.mutate(
      { node },
      {
        onSuccess: item => {
          toast.success(`Added ${item.name} to your inventory. Say what machine it is.`);
          setEditing({ ...item, placements: item.placements ?? [] });
        },
        onError: cause => toast.error(messageOf(cause, 'The item could not be added.')),
      },
    );
  };

  if (plan.isLoading)
    return <p className="text-sm text-muted-foreground">Reading what the cluster reported…</p>;
  if (plan.isError || !plan.data) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {messageOf(plan.error, 'Nothing has been read from this integration yet.')}
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Say which machine of your inventory each host is. A linked machine shows in the inventory as
        in use, with what runs on it, and an import puts it on the canvas as that machine.
      </p>
      {plan.data.notes.map(note => (
        <p key={note} className="border-l-2 border-status-warn pl-3 text-sm text-muted-foreground">
          {note}
        </p>
      ))}
      <div className="app-table-scroll">
        <table className="app-table min-w-[50rem]">
          <thead>
            <tr>
              <th scope="col">Host</th>
              <th scope="col">Processor</th>
              <th scope="col">Memory</th>
              <th scope="col">Storage</th>
              <th scope="col" className="is-end">
                Guests
              </th>
              <th scope="col">In your inventory</th>
            </tr>
          </thead>
          <tbody>
            {plan.data.hosts.map(host => (
              <tr key={host.node}>
                <th scope="row">
                  <span className="app-figure">{host.node}</span>
                  <span
                    className={cn(
                      'block text-xs font-normal',
                      host.online ? 'text-status-ok' : 'text-status-warn',
                    )}
                  >
                    {host.online ? 'Online' : 'Offline'}
                    {host.facts.version ? (
                      <span className="text-muted-foreground">, PVE {host.facts.version}</span>
                    ) : null}
                  </span>
                </th>
                <td>
                  {host.facts.cpu_model || <span className="text-muted-foreground">Not read</span>}
                  {host.facts.threads > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      {host.facts.cores ? `${host.facts.cores} cores, ` : ''}
                      {host.facts.threads} threads
                    </span>
                  )}
                </td>
                <td className="is-figure">
                  {host.facts.memory_mb ? formatMemory(host.facts.memory_mb) : ''}
                </td>
                <td className="is-figure">{formatGB(hostStorageGb(host))}</td>
                <td className="is-figure is-end">{host.guests.length}</td>
                <td>
                  <InventoryCell
                    host={host}
                    choices={choices}
                    busy={busy}
                    onLink={link}
                    onCreate={create}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <InventoryItemDialog
        open={editing !== null}
        onOpenChange={open => !open && setEditing(null)}
        item={editing}
      />
    </div>
  );
}
