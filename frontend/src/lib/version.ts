declare const __APP_VERSION__: string;

/** Release number from package.json, injected at build time by Vite. */
export const APP_VERSION: string = __APP_VERSION__;

/** Short form shown in the UI: "1.3.0" becomes "1.3". */
export const APP_VERSION_LABEL = `v${APP_VERSION.split('.').slice(0, 2).join('.')}`;
