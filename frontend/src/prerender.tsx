import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { FAQ_STRUCTURED_DATA } from './features/landing/lib/content';
import LandingPage from './features/landing/pages/landing-page';
import { APP_SHELL_CLASS, LANDING_SCROLLER_ATTRIBUTE } from './lib/prerender';

/**
 * The landing page as HTML, for scripts/prerender.mjs to put into index.html.
 * Built on its own with `vite build --ssr`; it is not part of the app bundle.
 *
 * The frame around the page is the one App.tsx draws, so the copy in index.html
 * and the page React draws afterwards are laid out the same.
 */
export function render() {
  const html = renderToStaticMarkup(
    <StaticRouter location="/">
      <div className={APP_SHELL_CLASS}>
        <main
          className="flex-1 min-h-0 relative overflow-auto"
          {...{ [LANDING_SCROLLER_ATTRIBUTE]: '' }}
        >
          <LandingPage />
        </main>
      </div>
    </StaticRouter>,
  );
  return { html, structuredData: FAQ_STRUCTURED_DATA };
}
