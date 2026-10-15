import { describe, expect, it } from 'vitest';

import {
  isPowerHandle,
  normalizePowerConnection,
  powerHandleIndex,
  powerInputCount,
  powerInputLeft,
  powerOutputCount,
  powerOutputLeft,
} from './power-ports';

describe('power handles', () => {
  it('recognises power handles and their index', () => {
    expect(isPowerHandle('pwr-in-0')).toBe(true);
    expect(isPowerHandle('pwr-out-5')).toBe(true);
    expect(isPowerHandle('eth0')).toBe(false);
    expect(isPowerHandle(null)).toBe(false);
    expect(powerHandleIndex('pwr-out-12', 'pwr-out-')).toBe(12);
    expect(powerHandleIndex('pwr-in-1', 'pwr-out-')).toBe(-1);
    expect(powerHandleIndex('pwr-in-x', 'pwr-in-')).toBe(-1);
    expect(powerHandleIndex('pwr-in-01', 'pwr-in-')).toBe(-1);
  });
});

describe('power counts', () => {
  it('gives devices one input by default, up to four', () => {
    expect(powerInputCount('server', {})).toBe(1);
    expect(powerInputCount('server', { psu_count: 2 })).toBe(2);
    expect(powerInputCount('server', { psu_count: '3' })).toBe(3);
    expect(powerInputCount('server', { psu_count: 9 })).toBe(4);
    expect(powerInputCount('server', { psu_count: -1 })).toBe(0);
    expect(powerInputCount('server', { psu_count: 0 })).toBe(0);
    expect(powerInputCount('ups', undefined)).toBe(1);
  });

  it('gives no inputs to outlets, racks, components and VPSes', () => {
    for (const type of ['power_outlet', 'rack', 'disk', 'gpu', 'hba', 'pcie', 'vps']) {
      expect(powerInputCount(type, { psu_count: 2 })).toBe(0);
    }
  });

  it('gives sockets only to power sources', () => {
    expect(powerOutputCount('ups', {})).toBe(6);
    expect(powerOutputCount('pdu', {})).toBe(8);
    expect(powerOutputCount('power_outlet', null)).toBe(2);
    expect(powerOutputCount('pdu', { outlets: 12 })).toBe(12);
    expect(powerOutputCount('pdu', { outlets: 0 })).toBe(1);
    expect(powerOutputCount('pdu', { outlets: 100 })).toBe(48);
    expect(powerOutputCount('server', { outlets: 4 })).toBe(0);
  });
});

describe('handle geometry', () => {
  it('packs inputs right on networked cards and spreads them on power-only cards', () => {
    expect(powerInputLeft(0, 2, true)).toBe(80);
    expect(powerInputLeft(1, 2, true)).toBe(90);
    expect(powerInputLeft(0, 1, false)).toBe(50);
    expect(powerOutputLeft(0, 3)).toBe(25);
    expect(powerOutputLeft(2, 3)).toBe(75);
  });
});

describe('normalizePowerConnection', () => {
  it('keeps a socket-to-input cable as drawn', () => {
    const c = { source: 'ups', sourceHandle: 'pwr-out-0', target: 'srv', targetHandle: 'pwr-in-0' };
    expect(normalizePowerConnection(c)).toBe(c);
  });

  it('swaps a cable drawn from the input to the socket', () => {
    expect(
      normalizePowerConnection({ source: 'srv', sourceHandle: 'pwr-in-1', target: 'ups', targetHandle: 'pwr-out-2' }),
    ).toEqual({ source: 'ups', sourceHandle: 'pwr-out-2', target: 'srv', targetHandle: 'pwr-in-1' });
  });

  it('refuses mixed, input-to-input and socket-to-socket links', () => {
    expect(
      normalizePowerConnection({ source: 'ups', sourceHandle: 'pwr-out-0', target: 'srv', targetHandle: 'target-0' }),
    ).toBeNull();
    expect(
      normalizePowerConnection({ source: 'a', sourceHandle: 'pwr-in-0', target: 'b', targetHandle: 'pwr-in-0' }),
    ).toBeNull();
    expect(
      normalizePowerConnection({ source: 'a', sourceHandle: 'pwr-out-0', target: 'b', targetHandle: 'pwr-out-1' }),
    ).toBeNull();
    expect(normalizePowerConnection({ source: 'a', sourceHandle: 'eth0', target: 'b', targetHandle: 'target-0' })).toBeNull();
  });
});
