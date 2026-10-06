import { useState } from 'react';
import {
  Boxes,
  Check,
  ChevronRight,
  CircleDashed,
  Cpu,
  FileCode,
  FolderOpen,
  Gamepad2,
  GitPullRequestArrow,
  GitPullRequestDraft,
  Loader2,
  ScanSearch,
  Search,
  ShieldCheck,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDuration } from '../lib/format-duration';
import type { ToolStep } from '../store/assistant-store';

const TOOL_ICONS: Record<string, LucideIcon> = {
  list_builds: FolderOpen,
  get_build: ScanSearch,
  validate_build: ShieldCheck,
  generate_configs: FileCode,
  gaming_report: Gamepad2,
  search_hardware: Search,
  list_services: Boxes,
  recommend_hardware: Cpu,
  propose_changes: GitPullRequestArrow,
  get_proposal: GitPullRequestDraft,
};

const STATUS_LABEL: Record<ToolStep['status'], string> = {
  writing: 'being prepared',
  running: 'running',
  ok: 'done',
  error: 'failed',
  stopped: 'not finished',
};

/** "2.1 kB": how much of a call the model has written. */
function formatBytes(bytes: number): string {
  return bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(1)} kB`;
}

function Step({ step }: { step: ToolStep }) {
  const Icon = TOOL_ICONS[step.name] ?? Wrench;
  const active = step.status === 'writing' || step.status === 'running';
  const State =
    step.status === 'ok'
      ? Check
      : step.status === 'error'
        ? TriangleAlert
        : step.status === 'stopped'
          ? CircleDashed
          : Loader2;
  // Under the title: what it was about, what came of it or how far along it
  // is, and how long it took. All of it is plain text.
  const notes = [
    step.detail,
    step.status === 'writing'
      ? step.bytes
        ? `writing… ${formatBytes(step.bytes)}`
        : 'writing…'
      : step.status === 'ok'
        ? step.summary
        : undefined,
    step.durationMs !== undefined && step.status !== 'writing'
      ? formatDuration(step.durationMs)
      : undefined,
  ].filter(Boolean);

  return (
    <li
      className={cn('activity-step flex items-start gap-2 px-2 py-1.5 text-xs', active && 'is-active')}
      data-testid="tool-step"
      data-status={step.status}
    >
      <Icon className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate" title={step.title}>
          {step.title}
          <span className="sr-only"> ({STATUS_LABEL[step.status]})</span>
        </span>
        {notes.length > 0 && (
          <span className="block truncate tabular-nums text-muted-foreground" title={notes.join(' · ')}>
            {notes.join(' · ')}
          </span>
        )}
        {step.status === 'error' && step.error && (
          <span className="mt-0.5 block break-words text-muted-foreground">{step.error}</span>
        )}
      </span>
      <State
        aria-hidden="true"
        className={cn(
          'mt-px size-3.5 shrink-0',
          active && 'animate-spin text-muted-foreground',
          step.status === 'ok' && 'text-emerald-500',
          step.status === 'error' && 'text-amber-500',
          step.status === 'stopped' && 'text-muted-foreground',
        )}
      />
    </li>
  );
}

type ActivityTimelineProps = {
  steps: ToolStep[];
  /** The turn these steps belong to is still running. */
  live: boolean;
};

/**
 * What the assistant did between two pieces of text: reading the build,
 * searching the catalog, drafting a proposal. While it works every step is
 * shown, the current one moving. Afterwards a run of steps folds into one
 * line, which opens on demand.
 */
export function ActivityTimeline({ steps, live }: ActivityTimelineProps) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;

  const failed = steps.filter(step => step.status === 'error').length;
  const unfinished = steps.filter(step => step.status === 'stopped').length;
  const total = steps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0);

  // One step says more as itself than as "1 step".
  if (!live && steps.length > 1) {
    const notes = [
      `${steps.length} steps`,
      failed > 0 ? `${failed} failed` : null,
      unfinished > 0 ? `${unfinished} not finished` : null,
      total > 0 ? formatDuration(total) : null,
    ].filter(Boolean);
    return (
      <div className="rounded-md border bg-muted/30" data-testid="activity">
        <button
          type="button"
          onClick={() => setOpen(value => !value)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:cursor-pointer hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <ChevronRight
            className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
            aria-hidden="true"
          />
          <span className="flex-1 truncate">{notes.join(' · ')}</span>
          {failed > 0 ? (
            <TriangleAlert className="size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
          ) : (
            <Check className="size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
          )}
        </button>
        {open && (
          <ol className="border-t">
            {steps.map(step => (
              <Step key={step.key} step={step} />
            ))}
          </ol>
        )}
      </div>
    );
  }

  return (
    <ol className="rounded-md border bg-muted/30" data-testid="activity">
      {steps.map(step => (
        <Step key={step.key} step={step} />
      ))}
    </ol>
  );
}
