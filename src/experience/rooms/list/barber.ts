import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  EllipseCurve,
  Euler,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type Bone,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { SpotSpec } from '../../../config/nightmare.config';
import { meterUVs } from '../../dream/DreamKit';
import { randomFrom, type HeroFigure } from '../../dream/FigureKit';
import type { DreamLight } from '../../dream/LightPool';
import { clamp, DEG, range, wobble } from '../../math';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import { PALETTE } from '../RoomKit';
import type { RoomVoice } from '../RoomSound';

type V3 = readonly [number, number, number];

export const assets: RoomAssets = {
  models: ['comb', 'sink', 'faucet', 'radiator', 'coat_stand', 'chair_ladder', 'mug'],
  materials: ['linen_white'],
  sounds: [
    'rooms/bulb_hum.mp3',
    'rooms/clock_tick.mp3',
    'rooms/road_fog.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/dream_drone_glass.mp3',
    'rooms/hair_fingers.mp3',
    'rooms/hair_pull_wet.mp3',
    'rooms/hair_pull_1.mp3',
    'rooms/hair_pull_2.mp3',
    'rooms/needle_set_1.mp3',
    'rooms/porcelain_click_2.mp3',
    'rooms/tile_drip_1.mp3',
    'rooms/tile_drip_3.mp3',
    'rooms/mourners_lean.mp3',
    'rooms/glass_creak_1.mp3',
    'rooms/sheets_thousand.mp3',
    'rooms/nails_scrape_1.mp3',
    'rooms/nails_scrape_3.mp3',
  ],
};

/** The shop (m): half its width, its back wall (the glass is in the wall z = 0, the shop lies toward +z), its ceiling, the panelling. */
const HALF_W = 1.3;
const BACK_Z = 3.7;
const H = 2.95;
const WAINSCOT = 1.1;
/** The glass (m): half its width, its foot and its top; the frame round it, its width and how far it stands out. */
const GLASS_HALF = 0.6;
const GLASS_Y0 = 0.86;
const GLASS_Y1 = 1.98;
const FRAME_W = 0.085;
const FRAME_D = 0.045;
/** The counter under the glass (m): its top, its depth, where it ends on the left; the basin beyond that end. */
const COUNTER_Y = 0.8;
const COUNTER_D = 0.44;
const COUNTER_X0 = -0.66;
const BASIN_X = -0.99;
/** The bare bulb on its cord (m). */
const BULB: V3 = [-0.1, 1.95, 0.4];
/** The street door in the back wall (m): its middle, width, height, and the gap under it. */
const DOOR_X = -1.0;
const DOOR_W = 0.62;
const DOOR_H = 2.12;
const DOOR_GAP = 0.05;
/** The neck of the one in the chair, who is not there: the cape hangs from it (m). */
const NECK_Y = 1.19;
const NECK_Z = 1.6;
/** The eye in the chair and its slow push toward the glass (m; lens in deg). */
const EYE_FROM: V3 = [0, 1.36, 1.55];
const EYE_TO: V3 = [0, 1.35, 1.52];
const FOV_FROM = 50;
const FOV_STOP = 44;
const FOV_HELD = 38;
const FOV_TO = 36;

/** Seconds of the room: the hair goes grey, then white; the scissors stop; the hands leave the head; the scissors are laid down and the hand mirror taken up; it is held still; the shutter; it is put down; the broom; its last stroke; the line; the cut. */
const GREY_AT = 9;
const WHITE_AT = 11.5;
const SCISSORS_STOP = 17;
const HANDS_DOWN = 17.5;
const LAID = 18;
const MIRROR_UP = 18.9;
const SHUTTER_AT = 19.6;
const MIRROR_DOWN = 21.2;
const MIRROR_LAID = 21.7;
const SWEEP_AT = 22;
const LINE_AT = 24;
const CUT_AT = 27.5;
/** The narrator speaks over the room at these seconds; from this long before to this long after each, nothing of the room is loud (s). */
const NARRATOR = [3, 12] as const;
const HUSH: readonly [number, number] = [1.5, 4.5];

/** The cutting (s): when the first pass begins, how long one pass of comb and scissors lasts, when in a pass the blades close. */
const CUT_FROM = 0.45;
const PASS = 2.6;
const SNIPS = [0.95, 1.22, 1.49, 1.76] as const;
/** How wide the blades stand open (rad), how long they take to close and to open again (s). */
const OPEN = 0.42;
const CLOSING = 0.05;
const OPENING = 0.16;

/** Where the barber stands in the glass (the shop behind it lies toward -z), and how far he is turned toward the cape (deg). */
const BARBER_AT: V3 = [0.3, 0, -2.0];
const BARBER_TURN = -28;
/** The middle of the head that is not there, in the glass (m). */
const HEAD: V3 = [0, 1.37, -1.6];
/** Where on that head each pass works (m from its middle; -z is the back of the head, +x his side). */
const WORK: readonly V3[] = [
  [-0.07, 0.08, -0.08],
  [-0.02, 0.12, -0.06],
  [0.05, 0.1, -0.08],
  [0.1, 0.05, -0.05],
  [0.11, 0.0, -0.06],
  [0.04, 0.05, -0.11],
  [-0.05, 0.06, -0.1],
];
/** How far his comb and his scissors keep to either side of the lock they work on; where his shoulders are (m). */
const HAND_APART = 0.035;
const SHOULDER_Y = 1.42;
const SHOULDER_HALF = 0.18;
/** How far his fingers close round what they hold (rad at each joint): the thumb less. */
const FINGER_CURL = 0.55;
const THUMB_CURL = 0.25;
/** His stand at his left, and its top (m). */
const STAND: V3 = [0.66, 0, -1.98];
const STAND_TOP = 0.96;
/** The hand mirror held behind the head (m from the head's middle) and its tilt (rad). */
const HELD: V3 = [0.03, 0.03, -0.21];
const HELD_TILT: V3 = [-0.1, -0.12, 0.04];
/** The barber's clothes are tinted by this (all but white): it keeps his material his own, so that it can be made a white coat. */
const COAT_TINT = 0xfffffe;
/** His neck, and the head on it, are folded to this scale into the collar. */
const NECK_FOLD = 0.001;
/** Where he goes to sweep, with his back to the glass and the door before him (m, deg); when his strokes run and how long one lasts (s). */
const SWEEP_SPOT: V3 = [-0.35, 0, -2.5];
const SWEEP_TURN = -152;
const STROKES_AT = 22.8;
const STROKES_END = 24.6;
const STROKE = 0.9;
/** Where the head of the broom goes in a stroke, in his own frame (m: to his left, ahead), and how high its handle stands. */
const STROKE_FROM: readonly [number, number] = [0.26, 0.3];
const STROKE_TO: readonly [number, number] = [0.46, 0.7];
const BROOM_TOP = 1.22;
/** Where each tool is held (m, in the tool's own frame). */
const SCISSORS_GRIP: V3 = [0, 0, -0.11];
const COMB_GRIP: V3 = [0, 0, -0.16];
const MIRROR_GRIP: V3 = [0, -0.28, -0.015];
const BROOM_HIGH: V3 = [0, 1.08, 0];
const BROOM_LOW: V3 = [0, 0.8, 0];

/** The neck band of the cape stands this high round the neck that is not there (m). */
const COLLAR = 0.05;
/** The cape's outline from collar to hem in front, at the side and at the back: (out from the neck's axis, height), m. */
const CAPE_FRONT: readonly (readonly [number, number])[] = [[0.07, NECK_Y + COLLAR], [0.075, NECK_Y], [0.13, 1.155], [0.17, 1.0], [0.23, 0.84], [0.45, 0.77], [0.55, 0.66], [0.58, 0.42]];
const CAPE_SIDE: readonly (readonly [number, number])[] = [[0.07, NECK_Y + COLLAR], [0.075, NECK_Y], [0.17, 1.165], [0.235, 1.12], [0.26, 0.99], [0.3, 0.86], [0.36, 0.75], [0.39, 0.47]];
const CAPE_BACK: readonly (readonly [number, number])[] = [[0.07, NECK_Y + COLLAR], [0.075, NECK_Y], [0.13, 1.15], [0.16, 1.0], [0.18, 0.88], [0.2, 0.76], [0.22, 0.64], [0.23, 0.53]];
/** Rows and columns of the cape, how deep its folds hang at the hem (m). */
const CAPE_ROWS = 30;
const CAPE_COLS = 96;
const FOLD = 0.03;

/** Hair: black clippings already on the cape and on the floor, the white that comes from the grey on, strands that fall close before the eye; tufts cut at a snip before and after the grey. */
const ON_CAPE = 28;
const ON_FLOOR = 130;
const DELUGE = 1100;
const AT_LENS = 22;
const PER_SNIP = [2, 3] as const;
/** On this side of the glass hair falls right past the eye, so it is drawn finer: no lock wider or longer than this (m), and none longer than NEAR_CLOSEST that starts within NEAR_EYE of the eye (m). */
const NEAR_WIDEST = 0.0025;
const NEAR_LONGEST = 0.05;
const NEAR_EYE = 0.25;
const NEAR_CLOSEST = 0.022;
/** How fast a tuft falls (m/s). */
const FALL_SPEED: readonly [number, number] = [0.7, 1.05];
/** The heap round the hem at its fullest (m) and how far out it reaches (m). */
const HEAP_TOP = 0.66;
/** The heap's hair is this much darker than what falls and than the river, so that it does not run into the white of the cape. */
const HEAP_SHADE = 0.6;
const HEAP_REACH = 1.12;
const HEAP_RINGS = 24;
const HEAP_ANGLES = 72;
/** The river of hair to the door: its way, its width and height (m), how fast its front runs and the hair in it flows (m/s). */
const RIVER_WAY: readonly V3[] = [[-0.1, 0, NECK_Z + 0.38], [-0.45, 0, 2.55], [-0.75, 0, 3.05], [-0.97, 0, 3.45], [DOOR_X, 0, BACK_Z + 0.02]];
const RIVER_W = 0.5;
const RIVER_H = 0.07;
const RIVER_RUN = 1.3;
const RIVER_FLOW = 0.45;
/** How large one repeat of the drawn mass of hair is (m). */
const FIBRE_TILE = 0.45;

/** The bulb (cd, m): its own light, the same light on the shop in the glass; the spot on the chair in the glass (it casts the shadows); the one on this side. */
const BULB_POWER = 2.2;
const BULB_REACH = 6;
const KEY_POWER = 11;
const KEY_ANGLE = 36;
const NEAR_POWER = 6;
const NEAR_ANGLE = 55;
/** The street's cold light at the door (cd, m), and through its glass onto the floor in the glass (cd, deg). */
const DOOR_POWER = 0.55;
const DOOR_REACH = 3;
const STREET_POWER = 3;
const STREET_ANGLE = 26;
/** How bright the frosted pane of the door is with the street behind it (times its picture). */
const PANE_LIGHT = 0.4;
/** A breath of light at the back of the shop, so that its dark still has shapes (cd, m). */
const BACK_POWER = 0.35;
const BACK_REACH = 3.5;
/** The lens: focused on the chair in the glass (m), how shallow. */
const FOCUS = 3.2;
const APERTURE = 2.2;

/** Gains of the beds, and of one snip. */
const HUM_GAIN = 0.07;
const TICK_GAIN = 0.06;
const STREET_GAIN = 0.07;
const DRONE_GAIN = 0.07;
const GLASS_GAIN = 0.035;
const COMB_GAIN = 0.16;
const ENDLESS_GAIN = 0.16;
const SNIP_GAIN = 0.32;
const DRIP_GAIN = 0.1;

const HAIR_BLACK = new Color(0x0e0c0b);
const HAIR_GREY = new Color(0x77736c);
const HAIR_WHITE = new Color(0xdad6cc);
const UP = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);
const ZERO = new Vector3();
const AXIS_Z = new Vector3(0, 0, 1);

const ease = (v: number): number => v * v * (3 - 2 * v);
const ramp = (a: number, b: number, v: number): number => ease(range(a, b, v));
const v3 = (p: V3): Vector3 => new Vector3(p[0], p[1], p[2]);

/** How much of the heap stands (share of its full height): none before the grey, all when the scissors stop, then the river takes most of it. */
function heapAt(s: number): number {
  return range(GREY_AT + 0.5, SCISSORS_STOP, s) ** 1.6 + 0.06 * range(SCISSORS_STOP, STROKES_AT, s) - 0.58 * ramp(STROKES_AT, STROKES_AT + 4.5, s);
}

/** The color of hair cut at second t. */
function shadeAt(t: number, out: Color): Color {
  return out.copy(HAIR_BLACK).lerp(HAIR_GREY, range(GREY_AT, GREY_AT + 1.5, t)).lerp(HAIR_WHITE, range(GREY_AT + 1.5, WHITE_AT + 0.5, t));
}

/** Whether the narrator may be speaking at second t. */
const hushed = (t: number): boolean => NARRATOR.some((n) => t > n - HUSH[0] && t < n + HUSH[1]);

const f2 = new Vector2();
const s2 = new Vector2();
const b2 = new Vector2();
const vA = new Vector3();
const vB = new Vector3();
const vC = new Vector3();
const vD = new Vector3();
const vE = new Vector3();
const vW = new Vector3();
const vS = new Vector3();
const vN = new Vector3();
const v1 = new Vector3();
const v2 = new Vector3();
const qA = new Quaternion();
const qParent = new Quaternion();
const qLocal = new Quaternion();
const mAim = new Matrix4();

/** A point of a line of [out, height] pairs at v (0..1), through its points. */
function along(points: readonly (readonly [number, number])[], v: number, out: Vector2): Vector2 {
  const n = points.length - 1;
  const f = clamp(v, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(f));
  const t = f - i;
  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(n, i + 2)];
  const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  return out.set(cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1]));
}

/** Where the cape lies at angle a round the neck (0 toward the glass) and v from the collar (0) to the hem (1). */
function capeAt(a: number, v: number, out: Vector3): Vector3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const wf = Math.max(0, c) ** 2;
  const wb = Math.max(0, -c) ** 2;
  const ws = s * s;
  along(CAPE_FRONT, v, f2);
  along(CAPE_SIDE, v, s2);
  along(CAPE_BACK, v, b2);
  const fold = FOLD * ramp(0.3, 1, v) * (0.6 * Math.sin(a * 9 + 0.7 * Math.sin(a * 3)) + 0.4 * Math.sin(a * 14 + 2.1));
  const away = wf * f2.x + ws * s2.x + wb * b2.x + fold;
  const y = wf * f2.y + ws * s2.y + wb * b2.y + v ** 4 * 0.6 * fold;
  return out.set(away * s, y, NECK_Z - away * c);
}

/** The heap's full height at a point of the floor (m): a ring of hair round the hem, highest at the sides and the back. */
function heapFull(x: number, z: number): number {
  const dz = z - NECK_Z;
  const r = Math.hypot(x, dz);
  const a = Math.atan2(x, -dz);
  capeAt(a, 1, vA);
  const hem = Math.hypot(vA.x, vA.z - NECK_Z);
  const front = Math.max(0, Math.cos(a));
  const top = HEAP_TOP * (1 - 0.45 * front) * (0.86 + 0.1 * Math.sin(a * 3 + 1.1) + 0.05 * Math.sin(a * 7.3));
  const rise = ramp(hem + 0.04, hem + 0.3, r);
  const fall = 1 - ramp(hem + 0.36, hem + HEAP_REACH * (1 - 0.3 * front), r);
  const lumps = 1 + 0.12 * Math.sin(x * 23 + z * 17) * Math.sin(x * 11 - z * 29);
  return top * rise * fall * lumps;
}

/** A canvas as a texture. */
function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, repeat = false): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** The old glass: a grey film over all of it, the silver gone black at the edges, foxing. */
function drawGlass(c: CanvasRenderingContext2D, w: number, h: number): void {
  const rand = randomFrom(41);
  c.fillStyle = 'rgba(16,20,18,0.18)';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 520; i++) {
    const side = Math.floor(rand() * 4);
    const depth = rand() ** 2.4 * 0.16;
    const along = rand();
    const x = side === 0 ? depth * w : side === 1 ? w - depth * w : along * w;
    const y = side === 2 ? depth * h : side === 3 ? h - depth * h * 1.3 : along * h;
    const r = 2 + rand() * 16 * (1 - depth * 4);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(10,8,5,${(0.45 + rand() * 0.45).toFixed(2)})`);
    g.addColorStop(1, 'rgba(10,8,5,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 180; i++) {
    c.fillStyle = `rgba(70,52,28,${(0.12 + rand() * 0.25).toFixed(2)})`;
    c.beginPath();
    c.arc(rand() * w, h * (0.35 + rand() ** 0.6 * 0.65), 0.6 + rand() * 2.4, 0, Math.PI * 2);
    c.fill();
  }
}

/** Pale grey marble, veined, yellowed toward the front where hands have rested. */
function drawMarble(c: CanvasRenderingContext2D, w: number, h: number): void {
  const rand = randomFrom(17);
  c.fillStyle = '#b5b1a6';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    const g = c.createRadialGradient(rand() * w, rand() * h, 0, rand() * w, rand() * h, w * (0.1 + rand() * 0.3));
    g.addColorStop(0, `rgba(${rand() < 0.5 ? '90,86,80' : '220,216,206'},0.12)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  for (let v = 0; v < 14; v++) {
    let x = rand() * w;
    let y = rand() * h;
    let a = rand() * Math.PI * 2;
    c.strokeStyle = `rgba(55,52,48,${(0.15 + rand() * 0.35).toFixed(2)})`;
    c.lineWidth = 0.6 + rand() * 2.2;
    c.beginPath();
    c.moveTo(x, y);
    for (let k = 0; k < 60; k++) {
      a += (rand() - 0.5) * 0.7;
      x += Math.cos(a) * 9;
      y += Math.sin(a) * 9;
      c.lineTo(x, y);
    }
    c.stroke();
  }
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(120,96,50,0)');
  g.addColorStop(1, 'rgba(120,96,50,0.22)');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}

/** A tuft's strands, along its length: the rest is cut away. */
function drawStrands(c: CanvasRenderingContext2D, w: number, h: number): void {
  const rand = randomFrom(9);
  c.clearRect(0, 0, w, h);
  for (let i = 0; i < 9; i++) {
    const x = (0.1 + rand() * 0.8) * w;
    const from = rand() * 0.25 * h;
    const to = h - rand() * 0.25 * h;
    c.strokeStyle = `rgba(255,255,255,${(0.65 + rand() * 0.35).toFixed(2)})`;
    c.lineWidth = 1 + rand() * 1.4;
    c.beginPath();
    c.moveTo(x, from);
    c.bezierCurveTo(x + (rand() - 0.5) * 8, h * 0.4, x + (rand() - 0.5) * 8, h * 0.6, x + (rand() - 0.5) * 6, to);
    c.stroke();
  }
}

/** A mass of hair seen from above: fine curving strands over strands, most of them lying one way. */
function drawFibre(c: CanvasRenderingContext2D, w: number, h: number): void {
  const rand = randomFrom(23);
  c.fillStyle = '#6f6c66';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const a = rand() < 0.65 ? Math.PI / 2 + (rand() - 0.5) * 0.7 : rand() * Math.PI * 2;
    const l = 14 + rand() * 60;
    const bend = (rand() - 0.5) * 1.6;
    const light = rand() < 0.62;
    c.strokeStyle = light ? `rgba(240,236,228,${(0.18 + rand() * 0.42).toFixed(2)})` : `rgba(18,17,15,${(0.15 + rand() * 0.3).toFixed(2)})`;
    c.lineWidth = 0.5 + rand() * 1.1;
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + Math.cos(a + bend) * l * 0.5, y + Math.sin(a + bend) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    c.stroke();
  }
}

/** The frosted pane of the street door: the lamp outside, and the shop's name painted for the street, so read from inside backwards. */
function drawDoorPane(c: CanvasRenderingContext2D, w: number, h: number): void {
  const g = c.createRadialGradient(w * 0.28, h * 0.22, 0, w * 0.28, h * 0.22, w * 1.15);
  g.addColorStop(0, '#a9bcc4');
  g.addColorStop(0.45, '#506a74');
  g.addColorStop(1, '#16222a');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  const rand = randomFrom(5);
  for (let i = 0; i < 5000; i++) {
    c.fillStyle = `rgba(255,255,255,${(rand() * 0.07).toFixed(3)})`;
    c.fillRect(rand() * w, rand() * h, 2, 2);
  }
  c.save();
  c.translate(w, 0);
  c.scale(-1, 1);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `bold ${Math.round(h * 0.12)}px Georgia, serif`;
  c.lineWidth = h * 0.012;
  c.strokeStyle = '#7d5c24';
  c.fillStyle = '#0d0a05';
  c.strokeText('BERBER', w / 2, h * 0.4);
  c.fillText('BERBER', w / 2, h * 0.4);
  c.font = `${Math.round(h * 0.045)}px Georgia, serif`;
  c.fillText('SAÇ  ·  SAKAL', w / 2, h * 0.52);
  c.restore();
  const edge = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.7)');
  c.fillStyle = edge;
  c.fillRect(0, 0, w, h);
}

/** A chart of haircuts on yellowed paper: heads in profile, black, with no faces; the fourth is missing. */
function drawChart(c: CanvasRenderingContext2D, w: number, h: number): void {
  const rand = randomFrom(29);
  c.fillStyle = '#a99a76';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 30; i++) {
    const g = c.createRadialGradient(rand() * w, rand() * h, 0, rand() * w, rand() * h, w * (0.05 + rand() * 0.25));
    g.addColorStop(0, 'rgba(90,64,30,0.22)');
    g.addColorStop(1, 'rgba(90,64,30,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  c.strokeStyle = '#3a2c1c';
  c.lineWidth = w * 0.01;
  c.strokeRect(w * 0.05, h * 0.04, w * 0.9, h * 0.92);
  c.fillStyle = '#2a1f14';
  c.textAlign = 'center';
  c.font = `bold ${Math.round(w * 0.075)}px Georgia, serif`;
  c.fillText('SAÇ MODELLERİ', w / 2, h * 0.12);
  const hairs = [0.1, 0.16, 0.05, 0, 0.22, 0.12];
  for (let i = 0; i < 6; i++) {
    const cx = w * (0.3 + 0.4 * (i % 2));
    const cy = h * (0.32 + 0.26 * Math.floor(i / 2));
    const r = w * 0.085;
    c.font = `${Math.round(w * 0.05)}px Georgia, serif`;
    c.fillStyle = '#2a1f14';
    c.fillText(String(i + 1), cx, cy + r * 1.95);
    if (i === 3) {
      c.setLineDash([w * 0.012, w * 0.012]);
      c.strokeStyle = 'rgba(42,31,20,0.45)';
      c.lineWidth = w * 0.006;
      c.beginPath();
      c.ellipse(cx, cy, r, r * 1.2, 0, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
      continue;
    }
    c.fillStyle = '#21180f';
    c.beginPath();
    c.ellipse(cx, cy, r, r * 1.2, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(cx + r * 0.92, cy - r * 0.05);
    c.lineTo(cx + r * 1.22, cy + r * 0.25);
    c.lineTo(cx + r * 0.9, cy + r * 0.35);
    c.fill();
    c.fillRect(cx - r * 0.45, cy + r * 0.8, r * 0.75, r * 0.9);
    c.beginPath();
    c.ellipse(cx - r * 0.12, cy - r * 0.55, r * 1.02, r * (0.62 + hairs[i] * 3), -0.15, Math.PI, Math.PI * 2);
    c.fill();
  }
}

/** The dial of the shop's clock on its square case: it has always said half past six. */
function drawClock(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#24180e';
  c.fillRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const r = w * 0.44;
  const g = c.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#d2c8ad');
  g.addColorStop(1, '#9c8f71');
  c.fillStyle = g;
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#17110a';
  c.lineWidth = w * 0.014;
  c.stroke();
  c.fillStyle = '#17110a';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `${Math.round(w * 0.085)}px Georgia, serif`;
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    c.fillText(String(i), cx + Math.sin(a) * r * 0.78, cy - Math.cos(a) * r * 0.78);
  }
  const hand = (turns: number, length: number, width: number) => {
    c.save();
    c.translate(cx, cy);
    c.rotate(turns * Math.PI * 2);
    c.fillRect(-width / 2, -length, width, length + r * 0.08);
    c.restore();
  };
  hand(6.5 / 12, r * 0.5, w * 0.03);
  hand(0.5, r * 0.72, w * 0.018);
  c.beginPath();
  c.arc(cx, cy, w * 0.025, 0, Math.PI * 2);
  c.fill();
  const age = c.createRadialGradient(cx * 0.8, cy * 1.2, 0, cx, cy, r * 1.1);
  age.addColorStop(0, 'rgba(90,60,20,0)');
  age.addColorStop(1, 'rgba(90,60,20,0.35)');
  c.fillStyle = age;
  c.fillRect(0, 0, w, h);
}

/** A photograph of a street at night behind glass: walls closing in, one lamp, a lit window at its far end. */
function drawStreet(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#cfc6b0';
  c.fillRect(0, 0, w, h);
  const x0 = w * 0.07;
  const y0 = h * 0.09;
  const iw = w - x0 * 2;
  const ih = h - y0 * 2;
  const sky = c.createLinearGradient(0, y0, 0, y0 + ih);
  sky.addColorStop(0, '#2b2721');
  sky.addColorStop(0.55, '#4a4337');
  sky.addColorStop(1, '#1b1813');
  c.fillStyle = sky;
  c.fillRect(x0, y0, iw, ih);
  const vx = x0 + iw * 0.56;
  const vy = y0 + ih * 0.55;
  c.fillStyle = '#100e0b';
  for (const side of [0, 1]) {
    const edge = side ? x0 + iw : x0;
    c.beginPath();
    c.moveTo(edge, y0);
    c.lineTo(vx + (side ? 0.06 : -0.06) * iw, vy - ih * 0.12);
    c.lineTo(vx + (side ? 0.06 : -0.06) * iw, vy + ih * 0.05);
    c.lineTo(edge, y0 + ih);
    c.fill();
  }
  c.fillStyle = '#e8d9a8';
  c.fillRect(vx - iw * 0.018, vy - ih * 0.07, iw * 0.036, ih * 0.05);
  const lamp = c.createRadialGradient(x0 + iw * 0.25, y0 + ih * 0.3, 0, x0 + iw * 0.25, y0 + ih * 0.3, iw * 0.2);
  lamp.addColorStop(0, 'rgba(240,226,180,0.9)');
  lamp.addColorStop(1, 'rgba(240,226,180,0)');
  c.fillStyle = lamp;
  c.fillRect(x0, y0, iw, ih);
  c.strokeStyle = 'rgba(200,190,160,0.12)';
  for (let i = 0; i < 9; i++) {
    c.beginPath();
    c.moveTo(x0 + iw * (i / 8), y0 + ih);
    c.lineTo(vx, vy + ih * 0.05);
    c.stroke();
  }
}

/** The cape, round the neck of nobody. */
function capeGeometry(): BufferGeometry {
  const n = (CAPE_COLS + 1) * (CAPE_ROWS + 1);
  const positions = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  const p = new Vector3();
  for (let i = 0; i <= CAPE_COLS; i++) {
    const a = (i / CAPE_COLS) * Math.PI * 2;
    for (let j = 0; j <= CAPE_ROWS; j++) {
      const k = i * (CAPE_ROWS + 1) + j;
      capeAt(a, j / CAPE_ROWS, p);
      positions[k * 3] = p.x;
      positions[k * 3 + 1] = p.y;
      positions[k * 3 + 2] = p.z;
      uvs[k * 2] = a * 0.42;
      uvs[k * 2 + 1] = (j / CAPE_ROWS) * 1.05;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < CAPE_COLS; i++) {
    for (let j = 0; j < CAPE_ROWS; j++) {
      const a = i * (CAPE_ROWS + 1) + j;
      const c = a + CAPE_ROWS + 1;
      index.push(a, c, a + 1, c, c + 1, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setAttribute('uv1', new BufferAttribute(uvs.slice(), 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** The heap: a ring of floor round the hem whose height is drawn in the shader. */
function heapGeometry(): BufferGeometry {
  const n = (HEAP_ANGLES + 1) * (HEAP_RINGS + 1);
  const positions = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  const heap = new Float32Array(n);
  const slope = new Float32Array(n * 2);
  const e = 0.01;
  for (let i = 0; i <= HEAP_ANGLES; i++) {
    const a = (i / HEAP_ANGLES) * Math.PI * 2;
    capeAt(a, 1, vB);
    const hem = Math.hypot(vB.x, vB.z - NECK_Z);
    for (let j = 0; j <= HEAP_RINGS; j++) {
      const k = i * (HEAP_RINGS + 1) + j;
      const r = hem - 0.08 + (HEAP_REACH + 0.1) * (j / HEAP_RINGS) ** 1.25;
      const x = clamp(Math.sin(a) * r, -HALF_W + 0.01, HALF_W - 0.01);
      const z = clamp(NECK_Z - Math.cos(a) * r, COUNTER_D + 0.01, BACK_Z - 0.01);
      positions[k * 3] = x;
      positions[k * 3 + 2] = z;
      uvs[k * 2] = x;
      uvs[k * 2 + 1] = z;
      heap[k] = heapFull(x, z);
      slope[k * 2] = (heapFull(x + e, z) - heapFull(x - e, z)) / (2 * e);
      slope[k * 2 + 1] = (heapFull(x, z + e) - heapFull(x, z - e)) / (2 * e);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < HEAP_ANGLES; i++) {
    for (let j = 0; j < HEAP_RINGS; j++) {
      const a = i * (HEAP_RINGS + 1) + j;
      const c = a + HEAP_RINGS + 1;
      index.push(a, c, a + 1, c, c + 1, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(n * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setAttribute('aHeap', new BufferAttribute(heap, 1));
  g.setAttribute('aSlope', new BufferAttribute(slope, 2));
  g.setAttribute('aAlong', new BufferAttribute(new Float32Array(n).fill(-1), 1));
  g.setAttribute('aAcross', new BufferAttribute(new Float32Array(n), 1));
  g.setIndex(index);
  return g;
}

/** The river's bed: a strip along its way, its height drawn in the shader; returns its length too. */
function riverGeometry(): { geometry: BufferGeometry; length: number } {
  const curve = new CatmullRomCurve3(RIVER_WAY.map(v3));
  const length = curve.getLength();
  const steps = 70;
  const across = 7;
  const n = (steps + 1) * across;
  const positions = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  const at = new Float32Array(n);
  const side = new Float32Array(n);
  for (let k = 0; k <= steps; k++) {
    const u = k / steps;
    curve.getPointAt(u, vA);
    curve.getTangentAt(u, vB);
    const narrow = 1 - 0.25 * u;
    for (let c = 0; c < across; c++) {
      const s = (c / (across - 1)) * 2 - 1;
      const i = k * across + c;
      const w = (RIVER_W / 2) * narrow * s;
      positions[i * 3] = vA.x + vB.z * w;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = vA.z - vB.x * w;
      uvs[i * 2] = positions[i * 3];
      uvs[i * 2 + 1] = u * length;
      at[i] = u * length;
      side[i] = s;
    }
  }
  const index: number[] = [];
  for (let k = 0; k < steps; k++) {
    for (let c = 0; c < across - 1; c++) {
      const a = k * across + c;
      const b = a + across;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(n * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setAttribute('aHeap', new BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aSlope', new BufferAttribute(new Float32Array(n * 2), 2));
  g.setAttribute('aAlong', new BufferAttribute(at, 1));
  g.setAttribute('aAcross', new BufferAttribute(side, 1));
  g.setIndex(index);
  return { geometry: g, length };
}

/** One tuft of cut hair: when it is cut, where from, where it comes to rest, how long it falls, and the heap under it if it lands on the floor. */
interface Tuft {
  t0: number;
  start: Vector3;
  land: Vector3;
  fall: number;
  floor: number;
  grown: number;
  shade: Color;
  length: number;
  width: number;
  /** It starts right by the eye. */
  near: boolean;
}

/** All the tufts as one mesh: each is a short curling ribbon, placed and turned in the shader. */
function tuftGeometry(tufts: readonly Tuft[], widest = Infinity, longest = Infinity, closest = Infinity): BufferGeometry {
  const rand = randomFrom(57);
  const seg = 5;
  const per = (seg + 1) * 2;
  const n = tufts.length * per;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const col = new Float32Array(n * 3);
  const start = new Float32Array(n * 3);
  const land = new Float32Array(n * 3);
  const fall = new Float32Array(n * 4);
  const floor = new Float32Array(n * 2);
  const index: number[] = [];
  tufts.forEach((t, ti) => {
    const curl = (rand() - 0.5) * 1.4;
    const lie = rand() * Math.PI * 2;
    const seed = rand();
    const length = Math.min(t.length, t.near ? closest : longest);
    for (let k = 0; k <= seg; k++) {
      const f = k / seg;
      const bend = Math.sin(f * Math.PI) * curl * length;
      const w = Math.min(t.width, widest) * (0.35 + 0.65 * Math.sin(Math.PI * (0.15 + 0.7 * f)));
      for (let side = 0; side < 2; side++) {
        const v = ti * per + k * 2 + side;
        pos[v * 3] = (f - 0.5) * length;
        pos[v * 3 + 1] = bend * 0.12;
        pos[v * 3 + 2] = (side - 0.5) * w + bend;
        nor[v * 3 + 1] = 1;
        uv[v * 2] = side;
        uv[v * 2 + 1] = f;
        col[v * 3] = t.shade.r;
        col[v * 3 + 1] = t.shade.g;
        col[v * 3 + 2] = t.shade.b;
        start.set([t.start.x, t.start.y, t.start.z], v * 3);
        land.set([t.land.x, t.land.y, t.land.z], v * 3);
        fall.set([t.t0, t.fall, lie, seed], v * 4);
        floor[v * 2] = t.floor;
        floor[v * 2 + 1] = t.grown;
      }
      if (k < seg) {
        const a = ti * per + k * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('aStart', new BufferAttribute(start, 3));
  g.setAttribute('aLand', new BufferAttribute(land, 3));
  g.setAttribute('aFall', new BufferAttribute(fall, 4));
  g.setAttribute('aFloor', new BufferAttribute(floor, 2));
  g.setIndex(index);
  return g;
}

/** The heap and the river in one shader: a heap vertex has no place along the river (aAlong < 0). */
const MASS_PARS = /* glsl */ `
attribute float aHeap;
attribute vec2 aSlope;
attribute float aAlong;
attribute float aAcross;
uniform float uHeapGrow;
uniform float uRiverFront;
uniform float uRiverFlow;
uniform float uRiverRise;
varying float vMassShade;
`;

/** Hair: tumbling while it falls, lying once it is down; on the floor it sinks with the heap, and what fell during the room melts into it. */
const HAIR_PARS = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aLand;
attribute vec4 aFall;
attribute vec2 aFloor;
uniform float uHairTime;
uniform float uHairGrow;
uniform float uHairMotion;
mat3 hairTurn(vec3 axis, float angle) {
  float s = sin(angle), c = cos(angle), t = 1.0 - c;
  return mat3(
    t * axis.x * axis.x + c, t * axis.x * axis.y + s * axis.z, t * axis.x * axis.z - s * axis.y,
    t * axis.x * axis.y - s * axis.z, t * axis.y * axis.y + c, t * axis.y * axis.z + s * axis.x,
    t * axis.x * axis.z + s * axis.y, t * axis.y * axis.z - s * axis.x, t * axis.z * axis.z + c);
}
`;
const HAIR_NORMAL = /* glsl */ `
float hairAge = uHairTime - aFall.x;
float hairF = clamp(hairAge / aFall.y, 0.0, 1.0);
float hairLie = smoothstep(0.8, 1.0, hairF);
vec3 hairAxis = normalize(vec3(sin(aFall.w * 12.1), 0.35 + 0.5 * cos(aFall.w * 7.3), sin(aFall.w * 5.7 + 1.0)));
mat3 hairSpin = hairTurn(hairAxis, aFall.w * 6.283 + hairAge * (1.6 + 2.2 * fract(aFall.w * 9.1)) * uHairMotion);
float hairC = cos(aFall.z);
float hairS = sin(aFall.z);
mat3 hairRest = mat3(hairC, 0.0, -hairS, 0.0, 1.0, 0.0, hairS, 0.0, hairC);
vec3 objectNormal = normalize(mix(hairSpin * normal, hairRest * normal, hairLie));
`;
const HAIR_PLACE = /* glsl */ `
float hairShow = smoothstep(0.0, 0.12, hairAge);
if (aFloor.x >= 0.0 && aFall.x > 0.0) hairShow *= 1.0 - smoothstep(aFall.y + 0.3, aFall.y + 1.6, hairAge);
vec3 hairLocal = mix(hairSpin * position, hairRest * position, hairLie) * hairShow;
vec3 hairAt = mix(aStart, aLand, hairF * (0.55 + 0.45 * hairF));
float hairAir = 4.0 * hairF * (1.0 - hairF) * uHairMotion;
hairAt.x += hairAir * 0.03 * sin(hairAge * 5.3 + aFall.w * 40.0);
hairAt.z += hairAir * 0.025 * cos(hairAge * 4.1 + aFall.w * 23.0);
if (aFloor.x >= 0.0 && hairF >= 1.0) hairAt.y = max(0.003, aFloor.x * min(aFloor.y, uHairGrow) - 0.008);
vec3 transformed = hairAt + hairLocal;
if (hairAge < 0.0) transformed = vec3(0.0, -40.0, 0.0);
`;

/** Size of the picture in the hand mirror (px), its strands of hair, and where its floor begins (share of its height from the top). */
const PICTURE_W = 96;
const PICTURE_H = 128;
const PICTURE_STRANDS = 18;
const PICTURE_FLOOR = 0.78;

/** One strand of hair in the hand mirror's picture: where it hangs (px), how it bends and sways, how thick it is. */
interface Strand {
  x: number;
  bend: number;
  speed: number;
  phase: number;
  width: number;
}

/** Where a strand of the picture is at height y (px) at second t. */
const strandAt = (s: Strand, y: number, t: number): number => s.x + s.bend * (y / PICTURE_H) ** 2 + 2.2 * Math.sin(y * 0.09 + t * s.speed + s.phase);

/**
 * The picture in the hand mirror, drawn again each frame while it is up: the dim room below the place of a head,
 * and white hair falling from there to the floor and gathering on it.
 */
class MirrorPicture {
  readonly texture: CanvasTexture;
  private readonly c: CanvasRenderingContext2D;
  private readonly room: HTMLCanvasElement;
  private readonly rim: CanvasGradient;
  private readonly crown: CanvasGradient;
  private readonly strands: Strand[] = [];
  private drawn = -1;

  constructor() {
    const rand = randomFrom(61);
    this.room = document.createElement('canvas');
    this.room.width = PICTURE_W;
    this.room.height = PICTURE_H;
    const r = this.room.getContext('2d')!;
    const dark = r.createLinearGradient(0, 0, 0, PICTURE_H);
    dark.addColorStop(0, '#1d1812');
    dark.addColorStop(1, '#0a0807');
    r.fillStyle = dark;
    r.fillRect(0, 0, PICTURE_W, PICTURE_H);
    // the floor far below, its checker running away
    const top = PICTURE_FLOOR * PICTURE_H;
    for (let row = 0; row < 6; row++) {
      const y0 = top + ((PICTURE_H - top) * row ** 1.6) / 6 ** 1.6;
      const y1 = top + ((PICTURE_H - top) * (row + 1) ** 1.6) / 6 ** 1.6;
      for (let col = -4; col < 4; col++) {
        r.fillStyle = (row + col) % 2 ? '#0b0a09' : '#2e2a24';
        const spread = (y: number) => 0.4 + ((y - top) / (PICTURE_H - top)) * 0.9;
        r.beginPath();
        r.moveTo(PICTURE_W / 2 + col * 14 * spread(y0), y0);
        r.lineTo(PICTURE_W / 2 + (col + 1) * 14 * spread(y0), y0);
        r.lineTo(PICTURE_W / 2 + (col + 1) * 14 * spread(y1), y1);
        r.lineTo(PICTURE_W / 2 + col * 14 * spread(y1), y1);
        r.fill();
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = PICTURE_W;
    canvas.height = PICTURE_H;
    this.c = canvas.getContext('2d')!;
    this.rim = this.c.createRadialGradient(PICTURE_W / 2, PICTURE_H / 2, PICTURE_W * 0.3, PICTURE_W / 2, PICTURE_H / 2, PICTURE_H * 0.55);
    this.rim.addColorStop(0, 'rgba(0,0,0,0)');
    this.rim.addColorStop(1, 'rgba(0,0,0,0.75)');
    this.crown = this.c.createRadialGradient(PICTURE_W / 2, -PICTURE_H * 0.05, 0, PICTURE_W / 2, -PICTURE_H * 0.05, PICTURE_W * 0.55);
    this.crown.addColorStop(0, 'rgba(216,210,196,0.55)');
    this.crown.addColorStop(1, 'rgba(216,210,196,0)');
    for (let i = 0; i < PICTURE_STRANDS; i++) {
      this.strands.push({ x: PICTURE_W * (0.2 + 0.6 * rand()), bend: (rand() - 0.5) * PICTURE_W * 0.35, speed: 0.6 + rand() * 0.6, phase: rand() * 6.28, width: 1 + rand() * 2.2 });
    }
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.paint(0, 0, 0, 0);
  }

  /** At second t: how far the hair has come down (0..1), how high it lies on the floor (0..1), how much of it shows. */
  paint(t: number, fall: number, pile: number, show: number): void {
    if (show <= 0 && this.drawn === 0) return;
    const c = this.c;
    c.globalAlpha = 1;
    c.drawImage(this.room, 0, 0);
    if (show > 0) {
      c.globalAlpha = show;
      c.fillStyle = this.crown;
      c.fillRect(0, 0, PICTURE_W, PICTURE_H);
      c.strokeStyle = '#d6d0c2';
      const reach = fall * PICTURE_FLOOR * PICTURE_H * 1.08;
      const steps = 10;
      for (const s of this.strands) {
        c.lineWidth = s.width;
        for (let k = 0; k < steps; k++) {
          const y0 = (k / steps) * reach;
          const y1 = ((k + 1) / steps) * reach;
          c.globalAlpha = show * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(y0 * 0.16 - t * 3.2 * s.speed + s.phase)));
          c.beginPath();
          c.moveTo(strandAt(s, y0, t), y0);
          c.lineTo(strandAt(s, y1, t), y1);
          c.stroke();
        }
      }
      c.globalAlpha = show;
      c.fillStyle = '#c9c3b5';
      c.beginPath();
      c.ellipse(PICTURE_W / 2, PICTURE_H, PICTURE_W * (0.2 + 0.25 * pile), PICTURE_H * (0.02 + 0.2 * pile), 0, Math.PI, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    c.fillStyle = this.rim;
    c.fillRect(0, 0, PICTURE_W, PICTURE_H);
    this.texture.needsUpdate = true;
    this.drawn = show;
  }
}

/** Where pass i works on the head (m from its middle). */
const workAt = (i: number, out: Vector3): Vector3 => out.set(WORK[i % WORK.length][0], WORK[i % WORK.length][1], WORK[i % WORK.length][2]);

/** Turn a bone by a rotation given in the world, whatever its own axes are. */
function turnBone(bone: Bone, delta: Quaternion): void {
  bone.parent!.getWorldQuaternion(qParent);
  qLocal.copy(qParent).invert().multiply(delta).multiply(qParent);
  bone.quaternion.premultiply(qLocal);
}

/** Bring a hand to a point of the world by turning shoulder and elbow; the elbow goes the way of `pole`. */
function reach(upper: Bone, lower: Bone, hand: Bone, target: Vector3, pole: Vector3): void {
  upper.getWorldPosition(vS);
  lower.getWorldPosition(vE);
  hand.getWorldPosition(vW);
  const a = vS.distanceTo(vE);
  const b = vE.distanceTo(vW);
  vD.subVectors(target, vS);
  const d = clamp(vD.length(), Math.abs(a - b) + 0.01, a + b - 0.005);
  vD.normalize();
  const ahead = (a * a - b * b + d * d) / (2 * d);
  const out = Math.sqrt(Math.max(0, a * a - ahead * ahead));
  vN.copy(pole).addScaledVector(vD, -pole.dot(vD)).normalize();
  v2.copy(vD).multiplyScalar(ahead).addScaledVector(vN, out).normalize();
  v1.subVectors(vE, vS).normalize();
  qA.setFromUnitVectors(v1, v2);
  turnBone(upper, qA);
  lower.getWorldPosition(vE);
  hand.getWorldPosition(vW);
  v1.subVectors(vW, vE).normalize();
  v2.subVectors(target, vE).normalize();
  qA.setFromUnitVectors(v1, v2);
  turnBone(lower, qA);
}

/** A rotation whose +Z runs along `dir`, upright. */
function aimAlong(dir: Vector3, out: Quaternion): Quaternion {
  mAim.lookAt(dir, ZERO, UP);
  return out.setFromRotationMatrix(mAim);
}

interface Pose {
  at: Vector3;
  turn: Quaternion;
}
const newPose = (): Pose => ({ at: new Vector3(), turn: new Quaternion() });
const posed = (at: Vector3, turn: Quaternion): Pose => ({ at, turn });
function blend(a: Pose, b: Pose, f: number, out: Pose): Pose {
  out.at.lerpVectors(a.at, b.at, f);
  out.turn.slerpQuaternions(a.turn, b.turn, f);
  return out;
}
/** Where a tool's grip lies in the room. */
const gripOf = (p: Pose, grip: V3, out: Vector3): Vector3 => out.set(grip[0], grip[1], grip[2]).applyQuaternion(p.turn).add(p.at);

/** An arm of the barber and the rest pose it is turned from each frame. */
interface Arm {
  bones: [Bone, Bone, Bone];
  rest: Quaternion[];
  pole: Vector3;
  target: Vector3;
}

/** Where the tools lie when no hand holds them, the hand mirror held up, and the right hand at rest by his side. */
interface Rests {
  scissors: Pose;
  comb: Pose;
  mirror: Pose;
  held: Pose;
  broom: Pose;
  rightHand: Vector3;
}

/** Pieces of the shop gathered by material and drawn as one mesh each. */
class Parts {
  private readonly byMaterial = new Map<Material, BufferGeometry[]>();

  add(material: Material, geometry: BufferGeometry): void {
    for (const name of Object.keys(geometry.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geometry.deleteAttribute(name);
    let list = this.byMaterial.get(material);
    if (!list) this.byMaterial.set(material, (list = []));
    list.push(geometry);
  }

  /** What a kit builder put into `scratch`, baked in where it stands. */
  take(scratch: Object3D): void {
    scratch.updateMatrixWorld(true);
    scratch.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) this.add(mesh.material as Material, mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
    });
    scratch.clear();
  }

  build(into: Object3D): void {
    for (const [material, list] of this.byMaterial) {
      const mesh = new Mesh(mergeGeometries(list)!, material);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      into.add(mesh);
    }
  }
}

interface Surfaces {
  /** A white picture of one pixel, so that unlit surfaces without one are drawn as those with one. */
  plain: Texture;
  paper: Material;
  floor: Material;
  ceiling: Material;
  wood: Material;
  door: Material;
  marble: Material;
  brass: Material;
  linen: Material;
  chrome: Material;
}

/**
 * A narrow old barbershop at night, seen from the chair. In the glass the chair is empty: a white cape hangs over
 * nothing, and behind it a barber in a white coat, without a head, cuts the hair of nobody. It falls past your eyes,
 * black, then grey, then white, far more than a head holds, and heaps on the floor. He holds a hand mirror up behind
 * where your head would be: in it, white hair falls to the floor and goes on growing. Then he sweeps, and the hair
 * runs out under the door like a river. He and his tools are only in the glass: this side of the shop is built
 * once more behind it, flipped, as the mirror room is.
 */
export default class Barber extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x090e0c, density: 0.05 },
    env: 'bathroom',
    envIntensity: 0.06,
    sky: 0,
    grade: { exposure: 1.3, saturation: 0.76, warmth: 0.03, tint: -0.02, flare: 0.003 },
  };
  film = { bloom: 0.9, bloomFrom: 0.68, grain: 0.42, scratches: 0.06, flicker: 0.02, weave: REDUCED_MOTION ? 0 : 0.0004 };
  focus = FOCUS;
  aperture = APERTURE;
  drift = REDUCED_MOTION ? 0 : 0.3;
  fear = 0.18;
  movingShadows = true;

  private readonly hairU = { uHairTime: { value: 0 }, uHairGrow: { value: 0 }, uHairMotion: { value: REDUCED_MOTION ? 0.4 : 1 } };
  private readonly massU = { uHeapGrow: { value: 0 }, uRiverFront: { value: 0 }, uRiverFlow: { value: 0 }, uRiverRise: { value: 0 } };
  private readonly picture = new MirrorPicture();
  private readonly massPaint: MeshStandardMaterial;
  private readonly motes: { value: number }[] = [];
  private readonly bulb: DreamLight;
  private readonly echo: DreamLight;
  private readonly key: SpotSpec;

  private readonly barber: HeroFigure;
  private readonly arms: [Arm, Arm];
  private readonly scissors: { root: Object3D; blades: [Object3D, Object3D] };
  private readonly comb: Object3D;
  private readonly mirror: Object3D;
  private readonly broom: Object3D;
  /** Where things rest when no hand holds them, and the hands' own places when they hold nothing. */
  private readonly rests: Rests;
  private readonly now = { scissors: newPose(), comb: newPose(), mirror: newPose(), broom: newPose(), open: OPEN };
  private readonly cut = { scissors: newPose(), comb: newPose() };
  private readonly carried = newPose();
  /** His breast pocket in his own frame (m). */
  private readonly pocket = new Vector3();
  private readonly feet: Mesh;
  private readonly standAt = v3(BARBER_AT);
  private readonly sweepAt = v3(SWEEP_SPOT);

  private readonly beds: { hum?: RoomVoice; tick?: RoomVoice; street?: RoomVoice; drone?: RoomVoice; glass?: RoomVoice; comb?: RoomVoice; endless?: RoomVoice } = {};

  constructor(ctx: RoomContext) {
    super(ctx);
    const S = this.seconds;
    const push = REDUCED_MOTION ? 0.5 : 1;
    const lens = (f: number) => FOV_FROM + (f - FOV_FROM) * push;
    const eye = (f: number): V3 => [EYE_FROM[0] + (EYE_TO[0] - EYE_FROM[0]) * f, EYE_FROM[1] + (EYE_TO[1] - EYE_FROM[1]) * f, EYE_FROM[2] + (EYE_TO[2] - EYE_FROM[2]) * f];
    this.keys = [
      { t: 0, at: EYE_FROM, yaw: 0, pitch: 1.5, fov: FOV_FROM },
      { t: SCISSORS_STOP / S, at: eye(0.6), yaw: 0.6, pitch: 0.8, fov: lens(FOV_STOP) },
      { t: SHUTTER_AT / S, at: eye(0.85), yaw: 0.4, pitch: 0.2, fov: lens(FOV_HELD) },
      { t: 1, at: EYE_TO, yaw: 0.2, pitch: -0.6, fov: lens(FOV_TO) },
    ];

    const b = this.build;
    const k = this.kit;
    const m: Surfaces = {
      paper: b.damask(PALETTE.damaskTeal, 0.7),
      floor: b.checker(0.3),
      ceiling: b.wood(),
      wood: b.wood(),
      door: new MeshStandardMaterial({ color: 0x1d2621, roughness: 0.55 }),
      marble: new MeshStandardMaterial({ map: canvasTexture(512, 512, drawMarble, true), roughness: 0.22 }),
      brass: new MeshStandardMaterial({ color: 0x7a6236, roughness: 0.35, metalness: 1 }),
      linen: k.surface('linen_white', 0.35, { color: new Color(0xd6d3ca), roughness: 0.85 }),
      chrome: new MeshStandardMaterial({ color: 0xb8bcbf, roughness: 0.22, metalness: 1 }),
      plain: canvasTexture(1, 1, (c) => {
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, 1, 1);
      }),
    };
    (m.marble as MeshStandardMaterial).map!.repeat.setScalar(1 / 0.6);

    // this side of the shop, and behind the glass the same shop flipped
    const flip = new Group();
    flip.scale.z = -1;
    this.root.add(flip);
    this.shell(this.root, true, m);
    this.shell(flip, false, m);

    // the cape round nobody: white outside, dark inside, where a body should be
    const capeGeo = capeGeometry();
    const cape = new Mesh(capeGeo, m.linen);
    const insideGeo = capeGeo.clone();
    const turned = insideGeo.getIndex()!.array as Uint16Array | Uint32Array;
    for (let i = 0; i < turned.length; i += 3) [turned[i + 1], turned[i + 2]] = [turned[i + 2], turned[i + 1]];
    const hollow = new MeshBasicMaterial({ color: 0x040404, map: m.plain, transparent: true });
    for (const into of [this.root, flip]) {
      const outer = new Mesh(capeGeo, m.linen);
      outer.castShadow = into === flip;
      outer.receiveShadow = true;
      outer.frustumCulled = false;
      const inner = new Mesh(insideGeo, hollow);
      inner.frustumCulled = false;
      into.add(outer, inner);
    }

    // the heap round the hem and the river to the door: one mass of hair, on both sides of the glass
    const fibre = canvasTexture(512, 512, drawFibre, true);
    fibre.repeat.setScalar(1 / FIBRE_TILE);
    this.massPaint = new MeshStandardMaterial({ map: fibre, color: HAIR_GREY.clone(), roughness: 0.62 });
    const river = riverGeometry();
    this.massPaint.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, this.massU);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${MASS_PARS}`)
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nif (aAlong >= 0.0) vMapUv.y -= uRiverFlow;')
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = aAlong < 0.0 ? normalize(vec3(-aSlope.x * uHeapGrow, 1.0, -aSlope.y * uHeapGrow)) : vec3(0.0, 1.0, 0.0);')
        .replace(
          '#include <begin_vertex>',
          `float riverOn = 1.0 - smoothstep(uRiverFront - 0.3, uRiverFront, aAlong);
          float riverEnd = 1.0 - 0.65 * smoothstep(${(river.length - 0.8).toFixed(3)}, ${river.length.toFixed(3)}, aAlong);
          float massY = aAlong < 0.0 ? aHeap * uHeapGrow - 0.012 : uRiverRise * ${RIVER_H.toFixed(3)} * (1.0 - aAcross * aAcross * aAcross * aAcross) * riverOn * riverEnd - 0.01;
          vMassShade = aAlong < 0.0 ? ${HEAP_SHADE.toFixed(2)} : 1.0;
          vec3 transformed = vec3(position.x, massY, position.z);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vMassShade;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= vMassShade;');
    };
    this.massPaint.customProgramCacheKey = () => 'barber-mass';
    const massGeo = mergeGeometries([heapGeometry(), river.geometry])!;

    // the hair
    const hairPaint = new MeshStandardMaterial({ map: canvasTexture(32, 128, drawStrands), vertexColors: true, roughness: 0.5, side: DoubleSide, alphaTest: 0.32 });
    hairPaint.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, this.hairU);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${HAIR_PARS}`)
        .replace('#include <beginnormal_vertex>', HAIR_NORMAL)
        .replace('#include <begin_vertex>', HAIR_PLACE);
    };
    hairPaint.customProgramCacheKey = () => 'barber-hair';
    const tufts = this.cutHair(cape);
    const lockGeo = tuftGeometry(tufts);
    const strandGeo = tuftGeometry(tufts, NEAR_WIDEST, NEAR_LONGEST, NEAR_CLOSEST);
    for (const into of [this.root, flip]) {
      for (const [geometry, material] of [[massGeo, this.massPaint], [into === flip ? lockGeo : strandGeo, hairPaint]] as const) {
        const mesh = new Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.receiveShadow = true;
        into.add(mesh);
      }
      this.motes.push(b.motes(150, { x: [-1.2, 1.2], y: [0.3, 2.7], z: [0.15, 3.5] }, into, { size: 0.006, color: 0xd9ccb4, strength: 0.32, seed: into === flip ? 7 : 3 }).time);
    }

    // in the glass only: the barber, his stand and his tools
    this.stand(m);
    this.barber = this.dressBarber();
    this.feet = b.contactShadow(BARBER_AT[0], BARBER_AT[2], 0.36, this.root, 0.75);
    const arm = (side: 'R' | 'L', pole: V3): Arm => {
      const bones: [Bone, Bone, Bone] = [this.barber.bone(`Bip01_${side}_UpperArm`)!, this.barber.bone(`Bip01_${side}_Forearm`)!, this.barber.bone(`Bip01_${side}_Hand`)!];
      return { bones, rest: bones.map((bone) => bone.quaternion.clone()), pole: v3(pole).normalize(), target: new Vector3() };
    };
    this.arms = [arm('R', [-0.5, -1, -0.3]), arm('L', [0.6, -1, -0.2])];
    this.scissors = this.makeScissors(new MeshStandardMaterial({ color: 0xd8dadb, roughness: 0.3, metalness: 0.75 }));
    this.comb = this.makeComb();
    this.mirror = this.makeHandMirror(m.brass);
    this.broom = this.makeBroom(new MeshStandardMaterial({ color: 0x8c7552, roughness: 0.6 }));
    this.rests = this.restingPlaces();

    // the light: one bulb, and the same bulb in the glass
    const [bx, by, bz] = BULB;
    this.bulb = this.light([bx, by, bz], PALETTE.warm, BULB_POWER, BULB_REACH);
    this.echo = this.light([bx, by, -bz], PALETTE.warm, BULB_POWER, BULB_REACH);
    this.light([DOOR_X + 0.1, 0.45, BACK_Z - 0.45], PALETTE.cold, DOOR_POWER, DOOR_REACH);
    this.light([DOOR_X + 0.1, 0.45, -(BACK_Z - 0.45)], PALETTE.cold, DOOR_POWER, DOOR_REACH);
    this.light([0.4, 2.1, 2.9], 0xb9b2a0, BACK_POWER, BACK_REACH);
    this.light([0.4, 2.1, -2.9], 0xb9b2a0, BACK_POWER, BACK_REACH);
    this.key = this.spot([bx, by, -bz], [0.1, 1.0, -1.75], PALETTE.warm, KEY_POWER, KEY_ANGLE, 0.7);
    this.spots = [
      this.key,
      this.spot([bx, by, bz], [0, 0.82, 1.15], PALETTE.warm, NEAR_POWER, NEAR_ANGLE, 0.8),
      this.spot([DOOR_X + 0.15, 1.6, -(BACK_Z + 0.9)], [DOOR_X + 0.05, 0, -(BACK_Z - 1.1)], PALETTE.cold, STREET_POWER, STREET_ANGLE, 0.8),
    ];

    this.score();
  }

  /** Everything of the shop that the glass shows again: on this side (`real`) also the wall the glass is set in, and the glass. */
  private shell(into: Object3D, real: boolean, m: Surfaces): void {
    const b = this.build;
    const k = this.kit;
    const parts = new Parts();
    const scratch = new Group();
    into.add(k.floor(-HALF_W, HALF_W, 0, BACK_Z, 0, m.floor));
    const ceiling = k.floor(-HALF_W, HALF_W, 0, BACK_Z, H, m.ceiling);
    ceiling.rotation.x = Math.PI / 2;
    into.add(ceiling);

    // the walls: paper over dark panelling, and the wall the glass is set in
    for (const side of [-1, 1]) {
      const facing = side > 0 ? '-x' : '+x';
      b.wall(side * HALF_W, BACK_Z / 2, BACK_Z, H - WAINSCOT, facing, m.paper, scratch, WAINSCOT);
      b.wainscot(side * HALF_W, BACK_Z / 2, BACK_Z, facing, scratch, WAINSCOT);
    }
    b.wall(0, BACK_Z, HALF_W * 2, H, '-z', m.paper, scratch);
    const doorLeft = DOOR_X - DOOR_W / 2 - 0.11;
    const doorRight = DOOR_X + DOOR_W / 2 + 0.11;
    if (doorLeft + HALF_W > 0.05) b.wainscot((doorLeft - HALF_W) / 2, BACK_Z, doorLeft + HALF_W, '-z', scratch, WAINSCOT);
    b.wainscot((doorRight + HALF_W) / 2, BACK_Z, HALF_W - doorRight, '-z', scratch, WAINSCOT);
    if (real) {
      const sideW = HALF_W - GLASS_HALF;
      b.wall(-(GLASS_HALF + sideW / 2), 0, sideW, H, '+z', m.paper, scratch);
      b.wall(GLASS_HALF + sideW / 2, 0, sideW, H, '+z', m.paper, scratch);
      b.wall(0, 0, GLASS_HALF * 2, GLASS_Y0, '+z', m.paper, scratch);
      b.wall(0, 0, GLASS_HALF * 2, H - GLASS_Y1, '+z', m.paper, scratch, GLASS_Y1);
      b.wainscot((COUNTER_X0 - HALF_W) / 2, 0.002, HALF_W + COUNTER_X0, '+z', scratch, WAINSCOT);
      const glass = new Mesh(new PlaneGeometry(GLASS_HALF * 2, GLASS_Y1 - GLASS_Y0), new MeshBasicMaterial({ map: canvasTexture(512, 512, drawGlass), transparent: true, depthWrite: false }));
      glass.position.set(0, (GLASS_Y0 + GLASS_Y1) / 2, 0.002);
      glass.renderOrder = 2;
      glass.frustumCulled = false;
      into.add(glass);
      b.contactShadow((COUNTER_X0 + HALF_W) / 2, COUNTER_D + 0.02, 0.5, into, 0.55).scale.set(HALF_W - COUNTER_X0, 0.6, 1);
    }
    parts.take(scratch);
    this.joinery(parts, real, m);
    this.door(parts, into, m);
    this.bulbOn(parts, into, real, m);
    this.pictures(parts, into, m);

    // the basin at the end of the counter, its tap, its trap
    k.prop('sink', [BASIN_X, COUNTER_Y - 0.17, 0.25], { scale: 0.95 }, into);
    k.prop('faucet', [BASIN_X, 0.9, 0.07], {}, into);
    parts.add(m.chrome, new CylinderGeometry(0.018, 0.018, 0.3, 10).translate(BASIN_X, 0.48, 0.26));
    parts.add(m.chrome, new CylinderGeometry(0.018, 0.018, 0.24, 10).rotateX(Math.PI / 2).translate(BASIN_X, 0.33, 0.14));

    // on the counter: the jar of blue water with combs standing in it, tonics, a shaving mug, towels, a comb
    const jarAt = new Vector3(0.86, COUNTER_Y, 0.2);
    const jar = new Mesh(new LatheGeometry([[0, 0], [0.055, 0], [0.058, 0.01], [0.058, 0.2], [0.05, 0.21], [0.05, 0.225], [0, 0.225]].map(([x, y]) => new Vector2(x, y)), 24), new MeshStandardMaterial({ color: 0x1f5a63, roughness: 0.06, metalness: 0.2 }));
    jar.position.copy(jarAt);
    into.add(jar);
    parts.add(m.chrome, new CylinderGeometry(0.052, 0.052, 0.018, 24).translate(jarAt.x, jarAt.y + 0.234, jarAt.z));
    const combs = k.props('comb', 3);
    const lean = new Quaternion();
    const placeComb = (i: number, x: number, y: number, z: number, turn: Euler) => combs.setMatrix(i, new Matrix4().compose(new Vector3(x, y, z), lean.setFromEuler(turn), new Vector3(1, 1, 1)));
    placeComb(0, jarAt.x - 0.015, COUNTER_Y + 0.2, jarAt.z, new Euler(0.08, 0.3, Math.PI / 2 - 0.12));
    placeComb(1, jarAt.x + 0.018, COUNTER_Y + 0.19, jarAt.z + 0.01, new Euler(-0.06, -0.5, Math.PI / 2 + 0.16));
    placeComb(2, 0.18, COUNTER_Y, 0.33, new Euler(0, -0.2, 0));
    combs.commit();
    into.add(combs.root);
    const bottleShape = [[0, 0], [0.032, 0], [0.034, 0.01], [0.034, 0.16], [0.029, 0.19], [0.012, 0.22], [0.011, 0.26], [0.013, 0.27], [0, 0.272]].map(([x, y]) => new Vector2(x, y));
    const bottles: BufferGeometry[] = [];
    const labels: BufferGeometry[] = [];
    for (const [x, z, s] of [[1.04, 0.16, 1], [1.13, 0.26, 0.86], [1.21, 0.14, 1.08]]) {
      bottles.push(new LatheGeometry(bottleShape, 20).scale(s, s, s).translate(x, COUNTER_Y, z));
      labels.push(new CylinderGeometry(0.0346, 0.0346, 0.07, 20, 1, true).scale(s, s, s).translate(x, COUNTER_Y + 0.09 * s, z));
    }
    into.add(new Mesh(mergeGeometries(bottles)!, new MeshStandardMaterial({ color: 0x33190a, roughness: 0.12 })), new Mesh(mergeGeometries(labels)!, new MeshStandardMaterial({ color: 0xb4a682, roughness: 0.8 })));
    k.prop('mug', [-0.5, COUNTER_Y, 0.16], { rotation: [0, 30, 0] }, into);
    parts.add(m.wood, new CylinderGeometry(0.013, 0.016, 0.05, 12).translate(0, 0.025, 0).rotateZ(0.25).translate(-0.5, COUNTER_Y + 0.07, 0.16));
    const towels = new Mesh(mergeGeometries([meterUVs(new BoxGeometry(0.2, 0.045, 0.16)).translate(0, 0.0225, 0), meterUVs(new BoxGeometry(0.19, 0.04, 0.15)).rotateY(0.12).translate(0.005, 0.066, 0.004)])!, m.linen);
    towels.position.set(0.45, COUNTER_Y, 0.24);
    towels.rotation.y = 0.2;
    into.add(towels);

    // along the walls: a radiator; two empty chairs; an empty coat stand by the door
    k.prop('radiator', [-HALF_W + 0.14, 0, 1.8], { rotation: [0, 90, 0] }, into);
    b.contactShadow(-HALF_W + 0.16, 1.8, 0.5, into, 0.5).scale.set(0.5, 1.15, 1);
    const chairs = k.props('chair_ladder', 2);
    chairs.set(0, HALF_W - 0.32, 0, 2.45, -Math.PI / 2);
    chairs.set(1, HALF_W - 0.32, 0, 3.0, -Math.PI / 2);
    chairs.commit();
    into.add(chairs.root);
    k.prop('coat_stand', [0.9, 0, 3.38], {}, into);
    b.contactShadow(0.9, 3.38, 0.32, into, 0.6);
    parts.build(into);
  }

  /** The dark wood of the shop: cornice, the frame of the glass with its crest and gilt bead, the counter with its marble top. */
  private joinery(parts: Parts, real: boolean, m: Surfaces): void {
    const box = (material: Material, w: number, h: number, d: number, x: number, y: number, z: number) => parts.add(material, meterUVs(new BoxGeometry(w, h, d)).translate(x, y, z));
    // the cornice (not along the wall of the glass on its far side)
    const run = (len: number, x: number, z: number, alongX: boolean) => {
      for (const [h, d, y] of [[0.1, 0.05, H - 0.05], [0.03, 0.09, H - 0.015]] as const) box(m.wood, alongX ? len : d, h, alongX ? d : len, x, y, z);
    };
    run(HALF_W * 2, 0, BACK_Z - 0.03, true);
    if (real) run(HALF_W * 2, 0, 0.03, true);
    run(BACK_Z, -HALF_W + 0.03, BACK_Z / 2, false);
    run(BACK_Z, HALF_W - 0.03, BACK_Z / 2, false);
    // the frame
    const outer = GLASS_HALF + FRAME_W;
    const midY = (GLASS_Y0 + GLASS_Y1) / 2;
    const tall = GLASS_Y1 - GLASS_Y0;
    for (const side of [-1, 1]) {
      box(m.wood, FRAME_W, tall + FRAME_W * 2, FRAME_D, side * (GLASS_HALF + FRAME_W / 2), midY, FRAME_D / 2);
      box(m.wood, 0.03, tall + FRAME_W * 2 - 0.02, 0.012, side * (GLASS_HALF + FRAME_W * 0.55), midY, FRAME_D + 0.006);
      box(m.brass, 0.008, tall, 0.012, side * (GLASS_HALF + 0.004), midY, FRAME_D * 0.55);
    }
    box(m.wood, outer * 2, FRAME_W * 0.7, FRAME_D, 0, GLASS_Y0 - FRAME_W * 0.35, FRAME_D / 2);
    box(m.wood, outer * 2, 0.14, FRAME_D + 0.01, 0, GLASS_Y1 + 0.07, (FRAME_D + 0.01) / 2);
    box(m.wood, outer * 2 + 0.06, 0.025, FRAME_D + 0.04, 0, GLASS_Y1 + 0.152, (FRAME_D + 0.04) / 2);
    box(m.wood, outer * 1.1, 0.05, FRAME_D, 0, GLASS_Y1 + 0.19, FRAME_D / 2);
    for (const y of [GLASS_Y0 + 0.004, GLASS_Y1 - 0.004]) box(m.brass, GLASS_HALF * 2, 0.008, 0.012, 0, y, FRAME_D * 0.55);
    // the counter: drawers and doors, brass pulls, a marble top
    const x0 = COUNTER_X0;
    const w = HALF_W - x0;
    const cx = (x0 + HALF_W) / 2;
    const front = COUNTER_D - 0.03;
    box(m.wood, w, COUNTER_Y - 0.12, front, cx, 0.09 + (COUNTER_Y - 0.12) / 2, front / 2);
    box(m.wood, w, 0.09, front - 0.05, cx, 0.045, (front - 0.05) / 2);
    const bayW = (w - 0.06) / 3;
    for (let i = 0; i < 3; i++) {
      const bx = x0 + 0.03 + bayW * (i + 0.5);
      box(m.wood, bayW - 0.03, 0.12, 0.018, bx, COUNTER_Y - 0.1, front + 0.009);
      box(m.wood, bayW - 0.03, 0.47, 0.018, bx, 0.36, front + 0.009);
      box(m.wood, bayW - 0.13, 0.35, 0.012, bx, 0.36, front + 0.024);
      parts.add(m.brass, new CylinderGeometry(0.012, 0.014, 0.02, 10).rotateX(Math.PI / 2).translate(bx, COUNTER_Y - 0.1, front + 0.028));
      parts.add(m.brass, new CylinderGeometry(0.01, 0.012, 0.02, 10).rotateX(Math.PI / 2).translate(bx + bayW * 0.36, 0.5, front + 0.04));
    }
    box(m.marble, w + 0.03, 0.03, COUNTER_D + 0.02, cx - 0.015, COUNTER_Y - 0.015, (COUNTER_D + 0.02) / 2);
  }

  /** The street door in the back wall: painted wood, a frosted pane with the shop's name, a gap under it with the street's light in it. */
  private door(parts: Parts, into: Object3D, m: Surfaces): void {
    const z = BACK_Z;
    const left = DOOR_X - DOOR_W / 2;
    const box = (material: Material, w: number, h: number, d: number, x: number, y: number, zz: number) => parts.add(material, meterUVs(new BoxGeometry(w, h, d)).translate(x, y, zz));
    for (const x of [left - 0.05, left + DOOR_W + 0.05]) box(m.wood, 0.1, DOOR_H + 0.1, 0.07, x, (DOOR_H + 0.1) / 2, z - 0.035);
    box(m.wood, DOOR_W + 0.2, 0.1, 0.07, DOOR_X, DOOR_H + 0.05, z - 0.035);
    const lz = z - 0.03;
    const stile = 0.11;
    const paneFrom = 1.12;
    for (const x of [left + stile / 2, left + DOOR_W - stile / 2]) box(m.door, stile, DOOR_H - DOOR_GAP, 0.045, x, (DOOR_H + DOOR_GAP) / 2, lz);
    for (const [y, h] of [[DOOR_GAP + 0.11, 0.22], [paneFrom - 0.07, 0.14], [DOOR_H - 0.06, 0.12]] as const) box(m.door, DOOR_W - stile * 2, h, 0.045, DOOR_X, y, lz);
    const panelH = paneFrom - 0.14 - (DOOR_GAP + 0.22);
    const panelY = DOOR_GAP + 0.22 + panelH / 2;
    box(m.door, DOOR_W - stile * 2, panelH, 0.02, DOOR_X, panelY, lz);
    for (const x of [DOOR_X - 0.16, DOOR_X + 0.16]) box(m.door, 0.24, panelH - 0.1, 0.012, x, panelY, lz - 0.016);
    parts.add(m.brass, new CylinderGeometry(0.008, 0.008, 0.05, 8).rotateX(Math.PI / 2).translate(left + DOOR_W - 0.08, 1.0, lz - 0.045));
    parts.add(m.brass, new CylinderGeometry(0.026, 0.022, 0.03, 14).rotateX(Math.PI / 2).translate(left + DOOR_W - 0.08, 1.0, lz - 0.075));
    const paneH = DOOR_H - 0.12 - paneFrom;
    const pane = new Mesh(new PlaneGeometry(DOOR_W - stile * 2, paneH), new MeshBasicMaterial({ map: canvasTexture(256, 380, drawDoorPane), color: new Color(PANE_LIGHT, PANE_LIGHT, PANE_LIGHT), transparent: true }));
    pane.position.set(DOOR_X, paneFrom + paneH / 2, lz);
    pane.rotation.y = Math.PI;
    const gap = new Mesh(new PlaneGeometry(DOOR_W, DOOR_GAP + 0.03), new MeshBasicMaterial({ color: new Color(PALETTE.cold).multiplyScalar(0.55), map: m.plain, transparent: true }));
    gap.position.set(DOOR_X, (DOOR_GAP + 0.03) / 2, z - 0.004);
    gap.rotation.y = Math.PI;
    into.add(pane, gap);
  }

  /** The bare bulb on its cord, and the glow round it. */
  private bulbOn(parts: Parts, into: Object3D, real: boolean, m: Surfaces): void {
    const [x, y, z] = BULB;
    parts.add(m.door, new CylinderGeometry(0.0035, 0.0035, H - y - 0.12, 6).translate(x, (H + y + 0.12) / 2, z));
    parts.add(m.door, new LatheGeometry([[0, 0], [0.019, 0], [0.021, 0.01], [0.019, 0.055], [0.008, 0.07], [0, 0.07]].map(([a, c]) => new Vector2(a, c)), 14).translate(x, y + 0.05, z));
    const glass = new Mesh(new LatheGeometry([[0, -0.05], [0.022, -0.045], [0.032, -0.025], [0.03, 0.0], [0.016, 0.03], [0.014, 0.05], [0, 0.05]].map(([a, c]) => new Vector2(a, c)), 18), new MeshBasicMaterial({ color: new Color(PALETTE.warm).multiplyScalar(5), map: m.plain, transparent: true }));
    glass.position.set(x, y, z);
    into.add(glass);
    this.build.glow(x, y, z, real ? 0.5 : 0.42, PALETTE.warm, 0.5, into);
  }

  /** What hangs on the walls: a chart of haircuts, a photograph of a street at night, the clock over the door. */
  private pictures(parts: Parts, into: Object3D, m: Surfaces): void {
    const b = this.build;
    const hang = (w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, at: V3, turn: number, rim: number) => {
      const label = b.label(w, h, draw, { px: 420, roughness: 0.85 });
      label.mesh.position.set(at[0], at[1], at[2]);
      label.mesh.rotation.y = turn;
      into.add(label.mesh);
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      // the frame round it, standing a little off the wall
      for (const [fw, fh, ox, oy] of [[w + rim * 2, rim, 0, (h + rim) / 2], [w + rim * 2, rim, 0, -(h + rim) / 2], [rim, h, (w + rim) / 2, 0], [rim, h, -(w + rim) / 2, 0]]) {
        parts.add(m.wood, meterUVs(new BoxGeometry(fw, fh, 0.025)).rotateY(turn).translate(at[0] + ox * c, at[1] + oy, at[2] - ox * s));
      }
    };
    hang(0.42, 0.58, drawChart, [-HALF_W + 0.014, 1.55, 1.8], Math.PI / 2, 0.025);
    hang(0.5, 0.38, drawStreet, [HALF_W - 0.014, 1.5, 1.8], -Math.PI / 2, 0.04);
    hang(0.3, 0.3, drawClock, [DOOR_X, 2.5, BACK_Z - 0.03], Math.PI, 0.035);
  }

  /** The barber's stand at his left: dark wood, a towel, a tin of talc. */
  private stand(m: Surfaces): void {
    const [x, , z] = STAND;
    const body = new Mesh(mergeGeometries([meterUVs(new BoxGeometry(0.36, STAND_TOP - 0.06, 0.32)).translate(0, (STAND_TOP - 0.06) / 2 + 0.06, 0), meterUVs(new BoxGeometry(0.4, 0.025, 0.36)).translate(0, STAND_TOP - 0.0125, 0), meterUVs(new BoxGeometry(0.3, 0.06, 0.26)).translate(0, 0.03, 0)])!, m.wood);
    body.position.set(x, 0, z);
    body.castShadow = body.receiveShadow = true;
    const towel = new Mesh(meterUVs(new BoxGeometry(0.16, 0.035, 0.22)), m.linen);
    towel.position.set(x + 0.09, STAND_TOP + 0.0175, z + 0.02);
    const tin = new Mesh(new CylinderGeometry(0.03, 0.03, 0.13, 16), m.chrome);
    tin.position.set(x - 0.11, STAND_TOP + 0.065, z - 0.08);
    this.root.add(body, towel, tin);
    this.build.contactShadow(x, z, 0.32, this.root, 0.65);
  }

  /** The barber: a man in a white coat with no head, who only moves his arms. Head and neck are folded away into the collar. */
  private dressBarber(): HeroFigure {
    const hero = this.kit.figures.hero({ avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 0.2, bleach: 0, tint: COAT_TINT });
    hero.update(0.2);
    const neckBone = hero.bone('Bip01_Neck')!;
    neckBone.scale.setScalar(NECK_FOLD);
    for (const child of neckBone.children) {
      if (!/Clavicle/.test(child.name)) continue;
      child.position.multiplyScalar(1 / NECK_FOLD);
      child.scale.setScalar(1 / NECK_FOLD);
    }
    const coated = new Set<Material>();
    hero.root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as MeshStandardMaterial;
      if (/head|opacity/.test(material.name)) {
        mesh.visible = false;
        return;
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (!coated.has(material)) whiteCoat(material);
      coated.add(material);
    });
    for (const side of ['L', 'R']) {
      for (let f = 0; f <= 4; f++) {
        for (const joint of ['', '1', '2']) hero.bone(`Bip01_${side}_Finger${f}${joint}`)?.rotateZ(f === 0 ? THUMB_CURL : FINGER_CURL);
      }
    }
    hero.root.position.set(BARBER_AT[0], BARBER_AT[1], BARBER_AT[2]);
    hero.root.rotation.y = BARBER_TURN * DEG;
    this.root.add(hero.root);
    hero.root.updateMatrixWorld(true);
    // where the neck went: a dark round in the collar
    const neck = neckBone.getWorldPosition(new Vector3()).sub(this.origin);
    const stump = new Mesh(new CylinderGeometry(0.05, 0.056, 0.03, 18), new MeshStandardMaterial({ color: 0x1a0807, roughness: 0.4 }));
    stump.position.copy(neck).add(vA.set(0, -0.012, 0));
    this.root.add(stump);
    hero.bone('Bip01_Spine2')!.attach(stump);
    return hero;
  }

  /** Scissors: two blades on a pivot, rings toward -z; the blades open about their own y. */
  private makeScissors(steel: Material): { root: Object3D; blades: [Object3D, Object3D] } {
    const root = new Group();
    const half = (sign: number): Object3D => {
      const outline = new Shape();
      outline.moveTo(0.0045 * sign, -0.01);
      outline.lineTo(0.0065 * sign, 0.004);
      outline.lineTo(0.0042 * sign, 0.06);
      outline.lineTo(0.0008 * sign, 0.1);
      outline.lineTo(-0.0012 * sign, 0.062);
      outline.lineTo(-0.0016 * sign, 0.0);
      outline.lineTo(-0.002 * sign, -0.012);
      const blade = new ExtrudeGeometry(outline, { depth: 0.0018, bevelEnabled: false }).rotateX(Math.PI / 2);
      const shank = new BoxGeometry(0.004, 0.003, 0.034).translate(0.004 * sign, 0, -0.026).toNonIndexed();
      const ring = new TorusGeometry(0.012, 0.0024, 6, 18).rotateX(Math.PI / 2).translate(0.012 * sign, 0, -0.054).toNonIndexed();
      for (const g of [blade, shank, ring]) g.deleteAttribute('uv');
      const pivot = new Group();
      const mesh = new Mesh(mergeGeometries([blade, shank, ring])!, steel);
      mesh.castShadow = true;
      pivot.add(mesh);
      root.add(pivot);
      return pivot;
    };
    const blades: [Object3D, Object3D] = [half(1), half(-1)];
    this.root.add(root);
    return { root, blades };
  }

  /** His comb, of pale horn so that it shows against the dark, held along +z. */
  private makeComb(): Object3D {
    const g = new Group();
    this.kit.paint(this.kit.prop('comb', [0, 0, 0], { rotation: [0, 90, 0], anchor: 'center', castShadow: true }, g), new MeshStandardMaterial({ color: 0xc9b99a, roughness: 0.45 }));
    this.root.add(g);
    return g;
  }

  /** The hand mirror: an oval of glass in a brass rim on a handle, facing +z, the handle down. */
  private makeHandMirror(brass: Material): Object3D {
    const g = new Group();
    const rx = 0.135;
    const ry = 0.175;
    const rim = new EllipseCurve(0, 0, rx, ry, 0, Math.PI * 2, false, 0);
    const pts = rim.getPoints(48).map((p) => new Vector3(p.x, p.y, 0));
    const ring = new TubeGeometry(new CatmullRomCurve3(pts, true), 64, 0.008, 6, true);
    const handle = new CylinderGeometry(0.011, 0.014, 0.15, 10).translate(0, -ry - 0.075, -0.004);
    ring.deleteAttribute('uv');
    handle.deleteAttribute('uv');
    const frame = new Mesh(mergeGeometries([ring.toNonIndexed(), handle.toNonIndexed()])!, brass);
    frame.castShadow = true;
    const face = new Mesh(new CircleGeometry(0.5, 40).scale(rx * 2, ry * 2, 1), new MeshBasicMaterial({ map: this.picture.texture, transparent: true }));
    face.position.z = 0.002;
    const back = new Mesh(new CircleGeometry(0.5, 40).scale(rx * 2 + 0.01, ry * 2 + 0.01, 1).rotateY(Math.PI), new MeshStandardMaterial({ color: 0x24170e, roughness: 0.5 }));
    back.position.z = -0.003;
    g.add(frame, face, back);
    this.root.add(g);
    return g;
  }

  /** A shop broom of pale raw wood, so that it shows against the dark: a long handle and a head of dark bristle, the handle along +y from the floor. */
  private makeBroom(wood: Material): Object3D {
    const g = new Group();
    const handle = new Mesh(new CylinderGeometry(0.012, 0.013, 1.25, 10).translate(0, 0.66, 0), wood);
    const stock = meterUVs(new BoxGeometry(0.34, 0.05, 0.06)).translate(0, 0.085, 0);
    const bristle = meterUVs(new BoxGeometry(0.33, 0.07, 0.05)).translate(0, 0.035, 0);
    const head = new Mesh(stock, wood);
    const hairs = new Mesh(bristle, new MeshStandardMaterial({ color: 0x2b2118, roughness: 0.95 }));
    handle.castShadow = head.castShadow = true;
    g.add(handle, head, hairs);
    this.root.add(g);
    return g;
  }

  /** Where the tools lie when no hand holds them, the held hand mirror, and the right hand at rest by his side. */
  private restingPlaces(): Rests {
    const [sx, , sz] = STAND;
    const turn = BARBER_TURN * DEG;
    const ahead = new Vector3(Math.sin(turn), 0, Math.cos(turn));
    const left = new Vector3(Math.cos(turn), 0, -Math.sin(turn));
    const chest = this.barber.bone('Bip01_Spine2')!.getWorldPosition(new Vector3()).sub(this.origin);
    const pocket = chest.clone().addScaledVector(ahead, 0.13).addScaledVector(left, 0.09).addScaledVector(UP, 0.07);
    const dx = pocket.x - BARBER_AT[0];
    const dz = pocket.z - BARBER_AT[2];
    this.pocket.set(dx * Math.cos(turn) - dz * Math.sin(turn), pocket.y, dx * Math.sin(turn) + dz * Math.cos(turn));
    const leanAt = new Vector3(sx + 0.3, 0, sz + 0.06);
    const leanDir = new Vector3(sx + 0.19 - leanAt.x, STAND_TOP, sz - leanAt.z).normalize();
    return {
      scissors: posed(pocket, new Quaternion().setFromUnitVectors(AXIS_Z, DOWN)),
      comb: posed(new Vector3(sx - 0.06, STAND_TOP + 0.004, sz + 0.07), new Quaternion().setFromEuler(new Euler(0, 0.7, 0))),
      mirror: posed(new Vector3(sx - 0.02, STAND_TOP + 0.012, sz - 0.03), new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, -0.9))),
      held: posed(v3(HEAD).add(v3(HELD)), new Quaternion().setFromEuler(new Euler(HELD_TILT[0], HELD_TILT[1], HELD_TILT[2]))),
      broom: posed(leanAt, new Quaternion().setFromUnitVectors(UP, leanDir)),
      rightHand: v3(BARBER_AT).addScaledVector(left, -0.21).addScaledVector(ahead, 0.06).setY(0.84),
    };
  }

  /**
   * The cut hair, from the black already lying at the start to the white that pours after the grey: where each tuft
   * comes from, when, and where it comes to rest (on the cape below it, or on the heap as it stands then).
   */
  private cutHair(cape: Mesh): Tuft[] {
    const rand = randomFrom(71);
    const ray = new Raycaster();
    ray.far = 4;
    const tufts: Tuft[] = [];
    const head = new Vector3(HEAD[0], HEAD[1], -HEAD[2]);
    const speed = () => FALL_SPEED[0] + rand() * (FALL_SPEED[1] - FALL_SPEED[0]);
    const eye = v3(EYE_FROM);
    const add = (start: Vector3, t0: number, lying: boolean, fine = false) => {
      const near = !fine && start.distanceTo(eye) < NEAR_EYE;
      const shade = shadeAt(t0, new Color()).multiplyScalar(0.9 + rand() * 0.2);
      const white = range(GREY_AT, 15, t0);
      const length = fine ? 0.01 + rand() * 0.02 : 0.012 + rand() * 0.025 + white * (0.05 + rand() * 0.14);
      const width = fine ? 0.002 + rand() * 0.0015 : 0.003 + rand() * 0.002 + white * (0.01 + rand() * 0.018);
      ray.set(start, DOWN);
      const hit = ray.intersectObject(cape, false)[0];
      const v = speed();
      if (hit) {
        const land = hit.point.clone().addScaledVector(hit.face!.normal, 0.004);
        tufts.push({ t0, start: lying ? land : start, land, fall: Math.max(0.12, (start.y - land.y) / v), floor: -1, grown: 0, shade, length, width, near });
        return;
      }
      const land = new Vector3(clamp(start.x, -HALF_W + 0.05, HALF_W - 0.05), 0, clamp(start.z, COUNTER_D + 0.05, BACK_Z - 0.05));
      const floor = heapFull(land.x, land.z);
      const grown = Math.max(0, heapAt(t0 + start.y / v));
      land.y = Math.max(0.003, floor * grown - 0.008);
      tufts.push({ t0, start: lying ? land : start, land, fall: Math.max(0.12, (start.y - land.y) / v), floor, grown, shade, length, width, near });
    };
    // what has been cut already: on the cape, and round it on the floor
    for (let i = 0; i < ON_CAPE; i++) {
      const a = rand() * Math.PI * 2;
      const r = 0.1 + rand() * 0.22;
      add(new Vector3(Math.sin(a) * r, 1.6, NECK_Z - Math.cos(a) * r), -10, true, true);
    }
    for (let i = 0; i < ON_FLOOR; i++) {
      const a = rand() * Math.PI * 2;
      capeAt(a, 1, vC);
      const r = Math.hypot(vC.x, vC.z - NECK_Z) + 0.03 + rand() ** 1.5 * 0.65;
      add(new Vector3(Math.sin(a) * r, 0.01, NECK_Z - Math.cos(a) * r), -10, true, true);
    }
    // what each snip cuts, from where the blades close
    for (const t of this.snipTimes()) {
      this.cutPose(t);
      const at = this.cut.scissors.at;
      const n = PER_SNIP[t < GREY_AT ? 0 : 1];
      for (let i = 0; i < n; i++) add(new Vector3(at.x + (rand() - 0.5) * 0.03, at.y + (rand() - 0.5) * 0.02, -at.z + (rand() - 0.5) * 0.03), t + i * 0.015, false);
    }
    // far more than a head holds: from the head and from the air round the shoulders, ever thicker
    let made = 0;
    while (made < DELUGE) {
      const t = GREY_AT + rand() * (SCISSORS_STOP - GREY_AT);
      if (rand() * 1.12 > 0.12 + ((t - GREY_AT) / (SCISSORS_STOP - GREY_AT)) ** 2) continue;
      made++;
      if (rand() < 0.55) {
        vC.set(rand() - 0.5, rand() * 0.8 - 0.25, rand() - 0.5).normalize().multiplyScalar(0.09 + rand() * 0.05).add(head);
      } else {
        const a = rand() * Math.PI * 2;
        const r = 0.22 + rand() * 0.3;
        vC.set(Math.sin(a) * r, 1.2 + rand() * 0.3, NECK_Z - Math.cos(a) * r);
      }
      const out = Math.hypot(vC.x, vC.z - NECK_Z);
      if (out < 0.09) vC.set((vC.x / Math.max(out, 1e-3)) * 0.09, vC.y, NECK_Z + ((vC.z - NECK_Z) / Math.max(out, 1e-3)) * 0.09);
      add(vC.clone(), t, false);
    }
    // close before the eye: a few black, then white
    for (let i = 0; i < AT_LENS; i++) {
      const t = i < 6 ? 0.6 + (i / 6) * 8 + rand() * 0.8 : GREY_AT + 0.4 + ((i - 6) / (AT_LENS - 6)) * 7.2 + rand() * 0.4;
      add(new Vector3((rand() - 0.5) * 0.14, 1.52 + rand() * 0.06, EYE_FROM[2] - 0.1 - rand() * 0.07), t, false, true);
    }
    return tufts;
  }

  /** When the blades close (s). */
  private snipTimes(): number[] {
    const times: number[] = [];
    for (let k = 0; k < WORK.length; k++) for (const s of SNIPS) if (CUT_FROM + k * PASS + s <= SCISSORS_STOP + 1e-6) times.push(CUT_FROM + k * PASS + s);
    return times;
  }

  /** The scissors and the comb while he cuts, at second c (into `this.cut`), and how open the blades are. */
  private cutPose(c: number): number {
    const k = clamp(Math.floor((c - CUT_FROM) / PASS), 0, WORK.length - 1);
    const u = c - (CUT_FROM + k * PASS);
    const head = vD.set(HEAD[0], HEAD[1], HEAD[2]);
    workAt(k, vA);
    workAt(k + 1, vB);
    const nA = v1.copy(vA).normalize();
    const nB = v2.copy(vB).normalize();
    // the comb lifts a lock out from the head and holds it, then moves on to the next
    const turn = BARBER_TURN * DEG;
    const side = vS.set(Math.cos(turn), 0, -Math.sin(turn));
    const lift = ramp(0, 0.75, u);
    vC.copy(head).add(vA).addScaledVector(nA, 0.012 + 0.06 * lift).addScaledVector(UP, 0.015 * lift).addScaledVector(side, HAND_APART);
    vE.copy(head).add(vB).addScaledVector(nB, 0.012).addScaledVector(side, HAND_APART);
    const comb = this.cut.comb.at.lerpVectors(vC, vE, ramp(1.95, PASS, u));
    // the blades come in just outside the comb, close on it, and go back out
    let done = 0;
    for (const s of SNIPS) if (u > s) done++;
    vC.copy(head).add(vA).addScaledVector(nA, 0.085).addScaledVector(UP, 0.012 + 0.004 * done).addScaledVector(side, -HAND_APART);
    vE.copy(head).add(vA).addScaledVector(nA, 0.17).addScaledVector(UP, 0.03).addScaledVector(side, -HAND_APART);
    vW.copy(head).add(vB).addScaledVector(nB, 0.17).addScaledVector(UP, 0.03).addScaledVector(side, -HAND_APART);
    const blades = this.cut.scissors.at;
    if (u < 1.8) blades.lerpVectors(vE, vC, ramp(0.3, 0.9, u));
    else blades.lerpVectors(vC, vW, ramp(1.85, PASS, u));
    // each held pointing away from its own shoulder
    vW.set(BARBER_AT[0], SHOULDER_Y, BARBER_AT[2]).addScaledVector(side, -SHOULDER_HALF);
    aimAlong(vN.subVectors(blades, vW).setY(-0.08).normalize(), this.cut.scissors.turn);
    vW.set(BARBER_AT[0], SHOULDER_Y, BARBER_AT[2]).addScaledVector(side, SHOULDER_HALF);
    aimAlong(vN.subVectors(comb, vW).setY(0.05).normalize(), this.cut.comb.turn);
    let shut = 0;
    for (const s of SNIPS) shut = Math.max(shut, u < s - CLOSING || u > s + OPENING ? 0 : u < s ? (u - s + CLOSING) / CLOSING : 1 - (u - s) / OPENING);
    return OPEN * (1 - ease(shut));
  }

  /** The broom while he carries it off and sweeps with it, in his own frame as it is now. */
  private sweep(s: number, out: Pose): Pose {
    const body = this.barber.root;
    const turn = body.rotation.y;
    const ahead = vA.set(Math.sin(turn), 0, Math.cos(turn));
    const left = vB.set(Math.cos(turn), 0, -Math.sin(turn));
    let side = STROKE_FROM[0];
    let reach = STROKE_FROM[1];
    let lift = 0;
    if (s >= STROKES_AT && s < STROKES_END) {
      const w = ((s - STROKES_AT) / STROKE) % 1;
      const f = w < 0.62 ? ease(w / 0.62) : 1 - ease((w - 0.62) / 0.38);
      side = STROKE_FROM[0] + (STROKE_TO[0] - STROKE_FROM[0]) * f;
      reach = STROKE_FROM[1] + (STROKE_TO[1] - STROKE_FROM[1]) * f;
      if (w >= 0.62) lift = 0.06 * Math.sin(Math.PI * f);
    }
    const base = vC.copy(body.position).addScaledVector(left, side).addScaledVector(ahead, reach).setY(lift);
    const top = vD.copy(body.position).addScaledVector(left, 0.1).addScaledVector(ahead, 0.12).setY(BROOM_TOP);
    const carried = this.carried;
    carried.at.copy(base);
    carried.turn.setFromUnitVectors(UP, top.sub(base).normalize());
    return blend(this.rests.broom, carried, ramp(SWEEP_AT, SWEEP_AT + 0.4, s), out);
  }

  /** What the barber does at second s: where his tools are and where his hands go. */
  private choreograph(s: number): void {
    const now = this.now;
    const rest = this.rests;
    const [right, left] = this.arms;
    now.mirror.at.copy(rest.mirror.at);
    now.mirror.turn.copy(rest.mirror.turn);
    now.broom.at.copy(rest.broom.at);
    now.broom.turn.copy(rest.broom.turn);
    if (s < LAID) {
      now.open = this.cutPose(Math.min(s, SCISSORS_STOP));
      const f = ramp(HANDS_DOWN, LAID, s);
      blend(this.cut.scissors, rest.scissors, f, now.scissors);
      blend(this.cut.comb, rest.comb, f, now.comb);
      if (s >= SCISSORS_STOP) now.open = 0;
      gripOf(now.scissors, SCISSORS_GRIP, right.target);
      gripOf(now.comb, COMB_GRIP, left.target);
      return;
    }
    now.open = 0;
    const body = this.barber.root;
    const c = Math.cos(body.rotation.y);
    const sn = Math.sin(body.rotation.y);
    const pocket = this.pocket;
    now.scissors.at.set(body.position.x + pocket.x * c + pocket.z * sn, pocket.y, body.position.z - pocket.x * sn + pocket.z * c);
    now.scissors.turn.copy(rest.scissors.turn);
    blend(rest.comb, rest.comb, 1, now.comb);
    if (s < MIRROR_LAID) {
      gripOf(rest.scissors, SCISSORS_GRIP, vA);
      right.target.lerpVectors(vA, rest.rightHand, ramp(LAID, LAID + 0.6, s));
      if (s < LAID + 0.25) {
        gripOf(rest.comb, COMB_GRIP, vA);
        gripOf(rest.mirror, MIRROR_GRIP, vB);
        left.target.lerpVectors(vA, vB, ramp(LAID, LAID + 0.25, s));
      } else {
        blend(rest.mirror, rest.held, ramp(LAID + 0.25, MIRROR_UP, s) - ramp(MIRROR_DOWN, MIRROR_LAID, s), now.mirror);
        gripOf(now.mirror, MIRROR_GRIP, left.target);
      }
      return;
    }
    if (s < SWEEP_AT) {
      const f = ramp(MIRROR_LAID, SWEEP_AT, s);
      gripOf(rest.mirror, MIRROR_GRIP, vA);
      left.target.lerpVectors(vA, gripOf(rest.broom, BROOM_LOW, vB), f);
      right.target.lerpVectors(rest.rightHand, gripOf(rest.broom, BROOM_HIGH, vC), f);
      return;
    }
    this.sweep(s, now.broom);
    gripOf(now.broom, BROOM_LOW, left.target);
    gripOf(now.broom, BROOM_HIGH, right.target);
  }

  /** Turn the arms to their targets, then put the held tools in the hands as they came to be. */
  private animate(s: number): void {
    const go = ramp(SWEEP_AT, SWEEP_AT + 0.8, s);
    const body = this.barber.root;
    body.position.lerpVectors(this.standAt, this.sweepAt, go);
    body.rotation.y = (BARBER_TURN + (SWEEP_TURN - BARBER_TURN) * go) * DEG;
    body.updateMatrixWorld(true);
    this.feet.position.set(body.position.x, this.feet.position.y, body.position.z);
    this.choreograph(s);
    for (const arm of this.arms) {
      for (let i = 0; i < 3; i++) arm.bones[i].quaternion.copy(arm.rest[i]);
      reach(arm.bones[0], arm.bones[1], arm.bones[2], vA.copy(arm.target).add(this.origin), arm.pole);
    }
    const now = this.now;
    const [right, left] = this.arms;
    this.place(now.scissors, SCISSORS_GRIP, right, s < LAID, this.scissors.root);
    this.place(now.comb, COMB_GRIP, left, s < LAID, this.comb);
    this.place(now.mirror, MIRROR_GRIP, left, s >= LAID + 0.25 && s < MIRROR_LAID, this.mirror);
    this.place(now.broom, BROOM_LOW, left, false, this.broom);
    this.scissors.blades[0].rotation.y = now.open / 2;
    this.scissors.blades[1].rotation.y = -now.open / 2;
  }

  /** A tool where its pose says; when a hand holds it, moved with the hand to where the hand really came. */
  private place(pose: Pose, grip: V3, arm: Arm, held: boolean, tool: Object3D): void {
    tool.quaternion.copy(pose.turn);
    tool.position.copy(pose.at);
    if (!held) return;
    arm.bones[2].getWorldPosition(vB).sub(this.origin);
    tool.position.add(vB).sub(gripOf(pose, grip, vC));
  }

  /** The sound: beds from the start, a snip each time the blades close, a real silence when they stop. */
  private score(): void {
    const drip = (n: 1 | 3, gain = DRIP_GAIN) => this.sound.play(`rooms/tile_drip_${n}.mp3`, { gain, pan: -0.55, reverb: 0.25 });
    this.beat(0, () => {
      this.beds.hum = this.sound.bed('rooms/bulb_hum.mp3', { gain: HUM_GAIN, pan: -0.05, fade: 0.5 });
      this.beds.tick = this.sound.bed('rooms/clock_tick.mp3', { gain: TICK_GAIN, pan: -0.15, lowpass: 3500, reverb: 0.15, fade: 0.5 });
      this.beds.street = this.sound.bed('rooms/road_fog.mp3', { gain: STREET_GAIN, pan: -0.15, lowpass: 900, fade: 1 });
      this.beds.drone = this.sound.bed('rooms/dream_drone_low.mp3', { gain: DRONE_GAIN, fade: 4 });
      this.beds.comb = this.sound.bed('rooms/hair_fingers.mp3', { gain: COMB_GAIN, fade: 1.5 });
    });
    for (const t of this.snipTimes()) {
      this.beat(t, () => {
        this.cutPose(t);
        const pan = clamp(this.cut.scissors.at.x * 4, -0.6, 0.6);
        const hush = hushed(t) ? 0.5 : 1;
        this.sound.play(Math.round(t * 10) % 2 ? 'rooms/hair_pull_1.mp3' : 'rooms/hair_pull_2.mp3', { gain: SNIP_GAIN * hush, pan, rate: 0.92 + (t % 0.17) });
        this.sound.play('rooms/needle_set_1.mp3', { gain: SNIP_GAIN * 0.4 * hush, pan, rate: 1.3 });
      });
    }
    this.beat(0.9, () => drip(1));
    this.beat(7.9, () => drip(3));
    this.beat(GREY_AT, () => {
      this.beds.glass = this.sound.bed('rooms/dream_drone_glass.mp3', { gain: GLASS_GAIN, fade: 5 });
    });
    this.beat(GREY_AT + 0.3, () => this.sound.play('rooms/mourners_lean.mp3', { gain: 0.13, lowpass: 2200, reverb: 0.2 }));
    this.beat(10, () => drip(1));
    this.beat(16.4, () => this.beds.comb?.gain(0, 0.5));
    // the scissors stop, and so does everything else
    this.beat(SCISSORS_STOP + 0.05, () => {
      this.beds.tick?.gain(0, 0.25);
      this.beds.street?.gain(0, 0.4);
      this.beds.drone?.gain(DRONE_GAIN * 0.3, 0.6);
      this.beds.glass?.gain(0, 0.4);
      this.beds.hum?.gain(HUM_GAIN * 0.6, 0.5);
    });
    this.beat(17.7, () => drip(3, DRIP_GAIN * 0.8));
    this.beat(LAID, () => this.sound.play('rooms/porcelain_click_2.mp3', { gain: 0.2, pan: 0.3, lowpass: 3000, reverb: 0.15 }));
    this.beat(18.6, () => this.sound.play('rooms/glass_creak_1.mp3', { gain: 0.12, pan: 0.05, reverb: 0.15 }));
    this.beat(19, () => {
      this.beds.endless = this.sound.bed('rooms/hair_pull_wet.mp3', { gain: ENDLESS_GAIN, lowpass: 2600, fade: 1.5 });
      this.beds.glass?.gain(GLASS_GAIN * 1.4, 1.5);
    });
    this.beat(SHUTTER_AT, () => this.shutter(false));
    this.beat(MIRROR_DOWN, () => this.beds.endless?.gain(ENDLESS_GAIN * 0.5, 0.8));
    this.beat(SWEEP_AT, () => {
      this.sound.play('rooms/sheets_thousand.mp3', { gain: 0.26, lowpass: 2600, reverb: 0.3 });
      this.beds.street?.gain(STREET_GAIN * 1.3, 1.5);
      this.beds.hum?.gain(HUM_GAIN, 1);
    });
    this.beat(STROKES_AT + 0.1, () => this.sound.play('rooms/nails_scrape_3.mp3', { gain: 0.16, lowpass: 2400, pan: -0.25 }));
    this.beat(STROKES_AT + STROKE + 0.1, () => this.sound.play('rooms/nails_scrape_1.mp3', { gain: 0.14, lowpass: 2400, pan: -0.25 }));
    this.beat(STROKES_END, () => {
      this.beds.endless?.gain(ENDLESS_GAIN * 0.3, 1);
      this.beds.glass?.gain(GLASS_GAIN * 0.5, 1);
    });
    this.beat(LINE_AT, () => this.say({ tr: 'Sıhhatler olsun.', en: 'There. All done.' }, 2.6, 'dream'));
    this.beat(26.4, () => drip(1, DRIP_GAIN * 0.8));
    this.beat(CUT_AT, () => this.sound.stopAll(0.05));
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const grow = heapAt(s);
    this.hairU.uHairTime.value = s;
    this.hairU.uHairGrow.value = grow;
    const mass = this.massU;
    mass.uHeapGrow.value = grow;
    shadeAt(Math.min(s, SCISSORS_STOP), this.massPaint.color);
    mass.uRiverRise.value = ramp(STROKES_AT, STROKES_AT + 1, s);
    mass.uRiverFront.value = Math.max(0, s - STROKES_AT) * RIVER_RUN;
    mass.uRiverFlow.value = (Math.max(0, s - STROKES_AT) * RIVER_FLOW) / FIBRE_TILE;
    this.picture.paint(s, ramp(LAID + 0.6, MIRROR_UP + 0.7, s), range(MIRROR_UP, MIRROR_DOWN + 0.5, s), ramp(LAID + 0.4, MIRROR_UP - 0.2, s) * (1 - ramp(MIRROR_DOWN, MIRROR_LAID, s)));
    for (const t of this.motes) t.value = s;

    this.animate(s);

    const breath = 1 + 0.04 * wobble(s * 0.4, 3) - 0.08 * (ramp(SCISSORS_STOP, SCISSORS_STOP + 0.4, s) - ramp(SWEEP_AT - 0.5, SWEEP_AT, s));
    this.bulb.intensity = BULB_POWER * breath;
    this.echo.intensity = BULB_POWER * breath;
    this.key.intensity = KEY_POWER * breath;
    this.fear = 0.18 + 0.24 * range(GREY_AT, SCISSORS_STOP, s) + 0.1 * (ramp(SCISSORS_STOP, LAID, s) - ramp(MIRROR_DOWN, STROKES_END, s));
    this.black = s >= CUT_AT ? 1 : 0;
  }
}

/** The coat made white: what is cloth goes to a worn off-white with its folds and seams kept, the shirt and tie go dark, skin and the dark of the trousers stay. */
function whiteCoat(material: MeshStandardMaterial): void {
  const source = material.map!;
  const image = source.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const c = canvas.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(image, 0, 0);
  const img = c.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const l = r * 0.3 + g * 0.59 + b * 0.11;
    if (r > 1.7 * g && r > 1.5 * b && r > 50) {
      const v = 0.5 + l / 255;
      d[i] = 34 * v;
      d[i + 1] = 22 * v;
      d[i + 2] = 22 * v;
    } else if ((r > g && g > b && r - b > 45 && r > 110) || l < 42) {
      continue;
    } else {
      const v = 158 + l * 0.42;
      d[i] = Math.min(255, v + 6);
      d[i + 1] = Math.min(255, v + 3);
      d[i + 2] = Math.min(255, v - 5);
    }
  }
  c.putImageData(img, 0, 0);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.flipY = source.flipY;
  t.wrapS = source.wrapS;
  t.wrapT = source.wrapT;
  material.map = t;
}
