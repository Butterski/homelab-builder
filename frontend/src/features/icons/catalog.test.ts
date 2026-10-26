import { describe, expect, it } from 'vitest';
import { getBrandIcon, searchBrandIcons } from './catalog';

describe('brand icon catalog', () => {
  it('finds brand names, punctuation variants and useful aliases without inferring a choice', () => {
    expect(searchBrandIcons('  HOME assistant ').map(icon => icon.id)).toContain('home-assistant');
    expect(searchBrandIcons('pi hole').map(icon => icon.id)).toContain('pi-hole');
    expect(searchBrandIcons('PVE').map(icon => icon.id)).toEqual(['proxmox']);
    expect(searchBrandIcons('UniFi').map(icon => icon.id)).toEqual(['ubiquiti']);
    expect(searchBrandIcons('definitely not an existing brand')).toEqual([]);
    expect(getBrandIcon('PVE')).toBeUndefined();
  });

  it('combines category and search filters', () => {
    expect(searchBrandIcons('PVE', 'platform').map(icon => icon.id)).toEqual(['proxmox']);
    expect(searchBrandIcons('PVE', 'hardware')).toEqual([]);
    expect(searchBrandIcons('', 'hardware').every(icon => icon.category === 'hardware')).toBe(true);
  });

  it.each([
    undefined,
    null,
    42,
    {},
    ['docker'],
    '__proto__',
    'constructor',
    'toString',
    '/brand-icons/docker.svg',
    'https://example.com/icon.svg',
    'data:image/svg+xml,<svg onload="alert(1)"/>',
    '<svg onload="alert(1)"/>',
    '../docker',
  ])('does not resolve unrecognized or untrusted icon input: %j', icon => {
    expect(getBrandIcon(icon)).toBeUndefined();
  });
});
