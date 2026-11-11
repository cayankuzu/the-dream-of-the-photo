import {
  Box3,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  RepeatWrapping,
  Vector2,
  Vector3,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { REDUCED_MOTION } from '../../config/experience.config';
import { fearConfig, LAYOUT, type SpotSpec } from '../../config/nightmare.config';
import { clamp, damp, DEG, lerp, range, smootherstep } from '../math';
import type { DreamKit, PropCrowd } from './DreamKit';
import type { DreamFrame, DreamModule } from './DreamModule';
import { randomFrom, type Crowd, type FigureSpec } from './FigureKit';
import type { DreamLight } from './LightPool';

type V3 = readonly [number, number, number];
type Pair = readonly [number, number];

const TAU = Math.PI * 2;
const AXIS_Y = LAYOUT.flesh.centerY;
const TUBE_R = LAYOUT.flesh.radius;
/** Where the teeth meet when the mouth is shut (m above the floor line). */
const BITE_Y = 1.62;
/** The share of all motion left for visitors who ask for less. */
const MOTION = REDUCED_MOTION ? 0.25 : 1;
/** Height of the path along the chapter, for what must keep clear of it (m). */
const PATH_Y = 1.65;

/** The wall of the gullet (m, deg). */
const WALL = {
  /** Vertices around the tube, and rings along it (m apart). */
  columns: 140,
  rowStep: 0.13,
  /** Around these arcs (deg, 0 = +x, 90 = up) the mesh is `density` times finer: the hands and faces travel there. */
  tracks: [[-30, 55], [125, 210]] as readonly Pair[],
  density: 2.2,
  /** Texture coordinates wrap after this many meters around: a whole number of every tile below. */
  wrap: 20,
  /** Height of the slow lumps, of the middle lumps and of the bundles of muscle (m). */
  lumps: 0.36,
  knots: 0.11,
  bundles: 0.05,
  /** Ring folds: where the first and the last stand, the gap between two, how far they reach in, how long they are along z. */
  folds: { first: -153.4, last: -176.4, gap: [2.3, 4] as Pair, depth: [0.36, 0.78] as Pair, length: [0.32, 0.52] as Pair },
  /** The narrow place before the mouth: z, how much narrower, length along z. */
  neck: { z: -177.2, narrow: 0.28, length: 1.1 },
} as const;

/** Texture tiles on the wall: each repeats a whole number of times in WALL.wrap (m). */
const TILE = { fibre: WALL.wrap / 7, smear: WALL.wrap / 11, pit: WALL.wrap / 16, veins: WALL.wrap / 2 } as const;

/** The wall of meat that closes the darkroom corridor: rings of radius and z, from far outside to inside the tube. */
const COLLAR = {
  profile: [
    [7, -150.9],
    [6, -150.6],
    [5, -150.25],
    [4.2, -149.85],
    [3.6, -149.6],
    [3.15, -149.55],
    [2.8, -149.65],
    [2.5, -149.85],
    [2.28, -150.1],
    [2.2, -150.35],
    [2.28, -150.62],
    [2.5, -150.9],
    [2.75, -151.2],
    [2.95, -151.5],
  ] as readonly Pair[],
  /** Where the tube itself starts (z). */
  tubeFrom: -151.8,
  /** Pleats of the ring: how many around, how deep at the rim (m). */
  pleats: 11,
  pleatDepth: 0.15,
  /** Seen from far down the corridor the ring is pursed to this share of its radius; it opens as the eye comes (eye z). */
  pursed: 0.42,
  opens: [-144.5, -148.6] as Pair,
} as const;

/** The heart and the room around it. */
const HEART = {
  /** Height of the whole scan (m), the z it hangs at, the height of its lowest point, its turn (deg). */
  scale: 4.5,
  z: -172,
  lowest: 3.05,
  heading: -8,
  /** Radius of the tunnel around it, how far along z that reaches (m). */
  widenTo: 4.2,
  widenLength: 4.2,
  /** How high the roof is pushed up over it (m at the very top) and over what length, so the great vessels show. */
  vault: 2.5,
  vaultLength: 3.3,
  /** Contraction on the beat: share of its width, how much the apex rises (object units), twist (rad), the whole of it jolts (m). */
  squeeze: 0.075,
  lift: 0.06,
  twist: 0.14,
  jolt: 0.05,
  /** How fast it follows the beat (1/s). */
  attack: 55,
  /** Detail of its wet surface: tile (object units), strength. */
  detailScale: 1.25,
  detail: 2,
} as const;

/** The pulse that runs from the heart along the wall, and the slow breath. */
const PULSE = {
  /** Distance between one pulse and the next along the wall (m). */
  wavelength: 7.5,
  /** Radial swelling of one pulse and of the breath (m), and the rate of the breath (rad/s). */
  swell: 0.085,
  breath: 0.075,
  breathRate: 0.62,
  /** The second beat of the heart ("dub", see DreamDirector). */
  second: { at: 0.28, strength: 0.65 },
} as const;

/** The mouth. */
const MOUTH = {
  /** kit.prop scale of the arches, and their turn: the scans are turned a little off their own axis (deg). */
  scale: 2.4,
  heading: 81,
  /** z of the front of the upper and of the lower teeth: the upper close over the lower. */
  frontUpper: -187.42,
  frontLower: -187.16,
  /** How far each jaw travels from the bite (m): tips stay this far from the path when parted. */
  opening: 1.63,
  /** The teeth overlap this much when shut (m). */
  overlap: 0.07,
  /** Eye z over which the jaws part. */
  parts: [-174.8, -179.6] as Pair,
  /** Past this eye z they slam (s to shut, s to open again when the eye comes back). */
  slamAt: -188,
  slamSeconds: 0.12,
  reopenSeconds: 0.45,
  /** Rebound of the slam: share of the opening, decay (1/s), rate (rad/s). */
  rebound: [0.035, 11, 34] as V3,
  /** The cavity: half width at its back and at its widest, and from where to where along z that grows. */
  cheek: [3.5, 4.55, -178.2, -182.6] as readonly [number, number, number, number],
  /** Where the throat becomes the mouth (z), how high the palate rises and how deep the floor falls from the gums (m). */
  flare: [-177.4, -180.4] as Pair,
  palate: 1.55,
  floor: 1.9,
  /** How far the gum comes back toward the bite beyond the teeth, on its way to the cheek: seen from the axis nothing may hide behind its crest, or the sheet would jump there. And how high the pocket behind the front teeth is (m). */
  sulcus: 0.4,
  pocket: 2,
  /** Height of the crowns above the gum: at the back teeth, at the front (m). */
  crown: [0.62, 0.82] as Pair,
  crownLower: [0.5, 0.64] as Pair,
  /** Rings of the lips and of the wall around them: half width, half height, z. */
  lips: [
    [4.35, 2.6, -187.62],
    [3.95, 1.9, -187.78],
    [3.62, 1.5, -187.93],
    [3.5, 1.4, -188.1],
    [3.55, 1.45, -188.27],
    [3.75, 1.65, -188.42],
    [4.15, 2.05, -188.52],
    [4.7, 2.7, -188.56],
    [5.5, 3.6, -188.5],
    [6.4, 4.8, -188.55],
    [7.3, 6.1, -188.7],
    [8.1, 7.4, -188.85],
    [8.8, 8.6, -188.7],
    [9.3, 9.3, -188.1],
    [9.5, 9.5, -187],
  ] as readonly V3[],
  /** The tongue: root z, tip z, half width, height of its back over the bite line when the mouth is shut (m). */
  tongue: { root: -177.4, tip: -185.7, width: 2.4, top: -0.74 },
  /** The soft palate: an arch the wall makes across the neck, from which the uvula hangs: z, height of its crest, its length along z (m), how wide around the tube (deg). */
  softPalate: { z: -176.9, crest: 3.85, length: 0.42, wide: 56 },
  /** The uvula: z, top, lowest point, radius (m). */
  uvula: { z: -177, top: 4.4, tip: 2.88, radius: 0.3 },
} as const;

/** The ribs: one arch every `gap` m, half widths (m), half buried. */
const RIBS = {
  first: -152.7,
  last: -176.2,
  gap: 1.7,
  width: 0.14,
  thickness: 0.1,
  /** From where to where around the tube (deg), and the step along them (m). */
  arc: [-40, 220] as Pair,
  step: 0.2,
  /** How far the wall swells over a rib (m) and how long that welt is along z. */
  welt: 0.08,
  weltLength: 0.34,
  /** Thicker this much around the heart. */
  aroundHeart: 1.25,
} as const;

/** The eyes in the walls. */
const EYES = {
  count: 36,
  /** Radius of the small ones (m); the named ones below are larger. */
  small: [0.08, 0.17] as Pair,
  /** The ones that matter: z, angle around the tube (deg), radius (m), roll (deg), how wide open. */
  named: [
    [-160.3, 151, 0.35, -5, 1.25],
    [-168.2, 27, 0.3, 8, 1.15],
    [-155.5, 36, 0.24, 96, 1.2],
    [-164.4, 128, 0.2, -14, 0.8],
    [-176.1, 163, 0.26, 4, 1.3],
    [-158.1, 4, 0.2, 12, 1],
    [-173.6, 192, 0.22, 90, 1.1],
    [-152.9, 160, 0.16, -8, 1.3],
    [-170.5, 58, 0.2, -6, 1.2],
    [-162.4, 72, 0.18, 170, 1],
  ] as readonly (readonly [number, number, number, number, number])[],
  /** Share of the radius the wall swells around an eye, and how far (radii). */
  mound: 0.4,
  moundReach: 2.8,
  /** How far an eye can turn away from straight out of the wall (deg). */
  turn: 62,
  /** Follows in small jumps when off by this much (cos), or after these seconds; rate of a jump (1/s). */
  offBy: 0.994,
  jumpAfter: [0.5, 2.1] as Pair,
  jumpRate: 26,
  /** Seconds between blinks, seconds of a blink for a small and for a large eye. */
  blinkEvery: [2.4, 12] as Pair,
  blinkLength: [0.2, 0.42] as Pair,
  /** Every eye closes at once, once, as the viewer passes here (eye z). */
  allAtOnce: -166.8,
  /** How the pupil answers the viewer's lamp (light of its tapetum), from what distance on (m): near ones have black pupils, far ones glint. */
  shine: 2.1,
  shineFrom: [3.5, 11] as Pair,
  /** What draws the gaze: angular radius (deg), how far a long look narrows the view, and from how far (m). */
  poi: { radius: 9, zoom: 0.6, reach: 16 },
} as const;

interface PressVisit {
  /** Slots 0 and 1 are hands (1 mirrored), 2 and 3 faces. */
  slot: number;
  /** It comes while the eye goes from here to there... */
  eye: Pair;
  /** ...and slides along z, around the wall (deg), and turns (deg). */
  z: Pair;
  at: Pair;
  turn: Pair;
}

/** What presses from behind the membrane. All in eye z, so that going back undoes it. */
const PRESS = {
  /** How far a whole hand and a whole face push in (m). */
  handDepth: 0.34,
  faceDepth: 0.62,
  /** Beyond this they cannot reach (m on the wall). */
  reach: 2.1,
  /** Radius (m) of the wall coordinates (arc length = angle × this). */
  wallRadius: TUBE_R,
  visits: [
    { slot: 0, eye: [-149.5, -162], z: [-155.5, -162.5], at: [14, 22], turn: [-96, -82] },
    { slot: 1, eye: [-154, -165.5], z: [-159, -166.5], at: [168, 160], turn: [100, 84] },
    { slot: 2, eye: [-156.5, -169], z: [-163, -168.5], at: [30, 26], turn: [-8, 6] },
    { slot: 0, eye: [-165.5, -178], z: [-170, -177.5], at: [40, 28], turn: [-120, -100] },
    { slot: 3, eye: [-162.5, -176.5], z: [-168.5, -175], at: [160, 168], turn: [12, -6] },
    { slot: 1, eye: [-169, -180], z: [-174.5, -179], at: [146, 154], turn: [120, 95] },
    { slot: 2, eye: [-172, -182], z: [-177, -179.4], at: [12, 8], turn: [4, -10] },
  ] as readonly PressVisit[],
  /** Share of a visit over which it rises and over which it sinks back. */
  rise: 0.3,
  sink: 0.22,
  /** The wall goes smooth, pale and thin when a press reaches this height (m). */
  pale: 0.16,
} as const;

/** The arms reaching out of the walls. */
const ARMS = {
  count: 24,
  /** Height of the scan (m), and its spread. */
  scale: 1.2,
  spread: 0.25,
  /** How deep the base is sunk (share of its height). */
  sink: 0.3,
  /** They come in thickets: how many arms to a thicket, how far apart (m). */
  thicket: 4,
  spreadAt: 0.85,
  /** Vertex clustering of the scan (15 k triangles, and there are 24 of them): cell sizes on the hand, on the wrist and on what is in the wall (object units), and where along the scan's x one gives way to the next. */
  cellHand: 0.038,
  cellWrist: 0.08,
  cellArm: 0.2,
  wristFrom: 0,
  armFrom: -0.45,
  /** Behind your back they turn after you: how fast (rad/s), and how far off the wall's normal they may lean (cos). */
  turnRate: 0.42,
  lean: 0.34,
} as const;

/** The skulls sunk in the folds: how many, their height (m), clustering cell (object units), how deep (share of their height). */
const SKULLS = { count: 12, scale: [0.36, 0.62] as Pair, cell: 0.075, sink: 0.2 } as const;

/** The bodies sunk in the wall: z, angle around the tube (deg), which of them (see BODY_SPECS), how far out of the wall (m). */
const BODIES = [
  [-153.9, 19, 1, 0.04],
  [-156.6, 170, 0, 0.06],
  [-159.1, 12, 2, 0.03],
  [-163.3, 161, 2, 0.05],
  [-165, 19, 0, 0.05],
  [-167.1, 173, 1, 0.04],
  [-175.3, 9, 0, 0.05],
  [-175.9, 160, 1, 0.05],
] as const;
const BODY_SPECS: readonly FigureSpec[] = [
  { avatar: 'figure_man', clip: 'm_knock_door', time: 1, face: 'blank', white: true, tint: 0xb9aea4, bleach: 0.75 },
  { avatar: 'figure_woman', clip: 'f_listen_door', time: 1.5, face: 'blank', white: true, tint: 0xb8b0a8, bleach: 0.8 },
  { avatar: 'figure_nurse', clip: 'f_listen_door', time: 0.5, face: 'blank', white: true, tint: 0xbcb6ac, bleach: 0.8 },
];
/** Height of a standing body's chest above its feet (m), its size, and how far it leans out of the wall (deg): the hips stay deep, the face comes out over the path. */
const CHEST = 1.3;
const BODY_SCALE = 1.14;
const BODY_LEAN = 30;

/** White hair growing out of the meat. */
const HAIR = {
  /** Clumps hanging from the roof: how many, strands in each. */
  clumps: 31,
  strands: [20, 42] as Pair,
  /** Segments of a strand, its width (m), the least height of a tip over the path (m), and how far beside the path it counts as beside. */
  segments: 12,
  width: 0.0044,
  over: 1.2,
  beside: 1.3,
  /** Waves along a strand (m), its sway (m, rad/s). */
  wave: 0.07,
  sway: 0.03,
  rate: 0.8,
} as const;

/** Threads of saliva: between the folds and between the jaws. */
const THREADS = { folds: 54, jaws: 9, segments: 9, sides: 3, radius: [0.0022, 0.0055] as Pair, clearance: 1.05, sag: [0.08, 0.5] as Pair } as const;

/** Hanging skins of meat: at every so many ring folds, how many, their length and width, how high over the path their ends stay (m). */
const SKINS = { everyFold: 2, perFold: 3, length: [0.8, 1.7] as Pair, width: [0.22, 0.55] as Pair, over: 1.25 } as const;

/** Teeth where no tooth should be: how many behind each arch, how tall (m), how much of them is sunk. */
const EXTRA_TEETH = { rows: 15, height: [0.8, 1.35] as Pair, sunk: 0.42 } as const;

/** Colors in linear light. */
const COLORS = {
  plum: [0.012, 0.001, 0.004],
  crimson: [0.15, 0.006, 0.009],
  rose: [0.4, 0.06, 0.05],
  cream: [0.6, 0.36, 0.24],
  fat: [0.86, 0.62, 0.56],
  gum: [0.3, 0.04, 0.045],
  stretch: [0.5, 0.2, 0.16],
  vein: [0.3, 0.12, 0.16],
  rimGlow: [0.035, 0.002, 0.003],
  veinGlow: [0.3, 0.025, 0.04],
  bone: [0.74, 0.66, 0.5],
  boneRoot: [0.16, 0.009, 0.012],
  heartDark: [0.012, 0.001, 0.003],
  heartRed: [0.19, 0.009, 0.013],
  heartFat: [0.5, 0.33, 0.13],
  heartVein: [0.035, 0.008, 0.04],
  heartGlow: [0.13, 0.006, 0.006],
  arm: [0.62, 0.47, 0.42],
  armRoot: [0.18, 0.01, 0.012],
  thread: [0.62, 0.52, 0.46],
  hair: [0.88, 0.86, 0.8],
  skull: [0.66, 0.54, 0.36],
  skullRoot: [0.14, 0.009, 0.011],
  sclera: [0.72, 0.62, 0.46],
  scleraVein: [0.42, 0.018, 0.016],
  /** What wet things mirror here: multiplies the picture that lights reflections. */
  room: [1, 0.3, 0.24],
} as const;

/** The lamp that goes with the viewer: only near things answer it, and only in glints. */
const LAMP = {
  color: 0xffc8b4,
  intensity: 5.2,
  angle: 50,
  penumbra: 0.95,
  /** Where it hangs from the eye (m: right, up, back), and how far ahead it aims. */
  offset: [0.18, 0.32, 0.25] as V3,
  aim: 6,
} as const;

/** Lights of the pool: position, color, intensity (cd), reach (m), how far ahead and behind the eye they begin to matter (m). */
const LIGHTS: readonly { at: V3; color: number; intensity: number; reach: number; ahead: number; behind: number }[] = [
  { at: [0.6, 2.6, -153.4], color: 0xe8705e, intensity: 5, reach: 7, ahead: 12, behind: 6 },
  { at: [1, 1.2, -158.4], color: 0xc2160a, intensity: 8, reach: 7.5, ahead: 13, behind: 6 },
  { at: [-1.1, 2.4, -162.8], color: 0xe88070, intensity: 5.5, reach: 6.5, ahead: 13, behind: 6 },
  { at: [0.9, 1, -167.2], color: 0xc81408, intensity: 7, reach: 7, ahead: 13, behind: 6 },
  // the heart: from below, and from behind it its edge
  { at: [-1, 0.9, -169.6], color: 0xdc1a0c, intensity: 28, reach: 9, ahead: 26, behind: 9 },
  { at: [1.2, 1.1, -174.2], color: 0xff9078, intensity: 12, reach: 8, ahead: 24, behind: 9 },
  { at: [0.2, 5.4, -176.4], color: 0xc4140a, intensity: 16, reach: 7, ahead: 20, behind: 7 },
  // the mouth: sick pink over the palate, red under the tongue, and the teeth from outside
  { at: [-1.2, 3.1, -181.4], color: 0xff9c8a, intensity: 7, reach: 7, ahead: 17, behind: 6 },
  { at: [1.4, 0.6, -183.2], color: 0xd2201a, intensity: 6, reach: 6.5, ahead: 14, behind: 6 },
  { at: [0, 2.5, -191.2], color: 0xf49a8c, intensity: 8, reach: 7.5, ahead: 6, behind: 23 },
];
/** How much the pool's lights rise on the beat of the heart at their place. */
const LIGHT_PULSE = REDUCED_MOTION ? 0.08 : 0.22;

/** A number as a GLSL float literal. */
const glf = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);
const glc = (c: readonly number[]): string => `vec3(${c.map(glf).join(', ')})`;

/** Meat in a red room mirrors the red room: without this its wet parts would catch the cold of the picture. Bone and teeth keep that cold: it is what tells them from the meat. */
const IN_THE_ROOM = ['#include <lights_fragment_maps>', `#include <lights_fragment_maps>\nradiance *= ${glc(COLORS.room)};\niblIrradiance *= ${glc(COLORS.room)};`] as const;

const v1 = new Vector3();
const v2 = new Vector3();
const v3 = new Vector3();
const forward = new Vector3();
const up = new Vector3();
const side = new Vector3();
const inward = new Vector3();
const m1 = new Matrix4();
const Y_AXIS = new Vector3(0, 1, 0);

const gauss = (x: number, at: number, length: number): number => {
  const k = (x - at) / length;
  return Math.exp(-k * k);
};
const ease = (a: number, b: number, v: number): number => {
  const t = range(a, b, v);
  return t * t * (3 - 2 * t);
};
const wrapAngle = (a: number): number => {
  const w = (a + Math.PI) % TAU;
  return (w < 0 ? w + TAU : w) - Math.PI;
};

function lattice(x: number, y: number, z: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}

/** Smooth noise in -1..1, the same on every run. */
function noise(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = lerp(lerp(lattice(ix, iy, iz), lattice(ix + 1, iy, iz), ux), lerp(lattice(ix, iy + 1, iz), lattice(ix + 1, iy + 1, iz), ux), uy);
  const b = lerp(lerp(lattice(ix, iy, iz + 1), lattice(ix + 1, iy, iz + 1), ux), lerp(lattice(ix, iy + 1, iz + 1), lattice(ix + 1, iy + 1, iz + 1), ux), uy);
  return lerp(a, b, uz);
}

function fbm(x: number, y: number, z: number, octaves = 3): number {
  let sum = 0;
  let weight = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * f, y * f, z * f);
    weight += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / weight;
}

/** One vertex of a grid being filled: set its place and everything else it carries. */
interface GridPoint {
  p: Vector3;
  u: number;
  v: number;
  /** Extra attributes by name, in the order and size given to the builder. */
  extra: Record<string, number[]>;
}

/** Sheets and tubes merged into one geometry with smooth normals. */
class MeshBuilder {
  private readonly position: number[] = [];
  private readonly normal: number[] = [];
  private readonly uv: number[] = [];
  private readonly index: number[] = [];
  private readonly extras = new Map<string, { size: number; data: number[] }>();

  constructor(extra: Record<string, number> = {}) {
    for (const [name, size] of Object.entries(extra)) this.extras.set(name, { size, data: [] });
  }

  /**
   * A grid of rows × cols vertices, its faces turned toward (∂/∂col × ∂/∂row), or away with `flip`.
   * `closed`: the last column is the first one again (the fill must give it the same place).
   */
  grid(rows: number, cols: number, closed: boolean, flip: boolean, fill: (i: number, j: number, out: GridPoint) => void): void {
    const base = this.position.length / 3;
    const p = new Float32Array(rows * cols * 3);
    const point: GridPoint = { p: new Vector3(), u: 0, v: 0, extra: {} };
    for (const [name, e] of this.extras) point.extra[name] = new Array<number>(e.size).fill(0);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        fill(i, j, point);
        const k = (i * cols + j) * 3;
        p[k] = point.p.x;
        p[k + 1] = point.p.y;
        p[k + 2] = point.p.z;
        this.position.push(point.p.x, point.p.y, point.p.z);
        this.uv.push(point.u, point.v);
        for (const [name, e] of this.extras) e.data.push(...point.extra[name]);
      }
    }
    const unique = closed ? cols - 1 : cols;
    const at = (i: number, j: number, out: Vector3) => {
      const k = (i * cols + j) * 3;
      return out.set(p[k], p[k + 1], p[k + 2]);
    };
    for (let i = 0; i < rows; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(rows - 1, i + 1);
      for (let j = 0; j < cols; j++) {
        const jj = closed ? j % unique : j;
        const j0 = closed ? (jj + unique - 1) % unique : Math.max(0, j - 1);
        const j1 = closed ? (jj + 1) % unique : Math.min(cols - 1, j + 1);
        at(i, j1, v1).sub(at(i, j0, v2));
        at(i1, jj, v2).sub(at(i0, jj, v3));
        v1.cross(v2);
        if (v1.lengthSq() < 1e-12) v1.set(0, 0, 1);
        v1.normalize();
        if (flip) v1.negate();
        this.normal.push(v1.x, v1.y, v1.z);
      }
    }
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = base + i * cols + j;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        if (flip) this.index.push(a, c, b, b, c, d);
        else this.index.push(a, b, c, b, d, c);
      }
    }
  }

  /** A tube along points (Catmull-Rom through them) with this radius along it (0..1); its faces look out. */
  tube(points: readonly Vector3[], rows: number, sides: number, radius: (t: number) => number, fill: (t: number, psi: number, out: GridPoint) => void): void {
    const centers: Vector3[] = [];
    for (let i = 0; i < rows; i++) centers.push(catmull(points, i / (rows - 1)));
    const normals: Vector3[] = [];
    const tangents: Vector3[] = [];
    for (let i = 0; i < rows; i++) tangents.push(centers[Math.min(rows - 1, i + 1)].clone().sub(centers[Math.max(0, i - 1)]).normalize());
    let n = new Vector3(0.31, 0.17, 0.93).cross(tangents[0]).normalize();
    for (let i = 0; i < rows; i++) {
      n = n.clone().addScaledVector(tangents[i], -n.dot(tangents[i])).normalize();
      normals.push(n);
    }
    const binormal = new Vector3();
    this.grid(rows, sides + 1, true, false, (i, j, out) => {
      const psi = ((j % sides) / sides) * TAU;
      const t = i / (rows - 1);
      const r = radius(t);
      binormal.crossVectors(tangents[i], normals[i]);
      out.p.copy(centers[i]).addScaledVector(normals[i], r * Math.cos(psi)).addScaledVector(binormal, r * Math.sin(psi));
      out.u = (j / sides) * TAU * r;
      out.v = t;
      fill(t, psi, out);
    });
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.normal, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    for (const [name, e] of this.extras) g.setAttribute(name, new Float32BufferAttribute(e.data, e.size));
    g.setIndex(this.index);
    return g;
  }
}

function catmull(points: readonly Vector3[], t: number): Vector3 {
  const n = points.length - 1;
  const x = clamp(t, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(n, i + 2)];
  const blend = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (3 * b - a - 3 * c + d) * f * f * f);
  return new Vector3(blend(p0.x, p1.x, p2.x, p3.x), blend(p0.y, p1.y, p2.y, p3.y), blend(p0.z, p1.z, p2.z, p3.z));
}

/**
 * Vertex clustering: fast enough to do at load, and it keeps the shading by averaging the normals of
 * what it merges. The cell may differ from place to place. With `keepUv`, the charts of a texture stay apart.
 */
function clustered(source: BufferGeometry, cellAt: (x: number, y: number, z: number) => number, keepUv: boolean): BufferGeometry {
  const pos = source.getAttribute('position');
  const nor = source.getAttribute('normal');
  const uv = source.getAttribute('uv');
  const remap = new Int32Array(pos.count);
  const cells = new Map<string, number>();
  const sums: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const cell = cellAt(x, y, z);
    let key = `${cell},${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`;
    if (keepUv) key += `,${Math.round(uv.getX(i) * 12)},${Math.round(uv.getY(i) * 12)}`;
    let c = cells.get(key);
    if (c === undefined) {
      c = cells.size;
      cells.set(key, c);
      sums.push(0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
    remap[i] = c;
    const k = c * 9;
    sums[k] += x;
    sums[k + 1] += y;
    sums[k + 2] += z;
    sums[k + 3] += nor.getX(i);
    sums[k + 4] += nor.getY(i);
    sums[k + 5] += nor.getZ(i);
    if (keepUv) {
      sums[k + 6] += uv.getX(i);
      sums[k + 7] += uv.getY(i);
    }
    sums[k + 8] += 1;
  }
  const positions = new Float32Array(cells.size * 3);
  const normals = new Float32Array(cells.size * 3);
  const uvs = new Float32Array(cells.size * 2);
  for (let c = 0; c < cells.size; c++) {
    const k = c * 9;
    const n = sums[k + 8];
    positions.set([sums[k] / n, sums[k + 1] / n, sums[k + 2] / n], c * 3);
    const l = Math.hypot(sums[k + 3], sums[k + 4], sums[k + 5]) || 1;
    normals.set([sums[k + 3] / l, sums[k + 4] / l, sums[k + 5] / l], c * 3);
    uvs.set([sums[k + 6] / n, sums[k + 7] / n], c * 2);
  }
  const old = source.getIndex()!;
  const index: number[] = [];
  for (let t = 0; t < old.count; t += 3) {
    const a = remap[old.getX(t)];
    const b = remap[old.getX(t + 1)];
    const c = remap[old.getX(t + 2)];
    if (a !== b && b !== c && a !== c) index.push(a, b, c);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  if (keepUv) g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  return g;
}

/** Clustering leaves a stepped surface: a few rounds of smoothing that does not shrink (Taubin's) take the steps out. */
function relaxed(g: BufferGeometry, rounds: number): BufferGeometry {
  const p = g.getAttribute('position');
  const index = g.getIndex()!;
  const around = Array.from({ length: p.count }, () => new Set<number>());
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    around[a].add(b).add(c);
    around[b].add(a).add(c);
    around[c].add(a).add(b);
  }
  const at = p.array as Float32Array;
  const next = new Float32Array(at);
  const move = (k: number) => {
    for (let i = 0; i < p.count; i++) {
      if (around[i].size === 0) continue;
      for (let axis = 0; axis < 3; axis++) {
        let sum = 0;
        for (const n of around[i]) sum += at[n * 3 + axis];
        next[i * 3 + axis] = at[i * 3 + axis] + k * (sum / around[i].size - at[i * 3 + axis]);
      }
    }
    at.set(next);
  };
  for (let i = 0; i < rounds; i++) {
    move(0.55);
    move(-0.58);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * The tooth scans come in hard facets: normals averaged only across what is nearly flat, so that a
 * tooth is smooth but its edges stay edges.
 */
function creased(source: BufferGeometry, degrees: number): BufferGeometry {
  const pos = source.getAttribute('position');
  const old = source.getIndex()!;
  const weld = new Map<string, number>();
  const remap = new Int32Array(pos.count);
  const p: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${Math.round(x * 8192)},${Math.round(y * 8192)},${Math.round(z * 8192)}`;
    let w = weld.get(key);
    if (w === undefined) {
      w = p.length / 3;
      weld.set(key, w);
      p.push(x, y, z);
    }
    remap[i] = w;
  }
  const faces: number[] = [];
  const faceNormals: Vector3[] = [];
  const around: number[][] = Array.from({ length: p.length / 3 }, () => []);
  for (let t = 0; t < old.count; t += 3) {
    const a = remap[old.getX(t)];
    const b = remap[old.getX(t + 1)];
    const c = remap[old.getX(t + 2)];
    if (a === b || b === c || a === c) continue;
    const f = faces.length / 3;
    faces.push(a, b, c);
    v1.set(p[a * 3], p[a * 3 + 1], p[a * 3 + 2]);
    v2.set(p[b * 3], p[b * 3 + 1], p[b * 3 + 2]).sub(v1);
    v3.set(p[c * 3], p[c * 3 + 1], p[c * 3 + 2]).sub(v1);
    faceNormals.push(new Vector3().crossVectors(v2, v3));
    around[a].push(f);
    around[b].push(f);
    around[c].push(f);
  }
  const limit = Math.cos(degrees * DEG);
  const unit = faceNormals.map((n) => n.clone().normalize());
  const positions: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  const made = new Map<string, number>();
  for (let f = 0; f < faces.length / 3; f++) {
    for (let k = 0; k < 3; k++) {
      const w = faces[f * 3 + k];
      side.set(0, 0, 0);
      for (const g of around[w]) if (unit[f].dot(unit[g]) > limit) side.add(faceNormals[g]);
      side.normalize();
      const key = `${w},${Math.round(side.x * 256)},${Math.round(side.y * 256)},${Math.round(side.z * 256)}`;
      let m = made.get(key);
      if (m === undefined) {
        m = positions.length / 3;
        made.set(key, m);
        positions.push(p[w * 3], p[w * 3 + 1], p[w * 3 + 2]);
        normals.push(side.x, side.y, side.z);
      }
      index.push(m);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setIndex(index);
  return g;
}

/** A long tooth, root at the origin, tip at y = 1: round at the neck, a blade with a ridge toward the tip, a little bent. */
function toothGeometry(): BufferGeometry {
  const b = new MeshBuilder();
  const rows = 10;
  const sides = 12;
  b.grid(rows, sides + 1, true, true, (i, j, out) => {
    const t = i / (rows - 1);
    const psi = ((j % sides) / sides) * TAU;
    // from the neck to the tip
    const taper = t < 0.32 ? lerp(0.74, 1, ease(0, 0.32, t)) : Math.sqrt(Math.max(0.0006, 1 - ((t - 0.32) / 0.68) ** 2.2));
    const blade = lerp(0.82, 0.5, ease(0.3, 1, t));
    const ridge = 1 + 0.16 * ease(0.25, 0.9, t) * Math.cos(2 * psi) ** 8;
    const R = 0.26 * taper * ridge;
    out.p.set(R * Math.cos(psi) + 0.09 * t * t, t, R * blade * Math.sin(psi) - 0.05 * t * t);
    out.u = 0;
    out.v = 0;
  });
  return b.build();
}

/** The horseshoe of the teeth in plan, measured from the scans once they stand in place. */
class ArchPlan {
  private static readonly BINS = 31;
  private static readonly STEP = (10 * Math.PI) / 180;
  /** z of the middle of the horseshoe. */
  readonly centerZ: number;
  /** How far around (rad, either way from the front) the teeth reach. */
  readonly ends: number;
  private readonly radii: number[] = [];
  private readonly endX: number;

  /** `points`: x, z pairs of every tooth vertex. */
  constructor(points: readonly number[], frontZ: number, backZ: number) {
    this.centerZ = (frontZ + backZ) / 2;
    const bins = ArchPlan.BINS;
    const least = new Array<number>(bins).fill(Infinity);
    const most = new Array<number>(bins).fill(-Infinity);
    for (let i = 0; i < points.length; i += 2) {
      const dz = points[i + 1] - this.centerZ;
      const k = Math.round(this.bin(Math.atan2(points[i], -dz)));
      if (k < 0 || k >= bins) continue;
      const r = Math.hypot(points[i], dz);
      least[k] = Math.min(least[k], r);
      most[k] = Math.max(most[k], r);
    }
    let first = 0;
    while (first < bins && most[first] < 0) first++;
    let last = bins - 1;
    while (last >= 0 && most[last] < 0) last--;
    const middle: number[] = [];
    for (let k = 0; k < bins; k++) {
      let at = clamp(k, first, last);
      while (most[at] < 0 && at < last) at++;
      middle.push((least[at] + most[at]) / 2);
    }
    for (let k = 0; k < bins; k++) this.radii.push((middle[Math.max(0, k - 1)] + middle[k] * 2 + middle[Math.min(bins - 1, k + 1)]) / 4);
    const phiOf = (bin: number) => (bin - (bins - 1) / 2) * ArchPlan.STEP;
    this.ends = Math.min(-phiOf(first), phiOf(last));
    this.endX = this.radius(this.ends) * Math.sin(this.ends);
  }

  private bin(phi: number): number {
    return phi / ArchPlan.STEP + (ArchPlan.BINS - 1) / 2;
  }

  radius(phi: number): number {
    const b = clamp(this.bin(phi), 0, ArchPlan.BINS - 1.001);
    const k = Math.floor(b);
    return lerp(this.radii[k], this.radii[k + 1], b - k);
  }

  /** A point on the horseshoe, this far (m) inward from its middle. */
  point(phi: number, inwardBy: number, out: Vector3): Vector3 {
    const r = this.radius(phi) - inwardBy;
    return out.set(r * Math.sin(phi), 0, this.centerZ - r * Math.cos(phi));
  }

  /** Signed distance from the horseshoe in plan: negative inside it. */
  distance(x: number, z: number): number {
    const dz = z - this.centerZ;
    const phi = Math.atan2(x, -dz);
    if (Math.abs(phi) <= this.ends) return Math.hypot(x, dz) - this.radius(phi);
    // behind the ends of the horseshoe is the throat: only far to the side is outside
    return (Math.abs(x) - this.endX) / Math.sin(this.ends);
  }

  /** 1 at the front teeth, 0 at the back. */
  front(x: number, z: number): number {
    return 1 - ease(0.35, 1.5, Math.abs(Math.atan2(x, -(z - this.centerZ))));
  }
}

/** What the wall has at a place, besides its radius. */
interface Mound {
  theta: number;
  z: number;
  reach: number;
  height: number;
}

interface WallFold {
  z: number;
  depth: number;
  length: number;
  p: number;
  q: number;
}

/** The shape of the gullet's wall as a pure function: everything sunk in it asks here where it is. */
class WallShape {
  readonly ribs: number[] = [];
  readonly folds: WallFold[] = [];
  private readonly mounds: Mound[] = [];

  constructor(private readonly arch: ArchPlan) {
    const r = randomFrom(4411);
    const F = WALL.folds;
    for (let z = F.first; z > F.last; z -= lerp(F.gap[0], F.gap[1], r())) {
      this.folds.push({ z, depth: lerp(F.depth[0], F.depth[1], r()), length: lerp(F.length[0], F.length[1], r()), p: r() * TAU, q: r() * TAU });
    }
    for (let z = RIBS.first; z > RIBS.last; z -= RIBS.gap) this.ribs.push(z);
  }

  addMound(theta: number, z: number, reach: number, height: number): void {
    this.mounds.push({ theta, z, reach, height });
  }

  /** How much of a mouth this z is (0 in the throat, 1 in the mouth). */
  static mouthShare(z: number): number {
    return smootherstep(range(MOUTH.flare[0], MOUTH.flare[1], z));
  }

  /** The throat's own radius, without the mouth. */
  private tube(theta: number, z: number): number {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    let r = TUBE_R;
    r += (HEART.widenTo - TUBE_R) * gauss(z, HEART.z, HEART.widenLength);
    r -= WALL.neck.narrow * gauss(z, WALL.neck.z, WALL.neck.length);
    const over = Math.max(0, s);
    r += HEART.vault * gauss(z, HEART.z, HEART.vaultLength) * over * over * over;
    // ring folds, leaning a little, steep on the side that faces the one who comes
    const roll = 0.72 + 0.42 * noise(c * 1.4 + 3, s * 1.4, z * 0.1);
    for (const f of this.folds) {
      const dz = z - (f.z + 0.42 * Math.sin(theta + f.p) + 0.16 * Math.sin(2 * theta + f.q));
      const k = dz / (dz > 0 ? f.length * 0.7 : f.length * 1.6);
      if (k > 3 || k < -3) continue;
      r -= f.depth * roll * Math.exp(-k * k);
    }
    r += WALL.lumps * fbm(c * 1.7, s * 1.7, z * 0.21);
    r += WALL.knots * noise(c * 5 + 9.3, s * 5, z * 0.85);
    // bundles of muscle lying around the tube
    r += WALL.bundles * (1 - 2 * Math.abs(noise(c * 1.1 + 21, s * 1.1, z * 2.9)));
    for (const rib of this.ribs) {
      const dz = z - rib;
      if (dz > 1 || dz < -1) continue;
      r -= RIBS.welt * Math.exp(-(dz * dz) / (RIBS.weltLength * RIBS.weltLength));
    }
    const P = MOUTH.softPalate;
    const pz = z - P.z;
    const arch = gauss(wrapAngle(theta - Math.PI / 2), 0, P.wide * DEG) * Math.exp(-((pz / (pz > 0 ? P.length * 0.7 : P.length * 1.5)) ** 2));
    return lerp(r, P.crest - AXIS_Y, arch);
  }

  /**
   * At the front teeth the wall climbs inside the thickness of the teeth, so that from outside they
   * stand before it with their whole gums, and the lips close over a dark pocket.
   */
  private behindTeeth(x: number, z: number, d: number): number {
    const f = this.arch.front(x, z);
    return MOUTH.pocket * f ** 4 * ease(-0.26, 0.1, d);
  }

  /** Height of the palate over the plan, the mouth being shut. */
  private roof(x: number, z: number): number {
    const d = this.arch.distance(x, z);
    const gum = BITE_Y + lerp(MOUTH.crown[0], MOUTH.crown[1], this.arch.front(x, z));
    const root = 0.06 * Math.cos(Math.atan2(x, -(z - this.arch.centerZ)) * 11);
    const behind = this.behindTeeth(x, z, d);
    if (d < 0) return gum + behind + root * Math.exp(d / 0.6) + MOUTH.palate * (1 - Math.exp(d / 1.25)) - 0.08 * gauss(d, -0.4, 0.3);
    return gum + behind + root - MOUTH.sulcus * ease(0, 1.5, d);
  }

  /** Height of the floor of the mouth, the mouth being shut. */
  private floor(x: number, z: number): number {
    const d = this.arch.distance(x, z);
    const gum = BITE_Y - lerp(MOUTH.crownLower[0], MOUTH.crownLower[1], this.arch.front(x, z));
    const root = 0.05 * Math.cos(Math.atan2(x, -(z - this.arch.centerZ)) * 13);
    const behind = this.behindTeeth(x, z, d);
    if (d < 0) return gum - behind - root * Math.exp(d / 0.6) - MOUTH.floor * (1 - Math.exp(d / 1.15)) + 0.07 * gauss(d, -0.35, 0.28);
    return gum - behind - root + MOUTH.sulcus * ease(0, 1.5, d);
  }

  /** Radius of the mouth's wall (around the same axis, the mouth being shut). */
  private mouth(theta: number, z: number): number {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const cheek = lerp(MOUTH.cheek[0], MOUTH.cheek[1], ease(MOUTH.cheek[2], MOUTH.cheek[3], z));
    let r = cheek * 1.5;
    if (Math.abs(s) > 1e-3) {
      const miss = (R: number) => (s > 0 ? AXIS_Y + R * s - this.roof(R * c, z) : this.floor(R * c, z) - AXIS_Y - R * s);
      let lo = 0.15;
      let hi = r;
      if (miss(hi) > 0) {
        for (let i = 0; i < 18; i++) {
          const m = (lo + hi) / 2;
          if (miss(m) > 0) hi = m;
          else lo = m;
        }
        r = (lo + hi) / 2;
      }
    }
    // soft corners where the palate meets the cheek
    const soft = 1.5;
    const round = -Math.log(Math.exp(-soft * r) + Math.exp(-soft * cheek)) / soft;
    return round + 0.1 * noise(c * 2.2 + 41, s * 2.2, z * 0.7) + 0.05 * noise(c * 6 + 17, s * 6, z * 1.6);
  }

  /** Radius of the wall at this angle (rad) and z. */
  at(theta: number, z: number): number {
    const share = WallShape.mouthShare(z);
    let r = share < 1 ? this.tube(theta, z) : 0;
    if (share > 0) r = lerp(r, this.mouth(theta, z), share);
    for (const m of this.mounds) {
      const dz = z - m.z;
      if (dz > m.reach || dz < -m.reach) continue;
      const d = Math.hypot(wrapAngle(theta - m.theta) * TUBE_R, dz) / m.reach;
      if (d < 1) r -= m.height * 0.5 * (1 + Math.cos(Math.PI * d));
    }
    return r;
  }

  /** The place on the wall (and how far beyond its surface, m). */
  point(theta: number, z: number, deeper: number, out: Vector3): Vector3 {
    const r = this.at(theta, z) + deeper;
    return out.set(r * Math.cos(theta), AXIS_Y + r * Math.sin(theta), z);
  }

  /** The wall's normal here, looking into the tunnel. */
  normal(theta: number, z: number, out: Vector3): Vector3 {
    const e = 0.14;
    const da = e / TUBE_R;
    const r = this.at(theta, z);
    const dra = (this.at(theta + da, z) - r) / da;
    const drz = (this.at(theta, z + e) - r) / e;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    // the tangents along the angle and along z, crossed
    v1.set(dra * c - r * s, dra * s + r * c, 0);
    v2.set(drz * c, drz * s, 1);
    return out.crossVectors(v1, v2).normalize().multiplyScalar(-1);
  }
}

// ---------------------------------------------------------------------------------- shaders

/** What every wet thing that rides the wall knows: the beat that runs along it and the breath. */
const PULSE_GLSL = /* glsl */ `
uniform float uFleshTime;
uniform vec2 uBeat;   // whole beats so far + share of this one; how much of a beat dies per beat
uniform vec2 uSwell;  // of one pulse, of the breath (m)
float fleshBeat(float z) {
  float x = fract(uBeat.x - abs(z - ${glf(HEART.z)}) / ${glf(PULSE.wavelength)});
  float second = x < ${glf(PULSE.second.at)} ? 0.0 : ${glf(PULSE.second.strength)} * exp(-uBeat.y * (x - ${glf(PULSE.second.at)}));
  return smoothstep(0.0, 0.07, x) * max(exp(-uBeat.y * x), second);
}
float fleshSwell(vec3 p, float beat) {
  float a = atan(p.y - ${glf(AXIS_Y)}, p.x);
  return uSwell.x * beat + uSwell.y * sin(uFleshTime * ${glf(PULSE.breathRate)} + p.z * 0.31 + 1.7 * sin(a + p.z * 0.13));
}
`;

/** The shapes pressing from behind the membrane, as a height over the wall (m), in wall coordinates (arc, z). */
const PRESS_GLSL = /* glsl */ `
uniform vec4 uPress[4]; // arc (m), z (m), strength, turn (rad)
float pressBump(vec2 q, vec2 r) {
  vec2 k = q / r;
  return exp(-dot(k, k));
}
float pressBone(vec2 q, vec2 a, vec2 b, float r) {
  vec2 pa = q - a;
  vec2 ba = b - a;
  vec2 k = (pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)) / r;
  return exp(-dot(k, k));
}
// a spread hand, the palm at the origin, the fingers toward +y
float pressHand(vec2 q) {
  float g = 1.0 - pressBump(q - vec2(0.0, -0.16), vec2(0.36, 0.38));
  g *= 1.0 - pressBone(q, vec2(-0.23, 0.12), vec2(-0.38, 0.68), 0.095);
  g *= 1.0 - pressBone(q, vec2(-0.08, 0.16), vec2(-0.11, 0.8), 0.1);
  g *= 1.0 - pressBone(q, vec2(0.08, 0.15), vec2(0.15, 0.74), 0.095);
  g *= 1.0 - pressBone(q, vec2(0.23, 0.08), vec2(0.42, 0.52), 0.085);
  g *= 1.0 - pressBone(q, vec2(-0.27, -0.26), vec2(-0.66, 0.1), 0.105);
  return (1.0 - g) * 0.84 + 0.26 * pressBump(q, vec2(0.9, 1.0));
}
// a face seen from the front, the chin toward -y, the mouth open
float pressFace(vec2 q) {
  vec2 s = vec2(abs(q.x), q.y);
  float skull = 1.0 - smoothstep(0.3, 1.3, length(q / vec2(0.5, 0.74)));
  float h = 0.56 * skull;
  h += 0.2 * pressBone(s, vec2(0.08, 0.2), vec2(0.32, 0.21), 0.09);
  h -= 0.3 * pressBump(s - vec2(0.2, 0.06), vec2(0.13, 0.085));
  h += 0.18 * pressBone(q, vec2(0.0, 0.17), vec2(0.0, -0.13), 0.1);
  h += 0.3 * pressBump(q - vec2(0.0, -0.17), vec2(0.12, 0.09));
  h += 0.12 * pressBump(s - vec2(0.3, -0.14), vec2(0.15, 0.14));
  h -= 0.34 * pressBump(q - vec2(0.0, -0.42), vec2(0.17, 0.09));
  h += 0.13 * pressBone(q, vec2(-0.2, -0.3), vec2(0.2, -0.3), 0.06);
  h += 0.13 * pressBone(q, vec2(-0.17, -0.54), vec2(0.17, -0.54), 0.065);
  h += 0.14 * pressBump(q - vec2(0.0, -0.69), vec2(0.16, 0.09));
  return max(h, 0.0);
}
float pressHeight(vec2 w) {
  float h = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 p = uPress[i];
    if (p.z <= 0.0) continue;
    vec2 d = w - p.xy;
    float far = dot(d, d) / ${glf(PRESS.reach * PRESS.reach)};
    if (far >= 1.0) continue;
    // it dies away before it is cut off, so that the wall shows no edge where it ends
    float keep = p.z * (1.0 - far) * (1.0 - far);
    float cs = cos(p.w);
    float sn = sin(p.w);
    vec2 q = vec2(cs * d.x + sn * d.y, cs * d.y - sn * d.x);
    if (i < 2) h += keep * ${glf(PRESS.handDepth)} * pressHand(i == 1 ? vec2(-q.x, q.y) : q);
    else h += keep * ${glf(PRESS.faceDepth)} * pressFace(q);
  }
  return h;
}
`;

const WALL_VERTEX_PARS = /* glsl */ `
attribute vec4 aTissue; // smear, fat, bruise, relief (0 valley .. 1 crest)
attribute vec4 aPlace;  // jaw (+ upper, - lower), ring of the sphincter, glow, gum
varying vec4 vTissue;
varying vec4 vFlesh;    // beat, stretch, glow, gum
varying vec2 vWallAt;   // where on the wall (arc, z)
uniform vec2 uJaw;      // lift of the upper jaw, drop of the lower (m)
uniform float uRim;     // share of its radius the ring of the sphincter keeps
${PULSE_GLSL}
${PRESS_GLSL}
`;

/** Runs before the normal is used: it works out the whole displacement. The fingers are finer than the mesh: the normal over a press is worked out per pixel. */
const WALL_VERTEX_NORMAL = /* glsl */ `
#include <beginnormal_vertex>
vec2 wallOut = position.xy - vec2(0.0, ${glf(AXIS_Y)});
wallOut /= max(length(wallOut), 0.001);
float wallAngle = atan(wallOut.y, wallOut.x);
if (wallAngle < -PI_HALF) wallAngle += PI2;
vec2 wallAt = vec2(wallAngle * ${glf(PRESS.wallRadius)}, position.z);
float wallBeat = fleshBeat(position.z);
float wallSwell = fleshSwell(position, wallBeat);
float wallPress = pressHeight(wallAt);
objectNormal.z -= uSwell.x * (fleshBeat(position.z + 0.2) - wallBeat) * 5.0;
objectNormal = normalize(objectNormal);
vWallAt = wallAt;
vTissue = aTissue;
vFlesh = vec4(wallBeat, saturate(wallPress / ${glf(PRESS.pale)}), aPlace.z, aPlace.w);
`;

const WALL_VERTEX_PLACE = /* glsl */ `
#include <begin_vertex>
transformed.xy -= wallOut * (wallSwell + wallPress);
transformed.y += max(aPlace.x, 0.0) * uJaw.x + max(-aPlace.x, 0.0) * uJaw.y;
transformed.xy = vec2(0.0, ${glf(AXIS_Y)}) + (transformed.xy - vec2(0.0, ${glf(AXIS_Y)})) * mix(1.0, uRim, aPlace.y);
`;

/** Tongue, skins, vessels, the uvula: they do not press, but they hang, and the heart pulls them. */
const LOOSE_VERTEX_PARS = /* glsl */ `
attribute vec4 aTissue;
attribute vec4 aPlace;  // jaw, how free it hangs, glow, gum
varying vec4 vTissue;
varying vec4 vFlesh;
uniform vec2 uJaw;
uniform vec3 uHeartJolt; // the whole heart's jolt (m)
${PULSE_GLSL}
`;

const LOOSE_VERTEX_PLACE = /* glsl */ `
#include <begin_vertex>
vec2 looseSway = vec2(sin(uFleshTime * 0.83 + position.z * 0.7 + position.x * 0.9), sin(uFleshTime * 0.61 + position.y * 0.8)) * ${glf(0.07 * MOTION)};
transformed += aPlace.y * (vec3(looseSway.x, 0.0, looseSway.y) + uHeartJolt);
transformed.y += max(aPlace.x, 0.0) * uJaw.x + max(-aPlace.x, 0.0) * uJaw.y;
vTissue = aTissue;
vFlesh = vec4(fleshBeat(position.z), 0.0, aPlace.z, aPlace.w);
`;

/** Eyelids: their rims in latitude (rad) along the eye's width (s in -1..1 between the corners). */
const LID_GLSL = /* glsl */ `
float lidFall(float s) {
  return pow(max(1.0 - s * s, 0.0), 0.72);
}
float lidUpper(float s, float open, float blink) {
  float f = lidFall(s);
  return mix(open * 0.66 * f + 0.05 * s, -0.08 * f, blink);
}
float lidLower(float s, float open, float blink) {
  float f = lidFall(s);
  return mix(-open * 0.45 * f + 0.05 * s, -0.1 * f, blink);
}
`;

/** Half width of the opening of an eye: longitude of its corners (rad). */
const LID_LONGITUDE = 1.12;

const LID_VERTEX_PARS = /* glsl */ `
attribute vec4 aLook;   // where the ball looks (own frame), blink
attribute vec3 aEye;    // how wide open, pupil, seed
attribute vec4 aTissue;
varying vec4 vTissue;
varying vec4 vFlesh;
${PULSE_GLSL}
${LID_GLSL}
vec3 lidPoint(float s, float t, float lid) {
  float rim = lid > 0.0 ? lidUpper(s, aEye.x, aLook.w) : lidLower(s, aEye.x, aLook.w);
  float lat = mix(rim, lid * 1.42, t);
  float lon = s * ${glf(LID_LONGITUDE)};
  float rad = 1.02 + 0.2 * sin(3.14159 * pow(t, 0.55)) - 0.04 * smoothstep(0.26, 0.36, t) * (1.0 - smoothstep(0.4, 0.5, t));
  float cl = cos(lat);
  return rad * vec3(cl * sin(lon), sin(lat), cl * cos(lon));
}
`;

const LID_VERTEX_NORMAL = /* glsl */ `
vec3 lidAt = lidPoint(position.x, position.y, position.z);
vec3 lidAcross = lidPoint(position.x + 0.02, position.y, position.z) - lidAt;
vec3 lidDown = lidPoint(position.x, position.y + 0.02, position.z) - lidAt;
vec3 objectNormal = normalize(cross(lidAcross, lidDown)) * position.z;
vTissue = aTissue;
vFlesh = vec4(fleshBeat(instanceMatrix[3].z), 0.0, 1.0, 1.0 - smoothstep(0.0, 0.1, position.y));
`;

const LID_VERTEX_PLACE = /* glsl */ `
vec3 transformed = lidAt;
transformed.z += fleshSwell(instanceMatrix[3].xyz, fleshBeat(instanceMatrix[3].z)) / length(instanceMatrix[0].xyz);
`;

/** How flesh looks, whatever its shape. */
const FLESH_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D tSmear;
uniform sampler2D tSmearN;
uniform sampler2D tPit;
uniform sampler2D tPitN;
uniform sampler2D tVeins;
varying vec4 vTissue;
varying vec4 vFlesh;
vec3 fleshRamp(float v) {
  vec3 c = mix(${glc(COLORS.plum)}, ${glc(COLORS.crimson)}, smoothstep(0.0, 0.26, v));
  c = mix(c, ${glc(COLORS.rose)}, smoothstep(0.26, 0.6, v));
  return mix(c, ${glc(COLORS.cream)}, smoothstep(0.62, 1.0, v));
}
`;

const FLESH_ALBEDO = /* glsl */ `
vec2 fleshSmearUv = vMapUv * ${glf(TILE.fibre / TILE.smear)};
vec2 fleshPitUv = vMapUv * ${glf(TILE.fibre / TILE.pit)};
float fleshSmear = texture2D(tSmear, fleshSmearUv).r;
vec3 fleshPit = texture2D(tPit, fleshPitUv).rgb;
float fleshVein = texture2D(tVeins, vMapUv * ${glf(TILE.fibre / TILE.veins)}).r * (1.0 - 0.8 * vFlesh.w);
float fleshStreak = saturate(diffuseColor.r * 1.25);
float fleshMixSmear = smoothstep(0.36, 0.64, vTissue.x + (fleshStreak - 0.35) * 0.3);
float fleshMixFat = smoothstep(0.6, 0.78, vTissue.y + (fleshPit.g - 0.24) * 0.8);
float fleshStretch = vFlesh.y;
vec2 fleshPressSlope = vec2(0.0);
#ifdef FLESH_WALL
fleshStretch = 0.0;
if (vFlesh.y > 0.004) {
  float pressH = pressHeight(vWallAt);
  fleshPressSlope = (vec2(pressHeight(vWallAt + vec2(0.015, 0.0)), pressHeight(vWallAt + vec2(0.0, 0.015))) - pressH) / 0.015;
  fleshStretch = saturate(pressH / ${glf(PRESS.pale)});
}
#endif
float fleshCrest = smoothstep(0.56, 0.86, vTissue.w);
float fleshValley = 1.0 - smoothstep(0.14, 0.44, vTissue.w);
vec3 fleshC = fleshRamp(fleshStreak * 0.78 + fleshCrest * 0.16);
fleshC = mix(fleshC, fleshRamp(0.14 + (fleshSmear - 0.3) * 1.7 + fleshCrest * 0.22), fleshMixSmear);
fleshC = mix(fleshC, mix(${glc(COLORS.cream)}, fleshPit, 0.18) * ${glc(COLORS.fat)} * (0.5 + 1.6 * fleshPit.g), fleshMixFat * 0.8);
fleshC *= 1.0 - 0.7 * vTissue.z;
fleshC = mix(fleshC, ${glc(COLORS.gum)} * (0.5 + fleshSmear * 1.4), vFlesh.w);
fleshC = mix(fleshC, ${glc(COLORS.stretch)} * (0.72 + 0.28 * fleshStreak), fleshStretch * fleshStretch * 0.85);
fleshC *= 1.0 - 0.6 * saturate(length(fleshPressSlope) * 0.7);
fleshC = mix(fleshC, ${glc(COLORS.vein)}, fleshVein * 0.14);
fleshC *= 1.0 - fleshValley * 0.74;
diffuseColor.rgb = fleshC;
`;

const FLESH_WET = /* glsl */ `
float fleshFar = saturate(length(vViewPosition) / 18.0);
roughnessFactor = mix(0.2, 0.13, fleshMixSmear) + 0.2 * fleshMixFat + 0.07 * fleshStreak - 0.05 * fleshValley + 0.2 * fleshFar - 0.06 * fleshStretch;
`;

const FLESH_NORMAL = /* glsl */ `
vec3 fleshMapN = mix(texture2D(normalMap, vNormalMapUv).xyz, texture2D(tSmearN, fleshSmearUv).xyz, fleshMixSmear);
fleshMapN = mix(fleshMapN, texture2D(tPitN, fleshPitUv).xyz, fleshMixFat) * 2.0 - 1.0;
fleshMapN.xy *= normalScale * (1.0 - fleshFar * 0.55) * (1.0 - fleshStretch * 0.9);
normal = normalize(tbn * fleshMapN);
#ifdef FLESH_WALL
if (fleshStretch > 0.0) {
  float pressA = vWallAt.x / ${glf(PRESS.wallRadius)};
  normal = normalize(normal - mat3(viewMatrix) * (fleshPressSlope.x * vec3(-sin(pressA), cos(pressA), 0.0) + vec3(0.0, 0.0, fleshPressSlope.y)));
}
#endif
vec3 fleshSigmaX = normalize(dFdx(-vViewPosition));
vec3 fleshSigmaY = normalize(dFdy(-vViewPosition));
vec3 fleshR1 = cross(fleshSigmaY, normal);
vec3 fleshR2 = cross(normal, fleshSigmaX);
float fleshDet = dot(fleshSigmaX, fleshR1) * faceDirection;
normal = normalize(abs(fleshDet) * normal - sign(fleshDet) * 0.22 * (dFdx(fleshVein) * fleshR1 + dFdy(fleshVein) * fleshR2));
`;

const FLESH_GLOW = /* glsl */ `
float fleshRim = pow3(1.0 - saturate(dot(normal, normalize(vViewPosition))));
totalEmissiveRadiance += vFlesh.z * (${glc(COLORS.rimGlow)} * fleshRim * (0.75 + 0.7 * vFlesh.x)
  + ${glc(COLORS.veinGlow)} * fleshVein * (0.004 + 0.5 * vFlesh.x * vFlesh.x));
`;

function fleshFragment(shader: WebGLProgramParametersWithUniforms, wall: boolean): void {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${wall ? `#define FLESH_WALL\nvarying vec2 vWallAt;\n${PRESS_GLSL}` : ''}\n${FLESH_FRAGMENT_PARS}`)
    .replace('#include <map_fragment>', `#include <map_fragment>\n${FLESH_ALBEDO}`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FLESH_WET}`)
    .replace('#include <normal_fragment_maps>', FLESH_NORMAL)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FLESH_GLOW}`)
    .replace(...IN_THE_ROOM);
}

/** The ball of an eye: painted in its own frame, the pupil at +z. */
const EYE_VERTEX_PARS = /* glsl */ `
attribute vec4 aLook;
attribute vec3 aEye;
varying vec3 vBall;
varying vec3 vLid;
varying vec4 vEye;
${PULSE_GLSL}
`;

const EYE_VERTEX_NORMAL = /* glsl */ `
vec3 eyeZ = aLook.xyz;
vec3 eyeX = normalize(cross(vec3(0.0, 1.0, 0.0), eyeZ));
mat3 eyeTurn = mat3(eyeX, cross(eyeZ, eyeX), eyeZ);
vec3 objectNormal = eyeTurn * normal;
vBall = position;
vLid = eyeTurn * position;
vEye = vec4(aEye, aLook.w);
`;

const EYE_VERTEX_PLACE = /* glsl */ `
vec3 transformed = eyeTurn * position;
transformed.z += fleshSwell(instanceMatrix[3].xyz, fleshBeat(instanceMatrix[3].z)) / length(instanceMatrix[0].xyz);
`;

const EYE_FRAGMENT_PARS = /* glsl */ `
varying vec3 vBall;
varying vec3 vLid;
varying vec4 vEye; // how wide open, pupil, seed, blink
${LID_GLSL}
`;

const EYE_PAINT = /* glsl */ `
float eyeSeed = vEye.z;
float eyeQ = acos(clamp(normalize(vBall).z, -1.0, 1.0));
float eyeA = atan(vBall.y, vBall.x);
float eyeIrisR = 0.5;
float eyePupilR = vEye.y;
// the white: yellowed, darker toward the corners, full of veins that stop before the iris
vec3 eyeWet = vBall * 4.6 + eyeSeed * 17.0;
float eyeLine = sin(eyeWet.x * 2.1 + 1.6 * sin(eyeWet.y * 3.3 + eyeWet.z * 1.7));
float eyeLine2 = sin(eyeWet.y * 3.9 + 1.9 * sin(eyeWet.z * 2.9 + eyeWet.x * 2.3));
float eyeVeins = 1.0 - smoothstep(0.0, 0.13, abs(eyeLine)) + 0.6 * (1.0 - smoothstep(0.0, 0.09, abs(eyeLine2)));
eyeVeins *= smoothstep(eyeIrisR + 0.03, eyeIrisR + 0.55, eyeQ);
vec3 eyeC = mix(${glc(COLORS.sclera)}, ${glc(COLORS.sclera)} * vec3(0.72, 0.52, 0.42), smoothstep(0.6, 1.5, eyeQ));
eyeC = mix(eyeC, ${glc(COLORS.scleraVein)}, saturate(eyeVeins) * 0.85);
// the iris: fibres running from the pupil, the color of each eye its own, a dark ring around
vec3 eyeIris = eyeSeed < 0.55 ? vec3(0.28, 0.36, 0.4) : eyeSeed < 0.8 ? vec3(0.46, 0.27, 0.05) : eyeSeed < 0.92 ? vec3(0.62, 0.62, 0.56) : vec3(0.34, 0.015, 0.015);
float eyeFibre = 0.5 + 0.5 * sin(eyeA * 37.0 + eyeSeed * 11.0 + 2.0 * sin(eyeA * 11.0 + eyeSeed * 5.0)) * sin(eyeA * 61.0 + eyeQ * 9.0);
eyeIris *= 0.42 + 0.95 * eyeFibre;
eyeIris *= 0.55 + 0.75 * smoothstep(eyePupilR, eyeIrisR, eyeQ) * (1.0 - smoothstep(eyeIrisR - 0.14, eyeIrisR, eyeQ));
float eyeInIris = 1.0 - smoothstep(eyeIrisR - 0.012, eyeIrisR + 0.012, eyeQ);
eyeC = mix(eyeC, eyeIris, eyeInIris);
eyeC *= 0.28 + 0.72 * smoothstep(0.0, 0.05, abs(eyeQ - eyeIrisR));
float eyeInPupil = 1.0 - smoothstep(eyePupilR - 0.012, eyePupilR + 0.012, eyeQ);
// a blind one has a milky pupil
eyeC = mix(eyeC, eyeSeed >= 0.8 && eyeSeed < 0.92 ? vec3(0.52, 0.54, 0.5) : vec3(0.004), eyeInPupil);
// what the lids shade
float eyeS = atan(vLid.x, vLid.z) / ${glf(LID_LONGITUDE)};
float eyeLat = asin(clamp(normalize(vLid).y, -1.0, 1.0));
float eyeOpening = min(lidUpper(eyeS, vEye.x, vEye.w) - eyeLat, eyeLat - lidLower(eyeS, vEye.x, vEye.w));
float eyeShade = smoothstep(-0.02, 0.3, eyeOpening);
diffuseColor.rgb = eyeC * (0.12 + 0.88 * eyeShade);
`;

const EYE_WET = /* glsl */ `
roughnessFactor = mix(0.17, 0.05, eyeInIris);
`;

const EYE_GLOW = /* glsl */ `
float eyeFacing = saturate(dot(normal, normalize(vViewPosition)));
totalEmissiveRadiance += vec3(1.0, 0.42, 0.2) * ${glf(EYES.shine)} * eyeInPupil * eyeFacing * eyeFacing * eyeFacing * eyeShade * step(eyeSeed, 0.92) * smoothstep(${glf(EYES.shineFrom[0])}, ${glf(EYES.shineFrom[1])}, length(vViewPosition));
`;

/** How deep a point of a body is in the wall, for what stains it. */
const SUNK_GLSL = /* glsl */ `
float fleshSunk(vec3 p, float from, float to) {
  float dz = (p.z - ${glf(HEART.z)}) / ${glf(HEART.widenLength)};
  float wall = ${glf(TUBE_R)} + ${glf(HEART.widenTo - TUBE_R)} * exp(-dz * dz);
  float r = length(p.xy - vec2(0.0, ${glf(AXIS_Y)}));
  return smoothstep(from, to, r - wall + 0.05 * sin(p.y * 11.0 + p.z * 7.0) + 0.04 * sin(p.x * 17.0 - p.z * 13.0));
}
`;

/** Bones and threads ride the wall by the same swell. */
const RIDE_VERTEX = /* glsl */ `
#include <begin_vertex>
vec2 rideOut = position.xy - vec2(0.0, ${glf(AXIS_Y)});
rideOut /= max(length(rideOut), 0.001);
transformed.xy -= rideOut * fleshSwell(position, fleshBeat(position.z));
`;

/** A material with its own shaders: its program must not be shared by the text of the hook alone. */
function hooked(material: MeshStandardMaterial, key: string, hook: (shader: WebGLProgramParametersWithUniforms) => void): MeshStandardMaterial {
  material.onBeforeCompile = hook;
  material.customProgramCacheKey = () => `flesh-${key}`;
  return material;
}

/** A frame with +y along `yAxis` and +z along `facing` as nearly as that allows. */
function frameOf(facing: Vector3, yAxis: Vector3, out: Matrix4): Matrix4 {
  v2.copy(yAxis).normalize();
  v3.copy(facing).addScaledVector(v2, -facing.dot(v2)).normalize();
  v1.crossVectors(v2, v3);
  return out.makeBasis(v1, v2, v3);
}

/** Pale branching veins on a canvas, seamless, in its red channel: bright, then fine. */
function drawVeins(seed: number): HTMLCanvasElement {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const r = randomFrom(seed);
  const widths = [3.4, 2.4, 1.7, 1.2, 0.8];
  const paths = widths.map(() => new Path2D());
  const grow = (x0: number, y0: number, dir: number, level: number, length: number) => {
    let x = x0;
    let y = y0;
    let a = dir;
    let turn = 0;
    const path = paths[level];
    path.moveTo(x, y);
    for (let s = 0; s < length; s++) {
      // a vessel bends, it does not zigzag
      turn = turn * 0.72 + (r() - 0.5) * 0.3;
      a += turn;
      x += Math.cos(a) * 11;
      y += Math.sin(a) * 11;
      path.lineTo(x, y);
      if (level < widths.length - 1 && r() < 0.13) {
        const off = (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.7);
        grow(x, y, a + off, level + 1, Math.round(length * (0.35 + r() * 0.3)));
        path.moveTo(x, y);
      }
    }
  };
  for (let n = 0; n < 15; n++) grow(r() * size, r() * size, r() * TAU, 0, 26 + Math.round(r() * 20));
  ctx.strokeStyle = '#fff';
  widths.forEach((w, level) => {
    ctx.lineWidth = w;
    ctx.globalAlpha = 0.6 + 0.4 * (1 - level / widths.length);
    for (let ox = -size; ox <= size; ox += size) {
      for (let oy = -size; oy <= size; oy += size) {
        ctx.setTransform(1, 0, 0, 1, ox, oy);
        ctx.stroke(paths[level]);
      }
    }
  });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  return canvas;
}

/** Angles of the wall's columns: finer along the tracks of what presses from behind. */
function columnAngles(count: number): Float32Array {
  const steps = 720;
  const weights = new Float32Array(steps);
  let total = 0;
  for (let i = 0; i < steps; i++) {
    const deg = ((i + 0.5) / steps) * 360 - 90;
    let w = 1;
    for (const [a, b] of WALL.tracks) w = Math.max(w, 1 + (WALL.density - 1) * ease(a - 12, a, deg) * (1 - ease(b, b + 12, deg)));
    weights[i] = w;
    total += w;
  }
  const out = new Float32Array(count + 1);
  let sum = 0;
  let k = 0;
  for (let i = 0; i < steps && k <= count; i++) {
    const next = sum + weights[i];
    while (k <= count && (k / count) * total <= next) {
      const f = ((k / count) * total - sum) / weights[i];
      out[k++] = (((i + f) / steps) * 360 - 90) * DEG;
    }
    sum = next;
  }
  while (k <= count) out[k++] = 1.5 * Math.PI;
  return out;
}

interface PoolLight {
  light: DreamLight;
  base: number;
  z: number;
  ahead: number;
  behind: number;
}

interface PlannedEye {
  z: number;
  a: number;
  s: number;
  roll: number;
  open: number;
}

interface PlannedArm {
  z: number;
  theta: number;
  size: number;
  /** Where it reaches, as jitter around out-of-the-wall-and-toward-the-one-who-comes. */
  jx: number;
  jy: number;
  jz: number;
}

interface Arm {
  base: Vector3;
  rest: Vector3;
  dir: Vector3;
  palm: Vector3;
  size: number;
}

/**
 * VI. Et. A throat: one wall of meat from the darkroom's end to the back of the mouth, breathing, with a
 * heart hung in it. Everything sunk in the wall asks WallShape where the wall is; everything that moves
 * is a function of the eye's place or of the heart, so going back undoes it.
 */
export class FleshTunnel implements DreamModule {
  readonly root = new Group();
  readonly span = [LAYOUT.flesh.from, -190] as const;
  readonly region = 'flesh' as const;

  private readonly lampPosition: [number, number, number] = [0, 2, -150];
  private readonly lampTarget: [number, number, number] = [0, 2, -156];
  private readonly lamp: SpotSpec = {
    position: this.lampPosition,
    target: this.lampTarget,
    color: LAMP.color,
    intensity: LAMP.intensity,
    angle: LAMP.angle,
    penumbra: LAMP.penumbra,
  };
  readonly spots: readonly (SpotSpec | null)[] = [null, this.lamp, null];

  /** Shared by every program of the chapter. */
  private readonly u = {
    uFleshTime: { value: 0 },
    uBeat: { value: new Vector2(0, 3) },
    uSwell: { value: new Vector2(PULSE.swell * MOTION, PULSE.breath * MOTION) },
    uPress: { value: new Float32Array(16) },
    uJaw: { value: new Vector2() },
    uRim: { value: COLLAR.pursed as number },
    uHeart: { value: 0 },
    uHeartJolt: { value: new Vector3() },
    tSmear: { value: null as Texture | null },
    tSmearN: { value: null as Texture | null },
    tPit: { value: null as Texture | null },
    tPitN: { value: null as Texture | null },
    tVeins: { value: null as Texture | null },
    tHeartN: { value: null as Texture | null },
    tHeartC: { value: null as Texture | null },
  };

  private readonly upperJaw = new Group();
  private readonly lowerJaw = new Group();
  private readonly heart = new Group();
  private readonly fleshBase: MeshStandardMaterial;
  private readonly looseFlesh: MeshStandardMaterial;
  private readonly toothMaterial: MeshStandardMaterial;
  private readonly wall: WallShape;
  private readonly poolLights: PoolLight[] = [];

  private plannedEyes: PlannedEye[] = [];
  private plannedArms: PlannedArm[] = [];
  private readonly canine: BufferGeometry;

  private readonly eyeCount: number;
  private readonly eyeCenters: Vector3[] = [];
  private readonly eyeFrames: Matrix4[] = [];
  private readonly eyeSizes: number[] = [];
  private readonly lookAttribute: InstancedBufferAttribute;
  private readonly lookTargets: Float32Array;
  private readonly lookNext: Float32Array;
  private readonly blinkAt: Float32Array;
  private readonly blinkT: Float32Array;
  private readonly restSeed = randomFrom(9091);

  private readonly arms: Arm[] = [];
  private readonly armCrowd: PropCrowd;

  private clock = 0;
  private beats = 0;
  private sinceBeat = 0;
  private lastHeartbeat = 0;
  private heartLevel = 0;
  private jaw = 0;
  private slam = -1;
  private slamFrom = 1;
  private lastEyeZ = 0;

  constructor(kit: DreamKit) {
    this.root.name = 'FleshTunnel';

    const smear = kit.assets.materials.get('flesh_smeared');
    const pit = kit.assets.materials.get('flesh_pitted');
    const fibre = kit.assets.materials.get('flesh_fibre');
    if (!smear || !pit || !fibre) throw new Error('flesh materials not loaded');
    this.u.tSmear.value = smear.map;
    this.u.tSmearN.value = smear.normalMap;
    this.u.tPit.value = pit.map;
    this.u.tPitN.value = pit.normalMap;
    this.u.tHeartN.value = fibre.normalMap;
    this.u.tHeartC.value = fibre.map;
    const veins = new CanvasTexture(drawVeins(611));
    veins.wrapS = veins.wrapT = RepeatWrapping;
    veins.anisotropy = 4;
    this.u.tVeins.value = veins;

    this.fleshBase = kit.surface('flesh_fibre', TILE.fibre);
    this.fleshBase.aoMap = null;
    this.fleshBase.roughnessMap = null;
    this.fleshBase.normalScale.setScalar(1.5);
    this.looseFlesh = this.flesh('loose', false, LOOSE_VERTEX_PARS, [['#include <begin_vertex>', LOOSE_VERTEX_PLACE]]);

    this.toothMaterial = this.makeToothMaterial(kit);
    // a loose tooth: its tip at y = 1
    this.canine = this.stained(toothGeometry(), new Matrix4(), (y) => 1 - y);
    const arch = this.buildJaws(kit);
    this.wall = new WallShape(arch);
    this.planEyes();
    this.planArms();
    for (const [z, deg] of BODIES) this.wall.addMound(deg * DEG, z, 1.15, 0.17);
    this.root.add(this.buildWall(arch));
    this.root.add(this.buildRibs(kit));
    this.root.add(this.buildLoose());
    this.root.add(this.buildSkins());
    this.root.add(...this.buildEyes());
    this.buildHeart(kit);
    this.armCrowd = this.buildArms(kit);
    this.buildSkulls(kit);
    this.buildBodies(kit);
    this.root.add(this.buildHair());
    this.root.add(this.buildThreads(arch));
    this.buildExtraTeeth(arch);
    this.root.add(this.upperJaw, this.lowerJaw, this.heart);

    for (const l of LIGHTS) {
      this.poolLights.push({ light: kit.lights.add(l.at, l.color, l.intensity, l.reach), base: l.intensity, z: l.at[2], ahead: l.ahead, behind: l.behind });
    }

    const biggest = this.eyeSizes.indexOf(Math.max(...this.eyeSizes));
    kit.poi({ position: this.eyeCenters[biggest].clone(), radius: EYES.poi.radius, zoom: EYES.poi.zoom, reach: EYES.poi.reach });
    kit.poi({ position: new Vector3(0, BITE_Y, MOUTH.frontUpper), radius: 11, zoom: 0.78, reach: 22 });

    this.eyeCount = this.plannedEyes.length;
    this.lookAttribute = (this.root.getObjectByName('EyeBalls') as InstancedMesh).geometry.getAttribute('aLook') as InstancedBufferAttribute;
    this.lookTargets = new Float32Array(this.eyeCount * 3);
    this.lookNext = new Float32Array(this.eyeCount);
    this.blinkAt = new Float32Array(this.eyeCount);
    this.blinkT = new Float32Array(this.eyeCount);
    this.reset();
  }

  // ------------------------------------------------------------------ building

  /** A material for flesh with its own vertex shader. */
  private flesh(key: string, double: boolean, pars: string, hooks: readonly (readonly [string, string])[]): MeshStandardMaterial {
    const m = this.fleshBase.clone();
    if (double) m.side = DoubleSide;
    return hooked(m, `${key}-${double}`, (shader) => {
      Object.assign(shader.uniforms, this.u);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${pars}`);
      for (const [from, to] of hooks) shader.vertexShader = shader.vertexShader.replace(from, to);
      fleshFragment(shader, key === 'wall');
    });
  }

  /** The two arches in place, the mouth shut; what they bite is measured from them. */
  private buildJaws(kit: DreamKit): ArchPlan {
    const plan: number[] = [];
    let back = 0;
    const place = (key: string, anchor: 'bottom' | 'top', y: number, frontZ: number, parent: Group) => {
      const o = kit.prop(key, [0, y, 0], { scale: MOUTH.scale, rotation: [0, MOUTH.heading, 0], anchor }, parent);
      const box = new Box3().setFromObject(o);
      o.position.z += frontZ - box.min.z;
      back = Math.min(back, o.position.z + (box.max.z - box.min.z) / 2);
      o.updateMatrixWorld(true);
      o.traverse((c) => {
        const mesh = c as Mesh;
        if (!mesh.isMesh) return;
        if (!/Default/.test((mesh.material as MeshStandardMaterial).name)) {
          this.gumStrip(mesh);
          return;
        }
        const g = creased(mesh.geometry, 42);
        const p = g.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          v1.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
          plan.push(v1.x, v1.z);
        }
        mesh.geometry = this.stained(g, mesh.matrixWorld, (y) => Math.abs(y - BITE_Y));
        mesh.material = this.toothMaterial;
      });
    };
    place('teeth_upper', 'bottom', BITE_Y - MOUTH.overlap, MOUTH.frontUpper, this.upperJaw);
    place('teeth_lower', 'top', BITE_Y + MOUTH.overlap, MOUTH.frontLower, this.lowerJaw);
    return new ArchPlan(plan, Math.min(MOUTH.frontUpper, MOUTH.frontLower), back);
  }

  /** The scan's gum is a thin strip behind the teeth: it only has to be the same wet meat as the wall. */
  private gumStrip(mesh: Mesh): void {
    const g = creased(mesh.geometry, 70);
    const p = g.getAttribute('position');
    const uv = new Float32Array(p.count * 2);
    const tissue = new Float32Array(p.count * 4);
    const place = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++) {
      v1.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      uv[i * 2] = v1.x - v1.z * 0.7;
      uv[i * 2 + 1] = v1.y;
      tissue[i * 4] = 0.75;
      tissue[i * 4 + 1] = 0.1;
      tissue[i * 4 + 2] = 0.25;
      tissue[i * 4 + 3] = 0.5;
      place[i * 4 + 2] = 1;
      place[i * 4 + 3] = 1;
    }
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setAttribute('aTissue', new Float32BufferAttribute(tissue, 4));
    g.setAttribute('aPlace', new Float32BufferAttribute(place, 4));
    mesh.geometry = g;
    mesh.material = this.looseFlesh;
  }

  /** Wet enamel: the color is baked per vertex (see `stained`), the pitted surface only stains and pocks it, in long streaks. */
  private makeToothMaterial(kit: DreamKit): MeshStandardMaterial {
    const m = kit.surface('flesh_pitted', 1.2, { vertexColors: true });
    m.aoMap = null;
    m.roughnessMap = null;
    m.normalScale.setScalar(0.4);
    return hooked(m, 'tooth', (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          `float toothDirt = 1.0 - smoothstep(0.1, 0.3, texture2D(map, vMapUv).g);`,
        )
        .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb *= 1.06 - 0.68 * toothDirt;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = 0.2 + 0.24 * toothDirt;`);
    });
  }

  /** Each tooth its own age, brown toward the gum, here and there rotten; and meters for the stains, long along the tooth. */
  private stained(g: BufferGeometry, toWorld: Matrix4, fromTip: (y: number) => number): BufferGeometry {
    const p = g.getAttribute('position');
    const colors = new Float32Array(p.count * 3);
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      v1.fromBufferAttribute(p, i).applyMatrix4(toWorld);
      uv[i * 2] = v1.x + v1.z * 0.7;
      uv[i * 2 + 1] = v1.y * 0.3;
      const age = fbm(v1.x * 0.6 + 7, v1.y * 0.25, v1.z * 0.6, 2);
      const blotch = fbm(v1.x * 2.3, v1.y * 2.3, v1.z * 2.3, 2);
      const neck = ease(0.22, 0.9, fromTip(v1.y));
      const rot = ease(0.3, 0.55, blotch + age * 0.35);
      const wet = 0.78 + 0.22 * noise(v1.x * 5, v1.y * 5, v1.z * 5);
      const r = lerp(lerp(0.62, 0.24, neck) + age * 0.12, 0.05, rot * 0.86);
      const gr = lerp(lerp(0.5, 0.115, neck) + age * 0.1, 0.025, rot * 0.86);
      const b = lerp(lerp(0.3, 0.035, neck) + age * 0.05, 0.015, rot * 0.86);
      colors[i * 3] = r * wet;
      colors[i * 3 + 1] = gr * wet;
      colors[i * 3 + 2] = b * wet;
    }
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    return g;
  }

  /** Where the eyes will be: they raise the wall around them, so this comes before the wall is built. */
  private planEyes(): void {
    const r = randomFrom(2207);
    const eyes: PlannedEye[] = [];
    const clashes = (z: number, a: number, s: number) =>
      eyes.some((e) => Math.hypot(e.z - z, wrapAngle((e.a - a) * DEG) * TUBE_R) < 2.3 * (e.s + s) + 0.3) ||
      this.wall.ribs.some((rib) => Math.abs(rib - z) < 0.22 + s) ||
      BODIES.some(([bz, ba]) => Math.hypot(bz - z, wrapAngle((ba - a) * DEG) * TUBE_R) < 1.2 + s);
    for (const [z, a, s, roll, open] of EYES.named) eyes.push({ z, a, s, roll, open });
    let guard = 0;
    while (eyes.length < EYES.count && guard++ < 4000) {
      // small ones gather around the large
      const near = r() < 0.55 ? eyes[Math.floor(r() * EYES.named.length)] : null;
      const z = near ? near.z + (r() - 0.5) * 3.4 : lerp(-152, -177, r());
      const a = near ? near.a + (r() - 0.5) * 46 : lerp(-28, 208, r());
      const s = lerp(EYES.small[0], EYES.small[1], r() ** 1.6);
      if (z > -151.8 || z < -177 || a < -32 || a > 212 || clashes(z, a, s)) continue;
      const vertical = r() < 0.16;
      eyes.push({ z, a, s, roll: vertical ? 82 + r() * 16 : (r() - 0.5) * 40, open: lerp(0.55, 1.3, r()) });
    }
    this.plannedEyes = eyes;
    for (const e of eyes) this.wall.addMound(e.a * DEG, e.z, e.s * EYES.moundReach, e.s * EYES.mound);
  }

  /** Where the arms come out: the wall gathers around each, so this too comes before the wall is built. */
  private planArms(): void {
    const r = randomFrom(1313);
    let guard = 0;
    let aroundZ = 0;
    let aroundTheta = 0;
    while (this.plannedArms.length < ARMS.count && guard++ < 3000) {
      const n = this.plannedArms.length;
      if (n % ARMS.thicket === 0) {
        aroundZ = lerp(-153, -176, (n + r() * ARMS.thicket) / ARMS.count);
        aroundTheta = lerp(-24, 204, r()) * DEG;
      }
      const z = aroundZ + (r() - 0.5) * 2 * ARMS.spreadAt;
      const theta = aroundTheta + ((r() - 0.5) * 2 * ARMS.spreadAt) / TUBE_R;
      const size = ARMS.scale + ARMS.spread * (r() - 0.5) * 2;
      const jx = (r() - 0.5) * 0.34;
      const jy = (r() - 0.5) * 0.34;
      const jz = (r() - 0.5) * 0.3;
      if (BODIES.some(([bz, ba]) => Math.hypot(bz - z, wrapAngle(ba * DEG - theta) * TUBE_R) < 1.3)) continue;
      if (this.plannedEyes.some((e) => Math.hypot(e.z - z, wrapAngle(e.a * DEG - theta) * TUBE_R) < e.s * 2.2 + 0.45)) continue;
      this.plannedArms.push({ z, theta, size, jx, jy, jz });
      this.wall.addMound(theta, z, 0.42, 0.13);
    }
  }

  /** The whole inside of the throat as one sheet: collar, ring, tube, mouth, lips, and the wall around the lips. */
  private buildWall(arch: ArchPlan): Mesh {
    const cols = WALL.columns + 1;
    const angles = columnAngles(WALL.columns);
    const collar = COLLAR.profile.length;
    const tubeRows = Math.ceil((COLLAR.tubeFrom - MOUTH.frontUpper) / WALL.rowStep) + 1;
    const rows = collar + tubeRows + MOUTH.lips.length;
    const b = new MeshBuilder({ aTissue: 4, aPlace: 4 });
    const wall = this.wall;
    const info = { jaw: 0, rim: 0, glow: 1, gum: 0 };
    const place = (i: number, theta: number, out: Vector3) => {
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      if (i < collar) {
        const [r0, z0] = COLLAR.profile[i];
        const pleat = Math.abs(Math.sin(COLLAR.pleats * theta + 0.8 * Math.sin(3 * theta) + 0.4 * Math.sin(7 * theta))) - 0.5;
        const near = 1 - ease(2.3, 3.8, r0);
        const far = ease(2.8, 5, r0);
        let r = r0 + near * COLLAR.pleatDepth * pleat + far * 0.3 * fbm(c * 2 + 13, s * 2, z0 * 0.4);
        const z = z0 + near * COLLAR.pleatDepth * 0.55 * pleat + (0.3 + far) * 0.22 * fbm(c * 3.1 + 31, s * 3.1, r0 * 0.5);
        // the last rings already belong to the tube
        const k = ease(-150.75, -151.55, z0);
        if (k > 0) r = lerp(r, wall.at(theta, COLLAR.tubeFrom), k);
        out.set(r * c, AXIS_Y + r * s, z);
        info.jaw = 0;
        info.rim = (1 - ease(2.6, 4.5, r0)) * (1 - ease(-150.6, -152, z0));
        info.glow = 1 - ease(3.4, 6.5, r0);
        info.gum = 0.22 * near;
        return;
      }
      if (i < collar + tubeRows) {
        const z = COLLAR.tubeFrom + ((i - collar) / (tubeRows - 1)) * (MOUTH.frontUpper - COLLAR.tubeFrom);
        const r = wall.at(theta, z);
        out.set(r * c, AXIS_Y + r * s, z);
        const share = WallShape.mouthShare(z);
        info.jaw = (ease(BITE_Y + 0.1, BITE_Y + 0.55, out.y) - (1 - ease(BITE_Y - 0.55, BITE_Y - 0.1, out.y))) * share;
        // the mouth is mostly seen open: that is the shape its normals and its texture are made for
        out.y += info.jaw * MOUTH.opening;
        info.rim = 0.6 * (1 - ease(-150.8, -152.8, z));
        info.glow = 1;
        info.gum = share * (0.45 + 0.55 * (1 - ease(0.1, 1.5, Math.abs(arch.distance(out.x, z)))));
        return;
      }
      const [a, h, z0] = MOUTH.lips[i - collar - tubeRows];
      const center = lerp(BITE_Y, AXIS_Y, ease(4, 8, a));
      const lip = 1 - ease(3.4, 5.2, a);
      const crease = Math.sin(theta * 34 + 2 * Math.sin(theta * 5)) * (1 - ease(0.15, 0.5, Math.abs(z0 + 188.1)));
      const lump = ease(4.2, 7, a) * 0.42 * fbm(c * 1.9 + 53, s * 1.9, z0 * 0.2);
      const rh = h + lump;
      out.set((a + lump) * c, center + rh * s, z0 + lip * 0.045 * crease + ease(4.2, 7, a) * 0.3 * fbm(c * 2.7 + 71, s * 2.7, a * 0.3));
      info.jaw = clamp((out.y - BITE_Y) / (rh * 0.62), -1, 1) * (1 - ease(4.4, 8.4, a));
      info.rim = 0;
      info.glow = 1 - ease(3.8, 6.2, a);
      info.gum = 0.9 * (1 - ease(4, 6, a));
    };
    // how long the sheet is up to each row, for the texture
    const lengthAlong = new Float32Array(rows);
    const probe = new Vector3();
    const last = new Vector3();
    for (let i = 0; i < rows; i++) {
      place(i, Math.PI / 2, probe);
      lengthAlong[i] = i === 0 ? 0 : lengthAlong[i - 1] + probe.distanceTo(last);
      last.copy(probe);
    }
    b.grid(rows, cols, true, false, (i, j, out) => {
      place(i, j === cols - 1 ? angles[0] : angles[j], out.p);
      const { x, y, z } = out.p;
      // the fibres flow: the coordinates wander (the way around is added below, by length along each ring)
      out.u = 0.62 * noise(x * 0.31 + 3, y * 0.31, z * 0.27);
      out.v = lengthAlong[i] + 0.62 * noise(x * 0.33 + 19, y * 0.33, z * 0.29);
      const tissue = out.extra.aTissue;
      tissue[0] = 0.5 + 0.9 * fbm(x * 0.38 + 11, y * 0.38, z * 0.31);
      // fat lies in streaks across the fibres, not in lakes
      tissue[1] = 0.26 + 0.85 * fbm(x * 0.85 + 37, y * 0.85, z * 1.5, 2);
      tissue[2] = ease(0.05, 0.55, fbm(x * 0.28 + 73, y * 0.28, z * 0.17));
      tissue[3] = 0.5;
      const at = out.extra.aPlace;
      at[0] = info.jaw;
      at[1] = info.rim;
      at[2] = info.glow;
      at[3] = info.gum;
    });
    const g = b.build();
    this.bakeRelief(g, rows, cols);
    this.evenAround(g, rows, cols);
    // the tube's rings were made open: what is stored is the mouth shut
    const p = g.getAttribute('position');
    const jaw = g.getAttribute('aPlace');
    for (let k = collar * cols; k < (collar + tubeRows) * cols; k++) p.setY(k, p.getY(k) - jaw.getX(k) * MOUTH.opening);
    const mesh = new Mesh(
      g,
      this.flesh('wall', false, WALL_VERTEX_PARS, [
        ['#include <beginnormal_vertex>', WALL_VERTEX_NORMAL],
        ['#include <begin_vertex>', WALL_VERTEX_PLACE],
      ]),
    );
    mesh.name = 'Gullet';
    return mesh;
  }

  /** Texture around each ring by its own length, so that no stretch of wall gets more of it than another. */
  private evenAround(g: BufferGeometry, rows: number, cols: number): void {
    const p = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const along = new Float32Array(cols);
    for (let i = 0; i < rows; i++) {
      for (let j = 1; j < cols; j++) {
        const k = i * cols + j;
        along[j] = along[j - 1] + Math.hypot(p.getX(k) - p.getX(k - 1), p.getY(k) - p.getY(k - 1), p.getZ(k) - p.getZ(k - 1));
      }
      for (let j = 0; j < cols; j++) uv.setX(i * cols + j, uv.getX(i * cols + j) + (along[j] / along[cols - 1]) * WALL.wrap);
    }
  }

  /** How far each vertex stands out of its neighbourhood: crests go pale, valleys dark and wet. */
  private bakeRelief(g: BufferGeometry, rows: number, cols: number): void {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const t = g.getAttribute('aTissue');
    const unique = cols - 1;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        let mx = 0;
        let my = 0;
        let mz = 0;
        let count = 0;
        for (const di of [-5, -2, 2, 5]) {
          const ii = i + di;
          if (ii < 0 || ii >= rows) continue;
          const k = ii * cols + (j % unique);
          mx += p.getX(k);
          my += p.getY(k);
          mz += p.getZ(k);
          count++;
        }
        for (const dj of [-3, 3, -7, 7]) {
          const k = i * cols + ((j + dj + unique) % unique);
          mx += p.getX(k);
          my += p.getY(k);
          mz += p.getZ(k);
          count++;
        }
        const k = i * cols + j;
        const h = (p.getX(k) - mx / count) * n.getX(k) + (p.getY(k) - my / count) * n.getY(k) + (p.getZ(k) - mz / count) * n.getZ(k);
        t.setW(k, clamp(0.5 + h * 3.2, 0, 1));
      }
    }
  }

  /** Bones merged into one draw: each follows its own stretch of wall exactly, so none could share a shape. */
  private buildRibs(kit: DreamKit): Mesh {
    const b = new MeshBuilder({ aRoot: 1 });
    const r = randomFrom(733);
    const [from, to] = RIBS.arc;
    for (const z of this.wall.ribs) {
      const j0 = (r() - 0.5) * 14;
      const j1 = (r() - 0.5) * 14;
      const fate = r();
      if (fate < 0.5) {
        this.rib(b, r, z, from + j0, to + j1, 'bury', 'bury');
      } else if (fate < 0.7) {
        const gap = 64 + r() * 34;
        this.rib(b, r, z, from + j0, gap, 'bury', 'break');
        this.rib(b, r, z, gap + 24 + r() * 30, to + j1, 'knob', 'bury');
      } else if (fate < 0.85) {
        const gap = 8 + r() * 30;
        this.rib(b, r, z, from + j0, gap, 'bury', 'knob');
        this.rib(b, r, z, gap + 18 + r() * 20, to + j1, 'break', 'bury');
      } else {
        const gap = 120 + r() * 40;
        this.rib(b, r, z, from + j0, gap, 'bury', 'break');
        this.rib(b, r, z, gap + 26 + r() * 20, to + j1, 'break', 'bury');
      }
    }
    // old bone: the stains of the pitted surface over ivory, and its pores
    const bone = kit.surface('flesh_pitted', 0.9, { roughness: 0.42 });
    bone.aoMap = null;
    bone.roughnessMap = null;
    bone.normalScale.setScalar(0.8);
    const material = hooked(bone, 'rib', (shader) => {
      Object.assign(shader.uniforms, this.u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute float aRoot;\nvarying float vRoot;\n${PULSE_GLSL}`)
        .replace('#include <begin_vertex>', `${RIDE_VERTEX}\nvRoot = aRoot;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vRoot;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float boneMeat = smoothstep(0.34, 0.74, vRoot + (0.42 - diffuseColor.r) * 1.2);
          vec3 boneC = ${glc(COLORS.bone)} * (0.14 + 1.6 * diffuseColor.r);
          diffuseColor.rgb = mix(boneC, ${glc(COLORS.boneRoot)}, boneMeat);`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.3, 0.13, boneMeat);');
    });
    const mesh = new Mesh(b.build(), material);
    mesh.name = 'Ribs';
    return mesh;
  }

  private rib(b: MeshBuilder, r: () => number, z: number, fromDeg: number, toDeg: number, startEnd: 'bury' | 'knob' | 'break', endEnd: 'bury' | 'knob' | 'break'): void {
    const a0 = fromDeg * DEG;
    const a1 = toDeg * DEG;
    const length = Math.abs(a1 - a0) * TUBE_R;
    const rows = Math.max(6, Math.ceil(length / RIBS.step));
    const sides = 8;
    const seed = r() * 100;
    const big = 1 + (RIBS.aroundHeart - 1) * gauss(z, HEART.z, 5);
    const end = (kind: 'bury' | 'knob' | 'break', away: number) => {
      // away: meters from that end of the bone
      if (kind === 'bury') return { scale: lerp(0.55, 1, ease(0, 0.5, away)), deep: 0.24 * (1 - ease(0, 1.2, away)), spike: 0 };
      if (kind === 'knob') return { scale: away < 0.04 ? 0.25 : 1 + 0.65 * gauss(away, 0.17, 0.16), deep: 0, spike: 0 };
      return { scale: lerp(0.3, 1, ease(0, 0.55, away)), deep: -0.26 * (1 - ease(0, 0.9, away)), spike: 1 - ease(0, 0.5, away) };
    };
    b.grid(rows + 1, sides + 1, true, true, (i, j, out) => {
      // rings gather toward the ends, where the shape is
      const t = lerp(i / rows, 0.5 - 0.5 * Math.cos((Math.PI * i) / rows), 0.5);
      const theta = lerp(a0, a1, t);
      const dz = z + 0.22 * Math.sin(theta * 1.3 + seed) + 0.06 * Math.sin(theta * 4.1 + seed * 2);
      const psi = ((j % sides) / sides) * TAU;
      const near = end(startEnd, t * length);
      const far = end(endEnd, (1 - t) * length);
      const bump = 1 + 0.2 * noise(theta * 3.1 + seed, 0, seed) + 0.14 * noise(theta * 11 + seed, 3, seed);
      const scale = near.scale * far.scale * bump * big;
      const spike = Math.max(near.spike, far.spike) * (0.45 * Math.sin(psi * 3 + seed) + 0.3 * Math.sin(psi * 5 + seed * 3));
      // its middle lies in the surface, so that the meat meets its sides steeply; here and there meat has grown over it
      const under = noise(theta * 1.7 + seed, 7, seed);
      const embed = -0.015 + 0.17 * ease(0.12, 0.7, under) + near.deep + far.deep;
      const R = this.wall.at(theta, dz) + embed;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const radial = RIBS.thickness * scale * (1 + spike) * Math.cos(psi);
      const along = RIBS.width * scale * (1 + spike) * Math.sin(psi);
      out.p.set((R + radial) * c, AXIS_Y + (R + radial) * s, dz + along);
      out.u = t * length;
      out.v = (psi / TAU) * 0.7;
      // the sides of a bone sink into the meat, patches of meat lie over it, and its broken ends are wet
      const end01 = Math.max(startEnd === 'bury' ? 0 : 1 - ease(0, 0.42, t * length), endEnd === 'bury' ? 0 : 1 - ease(0, 0.42, (1 - t) * length));
      const coat = ease(0.1, 0.6, noise(theta * 4.3 + seed, psi * 0.6, seed * 2));
      out.extra.aRoot[0] = clamp(ease(-0.75, 0.2, Math.cos(psi)) * 0.75 + coat * 0.7 + 0.7 * end01, 0, 1);
    });
  }

  /** Tongue, uvula, vessels: flesh that hangs. */
  private buildLoose(): Mesh {
    const b = new MeshBuilder({ aTissue: 4, aPlace: 4 });
    this.buildTongue(b);
    this.buildUvula(b);
    this.buildVessels(b);
    const mesh = new Mesh(b.build(), this.looseFlesh);
    mesh.name = 'LooseFlesh';
    return mesh;
  }

  private buildTongue(b: MeshBuilder): void {
    const T = MOUTH.tongue;
    const rows = 34;
    const cols = 25;
    b.grid(rows, cols, false, false, (i, j, out) => {
      const t = i / (rows - 1);
      const across = (j / (cols - 1)) * 2 - 1;
      const z = lerp(T.root, T.tip, t);
      // broad at the back, a rounded tip in front
      const tipRound = Math.sqrt(Math.max(0, 1 - ((t - 0.74) / 0.26) ** 2));
      const halfWidth = T.width * (t < 0.74 ? lerp(0.86, 1, t / 0.74) : tipRound) + 0.02;
      const x = across * halfWidth;
      const crown = 1 - across * across;
      const groove = 0.12 * Math.exp(-((x / 0.3) ** 2));
      const hump = lerp(0.1, 1, ease(0, 0.28, t)) * (1 - 0.32 * ease(0.55, 1, t));
      const surface = BITE_Y + T.top - 1.8 * (1 - hump);
      const lumps = 0.06 * noise(x * 1.6, z * 1.1, 4) + 0.025 * noise(x * 5, z * 5, 9);
      out.p.set(x, surface - (1 - crown ** 0.4) * 1.6 - groove + lumps, z);
      out.u = x;
      out.v = z;
      const tissue = out.extra.aTissue;
      tissue[0] = 0.72 + 0.4 * noise(x * 0.7 + 9, z * 0.7, 2);
      tissue[1] = 0.42 + 0.22 * crown + 0.3 * noise(x * 1.3, z * 1.3, 5);
      tissue[2] = 0.12;
      tissue[3] = 0.55 - 0.3 * Math.exp(-((x / 0.22) ** 2));
      const at = out.extra.aPlace;
      at[0] = -ease(T.root, T.root - 2.6, z);
      at[1] = 0;
      at[2] = 1;
      at[3] = 0.42;
    });
  }

  private buildUvula(b: MeshBuilder): void {
    const U = MOUTH.uvula;
    const points = [new Vector3(0, U.top, U.z + 0.15), new Vector3(0.02, lerp(U.top, U.tip, 0.5), U.z), new Vector3(0.05, U.tip + 0.02, U.z - 0.05)];
    b.tube(points, 18, 14, (t) => U.radius * (1.75 - 1.15 * ease(0, 0.42, t) + 0.36 * gauss(t, 0.84, 0.13)) * Math.sqrt(Math.max(0.0025, 1 - ease(0.93, 1, t))), (t, _psi, out) => {
      const { x, y, z } = out.p;
      const tissue = out.extra.aTissue;
      tissue[0] = 0.65 + 0.3 * fbm(x * 1.4, y * 1.4, z * 1.4);
      tissue[1] = 0.2;
      tissue[2] = 0.15;
      tissue[3] = 0.55;
      const at = out.extra.aPlace;
      at[0] = 0;
      at[1] = 2.1 * t * t;
      at[2] = 1;
      at[3] = 0.55;
      out.u *= 1.2;
      out.v = t * (U.top - U.tip);
    });
  }

  /** The great vessels: from the stubs of the heart scan (its own units) up into the wall. */
  private buildVessels(b: MeshBuilder): void {
    const S = HEART.scale;
    const c = Math.cos(HEART.heading * DEG);
    const s = Math.sin(HEART.heading * DEG);
    const stub = (x: number, y: number, z: number) => {
      const dx = S * x;
      const dz = S * z;
      return new Vector3(c * dx + s * dz, HEART.lowest + S * y, HEART.z - s * dx + c * dz);
    };
    const list: readonly { from: V3; to: Pair; radius: number }[] = [
      { from: [-0.177, 0.97, 0.085], to: [112, -170.6], radius: 0.17 },
      { from: [0.061, 0.985, -0.044], to: [90, -172.6], radius: 0.11 },
      { from: [0.152, 0.98, -0.123], to: [72, -174.2], radius: 0.09 },
      { from: [0.201, 0.95, -0.209], to: [58, -175.6], radius: 0.085 },
      { from: [-0.175, 0.94, -0.053], to: [128, -174.8], radius: 0.11 },
      { from: [0.33, 0.73, 0.035], to: [26, -170.4], radius: 0.2 },
      { from: [0.17, 0.82, -0.27], to: [40, -176.4], radius: 0.13 },
      { from: [-0.3, 0.46, 0.05], to: [172, -170.2], radius: 0.055 },
      { from: [0.27, 0.34, 0.12], to: [4, -169.5], radius: 0.045 },
      { from: [-0.22, 0.28, -0.14], to: [196, -175.4], radius: 0.04 },
    ];
    for (const v of list) {
      const start = stub(v.from[0], v.from[1], v.from[2]);
      const end = this.wall.point(v.to[0] * DEG, v.to[1], 0.5, new Vector3());
      const away = start.clone().sub(new Vector3(0, HEART.lowest + S * 0.55, HEART.z)).normalize();
      const mid = start.clone().lerp(end, 0.5).addScaledVector(away, 0.5 * start.distanceTo(end) * 0.28);
      // the thin ones hang slack
      mid.y -= 0.1 + 0.16 / v.radius / 4;
      const seed = v.radius * 91;
      // nothing in a body runs straight
      const wander = (p: Vector3) => p.add(new Vector3(noise(seed, 1, p.y) - 0.1, noise(seed, 2, p.z) - 0.1, noise(seed, 3, p.x) - 0.1).multiplyScalar(0.55));
      const pts = [start, wander(start.clone().lerp(mid, 0.5)), wander(mid.clone()), wander(mid.clone().lerp(end, 0.55)), end];
      b.tube(pts, 18, 10, (t) => v.radius * (1 + 0.5 * ease(0.8, 1, t)) * (1 + 0.18 * Math.sin(t * 13 + seed) + 0.1 * Math.sin(t * 29 + seed * 2)), (t, _psi, out) => {
        const { x, y, z } = out.p;
        const tissue = out.extra.aTissue;
        tissue[0] = 0.55 + 0.4 * fbm(x * 1.1 + seed, y * 1.1, z * 1.1);
        tissue[1] = 0.3 + 0.4 * fbm(x * 1.7, y * 1.7, z * 1.7 + seed);
        tissue[2] = 0.2;
        tissue[3] = 0.52;
        const at = out.extra.aPlace;
        at[0] = 0;
        at[1] = (1 - t) * (1 - t);
        at[2] = 1;
        at[3] = 0.1;
      });
    }
  }

  /** Torn skins hanging from the folds. */
  private buildSkins(): Mesh {
    const b = new MeshBuilder({ aTissue: 4, aPlace: 4 });
    const r = randomFrom(5521);
    const root = new Vector3();
    const folds = this.wall.folds;
    for (let f = 0; f < folds.length; f += SKINS.everyFold) {
      const z0 = folds[f].z;
      if (Math.abs(z0 - HEART.z) < 3.6) continue;
      for (let n = 0; n < SKINS.perFold; n++) {
        const theta = lerp(38, 142, r()) * DEG;
        this.wall.point(theta, z0, 0.25, root);
        const width = lerp(SKINS.width[0], SKINS.width[1], r());
        const lowest = Math.abs(root.x) < 1.7 ? PATH_Y + SKINS.over : 1;
        const length = Math.min(root.y - lowest, lerp(SKINS.length[0], SKINS.length[1], r()) + 0.3);
        if (length < 0.5) continue;
        const seed = r() * 50;
        const x0 = root.x;
        const y0 = root.y;
        const z1 = z0 + (r() - 0.5) * 0.3;
        b.grid(9, 5, false, false, (i, j, out) => {
          const t = i / 8;
          const across = (j / 4) * 2 - 1;
          // narrowing to a torn end, turning as it hangs
          const tear = 0.1 + 0.9 * (1 - t) ** 0.7 + 0.25 * noise(seed, t * 5, across * 2);
          const twist = t * (1 + 1.5 * noise(seed, 1, 3));
          const half = (width / 2) * tear * across;
          out.p.set(x0 + half * Math.cos(twist) + 0.08 * Math.sin(t * 6 + seed), y0 - length * t, z1 + half * Math.sin(twist) + 0.06 * noise(seed, t * 4, 7));
          out.u = half;
          out.v = t * length;
          const tissue = out.extra.aTissue;
          tissue[0] = 0.5 + 0.5 * noise(seed, t * 3, across);
          tissue[1] = 0.12;
          tissue[2] = 0.45 * (1 - 0.5 * t);
          tissue[3] = 0.42 + 0.12 * t;
          const at = out.extra.aPlace;
          at[0] = 0;
          at[1] = 0.7 * t * t;
          at[2] = 1;
          at[3] = 0.25 * t;
        });
      }
    }
    const mesh = new Mesh(b.build(), this.flesh('loose', true, LOOSE_VERTEX_PARS, [['#include <begin_vertex>', LOOSE_VERTEX_PLACE]]));
    mesh.name = 'Skins';
    return mesh;
  }

  /** Balls and lids, one instance each. What changes per frame is one small attribute. */
  private buildEyes(): readonly Object3D[] {
    const eyes = this.plannedEyes;
    const n = eyes.length;
    const look = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
    look.setUsage(DynamicDrawUsage);
    const r = randomFrom(3301);
    const data = new Float32Array(n * 3);
    const matrices: Matrix4[] = [];
    const facing = new Vector3();
    const scale = new Vector3();
    eyes.forEach((e, i) => {
      const theta = e.a * DEG;
      const center = this.wall.point(theta, e.z, e.s * 0.1, new Vector3());
      this.wall.normal(theta, e.z, facing);
      // their up is the world's up, except on the roof, where it is along the tunnel; each rolled its own way
      up.set(0, 1, 0);
      if (Math.abs(facing.y) > 0.8) up.set(0, 0, 1);
      // frameOf keeps +y exact: here +z (out of the wall) must be, so the up is made square to it first
      up.addScaledVector(facing, -up.dot(facing));
      const frame = frameOf(facing, up, new Matrix4()).multiply(m1.makeRotationZ(e.roll * DEG));
      this.eyeFrames.push(frame);
      this.eyeCenters.push(center);
      this.eyeSizes.push(e.s);
      matrices.push(frame.clone().scale(scale.setScalar(e.s)).setPosition(center));
      data[i * 3] = e.open;
      data[i * 3 + 1] = lerp(0.11, 0.24, r());
      data[i * 3 + 2] = r();
    });
    const eye = new InstancedBufferAttribute(data, 3);

    const ballGeometry = this.ballGeometry();
    ballGeometry.setAttribute('aLook', look);
    ballGeometry.setAttribute('aEye', eye);
    const ballMaterial = hooked(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.12 }), 'eye', (shader) => {
      Object.assign(shader.uniforms, this.u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${EYE_VERTEX_PARS}`)
        .replace('#include <beginnormal_vertex>', EYE_VERTEX_NORMAL)
        .replace('#include <begin_vertex>', EYE_VERTEX_PLACE);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${EYE_FRAGMENT_PARS}`)
        .replace('#include <map_fragment>', EYE_PAINT)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${EYE_WET}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${EYE_GLOW}`)
        .replace(...IN_THE_ROOM);
    });
    const balls = new InstancedMesh(ballGeometry, ballMaterial, n);
    balls.name = 'EyeBalls';

    const lidGeometry = this.lidGeometry();
    lidGeometry.setAttribute('aLook', look);
    lidGeometry.setAttribute('aEye', eye);
    const lids = new InstancedMesh(
      lidGeometry,
      this.flesh('lid', false, LID_VERTEX_PARS, [
        ['#include <beginnormal_vertex>', LID_VERTEX_NORMAL],
        ['#include <begin_vertex>', LID_VERTEX_PLACE],
      ]),
      n,
    );
    lids.name = 'EyeLids';
    matrices.forEach((m, i) => {
      balls.setMatrixAt(i, m);
      lids.setMatrixAt(i, m);
    });
    return [balls, lids];
  }

  /** The front of a ball (what lids can ever uncover): pupil at +z. */
  private ballGeometry(): BufferGeometry {
    const b = new MeshBuilder();
    const rows = 9;
    const cols = 23;
    b.grid(rows, cols, true, true, (i, j, out) => {
      const polar = Math.max(0.001, (i / (rows - 1)) * 2.25);
      const a = ((j % (cols - 1)) / (cols - 1)) * TAU;
      out.p.set(Math.sin(polar) * Math.cos(a), Math.sin(polar) * Math.sin(a), Math.cos(polar));
      out.u = 0;
      out.v = 0;
    });
    return b.build();
  }

  /** Both lids of one eye as a sheet of (across, rim to root, which lid): the shader bends them around the ball. */
  private lidGeometry(): BufferGeometry {
    const b = new MeshBuilder({ aTissue: 4 });
    const rows = 6;
    const cols = 15;
    for (const lid of [1, -1]) {
      b.grid(rows, cols, false, lid < 0, (i, j, out) => {
        const t = (i / (rows - 1)) ** 1.5;
        const s = ((j / (cols - 1)) * 2 - 1) * 1.45;
        out.p.set(s, t, lid);
        out.u = s * 0.34;
        out.v = t * 0.5 + lid * 0.3;
        const tissue = out.extra.aTissue;
        tissue[0] = 0.7;
        tissue[1] = 0.05;
        tissue[2] = 0.15 + 0.25 * t;
        tissue[3] = lerp(0.3, 0.62, ease(0, 0.2, t)) * (1 - 0.35 * gauss(t, 0.42, 0.08));
      });
    }
    return b.build();
  }

  /** The heart, and how it is made wet from its own shape, for it has no texture coordinates. */
  private buildHeart(kit: DreamKit): void {
    const model = kit.prop('heart', [0, HEART.lowest, HEART.z], { scale: HEART.scale, rotation: [0, HEART.heading, 0] });
    const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
    const material = hooked(m, 'heart', (shader) => {
      Object.assign(shader.uniforms, this.u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aHeart;\nuniform float uHeart;\nvarying vec3 vHeartAt;\nvarying vec3 vHeartN;\nvarying vec3 vHeartC;')
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
          float heartK = 1.0 - smoothstep(-0.4, 0.62, position.y);
          float heartTw = ${glf(HEART.twist)} * uHeart * heartK;
          mat2 heartRot = mat2(cos(heartTw), sin(heartTw), -sin(heartTw), cos(heartTw));
          objectNormal.xz = heartRot * objectNormal.xz;
          vHeartAt = position;
          vHeartN = normal;
          vHeartC = aHeart;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          transformed.xz = heartRot * transformed.xz * (1.0 - ${glf(HEART.squeeze)} * uHeart * heartK);
          transformed.y += ${glf(HEART.lift)} * uHeart * heartK * (0.62 - position.y);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform sampler2D tHeartN;\nuniform sampler2D tHeartC;\nuniform float uHeart;\nuniform mat3 normalMatrix;\nvarying vec3 vHeartAt;\nvarying vec3 vHeartN;\nvarying vec3 vHeartC;',
        )
        .replace(
          '#include <map_fragment>',
          `vec3 heartB = abs(normalize(vHeartN));
          heartB *= heartB;
          heartB *= heartB;
          heartB /= heartB.x + heartB.y + heartB.z;
          vec3 heartP = vHeartAt * ${glf(HEART.detailScale)};
          // torn muscle, wrapped around it from three sides
          float heartFibre = heartB.x * texture2D(tHeartC, heartP.zy).r + heartB.y * texture2D(tHeartC, heartP.xz).r + heartB.z * texture2D(tHeartC, heartP.xy).r;
          vec3 heartC = mix(${glc(COLORS.heartDark)}, ${glc(COLORS.heartRed)}, (0.42 + 0.58 * smoothstep(0.02, 0.7, heartFibre)) * vHeartC.z);
          heartC = mix(heartC, ${glc(COLORS.heartFat)} * (0.45 + 0.9 * heartFibre), vHeartC.x);
          heartC = mix(heartC, ${glc(COLORS.heartVein)}, vHeartC.y);
          diffuseColor.rgb = heartC;`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.14, 0.26, vHeartC.x);')
        .replace(...IN_THE_ROOM)
        .replace(
          '#include <normal_fragment_maps>',
          `vec2 heartNx = texture2D(tHeartN, heartP.zy).xy * 2.0 - 1.0;
          vec2 heartNy = texture2D(tHeartN, heartP.xz).xy * 2.0 - 1.0;
          vec2 heartNz = texture2D(tHeartN, heartP.xy).xy * 2.0 - 1.0;
          vec3 heartD = heartB.x * vec3(0.0, heartNx.y, heartNx.x) + heartB.y * vec3(heartNy.x, 0.0, heartNy.y) + heartB.z * vec3(heartNz.x, heartNz.y, 0.0);
          normal = normalize(normal + normalMatrix * heartD * ${glf(HEART.detail)});
          diffuseColor.rgb *= 1.0 - 0.55 * saturate(length(heartD) - 0.2);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float heartRim = pow3(1.0 - saturate(dot(normal, normalize(vViewPosition))));
          totalEmissiveRadiance += ${glc(COLORS.heartGlow)} * (heartRim * (0.35 + 0.9 * uHeart) + 0.09 * uHeart);`,
        );
    });
    model.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry.clone();
      const p = g.getAttribute('position');
      const baked = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        const groove = gauss(y, 0.16, 0.13) + 0.75 * gauss(x * 0.8 + z * 0.55, 0.02 + 0.1 * y, 0.1) * (1 - ease(0.1, 0.5, y));
        const vessels = ease(0.45, 0.72, y);
        const fat = ease(0.4, 0.74, groove * 0.62 + vessels * 0.55 + 0.42 * fbm(x * 2.4, y * 2.4, z * 2.4));
        const line = 1 - Math.abs(noise(x * 2.5 + 5, y * 1.5, z * 2.5)) / 0.11;
        const fine = 1 - Math.abs(noise(x * 6 + 9, y * 4, z * 6)) / 0.09;
        baked[i * 3] = fat;
        baked[i * 3 + 1] = clamp(Math.max(line, fine * 0.55), 0, 1) * (1 - ease(0.15, 0.55, y)) * 0.85;
        baked[i * 3 + 2] = 0.42 + 0.58 * ease(-0.5, 0.5, fbm(x * 1.6 + 3, y * 1.6, z * 1.6));
      }
      g.setAttribute('aHeart', new Float32BufferAttribute(baked, 3));
      mesh.geometry = g;
      mesh.material = material;
    });
    this.heart.add(model);
  }

  /** Arms out of the walls, reaching for whoever comes down the tunnel. */
  private buildArms(kit: DreamKit): PropCrowd {
    const crowd = kit.props('forearm', ARMS.count, { scale: 1 });
    const material = hooked(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.24 }), 'arm', (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vArmAt;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvArmAt = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vArmAt;')
        .replace(
          '#include <map_fragment>',
          `float armAlong = vArmAt.x * 0.5 + 0.5;
          float armSpots = sin(vArmAt.y * 41.0 + 2.0 * sin(vArmAt.x * 23.0)) * sin(vArmAt.z * 37.0 + 1.5 * sin(vArmAt.x * 31.0));
          vec3 armC = ${glc(COLORS.arm)} * (0.86 + 0.14 * armSpots);
          armC = mix(armC, armC * vec3(0.72, 0.5, 0.62), smoothstep(0.72, 1.0, armAlong));
          armC = mix(${glc(COLORS.armRoot)}, armC, smoothstep(0.26, 0.46, armAlong + 0.05 * armSpots));
          diffuseColor.rgb = armC;`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.13, 0.26, armAlong);')
        .replace(...IN_THE_ROOM)
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += ${glc(COLORS.rimGlow)} * pow3(1.0 - saturate(dot(normal, normalize(vViewPosition))));`,
        );
    });
    crowd.root.traverse((o) => {
      const mesh = o as InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      // the scan's own long axis is its x; the hand is what is looked at, the arm is half in the wall
      mesh.geometry = relaxed(clustered(mesh.geometry, (x) => (x > ARMS.wristFrom ? ARMS.cellHand : x > ARMS.armFrom ? ARMS.cellWrist : ARMS.cellArm), false), 3);
      mesh.material = material;
    });
    const normal = new Vector3();
    this.plannedArms.forEach((p, i) => {
      this.wall.normal(p.theta, p.z, normal);
      // out of the wall, and toward the one who comes
      const rest = normal.clone().multiplyScalar(0.8).add(new Vector3(p.jx, p.jy, 0.5 + p.jz)).normalize();
      const base = this.wall.point(p.theta, p.z, 0, new Vector3()).addScaledVector(rest, -ARMS.sink * p.size);
      const palm = new Vector3(0, 0, 1).addScaledVector(normal, 0.5).normalize();
      this.arms.push({ base, rest, dir: rest.clone(), palm, size: p.size });
      this.setArm(crowd, i);
    });
    crowd.drawn = this.arms.length;
    crowd.commit();
    this.root.add(crowd.root);
    return crowd;
  }

  private setArm(crowd: PropCrowd, i: number): void {
    const a = this.arms[i];
    // the scan's fingers are its +y, its palm its +x
    v2.copy(a.dir);
    v1.copy(a.palm).addScaledVector(v2, -a.palm.dot(v2)).normalize();
    v3.crossVectors(v1, v2);
    m1.makeBasis(v1, v2, v3).scale(forward.setScalar(a.size)).setPosition(a.base);
    crowd.setMatrix(i, m1);
  }

  private buildSkulls(kit: DreamKit): void {
    const crowd = kit.props('skull', SKULLS.count, { scale: 1 });
    const r = randomFrom(8123);
    let material: MeshStandardMaterial | null = null;
    crowd.root.traverse((o) => {
      const mesh = o as InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      mesh.geometry = clustered(mesh.geometry, () => SKULLS.cell, true);
      if (!material) {
        const m = (mesh.material as MeshStandardMaterial).clone();
        m.color.setRGB(COLORS.skull[0], COLORS.skull[1], COLORS.skull[2]);
        m.roughnessMap = null;
        m.metalnessMap = null;
        m.roughness = 0.3;
        m.metalness = 0;
        material = hooked(m, 'skull', (shader) => {
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vSunkAt;')
            .replace('#include <project_vertex>', '#include <project_vertex>\nvSunkAt = (instanceMatrix * vec4(transformed, 1.0)).xyz;');
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\nvarying vec3 vSunkAt;\n${SUNK_GLSL}`)
            .replace('#include <map_fragment>', `#include <map_fragment>\nfloat skullSunk = fleshSunk(vSunkAt, -0.42, 0.02);\ndiffuseColor.rgb = mix(diffuseColor.rgb, ${glc(COLORS.skullRoot)}, skullSunk);`)
            .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.34, 0.12, skullSunk);');
        });
      }
      mesh.material = material;
    });
    const folds = this.wall.folds;
    const facing = new Vector3();
    const place = new Vector3();
    const look = new Matrix4();
    const scale = new Vector3();
    let i = 0;
    let guard = 0;
    while (i < SKULLS.count && guard++ < 2000) {
      const f = folds[Math.floor(r() * folds.length)];
      const z = f.z - 0.5 - r() * 0.5;
      const theta = lerp(-25, 205, r()) * DEG;
      if (this.plannedEyes.some((e) => Math.hypot(e.z - z, wrapAngle(e.a * DEG - theta) * TUBE_R) < e.s * 2 + 0.5)) continue;
      if (BODIES.some(([bz, ba]) => Math.hypot(bz - z, wrapAngle(ba * DEG - theta) * TUBE_R) < 1.1)) continue;
      if (this.plannedArms.some((a) => Math.hypot(a.z - z, wrapAngle(a.theta - theta) * TUBE_R) < 0.8)) continue;
      const size = lerp(SKULLS.scale[0], SKULLS.scale[1], r());
      this.wall.normal(theta, z, facing);
      // half sunk: its middle lies under the wall; it looks out, a little askew, a little toward the one who comes
      this.wall.point(theta, z, SKULLS.sink * size, place);
      facing.z += 0.4;
      facing.x += (r() - 0.5) * 0.5;
      facing.y += (r() - 0.5) * 0.5;
      facing.normalize();
      up.set(r() - 0.5, 1, r() - 0.5);
      if (Math.abs(facing.y) > 0.8) up.set(r() - 0.5, 0, 1);
      up.addScaledVector(facing, -up.dot(facing));
      frameOf(facing, up, look).scale(scale.setScalar(size));
      // the scan stands on its base: lower it by half its height along its own up
      place.addScaledVector(v2.setFromMatrixColumn(look, 1), -0.5);
      look.setPosition(place);
      crowd.setMatrix(i, look);
      i++;
    }
    crowd.drawn = i;
    crowd.commit();
    this.root.add(crowd.root);
  }

  /** People half sunk in the wall, faces out, looking across at each other. */
  private buildBodies(kit: DreamKit): void {
    const crowds: Crowd[] = BODY_SPECS.map((spec, k) => {
      const crowd = kit.figures.crowd(spec, BODIES.filter((b) => b[2] === k).length);
      crowd.root.traverse((o) => {
        const mesh = o as InstancedMesh;
        if (!mesh.isInstancedMesh) return;
        // the materials of a crowd may be shared with others in the dream: these are stained, so they are their own
        const m = (mesh.material as MeshStandardMaterial).clone();
        mesh.material = hooked(m, `sunk-${k}-${m.name}`, (shader) => {
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vSunkAt;')
            .replace('#include <project_vertex>', '#include <project_vertex>\nvSunkAt = (instanceMatrix * vec4(transformed, 1.0)).xyz;');
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\nvarying vec3 vSunkAt;\n${SUNK_GLSL}`)
            .replace(
              '#include <map_fragment>',
              `#include <map_fragment>
              float bodySunk = fleshSunk(vSunkAt, -0.46, -0.08);
              diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.78, 0.66, 0.6), ${glc(COLORS.crimson)} * 0.7, bodySunk);`,
            )
            .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.48, 0.13, bodySunk);');
        });
      });
      this.root.add(crowd.root);
      return crowd;
    });
    const used = BODY_SPECS.map(() => 0);
    const look = new Matrix4();
    const place = new Vector3();
    const facing = new Vector3();
    const inside = new Vector3();
    const along = new Vector3();
    const scale = new Vector3();
    const lean = BODY_LEAN * DEG;
    for (const [z, deg, kind, proud] of BODIES) {
      const theta = deg * DEG;
      // the place of the chest on the wall: from it the body goes down the wall and into it, the head comes out over the path
      this.wall.point(theta, z, -proud, place);
      inside.set(-Math.cos(theta), -Math.sin(theta), 0);
      along.set(-Math.sin(theta), Math.cos(theta), 0);
      if (along.y < 0) along.negate();
      up.copy(along).multiplyScalar(Math.cos(lean)).addScaledVector(inside, Math.sin(lean));
      facing.copy(inside).multiplyScalar(Math.cos(lean)).addScaledVector(along, -Math.sin(lean));
      facing.z += 0.14;
      frameOf(facing, up, look).scale(scale.setScalar(BODY_SCALE));
      place.addScaledVector(up, -CHEST * BODY_SCALE);
      look.setPosition(place);
      crowds[kind].setMatrix(used[kind]++, look);
    }
    for (const c of crowds) c.commit();
  }

  /** White hair: long wet locks hanging from the roof across the tunnel, high up. One ribbon, many instances. */
  private buildHair(): Mesh {
    const r = randomFrom(4547);
    const from: number[] = [];
    const to: number[] = [];
    const shape: number[] = [];
    const root = new Vector3();
    const tip = new Vector3();
    for (let c = 0; c < HAIR.clumps; c++) {
      const z = lerp(-152.2, -181, (c + r()) / HAIR.clumps);
      // over the heart nothing hangs: the vessels do
      if (Math.abs(z - HEART.z) < 3.1) continue;
      const theta = lerp(24, 156, r()) * DEG;
      this.wall.point(theta, z, 0.06, root);
      // how low the longest may hang here: over the path, or beside it
      const lowest = Math.abs(root.x) < HAIR.beside ? PATH_Y + HAIR.over : 0.55;
      const fall = Math.max(0.8, (root.y - lowest) * lerp(0.6, 1, r()));
      const strands = Math.round(lerp(HAIR.strands[0], HAIR.strands[1], r()));
      // a lock bends as one
      const phase = r() * TAU;
      const axisX = root.x + (r() - 0.5) * 0.3;
      const axisZ = z + (r() - 0.5) * 0.3;
      for (let s = 0; s < strands; s++) {
        const a = theta + (r() - 0.5) * 0.12;
        const az = z + (r() - 0.5) * 0.36;
        this.wall.point(a, az, 0.06, root);
        const length = fall * lerp(0.4, 1, r() ** 0.7);
        // wet locks: the tips gather
        tip.set(lerp(axisX, root.x, 0.22) + (r() - 0.5) * 0.04, root.y - length, lerp(axisZ, az, 0.22) + (r() - 0.5) * 0.04);
        from.push(root.x, root.y, root.z);
        to.push(tip.x, tip.y, tip.z);
        shape.push(HAIR.width * lerp(0.7, 1.25, r()), phase + (r() - 0.5) * 0.7);
      }
    }
    const g = new InstancedBufferGeometry();
    const positions: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= HAIR.segments; i++) {
      const t = i / HAIR.segments;
      positions.push(-1, t, 0, 1, t, 0);
      if (i < HAIR.segments) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new Float32BufferAttribute(new Float32Array(positions.length), 3));
    g.setIndex(index);
    g.setAttribute('aFrom', new InstancedBufferAttribute(new Float32Array(from), 3));
    g.setAttribute('aTo', new InstancedBufferAttribute(new Float32Array(to), 3));
    g.setAttribute('aShape', new InstancedBufferAttribute(new Float32Array(shape), 2));
    g.instanceCount = from.length / 3;
    const material = hooked(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.34, side: DoubleSide }), 'hair', (shader) => {
      Object.assign(shader.uniforms, this.u);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec3 aFrom;
          attribute vec3 aTo;
          attribute vec2 aShape; // width, phase
          uniform float uFleshTime;
          varying float vHairFade;`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `float hairT = position.y;
          // wet: the strands come together soon after the root and hang as one
          float hairGather = hairT * (2.0 - hairT);
          vec3 hairP = vec3(mix(aFrom.x, aTo.x, hairGather), mix(aFrom.y, aTo.y, hairT), mix(aFrom.z, aTo.z, hairGather));
          hairP.x += (sin(hairT * 8.0 + aShape.y) * ${glf(HAIR.wave)} + sin(hairT * 11.0 + aShape.y * 3.1) * ${glf(HAIR.wave * 0.35)} + sin(uFleshTime * ${glf(HAIR.rate)} + aShape.y + hairT * 2.0) * ${glf(HAIR.sway * MOTION)}) * hairT;
          hairP.z += (cos(hairT * 10.0 + aShape.y * 1.7) * ${glf(HAIR.wave)} + cos(hairT * 12.0 + aShape.y * 2.3) * ${glf(HAIR.wave * 0.35)} + cos(uFleshTime * ${glf(HAIR.rate * 0.77)} + aShape.y * 1.7 + hairT * 1.5) * ${glf(HAIR.sway * MOTION)}) * hairT;
          vec3 hairTo = cameraPosition - hairP;
          float hairDist = length(hairTo);
          hairTo /= hairDist;
          vec3 hairSide = normalize(cross(aTo - aFrom, hairTo));
          float hairWide = aShape.x * (1.0 - 0.85 * hairT);
          // no thinner than about a pixel: thinner it would shimmer; it dims instead
          float hairMin = hairDist * 0.0011;
          vHairFade = min(1.0, hairWide / hairMin);
          vec3 objectNormal = normalize(hairTo + hairSide * position.x * 0.7);`,
        )
        .replace('#include <begin_vertex>', 'vec3 transformed = hairP + hairSide * position.x * max(hairWide, hairMin);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vHairFade;')
        .replace('#include <map_fragment>', `diffuseColor.rgb = ${glc(COLORS.hair)} * (0.3 + 0.7 * vHairFade);`)
        .replace(...IN_THE_ROOM);
    });
    const mesh = new Mesh(g, material);
    mesh.name = 'WhiteHair';
    return mesh;
  }

  /** Threads of saliva: strung between the folds, and between the jaws, where they stretch as the jaws part. */
  private buildThreads(arch: ArchPlan): Mesh {
    const b = new MeshBuilder({ aJawOf: 1 });
    const r = randomFrom(7717);
    const a = new Vector3();
    const c = new Vector3();
    const sagged = (t: number, sag: number, out: Vector3) => out.lerpVectors(a, c, t).setY(lerp(a.y, c.y, t) - sag * 4 * t * (1 - t));
    let made = 0;
    let guard = 0;
    while (made < THREADS.folds && guard++ < 2000) {
      const z = lerp(-152.5, -176.5, r());
      const theta = lerp(-20, 200, r()) * DEG;
      const dz = 0.5 + r() * 1.5;
      this.wall.point(theta, z, 0.04, a);
      this.wall.point(theta + (r() - 0.5) * 0.5, z - dz, 0.04, c);
      const sag = lerp(THREADS.sag[0], THREADS.sag[1], r());
      sagged(0.5, sag, v1);
      if (Math.hypot(v1.x, v1.y - PATH_Y) < THREADS.clearance + 0.3) continue;
      const pts: Vector3[] = [];
      for (let k = 0; k <= 4; k++) pts.push(sagged(k / 4, sag, new Vector3()));
      const thin = lerp(THREADS.radius[0], THREADS.radius[1], r());
      const bead = 0.35 + r() * 0.3;
      b.tube(pts, THREADS.segments + 1, THREADS.sides, (t) => thin * (1 + 1.8 * gauss(t, bead, 0.05) + 1.6 * (Math.abs(t - 0.5) * 2) ** 6), (_t, _psi, out) => {
        out.extra.aJawOf[0] = 0;
      });
      made++;
    }
    for (let k = 0; k < THREADS.jaws; k++) {
      // beside the path, from the upper teeth to the lower, wherever a mouth drools
      const phi = (r() < 0.5 ? -1 : 1) * lerp(0.75, 2.1, r());
      arch.point(phi, 0.25 + r() * 0.35, a);
      a.y = BITE_Y + MOUTH.overlap + 0.02 + r() * 0.2;
      c.copy(a);
      c.y = BITE_Y - MOUTH.overlap - 0.02 - r() * 0.2;
      c.x += (r() - 0.5) * 0.25;
      const thin = lerp(THREADS.radius[0], THREADS.radius[1], r());
      const bead = 0.3 + r() * 0.4;
      const bow = (r() - 0.5) * 0.5;
      const pts = [a.clone(), a.clone().lerp(c, 0.33).setX(a.x + bow), a.clone().lerp(c, 0.66).setX(a.x + bow * 0.9), c.clone()];
      b.tube(pts, THREADS.segments + 1, THREADS.sides, (t) => thin * (1 + 2 * gauss(t, bead, 0.07) + 2 * (Math.abs(t - 0.5) * 2) ** 6), (t, _psi, out) => {
        out.extra.aJawOf[0] = 1 - 2 * t;
      });
    }
    const material = hooked(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.07 }), 'thread', (shader) => {
      Object.assign(shader.uniforms, this.u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute float aJawOf;\nuniform vec2 uJaw;\n${PULSE_GLSL}`)
        .replace('#include <begin_vertex>', `${RIDE_VERTEX}\ntransformed.y += max(aJawOf, 0.0) * uJaw.x + max(-aJawOf, 0.0) * uJaw.y;`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `diffuseColor.rgb = ${glc(COLORS.thread)};`);
    });
    const mesh = new Mesh(b.build(), material);
    mesh.name = 'Saliva';
    return mesh;
  }

  /** Teeth where no tooth should be: a second row behind each arch. */
  private buildExtraTeeth(arch: ArchPlan): void {
    const r = randomFrom(9929);
    const size = (): number => lerp(EXTRA_TEETH.height[0], EXTRA_TEETH.height[1], r());
    const place = new Vector3();
    const dir = new Vector3();
    const look = new Matrix4();
    const scale = new Vector3();
    const put = (mesh: InstancedMesh, i: number, at: Vector3, tipward: Vector3, height: number) => {
      // the tooth grows along its +y out of the meat; its broad side looks back down the throat
      frameOf(side.set(0.01, 0.02, 1), tipward, look).scale(scale.setScalar(height));
      look.setPosition(at.addScaledVector(tipward, -EXTRA_TEETH.sunk * height));
      mesh.setMatrixAt(i, look);
    };
    const row = (group: Group, sign: number) => {
      const mesh = new InstancedMesh(this.canine, this.toothMaterial, EXTRA_TEETH.rows);
      for (let i = 0; i < EXTRA_TEETH.rows; i++) {
        const phi = lerp(-arch.ends * 0.8, arch.ends * 0.8, (i + 0.15 + 0.7 * r()) / EXTRA_TEETH.rows);
        arch.point(phi, 0.8 + r() * 0.55, place);
        // from the palate down, or from the floor up; their tips lean back toward the throat
        place.y = BITE_Y + sign * (lerp(MOUTH.crown[0], MOUTH.crown[1], arch.front(place.x, place.z)) + 0.42);
        dir.set((r() - 0.5) * 0.3, -sign, 0.3 + r() * 0.25).normalize();
        put(mesh, i, place, dir, size());
      }
      group.add(mesh);
    };
    row(this.upperJaw, 1);
    row(this.lowerJaw, -1);
  }

  // ------------------------------------------------------------------ per frame

  update(frame: DreamFrame): void {
    const { eye, paused, dt } = frame;
    if (!paused) {
      this.clock += dt;
      this.followHeart(frame);
      this.updatePresses(eye.z);
      this.updateEyes(frame);
      this.updateArms(frame, dt);
      this.updateJaws(eye.z, dt);
      this.lastEyeZ = eye.z;
    }
    this.u.uFleshTime.value = this.clock;

    // the sphincter dilates for the one who comes, and breathes
    const open = lerp(COLLAR.pursed, 1, smootherstep(range(COLLAR.opens[0], COLLAR.opens[1], eye.z)));
    this.u.uRim.value = open * (1 + 0.012 * MOTION * Math.sin(this.clock * 1.1));

    // the lamp goes with the viewer; only what is near glints
    frame.view.getWorldDirection(forward);
    side.crossVectors(forward, Y_AXIS).normalize();
    this.lampPosition[0] = eye.x + side.x * LAMP.offset[0] - forward.x * LAMP.offset[2];
    this.lampPosition[1] = eye.y + LAMP.offset[1] - forward.y * LAMP.offset[2];
    this.lampPosition[2] = eye.z + side.z * LAMP.offset[0] - forward.z * LAMP.offset[2];
    this.lampTarget[0] = eye.x + forward.x * LAMP.aim;
    this.lampTarget[1] = eye.y + forward.y * LAMP.aim;
    this.lampTarget[2] = eye.z + forward.z * LAMP.aim;
    this.lamp.intensity = LAMP.intensity * (1 + 0.1 * this.heartLevel * MOTION);
  }

  /** The heart's beat, as the wall needs it: a phase that a wave can run along. */
  private followHeart(frame: DreamFrame): void {
    const h = frame.heartbeat;
    const H = fearConfig.heart;
    this.sinceBeat += frame.dt;
    if (h >= 0.999 && this.lastHeartbeat < 0.999) {
      this.beats = (this.beats + 1) % 1024;
      this.sinceBeat = 0;
    }
    this.lastHeartbeat = h;
    const rate = lerp(H.calm, H.panic, frame.fear);
    this.u.uBeat.value.set(this.beats + Math.min(0.999, this.sinceBeat * rate), H.decay / rate);
    this.heartLevel = damp(this.heartLevel, h, HEART.attack, frame.dt);
    this.u.uHeart.value = this.heartLevel * (REDUCED_MOTION ? 0.35 : 1);
    this.u.uHeartJolt.value.set(0, HEART.jolt * this.heartLevel * MOTION, 0);
    this.heart.position.copy(this.u.uHeartJolt.value);
    // each light rises when the pulse passes it, and matters only near the eye
    const z = frame.eye.z;
    for (const p of this.poolLights) {
      const d = p.z - z; // > 0: behind the viewer
      const fade = d > 0 ? 1 - ease(p.behind * 0.6, p.behind, d) : 1 - ease(p.ahead * 0.6, p.ahead, -d);
      p.light.intensity = p.base * fade * (1 + LIGHT_PULSE * this.beatAt(p.z));
    }
  }

  /** The first hit of the pulse the wall's shader sees, at its own place: light rises once per beat, never in two. */
  private beatAt(z: number): number {
    const x = (this.u.uBeat.value.x - Math.abs(z - HEART.z) / PULSE.wavelength) % 1;
    const f = x < 0 ? x + 1 : x;
    return ease(0, 0.07, f) * Math.exp(-this.u.uBeat.value.y * f);
  }

  /** Hands and faces: where each is, as a function of where the eye is. */
  private updatePresses(z: number): void {
    const data = this.u.uPress.value;
    data.fill(0);
    for (const v of PRESS.visits) {
      const t = range(v.eye[0], v.eye[1], z);
      if (t <= 0 || t >= 1) continue;
      const k = v.slot * 4;
      const glide = smootherstep(t);
      data[k] = lerp(v.at[0], v.at[1], glide) * DEG * PRESS.wallRadius;
      data[k + 1] = lerp(v.z[0], v.z[1], glide);
      data[k + 2] = ease(0, PRESS.rise, t) * (1 - ease(1 - PRESS.sink, 1, t)) * (1 + 0.06 * MOTION * Math.sin(this.clock * 1.3 + v.slot));
      data[k + 3] = lerp(v.turn[0], v.turn[1], glide) * DEG;
    }
  }

  /** Every eye looks at the viewer's eye, in small jumps, as far as its socket lets it; each blinks when it does. */
  private updateEyes(frame: DreamFrame): void {
    const look = this.lookAttribute.array as Float32Array;
    const eye = frame.eye;
    const now = this.clock;
    const allAtOnce = this.lastEyeZ > EYES.allAtOnce && eye.z <= EYES.allAtOnce;
    const turnLimit = Math.cos(EYES.turn * DEG);
    const jump = 1 - Math.exp(-EYES.jumpRate * frame.dt);
    for (let i = 0; i < this.eyeCount; i++) {
      const m = this.eyeFrames[i].elements;
      v1.copy(eye).sub(this.eyeCenters[i]).normalize();
      // into the eye's own frame
      let x = v1.x * m[0] + v1.y * m[1] + v1.z * m[2];
      let y = v1.x * m[4] + v1.y * m[5] + v1.z * m[6];
      let z = v1.x * m[8] + v1.y * m[9] + v1.z * m[10];
      if (z < turnLimit) {
        // straining as far as it goes, after you
        const s = Math.sqrt(1 - turnLimit * turnLimit) / (Math.hypot(x, y) || 1);
        x *= s;
        y *= s;
        z = turnLimit;
      }
      const k = i * 3;
      const off = x * this.lookTargets[k] + y * this.lookTargets[k + 1] + z * this.lookTargets[k + 2];
      if (off < EYES.offBy || now > this.lookNext[i]) {
        this.lookTargets[k] = x;
        this.lookTargets[k + 1] = y;
        this.lookTargets[k + 2] = z;
        this.lookNext[i] = now + lerp(EYES.jumpAfter[0], EYES.jumpAfter[1], this.restSeed());
      }
      const q = i * 4;
      const nx = look[q] + (this.lookTargets[k] - look[q]) * jump;
      const ny = look[q + 1] + (this.lookTargets[k + 1] - look[q + 1]) * jump;
      const nz = look[q + 2] + (this.lookTargets[k + 2] - look[q + 2]) * jump;
      const l = Math.hypot(nx, ny, nz) || 1;
      look[q] = nx / l;
      look[q + 1] = ny / l;
      look[q + 2] = nz / l;

      // the blink
      const length = lerp(EYES.blinkLength[0], EYES.blinkLength[1], ease(0.08, 0.35, this.eyeSizes[i]));
      if (allAtOnce) {
        this.blinkT[i] = 0;
        this.blinkAt[i] = now - 1e-3;
      }
      if (now >= this.blinkAt[i]) {
        this.blinkT[i] += frame.dt / length;
        if (this.blinkT[i] >= 1) {
          this.blinkT[i] = 0;
          this.blinkAt[i] = now + lerp(EYES.blinkEvery[0], EYES.blinkEvery[1], this.restSeed() ** 1.8);
        }
      }
      const t = this.blinkT[i];
      look[q + 3] = t <= 0 ? 0 : t < 0.25 ? t / 0.25 : t < 0.38 ? 1 : 1 - (t - 0.38) / 0.62;
    }
    this.lookAttribute.needsUpdate = true;
  }

  /** The arms never move while anyone watches. Behind your back they have all turned after you. */
  private updateArms(frame: DreamFrame, dt: number): void {
    const eye = frame.eye;
    const step = ARMS.turnRate * dt;
    let moved = false;
    for (let i = 0; i < this.arms.length; i++) {
      const a = this.arms[i];
      if (a.base.z < eye.z || !frame.unseen(a.base, 6)) continue;
      // reach for where the viewer has gone, as far as the arm leaves the wall
      inward.copy(eye).sub(a.base).normalize();
      if (a.dir.dot(inward) > 0.995) continue;
      up.copy(a.dir).lerp(inward, Math.min(1, step)).normalize();
      if (up.dot(a.rest) < ARMS.lean) continue;
      a.dir.copy(up);
      this.setArm(this.armCrowd, i);
      moved = true;
    }
    if (moved) this.armCrowd.commit();
  }

  /** The jaws: they part as the eye comes, and slam behind it. */
  private updateJaws(z: number, dt: number): void {
    const parted = smootherstep(range(MOUTH.parts[0], MOUTH.parts[1], z));
    let jaw: number;
    if (z < MOUTH.slamAt) {
      if (this.slam < 0) {
        this.slam = 0;
        this.slamFrom = this.jaw;
      }
      const seconds = REDUCED_MOTION ? 0.5 : MOUTH.slamSeconds;
      this.slam += dt;
      const t = Math.min(1, this.slam / seconds);
      jaw = this.slamFrom * (1 - t * t);
      if (t >= 1 && !REDUCED_MOTION) {
        const after = this.slam - seconds;
        jaw = MOUTH.rebound[0] * Math.exp(-MOUTH.rebound[1] * after) * Math.abs(Math.sin(MOUTH.rebound[2] * after));
      }
    } else {
      this.slam = -1;
      // coming back: they open at their own pace; going forward they keep to the eye
      jaw = this.jaw < parted ? Math.min(parted, this.jaw + dt / MOUTH.reopenSeconds) : parted;
    }
    this.setJaw(jaw);
  }

  private setJaw(jaw: number): void {
    this.jaw = jaw;
    const lift = jaw * MOUTH.opening;
    this.upperJaw.position.y = lift;
    this.lowerJaw.position.y = -lift;
    this.u.uJaw.value.set(lift, -lift);
  }

  reset(): void {
    this.clock = 0;
    this.beats = 0;
    this.sinceBeat = 0;
    this.lastHeartbeat = 0;
    this.heartLevel = 0;
    this.slam = -1;
    this.lastEyeZ = 0;
    this.setJaw(0);
    this.u.uRim.value = COLLAR.pursed;
    this.u.uHeart.value = 0;
    this.u.uHeartJolt.value.set(0, 0, 0);
    this.u.uPress.value.fill(0);
    this.heart.position.set(0, 0, 0);
    const look = this.lookAttribute.array as Float32Array;
    const r = randomFrom(6067);
    for (let i = 0; i < this.eyeCount; i++) {
      look[i * 4] = 0;
      look[i * 4 + 1] = 0;
      look[i * 4 + 2] = 1;
      look[i * 4 + 3] = 0;
      this.lookTargets[i * 3] = 0;
      this.lookTargets[i * 3 + 1] = 0;
      this.lookTargets[i * 3 + 2] = 1;
      this.lookNext[i] = 0;
      this.blinkT[i] = 0;
      this.blinkAt[i] = r() * EYES.blinkEvery[1];
    }
    this.lookAttribute.needsUpdate = true;
    for (let i = 0; i < this.arms.length; i++) {
      this.arms[i].dir.copy(this.arms[i].rest);
      this.setArm(this.armCrowd, i);
    }
    this.armCrowd.commit();
    for (const p of this.poolLights) p.light.intensity = 0;
  }
}
