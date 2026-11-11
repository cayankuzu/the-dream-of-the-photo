import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshDepthMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  PlaneGeometry,
  Points,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type Bone,
  type Material,
  type SkinnedMesh,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { SpotSpec } from '../../../config/nightmare.config';
import { meterUVs, type DreamKit } from '../../dream/DreamKit';
import { randomFrom, type AvatarKey, type FigureSpec } from '../../dream/FigureKit';
import type { DreamLight } from '../../dream/LightPool';
import { clamp, damp, lerp, range, smootherstep } from '../../math';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey, RoomPose } from '../Room';
import { Room } from '../Room';
import type { RoomVoice } from '../RoomSound';

type V3 = readonly [number, number, number];

/** The hall (m): half its width at the stall fronts, its back wall (behind you), a bay of stalls and how many, how deep a stall goes and how high, the sign board over it, the eaves, the ridge. */
const HALF_W = 6;
const BACK_Z = 14;
const BAY = 3.6;
const BAYS = 24;
const FAR_Z = BACK_Z - BAYS * BAY;
const STALL_DEEP = 2.6;
const STALL_H = 3.1;
const SIGN_H = 0.6;
const EAVES = 8;
const RIDGE = 12;
/** A pier between two stalls (m: across, along); the counter in a stall (m: deep, high). */
const PIER_W = 0.55;
const PIER_D = 0.6;
const COUNTER_D = 0.55;
const COUNTER_H = 0.95;
/** The gate in the far wall (m), and the doors you came in by. */
const GATE_W = 4.2;
const GATE_H = 4.6;
const DOORS_W = 4.4;
const DOORS_H = 4.2;
/** The eye of a child (m above the sawdust). */
const EYE_Y = 0.95;
/** Sawdust: how many meters one square of it covers. */
const SAWDUST_TILE = 1.6;

/** Seconds of the room: the hand comes down out of the dark and hangs, is reached, closes; the pull ends, the eye stops. */
const HAND_FROM = 7.8;
const HAND_DOWN = 9.4;
const GRAB_AT = 11.4;
const CLOSED_AT = 11.85;
const HELD_AT = 12;
const RUN_TO = 15.8;
const STOP_AT = 16.4;
/** While the eye is up the arm the market empties (s); it lets go; the bulbs go out; the hand is drawn up its arm. */
const EMPTY_AT = 18.5;
const LET_GO = 20;
const OPENED_AT = 20.35;
const BULBS_OUT = 20.2;
const WITHDRAW: readonly [number, number] = [20.15, 21.5];
/** The shutter, the line, the cut (s). */
const SHUTTER_AT = 22.8;
const LINE_AT = 24;
const CUT_AT = 27.5;
/** The scroll pushes the eye except while the arm is looked up and let go (s). */
const LOCK: readonly [number, number] = [15.6, 22.2];
/** All sound but the air stops here, before the eye goes up the arm (s). */
const SILENCE_AT = 15.6;

/** The eye's way: second, x, z (m), heading, pitch (deg), fov. */
const EYE_PATH: readonly (readonly [number, number, number, number, number, number])[] = [
  [0, 0, 0, 0, -3, 56],
  [3, 0.1, -1.4, -1.5, -3, 56],
  [6, -0.05, -2.95, 1.5, -2, 56],
  [9, 0.02, -4.55, 1, 0, 55],
  [10.5, -0.05, -5.5, 4, 5, 53],
  [GRAB_AT, -0.08, -6.05, 6, 6, 52],
  [12.1, -0.05, -6.9, 2, -1, 56],
  [13, 0.15, -9.6, -3, -2, 60],
  [14, -0.15, -12.9, 3, -2, 61],
  [15, 0.12, -16.3, -2, -2, 60],
  [RUN_TO, 0, -18.9, 1, 0, 58],
  [STOP_AT, 0, -19.9, 3, 4, 56],
  [17.4, 0, -20.05, 6, 24, 46],
  [18.6, 0, -20.1, 15, 44, 36],
  [19.8, 0, -20.12, 19, 50, 32],
  [20.6, 0, -20.15, 16, 46, 36],
  [21.9, 0, -20.6, 2, 1.5, 44],
  [24, 0, -22.3, 0, 1, 41],
  [28, 0, -25.6, 0, 1, 40],
];
/** How far the viewer's legs lean the eye into the crowd (m), and how much it dips (deg); how fast it follows them (1/s). */
const PUSH_LEAN = 0.3;
const PUSH_DIP = 3;
const PUSH_RATE = 2.5;

/** The arm while it holds you, from the eye (m: right, up, back): the wrist first, up to where the arm ends. */
const ARM: readonly V3[] = [
  [-0.42, -0.2, -0.62],
  [-0.4, 0.3, -1.1],
  [-0.37, 0.9, -1.75],
  [-0.4, 1.8, -2.6],
  [-0.6, 3.0, -3.3],
  [-1.0, 4.5, -3.6],
  [-1.6, 6.05, -3.7],
];
/** The arm's skin: radius at the wrist (m), how much thicker at its far end, how far it reaches into the hand (m), one square of skin (m), its tint. */
const ARM_RADIUS = 0.03;
const ARM_SWELL = 2;
const ARM_INTO_HAND = 0.05;
const SKIN_TILE = 0.7;
const ARM_TINT = 0x7a716c;
/** The palm while it holds you (eye frame), and the hand while it hangs (room frame): fingers down and a little toward you, the palm to you. */
const HELD_PALM: V3 = [0.9, 0.1, 0.4];
const HANG_FINGERS: V3 = [0, -0.97, 0.24];
const HANG_PALM: V3 = [0, 0.24, 0.97];
/** Where the wrist hangs before it is reached (room frame, m), and how far above that it comes down from. */
const HANG_AT: V3 = [-0.3, 1.28, -6.75];
const DESCEND = 2.4;
/** Her hand: how much larger than the avatar's, how much of a skin's weight must be the hand's for it to be kept, its tint, the curl of each joint when it holds (rad), the thumb's, how open it hangs (share of the curl). */
const HAND_SCALE = 1.5;
const HAND_KEEP = 0.2;
const HAND_TINT = 0x7a716c;
const CURL: V3 = [0.3, 0.5, 0.35];
const THUMB_CURL: V3 = [0.05, 0.15, 0.15];
const OPEN = -0.3;
/** The thin ring: radius round the finger, thickness, how far along the finger's first bone (life m). */
const RING_R = 0.0088;
const RING_TUBE = 0.0011;
const RING_ALONG = 0.02;
/** How far the hand is drawn up its own arm once it has let go (m). */
const WITHDRAW_BY = 9;
/** The light the hand keeps while it hangs and once it holds you, close to the eye (power), its reach (m), from where (m: right, up, toward you, turned with the hand). */
const HAND_LIGHT = 0.22;
const HAND_LIGHT_HELD = 0.06;
const HAND_REACH = 1.1;
const HAND_LIGHT_AT: V3 = [0.08, 0.02, 0.5];

/** The crowd: how much larger than life (range), how long a step cycle takes (s), the bands they walk in at each side of your way (|x| from, to, spacing along z, all m), the z they start between. */
const CROWD_SCALE: readonly [number, number] = [1.42, 1.58];
const GAIT_CYCLE = 2.6;
const BANDS: readonly (readonly [number, number, number])[] = [
  [1.45, 2.05, 1.8],
  [2.75, 3.35, 2.6],
  [4.05, 4.75, 3.6],
];
const CROWD_FROM = 3.5;
const CROWD_TO = -31.5;
/** Those who walk in your way, met at these seconds (to the left, then the right, by turns); how far aside they step for you (m, center to center); where that begins ahead of you, is done, and ends behind you (m). */
const IN_THE_WAY: readonly number[] = [1.6, 3, 4.4, 5.8, 7.2, 12.7, 13.9, 15];
const CLEAR = 1.3;
const PART_AHEAD = 5.5;
const PART_FULL = 2.2;
const PART_BEHIND = 2.5;
/** Where their bodies end (life m: the chest), and over how much below that they go dark. */
const BODY_END = 1.42;
const BODY_DARK = 0.5;
/** Their clothes: the tint, how bleached, and how much lighter or darker one is than another (range of a multiplier). */
const COAT = 0x1f2024;
const COAT_BLEACH = 0.75;
const COAT_TONE: readonly [number, number] = [0.7, 1.25];
/** The low warm light far down the hall that the crowd walks out of: where, aimed at, candela, half-angle (deg), color; its haze (m wide, glows across it, the size and strength of each). */
const KEY_AT: V3 = [0, 1.25, -46];
const KEY_TARGET: V3 = [0, 0.15, 6];
const KEY_POWER = 4500;
const KEY_ANGLE = 9;
const KEY_COLOR = 0xffbf86;
const HAZE: readonly [number, number, number, number] = [6, 7, 3.2, 1.6];
/** What the sawdust gives back to the legs nearest you: how far ahead (m), how high, power, reach (m). */
const BOUNCE_AHEAD = 3.2;
const BOUNCE_Y = 0.9;
const BOUNCE = 1;
const BOUNCE_REACH = 5;
/** Strings of bulbs across the hall: on every how many trusses (from the second), how high they hang at the walls and how far they sag (m), bulbs on a string, each one's glow (size m, strength), their light (power, reach m) and where along the string it hangs (m: on the side the arm goes up). */
const STRING_EVERY = 2;
const STRING_TOP = 7.7;
const STRING_SAG = 1.1;
const STRING_BULBS = 5;
const BULB_SPRITE = 0.42;
const BULB_SHINE = 0.55;
const STRING_POWER = 5;
const STRING_REACH = 5;
const STRING_LIGHT_X = -2;
/** The one bulb of the empty hall (room frame, m): the pool it throws (candela, half-angle deg), the air round it down the hall (power, reach m), its glow (size m, strength). */
const BULB_AT: V3 = [0.35, 4.3, -40.5];
const BULB_POOL = 120;
const BULB_ANGLE = 52;
const BULB_POWER = 6;
const BULB_REACH = 16;
const BULB_HALO: readonly [number, number] = [0.5, 1.6];
/** The night in the gate, and how much of it shows while the market is full. */
const NIGHT = 0x0d161b;
const NIGHT_FULL = 0.25;

/** The woman at the end of the hall: how far ahead of you she always is (m), how far right, how much larger than life, her coat. */
const HER_GAP = 19;
const HER_X = -0.9;
const HER_SCALE = 1.5;
const HER_COAT = 0x2c2b30;
/** Her hair down her back: strands, how far down (life m), how wide a strand (m). */
const HAIR_STRANDS = 280;
const HAIR_FALL: readonly [number, number] = [0.4, 0.72];
const HAIR_WIDTH: readonly [number, number] = [0.0014, 0.0032];

/** The air: the night's color, its thickness while the market is full and once it is empty, the light from nowhere. */
const FOG_COLOR = 0x0a0807;
const FOG_FULL = 0.03;
const FOG_EMPTY = 0.013;
const ENV_FULL = 0.12;
const ENV_EMPTY = 0.1;

/** Footsteps of the crowd: heard within (m), how loud at the nearest, at most one in this many seconds, how quiet under the first words. */
const STEP_HEARD = 4.5;
const STEP_GAIN = 0.22;
const STEP_GAP = 0.085;
const STEP_HUSH = 0.35;
const STEP_HUSH_AT: readonly [number, number] = [0.5, 4];
/** Her steps, far away. */
const HER_STEP_GAIN = 0.07;
const STEPS = ['rooms/step_wood_1.mp3', 'rooms/step_wood_2.mp3', 'rooms/step_wood_3.mp3', 'rooms/step_wood_4.mp3'] as const;

/** The trades painted over the stalls. */
const TRADES = ['MANAV', 'KASAP', 'BALIKÇI', 'BAKKAL', 'PEYNİRCİ', 'KURUYEMİŞ', 'ZAHİRE', 'TUHAFİYE', 'SEBZE MEYVE', 'ŞARKÜTERİ', 'BAHARAT', 'TAVUKÇU', 'ZEYTİNCİ', 'TURŞUCU', 'YUFKACI', 'SAKATATÇI'];
/** Paint of the signs and of the shutters. */
const SIGN_PAINTS = ['#1f3127', '#3a1b17', '#7f775f', '#1c2330', '#4a3a1c'];
const SHUTTER_PAINTS = ['#4b5650', '#3d4a52', '#5a4a3a', '#46523d', '#55554f'];

export const assets: RoomAssets = {
  materials: ['wood_floor_dark', 'plaster_damaged', 'plaster_mould', 'conc_stained', 'wood_raw_boards', 'wood_dark_paint'],
  sounds: [
    'rooms/hall_vast.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/dream_drone_hollow.mp3',
    'rooms/dream_drone_glass.mp3',
    'rooms/bulb_hum.mp3',
    'rooms/crowd_rise.mp3',
    'rooms/run_feet.mp3',
    'rooms/door_pass_1.mp3',
    'rooms/door_pass_2.mp3',
    'rooms/coat_move.mp3',
    'rooms/belt_slither_1.mp3',
    ...STEPS,
  ],
};

const UP = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const m1 = new Matrix4();
const v1 = new Vector3();
const v2 = new Vector3();
const q1 = new Quaternion();
const q2 = new Quaternion();
const weights = [0, 0, 0, 0];
const toned = new Color();

function canvasOf(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, data = false): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const t = new CanvasTexture(canvas);
  t.colorSpace = data ? NoColorSpace : SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Sawdust lying on boards: a bed of fine dust, chips and curls of shaving, little heaps. It repeats. */
function drawSawdust(c: CanvasRenderingContext2D, s: number): void {
  const random = randomFrom(57);
  c.fillStyle = 'rgba(140,112,76,0.86)';
  c.fillRect(0, 0, s, s);
  const chips: number[][] = [];
  const add = (x: number, y: number, length: number, width: number, alpha: number) => chips.push([x, y, length, width, random() * Math.PI, random(), alpha, 28 + random() * 14]);
  for (let i = 0; i < 52000; i++) add(random() * s, random() * s, 0.6 + random() * 1.4, 0.5 + random() * 0.9, 0.4 + random() * 0.5);
  for (let k = 0; k < 160; k++) {
    const cx = random() * s;
    const cy = random() * s;
    const r = 12 + random() * 60;
    const n = 30 + Math.floor(random() * 120);
    for (let i = 0; i < n; i++) {
      const a = random() * Math.PI * 2;
      const d = r * Math.sqrt(-2 * Math.log(Math.max(1e-4, random()))) * 0.5;
      add(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1.2 + random() * 3.5, 0.6 + random() * 1.4, 0.65 + random() * 0.35);
    }
  }
  for (let i = 0; i < 6000; i++) add(random() * s, random() * s, 2 + random() * 5, 0.8 + random() * 1.6, 0.6 + random() * 0.4);
  for (const [x, y, length, width, angle, light, alpha, hue] of chips) {
    c.fillStyle = `hsla(${hue.toFixed(0)}, ${(34 + light * 24).toFixed(0)}%, ${(24 + light * 44).toFixed(0)}%, ${alpha.toFixed(2)})`;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    // what lies over an edge lies over the opposite one too, so that the square repeats without a seam
    for (const dx of [-s, 0, s]) {
      for (const dy of [-s, 0, s]) {
        const px = x + dx;
        const py = y + dy;
        if (px < -8 || px > s + 8 || py < -8 || py > s + 8) continue;
        c.setTransform(ca, sa, -sa, ca, px, py);
        c.fillRect(-length, -width / 2, length * 2, width);
      }
    }
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
}

/** How thick the sawdust lies over the whole floor (white: thick): drifts along the stalls, a trodden way down the middle, bare patches and heaps. */
function drawDrifts(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(61);
  const halfAll = HALF_W + STALL_DEEP;
  const stop = (x: number) => clamp((x + halfAll) / (2 * halfAll), 0, 1);
  c.fillStyle = 'rgb(232,232,232)';
  c.fillRect(0, 0, w, h);
  const across = c.createLinearGradient(0, 0, w, 0);
  across.addColorStop(0, 'rgba(255,255,255,0.9)');
  across.addColorStop(stop(-HALF_W + 0.6), 'rgba(255,255,255,0.3)');
  across.addColorStop(stop(-2.4), 'rgba(0,0,0,0)');
  across.addColorStop(stop(-1.1), 'rgba(0,0,0,0.6)');
  across.addColorStop(stop(1.1), 'rgba(0,0,0,0.6)');
  across.addColorStop(stop(2.4), 'rgba(0,0,0,0)');
  across.addColorStop(stop(HALF_W - 0.6), 'rgba(255,255,255,0.3)');
  across.addColorStop(1, 'rgba(255,255,255,0.9)');
  c.fillStyle = across;
  c.fillRect(0, 0, w, h);
  // scuffs along the trodden way, long in the way people walked
  for (let i = 0; i < 700; i++) {
    const x = w / 2 + (random() - 0.5) * w * 0.32;
    const y = random() * h;
    c.fillStyle = random() < 0.6 ? `rgba(0,0,0,${0.15 + random() * 0.3})` : `rgba(255,255,255,${0.1 + random() * 0.25})`;
    c.fillRect(x, y, 1 + random() * 2, 3 + random() * 14);
  }
  for (let i = 0; i < 260; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = (3 + random() * 14) * (w / 64);
    const bare = random() < 0.5;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, bare ? `rgba(0,0,0,${0.2 + random() * 0.4})` : `rgba(255,255,255,${0.2 + random() * 0.35})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** One side's roller shutters, bay by bay along the hall: painted steel slats, rust from the top and the bottom, the stall's number. */
function drawShutters(c: CanvasRenderingContext2D, w: number, h: number, seed: number, first: number): void {
  const random = randomFrom(seed);
  const slot = w / BAYS;
  const slat = h / (STALL_H / 0.075);
  for (let i = 0; i < BAYS; i++) {
    const x0 = i * slot;
    c.fillStyle = SHUTTER_PAINTS[Math.floor(random() * SHUTTER_PAINTS.length)];
    c.fillRect(x0, 0, slot + 1, h);
    for (let y = 0; y < h; y += slat) {
      c.fillStyle = 'rgba(0,0,0,0.42)';
      c.fillRect(x0, y, slot, 1.3);
      c.fillStyle = 'rgba(255,255,255,0.05)';
      c.fillRect(x0, y + 2, slot, 1);
    }
    for (let k = 0; k < 10 + random() * 10; k++) {
      const x = x0 + random() * slot;
      const top = random() < 0.6;
      const length = (0.08 + random() * 0.5) * h;
      const g = c.createLinearGradient(0, top ? 0 : h, 0, top ? length : h - length);
      const a = 0.15 + random() * 0.4;
      g.addColorStop(0, `rgba(78,38,16,${a})`);
      g.addColorStop(1, 'rgba(78,38,16,0)');
      c.fillStyle = g;
      c.fillRect(x, top ? 0 : h - length, 1 + random() * 5, length);
    }
    const dirt = c.createLinearGradient(0, h, 0, h * 0.75);
    dirt.addColorStop(0, 'rgba(24,16,9,0.75)');
    dirt.addColorStop(1, 'rgba(24,16,9,0)');
    c.fillStyle = dirt;
    c.fillRect(x0, h * 0.75, slot, h * 0.25);
    c.fillStyle = 'rgba(10,10,10,0.9)';
    c.fillRect(x0, h - 7, slot, 7);
    c.fillStyle = 'rgba(30,28,24,1)';
    c.fillRect(x0 + slot / 2 - 7, h - 22, 14, 12);
    c.fillStyle = `rgba(214,206,186,${0.16 + random() * 0.16})`;
    c.font = `bold ${Math.round(h * 0.2)}px "Arial Narrow", Arial, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(first + i), x0 + slot / 2, h * 0.36);
  }
}

/** One side's sign boards, bay by bay: a painted trade and the stall's number, faded and flaking. */
function drawSigns(c: CanvasRenderingContext2D, w: number, h: number, seed: number, first: number): void {
  const random = randomFrom(seed);
  const slot = w / BAYS;
  for (let i = 0; i < BAYS; i++) {
    const x0 = i * slot;
    const paint = Math.floor(random() * SIGN_PAINTS.length);
    c.fillStyle = SIGN_PAINTS[paint];
    c.fillRect(x0, 0, slot + 1, h);
    c.strokeStyle = 'rgba(200,190,160,0.25)';
    c.lineWidth = 2;
    c.strokeRect(x0 + slot * 0.12, h * 0.12, slot * 0.76, h * 0.76);
    c.fillStyle = paint === 2 ? 'rgba(30,24,18,0.85)' : 'rgba(222,212,184,0.78)';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const trade = TRADES[Math.floor(random() * TRADES.length)];
    let size = h * 0.5;
    c.font = `bold ${size}px "Arial Narrow", Arial, sans-serif`;
    const room = slot * 0.6;
    const wide = c.measureText(trade).width;
    if (wide > room) size *= room / wide;
    c.font = `bold ${size.toFixed(0)}px "Arial Narrow", Arial, sans-serif`;
    c.fillText(trade, x0 + slot * 0.47, h * 0.53);
    c.font = `bold ${(h * 0.26).toFixed(0)}px "Arial Narrow", Arial, sans-serif`;
    c.fillText(`No ${first + i}`, x0 + slot * 0.82, h * 0.55);
    for (let k = 0; k < 40; k++) {
      c.fillStyle = random() < 0.5 ? `rgba(0,0,0,${0.1 + random() * 0.3})` : `rgba(180,170,140,${0.05 + random() * 0.12})`;
      c.beginPath();
      c.ellipse(x0 + random() * slot, random() * h, 1 + random() * 9, 1 + random() * 4, random() * 3, 0, Math.PI * 2);
      c.fill();
    }
    const stain = c.createLinearGradient(0, 0, 0, h);
    stain.addColorStop(0, 'rgba(0,0,0,0.35)');
    stain.addColorStop(0.4, 'rgba(0,0,0,0)');
    stain.addColorStop(1, 'rgba(0,0,0,0.3)');
    c.fillStyle = stain;
    c.fillRect(x0, 0, slot, h);
  }
}

/** Corrugation: the slope of the slats as a normal map (one slat to each repeat of it). */
function drawSlats(c: CanvasRenderingContext2D, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    const slope = Math.cos((y / h) * Math.PI * 2) * 0.55;
    const n = 1 / Math.hypot(slope, 1);
    c.fillStyle = `rgb(128,${Math.round((slope * n * 0.5 + 0.5) * 255)},${Math.round((n * 0.5 + 0.5) * 255)})`;
    c.fillRect(0, y, w, 1);
  }
}

/** Pale skin for the arm, along its length: a little mottled, faint veins, the creases of a forearm. */
function drawSkin(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(19);
  c.fillStyle = '#c4b4aa';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = 6 + random() * 40;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, random() < 0.6 ? `rgba(150,108,100,${0.05 + random() * 0.09})` : `rgba(245,236,230,${0.04 + random() * 0.06})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 9; i++) {
    c.strokeStyle = `rgba(78,96,132,${0.08 + random() * 0.14})`;
    c.lineWidth = 1 + random() * 2.5;
    let y = random() * h;
    c.beginPath();
    c.moveTo(0, y);
    for (let x = 0; x <= w; x += 24) {
      y += (random() - 0.5) * 10;
      c.lineTo(x, y);
    }
    c.stroke();
  }
  for (let i = 0; i < 40; i++) {
    c.strokeStyle = `rgba(110,72,64,${0.04 + random() * 0.06})`;
    c.lineWidth = 1;
    const x = random() * w;
    c.beginPath();
    c.moveTo(x, random() * h * 0.3);
    c.lineTo(x + (random() - 0.5) * 8, h * (0.5 + random() * 0.5));
    c.stroke();
  }
}

/** The fine unevenness of skin, as a normal map: pores and the small folds across a forearm. */
function drawPores(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(23);
  c.fillStyle = 'rgb(128,128,255)';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    c.fillStyle = `rgb(${Math.round(128 + (random() - 0.5) * 40)},${Math.round(128 + (random() - 0.5) * 40)},250)`;
    c.fillRect(random() * w, random() * h, 1 + random() * 1.5, 1 + random() * 1.5);
  }
  for (let i = 0; i < 14; i++) {
    const x = random() * w;
    c.fillStyle = 'rgb(108,128,248)';
    c.fillRect(x, 0, 1, h);
    c.fillStyle = 'rgb(148,128,248)';
    c.fillRect(x + 1, 0, 1, h);
  }
}

/** A flat four-cornered piece (a, b, c, d in order round it, its face where they run counterclockwise), UVs in meters along a→b and a→d. */
function slab(corners: readonly [V3, V3, V3, V3]): BufferGeometry {
  const [a, b, , d] = corners.map((p) => new Vector3(...p));
  const u = b.distanceTo(a);
  const v = d.distanceTo(a);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(corners.flat(), 3));
  const uv = [0, 0, u, 0, u, v, 0, v];
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('uv1', new Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

/** The poses of a walk taken from a clip, and how far it carries a body. */
interface Gait {
  /** One foot ahead, passing, the other ahead, passing (s of the clip). */
  times: readonly [number, number, number, number];
  /** How far a body at life size walks in one cycle (m). */
  stride: number;
  /** Which way the body walks in the clip (rad from +Z toward +X). */
  facing: number;
}

/** Where in a walk clip the feet are planted and pass each other, read off the bones of a body walking it. */
function gaitOf(kit: DreamKit, spec: FigureSpec, library: AvatarKey): Gait {
  const clip = kit.assets.models.get(library)!.animations.find((a) => a.name === spec.clip)!;
  const probe = kit.figures.hero(spec);
  const hips = probe.bone('Bip01')!;
  const left = probe.bone('Bip01_L_Foot')!;
  const right = probe.bone('Bip01_R_Foot')!;
  const samples = 96;
  const step = clip.duration / samples;
  const lefts: Vector3[] = [];
  const rights: Vector3[] = [];
  const start = new Vector3();
  const end = new Vector3();
  probe.update(0);
  for (let i = 0; i < samples; i++) {
    probe.root.updateMatrixWorld(true);
    lefts.push(left.getWorldPosition(new Vector3()));
    rights.push(right.getWorldPosition(new Vector3()));
    if (i === 0) hips.getWorldPosition(start);
    if (i === samples - 1) hips.getWorldPosition(end);
    probe.update(step);
  }
  const travel = Math.hypot(end.x - start.x, end.z - start.z);
  const forward = travel > 0.2 ? new Vector3(end.x - start.x, 0, end.z - start.z).normalize() : new Vector3(0, 0, 1);
  const d = lefts.map((l, i) => v1.subVectors(l, rights[i]).dot(forward));
  let ahead = 0;
  let behind = 0;
  for (let i = 1; i < samples; i++) {
    if (d[i] > d[ahead]) ahead = i;
    if (d[i] < d[behind]) behind = i;
  }
  const middle = (d[ahead] + d[behind]) / 2;
  /** The first sample after `from` (going on round the clip) where the feet pass each other. */
  const passing = (from: number, to: number): number => {
    for (let k = 1; k < samples; k++) {
      const i = (from + k) % samples;
      if (i === to) break;
      if ((d[from] - middle) * (d[i] - middle) <= 0) return i;
    }
    return (from + Math.round(((to - from + samples) % samples) / 2)) % samples;
  };
  return {
    times: [ahead * step, passing(ahead, behind) * step, behind * step, passing(behind, ahead) * step],
    stride: d[ahead] - d[behind],
    facing: Math.atan2(forward.x, forward.z),
  };
}

/** The weight of each of the four poses at a point `u` of the step (as the shader below has it). */
function walkWeights(u: number): number[] {
  const f = (u - Math.floor(u)) * 4;
  const seg = Math.floor(f);
  const t = f - seg;
  const t2 = t * t;
  const t3 = t2 * t;
  const b0 = 0.5 * (-t3 + 2 * t2 - t);
  const b1 = 0.5 * (3 * t3 - 5 * t2 + 2);
  const b2 = 0.5 * (-3 * t3 + 4 * t2 + t);
  const b3 = 0.5 * (t3 - t2);
  for (let k = 0; k < 4; k++) {
    const j = (k - seg + 5) % 4;
    weights[k] = j === 0 ? b0 : j === 1 ? b1 : j === 2 ? b2 : b3;
  }
  return weights;
}

const WALK_PARS = /* glsl */ `
attribute vec3 aPose1;
attribute vec3 aPose2;
attribute vec3 aPose3;
attribute vec3 aNorm1;
attribute vec3 aNorm2;
attribute vec3 aNorm3;
attribute float aStep;
// a smooth closed curve through the four poses of the step (Catmull-Rom): the weight of each pose at this point of it
vec4 walkWeights(float u) {
  float f = fract(u) * 4.0;
  float seg = floor(f);
  float t = f - seg;
  float t2 = t * t;
  float t3 = t2 * t;
  vec4 b = 0.5 * vec4(-t3 + 2.0 * t2 - t, 3.0 * t3 - 5.0 * t2 + 2.0, -3.0 * t3 + 4.0 * t2 + t, t3 - t2);
  if (seg < 0.5) return vec4(b.y, b.z, b.w, b.x);
  if (seg < 1.5) return b;
  if (seg < 2.5) return vec4(b.w, b.x, b.y, b.z);
  return vec4(b.z, b.w, b.x, b.y);
}`;
const WALK_NORMAL = /* glsl */ `
vec4 walkNormalAt = walkWeights(aStep);
vec3 objectNormal = normalize(normal * walkNormalAt.x + aNorm1 * walkNormalAt.y + aNorm2 * walkNormalAt.z + aNorm3 * walkNormalAt.w);
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif`;
const WALK_POSITION = /* glsl */ `
vec4 walkAt = walkWeights(aStep);
vec3 transformed = position * walkAt.x + aPose1 * walkAt.y + aPose2 * walkAt.z + aPose3 * walkAt.w;
#ifdef USE_ALPHAHASH
  vPosition = vec3(position);
#endif`;

/** The clothes of a walking body: above `end` (life m) there is nothing, and below it they go dark. */
function walking(source: MeshStandardMaterial, end: number): MeshStandardMaterial {
  const m = source.clone();
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uBodyEnd = { value: end };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WALK_PARS}\nvarying float vBodyY;`)
      .replace('#include <beginnormal_vertex>', WALK_NORMAL)
      .replace('#include <begin_vertex>', `${WALK_POSITION}\nvBodyY = position.y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBodyEnd;\nvarying float vBodyY;')
      .replace('#include <clipping_planes_fragment>', 'if (vBodyY > uBodyEnd) discard;\n#include <clipping_planes_fragment>')
      .replace(
        '#include <opaque_fragment>',
        `outgoingLight *= 1.0 - smoothstep(uBodyEnd - ${BODY_DARK.toFixed(3)}, uBodyEnd - 0.03, vBodyY);\n#include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'lost-walk';
  return m;
}

/** Their shadows: the whole body, walking. */
function walkingDepth(): MeshDepthMaterial {
  const m = new MeshDepthMaterial();
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${WALK_PARS}`).replace('#include <begin_vertex>', WALK_POSITION);
  };
  m.customProgramCacheKey = () => 'lost-walk-depth';
  return m;
}

/**
 * People who really walk for the price of a draw: one body baked in four poses of a step, the poses blended in the
 * vertex shader by where each of them is in their own step. Their hair is left out; the head too, unless asked for.
 */
class Walkers {
  readonly root = new Group();
  /** The top of the head in each of the four poses (life m, in the body's own frame), when the head is kept. */
  readonly crowns: Vector3[] = [];
  private readonly meshes: InstancedMesh[] = [];
  private readonly step: InstancedBufferAttribute;

  constructor(kit: DreamKit, spec: FigureSpec, gait: Gait, count: number, depth: MeshDepthMaterial, head: boolean, end: number) {
    const keep = (m: InstancedMesh) => !/opacity/.test((m.material as Material).name) && (head || !/head/.test((m.material as Material).name));
    const poses = gait.times.map((time) => (kit.figures.crowd({ ...spec, time }, 1).root.children as InstancedMesh[]).filter(keep));
    this.step = new InstancedBufferAttribute(new Float32Array(count), 1);
    this.step.setUsage(DynamicDrawUsage);
    poses[0].forEach((part, p) => {
      const first = part.geometry;
      const g = new BufferGeometry();
      g.setIndex(first.getIndex()!.clone());
      g.setAttribute('position', first.getAttribute('position').clone());
      g.setAttribute('normal', first.getAttribute('normal').clone());
      g.setAttribute('uv', first.getAttribute('uv').clone());
      for (let k = 1; k < 4; k++) {
        g.setAttribute(`aPose${k}`, poses[k][p].geometry.getAttribute('position').clone());
        g.setAttribute(`aNorm${k}`, poses[k][p].geometry.getAttribute('normal').clone());
      }
      g.setAttribute('aStep', this.step);
      const mesh = new InstancedMesh(g, walking(part.material as MeshStandardMaterial, end), count);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = depth;
      this.meshes.push(mesh);
      this.root.add(mesh);
      if (/head/.test((part.material as Material).name)) {
        for (let k = 0; k < 4; k++) {
          const at = poses[k][p].geometry.getAttribute('position');
          let top = -Infinity;
          for (let i = 0; i < at.count; i++) top = Math.max(top, at.getY(i));
          const crown = new Vector3();
          let n = 0;
          for (let i = 0; i < at.count; i++) {
            if (at.getY(i) < top - 0.03) continue;
            crown.x += at.getX(i);
            crown.y += at.getY(i);
            crown.z += at.getZ(i);
            n++;
          }
          this.crowns.push(crown.multiplyScalar(1 / n));
        }
      }
    });
  }

  set(i: number, matrix: Matrix4, step: number): void {
    for (const m of this.meshes) m.setMatrixAt(i, matrix);
    this.step.setX(i, step);
  }

  /** How light one of them is dressed against the others (a multiplier of the cloth). */
  tone(i: number, value: number): void {
    for (const m of this.meshes) {
      m.setColorAt(i, toned.setScalar(value));
      m.instanceColor!.needsUpdate = true;
    }
  }

  commit(): void {
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
    this.step.needsUpdate = true;
  }
}

/** One of the crowd. */
interface Walker {
  x: number;
  z: number;
  phase: number;
  scale: number;
  heading: number;
  /** Walks in your way and steps aside, to this side. */
  lane: boolean;
  side: number;
  /** The half step it was in last frame (for its footfalls). */
  half: number;
}

/** A skinned body's material that shows only what its hand bones carry (`aHand`: the share of each vertex's weight that is the hand's). */
function handOnly(source: MeshStandardMaterial): MeshStandardMaterial {
  const m = source.clone();
  m.roughness = 0.62;
  m.color.setHex(HAND_TINT);
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aHand;\nvarying float vHand;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHand = aHand;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHand;')
      .replace('#include <clipping_planes_fragment>', `if (vHand < ${HAND_KEEP.toFixed(3)}) discard;\n#include <clipping_planes_fragment>`);
  };
  m.customProgramCacheKey = () => 'lost-hand';
  return m;
}

/** Long white hair from the crown, over the back of the head and down the back (life m, the crown at the origin, the face toward +Z). */
function hairDownTheBack(): BufferGeometry {
  const random = randomFrom(83);
  const positions: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  const segments = 14;
  const curve = new CatmullRomCurve3([new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()]);
  const p = new Vector3();
  let base = 0;
  for (let s = 0; s < HAIR_STRANDS; s++) {
    const a = (random() - 0.5) * 2.4;
    const side = Math.sin(a);
    const fall = HAIR_FALL[0] + random() * (HAIR_FALL[1] - HAIR_FALL[0]);
    const drift = (random() - 0.5) * 0.06;
    const width = HAIR_WIDTH[0] + random() * (HAIR_WIDTH[1] - HAIR_WIDTH[0]);
    const pts = curve.points;
    pts[0].set(side * 0.03, -0.005, -0.01);
    pts[1].set(side * 0.08, -0.05, -0.08 * Math.cos(a * 0.5));
    pts[2].set(side * 0.085, -0.16, -0.115);
    pts[3].set(side * 0.1 + drift * 0.5, -0.28 - fall * 0.35, -0.135);
    pts[4].set(side * 0.12 + drift, -0.26 - fall, -0.14 - fall * 0.05);
    curve.updateArcLengths();
    for (let i = 0; i <= segments; i++) {
      curve.getPoint(i / segments, p);
      const w = width * (1 - (i / segments) * 0.6);
      positions.push(p.x - w, p.y, p.z, p.x + w, p.y, p.z);
      normals.push(0, 0.2, -1, 0, 0.2, -1);
      if (i < segments) {
        const b = base + i * 2;
        index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    base += (segments + 1) * 2;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setIndex(index);
  return g;
}

/** A glow of light in the air: a bulb (a hot core in a soft halo) or a haze (the halo only). Each point has its size (m), strength and core. */
const GLOW_VERT = /* glsl */ `
attribute float aLevel;
attribute float aSize;
attribute float aCore;
uniform float uTime;
varying float vLevel;
varying float vCore;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // they breathe a little, slowly, each in its own time; far ones sink into the dark
  vLevel = aLevel * (0.9 + 0.1 * sin(uTime * 0.6 + aLevel * 37.0)) * exp(-0.03 * -mv.z);
  vCore = aCore;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * 900.0 / max(0.5, -mv.z), 2.0, 96.0);
}`;
const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vLevel;
varying float vCore;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 3.0) * 0.6 + smoothstep(0.22, 0.0, d) * 1.4 * vCore;
  gl_FragColor = vec4(uColor * a * vLevel, 1.0);
}`;

/**
 * A covered market at night, from the height of a child: a forest of legs and long dark coats walking slowly the
 * other way, out of a low warm light far down the hall. A woman's pale hand with a thin ring comes down between the
 * coats, takes yours and pulls you through them; when they are behind you the eye goes up the arm, and the arm goes
 * up and up into the dark and nobody is at the end of it. It lets go. The hall is empty, its shutters down, one bulb;
 * far away a woman with white hair walks off, and however you push she comes no nearer.
 */
export default class Lost extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: FOG_COLOR, density: FOG_FULL },
    env: 'evening',
    envIntensity: ENV_FULL,
    sky: 0,
    grade: { exposure: 1.15, saturation: 0.74, warmth: 0.03, tint: 0, flare: 0.003 },
  };
  film = { bloom: 0.85, bloomFrom: 0.7, grain: 0.45, flicker: 0.02, weave: REDUCED_MOTION ? 0 : 0.0004 };
  focus = 3;
  aperture = 2;
  drift = REDUCED_MOTION ? 0 : 0.6;
  fear = 0.3;

  private readonly crowd: Walkers;
  private readonly walkers: Walker[] = [];
  private readonly crowdSpeed: number;
  private readonly crowdGait: Gait;
  private readonly herGait: Gait;

  private readonly rig = new Group();
  private readonly hangTurn = new Quaternion();
  private readonly armUp = new Vector3();
  private readonly fingers: { bone: Bone; rest: Quaternion; curl: number }[] = [];
  private readonly handLight: DreamLight;
  private readonly heldAt = new Vector3();
  private readonly hangAt = new Vector3();

  private readonly her: Walkers;
  private readonly herHair: Mesh;
  private readonly herStart: number;
  private herHalf = Number.NaN;

  private readonly full = new Group();
  private readonly shutters = new Group();
  private readonly strings = new Group();
  private readonly stringLights: DreamLight[] = [];
  private readonly bounce: DreamLight;
  private readonly bulb = new Group();
  private readonly bulbLight: DreamLight;
  private readonly night: MeshStandardMaterial;
  private readonly crowdSpots: readonly (SpotSpec | null)[];
  private readonly bulbSpots: readonly (SpotSpec | null)[];
  private readonly dust: { value: number }[] = [];
  private readonly glowTime = { value: 0 };
  private readonly glow = new ShaderMaterial({
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    uniforms: { uTime: this.glowTime, uColor: { value: new Color(0xffb26a) } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  private readonly eye: RoomPose = { position: new Vector3(), yaw: 0, pitch: 0, roll: 0, fov: 50 };
  private push = 0;
  private frames = 0;
  private stepAt = -1;
  private stepNext = 0;
  private readonly hushed: RoomVoice[] = [];
  private readonly later: RoomVoice[] = [];

  constructor(ctx: RoomContext) {
    super(ctx);
    const kit = this.kit;
    const root = this.root;
    this.keys = EYE_PATH.map(([s, x, z, yaw, pitch, fov]) => ({ t: s / this.seconds, at: [x, EYE_Y, z] as const, yaw, pitch, fov }));

    this.buildHall();
    this.buildStalls();
    this.buildRoof();

    // the light: low and far, the way the crowd comes; the bulbs up in the dark; one bulb, later
    const key = this.spot(KEY_AT, KEY_TARGET, KEY_COLOR, KEY_POWER, KEY_ANGLE, 0.85);
    this.crowdSpots = [key, null, null];
    const pool = this.spot(BULB_AT, [BULB_AT[0], 0, BULB_AT[2]], 0xffc98a, BULB_POOL, BULB_ANGLE, 1);
    this.bulbSpots = [pool, null, null];
    this.spots = this.crowdSpots;
    const [hazeWide, hazeGlows, hazeSize, hazeLevel] = HAZE;
    const haze: number[] = [];
    for (let i = 0; i < hazeGlows; i++) haze.push(KEY_AT[0] - hazeWide / 2 + (hazeWide * i) / (hazeGlows - 1), KEY_AT[1] - 0.35, KEY_AT[2] + 0.5);
    this.glowPoints(haze, hazeSize, hazeLevel, 0, this.full);
    this.bounce = this.light([0, BOUNCE_Y, -BOUNCE_AHEAD], 0xffc493, BOUNCE, BOUNCE_REACH);
    this.buildStrings();
    this.bulbLight = this.light(BULB_AT, 0xffc98a, 0, BULB_REACH);
    this.buildBulb();
    this.night = this.buildGate();

    // the crowd, and the one who walks away at the end: bodies that really walk
    const man: FigureSpec = { avatar: 'figure_man', clip: 'm_walk_bruised', face: 'blank', tint: COAT, bleach: COAT_BLEACH };
    const woman: FigureSpec = { avatar: 'figure_woman', clip: 'f_walk_injured', face: 'blank', tint: HER_COAT, bleach: COAT_BLEACH };
    this.crowdGait = gaitOf(kit, man, 'figure_man');
    this.herGait = gaitOf(kit, woman, 'figure_nurse');
    const lifeScale = (CROWD_SCALE[0] + CROWD_SCALE[1]) / 2;
    this.crowdSpeed = (this.crowdGait.stride * lifeScale) / GAIT_CYCLE;
    this.placeCrowd();
    const depth = walkingDepth();
    this.crowd = new Walkers(kit, man, this.crowdGait, this.walkers.length, depth, false, BODY_END);
    const tones = randomFrom(13);
    for (let i = 0; i < this.walkers.length; i++) this.crowd.tone(i, COAT_TONE[0] + tones() * (COAT_TONE[1] - COAT_TONE[0]));
    this.full.add(this.crowd.root);
    this.her = new Walkers(kit, woman, this.herGait, 1, depth, true, 99);
    this.her.tone(0, 1);
    this.herHair = new Mesh(hairDownTheBack(), new MeshStandardMaterial({ color: 0xdcd8d0, roughness: 0.5 }));
    this.herHair.scale.setScalar(HER_SCALE);
    this.herHair.rotation.y = Math.PI;
    this.herHair.frustumCulled = false;
    this.herHair.castShadow = true;
    root.add(this.her.root, this.herHair);
    const start = super.pose(EMPTY_AT / this.seconds, { position: new Vector3(), yaw: 0, pitch: 0, roll: 0, fov: 50 });
    this.herStart = start.position.z - this.origin.z - HER_GAP;
    root.add(this.full);

    // her hand, and the arm it is on
    this.handLight = this.light([0, 0, 0], 0xffe6d2, 0, HAND_REACH);
    this.buildHand();

    // dust in the air of the crowd, and round the one bulb
    this.dust.push(this.build.motes(420, { x: [-5, 5], y: [0.15, 3], z: [-34, 4] }, this.full, { size: 0.006, color: 0xffd6a8, strength: 0.22 }).time);
    const bulbDust = this.build.motes(160, { x: [BULB_AT[0] - 3, BULB_AT[0] + 3], y: [0.2, 4.6], z: [BULB_AT[2] - 3, BULB_AT[2] + 3] }, this.bulb, { size: 0.008, color: 0xffe2bc, strength: 0.5, seed: 7 });
    this.dust.push(bulbDust.time);

    this.listen();
  }

  /** The floor, the walls you came in by and go out by. */
  private buildHall(): void {
    const kit = this.kit;
    const b = this.build;
    const root = this.root;
    const halfAll = HALF_W + STALL_DEEP;
    const long = BACK_Z - FAR_Z;
    const mid = (BACK_Z + FAR_Z) / 2;
    root.add(kit.floor(-halfAll, halfAll, FAR_Z, BACK_Z, 0, kit.surface('wood_floor_dark', 2, { color: new Color(0x5a4a3c) })));

    // sawdust over the boards: one square repeating, its thickness over the whole hall from one picture
    const sawdust = canvasOf(1024, 1024, (c, s) => drawSawdust(c, s));
    sawdust.wrapS = sawdust.wrapT = RepeatWrapping;
    sawdust.repeat.setScalar(1 / SAWDUST_TILE);
    const drifts = canvasOf(128, 1024, drawDrifts, true);
    drifts.channel = 1;
    const ground = new PlaneGeometry(2 * halfAll, long).rotateX(-Math.PI / 2);
    const p = ground.getAttribute('position');
    const meters = new Float32Array(p.count * 2);
    const whole = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      meters[i * 2] = p.getX(i);
      meters[i * 2 + 1] = p.getZ(i) + mid;
      whole[i * 2] = (p.getX(i) + halfAll) / (2 * halfAll);
      whole[i * 2 + 1] = (p.getZ(i) + long / 2) / long;
    }
    ground.setAttribute('uv', new Float32BufferAttribute(meters, 2));
    ground.setAttribute('uv1', new Float32BufferAttribute(whole, 2));
    const dusted = new Mesh(ground, new MeshStandardMaterial({ map: sawdust, alphaMap: drifts, transparent: true, depthWrite: false, roughness: 1, color: 0xc9b69a }));
    dusted.position.set(0, 0.003, mid);
    dusted.receiveShadow = true;
    dusted.renderOrder = 1;
    root.add(dusted);

    // the walls high over the stalls, and the gables
    const plaster = kit.surface('plaster_mould', 1.8, { color: new Color(0x6e685c) });
    for (const side of [-1, 1] as const) b.wall(side * HALF_W, mid, long, EAVES - STALL_H - SIGN_H, side > 0 ? '-x' : '+x', plaster, root, STALL_H + SIGN_H);
    b.wall(0, BACK_Z, 2 * halfAll, STALL_H, '-z', plaster, root);
    b.wall(0, BACK_Z, 2 * HALF_W, EAVES - STALL_H, '-z', plaster, root, STALL_H);
    const gateL = -GATE_W / 2;
    const gateR = GATE_W / 2;
    b.wall((-halfAll + gateL) / 2, FAR_Z, gateL + halfAll, STALL_H, '+z', plaster, root);
    b.wall((gateR + halfAll) / 2, FAR_Z, halfAll - gateR, STALL_H, '+z', plaster, root);
    b.wall((-HALF_W + gateL) / 2, FAR_Z, gateL + HALF_W, EAVES - STALL_H, '+z', plaster, root, STALL_H);
    b.wall((gateR + HALF_W) / 2, FAR_Z, HALF_W - gateR, EAVES - STALL_H, '+z', plaster, root, STALL_H);
    b.wall(0, FAR_Z, GATE_W, EAVES - GATE_H, '+z', plaster, root, GATE_H);
    // each gable wound to face into the hall
    for (const [z, x] of [[BACK_Z, HALF_W], [FAR_Z, -HALF_W]] as const) {
      const gable = new Mesh(slab([[x, EAVES, z], [-x, EAVES, z], [0, RIDGE, z], [0, RIDGE, z]]), plaster);
      gable.receiveShadow = true;
      gable.frustumCulled = false;
      root.add(gable);
    }

    // the doors you came in by: shut
    const doors: BufferGeometry[] = [];
    for (const side of [-1, 1]) doors.push(meterUVs(new BoxGeometry(DOORS_W / 2 - 0.03, DOORS_H, 0.08)).translate((side * DOORS_W) / 4, DOORS_H / 2, BACK_Z - 0.05));
    doors.push(meterUVs(new BoxGeometry(DOORS_W + 0.5, 0.25, 0.16)).translate(0, DOORS_H + 0.12, BACK_Z - 0.08));
    for (const side of [-1, 1]) doors.push(meterUVs(new BoxGeometry(0.25, DOORS_H, 0.16)).translate(side * (DOORS_W / 2 + 0.12), DOORS_H / 2, BACK_Z - 0.08));
    const doorMesh = new Mesh(mergeGeometries(doors)!, kit.surface('wood_dark_paint', 1.6, { color: new Color(0x6a5a4c) }));
    doorMesh.receiveShadow = true;
    doorMesh.frustumCulled = false;
    root.add(doorMesh);
  }

  /** Glows in the air (positions in the room's frame, three to a point), all alike, drawn at once. */
  private glowPoints(at: readonly number[], size: number, level: number, core: number, parent: Group): void {
    const n = at.length / 3;
    const random = randomFrom(n);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(at, 3));
    g.setAttribute('aLevel', new Float32BufferAttribute(Array.from({ length: n }, () => level * (0.55 + random() * 0.45)), 1));
    g.setAttribute('aSize', new Float32BufferAttribute(new Array<number>(n).fill(size), 1));
    g.setAttribute('aCore', new Float32BufferAttribute(new Array<number>(n).fill(core), 1));
    const points = new Points(g, this.glow);
    points.frustumCulled = false;
    points.renderOrder = 3;
    parent.add(points);
  }

  /** The gate in the far wall, and the night in it. */
  private buildGate(): MeshStandardMaterial {
    const frame: BufferGeometry[] = [];
    for (const side of [-1, 1]) frame.push(new BoxGeometry(0.3, GATE_H, 0.5).translate(side * (GATE_W / 2 + 0.15), GATE_H / 2, FAR_Z - 0.1));
    frame.push(new BoxGeometry(GATE_W + 0.6, 0.35, 0.5).translate(0, GATE_H + 0.17, FAR_Z - 0.1));
    const iron = new Mesh(mergeGeometries(frame)!, new MeshStandardMaterial({ color: 0x15130f, roughness: 0.6, metalness: 0.4 }));
    iron.frustumCulled = false;
    this.root.add(iron);
    const night = new MeshStandardMaterial({ color: 0x000000, emissive: new Color(NIGHT), roughness: 1 });
    const beyond = new Mesh(new PlaneGeometry(GATE_W + 0.4, GATE_H + 0.3), night);
    beyond.position.set(0, (GATE_H + 0.3) / 2, FAR_Z - 0.4);
    beyond.frustumCulled = false;
    this.root.add(beyond);
    return night;
  }

  /** The stalls down both sides: piers, counters, crates left behind, their sign boards, and the shutters that come down. */
  private buildStalls(): void {
    const kit = this.kit;
    const b = this.build;
    const root = this.root;
    const long = BACK_Z - FAR_Z;
    const mid = (BACK_Z + FAR_Z) / 2;
    const piers: BufferGeometry[] = [];
    const walls: BufferGeometry[] = [];
    const counters: BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      for (let k = 0; k <= BAYS; k++) {
        const z = BACK_Z - k * BAY;
        piers.push(meterUVs(new BoxGeometry(PIER_W, EAVES, PIER_D).translate(side * HALF_W, EAVES / 2, z)));
        walls.push(meterUVs(new BoxGeometry(STALL_DEEP, STALL_H, 0.12).translate(side * (HALF_W + STALL_DEEP / 2), STALL_H / 2, z)));
        if (k < BAYS) counters.push(meterUVs(new BoxGeometry(COUNTER_D, COUNTER_H, BAY - PIER_D - 0.5).translate(side * (HALF_W + 0.1 + COUNTER_D / 2), COUNTER_H / 2, z - BAY / 2)));
      }
    }
    const solid = (parts: BufferGeometry[], material: Material) => {
      const m = new Mesh(mergeGeometries(parts)!, material);
      m.receiveShadow = true;
      m.castShadow = true;
      m.frustumCulled = false;
      root.add(m);
    };
    solid(piers, kit.surface('plaster_damaged', 1.85, { color: new Color(0x8a7c6c) }));
    const inside = kit.surface('conc_stained', 2, { color: new Color(0x4a443c) });
    solid(walls, inside);
    solid(counters, kit.surface('wood_raw_boards', 1.4, { color: new Color(0x5e4c3a) }));
    for (const side of [-1, 1] as const) {
      b.wall(side * (HALF_W + STALL_DEEP), mid, long, STALL_H, side > 0 ? '-x' : '+x', inside, root);
      const lid = kit.floor(side > 0 ? HALF_W : -HALF_W - STALL_DEEP, side > 0 ? HALF_W + STALL_DEEP : -HALF_W, FAR_Z, BACK_Z, STALL_H, inside);
      lid.rotation.x = Math.PI / 2;
      root.add(lid);
    }

    // sign boards of planks, one long board a side, and the shutters (down once the market is empty)
    const slats = canvasOf(8, 64, drawSlats, true);
    slats.wrapS = slats.wrapT = RepeatWrapping;
    slats.repeat.set(1, STALL_H / 0.075);
    const planks = slats.clone();
    planks.repeat.set(1, SIGN_H / 0.15);
    for (const side of [-1, 1] as const) {
      const first = side > 0 ? 1 : BAYS + 1;
      const signs = canvasOf(4096, 128, (c, w, h) => drawSigns(c, w, h, side > 0 ? 3 : 4, first));
      const board = new Mesh(new PlaneGeometry(long, SIGN_H), new MeshStandardMaterial({ map: signs, normalMap: planks, roughness: 0.8 }));
      board.position.set(side * (HALF_W - 0.03), STALL_H + SIGN_H / 2, mid);
      board.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      board.receiveShadow = true;
      board.frustumCulled = false;
      root.add(board);
      const paint = canvasOf(4096, 256, (c, w, h) => drawShutters(c, w, h, side > 0 ? 11 : 12, first));
      const shutter = new Mesh(new PlaneGeometry(long, STALL_H), new MeshStandardMaterial({ map: paint, normalMap: slats, roughness: 0.55, metalness: 0.3 }));
      shutter.position.set(side * (HALF_W - 0.02), STALL_H / 2, mid);
      shutter.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      shutter.receiveShadow = true;
      shutter.frustumCulled = false;
      this.shutters.add(shutter);
    }
    root.add(this.shutters);
  }

  /** The roof far up: boards, iron trusses over every pier. */
  private buildRoof(): void {
    const boards = this.kit.surface('wood_dark_paint', 1.6, { color: new Color(0x8a7a68) });
    // each slope wound to face down into the hall
    for (const side of [-1, 1]) {
      const [near, far] = side < 0 ? [BACK_Z, FAR_Z] : [FAR_Z, BACK_Z];
      const roof = new Mesh(slab([[side * HALF_W, EAVES, near], [side * HALF_W, EAVES, far], [0, RIDGE, far], [0, RIDGE, near]]), boards);
      roof.receiveShadow = true;
      roof.frustumCulled = false;
      this.root.add(roof);
    }
    const truss: BufferGeometry[] = [];
    const slope = Math.atan2(RIDGE - EAVES, HALF_W);
    const rafter = Math.hypot(RIDGE - EAVES, HALF_W);
    truss.push(new BoxGeometry(2 * HALF_W, 0.16, 0.12).translate(0, EAVES - 0.15, 0));
    truss.push(new BoxGeometry(0.12, RIDGE - EAVES, 0.12).translate(0, (RIDGE + EAVES) / 2 - 0.15, 0));
    for (const side of [-1, 1]) {
      truss.push(new BoxGeometry(rafter, 0.2, 0.14).rotateZ(-side * slope).translate((side * HALF_W) / 2, (EAVES + RIDGE) / 2 - 0.12, 0));
      const strut = Math.hypot(HALF_W / 2, (RIDGE - EAVES) / 2);
      truss.push(new BoxGeometry(strut, 0.1, 0.1).rotateZ(side * Math.atan2((RIDGE - EAVES) / 2, HALF_W / 2)).translate((side * HALF_W) / 4 + side * 0.4, EAVES + (RIDGE - EAVES) / 4 - 0.1, 0));
    }
    const one = mergeGeometries(truss)!;
    const all: BufferGeometry[] = [];
    for (let k = 0; k <= BAYS; k++) all.push(one.clone().translate(0, 0, BACK_Z - k * BAY));
    const iron = new Mesh(mergeGeometries(all)!, new MeshStandardMaterial({ color: 0x2a2520, roughness: 0.7, metalness: 0.25 }));
    iron.castShadow = true;
    iron.receiveShadow = true;
    iron.frustumCulled = false;
    this.root.add(iron);
  }

  /** Strings of weak bulbs slung across the hall from truss to truss, and their little light. */
  private buildStrings(): void {
    const at: number[] = [];
    const cables: BufferGeometry[] = [];
    const sag = (x: number) => STRING_TOP - STRING_SAG * (1 - (x / HALF_W) ** 2);
    for (let k = 1; k <= BAYS; k += STRING_EVERY) {
      const z = BACK_Z - k * BAY;
      const wire: Vector3[] = [];
      for (let j = 0; j <= 16; j++) {
        const x = -HALF_W + (2 * HALF_W * j) / 16;
        wire.push(new Vector3(x, sag(x), z));
      }
      cables.push(new TubeGeometry(new CatmullRomCurve3(wire), 32, 0.006, 4));
      for (let j = 1; j <= STRING_BULBS; j++) {
        const x = -HALF_W + (2 * HALF_W * j) / (STRING_BULBS + 1);
        at.push(x, sag(x) - 0.06, z);
      }
      this.stringLights.push(this.light([STRING_LIGHT_X, sag(STRING_LIGHT_X) - 0.15, z], 0xffb877, STRING_POWER, STRING_REACH));
    }
    const cable = new Mesh(mergeGeometries(cables)!, new MeshStandardMaterial({ color: 0x0c0b0a, roughness: 0.7 }));
    cable.frustumCulled = false;
    this.root.add(cable);
    this.glowPoints(at, BULB_SPRITE, BULB_SHINE, 1, this.strings);
    this.root.add(this.strings);
  }

  /** The one bulb of the empty hall, on its flex from the dark. */
  private buildBulb(): void {
    const [x, y, z] = BULB_AT;
    const dark = new MeshStandardMaterial({ color: 0x0d0c0b, roughness: 0.6 });
    const flex = new Mesh(new CylinderGeometry(0.005, 0.005, EAVES - y, 4).translate(x, (EAVES + y) / 2 + 0.08, z), dark);
    const socket = new Mesh(new CylinderGeometry(0.022, 0.026, 0.08, 12).translate(x, y + 0.08, z), dark);
    const glass = new Mesh(new SphereGeometry(0.04, 14, 10).translate(x, y, z), new MeshStandardMaterial({ color: 0x000000, emissive: new Color(0xfff0d6), emissiveIntensity: 2 }));
    for (const m of [flex, socket, glass]) {
      m.frustumCulled = false;
      this.bulb.add(m);
    }
    this.glowPoints([x, y, z], BULB_HALO[0], BULB_HALO[1], 1, this.bulb);
    this.root.add(this.bulb);
  }

  /** Her hand from a body that is not there, the ring on it, and the arm that goes up from it. */
  private buildHand(): void {
    const hero = this.kit.figures.hero({ avatar: 'figure_woman', clip: 'f_idle_touch_hair_01', face: 'blank', bleach: 0.92 });
    hero.update(0);
    hero.root.scale.setScalar(HAND_SCALE);
    this.rig.add(hero.root);
    this.rig.updateMatrixWorld(true);
    const bone = (name: string) => hero.bone(`Bip01_L_${name}`)!;
    const hand = bone('Hand');
    const fore = bone('Forearm');

    // keep only what the hand's bones carry
    hero.root.traverse((o) => {
      const mesh = o as SkinnedMesh;
      if (!mesh.isMesh) return;
      if (!mesh.isSkinnedMesh) {
        mesh.visible = false;
        return;
      }
      const ofHand = new Set<number>();
      mesh.skeleton.bones.forEach((b, i) => {
        if (/^Bip01_L_(Hand|Finger)/.test(b.name)) ofHand.add(i);
      });
      const geometry = mesh.geometry.clone();
      const index = geometry.getAttribute('skinIndex');
      const weight = geometry.getAttribute('skinWeight');
      const share = new Float32Array(index.count);
      let kept = 0;
      for (let i = 0; i < index.count; i++) {
        const w = (ofHand.has(index.getX(i)) ? weight.getX(i) : 0) + (ofHand.has(index.getY(i)) ? weight.getY(i) : 0) + (ofHand.has(index.getZ(i)) ? weight.getZ(i) : 0) + (ofHand.has(index.getW(i)) ? weight.getW(i) : 0);
        share[i] = w;
        if (w >= HAND_KEEP) kept++;
      }
      if (kept === 0) {
        mesh.visible = false;
        return;
      }
      geometry.setAttribute('aHand', new Float32BufferAttribute(share, 1));
      mesh.geometry = geometry;
      mesh.material = handOnly(mesh.material as MeshStandardMaterial);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
    });

    // turn the hand as it holds you: the fingers on down the arm, the palm to the right
    const toward = (a: V3, b: V3) => new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    const fingersHeld = toward(ARM[1], ARM[0]);
    const palmHeld = new Vector3(...HELD_PALM).addScaledVector(fingersHeld, -new Vector3(...HELD_PALM).dot(fingersHeld)).normalize();
    const local = (b: Bone) => hand.worldToLocal(b.getWorldPosition(new Vector3()));
    const fingersL = local(bone('Finger2')).normalize();
    const acrossL = local(bone('Finger1')).sub(local(bone('Finger4'))).normalize();
    const palmL = new Vector3().crossVectors(fingersL, acrossL).normalize();
    acrossL.crossVectors(palmL, fingersL);
    const basis = (f: Vector3, p: Vector3) => new Matrix4().makeBasis(f, p, new Vector3().crossVectors(p, f));
    const handWorld = new Quaternion().setFromRotationMatrix(basis(fingersHeld, palmHeld).multiply(basis(fingersL, palmL).transpose()));
    const foreWorld = handWorld.clone().multiply(hand.quaternion.clone().invert());
    fore.quaternion.copy(fore.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(foreWorld));
    this.rig.updateMatrixWorld(true);
    hero.root.position.sub(hand.getWorldPosition(new Vector3()));
    this.rig.updateMatrixWorld(true);

    // the same hand hanging: fingers down a little toward you, the palm to you
    const fingersHang = new Vector3(...HANG_FINGERS).normalize();
    const palmHang = new Vector3(...HANG_PALM).normalize();
    this.hangTurn.setFromRotationMatrix(basis(fingersHang, palmHang).multiply(basis(fingersHeld, palmHeld).transpose()));

    // the fingers, and the ring on the fourth
    for (let f = 0; f < 5; f++) {
      for (let j = 0; j < 3; j++) {
        const b = hero.bone(`Bip01_L_Finger${f}${j === 0 ? '' : j}`);
        if (b) this.fingers.push({ bone: b, rest: b.quaternion.clone(), curl: (f === 0 ? THUMB_CURL : CURL)[j] });
      }
    }
    const ringBone = bone('Finger3');
    const unit = ringBone.getWorldScale(new Vector3()).x / HAND_SCALE;
    const along = bone('Finger31').position.clone().normalize();
    const ring = new Mesh(new TorusGeometry(RING_R, RING_TUBE, 8, 32), new MeshStandardMaterial({ color: 0xd8b56e, metalness: 0.85, roughness: 0.28, emissive: new Color(0x2a1d08) }));
    ring.quaternion.setFromUnitVectors(AXIS_Z, along);
    ring.position.copy(along).multiplyScalar(RING_ALONG / unit);
    ring.scale.setScalar(1 / unit);
    ringBone.add(ring);

    // the arm: pale skin from the wrist up, a little thicker as it goes, far too long
    const wrist = new Vector3(...ARM[0]);
    const points = ARM.map((p) => new Vector3(...p).sub(wrist));
    points[0].addScaledVector(fingersHeld, ARM_INTO_HAND);
    const curve = new CatmullRomCurve3(points);
    const length = curve.getLength();
    const tube = new TubeGeometry(curve, 160, 1, 14, false);
    const pos = tube.getAttribute('position');
    const uv = tube.getAttribute('uv');
    const center = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      const t = uv.getX(i);
      curve.getPointAt(t, center);
      v1.fromBufferAttribute(pos, i).sub(center).multiplyScalar(ARM_RADIUS * (1 + (ARM_SWELL - 1) * t)).add(center);
      pos.setXYZ(i, v1.x, v1.y, v1.z);
      uv.setX(i, (t * length) / SKIN_TILE);
    }
    tube.computeVertexNormals();
    const skinMap = canvasOf(512, 128, drawSkin);
    skinMap.wrapS = skinMap.wrapT = RepeatWrapping;
    const pores = canvasOf(128, 64, drawPores, true);
    pores.wrapS = pores.wrapT = RepeatWrapping;
    const skin = new MeshStandardMaterial({ map: skinMap, normalMap: pores, roughness: 0.58, color: ARM_TINT });
    const arm = new Mesh(tube, skin);
    const end = new Mesh(new SphereGeometry(ARM_RADIUS * ARM_SWELL, 14, 10), skin);
    end.position.copy(points[points.length - 1]);
    for (const m of [arm, end]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.rig.add(m);
    }
    this.armUp.copy(points[1]).sub(points[0]).normalize();
    this.rig.visible = false;
    this.root.add(this.rig);
  }

  /** Where each of the crowd walks: in bands either side of your way, a few in it who step aside for you. */
  private placeCrowd(): void {
    const random = randomFrom(47);
    const pose: RoomPose = { position: new Vector3(), yaw: 0, pitch: 0, roll: 0, fov: 50 };
    const add = (x: number, z: number, lane: boolean) =>
      this.walkers.push({
        x,
        z,
        phase: random(),
        scale: CROWD_SCALE[0] + random() * (CROWD_SCALE[1] - CROWD_SCALE[0]),
        heading: (random() - 0.5) * 0.12,
        lane,
        side: x < 0 ? -1 : 1,
        half: Number.NaN,
      });
    const inTheWay: [number, number][] = IN_THE_WAY.map((met, i) => {
      super.pose(met / this.seconds, pose);
      return [(i % 2 === 0 ? -1 : 1) * (0.15 + random() * 0.4), pose.position.z - this.origin.z - this.crowdSpeed * met];
    });
    for (const [from, to, spacing] of BANDS) {
      for (const side of [-1, 1]) {
        let z = CROWD_FROM - random() * spacing;
        while (z > CROWD_TO) {
          const x = side * (from + random() * (to - from));
          // room for those who step aside into the inner band
          const crowded = from === BANDS[0][0] && inTheWay.some(([lx, lz]) => Math.sign(lx) === side && Math.abs(lz - z) < 1.3);
          if (!crowded) add(x, z, false);
          z -= spacing * (0.7 + random() * 0.6);
        }
      }
    }
    for (const [x, z] of inTheWay) add(x, z, true);
  }

  private listen(): void {
    const sound = this.sound;
    this.beat(0, () => {
      this.hushed.push(sound.bed('rooms/hall_vast.mp3', { gain: 0.16, fade: 1.2 }));
      this.hushed.push(sound.bed('rooms/dream_drone_low.mp3', { gain: 0.08, fade: 2 }));
      this.hushed.push(sound.play('rooms/crowd_rise.mp3', { gain: 0.13, rate: 0.85, reverb: 0.4, lowpass: 1500 }));
    });
    this.beat(6.2, () => this.hushed.push(sound.play('rooms/crowd_rise.mp3', { gain: 0.12, rate: 0.8, reverb: 0.45, lowpass: 1400, offset: 0.6 })));
    this.beat(8.2, () => this.later.push(sound.bed('rooms/dream_drone_glass.mp3', { gain: 0.03, fade: 2.5 })));
    this.beat(GRAB_AT + 0.05, () => sound.play('rooms/coat_move.mp3', { gain: 0.3, pan: -0.35, duration: 1, reverb: 0.1 }));
    this.beat(HELD_AT - 0.1, () => {
      this.hushed.push(sound.bed('rooms/run_feet.mp3', { gain: 0.24, rate: 1.12, lowpass: 3800, reverb: 0.15 }));
      this.hushed.push(sound.play('rooms/crowd_rise.mp3', { gain: 0.12, rate: 0.9, reverb: 0.4, lowpass: 1600, offset: 1 }));
    });
    this.beat(12.6, () => this.hushed.push(sound.play('rooms/door_pass_2.mp3', { gain: 0.16, pan: -0.7, lowpass: 2000 })));
    this.beat(13.7, () => this.hushed.push(sound.play('rooms/door_pass_1.mp3', { gain: 0.14, pan: 0.65, lowpass: 1800, duration: 2.4 })));
    this.beat(14.8, () => this.hushed.push(sound.play('rooms/door_pass_2.mp3', { gain: 0.15, pan: -0.5, rate: 1.1, lowpass: 2000 })));
    // the crowd is behind you: nothing at all, and then the height
    this.beat(SILENCE_AT, () => {
      for (const v of this.hushed) v.gain(0, 0.15);
    });
    this.beat(16.6, () => {
      this.later.push(sound.bed('rooms/dream_drone_hollow.mp3', { gain: 0.11, fade: 2.5 }));
      this.later.push(sound.bed('rooms/bulb_hum.mp3', { gain: 0.035, fade: 2 }));
    });
    this.beat(LET_GO, () => sound.play('rooms/coat_move.mp3', { gain: 0.16, offset: 1.2, duration: 0.7, reverb: 0.45, pan: -0.25 }));
    this.beat(20.35, () => sound.play('rooms/belt_slither_1.mp3', { gain: 0.13, rate: 0.75, reverb: 0.55, lowpass: 2400 }));
    this.beat(20.9, () => {
      for (const v of this.later) v.gain(0.04, 3);
      sound.bed('rooms/hall_vast.mp3', { gain: 0.2, fade: 2 });
    });
    this.beat(SHUTTER_AT, () => this.shutter(false));
    this.beat(LINE_AT, () => this.say({ tr: 'O gün annen seni buldu. Sen onu hiç aramadın.', en: 'That day your mother found you. You never went looking for her.' }, 3.6));
    this.beat(CUT_AT, () => this.sound.stopAll(0.04));
  }

  /** The eye leans into the crowd as hard as the viewer pushes. */
  override pose(t: number, out: RoomPose): RoomPose {
    super.pose(t, out);
    const lean = this.push * PUSH_LEAN;
    out.position.x -= Math.sin(out.yaw) * lean;
    out.position.z -= Math.cos(out.yaw) * lean;
    out.pitch -= this.push * PUSH_DIP * (Math.PI / 180);
    return out;
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const dt = frame.paused ? 0 : frame.dt;
    const locked = s >= LOCK[0] && s <= LOCK[1];
    this.control.scroll = !locked;
    this.control.hurry = 1.6;
    this.push = damp(this.push, locked ? 0 : frame.input.legs, PUSH_RATE, dt);
    this.pose(frame.t, this.eye);
    const o = this.origin;
    const ex = this.eye.position.x - o.x;
    const ez = this.eye.position.z - o.z;
    const empty = s >= EMPTY_AT;

    // the market full, or empty
    this.full.visible = !empty;
    this.shutters.visible = empty;
    this.bulb.visible = empty;
    this.spots = empty ? this.bulbSpots : this.crowdSpots;
    this.bulbLight.intensity = empty ? BULB_POWER : 0;
    this.night.emissiveIntensity = empty ? 1 : NIGHT_FULL;
    const bulbsOn = s < BULBS_OUT;
    this.strings.visible = bulbsOn;
    for (const l of this.stringLights) l.intensity = bulbsOn ? STRING_POWER : 0;
    const emptiness = smootherstep(range(EMPTY_AT, LET_GO, s));
    this.air.fog.density = lerp(FOG_FULL, FOG_EMPTY, emptiness);
    this.air.envIntensity = lerp(ENV_FULL, ENV_EMPTY, emptiness);
    this.movingShadows = (this.frames++ & 1) === 0;
    this.glowTime.value = frame.time;
    for (const d of this.dust) d.value = frame.time;
    this.bounce.position.set(ex - Math.sin(this.eye.yaw) * BOUNCE_AHEAD, BOUNCE_Y, ez - Math.cos(this.eye.yaw) * BOUNCE_AHEAD).add(o);
    this.bounce.intensity = BOUNCE * (1 - smootherstep(range(STOP_AT, EMPTY_AT, s)));

    if (!empty) this.walkCrowd(s, ex, ez, frame);
    const hand = this.holdHand(s, ex, ez);
    this.walkHer(s, ez, empty, frame);

    // the lens, the fear, the cut
    if (hand > 0) {
      this.focus = clamp(hand, 0.5, 12);
      this.aperture = s < STOP_AT ? 2.4 : 1.4;
    } else {
      this.focus = empty ? HER_GAP : 6;
      this.aperture = empty ? 1.6 : 2.2;
    }
    this.fear = s < HAND_FROM ? 0.3 : s < HELD_AT ? 0.45 : s < STOP_AT ? 0.6 : s < LET_GO ? 0.75 : 0.45;
    this.black = s >= CUT_AT ? 1 : 0;
  }

  /** The crowd walking the other way, parting round you; the footfalls of the nearest. */
  private walkCrowd(s: number, ex: number, ez: number, frame: RoomFrame): void {
    const travel = this.crowdSpeed * s;
    for (let i = 0; i < this.walkers.length; i++) {
      const w = this.walkers[i];
      const z = w.z + travel;
      const ahead = ez - z;
      let x = w.x;
      if (w.lane) {
        const k = ahead >= 0 ? 1 - range(PART_FULL, PART_AHEAD, ahead) : 1 - range(PART_BEHIND / 2, PART_BEHIND, -ahead);
        x += (ex + w.side * CLEAR - w.x) * smootherstep(k);
      }
      const gait = this.crowdGait;
      const phase = w.phase + travel / (gait.stride * w.scale);
      m1.makeRotationY(w.heading - gait.facing).scale(v1.setScalar(w.scale)).setPosition(x, 0, z);
      this.crowd.set(i, m1, phase - Math.floor(phase));
      const half = Math.floor(phase * 2);
      if (half !== w.half) {
        if (!Number.isNaN(w.half) && !frame.paused && s < SILENCE_AT) this.footfall(x - ex, z - ez, w.scale, s, frame.time);
        w.half = half;
      }
    }
    this.crowd.commit();
  }

  private footfall(dx: number, dz: number, scale: number, s: number, now: number): void {
    const distance = Math.hypot(dx, dz);
    if (distance > STEP_HEARD || now - this.stepAt < STEP_GAP) return;
    this.stepAt = now;
    const near = 1 - distance / STEP_HEARD;
    const hush = s > STEP_HUSH_AT[0] && s < STEP_HUSH_AT[1] ? STEP_HUSH : 1;
    this.sound.play(STEPS[this.stepNext++ % STEPS.length], { gain: STEP_GAIN * near * near * hush, pan: clamp(dx / 2.5, -1, 1), rate: 1.12 - (scale - 1) * 0.5, reverb: 0.25, lowpass: 2600 });
  }

  /** Her hand: it comes down and hangs, closes on yours, pulls you on, holds while you look up, lets go and is drawn up. Returns how far it is from the eye (0 when gone). */
  private holdHand(s: number, ex: number, ez: number): number {
    const rig = this.rig;
    rig.visible = s >= HAND_FROM && s < WITHDRAW[1];
    const held = smootherstep(range(GRAB_AT, HELD_AT, s));
    this.handLight.intensity = rig.visible ? lerp(HAND_LIGHT, HAND_LIGHT_HELD, held) * smootherstep(range(HAND_FROM, HAND_DOWN, s)) * (1 - range(LET_GO, WITHDRAW[1], s)) : 0;
    if (!rig.visible) return 0;
    const ey = this.eye.position.y - this.origin.y;
    // held: at the eye, turned the way it is pulled (not the way you look)
    q1.setFromAxisAngle(UP, this.eye.yaw * (1 - smootherstep(range(RUN_TO, STOP_AT, s))));
    this.heldAt.set(...ARM[0]).applyQuaternion(q1).add(v2.set(ex, ey, ez));
    const down = smootherstep(range(HAND_FROM, HAND_DOWN, s));
    this.hangAt.set(HANG_AT[0], HANG_AT[1] + DESCEND * (1 - down), HANG_AT[2]);
    rig.position.lerpVectors(this.hangAt, this.heldAt, held);
    rig.quaternion.slerpQuaternions(this.hangTurn, q1, held);
    const away = range(WITHDRAW[0], WITHDRAW[1], s);
    if (away > 0) rig.position.addScaledVector(v1.copy(this.armUp).applyQuaternion(rig.quaternion), WITHDRAW_BY * away * away);
    const closed = smootherstep(range(GRAB_AT + 0.05, CLOSED_AT, s)) * (1 - smootherstep(range(LET_GO, OPENED_AT, s)));
    const curl = lerp(OPEN, 1, closed);
    for (const f of this.fingers) f.bone.quaternion.copy(f.rest).multiply(q2.setFromAxisAngle(AXIS_Z, f.curl * curl));
    this.handLight.position.set(...HAND_LIGHT_AT).applyQuaternion(rig.quaternion).add(rig.position).add(this.origin);
    return Math.hypot(rig.position.x - ex, rig.position.y - ey, rig.position.z - ez);
  }

  /** The woman at the end of the empty hall, always as far away; her hair, her shadow, her steps. */
  private walkHer(s: number, ez: number, empty: boolean, frame: RoomFrame): void {
    this.her.root.visible = empty;
    this.herHair.visible = empty;
    if (!empty) return;
    const z = ez - HER_GAP;
    const gait = this.herGait;
    const phase = Math.max(0, this.herStart - z) / (gait.stride * HER_SCALE);
    const turn = Math.PI - gait.facing;
    m1.makeRotationY(turn).scale(v1.setScalar(HER_SCALE)).setPosition(HER_X, 0, z);
    this.her.set(0, m1, phase - Math.floor(phase));
    this.her.commit();
    // her hair hangs from the top of her head, wherever her step has carried it
    const w = walkWeights(phase);
    const c = this.her.crowns;
    v1.set(0, 0, 0);
    for (let k = 0; k < 4; k++) v1.addScaledVector(c[k], w[k]);
    this.herHair.position.copy(v1.multiplyScalar(HER_SCALE).applyAxisAngle(UP, turn)).add(v2.set(HER_X, 0, z));
    const half = Math.floor(phase * 2);
    if (half !== this.herHalf) {
      if (!Number.isNaN(this.herHalf) && !frame.paused && s > LET_GO + 0.4 && s < CUT_AT) {
        this.sound.play(STEPS[this.stepNext++ % STEPS.length], { gain: HER_STEP_GAIN, rate: 0.95, reverb: 0.7, lowpass: 1600 });
      }
      this.herHalf = half;
    }
  }
}
