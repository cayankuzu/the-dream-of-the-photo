import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RGBAFormat,
  Raycaster,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type PerspectiveCamera,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import { randomFrom } from '../../dream/FigureKit';
import { DEG, lerp, range, smootherstep } from '../../math';
import type { RoomAir, RoomAssets, RoomContext, RoomFilm, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['raven', 'chair_white', 'fork'],
  materials: ['conc_board', 'grass_meadow'],
  sounds: [
    'rooms/night_wind_far.mp3',
    'rooms/wind_grass.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/wind_high_gusts.mp3',
    'rooms/fork_plate_1.mp3',
    'rooms/fork_plate_4.mp3',
    'rooms/wood_creak_small_3.mp3',
    'rooms/wood_creak_small_5.mp3',
    'rooms/pigeons_below.mp3',
    'rooms/sheets_lift.mp3',
  ],
};

/** Beats (s): the fork lands on the seat, the wind comes, the field falls silent, the wings, the shutter, the cut. */
const LANDS_AT = 5;
const WIND_AT = 10;
const HUSH_AT = 10.55;
const WINGS_AT = 10.9;
const SHUTTER_AT = 12;
const CUT_AT = 13.5;
/** The fork: gravity (m/s²), how far it turns about its length and round while it falls (rad), how far it leans where it stands in the seat (rad). */
const GRAVITY = 9.81;
const FALL_ROLL = 0.5;
const FALL_YAW = 0.35;
const FORK_LEAN = 0.14;
/** Its quiver in the wood: how far (rad), how fast (Hz, slower than any flicker), how soon it is still (s). */
const QUIVER = 0.1;
const QUIVER_RATE = 3;
const QUIVER_FADE = 0.22;
/** How deep its tines go into the seat (m). */
const FORK_SINK = 0.018;
/** A second, smaller ring as it quivers (s after the first). */
const RING_AGAIN = 0.13;
/** The fork, a little larger than a table fork (times its size), and its old tarnished steel: dark against the mist and the white seat. */
const FORK_SCALE = 1.4;
const FORK_COLOR = 0x5c5b56;
/** Half its length (m; a table fork is 18.5 cm): standing in the seat, its middle is this far over the wood, less the sink. */
const FORK_HALF_LENGTH = 0.0925 * FORK_SCALE;

/** The tree's trunk (m), and the low knoll it stands on: height and radius (m). */
const TREE_X = 0.9;
const TREE_Z = -16;
const KNOLL_H = 0.32;
const KNOLL_R = 5.5;
/** Eye height over the ground (m). */
const EYE = 1.62;
/** The glide toward the tree: second, x, z (m), heading, pitch (deg), lens (deg). */
const GLIDE: readonly (readonly [number, number, number, number, number, number])[] = [
  [0, 0, 2, 2.5, 7.5, 46],
  [2.5, 0.05, 0.3, 3, 6.5, 44],
  [5, 0.14, -2, 3.8, 4.2, 37.5],
  [8, 0.24, -3.9, 1.6, 6, 43.5],
  [12, 0.36, -6.2, -0.4, 8, 44],
  [14, 0.4, -6.9, -0.6, 8.4, 43.5],
];

/** Trunk: height to the crown (m), radius under the crown (m), how much its foot swells (share) and how high the swelling climbs (m). */
const TRUNK_H = 2.7;
const TRUNK_R = 0.33;
const TRUNK_FLARE = 0.6;
const FLARE_RISE = 0.38;
/** The limbs that leave the crown: how many, length (m), base radius (m), how steeply they rise (deg over the level). */
const LIMBS = 5;
const LIMB_LENGTH = [5.2, 6.8] as const;
const LIMB_R = [0.17, 0.22] as const;
const LIMB_RISE = [24, 58] as const;
/** The long low limb that reaches out over the chair: where it leaves the trunk (m up), its heading from the trunk (x, z), reach (m), rise (deg), radius (m). */
const LOW_FROM = 1.95;
const LOW_WAY = [-0.84, 0.55] as const;
const LOW_LENGTH = 6.4;
const LOW_RISE = 9;
const LOW_R = 0.16;
/** Roots spreading over the knoll: how many, length (m), radius at the trunk (m); none comes nearer the chair's side than this (rad). */
const ROOTS = 5;
const ROOT_LENGTH = [0.7, 1.5] as const;
const ROOT_R = 0.2;
const ROOT_CLEAR = 0.45;
/**
 * What grows from what, by level (0 the limbs, 4 the finest twigs): step along it (m), how much it wanders and
 * turns up at each step, children along it and at its tip, their length as a share of its own, their angle off it (deg).
 */
const LEVELS: readonly { step: number; wander: number; lift: number; along: number; tip: number; length: readonly [number, number]; angle: readonly [number, number] }[] = [
  { step: 0.45, wander: 0.09, lift: 0.012, along: 5, tip: 2, length: [0.42, 0.58], angle: [34, 62] },
  { step: 0.36, wander: 0.15, lift: 0.03, along: 4, tip: 2, length: [0.5, 0.66], angle: [32, 58] },
  { step: 0.28, wander: 0.22, lift: 0.05, along: 3, tip: 2, length: [0.48, 0.64], angle: [30, 55] },
  { step: 0.2, wander: 0.3, lift: 0.08, along: 2, tip: 1, length: [0.42, 0.6], angle: [28, 52] },
  { step: 0.12, wander: 0.32, lift: 0.1, along: 0, tip: 0, length: [0, 0], angle: [0, 0] },
];
/** A child's radius against its parent's where it leaves it, and its tip against its base. */
const CHILD_R = [0.6, 0.72] as const;
const TAPER = 0.32;
/** Branches thinner than this are fine lines (m); from STIFF down the wind moves them, fully at LIMP (m). */
const LINE_BELOW = 0.016;
const STIFF = 0.019;
const LIMP = 0.004;
/** Bark (old board grain, its lines along the wood): its image repeats every (m), its tint. */
const BARK_TILE = 1;
const BARK_COLOR = 0x5a544c;
/** The wood's shape: furrows round it per meter of radius, how deep they cut and how much it swells (share of the radius). */
const BARK_RIDGES = 30;
const BARK_FURROW = 0.12;
const BARK_BURR = 0.07;
/** The fine twigs and the wires against the sky (linear), and the screen height a line is kept one pixel wide for (px). */
const LINE_COLOR = [0.009, 0.009, 0.008] as const;
const LINE_PIXELS = 900;

/** A raven: height (m), size from bird to bird (share), the way every one faces (deg; 0 is +X, the way the scan looks), how far one may be off it (deg). */
const RAVEN_SCALE = 0.3;
const RAVEN_SIZE = [0.9, 1.14] as const;
const RAVEN_HEADING = -150;
const RAVEN_JITTER = 7;
/** Birds in the tree, how near two may sit (m), the steepest branch one sits on (rise per run), the lowest one sits (m). */
const TREE_RAVENS = 215;
const RAVEN_GAP = 0.32;
const PERCH_SLOPE = 1.4;
const PERCH_LOW = 2.3;
/** The one with the fork: how far out along the low limb (m from the trunk's axis), and how clear of the others (m). */
const FORK_REACH = 2.1;
const FORK_CLEAR = 0.75;

/** The line of poles: one stands here (x, z m); the line runs off to the far left this way; a pole every SPAN m, numbered from FIRST to LAST. */
const POLE_AT = [6.5, -24.5] as const;
const POLE_LINE = [-0.5, -0.866] as const;
const POLE_SPAN = 24;
const FIRST_POLE = -3;
const LAST_POLE = 6;
/** A pole: height (m), radii at the top and the foot (m), the crossarm's length (m), where the two wires hang on it (m either side, m up). */
const POLE_H = 8.9;
const POLE_R = [0.1, 0.14] as const;
const ARM = 2.1;
const WIRE_OFF = 0.85;
const WIRE_Y = 8.6;
/** The wire: radius (m), how far a span full of birds sags and an empty one (m). */
const WIRE_R = 0.011;
const SAG_LOADED = 1.9;
const SAG_EMPTY = 0.8;
/** The spans that carry birds (pole k to k + 1), and the space between two birds on them (m). */
const LOADED_SPANS = [-1, 0] as const;
const WIRE_GAP = [0.34, 0.52] as const;

/** The kitchen chair: how far it is turned (deg). */
const CHAIR_TURN = -28;

/** Where the sun went down (a direction on the ground). */
const GLOW_XZ = [-0.42, -0.907] as const;
/** The last light, low over the field beyond the tree: how far behind it (m), how high (m), where it aims (offset from the trunk, m), cd, half angle (deg). */
const KEY_BACK = 30;
const KEY_HEIGHT = 13;
const KEY_AIM = [0.6, 0.4, 2.5] as const;
const KEY_POWER = 2300;
const KEY_ANGLE = 15;
const KEY_COLOR = 0xe6d2ae;
/**
 * A pale catch from nowhere on the white chair and the foot of the trunk beside it, so that they keep their
 * shapes (and the flock's shadows can be seen to cross them): where from (offset from the point between them, m),
 * cd, half angle (deg).
 */
const KICK_FROM = [-3.4, 3.8, 8] as const;
const KICK_POWER = 34;
const KICK_ANGLE = 11;
const KICK_COLOR = 0xc9d3d0;

/** The air at dusk, in linear light: overhead, along the horizon, the wide afterglow, its hot middle. */
const ZENITH = [0.004, 0.009, 0.014] as const;
const HORIZON = [0.032, 0.046, 0.05] as const;
const GLOW_WIDE = [0.1, 0.085, 0.06] as const;
const GLOW_HOT = [0.5, 0.33, 0.17] as const;
/** The sky round the eye (m: inside the walk's own dome), the field round the tree (m), the far hedges (m from the tree), how dark they stand against the air. */
const SKY_RADIUS = 172;
const FIELD_RADIUS = 140;
const HEDGE_RING = 128;
const HEDGE_COLUMNS = 640;
const HEDGE_SHADE = 0.42;
/** Mist on the field: its density at the ground (per m of path), the height over which it thins to a third (m), how bright against the air. */
const MIST_DENSITY = 0.09;
const MIST_HEIGHT = 0.7;
const MIST_GAIN = 1.15;
/** The mist thins out toward the eye: none nearer than the first (m), all of it from the second. */
const MIST_CLEAR = [3.5, 13] as const;
/** How much faster the mist runs while the wind blows. */
const MIST_GUST = 6;
/** Dry grass: tufts, their height (m), how far from the eye's way they thin out (m). */
const TUFTS = 1900;
const TUFT_HEIGHT = [0.22, 0.62] as const;
const TUFT_THIN = 12;
/** The tint of the field's grass. */
const GROUND_COLOR = 0x4b5442;
/** The worn way through the grass to the chair: half width (m), and where it comes from behind you (x, z m). */
const PATH_W = 0.42;
const PATH_TO_X = 0.2;
const PATH_FROM_Z = 7;

/**
 * The shadows of a flock that is not there: the width of the picture of them (m, it repeats across), the length
 * of the flock (m), its speed (m/s), where its front is when the wings begin (z, m), how long the low light draws
 * each shadow over the field (times the bird; on what stands up, a meter of height is that many meters of field),
 * how much light they take at most, how many birds.
 */
const FLOCK_W = 26;
const FLOCK_L = 30;
const FLOCK_SPEED = REDUCED_MOTION ? 8 : 14;
const FLOCK_FROM = -6.9;
const FLOCK_STRETCH = 3.5;
const FLOCK_DARK = REDUCED_MOTION ? 0.5 : 0.82;
const FLOCK_BIRDS = 420;
/** Their wingspan (m) and how soft their edge is (px of the 512 picture). */
const FLOCK_SPAN = [0.8, 1.7] as const;
const FLOCK_BLUR = [1, 3] as const;

/** Sound, from ROOM_SOUNDS.md: the beds at rest. */
const GAIN_WIND = 0.13;
const GAIN_GRASS = 0.08;
const GAIN_DRONE = 0.07;
/** The lens: how shallow. */
const APERTURE = 2.2;

const TAU = Math.PI * 2;
const ease = (a: number, b: number, x: number): number => smootherstep(range(a, b, x));
const glsl = (c: readonly [number, number, number]): string => `vec3(${c[0].toFixed(4)}, ${c[1].toFixed(4)}, ${c[2].toFixed(4)})`;

/** The ground: a low knoll under the tree, and the field rolling a little away from it. */
const groundY = (x: number, z: number): number => {
  const d2 = (x - TREE_X) ** 2 + (z - TREE_Z) ** 2;
  const knoll = KNOLL_H * Math.exp(-d2 / (KNOLL_R * KNOLL_R));
  const away = 1 - Math.exp(-d2 / 400);
  return knoll + away * (0.14 * Math.sin(x * 0.21 + 0.6) * Math.sin(z * 0.17 + 1.3) + 0.06 * Math.sin(x * 0.53 - z * 0.41));
};

/** A limb of the tree: points along it, its radius at each, and how far the wind may move each (0 wherever a bird could sit). */
interface Limb {
  points: Vector3[];
  radii: number[];
  flex: number[];
}

/** 0 for what is stiff enough to carry a bird, up to 1 at the finest twig. */
const limpness = (r: number): number => smootherstep(range(STIFF, LIMP, r));

/** The tree: trunk, roots, limbs and everything that grows from them, down to the finest twig. */
function growTree(random: () => number): { limbs: Limb[]; low: Limb } {
  const limbs: Limb[] = [];
  const up = new Vector3(0, 1, 0);
  const across = new Vector3(1, 0, 0);
  const side = new Vector3();
  const tangent = new Vector3();
  const pick = (r: readonly [number, number]) => r[0] + (r[1] - r[0]) * random();

  const grow = (from: Vector3, dir: Vector3, length: number, r0: number, level: number, flexBase: number, lift = LEVELS[level].lift): Limb => {
    const spec = LEVELS[level];
    const n = Math.max(2, Math.round(length / spec.step));
    const step = length / n;
    const d = dir.clone().normalize();
    const at = from.clone();
    const limb: Limb = { points: [at.clone()], radii: [r0], flex: [flexBase] };
    const r1 = r0 * TAPER;
    for (let i = 1; i <= n; i++) {
      d.x += (random() - 0.5) * spec.wander;
      d.y += (random() - 0.5) * spec.wander * 0.6 + lift;
      d.z += (random() - 0.5) * spec.wander;
      d.normalize();
      at.addScaledVector(d, step);
      const r = lerp(r0, r1, (i / n) ** 0.8);
      limb.points.push(at.clone());
      limb.radii.push(r);
      limb.flex.push(flexBase + Math.max(0, limpness(r) - limpness(r0)));
    }
    limbs.push(limb);
    if (level + 1 >= LEVELS.length) return limb;
    // children: along it, and a fork at its tip that carries it on
    const spawn = (k: number, angle: number, share: number) => {
      const a = limb.points[Math.max(0, k - 1)];
      const b = limb.points[Math.min(n, k + 1)];
      tangent.subVectors(b, a).normalize();
      side.crossVectors(tangent, Math.abs(tangent.y) < 0.9 ? up : across).normalize().applyAxisAngle(tangent, random() * TAU);
      const way = tangent.clone().multiplyScalar(Math.cos(angle * DEG)).addScaledVector(side, Math.sin(angle * DEG));
      way.y += 0.12;
      grow(limb.points[k], way, length * share, Math.max(LIMP * 0.6, limb.radii[k] * pick(CHILD_R)), level + 1, limb.flex[k]);
    };
    for (let j = 0; j < spec.along; j++) {
      const u = 0.22 + 0.72 * ((j + 0.5 + (random() - 0.5) * 0.6) / spec.along);
      spawn(Math.min(n - 1, Math.max(1, Math.round(u * n))), pick(spec.angle), pick(spec.length));
    }
    for (let j = 0; j < spec.tip; j++) spawn(n, pick(spec.angle) * 0.45, pick(spec.length) * 1.1);
    return limb;
  };

  // the trunk, leaning a little, its foot swelling into the knoll
  const trunk: Limb = { points: [], radii: [], flex: [] };
  const base = groundY(TREE_X, TREE_Z);
  for (let i = 0; i <= 12; i++) {
    const h = -0.4 + ((TRUNK_H + 0.4) * i) / 12;
    const sway = Math.sin(h * 1.3) * 0.05;
    trunk.points.push(new Vector3(TREE_X + sway + h * 0.04, base + h, TREE_Z - h * 0.025));
    trunk.radii.push(TRUNK_R * (1.08 - 0.08 * (h / TRUNK_H)) * (1 + TRUNK_FLARE * Math.exp(-Math.max(h, 0) / FLARE_RISE)));
    trunk.flex.push(0);
  }
  limbs.push(trunk);
  const crown = trunk.points[trunk.points.length - 1];

  // roots over the knoll, sinking as they go; none toward the chair
  const lowAngle = Math.atan2(LOW_WAY[1], LOW_WAY[0]);
  for (let i = 0; i < ROOTS; i++) {
    let a = ((i + random() * 0.8) / ROOTS) * TAU;
    const off = Math.atan2(Math.sin(a - lowAngle), Math.cos(a - lowAngle));
    if (Math.abs(off) < ROOT_CLEAR) a = lowAngle + Math.sign(off || 1) * ROOT_CLEAR;
    const length = pick(ROOT_LENGTH);
    const bend = (random() - 0.5) * 0.9;
    const root: Limb = { points: [], radii: [], flex: [] };
    for (let k = 0; k <= 8; k++) {
      const u = k / 8;
      const reach = 0.1 + length * u;
      const x = TREE_X + Math.cos(a + bend * u) * reach;
      const z = TREE_Z + Math.sin(a + bend * u) * reach;
      const r = ROOT_R * (1 - 0.8 * Math.sqrt(u)) * (0.75 + 0.5 * random());
      root.points.push(new Vector3(x, lerp(base + 0.5, groundY(x, z) + r * 0.2 - 0.1 * u, Math.sqrt(u)), z));
      root.radii.push(r);
      root.flex.push(0);
    }
    limbs.push(root);
  }

  // the limbs of the crown, and the one long low limb over the chair
  const lowFrom = trunk.points.reduce((best, p) => (Math.abs(p.y - base - LOW_FROM) < Math.abs(best.y - base - LOW_FROM) ? p : best));
  const lowWay = new Vector3(LOW_WAY[0], 0, LOW_WAY[1]).normalize();
  lowWay.y = Math.tan(LOW_RISE * DEG);
  const low = grow(lowFrom, lowWay, LOW_LENGTH, LOW_R, 0, 0, 0.004);
  for (let i = 0; i < LIMBS; i++) {
    const a = lowAngle + ((i + 0.7 + (random() - 0.5) * 0.5) / (LIMBS + 0.4)) * TAU;
    const rise = pick(LIMB_RISE) * DEG;
    const way = new Vector3(Math.cos(a) * Math.cos(rise), Math.sin(rise), Math.sin(a) * Math.cos(rise));
    grow(crown.clone().addScaledVector(way, 0.1), way, pick(LIMB_LENGTH), pick(LIMB_R), 0, 0);
  }
  return { limbs, low };
}

/** Bark round every limb thick enough to be one: rings carried along it, texture in meters. */
function barkGeometry(limbs: readonly Limb[]): BufferGeometry {
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const flex: number[] = [];
  const index: number[] = [];
  const T = new Vector3();
  const N = new Vector3();
  const B = new Vector3();
  const tmp = new Vector3();
  for (const limb of limbs) {
    const pts = limb.points;
    const n = pts.length;
    const r0 = limb.radii[0];
    const radial = r0 > 0.25 ? 30 : r0 > 0.12 ? 14 : r0 > 0.05 ? 8 : 5;
    const wraps = Math.max(1, Math.round((TAU * r0) / BARK_TILE));
    const base = position.length / 3;
    let along = 0;
    for (let i = 0; i < n; i++) {
      T.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      // the ring's frame is carried along from the last one, so that the bark does not twist
      if (i === 0) N.set(Math.abs(T.y) > 0.95 ? 1 : 0, Math.abs(T.y) > 0.95 ? 0 : 1, 0);
      N.sub(tmp.copy(T).multiplyScalar(N.dot(T))).normalize();
      B.crossVectors(T, N);
      if (i > 0) along += pts[i].distanceTo(pts[i - 1]);
      // the very tip closes in, so that no open ring shows
      const r = limb.radii[i] * (i === n - 1 ? 0.45 : 1);
      const ridges = Math.max(3, Math.round(r * BARK_RIDGES));
      for (let k = 0; k <= radial; k++) {
        const a = (k / radial) * TAU;
        const nx = N.x * Math.cos(a) + B.x * Math.sin(a);
        const ny = N.y * Math.cos(a) + B.y * Math.sin(a);
        const nz = N.z * Math.cos(a) + B.z * Math.sin(a);
        // old wood is not round: long furrows, and burrs and swellings along it
        const furrow = Math.abs(Math.sin(a * ridges * 0.5 + 0.4 * Math.sin(along * 1.7 + r * 9)));
        const burr = Math.sin(along * 1.9 + a * 2 + r * 31) * Math.sin(along * 0.83 - a + r * 17);
        const rr = r * (1 + BARK_FURROW * (furrow - 0.6) * (r > 0.05 ? 1 : 0.3) + BARK_BURR * burr);
        position.push(pts[i].x + nx * rr, pts[i].y + ny * rr, pts[i].z + nz * rr);
        normal.push(nx, ny, nz);
        // the image's grain runs across it: along the wood
        uv.push(along, (k / radial) * wraps * BARK_TILE);
        flex.push(limb.flex[i]);
      }
      if (i < n - 1) {
        for (let k = 0; k < radial; k++) {
          const a = base + i * (radial + 1) + k;
          const b = a + radial + 1;
          index.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('aFlex', new Float32BufferAttribute(flex, 1));
  g.setIndex(index);
  return g;
}

/** Fine lines (twigs, wires): a ribbon along each that the shader turns to face the eye and keeps at least a pixel wide. */
function lineGeometry(lines: readonly Limb[]): BufferGeometry {
  const position: number[] = [];
  const dir: number[] = [];
  const info: number[] = [];
  const index: number[] = [];
  const T = new Vector3();
  for (const line of lines) {
    const pts = line.points;
    const n = pts.length;
    const base = position.length / 3;
    for (let i = 0; i < n; i++) {
      T.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      for (const side of [-1, 1]) {
        position.push(pts[i].x, pts[i].y, pts[i].z);
        dir.push(T.x, T.y, T.z);
        info.push(side, line.radii[i], line.flex[i]);
      }
      if (i < n - 1) {
        const a = base + i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(position, 3));
  g.setAttribute('aDir', new Float32BufferAttribute(dir, 3));
  g.setAttribute('aInfo', new Float32BufferAttribute(info, 3));
  g.setIndex(index);
  return g;
}

/** Tiling value noise: red broad, green fine. */
function noiseTexture(random: () => number): DataTexture {
  const size = 256;
  const layer = (cells: number): Float32Array => {
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = random();
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells;
      const iy = Math.floor(fy);
      const ty = fy - iy;
      const sy = ty * ty * (3 - 2 * ty);
      const y1 = (iy + 1) % cells;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const ix = Math.floor(fx);
        const tx = fx - ix;
        const sx = tx * tx * (3 - 2 * tx);
        const x1 = (ix + 1) % cells;
        const a = lattice[iy * cells + ix];
        const b = lattice[iy * cells + x1];
        const c = lattice[y1 * cells + ix];
        const d = lattice[y1 * cells + x1];
        out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
      }
    }
    return out;
  };
  const sum = (layers: readonly Float32Array[], weights: readonly number[], i: number) => layers.reduce((s, l, k) => s + l[i] * weights[k], 0);
  const broad = [layer(4), layer(8), layer(16), layer(32)];
  const fine = [layer(16), layer(32), layer(64)];
  const data = new Uint8Array(size * size * 4);
  const stretch = (v: number) => Math.round(255 * Math.min(1, Math.max(0, (v - 0.22) / 0.56)));
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = stretch(sum(broad, [0.5, 0.25, 0.15, 0.1], i));
    data[i * 4 + 1] = stretch(sum(fine, [0.55, 0.3, 0.15], i));
    data[i * 4 + 2] = 128;
    data[i * 4 + 3] = 255;
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The flock's shadows seen from above, white where the light is taken: the bottom of the picture is its front.
 * Few and apart at the front and the tail, so that no point of the ground is crossed faster than the eye can
 * bear; overlapping into one dark body in the middle.
 */
function flockTexture(random: () => number, marks: readonly (readonly [number, number])[]): CanvasTexture {
  const px = 512;
  const long = px * 2;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = long;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, px, long);
  const body = g.createLinearGradient(0, long, 0, 0);
  for (const [at, a] of [[0, 0], [0.24, 0.08], [0.42, 0.5], [0.6, 0.42], [0.8, 0.06], [1, 0]] as const) body.addColorStop(at, `rgba(255,255,255,${a})`);
  g.fillStyle = body;
  g.fillRect(0, 0, px, long);
  const perX = px / FLOCK_W;
  const perZ = long / FLOCK_L;
  /** One shadow: head toward the front (down the picture), wings swept back, a wedge of tail; drawn long, as the low light draws it. */
  const bird = (x: number, v: number, span: number, flap: number, turn: number, blur: number, alpha: number) => {
    g.filter = `blur(${blur.toFixed(1)}px)`;
    g.fillStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
    const at = ((x % FLOCK_W) + FLOCK_W) % FLOCK_W;
    for (const wrap of [-FLOCK_W, 0, FLOCK_W]) {
      if (Math.abs(at + wrap - FLOCK_W / 2) > FLOCK_W / 2 + span) continue;
      g.save();
      g.translate((at + wrap) * perX, (1 - v) * long);
      g.scale(perX, perZ * FLOCK_STRETCH);
      g.rotate(turn);
      const w = span / 2;
      g.beginPath();
      g.ellipse(0, 0, span * 0.05, span * 0.2, 0, 0, TAU);
      g.moveTo(-span * 0.06, -span * 0.15);
      g.lineTo(0, -span * 0.33);
      g.lineTo(span * 0.06, -span * 0.15);
      for (const s of [-1, 1]) {
        g.moveTo(0, span * 0.06);
        g.quadraticCurveTo(s * w * 0.5, span * 0.14 * flap, s * w, -span * (0.02 + 0.06 * flap));
        g.quadraticCurveTo(s * w * 0.55, -span * 0.08, 0, -span * 0.1);
      }
      g.fill();
      g.restore();
    }
  };
  const density = (v: number) => smootherstep(range(0.02, 0.32, v)) * (1 - smootherstep(range(0.62, 0.98, v)));
  for (let i = 0; i < FLOCK_BIRDS; i++) {
    let v = random();
    for (let k = 0; k < 24 && random() > 0.04 + density(v); k++) v = random();
    const span = FLOCK_SPAN[0] + (FLOCK_SPAN[1] - FLOCK_SPAN[0]) * random();
    bird(random() * FLOCK_W, v, span, 0.3 + random() * 0.9, (random() - 0.5) * 0.5, FLOCK_BLUR[0] + (FLOCK_BLUR[1] - FLOCK_BLUR[0]) * random(), 0.7 + random() * 0.3);
  }
  // the ones that lie across the chair and the trunk in the picture the shutter keeps: whole, and dark
  for (const [x, v] of marks) if (v > 0.02 && v < 0.98) bird(x, v, FLOCK_SPAN[1], 0.8, (random() - 0.5) * 0.3, FLOCK_BLUR[0], 1);
  g.filter = 'none';
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  return texture;
}

/** One air for the sky, the mist and the far hedges, so that they dissolve into each other with no seam. */
const AIR_GLSL = /* glsl */ `
uniform vec3 uGlow;
vec3 airAt(vec3 d) {
  float above = max(d.y + 0.015, 0.0);
  vec2 h = normalize(d.xz + vec2(1e-5));
  float toward = max(dot(h, normalize(uGlow.xz)), 0.0);
  vec3 c = mix(${glsl(HORIZON)}, ${glsl(ZENITH)}, 1.0 - exp(-above * 3.4));
  c += ${glsl(GLOW_WIDE)} * pow(toward, 2.5) * exp(-above * 6.0);
  c += ${glsl(GLOW_HOT)} * pow(toward, 18.0) * exp(-above * 20.0);
  return c;
}
`;

/** The flock's shadow over a point of the room (1: none). */
const FLOCK_GLSL = /* glsl */ `
uniform sampler2D uFlock;
uniform float uFlockFront;
uniform float uFlockDark;
varying vec3 vRoom;
float flockShade(vec3 p) {
  float v = (p.z - p.y * ${FLOCK_STRETCH.toFixed(3)} - uFlockFront) / ${FLOCK_L.toFixed(2)};
  if (uFlockDark <= 0.0 || v <= 0.0 || v >= 1.0) return 1.0;
  return 1.0 - uFlockDark * texture2D(uFlock, vec2(p.x / ${FLOCK_W.toFixed(2)}, v)).r;
}
`;

/** Where a vertex is in the room, for the shadows (after project_vertex, where `transformed` is final). */
const ROOM_AT = /* glsl */ `
vec4 roomAt = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
roomAt = instanceMatrix * roomAt;
#endif
vRoom = (modelMatrix * roomAt).xyz - uOrigin;
`;

/** The wind in the thin wood: nothing that carries a bird moves. */
const SWAY_GLSL = /* glsl */ `
uniform float uTime;
uniform float uWind;
vec3 sway(vec3 p, float flex) {
  float w = uWind * flex;
  return w * vec3(
    0.12 * sin(uTime * 2.3 + p.y * 0.9 + p.x * 0.4) + 0.05 * sin(uTime * 4.1 + p.z * 1.9),
    0.025 * sin(uTime * 3.3 + p.x * 1.2),
    0.09 * cos(uTime * 1.9 + p.x * 0.7 + p.z * 0.5)
  );
}
`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
${AIR_GLSL}
uniform sampler2D uNoise;
uniform float uDrift;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 col = airAt(d);
  float up = max(d.y, 0.0);
  vec2 q = d.xz / (up + 0.09);
  float n = texture2D(uNoise, q * vec2(0.011, 0.045) + vec2(0.13, uDrift * 0.0015)).r * 0.65 + texture2D(uNoise, q * vec2(0.045, 0.15) + vec2(0.37, uDrift * 0.003)).g * 0.35;
  float cloud = smoothstep(0.5, 0.8, n) * smoothstep(0.0, 0.05, up) * (1.0 - smoothstep(0.3, 0.85, up));
  float toward = max(dot(normalize(d.xz + vec2(1e-5)), normalize(uGlow.xz)), 0.0);
  vec3 under = mix(vec3(0.005, 0.008, 0.011), ${glsl(GLOW_HOT)} * 0.2, pow(toward, 9.0) * exp(-up * 9.0));
  col = mix(col, under, cloud * 0.85);
  gl_FragColor = vec4(col, 1.0);
}
`;

const RAY_VERT = /* glsl */ `
uniform vec3 uOrigin;
varying vec3 vRay;
varying vec3 vRoom;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vRay = w.xyz - cameraPosition;
  vRoom = w.xyz - uOrigin;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

/**
 * The low mist lying on the field, between the eye and a point of the room: thick at the ground and thinning
 * upward, in patches that drift; reckoned along the whole way, so that nothing standing in it shows a seam. It
 * glows with the air, and where the flock's shadow lies it is shadowed too.
 */
const MIST_GLSL = /* glsl */ `
uniform vec3 uOrigin;
uniform sampler2D uNoise;
uniform float uDrift;
vec3 misted(vec3 color, vec3 p) {
  vec3 eye = cameraPosition - uOrigin;
  vec3 ray = p - eye;
  float d = max(length(ray), 1e-3);
  vec3 r = ray / d;
  float b = ${(1 / MIST_HEIGHT).toFixed(4)};
  float rise = b * r.y * d;
  float along = abs(rise) < 1e-4 ? d : (1.0 - exp(-rise)) / (b * r.y);
  float amount = ${MIST_DENSITY.toFixed(4)} * exp(-b * eye.y) * along;
  float patches = texture2D(uNoise, p.xz * 0.021 + vec2(uDrift * 0.004, uDrift * 0.0015)).r;
  amount *= mix(0.5, 1.5, patches) * smoothstep(${MIST_CLEAR[0].toFixed(1)}, ${MIST_CLEAR[1].toFixed(1)}, d);
  vec3 c = airAt(vec3(r.x, max(r.y, 0.0), r.z)) * ${MIST_GAIN.toFixed(3)} * flockShade(p);
  return mix(color, c, 1.0 - exp(-amount));
}
`;

/** What every surface of the field needs: the air, the flock's shadow, the mist; and how its light ends (before opaque_fragment). */
const SURFACE_GLSL = `${AIR_GLSL}\n${FLOCK_GLSL}\n${MIST_GLSL}`;
const SURFACE_END = 'outgoingLight = misted(outgoingLight * flockShade(vRoom), vRoom);';

const HEDGE_FRAG = /* glsl */ `
${SURFACE_GLSL}
varying vec3 vRay;
void main() {
  vec3 r = normalize(vRay);
  gl_FragColor = vec4(misted(airAt(vec3(r.x, 0.0, r.z)) * ${HEDGE_SHADE.toFixed(3)}, vRoom), 1.0);
}
`;

const LINE_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${SWAY_GLSL}
attribute vec3 aDir;
attribute vec3 aInfo;
varying float vAlpha;
void main() {
  vec3 p = position + sway(position, aInfo.z);
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  vec3 t = normalize((modelViewMatrix * vec4(aDir, 0.0)).xyz);
  vec3 across = normalize(cross(t, normalize(mvPosition.xyz)));
  float pixel = 2.0 * -mvPosition.z / (projectionMatrix[1][1] * ${LINE_PIXELS.toFixed(1)});
  float halfWidth = max(aInfo.y, pixel * 0.5);
  mvPosition.xyz += across * aInfo.x * halfWidth;
  vAlpha = clamp(aInfo.y / (pixel * 0.5), 0.2, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const LINE_FRAG = /* glsl */ `
#include <fog_pars_fragment>
varying float vAlpha;
void main() {
  gl_FragColor = vec4(${glsl(LINE_COLOR)}, vAlpha);
  #include <fog_fragment>
}
`;

/** One dry tuft: blades fanning from a point, dark at the root, pale straw at the tip, one unit tall. */
function tuftGeometry(random: () => number): BufferGeometry {
  const position: number[] = [];
  const color: number[] = [];
  const index: number[] = [];
  const root = new Color(0.005, 0.008, 0.007);
  const tip = new Color(0.075, 0.07, 0.05);
  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * TAU + random() * 0.8;
    const h = 0.6 + random() * 0.4;
    const lean = 0.08 + random() * 0.3;
    const w = 0.012 + random() * 0.01;
    const cx = Math.cos(a) * 0.05 * random();
    const cz = Math.sin(a) * 0.05 * random();
    const sx = -Math.sin(a) * w;
    const sz = Math.cos(a) * w;
    const lx = Math.cos(a) * lean;
    const lz = Math.sin(a) * lean;
    const base = position.length / 3;
    position.push(cx - sx, 0, cz - sz, cx + sx, 0, cz + sz);
    position.push(cx - sx * 0.7 + lx * 0.3, h * 0.55, cz - sz * 0.7 + lz * 0.3, cx + sx * 0.7 + lx * 0.3, h * 0.55, cz + sz * 0.7 + lz * 0.3);
    position.push(cx + lx, h, cz + lz);
    for (const t of [0, 0, 0.55, 0.55, 1]) color.push(lerp(root.r, tip.r, t), lerp(root.g, tip.g, t), lerp(root.b, tip.b, t));
    index.push(base, base + 1, base + 3, base, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(position, 3));
  g.setAttribute('color', new Float32BufferAttribute(color, 3));
  g.setIndex(index);
  return g;
}

/** A polar sheet of ground round the tree, finer near it; UVs in meters. */
function groundGeometry(): BufferGeometry {
  const rings = 64;
  const segments = 144;
  const p = new Float32Array((rings + 1) * (segments + 1) * 3);
  const uv = new Float32Array((rings + 1) * (segments + 1) * 2);
  const index: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const r = FIELD_RADIUS * (i / rings) ** 1.9;
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * TAU;
      const x = TREE_X + r * Math.cos(a);
      const z = TREE_Z + r * Math.sin(a);
      const k = i * (segments + 1) + j;
      p.set([x, groundY(x, z), z], k * 3);
      uv.set([x, z], k * 2);
      if (i < rings && j < segments) {
        const b = k + segments + 1;
        index.push(k, b + 1, b, k, k + 1, b + 1);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(p, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const UP = new Vector3(0, 1, 0);

/**
 * A bare tree in a misty field at dusk, and on every branch of it, and on the sagging wire behind it, ravens:
 * hundreds, all facing the same way. Under the tree a kitchen chair. One of them lets a fork fall onto the seat.
 * Then the wind comes, and not one feather moves; and then thousands of wings pass low over you from behind,
 * and their shadows cross the field and the tree: nothing flies.
 */
export default class Birds extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x27312f, density: 0.016 },
    env: 'evening',
    envIntensity: 0.09,
    sky: 0,
    grade: { exposure: 1.16, saturation: 0.62, warmth: 0.02, tint: -0.02, flare: 0.003 },
  };
  film: RoomFilm = { bloom: 0.6, bloomFrom: 0.7, bloomTint: [1, 0.9, 0.78], grain: 0.4, scratches: 0.012, flicker: 0.02, weave: REDUCED_MOTION ? 0 : 0.0004, aberration: 0.0008 };
  focus = 16;
  aperture = APERTURE;
  drift = REDUCED_MOTION ? 0 : 0.4;
  fear = 0.28;

  private readonly u = {
    uOrigin: { value: new Vector3() },
    uGlow: { value: new Vector3(GLOW_XZ[0], 0, GLOW_XZ[1]).normalize() },
    uTime: { value: 0 },
    uWind: { value: 0 },
    uDrift: { value: 0 },
    uNoise: { value: null as DataTexture | null },
    uFlock: { value: null as CanvasTexture | null },
    uFlockFront: { value: FLOCK_FROM },
    uFlockDark: { value: 0 },
  };
  private readonly sky: Mesh;
  private readonly fork: Object3D;
  private readonly forkHeld = new Vector3();
  private readonly forkRest = new Vector3();
  private readonly forkYaw: number;
  private readonly release: number;
  private readonly fallTime: number;
  private readonly chairAt = new Vector3();
  private readonly eye = new Vector3();
  private wind: RoomVoice | null = null;
  private grass: RoomVoice | null = null;
  private drone: RoomVoice | null = null;
  private gust: RoomVoice | null = null;
  private wingsFar: RoomVoice | null = null;
  private wingsNear: RoomVoice | null = null;
  private wingsRush: RoomVoice | null = null;

  constructor(ctx: RoomContext) {
    super(ctx);
    const end = this.seconds;
    this.keys = GLIDE.map(([s, x, z, yaw, pitch, fov]) => ({ t: s / end, at: [x, groundY(x, z) + EYE, z] as const, yaw, pitch, fov }));
    this.u.uOrigin.value.copy(this.origin);
    const random = randomFrom(3317);
    this.u.uNoise.value = noiseTexture(random);
    this.sky = this.buildSky();

    // the tree, and the poles and wires behind it
    const { limbs, low } = growTree(randomFrom(4127));
    const thick = limbs.filter((l) => l.radii[0] >= LINE_BELOW);
    const thin = limbs.filter((l) => l.radii[0] < LINE_BELOW);
    const wires = this.wires();
    this.buildWood(thick, this.poles());
    this.buildLines([...thin, ...wires.map((w) => w.line)]);

    // the ravens: the one over the chair holds the fork
    const ravens = this.buildRavens(thick, low, wires);
    // held crosswise in the beak
    this.forkYaw = RAVEN_HEADING * DEG;
    this.forkHeld.copy(ravens.beak).addScaledVector(ravens.facing, -0.015).add(new Vector3(0, -0.012, 0));

    // the chair stands with its seat under the beak; the fork comes down onto it
    const seat = this.buildChair(this.forkHeld);
    this.forkRest.set(this.forkHeld.x + 0.02, seat + FORK_HALF_LENGTH * Math.cos(FORK_LEAN) - FORK_SINK, this.forkHeld.z - 0.015);
    this.fallTime = Math.sqrt((2 * (this.forkHeld.y - this.forkRest.y)) / GRAVITY);
    this.release = LANDS_AT - this.fallTime;
    this.fork = this.kit.prop('fork', [0, 0, 0], { rotation: [90, 0, 0], anchor: 'center', scale: FORK_SCALE }, this.root);
    this.kit.paint(this.fork, new MeshStandardMaterial({ color: FORK_COLOR, metalness: 0.85, roughness: 0.38 }));
    this.fork.rotation.order = 'YXZ';
    this.placeFork(0);

    // the flock's shadows; at the shutter a wing of the first of them lies across the chair, another on the ground before the tree
    const front = FLOCK_FROM - FLOCK_SPEED * (SHUTTER_AT - WINGS_AT);
    const mark = (x: number, y: number, z: number) => [x, (z - y * FLOCK_STRETCH - front) / FLOCK_L] as const;
    this.u.uFlock.value = flockTexture(random, [mark(this.chairAt.x + 0.4, seat + 0.2, this.chairAt.z), mark(TREE_X - 1.1, 0.05, TREE_Z + 2.6)]);

    // the field, worn along the way to the chair, and its hedges
    this.buildGround();
    this.buildHedges(random);
    this.buildTufts(random);

    // the last light, low beyond the tree; and a pale catch on the chair, from nowhere
    const keyAt: readonly [number, number, number] = [TREE_X + GLOW_XZ[0] * KEY_BACK, KEY_HEIGHT, TREE_Z + GLOW_XZ[1] * KEY_BACK];
    const kickTo: readonly [number, number, number] = [(this.chairAt.x + TREE_X) / 2, seat, (this.chairAt.z + TREE_Z) / 2];
    this.spots = [
      this.spot(keyAt, [TREE_X + KEY_AIM[0], KEY_AIM[1], TREE_Z + KEY_AIM[2]], KEY_COLOR, KEY_POWER, KEY_ANGLE, 0.75),
      this.spot([kickTo[0] + KICK_FROM[0], kickTo[1] + KICK_FROM[1], kickTo[2] + KICK_FROM[2]], kickTo, KICK_COLOR, KICK_POWER, KICK_ANGLE, 0.9),
      null,
    ];

    this.placeSound();
  }

  dispose(): void {
    super.dispose();
    this.u.uNoise.value?.dispose();
    this.u.uFlock.value?.dispose();
  }

  /** Shadows, mist, sky and all the shaders that share the room's clock and the flock. */
  private shared(): Record<string, { value: unknown }> {
    return { ...this.u };
  }

  /** A standard material that the flock's shadows also fall on (and, with `flex`, that the wind moves). */
  private shaded<T extends MeshStandardMaterial | MeshBasicMaterial>(material: T, key: string, flex = false): T {
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, this.shared());
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform vec3 uOrigin;\nvarying vec3 vRoom;\n${flex ? `attribute float aFlex;\n${SWAY_GLSL}` : ''}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${flex ? 'transformed += sway(transformed, aFlex);' : ''}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${ROOM_AT}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${SURFACE_GLSL}`)
        .replace('#include <opaque_fragment>', `${SURFACE_END}\n#include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => `birds-${key}`;
    return material;
  }

  private buildSky(): Mesh {
    const sky = new Mesh(
      new SphereGeometry(SKY_RADIUS, 48, 24),
      // it writes depth, so that the walk's black dome behind it cannot draw over it
      new ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.shared(), side: BackSide }),
    );
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.root.add(sky);
    return sky;
  }

  private buildGround(): void {
    const material = this.kit.surface('grass_meadow', 2.2, { color: new Color(GROUND_COLOR), roughness: 0.96 });
    const near = this.chairAt.z + 0.6;
    const tint = /* glsl */ `
      vec3 groundTint(vec3 p) {
        float soil = 1.0 - smoothstep(1.3, 3.4, length(p.xz - vec2(${TREE_X.toFixed(3)}, ${TREE_Z.toFixed(3)})));
        float way = mix(${this.chairAt.x.toFixed(3)}, ${PATH_TO_X.toFixed(3)}, clamp((p.z - (${near.toFixed(3)})) / ${(PATH_FROM_Z - near).toFixed(3)}, 0.0, 1.0));
        float across = (p.x - way) / ${PATH_W.toFixed(3)};
        float worn = exp(-across * across) * smoothstep(${(near - 1.2).toFixed(3)}, ${(near + 0.8).toFixed(3)}, p.z);
        return mix(mix(vec3(1.0), vec3(0.7, 0.62, 0.54), worn * 0.8), vec3(0.42, 0.37, 0.33), soil);
      }`;
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, this.shared());
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uOrigin;\nvarying vec3 vRoom;')
        .replace('#include <project_vertex>', `#include <project_vertex>\n${ROOM_AT}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${SURFACE_GLSL}\n${tint}`)
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= groundTint(vRoom);')
        .replace('#include <opaque_fragment>', `${SURFACE_END}\n#include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => 'birds-ground';
    const ground = new Mesh(groundGeometry(), material);
    ground.receiveShadow = true;
    ground.frustumCulled = false;
    this.root.add(ground);
  }

  /** The worn way: from behind the eye to the chair (x at z). */
  private pathX(z: number): number {
    return lerp(this.chairAt.x, PATH_TO_X, range(this.chairAt.z + 0.6, PATH_FROM_Z, z));
  }

  /** Hedges and far trees all round, low toward the afterglow, so that the field is closed. */
  private buildHedges(random: () => number): void {
    const positions = new Float32Array((HEDGE_COLUMNS + 1) * 2 * 3);
    const index: number[] = [];
    const glow = Math.atan2(GLOW_XZ[1], GLOW_XZ[0]);
    let wander = 0.5;
    let crown = 0;
    let first = 0;
    for (let i = 0; i <= HEDGE_COLUMNS; i++) {
      const a = ((i % HEDGE_COLUMNS) / HEDGE_COLUMNS) * TAU;
      const x = TREE_X + Math.cos(a) * HEDGE_RING;
      const z = TREE_Z + Math.sin(a) * HEDGE_RING;
      wander = Math.min(1, Math.max(0, wander + (random() - 0.5) * 0.18));
      // now and then a tree stands up out of the hedge: a round crown a few columns wide, not a spike
      crown = random() < 0.02 ? 1 : Math.max(0, crown - 0.22);
      const off = Math.abs(Math.atan2(Math.sin(a - glow), Math.cos(a - glow)));
      const tall = lerp(1.6, 7.5, ease(0.25, 0.9, off)) * (0.45 + 0.75 * wander * wander) + 2.4 * Math.sqrt(Math.max(0, 1 - (1 - crown) ** 2));
      if (i === 0) first = tall;
      positions.set([x, -2, z, x, i === HEDGE_COLUMNS ? first : tall, z], i * 6);
      if (i < HEDGE_COLUMNS) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setIndex(index);
    const hedges = new Mesh(g, new ShaderMaterial({ vertexShader: RAY_VERT, fragmentShader: HEDGE_FRAG, uniforms: this.shared(), side: DoubleSide }));
    hedges.frustumCulled = false;
    hedges.renderOrder = -9;
    this.root.add(hedges);
  }

  /** The poles of the line: wood, a crossarm, two knobs for the wires (one geometry, with the tree's bark). */
  private poles(): BufferGeometry[] {
    const parts: BufferGeometry[] = [];
    const across = Math.atan2(POLE_LINE[0], POLE_LINE[1]);
    for (let k = FIRST_POLE; k <= LAST_POLE; k++) {
      const x = POLE_AT[0] + POLE_LINE[0] * POLE_SPAN * k;
      const z = POLE_AT[1] + POLE_LINE[1] * POLE_SPAN * k;
      const y = groundY(x, z) - 0.6;
      const pole = new CylinderGeometry(POLE_R[0], POLE_R[1], POLE_H + 0.6, 10, 4);
      const uv = pole.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * TAU * POLE_R[1], uv.getY(i) * (POLE_H + 0.6));
      pole.translate(x, y + (POLE_H + 0.6) / 2, z);
      const arm = new BoxGeometry(ARM, 0.11, 0.11).rotateY(across).translate(x, WIRE_Y - 0.12 + groundY(x, z), z);
      const knob = (side: number) => new CylinderGeometry(0.035, 0.045, 0.12, 6).translate(x + Math.cos(across) * WIRE_OFF * side, WIRE_Y - 0.04 + groundY(x, z), z - Math.sin(across) * WIRE_OFF * side);
      for (const part of [pole, arm, knob(-1), knob(1)]) {
        part.setAttribute('aFlex', new Float32BufferAttribute(new Float32Array(part.getAttribute('position').count), 1));
        parts.push(part);
      }
    }
    return parts;
  }

  /** The wires between the poles: a sagging line each, and the spans heavy with birds sag the most. */
  private wires(): { line: Limb; from: Vector3; to: Vector3; sag: number; loaded: boolean }[] {
    const out: { line: Limb; from: Vector3; to: Vector3; sag: number; loaded: boolean }[] = [];
    const across = Math.atan2(POLE_LINE[0], POLE_LINE[1]);
    const hang = (k: number, side: number) => {
      const x = POLE_AT[0] + POLE_LINE[0] * POLE_SPAN * k + Math.cos(across) * WIRE_OFF * side;
      const z = POLE_AT[1] + POLE_LINE[1] * POLE_SPAN * k - Math.sin(across) * WIRE_OFF * side;
      return new Vector3(x, WIRE_Y + groundY(x, z), z);
    };
    for (let k = FIRST_POLE; k < LAST_POLE; k++) {
      for (const side of [-1, 1]) {
        const from = hang(k, side);
        const to = hang(k + 1, side);
        const loaded = side === 1 && (LOADED_SPANS as readonly number[]).includes(k);
        const sag = loaded ? SAG_LOADED : SAG_EMPTY * (side === 1 ? 1 : 0.9);
        const line: Limb = { points: [], radii: [], flex: [] };
        for (let i = 0; i <= 40; i++) {
          const t = i / 40;
          line.points.push(new Vector3().lerpVectors(from, to, t).add(new Vector3(0, -4 * sag * t * (1 - t), 0)));
          line.radii.push(WIRE_R);
          line.flex.push(0);
        }
        out.push({ line, from, to, sag, loaded });
      }
    }
    return out;
  }

  /** The tree's bark and the poles: one mesh, casting the room's shadow. */
  private buildWood(limbs: readonly Limb[], poles: readonly BufferGeometry[]): void {
    const tree = barkGeometry(limbs);
    const material = this.shaded(this.kit.surface('conc_board', BARK_TILE, { color: new Color(BARK_COLOR), roughness: 0.93 }), 'bark', true);
    const wood = new Mesh(mergeGeometries([tree, ...poles])!, material);
    wood.castShadow = true;
    wood.receiveShadow = true;
    wood.frustumCulled = false;
    this.root.add(wood);
    // where the foot of the trunk and the poles meet the ground
    this.build.contactShadow(TREE_X, TREE_Z, 1.5, this.root, 0.55, groundY(TREE_X, TREE_Z) + 0.02);
    for (let k = FIRST_POLE; k <= 2; k++) {
      const x = POLE_AT[0] + POLE_LINE[0] * POLE_SPAN * k;
      const z = POLE_AT[1] + POLE_LINE[1] * POLE_SPAN * k;
      this.build.contactShadow(x, z, 0.5, this.root, 0.5, groundY(x, z) + 0.02);
    }
  }

  private buildLines(lines: readonly Limb[]): void {
    const material = new ShaderMaterial({
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      uniforms: { ...UniformsUtils.clone(UniformsLib.fog), ...this.shared() },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: true,
    });
    const mesh = new Mesh(lineGeometry(lines), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 7;
    this.root.add(mesh);
  }

  /**
   * Every raven in one crowd, the first the one with the fork. They sit on the tops of the branches that carry
   * them and on the loaded wire, all facing one way. Returns where the first one's beak is, and the way they face.
   */
  private buildRavens(limbs: readonly Limb[], low: Limb, wires: readonly { from: Vector3; to: Vector3; sag: number; loaded: boolean }[]): { beak: Vector3; facing: Vector3 } {
    const random = randomFrom(977);
    const heading = RAVEN_HEADING * DEG;
    const facing = new Vector3(Math.cos(heading), 0, -Math.sin(heading));

    // the scan as one body (it is painted one black anyway): one draw for all of them; and measured, its beak
    // tip, and how high its feet are over its lowest point
    const probe = this.kit.prop('raven', [0, 0, 0], { scale: RAVEN_SCALE });
    probe.updateMatrixWorld(true);
    const beakLocal = new Vector3(-Infinity, 0, 0);
    let feet = Infinity;
    const v = new Vector3();
    const toNormal = new Matrix3();
    const pieces: BufferGeometry[] = [];
    probe.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const source = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      const p = source.getAttribute('position');
      const n = source.getAttribute('normal');
      toNormal.getNormalMatrix(m.matrixWorld);
      const position = new Float32Array(p.count * 3);
      const normal = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).toArray(position, i * 3);
        if (v.x > beakLocal.x) beakLocal.copy(v);
        if (Math.abs(v.x) < RAVEN_SCALE * 0.18) feet = Math.min(feet, v.y);
        if (n) v.fromBufferAttribute(n, i).applyMatrix3(toNormal).normalize().toArray(normal, i * 3);
      }
      const piece = new BufferGeometry();
      piece.setAttribute('position', new BufferAttribute(position, 3));
      piece.setAttribute('normal', new BufferAttribute(normal, 3));
      if (!n) piece.computeVertexNormals();
      pieces.push(piece);
    });
    const feetDrop = Number.isFinite(feet) ? feet : 0;

    // the one with the fork: on the top of the low limb, over where the chair will be
    let best = 1;
    for (let i = 1; i < low.points.length; i++) {
      const p = low.points[i];
      if (Math.abs(Math.hypot(p.x - TREE_X, p.z - TREE_Z) - FORK_REACH) < Math.abs(Math.hypot(low.points[best].x - TREE_X, low.points[best].z - TREE_Z) - FORK_REACH)) best = i;
    }
    const perches: { at: Vector3; size: number; turn: number }[] = [{ at: low.points[best].clone().add(new Vector3(0, low.radii[best], 0)), size: 1.04, turn: 0 }];

    // the tree: wherever a branch is stiff, high and level enough
    const candidates: Vector3[] = [];
    for (const limb of limbs) {
      for (let i = 0; i < limb.points.length - 1; i++) {
        if (limb.flex[i + 1] > 0 || limb.radii[i + 1] < STIFF) continue;
        const a = limb.points[i];
        const b = limb.points[i + 1];
        const run = Math.hypot(b.x - a.x, b.z - a.z);
        if (Math.abs(b.y - a.y) > run * PERCH_SLOPE) continue;
        const count = Math.max(1, Math.floor(a.distanceTo(b) / 0.16));
        for (let k = 0; k < count; k++) {
          const t = (k + random()) / count;
          const p = new Vector3().lerpVectors(a, b, t);
          if (p.y < PERCH_LOW + groundY(p.x, p.z) || Math.hypot(p.x - TREE_X, p.z - TREE_Z) < 0.45) continue;
          p.y += lerp(limb.radii[i], limb.radii[i + 1], t) * 0.92;
          candidates.push(p);
        }
      }
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const forkAt = perches[0].at;
    for (const p of candidates) {
      if (perches.length > TREE_RAVENS) break;
      if (p.distanceTo(forkAt) < FORK_CLEAR) continue;
      if (perches.some((q) => q.at.distanceTo(p) < RAVEN_GAP)) continue;
      perches.push({ at: p, size: lerp(RAVEN_SIZE[0], RAVEN_SIZE[1], random()), turn: (random() - 0.5) * 2 * RAVEN_JITTER * DEG });
    }

    // the wire: shoulder to shoulder, with a few gaps
    for (const w of wires) {
      if (!w.loaded) continue;
      const length = w.from.distanceTo(w.to);
      for (let d = 0.6 + random() * 0.3; d < length - 0.6; d += lerp(WIRE_GAP[0], WIRE_GAP[1], random())) {
        if (random() < 0.06) d += 0.8 + random() * 1.4;
        const t = d / length;
        const at = new Vector3().lerpVectors(w.from, w.to, t);
        at.y += -4 * w.sag * t * (1 - t) + WIRE_R;
        perches.push({ at, size: lerp(RAVEN_SIZE[0], RAVEN_SIZE[1], random()), turn: (random() - 0.5) * 2 * RAVEN_JITTER * DEG });
      }
    }

    const crowd = new InstancedMesh(mergeGeometries(pieces)!, new MeshStandardMaterial({ color: 0x060607, roughness: 0.42, metalness: 0.12 }), perches.length);
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const at = new Vector3();
    perches.forEach((p, i) => {
      q.setFromAxisAngle(UP, heading + p.turn);
      at.copy(p.at).y -= feetDrop * p.size;
      m.compose(at, q, s.setScalar(p.size));
      crowd.setMatrixAt(i, m);
    });
    crowd.castShadow = true;
    crowd.receiveShadow = true;
    crowd.frustumCulled = false;
    this.root.add(crowd);

    const first = perches[0];
    q.setFromAxisAngle(UP, heading);
    const beak = beakLocal.clone().multiplyScalar(first.size).applyQuaternion(q).add(first.at);
    beak.y -= feetDrop * first.size;
    return { beak, facing };
  }

  /** The kitchen chair, its seat under `over`: returns the height of the seat there (m). */
  private buildChair(over: Vector3): number {
    const probe = this.kit.prop('chair_white', [0, 0, 0], { rotation: [0, CHAIR_TURN, 0] });
    probe.updateMatrixWorld(true);
    const ray = new Raycaster();
    const down = new Vector3(0, -1, 0);
    const from = new Vector3();
    let sx = 0;
    let sz = 0;
    let hits = 0;
    for (let i = -7; i <= 7; i++) {
      for (let j = -7; j <= 7; j++) {
        ray.set(from.set(i * 0.035, 2, j * 0.04), down);
        const hit = ray.intersectObject(probe, true)[0];
        if (!hit || hit.point.y < 0.3 || hit.point.y > 0.62) continue;
        sx += from.x;
        sz += from.z;
        hits++;
      }
    }
    const cx = hits ? sx / hits : 0;
    const cz = hits ? sz / hits : 0;
    ray.set(from.set(cx, 2, cz), down);
    const seat = ray.intersectObject(probe, true)[0]?.point.y ?? 0.46;
    this.chairAt.set(over.x - cx, groundY(over.x - cx, over.z - cz), over.z - cz);
    const chair = this.kit.prop('chair_white', [this.chairAt.x, this.chairAt.y - 0.01, this.chairAt.z], { rotation: [0, CHAIR_TURN, 0], castShadow: true }, this.root);
    chair.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) mesh.material = this.shaded((mesh.material as MeshStandardMaterial).clone(), 'chair');
    });
    this.build.contactShadow(this.chairAt.x, this.chairAt.z, 0.42, this.root, 0.6, this.chairAt.y + 0.02);
    return this.chairAt.y - 0.01 + seat;
  }

  /** Dry grass all over the field, thick near the way you come and thinning away; none on the worn way or under the tree. */
  private buildTufts(random: () => number): void {
    const material = this.shaded(new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }), 'tuft');
    const original = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      original(shader, renderer);
      shader.vertexShader = shader.vertexShader
        .replace('uniform vec3 uOrigin;', `uniform vec3 uOrigin;\n${SWAY_GLSL}`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float bend = position.y * position.y;
          vec3 rooted = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          transformed.x += bend * (0.035 * sin(uTime * 0.9 + rooted.x * 0.7 + rooted.z * 0.3) + 0.4 * uWind * sin(uTime * 3.4 + rooted.x * 1.3 + rooted.z * 0.5));
          transformed.z += bend * (0.025 * cos(uTime * 0.7 + rooted.z * 0.6) + 0.28 * uWind * cos(uTime * 2.7 + rooted.x * 0.9));`,
        );
    };
    const tufts = new InstancedMesh(tuftGeometry(random), material, TUFTS);
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const p = new Vector3();
    let n = 0;
    for (let tries = 0; n < TUFTS && tries < TUFTS * 20; tries++) {
      const x = lerp(-24, 26, random());
      const z = lerp(-38, 9, random());
      const fromWay = Math.abs(x - this.pathX(z));
      if (random() > 0.18 + Math.exp(-fromWay / TUFT_THIN)) continue;
      if (fromWay < PATH_W * 1.2 && z > this.chairAt.z - 0.6 && z < PATH_FROM_Z) continue;
      if (Math.hypot(x - TREE_X, z - TREE_Z) < 2.8 || Math.hypot(x - this.chairAt.x, z - this.chairAt.z) < 0.7) continue;
      const h = lerp(TUFT_HEIGHT[0], TUFT_HEIGHT[1], random() ** 1.5);
      q.setFromAxisAngle(UP, random() * TAU);
      m.compose(p.set(x, groundY(x, z) - 0.02, z), q, s.set(0.6 + random() * 0.6, h, 0.6 + random() * 0.6));
      tufts.setMatrixAt(n++, m);
    }
    tufts.count = n;
    tufts.frustumCulled = false;
    this.root.add(tufts);
  }

  private placeSound(): void {
    const s = this.sound;
    const forkPan = Math.max(-1, Math.min(1, (this.chairAt.x - 0.2) / 8));
    const treePan = Math.max(-1, Math.min(1, (TREE_X - 0.2) / 8));
    this.beat(0, () => {
      this.wind = s.bed('rooms/night_wind_far.mp3', { gain: GAIN_WIND, lowpass: 1200, fade: 1.2 });
      this.grass = s.bed('rooms/wind_grass.mp3', { gain: GAIN_GRASS, fade: 2 });
      this.drone = s.bed('rooms/dream_drone_low.mp3', { gain: GAIN_DRONE, fade: 3 });
    });
    // the field holds its breath while the fork falls
    this.beat(this.release - 0.35, () => {
      this.wind?.gain(GAIN_WIND * 0.4, 0.6);
      this.grass?.gain(GAIN_GRASS * 0.25, 0.6);
    });
    this.beat(LANDS_AT, () => s.play('rooms/fork_plate_1.mp3', { gain: 0.4, reverb: 0.45, pan: forkPan }));
    this.beat(LANDS_AT + RING_AGAIN, () => s.play('rooms/fork_plate_4.mp3', { gain: 0.06, reverb: 0.3, pan: forkPan, rate: 1.08 }));
    this.beat(8, () => {
      this.wind?.gain(GAIN_WIND, 1.5);
      this.grass?.gain(GAIN_GRASS, 1.5);
    });
    // the wind in the branches, and the limbs creak under their load
    this.beat(WIND_AT, () => {
      this.wind?.gain(0.24, 0.45);
      this.grass?.gain(0.26, 0.45);
      this.gust = s.bed('rooms/wind_high_gusts.mp3', { gain: 0.1, lowpass: 2600, fade: 0.45 });
    });
    this.beat(WIND_AT + 0.15, () => s.play('rooms/wood_creak_small_3.mp3', { gain: 0.17, rate: 0.62, reverb: 0.35, pan: treePan }));
    this.beat(WIND_AT + 0.4, () => s.play('rooms/wood_creak_small_5.mp3', { gain: 0.15, rate: 0.55, reverb: 0.35, pan: treePan - 0.2 }));
    // a real silence, and then the wings: from behind, muffled; over you; on ahead
    this.beat(HUSH_AT, () => {
      for (const bed of [this.wind, this.grass, this.drone, this.gust]) bed?.gain(0, 0.25);
    });
    this.beat(WINGS_AT, () => {
      this.wingsFar = s.play('rooms/pigeons_below.mp3', { gain: 0.45, lowpass: 1300, rate: 0.8, reverb: 0.2 });
    });
    this.beat(WINGS_AT + 0.25, () => {
      this.wingsNear = s.play('rooms/pigeons_below.mp3', { gain: 0.5, rate: 0.88, reverb: 0.35, pan: 0.2 });
      this.wingsNear.pan(-0.15, 1.6);
      this.wingsRush = s.play('rooms/sheets_lift.mp3', { gain: 0.32, rate: 0.82, reverb: 0.3 });
    });
    this.beat(WINGS_AT + 0.7, () => this.wingsFar?.gain(0, 0.6));
    this.beat(SHUTTER_AT, () => this.shutter(false));
    this.beat(12.4, () => {
      this.wingsNear?.gain(0.22, 1.2);
      this.wingsRush?.gain(0.12, 1);
    });
    this.beat(CUT_AT, () => s.stopAll(0.04));
  }

  /**
   * The fork: held crosswise in the beak; let go, it turns tines down as it falls (the heavy end first), goes
   * into the wood of the seat and stands there, quivering once.
   */
  private placeFork(s: number): void {
    const f = this.fork;
    if (s < this.release) {
      f.position.copy(this.forkHeld);
      f.rotation.set(0, this.forkYaw, 0);
      return;
    }
    if (s < LANDS_AT) {
      const t = s - this.release;
      const k = t / this.fallTime;
      f.position.set(lerp(this.forkHeld.x, this.forkRest.x, k), this.forkHeld.y - 0.5 * GRAVITY * t * t, lerp(this.forkHeld.z, this.forkRest.z, k));
      f.rotation.set(lerp(0, Math.PI / 2 - FORK_LEAN, ease(0, 0.75, k)), this.forkYaw + FALL_YAW * k, FALL_ROLL * k);
      return;
    }
    const after = s - LANDS_AT;
    const quiver = (REDUCED_MOTION ? 0.4 : 1) * QUIVER * Math.exp(-after / QUIVER_FADE) * Math.sin(TAU * QUIVER_RATE * after);
    f.position.copy(this.forkRest);
    f.rotation.set(Math.PI / 2 - FORK_LEAN + quiver, this.forkYaw + FALL_YAW, FALL_ROLL);
  }

  prepare(camera: PerspectiveCamera): void {
    this.sky.position.copy(camera.position).sub(this.origin);
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const u = this.u;
    u.uTime.value = s;
    // the wind comes once, and is cut off for the wings
    const gust = ease(WIND_AT - 0.2, WIND_AT + 0.35, s) * (1 - ease(HUSH_AT - 0.1, HUSH_AT + 0.3, s));
    u.uWind.value = gust * (REDUCED_MOTION ? 0.5 : 1);
    u.uDrift.value = s + MIST_GUST * Math.min(Math.max(s - WIND_AT, 0), HUSH_AT + 0.3 - WIND_AT);
    this.placeFork(s);
    // the shadows of the flock: in from behind you, over the field, up the tree
    u.uFlockFront.value = FLOCK_FROM - FLOCK_SPEED * (s - WINGS_AT);
    u.uFlockDark.value = s >= WINGS_AT ? FLOCK_DARK : 0;

    this.eye.copy(frame.view.position).sub(this.origin);
    this.focus = Math.max(4, this.eye.distanceTo(this.chairAt));
    this.fear = 0.28 + 0.2 * ease(this.release, LANDS_AT + 0.6, s) + 0.4 * ease(WINGS_AT, WINGS_AT + 0.8, s);
    this.black = s >= CUT_AT ? 1 : 0;
  }
}
