import { Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import type { ProposalSummary } from '../api/proposals';

type ProposalBannerProps = {
  proposal: ProposalSummary;
  loading: boolean;
  onReview: () => void;
  onDismiss: () => void;
};

function proposer(proposal: ProposalSummary): string {
  if (proposal.source === 'chat') return 'The assistant';
  return proposal.source_label || 'An MCP client';
}

/** Tells the owner that an LLM client is waiting for a decision on a proposal. */
export function ProposalBanner({ proposal, loading, onReview, onDismiss }: ProposalBannerProps) {
  const total = proposal.counts?.total ?? 0;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-14 z-20 flex justify-center px-4"
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
            {proposer(proposal)} proposed {total} {total === 1 ? 'change' : 'changes'}
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
          onClick={onDismiss}
          aria-label="Hide this proposal for now"
          title="Hide for now"
        >
          <X />
        </Button>
      </div>
    </div>
  );
}
