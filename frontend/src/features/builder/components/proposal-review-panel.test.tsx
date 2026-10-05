import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/builds', () => ({ buildApi: {} }));
vi.mock('../api/proposals', () => ({ proposalApi: {} }));

import { ProposalReviewPanel } from './proposal-review-panel';
import { useBuilderStore, type ProposalPreviewState } from '../store/builder-store';
import type { Proposal } from '../api/proposals';

const counts = {
  nodes_added: 1, nodes_removed: 1, nodes_changed: 1, connections_added: 1, connections_removed: 0,
  connections_changed: 0, vms_added: 1, vms_removed: 0, vms_changed: 0, components_added: 1,
  components_removed: 0, ip_changes: 1, total: 6,
};

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'proposal-1', build_id: 'build-1', summary: 'Add a NAS for backups', source: 'mcp',
    source_label: 'Claude Code', status: 'pending', status_reason: '', base_revision: 3,
    created_at: new Date(Date.now() - 120_000).toISOString(),
    diff: {
      counts,
      build_name: { field: 'name', before: 'Lab', after: 'Rack Lab' },
      nodes: {
        added: [{ id: 'nas', name: 'Backup NAS', type: 'nas', ip: '192.168.1.100' }],
        removed: [{ id: 'ap', name: 'Old AP', type: 'access_point' }],
        changed: [{ id: 'sw', name: 'Switch', type: 'switch', changes: [{ field: 'details.ports', before: 8, after: 16 }, { field: 'details.nat_enabled', before: null, after: true }] }],
      },
      connections: {
        added: [{ source: 'sw', target: 'nas', source_name: 'Switch', target_name: 'Backup NAS', source_handle: 'eth2', target_handle: 'target-0', type: 'ethernet', speed: '10 GbE' }],
        removed: [], changed: [],
      },
      vms: { added: [{ id: 'vm', name: 'Jellyfin', type: 'container', host_id: 'nas', host_name: 'Backup NAS', ip: '192.168.1.101' }], removed: [], changed: [] },
      components: { added: [{ id: 'disk', name: 'Exos 8TB', type: 'disk', host_id: 'nas', host_name: 'Backup NAS' }], removed: [] },
      ip_changes: [{ kind: 'node', id: 'sw', name: 'Switch', before: '192.168.1.10', after: '192.168.1.11' }],
    },
    ...overrides,
  };
}

function open(value: Proposal, issues: ProposalPreviewState['validationIssues'] = []) {
  useBuilderStore.setState({
    proposalPreview: {
      proposal: value, nodes: [], edges: [], hardwareNodes: [], validationIssues: issues,
      changedNodeIds: [], focus: null,
    },
  });
}

const handlers = { onApply: vi.fn(), onReject: vi.fn(), onClose: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  useBuilderStore.setState({ proposalPreview: null });
});

describe('ProposalReviewPanel', () => {
  it('renders nothing without an open proposal', () => {
    const { container } = render(<ProposalReviewPanel busy={null} {...handlers} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists every kind of change in plain words', () => {
    open(proposal(), [{ node_id: 'nas', message: 'address inside the DHCP pool', type: 'warning' }]);
    render(<ProposalReviewPanel busy={null} {...handlers} />);

    expect(screen.getByText('Add a NAS for backups')).toBeInTheDocument();
    expect(screen.getByText(/Claude Code · MCP/)).toBeInTheDocument();
    expect(screen.getByText('address inside the DHCP pool')).toBeInTheDocument();

    const devices = screen.getByRole('heading', { name: /Devices/ }).closest('section')!;
    expect(within(devices).getByText('Backup NAS')).toBeInTheDocument();
    expect(within(devices).getByText('nas · 192.168.1.100')).toBeInTheDocument();
    expect(within(devices).getByText('Old AP')).toBeInTheDocument();
    // Field changes read as "ports: 8 → 16", without the internal "details." prefix.
    expect(within(devices).getByText('ports:')).toBeInTheDocument();
    expect(within(devices).getByText('16')).toBeInTheDocument();
    expect(within(devices).getByText('nat enabled:')).toBeInTheDocument();
    expect(within(devices).getByText('on')).toBeInTheDocument();

    expect(screen.getByText('Switch eth2 → Backup NAS')).toBeInTheDocument();
    expect(screen.getByText('ethernet · 10 GbE')).toBeInTheDocument();
    expect(screen.getByText('on Backup NAS · container · 192.168.1.101')).toBeInTheDocument();
    expect(screen.getByText('disk in Backup NAS')).toBeInTheDocument();
    expect(screen.getByText('Rename project')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Addresses that change/ })).toBeInTheDocument();
  });

  it('focuses the preview on the row that is clicked', async () => {
    const user = userEvent.setup();
    open(proposal());
    render(<ProposalReviewPanel busy={null} {...handlers} />);

    await user.click(screen.getByText('Switch eth2 → Backup NAS'));
    expect(useBuilderStore.getState().proposalPreview?.focus?.ids).toEqual(['sw', 'nas']);
    await user.click(screen.getByText('Jellyfin'));
    expect(useBuilderStore.getState().proposalPreview?.focus?.ids).toEqual(['nas']);
  });

  it('applies on one click and rejects with an optional reason', async () => {
    const user = userEvent.setup();
    open(proposal());
    render(<ProposalReviewPanel busy={null} {...handlers} />);

    await user.click(screen.getByRole('button', { name: 'Apply changes' }));
    expect(handlers.onApply).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(handlers.onReject).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/what to do differently/i), 'use the mini PC');
    await user.click(screen.getByRole('button', { name: 'Reject proposal' }));
    expect(handlers.onReject).toHaveBeenCalledWith('use the mini PC');

    await user.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('disables the decision buttons while an action is running', () => {
    open(proposal());
    render(<ProposalReviewPanel busy="apply" {...handlers} />);
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
  });

  it('explains a proposal that can no longer be applied and offers no Apply', () => {
    open(proposal({ status: 'conflict', status_reason: 'operations[1] (connect): source does not exist' }));
    render(<ProposalReviewPanel busy={null} {...handlers} />);

    expect(screen.getByText('This proposal no longer fits the build.')).toBeInTheDocument();
    expect(screen.getByText(/operations\[1\]/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
