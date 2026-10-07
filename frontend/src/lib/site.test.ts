import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPublicSite, LANDING_SWITCH_KEY } from './site';

function onHost(hostname: string) {
  vi.stubGlobal('location', { ...window.location, hostname });
}

describe('isPublicSite', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('is true on the public site', () => {
    onHost('hlbldr.com');
    expect(isPublicSite()).toBe(true);
    onHost('www.hlbldr.com');
    expect(isPublicSite()).toBe(true);
  });

  it('is false on anybody else’s host', () => {
    for (const host of ['localhost', '192.168.1.50', 'lab.example.org', 'nothlbldr.com']) {
      onHost(host);
      expect(isPublicSite(), host).toBe(false);
    }
  });

  it('can be switched on for working on the landing page', () => {
    onHost('localhost');
    localStorage.setItem(LANDING_SWITCH_KEY, 'on');
    expect(isPublicSite()).toBe(true);
  });
});
