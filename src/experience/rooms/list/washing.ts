import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DataTexture,
  DataUtils,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HalfFloatType,
  IcosahedronGeometry,
  InstancedMesh,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector3,
  type Bone,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import { randomFrom, type FigureSpec } from '../../dream/FigureKit';
import type { DreamLight } from '../../dream/LightPool';
import type { RoomAir, RoomAssets, RoomContext, RoomControl, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['basket_wicker', 'dolly_peg'],
  materials: ['linen_white', 'grass_meadow'],
  sounds: [
    'rooms/night_wind_far.mp3',
    'rooms/wind_grass.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/cloth_flap_gentle.mp3',
    'rooms/cloth_flap_thick.mp3',
    'rooms/cloth_flap_1.mp3',
    'rooms/cloth_flap_2.mp3',
    'rooms/sheets_lift.mp3',
    'rooms/faces_press.mp3',
    'rooms/dogs_howl_far.mp3',
    'rooms/dogs_pack_far.mp3',
    'rooms/peg_creak_1.mp3',
    'rooms/peg_creak_2.mp3',
    'rooms/wood_creak_small_2.mp3',
  ],
};

/** Beats (s). The dogs stop a breath before the cloth strains, so that there is a silence for it to break. */
const WIND_AT = 6;
const DOGS_STOP = 8.8;
const FACES_AT = 9;
const TURN_FROM = 11.75;
const SHUTTER_AT = 12.5;
const CUT_AT = 14;
/** The lift: rise (s), when the fall starts (s), the fall (s), how far the hem swings (rad), the ripple along it (m). */
const LIFT_RISE = REDUCED_MOTION ? 1.6 : 1.1;
const LIFT_FALL_FROM = 7.55;
const LIFT_FALL = 0.95;
const LIFT_ANGLE = REDUCED_MOTION ? 0.75 : 1.38;
const RIPPLE = REDUCED_MOTION ? 0.03 : 0.085;
/** The faces: how long the push takes (s), how far apart they start (s), when they begin to go and how spread, how long going takes (s). */
const FACE_RISE = REDUCED_MOTION ? 0.9 : 0.34;
const FACE_STAGGER = 0.2;
const FACE_GO_FROM = 10.05;
const FACE_GO_SPREAD = 0.55;
const FACE_GO = 0.75;
/** How long the flash keeps them on the cloth (s), in the one frame the album gets and the moment after it. */
const FLASH_HOLD = 0.22;

/** The ground climbs to a low crest she stands on, above the eye, so that the moon comes up from behind it (m). */
const CREST_Z = -23;
const CREST_H = 1.7;
const CREST_WIDTH = 11;
/** Eye height over the ground (m). */
const EYE = 1.42;
/** The two rows of the way draw together toward the moon: x at the far end (m), how much per metre of z. */
const ROW_FAR_Z = -21;
const INNER_X_FAR = 1.05;
const SLOPE = 0.062;
/** The next rows out (m), for what shows between the sheets and under them. */
const OUTER_OFFSET = 3.5;
/** A sheet: width, gap, length (m); wire height at a post and how far it sags between posts (m). */
const SHEET_W = 1.95;
const SHEET_GAP = 0.14;
const SHEET_L = 2.2;
const LINE_H = 2.55;
const SAG = 0.12;
/** Three sheets between posts, five spans to a row. */
const SHEETS_PER_SPAN = 3;
const ROW_SPANS = 5;
const PITCH = SHEET_W + SHEET_GAP;
const POST_STEP = PITCH * SHEETS_PER_SPAN;
const ROW_LENGTH = POST_STEP * ROW_SPANS;
const ROW_NEAR_Z = ROW_FAR_Z + ROW_LENGTH / Math.hypot(1, SLOPE);
/** Mesh of a sheet (columns, lines): by how near the eye ever comes. */
const RES_NEAR = [48, 52] as const;
const RES_FAR = [24, 26] as const;
const RES_OUTER = [14, 12] as const;
const NEAR_SHEETS_Z = [-17.5, 2.5] as const;
/** Pegs along the top (share of the width), the scallop of cloth between them (m). */
const PEGS = [0.02, 0.5, 0.98] as const;
const SWAG = 0.05;
const LINEN_TILE = 0.4;
const SHEET_COLOR = 0xb9bdb4;
/** Moon through the cloth: base and gain of the glow, how tight around the moon, where the turned-over top ends (share of the length). */
const THROUGH_BASE = 0.07;
const THROUGH_GAIN = 0.72;
const THROUGH_POW = 5;
const TOP_BAND = 0.1;
/** What stands behind the cloth, as a dimming of its glow: at rest and just before the faces. */
const PRESENCE_CALM = 0.12;
const PRESENCE_NEAR = 0.8;

/** Height map of the face: pixels, metres of cloth it covers, half width and height of the head on the cloth (m). */
const FACE_PX = 320;
const FACE_SPAN = 1.5;
const HEAD_HALF_W = 0.15;
const HEAD_HALF_H = 0.215;
/** Where the face sits: height over the ground (m), and how much it wanders. */
const FACE_HEIGHT = 1.55;
/** The pale fill on what pushes through, and the same under the flash. */
const FACE_FILL = 0.2;
const FLASH_FILL = 0.55;

/** Those who stand behind the sheets: how far behind (m), and which sheets have one (z of the sheet). */
const LEGS_BEHIND = 1.28;
const LEGS_Z = [0.6, -14.5] as const;
/**
 * They stand in the grass, not over it: how far their soles sink into it (m); and the dark each stands in, how wide,
 * how long down the way, how high over the ground it lies (as her shadow does) (m), and how dark it is at the boots.
 */
const LEGS_SINK = 0.025;
const LEGS_SHADOW_W = 0.62;
const LEGS_SHADOW_L = 0.95;
const LEGS_SHADOW_LIFT = 0.03;
const LEGS_SHADOW_DARK = 0.9;

/** She stands at the end of the right row (m); her head turns this far (rad), the neck taking a part of it. */
const WOMAN_X = 0.62;
const WOMAN_Z = -21.7;
const TURN = 1.68;
/** Where the moon lays her shadow: as far as z (m), drifting this much in x per metre of z. */
const SHADOW_END = -1;
const SHADOW_DRIFT = 0.0154;
/** Half the width of the ground the shadow's picture covers (m). */
const SHADOW_HALF = 0.72;
const TURN_BONES = [
  ['Bip01_Neck', 0.28],
  ['Bip01_Head', 0.72],
] as const;
const WOMAN: FigureSpec = { avatar: 'figure_woman', clip: 'f_idle_touch_hair_01', time: 0, face: 'scratched', tint: 0x34363a, bleach: 0.12 };
/** Her long white hair: strands, length (m), and how much of the head's turn it follows. */
const HAIR_STRANDS = 420;
const HAIR_LENGTH = [0.55, 0.92] as const;
const HAIR_FOLLOWS = 0.32;
/** Share of a strand that lies on the skull, and the height on it (rad) where it leaves. */
const HAIR_SKULL = 0.24;
const HAIR_NAPE = -0.2;
/** The light that finds her face as it turns (candela). */
const FACE_LAMP = 2.6;

/** The moon you see: how far (m), how high and how big (rad). */
const MOON_DISTANCE = 150;
const MOON_ALTITUDE = 0.078;
const MOON_RADIUS = 0.128;
const MOON_GLOW = 2.4;
/** The moonlight itself: from up here, since it must come over the crest; candela at this distance. */
const MOON_LIGHT_AT = [0, 9.6, -62] as const;
const MOON_LIGHT_TO = [0, 0, -6] as const;
const MOON_LIGHT = 7000;
const MOON_LIGHT_COLOR = 0xd7dfcf;

/** Inside the walk's dome, which would paint over a sky behind it (m). */
const SKY_RADIUS = 160;
const FIELD_REACH = 155;
const TREE_RING = 140;
const TREE_COLUMNS = 1100;
/** Tree heights (m): low in front of the moon, full away from it; the opening (rad either side of it). */
const TREE_LOW = 2;
const TREE_HIGH = 19;
const TREE_OPEN = 0.34;
/** Bare trees that stand up over the rows and close the sky round the moon: x, z, height (m). Those with z > 0 are behind you. */
const BARE_TREES = [
  [-20, -34, 23],
  [-31, -48, 27],
  [-14.5, -54, 17],
  [-44, -32, 25],
  [23, -40, 25],
  [16.5, -60, 19],
  [35, -36, 29],
  [48, -52, 23],
  [-24, 34, 23],
  [29, 40, 25],
] as const;
/** Tufts of grass near the way (each 18 triangles), and how bright the moonlit lane lies on the ground. */
const TUFTS = 3600;
const LANE_GAIN = 5;
/** The house you left, behind you (m). */
const HOUSE_Z = 46;
const HOUSE_W = 11;
const HOUSE_H = 4.8;
const HOUSE_ROOF = 3.2;

/** Lens: focus on her, focus on the near cloth (m), aperture. */
const FOCUS_FAR = 16;
const FOCUS_NEAR = 4;
const APERTURE = 3;
/** Sound, from ROOM_SOUNDS.md, placed against each other. */
const GAIN_WIND = 0.14;
const GAIN_GRASS = 0.1;
const GAIN_DRONE = 0.1;
const GAIN_FLAP_FAR = 0.11;

const TAU = Math.PI * 2;
const sat = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const gl = (x: number) => x.toFixed(4);

/** The ground's height at `z` (it runs straight across x). */
function groundY(z: number): number {
  const d = (z - CREST_Z) / CREST_WIDTH;
  return CREST_H * Math.exp(-d * d);
}
const innerX = (z: number) => INNER_X_FAR + SLOPE * (z - ROW_FAR_Z);

interface Row {
  side: number;
  offset: number;
  ax: number;
  az: number;
  dx: number;
  dz: number;
  ox: number;
  oz: number;
}

function rowOf(side: number, offset: number): Row {
  const unit = Math.hypot(1, SLOPE);
  const dx = (-side * SLOPE) / unit;
  const dz = -1 / unit;
  const farX = side * (INNER_X_FAR + offset);
  return { side, offset, ax: farX - dx * ROW_LENGTH, az: ROW_FAR_Z - dz * ROW_LENGTH, dx, dz, ox: side * -dz, oz: side * dx };
}

function wireY(row: Row, s: number): number {
  const span = Math.min(Math.floor(s / POST_STEP), ROW_SPANS - 1);
  const t = s / POST_STEP - span;
  const a = groundY(row.az + row.dz * span * POST_STEP) + LINE_H;
  const b = groundY(row.az + row.dz * (span + 1) * POST_STEP) + LINE_H;
  return a + (b - a) * t - 4 * SAG * t * (1 - t);
}

/** How the cloth hangs, toward and away from the row (m): long folds that deepen downward, and pleats fanning from the pegs. */
function clothFold(u: number, v: number, seed: number, length: number): number {
  const depth = 0.01 + 0.078 * Math.pow(v, 0.8);
  const a = Math.sin(TAU * (u * 2.2 + seed * 3.1) + v * 1.2);
  const b = Math.sin(TAU * (u * 4.3 + seed * 7.7) - v * 0.8);
  const c = Math.sin(TAU * (u * 8.1 + seed * 11.3) + v * 2.4);
  let f = (0.55 * a + 0.3 * b + 0.15 * c) * depth;
  for (const p of PEGS) {
    const du = (u - p) * SHEET_W;
    const dv = v * length + 0.02;
    const r2 = du * du + dv * dv;
    f += 0.012 * Math.sin(Math.atan2(du, dv) * 14 + seed * 9 + p * 13) * Math.exp(-r2 / 0.16);
  }
  return f;
}

function clothPoint(row: Row, sA: number, seed: number, length: number, u: number, v: number, out: Vector3): void {
  const s = sA + u * SHEET_W;
  const half = u < 0.5 ? (u - PEGS[0]) / (PEGS[1] - PEGS[0]) : (u - PEGS[1]) / (PEGS[2] - PEGS[1]);
  const swag = SWAG * Math.sin(Math.PI * sat(half)) * (1 - smooth(0, 0.24, v));
  const hem = 0.016 * Math.sin(TAU * (u * 3 + seed) + 1) * Math.pow(v, 10);
  const f = clothFold(u, v, seed, length);
  out.set(row.ax + row.dx * s + row.ox * f, wireY(row, s) - v * length - swag + hem, row.az + row.dz * s + row.oz * f);
}

/** Stops over 0..1: `share` of them crowded around `center`, where the face will need them. */
function stops(count: number, center: number, half: number, share: number): Float32Array {
  const out = new Float32Array(count + 1);
  if (share <= 0) {
    for (let i = 0; i <= count; i++) out[i] = i / count;
    return out;
  }
  const a = Math.max(0.02, center - half);
  const b = Math.min(0.98, center + half);
  const inside = Math.round(count * share);
  const rest = count - inside;
  const left = Math.max(1, Math.min(rest - 1, Math.round((rest * a) / (a + 1 - b))));
  const right = rest - left;
  for (let i = 0; i <= count; i++) {
    if (i <= left) out[i] = (i / left) * a;
    else if (i <= left + inside) out[i] = a + ((i - left) / inside) * (b - a);
    else out[i] = b + ((i - left - inside) / right) * (1 - b);
  }
  return out;
}

const gauss = (x: number, y: number) => Math.exp(-(x * x + y * y));
const smoothMax = (a: number, b: number, k: number) => {
  const t = sat(0.5 + (0.5 * (a - b)) / k);
  return a * t + b * (1 - t) + k * t * (1 - t);
};

/** Nail marks across the eyes, drawn as strokes and read back as a mask: the faces were scratched out of a photograph. */
function scratchMask(n: number): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, n, n);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  const random = randomFrom(57);
  const px = (p: number) => ((p * HEAD_HALF_W) / FACE_SPAN + 0.5) * n;
  const py = (q: number) => ((-q * HEAD_HALF_H) / FACE_SPAN + 0.5) * n;
  for (let i = 0; i < 44; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    let p = side * (0.05 + random() * 0.32);
    let q = 0.42 - random() * 0.2;
    g.lineWidth = 0.9 + random() * 1.5;
    g.beginPath();
    g.moveTo(px(p), py(q));
    const slope = -0.25 - random() * 0.5;
    for (let k = 0; k < 6; k++) {
      p += side * (0.09 + random() * 0.07);
      q += slope * 0.12 + (random() - 0.5) * 0.04;
      g.lineTo(px(p), py(q));
    }
    g.stroke();
  }
  return g.getImageData(0, 0, n, n).data;
}

/** A small blur of a square field, in place. */
function softened(field: Float32Array, n: number): void {
  const reach = 2;
  const copy = new Float32Array(field.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let axis = 0; axis < 2; axis++) {
      copy.set(field);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          let sum = 0;
          for (let d = -reach; d <= reach; d++) {
            const a = axis === 0 ? Math.max(0, Math.min(n - 1, i + d)) : i;
            const b = axis === 1 ? Math.max(0, Math.min(n - 1, j + d)) : j;
            sum += copy[b * n + a];
          }
          field[j * n + i] = sum / (2 * reach + 1);
        }
      }
    }
  }
}

/** The face, as cloth stretched over it: red holds the height (m), green what the open mouth changes, blue the hollows, alpha the mouth. */
function faceMap(): DataTexture {
  const n = FACE_PX;
  const data = new Uint16Array(n * n * 4);
  const scratch = scratchMask(n);
  const half = FACE_SPAN / 2;
  const heights = new Float32Array(n * n);
  const opens = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const X = ((i + 0.5) / n - 0.5) * FACE_SPAN;
      const down = ((j + 0.5) / n - 0.5) * FACE_SPAN;
      const p = X / HEAD_HALF_W;
      const q = -down / HEAD_HALF_H;
      const ap = Math.abs(p);
      const taper = 1 - 0.2 * (1 - smooth(-1, 0.1, q));
      const px = p / taper;
      const r2 = px * px + q * q;
      let h = r2 < 1 ? 0.19 * Math.pow(Math.sqrt(1 - r2), 0.72) : 0;
      h += 0.016 * gauss(p / 0.7, (q - 0.38) / 0.11);
      h -= 0.05 * gauss((ap - 0.42) / 0.25, (q - 0.15) / 0.15);
      h += 0.03 * gauss((ap - 0.66) / 0.24, (q + 0.1) / 0.2);
      h -= 0.024 * gauss((ap - 0.56) / 0.2, (q + 0.55) / 0.24);
      const along = sat((0.24 - q) / 0.46);
      const noseWidth = 0.1 + 0.075 * along;
      h += (0.014 + 0.085 * Math.pow(along, 1.5)) * Math.exp(-(p * p) / (noseWidth * noseWidth)) * smooth(-0.36, -0.2, q) * (1 - smooth(0.2, 0.32, q));
      h += 0.02 * gauss((ap - 0.2) / 0.085, (q + 0.25) / 0.07);
      h -= 0.02 * gauss((ap - 0.09) / 0.055, (q + 0.31) / 0.04);
      h += 0.012 * gauss(p / 0.4, (q + 0.6) / 0.11);
      h -= 0.012 * gauss(p / 0.42, (q + 0.6) / 0.028);
      h += 0.02 * gauss(p / 0.34, (q + 0.93) / 0.16);

      // the cloth tents out from the head, with the strain running away from it
      const R = Math.sqrt(r2);
      const tent = 0.12 * Math.exp(-1.75 * Math.max(R - 0.85, 0));
      h = smoothMax(h, tent, 0.03);
      const angle = Math.atan2(q, px);
      let strain = 0.55 * Math.sin(angle * 6 + 0.7) + 0.3 * Math.sin(angle * 11 + 2.3) + 0.15 * Math.sin(angle * 19 + 1.1);
      strain = Math.sign(strain) * Math.pow(Math.abs(strain), 1.4);
      h += 0.024 * strain * gauss((R - 1.55) / 0.72, 0) * smooth(0.95, 1.25, R);
      // creases pulled across it from the line above, and the cloth falling away below the chin
      const across = p * 0.55 + q * 0.83;
      const athwart = -p * 0.71 + q * 0.7;
      h += (0.008 * gauss((across - 0.35) / 0.09, 0) + 0.006 * gauss((across + 0.62) / 0.07, 0) + 0.006 * gauss((athwart - 0.7) / 0.08, 0)) * (1 - smooth(2.2, 3.4, R));
      h += 0.018 * Math.sin(p * 3.4 + 1.2) * (1 - smooth(-2.4, -1.3, q)) * gauss(p / 2.4, 0);

      // the open mouth is too big and the jaw hangs far below where a chin should be
      const my = (q + 1.0) / 0.74;
      const mx = p / 0.5;
      const m = Math.sqrt(mx * mx + my * my);
      const hole = 1 - smooth(0.72, 1.02, m);
      let open = -0.2 * hole + 0.028 * gauss((m - 1.08) / 0.1, 0) + 0.15 * gauss(p / 0.7, (q + 1.85) / 0.36) + 0.09 * gauss(p / 0.9, (q + 1.25) / 0.6) * (1 - hole);
      open = Math.max(open, 0.012 - h);

      let hollow = 0.9 * gauss((ap - 0.42) / 0.23, (q - 0.15) / 0.12);
      hollow += 0.55 * gauss((ap - 0.09) / 0.05, (q + 0.31) / 0.035);
      hollow += 0.35 * gauss((q + 0.24) / 0.05, (ap - 0.28) / 0.12);
      const nail = scratch[(j * n + i) * 4] / 255;
      hollow = Math.max(sat(hollow), nail * 0.85);
      h -= nail * 0.005;

      const fade = 1 - smooth(0.72, 0.98, Math.hypot(X, down) / half);
      const k = j * n + i;
      heights[k] = Math.max(h * fade, 0);
      opens[k] = open * fade;
      data[k * 4 + 2] = DataUtils.toHalfFloat(hollow);
      data[k * 4 + 3] = DataUtils.toHalfFloat(hole);
    }
  }
  // cloth does not follow a face that closely
  softened(heights, n);
  softened(opens, n);
  for (let k = 0; k < n * n; k++) {
    data[k * 4] = DataUtils.toHalfFloat(heights[k]);
    data[k * 4 + 1] = DataUtils.toHalfFloat(opens[k]);
  }
  const texture = new DataTexture(data, n, n, RGBAFormat, HalfFloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Years of washing: yellowing, tide marks, mildew. A multiplier on what the cloth shows and lets through. */
function stainTexture(): CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const random = randomFrom(83);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 46; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = 30 + random() * 130;
    const a = g.createRadialGradient(x, y, r * 0.2, x, y, r);
    a.addColorStop(0, `rgba(176,160,120,${(0.05 + random() * 0.11).toFixed(3)})`);
    a.addColorStop(1, 'rgba(176,160,120,0)');
    g.fillStyle = a;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 12; i++) {
    g.strokeStyle = `rgba(128,112,84,${(0.06 + random() * 0.12).toFixed(3)})`;
    g.lineWidth = 1 + random() * 5;
    g.beginPath();
    g.ellipse(random() * size, random() * size, 20 + random() * 70, 12 + random() * 60, random() * 3, 0.2, 5 + random());
    g.stroke();
  }
  for (let i = 0; i < 520; i++) {
    const cluster = i % 13;
    const x = (cluster * 137 + (random() - 0.5) * 90 + size) % size;
    const y = (cluster * 251 + (random() - 0.5) * 90 + size) % size;
    g.fillStyle = `rgba(52,58,44,${(0.08 + random() * 0.26).toFixed(3)})`;
    g.fillRect(x, y, 1 + random() * 2.2, 1 + random() * 2.2);
  }
  const texture = new CanvasTexture(c);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

function moonTexture(): CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const random = randomFrom(11);
  const mid = size / 2;
  const R = mid - 3;
  const disc = g.createRadialGradient(mid * 0.94, mid * 0.92, R * 0.1, mid, mid, R);
  disc.addColorStop(0, '#f6efdc');
  disc.addColorStop(0.72, '#ece2ca');
  disc.addColorStop(1, '#c5baa0');
  g.fillStyle = disc;
  g.beginPath();
  g.arc(mid, mid, R, 0, TAU);
  g.fill();
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 52; i++) {
    const a = random() * TAU;
    const d = R * Math.sqrt(random()) * 0.9;
    const x = mid + Math.cos(a) * d;
    const y = mid + Math.sin(a) * d - R * 0.14;
    const r = 16 + random() * 86;
    const blot = g.createRadialGradient(x, y, r * 0.15, x, y, r);
    blot.addColorStop(0, `rgba(84,90,76,${(0.12 + random() * 0.27).toFixed(3)})`);
    blot.addColorStop(1, 'rgba(84,90,76,0)');
    g.fillStyle = blot;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 140; i++) {
    const a = random() * TAU;
    const d = R * Math.sqrt(random());
    g.strokeStyle = `rgba(70,70,58,${(0.1 + random() * 0.22).toFixed(3)})`;
    g.lineWidth = 0.6 + random();
    g.beginPath();
    g.arc(mid + Math.cos(a) * d, mid + Math.sin(a) * d, 1 + random() * 7, 0, TAU);
    g.stroke();
  }
  for (let i = 0; i < 3; i++) {
    const y = mid * (0.42 + i * 0.27 + random() * 0.08);
    const x = mid + (random() - 0.5) * R;
    g.save();
    g.translate(x, y);
    g.scale(1, 0.03 + random() * 0.03);
    const bar = g.createRadialGradient(0, 0, 0, 0, 0, R * (0.7 + random() * 0.6));
    bar.addColorStop(0, `rgba(34,48,46,${(0.16 + random() * 0.2).toFixed(3)})`);
    bar.addColorStop(1, 'rgba(34,48,46,0)');
    g.fillStyle = bar;
    g.fillRect(-R * 2, -R * 2, R * 4, R * 4);
    g.restore();
  }
  const low = g.createLinearGradient(0, mid * 1.2, 0, size);
  low.addColorStop(0, 'rgba(56,70,62,0)');
  low.addColorStop(1, 'rgba(56,70,62,0.5)');
  g.fillStyle = low;
  g.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A bare tree with its fine crown, on nothing. */
function treeTexture(): CanvasTexture {
  const w = 512;
  const h = 1024;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const random = randomFrom(71);
  g.strokeStyle = '#ffffff';
  g.lineCap = 'round';
  const branch = (x: number, y: number, angle: number, length: number, width: number, depth: number): void => {
    const nx = x + Math.sin(angle) * length;
    const ny = y - Math.cos(angle) * length;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + (random() - 0.5) * length * 0.35, (y + ny) / 2, nx, ny);
    g.stroke();
    if (depth <= 0) return;
    const kids = depth > 7 ? 2 : random() < 0.4 ? 3 : 2;
    for (let k = 0; k < kids; k++) branch(nx, ny, angle * 0.82 + (random() - 0.5) * 1.15, length * (0.66 + random() * 0.18), width * 0.66, depth - 1);
  };
  branch(w / 2, h, 0, h * 0.2, 17, 9);
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** The kitchen window: warm, and someone standing in it who has no head. */
function windowTexture(): CanvasTexture {
  const w = 64;
  const h = 84;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffbf6e';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#100c08';
  g.fillRect(w * 0.47, 0, w * 0.06, h);
  g.fillRect(0, h * 0.42, w, h * 0.05);
  g.fillRect(w * 0.36, h * 0.48, w * 0.28, h * 0.52);
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Soft low cloud, fading to nothing at every edge, for banks of mist. */
function mistTexture(): CanvasTexture {
  const w = 256;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const random = randomFrom(29);
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const x = random() * w;
    const y = h * (0.35 + random() * 0.55);
    const r = 14 + random() * 42;
    const blot = g.createRadialGradient(x, y, 0, x, y, r);
    blot.addColorStop(0, `rgba(255,255,255,${(0.05 + random() * 0.12).toFixed(3)})`);
    blot.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = blot;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const fadeY = g.createLinearGradient(0, 0, 0, h);
  fadeY.addColorStop(0, 'rgba(0,0,0,1)');
  fadeY.addColorStop(0.55, 'rgba(0,0,0,0)');
  fadeY.addColorStop(0.88, 'rgba(0,0,0,0)');
  fadeY.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = fadeY;
  g.fillRect(0, 0, w, h);
  const fadeX = g.createLinearGradient(0, 0, w, 0);
  fadeX.addColorStop(0, 'rgba(0,0,0,1)');
  fadeX.addColorStop(0.16, 'rgba(0,0,0,0)');
  fadeX.addColorStop(0.84, 'rgba(0,0,0,0)');
  fadeX.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = fadeX;
  g.fillRect(0, 0, w, h);
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  return texture;
}

/** Everything in the sheets answers one clock: nothing here is a sheet's own wind. */
const SHEET_VERT_HEAD = /* glsl */ `
attribute vec4 aCloth;
attribute vec4 aOut;
attribute vec4 aFace;
uniform float uSeconds;
uniform float uLift;
uniform float uRipple;
uniform float uWind;
uniform float uFlash;
uniform sampler2D uFace;
varying vec2 vFaceUv;
varying vec2 vClothUv;
varying vec4 vCloth;
varying float vPress;
varying float vOpen;
varying float vFaceScale;
varying float vClothFar;
`;

const SHEET_VERT_NORMAL = /* glsl */ `
float clothW = aCloth.y;
float clothL = aCloth.w;
float clothTh = abs(uLift) < 0.001 ? 0.001 : uLift;
float clothA = clothTh * clothW;
float cCos = cos(clothA);
float cSin = sin(clothA);
vec3 clothUp = vec3(0.0, 1.0, 0.0);
vec3 clothAxis = cross(aOut.xyz, clothUp);
vec3 clothAlong = aOut.w * cross(clothUp, aOut.xyz);
float cW2 = clothW * clothW;
float cP1 = aCloth.x * 8.0 + clothW * 3.0 - uWind;
float cP2 = aCloth.x * 17.0 - clothW * 5.0 + uWind * 1.37;
float cWave = sin(cP1) + 0.35 * sin(cP2);
float cRipple = uRipple * cW2 * cWave;
float cRu = uRipple * cW2 * (8.0 * cos(cP1) + 5.95 * cos(cP2)) / ${gl(SHEET_W)};
float cRv = uRipple * (2.0 * clothW * cWave + cW2 * (3.0 * cos(cP1) - 1.75 * cos(cP2))) / clothL;
vec3 clothN = objectNormal + clothAlong * cRu - clothUp * cRv;
objectNormal = clothN * cCos + cross(clothAxis, clothN) * cSin + clothAxis * dot(clothAxis, clothN) * (1.0 - cCos);
`;

const SHEET_VERT_MOVE = /* glsl */ `
transformed += aOut.xyz * ((clothL / clothTh) * (1.0 - cCos) + cRipple) + clothUp * (clothW * clothL - (clothL / clothTh) * cSin);
float cSeed = aCloth.z;
float cT0 = ${gl(FACES_AT)} + fract(cSeed * 7.31) * ${gl(FACE_STAGGER)};
float cRise = smoothstep(cT0, cT0 + ${gl(FACE_RISE)}, uSeconds);
float cT1 = ${gl(FACE_GO_FROM)} + fract(cSeed * 3.77) * ${gl(FACE_GO_SPREAD)};
float cGo = smoothstep(cT1, cT1 + ${gl(FACE_GO)}, uSeconds);
float cSurge = 1.0 + 0.1 * sin((uSeconds - cT0) * 4.1 + cSeed * 6.0) * exp(-max(uSeconds - cT0, 0.0) * 0.9);
vPress = max(cRise * (1.0 - cGo) * cSurge, uFlash);
vOpen = max(smoothstep(cT0 + 0.04, cT0 + 0.75, uSeconds) * (1.0 - cGo * 0.7), uFlash);
vec2 cFp = vec2(aCloth.x * ${gl(SHEET_W)}, clothW * clothL) - aFace.xy;
float cFc = cos(aFace.z);
float cFs = sin(aFace.z);
vec2 cFq = vec2(cFc * cFp.x - cFs * cFp.y, cFs * cFp.x + cFc * cFp.y);
cFq.x *= sign(aFace.w);
vFaceScale = abs(aFace.w);
vFaceUv = cFq / (${gl(FACE_SPAN)} * vFaceScale) + 0.5;
if (vPress > 0.001) {
  vec4 cFm = texture2D(uFace, vFaceUv);
  transformed -= aOut.xyz * (cFm.r + vOpen * cFm.g) * vPress * vFaceScale;
}
vCloth = vec4(aCloth.x, clothW, cFp.x, cFp.y);
vClothFar = 1.0 - smoothstep(-20.5, -6.0, position.z);
vClothUv = vec2(aCloth.x * 0.83 + cSeed * 5.1, clothW * 0.91 + cSeed * 2.7);
`;

const SHEET_FRAG_HEAD = /* glsl */ `
uniform sampler2D uFace;
uniform sampler2D uStain;
uniform vec3 uMoonDir;
uniform vec3 uThroughColor;
uniform vec3 uThroughNear;
uniform vec3 uFaceColor;
uniform float uPresence;
uniform float uFlash;
varying vec2 vFaceUv;
varying vec2 vClothUv;
varying vec4 vCloth;
varying float vPress;
varying float vOpen;
varying float vFaceScale;
varying float vClothFar;
float clothRelief(vec2 p) {
  vec4 m = texture2D(uFace, p);
  return (m.r + vOpen * m.g) * vPress * vFaceScale;
}
vec3 clothBump(vec3 n, vec3 pos, float side) {
  vec2 dx = dFdx(vFaceUv);
  vec2 dy = dFdy(vFaceUv);
  float h = clothRelief(vFaceUv);
  float hx = clothRelief(vFaceUv + dx) - h;
  float hy = clothRelief(vFaceUv + dy) - h;
  vec3 sx = dFdx(pos);
  vec3 sy = dFdy(pos);
  vec3 r1 = cross(sy, n);
  vec3 r2 = cross(n, sx);
  float det = dot(sx, r1) * side;
  return normalize(abs(det) * n - sign(det) * (hx * r1 + hy * r2));
}
`;

const SHEET_FRAG_STAIN = /* glsl */ `
vec3 clothStain = texture2D(uStain, vClothUv).rgb;
diffuseColor.rgb *= clothStain;
`;

const SHEET_FRAG_GLOW = /* glsl */ `
vec3 cV = normalize(vViewPosition);
vec3 cMoon = normalize((viewMatrix * vec4(uMoonDir, 0.0)).xyz);
if (vPress > 0.003) normal = clothBump(normal, -vViewPosition, faceDirection);
float cFwd = pow(max(dot(-cV, cMoon), 0.0), ${gl(THROUGH_POW)});
float cFold = smoothstep(-0.4, 0.55, dot(normal, cMoon));
float cFar = vClothFar * vClothFar;
vec3 cGlow = mix(uThroughNear, uThroughColor, vClothFar) * (${gl(THROUGH_BASE)} + ${gl(THROUGH_GAIN)} * cFwd * (0.13 + 0.87 * cFar)) * mix(0.22, 1.7, cFold) * clothStain;
float cTop = 1.0 - smoothstep(${gl(TOP_BAND)}, ${gl(TOP_BAND + 0.008)}, vCloth.y);
float cHem = smoothstep(0.972, 0.98, vCloth.y) + (1.0 - smoothstep(0.012, 0.018, vCloth.x)) + smoothstep(0.982, 0.988, vCloth.x);
cGlow *= (1.0 - 0.36 * cTop) * (1.0 - 0.3 * saturate(cHem)) * mix(1.0, 0.62, smoothstep(0.82, 1.0, vCloth.y));
float cHead = 1.0 - smoothstep(0.72, 1.06, length(vCloth.zw / vec2(0.19, 0.27)));
float cBody = (1.0 - smoothstep(0.16, 0.42, abs(vCloth.z))) * smoothstep(0.24, 0.5, vCloth.w);
cGlow *= 1.0 - uPresence * max(cHead, cBody * 0.85);
vec3 cFillDir = normalize(cV + vec3(0.0, 0.62, 0.0));
float cFill = pow(max(dot(normal, cFillDir), 0.0), 1.7);
cGlow += uFaceColor * ${gl(FLASH_FILL)} * cFill * clothStain * uFlash / (1.0 + dot(vViewPosition, vViewPosition) / 60.0);
if (vPress > 0.003) {
  vec4 cFm = texture2D(uFace, vFaceUv);
  float cLifted = smoothstep(0.015, 0.15, cFm.r + vOpen * cFm.g);
  float cMouth = cFm.a * vOpen;
  float cPressed = saturate(vPress);
  float cDark = 1.0 - cPressed * cMouth;
  cGlow *= 1.0 - cPressed * cLifted * 0.55;
  cGlow += uFaceColor * ${gl(FACE_FILL)} * cPressed * cLifted * cFill;
  cGlow *= (1.0 - cPressed * cFm.b * 0.9) * cDark * cDark;
  diffuseColor.rgb *= (1.0 - cPressed * cFm.b * 0.75) * cDark;
}
totalEmissiveRadiance += cGlow;
`;

/** Sheets nearer the moon stand in the light of those behind them. */
const SHEET_FRAG_DIM = /* glsl */ `
float cShade = mix(0.12, 1.0, vClothFar * vClothFar);
reflectedLight.directDiffuse *= cShade;
reflectedLight.directSpecular *= cShade;
`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uMoon;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  vec3 col = mix(vec3(0.03, 0.075, 0.07), vec3(0.0045, 0.0145, 0.02), pow(up, 0.46));
  float a = acos(clamp(dot(d, uMoon), -1.0, 1.0));
  vec3 halo = vec3(0.74, 0.86, 0.76);
  col += halo * (0.1 * exp(-a * a / 0.3) + 0.5 * exp(-a / 0.12));
  vec2 q = d.xz / (up + 0.18);
  float cloud = smoothstep(0.52, 0.8, fbm(q * vec2(0.5, 1.9) + vec2(3.1, 0.4)));
  col = mix(col, col * 0.62 + halo * 0.32 * exp(-a / 0.4), cloud * 0.85);
  vec2 cell = floor(d.xz / (up + 0.3) * 170.0);
  float star = step(0.9972, hash(cell)) * pow(hash(cell + 3.0), 6.0);
  col += vec3(0.8, 0.9, 0.85) * star * smoothstep(0.08, 0.4, up) * (1.0 - cloud);
  gl_FragColor = vec4(col, 1.0);
}
`;

const OPEN_VIEW: RoomControl = { look: true, scroll: true };
const HELD_VIEW: RoomControl = { look: false, scroll: true };

/**
 * A dark field at night: rows of white sheets on washing lines, perfectly still, and one low moon behind them.
 * Far off, at the end of a row, a woman with white hair and a basket has her back to you. The wind comes once and
 * lifts every sheet at the same moment; what stands behind them stands there. Then, on every sheet, a face.
 */
export default class Washing extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x0f1c1a, density: 0.0125 },
    env: 'evening',
    envIntensity: 0.1,
    sky: 0,
    grade: { exposure: 1.14, saturation: 0.76, warmth: 0.015, tint: -0.02, flare: 0.004 },
  };
  film = { bloom: 0.5, bloomFrom: 0.95, grain: 0.42, scratches: 0.03, flicker: 0.025, weave: 0.0005 };
  focus = FOCUS_FAR;
  aperture = APERTURE;
  drift = 0.55;

  private readonly u;
  private readonly gust = { value: 0 };
  private readonly clock = { value: 0 };
  private readonly turners: { bone: Bone; rest: Quaternion; axis: Vector3; share: number }[] = [];
  private readonly turnQ = new Quaternion();
  private readonly hairPivot = new Group();
  private readonly moteTime;
  private readonly mistMap;
  private readonly flashLamp: DreamLight;
  private readonly faceLamp: DreamLight;
  private wind: RoomVoice | null = null;
  private grass: RoomVoice | null = null;
  private drone: RoomVoice | null = null;
  private flap: RoomVoice | null = null;
  private flapThick: RoomVoice | null = null;
  private howl: RoomVoice | null = null;
  private pack: RoomVoice | null = null;
  private strain: RoomVoice | null = null;

  constructor(ctx: RoomContext) {
    super(ctx);
    const end = this.seconds;
    const pose = (at: number, x: number, z: number, yaw: number, pitch: number, fov: number): RoomKey => ({ t: at / end, at: [x, groundY(z) + EYE, z], yaw, pitch, fov });
    this.keys = REDUCED_MOTION
      ? [pose(0, 0, 1, 0, 3.4, 46), pose(9, -0.2, -3.6, -1, 2.6, 44), pose(12.5, -0.05, -5, -2.2, 2.2, 36), pose(end, 0, -5.5, -2.2, 2.2, 35)]
      : [
          pose(0, 0, 1, 0, 3.4, 46),
          pose(WIND_AT, -0.08, -2.4, 0.6, 3.2, 46),
          pose(FACES_AT, -0.24, -4.4, -1.5, 2.4, 43),
          pose(10.6, -0.12, -5.5, -2, 2.4, 41),
          pose(SHUTTER_AT - 0.1, 0.02, -6.8, -3.1, 2.7, 21),
          pose(CUT_AT, 0.06, -7.5, -3.1, 2.8, 19.5),
          pose(end, 0.06, -7.6, -3.1, 2.8, 19.5),
        ];

    const moonDir = new Vector3(0, Math.sin(MOON_ALTITUDE), -Math.cos(MOON_ALTITUDE)).normalize();
    this.u = {
      uSeconds: { value: 0 },
      uLift: { value: 0 },
      uRipple: { value: 0 },
      uWind: this.clock,
      uFlash: { value: 0 },
      uPresence: { value: PRESENCE_CALM },
      uFace: { value: faceMap() },
      uStain: { value: stainTexture() },
      uMoonDir: { value: moonDir },
      uThroughColor: { value: new Color(0xd8d8bf) },
      uThroughNear: { value: new Color(0x6f8f8a) },
      uFaceColor: { value: new Color(0xe9e2d0) },
    };

    this.spots = [this.spot(MOON_LIGHT_AT, MOON_LIGHT_TO, MOON_LIGHT_COLOR, MOON_LIGHT, 22, 0.75), null, null];

    const random = randomFrom(4177);
    const rows = [rowOf(1, 0), rowOf(-1, 0), rowOf(1, OUTER_OFFSET), rowOf(-1, OUTER_OFFSET)];
    this.buildSky(moonDir);
    this.buildGround();
    this.buildGrass(random);
    this.buildSheets(rows, random);
    this.buildLines(rows);
    this.buildPeople(rows, random);
    this.buildHouse();
    this.buildTreeline(random);
    this.buildBareTrees();

    this.mistMap = mistTexture();
    this.buildMist();
    this.buildWoman();
    this.buildShadow();
    this.moteTime = this.build.motes(160, { x: [-3.2, 3.2], y: [0.2, 3.2], z: [-21, 3] }, this.root, { size: 0.007, strength: 0.34 }).time;

    const wy = groundY(WOMAN_Z);
    this.light([WOMAN_X - 0.3, wy + 3, WOMAN_Z + 3.4], 0x9fb4b0, 0.7, 7);
    this.flashLamp = this.light([WOMAN_X - 0.55, wy + 1.6, WOMAN_Z + 2.6], 0xfff4e8, 0, 6);
    this.faceLamp = this.light([WOMAN_X - 1.15, wy + 1.62, WOMAN_Z + 0.55], 0xbfcfc4, 0, 3.2);

    this.placeSound();
  }

  dispose(): void {
    super.dispose();
    this.u.uFace.value.dispose();
    this.u.uStain.value.dispose();
  }

  private placeSound(): void {
    const s = this.sound;
    this.beat(0, () => {
      this.wind = s.bed('rooms/night_wind_far.mp3', { gain: GAIN_WIND, lowpass: 1200, fade: 1 });
      this.grass = s.bed('rooms/wind_grass.mp3', { gain: GAIN_GRASS, fade: 2 });
      this.drone = s.bed('rooms/dream_drone_low.mp3', { gain: GAIN_DRONE, fade: 2 });
      // somewhere behind you cloth is moving; nothing in front of you is
      this.flap = s.bed('rooms/cloth_flap_gentle.mp3', { gain: GAIN_FLAP_FAR, lowpass: 2200, fade: 3 });
    });
    this.beat(1.2, () => s.play('rooms/peg_creak_2.mp3', { gain: 0.22, reverb: 0.2, pan: 0.35 }));
    this.beat(1.6, () => {
      this.howl = s.play('rooms/dogs_howl_far.mp3', { gain: 0.3, reverb: 0.3 });
    });
    this.beat(4.7, () => s.play('rooms/peg_creak_1.mp3', { gain: 0.25, reverb: 0.2, pan: -0.5 }));
    this.beat(5.3, () => {
      this.pack = s.bed('rooms/dogs_pack_far.mp3', { gain: 0.18, lowpass: 2500, fade: 1.5 });
    });
    this.beat(WIND_AT - 0.15, () => {
      s.play('rooms/sheets_lift.mp3', { gain: 0.5 });
      this.wind?.gain(0.26, 0.5);
      this.grass?.gain(0.2, 0.5);
      this.flap?.gain(0, 0.4);
      this.flapThick = s.bed('rooms/cloth_flap_thick.mp3', { gain: 0.25, fade: 0.4 });
    });
    this.beat(LIFT_FALL_FROM + 0.15, () => s.play('rooms/cloth_flap_1.mp3', { gain: 0.34, pan: 0.3 }));
    this.beat(LIFT_FALL_FROM + LIFT_FALL - 0.1, () => s.play('rooms/cloth_flap_2.mp3', { gain: 0.4, pan: -0.2 }));
    this.beat(DOGS_STOP - 0.25, () => {
      for (const bed of [this.wind, this.grass, this.drone, this.flapThick]) bed?.gain(0, 0.2);
    });
    this.beat(DOGS_STOP, () => {
      this.howl?.stop(0.02);
      this.pack?.stop(0.02);
    });
    this.beat(FACES_AT, () => {
      this.strain = s.play('rooms/faces_press.mp3', { gain: 0.5 });
    });
    this.beat(FACE_GO_FROM + 0.6, () => this.strain?.gain(0, 0.8));
    this.beat(11.35, () => s.play('rooms/peg_creak_1.mp3', { gain: 0.25, reverb: 0.2, pan: 0.4 }));
    this.beat(TURN_FROM + 0.1, () => s.play('rooms/wood_creak_small_2.mp3', { gain: 0.2, reverb: 0.2, pan: 0.05 }));
    this.beat(SHUTTER_AT, () => this.shutter());
    this.beat(CUT_AT, () => s.stopAll(0.02));
  }

  private buildSky(moonDir: Vector3): void {
    const sky = new Mesh(
      new SphereGeometry(SKY_RADIUS, 40, 24),
      new ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: { uMoon: { value: moonDir } }, side: BackSide }),
    );
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.root.add(sky);

    const R = MOON_DISTANCE * Math.tan(MOON_RADIUS);
    const moon = new Mesh(
      new PlaneGeometry(R * 2, R * 2),
      new MeshBasicMaterial({ map: moonTexture(), transparent: true, depthWrite: false, fog: false, color: new Color(MOON_GLOW, MOON_GLOW * 0.96, MOON_GLOW * 0.86) }),
    );
    moon.position.set(0, EYE + MOON_DISTANCE * Math.tan(MOON_ALTITUDE), -MOON_DISTANCE);
    moon.renderOrder = -9;
    this.root.add(moon);
  }

  private buildGround(): void {
    const spaced = (from: number, to: number, step: number): number[] => {
      const out: number[] = [];
      for (let v = from; v <= to + 1e-6; v += step) out.push(v);
      for (let d = step * 1.35, v = to + d; ; d *= 1.35, v += d) {
        out.push(Math.min(v, FIELD_REACH));
        if (v >= FIELD_REACH) break;
      }
      for (let d = step * 1.35, v = from - d; ; d *= 1.35, v -= d) {
        out.unshift(Math.max(v, -FIELD_REACH));
        if (v <= -FIELD_REACH) break;
      }
      return out;
    };
    const xs = spaced(-9, 9, 0.35);
    const zs = spaced(-30, 18, 0.6);
    const nx = xs.length;
    const nz = zs.length;
    const positions = new Float32Array(nx * nz * 3);
    const uvs = new Float32Array(nx * nz * 2);
    const lit = new Float32Array(nx * nz * 2);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = xs[i];
        const z = zs[j];
        const k = j * nx + i;
        positions[k * 3] = x;
        positions[k * 3 + 1] = groundY(z);
        positions[k * 3 + 2] = z;
        uvs[k * 2] = x;
        uvs[k * 2 + 1] = z;
        const inRows = z < ROW_NEAR_Z + 0.4 && z > ROW_FAR_Z - 0.4 ? 1 : 0;
        const d = Math.abs(Math.abs(x) - innerX(z));
        const feet = gauss((x - WOMAN_X) / 0.6, (z - WOMAN_Z) / 0.6) + gauss((x - WOMAN_X + 0.55) / 0.45, (z - WOMAN_Z - 0.1) / 0.45);
        const shade = (1 - inRows * 0.62 * gauss(d / 0.55, 0)) * (1 + 0.3 * gauss(x / 1.2, 0)) * (1 - 0.7 * Math.min(1, feet));
        lit[k * 2] = shade;
        lit[k * 2 + 1] = LANE_GAIN * gauss(x / 1.15, 0) * smooth(-22.2, -17, z) * (1 - smooth(-3, 5, z)) * (0.78 + 0.22 * Math.sin(x * 2.3 + z * 0.7) * Math.sin(z * 1.9 - x));
      }
    }
    const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let w = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        index[w++] = a;
        index[w++] = c;
        index[w++] = b;
        index[w++] = b;
        index[w++] = c;
        index[w++] = d;
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setAttribute('uv', new BufferAttribute(uvs, 2));
    g.setAttribute('aGround', new BufferAttribute(lit, 2));
    g.setIndex(new BufferAttribute(index, 1));
    g.computeVertexNormals();
    const m = this.kit.surface('grass_meadow', 2, { color: new Color(0x42574b), roughness: 0.95 }).clone();
    m.normalScale.setScalar(0.5);
    m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aGround;\nvarying vec2 vGround;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = aGround;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= vGround.x;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGround.y;');
    };
    m.customProgramCacheKey = () => 'washing-ground';
    const ground = new Mesh(g, m);
    ground.receiveShadow = true;
    ground.frustumCulled = false;
    this.root.add(ground);
  }

  private buildGrass(random: () => number): void {
    const positions: number[] = [];
    const colors: number[] = [];
    const index: number[] = [];
    const root = new Color(0.006, 0.011, 0.01);
    const tip = new Color(0.058, 0.07, 0.048);
    const blades = 6;
    for (let i = 0; i < blades; i++) {
      const a = (i / blades) * TAU + random() * 0.8;
      const h = 0.06 + random() * 0.11;
      const lean = 0.03 + random() * 0.14;
      const w = 0.0036 + random() * 0.003;
      const cx = Math.cos(a) * 0.035 * random();
      const cz = Math.sin(a) * 0.035 * random();
      const sx = -Math.sin(a) * w;
      const sz = Math.cos(a) * w;
      const lx = Math.cos(a) * lean;
      const lz = Math.sin(a) * lean;
      const base = positions.length / 3;
      positions.push(cx - sx, 0, cz - sz, cx + sx, 0, cz + sz);
      positions.push(cx - sx * 0.8 + lx * 0.35, h * 0.55, cz - sz * 0.8 + lz * 0.35, cx + sx * 0.8 + lx * 0.35, h * 0.55, cz + sz * 0.8 + lz * 0.35);
      positions.push(cx + lx, h, cz + lz);
      for (const t of [0, 0, 0.55, 0.55, 1]) colors.push(root.r + (tip.r - root.r) * t, root.g + (tip.g - root.g) * t, root.b + (tip.b - root.b) * t);
      index.push(base, base + 1, base + 3, base, base + 3, base + 2, base + 2, base + 3, base + 4);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    g.setIndex(index);
    const m = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
    const gust = this.gust;
    const clock = this.clock;
    m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uGust = gust;
      shader.uniforms.uWind = clock;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uGust;\nuniform float uWind;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed.x += uGust * position.y * position.y * 4.0 * sin(uWind * 1.3 + instanceMatrix[3][0] * 2.0 + instanceMatrix[3][2] * 1.7);`,
      );
    };
    m.customProgramCacheKey = () => 'washing-grass';
    const tufts = new InstancedMesh(g, m, TUFTS);
    const dummy = new Object3D();
    const tint = new Color();
    for (let i = 0; i < TUFTS; i++) {
      const way = i % 10 < 7;
      const z = 4 - random() * 27;
      const halfWidth = way ? innerX(z) + 0.2 : 7;
      const x = (random() * 2 - 1) * halfWidth;
      dummy.position.set(x, groundY(z), z);
      dummy.rotation.y = random() * TAU;
      dummy.scale.setScalar((0.55 + random()) * (z < -8 ? 0.72 : 1));
      dummy.updateMatrix();
      tufts.setMatrixAt(i, dummy.matrix);
      // black against the moon at the crest; and her shadow lies on them, all the way to you
      const onShadow = z > WOMAN_Z && z < SHADOW_END ? gauss((x - WOMAN_X - SHADOW_DRIFT * (z - WOMAN_Z)) / (0.22 - 0.1 * sat((z - WOMAN_Z) / 20)), 0) : 0;
      const bright = (0.42 + 0.6 * gauss(x / 0.9, 0)) * (0.12 + 0.88 * smooth(-21.5, -11, z)) * (0.75 + random() * 0.5) * (1 - 0.88 * onShadow);
      tufts.setColorAt(i, tint.setRGB(bright, bright, bright));
    }
    tufts.frustumCulled = false;
    this.root.add(tufts);
  }

  private buildSheets(rows: readonly Row[], random: () => number): void {
    const pieces: { row: Row; sA: number; seed: number; length: number; cols: number; lines: number }[] = [];
    for (const row of rows) {
      for (let i = 0; i < SHEETS_PER_SPAN * ROW_SPANS; i++) {
        const sA = i * PITCH + SHEET_GAP / 2;
        const z = row.az + row.dz * (sA + SHEET_W / 2);
        const res = row.offset > 0 ? RES_OUTER : z > NEAR_SHEETS_Z[0] && z < NEAR_SHEETS_Z[1] ? RES_NEAR : RES_FAR;
        pieces.push({ row, sA, seed: random(), length: SHEET_L * (0.97 + random() * 0.06), cols: res[0], lines: res[1] });
      }
    }
    let vertices = 0;
    let indices = 0;
    for (const p of pieces) {
      vertices += (p.cols + 1) * (p.lines + 1);
      indices += p.cols * p.lines * 6;
    }
    const position = new Float32Array(vertices * 3);
    const normal = new Float32Array(vertices * 3);
    const uv = new Float32Array(vertices * 2);
    const aCloth = new Float32Array(vertices * 4);
    const aOut = new Float32Array(vertices * 4);
    const aFace = new Float32Array(vertices * 4);
    const index = new Uint32Array(indices);

    const at = new Vector3();
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const d = new Vector3();
    const n = new Vector3();
    let v = 0;
    let w = 0;
    for (const p of pieces) {
      const { row, sA, seed, length, cols, lines } = p;
      const faceU = 0.5 + (random() - 0.5) * 0.24;
      const center = sA + faceU * SHEET_W;
      const top = wireY(row, center);
      const faceDown = top - (groundY(row.az + row.dz * center) + FACE_HEIGHT) + (random() - 0.5) * 0.18;
      const tilt = (random() - 0.5) * 0.62;
      const scale = (0.96 + random() * 0.16) * (random() < 0.5 ? -1 : 1);
      const fine = cols === RES_NEAR[0];
      const us = stops(cols, faceU, 0.17, fine ? 0.62 : 0);
      const vs = stops(lines, faceDown / length + 0.05, 0.25, fine ? 0.66 : 0);
      // which way u runs against the row's own "along", for the wave's normals
      const orient = row.side;
      const base = v;
      for (let j = 0; j <= lines; j++) {
        for (let i = 0; i <= cols; i++) {
          const pu = us[i];
          const pv = vs[j];
          clothPoint(row, sA, seed, length, pu, pv, at);
          const e = 0.003;
          clothPoint(row, sA, seed, length, pu + e, pv, a);
          clothPoint(row, sA, seed, length, pu - e, pv, b);
          clothPoint(row, sA, seed, length, pu, pv + e, c);
          clothPoint(row, sA, seed, length, pu, pv - e, d);
          n.copy(a.sub(b)).cross(c.sub(d)).normalize();
          if (n.x * row.ox + n.z * row.oz > 0) n.negate();
          at.toArray(position, v * 3);
          n.toArray(normal, v * 3);
          uv[v * 2] = pu * SHEET_W;
          uv[v * 2 + 1] = pv * length;
          aCloth[v * 4] = pu;
          aCloth[v * 4 + 1] = pv;
          aCloth[v * 4 + 2] = seed;
          aCloth[v * 4 + 3] = length;
          aOut[v * 4] = row.ox;
          aOut[v * 4 + 1] = 0;
          aOut[v * 4 + 2] = row.oz;
          aOut[v * 4 + 3] = orient;
          aFace[v * 4] = faceU * SHEET_W;
          aFace[v * 4 + 1] = faceDown;
          aFace[v * 4 + 2] = tilt;
          aFace[v * 4 + 3] = scale;
          v++;
        }
      }
      for (let j = 0; j < lines; j++) {
        for (let i = 0; i < cols; i++) {
          const q0 = base + j * (cols + 1) + i;
          const q1 = q0 + 1;
          const q2 = q0 + cols + 1;
          const q3 = q2 + 1;
          if (row.side > 0) {
            index[w++] = q0;
            index[w++] = q1;
            index[w++] = q2;
            index[w++] = q1;
            index[w++] = q3;
            index[w++] = q2;
          } else {
            index[w++] = q0;
            index[w++] = q2;
            index[w++] = q1;
            index[w++] = q1;
            index[w++] = q2;
            index[w++] = q3;
          }
        }
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(position, 3));
    g.setAttribute('normal', new BufferAttribute(normal, 3));
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    g.setAttribute('aCloth', new BufferAttribute(aCloth, 4));
    g.setAttribute('aOut', new BufferAttribute(aOut, 4));
    g.setAttribute('aFace', new BufferAttribute(aFace, 4));
    g.setIndex(new BufferAttribute(index, 1));

    const m = this.kit.surface('linen_white', LINEN_TILE, { color: new Color(SHEET_COLOR), roughness: 0.96 }).clone();
    m.side = DoubleSide;
    m.normalScale.setScalar(0.45);
    const u = this.u;
    m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${SHEET_VERT_HEAD}`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${SHEET_VERT_NORMAL}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SHEET_VERT_MOVE}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${SHEET_FRAG_HEAD}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${SHEET_FRAG_STAIN}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${SHEET_FRAG_GLOW}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${SHEET_FRAG_DIM}`);
    };
    m.customProgramCacheKey = () => `washing-sheet-${REDUCED_MOTION}`;
    const sheets = new Mesh(g, m);
    sheets.castShadow = true;
    sheets.receiveShadow = false;
    sheets.frustumCulled = false;
    this.root.add(sheets);
  }

  private buildLines(rows: readonly Row[]): void {
    const posts: BufferGeometry[] = [];
    const wires: BufferGeometry[] = [];
    const lean = randomFrom(903);
    const pegCount = rows.filter((r) => r.offset === 0).length * SHEETS_PER_SPAN * ROW_SPANS * PEGS.length;
    const pegs = this.kit.props('dolly_peg', pegCount, {});
    let peg = 0;
    for (const row of rows) {
      for (let k = 0; k <= ROW_SPANS; k++) {
        const s = k * POST_STEP;
        const z = row.az + row.dz * s;
        const post = new CylinderGeometry(0.032, 0.05, LINE_H + 0.22, 7, 1);
        post.translate(0, (LINE_H + 0.22) / 2, 0);
        post.rotateZ((lean() - 0.5) * 0.05);
        post.rotateX((lean() - 0.5) * 0.04);
        post.translate(row.ax + row.dx * s, groundY(z) - 0.04, z);
        posts.push(post);
      }
      const points: Vector3[] = [];
      for (let s = 0; s <= ROW_LENGTH + 1e-3; s += 0.5) points.push(new Vector3(row.ax + row.dx * s, wireY(row, s), row.az + row.dz * s));
      wires.push(new TubeGeometry(new CatmullRomCurve3(points), points.length * 2, 0.009, 4, false));
      if (row.offset > 0) continue;
      const heading = Math.atan2(row.dx, row.dz);
      for (let i = 0; i < SHEETS_PER_SPAN * ROW_SPANS; i++) {
        for (const p of PEGS) {
          const s = i * PITCH + SHEET_GAP / 2 + p * SHEET_W;
          pegs.set(peg++, row.ax + row.dx * s, wireY(row, s) - 0.1, row.az + row.dz * s, heading, 1.35);
        }
      }
    }
    pegs.commit();
    this.root.add(pegs.root);
    const postMesh = new Mesh(mergeGeometries(posts)!, this.build.wood(0.9));
    postMesh.castShadow = true;
    this.root.add(postMesh);
    this.root.add(new Mesh(mergeGeometries(wires)!, new MeshBasicMaterial({ color: 0x141c1b, fog: false, side: DoubleSide })));
  }

  /** Behind every near sheet a man in a dark suit stands facing it. They were always there; only the wind shows it. */
  private buildPeople(rows: readonly Row[], random: () => number): void {
    const places: { x: number; z: number; heading: number }[] = [];
    for (const row of rows) {
      if (row.offset > 0) continue;
      for (let i = 0; i < SHEETS_PER_SPAN * ROW_SPANS; i++) {
        const s = i * PITCH + SHEET_GAP / 2 + SHEET_W / 2;
        const z = row.az + row.dz * s;
        if (z > LEGS_Z[0] || z < LEGS_Z[1]) continue;
        const behind = LEGS_BEHIND + random() * 0.1;
        places.push({ x: row.ax + row.dx * s + row.ox * behind, z: z + row.oz * behind, heading: Math.atan2(-row.ox, -row.oz) });
      }
    }
    const men = this.build.headless(places.length, { tint: 0x2a2e32 });
    places.forEach((p, i) => men.set(i, p.x, groundY(p.z) - LEGS_SINK, p.z, p.heading));
    men.commit();
    this.root.add(men.root);
    this.root.add(this.feetShadows(places));
  }

  /** The dark each of them stands in: thick under the boots, and a little way down the way, from the moon. */
  private feetShadows(places: readonly { x: number; z: number }[]): Mesh {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 128;
    const g = c.getContext('2d')!;
    // the top of the picture lies towards the moon; the boots stand at CORE
    const CORE = 44;
    const tail = g.createRadialGradient(32, CORE + 26, 4, 32, CORE + 26, 58);
    tail.addColorStop(0, 'rgba(0,0,0,0.42)');
    tail.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = tail;
    g.fillRect(0, 0, 64, 128);
    const under = g.createRadialGradient(32, CORE, 2, 32, CORE, 30);
    under.addColorStop(0, 'rgba(0,0,0,1)');
    under.addColorStop(0.5, 'rgba(0,0,0,0.72)');
    under.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = under;
    g.fillRect(0, 0, 64, 128);
    const map = new CanvasTexture(c);
    map.colorSpace = SRGBColorSpace;
    const positions = new Float32Array(places.length * 12);
    const uvs = new Float32Array(places.length * 8);
    const index: number[] = [];
    places.forEach((p, i) => {
      const far = p.z - (CORE / 128) * LEGS_SHADOW_L;
      const near = far + LEGS_SHADOW_L;
      const yFar = groundY(far) + LEGS_SHADOW_LIFT;
      const yNear = groundY(near) + LEGS_SHADOW_LIFT;
      const w = LEGS_SHADOW_W / 2;
      positions.set([p.x - w, yFar, far, p.x + w, yFar, far, p.x - w, yNear, near, p.x + w, yNear, near], i * 12);
      uvs.set([0, 1, 1, 1, 0, 0, 1, 0], i * 8);
      const b = i * 4;
      index.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    const shadows = new Mesh(geometry, new MeshBasicMaterial({ map, transparent: true, depthWrite: false, opacity: LEGS_SHADOW_DARK, side: DoubleSide }));
    shadows.frustumCulled = false;
    return shadows;
  }

  private buildWoman(): void {
    const y = groundY(WOMAN_Z);
    const hero = this.kit.figures.hero(WOMAN);
    hero.root.position.set(WOMAN_X, y, WOMAN_Z);
    hero.root.rotation.y = Math.PI;
    this.root.add(hero.root);
    hero.update(0);
    hero.root.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = true;
    });
    this.root.updateMatrixWorld(true);
    const parent = new Quaternion();
    for (const [name, share] of TURN_BONES) {
      const bone = hero.bone(name);
      if (!bone?.parent) continue;
      bone.parent.getWorldQuaternion(parent);
      this.turners.push({ bone, rest: bone.quaternion.clone(), axis: new Vector3(0, 1, 0).applyQuaternion(parent.invert()), share });
    }
    const head = new Vector3();
    hero.bone('Bip01_Head')?.getWorldPosition(head);
    this.root.worldToLocal(head);
    this.hairPivot.position.copy(head);
    this.root.add(this.hairPivot);
    this.buildHair();

    const basketX = WOMAN_X - 0.55;
    const basketZ = WOMAN_Z + 0.1;
    const basketY = groundY(basketZ);
    const basket = this.kit.prop('basket_wicker', [basketX, basketY, basketZ], { scale: 1.4, castShadow: true, rotation: [0, 24, 0] }, this.root);
    const mound = new Mesh(new IcosahedronGeometry(1, 2), new MeshStandardMaterial({ color: 0xc4c6be, roughness: 1, side: DoubleSide, emissive: 0x4a4c46 }));
    mound.scale.set(0.22, 0.1, 0.16);
    mound.position.set(0, 0.14, 0);
    basket.add(mound);
  }

  /** Long white hair, from the crown and the back of the skull, down her back. It stays when her head turns inside it. */
  private buildHair(): void {
    const random = randomFrom(212);
    const positions: number[] = [];
    const index: number[] = [];
    const segments = 9;
    for (let i = 0; i < HAIR_STRANDS; i++) {
      const a = -1.2 + random() * 3.15;
      const e = 0.05 + random() * 1.45;
      const length = HAIR_LENGTH[0] + random() * (HAIR_LENGTH[1] - HAIR_LENGTH[0]);
      const width = 0.0024 + random() * 0.0024;
      const wave = random() * TAU;
      const fan = 0.25 + random();
      const base = positions.length / 3;
      for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        const fall = Math.max(0, (t - HAIR_SKULL) / (1 - HAIR_SKULL));
        const el = t < HAIR_SKULL ? e + ((HAIR_NAPE - e) * t) / HAIR_SKULL : HAIR_NAPE;
        const rim = Math.cos(el) * (1.06 + fan * 0.12 * Math.min(1, fall * 3));
        const x = Math.sin(a) * rim * 0.092 * (1 + fan * fall) + Math.sin(t * 7 + wave) * 0.014 * fall;
        const y = 0.085 + Math.sin(el) * 0.125 - fall * length;
        const z = Math.cos(a) * rim * 0.112 + 0.02 * fall;
        const w = width * (1 - t * 0.75);
        positions.push(x - w, y, z, x + w, y, z);
        if (s < segments) {
          const b = base + s * 2;
          index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setIndex(index);
    const hair = new Mesh(g, new MeshBasicMaterial({ color: 0xa6a398, fog: false, side: DoubleSide }));
    hair.frustumCulled = false;
    this.hairPivot.add(hair);
  }

  /** The moon lays her shadow down the way, from her feet to yours. A soft shape on the ground, since the grass would hide a real one. */
  private buildShadow(): void {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 512;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    g.shadowColor = '#000';
    g.shadowBlur = 7;
    g.beginPath();
    g.moveTo(52, 512);
    g.quadraticCurveTo(50, 380, 40, 290);
    g.quadraticCurveTo(46, 210, 34, 150);
    g.quadraticCurveTo(44, 112, 54, 96);
    g.quadraticCurveTo(38, 54, 64, 18);
    g.quadraticCurveTo(90, 54, 74, 96);
    g.quadraticCurveTo(84, 112, 94, 150);
    g.quadraticCurveTo(82, 210, 88, 290);
    g.quadraticCurveTo(78, 380, 76, 512);
    g.closePath();
    g.fill();
    const map = new CanvasTexture(c);
    map.colorSpace = SRGBColorSpace;
    const segments = 40;
    const positions = new Float32Array((segments + 1) * 6);
    const uvs = new Float32Array((segments + 1) * 4);
    const index: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const z = WOMAN_Z + (SHADOW_END - WOMAN_Z) * t;
      const x = WOMAN_X + SHADOW_DRIFT * (z - WOMAN_Z);
      const y = groundY(z) + 0.03;
      positions.set([x - SHADOW_HALF, y, z, x + SHADOW_HALF, y, z], i * 6);
      uvs.set([0, t, 1, t], i * 4);
      if (i < segments) {
        const b = i * 2;
        index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    const shadow = new Mesh(geometry, new MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false, opacity: 0.84 }));
    shadow.frustumCulled = false;
    this.root.add(shadow);
  }

  /** The house you left stands behind you, with one lit window. Nobody has to turn round. */
  private buildHouse(): void {
    const parts: BufferGeometry[] = [];
    const body = new BoxGeometry(HOUSE_W, HOUSE_H, 7);
    body.translate(0, HOUSE_H / 2, HOUSE_Z + 3.5);
    parts.push(body.toNonIndexed());
    const chimney = new BoxGeometry(0.8, 2.2, 0.8);
    chimney.translate(3, HOUSE_H + HOUSE_ROOF * 0.74, HOUSE_Z + 2);
    parts.push(chimney.toNonIndexed());
    const w = HOUSE_W / 2 + 0.3;
    const z0 = HOUSE_Z - 0.3;
    const z1 = HOUSE_Z + 7.3;
    const y0 = HOUSE_H;
    const y1 = HOUSE_H + HOUSE_ROOF;
    const roof = new BufferGeometry();
    const corners = [-w, y0, z0, w, y0, z0, 0, y1, z0, w, y0, z1, -w, y0, z1, 0, y1, z1, -w, y0, z0, 0, y1, z0, 0, y1, z1, -w, y0, z0, 0, y1, z1, -w, y0, z1, w, y0, z0, w, y0, z1, 0, y1, z1, w, y0, z0, 0, y1, z1, 0, y1, z0];
    roof.setAttribute('position', new Float32BufferAttribute(corners, 3));
    roof.setAttribute('uv', new Float32BufferAttribute(new Float32Array((corners.length / 3) * 2), 2));
    roof.computeVertexNormals();
    parts.push(roof);
    const house = new Mesh(mergeGeometries(parts)!, new MeshStandardMaterial({ color: 0x1a1f20, roughness: 1, side: DoubleSide }));
    this.root.add(house);

    const lit = new Mesh(new PlaneGeometry(1, 1.3), new MeshBasicMaterial({ map: windowTexture(), transparent: true, depthWrite: false, fog: false, color: new Color(1.5, 1.5, 1.5) }));
    lit.position.set(-1.8, 2.4, HOUSE_Z - 0.03);
    lit.rotation.y = Math.PI;
    this.root.add(lit);
  }

  /** A forest edge all round, low in front of the moon, so that the field is closed. */
  private buildTreeline(random: () => number): void {
    const count = TREE_COLUMNS;
    const positions = new Float32Array((count + 1) * 2 * 3);
    const index: number[] = [];
    let wander = 0.5;
    let first = 0;
    for (let i = 0; i <= count; i++) {
      const a = ((i % count) / count) * TAU;
      const x = Math.sin(a) * TREE_RING;
      const z = -Math.cos(a) * TREE_RING;
      const bearing = Math.min(a, TAU - a);
      wander = sat(wander + (random() - 0.5) * 0.16);
      const tall = TREE_LOW + (TREE_HIGH - TREE_LOW) * smooth(TREE_OPEN, TREE_OPEN + 0.5, bearing);
      const h = tall * (0.55 + 0.4 * wander + 0.18 * random());
      if (i === 0) first = h;
      const top = i === count ? first : h;
      positions.set([x, -2, z, x, top, z], i * 6);
      if (i < count) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setIndex(index);
    const trees = new Mesh(g, new MeshBasicMaterial({ color: 0x050a0a, fog: false, side: DoubleSide }));
    trees.frustumCulled = false;
    this.root.add(trees);
  }

  private buildBareTrees(): void {
    const parts: BufferGeometry[] = [];
    for (const [x, z, h] of BARE_TREES) {
      const p = new PlaneGeometry(h * 0.62, h);
      p.translate(0, h / 2, 0);
      if (z > 0) p.rotateY(Math.PI);
      p.translate(x, -0.5, z);
      parts.push(p);
    }
    const trees = new Mesh(mergeGeometries(parts)!, new MeshBasicMaterial({ map: treeTexture(), transparent: true, depthWrite: false, fog: false, color: 0x040808 }));
    trees.renderOrder = -8;
    trees.frustumCulled = false;
    this.root.add(trees);
  }

  private buildMist(): void {
    const parts: BufferGeometry[] = [];
    const banks: readonly (readonly [number, number])[] = [
      [-10.5, 1.2],
      [-13, 1.4],
      [-15.6, 1.5],
      [-18.2, 1.7],
      [-20.4, 1.9],
    ];
    banks.forEach(([z, h], i) => {
      const p = new PlaneGeometry(innerX(z) * 2 * 0.98, h);
      p.translate(0, groundY(z) - 0.05 + h / 2, z);
      const uv = p.getAttribute('uv');
      for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) + i * 0.37);
      parts.push(p);
    });
    const crest = new PlaneGeometry(90, 6);
    crest.translate(0, CREST_H + 1.4, CREST_Z - 3);
    parts.push(crest);
    const mist = new Mesh(mergeGeometries(parts)!, new MeshBasicMaterial({ map: this.mistMap, transparent: true, depthWrite: false, fog: false, blending: AdditiveBlending, color: 0x3e4a44 }));
    mist.frustumCulled = false;
    this.root.add(mist);
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const u = this.u;

    // the wind: one lift, one fall, and dead still again; every sheet the same
    const up = 1 - Math.pow(1 - sat((s - WIND_AT) / LIFT_RISE), 3);
    const fall = sat((s - LIFT_FALL_FROM) / LIFT_FALL);
    let lift = s > WIND_AT ? up * (1 - fall * fall) : 0;
    const landed = s - (LIFT_FALL_FROM + LIFT_FALL);
    if (landed > 0 && landed < 0.42) lift -= 0.06 * Math.exp(-landed * 5) * Math.sin(landed * 7.48);
    const blowing = smooth(WIND_AT, WIND_AT + 0.5, s) * (1 - smooth(LIFT_FALL_FROM + 0.3, LIFT_FALL_FROM + LIFT_FALL + 0.3, s));
    u.uSeconds.value = s;
    u.uLift.value = lift * LIFT_ANGLE;
    u.uRipple.value = blowing * RIPPLE;
    this.clock.value = Math.max(0, s - WIND_AT) * 6;
    this.gust.value = blowing;

    // what stands behind the cloth: barely there, then gone under the wind, then at the cloth
    const closing = smooth(LIFT_FALL_FROM + LIFT_FALL - 0.3, FACES_AT, s) * (1 - smooth(FACE_GO_FROM + 0.3, FACE_GO_FROM + 1.3, s));
    const calm = PRESENCE_CALM * (1 - smooth(WIND_AT - 0.1, WIND_AT + 0.3, s));
    const flash = s >= SHUTTER_AT && s < SHUTTER_AT + FLASH_HOLD ? 1 : 0;
    u.uFlash.value = flash;
    u.uPresence.value = flash ? PRESENCE_NEAR : Math.max(calm, closing * PRESENCE_NEAR);
    this.flashLamp.intensity = flash * 12;
    this.faceLamp.intensity = FACE_LAMP * smooth(TURN_FROM + 0.3, SHUTTER_AT, s);

    // she turns: only the head, only half
    const turn = smooth(TURN_FROM, SHUTTER_AT, s) * TURN;
    for (const t of this.turners) {
      this.turnQ.setFromAxisAngle(t.axis, turn * t.share);
      t.bone.quaternion.multiplyQuaternions(this.turnQ, t.rest);
    }
    this.hairPivot.rotation.y = turn * HAIR_FOLLOWS;

    this.moteTime.value = s * 0.25 + this.clock.value * 0.4;
    this.mistMap.offset.x = s * 0.006 + this.clock.value * 0.004;

    this.focus = FOCUS_FAR + (FOCUS_NEAR - FOCUS_FAR) * (smooth(8.2, FACES_AT, s) - smooth(10.6, 12, s));
    this.fear = 0.3 + 0.45 * smooth(5, FACES_AT, s);
    this.drift = 0.55 * (1 - smooth(11, 12, s));
    this.control = s > 11.4 ? HELD_VIEW : OPEN_VIEW;
    this.black = s >= CUT_AT ? 1 : 0;
  }
}
