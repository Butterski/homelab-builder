import type { HardwareType } from '../../../types';

const DEFAULT_DYNAMIC_PORTS: Partial<Record<HardwareType, number>> = {
  router: 4,
  switch: 4,
  server: 4,
  modem: 4,
  ups: 2,
};

export const getDefaultPortCount = (type: HardwareType) => DEFAULT_DYNAMIC_PORTS[type] ?? 1;

export function parsePortCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? value : undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const direct = Number(trimmed);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }

  const multiplied = [...trimmed.matchAll(/(\d+)\s*[x×]/gi)];
  if (multiplied.length > 0) {
    const total = multiplied.reduce((sum, match) => sum + Number(match[1]), 0);
    return total > 0 ? total : undefined;
  }

  const firstInteger = trimmed.match(/\d+/);
  if (!firstInteger) {
    return undefined;
  }

  const parsed = Number(firstInteger[0]);
  return parsed > 0 ? parsed : undefined;
}

export function getNodePortCount(type: HardwareType, value: unknown): number {
  return parsePortCount(value) ?? getDefaultPortCount(type);
}
