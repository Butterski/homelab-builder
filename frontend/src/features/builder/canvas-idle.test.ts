/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A canvas nobody touches must not keep drawing (AGENTS.md, pitfall 41).
 *
 * jsdom neither animates nor paints, so what is checked here is the source:
 * the ways an endless animation has reached the canvas before.
 */
const src = resolve(process.cwd(), 'src');

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

/** What draws a canvas: the builder's own, and the pages that reuse its cards and cables. */
const canvasSources = [
  ...sourcesUnder(join(src, 'features/builder/components')),
  join(src, 'features/builder/pages/shared-build-page.tsx'),
  join(src, 'features/landing/components/landing-demo.tsx'),
  join(src, 'features/guides/pages/article-visual-page.tsx'),
  join(src, 'features/guides/lib/article-visuals.ts'),
];

const found = (pattern: RegExp) =>
  canvasSources
    .filter(path => pattern.test(readFileSync(path, 'utf-8')))
    .map(path => path.slice(src.length + 1).replace(/\\/g, '/'));

describe('an idle canvas', () => {
  it('has no cable that animates for ever', () => {
    // `animated` makes React Flow run a dash animation on every path of a cable.
    expect(found(/\banimated(:\s*true|=\{true\})/)).toEqual([]);
  });

  it('has no light or icon that pulses for ever', () => {
    // A spinner is fine: it is there while something is being waited for.
    expect(found(/\banimate-(ping|pulse|bounce)\b/)).toEqual([]);
    expect(found(/animation:\s*['"`][^'"`]*infinite/)).toEqual([]);
  });

  it('has no endless animation in the stylesheet of the canvas', () => {
    const css = readFileSync(join(src, 'index.css'), 'utf-8');
    const endless = [...css.matchAll(/animation:[^;]*\binfinite\b[^;]*;/g)].map(match => match[0]);

    // The two that remain run only while the assistant is working on a reply.
    expect(endless).toHaveLength(2);
    for (const rule of endless) expect(rule).toMatch(/assistant-(working|step-sweep)/);
  });

  it('does not blur what is behind a panel that floats over the canvas', () => {
    const css = readFileSync(join(src, 'index.css'), 'utf-8');
    expect(css).not.toMatch(/backdrop-filter/);
    expect(found(/\bbackdrop-blur/)).toEqual([]);
  });

  it("draws the grid itself instead of React Flow's pattern on the canvases that are panned", () => {
    for (const file of [
      'features/builder/components/visual-builder.tsx',
      'features/builder/pages/shared-build-page.tsx',
      'features/landing/components/landing-demo.tsx',
    ]) {
      const source = readFileSync(join(src, file), 'utf-8');
      expect(source, file).toMatch(/<CanvasGrid\b/);
      expect(source, file).not.toMatch(/<Background\b/);
      expect(source, file).toMatch(/onMoveStart=\{canvasMoving\.onMoveStart\}/);
    }
  });
});
