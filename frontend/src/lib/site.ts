/**
 * Whether this page is served by the public HLBuilder site or by somebody's own
 * instance.
 *
 * The public site greets a visitor with the landing page: what the product is,
 * a demo, how to host it. Somebody who already runs their own copy needs none
 * of that, so every other host gets a plain welcome screen instead.
 *
 * The script in index.html makes the same decision before the app starts, to
 * hide the landing page it carries. Change the two together.
 */
const PUBLIC_HOSTS = ['hlbldr.com', 'www.hlbldr.com'];

/**
 * For working on the landing page away from the public site: opening any page
 * with `?landing=on` stores this and shows it on that host, `?landing=off`
 * ends it. index.html reads the query; this module only reads the result.
 */
export const LANDING_SWITCH_KEY = 'hlb-landing';

export function isPublicSite(): boolean {
  // The build-time render is the public site's page.
  if (typeof window === 'undefined') return true;
  try {
    if (localStorage.getItem(LANDING_SWITCH_KEY) === 'on') return true;
  } catch {
    // Storage is blocked: the host alone decides.
  }
  return PUBLIC_HOSTS.includes(window.location.hostname);
}
