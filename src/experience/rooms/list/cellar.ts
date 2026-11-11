import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderMaterial,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { SpotSpec } from '../../../config/nightmare.config';
import { meterUVs } from '../../dream/DreamKit';
import type { DreamLight } from '../../dream/LightPool';
import { DEG, lerp, range, smootherstep, wobble } from '../../math';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['lightbulb'],
  materials: ['plaster_damaged', 'conc_cracked', 'wood_stair', 'wood_dark_paint', 'wood_raw_boards', 'wood_floor_dark'],
  sounds: [
    'rooms/bulb_hum.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/hall_silence.mp3',
    'rooms/cutlery_far.mp3',
    'rooms/stair_creak_1.mp3',
    'rooms/stair_creak_5.mp3',
    'rooms/floor_step_near_1.mp3',
    'rooms/floor_step_near_3.mp3',
    'rooms/plate_set_2.mp3',
    'rooms/plate_clink_2.mp3',
    'rooms/plate_clink_4.mp3',
    'rooms/tooth_clink.mp3',
  ],
};

type V3 = readonly [number, number, number];
type Profile = readonly (readonly [number, number])[];

/** The cellar (m): the landing's height over the floor, the planks of the ceiling, the wall on the left, the wall behind you, how far and how wide it runs into the dark (it is never seen to end). */
const TOP = 2.5;
const CEIL = 5.2;
const WALL_X = -0.6;
const BACK_Z = 1.3;
const DEEP = 44;
const WIDE = 40;
/** The joists under the house's floor (m): depth, width, spacing. */
const JOIST_H = 0.22;
const JOIST_W = 0.11;
const JOIST_GAP = 0.6;
/** The stair (m): risers from the landing to the floor, the going of a tread, its two sides, a tread's thickness and depth (nosing included), a string's depth across its slope. */
const RISERS = 11;
const GOING = 0.24;
const STAIR_L = -0.55;
const STAIR_R = 0.45;
const TREAD_T = 0.042;
const TREAD_D = 0.27;
const STRING_D = 0.26;
/** How dark the back of a tread is against its worn front edge (0..1). */
const TREAD_BACK = 0.45;
const RISE = TOP / RISERS;
const SLOPE = RISE / GOING;
/** The landing (m): its right edge; the door behind you, its middle and size. */
const LANDING_R = 0.75;
const DOOR_X = 0.1;
const DOOR_W = 0.82;
const DOOR_H = 2;
/** The iron rail on the wall (m): off the wall, over the treads, radius. */
const RAIL_OFF = 0.07;
const RAIL_UP = 0.9;
const RAIL_R = 0.019;

/** The eye: seconds, x, y, z (m), yaw, pitch (deg), fov. Two slow steps down, each tread taking the weight, then the eye goes to the column. */
const SHOT: readonly (readonly [number, number, number, number, number, number, number])[] = [
  [0, 0.32, 4.06, 0.35, -8, -41, 52],
  [0.9, 0.32, 4.055, 0.34, -8.5, -41.5, 52],
  [1.9, 0.32, 3.815, 0.02, -10.5, -43, 48],
  [2.6, 0.32, 3.835, -0.08, -11.5, -43.5, 45],
  [3.3, 0.32, 3.83, -0.1, -12.5, -44, 43],
  [4.2, 0.32, 3.588, -0.28, -14.5, -45.5, 38],
  [4.9, 0.32, 3.608, -0.34, -15.5, -46, 35],
  [7, 0.32, 3.6, -0.36, -16.5, -46.3, 27],
  [9.5, 0.32, 3.598, -0.365, -17, -46.5, 21],
  [16, 0.32, 3.596, -0.37, -17.2, -46.6, 19],
];
/** The lens: seconds and distance in focus (m); how shallow. */
const FOCUS: readonly (readonly [number, number])[] = [[0, 4.9], [4.9, 3.7], [8, 3.38], [16, 3.35]];
const APERTURE = 2.4;

/** The bulb halfway down (m), its light (cd, half angle deg, softness of the edge, color), what it spills all round (cd, m), the air it lights (strength). */
const BULB: V3 = [-0.15, 3.15, -1.45];
const KEY_AIM: V3 = [0.2, 0, -3];
const KEY_POWER = 70;
const KEY_ANGLE = 24;
const KEY_PENUMBRA = 0.7;
const KEY_COLOR = 0xffd6a8;
const SPILL = 9;
const SPILL_REACH = 7;
const BEAM = 0.11;
/** The filament's glow (times white), the halo round it (m, strength). */
const GLOW = 7;
const HALO = 0.75;
const HALO_GAIN = 0.5;
/** What the lit floor gives back up to the undersides (cd, m). */
const BOUNCE_AT: V3 = [0.4, 0.35, -2.9];
const BOUNCE = 1.1;
const BOUNCE_REACH = 4;
/** A breath of teal far in the forest, so that the dark still has shapes in it (cd, m). */
const TEAL_AT: V3 = [4, 4.4, -9];
const TEAL = 9;
const TEAL_REACH = 20;
const TEAL_COLOR = 0x2b5c58;
/** How much the bulb wavers on its own (0..1), and how it sags when the hand comes (s, depth, length s). */
const WAVER = 0.05;
const SAG_AT = 6.8;
const SAG = 0.16;
const SAG_LONG = 1.1;
/** The eye adjusting to the dark: exposure at first, and once it has (by this second). */
const EXPOSURE_START = 0.62;
const EXPOSURE = 1.3;
const ADJUSTED = 4.5;

/** The night (fog). */
const FOG_COLOR = 0x05080a;
const FOG_DENSITY = 0.065;

/** A plate (m): its radius; how far one plate sits above the next in a stack. */
const PLATE_R = 0.114;
const PITCH = 0.013;
/** One plate in section (m from its foot): the foot ring and the underside out to the rim, the rim's rounded edge, the top back in over the well. */
const PLATE_FOOT: Profile = [[0, 0.002], [0.056, 0.002], [0.058, 0], [0.066, 0], [0.077, 0.0042], [0.096, 0.0105], [0.108, 0.0155]];
const PLATE_RIM: Profile = [[0.1135, 0.017], [0.1142, 0.0188], [0.1124, 0.0204]];
const PLATE_FACE: Profile = [[0.104, 0.0196], [0.09, 0.0166], [0.079, 0.0106], [0.072, 0.0079], [0.04, 0.0075], [0, 0.0075]];
/** Between one rim and the next in a stack (m above a plate's foot): the dark gap, and the underside of the plate above. */
const PLATE_GAP: Profile = [[0.1056, 0.0232], [0.1098, 0.0272]];
/** A far column is a plain drum this wide (m), painted with its rims. */
const DRUM_R = 0.1105;
/** The painted rims: plates in one turn of the picture, its pixels a plate, how often it goes round a column. */
const TEX_PLATES = 128;
const ROW_PX = 16;
const U_REPEAT = 2;
/** The floor's grime climbs this high up a column (m). */
const FOOT_GRIME = 0.3;

/** The forest (m): grid, jitter, how far it reaches right and into the dark, the clearing round the pool of light (center, radius). */
const GRID = 1.12;
const JITTER = 0.36;
const FOREST_WIDE = 17;
const FOREST_DEEP = 27;
const POOL: readonly [number, number] = [0.25, -2.95];
const CLEARING = 1.35;
/** No column stands in her way: how far back along it, and how wide on either side (m). */
const ARM_CLEAR: readonly [number, number] = [3, 0.75];
/** Heights of the columns (m): near the stair and far off, and how much a column differs from that. */
const NEAR_HEIGHT = 1.05;
const FAR_HEIGHT = 2.05;
const HEIGHT_SPREAD = 0.35;
/** Columns nearer the eye's last place than this (m) have real rims. */
const NEAR_DETAIL = 4;
/** Segments round a column: the nearest, the near, the far; and round a far top. */
const RADIAL_HERO = 44;
const RADIAL_NEAR = 24;
const RADIAL_FAR = 14;
const RADIAL_TOP = 12;
/** How many plates at the top of a column are cut in for real: hers, the near ones, the far ones; and how unevenly they are stacked (m). */
const RIMS_HERO = 16;
const RIMS_NEAR = 10;
const RIMS_FAR = 1;
const WANDER = 0.0024;
/** The column she keeps now (m, plates). */
const HERO_X = 1.05;
const HERO_Z = -2.65;
const HERO_PLATES = 92;

/** The hand (s): out of the dark, at the column, set down, lets go, gone. */
const HAND_IN = 7;
const HAND_ARRIVES = 8.6;
const HAND_SET = 9;
const HAND_OUT = 11;
const HAND_GONE = 12.6;
/** How far off in the dark it starts and ends (m), how high it carries the plate above where it sets it down (m). */
const APPROACH = 0.95;
const CARRY_LIFT = 0.055;
const WITHDRAW = 1.05;
/** Which way the arm comes from: turned from the line of the eye (deg); how the hand slopes to the fingers (deg). */
const ARM_TURN = 65;
const HAND_TILT = 13;
/** Where her fingertips come to rest on the rim (m from the plate's middle), and how far above its glaze (m). */
const TIP_R = 0.103;
const TIP_LIFT = 0.0018;
/** Her skin and her sleeve (sRGB). */
const SKIN: V3 = [0.87, 0.75, 0.69];
const WOOL: V3 = [0.1, 0.088, 0.078];
/** Where the rice and the beans lie on the plate (x, z m from its middle): the beans on the side away from her hand. */
const RICE_AT: readonly [number, number] = [0.026, 0.02];
const SAUCE_AT: readonly [number, number] = [-0.03, -0.012];

/** The steam (m, strength): ribbons, how tall, how bright. */
const STEAM_RIBBONS = 7;
const STEAM_TALL: readonly [number, number] = [0.2, 0.34];
const STEAM = 0.26;
/** How far the steam trails behind the plate while it is carried (m of lean per m it moved in the last tenth of a second). */
const STEAM_LEAN = 1.2;

/** The shutter and the cut (s). */
const SHUTTER_AT = 11;
const CUT_AT = 15.5;
/** Sounds (s): the two treads, the hush before the hand, the room's air coming back. */
const STEP_1 = 1.75;
const STEP_2 = 3.98;
const HUSH = 5.6;
const AFTER = 13.6;
/** Gains of the beds, and where the column is heard (pan). */
const HUM_GAIN = 0.09;
const AIR_GAIN = 0.28;
const DRONE_GAIN = 0.1;
const HOUSE_GAIN = 0.07;
const COLUMN_PAN = 0.3;

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash3 = (x: number, y: number, z: number): number => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Smooth value noise in 3D (0..1). */
function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const at = (a: number, b: number, c: number) => hash3(ix + a, iy + b, iz + c);
  const x00 = lerp(at(0, 0, 0), at(1, 0, 0), u);
  const x10 = lerp(at(0, 1, 0), at(1, 1, 0), u);
  const x01 = lerp(at(0, 0, 1), at(1, 0, 1), u);
  const x11 = lerp(at(0, 1, 1), at(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement, repeat = false): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** The side of a column, a plate to a row: the glaze of each rim, the dark gap under the next, the family's thin green line; a stranger now and then. */
function rimMap(): CanvasTexture {
  const w = 64;
  const h = TEX_PLATES * ROW_PX;
  const [c, g] = canvas(w, h);
  const rnd = seeded(5);
  // where the rim's edge, its top and the gap fall in a plate's row (fraction from its foot)
  const crest = (PLATE_RIM[1][1] % PITCH) / PITCH;
  const gap = (PLATE_GAP[0][1] % PITCH) / PITCH;
  for (let p = 0; p < TEX_PLATES; p++) {
    const top = h - (p + 1) * ROW_PX;
    const kind = rnd();
    const glaze: V3 = kind < 0.74 ? [238, 235, 226] : kind < 0.86 ? [232, 222, 198] : kind < 0.94 ? [222, 226, 228] : [244, 242, 236];
    const shade = 0.9 + rnd() * 0.1;
    for (let k = 0; k < ROW_PX; k++) {
      const f = 1 - (k + 0.5) / ROW_PX;
      const v = (0.66 + 0.34 * Math.exp(-(((f - crest) / 0.15) ** 2)) - 0.26 * Math.exp(-(((f - gap) / 0.075) ** 2))) * shade;
      g.fillStyle = `rgb(${glaze[0] * v | 0},${glaze[1] * v | 0},${glaze[2] * v | 0})`;
      g.fillRect(0, top + k, w, 1);
    }
    // the band painted near the edge: the family's set is white with a green line, a few strangers have gold
    const line = kind < 0.74 ? 'rgba(46,74,56,0.85)' : kind < 0.86 ? 'rgba(140,108,52,0.8)' : null;
    if (line) {
      g.fillStyle = line;
      g.fillRect(0, top + Math.round(ROW_PX * (1 - crest - 0.16)), w, 1);
    }
    // chips in the rim, where it has been knocked
    for (let i = 0; i < 3; i++) {
      if (rnd() < 0.82) continue;
      g.fillStyle = 'rgba(40,34,26,0.7)';
      g.fillRect(rnd() * w, top + ROW_PX * (1 - crest) - 1, 1 + rnd() * 3, 2);
    }
  }
  // dust settled in blotches over all of it
  for (let i = 0; i < 120; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 4 + rnd() * 30;
    const d = g.createRadialGradient(x, y, 0, x, y, r);
    d.addColorStop(0, `rgba(70,62,50,${0.03 + rnd() * 0.07})`);
    d.addColorStop(1, 'rgba(70,62,50,0)');
    g.fillStyle = d;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return texture(c, true);
}

/** A plate seen from above: the white glaze, the green line near the edge, the well's soft rim. */
function faceMap(): CanvasTexture {
  const s = 256;
  const [c, g] = canvas(s, s);
  const m = s / 2;
  const px = m / PLATE_R;
  g.fillStyle = 'rgb(222,218,206)';
  g.fillRect(0, 0, s, s);
  const ring = (r0: number, r1: number, style: string) => {
    g.beginPath();
    g.arc(m, m, r1 * px, 0, Math.PI * 2);
    g.arc(m, m, r0 * px, 0, Math.PI * 2, true);
    g.fillStyle = style;
    g.fill();
  };
  const well = g.createRadialGradient(m, m, 0.05 * px, m, m, 0.08 * px);
  well.addColorStop(0, 'rgba(0,0,0,0.05)');
  well.addColorStop(0.85, 'rgba(0,0,0,0.12)');
  well.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = well;
  g.fillRect(0, 0, s, s);
  ring(0.0955, 0.099, 'rgba(46,74,56,0.9)');
  ring(0.1005, 0.1015, 'rgba(46,74,56,0.5)');
  ring(0.111, 0.114, 'rgba(60,54,44,0.35)');
  // knife marks of a thousand dinners
  const rnd = seeded(17);
  g.strokeStyle = 'rgba(90,86,78,0.18)';
  g.lineWidth = 0.6;
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() * 0.07 * px;
    const x = m + Math.cos(a) * r;
    const y = m + Math.sin(a) * r;
    const b = rnd() * Math.PI;
    const l = (0.01 + rnd() * 0.03) * px;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(b) * l, y + Math.sin(b) * l);
    g.stroke();
  }
  return texture(c);
}

/** Rice, grain by grain. */
function riceMap(): CanvasTexture {
  const s = 256;
  const [c, g] = canvas(s, s);
  g.fillStyle = 'rgb(176,158,118)';
  g.fillRect(0, 0, s, s);
  const rnd = seeded(23);
  for (let i = 0; i < 1100; i++) {
    const x = rnd() * s;
    const y = rnd() * s;
    const a = rnd() * Math.PI;
    g.fillStyle = 'rgba(80,64,40,0.4)';
    g.beginPath();
    g.ellipse(x + 1.2, y + 1.2, 6.8, 2.4, a, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = `rgba(${238 + rnd() * 14 | 0},${230 + rnd() * 14 | 0},${208 + rnd() * 14 | 0},0.97)`;
    g.beginPath();
    g.ellipse(x, y, 6.4, 2.2, a, 0, Math.PI * 2);
    g.fill();
  }
  return texture(c);
}

/** Skin seen close: fine pores and a faint unevenness, near white (the vertex colors carry its color). */
function poreMap(): CanvasTexture {
  const s = 128;
  const [c, g] = canvas(s, s);
  g.fillStyle = 'rgb(246,242,240)';
  g.fillRect(0, 0, s, s);
  const rnd = seeded(29);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(150,110,100,${0.05 + rnd() * 0.12})`;
    g.fillRect(rnd() * s, rnd() * s, 1, 1);
  }
  return texture(c, true);
}

/** What years do to the wall: a veil that only darkens: damp at the foot, runs from the joists, blotches. */
function wallVeil(wide: number, high: number, seed: number): CanvasTexture {
  const px = 80;
  const [c, g] = canvas(Math.round(wide * px), Math.round(high * px));
  const W = c.width;
  const H = c.height;
  const rnd = seeded(seed);
  const veil = g.createLinearGradient(0, 0, 0, H);
  veil.addColorStop(0, 'rgba(5,5,4,0.62)');
  veil.addColorStop(0.18, 'rgba(5,5,4,0.22)');
  veil.addColorStop(0.7, 'rgba(5,5,4,0.12)');
  veil.addColorStop(1, 'rgba(5,5,4,0.6)');
  g.fillStyle = veil;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < wide * 10; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = (0.08 + rnd() * 0.45) * px;
    const d = g.createRadialGradient(x, y, 0, x, y, r);
    d.addColorStop(0, `rgba(12,10,6,${0.06 + rnd() * 0.16})`);
    d.addColorStop(1, 'rgba(12,10,6,0)');
    g.fillStyle = d;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // the tide line where the damp climbed and stopped
  g.beginPath();
  g.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) g.lineTo(x, H - 0.55 * px - Math.sin(x * 0.013 + seed) * 12 - rnd() * 6);
  g.lineTo(W, H);
  g.closePath();
  g.fillStyle = 'rgba(8,8,5,0.24)';
  g.fill();
  g.strokeStyle = 'rgba(30,22,10,0.4)';
  g.lineWidth = 2;
  g.stroke();
  // water run down from the joists
  for (let i = 0; i < wide * 6; i++) {
    let x = rnd() * W;
    const length = (0.4 + rnd() * 2.2) * px;
    const run = g.createLinearGradient(0, 0, 0, length);
    run.addColorStop(0, `rgba(8,8,6,${0.25 + rnd() * 0.35})`);
    run.addColorStop(1, 'rgba(8,8,6,0)');
    g.strokeStyle = run;
    g.lineWidth = 0.8 + rnd() * rnd() * 6;
    g.beginPath();
    g.moveTo(x, 0);
    for (let k = 1; k <= 12; k++) g.lineTo((x += (rnd() - 0.5) * 4), (length * k) / 12);
    g.stroke();
  }
  return texture(c);
}

/** Dust on the cellar floor, and where it is not: the path she walks every evening, out of the dark to the column. */
function dustMap(size: number, from: readonly [number, number], dir: readonly [number, number], origin: readonly [number, number]): CanvasTexture {
  const px = 1024 / size;
  const [c, g] = canvas(1024, 1024);
  const rnd = seeded(41);
  const at = (x: number, z: number): [number, number] => [(x - origin[0]) * px, (z - origin[1]) * px];
  for (let i = 0; i < 900; i++) {
    const x = rnd() * 1024;
    const y = rnd() * 1024;
    const r = (0.15 + rnd() * 0.9) * px;
    const d = g.createRadialGradient(x, y, 0, x, y, r);
    d.addColorStop(0, `rgba(128,124,116,${0.02 + rnd() * 0.05})`);
    d.addColorStop(1, 'rgba(128,124,116,0)');
    g.fillStyle = d;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // the path: swept clean by years of the same steps, and darker where they fall
  g.globalCompositeOperation = 'destination-out';
  g.lineCap = 'round';
  const side: [number, number] = [-dir[1], dir[0]];
  const path = (wide: number, alpha: number) => {
    g.strokeStyle = `rgba(0,0,0,${alpha})`;
    g.lineWidth = wide * px;
    g.beginPath();
    for (let k = 0; k <= 30; k++) {
      const d = 0.25 + (k / 30) * size;
      const bend = Math.sin(d * 0.35) * 0.35;
      const [x, y] = at(from[0] + dir[0] * d + side[0] * bend, from[1] + dir[1] * d + side[1] * bend);
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  };
  path(0.75, 0.35);
  path(0.42, 0.6);
  g.globalCompositeOperation = 'source-over';
  for (let k = 0; k < 60; k++) {
    const d = 0.3 + rnd() * size * 0.8;
    const bend = Math.sin(d * 0.35) * 0.35 + (rnd() - 0.5) * 0.25;
    const [x, y] = at(from[0] + dir[0] * d + side[0] * bend, from[1] + dir[1] * d + side[1] * bend);
    g.fillStyle = `rgba(20,16,12,${0.05 + rnd() * 0.08})`;
    g.beginPath();
    g.ellipse(x, y, 0.06 * px, 0.11 * px, Math.atan2(dir[1], dir[0]) + Math.PI / 2, 0, Math.PI * 2);
    g.fill();
  }
  return texture(c);
}

/** A soft dark round, for where a column stands on the floor. */
function contactMap(): CanvasTexture {
  const [c, g] = canvas(128, 128);
  const d = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  d.addColorStop(0, 'rgba(0,0,0,0.85)');
  d.addColorStop(0.42, 'rgba(0,0,0,0.6)');
  d.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = d;
  g.fillRect(0, 0, 128, 128);
  return texture(c);
}

/** A lathe from a profile of [radius, height] (m). */
function lathe(profile: Profile, radial: number): LatheGeometry {
  return new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), radial);
}

/**
 * The side of a column of `plates`, its foot at the origin: a drum painted with its rims, and the top `rims` plates
 * cut in for real, so that its edge against the dark is a stack (each a little off the one below, by `wander` m).
 */
function columnSide(plates: number, rims: number, radial: number, vOffset: number, dust: number, wander: number, seed: number): BufferGeometry {
  const profile: [number, number][] = PLATE_FOOT.map(([r, y]) => [r, y]);
  const from = Math.max(1, plates - rims);
  profile.push([DRUM_R, 0.02], [DRUM_R, from * PITCH + PLATE_RIM[0][1] - 0.002]);
  const rnd = seeded(seed);
  for (let k = from; k < plates; k++) {
    const y = k * PITCH;
    const out = (rnd() - 0.5) * wander;
    for (const [r, dy] of PLATE_RIM) profile.push([r + out, y + dy]);
    if (k < plates - 1) for (const [r, dy] of PLATE_GAP) profile.push([r + out * 0.5, y + dy]);
  }
  const g = lathe(profile, radial);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const color = new Float32Array(pos.count * 3);
  const span = PITCH * TEX_PLATES;
  for (let v = 0; v < pos.count; v++) {
    const i = Math.floor(v / profile.length);
    const y = pos.getY(v);
    uv.setXY(v, (i / radial) * U_REPEAT, y / span + vOffset);
    const k = (0.7 + 0.3 * smootherstep(range(0, FOOT_GRIME, y))) * (1 - dust * 0.1);
    color[v * 3] = k;
    color[v * 3 + 1] = k * 0.985;
    color[v * 3 + 2] = k * 0.96;
  }
  g.setAttribute('color', new BufferAttribute(color, 3));
  return g;
}

/** The top plate of a column, seen from above: its rim and its well, greyed by `dust`. */
function columnTop(plates: number, radial: number, dust: number): BufferGeometry {
  const top = (plates - 1) * PITCH;
  const g = lathe([PLATE_RIM[2], ...PLATE_FACE].map(([r, y]) => [r, top + y] as const), radial);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const color = new Float32Array(pos.count * 3);
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v);
    const z = pos.getZ(v);
    uv.setXY(v, 0.5 + x / (2 * PLATE_R), 0.5 - z / (2 * PLATE_R));
    // dust lies thicker in the well than on the rim
    const well = 1 - smootherstep(range(0.07, 0.1, Math.hypot(x, z)));
    const k = 1 - dust * (0.3 + 0.2 * well);
    color[v * 3] = k;
    color[v * 3 + 1] = k * 0.975;
    color[v * 3 + 2] = k * 0.93;
  }
  g.setAttribute('color', new BufferAttribute(color, 3));
  return g;
}

/** A frame on a curve: where, along it, and its side and back (the side taken from `lateral`). */
interface Frame {
  at: Vector3;
  along: Vector3;
  side: Vector3;
  up: Vector3;
}

function frameOn(curve: CatmullRomCurve3, lateral: Vector3, s: number): Frame {
  const at = curve.getPointAt(s);
  const along = curve.getTangentAt(s).normalize();
  const side = lateral.clone().addScaledVector(along, -lateral.dot(along)).normalize();
  const up = new Vector3().crossVectors(along, side);
  return { at, along, side, up };
}

/**
 * A closed tube along `curve`: its section a superellipse (half-width along the side, half-height along the back,
 * squareness) at each fraction of its length, closing to a point wherever its size reaches 0. `paint` colors it.
 */
function tube(curve: CatmullRomCurve3, lateral: Vector3, radial: number, along: number, section: (s: number) => readonly [number, number, number], paint: (s: number, angle: number, at: Vector3, out: Color) => void): BufferGeometry {
  const count = (along + 1) * radial;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const index: number[] = [];
  const p = new Vector3();
  const c = new Color();
  for (let j = 0; j <= along; j++) {
    const s = j / along;
    const f = frameOn(curve, lateral, s);
    const [w, h, sq] = section(s);
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const x = Math.sign(ca) * Math.abs(ca) ** sq * Math.max(w, 0.0004);
      const y = Math.sign(sa) * Math.abs(sa) ** sq * Math.max(h, 0.0004);
      p.copy(f.at).addScaledVector(f.side, x).addScaledVector(f.up, y);
      p.toArray(positions, (j * radial + i) * 3);
      paint(s, a, p, c);
      c.toArray(colors, (j * radial + i) * 3);
      uvs[(j * radial + i) * 2] = s * TUBE_TILES;
      uvs[(j * radial + i) * 2 + 1] = (i / radial) * 2;
      if (j < along) {
        const a0 = j * radial + i;
        const b0 = j * radial + ((i + 1) % radial);
        index.push(a0, b0, a0 + radial, b0, b0 + radial, a0 + radial);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('color', new BufferAttribute(colors, 3));
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** How many times a skin texture repeats along a tube. */
const TUBE_TILES = 8;

/** A finger in the hand's frame (m, deg): where its knuckle is, how it fans out, its three bones, how each joint bends, how thick it is at the knuckle and at the tip. */
interface FingerSpec {
  base: V3;
  spread: number;
  bones: V3;
  bend: V3;
  width: readonly [number, number];
}

/** A left hand, palm down, fingers along +Z, its back +Y, the thumb on -X: laid at rest on the edge of something. */
const FINGERS: readonly FingerSpec[] = [
  { base: [-0.0235, 0.002, 0.09], spread: -5, bones: [0.043, 0.025, 0.021], bend: [8, 20, 10], width: [0.009, 0.0068] },
  { base: [-0.0075, 0.003, 0.094], spread: -1, bones: [0.047, 0.029, 0.022], bend: [10, 24, 12], width: [0.0093, 0.007] },
  { base: [0.0085, 0.002, 0.091], spread: 3, bones: [0.044, 0.027, 0.021], bend: [12, 26, 12], width: [0.0086, 0.0065] },
  { base: [0.0235, 0, 0.084], spread: 8, bones: [0.034, 0.02, 0.019], bend: [16, 28, 14], width: [0.0074, 0.0056] },
];
/** How far a finger reaches back into the palm (m), and how long its rounded tip is (m). */
const BURIED = 0.022;
const TIP_ROUND = 0.0085;
/** The ring finger, and where the ring sits on it (share of its first bone). */
const RING_FINGER = 2;
const RING_AT = 0.4;
/** The back of the hand and the forearm (m along Z, half-width, half-height). */
const PALM: readonly V3[] = [
  [-0.27, 0.036, 0.031],
  [-0.16, 0.032, 0.025],
  [-0.05, 0.0275, 0.0185],
  [0, 0.0285, 0.0172],
  [0.035, 0.0345, 0.0158],
  [0.07, 0.0385, 0.0142],
  [0.088, 0.039, 0.0135],
  [0.098, 0.034, 0.0112],
  [0.104, 0.024, 0.0075],
  [0.108, 0, 0],
];

/** A value from rows of [x, ...values], straight between them. */
function along3(rows: readonly V3[], x: number): [number, number] {
  if (x <= rows[0][0]) return [rows[0][1], rows[0][2]];
  for (let i = 1; i < rows.length; i++) {
    if (x <= rows[i][0]) {
      const t = (x - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0]);
      return [lerp(rows[i - 1][1], rows[i][1], t), lerp(rows[i - 1][2], rows[i][2], t)];
    }
  }
  const last = rows[rows.length - 1];
  return [last[1], last[2]];
}

const STEAM_VERT = /* glsl */ `
attribute vec4 aRibbon;
uniform float uTime;
uniform float uSway;
uniform vec3 uLean;
varying vec2 vUv;
varying float vSeed;
void main() {
  vUv = uv;
  vSeed = aRibbon.z;
  float h = position.y;
  vec3 base = (modelMatrix * vec4(aRibbon.x, 0.0, aRibbon.y, 1.0)).xyz;
  vec3 toEye = cameraPosition - base;
  toEye.y = 0.0;
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), normalize(toEye + vec3(1e-4, 0.0, 0.0))));
  float width = mix(0.016, 0.08, h);
  float sway = (sin(uTime * 0.9 + aRibbon.z * 6.0 + h * 5.0) * 0.022 + sin(uTime * 1.6 + aRibbon.z * 11.0 + h * 9.0) * 0.008) * h * uSway;
  vec3 p = base + vec3(0.0, h * aRibbon.w, 0.0) + side * (position.x * width + sway) + uLean * h * h;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const STEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uStrength;
uniform vec3 uColor;
varying vec2 vUv;
varying float vSeed;
float steamHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float steamNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(steamHash(i), steamHash(i + vec2(1.0, 0.0)), u.x), mix(steamHash(i + vec2(0.0, 1.0)), steamHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float x = vUv.x * 2.0 - 1.0;
  float h = vUv.y;
  vec2 q = vec2(vUv.x * 2.2 + vSeed * 7.0, h * 3.0 - uTime * 1.6);
  float n = steamNoise(q * 2.0) * 0.6 + steamNoise(q * 4.3 + 3.1) * 0.4;
  float wisp = smoothstep(0.4, 0.85, n);
  float edge = 1.0 - smoothstep(0.3, 1.0, abs(x));
  float a = wisp * edge * smoothstep(0.0, 0.14, h) * (1.0 - smoothstep(0.4, 1.0, h));
  gl_FragColor = vec4(uColor * a * uStrength, 1.0);
}`;

const before = new Vector3();
const scratch = new Vector3();

/**
 * What the house keeps. From the top of a steep cellar stair, one bulb halfway down throws its cone onto the
 * floor; as the eye gets used to the dark, the cellar turns out to be a forest of columns of stacked dinner plates,
 * hundreds of them, fading into the black. Two steps down. Out of the dark beyond the light comes a woman's pale
 * hand with a thin ring, carrying a plate of food that still steams; it sets it on the nearest column with care,
 * rests on the rim, and goes back where it came from. The steam goes on rising.
 */
export default class Cellar extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: FOG_COLOR, density: FOG_DENSITY },
    env: 'evening',
    envIntensity: 0.05,
    sky: 0,
    grade: { exposure: EXPOSURE_START, saturation: 0.62, warmth: 0, tint: -0.02, flare: 0.003 },
  };
  film = { bloom: 0.8, bloomFrom: 0.75, grain: 0.45, scratches: 0.03, flicker: 0.02, weave: REDUCED_MOTION ? 0 : 0.0004 };
  focus = FOCUS[0][1];
  aperture = APERTURE;
  drift = REDUCED_MOTION ? 0 : 0.45;
  fear = 0.3;
  control = { look: true, scroll: true, hurry: 1.6 };

  private readonly key: SpotSpec;
  private readonly spill: DreamLight;
  private readonly bounce: DreamLight;
  private readonly teal: DreamLight;
  private readonly filament = new MeshBasicMaterial({ color: new Color(GLOW, GLOW * 0.76, GLOW * 0.5) });
  private readonly halo: ShaderMaterial;
  private readonly haloColor: Color;
  private readonly beam: ShaderMaterial;
  private readonly arm = new Group();
  private readonly plate = new Group();
  /** Where the hand and the plate are once the plate is down; the way the arm comes and goes (unit, horizontal). */
  private readonly handRest = new Vector3();
  private readonly plateRest = new Vector3();
  private readonly from = new Vector3();
  private readonly steamU = {
    uTime: { value: 0 },
    uSway: { value: REDUCED_MOTION ? 0.4 : 1 },
    uStrength: { value: 0 },
    uColor: { value: new Color(0.78, 0.74, 0.68) },
    uLean: { value: new Vector3() },
  };
  private readonly dust: { value: number };
  private hum: RoomVoice | null = null;
  private airBed: RoomVoice | null = null;
  private drone: RoomVoice | null = null;
  private house: RoomVoice | null = null;

  constructor(ctx: RoomContext) {
    super(ctx);
    this.keys = SHOT.map(([s, x, y, z, yaw, pitch, fov]): RoomKey => ({ t: s / this.seconds, at: [x, y, z], yaw, pitch, fov }));

    this.buildShell();
    this.buildStair();
    const lids = this.buildForest();
    this.buildPlate(lids);
    this.buildArm();
    const { halo, beam } = this.buildBulb();
    this.halo = halo;
    this.haloColor = (halo.uniforms.uColor.value as Color).clone();
    this.beam = beam;

    this.key = this.spot(BULB, KEY_AIM, KEY_COLOR, KEY_POWER, KEY_ANGLE, KEY_PENUMBRA);
    this.spots = [this.key, null, null];
    this.spill = this.light([BULB[0], BULB[1] - 0.05, BULB[2]], KEY_COLOR, SPILL, SPILL_REACH);
    this.bounce = this.light(BOUNCE_AT, KEY_COLOR, BOUNCE, BOUNCE_REACH);
    this.teal = this.light(TEAL_AT, TEAL_COLOR, TEAL, TEAL_REACH);
    this.dust = this.build.motes(220, { x: [-0.5, 2.1], y: [0.3, 3.3], z: [-3.9, -0.7] }, this.root, { size: 0.008, color: 0xe8d4b4, strength: 0.3, seed: 7 }).time;

    // sound: the bulb, the cellar's own air, a dinner going on somewhere above; two treads; then nothing
    this.beat(0, () => {
      this.hum = this.sound.bed('rooms/bulb_hum.mp3', { gain: HUM_GAIN, fade: 0.4 });
      this.airBed = this.sound.bed('rooms/hall_silence.mp3', { gain: AIR_GAIN, fade: 1.5 });
      this.drone = this.sound.bed('rooms/dream_drone_low.mp3', { gain: DRONE_GAIN, fade: 2.5 });
      this.house = this.sound.bed('rooms/cutlery_far.mp3', { gain: HOUSE_GAIN, lowpass: 650, reverb: 0.45, fade: 1 });
    });
    this.beat(STEP_1, () => {
      this.sound.play('rooms/floor_step_near_1.mp3', { gain: 0.2, reverb: 0.25 });
      this.sound.play('rooms/stair_creak_1.mp3', { gain: 0.26, reverb: 0.3, rate: 0.92 });
    });
    this.beat(STEP_2, () => {
      this.sound.play('rooms/floor_step_near_3.mp3', { gain: 0.2, reverb: 0.25 });
      this.sound.play('rooms/stair_creak_5.mp3', { gain: 0.3, reverb: 0.3, rate: 0.85 });
    });
    this.beat(HUSH, () => {
      this.house?.gain(0, 1.6);
      this.airBed?.gain(0, 1.4);
      this.drone?.gain(0, 1.6);
      this.hum?.gain(HUM_GAIN * 0.25, 1.4);
    });
    // the plate goes down on the column, the column's plates answer, her ring touches the rim; far off in the dark, another column
    this.beat(HAND_SET, () => this.sound.play('rooms/plate_set_2.mp3', { gain: 0.2, pan: COLUMN_PAN, reverb: 0.45, rate: 0.96 }));
    this.beat(HAND_SET + 0.14, () => this.sound.play('rooms/plate_clink_2.mp3', { gain: 0.1, pan: COLUMN_PAN, reverb: 0.4 }));
    this.beat(HAND_SET + 0.32, () => this.sound.play('rooms/tooth_clink.mp3', { gain: 0.07, pan: COLUMN_PAN, reverb: 0.3, rate: 1.35 }));
    this.beat(HAND_SET + 0.9, () => this.sound.play('rooms/plate_clink_4.mp3', { gain: 0.045, pan: -0.45, reverb: 0.7, rate: 0.82, lowpass: 1600 }));
    this.beat(SHUTTER_AT, () => this.shutter(false));
    this.beat(AFTER, () => {
      this.hum?.gain(HUM_GAIN * 0.8, 2);
      this.drone?.gain(DRONE_GAIN * 0.7, 2.5);
      this.house?.gain(HOUSE_GAIN * 0.6, 2.5);
    });
    this.beat(CUT_AT, () => this.sound.stopAll(0.05));
  }

  /** Walls of old plaster fallen off brick, a concrete floor in dust, the joists of the house overhead, the door you came through. */
  private buildShell(): void {
    const { kit, build: b } = this;
    const plaster = kit.surface('plaster_damaged', 1.85, { color: new Color(0.6, 0.56, 0.5) });
    b.wall(WALL_X, (BACK_Z - DEEP) / 2, DEEP + BACK_Z, CEIL, '+x', plaster, this.root);
    b.wall(WALL_X + WIDE / 2, BACK_Z, WIDE, CEIL, '-z', plaster, this.root);
    const floor = kit.surface('conc_cracked', 2, { color: new Color(0.3, 0.29, 0.27) });
    this.root.add(kit.floor(WALL_X, WALL_X + WIDE, -DEEP, BACK_Z, 0, floor));
    const planks = kit.floor(WALL_X, WALL_X + WIDE, -DEEP, BACK_Z, CEIL, kit.surface('wood_floor_dark', 2, { color: new Color(0.32, 0.27, 0.23) }));
    planks.rotation.x = Math.PI / 2;
    this.root.add(planks);
    const beams: BufferGeometry[] = [];
    for (let z = BACK_Z - 0.1; z > -DEEP; z -= JOIST_GAP) beams.push(meterUVs(new BoxGeometry(WIDE, JOIST_H, JOIST_W)).translate(WALL_X + WIDE / 2, CEIL - JOIST_H / 2, z));
    const joists = new Mesh(mergeGeometries(beams)!, kit.surface('wood_raw_boards', 1.4, { color: new Color(0.3, 0.25, 0.2) }));
    joists.receiveShadow = true;
    this.root.add(joists);

    // the stains of years over the near walls
    const veil = (map: CanvasTexture) => new MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const side = new Mesh(new PlaneGeometry(10, CEIL), veil(wallVeil(10, CEIL, 7)));
    side.rotation.y = Math.PI / 2;
    side.position.set(WALL_X + 0.004, CEIL / 2, BACK_Z - 5);
    const back = new Mesh(new PlaneGeometry(6, CEIL), veil(wallVeil(6, CEIL, 19)));
    back.rotation.y = Math.PI;
    back.position.set(WALL_X + 3, CEIL / 2, BACK_Z - 0.004);
    this.root.add(side, back);

    // dust on the floor, and her path through it, out of the dark to the column
    const away = this.armWay();
    const size = 12;
    const origin: [number, number] = [HERO_X - 3.5, HERO_Z - 7.5];
    const dust = new Mesh(
      new PlaneGeometry(size, size),
      new MeshStandardMaterial({ map: dustMap(size, [HERO_X, HERO_Z], [away.x, away.z], origin), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
    dust.rotation.x = -Math.PI / 2;
    dust.position.set(origin[0] + size / 2, 0.002, origin[1] + size / 2);
    dust.receiveShadow = true;
    this.root.add(dust);

    // the landing: a block of the same old masonry, boards on top; the door behind, shut, the house's light under it
    const block = kit.block(LANDING_R - WALL_X, TOP - 0.04, BACK_Z, plaster);
    block.position.set((WALL_X + LANDING_R) / 2, (TOP - 0.04) / 2, BACK_Z / 2);
    const slab = kit.block(LANDING_R - WALL_X, 0.04, BACK_Z, kit.surface('wood_floor_dark', 2, { color: new Color(0.3, 0.28, 0.26) }));
    slab.position.set((WALL_X + LANDING_R) / 2, TOP - 0.02, BACK_Z / 2);
    slab.castShadow = true;
    this.root.add(block, slab);
    const door = b.door(DOOR_X, BACK_Z, '-z', this.root, { open: 0, color: 0x231d16, width: DOOR_W, height: DOOR_H });
    door.root.position.y = TOP;
    const under = new Mesh(new PlaneGeometry(DOOR_W - 0.04, 0.009), new MeshBasicMaterial({ color: new Color(1.3, 0.85, 0.45) }));
    under.rotation.y = Math.PI;
    under.position.set(DOOR_X, TOP + 0.005, BACK_Z - 0.045);
    this.root.add(under);
    b.glow(DOOR_X, TOP + 0.01, BACK_Z - 0.06, 0.5, 0xffb070, 0.06, this.root, 3);
  }

  /** The way the arm comes from and goes back to: from the column, turned off the line of the eye (horizontal unit). */
  private armWay(): Vector3 {
    const last = SHOT[SHOT.length - 1];
    const eye = new Vector3(last[1], 0, last[3]);
    return new Vector3(HERO_X, 0, HERO_Z).sub(eye).normalize().applyAxisAngle(new Vector3(0, 1, 0), -ARM_TURN * DEG);
  }

  /** A steep open stair of worn boards between two strings, an iron rail on the wall. */
  private buildStair(): void {
    const { kit } = this;
    const width = STAIR_R - STAIR_L;
    const boards: BufferGeometry[] = [];
    for (let i = 1; i < RISERS; i++) {
      const g = meterUVs(new BoxGeometry(width, TREAD_T, TREAD_D));
      const z = g.getAttribute('position');
      const shade = new Float32Array(z.count * 3);
      for (let v = 0; v < z.count; v++) shade.fill(lerp(TREAD_BACK, 1, 0.5 - z.getZ(v) / TREAD_D), v * 3, v * 3 + 3);
      g.setAttribute('color', new BufferAttribute(shade, 3));
      g.translate((STAIR_L + STAIR_R) / 2, TOP - i * RISE - TREAD_T / 2, -i * GOING - 0.03 + TREAD_D / 2);
      boards.push(g);
    }
    const treads = new Mesh(mergeGeometries(boards)!, kit.surface('wood_stair', 1.2, { color: new Color(0.36, 0.32, 0.29), vertexColors: true }));
    treads.castShadow = true;
    treads.receiveShadow = true;
    this.root.add(treads);

    // the strings: the nosing line above, the foot cut level on the floor
    const across = STRING_D * Math.hypot(1, SLOPE);
    const lowEnd = -(TOP + 0.06 - 0.12) / SLOPE;
    const shape = new Shape();
    shape.moveTo(0, TOP + 0.06);
    shape.lineTo(lowEnd, 0.12);
    shape.lineTo(lowEnd, 0);
    shape.lineTo(-(TOP + 0.06 - across) / SLOPE, 0);
    shape.lineTo(0, TOP + 0.06 - across);
    shape.closePath();
    const string = new ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: false });
    const paint = kit.surface('wood_dark_paint', 1.6, { color: new Color(0.55, 0.5, 0.45) });
    for (const x of [STAIR_R + 0.045, STAIR_L]) {
      const side = new Mesh(string, paint);
      side.rotation.y = -Math.PI / 2;
      side.position.x = x;
      side.castShadow = true;
      side.receiveShadow = true;
      this.root.add(side);
    }

    // the rail: level over the landing, then down with the stair, on three brackets
    const iron = new MeshStandardMaterial({ color: 0x1c1a17, roughness: 0.5, metalness: 0.4 });
    const x = WALL_X + RAIL_OFF;
    const high = TOP + RAIL_UP;
    const foot = -RISERS * GOING + GOING;
    const pipe = (a: Vector3, b: Vector3) => {
      const m = new Mesh(new CylinderGeometry(RAIL_R, RAIL_R, a.distanceTo(b), 10), iron);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), scratch.copy(b).sub(a).normalize());
      m.castShadow = true;
      this.root.add(m);
    };
    const top = new Vector3(x, high, BACK_Z - 0.15);
    const bend = new Vector3(x, high, 0);
    const end = new Vector3(x, high + SLOPE * foot, foot);
    pipe(top, bend);
    pipe(bend, end);
    for (const z of [0.5, foot * 0.45, foot + 0.15]) {
      const y = z > 0 ? high : high + SLOPE * z;
      const bracket = new Mesh(new CylinderGeometry(0.008, 0.008, RAIL_OFF, 6), iron);
      bracket.rotation.z = Math.PI / 2;
      bracket.position.set(WALL_X + RAIL_OFF / 2, y - 0.012, z);
      this.root.add(bracket);
    }
  }

  /** The plates: a forest of columns into the dark, and the one she keeps now at the edge of the light. Returns the look of a plate's face. */
  private buildForest(): Material {
    const rnd = seeded(1961);
    const last = SHOT[SHOT.length - 1];
    const eye = new Vector3(last[1], last[2], last[3]);
    const away = this.armWay();
    const far: BufferGeometry[] = [];
    const near: BufferGeometry[] = [];
    const tops: BufferGeometry[] = [];
    const feet: BufferGeometry[] = [];
    const place = new Matrix4();
    const tilt = new Matrix4();
    const stand = (geometry: BufferGeometry, x: number, z: number, lean: number, turn: number) => {
      tilt.makeRotationAxis(scratch.set(Math.cos(turn), 0, Math.sin(turn)), lean);
      geometry.applyMatrix4(place.makeTranslation(x, 0, z).multiply(tilt));
      return geometry;
    };
    const foot = (x: number, z: number) => {
      const g = new PlaneGeometry(0.5, 0.5);
      g.rotateX(-Math.PI / 2);
      g.translate(x, 0.003, z);
      feet.push(g);
    };
    // what may stand where: not on the stair (unless low enough to stand under it), not on the landing, not in the clearing, not in her way
    const room = (x: number, z: number): number => {
      if (x < WALL_X + 0.25 || z > BACK_Z - 0.25) return 0;
      if (x < LANDING_R + 0.2 && z > -0.1) return 0;
      if (Math.hypot(x - POOL[0], z - POOL[1]) < CLEARING) return 0;
      const ax = x - HERO_X;
      const az = z - HERO_Z;
      const d = ax * away.x + az * away.z;
      if (d > -0.3 && d < ARM_CLEAR[0] && Math.abs(ax * away.z - az * away.x) < ARM_CLEAR[1]) return 0;
      if (x > STAIR_L - 0.2 && x < STAIR_R + 0.2 && z > -RISERS * GOING - 0.2) {
        if (x < STAIR_L + 0.13 || x > STAIR_R - 0.13) return 0;
        const tread = Math.min(RISERS - 1, Math.max(1, Math.ceil((-z + PLATE_R + 0.03) / GOING)));
        return TOP - tread * RISE - TREAD_T - 0.08;
      }
      return 9;
    };
    for (let gz = BACK_Z - 0.45; gz > -FOREST_DEEP; gz -= GRID) {
      for (let gx = WALL_X + 0.35; gx < FOREST_WIDE; gx += GRID) {
        const x = gx + (rnd() - 0.5) * 2 * JITTER;
        const z = gz + (rnd() - 0.5) * 2 * JITTER;
        const spread = rnd();
        const lean = rnd() * 1.3 * DEG;
        const turn = rnd() * Math.PI * 2;
        const offset = Math.floor(rnd() * TEX_PLATES) / TEX_PLATES;
        const short = rnd() < 0.08;
        const grey = rnd();
        const seed = Math.floor(rnd() * 1e6);
        const limit = room(x, z);
        if (limit <= 0.4) continue;
        const out = Math.hypot(x - POOL[0], z - POOL[1]);
        const height = Math.min(limit, lerp(NEAR_HEIGHT, FAR_HEIGHT, smootherstep(range(1, 9, out))) * (1 - HEIGHT_SPREAD / 2 + HEIGHT_SPREAD * spread) * (short ? 0.45 : 1));
        const plates = Math.max(20, Math.round(height / PITCH));
        const dust = Math.min(0.8, 0.3 + out * 0.04 + grey * 0.25);
        const nearby = eye.distanceTo(scratch.set(x, height, z)) < NEAR_DETAIL;
        (nearby ? near : far).push(stand(columnSide(plates, nearby ? RIMS_NEAR : RIMS_FAR, nearby ? RADIAL_NEAR : RADIAL_FAR, offset, dust, WANDER, seed), x, z, lean, turn));
        tops.push(stand(columnTop(plates, nearby ? RADIAL_NEAR : RADIAL_TOP, dust), x, z, lean, turn));
        foot(x, z);
      }
    }
    // hers: newer than the rest, not a speck of dust on it
    near.push(stand(columnSide(HERO_PLATES, RIMS_HERO, RADIAL_HERO, 40 / TEX_PLATES, 0, WANDER, 3), HERO_X, HERO_Z, 0, 0));
    tops.push(stand(columnTop(HERO_PLATES, RADIAL_HERO, 0), HERO_X, HERO_Z, 0, 0));
    foot(HERO_X, HERO_Z);

    const glaze = new MeshStandardMaterial({ map: rimMap(), vertexColors: true, roughness: 0.24, metalness: 0 });
    const lids = new MeshStandardMaterial({ map: faceMap(), vertexColors: true, roughness: 0.32, metalness: 0 });
    for (const [parts, material] of [[far, glaze], [near, glaze], [tops, lids]] as const) {
      const mesh = new Mesh(mergeGeometries(parts)!, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
    const shadows = new Mesh(mergeGeometries(feet)!, new MeshBasicMaterial({ map: contactMap(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    shadows.renderOrder = 1;
    this.root.add(shadows);
    return lids;
  }

  /** The plate she brings: rice, and beans in their red sauce, still steaming. Its foot is at the group's origin. */
  private buildPlate(lids: Material): void {
    const plate = lathe([...PLATE_FOOT, ...PLATE_RIM, ...PLATE_FACE], 48);
    const pos = plate.getAttribute('position');
    const uv = plate.getAttribute('uv');
    const color = new Float32Array(pos.count * 3).fill(1);
    for (let v = 0; v < pos.count; v++) uv.setXY(v, 0.5 + pos.getX(v) / (2 * PLATE_R), 0.5 - pos.getZ(v) / (2 * PLATE_R));
    plate.setAttribute('color', new BufferAttribute(color, 3));
    const dish = new Mesh(plate, lids);
    dish.castShadow = true;
    dish.receiveShadow = true;
    this.plate.add(dish);
    const well = PLATE_FACE[PLATE_FACE.length - 1][1];

    // the rice: a lumpy mound
    const rice = lathe([[0.056, 0], [0.057, 0.004], [0.052, 0.011], [0.043, 0.018], [0.03, 0.023], [0.015, 0.026], [0, 0.027]], 30);
    rice.deleteAttribute('normal');
    const rp = rice.getAttribute('position');
    const ruv = rice.getAttribute('uv');
    for (let v = 0; v < rp.count; v++) {
      const x = rp.getX(v);
      const y = rp.getY(v);
      const z = rp.getZ(v);
      const n = noise3(x * 70 + 3, y * 70, z * 70) - 0.5 + (noise3(x * 260, y * 260, z * 260) - 0.5) * 0.4;
      rp.setXYZ(v, x * (1 + n * 0.16), y * (1 + n * 0.2), z * (1 + n * 0.16));
      ruv.setXY(v, 0.5 + x / 0.12, 0.5 - z / 0.12);
    }
    const lump = mergeVertices(rice);
    lump.computeVertexNormals();
    const mound = new Mesh(lump, new MeshStandardMaterial({ map: riceMap(), roughness: 0.62 }));
    mound.position.set(RICE_AT[0], well, RICE_AT[1]);
    mound.castShadow = true;
    mound.receiveShadow = true;
    this.plate.add(mound);

    // the beans in their sauce
    const sauce = new Mesh(lathe([[0.062, 0], [0.064, 0.005], [0.06, 0.0095], [0.045, 0.0112], [0, 0.0118]], 30), new MeshStandardMaterial({ color: new Color().setRGB(0.46, 0.17, 0.07, SRGBColorSpace), roughness: 0.18 }));
    sauce.position.set(SAUCE_AT[0], well, SAUCE_AT[1]);
    sauce.receiveShadow = true;
    this.plate.add(sauce);
    const rnd = seeded(77);
    const count = 26;
    const m = new Matrix4();
    const q = new Quaternion();
    const seeds: BufferGeometry[] = [];
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 0.047;
      q.setFromAxisAngle(scratch.set(rnd() - 0.5, 4, rnd() - 0.5).normalize(), rnd() * Math.PI);
      m.compose(scratch.set(Math.cos(a) * r, 0.011 + rnd() * 0.0015, Math.sin(a) * r), q, new Vector3(0.0072, 0.0046, 0.005));
      seeds.push(new SphereGeometry(1, 10, 7).applyMatrix4(m));
    }
    const beans = new Mesh(mergeGeometries(seeds)!, new MeshStandardMaterial({ color: new Color().setRGB(0.74, 0.46, 0.28, SRGBColorSpace), roughness: 0.32 }));
    beans.position.copy(sauce.position);
    beans.castShadow = true;
    this.plate.add(beans);

    // the steam: soft ribbons that rise and turn to the eye
    const ribbons: BufferGeometry[] = [];
    for (let i = 0; i < STEAM_RIBBONS; i++) {
      const g = new PlaneGeometry(1, 1, 1, 14);
      g.translate(0, 0.5, 0);
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 0.045;
      const info = [Math.cos(a) * r, Math.sin(a) * r + 0.002, rnd(), lerp(STEAM_TALL[0], STEAM_TALL[1], rnd())];
      const n = g.getAttribute('position').count;
      g.setAttribute('aRibbon', new Float32BufferAttribute(Array.from({ length: n }, () => info).flat(), 4));
      ribbons.push(g);
    }
    const steam = new Mesh(
      mergeGeometries(ribbons)!,
      new ShaderMaterial({ vertexShader: STEAM_VERT, fragmentShader: STEAM_FRAG, uniforms: this.steamU, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }),
    );
    steam.position.y = well + 0.03;
    steam.frustumCulled = false;
    steam.renderOrder = 4;
    this.plate.add(steam);
    this.plate.visible = false;
    this.root.add(this.plate);
  }

  /** Her hand and forearm, a dark sleeve that goes back into the dark, the thin ring. Placed so that the fingers rest on the rim. */
  private buildArm(): void {
    const X = new Vector3(1, 0, 0);
    const Y = new Vector3(0, 1, 0);
    const skinBase = new Color().setRGB(SKIN[0], SKIN[1], SKIN[2], SRGBColorSpace);
    const blush = new Color().setRGB(0.86, 0.62, 0.58, SRGBColorSpace);
    const vein = new Color().setRGB(0.62, 0.66, 0.74, SRGBColorSpace);
    const skin = (bumps: readonly number[]) => (s: number, angle: number, at: Vector3, out: Color) => {
      const back = Math.max(0, Math.sin(angle));
      const n = noise3(at.x * 160, at.y * 160, at.z * 160);
      out.copy(skinBase).multiplyScalar(0.93 + 0.1 * n);
      let red = 0;
      for (const b of bumps) red = Math.max(red, Math.exp(-(((s - b) / 0.035) ** 2)) * back);
      out.lerp(blush, red * 0.55 + (1 - back) * 0.12);
      const veins = noise3(at.x * 70 + 9, at.y * 70, at.z * 30);
      out.lerp(vein, back * smootherstep(range(0.62, 0.75, veins)) * 0.22 * smootherstep(range(-0.05, 0.05, at.z)) * (1 - smootherstep(range(0.07, 0.09, at.z))));
    };
    const parts: BufferGeometry[] = [];
    const nails: BufferGeometry[] = [];
    const nail = (curve: CatmullRomCurve3, lateral: Vector3, length: number, w: number) => {
      const f = frameOn(curve, lateral, 1 - 0.0075 / length);
      const g = new SphereGeometry(1, 12, 6);
      g.applyMatrix4(new Matrix4().makeScale(w * 0.72, 0.0016, 0.0068));
      g.applyMatrix4(new Matrix4().makeBasis(f.side, f.up, f.along).setPosition(f.at.clone().addScaledVector(f.up, w * 0.84 * 0.9)));
      nails.push(g);
    };

    // the back of the hand and the forearm
    const palm = new CatmullRomCurve3([new Vector3(0, -0.002, -0.27), new Vector3(0, 0, -0.15), new Vector3(0, 0.001, -0.04), new Vector3(0.001, 0.002, 0.02), new Vector3(0, 0.003, 0.06), new Vector3(0, 0.001, 0.108)]);
    parts.push(
      tube(palm, X, 22, 44, (s) => {
        const z = -0.27 + s * (0.108 + 0.27);
        const [w, h] = along3(PALM, z);
        return [w, h, lerp(1, 0.72, smootherstep(range(-0.06, 0.02, z)))];
      }, skin([])),
    );

    // the fingers
    const tips: Vector3[] = [];
    FINGERS.forEach((f, index) => {
      const lateral = X.clone().applyAxisAngle(Y, f.spread * DEG);
      const dir = new Vector3(0, 0, 1).applyAxisAngle(Y, f.spread * DEG);
      const base = new Vector3(...f.base);
      const points = [base.clone().addScaledVector(dir, -BURIED), base.clone()];
      let bend = 0;
      for (let k = 0; k < 3; k++) {
        bend += f.bend[k];
        points.push(points[points.length - 1].clone().addScaledVector(dir.clone().applyAxisAngle(lateral, bend * DEG), f.bones[k]));
      }
      const curve = new CatmullRomCurve3(points, false, 'centripetal');
      const length = curve.getLength();
      const joints = [BURIED, BURIED + f.bones[0], BURIED + f.bones[0] + f.bones[1]].map((d) => d / length);
      parts.push(
        tube(curve, lateral, 12, 30, (s) => {
          const d = s * length;
          let w = lerp(f.width[0], f.width[1], range(BURIED, length, d)) * (d < BURIED ? 1.04 : 1);
          const knuckle = (at: number, wide: number) => Math.exp(-((((s - at) * length) / wide) ** 2));
          w *= 1 + 0.06 * knuckle(joints[0], 0.006) + 0.07 * knuckle(joints[1], 0.005) + 0.05 * knuckle(joints[2], 0.004);
          const tip = range(length - TIP_ROUND, length, d);
          w *= Math.sqrt(1 - tip * tip);
          return [w, w * 0.84, 1];
        }, skin(joints)),
      );
      nail(curve, lateral, length, f.width[1]);
      tips.push(points[points.length - 1]);
      if (index === RING_FINGER) {
        const at = (BURIED + RING_AT * f.bones[0]) / length;
        const frame = frameOn(curve, lateral, at);
        const w = lerp(f.width[0], f.width[1], range(BURIED, length, at * length)) + 0.0008;
        const ring = new TorusGeometry(1, 0.16, 8, 36);
        ring.applyMatrix4(new Matrix4().makeScale(w, w * 0.84 + 0.0002, 0.016));
        ring.applyMatrix4(new Matrix4().makeBasis(frame.side, frame.up, frame.along).setPosition(frame.at));
        const band = new Mesh(ring, new MeshStandardMaterial({ color: 0xd9a748, metalness: 1, roughness: 0.28, emissive: 0x8a6420 }));
        this.arm.add(band);
      }
    });

    // the thumb, laid along the first finger
    const thumb = new CatmullRomCurve3(
      [[-0.024, -0.006, 0], [-0.03, -0.009, 0.02], [-0.04, -0.014, 0.048], [-0.042, -0.017, 0.073], [-0.039, -0.019, 0.095]].map(([x, y, z]) => new Vector3(x, y, z)),
      false,
      'centripetal',
    );
    const thumbLong = thumb.getLength();
    const thumbSide = new Vector3(0.3, -0.75, 0.2).normalize();
    parts.push(
      tube(thumb, thumbSide, 12, 26, (s) => {
        const d = s * thumbLong;
        const tip = range(thumbLong - 0.009, thumbLong, d);
        const w = lerp(0.0115, 0.0085, s) * Math.sqrt(1 - tip * tip);
        return [w, w * 0.86, 1];
      }, skin([])),
    );
    nail(thumb, thumbSide, thumbLong, 0.0085);

    const skinMesh = new Mesh(mergeGeometries(parts)!, new MeshStandardMaterial({ map: poreMap(), vertexColors: true, roughness: 0.56, metalness: 0 }));
    skinMesh.castShadow = true;
    skinMesh.receiveShadow = true;
    const nailMesh = new Mesh(mergeGeometries(nails)!, new MeshStandardMaterial({ color: new Color().setRGB(0.92, 0.8, 0.76, SRGBColorSpace), roughness: 0.22 }));
    this.arm.add(skinMesh, nailMesh);

    // the sleeve of a dark cardigan: from the wrist back, up toward a shoulder that is never in the light
    const sleeve = new CatmullRomCurve3([[0, 0, -0.055], [0, 0.004, -0.15], [0, 0.012, -0.27], [0, 0.08, -0.37], [0, 0.22, -0.44], [0, 0.42, -0.5]].map(([x, y, z]) => new Vector3(x, y, z)));
    const sleeveLong = sleeve.getLength();
    const wool = new Color().setRGB(WOOL[0], WOOL[1], WOOL[2], SRGBColorSpace);
    const ribs = 22;
    const cloth = tube(sleeve, X, ribs, 30, (s) => {
      const d = s * sleeveLong;
      const r = lerp(0.042, 0.05, range(0.02, 0.3, d)) + 0.003 * range(0.3, 0.5, d);
      return [r * 1.04, r, 1];
    }, (s, angle, _at, out) => {
      const d = s * sleeveLong;
      const rib = d < 0.06 && Math.round((angle / (Math.PI * 2)) * ribs) % 2 === 0 ? 0.78 : 1;
      out.copy(wool).multiplyScalar(rib * (1 - smootherstep(range(0.08, 0.42, d))));
    });
    const sleeveMesh = new Mesh(cloth, new MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    const cuff = new TorusGeometry(0.043, 0.008, 8, 26);
    const cuffFrame = frameOn(sleeve, X, 0);
    cuff.applyMatrix4(new Matrix4().makeBasis(cuffFrame.side, cuffFrame.up, cuffFrame.along).setPosition(cuffFrame.at));
    const cuffMesh = new Mesh(cuff, new MeshStandardMaterial({ color: wool, roughness: 1 }));
    for (const m of [sleeveMesh, cuffMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
      this.arm.add(m);
    }

    // where it all rests: the fingertips on the rim of the plate on her column
    const way = this.armWay();
    this.from.copy(way);
    const ahead = scratch.copy(way).negate().setY(-Math.tan(HAND_TILT * DEG)).normalize().clone();
    const side = new Vector3().crossVectors(Y, ahead).normalize();
    const back = new Vector3().crossVectors(ahead, side);
    const basis = new Matrix4().makeBasis(side, back, ahead);
    this.arm.quaternion.setFromRotationMatrix(basis);
    const turned = tips.map((t) => t.clone().applyMatrix4(basis));
    const lowest = Math.min(...turned.map((t) => t.y));
    const reach = turned.reduce((sum, t) => sum.add(t), new Vector3()).multiplyScalar(1 / turned.length).setY(0);
    const plateY = HERO_PLATES * PITCH;
    this.plateRest.set(HERO_X, plateY, HERO_Z);
    this.handRest.set(HERO_X + way.x * TIP_R, plateY + PLATE_RIM[2][1] + TIP_LIFT - lowest, HERO_Z + way.z * TIP_R).sub(reach);
    this.arm.visible = false;
    this.root.add(this.arm);
  }

  /** The bulb on its cord from a joist, the halo round it, the cone it throws through the dust. */
  private buildBulb(): { halo: ShaderMaterial; beam: ShaderMaterial } {
    const { kit, build: b } = this;
    const [x, y, z] = BULB;
    const dark = new MeshStandardMaterial({ color: 0x0b0907, roughness: 0.7 });
    const hang = CEIL - JOIST_H;
    const cordEnd = y + 0.108;
    const cord = new Mesh(new CylinderGeometry(0.004, 0.004, hang - cordEnd, 6), dark);
    cord.position.set(x, (hang + cordEnd) / 2, z);
    const rose = new Mesh(new CylinderGeometry(0.04, 0.05, 0.03, 14), new MeshStandardMaterial({ color: 0x5a5246, roughness: 0.8 }));
    rose.position.set(x, hang - 0.015, z);
    const cable = new Mesh(new CylinderGeometry(0.005, 0.005, x - WALL_X, 5), dark);
    cable.rotation.z = Math.PI / 2;
    cable.position.set((x + WALL_X) / 2, hang - 0.006, z);
    const holder = new Mesh(new CylinderGeometry(0.017, 0.022, 0.06, 12), dark);
    holder.position.set(x, y + 0.078, z);
    this.root.add(cord, rose, cable, holder);
    const lamp = kit.prop('lightbulb', [x, y + 0.05, z], { anchor: 'top', rotation: [180, 0, 0] }, this.root);
    lamp.traverse((part) => {
      const mesh = part as Mesh;
      if (mesh.isMesh && (mesh.material as MeshStandardMaterial).name.includes('glass')) mesh.material = this.filament;
    });
    const halo = b.glow(x, y, z, HALO, KEY_COLOR, HALO_GAIN, this.root, 3).material as ShaderMaterial;

    // the cone, from the bulb down to the floor where it is aimed
    const to = new Vector3(...KEY_AIM).sub(new Vector3(x, y, z));
    const length = to.length();
    const cone = new Group();
    cone.position.set(x, y, z);
    cone.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), to.normalize());
    this.root.add(cone);
    const beam = b.beam(0, 0, 0, 0.03, Math.tan(KEY_ANGLE * DEG) * length, length, KEY_COLOR, BEAM, cone).material as ShaderMaterial;
    return { halo, beam };
  }

  /** Where the hand is at second `s` (written into `out`), and how far along its way from the dark (0 at rest). */
  private handAt(s: number, out: Vector3): number {
    let away = 0;
    let lift = 0;
    if (s < HAND_OUT) {
      away = APPROACH * (1 - smootherstep(range(HAND_IN, HAND_ARRIVES, s)));
      lift = CARRY_LIFT * (1 - smootherstep(range(HAND_ARRIVES - 0.5, HAND_SET, s)));
      // once down, it presses a little, as one does
      lift -= 0.002 * Math.sin(Math.PI * range(HAND_SET, HAND_SET + 0.8, s));
    } else {
      away = WITHDRAW * smootherstep(range(HAND_OUT, HAND_GONE, s));
      lift = 0.014 * smootherstep(range(HAND_OUT, HAND_OUT + 0.5, s));
    }
    out.copy(this.handRest).addScaledVector(this.from, away);
    out.y += lift;
    return away;
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const calm = REDUCED_MOTION ? 0.4 : 1;

    // the bulb: it wavers a little, and gives a little when the hand comes
    const sag = SAG * Math.sin(Math.PI * range(SAG_AT, SAG_AT + SAG_LONG, s)) ** 2;
    const level = (1 - WAVER * calm * Math.max(0, wobble(s * 0.9, 3))) * (1 - sag);
    this.key.intensity = KEY_POWER * level;
    this.spill.intensity = SPILL * level;
    this.bounce.intensity = BOUNCE * level;
    this.filament.color.setRGB(GLOW * level, GLOW * 0.76 * level, GLOW * 0.5 * level);
    (this.halo.uniforms.uColor.value as Color).copy(this.haloColor).multiplyScalar(level);
    this.beam.uniforms.uIntensity.value = BEAM * level;

    // the eye gets used to the dark, and the forest comes out of it
    const adjusted = smootherstep(range(0, ADJUSTED, s));
    this.air.grade.exposure = lerp(EXPOSURE_START, EXPOSURE, adjusted);
    this.teal.intensity = TEAL * lerp(0.2, 1, adjusted);

    // the hand: out of the dark, the plate set down, a moment on the rim, back into the dark
    const there = s >= HAND_IN && s < HAND_GONE;
    this.arm.visible = there;
    this.plate.visible = s >= HAND_IN;
    const away = this.handAt(s, this.arm.position);
    if (s < HAND_SET) this.plate.position.copy(this.arm.position).sub(this.handRest).add(this.plateRest);
    else this.plate.position.copy(this.plateRest);
    this.movingShadows = s > HAND_IN - 0.2 && s < HAND_GONE + 0.3;

    // the steam: warm only once it is in the light, bent back while it is carried
    const carried = s < HAND_SET ? away : 0;
    this.steamU.uTime.value = s;
    this.steamU.uStrength.value = STEAM * (1 - smootherstep(range(0.25, APPROACH, carried)));
    this.handAt(s - 0.1, before);
    this.steamU.uLean.value.copy(before).sub(this.arm.position).multiplyScalar(s < HAND_SET ? STEAM_LEAN : 0);

    this.dust.value = s;
    this.focus = keyed(FOCUS, s);
    this.fear = s < HAND_IN ? lerp(0.3, 0.55, smootherstep(range(HUSH, HAND_IN, s))) : s < HAND_GONE ? 0.85 : 0.55;
    this.black = s >= CUT_AT ? 1 : 0;
  }
}

/** A value through keys [second, value], eased between them. */
function keyed(keys: readonly (readonly [number, number])[], s: number): number {
  if (s <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (s <= keys[i][0]) return lerp(keys[i - 1][1], keys[i][1], smootherstep(range(keys[i - 1][0], keys[i][0], s)));
  }
  return keys[keys.length - 1][1];
}
