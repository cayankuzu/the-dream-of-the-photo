import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  Vector3,
} from 'three';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey, RoomPose } from '../Room';
import { Room } from '../Room';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['eyeball', 'branches_dry'],
  materials: ['bark_birch', 'litter_dark', 'litter_wet'],
  sounds: [
    'rooms/forest_night.mp3',
    'rooms/night_wind_far.mp3',
    'rooms/eye_blink.mp3',
    'rooms/eye_blink_many.mp3',
    'rooms/eye_turn.mp3',
    'rooms/twig_snap_1.mp3',
    'rooms/twig_snap_2.mp3',
  ],
};

/** The hard cold light stands behind the eye and follows it: how far to the side and how high (m). */
const KEY_SIDE = 0.35;
const KEY_HEIGHT = 1.62;
/** Where it aims: how far ahead of itself (m) and how far below its own height there (m). */
const KEY_AIM_AHEAD = 12;
const KEY_AIM_DOWN = 2.0;
/** Outer half angle of its cone (deg) and how soft the edge is (0..1). */
const KEY_ANGLE = 27;
const KEY_PENUMBRA = 0.9;
/** Its intensity is KEY_LEVEL × (distance behind the eye + 6 m)², so that the wood ahead stays this bright as it nears. */
const KEY_LEVEL = 4.6;
/** How far behind the eye (m) the one who carries it starts, and the lurches that bring it nearer (s, m). */
const GAP_START = 5.2;
const LURCHES: readonly (readonly [number, number])[] = [
  [4.6, 3.9],
  [8.4, 2.8],
  [11.3, 1.8],
];
const LURCH_TIME = REDUCED_MOTION ? 1.4 : 0.32;
/** Fog of the wood: everything dies into black at about 35 m. */
const FOG_DENSITY = 0.048;
/** The moment (s) the shutter clicks, when the eyes fill the frame. */
const SHUTTER_AT = 13;
/** When (s) every eye closes and how long that takes (s); the light goes out LIGHT_LAG (s) after them, in LIGHT_FALL (s). */
const BLINK_AT = 14.5;
const BLINK_TIME = REDUCED_MOTION ? 0.5 : 0.16;
const LIGHT_LAG = REDUCED_MOTION ? 0.25 : 0.09;
const LIGHT_FALL = REDUCED_MOTION ? 0.4 : 0.12;
/** Your own lids (lens): how long after the blink they start (s) and how long they take (s). */
const LID_LAG = 0.02;
const LID_TIME = REDUCED_MOTION ? 0.5 : 0.2;
/** The lids hang this far before the eye (m); their arch, its half width, where they rest out of sight and where they meet (m). */
const LID_Z = 0.18;
const LID_ARCH = 0.12;
const LID_HALF = 0.21;
const LID_OPEN = 0.062;
const LID_MEET = -0.03;
/** The eyes open between these moments (s): the first at OPEN_AT, the last OPEN_SPREAD later; each takes OPEN_TIME. */
const OPEN_AT = 5.6;
const OPEN_SPREAD = 1.6;
const OPEN_TIME = 0.9;
/** How open an eye is while it is still only a slit in the bark (0..1). */
const SLIT = 0.02;
/** Scale of an eyeball (1 is a real eye, 2.4 cm) and how deep it sits in the bark (m). */
const EYE_SCALE = 7;
const EYE_SINK = 0.03;
/** At most this many eyes in the wood (each ball is heavy). On a hero trunk the first sits this high, each next this much higher (m, least and most): as knots grow, not as a pattern. */
const EYE_MAX = 70;
const EYE_FIRST: readonly [number, number] = [0.9, 1.25];
const EYE_GAP: readonly [number, number] = [0.46, 0.78];
/** Each eye is its own, drawn from its own seed so the wood and its litter stay where they are. */
const EYE_VARY_SEED = 47;
/** Its size against EYE_SCALE (least, most), and the few that are bigger still: what share, how big. */
const EYE_SIZE: readonly [number, number] = [0.7, 1.18];
const EYE_BIG_SHARE = 0.1;
const EYE_BIG = 1.3;
/** How far round its trunk a hero eye turns, against the old swing (least, most). */
const EYE_SWING: readonly [number, number] = [0.55, 1.5];
/** The heaviest lid an eye keeps (0..1 of open), and how much its almond leans with its roll (0..1). */
const EYE_LID_LOW = 0.5;
const EYE_TILT = 1;
/** Where an eye looks past you (m around you, across and up), and where the restless ones look away to (m). */
const GAZE_MISS: readonly [number, number] = [0.5, 0.32];
const GAZE_AWAY: readonly [number, number] = [3.2, 1.6];
/** The restless ones: what share, how long a look away and back takes (s, least and most), the share of it spent away, how fast the eye jumps (s). */
const GAZE_SHIFTERS = REDUCED_MOTION ? 0 : 0.22;
const GAZE_CYCLE: readonly [number, number] = [2.6, 6.2];
const GAZE_AWAY_SHARE = 0.55;
const SACCADE_TIME = 0.08;
/** How fast each gaze wanders (rad/s, least and most). */
const GAZE_WANDER_RATE: readonly [number, number] = [0.25, 0.9];
/** Eyes that blink by themselves now and then, silently: what share, how often (s, least and most); none does this near the picture (s). */
const EYE_BLINKERS = 0.35;
const EYE_BLINK_EVERY: readonly [number, number] = [3, 8];
const EYE_BLINK_CLEAR = 0.45;
/** The whites they have (clean, bloodshot, yellowed, bluish); the dullest a dry one keeps (0..1); how much rougher a dry one and glossier a wet one is than the model. */
const EYE_WHITES: readonly (readonly [number, number, number])[] = [[1, 1, 1], [1, 0.84, 0.82], [1, 0.93, 0.76], [0.92, 0.95, 1]];
const EYE_DULL = 0.72;
const EYE_DRY = 1.8;
const EYE_WET = 0.3;
/** Two single eyes blink by themselves, each on a hero trunk: hero, which eye, when (s); and how long a blink lasts to each side (s). */
const LONE_BLINKS: readonly (readonly [number, number, number])[] = [
  [1, 1, 6.5],
  [5, 1, 10.4],
];
const LONE_BLINK_TIME = 0.1;
/** Wander of an eye's gaze around the viewer (m). */
const GAZE_WANDER = REDUCED_MOTION ? 0.04 : 0.2;
/** Far off in the dark, pairs of eyes that give the flash back: how many pairs, when they come open (s). */
const GLINT_PAIRS = 170;
const GLINT_OPEN: readonly [number, number] = [8.6, 12.8];
/** Where she stands (m), how tall (1 is 1.7 m), when the mist before her clears (s from..to), and her hair. */
const FIGURE_X = 0.15;
const FIGURE_Z = -20.5;
const FIGURE_SCALE = 1.15;
const MIST_CLEARS: readonly [number, number] = [10.8, 12.4];
const HAIR_STRANDS = 300;
/** The lens: what it holds (m) as the room goes, the wood, the eye at six, her, the eyes again for the picture. */
const FOCUS_WOOD = 5;
const FOCUS_EYE = 2.8;
const FOCUS_HER = 13;
const FOCUS_SHOT = 2.3;
/** Trunks: height (m), radius ranges (m), counts of near wood, saplings and far wood. */
const TRUNK_HEIGHT = 24;
const TRUNK_RADIUS: readonly [number, number] = [0.11, 0.23];
const SAPLING_RADIUS: readonly [number, number] = [0.025, 0.06];
const NEAR_TRUNKS = 70;
const SAPLINGS = 44;
const FAR_TRUNKS = 150;
/** The dark rough foot of a birch: how bright the bark is at the ground, against 1 up the trunk. */
const TRUNK_FOOT = 0.16;
/** The forest floor: cells across and along, center of its grid in z (m), reach to the side, ahead and behind (m). */
const GROUND_CELLS: readonly [number, number] = [96, 130];
const GROUND_MID = -3;
const GROUND_SIDE = 58;
const GROUND_FAR = 66;
const GROUND_BACK = 28;
/** No twig hangs closer to the way than this (m): before the lens one reads as a wire. */
const TWIG_CLEAR = 3;
/** Loose wet leaves lying on the litter near the way. */
const LEAF_COUNT = 2000;
/** Mist: wide low cards, how many; how much of the key they catch; how thin each is; how close to the eye it may come (m). */
const MIST_CARDS = 20;
const MIST_LIGHT = 0.2;
const MIST_OPACITY = 0.16;
const MIST_NEAR: readonly [number, number] = [3, 8];
/** The thick mist she stands behind, and the long pale band at the end of the wood: how much light they catch. */
const BANK_LIGHT = 0.18;
const BAND_LIGHT = 0.5;

const KEY_COS_OUT = Math.cos((KEY_ANGLE * Math.PI) / 180);
const KEY_COS_IN = Math.cos((KEY_ANGLE * (1 - KEY_PENUMBRA) * Math.PI) / 180);

/** The way the viewer walks, as x and z (m): trunks keep clear of it. */
const PATH: readonly (readonly [number, number])[] = [
  [0, 3.4],
  [0.3, -0.8],
  [-0.2, -4.2],
  [0, -7.6],
  [0, -9],
];

/** Trunks placed by hand: x, z, radius, how many eyes they carry, how bright the bark. */
const HEROES: readonly (readonly [number, number, number, number, number])[] = [
  [1.62, -0.55, 0.22, 4, 1],
  [-1.2, -3.7, 0.22, 4, 1],
  [1.55, -4.9, 0.19, 3, 0.95],
  [-2.45, -6.3, 0.19, 3, 0.9],
  [2.35, -7.3, 0.18, 3, 0.92],
  [-0.92, -9.7, 0.21, 5, 1],
  [0.96, -9.5, 0.2, 5, 1],
  [-1.42, -12.4, 0.2, 4, 0.95],
  [1.5, -12.9, 0.19, 4, 0.95],
  [-2.7, -10.9, 0.17, 3, 0.9],
  [3.0, -11.4, 0.17, 3, 0.9],
  [-1.95, -16.4, 0.19, 3, 0.9],
  [2.1, -15.9, 0.18, 3, 0.9],
  [-3.1, -1.5, 0.2, 2, 0.92],
  [3.6, -3.2, 0.2, 2, 0.9],
  [-1.62, 1.55, 0.26, 0, 0.42],
  [-1.7, 5.2, 0.2, 0, 1],
  [2.0, 4.4, 0.19, 0, 1],
  [-3.0, 6.8, 0.22, 0, 1],
  [-0.9, 10.4, 0.2, 0, 1],
  [2.4, 9.3, 0.18, 0, 1],
];

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);

const MIST_VERT = /* glsl */ `
uniform vec3 uKeyAt;
uniform vec3 uKeyAxis;
uniform float uKeyPower;
uniform float uTime;
uniform float uFog;
attribute vec3 aSeed;
varying vec2 vUv;
varying vec2 vNoise;
varying float vLit;
void main() {
  vUv = uv;
  vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  vec3 toEye = cameraPosition - center;
  toEye.y = 0.0;
  float eyeDist = length(toEye);
  vec3 across = normalize(vec3(toEye.z, 0.0, -toEye.x));
  vec3 world = center + across * position.x * size.x + vec3(0.0, position.y * size.y, 0.0);
  vec3 ray = world - uKeyAt;
  float d2 = dot(ray, ray);
  float cone = smoothstep(${KEY_COS_OUT.toFixed(5)}, ${KEY_COS_IN.toFixed(5)}, dot(ray / sqrt(d2), uKeyAxis));
  float nearFade = smoothstep(${MIST_NEAR[0].toFixed(2)}, ${MIST_NEAR[1].toFixed(2)}, eyeDist);
  float air = exp(-uFog * dot(world - cameraPosition, world - cameraPosition));
  vLit = uKeyPower * cone * nearFade * air / max(d2, 9.0);
  vNoise = uv * size * 0.16 + aSeed.xy + vec2(uTime * 0.012 * aSeed.z, uTime * 0.004);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const MIST_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSolid;
uniform float uPeak;
varying vec2 vUv;
varying vec2 vNoise;
varying float vLit;
void main() {
  float u = vUv.x * 2.0 - 1.0;
  float wide = 1.0 - u * u;
  float shape = wide * wide * smoothstep(0.0, uPeak, vUv.y) * (1.0 - smoothstep(uPeak, 1.0, vUv.y));
  float n = mix(texture2D(uNoise, vNoise).a, 1.0, uSolid);
  gl_FragColor = vec4(uColor * vLit, shape * n * uOpacity);
}
`;

const GLINT_VERT = /* glsl */ `
uniform float uSeconds;
uniform float uClose;
attribute float aOpen;
attribute float aSize;
varying float vOpen;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vOpen = smoothstep(aOpen, aOpen + 1.2, uSeconds) * (1.0 - uClose);
  gl_PointSize = max(1.5, aSize * 1000.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const GLINT_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vOpen;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = max(0.0, 1.0 - dot(p, p));
  gl_FragColor = vec4(uColor * vOpen * d * d, 1.0);
}
`;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (x: number): number => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distance (m) from a point to the viewer's way, on the ground. */
function pathDistance(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < PATH.length - 1; i++) {
    const [ax, az] = PATH[i];
    const [bx, bz] = PATH[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const k = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
    best = Math.min(best, Math.hypot(x - (ax + dx * k), z - (az + dz * k)));
  }
  return best;
}

/** The height of the forest floor (m): slow humps, small lumps, a faint trodden dip along the way. */
function groundAt(x: number, z: number): number {
  const humps = 0.06 * Math.sin(x * 0.9 + z * 0.55 + 0.7) * Math.sin(z * 0.8 - x * 0.35);
  const lumps = 0.028 * Math.sin(x * 2.7 - z * 2.1 + 1.2) * Math.sin(z * 3.1 + x * 1.4);
  const fine = 0.01 * Math.sin(x * 9.1 + z * 6.3) * Math.sin(z * 8.7 - x * 3.9);
  return humps + lumps + fine - 0.035 * Math.exp(-x * x * 0.6);
}

/** The radius of a trunk at a height (m), as a share of its radius: a flared foot, a slow taper. */
function radiusAt(y: number): number {
  return (1 - (0.42 * y) / TRUNK_HEIGHT) * (1 + 0.6 * Math.exp(-y / 0.14) + 0.14 * Math.exp(-y / 0.6));
}

/** No birch grows straight: the slow wander of its axis at a height (m), in radii. */
function axisX(y: number): number {
  return 0.45 * Math.sin(y * 0.37 + 0.6) + 0.1 * Math.sin(y * 1.13 + 2.1);
}
function axisZ(y: number): number {
  return 0.4 * Math.sin(y * 0.29 + 2.6) + 0.09 * Math.sin(y * 0.97 + 0.4);
}

/** Soft blobs of white alpha, wrapped at the edges so that the image can drift. */
function blobs(size: number, count: number, seed: number, radius: readonly [number, number]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d')!;
  const rnd = seeded(seed);
  for (let i = 0; i < count; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = (radius[0] + rnd() * (radius[1] - radius[0])) * size;
    const a = 0.25 + rnd() * 0.5;
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const g = c.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
  return canvas;
}

/** One almond of dark that hugs a unit cylinder: the socket an eye sits in. Its origin is the trunk's axis. */
function almond(halfAngle: number, halfHeight: number, radius: number, torn: number): BufferGeometry {
  const cols = 24;
  const rows = 6;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const u = (i / cols) * 2 - 1;
      const v = (j / rows) * 2 - 1;
      const edge = Math.pow(Math.max(0, 1 - u * u), 0.75) * (1 + torn * Math.sin(u * 5.3 + v * 1.7));
      const a = u * halfAngle;
      const y = v * halfHeight * edge * (v < 0 ? 0.8 : 1);
      pos.push(Math.sin(a) * radius, y, Math.cos(a) * radius);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p = j * (cols + 1) + i;
      idx.push(p, p + 1, p + cols + 1, p + 1, p + cols + 2, p + cols + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A trunk of unit radius, y in meters from its foot: flared, tapering, wandering, its foot dark. */
function trunkGeometry(sides: number, rings: readonly number[]): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (const y of rings) {
    const r = radiusAt(y);
    const slope = (r - radiusAt(y + 0.02)) / 0.02;
    const foot = TRUNK_FOOT + (1 - TRUNK_FOOT) * smooth((y - 0.02) / 1.1);
    const n = Math.hypot(1, slope);
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pos.push(axisX(y) + c * r, y, axisZ(y) + s * r);
      nor.push(c / n, slope / n, s / n);
      uv.push(i / sides, y);
      col.push(foot, foot, foot);
    }
  }
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < sides; i++) {
      const a = j * (sides + 1) + i;
      const b = a + sides + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('uv1', new Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** The forest floor: a grid finest along the way, humped, darkened and banked up at the foot of what stands on it; its alpha says where the dark litter lies. */
function groundGeometry(marks: readonly { x: number; z: number; r: number }[]): BufferGeometry {
  const [nx, nz] = GROUND_CELLS;
  const spread = (u: number) => Math.sign(u) * (0.15 * Math.abs(u) + 0.85 * Math.pow(Math.abs(u), 2.2));
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nz; j++) {
    const v = (j / nz) * 2 - 1;
    const z = GROUND_MID + spread(v) * (v < 0 ? GROUND_FAR : GROUND_BACK);
    for (let i = 0; i <= nx; i++) {
      const x = spread((i / nx) * 2 - 1) * GROUND_SIDE;
      let h = groundAt(x, z);
      let shade = 0.78 + 0.22 * Math.sin(x * 0.41 + z * 0.77 + 1.1) * Math.sin(z * 0.53 - x * 0.93);
      for (const m of marks) {
        const dx = x - m.x;
        const dz = z - m.z;
        if (Math.abs(dx) > 1.8 || Math.abs(dz) > 1.8) continue;
        const d = Math.max(0, Math.hypot(dx, dz) - m.r);
        h += 0.06 * Math.exp(-d * d * 8);
        shade *= 1 - 0.7 * Math.exp(-d * d * 14);
      }
      const patch = Math.sin(x * 0.62 + z * 0.31 + 1) * Math.sin(z * 0.71 - x * 0.22 + 2) + 0.5 * Math.sin(x * 1.7 - z * 1.3) * Math.sin(z * 1.9 + x * 0.8);
      pos.push(x, h, z);
      uv.push(x, z);
      col.push(shade, shade, shade, smooth((patch + 0.25) / 0.7));
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const p = j * (nx + 1) + i;
      const r = p + nx + 1;
      idx.push(p, r, p + 1, p + 1, r, r + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('uv1', new Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A small birch leaf, about 7 cm, folded along its rib, tip along +Z. */
function leafGeometry(): BufferGeometry {
  const tip = [0, 0.002, 0.042];
  const right = [0.026, 0.009, 0.004];
  const left = [-0.026, 0.009, 0.004];
  const stalk = [0, 0.001, -0.03];
  const rib = [0, -0.002, 0.006];
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([...tip, ...rib, ...right, ...rib, ...stalk, ...right, ...tip, ...left, ...rib, ...rib, ...left, ...stalk], 3));
  g.computeVertexNormals();
  return g;
}

interface Trunk {
  x: number;
  z: number;
  r: number;
  fine: boolean;
  bark: number;
  base: number;
  matrix: Matrix4;
}

/** Thin bare branches of the near wood with fine twigs hanging from them: everything in one mesh. */
function twigGeometry(trunks: readonly Trunk[], rnd: () => number): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const t = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  const tube = (points: readonly Vector3[], r0: number, r1: number) => {
    const base = pos.length / 3;
    points.forEach((p, i) => {
      t.subVectors(points[Math.min(points.length - 1, i + 1)], points[Math.max(0, i - 1)]).normalize();
      a.set(0.8, 0.3, 0.5).cross(t).normalize();
      b.crossVectors(t, a);
      const r = r0 + ((r1 - r0) * i) / (points.length - 1);
      for (let k = 0; k < 3; k++) {
        const w = (k * Math.PI * 2) / 3;
        const nx = a.x * Math.cos(w) + b.x * Math.sin(w);
        const ny = a.y * Math.cos(w) + b.y * Math.sin(w);
        const nz = a.z * Math.cos(w) + b.z * Math.sin(w);
        pos.push(p.x + nx * r, p.y + ny * r, p.z + nz * r);
        nor.push(nx, ny, nz);
      }
    });
    for (let i = 0; i < points.length - 1; i++) {
      for (let k = 0; k < 3; k++) {
        const c = base + i * 3 + k;
        const d = base + i * 3 + ((k + 1) % 3);
        idx.push(c, d, c + 3, d, d + 3, c + 3);
      }
    }
  };
  for (const tree of trunks) {
    if (!tree.fine || Math.abs(tree.x) > 8 || tree.z < -24 || tree.z > 9) continue;
    const branches = 1 + Math.floor(rnd() * 2);
    for (let n = 0; n < branches; n++) {
      const y = 3.2 + rnd() * 3.6;
      const out = rnd() * Math.PI * 2;
      const dx = Math.sin(out);
      const dz = Math.cos(out);
      const reach = 1.2 + rnd() * 2;
      const start = new Vector3(axisX(y - tree.base), y - tree.base, axisZ(y - tree.base)).applyMatrix4(tree.matrix);
      const rise = reach * (0.2 + rnd() * 0.3);
      const fall = -0.3 + rnd() * 0.6;
      const line: Vector3[] = [];
      for (let i = 0; i <= 6; i++) {
        const k = i / 6;
        line.push(new Vector3(start.x + dx * reach * k, start.y + rise * 2 * k * (1 - k) + fall * k * k, start.z + dz * reach * k));
      }
      tube(line, 0.026, 0.007);
      for (let i = 2; i <= 6; i++) {
        const hanging = 1 + Math.floor(rnd() * 2);
        for (let h = 0; h < hanging; h++) {
          const drop = 0.5 + rnd() * 1.1;
          const sway = 0.2 + rnd() * 0.45;
          const side = (rnd() - 0.5) * 0.7;
          const twig: Vector3[] = [];
          for (let s = 0; s <= 5; s++) {
            const k = s / 5;
            twig.push(new Vector3(line[i].x + (dx * sway - dz * side) * k, line[i].y - drop * k * k, line[i].z + (dz * sway + dx * side) * k));
          }
          if (pathDistance(line[i].x, line[i].z) >= TWIG_CLEAR) tube(twig, 0.0065, 0.0018);
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** Long white hair from the crown of a head (center at cx, cy, cz) down the middle of the back: flat ribbons of uneven length, narrower than the shoulders. */
function hairGeometry(cx: number, cy: number, cz: number, feet: number, rnd: () => number): BufferGeometry {
  const steps = 8;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < HAIR_STRANDS; i++) {
    const across = rnd() * 2 - 1;
    const back = Math.sqrt(1 - across * across);
    const top = cy + 0.1 * Math.sin(0.3 + rnd());
    const luck = rnd();
    const end = feet + (luck < 0.45 ? 0.02 + rnd() * 0.22 : luck < 0.8 ? 0.4 + rnd() * 0.5 : 1 + rnd() * 0.35);
    const drift = (rnd() - 0.5) * 0.06;
    const half = 0.004 + rnd() * 0.004;
    const base = pos.length / 3;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const head = smooth(t * 3.2);
      const out = across * (0.07 + 0.06 * head + 0.02 * t);
      const y = top + (end - top) * Math.pow(t, 1.2);
      const skull = Math.sqrt(Math.max(0.0004, 0.0132 - (y - cy) * (y - cy) - out * out)) + 0.012;
      const x = cx + out + drift * t;
      const z = cz + skull * (1 - head) + (0.17 + 0.03 * back) * head;
      pos.push(x - half, y, z, x + half, y, z);
      nor.push(across * 0.5, 0.2, 0.84, across * 0.5, 0.2, 0.84);
    }
    for (let k = 0; k < steps; k++) {
      const a = base + k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** An eyelid before the lens: everything above an arch, far beyond the frame on every side. */
function lidGeometry(): BufferGeometry {
  const segments = 40;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const x = ((i / segments) * 2 - 1) * 0.7;
    pos.push(x, LID_ARCH * (1 - (x * x) / (LID_HALF * LID_HALF)), 0, x, 1.4, 0);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/**
 * A night birch wood under one hard cold light that stands behind your eye and never goes out. The trunks
 * are white and the dark between them is total. The knots in the bark are eyes: at six you see it, and they
 * turn to keep you in view as you pass. The light is carried: turn round and there is a man with no head,
 * the flash where his head should be, nearer each time. Far down a gap a pale mist thins and a figure in
 * white hair stands in it with her back to you. At half past fourteen every eye closes at once, and the
 * light with them, and your own lids with them.
 */
export default class Birches extends Room {
  readonly keys: readonly RoomKey[] = [
    { t: 0, at: [0, 1.55, 3.4], yaw: 0, pitch: -3, fov: 54 },
    { t: 0.375, at: [0.3, 1.52, -0.8], yaw: 7, pitch: -2, fov: 52 },
    { t: 0.62, at: [-0.2, 1.5, -4.2], yaw: -4, pitch: 0, fov: 50 },
    { t: 0.81, at: [0, 1.5, -7.6], yaw: 0, pitch: 1, fov: 46 },
    { t: 1, at: [0, 1.5, -8.5], yaw: 0, pitch: 1, fov: 44 },
  ];
  readonly air: RoomAir = {
    fog: { color: 0x0b1215, density: FOG_DENSITY },
    env: 'bathroom',
    envIntensity: 0.03,
    sky: 0,
    grade: { exposure: 1.2, saturation: 0.62, warmth: -0.06, tint: -0.04, flare: 0.003 },
  };
  film = { bloom: 0.7, bloomFrom: 0.8, bloomTint: [0.8, 0.92, 1] as const, grain: 0.45, scratches: 0, flicker: 0, weave: 0.0004, aberration: 0.002 };
  focus = FOCUS_WOOD;
  aperture = 3;
  override movingShadows = true;

  private readonly key: NonNullable<Room['spots'][number]>;
  private readonly keyAt: number[];
  private readonly keyAim: number[];
  private readonly core: Mesh;
  private readonly halo: Mesh;
  private readonly man;
  private readonly balls;
  private readonly clocks: { value: number }[] = [];
  private readonly woman;
  private readonly hair: Mesh;
  private readonly lidUp: Mesh;
  private readonly lidDown: Mesh;
  private readonly eyeCount: number;
  private readonly eyeAt: Float32Array;
  private readonly eyeRoll: Float32Array;
  private readonly eyeOpen: Float32Array;
  /** Each eye its own: size; lid; gaze (miss across, up, away across, up); times (wander rate, look-away cycle, blink every, phase). */
  private readonly eyeSize: Float32Array;
  private readonly eyeLid: Float32Array;
  private readonly eyeGaze: Float32Array;
  private readonly eyeTimes: Float32Array;
  private readonly loneEye: number[] = [];
  private readonly uKeyAt = { value: new Vector3() };
  private readonly uKeyAxis = { value: new Vector3(0, 0, -1) };
  private readonly uTime = { value: 0 };
  private readonly mistPower = { value: 0 };
  private readonly bankPower = { value: 0 };
  private readonly bankOpacity = { value: 1 };
  private readonly bandPower = { value: 0 };
  private readonly glintSeconds = { value: 0 };
  private readonly glintClose = { value: 0 };
  private readonly eyePose: RoomPose = { position: new Vector3(), yaw: 0, pitch: 0, roll: 0, fov: 50 };
  private forest: RoomVoice | null = null;
  private wind: RoomVoice | null = null;
  private readonly tmpM = new Matrix4();
  private readonly tmpS = new Matrix4();
  private readonly tmpLook = new Matrix4();
  private readonly toCenter = new Matrix4().makeTranslation(0, -0.012, 0);
  private readonly tmpQ = new Quaternion();
  private readonly tmpR = new Quaternion();
  private readonly tmpP = new Vector3();
  private readonly tmpT = new Vector3();
  private readonly tmpScale = new Vector3();

  constructor(ctx: RoomContext) {
    super(ctx);
    const kit = this.kit;
    const b = this.build;
    const rnd = seeded(31);

    // the wood: heroes by hand, then a near wood, saplings and a far wood that keep out of the way and out of the gap
    const trunks: Trunk[] = HEROES.map(([x, z, r, , bark]) => ({ x, z, r, fine: true, bark, base: 0, matrix: new Matrix4() }));
    const gapBlocked = (x: number, z: number) => (z < -8.5 && Math.abs(x) < 0.7) || (z < -10.5 && Math.abs(x) < 1.25) || (z > 3.8 && Math.abs(x) < 1.3) || (z > -11 && z < -6.2 && Math.abs(x) < 2.5);
    const place = (count: number, xs: number, z0: number, z1: number, gap: number, radius: readonly [number, number], fine: boolean, keep: number) => {
      for (let tries = 0, got = 0; got < count && tries < 4000; tries++) {
        const x = (rnd() * 2 - 1) * xs;
        const z = z0 + rnd() * (z1 - z0);
        const r = radius[0] + rnd() * (radius[1] - radius[0]);
        if (pathDistance(x, z) < keep || gapBlocked(x, z)) continue;
        if (trunks.some((t) => Math.hypot(t.x - x, t.z - z) < gap + t.r + r)) continue;
        trunks.push({ x, z, r, fine, bark: 0.62 + rnd() * 0.38, base: 0, matrix: new Matrix4() });
        got++;
      }
    };
    place(NEAR_TRUNKS, 9, -24, 11, 1.1, TRUNK_RADIUS, true, 1.05);
    place(SAPLINGS, 8, -22, 9, 0.5, SAPLING_RADIUS, false, 0.85);
    place(FAR_TRUNKS, 32, -60, 24, 2.2, TRUNK_RADIUS, false, 1.05);

    const bark = kit.surface('bark_birch', 1, { color: new Color(0xc6d9ee), roughness: 0.78 });
    bark.vertexColors = true;
    const euler = new Euler(0, 0, 0, 'YXZ');
    const tint = new Color();
    const stand = (list: readonly Trunk[], geometry: BufferGeometry) => {
      const wood = new InstancedMesh(geometry, bark, list.length);
      wood.castShadow = true;
      wood.receiveShadow = true;
      wood.frustumCulled = false;
      list.forEach((t, i) => {
        const lean = t.fine ? 0.03 : 0.07;
        t.base = groundAt(t.x, t.z) - 0.05;
        euler.set((rnd() - 0.5) * lean, rnd() * Math.PI * 2, (rnd() - 0.5) * lean);
        this.tmpQ.setFromEuler(euler);
        t.matrix.compose(this.tmpP.set(t.x, t.base, t.z), this.tmpQ, this.tmpScale.set(t.r, 1, t.r));
        wood.setMatrixAt(i, t.matrix);
        wood.setColorAt(i, tint.setScalar(t.bark));
      });
      this.root.add(wood);
    };
    const fine = trunks.filter((t) => t.fine);
    stand(fine, trunkGeometry(14, [0, 0.06, 0.16, 0.35, 0.7, 1.1, 1.6, 2.2, 2.8, 3.4, 5, 8, 13, TRUNK_HEIGHT]));
    stand(trunks.filter((t) => !t.fine), trunkGeometry(8, [0, 0.5, 3, 10, TRUNK_HEIGHT]));

    // bare branches and hanging twigs: the near layer of the picture, and what you see looking up
    const barkDark = new MeshStandardMaterial({ color: 0x4a4440, roughness: 0.85, side: DoubleSide });
    const twigs = new InstancedMesh(twigGeometry(fine, rnd), barkDark, 1);
    twigs.setMatrixAt(0, this.tmpM.identity());
    twigs.setColorAt(0, tint.setScalar(1));
    twigs.receiveShadow = true;
    twigs.frustumCulled = false;
    this.root.add(twigs);

    // the ground: wet leaves with the dark litter lying over them in patches, on a floor that is not flat
    const floor = groundGeometry([...trunks, { x: FIGURE_X, z: FIGURE_Z, r: 0.25 }]);
    const wet = kit.surface('litter_wet', 1.26, { color: new Color(0xaeb6b4), roughness: 0.5 });
    wet.vertexColors = true;
    wet.normalScale.setScalar(1.4);
    const dead = kit.surface('litter_dark', 2.3, { color: new Color(0x6a7478), roughness: 0.44 });
    dead.vertexColors = true;
    dead.transparent = true;
    dead.depthWrite = false;
    dead.polygonOffset = true;
    dead.polygonOffsetFactor = -1;
    dead.polygonOffsetUnits = -1;
    for (const material of [wet, dead]) {
      const ground = new Mesh(floor, material);
      ground.receiveShadow = true;
      ground.frustumCulled = false;
      ground.renderOrder = material === dead ? 1 : 0;
      this.root.add(ground);
    }

    // single leaves lying on it near the way: they catch the light by themselves
    const leaves = new InstancedMesh(leafGeometry(), new MeshStandardMaterial({ color: 0xffffff, roughness: 0.34, side: DoubleSide }), LEAF_COUNT);
    leaves.receiveShadow = true;
    leaves.frustumCulled = false;
    const palette = [0x6a4a22, 0x7d5a2a, 0x3d3120, 0x8a6a35, 0x2a241c].map((hex) => new Color(hex));
    for (let i = 0; i < LEAF_COUNT; i++) {
      const x = (rnd() + rnd() - 1) * 5.5;
      const z = 7 - rnd() * 22;
      euler.set((rnd() - 0.5) * 0.7, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.7);
      this.tmpQ.setFromEuler(euler);
      this.tmpM.compose(this.tmpP.set(x, groundAt(x, z) + 0.012, z), this.tmpQ, this.tmpScale.setScalar(0.8 + rnd() * 0.9));
      leaves.setMatrixAt(i, this.tmpM);
      leaves.setColorAt(i, palette[Math.floor(rnd() * palette.length)]);
    }
    this.root.add(leaves);

    // the eyes: where each sits, on the face of its trunk that looks toward the way
    interface Eye {
      x: number;
      y: number;
      z: number;
      heading: number;
      r: number;
    }
    const eyes: Eye[] = [];
    const at = new Vector3();
    const addEye = (t: Trunk, y: number, swing: number) => {
      const local = y - t.base;
      at.set(axisX(local), local, axisZ(local)).applyMatrix4(t.matrix);
      const toward = Math.atan2(-t.x * 0.9, Math.min(3.2, Math.max(-8, t.z + 2)) - t.z);
      eyes.push({ x: at.x, y: at.y, z: at.z, heading: toward + swing, r: t.r * radiusAt(local) });
    };
    const heroStart: number[] = [];
    const vary = seeded(EYE_VARY_SEED);
    const between = (range: readonly [number, number]): number => range[0] + vary() * (range[1] - range[0]);
    HEROES.forEach(([, , , n], i) => {
      heroStart.push(eyes.length);
      let y = between(EYE_FIRST);
      for (let k = 0; k < n; k++) {
        const jitter = (rnd() - 0.5) * 0.14;
        const swing = (k % 2 === 0 ? -1 : 1) * (0.12 + rnd() * 0.3);
        addEye(trunks[i], y + jitter, swing * between(EYE_SWING));
        y += between(EYE_GAP);
      }
    });
    for (let i = HEROES.length; i < trunks.length && eyes.length < EYE_MAX; i++) {
      const t = trunks[i];
      if (!t.fine || t.z < -17 || t.z > 2 || pathDistance(t.x, t.z) > 7 || rnd() > 0.42) continue;
      const low = 1 + rnd() * 0.7;
      addEye(t, low, (rnd() - 0.5) * 0.9);
      addEye(t, low + 0.62 + rnd() * 0.6, (rnd() - 0.5) * 0.9);
    }
    const n = eyes.length;
    this.eyeCount = n;
    this.eyeAt = new Float32Array(n * 3);
    this.eyeRoll = new Float32Array(n);
    this.eyeOpen = new Float32Array(n);
    this.eyeSize = new Float32Array(n);
    this.eyeLid = new Float32Array(n);
    this.eyeGaze = new Float32Array(n * 4);
    this.eyeTimes = new Float32Array(n * 4);
    const whites = new Float32Array(n * 3);

    const outerMat = new MeshStandardMaterial({ color: 0x1b1510, roughness: 0.85, side: DoubleSide });
    const innerMat = new MeshStandardMaterial({ color: 0x050403, roughness: 0.55, side: DoubleSide });
    const outer = new InstancedMesh(almond(1.05, 0.62, 1.03, 0.05), outerMat, n);
    const inner = new InstancedMesh(almond(0.8, 0.46, 1.045, 0), innerMat, n);
    for (const m of [outer, inner]) {
      m.receiveShadow = true;
      m.frustumCulled = false;
    }
    const ballKit = kit.props('eyeball', n, { nodes: ['ball'] });
    this.balls = ballKit;
    eyes.forEach((e, i) => {
      tint.setScalar(0.75 + rnd() * 0.25);
      outer.setColorAt(i, tint);
      inner.setColorAt(i, tint);
      this.eyeRoll[i] = (rnd() - 0.5) * 0.5;
      this.eyeOpen[i] = OPEN_AT + rnd() * OPEN_SPREAD;
      // its own size, lid, gaze, blinks and white; the two that blink on cue stay wide and look right at you
      const lone = LONE_BLINKS.some(([hero, eye]) => heroStart[hero] + eye === i);
      const size = vary() < EYE_BIG_SHARE ? EYE_BIG : between(EYE_SIZE);
      const heavy = vary() * vary();
      const lid = lone ? 1 : 1 - (1 - EYE_LID_LOW) * heavy;
      this.eyeSize[i] = size;
      this.eyeLid[i] = lid;
      const g = i * 4;
      this.eyeGaze[g] = lone ? 0 : (vary() * 2 - 1) * GAZE_MISS[0];
      this.eyeGaze[g + 1] = lone ? 0 : (vary() * 2 - 1) * GAZE_MISS[1];
      this.eyeGaze[g + 2] = (vary() < 0.5 ? -1 : 1) * GAZE_AWAY[0] * (0.5 + 0.5 * vary());
      this.eyeGaze[g + 3] = (vary() * 2 - 0.6) * GAZE_AWAY[1];
      this.eyeTimes[g] = between(GAZE_WANDER_RATE);
      this.eyeTimes[g + 1] = vary() < GAZE_SHIFTERS && !lone ? between(GAZE_CYCLE) : 0;
      this.eyeTimes[g + 2] = vary() < EYE_BLINKERS && !lone ? between(EYE_BLINK_EVERY) : 0;
      this.eyeTimes[g + 3] = vary() * 20;
      const white = EYE_WHITES[Math.floor(vary() * EYE_WHITES.length) % EYE_WHITES.length];
      const wet = EYE_DULL + (1 - EYE_DULL) * vary();
      whites[i * 3] = white[0] * wet;
      whites[i * 3 + 1] = white[1] * wet;
      whites[i * 3 + 2] = white[2] * wet;
      // its almond grows and narrows with it, and leans with its roll
      this.tmpQ.setFromAxisAngle(UP, e.heading).multiply(this.tmpR.setFromAxisAngle(FORWARD, this.eyeRoll[i] * EYE_TILT));
      this.tmpM.compose(this.tmpP.set(e.x, e.y, e.z), this.tmpQ, this.tmpScale.set(e.r, e.r * size * lid, e.r));
      outer.setMatrixAt(i, this.tmpM);
      inner.setMatrixAt(i, this.tmpM);
      const reach = e.r - EYE_SINK;
      this.eyeAt[i * 3] = e.x + Math.sin(e.heading) * (reach + EYE_SINK * 0.4);
      this.eyeAt[i * 3 + 1] = e.y;
      this.eyeAt[i * 3 + 2] = e.z + Math.cos(e.heading) * (reach + EYE_SINK * 0.4);
    });
    for (const [hero, eye] of LONE_BLINKS) {
      const index = heroStart[hero] + eye;
      this.loneEye.push(index);
      this.eyeOpen[index] = OPEN_AT;
    }
    // each ball its own white, and a wet one glossier than a dry one (on a copy of the material of the model)
    ballKit.root.traverse((o) => {
      const mesh = o as InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      const material = (mesh.material as MeshStandardMaterial).clone();
      material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
#ifdef USE_COLOR
  roughnessFactor *= mix(${EYE_DRY.toFixed(2)}, ${EYE_WET.toFixed(2)}, clamp((max(max(vColor.r, vColor.g), vColor.b) - ${EYE_DULL.toFixed(2)}) / ${(1 - EYE_DULL).toFixed(2)}, 0.0, 1.0));
#endif`,
        );
      };
      mesh.material = material;
      for (let i = 0; i < n; i++) mesh.setColorAt(i, tint.setRGB(whites[i * 3], whites[i * 3 + 1], whites[i * 3 + 2]));
    });
    this.root.add(outer, inner, ballKit.root);

    // dead branches on the litter
    const sticks = kit.props('branches_dry', 14, { castShadow: true });
    for (let i = 0; i < 14; i++) {
      for (let tries = 0; tries < 20; tries++) {
        const x = (rnd() * 2 - 1) * 5;
        const z = 3 - rnd() * 18;
        if (pathDistance(x, z) < 0.8 || (z < -10 && Math.abs(x) < 1.2)) continue;
        sticks.set(i, x, groundAt(x, z) - 0.01, z, rnd() * Math.PI * 2, 0.8 + rnd() * 0.7);
        break;
      }
    }
    sticks.commit();
    kit.paint(sticks.root, new MeshStandardMaterial({ color: 0x2c2723, roughness: 0.82, side: DoubleSide }));
    for (const part of sticks.root.children) {
      const m = part as InstancedMesh;
      for (let i = 0; i < m.count; i++) m.setColorAt(i, tint.setScalar(0.7 + rnd() * 0.3));
    }
    this.root.add(sticks.root);

    // the one light, carried: it stands where a head would be
    const key = this.spot([KEY_SIDE, KEY_HEIGHT, 3.4 + GAP_START], [0, 0.15, -8], 0xdbeaff, KEY_LEVEL * (GAP_START + 6) * (GAP_START + 6), KEY_ANGLE, KEY_PENUMBRA);
    this.spots = [key, null, null];
    this.key = key;
    this.keyAt = key.position as unknown as number[];
    this.keyAim = key.target as unknown as number[];
    this.core = b.glow(KEY_SIDE, KEY_HEIGHT, 3.4 + GAP_START, 0.36, 0xf6f9ff, 5, this.root, 3);
    this.halo = b.glow(KEY_SIDE, KEY_HEIGHT, 3.4 + GAP_START, 5.5, 0xbcd4e6, 0.06, this.root, 2.4);
    this.man = b.headless(1, { tint: 0x2c3236 });
    this.root.add(this.man.root);

    // what the flash never quite reaches is still there: a very faint cold air around the way
    this.light([0, 2.6, 2.5], 0x8fb2c8, 2.2, 8);
    this.light([0, 2.6, -3.5], 0x8fb2c8, 2.2, 8);
    this.light([0, 2.6, -9], 0x8fb2c8, 2.2, 8);

    // mist: low cards that take the key's light; a thick bank of it in the gap, with her behind it; the long pale band at the end
    const noise = new CanvasTexture(blobs(256, 46, 11, [0.08, 0.2]));
    noise.wrapS = noise.wrapT = RepeatWrapping;
    const pale = { value: new Color(0xaec6d6) };
    const cloud = (power: { value: number }, opacity: { value: number }, peak: number, solid: number, fog: number) =>
      new ShaderMaterial({
        vertexShader: MIST_VERT,
        fragmentShader: MIST_FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uKeyAt: this.uKeyAt,
          uKeyAxis: this.uKeyAxis,
          uKeyPower: power,
          uTime: this.uTime,
          uFog: { value: fog },
          uNoise: { value: noise },
          uColor: pale,
          uOpacity: opacity,
          uSolid: { value: solid },
          uPeak: { value: peak },
        },
      });
    const cards = new InstancedMesh(new PlaneGeometry(1, 1, 14, 3), cloud(this.mistPower, { value: MIST_OPACITY }, 0.28, 0, FOG_DENSITY * FOG_DENSITY), MIST_CARDS);
    const seeds = new Float32Array(MIST_CARDS * 3);
    for (let i = 0; i < MIST_CARDS; i++) {
      const h = 1.3 + rnd() * 2;
      this.tmpM.compose(this.tmpP.set((rnd() * 2 - 1) * 9, h / 2 - 0.02, -28 + ((i + rnd()) / MIST_CARDS) * 26), this.tmpQ.identity(), this.tmpScale.set(7 + rnd() * 9, h, 1));
      cards.setMatrixAt(i, this.tmpM);
      seeds[i * 3] = rnd();
      seeds[i * 3 + 1] = rnd();
      seeds[i * 3 + 2] = 0.5 + rnd();
    }
    cards.geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 3));
    cards.frustumCulled = false;
    cards.renderOrder = 2;
    this.root.add(cards);

    const single = (material: ShaderMaterial, x: number, y: number, z: number, w: number, h: number, order: number): InstancedMesh => {
      const mesh = new InstancedMesh(new PlaneGeometry(1, 1, 14, 3), material, 1);
      mesh.setMatrixAt(0, this.tmpM.compose(this.tmpP.set(x, y, z), this.tmpQ.identity(), this.tmpScale.set(w, h, 1)));
      mesh.geometry.setAttribute('aSeed', new InstancedBufferAttribute(new Float32Array([0.3, 0.7, 1]), 3));
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      this.root.add(mesh);
      return mesh;
    };
    single(cloud(this.bankPower, this.bankOpacity, 0.42, 0.7, 0), FIGURE_X, 2, FIGURE_Z + 1.6, 3.4, 4.2, 2);
    const bandMaterial = cloud(this.bandPower, { value: 0.9 }, 0.12, 0.4, 0);
    bandMaterial.blending = AdditiveBlending;
    single(bandMaterial, 0.1, 4, -37, 52, 8, 1);

    // far off, in pairs, what gives the flash back
    const glints = new Float32Array(GLINT_PAIRS * 6);
    const opens = new Float32Array(GLINT_PAIRS * 2);
    const sizes = new Float32Array(GLINT_PAIRS * 2);
    for (let i = 0; i < GLINT_PAIRS; i++) {
      let x = 0;
      let z = 0;
      do {
        x = (rnd() * 2 - 1) * 30;
        z = 24 - rnd() * 82;
      } while (Math.hypot(x, z + 3) < 15 || (Math.abs(x) < 1.6 && z < -8));
      const y = 0.6 + rnd() * 4.6;
      const away = Math.hypot(x, z + 3);
      const across = (0.07 + rnd() * 0.06) * (z < -3 ? 1 : -1);
      const px = ((z + 3) / away) * across;
      const pz = (-x / away) * across;
      glints.set([x + px, y, z + pz, x - px, y, z - pz], i * 6);
      const open = GLINT_OPEN[0] + rnd() * (GLINT_OPEN[1] - GLINT_OPEN[0]);
      const size = 0.08 + rnd() * 0.06;
      opens[i * 2] = opens[i * 2 + 1] = open;
      sizes[i * 2] = sizes[i * 2 + 1] = size;
    }
    const glintGeometry = new BufferGeometry();
    glintGeometry.setAttribute('position', new Float32BufferAttribute(glints, 3));
    glintGeometry.setAttribute('aOpen', new Float32BufferAttribute(opens, 1));
    glintGeometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
    const glintPoints = new Points(
      glintGeometry,
      new ShaderMaterial({
        vertexShader: GLINT_VERT,
        fragmentShader: GLINT_FRAG,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { uSeconds: this.glintSeconds, uClose: this.glintClose, uColor: { value: new Color(0xd8f0dc).multiplyScalar(2.2) } },
      }),
    );
    glintPoints.frustumCulled = false;
    glintPoints.renderOrder = 3;
    this.root.add(glintPoints);

    // she stands in the gap, back to you, with her hair all the way down
    const woman = kit.figures.crowd({ avatar: 'figure_woman', face: 'blank', white: true, tint: 0x59616a, clip: 'f_idle_touch_hair_01', time: 0.6 }, 1);
    this.woman = woman;
    woman.set(0, FIGURE_X, groundAt(FIGURE_X, FIGURE_Z) - 0.02, FIGURE_Z, Math.PI, FIGURE_SCALE);
    woman.commit();
    this.root.add(woman.root);
    const feet = groundAt(FIGURE_X, FIGURE_Z);
    const hair = new InstancedMesh(hairGeometry(FIGURE_X, feet + 1.87, FIGURE_Z, feet, rnd), new MeshStandardMaterial({ color: 0xc2cbd0, roughness: 0.62, side: DoubleSide }), 1);
    hair.setMatrixAt(0, this.tmpM.identity());
    hair.setColorAt(0, tint.setScalar(1));
    hair.receiveShadow = true;
    hair.frustumCulled = false;
    this.root.add(hair);
    this.hair = hair;

    this.clocks.push(b.motes(240, { x: [-4.5, 4.5], y: [0.1, 3.2], z: [-13, 5] }, this.root, { size: 0.014, color: 0xcfe2ee, strength: 0.55, seed: 4 }).time);

    // your own lids, waiting just outside the frame
    const lidMaterial = new MeshBasicMaterial({ color: 0x000000, transparent: true, depthTest: false, depthWrite: false, fog: false });
    const lidShape = lidGeometry();
    this.lidUp = new Mesh(lidShape, lidMaterial);
    this.lidDown = new Mesh(lidShape, lidMaterial);
    this.lidDown.rotation.z = Math.PI;
    for (const lid of [this.lidUp, this.lidDown]) {
      lid.position.z = -LID_Z;
      lid.renderOrder = 9999;
      lid.frustumCulled = false;
      lid.visible = false;
      this.lens.add(lid);
    }

    this.fear = 0.22;
    this.sounds();
  }

  private sounds(): void {
    const s = this.sound;
    this.beat(0, () => {
      this.forest = s.bed('rooms/forest_night.mp3', { gain: 0.24 });
      this.wind = s.bed('rooms/night_wind_far.mp3', { gain: 0.08, lowpass: 1200 });
    });
    this.beat(3.2, () => s.play('rooms/twig_snap_1.mp3', { gain: 0.22, pan: -0.6, reverb: 0.6, lowpass: 4000 }));
    // the first eyes come open on the left; then one of them shuts on you, and opens again
    this.beat(5.8, () => s.play('rooms/eye_turn.mp3', { gain: 0.1, pan: -0.4 }));
    this.beat(6.5, () => s.play('rooms/eye_blink.mp3', { gain: 0.3, pan: -0.35 }));
    this.beat(7.4, () => s.play('rooms/eye_turn.mp3', { gain: 0.14, pan: 0.6 }));
    // the one behind you: its first step makes no sound, only the shadows move; the next two do, nearer
    this.beat(LURCHES[1][0], () => s.play('rooms/twig_snap_2.mp3', { gain: 0.16, pan: 0.05, reverb: 0.25, lowpass: 3200 }));
    this.beat(LURCHES[2][0], () => s.play('rooms/twig_snap_1.mp3', { gain: 0.26, pan: -0.05, reverb: 0.12, lowpass: 6000 }));
    this.beat(9.3, () => s.play('rooms/eye_turn.mp3', { gain: 0.14, pan: -0.3 }));
    this.beat(10.4, () => s.play('rooms/eye_blink.mp3', { gain: 0.24, pan: -0.2 }));
    // more and more of them turning, the closer it gets
    this.beat(10.9, () => s.play('rooms/eye_turn.mp3', { gain: 0.1, pan: 0.7 }));
    this.beat(11.9, () => s.play('rooms/eye_turn.mp3', { gain: 0.16, pan: -0.6 }));
    this.beat(12.3, () => s.play('rooms/eye_turn.mp3', { gain: 0.2, pan: 0.35 }));
    this.beat(SHUTTER_AT - 0.6, () => {
      this.forest?.gain(0.04, 0.6);
      this.wind?.gain(0.02, 0.6);
    });
    this.beat(SHUTTER_AT, () => this.shutter());
    // a real silence before they close
    this.beat(SHUTTER_AT + 0.2, () => {
      this.forest?.gain(0, 0.7);
      this.wind?.gain(0, 0.7);
    });
    this.beat(BLINK_AT, () => s.play('rooms/eye_blink_many.mp3', { gain: 0.5 }));
  }

  update(frame: RoomFrame): void {
    const sec = frame.seconds;
    const closing = smooth((sec - BLINK_AT) / BLINK_TIME);
    const out = smooth((sec - BLINK_AT - LIGHT_LAG) / LIGHT_FALL);
    const o = this.origin;

    // the light keeps behind the eye, and comes nearer in lurches, as if someone took a step
    this.pose(frame.t, this.eyePose);
    let gap = GAP_START;
    let from = GAP_START;
    for (let i = 0; i < LURCHES.length; i++) {
      gap += (LURCHES[i][1] - from) * smooth((sec - LURCHES[i][0]) / LURCH_TIME);
      from = LURCHES[i][1];
    }
    const lx = KEY_SIDE + (this.eyePose.position.x - o.x) * 0.5;
    const lz = this.eyePose.position.z - o.z + gap;
    const power = KEY_LEVEL * (gap + 6) * (gap + 6) * (1 + 0.015 * Math.sin(frame.time * 0.9)) * (1 - out);
    this.keyAt[0] = o.x + lx;
    this.keyAt[1] = o.y + KEY_HEIGHT;
    this.keyAt[2] = o.z + lz;
    this.keyAim[0] = o.x + lx * 0.3;
    this.keyAim[1] = o.y + KEY_HEIGHT - KEY_AIM_DOWN;
    this.keyAim[2] = o.z + lz - KEY_AIM_AHEAD;
    this.key.intensity = power;
    this.movingShadows = out < 1;
    this.core.position.set(lx, KEY_HEIGHT, lz);
    this.halo.position.set(lx, KEY_HEIGHT, lz);
    this.core.visible = out < 1;
    this.halo.visible = out < 1;
    this.man.set(0, lx, groundAt(lx, lz) - 0.02, lz - 0.06, Math.PI);
    this.man.commit();

    this.uKeyAt.value.set(o.x + lx, o.y + KEY_HEIGHT, o.z + lz);
    this.uKeyAxis.value.set(lx * 0.3 - lx, -KEY_AIM_DOWN, -KEY_AIM_AHEAD).normalize();
    this.uTime.value = frame.time;
    this.mistPower.value = power * MIST_LIGHT;
    this.bankPower.value = power * BANK_LIGHT;
    this.bandPower.value = power * BAND_LIGHT;

    const clearing = (sec - MIST_CLEARS[0]) / (MIST_CLEARS[1] - MIST_CLEARS[0]);
    this.bankOpacity.value = 1 - smooth(clearing);
    this.woman.root.visible = sec > MIST_CLEARS[0] - 0.6;
    this.hair.visible = this.woman.root.visible;

    // your own lids come down with all of them
    const lid = smooth((sec - BLINK_AT - LID_LAG) / LID_TIME);
    this.lidUp.visible = lid > 0;
    this.lidDown.visible = lid > 0;
    this.lidUp.position.y = LID_OPEN + (LID_MEET - LID_ARCH - LID_OPEN) * lid;
    this.lidDown.position.y = -LID_OPEN + (LID_MEET + LID_ARCH + LID_OPEN) * lid;
    this.black = smooth((sec - BLINK_AT - LID_LAG - LID_TIME * 0.85) / 0.08);

    this.fear = 0.22 + 0.5 * smooth((sec - 5) / 8) + 0.2 * closing;
    // the lens holds the first trunks, finds the eyes, goes out to her, comes back to the eyes for the picture
    this.focus =
      FOCUS_WOOD +
      (FOCUS_EYE - FOCUS_WOOD) * smooth((sec - 5) / 2) +
      (FOCUS_HER - FOCUS_EYE) * smooth((sec - 10.5) / 1.2) +
      (FOCUS_SHOT - FOCUS_HER) * smooth((sec - 12.2) / 0.7);
    for (const c of this.clocks) c.value = frame.time;
    this.glintSeconds.value = sec;
    this.glintClose.value = closing;

    // every eye keeps the viewer in view
    const cam = frame.view.position;
    const tx = cam.x - o.x;
    const ty = cam.y - o.y;
    const tz = cam.z - o.z;
    for (let i = 0; i < this.eyeCount; i++) {
      const open = smooth((sec - this.eyeOpen[i]) / OPEN_TIME);
      let shut = closing;
      for (let k = 0; k < this.loneEye.length; k++) {
        if (i === this.loneEye[k]) shut = Math.max(shut, smooth(1 - Math.abs(sec - LONE_BLINKS[k][2]) / LONE_BLINK_TIME));
      }
      // some blink by themselves, each on its own beat, never at the picture
      const g = i * 4;
      const every = this.eyeTimes[g + 2];
      if (every > 0 && Math.abs(sec - SHUTTER_AT) > EYE_BLINK_CLEAR) {
        const c = sec + this.eyeTimes[g + 3] - Math.floor((sec + this.eyeTimes[g + 3]) / every) * every;
        shut = Math.max(shut, smooth(1 - Math.abs(c - LONE_BLINK_TIME) / LONE_BLINK_TIME));
      }
      const lidOpen = Math.max(SLIT, open * (1 - shut) * this.eyeLid[i]);
      // most stare at you, each a little past; the restless ones look away and jump back to you, each in its own time
      let on = 1;
      const cycle = this.eyeTimes[g + 1];
      if (cycle > 0) {
        const c = sec + this.eyeTimes[g + 3] - Math.floor((sec + this.eyeTimes[g + 3]) / cycle) * cycle;
        on = smooth((c - cycle * GAZE_AWAY_SHARE) / SACCADE_TIME) * (1 - smooth((c - cycle + SACCADE_TIME) / SACCADE_TIME));
      }
      const gx = this.eyeGaze[g + 2] + (this.eyeGaze[g] - this.eyeGaze[g + 2]) * on;
      const gy = this.eyeGaze[g + 3] + (this.eyeGaze[g + 1] - this.eyeGaze[g + 3]) * on;
      const w = Math.sin(frame.time * this.eyeTimes[g] + i * 1.7) * GAZE_WANDER;
      this.tmpP.set(this.eyeAt[i * 3], this.eyeAt[i * 3 + 1], this.eyeAt[i * 3 + 2]);
      this.tmpT.set(tx + w + gx, ty + w * 0.5 + gy, tz);
      this.tmpLook.lookAt(this.tmpT, this.tmpP, UP);
      this.tmpQ.setFromRotationMatrix(this.tmpLook);
      this.tmpR.setFromAxisAngle(FORWARD, this.eyeRoll[i]);
      this.tmpQ.multiply(this.tmpR);
      this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpScale.setScalar(EYE_SCALE * this.eyeSize[i]));
      this.tmpM.multiply(this.tmpS.makeScale(1, lidOpen, 1)).multiply(this.toCenter);
      this.balls.setMatrix(i, this.tmpM);
    }
    this.balls.commit();
  }
}
