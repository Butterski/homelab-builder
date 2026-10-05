import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import type { ProposalSummary } from '@/features/builder/api/proposals';
import type { ChatEvent, ThreadView } from '../api/chat';

const chat = vi.hoisted(() => ({ streamChat: vi.fn(), thread: vi.fn(), clear: vi.fn() }));

vi.mock('../api/chat', () => ({
  streamChat: chat.streamChat,
  chatApi: { thread: chat.thread, clear: chat.clear },
}));

import { threadToMessages, useAssistantStore, type ChatItem } from './assistant-store';

const BUILD = 'build-1';

const proposal: ProposalSummary = {
  id: 'proposal-1',
  build_id: BUILD,
  summary: 'Add a NAS',
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
    vms_added: 0,
    vms_removed: 0,
    vms_changed: 0,
    components_added: 0,
    components_removed: 0,
    ip_changes: 1,
    total: 2,
  },
  base_revision: 3,
  created_at: '2026-10-05T10:00:00Z',
};

const emptyThread: ThreadView = { thread_id: null, messages: [], full: false };

/** Makes streamChat yield the given events and then end. */
function script(...events: ChatEvent[]) {
  chat.streamChat.mockImplementation(async function* () {
    for (const event of events) yield event;
  });
}

/** Makes streamChat fail before any event, as when the server refuses the request. */
function refuse(error: Error) {
  chat.streamChat.mockImplementation(() => ({
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(error) }),
  }));
}

function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
}

function replyItems(): ChatItem[] {
  const messages = useAssistantStore.getState().messages;
  return messages[messages.length - 1].items;
}

async function openBuild() {
  chat.thread.mockResolvedValue(emptyThread);
  await useAssistantStore.getState().loadThread(BUILD);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAssistantStore.setState({
    open: false,
    buildId: null,
    loadedBuildId: null,
    messages: [],
    status: 'idle',
    full: false,
    loadError: null,
    draft: '',
  });
});

describe('threadToMessages', () => {
  it('shows the rows of one turn as a single assistant message', () => {
    const messages = threadToMessages({
      thread_id: 'thread-1',
      full: false,
      messages: [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Add a NAS' }], created_at: '' },
        {
          id: 'm2',
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Let me look.' },
            { type: 'tool_call', id: 'call-1', name: 'get_build', title: 'Read the build' },
            { type: 'tool_call', id: 'call-2', name: 'propose_changes', title: 'Propose changes' },
          ],
          created_at: '',
        },
        {
          id: 'm3',
          role: 'tool',
          parts: [
            { type: 'tool_result', id: 'call-1', name: 'get_build', ok: true },
            { type: 'tool_result', id: 'call-2', name: 'propose_changes', ok: false, error: 'bad port' },
            { type: 'proposal', proposal },
          ],
          created_at: '',
        },
        { id: 'm4', role: 'assistant', parts: [{ type: 'text', text: 'Done.' }], created_at: '' },
      ],
    });

    expect(messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(messages[0].items).toEqual([{ kind: 'text', text: 'Add a NAS' }]);
    expect(messages[1].items).toEqual([
      { kind: 'text', text: 'Let me look.' },
      { kind: 'tool', step: { id: 'call-1', name: 'get_build', title: 'Read the build', status: 'ok', error: undefined } },
      { kind: 'tool', step: { id: 'call-2', name: 'propose_changes', title: 'Propose changes', status: 'error', error: 'bad port' } },
      { kind: 'proposal', proposal },
      { kind: 'text', text: 'Done.' },
    ]);
  });

  it('marks a tool call without a stored result as not finished', () => {
    const [, reply] = threadToMessages({
      thread_id: 'thread-1',
      full: false,
      messages: [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hi' }], created_at: '' },
        {
          id: 'm2',
          role: 'assistant',
          parts: [{ type: 'tool_call', id: 'call-1', name: 'get_build', title: '' }],
          created_at: '',
        },
      ],
    });
    expect(reply.items).toEqual([
      { kind: 'tool', step: { id: 'call-1', name: 'get_build', title: 'get_build', status: 'stopped' } },
    ]);
  });
});

describe('assistant store', () => {
  it('loads a conversation once per build', async () => {
    chat.thread.mockResolvedValue({
      thread_id: 'thread-1',
      full: true,
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hi' }], created_at: '' }],
    });

    await useAssistantStore.getState().loadThread(BUILD);
    await useAssistantStore.getState().loadThread(BUILD);

    expect(chat.thread).toHaveBeenCalledTimes(1);
    const state = useAssistantStore.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.full).toBe(true);
    expect(state.status).toBe('idle');
  });

  it('keeps a failed load retryable', async () => {
    chat.thread.mockRejectedValueOnce(new Error('offline'));
    await useAssistantStore.getState().loadThread(BUILD);
    expect(useAssistantStore.getState().loadError).toBe('offline');

    chat.thread.mockResolvedValue(emptyThread);
    await useAssistantStore.getState().loadThread(BUILD, true);
    expect(useAssistantStore.getState().loadError).toBeNull();
  });

  it('streams a reply: text, tool steps and a proposal', async () => {
    await openBuild();
    const order: string[] = [];
    chat.streamChat.mockImplementation(async function* () {
      order.push('request');
      yield { type: 'turn_start', thread_id: 't', message_id: 'm', provider: 'anthropic', model: 'x' };
      yield { type: 'text_delta', text: 'Looking ' };
      yield { type: 'text_delta', text: 'at it.' };
      yield { type: 'tool_call', id: 'call-1', name: 'propose_changes', title: 'Propose changes' };
      expect(replyItems()[1]).toMatchObject({ kind: 'tool', step: { status: 'running' } });
      yield { type: 'tool_result', id: 'call-1', name: 'propose_changes', ok: true };
      yield { type: 'proposal', proposal };
      yield { type: 'text_delta', text: 'Have a look.' };
      yield { type: 'done' };
    });
    const onProposal = vi.fn();

    const accepted = await useAssistantStore.getState().send('  Add a NAS  ', {
      prepare: async () => {
        order.push('prepare');
      },
      onProposal,
    });

    expect(accepted).toBe(true);
    // Unsaved canvas edits are saved before the request goes out.
    expect(order).toEqual(['prepare', 'request']);
    expect(chat.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ buildId: BUILD, message: 'Add a NAS' }),
    );
    expect(onProposal).toHaveBeenCalledWith(proposal);

    const state = useAssistantStore.getState();
    expect(state.status).toBe('idle');
    expect(state.messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(state.messages[0].items).toEqual([{ kind: 'text', text: 'Add a NAS' }]);
    expect(replyItems()).toEqual([
      { kind: 'text', text: 'Looking at it.' },
      { kind: 'tool', step: { id: 'call-1', name: 'propose_changes', title: 'Propose changes', status: 'ok', error: undefined } },
      { kind: 'proposal', proposal, receivedAt: expect.any(Number) },
      { kind: 'text', text: 'Have a look.' },
    ]);
  });

  it('reports a request the server refused and says it was not accepted', async () => {
    await openBuild();
    refuse(new ApiError(409, 'assistant_not_configured', 'The assistant is not fully set up'));

    const accepted = await useAssistantStore.getState().send('Hello');

    expect(accepted).toBe(false);
    expect(replyItems()).toEqual([
      { kind: 'error', text: 'The assistant is not fully set up', code: 'assistant_not_configured' },
    ]);
    expect(useAssistantStore.getState().status).toBe('idle');
  });

  it('locks the conversation when the server says it is full', async () => {
    await openBuild();
    refuse(new ApiError(409, 'thread_full', 'This conversation is too long.'));

    await useAssistantStore.getState().send('Hello');
    expect(useAssistantStore.getState().full).toBe(true);

    // Nothing more is sent until the chat is cleared.
    expect(await useAssistantStore.getState().send('Again')).toBe(false);
    expect(chat.streamChat).toHaveBeenCalledTimes(1);

    chat.clear.mockResolvedValue({});
    await useAssistantStore.getState().clear();
    expect(chat.clear).toHaveBeenCalledWith(BUILD);
    expect(useAssistantStore.getState()).toMatchObject({ messages: [], full: false });
  });

  it('shows an error reported by the stream and settles running steps', async () => {
    await openBuild();
    script(
      { type: 'tool_call', id: 'call-1', name: 'get_build', title: 'Read the build' },
      { type: 'error', code: 'rate_limit', message: 'The provider is rate limiting your key.' },
    );

    expect(await useAssistantStore.getState().send('Hello')).toBe(true);
    expect(replyItems()).toEqual([
      { kind: 'tool', step: { id: 'call-1', name: 'get_build', title: 'Read the build', status: 'stopped' } },
      { kind: 'error', text: 'The provider is rate limiting your key.', code: 'rate_limit' },
    ]);
  });

  it('says so when the connection ends before the reply is finished', async () => {
    await openBuild();
    script({ type: 'text_delta', text: 'Half a sen' });

    await useAssistantStore.getState().send('Hello');
    expect(replyItems()).toEqual([
      { kind: 'text', text: 'Half a sen' },
      { kind: 'error', text: 'The connection was lost before the reply finished.' },
    ]);
  });

  it('stops a reply on request and keeps what was written', async () => {
    await openBuild();
    let started!: () => void;
    const streaming = new Promise<void>(resolve => (started = resolve));
    chat.streamChat.mockImplementation(async function* ({ signal }: { signal: AbortSignal }) {
      yield { type: 'text_delta', text: 'Thinking about' };
      started();
      await untilAborted(signal);
    });

    const sending = useAssistantStore.getState().send('Hello');
    await streaming;
    expect(useAssistantStore.getState().status).toBe('streaming');
    // A second message cannot start while one is running.
    expect(await useAssistantStore.getState().send('Another')).toBe(false);

    useAssistantStore.getState().stop();
    expect(await sending).toBe(true);

    expect(replyItems()).toEqual([
      { kind: 'text', text: 'Thinking about' },
      { kind: 'notice', text: 'Stopped.' },
    ]);
    expect(useAssistantStore.getState().status).toBe('idle');
  });

  it('does not let a reply for one build leak into another', async () => {
    await openBuild();
    let started!: () => void;
    const streaming = new Promise<void>(resolve => (started = resolve));
    let aborted = false;
    chat.streamChat.mockImplementation(async function* ({ signal }: { signal: AbortSignal }) {
      yield { type: 'text_delta', text: 'For build one' };
      started();
      await untilAborted(signal).catch(error => {
        aborted = true;
        throw error;
      });
    });

    const sending = useAssistantStore.getState().send('Hello');
    await streaming;

    chat.thread.mockResolvedValue({
      thread_id: 'thread-2',
      full: false,
      messages: [{ id: 'other', role: 'user', parts: [{ type: 'text', text: 'Second build' }], created_at: '' }],
    });
    await useAssistantStore.getState().loadThread('build-2');
    await sending;

    expect(aborted).toBe(true);
    const state = useAssistantStore.getState();
    expect(state.buildId).toBe('build-2');
    expect(state.status).toBe('idle');
    expect(state.messages).toEqual([
      { id: 'other', role: 'user', items: [{ kind: 'text', text: 'Second build' }] },
    ]);
  });

  it('keeps the typed message for the build it was written in', async () => {
    await openBuild();
    useAssistantStore.getState().setDraft('half written');
    await useAssistantStore.getState().loadThread(BUILD, true);
    expect(useAssistantStore.getState().draft).toBe('half written');

    await useAssistantStore.getState().loadThread('build-2');
    expect(useAssistantStore.getState().draft).toBe('');
  });
});
