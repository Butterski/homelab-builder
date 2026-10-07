/**
 * The landing page is put into index.html as plain HTML when the app is built
 * (scripts/prerender.mjs), so a visitor and a crawler that runs no JavaScript
 * both get the whole page at once. It sits in `#prerender`, next to the empty
 * `#root`, which stays hidden until React has drawn the same page.
 */
const PRERENDER_ID = 'prerender';

/** The frame every screen of the app sits in. The prerendered page uses the same one. */
export const APP_SHELL_CLASS =
  'flex h-screen flex-col bg-background text-foreground overflow-hidden md:flex-row';

/** Marks the element that scrolls, in the prerendered page. */
export const LANDING_SCROLLER_ATTRIBUTE = 'data-landing-scroller';

/** After signing in, the path to open instead of the project list. */
export const AFTER_LOGIN_KEY = 'hlb-after-login';

/** Set once this browser has seen an instance that runs without login. */
export const LOCAL_INSTANCE_KEY = 'hlb-local-instance';

/**
 * Takes the prerendered page away and shows the app. When the app shows the
 * landing page itself, pass its scroller: it starts where the visitor had
 * already scrolled to, so the swap cannot be seen.
 */
export function releasePrerender(scroller?: HTMLElement | null) {
  if (typeof document === 'undefined') return;
  const prerendered = document.getElementById(PRERENDER_ID);
  if (!prerendered) return;
  const scrolled = prerendered.querySelector(`[${LANDING_SCROLLER_ATTRIBUTE}]`)?.scrollTop ?? 0;
  prerendered.remove();
  if (scroller && scrolled > 0) scroller.scrollTo({ top: scrolled, behavior: 'instant' });
}
