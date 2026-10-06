/** Where the browser remembers which project is open (id, name and kind only). */
export const WORKSPACE_STORAGE_KEY = 'hlb-workspace';

/**
 * Forgets the open project. Called when the session ends, so the next account
 * on this browser does not start with someone else's project name in the
 * sidebar.
 */
export function forgetWorkspace(): void {
  try {
    localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode); then there is nothing to forget.
  }
}
