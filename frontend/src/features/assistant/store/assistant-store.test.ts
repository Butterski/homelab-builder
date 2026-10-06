import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import type { ProposalSummary } from '@/features/builder/api/proposals';
import type { ChatEvent, ThreadMessage, ThreadView } from '../api/chat';

const chat = vi.hoisted(() => ({ streamChat: vi.fn(), thread: vi.fn(), clear: vi.fn() }));

vi.mock('../api/chat', () => ({
  streamChat: chat.streamChat,
  chatApi: { thread: chat.thread, clear: chat.clear },
}));

import {
  currentActivity,
  threadToMessages,
  useAssistantStore,
  type ChatItem,
  type ToolStep,
} from './assistant-store';

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

const emptyThread: ThreadView = { thread_id: null, messages: [], full: false, running: false };

const row = (id: string, role: ThreadMessage['role'], parts: ThreadMessage['parts'], interrupted = false): ThreadMessage => ({
  id,
  role,
  parts,
  interrupted,
  created_at: '',
});

const stored = (...messages: ThreadMessage[]): ThreadView => ({
  thread_id: 'thread-1',
  messages,
  full: false,
  running: false,
});

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

function steps(): ToolStep[] {
  return replyItems().flatMap(item => (item.kind === 'tool' ? [item.step] : []));
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
    queued: null,
    focusIds: [],
    proposalNotes: {},
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('threadToMessages', () => {
  it('shows the rows of one turn as a single assistant message, with what each step was', () => {
    const messages = threadToMessages(
      stored(
        row('m1', 'user', [{ type: 'text', text: 'Add a NAS' }]),
        row('m2', 'assistant', [
          { type: 'text', text: 'Let me look.' },
          { type: 'tool_call', id: 'call-1', name: 'get_build', title: 'Read a build' },
          { type: 'tool_call', id: 'call-2', name: 'propose_changes', title: 'Propose changes', detail: '2 operations' },
        ]),
        row('m3', 'tool', [
          { type: 'tool_result', id: 'call-1', name: 'get_build', ok: true, summary: '14 devices', duration_ms: 31 },
          { type: 'tool_result', id: 'call-2', name: 'propose_changes', ok: false, error: 'bad port', duration_ms: 12 },
          { type: 'proposal', proposal },
        ]),
        row('m4', 'assistant', [{ type: 'text', text: 'Done.' }]),
      ),
    );

    expect(messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(messages[0].items).toEqual([{ kind: 'text', text: 'Add a NAS' }]);
    expect(messages[1].items).toEqual([
      { kind: 'text', text: 'Let me look.' },
      {
        kind: 'tool',
        step: { key: 'call-1', id: 'call-1', name: 'get_build', title: 'Read a build', detail: undefined, status: 'ok', error: undefined, summary: '14 devices', durationMs: 31 },
      },
      {
        kind: 'tool',
        step: { key: 'call-2', id: 'call-2', name: 'propose_changes', title: 'Propose changes', detail: '2 operations', status: 'error', error: 'bad port', summary: undefined, durationMs: 12 },
      },
      { kind: 'proposal', proposal },
      { kind: 'text', text: 'Done.' },
    ]);
  });

  it('marks a tool call without a stored result as not finished', () => {
    const [, reply] = threadToMessages(
      stored(
        row('m1', 'user', [{ type: 'text', text: 'Hi' }]),
        row('m2', 'assistant', [{ type: 'tool_call', id: 'call-1', name: 'get_build', title: '' }]),
      ),
    );
    expect(reply.items).toMatchObject([
      { kind: 'tool', step: { id: 'call-1', title: 'get_build', status: 'stopped' } },
    ]);
  });

  it('says that a stopped reply was stopped', () => {
    const [, reply] = threadToMessages(
      stored(
        row('m1', 'user', [{ type: 'text', text: 'Hi' }]),
        row('m2', 'assistant', [{ type: 'text', text: 'I would start with' }], true),
      ),
    );
    expect(reply.items).toEqual([
      { kind: 'text', text: 'I would start with' },
      { kind: 'notice', text: 'Stopped before it finished.' },
    ]);
  });
});

describe('assistant store', () => {
  it('loads a conversation once per build', async () => {
    chat.thread.mockResolvedValue({ ...stored(row('m1', 'user', [{ type: 'text', text: 'Hi' }])), full: true });

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

  it('streams a reply: text, a step from its first sign to its result, and a proposal', async () => {
    await openBuild();
    const order: string[] = [];
    const seen: Array<Pick<ToolStep, 'status' | 'bytes' | 'detail'> | undefined> = [];
    chat.streamChat.mockImplementation(async function* () {
      order.push('request');
      yield { type: 'turn_start', thread_id: 't', message_id: 'm', provider: 'anthropic', model: 'x' };
      yield { type: 'text_delta', text: 'Looking ' };
      yield { type: 'text_delta', text: 'at it.' };
      // The model starts writing the call: the step is there before the call is.
      yield { type: 'tool_pending', step: 0, index: 0, name: 'propose_changes', title: 'Propose changes', bytes: 0 };
      seen.push({ ...steps()[0] });
      yield { type: 'tool_pending', step: 0, index: 0, name: 'propose_changes', title: 'Propose changes', bytes: 2100 };
      seen.push({ ...steps()[0] });
      expect(currentActivity(useAssistantStore.getState())).toBe('Preparing: Propose changes…');
      yield { type: 'tool_call', id: 'call-1', name: 'propose_changes', title: 'Propose changes', detail: '2 operations', step: 0, index: 0 };
      seen.push({ ...steps()[0] });
      expect(currentActivity(useAssistantStore.getState())).toBe('Propose changes…');
      yield { type: 'tool_result', id: 'call-1', name: 'propose_changes', ok: true, summary: '2 changes', duration_ms: 240, focus: ['node-1', 'node-2'] };
      expect(useAssistantStore.getState().focusIds).toEqual(['node-1', 'node-2']);
      yield { type: 'proposal', proposal };
      // The review that opens now marks the devices itself.
      expect(useAssistantStore.getState().focusIds).toEqual([]);
      yield { type: 'text_delta', text: 'Have a look.' };
      yield { type: 'done', full: false };
    });
    const onProposal = vi.fn();

    const accepted = await useAssistantStore.getState().send('  Add a NAS  ', {
      prepare: async () => {
        order.push('prepare');
      },
      onProposal,
      selection: ['node-1'],
    });

    expect(accepted).toBe(true);
    // Unsaved canvas edits are saved before the request goes out.
    expect(order).toEqual(['prepare', 'request']);
    expect(chat.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ buildId: BUILD, message: 'Add a NAS', selection: ['node-1'] }),
    );
    expect(onProposal).toHaveBeenCalledWith(proposal);
    expect(seen).toMatchObject([
      { status: 'writing', bytes: 0 },
      { status: 'writing', bytes: 2100 },
      { status: 'running', detail: '2 operations', bytes: undefined },
    ]);

    const state = useAssistantStore.getState();
    expect(state.status).toBe('idle');
    expect(state.messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(state.messages[0].items).toEqual([{ kind: 'text', text: 'Add a NAS' }]);
    expect(replyItems()).toEqual([
      { kind: 'text', text: 'Looking at it.' },
      {
        kind: 'tool',
        step: { key: '0:0', id: 'call-1', name: 'propose_changes', title: 'Propose changes', detail: '2 operations', status: 'ok', bytes: undefined, error: undefined, summary: '2 changes', durationMs: 240 },
      },
      { kind: 'proposal', proposal, receivedAt: expect.any(Number) },
      { kind: 'text', text: 'Have a look.' },
    ]);
    // A reply that ended properly is what the server stored: no second look.
    expect(chat.thread).toHaveBeenCalledTimes(1);
  });

  it('shows a call the server did not announce first', async () => {
    await openBuild();
    script(
      { type: 'tool_call', id: 'call-1', name: 'get_build', title: 'Read a build' },
      { type: 'tool_result', id: 'call-1', name: 'get_build', ok: false, error: 'build not found' },
      { type: 'done' },
    );
    await useAssistantStore.getState().send('Hello');
    expect(steps()).toMatchObject([{ key: 'call-1', id: 'call-1', status: 'error', error: 'build not found' }]);
    expect(useAssistantStore.getState().focusIds).toEqual([]);
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
    // Nothing was stored for it, so there is nothing to read again.
    expect(chat.thread).toHaveBeenCalledTimes(1);
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

  it('takes the word of the last reply that the conversation is now full', async () => {
    await openBuild();
    script({ type: 'text_delta', text: 'Last one.' }, { type: 'done', full: true });
    await useAssistantStore.getState().send('Hello');
    expect(useAssistantStore.getState().full).toBe(true);
  });

  it('after a failed turn shows what the server stored, and keeps the error', async () => {
    await openBuild();
    script(
      { type: 'text_delta', text: 'Let me ' },
      { type: 'tool_call', id: 'call-1', name: 'get_build', title: 'Read a build' },
      { type: 'error', code: 'rate_limit', message: 'The provider is rate limiting your key.' },
    );
    // The server kept the user message and the unfinished reply.
    chat.thread.mockResolvedValue(
      stored(
        row('m1', 'user', [{ type: 'text', text: 'Hello' }]),
        row('m2', 'assistant', [{ type: 'text', text: 'Let me ' }], true),
      ),
    );

    expect(await useAssistantStore.getState().send('Hello')).toBe(true);

    expect(chat.thread).toHaveBeenCalledTimes(2);
    const state = useAssistantStore.getState();
    expect(state.status).toBe('idle');
    expect(state.messages.map(message => message.id)).toEqual(['m1', 'm2']);
    expect(replyItems()).toEqual([
      { kind: 'text', text: 'Let me ' },
      { kind: 'notice', text: 'Stopped before it finished.' },
      { kind: 'error', text: 'The provider is rate limiting your key.', code: 'rate_limit' },
    ]);
  });

  it('follows a turn whose connection was lost until the server is done with it', async () => {
    vi.useFakeTimers();
    await openBuild();
    script({ type: 'text_delta', text: 'Half a sen' });
    const user = row('m1', 'user', [{ type: 'text', text: 'Hello' }]);
    chat.thread
      .mockResolvedValueOnce({ ...stored(user), running: true })
      .mockResolvedValueOnce(stored(user, row('m2', 'assistant', [{ type: 'text', text: 'Half a sentence, finished.' }])));

    const sending = useAssistantStore.getState().send('Hello');
    await vi.advanceTimersByTimeAsync(0);

    // The server is still on it: this is not the end yet.
    expect(useAssistantStore.getState().status).toBe('following');
    expect(currentActivity(useAssistantStore.getState())).toBe('Still working…');
    // What the server has so far is shown, with what went wrong here below it.
    expect(useAssistantStore.getState().messages[0]).toMatchObject({ id: 'm1', role: 'user' });
    expect(replyItems()).toEqual([
      { kind: 'error', text: 'The connection was lost before the reply finished.' },
    ]);

    await vi.advanceTimersByTimeAsync(1300);
    await sending;

    const state = useAssistantStore.getState();
    expect(state.status).toBe('idle');
    expect(replyItems()).toEqual([
      { kind: 'text', text: 'Half a sentence, finished.' },
      { kind: 'error', text: 'The connection was lost before the reply finished.' },
    ]);
  });

  it('stops on request, waits for the server, and shows the reply as it was kept', async () => {
    await openBuild();
    let started!: () => void;
    const streaming = new Promise<void>(resolve => (started = resolve));
    chat.streamChat.mockImplementation(async function* ({ signal }: { signal: AbortSignal }) {
      yield { type: 'text_delta', text: 'Thinking about' };
      yield { type: 'tool_pending', step: 0, index: 0, name: 'get_build', title: 'Read a build', bytes: 0 };
      started();
      await untilAborted(signal);
    });
    chat.thread.mockResolvedValue(
      stored(
        row('m1', 'user', [{ type: 'text', text: 'Hello' }]),
        row('m2', 'assistant', [{ type: 'text', text: 'Thinking about' }], true),
      ),
    );

    const sending = useAssistantStore.getState().send('Hello');
    await streaming;
    expect(useAssistantStore.getState().status).toBe('streaming');

    useAssistantStore.getState().stop();
    expect(useAssistantStore.getState().status).toBe('stopping');
    expect(currentActivity(useAssistantStore.getState())).toBe('Stopping…');
    expect(await sending).toBe(true);

    expect(replyItems()).toEqual([
      { kind: 'text', text: 'Thinking about' },
      { kind: 'notice', text: 'Stopped before it finished.' },
    ]);
    expect(useAssistantStore.getState().status).toBe('idle');
  });

  it('holds a message sent during a turn and sends it when the turn is over', async () => {
    await openBuild();
    let release!: () => void;
    const held = new Promise<void>(resolve => (release = resolve));
    let started!: () => void;
    const streaming = new Promise<void>(resolve => (started = resolve));
    const sent: string[] = [];
    chat.streamChat.mockImplementation(async function* ({ message }: { message: string }) {
      sent.push(message);
      yield { type: 'text_delta', text: `Answer to ${message}` };
      if (sent.length === 1) {
        started();
        await held;
      }
      yield { type: 'done' };
    });

    const first = useAssistantStore.getState().send('First');
    await streaming;
    // The server takes one message at a time; this one waits here instead of failing there.
    expect(await useAssistantStore.getState().send('Second')).toBe(true);
    expect(useAssistantStore.getState().queued?.text).toBe('Second');
    expect(sent).toEqual(['First']);

    release();
    await first;
    await vi.waitFor(() => expect(useAssistantStore.getState().status).toBe('idle'));

    expect(sent).toEqual(['First', 'Second']);
    expect(useAssistantStore.getState().queued).toBeNull();
    expect(useAssistantStore.getState().messages.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  });

  it('drops a waiting message on request', async () => {
    await openBuild();
    let release!: () => void;
    const held = new Promise<void>(resolve => (release = resolve));
    let started!: () => void;
    const streaming = new Promise<void>(resolve => (started = resolve));
    chat.streamChat.mockImplementation(async function* () {
      yield { type: 'text_delta', text: 'Working' };
      started();
      await held;
      yield { type: 'done' };
    });

    const first = useAssistantStore.getState().send('First');
    await streaming;
    await useAssistantStore.getState().send('Never mind');
    useAssistantStore.getState().cancelQueued();
    release();
    await first;

    expect(chat.streamChat).toHaveBeenCalledTimes(1);
    expect(useAssistantStore.getState()).toMatchObject({ status: 'idle', queued: null });
  });

  it('picks up a turn that is still running when the page is opened', async () => {
    vi.useFakeTimers();
    const user = row('m1', 'user', [{ type: 'text', text: 'Add a NAS' }]);
    chat.thread
      .mockResolvedValueOnce({ ...stored(user), running: true })
      .mockResolvedValueOnce({ ...stored(user, row('m2', 'assistant', [{ type: 'tool_call', id: 'c1', name: 'get_build', title: 'Read a build' }])), running: true })
      .mockResolvedValueOnce(stored(user, row('m2', 'assistant', [{ type: 'text', text: 'Proposed.' }])));

    const loading = useAssistantStore.getState().loadThread(BUILD);
    await vi.advanceTimersByTimeAsync(0);
    expect(useAssistantStore.getState().status).toBe('following');
    // A message written meanwhile waits for the turn like any other.
    expect(await useAssistantStore.getState().send('And a UPS')).toBe(true);
    useAssistantStore.getState().cancelQueued();

    await vi.advanceTimersByTimeAsync(1300);
    expect(steps()).toMatchObject([{ id: 'c1', status: 'stopped' }]);
    await vi.advanceTimersByTimeAsync(1300);
    await loading;

    expect(useAssistantStore.getState().status).toBe('idle');
    expect(replyItems()).toEqual([{ kind: 'text', text: 'Proposed.' }]);
    expect(chat.thread).toHaveBeenCalledTimes(3);
  });

  it('reads the conversation again on request, without a loading state', async () => {
    await openBuild();
    chat.thread.mockResolvedValue(stored(row('m1', 'user', [{ type: 'text', text: 'From another tab' }])));

    const refreshing = useAssistantStore.getState().refreshThread();
    expect(useAssistantStore.getState().status).toBe('idle');
    await refreshing;

    expect(useAssistantStore.getState().messages).toEqual([
      { id: 'm1', role: 'user', items: [{ kind: 'text', text: 'From another tab' }] },
    ]);
  });

  it('remembers what was just done with a proposal', async () => {
    await openBuild();
    useAssistantStore.getState().noteProposal('proposal-1', 'rejected', 'Too expensive');
    expect(useAssistantStore.getState().proposalNotes['proposal-1']).toMatchObject({
      status: 'rejected',
      reason: 'Too expensive',
    });
    // Another build has other proposals.
    await useAssistantStore.getState().loadThread('build-2');
    expect(useAssistantStore.getState().proposalNotes).toEqual({});
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

    chat.thread.mockResolvedValue(stored(row('other', 'user', [{ type: 'text', text: 'Second build' }])));
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
