import { useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import type { ProposalSummary } from '../api/proposals';
import { proposerName } from '../lib/proposal-text';

type ProposalBannerProps = {
  proposal: ProposalSummary;
  loading: boolean;
  onReview: () => void;
};

/**
 * Tells the owner that an LLM client is waiting for a decision on a proposal.
 * Put aside, it shrinks to a chip in the corner: the proposal is still waiting,
 * and a page reload should not be the only way to get back to it.
 */
export function ProposalBanner({ proposal, loading, onReview }: ProposalBannerProps) {
  // Which proposal was put aside; a newer one shows the banner again.
  const [asideId, setAsideId] = useState<string | null>(null);
  const total = proposal.counts?.total ?? 0;

  if (asideId === proposal.id) {
    return (
      <div className="pointer-events-none absolute bottom-16 left-4 z-20" data-hide-export="true">
        <Button
          size="sm"
          variant="outline"
          onClick={onReview}
          disabled={loading}
          className="builder-control-button pointer-events-auto h-9 gap-2 px-3"
          title={proposal.summary || 'Review the waiting proposal'}
        >
          {loading ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="text-primary" aria-hidden="true" />
          )}
          1 proposal waiting
        </Button>
      </div>
    );
  }

  return (
    <div
      // Above the library, which floats over the same corner of the canvas.
      className="pointer-events-none absolute inset-x-0 bottom-14 z-[55] flex justify-center px-4"
      data-hide-export="true"
    >
      <div
        role="status"
        className="builder-glass-panel pointer-events-auto flex max-w-xl items-center gap-3 px-3 py-2"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Sparkles className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {proposerName(proposal)} proposed {total} {total === 1 ? 'change' : 'changes'}
          </p>
          {proposal.summary && (
            <p className="truncate text-xs text-muted-foreground">{proposal.summary}</p>
          )}
        </div>
        <Button size="sm" className="shrink-0" onClick={onReview} disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          Review
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={() => setAsideId(proposal.id)}
          aria-label="Put this proposal aside for now"
          title="Not now"
        >
          <X />
        </Button>
      </div>
    </div>
  );
}
