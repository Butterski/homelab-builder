import { create } from 'zustand';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/utils';
import type { ProposalStatus, ProposalSummary } from '@/features/builder/api/proposals';
import { chatApi, streamChat, type ThreadView } from '../api/chat';

/**
 * A tool the assistant called.
 *
 * "writing" means the model is still writing the call (a proposal with many
 * operations takes a while); "stopped" means the outcome is not known here.
 * `detail` and `summary` are short plain texts from the server; they are built
 * from what the model wrote and must never be rendered as Markdown or HTML.
 */
export type ToolStep = {
  /** Stays the same from the first sign of the call to its result. */
  key: string;
  id: string;
  name: string;
  title: string;
  status: 'writing' | 'running' | 'ok' | 'error' | 'stopped';
  /** What the call is about: "2.5G switch", "5 operations". */
  detail?: string;
  /** How much of the call the model has written so far. */
  bytes?: number;
  /** What came of it: "14 devices", "1 error, 2 warnings". */
  summary?: string;
  durationMs?: number;
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

/**
 * "stopping": Stop was pressed and the server is finishing what it had begun.
 * "following": a turn is running that this page is not streaming, after a
 * reload or a lost connection.
 */
export type AssistantStatus = 'idle' | 'loading' | 'streaming' | 'stopping' | 'following';

/** "closed" is used when a proposal is known to be settled but not how. */
export type ProposalCardStatus = ProposalStatus | 'closed';

type SendHooks = {
  /** Runs before the request, e.g. to save the canvas so the assistant reads the current build. */
  prepare?: () => Promise<void>;
  onProposal?: (proposal: ProposalSummary) => void;
  /** Devices selected on the canvas when the message was sent. */
  selection?: string[];
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
  /** The message being typed. Kept here so it survives the panel being hidden. */
  draft: string;
  /** A message sent while a turn was still running; it goes out when the turn is over. */
  queued: { text: string; hooks?: SendHooks } | null;
  /** Devices the step that just ran was about, for the canvas to point at. */
  focusIds: string[];
  /**
   * What this session knows about a proposal beyond the copy in the message:
   * applied or rejected here a moment ago, before any poll could say so.
   */
  proposalNotes: Record<string, { status: ProposalCardStatus; reason?: string; at: number }>;

  setOpen: (open: boolean) => void;
  setDraft: (draft: string) => void;
  /** Loads the stored conversation of a build, unless it is already here. */
  loadThread: (buildId: string, force?: boolean) => Promise<void>;
  /** Reads the conversation again without clearing what is on screen. */
  refreshThread: () => Promise<void>;
  /**
   * Sends a message. While a turn is running the message waits its turn.
   * Resolves to false when the server did not accept it.
   */
  send: (text: string, hooks?: SendHooks) => Promise<boolean>;
  cancelQueued: () => void;
  stop: () => void;
  clear: () => Promise<void>;
  /** Records what the user just did with a proposal, so its card says so at once. */
  noteProposal: (id: string, status: ProposalCardStatus, reason?: string) => void;
};

// The running request is kept outside the state: it is not something to render.
let controller: AbortController | null = null;
// Bumped whenever the conversation is replaced, so a late event from an older
// request cannot write into the new one.
let run = 0;

/** How often the server is asked whether a turn it is still working on has ended. */
const FOLLOW_INTERVAL_MS = 1200;
/** After this long a turn that never ends is given up on; the next message will say "busy" if it is not. */
const FOLLOW_LIMIT_MS = 100_000;

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Tool steps still marked as running when a turn ends have no known outcome. */
function settle(items: ChatItem[]): ChatItem[] {
  return items.map(item =>
    item.kind === 'tool' && (item.step.status === 'running' || item.step.status === 'writing')
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
            key: part.id ?? '',
            id: part.id ?? '',
            name: part.name ?? '',
            title: part.title || part.name || 'Tool',
            detail: part.detail,
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
          called.step.summary = part.summary;
          called.step.durationMs = part.duration_ms;
        }
      } else if (part.type === 'proposal' && part.proposal) {
        turn.items.push({ kind: 'proposal', proposal: part.proposal });
      }
    }
    // A reply that was stopped has its text but no ending of its own.
    if (row.interrupted && !row.parts.some(part => part.type === 'notice')) {
      turn.items.push({ kind: 'notice', text: 'Stopped before it finished.' });
    }
  }
  return messages;
}

/** What the assistant is doing right now, in a few words; null when it is idle. */
export function currentActivity(
  state: Pick<AssistantState, 'status' | 'messages'>,
): string | null {
  if (state.status === 'stopping') return 'Stopping…';
  if (state.status === 'following') return 'Still working…';
  if (state.status !== 'streaming') return null;
  const last = state.messages[state.messages.length - 1];
  const items = last?.role === 'assistant' ? last.items : [];
  const item = items[items.length - 1];
  if (item?.kind === 'tool' && item.step.status === 'writing') return `Preparing: ${item.step.title}…`;
  if (item?.kind === 'tool' && item.step.status === 'running') return `${item.step.title}…`;
  if (item?.kind === 'text') return 'Writing…';
  return 'Thinking…';
}

export const useAssistantStore = create<AssistantState>()((set, get) => {
  /**
   * Makes the screen show what the server has. It waits for a turn the server
   * is still working on, then replaces the messages with the stored ones.
   * `keep` are items only this session knows (an error from the provider is
   * not part of the stored conversation) and stay under the last reply.
   */
  const reconcile = async (buildId: string, myRun: number, keep: ChatItem[] = []) => {
    const started = Date.now();
    for (;;) {
      let thread: ThreadView;
      try {
        thread = await chatApi.thread(buildId);
      } catch {
        // What is on screen is the best there is; the next message or the
        // next time the panel opens tries again.
        return;
      }
      if (run !== myRun || get().buildId !== buildId) return;
      const messages = threadToMessages(thread);
      if (keep.length > 0) {
        const last = messages[messages.length - 1];
        if (last?.role === 'assistant') last.items.push(...keep);
        else messages.push({ id: `local-kept-${myRun}`, role: 'assistant', items: keep });
      }
      set({ messages, full: thread.full, loadedBuildId: buildId, loadError: null });
      if (!thread.running || Date.now() - started > FOLLOW_LIMIT_MS) return;
      await wait(FOLLOW_INTERVAL_MS);
      if (run !== myRun) return;
    }
  };

  /** The turn is over: back to idle, and the message that waited goes out. */
  const finish = (myRun: number) => {
    if (run !== myRun) return;
    controller = null;
    const queued = get().queued;
    set({ status: 'idle', queued: null, focusIds: [] });
    if (queued && !get().full) void get().send(queued.text, queued.hooks);
  };

  return {
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
        queued: null,
        focusIds: [],
        proposalNotes: state.buildId === buildId ? state.proposalNotes : {},
        draft: state.buildId === buildId ? state.draft : '',
      });
      try {
        const thread = await chatApi.thread(buildId);
        if (run !== myRun) return;
        set({
          loadedBuildId: buildId,
          messages: threadToMessages(thread),
          full: thread.full,
          status: thread.running ? 'following' : 'idle',
        });
        if (thread.running) {
          // The page was reloaded in the middle of a turn: show how it ends.
          await wait(FOLLOW_INTERVAL_MS);
          await reconcile(buildId, myRun);
          finish(myRun);
        }
      } catch (error) {
        if (run !== myRun) return;
        set({ status: 'idle', loadError: errorMessage(error, 'Could not load the conversation.') });
      }
    },

    refreshThread: async () => {
      const { buildId, loadedBuildId, status } = get();
      if (!buildId || loadedBuildId !== buildId || status !== 'idle') return;
      const myRun = run;
      let thread: ThreadView;
      try {
        thread = await chatApi.thread(buildId);
      } catch {
        return;
      }
      if (run !== myRun || get().status !== 'idle') return;
      set({ messages: threadToMessages(thread), full: thread.full });
      if (thread.running) {
        const following = ++run;
        set({ status: 'following' });
        await wait(FOLLOW_INTERVAL_MS);
        await reconcile(buildId, following);
        finish(following);
      }
    },

    send: async (text, hooks) => {
      const { buildId, status, full } = get();
      const message = text.trim();
      if (!buildId || full || !message || status === 'loading') return false;
      if (status !== 'idle') {
        // The server takes one message at a time. This one goes out as soon
        // as the turn before it is over.
        set({ queued: { text: message, hooks } });
        return true;
      }

      const myRun = ++run;
      const abort = new AbortController();
      controller = abort;
      const replyId = `local-reply-${myRun}`;
      set(state => ({
        status: 'streaming',
        focusIds: [],
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
      const patchStep = (key: string, change: (step: ToolStep) => ToolStep) =>
        patch(items =>
          items.map(item =>
            item.kind === 'tool' && item.step.key === key ? { ...item, step: change(item.step) } : item,
          ),
        );
      const replyItems = () => get().messages.find(entry => entry.id === replyId)?.items ?? [];
      const hasStep = (key: string) => replyItems().some(item => item.kind === 'tool' && item.step.key === key);
      const stepKeyOf = (id: string): string | undefined => {
        const found = replyItems().find(item => item.kind === 'tool' && item.step.id === id);
        return found?.kind === 'tool' ? found.step.key : undefined;
      };

      // Text arrives a few characters at a time. Rendering each piece would
      // parse the whole reply as Markdown again, dozens of times a second, so
      // pieces are collected and shown once per frame.
      let buffered = '';
      // Cancels the flush waiting for the next frame, if one is.
      let cancelFrame: (() => void) | null = null;
      const flushText = () => {
        cancelFrame?.();
        cancelFrame = null;
        if (!buffered) return;
        const text = buffered;
        buffered = '';
        patch(items => {
          const last = items[items.length - 1];
          return last?.kind === 'text'
            ? [...items.slice(0, -1), { kind: 'text', text: last.text + text }]
            : [...items, { kind: 'text', text }];
        });
      };
      const scheduleText = () => {
        if (cancelFrame) return;
        const onFrame = () => {
          cancelFrame = null;
          flushText();
        };
        if (typeof requestAnimationFrame === 'function') {
          const id = requestAnimationFrame(onFrame);
          cancelFrame = () => cancelAnimationFrame(id);
        } else {
          const id = setTimeout(onFrame, 16);
          cancelFrame = () => clearTimeout(id);
        }
      };

      let accepted = false;
      // How the turn ended: only "done" needs no second look at the server.
      let ending: 'done' | 'error' | 'lost' | 'stopped' | 'refused' = 'lost';
      try {
        await hooks?.prepare?.();
        if (run !== myRun) return false;
        const stream = streamChat({ buildId, message, selection: hooks?.selection, signal: abort.signal });
        for await (const event of stream) {
          if (run !== myRun) return accepted;
          accepted = true;
          if (event.type === 'text_delta') {
            buffered += event.text;
            scheduleText();
            continue;
          }
          flushText();
          switch (event.type) {
            case 'tool_pending': {
              const key = `${event.step}:${event.index}`;
              if (hasStep(key)) {
                patchStep(key, step => ({ ...step, bytes: event.bytes }));
              } else {
                patch(items => [
                  ...items,
                  {
                    kind: 'tool',
                    step: { key, id: '', name: event.name, title: event.title || event.name, status: 'writing', bytes: event.bytes },
                  },
                ]);
              }
              break;
            }
            case 'tool_call': {
              const key = event.step === undefined ? event.id : `${event.step}:${event.index ?? 0}`;
              const announced = hasStep(key);
              const called = {
                id: event.id,
                name: event.name,
                title: event.title || event.name,
                detail: event.detail || undefined,
                status: 'running' as const,
                bytes: undefined,
              };
              if (announced) patchStep(key, step => ({ ...step, ...called }));
              else patch(items => [...items, { kind: 'tool', step: { key, ...called } }]);
              break;
            }
            case 'tool_result': {
              const key = stepKeyOf(event.id);
              if (key !== undefined) {
                patchStep(key, step => ({
                  ...step,
                  status: event.ok ? 'ok' : 'error',
                  error: event.error,
                  summary: event.summary || undefined,
                  durationMs: event.duration_ms,
                }));
              }
              if (run === myRun) set({ focusIds: event.ok && event.focus ? event.focus : [] });
              break;
            }
            case 'proposal':
              patch(items => [
                ...items,
                { kind: 'proposal', proposal: event.proposal, receivedAt: Date.now() },
              ]);
              // The review that opens now marks these devices in its own way.
              if (run === myRun) set({ focusIds: [] });
              hooks?.onProposal?.(event.proposal);
              break;
            case 'notice':
              patch(items => [...items, { kind: 'notice', text: event.text }]);
              break;
            case 'error':
              ending = 'error';
              patch(items => [...settle(items), { kind: 'error', text: event.message, code: event.code }]);
              break;
            case 'done':
              ending = 'done';
              if (run === myRun && event.full) set({ full: true });
              break;
          }
        }
        flushText();
        if (ending === 'lost') {
          patch(items => [
            ...settle(items),
            { kind: 'error', text: 'The connection was lost before the reply finished.' },
          ]);
        }
      } catch (error) {
        flushText();
        if (abort.signal.aborted) {
          ending = 'stopped';
          patch(items => settle(items));
        } else if (error instanceof ApiError) {
          ending = 'refused';
          if (error.code === 'thread_full' && run === myRun) set({ full: true });
          patch(items => [...settle(items), { kind: 'error', text: error.message, code: error.code }]);
        } else {
          ending = accepted ? 'lost' : 'refused';
          patch(items => [
            ...settle(items),
            { kind: 'error', text: 'Could not reach the assistant. Check your connection and try again.' },
          ]);
        }
      }
      if (run !== myRun) return accepted;

      if (ending !== 'done' && accepted) {
        // The screen may be ahead of or behind what the server stored: a stopped
        // reply is kept there as written, tools it had begun still finish. Show
        // the stored conversation, and keep what only this session knows.
        const keep = replyItems().filter(item => item.kind === 'error');
        set({ status: ending === 'stopped' ? 'stopping' : 'following', focusIds: [] });
        await reconcile(buildId, myRun, keep);
      }
      finish(myRun);
      return accepted;
    },

    cancelQueued: () => set({ queued: null }),

    stop: () => {
      if (!controller || get().status !== 'streaming') return;
      set({ status: 'stopping' });
      controller.abort();
    },

    clear: async () => {
      const { buildId, status } = get();
      if (!buildId || status !== 'idle') return;
      await chatApi.clear(buildId);
      if (get().buildId !== buildId) return;
      run++;
      set({ messages: [], full: false, loadError: null, loadedBuildId: buildId, proposalNotes: {}, focusIds: [] });
    },

    noteProposal: (id, status, reason) =>
      set(state => ({
        proposalNotes: { ...state.proposalNotes, [id]: { status, reason, at: Date.now() } },
      })),
  };
});
