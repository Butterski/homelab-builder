import { afterEach, describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SeoMeta } from './seo-meta';

afterEach(() => {
  document.head.innerHTML = '';
});

describe('SeoMeta title lifecycle', () => {
  it('keeps current title on unmount instead of restoring stale previous title', () => {
    document.title = 'Old Title';

    const { unmount } = render(
      <SeoMeta
        title="Guide Title"
        description="Guide"
        path="/how-to-build-a-homelab"
      />,
    );

    expect(document.title).toBe('Guide Title');

    unmount();

    expect(document.title).toBe('Guide Title');
  });

  it('uses the public site URL for canonical and Open Graph URLs', () => {
    render(
      <SeoMeta
        title="Hardware Catalog | HLBuilder"
        description="Browse homelab hardware."
        path="/hardware"
      />,
    );

    const canonical = document.head.querySelector('link[rel="canonical"]');
    const ogUrl = document.head.querySelector('meta[property="og:url"]');

    expect(canonical?.getAttribute('href')).toBe('https://hlbldr.com/hardware');
    expect(ogUrl?.getAttribute('content')).toBe('https://hlbldr.com/hardware');
  });

  it('can mark pages noindex', () => {
    render(
      <SeoMeta
        title="Shared layout | HLBuilder"
        description="A shared homelab layout."
        robots="noindex, nofollow"
      />,
    );

    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex, nofollow',
    );
  });
});
