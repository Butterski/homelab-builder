import { GitPullRequestArrow, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ProposalStatus, ProposalSummary } from '@/features/builder/api/proposals';

/** "closed" is used when a proposal is known to be settled but not how. */
export type ProposalCardStatus = ProposalStatus | 'closed';

const STATUS: Record<ProposalCardStatus, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  pending: { label: 'Waiting for you', variant: 'default' },
  applied: { label: 'Applied', variant: 'secondary' },
  rejected: { label: 'Rejected', variant: 'outline' },
  superseded: { label: 'Replaced by a newer proposal', variant: 'outline' },
  conflict: { label: 'No longer fits the build', variant: 'outline' },
  closed: { label: 'Closed', variant: 'outline' },
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** A short "what would change" line built from the proposal's totals. */
function describeCounts(proposal: ProposalSummary): string {
  const counts = proposal.counts;
  if (!counts) return '';
  const parts: string[] = [];
  const nodes = counts.nodes_added + counts.nodes_removed + counts.nodes_changed;
  const links = counts.connections_added + counts.connections_removed + counts.connections_changed;
  const guests = counts.vms_added + counts.vms_removed + counts.vms_changed;
  const components = counts.components_added + counts.components_removed;
  if (nodes) parts.push(plural(nodes, 'device'));
  if (links) parts.push(plural(links, 'connection'));
  if (guests) parts.push(guests === 1 ? '1 VM or container' : `${guests} VMs or containers`);
  if (components) parts.push(plural(components, 'component'));
  if (parts.length === 0) return plural(counts.total, 'change');
  return parts.join(', ');
}

type ProposalCardProps = {
  proposal: ProposalSummary;
  status: ProposalCardStatus;
  /** True while this proposal is being opened. */
  opening: boolean;
  onReview: (proposalId: string) => void;
};

/**
 * A proposal inside the chat. The assistant cannot change the build: the card
 * leads to the review, where the owner applies or rejects it.
 */
export function ProposalCard({ proposal, status, opening, onReview }: ProposalCardProps) {
  const { label, variant } = STATUS[status];
  const detail = describeCounts(proposal);
  return (
    <div className="space-y-2 rounded-md border bg-background p-3" data-testid="proposal-card">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <GitPullRequestArrow className="size-3.5 text-primary" aria-hidden="true" />
        <span>Proposal</span>
        <Badge variant={variant}>{label}</Badge>
      </div>
      <p className="text-sm font-medium">{proposal.summary || 'Proposed changes'}</p>
      {detail && <p className="text-xs text-muted-foreground">Affects {detail}.</p>}
      {status === 'rejected' && proposal.status_reason && (
        <p className="text-xs text-muted-foreground">Your reason: {proposal.status_reason}</p>
      )}
      {status === 'pending' && (
        <Button size="sm" onClick={() => onReview(proposal.id)} disabled={opening}>
          {opening && <Loader2 className="animate-spin" />}
          Review changes
        </Button>
      )}
    </div>
  );
}
