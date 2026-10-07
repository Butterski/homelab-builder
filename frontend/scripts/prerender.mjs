// Last step of `npm run build`.
//
// Writes the landing page into dist/index.html as plain HTML, so a visitor sees
// it before any JavaScript has loaded and a crawler that runs none (most AI
// crawlers) can read it. The untouched app shell is kept as dist/app.html:
// nginx serves that for every route except "/".
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const ssr = path.join(root, 'dist-ssr');
const MOUNT = '<div id="root"></div>';
const SITE = 'https://hlbldr.com/';

const shell = await readFile(path.join(dist, 'index.html'), 'utf8');
if (!shell.includes(MOUNT) || !shell.includes('</head>')) {
  throw new Error('prerender: index.html no longer has the mount point this script looks for');
}

const { render } = await import(pathToFileURL(path.join(ssr, 'prerender.js')).href);
const page = render();
if (!page.html.includes('<h1')) {
  throw new Error('prerender: the landing page rendered without a heading');
}

// "<" cannot end a script element early when written as an escape.
const structuredData = JSON.stringify(page.structuredData).replaceAll('<', '\\u003c');
const head = [
  `  <link rel="canonical" href="${SITE}" />`,
  `  <script type="application/ld+json">${structuredData}</script>`,
  '</head>',
].join('\n');

const index = shell
  .replace('</head>', head)
  .replace(MOUNT, `<div id="prerender">${page.html}</div>\n  ${MOUNT}`);

await writeFile(path.join(dist, 'app.html'), shell);
await writeFile(path.join(dist, 'index.html'), index);
await rm(ssr, { recursive: true, force: true });

console.log(
  `prerender: landing page written to index.html (${Math.round(page.html.length / 1024)} kB of HTML), app shell kept as app.html`,
);
