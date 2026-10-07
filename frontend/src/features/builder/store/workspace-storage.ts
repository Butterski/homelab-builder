import { createJSONStorage } from 'zustand/middleware';

/** Where the browser remembers which project is open (id, name and kind only). */
export const WORKSPACE_STORAGE_KEY = 'hlb-workspace';

/**
 * localStorage that is written only when the value differs from what it holds.
 * The store saves what it remembers after every change of anything in it,
 * which during a drag is every frame; what is kept changes when another
 * project is opened or this one is renamed.
 */
export const workspaceStorage = createJSONStorage(() => {
  const storage = localStorage;
  return {
    getItem: name => storage.getItem(name),
    setItem: (name, value) => {
      if (storage.getItem(name) !== value) storage.setItem(name, value);
    },
    removeItem: name => storage.removeItem(name),
  };
});

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
