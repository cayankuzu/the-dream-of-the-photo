import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { SpotSpec } from '../../../config/nightmare.config';
import type { PropCrowd } from '../../dream/DreamKit';
import type { DreamLight } from '../../dream/LightPool';
import { clamp, range, smootherstep, wobble } from '../../math';
import type { RoomAir, RoomAssets, RoomContext, RoomControl, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import { PALETTE } from '../RoomKit';
import type { RoomVoice, RoomVoiceOptions } from '../RoomSound';

const A = 'rooms/';
const WIND = `${A}attic_wind.mp3`;
const HUM = `${A}bulb_hum.mp3`;
const CORD_SWING = `${A}cord_swing.mp3`;
const DRONE = `${A}dream_drone_low.mp3`;
const GLASS = `${A}dream_drone_glass.mp3`;
const BOX_1 = `${A}music_box_half_1.mp3`;
const BOX_2 = `${A}music_box_half_2.mp3`;
const BOX_3 = `${A}music_box_half_3.mp3`;
const BOX_SLOW = `${A}music_box_slowing.mp3`;
const BOX_JAW = `${A}music_box_jaw.mp3`;
const BOX_KEY = `${A}music_box_wind.mp3`;
const JAW_KNOCK = `${A}doll_jaw_drop.mp3`;
const RATTLE = `${A}porcelain_rattle.mp3`;
const PULL = `${A}pull_cord.mp3`;
const BREATH = `${A}breath_in.mp3`;
const CREAKS = [`${A}head_creak_1.mp3`, `${A}head_creak_2.mp3`, `${A}head_creak_3.mp3`];
const CLICKS = [1, 2, 3, 4, 5, 6].map((n) => `${A}porcelain_click_${n}.mp3`);
const BLOCKS = [1, 2, 3].map((n) => `${A}wood_block_${n}.mp3`);
const WOOD = [1, 2, 3, 4, 5].map((n) => `${A}wood_creak_small_${n}.mp3`);
const SNAP = `${A}wood_snap_small_2.mp3`;

export const assets: RoomAssets = {
  models: ['doll', 'doll_low', 'bookshelf_worn', 'music_box', 'wooden_crate', 'pull_chain_socket', 'window_wood', 'rocking_chair'],
  materials: ['wallpaper_old', 'wood_dark_paint', 'wood_raw_boards', 'wood_floor_dark'],
  sounds: [WIND, HUM, CORD_SWING, DRONE, GLASS, BOX_1, BOX_2, BOX_3, BOX_SLOW, BOX_JAW, BOX_KEY, JAW_KNOCK, RATTLE, PULL, BREATH, ...CREAKS, ...CLICKS, ...BLOCKS, ...WOOD, SNAP],
};

type V3 = readonly [number, number, number];

const TAU = Math.PI * 2;

/** The attic (m): half its width at the low walls, the low wall, the ridge, where its two gables stand. */
const W = 2.95;
const EAVE = 1.24;
const RIDGE = 2.74;
const Z_FRONT = -3.55;
const Z_BACK = 3.35;
const SLOPE_ANGLE = Math.atan2(RIDGE - EAVE, W);
const SLOPE_RUN = Math.hypot(W, RIDGE - EAVE);
/** Height of the two shelves along the low walls (m), and the spacing of rafters (m). */
const TIERS = [0.16, 0.7];
const TOP_TIER = 1.24;
const RAFTER_STEP = 0.72;

/** Seconds, as the treatment has them. */
const MOVE_FROM = 6;
const MOVE_UNTIL = 36;
const SWING_AT = 30;
const FEET_AT = 38;
const DOLL_AT = 44;
const JAW_AT = 46;
const LINE_AT = 50;
const CUT_AT = 54;
/** Everything else on the clock (s): when the sounds drop out, the shutter, the viewer held still, the heads' tilt. */
const SILENCE_AT = 43.1;
const SHUTTER_AT = 46.7;
const HOLD_FROM = 43;
const HOLD_UNTIL = 53.5;
const TILT_SECONDS = 1.5;
/** How many steps they take in all, how far a head tips at the end (rad). */
const MOVE_STEPS = 10;
const TILT = 0.44;
/** How far out of view a doll must be before it may move (deg). */
const UNSEEN_MARGIN = 7;
/** The two blinks the room forces on the viewer (s), and how black counts as not looking. */
const BLINKS = [27.2, 37.1];
const BLINK_HALF = 0.16;
const BLIND = 0.96;

/** The look round: second, yaw, pitch, fov, eye height. A `glance` is the head turning back: dropped for reduced motion. */
const TURN: readonly { s: number; yaw: number; pitch: number; fov: number; y: number; glance?: boolean }[] = [
  { s: 0, yaw: 0, pitch: -4, fov: 66, y: 1.32 },
  { s: 4.6, yaw: 1.5, pitch: -4, fov: 66, y: 1.32 },
  { s: 9.6, yaw: 42, pitch: -4, fov: 62, y: 1.32 },
  { s: 14.2, yaw: 98, pitch: -2, fov: 58, y: 1.32 },
  { s: 15.2, yaw: 100, pitch: -2, fov: 58, y: 1.32 },
  { s: 18.6, yaw: 30, pitch: -6, fov: 60, y: 1.32, glance: true },
  { s: 20.2, yaw: 27, pitch: -6, fov: 60, y: 1.32, glance: true },
  { s: 25.6, yaw: 142, pitch: 2, fov: 58, y: 1.32 },
  { s: 29.2, yaw: 186, pitch: 3, fov: 56, y: 1.32 },
  { s: 33, yaw: 236, pitch: 7, fov: 56, y: 1.32 },
  { s: 35.3, yaw: 276, pitch: 3, fov: 56, y: 1.3 },
  { s: 38, yaw: 298, pitch: -60, fov: 56, y: 1.28 },
  { s: 40.2, yaw: 303, pitch: -55, fov: 54, y: 1.26 },
  { s: 42.7, yaw: 345, pitch: -17, fov: 48, y: 1.2 },
  { s: DOLL_AT, yaw: 365, pitch: -9, fov: 46, y: 1.16 },
  { s: JAW_AT, yaw: 366.5, pitch: -8.5, fov: 44, y: 1.14 },
  { s: LINE_AT, yaw: 367.4, pitch: -8, fov: 42, y: 1.13 },
  { s: CUT_AT, yaw: 368, pitch: -8, fov: 41, y: 1.12 },
  { s: 56, yaw: 368, pitch: -8, fov: 41, y: 1.12 },
];

/** The bulb hangs from the ridge in front of you: where (m), how long its cord is, its colors. */
const BULB_Z = -1.05;
const CORD = 1.02;
const BULB_COLOR = 0xffc98a;
const KEY_LIGHT = 11.5;
const KEY_ANGLE = 66;
const FILL_LIGHT = 6.5;
/** What comes back off the floor toward the door, so that the far end has a shape. */
const BOUNCE_LIGHT = 1.8;
/** Its slow swing: the largest angle (rad), the period (s, what the sound of the cord swings at) and how long it takes to grow (s). */
const SWING_ANGLE = 0.62;
const SWING_PERIOD = 5.6;
const SWING_RAMP = 6;

/** The moon: its color and how much it gives through the window and just inside it. */
const MOON_COLOR = 0x9dbbe2;
const MOON_KEY = 30;
const MOON_FILL = 1.6;
const WINDOW_Y = 1.52;
const WINDOW_SCALE = 0.8;

/** The rocking chair by the window (m), the big doll's size in it and in front of you. */
const CHAIR_X = 0.68;
const CHAIR_Z = -2.42;
const HERO_SCALE = 2.9;
const HERO_IN_CHAIR_Y = -0.02;
const HERO_IN_CHAIR_Z = CHAIR_Z + 0.2;
const FRONT_X = -0.17;
const FRONT_Z = -0.75;
/** How far its head turns while it still sits there (rad), and how far out of view it has to be to leave (deg). */
const HERO_GLANCE = 1.05;
const HERO_MARGIN = 24;
/** The empty chair keeps rocking: how far (rad), how fast (rad/s), how soon it dies (s). */
const CHAIR_ROCK = 0.07;
const CHAIR_RATE = 1.5;
const CHAIR_FADE = 11;
/** How wide the jaw falls (rad); the comb in its mouth: how many tines, the height of their root and how far forward they hang (m in the doll's own frame), its width, its longest and shortest tine. */
const JAW_OPEN = 0.95;
const COMB_TINES = 13;
const COMB_TOP = 0.93;
const COMB_FRONT = 0.113;
const COMB_WIDTH = 0.07;
const COMB_LONG = 0.058;
const COMB_SHORT = 0.03;
/** How far the jaw drops as it opens (m at scale 1 of the doll), past what its hinge alone gives. */
const JAW_DROP = 0.012;
/** A little light on the face from the side of the viewer, once it is here. */
const FACE_FILL = 1.5;
/** A trace of warm light just inside the open mouth, so that the comb can be seen. */
const MOUTH_LIGHT = 0.16;

/** Where dolls stand: each ring from where it starts to where it ends (m from you), how far apart (m). */
const RINGS = [
  { from: 1.16, to: 0.42, step: 0.33 },
  { from: 1.5, to: 0.82, step: 0.33 },
  { from: 1.85, to: 1.22, step: 0.34 },
  { from: 2.2, to: 1.62, step: 0.35 },
  { from: 2.55, to: 2.02, step: 0.37 },
];
/** Every other doll of a ring stands this much further back at the end, or they would not fit. */
const ZIG = 0.17;
/** The floor sectors and the four walls are each a crowd of their own, so that what is behind you is not drawn. */
const SECTORS = 8;
const GROUP_RIGHT = SECTORS;
const GROUP_LEFT = SECTORS + 2;
const GROUP_FRONT = SECTORS + 4;
const GROUP_BACK = SECTORS + 6;
const GROUPS = SECTORS + 8;

/** Where the head of a doll_low stands on its body, and where its eyes lie from there, at scale 1 (m). */
const HEAD_X = -0.0014;
const HEAD_Y = 0.288;
const HEAD_Z = -0.0016;
const EYE_X = 0.0169;
const EYE_UP = 0.069;
const EYE_OUT = 0.056;
/** Where they all end up looking (m): your face. A glass eye as drawn on the crowd (m) and the glint on it. */
const LOOK_AT_Y = 1.25;
const EYE_SIZE = 0.03;
const GLINT_SIZE = 0.009;
/** How far a crowd may lie outside the view and still be drawn (deg): the rest of the room is not drawn at all. */
const CULL_MARGIN = 10;
/** Looking down further than this (y of the gaze), the rings beyond NEAR_RINGS are out of view; how far that is (m). */
const STEEP = -0.79;
const NEAR_RINGS = 2;

/** The shadow of the crowd on the walls while the bulb swings: head line (m up the surface), how far it runs, how dark, the size of one strip of it. */
const BAND_LIFT_SIDE = 2.9;
const BAND_LIFT_GABLE = 2.1;
const BAND_RUN = 0.75;
const BAND_SLIDE = 0.08;
const BAND_OPACITY = 0.7;
/** How dark that shadow lies on the walls while the bulb still hangs straight (0..1 of the above). */
const BAND_AT_REST = 0.5;
const BAND_WIDTH = 5.4;
const BAND_HEIGHT = 2.6;
const BAND_TOP = 0.92;

/** What is heard, by second: the box, again and again; clicks that are only ever behind you. */
const MUSIC: readonly { at: number; file: string; pan: number; lowpass?: number }[] = [
  { at: 2, file: BOX_1, pan: -0.25 },
  { at: 12, file: BOX_1, pan: 0.6, lowpass: 5000 },
  { at: 21.5, file: BOX_3, pan: -0.6 },
  { at: 28.4, file: BOX_2, pan: 0.3 },
  { at: 36.4, file: BOX_SLOW, pan: 0 },
];
const CLICK_AT: readonly (readonly [number, number])[] = [
  [7.6, -0.85], [11.2, 0.8], [15.9, -0.9], [19.4, 0.85], [23.8, -0.8], [26.6, 0.9], [31.2, -0.85], [33.4, 0.85], [35, -0.9], [37.1, 0.9], [39.3, -0.8], [40.4, 0.8], [41.1, -0.9], [41.5, 0.9],
];
const WOOD_AT: readonly (readonly [number, number])[] = [
  [9.2, 0.5], [16.8, -0.6], [25.1, 0.7], [32.2, -0.4], [41.9, 0.6], [43.5, 0.55],
];
const BLOCK_AT: readonly (readonly [number, number])[] = [
  [13.7, -0.7], [22.3, 0.75], [34.1, -0.65],
];

/** The faded cloth of the crowd. */
const DRESSES = [0xb07a78, 0x7f93ad, 0xb3a67a, 0x8aa38a, 0xa98fb0, 0xc9bda6, 0x9c5f55, 0x6f8a90, 0xb59a8a];
const HAIR = ['#8a6238', '#b5935a', '#6b4427', '#a05c32', '#a39c88'];

const UP = new Vector3(0, 1, 0);
const FREE: RoomControl = { look: true, scroll: true };
const HELD: RoomControl = { look: false, scroll: true };

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A flat quad; a→b is U, a→d is V; UVs in meters, or 0..1 for what carries a picture of its own. */
function quadGeometry(a: V3, b: V3, c: V3, d: V3, unit = false): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([...a, ...b, ...c, ...d]), 3));
  const w = unit ? 1 : Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const h = unit ? 1 : Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, w, 0, w, h, 0, h]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

/** A box with its UVs in meters on every face, for wood. */
function meterBox(w: number, h: number, d: number, at: V3, rotation: V3 = [0, 0, 0]): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  const sizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) uv.setXY(f * 4 + v, uv.getX(f * 4 + v) * sizes[f][0], uv.getY(f * 4 + v) * sizes[f][1]);
  g.applyMatrix4(new Matrix4().compose(new Vector3(...at), new Quaternion().setFromEuler(new Euler(rotation[0], rotation[1], rotation[2])), new Vector3(1, 1, 1)));
  return g;
}

/** A place on one sloped side: `up` meters up from the low wall, a little off the boards. */
function slopeAt(side: number, up: number, z: number, off: number): V3 {
  const c = Math.cos(SLOPE_ANGLE);
  const s = Math.sin(SLOPE_ANGLE);
  return [side * (W - up * c) - side * s * off, EAVE + up * s - c * off, z];
}

function slopeQuad(side: number, up0: number, up1: number, z0: number, z1: number, off: number, unit = false): BufferGeometry {
  const [a, b] = side > 0 ? [z0, z1] : [z1, z0];
  return quadGeometry(slopeAt(side, up0, a, off), slopeAt(side, up0, b, off), slopeAt(side, up1, b, off), slopeAt(side, up1, a, off), unit);
}

function gableOutline(hole: boolean): ShapeGeometry {
  const s = new Shape();
  s.moveTo(-W, 0);
  s.lineTo(W, 0);
  s.lineTo(W, EAVE);
  s.lineTo(0, RIDGE);
  s.lineTo(-W, EAVE);
  s.closePath();
  if (hole) {
    const h = new Path();
    h.moveTo(-0.79, 0.95);
    h.lineTo(-0.79, 2.09);
    h.lineTo(0.79, 2.09);
    h.lineTo(0.79, 0.95);
    h.closePath();
    s.holes.push(h);
  }
  return new ShapeGeometry(s);
}

function canvasOf(w: number, h: number): { canvas: HTMLCanvasElement; c: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, c: canvas.getContext('2d')! };
}

function pictureOf(canvas: HTMLCanvasElement, srgb = true): CanvasTexture {
  const t = new CanvasTexture(canvas);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A soft round spot: the shadow at a doll's foot, the glint on its eye. */
function softDot(): CanvasTexture {
  const { canvas, c } = canvasOf(64, 64);
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return pictureOf(canvas, false);
}

/** The doll's painted face gone over with a point, again and again, as the faces in the photographs were. */
function scratchedFace(source: Texture): CanvasTexture {
  const S = 1024;
  const { canvas, c } = canvasOf(S, S);
  c.drawImage(source.image as CanvasImageSource, 0, 0, S, S);
  const random = rng(46);
  c.save();
  c.beginPath();
  c.rect(0, 0, S, 872);
  c.clip();
  // the eyes dug out first
  for (const [ex, ey] of [[334, 502], [690, 502]]) {
    c.fillStyle = 'rgb(7,5,5)';
    c.beginPath();
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * TAU;
      const r = 92 + random() * 46;
      c.lineTo(ex + Math.cos(a) * r, ey + Math.sin(a) * r * 0.72);
    }
    c.closePath();
    c.fill();
  }
  // then the glaze worn off in long strokes of the hand, then the grooves
  c.lineCap = 'round';
  for (let n = 0; n < 2600; n++) {
    const a = random() * TAU;
    const r = Math.sqrt(random());
    const x = 512 + Math.cos(a) * r * 370;
    const y = 480 + Math.sin(a) * r * 430;
    const dir = -0.95 + random() * 0.5 + (random() < 0.28 ? 1.55 : 0);
    const len = 28 + random() * 165;
    const kind = random();
    c.strokeStyle = kind < 0.52 ? `rgba(246,240,228,${0.22 + random() * 0.66})` : kind < 0.9 ? `rgba(14,9,8,${0.25 + random() * 0.6})` : `rgba(74,26,18,${0.3 + random() * 0.4})`;
    c.lineWidth = 0.9 + random() * 5.4;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(dir) * len, y + Math.sin(dir) * len);
    c.stroke();
  }
  // and the crack the head made coming round
  c.strokeStyle = 'rgb(9,7,6)';
  c.lineWidth = 7;
  c.lineJoin = 'miter';
  c.beginPath();
  c.moveTo(790, 230);
  for (let x = 790, y = 230; y < 868; ) {
    x += -60 + random() * 80;
    y += 40 + random() * 70;
    c.lineTo(x, y);
  }
  c.stroke();
  c.restore();
  const t = pictureOf(canvas);
  t.flipY = source.flipY;
  t.colorSpace = source.colorSpace;
  t.wrapS = source.wrapS;
  t.wrapT = source.wrapT;
  return t;
}

/** What the window looks out on: a low moon behind bare branches, seen through a dirty pane. */
function moonNight(): CanvasTexture {
  const { canvas, c } = canvasOf(512, 384);
  const g = c.createRadialGradient(168, 118, 8, 168, 118, 420);
  g.addColorStop(0, '#e8f2ff');
  g.addColorStop(0.09, '#c9dcf5');
  g.addColorStop(0.3, '#6e8fbb');
  g.addColorStop(0.72, '#26406a');
  g.addColorStop(1, '#101f38');
  c.fillStyle = g;
  c.fillRect(0, 0, 512, 384);
  const random = rng(5);
  c.strokeStyle = 'rgba(6,10,20,0.9)';
  c.lineCap = 'round';
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number): void => {
    if (depth === 0 || w < 0.35) return;
    const nx = x + Math.cos(a) * len;
    const ny = y + Math.sin(a) * len;
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(nx, ny);
    c.stroke();
    branch(nx, ny, a + (random() - 0.5) * 0.9, len * 0.78, w * 0.72, depth - 1);
    if (random() < 0.72) branch(nx, ny, a + (random() < 0.5 ? -1 : 1) * (0.4 + random() * 0.55), len * 0.66, w * 0.6, depth - 1);
  };
  branch(470, 410, -2.15, 92, 9, 8);
  branch(-24, 340, -0.75, 70, 7, 7);
  // dirt running down the glass
  for (let n = 0; n < 60; n++) {
    c.fillStyle = `rgba(18,20,26,${0.06 + random() * 0.14})`;
    c.fillRect(random() * 512, 120 + random() * 260, 1 + random() * 3, 40 + random() * 150);
  }
  return pictureOf(canvas);
}

/** The panes of the window, laid on the floor by the moon. */
function moonPanes(): CanvasTexture {
  const { canvas, c } = canvasOf(192, 256);
  c.fillStyle = '#000';
  c.fillRect(0, 0, 192, 256);
  c.shadowColor = '#fff';
  c.shadowBlur = 7;
  c.fillStyle = '#fff';
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) c.fillRect(14 + i * 42, 16 + j * 76, 34, 66);
  return pictureOf(canvas);
}

/** The shadow of the crowd on a wall: soft heads and shoulders in a strip that wraps, solid at the foot. */
function crowdShadow(): CanvasTexture {
  const w = 1024;
  const h = 494;
  const { canvas, c } = canvasOf(w, h);
  const random = rng(11);
  c.fillStyle = '#000';
  const doll = (x: number, top: number, r: number): void => {
    for (const dx of [-w, 0, w]) {
      const px = x + dx;
      c.beginPath();
      c.ellipse(px, top + r, r, r * 1.12, 0, 0, TAU);
      c.fill();
      c.beginPath();
      c.moveTo(px - r * 0.22, top + r * 1.8);
      c.lineTo(px + r * 0.22, top + r * 1.8);
      c.lineTo(px + r * 0.3, top + r * 3);
      c.quadraticCurveTo(px + r * 1.5, top + r * 3.1, px + r * 1.7, top + r * 5.4);
      c.lineTo(px + r * 1.7, h + 30);
      c.lineTo(px - r * 1.7, h + 30);
      c.lineTo(px - r * 1.7, top + r * 5.4);
      c.quadraticCurveTo(px - r * 1.5, top + r * 3.1, px - r * 0.3, top + r * 3);
      c.closePath();
      c.fill();
    }
  };
  const n = 8;
  for (let k = 0; k < n; k++) {
    const x = ((k + 0.5 + (random() - 0.5) * 0.4) / n) * w;
    doll(x, h * (0.06 + random() * 0.18), 38 + random() * 22);
    if (k % 2 === 0) doll(x + (((random() < 0.5 ? -1 : 1) * w) / n) * 0.5, h * (0.32 + random() * 0.12), 24 + random() * 12);
  }
  const small = canvasOf(Math.round(w / 4), Math.round(h / 4));
  small.c.drawImage(canvas, 0, 0, small.canvas.width, small.canvas.height);
  c.clearRect(0, 0, w, h);
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.drawImage(small.canvas, 0, 0, w, h);
  // what lies under the shoulders fades, or the wall and its shelves would be lost
  c.globalCompositeOperation = 'destination-out';
  const g = c.createLinearGradient(0, h * 0.42, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.92)');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = 'source-over';
  const t = pictureOf(canvas);
  t.wrapS = RepeatWrapping;
  t.repeat.set(1 / BAND_WIDTH, 1 / BAND_HEIGHT);
  return t;
}

/** Water that came through the boards, years ago: dark, with its edge a line. */
function waterStain(seed: number): CanvasTexture {
  const { canvas, c } = canvasOf(384, 384);
  const random = rng(seed);
  for (let n = 0; n < 34; n++) {
    const x = 192 + (random() - 0.5) * 190;
    const y = 192 + (random() - 0.5) * 190;
    const r = 34 + random() * 76;
    const g = c.createRadialGradient(x, y, r * 0.15, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${0.04 + random() * 0.14})`);
    g.addColorStop(0.84, `rgba(0,0,0,${0.08 + random() * 0.16})`);
    g.addColorStop(0.92, `rgba(0,0,0,${0.16 + random() * 0.12})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 384, 384);
  }
  return pictureOf(canvas);
}

/** A cobweb across a corner. */
function cobweb(): CanvasTexture {
  const { canvas, c } = canvasOf(256, 256);
  const random = rng(77);
  c.strokeStyle = 'rgba(222,220,210,0.55)';
  c.lineWidth = 0.8;
  const spokes = 9;
  const angle = (k: number) => ((k + 0.5) / spokes) * Math.PI * 0.5 + (random() - 0.5) * 0.06;
  const ends: { a: number }[] = [];
  for (let k = 0; k < spokes; k++) {
    const a = angle(k);
    ends.push({ a });
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(Math.cos(a) * 240, Math.sin(a) * 240);
    c.stroke();
  }
  for (let ring = 1; ring < 9; ring++) {
    const r = ring * 26 + random() * 9;
    c.beginPath();
    ends.forEach((e, k) => {
      const q = r * (1 + (random() - 0.5) * 0.1);
      const x = Math.cos(e.a) * q;
      const y = Math.sin(e.a) * q;
      if (k === 0) c.moveTo(x, y);
      else c.quadraticCurveTo(Math.cos(e.a - 0.09) * q * 0.9, Math.sin(e.a - 0.09) * q * 0.9, x, y);
    });
    c.stroke();
  }
  return pictureOf(canvas);
}

/** The crowd's own heads: where the file has them bald, the painted hair of old dolls. */
function paintedHead(source: Texture, hair: string): CanvasTexture {
  const S = 512;
  const { canvas, c } = canvasOf(S, S);
  c.drawImage(source.image as CanvasImageSource, 0, 0, S, S);
  c.fillStyle = hair;
  c.fillRect(72, 440, 72, 72);
  const t = pictureOf(canvas);
  t.flipY = source.flipY;
  t.colorSpace = source.colorSpace;
  t.wrapS = source.wrapS;
  t.wrapT = source.wrapT;
  return t;
}

/** Long white hair in thin strips: rooted on the crown, past the shoulders, the face left clear. In the doll's own frame (m). */
function whiteHair(): BufferGeometry {
  const random = rng(19);
  const STRANDS = 1750;
  const SEGMENTS = 8;
  /** How much of a strand from the crown is still lying on the head. */
  const HUG = 0.34;
  const crown = (HEAD_Y + 0.072) * HERO_SCALE;
  const rx = 0.0625 * HERO_SCALE;
  const ry = 0.067 * HERO_SCALE;
  const rz = 0.069 * HERO_SCALE;
  const position: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  let placed = 0;
  while (placed < STRANDS) {
    const t0 = random() * TAU;
    const theta0 = t0 > Math.PI ? t0 - TAU : t0;
    const phi0 = Math.acos(1 - random() * 1.3);
    const sx = Math.sin(phi0) * Math.sin(theta0);
    const sy = Math.cos(phi0);
    const sz = Math.sin(phi0) * Math.cos(theta0);
    const onCrown = phi0 < 1.05 && sz > -0.3;
    if (onCrown ? sz > 0.64 && Math.abs(sx) < 0.36 : sz > -0.05 && Math.abs(sx) < 0.72) continue;
    const side = sx >= 0 ? 1 : -1;
    const length = 0.28 + random() * 0.26;
    const flare = 0.02 + random() * 0.05;
    const wave = random() * TAU;
    const half = 0.0008 + random() * 0.001;
    let px = 0;
    let py = 0;
    let pz = 0;
    let theta = theta0;
    for (let j = 0; j <= SEGMENTS; j++) {
      const u = j / SEGMENTS;
      let x: number;
      let y: number;
      let z: number;
      if (onCrown && u <= HUG) {
        const v = u / HUG;
        theta = theta0 + (side * 1.75 - theta0) * v;
        const phi = phi0 + (1.5 - phi0) * v;
        const r = 1.03;
        x = Math.sin(phi) * Math.sin(theta) * rx * r;
        y = crown + Math.cos(phi) * ry * r;
        z = Math.sin(phi) * Math.cos(theta) * rz * r;
        px = x;
        py = y;
        pz = z;
      } else {
        const v = onCrown ? (u - HUG) / (1 - HUG) : u;
        if (!onCrown) {
          px = sx * rx;
          py = crown + sy * ry;
          pz = sz * rz;
        }
        const out = flare * Math.sqrt(v);
        const sway = Math.sin(v * 8 + wave) * 0.007 * v;
        x = px + Math.sin(theta) * out + sway;
        y = py - length * v;
        z = pz + Math.cos(theta) * out + sway * 0.6;
      }
      const w = half * (1 - 0.65 * u);
      position.push(x + Math.cos(theta) * w, y, z - Math.sin(theta) * w, x - Math.cos(theta) * w, y, z + Math.sin(theta) * w);
      normal.push(Math.sin(theta), 0.1, Math.cos(theta), Math.sin(theta), 0.1, Math.cos(theta));
      if (j < SEGMENTS) {
        const a = placed * (2 * (SEGMENTS + 1)) + j * 2;
        index.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
    placed++;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3));
  g.setIndex(index);
  return g;
}

/** A flat white image: for what only wants a color, so that it shares its shader with the pictures. */
function whitePixel(): CanvasTexture {
  const { canvas, c } = canvasOf(2, 2);
  c.fillStyle = '#fff';
  c.fillRect(0, 0, 2, 2);
  return pictureOf(canvas, false);
}

/** A glass eye: a dark disc that is lost in the dark and reads on a pale face. */
function darkEye(): CanvasTexture {
  const { canvas, c } = canvasOf(64, 64);
  const g = c.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(4,4,8,1)');
  g.addColorStop(0.6, 'rgba(6,5,8,0.9)');
  g.addColorStop(1, 'rgba(6,5,8,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return pictureOf(canvas);
}

interface DollSpec {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  s: number;
  group: number;
}

interface Crowd {
  bodies: PropCrowd;
  heads: PropCrowd;
  used: number;
  dirty: boolean;
  /** Points (x, y, z) that say whether any of it could be in view. */
  probes: Float32Array;
  /** How many of it stand within NEAR_RINGS: they come first. */
  inner: number;
}

interface Band {
  mesh: Mesh;
  material: MeshBasicMaterial;
  map: Texture;
  base: number;
  /** Which way the wall lies (a unit x, z): the bulb swinging toward it shortens the shadow on it. */
  nx: number;
  nz: number;
}

/**
 * An attic made into a child's room, and all of it dolls: shelves on every wall, rows across the floor, every one
 * of them turned to where you stand. What is out of sight moves, a little, every time you look away, and only then.
 * The big one in the chair by the window has its back to you until, the one time you are looking at your feet, it is not there.
 */
export default class Dolls extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x0a0f10, density: 0.045 },
    env: 'evening',
    envIntensity: 0.05,
    sky: 0,
    grade: { exposure: 1.28, saturation: 0.82, warmth: 0.02, tint: -0.02, flare: 0.002 },
  };
  film = { bloom: 0.62, bloomFrom: 0.8, grain: 0.42, scratches: 0.04, flicker: 0.02, weave: 0.0005 };
  focus = 2.6;
  aperture = 4.5;
  drift = 0.4;
  fear = 0.35;

  private readonly clocks: { value: number }[] = [];

  // the lamp and its cord
  private readonly swing = new Group();
  private readonly keyAt: [number, number, number] = [0, 0, 0];
  private readonly keyTo: [number, number, number] = [0, 0, 0];
  private readonly key: SpotSpec;
  private readonly moon: SpotSpec;
  private night!: MeshBasicMaterial;
  private readonly bulb: DreamLight;
  private readonly faceLight: DreamLight;
  private readonly mouthLight: DreamLight;
  private readonly bands: Band[] = [];
  private readonly wedges: MeshBasicMaterial[] = [];

  // the crowd: everything about a doll is a slot in these arrays
  private crowds: Crowd[] = [];
  private ax = new Float32Array(0);
  private ay = new Float32Array(0);
  private az = new Float32Array(0);
  private bx = new Float32Array(0);
  private by = new Float32Array(0);
  private bz = new Float32Array(0);
  private size = new Float32Array(0);
  private face = new Float32Array(0);
  private turnOff = new Float32Array(0);
  private nodOff = new Float32Array(0);
  private rollOff = new Float32Array(0);
  private shown = new Float32Array(0);
  private group = new Uint8Array(0);
  private slot = new Uint16Array(0);
  private glintAt = new Float32Array(0);
  private count = 0;
  private lastTilt = 0;
  private casters!: InstancedMesh;
  private blobs!: InstancedMesh;
  private glints!: BufferAttribute;

  // the big one
  private hero!: Object3D;
  private heroHead!: Object3D;
  private heroJaw!: Object3D;
  private heroBlob!: Mesh;
  private jawRest = 0;
  private heroOut = false;
  private chair!: Object3D;
  private crank: Object3D | null = null;
  private shot = false;

  // the mix
  private readonly beds: RoomVoice[] = [];
  private cordVoice: RoomVoice | null = null;
  private nextCreak = 0;
  private creakIndex = 0;
  private readonly creakOptions: RoomVoiceOptions = { gain: 0.2, pan: 0 };

  // temporaries for what runs every frame
  private readonly v = new Vector3();
  private readonly at = new Vector3();
  private readonly one = new Vector3();
  private readonly q = new Quaternion();
  private readonly euler = new Euler();
  private readonly m = new Matrix4();
  private readonly flatQ = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

  constructor(ctx: RoomContext) {
    super(ctx);
    this.keys = TURN.filter((k) => !(REDUCED_MOTION && k.glance)).map((k) => ({
      t: k.s / this.seconds,
      at: [0, k.y, 0] as const,
      yaw: k.yaw,
      pitch: REDUCED_MOTION && k.pitch < -34 ? -34 : k.pitch,
      fov: k.fov,
    }));

    this.buildAttic();
    this.buildWindow();

    // the bulb: its cord hangs from the ridge, its light goes with it
    const b = this.build;
    this.swing.position.set(0, RIDGE - 0.05, BULB_Z);
    this.root.add(this.swing);
    const white = whitePixel();
    const cord = new Mesh(new CylinderGeometry(0.0045, 0.0045, CORD - 0.21, 6), new MeshBasicMaterial({ map: white, color: 0x100d0a, fog: false }));
    cord.position.y = -(CORD - 0.21) / 2;
    this.swing.add(cord);
    this.kit.paint(this.kit.prop('pull_chain_socket', [0, -CORD + 0.21, 0], { anchor: 'top' }, this.swing), new MeshBasicMaterial({ map: white, color: 0x241c14, fog: false }));
    const glass = [[0, -0.056], [0.02, -0.05], [0.031, -0.03], [0.031, -0.014], [0.019, 0.016], [0.0145, 0.034], [0.0145, 0.052], [0, 0.052]].map(([x, y]) => new Vector2(x, y));
    const lit = new Mesh(new LatheGeometry(glass, 14), new MeshBasicMaterial({ map: white, color: new Color(3.6, 2.5, 1.6), fog: false }));
    lit.position.y = -CORD;
    this.swing.add(lit);
    b.glow(0, -CORD, 0, 0.6, BULB_COLOR, 0.42, this.swing);

    const oy = this.origin.y;
    this.keyAt[0] = this.origin.x;
    this.keyAt[1] = RIDGE - 0.05 - CORD + oy;
    this.keyAt[2] = this.origin.z + BULB_Z;
    this.keyTo[0] = this.origin.x;
    this.keyTo[1] = oy;
    this.keyTo[2] = this.origin.z + BULB_Z;
    this.key = { position: this.keyAt, target: this.keyTo, color: BULB_COLOR, intensity: KEY_LIGHT, angle: KEY_ANGLE, penumbra: 1 };
    this.moon = this.spot([0.2, 3.1, -5.6], [0.3, 0.2, -1.5], MOON_COLOR, MOON_KEY, 26, 0.8);
    this.spots = [this.key, this.moon, null];
    this.bulb = this.light([0, RIDGE - 0.05 - CORD, BULB_Z], BULB_COLOR, FILL_LIGHT, 8);
    this.light([0.1, 1.55, Z_FRONT + 0.5], MOON_COLOR, MOON_FILL, 3.4);
    this.light([0, 0.7, 1.7], BULB_COLOR, BOUNCE_LIGHT, 5.5);
    this.faceLight = this.light([0.6, 1.25, -0.32], BULB_COLOR, 0, 2.8);
    this.mouthLight = this.light([FRONT_X * 0.82, 0.92, FRONT_Z * 0.68], BULB_COLOR, 0, 0.6);

    this.buildFurniture();
    this.layOutDolls();
    this.buildBands();
    this.clocks.push(b.motes(170, { x: [-W + 0.3, W - 0.3], y: [0.15, RIDGE - 0.2], z: [Z_FRONT + 0.2, Z_BACK - 0.2] }, this.root).time);

    this.scoreSound();
    this.beat(4, () => this.say({ tr: 'Bakmadığın zaman.', en: 'When you are not looking.' }, 4.5));
    this.beat(LINE_AT, () => this.say({ tr: 'Sana benziyor.', en: 'It looks like you.' }, 3.8));
    this.beat(CUT_AT, () => this.sound.stopAll(0.05));
  }

  private buildAttic(): void {
    const { kit, build: b, root } = this;
    const add = (g: BufferGeometry, m: Material): Mesh => {
      const mesh = new Mesh(g, m);
      mesh.receiveShadow = true;
      root.add(mesh);
      return mesh;
    };
    const boards = kit.surface('wood_raw_boards', 1.4, { color: new Color(0xb4a48e), roughness: 0.95 });
    const dark = kit.surface('wood_dark_paint', 1.6, { color: new Color(0xd8c8b0), roughness: 0.85 });
    const planks = kit.surface('wood_raw_boards', 1.4, { color: new Color(0x8c7a66), roughness: 0.9 });
    const paper = kit.surface('wallpaper_old', 2.5, { color: new Color(0x6b7f78), roughness: 0.92 });
    const damask = b.damask(PALETTE.damaskTeal, 0.62);

    root.add(kit.floor(-W, W, Z_FRONT, Z_BACK, 0, kit.surface('wood_floor_dark', 2, { color: new Color(0xb7b0a2), roughness: 0.82 })));
    add(quadGeometry([W, EAVE, Z_FRONT], [W, EAVE, Z_BACK], [0, RIDGE, Z_BACK], [0, RIDGE, Z_FRONT]), boards);
    add(quadGeometry([-W, EAVE, Z_BACK], [-W, EAVE, Z_FRONT], [0, RIDGE, Z_FRONT], [0, RIDGE, Z_BACK]), boards);
    add(quadGeometry([W, 0, Z_FRONT], [W, 0, Z_BACK], [W, EAVE, Z_BACK], [W, EAVE, Z_FRONT]), paper);
    add(quadGeometry([-W, 0, Z_BACK], [-W, 0, Z_FRONT], [-W, EAVE, Z_FRONT], [-W, EAVE, Z_BACK]), paper);
    add(gableOutline(true), damask).position.z = Z_FRONT;
    const back = add(gableOutline(false), damask);
    back.position.z = Z_BACK;
    back.rotation.y = Math.PI;

    // the roof's bones
    const length = Z_BACK - Z_FRONT;
    const middle = (Z_BACK + Z_FRONT) / 2;
    const bones: BufferGeometry[] = [meterBox(0.15, 0.15, length, [0, RIDGE - 0.075, middle])];
    for (const side of [-1, 1]) {
      bones.push(meterBox(0.12, 0.09, length, [side * (W - 0.05), EAVE + 0.04, middle]));
      for (let z = Z_FRONT + 0.42; z < Z_BACK; z += RAFTER_STEP) {
        const p = slopeAt(side, SLOPE_RUN / 2, z, 0.06);
        bones.push(meterBox(SLOPE_RUN + 0.1, 0.12, 0.085, p, [0, 0, -side * SLOPE_ANGLE]));
      }
    }
    const bonesMesh = add(mergeGeometries(bones), dark);
    bonesMesh.castShadow = false;

    // shelves on the low walls, and on the gables as far out as they go: uneven boards on uprights
    const random = rng(7);
    const wood: BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      for (const y of TIERS) {
        let z = Z_FRONT + 0.02;
        while (z < Z_BACK - 0.05) {
          const len = Math.min(Z_BACK - 0.02 - z, 1.5 + random() * 0.7);
          wood.push(meterBox(0.27, 0.03, len - 0.012, [side * (W - 0.135), y - 0.015 + (random() - 0.5) * 0.008, z + len / 2], [(random() - 0.5) * 0.012, 0, (random() - 0.5) * 0.02]));
          z += len;
        }
      }
      for (let z = Z_FRONT + 0.5; z < Z_BACK; z += 1.3) wood.push(meterBox(0.27, 0.74, 0.036, [side * (W - 0.135), 0.36, z]));
      for (const y of TIERS) {
        wood.push(meterBox(1.9, 0.03, 0.26, [side * 1.9, y - 0.015, Z_FRONT + 0.14]));
        wood.push(meterBox(0.95, 0.03, 0.26, [side * 2.43, y - 0.015, Z_BACK - 0.14]));
      }
      wood.push(meterBox(1.08, 0.03, 0.26, [side * 1.48, TOP_TIER - 0.015, Z_FRONT + 0.14]));
      for (const x of [0.97, 1.52, 2.0]) wood.push(meterBox(0.036, x < 1.9 ? 1.28 : 0.74, 0.26, [side * x, x < 1.9 ? 0.63 : 0.36, Z_FRONT + 0.14]));
      wood.push(meterBox(0.036, 0.74, 0.26, [side * 1.97, 0.36, Z_BACK - 0.14]));
    }
    add(mergeGeometries(wood), planks);

    // damp that came through, and webs in the high corners
    const sheet = (g: BufferGeometry, t: Texture, opacity: number, color = 0x000000): void => {
      const mesh = new Mesh(g, new MeshBasicMaterial({ map: t, color, transparent: true, opacity, depthWrite: false, fog: false }));
      root.add(mesh);
    };
    const damp = waterStain(9);
    sheet(slopeQuad(1, 0.6, 2.5, 0.2, 2.1, 0.008, true), damp, 0.85);
    sheet(slopeQuad(-1, 1.1, 3.0, -2.9, -0.8, 0.008, true), damp, 0.8);
    sheet(slopeQuad(-1, 0.2, 1.6, 1.2, 2.9, 0.008, true), waterStain(23), 0.8);
    sheet(quadGeometry([-1.4, 0.8, Z_FRONT + 0.008], [1.4, 0.8, Z_FRONT + 0.008], [1.4, 2.25, Z_FRONT + 0.008], [-1.4, 2.25, Z_FRONT + 0.008], true), waterStain(31), 0.55);
    const web = cobweb();
    const pale = 0x8f8d84;
    sheet(quadGeometry([0, RIDGE - 0.15, Z_FRONT + 0.02], [0.7, RIDGE - 0.15 - 0.36, Z_FRONT + 0.02], [0.7, RIDGE - 0.75, Z_FRONT + 0.38], [0, RIDGE - 0.15, Z_FRONT + 0.38], true), web, 0.3, pale);
    sheet(quadGeometry([0, RIDGE - 0.15, Z_BACK - 0.02], [-0.8, RIDGE - 0.15 - 0.41, Z_BACK - 0.02], [-0.8, RIDGE - 0.82, Z_BACK - 0.44], [0, RIDGE - 0.15, Z_BACK - 0.44], true), web, 0.3, pale);
    sheet(quadGeometry([W - 0.3, EAVE + 0.1, Z_BACK - 0.02], [W - 1.1, EAVE + 0.5, Z_BACK - 0.02], [W - 1.1, EAVE + 0.5, Z_BACK - 0.5], [W - 0.3, EAVE + 0.1, Z_BACK - 0.5], true), web, 0.26, pale);
    sheet(quadGeometry([-W + 0.3, EAVE + 0.1, Z_FRONT + 0.02], [-W + 1.1, EAVE + 0.5, Z_FRONT + 0.02], [-W + 1.1, EAVE + 0.5, Z_FRONT + 0.5], [-W + 0.3, EAVE + 0.1, Z_FRONT + 0.5], true), web, 0.26, pale);
  }

  private buildWindow(): void {
    const { kit, build: b, root } = this;
    this.night = new MeshBasicMaterial({ map: moonNight(), color: new Color(2.1, 2.3, 2.8), fog: false });
    const night = new Mesh(new PlaneGeometry(2.3, 1.8), this.night);
    night.position.set(0, WINDOW_Y, Z_FRONT - 0.2);
    root.add(night);
    kit.prop('window_wood', [0, WINDOW_Y, Z_FRONT - 0.02], { scale: WINDOW_SCALE, anchor: 'center' }, root);
    b.glow(0, WINDOW_Y, Z_FRONT + 0.1, 2.6, MOON_COLOR, 0.18, root);
    const panes = new Mesh(new PlaneGeometry(1.9, 3.1), new MeshBasicMaterial({ map: moonPanes(), color: new Color(0.05, 0.075, 0.12), transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false }));
    panes.rotation.x = -Math.PI / 2;
    panes.position.set(0.05, 0.008, -2.1);
    root.add(panes);
  }

  /** The heights of a real shelf's boards, found by dropping a line through it. */
  private boardsOf(prop: Object3D, x: number, z: number): number[] {
    prop.updateWorldMatrix(true, true);
    const ray = new Raycaster(this.world(x, 3.5, z), new Vector3(0, -1, 0));
    const ys: number[] = [];
    for (const hit of ray.intersectObject(prop, true)) {
      if (!hit.face || hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y < 0.5) continue;
      const y = hit.point.y - this.origin.y;
      if (y > 0.05 && !ys.some((v) => Math.abs(v - y) < 0.05)) ys.push(y);
    }
    return ys.sort((a, b) => a - b);
  }

  private buildFurniture(): void {
    const { kit, build: b, root } = this;
    this.chair = kit.prop('rocking_chair', [CHAIR_X, 0, CHAIR_Z], { castShadow: true }, root);
    this.chair.rotation.order = 'YXZ';
    this.chair.rotation.y = Math.PI + 0.14;
    // the chair has lost its lacquer; the doll's dress has gone dark with age
    this.chair.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const worn = (mesh.material as MeshStandardMaterial).clone();
      worn.color.setRGB(0.34, 0.24, 0.2);
      mesh.material = worn;
    });
    b.contactShadow(CHAIR_X, CHAIR_Z, 0.62, root, 0.8);

    this.hero = kit.prop('doll', [CHAIR_X, HERO_IN_CHAIR_Y, HERO_IN_CHAIR_Z], { scale: HERO_SCALE, castShadow: true }, root);
    this.hero.rotation.y = Math.PI + 0.14;
    this.hero.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const name = (mesh.material as MeshStandardMaterial).name;
      if (name !== 'doll_dress' && name !== 'doll_porcelain') return;
      const old = (mesh.material as MeshStandardMaterial).clone();
      if (name === 'doll_dress') old.color.setRGB(0.2, 0.17, 0.2);
      else old.color.setRGB(0.1, 0.09, 0.09);
      mesh.material = old;
    });
    this.heroBlob = b.contactShadow(FRONT_X, FRONT_Z, 0.44, root, 0.85);
    this.heroBlob.visible = false;
    this.heroHead = this.hero.getObjectByName('head')!;
    this.heroHead.rotation.order = 'YXZ';
    this.heroJaw = this.hero.getObjectByName('jaw')!;
    this.jawRest = this.heroJaw.position.y;
    const cache: { face?: MeshStandardMaterial } = {};
    this.heroHead.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as MeshStandardMaterial;
      if (material.name !== 'doll_porcelain' || !material.map) return;
      if (!cache.face) {
        cache.face = material.clone();
        cache.face.color.setRGB(1, 0.97, 0.92);
        cache.face.roughness = 0.52;
        cache.face.map = scratchedFace(material.map);
      }
      mesh.material = cache.face;
    });
    // in its mouth, where the teeth would be: the comb of the music box
    const tines: BufferGeometry[] = [meterBox(COMB_WIDTH + 0.012, 0.01, 0.012, [0, COMB_TOP + 0.002, COMB_FRONT - 0.003])];
    for (let k = 0; k < COMB_TINES; k++) {
      const u = k / (COMB_TINES - 1);
      const length = COMB_LONG + (COMB_SHORT - COMB_LONG) * u;
      tines.push(meterBox(0.0024, length, 0.0018, [(u - 0.5) * COMB_WIDTH, COMB_TOP - length / 2, COMB_FRONT]));
    }
    const comb = new Mesh(mergeGeometries(tines), new MeshStandardMaterial({ color: 0xd9d4c4, metalness: 0.75, roughness: 0.32, emissive: 0x3a2c14, emissiveIntensity: 0.9 }));
    const inside = new Mesh(new PlaneGeometry(0.082, 0.056), new MeshBasicMaterial({ map: whitePixel(), color: 0x010101, fog: false }));
    inside.position.set(0, 0.913, COMB_FRONT - 0.014);
    this.hero.add(comb, inside);
    this.hero.updateWorldMatrix(true, true);
    this.heroHead.attach(comb);
    this.heroHead.attach(inside);
    const hair = new Mesh(whiteHair(), new MeshStandardMaterial({ color: 0xa4a49e, roughness: 0.68, side: DoubleSide }));
    this.hero.add(hair);
    this.hero.updateWorldMatrix(true, true);
    this.heroHead.attach(hair);

    kit.prop('wooden_crate', [2.32, 0, 1.5], {}, root);
    b.contactShadow(2.32, 1.5, 0.8, root, 0.8);
    const box = kit.prop('music_box', [2.3, 0.464, 1.5], { scale: 1.3 }, root);
    box.rotation.y = -Math.PI / 2 - 0.3;
    box.getObjectByName('lid')!.rotation.x = -1.2;
    this.crank = box.getObjectByName('crank') ?? null;

    // the only door, and one picture on it: what you get when you turn your back on them all
    b.door(0, Z_BACK, '-z', root, { width: 0.82, height: 1.78, color: 0x2a211a });
    const photo = b.label(0.24, 0.3, (c, w, h) => {
      c.fillStyle = '#dcd6c6';
      c.fillRect(0, 0, w, h);
      const m = w * 0.07;
      c.fillStyle = '#17120e';
      c.fillRect(m, m, w - 2 * m, h * 0.76);
      c.fillStyle = '#d8ccb0';
      c.fillRect(m * 1.6, h * 0.46, w - 3.2 * m, h * 0.1);
      const random = rng(4);
      c.lineCap = 'round';
      [0.25, 0.42, 0.62, 0.8].forEach((x, k) => {
        c.fillStyle = k === 3 ? '#17120e' : '#3a3026';
        c.fillRect(w * (x - 0.07), h * 0.29, w * 0.14, h * 0.2);
        c.fillStyle = k === 3 ? '#17120e' : '#b8ab95';
        c.beginPath();
        c.arc(w * x, h * 0.22, w * 0.06, 0, TAU);
        c.fill();
        if (k === 3) return;
        for (let n = 0; n < 30; n++) {
          c.strokeStyle = `rgba(250,246,236,${0.4 + random() * 0.5})`;
          c.lineWidth = 0.6 + random() * 1.4;
          const a = random() * TAU;
          const cx = w * x + Math.cos(a) * w * 0.05 * random();
          const cy = h * 0.22 + Math.sin(a) * w * 0.05 * random();
          c.beginPath();
          c.moveTo(cx, cy);
          c.lineTo(cx + (random() - 0.5) * w * 0.14, cy + (random() - 0.5) * w * 0.14);
          c.stroke();
        }
      });
    }, { roughness: 0.55 });
    photo.mesh.position.set(0.02, 1.36, Z_BACK - 0.085);
    photo.mesh.rotation.y = Math.PI;
    photo.mesh.rotation.z = 0.05;
    root.add(photo.mesh);
  }

  private layOutDolls(): void {
    const { kit, root } = this;
    const random = rng(1967);
    const specs: DollSpec[] = [];
    const keepOut: readonly (readonly [number, number, number])[] = [
      [CHAIR_X, CHAIR_Z, 0.66],
      [2.32, 1.1, 0.62],
      [2.32, 1.9, 0.62],
    ];
    const blocked = (x: number, z: number) => keepOut.some(([kx, kz, r]) => Math.hypot(x - kx, z - kz) < r);

    // rings of them round where you stand, and the further from you the larger: nobody will measure it
    RINGS.forEach((ring, k) => {
      const n = Math.round((TAU * ring.from) / ring.step);
      for (let j = 0; j < n; j++) {
        const a = ((j + (k % 2) * 0.5) / n) * TAU + (random() - 0.5) * 0.03;
        const r = ring.from + (random() - 0.5) * 0.04;
        const x = r * Math.sin(a);
        const z = -r * Math.cos(a);
        if (Math.abs(x) > W - 0.44 || z < Z_FRONT + 0.52 || z > Z_BACK - 0.68 || blocked(x, z)) continue;
        let end = ring.to + (j % 2 ? ZIG : 0);
        while (Math.hypot(end * Math.sin(a) - FRONT_X, -end * Math.cos(a) - FRONT_Z) < 0.42) end += 0.06;
        const sector = Math.floor((((a % TAU) + TAU) % TAU) / TAU * SECTORS) % SECTORS;
        specs.push({ ax: x, ay: 0, az: z, bx: end * Math.sin(a), by: 0, bz: -end * Math.cos(a), s: 0.86 + k * 0.1 + (random() - 0.5) * 0.14, group: sector });
      }
    });

    // the shelves
    for (const side of [1, -1]) {
      const wall = side > 0 ? GROUP_RIGHT : GROUP_LEFT;
      for (const y of TIERS) {
        for (let z = Z_FRONT + 0.28; z < Z_BACK - 0.24; z += 0.34 + random() * 0.06) {
          const x = side * (W - 0.15);
          specs.push({ ax: x, ay: y, az: z, bx: x - side * 0.08, by: y, bz: z, s: 0.84 + random() * 0.3, group: wall + (z < 0 ? 0 : 1) });
        }
      }
      const half = side > 0 ? 1 : 0;
      for (const y of TIERS) {
        for (let u = 1.1; u < 2.8; u += 0.3) specs.push({ ax: side * u, ay: y, az: Z_FRONT + 0.14, bx: side * u, by: y, bz: Z_FRONT + 0.2, s: 0.84 + random() * 0.3, group: GROUP_FRONT + half });
        for (let k = 0; k < 3; k++) {
          const x = side * (2.1 + k * 0.28);
          specs.push({ ax: x, ay: y, az: Z_BACK - 0.14, bx: x, by: y, bz: Z_BACK - 0.2, s: 0.84 + random() * 0.3, group: GROUP_BACK + half });
        }
      }
      for (let u = 1.1; u < 1.9; u += 0.3) specs.push({ ax: side * u, ay: TOP_TIER, az: Z_FRONT + 0.14, bx: side * u, by: TOP_TIER, bz: Z_FRONT + 0.2, s: 0.82 + random() * 0.16, group: GROUP_FRONT + half });
    }
    const onBoards = (prop: Object3D, cx: number, cz: number, width: number, dir: number, group: number): void => {
      const boards = this.boardsOf(prop, cx + width * 0.27, cz);
      boards.forEach((y, k) => {
        const gap = (boards[k + 1] ?? RIDGE - Math.abs(cx) * ((RIDGE - EAVE) / W)) - y;
        if (gap < 0.2) return;
        const s = clamp((gap - 0.05) / 0.43, 0.46, 1.1);
        const n = Math.floor(width / (0.15 + 0.1 * s));
        for (let j = 0; j < n; j++) {
          const x = cx + (j - (n - 1) / 2) * (width / n);
          specs.push({ ax: x, ay: y, az: cz, bx: x, by: y, bz: cz + dir * 0.05, s: s * (0.92 + random() * 0.1), group: group + (x > 0 ? 1 : 0) });
        }
      });
    };
    for (const side of [1, -1]) {
      const shelf = kit.prop('bookshelf_worn', [side * 1.22, 0, Z_BACK - 0.27], { scale: 0.9, rotation: [0, 180, 0], castShadow: true }, root);
      onBoards(shelf, side * 1.22, Z_BACK - 0.24, 1.08, -1, GROUP_BACK);
    }
    // three stand on the crate
    for (const z of [1.08, 1.92]) specs.push({ ax: 2.32, ay: 0.464, az: z, bx: 2.3, by: 0.464, bz: z, s: 1, group: GROUP_RIGHT + 1 });

    const n = specs.length;
    this.count = n;
    this.ax = new Float32Array(n);
    this.ay = new Float32Array(n);
    this.az = new Float32Array(n);
    this.bx = new Float32Array(n);
    this.by = new Float32Array(n);
    this.bz = new Float32Array(n);
    this.size = new Float32Array(n);
    this.face = new Float32Array(n);
    this.turnOff = new Float32Array(n);
    this.nodOff = new Float32Array(n);
    this.rollOff = new Float32Array(n);
    this.shown = new Float32Array(n).fill(-1);
    this.group = new Uint8Array(n);
    this.slot = new Uint16Array(n);
    this.glintAt = new Float32Array(n * 6);

    const counts = new Array<number>(GROUPS).fill(0);
    for (const d of specs) counts[d.group]++;
    this.crowds = counts.map((c, g) => {
      const bodies = kit.props('doll_low', Math.max(1, c), { nodes: ['body'] });
      const heads = kit.props('doll_low', Math.max(1, c), { nodes: ['head'] });
      root.add(bodies.root, heads.root);
      // who could be in view: the corners and the middle of its share of the room
      const probes: number[] = [];
      if (g < SECTORS) {
        for (const a of [g, g + 0.5, g + 1]) for (const r of [0.45, 1.2, 2.2, 3.2]) probes.push(Math.sin((a / SECTORS) * TAU) * r, 0.3, -Math.cos((a / SECTORS) * TAU) * r);
      } else {
        for (const d of specs) if (d.group === g && probes.length < 90) probes.push(d.ax, d.ay + 0.3, d.az);
      }
      let inner = 0;
      if (g < SECTORS) for (const d of specs) if (d.group === g && Math.hypot(d.ax, d.az) < NEAR_RINGS) inner++;
      return { bodies, heads, used: 0, dirty: true, probes: new Float32Array(probes), inner };
    });

    // shadows are cast by a shape of a few faces, so that the swinging bulb costs nothing
    const shape = mergeGeometries([
      new CylinderGeometry(0.05, 0.085, 0.29, 7, 1, false).translate(0, 0.145, 0),
      new SphereGeometry(0.075, 7, 5).translate(0, 0.355, 0),
    ]);
    const dot = softDot();
    this.casters = new InstancedMesh(shape, new MeshBasicMaterial({ map: dot, colorWrite: false, depthWrite: false, transparent: true, fog: false }), n);
    this.casters.castShadow = true;
    this.casters.frustumCulled = false;
    root.add(this.casters);

    this.blobs = new InstancedMesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: dot, color: 0x000000, transparent: true, opacity: 0.72, depthWrite: false, fog: false }), n);
    this.blobs.frustumCulled = false;
    root.add(this.blobs);

    const geometry = new BufferGeometry();
    this.glints = new BufferAttribute(this.glintAt, 3);
    geometry.setAttribute('position', this.glints);
    const eyes = new Points(geometry, new PointsMaterial({ size: EYE_SIZE, map: darkEye(), transparent: true, depthWrite: false, sizeAttenuation: true }));
    const glintPoints = new Points(geometry, new PointsMaterial({ size: GLINT_SIZE, map: dot, color: new Color(1.9, 1.6, 1.2), transparent: true, blending: AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    eyes.frustumCulled = false;
    glintPoints.frustumCulled = false;
    root.add(eyes, glintPoints);

    // the crowd's own heads and cloth
    const wigs = new Map<string, MeshStandardMaterial>();
    const tint = new Color();
    this.crowds.forEach((crowd, g) => {
      const hair = HAIR[g % HAIR.length];
      crowd.heads.root.traverse((o) => {
        const mesh = o as InstancedMesh;
        if (!mesh.isInstancedMesh) return;
        const material = mesh.material as MeshStandardMaterial;
        if (!material.map) return;
        let wig = wigs.get(hair);
        if (!wig) {
          wig = material.clone();
          wig.map = paintedHead(material.map, hair);
          wig.color.setRGB(0.82, 0.77, 0.7);
          wigs.set(hair, wig);
        }
        mesh.material = wig;
      });
      crowd.bodies.root.traverse((o) => {
        const mesh = o as InstancedMesh;
        if (!mesh.isInstancedMesh || (mesh.material as MeshStandardMaterial).name !== 'doll_dress') return;
        for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, tint.setHex(DRESSES[Math.floor(random() * DRESSES.length)]));
        mesh.instanceColor!.needsUpdate = true;
      });
    });

    specs.forEach((d, i) => {
      this.ax[i] = d.ax;
      this.ay[i] = d.ay;
      this.az[i] = d.az;
      this.bx[i] = d.bx;
      this.by[i] = d.by;
      this.bz[i] = d.bz;
      this.size[i] = d.s;
      this.face[i] = Math.atan2(-d.ax, -d.az);
      this.turnOff[i] = (random() - 0.5) * 0.85;
      this.nodOff[i] = -0.1 + random() * 0.32;
      this.rollOff[i] = (random() - 0.5) * 0.3;
      this.group[i] = d.group;
      this.slot[i] = this.crowds[d.group].used++;
      this.shown[i] = 0;
      this.placeDoll(i, 0, 0);
    });
    this.commit();

    // the trail each leaves in the dust, per sector so that they appear only behind your back
    const R = 4.4;
    const S = 1024;
    const { canvas, c } = canvasOf(S, S);
    c.lineCap = 'round';
    for (const d of specs) {
      if (d.ay > 0) continue;
      const px = (x: number) => ((x / R + 1) / 2) * S;
      const py = (z: number) => ((z / R + 1) / 2) * S;
      for (let k = 0; k < 3; k++) {
        const o = (k - 1) * 0.022;
        const heading = Math.atan2(-d.ax, -d.az);
        const nx = o * Math.cos(heading);
        const nz = -o * Math.sin(heading);
        c.strokeStyle = `rgba(0,0,0,${0.3 + random() * 0.45})`;
        c.lineWidth = 3 + random() * 5;
        c.beginPath();
        c.moveTo(px(d.ax + nx), py(d.az + nz));
        c.lineTo(px(d.bx + nx), py(d.bz + nz));
        c.stroke();
      }
    }
    const trails = pictureOf(canvas);
    const step = TAU / SECTORS;
    for (let k = 0; k < SECTORS; k++) {
      const material = new MeshBasicMaterial({ map: trails, color: 0x000000, transparent: true, opacity: 0, depthWrite: false, fog: false });
      const wedge = new Mesh(new CircleGeometry(R, 10, Math.PI / 2 - (k + 1) * step, step), material);
      wedge.rotation.x = -Math.PI / 2;
      wedge.position.y = 0.005;
      root.add(wedge);
      this.wedges.push(material);
    }
  }

  private buildBands(): void {
    const texture = crowdShadow();
    const make = (geometry: BufferGeometry, base: number, nx: number, nz: number, place: (mesh: Mesh) => void): void => {
      const map = texture.clone();
      map.needsUpdate = true;
      const material = new MeshBasicMaterial({ map, color: 0x000000, transparent: true, opacity: 0, depthWrite: false, fog: false });
      const mesh = new Mesh(geometry, material);
      place(mesh);
      this.root.add(mesh);
      this.bands.push({ mesh, material, map, base, nx, nz });
    };
    const lift = 0.012;
    for (const side of [1, -1]) {
      // one strip up the low wall and on up the slope
      const [za, zb] = side > 0 ? [Z_FRONT, Z_BACK] : [Z_BACK, Z_FRONT];
      const rows: V3[] = [
        [side * (W - lift), 0, 0],
        [side * (W - lift), EAVE, 0],
        slopeAt(side, SLOPE_RUN, 0, lift),
      ];
      const vs = [0, EAVE, EAVE + SLOPE_RUN];
      const p = new Float32Array(18);
      const uv = new Float32Array(12);
      rows.forEach((r, i) => {
        p.set([r[0], r[1], za, r[0], r[1], zb], i * 6);
        uv.set([za, vs[i], zb, vs[i]], i * 4);
      });
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(p, 3));
      g.setAttribute('uv', new BufferAttribute(uv, 2));
      g.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4]);
      make(g, BAND_LIFT_SIDE, side, 0, () => {});
    }
    make(gableOutline(true), BAND_LIFT_GABLE, 0, -1, (m) => {
      m.position.z = Z_FRONT + lift;
    });
    make(gableOutline(false), BAND_LIFT_GABLE, 0, 1, (m) => {
      m.position.z = Z_BACK - lift;
      m.rotation.y = Math.PI;
    });
  }

  private scoreSound(): void {
    this.beat(0, () => {
      this.beds.push(this.sound.bed(WIND, { gain: 0.1, lowpass: 3000 }));
      this.beds.push(this.sound.bed(HUM, { gain: 0.09 }));
      this.beds.push(this.sound.bed(DRONE, { gain: 0.1, fade: 4 }));
    });
    this.beat(18, () => this.beds.push(this.sound.bed(GLASS, { gain: 0.04, fade: 10 })));
    for (const m of MUSIC) this.beat(m.at, () => this.sound.play(m.file, { gain: 0.36, reverb: 0.25, pan: m.pan, lowpass: m.lowpass }));
    this.beat(9.6, () => this.sound.play(BOX_KEY, { gain: 0.2, reverb: 0.2, pan: 0.7 }));
    this.beat(20.2, () => this.sound.play(BOX_KEY, { gain: 0.2, reverb: 0.2, pan: -0.75 }));
    CLICK_AT.forEach(([at, pan], i) => this.beat(at, () => this.sound.play(CLICKS[i % CLICKS.length], { gain: 0.3, pan, lowpass: 5000, reverb: 0.2 })));
    WOOD_AT.forEach(([at, pan], i) => this.beat(at, () => this.sound.play(WOOD[i % WOOD.length], { gain: 0.25, pan, reverb: 0.2 })));
    BLOCK_AT.forEach(([at, pan], i) => this.beat(at, () => this.sound.play(BLOCKS[i % BLOCKS.length], { gain: 0.3, pan, reverb: 0.15 })));
    this.beat(34.6, () => this.sound.play(RATTLE, { gain: 0.25, pan: -0.7, lowpass: 5000, reverb: 0.2 }));
    this.beat(SWING_AT - 0.3, () => this.sound.play(PULL, { gain: 0.3, reverb: 0.1, pan: 0.2 }));
    this.beat(SWING_AT, () => {
      this.cordVoice = this.sound.bed(CORD_SWING, { gain: 0.3, fade: 3 });
    });
    this.beat(41.6, () => this.sound.play(SNAP, { gain: 0.35, pan: -0.85, reverb: 0.15 }));
    this.beat(SILENCE_AT, () => {
      for (const v of this.beds) v.gain(0, 1.2);
      this.cordVoice?.gain(0.05, 1.2);
    });
    this.beat(DOLL_AT - 0.2, () => this.sound.play(BREATH, { gain: 0.25 }));
    this.beat(JAW_AT, () => {
      this.cordVoice?.gain(0, 0.15);
      this.sound.play(JAW_KNOCK, { gain: 0.5 });
      // the box was going in there all along: what it plays is what is left before it catches
      this.sound.play(BOX_JAW, { gain: 0.5, offset: 2.7 });
    });
    CREAKS.forEach((file, i) => this.beat(LINE_AT + i * 0.09, () => this.sound.play(file, { gain: 0.2, pan: (i - 1) * 0.6 })));
    this.beat(LINE_AT, () => this.sound.play(RATTLE, { gain: 0.25, lowpass: 5000, reverb: 0.2 }));
  }

  /** Puts one doll where it is at `level`, its head as far round as that level allows, tipped by `tilt`. */
  private placeDoll(i: number, level: number, tilt: number): void {
    const sc = this.size[i];
    const heading = this.face[i];
    const x = this.ax[i] + (this.bx[i] - this.ax[i]) * level;
    const y = this.ay[i] + (this.by[i] - this.ay[i]) * level;
    const z = this.az[i] + (this.bz[i] - this.az[i]) * level;
    const crowd = this.crowds[this.group[i]];
    this.one.setScalar(sc);
    this.at.set(x, y, z);
    this.q.setFromAxisAngle(UP, heading);
    this.m.compose(this.at, this.q, this.one);
    crowd.bodies.setMatrix(this.slot[i], this.m);
    this.casters.setMatrixAt(i, this.m);
    this.at.y += 0.006;
    this.one.setScalar(sc * 0.46);
    this.m.compose(this.at, this.flatQ, this.one);
    this.blobs.setMatrixAt(i, this.m);

    const c = Math.cos(heading);
    const s = Math.sin(heading);
    this.at.set(x + (c * HEAD_X + s * HEAD_Z) * sc, y + HEAD_Y * sc, z + (-s * HEAD_X + c * HEAD_Z) * sc);
    const aimYaw = Math.atan2(-this.at.x, -this.at.z);
    const aimUp = Math.atan2(LOOK_AT_Y - this.at.y - EYE_UP * sc, Math.hypot(this.at.x, this.at.z));
    const rest = 1 - level;
    this.euler.set(-(aimUp * level + this.nodOff[i] * rest), aimYaw + this.turnOff[i] * rest, this.rollOff[i] * rest + tilt, 'YXZ');
    this.q.setFromEuler(this.euler);
    this.one.setScalar(sc);
    this.m.compose(this.at, this.q, this.one);
    crowd.heads.setMatrix(this.slot[i], this.m);
    crowd.dirty = true;

    for (let side = 0; side < 2; side++) {
      this.v.set((side * 2 - 1) * EYE_X * sc, EYE_UP * sc, EYE_OUT * sc).applyQuaternion(this.q).add(this.at);
      this.glintAt[i * 6 + side * 3] = this.v.x;
      this.glintAt[i * 6 + side * 3 + 1] = this.v.y;
      this.glintAt[i * 6 + side * 3 + 2] = this.v.z;
    }
  }

  private commit(): void {
    for (const crowd of this.crowds) {
      if (!crowd.dirty) continue;
      crowd.dirty = false;
      crowd.bodies.commit();
      crowd.heads.commit();
    }
    this.casters.instanceMatrix.needsUpdate = true;
    this.blobs.instanceMatrix.needsUpdate = true;
    this.glints.needsUpdate = true;
  }

  private levelAt(s: number): number {
    return Math.ceil(clamp((s - MOVE_FROM) / (MOVE_UNTIL - MOVE_FROM), 0, 1) * MOVE_STEPS) / MOVE_STEPS;
  }

  /** The big doll, by the window or right in front of you. */
  private placeHero(front: boolean): void {
    this.heroOut = front;
    this.heroBlob.visible = front;
    if (front) {
      this.hero.position.set(FRONT_X, 0, FRONT_Z);
      this.hero.rotation.y = Math.atan2(FRONT_X, FRONT_Z);
      this.heroHead.rotation.set(0.1, Math.PI, 0.1);
    } else {
      this.hero.position.set(CHAIR_X, HERO_IN_CHAIR_Y, HERO_IN_CHAIR_Z);
      this.hero.rotation.y = Math.PI + 0.14;
      this.heroHead.rotation.set(0, 0, 0);
    }
  }

  private eyelid(s: number): number {
    let shut = 0;
    for (const at of BLINKS) {
      const d = Math.abs(s - at) / BLINK_HALF;
      if (d < 1) shut = Math.max(shut, 1 - d * d * d * d);
    }
    return shut;
  }

  /** Where in the stereo field a point of the floor lies from where the viewer is looking. */
  private panOf(frame: RoomFrame, x: number, z: number): number {
    this.v.setFromMatrixColumn(frame.view.matrixWorld, 0);
    const r = Math.hypot(x, z) || 1;
    return clamp((this.v.x * x + this.v.z * z) / r, -1, 1) * 0.9;
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    for (const c of this.clocks) c.value = frame.time;
    this.control = s > HOLD_FROM && s < HOLD_UNTIL ? HELD : FREE;
    this.fear = 0.35 + 0.55 * smootherstep(range(18, 46, s));

    // the bulb on its cord
    const near = smootherstep(range(DOLL_AT - 2.6, DOLL_AT, s));
    const grown = smootherstep(range(SWING_AT, SWING_AT + SWING_RAMP, s));
    const amplitude = grown * SWING_ANGLE * (REDUCED_MOTION ? 0.35 : 1);
    const phase = ((s - SWING_AT) * TAU) / SWING_PERIOD;
    const rx = -amplitude * Math.sin(phase);
    const rz = amplitude * 0.42 * Math.sin(phase * 0.5 + 0.6) * Math.sin(phase);
    this.swing.rotation.set(rx, 0, rz);
    const lean = CORD * Math.cos(rz);
    const bulbX = CORD * Math.sin(rz);
    const bulbY = RIDGE - 0.05 - lean * Math.cos(rx);
    const bulbZ = BULB_Z - lean * Math.sin(rx);
    this.keyAt[0] = this.origin.x + bulbX;
    this.keyAt[1] = this.origin.y + bulbY;
    this.keyAt[2] = this.origin.z + bulbZ;
    this.keyTo[0] = this.keyAt[0];
    this.keyTo[2] = this.keyAt[2];
    this.bulb.position.set(this.keyAt[0], this.keyAt[1], this.keyAt[2]);
    const breath = 1 + 0.05 * wobble(frame.time * 0.7, 5);
    const open = smootherstep(range(LINE_AT - 0.8, LINE_AT + 0.3, s));
    this.key.intensity = KEY_LIGHT * breath * (1 - 0.8 * near * (1 - 0.5 * open));
    this.bulb.intensity = FILL_LIGHT * breath * (1 - 0.82 * near * (1 - 0.45 * open));
    this.night.color.setRGB(2.1 - 1.15 * near, 2.3 - 1.25 * near, 2.8 - 1.4 * near);
    this.moon.intensity = MOON_KEY * (1 - 0.45 * near);

    // only what could be in view is drawn
    const steep = frame.view.getWorldDirection(this.v).y < STEEP;
    for (const crowd of this.crowds) {
      let seen = false;
      for (let p = 0; p < crowd.probes.length && !seen; p += 3) seen = !this.unseen(frame, crowd.probes[p], crowd.probes[p + 1], crowd.probes[p + 2], CULL_MARGIN);
      crowd.bodies.root.visible = seen;
      crowd.heads.root.visible = seen;
      crowd.bodies.drawn = crowd.heads.drawn = steep && crowd.inner > 0 ? crowd.inner : crowd.used;
    }

    // the crowd's shadow runs up the walls with it
    for (const band of this.bands) {
      band.material.opacity = BAND_OPACITY * (BAND_AT_REST + (1 - BAND_AT_REST) * grown);
      const toward = (band.nx * bulbX + band.nz * (bulbZ - BULB_Z)) / (CORD * SWING_ANGLE);
      band.map.offset.y = BAND_TOP - (band.base - BAND_RUN * toward) / BAND_HEIGHT;
      band.map.offset.x = (band.nz * bulbX - band.nx * (bulbZ - BULB_Z)) * BAND_SLIDE;
    }

    // the lid comes down on its own, twice; and once more if the viewer has not let go of the chair at the last moment
    this.black = s >= CUT_AT ? 1 : this.eyelid(s);
    const blind = this.black > BLIND;

    // what is out of view moves
    const level = this.levelAt(s);
    let moved = -1;
    for (let i = 0; i < this.count; i++) {
      if (this.shown[i] === level) continue;
      if (!blind) {
        const hy = this.ay[i] + 0.3 * this.size[i];
        if (!this.unseen(frame, this.ax[i] + (this.bx[i] - this.ax[i]) * this.shown[i], hy, this.az[i] + (this.bz[i] - this.az[i]) * this.shown[i], UNSEEN_MARGIN)) continue;
        if (!this.unseen(frame, this.ax[i] + (this.bx[i] - this.ax[i]) * level, hy, this.az[i] + (this.bz[i] - this.az[i]) * level, UNSEEN_MARGIN)) continue;
      }
      this.shown[i] = level;
      this.placeDoll(i, level, 0);
      moved = i;
    }
    for (let k = 0; k < SECTORS; k++) {
      const a = ((k + 0.5) / SECTORS) * TAU;
      if (blind || this.unseen(frame, Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2, 18)) this.wedges[k].opacity = 0.75 * level;
    }
    if (moved >= 0 && s >= this.nextCreak) {
      this.nextCreak = s + 1 + Math.random() * 1.5;
      this.creakOptions.pan = this.panOf(frame, this.ax[moved], this.az[moved]);
      this.sound.play(CREAKS[this.creakIndex++ % CREAKS.length], this.creakOptions);
    }

    // this once, in plain sight, all of them together
    const tilt = smootherstep(range(LINE_AT, LINE_AT + TILT_SECONDS, s)) * TILT;
    let wrote = moved >= 0;
    if (tilt !== this.lastTilt) {
      this.lastTilt = tilt;
      for (let i = 0; i < this.count; i++) this.placeDoll(i, this.shown[i], tilt);
      wrote = true;
    }
    if (wrote) this.commit();
    this.movingShadows = wrote || grown > 0;

    // the big one: only ever changes place when neither the chair nor the place before you is seen
    const wanted = s >= 36;
    if (wanted !== this.heroOut) {
      const clear = this.unseen(frame, CHAIR_X, 1, CHAIR_Z, 10) && this.unseen(frame, FRONT_X, 0.9, FRONT_Z, HERO_MARGIN) && this.unseen(frame, FRONT_X, 0.3, FRONT_Z, HERO_MARGIN);
      if (blind || clear) this.placeHero(wanted);
      else if (wanted && s >= DOLL_AT - 0.6) {
        this.black = 1;
        this.placeHero(wanted);
      }
    }
    if (!this.heroOut && this.unseen(frame, CHAIR_X, 1, CHAIR_Z, 10)) this.heroHead.rotation.y = HERO_GLANCE * Math.min(1, level / 0.7);
    if (this.heroOut) this.heroHead.rotation.z = 0.1 + tilt;
    const since = s - 36;
    this.chair.rotation.x = this.heroOut && since > 0 ? CHAIR_ROCK * Math.exp(-since / CHAIR_FADE) * Math.sin(since * CHAIR_RATE) : 0;
    if (this.crank && this.unseen(frame, 2.3, 0.5, 1.5, 10)) this.crank.rotation.x = level * 9;

    // the jaw falls on its hinge, and bounces once
    const fall = s - JAW_AT;
    const dropped = fall <= 0 ? 0 : Math.min(1, fall / 0.11) * (1 + 0.16 * Math.exp(-fall * 8) * Math.cos(fall * 26));
    this.heroJaw.rotation.x = JAW_OPEN * dropped;
    this.heroJaw.position.y = this.jawRest - JAW_DROP * dropped;
    this.mouthLight.intensity = MOUTH_LIGHT * Math.min(1, Math.max(0, fall) / 0.2);
    if (!this.shot && s >= SHUTTER_AT && (!this.unseen(frame, FRONT_X, 0.98, FRONT_Z, 0) || s >= SHUTTER_AT + 2)) {
      this.shot = true;
      this.shutter();
    }

    // the lens and the face
    const feet = smootherstep(range(FEET_AT - 1.6, FEET_AT, s)) * (1 - near);
    this.focus = 2.7 + (1.15 - 2.7) * feet + (0.74 - 2.7) * near + (1.3 - 0.74) * open;
    this.aperture = (4.5 + 6.5 * near) * (1 - 0.86 * open);
    this.faceLight.intensity = FACE_FILL * smootherstep(range(42, 44.5, s));
  }
}
