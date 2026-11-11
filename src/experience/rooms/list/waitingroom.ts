import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  type Bone,
  type Material,
  type Object3D,
  type Texture,
  type TubeGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import { rigClock, setClock, type ClockHand } from '../../dream/ClockRig';
import { BEND_STEP, meterUVs } from '../../dream/DreamKit';
import { cutMaterial, randomFrom, type Crowd, type HeroFigure } from '../../dream/FigureKit';
import { damp, range, smootherstep, wobble } from '../../math';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import type { RoomVoice, RoomVoiceOptions } from '../RoomSound';

type V3 = readonly [number, number, number];

/** The hall (m): half its width, its far wall, its back wall, its ceiling, how high the tile goes. */
const HALF_W = 5.05;
const FAR_Z = -19;
const BACK_Z = 1.9;
const H = 3.05;
const TILE_TO = 1.45;
/** The seats: their scale (the file is low for a body), how far apart the rows stand and how many, half the aisle (m). */
const SEAT_SCALE = 1.12;
const UNIT = 1.65 * SEAT_SCALE;
const SEAT = UNIT / 3;
const ROW_STEP = 1.2;
const ROWS = 13;
const AISLE = 0.8;
/** The seat's height (m), how far back on it a body sits, and the eye. */
const SEAT_Y = 0.475;
const SIT_BACK = 0.04;
const HIPS = 0.59;
/** How far the sitters' bodies are bowed forward over what their pose already bows (rad). */
const BOW = 0.2;
const EYE: V3 = [0, 1.15, -0.04];
/** The ticket on the seat to your right, and the seat to your left. */
const TICKET_AT: V3 = [SEAT, SEAT_Y + 0.002, -0.14];
const BESIDE_X = -SEAT;
/** Rows of ceiling panels (m): the fourth has the panel that is alive. */
const PANEL_Z = [1.2, -1.8, -5.4, -9, -12.6, -16.2];
const PANEL_X = [-3, 0, 3];
const ALIVE_ROW = 3;
/** When each row of panels comes on and goes out (s): toward you, and then the dark, toward you. */
const ROW_ON = [32.2, 31.1, 29, 27, 28, 30.1];
const ROW_OFF = [40.6, 39.5, 38.3, 37, 35.6, 34];
/** Lights (spots in candela, point lights as the pool wants them). */
const KEY = 46;
const ALIVE_FILL = 2.4;
const ROW_FILL = 4.2;
const ROW_GLOW = 3;
const ALIVE_GLOW = 5;
const WINDOW_FILL = 1.8;
const WINDOW_OPEN_FILL = 2;
const WINDOW_SPOT = 9;
const NEAR_FILL = 0.8;
const EXIT_FILL = 0.55;
const BACK_FILL = 0.85;
const CEILING_LEFT = 0.3;
/** The hall's faint light from nowhere, and what is left of it in the dark. */
const ENV = 0.12;
const ENV_DARK = 0.045;
const RED_FILL = 0.5;
const BOUNCE = 16;
const BOUNCE_NEAR = 4.5;
const BOUNCE_NEAR_LOW = 1.8;
const FACING_KEY = 24;
const FACING_FAR = 190;
const FLASH_KEY = 3.5;
/** The light of the blow stands where a flash gun would, just behind the eye: wide for the near rows, narrow down the aisle for the far ones (m, deg). */
const FACING_AT: V3 = [0, 1.72, 0.8];
const FACING_WIDE = 38;
const FACING_NARROW = 11;
/** How dark the floor and the seats go for the blow, so that the faces are what is lit (times their color). */
const FLOOR_TURNED = 0.55;
const SEATS_TURNED = 0.5;
/** The window (m), and how brightly its glass and the panes beside it glow. */
const SILL = 1.06;
const GLASS_TOP = 2.28;
const PANE_W = 2.5;
const GLASS_GLOW = 1;
const SIDE_GLOW = 0.09;
/** Dings (s), and when the light dips after them: whoever is still in view goes then. */
const DING_18 = 14;
const DING_19 = 24;
const NUMBER_BLINK = 0.1;
const DIP_1 = 15.6;
const DIP_2 = 25.4;
/** Which sitter goes at which dip (see SCATTER). */
const GONE_1 = 7;
const GONE_2 = 9;
/** Row behind you, and when they have come (s). */
const BEHIND_AT = 20;
const STAND_Z = 0.98;
const STAND_CLOSE_Z = 0.74;
const STANDING = 7;
/** The neighbor's bones from the hips up, and how far its pose bows its head (rad). */
const BESIDE_CHAIN = ['Bip01_Spine', 'Bip01_Spine1', 'Bip01_Spine2', 'Bip01_Neck', 'Bip01_Head'];
const BOWED = 0.42;
/** How its spine twists toward you (rad at each joint), and bends: how far already, how much more it leans in. */
const BESIDE_TWIST = [-0.42, -0.42, -0.3];
const BESIDE_LEAN_REST = 0.12;
const BESIDE_LEAN = 0.62;
const BESIDE_SLIDE = 0.02;
const BESIDE_FORWARD = 0.22;
/** The blow (s): the number, the black, the shutter. */
const DING_33 = 44;
const BLACK_FROM = 44.85;
const BLACK_LEN = 0.25;
const TURN_AT = BLACK_FROM + BLACK_LEN;
const SHUTTER_AT = TURN_AT + 0.42;
/** The window opens, the neck comes, the eye gets up, the cut (s). */
const WINDOW_AT = 50;
const WINDOW_LEN = 1.4;
const NECK_FROM = 50.7;
const RISE_AT = 51.2;
const CUT_AT = 56;
/** How far the far end of the hall curls up and turns while they look at you (1/m, rad/m: at the far wall, 19 m away, 360 and 19 times this). */
const STARE_BEND = 0.0016;
const STARE_TWIST = 0.003;
/** How much light their cloth keeps when the rest has gone (emissive). */
const PALE = 0.26;
const PALE_FACING = 0.05;
const HAIR_GLOW = 0.016;
const SELF_GLOW = 0.08;
/** Their bodies end here once they have turned round (m above the floor): the seat backs hide the cut. */
const TURNED_CUT = 0.6;
/** How many turn round at the end: far more than sat there. */
const TURNED = 64;
/** How far they lean back for each meter the eye rises (rad). */
const LOOK_UP = 0.62;

/** Who sits in the hall at first: row, side, seat counted from the aisle. */
const SCATTER: readonly (readonly [number, number, number])[] = [
  [2, -1, 0], [1, 1, 3], [3, 1, 1], [3, -1, 4], [4, 1, 2], [5, -1, 2], [5, 1, 5], [6, -1, 0], [6, 1, 3], [7, 1, 0], [7, -1, 3], [8, -1, 1], [8, 1, 2],
  [9, 1, 1], [9, -1, 5], [10, -1, 0], [10, 1, 4], [11, 1, 0], [11, -1, 2], [12, -1, 1], [12, 1, 3], [13, 1, 1], [13, -1, 3],
];
/** Tiles gone from the ceiling (their corner toward the back left, m, on the tile grid). */
const TILES_GONE: readonly (readonly [number, number])[] = [[2.1, -4.2], [2.7, -4.2], [-3.3, -11.4], [-2.1, -14.4], [3.3, -9.6], [-3.3, 0]];
/** The neck's way, from behind the window to just before your face. */
const NECK_WAY: readonly V3[] = [
  [0.05, 1.05, FAR_Z - 1.5],
  [0, 1.35, FAR_Z - 0.2],
  [-0.25, 1.5, -18],
  [-1.2, 1.72, -16.3],
  [-1.75, 1.95, -14.2],
  [-0.6, 2.45, -12.4],
  [1.15, 2.85, -10.9],
  [1.55, 2.68, -8.9],
  [1.3, 2.2, -7.3],
  [0.62, 1.82, -6.05],
  [0.12, 1.62, -5.25],
  [0.02, 1.56, -4.62],
];
const NECK_RADIUS = 0.062;
const NECK_TAPER = 0.8;
/** The neck as a body: how dark its sides go against what faces you, how many rings to each turn of its skin and how deep they cut, how wet it is (roughness). */
const NECK_EDGE = 0.3;
const NECK_RINGS = 3;
const NECK_RING_DEPTH = 0.32;
const NECK_GLOSS = 0.36;
/** How much light the skin keeps of its own in the dark (emissive). */
const NECK_PALE = 0.16;
const HEAD_PALE = 0.06;
/** The head at the end of it (m): its half-width and half-height, and the hole sewn into it: half-width, half-height, how far above the middle. */
const HEAD_R = 0.088;
const HEAD_H = 0.135;
const HOLE_W = 0.046;
const HOLE_H = 0.068;
const HOLE_Y = 0.02;
/** The hole is a lamprey's mouth. Its flesh, ring by ring from out of the skin to the throat: how far out (0..1 of the hole), how far above the skin (m, below when negative), its colour. */
const MOUTH_PROFILE: readonly (readonly [number, number, number])[] = [
  [1.16, -0.002, 0x8a5a54],
  [1.04, 0.006, 0x4a3432],
  [0.92, 0.0045, 0x3e2826],
  [0.8, -0.006, 0x4e1e1c],
  [0.62, -0.02, 0x3c1513],
  [0.45, -0.036, 0x2a0d0c],
  [0.3, -0.05, 0x1a0707],
  [0.18, -0.06, 0x0c0303],
];
/** Where the skin opens under the lip (0..1 of the hole), how wet the flesh is (roughness), the little light it keeps, how wide the black of the throat is (0..1 of the hole). */
const MOUTH_CUT = 1.06;
const MOUTH_WET = 0.3;
const MOUTH_GLOW = 0x230b09;
const THROAT = 0.2;
/** Its teeth, row by row from the lip in: how far out (0..1 of the hole), how many, how long (m); how thick against how long, how far they rise off the flesh toward you (against pointing in), their colour. */
const MOUTH_ROWS: readonly (readonly [number, number, number])[] = [[0.86, 26, 0.0055], [0.7, 20, 0.0085], [0.54, 15, 0.011], [0.4, 10, 0.014]];
const TOOTH_WIDTH = 0.34;
const TOOTH_RAISE = 0.45;
const TOOTH_COLOR = 0xd6cba6;
const NECK_SWAY = 0.07;
/** How far its head has tilted by the time it has stopped in front of you (rad); the pale light that comes along with the head, and how far it reaches (m). */
const HEAD_TILT = 0.42;
const HEAD_LIGHT = 1.4;
const HEAD_LIGHT_REACH = 4.5;
const HEAD_LIGHT_TOP = 2.3;

/** One-shots on their beats: second, file, how. They are far off and dull at first, and come nearer and drier. */
const CUES: readonly (readonly [number, string, RoomVoiceOptions])[] = [
  [6.7, 'rooms/paper_ticket.mp3', { gain: 0.3, pan: 0.6 }],
  [9.8, 'rooms/cough_far_1.mp3', { gain: 0.24, pan: 0.35, reverb: 0.5, lowpass: 3000 }],
  [11.4, 'rooms/paper_rustle_2.mp3', { gain: 0.16, pan: -0.5, reverb: 0.4, lowpass: 4000 }],
  [DING_18, 'rooms/ding_two_note.mp3', { gain: 0.3, reverb: 0.25 }],
  [DIP_1 - 0.02, 'rooms/fluorescent_tick_1.mp3', { gain: 0.2, reverb: 0.25 }],
  [DIP_1 + 0.36, 'rooms/fluorescent_tick_3.mp3', { gain: 0.14, reverb: 0.25 }],
  [DIP_1 + 0.12, 'rooms/seat_creak_1.mp3', { gain: 0.1, pan: -0.2, reverb: 0.6, lowpass: 3000 }],
  [18.6, 'rooms/paper_rustle_3.mp3', { gain: 0.14, pan: 0.55, reverb: 0.4, lowpass: 4000 }],
  [BEHIND_AT + 0.5, 'rooms/coat_move.mp3', { gain: 0.14, pan: 0.15, offset: 1.2, duration: 0.8, lowpass: 2600 }],
  [22.3, 'rooms/cough_far_2.mp3', { gain: 0.22, pan: -0.4, reverb: 0.5, lowpass: 3000 }],
  [DING_19, 'rooms/ding_two_note.mp3', { gain: 0.3, reverb: 0.25 }],
  [DING_19 + 0.65, 'rooms/seat_creak_3.mp3', { gain: 0.3, pan: -0.9, reverb: 0.05 }],
  [DING_19 + 0.9, 'rooms/coat_move.mp3', { gain: 0.2, pan: -0.8, duration: 1.2 }],
  [DIP_2 - 0.02, 'rooms/fluorescent_tick_2.mp3', { gain: 0.2, reverb: 0.25 }],
  [DIP_2 + 0.36, 'rooms/fluorescent_tick_4.mp3', { gain: 0.14, reverb: 0.25 }],
  [DIP_2 + 0.12, 'rooms/seat_creak_4.mp3', { gain: 0.12, pan: 0.2, reverb: 0.6, lowpass: 3000 }],
  [26.1, 'rooms/fluorescent_tick_5.mp3', { gain: 0.12, reverb: 0.3, lowpass: 4000 }],
  [26.62, 'rooms/fluorescent_tick_6.mp3', { gain: 0.14, reverb: 0.3, lowpass: 4000 }],
  [ROW_ON[3], 'rooms/fluorescent_start_1.mp3', { gain: 0.2, reverb: 0.3, lowpass: 3600 }],
  [ROW_ON[4], 'rooms/fluorescent_stutter_1.mp3', { gain: 0.16, reverb: 0.3, lowpass: 3000 }],
  [ROW_ON[2], 'rooms/fluorescent_start_1.mp3', { gain: 0.24, rate: 0.94, reverb: 0.2, lowpass: 5000 }],
  [29.4, 'rooms/paper_rustle_1.mp3', { gain: 0.12, pan: -0.3, reverb: 0.4, lowpass: 4000 }],
  [ROW_ON[5], 'rooms/fluorescent_stutter_2.mp3', { gain: 0.1, reverb: 0.4, lowpass: 2600 }],
  [ROW_ON[1], 'rooms/fluorescent_start_2.mp3', { gain: 0.24, reverb: 0.1 }],
  [ROW_ON[0], 'rooms/fluorescent_start_1.mp3', { gain: 0.34 }],
  [ROW_OFF[5], 'rooms/relay_clunk_1.mp3', { gain: 0.16, reverb: 0.4, lowpass: 2200 }],
  [ROW_OFF[4], 'rooms/relay_clunk_2.mp3', { gain: 0.2, reverb: 0.35, lowpass: 2600 }],
  [ROW_OFF[3], 'rooms/relay_clunk_3.mp3', { gain: 0.28, reverb: 0.3, lowpass: 3400 }],
  [ROW_OFF[2], 'rooms/relay_clunk_4.mp3', { gain: 0.34, reverb: 0.2, lowpass: 5000 }],
  [ROW_OFF[1], 'rooms/relay_clunk_5.mp3', { gain: 0.42, reverb: 0.12 }],
  [ROW_OFF[0], 'rooms/relay_clunk_2.mp3', { gain: 0.55, rate: 0.85, reverb: 0.05 }],
  [DING_33, 'rooms/ding_two_note_wrong.mp3', { gain: 0.34, reverb: 0.3 }],
  // under the black, the whole hall moves at once
  [BLACK_FROM + 0.02, 'rooms/seat_creak_1.mp3', { gain: 0.34, pan: -0.7, reverb: 0.5 }],
  [BLACK_FROM + 0.03, 'rooms/seat_creak_2.mp3', { gain: 0.3, pan: 0.6, reverb: 0.5 }],
  [BLACK_FROM + 0.05, 'rooms/seat_creak_3.mp3', { gain: 0.36, pan: -0.15, reverb: 0.4 }],
  [BLACK_FROM + 0.06, 'rooms/seat_creak_4.mp3', { gain: 0.3, pan: 0.85, reverb: 0.5 }],
  [BLACK_FROM + 0.02, 'rooms/coat_move.mp3', { gain: 0.4, pan: -0.35, offset: 1.25, duration: 0.7, reverb: 0.25 }],
  [BLACK_FROM + 0.04, 'rooms/coat_move.mp3', { gain: 0.35, pan: 0.4, offset: 2.25, duration: 0.6, reverb: 0.25 }],
  [TURN_AT + 0.02, 'rooms/seat_creak_2.mp3', { gain: 0.28, pan: -0.9 }],
  [WINDOW_AT, 'rooms/window_slide.mp3', { gain: 0.45, reverb: 0.4 }],
  [RISE_AT, 'rooms/bench_sit.mp3', { gain: 0.35, reverb: 0.2, rate: 0.92, duration: 1.8 }],
  [55.35, 'rooms/mouth_wet_1.mp3', { gain: 0.22 }],
];
/** Beds, all running from the start and brought up when their time comes (see `bedLevels`). */
const BEDS: readonly (readonly [string, RoomVoiceOptions])[] = [
  ['rooms/fluorescent_hum.mp3', {}],
  ['rooms/waiting_room_tone.mp3', {}],
  ['rooms/clock_tick.mp3', { pan: -0.35, reverb: 0.15 }],
  ['rooms/dream_drone_low.mp3', {}],
  ['rooms/fluorescent_hum_bad.mp3', {}],
  ['rooms/fluorescent_hum_close.mp3', {}],
  ['rooms/breath_other.mp3', { pan: -0.95 }],
  ['rooms/breath_beside.mp3', { pan: -0.9 }],
  ['rooms/dream_drone_metal.mp3', {}],
  ['rooms/duct_wet_behind.mp3', { lowpass: 3000 }],
  ['rooms/dream_drone_hollow.mp3', {}],
];
const HEART = 'rooms/heart_beat.mp3';
/** The instant of real silence before the number comes: everything stops here (s). */
const SILENCE_AT = 43.4;

export const assets: RoomAssets = {
  models: ['seats_row', 'radiator', 'wall_clock', 'ticket_stub', 'noticeboard', 'drinking_fountain', 'filing_cabinet', 'chair_plastic'],
  materials: ['plaster_pale', 'tile_bone'],
  sounds: [...new Set(CUES.map((c) => c[1])), ...BEDS.map((b) => b[0]), HEART],
};

/** Two irregular catches and then lit; at `off` the relay drops it, with a little of its phosphor left. */
function tube(s: number, on: number, off: number): number {
  if (s < on) return 0;
  if (s >= off) return Math.exp(-(s - off) / 0.1) * 0.5;
  const a = s - on;
  if (a < 0.08) return 0.8;
  if (a < 0.62) return 0;
  if (a < 0.7) return 0.55;
  if (a < 1.02) return 0;
  return Math.min(1, (a - 1.02) / 0.05);
}

/** A failing tube's double dip around `at` (the two are more than a third of a second apart). */
function dip(s: number, at: number): number {
  const a = (s - at) / 0.075;
  const b = (s - at - 0.38) / 0.05;
  return 1 - 0.95 * Math.exp(-a * a) - 0.5 * Math.exp(-b * b);
}

function canvasOf(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** The prism sheet of a ceiling panel, its tubes behind it, flies dead in the bottom of it. */
function drawDiffuser(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(5);
  c.fillStyle = '#9da193';
  c.fillRect(0, 0, w, h);
  for (const x of [0.25, 0.5, 0.75]) {
    const g = c.createLinearGradient((x - 0.12) * w, 0, (x + 0.12) * w, 0);
    g.addColorStop(0, 'rgba(255,255,245,0)');
    g.addColorStop(0.5, 'rgba(255,255,245,0.95)');
    g.addColorStop(1, 'rgba(255,255,245,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  c.strokeStyle = 'rgba(40,44,36,0.16)';
  c.lineWidth = 1;
  for (let i = 0; i < w; i += 5) {
    c.beginPath();
    c.moveTo(i, 0);
    c.lineTo(i, h);
    c.stroke();
  }
  for (let i = 0; i < h; i += 5) {
    c.beginPath();
    c.moveTo(0, i);
    c.lineTo(w, i);
    c.stroke();
  }
  // years of dust and what flew in
  const y = c.createLinearGradient(0, 0, 0, h);
  y.addColorStop(0, 'rgba(80,66,30,0.3)');
  y.addColorStop(0.3, 'rgba(80,66,30,0)');
  y.addColorStop(0.7, 'rgba(80,66,30,0)');
  y.addColorStop(1, 'rgba(60,50,24,0.45)');
  c.fillStyle = y;
  c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(8,8,6,0.85)';
  for (let i = 0; i < 26; i++) {
    const x = random() * w;
    const py = (random() < 0.7 ? 0.82 + random() * 0.17 : random()) * h;
    c.beginPath();
    c.ellipse(x, py, 1 + random() * 2.2, 0.8 + random() * 1.4, random() * 3, 0, Math.PI * 2);
    c.fill();
  }
}

/** Damp and grime for a wall, only ever darkening: a tide rising from the tile, streaks from the ceiling. */
function drawDamp(c: CanvasRenderingContext2D, w: number, h: number, seed: number, metersWide: number): void {
  const random = randomFrom(seed);
  const m = h / H;
  const yAt = (height: number) => h - height * m;
  const blots = Math.round(metersWide * 5);
  for (let i = 0; i < blots; i++) {
    const x = random() * w;
    const top = TILE_TO + 0.04 + random() * random() * 0.8;
    const r = (0.2 + random() * 0.55) * m;
    const g = c.createRadialGradient(x, yAt(top), 0, x, yAt(top), r);
    const a = 0.1 + random() * 0.26;
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(0.7, `rgba(0,0,0,${a * 0.6})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - r, yAt(top) - r, r * 2, r * 2);
  }
  const streaks = Math.round(metersWide * 3.2);
  for (let i = 0; i < streaks; i++) {
    const x = random() * w;
    const down = (0.3 + random() * random() * 2.1) * m;
    const wide = (0.006 + random() * 0.03) * m;
    const g = c.createLinearGradient(0, 0, 0, down);
    const a = 0.12 + random() * 0.34;
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x, 0, wide, down);
  }
  const edge = c.createLinearGradient(0, 0, 0, h);
  edge.addColorStop(0, 'rgba(0,0,0,0.5)');
  edge.addColorStop(0.1, 'rgba(0,0,0,0.05)');
  edge.addColorStop(0.72, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.6)');
  c.fillStyle = edge;
  c.fillRect(0, 0, w, h);
}

/** Where the floor is darkest: under the seats, along the walls, old stains (only ever darkening). */
function drawFloorGrime(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(9);
  const pxX = w / (HALF_W * 2);
  const pxZ = h / (BACK_Z - FAR_Z);
  const X = (x: number) => (x + HALF_W) * pxX;
  const Z = (z: number) => (z - FAR_Z) * pxZ;
  const under = (x0: number, x1: number, z: number) => {
    const half = 0.62 * pxZ;
    const g = c.createLinearGradient(0, Z(z) - half, 0, Z(z) + half);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.72)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(X(x0), Z(z) - half, X(x1) - X(x0), half * 2);
  };
  under(-UNIT * 2.5, UNIT * 2.5, 0);
  for (let r = 1; r <= ROWS; r++) {
    under(-AISLE - UNIT * 2, -AISLE + 0.02, -r * ROW_STEP);
    under(AISLE - 0.02, AISLE + UNIT * 2, -r * ROW_STEP);
  }
  for (const [a, b] of [[0, 0.8], [1, 0.2]]) {
    const g = c.createLinearGradient(a * w, 0, b * w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.85)');
    g.addColorStop(0.25, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  for (let i = 0; i < 90; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = (0.15 + random() * 0.9) * pxX;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.08 + random() * 0.26;
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** The ceiling's own stains and the tiles gone (only ever darkening). */
function drawCeilingGrime(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(14);
  const pxX = w / (HALF_W * 2);
  const pxZ = h / (BACK_Z - FAR_Z);
  for (let i = 0; i < 26; i++) {
    const cx = random() * w;
    const cy = random() * h;
    const blobs = 3 + Math.floor(random() * 5);
    const a = 0.08 + random() * 0.2;
    for (let n = 0; n < blobs; n++) {
      const r = (0.18 + random() * 0.8) * pxX;
      const x = cx + (random() - 0.5) * 1.5 * pxX;
      const y = cy + (random() - 0.5) * 1.5 * pxZ;
      const g = c.createRadialGradient(x, y, r * 0.55, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${a * 0.5})`);
      g.addColorStop(0.9, `rgba(0,0,0,${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  // the T-bars that hold the tiles
  c.strokeStyle = 'rgba(0,0,0,0.62)';
  c.lineWidth = 1.6;
  for (let x = -HALF_W + ((HALF_W + 0.3) % 0.6); x < HALF_W; x += 0.6) {
    c.beginPath();
    c.moveTo((x + HALF_W) * pxX, 0);
    c.lineTo((x + HALF_W) * pxX, h);
    c.stroke();
  }
  for (let z = Math.floor(BACK_Z / 0.6) * 0.6; z > FAR_Z; z -= 0.6) {
    c.beginPath();
    c.moveTo(0, (BACK_Z - z) * pxZ);
    c.lineTo(w, (BACK_Z - z) * pxZ);
    c.stroke();
  }
  c.fillStyle = 'rgba(0,0,0,0.97)';
  for (const [x, z] of TILES_GONE) c.fillRect((x + HALF_W) * pxX, (BACK_Z - z) * pxZ, 0.6 * pxX, 0.6 * pxZ);
}

/** One digit of a red display, its dead segments faintly there. */
function drawSeven(c: CanvasRenderingContext2D, digit: number, x: number, y: number, w: number, h: number): void {
  const t = w * 0.17;
  const g = t * 0.14;
  const SEGMENTS = [0b1110111, 0b0100100, 0b1011101, 0b1101101, 0b0101110, 0b1101011, 0b1111011, 0b0100101, 0b1111111, 0b1101111];
  const bits = SEGMENTS[digit];
  const bar = (on: boolean, x0: number, y0: number, x1: number, y1: number) => {
    c.fillStyle = on ? '#ff2c12' : '#2a0703';
    c.beginPath();
    if (y0 === y1) {
      c.moveTo(x0 + g, y0);
      c.lineTo(x0 + t / 2 + g, y0 - t / 2);
      c.lineTo(x1 - t / 2 - g, y0 - t / 2);
      c.lineTo(x1 - g, y0);
      c.lineTo(x1 - t / 2 - g, y0 + t / 2);
      c.lineTo(x0 + t / 2 + g, y0 + t / 2);
    } else {
      c.moveTo(x0, y0 + g);
      c.lineTo(x0 + t / 2, y0 + t / 2 + g);
      c.lineTo(x0 + t / 2, y1 - t / 2 - g);
      c.lineTo(x0, y1 - g);
      c.lineTo(x0 - t / 2, y1 - t / 2 - g);
      c.lineTo(x0 - t / 2, y0 + t / 2 + g);
    }
    c.fill();
  };
  const top = y + t / 2;
  const mid = y + h / 2;
  const low = y + h - t / 2;
  const left = x + t / 2;
  const right = x + w - t / 2;
  bar(Boolean(bits & 1), left, top, right, top);
  bar(Boolean(bits & 2), left, top, left, mid);
  bar(Boolean(bits & 4), right, top, right, mid);
  bar(Boolean(bits & 8), left, mid, right, mid);
  bar(Boolean(bits & 16), left, mid, left, low);
  bar(Boolean(bits & 32), right, mid, right, low);
  bar(Boolean(bits & 64), left, low, right, low);
}

/** The slip: thermal paper gone yellow, your number, the time it was torn off. */
function drawTicket(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(33);
  c.fillStyle = '#d9d3bf';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 14; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = (0.08 + random() * 0.25) * h;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(120,96,50,0.16)');
    g.addColorStop(1, 'rgba(120,96,50,0)');
    c.fillStyle = g;
    c.globalCompositeOperation = 'source-atop';
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'source-over';
  }
  c.fillStyle = '#1c1a18';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `bold ${h * 0.62}px "Courier New", monospace`;
  c.fillText('33', w / 2, h * 0.48);
  c.font = `bold ${h * 0.085}px "Courier New", monospace`;
  c.fillText('18:30', w / 2, h * 0.88);
  c.fillRect(w * 0.1, h * 0.14, w * 0.8, h * 0.012);
  c.fillRect(w * 0.1, h * 0.79, w * 0.8, h * 0.012);
}

/** A paper notice, or the portrait of someone being looked for: a pale oval head, a hole where the face was. */
function drawNotice(c: CanvasRenderingContext2D, w: number, h: number, portrait: boolean): void {
  const random = randomFrom(portrait ? 61 : 62);
  c.fillStyle = '#a7a68f';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#26261f';
  c.fillRect(w * 0.1, h * 0.06, w * 0.8, h * 0.1);
  if (portrait) {
    c.fillStyle = '#54544a';
    c.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.46);
    c.fillStyle = '#b5b4a2';
    c.beginPath();
    c.ellipse(w * 0.5, h * 0.42, w * 0.17, h * 0.15, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#060605';
    c.beginPath();
    c.ellipse(w * 0.5, h * 0.42, w * 0.1, h * 0.095, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = 'rgba(30,30,24,0.7)';
  for (let i = 0; i < 9; i++) c.fillRect(w * 0.1, h * ((portrait ? 0.7 : 0.24) + i * (portrait ? 0.03 : 0.07)), w * (0.5 + random() * 0.3), h * 0.012);
  const stain = c.createLinearGradient(0, 0, 0, h);
  stain.addColorStop(0, 'rgba(50,40,20,0.3)');
  stain.addColorStop(0.3, 'rgba(50,40,20,0)');
  stain.addColorStop(1, 'rgba(40,34,20,0.55)');
  c.fillStyle = stain;
  c.fillRect(0, 0, w, h);
}

/** The ticket machine's face: enamel, a slot, the number it will give next, and it is the one after yours. */
function drawDispenser(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#100504';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#050100';
  c.fillRect(w * 0.14, h * 0.1, w * 0.72, h * 0.3);
  const dh = h * 0.24;
  const dw = dh * 0.56;
  drawSeven(c, 3, w / 2 - dw - w * 0.03, h * 0.13, dw, dh);
  drawSeven(c, 4, w / 2 + w * 0.03, h * 0.13, dw, dh);
  c.fillStyle = '#000';
  c.fillRect(w * 0.26, h * 0.88, w * 0.48, h * 0.05);
}

/** A way out, in the green they all are: a door, a figure running for it. */
function drawExit(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#0b8f4c';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#d8ffe6';
  c.strokeStyle = '#d8ffe6';
  c.lineCap = 'round';
  c.lineWidth = h * 0.1;
  const x = w * 0.42;
  c.beginPath();
  c.arc(x + h * 0.07, h * 0.2, h * 0.09, 0, Math.PI * 2);
  c.fill();
  const lines: readonly (readonly [number, number, number, number])[] = [
    [0.03, 0.34, -0.04, 0.6],
    [-0.04, 0.6, 0.12, 0.72],
    [0.12, 0.72, 0.08, 0.9],
    [-0.04, 0.6, -0.12, 0.76],
    [-0.12, 0.76, -0.26, 0.82],
    [0.03, 0.36, 0.17, 0.46],
    [0.17, 0.46, 0.27, 0.42],
    [0.03, 0.36, -0.12, 0.42],
    [-0.12, 0.42, -0.2, 0.54],
  ];
  for (const [a, b, d, e] of lines) {
    c.beginPath();
    c.moveTo(x + a * h, b * h);
    c.lineTo(x + d * h, e * h);
    c.stroke();
  }
  c.fillRect(w * 0.74, h * 0.12, w * 0.16, h * 0.76);
  c.fillStyle = '#0b8f4c';
  c.fillRect(w * 0.77, h * 0.18, w * 0.1, h * 0.64);
}

/** Someone stands behind the glass: a soft dark shape, its neck far too long. Only ever a blur. */
function drawBehindGlass(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.clearRect(0, 0, w, h);
  c.shadowColor = 'rgba(0,0,0,0.85)';
  c.shadowBlur = h * 0.1;
  c.shadowOffsetX = w * 2;
  c.fillStyle = '#000';
  const X = -w * 2;
  c.beginPath();
  c.ellipse(X + w * 0.5, h * 1.05, w * 0.3, h * 0.42, 0, 0, Math.PI * 2);
  c.fill();
  c.fillRect(X + w * 0.455, h * 0.16, w * 0.09, h * 0.6);
  c.beginPath();
  c.ellipse(X + w * 0.5, h * 0.13, w * 0.08, h * 0.13, 0, 0, Math.PI * 2);
  c.fill();
  c.shadowColor = 'transparent';
  c.shadowOffsetX = 0;
}

/** How much of the clothes' folds shows through the cloth, and how dark the cloth is. */
const CLOTH_CONTRAST = 1.5;
const CLOTH_MIDDLE = 128;
/** The color of the cloth under white light (its map leans yellow). */
const CLOTH: V3 = [0.92, 0.96, 0.96];

/** Coarse sacking over a body: its folds kept, blotched with damp, patched and stitched all over, a seam up the back of the head. */
function dirtied(source: Texture, head: boolean, seed: number): CanvasTexture {
  const image = source.image as HTMLCanvasElement;
  const texture = canvasOf(image.width, image.height, (c, w, h) => {
    c.drawImage(image, 0, 0);
    const pixels = c.getImageData(0, 0, w, h);
    const d = pixels.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // the hollow stays black
        if (d[i] < 14) continue;
        const slub = 1 + 0.05 * Math.sin(y * 0.55 + Math.sin(x * 0.07) * 4) + 0.05 * Math.sin(x * 0.61 + Math.sin(y * 0.05) * 5);
        const v = Math.max(0, Math.min(255, (CLOTH_MIDDLE + (d[i] - 158) * CLOTH_CONTRAST) * slub));
        d[i] = v;
        d[i + 1] = v * 0.96;
        d[i + 2] = v * 0.86;
      }
    }
    c.putImageData(pixels, 0, 0);
    const random = randomFrom(seed);
    const blots = head ? 26 : 90;
    for (let i = 0; i < blots; i++) {
      const x = random() * w;
      const y = random() * h;
      const r = (0.02 + random() * 0.1) * w;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.1 + random() * 0.3;
      g.addColorStop(0, `rgba(22,18,10,${a})`);
      g.addColorStop(1, 'rgba(22,18,10,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const stitch = (x0: number, y0: number, x1: number, y1: number, width: number) => {
      c.strokeStyle = 'rgba(10,8,5,0.85)';
      c.lineWidth = width;
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
      const length = Math.hypot(x1 - x0, y1 - y0);
      const nx = (y1 - y0) / length;
      const ny = (x0 - x1) / length;
      const step = width * 3.4;
      c.lineWidth = width * 0.7;
      for (let t = step; t < length; t += step) {
        const px = x0 + ((x1 - x0) * t) / length;
        const py = y0 + ((y1 - y0) * t) / length;
        c.beginPath();
        c.moveTo(px - nx * width * 1.7, py - ny * width * 1.7);
        c.lineTo(px + nx * width * 1.7, py + ny * width * 1.7);
        c.stroke();
      }
    };
    if (head) {
      for (const x of [0.012, 0.988]) stitch(x * w, h * 0.42, x * w, h, w * 0.008);
      return;
    }
    // patches sewn on, and seams that hold nothing together
    for (let i = 0; i < 26; i++) {
      const x = random() * w;
      const y = random() * h;
      const pw = (0.05 + random() * 0.12) * w;
      const ph = (0.04 + random() * 0.1) * h;
      c.save();
      c.translate(x, y);
      c.rotate((random() - 0.5) * 0.9);
      const tone = random() < 0.5 ? 'rgba(20,16,10,' : 'rgba(170,160,135,';
      c.fillStyle = `${tone}${0.12 + random() * 0.14})`;
      c.fillRect(-pw / 2, -ph / 2, pw, ph);
      const width = w * 0.0035;
      stitch(-pw / 2, -ph / 2, pw / 2, -ph / 2, width);
      stitch(pw / 2, -ph / 2, pw / 2, ph / 2, width);
      stitch(pw / 2, ph / 2, -pw / 2, ph / 2, width);
      stitch(-pw / 2, ph / 2, -pw / 2, -ph / 2, width);
      c.restore();
    }
    for (let i = 0; i < 18; i++) {
      const x = random() * w;
      const y = random() * h;
      const a = random() * 6.28;
      const l = (0.06 + random() * 0.2) * w;
      stitch(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, w * 0.0035);
    }
  });
  texture.flipY = source.flipY;
  texture.wrapS = source.wrapS;
  texture.wrapT = source.wrapT;
  return texture;
}

/** How far under the crown a neck lies on these bodies (m). */
const NECK_BELOW = 0.235;

/** Where a head lies in a baked body: the middle of the neck and of the crown. */
function headOf(crowd: Crowd): { neck: Vector3; crown: Vector3 } {
  const neck = new Vector3();
  const crown = new Vector3();
  for (const child of crowd.root.children) {
    const mesh = child as InstancedMesh;
    if (!/head/.test((mesh.material as Material).name)) continue;
    const p = mesh.geometry.getAttribute('position');
    let high = -Infinity;
    for (let i = 0; i < p.count; i++) high = Math.max(high, p.getY(i));
    let lows = 0;
    let highs = 0;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y > high - NECK_BELOW - 0.02 && y < high - NECK_BELOW + 0.02) {
        neck.x += p.getX(i);
        neck.y += y;
        neck.z += p.getZ(i);
        lows++;
      }
      if (y > high - 0.03) {
        crown.x += p.getX(i);
        crown.y += y;
        crown.z += p.getZ(i);
        highs++;
      }
    }
    neck.multiplyScalar(1 / Math.max(1, lows));
    crown.multiplyScalar(1 / Math.max(1, highs));
  }
  return { neck, crown };
}

/** The back of a baked body, as z at each height: smooth, so that hair can lie along it. */
function backOf(crowd: Crowd, neck: Vector3): (y: number) => number {
  const STEP = 0.05;
  const levels = new Map<number, number>();
  for (const child of crowd.root.children) {
    const p = (child as InstancedMesh).geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getX(i) - neck.x) > 0.17) continue;
      const level = Math.round(p.getY(i) / STEP);
      levels.set(level, Math.min(levels.get(level) ?? Infinity, p.getZ(i)));
    }
  }
  const at = (level: number) => Math.min(levels.get(level - 1) ?? Infinity, levels.get(level) ?? Infinity, levels.get(level + 1) ?? Infinity);
  return (y) => {
    const f = y / STEP;
    const low = Math.floor(f);
    const a = at(low);
    const b = at(low + 1);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return neck.z - 0.14;
    return a + (b - a) * (f - low);
  };
}

/** Long white hair escaping from under a sack and lying down a back: in the body's own space. */
function napeHair(seed: number, neck: Vector3, back: (y: number) => number): BufferGeometry {
  const random = randomFrom(seed);
  const positions: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  const strands = 60;
  const segments = 8;
  let base = 0;
  for (let s = 0; s < strands; s++) {
    const spread = (random() - 0.5) * 0.2;
    const fall = 0.14 + random() * random() * 0.72;
    const w0 = 0.0011 + random() * 0.0022;
    const wander = (random() - 0.5) * 0.11;
    const lift = 0.012 + random() * 0.018;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const y = neck.y + 0.02 - t * fall;
      const x = neck.x + spread * (0.25 + t * 0.75) + wander * t * t + Math.sin(t * 5 + s) * 0.005;
      const z = Math.min(back(y), neck.z - 0.055 * Math.sqrt(1 - t * 0.5)) - lift;
      const w = w0 * (1 - t * 0.7);
      positions.push(x + w, y, z, x - w, y, z);
      normals.push(0, 0.25, -1, 0, 0.25, -1);
      if (i < segments) {
        const b = base + i * 2;
        index.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
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

/** A few long hairs lying on a seat, from whoever sat there. */
function looseHairs(): BufferGeometry {
  const random = randomFrom(8);
  const positions: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  let base = 0;
  const segments = 22;
  for (let s = 0; s < 5; s++) {
    let x = (random() - 0.5) * 0.3;
    let z = (random() - 0.5) * 0.26;
    let heading = random() * 6.28;
    let bend = (random() - 0.5) * 7;
    const step = (0.3 + random() * 0.32) / segments;
    for (let i = 0; i <= segments; i++) {
      const nx = Math.sin(heading) * 0.0005;
      const nz = -Math.cos(heading) * 0.0005;
      positions.push(x + nx, 0, z + nz, x - nx, 0, z - nz);
      normals.push(0, 1, 0, 0, 1, 0);
      if (i < segments) {
        const b = base + i * 2;
        index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
      bend += (random() - 0.5) * 2.2;
      heading += bend * step;
      x += Math.cos(heading) * step;
      z += Math.sin(heading) * step;
    }
    base += (segments + 1) * 2;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setIndex(index);
  return g;
}

/** Years of people on a plastic seat: where they sat it is darker. */
function drawSeatWear(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(23);
  const g = c.createRadialGradient(w / 2, h * 0.55, h * 0.05, w / 2, h * 0.55, h * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0.42)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    c.fillStyle = `rgba(0,0,0,${0.12 + random() * 0.3})`;
    c.beginPath();
    c.ellipse(random() * w, random() * h, 0.5 + random() * 3, 0.4 + random() * 1.5, random() * 3, 0, Math.PI * 2);
    c.fill();
  }
}

/** What is painted black takes no light at all: a hollow stays a hole under a flash gun. */
function hollowed(m: MeshStandardMaterial): void {
  const before = m.onBeforeCompile;
  const key = m.customProgramCacheKey();
  m.onBeforeCompile = (shader, renderer) => {
    before.call(m, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `outgoingLight *= smoothstep(0.003, 0.016, diffuseColor.r);
    #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `${key}-hollow`;
}

/** The neck as a body, not a ribbon: fullest where it faces you and dark at its sides, ringed round like a worm. */
function fleshed(m: MeshStandardMaterial): void {
  const before = m.onBeforeCompile;
  const key = m.customProgramCacheKey();
  m.onBeforeCompile = (shader, renderer) => {
    before.call(m, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
    float neckFacing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
    float neckRing = 1.0 - ${NECK_RING_DEPTH.toFixed(3)} * pow(0.5 + 0.5 * cos(vMapUv.x * ${(NECK_RINGS * Math.PI * 2).toFixed(4)}), 6.0);
    totalEmissiveRadiance *= mix(${NECK_EDGE.toFixed(3)}, 1.0, sqrt(neckFacing)) * neckRing;
    diffuseColor.rgb *= neckRing;`,
    );
  };
  m.customProgramCacheKey = () => `${key}-flesh`;
}

/** The skin of the head opens where the mouth is; the lip of the mouth covers the cut. */
function openForMouth(m: MeshStandardMaterial): void {
  const before = m.onBeforeCompile;
  const key = m.customProgramCacheKey();
  m.onBeforeCompile = (shader, renderer) => {
    before.call(m, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHeadLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeadLocal = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHeadLocal;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
  if (vHeadLocal.z > 0.0 && length(vec2(vHeadLocal.x / ${HOLE_W.toFixed(4)}, (vHeadLocal.y - ${HOLE_Y.toFixed(4)}) / ${HOLE_H.toFixed(4)})) < ${MOUTH_CUT.toFixed(3)}) discard;`,
      );
  };
  m.customProgramCacheKey = () => `${key}-mouth`;
}

/** How far in front of its middle the skin of the head lies at (x, y) (m): the egg that headShape turns. */
function headFront(x: number, y: number): number {
  const a = Math.acos(Math.min(1, Math.max(-1, -y / HEAD_H)));
  const r = HEAD_R * Math.sin(a) * (1 - 0.16 * Math.cos(a));
  return Math.sqrt(Math.max(0, r * r - x * x));
}

/** A point of the mouth on ring s (0..1 of the hole), turned a (rad) from the side, as high above the skin as its profile says. */
function mouthPoint(s: number, a: number, out: Vector3): Vector3 {
  let lift = MOUTH_PROFILE[MOUTH_PROFILE.length - 1][1];
  for (let i = 1; i < MOUTH_PROFILE.length; i++) {
    const [s0, l0] = MOUTH_PROFILE[i - 1];
    const [s1, l1] = MOUTH_PROFILE[i];
    if (s >= s1) {
      lift = l1 + ((l0 - l1) * (s - s1)) / (s0 - s1);
      break;
    }
  }
  const x = HOLE_W * s * Math.cos(a);
  const y = HOLE_Y + HOLE_H * s * Math.sin(a);
  return out.set(x, y, headFront(x, y) + lift);
}

/** A lamprey's mouth where the hole was: a lip of wet flesh standing out of the skin, a funnel down to a black throat, rows of teeth pointing in. */
function lampreyMouth(flesh: Material, tooth: Material, black: Material): Group {
  const around = 40;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const p = new Vector3();
  const c = new Color();
  MOUTH_PROFILE.forEach(([s, , hex], k) => {
    c.setHex(hex);
    for (let j = 0; j < around; j++) {
      mouthPoint(s, (j / around) * Math.PI * 2, p);
      pos.push(p.x, p.y, p.z);
      col.push(c.r, c.g, c.b);
      if (k === 0) continue;
      const next = (j + 1) % around;
      idx.push((k - 1) * around + j, (k - 1) * around + next, k * around + next, (k - 1) * around + j, k * around + next, k * around + j);
    }
  });
  const funnel = new BufferGeometry();
  funnel.setAttribute('position', new Float32BufferAttribute(pos, 3));
  funnel.setAttribute('color', new Float32BufferAttribute(col, 3));
  funnel.setIndex(idx);
  funnel.computeVertexNormals();

  const count = MOUTH_ROWS.reduce((sum, row) => sum + row[1], 0);
  const teeth = new InstancedMesh(new CylinderGeometry(0, 1, 1, 6).translate(0, 0.5, 0), tooth, count);
  const m = new Matrix4();
  const q = new Quaternion();
  const dir = new Vector3();
  const size = new Vector3();
  let n = 0;
  const jitter = (k: number): number => {
    const h = Math.sin((n + 1) * 12.9898 + k * 78.233) * 43758.5453;
    return h - Math.floor(h);
  };
  MOUTH_ROWS.forEach(([s, many, long], row) => {
    for (let i = 0; i < many; i++) {
      const a = ((i + (row % 2) * 0.5 + (jitter(1) - 0.5) * 0.35) / many) * Math.PI * 2;
      mouthPoint(s, a, p);
      dir.set(-Math.cos(a) * HOLE_W, -Math.sin(a) * HOLE_H, 0).normalize();
      dir.z = TOOTH_RAISE;
      dir.normalize();
      const h = long * (0.75 + 0.5 * jitter(2));
      p.addScaledVector(dir, -h * 0.15);
      teeth.setMatrixAt(n, m.compose(p, q.setFromUnitVectors(UP, dir), size.set(h * TOOTH_WIDTH, h, h * TOOTH_WIDTH)));
      n++;
    }
  });
  const deepest = MOUTH_PROFILE[MOUTH_PROFILE.length - 1][1];
  const throat = new SphereGeometry(1, 24, 16).scale(HOLE_W * THROAT, HOLE_H * THROAT, 0.004).translate(0, HOLE_Y, headFront(0, HOLE_Y) + deepest + 0.001);
  const mouth = new Group();
  mouth.add(new Mesh(funnel, flesh), teeth, new Mesh(throat, black));
  return mouth;
}

/** A head with nothing to it: an egg of skin, its seam at the back, the face at u = 0.5. */
function headShape(): BufferGeometry {
  const profile: Vector2[] = [];
  const steps = 22;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI;
    profile.push(new Vector2(Math.max(0.0001, HEAD_R * Math.sin(a) * (1 - 0.16 * Math.cos(a))), -HEAD_H * Math.cos(a)));
  }
  return new LatheGeometry(profile, 32).rotateY(Math.PI);
}

/** The skin of that head: the neck's own, sinking in around the hole and sewn round it. */
function drawHeadSkin(c: CanvasRenderingContext2D, w: number, h: number, skin: CanvasImageSource): void {
  c.drawImage(skin, 0, 0, w, h);
  const rx = (w * HOLE_W) / (Math.PI * 2 * HEAD_R);
  const ry = (h * HOLE_H) / (Math.PI * 0.1155);
  const cx = w / 2;
  const cy = h * (0.5 - HOLE_Y / (Math.PI * 0.1155));
  c.save();
  c.translate(cx, cy);
  c.scale(rx, ry);
  const g = c.createRadialGradient(0, 0, 0.8, 0, 0, 1.6);
  g.addColorStop(0, 'rgba(14,9,7,0.92)');
  g.addColorStop(0.4, 'rgba(14,9,7,0.45)');
  g.addColorStop(1, 'rgba(14,9,7,0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, 1.6, 0, Math.PI * 2);
  c.fill();
  c.restore();
  c.strokeStyle = 'rgba(16,10,8,0.9)';
  c.lineWidth = 2.4;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 11) {
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * rx * 0.92, cy + Math.sin(a) * ry * 0.92);
    c.lineTo(cx + Math.cos(a + 0.09) * rx * 1.3, cy + Math.sin(a + 0.09) * ry * 1.3);
    c.stroke();
  }
}

/** A sack is tied at the neck: the cord, and the gathered cloth flaring under it. */
function tiedNeck(): { cord: BufferGeometry; flare: BufferGeometry } {
  const cord = new TorusGeometry(0.072, 0.0065, 6, 24).rotateX(Math.PI / 2);
  const profile = [[0.066, 0.012], [0.07, -0.005], [0.096, -0.04], [0.13, -0.085]].map(([r, y]) => new Vector2(r, y));
  const flare = new LatheGeometry(profile, 20);
  const p = flare.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    // gathered: the hem falls in folds
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const grow = Math.max(0, -p.getY(i)) / 0.085;
    const fold = 1 + grow * 0.13 * Math.sin(a * 9 + Math.sin(a * 3) * 2);
    p.setXYZ(i, p.getX(i) * fold, p.getY(i) * (1 + grow * 0.25 * Math.sin(a * 5 + 1)), p.getZ(i) * fold);
  }
  flare.computeVertexNormals();
  return { cord, flare };
}

/** A person: where they sit, in which crowd, and what is tied on them. */
interface Sitter {
  crowd: number;
  index: number;
  x: number;
  z: number;
  heading: number;
}

const zero = new Matrix4().makeScale(0, 0, 0);
const m4 = new Matrix4();
const m5 = new Matrix4();
const m6 = new Matrix4();
const q4 = new Quaternion();
const q5 = new Quaternion();
const q6 = new Quaternion();
const q7 = new Quaternion();
const v4 = new Vector3();
const v5 = new Vector3();
const v6 = new Vector3();
const ONE = new Vector3(1, 1, 1);
const UP = new Vector3(0, 1, 0);
const XAXIS = new Vector3(1, 0, 0);
const ZAXIS = new Vector3(0, 0, 1);

/**
 * The municipal hall where you wait with a ticket in the seat beside you. Rows of joined seats run to a frosted
 * window under a red number; one panel is alive in the ceiling. The number climbs and people are simply gone.
 * The light comes to you, and then the dark does, one relay at a time. Your number comes up. They all turn round.
 */
export default class WaitingRoom extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x081210, density: 0.03 },
    env: 'evening',
    envIntensity: ENV,
    sky: 0,
    grade: { exposure: 1.3, saturation: 0.78, warmth: -0.03, tint: -0.03, flare: 0.002 },
  };
  film = { bloom: 0.9, bloomFrom: 0.7, grain: 0.42, scratches: 0.1, flicker: 0.02, weave: 0.0004, ghost: 0 };
  focus = 11;
  aperture = 3;
  drift = 0.25;
  fear = 0.22;

  private readonly clocks: { value: number }[] = [];
  private readonly rowGlow: MeshStandardMaterial[] = [];
  private readonly aliveGlow: MeshStandardMaterial;
  private readonly rowFills: { intensity: number }[] = [];
  private readonly windowFill: { intensity: number };
  private readonly nearFill: { intensity: number };
  private readonly exitFill: { intensity: number };
  private readonly backFill: { intensity: number };
  private readonly redFill: { intensity: number };
  private readonly spotsHall: Room['spots'];
  private readonly spotsFacing: Room['spots'];
  private readonly numbers: Mesh[] = [];
  private readonly centerPane: Mesh;
  private readonly paneGlow: MeshStandardMaterial;
  private readonly sideGlow: MeshStandardMaterial;
  private readonly behindGlass: Mesh;
  private readonly officeLight: MeshBasicMaterial;
  private readonly openBeam: Mesh;
  private readonly openHalo: Mesh;
  private readonly exitGlow: MeshStandardMaterial;
  private readonly cloth: MeshStandardMaterial[] = [];
  private readonly seatPlastic: MeshStandardMaterial[] = [];
  private readonly floorPaint: MeshStandardMaterial;
  private readonly owned: (Material | Texture)[] = [];
  private readonly hairCloth: MeshStandardMaterial;
  private readonly flareCloth: MeshStandardMaterial;
  private readonly clockHands: ClockHand[][] = [];
  private readonly hallGlow: Mesh;
  private readonly hallBeam: Mesh;

  private readonly seated: Crowd[];
  private readonly sitters: Sitter[] = [];
  private readonly heads: Matrix4[];
  private readonly ties: InstancedMesh[];
  private readonly hairs: InstancedMesh;
  private readonly turned: Crowd[];
  private readonly turners: Sitter[] = [];
  private readonly turnedHeads: Matrix4[];
  private readonly turnedTies: InstancedMesh[];
  private readonly beside: HeroFigure;
  private readonly besideBones: Bone[];
  private readonly besideRest: Quaternion[];
  private readonly besideFace: Vector3;
  private readonly besideAt = new Vector3();
  private readonly standing: Crowd;
  private readonly self: Crowd;
  private readonly seen = { gone1: false, gone2: false, beside: false, behind: false, self: false };
  private readonly state = { gone1: false, gone2: false, turned: false, close: false };

  private readonly neck: Mesh;
  private readonly neckClock: { value: number };
  private readonly neckCurve: CatmullRomCurve3;
  private readonly neckLength: number;
  private readonly neckSegments: number;
  private readonly neckRadial: number;
  private readonly neckHead: Group;
  private readonly neckSkin: Texture;
  private readonly headLight: { position: Vector3; intensity: number };

  private readonly beds: RoomVoice[] = [];
  private readonly bedHeard = new Float32Array(BEDS.length);
  private readonly bedWanted = new Float32Array(BEDS.length);
  private lastHeart = 0;

  constructor(ctx: RoomContext) {
    super(ctx);
    const S = this.seconds;
    const pose = (s: number, at: V3, yaw: number, pitch: number, fov: number): RoomKey => ({ t: s / S, at, yaw, pitch, fov });
    const ticketEye: V3 = [0.03, 1.13, -0.07];
    // with reduced motion the eye only gets up, and the neck has further to come
    const travel = REDUCED_MOTION ? 0.2 : 1;
    this.keys = [
      pose(0, EYE, 0, 0.4, 46),
      pose(4.4, EYE, 0, 0.4, 46),
      pose(6.9, ticketEye, -79, -49, 27),
      pose(9.4, ticketEye, -80, -50, 26),
      pose(12.2, EYE, 0, 0.4, 46),
      pose(DING_33, EYE, 0, 0.4, 44),
      pose(RISE_AT, EYE, 0, 0.4, 43),
      pose(53, [0, 1.46, -0.7 * travel], 0, -1, 42),
      pose(CUT_AT, [0, 1.62, -3.9 * travel], 0, 0, 40),
      pose(S, [0, 1.62, -4.3 * travel], 0, 0, 40),
    ];

    if (!REDUCED_MOTION) {
      this.warp = [
        { at: 0, bendUp: 0, bendAside: 0, twist: 0, wave: 0 },
        { at: TURN_AT / S, bendUp: 0, bendAside: 0, twist: 0, wave: 0 },
        { at: WINDOW_AT / S, bendUp: STARE_BEND, bendAside: 0, twist: STARE_TWIST, wave: 0 },
        { at: 1, bendUp: STARE_BEND * 1.5, bendAside: 0, twist: -STARE_TWIST, wave: 0 },
      ];
    }

    const b = this.build;
    const k = this.kit;
    const root = this.root;
    const length = BACK_Z - FAR_Z;
    const midZ = (BACK_Z + FAR_Z) / 2;

    // the shell: bone tile to the shoulder, damp pale green over it
    const paint = k.surface('plaster_pale', 2, { color: new Color(0x86bca0), roughness: 0.82 });
    const tile = k.surface('tile_bone', 1.1, { color: new Color(0xb3c8bc), roughness: 0.36 });
    const checker = b.checker(0.6) as MeshStandardMaterial;
    checker.color.set(0xaebdb2);
    this.floorPaint = checker;
    root.add(k.floor(-HALF_W, HALF_W, FAR_Z, BACK_Z, 0, checker));
    const acoustic = b.ceiling(0.6) as MeshStandardMaterial;
    acoustic.map!.offset.x = 0.5;
    acoustic.color.set(0xd6e0d6);
    const ceiling = k.floor(-HALF_W, HALF_W, FAR_Z, BACK_Z, H, acoustic);
    ceiling.rotation.x = Math.PI / 2;
    root.add(ceiling);
    for (const side of [-1, 1]) {
      b.wall(side * HALF_W, midZ, length, TILE_TO, side > 0 ? '-x' : '+x', tile, root);
      b.wall(side * HALF_W, midZ, length, H - TILE_TO, side > 0 ? '-x' : '+x', paint, root, TILE_TO);
    }
    b.wall(0, BACK_Z, HALF_W * 2, TILE_TO, '-z', tile, root);
    b.wall(0, BACK_Z, HALF_W * 2, H - TILE_TO, '-z', paint, root, TILE_TO);

    // grime that is not a repeating image
    const grime = (w: number, h: number, map: Texture): Mesh => {
      const mesh = new Mesh(new PlaneGeometry(w, h, Math.ceil(w / BEND_STEP), Math.ceil(h / BEND_STEP)), new MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      root.add(mesh);
      return mesh;
    };
    const floorGrime = grime(HALF_W * 2, length, canvasOf(768, 1536, drawFloorGrime));
    floorGrime.rotation.x = -Math.PI / 2;
    floorGrime.position.set(0, 0.003, midZ);
    const ceilingGrime = grime(HALF_W * 2, length, canvasOf(1024, 2048, drawCeilingGrime));
    ceilingGrime.rotation.x = Math.PI / 2;
    ceilingGrime.position.set(0, H - 0.004, midZ);
    for (const side of [-1, 1]) {
      const wallDamp = grime(length, H, canvasOf(2048, 300, (c, w, h) => drawDamp(c, w, h, 21 + side, length)));
      wallDamp.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      wallDamp.position.set(side * (HALF_W - 0.004), H / 2, midZ);
    }
    const backDamp = grime(HALF_W * 2, H, canvasOf(1024, 300, (c, w, h) => drawDamp(c, w, h, 31, HALF_W * 2)));
    backDamp.rotation.y = Math.PI;
    backDamp.position.set(0, H / 2, BACK_Z - 0.004);

    this.buildTrim(tile, paint);
    this.buildSeats();

    // the ceiling's panels: a material for each row, so that each can be switched by its own relay
    const diffuser = canvasOf(128, 256, drawDiffuser);
    const panelMaterial = (intensity: number) => new MeshStandardMaterial({ map: diffuser, color: 0xb7bbae, roughness: 0.55, emissive: new Color(0xd8efe2), emissiveMap: diffuser, emissiveIntensity: intensity });
    const frames: BufferGeometry[] = [];
    const panel = (x: number, z: number) => new PlaneGeometry(0.6, 1.2).rotateX(Math.PI / 2).translate(x, H - 0.016, z);
    PANEL_Z.forEach((z, r) => {
      const parts: BufferGeometry[] = [];
      for (const x of PANEL_X) {
        if (!(r === ALIVE_ROW && x === 0)) parts.push(panel(x, z));
        for (const [w, d, px, pz] of [[0.66, 0.03, x, z - 0.615], [0.66, 0.03, x, z + 0.615], [0.03, 1.26, x - 0.315, z], [0.03, 1.26, x + 0.315, z]]) frames.push(meterUVs(new BoxGeometry(w, 0.024, d)).translate(px, H - 0.012, pz));
      }
      const material = panelMaterial(0);
      const mesh = new Mesh(mergeGeometries(parts)!, material);
      mesh.frustumCulled = false;
      root.add(mesh);
      this.rowGlow.push(material);
    });
    this.aliveGlow = panelMaterial(ALIVE_GLOW);
    const aliveMesh = new Mesh(panel(0, PANEL_Z[ALIVE_ROW]), this.aliveGlow);
    aliveMesh.frustumCulled = false;
    root.add(aliveMesh);
    const frameMesh = new Mesh(mergeGeometries(frames)!, new MeshStandardMaterial({ color: 0x26291f, roughness: 0.5, metalness: 0.4 }));
    frameMesh.frustumCulled = false;
    root.add(frameMesh);

    // far end: wall above and at both ends of the glass, the counter, the glass
    b.wall(0, FAR_Z, HALF_W * 2, H - GLASS_TOP, '+z', paint, root, GLASS_TOP);
    for (const side of [-1, 1]) b.wall((side * (HALF_W + PANE_W * 1.5)) / 2, FAR_Z, HALF_W - PANE_W * 1.5, GLASS_TOP - SILL, '+z', paint, root, SILL);
    const counter = k.block(HALF_W * 2, SILL, 0.56, b.wood(1.2));
    counter.position.set(0, SILL / 2, FAR_Z + 0.28);
    root.add(counter);
    const ledge = k.block(HALF_W * 2, 0.04, 0.62, new MeshStandardMaterial({ color: 0x6b6a5a, roughness: 0.42 }));
    ledge.position.set(0, SILL + 0.02, FAR_Z + 0.29);
    root.add(ledge);
    const frost = canvasOf(512, 256, (c) => {
      const g = c.createRadialGradient(256, 150, 20, 256, 130, 320);
      g.addColorStop(0, '#fff0cf');
      g.addColorStop(0.55, '#e8c68e');
      g.addColorStop(1, '#8d6c3f');
      c.fillStyle = g;
      c.fillRect(0, 0, 512, 256);
      c.strokeStyle = 'rgba(40,30,16,0.16)';
      c.lineWidth = 1;
      for (let i = 12; i < 512; i += 24) {
        c.beginPath();
        c.moveTo(i, 0);
        c.lineTo(i, 256);
        c.stroke();
      }
      for (let i = 12; i < 256; i += 24) {
        c.beginPath();
        c.moveTo(0, i);
        c.lineTo(512, i);
        c.stroke();
      }
    });
    const glass = (intensity: number) => new MeshStandardMaterial({ color: 0x151310, map: frost, roughness: 0.3, emissive: new Color(0xffffff), emissiveMap: frost, emissiveIntensity: intensity });
    this.paneGlow = glass(GLASS_GLOW);
    this.sideGlow = glass(SIDE_GLOW);
    this.sideGlow.emissive.setRGB(0.55, 0.8, 0.8);
    const paneH = GLASS_TOP - SILL;
    this.centerPane = new Mesh(new PlaneGeometry(PANE_W, paneH), this.paneGlow);
    this.centerPane.position.set(0, SILL + paneH / 2, FAR_Z + 0.015);
    this.centerPane.frustumCulled = false;
    root.add(this.centerPane);
    for (const side of [-1, 1]) {
      const pane = new Mesh(new PlaneGeometry(PANE_W, paneH), this.sideGlow);
      pane.position.set(side * PANE_W, SILL + paneH / 2, FAR_Z + 0.03);
      pane.frustumCulled = false;
      root.add(pane);
    }
    this.behindGlass = new Mesh(new PlaneGeometry(0.9, paneH), new MeshBasicMaterial({ map: canvasOf(128, 256, drawBehindGlass), transparent: true, depthWrite: false, opacity: 0.7 }));
    this.behindGlass.position.set(0.5, SILL + paneH / 2, FAR_Z + 0.019);
    this.behindGlass.frustumCulled = false;
    root.add(this.behindGlass);
    const bars: BufferGeometry[] = [];
    const bar = (w: number, h: number, x: number, y: number) => bars.push(meterUVs(new BoxGeometry(w, h, 0.07, Math.ceil(w / BEND_STEP))).translate(x, y, FAR_Z + 0.05));
    for (const x of [-PANE_W * 1.5, -PANE_W * 0.5, PANE_W * 0.5, PANE_W * 1.5]) bar(0.09, paneH, x, SILL + paneH / 2);
    bar(HALF_W * 2, 0.1, 0, GLASS_TOP);
    const windowFrame = new Mesh(mergeGeometries(bars)!, new MeshStandardMaterial({ color: 0x14130f, roughness: 0.5 }));
    windowFrame.frustumCulled = false;
    root.add(windowFrame);

    // the office behind: only ever seen once the glass has slid away
    this.officeLight = new MeshBasicMaterial({ color: 0x000000, transparent: true, map: canvasOf(64, 64, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h * 0.45, 2, w / 2, h / 2, w * 0.7);
      g.addColorStop(0, '#fff6e4');
      g.addColorStop(1, '#a8834e');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }) });
    const office = new Mesh(new PlaneGeometry(5, 3), this.officeLight);
    office.position.set(0, 1.5, FAR_Z - 2.3);
    office.frustumCulled = false;
    root.add(office);
    const cabinets = k.props('filing_cabinet', 4);
    cabinets.set(0, -1.05, 0, FAR_Z - 2.1, 0);
    cabinets.set(1, -0.5, 0, FAR_Z - 2.1, 0);
    cabinets.set(2, 1.2, 0, FAR_Z - 2.1, 0);
    cabinets.set(3, 4.72, 0, -17.7, -Math.PI / 2);
    cabinets.commit();
    root.add(cabinets.root);
    this.openBeam = b.beam(0, 0, 0, 1.05, 2.3, 13, 0xffe2b8, 0, root);
    this.openBeam.rotation.x = -Math.PI / 2;
    this.openBeam.position.set(0, 1.7, FAR_Z + 6.5);
    this.openHalo = b.glow(0, 1.65, FAR_Z + 0.6, 5.5, 0xffdcb0, 0.5, root);
    this.openHalo.visible = false;

    // the number
    const housing = k.block(1.56, 0.72, 0.12, new MeshStandardMaterial({ color: 0x050505, roughness: 0.4 }));
    housing.position.set(0, 2.65, FAR_Z + 0.07);
    root.add(housing);
    for (const value of [17, 18, 19, 33]) {
      const label = b.label(1.4, 0.6, (lc, w, h) => {
        lc.fillStyle = '#050100';
        lc.fillRect(0, 0, w, h);
        const dh = h * 0.84;
        const dw = dh * 0.56;
        drawSeven(lc, Math.floor(value / 10), w / 2 - dw - h * 0.05, h * 0.08, dw, dh);
        drawSeven(lc, value % 10, w / 2 + h * 0.05, h * 0.08, dw, dh);
      }, { emissive: 3.2, px: 256 });
      label.mesh.position.set(0, 2.65, FAR_Z + 0.135);
      label.mesh.visible = value === 17;
      root.add(label.mesh);
      this.numbers.push(label.mesh);
    }
    b.glow(0, 2.65, FAR_Z + 0.3, 2.2, 0xff2c12, 0.16, root);

    // half past, as everywhere in this house
    this.clockHands.push(rigClock(k.prop('wall_clock', [-3.5, 2.66, FAR_Z + 0.03], { scale: 2, anchor: 'center' }, root)));
    this.clockHands.push(rigClock(k.prop('wall_clock', [0, 1.69, BACK_Z - 0.03], { scale: 1.5, anchor: 'center', rotation: [0, 180, 0] }, root)));

    // the people
    this.hairCloth = new MeshStandardMaterial({ color: 0xa8a69c, roughness: 0.62, emissive: new Color(0xe8e4d8), emissiveIntensity: 0 });
    const seat = (side: number, n: number) => side * (AISLE + SEAT * (0.5 + n));
    this.seated = [
      b.sack(11, { clip: 'm_sit_chair_idle_roll_head', time: 4.2 }),
      b.sack(9, { clip: 'm_sit_chair_idle_roll_head', time: 5.6 }),
      b.sack(3, { clip: 'm_sit_chair_idle_roll_head', time: 2.8 }),
    ];
    const tieAt = (crowd: Crowd) => {
      const { neck, crown } = headOf(crowd);
      q4.setFromUnitVectors(UP, v4.subVectors(crown, neck).normalize());
      return new Matrix4().compose(v5.copy(neck).addScaledVector(v4, 0.012), q4, ONE);
    };
    this.heads = this.seated.map(tieAt);
    const neckOfFirst = headOf(this.seated[0]).neck;
    const { cord, flare } = tiedNeck();
    const cordCloth = new MeshStandardMaterial({ color: 0x14100a, roughness: 0.9 });
    const flareCloth = new MeshStandardMaterial({ color: 0x56564c, roughness: 1, emissive: new Color(0x8fa89f), emissiveIntensity: 0 });
    this.flareCloth = flareCloth;
    const tiesOf = (count: number) => [new InstancedMesh(cord, cordCloth, count), new InstancedMesh(flare, flareCloth, count)];
    this.ties = tiesOf(SCATTER.length);
    this.hairs = new InstancedMesh(napeHair(3, neckOfFirst, backOf(this.seated[0], neckOfFirst)), this.hairCloth, SCATTER.length);
    this.hairs.frustumCulled = false;
    this.hairs.receiveShadow = true;
    for (const tie of this.ties) {
      tie.frustumCulled = false;
      tie.receiveShadow = true;
      root.add(tie);
    }
    root.add(this.hairs);
    const random = randomFrom(77);
    const used = [0, 0, 0];
    SCATTER.forEach(([row, side, n], i) => {
      const crowd = i === 0 ? 0 : i % 7 === 3 ? 2 : i % 2;
      const sitter: Sitter = { crowd, index: used[crowd]++, x: seat(side, n), z: -row * ROW_STEP + SIT_BACK, heading: Math.PI + (random() - 0.5) * 0.14 };
      this.sitters.push(sitter);
      this.seatPerson(i, sitter, true);
    });
    this.seated.forEach((crowd, i) => {
      crowd.drawn = used[i];
      crowd.commit();
      this.clothe(crowd.root);
      root.add(crowd.root);
    });
    for (const tie of this.ties) tie.instanceMatrix.needsUpdate = true;
    this.hairs.instanceMatrix.needsUpdate = true;

    // the one who comes to sit beside you: the only one here whose bones are its own
    this.beside = k.figures.hero({ avatar: 'figure_man', clip: 'm_sit_chair_idle_roll_head', time: 4.2, skin: 'sack', face: 'hollow', white: false });
    this.beside.update(4.2);
    const cards: Mesh[] = [];
    this.beside.root.traverse((o) => {
      if ((o as Mesh).isMesh && /opacity/.test(((o as Mesh).material as Material).name)) cards.push(o as Mesh);
    });
    for (const card of cards) card.removeFromParent();
    this.clothe(this.beside.root);
    this.beside.root.traverse((o) => {
      o.castShadow = false;
    });
    this.beside.bone('Bip01')!.getWorldPosition(v4);
    this.beside.root.rotation.y = Math.PI;
    this.besideAt.set(BESIDE_X + v4.x, HIPS - v4.y, SIT_BACK + v4.z);
    this.beside.root.position.copy(this.besideAt);
    this.beside.root.visible = false;
    root.add(this.beside.root);
    this.besideBones = BESIDE_CHAIN.map((name) => this.beside.bone(name)!);
    this.besideRest = this.besideBones.map((bone) => bone.quaternion.clone());
    // the hollow's way out of the head, in the head's own space: the pose bows it this far
    this.beside.root.updateWorldMatrix(true, true);
    this.besideFace = new Vector3(0, -Math.sin(BOWED), -Math.cos(BOWED)).applyQuaternion(this.besideBones[4].getWorldQuaternion(q4).invert());

    this.standing = b.sack(STANDING, { clip: 'm_idle_roll_head_01', time: 3.3 });
    this.clothe(this.standing.root);
    this.standing.root.visible = false;
    root.add(this.standing.root);
    this.placeStanding(STAND_Z, false);
    this.self = this.kit.figures.crowd({ avatar: 'figure_man', clip: 'm_sit_chair_idle_roll_head', time: 4.2, face: 'blank', tint: 0x5e6260, bleach: 0.7 }, 1);
    this.self.set(0, 0, 0, SIT_BACK, Math.PI);
    this.self.commit();
    for (const child of [...this.self.root.children]) {
      const mesh = child as InstancedMesh;
      const source = mesh.material as MeshStandardMaterial;
      if (/opacity/.test(source.name)) {
        mesh.removeFromParent();
        continue;
      }
      const m = source.clone();
      m.normalMap = null;
      m.emissive.setRGB(1, 1, 1);
      m.emissiveMap = m.map;
      m.emissiveIntensity = SELF_GLOW;
      hollowed(m);
      mesh.material = m;
      this.owned.push(m);
    }
    this.self.root.visible = false;
    root.add(this.self.root);

    // at the end: far more of them, turned round in their seats
    this.turned = [
      b.sack(48, { clip: 'm_sit_chair_idle_roll_head', time: 4.2 }),
      b.sack(20, { clip: 'm_sit_chair_idle_roll_head', time: 5.6 }),
    ];
    this.turnedHeads = this.turned.map(tieAt);
    const places: [number, number, number][] = SCATTER.filter((_, i) => i !== GONE_1 && i !== GONE_2).map((p) => [p[0], p[1], p[2]]);
    const taken = new Set(places.map((p) => p.join()));
    const fill = randomFrom(101);
    for (let tries = 0; places.length < TURNED && tries < 4000; tries++) {
      // nearer rows fill first, and the seats along the aisle before the rest
      const row = 2 + Math.floor(fill() * fill() * (ROWS - 1));
      const side = fill() < 0.5 ? -1 : 1;
      const n = Math.floor(fill() * fill() * 6);
      const place = `${row},${side},${n}`;
      if (taken.has(place)) continue;
      taken.add(place);
      places.push([row, side, n]);
    }
    this.turnedTies = tiesOf(places.length);
    for (const tie of this.turnedTies) {
      tie.frustumCulled = false;
      tie.receiveShadow = true;
      tie.visible = false;
      root.add(tie);
    }
    const usedTurned = [0, 0];
    places.forEach(([row, side, n], i) => {
      const crowd = i % 4 === 2 ? 1 : 0;
      this.turners.push({ crowd, index: usedTurned[crowd]++, x: seat(side, n), z: -row * ROW_STEP + SIT_BACK, heading: 0 });
    });
    this.turned.forEach((crowd, i) => {
      crowd.drawn = usedTurned[i];
      this.clothe(crowd.root, TURNED_CUT);
      crowd.root.visible = false;
      root.add(crowd.root);
    });
    this.faceTheEye(EYE[0], EYE[1], EYE[2]);

    // the neck
    const neck = b.neck(NECK_WAY, root, { radius: NECK_RADIUS, taper: NECK_TAPER, sway: NECK_SWAY });
    (neck.mesh.material as MeshStandardMaterial).color.setRGB(1, 1.08, 1.1);
    this.neck = neck.mesh;
    this.neck.castShadow = false;
    this.neck.visible = false;
    this.neckClock = neck.time;
    this.neckSkin = (this.neck.material as MeshStandardMaterial).map!;
    this.neckCurve = new CatmullRomCurve3(NECK_WAY.map((p) => new Vector3(...p)));
    this.neckLength = this.neckCurve.getLength();
    const tubeShape = (this.neck.geometry as TubeGeometry).parameters;
    this.neckSegments = tubeShape.tubularSegments;
    this.neckRadial = tubeShape.radialSegments;
    const neckMaterial = this.neck.material as MeshStandardMaterial;
    neckMaterial.emissive.setRGB(1, 1, 1);
    neckMaterial.emissiveMap = this.neckSkin;
    neckMaterial.emissiveIntensity = NECK_PALE;
    neckMaterial.roughness = NECK_GLOSS;
    fleshed(neckMaterial);
    // what it ends in: no sack, only the neck swelling shut around a hole sewn open
    const headMap = canvasOf(512, 256, (c, w, h) => drawHeadSkin(c, w, h, this.neckSkin.image as CanvasImageSource));
    this.owned.push(headMap);
    const skin = new MeshStandardMaterial({ map: headMap, roughness: 0.56, color: neckMaterial.color, emissive: new Color(0xffffff), emissiveMap: headMap, emissiveIntensity: HEAD_PALE });
    this.owned.push(skin);
    openForMouth(skin);
    const hole = new MeshBasicMaterial({ color: 0x000000 });
    this.owned.push(hole);
    const flesh = new MeshStandardMaterial({ vertexColors: true, roughness: MOUTH_WET, metalness: 0, emissive: new Color(MOUTH_GLOW) });
    const tooth = new MeshStandardMaterial({ color: TOOTH_COLOR, roughness: 0.35, metalness: 0, emissive: new Color(TOOTH_COLOR), emissiveIntensity: HEAD_PALE });
    this.owned.push(flesh, tooth);
    this.neckHead = new Group();
    this.neckHead.add(new Mesh(headShape(), skin), lampreyMouth(flesh, tooth, hole));
    this.neckHead.traverse((o) => {
      o.frustumCulled = false;
    });
    this.neckHead.visible = false;
    root.add(this.neckHead);

    this.buildDressing();

    // light
    this.spotsHall = [this.spot([0, H - 0.05, PANEL_Z[ALIVE_ROW]], [0, 0, PANEL_Z[ALIVE_ROW]], 0xc4ead4, KEY, 68, 0.85), this.spot([0, 0.25, PANEL_Z[ALIVE_ROW]], [0, H, PANEL_Z[ALIVE_ROW]], 0xb8d8c8, BOUNCE, 82, 1), this.spot([0, 0.2, -0.6], [0, H, -0.6], 0xa8c4c0, BOUNCE_NEAR, 80, 1)];
    this.spotsFacing = [this.spot(FACING_AT, [0, 1.2, -9], 0xd5e4e6, FACING_KEY, FACING_WIDE, 0.8), this.spot([0, 1.7, FAR_Z - 0.4], [0, 0.3, -2], 0xffdcb0, 0, 17, 0.6), this.spot(FACING_AT, [0, 1.12, -16], 0xd5e4e6, FACING_FAR, FACING_NARROW, 0.9)];
    this.spots = this.spotsHall;
    for (const z of PANEL_Z) this.rowFills.push(this.light([0, 2.05, z], 0xc4ead4, 0, 10));
    this.windowFill = this.light([0, 1.5, FAR_Z + 1.2], 0xffd39a, WINDOW_FILL, 8);
    this.nearFill = this.light([3.4, 2.35, -2.2], 0xa8c4cc, NEAR_FILL, 7);
    this.exitFill = this.light([3.4, 2.4, BACK_Z - 0.45], 0x4dff9a, EXIT_FILL, 4.5);
    this.backFill = this.light([-0.5, 1.75, 1], 0xb8d4d0, BACK_FILL, 3.6);
    this.redFill = this.light([0, 2.55, FAR_Z + 0.5], 0xff2c12, RED_FILL, 4);
    this.headLight = this.light([0, 2, FAR_Z], 0xd8ece6, 0, HEAD_LIGHT_REACH);

    this.exitGlow = (() => {
      const sign = b.label(0.56, 0.24, drawExit, { emissive: 1.8, px: 256 });
      sign.mesh.rotation.y = Math.PI;
      sign.mesh.position.set(3.4, 2.34, BACK_Z - 0.03);
      root.add(sign.mesh);
      return sign.mesh.material as MeshStandardMaterial;
    })();

    this.clocks.push(b.motes(190, { x: [-HALF_W + 0.3, HALF_W - 0.3], y: [0.2, H - 0.1], z: [FAR_Z + 0.6, BACK_Z - 0.3] }, root, { size: 0.006, strength: 0.32 }).time);
    this.hallGlow = b.glow(0, H - 0.08, PANEL_Z[ALIVE_ROW], 3.2, 0xc4ead4, 0.42, root);
    this.hallBeam = b.beam(0, H - 0.02, PANEL_Z[ALIVE_ROW], 0.5, 2.2, H - 0.1, 0xc4ead4, 0.06, root);

    // the clerk speaks in the dream's whisper
    this.beat(3, () => this.say({ tr: 'Numaran kaç?', en: 'What is your number?' }, 4.5, 'dream'));
    this.beat(SHUTTER_AT, () => this.shutter());
    this.beat(51, () => this.say({ tr: 'Sıra sende.', en: 'You are next.' }, 4, 'dream'));
    this.beat(0, () => {
      for (const [file, options] of BEDS) this.beds.push(this.sound.bed(file, { ...options, gain: 0 }));
    });
    for (const [at, file, options] of CUES) this.beat(at, () => this.sound.play(file, options));
  }

  /** Pilasters, the tile's cap, the skirting, pipes: what makes a wall a wall. */
  private buildTrim(tile: Material, paint: Material): void {
    const tiled: BufferGeometry[] = [];
    const painted: BufferGeometry[] = [];
    const dark: BufferGeometry[] = [];
    const box = (into: BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number) => into.push(meterUVs(new BoxGeometry(w, h, d, Math.ceil(w / BEND_STEP), 1, Math.ceil(d / BEND_STEP))).translate(x, y, z));
    const length = BACK_Z - FAR_Z;
    const midZ = (BACK_Z + FAR_Z) / 2;
    const depth = 0.17;
    for (const side of [-1, 1]) {
      for (const z of [-3.6, -7.2, -10.8, -14.4]) {
        box(tiled, depth, TILE_TO, 0.5, side * (HALF_W - depth / 2), TILE_TO / 2, z);
        box(painted, depth, H - TILE_TO, 0.5, side * (HALF_W - depth / 2), TILE_TO + (H - TILE_TO) / 2, z);
      }
      box(dark, 0.03, 0.05, length, side * (HALF_W - 0.015), TILE_TO, midZ);
      box(dark, 0.02, 0.13, length, side * (HALF_W - 0.01), 0.065, midZ);
      box(dark, 0.06, 0.1, length, side * (HALF_W - 0.03), H - 0.05, midZ);
    }
    box(dark, HALF_W * 2, 0.05, 0.03, 0, TILE_TO, BACK_Z - 0.015);
    box(dark, HALF_W * 2, 0.13, 0.02, 0, 0.065, BACK_Z - 0.01);
    box(dark, HALF_W * 2, 0.1, 0.06, 0, H - 0.05, BACK_Z - 0.03);
    // a conduit along the dark side, a thicker pipe on the side of the windows
    const pipes: BufferGeometry[] = [];
    const pipe = (x: number, y: number, r: number) => pipes.push(meterUVs(new CylinderGeometry(r, r, length, 10, Math.ceil(length / BEND_STEP)).rotateX(Math.PI / 2)).translate(x, y, midZ));
    pipe(-HALF_W + 0.07, 2.62, 0.025);
    pipe(-HALF_W + 0.07, 2.7, 0.018);
    pipe(HALF_W - 0.09, 2.86, 0.045);
    const add = (parts: BufferGeometry[], material: Material) => {
      const mesh = new Mesh(mergeGeometries(parts)!, material);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    };
    add(tiled, tile);
    add(painted, paint);
    add(dark, new MeshStandardMaterial({ color: 0x1c1f1b, roughness: 0.55 }));
    add(pipes, new MeshStandardMaterial({ color: 0x4f5549, roughness: 0.5, metalness: 0.2 }));
  }

  private buildSeats(): void {
    const seats = this.kit.props('seats_row', 5 + ROWS * 4, { castShadow: true, scale: SEAT_SCALE });
    let n = 0;
    for (let i = -2; i <= 2; i++) seats.set(n++, i * UNIT, 0, 0, Math.PI);
    for (let r = 1; r <= ROWS; r++) {
      const z = -r * ROW_STEP;
      for (const x of [-AISLE - UNIT * 1.5, -AISLE - UNIT * 0.5, AISLE + UNIT * 0.5, AISLE + UNIT * 1.5]) seats.set(n++, x, 0, z, Math.PI);
    }
    seats.commit();
    // the file's pale plastic is too clean for this hall
    seats.root.traverse((o) => {
      const mesh = o as InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      const m = (mesh.material as MeshStandardMaterial).clone();
      if (/plastic/.test(m.name)) {
        m.color.setRGB(0.27, 0.33, 0.3);
        this.seatPlastic.push(m);
      } else m.color.multiplyScalar(0.6);
      mesh.material = m;
    });
    this.root.add(seats.root);
  }

  /** Put person `i` of the hall in their seat, or take them out of it. */
  private seatPerson(i: number, p: Sitter, there: boolean): void {
    const crowd = this.seated[p.crowd];
    if (!there) {
      crowd.setMatrix(p.index, zero);
      for (const tie of this.ties) tie.setMatrixAt(i, zero);
      this.hairs.setMatrixAt(i, zero);
      return;
    }
    m4.compose(v4.set(p.x, HIPS, p.z), q4.setFromAxisAngle(UP, p.heading).multiply(q5.setFromAxisAngle(XAXIS, BOW)), ONE).multiply(m6.makeTranslation(0, -HIPS, 0));
    crowd.setMatrix(p.index, m4);
    this.hairs.setMatrixAt(i, m4);
    m5.multiplyMatrices(m4, this.heads[p.crowd]);
    for (const tie of this.ties) tie.setMatrixAt(i, m5);
  }

  /** Those who have turned round look at where the eye is, and lean back to look up at it when it rises. */
  private faceTheEye(x: number, y: number, z: number): void {
    const tilt = Math.max(0, y - EYE[1]) * LOOK_UP;
    q5.setFromAxisAngle(XAXIS, -tilt);
    m6.makeTranslation(0, -HIPS, 0);
    for (let i = 0; i < this.turners.length; i++) {
      const p = this.turners[i];
      p.heading = Math.atan2(x - p.x, z - p.z);
      m4.compose(v4.set(p.x, HIPS, p.z), q4.setFromAxisAngle(UP, p.heading).multiply(q5), ONE).multiply(m6);
      this.turned[p.crowd].setMatrix(p.index, m4);
      m5.multiplyMatrices(m4, this.turnedHeads[p.crowd]);
      for (const tie of this.turnedTies) tie.setMatrixAt(i, m5);
    }
    for (const crowd of this.turned) crowd.commit();
    for (const tie of this.turnedTies) tie.instanceMatrix.needsUpdate = true;
  }

  /** The neighbor: bowed as it came; after the black it has turned, and leans slowly in, its hollow on you. */
  private poseBeside(lean: number, eyeX: number, eyeY: number, eyeZ: number): void {
    const bones = this.besideBones;
    for (let i = 0; i < bones.length; i++) bones[i].quaternion.copy(this.besideRest[i]);
    this.beside.root.position.copy(this.besideAt);
    if (lean < 0) return;
    this.beside.root.position.x += lean * BESIDE_SLIDE;
    this.beside.root.position.z -= lean * BESIDE_FORWARD;
    this.beside.root.updateWorldMatrix(true, false);
    // the spine twists toward you and bends over, each joint a share of it
    for (let i = 0; i < 3; i++) {
      const bone = bones[i];
      bone.parent!.updateWorldMatrix(true, false);
      bone.parent!.getWorldQuaternion(q5);
      q6.copy(q5).multiply(bone.quaternion);
      q6.premultiply(q7.setFromAxisAngle(v5.set(-1, 0, 0), (BESIDE_LEAN_REST + lean * BESIDE_LEAN) / 3));
      q6.premultiply(q4.setFromAxisAngle(UP, BESIDE_TWIST[i]));
      bone.quaternion.copy(q5.invert()).multiply(q6);
    }
    // the head looks at you whatever the rest does
    const head = bones[4];
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(v4);
    v5.set(eyeX + this.origin.x, eyeY + this.origin.y, eyeZ + this.origin.z).sub(v4).normalize();
    head.getWorldQuaternion(q6);
    v6.copy(this.besideFace).applyQuaternion(q6);
    q7.setFromUnitVectors(v6, v5);
    head.parent!.getWorldQuaternion(q5);
    head.quaternion.copy(q5.invert()).multiply(q7).multiply(q6);
  }

  private placeStanding(z: number, aimed: boolean): void {
    for (let i = 0; i < STANDING; i++) {
      const x = (i - (STANDING - 1) / 2) * 0.64;
      const heading = aimed ? Math.atan2(EYE[0] - x, EYE[2] - z) : Math.PI;
      this.standing.set(i, x, 0, z, heading);
    }
    this.standing.commit();
  }

  /** Their cloth, dirtied, keeps a little light of its own when the rest has gone. */
  private clothe(body: Object3D, cut?: number): void {
    body.traverse((o) => {
      const mesh = o as InstancedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      const source = mesh.material as MeshStandardMaterial;
      if (!source.map) return;
      const known = this.cloth.find((m) => m.userData.source === source && m.userData.cut === cut);
      if (known) {
        mesh.material = known;
        return;
      }
      const sibling = this.cloth.find((m) => m.userData.source === source);
      const map = sibling ? sibling.map! : dirtied(source.map, /head/.test(source.name), source.name.length * 7);
      if (!sibling) this.owned.push(map);
      const base = source.clone();
      base.map = map;
      base.color.setRGB(CLOTH[0], CLOTH[1], CLOTH[2]);
      base.emissive.setRGB(0.8, 0.95, 1);
      base.emissiveMap = map;
      base.emissiveIntensity = 0;
      base.alphaTest = 0;
      const m = cut === undefined ? base : cutMaterial(base, 'upper', cut, false);
      hollowed(m);
      m.userData.source = source;
      m.userData.cut = cut;
      mesh.material = m;
      this.cloth.push(m);
      this.owned.push(m);
    });
  }

  private buildDressing(): void {
    const k = this.kit;
    const b = this.build;
    const root = this.root;
    const radiators = k.props('radiator', 6);
    radiators.set(0, HALF_W - 0.16, 0, 0.2, Math.PI / 2);
    radiators.set(1, HALF_W - 0.16, 0, -5.4, Math.PI / 2);
    radiators.set(2, -HALF_W + 0.16, 0, -5.4, Math.PI / 2);
    radiators.set(3, -HALF_W + 0.16, 0, -12.6, Math.PI / 2);
    radiators.set(4, HALF_W - 0.16, 0, -12.6, Math.PI / 2);
    radiators.set(5, 0, 0, BACK_Z - 0.16, 0);
    radiators.commit();
    root.add(radiators.root);
    k.prop('drinking_fountain', [-HALF_W + 0.17, 0.72, 1.05], { rotation: [0, 90, 0] }, root);
    const cork = new MeshStandardMaterial({ color: 0x4a4230, roughness: 0.95 });
    k.paint(k.prop('noticeboard', [-HALF_W + 0.03, 1.72, -1.5], { rotation: [90, 90, 0], anchor: 'center' }, root), cork);
    k.paint(k.prop('noticeboard', [-3.2, 1.8, BACK_Z - 0.03], { rotation: [90, 180, 0], anchor: 'center' }, root), cork);
    const pinned: BufferGeometry[] = [];
    const random = randomFrom(44);
    const pin = (x: number, y: number, z: number, turn: number) => {
      const w = 0.09 + random() * 0.07;
      const g = new PlaneGeometry(w, w * 1.35).rotateZ((random() - 0.5) * 0.14).rotateY(turn).translate(x, y, z);
      pinned.push(g);
    };
    for (let i = 0; i < 6; i++) pin(-HALF_W + 0.05, 1.56 + random() * 0.34, -1.5 - 0.4 + random() * 0.8, Math.PI / 2);
    for (let i = 0; i < 6; i++) pin(-3.2 - 0.4 + random() * 0.8, 1.66 + random() * 0.3, BACK_Z - 0.05, Math.PI);
    const paper = new Mesh(mergeGeometries(pinned)!, new MeshStandardMaterial({ color: 0x57564a, roughness: 0.9 }));
    paper.frustumCulled = false;
    root.add(paper);
    const poster = (x: number, y: number, z: number, turn: number, portrait: boolean) => {
      const sheet = b.label(0.52, 0.78, (c, w, h) => drawNotice(c, w, h, portrait), { px: 300, roughness: 0.9 });
      sheet.mesh.position.set(x, y, z);
      sheet.mesh.rotation.y = turn;
      sheet.mesh.rotation.z = portrait ? 0.012 : -0.02;
      root.add(sheet.mesh);
    };
    poster(-HALF_W + 0.012, 1.92, -9, Math.PI / 2, true);
    poster(-HALF_W + 0.012, 1.92, -16.2 + 0.9, Math.PI / 2, false);
    poster(HALF_W - 0.012, 1.7, -7.2 - 1.6, -Math.PI / 2, true);
    poster(-3.9, 1.72, BACK_Z - 0.012, Math.PI, false);
    b.door(3.4, BACK_Z, '-z', root, { color: 0x28342c, beyond: 0x010101 });
    b.door(-HALF_W, -16.4, '+x', root, { color: 0x28342c, beyond: 0x000000, open: 0.1 });

    // high frosted windows down the right wall: night outside, a little of it comes in
    const glassMap = canvasOf(128, 64, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#7f97a8');
      g.addColorStop(1, '#3b4c58');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(6,10,12,0.5)';
      c.lineWidth = 1;
      for (let i = 4; i < w; i += 8) {
        c.beginPath();
        c.moveTo(i, 0);
        c.lineTo(i, h);
        c.stroke();
      }
      for (let i = 4; i < h; i += 8) {
        c.beginPath();
        c.moveTo(0, i);
        c.lineTo(w, i);
        c.stroke();
      }
    });
    const lights: BufferGeometry[] = [];
    const mullions: BufferGeometry[] = [];
    const winZ = [0.3, -1.8, -5.4, -9, -12.6, -16.2];
    const sillY = 2.02;
    const topY = 2.74;
    for (const z of winZ) {
      lights.push(new PlaneGeometry(1.7, topY - sillY).rotateY(-Math.PI / 2).translate(HALF_W - 0.006, (sillY + topY) / 2, z));
      for (const dz of [-0.85, 0, 0.85]) mullions.push(meterUVs(new BoxGeometry(0.03, topY - sillY, 0.035)).translate(HALF_W - 0.02, (sillY + topY) / 2, z + dz));
      for (const y of [sillY, topY]) mullions.push(meterUVs(new BoxGeometry(0.03, 0.035, 1.73)).translate(HALF_W - 0.02, y, z));
    }
    const night = new Mesh(mergeGeometries(lights)!, new MeshStandardMaterial({ color: 0x000000, map: glassMap, emissive: new Color(0xffffff), emissiveMap: glassMap, emissiveIntensity: 0.3 }));
    night.frustumCulled = false;
    root.add(night);
    const bars = new Mesh(mergeGeometries(mullions)!, new MeshStandardMaterial({ color: 0x11140f, roughness: 0.6 }));
    bars.frustumCulled = false;
    root.add(bars);

    // the machine that gave you your slip, and the next number in it
    const dispenser = k.block(0.27, 0.42, 0.17, new MeshStandardMaterial({ color: 0x4a120e, roughness: 0.42 }));
    dispenser.position.set(-HALF_W + 0.085, 1.28, -0.35);
    root.add(dispenser);
    const face = b.label(0.27, 0.42, drawDispenser, { px: 300, emissive: 0.5 });
    face.mesh.rotation.y = Math.PI / 2;
    face.mesh.position.set(-HALF_W + 0.172, 1.28, -0.35);
    root.add(face.mesh);
    const slip = new Mesh(new PlaneGeometry(0.075, 0.1).rotateY(Math.PI / 2).translate(-HALF_W + 0.176, 1.04, -0.35), new MeshStandardMaterial({ color: 0x8f8a78, roughness: 0.9 }));
    slip.frustumCulled = false;
    root.add(slip);

    const chair = k.props('chair_plastic', 3);
    chair.set(0, 4.5, 0, -18.1, Math.PI - 0.3);
    chair.set(1, -4.5, 0, 1.25, 0.8);
    chair.set(2, -4.72, 0, -7.2 - 0.7, Math.PI / 2);
    chair.commit();
    root.add(chair.root);

    // slips on the floor, and one on each seat that someone will leave
    const litter = k.props('ticket_stub', 26);
    const scatter = randomFrom(19);
    for (let i = 0; i < 24; i++) {
      const z = -scatter() * 14 - 0.8;
      const x = (scatter() - 0.5) * AISLE * 1.9 + (scatter() < 0.3 ? (scatter() < 0.5 ? -1 : 1) * 2.4 : 0);
      litter.set(i, x, 0.004, z, scatter() * 6.28, 1.1);
    }
    for (const [i, gone] of [[24, GONE_1], [25, GONE_2]]) {
      const [row, side, n] = SCATTER[gone];
      litter.set(i, side * (AISLE + SEAT * (0.5 + n)), SEAT_Y + 0.004, -row * ROW_STEP - 0.04, 0.7, 1.4);
    }
    litter.commit();
    root.add(litter.root);

    // your slip, and white hairs on the same seat: whoever sat here before you
    const ticket = new Mesh(new PlaneGeometry(0.11, 0.075, 12, 2).rotateX(-Math.PI / 2), new MeshStandardMaterial({ map: canvasOf(440, 300, drawTicket), roughness: 0.85 }));
    const tp = ticket.geometry.getAttribute('position');
    // it curls, and its torn top edge is not straight
    for (let i = 0; i < tp.count; i++) {
      tp.setY(i, 0.002 + 0.006 * Math.pow(Math.abs(tp.getX(i)) / 0.055, 2) + 0.004 * Math.sin(tp.getZ(i) * 40));
      if (tp.getZ(i) < 0) tp.setZ(i, tp.getZ(i) + 0.0035 * Math.sin(tp.getX(i) * 311));
    }
    ticket.geometry.computeVertexNormals();
    ticket.position.set(TICKET_AT[0], TICKET_AT[1], TICKET_AT[2]);
    ticket.rotation.y = -Math.PI / 2 + 0.34;
    ticket.frustumCulled = false;
    root.add(ticket);
    const loose = new InstancedMesh(looseHairs(), this.hairCloth, 1);
    loose.setMatrixAt(0, m4.makeTranslation(SEAT, SEAT_Y + 0.006, -0.03));
    loose.frustumCulled = false;
    root.add(loose);
    const worn = new Mesh(new PlaneGeometry(SEAT * 0.92, 0.42), new MeshBasicMaterial({ map: canvasOf(128, 96, drawSeatWear), transparent: true, depthWrite: false }));
    worn.rotation.x = -Math.PI / 2;
    worn.position.set(SEAT, SEAT_Y + 0.002, -0.02);
    worn.frustumCulled = false;
    root.add(worn);
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const dt = frame.dt;
    for (const c of this.clocks) c.value = frame.time;

    // the ceiling
    const breath = 1 + 0.025 * wobble(frame.time * 1.7, 2);
    const aliveLevel = s < ROW_OFF[ALIVE_ROW] ? dip(s, DIP_1) * dip(s, DIP_2) * breath : tube(s, 0, ROW_OFF[ALIVE_ROW]);
    this.aliveGlow.emissiveIntensity = ALIVE_GLOW * aliveLevel;
    for (let r = 0; r < PANEL_Z.length; r++) {
      const level = tube(s, ROW_ON[r], ROW_OFF[r]);
      this.rowGlow[r].emissiveIntensity = ROW_GLOW * level;
      const own = r === ALIVE_ROW ? Math.max(level, aliveLevel * (ALIVE_FILL / ROW_FILL)) : level;
      this.rowFills[r].intensity = ROW_FILL * own + (r === 2 && s >= TURN_AT ? CEILING_LEFT : 0);
    }
    this.hallGlow.visible = this.hallBeam.visible = aliveLevel > 0.02;

    // the blow is a cut: everything after it is another state of the hall
    const turned = s >= TURN_AT;
    const open = smootherstep(range(WINDOW_AT, WINDOW_AT + WINDOW_LEN, s));
    this.spots = turned ? this.spotsFacing : this.spotsHall;
    (this.spotsHall[0] as { intensity: number }).intensity = KEY * aliveLevel;
    (this.spotsHall[1] as { intensity: number }).intensity = BOUNCE * aliveLevel;
    const reading = smootherstep(range(4.4, 6.9, s)) * (1 - smootherstep(range(9.4, 12.2, s)));
    (this.spotsHall[2] as { intensity: number }).intensity = (BOUNCE_NEAR_LOW + (BOUNCE_NEAR - BOUNCE_NEAR_LOW) * reading) * (s < ROW_OFF[0] ? 1 : 0);
    const flash = s >= SHUTTER_AT ? Math.exp(-(s - SHUTTER_AT) / 0.13) : 0;
    // it comes up at once, is hit by the flash, and then fades as what the eye keeps of a flash fades
    const facing = (1 + FLASH_KEY * flash) * (0.72 + 0.28 * smootherstep(range(TURN_AT, TURN_AT + 0.2, s))) * (1 - 0.68 * smootherstep(range(SHUTTER_AT + 0.4, WINDOW_AT + 1, s))) * (1 - 0.5 * range(WINDOW_AT + 1, CUT_AT, s));
    (this.spotsFacing[0] as { intensity: number }).intensity = FACING_KEY * facing;
    (this.spotsFacing[2] as { intensity: number }).intensity = FACING_FAR * facing;
    (this.spotsFacing[1] as { intensity: number }).intensity = WINDOW_SPOT * open;

    // the far end: its light goes with the first relay and comes back only with the open window
    const counter = s < ROW_OFF[5] ? 1 : 0;
    this.windowFill.intensity = WINDOW_FILL * counter + WINDOW_OPEN_FILL * open;
    this.paneGlow.emissiveIntensity = GLASS_GLOW * counter;
    this.sideGlow.emissiveIntensity = SIDE_GLOW * counter;
    this.behindGlass.visible = counter > 0;
    this.behindGlass.position.x = s < DIP_1 ? 0.5 : s < DIP_2 ? -0.1 : 0;
    this.behindGlass.scale.setScalar(s < DIP_2 ? 1 : 1.25);
    this.centerPane.position.x = open * PANE_W;
    this.officeLight.color.setScalar(open > 0 ? 2.2 : 0);
    this.openHalo.visible = open > 0;
    this.openHalo.scale.setScalar(1 + open * 4.5);
    (this.openBeam.material as ShaderMaterial).uniforms.uIntensity.value = 0.12 * open;
    this.redFill.intensity = RED_FILL;
    const lastLight = s < ROW_OFF[0] ? 1 : 0;
    this.nearFill.intensity = NEAR_FILL * lastLight;
    this.exitFill.intensity = EXIT_FILL * lastLight;
    this.backFill.intensity = BACK_FILL * lastLight;
    this.exitGlow.emissiveIntensity = 1.8 * lastLight;

    // what is left of them when the light has gone
    const pale = PALE * smootherstep(range(ROW_OFF[5] - 0.5, ROW_OFF[0] + 0.3, s));
    for (const m of this.cloth) m.emissiveIntensity = m.userData.cut === undefined ? pale : PALE_FACING;
    this.hairCloth.emissiveIntensity = HAIR_GLOW + pale * 0.7;
    this.flareCloth.emissiveIntensity = pale * 0.5;

    const show = s < DING_18 ? 0 : s < DING_19 ? 1 : s < DING_33 ? 2 : 3;
    const changing = (s >= DING_18 && s < DING_18 + NUMBER_BLINK) || (s >= DING_19 && s < DING_19 + NUMBER_BLINK) || (s >= DING_33 && s < DING_33 + NUMBER_BLINK);
    for (let i = 0; i < 4; i++) this.numbers[i].visible = i === show && !changing;
    const clockAt = 18.5 * 3600 + Math.floor(Math.min(s, SILENCE_AT));
    for (const hands of this.clockHands) setClock(hands, clockAt);

    // those who go while nobody looks, or when the light dips
    let moved = false;
    const seen = this.seen;
    const state = this.state;
    if (s < DING_18) seen.gone1 = false;
    else if (!seen.gone1) seen.gone1 = s >= DIP_1 || this.unseen(frame, this.sitters[GONE_1].x, 1.1, this.sitters[GONE_1].z);
    if (s < DING_19) seen.gone2 = false;
    else if (!seen.gone2) seen.gone2 = s >= DIP_2 || this.unseen(frame, this.sitters[GONE_2].x, 1.1, this.sitters[GONE_2].z);
    if (state.gone1 !== seen.gone1) {
      state.gone1 = seen.gone1;
      this.seatPerson(GONE_1, this.sitters[GONE_1], !seen.gone1);
      moved = true;
    }
    if (state.gone2 !== seen.gone2) {
      state.gone2 = seen.gone2;
      this.seatPerson(GONE_2, this.sitters[GONE_2], !seen.gone2);
      moved = true;
    }
    if (moved) {
      for (const crowd of this.seated) crowd.commit();
      for (const tie of this.ties) tie.instanceMatrix.needsUpdate = true;
      this.hairs.instanceMatrix.needsUpdate = true;
    }

    // the seat beside you, your row's back
    if (s < DING_19) seen.beside = false;
    else if (!seen.beside) seen.beside = this.unseen(frame, BESIDE_X, 1.1, 0, 12);
    if (s < BEHIND_AT) seen.behind = false;
    else if (!seen.behind) seen.behind = this.unseen(frame, -1.9, 1.3, STAND_Z, 6) && this.unseen(frame, 0, 1.3, STAND_Z, 6) && this.unseen(frame, 1.9, 1.3, STAND_Z, 6);
    this.beside.root.visible = seen.beside || turned;
    this.standing.root.visible = seen.behind;
    if (state.close !== turned) {
      state.close = turned;
      this.placeStanding(turned ? STAND_CLOSE_Z : STAND_Z, turned);
    }

    // the turn
    if (state.turned !== turned) {
      state.turned = turned;
      moved = true;
      for (const crowd of this.seated) crowd.root.visible = !turned;
      for (const tie of this.ties) tie.visible = !turned;
      this.hairs.visible = !turned;
      for (const crowd of this.turned) crowd.root.visible = turned;
      for (const tie of this.turnedTies) tie.visible = turned;
      this.floorPaint.color.set(0xaebdb2).multiplyScalar(turned ? FLOOR_TURNED : 1);
      for (const m of this.seatPlastic) m.color.setRGB(0.27, 0.33, 0.3).multiplyScalar(turned ? SEATS_TURNED : 1);
    }
    const eye = frame.view.position;
    const eyeX = eye.x - this.origin.x;
    const eyeY = eye.y - this.origin.y;
    const eyeZ = eye.z - this.origin.z;
    if (turned) {
      if (s >= RISE_AT - 0.1) this.faceTheEye(eyeX, eyeY, eyeZ);
      this.poseBeside(smootherstep(range(TURN_AT + 0.7, WINDOW_AT + 0.6, s)), eyeX, eyeY, eyeZ);
    } else this.poseBeside(-1, eyeX, eyeY, eyeZ);

    // you are still sitting there, when you look back
    if (s < RISE_AT + 1) seen.self = false;
    else if (!seen.self) seen.self = eyeZ < -0.6 && this.unseen(frame, 0, 1.1, 0);
    this.self.root.visible = seen.self;

    // the neck, from behind the window
    const grown = 1 - Math.pow(1 - range(NECK_FROM, CUT_AT, s), 1.35);
    const out = s >= NECK_FROM;
    this.neck.visible = out;
    this.neckHead.visible = out;
    this.headLight.intensity = out ? HEAD_LIGHT * range(NECK_FROM, NECK_FROM + 1, s) : 0;
    let tipDistance = 11;
    if (out) {
      const rings = Math.max(1, Math.floor(grown * this.neckSegments));
      this.neck.geometry.setDrawRange(0, rings * this.neckRadial * 6);
      const u = rings / this.neckSegments;
      this.neckClock.value = frame.time;
      this.neckSkin.offset.x = -s * 0.3;
      this.neckCurve.getPointAt(u, v4);
      const along = u * this.neckLength * 2.2;
      const swing = smootherstep(range(0, 1.5, along));
      v4.x += swing * NECK_SWAY * Math.sin(frame.time * 0.7 + along * 1.3);
      v4.y += swing * NECK_SWAY * 0.6 * Math.sin(frame.time * 0.53 + along * 1.7 + 1);
      v4.z += swing * NECK_SWAY * Math.cos(frame.time * 0.61 + along * 1.1);
      // a head rides the end of it and looks where you are
      v5.set(eyeX - v4.x, eyeY - v4.y, eyeZ - v4.z).normalize();
      this.neckHead.quaternion.setFromUnitVectors(ZAXIS, v5).premultiply(q5.setFromAxisAngle(v5, HEAD_TILT * smootherstep(range(53.6, 55.8, s))));
      this.neckHead.position.copy(v4).addScaledVector(v5, 0.03);
      this.neckHead.position.y += 0.04;
      tipDistance = Math.hypot(v4.x - eyeX, v4.y - eyeY, v4.z - eyeZ);
      this.headLight.position.set(v4.x - 0.5, Math.min(v4.y + 0.62, HEAD_LIGHT_TOP), v4.z + 0.5).add(this.origin);
    }

    this.bedLevels(s, turned, seen.beside);
    // a heart, once there is nothing else left to hear
    if (s > SHUTTER_AT + 0.8 && s < CUT_AT && frame.heartbeat > 0.95 && this.lastHeart <= 0.95) this.sound.play(HEART, { gain: 0.34 });
    this.lastHeart = frame.heartbeat;

    this.movingShadows = moved;
    this.black = (s >= BLACK_FROM && s < TURN_AT) || s >= CUT_AT ? 1 : 0;
    this.fear = 0.22 + 0.2 * range(14, 34, s) + 0.25 * range(34, 44, s) + (turned ? 0.3 : 0);
    this.film.ghost = s >= SHUTTER_AT ? 0.55 * (1 - range(SHUTTER_AT, SHUTTER_AT + 3.5, s)) : 0;
    this.air.envIntensity = ENV - (ENV - ENV_DARK) * range(ROW_OFF[3], ROW_OFF[0], s);

    // the lens goes where the mind is: the slip, something beside you, or down the hall
    const atTicket = s > 5.2 && s < 11;
    const near = atTicket || Math.abs(frame.input.gazeYaw) > 0.9 || frame.input.gazePitch < -0.7;
    // the flash sees everything at once
    const sharp = s >= BLACK_FROM && s < RISE_AT;
    const far = s >= RISE_AT ? Math.max(1.5, tipDistance) : sharp ? 5 : 11;
    this.focus = damp(this.focus, near ? 0.9 : far, sharp ? 30 : 3.2, dt);
    this.aperture = damp(this.aperture, atTicket ? 6 : sharp ? 0.6 : 3, sharp ? 30 : 2, dt);
  }

  /** How loud each bed is now: a pure function of the time, so that scrubbing back brings the room's sound back. */
  private bedLevels(s: number, turned: boolean, besideThere: boolean): void {
    if (!this.beds.length) return;
    let lit = 0;
    for (let r = 0; r < PANEL_Z.length; r++) if (r === ALIVE_ROW ? s < ROW_OFF[r] : s >= ROW_ON[r] && s < ROW_OFF[r]) lit++;
    const quiet = s >= SILENCE_AT && s < TURN_AT + 1;
    const want = this.bedWanted;
    want[0] = lit > 0 ? 0.07 + 0.027 * lit : 0;
    want[1] = lit > 0 ? 0.1 : 0;
    want[2] = s < SILENCE_AT ? 0.08 : 0;
    want[3] = quiet ? 0 : 0.05 + 0.05 * range(20, 43, s);
    want[4] = lit > 0 ? 0.03 * range(12, 16, s) : s > WINDOW_AT ? 0.06 : 0;
    want[5] = s >= ROW_ON[0] && s < ROW_OFF[0] ? 0.11 : 0;
    want[6] = besideThere && s < 40 ? 0.09 : 0;
    want[7] = (s >= 40 && s < SILENCE_AT) || (s >= TURN_AT + 1.6 && s < 53) ? 0.27 : 0;
    want[8] = turned ? 0.13 * range(TURN_AT + 1, WINDOW_AT, s) : 0;
    want[9] = s >= NECK_FROM ? 0.06 + 0.26 * range(NECK_FROM, CUT_AT, s) : 0;
    want[10] = s >= RISE_AT ? 0.12 : 0;
    const cut = s >= CUT_AT;
    for (let i = 0; i < this.beds.length; i++) {
      const level = cut ? 0 : want[i];
      if (Math.abs(level - this.bedHeard[i]) < 0.003) continue;
      this.bedHeard[i] = level;
      this.beds[i].gain(level, cut ? 0.04 : 0.2);
    }
  }

  dispose(): void {
    super.dispose();
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
  }
}
