import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  TorusGeometry,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYERS, REDUCED_MOTION } from '../../../config/experience.config';
import { LAYOUT } from '../../../config/nightmare.config';
import { walkConfig } from '../../../config/walk.config';
import { clamp, damp, DEG, lerp, range, wobble } from '../../math';
import { warpUniforms, WARP_GLSL } from '../../render/Warp';
import { GlideTrack } from '../../timeline/Track';
import { rigClock, setClock, type ClockHand } from '../ClockRig';
import { BEND_STEP, PropCrowd, type DreamKit } from '../DreamKit';
import type { DreamFrame, DreamModule } from '../DreamModule';
import { randomFrom, type Crowd, type FigureSpec, type HeroFigure } from '../FigureKit';
import type { DreamLight } from '../LightPool';

type V2 = readonly [number, number];
type V3 = readonly [number, number, number];

interface LampSpec {
  /** Where the light is. */
  at: V3;
  color: number;
  /** Candela at full level. */
  intensity: number;
  /** Reach (m). */
  reach: number;
  /** The glow in the haze around it: width (m; 0 for none) and strength. */
  halo: number;
  glow: number;
  /** Radius (m) of all it visibly lights: with none of that in view it asks nothing of the pool. */
  matters: number;
  /** What it lights fades out between these distances from the eye (m): it leaves the pool unseen. */
  fade: V2;
}

/** Everything worth adjusting after seeing it. Places are walk-frame meters (x, z unless three), angles degrees, times seconds. */
const tableauxConfig = {
  /** The right wall's face (x), which the heads are mounted on, and the end wall's (z). */
  wallX: LAYOUT.hall.halfWidth,
  endZ: LAYOUT.hall.to,
  /** A view counts as reaching a set piece this many degrees beyond its frame (curved space moves things a little). */
  cullMargin: 12,
  /** How a light goes out once: time to fall, time dark, time to come back (s), slower for those who ask for less motion. */
  dip: REDUCED_MOTION ? { down: 0.7, hold: 0.3, up: 1 } : { down: 0.11, hold: 0.24, up: 0.32 },
  /** Below this share of its light a lamp's island counts as unseen. */
  darkBelow: 0.06,
  /** How far (deg) beyond the frame a thing's middle must be before it changes unwatched: small things, big things, whole groups. */
  unwatched: { small: 5, big: 9, group: 16 },
  /** The shell's cold light fails once (walk fraction), and is out from this long after that until this long after that (s): the whole floor is unseen then. */
  shaftFails: { at: 0.437, from: 0.4, to: 1.25 },

  dinner: {
    table: [9.2, -80.5] as V2,
    rug: { size: [5.4, 6.5] as V2, center: [9.2, -80.45] as V2, height: 0.012, resolution: 512, seed: 41 },
    /** The light among the shades; the only warm light in the hall. */
    lamp: { at: [9.2, 2.92, -80.5], color: 0xff9c58, intensity: 15, reach: 13, halo: 8, glow: 0.3, matters: 9, fade: [26, 40] } as LampSpec,
    chandelier: { scale: 2, top: 3.95, cell: 0.017 },
    /** How brightly the paper of the shades shows the light. */
    shades: 0.9,
    /** The chain goes up into the dark: where it ends (y), the pitch and half width of a link (m). */
    chain: { top: 26, pitch: 0.14, width: 0.056 },
    /** Size of the cells things are simplified to (m): chairs, and what stands alone. */
    chairCell: 0.034,
    cell: 0.024,
    /** What has to keep more: the bodies, and small things (the head of the satyr, the hatchets, the frame of the mirror). */
    bodyCell: 0.012,
    smallCell: 0.012,
    /** The cell of the shadow they throw. */
    shadowCell: 0.085,
    /** Offsets from the table's center (x, z) and headings of the chairs: the man's two halves face each other, a second pair of legs faces the boy. */
    fatherLower: { at: [-0.92, 0.55] as V2, heading: 90 },
    otherLegs: { at: [-0.92, -0.55] as V2, heading: 90 },
    fatherUpper: { at: [0.92, 0.55] as V2, heading: -90 },
    boy: { at: [0.92, -0.55] as V2, heading: -90 },
    /** The chair at the head of the table, pulled out and turned for you. */
    empty: { at: [-0.1, 2.25] as V2, heading: -38 },
    /** The mother is a dress form: her chair, and where she stands through its seat. */
    mother: { at: [0, -1.62] as V2, heading: 0, scale: 1.3, standsAt: -1.55 },
    /** Where the men are cut (m above their feet). The boy is whole, the only one here who is: a child is never harmed in this piece. */
    cut: 0.62,
    /** Hips ahead of the chair's middle, seat height of the dining chair, the lift a boy needs to reach it (m). */
    sit: { hipsForward: 0.02, seat: 0.455, childLift: 0.05 },
    /** Which moments of the sitting clip they hold (s), and how the second pair of legs differs. */
    poses: { man: 0.6, other: 2.5, child: 0.3 },
    otherTint: 0x8f8f88,
    /** Offsets of the half plates from the table's center (x, y, z); yours is whole, and so is the serving plate. */
    plates: [
      [-0.5, 0.815, 0.55],
      [-0.5, 0.815, -0.55],
      [0.46, 0.815, 0.55],
      [0.46, 0.815, -0.55],
      [0, 0.815, -0.9],
    ] as readonly V3[],
    yourPlate: [0.02, 0.778, 0.88] as V3,
    hatchet: { at: [-0.2, 0.778, 0.86] as V3, heading: 8, scale: 1.1 },
    /** The satyr: height of its base (m, its peg goes into the table), size, and the serving plate's size. */
    satyr: { y: 0.77, scale: 0.3, servingPlate: 1.75 },
    clock: { at: [11.9, -79.3] as V2, heading: -90, scale: 1.3 },
    /** The dial's center in the model (where its hands turn), and the impossible half past: hour on XII, minute on VI (deg clockwise from XII). */
    dial: { x: 0, y: 1.733, hour: 0, minute: 180 },
    /** A mirror on the floor, all black, facing the slit you came through. */
    mirror: { at: [4.6, -76] as V2, heading: -22, lean: -6, scale: 2.5 },
    /** Walk fractions at which the chandelier goes out once (on entering; the family has turned when it comes back). */
    dips: [0.3505, 0.3605, 0.392],
    /** Afterwards it goes out now and then, this long apart (s). */
    dipEvery: [7, 16] as V2,
    /** How often they turn again to you while unwatched (frames). */
    follow: 12,
    poi: { y: 1.1, radius: 10, zoom: 0.72 },
  },

  classroom: {
    columns: [-13.8, -12.1, -10.4, -8.7],
    rows: [-114.4, -116.2, -118],
    /** Which desks have a child (row by row, one char per column). */
    seated: ['x.x.', '.xx.', 'x.xx'],
    /** Everything for children is this much smaller; the desk's distance in front of the chair; hips behind the chair's middle (m). */
    furniture: 0.82,
    deskAhead: 0.47,
    hipsBack: 0.04,
    /** Which sitting moments of the clip the children hold (s), one crowd for each. */
    poses: [0.3, 1.3],
    cell: 0.045,
    /** The children's bodies, the horse, and the shadow they all throw. */
    bodyCell: 0.038,
    horseCell: 0.02,
    shadowCell: 0.12,
    board: { at: [-11.4, -121.1] as V2, scale: 3, writing: { width: 640, height: 944, seed: 23 } },
    /** The teacher: where, where he ends, the horse's size, how high it starts and how far forward of his middle it sits (m). */
    teacher: { at: [-9.1, -119.8] as V2, cut: 1.45, horseScale: 2.2, horseBase: 1.2, horseForward: 0.12 },
    lamp: { at: [-11, 5.2, -117], color: 0xcfe8da, intensity: 30, reach: 12, halo: 3.2, glow: 0.2, matters: 9, fade: [24, 36] } as LampSpec,
    fixtureScale: 2,
    /** The tube goes out once here: when it comes back they are all facing you. */
    dips: [0.476],
    /** Nothing turns before you have come this far along (a walk fraction). */
    from: 0.38,
    /** The tube stutters (never above 3 Hz): how deep and how fast. */
    stutter: { amount: 0.22, rate: 1.3 },
    follow: 12,
  },

  screens: {
    /** Sets per row of each pile, from the floor up. */
    rows: [7, 6, 5, 4, 3, 2, 1],
    /** The piles start this far from the middle of the way (m), and stand this far from the end wall. */
    inner: 2.8,
    wall: 0.42,
    /** Each row starts this much further in than the last, plus up to this (m): a pyramid, but not a careful one. */
    climb: { step: 0.48, stray: 0.5 },
    /** The cell the sets are simplified to, in the model's own meters. */
    cell: 0.014,
    /** How much bigger than life the sets are, by kind, the odd giant in the bottom row and how many of them. */
    scale: { a: [1.55, 1.85] as V2, b: [2, 2.4] as V2, giant: 2.9 },
    giants: 2,
    /** How crooked: gap between sets (m), how they turn and tilt (deg), how far forward they stray (m). */
    crooked: { gap: 0.09, turn: 9, tilt: 3, forward: 0.45 },
    /** They more or less face a point this far from the end wall. */
    faces: 16,
    seed: 77,
    /** Share of sets that show only static, and of those that are dead. Others are close-ups of the same picture. */
    onlyStatic: 0.12,
    dead: 0.05,
    closeUps: 0.26,
    /** How close a close-up comes (share of the picture shown) and what it looks at (middle, how far off it strays). */
    closeUp: { zoom: [0.42, 0.64] as V2, x: [0.42, 0.58] as V2, y: [0.5, 0.66] as V2 },
    /** The picture: its size (px), how often it is drawn (every n frames), how near it must be (m), and looked at how nearly (deg beyond the frame). */
    picture: { width: 256, height: 192, every: 3, within: 40, margin: 25 },
    /** The static clears into the picture between these distances (m). */
    clearsAt: [38, 26] as V2,
    /** The lens that films your back: behind you, aside, above you (m), and where it looks on your body (m above the floor), field of view. */
    lens: { behind: 2.2, aside: 0.5, above: 1.05, lookAt: 1.12, fov: 56 },
    /** Its own lamp, on in the picture only: candela and reach. */
    filmLight: { intensity: 5, reach: 8, color: 0xdfe8ff },
    /** Each step of the second one, from behind the lens to the hand on your shoulder: how far behind you, how far aside (m). */
    steps: [
      [3.4, -1.3],
      [1.95, -0.95],
      [1.6, -0.72],
      [1.25, -0.52],
      [0.95, -0.34],
      [0.72, -0.18],
      [0.45, -0.03],
    ] as readonly V2[],
    /** The moment of the clip whose arm reaches out, and how its head lies on its neck (deg of roll). */
    follower: { clip: 'm_knock_door', time: 1.9, roll: 14 },
    /** Walk fractions at which the wall goes dark once. Each time it comes back the second one is a step closer. */
    drops: [0.463, 0.473, 0.4785, 0.484, 0.4945, 0.5035, 0.513],
    /** The least time between drops (s): never faster than this however fast you scroll. */
    dropGap: 0.7,
    /** Coming back it is static for this long (s). */
    clearing: 0.38,
    /** A step may also come from looking away, this long after the last (s). Slower drops bring more of them. */
    stepGap: 1.2,
    stepsPerDrop: REDUCED_MOTION ? 2 : 1,
    lamps: {
      color: 0xbcd0ff,
      intensity: 34,
      reach: 13,
      halo: 13,
      glow: 0.16,
      /** Its x (on both sides), height, and distance from the end wall. */
      at: [5.8, 1.6, 3.2] as V3,
      matters: 12,
      fade: [26, 38] as V2,
    },
    /** The picture's look: its exposure, screen brightness, tint of the darks, speed of the rolling bar (turns / s) and of the noise (steps / s). */
    gain: 5,
    bright: 1.5,
    tint: 0x8fb0ff,
    roll: 0.11,
    noiseRate: REDUCED_MOTION ? 2.5 : 24,
    /** Their light would go on through the end wall into the next space: gone by here (z), where they are out of frame anyway. */
    fadeOut: [-120.5, -123.5] as V2,
    poi: { at: [0, 2.8, -122.6] as V3, radius: 15, zoom: 0.72 },
  },

  heads: {
    /** Where their bases go into the wall (m): the rows; the columns are the middles of the bays between the wall's fins. */
    rows: [9.5, 13.6, 17.7],
    columns: [-80, -86, -92, -98, -104, -110],
    scale: 7,
    cell: 0.2,
    /** How far the bases sink into the concrete (m). */
    sunk: 1,
    /** Out of the wall, staring down: their tilt at rest (deg, from upright), and how far they may look when they look at you: up to, down to, and to the side. */
    stare: 72,
    looks: { least: 26, most: 72, aside: 48 },
    /** They look with what is this far above and out from their base (m). */
    eyes: { up: 0.9, out: 2.4 },
    /** Which cell (row, column) holds the gas mask, its scale, how far from the wall and how far above its row it hangs (m), how far it may tilt (deg). */
    mask: { row: 1, column: 2, scale: 4.2, reach: 0.5, above: 2.2, tilt: 12 },
    /**
     * One bare bulb hung close to the wall, under them: the shadows it throws run long and up the concrete. It is
     * the guillotine's light too, and that of the far end of the torsos: more lamps here would fight for the pool.
     */
    lamp: { at: [13.3, 7.4, -91], color: 0xcdd0d0, intensity: 50, reach: 18, halo: 3.5, glow: 0.2, matters: 17, fade: [28, 44] } as LampSpec,
    shadowCell: 0.24,
    /** The lamp fails once with the cold light (walk fraction). */
    dips: [0.4385],
    /** One more turns each time they are unseen; while you walk, at least this many by these walk fractions. */
    atLeast: [
      [0.38, 1],
      [0.43, 3],
      [0.44, 7],
      [0.47, 9],
      [0.52, 12],
    ] as readonly V2[],
    /** Those who look follow you while unwatched: how often (frames). */
    follow: 20,
    seed: 19,
  },

  gnomes: {
    /** Slots by detail: how many of each, the cell they are simplified to (m), and how far from the way they may stand (m). */
    tiers: [
      { count: 18, cell: 0.014, within: 2.4 },
      { count: 44, cell: 0.03, within: 3.8 },
      { count: 78, cell: 0.055, within: 99 },
    ],
    /** The first three, 2 m off the way, facing you on the wet floor (x, z), and their size. */
    first: [
      [0.75, -72.8],
      [1.45, -74.2],
      [0.35, -75.5],
    ] as readonly V2[],
    firstSize: 1.1,
    /** How many stand by the time your eye has come this far (z, count). */
    growth: [
      [-74, 3],
      [-85, 10],
      [-92, 18],
      [-100, 40],
      [-108, 84],
      [-115, 140],
    ] as readonly V2[],
    /** The cold light failing brings this many more at once. */
    whenTheLightFails: 14,
    /** Nobody stands closer to the way than this (m), or as far left as the beds (x, then beyond the last bed at this z, x). */
    clearOfWay: 1.25,
    ward: { x: -5.2, until: -105, then: -9.2 },
    /** Spots along the walk: between these z, how far from the way (m). */
    scatter: { from: -78, to: -104, count: 37, offset: [1.4, 4.6] as V2, spacing: 0.9 },
    /** The crowd around the slit: between these z and out to this x, this far apart at least (m). */
    crowd: { from: -103.5, to: -121.2, halfWidth: 8.6, spacing: 0.52 },
    size: [0.92, 1.28] as V2,
    seed: 5,
    /** A place this far off in the dark (m) is unseen too. */
    unnoticedAt: 25,
    /** How many may come at once while the floor is dark; how many at other times per frame. */
    inTheDark: 26,
    perFrame: 2,
    /** How many of those standing may turn to you each frame (only unseen, near ones). */
    reaimPerFrame: 7,
    reaimWithin: 16,
    /** They look at where you will be when you are this many times their distance from the way before them. */
    lead: 1.2,
    /** The lantern's cold glow. */
    lantern: { color: [0.42, 0.62, 1] as V3, strength: 0.55, rate: 14 },
    /** The dark patch each stands on: its width (m), height over the floor, and strength. */
    contact: { width: 0.62, y: 0.006, strength: 0.85 },
  },

  rats: {
    count: 8,
    scale: 2.2,
    cell: 0.016,
    /** Their runs along the walls and edges (from x, z, to x, z), and their speed (m/s). */
    runs: [
      [6.3, -77.2, 6.3, -83.4],
      [12.2, -77.3, 12.2, -82.9],
      [3.4, -71, 3.4, -66.8],
      [3.2, -94.9, 8.3, -94.9],
      [14.1, -92.8, 14.1, -86.5],
      [-5, -117.4, 5, -118.1],
      [-9.2, -121.7, -3.1, -121.7],
      [3.1, -121.5, 9.4, -121.5],
    ] as readonly (readonly [number, number, number, number])[],
    speed: REDUCED_MOTION ? 1.2 : 4.6,
    /** How far from the eye a rat still hears the lights (m). */
    hears: 34,
  },

  dentist: {
    at: [9, -91.4] as V2,
    heading: 90,
    scale: 1.1,
    cell: 0.032,
    shadowCell: 0.08,
    jaw: { at: [9, 1.72, -91.8] as V3, height: 1.2, sway: 0.6, swayPeriod: 11, wireApart: 0.32, cell: 0.03 },
    tray: { at: [7.4, -92.7] as V2, hatchet: 0.975 },
    lamp: { at: [8.3, 4.3, -90.9], color: 0xdde3d0, intensity: 15, reach: 9, halo: 3, glow: 0.2, matters: 7, fade: [16, 26] } as LampSpec,
    /** The caged light: its size, how far above the light it hangs, its height and the distance of its chains in the model. */
    fixture: { scale: 1.5, lift: 0.2, height: 0.75, apart: 0.21, cell: 0.03, heat: 3.5 },
    dips: [0.41],
    stutter: { amount: 0.14, rate: 0.9 },
  },

  cameras: {
    /** Where they stand, and which way they first look (deg from +z): never at you. The last three watch the head. */
    stand: [
      [4.6, -85.2, 40],
      [7, -88.3, 110],
      [5, -90.6, 200],
      [13.1, -85.6, 215],
      [12.9, -80.4, 270],
      [5.5, -81.5, 165],
      [3.5, -98.6, 130],
      [3.45, -104.4, 94],
      [3.6, -110.2, 55],
    ] as readonly V3[],
    scale: 1.9,
    cell: 0.03,
    /** The camera turns about this share of its height; where its lens is (share of height, ahead). */
    head: 0.73,
    lens: [0.87, 0.177] as V2,
    glint: { size: 0.34, color: 0xbfd4ff, strength: 0.28 },
    /** Most it tilts toward you (deg). */
    maxPitch: 25,
    /** How often those that look at you turn again while unwatched (frames). */
    follow: 14,
  },

  guillotine: {
    at: [12.4, -90] as V2,
    /** It faces the slit you came in by: from there you see it from the front, black against the head. */
    heading: -26,
    height: 5.5,
    /** The blade's center lies at this share of the height in the model, and is moved to this: exactly halfway. */
    bladeFrom: 0.84,
    bladeAt: 0.585,
    /** The row, from the guillotine toward you: how far from its middle the first stands and how far apart they stand (m); the last is the barber's. */
    row: { first: 3.1, spacing: 1.15, irons: 3, ironScale: 1.32 },
    shadowCell: 0.05,
  },

  torsos: {
    count: 16,
    /** Dead straight, just in front of the fins of the wall. */
    x: 14.05,
    from: -69.2,
    spacing: 1.55,
    scale: 1.75,
    cell: 0.09,
    /** The stand is thin: below this share of the height it is simplified only along its height. */
    standBelow: 0.52,
    /** The veil's strands, their segments and width (m); it waits on the torso nearest this far ahead of you. */
    veil: { strands: 170, segments: 7, width: 0.012, length: [0.45, 1.05] as V2, ahead: 9, startsOn: 2, seed: 61 },
    /** Those near enough to the bulb of the heads throw shadows (how many, from the far end), simplified to this. */
    casting: 8,
    shadowCell: 0.09,
  },

  clocks: {
    slab: { at: [5.75, -95.3] as V2, size: [4.9, 2.1, 0.38] as V3 },
    count: 12,
    height: 1.28,
    /** How far the clocks stand off the slab (m), how far apart (m), their size. */
    off: 0.03,
    spacing: 0.37,
    scale: 1.28,
    cell: 0.02,
    glassCell: 0.05,
    /** All at half past, each another hour, the second hand down too. This one runs back, a tick at a time. */
    backwards: 7,
    ticksPerSecond: 1.4,
    secondsPerTick: 7.5,
    lamp: { at: [5.75, 3.1, -94.3], color: 0xe6e0cc, intensity: 8, reach: 6, halo: 1.8, glow: 0.2, matters: 5, fade: [12, 20] } as LampSpec,
  },

  /** A bare bulb: its socket (a node of the model), the cell (m) they are simplified to, their size, and how hot it looks at full level. */
  bulb: { socket: 'pull_chain_light_socket', cell: 0.008, scale: 1.7, heat: 7 },
  /** Wires: their half width, and how high they go (m). */
  wire: 0.009,
  wireTop: LAYOUT.hall.height,
  /** Room for this many glows. */
  halos: 20,
} as const;

const T = tableauxConfig;

const UP = new Vector3(0, 1, 0);
const SIT_CLIP = 'm_sit_chair_idle_roll_head';
const HEAD_BONE = 'Bip01_Head';
const SHAFT_FAILS = [T.shaftFails.at];
const FROM_THE_SLIT = new Vector3(0, 1.62, LAYOUT.hall.from);

const v1 = new Vector3();
const v2 = new Vector3();
const v3 = new Vector3();
const s1 = new Vector3();
const q1 = new Quaternion();
const q2 = new Quaternion();
const e1 = new Euler(0, 0, 0, 'YXZ');
const m1 = new Matrix4();
const m2 = new Matrix4();
const c1 = new Color();

// ------------------------------------------------------------------ shapes

/** Normals this far apart (levels per unit) and places on the texture this far apart (patches per unit) stay apart when simplifying. */
const NORMAL_LEVELS = 1.5;
const TEXTURE_PATCHES = 24;
/** What stands too thin for its cell gets a cell this many times smaller across (not along its height). */
const THIN = 0.2;

type Keep = (x: number, y: number, z: number) => boolean;

/**
 * Fewer triangles for the same silhouette: everything inside one cell of space (in the geometry's own
 * units) becomes one point. Vertices that face differently, or lie on different patches of the texture,
 * stay apart but share their place, so nothing cracks open. `thin` says what is too slender for its cell.
 */
function coarser(source: BufferGeometry, cell: number, thin?: Keep): BufferGeometry {
  const position = source.getAttribute('position');
  const normal = source.getAttribute('normal');
  const uv = source.getAttribute('uv');
  const count = position.count;

  const places = new Map<number, number>();
  const placeOf = new Int32Array(count);
  const sums: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const fine = thin?.(x, y, z) ?? false;
    const across = fine ? cell * THIN : cell;
    const cellKey = (Math.round(x / across) + 65536) * 17179869184 + (Math.round(y / cell) + 65536) * 131072 + (Math.round(z / across) + 65536);
    const key = fine ? -cellKey : cellKey;
    let place = places.get(key);
    if (place === undefined) {
      place = sums.length / 4;
      places.set(key, place);
      sums.push(0, 0, 0, 0);
    }
    placeOf[i] = place;
    sums[place * 4] += x;
    sums[place * 4 + 1] += y;
    sums[place * 4 + 2] += z;
    sums[place * 4 + 3]++;
  }

  const vertices = new Map<string, number>();
  const vertexOf = new Int32Array(count);
  const out: { place: number; nx: number; ny: number; nz: number; u: number; v: number; n: number }[] = [];
  for (let i = 0; i < count; i++) {
    const nx = normal ? normal.getX(i) : 0;
    const ny = normal ? normal.getY(i) : 1;
    const nz = normal ? normal.getZ(i) : 0;
    const u = uv ? uv.getX(i) : 0;
    const w = uv ? uv.getY(i) : 0;
    const key = `${placeOf[i]}/${Math.round(nx * NORMAL_LEVELS)},${Math.round(ny * NORMAL_LEVELS)},${Math.round(nz * NORMAL_LEVELS)}/${Math.floor(u * TEXTURE_PATCHES)},${Math.floor(w * TEXTURE_PATCHES)}`;
    let vertex = vertices.get(key);
    if (vertex === undefined) {
      vertex = out.length;
      vertices.set(key, vertex);
      out.push({ place: placeOf[i], nx: 0, ny: 0, nz: 0, u: 0, v: 0, n: 0 });
    }
    vertexOf[i] = vertex;
    const o = out[vertex];
    o.nx += nx;
    o.ny += ny;
    o.nz += nz;
    o.u += u;
    o.v += w;
    o.n++;
  }

  const index = source.index;
  const corners = index ? index.count : count;
  const kept: number[] = [];
  const seen = new Set<string>();
  for (let t = 0; t + 2 < corners; t += 3) {
    const a = vertexOf[index ? index.getX(t) : t];
    const b = vertexOf[index ? index.getX(t + 1) : t + 1];
    const c = vertexOf[index ? index.getX(t + 2) : t + 2];
    if (out[a].place === out[b].place || out[b].place === out[c].place || out[c].place === out[a].place) continue;
    // the same triangle twice is one triangle; its back is another
    const first = Math.min(a, b, c);
    const key = first === a ? `${a},${b},${c}` : first === b ? `${b},${c},${a}` : `${c},${a},${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(a, b, c);
  }

  const positions = new Float32Array(out.length * 3);
  const normals = new Float32Array(out.length * 3);
  const uvs = new Float32Array(out.length * 2);
  out.forEach((o, i) => {
    const n = sums[o.place * 4 + 3];
    positions[i * 3] = sums[o.place * 4] / n;
    positions[i * 3 + 1] = sums[o.place * 4 + 1] / n;
    positions[i * 3 + 2] = sums[o.place * 4 + 2] / n;
    const l = Math.hypot(o.nx, o.ny, o.nz) || 1;
    normals[i * 3] = o.nx / l;
    normals[i * 3 + 1] = o.ny / l;
    normals[i * 3 + 2] = o.nz / l;
    uvs[i * 2] = o.u / o.n;
    uvs[i * 2 + 1] = o.v / o.n;
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  if (uv) geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(kept);
  return geometry;
}

function meshesOf(root: Object3D): Mesh[] {
  const list: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) list.push(o as Mesh);
  });
  return list;
}

/** Every mesh of a placed object simplified to this cell (m in the world it was placed in); `thin` is asked in that world too. */
function coarsen<T extends Object3D>(root: T, cell: number, thin?: Keep): T {
  root.updateMatrixWorld(true);
  for (const mesh of meshesOf(root)) {
    const world = mesh.matrixWorld;
    const inWorld: Keep | undefined = thin && ((x, y, z) => {
      v3.set(x, y, z).applyMatrix4(world);
      return thin(v3.x, v3.y, v3.z);
    });
    mesh.geometry = coarser(mesh.geometry, cell / world.getMaxScaleOnAxis(), inWorld);
  }
  return root;
}

/** Many of a model, simplified, each resting on its base at the origin until placed. */
function coarseCrowd(kit: DreamKit, key: string, count: number, scale: number, cell: number): PropCrowd {
  return new PropCrowd(coarsen(kit.prop(key, [0, 0, 0], { scale }), cell), count, false);
}

/** A crowd of bodies far enough away to do with less of them. */
function coarsenBodies(crowd: Crowd, cell: number): void {
  for (const mesh of crowd.root.children as Mesh[]) mesh.geometry = coarser(mesh.geometry, cell);
}

/** Copies of one placed model in one instanced mesh per part. They may differ inside, as a clock's hands do. */
function bakeCopies(copies: readonly Object3D[], cell: number, glassCell: number): Group {
  const group = new Group();
  const parts = copies.map((c) => {
    c.updateMatrixWorld(true);
    return meshesOf(c);
  });
  parts[0].forEach((mesh, j) => {
    const dense = (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3 > 100;
    const size = (mesh.material as Material).transparent ? glassCell : cell;
    const geometry = dense ? coarser(mesh.geometry, size / mesh.matrixWorld.getMaxScaleOnAxis()) : mesh.geometry;
    const instanced = new InstancedMesh(geometry, mesh.material, copies.length);
    parts.forEach((list, i) => instanced.setMatrixAt(i, list[j].matrixWorld));
    group.add(instanced);
  });
  return group;
}

/** Give the parts of an object the materials named here (the models of a set use the same few names). */
function repaint(root: Object3D, by: Readonly<Record<string, Material>>): void {
  for (const mesh of meshesOf(root)) {
    const name = (mesh.material as Material).name;
    if (by[name]) mesh.material = by[name];
  }
}

/** The thin wires and cords of the hall that bend with space, gathered into one mesh in the end. */
class Wires {
  private readonly pieces: BufferGeometry[] = [];

  add(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const length = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const geometry = new CylinderGeometry(T.wire, T.wire, length, 4, Math.ceil(length / BEND_STEP), true);
    geometry.applyMatrix4(
      m1.compose(v1.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), q1.setFromUnitVectors(UP, v2.set(x1 - x0, y1 - y0, z1 - z0).normalize()), s1.set(1, 1, 1)),
    );
    this.pieces.push(geometry);
  }

  mesh(): Mesh {
    const mesh = new Mesh(mergeGeometries(this.pieces)!, new MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.6, metalness: 0.4 }));
    mesh.name = 'Wires';
    return mesh;
  }
}

/** Facing from one place to another on the floor (rad, 0 faces +z). */
const headingTo = (fromX: number, fromZ: number, toX: number, toZ: number): number => Math.atan2(toX - fromX, toZ - fromZ);

/** A transform: place, heading (rad), tilt down (rad), uniform size. */
function pose(out: Matrix4, x: number, y: number, z: number, heading: number, pitch = 0, scale = 1): Matrix4 {
  return out.compose(v1.set(x, y, z), q1.setFromEuler(e1.set(pitch, heading, 0, 'YXZ')), s1.setScalar(scale));
}

const walkAt = walkConfig.keys.map((k) => k.at);
const walkXs = new GlideTrack(walkAt, walkConfig.keys.map((k) => k.position[0]));
const walkZs = new GlideTrack(walkAt, walkConfig.keys.map((k) => k.position[2]));
/** The part of the walk the hall lies in, the steps it is sampled in, and what comes of that: z and x at each step, z falling. */
const HALL_WALK: V2 = [0.3, 0.56];
const WAY_STEPS = 256;
const WAY = Array.from({ length: WAY_STEPS + 1 }, (_, i) => {
  const at = lerp(HALL_WALK[0], HALL_WALK[1], i / WAY_STEPS);
  return { z: walkZs.at(at), x: walkXs.at(at) };
});

/** The walk's x at a z of the hall. */
function wayX(z: number): number {
  let i = 0;
  while (i < WAY_STEPS - 1 && WAY[i + 1].z > z) i++;
  return lerp(WAY[i].x, WAY[i + 1].x, clamp((WAY[i].z - z) / (WAY[i].z - WAY[i + 1].z), 0, 1));
}

/** Can this camera see anything of a sphere? (Generously: space is curved.) */
function sphereSeen(camera: PerspectiveCamera, center: Vector3, radius: number): boolean {
  v1.subVectors(center, camera.position);
  const distance = v1.length();
  if (distance <= radius) return true;
  v2.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const half = Math.atan(Math.tan((camera.fov * DEG) / 2) * Math.hypot(1, camera.aspect));
  return v2.angleTo(v1) - Math.asin(radius / distance) < half + T.cullMargin * DEG;
}

/** Did the walk just pass one of these fractions, going forward? */
function passed(keys: readonly number[], before: number, now: number): boolean {
  for (let i = 0; i < keys.length; i++) if (before < keys[i] && now >= keys[i]) return true;
  return false;
}

// ------------------------------------------------------------------ light

const HALO_VERT = /* glsl */ `
#include <fog_pars_vertex>
${WARP_GLSL}
uniform float uPull;
varying vec2 vOffset;
varying vec3 vGlow;
void main() {
  vGlow = instanceColor;
  vOffset = position.xy * 2.0;
  vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  // a quad facing the eye, drawn nearer to it (never past halfway) and shrunk as much, so what it surrounds does not cut it
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float dist = length(mvPosition.xyz);
  float keep = 1.0 - min(uPull * min(size.x, size.y), dist * 0.5) / max(dist, 1e-4);
  #ifdef USE_FOG
    vFogDepth = dist;
  #endif
  mvPosition.xyz *= keep;
  mvPosition.xy += position.xy * size * keep;
  gl_Position = projectionMatrix * dreamWarp(mvPosition);
}
`;

const HALO_FRAG = /* glsl */ `
#include <fog_pars_fragment>
uniform float uScatter;
varying vec2 vOffset;
varying vec3 vGlow;
void main() {
  float r2 = dot(vOffset, vOffset);
  if (r2 >= 1.0) discard;
  float edge = 1.0 / (1.0 + uScatter);
  float glow = (1.0 / (1.0 + r2 * uScatter) - edge) / (1.0 - edge);
  vec3 c = vGlow * glow;
  #ifdef FOG_EXP2
    // on its way through the haze a glow fades; it does not take the haze's color
    c *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #endif
  gl_FragColor = vec4(c, 1.0);
}
`;

/** Soft glows in the haze around what shines: one draw for all of them. */
class Halos {
  readonly mesh: InstancedMesh;
  private used = 0;
  private dirty = false;

  constructor(capacity: number) {
    const material = new ShaderMaterial({
      vertexShader: HALO_VERT,
      fragmentShader: HALO_FRAG,
      uniforms: { ...UniformsUtils.merge([UniformsLib.fog, { uScatter: { value: 18 }, uPull: { value: 0.3 } }]), ...warpUniforms },
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, capacity);
    this.mesh.name = 'Halos';
    // after everything else that is see-through: additive, its order among others does not matter
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
  }

  add(at: Vector3, size: number): number {
    const slot = this.used++;
    this.mesh.setMatrixAt(slot, m1.compose(at, q1.identity(), s1.set(size, size, 1)));
    this.mesh.setColorAt(slot, c1.setScalar(0));
    this.mesh.count = this.used;
    return slot;
  }

  write(slot: number, color: Color, strength: number): void {
    this.mesh.setColorAt(slot, c1.copy(color).multiplyScalar(strength));
    this.dirty = true;
  }

  move(slot: number, at: Vector3, size: number): void {
    this.mesh.setMatrixAt(slot, m1.compose(at, q1.identity(), s1.set(size, size, 1)));
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  commit(): void {
    if (this.dirty && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.dirty = false;
  }
}

/** A light of the dream, what is seen to burn in it, and its glow in the haze: all at one level (0..1). */
class Lamp {
  readonly light: DreamLight;
  /** The glass or filament (unlit: it is the light). */
  readonly burning: MeshBasicMaterial;
  private readonly hot: Color;
  private readonly tint: Color;
  private readonly slot: number;

  constructor(kit: DreamKit, private readonly halos: Halos, private readonly spec: LampSpec) {
    this.light = kit.lights.add(spec.at, spec.color, spec.intensity, spec.reach);
    this.hot = new Color(spec.color).multiplyScalar(T.bulb.heat);
    this.burning = new MeshBasicMaterial({ color: this.hot.clone() });
    this.tint = new Color(spec.color).multiplyScalar(spec.glow);
    this.slot = spec.halo > 0 ? halos.add(this.light.position, spec.halo) : -1;
  }

  /** It shines this much; the pool is left alone while nothing it lights is in this view, or it is too far off to matter. */
  shine(level: number, view: PerspectiveCamera): void {
    const S = this.spec;
    const near = 1 - range(S.fade[0], S.fade[1], this.light.position.distanceTo(view.position));
    this.light.intensity = near > 0 && sphereSeen(view, this.light.position, S.matters) ? S.intensity * level * near : 0;
    this.burning.color.copy(this.hot).multiplyScalar(level);
    if (this.slot >= 0) this.halos.write(this.slot, this.tint, level);
  }
}

/** A light going out once and coming back. */
class Dip {
  /** How much of it is left (0..1). */
  level = 1;
  /** It fell dark during this very frame: now anything may change there. */
  fell = false;
  private at = -1;

  get dark(): boolean {
    return this.level < T.darkBelow;
  }

  start(): void {
    if (this.at < 0) this.at = 0;
  }

  advance(dt: number): void {
    this.fell = false;
    if (this.at < 0) {
      this.level = 1;
      return;
    }
    const { down, hold, up } = T.dip;
    const before = this.at;
    this.at += dt;
    if (before < down && this.at >= down) this.fell = true;
    if (this.at < down) this.level = 1 - this.at / down;
    else if (this.at < down + hold) this.level = 0;
    else if (this.at < down + hold + up) this.level = (this.at - down - hold) / up;
    else {
      this.at = -1;
      this.level = 1;
    }
  }

  reset(): void {
    this.at = -1;
    this.level = 1;
    this.fell = false;
  }
}

/**
 * What small practical lights cannot do by themselves: shadows. Shapes laid flat on a floor or a wall as
 * seen from one bulb, all in one mesh of plain black. Baked on the processor, and only again when something
 * has moved unwatched. A shadow is of the whole shape: a body that ends still throws all of itself.
 */
class FlatShadow {
  readonly mesh: Mesh;
  private readonly cast = new Matrix4();
  private readonly casters: { from: Mesh; count: number; shape: BufferGeometry; start: number }[] = [];
  private readonly geometry = new BufferGeometry();
  private vertices = 0;
  private owed = false;

  /** From a bulb at `light`, onto the plane where normal · p = distance. */
  constructor(light: Vector3, normal: Vector3, distance: number) {
    const dot = normal.dot(light) - distance;
    const { x, y, z } = light;
    // the classic planar projection: dot · I - (light, 1) ⊗ (normal, -distance)
    this.cast.set(
      dot - x * normal.x, -x * normal.y, -x * normal.z, x * distance,
      -y * normal.x, dot - y * normal.y, -y * normal.z, y * distance,
      -z * normal.x, -z * normal.y, dot - z * normal.z, z * distance,
      -normal.x, -normal.y, -normal.z, dot + distance,
    );
    this.mesh = new Mesh(this.geometry, new MeshBasicMaterial({ color: 0x000000, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    this.mesh.name = 'FlatShadow';
  }

  /** All that is drawn under this object casts, simplified to this cell (m). Place it first; it must lie below the bulb. */
  add(root: Object3D, cell: number): this {
    root.updateMatrixWorld(true);
    for (const mesh of meshesOf(root)) {
      const instanced = mesh as InstancedMesh;
      const many = instanced.isInstancedMesh;
      if (many) instanced.getMatrixAt(0, m1);
      const scale = many ? m1.getMaxScaleOnAxis() : mesh.matrixWorld.getMaxScaleOnAxis();
      // a shadow has neither texture nor normals: nothing keeps its points apart
      const bare = new BufferGeometry();
      bare.setAttribute('position', mesh.geometry.getAttribute('position'));
      bare.setIndex(mesh.geometry.index);
      const shape = coarser(bare, cell / scale);
      const count = many ? instanced.count : 1;
      this.casters.push({ from: mesh, count, shape, start: this.vertices });
      this.vertices += shape.getAttribute('position').count * count;
    }
    return this;
  }

  /** Everything has been added: lay it down. */
  finish(): this {
    const index: number[] = [];
    for (const c of this.casters) {
      const source = c.shape.index!;
      const size = c.shape.getAttribute('position').count;
      for (let i = 0; i < c.count; i++) {
        for (let k = 0; k < source.count; k++) index.push(c.start + i * size + source.getX(k));
      }
    }
    this.geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(this.vertices * 3), 3));
    this.geometry.setIndex(index);
    this.bake();
    return this;
  }

  /** Something moved: it will be laid down again, as soon as it can be seen. */
  owe(): void {
    this.owed = true;
  }

  /** Pay what is owed if anything within this sphere can be seen. */
  settle(view: PerspectiveCamera, center: Vector3, radius: number): void {
    if (!this.owed || !sphereSeen(view, center, radius)) return;
    this.owed = false;
    this.bake();
  }

  private bake(): void {
    const out = this.geometry.getAttribute('position') as Float32BufferAttribute;
    const array = out.array as Float32Array;
    for (const c of this.casters) {
      const instanced = c.from as InstancedMesh;
      const p = c.shape.getAttribute('position');
      const size = p.count;
      for (let i = 0; i < c.count; i++) {
        if (instanced.isInstancedMesh) instanced.getMatrixAt(i, m1);
        else m1.copy(c.from.matrixWorld);
        const e = m2.multiplyMatrices(this.cast, m1).elements;
        let o = (c.start + i * size) * 3;
        for (let k = 0; k < size; k++) {
          const x = p.getX(k);
          const y = p.getY(k);
          const z = p.getZ(k);
          const w = e[3] * x + e[7] * y + e[11] * z + e[15];
          array[o++] = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
          array[o++] = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
          array[o++] = (e[2] * x + e[6] * y + e[10] * z + e[14]) / w;
        }
      }
    }
    out.needsUpdate = true;
  }
}

/** A cord from the dark, a socket, and a bulb that burns with `lamp`. */
function hangBulb(kit: DreamKit, group: Group, wires: Wires, lamp: Lamp): void {
  const { x, y, z } = lamp.light.position;
  const B = T.bulb;
  const socketAt = y + 0.05 * B.scale;
  group.add(coarsen(kit.prop('pull_chain_socket', [x, socketAt, z], { nodes: [B.socket], scale: B.scale }), B.cell));
  group.add(kit.paint(coarsen(kit.prop('lightbulb', [x, y, z], { rotation: [180, 0, 0], scale: B.scale, anchor: 'center' }), B.cell), lamp.burning));
  wires.add(x, socketAt + 0.05 * B.scale, z, x, T.wireTop, z);
}

// ------------------------------------------------------------------ the dinner

/** A worn carpet, oxblood and black: a room's floor, with no room. */
function drawRug(width: number, height: number, seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const rnd = randomFrom(seed);
  ctx.fillStyle = '#2c0a09';
  ctx.fillRect(0, 0, width, height);
  const band = (inset: number, line: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = line;
    ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
  };
  band(8, 16, '#120605');
  band(30, 6, '#6a4a2c');
  band(52, 26, '#14080a');
  band(76, 4, '#6a4a2c');
  // a row of diamonds in the border, and a large medallion in the field
  const diamond = (x: number, y: number, rx: number, ry: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - rx, y);
    ctx.lineTo(x, y - ry);
    ctx.lineTo(x + rx, y);
    ctx.lineTo(x, y + ry);
    ctx.closePath();
    ctx.fill();
  };
  for (let x = 66; x < width - 50; x += 26) {
    diamond(x, 52, 9, 9, '#5a2a1c');
    diamond(x, height - 52, 9, 9, '#5a2a1c');
  }
  for (let y = 66; y < height - 50; y += 26) {
    diamond(52, y, 9, 9, '#5a2a1c');
    diamond(width - 52, y, 9, 9, '#5a2a1c');
  }
  const cx = width / 2;
  const cy = height / 2;
  for (let i = 6; i > 0; i--) diamond(cx, cy, (width * 0.34 * i) / 6, (height * 0.36 * i) / 6, i % 2 ? '#431410' : '#1c0a0a');
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.45 + rnd() * 0.5;
    diamond(cx + Math.cos(a) * r * width * 0.36, cy + Math.sin(a) * r * height * 0.4, 3 + rnd() * 6, 3 + rnd() * 6, rnd() < 0.5 ? '#54301e' : '#190808');
  }
  // worn through where feet and chair legs went, every evening
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 260; i++) {
    const shade = Math.round(120 + rnd() * 120);
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.beginPath();
    ctx.ellipse(rnd() * width, rnd() * height, 6 + rnd() * 46, 3 + rnd() * 26, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

/** A plate turned on a lathe: all of it, or only part (phi, rad). */
function plateGeometry(phi: number, segments: number): BufferGeometry {
  const profile = [
    [0, 0],
    [0.056, 0],
    [0.062, 0.004],
    [0.09, 0.008],
    [0.122, 0.018],
    [0.13, 0.024],
    [0.126, 0.025],
    [0.114, 0.02],
    [0.084, 0.0125],
    [0.058, 0.0085],
    [0, 0.0085],
  ].map(([r, h]) => new Vector2(r, h));
  return new LatheGeometry(profile, segments, 0, phi);
}

/** The point of a hand farthest from a place in its parent's frame: where the hand points, from its pivot. */
function tipOf(mesh: Mesh, pivot: Vector3): Vector3 {
  const p = mesh.geometry.getAttribute('position');
  const tip = new Vector3();
  let best = -1;
  for (let i = 0; i < p.count; i++) {
    v1.fromBufferAttribute(p, i).multiply(mesh.scale).add(mesh.position).sub(pivot);
    const d = v1.lengthSq();
    if (d > best) {
      best = d;
      tip.copy(v1);
    }
  }
  return tip;
}

interface Seat {
  x: number;
  z: number;
  rest: number;
  /** Which body sits here (or nobody), how high it sits, and which chair of the crowd it is. */
  body: Crowd | null;
  y: number;
  chair: number;
}

/** Chairs of the dinner by the place they have in the crowd. */
const CHAIR = { fatherLower: 0, fatherUpper: 1, otherLegs: 2, boy: 3, mother: 4, empty: 5, count: 6 } as const;

/**
 * THE DINNER. A room's furniture in the concrete, under a chandelier on a very long chain, and a family of
 * halves around the table: a man's legs opposite the man's chest, another pair of legs opposite a boy who is whole
 * and does not look up, a dress form for the mother, a satyr's head on the serving plate. Absolutely still, until
 * the light goes out for a moment, or you look away: then they are facing you. One chair is pulled out, for you.
 */
class Dinner {
  readonly group = new Group();
  readonly center: Vector3;
  /** It goes up out of the island: it is never culled with it. */
  readonly chain: InstancedMesh;
  private readonly lamp: Lamp;
  private readonly dip = new Dip();
  private readonly seats: Seat[];
  private readonly chairs: PropCrowd;
  private readonly mother: Object3D;
  private readonly satyr: Object3D;
  private readonly shadow: FlatShadow;
  private readonly shades = { value: 1 };
  private readonly rnd = randomFrom(T.dinner.rug.seed);
  /** 0 all at table; 1 the father has turned; 2 all have. */
  private stage = 0;
  private nextDip = 0;
  private ticks = 0;

  constructor(kit: DreamKit, halos: Halos) {
    const D = T.dinner;
    const [tx, tz] = D.table;
    this.group.name = 'Dinner';
    this.center = new Vector3(tx, 1, tz);

    this.buildRug();
    this.lamp = new Lamp(kit, halos, D.lamp);
    this.chain = this.buildChandelier(kit);

    const table = kit.prop('dining_table', [tx, 0, tz], { rotation: [0, 90, 0] });
    this.group.add(table);

    // the chairs: four for the halves, one for the mother, one pulled out for you
    this.chairs = coarseCrowd(kit, 'dining_chair', CHAIR.count, 1, D.chairCell);
    this.group.add(this.chairs.root);
    const man = { avatar: 'figure_man', clip: SIT_CLIP, time: D.poses.man, face: 'blank' } as const;
    const boy = { avatar: 'figure_child', clip: SIT_CLIP, time: D.poses.child, face: 'blank' } as const;
    const body = (spec: FigureSpec) => {
      const crowd = kit.figures.crowd(spec, 1);
      coarsenBodies(crowd, D.bodyCell);
      this.group.add(crowd.root);
      return crowd;
    };
    const fatherLower = body({ ...man, half: 'lower', cutAt: D.cut });
    const fatherUpper = body({ ...man, half: 'upper', cutAt: D.cut });
    const otherLegs = body({ ...man, time: D.poses.other, half: 'lower', cutAt: D.cut, tint: D.otherTint });
    const whole = body(boy);
    const seat = (s: { at: V2; heading: number }, chair: number, crowd: Crowd | null, y: number): Seat => ({
      x: tx + s.at[0],
      z: tz + s.at[1],
      rest: s.heading * DEG,
      body: crowd,
      y,
      chair,
    });
    this.seats = [
      seat(D.fatherLower, CHAIR.fatherLower, fatherLower, 0),
      seat(D.fatherUpper, CHAIR.fatherUpper, fatherUpper, D.sit.seat - D.cut),
      seat(D.otherLegs, CHAIR.otherLegs, otherLegs, 0),
      seat(D.boy, CHAIR.boy, whole, D.sit.childLift),
      seat(D.mother, CHAIR.mother, null, 0),
      seat(D.empty, CHAIR.empty, null, 0),
    ];

    // she stands through her chair's seat, as tall as one who sits
    this.mother = coarsen(kit.prop('corset_mannequin', [tx + D.mother.at[0], 0, tz + D.mother.standsAt], { scale: D.mother.scale }), D.cell);
    this.group.add(this.mother);

    this.satyr = this.buildTable(kit);
    const clock = this.buildClock(kit);
    const mirror = this.buildMirror(kit);

    this.shadow = new FlatShadow(this.lamp.light.position, UP, D.rug.height + 0.008);
    this.place(FROM_THE_SLIT);
    this.shadow.add(table, D.shadowCell).add(this.chairs.root, D.shadowCell);
    for (const crowd of [fatherLower, fatherUpper, otherLegs, whole]) this.shadow.add(crowd.root, D.shadowCell);
    this.shadow.add(this.mother, D.shadowCell).add(clock, D.shadowCell).add(mirror, D.shadowCell).finish();
    this.group.add(this.shadow.mesh);

    kit.poi({ position: new Vector3(tx, D.poi.y, tz), radius: D.poi.radius, zoom: D.poi.zoom });
  }

  private buildRug(): void {
    const R = T.dinner.rug;
    const map = new CanvasTexture(drawRug(R.resolution, Math.round((R.resolution * R.size[1]) / R.size[0]), R.seed));
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = 4;
    const rug = new Mesh(
      new PlaneGeometry(R.size[0], R.size[1], Math.ceil(R.size[0] / BEND_STEP), Math.ceil(R.size[1] / BEND_STEP)),
      new MeshStandardMaterial({ map, roughness: 0.96, metalness: 0 }),
    );
    rug.name = 'Rug';
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(R.center[0], R.height, R.center[1]);
    rug.receiveShadow = true;
    this.group.add(rug);
  }

  private buildChandelier(kit: DreamKit): InstancedMesh {
    const D = T.dinner;
    const [x, , z] = D.lamp.at;
    const chandelier = coarsen(kit.prop('chandelier', [x, D.chandelier.top, z], { scale: D.chandelier.scale, anchor: 'top' }), D.chandelier.cell);
    for (const mesh of meshesOf(chandelier)) {
      const source = mesh.material as MeshStandardMaterial;
      if (/lamps/.test(source.name)) {
        mesh.material = this.lamp.burning;
        continue;
      }
      // the paper of the shades lets the light through (what is pale in the map; the brass is not)
      const glowing = source.clone();
      glowing.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
        shader.uniforms.uShades = this.shades;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uShades;')
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            float paper = smoothstep(0.32, 0.58, dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)));
            totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.56, 0.26) * paper * uShades;`,
          );
      };
      glowing.customProgramCacheKey = () => 'tableaux-shades';
      mesh.material = glowing;
    }
    this.group.add(chandelier);

    // the chain: real links, every other one turned, up into the dark
    const C = D.chain;
    const from = D.chandelier.top - 0.02;
    const count = Math.ceil((C.top - from) / C.pitch);
    const link = new TorusGeometry(1, 0.2, 3, 6).scale(C.width * 0.62, C.width, C.width * 0.62);
    const links = new InstancedMesh(link, new MeshStandardMaterial({ color: 0x14110e, roughness: 0.5, metalness: 0.75 }), count);
    links.name = 'Chain';
    for (let i = 0; i < count; i++) links.setMatrixAt(i, pose(m1, x, from + i * C.pitch, z, i % 2 ? Math.PI / 2 : 0));
    return links;
  }

  /** The cloth is laid: half plates, a whole one for you with a hatchet beside it, and the head of a satyr, grinning, on the serving plate. */
  private buildTable(kit: DreamKit): Object3D {
    const D = T.dinner;
    const [tx, tz] = D.table;
    const porcelain = new MeshStandardMaterial({ color: 0xd9d5c9, roughness: 0.26, metalness: 0, side: DoubleSide });
    const halves = new InstancedMesh(plateGeometry(Math.PI, 10), porcelain, D.plates.length);
    halves.name = 'HalfPlates';
    D.plates.forEach(([x, y, z], i) => halves.setMatrixAt(i, pose(m1, tx + x, y, tz + z, ((i * 83 + 20) % 360) * DEG)));
    const wholes = new InstancedMesh(plateGeometry(Math.PI * 2, 20), porcelain, 2);
    wholes.name = 'WholePlates';
    wholes.setMatrixAt(0, pose(m1, tx + D.yourPlate[0], D.yourPlate[1], tz + D.yourPlate[2], 0));
    wholes.setMatrixAt(1, pose(m1, tx, D.plates[0][1], tz, 0, 0, D.satyr.servingPlate));
    this.group.add(halves, wholes);

    const H = D.hatchet;
    this.group.add(coarsen(kit.prop('hatchet', [tx + H.at[0], H.at[1], tz + H.at[2]], { rotation: [0, H.heading, 90], scale: H.scale }), D.smallCell));

    // the scan lies on its back with its neck toward +z: stood up, it faces +z
    const satyr = coarsen(kit.prop('satyr_head', [tx, D.satyr.y, tz], { rotation: [100, 180, 0], scale: D.satyr.scale }), D.smallCell);
    kit.paint(satyr, new MeshStandardMaterial({ color: 0xbdb6a6, roughness: 0.9, metalness: 0 }));
    this.group.add(satyr);
    return satyr;
  }

  /** The clock beside the table is stopped at a half past that cannot be: its hands make one line. */
  private buildClock(kit: DreamKit): Object3D {
    const D = T.dinner;
    const clock = kit.prop('grandfather_clock', [D.clock.at[0], 0, D.clock.at[1]], { rotation: [0, D.clock.heading, 0], scale: D.clock.scale });
    const turn = (name: string, degrees: number) => {
      const hand = clock.getObjectByName(name) as Mesh | undefined;
      if (!hand?.parent) return;
      const pivot = new Object3D();
      pivot.position.set(D.dial.x, D.dial.y, hand.position.z);
      hand.parent.add(pivot);
      const tip = tipOf(hand, pivot.position);
      const offset = hand.position.clone().sub(pivot.position);
      pivot.add(hand);
      hand.position.copy(offset);
      pivot.rotation.z = Math.PI / 2 - degrees * DEG - Math.atan2(tip.y, tip.x);
    };
    turn('vintage_grandfather_clock_01_HourHand', D.dial.hour);
    turn('vintage_grandfather_clock_01_MinuteHand', D.dial.minute);
    // both faces of its glass in one draw: three.js otherwise checks the program twice in every render
    for (const mesh of meshesOf(clock)) (mesh.material as Material).forceSinglePass = true;
    this.group.add(clock);
    return clock;
  }

  private buildMirror(kit: DreamKit): Object3D {
    const M = T.dinner.mirror;
    const mirror = coarsen(kit.prop('ornate_mirror', [M.at[0], 0, M.at[1]], { rotation: [M.lean, M.heading, 0], scale: M.scale }), T.dinner.smallCell * 2);
    // the glass is black: a pane over the model's own plate, as it lies in the model, that reflects only a little
    const radius = 0.222;
    const shoulder = 0.08;
    const bottom = -0.386;
    const outline = new Shape();
    outline.moveTo(-radius, bottom);
    outline.lineTo(radius, bottom);
    outline.lineTo(radius, shoulder);
    outline.absarc(0, shoulder, radius, 0, Math.PI, false);
    outline.closePath();
    const pane = new Mesh(new ShapeGeometry(outline, 16), new MeshStandardMaterial({ color: 0x020203, roughness: 0.07, metalness: 0, envMapIntensity: 2.2 }));
    pane.name = 'BlackGlass';
    pane.position.z = 0.0085;
    mirror.children[0].add(pane);
    this.group.add(mirror);
    return mirror;
  }

  /** Everyone where this stage has them. */
  private place(eye: Vector3): void {
    const S = T.dinner.sit;
    for (const seat of this.seats) {
      const turned = seat.chair !== CHAIR.empty && (this.stage === 2 || (this.stage === 1 && seat.chair === CHAIR.fatherUpper));
      const heading = turned ? headingTo(seat.x, seat.z, eye.x, eye.z) : seat.rest;
      this.chairs.setMatrix(seat.chair, pose(m1, seat.x, 0, seat.z, heading));
      if (seat.body) {
        seat.body.set(0, seat.x + Math.sin(heading) * S.hipsForward, seat.y, seat.z + Math.cos(heading) * S.hipsForward, heading);
        seat.body.commit();
      }
    }
    this.chairs.commit();
    const all = this.stage === 2;
    this.mother.rotation.y = all ? headingTo(this.mother.position.x, this.mother.position.z, eye.x, eye.z) : 0;
    this.satyr.rotation.y = all ? headingTo(this.satyr.position.x, this.satyr.position.z, eye.x, eye.z) : 0;
    this.mother.updateMatrixWorld(true);
  }

  /** @returns the light fell just now (the rats hear it) */
  update(frame: DreamFrame, walkBefore: number): boolean {
    const D = T.dinner;
    if (passed(D.dips, walkBefore, frame.walk)) this.dip.start();
    if (frame.time > this.nextDip && frame.walk > D.dips[D.dips.length - 1]) {
      this.dip.start();
      this.nextDip = frame.time + lerp(D.dipEvery[0], D.dipEvery[1], this.rnd());
    }
    this.dip.advance(frame.dt);
    const t = frame.time;
    // the slow breath of an old circuit
    const breath = REDUCED_MOTION ? 0.9 : 0.82 + 0.13 * wobble(t * 0.8, 3) + 0.05 * wobble(t * 1.7, 9);
    const level = breath * this.dip.level;
    this.lamp.shine(level, frame.view);
    this.shades.value = level * D.shades;

    let moved = false;
    if (this.dip.fell && this.stage < 2) {
      this.stage++;
      moved = true;
    } else if (frame.walk > D.dips[0] && (this.dip.dark || frame.unseen(this.center, T.unwatched.group))) {
      // once they have seen you, they keep facing you for as long as they are not watched
      if (this.stage < 2) {
        this.stage = 2;
        moved = true;
      } else if (++this.ticks % D.follow === 0) moved = true;
    }
    if (moved) {
      this.place(frame.eye);
      this.shadow.owe();
    }
    this.shadow.settle(frame.view, this.center, D.lamp.matters);
    return this.dip.fell;
  }

  reset(): void {
    this.ticks = 0;
    this.nextDip = 0;
    this.dip.reset();
    if (this.stage === 0) return;
    this.stage = 0;
    this.place(FROM_THE_SLIT);
    this.shadow.owe();
  }
}

// ------------------------------------------------------------------ the class

/** "her akşam yarım", over and over, in a child's hand that tires. */
function writeOnBoard(width: number, height: number, seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const rnd = randomFrom(seed);
  ctx.fillStyle = '#121513';
  ctx.fillRect(0, 0, width, height);
  // wiped many times, never clean
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(190,196,186,${0.015 + rnd() * 0.035})`;
    ctx.save();
    ctx.translate(rnd() * width, rnd() * height);
    ctx.rotate((rnd() - 0.5) * 0.7);
    ctx.fillRect(-width * 0.4, -30 - rnd() * 60, width * 0.8, 60 + rnd() * 120);
    ctx.restore();
  }
  const phrase = 'her akşam yarım';
  const small = width * 0.03;
  const large = width * 0.05;
  let y = small;
  while (y < height + large) {
    const tired = y / height;
    const size = lerp(small, large, tired) * (0.92 + rnd() * 0.16);
    ctx.font = `${Math.round(size)}px "Just Me Again Down Here", serif`;
    const slope = (rnd() - 0.5) * (0.015 + 0.075 * tired);
    let x = -rnd() * size * 3;
    let line = y;
    while (x < width) {
      ctx.save();
      ctx.translate(x, line);
      ctx.rotate(slope + (rnd() - 0.5) * 0.045);
      ctx.fillStyle = `rgba(226,226,212,${0.42 + rnd() * 0.5})`;
      ctx.fillText(phrase, 0, 0);
      ctx.restore();
      const advance = ctx.measureText(phrase).width + size * (0.25 + rnd() * 0.55);
      x += advance;
      line += Math.sin(slope) * advance + (rnd() - 0.5) * size * 0.16;
    }
    y += size * (0.72 + rnd() * 0.24);
  }
  return canvas;
}

/** Remove the triangles entirely below a height of the world (what would only get in the way). */
function dropBelow(mesh: Mesh, y: number): void {
  mesh.updateWorldMatrix(true, false);
  const geometry = mesh.geometry;
  const p = geometry.getAttribute('position');
  const index = geometry.index!;
  const kept: number[] = [];
  const low = (i: number) => v1.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).y < y;
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    if (!(low(a) && low(b) && low(c))) kept.push(a, b, c);
  }
  geometry.setIndex(kept);
}

/**
 * THE CLASS. Far off to the left, under a tube that stutters: rows of small desks, children with their backs
 * to you, and at the board, written all over by a child's hand, a teacher who has a horse's head for a head.
 * Only ever glimpsed. Each time the tube goes out, or you look away, all of them are facing you instead.
 */
class Classroom {
  readonly group = new Group();
  readonly center: Vector3;
  private readonly lamp: Lamp;
  private readonly dip = new Dip();
  private readonly chairs: PropCrowd;
  private readonly places: { x: number; z: number; crowd: Crowd | null; slot: number }[] = [];
  private readonly children: Crowd[];
  private readonly teacher: Crowd;
  private readonly horse: Object3D;
  private readonly shadow: FlatShadow;
  private facing = false;
  private ticks = 0;

  constructor(kit: DreamKit, halos: Halos, wires: Wires) {
    const K = T.classroom;
    this.group.name = 'Classroom';
    const middle = (list: readonly number[]) => (list[0] + list[list.length - 1]) / 2;
    this.center = new Vector3(middle(K.columns), 1.2, middle(K.rows) - 1);
    this.lamp = new Lamp(kit, halos, K.lamp);

    const count = K.columns.length * K.rows.length;
    this.chairs = coarseCrowd(kit, 'school_chair', count, K.furniture, K.cell);
    const desks = coarseCrowd(kit, 'school_desk', count, K.furniture, K.cell);
    this.group.add(this.chairs.root, desks.root);

    // each child holds one of a few moments of the clip: how many hold which, once they are all counted
    const holds = K.poses.map(() => 0);
    const which: number[] = [];
    K.rows.forEach((_, r) => K.columns.forEach((_x, c) => which.push(K.seated[r][c] === 'x' ? (r + c) % K.poses.length : -1)));
    for (const w of which) if (w >= 0) holds[w]++;
    this.children = K.poses.map((time, i) => kit.figures.crowd({ avatar: 'figure_child', clip: SIT_CLIP, time, face: 'blank' }, holds[i]));
    for (const c of this.children) coarsenBodies(c, K.bodyCell);
    this.group.add(...this.children.map((c) => c.root));
    const filled = K.poses.map(() => 0);
    let place = 0;
    for (const z of K.rows) {
      for (const x of K.columns) {
        desks.setMatrix(place, pose(m1, x, 0, z - K.deskAhead, Math.PI));
        const w = which[place];
        this.places.push({ x, z, crowd: w >= 0 ? this.children[w] : null, slot: w >= 0 ? filled[w]++ : 0 });
        place++;
      }
    }
    desks.commit();

    this.buildBoard(kit);

    const F = K.teacher;
    this.teacher = kit.figures.crowd({ avatar: 'figure_man', clip: 'm_idle_roll_head_01', half: 'lower', cutAt: F.cut, bleach: 0.8, tint: 0xa8a8a0 }, 1);
    this.group.add(this.teacher.root);
    // his head is a horse's: its plinth, which would only sit on his shoulders, is gone
    this.horse = coarsen(kit.prop('horse_head', [F.at[0], F.horseBase, F.at[1]], { scale: F.horseScale }), K.horseCell);
    for (const mesh of meshesOf(this.horse)) dropBelow(mesh, F.horseBase + 0.06 * F.horseScale);
    this.group.add(this.horse);

    const fixture = kit.prop('fluorescent', K.lamp.at, { nodes: ['mounted_fluorescent_lights_a'], scale: K.fixtureScale });
    for (const mesh of meshesOf(fixture)) if (/glass/.test((mesh.material as Material).name)) mesh.material = this.lamp.burning;
    this.group.add(fixture);
    const [lx, ly, lz] = K.lamp.at;
    const apart = 0.35 * K.fixtureScale;
    wires.add(lx - apart, ly + 0.05, lz, lx - apart, T.wireTop, lz);
    wires.add(lx + apart, ly + 0.05, lz, lx + apart, T.wireTop, lz);

    this.shadow = new FlatShadow(this.lamp.light.position, UP, 0.012);
    this.place(FROM_THE_SLIT);
    this.shadow.add(desks.root, K.shadowCell).add(this.chairs.root, K.shadowCell);
    for (const crowd of this.children) this.shadow.add(crowd.root, K.shadowCell);
    this.shadow.add(this.teacher.root, K.shadowCell).finish();
    this.group.add(this.shadow.mesh);
  }

  private buildBoard(kit: DreamKit): void {
    const B = T.classroom.board;
    const board = kit.prop('chalkboard', [B.at[0], 0, B.at[1]], { scale: B.scale });
    const writing = new CanvasTexture(writeOnBoard(B.writing.width, B.writing.height, B.writing.seed));
    writing.colorSpace = SRGBColorSpace;
    writing.anisotropy = 4;
    // laid on the leaf that faces the class (the leaf's middle, size and lean in the model)
    const slate = new Mesh(new PlaneGeometry(0.769, 1.135), new MeshStandardMaterial({ map: writing, roughness: 0.93, metalness: 0 }));
    slate.name = 'Writing';
    slate.position.set(0.0135, 0.881, 0.1825);
    slate.rotation.x = -12 * DEG;
    board.children[0].add(slate);
    this.group.add(board);
  }

  private place(eye: Vector3): void {
    const K = T.classroom;
    this.places.forEach((s, i) => {
      const heading = this.facing ? headingTo(s.x, s.z, eye.x, eye.z) : Math.PI;
      this.chairs.setMatrix(i, pose(m1, s.x, 0, s.z, heading));
      s.crowd?.set(s.slot, s.x - Math.sin(heading) * K.hipsBack, 0.02, s.z - Math.cos(heading) * K.hipsBack, heading);
    });
    const F = K.teacher;
    const facing = this.facing ? headingTo(F.at[0], F.at[1], eye.x, eye.z) : 0;
    this.teacher.set(0, F.at[0], 0, F.at[1], facing);
    this.horse.rotation.y = facing;
    this.horse.position.set(F.at[0] + Math.sin(facing) * F.horseForward, F.horseBase, F.at[1] + Math.cos(facing) * F.horseForward);
    this.chairs.commit();
    for (const c of this.children) c.commit();
    this.teacher.commit();
  }

  /** @returns the tube went out just now */
  update(frame: DreamFrame, walkBefore: number): boolean {
    const K = T.classroom;
    if (passed(K.dips, walkBefore, frame.walk)) this.dip.start();
    this.dip.advance(frame.dt);
    const hum = REDUCED_MOTION ? 0 : K.stutter.amount * Math.max(0, wobble(frame.time * K.stutter.rate, 5) - 0.35);
    this.lamp.shine(this.dip.level * (1 - hum), frame.view);

    if (frame.walk > K.from && (this.dip.dark || frame.unseen(this.center, T.unwatched.group)) && (!this.facing || ++this.ticks % K.follow === 0)) {
      this.facing = true;
      this.place(frame.eye);
      this.shadow.owe();
    }
    this.shadow.settle(frame.view, this.center, K.lamp.matters);
    return this.dip.fell;
  }

  reset(): void {
    this.ticks = 0;
    this.dip.reset();
    if (!this.facing) return;
    this.facing = false;
    this.place(FROM_THE_SLIT);
    this.shadow.owe();
  }
}

// ------------------------------------------------------------------ the screens

const SCREEN_VERT = /* glsl */ `
#include <fog_pars_vertex>
${WARP_GLSL}
attribute vec4 aTv;   // noise seed, brightness, share of static, zoom
attribute vec2 aCrop; // what part of the picture it shows
varying vec2 vUv;
varying vec4 vTv;
varying vec2 vCrop;
void main() {
  vUv = uv;
  vTv = aTv;
  vCrop = aCrop;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  #ifdef USE_FOG
    vFogDepth = -mvPosition.z;
  #endif
  gl_Position = projectionMatrix * dreamWarp(mvPosition);
}
`;

const SCREEN_FRAG = /* glsl */ `
#include <fog_pars_fragment>
#ifndef ONLY_STATIC
uniform sampler2D tPicture;
uniform float uClear;
uniform float uGain;
#endif
uniform float uTime;
uniform float uNoise;
uniform float uSignal;
uniform float uRoll;
uniform float uBright;
uniform vec3 uTint;
varying vec2 vUv;
varying vec4 vTv;
varying vec2 vCrop;
const float LINES = 118.0;
float noise(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec2 c = vUv - 0.5;
  // the glass bulges: straight lines bow toward its edges
  vec2 uv = 0.5 + c * (0.97 + dot(c, c) * 0.2);
  // a slow bar rolls down the tube and tears the lines it passes
  float at = fract(uv.y + uRoll + vTv.x);
  float bar = smoothstep(0.0, 0.05, at) * (1.0 - smoothstep(0.05, 0.17, at));
  uv.x += bar * 0.022 * sin(uv.y * 70.0 + uTime * 3.0);
  float grain = noise(floor(vUv * vec2(150.0, LINES)) + vec2(vTv.x * 97.0, uNoise));
  #ifdef ONLY_STATIC
    float l = grain * grain * 0.85 + 0.06;
  #else
    float picture = dot(texture2D(tPicture, vCrop + (uv - 0.5) * vTv.w).rgb, vec3(0.3, 0.59, 0.11));
    picture = (1.0 - exp(-picture * uGain)) * (0.9 + 0.2 * grain);
    float l = mix(picture, grain * grain * 0.85 + 0.06, max(vTv.z, 1.0 - uClear));
  #endif
  // lines of the raster, gone where they would only shimmer
  float lines = clamp(1.3 - fwidth(vUv.y) * LINES * 1.4, 0.0, 1.0);
  l *= 1.0 - 0.3 * lines * (0.5 + 0.5 * sin(vUv.y * LINES * 6.2832));
  // the corners of the tube, and each one's own slow unrest (well under 3 Hz)
  float edge = (1.0 - smoothstep(0.41, 0.5, abs(c.x))) * (1.0 - smoothstep(0.39, 0.5, abs(c.y)));
  float unrest = 1.0 + 0.09 * sin(uTime * (2.0 + vTv.x * 6.0) + vTv.x * 40.0);
  l = (l * (1.0 + bar * 0.45) * edge + 0.02) * unrest;
  vec3 color = mix(uTint, vec3(1.0), clamp(l * 1.2, 0.0, 1.0)) * l * uBright * vTv.y * uSignal;
  gl_FragColor = vec4(color, 1.0);
  #include <fog_fragment>
}
`;

/** What the eye sees on the glass; or (`picture` null) the plain static the lens sees, for it must not look into its own picture. */
function screenMaterial(picture: WebGLRenderTarget | null): ShaderMaterial {
  const S = T.screens;
  return new ShaderMaterial({
    vertexShader: SCREEN_VERT,
    fragmentShader: SCREEN_FRAG,
    defines: picture ? {} : { ONLY_STATIC: 1 },
    uniforms: {
      ...UniformsUtils.merge([
        UniformsLib.fog,
        {
          uTime: { value: 0 },
          uNoise: { value: 0 },
          uClear: { value: 0 },
          uSignal: { value: 1 },
          uRoll: { value: 0 },
          uGain: { value: S.gain },
          uBright: { value: S.bright },
          uTint: { value: new Color(S.tint) },
        },
      ]),
      ...warpUniforms,
      ...(picture ? { tPicture: { value: picture.texture } } : {}),
    },
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/**
 * Where a set's glass lies in its model as placed by its bounds: middle, size, the front of its middle, how far it
 * falls back toward its corners (just in front of the tube the model has); and the set's own size (m).
 */
const SETS = {
  television_a: { x: -0.0655, y: 0.2592, z: 0.2165, w: 0.3835, h: 0.2902, bulge: 0.0255, width: 0.6, height: 0.457, depth: 0.471 },
  television_b: { x: 0, y: 0.2588, z: 0.1847, w: 0.3165, h: 0.2372, bulge: 0.036, width: 0.4, height: 0.411, depth: 0.35 },
} as const;
/** How much of that falling back goes along the width of the glass; the rest along its height. */
const BULGE_ACROSS = 0.63;
type SetKind = keyof typeof SETS;

/**
 * THE SCREENS. Crooked piles of old sets on both sides of the slit, every one of them showing the same
 * live picture: a lens behind you, looking at your back. There is a body where you are, and behind it another,
 * its head turned around on its neck to look into the lens. Each time the wall goes dark, or you look
 * away, it is a step closer. The last step is a hand on your shoulder.
 */
class Screens {
  readonly group = new Group();
  /** Seen only by the lens. */
  readonly picture = new Group();
  readonly center: Vector3;
  readonly camera = new PerspectiveCamera(T.screens.lens.fov, T.screens.picture.width / T.screens.picture.height, 0.05, 90);
  /** The glass as the eye sees it, and as the lens does. */
  readonly glass: InstancedMesh;
  readonly glassForLens: InstancedMesh;
  /** The wall going dark once. */
  readonly drop = new Dip();

  private readonly target = new WebGLRenderTarget(T.screens.picture.width, T.screens.picture.height, {
    type: HalfFloatType,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
  });
  private readonly lit: ShaderMaterial;
  private readonly snow: ShaderMaterial;
  /** What both of them read. */
  private readonly uniforms: readonly ShaderMaterial['uniforms'][];
  private readonly lamps: Lamp[];
  private readonly standIn: Crowd;
  private readonly follower: HeroFigure;
  private readonly head: Object3D | undefined;
  private readonly headRest = new Quaternion();
  private readonly filmLight: DreamLight;
  private readonly forward = new Vector3();
  private readonly aside = new Vector3();
  private step = 0;
  private clearing = 1;
  private lastDrop = -Infinity;
  private lastStep = -Infinity;
  private wasUnseen = false;
  private frames = 0;
  private clock = 0;

  constructor(private readonly kit: DreamKit, halos: Halos) {
    const S = T.screens;
    this.group.name = 'Screens';
    this.center = new Vector3(0, 2.6, T.endZ + S.wall + 0.4);
    this.camera.layers.set(LAYERS.WORLD);
    this.camera.layers.enable(LAYERS.DREAM);
    this.lit = screenMaterial(this.target);
    this.snow = screenMaterial(null);
    this.uniforms = [this.lit.uniforms, this.snow.uniforms];

    const total = this.buildPiles(kit);
    this.glass = total.glass;
    this.glassForLens = total.lens;

    const L = S.lamps;
    this.lamps = [-1, 1].map(
      (side) => new Lamp(kit, halos, { ...L, at: [side * L.at[0], L.at[1], T.endZ + L.at[2]] }),
    );

    // the body at your eye, and the one behind it
    this.picture.name = 'ScreensPicture';
    this.picture.visible = false;
    this.standIn = kit.figures.crowd({ avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 0, face: 'blank' }, 1);
    this.picture.add(this.standIn.root);
    const F = S.follower;
    this.follower = kit.figures.hero({ avatar: 'figure_man', clip: F.clip, face: 'scratched' });
    this.follower.update(F.time);
    this.picture.add(this.follower.root);
    this.follower.root.updateMatrixWorld(true);
    this.head = this.follower.bone(HEAD_BONE);
    this.head?.getWorldQuaternion(this.headRest);
    this.filmLight = kit.lights.add([0, 0, 0], S.filmLight.color, 0, S.filmLight.reach);

    kit.poi({ position: new Vector3(...S.poi.at), radius: S.poi.radius, zoom: S.poi.zoom });
  }

  /** Stacks each set on whatever already lies under it; then a piece of glass on each. */
  private buildPiles(kit: DreamKit): { glass: InstancedMesh; lens: InstancedMesh } {
    const S = T.screens;
    const rnd = randomFrom(S.seed);
    const sets: { kind: SetKind; matrix: Matrix4 }[] = [];
    for (const side of [-1, 1]) {
      const tops: { from: number; to: number; top: number }[] = [];
      S.rows.forEach((inRow, row) => {
        let cursor = S.inner + (row ? row * S.climb.step + rnd() * S.climb.stray : 0);
        for (let i = 0; i < inRow; i++) {
          const kind: SetKind = rnd() < 0.6 ? 'television_a' : 'television_b';
          const G = SETS[kind];
          const giant = row === 0 && i < S.giants;
          const [lo, hi] = kind === 'television_a' ? S.scale.a : S.scale.b;
          const scale = giant ? S.scale.giant * (kind === 'television_a' ? 1 : 1.3) : lerp(lo, hi, rnd());
          const width = G.width * scale;
          const middle = cursor + width / 2;
          const from = middle - width * 0.42;
          const to = middle + width * 0.42;
          let y = 0;
          for (const t of tops) if (t.from < to && t.to > from) y = Math.max(y, t.top);
          tops.push({ from, to, top: y + G.height * scale });
          const x = side * middle;
          const z = T.endZ + S.wall + (G.depth * scale) / 2 + rnd() * S.crooked.forward * (1 - row / S.rows.length);
          const turn = Math.atan2(-x, S.faces) + (rnd() * 2 - 1) * S.crooked.turn * DEG;
          const tilt = row ? (rnd() * 2 - 1) * S.crooked.tilt * DEG : 0;
          sets.push({ kind, matrix: new Matrix4().compose(v1.set(x, y, z), q1.setFromEuler(e1.set(0, turn, tilt, 'YXZ')), s1.setScalar(scale)) });
          cursor += width + rnd() * S.crooked.gap;
        }
      });
    }
    for (const kind of ['television_a', 'television_b'] as const) {
      const list = sets.filter((s) => s.kind === kind);
      const crowd = coarseCrowd(kit, kind, list.length, 1, S.cell);
      list.forEach((s, i) => crowd.setMatrix(i, s.matrix));
      crowd.commit();
      this.group.add(crowd.root);
    }

    // one piece of glass per set, curved as its tube is
    const patch = new PlaneGeometry(1, 1, 8, 6);
    const p = patch.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setZ(i, -4 * (BULGE_ACROSS * p.getX(i) ** 2 + (1 - BULGE_ACROSS) * p.getY(i) ** 2));
    const tv = new Float32Array(sets.length * 4);
    const crops = new Float32Array(sets.length * 2);
    const glass = new InstancedMesh(patch, this.lit, sets.length);
    glass.name = 'ScreensGlass';
    const C = S.closeUp;
    sets.forEach((s, i) => {
      const G = SETS[s.kind];
      glass.setMatrixAt(i, m1.compose(v1.set(G.x, G.y, G.z), q1.identity(), s1.set(G.w, G.h, G.bulge)).premultiply(s.matrix));
      const roll = rnd();
      const bright = roll < S.dead ? 0.035 : 0.7 + rnd() * 0.5;
      const share = roll >= S.dead && roll < S.dead + S.onlyStatic ? 1 : 0;
      const close = rnd() < S.closeUps;
      tv.set([rnd(), bright, share, close ? lerp(C.zoom[0], C.zoom[1], rnd()) : 1], i * 4);
      crops.set(close ? [lerp(C.x[0], C.x[1], rnd()), lerp(C.y[0], C.y[1], rnd())] : [0.5, 0.5], i * 2);
    });
    patch.setAttribute('aTv', new InstancedBufferAttribute(tv, 4));
    patch.setAttribute('aCrop', new InstancedBufferAttribute(crops, 2));
    const lens = new InstancedMesh(patch, this.snow, sets.length);
    lens.name = 'ScreensGlassForLens';
    lens.instanceMatrix = glass.instanceMatrix;
    lens.visible = false;
    this.group.add(glass, lens);
    return { glass, lens };
  }

  /** The lens and the two bodies, from where the viewer stands and looks now. */
  private frameShot(eye: Vector3, view: PerspectiveCamera): void {
    const L = T.screens.lens;
    const f = this.forward.set(0, 0, -1).applyQuaternion(view.quaternion);
    f.y = 0;
    f.normalize();
    const side = this.aside.set(-f.z, 0, f.x);
    const heading = Math.atan2(f.x, f.z);
    this.standIn.set(0, eye.x, 0, eye.z, heading);
    this.standIn.commit();

    const lens = this.camera;
    lens.position.set(eye.x - f.x * L.behind + side.x * L.aside, eye.y + L.above, eye.z - f.z * L.behind + side.z * L.aside);
    lens.lookAt(eye.x, L.lookAt, eye.z);
    lens.updateMatrixWorld(true);

    const step = T.screens.steps[this.step];
    const root = this.follower.root;
    root.position.set(eye.x - f.x * step[0] + side.x * step[1], 0, eye.z - f.z * step[0] + side.z * step[1]);
    root.rotation.y = heading;
    root.updateMatrixWorld(true);

    // whatever the body does, the head looks into the lens
    const head = this.head;
    if (head?.parent) {
      head.getWorldPosition(v1);
      v2.subVectors(lens.position, v1).normalize();
      q1.setFromEuler(e1.set(-Math.asin(v2.y), Math.atan2(v2.x, v2.z), T.screens.follower.roll * DEG, 'YXZ'));
      q2.multiplyQuaternions(q1, this.headRest);
      head.parent.getWorldQuaternion(head.quaternion);
      head.quaternion.invert().multiply(q2);
    }
    this.filmLight.position.copy(lens.position);
  }

  /** @returns the wall fell dark just now */
  update(frame: DreamFrame, walkBefore: number): boolean {
    const S = T.screens;
    const dt = frame.dt;
    this.clock += dt;

    if (passed(S.drops, walkBefore, frame.walk) && this.clock - this.lastDrop > S.dropGap) {
      this.drop.start();
      this.lastDrop = this.clock;
    }
    this.drop.advance(dt);
    if (this.drop.fell) this.closer(S.stepsPerDrop);
    // looking away also lets it come
    const unseen = frame.unseen(this.center, T.unwatched.group);
    if (unseen && !this.wasUnseen && frame.walk > S.drops[0] && this.clock - this.lastStep > S.stepGap) this.closer(1);
    this.wasUnseen = unseen;
    // coming back it is static first
    if (this.drop.level < 1) this.clearing = 0;
    else this.clearing = Math.min(1, this.clearing + dt / S.clearing);

    const clear = range(S.clearsAt[0], S.clearsAt[1], frame.eye.distanceTo(this.center)) * this.clearing;
    const noise = Math.floor(this.clock * S.noiseRate) % 97;
    const roll = (this.clock * S.roll) % 1;
    for (const u of this.uniforms) {
      u.uTime.value = this.clock;
      u.uNoise.value = noise;
      u.uSignal.value = this.drop.level;
      u.uRoll.value = roll;
    }
    this.lit.uniforms.uClear.value = clear;

    const away = 1 - range(S.fadeOut[0], S.fadeOut[1], frame.eye.z);
    const unrest = REDUCED_MOTION ? 1 : 0.92 + 0.08 * wobble(this.clock * 1.4, 2);
    for (const lamp of this.lamps) lamp.shine(this.drop.level * away * unrest, frame.view);
    return this.drop.fell;
  }

  private closer(steps: number): void {
    this.step = Math.min(T.screens.steps.length - 1, this.step + steps);
    this.lastStep = this.clock;
  }

  /** Draw the picture, when it can be seen at all, and not on every frame. */
  film(frame: DreamFrame): void {
    const P = T.screens.picture;
    if (++this.frames % P.every !== 0) return;
    if (frame.eye.distanceTo(this.center) > P.within || frame.unseen(this.center, P.margin)) return;
    this.shoot(frame.eye, frame.view, this.kit.renderDream);
  }

  private shoot(eye: Vector3, view: PerspectiveCamera, render: (target: WebGLRenderTarget, camera: PerspectiveCamera) => void): void {
    this.frameShot(eye, view);
    this.filmLight.intensity = T.screens.filmLight.intensity;
    render(this.target, this.camera);
    this.filmLight.intensity = 0;
  }

  /** A first picture (and its target exists before anyone needs it). */
  develop(render: (target: WebGLRenderTarget, camera: PerspectiveCamera) => void): void {
    const view = new PerspectiveCamera();
    view.position.set(0, 1.62, this.center.z + T.screens.picture.within / 2);
    this.shoot(view.position, view, render);
  }

  reset(): void {
    this.step = 0;
    this.clearing = 1;
    this.lastDrop = -Infinity;
    this.lastStep = -Infinity;
    this.wasUnseen = false;
    this.drop.reset();
  }
}

// ------------------------------------------------------------------ the wall of heads

interface Trophy {
  /** A head of the crowd, or (null) the mask. */
  crowd: PropCrowd | null;
  slot: number;
  x: number;
  y: number;
  z: number;
  looks: boolean;
}

/**
 * THE WALL OF HEADS. Bulls and horses far too big, coming out of the concrete in a strict grid and staring
 * down; one gas mask among them; their shadows long on the wall. Each time they are unseen, one more of
 * them is looking at you, and it does not stop.
 */
class WallOfHeads {
  readonly group = new Group();
  readonly center: Vector3;
  /** It lights more than them (see the config). */
  readonly lamp: Lamp;
  private readonly dip = new Dip();
  private readonly trophies: Trophy[] = [];
  private readonly mask: Object3D;
  private readonly crowds: PropCrowd[];
  private readonly shadow: FlatShadow;
  private readonly order: number[];
  private looking = 0;
  private wasUnseen = true;
  private ticks = 0;

  constructor(kit: DreamKit, halos: Halos, wires: Wires) {
    const H = T.heads;
    this.group.name = 'WallOfHeads';
    const middle = (list: readonly number[]) => (list[0] + list[list.length - 1]) / 2;
    this.center = new Vector3(T.wallX - H.eyes.out, middle(H.rows), middle(H.columns));
    this.lamp = new Lamp(kit, halos, H.lamp);
    hangBulb(kit, this.group, wires, this.lamp);

    const cells = H.rows.length * H.columns.length;
    const bulls = coarseCrowd(kit, 'bull_head', Math.ceil(cells / 2), H.scale, H.cell);
    const horses = coarseCrowd(kit, 'horse_head', Math.floor(cells / 2), H.scale, H.cell);
    this.crowds = [bulls, horses];
    this.group.add(bulls.root, horses.root);

    const M = H.mask;
    this.mask = coarsen(kit.prop('gas_mask', [T.wallX - M.reach, H.rows[M.row] + M.above, H.columns[M.column]], { scale: M.scale, anchor: 'top' }), H.cell * 0.35);
    this.group.add(this.mask);

    const used = [0, 0];
    H.rows.forEach((y, r) => {
      H.columns.forEach((z, c) => {
        if (r === M.row && c === M.column) {
          this.trophies.push({ crowd: null, slot: 0, x: T.wallX - M.reach, y: y + M.above, z, looks: false });
          return;
        }
        const kind = (r + c) % 2;
        this.trophies.push({ crowd: this.crowds[kind], slot: used[kind]++, x: T.wallX + H.sunk, y, z, looks: false });
      });
    });
    bulls.drawn = used[0];
    horses.drawn = used[1];

    const rnd = randomFrom(H.seed);
    this.order = this.trophies.map((_, i) => i);
    for (let i = this.order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    }

    this.placeAll(FROM_THE_SLIT);
    this.shadow = new FlatShadow(this.lamp.light.position, new Vector3(1, 0, 0), T.wallX - 0.03);
    this.shadow.add(bulls.root, H.shadowCell).add(horses.root, H.shadowCell).add(this.mask, H.shadowCell).finish();
    this.group.add(this.shadow.mesh);
  }

  private set(t: Trophy, eye: Vector3): void {
    const H = T.heads;
    const out = -Math.PI / 2;
    let heading = out;
    let tilt = H.stare * DEG;
    if (t.looks) {
      const away = clamp(headingTo(t.x, t.z, eye.x, eye.z) - out, -H.looks.aside * DEG, H.looks.aside * DEG);
      heading = out + away;
      const fromWall = H.eyes.out * Math.cos(away);
      tilt = clamp(Math.atan2(t.y + H.eyes.up - eye.y, Math.hypot(eye.x - t.x, eye.z - t.z) - fromWall), H.looks.least * DEG, H.looks.most * DEG);
    }
    if (t.crowd) t.crowd.setMatrix(t.slot, pose(m1, t.x, t.y, t.z, heading, tilt));
    else this.mask.rotation.set(Math.min(tilt * 0.25, H.mask.tilt * DEG), heading, 0, 'YXZ');
  }

  private placeAll(eye: Vector3): void {
    for (const t of this.trophies) this.set(t, eye);
    for (const c of this.crowds) c.commit();
    this.mask.updateMatrixWorld(true);
  }

  /** @returns the lamp fell just now */
  update(frame: DreamFrame, walkBefore: number): boolean {
    const H = T.heads;
    if (passed(H.dips, walkBefore, frame.walk)) this.dip.start();
    this.dip.advance(frame.dt);
    this.lamp.shine(this.dip.level, frame.view);

    const dark = this.dip.dark;
    const unseen = frame.unseen(this.center, T.unwatched.group);
    let want = this.looking;
    if (unseen && !this.wasUnseen) want++;
    this.wasUnseen = unseen;
    for (let i = 0; i < H.atLeast.length; i++) if (frame.walk >= H.atLeast[i][0]) want = Math.max(want, H.atLeast[i][1]);

    let moved = false;
    // the next who can turn unwatched does
    for (let i = 0; i < this.order.length && this.looking < want; i++) {
      const t = this.trophies[this.order[i]];
      if (t.looks || !(dark || frame.unseen(v2.set(t.x, t.y, t.z), T.unwatched.big))) continue;
      t.looks = true;
      this.looking++;
      this.set(t, frame.eye);
      moved = true;
    }
    // those who already look follow you, unwatched
    if (++this.ticks % H.follow === 0) {
      for (let i = 0; i < this.trophies.length; i++) {
        const t = this.trophies[i];
        if (!t.looks || !frame.unseen(v2.set(t.x, t.y, t.z), T.unwatched.big)) continue;
        this.set(t, frame.eye);
        moved = true;
      }
    }
    if (moved) {
      for (const c of this.crowds) c.commit();
      this.mask.updateMatrixWorld(true);
      this.shadow.owe();
    }
    this.shadow.settle(frame.view, this.center, H.lamp.matters);
    return this.dip.fell;
  }

  reset(): void {
    this.wasUnseen = true;
    this.ticks = 0;
    this.dip.reset();
    if (this.looking === 0) return;
    this.looking = 0;
    for (const t of this.trophies) t.looks = false;
    this.placeAll(FROM_THE_SLIT);
    this.shadow.owe();
  }
}

// ------------------------------------------------------------------ gnomes

interface GnomeSpot {
  x: number;
  z: number;
  size: number;
  /** Which crowd, and its place in that crowd. */
  tier: number;
  slot: number;
  /** Near the screens: the wall going dark hides it. */
  byTheWall: boolean;
  /** Where on the way it looks when it comes: where you will be when you come level with it. */
  leadX: number;
  leadZ: number;
}

/** A soft round patch: white in the middle, gone at its edge (it says how dark a shadow is). */
function softSpot(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const fade = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  fade.addColorStop(0, '#fff');
  fade.addColorStop(0.5, '#999');
  fade.addColorStop(1, '#000');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

/**
 * THE GNOMES. Three garden gnomes on the wet concrete, facing you. It is funny. Whenever the floor ahead cannot be
 * seen there are more, always facing you, each with its little lit lantern, until by the end they are a crowd
 * around the slit, and you have to walk through them.
 */
class Gnomes {
  readonly group = new Group();
  private readonly tiers: { crowd: PropCrowd; used: number }[];
  private readonly spots: GnomeSpot[];
  private readonly contact: InstancedMesh;
  private readonly lantern: { value: number } = { value: T.gnomes.lantern.strength };
  private lanternLevel = 1;
  private next = 0;
  private reaim = 0;
  private extra = 0;

  constructor(kit: DreamKit, keepClear: readonly { x: number; z: number; r: number }[]) {
    const G = T.gnomes;
    this.group.name = 'Gnomes';
    const source = kit.model('gnome').scene.getObjectByProperty('isMesh', true) as Mesh;
    const material = (source.material as MeshStandardMaterial).clone();
    const [r, g, b] = G.lantern.color;
    // the panes of the lantern burn: the only yellow in its map
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uLantern = this.lantern;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uLantern;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float pane = smoothstep(0.02, 0.12, diffuseColor.r - diffuseColor.g) * smoothstep(0.1, 0.22, diffuseColor.g) * (1.0 - smoothstep(0.12, 0.28, diffuseColor.b));
          totalEmissiveRadiance += vec3(${r.toFixed(2)}, ${g.toFixed(2)}, ${b.toFixed(2)}) * pane * uLantern;`,
        );
    };
    material.customProgramCacheKey = () => 'tableaux-lantern';
    this.tiers = G.tiers.map((tier) => {
      const crowd = coarseCrowd(kit, 'gnome', tier.count, 1, tier.cell);
      kit.paint(crowd.root, material);
      this.group.add(crowd.root);
      return { crowd, used: 0 };
    });
    const total = G.tiers.reduce((sum, t) => sum + t.count, 0);
    const flat = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.contact = new InstancedMesh(flat, new MeshBasicMaterial({ color: 0x000000, alphaMap: softSpot(), transparent: true, opacity: G.contact.strength, depthWrite: false }), total);
    this.contact.name = 'GnomeContact';
    this.group.add(this.contact);
    this.spots = this.layOut(keepClear);
    this.reset();
  }

  /** Every place one will ever stand, in the order they come. */
  private layOut(keepClear: readonly { x: number; z: number; r: number }[]): GnomeSpot[] {
    const G = T.gnomes;
    const rnd = randomFrom(G.seed);
    const spots: GnomeSpot[] = [];
    const room: number[] = G.tiers.map((t) => t.count);
    const tierAt = (fromWay: number): number => {
      let tier = G.tiers.findIndex((t) => fromWay <= t.within);
      while (tier < room.length - 1 && room[tier] <= 0) tier++;
      room[tier]--;
      return tier;
    };
    const free = (x: number, z: number) => Math.abs(x - wayX(z)) >= G.clearOfWay && x > (z < G.ward.until ? G.ward.then : G.ward.x) && keepClear.every((c) => Math.hypot(c.x - x, c.z - z) > c.r);
    const apart = (list: readonly GnomeSpot[], x: number, z: number, spacing: number) => list.every((s) => Math.hypot(s.x - x, s.z - z) > spacing);
    const size = () => lerp(G.size[0], G.size[1], rnd());
    const leadOf = (x: number, z: number) => {
      const leadZ = z + Math.abs(x - wayX(z)) * G.lead;
      return { leadX: wayX(leadZ), leadZ };
    };
    for (const [x, z] of G.first) spots.push({ x, z, size: G.firstSize, tier: tierAt(0), slot: 0, byTheWall: false, ...leadOf(x, z) });
    const S = G.scatter;
    for (let n = 0, tries = 0; n < S.count && tries < 4000; tries++) {
      const z = lerp(S.from, S.to, (n + rnd()) / S.count);
      const off = lerp(S.offset[0], S.offset[1], rnd() ** 1.4) * (rnd() < 0.5 ? -1 : 1);
      const x = wayX(z) + off;
      if (!free(x, z) || !apart(spots, x, z, S.spacing)) continue;
      spots.push({ x, z, size: size(), tier: tierAt(Math.abs(off)), slot: 0, byTheWall: false, ...leadOf(x, z) });
      n++;
    }
    const C = G.crowd;
    const remaining = G.tiers.reduce((sum, t) => sum + t.count, 0) - spots.length;
    const packed: GnomeSpot[] = [];
    for (let tries = 0; packed.length < remaining && tries < 40000; tries++) {
      // thicker toward the slit and toward the way
      const z = lerp(C.to, C.from, rnd() ** 1.5);
      const x = (rnd() < 0.5 ? -1 : 1) * (G.clearOfWay + (C.halfWidth - G.clearOfWay) * rnd() ** 1.35);
      if (!free(x, z) || !apart(spots, x, z, C.spacing) || !apart(packed, x, z, C.spacing)) continue;
      packed.push({ x, z, size: size(), tier: 0, slot: 0, byTheWall: true, ...leadOf(x, z) });
    }
    // those farthest from the wall come first: the crowd thickens from your side
    packed.sort((a, b) => b.z - a.z);
    for (const s of packed) s.tier = tierAt(Math.abs(s.x));
    const all = spots.concat(packed);
    const taken = G.tiers.map(() => 0);
    for (const s of all) s.slot = taken[s.tier]++;
    return all;
  }

  /** Put one on its spot: it looks at where you will be when you come level with it, or at you if you have passed. */
  private put(spot: GnomeSpot, eye: Vector3): void {
    const tier = this.tiers[spot.tier];
    tier.used = spot.slot + 1;
    const heading = spot.leadZ < eye.z ? headingTo(spot.x, spot.z, spot.leadX, spot.leadZ) : headingTo(spot.x, spot.z, eye.x, eye.z);
    tier.crowd.setMatrix(spot.slot, pose(m1, spot.x, 0, spot.z, heading, 0, spot.size));
    this.contact.setMatrixAt(this.next, pose(m1, spot.x, T.gnomes.contact.y, spot.z, 0, 0, T.gnomes.contact.width * spot.size));
    this.next++;
  }

  private wanted(z: number): number {
    const growth = T.gnomes.growth;
    if (z >= growth[0][0]) return growth[0][1];
    for (let i = 1; i < growth.length; i++) {
      if (z >= growth[i][0]) return Math.round(lerp(growth[i - 1][1], growth[i][1], (growth[i - 1][0] - z) / (growth[i - 1][0] - growth[i][0])));
    }
    return this.spots.length;
  }

  /**
   * @param wallLevel how much light the screens give now (0..1)
   * @param wallDark the screens are dark now
   * @param floorDark the whole floor is dark now
   */
  update(frame: DreamFrame, wallLevel: number, wallDark: boolean, floorDark: boolean): void {
    const G = T.gnomes;
    const eye = frame.eye;
    // their lanterns go out with the light of the floor and the wall: no one sees them come
    this.lanternLevel = damp(this.lanternLevel, floorDark ? 0 : wallLevel, G.lantern.rate, frame.dt);
    this.lantern.value = G.lantern.strength * this.lanternLevel;
    if (floorDark) this.extra = G.whenTheLightFails;
    const want = Math.min(this.wanted(eye.z) + this.extra, this.spots.length);
    let budget = wallDark || floorDark ? G.inTheDark : G.perFrame;
    let changed = false;
    // the next that can come unnoticed comes; the rest wait for the next look away
    while (this.next < want && budget > 0) {
      const spot = this.spots[this.next];
      v2.set(spot.x, 0.4, spot.z);
      if (!(floorDark || (wallDark && spot.byTheWall) || frame.unseen(v2, T.unwatched.small) || eye.distanceTo(v2) > G.unnoticedAt)) break;
      this.put(spot, eye);
      budget--;
      changed = true;
    }
    // the unwatched ones nearby turn to you, a few at a time
    for (let n = 0; n < G.reaimPerFrame; n++) {
      this.reaim = (this.reaim + 1) % this.next;
      const spot = this.spots[this.reaim];
      v2.set(spot.x, 0.4, spot.z);
      if (eye.distanceTo(v2) > G.reaimWithin || !frame.unseen(v2, T.unwatched.small)) continue;
      this.tiers[spot.tier].crowd.setMatrix(spot.slot, pose(m1, spot.x, 0, spot.z, headingTo(spot.x, spot.z, eye.x, eye.z), 0, spot.size));
      changed = true;
    }
    if (changed) this.commit();
  }

  private commit(): void {
    for (const t of this.tiers) {
      t.crowd.drawn = t.used;
      t.crowd.commit();
    }
    this.contact.count = this.next;
    this.contact.instanceMatrix.needsUpdate = true;
  }

  reset(): void {
    this.next = 0;
    this.reaim = 0;
    this.extra = 0;
    for (const t of this.tiers) t.used = 0;
    for (let i = 0; i < T.gnomes.first.length; i++) this.put(this.spots[i], FROM_THE_SLIT);
    this.commit();
    this.lanternLevel = 1;
    this.lantern.value = T.gnomes.lantern.strength;
  }
}

// ------------------------------------------------------------------ rats

/** Eight rats that sit still along the walls. When a light flickers they run, straight and very fast, a short way. */
class Rats {
  readonly crowd: PropCrowd;
  private readonly rats: { from: Vector2; to: Vector2; t: number; running: boolean; back: boolean; length: number }[];

  constructor(kit: DreamKit) {
    const R = T.rats;
    this.crowd = coarseCrowd(kit, 'rat', R.count, R.scale, R.cell);
    this.crowd.root.name = 'Rats';
    this.rats = R.runs.map(([x0, z0, x1, z1]) => ({
      from: new Vector2(x0, z0),
      to: new Vector2(x1, z1),
      t: 0,
      running: false,
      back: false,
      length: Math.hypot(x1 - x0, z1 - z0),
    }));
    this.reset();
  }

  private place(i: number): void {
    const r = this.rats[i];
    const a = r.back ? r.to : r.from;
    const b = r.back ? r.from : r.to;
    this.crowd.setMatrix(i, pose(m1, lerp(r.from.x, r.to.x, r.t), 0.002, lerp(r.from.y, r.to.y, r.t), headingTo(a.x, a.y, b.x, b.y)));
  }

  update(frame: DreamFrame, fright: boolean): void {
    const R = T.rats;
    let moved = false;
    for (let i = 0; i < this.rats.length; i++) {
      const r = this.rats[i];
      if (fright && !r.running) {
        const distance = Math.hypot(frame.eye.x - lerp(r.from.x, r.to.x, r.t), frame.eye.z - lerp(r.from.y, r.to.y, r.t));
        if (distance < R.hears) {
          r.running = true;
          r.back = r.t > 0.5;
        }
      }
      if (!r.running) continue;
      r.t += ((r.back ? -1 : 1) * R.speed * frame.dt) / r.length;
      if (r.t <= 0 || r.t >= 1) {
        r.t = clamp(r.t, 0, 1);
        r.running = false;
      }
      this.place(i);
      moved = true;
    }
    if (moved) this.crowd.commit();
  }

  reset(): void {
    this.rats.forEach((r, i) => {
      r.t = 0;
      r.running = false;
      r.back = false;
      this.place(i);
    });
    this.crowd.commit();
  }
}

// ------------------------------------------------------------------ small islands

/** Iron and dark wood, for the guillotine and its waiting chairs (named as in those models). */
function executionPaint(): Record<string, Material> {
  return {
    WoodLight: new MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.48, metalness: 0.85, side: DoubleSide }),
    Wood: new MeshStandardMaterial({ color: 0x17100b, roughness: 0.74, metalness: 0, side: DoubleSide }),
    Metal: new MeshStandardMaterial({ color: 0x55585c, roughness: 0.34, metalness: 0.45, side: DoubleSide }),
    LightMetal: new MeshStandardMaterial({ color: 0xc9cbce, roughness: 0.2, metalness: 0.35, side: DoubleSide }),
  };
}

/** THE DENTIST. An old chair alone on the wet floor under a caged light; its arm reaches over nothing, and over it, on two wires, hangs a shark's jaw. A tray. Nobody. */
class Dentist {
  readonly group = new Group();
  readonly center: Vector3;
  private readonly lamp: Lamp;
  private readonly dip = new Dip();
  private readonly jaw: Object3D;
  private readonly glass: MeshStandardMaterial;

  constructor(kit: DreamKit, halos: Halos, wires: Wires) {
    const D = T.dentist;
    this.group.name = 'Dentist';
    this.center = new Vector3(D.at[0], 1.5, D.at[1]);
    this.lamp = new Lamp(kit, halos, D.lamp);

    const chair = coarsen(kit.prop('dentist_chair', [D.at[0], 0, D.at[1]], { rotation: [0, D.heading, 0], scale: D.scale }), D.cell);
    const old = (color: number, roughness: number, metalness = 0) => new MeshStandardMaterial({ color, roughness, metalness });
    const brass = old(0x5e4a1e, 0.42, 0.85);
    const wood = old(0x5a3f22, 0.5, 0.45);
    const steel = old(0x8f9498, 0.3, 0.95);
    const iron = old(0x23252a, 0.5, 0.7);
    // the model's colors are a toy's: years of use on all of them
    repaint(chair, {
      mat18: wood,
      mat19: wood,
      mat22: iron,
      mat16: iron,
      mat17: old(0x0b0d10, 0.6),
      mat20: old(0x1e120c, 0.7),
      mat12: brass,
      mat8: old(0x2e0807, 0.58),
      mat21: steel,
      mat15: steel,
      mat23: old(0x050505, 0.55),
    });
    this.group.add(chair);

    // the jaw hung on end, mouth toward the way you come
    const J = D.jaw;
    this.jaw = coarsen(kit.prop('shark_jaw', J.at, { rotation: [90, 0, 0], scale: J.height / 1.996 }), J.cell);
    this.group.add(this.jaw);
    const [jx, jy, jz] = J.at;
    wires.add(jx - J.wireApart, jy + J.height - 0.05, jz, jx - J.wireApart, T.wireTop, jz);
    wires.add(jx + J.wireApart, jy + J.height - 0.05, jz, jx + J.wireApart, T.wireTop, jz);

    const [tx, tz] = D.tray.at;
    const stand = [
      [0, 0],
      [0.19, 0],
      [0.21, 0.018],
      [0.04, 0.05],
      [0.014, 0.075],
      [0.012, 0.93],
      [0.022, 0.95],
      [0.2, 0.955],
      [0.245, 0.985],
      [0.25, 1.002],
      [0.24, 1.002],
      [0.198, 0.972],
      [0, 0.972],
    ].map(([r, h]) => new Vector2(r, h));
    const tray = new Mesh(new LatheGeometry(stand, 18), new MeshStandardMaterial({ color: 0x9ea2a4, roughness: 0.28, metalness: 0.95, side: DoubleSide }));
    tray.name = 'Tray';
    tray.position.set(tx, 0, tz);
    this.group.add(tray);
    this.group.add(coarsen(kit.prop('hatchet', [tx, D.tray.hatchet, tz], { rotation: [0, 35, 90] }), T.dinner.smallCell));

    // the caged light hangs by its own chains from wires that go up into the dark; its lens burns (its map says where)
    const F = D.fixture;
    const [lx, ly, lz] = D.lamp.at;
    const fixture = coarsen(kit.prop('caged_light', [lx, ly + F.lift, lz], { scale: F.scale }), F.cell);
    this.glass = (meshesOf(fixture)[0].material as MeshStandardMaterial).clone();
    this.glass.emissive.setHex(0xfff0d4);
    kit.paint(fixture, this.glass);
    this.group.add(fixture);
    const top = ly + F.lift + F.height * F.scale;
    wires.add(lx - F.apart * F.scale, top, lz, lx - F.apart * F.scale, T.wireTop, lz);
    wires.add(lx + F.apart * F.scale, top, lz, lx + F.apart * F.scale, T.wireTop, lz);

    const shadow = new FlatShadow(this.lamp.light.position, UP, 0.012);
    shadow.add(chair, D.shadowCell).add(this.jaw, D.shadowCell).add(tray, D.shadowCell).finish();
    this.group.add(shadow.mesh);
  }

  /** @returns the light fell just now */
  update(frame: DreamFrame, walkBefore: number): boolean {
    const D = T.dentist;
    if (passed(D.dips, walkBefore, frame.walk)) this.dip.start();
    this.dip.advance(frame.dt);
    const hum = REDUCED_MOTION ? 0 : D.stutter.amount * Math.max(0, wobble(frame.time * D.stutter.rate, 12) - 0.2);
    const level = this.dip.level * (1 - hum);
    this.lamp.shine(level, frame.view);
    this.glass.emissiveIntensity = level * D.fixture.heat;
    if (!REDUCED_MOTION) this.jaw.rotation.y = Math.sin((frame.time / D.jaw.swayPeriod) * Math.PI * 2) * D.jaw.sway * DEG;
    return this.dip.fell;
  }

  reset(): void {
    this.dip.reset();
  }
}

/**
 * THE CAMERAS. Bellows cameras on tripods, around the middle of the hall, all pointed elsewhere; three of them
 * photograph the head. While you are not looking each one swings around to you. Nothing here is more personal.
 */
class Cameras {
  readonly group = new Group();
  readonly center: Vector3;
  readonly radius: number;
  private readonly bodies: PropCrowd;
  private readonly stands: { x: number; z: number; rest: number; aimed: boolean; slot: number; glint: number }[];
  private readonly glint: Color;
  private ticks = 0;

  constructor(kit: DreamKit, private readonly halos: Halos) {
    const C = T.cameras;
    this.group.name = 'Cameras';
    this.glint = new Color(C.glint.color).multiplyScalar(C.glint.strength);

    const whole = coarsen(kit.prop('antique_camera', [0, 0, 0], { scale: C.scale }), C.cell);
    const legsOnly = whole.clone(true);
    whole.getObjectByName('tripod')?.removeFromParent();
    legsOnly.getObjectByName('camera')?.removeFromParent();
    // the maker's mark on one leg is not for this dream: dark wood all over
    kit.paint(legsOnly, new MeshStandardMaterial({ color: 0x20150d, roughness: 0.68, metalness: 0 }));
    this.bodies = new PropCrowd(whole, C.stand.length, false);
    const legs = new PropCrowd(legsOnly, C.stand.length, true);
    this.group.add(this.bodies.root, legs.root);

    this.stands = C.stand.map(([x, z, rest], slot) => {
      legs.setMatrix(slot, pose(m1, x, 0, z, ((rest + slot * 40) % 360) * DEG));
      return { x, z, rest: rest * DEG, aimed: false, slot, glint: halos.add(v2.set(x, 0, z), C.glint.size) };
    });
    legs.commit();

    const box = this.stands.reduce((b, s) => ({ x0: Math.min(b.x0, s.x), x1: Math.max(b.x1, s.x), z0: Math.min(b.z0, s.z), z1: Math.max(b.z1, s.z) }), { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
    this.center = new Vector3((box.x0 + box.x1) / 2, 1.2, (box.z0 + box.z1) / 2);
    this.radius = Math.hypot(box.x1 - box.x0, box.z1 - box.z0) / 2 + C.scale;
    this.reset();
  }

  private aim(s: Cameras['stands'][number], eye: Vector3): void {
    const C = T.cameras;
    const head = C.head * C.scale;
    const heading = s.aimed ? headingTo(s.x, s.z, eye.x, eye.z) : s.rest;
    const pitch = s.aimed ? clamp(Math.atan2(head - eye.y, Math.hypot(eye.x - s.x, eye.z - s.z)), -C.maxPitch * DEG, C.maxPitch * DEG) : 0;
    // it turns about the head of its tripod
    m1.compose(v1.set(s.x, head, s.z), q1.setFromEuler(e1.set(pitch, heading, 0, 'YXZ')), s1.setScalar(1)).multiply(m2.makeTranslation(0, -head, 0));
    this.bodies.setMatrix(s.slot, m1);
    // its glass catches what light there is, once it looks your way
    v2.set(0, C.lens[0] * C.scale, C.lens[1] * C.scale).applyMatrix4(m1);
    this.halos.move(s.glint, v2, C.glint.size);
    this.halos.write(s.glint, this.glint, s.aimed ? 1 : 0);
  }

  /** @param dark the whole floor is dark now */
  update(frame: DreamFrame, dark: boolean): void {
    const C = T.cameras;
    let moved = false;
    this.ticks++;
    for (let i = 0; i < this.stands.length; i++) {
      const s = this.stands[i];
      if (s.aimed && (this.ticks + s.slot) % C.follow !== 0) continue;
      if (!dark && !frame.unseen(v2.set(s.x, 1.4, s.z), T.unwatched.small)) continue;
      s.aimed = true;
      this.aim(s, frame.eye);
      moved = true;
    }
    if (moved) this.bodies.commit();
  }

  reset(): void {
    this.ticks = 0;
    for (const s of this.stands) {
      s.aimed = false;
      this.aim(s, FROM_THE_SLIT);
    }
    this.bodies.commit();
  }
}

/** THE GUILLOTINE. Black iron and dark wood, far too big, its blade stuck exactly halfway. In front of it, in a strict row, the chairs of those who wait, the last one a barber's. */
class Guillotine {
  readonly group = new Group();
  readonly center: Vector3;
  readonly radius: number;

  /** @param lamp the one bulb that lights it */
  constructor(kit: DreamKit, lamp: Lamp) {
    const G = T.guillotine;
    this.group.name = 'Guillotine';
    const [x, z] = G.at;
    const toward = G.heading * DEG;
    const dx = Math.sin(toward);
    const dz = Math.cos(toward);
    const R = G.row;
    const last = R.first + R.irons * R.spacing;
    this.center = new Vector3(x + (dx * last) / 2, G.height / 2, z + (dz * last) / 2);
    this.radius = last / 2 + G.height;
    const paint = executionPaint();

    const frame = kit.prop('guillotine', [x, 0, z], { rotation: [0, G.heading, 0], scale: G.height });
    // the model carries its blade near the top: it is brought down halfway and stuck there
    for (const mesh of meshesOf(frame)) {
      if (/metal/i.test((mesh.material as Material).name)) mesh.position.y += (G.bladeAt - G.bladeFrom) / mesh.parent!.scale.y;
    }
    repaint(frame, paint);
    this.group.add(frame);

    // they wait on the side of its bench, facing it
    const irons = kit.props('iron_chair', R.irons, { scale: R.ironScale });
    repaint(irons.root, paint);
    for (let i = 0; i < R.irons; i++) {
      const along = R.first + i * R.spacing;
      irons.setMatrix(i, pose(m1, x + dx * along, 0, z + dz * along, toward + Math.PI));
    }
    irons.commit();
    const barber = kit.prop('barber_chair', [x + dx * last, 0, z + dz * last], { rotation: [0, G.heading + 180, 0] });
    this.group.add(irons.root, barber);

    const shadow = new FlatShadow(lamp.light.position, UP, 0.012);
    shadow.add(frame, G.shadowCell).add(irons.root, G.shadowCell).add(barber, G.shadowCell).finish();
    this.group.add(shadow.mesh);
  }
}

/** THE TORSOS. Mannequin stands in a dead straight line along the right wall. One has white hair hanging from its stump, and it is always the one a little ahead of you. */
class Torsos {
  readonly group = new Group();
  readonly center: Vector3;
  readonly radius: number;
  private readonly veil: Mesh;
  private readonly zs: number[];
  private at = -1;

  /** @param lamp the bulb that lights their far end (the rest catch what they can) */
  constructor(kit: DreamKit, lamp: Lamp) {
    const S = T.torsos;
    this.group.name = 'Torsos';
    this.zs = Array.from({ length: S.count }, (_, i) => S.from - i * S.spacing);
    const first = this.zs[0];
    const final = this.zs[S.count - 1];
    this.center = new Vector3(S.x, 1, (first + final) / 2);
    this.radius = (first - final) / 2 + S.scale;

    const plaster = new MeshStandardMaterial({ color: 0xa8a294, roughness: 0.82, metalness: 0 });
    const form = coarsen(kit.prop('mannequin', [0, 0, 0], { scale: S.scale }), S.cell, (_x, y) => y < S.standBelow * S.scale);
    const crowd = new PropCrowd(form, S.count, false);
    kit.paint(crowd.root, plaster);
    this.zs.forEach((z, i) => crowd.setMatrix(i, pose(m1, S.x, 0, z, -Math.PI / 2)));
    crowd.commit();
    this.group.add(crowd.root);

    this.veil = new Mesh(this.veilGeometry(), new MeshStandardMaterial({ color: 0xded9cc, roughness: 0.55, metalness: 0, side: DoubleSide }));
    this.veil.name = 'TorsoVeil';
    this.group.add(this.veil);

    // only those in reach of the bulb show a shadow of it on the floor
    const near = new PropCrowd(form, S.casting, false);
    for (let i = 0; i < S.casting; i++) near.setMatrix(i, pose(m1, S.x, 0, this.zs[S.count - 1 - i], -Math.PI / 2));
    const shadow = new FlatShadow(lamp.light.position, UP, 0.012);
    shadow.add(near.root, S.shadowCell).finish();
    this.group.add(shadow.mesh);
    this.reset();
  }

  /** Long white hair falling from the stump over the chest and the shoulders. */
  private veilGeometry(): BufferGeometry {
    const V = T.torsos.veil;
    const scale = T.torsos.scale;
    const rnd = randomFrom(V.seed);
    const positions: number[] = [];
    const index: number[] = [];
    const normals: number[] = [];
    let base = 0;
    for (let s = 0; s < V.strands; s++) {
      const a = rnd() * Math.PI * 2;
      const length = lerp(V.length[0], V.length[1], rnd());
      const start = 0.05 * scale * (0.3 + rnd() * 0.7);
      const flare = (0.09 + rnd() * 0.06) * scale;
      const drift = (rnd() - 0.5) * 0.08;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      for (let i = 0; i <= V.segments; i++) {
        const t = i / V.segments;
        // over the stump, then out over the shoulders, then straight down
        const out = start + flare * Math.min(1, t * 2.4) ** 0.7;
        const y = scale - 0.01 - t * length;
        const w = V.width * (1 - t * 0.75);
        const x = cos * out + drift * t;
        const z = sin * out + drift * 0.6 * t;
        positions.push(x - w * sin, y, z + w * cos, x + w * sin, y, z - w * cos);
        normals.push(cos, 0.15, sin, cos, 0.15, sin);
        if (i < V.segments) {
          const b = base + i * 2;
          index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
      }
      base += (V.segments + 1) * 2;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    geometry.setIndex(index);
    return geometry;
  }

  update(frame: DreamFrame): void {
    const S = T.torsos;
    // when no one watches the line, the veil has moved on to the one ahead of you
    const want = clamp(Math.round((S.from - (frame.eye.z - S.veil.ahead)) / S.spacing), 0, S.count - 1);
    if (want !== this.at && frame.unseen(v2.set(S.x, 1.4, this.zs[want]), T.unwatched.small) && frame.unseen(v2.set(S.x, 1.4, this.zs[this.at]), T.unwatched.small)) this.hang(want);
  }

  private hang(i: number): void {
    this.at = i;
    this.veil.position.set(T.torsos.x, 0, this.zs[i]);
  }

  reset(): void {
    this.hang(T.torsos.veil.startsOn);
  }
}

/** THE CLOCKS. Twelve wall clocks in a row on a slab of concrete, in one small light, all stopped at half past. One of them is running backwards. */
class Clocks {
  readonly group = new Group();
  readonly center: Vector3;
  private readonly lamp: Lamp;
  private readonly hands: ClockHand[] = [];
  private readonly start: number;

  constructor(kit: DreamKit, halos: Halos, wires: Wires) {
    const C = T.clocks;
    this.group.name = 'Clocks';
    const [sx, sz] = C.slab.at;
    const [w, h, d] = C.slab.size;
    this.center = new Vector3(sx, h / 2, sz);
    this.lamp = new Lamp(kit, halos, C.lamp);
    const slab = kit.block(w, h, d, kit.surface('conc_board', 3.5, { roughness: 0.95 }));
    slab.name = 'ClockSlab';
    slab.castShadow = true;
    slab.position.set(sx, h / 2, sz);
    this.group.add(slab);

    const halfPast = (i: number) => 3600 * ((i + 1) % 12) + 1800 + 30;
    this.start = halfPast(C.backwards);
    const copies: Object3D[] = [];
    for (let i = 0; i < C.count; i++) {
      const x = sx + (i - (C.count - 1) / 2) * C.spacing;
      const clock = kit.prop('wall_clock', [x, C.height, sz + d / 2 + C.off], { scale: C.scale, anchor: 'center' });
      // (the prop itself carries the name the rig looks for: it must look inside)
      const hands = rigClock(clock.children[0]);
      setClock(hands, halfPast(i));
      if (i === C.backwards) {
        this.hands = hands;
        this.group.add(clock);
      } else copies.push(clock);
    }
    this.group.add(bakeCopies(copies, C.cell, C.glassCell));
    hangBulb(kit, this.group, wires, this.lamp);
  }

  update(frame: DreamFrame): void {
    const C = T.clocks;
    this.lamp.shine(1, frame.view);
    setClock(this.hands, this.start - Math.floor(frame.time * C.ticksPerSecond) * C.secondsPerTick);
  }
}

// ------------------------------------------------------------------ the whole

/**
 * Chapter IV, the tableaux: islands of absurd, terrible domesticity in the colossal dark of the hall, each
 * lit by its own small light. Nothing moves while it is watched.
 */
export class HallTableaux implements DreamModule {
  readonly root = new Group();
  readonly span = [LAYOUT.hall.from, LAYOUT.hall.to] as const;

  private readonly halos = new Halos(T.halos);
  private readonly dinner: Dinner;
  private readonly classroom: Classroom;
  private readonly screens: Screens;
  private readonly heads: WallOfHeads;
  private readonly gnomes: Gnomes;
  private readonly rats: Rats;
  private readonly dentist: Dentist;
  private readonly cameras: Cameras;
  private readonly torsos: Torsos;
  private readonly clocks: Clocks;
  /** Each set piece is culled as a whole, for each camera. */
  private readonly islands: { group: Group; center: Vector3; radius: number }[];
  private walkBefore = 0;
  /** Seconds since the shell's cold light failed. */
  private sinceShaftFailed = Infinity;

  constructor(kit: DreamKit) {
    this.root.name = 'HallTableaux';
    const wires = new Wires();
    this.dinner = new Dinner(kit, this.halos);
    this.classroom = new Classroom(kit, this.halos, wires);
    this.screens = new Screens(kit, this.halos);
    this.heads = new WallOfHeads(kit, this.halos, wires);
    this.rats = new Rats(kit);
    this.dentist = new Dentist(kit, this.halos, wires);
    this.cameras = new Cameras(kit, this.halos);
    const guillotine = new Guillotine(kit, this.heads.lamp);
    this.torsos = new Torsos(kit, this.heads.lamp);
    this.clocks = new Clocks(kit, this.halos, wires);

    const slab = T.clocks.slab;
    const M = T.dinner.mirror;
    this.gnomes = new Gnomes(kit, [
      { x: M.at[0], z: M.at[1], r: 1.2 },
      { x: slab.at[0] - 1.6, z: slab.at[1], r: 1.1 },
      { x: slab.at[0] + 1.6, z: slab.at[1], r: 1.1 },
      ...T.cameras.stand.map(([x, z]) => ({ x, z, r: 0.75 })),
      // the class, the dresses that hang low, what the head threw up around itself, and the head
      { x: -11.2, z: -117.2, r: 4.4 },
      { x: -7.2, z: -107, r: 0.7 },
      { x: -8.8, z: -113, r: 0.7 },
      { x: 8.7, z: -115, r: 2.4 },
      { x: 7.5, z: -97.5, r: 2.6 },
      { x: 11, z: -105, r: 8 },
    ]);

    this.root.add(this.dinner.group, this.classroom.group, this.screens.group, this.screens.picture, this.heads.group, this.gnomes.group, this.rats.crowd.root);
    this.root.add(this.dentist.group, this.cameras.group, guillotine.group, this.torsos.group, this.clocks.group, this.dinner.chain, this.halos.mesh, wires.mesh());

    this.islands = [
      { group: this.dinner.group, center: this.dinner.center, radius: T.dinner.lamp.matters },
      { group: this.classroom.group, center: this.classroom.center, radius: T.classroom.lamp.matters },
      { group: this.screens.group, center: this.screens.center, radius: T.screens.lamps.matters },
      { group: this.heads.group, center: this.heads.center, radius: T.heads.lamp.matters + 3 },
      { group: this.dentist.group, center: this.dentist.center, radius: T.dentist.lamp.matters },
      { group: this.cameras.group, center: this.cameras.center, radius: this.cameras.radius },
      { group: guillotine.group, center: guillotine.center, radius: guillotine.radius },
      { group: this.torsos.group, center: this.torsos.center, radius: this.torsos.radius },
      { group: this.clocks.group, center: this.clocks.center, radius: T.clocks.lamp.matters },
      { group: this.gnomes.group, center: new Vector3(0, 0.4, (T.gnomes.first[0][1] + T.gnomes.crowd.to) / 2), radius: (T.gnomes.first[0][1] - T.gnomes.crowd.to) / 2 + T.gnomes.crowd.halfWidth / 2 },
    ];
    this.reset();
  }

  update(frame: DreamFrame): void {
    if (frame.paused) return;
    const before = this.walkBefore;
    this.sinceShaftFailed = passed(SHAFT_FAILS, before, frame.walk) ? 0 : this.sinceShaftFailed + frame.dt;
    const floorDark = this.sinceShaftFailed > T.shaftFails.from && this.sinceShaftFailed < T.shaftFails.to;

    const table = this.dinner.update(frame, before);
    const tube = this.classroom.update(frame, before);
    const wall = this.screens.update(frame, before);
    const cage = this.dentist.update(frame, before);
    const bulb = this.heads.update(frame, before);
    this.cameras.update(frame, floorDark);
    this.torsos.update(frame);
    this.clocks.update(frame);
    this.gnomes.update(frame, this.screens.drop.level, this.screens.drop.dark, floorDark);
    this.rats.update(frame, table || tube || wall || cage || bulb);
    this.halos.commit();
    this.walkBefore = frame.walk;
    this.screens.film(frame);
  }

  prepare(camera: PerspectiveCamera): void {
    const S = this.screens;
    const lens = camera === S.camera;
    S.picture.visible = lens;
    S.glass.visible = !lens;
    S.glassForLens.visible = lens;
    for (const island of this.islands) island.group.visible = sphereSeen(camera, island.center, island.radius);
  }

  develop(renderDream: (target: WebGLRenderTarget, camera: PerspectiveCamera) => void): void {
    this.screens.develop(renderDream);
  }

  reset(): void {
    this.walkBefore = 0;
    this.sinceShaftFailed = Infinity;
    this.dinner.reset();
    this.classroom.reset();
    this.screens.reset();
    this.heads.reset();
    this.gnomes.reset();
    this.rats.reset();
    this.dentist.reset();
    this.cameras.reset();
    this.torsos.reset();
    this.halos.commit();
  }
}
