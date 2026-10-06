import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/builds', () => ({ buildApi: {} }));
vi.mock('../api/proposals', () => ({ proposalApi: {} }));

import type { Proposal } from '../api/proposals';
import { useBuilderStore } from '../store/builder-store';
import { ProposalBanner } from './proposal-banner';
import { ProposalReviewBar } from './proposal-review-bar';

const counts = {
  nodes_added: 1,
  nodes_removed: 1,
  nodes_changed: 1,
  connections_added: 1,
  connections_removed: 0,
  connections_changed: 0,
  vms_added: 0,
  vms_removed: 0,
  vms_changed: 0,
  components_added: 0,
  components_removed: 0,
  ip_changes: 0,
  total: 4,
};

function proposal(extra: Partial<Proposal> = {}): Proposal {
  return {
    id: 'proposal-1',
    build_id: 'build-1',
    summary: 'Swap the access point for a NAS',
    source: 'chat',
    source_label: 'In-app assistant',
    status: 'pending',
    status_reason: '',
    base_revision: 3,
    created_at: '2026-10-05T10:00:00Z',
    diff: {
      counts,
      nodes: { added: [], removed: [], changed: [] },
      connections: { added: [], removed: [], changed: [] },
      vms: { added: [], removed: [], changed: [] },
      components: { added: [], removed: [] },
      ip_changes: [],
    },
    ...extra,
  };
}

function review(value: Proposal, changedNodeIds = ['ap', 'switch', 'nas']) {
  useBuilderStore.setState({
    proposalPreview: {
      proposal: value,
      hardwareNodes: [],
      nodes: [],
      edges: [],
      validationIssues: [],
      changedNodeIds,
      focus: { ids: changedNodeIds, nonce: 0 },
    },
  });
}

const handlers = { onApply: vi.fn(), onReject: vi.fn(), onClose: vi.fn(), onShowChanges: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  useBuilderStore.setState({ proposalPreview: null });
});

describe('ProposalReviewBar', () => {
  it('is not there without a review', () => {
    const { container } = render(<ProposalReviewBar busy={null} {...handlers} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says who proposes what, and that nothing is saved yet', () => {
    review(proposal());
    render(<ProposalReviewBar busy={null} {...handlers} />);
    const bar = screen.getByRole('region', { name: 'Proposal review' });
    expect(bar).toHaveTextContent('The assistant proposes 4 changes');
    expect(bar).toHaveTextContent('Nothing is saved until you apply');
  });

  it('steps through the changed devices in the order they were revealed, both ways around', async () => {
    const user = userEvent.setup();
    review(proposal());
    render(<ProposalReviewBar busy={null} {...handlers} />);
    const focused = () => useBuilderStore.getState().proposalPreview?.focus;

    expect(screen.getByText('3 places')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next change' }));
    expect(focused()).toEqual({ ids: ['ap'], nonce: 1 });
    expect(screen.getByText('1 of 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous change' }));
    expect(focused()?.ids).toEqual(['nas']);
    await user.click(screen.getByRole('button', { name: 'Next change' }));
    expect(focused()?.ids).toEqual(['ap']);
  });

  it('applies, rejects with a reason, opens the list and closes', async () => {
    const user = userEvent.setup();
    review(proposal());
    render(<ProposalReviewBar busy={null} {...handlers} />);

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(handlers.onApply).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.type(screen.getByLabelText('Reason for rejecting'), '  Keep the access point  ');
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(handlers.onReject).toHaveBeenCalledWith('Keep the access point');

    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(handlers.onShowChanges).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close the review' }));
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it('cannot be acted on twice while an action is running', () => {
    review(proposal());
    render(<ProposalReviewBar busy="apply" {...handlers} />);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
  });

  it('only shows a proposal that is settled already', () => {
    review(proposal({ status: 'conflict', source: 'mcp', source_label: 'Claude Code' }));
    render(<ProposalReviewBar busy={null} {...handlers} />);
    const bar = screen.getByRole('region', { name: 'Proposal review' });
    expect(bar).toHaveTextContent('Claude Code proposes 4 changes');
    expect(bar).toHaveTextContent('No longer fits the build.');
    expect(within(bar).queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });
});

describe('ProposalBanner', () => {
  const waiting = { ...proposal(), counts, source: 'mcp' as const, source_label: '' };

  it('announces a waiting proposal and stays reachable when it is put aside', async () => {
    const user = userEvent.setup();
    const onReview = vi.fn();
    const { rerender } = render(<ProposalBanner proposal={waiting} loading={false} onReview={onReview} />);

    expect(screen.getByRole('status')).toHaveTextContent('An MCP client proposed 4 changes');
    await user.click(screen.getByRole('button', { name: 'Put this proposal aside for now' }));

    // Not gone: a chip is left, and it opens the review as well.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '1 proposal waiting' }));
    expect(onReview).toHaveBeenCalledTimes(1);

    // A newer proposal is announced in full again.
    rerender(<ProposalBanner proposal={{ ...waiting, id: 'proposal-2' }} loading={false} onReview={onReview} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
