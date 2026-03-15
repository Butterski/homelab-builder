import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SeoMeta } from './seo-meta';

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
});
