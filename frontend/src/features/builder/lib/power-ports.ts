import type { Connection } from '@xyflow/react';

import { isPowerSource } from '../../../lib/hardware-config';

// Power handles on a card and how many each device has. The backend applies
// the same rules on save (backend/internal/wiring/power.go).

export { isPowerSource };

/** A power input of a device, one per power supply: pwr-in-0, pwr-in-1, ... */
export const POWER_IN_PREFIX = 'pwr-in-';
/** A socket of a UPS, PDU or power outlet: pwr-out-0, pwr-out-1, ... */
export const POWER_OUT_PREFIX = 'pwr-out-';

const MAX_POWER_INPUTS = 4;
const MIN_SOCKETS = 1;
const MAX_SOCKETS = 48;

/** Types that never take power through a cable. */
const NO_POWER_INPUT: Record<string, true> = {
  power_outlet: true,
  rack: true,
  disk: true,
  gpu: true,
  hba: true,
  pcie: true,
  vps: true,
};

const DEFAULT_SOCKETS: Record<string, number> = { ups: 6, pdu: 8, power_outlet: 2 };

type Details = Record<string, unknown> | object | null | undefined;

export function isPowerHandle(handle?: string | null): boolean {
  return !!handle && (handle.startsWith(POWER_IN_PREFIX) || handle.startsWith(POWER_OUT_PREFIX));
}

/** The N of a handle that starts with prefix, or -1 when it is not such a handle. */
export function powerHandleIndex(handle: string | null | undefined, prefix: string): number {
  if (!handle || !handle.startsWith(prefix)) return -1;
  const rest = handle.slice(prefix.length);
  if (!/^(0|[1-9]\d*)$/.test(rest)) return -1;
  return Number(rest);
}

/**
 * Reads a whole number from details: a JSON number or a numeric string,
 * truncated toward zero. Anything else gives the fallback.
 */
function readCount(details: Details, key: string, fallback: number): number {
  const raw = (details as Record<string, unknown> | null | undefined)?.[key];
  if (typeof raw !== 'number' && typeof raw !== 'string') return fallback;
  if (typeof raw === 'string' && raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/** How many power inputs a device has: details.psu_count, default 1, 0..4. */
export function powerInputCount(type: string | undefined, details: Details): number {
  if (!type || NO_POWER_INPUT[type]) return 0;
  return Math.min(MAX_POWER_INPUTS, Math.max(0, readCount(details, 'psu_count', 1)));
}

/** How many sockets a UPS, PDU or power outlet has: details.outlets, 1..48. Other types have none. */
export function powerOutputCount(type: string | undefined, details: Details): number {
  if (!type || !isPowerSource(type)) return 0;
  return Math.min(MAX_SOCKETS, Math.max(MIN_SOCKETS, readCount(details, 'outlets', DEFAULT_SOCKETS[type])));
}

/**
 * Where power input i sits on the top edge, in percent of the card width. A
 * device with network ports packs its inputs at the right, clear of the uplink
 * in the middle; a power-only device spreads them out.
 */
export function powerInputLeft(i: number, count: number, hasNetworkPorts: boolean): number {
  return hasNetworkPorts ? 100 - 10 * (count - i) : (100 / (count + 1)) * (i + 1);
}

/** Where socket i sits on the bottom edge, in percent of the card width. */
export function powerOutputLeft(i: number, count: number): number {
  return (100 / (count + 1)) * (i + 1);
}

/**
 * Orients a drawn power cable from the socket to the power input, whichever
 * end the user started at. Returns null when the link is not a socket joined
 * to an input.
 */
export function normalizePowerConnection(c: Connection): Connection | null {
  const sourceOut = powerHandleIndex(c.sourceHandle, POWER_OUT_PREFIX) >= 0;
  const sourceIn = powerHandleIndex(c.sourceHandle, POWER_IN_PREFIX) >= 0;
  const targetOut = powerHandleIndex(c.targetHandle, POWER_OUT_PREFIX) >= 0;
  const targetIn = powerHandleIndex(c.targetHandle, POWER_IN_PREFIX) >= 0;
  if (sourceOut && targetIn) return c;
  if (sourceIn && targetOut) {
    return {
      source: c.target,
      sourceHandle: c.targetHandle,
      target: c.source,
      targetHandle: c.sourceHandle,
    };
  }
  return null;
}
