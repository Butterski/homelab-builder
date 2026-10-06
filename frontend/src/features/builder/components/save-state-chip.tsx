import { AlertTriangle, Check, CloudOff, Loader2, PencilLine } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { SaveState } from '../store/builder-store';

type SaveStateChipProps = {
  state: SaveState;
  /** Why the last save failed, if it did. */
  error?: string | null;
  /** False when the server has not answered for a while. */
  reachable?: boolean;
  onRetry?: () => void;
  className?: string;
};

/** The save state in words, for labels and tooltips. */
export function saveStateLabel(state: SaveState, reachable = true): string {
  switch (state) {
    case 'saving':
      return 'Saving…';
    case 'unsaved':
      return 'Unsaved changes';
    case 'error':
      return 'Save failed';
    default:
      return reachable ? 'Saved' : "Can't reach the server";
  }
}

/**
 * Whether the open project is saved. The canvas header and the sidebar's
 * project card both show this, from the same store state.
 */
export function SaveStateChip({
  state,
  error,
  reachable = true,
  onRetry,
  className,
}: SaveStateChipProps) {
  const label = saveStateLabel(state, reachable);
  const base = cn('inline-flex min-w-0 items-center gap-1 text-[10px] leading-none', className);

  if (state === 'error') {
    return (
      <span className={cn(base, 'text-destructive')} role="status" title={error || undefined}>
        <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
        {onRetry && (
          <button
            type="button"
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              onRetry();
            }}
            className="rounded px-1 font-semibold underline underline-offset-2 hover:cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            Retry
          </button>
        )}
      </span>
    );
  }

  const Icon =
    state === 'saving' ? Loader2 : state === 'unsaved' ? PencilLine : reachable ? Check : CloudOff;
  return (
    <span
      className={cn(
        base,
        state === 'saved' && reachable && 'text-emerald-500',
        state === 'saved' && !reachable && 'text-amber-500',
        state === 'saving' && 'text-amber-500',
        state === 'unsaved' && 'text-muted-foreground',
      )}
      role="status"
      title={state === 'saved' && !reachable ? 'Changes made elsewhere will not show up until the connection is back.' : undefined}
    >
      <Icon
        className={cn('size-3 shrink-0', state === 'saving' && 'animate-spin')}
        aria-hidden="true"
      />
      <span className="truncate">{label}</span>
    </span>
  );
}
