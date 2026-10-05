import { Check, CircleDashed, Loader2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolStep } from '../store/assistant-store';

const STATUS_LABEL: Record<ToolStep['status'], string> = {
  running: 'running',
  ok: 'done',
  error: 'failed',
  stopped: 'not finished',
};

/** One step the assistant took, such as reading the build or searching the catalog. */
export function ToolCallChip({ step }: { step: ToolStep }) {
  const Icon =
    step.status === 'running'
      ? Loader2
      : step.status === 'ok'
        ? Check
        : step.status === 'error'
          ? TriangleAlert
          : CircleDashed;
  return (
    <div
      className="flex items-start gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-xs"
      data-testid="tool-step"
      data-status={step.status}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          'mt-px size-3.5 shrink-0',
          step.status === 'running' && 'animate-spin text-muted-foreground',
          step.status === 'ok' && 'text-emerald-500',
          step.status === 'error' && 'text-amber-500',
          step.status === 'stopped' && 'text-muted-foreground',
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          {step.title}
          <span className="sr-only"> ({STATUS_LABEL[step.status]})</span>
        </span>
        {step.status === 'error' && step.error && (
          <span className="block break-words text-muted-foreground">{step.error}</span>
        )}
      </span>
    </div>
  );
}
