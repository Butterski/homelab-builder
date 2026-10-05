import { create } from 'zustand';
import { ApiError } from '@/lib/api';
import type { ProposalSummary } from '@/features/builder/api/proposals';
import { chatApi, streamChat, type ThreadView } from '../api/chat';

/** A tool the assistant called. "stopped" means the outcome is not known here. */
export type ToolStep = {
  id: string;
  name: string;
  title: string;
  status: 'running' | 'ok' | 'error' | 'stopped';
  error?: string;
};

export type ChatItem =
  | { kind: 'text'; text: string }
  | { kind: 'notice'; text: string }
  | { kind: 'error'; text: string; code?: string }
  | { kind: 'tool'; step: ToolStep }
  /** receivedAt is set for a proposal that arrived in this session (local clock). */
  | { kind: 'proposal'; proposal: ProposalSummary; receivedAt?: number };

/** One bubble in the panel. An assistant message covers a whole turn: its text, tool steps and proposals. */
export type ChatMessage = { id: string; role: 'user' | 'assistant'; items: ChatItem[] };

export type AssistantStatus = 'idle' | 'loading' | 'streaming';

type SendHooks = {
  /** Runs before the request, e.g. to save the canvas so the assistant reads the current build. */
  prepare?: () => Promise<void>;
  onProposal?: (proposal: ProposalSummary) => void;
};

type AssistantState = {
  /** Whether the panel is shown. Kept across builds for the session. */
  open: boolean;
  /** The build the conversation below belongs to. */
  buildId: string | null;
  loadedBuildId: string | null;
  messages: ChatMessage[];
  status: AssistantStatus;
  /** The conversation reached its length limit and has to be cleared. */
  full: boolean;
  loadError: string | null;
  /** The message being typed. Kept here so it survives the panel being swapped for a review. */
  draft: string;

  setOpen: (open: boolean) => void;
  setDraft: (draft: string) => void;
  /** Loads the stored conversation of a build, unless it is already here. */
  loadThread: (buildId: string, force?: boolean) => Promise<void>;
  /** Sends a message. Resolves to false when the server did not accept it. */
  send: (text: string, hooks?: SendHooks) => Promise<boolean>;
  stop: () => void;
  clear: () => Promise<void>;
};

// The running request is kept outside the state: it is not something to render.
let controller: AbortController | null = null;
// Bumped whenever the conversation is replaced, so a late event from an older
// request cannot write into the new one.
let run = 0;

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Tool steps still marked as running when a turn ends have no known outcome. */
function settle(items: ChatItem[]): ChatItem[] {
  return items.map(item =>
    item.kind === 'tool' && item.step.status === 'running'
      ? { ...item, step: { ...item.step, status: 'stopped' as const } }
      : item,
  );
}

/**
 * Turns the stored conversation into panel messages. The server stores a turn
 * as several rows (reply, tool results, next reply, ...); the panel shows them
 * as one assistant message with the tool steps inline.
 */
export function threadToMessages(thread: ThreadView): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let turn: ChatMessage | null = null;

  for (const row of thread.messages) {
    if (row.role === 'user') {
      const text = row.parts
        .filter(part => part.type === 'text' && part.text)
        .map(part => part.text)
        .join('\n\n');
      messages.push({ id: row.id, role: 'user', items: [{ kind: 'text', text }] });
      turn = null;
      continue;
    }
    if (!turn) {
      turn = { id: row.id, role: 'assistant', items: [] };
      messages.push(turn);
    }
    for (const part of row.parts) {
      if (part.type === 'text' && part.text) {
        turn.items.push({ kind: 'text', text: part.text });
      } else if (part.type === 'notice' && part.text) {
        turn.items.push({ kind: 'notice', text: part.text });
      } else if (part.type === 'tool_call') {
        turn.items.push({
          kind: 'tool',
          step: {
            id: part.id ?? '',
            name: part.name ?? '',
            title: part.title || part.name || 'Tool',
            status: 'stopped',
          },
        });
      } else if (part.type === 'tool_result') {
        const called = turn.items.find(
          (item): item is Extract<ChatItem, { kind: 'tool' }> =>
            item.kind === 'tool' && item.step.id === part.id,
        );
        if (called) {
          called.step.status = part.ok ? 'ok' : 'error';
          called.step.error = part.error;
        }
      } else if (part.type === 'proposal' && part.proposal) {
        turn.items.push({ kind: 'proposal', proposal: part.proposal });
      }
    }
  }
  return messages;
}

export const useAssistantStore = create<AssistantState>()((set, get) => ({
  open: false,
  buildId: null,
  loadedBuildId: null,
  messages: [],
  status: 'idle',
  full: false,
  loadError: null,
  draft: '',

  setOpen: open => set({ open }),
  setDraft: draft => set({ draft }),

  loadThread: async (buildId, force = false) => {
    const state = get();
    if (!force && state.buildId === buildId && (state.loadedBuildId === buildId || state.status !== 'idle')) {
      return;
    }
    // A different build: whatever was streaming belongs to the old conversation.
    controller?.abort();
    controller = null;
    const myRun = ++run;
    set({
      buildId,
      loadedBuildId: null,
      messages: [],
      status: 'loading',
      full: false,
      loadError: null,
      draft: state.buildId === buildId ? state.draft : '',
    });
    try {
      const thread = await chatApi.thread(buildId);
      if (run !== myRun) return;
      set({
        loadedBuildId: buildId,
        messages: threadToMessages(thread),
        full: thread.full,
        status: 'idle',
      });
    } catch (error) {
      if (run !== myRun) return;
      set({ status: 'idle', loadError: messageOf(error, 'Could not load the conversation.') });
    }
  },

  send: async (text, hooks) => {
    const { buildId, status, full } = get();
    const message = text.trim();
    if (!buildId || status !== 'idle' || full || !message) return false;

    const myRun = ++run;
    const abort = new AbortController();
    controller = abort;
    const replyId = `local-reply-${myRun}`;
    set(state => ({
      status: 'streaming',
      messages: [
        ...state.messages,
        { id: `local-user-${myRun}`, role: 'user', items: [{ kind: 'text', text: message }] },
        { id: replyId, role: 'assistant', items: [] },
      ],
    }));

    const patch = (change: (items: ChatItem[]) => ChatItem[]) => {
      if (run !== myRun) return;
      set(state => ({
        messages: state.messages.map(entry =>
          entry.id === replyId ? { ...entry, items: change(entry.items) } : entry,
        ),
      }));
    };

    let accepted = false;
    let finished = false;
    try {
      await hooks?.prepare?.();
      if (run !== myRun) return false;
      for await (const event of streamChat({ buildId, message, signal: abort.signal })) {
        if (run !== myRun) return accepted;
        accepted = true;
        switch (event.type) {
          case 'text_delta':
            patch(items => {
              const last = items[items.length - 1];
              return last?.kind === 'text'
                ? [...items.slice(0, -1), { kind: 'text', text: last.text + event.text }]
                : [...items, { kind: 'text', text: event.text }];
            });
            break;
          case 'tool_call':
            patch(items => [
              ...items,
              {
                kind: 'tool',
                step: { id: event.id, name: event.name, title: event.title || event.name, status: 'running' },
              },
            ]);
            break;
          case 'tool_result':
            patch(items =>
              items.map(item =>
                item.kind === 'tool' && item.step.id === event.id
                  ? { ...item, step: { ...item.step, status: event.ok ? 'ok' : 'error', error: event.error } }
                  : item,
              ),
            );
            break;
          case 'proposal':
            patch(items => [
              ...items,
              { kind: 'proposal', proposal: event.proposal, receivedAt: Date.now() },
            ]);
            hooks?.onProposal?.(event.proposal);
            break;
          case 'notice':
            patch(items => [...items, { kind: 'notice', text: event.text }]);
            break;
          case 'error':
            finished = true;
            patch(items => [...settle(items), { kind: 'error', text: event.message, code: event.code }]);
            break;
          case 'done':
            finished = true;
            break;
        }
      }
      if (!finished) {
        patch(items => [
          ...settle(items),
          { kind: 'error', text: 'The connection was lost before the reply finished.' },
        ]);
      }
    } catch (error) {
      if (abort.signal.aborted) {
        patch(items => [...settle(items), { kind: 'notice', text: 'Stopped.' }]);
      } else if (error instanceof ApiError) {
        if (error.code === 'thread_full' && run === myRun) set({ full: true });
        patch(items => [...settle(items), { kind: 'error', text: error.message, code: error.code }]);
      } else {
        patch(items => [
          ...settle(items),
          { kind: 'error', text: 'Could not reach the assistant. Check your connection and try again.' },
        ]);
      }
    } finally {
      if (run === myRun) {
        controller = null;
        set({ status: 'idle' });
      }
    }
    return accepted;
  },

  stop: () => controller?.abort(),

  clear: async () => {
    const { buildId, status } = get();
    if (!buildId || status !== 'idle') return;
    await chatApi.clear(buildId);
    if (get().buildId !== buildId) return;
    run++;
    set({ messages: [], full: false, loadError: null, loadedBuildId: buildId });
  },
}));
