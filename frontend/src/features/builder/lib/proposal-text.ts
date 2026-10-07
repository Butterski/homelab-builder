import type { ProposalSummary } from '../api/proposals';

/** Who a proposal is from, as the builder says it. */
export function proposerName(proposal: Pick<ProposalSummary, 'source' | 'source_label'>): string {
  if (proposal.source === 'chat') return 'The assistant';
  if (proposal.source === 'import') return proposal.source_label || 'An import';
  return proposal.source_label || 'An MCP client';
}
