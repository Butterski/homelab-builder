import type { HardwareSpec } from '../../../types';

// A LAN table stands for a row of seats and the small switch on it. These
// rules mirror backend/internal/services/topology_gaming.go.

export const MAX_TABLE_SEATS = 24;
export const DEFAULT_TABLE_SEATS = 8;
export const DEFAULT_SEAT_WATTS = 350;
export const MIN_SEAT_WATTS = 50;
export const MAX_SEAT_WATTS = 2000;
export const TABLE_SWITCH_WATTS = 10;

/** Port counts small unmanaged switches are sold in. */
export const TABLE_SWITCH_SIZES = [5, 8, 16, 24, 48];
export const TABLE_SWITCH_SPEEDS = ['1 GbE', '2.5 GbE', '10 GbE'] as const;

export const CONSOLE_PLATFORMS = [
  { value: 'playstation', label: 'PlayStation' },
  { value: 'xbox', label: 'Xbox' },
  { value: 'switch', label: 'Nintendo Switch' },
  { value: 'handheld', label: 'Handheld PC' },
  { value: 'other', label: 'Other' },
] as const;

/** The smallest common switch that seats every player and keeps a port for the uplink. */
export function tableSwitchPortsFor(seats: number): number {
  return TABLE_SWITCH_SIZES.find(size => size >= seats + 1) ?? seats + 1;
}

export function tableSeats(details: HardwareSpec | undefined): number {
  const seats = Math.round(Number(details?.seats));
  return Number.isFinite(seats) && seats > 0 ? seats : DEFAULT_TABLE_SEATS;
}

export function tableSeatWatts(details: HardwareSpec | undefined): number {
  const watts = Number(details?.seat_watts);
  return Number.isFinite(watts) && watts > 0 ? watts : DEFAULT_SEAT_WATTS;
}

export function tableSwitchPorts(details: HardwareSpec | undefined): number {
  const ports = Math.round(Number(details?.switch_ports));
  return Number.isFinite(ports) && ports > 0 ? ports : tableSwitchPortsFor(tableSeats(details));
}

/** What a full table pulls: every seat plus the table switch. */
export function tablePowerDraw(details: HardwareSpec | undefined): number {
  return tableSeats(details) * tableSeatWatts(details) + TABLE_SWITCH_WATTS;
}

/** The details and power draw a new LAN table starts with. */
export function newTableDetails(seats = DEFAULT_TABLE_SEATS): {
  details: HardwareSpec;
  power_draw: number;
} {
  const details: HardwareSpec = {
    seats,
    seat_watts: DEFAULT_SEAT_WATTS,
    switch_ports: tableSwitchPortsFor(seats),
    switch_speed: TABLE_SWITCH_SPEEDS[0],
  };
  return { details, power_draw: tablePowerDraw(details) };
}

/**
 * Applies a change to a table's seats or wattage. The switch grows with the
 * seats unless the same change sets it, and the power draw follows.
 */
export function resizeTable(
  details: HardwareSpec | undefined,
  change: Pick<HardwareSpec, 'seats' | 'seat_watts' | 'switch_ports' | 'switch_speed'>,
): { details: HardwareSpec; power_draw: number } {
  const next: HardwareSpec = { ...(details ?? {}), ...change };
  const seats = Math.min(MAX_TABLE_SEATS, Math.max(1, tableSeats(next)));
  next.seats = seats;
  next.seat_watts = Math.min(MAX_SEAT_WATTS, Math.max(MIN_SEAT_WATTS, tableSeatWatts(next)));
  if (change.switch_ports === undefined || Number(next.switch_ports) < seats + 1) {
    next.switch_ports = Math.max(tableSwitchPortsFor(seats), change.switch_ports ?? 0);
  }
  if (!next.switch_speed) next.switch_speed = TABLE_SWITCH_SPEEDS[0];
  return { details: next, power_draw: tablePowerDraw(next) };
}
