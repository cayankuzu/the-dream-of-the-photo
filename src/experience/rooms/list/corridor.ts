import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  FrontSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { SpotSpec } from '../../../config/nightmare.config';
import { meterUVs } from '../../dream/DreamKit';
import { randomFrom } from '../../dream/FigureKit';
import type { DreamLight } from '../../dream/LightPool';
import { clamp, lerp, range, smootherstep, wobble } from '../../math';
import { WARP_GLSL, warp, warpUniforms } from '../../render/Warp';
import { GlideTrack } from '../../timeline/Track';
import type { RoomAir, RoomAssets, RoomContext, RoomControl, RoomFilm, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import { PALETTE } from '../RoomKit';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['alarm_clock', 'side_table', 'radiator', 'door_six', 'door_frame', 'door_knob', 'tube_light', 'chair_ladder', 'spider'],
  sounds: [
    'rooms/fluorescent_hum.mp3',
    'rooms/clock_tick.mp3',
    'rooms/draft_drone.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/floor_step_near_1.mp3',
    'rooms/floor_step_near_2.mp3',
    'rooms/floor_step_near_3.mp3',
    'rooms/wet_step_1.mp3',
    'rooms/wet_step_2.mp3',
    'rooms/door_creak_slow.mp3',
    'rooms/door_creak_short.mp3',
    'rooms/fluorescent_tick_1.mp3',
    'rooms/fluorescent_tick_3.mp3',
    'rooms/breath_in.mp3',
    'rooms/breath_out.mp3',
    'rooms/chest_pressure.mp3',
    'rooms/spider_tick_1.mp3',
    'rooms/spider_tick_2.mp3',
    'rooms/spider_tick_3.mp3',
    'rooms/rats_claws.mp3',
    'rooms/paper_rustle_1.mp3',
    'rooms/paper_rustle_3.mp3',
    'rooms/wet_click_1.mp3',
    'rooms/rat_chirp_far_1.mp3',
    'rooms/fire_behind_door.mp3',
    'rooms/print_flutter.mp3',
    'rooms/wade_step_1.mp3',
    'rooms/wade_step_2.mp3',
    'rooms/wade_step_3.mp3',
    'rooms/wade_step_4.mp3',
    'rooms/wade_step_5.mp3',
    'rooms/tile_drip_1.mp3',
    'rooms/tile_drip_2.mp3',
    'rooms/tile_drip_3.mp3',
    'rooms/hair_fingers.mp3',
    'rooms/cutlery_far.mp3',
    'rooms/clock_tock_far.mp3',
  ],
};

type V3 = readonly [number, number, number];
type Side = -1 | 1;
type Update = (frame: RoomFrame) => void;
type UV = (x: number, y: number, z: number) => readonly [number, number];
/** One pose on the walk: second, x, z, yaw, pitch, fov. */
type Row = readonly [number, number, number, number, number, number];

/** Inner width and height of the corridor, the eye, the top of the wainscot (m). */
const W = 2.6;
const H = 2.75;
const EYE = 1.56;
const WAIN = 1.05;
/** A door (m): half the hole in the wall, the top of the hole, how deep the black room behind it is. */
const HALF = 0.46;
const DOOR_TOP = 2.04;
const RECESS = 1.5;
const SLAB = 0.419;
/** The doors you remember: the same places every evening (z, m). */
const LEFT_DOORS = [29, 22, 15, 8, -5, -12, -19, -26, -33, -40, -47];
const RIGHT_DOORS = [25.5, 18.5, 11.5, 4.5, -8.5, -15.5, -22.5, -29.5, -36.5, -43.5];
/** Prints on the walls: their height (m) and how far apart they hang (m). */
const PRINT_Y = 1.48;
const PRINT_STEP = 1.45;
/** The table: scale of the model, its height at that scale (m). */
const TABLE_SCALE = 1.1;
const TABLE_TOP = 0.761 * TABLE_SCALE;
/** The lamp: light (cd), reach (m), shade's glow, the spiral's glow. */
const LAMP_POINT = 4.2;
const LAMP_REACH = 7;
const LAMP_DOWN = 9;
const LAMP_UP = 6;
const SHADE_GLOW = 2.3;
const SPIRAL_GLOW = 3.6;
/** The cold tube far away: its spot (cd), its point (cd), its reach (m), the strength of its halo in the air. */
const COLD_SPOT = 16;
const COLD_POINT = 4;
const COLD_REACH = 10;
const TUBE_HALO = 0.34;
/** A faint sourceless light that walks with the eye, so that the dark keeps its shapes: cd, reach (m). */
const FILL = [1.5, 2.2, 3, 1.2, 2, 1];
const FILL_REACH = 5;
const FILL_COLOR = 0xa9bcc0;
/** The walk: stride (m), how much the head bobs and sways (m) and rolls (deg), and how often it is sampled (s). */
const STRIDE = 0.64;
const BOB = 0.012;
const SWAY = 0.016;
const ROLL = 0.2;
const KEY_STEP = 0.2;
/** Grime: how far a wall's dirt repeats (m) and its grain (px per m). */
const GRIME_TILE = 14;
const GRIME_PX = 90;
/** Clothes of the men in good suits. */
const SUIT_TINT = 0x777e86;
const SUIT_BLEACH = 0.14;
/** A long neck leaves its collar sideways over the shoulder (m high) and runs against a wall (m from the centre line) before it climbs, so that nothing ever comes down onto a man from above. */
const NECK_SHOULDER = 1.56;
const NECK_WALL = 1.16;

/** The first evening (s, m, deg): where the walk begins and pauses, the man, the dip, the neck's end. */
const ONE = {
  man: -31,
  /** Distance times tan(fov / 2): what holds him at one size. */
  size: 4.1,
  dip: 22.6,
  behind: 14,
  /** Where the lamp stands, and the second lamp behind you. */
  lampZ: -15,
  secondLampZ: 9.5,
  tipStart: 30,
  tipStop: 33,
  tipTurn: 0.75,
  shutter: 33.45,
  cut: 33.86,
  /** Neck's radius (m), the end's radius (m). */
  neck: 0.062,
  tip: 0.06,
  rows: [
    [0, 0, -1, 0, 1.2, 40],
    [1.6, 0, -1, 0, 1.2, 40],
    [10.5, -0.05, -5.5, 0.5, 1.1, 40],
    [19.6, 0.02, -10, -0.5, 1, 40],
    [23.2, 0.02, -10.02, -0.5, 1, 40],
    [29.6, -0.02, -13.84, 0, 3, 40],
    [31.2, 0, -14.56, 3, 32, 60],
    [33, 0, -14.6, 0, 15, 58],
    [34, 0, -14.6, 0, 16, 58],
  ] as readonly Row[],
} as const;

/** The picture light over the first print (cd). */
const MUSEUM = 38;

/** The second evening: the print (m), the spider (m, s), the turn round. */
const TWO = {
  far: -19,
  printZ: -7.6,
  printY: EYE - 0.09,
  printW: 0.46,
  spiderScale: 1.25,
  spiderIn: 12,
  spiderStop: 13.3,
  spiderFace: 0.09,
  swapLatest: 18.6,
  shutter: 19.1,
  /** How far the far door has opened by the cut (rad): a hand's width. */
  ajar: 0.5,
  rows: [
    [0, 0.2, -0.8, 0, 0, 50],
    [2.2, 0.2, -0.8, 0, 0, 50],
    [8.6, 0.02, -4.7, 10, 0, 49],
    [11, -0.36, -6.28, 46, 0.5, 45],
    [14, -0.36, -6.34, 47, 0.5, 44],
    [15.6, -0.2, -7.7, 74, 0.5, 46],
    [16.8, 0, -8.4, 10, 0, 48],
    [17.4, 0.05, -8.7, 8, 0, 48],
    [19, 0.1, -9.1, 134, 0.5, 33],
    [19.5, 0.11, -9.18, 135, 0.5, 32],
    [21, 0, -9.8, 6, 0, 44],
    [22, -0.18, -10.9, 1, 0.5, 36],
  ] as readonly Row[],
  calmRows: [
    [0, 0.2, -0.8, 0, 0, 50],
    [2.2, 0.2, -0.8, 0, 0, 50],
    [8.6, 0.02, -4.7, 10, 0, 49],
    [11, -0.36, -6.28, 46, 0.5, 45],
    [14, -0.36, -6.34, 47, 0.5, 44],
    [18.6, 0, -9, 134, 0.5, 40],
    [19.3, 0.02, -9.05, 135, 0.5, 38],
    [22, -0.1, -10.1, 14, 0, 42],
  ] as readonly Row[],
} as const;

/** The third: doors, rats (m, s), the wet along the skirting. */
const THREE = {
  far: -22,
  ratFrom: -18.5,
  ratHole: -10.4,
  ratStart: 8,
  ratRun: 4.4,
  rats: 170,
  shutter: 7.5,
  closeFrom: 7.4,
  closeFor: 9.5,
  /** How far the far door has opened by the cut (rad): half. */
  ajar: 0.9,
  rows: [
    [0, 0, -0.9, 0, 0, 50],
    [1.4, 0, -0.9, 0, 0, 50],
    [5.6, 0.06, -3.6, 0, 0, 50],
    [7.3, 0.12, -4.95, 84, 0, 46],
    [8.1, 0.12, -5.5, 80, 0, 46],
    [9.8, 0.06, -6.6, -2, 0, 50],
    [11.6, -0.02, -7.7, -6, 0, 50],
    [12.7, -0.16, -8.4, -86, 0, 46],
    [13.4, -0.16, -8.9, -82, 0, 46],
    [15.2, 0, -9.95, 0, -1, 50],
    [16.8, 0, -10, 0, -1, 50],
    [18.4, -0.04, -11.8, 78, 0, 46],
    [19.1, -0.04, -12.3, 70, 0, 46],
    [20.6, -0.02, -13.2, 4, -2, 48],
    [22, 0, -14.6, 0, -1, 40],
  ] as readonly Row[],
} as const;

/** The fourth (m, s): how the fire door closes and what is left afterwards. */
const FOUR = {
  far: -30,
  fireZ: -15.5,
  ajar: 0.54,
  shut: 15.6,
  shutFor: 0.22,
  /** The ceiling lanes of the necks (m from the centre line): the innermost, and the step out; the furthest man on each wall takes the innermost. */
  lane: 0.46,
  laneStep: 0.155,
  rows: [
    [0, 0, -3, 0, 0, 52],
    [0.9, 0, -3, 0, 0, 52],
    [10.5, -0.12, -10.6, -3, 0, 50],
    [13.2, -0.22, -12.9, -26, 0, 48],
    [15.5, -0.3, -14.3, -47, 0, 40],
    [16.4, -0.3, -14.4, -44, 0, 44],
    [18.2, -0.2, -15.3, -8, 0, 50],
    [22, 0, -18.4, 0, 0, 50],
  ] as readonly Row[],
} as const;

/** The fifth (m, s): the one standing under the water, the chair. */
const FIVE = {
  far: -18,
  chairZ: -13.8,
  chairX: -0.34,
  under: [-0.82, -7.5] as readonly [number, number],
  shutter: 17.6,
  /** How far the far door has opened by the cut (rad): wide. */
  ajar: 1.45,
  /** Lamplight on the shoes of the one under the water, where they meet the surface: from the feet (m), cd, reach (m). */
  shoes: [0.28, -0.14, 0.42, 1.6, 1.3] as readonly [number, number, number, number, number],
  rows: [
    [0, 0, -0.9, 0, -3, 62],
    [1.8, 0, -0.9, 0, -3, 62],
    [6, 0.02, -2.6, 3, -16, 56],
    [9, 0.04, -3.9, 8, -24, 50],
    [10.8, 0.05, -4.8, 12, -29, 48],
    [12.7, 0.05, -4.84, 14, -30, 48],
    [13.8, 0.08, -6.1, 4, -12, 52],
    [14.4, 0.1, -7.1, 0, -8, 54],
    [17, 0.14, -9.2, 153, -52, 44],
    [18.2, 0.14, -9.35, 155, -53, 44],
    [20.4, 0.14, -9.9, 20, -6, 52],
    [22, 0.1, -10.7, 1, -3, 42],
  ] as readonly Row[],
} as const;

/** The sixth (m, s, rad): how hard the floor leans, where the curtains of hair hang. */
const SIX = {
  far: -19,
  lean: 0.18,
  wallHair: 5600,
  curtain: 460,
  curtains: [-3.4, -6.1, -8.9, -11.7, -14.2] as readonly number[],
  doorFrom: 17.2,
  doorFor: 4.2,
  shutter: 16.4,
  rows: [
    [0, 0, -0.9, 0, 1, 52],
    [1.6, 0, -0.9, 0, 1, 52],
    [8, 0, -5.4, 2, 2, 52],
    [14.4, 0, -10.2, -3, 2, 52],
    [16, 0, -10.24, -3, 2, 52],
    [22, 0, -15.1, 0, 1, 48],
  ] as readonly Row[],
} as const;

/**
 * The far door on the evenings that break off on it (2, 3 and 5): it opens by itself in the room's last `last` s and
 * is still moving at the cut, on the warm room of the dinner.
 */
const AJAR = {
  last: 3,
  /** The dining room's far wall: this many times as bright as its picture. */
  wall: 1.8,
  /** The glow of the gap in the dusty air: width and height (m), and its strength with the door wide open. */
  glowSize: [0.9, 2.6],
  glow: 0.5,
  /** The light it lets out into the corridor: cd with the door wide open, reach (m). */
  spill: 12,
  spillReach: 9,
  /** The blade of light on the floor: length (m), how many times wider at its near end than at the door, strength. */
  bladeLength: 5,
  bladeSpread: 4,
  blade: 0.4,
  /** How much of its light the cold tube by the door has given up by the cut (0..1). */
  coldGives: 0.93,
  /** Below this opening at the cut (rad) the door creaks only short. */
  short: 0.7,
  /** The dinner as heard through it: low-pass (Hz) through a door that has hardly moved, and how much higher through a wide one. */
  muffle: [800, 2000],
  /** Gains with the door wide open: the cutlery, each tock of the clock in there. */
  cutlery: 0.26,
  tock: 0.3,
  /** The first tock after the door starts to move (s), and how often it comes (s). */
  tockFirst: 0.45,
  tockEvery: 1.02,
} as const;

/** What it says on each visit (seconds into the room, the line); on the first the narrator does the talking. */
const LINES: readonly ({ at: number; tr: string; en: string } | null)[] = [
  null,
  { at: 6, tr: 'Onu duvara sen astın.', en: 'You hung that on the wall.' },
  { at: 5, tr: 'Kapılar açık. Kimse çıkmadı.', en: 'The doors are open. No one has come out.' },
  { at: 7, tr: 'Hepsi senin çektiklerin.', en: 'All of them, your pictures.' },
  { at: 6, tr: 'Su ayak bileğinde.', en: 'The water is at your ankles.' },
  { at: 7, tr: 'Sofra kuruldu. Bir sandalye boş.', en: 'The table is set. One chair is empty.' },
];

const FREE: RoomControl = { look: true, scroll: true, hurry: 1.6 };
const HELD: RoomControl = { look: false, scroll: false };

const dummy = new Object3D();
const smooth = (a: number, b: number, v: number): number => smootherstep(range(a, b, v));

interface DoorSpec {
  side: Side;
  z: number;
  /** How far it stands open (rad). */
  swing: number;
  hinge: 'near' | 'far';
  /** It moves while you look, so it gets its own meshes. */
  live?: boolean;
  name?: string;
}

interface LiveDoor {
  leaf: Object3D;
  /** The leaf's rotation for `swing` rad open is `sign * swing`. */
  sign: number;
}

interface Lamp {
  root: Group;
  at: V3;
  point: DreamLight;
  down: SpotSpec;
  up: SpotSpec;
  shade: MeshStandardMaterial;
  spiral: MeshStandardMaterial;
  beam: ShaderMaterial;
  secondHand: Object3D;
  secondRest: number;
  /** Where it stands in the stereo field. */
  side: Side;
}

/** A cold tube on the ceiling: what it is lit by and lights, and how strong it was made. */
interface Tube {
  glow: MeshBasicMaterial;
  point: DreamLight;
  spot: SpotSpec;
  halo: Mesh;
  strength: number;
}

interface Walk {
  keys: RoomKey[];
  x: GlideTrack;
  z: GlideTrack;
  walked: GlideTrack;
  falls: { t: number; x: number; z: number }[];
}

/** Geometry as plain floats, so that a matrix can be applied to it however the file stored it. */
function plainGeometry(source: BufferGeometry): BufferGeometry {
  const g = new BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = source.getAttribute(name);
    if (!a) continue;
    const items = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) {
      items[i * a.itemSize] = a.getX(i);
      items[i * a.itemSize + 1] = a.getY(i);
      if (a.itemSize > 2) items[i * a.itemSize + 2] = a.getZ(i);
    }
    g.setAttribute(name, new Float32BufferAttribute(items, a.itemSize));
  }
  const index = source.getIndex();
  if (index) g.setIndex(Array.from(index.array));
  if (!source.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

/** A list of poses, sampled finely, with the small sway of someone walking laid over it. */
function walkAlong(rows: readonly Row[], seconds: number, cuts: readonly number[] = [], fovOf?: (s: number, z: number) => number, calm = true): Walk {
  const at = rows.map((r) => r[0]);
  const track = (k: number) => new GlideTrack(at, rows.map((r) => r[k]));
  const x = track(1);
  const z = track(2);
  const yaw = track(3);
  const pitch = track(4);
  const fov = track(5);
  const stamps: number[] = [seconds];
  for (let s = 0; s < seconds; s += KEY_STEP) stamps.push(s);
  for (const c of cuts) stamps.push(c - 0.015, c + 0.015);
  stamps.sort((p, q) => p - q);
  const times = stamps.filter((s, i) => i === 0 || s - stamps[i - 1] > 1e-3);
  const distances: number[] = [];
  let travelled = 0;
  for (let i = 0; i < times.length; i++) {
    if (i > 0) travelled += Math.hypot(x.at(times[i]) - x.at(times[i - 1]), z.at(times[i]) - z.at(times[i - 1]));
    distances.push(travelled);
  }
  const amount = REDUCED_MOTION ? 0.25 : 1;
  const keys = times.map((s, i) => {
    const phase = (distances[i] / STRIDE) * Math.PI;
    const side = Math.sin(phase);
    return {
      t: s / seconds,
      at: [x.at(s) + side * SWAY * amount, EYE + (Math.cos(phase * 2) - 1) * 0.5 * BOB * amount, z.at(s)] as V3,
      yaw: yaw.at(s) * (REDUCED_MOTION && calm ? 0.6 : 1),
      pitch: pitch.at(s) * (REDUCED_MOTION && calm ? 0.7 : 1),
      roll: side * ROLL * amount,
      fov: fovOf ? fovOf(s, z.at(s)) : fov.at(s),
    };
  });
  const walked = new GlideTrack(times, distances);
  const falls: Walk['falls'] = [];
  for (let k = 1, i = 0; k * STRIDE < travelled; k++) {
    while (distances[i] < k * STRIDE) i++;
    falls.push({ t: times[i], x: x.at(times[i]), z: z.at(times[i]) });
  }
  return { keys, x, z, walked, falls };
}

/** Flat quads gathered into one mesh: walls cut around doors, all in one draw. */
class Sheets {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];

  /** A quad from corner `o` along `a` and `b`, cut in cells so that it can bend; its normal is a x b unless `toward` says otherwise. */
  add(o: V3, a: V3, b: V3, uv: UV, cell = 0.5, toward?: V3): void {
    let [ox, oy, oz] = o;
    let [ax, ay, az] = a;
    const [bx, by, bz] = b;
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    if (toward && nx * toward[0] + ny * toward[1] + nz * toward[2] < 0) {
      ox += ax;
      oy += ay;
      oz += az;
      ax = -ax;
      ay = -ay;
      az = -az;
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const length = Math.hypot(nx, ny, nz) || 1;
    const na = Math.max(1, Math.ceil(Math.hypot(ax, ay, az) / cell));
    const nb = Math.max(1, Math.ceil(Math.hypot(bx, by, bz) / cell));
    const base = this.positions.length / 3;
    for (let j = 0; j <= nb; j++) {
      for (let i = 0; i <= na; i++) {
        const px = ox + (ax * i) / na + (bx * j) / nb;
        const py = oy + (ay * i) / na + (by * j) / nb;
        const pz = oz + (az * i) / na + (bz * j) / nb;
        this.positions.push(px, py, pz);
        this.normals.push(nx / length, ny / length, nz / length);
        const [u, v] = uv(px, py, pz);
        this.uvs.push(u, v);
      }
    }
    for (let j = 0; j < nb; j++) {
      for (let i = 0; i < na; i++) {
        const p = base + j * (na + 1) + i;
        this.indices.push(p, p + 1, p + na + 1, p + 1, p + na + 2, p + na + 1);
      }
    }
  }

  mesh(material: Material): Mesh {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex(this.indices);
    const m = new Mesh(geometry, material);
    m.frustumCulled = false;
    m.receiveShadow = true;
    return m;
  }
}

function sheet(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement, tileS = false, tileT = false): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  if (tileS) t.wrapS = RepeatWrapping;
  if (tileT) t.wrapT = RepeatWrapping;
  return t;
}

/** A soft stain that wraps around the seam of a tile. */
function blot(g: CanvasRenderingContext2D, x: number, y: number, r: number, span: number, inner: string, outer: string): void {
  for (const shift of [-span, 0, span]) {
    if (x + shift + r < 0 || x + shift - r > span) continue;
    const grad = g.createRadialGradient(x + shift, y, 0, x + shift, y, r);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(x + shift - r, y - r, r * 2, r * 2);
  }
}

/** What sixty years do to wallpaper: a canvas that lies over it and only darkens. */
function wallGrime(seed: number): CanvasTexture {
  const px = GRIME_PX;
  const [c, g] = sheet(GRIME_TILE * px, H * px);
  const w = c.width;
  const h = c.height;
  const rnd = randomFrom(seed);
  const rail = 1 - WAIN / H;
  const veil = g.createLinearGradient(0, 0, 0, h);
  veil.addColorStop(0, 'rgba(3,4,3,0.84)');
  veil.addColorStop(0.08, 'rgba(3,4,3,0.44)');
  veil.addColorStop(0.3, 'rgba(3,4,3,0.1)');
  veil.addColorStop(rail - 0.14, 'rgba(3,4,3,0.14)');
  veil.addColorStop(rail - 0.01, 'rgba(3,4,3,0.66)');
  veil.addColorStop(rail, 'rgba(3,4,3,0.12)');
  veil.addColorStop(0.96, 'rgba(3,4,3,0.3)');
  veil.addColorStop(1, 'rgba(3,4,3,0.72)');
  g.fillStyle = veil;
  g.fillRect(0, 0, w, h);
  // the seams of the paper, some of them lifting
  for (let x = rnd() * 40; x < w; x += 0.53 * px) {
    g.fillStyle = `rgba(2,2,1,${0.22 + rnd() * 0.3})`;
    g.fillRect(x, 0, 1 + rnd() * 1.2, h * rail);
  }
  for (let i = 0; i < 70; i++) {
    const r = (0.15 + rnd() * rnd() * 1.1) * px;
    blot(g, rnd() * w, rnd() * h * rail, r, w, `rgba(4,5,3,${0.08 + rnd() * 0.24})`, 'rgba(4,5,3,0)');
  }
  // damp that climbed from the wainscot and stopped: a ragged edge
  g.beginPath();
  g.moveTo(0, h * rail);
  for (let x = 0; x <= w; x += 12) g.lineTo(x, h * rail - (0.1 + 0.28 * (0.5 + 0.5 * Math.sin((x / w) * Math.PI * 6 + seed)) + rnd() * 0.05) * px);
  g.lineTo(w, h * rail);
  g.closePath();
  g.fillStyle = 'rgba(5,7,4,0.34)';
  g.fill();
  g.strokeStyle = 'rgba(24,20,10,0.42)';
  g.lineWidth = 1.5;
  g.stroke();
  // long runs of water down from the ceiling
  for (let i = 0; i < 44; i++) {
    const x = rnd() * w;
    const length = (0.3 + rnd() * 1.3) * px;
    const run = g.createLinearGradient(0, 0, 0, length);
    run.addColorStop(0, `rgba(4,5,3,${0.2 + rnd() * 0.36})`);
    run.addColorStop(1, 'rgba(4,5,3,0)');
    g.fillStyle = run;
    g.fillRect(x, 0, 1.5 + rnd() * 5, length);
  }
  // mould in freckles
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(3,5,3,${0.08 + rnd() * 0.3})`;
    const y = h * rail * Math.pow(rnd(), 0.4);
    g.fillRect(rnd() * w, y, 1 + rnd() * 1.6, 1 + rnd() * 1.6);
  }
  return texture(c, true);
}

/** The margins of a floor nobody polishes, and where feet have gone for sixty years. */
function floorDirt(): CanvasTexture {
  const [c, g] = sheet(W * 80, 10 * 80);
  const w = c.width;
  const h = c.height;
  const rnd = randomFrom(5);
  const edge = g.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, 'rgba(2,2,1,0.92)');
  edge.addColorStop(0.1, 'rgba(2,2,1,0.46)');
  edge.addColorStop(0.3, 'rgba(2,2,1,0)');
  edge.addColorStop(0.7, 'rgba(2,2,1,0)');
  edge.addColorStop(0.9, 'rgba(2,2,1,0.46)');
  edge.addColorStop(1, 'rgba(2,2,1,0.92)');
  g.fillStyle = edge;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 80; i++) {
    const y = rnd() * h;
    const x = rnd() * w;
    const r = (0.06 + rnd() * 0.4) * 80;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(10,7,3,${0.05 + rnd() * 0.18})`);
    grad.addColorStop(1, 'rgba(10,7,3,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return texture(c, false, true);
}

/** Rusty rings and old leaks on the ceiling tiles. */
function ceilingStains(): CanvasTexture {
  const [c, g] = sheet(W * 60, 12 * 60);
  const w = c.width;
  const h = c.height;
  const rnd = randomFrom(9);
  g.fillStyle = 'rgba(3,3,2,0.42)';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = (0.25 + rnd() * 0.7) * 60;
    const grad = g.createRadialGradient(x, y, r * 0.3, x, y, r);
    grad.addColorStop(0, `rgba(44,30,12,${0.18 + rnd() * 0.3})`);
    grad.addColorStop(0.82, `rgba(40,26,8,${0.3 + rnd() * 0.3})`);
    grad.addColorStop(1, 'rgba(40,26,8,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const edge = g.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, 'rgba(2,2,1,0.9)');
  edge.addColorStop(0.2, 'rgba(2,2,1,0)');
  edge.addColorStop(0.8, 'rgba(2,2,1,0)');
  edge.addColorStop(1, 'rgba(2,2,1,0.9)');
  g.fillStyle = edge;
  g.fillRect(0, 0, w, h);
  return texture(c, false, true);
}

/** A runner worn pale along the middle, its edges frayed: it repeats every 4 m. */
function runnerMap(): CanvasTexture {
  const [c, g] = sheet(256, 1024);
  const w = c.width;
  const h = c.height;
  const rnd = randomFrom(17);
  g.fillStyle = '#2b100c';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#4b2c18';
  g.fillRect(14, 0, 8, h);
  g.fillRect(w - 22, 0, 8, h);
  g.strokeStyle = '#3e1d14';
  g.lineWidth = 3;
  for (let y = 0; y < h; y += 128) {
    g.beginPath();
    g.moveTo(w / 2, y + 16);
    g.lineTo(w * 0.8, y + 64);
    g.lineTo(w / 2, y + 112);
    g.lineTo(w * 0.2, y + 64);
    g.closePath();
    g.stroke();
  }
  // threads gone along the middle: the walk of sixty years
  for (let i = 0; i < 9000; i++) {
    const across = (rnd() + rnd() + rnd()) / 3;
    const x = across * w;
    const fade = 1 - Math.abs(across - 0.5) * 3.2;
    if (fade <= 0) continue;
    g.fillStyle = `rgba(136,118,96,${0.05 + 0.26 * fade * rnd()})`;
    g.fillRect(x, rnd() * h, 1 + rnd() * 1.5, 2 + rnd() * 9);
  }
  // frayed edges, dark against the floor
  g.fillStyle = '#0d0605';
  for (let y = 0; y < h; y += 2) {
    g.fillRect(0, y, 2 + rnd() * 7, 2);
    g.fillRect(w - 2 - rnd() * 7, y, 10, 2);
  }
  return texture(c, false, true);
}

/** Skin stretched too far: bloodless, veined, creased across its length. U runs along it, every 1.4 m. */
function skinMaps(): { map: CanvasTexture; bump: CanvasTexture } {
  const size = 1024;
  const [c, g] = sheet(size, 512);
  const [bc, bg] = sheet(size, 512);
  const rnd = randomFrom(13);
  g.fillStyle = '#c6bcae';
  g.fillRect(0, 0, size, 512);
  bg.fillStyle = '#808080';
  bg.fillRect(0, 0, size, 512);
  for (let i = 0; i < 900; i++) {
    const x = rnd() * size;
    const y = rnd() * 512;
    const r = 6 + rnd() * 46;
    const tone = rnd() < 0.5 ? '110,84,78' : '86,94,112';
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${tone},${0.03 + rnd() * 0.05})`);
    grad.addColorStop(1, `rgba(${tone},0)`);
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // creases, across the length
  for (let i = 0; i < 150; i++) {
    const x = rnd() * size;
    const shade = 0.02 + rnd() * 0.09;
    g.strokeStyle = `rgba(74,48,42,${shade})`;
    bg.strokeStyle = `rgba(30,30,30,${shade * 3})`;
    const width = 1 + rnd() * 2.4;
    g.lineWidth = width;
    bg.lineWidth = width;
    const wander = (rnd() - 0.5) * 22;
    for (const ctx of [g, bg]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + wander, 170, x - wander, 340, x, 512);
      ctx.stroke();
    }
  }
  // veins, along it
  for (let i = 0; i < 26; i++) {
    let x = 0;
    let y = rnd() * 512;
    g.strokeStyle = `rgba(62,84,118,${0.1 + rnd() * 0.16})`;
    g.lineWidth = 1 + rnd() * 2.4;
    g.beginPath();
    g.moveTo(x, y);
    while (x < size) {
      x += 20 + rnd() * 60;
      y += (rnd() - 0.5) * 30;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // pores
  for (let i = 0; i < 9000; i++) {
    bg.fillStyle = `rgba(0,0,0,${0.08 + rnd() * 0.2})`;
    bg.fillRect(rnd() * size, rnd() * 512, 1.3, 1.3);
  }
  const map = texture(c, true, true);
  map.repeat.set(1 / 1.4, 1);
  const bump = new CanvasTexture(bc);
  bump.wrapS = bump.wrapT = RepeatWrapping;
  bump.repeat.set(1 / 1.4, 1);
  return { map, bump };
}

/** A soft white round: a sheen of light on the wax, a print's own dim light. */
function softRound(): CanvasTexture {
  const [c, g] = sheet(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.42)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return texture(c);
}

/** A shadow thrown long along the floor, dark at the feet. */
function longShadow(): CanvasTexture {
  const [c, g] = sheet(64, 256);
  const along = g.createLinearGradient(0, 256, 0, 0);
  along.addColorStop(0, 'rgba(0,0,0,0.86)');
  along.addColorStop(0.4, 'rgba(0,0,0,0.4)');
  along.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = along;
  g.fillRect(0, 0, 64, 256);
  g.globalCompositeOperation = 'destination-in';
  const across = g.createLinearGradient(0, 0, 64, 0);
  across.addColorStop(0, 'rgba(0,0,0,0)');
  across.addColorStop(0.5, 'rgba(0,0,0,1)');
  across.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = across;
  g.fillRect(0, 0, 64, 256);
  return texture(c);
}

/** Bare plaster where a strip of paper has come away: ragged at the edge. */
function barePlaster(): CanvasTexture {
  const [c, g] = sheet(160, 512);
  const rnd = randomFrom(29);
  g.fillStyle = '#6f675a';
  g.beginPath();
  g.moveTo(8, 0);
  for (let y = 0; y <= 512; y += 14) g.lineTo(6 + rnd() * 16, y);
  for (let y = 512; y >= 0; y -= 14) g.lineTo(138 + rnd() * 16, y);
  g.closePath();
  g.fill();
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(30,26,20,${0.05 + rnd() * 0.16})`;
    g.fillRect(rnd() * 160, rnd() * 512, 1 + rnd() * 5, 1 + rnd() * 5);
  }
  return texture(c);
}

/** The dirty outline a picture leaves on a wall. */
function ghostEdge(): CanvasTexture {
  const [c, g] = sheet(256, 300);
  g.strokeStyle = 'rgba(4,4,3,0.75)';
  g.lineWidth = 3;
  g.strokeRect(14, 14, 228, 272);
  g.strokeStyle = 'rgba(4,4,3,0.4)';
  g.lineWidth = 16;
  g.strokeRect(6, 6, 244, 288);
  return texture(c);
}

/** The shade's cloth: pleats, brightest toward its lower edge. */
function pleats(): CanvasTexture {
  const [c, g] = sheet(512, 96);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = 'rgba(100,70,40,0.32)';
  for (let x = 0; x < 512; x += 10) g.fillRect(x, 0, 3, 96);
  const down = g.createLinearGradient(0, 96, 0, 0);
  down.addColorStop(0, 'rgba(0,0,0,0)');
  down.addColorStop(1, 'rgba(46,24,8,0.66)');
  g.fillStyle = down;
  g.fillRect(0, 0, 512, 96);
  return texture(c);
}

/** The far wall of the dining room as a gap in a door shows it: lamplight, brightest high up where the lamp hangs over the table, the skirting dark. */
function dinnerWall(): CanvasTexture {
  const [c, g] = sheet(128, 288);
  const down = g.createLinearGradient(0, 0, 0, 288);
  down.addColorStop(0, '#4a3018');
  down.addColorStop(0.35, '#e0a868');
  down.addColorStop(0.78, '#c08048');
  down.addColorStop(0.93, '#6a4024');
  down.addColorStop(1, '#1c100a');
  g.fillStyle = down;
  g.fillRect(0, 0, 128, 288);
  const lamp = g.createRadialGradient(84, 96, 6, 84, 96, 150);
  lamp.addColorStop(0, 'rgba(255,226,170,0.9)');
  lamp.addColorStop(0.4, 'rgba(255,200,130,0.35)');
  lamp.addColorStop(1, 'rgba(255,200,130,0)');
  g.fillStyle = lamp;
  g.fillRect(0, 0, 128, 288);
  return texture(c);
}

/** The blade of light a door ajar lays on the floor: narrow at the door (the top row), wider and fainter toward you. */
function lightBlade(): CanvasTexture {
  const [c, g] = sheet(64, 256);
  for (let y = 0; y < 256; y++) {
    const v = y / 255;
    const half = 32 * (1 / AJAR.bladeSpread + (1 - 1 / AJAR.bladeSpread) * v);
    const fade = Math.pow(1 - v, 1.6);
    const across = g.createLinearGradient(32 - half, 0, 32 + half, 0);
    across.addColorStop(0, 'rgba(255,255,255,0)');
    across.addColorStop(0.25, `rgba(255,255,255,${fade})`);
    across.addColorStop(0.75, `rgba(255,255,255,${fade})`);
    across.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = across;
    g.fillRect(32 - half, y, 2 * half, 1);
  }
  return texture(c);
}

/** The face of the clock that always says half past: a spiral, burning. */
function spiralFace(): CanvasTexture {
  const [c, g] = sheet(256, 256);
  g.fillStyle = '#100703';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 11;
  g.lineCap = 'round';
  g.beginPath();
  for (let a = 0; a < Math.PI * 7; a += 0.05) {
    const r = (a / (Math.PI * 7)) * 116;
    const x = 128 + Math.cos(a) * r;
    const y = 128 + Math.sin(a) * r;
    if (a === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  return texture(c);
}

/** One person in a picture, as a flash shows them against a pale wall: a dark jacket, a small pale head under white hair. */
function person(g: CanvasRenderingContext2D, x: number, y: number, r: number, scratched: boolean, seed: number): void {
  const rnd = randomFrom(seed);
  g.save();
  g.filter = 'blur(0.7px)';
  g.fillStyle = '#17191c';
  g.beginPath();
  g.moveTo(x - r * 0.42, y + r * 1.0);
  g.bezierCurveTo(x - r * 1.3, y + r * 1.25, x - r * 2.2, y + r * 1.5, x - r * 2.5, y + r * 3.4);
  g.lineTo(x - r * 2.7, y + r * 12);
  g.lineTo(x + r * 2.7, y + r * 12);
  g.lineTo(x + r * 2.5, y + r * 3.4);
  g.bezierCurveTo(x + r * 2.2, y + r * 1.5, x + r * 1.3, y + r * 1.25, x + r * 0.42, y + r * 1.0);
  g.closePath();
  g.fill();
  g.fillStyle = '#3e3a33';
  g.fillRect(x - r * 0.32, y + r * 0.8, r * 0.64, r * 0.5);
  g.fillStyle = '#85827a';
  g.beginPath();
  g.moveTo(x - r * 0.3, y + r * 1.22);
  g.lineTo(x, y + r * 2.1);
  g.lineTo(x + r * 0.3, y + r * 1.22);
  g.closePath();
  g.fill();
  g.fillStyle = '#17191c';
  g.fillRect(x - r * 0.05, y + r * 1.3, r * 0.1, r * 0.8);
  const face = g.createRadialGradient(x - r * 0.2, y - r * 0.15, r * 0.1, x, y, r * 1.1);
  face.addColorStop(0, '#d7ccba');
  face.addColorStop(0.72, '#a1937f');
  face.addColorStop(1, '#4f483d');
  g.fillStyle = face;
  g.beginPath();
  g.ellipse(x, y, r * 0.78, r * 1.0, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(14,12,10,0.8)';
  g.beginPath();
  g.ellipse(x - r * 0.3, y - r * 0.08, r * 0.15, r * 0.1, 0, 0, Math.PI * 2);
  g.ellipse(x + r * 0.3, y - r * 0.08, r * 0.15, r * 0.1, 0, 0, Math.PI * 2);
  g.ellipse(x, y + r * 0.56, r * 0.24, r * 0.045, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(214,208,194,0.9)';
  g.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const a = Math.PI + rnd() * Math.PI;
    g.lineWidth = 0.6 + rnd() * 1.1;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.74);
    g.quadraticCurveTo(x + Math.cos(a) * r * 1.02, y + Math.sin(a) * r * 1.18, x + Math.cos(a) * r * (0.86 + rnd() * 0.2), y + Math.sin(a) * r * 0.9 + r * rnd() * 0.5);
    g.stroke();
  }
  g.restore();
  if (!scratched) return;
  // the emulsion scratched away with a pin
  g.save();
  g.strokeStyle = 'rgba(236,230,216,0.94)';
  g.lineCap = 'round';
  for (let i = 0; i < 110; i++) {
    const a = rnd() * Math.PI * 2;
    const b = rnd() * Math.PI * 2;
    g.lineWidth = 0.5 + rnd() * 1.2;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r);
    g.lineTo(x + Math.cos(b) * r * 0.78, y + Math.sin(b) * r);
    g.stroke();
  }
  g.restore();
}

/** The first print: the picture the shutter kept, with someone in it, and later one more. */
function witness(picture: HTMLCanvasElement | null, second: boolean): HTMLCanvasElement {
  const s = 320;
  const [c, g] = sheet(s, s);
  const wall = g.createRadialGradient(s * 0.5, s * 0.34, s * 0.05, s * 0.5, s * 0.5, s * 0.8);
  wall.addColorStop(0, '#8d8b80');
  wall.addColorStop(0.6, '#55554d');
  wall.addColorStop(1, '#0c0d0c');
  g.fillStyle = wall;
  g.fillRect(0, 0, s, s);
  if (picture) {
    g.globalAlpha = 0.34;
    g.drawImage(picture, 0, 0, s, s);
    g.globalAlpha = 1;
  }
  person(g, s * 0.47, s * 0.39, s * 0.095, false, 41);
  if (second) person(g, s * 0.8, s * 0.27, s * 0.128, true, 57);
  return c;
}

/** All the prints as one picture, each with its paper, for hundreds of them in one draw. */
function printsAtlas(canvases: readonly HTMLCanvasElement[]): { map: CanvasTexture; tiles: number; columns: number; rows: number } {
  const tileW = 128;
  const tileH = 154;
  const tiles = Math.max(1, canvases.length);
  const columns = Math.ceil(Math.sqrt(tiles));
  const rows = Math.ceil(tiles / columns);
  const [c, g] = sheet(columns * tileW, rows * tileH);
  g.fillStyle = '#a6a296';
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < tiles; i++) {
    const x = (i % columns) * tileW + 8;
    const y = Math.floor(i / columns) * tileH + 8;
    g.fillStyle = '#0b0c0b';
    g.fillRect(x, y, 112, 112);
    if (canvases[i]) g.drawImage(canvases[i], x, y, 112, 112);
  }
  return { map: texture(c), tiles, columns, rows };
}

/** How a long neck's surface is not a tube: knots of vertebrae, two tendons, creases, thick and thin places. */
function relief(s: number, a: number): number {
  const spine = Math.pow(Math.max(0, Math.cos(a)), 7) * Math.pow(0.5 + 0.5 * Math.cos((s * Math.PI * 2) / 0.19), 2) * 0.17;
  const wrapped = Math.abs(a) > Math.PI ? 2 * Math.PI - Math.abs(a) : Math.abs(a);
  const tendons = 0.07 * Math.exp(-((wrapped - 2.1) * (wrapped - 2.1)) * 8);
  const crease = -0.018 * Math.pow(Math.abs(Math.sin(s * 11 + Math.sin(s * 1.7) * 2)), 14);
  const swell = 0.05 * Math.sin(s * 1.9 + Math.sin(s * 0.6) * 1.6);
  return 1 + spine + tendons + crease + swell;
}

/** A static length of neck along `points` (m). */
function neckGeometry(points: readonly V3[], radius: number, taper: number, perMeter = 12, around = 12): BufferGeometry {
  const curve = new CatmullRomCurve3(points.map((p) => new Vector3(p[0], p[1], p[2])));
  const length = curve.getLength();
  const rings = Math.max(8, Math.round(length * perMeter));
  const centers = curve.getSpacedPoints(rings);
  const tangent = new Vector3();
  const normal = new Vector3(0.31, 0.9, 0.3).normalize();
  const binormal = new Vector3();
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= rings; j++) {
    const a = centers[Math.max(0, j - 1)];
    const b = centers[Math.min(rings, j + 1)];
    tangent.copy(b).sub(a).normalize();
    normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
    binormal.crossVectors(tangent, normal);
    const s = (j / rings) * length;
    const r = radius * (1 - (j / rings) * (1 - taper));
    for (let k = 0; k <= around; k++) {
      const a2 = (k / around) * Math.PI * 2 - Math.PI;
      const v = r * relief(s, a2);
      const nx = normal.x * Math.cos(a2) + binormal.x * Math.sin(a2);
      const ny = normal.y * Math.cos(a2) + binormal.y * Math.sin(a2);
      const nz = normal.z * Math.cos(a2) + binormal.z * Math.sin(a2);
      positions.push(centers[j].x + nx * v, centers[j].y + ny * v, centers[j].z + nz * v);
      uvs.push(s, k / around);
      colors.push(1, 1, 1);
      if (j < rings && k < around) {
        const p = j * (around + 1) + k;
        indices.push(p, p + 1, p + around + 1, p + 1, p + around + 2, p + around + 1);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const n = geometry.getAttribute('normal');
  for (let j = 0; j <= rings; j++) {
    const first = j * (around + 1);
    const last = first + around;
    const x = n.getX(first) + n.getX(last);
    const y = n.getY(first) + n.getY(last);
    const z = n.getZ(first) + n.getZ(last);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(first, x / l, y / l, z / l);
    n.setXYZ(last, x / l, y / l, z / l);
  }
  return geometry;
}

/** The open end of the neck, as (radius, how far along): slack and thin-lipped, like the mouth of an empty sleeve, and then the dark going on down. */
const LIP: readonly (readonly [number, number])[] = [
  [1.0, 0.0],
  [1.05, 0.014],
  [1.08, 0.03],
  [1.07, 0.042],
  [0.98, 0.048],
  [0.86, 0.036],
  [0.74, -0.008],
  [0.62, -0.09],
  [0.5, -0.22],
  [0.36, -0.38],
  [0.04, -0.56],
];
const LIP_SHADE = [1, 1, 0.97, 0.8, 0.5, 0.2, 0.07, 0.025, 0.01, 0.004, 0.002];

/** The end of a neck that slides along a path of its own, every ring following its head, and that can turn at the very end. */
class SlidingNeck {
  readonly mesh: Mesh;
  /** Length of the path (m). */
  readonly end: number;
  private readonly step = 0.02;
  private readonly samples: number;
  private readonly frames: Float32Array;
  private readonly rings: number;
  private readonly around = 28;
  /** Where its mouth is now. */
  readonly mouth = new Vector3();
  private readonly back: Float32Array;
  private readonly axial: Float32Array;
  private readonly radius: Float32Array;
  private readonly shadeR: Float32Array;
  private readonly shadeA: Float32Array;
  private readonly oval: Float32Array;
  private readonly rel: Float32Array;
  private readonly ragged: Float32Array;
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  private readonly position: Float32Array;
  private readonly normal: Float32Array;
  private readonly bendLength = 0.46;
  private readonly bendFrom: number;

  constructor(points: readonly V3[], radius: number, trail: number, material: Material) {
    const curve = new CatmullRomCurve3(points.map((p) => new Vector3(p[0], p[1], p[2])));
    this.end = curve.getLength();
    this.samples = Math.ceil(this.end / this.step) + 1;
    this.frames = new Float32Array(this.samples * 12);
    const p = curve.getSpacedPoints(this.samples - 1);
    const t = new Vector3();
    const n = new Vector3(0.2, 1, 0.1).normalize();
    const b = new Vector3();
    for (let i = 0; i < this.samples; i++) {
      t.copy(p[Math.min(this.samples - 1, i + 1)]).sub(p[Math.max(0, i - 1)]).normalize();
      n.addScaledVector(t, -n.dot(t)).normalize();
      b.crossVectors(t, n);
      this.frames.set([p[i].x, p[i].y, p[i].z, t.x, t.y, t.z, n.x, n.y, n.z, b.x, b.y, b.z], i * 12);
    }
    this.bendFrom = this.end - this.bendLength;
    const ringStep = 0.05;
    const tube = Math.round(trail / ringStep);
    this.rings = tube + LIP.length;
    this.back = new Float32Array(this.rings);
    this.axial = new Float32Array(this.rings);
    this.radius = new Float32Array(this.rings);
    this.shadeR = new Float32Array(this.rings);
    this.shadeA = new Float32Array(this.rings);
    this.oval = new Float32Array(this.rings);
    for (let j = 0; j < tube; j++) {
      this.back[j] = (tube - 1 - j) * ringStep;
      this.radius[j] = radius * (1 + 0.1 * Math.min(1, this.back[j] / 1.5));
      this.oval[j] = Math.max(0, 1 - this.back[j] / 0.42);
    }
    for (let j = 0; j < LIP.length; j++) {
      this.axial[tube + j] = LIP[j][1];
      this.radius[tube + j] = radius * LIP[j][0];
      this.oval[tube + j] = 1;
    }
    for (let j = 0; j < this.rings; j++) {
      const before = Math.max(0, j - 1);
      const after = Math.min(this.rings - 1, j + 1);
      const dr = this.radius[after] - this.radius[before];
      const da = this.axial[after] - this.back[after] - (this.axial[before] - this.back[before]);
      const l = Math.hypot(dr, da) || 1;
      this.shadeR[j] = da / l;
      this.shadeA[j] = -dr / l;
    }
    const vertices = this.rings * (this.around + 1);
    this.cos = new Float32Array(this.around + 1);
    this.sin = new Float32Array(this.around + 1);
    this.rel = new Float32Array(vertices);
    this.ragged = new Float32Array(vertices);
    const uv = new Float32Array(vertices * 2);
    const color = new Float32Array(vertices * 3);
    const indices: number[] = [];
    for (let k = 0; k <= this.around; k++) {
      const a = (k / this.around) * Math.PI * 2 - Math.PI;
      this.cos[k] = Math.cos(a);
      this.sin[k] = Math.sin(a);
    }
    const rnd = randomFrom(71);
    for (let j = 0; j < this.rings; j++) {
      const lip = j - tube;
      const phase = rnd() * 6.28;
      for (let k = 0; k <= this.around; k++) {
        const v = j * (this.around + 1) + k;
        const a = (k / this.around) * Math.PI * 2 - Math.PI;
        this.rel[v] = lip < 0 ? relief(this.back[j], a) : 1 + 0.05 * Math.sin(a * 2 + 0.6) + 0.03 * Math.sin(a * 3 + 1.7 + phase * 0.02) + 0.012 * Math.sin(a * 5 + 0.3);
        this.ragged[v] = lip < 0 ? 0 : 0.012 * Math.sin(a * 2 + 1) * Math.min(1, lip / 3);
        uv[v * 2] = this.back[j] - this.axial[j];
        uv[v * 2 + 1] = k / this.around;
        const shade = lip < 0 ? 1 : LIP_SHADE[lip];
        color[v * 3] = shade;
        color[v * 3 + 1] = shade * (lip >= 0 ? 0.74 : 1);
        color[v * 3 + 2] = shade * (lip >= 0 ? 0.7 : 1);
        if (j < this.rings - 1 && k < this.around) {
          const c = v + this.around + 1;
          indices.push(v, v + 1, c, v + 1, c + 1, c);
        }
      }
    }
    this.position = new Float32Array(vertices * 3);
    this.normal = new Float32Array(vertices * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.position, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('normal', new BufferAttribute(this.normal, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geometry.setAttribute('color', new Float32BufferAttribute(color, 3));
    geometry.setIndex(indices);
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Puts its mouth `tip` meters along the path, its last part turned `bend` rad about the vertical, the lip breathing by `open`. */
  place(tip: number, bend: number, open: number): void {
    const f = this.frames;
    const { around, rings, rel, ragged, cos, sin, position, normal } = this;
    const pivot = Math.floor(this.bendFrom / this.step) * 12;
    const cosBend = Math.cos(bend);
    const sinBend = Math.sin(bend);
    for (let j = 0; j < rings; j++) {
      const s = Math.max(0, tip - this.back[j]);
      const i = Math.min(this.samples - 1, Math.floor(s / this.step)) * 12;
      let cx = f[i];
      const cy = f[i + 1];
      let cz = f[i + 2];
      let tx = f[i + 3];
      let tz = f[i + 5];
      let nx = f[i + 6];
      let nz = f[i + 8];
      let bx = f[i + 9];
      let bz = f[i + 11];
      const weight = clamp((s - this.bendFrom) / this.bendLength, 0, 1);
      if (weight > 0 && bend !== 0) {
        const w2 = weight * weight;
        const c = 1 + (cosBend - 1) * w2;
        const sn = sinBend * w2;
        const dx = cx - f[pivot];
        const dz = cz - f[pivot + 2];
        cx = f[pivot] + dx * c + dz * sn;
        cz = f[pivot + 2] - dx * sn + dz * c;
        let x = tx * c + tz * sn;
        tz = -tx * sn + tz * c;
        tx = x;
        x = nx * c + nz * sn;
        nz = -nx * sn + nz * c;
        nx = x;
        x = bx * c + bz * sn;
        bz = -bx * sn + bz * c;
        bx = x;
      }
      const ty = f[i + 4];
      const ny = f[i + 7];
      const by = f[i + 10];
      const a = this.axial[j];
      const r = this.radius[j] * (a !== 0 ? open : 1);
      const wide = 1 + 0.12 * this.oval[j];
      const flat = 1 - 0.14 * this.oval[j];
      if (a === 0 && j > 0 && this.back[j] === 0 && this.back[j - 1] > 0) this.mouth.set(cx, cy, cz);
      const nr = this.shadeR[j];
      const na = this.shadeA[j];
      for (let k = 0; k <= around; k++) {
        const v = j * (around + 1) + k;
        const dx2 = nx * cos[k] * wide + bx * sin[k] * flat;
        const dy2 = ny * cos[k] * wide + by * sin[k] * flat;
        const dz2 = nz * cos[k] * wide + bz * sin[k] * flat;
        const out = r * rel[v];
        const lead = a + ragged[v];
        position[v * 3] = cx + tx * lead + dx2 * out;
        position[v * 3 + 1] = cy + ty * lead + dy2 * out;
        position[v * 3 + 2] = cz + tz * lead + dz2 * out;
        normal[v * 3] = dx2 * nr + tx * na;
        normal[v * 3 + 1] = dy2 * nr + ty * na;
        normal[v * 3 + 2] = dz2 * nr + tz * na;
      }
    }
    const g = this.mesh.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('normal').needsUpdate = true;
  }
}

const HAIR_VERT = /* glsl */ `
${WARP_GLSL}
attribute float aSide;
attribute vec2 aHair;
attribute vec3 aTone;
uniform float uTime;
uniform float uWidth;
uniform float uSway;
varying vec3 vTone;
varying float vAlong;
varying float vDist;
void main() {
  vec3 p = position;
  float grow = aHair.x * aHair.x;
  p.x += grow * uSway * sin(uTime * 0.8 + aHair.y + aHair.x * 2.0);
  p.z += grow * uSway * cos(uTime * 0.63 + aHair.y * 1.7);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.x += aSide * uWidth * (1.0 - aHair.x * 0.75);
  vTone = aTone;
  vAlong = aHair.x;
  vDist = -mv.z;
  gl_Position = projectionMatrix * dreamWarp(mv);
}
`;
const HAIR_FRAG = /* glsl */ `
uniform float uLevel;
uniform float uFog;
uniform vec3 uFogColor;
varying vec3 vTone;
varying float vAlong;
varying float vDist;
void main() {
  float fog = exp(-uFog * uFog * vDist * vDist);
  vec3 c = vTone * mix(0.5, 1.0, smoothstep(0.0, 0.3, vAlong)) * uLevel;
  gl_FragColor = vec4(mix(uFogColor, c, fog), 1.0);
}
`;

/** Many strands of hair in one draw: unlit, their light worked out once for where each one hangs. */
class HairFall {
  private readonly positions: number[] = [];
  private readonly sides: number[] = [];
  private readonly hairs: number[] = [];
  private readonly tones: number[] = [];
  private readonly indices: number[] = [];

  strand(x: number, top: number, z: number, length: number, phase: number, tone: (x: number, y: number, z: number, out: number[]) => void, segments = 6, wave?: (along: number, out: number[]) => void): void {
    const base = this.positions.length / 3;
    const out = [0, 0, 0];
    const offset = [0, 0];
    for (let k = 0; k <= segments; k++) {
      const along = k / segments;
      const y = top - length * along;
      offset[0] = offset[1] = 0;
      wave?.(along, offset);
      tone(x, y, z, out);
      for (const side of [-1, 1]) {
        this.positions.push(x + offset[0], y, z + offset[1]);
        this.sides.push(side);
        this.hairs.push(along, phase);
        this.tones.push(out[0], out[1], out[2]);
      }
      if (k < segments) {
        const a = base + k * 2;
        this.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }

  mesh(uniforms: Record<string, { value: unknown }>): Mesh {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('aSide', new Float32BufferAttribute(this.sides, 1));
    geometry.setAttribute('aHair', new Float32BufferAttribute(this.hairs, 2));
    geometry.setAttribute('aTone', new Float32BufferAttribute(this.tones, 3));
    geometry.setIndex(this.indices);
    const material = new ShaderMaterial({ vertexShader: HAIR_VERT, fragmentShader: HAIR_FRAG, uniforms: { ...warpUniforms, ...uniforms }, side: DoubleSide });
    const m = new Mesh(geometry, material);
    m.frustumCulled = false;
    return m;
  }
}

const WATER_VERT = /* glsl */ `
${WARP_GLSL}
varying vec2 vRoom;
varying vec3 vView;
void main() {
  vRoom = position.xz;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * dreamWarp(mv);
}
`;
const WATER_FRAG = /* glsl */ `
uniform vec3 uRings[6];
uniform vec3 uSheen;
varying vec2 vRoom;
varying vec3 vView;
void main() {
  float h = 0.0;
  for (int i = 0; i < 6; i++) {
    vec3 r = uRings[i];
    if (r.z < 0.0) continue;
    float d = distance(vRoom, r.xy);
    float front = r.z * 0.62;
    float packet = exp(-r.z * 1.1) * smoothstep(front + 0.16, front, d) * smoothstep(front - 0.5, front - 0.05, d);
    h += sin((d - front) * 84.0) * packet;
  }
  float grazing = 1.0 - abs(vView.y);
  float alpha = mix(0.36, 0.13, grazing * grazing * grazing);
  vec3 c = uSheen * max(h, 0.0);
  gl_FragColor = vec4(c, clamp(alpha + abs(h) * 0.06, 0.0, 1.0));
}
`;

const FIRE_VERT = /* glsl */ `
${WARP_GLSL}
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * dreamWarp(modelViewMatrix * vec4(position, 1.0));
}
`;
const NOISE_GLSL = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}
`;
const FIRE_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform float uTime;
uniform float uLevel;
varying vec2 vUv;
void main() {
  vec2 p = vec2(vUv.x * 2.6, vUv.y * 1.9 - uTime * 0.75);
  float bend = fbm(p * 0.7 + vec2(uTime * 0.1, 0.0));
  float f = fbm(p + bend * 0.9);
  float h = 1.0 - vUv.y;
  float body = smoothstep(0.14, 0.92, f * 1.25 * h + h * h * 0.65);
  vec3 c = mix(vec3(0.7, 0.07, 0.0), vec3(1.0, 0.42, 0.04), body);
  c = mix(c, vec3(1.0, 0.82, 0.42), smoothstep(0.66, 1.0, body));
  gl_FragColor = vec4(c * (0.55 + 1.9 * body) * uLevel, body);
}
`;

const SMOKE_VERT = /* glsl */ `
${WARP_GLSL}
varying vec2 vRoom;
void main() {
  vRoom = position.xz;
  gl_Position = projectionMatrix * dreamWarp(modelViewMatrix * vec4(position, 1.0));
}
`;
const SMOKE_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform float uDrift;
uniform float uReach;
uniform float uLevel;
uniform float uGlow;
uniform vec2 uDoor;
uniform vec3 uTint;
varying vec2 vRoom;
void main() {
  float along = abs(vRoom.y - uDoor.y);
  float n = fbm(vec2(vRoom.x * 1.3 + vRoom.y * 0.2, along * 0.75 - uDrift));
  float cover = smoothstep(uReach, uReach * 0.3, along) * smoothstep(-1.4, 0.6, vRoom.x);
  float a = cover * smoothstep(0.34, 0.82, n);
  vec3 warm = vec3(0.2, 0.08, 0.026) * uGlow * smoothstep(5.0, 0.3, along);
  gl_FragColor = vec4(uTint + warm, a * uLevel);
}
`;

/**
 * The corridor of the evenings: damp wallpaper, dark wainscot, a checkered floor, one lamp on one small table
 * and on it the clock that always says half past. A man with no head waits at the far end, and his neck has
 * come a long way to meet you. The viewer returns six times. Every time it is this corridor, and it is worse.
 */
export default class Corridor extends Room {
  keys: readonly RoomKey[] = [];
  air: RoomAir = { fog: { color: 0x070c0b, density: 0.05 }, env: 'bathroom', envIntensity: 0.05, sky: 0, grade: { exposure: 1.25, saturation: 0.74, warmth: 0.02, tint: -0.02, flare: 0.002 } };
  film: RoomFilm = { bloom: 0.9, bloomFrom: 0.7, grain: 0.42, scratches: 0.06, flicker: 0.03, weave: 0.0005 };
  focus = 7;
  aperture = 5;
  control: RoomControl = FREE;

  /** Everything that is the corridor itself and stands still: it can be leaned or mirrored whole. */
  private readonly set = new Group();
  private readonly clocks: { value: number }[] = [];
  private readonly lamps: Lamp[] = [];
  private readonly neckClock = { value: 0 };
  private readonly neckBreath = { value: 0 };
  private readonly fill: DreamLight;
  private readonly skin: MeshStandardMaterial;
  private readonly soft = softRound();
  private readonly doorPaint: MeshStandardMaterial;
  private readonly act: Update;
  private path!: Walk;
  /** The lean of the last evening (rad). */
  private tilt = 0;
  private lampLevel = 1;
  /** A visit may need its lamp stronger than the others (the water takes half). */
  private lampBoost = 1;
  private strides = 0;
  private hum: RoomVoice | null = null;
  private tick: RoomVoice | null = null;
  private draft: RoomVoice | null = null;

  constructor(ctx: RoomContext) {
    super(ctx);
    this.root.add(this.set);
    const { map, bump } = skinMaps();
    this.skin = new MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 1.1, roughness: 0.46, metalness: 0, vertexColors: true, emissive: new Color(0xaeb2a8), emissiveMap: map, emissiveIntensity: 0.05 });
    this.skin.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uNeckTime = this.neckClock;
      shader.uniforms.uNeckBreath = this.neckBreath;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uNeckTime;\nuniform float uNeckBreath;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed += objectNormal * uNeckBreath * (0.5 + 0.5 * sin(uv.x * 1.6 - uNeckTime * 1.2));`,
      );
      // a body is darker toward its edges than a pipe is
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance *= vColor.rgb;`).replace('#include <opaque_fragment>', `outgoingLight *= mix(0.16, 1.0, pow(clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 0.8));
#include <opaque_fragment>`);
    };
    this.skin.customProgramCacheKey = () => 'corridor-neck';
    this.doorPaint = (this.build.wood() as MeshStandardMaterial).clone();
    this.doorPaint.color.setRGB(0.92, 0.84, 0.78);
    this.doorPaint.roughness = 0.5;
    this.fill = this.light([0, EYE, 0], FILL_COLOR, FILL[this.visit - 1], FILL_REACH);
    const acts = [this.first, this.second, this.third, this.fourth, this.fifth, this.sixth];
    this.act = acts[this.visit - 1].call(this);
    this.keys = this.path.keys;
    const line = LINES[this.visit - 1];
    if (line) this.beat(line.at, () => this.say({ tr: line.tr, en: line.en }, 5));
    this.clocks.push(this.build.motes(120, { x: [-W / 2, W / 2], y: [0.1, H], z: [-46, 0] }, this.root, { size: 0.006 }).time);
  }

  /** The hum, the tick from the side where the table is, the draught: what is always there. */
  private beds(side: Side, tickGain = 0.07): void {
    this.beat(0, () => {
      this.hum = this.sound.bed('rooms/fluorescent_hum.mp3', { gain: 0.1 });
      this.tick = this.sound.bed('rooms/clock_tick.mp3', { gain: tickGain, pan: side * 0.55 });
      this.draft = this.sound.bed('rooms/draft_drone.mp3', { gain: 0.08 });
      this.sound.bed('rooms/dream_drone_low.mp3', { gain: 0.07 });
    });
  }

  /** Someone's foot behind you, once, after yours have stopped. */
  private someone(second: number, gain = 0.3): void {
    this.beat(second, () => this.sound.play(`rooms/wet_step_${(this.visit % 2) + 1}.mp3`, { gain, lowpass: 2300, reverb: 0.35, pan: -0.08 }));
  }

  /** The radiator, ticking as it cools, off to the right. */
  private radiatorTicks(...seconds: number[]): void {
    for (const [i, at] of seconds.entries()) {
      this.beat(at, () => this.sound.play(i % 2 ? 'rooms/fluorescent_tick_3.mp3' : 'rooms/fluorescent_tick_1.mp3', { gain: 0.1, pan: 0.5, lowpass: 2200, reverb: 0.12 }));
    }
  }

  /** The door at the end coming open as you near it. */
  private endCreak(second: number): void {
    this.beat(second, () => this.sound.play('rooms/door_creak_slow.mp3', { gain: 0.36, reverb: 0.4, lowpass: 2400 }));
  }

  /**
   * The last seconds of an evening that breaks off here (2, 3 and 5): the far door opens by itself, `open` rad by
   * the cut and still moving, on the warm room of the dinner, its cutlery and its clock; the cold tube by the door
   * gives way to it. Returns what moves it.
   */
  private dinnerBehind(end: LiveDoor, far: number, open: number, floor: boolean, cold: Tube): (s: number) => void {
    const from = this.seconds - AJAR.last;
    // it gathers way, and is still gathering it when the picture cuts away
    const angle = (s: number) => {
      const u = range(from, this.seconds, s);
      return (open * u * u * (3 - u)) / 2;
    };
    // the far wall of the dining room in its lamplight: only ever seen through the gap
    const wall = new MeshBasicMaterial({ map: dinnerWall(), color: 0x000000, fog: false });
    const room = new Mesh(new PlaneGeometry(2 * HALF, DOOR_TOP), wall);
    room.position.set(0, DOOR_TOP / 2, far - RECESS + 0.04);
    room.frustumCulled = false;
    this.set.add(room);
    const halo = this.build.glow(0, DOOR_TOP / 2, far + 0.15, 1, PALETTE.warm, 0, this.root, 2);
    halo.scale.set(AJAR.glowSize[0], AJAR.glowSize[1], 1);
    const haze = (halo.material as ShaderMaterial).uniforms.uColor.value as Color;
    const spill = this.light([SLAB, 0.9, far + 0.45], PALETTE.warm, 0, AJAR.spillReach);
    const coldHaze = (cold.halo.material as ShaderMaterial).uniforms.uColor.value as Color;
    let blade: { mesh: Mesh; look: MeshBasicMaterial } | null = null;
    if (floor) {
      const look = new MeshBasicMaterial({ map: lightBlade(), color: 0x000000, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
      const mesh = new Mesh(new PlaneGeometry(1, AJAR.bladeLength), look);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, 0.014, far + AJAR.bladeLength / 2);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.root.add(mesh);
      blade = { mesh, look };
    }
    // a narrow gap lets less of the room through, and less of its highs
    const muffle = AJAR.muffle[0] + AJAR.muffle[1] * (1 - Math.cos(open));
    let dinner: RoomVoice | null = null;
    this.beat(from, () => {
      this.sound.play(open < AJAR.short ? 'rooms/door_creak_short.mp3' : 'rooms/door_creak_slow.mp3', { gain: 0.36, reverb: 0.4, lowpass: 2400, pan: 0.1 });
      dinner = this.sound.bed('rooms/cutlery_far.mp3', { gain: 0, lowpass: muffle, reverb: 0.4, pan: 0.12 });
      // the corridor's own clock and hum give way to what is behind the door
      this.tick?.gain(0, 1);
      this.hum?.gain(0.05, 2);
    });
    for (let at = from + AJAR.tockFirst; at < this.seconds; at += AJAR.tockEvery) {
      const heard = Math.sqrt(1 - Math.cos(angle(at)));
      this.beat(at, () => this.sound.play('rooms/clock_tock_far.mp3', { gain: AJAR.tock * (0.3 + 0.7 * heard), lowpass: muffle, reverb: 0.5, pan: 0.12 }));
    }
    return (s) => {
      const a = angle(s);
      end.leaf.rotation.y = end.sign * a;
      // the gap as seen from the front: from the leaf's free edge to the jamb, a share of the doorway
      const edge = -SLAB + 2 * SLAB * Math.cos(a);
      const share = 1 - Math.cos(a);
      const gapX = (edge + SLAB) / 2;
      const on = smooth(from, from + 0.3, s);
      wall.color.setScalar(AJAR.wall * on);
      halo.position.x = gapX;
      haze.setHex(PALETTE.warm).multiplyScalar(AJAR.glow * Math.sqrt(share));
      this.world(gapX, 0.9, far + 0.45, spill.position);
      spill.intensity = AJAR.spill * share;
      dinner?.gain(AJAR.cutlery * on * (0.25 + 0.75 * Math.sqrt(share)));
      const left = cold.strength * (1 - AJAR.coldGives * smooth(from, this.seconds, s));
      cold.glow.color.setHex(PALETTE.cold).multiplyScalar(4 * left);
      cold.point.intensity = COLD_POINT * left;
      cold.spot.intensity = COLD_SPOT * left;
      coldHaze.setHex(PALETTE.cold).multiplyScalar(TUBE_HALO * left);
      if (blade) {
        blade.mesh.position.x = gapX;
        blade.mesh.scale.x = Math.max(0.001, (SLAB - edge) * AJAR.bladeSpread);
        blade.look.color.setHex(PALETTE.warm).multiplyScalar(AJAR.blade * on);
      }
    };
  }

  /** Walls with holes in them for the doors, the wainscot, the floor and the dirt on all of it. */
  private shell(o: { near: number; far: number; doors: readonly DoorSpec[]; colors: readonly [string, string]; floor: boolean; runner: boolean; closeNear?: boolean }): Material {
    const { near, far, doors } = o;
    const b = this.build;
    const kit = this.kit;
    const paper = b.damask(o.colors);
    const walls = new Sheets();
    const dirt = new Sheets();
    const backs = new Sheets();
    const wood: BufferGeometry[] = [];
    const paperU = (s: number): UV => (_x, y, z) => [s * z, y];
    const dirtU = (s: number): UV => (_x, y, z) => [(s * z) / GRIME_TILE + (s > 0 ? 0.37 : 0), y / H];
    const wainscot = (cx: number, cz: number, yaw: number, length: number) => {
      const piece = (w: number, h: number, d: number, px: number, py: number, pz: number) => wood.push(meterUVs(new BoxGeometry(w, h, d).translate(px, py, pz).rotateY(yaw).translate(cx, 0, cz)));
      const panels = Math.max(1, Math.round(length / 0.62));
      const step = length / panels;
      piece(length, WAIN, 0.012, 0, WAIN / 2, 0.006);
      piece(length, 0.16, 0.035, 0, 0.08, 0.018);
      piece(length, 0.06, 0.05, 0, WAIN - 0.03, 0.025);
      piece(length, 0.05, 0.03, 0, WAIN * 0.5, 0.015);
      for (let i = 0; i <= panels; i++) piece(0.06, WAIN - 0.1, 0.028, -length / 2 + i * step, WAIN / 2, 0.014);
    };
    for (const side of [-1, 1] as const) {
      const x = (side * W) / 2;
      const yaw = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      const u = paperU(side < 0 ? -1 : 1);
      const du = dirtU(side < 0 ? -1 : 1);
      const span = (z0: number, z1: number, y0: number, y1: number) => {
        const a: V3 = side < 0 ? [0, 0, z1 - z0] : [0, 0, z0 - z1];
        const zStart = side < 0 ? z0 : z1;
        walls.add([x, y0, zStart], a, [0, y1 - y0, 0], u);
        dirt.add([x - side * 0.002, y0, zStart], a, [0, y1 - y0, 0], du);
      };
      const cuts = doors.filter((d) => d.side === side).map((d) => d.z).sort((p, q) => q - p);
      let from = near;
      for (const c of cuts) {
        span(from, c + HALF, 0, H);
        wainscot(x, (from + c + HALF) / 2, yaw, from - (c + HALF));
        span(c + HALF, c - HALF, DOOR_TOP, H);
        this.recess(backs, side, c);
        from = c - HALF;
      }
      span(from, far, 0, H);
      wainscot(x, (from + far) / 2, yaw, from - far);
    }
    const endU: UV = (px, py) => [px, py];
    const endDirt: UV = (px, py) => [px / GRIME_TILE, py / H];
    const piece = (x0: number, x1: number, y0: number, y1: number) => {
      walls.add([x0, y0, far], [x1 - x0, 0, 0], [0, y1 - y0, 0], endU);
      dirt.add([x0, y0, far + 0.002], [x1 - x0, 0, 0], [0, y1 - y0, 0], endDirt);
    };
    piece(-W / 2, -HALF, 0, H);
    piece(HALF, W / 2, 0, H);
    piece(-HALF, HALF, DOOR_TOP, H);
    wainscot(-(W / 2 + HALF) / 2, far, 0, W / 2 - HALF);
    wainscot((W / 2 + HALF) / 2, far, 0, W / 2 - HALF);
    if (o.closeNear !== false) {
      walls.add([W / 2, 0, near], [-W, 0, 0], [0, H, 0], endU);
      dirt.add([W / 2, 0, near - 0.002], [-W, 0, 0], [0, H, 0], endDirt);
      wainscot(0, near, Math.PI, W);
    }
    // what lies behind the end door
    const flat: UV = (px, _y, pz) => [px, pz];
    backs.add([-HALF, 0, far], [2 * HALF, 0, 0], [0, 0, -RECESS], flat, 2, [0, 1, 0]);
    backs.add([-HALF, DOOR_TOP, far], [2 * HALF, 0, 0], [0, 0, -RECESS], flat, 2, [0, -1, 0]);
    backs.add([-HALF, 0, far - RECESS], [2 * HALF, 0, 0], [0, DOOR_TOP, 0], flat, 2, [0, 0, 1]);
    backs.add([-HALF, 0, far], [0, 0, -RECESS], [0, DOOR_TOP, 0], flat, 2, [1, 0, 0]);
    backs.add([HALF, 0, far], [0, 0, -RECESS], [0, DOOR_TOP, 0], flat, 2, [-1, 0, 0]);
    this.set.add(walls.mesh(paper));
    const stain = new MeshBasicMaterial({ map: wallGrime(20 + this.visit * 3), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.set.add(dirt.mesh(stain));
    this.set.add(backs.mesh(new MeshStandardMaterial({ color: 0x07080a, roughness: 1 })));
    const panels = new Mesh(mergeGeometries(wood)!, b.wood());
    panels.frustumCulled = false;
    panels.receiveShadow = true;
    this.set.add(panels);
    const ceilingMat = kit.floor(-W / 2, W / 2, far, near, H, b.ceiling(0.6));
    ceilingMat.rotation.x = Math.PI / 2;
    this.set.add(ceilingMat);
    const stains = new Sheets();
    stains.add([-W / 2, H - 0.003, near], [W, 0, 0], [0, 0, far - near], (px, _y, pz) => [px / W + 0.5, pz / 12], 1, [0, -1, 0]);
    this.set.add(stains.mesh(new MeshBasicMaterial({ map: ceilingStains(), transparent: true, depthWrite: false })));
    if (o.floor) {
      this.set.add(kit.floor(-W / 2, W / 2, far, near, 0, b.checker(0.5)));
      const margin = new Sheets();
      margin.add([-W / 2, 0.003, near], [W, 0, 0], [0, 0, far - near], (px, _y, pz) => [px / W + 0.5, pz / 10], 1, [0, 1, 0]);
      this.set.add(margin.mesh(new MeshBasicMaterial({ map: floorDirt(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
    }
    if (o.runner) {
      const strip = new Sheets();
      const half = 0.47;
      strip.add([-half, 0.007, near - 0.4], [2 * half, 0, 0], [0, 0, far + 0.6 - near + 0.4], (px, _y, pz) => [(px + half) / (2 * half), pz / 4], 1, [0, 1, 0]);
      const mat = new MeshStandardMaterial({ map: runnerMap(), roughness: 0.96 });
      this.set.add(strip.mesh(mat));
    }
    return paper;
  }

  /** The black room behind a side door. */
  private recess(into: Sheets, side: Side, z: number): void {
    const x0 = (side * W) / 2;
    const x1 = side * (W / 2 + RECESS);
    const zn = z + HALF;
    const zf = z - HALF;
    const flat: UV = (px, _y, pz) => [px, pz];
    into.add([x0, 0, zn], [x1 - x0, 0, 0], [0, 0, zf - zn], flat, 2, [0, 1, 0]);
    into.add([x0, DOOR_TOP, zn], [x1 - x0, 0, 0], [0, 0, zf - zn], flat, 2, [0, -1, 0]);
    into.add([x1, 0, zn], [0, 0, zf - zn], [0, DOOR_TOP, 0], flat, 2, [-side, 0, 0]);
    into.add([x0, 0, zn], [x1 - x0, 0, 0], [0, DOOR_TOP, 0], flat, 2, [0, 0, -1]);
    into.add([x0, 0, zf], [x1 - x0, 0, 0], [0, DOOR_TOP, 0], flat, 2, [0, 0, 1]);
  }

  /** Frames, leaves and knobs: those that never move baked into one mesh each, the others (`live`) with hinges of their own. */
  private hangDoors(doors: readonly DoorSpec[]): Map<DoorSpec, LiveDoor> {
    const kit = this.kit;
    const live = new Map<DoorSpec, LiveDoor>();
    const frames: Matrix4[] = [];
    const leaves: Matrix4[] = [];
    const knobs: Matrix4[] = [];
    const turn = new Matrix4();
    const slide = new Matrix4();
    for (const d of doors) {
      const heading = d.side < 0 ? Math.PI / 2 : -Math.PI / 2;
      const base = new Matrix4().makeRotationY(heading).setPosition((d.side * W) / 2, 0, d.z);
      frames.push(new Matrix4().makeTranslation(0, 0, 0.012).premultiply(base));
      // local +X runs away from the viewer on the left wall and toward him on the right
      const hingeX = (d.hinge === 'near') === d.side < 0 ? -SLAB : SLAB;
      const sign = hingeX < 0 ? 1 : -1;
      if (d.live) {
        const pivot = new Group();
        pivot.applyMatrix4(base);
        const leaf = new Group();
        leaf.name = d.name ?? '';
        leaf.position.set(hingeX, 0, -0.03);
        leaf.rotation.y = sign * d.swing;
        kit.paint(kit.prop('door_six', [sign * SLAB, 0, 0], { castShadow: true }, leaf), this.doorPaint);
        kit.prop('door_knob', [sign * (SLAB + 0.34), 0.96, 0], {}, leaf);
        pivot.add(leaf);
        this.set.add(pivot);
        live.set(d, { leaf, sign });
      } else {
        turn.makeRotationY(sign * d.swing).setPosition(hingeX, 0, -0.03);
        leaves.push(base.clone().multiply(turn).multiply(slide.makeTranslation(sign * SLAB, 0, 0)));
        knobs.push(base.clone().multiply(turn).multiply(slide.makeTranslation(sign * (SLAB + 0.34), 0.96, 0)));
      }
    }
    this.set.add(this.bake('door_frame', frames, this.build.wood()));
    if (leaves.length) this.set.add(this.bake('door_six', leaves, this.doorPaint, true), this.bake('door_knob', knobs));
    return live;
  }

  /** One model many times over in one mesh and one plain material (`material` defaults to the model's own). */
  private bake(key: string, matrices: readonly Matrix4[], material?: Material, castShadow = false): Mesh {
    const source = this.kit.prop(key, [0, 0, 0]);
    source.updateMatrixWorld(true);
    const parts: BufferGeometry[] = [];
    let own: Material | null = null;
    source.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      own = mesh.material as Material;
      parts.push(plainGeometry(mesh.geometry).applyMatrix4(mesh.matrixWorld));
    });
    const one = parts.length > 1 ? mergeGeometries(parts)! : parts[0];
    const baked = new Mesh(mergeGeometries(matrices.map((m) => one.clone().applyMatrix4(m)))!, material ?? own!);
    baked.frustumCulled = false;
    baked.castShadow = castShadow;
    baked.receiveShadow = true;
    return baked;
  }

  /** The door at the end of the corridor, in its frame: it opens away from you. */
  private endDoor(far: number): LiveDoor {
    const kit = this.kit;
    kit.paint(kit.prop('door_frame', [0, 0, far + 0.012], {}, this.set), this.build.wood());
    const leaf = new Group();
    leaf.name = 'end-door';
    leaf.position.set(-SLAB, 0, far - 0.03);
    kit.paint(kit.prop('door_six', [SLAB, 0, 0], { castShadow: true }, leaf), this.doorPaint);
    kit.prop('door_knob', [SLAB + 0.34, 0.96, 0], {}, leaf);
    this.set.add(leaf);
    return { leaf, sign: 1 };
  }

  private closedDoors(near: number, far: number): DoorSpec[] {
    const list: DoorSpec[] = [];
    for (const z of LEFT_DOORS) if (z < near - 1.2 && z > far + 1.6) list.push({ side: -1, z, swing: 0, hinge: 'near' });
    for (const z of RIGHT_DOORS) if (z < near - 1.2 && z > far + 1.6) list.push({ side: 1, z, swing: 0, hinge: 'near' });
    return list;
  }

  /** A point of the corridor where the last evening's lean has put it. */
  private leaned(p: V3): V3 {
    if (this.tilt === 0) return p;
    const c = Math.cos(this.tilt);
    const s = Math.sin(this.tilt);
    const y = p[1] - EYE;
    return [p[0] * c + y * s, EYE - p[0] * s + y * c, p[2]];
  }

  /** The one small table, its lamp and the clock. */
  private lamp(side: Side, z: number, parent: Object3D): Lamp {
    const b = this.build;
    const kit = this.kit;
    const root = new Group();
    parent.add(root);
    const x = side * (W / 2 - 0.31);
    kit.prop('side_table', [x, 0, z], { scale: TABLE_SCALE, castShadow: true }, root);
    b.contactShadow(x, z, 0.44, root, 0.8);
    const brass = new MeshStandardMaterial({ color: 0x51401f, roughness: 0.42, metalness: 0.9 });
    const stemPoints = [[0, 0], [0.074, 0], [0.076, 0.012], [0.042, 0.032], [0.03, 0.062], [0.05, 0.13], [0.064, 0.19], [0.05, 0.255], [0.022, 0.3], [0.013, 0.33], [0.013, 0.41], [0, 0.42]].map(([u, v]) => new Vector2(u, v));
    const lx = x + side * 0.05;
    const lz = z - 0.03;
    const stem = new Mesh(new LatheGeometry(stemPoints, 22), brass);
    stem.position.set(lx, TABLE_TOP, lz);
    stem.castShadow = true;
    stem.frustumCulled = false;
    root.add(stem);
    const shadeY = TABLE_TOP + 0.3;
    const cloth = pleats();
    const shade = new MeshStandardMaterial({ color: 0x8f8268, roughness: 0.95, emissive: new Color(PALETTE.warm), emissiveMap: cloth, emissiveIntensity: SHADE_GLOW });
    const bell = new Mesh(new LatheGeometry([[0.205, 0], [0.198, 0.06], [0.165, 0.17], [0.112, 0.262]].map(([u, v]) => new Vector2(u, v)), 36), shade);
    bell.position.set(lx, shadeY, lz);
    bell.frustumCulled = false;
    root.add(bell);
    const at: V3 = [lx, shadeY + 0.1, lz];
    const lit = this.leaned(at);
    const below = this.leaned([lx - side * 0.1, 0, lz]);
    const above = this.leaned([lx + side * 0.02, H, lz]);
    const point = this.light(lit, PALETTE.warm, LAMP_POINT, LAMP_REACH);
    const down = this.spot(lit, below, PALETTE.warm, LAMP_DOWN, 64, 0.5);
    const up = this.spot(lit, above, PALETTE.warm, LAMP_UP, 44, 0.42);
    b.glow(at[0], at[1], at[2], 0.95, PALETTE.warm, 0.24, root, 3);
    const beam = b.beam(at[0], at[1] + 0.02, at[2], 0.2, 0.86, 0.96, PALETTE.warm, 0.08, root).material as ShaderMaterial;
    this.floorSheen(x - side * 0.14, z + 0.1, 1.1, 3.2, PALETTE.warm, 0.13, root);
    const clock = this.clockOn(x - side * 0.1, TABLE_TOP, z + 0.13, -side * 0.28, root);
    const made: Lamp = { root, at, point, down, up, shade, spiral: clock.spiral, beam, secondHand: clock.second, secondRest: clock.second.rotation.z, side };
    this.lamps.push(made);
    return made;
  }

  /** The real alarm clock, set to half past six, with the burning spiral for a face. */
  private clockOn(x: number, y: number, z: number, heading: number, parent: Object3D): { spiral: MeshStandardMaterial; second: Object3D } {
    const clock = this.kit.prop('alarm_clock', [x, y, z], {}, parent);
    clock.updateWorldMatrix(true, true);
    const axles: Object3D[] = [];
    const setHand = (name: string, rest: number, angle: number) => {
      const hand = clock.getObjectByName(name)!;
      const axle = new Object3D();
      axle.position.set(0, 0.0646, 0);
      hand.parent!.add(axle);
      axle.updateWorldMatrix(true, false);
      axle.attach(hand);
      axle.rotation.z = rest - angle;
      axles.push(axle);
      return hand;
    };
    const minute = setHand('minute_hand', 5.2257, Math.PI);
    setHand('houd_hand', 2.7724, (6.5 / 6) * Math.PI);
    setHand('second_hand', 0.4136, 0.7);
    clock.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(minute);
    const center = new Vector3();
    axles[0].getWorldPosition(center);
    const reach = Math.hypot(Math.max(Math.abs(box.max.x - center.x), Math.abs(box.min.x - center.x)), Math.max(Math.abs(box.max.y - center.y), Math.abs(box.min.y - center.y)));
    const spiral = new MeshStandardMaterial({ color: 0x000000, roughness: 0.4, emissive: new Color(0xff7a1e), emissiveMap: spiralFace(), emissiveIntensity: SPIRAL_GLOW });
    const face = new Mesh(new CircleGeometry(reach * 1.08, 40), spiral);
    const inWorld = new Vector3(center.x, center.y, box.min.z - 0.0012);
    face.position.copy(clock.worldToLocal(inWorld.clone()));
    face.frustumCulled = false;
    clock.add(face);
    clock.rotation.y = heading;
    return { spiral, second: axles[2] };
  }

  /** A sheen of light lying on the waxed floor. */
  private floorSheen(x: number, z: number, wide: number, long: number, color: number, strength: number, parent: Object3D): MeshBasicMaterial {
    const material = new MeshBasicMaterial({ map: this.soft, color: new Color(color).multiplyScalar(strength), transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
    const m = new Mesh(new PlaneGeometry(wide, long), material);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.012, z);
    m.frustumCulled = false;
    m.renderOrder = 2;
    parent.add(m);
    return material;
  }

  /** The tube's cold light, far away. */
  private tube(z: number, parent: Object3D, strength = 1): Tube {
    const kit = this.kit;
    const fixture = kit.prop('tube_light', [0, H, z], { anchor: 'top' }, parent);
    const glow = new MeshBasicMaterial({ color: new Color(PALETTE.cold).multiplyScalar(4 * strength) });
    (fixture.getObjectByName('tube') as Mesh).material = glow;
    const point = this.light(this.leaned([0, H - 0.3, z]), PALETTE.cold, COLD_POINT * strength, COLD_REACH);
    const spot = this.spot(this.leaned([0, H - 0.08, z]), this.leaned([0, 0, z + 0.8]), PALETTE.cold, COLD_SPOT * strength, 48, 0.62);
    const halo = this.build.glow(0, H - 0.2, z, 3.4, PALETTE.cold, TUBE_HALO * strength, parent);
    return { glow, point, spot, halo, strength };
  }

  /** The radiator that ticks, one strip of paper hanging off the wall, a pair of shoes nobody came back for. */
  private dress(paper: Material, strip = true): void {
    const b = this.build;
    const kit = this.kit;
    kit.prop('radiator', [W / 2 - 0.15, 0, -2.75], { rotation: [0, 90, 0], castShadow: true }, this.set);
    b.contactShadow(W / 2 - 0.16, -2.75, 0.75, this.set, 0.7);
    if (!strip) return;
    const z = -6.45;
    const x = W / 2 - 0.0035;
    const patch = new Mesh(new PlaneGeometry(0.56, 1.55), new MeshStandardMaterial({ map: barePlaster(), transparent: true, roughness: 1, depthWrite: false }));
    patch.position.set(x, 1.86, z);
    patch.rotation.y = -Math.PI / 2;
    patch.frustumCulled = false;
    patch.receiveShadow = true;
    this.set.add(patch);
    const across = 12;
    const down = 34;
    const length = 1.5;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let j = 0; j <= down; j++) {
      const along = j / down;
      for (let i = 0; i <= across; i++) {
        const u = i / across - 0.5;
        const curl = Math.pow(smooth(0.1, 1, along), 1.3) * 2.3 + u * 0.6 * along;
        let y = 2.62;
        let out = 0;
        for (let k = 0; k < j; k++) {
          const a = Math.pow(smooth(0.1, 1, k / down), 1.3) * 2.3 + u * 0.6 * (k / down);
          y -= (length / down) * Math.cos(a);
          out += (length / down) * Math.sin(a);
        }
        positions.push(W / 2 - 0.006 - out * (0.5 + 0.1 * u) - curl * 0.004, y, z - u * 0.5);
        uvs.push(z - u * 0.5, y);
      }
    }
    for (let j = 0; j < down; j++) {
      for (let i = 0; i < across; i++) {
        const p = j * (across + 1) + i;
        indices.push(p, p + 1, p + across + 1, p + 1, p + across + 2, p + across + 1);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const front = new Mesh(geometry, (paper as MeshStandardMaterial).clone());
    (front.material as MeshStandardMaterial).side = FrontSide;
    const flipped = geometry.clone();
    const n = flipped.getAttribute('normal');
    for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    const order = flipped.getIndex()!.array;
    const backward: number[] = [];
    for (let i = 0; i < order.length; i += 3) backward.push(order[i], order[i + 2], order[i + 1]);
    flipped.setIndex(backward);
    const reverse = new Mesh(flipped, new MeshStandardMaterial({ color: 0x8d8574, roughness: 1 }));
    for (const m of [front, reverse]) {
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
      this.set.add(m);
    }
  }

  /** The pictures the shutter has kept: as many as there are, a few of them crooked, each under its own dim light. */
  private hang(far: number, doors: readonly DoorSpec[], step = 1, from = 0): void {
    const b = this.build;
    const glow = new Sheets();
    this.album.pictures.forEach((picture, i) => {
      if (i < from) return;
      const side = i % 2 === 0 ? -1 : 1;
      let z = -1.6 - Math.floor(i / 2) * PRINT_STEP * step;
      for (const d of doors) if (d.side === side && Math.abs(d.z - z) < 0.68) z = d.z + 0.72;
      if (z < far + 2) return;
      const print = b.print(this.album.texture(picture));
      print.position.set((side * W) / 2 - side * 0.012, PRINT_Y + ((i * 13) % 5) * 0.03, z);
      print.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      print.rotation.z = i % 5 === 2 ? (i % 2 ? 0.17 : -0.22) : ((i * 17) % 7) * 0.006 - 0.018;
      const image = print.children[1] as Mesh;
      const look = image.material as MeshStandardMaterial;
      look.emissive.setScalar(1);
      look.emissiveMap = look.map;
      look.emissiveIntensity = 0.3;
      this.set.add(print);
      const x = (side * W) / 2 - side * 0.006;
      const size = 0.56;
      glow.add([x, print.position.y - size / 2 + 0.06, z + (side < 0 ? size / 2 : -size / 2)], [0, 0, side < 0 ? -size : size], [0, size, 0], (_x, y, z2) => [(side < 0 ? z + size / 2 - z2 : z2 - z + size / 2) / size, (y - print.position.y + size / 2 - 0.06) / size], 1);
    });
    if (this.album.pictures.length > from) {
      const mesh = glow.mesh(new MeshBasicMaterial({ map: this.soft, color: new Color(0xd9cdb6).multiplyScalar(0.05), transparent: true, depthWrite: false, blending: AdditiveBlending }));
      mesh.renderOrder = 2;
      this.set.add(mesh);
    }
  }

  /** A pair of men's bodies baked into one crowd, each on a soft dark round. */
  private men(list: readonly (readonly [number, number, number])[], parent: Object3D, bleach = SUIT_BLEACH): void {
    const crowd = this.build.headless(list.length, { tint: SUIT_TINT, bleach });
    list.forEach(([x, z, heading], i) => {
      crowd.set(i, x, 0, z, heading);
      this.build.contactShadow(x, z, 0.62, parent, 0.82);
    });
    crowd.commit();
    parent.add(crowd.root);
    this.plug(list.map(([x, z]) => [x, z] as const), parent);
  }

  /** A black inside to an empty collar. */
  private plug(list: readonly (readonly [number, number])[], parent: Object3D): void {
    const plug = new Mesh(mergeGeometries(list.map(([x, z]) => new SphereGeometry(1, 12, 8).scale(0.2, 0.036, 0.125).translate(x, 1.478, z)))!, new MeshBasicMaterial({ color: 0x030303 }));
    plug.frustumCulled = false;
    parent.add(plug);
  }

  private neck(points: readonly V3[], radius: number, taper: number, parent: Object3D, perMeter = 12, around = 12): Mesh {
    const mesh = new Mesh(neckGeometry(points, radius, taper, perMeter, around), this.skin);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /** How the walk itself sounds: yours, once per stride. */
  private stepping(frame: RoomFrame): void {
    const stride = Math.floor(this.path.walked.at(frame.seconds) / STRIDE);
    if (stride <= this.strides) return;
    this.strides = stride;
    const pan = stride % 2 ? 0.1 : -0.1;
    if (this.visit === 5) this.sound.play(`rooms/wade_step_${(stride % 5) + 1}.mp3`, { gain: 0.3, pan, reverb: 0.2 });
    else this.sound.play(`rooms/floor_step_near_${(stride % 3) + 1}.mp3`, { gain: 0.2, pan, lowpass: 2600, reverb: 0.16 });
  }

  /** Evening one. A very long corridor, a man far off, his neck over your head; he stays the same size. */
  private first(): Update {
    const { rows, man, size, dip, behind: behindAt, lampZ, secondLampZ } = ONE;
    const near = 34;
    const far = -56;
    const doors = this.closedDoors(near, far);
    doors.forEach((d) => {
      if (d.side === -1 && d.z === -12) d.swing = 0.1;
    });
    this.air = { fog: { color: 0x050909, density: 0.018 }, env: 'bathroom', envIntensity: 0.05, sky: 0, grade: { exposure: 1.3, saturation: 0.72, warmth: 0.02, tint: -0.02, flare: 0.002 } };
    this.focus = 26;
    this.aperture = 1.3;
    const paper = this.shell({ near, far, doors, colors: PALETTE.damaskGreen, floor: true, runner: true });
    this.hangDoors(doors);
    const end = this.endDoor(far);
    this.dress(paper);
    const lamp = this.lamp(-1, lampZ, this.set);
    // where a picture hung: the paper is still fresh under it, and the wire on its nail still moves
    const fresh = (paper as MeshStandardMaterial).clone();
    fresh.color.setScalar(2.6);
    const ghostSheet = new Sheets();
    ghostSheet.add([-W / 2 + 0.0035, TWO.printY - 0.28, TWO.printZ + 0.23], [0, 0, -0.46], [0, 0.56, 0], (_x, y, z) => [-z, y], 1);
    this.set.add(ghostSheet.mesh(fresh));
    const edge = new Mesh(new PlaneGeometry(0.5, 0.6), new MeshBasicMaterial({ map: ghostEdge(), transparent: true, depthWrite: false }));
    edge.position.set(-W / 2 + 0.0045, TWO.printY, TWO.printZ);
    edge.rotation.y = Math.PI / 2;
    edge.frustumCulled = false;
    this.set.add(edge);
    const wireMat = new MeshStandardMaterial({ color: 0x1c1a16, roughness: 0.5, metalness: 0.7 });
    const wire = new Mesh(new BoxGeometry(0.0014, 0.2, 0.0014).translate(0, -0.1, 0), wireMat);
    wire.position.set(-W / 2 + 0.014, TWO.printY + 0.3, TWO.printZ);
    wire.frustumCulled = false;
    this.set.add(wire);
    // he and all of his neck move as one
    const him = new Group();
    him.position.z = man;
    this.root.add(him);
    const crowd = this.build.headless(1, { tint: SUIT_TINT, bleach: SUIT_BLEACH });
    crowd.set(0, 0, 0, 0, 0);
    crowd.commit();
    him.add(crowd.root);
    this.plug([[0, 0]], him);
    this.build.contactShadow(0, 0, 0.62, him, 0.85);
    const shadow = new Mesh(new PlaneGeometry(0.8, 8), new MeshBasicMaterial({ map: longShadow(), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.012, 4);
    shadow.frustumCulled = false;
    shadow.renderOrder = 1;
    him.add(shadow);
    // out of the collar over his right shoulder, along the wall, and up to the ceiling only well in front of him
    const sw = NECK_WALL;
    const sh = NECK_SHOULDER;
    this.neck(
      [[0, 1.4, 0], [0.015, 1.49, 0.008], [0.09, sh - 0.01, 0.02], [0.24, sh + 0.015, 0.04], [0.6, sh + 0.01, 0.1], [0.98, sh + 0.005, 0.3], [sw, sh, 0.8], [sw, sh, 2.2], [sw, sh + 0.02, 3.6], [sw, sh + 0.14, 4.8], [sw, 1.98, 6.1], [sw - 0.01, 2.36, 7.3], [1.08, 2.6, 8.5], [0.76, 2.68, 9.7], [0.3, 2.69, 11.1], [-0.02, 2.69, 12.8], [-0.06, 2.69, 15], [0.3, 2.68, 20], [0.16, 2.69, 26], [-0.24, 2.68, 31], [0.04, 2.69, 36], [0.28, 2.68, 42], [0, 2.69, 48], [-0.2, 2.68, 54], [0.1, 2.69, 62], [0, 2.69, 72]],
      ONE.neck,
      0.74,
      him,
      12,
      12,
    );
    // what stands behind you at first: the door you came through; after that, only more corridor and a second lamp
    const behind = new Group();
    this.root.add(behind);
    const backWall = this.kit.wall(W, H, paper);
    backWall.position.set(0, H / 2, 1);
    backWall.rotation.y = Math.PI;
    behind.add(backWall);
    this.build.wainscot(0, 1, W, '-z', behind);
    this.build.door(0, 1, '-z', behind, { color: 0x201812 });
    const second = this.lamp(-1, secondLampZ, this.root);
    second.root.visible = false;
    second.point.intensity = 0;
    this.lamps.pop();
    // enough to see the door you came through, if you turn round early
    this.light([0, 2.3, -0.4], 0xb3a58d, 1.2, 5.5);
    let swapped = false;
    const swap = (on: boolean) => {
      swapped = on;
      behind.visible = !on;
      second.root.visible = on;
    };
    // the far tube first, then a nearer one that only burns once he has come closer
    const coldFar = this.tube(man - 3.5, this.set);
    const coldNear = this.tube(man + 7.2, this.set);
    coldNear.point.intensity = 0;
    coldNear.glow.color.setScalar(0);
    coldNear.halo.visible = false;
    const spotsFar: readonly (SpotSpec | null)[] = [lamp.down, lamp.up, coldFar.spot];
    const spotsNear: readonly (SpotSpec | null)[] = [lamp.down, lamp.up, coldNear.spot];
    this.spots = spotsFar;
    // the end of the neck, coming back over your head
    const eyeX = ONE.rows[8][1];
    const eyeZ = ONE.rows[8][2];
    const tip = new SlidingNeck(
      [[eyeX - 0.42, 2.68, eyeZ + 5.5], [eyeX - 0.42, 2.69, eyeZ + 3], [eyeX - 0.34, 2.68, eyeZ + 0.9], [eyeX - 0.2, 2.66, eyeZ - 0.55], [eyeX - 0.14, 2.52, eyeZ - 1.1], [eyeX - 0.1, 2.3, eyeZ - 1.24], [eyeX - 0.02, 2.02, eyeZ - 1.22], [eyeX + 0.06, 1.82, eyeZ - 1.04], [eyeX + 0.14, 1.73, eyeZ - 0.82], [eyeX + 0.19, 1.69, eyeZ - 0.6], [eyeX + 0.22, 1.67, eyeZ - 0.36]],
      ONE.tip,
      6,
      this.skin,
    );
    this.root.add(tip.mesh);
    // a few long white hairs left in the hole where a head would be
    const wisps = new HairFall();
    const strandRnd = randomFrom(61);
    for (let i = 0; i < 42; i++) {
      wisps.strand((strandRnd() - 0.5) * 0.09, -0.02 - strandRnd() * 0.03, (strandRnd() - 0.5) * 0.05, 0.05 + strandRnd() * strandRnd() * 0.3, strandRnd() * 6.28, (_x, _y, _z, out) => {
        out[0] = 0.78;
        out[1] = 0.74;
        out[2] = 0.66;
      }, 8, (along, off) => {
        off[0] = 0.018 * along * Math.sin(along * 7 + i);
        off[1] = 0.012 * along * Math.cos(along * 5 + i * 2);
      });
    }
    const wispClock = { value: 0 };
    const hairs = wisps.mesh({ uTime: wispClock, uWidth: { value: 0.0002 }, uSway: { value: 0.012 }, uLevel: { value: 1 }, uFog: { value: 0 }, uFogColor: { value: new Color(0) } });
    hairs.visible = false;
    this.root.add(hairs);
    this.path = walkAlong(rows, this.seconds, [dip], (s, z) => {
      const atDip = rows[4][2] - man;
      const d = REDUCED_MOTION ? (s < dip ? 30 : 15) : s < dip ? z - man : atDip / 2;
      const hold = (Math.atan(size / d) * 2) / (Math.PI / 180);
      return lerp(hold, 60, smooth(30, 32, s));
    });
    this.beds(-1);
    this.radiatorTicks(6.4, 11.9, 17.3, 27.4);
    this.someone(21);
    this.beat(21.9, () => {
      this.sound.play('rooms/breath_in.mp3', { gain: 0.2 });
      this.hum?.gain(0.015, 0.6);
    });
    this.beat(23.2, () => this.hum?.gain(0.1, 1.2));
    this.beat(30, () => {
      this.hum?.gain(0.03, 1.8);
      this.tick?.gain(0.02, 1.8);
      this.draft?.gain(0, 1.8);
    });
    this.beat(ONE.tipStop, () => this.sound.play('rooms/chest_pressure.mp3', { gain: 0.5, offset: 3.4, lowpass: 240 }));
    this.beat(ONE.shutter, () => this.shutter());
    return (frame) => {
      const s = frame.seconds;
      const camZ = this.path.z.at(s);
      const far2 = s < dip;
      const atDip = rows[4][2] - man;
      const heZ = REDUCED_MOTION ? camZ - (far2 ? 30 : 15) : far2 ? man : camZ - atDip / 2;
      him.position.z = heZ;
      const held = smooth(dip - 0.7, dip - 0.1, s) * (1 - smooth(dip + 0.15, dip + 1.1, s));
      this.lampLevel = 1 - 0.97 * held;
      const blind = smooth(dip - 0.3, dip - 0.05, s) * (1 - smooth(dip + 0.06, dip + 0.3, s));
      this.black = s >= ONE.cut ? 1 : 0.9 * blind;
      const lit = 1 - 0.97 * held;
      coldFar.glow.color.setHex(PALETTE.cold).multiplyScalar(4 * lit);
      coldFar.point.intensity = COLD_POINT * lit;
      coldFar.spot.intensity = COLD_SPOT * lit;
      const nearOn = far2 ? 0 : lit;
      coldNear.glow.color.setHex(PALETTE.cold).multiplyScalar(4 * nearOn);
      coldNear.point.intensity = COLD_POINT * nearOn;
      coldNear.spot.intensity = COLD_SPOT * nearOn;
      coldNear.halo.visible = !far2;
      this.spots = far2 ? spotsFar : spotsNear;
      // things change only when you are not looking
      if (swapped !== s >= behindAt && this.unseen(frame, 0, 1.2, 1, 6)) swap(s >= behindAt);
      second.point.intensity = swapped ? LAMP_POINT * this.lampLevel : 0;
      second.shade.emissiveIntensity = SHADE_GLOW * this.lampLevel;
      wire.rotation.x = 0.1 * Math.sin(frame.time * 1.3);
      end.leaf.rotation.y = 0.05 * smooth(dip, dip + 0.5, s);
      this.focus = lerp(camZ - heZ, 0.42, smooth(31.4, 33, s));
      this.aperture = lerp(1.3, 1.1, smooth(31, 33, s));
      this.fear = 0.34 + 0.56 * smooth(19, 33, s);
      this.control = s > ONE.tipStart - 0.4 ? HELD : FREE;
      if (s >= ONE.tipStart - 0.05) {
        const u = range(ONE.tipStart, ONE.tipStop, s);
        tip.mesh.visible = true;
        const travel = 1 - (1 - u) * (1 - u) * (1 - u);
        const turn = smooth(ONE.tipStop + 0.04, ONE.tipStop + ONE.tipTurn, s);
        tip.place(travel * tip.end, -0.5 * turn, 1 + 0.05 * Math.sin(frame.time * 1.9));
        hairs.visible = true;
        hairs.position.copy(tip.mouth);
        wispClock.value = frame.time;
      } else {
        tip.mesh.visible = false;
        hairs.visible = false;
      }
    };
  }

  /** Evening two. The table has changed sides. The first print, alone, lit like a thing in a museum; a spider. */
  private second(): Update {
    const { far, printZ, printY, printW, spiderIn, spiderStop, spiderFace, swapLatest, shutter, ajar } = TWO;
    const b = this.build;
    const kit = this.kit;
    const near = 0.6;
    const doors = this.closedDoors(near, far);
    this.air = { fog: { color: 0x060a09, density: 0.05 }, env: 'bathroom', envIntensity: 0.05, sky: 0, grade: { exposure: 1.3, saturation: 0.72, warmth: 0.02, tint: -0.02, flare: 0.002 } };
    this.focus = 7;
    this.aperture = 4;
    const paper = this.shell({ near, far, doors, colors: PALETTE.damaskGreen, floor: true, runner: true });
    this.hangDoors(doors);
    const end = this.endDoor(far);
    this.dress(paper);
    const lamp = this.lamp(1, -3.6, this.set);
    this.men([[-0.56, far + 1.05, Math.PI], [0.56, far + 1.15, Math.PI]], this.set);
    const cold = this.tube(far + 0.4, this.set, 0.8);
    const opening = this.dinnerBehind(end, far, ajar, true, cold);
    this.path = walkAlong(REDUCED_MOTION ? TWO.calmRows : TWO.rows, this.seconds, [], undefined, false);
    const first = this.album.pictures[0]?.canvas ?? null;
    const before = b.print(texture(witness(first, false)), printW);
    const after = b.print(texture(witness(first, true)), printW);
    for (const print of [before, after]) {
      ((print.children[0] as Mesh).material as MeshStandardMaterial).color.setHex(0x8f8b80);
      ((print.children[1] as Mesh).material as MeshStandardMaterial).color.setScalar(0.5);
      print.position.set(-W / 2 + 0.012, printY, printZ);
      print.rotation.y = Math.PI / 2;
      print.rotation.z = 0.005;
      this.set.add(print);
    }
    after.visible = false;
    const museum = this.spot([-0.32, H - 0.12, printZ + 0.22], [-W / 2, printY + 0.02, printZ], 0xfff1dc, MUSEUM, 17, 0.55);
    this.spots = [lamp.down, museum, cold.spot];
    // a nail for it, as for the others
    const spider = kit.prop('spider', [0, 0, 0], { scale: TWO.spiderScale }, this.set);
    const legs = ['L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4'].map((n) => spider.getObjectByName(`leg_${n}`)!);
    const rest = legs.map((l) => l.rotation.clone());
    const wallX = -W / 2 + 0.019;
    const start = new Vector3(wallX, printY + 0.68, printZ + 0.46);
    const stop = new Vector3(wallX, printY + spiderFace, printZ);
    const heading = stop.clone().sub(start).normalize();
    const up = new Vector3(1, 0, 0);
    const left = up.clone().cross(heading);
    spider.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(left, up, heading));
    spider.visible = false;
    const under = new Mesh(new PlaneGeometry(0.26, 0.26), new MeshBasicMaterial({ map: this.soft, color: 0x000000, transparent: true, opacity: 0.7, depthWrite: false }));
    under.rotation.y = Math.PI / 2;
    under.position.set(-W / 2 + 0.016, 0, 0);
    under.visible = false;
    under.frustumCulled = false;
    this.set.add(under);
    let swapped = false;
    const swap = (on: boolean) => {
      swapped = on;
      before.visible = !on;
      after.visible = on;
    };
    this.beds(1);
    this.radiatorTicks(3.4, 9.1, 17.8);
    for (let i = 0; i < 9; i++) {
      this.beat(spiderIn + 0.05 + i * 0.145, () => this.sound.play(`rooms/spider_tick_${(i % 3) + 1}.mp3`, { gain: 0.16, pan: -0.45, reverb: 0.08 }));
    }
    this.someone(13.9);
    this.beat(shutter, () => this.shutter());
    this.beat(19.8, () => this.sound.play('rooms/print_flutter.mp3', { gain: 0.14, pan: 0.4, reverb: 0.3 }));
    return (frame) => {
      const s = frame.seconds;
      const walking = s >= spiderIn && s < spiderStop;
      const crossing = range(spiderIn, spiderStop, s);
      const eased = 1 - (1 - crossing) * (1 - crossing);
      spider.position.lerpVectors(start, stop, eased);
      const shown = s >= spiderIn - 0.02 && !swapped;
      spider.visible = shown;
      under.visible = shown;
      under.position.y = spider.position.y - 0.02;
      under.position.z = spider.position.z;
      if (walking) {
        const k = s * 10.5;
        for (let i = 0; i < 8; i++) {
          const leftLeg = i < 4;
          const phase = k + (i % 2) * Math.PI + (leftLeg ? 0 : Math.PI);
          legs[i].rotation.y = rest[i].y + 0.26 * Math.sin(phase) * (leftLeg ? -1 : 1);
          legs[i].rotation.z = rest[i].z + 0.12 * Math.max(0, Math.cos(phase)) * (leftLeg ? 1 : -1);
        }
      } else if (s >= spiderStop) {
        for (let i = 0; i < 8; i++) legs[i].rotation.copy(rest[i]);
      }
      // gone, and one more person, the moment nobody is looking (and at the latest under a dip of its light)
      const out = s > spiderStop + 1 && this.unseen(frame, -W / 2, printY, printZ, 8);
      if (!swapped && (out || s >= swapLatest)) swap(true);
      else if (swapped && s < spiderStop) swap(false);
      museum.intensity = MUSEUM * (1 - 0.9 * smooth(swapLatest - 0.3, swapLatest, s) * (1 - smooth(swapLatest, swapLatest + 0.35, s)));
      this.focus = lerp(7, 1.6, smooth(8, 11, s) * (1 - smooth(16.8, 17.4, s)));
      this.fear = 0.42 + 0.3 * smooth(11, 19, s);
      this.control = s > 17 && s < 20 ? HELD : FREE;
      opening(s);
    };
  }

  /** Evening three. Every door ajar; six men; rats far off along the skirting; a door shuts behind you. */
  private third(): Update {
    const { far, ratFrom, ratHole, ratStart, ratRun, rats, closeFrom, closeFor, shutter, ajar } = THREE;
    const near = 0.6;
    const nearest: DoorSpec = { side: -1, z: -5, swing: 1.22, hinge: 'near', live: true };
    const doors: DoorSpec[] = [nearest, { side: 1, z: -8.5, swing: 1.2, hinge: 'near' }, { side: -1, z: -12, swing: 1.24, hinge: 'near' }, { side: 1, z: -15.5, swing: 0.92, hinge: 'far' }, { side: -1, z: -17.6, swing: 0.96, hinge: 'far' }, { side: 1, z: -20, swing: 0.88, hinge: 'far' }];
    this.air = { fog: { color: 0x050909, density: 0.055 }, env: 'bathroom', envIntensity: 0.05, sky: 0, grade: { exposure: 1.32, saturation: 0.7, warmth: 0.01, tint: -0.03, flare: 0.002 } };
    this.focus = 6;
    this.aperture = 4.5;
    const paper = this.shell({ near, far, doors, colors: PALETTE.damaskGreen, floor: true, runner: true });
    const live = this.hangDoors(doors);
    const door = live.get(nearest)!;
    const end = this.endDoor(far);
    this.dress(paper);
    this.hang(far, doors);
    const lamp = this.lamp(-1, -6.6, this.set);
    const deep = W / 2 + 0.42;
    this.men(
      doors.map((d, i) => {
        const toward = d.side < 0 ? Math.PI / 2 : -Math.PI / 2;
        return [d.side * deep, d.z, i < 3 ? toward : -toward] as const;
      }),
      this.set,
      0.3,
    );
    const cold = this.tube(far + 1.2, this.set, 0.8);
    const opening = this.dinnerBehind(end, far, ajar, true, cold);
    this.spots = [lamp.down, lamp.up, cold.spot];
    this.path = walkAlong(THREE.rows, this.seconds);
    // the rats: low dark backs and thin tails, too far away to be anything else
    const parts = [new IcosahedronGeometry(1, 1).scale(0.042, 0.038, 0.095), new IcosahedronGeometry(1, 0).scale(0.022, 0.02, 0.05).translate(0, -0.006, 0.11), new BoxGeometry(0.008, 0.008, 0.16).translate(0, -0.012, -0.17)];
    const whole = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
    const pack = new InstancedMesh(whole, new MeshStandardMaterial({ color: 0x0d0b09, roughness: 0.5 }), rats);
    pack.frustumCulled = false;
    this.root.add(pack);
    const rnd = randomFrom(101);
    const lag = new Float32Array(rats);
    const lane = new Float32Array(rats);
    const phase = new Float32Array(rats);
    for (let i = 0; i < rats; i++) {
      lag[i] = rnd() * rnd() * 5;
      lane[i] = 0.22 + rnd() * 0.44;
      phase[i] = rnd() * 6.28;
    }
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    for (let i = 0; i < rats; i++) pack.setMatrixAt(i, dummy.matrix);
    const wetLook = new MeshStandardMaterial({ color: 0x050505, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.66, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const wetStrip = new Sheets();
    wetStrip.add([W / 2 - 0.24, 0.009, 0], [0.205, 0, 0], [0, 0, 1], (px, _y, pz) => [px, pz], 2, [0, 1, 0]);
    wetStrip.add([W / 2 - 0.0365, 0, 0], [0, 0.17, 0], [0, 0, 1], (_x, py, pz) => [pz, py], 2, [-1, 0, 0]);
    const wet = wetStrip.mesh(wetLook);
    wet.position.z = ratFrom;
    wet.scale.z = 0.001;
    this.set.add(wet);
    const [streamCanvas, sg] = sheet(32, 4);
    const across = sg.createLinearGradient(0, 0, 32, 0);
    across.addColorStop(0, 'rgba(0,0,0,0)');
    across.addColorStop(0.5, 'rgba(0,0,0,0.74)');
    across.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = across;
    sg.fillRect(0, 0, 32, 4);
    const tide = new Mesh(new PlaneGeometry(0.72, 1), new MeshBasicMaterial({ map: texture(streamCanvas), transparent: true, depthWrite: false }));
    tide.rotation.x = -Math.PI / 2;
    tide.position.set(W / 2 - 0.42, 0.012, 0);
    tide.frustumCulled = false;
    tide.renderOrder = 1;
    this.root.add(tide);
    const hole = new Mesh(new CircleGeometry(0.05, 16), new MeshBasicMaterial({ color: 0x010101 }));
    hole.position.set(W / 2 - 0.0375, 0.045, ratHole);
    hole.rotation.y = -Math.PI / 2;
    hole.scale.y = 0.7;
    hole.frustumCulled = false;
    this.set.add(hole);
    this.floorSheen(W / 2 - 0.42, -13.5, 0.8, 11, PALETTE.cold, 0.1, this.set);
    this.beds(-1);
    this.radiatorTicks(4.1, 12.1);
    let run: RoomVoice | null = null;
    this.beat(ratStart - 0.3, () => {
      run = this.sound.bed('rooms/rats_claws.mp3', { gain: 0.02, lowpass: 1700, pan: 0.36, fade: 0.8 });
      this.sound.play('rooms/rat_chirp_far_1.mp3', { gain: 0.14, pan: 0.42, reverb: 0.4 });
    });
    this.beat(ratStart + 1.1, () => this.sound.play('rooms/paper_rustle_1.mp3', { gain: 0.22, rate: 0.62, lowpass: 1600, pan: 0.4, reverb: 0.4 }));
    this.beat(ratStart + 2.2, () => this.sound.play('rooms/wet_click_1.mp3', { gain: 0.18, pan: 0.38, reverb: 0.3 }));
    this.beat(ratStart + 3, () => this.sound.play('rooms/paper_rustle_3.mp3', { gain: 0.26, rate: 0.55, lowpass: 1700, pan: 0.3, reverb: 0.4 }));
    this.beat(ratStart + 4.1, () => run?.gain(0.15, 0.8));
    this.beat(ratStart + 6.2, () => run?.gain(0, 0.5));
    this.beat(closeFrom, () => this.sound.play('rooms/door_creak_slow.mp3', { gain: 0.3, reverb: 0.4, lowpass: 1600, pan: -0.5 }));
    this.beat(shutter, () => this.shutter());
    this.someone(16.2);
    return (frame) => {
      const s = frame.seconds;
      const u = range(ratStart, ratStart + ratRun, s);
      const head = lerp(ratFrom, ratHole + 5.5, u);
      for (let i = 0; i < rats; i++) {
        const z = head - lag[i];
        const running = u > 0 && u < 1 && z > ratFrom && z < ratHole;
        if (running) {
          const t = frame.time * 9 + phase[i];
          dummy.position.set(W / 2 - 0.055 - lane[i], 0.058 + 0.016 * Math.abs(Math.sin(t)), z);
          dummy.rotation.set(0, 0.2 * Math.sin(t * 0.37 + phase[i]), 0);
          dummy.scale.setScalar(1.55 + (phase[i] / 6.28) * 0.8);
        } else dummy.scale.setScalar(0);
        dummy.updateMatrix();
        pack.setMatrixAt(i, dummy.matrix);
      }
      pack.instanceMatrix.needsUpdate = true;
      const front = clamp(head, ratFrom, ratHole);
      const back = clamp(head - 5.2, ratFrom, ratHole);
      tide.visible = u > 0 && u < 1 && front - back > 0.2;
      tide.position.z = (front + back) / 2;
      tide.scale.y = front - back;
      wet.scale.z = Math.max(0.001, Math.min(ratHole, head) - ratFrom);
      door.leaf.rotation.y = door.sign * lerp(nearest.swing, 0, smooth(closeFrom, closeFrom + closeFor, s));
      opening(s);
      this.fear = 0.5 + 0.28 * smooth(7, 15, s);
    };
  }

  /** Evening four. Thirty meters, your own pictures frame to frame, eleven men, necks like pipes, and a fire behind one door. */
  private fourth(): Update {
    const { far, fireZ, ajar, shut, shutFor } = FOUR;
    const kit = this.kit;
    const near = 0;
    const fireDoor: DoorSpec = { side: 1, z: fireZ, swing: ajar, hinge: 'near', live: true };
    const doors = this.closedDoors(near, far).map((d) => (d.side === 1 && d.z === fireZ ? fireDoor : d));
    this.air = { fog: { color: 0x050909, density: 0.042 }, env: 'bathroom', envIntensity: 0.05, sky: 0, grade: { exposure: 1.3, saturation: 0.74, warmth: 0.03, tint: -0.02, flare: 0.003 } };
    this.focus = 9;
    this.aperture = 4;
    const paper = this.shell({ near, far, doors, colors: PALETTE.damaskTeal, floor: true, runner: true });
    const live = this.hangDoors(doors);
    const door = live.get(fireDoor)!;
    const end = this.endDoor(far);
    this.dress(paper, false);
    this.hang(far, doors, 0.8);
    const lamp = this.lamp(-1, -9.8, this.set);
    // eleven men down the far half; each neck leaves its collar over the shoulder, runs to the nearer wall, climbs it toward you and goes along the ceiling
    const list: [number, number, number][] = [];
    for (let i = 0; i < 5; i++) {
      const z = -20.4 - i * 1.9;
      list.push([-0.72, z, 0], [0.72, z - 0.4, 0]);
    }
    list.push([0, -27.4, 0]);
    this.men(list, this.set);
    const rnd = randomFrom(77);
    const order = list.map(([x, z], i) => ({ side: x < 0 ? -1 : 1, z, i })).sort((p, q) => p.z - q.z);
    const taken = [0, 0];
    order.forEach(({ side, i }) => {
      const [x, z] = list[i];
      const lx = side * (FOUR.lane + FOUR.laneStep * taken[side < 0 ? 0 : 1]++);
      const wx = side * NECK_WALL;
      const y = H - 0.075 - rnd() * 0.02;
      const path: V3[] = [[x, 1.4, z], [x + side * 0.015, 1.49, z + 0.008], [x + side * 0.09, NECK_SHOULDER - 0.01, z + 0.02], [x + (wx - x) * 0.55, NECK_SHOULDER, z + 0.1], [wx, NECK_SHOULDER, z + 0.45], [wx, NECK_SHOULDER + 0.06, z + 1.1], [wx, 2.05, z + 2], [wx, y - 0.22, z + 2.9], [(wx + lx) / 2, y - 0.02, z + 3.7], [lx, y, z + 4.6]];
      for (let w = z + 9; w < near - 1.4; w += 4.5) path.push([lx + (rnd() - 0.5) * 0.05, y + (rnd() - 0.5) * 0.02, w]);
      path.push([lx, y, near + 0.4]);
      this.neck(path, 0.05, 0.86, this.set, 7, 8);
    });
    this.neckBreath.value = 0.012;
    // your own prints, frame touching frame, all down both walls
    const atlas = printsAtlas(this.album.pictures.map((p) => p.canvas));
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const printW = 0.3;
    const printH = 0.362;
    const tile = (i: number) => {
      const u0 = (i % atlas.columns) / atlas.columns;
      const v1 = 1 - Math.floor(i / atlas.columns) / atlas.rows;
      return [u0, v1 - 1 / atlas.rows, u0 + 1 / atlas.columns, v1];
    };
    const blank = (side: Side, z: number) => doors.some((d) => d.side === side && Math.abs(d.z - z) < 0.66);
    let count = 0;
    let upsideDown = false;
    for (const side of [-1, 1] as const) {
      const x = (side * W) / 2 - side * 0.013;
      const ux = side < 0 ? -1 : 1;
      for (let z = -0.25; z > far + 0.2; z -= printW) {
        if (blank(side, z)) continue;
        for (let row = 0; row < 4; row++) {
          const y = WAIN + 0.21 + row * printH;
          const tilt = (rnd() - 0.5) * 0.05 + (rnd() < 0.06 ? (rnd() - 0.5) * 0.3 : 0);
          const c = Math.cos(tilt);
          const sn = Math.sin(tilt);
          let [u0, v0, u1, v1] = tile(count % atlas.tiles);
          const half = printW / 2;
          const hh = printH / 2;
          if (!upsideDown && side < 0 && row === 1 && z < -3.4) {
            upsideDown = true;
            [u0, u1] = [u1, u0];
            [v0, v1] = [v1, v0];
          }
          const tone = 0.74 + rnd() * 0.3;
          const proud = x - side * rnd() * 0.004;
          const base = positions.length / 3;
          for (const [i, j, uu, vv] of [[-1, -1, u0, v0], [1, -1, u1, v0], [-1, 1, u0, v1], [1, 1, u1, v1]] as const) {
            const px = i * half;
            const py = j * hh;
            positions.push(proud, y + px * sn + py * c, z + (px * c - py * sn) * ux);
            normals.push(-side, 0, 0);
            uvs.push(uu, vv);
            colors.push(tone, tone, tone);
          }
          indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
          count++;
        }
      }
    }
    const wallOfPrints = new BufferGeometry();
    wallOfPrints.setAttribute('position', new Float32BufferAttribute(positions, 3));
    wallOfPrints.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    wallOfPrints.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    wallOfPrints.setAttribute('color', new Float32BufferAttribute(colors, 3));
    wallOfPrints.setIndex(indices);
    const printed = new Mesh(wallOfPrints, new MeshStandardMaterial({ map: atlas.map, roughness: 0.58, vertexColors: true, emissive: new Color(0xffffff), emissiveMap: atlas.map, emissiveIntensity: 0.05 }));
    printed.frustumCulled = false;
    printed.receiveShadow = true;
    this.set.add(printed);
    const cold = this.tube(far + 3.4, this.set, 0.9);
    this.spots = [lamp.down, lamp.up, cold.spot];
    // the fire, seen through the gap
    const roomX = W / 2 + RECESS;
    const fireClock = { value: 0 };
    const fireLevel = { value: 1 };
    const fireMat = new ShaderMaterial({ vertexShader: FIRE_VERT, fragmentShader: FIRE_FRAG, uniforms: { ...warpUniforms, uTime: fireClock, uLevel: fireLevel }, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
    const flames = new Group();
    for (const [dx, dz, turn, w] of [[-0.74, -0.42, 0, 1.45], [-0.5, -0.22, -0.45, 1.25], [-0.16, 0, -Math.PI / 2, 0.95]] as const) {
      const sheetOf = new Mesh(new PlaneGeometry(w, 2.08), fireMat);
      sheetOf.position.set(roomX + dx, 1.02, fireZ + dz);
      sheetOf.rotation.y = turn;
      sheetOf.frustumCulled = false;
      flames.add(sheetOf);
    }
    this.root.add(flames);
    const chair = kit.prop('chair_ladder', [W / 2 + 0.5, 0, fireZ - 0.1], { rotation: [0, 90, 0] }, this.set);
    kit.paint(chair, new MeshBasicMaterial({ color: 0x030201 }));
    const backing = new MeshBasicMaterial({ color: new Color(0.34, 0.06, 0.012) });
    const burning = new Mesh(new PlaneGeometry(2 * HALF, DOOR_TOP), backing);
    burning.position.set(roomX - 0.03, DOOR_TOP / 2, fireZ);
    burning.rotation.y = -Math.PI / 2;
    burning.frustumCulled = false;
    this.root.add(burning);
    const fireLight = this.light([W / 2 + 0.74, 1.3, fireZ - 0.25], 0xff6a1e, 0, 10);
    const coal = this.light([W / 2 - 0.2, 0.25, fireZ], 0xff5810, 0, 5);
    const wedge = this.floorSheen(W / 2 - 1.1, fireZ + 0.1, 2.6, 3.4, 0xff7a2a, 0, this.set);
    const smokeClock = { value: 0 };
    const smokeReach = { value: 1 };
    const smokeLevel = { value: 0 };
    const smokeGlow = { value: 0 };
    const smokeSheet = new Sheets();
    smokeSheet.add([-W / 2, H - 0.04, near], [W, 0, 0], [0, 0, far - near], (px, _y, pz) => [px, pz], 1, [0, -1, 0]);
    const smoke = smokeSheet.mesh(new ShaderMaterial({ vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG, uniforms: { ...warpUniforms, uDrift: smokeClock, uReach: smokeReach, uLevel: smokeLevel, uGlow: smokeGlow, uDoor: { value: new Vector2(W / 2, fireZ) }, uTint: { value: new Color(0x241c16) } }, transparent: true, depthWrite: false }));
    smoke.renderOrder = 3;
    smoke.receiveShadow = false;
    this.root.add(smoke);
    const haze = 0.042;
    this.warp = [
      { at: 0, bendUp: 0, bendAside: 0, twist: 0, wave: 0 },
      { at: 0.4, bendUp: 0, bendAside: 0, twist: 0, wave: 0.002 },
      { at: shut / this.seconds, bendUp: 0, bendAside: 0, twist: 0, wave: 0.008 },
      { at: (shut + 0.02) / this.seconds, bendUp: 0, bendAside: 0, twist: 0, wave: 0 },
      { at: 1, bendUp: 0, bendAside: 0, twist: 0, wave: 0 },
    ];
    this.path = walkAlong(FOUR.rows, this.seconds, [shut]);
    this.beds(-1);
    this.radiatorTicks(2.4, 8.3);
    let crackle: RoomVoice | null = null;
    this.beat(0.2, () => {
      crackle = this.sound.bed('rooms/fire_behind_door.mp3', { gain: 0.02, pan: 0.3, lowpass: 2600, fade: 1 });
    });
    this.beat(shut - 0.42, () => this.shutter());
    this.beat(shut, () => {
      crackle?.gain(0, 0.05);
      this.hum?.gain(0, 0.05);
      this.tick?.gain(0, 0.05);
      this.draft?.gain(0, 0.05);
      this.sound.play('rooms/door_creak_short.mp3', { gain: 0.25, rate: 1.5, offset: 0.2, duration: 0.3, lowpass: 900, pan: 0.5 });
    });
    this.someone(19, 0.22);
    this.beat(19.6, () => this.hum?.gain(0.06, 2));
    this.endCreak(19.4);
    return (frame) => {
      const s = frame.seconds;
      const camZ = this.path.z.at(s);
      const shutNow = smooth(shut, shut + shutFor, s);
      door.leaf.rotation.y = door.sign * lerp(ajar, 0, shutNow);
      const on = s < shut + 0.02 ? 1 : 0;
      fireClock.value = frame.time;
      // irregular and slow: nothing here is faster than three times a second
      const flicker = 0.74 + 0.2 * wobble(frame.time * 2.3, 2) + 0.12 * wobble(frame.time * 4.1, 7);
      const near2 = smooth(16, 3, Math.abs(camZ - fireZ));
      fireLevel.value = on;
      flames.visible = on > 0;
      fireLight.intensity = on * (5 + 6 * near2) * flicker;
      coal.intensity = on * 2.4 * flicker;
      wedge.color.setHex(0xff7a2a).multiplyScalar(on * (0.1 + 0.16 * near2) * flicker);
      crackle?.gain(on * (0.05 + 0.55 * near2 * near2), 0.15);
      burning.visible = on > 0;
      backing.color.setRGB(0.34 * flicker, 0.06 * flicker, 0.012 * flicker);
      smokeClock.value = s < shut ? s * 0.5 : shut * 0.5 + (s - shut) * 0.08;
      smokeReach.value = lerp(1.2, 11, range(0, shut, s));
      smokeLevel.value = 0.92 * smooth(1, 6, s);
      smokeGlow.value = on * (0.55 + 0.45 * flicker);
      // the air goes on smelling of it
      this.air.fog.density = haze + 0.04 * smooth(shut, shut + 2.4, s);
      this.air.fog.color = s < shut ? 0x050909 : 0x0b0908;
      warp.wave.x = 3.4;
      warp.wave.y = frame.time * 8.5;
      this.neckClock.value = frame.time;
      end.leaf.rotation.y = 0.42 * smooth(19.4, 22, s);
      this.fear = 0.56 + 0.3 * smooth(4, shut, s) - 0.14 * smooth(shut, shut + 2, s);
      this.control = s > shut - 1.8 && s < shut + 0.6 ? HELD : FREE;
      this.focus = lerp(9, 2.2, smooth(12, 14.6, s) * (1 - smooth(16.2, 18, s)));
    };
  }

  /** Evening five. Black water to the ankle; everything on its reflection; in it, one person more. */
  private fifth(): Update {
    const { far, chairZ, chairX, under, shutter, ajar } = FIVE;
    const kit = this.kit;
    const near = 0.6;
    const liar: DoorSpec = { side: -1, z: -12, swing: 0, hinge: 'far', live: true, name: 'liar' };
    const doors = this.closedDoors(near, far).map((d) => (d.side === -1 && d.z === -12 ? liar : d));
    this.air = { fog: { color: 0x040808, density: 0.05 }, env: 'bathroom', envIntensity: 0.05, sky: 0, grade: { exposure: 1.5, saturation: 0.72, warmth: 0.02, tint: -0.03, flare: 0.002 } };
    this.focus = 6;
    this.aperture = 3;
    const paper = this.shell({ near, far, doors, colors: PALETTE.damaskTeal, floor: false, runner: false });
    this.hangDoors(doors);
    const end = this.endDoor(far);
    this.dress(paper);
    this.hang(far, doors);
    const lamp = this.lamp(1, -6.8, this.set);
    this.lampBoost = 1.7;
    kit.paint(kit.prop('chair_ladder', [chairX, 0, chairZ], { rotation: [0, 168, 0], castShadow: false }, this.set), new MeshStandardMaterial({ color: 0x120d0a, roughness: 0.6 }));
    const cold = this.tube(far + 1.4, this.set, 1.25);
    const opening = this.dinnerBehind(end, far, ajar, false, cold);
    // a copy of the corridor hung upside down under the surface
    const mirror = this.set.clone();
    mirror.scale.y = -1;
    this.root.add(mirror);
    const mirrorEnd = mirror.getObjectByName('end-door')!;
    const mirrorLiar = mirror.getObjectByName('liar')!;
    mirrorLiar.rotation.y = (liar.hinge === 'far' ? -1 : 1) * 0.5;
    const lit: V3 = [lamp.at[0], -lamp.at[1], lamp.at[2]];
    const lampBelow = this.light(lit, PALETTE.warm, LAMP_POINT, LAMP_REACH);
    const coldBelow = this.light([0, -(H - 0.3), far + 1.4], PALETTE.cold, COLD_POINT * cold.strength, COLD_REACH);
    const upBelow = this.spot(lit, [lit[0] + 0.02, -H, lit[2]], PALETTE.warm, LAMP_UP, 44, 0.42);
    this.spots = [lamp.up, upBelow, cold.spot];
    // prints that have come off the walls and float: they say where the surface is
    const adrift: readonly (readonly [number, number, number])[] = [[0.62, -3.4, 0.5], [-0.42, -4.9, -1.1], [0.3, -8.8, 2.2]];
    adrift.forEach(([x, z, turn], i) => {
      const picture = this.album.pictures[i];
      if (!picture) return;
      const floating = this.build.print(this.album.texture(picture), 0.3);
      floating.rotation.set(-Math.PI / 2, 0, turn);
      floating.position.set(x, 0.008, z);
      this.root.add(floating);
    });
    // the surface
    const rings = Array.from({ length: 6 }, () => new Vector3(0, 0, -1));
    const surface = new Sheets();
    surface.add([-W / 2, 0, near], [W, 0, 0], [0, 0, far - near - RECESS], () => [0, 0], 0.5, [0, 1, 0]);
    const water = surface.mesh(new ShaderMaterial({ vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, uniforms: { ...warpUniforms, uRings: { value: rings }, uSheen: { value: new Color(0xc9b08c).multiplyScalar(0.16) } }, transparent: true, depthWrite: false }));
    water.renderOrder = 2;
    water.receiveShadow = false;
    this.root.add(water);
    // one more, in the mirror world alone
    const figure = kit.figures.hero({ avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 0.2, face: 'scratched', white: true, tint: SUIT_TINT, bleach: SUIT_BLEACH });
    figure.root.position.set(under[0], 0, under[1]);
    figure.root.rotation.z = Math.PI;
    figure.root.scale.setScalar(1.3);
    this.root.add(figure.root);
    figure.update(0);
    figure.root.updateMatrixWorld(true);
    const head = figure.bone('Bip01_Head')!;
    const headAt = new Vector3();
    const eyeAt = new Vector3();
    const toward = new Vector3();
    const faceRest = figure.bone('Bip01_LEye')!.getWorldPosition(new Vector3()).add(figure.bone('Bip01_REye')!.getWorldPosition(eyeAt)).multiplyScalar(0.5).sub(head.getWorldPosition(headAt)).normalize();
    const worldTurn = new Quaternion();
    const parentTurn = new Quaternion();
    const headTurn = new Quaternion();
    const fillBelow = this.light([0, -EYE, 0], 0xc4d2d8, 2.4, 6);
    this.light([under[0] + 0.3, -1.1, under[1] + 0.9], 0xbfd0d8, 2.6, 4.2);
    const [shoeX, shoeY, shoeZ, shoeCd, shoeReach] = FIVE.shoes;
    this.light([under[0] + shoeX, shoeY, under[1] + shoeZ], PALETTE.warm, shoeCd, shoeReach);
    // where the water meets the wall
    const waterline = new Sheets();
    for (const side of [-1, 1]) waterline.add([side * (W / 2 - 0.024), 0.002, near], [side * 0.022, 0, 0], [0, 0, far - near], () => [0, 0], 1, [0, 1, 0]);
    const edge = waterline.mesh(new MeshBasicMaterial({ color: new Color(0xbcc6c4).multiplyScalar(0.05), transparent: true, depthWrite: false, blending: AdditiveBlending }));
    edge.renderOrder = 3;
    edge.receiveShadow = false;
    this.root.add(edge);
    this.path = walkAlong(FIVE.rows, this.seconds);
    this.beds(1, 0.05);
    for (const [i, at] of [3.1, 7.4, 10.9, 14.7, 19.2].entries()) {
      this.beat(at, () => this.sound.play(`rooms/tile_drip_${(i % 3) + 1}.mp3`, { gain: 0.14, pan: (i % 2 ? -1 : 1) * 0.5, reverb: 0.6, lowpass: 3000 }));
    }
    this.beat(0, () => this.draft?.gain(0.04, 1));
    this.someone(11.6, 0.2);
    this.beat(shutter, () => this.shutter());
    let ring = 0;
    return (frame) => {
      const s = frame.seconds;
      while (ring < this.path.falls.length && this.path.falls[ring].t <= s) ring++;
      while (ring > 0 && this.path.falls[ring - 1].t > s) ring--;
      for (let i = 0; i < 6; i++) {
        const f = this.path.falls[ring - 1 - i];
        if (f) rings[i].set(f.x, f.z, s - f.t);
        else rings[i].z = -1;
      }
      // always its face to you, however the body stands
      figure.update(0);
      figure.root.updateMatrixWorld(true);
      head.getWorldPosition(headAt);
      head.parent!.getWorldQuaternion(parentTurn).invert();
      head.getWorldQuaternion(worldTurn);
      toward.copy(frame.view.position).sub(headAt).normalize();
      headTurn.setFromUnitVectors(faceRest, toward);
      worldTurn.premultiply(headTurn);
      head.quaternion.copy(parentTurn).multiply(worldTurn);
      opening(s);
      mirrorEnd.rotation.y = end.leaf.rotation.y;
      coldBelow.intensity = cold.point.intensity;
      lampBelow.intensity = LAMP_POINT * this.lampBoost * this.lampLevel;
      fillBelow.position.copy(frame.view.position);
      fillBelow.position.y = this.origin.y - EYE;
      this.fear = 0.52 + 0.3 * smooth(8, 16, s);
      this.control = s > 9 && s < 18.4 ? HELD : FREE;
      this.focus = lerp(6, 2.8, smooth(9, 13, s) * (1 - smooth(17.8, 19.6, s)));
    };
  }

  /** Evening six. The paper gone to rust, the floor leaning, white hair down the walls; far off, cutlery; the door opens on warm light. */
  private sixth(): Update {
    const { far, lean, wallHair, curtain, curtains, doorFrom, doorFor, shutter } = SIX;
    const b = this.build;
    const near = 0.6;
    this.tilt = lean;
    const doors = this.closedDoors(near, far);
    this.air = { fog: { color: 0x080604, density: 0.05 }, env: 'fire', envIntensity: 0.05, sky: 0, grade: { exposure: 1.3, saturation: 0.76, warmth: 0.05, tint: 0, flare: 0.003 } };
    this.focus = 5;
    this.aperture = 2.2;
    const paper = this.shell({ near, far, doors, colors: PALETTE.damaskRust, floor: true, runner: true });
    this.hangDoors(doors);
    const end = this.endDoor(far);
    this.dress(paper);
    this.hang(far, doors);
    const lamp = this.lamp(-1, -7.4, this.set);
    this.spots = [lamp.down, lamp.up, null];
    // the warm room behind the last door
    const warmth = new MeshBasicMaterial({ color: new Color(PALETTE.warm).multiplyScalar(2.6) });
    const beyond = new Mesh(new PlaneGeometry(2 * HALF, DOOR_TOP), warmth);
    beyond.position.set(0, DOOR_TOP / 2, far - RECESS + 0.04);
    beyond.frustumCulled = false;
    this.set.add(beyond);
    const halo = b.glow(0, 1.2, far - 0.4, 3.6, PALETTE.warm, 0.9, this.set);
    halo.visible = false;
    const warmLight = this.light(this.leaned([0, 1.3, far + 0.6]), PALETTE.warm, 0, 11);
    // the room leans; everything in it leans with it, except what hangs
    const c = Math.cos(lean);
    const sn = Math.sin(lean);
    this.set.rotation.z = -lean;
    this.set.position.set(-EYE * sn, EYE * (1 - c), 0);
    const lampAt = this.leaned(lamp.at);
    const doorAt = this.leaned([0, 1.3, far]);
    const tone = (x: number, y: number, z: number, out: number[]) => {
      const dl = (x - lampAt[0]) ** 2 + (y - lampAt[1]) ** 2 + (z - lampAt[2]) ** 2;
      const dd = (x - doorAt[0]) ** 2 + (y - doorAt[1]) ** 2 + (z - doorAt[2]) ** 2;
      const lampTerm = 2.1 / (1 + 0.62 * dl);
      const doorTerm = 0.24 / (1 + 0.16 * dd);
      out[0] = 0.018 + lampTerm * 1.2 + doorTerm * 1.08;
      out[1] = 0.019 + lampTerm * 1.0 + doorTerm * 0.8;
      out[2] = 0.022 + lampTerm * 0.72 + doorTerm * 0.52;
    };
    const fall = new HairFall();
    const rnd = randomFrom(203);
    const standing = -8.4;
    /** How low a lock may hang at this place along the wall before the shape of nobody stops it. */
    const headroom = (z: number) => {
      const dz = Math.abs(z - standing);
      if (dz > 0.34) return 0;
      if (dz > 0.13) return 1.46 - (dz - 0.13) * 1.1;
      return 1.74 - (dz * dz) / 0.13 * 0.4;
    };
    // hair falls in locks: each its own place, its own wave, its own light
    const lockCount = Math.round(wallHair / 7);
    for (let l = 0; l < lockCount; l++) {
      const left = rnd() < 0.5;
      const depth = rnd();
      const lockRoom = (left ? -1 : 1) * (W / 2 - 0.012 - depth * depth * 0.44);
      const lockZ = near - 0.2 + (far + 0.3 - near) * rnd();
      const amp = 0.012 + rnd() * 0.05;
      const freq = 2.4 + rnd() * 4.2;
      const lockPhase = rnd() * 6.28;
      const lockBright = 0.4 + rnd() * rnd() * 1.2;
      const strands = 4 + Math.round(rnd() * 8);
      for (let i = 0; i < strands; i++) {
        const room = lockRoom + (rnd() - 0.5) * 0.05;
        const z = lockZ + (rnd() - 0.5) * 0.09;
        const x = room * c + (H - 0.02 - EYE) * sn;
        const top = EYE - room * sn + (H - 0.02 - EYE) * c;
        const floorY = EYE - (x + EYE * sn) / c * sn + (0 - EYE) * c;
        const whole = Math.max(0.2, (top - floorY - 0.02) * (rnd() < 0.3 ? 0.55 + rnd() * 0.4 : 1));
        const stop = depth < 0.34 && left ? headroom(lockZ) : 0;
        const length = stop > 0 ? Math.max(0.1, top - stop - floorY) : whole;
        const brightness = lockBright * (0.7 + rnd() * 0.6) * (0.5 + 0.5 * depth);
        const split = rnd() * 0.6;
        fall.strand(x, top, z, length, lockPhase + rnd() * 0.5, (px, py, pz, out) => {
          tone(px, py, pz, out);
          out[0] *= brightness;
          out[1] *= brightness;
          out[2] *= brightness;
        }, 9, (along, off) => {
          off[0] = amp * along * Math.sin(along * freq + lockPhase);
          off[1] = amp * 0.7 * along * Math.cos(along * freq * 1.3 + lockPhase * 1.7) + split * along * 0.02;
        });
      }
    }
    for (const z of curtains) {
      for (let i = 0; i < curtain; i++) {
        const room = (rnd() - 0.5) * (W - 0.1);
        const gap = Math.abs(room);
        const x = room * c + (H - 0.02 - EYE) * sn;
        const top = EYE - room * sn + (H - 0.02 - EYE) * c;
        const clear = EYE + 0.34 + 0.18 * rnd();
        const lowest = gap < 0.44 ? clear : clear - (gap - 0.44) * 2.4 - rnd() * 0.5;
        const length = Math.max(0.1, top - Math.max(0.12, lowest));
        const brightness = 0.5 + rnd() * rnd() * 0.8;
        const wobbleAt = rnd() * 6.28;
        const swing = 0.01 + rnd() * 0.04;
        fall.strand(x, top, z + (rnd() - 0.5) * 0.16, length, rnd() * 6.28, (px, py, pz, out) => {
          tone(px, py, pz, out);
          out[0] *= brightness;
          out[1] *= brightness;
          out[2] *= brightness;
        }, 8, (along, off) => {
          off[0] = swing * along * Math.sin(along * 5 + wobbleAt);
          off[1] = swing * along * Math.cos(along * 4 + wobbleAt);
        });
      }
    }
    const hairClock = { value: 0 };
    const hairLevel = { value: 1 };
    this.root.add(fall.mesh({ uTime: hairClock, uWidth: { value: 0.0016 }, uSway: { value: 0.03 }, uLevel: hairLevel, uFog: { value: 0.05 }, uFogColor: { value: new Color(0x080604) } }));
    // strands that drag across the lens as you go through a curtain
    const lensLook = new MeshBasicMaterial({ color: 0xcfc8ba, transparent: true, opacity: 0.55, side: DoubleSide, depthTest: false, depthWrite: false, fog: false });
    const sweeps: Group[] = [];
    for (let g = 0; g < 3; g++) {
      const positions: number[] = [];
      const indices: number[] = [];
      for (let i = 0; i < 16; i++) {
        const x0 = (rnd() - 0.5) * 0.16;
        const bow = (rnd() - 0.5) * 0.05;
        const width = 0.00007 + rnd() * 0.00016;
        const z = -0.11 - rnd() * 0.05;
        const base = positions.length / 3;
        const n = 18;
        for (let k = 0; k <= n; k++) {
          const v = k / n;
          const y = 0.2 - v * 0.4;
          const x = x0 + bow * Math.sin(v * Math.PI) + (rnd() - 0.5) * 0.0012;
          positions.push(x - width, y, z, x + width, y, z);
          if (k < n) {
            const a = base + k * 2;
            indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          }
        }
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      const m = new Mesh(geometry, lensLook);
      m.frustumCulled = false;
      m.renderOrder = 20;
      const group = new Group();
      group.add(m);
      group.visible = false;
      this.lens.add(group);
      sweeps.push(group);
    }
    this.path = walkAlong(SIX.rows, this.seconds);
    const passes = curtains.map((z) => {
      let t = 0;
      while (t < this.seconds && this.path.z.at(t) > z) t += 0.05;
      return t;
    });
    this.beds(1, 0.06);
    this.beat(0, () => {
      this.sound.bed('rooms/hair_fingers.mp3', { gain: 0.14, fade: 3 });
      this.sound.bed('rooms/cutlery_far.mp3', { gain: 0.16, lowpass: 900, reverb: 0.4, fade: 7 });
    });
    for (const [i, t] of passes.entries()) {
      this.beat(Math.max(0.05, t - 0.3), () => this.sound.play(i % 2 ? 'rooms/breath_out.mp3' : 'rooms/breath_in.mp3', { gain: 0.16, lowpass: 1500, pan: i % 2 ? -0.3 : 0.3 }));
    }
    this.someone(15.2, 0.22);
    this.beat(shutter, () => this.shutter());
    this.endCreak(doorFrom);
    return (frame) => {
      const s = frame.seconds;
      hairClock.value = frame.time;
      hairLevel.value = 1 + 0.7 * smooth(doorFrom, doorFrom + doorFor, s);
      for (const group of sweeps) group.visible = false;
      for (let i = 0; i < passes.length; i++) {
        const u = range(passes[i] - 0.55, passes[i] + 0.55, s);
        if (u <= 0 || u >= 1) continue;
        const g = sweeps[i % 3];
        g.visible = true;
        g.position.x = lerp(i % 2 ? -0.24 : 0.24, i % 2 ? 0.24 : -0.24, u);
        g.rotation.z = (u - 0.5) * 0.4;
      }
      const opened = smooth(doorFrom, doorFrom + doorFor, s);
      end.leaf.rotation.y = 1.9 * opened;
      warmth.color.setHex(PALETTE.warm).multiplyScalar(2.6 * opened);
      halo.visible = opened > 0.01;
      warmLight.intensity = 16 * opened;
      this.fear = 0.6 + 0.18 * smooth(6, 16, s) - 0.26 * opened;
    };
  }

  update(frame: RoomFrame): void {
    this.act(frame);
    const breath = (1 + 0.07 * wobble(frame.time * 0.8, 3)) * this.lampLevel * this.lampBoost;
    for (const lamp of this.lamps) {
      lamp.point.intensity = LAMP_POINT * breath;
      lamp.down.intensity = LAMP_DOWN * breath;
      lamp.up.intensity = LAMP_UP * breath;
      lamp.shade.emissiveIntensity = SHADE_GLOW * breath;
      lamp.spiral.emissiveIntensity = (SPIRAL_GLOW + 1.3 * frame.heartbeat) * Math.max(0.25, this.lampLevel);
      lamp.beam.uniforms.uIntensity.value = 0.08 * breath;
      // the second hand tries to go on and falls back: it stays half past
      lamp.secondHand.rotation.z = lamp.secondRest - (Math.sin(frame.time * 6.283) > 0.9 ? 0.09 : 0);
    }
    for (const c of this.clocks) c.value = frame.time;
    this.fill.position.copy(frame.view.position);
    this.fill.position.y -= 0.25;
    this.stepping(frame);
  }

  dispose(): void {
    warp.wave.x = warp.wave.y = 0;
    super.dispose();
  }
}

