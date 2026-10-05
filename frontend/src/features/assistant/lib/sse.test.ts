import { describe, expect, it } from 'vitest';
import { readSSE, type ServerEvent } from './sse';

/** A response body that delivers the given text pieces as separate chunks. */
function bodyOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<ServerEvent[]> {
  const events: ServerEvent[] = [];
  for await (const event of readSSE(body)) events.push(event);
  return events;
}

describe('readSSE', () => {
  it('reads named events with their data', async () => {
    const events = await collect(
      bodyOf('event: text_delta\ndata: {"text":"Hi"}\n\nevent: done\ndata: {}\n\n'),
    );
    expect(events).toEqual([
      { event: 'text_delta', data: '{"text":"Hi"}' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('joins events that arrive split across chunks, even mid-line', async () => {
    const events = await collect(
      bodyOf('event: text_', 'delta\ndata: {"te', 'xt":"Hello"}\n', '\nevent: done\ndata: {}\n\n'),
    );
    expect(events).toEqual([
      { event: 'text_delta', data: '{"text":"Hello"}' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('accepts CRLF line endings, including a CRLF split between chunks', async () => {
    const events = await collect(bodyOf('event: notice\r', '\ndata: {"text":"x"}\r\n\r', '\n'));
    expect(events).toEqual([{ event: 'notice', data: '{"text":"x"}' }]);
  });

  it('skips keep-alive comments', async () => {
    const events = await collect(bodyOf(': ping\n\n', 'event: done\ndata: {}\n\n', ': ping\n\n'));
    expect(events).toEqual([{ event: 'done', data: '{}' }]);
  });

  it('joins several data lines with a newline and defaults the event name', async () => {
    const events = await collect(bodyOf('data: first\ndata: second\n\n'));
    expect(events).toEqual([{ event: 'message', data: 'first\nsecond' }]);
  });

  it('keeps multi-byte characters intact when a chunk boundary splits them', async () => {
    const bytes = new TextEncoder().encode('event: text_delta\ndata: {"text":"zażółć 🚀"}\n\n');
    const middle = bytes.indexOf(0xc5) + 1; // inside the two-byte "ż"
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, middle));
        controller.enqueue(bytes.slice(middle));
        controller.close();
      },
    });
    expect(await collect(body)).toEqual([{ event: 'text_delta', data: '{"text":"zażółć 🚀"}' }]);
  });

  it('drops an event that the stream cut off before its blank line', async () => {
    const events = await collect(bodyOf('event: done\ndata: {}\n\nevent: text_delta\ndata: {"te'));
    expect(events).toEqual([{ event: 'done', data: '{}' }]);
  });
});
