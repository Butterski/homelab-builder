import { ApiError } from '../../../lib/api';
import { BuildConflictError, useBuilderStore } from './builder-store';

/** How long the canvas has to be quiet before it is compared with the server's copy. */
const AUTOSAVE_CHECK_MS = 300;
/** How long after the last edit a save starts. */
export const AUTOSAVE_DELAY_MS = 2000;
/** Waits before a save that got no answer, or a server error, is tried again. */
export const AUTOSAVE_RETRY_MS = [2000, 5000, 15000];

type AutosaveHandlers = {
  /** The build changed elsewhere and was reloaded; the canvas as it was is an undo step. */
  onConflict?: (error: BuildConflictError) => void;
  /** A save failed and is not tried again by itself: the server refused it, or the retries ran out. */
  onFailure?: (message: string) => void;
};

/** A save the server looked at and refused will be refused again; anything else may pass later. */
function isRefusal(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 408 || error.status === 409 || error.status === 429) return false;
  return error.status >= 400 && error.status < 500;
}

/**
 * Saves the open build shortly after it stops changing. Returns a function that
 * stops it and saves what is still pending.
 *
 * It watches the store instead of React renders: comparing the canvas with the
 * server's copy means serialising the whole build, which must not happen on
 * every frame of a drag. A canvas equal to `lastSyncedFingerprint` is never
 * saved. Without that, a reload triggered by another session would save again
 * and two sessions would keep bumping the revision for each other.
 */
export function startAutosave(handlers: AutosaveHandlers = {}): () => void {
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retries = 0;
  let stopped = false;

  const open = () => {
    const state = useBuilderStore.getState();
    return !!state.currentBuildId && state.buildStatus === 'ready';
  };

  const cancelSave = () => {
    clearTimeout(saveTimer);
    clearTimeout(retryTimer);
    saveTimer = undefined;
    retryTimer = undefined;
  };

  const save = async () => {
    saveTimer = undefined;
    retryTimer = undefined;
    const state = useBuilderStore.getState();
    if (stopped || !open() || !state.hasUnsavedChanges()) return;
    try {
      await state.reassignAllIPs();
      retries = 0;
    } catch (error) {
      if (stopped) return;
      if (error instanceof BuildConflictError) {
        retries = 0;
        handlers.onConflict?.(error);
        return;
      }
      if (isRefusal(error) || retries >= AUTOSAVE_RETRY_MS.length) {
        retries = 0;
        handlers.onFailure?.(
          useBuilderStore.getState().saveError ?? 'This project could not be saved.',
        );
        return;
      }
      retryTimer = setTimeout(() => void save(), AUTOSAVE_RETRY_MS[retries]);
      retries += 1;
    }
  };

  const check = () => {
    checkTimer = undefined;
    if (stopped) return;
    if (!open()) {
      cancelSave();
      return;
    }
    const dirty = useBuilderStore.getState().refreshSaveState();
    if (!dirty) {
      cancelSave();
      retries = 0;
      return;
    }
    // An edit restarts the countdown, and replaces a retry that was waiting.
    cancelSave();
    saveTimer = setTimeout(() => void save(), AUTOSAVE_DELAY_MS - AUTOSAVE_CHECK_MS);
  };

  const unsubscribe = useBuilderStore.subscribe((state, previous) => {
    if (
      state.nodes === previous.nodes &&
      state.edges === previous.edges &&
      state.hardwareNodes === previous.hardwareNodes &&
      state.buildKind === previous.buildKind &&
      state.gamingPlan === previous.gamingPlan &&
      state.buildSettings === previous.buildSettings &&
      state.lastSyncedFingerprint === previous.lastSyncedFingerprint &&
      state.buildStatus === previous.buildStatus &&
      state.currentBuildId === previous.currentBuildId
    ) {
      return;
    }
    clearTimeout(checkTimer);
    checkTimer = setTimeout(check, AUTOSAVE_CHECK_MS);
  });

  return () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    clearTimeout(checkTimer);
    cancelSave();
    // Leaving the builder: the next thing that happens to this build is a
    // reload from the server, so what is still pending is saved now.
    const state = useBuilderStore.getState();
    if (open() && state.hasUnsavedChanges()) {
      void state.reassignAllIPs().catch(error => {
        handlers.onFailure?.(
          error instanceof BuildConflictError
            ? error.message
            : 'Your last change could not be saved before leaving the builder.',
        );
      });
    }
  };
}
