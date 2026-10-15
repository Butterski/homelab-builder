import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from './uuid';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe('randomUUID', () => {
  it('uses the native method when available, with crypto as its receiver', () => {
    const expected = '12345678-1234-4234-8234-123456789abc';
    const native = vi.fn(function (this: Crypto) {
      expect(this).toBe(globalThis.crypto);
      return expected;
    });
    const getRandomValues = vi.fn();
    vi.stubGlobal('crypto', { randomUUID: native, getRandomValues });

    expect(randomUUID()).toBe(expected);
    expect(native).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it.each([
    [0x00, '00000000-0000-4000-8000-000000000000'],
    [0xff, 'ffffffff-ffff-4fff-bfff-ffffffffffff'],
  ])('sets the version and variant bits for random bytes filled with %i', (byte, expected) => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes).toHaveLength(16);
      return bytes.fill(byte);
    });
    vi.stubGlobal('crypto', { getRandomValues });

    expect(randomUUID()).toBe(expected);
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it('generates distinct UUID v4 IDs without randomUUID, as on an HTTP LAN origin', () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal('crypto', { getRandomValues });

    const ids = Array.from({ length: 256 }, () => randomUUID());
    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
