import { formatDistance } from 'date-fns';
import type {
  GuestRow,
  ImportDecision,
  ImportHost,
  ImportPlan,
  Integration,
  ProxmoxSummary,
} from '../api/integrations';

/** Whether an integration is in order: read, and the last reading did not fail. */
export const integrationHealthy = (integration: Pick<Integration, 'summary' | 'last_error'>) =>
  !!integration.summary && !integration.last_error;

/**
 * What the owner takes over from a comparison. Each difference has a default
 * (bring the plan in line with what runs, and never remove anything by
 * itself); what is kept here is only where the owner said otherwise, so a
 * comparison that is made again keeps their ticks.
 */
export type Overrides = Record<string, boolean>;

export const guestKey = (row: GuestRow) =>
  row.state === 'missing'
    ? `remove:${row.planned_id}`
    : `${row.state === 'matched' ? 'update' : 'add'}:${row.vmid}`;
export const specsKey = (host: ImportHost) => `specs:${host.node}`;

/** Whether a planned host's figures differ from the machine's. */
export const specsDiffer = (host: ImportHost) =>
  !!host.planned_id &&
  [host.cpus, host.ram_gb, host.storage_gb].some(figure => figure.state === 'differs');

/** What happens to a guest unless the owner says otherwise. */
export function guestDefault(row: GuestRow): boolean {
  if (row.state === 'discovered') return row.status !== 'stopped';
  if (row.state === 'matched') return row.differs;
  // Planned and not found: it may run inside a virtual machine, or be planned for later.
  return false;
}

/** Whether a guest's change is chosen. A matched guest that does not differ has nothing to choose. */
export function guestChosen(row: GuestRow, overrides: Overrides): boolean {
  if (row.state === 'matched' && !row.differs) return false;
  return overrides[guestKey(row)] ?? guestDefault(row);
}

export function specsChosen(host: ImportHost, overrides: Overrides): boolean {
  if (!specsDiffer(host)) return false;
  return overrides[specsKey(host)] ?? true;
}

/** Whether the host is new to the plan and will come in as a device. */
export const isNewHost = (host: ImportHost) => !host.skipped && !host.planned_id;

/** A host that is already in the plan but does not say yet which Proxmox host it is. */
const needsLink = (host: ImportHost) => !!host.planned_id && host.paired_by !== 'link';

export type ChangeCount = {
  hostsAdded: number;
  hostsUpdated: number;
  guestsAdded: number;
  guestsUpdated: number;
  guestsRemoved: number;
  /** What the server will count against the size of one import. */
  operations: number;
};

/** Counts what an import with these choices does. */
export function countChanges(plan: ImportPlan, overrides: Overrides): ChangeCount {
  const count: ChangeCount = {
    hostsAdded: 0,
    hostsUpdated: 0,
    guestsAdded: 0,
    guestsUpdated: 0,
    guestsRemoved: 0,
    operations: 0,
  };
  for (const host of plan.hosts) {
    if (host.skipped) continue;
    if (isNewHost(host)) {
      count.hostsAdded += 1;
      // The device and the cable to the switch.
      count.operations += 2;
    } else if (needsLink(host) || specsChosen(host, overrides)) {
      count.hostsUpdated += 1;
      count.operations += 1;
    }
    for (const row of host.guests) {
      if (!guestChosen(row, overrides)) continue;
      if (row.state === 'discovered') count.guestsAdded += 1;
      else if (row.state === 'matched') count.guestsUpdated += 1;
      else count.guestsRemoved += 1;
      count.operations += 1;
    }
  }
  // A new project starts with a router, a switch and the cable between them.
  if (!plan.build && count.operations > 0) count.operations += 3;
  return count;
}

export const totalChanges = (count: ChangeCount) =>
  count.hostsAdded +
  count.hostsUpdated +
  count.guestsAdded +
  count.guestsUpdated +
  count.guestsRemoved;

/** The choices as the server takes them. */
export function decisionOf(
  plan: ImportPlan,
  hosts: Record<string, string>,
  overrides: Overrides,
  buildName: string,
): ImportDecision {
  const decision: ImportDecision = {
    build_id: plan.build?.id ?? null,
    build_name: plan.build ? undefined : buildName.trim(),
    hosts,
    use_actual_specs: [],
    add_guests: [],
    update_guests: [],
    remove_guests: [],
  };
  for (const host of plan.hosts) {
    if (host.skipped) continue;
    if (specsChosen(host, overrides)) decision.use_actual_specs.push(host.node);
    for (const row of host.guests) {
      if (!guestChosen(row, overrides)) continue;
      if (row.state === 'discovered' && row.vmid) decision.add_guests.push(row.vmid);
      else if (row.state === 'matched' && row.vmid) decision.update_guests.push(row.vmid);
      else if (row.state === 'missing' && row.planned_id)
        decision.remove_guests.push(row.planned_id);
    }
  }
  return decision;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "Proxmox VE 8.4.1, cluster homelab, 3 nodes, 11 VMs, 7 containers". */
export function summaryLine(summary: ProxmoxSummary): string {
  return [
    summary.version ? `Proxmox VE ${summary.version}` : '',
    summary.cluster ? `cluster ${summary.cluster}` : '',
    plural(summary.nodes, 'node', 'nodes'),
    plural(summary.vms, 'VM', 'VMs'),
    plural(summary.containers, 'container', 'containers'),
  ]
    .filter(Boolean)
    .join(', ');
}

/** "3 nodes / 18 guests", for the row beside the canvas. */
export const shortSummary = (summary: ProxmoxSummary) =>
  `${plural(summary.nodes, 'node', 'nodes')} / ${plural(summary.vms + summary.containers, 'guest', 'guests')}`;

/** Megabytes as the gigabytes people say: 31985 is "31.2 GB", 4096 is "4 GB". */
export function formatMemory(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) return '0 GB';
  if (mb < 1024) return `${Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
}

/** A share of a whole as a percentage for a bar, never over 100. */
export const share = (part: number, whole: number) =>
  whole > 0 ? Math.max(0, Math.min(100, Math.round((part / whole) * 100))) : 0;

/** What is left of a whole, as a percentage: the headroom of a host. Nothing is left of an overfull one. */
export const freeShare = (used: number, whole: number) => 100 - share(used, whole);

/** In a sentence, what an import with these choices does. */
export function changeSentence(count: ChangeCount): string {
  const parts = [
    count.hostsAdded && `${plural(count.hostsAdded, 'host', 'hosts')} added`,
    count.hostsUpdated && `${plural(count.hostsUpdated, 'host', 'hosts')} updated`,
    count.guestsAdded && `${plural(count.guestsAdded, 'guest', 'guests')} added`,
    count.guestsUpdated && `${plural(count.guestsUpdated, 'guest', 'guests')} updated`,
    count.guestsRemoved && `${plural(count.guestsRemoved, 'guest', 'guests')} removed`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'Nothing to change';
}

/**
 * "5 minutes ago". The time comes from the server, whose clock may be a moment
 * ahead of the browser's: that must not read as the future.
 */
export function timeAgo(iso: string, now = Date.now()): string {
  const then = Math.min(new Date(iso).getTime(), now);
  return formatDistance(new Date(then), new Date(now), { addSuffix: true });
}
