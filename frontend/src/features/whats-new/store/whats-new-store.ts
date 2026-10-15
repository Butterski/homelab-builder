import { create } from 'zustand';

/** "auto": the app opened it for something new; "hand": the account menu did. */
export type WhatsNewOpener = 'auto' | 'hand';

type WhatsNewStore = {
  openedBy: WhatsNewOpener | null;
  /** Opens the dialog; one that is open already stays as it was opened. */
  open: (by: WhatsNewOpener) => void;
  close: () => void;
};

/** Whether the What's new dialog is open. The dialog itself lives in the app shell (`WhatsNew`). */
export const useWhatsNewStore = create<WhatsNewStore>()(set => ({
  openedBy: null,
  open: by => set(state => (state.openedBy ? state : { openedBy: by })),
  close: () => set({ openedBy: null }),
}));
