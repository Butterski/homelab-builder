import { describe, expect, it } from 'vitest';
import { RACK_COLS, RACK_REST_ANGLE, RACK_ROWS, renderRack } from './ascii-rack';

const frame = (angle: number, time = 0) => renderRack(angle, time, RACK_COLS, RACK_ROWS);
const count = (text: string, character: string) => text.split(character).length - 1;

describe('the ASCII rack', () => {
  it('fills the same grid in all three layers', () => {
    const still = frame(RACK_REST_ANGLE);
    for (const layer of [still.shade, still.ok, still.near]) {
      const rows = layer.split('\n');
      expect(rows).toHaveLength(RACK_ROWS);
      expect(rows.every(row => row.length === RACK_COLS)).toBe(true);
    }
  });

  it('draws with plain ASCII and never puts a light on top of a shaded character', () => {
    const still = frame(RACK_REST_ANGLE, 2.5);
    expect(still.shade).toMatch(/^[ .:\-=+*#%@\n]+$/);
    expect(still.ok).toMatch(/^[ o\n]+$/);
    expect(still.near).toMatch(/^[ o\n]+$/);
    for (let index = 0; index < still.shade.length; index += 1) {
      if (still.ok[index] === 'o' || still.near[index] === 'o') {
        expect(still.shade[index]).toBe(' ');
      }
    }
  });

  it('stands inside the picture, with room around it', () => {
    for (const angle of [RACK_REST_ANGLE - 0.7, RACK_REST_ANGLE, RACK_REST_ANGLE + 0.7]) {
      const rows = frame(angle).shade.split('\n');
      const solid = (text: string) => /[=+*#%@]/.test(text);
      expect(solid(rows[0]), `top row at ${angle}`).toBe(false);
      expect(solid(rows[RACK_ROWS - 1]), `bottom row at ${angle}`).toBe(false);
      expect(rows.every(row => !solid(row[0]) && !solid(row[RACK_COLS - 1]))).toBe(true);
    }
  });

  it('shows its lights from the front and none from behind', () => {
    const front = frame(0, 1);
    expect(count(front.ok, 'o')).toBeGreaterThan(3);
    expect(count(front.near, 'o')).toBeGreaterThan(0);

    const back = frame(Math.PI, 1);
    expect(count(back.ok, 'o') + count(back.near, 'o')).toBe(0);
  });

  it('shades the faces apart: a lit front and a side in shadow', () => {
    // At rest the rack is turned so that its front and one side show.
    const still = frame(RACK_REST_ANGLE).shade;
    const lit = count(still, '#') + count(still, '%') + count(still, '@');
    const shadow = count(still, '-');

    expect(lit).toBeGreaterThan(250);
    // Seen head-on there is no side to be in shadow, only the recesses of the front.
    expect(shadow - count(frame(0).shade, '-')).toBeGreaterThan(60);
  });

  it('turns its fans when seen from behind', () => {
    const behind = frame(Math.PI, 0);
    expect(count(behind.ok, 'o') + count(behind.near, 'o')).toBe(0);
    expect(behind.shade).not.toBe(frame(Math.PI, 0.1).shade);
  });

  it('gives the same frame for the same angle and time, and blinks over time', () => {
    expect(frame(0.3, 4)).toEqual(frame(0.3, 4));

    const lit = new Set<string>();
    for (let time = 0; time < 6; time += 0.25) lit.add(frame(0, time).ok);
    expect(lit.size).toBeGreaterThan(4);
  });
});
