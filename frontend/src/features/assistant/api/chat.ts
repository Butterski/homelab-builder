import { api, ApiError } from '@/lib/api';
import { apiUrl } from '@/lib/api-base';
import type { ProposalSummary } from '@/features/builder/api/proposals';
import { readSSE } from '../lib/sse';

/** One event of a chat turn, as the server streams it. */
export type ChatEvent =
  | { type: 'turn_start'; thread_id: string; message_id: string; provider: string; model: string }
  | { type: 'text_delta'; text: string }
  /** The model has begun a tool call and is still writing it; `bytes` grows. */
  | { type: 'tool_pending'; step: number; index: number; name: string; title: string; bytes: number }
  /** The call is complete and about to run. `detail` says what it is about. */
  | {
      type: 'tool_call';
      id: string;
      name: string;
      title: string;
      detail?: string;
      step?: number;
      index?: number;
    }
  /** `summary` is the outcome in a few words; `focus` names the devices it concerned. */
  | {
      type: 'tool_result';
      id: string;
      name: string;
      ok: boolean;
      error?: string;
      summary?: string;
      duration_ms?: number;
      focus?: string[];
    }
  | { type: 'proposal'; proposal: ProposalSummary }
  | { type: 'notice'; text: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'done'; full?: boolean };

const EVENT_TYPES = new Set([
  'turn_start',
  'text_delta',
  'tool_pending',
  'tool_call',
  'tool_result',
  'proposal',
  'notice',
  'error',
  'done',
]);

export type ThreadPart = {
  type: 'text' | 'notice' | 'tool_call' | 'tool_result' | 'proposal';
  text?: string;
  id?: string;
  name?: string;
  title?: string;
  /** tool_call: what the call was about. */
  detail?: string;
  ok?: boolean;
  error?: string;
  /** tool_result: what came of it, and how long it took. */
  summary?: string;
  duration_ms?: number;
  proposal?: ProposalSummary;
};

export type ThreadMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  parts: ThreadPart[];
  interrupted?: boolean;
  created_at: string;
};

/** The stored conversation about one build. */
export type ThreadView = {
  thread_id: string | null;
  messages: ThreadMessage[];
  /** True when the conversation reached its length limit and must be cleared. */
  full: boolean;
  /** True while a turn on this build is still being worked on by the server. */
  running?: boolean;
};

export const chatApi = {
  thread: (buildId: string) => api.get<ThreadView>(`/api/assistant/threads/${buildId}`),
  clear: (buildId: string) => api.del<unknown>(`/api/assistant/threads/${buildId}`),
};

type StreamChatInput = {
  buildId: string;
  message: string;
  /** Devices selected on the canvas. The server checks them against the build. */
  selection?: string[];
  signal?: AbortSignal;
};

/**
 * Sends one chat message and yields the turn's events as they arrive.
 *
 * A request the server refuses before streaming (assistant off, not set up,
 * busy, ...) throws an ApiError carrying the server's code. Problems after that
 * arrive as "error" events.
 */
export async function* streamChat({
  buildId,
  message,
  selection,
  signal,
}: StreamChatInput): AsyncGenerator<ChatEvent> {
  const token = localStorage.getItem('auth_token');
  const response = await fetch(apiUrl('/api/assistant/chat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      build_id: buildId,
      message,
      ...(selection && selection.length > 0 ? { selection } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      data.code || 'UNKNOWN',
      data.error || 'The assistant request failed.',
      data,
    );
  }
  if (!response.body) {
    throw new ApiError(response.status, 'UNKNOWN', 'The assistant sent an empty response.');
  }

  for await (const frame of readSSE(response.body)) {
    if (!EVENT_TYPES.has(frame.event)) continue;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(frame.data) as Record<string, unknown>;
    } catch {
      continue;
    }
    yield { ...payload, type: frame.event } as ChatEvent;
  }
}
