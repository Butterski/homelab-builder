import { useState, type ReactNode } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, Check, CircleAlert, Loader2, Minus, Pencil, Plus, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Textarea } from '../../../components/ui/textarea';
import { cn } from '../../../lib/utils';
import { useBuilderStore } from '../store/builder-store';
import type { ConnectionDiff, FieldChange, Proposal, ProposalStatus } from '../api/proposals';
import { buildKindInfo } from '../../gaming/lib/kind';
import type { BuildKind, PowerCircuit } from '../../../types';

type ProposalReviewPanelProps = {
  /** Which action is running, if any; disables the buttons. */
  busy: 'apply' | 'reject' | null;
  onApply: () => void;
  onReject: (reason: string) => void;
  onClose: () => void;
};

const STATUS_TEXT: Record<Exclude<ProposalStatus, 'pending'>, string> = {
  applied: 'This proposal was already applied.',
  rejected: 'This proposal was rejected.',
  superseded: 'A newer proposal replaced this one.',
  conflict: 'This proposal no longer fits the build.',
};

function sourceText(proposal: Proposal): string {
  if (proposal.source === 'chat') return 'In-app assistant';
  return proposal.source_label ? `${proposal.source_label} · MCP` : 'MCP client';
}

const PLAN_LABELS: Record<string, string> = {
  kind: 'Planned as',
  'uplink.down_mbps': 'Download (Mbps)',
  'uplink.up_mbps': 'Upload (Mbps)',
  'uplink.cgnat': 'Carrier-grade NAT',
  'uplink.public_host': 'Address friends connect to',
  'power.mains_voltage': 'Mains voltage',
  'power.circuits': 'Power circuits',
  'event.date': 'Date',
  'event.hours': 'Length (hours)',
};

function fieldLabel(field: string): string {
  return PLAN_LABELS[field] ?? field.replace(/^details\./, '').replace(/_/g, ' ');
}

/** Says a plan value the way the Game plan dialog shows it. */
function planValue(change: FieldChange, value: unknown): unknown {
  if (change.field === 'kind') return buildKindInfo(value as BuildKind).label;
  if (change.field === 'power.circuits' && Array.isArray(value)) {
    const circuits = value as PowerCircuit[];
    if (circuits.length === 0) return '';
    return circuits
      .map(circuit => `${circuit.label || circuit.id} ${circuit.breaker_amps} A`)
      .join(', ');
  }
  return value;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'none';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'object') {
    const position = value as { x?: number; y?: number };
    if (typeof position.x === 'number' && typeof position.y === 'number') {
      return `${Math.round(position.x)}, ${Math.round(position.y)}`;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function connectionText(link: ConnectionDiff): string {
  const port = link.source_handle && link.source_handle !== 'target-0' ? ` ${link.source_handle}` : '';
  return `${link.source_name}${port} → ${link.target_name}`;
}

type Kind = 'added' | 'changed' | 'removed';

const KIND_STYLE: Record<Kind, { icon: typeof Plus; className: string }> = {
  added: { icon: Plus, className: 'text-green-500' },
  changed: { icon: Pencil, className: 'text-amber-500' },
  removed: { icon: Minus, className: 'text-red-500' },
};

function Row({
  kind,
  title,
  detail,
  changes,
  onFocus,
}: {
  kind: Kind;
  title: string;
  detail?: string;
  changes?: FieldChange[];
  onFocus?: () => void;
}) {
  const { icon: Icon, className } = KIND_STYLE[kind];
  const body = (
    <>
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', className)} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{title}</span>
        {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
        {changes?.map(change => (
          <span key={change.field} className="block text-xs text-muted-foreground">
            <span className="text-foreground/80">{fieldLabel(change.field)}:</span>{' '}
            <span className="line-through opacity-70">{formatValue(change.before)}</span>
            {' → '}
            <span className="text-foreground">{formatValue(change.after)}</span>
          </span>
        ))}
      </span>
    </>
  );
  if (!onFocus) {
    return <li className="flex items-start gap-2 rounded-md px-2 py-1.5">{body}</li>;
  }
  return (
    <li>
      <button
        type="button"
        onClick={onFocus}
        title="Show on the preview"
        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:cursor-pointer hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {body}
      </button>
    </li>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section>
      <h4 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title} <span className="font-normal">({count})</span>
      </h4>
      <ul className="space-y-0.5">{children}</ul>
    </section>
  );
}

/**
 * Side panel listing what a proposal changes. The owner applies or rejects it
 * here; this is the only place an LLM's suggestion becomes part of the build.
 */
export function ProposalReviewPanel({ busy, onApply, onReject, onClose }: ProposalReviewPanelProps) {
  const preview = useBuilderStore(s => s.proposalPreview);
  const focusProposalNodes = useBuilderStore(s => s.focusProposalNodes);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  if (!preview) return null;
  const { proposal, validationIssues } = preview;
  const diff = proposal.diff;
  const planChanges = diff.plan ?? [];
  const pending = proposal.status === 'pending';
  const errors = validationIssues.filter(issue => issue.type === 'error');
  const warnings = validationIssues.filter(issue => issue.type === 'warning');
  const focus = (...ids: string[]) => () => focusProposalNodes(ids);

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label="Proposed changes">
      <header className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Proposed changes</h3>
          <p className="truncate text-xs text-muted-foreground">
            {sourceText(proposal)} ·{' '}
            {formatDistanceToNow(new Date(proposal.created_at), { addSuffix: true })}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={onClose}
          aria-label="Close preview"
          title="Close preview (Esc)"
        >
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 py-3">
        {proposal.summary && <p className="px-2 text-sm leading-relaxed">{proposal.summary}</p>}

        {!pending && (
          <div className="mx-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
            <span>
              {STATUS_TEXT[proposal.status as Exclude<ProposalStatus, 'pending'>]}
              {proposal.status_reason && (
                <span className="mt-1 block text-muted-foreground">{proposal.status_reason}</span>
              )}
            </span>
          </div>
        )}

        {(errors.length > 0 || warnings.length > 0) && (
          <section className="mx-2 space-y-1 rounded-md border px-3 py-2 text-xs">
            <h4 className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle
                className={cn('size-3.5', errors.length ? 'text-red-500' : 'text-amber-500')}
                aria-hidden="true"
              />
              Network check after applying
            </h4>
            {[...errors, ...warnings].map((issue, index) => (
              <p
                key={`${issue.node_id}-${index}`}
                className={issue.type === 'error' ? 'text-red-500' : 'text-muted-foreground'}
              >
                {issue.message}
              </p>
            ))}
          </section>
        )}

        {diff.build_name && (
          <Group title="Project" count={1}>
            <Row kind="changed" title="Rename project" changes={[diff.build_name]} />
          </Group>
        )}

        <Group title="Game plan" count={planChanges.length}>
          <Row
            kind="changed"
            title="Plan settings"
            changes={planChanges.map(change => ({
              field: change.field,
              before: planValue(change, change.before),
              after: planValue(change, change.after),
            }))}
          />
        </Group>

        <Group
          title="Devices"
          count={diff.nodes.added.length + diff.nodes.changed.length + diff.nodes.removed.length}
        >
          {diff.nodes.added.map(node => (
            <Row
              key={node.id}
              kind="added"
              title={node.name}
              detail={[node.type.replace(/_/g, ' '), node.ip].filter(Boolean).join(' · ')}
              onFocus={focus(node.id)}
            />
          ))}
          {diff.nodes.changed.map(node => (
            <Row
              key={node.id}
              kind="changed"
              title={node.name}
              changes={node.changes}
              onFocus={focus(node.id)}
            />
          ))}
          {diff.nodes.removed.map(node => (
            <Row
              key={node.id}
              kind="removed"
              title={node.name}
              detail={node.type.replace(/_/g, ' ')}
              onFocus={focus(node.id)}
            />
          ))}
        </Group>

        <Group
          title="Connections"
          count={
            diff.connections.added.length +
            diff.connections.changed.length +
            diff.connections.removed.length
          }
        >
          {diff.connections.added.map(link => (
            <Row
              key={`${link.source}-${link.target}`}
              kind="added"
              title={connectionText(link)}
              detail={[link.type, link.speed].filter(Boolean).join(' · ')}
              onFocus={focus(link.source, link.target)}
            />
          ))}
          {diff.connections.changed.map(link => (
            <Row
              key={`${link.source}-${link.target}`}
              kind="changed"
              title={connectionText(link)}
              changes={link.changes}
              onFocus={focus(link.source, link.target)}
            />
          ))}
          {diff.connections.removed.map(link => (
            <Row
              key={`${link.source}-${link.target}`}
              kind="removed"
              title={connectionText(link)}
              onFocus={focus(link.source, link.target)}
            />
          ))}
        </Group>

        <Group
          title="Services and VMs"
          count={diff.vms.added.length + diff.vms.changed.length + diff.vms.removed.length}
        >
          {diff.vms.added.map(vm => (
            <Row
              key={vm.id}
              kind="added"
              title={vm.name}
              detail={[`on ${vm.host_name}`, vm.type, vm.ip].filter(Boolean).join(' · ')}
              onFocus={focus(vm.host_id)}
            />
          ))}
          {diff.vms.changed.map(vm => (
            <Row
              key={vm.id}
              kind="changed"
              title={vm.name}
              detail={`on ${vm.host_name}`}
              changes={vm.changes}
              onFocus={focus(vm.host_id)}
            />
          ))}
          {diff.vms.removed.map(vm => (
            <Row
              key={vm.id}
              kind="removed"
              title={vm.name}
              detail={`on ${vm.host_name}`}
              onFocus={focus(vm.host_id)}
            />
          ))}
        </Group>

        <Group
          title="Components"
          count={diff.components.added.length + diff.components.removed.length}
        >
          {diff.components.added.map(component => (
            <Row
              key={component.id}
              kind="added"
              title={component.name}
              detail={`${component.type} in ${component.host_name}`}
              onFocus={focus(component.host_id)}
            />
          ))}
          {diff.components.removed.map(component => (
            <Row
              key={component.id}
              kind="removed"
              title={component.name}
              detail={`${component.type} in ${component.host_name}`}
              onFocus={focus(component.host_id)}
            />
          ))}
        </Group>

        <Group title="Addresses that change" count={diff.ip_changes.length}>
          {diff.ip_changes.map(change => (
            <Row
              key={`${change.kind}-${change.id}`}
              kind="changed"
              title={change.name}
              changes={[{ field: 'address', before: change.before, after: change.after }]}
              onFocus={change.kind === 'node' ? focus(change.id) : undefined}
            />
          ))}
        </Group>
      </div>

      <footer className="space-y-2 border-t px-4 py-3">
        {pending && rejecting && (
          <div className="space-y-2">
            <label htmlFor="proposal-reject-reason" className="text-xs text-muted-foreground">
              Tell the assistant what to do differently (optional)
            </label>
            <Textarea
              id="proposal-reject-reason"
              value={reason}
              onChange={event => setReason(event.target.value)}
              maxLength={500}
              rows={3}
              autoFocus
              placeholder="e.g. Use the mini PC instead of adding a new server"
            />
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                className="flex-1"
                disabled={busy !== null}
                onClick={() => onReject(reason)}
              >
                {busy === 'reject' ? <Loader2 className="animate-spin" /> : <X />}
                Reject proposal
              </Button>
              <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setRejecting(false)}>
                Back
              </Button>
            </div>
          </div>
        )}
        {pending && !rejecting && (
          <div className="flex gap-2">
            <Button className="flex-1" disabled={busy !== null} onClick={onApply}>
              {busy === 'apply' ? <Loader2 className="animate-spin" /> : <Check />}
              Apply changes
            </Button>
            <Button variant="outline" disabled={busy !== null} onClick={() => setRejecting(true)}>
              Reject
            </Button>
          </div>
        )}
        {!pending && (
          <Button variant="outline" className="w-full" onClick={onClose}>
            Close
          </Button>
        )}
        {pending && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Applying saves these changes to your project. Ctrl+Z undoes them in one step.
          </p>
        )}
      </footer>
    </div>
  );
}
