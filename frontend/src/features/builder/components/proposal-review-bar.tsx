import { useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, ListChecks, Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import type { Proposal, ProposalStatus } from '../api/proposals';
import { proposerName } from '../lib/proposal-text';
import { useBuilderStore } from '../store/builder-store';

type ProposalReviewBarProps = {
  /** Which action is running, if any; disables the buttons. */
  busy: 'apply' | 'reject' | null;
  onApply: () => void;
  onReject: (reason: string) => void;
  onClose: () => void;
  /** Opens the list of changes in the side panel, when there is one to open. */
  onShowChanges?: () => void;
};

const SETTLED: Record<Exclude<ProposalStatus, 'pending'>, string> = {
  applied: 'Already applied.',
  rejected: 'Rejected.',
  superseded: 'Replaced by a newer proposal.',
  conflict: 'No longer fits the build.',
};

/**
 * The bar under the canvas while a proposal is reviewed. The canvas above it
 * shows the build as it would be; this is where the owner steps through the
 * changes and applies or rejects them. Nothing is saved before Apply.
 */
export function ProposalReviewBar(props: ProposalReviewBarProps) {
  const proposal = useBuilderStore(state => state.proposalPreview?.proposal);
  const changed = useBuilderStore(state => state.proposalPreview?.changedNodeIds);
  if (!proposal || !changed) return null;
  // Keyed by the proposal: a different one starts from the overview again.
  return <ReviewBar key={proposal.id} proposal={proposal} changed={changed} {...props} />;
}

function ReviewBar({
  proposal,
  changed,
  busy,
  onApply,
  onReject,
  onClose,
  onShowChanges,
}: ProposalReviewBarProps & { proposal: Proposal; changed: string[] }) {
  const focusProposalNodes = useBuilderStore(state => state.focusProposalNodes);
  // Which change the canvas is looking at; -1 while it shows all of them.
  const [position, setPosition] = useState(-1);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const pending = proposal.status === 'pending';
  const total = proposal.diff.counts.total;

  const step = (delta: number) => {
    if (changed.length === 0) return;
    const next = position < 0 && delta < 0 ? changed.length - 1 : (position + delta + changed.length) % changed.length;
    setPosition(next);
    focusProposalNodes([changed[next]]);
  };

  const submitRejection = (event: FormEvent) => {
    event.preventDefault();
    onReject(reason.trim());
  };

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4"
      data-hide-export="true"
    >
      <div
        role="region"
        aria-label="Proposal review"
        className="proposal-review-bar builder-glass-panel pointer-events-auto flex max-w-full flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Sparkles className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 max-w-64">
          <p className="truncate text-sm font-medium">
            {proposerName(proposal)} proposes {total} {total === 1 ? 'change' : 'changes'}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {pending
              ? 'This is a preview. Nothing is saved until you apply.'
              : SETTLED[proposal.status as Exclude<ProposalStatus, 'pending'>]}
          </p>
        </div>

        {changed.length > 1 && (
          <div className="flex items-center gap-0.5" role="group" aria-label="Step through the changes">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => step(-1)}
              aria-label="Previous change"
              title="Previous change"
            >
              <ChevronLeft />
            </Button>
            <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">
              {position < 0 ? `${changed.length} places` : `${position + 1} of ${changed.length}`}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => step(1)}
              aria-label="Next change"
              title="Next change"
            >
              <ChevronRight />
            </Button>
          </div>
        )}

        {onShowChanges && (
          <Button variant="ghost" size="sm" onClick={onShowChanges} title="List every change">
            <ListChecks aria-hidden="true" />
            Details
          </Button>
        )}

        {pending &&
          (rejecting ? (
            <form className="flex items-center gap-2" onSubmit={submitRejection}>
              <Input
                autoFocus
                value={reason}
                onChange={event => setReason(event.target.value)}
                maxLength={500}
                placeholder="Why not? (optional)"
                aria-label="Reason for rejecting"
                className="h-8 w-52 text-xs"
              />
              <Button type="submit" size="sm" variant="destructive" disabled={busy !== null}>
                {busy === 'reject' && <Loader2 className="animate-spin" />}
                Reject
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                Back
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRejecting(true)}
                disabled={busy !== null}
              >
                Reject
              </Button>
              <Button size="sm" onClick={onApply} disabled={busy !== null}>
                {busy === 'apply' && <Loader2 className="animate-spin" />}
                Apply
              </Button>
            </div>
          ))}

        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={onClose}
          aria-label="Close the review"
          title="Close the review (Esc)"
        >
          <X />
        </Button>
      </div>
    </div>
  );
}
