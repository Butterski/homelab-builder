/**
 * A small server rack in 3D, drawn with ASCII characters.
 *
 * One ray is cast per character cell. Where it hits the rack, the angle of that
 * surface to the light picks a character from a ramp, thin to dense. The front
 * of each device adds its own detail (ports, drive bays) and its status lights,
 * the back its fans and sockets, the sides their vents. No library and no
 * canvas: the result is three strings of text.
 */

type Vec = [number, number, number];

type Kind = 'frame' | 'patch' | 'switch' | 'server' | 'storage' | 'ups';

type Box = { min: Vec; max: Vec; kind: Kind; id: number };

/** Thin to dense. Only characters every monospace face has. */
const RAMP = ' .:-=+*#%@';

/** Half the rack's width, depth and height. */
const W = 0.5;
const D = 0.42;
const H = 0.86;
/** One rack unit. */
const U = 0.142;
const POST = 0.035;

function box(kind: Kind, id: number, min: Vec, max: Vec): Box {
  return { kind, id, min, max };
}

function buildRack(): Box[] {
  const boxes: Box[] = [];
  let id = 0;
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const cx = x * (W - POST / 2);
      const cz = z * (D - POST / 2);
      boxes.push(
        box('frame', id++, [cx - POST / 2, -H, cz - POST / 2], [cx + POST / 2, H, cz + POST / 2]),
      );
    }
  }
  boxes.push(box('frame', id++, [-W, H - 0.03, -D], [W, H, D]));
  boxes.push(box('frame', id++, [-W, -H, -D], [W, -H + 0.03, D]));

  // From the top: patch panel, switch, one free unit, two servers, a disk shelf, a UPS.
  const devices: Array<[Kind | null, number]> = [
    ['patch', 1],
    ['switch', 1],
    [null, 1],
    ['server', 2],
    ['server', 2],
    ['storage', 2],
    ['ups', 2],
  ];
  let top = H - 0.05;
  for (const [kind, units] of devices) {
    const bottom = top - units * U;
    if (kind) {
      // No gap between two devices: at this size it would only sparkle.
      boxes.push(box(kind, id++, [-W + 0.05, bottom, -D + 0.06], [W - 0.05, top, D - 0.03]));
    }
    top = bottom;
  }
  return boxes;
}

const RACK = buildRack();

const fract = (value: number) => value - Math.floor(value);
/** A fixed pseudo-random number in 0..1 for a whole number. */
const noise = (seed: number) => fract(Math.sin(seed * 127.1 + 311.7) * 43758.5453);

type Light = 'ok' | 'near';
type Detail = { shade: number; light?: Light };

/** How bright a front panel is, a recess in it (a port, a vent), and a raised edge. */
const PANEL = 0.84;
const RECESS = 0.3;
const EDGE = 1.25;

/**
 * What the front of a device looks like at one point: `u` runs left to right,
 * `v` bottom to top, both 0..1. Activity lights flicker with `time`.
 *
 * A rack unit is about three characters high and a device about thirty-five
 * wide, so the detail here is coarse on purpose: anything finer turns to noise.
 */
function front(kind: Kind, id: number, u: number, v: number, time: number): Detail {
  const flicker = (slot: number, rate: number) =>
    noise(id * 31 + slot * 7 + Math.floor(time * rate + noise(slot + id) * 9)) > 0.42;
  const middle = v > 0.34 && v < 0.67;

  switch (kind) {
    case 'patch': {
      // Twelve ports in a row.
      const port = fract(u * 12);
      return { shade: middle && port > 0.3 ? RECESS : PANEL };
    }
    case 'switch': {
      if (u > 0.72) {
        return u > 0.84 && u < 0.9 && middle ? { shade: 1, light: 'near' } : { shade: PANEL };
      }
      // Eight ports, each with its link light above it.
      const index = Math.floor((u / 0.72) * 8);
      const port = fract((u / 0.72) * 8);
      if (v >= 0.67 && port > 0.36 && port < 0.64) {
        // Three ports in four have a link; a linked port blinks with traffic.
        return noise(id + index * 3) > 0.25 && flicker(index, 7)
          ? { shade: 1, light: 'ok' }
          : { shade: PANEL };
      }
      return { shade: v < 0.67 && port > 0.28 ? RECESS : PANEL };
    }
    case 'server': {
      if (u > 0.8) {
        // Power button and a vent.
        if (u > 0.87 && u < 0.93 && v > 0.6 && v < 0.8) return { shade: 1, light: 'ok' };
        return { shade: v < 0.5 && fract(u * 20) < 0.5 ? RECESS : PANEL };
      }
      // Four drive bays, each with an activity light in its lower left corner.
      const bay = Math.floor((u / 0.8) * 4);
      const bu = fract((u / 0.8) * 4);
      if (bu < 0.1 || v < 0.14 || v > 0.86) return { shade: EDGE };
      if (bu > 0.16 && bu < 0.3 && v > 0.2 && v < 0.42) {
        return flicker(bay, 5) ? { shade: 1, light: 'ok' } : { shade: RECESS };
      }
      return { shade: v > 0.5 ? PANEL : 0.6 };
    }
    case 'storage': {
      // Six drive trays standing upright, a light at the foot of each.
      const tray = Math.floor(u * 6);
      const tu = fract(u * 6);
      if (tu < 0.14) return { shade: EDGE };
      if (tu > 0.4 && tu < 0.66 && v > 0.12 && v < 0.32) {
        return flicker(tray, 3) ? { shade: 1, light: 'ok' } : { shade: RECESS };
      }
      return { shade: v > 0.45 ? RECESS : PANEL };
    }
    case 'ups': {
      if (u < 0.36) {
        // A display with one warning light in it.
        const frame = u < 0.07 || u > 0.29 || v < 0.2 || v > 0.8;
        if (!frame && u > 0.2 && u < 0.26 && v > 0.4 && v < 0.62) return { shade: 1, light: 'near' };
        return { shade: frame ? PANEL : RECESS };
      }
      return { shade: fract(u * 9) < 0.5 && v > 0.2 && v < 0.8 ? RECESS : PANEL };
    }
    default:
      return { shade: 1 };
  }
}

/**
 * The back of a device: fans that turn, and the sockets its cables go into.
 * `u` runs left to right as seen from behind.
 */
function back(kind: Kind, u: number, v: number, time: number, aspect: number): number {
  if (kind === 'patch' || kind === 'switch') {
    // A power inlet at one end, otherwise a plain panel.
    return u > 0.8 && u < 0.92 && v > 0.25 && v < 0.75 ? RECESS : PANEL;
  }
  if (kind === 'ups') {
    // Six outlets.
    const outlet = fract(u * 6);
    return outlet > 0.3 && outlet < 0.7 && v > 0.3 && v < 0.7 ? RECESS : PANEL;
  }
  // Servers and the disk shelf: two fans and a power supply.
  if (u > 0.72) return v > 0.25 && v < 0.75 && u > 0.78 && u < 0.94 ? RECESS : PANEL;
  const fan = u < 0.36 ? 0.18 : 0.54;
  const dx = (u - fan) * aspect;
  const dy = v - 0.5;
  const radius = Math.hypot(dx, dy);
  if (radius > 0.46) return PANEL;
  if (radius > 0.36) return EDGE;
  if (radius < 0.1) return PANEL;
  // Three blades, going round.
  const turn = Math.atan2(dy, dx) + time * 5;
  return fract((turn / (Math.PI * 2)) * 3) < 0.5 ? RECESS : 0.62;
}

/** The side of a device: one row of vent slots. `u` runs along its depth. */
function flank(u: number, v: number): number {
  return u > 0.18 && u < 0.82 && v > 0.36 && v < 0.64 ? 0.6 : 1;
}

const LIGHT_DIRECTION: Vec = (() => {
  // From the upper right, in front: the fronts are lit, one side falls into shadow.
  const raw: Vec = [0.35, 0.6, 0.72];
  const length = Math.hypot(...raw);
  return [raw[0] / length, raw[1] / length, raw[2] / length];
})();

// Far away through a narrow lens: the rack's uprights stay close to upright.
const CAMERA_DISTANCE = 6;
const CAMERA_PITCH = 0.2;
const FIELD = 0.184;
/** The picture is aimed a little below the rack's middle, to leave room for the floor. */
const AIM = -0.016;
/** Width of a character cell over its height, as landing.css sets the rack's text. */
const CELL_ASPECT = 0.6 / 1.1;

export type RackFrame = {
  /** The rack and the floor under it. */
  shade: string;
  /** Lights that are on and fine. A space wherever there is none. */
  ok: string;
  /** Lights that ask for attention. */
  near: string;
};

/**
 * One frame. `angle` turns the rack around its vertical axis (0 faces the
 * viewer); `time` in seconds drives the lights. The same arguments always give
 * the same text.
 */
export function renderRack(angle: number, time: number, cols: number, rows: number): RackFrame {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const aspect = (cols * CELL_ASPECT) / rows;

  const cy = CAMERA_DISTANCE * Math.sin(CAMERA_PITCH);
  const cz = CAMERA_DISTANCE * Math.cos(CAMERA_PITCH);
  // The camera looks at the middle of the rack: forward, and the two axes of the picture.
  const fy = -Math.sin(CAMERA_PITCH);
  const fz = -Math.cos(CAMERA_PITCH);
  const upY = Math.cos(CAMERA_PITCH);
  const upZ = -Math.sin(CAMERA_PITCH);

  // The rack stands still and the camera goes around it: rays are turned into the rack's space.
  const ox = -cz * sin;
  const oy = cy;
  const oz = cz * cos;

  const origin = [ox, oy, oz];
  const direction = [0, 0, 0];

  const shade: string[] = [];
  const ok: string[] = [];
  const near: string[] = [];

  for (let row = 0; row < rows; row += 1) {
    let shadeRow = '';
    let okRow = '';
    let nearRow = '';
    const py = (1 - (2 * (row + 0.5)) / rows) * FIELD + AIM;

    for (let col = 0; col < cols; col += 1) {
      const px = ((2 * (col + 0.5)) / cols - 1) * FIELD * aspect;
      const wx = px;
      const wy = fy + py * upY;
      const wz = fz + py * upZ;
      const length = Math.hypot(wx, wy, wz);
      const dx = (wx * cos - wz * sin) / length;
      const dy = wy / length;
      const dz = (wx * sin + wz * cos) / length;

      direction[0] = dx;
      direction[1] = dy;
      direction[2] = dz;

      let nearest = Infinity;
      let hit: Box | null = null;
      let axis = 0;
      let side = 0;

      for (const candidate of RACK) {
        let tMin = -Infinity;
        let tMax = Infinity;
        let enterAxis = 0;
        let enterSide = 0;
        let missed = false;
        for (let index = 0; index < 3; index += 1) {
          const inverse = 1 / direction[index];
          let t0 = (candidate.min[index] - origin[index]) * inverse;
          let t1 = (candidate.max[index] - origin[index]) * inverse;
          let enters = -1;
          if (t0 > t1) {
            [t0, t1] = [t1, t0];
            enters = 1;
          }
          if (t0 > tMin) {
            tMin = t0;
            enterAxis = index;
            enterSide = enters;
          }
          if (t1 < tMax) tMax = t1;
          if (tMin > tMax) {
            missed = true;
            break;
          }
        }
        if (!missed && tMin > 0 && tMin < nearest) {
          nearest = tMin;
          hit = candidate;
          axis = enterAxis;
          side = enterSide;
        }
      }

      if (!hit) {
        // The floor: a grid of dots under the rack, fading out with distance.
        const t = dy < 0 ? (-H - oy) / dy : -1;
        const gx = ox + dx * t;
        const gz = oz + dz * t;
        const onGrid = t > 0 && fract(gx * 4 + 0.5) < 0.24 && fract(gz * 4 + 0.5) < 0.24;
        shadeRow += onGrid && Math.hypot(gx, gz) < 1.3 ? '.' : ' ';
        okRow += ' ';
        nearRow += ' ';
        continue;
      }

      // The surface normal, turned back to where the light is.
      const nx = axis === 0 ? side : 0;
      const ny = axis === 1 ? side : 0;
      const nz = axis === 2 ? side : 0;
      const lit =
        (nx * cos + nz * sin) * LIGHT_DIRECTION[0] +
        ny * LIGHT_DIRECTION[1] +
        (-nx * sin + nz * cos) * LIGHT_DIRECTION[2];
      let brightness = 0.38 + 0.62 * Math.max(0, lit);
      let light: Light | undefined;

      if (hit.kind === 'frame') {
        brightness *= 0.8;
      } else if (axis !== 1) {
        const width = hit.max[0] - hit.min[0];
        const height = hit.max[1] - hit.min[1];
        const u = (ox + dx * nearest - hit.min[0]) / width;
        const v = (oy + dy * nearest - hit.min[1]) / height;
        if (axis === 0) {
          brightness *= flank((oz + dz * nearest - hit.min[2]) / (hit.max[2] - hit.min[2]), v);
        } else if (side === 1) {
          const detail = front(hit.kind, hit.id, u, v, time);
          brightness = (0.45 + 0.55 * brightness) * detail.shade;
          light = detail.light;
        } else {
          brightness = (0.45 + 0.55 * brightness) * back(hit.kind, 1 - u, v, time, width / height);
        }
      }

      if (light) {
        shadeRow += ' ';
        okRow += light === 'ok' ? 'o' : ' ';
        nearRow += light === 'near' ? 'o' : ' ';
      } else {
        const step = Math.min(RAMP.length - 1, Math.max(1, Math.round(brightness * (RAMP.length - 1))));
        shadeRow += RAMP[step];
        okRow += ' ';
        nearRow += ' ';
      }
    }

    shade.push(shadeRow);
    ok.push(okRow);
    near.push(nearRow);
  }

  return { shade: shade.join('\n'), ok: ok.join('\n'), near: near.join('\n') };
}

export const RACK_COLS = 60;
export const RACK_ROWS = 40;

/** The angle the rack rests at: turned a little, so its front and one side show. */
export const RACK_REST_ANGLE = 0.45;
