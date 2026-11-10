import {
  AdditiveBlending,
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type Bone,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SpotSpec } from '../../../config/nightmare.config';
import { REDUCED_MOTION } from '../../../config/experience.config';
import { clamp, DEG, lerp, range, smootherstep } from '../../math';
import { randomFrom, type FigureSpec } from '../../dream/FigureKit';
import type { DreamLight } from '../../dream/LightPool';
import { WARP_GLSL, warpUniforms } from '../../render/Warp';
import { Fire } from '../Fire';
import type { RoomAir, RoomAssets, RoomContext, RoomControl, RoomFilm, RoomFrame, RoomKey, RoomPose } from '../Room';
import { Room } from '../Room';
import { PALETTE } from '../RoomKit';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['bed_gothic', 'doll_low', 'dining_table', 'dining_chair', 'plate', 'fork', 'knife', 'roast_lump'],
  materials: ['conc_pour_lifts'],
  sounds: [
    'rooms/fall_wind.mp3',
    'rooms/air_rush.mp3',
    'rooms/wind_in_ears.mp3',
    'rooms/shaft_wind.mp3',
    'rooms/wind_high_tube.mp3',
    'rooms/paper_flutter.mp3',
    'rooms/shepard_rise.mp3',
    'rooms/rising_tone.mp3',
    'rooms/whoosh_fall.mp3',
    'rooms/door_pass_1.mp3',
    'rooms/door_pass_2.mp3',
    'rooms/door_pass_3.mp3',
    'rooms/fork_plate_3.mp3',
    'rooms/fire_roar_by.mp3',
    'rooms/stop_thud.mp3',
  ],
};

type V3 = readonly [number, number, number];

/** Its length (s) and how finely the fall is written down (samples per s). */
const SECONDS = 32;
const TABLE_RATE = 60;
/** The shaft: half its width, one storey, the thickness of its walls (m). */
const W = 5.2;
const STOREY = 5;
const WALL_T = 0.45;
/** The ledge under every floor: how far it stands out and how tall it is (m). */
const LEDGE = 0.62;
const LEDGE_H = 0.38;
/** Mesh of the walls, so that they bend with curved space (m). */
const GRID = 1.3;
/** An open door: width, height, how far along its wall it stands (m), how far its leaf stands open (rad). */
const DOOR = { s: W / 2, w: 2.3, h: 3.5 };
const LEAF_OPEN = 1.25;
/** The room behind a door (m). */
const ROOM_W = 5.4;
const ROOM_D = 5;
const ROOM_H = 3.9;
/** The floor that goes on out of each door over the shaft, and stops (m). */
const LANDING = 2.75;
const LANDING_W = 3.5;
/** Storeys that exist at once, those of them above the eye, and how far down the furnishings are drawn (m). */
const SLOTS = 16;
const ABOVE = 3;
const FURNISHED_TO = 36;
/** Light baked on the walls: size of the strip (px) and where its reserved rows lie (v). */
const LIGHT_W = 2048;
const LIGHT_H = 256;
const WARM_V = 0.21;
const TOP_V = 0.11;
const UNDER_V = 0.025;
/** How strongly the baked light counts on plaster, wood, stone. */
const LIGHT_WALL = 12;
const LIGHT_WOOD = 8;
const LIGHT_STONE = 9;

/** The fall (m/s): at the start, at full speed, nearly still at the door, at the very end. */
const V_START = 5;
const V_FULL = 44;
const V_DRIFT = 1;
const V_END = 105;
/** Slower for those who asked for less motion. */
const CALM = REDUCED_MOTION ? 0.42 : 1;
/** The door of the dinner (s): braking starts, nearly still, it passes the eye, speed returns, full speed again. */
const T_BRAKE = 18.4;
const T_DRIFT = 19.7;
const T_PASS = 20.7;
const T_DRIFT_END = 21.7;
const T_BACK = 23.2;
/** The floor on fire passes the eye, the air goes quiet, the stop (s). */
const T_FIRE = 25;
const T_CUT = 31.32;
const T_END = 31.5;
/** The eye's height above the dinner's floor at the shutter (m), how late their heads follow it (s). */
const EYE_AT_TABLE = 1.8;
const HEADS_LAG = 0.22;
/** Lights: at a door (intensity), its reach (m), the pendant over the table, the burning floor. */
const DOOR_LAMP = 13;
const DOOR_REACH = 6.5;
const PENDANT = 11;
const FIRE_LIGHT = 620;
/** The dinner: room (m), the table's center behind the wall, where they sit, how high hips are in a chair. */
const DINNER_W = 7.2;
const DINNER_D = 6;
const TABLE_AT = 2.3;
const TABLE_SCALE = 0.9;
/** They are larger than life in here, and so is what they sit at (share). */
const FAMILY_SCALE = 1.3;
const TABLE_HALF = 1.02;
const SIDE_X = 0.84;
const HIPS_Y = 0.62;
const SIT_POSE = 4.2;
/** Yourself: where your feet hang from the eye (m), how far the body leans back (rad). */
const FEET = { y: -1.5, z: 0.62 };
const SELF_LEAN = 0.3;
/** Fog: its density and the two colors between which it goes. */
const FOG_DENSITY = 0.024;
const FOG_DARK = [0.022, 0.04, 0.04] as const;
const FOG_PALE = [0.5, 0.52, 0.5] as const;
/** The paper: sheets, prints that stay with you, how tall the space they fall through is (m) and how much is below the eye. */
const SHEETS = 2200;
const PRINTS_NEAR = 14;
const PAPER_RANGE = 22;
const PAPER_BELOW = 15;
/** Share of the fall by which the sheets rise past you, and how fast they tumble when the fall has stopped. */
const PAPER_SLIP = 0.17;
const PAPER_STILL = 0.04;
/** Radius of the column down the middle that the sheets leave free (m). */
const PAPER_CLEAR = 2.2;
/** Sheets placed so as to hang before the door of the dinner at the moment of the shutter. */
const SHEETS_AT_TABLE = 44;
/** Atlas of prints and pages: cells across, size of a cell, how many cells are prints (px). */
const ATLAS_CELLS = 5;
const ATLAS_CELL = 200;
const PRINT_CELLS = 21;
/** How a fire lights the falling paper (rgb): warm, but never so orange that a page could pass for a chip of brick. */
const PAPER_FIRE = [2.2, 1.65, 1.0] as const;
/** The streaks of light: the tones of a print (amber, cream, silver), never pure red or teal. */
const RIBBON_TONES = [0xe8b878, 0xc49a80, 0xc4ccc8, 0xf4e2c4, 0xe8c08c, 0xb89a88];
/** Streaming color: ribbons in the air by the walls and in the middle, their span in height (m). */
const RIBBONS_WALL = 48;
const RIBBONS_AIR = 20;
const RIBBON_TOP = 14;
const RIBBON_BOTTOM = -100;
/** The white floor and the pale square you fell from (m): how far they are drawn at most (keeps them inside the far plane). */
const FAR_DRAWN = 170;
const ZENITH_START = 90;

const K = (s: number, at: V3, yaw: number, pitch: number, fov: number): RoomKey => ({ t: s / SECONDS, at, yaw, pitch, fov });

/** The fall, from above: you turn about the line down, then you are brought round to face one door, then you drop again. */
function cameraKeys(): RoomKey[] {
  const calm = REDUCED_MOTION;
  const turn = calm ? 0 : 1;
  const c: V3 = [0, 0, 0];
  const far: V3 = [0, 0, -W + 2.75];
  const near: V3 = [0, 0, -W + 2.3];
  const swing = calm ? 16.6 : T_BRAKE;
  return [
    K(0, c, -90 * turn, -87, 60),
    K(8, c, -64 * turn, -87, 62),
    K(14, c, -36 * turn, -87, calm ? 62 : 72),
    K(swing, c, -7 * turn, -87, calm ? 62 : 78),
    K(T_DRIFT, far, 0, -7, 41),
    K(T_PASS, near, 0, -2, 38.5),
    K(T_DRIFT_END, far, 0, 3, 40),
    K(T_BACK, c, 34 * turn, -87, calm ? 62 : 76),
    K(T_FIRE, c, 66 * turn, -87, calm ? 62 : 80),
    K(28, c, 150 * turn, -87, calm ? 62 : 84),
    K(T_END, c, 320 * turn, -87, calm ? 62 : 94),
    K(SECONDS, c, 322 * turn, -87, calm ? 62 : 94),
  ];
}

/** How much the fall has been braked at this second (0..1). */
function brakeAt(s: number): number {
  return smootherstep(range(T_BRAKE, T_DRIFT, s)) * (1 - smootherstep(range(T_DRIFT_END, T_BACK, s)));
}

/** The fall's speed at this second (m/s). */
function speedAt(s: number): number {
  const grows = V_START + (V_FULL - V_START) * smootherstep(range(0, 14, s));
  const last = (V_END - V_FULL) * smootherstep(range(25.6, 31, s));
  return lerp(grows + last, V_DRIFT, brakeAt(s));
}

/** Which way each face of a wall's own coordinates goes in a ring's frame. */
function placeOnWall(wall: number, s: number, t: number): [number, number] {
  if (wall === 0) return [s, -W + t];
  if (wall === 1) return [W - t, s];
  if (wall === 2) return [-s, W - t];
  return [-W + t, -s];
}

function turnOnWall(wall: number, ns: number, nt: number): [number, number] {
  if (wall === 0) return [ns, nt];
  if (wall === 1) return [-nt, ns];
  if (wall === 2) return [-ns, -nt];
  return [nt, -ns];
}

type Row = 'wall' | 'top' | 'under' | 'warm';
interface DoorSpec {
  s: number;
  w: number;
  h: number;
  leaves: 1 | 2;
  /** How far its leaves stand open (rad). */
  open: number;
}

/**
 * Quads given in a wall's own coordinates: s along it, y up, t out of it into the shaft. Meter UVs for the
 * surface; a second set for the strip of baked light that goes once around the storey.
 */
class Soup {
  private readonly p: number[] = [];
  private readonly n: number[] = [];
  private readonly uv: number[] = [];
  private readonly light: number[] = [];
  private readonly index: number[] = [];

  quad(wall: number, a: V3, b: V3, c: V3, d: V3, n: V3, row: Row): void {
    const base = this.p.length / 3;
    const ns = Math.abs(n[0]);
    const ny = Math.abs(n[1]);
    const nt = Math.abs(n[2]);
    const [nx, nz] = turnOnWall(wall, n[0], n[2]);
    for (const v of [a, b, c, d]) {
      const [x, z] = placeOnWall(wall, v[0], v[2]);
      this.p.push(x, v[1], z);
      this.n.push(nx, n[1], nz);
      if (ny >= ns && ny >= nt) this.uv.push(v[0], v[2]);
      else if (nt >= ns) this.uv.push(v[0], v[1]);
      else this.uv.push(v[2], v[1]);
      const u = (wall + (clamp(v[0], -W, W) + W) / (2 * W)) / 4;
      if (row === 'wall') this.light.push(u, 0.25 + 0.75 * clamp(v[1] / STOREY, 0, 1));
      else this.light.push(u, row === 'top' ? TOP_V : row === 'under' ? UNDER_V : WARM_V);
    }
    this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** A box standing out of a wall; its back is never seen. */
  box(wall: number, s0: number, s1: number, y0: number, y1: number, t0: number, t1: number, front: Row = 'wall'): void {
    this.quad(wall, [s0, y0, t1], [s1, y0, t1], [s1, y1, t1], [s0, y1, t1], [0, 0, 1], front);
    this.quad(wall, [s0, y1, t1], [s1, y1, t1], [s1, y1, t0], [s0, y1, t0], [0, 1, 0], 'top');
    this.quad(wall, [s0, y0, t0], [s1, y0, t0], [s1, y0, t1], [s0, y0, t1], [0, -1, 0], 'under');
    this.quad(wall, [s1, y0, t1], [s1, y0, t0], [s1, y1, t0], [s1, y1, t1], [1, 0, 0], front);
    this.quad(wall, [s0, y0, t0], [s0, y0, t1], [s0, y1, t1], [s0, y1, t0], [-1, 0, 0], front);
  }

  /** A slab turned about a vertical edge (a door leaf): `(us, ut)` runs along it. `lit` is the side that sees the room. */
  slab(wall: number, hs: number, ht: number, us: number, ut: number, length: number, y0: number, y1: number, half: number, lit: 1 | 0 | -1): void {
    const nx = ut;
    const nz = -us;
    const at = (l: number, side: number, y: number): V3 => [hs + us * l + side * nx * half, y, ht + ut * l + side * nz * half];
    this.quad(wall, at(0, -1, y0), at(length, -1, y0), at(length, -1, y1), at(0, -1, y1), [-nx, 0, -nz], lit === -1 ? 'warm' : 'wall');
    this.quad(wall, at(length, 1, y0), at(0, 1, y0), at(0, 1, y1), at(length, 1, y1), [nx, 0, nz], lit === 1 ? 'warm' : 'wall');
    this.quad(wall, at(0, -1, y1), at(length, -1, y1), at(length, 1, y1), at(0, 1, y1), [0, 1, 0], 'top');
    this.quad(wall, at(length, -1, y0), at(length, 1, y0), at(length, 1, y1), at(length, -1, y1), [us, 0, ut], 'wall');
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('uv1', new Float32BufferAttribute(this.light, 2));
    g.setIndex(this.index);
    return g;
  }
}

/** One storey: plaster with the door cut out of it, then wood and stone. */
function buildStorey(door: DoorSpec): { wall: BufferGeometry; wood: BufferGeometry; stone: BufferGeometry } {
  const wall = new Soup();
  const wood = new Soup();
  const stone = new Soup();
  const L = door.s - door.w / 2;
  const R = door.s + door.w / 2;
  const ys = [0, 1.25, 2.5, door.h, STOREY - LEDGE_H, STOREY].sort((a, b) => a - b);
  for (let w = 0; w < 4; w++) {
    const cuts = new Set<number>([-W, W]);
    for (let s = -W + GRID; s < W - 0.01; s += GRID) cuts.add(s);
    if (w === 0) {
      cuts.add(L);
      cuts.add(R);
    }
    const ss = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < ss.length - 1; i++) {
      for (let j = 0; j < ys.length - 1; j++) {
        if (w === 0 && ss[i] >= L - 0.001 && ss[i + 1] <= R + 0.001 && ys[j + 1] <= door.h + 0.001) continue;
        wall.quad(w, [ss[i], ys[j], 0], [ss[i + 1], ys[j], 0], [ss[i + 1], ys[j + 1], 0], [ss[i], ys[j + 1], 0], [0, 0, 1], 'wall');
      }
    }
    // the ledge runs round without a gap: two of the walls carry the corners
    const c1 = w % 2 === 0 ? 0 : LEDGE * 0.7;
    const c2 = w % 2 === 0 ? 0 : LEDGE;
    stone.box(w, -W + c1, W - c1, STOREY - LEDGE_H, STOREY - 0.12, 0, LEDGE * 0.7);
    stone.box(w, -W + c2, W - c2, STOREY - 0.12, STOREY, 0, LEDGE);
    for (const at of [-W + 0.3, 0, W - 0.3]) {
      if (at === 0 && w === 0 && Math.abs(door.s) < 1) continue;
      stone.box(w, at - 0.26, at + 0.26, 0, STOREY - LEDGE_H, 0, 0.22);
    }
    // wainscot, round the door on its wall
    const runs: readonly (readonly [number, number])[] = w === 0 ? [[-W, L - 0.2], [R + 0.2, W]] : [[-W, W]];
    for (const [a, b] of runs) {
      wood.box(w, a, b, 0, 0.2, 0, 0.09);
      wood.box(w, a, b, 0.2, 1.3, 0, 0.035);
      wood.box(w, a, b, 1.3, 1.38, 0, 0.1);
    }
    // every other door of the floor stays shut
    for (const at of [-W / 2, W / 2]) {
      if (w === 0 && Math.abs(at - door.s) < 2.5) continue;
      const half = 0.85;
      const h = 3.05;
      wood.box(w, at - half - 0.16, at - half, 0, h + 0.14, 0, 0.11);
      wood.box(w, at + half, at + half + 0.16, 0, h + 0.14, 0, 0.11);
      wood.box(w, at - half - 0.16, at + half + 0.16, h, h + 0.22, 0, 0.13);
      wood.box(w, at - half, at + half, 0, h, 0, 0.05);
    }
  }
  // the opening: its sides, its head, its threshold and the floor that goes on a little way and stops
  stone.quad(0, [L, 0, 0], [L, 0, -WALL_T], [L, door.h, -WALL_T], [L, door.h, 0], [1, 0, 0], 'warm');
  stone.quad(0, [R, 0, -WALL_T], [R, 0, 0], [R, door.h, 0], [R, door.h, -WALL_T], [-1, 0, 0], 'warm');
  stone.quad(0, [L, door.h, -WALL_T], [R, door.h, -WALL_T], [R, door.h, 0], [L, door.h, 0], [0, -1, 0], 'warm');
  stone.quad(0, [L, 0.002, 0], [R, 0.002, 0], [R, 0.002, -WALL_T], [L, 0.002, -WALL_T], [0, 1, 0], 'warm');
  if (door.leaves === 1) stone.box(0, door.s - LANDING_W / 2, door.s + LANDING_W / 2, -0.24, 0.006, -0.02, LANDING);
  else stone.box(0, L - 0.12, R + 0.12, -0.12, 0.012, -0.02, 1.05);
  wood.box(0, L - 0.2, L, 0, door.h + 0.2, 0, 0.13);
  wood.box(0, R, R + 0.2, 0, door.h + 0.2, 0, 0.13);
  wood.box(0, L - 0.2, R + 0.2, door.h, door.h + 0.26, 0, 0.16);
  const ca = Math.cos(door.open);
  const sa = Math.sin(door.open);
  if (door.leaves === 1) wood.slab(0, R + 0.02, 0.1, -ca, sa, door.w, 0.02, door.h, 0.03, 0);
  else {
    wood.slab(0, R + 0.02, 0.1, -ca, sa, door.w / 2, 0.02, door.h, 0.03, -1);
    wood.slab(0, L - 0.02, 0.1, ca, sa, door.w / 2, 0.02, door.h, 0.03, 1);
  }
  return { wall: wall.geometry(), wood: wood.geometry(), stone: stone.geometry() };
}

/** A canvas you can see through as a color map, or use as light. */
function canvasOf(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The light of one storey, painted: cold from far above, damp, and warm around its open door. */
function bakeLight(door: DoorSpec, seed: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = LIGHT_W;
  canvas.height = LIGHT_H;
  const c = canvas.getContext('2d')!;
  const random = randomFrom(seed);
  const wallRows = LIGHT_H * 0.75;
  const perMeterX = LIGHT_W / (8 * W);
  const perMeterY = wallRows / STOREY;
  const px = (wall: number, s: number) => ((wall + (s + W) / (2 * W)) * LIGHT_W) / 4;
  const py = (y: number) => (1 - y / STOREY) * wallRows;
  const row = (v: number) => (1 - v) * LIGHT_H;
  c.fillStyle = '#58625e';
  c.fillRect(0, 0, LIGHT_W, wallRows);
  // the dark under the ledge above, thinning out downward
  let g = c.createLinearGradient(0, 0, 0, wallRows);
  g.addColorStop(0, 'rgba(0,0,0,0.9)');
  g.addColorStop(0.2, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0.05)');
  c.fillStyle = g;
  c.fillRect(0, 0, LIGHT_W, wallRows);
  // corners
  for (let w = 0; w < 4; w++) {
    g = c.createLinearGradient(px(w, -W), 0, px(w, W), 0);
    g.addColorStop(0, 'rgba(0,0,0,0.72)');
    g.addColorStop(0.16, 'rgba(0,0,0,0)');
    g.addColorStop(0.84, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.72)');
    c.fillStyle = g;
    c.fillRect(px(w, -W), 0, LIGHT_W / 4, wallRows);
  }
  // water has come down these walls for a long time
  for (let i = 0; i < 130; i++) {
    const x = random() * LIGHT_W;
    const length = (0.15 + random() * 0.85) * wallRows;
    const w = 3 + random() * random() * 34;
    g = c.createLinearGradient(0, 0, 0, length);
    g.addColorStop(0, `rgba(0,0,0,${0.06 + random() * 0.24})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x, 0, w, length);
  }
  for (let i = 0; i < 70; i++) {
    const x = random() * LIGHT_W;
    const y = random() * wallRows;
    const r = 8 + random() * 44;
    g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${0.12 + random() * 0.3})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const pool = (x: number, y: number, rx: number, ry: number, color: string) => {
    c.save();
    c.translate(x, y);
    c.scale(rx, ry);
    const p = c.createRadialGradient(0, 0, 0, 0, 0, 1);
    p.addColorStop(0, color);
    p.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = p;
    c.beginPath();
    c.arc(0, 0, 1, 0, Math.PI * 2);
    c.fill();
    c.restore();
  };
  c.globalCompositeOperation = 'lighter';
  // the air round the door glows; across the shaft lies the door's own shape, faint
  pool(px(0, door.s), py(door.h * 0.45), 3.6 * perMeterX, 2.8 * perMeterY, 'rgba(255,170,96,0.62)');
  pool(px(2, -door.s), py(door.h * 0.42), 1.9 * perMeterX, 2.1 * perMeterY, 'rgba(255,170,96,0.2)');
  c.globalCompositeOperation = 'source-over';
  // the rows: faces in the door's light, faces looking up at the cold, faces looking down
  c.fillStyle = '#5e3c24';
  c.fillRect(0, row(0.25), LIGHT_W, row(0.17) - row(0.25));
  c.fillStyle = '#b4c0ba';
  c.fillRect(0, row(0.17), LIGHT_W, row(0.05) - row(0.17));
  for (let i = 0; i < 70; i++) {
    const x = random() * LIGHT_W;
    const w = 30 + random() * 150;
    g = c.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, `rgba(0,0,0,${0.12 + random() * 0.3})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x, row(0.17), w, row(0.05) - row(0.17));
  }
  for (let w = 0; w < 4; w++) {
    g = c.createLinearGradient(px(w, -W), 0, px(w, W), 0);
    g.addColorStop(0, 'rgba(0,0,0,0.6)');
    g.addColorStop(0.12, 'rgba(0,0,0,0)');
    g.addColorStop(0.88, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.6)');
    c.fillStyle = g;
    c.fillRect(px(w, -W), row(0.17), LIGHT_W / 4, row(0.05) - row(0.17));
  }
  c.globalCompositeOperation = 'lighter';
  pool(px(0, door.s), row(0.11), 2.7 * perMeterX, 22, 'rgba(255,160,80,0.5)');
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = '#0a0d0c';
  c.fillRect(0, row(0.05), LIGHT_W, LIGHT_H - row(0.05));
  const t = canvasOf(canvas);
  t.channel = 1;
  return t;
}

type FloorKind = 'checker' | 'tile' | 'boards' | 'carpet';
type LookKey = 'house' | 'ward' | 'teal' | 'rust' | 'red';

/** What a room behind a door is made of, and the light in it. */
const LOOKS: Record<LookKey, { floor: FloorKind; paper: readonly [string, string]; glow: string; light: number; shell: number }> = {
  house: { floor: 'checker', paper: PALETTE.damaskGreen, glow: '#ffdcae', light: 0xffc98a, shell: 0xfff2e4 },
  ward: { floor: 'tile', paper: PALETTE.ward, glow: '#d9f2e2', light: 0xcdf0dc, shell: 0xdcf6e8 },
  teal: { floor: 'carpet', paper: PALETTE.damaskTeal, glow: '#aad8ec', light: 0x9fd2ea, shell: 0xc8eafa },
  rust: { floor: 'boards', paper: PALETTE.damaskRust, glow: '#ffb070', light: 0xff9a50, shell: 0xffdcc0 },
  red: { floor: 'boards', paper: PALETTE.damaskRust, glow: '#ff5e40', light: 0xff3a20, shell: 0xffa89a },
};

type Tableau = 'chair' | 'clock' | 'bed' | 'chairs' | 'doll' | 'dentist' | 'headless' | 'circle' | 'table' | 'neck' | 'veil' | 'crowd' | 'prints' | 'crouch' | 'child';

/** The floors, from the top, again and again. */
const FLOORS: readonly { what: Tableau; look: LookKey }[] = [
  { what: 'chair', look: 'house' },
  { what: 'clock', look: 'house' },
  { what: 'bed', look: 'ward' },
  { what: 'chairs', look: 'teal' },
  { what: 'doll', look: 'rust' },
  { what: 'dentist', look: 'ward' },
  { what: 'headless', look: 'house' },
  { what: 'circle', look: 'teal' },
  { what: 'table', look: 'house' },
  { what: 'neck', look: 'red' },
  { what: 'veil', look: 'rust' },
  { what: 'crowd', look: 'house' },
  { what: 'prints', look: 'house' },
  { what: 'crouch', look: 'ward' },
  { what: 'bed', look: 'ward' },
  { what: 'child', look: 'teal' },
];

/** Plain white, as a map, so that a lamp or a white floor needs no shader of its own. */
function whiteMap(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#fff';
  c.fillRect(0, 0, 2, 2);
  return canvasOf(canvas);
}

/** A floor seen from above, with the lamp already on it. */
function paintFloor(kind: FloorKind, glow: string, seed: number): CanvasTexture {
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const c = canvas.getContext('2d')!;
  const random = randomFrom(seed);
  if (kind === 'checker') {
    const n = 10;
    const q = S / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        c.fillStyle = (x + y) % 2 === 0 ? '#b0a48e' : '#0e0d0b';
        c.fillRect(x * q, y * q, q, q);
      }
    }
    c.strokeStyle = 'rgba(0,0,0,0.7)';
    c.lineWidth = 1.5;
    for (let i = 0; i <= n; i++) {
      c.beginPath();
      c.moveTo(i * q, 0);
      c.lineTo(i * q, S);
      c.moveTo(0, i * q);
      c.lineTo(S, i * q);
      c.stroke();
    }
  } else if (kind === 'tile') {
    c.fillStyle = '#78837a';
    c.fillRect(0, 0, S, S);
    c.strokeStyle = 'rgba(30,40,34,0.75)';
    c.lineWidth = 2;
    const q = S / 18;
    for (let i = 0; i <= 18; i++) {
      c.beginPath();
      c.moveTo(i * q, 0);
      c.lineTo(i * q, S);
      c.moveTo(0, i * q);
      c.lineTo(S, i * q);
      c.stroke();
    }
  } else if (kind === 'boards') {
    c.fillStyle = '#5a3a24';
    c.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 34) {
      c.fillStyle = `rgba(0,0,0,${0.1 + random() * 0.4})`;
      c.fillRect(x, 0, 34, S);
      c.fillStyle = 'rgba(0,0,0,0.8)';
      c.fillRect(x, 0, 2, S);
    }
  } else {
    c.fillStyle = '#31404a';
    c.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) {
      c.fillStyle = `rgba(${random() < 0.5 ? '0,0,0' : '200,220,235'},${random() * 0.18})`;
      c.fillRect(random() * S, random() * S, 2, 2);
    }
  }
  for (let i = 0; i < 90; i++) {
    const x = random() * S;
    const y = random() * S;
    const r = 8 + random() * 54;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(20,12,4,${random() * 0.34})`);
    g.addColorStop(1, 'rgba(20,12,4,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const under = c.createRadialGradient(S / 2, S * 0.62, 0, S / 2, S * 0.62, S * 0.24);
  under.addColorStop(0, 'rgba(0,0,0,0.42)');
  under.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = under;
  c.fillRect(0, 0, S, S);
  c.globalCompositeOperation = 'multiply';
  const pool = c.createRadialGradient(S / 2, S * 0.66, S * 0.04, S / 2, S * 0.62, S * 0.72);
  pool.addColorStop(0, glow);
  pool.addColorStop(0.46, '#7d6c58');
  pool.addColorStop(1, '#0d0c0b');
  c.fillStyle = pool;
  c.fillRect(0, 0, S, S);
  return canvasOf(canvas);
}

/** The walls of such a room, the same light on them. */
function paintRoomWall(damask: Texture, glow: string): CanvasTexture {
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const c = canvas.getContext('2d')!;
  c.save();
  c.scale(0.3, 0.3);
  c.fillStyle = c.createPattern(damask.image as HTMLCanvasElement, 'repeat')!;
  c.fillRect(0, 0, S / 0.3, S / 0.3);
  c.restore();
  c.globalCompositeOperation = 'multiply';
  const pool = c.createRadialGradient(S / 2, S * 0.7, S * 0.05, S / 2, S * 0.62, S * 0.78);
  pool.addColorStop(0, glow);
  pool.addColorStop(0.5, '#5e5044');
  pool.addColorStop(1, '#090808');
  c.fillStyle = pool;
  c.fillRect(0, 0, S, S);
  return canvasOf(canvas);
}

/** A photograph for an album that has none yet: small rooms of the same house. */
function dreamPicture(c: CanvasRenderingContext2D, x: number, y: number, size: number, seed: number): void {
  c.save();
  c.beginPath();
  c.rect(x, y, size, size);
  c.clip();
  c.translate(x, y);
  c.scale(size / 100, size / 100);
  const ground = c.createRadialGradient(50, 34, 3, 50, 50, 84);
  ground.addColorStop(0, '#6a5a44');
  ground.addColorStop(0.5, '#221c17');
  ground.addColorStop(1, '#050605');
  c.fillStyle = ground;
  c.fillRect(0, 0, 100, 100);
  const kind = seed % 4;
  if (kind === 0) {
    c.fillStyle = '#d8ccb0';
    c.beginPath();
    c.moveTo(22, 66);
    c.lineTo(78, 66);
    c.lineTo(68, 52);
    c.lineTo(32, 52);
    c.fill();
    for (const [hx, hy] of [[28, 38], [50, 30], [72, 38]]) {
      c.fillStyle = '#0a0a0a';
      c.fillRect(hx - 9, hy + 7, 18, 34);
      c.fillStyle = '#b8ab98';
      c.beginPath();
      c.ellipse(hx, hy, 6, 8, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(10,8,6,0.9)';
      c.lineWidth = 0.9;
      for (let i = 0; i < 9; i++) {
        c.beginPath();
        c.moveTo(hx - 6 + i * 1.5, hy - 6);
        c.lineTo(hx - 4 + ((i * 7) % 9), hy + 7);
        c.stroke();
      }
    }
  } else if (kind === 1) {
    c.strokeStyle = 'rgba(214,190,150,0.5)';
    c.lineWidth = 0.7;
    for (const [ax, ay] of [[0, 0], [100, 0], [0, 100], [100, 100]]) {
      c.beginPath();
      c.moveTo(ax, ay);
      c.lineTo(50, 50);
      c.stroke();
    }
    c.fillStyle = '#ffd9a0';
    c.beginPath();
    c.arc(38, 58, 5, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#000';
    c.fillRect(46, 42, 8, 18);
  } else if (kind === 2) {
    c.strokeStyle = '#ff9238';
    c.lineWidth = 2.2;
    c.beginPath();
    for (let a = 0; a < Math.PI * 7; a += 0.08) {
      const r = (a / (Math.PI * 7)) * 34;
      const px = 50 + Math.cos(a) * r;
      const py = 50 + Math.sin(a) * r;
      if (a === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.stroke();
  } else {
    c.fillStyle = '#c8b898';
    c.fillRect(38, 18, 24, 58);
    c.fillStyle = '#040404';
    c.fillRect(42, 38, 16, 62);
    c.fillRect(36, 44, 28, 26);
    c.fillStyle = '#3c2020';
    c.beginPath();
    c.ellipse(50, 38, 5, 2, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

/** Prints and pages on one image: the album's newest first, then what the house has by itself. Returns each cell's rectangle (u, v, du, dv). */
function paintAtlas(pictures: readonly HTMLCanvasElement[]): { map: CanvasTexture; rects: Float32Array } {
  const canvas = document.createElement('canvas');
  const size = ATLAS_CELLS * ATLAS_CELL;
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d')!;
  const random = randomFrom(71);
  const rects = new Float32Array(ATLAS_CELLS * ATLAS_CELLS * 4);
  c.fillStyle = '#000';
  c.fillRect(0, 0, size, size);
  const cell = (i: number, w: number, h: number) => {
    const x = (i % ATLAS_CELLS) * ATLAS_CELL + (ATLAS_CELL - w) / 2;
    const y = Math.floor(i / ATLAS_CELLS) * ATLAS_CELL + (ATLAS_CELL - h) / 2;
    rects.set([x / size, 1 - (y + h) / size, w / size, h / size], i * 4);
    return [x, y] as const;
  };
  for (let i = 0; i < PRINT_CELLS; i++) {
    const [x, y] = cell(i, 164, 196);
    c.fillStyle = '#ddd8ca';
    c.fillRect(x, y, 164, 196);
    if (i < pictures.length) c.drawImage(pictures[i], x + 9, y + 9, 146, 146);
    else dreamPicture(c, x + 9, y + 9, 146, i);
    c.fillStyle = `rgba(90,70,40,${0.08 + random() * 0.14})`;
    c.fillRect(x, y, 164, 196);
  }
  for (let i = PRINT_CELLS; i < ATLAS_CELLS * ATLAS_CELLS; i++) {
    const [x, y] = cell(i, 140, 196);
    c.fillStyle = i % 2 === 0 ? '#d4cdbc' : '#c4bca8';
    c.fillRect(x, y, 140, 196);
    if (i !== PRINT_CELLS) {
      c.fillStyle = 'rgba(20,20,26,0.62)';
      for (let l = 0; l < 22; l++) c.fillRect(x + 14, y + 14 + l * 7.6, (i % 3 === 0 ? 70 : 110) * (0.55 + random() * 0.45), 2.4);
    }
  }
  const map = canvasOf(canvas);
  return { map, rects };
}

const PAPER_VERT = /* glsl */ `
${WARP_GLSL}
attribute vec4 aHome;
attribute vec4 aSpin;
attribute vec4 aCell;
attribute vec4 aKind;
uniform float uRise;
uniform float uClock;
uniform float uGather;
uniform float uClear;
uniform float uCount;
uniform vec3 uEye;
uniform vec3 uCold;
uniform vec3 uWarm;
varying vec2 vAtlas;
varying vec2 vSheet;
varying float vSeed;
varying float vLate;
varying vec3 vLit;

mat3 about(vec3 a, float r) {
  float s = sin(r), c = cos(r), o = 1.0 - c;
  return mat3(
    o * a.x * a.x + c, o * a.x * a.y + a.z * s, o * a.z * a.x - a.y * s,
    o * a.x * a.y - a.z * s, o * a.y * a.y + c, o * a.y * a.z + a.x * s,
    o * a.z * a.x + a.y * s, o * a.y * a.z - a.x * s, o * a.z * a.z + c);
}

void main() {
  vec3 p = aHome.xyz;
  float seed = aKind.x;
  float near = aKind.y;
  float w = aHome.w;
  vec3 local = vec3(position.x * w, position.y * w * aKind.z, 0.0);
  float bend = sin(uClock * (1.1 + seed) + seed * 30.0) * 0.32;
  local.z = bend * local.x * local.x / w;
  mat3 turn;
  if (near > 0.5) {
    // a print that stays with you: it hangs face up and rocks
    float round = uClock * 0.05;
    float c = cos(round), s = sin(round);
    p.xz = vec2(p.x * c + p.z * s, -p.x * s + p.z * c) * mix(2.2, 1.0, uGather);
    p.y += sin(uClock * 0.4 + seed * 20.0) * 0.5;
    turn = about(vec3(0.0, 1.0, 0.0), seed * 6.3 + uClock * 0.08 * (seed - 0.5))
      * about(normalize(vec3(cos(seed * 40.0), 0.0, sin(seed * 40.0))), sin(uClock * 0.55 + seed * 9.0) * 0.5)
      * about(vec3(1.0, 0.0, 0.0), -1.5708);
  } else {
    p.y = mod(p.y + uRise, ${PAPER_RANGE.toFixed(1)}) - ${PAPER_BELOW.toFixed(1)};
    p.x += sin(uClock * (0.7 + seed) + seed * 40.0) * 0.35;
    p.z += cos(uClock * (0.6 + seed * 0.8) + seed * 70.0) * 0.35;
    turn = about(aSpin.xyz, uClock * aSpin.w + seed * 6.28);
    local *= step(seed, uCount);
    // they thin out at the ends of their span, so that none is seen arriving
    local *= smoothstep(0.0, 3.0, p.y + ${PAPER_BELOW.toFixed(1)}) * (1.0 - smoothstep(${(PAPER_RANGE - PAPER_BELOW - 3).toFixed(1)}, ${(PAPER_RANGE - PAPER_BELOW).toFixed(1)}, p.y));
  }
  vec3 rel = p - uEye;
  // at the table they part, so that nothing stands between you and it
  if (uClear > 0.0 && rel.z < 0.0) {
    float r = length(rel.xy);
    if (r < 1.15) rel.xy *= mix(1.0, 1.15 / max(r, 0.001), uClear);
  }
  float d = length(rel);
  if (d < 0.6) rel *= 0.6 / d;
  p = uEye + rel;
  vec3 n = turn * vec3(0.0, 0.0, 1.0);
  float top = abs(n.y);
  float facing = abs(dot(n, normalize(uEye - p)));
  float fall = exp(-length(rel) * 0.17) * mix(1.0, 3.2, near);
  vLit = (uCold * (0.12 + 0.88 * top * top + pow(facing, 18.0) * 3.0) + uWarm * (1.0 - top * 0.72)) * fall;
  vAtlas = aCell.xy + uv * aCell.zw;
  vSheet = uv;
  vSeed = seed;
  vLate = aKind.w;
  vec4 mv = modelViewMatrix * vec4(p + turn * local, 1.0);
  gl_Position = projectionMatrix * dreamWarp(mv);
}
`;

const PAPER_FRAG = /* glsl */ `
uniform sampler2D tAtlas;
uniform float uBurn;
varying vec2 vAtlas;
varying vec2 vSheet;
varying float vSeed;
varying float vLate;
varying vec3 vLit;

float grain(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cloud(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(grain(i), grain(i + vec2(1.0, 0.0)), f.x), mix(grain(i + vec2(0.0, 1.0)), grain(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec3 paper = gl_FrontFacing ? texture2D(tAtlas, vAtlas).rgb : vec3(0.68, 0.66, 0.6);
  vec3 color = paper * vLit;
  if (uBurn > 0.0) {
    // a ragged front eats the sheet from one corner; behind it nothing, on it a line of embers
    float front = uBurn * 2.7 - vLate - cloud(vSheet * 3.5 + vSeed * 19.0) * 0.55 - (vSheet.x + vSheet.y) * 0.28;
    if (front > 0.05) discard;
    color *= 1.0 - smoothstep(-0.2, 0.0, front) * 0.9;
    color += vec3(4.0, 1.2, 0.18) * smoothstep(-0.018, 0.02, front);
  }
  gl_FragColor = vec4(color, 1.0);
}
`;

const RIBBON_VERT = /* glsl */ `
${WARP_GLSL}
attribute vec3 aColor;
attribute vec4 aRibbon;
uniform float uFall;
uniform vec3 uEye;
varying vec3 vColor;
varying float vAlong;
varying float vGain;
void main() {
  vec3 p = position;
  vec2 toEye = normalize(uEye.xz - p.xz + 0.0001);
  p.xz += vec2(-toEye.y, toEye.x) * aRibbon.z * (uv.x - 0.5);
  vAlong = (p.y - uFall) / aRibbon.y + aRibbon.x;
  vGain = aRibbon.w * exp(-abs(p.y) * 0.022) * smoothstep(1.0, 16.0, abs(p.y)) * smoothstep(${RIBBON_BOTTOM.toFixed(1)}, ${(RIBBON_BOTTOM + 24).toFixed(1)}, p.y) * (1.0 - smoothstep(${(RIBBON_TOP - 8).toFixed(1)}, ${RIBBON_TOP.toFixed(1)}, p.y));
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * dreamWarp(mv);
}
`;

const RIBBON_FRAG = /* glsl */ `
uniform float uTail;
uniform float uStrength;
uniform float uWhite;
varying vec3 vColor;
varying float vAlong;
varying float vGain;
void main() {
  float f = fract(vAlong);
  float x = clamp((f - (1.0 - uTail)) / uTail, 0.0, 1.0);
  float a = pow(x, 2.2) * (1.0 - smoothstep(0.93, 1.0, x));
  vec3 c = mix(vColor, vec3(1.0), uWhite);
  gl_FragColor = vec4(c * a * vGain * uStrength, 1.0);
}
`;

/** One storey in the fall. */
interface Slot {
  ring: Group;
  furnished: Group;
  /** Its entry in the shared instance buffers. */
  entry: number;
  matrices: Float32Array;
  colors: Float32Array;
  /** The door and the room's lamp in the ring's frame (m), and its tint. */
  doorX: number;
  doorZ: number;
  lampX: number;
  lampZ: number;
  light: Color;
  shell: Color;
}

/** One of the family: what it takes to turn a head to the eye. */
interface Sitter {
  head: Bone;
  parentInverse: Quaternion;
  /** Takes a head's own axes to where they are wanted. */
  fromHead: Matrix4;
  at: Vector3;
}

interface Beds {
  fall: RoomVoice;
  air: RoomVoice;
  ears: RoomVoice;
  shaft: RoomVoice;
  tube: RoomVoice;
  paper: RoomVoice;
  shepard: RoomVoice;
}

const DOOR_FILES = ['rooms/door_pass_1.mp3', 'rooms/door_pass_2.mp3', 'rooms/door_pass_3.mp3'] as const;
const UP = new Vector3(0, 1, 0);

/**
 * Falling down a vast square shaft, looking past your own shoes. Storeys come up out of the dark, each with one
 * door standing open on its own small lit room; seen from above they wind down the walls like the spiral on
 * the clock's face. Your own pictures fall with you. For two seconds it all but stops, in front of the table,
 * and they turn their faces to watch you go by. Then one floor on fire, then a white point, then nothing.
 */
export default class Shaft extends Room {
  readonly keys: readonly RoomKey[] = cameraKeys();
  readonly air: RoomAir = {
    fog: { color: 0x0a1414, density: FOG_DENSITY },
    env: 'evening',
    envIntensity: 0.05,
    sky: 0,
    grade: { exposure: 1.25, saturation: 0.82, warmth: 0.04, tint: -0.015, flare: 0.003 },
  };
  control: RoomControl = { look: true, scroll: true, hurry: 1.6 };
  fear = 0.35;
  film: RoomFilm = { bloom: 0.9, bloomFrom: 0.62, grain: 0.42, scratches: 0.1, weave: 0.0005, flicker: 0.02, aberration: 0, barrel: 0, ghost: 0, burn: 0 };
  focus = 5.5;
  aperture = 2.2;
  drift = 0.35;

  private readonly fallen: Float32Array;
  private readonly tumble: Float32Array;
  private readonly dinnerRing: number;
  private readonly fireRing: number;
  private readonly lastRing: number;

  private readonly slots: Slot[] = [];
  private readonly shellBuffers: { matrix: InstancedBufferAttribute; color: InstancedBufferAttribute }[] = [];
  private readonly lightMaterials: { material: MeshStandardMaterial; strength: number }[] = [];
  private readonly lookMaterials: MeshBasicMaterial[] = [];
  private printsMaterial: MeshBasicMaterial | null = null;
  private readonly doorLamps: DreamLight[] = [];
  private readonly spirals: MeshStandardMaterial[] = [];
  private readonly clocks: { value: number }[] = [];

  private readonly dinner = new Group();
  private readonly sitters: Sitter[] = [];
  private readonly dinnerSpot: SpotSpec;
  private readonly pendant: DreamLight;
  private readonly burning: DreamLight;
  private readonly fire: Fire;

  private readonly paperUniforms: Record<string, { value: unknown }>;
  private readonly ribbonUniforms: Record<string, { value: unknown }>;
  private readonly floorEnd: Mesh;
  private readonly floorGlow: Mesh;
  private readonly zenith: Mesh;
  private readonly self = new Group();

  private beds: Beds | null = null;
  private rising: RoomVoice | null = null;
  private nextMix = 0;
  private lastPass = 0;
  private readonly eye: RoomPose = { position: new Vector3(), yaw: 0, pitch: 0, roll: 0, fov: 60 };
  private readonly faceTo = new Vector3();
  private readonly sideTo = new Vector3();
  private readonly upTo = new Vector3();
  private readonly turned = new Matrix4();
  private readonly localQ = new Quaternion();

  constructor(ctx: RoomContext) {
    super(ctx);
    const b = this.build;
    const k = this.kit;

    // the whole fall is worked out once: everything seen is read off it, so it can be hurried and scrubbed
    const samples = Math.ceil(SECONDS * TABLE_RATE) + 2;
    this.fallen = new Float32Array(samples);
    this.tumble = new Float32Array(samples);
    for (let i = 1; i < samples; i++) {
      const at = (i - 0.5) / TABLE_RATE;
      const v = speedAt(at) * CALM;
      this.fallen[i] = this.fallen[i - 1] + v / TABLE_RATE;
      this.tumble[i] = this.tumble[i - 1] + (PAPER_STILL + (1 - PAPER_STILL) * clamp(speedAt(at) / V_FULL, 0, 1.4)) / TABLE_RATE;
    }
    const raw = this.fallAt(T_PASS);
    this.dinnerRing = Math.ceil((raw + EYE_AT_TABLE) / STOREY);
    const shift = this.dinnerRing * STOREY - EYE_AT_TABLE - raw;
    for (let i = 0; i < samples; i++) this.fallen[i] += shift;
    this.fireRing = Math.round(this.fallAt(T_FIRE) / STOREY);
    this.lastRing = Math.ceil(this.fallAt(T_END) / STOREY) - 1;

    if (REDUCED_MOTION) this.warp = null;
    else {
      this.warp = [
        { at: 0, bendUp: 0, bendAside: 0, twist: 0.0012, wave: 0 },
        { at: 14 / SECONDS, bendUp: 0, bendAside: 0, twist: 0.0045, wave: 0 },
        { at: T_BRAKE / SECONDS, bendUp: 0, bendAside: 0, twist: 0.007, wave: 0 },
        { at: T_DRIFT / SECONDS, bendUp: 0, bendAside: 0, twist: 0, wave: 0 },
        { at: T_DRIFT_END / SECONDS, bendUp: 0, bendAside: 0, twist: 0, wave: 0 },
        { at: T_BACK / SECONDS, bendUp: 0, bendAside: 0, twist: 0.007, wave: 0 },
        { at: 28 / SECONDS, bendUp: 0, bendAside: 0, twist: 0.012, wave: 0 },
        { at: 1, bendUp: 0, bendAside: 0, twist: 0.03, wave: 0 },
      ];
    }

    // rooms behind the doors: their floors and walls carry the lamp in their own picture
    const looks = {} as Record<LookKey, { floor: MeshBasicMaterial; wall: MeshBasicMaterial }>;
    (Object.keys(LOOKS) as LookKey[]).forEach((key, i) => {
      const look = LOOKS[key];
      const damask = (b.damask(look.paper) as MeshStandardMaterial).map!;
      const floor = new MeshBasicMaterial({ map: paintFloor(look.floor, look.glow, 11 + i) });
      const wall = new MeshBasicMaterial({ map: paintRoomWall(damask, look.glow) });
      looks[key] = { floor, wall };
      this.lookMaterials.push(floor, wall);
    });

    const roomPieces = (s: number) => {
      const back = -W - WALL_T - ROOM_D;
      const mid = -W - WALL_T - ROOM_D / 2;
      return {
        floor: mergeGeometries([
          new PlaneGeometry(ROOM_W, ROOM_D).rotateX(-Math.PI / 2).translate(s, 0, mid),
          new PlaneGeometry(LANDING_W, LANDING).rotateX(-Math.PI / 2).translate(s, 0.012, -W + LANDING / 2),
        ])!,
        walls: mergeGeometries([
          new PlaneGeometry(ROOM_W, ROOM_H).translate(s, ROOM_H / 2, back),
          new PlaneGeometry(ROOM_D, ROOM_H).rotateY(Math.PI / 2).translate(s - ROOM_W / 2, ROOM_H / 2, mid),
          new PlaneGeometry(ROOM_D, ROOM_H).rotateY(-Math.PI / 2).translate(s + ROOM_W / 2, ROOM_H / 2, mid),
          new PlaneGeometry(ROOM_W, ROOM_D).rotateX(Math.PI / 2).translate(s, ROOM_H, mid),
        ])!,
      };
    };

    const atlas = paintAtlas(this.album.pictures.slice(-PRINT_CELLS).reverse().map((p) => p.canvas));
    const printsFloor = this.printsOnAFloor(atlas);

    // the two storeys, every other turned a quarter: together, eight places on the way round
    const damask = b.damask(PALETTE.damaskGreen) as MeshStandardMaterial;
    const wood = b.wood() as MeshStandardMaterial;
    const stone = k.surface('conc_pour_lifts', 2).map;
    const variants = [-1, 1].map((sign, v) => {
      const door: DoorSpec = { s: sign * DOOR.s, w: DOOR.w, h: DOOR.h, leaves: 1, open: LEAF_OPEN };
      const geometry = buildStorey(door);
      const light = bakeLight(door, 201 + v);
      const wallM = this.lit(new MeshStandardMaterial({ map: damask.map, roughness: 0.82, lightMap: light, lightMapIntensity: LIGHT_WALL }), LIGHT_WALL);
      const woodM = this.lit(new MeshStandardMaterial({ map: wood.map, roughness: 0.46, lightMap: light, lightMapIntensity: LIGHT_WOOD }), LIGHT_WOOD);
      const stoneM = this.lit(new MeshStandardMaterial({ map: stone, color: 0x9a978c, roughness: 0.9, lightMap: light, lightMapIntensity: LIGHT_STONE }), LIGHT_STONE);
      const count = SLOTS / 2;
      const matrix = new InstancedBufferAttribute(new Float32Array(count * 16), 16).setUsage(DynamicDrawUsage);
      const color = new InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(DynamicDrawUsage);
      this.shellBuffers.push({ matrix, color });
      for (const [g, m] of [[geometry.wall, wallM], [geometry.wood, woodM], [geometry.stone, stoneM]] as const) {
        const mesh = new InstancedMesh(g, m, count);
        mesh.instanceMatrix = matrix;
        mesh.instanceColor = color;
        mesh.frustumCulled = false;
        this.root.add(mesh);
      }
      return { pieces: roomPieces(sign * DOOR.s), sign };
    });

    const placed = [0, 0];
    const m = new Matrix4();
    const q = new Quaternion();
    const pos = new Vector3();
    const unit = new Vector3(1, 1, 1);
    for (let i = 0; i < SLOTS; i++) {
      const round = i % 8;
      const quarter = -Math.floor(round / 2) * 90 * DEG;
      const v = round % 2;
      const sign = v === 0 ? -1 : 1;
      const floor = FLOORS[i];
      const ring = new Group();
      ring.rotation.y = quarter;
      const pieces = variants[v].pieces;
      ring.add(new Mesh(pieces.floor, looks[floor.look].floor), new Mesh(pieces.walls, looks[floor.look].wall));
      ring.children.forEach((c) => (c.frustumCulled = false));
      const furnished = new Group();
      ring.add(furnished);
      this.root.add(ring);
      this.furnish(floor.what, furnished, sign * DOOR.s, printsFloor);

      const entry = placed[v]++;
      q.setFromAxisAngle(UP, quarter);
      m.compose(pos.set(0, -1e4, 0), q, unit);
      m.toArray(this.shellBuffers[v].matrix.array, entry * 16);
      // where the door and its lamp are, once the storey has been turned
      const cq = Math.cos(quarter);
      const sq = Math.sin(quarter);
      const across = sign * DOOR.s;
      const lampZ = -W + 1.4;
      this.slots.push({
        ring,
        furnished,
        entry,
        matrices: this.shellBuffers[v].matrix.array as Float32Array,
        colors: this.shellBuffers[v].color.array as Float32Array,
        doorX: across * cq + -W * sq,
        doorZ: -across * sq + -W * cq,
        lampX: across * cq + lampZ * sq,
        lampZ: -across * sq + lampZ * cq,
        light: new Color(LOOKS[floor.look].light),
        shell: new Color(LOOKS[floor.look].shell),
      });
    }
    for (let i = 0; i < 4; i++) this.doorLamps.push(this.light([0, -1000, 0], PALETTE.warm, 0, DOOR_REACH));

    this.dinnerSpot = this.spot([0, -1000, 0], [0, -1000, 0], PALETTE.warm, 0, 38, 0.7);
    this.spots = [this.dinnerSpot, null, null];
    this.pendant = this.light([0, -1000, 0], PALETTE.warm, 0, 8);
    this.burning = this.light([0, -1000, 0], 0xff7a28, 0, 46);
    this.layDinner();

    // one floor burns: all four walls, every door
    const w = W - 0.72;
    this.fire = new Fire([
      { from: [-w, 0.2, -w], to: [w, 0.2, -w], height: 7 },
      { from: [w, 0.2, -w], to: [w, 0.2, w], height: 7 },
      { from: [w, 0.2, w], to: [-w, 0.2, w], height: 7 },
      { from: [-w, 0.2, w], to: [-w, 0.2, -w], height: 7 },
    ], { facing: false, seed: 9, heat: 1 });
    this.root.add(this.fire.root);

    const paper = this.makePaper(atlas);
    this.paperUniforms = paper;
    this.ribbonUniforms = this.makeRibbons();

    // the white floor at the end, and the pale square you fell from
    this.floorEnd = new Mesh(new PlaneGeometry(2 * W, 2 * W).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: whiteMap(), color: new Color(5, 5, 4.8) }));
    this.floorEnd.frustumCulled = false;
    this.floorEnd.visible = false;
    this.root.add(this.floorEnd);
    this.floorGlow = b.glow(0, -FAR_DRAWN, 0, 40, 0xf4f4ee, 1, this.root, 1.6);
    this.floorGlow.visible = false;
    this.zenith = b.glow(0, 180, 0, 20, 0x8aa4ae, 0.9, this.root, 2.2);

    // the suit you are wearing: the shoes are what you see of it, and there is nothing above its collar
    const body = b.headless(1, { tint: 0x666c76 });
    body.set(0, 0, 0, 0, 0);
    body.commit();
    const lean = new Group();
    lean.position.set(0, FEET.y, FEET.z);
    lean.rotation.set(SELF_LEAN, Math.PI, 0);
    lean.add(body.root);
    this.self.add(lean);
    this.root.add(this.self);

    this.clocks.push(b.motes(150, { x: [-W + 0.8, W - 0.8], y: [-18, 7], z: [-W + 0.8, W - 0.8] }, this.root, { strength: 0.3 }).time);

    this.beat(0, () => {
      const sound = this.sound;
      this.beds = {
        fall: sound.bed('rooms/fall_wind.mp3', { gain: 0, lowpass: 8000 }),
        air: sound.bed('rooms/air_rush.mp3', { gain: 0 }),
        ears: sound.bed('rooms/wind_in_ears.mp3', { gain: 0 }),
        shaft: sound.bed('rooms/shaft_wind.mp3', { gain: 0 }),
        tube: sound.bed('rooms/wind_high_tube.mp3', { gain: 0 }),
        paper: sound.bed('rooms/paper_flutter.mp3', { gain: 0 }),
        shepard: sound.bed('rooms/shepard_rise.mp3', { gain: 0 }),
      };
      sound.play('rooms/whoosh_fall.mp3', { gain: 0.5 });
    });
    this.beat(6, () => this.say({ tr: 'Hepsi senin.', en: 'All of them yours.' }, 4.2));
    this.beat(T_END - 13.9, () => {
      this.rising = this.sound.play('rooms/rising_tone.mp3', { gain: 0 });
    });
    this.beat(20.15, () => this.sound.play('rooms/fork_plate_3.mp3', { gain: 0.35, reverb: 0.15 }));
    this.beat(T_PASS, () => this.shutter());
    this.beat(22.05, () => this.sound.play('rooms/whoosh_fall.mp3', { gain: 0.42 }));
    this.beat(T_FIRE - 0.62, () => this.sound.play('rooms/fire_roar_by.mp3', { gain: 0.6 }));
    this.beat(T_END, () => {
      this.beds = null;
      this.rising = null;
      this.sound.stopAll(0.05);
      this.sound.play('rooms/stop_thud.mp3', { gain: 0.8 });
    });
  }

  /** Remember a material whose baked light fades as the rings go by too fast to see. */
  private lit(material: MeshStandardMaterial, strength: number): MeshStandardMaterial {
    this.lightMaterials.push({ material, strength });
    return material;
  }

  private fallAt(s: number): number {
    return this.sample(this.fallen, s);
  }

  private sample(table: Float32Array, s: number): number {
    const x = clamp(s, 0, SECONDS) * TABLE_RATE;
    const i = Math.min(Math.floor(x), table.length - 2);
    return table[i] + (table[i + 1] - table[i]) * (x - i);
  }

  /** A hundred and more of your pictures, lying on a floor (one mesh; the album's own image). */
  private printsOnAFloor(atlas: { map: CanvasTexture; rects: Float32Array }): Mesh {
    const random = randomFrom(88);
    const pieces: BufferGeometry[] = [];
    for (let i = 0; i < 110; i++) {
      const g = new PlaneGeometry(0.34, 0.41);
      const uv = g.getAttribute('uv');
      const cell = Math.floor(random() * PRINT_CELLS) * 4;
      for (let v = 0; v < uv.count; v++) uv.setXY(v, atlas.rects[cell] + uv.getX(v) * atlas.rects[cell + 2], atlas.rects[cell + 1] + uv.getY(v) * atlas.rects[cell + 3]);
      g.rotateX(-Math.PI / 2).rotateY(random() * 6.28).translate((random() - 0.5) * 3, 0.02 + i * 0.0004, -W + 0.1 + random() * 2.5);
      pieces.push(g);
    }
    this.printsMaterial = new MeshBasicMaterial({ map: atlas.map, color: new Color(0.82, 0.68, 0.5) });
    const mesh = new Mesh(mergeGeometries(pieces)!, this.printsMaterial);
    mesh.frustumCulled = false;
    return mesh;
  }

  /** What stands behind each door: small, lit, and meant to be seen from above. */
  private furnish(what: Tableau, g: Group, c: number, printsFloor: Mesh): void {
    const k = this.kit;
    const b = this.build;
    // from the landing's outer edge, drawn closer together so that a room's worth fits on it
    const z = (d: number) => -W + LANDING - 0.15 - d * 0.6;
    const chairAt = (x: number, at: number) => {
      const one = k.props('dining_chair', 1);
      one.set(0, x, 0, at, 0, 1);
      one.commit();
      g.add(one.root);
    };
    switch (what) {
      case 'chair': {
        chairAt(c, z(1.5));
        break;
      }
      case 'clock': {
        // lying on its back on the floor, as big as a table, looking up
        const clock = b.clock(c, 0.34, z(1.2), g, 4.4);
        clock.root.rotation.x = -1.2;
        this.spirals.push(clock.spiral);
        break;
      }
      case 'bed': {
        k.prop('bed_gothic', [c, 0, z(2.2)], {}, g);
        break;
      }
      case 'chairs': {
        // a row, and one of them has been turned to the wall
        const row = k.props('dining_chair', 6);
        for (let i = 0; i < 6; i++) row.set(i, c + (i - 2.5) * 0.6, 0, z(2), i === 3 ? Math.PI : 0, 1);
        row.commit();
        g.add(row.root);
        break;
      }
      case 'doll': {
        const doll = k.prop('doll_low', [c, 0, z(1.2)], { scale: 3.3 }, g);
        doll.getObjectByName('head')!.rotation.x = -0.62;
        break;
      }
      case 'dentist': {
        chairAt(c, z(1.6));
        b.glow(c, 3, z(1.6), 2.2, 0xeef6ff, 0.2, g);
        break;
      }
      case 'headless': {
        const man = b.headless(1, { tint: 0x707784 });
        man.set(0, c, 0, z(0.6), 0);
        man.commit();
        g.add(man.root);
        break;
      }
      case 'circle': {
        // a ring of chairs, facing in on nothing
        const ring = k.props('dining_chair', 7);
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          ring.set(i, c + Math.sin(a) * 1.05, 0, z(2) + Math.cos(a) * 0.95, a + Math.PI, 1);
        }
        ring.commit();
        g.add(ring.root);
        break;
      }
      case 'table': {
        const table = k.prop('dining_table', [c, 0, z(1.7)], {}, g);
        table.updateWorldMatrix(true, true);
        const top = new Box3().setFromObject(table).max.y - this.origin.y;
        const plates = k.props('plate', 4);
        const chairs = k.props('dining_chair', 4);
        [[-0.7, 0.42, 0], [0.7, 0.42, 0], [-0.7, -0.42, Math.PI], [0.7, -0.42, Math.PI]].forEach(([x, dz, h], i) => {
          plates.set(i, c + x, top, z(1.7) + dz, 0, 1);
          chairs.set(i, c + x, 0, z(1.7) + dz * 2, h + Math.PI, 1);
        });
        plates.commit();
        chairs.commit();
        g.add(plates.root, chairs.root);
        break;
      }
      case 'neck': {
        const man = b.headless(1, { tint: 0x707784 });
        man.set(0, c, 0, z(0.9), 0);
        man.commit();
        g.add(man.root);
        this.clocks.push(
          b.neck(
            [[c, 1.46, z(0.9)], [c + 0.02, 1.95, z(0.82)], [c + 0.16, 2.7, z(1.3)], [c + 0.1, 3.9, -W + 1.75], [c - 0.5, 5.2, -W + 1.9], [c - 0.92, 6.4, -W + 1.15], [c - 1, 7.1, -W - 0.2], [c - 1, 7.25, -W - 0.8]],
            g,
            { radius: 0.055, sway: 0.07 },
          ).time,
        );
        break;
      }
      case 'veil': {
        const man = k.figures.crowd({ avatar: 'figure_man', clip: 'm_listen_door', time: 1, face: 'scratched', tint: 0x4a4f55, bleach: 0.55 }, 1);
        man.set(0, c + 1.48, 0, z(4.1), Math.PI);
        man.commit();
        g.add(man.root);
        break;
      }
      case 'crowd': {
        const random = randomFrom(5);
        const many = k.figures.crowd({ avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 1.2, face: 'scratched', tint: 0x4a4f55, bleach: 0.55 }, 14);
        const m = new Matrix4();
        const r = new Matrix4();
        const lean = new Matrix4().makeRotationX(-0.44);
        for (let i = 0; i < 14; i++) {
          const x = c + ((i % 5) - 2) * 0.66 + (random() - 0.5) * 0.16;
          const dz = 0.6 + Math.floor(i / 5) * 1.25 + (random() - 0.5) * 0.14;
          m.makeTranslation(x, 0, z(dz)).multiply(r.makeRotationY((random() - 0.5) * 0.4)).multiply(lean);
          many.setMatrix(i, m);
        }
        many.commit();
        g.add(many.root);
        break;
      }
      case 'prints': {
        const floor = printsFloor.clone();
        floor.position.x = c;
        g.add(floor);
        break;
      }
      case 'crouch': {
        const man = k.figures.crowd({ avatar: 'figure_man', clip: 'm_crouch_idle', time: 0.8, face: 'scratched', tint: 0x4a4f55, bleach: 0.55 }, 1);
        man.set(0, c - 1.25, 0, z(3.8), Math.PI * 0.82);
        man.commit();
        g.add(man.root);
        break;
      }
      case 'child': {
        const man = b.headless(1, { tint: 0x707784 });
        man.set(0, c, 0, z(2.6), 0);
        man.commit();
        g.add(man.root);
        break;
      }
    }
  }

  /** The door that matters: a real room, a real lamp, the table, and the three of them. */
  private layDinner(): void {
    const k = this.kit;
    const b = this.build;
    const door: DoorSpec = { s: 0, w: 2.6, h: 3.4, leaves: 2, open: 1.95 };
    const damask = b.damask(PALETTE.damaskGreen) as MeshStandardMaterial;
    const wood = b.wood() as MeshStandardMaterial;
    const light = bakeLight(door, 300);
    const geometry = buildStorey(door);
    const shell: readonly [BufferGeometry, MeshStandardMaterial][] = [
      [geometry.wall, this.lit(new MeshStandardMaterial({ map: damask.map, roughness: 0.82, lightMap: light, lightMapIntensity: LIGHT_WALL }), LIGHT_WALL)],
      [geometry.wood, this.lit(new MeshStandardMaterial({ map: wood.map, roughness: 0.46, lightMap: light, lightMapIntensity: LIGHT_WOOD }), LIGHT_WOOD)],
      [geometry.stone, this.lit(new MeshStandardMaterial({ map: k.surface('conc_pour_lifts', 2).map, color: 0x9a978c, roughness: 0.9, lightMap: light, lightMapIntensity: LIGHT_STONE }), LIGHT_STONE)],
    ];
    const identity = new Matrix4();
    for (const [g, m] of shell) {
      const mesh = new InstancedMesh(g, m, 1);
      mesh.setMatrixAt(0, identity);
      mesh.setColorAt(0, new Color(1, 1, 1));
      mesh.frustumCulled = false;
      this.dinner.add(mesh);
    }

    const room = new Group();
    room.position.z = -W - WALL_T;
    this.dinner.add(room);
    this.root.add(this.dinner);
    b.box(DINNER_W, DINNER_D, ROOM_H, { walls: b.damask(PALETTE.damaskGreen), floor: b.checker(0.5), ceiling: b.ceiling(0.6), skip: ['-z'] }, room);
    b.wainscot(DINNER_W / 2, -DINNER_D / 2, DINNER_D, '-x', room);
    b.wainscot(-DINNER_W / 2, -DINNER_D / 2, DINNER_D, '+x', room);
    b.wainscot(0, -DINNER_D, DINNER_W, '+z', room);

    const tz = -TABLE_AT;
    const set = new Group();
    set.position.z = tz;
    set.scale.setScalar(FAMILY_SCALE);
    room.add(set);
    const table = k.prop('dining_table', [0, 0, 0], { scale: TABLE_SCALE, rotation: [0, 90, 0], castShadow: true }, set);
    this.root.updateWorldMatrix(true, true);
    const top = (new Box3().setFromObject(table).max.y - this.origin.y) / FAMILY_SCALE;

    const sideZ = -0.3;
    const farZ = -TABLE_HALF - 0.2;
    const nearZ = TABLE_HALF + 0.42;
    const chairs = k.props('dining_chair', 4, { castShadow: true });
    chairs.set(0, -SIDE_X - 0.08, 0, sideZ, Math.PI / 2, 1);
    chairs.set(1, SIDE_X + 0.08, 0, sideZ, -Math.PI / 2, 1);
    chairs.set(2, 0, 0, farZ - 0.08, 0, 1);
    // yours: pushed back, a little askew, as you left it
    chairs.set(3, 0.1, 0, nearZ, Math.PI + 0.24, 1);
    chairs.commit();
    set.add(chairs.root);

    this.seat(set, { avatar: 'figure_man', face: 'scratched', bleach: 0.5, tint: 0x6b6b70 }, -SIDE_X, sideZ, Math.PI / 2);
    this.seat(set, { avatar: 'figure_woman', face: 'scratched', bleach: 0.5, tint: 0x4d4a46 }, SIDE_X, sideZ, -Math.PI / 2);
    this.seat(set, { avatar: 'figure_child', face: 'scratched', bleach: 0.6, tint: 0x6a6660 }, 0, farZ, 0);

    // the meal, half eaten, and a place laid for you that was not touched
    const places: readonly [number, number][] = [[-0.34, sideZ], [0.34, sideZ], [0, -0.72], [0, 0.72]];
    const plates = k.props('plate', 4);
    const forks = k.props('fork', 4, { rotation: [90, 0, 0] });
    const knives = k.props('knife', 4, { rotation: [90, 0, 0] });
    places.forEach(([x, z], i) => {
      plates.set(i, x, top, z, 0, 1);
      forks.set(i, x - 0.15, top + 0.002, z, 0.1 * i, 1);
      knives.set(i, x + 0.15, top + 0.002, z, -0.08 * i, 1);
    });
    plates.commit();
    forks.commit();
    knives.commit();
    set.add(plates.root, forks.root, knives.root);
    k.prop('roast_lump', [-0.34, top + 0.014, sideZ], { scale: 1.3 }, set);
    k.prop('roast_lump', [0.34, top + 0.014, sideZ], { scale: 1.1 }, set);
    k.prop('roast_lump', [0, top + 0.014, 0.72], { scale: 1.6 }, set);

    // the lamp over the table: an enamel shade on a cord
    const enamel = new MeshStandardMaterial({ color: 0x1b1a16, roughness: 0.42, metalness: 0.2 });
    const shade = new Mesh(new CylinderGeometry(0.12, 0.44, 0.3, 36), enamel);
    shade.position.set(0, 2.55, tz);
    const cord = new Mesh(new CylinderGeometry(0.008, 0.008, ROOM_H - 2.7, 8), enamel);
    cord.position.set(0, (ROOM_H + 2.7) / 2, tz);
    const bulb = new Mesh(new SphereGeometry(0.075, 18, 12), new MeshBasicMaterial({ map: whiteMap(), color: new Color(9, 6.4, 3.6) }));
    bulb.position.set(0, 2.37, tz);
    room.add(shade, cord, bulb);
    b.glow(0, 2.33, tz, 1.6, PALETTE.warm, 0.18, room, 3.2);

    // the clock on its shelf, off to one side: half past
    const shelf = k.block(0.72, 0.05, 0.26, wood);
    shelf.position.set(3, 1.62, -DINNER_D + 0.14);
    room.add(shelf);
    const clock = b.clock(3, 1.645, -DINNER_D + 0.14, room, 2.4);
    this.spirals.push(clock.spiral);

    this.clocks.push(b.motes(70, { x: [-3, 3], y: [0.1, 3.6], z: [-DINNER_D + 0.2, WALL_T + 2.2] }, room, { strength: 0.42 }).time);
  }

  /** One of the family, sat down; the head is written by hand afterwards. */
  private seat(set: Group, look: Omit<FigureSpec, 'clip' | 'time'>, x: number, z: number, heading: number): void {
    const hero = this.kit.figures.hero({ ...look, clip: 'm_sit_chair_idle_roll_head', time: SIT_POSE });
    hero.update(SIT_POSE);
    hero.root.updateMatrixWorld(true);
    const hips = hero.bone('Bip01')!.getWorldPosition(new Vector3());
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    hero.root.rotation.y = heading;
    hero.root.position.set(x - (hips.x * c + hips.z * s), HIPS_Y - hips.y, z - (-hips.x * s + hips.z * c));
    hero.root.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = true;
    });
    set.add(hero.root);
    hero.root.updateWorldMatrix(true, true);
    const head = hero.bone('Bip01_Head')!;
    head.updateWorldMatrix(true, true);
    const rest = head.getWorldQuaternion(new Quaternion());
    const parentInverse = head.parent!.getWorldQuaternion(new Quaternion()).invert();
    // in this skeleton X runs up through the skull; the face is whichever of the others is not the ear to ear
    const forward = new Vector3(s, 0, c);
    const lateral = new Vector3().crossVectors(UP, forward);
    const one = new Vector3(0, 1, 0).applyQuaternion(rest);
    const two = new Vector3(0, 0, 1).applyQuaternion(rest);
    const face = Math.abs(one.dot(lateral)) > Math.abs(two.dot(lateral)) ? two : one;
    if (face.dot(new Vector3().copy(forward).addScaledVector(UP, -0.3)) < 0) face.negate();
    const toLocal = rest.clone().invert();
    const localFace = face.clone().applyQuaternion(toLocal);
    const skull = new Vector3(1, 0, 0);
    if (skull.clone().applyQuaternion(rest).y < 0) skull.negate();
    const localSide = new Vector3().crossVectors(skull, localFace);
    const fromHead = new Matrix4().makeBasis(skull, localFace, localSide).transpose();
    const at = head.getWorldPosition(new Vector3()).sub(this.origin);
    at.y -= this.dinner.position.y;
    this.sitters.push({ head, parentInverse, fromHead, at });
  }

  /** Thousands of sheets of ordinary paper, and among them, staying with you, your prints. */
  private makePaper(atlas: { map: CanvasTexture; rects: Float32Array }): Record<string, { value: unknown }> {
    const random = randomFrom(404);
    const total = SHEETS + PRINTS_NEAR;
    const home = new Float32Array(total * 4);
    const spin = new Float32Array(total * 4);
    const cell = new Float32Array(total * 4);
    const kind = new Float32Array(total * 4);
    const half = W - 1;
    for (let i = 0; i < total; i++) {
      const j = i * 4;
      const seed = random();
      kind[j] = seed;
      kind[j + 3] = random() * 1.5;
      let which: number;
      if (i < PRINTS_NEAR) {
        // a ring of them around you, a little below, clear of the way down
        const a = (i / PRINTS_NEAR) * Math.PI * 2 + random() * 0.4;
        const r = 2.1 + random() * 2.2;
        home.set([Math.cos(a) * r, -2.6 - random() * 3.2, Math.sin(a) * r, 0.5 + random() * 0.26], j);
        which = i % PRINT_CELLS;
        kind[j + 1] = 1;
      } else {
        // none down the middle: that is where you are looking
        let x: number;
        let z: number;
        do {
          x = (random() * 2 - 1) * half;
          z = (random() * 2 - 1) * half;
        } while (x * x + z * z < PAPER_CLEAR * PAPER_CLEAR);
        const printed = random() < 0.1;
        let h = random() * PAPER_RANGE;
        let size = printed ? 0.3 : random() < 0.3 ? 0.2 + random() * 0.08 : 0.08 + random() * 0.06;
        if (i >= total - SHEETS_AT_TABLE) {
          x = (random() * 2 - 1) * 1.9;
          z = -W + 0.4 + random() * 1.3;
          h = (((random() * 2.6 - 1.3 + PAPER_BELOW - this.fallAt(T_PASS) * PAPER_SLIP) % PAPER_RANGE) + PAPER_RANGE) % PAPER_RANGE;
          size = 0.21 + random() * 0.08;
          kind[j] = random() * 0.1;
        }
        home.set([x, h, z, size], j);
        which = printed ? Math.floor(random() * PRINT_CELLS) : PRINT_CELLS + Math.floor(random() * (ATLAS_CELLS * ATLAS_CELLS - PRINT_CELLS));
        const axis = new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
        spin.set([axis.x, axis.y, axis.z, 0.5 + random() * 1.9], j);
      }
      cell.set(atlas.rects.subarray(which * 4, which * 4 + 4), j);
      kind[j + 2] = atlas.rects[which * 4 + 3] / atlas.rects[which * 4 + 2];
    }
    const base = new PlaneGeometry(1, 1, 4, 1);
    const geometry = new InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute('position', base.getAttribute('position'));
    geometry.setAttribute('uv', base.getAttribute('uv'));
    geometry.setAttribute('aHome', new InstancedBufferAttribute(home, 4));
    geometry.setAttribute('aSpin', new InstancedBufferAttribute(spin, 4));
    geometry.setAttribute('aCell', new InstancedBufferAttribute(cell, 4));
    geometry.setAttribute('aKind', new InstancedBufferAttribute(kind, 4));
    geometry.instanceCount = total;
    const uniforms = {
      ...warpUniforms,
      tAtlas: { value: atlas.map },
      uRise: { value: 0 },
      uClock: { value: 0 },
      uGather: { value: 0 },
      uClear: { value: 0 },
      uCount: { value: 0.12 },
      uBurn: { value: 0 },
      uEye: { value: new Vector3() },
      uCold: { value: new Color(0.2, 0.25, 0.26) },
      uWarm: { value: new Color(0.1, 0.055, 0.03) },
    };
    const mesh = new Mesh(geometry, new ShaderMaterial({ vertexShader: PAPER_VERT, fragmentShader: PAPER_FRAG, uniforms, side: DoubleSide }));
    mesh.frustumCulled = false;
    this.root.add(mesh);
    return uniforms;
  }

  /** Light drawn out into lines as you pass it. */
  private makeRibbons(): Record<string, { value: unknown }> {
    const random = randomFrom(910);
    const palette = RIBBON_TONES.map((h) => new Color(h));
    const pale = new Color(0xc8d0c8);
    const step = 6;
    const rows = Math.ceil((RIBBON_TOP - RIBBON_BOTTOM) / step);
    const total = RIBBONS_WALL + RIBBONS_AIR;
    const position: number[] = [];
    const uv: number[] = [];
    const color: number[] = [];
    const ribbon: number[] = [];
    const index: number[] = [];
    for (let i = 0; i < total; i++) {
      let x: number;
      let z: number;
      let c: Color;
      let width: number;
      let gain: number;
      let period: number;
      if (i < RIBBONS_WALL) {
        const round = (i / RIBBONS_WALL) * 4 + random() * 0.04;
        const wall = Math.floor(round) % 4;
        const along = (round % 1) * 2 - 1;
        [x, z] = placeOnWall(wall, along * (W - 0.5), 0.86 + random() * 0.3);
        c = palette[Math.floor(random() * palette.length)];
        width = 0.02 + random() * 0.05;
        gain = 0.6 + random() * 1.1;
        period = 14 + random() * 26;
      } else {
        const a = random() * Math.PI * 2;
        const r = 0.9 + random() * (W - 2);
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        c = pale;
        width = 0.006 + random() * 0.01;
        gain = 0.45 + random() * 0.5;
        period = 7 + random() * 12;
      }
      const phase = random();
      const base = position.length / 3;
      for (let j = 0; j <= rows; j++) {
        const y = RIBBON_TOP - j * step;
        position.push(x, y, z, x, y, z);
        uv.push(0, 0, 1, 0);
        color.push(c.r, c.g, c.b, c.r, c.g, c.b);
        ribbon.push(phase, period, width, gain, phase, period, width, gain);
        if (j < rows) {
          const a = base + j * 2;
          index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geometry.setAttribute('aColor', new Float32BufferAttribute(color, 3));
    geometry.setAttribute('aRibbon', new Float32BufferAttribute(ribbon, 4));
    geometry.setIndex(index);
    const uniforms = { ...warpUniforms, uFall: { value: 0 }, uTail: { value: 0.03 }, uStrength: { value: 0 }, uWhite: { value: 0 }, uEye: { value: new Vector3() } };
    const mesh = new Mesh(geometry, new ShaderMaterial({ vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG, uniforms, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    this.root.add(mesh);
    return uniforms;
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const fall = this.fallAt(s);
    const v = speedAt(s) * CALM;
    const brake = brakeAt(s);
    const stream = smootherstep(range(20, 42, v));
    const smear = smootherstep(range(50, 92, v));
    const held = brake > 0.5;
    this.control.scroll = !held;
    const pose = this.pose(frame.t, this.eye);
    const ex = pose.position.x - this.origin.x;
    const ey = pose.position.y - this.origin.y;
    const ez = pose.position.z - this.origin.z;

    const dim = 1 - 0.5 * stream - 0.42 * smear;
    this.placeStoreys(fall, dim, brake);

    // baked light and lit rooms go together, thinning as the storeys go by too fast to see
    for (let i = 0; i < this.lightMaterials.length; i++) this.lightMaterials[i].material.lightMapIntensity = this.lightMaterials[i].strength * (0.32 + 0.68 * dim);
    for (let i = 0; i < this.lookMaterials.length; i++) this.lookMaterials[i].color.setScalar(dim * 1.7);
    this.printsMaterial?.color.setRGB(0.82 * dim, 0.68 * dim, 0.5 * dim);
    for (let i = 0; i < this.spirals.length; i++) this.spirals[i].emissiveIntensity = 3.5 + 1.2 * frame.heartbeat;
    for (let i = 0; i < this.clocks.length; i++) this.clocks[i].value = frame.time;

    this.self.position.set(ex, ey, ez);
    this.self.rotation.y = pose.yaw;
    this.self.rotation.z = Math.sin(s * 0.7) * 0.03 * (REDUCED_MOTION ? 0 : 1);

    this.placeDinner(fall, s, brake, ex, ey, ez);
    const burst = this.placeFire(fall, s);
    this.placeEnds(fall, s);
    this.feedPaper(fall, s, stream, smear, brake, burst, ex, ey, ez);
    this.feedFilm(s, v, stream, smear, brake, burst);
    this.mix(s, v, brake, burst);
    this.passDoors(fall, v, pose.yaw, s);

    this.black = s >= T_END ? 1 : 1 - range(0, 0.35, s);
  }

  /** Every storey in its place, its light, and its lamp if it is near. */
  private placeStoreys(fall: number, dim: number, brake: number): void {
    const first = Math.floor(fall / STOREY) - ABOVE;
    for (let n = 0; n < SLOTS; n++) {
      const k = first + n;
      const i = ((k % SLOTS) + SLOTS) % SLOTS;
      const slot = this.slots[i];
      const y = fall - k * STOREY;
      const depth = -y;
      const there = k !== this.dinnerRing && k <= this.lastRing;
      const fade = there ? (1 - smootherstep(range(2, 17, y))) * (1 - smootherstep(range(50, 64, depth))) : 0;
      const drawn = there && depth < 66;
      slot.ring.visible = drawn && depth > -10;
      slot.ring.position.y = y;
      slot.furnished.visible = depth > -7 && depth < FURNISHED_TO && brake < 0.2;
      slot.matrices[slot.entry * 16 + 13] = drawn ? y : -1e4;
      slot.colors[slot.entry * 3] = slot.shell.r * fade;
      slot.colors[slot.entry * 3 + 1] = slot.shell.g * fade;
      slot.colors[slot.entry * 3 + 2] = slot.shell.b * fade;
      if (depth >= -5 && depth < 15) {
        const lamp = this.doorLamps[((k % 4) + 4) % 4];
        lamp.position.set(this.origin.x + slot.lampX, this.origin.y + y + 3.1, this.origin.z + slot.lampZ);
        lamp.color.copy(slot.light);
        lamp.intensity = there ? DOOR_LAMP * smootherstep(range(1, 8, depth)) * (1 - smootherstep(range(10, 15, depth))) * (1 - brake) * dim : 0;
      }
    }
    for (let b = 0; b < this.shellBuffers.length; b++) {
      this.shellBuffers[b].matrix.needsUpdate = true;
      this.shellBuffers[b].color.needsUpdate = true;
    }
  }

  /** The dinner's storey comes up, and three heads follow the eye. */
  private placeDinner(fall: number, s: number, brake: number, ex: number, ey: number, ez: number): void {
    const y = fall - this.dinnerRing * STOREY;
    const near = Math.abs(y) < 70;
    this.dinner.visible = near;
    this.dinner.position.y = y;
    const here = near && Math.abs(y) < 40 ? 1 : 0;
    const spotOn = here * (0.25 + 0.75 * brake);
    const position = this.dinnerSpot.position as unknown as number[];
    const target = this.dinnerSpot.target as unknown as number[];
    const tableZ = -W - WALL_T - TABLE_AT;
    position[0] = this.origin.x;
    position[1] = this.origin.y + y + 2.36;
    position[2] = this.origin.z + tableZ;
    target[0] = this.origin.x;
    target[1] = this.origin.y + y;
    target[2] = this.origin.z + tableZ;
    this.dinnerSpot.intensity = PENDANT * spotOn;
    this.movingShadows = here > 0 && s > T_BRAKE - 1 && s < T_BACK + 1;
    this.pendant.position.set(this.origin.x, this.origin.y + y + 2.3, this.origin.z + tableZ);
    this.pendant.intensity = 2.8 * spotOn;
    this.focus = lerp(5.5, Math.max(1, ez - tableZ), brake);
    this.aperture = lerp(2.2, 5, brake);
    if (brake <= 0.01) return;
    // they watch where you were an instant ago: level, straight into the lens, stiller than a neck can be
    const late = this.fallAt(s - HEADS_LAG) - this.dinnerRing * STOREY;
    for (let i = 0; i < this.sitters.length; i++) {
      const sitter = this.sitters[i];
      this.faceTo.set(ex - sitter.at.x, ey - (late + sitter.at.y), ez - sitter.at.z).normalize();
      this.sideTo.crossVectors(UP, this.faceTo).normalize();
      this.upTo.crossVectors(this.faceTo, this.sideTo);
      this.turned.makeBasis(this.upTo, this.faceTo, this.sideTo).multiply(sitter.fromHead);
      this.localQ.setFromRotationMatrix(this.turned);
      sitter.head.quaternion.copy(sitter.parentInverse).multiply(this.localQ);
    }
  }

  /** The floor on fire. Returns how strongly it is upon you right now (0..1). */
  private placeFire(fall: number, s: number): number {
    const y = fall - this.fireRing * STOREY;
    const near = Math.abs(y) < 95;
    this.fire.root.visible = near;
    this.fire.root.position.y = y;
    const burn = near ? this.fire.update(s) : 0;
    this.burning.position.set(this.origin.x, this.origin.y + y + 3, this.origin.z);
    this.burning.intensity = near ? FIRE_LIGHT * burn * (0.18 + 0.82 * smootherstep(range(4, 14, Math.abs(y + 3)))) : 0;
    const closeness = Math.exp(-((y + 3) * (y + 3)) / 60);
    return near ? closeness * closeness : 0;
  }

  /** The white floor below, the pale square above. */
  private placeEnds(fall: number, s: number): void {
    const to = this.fallAt(T_END) - fall;
    const shown = s > 25.6 && s < T_END;
    this.floorEnd.visible = shown;
    this.floorGlow.visible = shown;
    if (shown) {
      const drawnAt = Math.min(to, FAR_DRAWN);
      const scale = to > FAR_DRAWN ? FAR_DRAWN / to : 1;
      this.floorEnd.position.y = -drawnAt;
      this.floorEnd.scale.set(scale, 1, scale);
      this.floorGlow.position.y = -drawnAt + 0.05;
      const size = (2 * W * 3.4 * Math.min(drawnAt, 150)) / Math.max(1, to) + 8;
      this.floorGlow.scale.set(size, size, 1);
      ((this.floorGlow.material as ShaderMaterial).uniforms.uColor.value as Color).setScalar(0.45 + 0.75 * range(25.6, 31.4, s));
    }
    const away = ZENITH_START + fall;
    const seen = (2 * W * 180) / away;
    this.zenith.scale.set(seen * 1.8, seen * 1.8, 1);
  }

  /** What falls with you, and the streaming air. */
  private feedPaper(fall: number, s: number, stream: number, smear: number, brake: number, burst: number, ex: number, ey: number, ez: number): void {
    const paper = this.paperUniforms;
    const clock = this.sample(this.tumble, s);
    paper.uRise.value = fall * PAPER_SLIP;
    paper.uClock.value = clock;
    paper.uGather.value = smootherstep(range(2.5, 7, s));
    paper.uClear.value = brake;
    paper.uCount.value = 0.12 + 0.6 * smootherstep(range(1, 16, s));
    paper.uBurn.value = smootherstep(range(25.15, 30.4, s));
    (paper.uEye.value as Vector3).set(ex, ey, ez);
    const warm = paper.uWarm.value as Color;
    warm.setRGB(0.1 + PAPER_FIRE[0] * burst + 0.6 * brake, 0.055 + PAPER_FIRE[1] * burst + 0.32 * brake, 0.03 + PAPER_FIRE[2] * burst + 0.14 * brake);
    const cold = paper.uCold.value as Color;
    const toWhite = smootherstep(range(28, 31.4, s));
    cold.setRGB(0.2 + 1.2 * toWhite, 0.25 + 1.1 * toWhite, 0.26 + 1.1 * toWhite);
    const air = this.ribbonUniforms;
    air.uFall.value = fall;
    air.uTail.value = lerp(0.03, 0.88, stream);
    air.uStrength.value = (0.08 + 1.05 * stream + 0.9 * smear) * (1 - brake);
    air.uWhite.value = 0.7 * smootherstep(range(28, 31.4, s));
    (air.uEye.value as Vector3).set(ex, ey, ez);
  }

  /** Lens, film, fog, how the eye rides, the heart. */
  private feedFilm(s: number, v: number, stream: number, smear: number, brake: number, burst: number): void {
    const motion = REDUCED_MOTION ? 0 : 1;
    this.film.ghost = motion * (0.26 * stream + 0.24 * smear) * (1 - brake);
    this.film.aberration = motion * (0.0012 + 0.006 * stream + 0.007 * smear);
    this.film.barrel = motion * (0.04 * stream + 0.1 * smear);
    this.film.weave = 0.0004 + 0.0014 * stream * motion;
    this.film.bloom = lerp(0.9 + 0.5 * smear + 0.8 * burst, 0.42, brake);
    this.film.burn = Math.max(0, burst - 0.35) * (REDUCED_MOTION ? 0.05 : 0.17);
    this.drift = lerp(0.35, 0.16, brake);
    this.fear = lerp(0.32 + 0.56 * clamp(v / V_FULL, 0, 1.2), 0, brake);
    const toWhite = smootherstep(range(28.2, 31.4, s));
    const r = lerp(FOG_DARK[0], FOG_PALE[0], toWhite);
    const g = lerp(FOG_DARK[1], FOG_PALE[1], toWhite);
    const b = lerp(FOG_DARK[2], FOG_PALE[2], toWhite);
    this.air.fog.color = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
    const grade = this.air.grade;
    grade.exposure = 1.25 + 0.5 * burst + 0.12 * stream;
    grade.saturation = 0.82 + 0.34 * stream * (1 - brake);
    grade.warmth = 0.04 + 0.34 * burst + brake * 0.05;
  }

  /** Beds follow the speed; at the table every one of them is at nothing. Written a few times a second. */
  private mix(s: number, v: number, brake: number, burst: number): void {
    if (!this.beds || (s < this.nextMix && s > this.nextMix - 1)) return;
    this.nextMix = s + 0.2;
    const rush = clamp(v / V_FULL, 0, 1.3);
    const before = range(24.1, 24.45, s) * (1 - range(24.5, 24.7, s));
    const open = (1 - brake) * (1 - brake) * (s > T_CUT ? 0 : 1) * (1 - 0.55 * before) * (1 - 0.4 * burst);
    const beds = this.beds;
    beds.fall.gain(0.12 * (0.15 + 0.85 * rush) * open, 0.3);
    beds.fall.rate(0.7 + 0.42 * rush * (1 - 0.5 * brake), 0.5);
    beds.air.gain(0.1 * rush * open, 0.3);
    beds.ears.gain(0.25 * (0.3 + 0.7 * rush) * open, 0.3);
    beds.shaft.gain(0.22 * (1 - 0.72 * Math.min(1, rush)) * open, 0.4);
    beds.tube.gain(0.14 * (1 - 0.5 * Math.min(1, rush)) * open, 0.4);
    beds.paper.gain(0.14 * open, 0.4);
    beds.shepard.gain(0.1 * clamp(s / 14, 0.3, 1) * open, 0.5);
    beds.shepard.rate(lerp(1, 0.32, brake), 0.3);
    this.rising?.gain(0.3 * open, 0.3);
  }

  /** A door going by, heard, while there is still time to hear one. */
  private passDoors(fall: number, v: number, yaw: number, s: number): void {
    const here = Math.floor((fall + 2) / STOREY);
    if (here === this.lastPass) return;
    const down = here > this.lastPass;
    this.lastPass = here;
    if (!down || s > T_BRAKE - 1 || v > 36) return;
    const every = v < 12 ? 1 : v < 22 ? 2 : 3;
    if (here % every !== 0) return;
    const slot = this.slots[((here % SLOTS) + SLOTS) % SLOTS];
    const c = Math.cos(yaw);
    const n = Math.sin(yaw);
    const pan = clamp((slot.doorX * c - slot.doorZ * n) / W, -0.85, 0.85);
    this.sound.play(DOOR_FILES[v < 12 ? 0 : v < 24 ? 1 : 2], { gain: 0.3 + 0.1 * Math.min(1, v / 24), pan });
  }
}
