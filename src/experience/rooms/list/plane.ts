import {
  BackSide,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  ClampToEdgeWrapping,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  Shape,
  ShapeGeometry,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { SpotSpec } from '../../../config/nightmare.config';
import { meterUVs } from '../../dream/DreamKit';
import { randomFrom, type Crowd } from '../../dream/FigureKit';
import { DEG, lerp, range, smootherstep } from '../../math';
import type { RoomAir, RoomAssets, RoomContext, RoomFilm, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import { PALETTE } from '../RoomKit';
import type { RoomVoice } from '../RoomSound';

type V3 = readonly [number, number, number];
type P2 = readonly [number, number];

/** The rows (m): how far apart, how many ahead of yours and behind it, where the back of your own seat stands. */
const PITCH = 0.92;
const ROWS_AHEAD = 12;
const ROWS_BEHIND = 5;
const MY_BACK_Z = 0.34;
const rowZ = (r: number): number => MY_BACK_Z - r * PITCH;
/** The cabin's two end walls (m along z). */
const Z_FRONT = rowZ(ROWS_AHEAD) - 1.25;
const Z_BACK = rowZ(-ROWS_BEHIND) + 0.75;
/**
 * The cabin's section, its right half from the edge of the floor to the middle of the ceiling (m): the wall with
 * its band of windows, the underside of the hat rack, its face, the notch of the night light, the ceiling.
 */
const HALF_SECTION: readonly P2[] = [
  [1.28, 0], [1.31, 0.12], [1.38, 0.42], [1.44, 0.72], [1.47, 0.9], [1.48, 1.12], [1.465, 1.36], [1.43, 1.52], [1.37, 1.62],
  [0.99, 1.62], [0.955, 1.66], [0.94, 1.78], [0.95, 1.9], [1.02, 1.95], [0.96, 2.03], [0.7, 2.11], [0.4, 2.15], [0, 2.17],
];
/** Which points of the section begin: the window band, the rack's underside, its face, the night light's notch, the ceiling. */
const AT_BAND = 4;
const AT_RACK = 8;
const AT_FACE = 9;
const AT_COVE = 13;
const AT_CEILING = 14;
/** Corners sharper than this keep a hard edge (rad between the faces). */
const HARD_EDGE = 0.7;
/** The windows: the middle of each, its half width along the cabin and half height (m), how deep the hull is. */
const WINDOW_Y = 1.12;
const WINDOW_X = 1.48;
const WINDOW_HALF_W = 0.2;
const WINDOW_HALF_H = 0.27;
const HULL = 0.12;
/** Where a row's window lies from the back of its seats (m toward the front): beside a seated head. */
const WINDOW_AHEAD = 0.35;
/** The seats (m): the middle of a pair from the middle of the cabin, the step between its two seats, the cushion's top, the back's height and depth, how far it leans back (rad). */
const PAIR_X = 0.77;
const SEAT_STEP = 0.5;
const CUSHION_TOP = 0.46;
const BACK_H = 0.72;
const BACK_D = 0.11;
const RECLINE = 0.16;
/** The window seat of your row and what lies on it. */
const WINDOW_SEAT_X = -PAIR_X - SEAT_STEP / 2;
/** The sleepers (m, rad): where a body stands behind its seat's back, how high its hips are, how far forward it bows and how far its head falls aside. */
const BODY_FROM_BACK = 0.33;
const BODY_Y = -0.06;
const HIPS = 0.53;
const BOW = 0.42;
const SLUMP = 0.2;
/** The cloth of the sacks: burlap, with a weave in it (color multiplied, weave strength). */
const BURLAP: V3 = [0.5, 0.45, 0.36];
const WEAVE = 1.4;
/** The eye: seated in the aisle seat of the left pair, upright, leaning out a little into the aisle (m). */
const EYE: V3 = [-0.32, 1.25, 0];
/** The eye leaning over the empty seat to the window (m). */
const LEAN: V3 = [-0.62, 1.15, -0.04];
/** The light far below: how far (m), and where, seen from the leaning eye (deg: left of ahead, below level). */
const FAR_LIGHT_DISTANCE = 125;
const FAR_LIGHT_YAW = 98;
const FAR_LIGHT_PITCH = -5.5;
/** The house: the middle of its lit window (m), the size of the wall that holds it, how far below the sill it goes. */
const HOUSE: V3 = [-4.3, 1.28, 0.05];
const HOUSE_WALL: P2 = [4.6, 3.6];
const WALL_BELOW = 1.15;
/** The wing (m): where it leaves the hull, how far it reaches, its chord at root and tip, where its leading edge is, how high its root is, its dihedral (rad), how thick it is (share of the chord). */
const WING_ROOT = 1.2;
const WING_TIP = 13.5;
const CHORD: P2 = [3.6, 1.5];
const LEADING: P2 = [-2.4, -1.4];
const WING_Y = -0.75;
const DIHEDRAL = 0.087;
const THICKNESS = 0.13;
/** The engine on it: how far out (m), and its cowling from the spinner back (z, m). */
const ENGINE_X = -5.7;
const ENGINE_Z: P2 = [-4.7, 0.6];
/** The deck of cloud far below the eye (m), how big one tile of it is (m), how fast it streams past (m/s). */
const CLOUD_BELOW = 38;
const CLOUD_TILE = 95;
const FLIGHT_SPEED = 55;
/** The sky dome (m): inside the walk's own black dome, beyond everything here. */
const SKY_RADIUS = 140;

/** Seconds: the seat-belt sign, the line, a creak, the engines stop, the house comes, she stands and comes to the glass, the shutter, the bell, the cut. */
const CHIME_AT = 5;
const LINE_AT = 7;
const CREAK_AT = 10;
const STOP_AT = 11;
const SPIN_DOWN = 1.4;
const HOUSE_ON = 13.35;
const HOUSE_RAMP = 0.35;
const STAND: P2 = [15.6, 16.7];
const COME: P2 = [16.7, 18.6];
const SHUTTER_AT = 19;
const RING_AT = 20;
const CUT_AT = 23.5;
/** How fast everything outside stops once the engines are off (s). */
const HANG = 0.5;

/** Light: the night light down the cabin (cd), its little lamps along the ceiling, what is left of it when the engines stop. */
const BLUE_KEY = 28;
const COVE_LAMP = 0.6;
const COVE_LAMP_Y = 1.7;
const COVE_GLOW = 0.55;
const SAG = 0.32;
/** The house: its light through the windows (cd), on its own wall; the curtain's brightness (linear); the moon on the wing. */
const HOUSE_KEY = 100;
const HOUSE_SPILL = 7;
const CURTAIN_GAIN = 1.7;
const WING_MOON = 6;
/** The far light: its size (m) and strength. */
const FAR_LIGHT_SIZE = 4.5;
const FAR_LIGHT_GLOW = 4;
/** The seat-belt signs, off and on (linear gain on their picture). */
const SIGN_OFF = 0.05;
const SIGN_ON = 1.9;

/** Colors of the cabin: its plastic, the cloth of the seats, the night light. */
const CABIN_CREAM = '#8c8678';
const SEAT_CLOTH = 0x2c3b4c;
const COVER_CLOTH = 0xaaa595;
const NIGHT = 0x7f9fcc;
const WARM = 0xffa660;

export const assets: RoomAssets = {
  models: ['window_wood', 'curtains', 'phone_ornate'],
  materials: ['linen_white', 'plaster_damaged'],
  sounds: [
    'rooms/dream_drone_metal.mp3',
    'rooms/cable_hum.mp3',
    'rooms/wind_high_tube.mp3',
    'rooms/duct_air.mp3',
    'rooms/air_rush.mp3',
    'rooms/breath_sack.mp3',
    'rooms/ding_two_note.mp3',
    'rooms/hull_creak_1.mp3',
    'rooms/phone_ring.mp3',
  ],
};

function canvasOf(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): { texture: CanvasTexture; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, canvas };
}

/** The whole section, from the left edge of the floor over the ceiling to the right one. */
function fullSection(): P2[] {
  return [...HALF_SECTION.map(([x, y]) => [-x, y] as const), ...HALF_SECTION.slice(0, -1).reverse()];
}

/** Arc length (m) along a polyline up to each of its points. */
function arcs(points: readonly P2[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return out;
}

/**
 * A section swept straight along z from z0 to z1: smooth where it bends a little, hard where it turns a corner.
 * Its faces look to the right of the way the section runs (drawn with x to the right and y up), or to the left
 * when `right` is false. UVs: u is the length along the section over `uSpan`, v is z over `vSpan` from `vFrom`.
 */
function sweep(section: readonly P2[], z0: number, z1: number, right: boolean, uv: { uSpan: number; vFrom: number; vSpan: number }): BufferGeometry {
  const s = arcs(section);
  const n = section.length;
  const segNormal = (i: number): P2 => {
    const dx = section[i + 1][0] - section[i][0];
    const dy = section[i + 1][1] - section[i][1];
    const l = Math.hypot(dx, dy);
    return right ? [dy / l, -dx / l] : [-dy / l, dx / l];
  };
  // each point of the section once, or twice at a corner (one for each face)
  const ring: { x: number; y: number; s: number; nx: number; ny: number; join: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? segNormal(i - 1) : null;
    const b = i < n - 1 ? segNormal(i) : null;
    const [x, y] = section[i];
    if (a && b && Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1])) > HARD_EDGE) {
      ring.push({ x, y, s: s[i], nx: a[0], ny: a[1], join: true });
      ring.push({ x, y, s: s[i], nx: b[0], ny: b[1], join: false });
      continue;
    }
    const m = a && b ? [a[0] + b[0], a[1] + b[1]] : (a ?? b)!;
    const l = Math.hypot(m[0], m[1]);
    ring.push({ x, y, s: s[i], nx: m[0] / l, ny: m[1] / l, join: i > 0 });
  }
  const steps = Math.max(1, Math.ceil(Math.abs(z1 - z0) / 1.5));
  const position: number[] = [];
  const normal: number[] = [];
  const uvs: number[] = [];
  for (let k = 0; k <= steps; k++) {
    const z = lerp(z0, z1, k / steps);
    for (const p of ring) {
      position.push(p.x, p.y, z);
      normal.push(p.nx, p.ny, 0);
      uvs.push(p.s / uv.uSpan, (z - uv.vFrom) / uv.vSpan);
    }
  }
  const index: number[] = [];
  const w = ring.length;
  for (let k = 0; k < steps; k++) {
    for (let j = 1; j < w; j++) {
      if (!ring[j].join) continue;
      const a = k * w + j - 1;
      const c = k * w + j;
      const b = a + w;
      const d = c + w;
      // wind each face so that it looks the way its normals do
      if ((z1 > z0) === right) index.push(a, c, b, c, d, b);
      else index.push(a, b, c, c, b, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  return g;
}

/** Where along the full section (m) the left window's middle lies. */
function windowArc(): number {
  const s = arcs(HALF_SECTION);
  for (let i = 1; i < HALF_SECTION.length; i++) {
    const [, y0] = HALF_SECTION[i - 1];
    const [, y1] = HALF_SECTION[i];
    if (y0 <= WINDOW_Y && y1 >= WINDOW_Y) return lerp(s[i - 1], s[i], (WINDOW_Y - y0) / (y1 - y0));
  }
  return s[AT_BAND];
}

/**
 * The cabin's lining over one row: old cream plastic, a dark kick strip, the reading lamps and vents under the rack,
 * the rack doors and their latches, stains under each window where years of cold glass have wept. `alpha` draws
 * only the windows' holes; `glow` only the night light washing the ceiling from its notch.
 */
function drawLining(c: CanvasRenderingContext2D, w: number, h: number, kind: 'color' | 'alpha' | 'glow'): void {
  const s = arcs(HALF_SECTION);
  const total = s[s.length - 1] * 2;
  const px = (arc: number) => (arc / total) * w;
  const both = (arc: number): readonly number[] => [px(arc), px(total - arc)];
  const vy = (v: number) => (1 - v) * h;
  const win = windowArc();
  const ry = (WINDOW_HALF_W / PITCH) * h;
  const rx = (WINDOW_HALF_H / total) * w;
  if (kind === 'alpha') {
    c.fillStyle = '#fff';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#000';
    for (const x of both(win)) {
      c.beginPath();
      c.ellipse(x, vy(0.5), rx, ry, 0, 0, Math.PI * 2);
      c.fill();
    }
    return;
  }
  if (kind === 'glow') {
    c.fillStyle = '#000';
    c.fillRect(0, 0, w, h);
    for (const side of [1, -1]) {
      const from = px(side > 0 ? s[AT_CEILING] : total - s[AT_CEILING]);
      const to = from + side * px(0.75);
      const g = c.createLinearGradient(from, 0, to, 0);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.25, '#6d6d6d');
      g.addColorStop(1, '#000000');
      c.fillStyle = g;
      c.fillRect(Math.min(from, to), 0, Math.abs(to - from), h);
    }
    return;
  }
  const random = randomFrom(41);
  c.fillStyle = CABIN_CREAM;
  c.fillRect(0, 0, w, h);
  const band = (a: number, b: number, color: string) => {
    for (const [x0, x1] of [[px(a), px(b)], [px(total - b), px(total - a)]]) {
      c.fillStyle = color;
      c.fillRect(x0, 0, x1 - x0, h);
    }
  };
  band(0, s[1], '#3a3834');
  band(s[AT_RACK], s[AT_FACE], '#34363a');
  band(s[AT_COVE], s[AT_CEILING], '#1c1d1f');
  band(s[AT_CEILING], s[s.length - 1], '#aaa395');
  // the seams between panels, one across each row, and the rack doors' gaps
  c.fillStyle = 'rgba(20,18,14,0.55)';
  c.fillRect(0, vy(0.02) - 1.5, w, 3);
  // reading lamps and air vents under the rack, over each row
  for (const side of [1, -1]) {
    const across = (k: number) => px(side > 0 ? lerp(s[AT_RACK], s[AT_FACE], k) : total - lerp(s[AT_RACK], s[AT_FACE], k));
    for (const [k, v, r, lamp] of [[0.38, 0.42, 0.022, true], [0.62, 0.42, 0.022, true], [0.5, 0.66, 0.016, false]] as const) {
      const x = across(k);
      const rad = (r / PITCH) * h;
      c.fillStyle = lamp ? '#6a675e' : '#141414';
      c.beginPath();
      c.ellipse(x, vy(v), (r / total) * w, rad, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.8)';
      c.lineWidth = 1.5;
      c.stroke();
    }
    // the rack door: its latch near the top of the face
    const lx = px(side > 0 ? lerp(s[AT_FACE], s[AT_COVE - 1], 0.78) : total - lerp(s[AT_FACE], s[AT_COVE - 1], 0.78));
    c.fillStyle = 'rgba(10,10,10,0.85)';
    c.fillRect(lx - 3, vy(0.56), 6, vy(0.44) - vy(0.56));
  }
  // grime: old blotches, darker toward the floor, stains weeping down from each window
  for (let i = 0; i < 140; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = (0.01 + random() * 0.05) * w;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.04 + random() * 0.1;
    g.addColorStop(0, `rgba(30,24,14,${a})`);
    g.addColorStop(1, 'rgba(30,24,14,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (const [x, side] of [[px(win), -1], [px(total - win), 1]] as const) {
    // a ring of dirt where hands and heads have rested against the bezel
    c.strokeStyle = 'rgba(40,30,16,0.35)';
    c.lineWidth = rx * 0.5;
    c.beginPath();
    c.ellipse(x, vy(0.5), rx * 1.35, ry * 1.35, 0, 0, Math.PI * 2);
    c.stroke();
    for (let i = 0; i < 7; i++) {
      const y = vy(0.5) + (random() - 0.5) * ry * 1.4;
      const from = x + side * rx * 1.2;
      const long = (0.06 + random() * 0.32) * w * 0.12;
      const g = c.createLinearGradient(from, 0, from + side * long, 0);
      g.addColorStop(0, `rgba(70,52,22,${0.25 + random() * 0.25})`);
      g.addColorStop(1, 'rgba(70,52,22,0)');
      c.fillStyle = g;
      c.fillRect(Math.min(from, from + side * long), y, long, 1.5 + random() * 2.5);
    }
  }
  // the floor end of the wall is darkest
  for (const [a, b] of [[0, px(0.6)], [w, w - px(0.6)]]) {
    const g = c.createLinearGradient(a, 0, b, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
}

/** The seat-belt sign: a seated figure with a belt across it, in the amber of old signs. */
function drawSign(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#050403';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#ffe2b0';
  c.fillStyle = '#ffe2b0';
  c.lineWidth = h * 0.08;
  c.lineCap = 'round';
  const x = w * 0.5;
  c.beginPath();
  c.arc(x - h * 0.05, h * 0.22, h * 0.1, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.moveTo(x - h * 0.12, h * 0.36);
  c.lineTo(x - h * 0.16, h * 0.66);
  c.lineTo(x + h * 0.14, h * 0.66);
  c.lineTo(x + h * 0.18, h * 0.88);
  c.stroke();
  c.beginPath();
  c.moveTo(x - h * 0.34, h * 0.56);
  c.lineTo(x + h * 0.3, h * 0.56);
  c.stroke();
  c.fillRect(x - h * 0.05, h * 0.5, h * 0.1, h * 0.12);
  c.strokeStyle = 'rgba(255,226,176,0.5)';
  c.lineWidth = 2;
  c.strokeRect(3, 3, w - 6, h - 6);
}

/** The deck of cloud far below: soft blobs that tile. */
function drawCloud(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(5);
  c.fillStyle = '#000';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = (0.04 + random() * random() * 0.2) * w;
    const a = 0.25 + random() * 0.5;
    for (const ox of [-w, 0, w]) {
      for (const oy of [-h, 0, h]) {
        const g = c.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
}

/** Painted aluminium: panel joints along and across, rows of rivets, a streak of exhaust. */
function drawSkin(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(17);
  c.fillStyle = '#8d9196';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = (0.05 + random() * 0.2) * w;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${random() < 0.5 ? '20,20,20' : '230,230,225'},${0.05 + random() * 0.06})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  c.strokeStyle = 'rgba(20,22,24,0.7)';
  c.lineWidth = 2;
  for (const k of [0, 0.5]) {
    c.beginPath();
    c.moveTo(0, k * h + 1);
    c.lineTo(w, k * h + 1);
    c.moveTo(k * w + 1, 0);
    c.lineTo(k * w + 1, h);
    c.stroke();
  }
  c.fillStyle = 'rgba(25,26,28,0.6)';
  for (const k of [0, 0.5]) {
    for (let i = 0; i < 40; i++) {
      c.fillRect((i / 40) * w, k * h + 6, 1.6, 1.6);
      c.fillRect(k * w + 6, (i / 40) * h, 1.6, 1.6);
    }
  }
}

/**
 * The kitchen curtain lit from behind, and on it the shadows of the table: the father, the mother, an empty chair,
 * the little one turned away. `stand` 0..1 the mother getting up, `come` 0..1 her coming to the glass: her shadow
 * grows sharp and dark as she nears the cloth.
 */
function drawCurtain(c: CanvasRenderingContext2D, w: number, h: number, stand: number, come: number): void {
  const g = c.createRadialGradient(w * 0.5, h * 0.24, 0, w * 0.5, h * 0.4, w * 0.62);
  g.addColorStop(0, '#fff2d8');
  g.addColorStop(0.3, '#f4c287');
  g.addColorStop(0.75, '#a2602a');
  g.addColorStop(1, '#3a1d0a');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  // pleats
  for (let x = 0; x < w; x += 2) {
    const k = 0.5 + 0.5 * Math.sin((x / w) * Math.PI * 2 * 13 + Math.sin(x * 0.043) * 1.4);
    c.fillStyle = `rgba(70,32,8,${0.05 + 0.2 * k * k})`;
    c.fillRect(x, 0, 2, h);
  }
  const shadow = (blur: number, alpha: number, path: () => void) => {
    c.save();
    c.filter = `blur(${blur.toFixed(1)}px)`;
    c.fillStyle = `rgba(22,9,2,${alpha})`;
    c.beginPath();
    path();
    c.fill();
    c.restore();
  };
  /** Head and shoulders, from the crown at `top`, `r` the head's half width in px; `hair` lets long hair down. */
  const body = (x: number, top: number, r: number, hair: boolean, turn = 0) => {
    c.ellipse(x + turn * r * 0.3, top + r * 1.15, r * 0.82, r * 1.12, turn * 0.2, 0, Math.PI * 2);
    if (hair) {
      c.moveTo(x + r * 1.05, top + r * 1.1);
      c.ellipse(x, top + r * 1.4, r * 1.05, r * 1.5, 0, 0, Math.PI * 2);
    }
    c.moveTo(x - r * 0.42, top + r * 2.1);
    c.bezierCurveTo(x - r * 0.5, top + r * 2.6, x - r * 2.4, top + r * 2.7, x - r * 2.7, top + r * 3.6);
    c.lineTo(x - r * 2.9, h + 10);
    c.lineTo(x + r * 2.9, h + 10);
    c.lineTo(x + r * 2.7, top + r * 3.6);
    c.bezierCurveTo(x + r * 2.4, top + r * 2.7, x + r * 0.5, top + r * 2.6, x + r * 0.42, top + r * 2.1);
    c.closePath();
  };
  const r = w * 0.045;
  // the table's edge across the lower third
  shadow(5, 0.82, () => c.rect(-20, h * 0.7, w + 40, h * 0.5));
  // the father, the empty chair, the little one turned away
  shadow(8, 0.74, () => body(w * 0.2, h * 0.3, r * 1.1, false));
  shadow(6, 0.7, () => {
    const x = w * 0.64;
    c.rect(x - r * 1.5, h * 0.47, r * 0.3, h * 0.3);
    c.rect(x + r * 1.2, h * 0.47, r * 0.3, h * 0.3);
    c.rect(x - r * 1.6, h * 0.45, r * 3.2, r * 0.42);
    c.rect(x - r * 1.5, h * 0.55, r * 3.0, r * 0.22);
  });
  shadow(9, 0.66, () => body(w * 0.83, h * 0.46, r * 0.74, false, 1));
  // the mother: seated, then up, then at the glass
  const up = smootherstep(stand);
  const near = smootherstep(come);
  const size = r * lerp(1, 1.5, near);
  const x = lerp(w * 0.41, w * 0.5, near);
  const top = lerp(h * 0.33, h * 0.1, up) + near * h * 0.02;
  shadow(lerp(8, 0.6, near), lerp(0.72, 0.97, near), () => body(x, top, size, true));
}

/** The pieces of a pair of seats, by what they are made of. */
interface SeatParts {
  fabric: BufferGeometry;
  cover: BufferGeometry;
  plastic: BufferGeometry;
  metal: BufferGeometry;
}

/** Two seats joined on one frame, their backs' rear at z = 0, facing -z; covers over their tops. */
function seatPair(): SeatParts {
  const fabric: BufferGeometry[] = [];
  const cover: BufferGeometry[] = [];
  const plastic: BufferGeometry[] = [];
  const metal: BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, r: number, x: number, y: number, z: number, seg = 2) => meterUVs(new RoundedBoxGeometry(w, h, d, seg, r).translate(x, y, z));
  const lean = (g: BufferGeometry) => meterUVs(g.translate(0, -CUSHION_TOP, 0).rotateX(RECLINE).translate(0, CUSHION_TOP, 0));
  const tube = (r: number, length: number, x: number, y: number, z: number, along: 'x' | 'y' | 'z') => {
    const g = new CylinderGeometry(r, r, length, 8, 1);
    if (along === 'x') g.rotateZ(Math.PI / 2);
    if (along === 'z') g.rotateX(Math.PI / 2);
    // rounded boxes come unindexed: so must everything merged with them
    return meterUVs(g.translate(x, y, z).toNonIndexed());
  };
  for (const sx of [-SEAT_STEP / 2, SEAT_STEP / 2]) {
    fabric.push(lean(box(0.45, BACK_H, BACK_D, 0.045, sx, CUSHION_TOP + BACK_H / 2, -BACK_D / 2, 3)));
    cover.push(lean(box(0.458, 0.16, BACK_D + 0.008, 0.03, sx, CUSHION_TOP + BACK_H - 0.07, -BACK_D / 2)));
    fabric.push(box(0.45, 0.12, 0.5, 0.05, sx, CUSHION_TOP - 0.06, -0.33));
    plastic.push(lean(box(0.36, 0.24, 0.016, 0.008, sx, CUSHION_TOP + 0.33, 0.006, 1)));
    plastic.push(lean(box(0.05, 0.018, 0.014, 0.004, sx, CUSHION_TOP + 0.462, 0.016, 1)));
    plastic.push(lean(box(0.38, 0.15, 0.03, 0.01, sx, CUSHION_TOP + 0.12, 0.014, 1)));
    cover.push(lean(box(0.14, 0.05, 0.005, 0.002, sx + 0.06, CUSHION_TOP + 0.205, 0.022, 1)));
  }
  for (const ax of [-SEAT_STEP, 0, SEAT_STEP]) {
    metal.push(box(0.05, 0.045, 0.42, 0.018, ax, CUSHION_TOP + 0.17, -0.3));
    metal.push(box(0.035, 0.18, 0.05, 0.012, ax, CUSHION_TOP + 0.07, -0.12));
  }
  for (const lx of [-0.34, 0.34]) {
    for (const lz of [-0.08, -0.46]) metal.push(tube(0.016, CUSHION_TOP - 0.12, lx, (CUSHION_TOP - 0.12) / 2, lz, 'y'));
    metal.push(tube(0.016, 0.38, lx, 0.04, -0.27, 'z'));
  }
  metal.push(tube(0.02, SEAT_STEP * 2, 0, CUSHION_TOP - 0.14, -0.1, 'x'));
  metal.push(tube(0.02, SEAT_STEP * 2, 0, CUSHION_TOP - 0.14, -0.44, 'x'));
  return { fabric: mergeGeometries(fabric)!, cover: mergeGeometries(cover)!, plastic: mergeGeometries(plastic)!, metal: mergeGeometries(metal)! };
}

/** An airfoil lofted along the span from root to tip, its UVs in meters. */
function wingGeometry(): BufferGeometry {
  const around = 24;
  const stations = 10;
  const position: number[] = [];
  const uvs: number[] = [];
  for (let k = 0; k <= stations; k++) {
    const t = k / stations;
    const span = lerp(WING_ROOT, WING_TIP, t);
    const chord = lerp(CHORD[0], CHORD[1], t);
    const lead = lerp(LEADING[0], LEADING[1], t);
    const y0 = WING_Y + (span - WING_ROOT) * DIHEDRAL;
    // the tip closes over its last station
    const thick = THICKNESS * (k === stations ? 0.15 : 1);
    for (let i = 0; i <= around * 2; i++) {
      const upper = i <= around;
      const q = upper ? 1 - i / around : (i - around) / around;
      const x = (1 - Math.cos(q * Math.PI)) / 2;
      const yt = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
      const camber = 0.025 * Math.sin(Math.PI * x);
      const y = (camber + (upper ? yt : -yt)) * chord;
      position.push(-span, y0 + y, lead + x * chord);
      uvs.push(x * chord * (upper ? 1 : -1), span);
    }
  }
  const index: number[] = [];
  const w = around * 2 + 1;
  for (let k = 0; k < stations; k++) {
    for (let i = 0; i < w - 1; i++) {
      const a = k * w + i;
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(position, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const SKY_VERT = /* glsl */ `
varying vec3 vRay;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vRay = w.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

/** Night over the sea: black overhead, a cold band where the horizon has sunk below you, a deck of cloud far down. */
const SKY_FRAG = /* glsl */ `
uniform sampler2D uCloud;
uniform float uFlow;
varying vec3 vRay;
void main() {
  vec3 d = normalize(vRay);
  float h = d.y + 0.045;
  vec3 col = vec3(0.0012, 0.0016, 0.0024);
  col += vec3(0.010, 0.0135, 0.019) * exp(-abs(h) * 24.0);
  col += vec3(0.0025, 0.0035, 0.005) * exp(-max(h, 0.0) * 5.0);
  if (d.y < -0.03) {
    vec2 p = d.xz * (${CLOUD_BELOW.toFixed(1)} / -d.y);
    float c = texture2D(uCloud, (p + vec2(0.0, uFlow)) / ${CLOUD_TILE.toFixed(1)}).r;
    float far = exp(-length(p) / 320.0);
    col = mix(col, vec3(0.03, 0.038, 0.05), smoothstep(0.25, 0.85, c) * far);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const UP = new Vector3(0, 1, 0);
const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const ONE = new Vector3(1, 1, 1);

/**
 * A night flight seen from an aisle seat halfway down the cabin: rows of seat backs in the blue of the night light,
 * a sleeper in a sack in every seat ahead, heads bowed. The seat-belt sign chimes; far below one warm light. Then
 * the engines stop and nothing falls: the plane hangs in a silence with no bottom, and outside the window, level
 * with the wing and keeping pace, is the lit kitchen window of the house. One of the shadows on its curtain gets up
 * and comes to the glass. In the silent cabin a telephone begins to ring.
 */
export default class Plane extends Room {
  readonly keys: readonly RoomKey[] = [
    { t: 0, at: EYE, yaw: 1.5, pitch: -5, fov: 50 },
    { t: 4.6 / 24, at: [EYE[0], EYE[1], EYE[2] - 0.03], yaw: 1, pitch: -4, fov: 49.5 },
    { t: 5.9 / 24, at: [EYE[0] - 0.01, EYE[1], EYE[2] - 0.03], yaw: 3, pitch: -1.5, fov: 49.5 },
    { t: 7.6 / 24, at: [LEAN[0] + 0.05, LEAN[1] + 0.01, LEAN[2]], yaw: 91, pitch: -4, fov: 48 },
    { t: 10.6 / 24, at: [LEAN[0] + 0.03, LEAN[1], LEAN[2]], yaw: 91.5, pitch: -4.5, fov: 47.5 },
    { t: 12.9 / 24, at: [-0.4, 1.24, -0.03], yaw: 10, pitch: -3, fov: 49 },
    { t: 13.9 / 24, at: [-0.41, 1.24, -0.03], yaw: 13, pitch: -3, fov: 49 },
    { t: 15.5 / 24, at: LEAN, yaw: 92, pitch: -0.5, fov: 46 },
    { t: SHUTTER_AT / 24, at: [LEAN[0] - 0.04, LEAN[1] - 0.01, LEAN[2]], yaw: 92, pitch: 0, fov: 44 },
    { t: 1, at: [LEAN[0] - 0.05, LEAN[1] - 0.02, LEAN[2]], yaw: 91, pitch: -4, fov: 43.5 },
  ];
  readonly air: RoomAir = {
    fog: { color: 0x04070b, density: 0.03 },
    env: 'evening',
    envIntensity: 0.04,
    sky: 0,
    grade: { exposure: 1.25, saturation: 0.85, warmth: -0.05, tint: -0.02, flare: 0.004 },
  };
  film: RoomFilm = { bloom: 0.6, bloomFrom: 0.6, bloomTint: [1, 0.9, 0.78], grain: 0.42, scratches: 0.03, flicker: 0.015, weave: 0.0003, aberration: 0.0012 };
  focus = 4.3;
  aperture = 2.2;

  private readonly blueKey: SpotSpec;
  private readonly houseKey: SpotSpec;
  private readonly coveLamps: { intensity: number }[] = [];
  private readonly spill: { intensity: number };
  private readonly lining: MeshStandardMaterial;
  private readonly signs: MeshBasicMaterial;
  private readonly sky: ShaderMaterial;
  private readonly farLight: { value: Color };
  private readonly farColor: Color;
  private readonly house = new Group();
  private readonly curtain: MeshBasicMaterial;
  private readonly redrawCurtain: (stand: number, come: number) => void;
  private readonly motes: { value: number };
  private engines: RoomVoice[] = [];
  private sleepers: RoomVoice | null = null;
  private drawn = -1;

  constructor(ctx: RoomContext) {
    super(ctx);
    const kit = this.kit;
    const b = this.build;
    const root = this.root;
    this.fear = 0.15;
    this.drift = REDUCED_MOTION ? 0 : 0.3;

    // the cabin's lining, one sweep with the windows cut out of it
    const section = fullSection();
    const total = arcs(section)[section.length - 1];
    const vFrom = rowZ(0) - WINDOW_AHEAD - PITCH / 2;
    const lining = (kind: 'color' | 'alpha' | 'glow') => {
      const t = canvasOf(2048, 512, (c, w, h) => drawLining(c, w, h, kind)).texture;
      t.wrapS = ClampToEdgeWrapping;
      t.wrapT = RepeatWrapping;
      if (kind === 'alpha') t.colorSpace = NoColorSpace;
      return t;
    };
    this.lining = new MeshStandardMaterial({
      map: lining('color'),
      alphaMap: lining('alpha'),
      alphaTest: 0.5,
      emissive: new Color(NIGHT),
      emissiveMap: lining('glow'),
      emissiveIntensity: COVE_GLOW,
      roughness: 0.6,
    });
    const shell = new Mesh(sweep(section, Z_FRONT, Z_BACK, true, { uSpan: total, vFrom, vSpan: PITCH }), this.lining);
    shell.castShadow = true;
    shell.receiveShadow = true;
    shell.frustumCulled = false;
    root.add(shell);

    // the floor: a worn carpet, darkest under the seats
    const carpet = kit.floor(-1.3, 1.3, Z_FRONT, Z_BACK, 0, b.carpet('#1b222a', 0.7));
    root.add(carpet);
    const grime = canvasOf(128, 1024, (c, w, h) => {
      const zAt = (z: number) => ((z - Z_FRONT) / (Z_BACK - Z_FRONT)) * h;
      for (let r = -ROWS_BEHIND; r <= ROWS_AHEAD; r++) {
        const z0 = zAt(rowZ(r) - 0.62);
        const z1 = zAt(rowZ(r) + 0.04);
        for (const [x0, x1] of [[0, 0.4], [0.6, 1]]) {
          const g = c.createLinearGradient(0, z0, 0, z1);
          g.addColorStop(0, 'rgba(0,0,0,0)');
          g.addColorStop(0.5, 'rgba(0,0,0,0.75)');
          g.addColorStop(1, 'rgba(0,0,0,0.2)');
          c.fillStyle = g;
          c.fillRect(x0 * w, z0, (x1 - x0) * w, z1 - z0);
        }
      }
      // and along the foot of the walls
      for (const [from, to] of [[0, 0.14 * w], [w, 0.86 * w]]) {
        const g = c.createLinearGradient(from, 0, to, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.8)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
      }
    }).texture;
    const grimeFloor = new Mesh(new PlaneGeometry(2.6, Z_BACK - Z_FRONT), new MeshBasicMaterial({ map: grime, color: 0x000000, transparent: true, depthWrite: false }));
    grimeFloor.rotation.x = -Math.PI / 2;
    grimeFloor.position.set(0, 0.003, (Z_FRONT + Z_BACK) / 2);
    grimeFloor.renderOrder = 1;
    grimeFloor.frustumCulled = false;
    root.add(grimeFloor);

    // the window bezels, through the hull, and their scratched inner panes
    const bezel = mergeGeometries([
      meterUVs(new CylinderGeometry(1, 1, HULL, 40, 1, true).rotateZ(Math.PI / 2).scale(1, WINDOW_HALF_H, WINDOW_HALF_W).translate(HULL / 2, 0, 0)),
      meterUVs(new RingGeometry(1, 1.22, 40, 1).rotateY(Math.PI / 2).scale(1, WINDOW_HALF_H, WINDOW_HALF_W).translate(-0.004, 0, 0)),
    ])!;
    const windowRows = ROWS_AHEAD + ROWS_BEHIND + 2;
    const bezels = new InstancedMesh(bezel, new MeshStandardMaterial({ color: 0x4e4a43, roughness: 0.7, side: DoubleSide }), windowRows * 2);
    const panes = new InstancedMesh(new CircleGeometry(1, 40).rotateY(Math.PI / 2).scale(1, WINDOW_HALF_H, WINDOW_HALF_W), new MeshStandardMaterial({ color: 0x0b0f14, roughness: 0.18, transparent: true, opacity: 0.16, depthWrite: false, side: DoubleSide }), windowRows * 2);
    const m = new Matrix4();
    const q = new Quaternion();
    const v = new Vector3();
    let n = 0;
    for (let r = -ROWS_BEHIND - 1; r <= ROWS_AHEAD; r++) {
      const z = rowZ(r) - WINDOW_AHEAD;
      for (const side of [-1, 1]) {
        // a bezel is built for the right wall: it turns half round for the left one
        q.setFromAxisAngle(UP, side > 0 ? 0 : Math.PI);
        m.compose(v.set(side * WINDOW_X, WINDOW_Y, z), q, ONE);
        bezels.setMatrixAt(n, m);
        m.compose(v.set(side * (WINDOW_X + HULL * 0.75), WINDOW_Y, z), q, ONE);
        panes.setMatrixAt(n, m);
        n++;
      }
    }
    for (const mesh of [bezels, panes]) {
      mesh.frustumCulled = false;
      root.add(mesh);
    }
    bezels.castShadow = true;
    bezels.receiveShadow = true;

    // the seats
    const parts = seatPair();
    const pairs: [number, number][] = [];
    for (let r = -ROWS_BEHIND; r <= ROWS_AHEAD; r++) for (const side of [-1, 1]) pairs.push([side * PAIR_X, rowZ(r)]);
    const fabric = kit.surface('linen_white', 0.22, { color: new Color(SEAT_CLOTH), roughness: 1 });
    const cover = kit.surface('linen_white', 0.3, { color: new Color(COVER_CLOTH), roughness: 0.95 });
    const plastic = new MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.48 });
    const metal = new MeshStandardMaterial({ color: 0x55595e, roughness: 0.38, metalness: 0.7 });
    for (const [geometry, material] of [[parts.fabric, fabric], [parts.cover, cover], [parts.plastic, plastic], [parts.metal, metal]] as const) {
      const mesh = new InstancedMesh(geometry, material, pairs.length);
      pairs.forEach(([x, z], i) => mesh.setMatrixAt(i, m.makeTranslation(x, 0, z)));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      root.add(mesh);
    }

    // the seat-belt signs, one under the rack over each row, and their boxes
    const signTexture = canvasOf(128, 56, drawSign).texture;
    this.signs = new MeshBasicMaterial({ map: signTexture, color: new Color().setScalar(SIGN_OFF) });
    const signRows = ROWS_AHEAD + ROWS_BEHIND + 1;
    const signs = new InstancedMesh(new PlaneGeometry(0.14, 0.061), this.signs, signRows * 2);
    const boxes = new InstancedMesh(meterUVs(new RoundedBoxGeometry(0.17, 0.08, 0.05, 1, 0.01)), plastic, signRows * 2);
    n = 0;
    for (let r = -ROWS_BEHIND; r <= ROWS_AHEAD; r++) {
      for (const side of [-1, 1]) {
        const x = side * (HALF_SECTION[AT_FACE][0] + 0.02);
        const z = rowZ(r) - 0.42;
        signs.setMatrixAt(n, m.makeTranslation(x, 1.575, z + 0.026));
        boxes.setMatrixAt(n, m.makeTranslation(x, 1.578, z));
        n++;
      }
    }
    for (const mesh of [signs, boxes]) {
      mesh.frustumCulled = false;
      root.add(mesh);
    }

    // the sleepers: a sack in every seat ahead, bowed, their heads fallen aside
    const crowds: Crowd[] = [
      b.sack(16, { clip: 'm_sit_chair_idle_roll_head', time: 4.2 }),
      b.sack(16, { clip: 'm_sit_chair_idle_roll_head', time: 5.6 }),
      b.sack(16, { clip: 'm_sit_chair_idle_roll_head', time: 2.8 }),
    ];
    const used = [0, 0, 0];
    const random = randomFrom(29);
    const turn = new Quaternion();
    const shift = new Matrix4().makeTranslation(0, -HIPS, 0);
    for (let r = 1; r <= ROWS_AHEAD; r++) {
      [-PAIR_X - SEAT_STEP / 2, -PAIR_X + SEAT_STEP / 2, PAIR_X - SEAT_STEP / 2, PAIR_X + SEAT_STEP / 2].forEach((sx, j) => {
        const k = (r * 4 + j) % 3;
        const crowd = crowds[k];
        // heads fall to the window in the window seats and to the aisle in the aisle seats, but for the one right in front of you
        const toWindow = Math.abs(sx) > PAIR_X || (r === 1 && sx < 0);
        const aside = Math.sign(sx) * (toWindow ? 1 : -1) * SLUMP * (0.5 + random() * 0.5);
        q.setFromAxisAngle(UP, Math.PI + (random() - 0.5) * 0.12);
        q.multiply(turn.setFromAxisAngle(AXIS_X, BOW * (0.7 + random() * 0.5)));
        q.multiply(turn.setFromAxisAngle(AXIS_Z, aside));
        m.compose(v.set(sx, BODY_Y + HIPS, rowZ(r) - BODY_FROM_BACK), q, ONE).multiply(shift);
        crowd.setMatrix(used[k]++, m);
      });
    }
    // their cloth is burlap with a coarse weave: a copy of each material, the bodies' own are shared
    const burlap = new Map<MeshStandardMaterial, MeshStandardMaterial>();
    crowds.forEach((crowd, i) => {
      crowd.drawn = used[i];
      crowd.commit();
      crowd.root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        const source = mesh.material as MeshStandardMaterial;
        let cloth = burlap.get(source);
        if (!cloth) {
          cloth = source.clone();
          cloth.color.multiply(new Color(...BURLAP));
          cloth.normalMap = fabric.normalMap;
          cloth.normalScale.setScalar(WEAVE);
          cloth.roughness = 1;
          burlap.set(source, cloth);
        }
        mesh.material = cloth;
      });
      root.add(crowd.root);
    });

    // the telephone on the empty seat beside you
    kit.prop('phone_ornate', [WINDOW_SEAT_X + 0.02, CUSHION_TOP, rowZ(0) - 0.3], { rotation: [0, 64, 0], castShadow: true }, root);

    // the two end walls: a piece of the house's own wallpaper over dark wood, a curtain across the aisle
    const outline = new Shape(section.map(([x, y]) => new Vector2(x, y)));
    const door = new Shape();
    door.moveTo(-0.36, 0.02);
    door.lineTo(0.36, 0.02);
    door.lineTo(0.36, 1.95);
    door.lineTo(-0.36, 1.95);
    outline.holes.push(door);
    const curtainCloth = new MeshStandardMaterial({ color: 0x1d2633, roughness: 0.92 });
    for (const [z, facing] of [[Z_FRONT, 0], [Z_BACK, Math.PI]] as const) {
      const end = new Group();
      const wall = new Mesh(meterUVs(new ShapeGeometry(outline, 6)), b.damask(PALETTE.damaskTeal, 0.75));
      wall.receiveShadow = true;
      end.add(wall);
      for (const side of [-1, 1]) b.wainscot(side * 0.83, 0.004, 0.92, '+z', end, 0.95);
      const behind = new Mesh(new PlaneGeometry(0.9, 2.1), new MeshBasicMaterial({ color: 0x000000 }));
      behind.position.set(0, 1.0, -0.3);
      end.add(behind);
      const drape = kit.prop('curtains', [0, 0, -0.06], {}, end);
      drape.scale.set(0.38, 0.85, 1);
      kit.paint(drape, curtainCloth);
      end.position.z = z;
      end.rotation.y = facing;
      root.add(end);
    }

    // outside: the hull below the windows, the wing with its engine, the cloud far below, the sky
    const skinTexture = canvasOf(512, 512, drawSkin).texture;
    skinTexture.wrapS = skinTexture.wrapT = RepeatWrapping;
    skinTexture.repeat.set(1 / 1.6, 1 / 1.6);
    const skin = new MeshStandardMaterial({ map: skinTexture, roughness: 0.42, metalness: 0.55 });
    const belly: P2[] = [[-WINDOW_X - HULL, 0.8], [-1.6, 0.4], [-1.52, 0.05], [-1.38, -0.3], [-1.12, -0.6], [-0.7, -0.82], [0, -0.92]];
    // the belly runs downward, so its right is outward
    const hull = new Mesh(sweep(belly, Z_FRONT - 4, Z_BACK + 4, true, { uSpan: 1, vFrom: 0, vSpan: 1 }), skin);
    const wing = new Mesh(wingGeometry(), skin);
    const cowl = new LatheGeometry(
      [[0, 0], [0.16, 0.06], [0.3, 0.3], [0.5, 0.5], [0.58, 0.9], [0.58, 2.6], [0.5, 4.0], [0.3, ENGINE_Z[1] - ENGINE_Z[0]]].map(([a, c]) => new Vector2(a, c)),
      28,
    ).rotateX(Math.PI / 2);
    const engineY = WING_Y + (-ENGINE_X - WING_ROOT) * DIHEDRAL - 0.12;
    const engine = new Mesh(meterUVs(cowl.translate(ENGINE_X, engineY, ENGINE_Z[0])), skin);
    for (const part of [hull, wing, engine]) {
      part.receiveShadow = true;
      part.frustumCulled = false;
      root.add(part);
    }

    const cloud = canvasOf(256, 256, drawCloud).texture;
    cloud.colorSpace = NoColorSpace;
    cloud.wrapS = cloud.wrapT = RepeatWrapping;
    this.sky = new ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: { uCloud: { value: cloud }, uFlow: { value: 0 } }, side: BackSide, depthWrite: false });
    const sky = new Mesh(new SphereGeometry(SKY_RADIUS, 32, 16), this.sky);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    root.add(sky);

    // the one warm light far below, seen through your window past the wing's trailing edge
    const yaw = FAR_LIGHT_YAW * DEG;
    const pitch = FAR_LIGHT_PITCH * DEG;
    const through = new Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const far = new Vector3(...LEAN).addScaledVector(through, FAR_LIGHT_DISTANCE);
    const glow = b.glow(far.x, far.y, far.z, FAR_LIGHT_SIZE, WARM, FAR_LIGHT_GLOW, root, 3.2);
    this.farLight = (glow.material as ShaderMaterial).uniforms.uColor as { value: Color };
    this.farColor = this.farLight.value.clone();

    // the house: its wall, its window, the lit curtain with the shadows of the table on it
    this.house.visible = false;
    const [hx, hy, hz] = HOUSE;
    const [ww, wh] = HOUSE_WALL;
    const wallShape = new Shape();
    wallShape.moveTo(-ww / 2, -WALL_BELOW);
    wallShape.lineTo(ww / 2, -WALL_BELOW);
    wallShape.lineTo(ww / 2, wh - WALL_BELOW);
    wallShape.lineTo(-ww / 2, wh - WALL_BELOW);
    const opening = new Shape();
    opening.moveTo(-0.98, -0.72);
    opening.lineTo(0.98, -0.72);
    opening.lineTo(0.98, 0.72);
    opening.lineTo(-0.98, 0.72);
    wallShape.holes.push(opening);
    const houseWall = new Mesh(meterUVs(new ShapeGeometry(wallShape, 4)), kit.surface('plaster_damaged', 1.85, { color: new Color(0x9a8a78) }));
    houseWall.receiveShadow = true;
    const facing = new Group();
    facing.add(houseWall);
    const sill = new Mesh(meterUVs(new RoundedBoxGeometry(2.3, 0.07, 0.22, 2, 0.015)), kit.surface('plaster_damaged', 1.85, { color: new Color(0x6f655a) }));
    sill.position.set(0, -0.79, 0.09);
    facing.add(sill);
    kit.prop('window_wood', [0, -0.75, 0.02], {}, facing);
    const { texture: curtainTexture, canvas: curtainCanvas } = canvasOf(512, 384, (c, w, h) => drawCurtain(c, w, h, 0, 0));
    this.curtain = new MeshBasicMaterial({ map: curtainTexture, fog: false, color: new Color(0, 0, 0) });
    const cloth = new Mesh(new PlaneGeometry(1.98, 1.46), this.curtain);
    cloth.position.z = -0.1;
    facing.add(cloth);
    const backing = new Mesh(new PlaneGeometry(2.2, 1.7), new MeshBasicMaterial({ color: 0x000000 }));
    backing.position.z = -0.12;
    facing.add(backing);
    facing.rotation.y = Math.PI / 2;
    facing.position.set(hx, hy, hz);
    this.house.add(facing);
    root.add(this.house);
    const ctx2d = curtainCanvas.getContext('2d')!;
    this.redrawCurtain = (stand, come) => {
      drawCurtain(ctx2d, curtainCanvas.width, curtainCanvas.height, stand, come);
      curtainTexture.needsUpdate = true;
    };

    // light: the night light down the cabin, its lamps along the ceiling; the house; the moon on the wing
    this.blueKey = this.spot([0, 1.8, MY_BACK_Z + 2.4], [-0.1, 0, Z_FRONT + 4], NIGHT, BLUE_KEY, 34, 0.85);
    this.houseKey = this.spot([hx + 0.3, hy + 0.05, hz], [1.2, 0.85, hz - 0.2], WARM, 0, 28, 0.5);
    this.spots = [this.blueKey, null, null];
    for (const z of [MY_BACK_Z + 1.7, -2.3, -6.1, -9.9]) this.coveLamps.push(this.light([0, COVE_LAMP_Y, z], NIGHT, COVE_LAMP, 4.8));
    this.spill = this.light([hx + 0.5, hy + 0.3, hz], WARM, 0, 1.9);
    // the moon on the wing only: it never reaches the cabin
    this.light([-9, 4.5, 1], 0x9fb4cc, WING_MOON, 8);

    this.motes = b.motes(240, { x: [-1.3, 1.3], y: [0.4, 2.0], z: [Z_FRONT, Z_BACK] }, root, { strength: 0.16, color: 0xb6c6dc }).time;

    // sound: the engines and the air of the cabin, the sleepers' breath; the chime; one creak; then nothing at all
    const s = this.sound;
    this.beat(0, () => {
      this.engines = [
        s.bed('rooms/dream_drone_metal.mp3', { gain: 0.11, fade: 0.6 }),
        s.bed('rooms/cable_hum.mp3', { gain: 0.16, lowpass: 700, fade: 0.6 }),
        s.bed('rooms/wind_high_tube.mp3', { gain: 0.07, lowpass: 900, pan: -0.3, fade: 0.8 }),
        s.bed('rooms/duct_air.mp3', { gain: 0.1, fade: 0.6 }),
        s.bed('rooms/air_rush.mp3', { gain: 0.05, lowpass: 800, fade: 0.8 }),
      ];
      this.sleepers = s.bed('rooms/breath_sack.mp3', { gain: 0.06, pan: 0.1, lowpass: 1400, fade: 1.5 });
    });
    this.beat(CHIME_AT, () => s.play('rooms/ding_two_note.mp3', { gain: 0.26, reverb: 0.2, pan: -0.1 }));
    this.beat(LINE_AT, () => this.say({ tr: 'Aşağıdaki ışık, sizin mutfak.', en: 'The light down there is your kitchen.' }, 3.5));
    this.beat(CREAK_AT, () => s.play('rooms/hull_creak_1.mp3', { gain: 0.13, lowpass: 1600, pan: -0.45 }));
    this.beat(STOP_AT, () => {
      for (const e of this.engines) {
        e.rate(0.35, SPIN_DOWN);
        e.gain(0, SPIN_DOWN);
      }
      this.sleepers?.gain(0, 0.4);
    });
    this.beat(SHUTTER_AT, () => this.shutter(false));
    this.beat(RING_AT, () => s.play('rooms/phone_ring.mp3', { gain: 0.5, pan: -0.35, reverb: 0.15 }));
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    this.motes.value = frame.time;

    // the engines stop: the night light sags, the cloud below stops dead, and the eye stops floating
    const sag = 1 - SAG * smootherstep(range(STOP_AT, STOP_AT + 0.8, s));
    this.blueKey.intensity = BLUE_KEY * sag;
    for (const l of this.coveLamps) l.intensity = COVE_LAMP * sag;
    this.lining.emissiveIntensity = COVE_GLOW * sag;
    this.sky.uniforms.uFlow.value = FLIGHT_SPEED * (s < STOP_AT ? s : STOP_AT + HANG * (1 - Math.exp(-(s - STOP_AT) / HANG)));
    this.drift = REDUCED_MOTION || s >= STOP_AT ? 0 : 0.3 * (1 - range(STOP_AT - 0.6, STOP_AT, s));

    // the seat-belt signs, at the chime
    this.signs.color.setScalar(lerp(SIGN_OFF, SIGN_ON, range(CHIME_AT, CHIME_AT + 0.12, s)));

    // the light far below goes once the engines are off; the house comes on
    this.farLight.value.copy(this.farColor).multiplyScalar(1 - range(STOP_AT + 0.4, STOP_AT + 1.6, s));
    const on = smootherstep(range(HOUSE_ON, HOUSE_ON + HOUSE_RAMP, s));
    this.house.visible = on > 0;
    this.houseKey.intensity = HOUSE_KEY * on;
    this.spill.intensity = HOUSE_SPILL * on;
    this.curtain.color.setRGB(CURTAIN_GAIN * on, CURTAIN_GAIN * on, CURTAIN_GAIN * on);
    const key = on > 0 ? this.houseKey : this.blueKey;
    if (this.spots[0] !== key) this.spots = on > 0 ? [this.houseKey, this.blueKey, null] : [this.blueKey, null, null];

    // one of them gets up and comes to the glass
    const stand = range(STAND[0], STAND[1], s);
    const come = range(COME[0], COME[1], s);
    const drawn = Math.round(stand * 40) + Math.round(come * 60) * 41;
    if (drawn !== this.drawn) {
      this.drawn = drawn;
      this.redrawCurtain(stand, come);
    }

    this.fear = 0.15 + 0.15 * range(9, STOP_AT, s) + 0.2 * range(HOUSE_ON, STAND[1], s) + 0.12 * range(COME[0], SHUTTER_AT, s) - 0.1 * range(RING_AT + 1, CUT_AT, s);
    this.black = s >= CUT_AT ? 1 : 0;
  }
}
