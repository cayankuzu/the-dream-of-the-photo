import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  HalfFloatType,
  LatheGeometry,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Bone,
  type Material,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { SpotSpec } from '../../../config/nightmare.config';
import { rigClock, setClock, type ClockHand } from '../../dream/ClockRig';
import { meterUVs } from '../../dream/DreamKit';
import { randomFrom, type HeroFigure } from '../../dream/FigureKit';
import type { DreamLight } from '../../dream/LightPool';
import { clamp, DEG, lerp, range, smootherstep, wobble } from '../../math';
import { GlideTrack } from '../../timeline/Track';
import { clockNow } from '../FourthWall';
import type { RoomAir, RoomAssets, RoomContext, RoomControl, RoomFrame, RoomKey, RoomPose } from '../Room';
import { Room } from '../Room';
import type { RoomVoice } from '../RoomSound';
import { PALETTE } from '../RoomKit';

export const assets: RoomAssets = {
  models: ['sofa_leather', 'armchair_green', 'console', 'tv_retro', 'phone_ornate', 'wall_clock', 'coat', 'hanger', 'coat_stand', 'fedora', 'radiator', 'door_six', 'door_frame', 'staircase', 'bookshelf_worn', 'curtains', 'window_wood', 'tea_glass', 'light_switch'],
  materials: ['wood_floor_dark', 'plaster_pale', 'carpet_dirty', 'wood_raw_boards', 'linen_white'],
  sounds: [
    'rooms/house_tone.mp3', 'rooms/clock_tick.mp3', 'rooms/dream_drone_low.mp3',
    'rooms/phone_ring.mp3', 'rooms/phone_pickup_1.mp3', 'rooms/phone_hangup_2.mp3', 'rooms/phone_line_breath.mp3', 'rooms/phone_line_dead.mp3',
    'rooms/steps_above_walk.mp3', 'rooms/steps_above_stop.mp3', 'rooms/dust_fall_1.mp3', 'rooms/dust_fall_2.mp3',
    'rooms/stair_tread_1.mp3', 'rooms/stair_tread_2.mp3', 'rooms/stair_tread_3.mp3', 'rooms/stair_tread_4.mp3', 'rooms/stair_tread_5.mp3',
    'rooms/stair_creak_1.mp3', 'rooms/stair_creak_4.mp3', 'rooms/wardrobe_door.mp3',
    'rooms/breath_scared.mp3', 'rooms/breath_held.mp3', 'rooms/breath_let_go.mp3', 'rooms/heart_beat.mp3', 'rooms/gasp_small.mp3',
    'rooms/door_handle_slow.mp3', 'rooms/door_handle_slow_2.mp3', 'rooms/door_creak_slow.mp3', 'rooms/door_shut_soft.mp3', 'rooms/switch_small.mp3',
    'rooms/tread_heavy_1.mp3', 'rooms/tread_heavy_2.mp3', 'rooms/tread_heavy_3.mp3', 'rooms/tread_heavy_4.mp3',
    'rooms/neck_sway.mp3', 'rooms/throat_crackle.mp3', 'rooms/sniff_1.mp3', 'rooms/sniff_2.mp3', 'rooms/belt_slither_1.mp3', 'rooms/belt_slither_2.mp3', 'rooms/slat_push.mp3',
    'rooms/tv_on.mp3', 'rooms/tv_static.mp3', 'rooms/tv_hum.mp3', 'rooms/coat_move.mp3',
  ],
};

type V3 = readonly [number, number, number];

/** The room (m): x from LEFT to RIGHT, z from REAR to FAR. */
const LEFT = -2.2;
const RIGHT = 2.4;
const REAR = 1.1;
const FAR = -4.1;
const HEIGHT = 2.62;
/** Height of the picture rail (m). */
const RAIL_Y = 2.14;
/** The lower panelling (m). */
const WAINSCOT_H = 0.92;
const PAPER = ['#18241f', '#3e5647'] as const;

const COUCH_AT: V3 = [0.1, 0, -1.12];
/** Where the eye sits, and where it stands in the wardrobe (and, turning round, against the slats). */
const EYE_COUCH: V3 = [0.55, 1.1, -1.0];
const EYE_WARDROBE: V3 = [1.5, 1.52, 0.57];
const EYE_TURNED: V3 = [1.5, 1.52, 0.47];
/** Leaning forward on the couch, to see the foot of the door over the table. */
const EYE_LEAN: V3 = [0.2, 1.28, -1.38];

const TABLE = { x: 1.05, z: -2.02, heading: -32 * DEG };
/** Table top height of the lamp table (m), and where on it the telephone stands (its local x, z). */
const TABLE_TOP = 0.7575;
const PHONE_ON_TABLE: readonly [number, number] = [-0.24, 0.04];
/** The telephone's bakelite: how rough, how much of the room it reflects, and how much lighter than the model's near-black it is. */
const PHONE_ROUGHNESS = 0.55;
const PHONE_SHEEN = 0.2;
const PHONE_LIFT = 10;
/** Where the handset ends up hanging from: an edge of the table (local x, z), and on how much cord (m). */
const HANG_FROM: readonly [number, number] = [0.42, 0.1];
const HANG_LENGTH = 0.42;

const TV_X = -0.2;
const TV_Z = FAR + 0.33;
/** Console height under the television (m), the telly's turn toward the room (deg). */
const CONSOLE_TOP = 0.93;
const TV_TURN = 14;
/** The picture on the set: its size (px), how far behind the wardrobe the unseen camera stands, its lens. */
const PICTURE = { width: 256, height: 192, at: [1.12, 1.74, 1.82] as V3, look: [1.53, 1.5, 0.45] as V3, fov: 25, gain: 2.6, coatShift: 0.2, coatDark: 0.035 };

const DOOR = { x: 1.45, width: 0.86, height: 2.03, slab: 0.838, gap: 0.03, swing: 1.35 };
const LEVER_AT: V3 = [0.765, 1.03, 0.033];
const STAND_AT: V3 = [-1.28, 0, -3.78];

/** The wardrobe's outside (m) and its slats: spacing, depth, thickness, tilt, depth of their middle, the gap the eye looks through. */
const WARD = { x0: 1.12, x1: 2.4, front: 0.16, top: 2.16, plinth: 0.1, rail: 1.98, hangZ: 0.9, hangX: 1.6 };
const SLAT = { pitch: 0.058, depth: 0.07, thick: 0.011, tilt: 11 * DEG, z: 0.205, gapY: 1.485, low: 0.2, high: 2.02 };

const MAN_SCALE = 1.14;
const WALK_CLIP = 'm_walk_bruised';
const STAND_CLIP = 'm_idle_roll_head_01';
/** Clip speed while walking. */
const WALK_RATE = 0.8;
/** The neck: radius at the collar (m), share of it left at the tip. */
const NECK_R = 0.052;
const NECK_TAPER = 0.36;

/** Seconds into the room. */
const RING_AT = 12;
const ANSWER_LATEST = 20;
const WARDROBE_AT = 36;
const HOLD_FROM = 37.3;
const HOLD_TO = 58;
const HANDLE_AT = 40.2;
const DOOR_OPENS = [41.5, 43.1] as const;
const PUSH_FROM = 52.9;
const WITHDRAW_PUSHED = 55.2;
const WITHDRAW_HELD = 56.1;
const BLINK_AWAY = 56.95;
const DOOR_CLOSES = [57.55, 58.15] as const;
const LAMP_OFF = 59.05;
/** The set's picture is taken once: the door has shut, the lamp still burns. */
const CAPTURE_AT = 58.9;
const TV_ON = 62;
const PICTURE_MIX = [63.9, 65.6] as const;
const SHUTTER_LATEST = 66;
/** When the white hair slides down over the view, and how far ahead of the eye it hangs (m). */
const HAIR_FALL = [64.4, 66] as const;
const LENS_HAIR_Z = 0.12;
/** While the view swings from the set to the coat, the hair slides to the edge of the lens, clear of the hanger and the collar (s; half-heights of the view). */
const HAIR_ASIDE = [69.6, 70.7] as const;
const HAIR_ASIDE_X = -0.7;
const HAIR_ASIDE_Y = -0.9;
const RING_AGAIN = 67;
const LOOK_FREE = 69.8;
const TURN_AT = 71;
const CUT_AT = 74;

/** Lamp: point light, its shade's glow, the spot that casts (toward the far wall, toward the wardrobe). Then the window, the stairs, the telly. */
const LAMP_POINT = 3.1;
const SHADE_GLOW = 1.05;
const LAMP_HALO = 0.3;
const LAMP_SPOT = 5.5;
const LAMP_SPOT_NEAR = 15;
const WINDOW_SPOT = 3.4;
const STAIR_SPOT = 4.2;
const TV_POINT = 1.15;
const TV_SPOT = 44;
/** When you are facing the coat: how much of the barred light is left, the soft light that replaces it, and what the coat's red lining loses. */
const COAT_BARS = 0.24;
const COAT_GLOW = 0.22;
const COAT_TINT = new Color(0.5, 0.72, 0.74);
/** The door's casing is old paint, not a white outline. */
const DOOR_FRAME_DIM = 0.42;

/** Seconds, x, z, heading (deg, 0 faces the wardrobe side). The jump at the blink is a thing only a dream does. */
const MAN_KEYS: readonly (readonly [number, number, number, number])[] = [
  [41, DOOR.x, FAR - 0.42, 0],
  [43.5, DOOR.x, FAR - 0.42, 0],
  [45.7, 1.72, -2.68, 2],
  [46.2, 1.72, -2.64, -24],
  [47.6, 1.72, -2.64, -24],
  [48.3, 1.72, -2.24, -6],
  [50.25, EYE_WARDROBE[0] - 0.08, WARD.front - 0.6, 0],
  [BLINK_AWAY - 0.02, EYE_WARDROBE[0] - 0.08, WARD.front - 0.6, 0],
  [BLINK_AWAY + 0.02, DOOR.x, FAR + 0.34, 180],
  [BLINK_AWAY + 0.1, DOOR.x, FAR + 0.34, 180],
  [57.9, DOOR.x, FAR - 0.46, 180],
];

/** Each step overhead: seconds, where on the ceiling (x, z), how hard. */
const STEP_DUST: readonly (readonly [number, number, number, number])[] = [
  [24.4, -1.5, -2.3, 0.5],
  [25.1, -1.05, -2.5, 0.8],
  [25.9, -0.55, -2.35, 0.7],
  [26.6, -0.05, -2.55, 1.2],
  [27.4, 0.4, -2.4, 0.9],
  [28.2, 0.9, -2.6, 0.7],
  [29, 1.3, -2.9, 0.6],
];

/** Each tread down the stairs: seconds, which file, gain. */
const STAIRS: readonly (readonly [number, number, number])[] = [
  [30.4, 1, 0.16],
  [31.55, 2, 0.21],
  [32.7, 3, 0.27],
  [33.85, 4, 0.34],
  [34.8, 5, 0.42],
];

/** His steps through the room: seconds, which file, gain, pan. */
const TREADS: readonly (readonly [number, number, number, number])[] = [
  [43.7, 1, 0.3, -0.04],
  [44.5, 2, 0.34, 0.02],
  [45.3, 3, 0.38, 0.08],
  [47.85, 4, 0.42, 0.1],
  [48.6, 2, 0.46, 0.06],
  [49.3, 3, 0.52, 0.02],
  [50.0, 1, 0.6, 0],
  [57.3, 4, 0.34, -0.03],
];

/** Nothing is allocated while the room runs. */
const vA = new Vector3();
const vT = new Vector3();
const vN = new Vector3();
const vS = new Vector3();
const vF = new Vector3();
const vR = new Vector3();
const AXIS = new Vector3(Math.sin(TABLE.heading), 0, Math.cos(TABLE.heading));
const HANG_SIDE = new Vector3(Math.cos(TABLE.heading), 0, -Math.sin(TABLE.heading));

function canvasMap(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Whatever this was painted, it has gone darker. */
function dim(o: Object3D, k: number): void {
  o.traverse((m) => {
    const mesh = m as Mesh;
    if (!mesh.isMesh) return;
    const material = (mesh.material as MeshStandardMaterial).clone();
    material.color.multiplyScalar(k);
    mesh.material = material;
  });
}

/** A lampshade of yellowed pleated cloth, browned where the bulb has been at it for years. */
function drawShade(c: CanvasRenderingContext2D, w: number, h: number): void {
  const down = c.createLinearGradient(0, 0, 0, h);
  down.addColorStop(0, '#6a4a1c');
  down.addColorStop(0.3, '#d8a860');
  down.addColorStop(0.62, '#f7deb0');
  down.addColorStop(1, '#b8843f');
  c.fillStyle = down;
  c.fillRect(0, 0, w, h);
  const random = randomFrom(23);
  for (let x = 0; x < w; x += 5) {
    c.fillStyle = `rgba(64,36,12,${0.07 + random() * 0.2})`;
    c.fillRect(x, 0, 1.6, h);
  }
  for (let i = 0; i < 9; i++) {
    const x = random() * w;
    const y = random() * h * 0.6;
    const r = 14 + random() * 42;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(70,38,12,0.2)');
    g.addColorStop(1, 'rgba(70,38,12,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** The wood of the slats: thin, dry, pale at their edges where the lacquer has gone. */
function drawSlat(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(5);
  c.fillStyle = '#4d3826';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const y = random() * h;
    c.strokeStyle = i % 4 ? `rgba(16,9,4,${0.14 + random() * 0.3})` : `rgba(150,112,78,${0.08 + random() * 0.16})`;
    c.lineWidth = 0.6 + random() * 1.4;
    c.beginPath();
    c.moveTo(0, y);
    c.bezierCurveTo(w * 0.3, y + (random() - 0.5) * 6, w * 0.6, y + (random() - 0.5) * 6, w, y);
    c.stroke();
  }
  for (let i = 0; i < 20; i++) {
    c.fillStyle = `rgba(12,7,3,${0.1 + random() * 0.3})`;
    c.fillRect(random() * w, random() * h, 3 + random() * 40, 1 + random() * 3);
  }
}

/** A kilim worn thin: nested borders, stepped lozenges, a road walked into it from the couch to the set. */
function drawRug(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(41);
  c.fillStyle = '#100c0a';
  c.fillRect(0, 0, w, h);
  const fringe = w * 0.016;
  c.strokeStyle = 'rgba(176,160,126,0.8)';
  c.lineWidth = 1.5;
  for (let y = 2; y < h; y += 4.2) {
    c.beginPath();
    c.moveTo(random() * 3, y + random() * 3);
    c.lineTo(fringe + 1, y);
    c.moveTo(w - random() * 3, y + random() * 3);
    c.lineTo(w - fringe - 1, y);
    c.stroke();
  }
  const frame = (inset: number, color: string) => {
    c.fillStyle = color;
    c.fillRect(fringe + inset * w, inset * w, w - 2 * fringe - 2 * inset * w, h - 2 * inset * w);
  };
  frame(0, '#171f26');
  frame(0.012, '#6a593e');
  frame(0.018, '#2c1212');
  frame(0.052, '#675339');
  frame(0.058, '#142027');
  frame(0.083, '#6a2019');
  frame(0.09, '#3a1410');
  const zig = (y: number, color: string) => {
    c.strokeStyle = color;
    c.lineWidth = 5;
    c.beginPath();
    for (let x = fringe + 0.03 * w, i = 0; x < w - fringe - 0.03 * w; x += 11, i++) c.lineTo(x, y + (i % 2 ? 7 : -7));
    c.stroke();
  };
  zig(0.035 * w, '#a08a62');
  zig(h - 0.035 * w, '#a08a62');
  const lozenge = (cx: number, cy: number, rx: number, ry: number, color: string, steps = 9) => {
    c.fillStyle = color;
    for (let i = -steps; i <= steps; i++) {
      const half = rx * (1 - Math.abs(i) / (steps + 1));
      c.fillRect(cx - half, cy + (i * ry) / steps - ry / steps / 2, half * 2, ry / steps + 1);
    }
  };
  for (let k = 0; k < 3; k++) {
    const cx = w * (0.25 + k * 0.25);
    const ry = h * 0.36;
    const rx = w * 0.14;
    lozenge(cx, h / 2, rx, ry, '#141d23', 11);
    lozenge(cx, h / 2, rx * 0.85, ry * 0.85, '#8a7450', 10);
    lozenge(cx, h / 2, rx * 0.74, ry * 0.74, '#4b1812', 9);
    lozenge(cx, h / 2, rx * 0.42, ry * 0.42, '#12303a', 7);
    lozenge(cx, h / 2, rx * 0.18, ry * 0.18, '#a48c62', 4);
    for (const dy of [-1, 1]) lozenge(cx + w * 0.125, h / 2 + dy * h * 0.24, w * 0.04, h * 0.075, '#70603f', 4);
  }
  // wear
  for (let i = 0; i < 26000; i++) {
    const x = random() * w;
    const y = random() * h;
    c.fillStyle = i % 2 ? `rgba(0,0,0,${0.07 + random() * 0.16})` : `rgba(190,170,130,${random() * 0.05})`;
    c.fillRect(x, y, 1 + random() * 2.2, 1 + random() * 2.2);
  }
  for (let i = 0; i < 24; i++) {
    const x = w * (0.08 + random() * 0.84);
    const y = h * (0.08 + random() * 0.84);
    const r = w * (0.03 + random() * 0.08);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${0.18 + random() * 0.3})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** Soot, damp and the slow brown of a house nobody has papered again: black with alpha, laid over a wall. */
function drawGrime(c: CanvasRenderingContext2D, w: number, h: number, seed: number, topHeavy = 1): void {
  const random = randomFrom(seed);
  const foot = c.createLinearGradient(0, h, 0, h * 0.78);
  foot.addColorStop(0, 'rgba(6,4,2,0.5)');
  foot.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = foot;
  c.fillRect(0, h * 0.78, w, h * 0.22);
  const top = c.createLinearGradient(0, 0, 0, h * 0.2);
  top.addColorStop(0, `rgba(6,4,2,${0.55 * topHeavy})`);
  top.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = top;
  c.fillRect(0, 0, w, h * 0.2);
  for (let i = 0; i < 46; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = (0.03 + random() * 0.13) * w;
    const g = c.createRadialGradient(x, y, r * 0.1, x, y, r);
    g.addColorStop(0, `rgba(10,7,3,${0.09 + random() * 0.24})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 40; i++) {
    let x = random() * w;
    let y = random() * h * 0.12;
    c.strokeStyle = `rgba(16,11,6,${0.06 + random() * 0.16})`;
    c.lineWidth = 1 + random() * 4;
    c.beginPath();
    c.moveTo(x, y);
    const end = y + (0.15 + random() * 0.55) * h;
    while (y < end) {
      y += 24;
      x += (random() - 0.5) * 7;
      c.lineTo(x, y);
    }
    c.stroke();
  }
}

/** The ceiling: rings of old leaks, brown at their edges, and a crack across them. */
function drawStain(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(29);
  for (let k = 0; k < 7; k++) {
    const x = w * (0.25 + random() * 0.5);
    const y = h * (0.25 + random() * 0.5);
    const r = Math.min(w, h) * (0.1 + random() * 0.32);
    const g = c.createRadialGradient(x, y, r * 0.55, x, y, r);
    g.addColorStop(0, 'rgba(40,26,12,0.1)');
    g.addColorStop(0.86, 'rgba(46,30,14,0.2)');
    g.addColorStop(0.95, 'rgba(26,16,8,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.save();
    c.translate(x, y);
    c.scale(1, 0.7 + random() * 0.5);
    c.rotate(random() * 3);
    c.translate(-x, -y);
    c.fillRect(x - r * 1.1, y - r * 1.1, r * 2.2, r * 2.2);
    c.restore();
  }
  c.strokeStyle = 'rgba(10,6,3,0.75)';
  c.lineWidth = 1.5;
  let x = 0;
  let y = h * 0.62;
  c.beginPath();
  c.moveTo(x, y);
  while (x < w) {
    x += 14 + random() * 26;
    y += (random() - 0.5) * 34;
    c.lineTo(x, y);
  }
  c.stroke();
}

/** Father, mother, child: an old sepia sitting, and over each face a scribble of white where the emulsion is scratched away. */
function drawFamily(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(101);
  const ground = c.createRadialGradient(w / 2, h * 0.38, h * 0.1, w / 2, h * 0.5, Math.max(w, h) * 0.8);
  ground.addColorStop(0, '#6b5740');
  ground.addColorStop(1, '#1a130d');
  c.fillStyle = ground;
  c.fillRect(0, 0, w, h);
  const bust = (x: number, y: number, s: number, dark: string) => {
    c.fillStyle = dark;
    c.beginPath();
    c.ellipse(x, y + s * 2.1, s * 1.5, s * 1.4, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#a89274';
    c.beginPath();
    c.ellipse(x, y, s * 0.72, s * 0.92, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(232,226,210,0.86)';
    c.lineWidth = 1.2;
    for (let i = 0; i < 26; i++) {
      c.beginPath();
      c.moveTo(x + (random() - 0.5) * s * 1.6, y + (random() - 0.5) * s * 1.9);
      c.lineTo(x + (random() - 0.5) * s * 1.7, y + (random() - 0.5) * s * 1.9);
      c.stroke();
    }
  };
  bust(w * 0.28, h * 0.4, h * 0.12, '#1c1712');
  bust(w * 0.68, h * 0.44, h * 0.105, '#2a221a');
  bust(w * 0.5, h * 0.6, h * 0.075, '#332a1f');
  for (let i = 0; i < 700; i++) {
    c.fillStyle = `rgba(20,14,8,${random() * 0.25})`;
    c.fillRect(random() * w, random() * h, 2, 2);
  }
}

/** White crochet: a round doily with rings of holes, for under the telephone. */
function drawDoily(c: CanvasRenderingContext2D, s: number): void {
  c.translate(s / 2, s / 2);
  c.fillStyle = 'rgba(214,206,186,0.97)';
  c.beginPath();
  c.arc(0, 0, s * 0.42, 0, Math.PI * 2);
  c.fill();
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
    c.beginPath();
    c.arc(Math.cos(a) * s * 0.44, Math.sin(a) * s * 0.44, s * 0.05, 0, Math.PI * 2);
    c.fill();
  }
  c.globalCompositeOperation = 'destination-out';
  for (const [ring, size, n] of [[0.34, 0.03, 26], [0.25, 0.022, 20], [0.15, 0.018, 13], [0.42, 0.013, 42]] as const) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      c.beginPath();
      c.arc(Math.cos(a) * s * ring, Math.sin(a) * s * ring, s * size, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.globalCompositeOperation = 'source-over';
}

/** Wet skin stretched too far, seen along its length: rings of creases, veins running on. */
function drawSkin(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(77);
  c.fillStyle = '#a58d7a';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const x = random() * w;
    c.strokeStyle = `rgba(80,48,42,${0.06 + random() * 0.2})`;
    c.lineWidth = 0.8 + random() * 2.6;
    c.beginPath();
    c.moveTo(x, 0);
    c.bezierCurveTo(x + (random() - 0.5) * 30, h * 0.33, x + (random() - 0.5) * 30, h * 0.66, x, h);
    c.stroke();
  }
  for (let i = 0; i < 16; i++) {
    c.strokeStyle = `rgba(52,70,104,${0.14 + random() * 0.2})`;
    c.lineWidth = 1 + random() * 2.4;
    let x = 0;
    let y = random() * h;
    c.beginPath();
    c.moveTo(x, y);
    while (x < w) {
      x += 16 + random() * 34;
      y += (random() - 0.5) * 22;
      c.lineTo(x, y);
    }
    c.stroke();
  }
  for (let i = 0; i < 16; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = 12 + random() * 44;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(120,70,60,0.2)');
    g.addColorStop(1, 'rgba(120,70,60,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

const CRT_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const CRT_FRAG = /* glsl */ `
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uMix;
uniform float uBright;
uniform float uOpen;
uniform float uNoise;
uniform float uTime;
uniform float uRoll;
uniform float uGain;
varying vec2 vUv;
float grainAt(vec2 p, float t) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + t * 91.7) * 43758.5453); }
void main() {
  vec2 c = vUv - 0.5;
  vec2 p = 0.5 + c * (1.0 + 0.16 * dot(c, c));
  vec2 q = vec2(p.x + sin(p.y * 3.2 + uTime * 1.1) * 0.0025, fract(p.y + uRoll));
  vec3 picture = mix(texture2D(uA, q).rgb, texture2D(uB, q).rgb, uMix) * uGain;
  float shade = dot(picture, vec3(0.3, 0.59, 0.11));
  picture = mix(vec3(shade), picture, 0.3) * vec3(0.84, 0.97, 1.08);
  float grain = grainAt(floor(p * vec2(200.0, 150.0)), floor(uTime * 18.0));
  vec3 color = mix(picture, vec3(grain * 0.95), uNoise) + grain * 0.006;
  color *= 0.86 + 0.14 * sin(p.y * 130.0 * 6.2831);
  float edge = smoothstep(0.0, 0.035, min(p.x, 1.0 - p.x)) * smoothstep(0.0, 0.035, min(p.y, 1.0 - p.y));
  color *= edge * (1.08 - 1.3 * dot(c, c));
  float opened = 1.0 - smoothstep(uOpen - 0.04, uOpen, abs(p.y - 0.5));
  color = color * opened + vec3(1.0, 1.05, 1.12) * opened * (1.0 - smoothstep(0.0, 0.5, uOpen)) * 2.5;
  gl_FragColor = vec4(color * uBright, 1.0);
}
`;

const DUST_VERT = /* glsl */ `
attribute vec2 aFall;
uniform float uTime;
varying float vAlive;
void main() {
  float age = uTime - aFall.x;
  vAlive = (age < 0.0 || age > 4.6) ? 0.0 : (1.0 - smoothstep(3.0, 4.6, age));
  vec3 p = position;
  p.y -= age * aFall.y * 0.34 + age * age * 0.11;
  p.x += sin(age * 1.3 + position.z * 9.0) * 0.05;
  p.z += cos(age * 1.1 + position.x * 7.0) * 0.05;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = vAlive > 0.0 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = clamp(6.0 / max(0.2, -mv.z), 1.0, 6.0);
}
`;
const DUST_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlive;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.0) * vAlive;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

/** Share of the rings of a hollow end that make its lip; the rest go down into it. */
const LIP_SHARE = 0.2;

/** A tube of many rings that follows a few points and can be moved every frame. With `fold` rings its end is a hollow. */
class LiveTube {
  readonly mesh: Mesh;
  readonly points: Vector3[] = [];
  private readonly position: BufferAttribute;
  private readonly normal: BufferAttribute;
  private readonly centers: Float32Array;
  private readonly cosines: Float32Array;
  private readonly sines: Float32Array;

  constructor(
    private readonly rings: number,
    private readonly sides: number,
    private readonly fold: number,
    controls: number,
    along: number,
    material: Material,
    inner?: Material,
  ) {
    for (let i = 0; i < controls; i++) this.points.push(new Vector3());
    const all = rings + fold;
    const total = all * (sides + 1);
    this.position = new BufferAttribute(new Float32Array(total * 3), 3);
    this.normal = new BufferAttribute(new Float32Array(total * 3), 3);
    this.centers = new Float32Array(rings * 3);
    this.cosines = new Float32Array(sides + 1);
    this.sines = new Float32Array(sides + 1);
    for (let j = 0; j <= sides; j++) {
      this.cosines[j] = Math.cos((j / sides) * Math.PI * 2);
      this.sines[j] = Math.sin((j / sides) * Math.PI * 2);
    }
    const uv = new Float32Array(total * 2);
    const color = new Float32Array(total * 3);
    const index: number[] = [];
    for (let i = 0; i < all; i++) {
      const deep = i < rings ? 0 : (i - rings + 1) / fold;
      const w = (deep - LIP_SHARE) / (1 - LIP_SHARE);
      const fall = Math.exp(-w * 3.6) * (0.62 + 0.38 * Math.cos(w * 40));
      const r = i < rings ? 1 : deep <= LIP_SHARE ? 0.72 : 0.17 * fall;
      const g = i < rings ? 1 : deep <= LIP_SHARE ? 0.6 : 0.07 * fall;
      const b = i < rings ? 1 : deep <= LIP_SHARE ? 0.55 : 0.065 * fall;
      for (let j = 0; j <= sides; j++) {
        const k = i * (sides + 1) + j;
        uv[k * 2] = (i / all) * along;
        uv[k * 2 + 1] = j / sides;
        color[k * 3] = r;
        color[k * 3 + 1] = g;
        color[k * 3 + 2] = b;
        if (i < all - 1 && j < sides) {
          const next = k + sides + 1;
          index.push(k, k + 1, next, k + 1, next + 1, next);
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setIndex(index);
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('normal', this.normal);
    geometry.setAttribute('uv', new BufferAttribute(uv, 2));
    geometry.setAttribute('color', new BufferAttribute(color, 3));
    if (inner) {
      const skin = (rings + Math.floor(fold * LIP_SHARE) - 1) * sides * 6;
      geometry.addGroup(0, skin, 0);
      geometry.addGroup(skin, index.length - skin, 1);
    }
    this.mesh = new Mesh(geometry, inner ? [material, inner] : material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
  }

  private sample(along: number, out: Vector3): void {
    const n = this.points.length - 1;
    const f = clamp(along, 0, 1) * n;
    const i = Math.min(n - 1, Math.floor(f));
    const t = f - i;
    const a = this.points[Math.max(0, i - 1)];
    const b = this.points[i];
    const c = this.points[i + 1];
    const d = this.points[Math.min(n, i + 2)];
    const t2 = t * t;
    const t3 = t2 * t;
    const w0 = -0.5 * t3 + t2 - 0.5 * t;
    const w1 = 1.5 * t3 - 2.5 * t2 + 1;
    const w2 = -1.5 * t3 + 2 * t2 + 0.5 * t;
    const w3 = 0.5 * t3 - 0.5 * t2;
    out.set(a.x * w0 + b.x * w1 + c.x * w2 + d.x * w3, a.y * w0 + b.y * w1 + c.y * w2 + d.y * w3, a.z * w0 + b.z * w1 + c.z * w2 + d.z * w3);
  }

  private ring(i: number, cx: number, cy: number, cz: number, radius: number, axial: number, radial: number, along: number, pucker = 0, flat = 1): void {
    const { sides, cosines, sines, position, normal } = this;
    for (let j = 0; j <= sides; j++) {
      const k = i * (sides + 1) + j;
      const size = radius * (1 + pucker * (0.6 * cosines[(j * 3) % sides] + 0.4 * cosines[(j * 7) % sides]));
      const ox = vN.x * cosines[j] + vS.x * sines[j];
      const oy = vN.y * cosines[j] + vS.y * sines[j];
      const oz = vN.z * cosines[j] + vS.z * sines[j];
      position.setXYZ(k, cx + vT.x * axial + ox * size, cy + vT.y * axial + oy * size * flat, cz + vT.z * axial + oz * size);
      normal.setXYZ(k, ox * radial + vT.x * along, oy * radial + vT.y * along, oz * radial + vT.z * along);
    }
  }

  /** Lay the tube along its points: `girth` is its radius along it (0..1); `mouth` 0..1 how far the hollow end stands open. */
  solve(girth: (along: number) => number, mouth = 0.5, flat = 1): void {
    const { rings, fold, centers } = this;
    const last = rings - 1;
    for (let i = 0; i <= last; i++) {
      this.sample(i / last, vA);
      centers[i * 3] = vA.x;
      centers[i * 3 + 1] = vA.y;
      centers[i * 3 + 2] = vA.z;
    }
    vN.set(0.31, 0.2, 0.93);
    for (let i = 0; i <= last; i++) {
      const p = Math.max(0, i - 1) * 3;
      const q = Math.min(last, i + 1) * 3;
      vT.set(centers[q] - centers[p], centers[q + 1] - centers[p + 1], centers[q + 2] - centers[p + 2]).normalize();
      vN.addScaledVector(vT, -vN.dot(vT)).normalize();
      vS.crossVectors(vT, vN);
      const end = fold > 0 ? smootherstep(range(0.82, 1, i / last)) : 0;
      this.ring(i, centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2], girth(i / last), 0, 1, 0, 0.1 * end, lerp(1, flat, end));
    }
    if (fold > 0) {
      const x = centers[last * 3];
      const y = centers[last * 3 + 1];
      const z = centers[last * 3 + 2];
      const R = girth(1);
      const lip = R * 0.09;
      const open = lerp(0.74, 1, mouth);
      for (let k = 0; k < fold; k++) {
        const v = (k + 1) / fold;
        if (v <= LIP_SHARE) {
          const phi = (Math.PI * v) / LIP_SHARE;
          this.ring(rings + k, x, y, z, (R - lip + lip * Math.cos(phi)) * open, lip * Math.sin(phi), Math.cos(phi), Math.sin(phi), 0.2, flat);
        } else {
          const w = (v - LIP_SHARE) / (1 - LIP_SHARE);
          const rib = 1 + 0.08 * Math.cos(w * 40);
          this.ring(rings + k, x, y, z, lerp(R - 2 * lip, 0, Math.min(1, w * w + 0.05)) * open * rib, -w * R * 5.5, -1, 0, 0.2 * (1 - w), flat);
        }
      }
    }
    this.position.needsUpdate = true;
    this.normal.needsUpdate = true;
  }
}

/**
 * A living room at night, anyone's, seen from the couch: a television off, a telephone, a lamp, a clock that says
 * what the viewer's own clock says, a door with the light of the stairs under it. Someone rings to say he is
 * upstairs. Then the viewer stands in a wardrobe behind its slats, and a tall man with no head comes in with his long
 * neck hanging in front of him, feeling the air. He finds the slats. He goes. And the television comes on by itself.
 */
export default class Home extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x090c0b, density: 0.04 },
    env: 'bathroom',
    envIntensity: 0.07,
    sky: 0,
    grade: { exposure: 1.2, saturation: 0.74, warmth: 0.03, tint: -0.02, flare: 0.002 },
  };
  film = { bloom: 1, bloomFrom: 0.72, grain: 0.42, scratches: 0.05, flicker: 0.025, weave: 0.0004 };
  focus = 3.2;
  aperture = 2.6;
  drift = 0.5;
  control: RoomControl = { look: true, scroll: true, press: false, hurry: 2 };

  private readonly clocks: { value: number }[] = [];
  private readonly lampShade: MeshStandardMaterial;
  private readonly lampPoint: DreamLight;
  private readonly tvPoint: DreamLight;
  private readonly fill: DreamLight;
  private readonly lampGlow: Mesh;
  private readonly pictureLight: DreamLight;
  private readonly neckLight: DreamLight;
  private tvGlass: MeshStandardMaterial | null = null;
  private tvCasing: MeshStandardMaterial | null = null;
  private underDoor!: Mesh;
  private readonly keysFar: readonly (SpotSpec | null)[];
  private readonly keysNear: readonly (SpotSpec | null)[];
  private readonly keysTv: readonly (SpotSpec | null)[];
  private readonly spotFar: SpotSpec;
  private readonly spotNear: SpotSpec;
  private readonly spotTv: SpotSpec;
  private readonly coatLight: DreamLight;

  private readonly clockHands: ClockHand[];
  private clockBase = -1;

  private readonly doorPivot = new Group();
  private readonly lever = new Group();
  private readonly feet: Mesh[] = [];
  private readonly pendant = new Group();
  private readonly dustTime = { value: 0 };

  private readonly standCoat: Object3D;
  private readonly hanging = new Group();
  private readonly coatMaterials: MeshStandardMaterial[] = [];
  private readonly hairOnLens = new Group();
  private readonly you: Object3D;
  private readonly otherNeck: LiveTube;
  private readonly carcass: Mesh;
  private readonly backPanel: Mesh;
  private readonly slatLeft = new Group();
  private readonly slatRight = new Group();

  private readonly phoneHandset = new Group();
  private readonly handsetRest = new Vector3();
  private readonly earAt = new Vector3(EYE_COUCH[0] + 0.22, EYE_COUCH[1] - 0.26, EYE_COUCH[2] - 0.1);
  private readonly hangAt = new Vector3();
  private readonly cordFrom = new Vector3();
  private readonly cord: LiveTube;
  private readonly cordGirth = (): number => 0.0034;

  private readonly screenUniforms = {
    uA: { value: null as Texture | null },
    uB: { value: null as Texture | null },
    uMix: { value: 0 },
    uBright: { value: 0 },
    uOpen: { value: 0 },
    uNoise: { value: 1 },
    uTime: { value: 0 },
    uRoll: { value: 0 },
    uGain: { value: PICTURE.gain },
  };
  private readonly pictureA = new WebGLRenderTarget(PICTURE.width, PICTURE.height, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false });
  private readonly pictureB = new WebGLRenderTarget(PICTURE.width, PICTURE.height, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false });
  private readonly pictureCamera = new PerspectiveCamera(PICTURE.fov, PICTURE.width / PICTURE.height, 0.05, 30);
  private captured = false;

  private readonly man: HeroFigure;
  private readonly head?: Bone;
  private readonly hips?: Bone;
  private readonly neckBone?: Bone;
  private readonly hipsRest = new Vector2();
  private walking = false;
  private lastS = 0;
  private readonly neck: LiveTube;
  private readonly hang: Vector3[] = [];
  private readonly reach: Vector3[] = [];
  private readonly collar = new Vector3();
  private neckClock = 0;
  private swallow = -1;
  private readonly neckGirth = (u: number): number => {
    const bulge = this.swallow >= 0 ? 0.016 * Math.exp(-(((u - this.swallow) / 0.05) ** 2)) : 0;
    const knob = 0.007 * Math.exp(-(((u - 0.94) / 0.035) ** 2));
    return NECK_R * (1 - (1 - NECK_TAPER) * u) * (1 + 0.05 * Math.sin(u * 46 + this.neckClock * 0.8)) + bulge + knob;
  };
  private readonly track: { x: GlideTrack; z: GlideTrack; heading: GlideTrack };

  private clockVoice: RoomVoice | null = null;
  private readonly beds = { tone: null as RoomVoice | null, drone: null as RoomVoice | null, breath: null as RoomVoice | null, phone: null as RoomVoice | null, sway: null as RoomVoice | null, throat: null as RoomVoice | null };
  private ringVoice: RoomVoice | null = null;
  private answeredAt = Infinity;
  private hintShown = '';
  private holdingBefore = false;
  private notHeld = 0;
  private pushAt = Infinity;
  private beatBefore = false;
  private shot = false;
  private gazeYaw = 0;
  private gazePitch = 0;

  constructor(ctx: RoomContext) {
    super(ctx);
    this.keys = this.path();
    this.track = {
      x: new GlideTrack(MAN_KEYS.map((k) => k[0]), MAN_KEYS.map((k) => k[1])),
      z: new GlideTrack(MAN_KEYS.map((k) => k[0]), MAN_KEYS.map((k) => k[2])),
      heading: new GlideTrack(MAN_KEYS.map((k) => k[0]), MAN_KEYS.map((k) => k[3] * DEG)),
    };

    this.shell();
    const lampAt = this.furniture();
    this.lampShade = this.tableShade;
    this.clockHands = this.wallClock();
    this.doorway();
    this.standCoat = this.coatStand();
    this.television();
    this.dust();

    // the wardrobe and what is in it
    const wardrobe = this.wardrobe();
    this.carcass = wardrobe.carcass;
    this.backPanel = wardrobe.back;
    this.you = this.yourself();

    // the skin of the neck: wet, pale; the same on the man and on what stands behind you
    const skin = canvasMap(1024, 256, drawSkin);
    skin.wrapS = skin.wrapT = RepeatWrapping;
    const neckMaterial = new MeshStandardMaterial({ map: skin, bumpMap: skin, bumpScale: 0.8, color: 0xae9b8a, roughness: 0.46, metalness: 0, vertexColors: true, side: DoubleSide });
    const hollow = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
    this.neck = new LiveTube(64, 24, 34, 6, 7, neckMaterial, hollow);
    this.neck.mesh.castShadow = true;
    this.root.add(this.neck.mesh);
    for (let i = 0; i < 6; i++) {
      this.hang.push(new Vector3());
      this.reach.push(new Vector3());
    }
    this.otherNeck = new LiveTube(40, 12, 14, 5, 5, neckMaterial, hollow);
    const [hx, hz] = [WARD.hangX, WARD.hangZ];
    const e = EYE_WARDROBE;
    const other = this.otherNeck.points;
    const side = PICTURE.coatShift;
    other[0].set(hx + side, 1.78, hz);
    other[1].set(hx + side - 0.02, 2.0, hz - 0.1);
    other[2].set(hx + side - 0.12, 2.02, hz - 0.3);
    other[3].set(e[0] + 0.16, 1.72, e[2] + 0.1);
    other[4].set(e[0] + 0.13, 1.56, e[2] + 0.015);
    this.otherNeck.solve((u) => 0.045 * (1 - 0.5 * u), 0.7);
    this.root.add(this.otherNeck.mesh);

    // the man
    this.man = this.kit.figures.hero({ avatar: 'figure_man', clip: STAND_CLIP, half: 'lower', cutAt: 1.47, bleach: 0.22, tint: 0x565c66 });
    this.man.root.scale.setScalar(MAN_SCALE);
    this.man.root.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = true;
    });
    this.root.add(this.man.root);
    this.head = this.man.bone('Bip01_Head');
    this.hips = this.man.bone('Bip01');
    this.neckBone = this.man.bone('Bip01_Neck') ?? this.head;
    this.man.update(0);
    if (this.hips) this.hipsRest.set(this.hips.position.x, this.hips.position.z);

    // the telephone
    const cordMaterial = new MeshStandardMaterial({ color: 0x0b0a09, roughness: 0.7 });
    this.cord = new LiveTube(26, 5, 0, 4, 1, cordMaterial);
    this.root.add(this.cord.mesh);
    this.telephone();

    // light
    this.lampPoint = this.light(lampAt, PALETTE.warm, LAMP_POINT, 7);
    this.lampGlow = this.build.glow(lampAt[0], lampAt[1], lampAt[2], 1.15, PALETTE.warm, LAMP_HALO, this.root);
    this.tvPoint = this.light([TV_X + 0.3, 0.95, TV_Z + 1.3], PALETTE.cold, 0, 4.3);
    this.fill = this.light([e[0], 1.74, 0.5], 0xd0c2b0, 0.05, 1.15);
    this.pictureLight = this.light([e[0] - 0.25, 1.95, 1.22], PALETTE.cold, 0, 3.4);
    this.coatLight = this.light([EYE_WARDROBE[0], 1.08, EYE_WARDROBE[2]], PALETTE.cold, 0, 1.3);
    this.neckLight = this.light([e[0], 1, -1], 0xbfae9e, 0, 1.5);
    const window = this.spot([-0.55, 1.8, REAR - 0.25], [0.4, 0.3, -3.2], 0x9fb8d6, WINDOW_SPOT, 38, 0.9);
    const stairs = this.spot([DOOR.x, 2.6, FAR - 0.25], [DOOR.x, 0, FAR - 1.1], PALETTE.warm, STAIR_SPOT, 46, 0.8);
    this.spotFar = this.spot(lampAt, [TV_X + 0.2, 0.75, FAR], PALETTE.warm, LAMP_SPOT, 64, 0.85);
    this.spotNear = this.spot(lampAt, [e[0] - 0.1, 1.15, 0.2], PALETTE.warm, LAMP_SPOT, 34, 0.75);
    this.spotTv = this.spot([TV_X, CONSOLE_TOP + 0.22, TV_Z + 0.32], [e[0] + 0.02, 1.5, e[2] + 0.2], 0xa8ccff, 0, 7, 0.45);
    this.keysFar = [this.spotFar, window, stairs];
    this.keysNear = [this.spotNear, window, stairs];
    this.keysTv = [this.spotTv, window, null];
    this.spots = this.keysFar;

    this.clocks.push(this.build.motes(130, { x: [LEFT, RIGHT], y: [0.2, HEIGHT], z: [FAR, REAR] }, this.root).time);
    this.clocks.push(this.build.motes(26, { x: [WARD.x0 + 0.1, WARD.x1 - 0.1], y: [1.0, 2.0], z: [WARD.front + 0.12, 0.6] }, this.root, { size: 0.004, strength: 0.4, seed: 5 }).time);

    this.score();
    this.lens.add(this.hairOnLens);
    this.hairOnLens.position.z = -LENS_HAIR_Z;
    this.layHair();
  }

  /** The motto, on the lens: strands of white hair that slide down over the view once the set has shown you yourself. */
  private layHair(): void {
    const random = randomFrom(47);
    const positions: number[] = [];
    const indices: number[] = [];
    for (let n = 0; n < 26; n++) {
      const x0 = -1.15 + (random() - 0.5) * 0.7;
      const end = 0.12 + random() * 0.55;
      const drift = 0.05 + random() * 0.4;
      const bow = (random() - 0.5) * 0.22;
      const width = 0.0012 + random() * 0.0018;
      const base = positions.length / 3;
      const steps = 18;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const x = x0 + drift * u + bow * Math.sin(u * 3);
        const y = 1.12 - end * 1.7 * u;
        const w = width * (1 - u * 0.75);
        positions.push(x - w, y, 0, x + w, y, 0);
        if (i < steps) indices.push(base + i * 2, base + i * 2 + 1, base + i * 2 + 2, base + i * 2 + 1, base + i * 2 + 3, base + i * 2 + 2);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setIndex(indices);
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ color: 0xd8d4c8, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false, side: DoubleSide }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    this.hairOnLens.add(mesh);
    this.hairOnLens.visible = false;
  }

  /** Where the eye goes: the couch, then a cut on a blink, then the slats. Calm viewers get cuts where others get a zoom. */
  private path(): RoomKey[] {
    const key = (s: number, at: V3, yaw: number, pitch: number, fov: number): RoomKey => ({ t: s / this.seconds, at, yaw, pitch, fov });
    const E = EYE_COUCH;
    const W = EYE_WARDROBE;
    const toTv = 22.4;
    const pitchTv = -4.74;
    const narrow = 11.6;
    const list: RoomKey[] = [
      key(0, E, -6, -4.5, 54),
      key(11.5, E, -6.8, -4.5, 52),
      key(13.2, E, -19, -11, 45),
      key(20.5, E, -20, -11.5, 43),
      key(23.6, E, -13, -6, 50),
      key(26.4, E, 10, 27, 60),
      key(28.8, E, -13, 29, 60),
      key(30.4, E, -18, 8, 52),
      key(33.6, EYE_LEAN, -24.8, -10.5, 33),
      key(35.3, EYE_LEAN, -24.8, -12, 29),
      key(35.96, EYE_LEAN, -24.8, -12, 29),
      key(36.0, W, 4, -6.5, 46),
      key(36.4, W, 4, -6.5, 46),
      key(39.2, W, 3, -6.5, 44),
      key(41.3, W, -3, -6, 24),
      key(42.2, W, -3, -6, 24),
      key(43.8, W, -2, -4, 37),
      key(45.8, W, 1, -5, 40),
      key(47.8, W, 1, -5.5, 42),
      key(50.2, W, 0, -3, 42),
      key(52.6, W, 0, -2, 32),
      key(56.5, W, 0, -2, 31),
      key(56.9, W, 0, -5.6, 38),
      key(58.6, W, -1, -6, 36),
      key(61.4, W, 4, -6, 44),
      key(62.4, W, 4, -6, 44),
    ];
    if (REDUCED_MOTION) {
      list.push(key(62.9, W, 4, -6, 44), key(62.95, W, toTv, pitchTv, narrow), key(69.6, W, toTv, pitchTv, narrow));
    } else {
      list.push(key(65.0, W, toTv, pitchTv, narrow), key(69.6, W, toTv, pitchTv, narrow - 0.8));
    }
    list.push(key(70.7, EYE_TURNED, 10, -2, 56), key(73, EYE_TURNED, 10, 11, 72), key(this.seconds, EYE_TURNED, 10, 11, 72));
    return list;
  }

  /** Walls, floor, ceiling, trim, the dirt of years. */
  private shell(): void {
    const b = this.build;
    const kit = this.kit;
    const width = RIGHT - LEFT;
    const depth = REAR - FAR;
    (b.wood() as MeshStandardMaterial).roughness = 0.74;
    const paper = b.damask(PAPER, 0.78);
    const floor = kit.surface('wood_floor_dark', 2, { color: new Color(0x8d8070), roughness: 0.42 });
    const ceiling = kit.surface('plaster_pale', 2, { color: new Color(0xa39c8c) });
    const box = b.box(width, depth, HEIGHT, { walls: paper, floor, ceiling, skip: ['+z'] }, this.root);
    box.position.set((LEFT + RIGHT) / 2, 0, REAR);

    // the far wall in three pieces round the door, its paper running on across them
    const doorL = DOOR.x - DOOR.width / 2;
    const doorR = DOOR.x + DOOR.width / 2;
    const piece = (x0: number, x1: number, y0: number, y1: number) => {
      const g = new PlaneGeometry(x1 - x0, y1 - y0);
      const uv = g.getAttribute('uv');
      const at = g.getAttribute('position');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, at.getX(i) + (x0 + x1) / 2, at.getY(i) + (y0 + y1) / 2);
      const m = new Mesh(g, paper);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, FAR);
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.root.add(m);
    };
    piece(LEFT, doorL, 0, HEIGHT);
    piece(doorR, RIGHT, 0, HEIGHT);
    piece(doorL, doorR, DOOR.height, HEIGHT);

    // panelling, broken for the door and the wardrobe
    const architrave = 0.478;
    const panelL = DOOR.x - architrave - 0.003;
    const panelR = DOOR.x + architrave + 0.003;
    b.wainscot((LEFT + panelL) / 2, FAR, panelL - LEFT, '+z', this.root, WAINSCOT_H);
    b.wainscot((panelR + RIGHT) / 2, FAR, RIGHT - panelR, '+z', this.root, WAINSCOT_H);
    b.wainscot(LEFT, (REAR + FAR) / 2, depth, '+x', this.root, WAINSCOT_H);
    b.wainscot(RIGHT, (WARD.front + FAR) / 2, WARD.front - FAR, '-x', this.root, WAINSCOT_H);
    b.wainscot((LEFT + WARD.x0) / 2, REAR, WARD.x0 - LEFT, '-z', this.root, WAINSCOT_H);

    // rail and cornice
    const trim: BufferGeometry[] = [];
    const along = (w: number, h: number, t: number, x: number, y: number, z: number, turned: boolean) => {
      const g = meterUVs(new BoxGeometry(w, h, t));
      if (turned) g.rotateY(Math.PI / 2);
      trim.push(g.translate(x, y, z));
    };
    for (const [y, h, t] of [[RAIL_Y, 0.045, 0.026], [HEIGHT - 0.05, 0.1, 0.07]] as const) {
      along(width, h, t, (LEFT + RIGHT) / 2, y, FAR + t / 2, false);
      along(WARD.x0 - LEFT, h, t, (LEFT + WARD.x0) / 2, y, REAR - t / 2, false);
      along(depth, h, t, LEFT + t / 2, y, (REAR + FAR) / 2, true);
      along(WARD.front - FAR, h, t, RIGHT - t / 2, y, (WARD.front + FAR) / 2, true);
    }
    const trimMesh = new Mesh(mergeGeometries(trim)!, b.wood());
    trimMesh.frustumCulled = false;
    trimMesh.receiveShadow = true;
    this.root.add(trimMesh);

    // what the walls have taken over the years
    const decal = (map: Texture, w: number, h: number, x: number, y: number, z: number, turn: number, tilt = 0) => {
      const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map, transparent: true, depthWrite: false }));
      m.position.set(x, y, z);
      m.rotation.set(tilt, turn, 0, 'YXZ');
      m.renderOrder = 1;
      m.frustumCulled = false;
      this.root.add(m);
    };
    decal(canvasMap(1024, 580, (c, w, h) => drawGrime(c, w, h, 11)), width, HEIGHT, (LEFT + RIGHT) / 2, HEIGHT / 2, FAR + 0.004, 0);
    decal(canvasMap(1024, 500, (c, w, h) => drawGrime(c, w, h, 12)), depth, HEIGHT, LEFT + 0.004, HEIGHT / 2, (REAR + FAR) / 2, Math.PI / 2);
    decal(canvasMap(1024, 500, (c, w, h) => drawGrime(c, w, h, 13)), depth, HEIGHT, RIGHT - 0.004, HEIGHT / 2, (REAR + FAR) / 2, -Math.PI / 2);
    decal(canvasMap(1024, 580, (c, w, h) => drawGrime(c, w, h, 14)), width, HEIGHT, (LEFT + RIGHT) / 2, HEIGHT / 2, REAR - 0.004, Math.PI);
    decal(canvasMap(1024, 1024, drawStain), 3.4, 3.4, 0.2, HEIGHT - 0.004, -2.3, 0, Math.PI / 2);

    // the rug
    const rugW = 2.3;
    const rugD = 1.85;
    const rugMaterial = kit.surface('carpet_dirty', 0.6, {}).clone();
    rugMaterial.map = canvasMap(1024, 824, drawRug);
    rugMaterial.map.repeat.set(1 / rugW, 1 / rugD);
    rugMaterial.map.offset.set(0.5, 0.5);
    rugMaterial.map.wrapS = rugMaterial.map.wrapT = RepeatWrapping;
    rugMaterial.color.set(0xffffff);
    rugMaterial.roughness = 1;
    const rug = new Mesh(new PlaneGeometry(rugW, rugD), rugMaterial);
    const uv = rug.geometry.getAttribute('uv');
    const pos = rug.geometry.getAttribute('position');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), pos.getY(i));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-0.08, 0.006, -2.55);
    rug.receiveShadow = true;
    rug.frustumCulled = false;
    this.root.add(rug);
    b.contactShadow(-0.08, -2.55, 1.75, this.root, 0.3, 0.003);
  }

  private tableShade!: MeshStandardMaterial;

  /** What makes it a home: couch, lamp, table, chairs, shelves; returns where the lamp burns. */
  private furniture(): V3 {
    const b = this.build;
    const kit = this.kit;
    const root = this.root;
    kit.prop('sofa_leather', [COUCH_AT[0], 0, COUCH_AT[2]], { rotation: [0, 180, 0], castShadow: true }, root);
    b.contactShadow(COUCH_AT[0], COUCH_AT[2], 1.15, root, 0.72);

    const table = b.lampTable(TABLE.x, TABLE.z, root, TABLE.heading);
    this.tableShade = table.shade;
    const shadeMap = canvasMap(512, 128, drawShade);
    table.shade.map = shadeMap;
    table.shade.emissiveMap = shadeMap;
    table.shade.color.set(0xffffff);
    table.shade.emissive.set(0xffe2bd);
    table.shade.emissiveIntensity = SHADE_GLOW;
    b.contactShadow(TABLE.x, TABLE.z, 0.72, root, 0.8);
    const tea = this.onTable(0.34, 0.13);
    kit.prop('tea_glass', [tea[0], TABLE_TOP, tea[1]], {}, root);

    // a doily under the telephone
    const doilySize = 0.34;
    const at = this.onTable(PHONE_ON_TABLE[0], PHONE_ON_TABLE[1]);
    const doily = new Mesh(
      new PlaneGeometry(doilySize, doilySize),
      new MeshStandardMaterial({ map: canvasMap(256, 256, (c, s) => drawDoily(c, s)), transparent: true, roughness: 0.95, alphaTest: 0.2 }),
    );
    doily.rotation.set(-Math.PI / 2, 0, TABLE.heading, 'YXZ');
    doily.position.set(at[0], TABLE_TOP + 0.002, at[1]);
    doily.receiveShadow = true;
    doily.frustumCulled = false;
    root.add(doily);

    // the set's console and the corner where nobody sits
    kit.prop('console', [TV_X, 0, FAR + 0.31], { castShadow: true }, root);
    b.contactShadow(TV_X, FAR + 0.3, 0.95, root, 0.7);
    kit.prop('armchair_green', [-1.42, 0, -2.75], { rotation: [0, 62, 0], castShadow: true }, root);
    b.contactShadow(-1.42, -2.75, 0.7, root, 0.75);
    dim(kit.prop('bookshelf_worn', [LEFT + 0.3, 0, -0.95], { rotation: [0, 90, 0], castShadow: true }, root), 0.42);
    this.books();
    b.contactShadow(LEFT + 0.3, -0.95, 0.85, root, 0.65);
    dim(kit.prop('radiator', [RIGHT - 0.14, 0, -2.75], { rotation: [0, 90, 0], castShadow: true }, root), 0.42);
    b.contactShadow(RIGHT - 0.14, -2.75, 0.62, root, 0.6);

    // the window behind the couch, a street lamp somewhere behind its curtains
    const night = canvasMap(256, 192, (c, w, h) => {
      const g = c.createRadialGradient(w * 0.7, h * 0.25, 0, w * 0.7, h * 0.25, w * 0.9);
      g.addColorStop(0, '#31465f');
      g.addColorStop(1, '#090e15');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    });
    const pane = new Mesh(new PlaneGeometry(1.9, 1.4), new MeshBasicMaterial({ map: night, transparent: true }));
    pane.position.set(-0.55, 1.6, REAR - 0.012);
    pane.rotation.y = Math.PI;
    root.add(pane);
    kit.prop('window_wood', [-0.55, 0.85, REAR - 0.1], { rotation: [0, 180, 0] }, root);
    const curtains = kit.prop('curtains', [-0.55, 0.28, REAR - 0.26], { rotation: [0, 180, 0], scale: 1.04 }, root);
    kit.paint(curtains, kit.surface('linen_white', 0.4, { color: new Color(0x3b3f39) }));

    // pictures
    this.portrait(0.42, 0.56, [-1.08, 1.62, FAR + 0.018], 0);
    this.portrait(0.5, 0.36, [RIGHT - 0.018, 1.64, -1.25], -Math.PI / 2);
    this.portrait(0.36, 0.48, [LEFT + 0.018, 1.66, -2.6], Math.PI / 2);
    const kept = this.album.pictures[this.album.pictures.length - 1];
    if (kept) {
      // your own last dream, framed on your own wall
      const print = b.print(this.album.texture(kept), 0.26);
      print.position.set(0.52, 1.52, FAR + 0.012);
      print.rotation.z = -0.015;
      root.add(print);
    }

    // a hanging lamp, off, on a long cord
    this.pendant.position.set(0.1, HEIGHT, -2.45);
    const dark = new MeshStandardMaterial({ color: 0x14130f, roughness: 0.55 });
    const cord = new Mesh(new CylinderGeometry(0.0028, 0.0028, 0.72, 5), dark);
    cord.position.y = -0.36;
    const shade = new Mesh(new LatheGeometry([[0.0, 0], [0.024, 0], [0.04, -0.03], [0.09, -0.1], [0.16, -0.18], [0.17, -0.19]].map(([x, y]) => new Vector2(x, y)), 22), new MeshStandardMaterial({ color: 0x615745, roughness: 0.42, side: DoubleSide }));
    shade.position.y = -0.72;
    this.pendant.add(cord, shade);
    this.pendant.traverse((o) => (o.frustumCulled = false));
    root.add(this.pendant);
    const rose = new Mesh(new LatheGeometry([[0, 0], [0.1, 0], [0.11, -0.012], [0.07, -0.022], [0.012, -0.03]].map(([x, y]) => new Vector2(x, y)), 18), new MeshStandardMaterial({ color: 0x66614f, roughness: 0.9, side: DoubleSide }));
    rose.position.set(0.1, HEIGHT - 0.002, -2.45);
    rose.frustumCulled = false;
    root.add(rose);

    const t = table.lightAt;
    return [t[0], t[1], t[2]];
  }

  /** Rows of spines on the shelves: nobody has read them since. */
  private books(): void {
    const random = randomFrom(61);
    const parts: BufferGeometry[] = [];
    const shelves = [0.3, 0.72, 1.14, 1.56];
    const colors: number[] = [];
    const tints = [0x2a1a14, 0x1c2a22, 0x33291c, 0x15181d, 0x3a1612, 0x4a4436];
    for (const y of shelves) {
      let z = -1.56;
      while (z < -0.34) {
        const depth = 0.022 + random() * 0.05;
        const height = 0.18 + random() * 0.16;
        if (random() > 0.12) {
          const lean = random() > 0.85 ? (random() - 0.5) * 0.25 : 0;
          const g = new BoxGeometry(0.17 + random() * 0.04, height, depth).rotateX(lean).translate(LEFT + 0.24 + random() * 0.04, y + height / 2, z + depth / 2);
          const c = new Color(tints[Math.floor(random() * tints.length)]);
          for (let v = 0; v < g.getAttribute('position').count; v++) colors.push(c.r, c.g, c.b);
          parts.push(g);
        }
        z += depth + 0.002;
      }
    }
    const geometry = mergeGeometries(parts)!;
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    const mesh = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  /** A family in an old frame. Somebody has been at their faces. */
  private portrait(w: number, h: number, at: V3, turn: number): void {
    const frame = new Mesh(new BoxGeometry(w + 0.09, h + 0.09, 0.026), this.build.wood());
    const art = new Mesh(new PlaneGeometry(w, h), new MeshStandardMaterial({ map: canvasMap(256, Math.round((256 * h) / w), drawFamily), roughness: 0.55 }));
    art.position.z = 0.0145;
    art.frustumCulled = false;
    frame.add(art);
    frame.position.set(at[0], at[1], at[2]);
    frame.rotation.y = turn;
    frame.castShadow = true;
    frame.receiveShadow = true;
    frame.frustumCulled = false;
    this.root.add(frame);
  }

  private onTable(lx: number, lz: number): [number, number] {
    const c = Math.cos(TABLE.heading);
    const s = Math.sin(TABLE.heading);
    return [TABLE.x + lx * c + lz * s, TABLE.z - lx * s + lz * c];
  }

  /** The wall clock. Its hands stand at the viewer's own time. */
  private wallClock(): ClockHand[] {
    const clock = this.kit.prop('wall_clock', [0.52, 1.99, FAR + 0.03], { anchor: 'center' }, this.root);
    return rigClock(clock);
  }

  /** The door to the stairs, a real opening, the foot of the stairs behind it. */
  private doorway(): void {
    const b = this.build;
    const kit = this.kit;
    const root = this.root;
    const well = b.box(1.36, 3.6, 3.1, { walls: kit.surface('plaster_pale', 2, { color: new Color(0x8a7d62) }), floor: kit.surface('wood_floor_dark', 2, { color: new Color(0x9a8a74), roughness: 0.5 }), ceiling: kit.surface('plaster_pale', 2, { color: new Color(0x6a6658) }), skip: ['-z'] }, root);
    well.position.set(DOOR.x, 0, FAR - 0.004);
    dim(kit.prop('staircase', [DOOR.x, 0, FAR - 0.6 - 1.384], {}, root), 0.42);

    dim(kit.prop('door_frame', [DOOR.x, 0, FAR + 0.012], {}, root), DOOR_FRAME_DIM);
    this.doorPivot.position.set(DOOR.x - DOOR.slab / 2, 0, FAR + 0.03);
    root.add(this.doorPivot);
    const slab = kit.prop('door_six', [DOOR.slab / 2, DOOR.gap, 0], { castShadow: true }, this.doorPivot);
    const paint = new MeshStandardMaterial({ color: 0x5c5749, roughness: 0.7 });
    kit.paint(slab, paint);

    const brass = new MeshStandardMaterial({ color: 0x96794a, roughness: 0.32, metalness: 0.9 });
    const rose = new Mesh(new CylinderGeometry(0.026, 0.026, 0.008, 16), brass);
    rose.rotation.x = Math.PI / 2;
    rose.position.set(LEVER_AT[0], LEVER_AT[1], LEVER_AT[2] - 0.006);
    this.doorPivot.add(rose);
    this.lever.position.set(LEVER_AT[0], LEVER_AT[1], LEVER_AT[2]);
    const arm = new Mesh(new BoxGeometry(0.125, 0.016, 0.014), brass);
    arm.position.set(-0.054, 0, 0.012);
    const boss = new Mesh(new CylinderGeometry(0.012, 0.012, 0.03, 12), brass);
    boss.rotation.x = Math.PI / 2;
    this.lever.add(arm, boss);
    this.doorPivot.add(this.lever);
    this.doorPivot.traverse((o) => (o.frustumCulled = false));

    // the lit floor of the stairs, seen under the door
    this.underDoor = new Mesh(new PlaneGeometry(DOOR.slab, 0.08), new MeshBasicMaterial({ color: new Color(PALETTE.warm).multiplyScalar(0.9), transparent: true }));
    this.underDoor.rotation.x = -Math.PI / 2;
    this.underDoor.position.set(DOOR.x, 0.003, FAR + 0.012);
    this.underDoor.frustumCulled = false;
    root.add(this.underDoor);

    // two shadows that will stand on the light under the door
    for (const dx of [-0.11, 0.1]) {
      const foot = new Mesh(new BoxGeometry(0.11, DOOR.gap + 0.004, 0.09), new MeshBasicMaterial({ color: 0x000000, transparent: true }));
      foot.position.set(DOOR.x + dx, (DOOR.gap + 0.004) / 2, FAR + 0.012);
      foot.visible = false;
      foot.frustumCulled = false;
      root.add(foot);
      this.feet.push(foot);
    }
    kit.prop('light_switch', [DOOR.x + 0.62, 1.22, FAR + 0.008], { anchor: 'center' }, root);
  }

  /** A coat and a hat on a stand, where the lamp barely reaches: a man who is not there. */
  private coatStand(): Object3D {
    const kit = this.kit;
    const root = this.root;
    kit.prop('coat_stand', [STAND_AT[0], 0, STAND_AT[2]], { castShadow: true }, root);
    this.build.contactShadow(STAND_AT[0], STAND_AT[2], 0.42, root, 0.7);
    const coat = kit.prop('coat', [STAND_AT[0], 0.98, STAND_AT[2] + 0.04], { rotation: [0, 8, 0], castShadow: true }, root);
    kit.prop('fedora', [STAND_AT[0], 1.82, STAND_AT[2]], { rotation: [0, 20, 0] }, coat);
    coat.children[coat.children.length - 1].position.set(0, 1.84 - 0.98, -0.04);
    return coat;
  }

  private television(): void {
    const tv = this.kit.prop('tv_retro', [TV_X, CONSOLE_TOP, TV_Z], { rotation: [0, TV_TURN, 0], castShadow: true }, this.root);
    let screen: Mesh | null = null;
    tv.getObjectByName('screen')?.traverse((o) => {
      if ((o as Mesh).isMesh && !screen) screen = o as Mesh;
    });
    if (!screen) return;
    const mesh = screen as Mesh;
    this.tvGlass = new MeshStandardMaterial({ color: 0x06080a, roughness: 0.14, metalness: 0.25 });
    mesh.material = this.tvGlass;
    const casing = (this.build.wood() as MeshStandardMaterial).clone();
    casing.color.set(0xc4a888);
    casing.roughness = 0.5;
    this.tvCasing = casing;
    tv.traverse((o) => {
      if ((o as Mesh).isMesh && o !== mesh) (o as Mesh).material = casing;
    });
    const geometry = mesh.geometry.clone();
    const at = geometry.getAttribute('position');
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < at.count; i++) {
      x0 = Math.min(x0, at.getX(i));
      x1 = Math.max(x1, at.getX(i));
      y0 = Math.min(y0, at.getY(i));
      y1 = Math.max(y1, at.getY(i));
    }
    const uv = new Float32Array(at.count * 2);
    for (let i = 0; i < at.count; i++) {
      uv[i * 2] = (at.getX(i) - x0) / (x1 - x0);
      uv[i * 2 + 1] = (at.getY(i) - y0) / (y1 - y0);
    }
    geometry.setAttribute('uv', new BufferAttribute(uv, 2));
    this.screenUniforms.uA.value = this.pictureA.texture;
    this.screenUniforms.uB.value = this.pictureB.texture;
    const glass = new Mesh(
      geometry,
      new ShaderMaterial({ vertexShader: CRT_VERT, fragmentShader: CRT_FRAG, uniforms: this.screenUniforms, transparent: true, depthWrite: false, blending: AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    );
    glass.frustumCulled = false;
    glass.renderOrder = 4;
    mesh.add(glass);
  }

  /** The dust each step shakes out of the ceiling. */
  private dust(): void {
    const steps = STEP_DUST.length;
    const count = 200;
    const random = randomFrom(9);
    const at = new Float32Array(count * 3);
    const fall = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const [when, x, z] = STEP_DUST[i % steps];
      at[i * 3] = x + (random() - 0.5) * 0.7;
      at[i * 3 + 1] = HEIGHT - 0.01;
      at[i * 3 + 2] = z + (random() - 0.5) * 0.7;
      fall[i * 2] = when + random() * 0.45;
      fall[i * 2 + 1] = 0.5 + random() * 0.9;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(at, 3));
    geometry.setAttribute('aFall', new BufferAttribute(fall, 2));
    const points = new Points(
      geometry,
      new ShaderMaterial({
        vertexShader: DUST_VERT,
        fragmentShader: DUST_FRAG,
        uniforms: { uTime: this.dustTime, uColor: { value: new Color(0xd8cdb4).multiplyScalar(0.3) } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    points.frustumCulled = false;
    points.renderOrder = 3;
    this.root.add(points);
  }

  /** Dark wood, two doors of slats, a rail and a coat. Inside it is very small. */
  private wardrobe(): { carcass: Mesh; back: Mesh } {
    const b = this.build;
    const root = this.root;
    const wood = b.wood();
    const { x0, x1, front, top, plinth } = WARD;
    const parts: BufferGeometry[] = [];
    const block = (ax: number, bx: number, ay: number, by: number, az: number, bz: number, into = parts) => {
      into.push(meterUVs(new BoxGeometry(bx - ax, by - ay, bz - az)).translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2));
    };
    const side = 0.03;
    block(x0, x0 + side, 0, top, front, REAR);
    block(x1 - side, x1, 0, top, front, REAR);
    block(x0, x1, top - 0.04, top, front, REAR);
    block(x0, x1, 0, plinth, front, REAR);
    block(x0 - 0.03, x1, top, top + 0.075, front - 0.03, REAR);
    block(x0 - 0.018, x1, 0, plinth, front - 0.018, front);
    const carcass = new Mesh(mergeGeometries(parts)!, wood);
    carcass.castShadow = true;
    carcass.receiveShadow = true;
    carcass.frustumCulled = false;
    root.add(carcass);
    b.contactShadow((x0 + x1) / 2, front - 0.02, 0.85, root, 0.6);

    const boards = this.kit.surface('wood_raw_boards', 1.4, { color: new Color(0x4a3d30) });
    const back = new Mesh(meterUVs(new BoxGeometry(x1 - x0, top, 0.02)).translate((x0 + x1) / 2, top / 2, REAR - 0.012), boards);
    back.receiveShadow = true;
    back.frustumCulled = false;
    root.add(back);

    // the doors: stiles, rails and all the slats but the two halves of the one that gets pushed
    const doors: BufferGeometry[] = [];
    const slats: BufferGeometry[] = [];
    const mid = (x0 + x1) / 2;
    const low = plinth;
    const high = top - 0.04;
    const stile = 0.04;
    const slatMap = canvasMap(512, 64, drawSlat);
    slatMap.wrapS = slatMap.wrapT = RepeatWrapping;
    slatMap.repeat.set(1 / 0.8, 1 / 0.09);
    const slatWood = new MeshStandardMaterial({ map: slatMap, color: 0x8c8378, roughness: 0.82 });
    const random = randomFrom(83);
    const leaves: [number, number][] = [[x0 + side, mid], [mid, x1 - side]];
    leaves.forEach(([a, c], leaf) => {
      block(a, a + stile, low, high, front, front + 0.05, doors);
      block(c - stile, c, low, high, front, front + 0.05, doors);
      block(a, c, low, low + 0.11, front, front + 0.05, doors);
      block(a, c, high - 0.11, high, front, front + 0.05, doors);
      const n = Math.ceil((SLAT.high - SLAT.low) / SLAT.pitch);
      for (let k = -n; k <= n; k++) {
        const y = SLAT.gapY + (k + 0.5) * SLAT.pitch;
        if (y < SLAT.low + 0.02 || y > SLAT.high - 0.02) continue;
        if (leaf === 0 && k === 0) continue;
        const g = meterUVs(new BoxGeometry(c - a - stile * 2, SLAT.thick, SLAT.depth));
        g.rotateX(-SLAT.tilt + (random() - 0.5) * 0.045).translate((a + c) / 2, y + (random() - 0.5) * 0.004, SLAT.z);
        slats.push(g);
      }
    });
    for (const [geometry, material] of [[mergeGeometries(doors)!, wood], [mergeGeometries(slats)!, slatWood]] as const) {
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      root.add(mesh);
    }

    const shadows = new Mesh(mergeGeometries(slats)!.clone().translate(0, 0.027, 0), new MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true }));
    shadows.castShadow = true;
    shadows.frustumCulled = false;
    root.add(shadows);

    const [a, c] = leaves[0];
    const xa = a + stile;
    const xc = c - stile;
    const eyeX = EYE_WARDROBE[0];
    const y = SLAT.gapY + 0.5 * SLAT.pitch;
    const half = (length: number, offset: number, pivot: Group, x: number) => {
      const g = meterUVs(new BoxGeometry(length, SLAT.thick, SLAT.depth));
      g.rotateX(-SLAT.tilt).translate(offset, 0, 0);
      const m = new Mesh(g, slatWood);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      pivot.add(m);
      pivot.position.set(x, y, SLAT.z);
      root.add(pivot);
    };
    half(eyeX - xa, (eyeX - xa) / 2, this.slatLeft, xa);
    half(xc - eyeX, -(xc - eyeX) / 2, this.slatRight, xc);

    // the rail, a hanger, the coat from the stand
    const railMaterial = new MeshStandardMaterial({ color: 0x4a4436, roughness: 0.4, metalness: 0.7 });
    const rail = new Mesh(new CylinderGeometry(0.011, 0.011, x1 - x0 - 0.1, 8), railMaterial);
    rail.rotation.z = Math.PI / 2;
    rail.position.set((x0 + x1) / 2, WARD.rail, WARD.hangZ);
    rail.frustumCulled = false;
    root.add(rail);
    this.hanging.position.set(WARD.hangX, WARD.rail, WARD.hangZ);
    root.add(this.hanging);
    const coat = this.kit.prop('coat', [0, -0.96, 0], { rotation: [0, 180, 0], castShadow: true }, this.hanging);
    dim(coat, 0.55);
    coat.traverse((o) => {
      if (!(o as Mesh).isMesh) return;
      const material = (o as Mesh).material as MeshStandardMaterial;
      material.color.multiply(COAT_TINT);
      this.coatMaterials.push(material);
    });
    this.kit.prop('hanger', [0, -0.205, 0], { rotation: [0, 180, 0] }, this.hanging);
    return { carcass, back };
  }

  /** The white-haired head the television shows from behind: seen by nobody but that camera. */
  private yourself(): Object3D {
    const e = EYE_WARDROBE;
    const you = new Group();
    const shoulders = new Mesh(
      new LatheGeometry([[0, 0.9], [0.17, 0.92], [0.25, 1.18], [0.27, 1.38], [0.21, 1.49], [0.1, 1.53], [0.075, 1.6], [0, 1.62]].map(([x, y]) => new Vector2(x, y)), 20),
      new MeshStandardMaterial({ color: 0x24241f, roughness: 0.9 }),
    );
    shoulders.position.set(e[0], 0, e[2]);
    shoulders.scale.set(1, 1, 0.62);
    shoulders.frustumCulled = false;
    you.add(shoulders);
    const skull = new Mesh(new SphereGeometry(0.1, 16, 12), new MeshStandardMaterial({ color: 0x8c8b82, roughness: 1 }));
    skull.scale.set(0.95, 1.14, 1.05);
    skull.position.set(e[0], 1.62, e[2] + 0.015);
    skull.frustumCulled = false;
    you.add(skull);
    const random = randomFrom(6);
    const positions: number[] = [];
    const indices: number[] = [];
    const strand = (x: number, y: number, z: number, length: number, width: number) => {
      const base = positions.length / 3;
      const drift = (random() - 0.5) * 0.05;
      const steps = 10;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const w = width * (1 - u * 0.7);
        const ax = x + drift * u + 0.012 * Math.sin(u * 4 + x * 40);
        positions.push(ax - w, y - length * u, z, ax + w, y - length * u, z);
        if (i < steps) indices.push(base + i * 2, base + i * 2 + 1, base + i * 2 + 2, base + i * 2 + 1, base + i * 2 + 3, base + i * 2 + 2);
      }
    };
    for (let i = 0; i < 240; i++) {
      const dx = (random() - 0.5) * 0.19;
      strand(e[0] + dx, 1.585 + random() * 0.03, e[2] + 0.075 + random() * 0.05, 0.12 + random() * 0.24, 0.0024);
    }
    for (let i = 0; i < 340; i++) {
      const dx = (random() - 0.5) * 0.19;
      const top = 1.61 + 0.122 * Math.sqrt(Math.max(0, 1 - (dx / 0.095) ** 2));
      strand(e[0] + dx, top - random() * 0.02, e[2] - 0.01 + random() * 0.13, 0.1 + random() * 0.3, 0.0024);
    }
    const strands = new BufferGeometry();
    strands.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    strands.setIndex(indices);
    const hair = new Mesh(strands, new MeshBasicMaterial({ color: 0x86847a, transparent: true, depthWrite: true, side: DoubleSide }));
    hair.frustumCulled = false;
    you.add(hair);
    this.root.add(you);
    return you;
  }

  /** The handset on a pivot of its own: on its cradle, at your ear, then hanging off the table on its cord. */
  private telephone(): void {
    const at = this.onTable(PHONE_ON_TABLE[0], PHONE_ON_TABLE[1]);
    const phone = this.kit.prop('phone_ornate', [at[0], TABLE_TOP, at[1]], { rotation: [0, TABLE.heading / DEG, 0], castShadow: true }, this.root);
    // glossy black bakelite gives back only the room's reflections and reads as an outline: a duller, solid black of its own
    let bakelite: MeshStandardMaterial | null = null;
    phone.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      if (!bakelite) {
        bakelite = (mesh.material as MeshStandardMaterial).clone();
        bakelite.roughness = PHONE_ROUGHNESS;
        bakelite.envMapIntensity = PHONE_SHEEN;
        bakelite.color.multiplyScalar(PHONE_LIFT);
      }
      mesh.material = bakelite;
    });
    const handset = phone.getObjectByName('handset');
    phone.updateWorldMatrix(true, true);
    const box = new Box3();
    if (handset) box.setFromObject(handset);
    box.getCenter(this.handsetRest).sub(this.origin);
    this.phoneHandset.position.copy(this.handsetRest);
    this.root.add(this.phoneHandset);
    this.phoneHandset.updateWorldMatrix(true, false);
    if (handset) this.phoneHandset.attach(handset);
    this.phoneHandset.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = true;
    });
    const anchor = this.onTable(PHONE_ON_TABLE[0] + 0.1, PHONE_ON_TABLE[1] - 0.06);
    this.cordFrom.set(anchor[0], TABLE_TOP + 0.03, anchor[1]);
    const edge = this.onTable(HANG_FROM[0], HANG_FROM[1]);
    this.hangAt.set(edge[0], TABLE_TOP, edge[1]);
  }

  /** Everything that is heard: beds, one-shots on their beats, and a real silence before the set comes on. */
  private score(): void {
    const s = this.sound;
    this.beat(0, () => {
      this.beds.tone = s.bed('rooms/house_tone.mp3', { gain: 0.28, fade: 1.2 });
      this.clockVoice = s.bed('rooms/clock_tick.mp3', { gain: 0.08, pan: -0.05, reverb: 0.12 });
      this.beds.drone = s.bed('rooms/dream_drone_low.mp3', { gain: 0.03, fade: 3 });
    });
    this.beat(3, () => {
      const time = clockNow();
      this.say({ tr: `Saat ${time}. Evde yalnızsın.`, en: `It is ${time}. You are alone in the house.` }, 5);
    });
    for (const at of [RING_AT, RING_AT + 3, RING_AT + 6]) {
      this.beat(at, () => {
        if (this.answeredAt === Infinity) this.ringVoice = s.play('rooms/phone_ring.mp3', { gain: 0.55, reverb: 0.2, pan: 0.42 });
      });
    }
    this.beat(ANSWER_LATEST, () => this.answer(ANSWER_LATEST));
    this.beat(21, () => this.say({ tr: 'Üst kattayım.', en: 'I am upstairs.' }, 3.4));
    this.beat(23.4, () => {
      this.beds.phone?.stop(0.08);
      s.play('rooms/phone_hangup_2.mp3', { gain: 0.3, pan: 0.3, lowpass: 2600 });
      this.beds.phone = s.bed('rooms/phone_line_dead.mp3', { gain: 0.14, pan: 0.3 });
      this.beds.drone?.gain(0.08, 3);
    });
    this.beat(24, () => {
      const steps = s.play('rooms/steps_above_walk.mp3', { gain: 0.62, pan: -0.72, duration: 6.1 });
      steps.pan(0.55, 6);
      this.beds.tone?.gain(0.2, 2);
    });
    for (const [at, file, pan] of [[25.1, 1, -0.4], [26.5, 2, -0.05], [28.0, 1, 0.35]] as const) this.beat(at, () => s.play(`rooms/dust_fall_${file}.mp3`, { gain: 0.26, pan }));
    this.beat(29.7, () => {
      s.play('rooms/steps_above_stop.mp3', { gain: 0.62, pan: 0.5 });
      this.beds.phone?.stop(1);
      this.beds.phone = null;
    });
    STAIRS.forEach(([at, tread, gain]) => this.beat(at, () => s.play(`rooms/stair_tread_${tread}.mp3`, { gain, pan: 0.16, reverb: 0.16, lowpass: 3600 })));
    for (const [at, n, gain] of [[31.0, 1, 0.12], [33.3, 4, 0.2]] as const) this.beat(at, () => s.play(`rooms/stair_creak_${n}.mp3`, { gain, pan: 0.16, reverb: 0.16, lowpass: 3200 }));
    this.beat(35.3, () => s.play('rooms/wardrobe_door.mp3', { gain: 0.42, pan: 0.2 }));
    this.beat(WARDROBE_AT, () => {
      this.beds.tone?.gain(0.13, 0.6);
      this.clockVoice?.gain(0.045, 0.4);
      this.beds.drone?.gain(0.1, 2);
      this.beds.breath = s.bed('rooms/breath_scared.mp3', { gain: 0.3, fade: 0.8 });
    });

    this.beat(HANDLE_AT, () => s.play('rooms/door_handle_slow.mp3', { gain: 0.42, reverb: 0.12, pan: -0.05, rate: 0.8 }));
    this.beat(41.25, () => s.play('rooms/door_handle_slow_2.mp3', { gain: 0.4, reverb: 0.12, pan: -0.05 }));
    this.beat(DOOR_OPENS[0], () => s.play('rooms/door_creak_slow.mp3', { gain: 0.42, reverb: 0.3, pan: -0.05, lowpass: 3600 }));
    this.beat(42.8, () => {
      this.beds.sway = s.bed('rooms/neck_sway.mp3', { gain: 0.06, fade: 2.5, reverb: 0.1, pan: 0 });
    });
    TREADS.forEach(([at, n, gain, pan]) => this.beat(at, () => s.play(`rooms/tread_heavy_${n}.mp3`, { gain, pan, reverb: 0.2 })));
    this.beat(45.9, () => s.play('rooms/sniff_2.mp3', { gain: 0.14, pan: -0.1, lowpass: 2400 }));
    this.beat(46.3, () => s.play('rooms/belt_slither_2.mp3', { gain: 0.2, pan: 0, lowpass: 2800 }));
    this.beat(50.2, () => {
      this.beds.sway?.gain(0.34, 1.6);
      this.beds.throat = s.bed('rooms/throat_crackle.mp3', { gain: 0.42, fade: 1.8 });
      this.beds.tone?.gain(0.08, 2);
      this.clockVoice?.gain(0.02, 2);
    });
    this.beat(51.3, () => s.play('rooms/belt_slither_1.mp3', { gain: 0.34, pan: 0.05 }));
    this.beat(52.5, () => s.play('rooms/sniff_1.mp3', { gain: 0.25, pan: -0.72 }));
    this.beat(54.2, () => s.play('rooms/sniff_2.mp3', { gain: 0.24, pan: 0.66 }));
    this.beat(WITHDRAW_HELD, () => {
      s.play('rooms/belt_slither_1.mp3', { gain: 0.3, pan: -0.05, rate: 0.85 });
      this.beds.throat?.stop(0.8);
      this.beds.sway?.gain(0.08, 1.2);
    });
    this.beat(DOOR_CLOSES[0] + 0.28, () => s.play('rooms/door_shut_soft.mp3', { gain: 0.44, reverb: 0.25, pan: -0.05 }));
    this.beat(LAMP_OFF, () => s.play('rooms/switch_small.mp3', { gain: 0.32, reverb: 0.15, pan: -0.05 }));
    this.beat(LAMP_OFF + 0.2, () => {
      this.beds.tone?.gain(0, 1);
      this.beds.drone?.gain(0, 1.2);
      this.clockVoice?.gain(0, 0.2);
      this.beds.sway?.gain(0, 0.5);
      this.beds.breath?.gain(0, 1.4);
    });
    this.beat(TV_ON, () => s.play('rooms/tv_on.mp3', { gain: 0.42 }));
    this.beat(TV_ON + 0.7, () => {
      s.bed('rooms/tv_hum.mp3', { gain: 0.1, fade: 0.6, pan: 0.05 });
      s.bed('rooms/tv_static.mp3', { gain: 0.06, fade: 0.8, pan: 0.05 });
      this.beds.breath?.gain(0.14, 2);
    });
    this.beat(RING_AGAIN, () => {
      s.play('rooms/phone_ring.mp3', { gain: 0.55, reverb: 0.2, pan: -0.2, duration: 1.15 });
      this.say({ tr: 'Arkandayım.', en: 'I am behind you.' }, 3.2);
    });
    this.beat(73.3, () => s.play('rooms/coat_move.mp3', { gain: 0.22, reverb: 0.08, duration: 0.8 }));
    this.beat(CUT_AT, () => s.stopAll(0.08));
  }

  private answer(s: number): void {
    if (this.answeredAt !== Infinity) return;
    this.answeredAt = s;
    this.ringVoice?.stop(0.06);
    this.sound.play('rooms/phone_pickup_1.mp3', { gain: 0.45, pan: 0.3 });
    this.beds.phone = this.sound.bed('rooms/phone_line_breath.mp3', { gain: 0.32, fade: 0.5, pan: 0.32 });
    this.setHint('');
  }

  private setHint(which: 'answer' | 'hold' | ''): void {
    if (this.hintShown === which) return;
    this.hintShown = which;
    this.hint(which === 'answer' ? { tr: 'Bas: aç', en: 'Press: answer' } : which === 'hold' ? { tr: 'Basılı tut: nefesini tut', en: 'Hold: hold your breath' } : null);
  }

  /** Eyes shut and open again: closes over a..b, opens over c..d. */
  private lid(s: number, a: number, b: number, c: number, d: number): number {
    return Math.min(range(a, b, s), 1 - range(c, d, s));
  }

  private eyelids(s: number): number {
    let shut = 1 - smootherstep(range(0, 1.4, s));
    shut = Math.max(shut, smootherstep(this.lid(s, 35.2, 35.9, 36.35, 37.2)));
    shut = Math.max(shut, smootherstep(this.lid(s, BLINK_AWAY - 0.32, BLINK_AWAY - 0.06, BLINK_AWAY + 0.08, BLINK_AWAY + 0.4)));
    if (REDUCED_MOTION) {
      shut = Math.max(shut, smootherstep(this.lid(s, 62.5, 62.85, 63.05, 63.5)));
      shut = Math.max(shut, smootherstep(this.lid(s, TURN_AT + 0.35, TURN_AT + 0.85, TURN_AT + 1.15, TURN_AT + 1.7)));
    }
    return s >= CUT_AT ? 1 : shut;
  }

  override pose(t: number, out: RoomPose): RoomPose {
    super.pose(t, out);
    const s = t * this.seconds;
    const wrapped = Math.atan2(Math.sin(this.gazeYaw), Math.cos(this.gazeYaw));
    const free = s < WARDROBE_AT ? 1 : range(LOOK_FREE, LOOK_FREE + 1.2, s);
    if (free < 1) {
      // in the wardrobe there is nowhere to look but out
      const yawLimit = clamp(out.fov * 0.62, 7, 28) * DEG;
      const pitchLimit = clamp(out.fov * 0.42, 5, 18) * DEG;
      out.yaw += (clamp(wrapped, -yawLimit, yawLimit) - wrapped) * (1 - free);
      out.pitch += (clamp(this.gazePitch, -pitchLimit, pitchLimit) - this.gazePitch) * (1 - free);
    }
    const turn = REDUCED_MOTION ? (s >= TURN_AT + 1 ? 1 : 0) : smootherstep(range(TURN_AT, TURN_AT + 2, s));
    if (turn > 0) out.yaw += ((wrapped >= 0 ? Math.PI : -Math.PI) - wrapped) * turn;
    return out;
  }

  /** Called once the pictures of the set are wanted: the room's light is as it should be, and nobody is looking. */
  private takePictures(view: PerspectiveCamera): void {
    this.you.visible = true;
    this.carcass.visible = false;
    this.backPanel.visible = false;
    this.hanging.visible = false;
    this.otherNeck.mesh.visible = false;
    const cam = this.pictureCamera;
    cam.layers.mask = view.layers.mask;
    this.world(PICTURE.at[0], PICTURE.at[1], PICTURE.at[2], cam.position);
    this.world(PICTURE.look[0], PICTURE.look[1], PICTURE.look[2], vA);
    cam.lookAt(vA);
    cam.updateProjectionMatrix();
    this.pictureLight.intensity = 1.7;
    const keySpot = this.spotNear.intensity;
    this.spotNear.intensity = 0;
    this.hanging.position.x = WARD.hangX + PICTURE.coatShift;
    for (const m of this.coatMaterials) m.color.multiplyScalar(PICTURE.coatDark);
    this.kit.renderDream(this.pictureA, cam);
    this.hanging.visible = true;
    this.otherNeck.mesh.visible = true;
    this.kit.renderDream(this.pictureB, cam);
    this.pictureLight.intensity = 0;
    this.spotNear.intensity = keySpot;
    this.hanging.position.x = WARD.hangX;
    for (const m of this.coatMaterials) m.color.multiplyScalar(1 / PICTURE.coatDark);
    this.you.visible = false;
    this.carcass.visible = true;
    this.backPanel.visible = true;
    this.otherNeck.mesh.visible = false;
    this.captured = true;
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const ds = s - this.lastS;
    this.lastS = s;
    const input = frame.input;
    this.you.visible = false;
    this.otherNeck.mesh.visible = false;
    this.gazeYaw = input.gazeYaw;
    this.gazePitch = input.gazePitch;
    for (const c of this.clocks) c.value = frame.time;
    this.dustTime.value = s;

    // the viewer: answer, hold
    const ringing = s >= RING_AT - 0.2 && s < ANSWER_LATEST && this.answeredAt === Infinity;
    this.control.press = ringing || (s >= HOLD_FROM && s < HOLD_TO);
    if (ringing) {
      this.setHint('answer');
      if (input.pressed) this.answer(s);
    }
    this.breath(frame);

    // lamp, spots
    const lampOn = s < LAMP_OFF ? 1 : 1 - smootherstep(range(LAMP_OFF, LAMP_OFF + 0.14, s));
    const passing = 1 - 0.75 * Math.max(0, 1 - Math.abs(s - 48.3) / 0.14);
    const breath = (1 + 0.04 * wobble(frame.time * 0.7, 3)) * lampOn * passing * this.steps(s, 0.1);
    this.lampPoint.intensity = LAMP_POINT * breath;
    this.lampShade.emissiveIntensity = SHADE_GLOW * breath;
    (this.lampGlow.material as ShaderMaterial).uniforms.uColor.value.setHex(PALETTE.warm).multiplyScalar(LAMP_HALO * breath);
    const wantNear = s >= 48.3 && s < LAMP_OFF;
    const tvOn = s >= TV_ON;
    const keys = tvOn ? this.keysTv : wantNear ? this.keysNear : this.keysFar;
    if (keys !== this.spots) this.spots = keys;
    this.spotFar.intensity = LAMP_SPOT * breath * (s >= WARDROBE_AT ? 1.6 : 1);
    this.spotNear.intensity = LAMP_SPOT_NEAR * breath;
    if (tvOn && this.tvGlass) this.tvGlass.roughness = 0.9;
    if (this.tvCasing) this.tvCasing.color.setHex(tvOn ? 0x4a4036 : 0xc4a888);
    this.movingShadows = s > 42.5 && s < 58.4;
    if (!this.captured && s >= CAPTURE_AT) this.takePictures(frame.view);

    this.updateSet(frame, tvOn);
    this.updateClock(frame);
    this.updateDoor(s);
    this.updatePendant(s);
    this.updateHandset(s, frame.time);
    this.updateMan(s, ds, frame.time);
    this.updateCoat(s, frame.time);
    this.updateSlat(s);

    // the fill that lets the dark keep its shapes, a little stronger when something is close
    const close = smootherstep(range(50.6, 52.4, s)) * (1 - smootherstep(range(56.2, 56.9, s)));
    this.fill.intensity = 0.05 + 0.42 * close;

    // what the eye does
    this.drift = s < WARDROBE_AT ? 0.5 : 0.1;
    this.updateHair(s, frame.view.fov);
    this.black = this.eyelids(s);
    this.lensFor(s);
    this.fear = s < RING_AT ? 0.18 : s < 24 ? 0.42 : s < WARDROBE_AT ? lerp(0.45, 0.72, range(24, 36, s)) : s < LAMP_OFF ? lerp(0.72, 0.95, close) : s < TV_ON ? 0.3 : 0.86;

    // the shutter, when the second face of the picture has come up and they are looking at it
    const gazeOnSet = Math.abs(this.gazeYaw) < 0.2 && Math.abs(this.gazePitch) < 0.16;
    if (!this.shot && s >= PICTURE_MIX[0] + 1.3 && (gazeOnSet || s >= SHUTTER_LATEST)) {
      this.shot = true;
      this.shutter();
    }
    if (s > HOLD_TO) this.setHint('');
  }

  /** Your own breath: loud, and gone the moment you hold it; and the hint that says you can. */
  private breath(frame: RoomFrame): void {
    const s = frame.seconds;
    const holding = s >= HOLD_FROM && s < HOLD_TO && frame.input.holding;
    if (holding !== this.holdingBefore) {
      this.holdingBefore = holding;
      if (holding) {
        this.beds.breath?.gain(0, 0.14);
        this.sound.play('rooms/breath_held.mp3', { gain: 0.3 });
      } else if (s < HOLD_TO - 0.05) {
        this.beds.breath?.gain(0.3, 0.5);
        this.sound.play('rooms/breath_let_go.mp3', { gain: 0.32 });
      }
    }
    const hold = (s >= HOLD_FROM && s < 44) || (s >= 50.2 && s < 53);
    this.setHint(hold && !holding ? 'hold' : s >= RING_AT - 0.2 && s < ANSWER_LATEST && this.answeredAt === Infinity ? 'answer' : '');
    const beat = frame.heartbeat > 0.8;
    if (holding && beat && !this.beatBefore) this.sound.play('rooms/heart_beat.mp3', { gain: 0.4 });
    this.beatBefore = beat;
    if (this.pushAt === Infinity && s >= PUSH_FROM && s < PUSH_FROM + 2) {
      this.notHeld = holding ? 0 : this.notHeld + Math.max(0, frame.dt);
      if (this.notHeld > 0.3) {
        this.pushAt = s;
        this.sound.play('rooms/slat_push.mp3', { gain: 0.5 });
        this.sound.play('rooms/gasp_small.mp3', { gain: 0.3 });
      }
    }
  }

  /** A shiver the floor above puts in things: `amount` of it at the steps overhead. */
  private steps(s: number, amount: number): number {
    let v = 0;
    for (let i = 0; i < STEP_DUST.length; i++) {
      const age = s - STEP_DUST[i][0];
      if (age > 0 && age < 1.2) v += Math.exp(-age * 4);
    }
    return 1 - amount * v;
  }

  private updateSet(frame: RoomFrame, on: boolean): void {
    const s = frame.seconds;
    const u = this.screenUniforms;
    u.uTime.value = frame.time;
    u.uBright.value = on ? 1.7 : 0;
    u.uOpen.value = smootherstep(range(TV_ON, TV_ON + 0.5, s)) * 0.62;
    u.uNoise.value = 1 - smootherstep(range(TV_ON + 0.8, TV_ON + 1.5, s));
    u.uMix.value = smootherstep(range(PICTURE_MIX[0], PICTURE_MIX[1], s));
    u.uRoll.value = smootherstep(range(RING_AGAIN, RING_AGAIN + 1.1, s));
    const flicker = 0.84 + 0.16 * wobble(frame.time * 1.6, 5);
    const up = smootherstep(range(TV_ON, TV_ON + 0.5, s));
    this.tvPoint.intensity = on ? TV_POINT * up * flicker : 0;
    const atCoat = smootherstep(range(LOOK_FREE + 0.6, TURN_AT + 1.4, s));
    this.spotTv.intensity = on ? TV_SPOT * up * flicker * lerp(1, COAT_BARS, atCoat) : 0;
    this.coatLight.intensity = on ? COAT_GLOW * atCoat * flicker : 0;
  }

  private updateClock(frame: RoomFrame): void {
    if (this.clockBase < 0) {
      const d = new Date();
      this.clockBase = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() - frame.time;
    }
    // it ticks, and in the silence it stops
    const running = frame.time - Math.max(0, frame.seconds - (LAMP_OFF + 0.2));
    setClock(this.clockHands, Math.floor(this.clockBase + running));
  }

  private updateDoor(s: number): void {
    const opened = smootherstep(range(DOOR_OPENS[0], DOOR_OPENS[1], s)) * (1 - smootherstep(range(DOOR_CLOSES[0], DOOR_CLOSES[1], s)));
    this.doorPivot.rotation.y = -DOOR.swing * opened;
    const turned = smootherstep(range(HANDLE_AT, DOOR_OPENS[0] - 0.1, s)) * (1 - smootherstep(range(DOOR_OPENS[0] + 0.2, DOOR_OPENS[0] + 0.35, s)));
    this.lever.rotation.z = turned * 0.62;
    this.feet[0].visible = s >= 34.1 && s < DOOR_OPENS[0];
    this.feet[1].visible = s >= 34.6 && s < DOOR_OPENS[0];
    this.underDoor.visible = s < DOOR_OPENS[0] + 0.3;
  }

  private updatePendant(s: number): void {
    let x = 0;
    let z = 0;
    for (let i = 0; i < STEP_DUST.length; i++) {
      const age = s - STEP_DUST[i][0];
      if (age > 0 && age < 5) {
        const a = STEP_DUST[i][3] * Math.exp(-age * 0.8);
        x += a * Math.sin(age * 8.3);
        z += a * Math.sin(age * 6.4 + 1);
      }
    }
    const k = REDUCED_MOTION ? 0.35 : 1;
    this.pendant.rotation.x = x * 0.03 * k;
    this.pendant.rotation.z = z * 0.03 * k;
  }

  private updateHandset(s: number, time: number): void {
    const h = this.phoneHandset;
    const c = this.cord.points;
    c[0].copy(this.cordFrom);
    if (s < WARDROBE_AT) {
      const up = this.answeredAt === Infinity ? 0 : smootherstep(range(this.answeredAt, this.answeredAt + 0.72, s));
      h.visible = up < 0.985;
      h.position.lerpVectors(this.handsetRest, this.earAt, up);
      h.position.y += Math.sin(up * Math.PI) * 0.08;
      const ringing = this.answeredAt === Infinity && s >= RING_AT && (s - RING_AT) % 3 < 2.2 ? 1 : 0;
      h.position.x += ringing * Math.sin(time * 70) * 0.0014;
      h.position.y += ringing * Math.cos(time * 57) * 0.001;
      h.quaternion.setFromAxisAngle(AXIS, up * 0.7);
      c[1].lerpVectors(this.cordFrom, h.position, 0.33);
      c[1].y -= 0.03 + 0.05 * up;
      c[2].lerpVectors(this.cordFrom, h.position, 0.7);
      c[2].y -= 0.03 + 0.03 * up;
      c[3].copy(h.position);
    } else {
      h.visible = true;
      let swing = 0.13 * Math.exp(-(s - WARDROBE_AT) * 0.22) * Math.sin((s - WARDROBE_AT) * 3.2);
      if (s > 46.6) swing += 0.2 * Math.exp(-(s - 46.6) * 0.34) * Math.sin((s - 46.6) * 3.2);
      swing += 0.008 * wobble(time, 7);
      const cosine = Math.cos(swing);
      const sine = Math.sin(swing);
      h.position.copy(this.hangAt).addScaledVector(HANG_SIDE, sine * HANG_LENGTH);
      h.position.y = this.hangAt.y - cosine * HANG_LENGTH;
      h.quaternion.setFromAxisAngle(AXIS, Math.PI / 2 + swing);
      c[1].lerpVectors(this.cordFrom, this.hangAt, 0.55);
      c[1].y += 0.008;
      c[2].copy(this.hangAt);
      c[3].copy(h.position);
      c[3].y += 0.08;
    }
    this.cord.solve(this.cordGirth);
  }

  private updateCoat(s: number, time: number): void {
    this.standCoat.visible = s < WARDROBE_AT;
    // it keeps a little of a movement nobody saw, then it is only a coat
    const late = range(70, 73.6, s);
    const k = REDUCED_MOTION ? 0.4 : 1;
    this.hanging.rotation.z = k * 0.018 * Math.sin(time * 1.4) * (1 - late);
    this.hanging.rotation.x = k * 0.012 * Math.sin(time * 1.1 + 1) * (1 - late);
  }

  private updateHair(s: number, fov: number): void {
    const fall = smootherstep(range(HAIR_FALL[0], HAIR_FALL[1], s));
    this.hairOnLens.visible = fall > 0.001 && s < CUT_AT;
    const size = Math.tan((fov * DEG) / 2) * LENS_HAIR_Z;
    this.hairOnLens.scale.setScalar(size);
    const aside = smootherstep(range(HAIR_ASIDE[0], HAIR_ASIDE[1], s));
    this.hairOnLens.position.y = ((1 - fall) * 1.6 + HAIR_ASIDE_Y * aside) * size;
    this.hairOnLens.position.x = HAIR_ASIDE_X * size * aside;
  }

  private lensFor(s: number): void {
    if (s < WARDROBE_AT) {
      const toPhone = smootherstep(range(12.6, 13.6, s)) * (1 - smootherstep(range(22.5, 24, s)));
      const toDoor = smootherstep(range(31, 33.6, s));
      this.focus = lerp(lerp(3.2, 1.25, toPhone), 3.3, toDoor);
      this.aperture = 2.6;
      return;
    }
    const atGap = smootherstep(range(50.6, 52.4, s)) * (1 - smootherstep(range(56.3, 56.9, s)));
    const pushed = this.pushAt !== Infinity ? smootherstep(range(this.pushAt, this.pushAt + 0.5, s)) : 0;
    const atCoat = smootherstep(range(LOOK_FREE + 0.6, TURN_AT + 1.4, s));
    let focus = lerp(4.4, lerp(0.4, 0.22, pushed), atGap);
    focus = lerp(focus, 0.3, atCoat);
    this.focus = focus;
    this.aperture = lerp(lerp(2.2, 1.5, atGap), 0.5, atCoat);
  }

  private updateMan(s: number, ds: number, time: number): void {
    const man = this.man;
    const here = s >= 41.9 && s < DOOR_CLOSES[1] + 0.05;
    man.root.visible = here;
    this.neck.mesh.visible = here && s >= 42.2;
    if (!here) return;

    const walking = (s >= 43.5 && s < 45.7) || (s >= 47.6 && s < 50.25) || (s >= BLINK_AWAY + 0.05 && s < 57.9);
    if (walking !== this.walking) {
      this.walking = walking;
      man.play(walking ? WALK_CLIP : STAND_CLIP, 0.35);
    }
    man.update(ds * (walking ? WALK_RATE : 0.5));
    if (this.hips) {
      this.hips.position.x = this.hipsRest.x;
      this.hips.position.z = this.hipsRest.y;
    }
    if (this.head) this.head.scale.setScalar(0.001);

    const heading = this.track.heading.at(s);
    man.root.position.set(this.track.x.at(s), 0, this.track.z.at(s));
    man.root.rotation.y = heading;
    man.root.updateMatrixWorld(true);
    this.neckBone?.getWorldPosition(this.collar);
    this.collar.sub(this.origin);
    this.layNeck(s, heading, time);
    // the light comes round his front, from where the wardrobe is
    this.world(man.root.position.x + Math.sin(heading) * 0.75, 0.9, man.root.position.z + Math.cos(heading) * 0.75, this.neckLight.position);
    this.neckLight.intensity = 0.26 * smootherstep(range(44, 45.4, s)) * (1 - smootherstep(range(BLINK_AWAY - 0.5, BLINK_AWAY, s)));
  }

  private put(v: Vector3, forward: number, up: number, right: number): void {
    v.copy(this.collar).addScaledVector(vF, forward).addScaledVector(vR, right);
    v.y += up;
  }

  /** The neck hangs in front of him and feels the air. It goes to the handset; then it comes up the slats, gap by gap. */
  private layNeck(s: number, heading: number, time: number): void {
    vF.set(Math.sin(heading), 0, Math.cos(heading));
    vR.set(Math.cos(heading), 0, -Math.sin(heading));
    const k = REDUCED_MOTION ? 0.45 : 1;
    const a = Math.sin(time * 0.95) * 0.1 * k;
    const b = Math.cos(time * 0.68 + 1) * 0.08 * k;
    const c = Math.sin(time * 1.7 + 2) * 0.03 * k;
    const H = this.hang;
    const R = this.reach;
    this.put(H[0], 0, 0, 0);
    this.put(H[1], 0.06, 0.15, 0);
    this.put(H[2], 0.36, 0.14, a * 0.4);
    this.put(H[3], 0.56 + c, -0.42, a);
    this.put(H[4], 0.5 + b * 0.5, -0.94, a * 1.6 + c);
    this.put(H[5], 0.62 + b, -1.25, a * 2.2 - c);

    const sniff = smootherstep(range(45.8, 46.5, s)) * (1 - smootherstep(range(47.0, 47.7, s)));
    const withdraw = this.pushAt !== Infinity ? WITHDRAW_PUSHED : WITHDRAW_HELD;
    const slats = smootherstep(range(50.5, 51.5, s)) * (1 - smootherstep(range(withdraw, withdraw + 0.7, s)));
    let w = 0;
    let mouth = 0.45;
    let flat = 1;
    this.swallow = -1;
    if (slats > 0.001) {
      w = slats;
      const climb = smootherstep(range(50.8, 52.5, s));
      const tick = Math.sin(climb * Math.PI * 10) * 0.007 * (1 - climb);
      const push = this.pushAt !== Infinity ? smootherstep(range(this.pushAt, this.pushAt + 0.42, s)) * (1 - smootherstep(range(withdraw, withdraw + 0.55, s))) : 0;
      const enter = smootherstep(range(52.5, 53.0, s));
      const x = EYE_WARDROBE[0] - 0.012 + (1 - climb) * 0.06 * Math.sin(time * 1.6);
      const y = lerp(1.0, SLAT.gapY, climb) + tick + 0.004 * Math.sin(time * 1.1);
      const z = lerp(SLAT.z - 0.14, SLAT.z - 0.012, enter) + push * 0.2;
      this.put(R[0], 0, 0, 0);
      this.put(R[1], 0.05, 0.1, 0);
      this.put(R[2], 0.16, -0.5, a * 0.6);
      this.put(R[3], 0.34, -0.72, a);
      R[4].set(x + a * 0.1, y - 0.1 - 0.12 * (1 - enter), z - 0.22 - push * 0.1);
      R[5].set(x, y, z);
      mouth = 0.5 + 0.26 * Math.sin(time * 2.1) + push * 0.3;
      flat = lerp(0.62, 0.92, push) * lerp(1, 0.9, enter);
      if (s > 52.6) this.swallow = ((s - 52.6) * 0.24) % 1;
    } else if (sniff > 0.001) {
      w = sniff;
      const h = this.phoneHandset.position;
      this.put(R[0], 0, 0, 0);
      this.put(R[1], 0.08, 0.12, 0);
      R[2].lerpVectors(this.collar, h, 0.3);
      R[2].y += 0.14;
      R[3].lerpVectors(this.collar, h, 0.62);
      R[3].y += 0.06;
      R[4].copy(h);
      R[4].y += 0.34;
      R[5].copy(h);
      R[5].y += 0.12;
      R[5].z += 0.03 * Math.sin(time * 2.4);
      mouth = 0.55 + 0.25 * Math.sin(time * 3.1);
    } else {
      for (let i = 0; i < 6; i++) R[i].copy(H[i]);
    }
    for (let i = 0; i < 6; i++) this.neck.points[i].lerpVectors(H[i], R[i], w);
    this.neckClock = time;
    this.neck.solve(this.neckGirth, mouth, flat);
  }

  /** The slat: bent in where it was pushed, and it does not quite come back. */
  private updateSlat(s: number): void {
    const withdraw = this.pushAt !== Infinity ? WITHDRAW_PUSHED : WITHDRAW_HELD;
    const pushed = this.pushAt !== Infinity ? smootherstep(range(this.pushAt, this.pushAt + 0.4, s)) : 0;
    const left = 0.1 + 0.9 * (1 - smootherstep(range(withdraw, withdraw + 0.5, s)));
    const bend = pushed * left;
    this.slatLeft.rotation.y = -bend * 0.42;
    this.slatRight.rotation.y = bend * 0.42;
  }

  override dispose(): void {
    this.pictureA.dispose();
    this.pictureB.dispose();
    super.dispose();
  }
}

