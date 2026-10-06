import type { SaveState } from '../store/builder-store';

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
