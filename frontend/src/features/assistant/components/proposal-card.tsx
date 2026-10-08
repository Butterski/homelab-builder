import { useState, type FormEvent } from 'react';
import { GitPullRequestArrow, Loader2, LocateFixed } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ProposalSummary } from '@/features/builder/api/proposals';
import { plural } from '@/lib/format';
import type { ProposalCardStatus } from '../store/assistant-store';

const STATUS: Record<ProposalCardStatus, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  pending: { label: 'Waiting for you', variant: 'default' },
  applied: { label: 'Applied', variant: 'secondary' },
  rejected: { label: 'Rejected', variant: 'outline' },
  superseded: { label: 'Replaced by a newer proposal', variant: 'outline' },
  conflict: { label: 'No longer fits the build', variant: 'outline' },
  closed: { label: 'Closed', variant: 'outline' },
};

/** How many changes a card spells out before it points at the full list. */
const SHOWN_CHANGES = 4;

/** What a proposal touches, as chips: "2 devices", "1 connection". */
function countChips(proposal: ProposalSummary): string[] {
  const counts = proposal.counts;
  if (!counts) return [];
  const chips: string[] = [];
  const nodes = counts.nodes_added + counts.nodes_removed + counts.nodes_changed;
  const links = counts.connections_added + counts.connections_removed + counts.connections_changed;
  const guests = counts.vms_added + counts.vms_removed + counts.vms_changed;
  const components = counts.components_added + counts.components_removed;
  if (nodes) chips.push(plural(nodes, 'device'));
  if (links) chips.push(plural(links, 'connection'));
  if (guests) chips.push(guests === 1 ? '1 VM or container' : `${guests} VMs or containers`);
  if (components) chips.push(plural(components, 'component'));
  if (counts.plan_changed) chips.push('plan');
  if (chips.length === 0 && counts.total) chips.push(plural(counts.total, 'change'));
  return chips;
}

/** What the card can do while its proposal is the one shown on the canvas. */
export type ProposalReview = {
  /** The changes in words, in the order the canvas reveals them. */
  changes: string[];
  busy: 'apply' | 'reject' | null;
  onApply: () => void;
  onReject: (reason: string) => void;
  /** Brings the changed devices back into view. */
  onLocate: () => void;
  /** Opens the full list of changes. */
  onShowAll: () => void;
};

type ProposalCardProps = {
  proposal: ProposalSummary;
  status: ProposalCardStatus;
  /** The reason given when it was rejected, as far as this session knows it. */
  reason?: string;
  /** True while a proposal review is being opened. */
  opening: boolean;
  onReview: (proposalId: string) => void;
  /** Set while this proposal is open on the canvas. */
  review?: ProposalReview;
};

/**
 * A proposal inside the chat. The assistant cannot change the build: the
 * canvas shows what it suggests, and the owner applies or rejects it, here or
 * in the bar under the canvas.
 */
export function ProposalCard({ proposal, status, reason, opening, onReview, review }: ProposalCardProps) {
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState('');
  const { label, variant } = STATUS[status];
  const chips = countChips(proposal);
  const shownReason = reason ?? proposal.status_reason;
  const pending = status === 'pending';

  const submitRejection = (event: FormEvent) => {
    event.preventDefault();
    review?.onReject(why.trim());
  };

  return (
    <div
      className="space-y-2 rounded-md border bg-background p-3"
      data-testid="proposal-card"
      data-status={status}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <GitPullRequestArrow className="size-3.5 text-primary" aria-hidden="true" />
        <span>Proposal</span>
        <Badge variant={variant}>{label}</Badge>
      </div>
      <p className="break-words text-sm font-medium">{proposal.summary || 'Proposed changes'}</p>
      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="What it affects">
          {chips.map(chip => (
            <li key={chip} className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
              {chip}
            </li>
          ))}
        </ul>
      )}

      {pending && review && review.changes.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {review.changes.slice(0, SHOWN_CHANGES).map((change, index) => (
            <li key={index} className="truncate" title={change}>
              {change}
            </li>
          ))}
          {review.changes.length > SHOWN_CHANGES && (
            <li>
              <button
                type="button"
                onClick={review.onShowAll}
                className="text-primary underline-offset-2 hover:cursor-pointer hover:underline focus-visible:outline-none focus-visible:underline"
              >
                and {review.changes.length - SHOWN_CHANGES} more: show all
              </button>
            </li>
          )}
        </ul>
      )}

      {status === 'rejected' && shownReason && (
        <p className="break-words text-xs text-muted-foreground">Your reason: {shownReason}</p>
      )}

      {pending && !review && (
        <Button size="sm" onClick={() => onReview(proposal.id)} disabled={opening}>
          {opening && <Loader2 className="animate-spin" />}
          Review on the canvas
        </Button>
      )}

      {pending && review && !rejecting && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={review.onApply} disabled={review.busy !== null}>
            {review.busy === 'apply' && <Loader2 className="animate-spin" />}
            Apply
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRejecting(true)}
            disabled={review.busy !== null}
          >
            Reject
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={review.onLocate}
            title="Show the changes on the canvas"
          >
            <LocateFixed aria-hidden="true" />
            Show
          </Button>
        </div>
      )}

      {pending && review && rejecting && (
        <form className="space-y-2" onSubmit={submitRejection}>
          <Input
            autoFocus
            value={why}
            onChange={event => setWhy(event.target.value)}
            maxLength={500}
            placeholder="What should be different? (optional)"
            aria-label="Reason for rejecting"
            className="h-8 text-xs"
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" variant="destructive" disabled={review.busy !== null}>
              {review.busy === 'reject' && <Loader2 className="animate-spin" />}
              Reject
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              Back
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            The assistant is told your reason with your next message.
          </p>
        </form>
      )}
    </div>
  );
}
