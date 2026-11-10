import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
  UnsignedByteType,
  Vector2,
  Vector3,
  type PerspectiveCamera,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { SpotSpec } from '../../../config/nightmare.config';
import type { Crowd, FigureSpec } from '../../dream/FigureKit';
import type { DreamLight } from '../../dream/LightPool';
import { DEG, wobble } from '../../math';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['molar_low', 'molar', 'chair_ladder', 'dining_table'],
  sounds: [
    'rooms/waves_teeth.mp3',
    'rooms/night_wind_far.mp3',
    'rooms/pebbles_only.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/wave_draw_back.mp3',
    'rooms/teeth_scatter.mp3',
    'rooms/tooth_tink_1.mp3',
    'rooms/tooth_tink_3.mp3',
    'rooms/tooth_tink_5.mp3',
    'rooms/breath_in.mp3',
  ],
};

/** Seconds of the room: the wave draws back, the sea starts to slow, someone is there, the shutter, the cut. */
const DRAW_BACK = 7;
const SEA_SLOWS = 10.4;
const SITS = 11;
const SHUTTER = 13;
const CUT = 15;

/** The moon goes out and comes back; a cloud thickens and thins over it; the focus is pulled to the chair; the hair's wind turns (s). */
const MOON_OUT: readonly [number, number] = [10, 10.55];
const MOON_BACK: readonly [number, number] = [10.95, 11.75];
const MOON_FAILS: readonly [number, number] = [13.2, 14.6];
const CLOUD_IN: readonly [number, number] = [9.3, 10.4];
const CLOUD_OUT: readonly [number, number] = [10.9, 12.3];
const FOCUS_PULL: readonly [number, number] = [5.2, 7.2];
/** When the sounds fall (s): the sea holds its breath, a handful rolls, the quiet opens, single teeth in it, the wind returns, your breath, a last tooth. */
const AT_HOLD = 5.6;
const AT_SCATTER = 9.5;
const AT_QUIET = 10.1;
const AT_TINK = 10.62;
const AT_TINK_NEXT = 10.96;
const AT_WIND = 11.5;
const AT_BREATH = 12.3;
const AT_LAST = 14.15;

/** The beach: how steeply it climbs from the sea (m per m), how far the shoreline wanders (m). */
const SLOPE = 0.085;
const SHORE_BEND = 1.3;
/** Height of the water at the shore through the room: [second, m above the zero tide line]. */
const WATER: readonly (readonly [number, number])[] = [[0, -0.2], [1.8, -0.3], [3, -0.27], [4.5, -0.02], [5.7, 0.1], [DRAW_BACK, 0.1], [8, -0.06], [9.2, -0.4], [10.4, -0.6], [SITS, -0.62], [16, -0.62]];
/** How high the teeth are still wet: [second, m]. */
const WET: readonly (readonly [number, number])[] = [[0, 0.04], [3, -0.02], [4.5, 0.02], [5.7, 0.12], [DRAW_BACK, 0.13], [9, 0.1], [SITS, 0.05], [16, 0.02]];
/** The level of the open sea (m). */
const SEA_FAR = -0.1;

/** The chair at the waterline (m), how far it is turned from facing the sea (deg). */
const CHAIR_X = 0;
const CHAIR_Z = -1.4;
const CHAIR_TURN = -14;
/** The moment of the seated clip (s), and how far the hips sit forward of the chair's middle (m). */
const SIT_POSE = 4.2;
const SIT_FORWARD = 0.04;
/** Her hair: fine strands, thick locks, segments of a strand, length range (m), and how it is carried. */
const HAIR_CURTAIN = 240;
const HAIR_TRESSES = 18;
const HAIR_STREAMERS = 130;
const HAIR_LOCKS = 13;
const HAIR_SEGMENTS = 16;
const HAIR_FALL: readonly [number, number] = [0.8, 1.2];
const HAIR_LENGTH: readonly [number, number] = [1.7, 3.5];
const WIND_BEFORE = new Vector3(0.93, 0.04, 0.36).normalize();
const WIND_AFTER = new Vector3(0.42, 0.02, 0.9).normalize();
/** After the shutter the hair is this much longer (factor over 2 s). */
const HAIR_GROWS = 0.55;

/** The table in the sea (m), how much larger than life, how deep it stands, the lamp over the water (m). */
const TABLE_X = 9;
const TABLE_Z = -38;
const TABLE_SCALE = 1.35;
const TABLE_WADE = 0.25;
const LAMP_OVER = 2.4;
/** The lamp's light (cd), its reach (m), its color. */
const LAMP_POWER = 30;
const LAMP_REACH = 14;
const LAMP_COLOR = 0xffb066;
/** What the lit water gives back to the side of the table facing you (cd, m). */
const TABLE_FRONT_POWER = 14;
const TABLE_FRONT_REACH = 7;

/** The moon in the sky: elevation (deg), radius (rad), how its terminator leans (rad). */
const MOON_ELEVATION = 9.5;
const MOON_RADIUS = 0.045;
const MOON_LEAN = 0.32;
/** Its face: how far past half it is lit when open, and when it has shut like an eyelid on going out (rad the light swings; 0 is exactly half). */
const MOON_PHASE_OPEN = 0.12;
const MOON_PHASE_SHUT = -1.5;
/** Its face: the highlands' brightness, the seas against them, the limb against the centre, the earthshine on its night side, the young craters' shine. */
const MOON_BRIGHT = 2.6;
const MOON_SEA_SHADE = 0.32;
const MOON_LIMB = 0.68;
const MOON_EARTHSHINE = 0.018;
const MOON_RAY = 0.45;
/** Its relief: how hard the craters' walls turn the light, how high their rims stand, the share of cells with one, how much the broad ground breaks the terminator. */
const MOON_CRATER_TILT = 0.06;
const MOON_CRATER_RIM = 0.35;
const MOON_CRATER_EMPTY = 0.35;
const MOON_RELIEF = 0.1;
/** The glow its lit part throws on the sky now that the face is too dim to bloom it: strength, how far out it fades (rad), lean to the lit side (radii). */
const MOON_HALO = 0.32;
const MOON_HALO_REACH = 0.018;
const MOON_HALO_SHIFT = 0.35;
/** How much of the sky's glow still lies over its dark side (the air in front of it). */
const MOON_VEIL = 0.45;
/** How far a cloud takes it away at the worst (0..1). */
const MOON_DIP = 0.94;
/** The moonlight on the beach (it stands low over the sea, behind what you look at). */
const KEY_AT: readonly [number, number, number] = [-1, 5.4, -26];
const KEY_TARGET: readonly [number, number, number] = [-1, 0, 1.5];
const KEY_POWER = 1600;
const KEY_ANGLE = 16;
const KEY_COLOR = 0xc3dae2;
/** A soft sourceless light from up the beach, so that the teeth around the chair are bone and not only an edge. */
const FILL_AT: readonly [number, number, number] = [-2, 12, 26];
const FILL_TARGET: readonly [number, number, number] = [-0.5, 0, 0.5];
const FILL_POWER = 340;
const FILL_ANGLE = 17;
const FILL_COLOR = 0xa9c4bd;
/** A narrow pale light on the chair alone, from nowhere: the one place for the eye (cd, half angle deg). */
const KICK_AT: readonly [number, number, number] = [-1.2, 3.2, 8];
const KICK_TARGET: readonly [number, number, number] = [0, 0.55, -1.4];
const KICK_POWER = 90;
const KICK_ANGLE = 6;
const KICK_COLOR = 0xbfd2d0;

/** The night (the far beach dissolves in it, the sky's horizon is this color). */
const FOG_COLOR = 0x1d2b2e;
const FOG_DENSITY = 0.011;

/** The lens: where it is focused at first and after the pull (m), and how shallow. */
const FOCUS_NEAR = 1.05;
const FOCUS_FAR = 5.6;
const APERTURE = 6;

/** Tile of painted teeth under the real ones: m across, px. */
const TILE_M = 2.2;
const TILE_PX = 2048;
/** Height of a tooth (m), and how many stand on a square meter: under the eye, behind it, in the band just ahead, around the chair, at the water, under the wave. */
const TOOTH_SIZE = 0.074;
const DENSITY_NEAR = 92;
const DENSITY_BEHIND = 45;
const DENSITY_MIX = 110;
const DENSITY_CHAIR = 70;
const DENSITY_WATER = 70;
const DENSITY_SEABED = 22;
/** The few real, sculpted molars that lie right under the eye at the start: how many on a square meter, how long (m). */
const HERO_TEETH = 5;
const HERO_SIZE = 0.108;
/** The same before the chair, in the last frames and the picture the shutter keeps: how many on a square meter, drawn this near (m). */
const HERO_LAST = 3;
const LAST_DETAIL = 4.6;
/** Sides of a bin of instances that the camera can leave out as one (m), real teeth and far ones. */
const CELL_NEAR = 1;
const CELL_FAR = 2.2;
/** How near the eye (m) the sculpted molars and then the real teeth are drawn: beyond that the same teeth, cheaper. */
const HERO_DETAIL = 2.2;
const REAL_DETAIL = 3;
/** The same for real teeth later, when the eye has risen and sees them from further away (m). */
const REAL_DETAIL_LATE = 4;
/** How long one tooth rolls after the water leaves it (s), how far it goes at most (m). */
const ROLL_SECONDS = 2.4;
const ROLL_REACH = 0.9;

/** Grid of the ground, and of the sea (quads). */
const GROUND_COLS = 140;
const GROUND_ROWS = 96;
const SEA_COLS = 72;
const SEA_ROWS = 100;

/** Who stands far up the beach behind you, and how near they come while you do not look (m). */
const WATCH_X = -0.6;
const WATCH_FAR = 38;
const WATCH_NEAR = 21;
/** A low pale light that keeps to the ground just ahead of the eye: the teeth under it are bone, wet, and teeth (cd, m). */
const FOOT_POWER = 2.4;
const FOOT_REACH = 4.6;
const FOOT_COLOR = 0xc4d8cf;

/** Gains: the beds and how far the draw-back lifts the clatter. */
const WAVES_GAIN = 0.25;
const WIND_GAIN = 0.14;
const DRONE_GAIN = 0.12;
const CLATTER_REST = 0.05;
const CLATTER_UP = 0.28;

const ramp = (a: number, b: number, v: number): number => {
  const x = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/** A value through keys [second, value], eased between them. */
function keyed(keys: readonly (readonly [number, number])[], s: number): number {
  if (s <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (s <= keys[i][0]) return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * ramp(keys[i - 1][0], keys[i][0], s);
  }
  return keys[keys.length - 1][1];
}

/** The sea's own time: it slows, and from the moment she is there nothing in it moves any more. */
function seaClock(s: number): number {
  if (s <= SEA_SLOWS) return s;
  const span = SITS - SEA_SLOWS;
  const x = Math.min(s - SEA_SLOWS, span);
  return SEA_SLOWS + x - (x * x) / (2 * span);
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash2 = (x: number, y: number): number => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy) + (hash2(ix + 1, iy) - hash2(ix, iy)) * sx;
  const b = hash2(ix, iy + 1) + (hash2(ix + 1, iy + 1) - hash2(ix, iy + 1)) * sx;
  return a + (b - a) * sy;
}

/** Where the sea meets the beach when the water is at zero: its z at this x (zero under the chair). */
const shoreZ = (x: number): number => SHORE_BEND * (Math.sin(x * 0.075 + 0.5) - Math.sin(0.5)) + 0.35 * (Math.sin(x * 0.23 + 2.1) - Math.sin(2.1));

/** The height of the beach. */
function groundAt(x: number, z: number): number {
  const u = z - shoreZ(x);
  let y = SLOPE * u;
  if (u < -9) y = SLOPE * -9 + (u + 9) * SLOPE * 0.4;
  const land = Math.max(0, u - 7);
  y += Math.min(land * land * 0.0042, 9 + land * 0.02);
  y += 0.05 * Math.exp(-(((u - 2.4) / 1.1) ** 2));
  return y + 0.035 * (valueNoise(x * 0.9, z * 0.9) - 0.5) + 0.02 * (valueNoise(x * 2.7, z * 2.7) - 0.5);
}

type Ring = readonly [number, number, number];

/** A tooth turned on a lathe: each ring is an ellipse (height 0..1 from the root, two half widths); the first and last are points. */
function loft(rings: readonly Ring[], radial: number): BufferGeometry {
  const positions: number[] = [0, rings[0][0] - 0.5, 0];
  const last = rings.length - 1;
  for (let r = 1; r < last; r++) {
    for (let a = 0; a < radial; a++) {
      const angle = (a / radial) * Math.PI * 2;
      positions.push(Math.cos(angle) * rings[r][1], rings[r][0] - 0.5, Math.sin(angle) * rings[r][2]);
    }
  }
  positions.push(0, rings[last][0] - 0.5, 0);
  const top = positions.length / 3 - 1;
  const at = (r: number, a: number) => 1 + (r - 1) * radial + ((a + radial) % radial);
  const index: number[] = [];
  for (let a = 0; a < radial; a++) {
    index.push(0, at(1, a), at(1, a + 1));
    for (let r = 1; r < last - 1; r++) index.push(at(r, a), at(r + 1, a), at(r, a + 1), at(r, a + 1), at(r + 1, a), at(r + 1, a + 1));
    index.push(top, at(last - 1, a + 1), at(last - 1, a));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const INCISOR: readonly Ring[] = [[0, 0, 0], [0.12, 0.035, 0.04], [0.32, 0.07, 0.085], [0.52, 0.09, 0.115], [0.6, 0.095, 0.125], [0.7, 0.15, 0.125], [0.84, 0.2, 0.09], [0.95, 0.225, 0.05], [1, 0, 0]];
const PEG: readonly Ring[] = [[0, 0, 0], [0.35, 0.13, 0.15], [0.62, 0.3, 0.3], [0.85, 0.28, 0.28], [1, 0, 0]];

/** Outlines of a tooth on paper, in a square of 100. */
const TOOTH_OUTLINES = [
  'M22 46 C12 30 18 14 30 14 Q40 22 50 15 Q60 22 70 14 C82 14 88 30 78 46 C76 62 72 80 66 90 Q60 76 54 58 Q50 54 46 58 Q40 76 34 90 C28 80 24 62 22 46 Z',
  'M32 10 Q50 6 68 10 C68 30 62 44 58 52 C58 70 54 86 50 96 C46 86 42 70 42 52 C38 44 32 30 32 10 Z',
  'M50 4 C60 12 68 28 64 44 C60 50 58 54 58 58 C58 74 54 88 50 98 C46 88 42 74 42 58 C42 54 40 50 36 44 C32 28 40 12 50 4 Z',
  'M30 16 Q38 8 48 20 Q58 8 68 16 C76 28 72 42 64 50 C62 66 56 84 50 94 C44 84 38 66 36 50 C28 42 24 28 30 16 Z',
  'M26 20 Q50 10 74 20 Q88 34 80 62 Q72 84 50 84 Q28 84 20 62 Q12 34 26 20 Z',
];
const SPRITE_PX = 128;

function toothSprite(outline: string, seenFromAbove: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SPRITE_PX;
  const g = canvas.getContext('2d')!;
  g.scale(SPRITE_PX / 100, SPRITE_PX / 100);
  const path = new Path2D(outline);
  const paint = g.createLinearGradient(0, 8, 0, 96);
  if (seenFromAbove) {
    paint.addColorStop(0, '#efece2');
    paint.addColorStop(1, '#d8d1bf');
  } else {
    paint.addColorStop(0, '#f4f1e8');
    paint.addColorStop(0.46, '#e6dcc6');
    paint.addColorStop(1, '#94805e');
  }
  g.shadowColor = 'rgba(0,0,0,0.95)';
  g.shadowBlur = 9;
  g.fillStyle = paint;
  g.fill(path);
  g.shadowBlur = 0;
  g.globalCompositeOperation = 'source-atop';
  const round = g.createRadialGradient(46, 30, 4, 50, 48, 56);
  round.addColorStop(0, 'rgba(255,255,255,0.5)');
  round.addColorStop(0.55, 'rgba(255,255,255,0)');
  round.addColorStop(1, 'rgba(10,8,5,0.72)');
  g.fillStyle = round;
  g.fillRect(0, 0, 100, 100);
  if (seenFromAbove) {
    g.strokeStyle = 'rgba(20,16,10,0.7)';
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(30, 44);
    g.quadraticCurveTo(50, 52, 72, 42);
    g.moveTo(50, 22);
    g.quadraticCurveTo(46, 50, 52, 78);
    g.stroke();
  }
  return canvas;
}

/** A square meter of teeth seen from above, repeating: what lies under the real ones and beyond them. */
function paintedTeeth(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE_PX;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#0a0a08';
  g.fillRect(0, 0, TILE_PX, TILE_PX);
  const sprites = TOOTH_OUTLINES.map((o, i) => toothSprite(o, i === 4));
  const random = seeded(77);
  const perMeter = TILE_PX / TILE_M;
  const stamp = (image: HTMLCanvasElement, x: number, y: number, c: number, s: number, alpha: number) => {
    g.globalAlpha = alpha;
    g.setTransform(c, s, -s, c, x, y);
    g.drawImage(image, -SPRITE_PX / 2, -SPRITE_PX / 2);
  };
  const layers: readonly (readonly [number, number, number])[] = [[1500, 0.28, 0.5], [1300, 0.5, 0.72], [1150, 0.72, 1], [650, 0.85, 1]];
  for (const [count, low, high] of layers) {
    for (let i = 0; i < count; i++) {
      const x = random() * TILE_PX;
      const y = random() * TILE_PX;
      const turn = random() * Math.PI * 2;
      const scale = ((TOOTH_SIZE * (0.75 + random() * 0.55)) * perMeter) / SPRITE_PX;
      const image = sprites[Math.floor(random() * sprites.length)];
      const alpha = low + random() * (high - low);
      const c = Math.cos(turn) * scale;
      const s = Math.sin(turn) * scale;
      const reach = SPRITE_PX * scale;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const px = x + dx * TILE_PX;
          const py = y + dy * TILE_PX;
          if (px > -reach && px < TILE_PX + reach && py > -reach && py < TILE_PX + reach) stamp(image, px, py, c, s, alpha);
        }
      }
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** A small repeating field for water and cloud: r smooth, g veined (foam), b and a its slopes. */
function waterNoise(): DataTexture {
  const size = 256;
  const random = seeded(4242);
  const addOctave = (target: Float32Array, cells: number, amount: number) => {
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = random();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells;
      const iy = Math.floor(fy);
      const ty = fy - iy;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const ix = Math.floor(fx);
        const tx = fx - ix;
        const sx = tx * tx * (3 - 2 * tx);
        const x1 = (ix + 1) % cells;
        const y1 = (iy + 1) % cells;
        const a = lattice[iy * cells + ix] + (lattice[iy * cells + x1] - lattice[iy * cells + ix]) * sx;
        const b = lattice[y1 * cells + ix] + (lattice[y1 * cells + x1] - lattice[y1 * cells + ix]) * sx;
        target[y * size + x] += amount * (a + (b - a) * sy);
      }
    }
  };
  const smooth = new Float32Array(size * size);
  addOctave(smooth, 6, 0.5);
  addOctave(smooth, 13, 0.27);
  addOctave(smooth, 26, 0.15);
  addOctave(smooth, 52, 0.08);
  const veins = new Float32Array(size * size);
  addOctave(veins, 9, 0.62);
  addOctave(veins, 23, 0.38);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = smooth[y * size + ((x + 1) % size)] - smooth[y * size + ((x + size - 1) % size)];
      const dy = smooth[((y + 1) % size) * size + x] - smooth[((y + size - 1) % size) * size + x];
      data[i * 4] = Math.min(255, Math.max(0, ((smooth[i] - 0.5) * 1.7 + 0.5) * 255));
      data[i * 4 + 1] = (1 - Math.min(1, Math.abs(2 * veins[i] - 1) * 2.6)) * 255;
      data[i * 4 + 2] = Math.min(255, Math.max(0, (0.5 + dx * 5) * 255));
      data[i * 4 + 3] = Math.min(255, Math.max(0, (0.5 + dy * 5) * 255));
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uClock;
uniform float uMoon;
uniform float uCover;
uniform vec3 uMoonDir;
uniform vec3 uHorizon;
uniform vec3 uZenith;
varying vec3 vDir;

// the dark seas of the near side: centre (selenographic longitude, east to the right; latitude) and half-size, rad
const vec4 MOON_SEAS[12] = vec4[12](
  vec4(-0.95, 0.22, 0.42, 0.55), vec4(-0.5, -0.05, 0.26, 0.2), vec4(-0.28, 0.6, 0.33, 0.3), vec4(0.0, 0.98, 0.65, 0.09),
  vec4(-0.3, -0.37, 0.2, 0.18), vec4(-0.68, -0.42, 0.11, 0.11), vec4(0.31, 0.49, 0.2, 0.19), vec4(0.54, 0.15, 0.25, 0.2),
  vec4(1.03, 0.3, 0.14, 0.12), vec4(0.89, -0.14, 0.18, 0.26), vec4(0.61, -0.26, 0.1, 0.1), vec4(-0.35, 0.12, 0.15, 0.1)
);
// young bright craters: where (longitude, latitude), the size of the bright core, how far their rays reach, rad
const vec4 MOON_BRIGHTS[4] = vec4[4](vec4(-0.2, -0.756, 0.035, 0.32), vec4(-0.35, 0.168, 0.03, 0.16), vec4(-0.66, 0.14, 0.022, 0.1), vec4(-0.83, 0.41, 0.02, 0.05));
// old craters with dark floors: where, and how wide, rad
const vec3 MOON_DARKS[2] = vec3[2](vec3(-0.164, 0.9, 0.05), vec3(-1.19, -0.09, 0.08));

float moonHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// a field of craters, p in cells (at most one to a cell): how their bowls and raised rims tilt the ground
vec2 moonCraters(vec2 p) {
  vec2 cell = floor(p);
  vec2 v = (p - cell - 0.3 - 0.4 * vec2(moonHash(cell), moonHash(cell + 17.3))) / (0.1 + 0.1 * moonHash(cell + 41.7));
  float dv = max(length(v), 1e-3);
  float slope = 2.0 * dv * (1.0 - smoothstep(0.8, 1.0, dv)) - ${(36 * MOON_CRATER_RIM).toFixed(3)} * (dv - 1.0) * exp(-(dv - 1.0) * (dv - 1.0) * 18.0);
  return v / dv * slope * step(${MOON_CRATER_EMPTY.toFixed(3)}, moonHash(cell + 7.1));
}

void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  float a = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
  vec3 sky = mix(uHorizon, uZenith, pow(min(up / 0.5, 1.0), 0.65)) * mix(0.22, 1.0, uMoon);
  vec3 glow = vec3(0.3, 0.46, 0.5) * (exp(-a * a * 9.0) * 0.085 + exp(-a * a * 120.0) * 0.42) * uMoon;

  // the moon's own frame on the sky; as it goes out the light swings behind it (an eyelid shutting), and the glow
  // its lit part throws shrinks with what is still lit
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
  vec3 rise = cross(uMoonDir, side);
  vec2 q = vec2(dot(d, side), dot(d, rise)) / ${MOON_RADIUS.toFixed(4)};
  vec2 lean = vec2(${Math.cos(MOON_LEAN).toFixed(4)}, ${Math.sin(MOON_LEAN).toFixed(4)});
  float ph = mix(${MOON_PHASE_OPEN.toFixed(3)}, ${MOON_PHASE_SHUT.toFixed(3)}, clamp(1.0 - uMoon, 0.0, 1.0));
  float open = (1.0 + sin(ph)) / ${(1 + Math.sin(MOON_PHASE_OPEN)).toFixed(4)} * sqrt(uMoon);
  float past = max(length(q - lean * ${MOON_HALO_SHIFT.toFixed(3)}) - 1.0, 0.0) * ${MOON_RADIUS.toFixed(4)};
  glow += vec3(0.9, 0.94, 0.96) * exp(-past / ${MOON_HALO_REACH.toFixed(4)}) * ${MOON_HALO.toFixed(3)} * open * step(0.0, dot(d, uMoonDir));
  sky += glow;

  // torn cloud, lit only near the moon
  vec2 c = d.xz / (up + 0.18);
  float n = texture2D(uNoise, c * vec2(0.05, 0.11) + vec2(uClock * 0.0022, uClock * 0.0006)).r * 0.6
          + texture2D(uNoise, c * vec2(0.17, 0.33) + vec2(uClock * 0.0041, 0.37)).r * 0.4;
  float cloud = smoothstep(0.54 - uCover * 0.26, 0.82, n) * smoothstep(0.0, 0.1, up);
  vec3 lit = mix(vec3(0.007, 0.012, 0.014), vec3(0.2, 0.27, 0.29), exp(-a * a * 5.0) * uMoon);
  sky = mix(sky, lit, cloud * 0.9);

  // the moon: a ball lit from the side, with dark seas, bright young craters and their rays, and a soft terminator
  // the relief breaks; its night side keeps a little earthshine, so a shut moon is still there
  float r = length(q);
  if (r < 1.03 && dot(d, uMoonDir) > 0.0) {
    float disc = 1.0 - smoothstep(0.985, 1.0, r);
    vec3 nm = vec3(q, sqrt(max(1.0 - r * r, 0.0)));
    vec2 s = vec2(atan(nm.x, max(nm.z, 1e-4)), asin(clamp(nm.y, -1.0, 1.0)));
    vec2 geo = vec2(-s.x, s.y);
    vec2 shore = geo + (vec2(texture2D(uNoise, s * 0.21 + 0.13).r, texture2D(uNoise, s * 0.21 + 0.61).r) - 0.5) * 0.3
      + (vec2(texture2D(uNoise, s * 0.62 + 0.37).r, texture2D(uNoise, s * 0.62 + 0.83).r) - 0.5) * 0.1;
    float sea = 0.0;
    for (int i = 0; i < 12; i++) sea = max(sea, 1.0 - smoothstep(0.7, 1.05, length((shore - MOON_SEAS[i].xy) / MOON_SEAS[i].zw)));
    float rays = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 v = geo - MOON_BRIGHTS[i].xy;
      float dv = length(v) + 1e-4;
      float spokes = smoothstep(0.55, 0.85, texture2D(uNoise, v / dv * 0.3 + MOON_BRIGHTS[i].xy * 3.1).r);
      rays += exp(-dv * dv / (MOON_BRIGHTS[i].z * MOON_BRIGHTS[i].z)) + 0.5 * spokes * exp(-dv / MOON_BRIGHTS[i].w);
    }
    float darks = 0.0;
    for (int i = 0; i < 2; i++) darks = max(darks, 1.0 - smoothstep(0.55, 1.0, length(geo - MOON_DARKS[i].xy) / MOON_DARKS[i].z));
    float grain = texture2D(uNoise, s * 0.33 + 0.7).r * 0.6 + texture2D(uNoise, s * 0.9 + 0.29).r * 0.4;
    float alb = mix(1.0, ${MOON_SEA_SHADE.toFixed(3)}, sea) * (0.8 + 0.4 * mix(grain, 0.5, sea * 0.65)) * (1.0 - 0.45 * darks) + rays * ${MOON_RAY.toFixed(3)};
    vec2 tilt = (moonCraters(s * 3.0) + 0.7 * moonCraters(s * 7.0 + 3.7)) * mix(1.0, 0.3, sea);
    vec3 L = vec3(lean * cos(ph), sin(ph));
    float ndl = dot(nm, L) - ${MOON_CRATER_TILT.toFixed(3)} * dot(tilt, L.xy) + (texture2D(uNoise, s * 0.5 + 0.47).r - 0.5) * ${MOON_RELIEF.toFixed(3)};
    float lit = smoothstep(-0.03, 0.12, ndl) * (0.55 + 0.45 * sqrt(clamp(ndl, 0.0, 1.0))) * mix(${MOON_LIMB.toFixed(3)}, 1.0, sqrt(nm.z));
    vec3 moon = (vec3(1.0, 0.98, 0.93) * lit * ${MOON_BRIGHT.toFixed(3)} * sqrt(uMoon) + vec3(0.6, 0.8, 1.0) * ${MOON_EARTHSHINE.toFixed(4)}) * alb;
    moon = max(moon, glow * ${MOON_VEIL.toFixed(3)}) * (1.0 - cloud * 0.8);
    sky = mix(sky, moon, disc);
  }
  gl_FragColor = vec4(sky, 1.0);
}`;

const SEA_VERT = /* glsl */ `
attribute vec2 aInfo;
uniform float uClock;
uniform float uWater;
varying vec3 vP;
varying vec2 vInfo;

void main() {
  vec3 p = position;
  float u = aInfo.y;
  float level = mix(${SEA_FAR.toFixed(3)}, uWater, smoothstep(-30.0, -8.0, u));
  level += (0.028 * sin(p.x * 0.7 + uClock * 0.4) + 0.02 * sin(p.x * 1.9 - uClock * 0.3)) * smoothstep(-14.0, -5.0, u);
  float crest = pow(0.5 + 0.5 * cos(6.2832 * (u / 6.5 + uClock / 5.0)), 6.0);
  p.y = level + crest * 0.11 * smoothstep(-46.0, -30.0, u) * smoothstep(-5.0, -15.0, u);
  vP = p;
  vInfo = aInfo;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const SEA_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uClock;
uniform float uMoon;
uniform float uWater;
uniform float uLampPower;
uniform vec3 uEye;
uniform vec3 uMoonDir;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uLamp;
uniform vec3 uLampColor;
varying vec3 vP;
varying vec2 vInfo;

void main() {
  vec3 toEye = uEye - vP;
  float dist = length(toEye);
  vec3 V = toEye / dist;
  float t = uClock;
  vec2 p = vP.xz;

  vec4 a = texture2D(uNoise, p * vec2(0.021, 0.047) + vec2(0.004, 0.011) * t);
  vec4 b = texture2D(uNoise, p * vec2(0.064, 0.13) + vec2(-0.012, 0.031) * t);
  vec4 c = texture2D(uNoise, p * vec2(0.19, 0.36) + vec2(0.021, 0.062) * t);
  vec2 slope = (a.ba - 0.5) * 0.35 + (b.ba - 0.5) * 0.5 + (c.ba - 0.5) * 0.7;
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));

  float depth = vP.y - vInfo.x;
  float edge = texture2D(uNoise, p * vec2(0.33, 0.18) + vec2(0.0, t * 0.012)).r;
  float d = depth + (edge - 0.5) * 0.07;
  if (d < -0.03) discard;

  // the sky at a glance, and the dark body of the water
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  vec3 skyHere = mix(uHorizon * 1.15, uZenith, clamp(R.y * 2.5, 0.0, 1.0)) * (0.25 + 0.75 * uMoon);
  vec3 body = mix(vec3(0.012, 0.03, 0.032), vec3(0.003, 0.008, 0.011), smoothstep(0.04, 1.4, d));
  vec3 col = mix(body, skyHere * (0.75 + 0.5 * a.r), F * 0.8);

  // the road of the moon: a column on the water, broken into sparks
  float az = atan(V.x, V.z);
  float e = (uEye.y - vP.y) / dist;
  float wide = mix(0.042, 0.125, smoothstep(0.0, 0.22, e));
  float wob = (texture2D(uNoise, vec2(az * 2.1, e * 6.0 + t * 0.03)).b - 0.5) * 0.09;
  float column = exp(-pow((az + wob) / wide, 2.0));
  float s1 = texture2D(uNoise, vec2(az * 16.0 + t * 0.011, e * 44.0 + az * 3.7 + t * 0.045)).r;
  float s2 = texture2D(uNoise, vec2(az * 27.0 - t * 0.017, e * 69.0 - az * 5.3 - t * 0.062)).r;
  float fine = s1 * s2 * 2.0;
  float spark = smoothstep(0.56 - column * 0.1, 0.72, fine);
  col += vec3(0.86, 0.95, 1.0) * column * (0.04 + spark * 1.7) * uMoon * smoothstep(0.0, 0.08, d);

  // the road of the lamp, narrow and warm, and the pool it makes around the table
  vec2 toLamp = uLamp.xz - uEye.xz;
  float lampAway = length(toLamp);
  float azLamp = atan(-toLamp.x, -toLamp.y);
  float lampColumn = exp(-pow((az - azLamp + wob * 0.2) / 0.012, 2.0));
  float lampSpark = smoothstep(0.42, 0.68, fine);
  float reach = smoothstep(lampAway * 0.22, lampAway * 0.92, dist) * (1.0 - smoothstep(lampAway * 0.985, lampAway * 1.02, dist));
  col += uLampColor * lampColumn * reach * (0.3 + 1.9 * lampSpark) * uLampPower;
  float around = dot(p - uLamp.xz, p - uLamp.xz);
  col += uLampColor * 0.07 * exp(-around / 9.0) * (0.5 + c.r) * uLampPower;

  // foam: lace running over the teeth, lines of it further out, small crests beyond
  float veins = texture2D(uNoise, p * vec2(0.41, 0.23) + vec2(0.02 * t, 0.05 * t - uWater * 0.5)).g;
  float fineVeins = texture2D(uNoise, p * vec2(1.05, 0.62) + vec2(-0.03 * t, 0.07 * t - uWater * 1.1)).g;
  float lace = smoothstep(0.55, 0.92, veins) + smoothstep(0.6, 0.95, fineVeins) * 0.5;
  float rim = smoothstep(0.055, 0.0, abs(d - 0.018));
  float sheet = smoothstep(0.24, 0.0, d);
  float line1 = exp(-pow((d - 0.17) / 0.055, 2.0));
  float line2 = exp(-pow((d - 0.42) / 0.09, 2.0));
  float crest = pow(0.5 + 0.5 * cos(6.2832 * (vInfo.y / 6.5 + t / 5.0 + (a.r - 0.5) * 0.7)), 14.0) * smoothstep(-46.0, -30.0, vInfo.y) * smoothstep(-6.0, -15.0, vInfo.y);
  float foam = clamp(rim * (0.3 + 0.7 * lace) + sheet * lace * 0.55 + line1 * lace * 0.85 + line2 * lace * 0.5 + crest * lace * 0.8, 0.0, 1.0);

  float alpha = smoothstep(-0.005, 0.03, d) * mix(0.3, 0.97, smoothstep(0.02, 0.38, d));
  col = mix(col, vec3(0.72, 0.8, 0.8) * (0.05 + 0.95 * uMoon), foam);
  alpha = max(alpha, foam * smoothstep(-0.02, 0.01, d));

  // the far end dissolves into what the sky is at its foot
  vec3 toFar = normalize(vec3(-V.x, 0.0, -V.z));
  float m = acos(clamp(dot(toFar, uMoonDir), -1.0, 1.0));
  vec3 foot = uHorizon * mix(0.22, 1.0, uMoon) + vec3(0.3, 0.46, 0.5) * (exp(-m * m * 9.0) * 0.085 + exp(-m * m * 120.0) * 0.42) * uMoon;
  col = mix(col, foot, smoothstep(100.0, 198.0, dist));
  gl_FragColor = vec4(col, alpha);
}`;

const HAIR_VERT = /* glsl */ `
attribute vec3 aRoot;
attribute vec4 aStrand;
uniform float uTime;
uniform float uLength;
uniform float uMotion;
uniform float uFloor;
uniform vec3 uWind;
varying float vS;
varying float vBright;
varying float vFade;

vec3 curve(float s, float loose) {
  float k = aStrand.y;
  float lock = aStrand.w * 6.2832;
  float L = aStrand.x;
  vec3 across = normalize(cross(uWind, vec3(0.0, 1.0, 0.0)));
  float gust = 0.8 + 0.2 * sin(uTime * 0.9 + lock * 0.5) + 0.08 * sin(uTime * 2.3 + k * 6.0);
  vec3 p = aRoot;
  if (loose < 0.5) {
    // the fall of it: combed over the skull from the crown, over the top of the chair, down to the teeth
    float arc = min(s / 0.14, 1.0) * 1.5708;
    float drop = max(s - 0.14, 0.0) / 0.86;
    p = vec3(aRoot.x * sin(arc), aRoot.y + (0.19 - aRoot.y) * cos(arc), aRoot.z * sin(arc));
    p.y -= L * 0.86 * drop;
    p.x = mix(p.x * (1.0 + 0.3 * smoothstep(0.0, 0.25, drop)), (aStrand.w - 0.5) * 0.26 + (k - 0.5) * 0.04, smoothstep(0.1, 0.5, drop));
    p.z += 0.19 * smoothstep(0.0, 0.2, drop);
    float low = pow(drop, 2.6);
    p += uWind * low * gust * (0.25 + k * 0.5) * (1.0 + (uLength - 1.0) * 1.2);
    p += across * (0.008 + 0.05 * low) * uMotion * sin(drop * 12.0 - uTime * 2.4 + lock);
  } else {
    // what the wind has taken from it: a few long locks
    L *= uLength;
    float fall = (fract(aStrand.w * 3.1) * 0.24 - 0.02) * (1.0 - pow(1.0 - s, 2.5));
    p += vec3(0.0, -fall * L, 0.0) + uWind * pow(s, 1.25) * 0.95 * gust * L;
    float amp = (s * s * 0.075 * uMotion + s * 0.012) * L;
    p.y += amp * (sin(s * 6.0 - uTime * 2.7 + lock) * 0.6 + sin(s * 11.0 - uTime * 3.9 + lock * 2.3 + k * 9.0) * 0.4 + sin(s * 23.0 - uTime * 5.3 + k * 31.0) * 0.16);
    p += across * amp * 0.7 * sin(s * 4.5 - uTime * 2.1 + lock * 1.7);
    p += across * (k - 0.5) * s * L * 0.05 + vec3(0.0, (fract(k * 7.3) - 0.5) * s * L * 0.04, 0.0);
  }
  p.y = max(p.y, uFloor + ${SLOPE.toFixed(4)} * p.z + 0.02 + k * 0.03);
  return p;
}

void main() {
  float s = position.x;
  float loose = position.z;
  vec3 p = curve(s, loose);
  vec3 tangent = curve(min(s + 0.02, 1.0), loose) - curve(max(s - 0.02, 0.0), loose);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 t = normalize((modelViewMatrix * vec4(tangent, 0.0)).xyz);
  vec3 side = normalize(cross(t, normalize(mv.xyz)));
  float meters = aStrand.z * sqrt(1.0 - s) * smoothstep(0.0, 0.03, s + 0.02);
  float pixel = 2.0 * -mv.z / (projectionMatrix[1][1] * 900.0);
  float half_ = max(meters, pixel * 0.55);
  mv.xyz += side * position.y * half_;
  vS = s;
  vBright = (loose < 0.5 ? 0.42 : 0.62) + 0.38 * fract(aStrand.y * 31.7);
  vFade = clamp(meters / (pixel * 0.55), 0.25, 1.0) * (loose < 0.5 ? 0.52 : 0.62);
  gl_Position = projectionMatrix * mv;
}`;

const HAIR_FRAG = /* glsl */ `
uniform float uLight;
varying float vS;
varying float vBright;
varying float vFade;

void main() {
  float alpha = vFade * (1.0 - smoothstep(0.72, 1.0, vS));
  gl_FragColor = vec4(vec3(0.88, 0.9, 0.89) * vBright * uLight, alpha);
}`;

const TOOTH_VERT_HEAD = /* glsl */ `
attribute vec4 aMotion;
attribute float aGround;
uniform float uRoll;
uniform float uMotion;
varying float vHigh;
varying float vToothY;
varying float vContact;
varying float vRolling;
vec3 tumble(vec3 v, vec3 k, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}`;

const TOOTH_SPIN = /* glsl */ `
float rollAt = clamp((uRoll - aMotion.y) / ${ROLL_SECONDS.toFixed(2)}, 0.0, 1.0);
float eased = rollAt * rollAt * (3.0 - 2.0 * rollAt);
float stutter = eased + 0.14 * sin(rollAt * 27.0 + aMotion.x * 40.0) * rollAt * (1.0 - rollAt);
float travel = aMotion.z * stutter * uMotion;
vRolling = step(0.001, aMotion.z) * rollAt * (1.0 - rollAt) * 4.0;
vec3 spinAxis = normalize(vec3(sin(aMotion.x * 91.0), cos(aMotion.x * 47.0), sin(aMotion.x * 23.0) + 0.01));
float spinAngle = travel * aMotion.w;
objectNormal = tumble(objectNormal, spinAxis, spinAngle);`;

const TOOTH_TURN = /* glsl */ `
transformed = tumble(transformed, spinAxis, spinAngle);
vToothY = position.y + 0.5;`;

const TOOTH_PLACE = /* glsl */ `
vec4 placed = instanceMatrix * vec4(transformed, 1.0);
float hop = 0.08 * abs(sin(rollAt * 11.0 + aMotion.x * 17.0)) * (1.0 - rollAt) * rollAt * step(0.001, aMotion.z);
float sunk = travel * ${SLOPE.toFixed(4)};
placed.y += hop - sunk;
placed.z -= travel;
vHigh = aGround;
vContact = placed.y - (aGround - sunk);
vec4 mvPosition = modelViewMatrix * placed;
gl_Position = projectionMatrix * mvPosition;`;

const WET_HEAD = /* glsl */ `
uniform float uWet;
varying float vHigh;
varying float vToothY;
varying float vContact;
varying float vRolling;
float wetness;
float crownOf;`;

const TOOTH_COLOR = /* glsl */ `
wetness = 1.0 - smoothstep(uWet - 0.01, uWet + 0.07, vHigh);
crownOf = smoothstep(0.42, 0.58, vToothY);
diffuseColor.rgb *= mix(vec3(0.42, 0.29, 0.15), vec3(1.0, 0.985, 0.92), crownOf);
diffuseColor.rgb *= mix(0.14, 1.0, smoothstep(0.0, 0.06, vContact));
diffuseColor.rgb *= mix(1.0, 0.72, wetness) * (1.0 + vRolling * 0.3);`;

const TOOTH_ROUGH = /* glsl */ `
roughnessFactor = mix(0.26 - 0.08 * crownOf, 0.13 + 0.12 * (1.0 - crownOf), wetness) * (1.0 - 0.5 * vRolling);`;

const forward = new Vector3();
const right = new Vector3();
const up = new Vector3();
const away = new Vector3();

interface Bin {
  kind: number;
  /** 0: always drawn; above 0: only nearer than this (m); below 0: only further than its size. */
  detail: number;
  top: number;
  reach: number;
  matrices: number[];
  colors: number[];
  motion: number[];
  ground: number[];
}

/**
 * A night beach under a half moon, and the shore is teeth. A chair stands at the waterline; far out a table
 * stands in the sea with its lamp on. A wave draws back and every tooth on the beach rolls after it; a cloud
 * crosses the moon; when the light returns someone is sitting on the chair with their back to you, and the
 * sea has stopped. Only the white hair still moves.
 */
export default class Teeth extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: FOG_COLOR, density: FOG_DENSITY },
    env: 'evening',
    envIntensity: 0.12,
    sky: 0,
    grade: { exposure: 1.15, saturation: 0.8, warmth: 0, tint: -0.02, flare: 0.002 },
  };
  film = { bloom: 0.9, bloomFrom: 0.8, grain: 0.42, scratches: 0.06, flicker: 0.025, weave: REDUCED_MOTION ? 0 : 0.0004 };
  focus = FOCUS_NEAR;
  aperture = APERTURE;
  drift = REDUCED_MOTION ? 0 : 0.7;
  fear = 0.35;

  private readonly moonDir = new Vector3(0, Math.sin(MOON_ELEVATION * DEG), -Math.cos(MOON_ELEVATION * DEG));
  private readonly noise = waterNoise();
  private readonly tile = paintedTeeth();
  private readonly u = {
    clock: { value: 0 },
    water: { value: keyed(WATER, 0) },
    wet: { value: keyed(WET, 0) },
    roll: { value: -DRAW_BACK },
    moon: { value: 1 },
    cover: { value: 0 },
    motion: { value: REDUCED_MOTION ? 0.4 : 1 },
    eye: { value: new Vector3() },
    lampPower: { value: 1 },
  };
  private readonly hairU = {
    uTime: { value: 0 },
    uLength: { value: 1 },
    uMotion: { value: REDUCED_MOTION ? 0.4 : 1 },
    uFloor: { value: 0 },
    uWind: { value: WIND_BEFORE.clone() },
    uLight: { value: 1.15 },
  };
  private readonly dome: Mesh;
  private readonly key: SpotSpec;
  private readonly fill: SpotSpec;
  private readonly kick: SpotSpec;
  private readonly sitter: Crowd;
  private readonly hair: Mesh;
  private readonly lampLight: DreamLight;
  private readonly lampFace: MeshBasicMaterial;
  private readonly watchers: { crowd: Crowd; x: number }[] = [];
  private readonly watcherRoots: Crowd['root'][] = [];
  private readonly bins: { mesh: InstancedMesh; center: Vector3; radius: number; top: number; detail: number; drowned: boolean }[] = [];
  private readonly footLight: DreamLight;
  private readonly motes: { value: number }[] = [];
  private watchZ = WATCH_FAR;
  private seated = false;
  private shadowFrames = 0;
  private realDetail = REAL_DETAIL;
  private waves: RoomVoice | null = null;
  private wind: RoomVoice | null = null;
  private clatter: RoomVoice | null = null;
  private backwash: RoomVoice | null = null;

  constructor(ctx: RoomContext) {
    super(ctx);
    const at = (x: number, z: number, eye: number): readonly [number, number, number] => [x, groundAt(x, z) + eye, z];
    this.keys = [
      { t: 0, at: at(-3.9, 4.6, 0.36), yaw: -24, pitch: -6.5, roll: -1.4, fov: 47 },
      { t: 0.25, at: at(-3, 4.5, 0.5), yaw: -20, pitch: -6.2, roll: -0.8, fov: 46 },
      { t: 0.5, at: at(-1.85, 4.35, 0.8), yaw: -12, pitch: -5.6, roll: 0.1, fov: 44 },
      { t: SITS / this.seconds, at: at(-0.5, 4.2, 1.04), yaw: -3, pitch: -4.8, roll: 0.5, fov: 42 },
      { t: SHUTTER / this.seconds, at: at(0, 4.1, 1.15), yaw: 0, pitch: -4, roll: 0, fov: 40.5 },
      { t: 1, at: at(0.15, 3.85, 1.18), yaw: 0.6, pitch: -3.6, roll: 0, fov: 39 },
    ];

    const tile = this.tile;
    this.dome = this.buildSky();
    this.buildGround(tile);
    this.scatterTeeth();
    this.buildSea();

    // the chair, facing the table
    const turn = 180 + CHAIR_TURN;
    const groundY = groundAt(CHAIR_X, CHAIR_Z);
    this.kit.prop('chair_ladder', [CHAIR_X, groundY - 0.012, CHAIR_Z], { rotation: [0, turn, 0], castShadow: true }, this.root);

    // whoever sits on it: only their shape and their hair, the body is dark against the water
    const spec: FigureSpec = { avatar: 'figure_man', clip: 'm_sit_chair_idle_roll_head', time: SIT_POSE, face: 'blank', bleach: 0.1, tint: 0x2c2d30 };
    const probe = this.kit.figures.hero(spec);
    probe.update(SIT_POSE);
    probe.root.updateMatrixWorld(true);
    const hips = probe.bone('Bip01')!.getWorldPosition(new Vector3());
    const head = probe.bone('Bip01_Head')!.getWorldPosition(new Vector3());
    const heading = turn * DEG;
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const bodyX = CHAIR_X - (hips.x * c + hips.z * s) + SIT_FORWARD * s;
    const bodyZ = CHAIR_Z - (-hips.x * s + hips.z * c) + SIT_FORWARD * c;
    const bodyY = groundY - 0.012;
    this.sitter = this.kit.figures.crowd(spec, 1);
    this.sitter.set(0, bodyX, bodyY, bodyZ, heading);
    this.sitter.commit();
    this.sitter.root.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = true;
    });
    this.sitter.root.visible = false;
    this.root.add(this.sitter.root);
    const headX = bodyX + (head.x * c + head.z * s);
    const headZ = bodyZ + (-head.x * s + head.z * c);
    const headY = bodyY + head.y;
    this.hair = this.buildHair(headX, headY, headZ);
    this.hair.visible = false;
    this.root.add(this.hair);

    const lamp = this.buildTable();
    this.lampFace = lamp.face;
    this.lampLight = this.light(lamp.at, LAMP_COLOR, LAMP_POWER, LAMP_REACH);
    this.buildWatchers();
    this.footLight = this.light([0, 0, 0], FOOT_COLOR, FOOT_POWER, FOOT_REACH);
    this.light([TABLE_X, 0.9, TABLE_Z + 2.6], LAMP_COLOR, TABLE_FRONT_POWER, TABLE_FRONT_REACH);
    this.motes.push(this.build.motes(150, { x: [-12, 9], y: [0.1, 3], z: [-7, 7] }, this.root, { size: 0.011, color: 0xcfe0e4, strength: 0.26, seed: 11 }).time);

    this.key = this.spot(KEY_AT, KEY_TARGET, KEY_COLOR, KEY_POWER, KEY_ANGLE, 0.55);
    this.fill = this.spot(FILL_AT, FILL_TARGET, FILL_COLOR, FILL_POWER, FILL_ANGLE, 1);
    this.kick = this.spot(KICK_AT, KICK_TARGET, KICK_COLOR, KICK_POWER, KICK_ANGLE, 0.9);
    this.spots = [this.key, this.fill, this.kick];

    const tink = (n: 1 | 3 | 5, pan: number, gain: number, rate: number) => this.sound.play(`rooms/tooth_tink_${n}.mp3`, { gain, pan, rate, reverb: 0.15 });
    this.beat(0, () => {
      this.waves = this.sound.bed('rooms/waves_teeth.mp3', { gain: WAVES_GAIN, reverb: 0.1, fade: 0.7 });
      this.wind = this.sound.bed('rooms/night_wind_far.mp3', { gain: WIND_GAIN, lowpass: 1200, fade: 0.7 });
      this.clatter = this.sound.bed('rooms/pebbles_only.mp3', { gain: CLATTER_REST, fade: 2 });
      this.sound.bed('rooms/dream_drone_low.mp3', { gain: DRONE_GAIN, fade: 3 });
    });
    // the sea stands at its highest and holds its breath
    this.beat(AT_HOLD, () => this.waves?.gain(WAVES_GAIN * 0.45, 1.2));
    this.beat(DRAW_BACK, () => {
      this.backwash = this.sound.play('rooms/wave_draw_back.mp3', { gain: 0.5 });
      this.waves?.gain(WAVES_GAIN * 0.8, 0.6);
      this.clatter?.gain(CLATTER_UP, 0.5);
    });
    this.beat(AT_SCATTER, () => this.sound.play('rooms/teeth_scatter.mp3', { gain: 0.3, pan: -0.35, reverb: 0.15 }));
    // the cloud: the whole beach goes quiet, and a real silence opens
    this.beat(AT_QUIET, () => {
      this.waves?.gain(0, 0.8);
      this.clatter?.gain(0, 0.8);
      this.backwash?.gain(0, 0.8);
      this.wind?.gain(WIND_GAIN * 0.15, 0.8);
    });
    this.beat(AT_TINK, () => tink(3, -0.3, 0.32, 0.92));
    this.beat(AT_TINK_NEXT, () => tink(1, 0.18, 0.26, 1.06));
    this.beat(SITS, () => this.wind?.gain(0, 0.08));
    // only the wind comes back, and thinly
    this.beat(AT_WIND, () => this.wind?.gain(WIND_GAIN * 1.5, 1.2));
    this.beat(AT_BREATH, () => this.sound.play('rooms/breath_in.mp3', { gain: 0.25 }));
    this.beat(SHUTTER, () => this.shutter());
    this.beat(AT_LAST, () => tink(5, 0.25, 0.22, 0.86));
    this.beat(CUT, () => this.sound.stopAll(0.05));
  }

  private buildSky(): Mesh {
    const material = new ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uNoise: { value: this.noise },
        uClock: this.u.clock,
        uMoon: this.u.moon,
        uCover: this.u.cover,
        uMoonDir: { value: this.moonDir },
        uHorizon: { value: new Color(FOG_COLOR) },
        uZenith: { value: new Color(0x0a1215) },
      },
    });
    const dome = new Mesh(new SphereGeometry(200, 36, 22), material);
    dome.frustumCulled = false;
    // after the piece's own black sky, and behind everything by depth
    dome.renderOrder = 2.5;
    this.root.add(dome);
    return dome;
  }

  private buildGround(tile: CanvasTexture): void {
    const count = (GROUND_COLS + 1) * (GROUND_ROWS + 1);
    const positions = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const colors = new Float32Array(count * 3);
    let v = 0;
    for (let j = 0; j <= GROUND_ROWS; j++) {
      const w = (j / GROUND_ROWS) * 2 - 1;
      const z = 1 + Math.sign(w) * (0.08 * Math.abs(w) + 0.92 * Math.abs(w) ** 3) * 74;
      for (let i = 0; i <= GROUND_COLS; i++) {
        const c = (i / GROUND_COLS) * 2 - 1;
        const x = -1 + Math.sign(c) * (0.06 * Math.abs(c) + 0.94 * Math.abs(c) ** 3) * 215;
        positions.set([x, groundAt(x, z), z], v * 3);
        uvs.set([(x + 0.7 * Math.sin(z * 0.37)) / TILE_M, (z + 0.7 * Math.sin(x * 0.29)) / TILE_M], v * 2);
        const u = z - shoreZ(x);
        const patch = 0.62 + 0.55 * valueNoise(x * 0.35 + 9, z * 0.35);
        const tide = 1 + 0.12 * Math.sin(u * 2.4 + valueNoise(x * 0.2, z * 0.2) * 5);
        const dull = 1 - 0.4 * ramp(10, 40, u);
        colors.fill(patch * tide * dull, v * 3, v * 3 + 3);
        v++;
      }
    }
    const index = new Uint32Array(GROUND_COLS * GROUND_ROWS * 6);
    let n = 0;
    for (let j = 0; j < GROUND_ROWS; j++) {
      for (let i = 0; i < GROUND_COLS; i++) {
        const a = j * (GROUND_COLS + 1) + i;
        const b = a + 1;
        const c = a + GROUND_COLS + 1;
        const d = c + 1;
        index.set([a, c, b, b, c, d], n);
        n += 6;
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.computeVertexNormals();
    const material = new MeshStandardMaterial({ map: tile, bumpMap: tile, bumpScale: 2, roughness: 0.36, metalness: 0, vertexColors: true, color: 0x8c8c86 });
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uWet = this.u.wet;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vHigh;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHigh = position.y;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uWet;\nvarying float vHigh;\nfloat wetness;')
        .replace('#include <color_fragment>', '#include <color_fragment>\nwetness = 1.0 - smoothstep(uWet - 0.01, uWet + 0.07, vHigh);\ndiffuseColor.rgb *= mix(1.0, 0.66, wetness);')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.2, wetness);');
    };
    material.customProgramCacheKey = () => 'teeth-ground';
    const mesh = new Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.root.add(mesh);
  }

  /** A real tooth from a model, baked to floats, centered, one unit tall, its crown up. */
  private toothFrom(key: string): BufferGeometry {
    const scene = this.kit.model(key).scene;
    scene.updateMatrixWorld(true);
    const meshes: Mesh[] = [];
    scene.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    });
    const source = meshes[0];
    const position = source.geometry.getAttribute('position');
    const normal = source.geometry.getAttribute('normal');
    const positions = new Float32Array(position.count * 3);
    const normals = new Float32Array(position.count * 3);
    const toNormal = new Matrix3().getNormalMatrix(source.matrixWorld);
    const p = new Vector3();
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(source.matrixWorld).toArray(positions, i * 3);
      p.fromBufferAttribute(normal, i).applyMatrix3(toNormal).normalize().toArray(normals, i * 3);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setAttribute('normal', new BufferAttribute(normals, 3));
    if (source.geometry.index) g.setIndex(source.geometry.index.clone());
    g.center();
    g.computeBoundingBox();
    const height = g.boundingBox!.max.y - g.boundingBox!.min.y;
    g.scale(1 / height, 1 / height, 1 / height);
    return g;
  }

  private scatterTeeth(): void {
    const kinds = [this.toothFrom('molar_low'), loft(INCISOR, 7), loft(PEG, 5), this.toothFrom('molar')];
    const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0 });
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uRoll = this.u.roll;
      shader.uniforms.uMotion = this.u.motion;
      shader.uniforms.uWet = this.u.wet;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${TOOTH_VERT_HEAD}`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${TOOTH_SPIN}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${TOOTH_TURN}`)
        .replace('#include <project_vertex>', TOOTH_PLACE);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${WET_HEAD}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${TOOTH_COLOR}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${TOOTH_ROUGH}`);
    };
    material.customProgramCacheKey = () => 'teeth-tooth';

    const random = seeded(2026);
    const bins = new Map<number, Bin>();
    const yAxis = new Vector3(0, 1, 0);
    const lay = new Vector3();
    const spin = new Quaternion();
    const tilt = new Quaternion();
    const turn = new Quaternion();
    const place = new Vector3();
    const size = new Vector3();
    const matrix = new Matrix4();
    const waterTop = WATER.reduce((m, k) => Math.max(m, k[1]), -9);
    const waterLow = WATER.reduce((m, k) => Math.min(m, k[1]), 9);

    /** kind: 0 a real molar, 1 an incisor, 2 a far peg, 3 a sculpted molar, 4 one for the last frames; `lyingShare` how many lie on their side. */
    const put = (kind: number, x: number, z: number, length: number, layer: number, lyingShare = 0.72) => {
      const g = groundAt(x, z);
      const lying = random() < lyingShare;
      spin.setFromAxisAngle(yAxis, random() * Math.PI * 2);
      const a = random() * Math.PI * 2;
      lay.set(Math.cos(a), 0, Math.sin(a));
      tilt.setFromAxisAngle(lay, lying ? Math.PI / 2 + (random() - 0.5) * 0.9 : random() < 0.7 ? (random() - 0.5) * 0.6 : Math.PI + (random() - 0.5) * 0.6);
      turn.setFromAxisAngle(yAxis, random() * Math.PI * 2).multiply(tilt).multiply(spin);
      const half = length * (lying ? 0.27 : 0.5);
      place.set(x, g + half * (0.3 + 0.55 * random()) + layer * length * 0.28, z);
      size.set(length * (0.9 + random() * 0.2), length, length * (0.9 + random() * 0.2));
      matrix.compose(place, turn, size);
      const shade = random();
      const pale = shade < 0.1 ? 0.26 + random() * 0.2 : 0.62 + random() * 0.38;
      const r = random();
      const zone = ramp(waterTop + 0.02, waterTop - 0.18, g);
      const reach = zone * (0.15 + 0.75 * r * r) * ROLL_REACH;
      const red = pale * (0.96 + random() * 0.04);
      const seed = random();
      const delay = ramp(waterTop, waterLow, g) * 1.5 + random() * 0.7;
      const rate = 10 + random() * 24;
      const store = (into: number, detail: number) => {
        const cell = kind === 2 ? CELL_FAR : CELL_NEAR;
        const key = (into + 1) * 1e7 + (detail === 0 ? 0 : detail > 0 ? 1e6 : 2e6) + (Math.floor(x / cell) + 500) * 1e3 + Math.floor(z / cell) + 500;
        let bin = bins.get(key);
        if (!bin) {
          bin = { kind: into, detail, top: -9, reach: 0, matrices: [], colors: [], motion: [], ground: [] };
          bins.set(key, bin);
        }
        bin.top = Math.max(bin.top, g);
        bin.reach = Math.max(bin.reach, reach);
        for (const e of matrix.elements) bin.matrices.push(e);
        bin.colors.push(red, pale * 0.95, pale * 0.87);
        bin.motion.push(seed, delay, reach, rate);
        bin.ground.push(g);
      };
      if (kind === 3 || kind === 4) {
        const near = kind === 3 ? HERO_DETAIL : LAST_DETAIL;
        store(3, near);
        store(0, -near);
      } else if (kind === 2) store(2, 0);
      else {
        store(kind, REAL_DETAIL);
        store(2, -REAL_DETAIL);
      }
    };
    const field = (x0: number, x1: number, z0: number, z1: number, density: number, each: (x: number, z: number) => void) => {
      const step = 1 / Math.sqrt(density);
      for (let z = z0; z < z1; z += step) {
        for (let x = x0; x < x1; x += step) each(x + (random() - 0.5) * step * 1.15, z + (random() - 0.5) * step * 1.15);
      }
    };
    const real = (x: number, z: number) => {
      const incisor = random() < 0.24;
      put(incisor ? 1 : 0, x, z, TOOTH_SIZE * (incisor ? 1.15 : 1) * (0.85 + random() * 0.4), random() < 0.3 ? 1 : 0);
    };
    field(-2.4, 2.4, -0.2, 1.5, HERO_LAST, (x, z) => put(4, x, z, HERO_SIZE * (1.15 + random() * 0.35), 1, 0.35));
    field(-5.4, -1.2, 3.1, 4.4, HERO_TEETH, (x, z) => put(3, x, z, HERO_SIZE * (0.85 + random() * 0.4), 1, 0.45));
    field(-9, 4.5, 2.3, 4.7, DENSITY_NEAR, real);
    field(-9, 4.5, 4.7, 7, DENSITY_BEHIND, real);
    field(-9, 4.5, 1.2, 2.3, DENSITY_MIX, (x, z) => {
      if (random() < 0.5) real(x, z);
      else put(2, x, z, TOOTH_SIZE * (0.95 + random() * 0.4), random() < 0.3 ? 1 : 0);
    });
    field(-3.2, 3.2, -0.2, 1.2, DENSITY_MIX, real);
    field(CHAIR_X - 1.4, CHAIR_X + 1.4, CHAIR_Z - 1.4, CHAIR_Z + 1.4, DENSITY_CHAIR, (x, z) => put(2, x, z, TOOTH_SIZE * (1 + random() * 0.45), random() < 0.3 ? 1 : 0, 0.5));
    field(-18, 13, -1.2, 1.2, DENSITY_WATER, (x, z) => {
      if (Math.abs(x) >= 3.2 || z <= -0.2) put(2, x, z, TOOTH_SIZE * (1 + random() * 0.45), random() < 0.3 ? 1 : 0, 0.5);
    });
    field(-16, 12, -9.5, -1.2, DENSITY_SEABED, (x, z) => put(2, x, z, TOOTH_SIZE * (1.15 + random() * 0.55), random() < 0.25 ? 1 : 0, 0.5));

    for (const bin of bins.values()) {
      const shape = kinds[bin.kind];
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', shape.getAttribute('position'));
      geometry.setAttribute('normal', shape.getAttribute('normal'));
      geometry.setIndex(shape.index);
      geometry.setAttribute('aMotion', new InstancedBufferAttribute(new Float32Array(bin.motion), 4));
      geometry.setAttribute('aGround', new InstancedBufferAttribute(new Float32Array(bin.ground), 1));
      const mesh = new InstancedMesh(geometry, material, bin.ground.length);
      mesh.instanceMatrix.array.set(bin.matrices);
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(bin.colors), 3);
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.root.add(mesh);
      this.bins.push({ mesh, center: mesh.boundingSphere!.center, radius: mesh.boundingSphere!.radius + bin.reach + 0.1, top: bin.top, detail: bin.detail, drowned: false });
    }
  }

  private buildSea(): void {
    const count = (SEA_COLS + 1) * (SEA_ROWS + 1);
    const positions = new Float32Array(count * 3);
    const info = new Float32Array(count * 2);
    let v = 0;
    for (let j = 0; j <= SEA_ROWS; j++) {
      const w = j / SEA_ROWS;
      const away = ((Math.exp(7.5 * w) - 1) / (Math.exp(7.5) - 1)) * 212;
      for (let i = 0; i <= SEA_COLS; i++) {
        const c = (i / SEA_COLS) * 2 - 1;
        const x = -1 + Math.sign(c) * Math.abs(c) ** 2.4 * 215;
        const z = shoreZ(x) + 2.6 - away;
        positions.set([x, 0, z], v * 3);
        info.set([groundAt(x, z), z - shoreZ(x)], v * 2);
        v++;
      }
    }
    const index = new Uint32Array(SEA_COLS * SEA_ROWS * 6);
    let n = 0;
    for (let j = 0; j < SEA_ROWS; j++) {
      for (let i = 0; i < SEA_COLS; i++) {
        const a = j * (SEA_COLS + 1) + i;
        const b = a + 1;
        const c = a + SEA_COLS + 1;
        const d = c + 1;
        index.set([a, b, c, b, d, c], n);
        n += 6;
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aInfo', new BufferAttribute(info, 2));
    geometry.setIndex(new BufferAttribute(index, 1));
    const material = new ShaderMaterial({
      vertexShader: SEA_VERT,
      fragmentShader: SEA_FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uNoise: { value: this.noise },
        uClock: this.u.clock,
        uWater: this.u.water,
        uMoon: this.u.moon,
        uLampPower: this.u.lampPower,
        uEye: this.u.eye,
        uMoonDir: { value: this.moonDir },
        uHorizon: { value: new Color(FOG_COLOR) },
        uZenith: { value: new Color(0x0a1215) },
        uLamp: { value: new Vector3(TABLE_X, LAMP_OVER, TABLE_Z) },
        uLampColor: { value: new Color(LAMP_COLOR) },
      },
    });
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.root.add(mesh);
  }

  private buildHair(x: number, y: number, z: number): Mesh {
    const random = seeded(91);
    const strands = HAIR_CURTAIN + HAIR_STREAMERS;
    const perStrand = (HAIR_SEGMENTS + 1) * 2;
    const vertices = strands * perStrand;
    const along = new Float32Array(vertices * 3);
    const roots = new Float32Array(vertices * 3);
    const params = new Float32Array(vertices * 4);
    const index = new Uint32Array(strands * HAIR_SEGMENTS * 6);
    const lockSeeds = Array.from({ length: HAIR_LOCKS }, () => random());
    const tressSeeds = Array.from({ length: HAIR_TRESSES }, () => random());
    let v = 0;
    let n = 0;
    for (let i = 0; i < strands; i++) {
      const loose = i >= HAIR_CURTAIN;
      // the fall starts at the crown and ends on the rim of the skull that faces you; a few loose strands fly from the crown
      const fromFall = loose && random() > 0.18;
      const theta = random() * Math.PI * (loose ? 2 : 1);
      const phi = loose ? Math.acos(random() * 1.25 - 0.25) : Math.PI / 2;
      const rx = fromFall ? (random() - 0.5) * 0.24 : Math.cos(theta) * Math.sin(phi) * 0.106;
      const ry = fromFall ? -0.18 - random() * 0.52 : loose ? Math.cos(phi) * 0.1 + 0.08 : 0.05;
      const rz = fromFall ? 0.26 + random() * 0.04 : Math.sin(theta) * Math.sin(phi) * 0.105;
      const range = loose ? HAIR_LENGTH : HAIR_FALL;
      const length = range[0] + random() * (range[1] - range[0]);
      const width = 0.0012 + random() * (loose ? 0.0018 : 0.002);
      const seed = random();
      const lock = loose ? lockSeeds[i % HAIR_LOCKS] : tressSeeds[i % HAIR_TRESSES];
      for (let k = 0; k <= HAIR_SEGMENTS; k++) {
        const s = k / HAIR_SEGMENTS;
        for (const side of [-1, 1]) {
          along.set([s, side, loose ? 1 : 0], v * 3);
          roots.set([rx, ry, rz], v * 3);
          params.set([length, seed, width, lock], v * 4);
          v++;
        }
        if (k < HAIR_SEGMENTS) {
          const a = i * perStrand + k * 2;
          index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], n);
          n += 6;
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(along, 3));
    geometry.setAttribute('aRoot', new BufferAttribute(roots, 3));
    geometry.setAttribute('aStrand', new BufferAttribute(params, 4));
    geometry.setIndex(new BufferAttribute(index, 1));
    this.hairU.uFloor.value = groundAt(x, z) - y;
    const material = new ShaderMaterial({ vertexShader: HAIR_VERT, fragmentShader: HAIR_FRAG, uniforms: this.hairU, transparent: true, depthWrite: false, side: DoubleSide, fog: false });
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    return mesh;
  }

  /** The family's table, out in the water, its lamp hanging from nothing. The empty place faces the shore. */
  private buildTable(): { at: readonly [number, number, number]; face: MeshBasicMaterial } {
    const { kit, build: b } = this;
    const bottom = SEA_FAR - TABLE_WADE;
    kit.prop('dining_table', [TABLE_X, bottom, TABLE_Z], { scale: TABLE_SCALE }, this.root);
    const chairs = kit.props('chair_ladder', 3, { scale: TABLE_SCALE });
    chairs.set(0, TABLE_X - 2.25, bottom, TABLE_Z, Math.PI / 2);
    chairs.set(1, TABLE_X + 2.25, bottom, TABLE_Z, -Math.PI / 2);
    chairs.set(2, TABLE_X, bottom, TABLE_Z - 1.55, 0);
    chairs.commit();
    this.root.add(chairs.root);

    const lampY = SEA_FAR + LAMP_OVER;
    const shadeProfile = [new Vector2(0.06, 0.24), new Vector2(0.12, 0.2), new Vector2(0.3, 0.06), new Vector2(0.46, 0)];
    const shade = new Mesh(new LatheGeometry(shadeProfile, 14), new MeshStandardMaterial({ color: 0x14130f, roughness: 0.6, side: DoubleSide }));
    shade.position.set(TABLE_X, lampY, TABLE_Z);
    this.root.add(shade);
    const face = new MeshBasicMaterial({ color: new Color(LAMP_COLOR).multiplyScalar(7) });
    const disc = new Mesh(new CircleGeometry(0.43, 18), face);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(TABLE_X, lampY + 0.01, TABLE_Z);
    this.root.add(disc);
    const cord = new Mesh(new CylinderGeometry(0.015, 0.015, 40, 4), new MeshBasicMaterial({ color: 0x161412 }));
    cord.position.set(TABLE_X, lampY + 20.2, TABLE_Z);
    this.root.add(cord);
    b.glow(TABLE_X, lampY - 0.1, TABLE_Z, 4.2, LAMP_COLOR, 0.16, this.root);
    b.glow(TABLE_X, lampY - 0.1, TABLE_Z, 1.1, LAMP_COLOR, 0.7, this.root);
    return { at: [TABLE_X, lampY - 0.28, TABLE_Z], face };
  }

  /** Those who wait for you, far up the beach behind you. They come closer only while you do not look. */
  private buildWatchers(): void {
    const { kit, build: b } = this;
    const people: readonly { crowd: Crowd; x: number }[] = [
      { crowd: b.headless(1, { tint: 0x30343a, bleach: 0.2 }), x: WATCH_X - 1 },
      { crowd: kit.figures.crowd({ avatar: 'figure_woman', clip: 'm_idle_roll_head_01', time: 0.4, face: 'scratched', bleach: 0.3, tint: 0x4a4744 }, 1), x: WATCH_X },
      { crowd: kit.figures.crowd({ avatar: 'figure_child', clip: 'm_idle_breathe_01', time: 0.4, face: 'scratched', bleach: 0.3, tint: 0x45474a }, 1), x: WATCH_X + 0.8 },
    ];
    for (const p of people) {
      p.crowd.root.visible = false;
      this.root.add(p.crowd.root);
      this.watchers.push(p);
      this.watcherRoots.push(p.crowd.root);
    }
    this.moveWatchers(WATCH_FAR);
  }

  private moveWatchers(z: number): void {
    this.watchZ = z;
    for (const p of this.watchers) {
      p.crowd.set(0, p.x, groundAt(p.x, z), z, Math.PI);
      p.crowd.commit();
    }
  }

  prepare(camera: PerspectiveCamera): void {
    const eye = this.u.eye.value.copy(camera.position).sub(this.origin);
    this.dome.position.copy(eye);
    // the piece draws every object it is handed: what the lens cannot see is left out here, a bin at a time
    forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const tanV = Math.tan((camera.fov * DEG) / 2);
    const tanH = tanV * camera.aspect;
    const cosV = 1 / Math.sqrt(1 + tanV * tanV);
    const cosH = 1 / Math.sqrt(1 + tanH * tanH);
    for (const b of this.bins) {
      away.copy(b.center).sub(eye);
      const ahead = away.dot(forward);
      const limit = Math.abs(b.detail) === REAL_DETAIL ? this.realDetail : b.detail;
      const fits = b.detail === 0 || (b.detail > 0 ? away.lengthSq() < limit * limit : away.lengthSq() >= limit * limit);
      b.mesh.visible = fits && !b.drowned && ahead > -b.radius && Math.abs(away.dot(right)) * cosH - ahead * tanH * cosH < b.radius && Math.abs(away.dot(up)) * cosV - ahead * tanV * cosV < b.radius;
    }
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const u = this.u;
    const clock = seaClock(s);
    const water = keyed(WATER, s);
    u.clock.value = clock;
    u.water.value = water;
    u.wet.value = keyed(WET, s);
    u.roll.value = clock - DRAW_BACK;
    const moon = (1 - MOON_DIP * (ramp(MOON_OUT[0], MOON_OUT[1], s) - ramp(MOON_BACK[0], MOON_BACK[1], s))) * (1 - 0.22 * ramp(MOON_FAILS[0], MOON_FAILS[1], s));
    u.moon.value = moon;
    u.cover.value = ramp(CLOUD_IN[0], CLOUD_IN[1], s) - ramp(CLOUD_OUT[0], CLOUD_OUT[1], s);
    this.key.intensity = KEY_POWER * moon;
    this.fill.intensity = FILL_POWER * (0.05 + 0.95 * moon);
    this.kick.intensity = KICK_POWER * (0.02 + 0.98 * moon);
    for (const c of this.motes) c.value = s;
    for (const b of this.bins) b.drowned = b.top < water - 0.3;
    this.realDetail = REAL_DETAIL + (REAL_DETAIL_LATE - REAL_DETAIL) * ramp(3, 8, s);

    forward.set(0, 0, -1).applyQuaternion(frame.view.quaternion).setY(0).normalize();
    const eyeX = frame.view.position.x - this.origin.x;
    const eyeZ = frame.view.position.z - this.origin.z;
    const footX = eyeX + forward.x * 1.5 - forward.z * 0.9;
    const footZ = eyeZ + forward.z * 1.5 + forward.x * 0.9;
    this.footLight.position.set(footX + this.origin.x, groundAt(footX, footZ) + 0.46 + this.origin.y, footZ + this.origin.z);
    this.footLight.intensity = FOOT_POWER * (1 - 0.6 * ramp(4, 10, s)) * (0.05 + 0.95 * moon);

    const breath = 1 + 0.06 * wobble(s * 0.7, 5);
    this.lampLight.intensity = LAMP_POWER * breath;
    u.lampPower.value = breath;
    this.lampFace.color.setHex(LAMP_COLOR).multiplyScalar(7 * breath);

    const after = ramp(SHUTTER, CUT, s);
    this.hairU.uTime.value = s;
    this.hairU.uLength.value = 1 + HAIR_GROWS * after;
    this.hairU.uWind.value.lerpVectors(WIND_BEFORE, WIND_AFTER, after).normalize();
    this.hairU.uLight.value = 0.4 + 0.75 * moon;

    const seated = s >= SITS;
    if (seated !== this.seated) {
      this.seated = seated;
      this.sitter.root.visible = seated;
      this.hair.visible = seated;
      this.shadowFrames = 2;
    }
    this.movingShadows = this.shadowFrames > 0;
    if (this.shadowFrames > 0) this.shadowFrames--;

    // the family only moves while it cannot be seen
    const out = this.unseen(frame, WATCH_X, groundAt(WATCH_X, this.watchZ) + 1, this.watchZ, 14);
    for (const r of this.watcherRoots) r.visible = !out;
    if (out) {
      const target = WATCH_FAR + (WATCH_NEAR - WATCH_FAR) * ramp(1, 14, s);
      if (Math.abs(target - this.watchZ) > 0.05) this.moveWatchers(target);
    }

    this.focus = FOCUS_NEAR + (FOCUS_FAR - FOCUS_NEAR) * ramp(FOCUS_PULL[0], FOCUS_PULL[1], s);
    this.aperture = APERTURE - 3 * ramp(SITS, SHUTTER, s);
    this.fear = 0.35 + 0.45 * ramp(10, 11.2, s);
    this.black = s >= CUT ? 1 : 0;
  }

  dispose(): void {
    super.dispose();
    this.noise.dispose();
    this.tile.dispose();
  }
}
