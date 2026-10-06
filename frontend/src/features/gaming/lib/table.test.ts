import { describe, expect, it } from 'vitest';
import {
  newTableDetails,
  resizeTable,
  tablePowerDraw,
  tableSeats,
  tableSwitchPorts,
  tableSwitchPortsFor,
} from './table';

// The same figures are asserted in backend/internal/services/topology_gaming_test.go.
describe('LAN table maths', () => {
  it('picks the smallest switch that keeps a port for the uplink', () => {
    expect(tableSwitchPortsFor(4)).toBe(5);
    expect(tableSwitchPortsFor(6)).toBe(8);
    expect(tableSwitchPortsFor(8)).toBe(16);
    expect(tableSwitchPortsFor(12)).toBe(16);
    expect(tableSwitchPortsFor(24)).toBe(48);
  });

  it('starts a table with 8 seats on a 16-port switch', () => {
    const table = newTableDetails();
    expect(table.details).toEqual({
      seats: 8,
      seat_watts: 350,
      switch_ports: 16,
      switch_speed: '1 GbE',
    });
    expect(table.power_draw).toBe(8 * 350 + 10);
  });

  it('reads a table that has no details yet', () => {
    expect(tableSeats(undefined)).toBe(8);
    expect(tableSwitchPorts({ seats: 6 })).toBe(8);
    expect(tablePowerDraw({ seats: 6 })).toBe(6 * 350 + 10);
  });

  it('grows the switch and the power draw with the seats', () => {
    const grown = resizeTable(newTableDetails(6).details, { seats: 12 });
    expect(grown.details.seats).toBe(12);
    expect(grown.details.switch_ports).toBe(16);
    expect(grown.power_draw).toBe(12 * 350 + 10);

    const hungry = resizeTable(grown.details, { seat_watts: 500 });
    expect(hungry.details.switch_ports).toBe(16);
    expect(hungry.power_draw).toBe(12 * 500 + 10);
  });

  it('keeps a chosen switch when it is big enough and fixes one that is not', () => {
    expect(resizeTable(newTableDetails(6).details, { switch_ports: 24 }).details.switch_ports).toBe(
      24,
    );
    // 8 ports cannot seat 8 players and an uplink.
    expect(
      resizeTable(newTableDetails(8).details, { switch_ports: 8 }).details.switch_ports,
    ).toBe(16);
  });

  it('keeps seats and wattage inside the range the server accepts', () => {
    expect(resizeTable({}, { seats: 99 }).details.seats).toBe(24);
    expect(resizeTable({}, { seats: 0 }).details.seats).toBe(8);
    expect(resizeTable({}, { seat_watts: 5 }).details.seat_watts).toBe(50);
    expect(resizeTable({}, { seat_watts: 9000 }).details.seat_watts).toBe(2000);
  });
});
