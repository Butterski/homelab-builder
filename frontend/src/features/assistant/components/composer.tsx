import { useEffect, useRef, type KeyboardEvent } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Matches the server's limit for one message. */
const MAX_MESSAGE_CHARS = 8000;
const MAX_HEIGHT_PX = 180;

type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  /** A reply is being written: the button stops it instead of sending. */
  streaming: boolean;
  disabled?: boolean;
  placeholder?: string;
};

/** The message box: Enter sends, Shift+Enter starts a new line. */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  disabled = false,
  placeholder = 'Ask about this build…',
}: ComposerProps) {
  const field = useRef<HTMLTextAreaElement>(null);

  // Grow with the text up to a limit, then scroll.
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const tooLong = value.length > MAX_MESSAGE_CHARS;
  const canSend = !disabled && !streaming && !tooLong && value.trim() !== '';

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter also confirms a composition (IME) candidate; that must not send.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSend) onSend();
  };

  return (
    <div className="border-t p-3">
      <div className="flex items-end gap-2 rounded-lg border bg-background px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring">
        <textarea
          ref={field}
          value={value}
          onChange={event => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={disabled}
          placeholder={placeholder}
          aria-label="Message to the assistant"
          className="max-h-[180px] min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
        />
        {streaming ? (
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
        ) : (
          <Button
            type="button"
            size="icon"
            className="size-8 shrink-0"
            onClick={onSend}
            disabled={!canSend}
            aria-label="Send message"
            title="Send (Enter)"
          >
            <ArrowUp />
          </Button>
        )}
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
