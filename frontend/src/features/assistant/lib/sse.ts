/** One server-sent event: its name and the joined data lines. */
export type ServerEvent = { event: string; data: string };

/**
 * Reads a server-sent event stream from a fetch response body.
 *
 * EventSource cannot send a POST body or an Authorization header, so the chat
 * stream is read from fetch instead. This follows the parsing rules of the SSE
 * specification: events end at a blank line, lines may end in LF, CRLF or CR,
 * lines starting with ":" are comments (the server's keep-alive pings), and
 * several data lines are joined with a newline. An event cut off by the end of
 * the stream is dropped.
 */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<ServerEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data: string[] = [];

  const takeLines = (final: boolean): string[] => {
    const lines: string[] = [];
    let start = 0;
    for (let i = 0; i < buffer.length; i++) {
      const char = buffer[i];
      if (char === '\n') {
        lines.push(buffer.slice(start, i));
        start = i + 1;
      } else if (char === '\r') {
        // A CR at the very end may be the first half of a CRLF split across chunks.
        if (i === buffer.length - 1 && !final) break;
        lines.push(buffer.slice(start, i));
        if (buffer[i + 1] === '\n') i++;
        start = i + 1;
      }
    }
    buffer = buffer.slice(start);
    return lines;
  };

  function* dispatch(lines: string[]): Generator<ServerEvent> {
    for (const line of lines) {
      if (line === '') {
        if (data.length > 0) yield { event: event || 'message', data: data.join('\n') };
        event = '';
        data = [];
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      yield* dispatch(takeLines(false));
    }
    buffer += decoder.decode();
    yield* dispatch(takeLines(true));
  } finally {
    reader.releaseLock();
  }
}
