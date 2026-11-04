import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYOUT, type SpotSpec } from '../../config/nightmare.config';
import { ALLEY, apt, factory } from '../../config/scene.config';
import { range, smootherstep } from '../math';
import type { FacadeSpec } from '../world/FacadeBuilder';
import { meterUVs, type DreamKit } from './DreamKit';
import type { DreamFrame, DreamModule } from './DreamModule';
import { randomFrom, type Crowd, type FigureSpec } from './FigureKit';
import { Blinks, Flicker } from './Flicker';
import { strandSet, Strands } from './FrozenRain';
import type { DreamLight } from './LightPool';
import { Ravens, type Perch } from './Ravens';

type V3 = readonly [number, number, number];

const { street, hall } = LAYOUT;
const HALF_WIDTH = street.halfWidth;
const SEED = 0x3d91b7;
const MODULE = 3;
const BLANK = 'wall_standard_standard_01';

// ---------------------------------------------------------------- the street itself

interface Building {
  kit: 'apt' | 'factory';
  floors: number;
  columns: number;
  /** Floors from the ground up with nothing in them at all: this much wall is left to paint on. */
  blank: number;
}

/** Along each wall from the alley's end, running on into the end wall (no gaps; 3 m per column and floor). */
const LEFT: readonly Building[] = [
  { kit: 'apt', floors: 9, columns: 5, blank: 3 },
  { kit: 'factory', floors: 8, columns: 5, blank: 3 },
];
const RIGHT: readonly Building[] = [
  { kit: 'factory', floors: 8, columns: 3, blank: 0 },
  { kit: 'apt', floors: 10, columns: 4, blank: 0 },
  { kit: 'factory', floors: 7, columns: 3, blank: 0 },
];
/** Where the rooms are black: this far behind each facade (m), so nothing shows through a window however space bends. */
const LINER = { setback: 0.42, color: 0x020203 };
/** The ground runs on under the buildings by this much (m), from just inside the alley to just inside the hall. */
const GROUND = { halfWidth: 6, from: street.from + 0.1, to: hall.from - 1.5, y: -0.002 };

/** Window glass in each module: width and its lowest and highest height in the module (m, measured on the kits). */
const GLASS: Readonly<Record<string, readonly [number, number, number]>> = {
  'apt/wall_window_centered_small_01': [0.64, 0.568, 2.028],
  'apt/wall_window_centered_small_02': [0.64, 0.568, 2.028],
  'apt/wall_window_centered_large_01': [1.63, 0.568, 2.028],
  'apt/wall_window_centered_large_02': [1.63, 0.568, 2.028],
  'apt/wall_window_centered_double_01': [2.14, 0.568, 2.028],
  'apt/wall_window_centered_double_02': [2.14, 0.568, 2.028],
  'factory/wall_window_tall_small_01': [1.276, 1.17, 2.965],
  'factory/wall_window_tall_small_02': [1.276, 0.035, 2.965],
  'factory/wall_window_tall_large_01': [1.93, 1.17, 2.965],
  'factory/wall_window_tall_large_02': [1.93, 0.035, 2.965],
  'factory/wall_window_centered_medium_01': [1.276, 0.76, 2.18],
  'factory/wall_window_centered_medium_02': [1.276, 0.645, 2.064],
};

/**
 * The few lit windows: frosted panes, each a dim sick green-white. How many, how many of them have someone behind them,
 * how high they begin (floor), how far behind the facade they stand (m, just behind the glass, so they can be seen
 * from along the wall), their color, and the range of their brightness.
 */
const PANES = {
  lit: 13,
  withSomeone: 5,
  fromFloor: 2,
  depth: 0.2,
  color: 0xbfe6c8,
  glow: [0.6, 1.7] as const,
  texture: 128,
};

/** Hair out of a few upper windows: how many, from which floor up, strands of each, locks they gather in, length (m), width (m), and the reach of its fading root. */
const WINDOW_HAIR = {
  windows: 7,
  fromFloor: 4,
  strands: 72,
  locks: 5,
  length: [5, 21] as const,
  lowest: 0.1,
  width: [0.006, 0.017] as const,
  rootFade: 0.03,
  /** It runs down in front of the wall by this much (m), from this far out over the sill and this far above it (m), and a lock ends within this much (m). */
  out: [0.06, 0.32] as const,
  rootOut: 0.14,
  rootAbove: 0.04,
  gather: 0.12,
  /** Its share of a lock's length at least, its loose wave (m), its share of the wind. */
  fullLength: 0.72,
  wave: [0.015, 0.06] as const,
  wind: 0.55,
};

/** The end wall: how thick (m), from where past it the street is forgotten (z), how far it runs on either side (m), and how many meters each texture repeats. */
const WALL = {
  thick: 2,
  forgottenFrom: hall.from - 6,
  reach: 40,
  tile: { board: 4.2, stained: 5.5 },
  /** The lintel stands back this little from the wall's faces and runs this far into the wall on either side (m): light-tight, and no two faces fight. */
  inset: 0.003,
  overlap: 0.03,
};

/** What comes through the slit until you are at it: brightness of the light standing in it (linear). */
const SLIT = {
  fill: { color: [1, 1, 0.97] as V3, gain: 3.4, heart: 0.14 },
  /** The haze in front of it, size (m), how far ahead of the wall (m), strength. */
  haze: { size: [3.7, 8.6] as const, ahead: 2.6, gain: 0.5, color: 0xdfeaff },
  /** A lamp in the slit for its own faces and the ground before it. */
  lamp: { at: [0, 2.6, hall.from - 1] as V3, color: 0xe6f0ff, intensity: 16, distance: 7 },
  /** It is all gone as the eye comes to it (z: starts to go, gone), so the hall opens. */
  fades: [-55.5, -62.8] as const,
};

/**
 * The light of the space. The key rakes down from high behind, so that bodies throw long shadows toward the slit (within
 * the 40 m of the shadow camera); it comes up as you enter (z). The second comes through the slit along the ground, and
 * lies as a long wet streak on the setts.
 */
const KEY = {
  position: [0.7, 14, -34] as V3,
  target: [0, 0, -57] as V3,
  color: 0xffa878,
  intensity: 450,
  angle: 33,
  penumbra: 0.6,
  comesUp: [-36.4, -41] as const,
};
const THROUGH_SLIT = {
  position: [0, 1.5, -73] as V3,
  target: [0, 0.2, -38] as V3,
  color: 0xe8f2ff,
  intensity: 46,
  angle: 11,
  penumbra: 0.6,
};

/** The fixtures on the walls: bare tubes and caged lamps, sick cold white, every 5 to 7 m. `node` is the tube's model. */
const FIXTURES: readonly { kind: 'tube' | 'cage'; side: -1 | 1; z: number; node?: string; every?: readonly [number, number] }[] = [
  { kind: 'tube', side: -1, z: -38.2, node: 'mounted_fluorescent_lights_d' },
  { kind: 'cage', side: 1, z: -43.6, every: [5, 13] },
  { kind: 'tube', side: -1, z: -49, node: 'mounted_fluorescent_lights_f', every: [2.5, 8] },
  { kind: 'tube', side: 1, z: -54.6, node: 'mounted_fluorescent_lights_b' },
  { kind: 'cage', side: -1, z: -60.2, every: [3.5, 10] },
];
const FIXTURE = {
  color: 0xcfead6,
  /** Tubes: size (times the model), center height (m), brightness of the tube. */
  tube: { scale: 1.5, y: 3.05, glow: 7, depth: 0.026 },
  /** Cages: height of the rail they hang from (m), how far it stands off the wall (m), brightness of the tube inside. */
  cage: { rail: 4.5, out: 0.38, glow: 9, railLength: 1.05, railThick: 0.05, armThick: 0.04, plates: 0.33, iron: 0x17171a, ironRough: 0.6 },
  /** Their light: how far out from the wall (m), how far below the tube's center or the rail (m), candela and reach (m). */
  light: { out: 0.9, tubeDrop: 0, cageDrop: 0.75, intensity: 8, distance: 8 },
  /** A light ahead takes up between these distances (m): the pool picks it up in the dark. One behind you dies between these. */
  ahead: [23, 15] as const,
  behind: [3, 10] as const,
  /** After the street's blackout they come back one by one, the far ones first: seconds between them, and how long each takes. */
  strikeGap: 0.16,
  strike: 0.1,
};

/** The street loses its light for an instant at these points of the walk (s). The great blackout is the director's (see Scares). */
const BLINKS = [
  { at: 0.2255, hold: 0.14 },
  { at: 0.292, hold: 0.16 },
];
/** Which of them takes the tall one away. */
const TALL_GONE_AT = 1;

// ---------------------------------------------------------------- the people

interface Role {
  spec: FigureSpec;
  /** Stands this high (a torso sits on the ground: it ends at its waist). */
  y?: number;
  /** Turned to the wall, ear against it. */
  toWall?: boolean;
  /** Cut through from head to foot: turned so that what is gone faces the way you come from. */
  cut?: boolean;
  /** Height of what decides whether it is seen (m). */
  look: number;
  /** How far its arms reach from its middle, turned any way (m). */
  reach: number;
}

const BLEACH = 0.62;
const man = (clip: string, time: number, half?: FigureSpec['half']): FigureSpec => ({ avatar: 'figure_man', clip, time, half, bleach: BLEACH });
const woman = (clip: string, time: number, half?: FigureSpec['half'], veil?: boolean): FigureSpec => ({ avatar: 'figure_woman', clip, time, half, veil, bleach: BLEACH });
const LAUGH = 'm_gestic_laugh_extreme';
const TORSO_Y = -0.95;

const ROLES = {
  doubled: { spec: man(LAUGH, 0.8), look: 1, reach: 0.33 },
  flung: { spec: man(LAUGH, 3.2), look: 1.4, reach: 0.58 },
  broken: { spec: man('m_idle_roll_head_01', 5), look: 1.4, reach: 0.33 },
  listenerM: { spec: man('m_listen_door', 1.8), toWall: true, look: 1.4, reach: 0.47 },
  listenerW: { spec: woman('f_listen_door', 1.5), toWall: true, look: 1.3, reach: 0.32 },
  veiled: { spec: woman('f_idle_touch_hair_01', 1.7, undefined, true), look: 1.3, reach: 0.3 },
  legsM: { spec: man('m_walk_bruised', 0.7, 'lower'), look: 0.6, reach: 0.25 },
  legsW: { spec: woman('f_idle_touch_hair_01', 2.9, 'lower'), look: 0.6, reach: 0.25 },
  torsoM: { spec: man(LAUGH, 3.2, 'upper'), y: TORSO_Y, look: 0.5, reach: 0.58 },
  torsoW: { spec: woman('f_listen_door', 1.5, 'upper'), y: TORSO_Y, look: 0.45, reach: 0.32 },
  cutML: { spec: man('m_idle_touch_face_01', 1.8, 'left'), cut: true, look: 1.3, reach: 0.33 },
  cutMR: { spec: man('m_idle_touch_face_01', 1.8, 'right'), cut: true, look: 1.3, reach: 0.33 },
  cutWL: { spec: woman('f_idle_touch_hair_01', 0.5, 'left'), cut: true, look: 1.3, reach: 0.3 },
  cutWR: { spec: woman('f_idle_touch_hair_01', 0.5, 'right'), cut: true, look: 1.3, reach: 0.3 },
} satisfies Record<string, Role>;
type RoleName = keyof typeof ROLES;

/** Who stands where along each wall, from the alley's end to the slit: half of them are halves. */
const ON_THE_RIGHT: readonly (readonly [RoleName, number])[] = [
  ['doubled', -37.4],
  ['legsM', -38.9],
  ['cutML', -40.6],
  ['listenerW', -42.2],
  ['torsoM', -43.7],
  ['broken', -45.3],
  ['legsW', -46.9],
  ['cutWL', -48.3],
  ['flung', -50],
  ['torsoW', -51.5],
  ['listenerM', -53.1],
  ['legsM', -54.6],
  ['cutML', -56.2],
  ['doubled', -57.7],
  ['torsoM', -59.2],
  ['broken', -60.8],
  ['legsW', -62.2],
];
const ON_THE_LEFT: readonly (readonly [RoleName, number])[] = [
  ['broken', -38.1],
  ['torsoW', -39.8],
  ['veiled', -41.4],
  ['legsM', -43],
  ['cutMR', -44.5],
  ['doubled', -46.1],
  ['listenerW', -47.7],
  ['legsW', -49.2],
  ['flung', -50.8],
  ['cutWR', -52.3],
  ['torsoM', -53.9],
  ['veiled', -55.4],
  ['legsM', -57],
  ['listenerM', -58.5],
  ['torsoW', -60.1],
  ['cutMR', -61.6],
];
/** The first vertical half along the walk holds a memory: its place in ON_THE_RIGHT, and how a long look finds it. */
const FIRST_HALF = { index: 2, height: 1.2, radius: 7, zoom: 0.55 };

const PEOPLE = {
  /**
   * Their distance from the middle (m), that of one listening at the wall, and how far from the middle the ends of
   * their arms stay (m): this is 0.9 m clear of the way, wherever on it you are.
   */
  side: 1.42,
  sideJitter: 0.1,
  listening: 1.6,
  clear: 1.02,
  /** How far off facing the middle they stand (rad). */
  jitter: 0.32,
  /** Each step when unseen: along the wall (m), and toward the middle (m). */
  step: [0.7, 1.35] as const,
  aside: 0.07,
  /** They stop this far from the eye along the wall (m), and this far from each other (m). */
  keepFromEye: 1.1,
  spacing: 0.72,
  /** Along the wall they stay within these z. */
  first: street.from - 0.8,
  last: street.to + 0.7,
  /** Those not looked at move this often (s); at a blink this share of them moves too. */
  every: 1.8,
  atBlink: 0.45,
  /** The shadows are drawn again no more often than this while people move unseen (s). */
  shadowsEvery: 3,
};

/** The very tall thin one in the middle of the street, its back to you, seen against the slit from the blackout on. */
const TALL = {
  spec: { avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 0.2, bleach: BLEACH, tint: 0x20201f } as FigureSpec,
  z: -61.5,
  scale: [0.84, 1.3, 0.84] as V3,
  /** Gone at the first dip of the lamp nearest to it, once shown this long (s), and in any case before this close (m). */
  shownFor: 2.2,
  within: 6.8,
  /** It appears only if the eye is at least this far from where it stands (m). */
  farEnough: 8.5,
};

/** One gnome on the ground, closer every time you look away. */
const GNOME = {
  x: 1.05,
  from: -60.5,
  step: [2.1, 3.2] as const,
  keepFromEye: 2.4,
  look: 0.3,
};

/** Cables across the street (z and height at the left wall, z and height at the right, sag, birds on it). */
const CABLES: readonly (readonly [number, number, number, number, number, number])[] = [
  [-39.6, 9.4, -40.6, 10.1, 0.6, 5],
  [-45.8, 13.2, -45, 12.5, 0.8, 6],
  [-50.2, 8.2, -51, 8.7, 0.55, 4],
  [-56.4, 15, -55.5, 14.2, 0.9, 6],
  [-60.7, 10.4, -61.5, 11.2, 0.7, 5],
];
/** The cables' tube (radius m, points on the sag, segments, sides, color); birds keep off the walls by a share of a cable; birds on sills: how many sills, birds on each, where they stand (m), from which floor up. */
const RAVENS = {
  cableRadius: 0.012,
  cableSamples: 16,
  cableSegments: 40,
  cableSides: 5,
  cableColor: 0x0d0d0e,
  clear: 0.12,
  size: [0.85, 1.15] as const,
  sills: 4,
  onSill: 3,
  sillHeight: 0.52,
  sillOut: 0.08,
  sillGap: 0.34,
  fromFloor: 3,
};

// ---------------------------------------------------------------- the paint

const PAINT = {
  ink: 'rgb(226, 221, 206)',
  font: '"Protest Revolution", serif',
  roughness: 0.2,
  /** How far off the wall it lies (m), past every cornice. */
  off: { facade: 0.08, wall: 0.012 },
  /**
   * Along the left facade: z of its start, length (m), its lowest height and its size (m), texture px per m. Two rows of
   * words, each filling a share of the length: the lower stands this far off the ground (m), the upper this far over it.
   */
  facade: {
    start: street.from - 0.9,
    length: 27,
    bottom: 0.02,
    height: 7.8,
    pixels: 112,
    lower: { text: 'SAÇ BEYAZLATIR', width: 0.97, x: 0.015, tilt: -0.006, baseline: 1.25 },
    upper: { text: 'BİR FOTOĞRAFIN RÜYASI', width: 0.92, x: 0.05, tilt: 0.005, gap: 0.42 },
    runs: 190,
    runLength: 0.42,
  },
  /**
   * On the end wall, over the slit: width and bottom and top (m), texture px per m, how many times. Its lines leave this
   * share free at either side, climb by these shares of the height (where the first is, evenly, and more and more apart),
   * and tilt by up to this much (rad).
   */
  wall: {
    width: 3.7,
    bottom: 5.4,
    top: 25.5,
    pixels: 120,
    line: 'HER AKŞAM YARIM',
    lines: 22,
    margin: 0.02,
    climb: [0.02, 0.68, 0.28] as const,
    tilt: 0.004,
    runs: 150,
    runLength: 0.22,
    /** Which lines stop halfway (counting from the slit up), and at what share of their length. */
    cutShort: [1, 6, 7, 13] as readonly number[],
    cutAt: 0.55,
  },
} as const;

function tr(text: string): string {
  return text.toLocaleUpperCase('tr');
}

interface PaintRow {
  text: string;
  /** Px from the canvas's left; baseline px from its top; width to fill px; tilt rad. */
  x: number;
  baseline: number;
  width: number;
  tilt: number;
}

/** Hand-painted words, wet: the brush dries out here and there, and long runs fall from every stroke. */
function wetWords(width: number, height: number, rows: readonly PaintRow[], runs: number, runLength: number, seed: number): CanvasTexture {
  const random = randomFrom(seed);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = PAINT.ink;
  ctx.strokeStyle = PAINT.ink;
  ctx.lineCap = 'round';
  ctx.textBaseline = 'alphabetic';
  for (const row of rows) {
    const trial = 100;
    ctx.font = `${trial}px ${PAINT.font}`;
    const size = (trial * row.width) / Math.max(1, ctx.measureText(row.text).width);
    ctx.font = `${size}px ${PAINT.font}`;
    ctx.save();
    ctx.translate(row.x, row.baseline);
    ctx.rotate(row.tilt);
    ctx.fillText(row.text, 0, 0);
    ctx.restore();
  }
  // where the brush ran dry
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < width / 6; i++) {
    const x = random() * width;
    const y = random() * height;
    ctx.lineWidth = 0.5 + random() * (height / 500);
    ctx.globalAlpha = 0.25 + random() * 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (random() - 0.5) * height * 0.12, y + (random() - 0.2) * height * 0.03);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  // the runs: from where a stroke ends, straight down, thinning, with a bead at the end
  const painted = ctx.getImageData(0, 0, width, height).data;
  const inked = (x: number, y: number) => painted[(y * width + x) * 4 + 3] > 120;
  for (let n = 0; n < runs; n++) {
    const x = Math.floor(random() * width);
    let y = Math.floor(random() * height);
    while (y < height && !inked(x, y)) y++;
    if (y >= height) continue;
    while (y < height && inked(x, y)) y++;
    const length = height * runLength * random() ** 2.2;
    const thick = 1 + random() * (height / 260);
    let at = x;
    for (let s = 0, steps = 10; s < steps; s++) {
      const next = at + (random() - 0.5) * 1.2;
      ctx.lineWidth = thick * (1 - (s / steps) * 0.65);
      ctx.beginPath();
      ctx.moveTo(at, y - 2 + (s * length) / steps);
      ctx.lineTo(next, y + ((s + 1) * length) / steps);
      ctx.stroke();
      at = next;
    }
    ctx.beginPath();
    ctx.ellipse(at, y + length, thick * 0.55, thick * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // what flew off the brush
  for (let n = 0; n < runs / 2; n++) {
    ctx.beginPath();
    ctx.arc(random() * width, random() * height, 0.6 + random() ** 3 * (height / 200), 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 16;
  return texture;
}

/** A frosted pane lit from behind: soft, and (if someone stands behind it) the blur of a head and shoulders. */
function paneTexture(someone: boolean): CanvasTexture {
  const size = PANES.texture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const light = ctx.createRadialGradient(size / 2, size * 0.42, size * 0.05, size / 2, size / 2, size * 0.75);
  light.addColorStop(0, '#ffffff');
  light.addColorStop(1, '#6d6d6d');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, size, size);
  if (someone) {
    const blot = (x: number, y: number, rx: number, ry: number, dark: number) => {
      ctx.save();
      ctx.translate(x * size, y * size);
      ctx.scale(rx, ry);
      const g = ctx.createRadialGradient(0, 0, 0.35 * size, 0, 0, size);
      g.addColorStop(0, `rgba(4,8,6,${dark})`);
      g.addColorStop(1, 'rgba(4,8,6,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-size, -size, size * 2, size * 2);
      ctx.restore();
    };
    blot(0.5, 0.42, 0.17, 0.2, 0.95);
    blot(0.5, 0.86, 0.36, 0.34, 0.95);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** The light standing in the slit: not a flat card, a little brighter low in the middle, where it comes from. */
function lightTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size * 0.7, 0, size / 2, size * 0.6, size * 0.75);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#8c8c8c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

/** A soft bright air around the slit, in the shape of what it shines through. */
function hazeTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size * 0.68, 0, size / 2, size * 0.68, size * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.42)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

// ---------------------------------------------------------------- what the street keeps track of

/** A window on a facade: which wall, the middle of its column, its floor, and where its glass is. */
interface Opening {
  side: -1 | 1;
  z: number;
  level: number;
  kit: Building['kit'];
  glass: readonly [number, number, number];
}

interface Body {
  crowd: Crowd;
  index: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  look: number;
  /** The nearest it comes to the middle of the street. */
  lane: number;
  /** It has been seen since it last moved. */
  seen: boolean;
  home: { x: number; z: number; heading: number };
}

interface Fixture {
  light: DreamLight;
  z: number;
  glass: MeshStandardMaterial;
  glow: number;
  flicker: Flicker | null;
  /** Seconds after the blackout it strikes again. */
  strikes: number;
}

const at = new Vector3();
const ahead = new Vector3();
const matrix = new Matrix4();
const place = new Vector3();
const quaternion = new Quaternion();
const size = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * Chapter III, the street that should have ended. The alley goes on, narrow and enormously tall, its sky a slit; a
 * colossal wall closes it, and a slit of light goes through that. Along both walls stand the ones who stand there,
 * utterly still, half of them halves, each with the long shadow of a whole person. No one has seen them move.
 */
export class Street implements DreamModule {
  readonly root = new Group();
  readonly span = [street.from, street.to] as const;
  readonly region = 'street' as const;
  readonly spots: (SpotSpec | null)[];

  /** All of it but the wall: it costs a lot, and past the wall no one can see it. */
  private readonly built = new Group();
  private readonly plug = new Mesh(new PlaneGeometry(hall.slit.halfWidth * 2 + 0.1, hall.slit.height + 0.1), new MeshBasicMaterial({ color: 0x000000, fog: false }));
  /** Two alike: the director draws a space's shadows again when its first spot changes, and people have moved. */
  private readonly keys: [SpotSpec, SpotSpec];
  private readonly through: SpotSpec;
  private readonly bodies: Body[] = [];
  private readonly crowds: Crowd[] = [];
  private readonly random = randomFrom(SEED + 7);
  private readonly halfPoi = new Vector3();
  private readonly firstHalf: Body;
  private readonly tall: Crowd;
  private readonly tallAt = new Vector3(0, 1.4, TALL.z);
  private readonly gnome: Object3D;
  private gnomeZ: number = GNOME.from;
  private gnomeSeen = false;
  private readonly gnomeAt = new Vector3(GNOME.x, GNOME.look, GNOME.from);
  private readonly fixtures: Fixture[] = [];
  private readonly hair: Strands;
  private readonly ravens: Ravens;
  private readonly plainPanes: InstancedMesh;
  private readonly blinks = new Blinks(BLINKS);
  private readonly slitFill: MeshBasicMaterial;
  private readonly slitHaze: MeshBasicMaterial;
  private readonly slitLamp: DreamLight;
  private readonly slitAir: Object3D[] = [];
  /** The director's blackout is on: nothing anywhere can be seen. */
  private blackedOut = false;
  /** Seconds since the blackout let go. */
  private strike = Infinity;
  private stepClock = 0;
  private shadowClock = 0;
  private shadowsOwed = false;
  private tallShown = 0;

  constructor(kit: DreamKit) {
    this.root.name = 'Street';
    this.root.add(this.built);
    const shot = (from: typeof KEY): SpotSpec => ({ position: from.position, target: from.target, color: from.color, intensity: 0, angle: from.angle, penumbra: from.penumbra });
    this.keys = [shot(KEY), shot(KEY)];
    this.through = { ...THROUGH_SLIT, intensity: 0 };
    this.spots = [this.keys[0], this.through, null];

    const windows = this.buildFacades(kit);
    this.buildGround(kit);
    this.buildEndWall(kit);
    this.buildPaint(kit);
    this.plainPanes = this.buildPanes(windows);
    this.hair = this.buildWindowHair(kit, windows);
    this.built.add(this.hair.mesh);
    this.buildFixtures(kit);

    const fill = SLIT.fill;
    const light = lightTexture();
    light.repeat.set(1 / (hall.slit.halfWidth * 2), 1 / hall.slit.height);
    this.slitFill = new MeshBasicMaterial({ map: light, fog: false, transparent: true, depthWrite: false });
    this.slitFill.color.setRGB(fill.color[0] * fill.gain, fill.color[1] * fill.gain, fill.color[2] * fill.gain);
    const standing = kit.wall(hall.slit.halfWidth * 2, hall.slit.height, this.slitFill, hall.slit.halfWidth, hall.slit.height / 2);
    standing.position.set(0, hall.slit.height / 2, hall.from - WALL.thick + 0.05);
    standing.receiveShadow = false;
    const h = SLIT.haze;
    const glow = hazeTexture();
    glow.repeat.set(1 / h.size[0], 1 / h.size[1]);
    this.slitHaze = new MeshBasicMaterial({ map: glow, color: h.color, fog: false, transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: h.gain });
    const air = kit.wall(h.size[0], h.size[1], this.slitHaze, h.size[0] / 2, h.size[1] / 2);
    air.position.set(0, h.size[1] / 2, hall.from + h.ahead);
    air.receiveShadow = false;
    this.slitAir.push(standing, air);
    this.built.add(standing, air);
    const l = SLIT.lamp;
    this.slitLamp = kit.lights.add(l.at, l.color, l.intensity, l.distance);

    this.buildPeople(kit);
    this.firstHalf = this.bodies[FIRST_HALF.index];
    kit.poi({ position: this.halfPoi, radius: FIRST_HALF.radius, zoom: FIRST_HALF.zoom, memory: 'half' });

    this.tall = kit.figures.crowd(TALL.spec, 1);
    matrix.compose(place.set(0, 0, TALL.z), quaternion.setFromAxisAngle(UP, Math.PI), size.set(TALL.scale[0], TALL.scale[1], TALL.scale[2]));
    this.tall.setMatrix(0, matrix);
    this.tall.commit();
    this.tall.root.traverse((o) => (o.castShadow = true));
    this.built.add(this.tall.root);

    this.gnome = kit.prop('gnome', [GNOME.x, 0, GNOME.from], {}, this.built);

    this.ravens = new Ravens(kit, this.buildCables(windows));
    this.built.add(this.ravens.root);
    this.reset();
  }

  // ------------------------------------------------------------------ building it

  /** Both walls, floors of windows over blank ground floors: a list of where the windows are for what comes later. */
  private buildFacades(kit: DreamKit): Opening[] {
    const random = randomFrom(SEED);
    const specs: FacadeSpec[] = [];
    const windows: Opening[] = [];
    const darkRooms = new MeshBasicMaterial({ color: LINER.color });
    const side = (buildings: readonly Building[], wall: -1 | 1) => {
      let z: number = street.from;
      for (const b of buildings) {
        const floors: string[][] = [];
        for (let level = 0; level < b.floors; level++) {
          const row: string[] = [];
          for (let i = 0; i < b.columns; i++) {
            const module = b.kit === 'apt' ? this.aptModule(level, b, random) : this.factoryModule(level, b, random);
            row.push(module);
            const glass = GLASS[`${b.kit}/${module}`];
            if (glass) windows.push({ side: wall, z: z - (i + 0.5) * MODULE, level, kit: b.kit, glass });
          }
          floors.push(row);
        }
        const make = b.kit === 'apt' ? apt : factory;
        specs.push(make({ facing: wall < 0 ? 'east' : 'west', start: [wall * HALF_WIDTH, z], run: [0, -1], floors }));
        // the dark behind the windows, bending as the wall does
        const liner = kit.wall(b.columns * MODULE, b.floors * MODULE + 0.1, darkRooms);
        liner.position.set(wall * (HALF_WIDTH + LINER.setback), (b.floors * MODULE + 0.1) / 2, z - (b.columns * MODULE) / 2);
        liner.rotation.y = (-wall * Math.PI) / 2;
        liner.receiveShadow = false;
        this.built.add(liner);
        z -= b.columns * MODULE;
      }
    };
    side(LEFT, -1);
    side(RIGHT, 1);
    this.built.add(kit.alley.facades(specs));
    return windows;
  }

  private aptModule(level: number, b: Building, random: () => number): string {
    if (level < b.blank) return BLANK;
    if (level === 0) {
      const r = random();
      return r < 0.2 ? 'wall_door_centered_small_01' : r < 0.45 ? 'wall_window_offset_small_01' : BLANK;
    }
    const v = level === Math.max(b.blank, 1) ? '01' : '02';
    const r = random();
    if (r < 0.14) return BLANK;
    return `wall_window_centered_${r < 0.56 ? 'small' : r < 0.84 ? 'large' : 'double'}_${v}`;
  }

  private factoryModule(level: number, b: Building, random: () => number): string {
    if (level < b.blank) return BLANK;
    if (level === 0) {
      const r = random();
      return r < 0.18 ? 'wall_door_centered_large_01' : r < 0.42 ? 'wall_window_centered_small_01' : BLANK;
    }
    const v = level === Math.max(b.blank, 1) ? '01' : '02';
    const r = random();
    if (level === b.floors - 1) return r < 0.4 ? BLANK : `wall_window_centered_medium_${v}`;
    if (r < 0.34) return BLANK;
    return `wall_window_tall_${r < 0.72 ? 'small' : 'large'}_${v}`;
  }

  /** The wet setts of the alley, going on in the same courses, and on under the walls so that no crack shows. */
  private buildGround(kit: DreamKit): void {
    const g = GROUND;
    const ground = kit.floor(-g.halfWidth, g.halfWidth, g.to, g.from, g.y, kit.alley.wetGround);
    const p = ground.geometry.getAttribute('position');
    const uv = ground.geometry.getAttribute('uv');
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) + ALLEY.halfWidth, ALLEY.back - (ground.position.z - p.getY(i)));
    ground.geometry.setAttribute('uv1', uv.clone());
    this.built.add(ground);
  }

  /** The wall at the end: one pour in texture across its pieces, the slit through it sharp, its faces poured too. */
  private buildEndWall(kit: DreamKit): void {
    const { slit, height, from } = hall;
    const board = kit.surface('conc_board', WALL.tile.board);
    const stained = kit.surface('conc_stained', WALL.tile.stained);
    const piece = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, material: Material) => {
      const mesh = kit.block(x1 - x0, y1 - y0, z0 - z1, material);
      mesh.geometry.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      meterUVs(mesh.geometry);
      this.root.add(mesh);
    };
    piece(-WALL.reach, -slit.halfWidth, 0, height, from, from - WALL.thick, board);
    piece(slit.halfWidth, WALL.reach, 0, height, from, from - WALL.thick, board);
    piece(-slit.halfWidth - WALL.overlap, slit.halfWidth + WALL.overlap, slit.height, height, from - WALL.inset, from - WALL.thick + WALL.inset, stained);
    // past it, looking back, there is nothing left of the street
    this.plug.position.set(0, slit.height / 2, from - WALL.inset);
    this.plug.rotation.y = Math.PI;
    this.plug.visible = false;
    this.root.add(this.plug);
  }

  /** The motto: huge and wet along the left wall; the rest of it again and again on the end wall, over the slit. */
  private buildPaint(kit: DreamKit): void {
    const paintOn = (texture: Texture, width: number, height: number): MeshStandardMaterial => {
      texture.repeat.set(1 / width, 1 / height);
      return new MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, roughness: PAINT.roughness, metalness: 0 });
    };
    const f = PAINT.facade;
    const fw = Math.round(f.length * f.pixels);
    const fh = Math.round(f.height * f.pixels);
    // the upper row stands over the lower by what the lower measures in this font
    const measure = document.createElement('canvas').getContext('2d')!;
    measure.font = `100px ${PAINT.font}`;
    const lowerText = tr(f.lower.text);
    const lowerSize = (100 * f.lower.width * fw) / Math.max(1, measure.measureText(lowerText).width);
    measure.font = `${lowerSize}px ${PAINT.font}`;
    const lowerRise = measure.measureText('H').actualBoundingBoxAscent;
    const lowerBaseline = fh - f.lower.baseline * f.pixels;
    const rows: PaintRow[] = [
      { text: lowerText, x: f.lower.x * fw, baseline: lowerBaseline, width: f.lower.width * fw, tilt: f.lower.tilt },
      { text: tr(f.upper.text), x: f.upper.x * fw, baseline: lowerBaseline - lowerRise - f.upper.gap * f.pixels, width: f.upper.width * fw, tilt: f.upper.tilt },
    ];
    const facade = kit.wall(f.length, f.height, paintOn(wetWords(fw, fh, rows, f.runs, f.runLength, SEED + 11), f.length, f.height), f.length / 2, f.height / 2);
    facade.position.set(-HALF_WIDTH + PAINT.off.facade, f.bottom + f.height / 2, f.start - f.length / 2);
    facade.rotation.y = Math.PI / 2;
    this.built.add(facade);

    const w = PAINT.wall;
    const height = w.top - w.bottom;
    const ww = Math.round(w.width * w.pixels);
    const wh = Math.round(height * w.pixels);
    const line = tr(w.line);
    const lines: PaintRow[] = [];
    for (let i = 0; i < w.lines; i++) {
      // up the wall from the slit: farther apart each time, so that from below they all read alike
      const t = i / w.lines;
      const short = w.cutShort.includes(i);
      lines.push({
        text: short ? line.slice(0, Math.round(line.length * w.cutAt)) : line,
        x: ww * w.margin,
        baseline: wh * (1 - w.climb[0] - t * w.climb[1] - t * t * w.climb[2]),
        width: ww * (1 - 2 * w.margin) * (short ? w.cutAt : 1),
        tilt: ((i % 3) - 1) * w.tilt,
      });
    }
    const wall = kit.wall(w.width, height, paintOn(wetWords(ww, wh, lines, w.runs, w.runLength, SEED + 13), w.width, height), w.width / 2, height / 2);
    wall.position.set(0, w.bottom + height / 2, hall.from + PAINT.off.wall);
    this.built.add(wall);
  }

  /** The few lit windows, some with someone behind them; one instanced draw for each kind of pane. */
  private buildPanes(windows: readonly Opening[]): InstancedMesh {
    const random = randomFrom(SEED + 3);
    const candidates = windows.filter((w) => w.level >= PANES.fromFloor);
    const picked: Opening[] = [];
    while (picked.length < PANES.lit && candidates.length) picked.push(candidates.splice(Math.floor(random() * candidates.length), 1)[0]);
    const plane = new PlaneGeometry(1, 1, 1, 1);
    const color = new Color();
    const make = (list: readonly Opening[], someone: boolean): InstancedMesh => {
      const mesh = new InstancedMesh(plane, new MeshBasicMaterial({ map: paneTexture(someone) }), list.length);
      list.forEach((w, i) => {
        const [width, y0, y1] = w.glass;
        matrix.compose(
          place.set(w.side * (HALF_WIDTH + PANES.depth), w.level * MODULE + (y0 + y1) / 2, w.z),
          quaternion.setFromAxisAngle(UP, (-w.side * Math.PI) / 2),
          size.set(width, y1 - y0, 1),
        );
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, color.set(PANES.color).multiplyScalar(PANES.glow[0] + random() * (PANES.glow[1] - PANES.glow[0])));
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.built.add(mesh);
      return mesh;
    };
    make(picked.slice(0, PANES.withSomeone), true);
    return make(picked.slice(PANES.withSomeone), false);
  }

  /** Long white hair out of a few upper windows, down the facades. */
  private buildWindowHair(kit: DreamKit, windows: readonly Opening[]): Strands {
    const random = randomFrom(SEED + 5);
    const H = WINDOW_HAIR;
    const candidates = windows.filter((w) => w.level >= H.fromFloor);
    const set = strandSet(H.windows * H.strands);
    let n = 0;
    for (let w = 0; w < H.windows; w++) {
      const win = candidates.splice(Math.floor(random() * candidates.length), 1)[0];
      const [width, y0] = win.glass;
      const rootY = win.level * MODULE + y0 + H.rootAbove;
      const locks = Array.from({ length: H.locks }, () => ({
        z: win.z + (random() - 0.5) * width * 0.9,
        reach: H.length[0] + random() ** 1.3 * (H.length[1] - H.length[0]),
        out: H.out[0] + random() * (H.out[1] - H.out[0]),
      }));
      for (let s = 0; s < H.strands; s++, n++) {
        const lock = locks[Math.floor(random() * H.locks)];
        const j = n * 4;
        const tipY = Math.max(H.lowest, rootY - lock.reach * (H.fullLength + random() * (1 - H.fullLength)));
        const tipX = win.side * (HALF_WIDTH - lock.out);
        const tipZ = lock.z + (random() - 0.5) * H.gather;
        set.drops.set([tipX, tipY, tipZ, random()], j);
        set.shapes.set([1, 0, 0, 0.75 + random() * 0.5], j);
        set.speeds[n] = 1;
        set.tips.set([tipX, tipY, tipZ, 0], j);
        set.roots.set([win.side * (HALF_WIDTH - H.rootOut), rootY, win.z + (random() - 0.5) * width * 0.95, H.width[0] + random() ** 1.6 * (H.width[1] - H.width[0])], j);
        set.seeds.set([locks.indexOf(lock) / H.locks, random(), H.wind * (0.7 + random() * 0.6), H.wave[0] + random() * (H.wave[1] - H.wave[0])], j);
      }
    }
    return new Strands(kit, set, { always: true, rootFade: H.rootFade });
  }

  /** The material of this fixture's own tube, so that it can fail by itself. */
  private ownTube(fixture: Object3D, pick: (material: Material) => boolean, glow: number): MeshStandardMaterial {
    let tube: MeshStandardMaterial | null = null;
    fixture.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || !pick(mesh.material as Material)) return;
      tube = (mesh.material as MeshStandardMaterial).clone();
      tube.emissive.set(FIXTURE.color);
      tube.emissiveIntensity = glow;
      mesh.material = tube;
    });
    return tube!;
  }

  private buildFixtures(kit: DreamKit): void {
    const F = FIXTURE;
    const iron = new MeshStandardMaterial({ color: F.cage.iron, roughness: F.cage.ironRough, metalness: F.cage.ironRough });
    FIXTURES.forEach((f, i) => {
      const wallX = f.side * HALF_WIDTH;
      let glass: MeshStandardMaterial;
      let glow: number;
      let y: number;
      if (f.kind === 'tube') {
        // the mount against the wall, the tube upright: a row of bars receding
        const fixture = kit.prop('fluorescent', [wallX - f.side * F.tube.depth, F.tube.y, f.z], { rotation: [0, 0, -f.side * 90], scale: F.tube.scale, anchor: 'center', nodes: [f.node!] }, this.built);
        glow = F.tube.glow;
        glass = this.ownTube(fixture, (m) => /glass/.test(m.name), glow);
        y = F.tube.y - F.light.tubeDrop;
      } else {
        const fixture = kit.prop('caged_light', [wallX - f.side * F.cage.out, F.cage.rail, f.z], { rotation: [0, 90, 0], anchor: 'top' }, this.built);
        glow = F.cage.glow;
        glass = this.ownTube(fixture, () => true, glow);
        y = F.cage.rail - F.light.cageDrop;
        // what it hangs from: a rail on two arms out of the wall
        const { railThick: thick, armThick: arm } = F.cage;
        const parts = [new BoxGeometry(thick, thick, F.cage.railLength).translate(wallX - f.side * F.cage.out, F.cage.rail + thick / 2, f.z)];
        for (const off of [-F.cage.plates, F.cage.plates]) parts.push(new BoxGeometry(F.cage.out, arm, arm).translate(wallX - (f.side * F.cage.out) / 2, F.cage.rail + thick / 2, f.z + off));
        this.built.add(new Mesh(mergeGeometries(parts), iron));
      }
      const light = kit.lights.add([f.side * (HALF_WIDTH - F.light.out), y, f.z], F.color, F.light.intensity, F.light.distance);
      this.fixtures.push({
        light,
        z: f.z,
        glass,
        glow,
        flicker: f.every ? new Flicker(SEED + i, f.every) : null,
        strikes: (FIXTURES.length - 1 - i) * F.strikeGap,
      });
    });
  }

  /** Everyone along the walls: one instanced draw per pose and per way of being cut, casting the shadow of a whole body. */
  private buildPeople(kit: DreamKit): void {
    const everyone: { name: RoleName; z: number; wall: -1 | 1 }[] = [
      ...ON_THE_RIGHT.map(([name, z]) => ({ name, z, wall: 1 as const })),
      ...ON_THE_LEFT.map(([name, z]) => ({ name, z, wall: -1 as const })),
    ];
    const crowds = new Map<RoleName, { crowd: Crowd; next: number }>();
    for (const name of Object.keys(ROLES) as RoleName[]) {
      const count = everyone.filter((e) => e.name === name).length;
      if (!count) continue;
      const crowd = kit.figures.crowd(ROLES[name].spec, count);
      crowd.root.traverse((o) => (o.castShadow = true));
      this.built.add(crowd.root);
      this.crowds.push(crowd);
      crowds.set(name, { crowd, next: 0 });
    }
    const random = randomFrom(SEED + 9);
    for (const e of everyone) {
      const role: Role = ROLES[e.name];
      const c = crowds.get(e.name)!;
      const toMiddle = (-e.wall * Math.PI) / 2;
      const lane = PEOPLE.clear + role.reach;
      const x = e.wall * Math.max(lane, role.toWall ? PEOPLE.listening : PEOPLE.side + (random() - 0.5) * 2 * PEOPLE.sideJitter);
      const heading = role.toWall ? -toMiddle : role.cut ? toMiddle : toMiddle + (random() - 0.5) * 2 * PEOPLE.jitter;
      this.bodies.push({ crowd: c.crowd, index: c.next++, x, y: role.y ?? 0, z: e.z, heading, look: role.look, lane, seen: false, home: { x, z: e.z, heading } });
    }
  }

  /** The cables across the street and the sills: where the birds sit. */
  private buildCables(windows: readonly Opening[]): Perch[] {
    const random = randomFrom(SEED + 15);
    const R = RAVENS;
    const perches: Perch[] = [];
    const bigness = () => R.size[0] + random() * (R.size[1] - R.size[0]);
    const pieces: BufferGeometry[] = [];
    for (const [z0, y0, z1, y1, sag, birds] of CABLES) {
      const points: Vector3[] = [];
      for (let i = 0; i <= R.cableSamples; i++) {
        const t = i / R.cableSamples;
        points.push(new Vector3(-HALF_WIDTH + 2 * HALF_WIDTH * t, y0 + (y1 - y0) * t - sag * 4 * t * (1 - t), z0 + (z1 - z0) * t));
      }
      const curve = new CatmullRomCurve3(points);
      pieces.push(new TubeGeometry(curve, R.cableSegments, R.cableRadius, R.cableSides));
      for (let b = 0; b < birds; b++) {
        const on = curve.getPointAt(R.clear + (1 - 2 * R.clear) * ((b + 0.25 + random() * 0.5) / birds));
        perches.push({ x: on.x, y: on.y + R.cableRadius, z: on.z, heading: Math.PI / 2 + (random() - 0.5) * 0.7, scale: bigness() });
      }
    }
    this.built.add(new Mesh(mergeGeometries(pieces), new MeshStandardMaterial({ color: R.cableColor, roughness: 0.55 })));

    const sills = windows.filter((w) => w.kit === 'apt' && w.level >= R.fromFloor);
    for (let s = 0; s < R.sills && sills.length; s++) {
      const w = sills.splice(Math.floor(random() * sills.length), 1)[0];
      for (let b = 0; b < R.onSill; b++) {
        perches.push({
          x: w.side * (HALF_WIDTH - R.sillOut),
          y: w.level * MODULE + R.sillHeight,
          z: w.z + (b - (R.onSill - 1) / 2) * R.sillGap,
          heading: w.side > 0 ? Math.PI : 0,
          scale: bigness(),
        });
      }
    }
    return perches;
  }

  // ------------------------------------------------------------------ per frame

  /** Is everything out of sight (the director's blackout)? Asked of a point right in front of the eye. */
  private isBlackedOut(frame: DreamFrame): boolean {
    ahead.set(0, 0, -5).applyQuaternion(frame.view.quaternion).add(frame.view.position);
    return frame.unseen(ahead, 0);
  }

  update(frame: DreamFrame): void {
    if (frame.paused) return;
    const { eye, dt } = frame;
    const remembered = eye.z > WALL.forgottenFrom;
    this.built.visible = remembered;
    this.plug.visible = !remembered;
    if (!remembered) {
      for (const f of this.fixtures) f.light.intensity = 0;
      return;
    }
    this.hair.advance(dt);
    this.lamps(frame);

    const b = this.blinks;
    const blackout = this.isBlackedOut(frame);
    const fellNow = blackout && !this.blackedOut;
    this.blackedOut = blackout;
    this.strike = blackout ? 0 : this.strike + dt;
    const dark = blackout || b.dark;

    this.stepClock += dt;
    const stepDue = this.stepClock >= PEOPLE.every;
    if (stepDue) this.stepClock = 0;
    let moved = false;
    for (const body of this.bodies) {
      if (!dark && !frame.unseen(at.set(body.x, body.look, body.z))) {
        body.seen = true;
        continue;
      }
      const behind = body.z > eye.z;
      const go = fellNow || (b.fell && this.random() < PEOPLE.atBlink) || (stepDue && (body.seen || behind));
      if (!go || eye.z > street.from) continue;
      this.step(body, eye);
      body.seen = false;
      moved = true;
    }
    if (moved) {
      for (const c of this.crowds) c.commit();
      this.halfPoi.set(this.firstHalf.x, FIRST_HALF.height, this.firstHalf.z);
      this.shadowsOwed = true;
    }

    this.updateTall(frame, fellNow);
    this.updateGnome(frame, dark, fellNow || b.fell);
    if (fellNow) this.plainPanes.visible = false;
    this.ravens.update(frame, dark);

    // the shadows are drawn again at once in the dark, and now and then otherwise
    this.shadowClock += dt;
    if (this.shadowsOwed && (dark || this.shadowClock >= PEOPLE.shadowsEvery)) {
      this.spots[0] = this.spots[0] === this.keys[0] ? this.keys[1] : this.keys[0];
      this.shadowsOwed = false;
      this.shadowClock = 0;
    }
  }

  /** All that shines in the street, for this moment. */
  private lamps(frame: DreamFrame): void {
    const { eye, walk, dt } = frame;
    const b = this.blinks;
    b.update(walk, dt);
    const key = KEY.intensity * b.level * smootherstep(range(KEY.comesUp[0], KEY.comesUp[1], eye.z));
    this.keys[0].intensity = this.keys[1].intensity = key;

    // it is all gone as the eye comes to it, so that the hall opens
    const open = 1 - smootherstep(range(SLIT.fades[0], SLIT.fades[1], eye.z));
    this.through.intensity = THROUGH_SLIT.intensity * b.level * open * smootherstep(range(KEY.comesUp[0], KEY.comesUp[1], eye.z));
    this.slitFill.opacity = b.level * open;
    // it beats, a little, with your heart
    const fill = SLIT.fill;
    const beat = fill.gain * (1 + fill.heart * frame.heartbeat);
    this.slitFill.color.setRGB(fill.color[0] * beat, fill.color[1] * beat, fill.color[2] * beat);
    // the air goes first: the eye passes through where it stood
    this.slitHaze.opacity = SLIT.haze.gain * b.level * open * open;
    for (const o of this.slitAir) o.visible = open > 0;
    this.slitLamp.intensity = SLIT.lamp.intensity * b.level * open * smootherstep(range(hall.from + FIXTURE.ahead[0], hall.from + FIXTURE.ahead[1], eye.z));

    const F = FIXTURE;
    for (const f of this.fixtures) {
      f.flicker?.update(dt);
      const failing = (f.flicker ? f.flicker.level : 1) * b.level * range(f.strikes, f.strikes + F.strike, this.strike);
      const before = eye.z - f.z;
      // no one is left to keep the lights on behind you
      const dying = 1 - smootherstep(range(F.behind[0], F.behind[1], -before));
      f.glass.emissiveIntensity = f.glow * failing * dying;
      f.light.intensity = F.light.intensity * failing * dying * smootherstep(range(F.ahead[0], F.ahead[1], before));
    }
  }

  /** One step nearer along the wall, turned as a whole to the viewer: never onto another, never within reach of the way. */
  private step(body: Body, eye: Vector3): void {
    const P = PEOPLE;
    const away = eye.z - body.z;
    const stride = P.step[0] + this.random() * (P.step[1] - P.step[0]);
    if (Math.abs(away) > P.keepFromEye) {
      const next = body.z + Math.sign(away) * Math.min(stride, Math.abs(away) - P.keepFromEye);
      const clamped = Math.min(P.first, Math.max(P.last, next));
      const crowded = this.bodies.some((o) => o !== body && Math.sign(o.x) === Math.sign(body.x) && Math.abs(o.z - clamped) < P.spacing);
      if (!crowded) body.z = clamped;
    }
    const wall = Math.sign(body.x);
    body.x = wall * Math.max(body.lane, Math.abs(body.x) - P.aside);
    body.heading = Math.atan2(eye.x - body.x, eye.z - body.z);
    body.crowd.set(body.index, body.x, body.y, body.z, body.heading);
  }

  /** In the blackout it comes; it is never touched. */
  private updateTall(frame: DreamFrame, fellNow: boolean): void {
    const { eye, dt } = frame;
    const tall = this.tall.root;
    if (fellNow && eye.z - TALL.z > TALL.farEnough) {
      tall.visible = true;
      this.tallShown = 0;
      this.shadowsOwed = true;
    }
    if (!tall.visible) return;
    this.tallShown += dt;
    const lamp = this.fixtures[this.fixtures.length - 1].flicker;
    const lampFailed = this.tallShown > TALL.shownFor && lamp !== null && lamp.level < 1;
    const blinkTakesIt = this.blinks.fell && this.blinks.current === TALL_GONE_AT;
    if (blinkTakesIt || lampFailed || eye.z - TALL.z < TALL.within || (!this.blackedOut && frame.unseen(this.tallAt))) {
      tall.visible = false;
      this.shadowsOwed = true;
    }
  }

  /** It stands on the ground, faces you, and is closer every time you look away. */
  private updateGnome(frame: DreamFrame, dark: boolean, fell: boolean): void {
    const { eye } = frame;
    if (!dark && !frame.unseen(this.gnomeAt)) {
      this.gnomeSeen = true;
      return;
    }
    if (!this.gnomeSeen && !fell) return;
    this.gnomeSeen = false;
    const away = eye.z - this.gnomeZ;
    if (Math.abs(away) > GNOME.keepFromEye) {
      const stride = GNOME.step[0] + this.random() * (GNOME.step[1] - GNOME.step[0]);
      this.gnomeZ += Math.sign(away) * Math.min(stride, Math.abs(away) - GNOME.keepFromEye);
      this.gnomeZ = Math.min(PEOPLE.first, Math.max(PEOPLE.last, this.gnomeZ));
    }
    this.placeGnome(eye);
  }

  private placeGnome(eye: Vector3): void {
    this.gnome.position.set(GNOME.x, 0, this.gnomeZ);
    this.gnome.rotation.y = Math.atan2(eye.x - GNOME.x, eye.z - this.gnomeZ);
    this.gnomeAt.setZ(this.gnomeZ);
  }

  // ------------------------------------------------------------------ the capture

  reset(): void {
    for (const body of this.bodies) {
      body.x = body.home.x;
      body.z = body.home.z;
      body.heading = body.home.heading;
      body.seen = false;
      body.crowd.set(body.index, body.x, body.y, body.z, body.heading);
    }
    for (const c of this.crowds) c.commit();
    this.halfPoi.set(this.firstHalf.x, FIRST_HALF.height, this.firstHalf.z);
    this.tall.root.visible = false;
    this.tallShown = 0;
    this.gnomeZ = GNOME.from;
    this.gnomeSeen = false;
    this.placeGnome(at.set(0, 1.6, 0));
    this.plainPanes.visible = true;
    this.blinks.reset();
    this.blackedOut = false;
    this.strike = Infinity;
    this.stepClock = 0;
    this.shadowClock = 0;
    this.shadowsOwed = false;
    this.keys[0].intensity = this.keys[1].intensity = KEY.intensity;
    this.through.intensity = THROUGH_SLIT.intensity;
    this.spots[0] = this.keys[0];
    this.slitFill.opacity = 1;
    this.slitHaze.opacity = SLIT.haze.gain;
    for (const o of this.slitAir) o.visible = true;
    this.slitLamp.intensity = SLIT.lamp.intensity;
    for (const f of this.fixtures) {
      f.glass.emissiveIntensity = f.glow;
      f.light.intensity = FIXTURE.light.intensity;
    }
    this.built.visible = true;
    this.plug.visible = false;
    this.ravens.reset();
  }
}
