import { describe, expect, it } from 'vitest';
import { compareVersions, currentRelease, releasesToShow, type Release } from './releases';

const release = (version: string): Release => ({
  version,
  title: `What's new in ${version}`,
  lead: '',
  entries: [],
});

// Newest first, as RELEASES is kept.
const HISTORY = [release('1.10.0'), release('1.4.0'), release('1.3.2'), release('1.3.0')];
const versions = (releases: Release[]) => releases.map(entry => entry.version);

describe('which release notes an account is shown', () => {
  it('compares versions by their numbers, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.4.0', '1.4.0')).toBe(0);
    expect(compareVersions('1.3.2', '1.4.0')).toBeLessThan(0);
  });

  it('shows an account that never saw any only the notes of the running version', () => {
    expect(versions(releasesToShow('', '1.4.0', HISTORY))).toEqual(['1.4.0']);
    // A patch release without notes of its own has nothing to show then.
    expect(releasesToShow('', '1.4.1', HISTORY)).toEqual([]);
  });

  it('shows what came after the release last seen, up to the running version', () => {
    expect(versions(releasesToShow('1.3.2', '1.4.0', HISTORY))).toEqual(['1.4.0']);
  });

  it('shows nothing when the running version was seen', () => {
    expect(releasesToShow('1.4.0', '1.4.0', HISTORY)).toEqual([]);
  });

  it('shows every release missed since, newest first, and none newer than what runs', () => {
    expect(versions(releasesToShow('1.3.0', '1.4.0', HISTORY))).toEqual(['1.4.0', '1.3.2']);
    expect(versions(releasesToShow('1.3.0', '1.10.0', HISTORY))).toEqual([
      '1.10.0',
      '1.4.0',
      '1.3.2',
    ]);
  });

  it('opened by hand, shows the running version, or the release a patch came after', () => {
    expect(versions(currentRelease('1.4.0', HISTORY))).toEqual(['1.4.0']);
    expect(versions(currentRelease('1.4.1', HISTORY))).toEqual(['1.4.0']);
  });
});
