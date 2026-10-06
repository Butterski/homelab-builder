import { Sparkles } from 'lucide-react';
import { currentActivity, useAssistantStore } from '../store/assistant-store';

/**
 * Says on the canvas what the assistant is doing, so its work can be followed
 * without reading the chat: "Read a build…", "Preparing: Propose changes…".
 */
export function AssistantActivityPill({ buildId }: { buildId: string }) {
  const activity = useAssistantStore(state =>
    state.buildId === buildId ? currentActivity(state) : null,
  );
  if (!activity) return null;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center px-4"
      data-hide-export="true"
    >
      <p
        role="status"
        className="assistant-activity-pill builder-glass-panel flex max-w-sm items-center gap-2 px-3 py-1.5 text-xs"
      >
        <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span className="truncate">{activity}</span>
        <span className="assistant-working-dot" aria-hidden="true" />
      </p>
    </div>
  );
}
