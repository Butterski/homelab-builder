import { describe, expect, it } from 'vitest';

import { getDefaultPortCount, getNodePortCount, parsePortCount } from './port-count';

describe('parsePortCount', () => {
  it('parses numeric values directly', () => {
    expect(parsePortCount(8)).toBe(8);
    expect(parsePortCount('24')).toBe(24);
  });

  it('parses multiplied catalog strings', () => {
    expect(parsePortCount('4x GbE')).toBe(4);
    expect(parsePortCount('8x GbE + 2x SFP+')).toBe(10);
    expect(parsePortCount('2× 10GbE RJ45')).toBe(2);
  });

  it('falls back to the first integer when no x marker exists', () => {
    expect(parsePortCount('4 ports')).toBe(4);
  });
});

describe('getNodePortCount', () => {
  it('uses parsed details when present', () => {
    expect(getNodePortCount('router', '5x GbE + 1x SFP')).toBe(6);
    expect(getNodePortCount('server', 6)).toBe(6);
  });

  it('falls back to type defaults for dynamic nodes', () => {
    expect(getDefaultPortCount('router')).toBe(4);
    expect(getDefaultPortCount('server')).toBe(4);
    expect(getDefaultPortCount('ups')).toBe(2);
    expect(getNodePortCount('modem', undefined)).toBe(4);
  });
});