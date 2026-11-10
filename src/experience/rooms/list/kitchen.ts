import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
  type Material,
  type ShaderMaterial,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { SpotSpec } from '../../../config/nightmare.config';
import { rigClock, setClock, type ClockHand } from '../../dream/ClockRig';
import type { PropCrowd } from '../../dream/DreamKit';
import type { Crowd } from '../../dream/FigureKit';
import type { DreamLight } from '../../dream/LightPool';
import { DEG, clamp, lerp, range, smootherstep, wobble } from '../../math';
import { dateNow } from '../FourthWall';
import type { RoomAir, RoomAssets, RoomContext, RoomFilm, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import { PALETTE, type Facing } from '../RoomKit';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: [
    'fridge', 'cabinet_white', 'stove', 'table_kitchen', 'chair_worn', 'plate', 'bowl', 'fork', 'knife', 'spoon', 'tea_glass', 'bread_half',
    'roast_lump', 'pot_enamel', 'sink', 'tap', 'tube_light', 'wall_clock', 'roach', 'roach_low', 'fly', 'cutting_board', 'jug', 'salt_shaker', 'radiator',
    'cupboard_blue', 'door_six', 'door_frame', 'door_knob',
  ],
  materials: ['tile_white', 'plaster_pale', 'plaster_mould'],
  sounds: [
    'rooms/fridge_hum.mp3', 'rooms/dream_drone_low.mp3', 'rooms/insects_contact.mp3', 'rooms/roach_hiss_1.mp3', 'rooms/roach_hiss_2.mp3', 'rooms/roach_hiss_3.mp3',
    'rooms/fluorescent_tick_1.mp3', 'rooms/fluorescent_tick_2.mp3', 'rooms/fluorescent_tick_3.mp3', 'rooms/fluorescent_tick_4.mp3', 'rooms/fluorescent_tick_5.mp3', 'rooms/fluorescent_tick_6.mp3',
    'rooms/switch_small.mp3', 'rooms/fluorescent_stutter_1.mp3', 'rooms/fluorescent_stutter_2.mp3', 'rooms/fluorescent_start_1.mp3', 'rooms/roach_scatter.mp3', 'rooms/fluorescent_hum_close.mp3',
    'rooms/fork_plate_3.mp3', 'rooms/floor_creak_1.mp3', 'rooms/floor_creak_2.mp3', 'rooms/floor_creak_3.mp3', 'rooms/door_creak_short.mp3', 'rooms/rice_moving.mp3', 'rooms/wet_click_1.mp3', 'rooms/wet_click_2.mp3',
    'rooms/wet_plip_1.mp3', 'rooms/light_die.mp3', 'rooms/fridge_stop.mp3', 'rooms/swarm_swell.mp3', 'rooms/breaker_clunk_1.mp3', 'rooms/fluorescent_hum_bad.mp3', 'rooms/bugs_writhe.mp3',
    'rooms/insects_contact_wide.mp3', 'rooms/roach_box.mp3', 'rooms/flies_room.mp3', 'rooms/fridge_wrong.mp3', 'rooms/flies_passing.mp3', 'rooms/fly_land_1.mp3', 'rooms/fly_land_2.mp3', 'rooms/fly_land_3.mp3',
    'rooms/mouth_wet_2.mp3', 'rooms/fork_down_1.mp3',
  ],
};

type V3 = readonly [number, number, number];

/** The kitchen (m): the door is in the wall at z = 0, the far wall at z = -D; tile to TILE_H. */
const W = 3.7;
const D = 5;
const H = 2.5;
const TILE_H = 1.42;
/** The hole of the door, the wall's thickness and the bit of hall the viewer comes from (m). */
const DOOR_W = 0.86;
const DOOR_H = 2.01;
const WALL_T = 0.12;
const HALL_W = 1.7;
const HALL_L = 2.5;

/** The table stands along the view (m); `TOP` is the top of its oilcloth. */
const TABLE_Z = -2.95;
const TABLE_SCALE = 0.8;
const HX = 0.455;
const HZ = 0.9625;
const TOP = 0.7702;
const CLOTH_DROP = 0.2;
const FAR_EDGE = TABLE_Z - HZ;
const NEAR_EDGE = TABLE_Z + HZ;

/** The tube hangs over the far end of the table, across it (m). */
const TUBE_Y = 2.2;
const TUBE_Z = -3.55;
/** The clock: a little too big, and hung high enough to stand over his head (m; its scale). */
const CLOCK_X = 0.72;
const CLOCK_Y = 2.03;
const CLOCK_SCALE = 1.7;
/** The head chair, and the one who comes to sit there, too big for it (m; its scale, its color). */
const HEAD_CHAIR_Z = -4.08;
const SACK_Z = -4.5;
const SACK_SCALE = 1.3;
const SACK_TINT = 0xa89e82;
const MAN_DOORWAY = 0.06;
const MAN_BEHIND = -0.32;
const SEAT_NEAR: V3 = [0.62, 0, -1.62];
const SEAT_MINE: V3 = [0, 0, -1.42];

/** Your plate, the soup beside it (offsets from the table's center, m). */
const PLATES: readonly (readonly [number, number])[] = [[0, -0.74], [-0.29, 0.16], [0.29, -0.18], [0, 0.74]];
const MINE = PLATES[3];
const MY_BOWL: readonly [number, number] = [-0.16, 0.55];
const BOWLS: readonly (readonly [number, number])[] = [[0.24, -0.56], [-0.36, -0.1], MY_BOWL];
const BOWL_SCALE = 1.15;
const SOUP_Y = 0.05;
const SOUP_R = 0.066;
const GLASSES: readonly (readonly [number, number])[] = [[-0.25, -0.55], [-0.12, 0.42], [0.1, -0.4], [0.28, 0.63]];

/** The fridge, its light inside it and where the blade of that light is aimed (m); the door's gap (rad). */
const FRIDGE_AT: V3 = [-1.28, 0, -4.46];
const FRIDGE_FRONT = -4.045;
const FRIDGE_AJAR = -0.4;
const BLADE_FROM: V3 = [-1.2, 1.3, -4.62];
const BLADE_TO: V3 = [-0.2, 0.72, -2.85];
/** The two invisible flags that cut the light into a blade: how far along it they stand, the gap between them (m). */
const FLAG_AT = 0.55;
const FLAG_GAP = 0.04;
const FLAG_WIDE = 1.5;
/** The blade in the air, how far it reaches from the gap (m). */
const BEAM_LENGTH = 2.4;

/** The light (spots in candela, point lights as the pool wants them). */
const BLADE_COLOR = 0xcfeaf6;
const TUBE_COLOR = 0xdcf2dc;
const BLADE_KEY = 230;
const SPILL = 0.2;
const CLOCK_GLOW = 0.16;
const TABLE_DARK = 0.05;
const TUBE_KEY = 15;
const TUBE_FILL = 2.8;
const TUBE_GLOW = 7;
const TUBE_ANGLE = 68;
/** When it comes back: how much harder, how much less of it reaches the walls, how narrow it falls (deg). */
const HARD = 0.95;
const HARD_FILL = 0.3;
const HARD_FROM: V3 = [0, 2.42, -4.15];
const HARD_ANGLE = 52;
const HARD_AT: V3 = [0, 1.05, -4.22];
/** What keeps the man in the doorway from being only a shape. */
const MAN_FILL = 0.75;
/** How far the white furniture goes down when the light comes back (0..1). */
const DIM = 0.34;
const HALL_LAMP = 2.1;

/** The time of the room (s). */
const LINE_AT = 2;
const PROMPT_AT = 6;
const LIGHT_BY = 15;
/** The tube catching, counted from the switch (s): on, off, on, off, on for good; never faster than three a second. */
const STUTTER = [0, 0.36, 0.92, 1.26, 1.64] as const;
const CALM = REDUCED_MOTION ? 0.45 : 1;
const TICKS = [4.3, 5.4, 7.6, 8.15, 10.2, 11.7, 12.5, 14.3] as const;
/** Scattering, from the switch (s): how long the slowest take, and when the last is gone. */
const FLEE_START = 0.06;
const FLEE_DONE = 3;
const WALK_FROM = 23.2;
const MAN_AT = 26;
const MAGGOTS_WAKE = 27;
const MAGGOTS_ALL = 35.5;
const SOUP_ROACH = [31.6, 37.2] as const;
const LIGHT_FALTERS = 37.6;
const LIGHT_GONE = 38.45;
const FRIDGE_DIES = 38;
const LIGHT_BACK = 42;
const SHUTTER_AT = 43.5;
const STREAM_ARRIVES = 51;
/** How long the light's return blinds you (s). */
const BACK_WHITE = 0.32;
const FLIES_AT = 47;
const LAST_LINE = 50;
const CUT_AT = 54;
const HALF_PAST = 18.5 * 3600;

/** Roaches: on the table in all, of which before the light, and of those lying in the blade; those pouring out of the face. */
const TABLE_ROACHES = 900;
const BEFORE_ROACHES = 520;
const IN_THE_BLADE = 22;
const STREAM_ROACHES = 480;
const STREAM_SAMPLES = 96;
/** Those that never leave and keep the shape of a person: how many, from what height of its body (m) and the hole they leave open (m). */
const BODY_ROACHES = 600;
const BODY_FROM = 0.62;
const FACE_OPEN = 0.05;
/** How far under the middle of the face the head still is (m), and how many in twenty sit on the head. */
const HEAD_BELOW_FACE = 0.075;
const ON_THE_HEAD = 7;
/** How far over the middle of the face the top of the head begins (m), how far it must face you, and how many more in twenty sit there, so it is never bare. */
const CROWN_FROM = 0.04;
const CROWN_FACING = 0.2;
const ON_THE_CROWN = 3;
/** They are spread by the surface, not by its vertices: one place to sit per cell this big (m), so no fold gathers them into a beard. */
const SEAT_CELL = 0.022;
/** Under the chin the stream goes one by one, not as a beard: the share left out, full to the first u and gone by the second. */
const STREAM_THIN = 0.72;
const STREAM_SCATTER = [0.1, 0.2] as const;
/** Flat ones on walls, ceiling, floor: how many, and each one's width (m). */
const FIELD = 20000;
const FIELD_SIZE: readonly [number, number] = [0.06, 0.105];
/** Rice grains that turn out not to be (when the eye is close; else the first few), their radius and half length (m). */
const GRAINS = 1500;
const GRAINS_FAR = 700;
/** How many of them have already left the heap. */
const SPILLED = 70;
const GRAIN_R = 0.002;
const GRAIN_L = 0.0056;
const MOUND_R = 0.086;
const MOUND_H = 0.05;
const MOUND_AT: V3 = [MINE[0], TOP + 0.015, TABLE_Z + MINE[1]];

/** Flies on the lens: when they land, where (m on the near plane), how big; the distance of the lens (m). */
const LENS_Z = 0.066;
/** Its dark rim, and how dark it is: in the dark, in the light, over the plate, at the end (0..1). */
const LENS_EDGE_Z = 0.075;
const EDGE = { dark: 0.6, lit: 0.34, close: 0.92, back: 0.66 };
const FLIES = [
  { at: FLIES_AT, x: 0.015, y: 0.008, out: [0.09, 0.06], scale: 1.05 },
  { at: FLIES_AT + 0.7, x: -0.026, y: -0.006, out: [-0.1, -0.03], scale: 0.9 },
  { at: FLIES_AT + 1.7, x: 0.03, y: -0.012, out: [0.1, -0.07], scale: 0.8 },
  { at: FLIES_AT + 3.1, x: -0.008, y: 0.014, out: [-0.04, 0.08], scale: 1.0 },
] as const;

const UP = new Vector3(0, 1, 0);
const ZERO = new Matrix4().makeScale(0, 0, 0);
const m1 = new Matrix4();
const v1 = new Vector3();
const v2 = new Vector3();
const v3 = new Vector3();
const v4 = new Vector3();
const q1 = new Quaternion();

/** A deterministic random sequence: the same kitchen every evening. */
function randomFrom(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A table of fixed random numbers: read in `update`, so nothing is computed or allocated while it runs. */
const R = new Float32Array(1024);
{
  const random = randomFrom(1830);
  for (let i = 0; i < R.length; i++) R[i] = random();
}

const dart = (x: number): number => (x >= 1 ? 1 : x * x * (3 - 2 * x));

function texture(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, repeat = false): CanvasTexture {
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

/** A kitchen oilcloth: bone with a rust check, one image every CLOTH_TILE meters. */
const CLOTH_TILE = 0.24;
function drawOilcloth(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#d3ccb9';
  c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(120,48,36,0.26)';
  for (let i = 0; i < 4; i += 2) {
    c.fillRect((i * w) / 4, 0, w / 4, h);
    c.fillRect(0, (i * h) / 4, w, h / 4);
  }
  const random = randomFrom(5);
  for (let i = 0; i < 2600; i++) {
    c.fillStyle = `rgba(${random() < 0.5 ? '255,250,235' : '40,30,20'},0.03)`;
    c.fillRect(random() * w, random() * h, 2, 2);
  }
  // years of a damp cloth: the print has gone in long pale scratches
  c.lineCap = 'round';
  for (let i = 0; i < 120; i++) {
    const x = random() * w;
    const y = random() * h;
    const a = random() * Math.PI;
    const l = 12 + random() * 70;
    c.strokeStyle = `rgba(236,230,212,${0.05 + random() * 0.14})`;
    c.lineWidth = 0.6 + random() * 1.6;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    c.stroke();
  }
}

/** The dark that closes in from the edge of the eye. */
function drawLensEdge(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.translate(w / 2, h / 2);
  c.scale((w / h) * 0.94, 1);
  const g = c.createRadialGradient(0, 0, h * 0.2, 0, 0, h * 0.6);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  c.fillStyle = g;
  c.fillRect(-w, -h, w * 2, h * 2);
}

/** What dinners leave on a cloth. Its image lies over the top of the table: x across, z down the image. */
function drawStains(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(11);
  const toX = (x: number) => ((x + HX) / (2 * HX)) * w;
  const toY = (z: number) => ((z + HZ) / (2 * HZ)) * h;
  c.lineCap = 'round';
  // rings of tea glasses put down in the same places for years
  for (const [x, z] of GLASSES) {
    for (let k = 0; k < 3; k++) {
      c.strokeStyle = `rgba(92,58,24,${0.18 + random() * 0.2})`;
      c.lineWidth = 1 + random() * 2;
      c.beginPath();
      c.arc(toX(x + (random() - 0.5) * 0.06), toY(z + (random() - 0.5) * 0.06), 22 + random() * 3, 0, Math.PI * 2);
      c.stroke();
    }
  }
  for (const [x, z] of PLATES) {
    for (let k = 0; k < 14; k++) {
      const a = random() * Math.PI * 2;
      const d = 0.13 + random() * 0.12;
      const r = 2 + random() * 16;
      const g = c.createRadialGradient(toX(x + Math.cos(a) * d), toY(z + Math.sin(a) * d), 0, toX(x + Math.cos(a) * d), toY(z + Math.sin(a) * d), r);
      g.addColorStop(0, `rgba(116,70,24,${0.1 + random() * 0.26})`);
      g.addColorStop(1, 'rgba(116,70,24,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }
  }
}

/** The dirt a tiled wall collects: along the floor, in soft patches, in thin runs. */
function drawGrime(c: CanvasRenderingContext2D, w: number, h: number, seed: number): void {
  const random = randomFrom(seed);
  const foot = c.createLinearGradient(0, h, 0, h * 0.6);
  foot.addColorStop(0, 'rgba(18,15,8,0.66)');
  foot.addColorStop(1, 'rgba(18,15,8,0)');
  c.fillStyle = foot;
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = 30 + random() * 120;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.05 + random() * 0.15;
    g.addColorStop(0, `rgba(22,26,16,${a})`);
    g.addColorStop(1, 'rgba(22,26,16,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  c.lineCap = 'round';
  for (let i = 0; i < 80; i++) {
    const x = random() * w;
    const y = random() * h * 0.75;
    c.strokeStyle = `rgba(24,18,10,${0.04 + random() * 0.2})`;
    c.lineWidth = 0.6 + random() * 2.2;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + (random() - 0.5) * 8, y + 20 + random() * h * 0.5);
    c.stroke();
  }
}

/** A ceiling that has been leaked on: brown-edged rings, soot over the tube. */
function drawDamp(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(23);
  for (let i = 0; i < 9; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = 60 + random() * 170;
    const g = c.createRadialGradient(x, y, r * 0.55, x, y, r);
    g.addColorStop(0, 'rgba(60,44,20,0.03)');
    g.addColorStop(0.86, `rgba(66,54,28,${0.07 + random() * 0.12})`);
    g.addColorStop(1, 'rgba(70,50,22,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  const soot = c.createRadialGradient(w * 0.5, h * 0.29, 8, w * 0.5, h * 0.29, h * 0.3);
  soot.addColorStop(0, 'rgba(14,13,8,0.5)');
  soot.addColorStop(1, 'rgba(14,13,8,0)');
  c.fillStyle = soot;
  c.fillRect(0, 0, w, h);
}

/** A soft black round, for what stands on something. */
function drawBlot(c: CanvasRenderingContext2D, w: number, h: number): void {
  const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.82)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}

/** One roach seen from above, nose toward the top of the image: for those far enough away to be flat. */
function drawRoach(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.translate(w / 2, h / 2);
  c.scale(w / 128, h / 128);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = '#120904';
  c.lineWidth = 1.8;
  for (const side of [-1, 1]) {
    c.beginPath();
    c.moveTo(side * 3, -32);
    c.quadraticCurveTo(side * 15, -50, side * 27, -61);
    c.stroke();
  }
  c.lineWidth = 3.4;
  for (const side of [-1, 1]) {
    for (const [y0, kx, ky, tx, ty] of [[-14, 30, -26, 41, -43], [3, 34, 7, 51, 16], [14, 28, 30, 44, 55]] as const) {
      c.beginPath();
      c.moveTo(side * 10, y0);
      c.lineTo(side * kx, ky);
      c.lineTo(side * tx, ty);
      c.stroke();
    }
  }
  const g = c.createLinearGradient(-19, 0, 19, 0);
  g.addColorStop(0, '#130a04');
  g.addColorStop(0.42, '#52301a');
  g.addColorStop(0.58, '#4a2a14');
  g.addColorStop(1, '#130a04');
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(0, 7, 19, 33, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#7d5c31';
  c.beginPath();
  c.ellipse(0, -23, 15, 12, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#1b0f07';
  c.beginPath();
  c.ellipse(0, -23, 8, 7.5, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.75)';
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(0, -12);
  c.lineTo(2, 38);
  c.stroke();
  c.strokeStyle = 'rgba(255,224,176,0.3)';
  c.lineWidth = 3.4;
  c.beginPath();
  c.moveTo(-8, -6);
  c.quadraticCurveTo(-12, 14, -7, 31);
  c.stroke();
}

/** The face of the clock: it has to say half past from the door. */
function drawDial(c: CanvasRenderingContext2D, w: number, h: number): void {
  const r = w * 0.47;
  c.translate(w / 2, h / 2);
  const age = c.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
  age.addColorStop(0, '#bcb5a0');
  age.addColorStop(1, '#8e866e');
  c.fillStyle = age;
  c.beginPath();
  c.arc(0, 0, r, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#17140e';
  for (let i = 0; i < 12; i++) {
    c.save();
    c.rotate((i / 12) * Math.PI * 2);
    c.lineWidth = i % 3 === 0 ? w * 0.03 : w * 0.014;
    c.beginPath();
    c.moveTo(0, -r * 0.93);
    c.lineTo(0, -r * (i % 3 === 0 ? 0.74 : 0.84));
    c.stroke();
    c.restore();
  }
  c.fillStyle = '#0d0b08';
  for (const [angle, length, width] of [[(195 / 180) * Math.PI, r * 0.52, w * 0.03], [Math.PI, r * 0.84, w * 0.02]] as const) {
    c.save();
    c.rotate(angle);
    c.beginPath();
    c.moveTo(-width, r * 0.13);
    c.lineTo(width, r * 0.13);
    c.lineTo(width * 0.3, -length);
    c.lineTo(-width * 0.3, -length);
    c.closePath();
    c.fill();
    c.restore();
  }
  c.beginPath();
  c.arc(0, 0, w * 0.032, 0, Math.PI * 2);
  c.fill();
}

function drawRice(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#b5aa8d';
  c.fillRect(0, 0, w, h);
  const random = randomFrom(9);
  c.lineCap = 'round';
  for (let i = 0; i < 5200; i++) {
    const x = random() * w;
    const y = random() * h;
    const a = random() * Math.PI;
    const l = 7 + random() * 7;
    const v = 208 + Math.floor(random() * 42);
    c.strokeStyle = `rgb(${v},${v - 6},${v - 26})`;
    c.lineWidth = 3.4 + random() * 1.8;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    c.stroke();
  }
}

function drawStew(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#4f2412';
  c.fillRect(0, 0, w, h);
  const random = randomFrom(14);
  for (let i = 0; i < 260; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = 3 + random() * 16;
    c.fillStyle = `rgba(${130 + random() * 70},${60 + random() * 44},${20 + random() * 24},0.5)`;
    c.beginPath();
    c.ellipse(x, y, r, r * (0.5 + random() * 0.5), random() * 3, 0, Math.PI * 2);
    c.fill();
  }
}

function drawSoup(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#a65a1c';
  c.fillRect(0, 0, w, h);
  const random = randomFrom(18);
  for (let i = 0; i < 900; i++) {
    c.fillStyle = `rgba(${200 + random() * 40},${120 + random() * 50},${30 + random() * 26},0.32)`;
    c.beginPath();
    c.arc(random() * w, random() * h, 1 + random() * 3.6, 0, Math.PI * 2);
    c.fill();
  }
  c.strokeStyle = 'rgba(255,214,120,0.34)';
  c.lineWidth = 2;
  for (let i = 0; i < 30; i++) {
    c.beginPath();
    c.arc(w / 2 + (random() - 0.5) * w * 0.7, h / 2 + (random() - 0.5) * h * 0.7, 3 + random() * 12, 0, Math.PI * 2);
    c.stroke();
  }
}

/** A striped kitchen towel: white cotton, a rust band near each end. */
function drawTowel(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#d6d1c2';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#8a3a2b';
  c.fillRect(0, h * 0.8, w, h * 0.05);
  c.fillRect(0, h * 0.875, w, h * 0.022);
  const random = randomFrom(3);
  c.strokeStyle = 'rgba(70,60,44,0.1)';
  for (let i = 0; i < 700; i++) {
    const x = random() * w;
    const y = random() * h;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + 6, y + (random() - 0.5) * 2);
    c.stroke();
  }
}

/** A cloth lying over a table of half-size (hx, hz) and falling `drop` over its edges, with soft folds. UVs in shares of `tile`. */
function drapedCloth(hx: number, hz: number, drop: number, top: number, step: number, tile: number): BufferGeometry {
  const nx = Math.ceil(((hx + drop) * 2) / step);
  const nz = Math.ceil(((hz + drop) * 2) / step);
  const position = new Float32Array((nx + 1) * (nz + 1) * 3);
  const uv = new Float32Array((nx + 1) * (nz + 1) * 2);
  const index: number[] = [];
  let k = 0;
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const px = -(hx + drop) + (i / nx) * (hx + drop) * 2;
      const pz = -(hz + drop) + (j / nz) * (hz + drop) * 2;
      const dx = Math.max(0, Math.abs(px) - hx);
      const dz = Math.max(0, Math.abs(pz) - hz);
      const d = Math.hypot(dx, dz);
      const along = dx > dz ? pz : px;
      const fold = (Math.sin(along * 26 + 1.1) * 0.009 + Math.sin(along * 53 + 2.2) * 0.005) * smootherstep(d / 0.09);
      const corner = dx > 0.001 && dz > 0.001 ? 0.022 * smootherstep(d / 0.1) : 0;
      const sx = Math.sign(px) || 1;
      const sz = Math.sign(pz) || 1;
      position[k * 3] = sx * (Math.min(Math.abs(px), hx) + (dx > 0 ? 0.008 + fold + corner : 0));
      position[k * 3 + 1] = top - d * 0.98;
      position[k * 3 + 2] = sz * (Math.min(Math.abs(pz), hz) + (dz > 0 ? 0.008 + fold + corner : 0));
      uv[k * 2] = px / tile;
      uv[k * 2 + 1] = pz / tile;
      if (i < nx && j < nz) {
        const a = j * (nx + 1) + i;
        const b = a + 1;
        const c = a + nx + 1;
        const e = c + 1;
        index.push(a, c, b, b, c, e);
      }
      k++;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(position, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A hanging strip of cloth under its top edge, with folds; its top is y = 0, it falls `long` m. */
function hangingCloth(wide: number, long: number): BufferGeometry {
  const nx = 12;
  const ny = 22;
  const position: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const v = j / ny;
      const fold = (Math.sin(u * 13 + 0.6) * 0.011 + Math.sin(u * 7) * 0.016) * (0.3 + v * 0.7);
      position.push((u - 0.5) * wide * (1 - 0.3 * Math.sin(v * Math.PI) * 0.4), -v * long, fold);
      uv.push(u, 1 - v);
      if (i < nx && j < ny) {
        const a = j * (nx + 1) + i;
        index.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(position, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A heap of food: a low dome, uneven, with a bite gone out of one side; planar UVs. */
function foodHeap(radius: number, height: number, bite: number, seed: number): BufferGeometry {
  const g = new SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const random = randomFrom(seed);
  const w0 = random() * 6.3;
  const w1 = random() * 6.3;
  const biteAt = random() * 6.3;
  const p = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const edge = 1 + Math.sin(a * 3 + w0) * 0.1 + Math.sin(a * 7 + w1) * 0.05;
    const away = Math.abs(Math.atan2(Math.sin(a - biteAt), Math.cos(a - biteAt)));
    const taken = 1 - bite * smootherstep(range(1.1, 0.2, away));
    p.setXYZ(i, x * radius * edge * (0.72 + 0.28 * taken), y * height * taken * edge, z * radius * edge * (0.72 + 0.28 * taken));
    uv.setXY(i, (x * radius) / 0.2, (z * radius) / 0.2);
  }
  g.computeVertexNormals();
  return g;
}

/** A soft worm or a grain of rice: a tube along Z from -1 to 1, of radius 1, one end narrower. */
function grainShape(): BufferGeometry {
  const rings = 7;
  const sides = 5;
  const position: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= rings; j++) {
    const z = (j / rings) * 2 - 1;
    const r = Math.pow(Math.max(0, 1 - z * z), 0.4) * (1 - z * 0.25) + 0.001;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      position.push(Math.cos(a) * r, Math.sin(a) * r, z);
      normal.push(Math.cos(a), Math.sin(a), 0);
      if (j < rings) {
        const b = j * sides + i;
        const c = j * sides + ((i + 1) % sides);
        const d = b + sides;
        const e = c + sides;
        index.push(b, c, d, c, e, d);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  g.setIndex(index);
  return g;
}

/** The face of a baked sitting body: the middle of the front of its head, from its own vertices. */
function faceOf(crowd: Crowd): Vector3 {
  const face = new Vector3();
  let high = -Infinity;
  const heads: BufferGeometry[] = [];
  for (const child of crowd.root.children) {
    const mesh = child as InstancedMesh;
    if (!/head/i.test((mesh.material as Material).name)) continue;
    heads.push(mesh.geometry);
    const p = mesh.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) high = Math.max(high, p.getY(i));
  }
  let front = -Infinity;
  for (const g of heads) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) if (p.getY(i) > high - 0.17 && p.getY(i) < high - 0.08) front = Math.max(front, p.getZ(i));
  }
  let n = 0;
  for (const g of heads) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      if (p.getZ(i) > front - 0.02 && p.getY(i) > high - 0.2 && p.getY(i) < high - 0.05) {
        face.x += p.getX(i);
        face.y += p.getY(i);
        face.z += p.getZ(i);
        n++;
      }
    }
  }
  if (n > 0) face.divideScalar(n);
  else face.set(0, 1.2, 0.1);
  return face;
}

/** How far forward a baked body reaches at a height (its middle only). */
function chestOf(crowd: Crowd, y: number): number {
  let front = 0;
  for (const child of crowd.root.children) {
    const p = (child as InstancedMesh).geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) - y) < 0.05 && Math.abs(p.getX(i)) < 0.14) front = Math.max(front, p.getZ(i));
  }
  return front;
}

/** The tips of the right hand of a baked standing body: lowest points of what hangs on its right side. */
function rightHandOf(crowd: Crowd): Vector3 {
  const hand = new Vector3(-0.24, 0.8, 0.02);
  let low = Infinity;
  for (const child of crowd.root.children) {
    const p = (child as InstancedMesh).geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      if (p.getX(i) < -0.2 && p.getY(i) > 0.62 && p.getY(i) < low) {
        low = p.getY(i);
        hand.set(p.getX(i), low, p.getZ(i));
      }
    }
  }
  return hand;
}

/**
 * The kitchen of the evenings, seen from its door: a table set for four and left, a fridge not quite shut, one
 * blade of cold light across the dinner. The viewer asks for the light, and is shown everything that was on
 * the plates running away. Then it is an ordinary kitchen for a long moment, until one looks at the rice.
 * When the light comes back they have stopped hiding, and someone is sitting at the head of the table.
 */
export default class Kitchen extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x070b0b, density: 0.03 },
    env: 'bathroom',
    envIntensity: 0.02,
    sky: 0,
    grade: { exposure: 1.34, saturation: 0.7, warmth: -0.03, tint: -0.01, flare: 0.003 },
  };
  control = { look: true, scroll: true, press: false, hurry: 1.8 };
  film: RoomFilm = { bloom: 0.95, bloomFrom: 0.55, bloomTint: [0.85, 0.97, 1], grain: 0.5, scratches: 0.1, flicker: 0.02, weave: 0.0004, aberration: 0.05 };
  focus = 4.6;
  aperture = 3.5;
  drift = REDUCED_MOTION ? 0.3 : 0.6;
  fear = 0.3;

  // the light
  private litAt = Infinity;
  private fellOnItsOwn = true;
  private soundStep = 0;
  private tickAt = -10;
  private shot = false;
  private shadowsDue = false;
  private readonly bladeSpot: SpotSpec;
  private readonly tubeSpot: SpotSpec;
  private readonly darkSpots: readonly (SpotSpec | null)[];
  private readonly litSpots: readonly (SpotSpec | null)[];
  private readonly hardSpots: readonly (SpotSpec | null)[];
  private readonly hardSpot: SpotSpec;
  private readonly flags: Mesh[] = [];
  private readonly spill: DreamLight;
  private readonly clockLamp: DreamLight;
  private readonly tableDark: DreamLight;
  private readonly tubeFill: DreamLight;
  private readonly manLamp: DreamLight;
  private readonly dimmed: MeshStandardMaterial[] = [];
  private readonly undimmed: Color[] = [];
  private isDimmed = false;
  private tube!: MeshStandardMaterial;
  private readonly tubeHalo: Mesh;
  private readonly tubeHaloColor: Color;
  private fridgeCard!: Mesh;
  private fridgeHalo!: Mesh;
  private fridgeDoor!: Object3D;
  private beam!: Mesh;
  private readonly clockHands: ClockHand[];
  private readonly moteTime: { value: number };

  // the bodies
  private readonly sack: Group;
  private readonly man: Group;
  private nearChair!: Object3D;
  private headChair!: Object3D;
  private readonly face: Vector3;

  // the roaches: `crowd` holds those on the table first, then those pouring out of the face
  private readonly crowd: PropCrowd;
  private crowdDrawn = -1;
  private readonly homeX = new Float32Array(TABLE_ROACHES);
  private readonly homeZ = new Float32Array(TABLE_ROACHES);
  private readonly delay = new Float32Array(TABLE_ROACHES);
  private readonly speed = new Float32Array(TABLE_ROACHES);
  private readonly size = new Float32Array(TABLE_ROACHES);
  private readonly discs: Float32Array;
  private readonly path = new Float32Array(STREAM_SAMPLES * 12);
  private readonly seats = new Float32Array(BODY_ROACHES * 6);
  private readonly tremble = { value: 0 };
  private readonly fieldState = { value: new Vector3() };
  private readonly fieldMesh: InstancedMesh;
  private wx = 0;
  private wz = 0;
  private wh = 0;

  // the plate
  private readonly grainMesh: InstancedMesh;
  private readonly maggotTime = { value: 0 };
  private readonly maggotLife = { value: 0 };
  private readonly soupRoach: Object3D;

  // the lens
  private readonly flyCrowd: PropCrowd;
  private flyDrawn = -1;
  private readonly flyTime = { value: 0 };
  private readonly vignette: Mesh;
  private readonly lensEdge: MeshBasicMaterial;

  // the sound
  private fridgeBed: RoomVoice | null = null;
  private droneBed: RoomVoice | null = null;
  private insectsBed: RoomVoice | null = null;
  private humBed: RoomVoice | null = null;
  private riceBed: RoomVoice | null = null;
  private dying: RoomVoice | null = null;
  private swell: RoomVoice | null = null;
  private readonly endBeds: RoomVoice[] = [];

  constructor(ctx: RoomContext) {
    super(ctx);
    const seconds = this.seconds;
    const pose = (s: number, at: V3, yaw: number, pitch: number, fov: number): RoomKey => ({ t: s / seconds, at, yaw, pitch, fov });
    const plateZ = TABLE_Z + MINE[1];
    this.keys = [
      pose(0, [0.04, 1.56, 0.74], -3, -8.5, 46),
      pose(WALK_FROM, [0.03, 1.56, 0.56], -2, -8, 45),
      pose(MAN_AT, [0.02, 1.55, -0.55], -1, -13, 46),
      pose(29, [0.02, 1.53, -1.12], -0.5, -22, 46),
      pose(32, [0.01, 1.42, -1.62], 0, -40, 45),
      pose(34.5, [-0.03, TOP + 0.46, plateZ + 0.2], 2, -66, 38),
      pose(37.4, [-0.08, TOP + 0.5, plateZ + 0.07], 0, -72, 40),
      pose(LIGHT_GONE, [-0.08, TOP + 0.5, plateZ + 0.07], 0, -72, 40),
      pose(LIGHT_BACK - 0.4, [SEAT_MINE[0], 1.26, SEAT_MINE[2]], 0, 3, 56),
      pose(LIGHT_BACK, [SEAT_MINE[0], 1.26, SEAT_MINE[2]], 0, 3, 56),
      pose(LAST_LINE + 0.6, [SEAT_MINE[0], 1.25, SEAT_MINE[2] - 0.08], 0, 5.5, REDUCED_MOTION ? 52 : 43),
      pose(CUT_AT, [SEAT_MINE[0], 1.2, SEAT_MINE[2] - 0.42], 0, REDUCED_MOTION ? -20 : -44, 40),
      pose(seconds, [SEAT_MINE[0], 1.2, SEAT_MINE[2] - 0.42], 0, REDUCED_MOTION ? -20 : -44, 40),
    ];

    const b = this.build;
    const root = this.root;
    this.shell();
    this.door();
    this.furniture();
    this.setTable();

    // the one thing that shines in the dark
    this.fridge();
    this.discs = this.tableDiscs();

    // the light of the tube is rendered as a spot for the shadows, and spilled by a point light for the walls
    this.bladeSpot = this.spot(BLADE_FROM, BLADE_TO, BLADE_COLOR, BLADE_KEY, 40, 0.1);
    this.tubeSpot = this.spot([0, TUBE_Y - 0.06, TUBE_Z], [0, 0, TUBE_Z + 0.25], TUBE_COLOR, TUBE_KEY, TUBE_ANGLE, 0.75);
    this.darkSpots = [this.bladeSpot, null, null];
    this.litSpots = [this.tubeSpot, null, null];
    this.hardSpot = this.spot(HARD_FROM, HARD_AT, TUBE_COLOR, TUBE_KEY * HARD, HARD_ANGLE, 0.55);
    this.hardSpots = [this.hardSpot, null, null];
    this.spots = this.darkSpots;
    this.spill = this.light([-0.42, 0.95, -3.62], BLADE_COLOR, SPILL, 2);
    this.clockLamp = this.light([CLOCK_X, CLOCK_Y + 0.24, -D + 0.42], 0xc4dde0, CLOCK_GLOW, 1.15);
    this.manLamp = this.light([0, 1.5, -0.95], 0xcfe0d8, 0, 2.6);
    this.tableDark = this.light([0.15, 2.1, TABLE_Z], 0x9fc2cc, TABLE_DARK, 3.4);
    this.tubeFill = this.light([0, TUBE_Y - 0.14, TUBE_Z + 0.5], TUBE_COLOR, 0, 8);
    this.light([0.1, 2.25, HALL_L * 0.66], PALETTE.warm, HALL_LAMP, 3.4);
    this.tubeHalo = b.glow(0, TUBE_Y - 0.09, TUBE_Z, 2.6, TUBE_COLOR, 0, root, 2.2);
    this.tubeHaloColor = ((this.tubeHalo.material as ShaderMaterial).uniforms.uColor as { value: Color }).value;

    this.moteTime = b.motes(170, { x: [-W / 2 + 0.1, W / 2 - 0.1], y: [0.15, H - 0.1], z: [-D + 0.1, -0.1] }, root, { strength: 1.2 }).time;

    const clock = this.kit.prop('wall_clock', [CLOCK_X, CLOCK_Y, -D + 0.042], { scale: CLOCK_SCALE, anchor: 'center' }, root);
    clock.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh && /glass/i.test((mesh.material as Material).name)) mesh.visible = false;
    });
    this.clockHands = rigClock(clock);
    setClock(this.clockHands, HALF_PAST);
    const dial = b.label(0.5, 0.5, drawDial, { px: 512, transparent: true, roughness: 0.75 });
    dial.mesh.position.set(CLOCK_X, CLOCK_Y, -D + 0.079);
    root.add(dial.mesh);

    // he was not there: the chair at the head of the table is empty until the light has been away
    const sacks = b.sack(1, { clip: 'm_sit_chair_idle_roll_head', time: 4.2, tint: SACK_TINT, bleach: 0.2 });
    sacks.setMatrix(0, m1.makeScale(SACK_SCALE, SACK_SCALE, SACK_SCALE).setPosition(0, 0, SACK_Z));
    sacks.commit();
    this.castFrom(sacks.root);
    this.sack = new Group();
    this.sack.add(sacks.root);
    this.sack.visible = false;
    root.add(this.sack);
    this.face = faceOf(sacks).multiplyScalar(SACK_SCALE).add(v1.set(0, 0, SACK_Z));
    this.pourPath(sacks);
    this.seatOnBody(sacks);

    // he stands where you came in: his collar empty, his suit pressed, a towel in his hand
    const men = b.headless(1, { tint: 0x5c6470, bleach: 0.15 });
    men.set(0, 0, 0, 0, 0);
    men.commit();
    this.castFrom(men.root);
    this.man = new Group();
    this.man.add(men.root);
    const towelMaterial = new MeshStandardMaterial({ map: texture(128, 256, drawTowel), roughness: 0.9, side: DoubleSide });
    const towel = new Mesh(hangingCloth(0.21, 0.46), towelMaterial);
    const hand = rightHandOf(men);
    towel.position.set(hand.x, hand.y + 0.3, hand.z + 0.11);
    towel.castShadow = true;
    towel.frustumCulled = false;
    this.man.add(towel);
    this.man.rotation.y = Math.PI;
    this.man.position.set(0, 0, MAN_DOORWAY);
    this.man.visible = false;
    root.add(this.man);

    const { crowd, field } = this.roaches();
    this.crowd = crowd;
    this.fieldMesh = field;
    const plate = this.rice();
    this.grainMesh = plate.grains;
    this.soupRoach = plate.roach;
    this.flyCrowd = this.flies();

    // the eye's own dark edge: heavier when it is close to the plate
    this.lensEdge = new MeshBasicMaterial({ map: texture(128, 72, drawLensEdge), transparent: true, depthTest: false, depthWrite: false, fog: false });
    this.vignette = new Mesh(new PlaneGeometry(1, 1), this.lensEdge);
    this.vignette.position.z = -LENS_EDGE_Z;
    this.vignette.renderOrder = 20;
    this.vignette.frustumCulled = false;
    this.lens.add(this.vignette);

    this.score();
  }

  /** Walls of tile and damp plaster, a floor, a ceiling, what dirt has done to them. */
  private shell(): void {
    const b = this.build;
    const k = this.kit;
    const root = this.root;
    const tile = k.surface('tile_white', 1.2, { color: new Color(0xa6bcab), roughness: 0.3 });
    const plaster = k.surface('plaster_pale', 2, { color: new Color(0x8c9a84) });
    const stretch = (x: number, z: number, w: number, facing: Facing) => {
      b.wall(x, z, w, TILE_H, facing, tile, root);
      b.wall(x, z, w, H - TILE_H, facing, plaster, root, TILE_H);
    };
    const side = (W - DOOR_W) / 2;
    stretch(W / 2, -D / 2, D, '-x');
    stretch(-W / 2, -D / 2, D, '+x');
    stretch(0, -D, W, '+z');
    stretch(-(DOOR_W + side) / 2, 0, side, '-z');
    stretch((DOOR_W + side) / 2, 0, side, '-z');
    b.wall(0, 0, DOOR_W, H - DOOR_H, '-z', plaster, root, DOOR_H);
    b.box(W, D, H, { floor: Object.assign(b.checker(0.27), { roughness: 0.72 }), ceiling: k.surface('plaster_mould', 1.8, { color: new Color(0x98a698) }) }, root);

    // glazed tile rail at the top of the tile, a plinth along the floor
    const rails: BufferGeometry[] = [];
    const rail = (w: number, h: number, d: number, x: number, y: number, z: number) => rails.push(new BoxGeometry(w, h, d).translate(x, y, z));
    for (const [y, h, d] of [[TILE_H, 0.045, 0.018], [0.06, 0.12, 0.014]] as const) {
      rail(d, h, D, -W / 2 + d / 2, y, -D / 2);
      rail(d, h, D, W / 2 - d / 2, y, -D / 2);
      rail(W, h, d, 0, y, -D + d / 2);
      rail(side, h, d, -(DOOR_W + side) / 2, y, -d / 2);
      rail(side, h, d, (DOOR_W + side) / 2, y, -d / 2);
    }
    const trims = new Mesh(mergeGeometries(rails)!, new MeshStandardMaterial({ color: 0x4e5f55, roughness: 0.34 }));
    trims.receiveShadow = true;
    root.add(trims);

    // grime: the walls keep every dinner there has ever been
    const decal = (width: number, height: number, x: number, y: number, z: number, yaw: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) => {
      const label = b.label(width, height, draw, { px: 190, transparent: true, roughness: 0.9 });
      (label.mesh.material as Material).depthWrite = false;
      label.mesh.position.set(x, y, z);
      label.mesh.rotation.y = yaw;
      label.mesh.renderOrder = 1;
      root.add(label.mesh);
      return label.mesh;
    };
    const dirt = (s: number) => (c: CanvasRenderingContext2D, w: number, h: number) => drawGrime(c, w, h, s);
    decal(D, TILE_H, W / 2 - 0.004, TILE_H / 2, -D / 2, -Math.PI / 2, dirt(31));
    decal(D, TILE_H, -W / 2 + 0.004, TILE_H / 2, -D / 2, Math.PI / 2, dirt(32));
    decal(W, TILE_H, 0, TILE_H / 2, -D + 0.004, 0, dirt(33));
    const damp = decal(W, D, 0, H - 0.004, -D / 2, 0, drawDamp);
    damp.rotation.set(Math.PI / 2, 0, 0);
    const floorDirt = decal(W, D, 0, 0.0035, -D / 2, 0, (c, w, h) => {
      const random = randomFrom(47);
      c.lineCap = 'round';
      for (let i = 0; i < 60; i++) {
        const x = random() * w;
        const y = random() * h;
        const r = 40 + random() * 150;
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(16,14,8,${0.06 + random() * 0.2})`);
        g.addColorStop(1, 'rgba(16,14,8,0)');
        c.fillStyle = g;
        c.fillRect(x - r, y - r, r * 2, r * 2);
      }
    });
    floorDirt.rotation.set(-Math.PI / 2, 0, 0);
  }

  /** The white things go down with the light when it comes back: nothing may outshine the head of the table. */
  private toDim(object: Object3D): void {
    object.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const own = (mesh.material as MeshStandardMaterial).clone();
      mesh.material = own;
      this.dimmed.push(own);
      this.undimmed.push(own.color.clone());
    });
  }

  /** The door you came in by and the bit of the hall behind it, with its wallpaper. */
  private door(): void {
    const b = this.build;
    const k = this.kit;
    const root = this.root;
    const damask = b.damask(PALETTE.damaskGreen);
    const wood = b.wood(1.1);
    const hall = b.box(HALL_W, HALL_L, H, { walls: damask, floor: b.checker(0.45), ceiling: b.ceiling(0.6), skip: ['+z'] }, root);
    hall.position.z = HALL_L;
    const side = (HALL_W - DOOR_W) / 2;
    b.wall(-(DOOR_W + side) / 2, WALL_T, side, H, '+z', damask, root);
    b.wall((DOOR_W + side) / 2, WALL_T, side, H, '+z', damask, root);
    b.wall(0, WALL_T, DOOR_W, H - DOOR_H, '+z', damask, root, DOOR_H);
    b.wainscot(HALL_W / 2, (HALL_L + WALL_T) / 2, HALL_L - WALL_T, '-x', root);
    b.wainscot(-HALL_W / 2, (HALL_L + WALL_T) / 2, HALL_L - WALL_T, '+x', root);
    b.door(0, HALL_L, '-z', root, { color: 0x1d1913, beyond: 0x000000 });

    b.wall(-DOOR_W / 2, WALL_T / 2, WALL_T, DOOR_H, '+x', wood, root);
    b.wall(DOOR_W / 2, WALL_T / 2, WALL_T, DOOR_H, '-x', wood, root);
    const soffit = k.floor(-DOOR_W / 2, DOOR_W / 2, 0, WALL_T, DOOR_H, wood);
    soffit.rotation.x = Math.PI / 2;
    root.add(soffit);

    const paint = b.paint(0x56594a, 0.55);
    k.paint(k.prop('door_frame', [0, 0, WALL_T + 0.011], {}, root), paint);
    k.paint(k.prop('door_frame', [0, 0, -0.011], { rotation: [0, 180, 0] }, root), paint);
    const hinge = new Group();
    hinge.position.set(-DOOR_W / 2 + 0.01, 0, -0.022);
    hinge.rotation.y = 2.25;
    root.add(hinge);
    k.paint(k.prop('door_six', [0.419, 0, 0], {}, hinge), paint);
    k.prop('door_knob', [0.76, 1.0, 0], { anchor: 'center' }, hinge);
  }

  /** What every kitchen has; each thing against its wall. */
  private furniture(): void {
    const k = this.kit;
    const b = this.build;
    const root = this.root;
    const right = W / 2;
    const left = -W / 2;
    this.toDim(k.prop('stove', [right - 0.335, 0, -4.42], { rotation: [0, -90, 0], castShadow: true }, root));
    this.toDim(k.prop('cabinet_white', [right - 0.32, 0, -3.35], { rotation: [0, -90, 0], castShadow: true }, root));
    k.prop('pot_enamel', [right - 0.33, 0.859, -4.42], {}, root);
    k.prop('jug', [right - 0.3, 1.182, -3.05], { rotation: [0, 60, 0] }, root);
    k.prop('sink', [right - 0.26, 0.7, -2.15], { rotation: [0, -90, 0], castShadow: true }, root);
    k.prop('tap', [right - 0.07, 0.86, -2.15], { rotation: [0, -90, 0] }, root);
    k.prop('radiator', [left + 0.15, 0.07, -2.8], { rotation: [0, 90, 0], castShadow: true }, root);
    k.prop('cupboard_blue', [left + 0.37, 0, -0.95], { rotation: [0, 90, 0], scale: 0.86, castShadow: true }, root);

    const date = dateNow();
    const calendar = b.label(0.25, 0.34, (c, w, h) => {
      c.fillStyle = '#a39d8c';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#5e221a';
      c.fillRect(0, 0, w, h * 0.13);
      c.textAlign = 'center';
      c.font = `bold ${h * 0.46}px Georgia, serif`;
      c.fillText(date.slice(0, 2), w / 2, h * 0.62);
      c.fillStyle = '#26221a';
      c.font = `${h * 0.08}px Georgia, serif`;
      c.fillText(date.slice(3), w / 2, h * 0.76);
      c.strokeStyle = 'rgba(40,34,24,0.4)';
      for (let i = 0; i < 4; i++) {
        c.beginPath();
        c.moveTo(w * 0.12, h * (0.82 + i * 0.04));
        c.lineTo(w * 0.88, h * (0.82 + i * 0.04));
        c.stroke();
      }
    }, { px: 620 });
    calendar.mesh.position.set(left + 0.006, 1.68, -2.8);
    calendar.mesh.rotation.y = Math.PI / 2;
    root.add(calendar.mesh);

    // a tube on two rods; its diffuser is what glows
    const lamp = k.prop('tube_light', [0, TUBE_Y, TUBE_Z], { anchor: 'top' }, root);
    const glass = lamp.getObjectByName('tube') as Mesh;
    this.tube = (glass.material as MeshStandardMaterial).clone();
    this.tube.color.setHex(0xe8efe6);
    this.tube.emissive.setHex(0xe6fbe2);
    this.tube.emissiveIntensity = 0.02;
    glass.material = this.tube;
    const rods = new Mesh(
      mergeGeometries([new CylinderGeometry(0.006, 0.006, H - TUBE_Y, 6).translate(-0.42, (H + TUBE_Y) / 2, TUBE_Z), new CylinderGeometry(0.006, 0.006, H - TUBE_Y, 6).translate(0.42, (H + TUBE_Y) / 2, TUBE_Z)])!,
      new MeshStandardMaterial({ color: 0x1c1d19, roughness: 0.5, metalness: 0.5 }),
    );
    root.add(rods);

    // every body that stands on something: only the key light casts, and only from one side
    this.blots([
      [0, 0.005, TABLE_Z, 1.5, 2.5],
      [0, 0.005, HEAD_CHAIR_Z - 0.02, 0.8, 0.8],
      [-0.74, 0.005, TABLE_Z + 0.16, 0.8, 0.8],
      [0.74, 0.005, TABLE_Z - 0.18, 0.8, 0.8],
      [FRIDGE_AT[0], 0.005, FRIDGE_AT[2], 1.6, 1.5],
      [right - 0.32, 0.005, -3.35, 1.1, 1.9],
      [right - 0.32, 0.005, -4.4, 1, 0.9],
      [left + 0.15, 0.005, -2.8, 0.5, 1.5],
      [left + 0.37, 0.005, -0.95, 1.1, 1.2],
    ]);
  }

  private blots(list: readonly (readonly [number, number, number, number, number])[]): void {
    const g = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const material = new MeshBasicMaterial({ map: texture(96, 96, drawBlot), transparent: true, depthWrite: false, color: 0xffffff });
    const mesh = new InstancedMesh(g, material, list.length);
    const m = new Matrix4();
    list.forEach(([x, y, z, sx, sz], i) => mesh.setMatrixAt(i, m.makeScale(sx, 1, sz).setPosition(x, y, z)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.root.add(mesh);
  }

  /** The fridge, not quite shut: its light is the room. */
  private fridge(): void {
    const k = this.kit;
    const b = this.build;
    const root = this.root;
    const fridge = k.prop('fridge', [FRIDGE_AT[0], FRIDGE_AT[1], FRIDGE_AT[2]], {}, root);
    const door = fridge.getObjectByName('door')!;
    fridge.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(door);
    const hinge = new Object3D();
    hinge.position.copy(fridge.worldToLocal(new Vector3(box.min.x, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2)));
    fridge.add(hinge);
    hinge.updateWorldMatrix(true, false);
    hinge.attach(door);
    door.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = true;
    });
    hinge.rotation.y = FRIDGE_AJAR;
    this.fridgeDoor = hinge;
    this.toDim(fridge);
    fridge.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const enamel = mesh.material as MeshStandardMaterial;
      enamel.metalness = 0;
      enamel.roughness = 0.72;
    });

    // what shows through the gap, far brighter than anything else in the picture
    const card = new Mesh(new PlaneGeometry(0.8, 1.36), new MeshBasicMaterial({ color: new Color(2.6, 3.1, 3.4) }));
    card.position.set(FRIDGE_AT[0], 0.84, box.min.z - this.origin.z - 0.035);
    root.add(card);
    this.fridgeCard = card;
    const doorW = box.max.x - box.min.x;
    const gapX = box.min.x + (doorW * Math.cos(FRIDGE_AJAR) + doorW) / 2 - this.origin.x;
    const gapZ = (box.min.z + box.max.z) / 2 + (doorW * Math.sin(-FRIDGE_AJAR)) / 2 - this.origin.z;
    this.fridgeHalo = b.glow(gapX, 1.05, gapZ, 0.9, BLADE_COLOR, 0.16, root, 2.2);
    const seal = new Mesh(new PlaneGeometry(doorW - 0.02, box.max.y - box.min.y - 0.02), new MeshBasicMaterial({ color: 0x000000, side: DoubleSide }));
    seal.position.set(doorW / 2, 0, 0);
    hinge.add(seal);

    // two flags hold the light to a blade, as they would on a film set; they are never seen
    const flagMaterial = new MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: DoubleSide });
    const axis = new Vector3(BLADE_TO[0] - BLADE_FROM[0], 0, BLADE_TO[2] - BLADE_FROM[2]).normalize();
    const across = new Vector3(axis.z, 0, -axis.x);
    const yaw = Math.atan2(axis.x, axis.z);
    for (const side of [-1, 1]) {
      const flag = new Mesh(new PlaneGeometry(FLAG_WIDE, 4), flagMaterial);
      flag.position.set(BLADE_FROM[0] + axis.x * FLAG_AT + (across.x * side * (FLAG_GAP + FLAG_WIDE)) / 2, 1.4, BLADE_FROM[2] + axis.z * FLAG_AT + (across.z * side * (FLAG_GAP + FLAG_WIDE)) / 2);
      flag.rotation.y = yaw;
      flag.castShadow = true;
      flag.frustumCulled = false;
      root.add(flag);
      this.flags.push(flag);
    }

    // the blade in the air: long and thin, dust makes it
    const toSource = new Vector3(BLADE_FROM[0] - BLADE_TO[0], BLADE_FROM[1] - BLADE_TO[1], BLADE_FROM[2] - BLADE_TO[2]).normalize();
    const beam = b.beam(0, 0, 0, 0.03, 0.18, BEAM_LENGTH, BLADE_COLOR, 0.2, root);
    const xAxis = new Vector3().crossVectors(UP, toSource).normalize();
    const zAxis = new Vector3().crossVectors(xAxis, toSource);
    beam.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(xAxis, toSource, zAxis));
    beam.position.set(BLADE_FROM[0] - toSource.x * (BEAM_LENGTH / 2 + 0.6), BLADE_FROM[1] - toSource.y * (BEAM_LENGTH / 2 + 0.6), BLADE_FROM[2] - toSource.z * (BEAM_LENGTH / 2 + 0.6));
    beam.scale.x *= 0.28;
    this.beam = beam;
  }

  /** The table, the oilcloth, four places and what is left of dinner. */
  private setTable(): void {
    const k = this.kit;
    const root = this.root;
    const T = TABLE_Z;
    const on = (mesh: Mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      root.add(mesh);
      return mesh;
    };

    k.prop('table_kitchen', [0, 0, T], { scale: TABLE_SCALE, rotation: [0, 90, 0], castShadow: true }, root);
    const clothMaterial = new MeshStandardMaterial({ map: texture(512, 512, drawOilcloth, true), roughness: 0.36, side: DoubleSide });
    const cloth = on(new Mesh(drapedCloth(HX + 0.01, HZ + 0.01, CLOTH_DROP, TOP, 0.035, CLOTH_TILE), clothMaterial));
    cloth.position.z = T;
    const stain = new Mesh(new PlaneGeometry(HX * 2, HZ * 2).rotateX(-Math.PI / 2), new MeshStandardMaterial({ map: texture(440, 930, drawStains), transparent: true, depthWrite: false, roughness: 0.55 }));
    stain.position.set(0, TOP + 0.0012, T);
    stain.frustumCulled = false;
    root.add(stain);

    // four chairs. Yours was pushed back by someone getting up
    const chair = (x: number, z: number, yaw: number) => k.prop('chair_worn', [x, 0, z], { scale: 0.8, rotation: [0, yaw, 0], castShadow: true }, root);
    this.headChair = chair(0, HEAD_CHAIR_Z, 0);
    chair(-0.74, T + 0.16, 90);
    chair(0.74, T - 0.18, -90);
    this.nearChair = chair(SEAT_NEAR[0], SEAT_NEAR[2], 205);

    const plates = k.props('plate', PLATES.length, { castShadow: true });
    PLATES.forEach(([x, z], i) => plates.set(i, x, TOP, T + z, i, 1));
    plates.commit();
    root.add(plates.root);
    const china = ((plates.root.children[0] as InstancedMesh).material as MeshStandardMaterial).clone();
    china.color.setHex(0xaea896);
    (plates.root.children[0] as InstancedMesh).material = china;
    const platter = k.prop('plate', [0.02, TOP, T - 0.16], { castShadow: true }, root);
    platter.scale.set(1.5, 1.1, 1.2);
    platter.rotation.y = 0.35;
    k.paint(platter, china);

    const bowls = k.props('bowl', BOWLS.length, { scale: BOWL_SCALE, castShadow: true });
    BOWLS.forEach(([x, z], i) => bowls.set(i, x, TOP, T + z, i * 2, 1));
    bowls.commit();
    root.add(bowls.root);
    const soupSkin = new MeshStandardMaterial({ map: texture(256, 256, drawSoup), roughness: 0.22 });
    const soupShape = new CircleGeometry(SOUP_R, 28).rotateX(-Math.PI / 2);
    BOWLS.forEach(([x, z], i) => {
      const soup = new Mesh(soupShape, soupSkin);
      soup.position.set(x, TOP + SOUP_Y + i * 0.0004, T + z);
      soup.receiveShadow = true;
      root.add(soup);
    });

    GLASSES.forEach(([x, z], i) => k.prop('tea_glass', [x, TOP, T + z], { rotation: [0, i * 57, 0] }, root));

    // knives and forks, as they were put down; the ones whose owners had not finished lie on the plate
    const forks = k.props('fork', 4, { rotation: [90, 0, 0], castShadow: true });
    forks.set(0, 0.165, TOP, T - 0.74, 0, 1);
    forks.set(1, -0.24, TOP + 0.024, T + 0.1, 1.9, 1);
    forks.set(2, 0.32, TOP + 0.024, T - 0.13, -0.8, 1);
    forks.set(3, -0.165, TOP, T + 0.75, Math.PI, 1);
    forks.commit();
    root.add(forks.root);
    const knives = k.props('knife', 5, { rotation: [90, 0, 0], castShadow: true });
    knives.set(0, -0.165, TOP, T - 0.74, 0, 1);
    knives.set(1, -0.29, TOP, T + 0.325, Math.PI / 2, 1);
    knives.set(2, 0.29, TOP, T - 0.345, -Math.PI / 2, 1);
    knives.set(3, 0.17, TOP, T + 0.75, Math.PI, 1);
    knives.set(4, 0.33, TOP + 0.03, T + 0.19, 1.35, 1);
    knives.commit();
    root.add(knives.root);
    const spoons = k.props('spoon', 2, { rotation: [90, 0, 0] });
    spoons.set(0, 0.25, TOP + 0.024, T - 0.12, 2.2, 0.9);
    spoons.set(1, 0.225, TOP, T + 0.82, Math.PI, 0.85);
    spoons.commit();
    root.add(spoons.root);

    // the meat, with a fork stood up in it; bread cut in half; the jug; salt
    const roast = k.prop('roast_lump', [0.02, TOP + 0.016, T - 0.16], { scale: 3.1, rotation: [90, 34, 0], castShadow: true }, root);
    roast.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const cooked = (mesh.material as MeshStandardMaterial).clone();
      cooked.color.setRGB(0.62, 0.42, 0.36);
      mesh.material = cooked;
    });
    k.prop('fork', [0.04, TOP + 0.1, T - 0.17], { scale: 1.45, rotation: [172, 12, 4], castShadow: true }, root);
    k.prop('cutting_board', [0.27, TOP, T + 0.14], { scale: 0.68, rotation: [0, 18, 0], castShadow: true }, root);
    const loaf = k.prop('bread_half', [0.26, TOP + 0.028, T + 0.14], { scale: 1.2, rotation: [0, 62, 0], castShadow: true }, root);
    loaf.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const stale = (mesh.material as MeshStandardMaterial).clone();
      stale.color.setRGB(0.55, 0.46, 0.35);
      mesh.material = stale;
    });
    k.prop('jug', [-0.31, TOP, T - 0.42], { scale: 0.9, rotation: [0, 130, 0], castShadow: true }, root);
    k.prop('salt_shaker', [-0.12, TOP, T + 0.02], { castShadow: true }, root);
    k.prop('roast_lump', [0.3, TOP + 0.018, T - 0.2], { scale: 1.4, rotation: [84, 30, 0], castShadow: true }, root);

    // what is left on the other three plates
    const rice = new MeshStandardMaterial({ map: texture(256, 256, drawRice, true), roughness: 0.7 });
    const stew = new MeshStandardMaterial({ map: texture(256, 256, drawStew, true), roughness: 0.34 });
    const heap = (x: number, z: number, radius: number, height: number, bite: number, seed: number, material: Material) => {
      const m = on(new Mesh(foodHeap(radius, height, bite, seed), material));
      m.position.set(x, TOP + 0.014, T + z);
    };
    heap(0.01, -0.73, 0.075, 0.03, 0.65, 21, rice);
    heap(-0.3, 0.17, 0.08, 0.026, 0.55, 22, stew);
    heap(0.28, -0.17, 0.05, 0.015, 0.2, 23, rice);

    // crumbs, grains of rice dropped round the bread
    const crumbs = new InstancedMesh(new SphereGeometry(1, 5, 3), new MeshStandardMaterial({ color: 0xb49a70, roughness: 0.9 }), 150);
    const random = randomFrom(71);
    const crumbM = new Matrix4();
    for (let i = 0; i < 150; i++) {
      const around = i < 90;
      const x = (around ? 0.03 : 0) + (random() - 0.5) * (around ? 0.6 : 0.76);
      const z = T + (around ? 0.33 : 0.72) + (random() - 0.5) * (around ? 0.44 : 0.4);
      const s = 0.0016 + random() * 0.004;
      crumbs.setMatrixAt(i, crumbM.makeScale(s, s * 0.7, s * (0.7 + random())).setPosition(x, TOP + 0.002, z));
    }
    crumbs.instanceMatrix.needsUpdate = true;
    crumbs.frustumCulled = false;
    root.add(crumbs);

    // under each thing on the table a darker cloth
    const under: (readonly [number, number, number, number, number])[] = [];
    for (const [x, z] of PLATES) under.push([x, TOP + 0.0016, T + z, 0.31, 0.31]);
    for (const [x, z] of BOWLS) under.push([x, TOP + 0.0016, T + z, 0.2, 0.2]);
    for (const [x, z] of GLASSES) under.push([x, TOP + 0.0016, T + z, 0.12, 0.12]);
    under.push([0.02, TOP + 0.0016, T - 0.16, 0.44, 0.34], [0.27, TOP + 0.0016, T + 0.14, 0.37, 0.24], [-0.31, TOP + 0.0016, T - 0.42, 0.26, 0.22]);
    this.blots(under);
  }

  /** The places a roach must walk up onto: plates, the platter, the board (x, z, radius, height). */
  private tableDiscs(): Float32Array {
    const d: number[] = [];
    for (const [x, z] of PLATES) d.push(x, TABLE_Z + z, 0.114, 0.018);
    d.push(0.02, TABLE_Z - 0.16, 0.15, 0.02, 0.27, TABLE_Z + 0.14, 0.12, 0.028);
    return new Float32Array(d);
  }

  private ground(x: number, z: number): number {
    let y = TOP + 0.002;
    const d = this.discs;
    for (let i = 0; i < d.length; i += 4) {
      const dx = x - d[i];
      const dz = z - d[i + 1];
      const r = d[i + 2];
      const q = dx * dx + dz * dz;
      if (q < r * r) {
        const top = TOP + d[i + 3] * Math.min(1, (r - Math.sqrt(q)) / 0.022);
        if (top > y) y = top;
      }
    }
    return y;
  }

  /** Whether a point of the table lies in the fridge's blade of light. */
  private inBlade(x: number, z: number): boolean {
    const axisX = BLADE_TO[0] - BLADE_FROM[0];
    const axisZ = BLADE_TO[2] - BLADE_FROM[2];
    const n = Math.hypot(axisX, axisZ);
    const dx = x - BLADE_FROM[0];
    const dz = z - BLADE_FROM[2];
    const along = (dx * axisX + dz * axisZ) / n;
    const off = Math.abs(dx * axisZ - dz * axisX) / n;
    return along > 0 && off < ((FLAG_GAP / 2) * along) / FLAG_AT;
  }

  /** Those on the table, and the flat ones everywhere else. */
  private roaches(): { crowd: PropCrowd; field: InstancedMesh } {
    const random = randomFrom(404);
    for (let i = 0; i < TABLE_ROACHES; i++) {
      let x = 0;
      let z = 0;
      for (let tries = 0; tries < 40; tries++) {
        x = (random() - 0.5) * 2 * (HX - 0.02);
        z = TABLE_Z + (random() - 0.5) * 2 * (HZ - 0.02);
        const seenInDark = this.inBlade(x, z);
        if (i < IN_THE_BLADE ? seenInDark : i >= BEFORE_ROACHES || !seenInDark) break;
      }
      this.homeX[i] = x;
      this.homeZ[i] = z;
      this.delay[i] = FLEE_START + random() * 0.32;
      this.speed[i] = 0.7 + random() * 1.5;
      this.size[i] = 0.92 + random() * 0.5;
    }
    const crowd = this.kit.props('roach_low', TABLE_ROACHES + STREAM_ROACHES + BODY_ROACHES);
    const body = crowd.root.children[0] as InstancedMesh;
    const shell = (body.material as MeshStandardMaterial).clone();
    shell.roughness = 0.24;
    shell.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uTremble = this.tremble;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTremble;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float legReach = abs(position.x) + abs(position.z);
        transformed.y += sin(uTremble * 19.0 + instanceMatrix[3].x * 31.0 + position.x * 40.0) * 0.14 * legReach;`,
      );
    };
    shell.customProgramCacheKey = () => 'kitchen-roach';
    body.material = shell;
    body.castShadow = false;
    this.root.add(crowd.root);

    // the far ones are only pictures of roaches, lying on the walls, walking in the vertex shader
    const patches: readonly { corner: V3; u: V3; v: V3; share: number; later?: boolean; reach?: number; door?: boolean }[] = [
      { corner: [-W / 2, 0.03, 0], u: [0, 0, -D], v: [0, H - 0.04, 0], share: 1 },
      { corner: [W / 2, 0.03, -D], u: [0, 0, D], v: [0, H - 0.04, 0], share: 1 },
      { corner: [-W / 2, 0.03, -D], u: [W, 0, 0], v: [0, H - 0.04, 0], share: 1.7 },
      { corner: [W / 2, 0.03, 0], u: [-W, 0, 0], v: [0, H - 0.04, 0], share: 0.45, door: true },
      { corner: [-W / 2, H - 0.002, -D], u: [W, 0, 0], v: [0, 0, D], share: 1.1 },
      { corner: [-W / 2, 0.002, -D], u: [0, 0, D], v: [W, 0, 0], share: 0.4 },
      // once it has shut, and the rest of the furniture
      { corner: [FRIDGE_AT[0] - 0.46, 0.06, FRIDGE_FRONT + 0.012], u: [0.92, 0, 0], v: [0, 1.5, 0], share: 1.5, later: true },
      { corner: [W / 2 - 0.65, 0.09, -3.94], u: [0, 0, 1.18], v: [0, 1.08, 0], share: 1.5, later: true },
      { corner: [-0.58, TUBE_Y - 0.142, TUBE_Z - 0.04], u: [1.16, 0, 0], v: [0, 0, 0.08], share: 4, later: true, reach: 0.08 },
    ];
    const areaOf = (p: (typeof patches)[number]) => Math.hypot(...p.u) * Math.hypot(...p.v) * p.share;
    const total = patches.reduce((sum, p) => sum + areaOf(p), 0);
    const quad = new BufferGeometry();
    quad.setAttribute('position', new Float32BufferAttribute([-0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, -0.5], 3));
    quad.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    quad.setAttribute('uv', new Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    const fieldData = new Float32Array(FIELD * 4);
    const material = new MeshStandardMaterial({ map: texture(128, 128, drawRoach), alphaTest: 0.34, roughness: 0.55, color: 0xb7a79c });
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uField = this.fieldState;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec4 aField;
          uniform vec3 uField;
          float fieldHash(float n) { return fract(sin(n) * 43758.5453); }`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            float seed = aField.x;
            float beat = (uField.x + seed * 91.0) / (1.1 + seed * 2.6);
            float step0 = floor(beat);
            float into = beat - step0;
            float key = seed * 57.0 + step0 * 1.7;
            vec2 a = vec2(fieldHash(key), fieldHash(key + 0.31)) - 0.5;
            vec2 b = vec2(fieldHash(key + 1.7), fieldHash(key + 2.01)) - 0.5;
            vec2 at = mix(a, b, smoothstep(0.0, 0.24, into)) * aField.w;
            float heading = atan(b.x - a.x, b.y - a.y);
            float run = clamp((uField.z - seed * 0.22) / 0.78, 0.0, 1.0);
            float size = step(aField.z, uField.y) * (1.0 - smoothstep(0.82, 1.0, run));
            if (run > 0.0) {
              heading = aField.y;
              at += vec2(sin(heading), cos(heading)) * run * run * 14.0;
            }
            float cosH = cos(heading);
            float sinH = sin(heading);
            transformed.x = at.x + size * (position.x * cosH + position.z * sinH);
            transformed.z = at.y + size * (-position.x * sinH + position.z * cosH);
          }`,
        );
    };
    material.customProgramCacheKey = () => 'kitchen-field';
    const field = new InstancedMesh(quad, material, FIELD);
    field.frustumCulled = false;
    const m = new Matrix4();
    const u = new Vector3();
    const v = new Vector3();
    const n = new Vector3();
    const zAxis = new Vector3();
    const p = new Vector3();
    const away = new Vector3();
    const scale = new Vector3();
    let i = 0;
    patches.forEach((patch, index) => {
      const count = index === patches.length - 1 ? FIELD - i : Math.round((FIELD * areaOf(patch)) / total);
      u.set(patch.u[0], patch.u[1], patch.u[2]);
      v.set(patch.v[0], patch.v[1], patch.v[2]);
      n.crossVectors(u, v).normalize();
      const uHat = u.clone().normalize();
      zAxis.crossVectors(uHat, n);
      for (let c = 0; c < count && i < FIELD; c++, i++) {
        let a = random();
        let b = random();
        for (let tries = 0; tries < 7; tries++) {
          p.set(patch.corner[0], patch.corner[1], patch.corner[2]).addScaledVector(u, a).addScaledVector(v, b);
          const n1 = Math.sin(p.x * 2.7 + p.z * 1.3 + 0.7) * Math.sin(p.y * 3.1 + p.z * 2.1 + 1.9) + 0.6 * Math.sin(p.x * 6.1 - p.y * 5.3 + p.z * 4.7);
          if (random() < 0.08 + smootherstep(range(-0.5, 0.75, n1))) break;
          a = random();
          b = random();
        }
        while (patch.door && Math.abs(a - 0.5) * W < DOOR_W / 2 && b * H < DOOR_H) {
          a = random();
          b = random();
        }
        p.set(patch.corner[0], patch.corner[1], patch.corner[2]).addScaledVector(u, a).addScaledVector(v, b).addScaledVector(n, 0.0015 + random() * 0.004);
        scale.setScalar(FIELD_SIZE[0] + (FIELD_SIZE[1] - FIELD_SIZE[0]) * random());
        m.makeBasis(uHat, n, zAxis).scale(scale).setPosition(p);
        field.setMatrixAt(i, m);
        away.set(p.x, p.y, p.z).sub(v1.set(0, TUBE_Y, TUBE_Z));
        fieldData[i * 4] = random();
        fieldData[i * 4 + 1] = Math.atan2(away.dot(uHat), away.dot(zAxis)) + (random() - 0.5) * 0.7;
        fieldData[i * 4 + 2] = patch.later ? 0.55 + random() * 0.45 : random();
        fieldData[i * 4 + 3] = patch.reach ?? 2.6;
      }
    });
    field.instanceMatrix.needsUpdate = true;
    quad.setAttribute('aField', new InstancedBufferAttribute(fieldData, 4));
    this.root.add(field);
    return { crowd, field };
  }

  /** The way out of the face: over the chin, down the chest, onto the table, along it toward you. */
  private pourPath(sack: Crowd): void {
    const f = this.face;
    const chestHigh = SACK_Z + chestOf(sack, 1.0) * SACK_SCALE + 0.016;
    const chestLow = SACK_Z + chestOf(sack, 0.86) * SACK_SCALE + 0.018;
    const points = [
      new Vector3(f.x, f.y, f.z - 0.03),
      new Vector3(f.x, f.y - 0.075, f.z + 0.04),
      new Vector3(f.x * 0.6, 1.3, chestHigh),
      new Vector3(f.x * 0.3, 1.12, chestLow),
      new Vector3(0, 0.97, FAR_EDGE - 0.16),
      new Vector3(0, TOP + 0.012, FAR_EDGE + 0.04),
      new Vector3(0.01, TOP + 0.003, FAR_EDGE + 0.5),
      new Vector3(-0.02, TOP + 0.003, TABLE_Z + 0.2),
      new Vector3(0, TOP + 0.003, NEAR_EDGE - 0.06),
    ];
    const curve = new CatmullRomCurve3(points, false, 'centripetal');
    const samples = curve.getSpacedPoints(STREAM_SAMPLES - 1);
    const data = this.path;
    const tangent = new Vector3();
    const up = new Vector3();
    const side = new Vector3();
    samples.forEach((point, i) => {
      const next = samples[Math.min(i + 1, samples.length - 1)];
      const previous = samples[Math.max(i - 1, 0)];
      tangent.subVectors(next, previous).normalize();
      const onTable = smootherstep(range(FAR_EDGE - 0.09, FAR_EDGE + 0.05, point.z));
      up.set(0, onTable, 1 - onTable).normalize();
      side.crossVectors(up, tangent).normalize();
      up.crossVectors(tangent, side).normalize();
      data.set([point.x, point.y, point.z, tangent.x, tangent.y, tangent.z, up.x, up.y, up.z, side.x, side.y, side.z], i * 12);
    });
  }

  /** Where they sit: points of the skin of the body, facing you and above the table; the hole of the face stays open. */
  private seatOnBody(sack: Crowd): void {
    const hole = v1.copy(this.face).sub(v2.set(0, 0, SACK_Z)).divideScalar(SACK_SCALE).clone();
    const head: number[] = [];
    const crown: number[] = [];
    const body: number[] = [];
    const cells = new Set<number>();
    for (const child of sack.root.children) {
      const g = (child as InstancedMesh).geometry;
      const p = g.getAttribute('position');
      const n = g.getAttribute('normal');
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) < BODY_FROM || n.getZ(i) < -0.2) continue;
        if (v1.set(p.getX(i), p.getY(i), p.getZ(i)).distanceTo(hole) < FACE_OPEN) continue;
        const onHead = p.getY(i) > hole.y - HEAD_BELOW_FACE;
        const cell = (Math.round(p.getX(i) / SEAT_CELL) + 512) * 1048576 + (Math.round(p.getY(i) / SEAT_CELL) + 512) * 1024 + Math.round(p.getZ(i) / SEAT_CELL) + 512;
        if (cells.has(cell)) continue;
        cells.add(cell);
        (onHead ? head : body).push(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i));
        if (p.getY(i) > hole.y + CROWN_FROM && n.getZ(i) > CROWN_FACING) crown.push(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i));
      }
    }
    for (let i = 0; i < BODY_ROACHES; i++) {
      const slot = i % 20;
      const skin = slot < ON_THE_HEAD ? head : slot < ON_THE_HEAD + ON_THE_CROWN && crown.length > 0 ? crown : body;
      const a = Math.floor(((R[i & 1023] * 89.37 + R[(i * 53) & 1023] * 7.11) % 1) * (skin.length / 6)) * 6;
      this.seats.set([skin[a] * SACK_SCALE, skin[a + 1] * SACK_SCALE, skin[a + 2] * SACK_SCALE + SACK_Z, skin[a + 3], skin[a + 4], skin[a + 5]], i * 6);
    }
  }

  /** A plate of rice that has been lying a long time; and the soup. */
  private rice(): { grains: InstancedMesh; roach: Object3D } {
    const k = this.kit;
    const root = this.root;
    const [mx, my, mz] = MOUND_AT;
    const under = new Mesh(new SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(MOUND_R * 0.98, MOUND_H * 0.92, MOUND_R * 0.98), new MeshStandardMaterial({ color: 0x8f8466, roughness: 0.8 }));
    under.position.set(mx, my, mz);
    under.receiveShadow = true;
    root.add(under);
    const shape = grainShape();
    const seeds = new Float32Array(GRAINS * 3);
    const material = new MeshStandardMaterial({ color: 0xe6dfca, roughness: 0.46 });
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uMaggotTime = this.maggotTime;
      shader.uniforms.uMaggotLife = this.maggotLife;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec3 aGrain;
          uniform float uMaggotTime;
          uniform float uMaggotLife;
          varying float vGrainZ;
          varying float vGrainLife;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float grainLife = smoothstep(aGrain.z, aGrain.z + 0.22, uMaggotLife);
          float grainWave = sin(position.z * 3.6 - uMaggotTime * aGrain.y + aGrain.x);
          float grainNod = cos(position.z * 2.1 - uMaggotTime * aGrain.y * 0.62 + aGrain.x * 2.0);
          transformed.x += grainLife * grainWave * 1.25 * (0.25 + position.z * position.z);
          transformed.y += grainLife * grainNod * 0.85 * (0.2 + position.z * position.z);
          transformed.xy *= 1.0 + grainLife * 0.4;
          transformed.z *= 1.0 + grainLife * (0.12 + 0.2 * sin(uMaggotTime * aGrain.y * 0.8 + aGrain.x));
          transformed.z += grainLife * 0.9 * sin(uMaggotTime * aGrain.y * 0.21 + aGrain.x * 3.0);
          vGrainZ = position.z;
          vGrainLife = grainLife;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGrainZ;\nvarying float vGrainLife;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          diffuseColor.rgb *= mix(1.0, 0.82 + 0.18 * sin(vGrainZ * 22.0), vGrainLife);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.14, 0.08, 0.04), smoothstep(0.76, 0.95, vGrainZ) * vGrainLife);`,
        );
    };
    material.customProgramCacheKey = () => 'kitchen-grain';
    const grains = new InstancedMesh(shape, material, GRAINS);
    grains.frustumCulled = false;
    grains.receiveShadow = true;
    const random = randomFrom(222);
    const m = new Matrix4();
    const p = new Vector3();
    const q = new Quaternion();
    const scale = new Vector3();
    const e = new Vector3();
    for (let i = 0; i < GRAINS; i++) {
      const gone = i >= GRAINS - SPILLED;
      const r = gone ? MOUND_R * (1 + random() * 0.72) : Math.sqrt(random()) * MOUND_R;
      const a = random() * Math.PI * 2;
      const height = gone ? (r > 0.113 ? -0.012 : 0.002) : MOUND_H * Math.pow(Math.max(0, 1 - (r * r) / (MOUND_R * MOUND_R)), 0.62) * (0.86 + random() * 0.16);
      p.set(mx + Math.cos(a) * r, my + height + 0.001, mz + Math.sin(a) * r);
      e.set((random() - 0.5) * 1.1, random() * Math.PI * 2, (random() - 0.5) * 1.1);
      q.setFromAxisAngle(UP, e.y).multiply(q1.setFromAxisAngle(v1.set(1, 0, 0), e.x));
      const grow = 0.86 + random() * 0.4;
      m.compose(p, q, scale.set(GRAIN_R * grow, GRAIN_R * grow, GRAIN_L * grow));
      grains.setMatrixAt(i, m);
      seeds[i * 3] = random() * 6.28;
      seeds[i * 3 + 1] = (2.4 + random() * 3.6) * (REDUCED_MOTION ? 0.5 : 1);
      seeds[i * 3 + 2] = i >= GRAINS - SPILLED ? 0 : Math.pow(random(), 0.7);
    }
    shape.setAttribute('aGrain', new InstancedBufferAttribute(seeds, 3));
    grains.instanceMatrix.needsUpdate = true;
    root.add(grains);

    const roach = k.prop('roach', [0, 0, 0], { scale: 1.15 }, root);
    roach.rotation.order = 'YXZ';
    roach.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const wet = (mesh.material as MeshStandardMaterial).clone();
      wet.roughness = 0.18;
      mesh.material = wet;
    });
    roach.visible = false;
    return { grains, roach };
  }

  /** They land on the glass; we see their bellies and feet. */
  private flies(): PropCrowd {
    const crowd = this.kit.props('fly', FLIES.length);
    // one material for all of it: from below a fly is a dark glossy shape, and the legs are what moves
    const skin = new MeshStandardMaterial({ color: 0x17120e, roughness: 0.34 });
    skin.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uFlyTime = this.flyTime;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uFlyTime;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
        float flyFront = smoothstep(0.0012, 0.0032, position.z) * (1.0 - smoothstep(0.0022, 0.004, position.y));
        float flyRub = smoothstep(0.15, 0.65, sin(uFlyTime * 0.85 + instanceMatrix[3].x * 700.0));
        float flyBeat = sin(uFlyTime * 15.0 + instanceMatrix[3].y * 900.0);
        transformed.x *= 1.0 - flyFront * flyRub * (0.5 + 0.35 * flyBeat);
        transformed.z += flyFront * flyRub * flyBeat * 0.0005;
        #endif`,
      );
    };
    skin.customProgramCacheKey = () => 'kitchen-fly';
    crowd.root.traverse((o) => {
      const mesh = o as InstancedMesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      mesh.material = skin;
    });
    crowd.drawn = 0;
    this.lens.add(crowd.root);
    return crowd;
  }

  /** Its own material on everything of a baked body, for the shadow it should throw. */
  private castFrom(root: Object3D): void {
    root.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = true;
    });
  }

  /** Every sound that does not depend on when the light was asked for. */
  private score(): void {
    const s = this.sound;
    this.beat(0, () => {
      this.fridgeBed = s.bed('rooms/fridge_hum.mp3', { gain: 0.12, pan: -0.32, fade: 0.8 });
      this.droneBed = s.bed('rooms/dream_drone_low.mp3', { gain: 0.09, fade: 2 });
      this.insectsBed = s.bed('rooms/insects_contact.mp3', { gain: 0.05, pan: 0.1, fade: 2.4, lowpass: 5600 });
    });
    this.beat(LINE_AT, () => this.say({ tr: 'Yemek soğudu.', en: 'Dinner has gone cold.' }, 3.4));
    this.beat(3.4, () => s.play('rooms/roach_hiss_2.mp3', { gain: 0.09, pan: 0.15, reverb: 0.1 }));
    TICKS.forEach((at, i) =>
      this.beat(at, () => {
        if (this.litAt !== Infinity) return;
        this.tickAt = at;
        s.play(`rooms/fluorescent_tick_${(i % 6) + 1}.mp3`, { gain: 0.2 - (i % 3) * 0.03, reverb: 0.12 });
      }),
    );
    this.beat(PROMPT_AT, () => {
      if (this.litAt !== Infinity) return;
      this.hint({ tr: 'Bas: ışığı aç', en: 'Press: the light' });
      this.control.press = true;
    });

    this.beat(19.4, () => s.play('rooms/fork_plate_3.mp3', { gain: 0.16, reverb: 0.2, lowpass: 3000, pan: -0.05 }));
    this.beat(WALK_FROM + 1.1, () => s.play('rooms/floor_creak_1.mp3', { gain: 0.16, reverb: 0.15 }));
    this.beat(WALK_FROM + 2.4, () => s.play('rooms/floor_creak_3.mp3', { gain: 0.14, reverb: 0.15 }));
    this.beat(WALK_FROM + 4, () => s.play('rooms/floor_creak_2.mp3', { gain: 0.14, reverb: 0.15 }));
    this.beat(MAN_AT + 0.5, () => s.play('rooms/door_creak_short.mp3', { gain: 0.12, lowpass: 1300, reverb: 0.35 }));
    this.beat(MAGGOTS_WAKE, () => {
      this.riceBed = s.bed('rooms/rice_moving.mp3', { gain: 0.3, fade: 6 });
    });
    this.beat(33.1, () => s.play('rooms/wet_click_1.mp3', { gain: 0.3, pan: -0.15 }));
    this.beat(33.8, () => s.play('rooms/wet_click_2.mp3', { gain: 0.26, pan: -0.1 }));
    this.beat(SOUP_ROACH[0] + 0.5, () => s.play('rooms/wet_plip_1.mp3', { gain: 0.3, pan: -0.3 }));

    this.beat(LIGHT_FALTERS, () => {
      this.dying = s.play('rooms/light_die.mp3', { gain: 0.2 });
    });
    this.beat(FRIDGE_DIES, () => {
      s.play('rooms/fridge_stop.mp3', { gain: 0.3, pan: -0.32 });
      this.fridgeBed?.gain(0, 0.2);
      this.droneBed?.gain(0, 0.6);
      this.humBed?.gain(0, 0.25);
      this.riceBed?.gain(0, 1.4);
      this.swell = s.play('rooms/swarm_swell.mp3', { gain: 0.5 });
    });
    this.beat(LIGHT_BACK, () => {
      this.swell?.stop(0.03);
      this.dying?.stop(0.03);
      s.play('rooms/breaker_clunk_1.mp3', { gain: 0.5, reverb: 0.2 });
      this.endBeds.push(
        s.bed('rooms/fluorescent_hum_bad.mp3', { gain: 0.09 }),
        s.bed('rooms/bugs_writhe.mp3', { gain: 0.13 }),
        s.bed('rooms/insects_contact_wide.mp3', { gain: 0.14, fade: 0.8 }),
        s.bed('rooms/roach_box.mp3', { gain: 0.13, fade: 1.5 }),
        s.bed('rooms/fridge_wrong.mp3', { gain: 0.07, fade: 4, pan: -0.32 }),
        s.bed('rooms/flies_room.mp3', { gain: 0.12, fade: 5 }),
      );
    });
    this.beat(LIGHT_BACK + 0.7, () => s.play('rooms/roach_hiss_1.mp3', { gain: 0.25, reverb: 0.05 }));
    this.beat(LIGHT_BACK + 2.6, () => s.play('rooms/roach_hiss_3.mp3', { gain: 0.25, reverb: 0.05, pan: 0.3 }));
    this.beat(FLIES_AT, () => {
      this.endBeds.push(s.bed('rooms/flies_passing.mp3', { gain: 0.18, fade: 0.6 }));
      s.play('rooms/fly_land_1.mp3', { gain: 0.4, pan: 0.4 });
    });
    this.beat(FLIES_AT + 0.7, () => s.play('rooms/fly_land_2.mp3', { gain: 0.34, pan: -0.5 }));
    this.beat(FLIES_AT + 1.7, () => s.play('rooms/fly_land_3.mp3', { gain: 0.34, pan: 0.5 }));
    // everything takes one step back so that it can be said
    this.beat(LAST_LINE - 0.65, () => {
      for (let i = 0; i < this.endBeds.length - 1; i++) this.endBeds[i].gain(0.012, 0.35);
    });
    this.beat(LAST_LINE - 0.3, () => s.play('rooms/mouth_wet_2.mp3', { gain: 0.3 }));
    this.beat(LAST_LINE, () => this.say({ tr: 'Ye.', en: 'Eat.' }, 2.8));
    this.beat(LAST_LINE + 2.3, () => s.play('rooms/fork_down_1.mp3', { gain: 0.45, reverb: 0.2 }));
    this.beat(CUT_AT, () => s.stopAll(0.03));
  }

  /** The switch, or the moment it gives up waiting for you and comes on anyway. */
  private lightUp(at: number, pressed: boolean): void {
    this.litAt = at;
    this.fellOnItsOwn = !pressed;
    this.control.press = false;
    this.hint(null);
    if (pressed) this.sound.play('rooms/switch_small.mp3', { gain: 0.3, reverb: 0.1 });
  }

  private stutterSounds(d: number): void {
    const s = this.sound;
    if (this.soundStep === 0 && d >= 0) {
      this.soundStep = 1;
      s.play('rooms/fluorescent_stutter_1.mp3', { gain: this.fellOnItsOwn ? 0.28 : 0.24 });
    }
    if (this.soundStep === 1 && d >= STUTTER[2]) {
      this.soundStep = 2;
      s.play('rooms/fluorescent_stutter_2.mp3', { gain: 0.24 });
      s.play('rooms/roach_scatter.mp3', { gain: 0.6 });
    }
    if (this.soundStep === 2 && d >= STUTTER[4] - 0.14) {
      this.soundStep = 3;
      s.play('rooms/fluorescent_start_1.mp3', { gain: 0.24 });
      this.humBed = s.bed('rooms/fluorescent_hum_close.mp3', { gain: 0.1, fade: 0.25 });
    }
    if (this.soundStep === 3 && d >= FLEE_DONE - 0.7) {
      this.soundStep = 4;
      this.insectsBed?.gain(0, 0.8);
    }
  }

  private tubeLevel(s: number, d: number): number {
    if (s >= CUT_AT) return 0;
    if (s >= LIGHT_BACK) return 1;
    if (s >= LIGHT_GONE || d < 0) return 0;
    if (d < STUTTER[1]) return 0.5 * CALM;
    if (d < STUTTER[2]) return 0;
    if (d < STUTTER[3]) return 0.86 * CALM;
    if (d < STUTTER[4]) return 0;
    if (s >= LIGHT_FALTERS + 0.42) return 0.82;
    if (s >= LIGHT_FALTERS) return 0.4;
    return 1;
  }

  /** Where roach `i` has got to by its small darts at time `s` (a pure function of time): writes wx, wz, wh. */
  private walk(i: number, s: number, reach: number): void {
    const period = 1 + R[(i * 3) & 1023] * 2.6;
    const beat = (s + R[(i * 5) & 1023] * 60) / period;
    const k = Math.floor(beat);
    const f = beat - k;
    const a = (i * 7 + k * 13) & 1023;
    const b = (i * 7 + (k + 1) * 13) & 1023;
    const go = dart(f / 0.28);
    const ax = R[a] - 0.5;
    const az = R[(a + 137) & 1023] - 0.5;
    const bx = R[b] - 0.5;
    const bz = R[(b + 137) & 1023] - 0.5;
    this.wx = (ax + (bx - ax) * go) * reach;
    this.wz = (az + (bz - az) * go) * reach;
    this.wh = Math.atan2(bx - ax, bz - az);
  }

  private writeRoach(j: number, x: number, y: number, z: number, heading: number, size: number): void {
    v1.set(x, y, z);
    q1.setFromAxisAngle(UP, heading);
    m1.compose(v1, q1, v2.setScalar(size));
    this.crowd.setMatrix(j, m1);
  }

  /** What is on the table: before the light they mind their own business, then they run, later they are simply there. */
  private writeRoaches(s: number, d: number): void {
    const back = s >= LIGHT_BACK && s < CUT_AT;
    const hiding = !back && d > FLEE_DONE;
    const drawn = hiding ? 0 : back ? TABLE_ROACHES + STREAM_ROACHES + BODY_ROACHES : BEFORE_ROACHES;
    if (drawn !== this.crowdDrawn) {
      this.crowdDrawn = drawn;
      this.crowd.drawn = drawn;
    }
    if (drawn === 0) return;
    this.tremble.value = s;

    if (!back) {
      for (let i = 0; i < BEFORE_ROACHES; i++) {
        const reach = i < IN_THE_BLADE ? 0.09 : 0.05;
        if (d < this.delay[i]) {
          this.walk(i, s, reach);
          const x = this.homeX[i] + this.wx;
          const z = this.homeZ[i] + this.wz;
          this.writeRoach(i, x, this.ground(x, z), z, this.wh, this.size[i]);
          continue;
        }
        const t = d - this.delay[i];
        this.walk(i, this.litAt + this.delay[i], reach);
        const x0 = this.homeX[i] + this.wx;
        const z0 = this.homeZ[i] + this.wz;
        let ax = x0 + (R[(i * 11) & 1023] - 0.5) * 0.5;
        let az = z0 + (R[(i * 17) & 1023] - 0.5) * 0.5 - TUBE_Z;
        const n = Math.hypot(ax, az) || 1;
        ax /= n;
        az /= n;
        const travel = this.speed[i] * t * (0.5 + 0.5 * Math.min(1, t / 0.4));
        const x = x0 + ax * travel;
        const z = z0 + az * travel;
        const over = Math.max(Math.abs(x) - HX, Math.abs(z - TABLE_Z) - HZ, 0);
        if (over > 0.24) {
          this.crowd.setMatrix(i, ZERO);
          continue;
        }
        const cx = clamp(x, -HX, HX);
        const cz = clamp(z, TABLE_Z - HZ, TABLE_Z + HZ);
        this.writeRoach(i, cx + Math.sign(x - cx) * 0.01, this.ground(cx, cz) - over * 1.05, cz + Math.sign(z - cz) * 0.01, Math.atan2(ax, az), this.size[i] * (1 - smootherstep(over / 0.24) * 0.6));
      }
      this.crowd.commit();
      return;
    }

    const reachOfThem = smootherstep(range(LIGHT_BACK, STREAM_ARRIVES, s));
    const front = lerp(FAR_EDGE + 1.05, NEAR_EDGE + 0.05, reachOfThem);
    for (let i = 0; i < TABLE_ROACHES; i++) {
      const hz = this.homeZ[i];
      if (hz > front + R[(i * 19) & 1023] * 0.3) {
        this.crowd.setMatrix(i, ZERO);
        continue;
      }
      this.walk(i, s * 0.8, 0.11);
      const x = clamp(this.homeX[i] + this.wx, -HX + 0.01, HX - 0.01);
      const z = clamp(hz + this.wz, TABLE_Z - HZ + 0.01, TABLE_Z + HZ - 0.01);
      this.writeRoach(i, x, this.ground(x, z) + R[(i * 23) & 1023] * 0.008, z, this.wh, this.size[i]);
    }

    // down the chest and along the table: the head of the stream is what is coming for your plate
    const data = this.path;
    const reachU = lerp(0.56, 1, reachOfThem);
    for (let i = 0; i < STREAM_ROACHES; i++) {
      const u = (s * (0.1 + R[(i * 3) & 1023] * 0.1) + R[i & 1023]) % 1;
      const j = TABLE_ROACHES + i;
      if (u > reachU - R[(i * 7) & 1023] * 0.06 || R[(i * 43) & 1023] < STREAM_THIN * (1 - smootherstep(range(STREAM_SCATTER[0], STREAM_SCATTER[1], u)))) {
        this.crowd.setMatrix(j, ZERO);
        continue;
      }
      const a = Math.min(Math.floor(u * (STREAM_SAMPLES - 1)), STREAM_SAMPLES - 2);
      const f = u * (STREAM_SAMPLES - 1) - a;
      const p = a * 12;
      const wide = lerp(0.1, 0.56, smootherstep(u / 0.2));
      const lateral = (R[(i * 29) & 1023] - 0.5) * wide;
      const px = data[p] + (data[p + 12] - data[p]) * f + data[p + 9] * lateral;
      const pz = data[p + 2] + (data[p + 14] - data[p + 2]) * f + data[p + 11] * lateral;
      const onTable = data[p + 7] > 0.7;
      const py = onTable ? this.ground(px, pz) + R[(i * 31) & 1023] * 0.009 : data[p + 1] + (data[p + 13] - data[p + 1]) * f + data[p + 10] * lateral;
      const out = onTable ? 0 : R[(i * 31) & 1023] * 0.012 + 0.003;
      v3.set(data[p + 3], data[p + 4], data[p + 5]);
      v4.set(data[p + 6], data[p + 7], data[p + 8]);
      v2.set(data[p + 9], data[p + 10], data[p + 11]);
      const grow = Math.min(1, u / 0.03) * (0.95 + R[(i * 37) & 1023] * 0.45);
      m1.makeBasis(v2, v4, v3).scale(v1.setScalar(grow)).setPosition(px + data[p + 6] * out, py + data[p + 7] * out, pz + data[p + 8] * out);
      this.crowd.setMatrix(j, m1);
    }

    // and the rest of them stay where they are: it is only a shape they keep
    const seats = this.seats;
    const restless = REDUCED_MOTION ? 0.25 : 1;
    for (let i = 0; i < BODY_ROACHES; i++) {
      const q = i * 6;
      const level = Math.abs(seats[q + 4]) > 0.9;
      v2.set(level ? 1 : 0, level ? 0 : 1, 0).cross(v4.set(seats[q + 3], seats[q + 4], seats[q + 5])).normalize();
      v3.crossVectors(v2, v4);
      const sway = restless * Math.sin(s * (0.35 + R[(i * 13) & 1023] * 0.6) + R[(i * 17) & 1023] * 6.283);
      const heading = R[(i * 11) & 1023] * 6.283 + sway * 1.1;
      const c = Math.cos(heading);
      const n = Math.sin(heading);
      v1.copy(v2).multiplyScalar(c).addScaledVector(v3, n);
      v3.multiplyScalar(c).addScaledVector(v2, -n);
      const step = sway * 0.03;
      const x = seats[q] + v3.x * step + v4.x * 0.012;
      const y = seats[q + 1] + v3.y * step + v4.y * 0.012;
      const z = seats[q + 2] + v3.z * step + v4.z * 0.012;
      const size = 0.95 + R[(i * 37) & 1023] * 0.5;
      m1.makeBasis(v1.multiplyScalar(size), v4.multiplyScalar(size), v3.multiplyScalar(size)).setPosition(x, y, z);
      this.crowd.setMatrix(TABLE_ROACHES + STREAM_ROACHES + i, m1);
    }
    this.crowd.commit();
  }

  /** One crawls out of the soup: under, on it, up the side of the bowl, stops on the rim and looks at you. */
  private writeSoupRoach(s: number): void {
    const q = range(SOUP_ROACH[0], SOUP_ROACH[1], s);
    if (q <= 0 || q >= 1) {
      this.soupRoach.visible = false;
      return;
    }
    this.soupRoach.visible = true;
    const bx = MY_BOWL[0];
    const bz = TABLE_Z + MY_BOWL[1];
    const dirX = 0.62;
    const dirZ = 0.78;
    const level = TOP + SOUP_Y;
    let r: number;
    let y: number;
    let tilt: number;
    if (q < 0.12) {
      r = 0.012;
      y = level - 0.022 + 0.024 * (q / 0.12);
      tilt = 0.5 - 0.5 * (q / 0.12);
    } else if (q < 0.5) {
      const f = (q - 0.12) / 0.38;
      r = 0.012 + (SOUP_R - 0.008 - 0.012) * smootherstep(f);
      y = level + 0.002;
      tilt = 0;
    } else if (q < 0.72) {
      const f = smootherstep((q - 0.5) / 0.22);
      r = SOUP_R - 0.008 + 0.012 * f;
      y = level + 0.002 + (0.027 * BOWL_SCALE - 0.002) * f;
      tilt = 1.15 * Math.sin(Math.min(1, f * 1.2) * Math.PI);
    } else {
      r = SOUP_R + 0.004;
      y = level + 0.027 * BOWL_SCALE;
      tilt = 0;
    }
    const twitch = q > 0.72 ? Math.sin(s * 23) * 0.05 * Math.max(0, Math.sin(s * 2.1)) : Math.sin(s * 31) * 0.03;
    this.soupRoach.position.set(bx + dirX * r, y, bz + dirZ * r);
    this.soupRoach.rotation.set(-tilt, Math.atan2(dirX, dirZ) + twitch, 0);
  }

  private writeFlies(s: number): void {
    const shown = s >= FLIES_AT && s < CUT_AT ? FLIES.length : 0;
    if (shown !== this.flyDrawn) {
      this.flyDrawn = shown;
      this.flyCrowd.drawn = shown;
    }
    if (shown === 0) return;
    this.flyTime.value = s;
    for (let i = 0; i < FLIES.length; i++) {
      const f = FLIES[i];
      const t = s - f.at;
      if (t < 0) {
        this.flyCrowd.setMatrix(i, ZERO);
        continue;
      }
      const come = smootherstep(t / 0.28);
      const beat = t / (2 + i * 0.3) + i * 0.37;
      const k = Math.floor(beat);
      const into = beat - k;
      const a = (i * 31 + k * 17) & 1023;
      const b = (i * 31 + (k + 1) * 17) & 1023;
      const step = dart(into / 0.34);
      const ax = R[a] - 0.5;
      const ay = R[(a + 91) & 1023] - 0.5;
      const bx = R[b] - 0.5;
      const by = R[(b + 91) & 1023] - 0.5;
      const x = f.x + (ax + (bx - ax) * step) * 0.024;
      const y = f.y + (ay + (by - ay) * step) * 0.015;
      const heading = Math.atan2(bx - ax, by - ay) + 0.14 * Math.sin(s * 9 + i) * (1 - step);
      const cos = Math.cos(heading);
      const sin = Math.sin(heading);
      v2.set(cos, -sin, 0);
      v3.set(0, 0, -1);
      v4.set(sin, cos, 0);
      m1.makeBasis(v2, v3, v4).scale(v1.setScalar(f.scale)).setPosition(f.out[0] + (x - f.out[0]) * come, f.out[1] + (y - f.out[1]) * come, -LENS_Z);
      this.flyCrowd.setMatrix(i, m1);
    }
    this.flyCrowd.commit();
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    if (this.litAt === Infinity) {
      if (this.control.press && frame.input.pressed) this.lightUp(s, true);
      else if (s >= LIGHT_BY) this.lightUp(LIGHT_BY, false);
    }
    const d = s - this.litAt;
    if (d >= 0) this.stutterSounds(d);

    const level = this.tubeLevel(s, d);
    const back = s >= LIGHT_BACK && s < CUT_AT;
    const clean = !back && d > FLEE_DONE;
    const fridgeOn = s < FRIDGE_DIES;

    // one shadow: the tube's when it is on, the fridge's when it is not; changing the key draws it again
    const wanted = level > 0 ? (back ? this.hardSpots : this.litSpots) : this.darkSpots;
    if (this.spots !== wanted) {
      this.spots = wanted;
      for (const flag of this.flags) flag.visible = level <= 0;
    }
    this.bladeSpot.intensity = fridgeOn ? BLADE_KEY * (1 + 0.025 * wobble(frame.time * 0.8, 2)) : 0;
    this.tubeSpot.intensity = TUBE_KEY * level;
    this.manLamp.intensity = this.man.visible ? MAN_FILL * level : 0;
    this.tubeFill.intensity = TUBE_FILL * level * (back ? HARD_FILL : 1);
    this.spill.intensity = fridgeOn ? SPILL : 0;
    this.clockLamp.intensity = level > 0 || !fridgeOn ? 0 : CLOCK_GLOW;
    this.tableDark.intensity = level > 0 || !fridgeOn ? 0 : TABLE_DARK;
    const starter = Math.exp(-Math.max(0, s - this.tickAt) / 0.09);
    this.tube.emissiveIntensity = 0.02 + TUBE_GLOW * level * (back ? 1.3 : 1) + (level > 0 ? 0 : 0.5 * starter);
    this.tubeHaloColor.setHex(TUBE_COLOR).multiplyScalar((back ? 0.08 : 0.3) * level + (level > 0 ? 0 : 0.012 * starter));

    this.fridgeCard.visible = fridgeOn;
    this.fridgeHalo.visible = fridgeOn && level <= 0;
    this.beam.visible = fridgeOn && level <= 0;
    this.fridgeDoor.rotation.y = s >= LIGHT_GONE ? 0 : FRIDGE_AJAR;
    if (back !== this.isDimmed) {
      this.isDimmed = back;
      for (let i = 0; i < this.dimmed.length; i++) this.dimmed[i].color.copy(this.undimmed[i]).multiplyScalar(back ? DIM : 1);
    }

    // the picture changes stock with the light
    const closing = smootherstep(range(31, 34.5, s));
    const grade = this.air.grade;
    const film = this.film;
    if (back) {
      grade.exposure = 1.08;
      grade.saturation = 0.5;
      grade.tint = 0.02;
      grade.warmth = -0.02;
      film.bloom = 0.5;
      film.bloomFrom = 1.05;
      film.aberration = 0.22;
      this.air.envIntensity = 0.16;
      this.air.fog.density = 0.085;
    } else if (level > 0) {
      grade.exposure = 1.02 - 0.2 * closing;
      grade.saturation = 0.76;
      grade.tint = 0.03;
      grade.warmth = 0;
      film.bloom = 0.55;
      film.bloomFrom = 0.9;
      film.aberration = 0.05;
      this.air.envIntensity = 0.2;
      this.air.fog.density = 0.03;
    } else {
      grade.exposure = 1.34;
      grade.saturation = 0.7;
      grade.tint = -0.01;
      grade.warmth = -0.03;
      film.bloom = 0.95;
      film.bloomFrom = 0.55;
      film.aberration = 0.05;
      this.air.envIntensity = 0.02;
      this.air.fog.density = 0.03;
    }

    // the lens: the room, then only the plate, then the head of the table, then what is on the glass
    if (back) {
      this.focus = 2.6;
      this.aperture = lerp(2.4, 0.5, range(FLIES_AT - 0.8, FLIES_AT, s));
    } else {
      this.focus = lerp(4.5, 0.47, closing);
      this.aperture = lerp(3.5, 9, closing);
    }
    this.drift = s > 33 && s < LIGHT_GONE ? 0.25 : REDUCED_MOTION ? 0.3 : 0.6;
    const halfView = LENS_EDGE_Z * Math.tan((frame.view.fov * DEG) / 2) * 2;
    this.vignette.scale.set(halfView * frame.view.aspect * 1.02, halfView * 1.02, 1);
    this.lensEdge.opacity = back ? EDGE.back : level > 0 ? lerp(EDGE.lit, EDGE.close, closing) : EDGE.dark;
    this.black = (s >= LIGHT_GONE && s < LIGHT_BACK) || s >= CUT_AT ? 1 : s < 0.5 ? 1 - s / 0.5 : 0;
    this.white = s >= LIGHT_BACK && s < LIGHT_BACK + BACK_WHITE ? (1 - (s - LIGHT_BACK) / BACK_WHITE) * 0.34 * CALM : 0;

    this.fear = back ? 1 : s >= LIGHT_GONE ? 0.92 : clean ? lerp(0.28, 0.92, range(MAGGOTS_WAKE, MAGGOTS_ALL, s)) : d >= 0 ? 0.6 : lerp(0.25, 0.42, s / LIGHT_BY);

    setClock(this.clockHands, HALF_PAST + (Math.sin(frame.time * 2.1) > 0.93 ? 1 : 0));
    this.moteTime.value = frame.time;

    // the flat ones: alive, hiding, or back
    const state = this.fieldState.value;
    if (back) state.set(s, 1, 0);
    else state.set(s, 0.5, d <= 0 ? 0 : clamp((d - FLEE_START) / (FLEE_DONE - 0.9), 0, 1));
    this.fieldMesh.visible = !clean && (back || d >= 0);

    // the rice
    this.maggotTime.value = frame.time;
    this.maggotLife.value = range(MAGGOTS_WAKE, MAGGOTS_ALL, s);
    this.grainMesh.count = s > WALK_FROM && s < LIGHT_GONE ? GRAINS : GRAINS_FAR;
    this.writeSoupRoach(s);
    this.writeRoaches(s, d);
    this.writeFlies(s);

    // the bodies: he comes while you are not looking; the other is there when it is light again
    const sits = s >= LIGHT_GONE && s < CUT_AT;
    if (sits !== this.sack.visible) {
      this.sack.visible = sits;
      this.headChair.visible = !sits;
      this.shadowsDue = true;
    }
    const manWanted = s >= MAN_AT;
    if (manWanted !== this.man.visible && this.unseen(frame, 0, 1.2, MAN_DOORWAY)) {
      this.man.visible = manWanted;
      this.shadowsDue = true;
    }
    this.man.position.z = s >= LIGHT_GONE ? MAN_BEHIND : MAN_DOORWAY;
    this.nearChair.position.set(s >= LIGHT_GONE ? SEAT_MINE[0] : SEAT_NEAR[0], 0, s >= LIGHT_GONE ? SEAT_MINE[2] : SEAT_NEAR[2]);

    // the shutter needs the face in the picture
    if (s < SHUTTER_AT + 3) this.control.look = !(s >= LIGHT_BACK - 0.6 && s < SHUTTER_AT + 0.3);
    if (!this.shot && s >= SHUTTER_AT && (!this.unseen(frame, this.face.x, this.face.y, this.face.z, -6) || s >= SHUTTER_AT + 2)) {
      this.shot = true;
      this.shutter();
    }

    this.movingShadows = this.shadowsDue;
    this.shadowsDue = false;
  }
}
