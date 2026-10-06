import { useEffect, useRef, type KeyboardEvent } from 'react';
import { ArrowUp, Clock, Loader2, MousePointerClick, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AssistantStatus } from '../store/assistant-store';

/** Matches the server's limit for one message. */
const MAX_MESSAGE_CHARS = 8000;
const MAX_HEIGHT_PX = 180;

type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  /** What the assistant is doing; while it works a message can still be written and waits. */
  status: AssistantStatus;
  disabled?: boolean;
  placeholder?: string;
  /** The device selected on the canvas, which the next message will be about. */
  about?: { label: string; onClear: () => void };
  /** A message that waits for the running turn to end. */
  queued?: { text: string; onCancel: () => void };
  /** One-click messages that fit the build as it is now. */
  suggestions?: string[];
  onSuggestion?: (text: string) => void;
};

/** The message box: Enter sends, Shift+Enter starts a new line. */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  status,
  disabled = false,
  placeholder = 'Ask about this build…',
  about,
  queued,
  suggestions = [],
  onSuggestion,
}: ComposerProps) {
  const field = useRef<HTMLTextAreaElement>(null);

  // Grow with the text up to a limit, then scroll.
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const working = status === 'streaming' || status === 'stopping' || status === 'following';
  const tooLong = value.length > MAX_MESSAGE_CHARS;
  // While a turn runs, one message can wait for it to end.
  const canSend = !disabled && !tooLong && value.trim() !== '' && !(working && queued);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter also confirms a composition (IME) candidate; that must not send.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSend) onSend();
  };

  return (
    <div className="border-t p-3">
      {queued && (
        <p className="mb-2 flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate" title={queued.text}>
            Sends when the assistant is done: {queued.text}
          </span>
          <button
            type="button"
            onClick={queued.onCancel}
            aria-label="Do not send the waiting message"
            title="Do not send"
            className="rounded p-0.5 hover:cursor-pointer hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </p>
      )}
      {!working && suggestions.length > 0 && value === '' && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {suggestions.map(suggestion => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => onSuggestion?.(suggestion)}
                disabled={disabled}
                className="rounded-full border px-2.5 py-1 text-xs transition-colors hover:cursor-pointer hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-lg border bg-background px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring">
        {about && (
          <p className="mb-1 flex items-center gap-1 px-1 text-xs text-muted-foreground">
            <MousePointerClick className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate" title={about.label}>
              About: <span className="text-foreground">{about.label}</span>
            </span>
            <button
              type="button"
              onClick={about.onClear}
              aria-label="Do not mention the selected device"
              title="Leave the selection out"
              className="rounded p-0.5 hover:cursor-pointer hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={field}
            value={value}
            onChange={event => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={disabled}
            placeholder={working ? 'Write the next message…' : placeholder}
            aria-label="Message to the assistant"
            className="max-h-[180px] min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
          />
          {status === 'streaming' && (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="size-8 shrink-0"
              onClick={onStop}
              aria-label="Stop the reply"
              title="Stop"
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          )}
          {(status === 'stopping' || status === 'following') && (
            <span
              role="status"
              className="flex h-8 shrink-0 items-center gap-1.5 px-1 text-xs text-muted-foreground"
            >
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              {status === 'stopping' ? 'Stopping…' : 'Still working…'}
            </span>
          )}
          {(!working || value.trim() !== '') && (
            <Button
              type="button"
              size="icon"
              className="size-8 shrink-0"
              onClick={onSend}
              disabled={!canSend}
              aria-label={working ? 'Send when the assistant is done' : 'Send message'}
              title={working ? 'Send when the assistant is done (Enter)' : 'Send (Enter)'}
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
      {tooLong && (
        <p className="mt-1.5 text-xs text-destructive" role="alert">
          The message is {value.length - MAX_MESSAGE_CHARS} characters over the limit of{' '}
          {MAX_MESSAGE_CHARS}.
        </p>
      )}
    </div>
  );
}
