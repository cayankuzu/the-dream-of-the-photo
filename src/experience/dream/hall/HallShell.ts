import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  ShaderChunk,
  ShaderMaterial,
  SRGBColorSpace,
  TubeGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { REDUCED_MOTION } from '../../../config/experience.config';
import { LAYOUT, type SpotSpec } from '../../../config/nightmare.config';
import { clamp, damp, DEG, lerp, range, smootherstep, wobble } from '../../math';
import { HASH_GLSL } from '../../render/glsl';
import { WARP_GLSL, warpUniforms } from '../../render/Warp';
import { BEND_STEP, type DreamKit, type PropCrowd } from '../DreamKit';
import type { DreamFrame, DreamModule } from '../DreamModule';
import { randomFrom } from '../FigureKit';

type V3 = readonly [number, number, number];

const { halfWidth: HALF, height: HEIGHT, to: END_Z } = LAYOUT.hall;

/** The room (m). */
const ROOM = {
  /** The street's wall ends here: everything after it is the hall's. */
  startZ: -66,
  /** How far walls and roof run on into what they meet, so that no crack can open. */
  overlap: 1.5,
  /** A frame is a fin on either side and a beam across: the first one's z, the pitch, how many. */
  frames: { first: -71, pitch: 6, count: 9 },
  fin: { thick: 1.2, deep: 2.5 },
  beam: { thick: 1.2, deep: 1.5 },
  /** The long slit in the roof: half width, its near and far z, and how deep the slab it cuts is. */
  slit: { half: 1.1, from: -70, to: -120, depth: 0.8 },
  /** The wall at the far end and the way out through it. */
  endWall: { thick: 2, slitHalf: 1.5, slitHeight: 3.6 },
  /** Things in the room are only drawn while the eye is between these z: until then only a slit shows it. */
  drawFrom: -50,
  drawTo: -136,
  /** Behind all the concrete, a black box (half width, top): should a crack ever open, it shows nothing. */
  backing: { half: 18.5, top: 27 },
} as const;

/** The concrete. */
const POUR = {
  /** One pour (height) and the formwork's repeat along a wall (width), m. */
  lift: 4.4,
  panel: 6,
  /** Its textures repeat every this many meters. The board and the stained ones are warm: these tints make them the same cold stuff. */
  tile: { board: 4, lifts: 4, stained: 4.5, cracked: 5 },
  tint: { board: 0xc2cad8, stained: 0xd4dbe6 },
  /** Share of the panels that are stained, low down or high up (they stand in water, or under the leaks) and elsewhere; and that are boards. */
  stained: { wet: 0.34, dry: 0.16 },
  board: 0.32,
  /** Each panel a little lighter or darker than the next: lowest, and range. */
  tone: [0.84, 0.3] as const,
  /** Water running down it: how dark at most, and how much weaker low on the wall. Damp rising from the floor: how dark. */
  runs: 0.66,
  runsLow: 0.45,
  damp: 0.55,
} as const;

/** The cold light that comes through the roof. */
const SHAFT = {
  position: [0, 30, -95] as V3,
  target: [0, 0, -95] as V3,
  color: 0xbad4ff,
  /** Candela, at 30 m from the floor. */
  intensity: 6000,
  /** Half angle (deg): its far edge stays within the 40 m of the shadow camera. */
  angle: 41,
  penumbra: 0.34,
  /** Half width of the shaft in the air at the floor, and the width of each beam's shadow on the floor. */
  stripHalf: 8,
  barWidth: 2.6,
  /**
   * A blocker above the roof (height, half size) cuts the bars, and the shaft at `open` m either side:
   * the point light itself is too near the real roof to draw them. On the floor the edge is softened from `soft[0]` to `soft[1]`.
   */
  gobo: { y: 28, half: 2.4, open: 10.5, soft: [3.5, 9.8] as const },
  /** The sky seen through the slit (linear color, brightness). */
  sky: { color: [0.62, 0.78, 1] as V3, gain: 15 },
  /** The light that strays: what the lit floor sends back up the walls, its reach (m), the height it seems to come from (m). */
  bounce: { gain: 1.25, reach: 7.5, height: 0.6 },
  /** How brightly the slit lights the concrete just around it: the sides of the beams, and the soffits. */
  soffit: { sides: 7, under: 5 },
  /** Light in the air: cross sheets per bay, the long sheets' x, the brightness of each, and how it fades to the floor. */
  sheets: { perBay: 3, along: [-5.6, -2.8, 0, 2.8, 5.6], gain: 0.0052, alongGain: 0.02, color: [0.68, 0.82, 1] as V3, foot: 2.8 },
  /** Dust in it: how many, size (m), brightness, how fast it sinks (m/s), and the least width on screen (px at 1080). */
  dust: { count: 1400, size: [0.014, 0.034] as const, gain: 1.4, fall: 0.022, minPixels: 1.5 },
} as const;

/** The floor (m, linear colors). */
const FLOOR = {
  tile: 6,
  /** Multiplies the asphalt's own near-black, so the light has something to fall on. */
  albedo: 2.2,
  /** Share of the room's reflections it keeps: it must stay black. */
  env: 0.8,
  /** Standing water: center x, center z, half sizes. */
  basins: [
    [0, -95, 1.1, 22.5],
    [-10.6, -109.5, 3.75, 4.1],
    [-4.2, -94, 0.42, 10.5],
    [3.4, -77.5, 0.55, 8],
  ] as const,
  /** The water's own color and roughness; the curb around it; the rough ground (roughness multiplied, dry and damp) and the broken ground. */
  water: { albedo: 0.0035, rough: 0.045 },
  curb: 0.1,
  rough: { dry: 1.3, damp: 0.72, broken: 0.86 },
  /** Lines where the slabs of the floor meet (half width), every this far across the hall. */
  joint: { width: 0.012, every: 8.5, dark: 0.7 },
  /** Drains along the walls (x) and under each frame: half width, how dark. */
  drain: { x: 14.05, width: 0.15, dark: 0.94 },
  /** Mirror images on the wet floor: the slit in the roof, the red way out, the hair. How strong on dry, damp ground and on water. */
  mirror: { sky: 0.15, red: [1.1, 0.03, 0.018] as V3, hair: 1.15, gloss: [0.3, 0.75, 1.35] as const },
  /** Cracked ground around the head: where it starts and ends (m from the head), how bright, and where it is dark as a pit. */
  broken: { from: 15, to: 10, tone: 0.3, pit: [9.5, 6] as const },
} as const;

/** The way out at the far end. */
const RED = {
  light: { position: [0, 1.9, -125.5] as V3, color: 0xff2a12, intensity: 34, distance: 9 },
  /** Glow in the slit (linear color) and around it on the wall, and the z over which both fade as the eye comes close. */
  glow: [0.46, 0.006, 0.003] as V3,
  halo: [0.1, 0.002, 0.001] as V3,
  fade: [-120, -111] as const,
} as const;

/** The white hair. */
const HAIR = {
  /** Strands (each a ribbon of `segments`), gathered in this many locks. */
  strands: 2300,
  segments: 16,
  locks: 56,
  /** The wall it pours from, where it falls, the middle of its bay; height of the slit in the wall. */
  wallX: -16.9,
  fallX: -13,
  z: -110,
  y: 22,
  /** Half width of the mass at the slit and on reaching the water (along z), and half its depth (along x). */
  slitHalf: 2.05,
  footHalf: 2.75,
  depth: 1.7,
  /** How it leaves the wall (the larger, the sooner it is over and going straight down) and how it gathers speed. */
  arc: 8,
  gather: 1.55,
  /** Share of a strand's length spent falling; the rest lies on the water, spreading this far (m). */
  land: 0.86,
  spread: [0.3, 3.4] as const,
  /** Ribbon width (m), the least it is drawn (px at 1080), and how much of it covers. */
  width: [0.022, 0.06] as const,
  minPixels: 0.8,
  cover: 0.82,
  /** Speed its strands flow down at (m/s), how much it sways (1: as designed; waves are in the shader). */
  flow: 0.85,
  sway: 1,
  /** What lights it (`power`: its own candela in this shader; the spot itself stays lean). */
  lamp: { position: [-5, 25, -93] as V3, target: [-13.5, 7, -110] as V3, color: 0xdce8ff, intensity: 420, angle: 15, penumbra: 0.7, power: 3000 },
  /** How it takes the light: broad, and in the band where it mirrors the lamp to the eye (and how narrow); how much it glows by itself. */
  broad: 0.2,
  band: 0.42,
  sharp: 26,
  glow: 0.1,
  color: [0.93, 0.915, 0.86] as V3,
  /** How far the air veils it: it should shine through the fog. */
  veil: 0.62,
  /** A long look at it. */
  poi: { y: 10, radius: 9, zoom: 0.84, reach: 60 },
} as const;

/** The beds. Plan, row by row: left column first. w whole, t whole (turned), h half, e empty, o overturned. */
const WARD = {
  rows: [-80.5, -83.5, -89, -92, -95, -98, -101, -104],
  columns: [-12.6, -9.5, -6.4],
  plan: ['wtw', 'teh', 'hwt', 'wow', 'ewh', 'who', 'twe', 'oew'],
  /** Height of the mattress under the sheet (m), slight disorder of the strict rows (rad). */
  mattress: 0.56,
  disorder: 0.012,
  /** How the overturned ones lie, about their middle: tipped along (rad), rolled over (rad), the height of their middle (m). */
  fallen: [
    { tip: 0, over: 1.5, height: 0.455 },
    { tip: 0.178, over: Math.PI, height: 0.413 },
    { tip: 0, over: -1.5, height: 0.455 },
  ],
  /** The dark each bed presses into the floor: size (m), how dark. */
  contact: { width: 1.7, length: 2.9, dark: 0.86 },
  /** Fixtures on long cords: x, z (always a frame's: the cords go up to its beam), candela (0 is dead), flicker seed. */
  lamps: [
    { x: -9.5, z: -83, intensity: 13, seed: 1.3 },
    { x: -12.6, z: -89, intensity: 0, seed: 0 },
    { x: -9.5, z: -95, intensity: 15, seed: 4.9 },
    { x: -6.4, z: -95, intensity: 0, seed: 0 },
    { x: -12.6, z: -101, intensity: 10, seed: 7.7 },
  ],
  /** The fixture: its underside (m), how coarse its scan may be (see `coarser`), the plates it hangs from either side of its middle (m). */
  lampHeight: 2.6,
  lampCoarse: 0.012,
  lampPlates: 0.213,
  lampReach: 7,
  lampColor: 0xd6e8e4,
  /** Emissive strength of the tube. */
  lampGlow: 5,
  /** A lamp falters when its slow noise passes this, fully by that; speed of the noise (1/s), of the stutter (rad/s, under 3 Hz). */
  falter: { from: 0.62, to: 0.8, rate: 0.31, stutter: 14.5 },
  /** The wheelchair: its z, x from and to, over this span of the walk; speed (m/s); gaze narrower than this (deg), for this long (s), stops it. */
  chair: { z: -86, from: -13, to: -5, walk: [0.355, 0.5] as const, speed: 0.62, gaze: 15, patience: 1.4 },
} as const;

/**
 * The dresses that hang from the roof: hook x, y, z, which shoulder, turn rate (rad/s), size. Low ones hang
 * between the beds or over the black water. Those at the shaft's edge, clear of the beams' shadows, are
 * pale figures; those past it stand dark against the hair, as seen from where the viewer turns to it.
 */
const DRESSES = [
  { at: [-7.95, 2.35, -92] as V3, shoulder: 1, rate: 0.05, size: 1.55 },
  { at: [-12.1, 6.5, -98] as V3, shoulder: -1, rate: -0.03, size: 1.5 },
  { at: [-5.9, 10.2, -104] as V3, shoulder: 1, rate: 0.022, size: 1.6 },
  { at: [-11.05, 2.1, -104] as V3, shoulder: -1, rate: -0.042, size: 1.55 },
  { at: [-14.05, 2.3, -98] as V3, shoulder: 1, rate: 0.036, size: 1.5 },
  { at: [-6.9, 1.74, -108.6] as V3, shoulder: -1, rate: 0.06, size: 1.55 },
  { at: [-10.6, 1.86, -107] as V3, shoulder: 1, rate: -0.026, size: 1.58 },
  { at: [-10.4, 14, -107] as V3, shoulder: 1, rate: -0.018, size: 1.62 },
  { at: [-9.2, 1.78, -110.8] as V3, shoulder: 1, rate: -0.033, size: 1.55 },
  { at: [-6.3, 6.8, -113] as V3, shoulder: -1, rate: 0.028, size: 1.5 },
] as const;
const DRESS_RIG = {
  /** Where a hook goes through the dress, in shares of its height, and how far it then hangs aslant (rad). */
  shoulder: [0.03, 0.975, 0.14] as V3,
  lean: 0.23,
  /** Height of the hook (m). */
  hook: 0.36,
  /** They are never nearer than a few meters: how coarse the scan may be (see `coarser`). */
  coarse: 0.011,
  /** Chains: width (m) and the length one picture of them covers. */
  chain: { width: 0.05, tile: 0.2 },
} as const;

/** What forgot gravity, high in the shaft: position, turn (deg); how far it all drifts (m) and turns (deg), and over how long (s). */
const FLOATS = {
  beds: [
    { at: [-1.7, 11.6, -82.5] as V3, turn: [24, 52, -17] as V3 },
    { at: [3, 9.4, -90.5] as V3, turn: [-14, -38, 31] as V3 },
    { at: [-3.2, 15, -100] as V3, turn: [33, 128, 12] as V3 },
  ],
  crutches: { at: [2.4, 15.2, -86] as V3, turn: [58, 20, 71] as V3 },
  chair: { at: [-3.6, 10.4, -104] as V3, turn: [-22, 148, 38] as V3 },
  drift: 0.28,
  sway: 2.6,
  period: 47,
} as const;

/** The head: it is what the hall is for. */
const HEAD = {
  /** Where it turns about (x, y, z), its height (m), and at what share of that it turns. */
  at: [11, 6.6, -105] as V3,
  scale: 22,
  pivot: 0.62,
  /** Below this share of its height is only its mount: not drawn. Nor the post it stood on (box in shares of its height, from its center): the bust is hollow. */
  cut: 0.22,
  post: { x: 0.17, z: [-0.13, 0.2] as const, y: 0.64, upright: 0.25 },
  /** Its yaw at first (deg; 0 faces +Z, back up the walk): it faces away. One turn; how far it nods looking at the sky, and staring. */
  yaw: 170,
  /** Where the viewer stands as seen from it at first (deg): at the slit. */
  startViewer: -15,
  step: 25,
  nod: [18, 42] as const,
  /** Its face is off the model's axis by this (deg). Rough radius (m) that counts for being out of view. */
  face: 4,
  radius: 9,
  /** Seconds between turns while it is simply out of view. */
  every: 0.8,
  /**
   * The light fails at these points of the walk (the whole shaft, if `shaft`); in the dark it turns `steps`.
   * Seconds: fall, hold, rise.
   */
  failures: [
    { at: 0.362, steps: 2, shaft: false },
    { at: 0.405, steps: 2, shaft: false },
    { at: 0.437, steps: 1, shaft: true },
    { at: 0.4575, steps: 1, shaft: false },
  ],
  lampFailure: [0.16, 0.42, 0.34] as const,
  /** The same for those who ask for less motion: never a hit, only a slow dimming. */
  lampFailureCalm: [0.55, 0.3, 0.7] as const,
  /** The shaft's dark must span what the tableaux do in it: 0.4 to 1.25 s after it starts to fail. */
  shaftFailure: [0.4, 0.85, 0.8] as const,
  /**
   * The hard light from its side. It stands where the head faces, so that the face is always what it finds
   * (ahead, aside, up, in m from the pivot), and only ever moves with it, unseen. While the head still
   * faces away, it stands off to the side of the viewer instead (`away`: degrees from them, m, share of its strength), raking the broken back.
   */
  lamp: { ahead: 13, aside: -7, rise: 4, away: [76, 15, 0.5], color: 0xdfeaff, intensity: 1900, angle: 29, penumbra: 0.85 },
  /** Share of the shaft it takes: it stands in the shaft's edge, and the flat of its back should not burn out there. */
  shaftShare: 0.03,
  /** A long look at it. */
  poi: { position: [11, 9, -105] as V3, radius: 15, zoom: 0.82, reach: 60 },
  color: 0xc4c4bc,
  /** How dark its crevices are (share of its color), how deep its surface is roughened (m). */
  crevice: 0.2,
  rough: 0.05,
} as const;

/** Lights fail by hits, or for those who ask for less motion by slow dimmings. */
const LAMP_FAILURE = REDUCED_MOTION ? HEAD.lampFailureCalm : HEAD.lampFailure;

/** Broken ground around the head: how many tilted slabs at most, their ring, size, tilt (rad). */
const SLABS = {
  count: 19,
  ring: [7.8, 12] as const,
  width: [3, 6.4] as const,
  length: [2.6, 5] as const,
  thick: 0.55,
  tilt: [0.16, 0.52] as const,
  /** No slab comes nearer to the path than this x, nor up the hall past this z. */
  clearX: 3.6,
  clearZ: -93.2,
  tint: 0x70737a,
} as const;
const REBAR = {
  /** Stubs sticking out of each slab, and those standing in rows on the floor: x, first z, how many, spacing. */
  perSlab: 3,
  rows: [
    { x: 5.1, z: -68.5, count: 8, step: 0.62 },
    { x: -5.3, z: -71, count: 7, step: 0.62 },
    { x: 15.9, z: -79, count: 6, step: 0.6 },
    { x: -15.9, z: -91, count: 6, step: 0.6 },
    { x: 15.9, z: -116, count: 6, step: 0.6 },
  ],
  radius: 0.012,
  height: [0.28, 0.7] as const,
  /** Repeat of the rust on a rod (m). */
  tile: 0.3,
} as const;

/** The smiling one in the far corner: no spot reaches it, only its one faint light on the smile and the shoulders. */
const ANGEL = {
  at: [13, 0, -119.5] as V3,
  scale: 22.5,
  color: 0x7c7c76,
  crevice: 0.25,
  rough: 0.03,
  light: { position: [10.6, 23.2, -111.4] as V3, color: 0xc4d6f4, intensity: 46, distance: 9.5 },
} as const;

/** The demon in the bay behind the hair, in its niche. */
const DEMON = {
  at: [-15.72, 0, -116] as V3,
  scale: 5,
  lintel: [5.5, 6.9] as const,
  coarse: 0.012,
  light: { position: [-13.2, 1.1, -114.6] as V3, color: 0xb9cbe6, intensity: 5, distance: 6.5 },
} as const;

/** A number as a GLSL float. */
const glf = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);
const glv = (v: V3): string => `vec3(${glf(v[0])}, ${glf(v[1])}, ${glf(v[2])})`;

/** What the room's reflections are multiplied by on all that is poured or carved here: the picture they come from is warm. */
const COLD_ENV = 'vec3(0.62, 0.78, 1.04)';

/** Screen heights are reckoned at this many pixels: a strand's or a speck's least size need not be exact. */
const REFERENCE_HEIGHT = '1080.0';

/** Smooth noise on the plane and in space, in [0, 1]. */
const NOISE_GLSL = /* glsl */ `
${HASH_GLSL}
float hallNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float hallHash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float hallNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hallHash3(i), hallHash3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hallHash3(i + vec3(0.0, 1.0, 0.0)), hallHash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hallHash3(i + vec3(0.0, 0.0, 1.0)), hallHash3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hallHash3(i + vec3(0.0, 1.0, 1.0)), hallHash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
`;

/** The line of three's lights where the spot that casts shadows (the shaft) has been shadowed: what follows it concerns only the shaft. */
const SHAFT_SHADOW = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;';
/** The line where each spot's light has been found: what follows it concerns all three. */
const ANY_SPOT = 'getSpotLightInfo( spotLight, geometryPosition, directLight );';

// no per-frame allocations: everything that moves goes through these
const m1 = new Matrix4();
const m2 = new Matrix4();
const m3 = new Matrix4();
const q1 = new Quaternion();
const q2 = new Quaternion();
const v1 = new Vector3();
const v2 = new Vector3();
const e1 = new Euler();
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_X = new Vector3(1, 0, 0);
const UNIT = new Vector3(1, 1, 1);

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const frameZ = (i: number): number => ROOM.frames.first - i * ROOM.frames.pitch;

// ------------------------------------------------------------------ surfaces in curved space

/**
 * Concrete poured face by face into one mesh per material: rectangles cut to BEND_STEP, UVs in meters.
 * Merged rather than instanced: every fin keeps its own texture coordinates, at the cost of one draw all the same.
 */
class Pour {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];

  /** A rectangle from corner `o`, along `u` and `v`; it faces u × v. `step` is its longest edge, for what need not bend. */
  rect(o: V3, u: V3, v: V3, transform?: Matrix4, step: number = BEND_STEP): void {
    const ul = Math.hypot(u[0], u[1], u[2]);
    const vl = Math.hypot(v[0], v[1], v[2]);
    const nu = Math.max(1, Math.ceil(ul / step));
    const nv = Math.max(1, Math.ceil(vl / step));
    const nx = (u[1] * v[2] - u[2] * v[1]) / (ul * vl);
    const ny = (u[2] * v[0] - u[0] * v[2]) / (ul * vl);
    const nz = (u[0] * v[1] - u[1] * v[0]) / (ul * vl);
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    const base = this.positions.length / 3;
    v2.set(nx, ny, nz);
    if (transform) v2.transformDirection(transform);
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const a = i / nu;
        const b = j / nv;
        const x = o[0] + u[0] * a + v[0] * b;
        const y = o[1] + u[1] * a + v[1] * b;
        const z = o[2] + u[2] * a + v[2] * b;
        if (ay >= ax && ay >= az) this.uvs.push(x, z);
        else if (ax >= az) this.uvs.push(z, y);
        else this.uvs.push(x, y);
        v1.set(x, y, z);
        if (transform) v1.applyMatrix4(transform);
        this.positions.push(v1.x, v1.y, v1.z);
        this.normals.push(v2.x, v2.y, v2.z);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const c = base + j * (nu + 1) + i;
        this.indices.push(c, c + 1, c + nu + 2, c, c + nu + 2, c + nu + 1);
      }
    }
  }

  /** A block between two corners; `faces` names the ones anybody can see (+x -x +y -y +z -z). */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, faces: readonly string[], transform?: Matrix4): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    for (const f of faces) {
      if (f === '+x') this.rect([x1, y0, z1], [0, 0, -dz], [0, dy, 0], transform);
      if (f === '-x') this.rect([x0, y0, z0], [0, 0, dz], [0, dy, 0], transform);
      if (f === '+y') this.rect([x0, y1, z1], [dx, 0, 0], [0, 0, -dz], transform);
      if (f === '-y') this.rect([x0, y0, z0], [dx, 0, 0], [0, 0, dz], transform);
      if (f === '+z') this.rect([x0, y0, z1], [dx, 0, 0], [0, dy, 0], transform);
      if (f === '-z') this.rect([x1, y0, z0], [-dx, 0, 0], [0, dy, 0], transform);
    }
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
    g.setIndex(this.indices);
    return g;
  }

  mesh(material: MeshStandardMaterial | MeshBasicMaterial): Mesh {
    const mesh = new Mesh(this.geometry(), material);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }
}

// ------------------------------------------------------------------ pictures drawn once

function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d')! };
}

/** One panel of formwork as a multiplier: the joints between pours, the holes the ties left and what ran from them. */
function panelMap(): CanvasTexture {
  const W = 1024;
  const H = 752;
  const { canvas, ctx } = canvas2d(W, H);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  // the board marks of the form, barely there
  const random = randomFrom(0x51ab);
  for (let y = 0; y < H; y += 33) {
    ctx.fillStyle = `rgba(0,0,0,${0.03 + random() * 0.05})`;
    ctx.fillRect(0, y, W, 1.5);
  }
  // ties: a regular grid, the signature of formed concrete
  const cols = 6;
  const rows = 4;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = ((i + 0.5) / cols) * W;
      const y = ((j + 0.5) / rows) * H;
      const run = ctx.createLinearGradient(0, y, 0, y + 46 + random() * 60);
      run.addColorStop(0, `rgba(0,0,0,${0.12 + random() * 0.2})`);
      run.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = run;
      ctx.fillRect(x - 2.5, y, 5, 110);
      const hole = ctx.createRadialGradient(x, y, 0, x, y, 5.5);
      hole.addColorStop(0, 'rgba(0,0,0,0.95)');
      hole.addColorStop(0.7, 'rgba(0,0,0,0.9)');
      hole.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = hole;
      ctx.beginPath();
      ctx.arc(x, y, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // the joints: dark in the groove, with what bled out of the form below it
  ctx.fillStyle = 'rgba(0,0,0,0.82)';
  ctx.fillRect(0, 0, W, 3.5);
  ctx.fillRect(0, H - 3.5, W, 3.5);
  ctx.fillRect(0, 0, 3.5, H);
  ctx.fillRect(W - 3.5, 0, 3.5, H);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(W / 2 - 1.5, 0, 3, H);
  const bleed = ctx.createLinearGradient(0, 3, 0, 40);
  bleed.addColorStop(0, 'rgba(0,0,0,0.3)');
  bleed.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bleed;
  ctx.fillRect(0, 3, W, 37);
  const t = new CanvasTexture(canvas);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** A ward's linen, washed too often: yellowed, stained where bodies were, with a line along the hem. */
function linenMap(): CanvasTexture {
  const W = 1024;
  const H = 512;
  const { canvas, ctx } = canvas2d(W, H);
  ctx.fillStyle = '#dcd9cd';
  ctx.fillRect(0, 0, W, H);
  const random = randomFrom(0x77e1);
  const blot = (x: number, y: number, r: number, color: string, alpha: number) => {
    const g = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
    g.addColorStop(0, `rgba(${color},${alpha})`);
    g.addColorStop(0.75, `rgba(${color},${alpha * 0.55})`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(random() * Math.PI);
    ctx.scale(1, 0.45 + random() * 0.55);
    ctx.translate(-x, -y);
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
  };
  // wide yellow shadows of old washes
  for (let i = 0; i < 26; i++) blot(random() * W, random() * H, 60 + random() * 150, '150,132,84', 0.1 + random() * 0.14);
  // what the bodies left, dark at the rims
  for (let i = 0; i < 34; i++) {
    const x = random() * W;
    const y = random() * H;
    const r = 8 + random() ** 2 * 62;
    blot(x, y, r, random() < 0.3 ? '74,50,34' : '112,88,50', 0.18 + random() * 0.3);
    blot(x + r * 0.2, y - r * 0.1, r * 0.72, '220,214,196', 0.25);
  }
  // rust from the springs, in rows
  for (let i = 0; i < 90; i++) blot(random() * W, random() * H, 1.5 + random() * 5, '110,62,30', 0.2 + random() * 0.35);
  // the weave
  for (let x = 0; x < W; x += 3) {
    ctx.fillStyle = `rgba(60,55,44,${0.018 + random() * 0.03})`;
    ctx.fillRect(x, 0, 1, H);
  }
  for (let y = 0; y < H; y += 3) {
    ctx.fillStyle = `rgba(60,55,44,${0.018 + random() * 0.03})`;
    ctx.fillRect(0, y, W, 1);
  }
  // a thin faded stripe near each long edge
  ctx.fillStyle = 'rgba(70,84,100,0.28)';
  ctx.fillRect(0, 26, W, 5);
  ctx.fillRect(0, H - 31, W, 5);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Links of a chain on a transparent ground. */
function chainMap(): CanvasTexture {
  const { canvas, ctx } = canvas2d(32, 128);
  ctx.clearRect(0, 0, 32, 128);
  ctx.strokeStyle = '#8d8a84';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(16, 32, 9, 28, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#8d8a84';
  ctx.fillRect(13, 58, 6, 42);
  ctx.fillRect(13, 0, 6, 6);
  ctx.fillRect(13, 118, 6, 10);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** A soft dark oval: what stands on the floor presses a little darkness into it. */
function contactMap(): CanvasTexture {
  const { canvas, ctx } = canvas2d(64, 64);
  const g = ctx.createRadialGradient(32, 32, 6, 32, 32, 32);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.55, '#a8a8a8');
  g.addColorStop(1, '#000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

/** Red light leaking onto the wall around the way out. */
function haloMap(): CanvasTexture {
  const { canvas, ctx } = canvas2d(128, 128);
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.28, '#6a6a6a');
  g.addColorStop(0.62, '#141414');
  g.addColorStop(1, '#000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(canvas);
}

// ------------------------------------------------------------------ what the models are made into

/** The same model without the triangles `drop` names: its place in shares of the model's height from the center of its base, and how much it faces up or down (0..1). */
function withoutTriangles(geometry: BufferGeometry, drop: (x: number, y: number, z: number, flat: number) => boolean): BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const scale = box.max.y - box.min.y;
  const cx = (box.max.x + box.min.x) / 2;
  const cz = (box.max.z + box.min.z) / 2;
  const p = geometry.getAttribute('position');
  const n = geometry.getAttribute('normal');
  const index = geometry.getIndex()!;
  const keep: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    const x = ((p.getX(a) + p.getX(b) + p.getX(c)) / 3 - cx) / scale;
    const y = ((p.getY(a) + p.getY(b) + p.getY(c)) / 3 - box.min.y) / scale;
    const z = ((p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3 - cz) / scale;
    if (!drop(x, y, z, Math.abs(n.getY(a) + n.getY(b) + n.getY(c)) / 3)) keep.push(a, b, c);
  }
  const g = new BufferGeometry();
  for (const name of Object.keys(geometry.attributes)) g.setAttribute(name, geometry.getAttribute(name));
  g.setIndex(keep);
  return g;
}

/**
 * The same model with fewer triangles: all vertices within a cell of this size (in shares of its
 * longest side) drawn together at the middle of that cell's, and what that flattens dropped. Each keeps
 * its own texture coordinates, and no seam can open. For what is only ever seen from afar.
 */
function coarser(geometry: BufferGeometry, cell: number): BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = cell * Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
  const p = geometry.getAttribute('position');
  const cells = new Map<string, number>();
  const inCell = new Uint32Array(p.count);
  const sums: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${Math.round(p.getX(i) / size)},${Math.round(p.getY(i) / size)},${Math.round(p.getZ(i) / size)}`;
    let c = cells.get(key);
    if (c === undefined) {
      c = cells.size;
      cells.set(key, c);
      sums.push(0, 0, 0, 0);
    }
    inCell[i] = c;
    sums[c * 4] += p.getX(i);
    sums[c * 4 + 1] += p.getY(i);
    sums[c * 4 + 2] += p.getZ(i);
    sums[c * 4 + 3]++;
  }
  const positions = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = inCell[i] * 4;
    positions[i * 3] = sums[c] / sums[c + 3];
    positions[i * 3 + 1] = sums[c + 1] / sums[c + 3];
    positions[i * 3 + 2] = sums[c + 2] / sums[c + 3];
  }
  const index = geometry.getIndex()!;
  const keep: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    if (inCell[a] !== inCell[b] && inCell[b] !== inCell[c] && inCell[a] !== inCell[c]) keep.push(a, b, c);
  }
  const g = new BufferGeometry();
  for (const name of Object.keys(geometry.attributes)) g.setAttribute(name, geometry.getAttribute(name));
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setIndex(keep);
  return g;
}

/**
 * How much of a scan lies in a hollow (0: deep in a crevice, .5: on a plain, 1: on a ridge): the
 * distance from each vertex to the surface smoothed out over two sizes. It stands in for the shadows
 * a statue cannot cast on itself here, and for the dirt that collects in it.
 */
function cavityOf(geometry: BufferGeometry): Float32Array {
  const p = geometry.getAttribute('position');
  const n = geometry.getAttribute('normal');
  const index = geometry.getIndex()!;
  const count = p.count;
  let from = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    from[i * 3] = p.getX(i);
    from[i * 3 + 1] = p.getY(i);
    from[i * 3 + 2] = p.getZ(i);
  }
  const rest = from.slice();
  let to = new Float32Array(count * 3);
  const hits = new Uint16Array(count);
  const smooth = () => {
    to.fill(0);
    hits.fill(0);
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t);
      const b = index.getX(t + 1);
      const c = index.getX(t + 2);
      for (let k = 0; k < 3; k++) {
        to[a * 3 + k] += from[b * 3 + k] + from[c * 3 + k];
        to[b * 3 + k] += from[a * 3 + k] + from[c * 3 + k];
        to[c * 3 + k] += from[a * 3 + k] + from[b * 3 + k];
      }
      hits[a] += 2;
      hits[b] += 2;
      hits[c] += 2;
    }
    for (let i = 0; i < count; i++) {
      const h = Math.max(1, hits[i]);
      to[i * 3] /= h;
      to[i * 3 + 1] /= h;
      to[i * 3 + 2] /= h;
    }
    const swap = from;
    from = to;
    to = swap;
  };
  const depth = new Float32Array(count);
  const measure = (weight: number) => {
    let sum = 0;
    const d = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      d[i] = (from[i * 3] - rest[i * 3]) * n.getX(i) + (from[i * 3 + 1] - rest[i * 3 + 1]) * n.getY(i) + (from[i * 3 + 2] - rest[i * 3 + 2]) * n.getZ(i);
      sum += d[i] * d[i];
    }
    const sigma = Math.sqrt(sum / count) || 1;
    for (let i = 0; i < count; i++) depth[i] += (weight * d[i]) / sigma;
  };
  for (let k = 0; k < 3; k++) smooth();
  measure(0.5);
  for (let k = 0; k < 12; k++) smooth();
  measure(0.5);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = clamp(0.5 - depth[i] * 0.3, 0, 1);
  return out;
}

/**
 * Plaster or stone with no maps: dirt by position, dark in its crevices, its surface roughened, and a
 * dimmer of its own. `spots` says how much of all three spots, and of the shaft among them, reaches it.
 */
function stone(material: MeshStandardMaterial, meters: number, crevice: number, roughen: number, spots: { all: number; shaft: number }, lit: { value: number }): MeshStandardMaterial {
  const lights = ShaderChunk.lights_fragment_begin
    .replace(ANY_SPOT, `${ANY_SPOT}\ndirectLight.color *= ${glf(spots.all)};`)
    .replace(SHAFT_SHADOW, `${SHAFT_SHADOW}\ndirectLight.color *= ${glf(spots.shaft)};`);
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uLit = lit;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCavity;\nvarying float vCavity;\nvarying vec3 vRock;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvCavity = aCavity;\nvRock = transformed * ${glf(meters)};`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vCavity;\nvarying vec3 vRock;\nuniform float uLit;\n${NOISE_GLSL}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        float rockWide = hallNoise3(vRock * 0.3);
        float rockFine = hallNoise3(vRock * 1.5 + 7.0);
        diffuseColor.rgb *= mix(0.68, 1.08, rockWide * 0.62 + rockFine * 0.38);
        // water went down it for a long time
        float rockRun = hallNoise(vec2((vRock.x + vRock.z) * 0.8, vRock.y * 0.07));
        diffuseColor.rgb *= 1.0 - 0.42 * smoothstep(0.6, 0.88, rockRun);
        diffuseColor.rgb *= mix(${glf(crevice)}, 1.1, smoothstep(0.08, 0.72, vCavity));
        // hollow: nothing lights the inside
        if (!gl_FrontFacing) diffuseColor.rgb *= 0.03;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        {
          float h = (rockFine * 0.55 + hallNoise3(vRock * 4.3) * 0.45) * ${glf(roughen)};
          vec3 dpx = dFdx(-vViewPosition);
          vec3 dpy = dFdy(-vViewPosition);
          vec3 r1 = cross(dpy, normal);
          vec3 r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          normal = normalize(abs(det) * normal - sign(det) * (dFdx(h) * r1 + dFdy(h) * r2));
        }`,
      )
      .replace('#include <lights_fragment_begin>', lights)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\nradiance *= ${COLD_ENV};\niblIrradiance *= ${COLD_ENV};`)
      .replace('#include <opaque_fragment>', 'outgoingLight *= uLit;\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => `hall-stone-${crevice}-${roughen}-${meters}-${spots.all}-${spots.shaft}`;
  return material;
}

/** The springs of a bed (in shares of its height): under a sheet nobody sees them, and they are two thirds of its triangles. */
const BED_SPRINGS = (x: number, y: number, z: number): boolean => y > 0.33 && y < 0.5 && Math.abs(x) < 0.34 && Math.abs(z) < 0.78;

/** A sheet over a body, as a height above the mattress: a sum of soft mounds, draped. */
type Relief = (x: number, z: number) => number;

const mound = (x: number, z: number, cx: number, cz: number, sx: number, sz: number): number => Math.exp(-(((x - cx) / sx) ** 2) - ((z - cz) / sz) ** 2);

/** The p-norm of mounds rather than their sum: cloth takes the highest shape under it and spans the rest. */
const draped = (heights: readonly number[]): number => {
  let s = 0;
  for (const h of heights) s += h * h * h;
  return Math.cbrt(s);
};

/** On its back: head on a thin pillow, shoulders, chest, hips, the legs side by side, the feet tenting the cloth. Head to -z. */
const wholeBody: Relief = (x, z) =>
  draped([
    0.215 * mound(x, z, 0, -0.74, 0.095, 0.105),
    0.15 * mound(x, z, 0, -0.45, 0.235, 0.075),
    0.215 * mound(x, z, 0, -0.29, 0.195, 0.17),
    0.15 * mound(x, z, 0, -0.03, 0.165, 0.13),
    0.165 * mound(x, z, 0, 0.11, 0.195, 0.1),
    0.135 * mound(x, z, 0.094, 0.34, 0.074, 0.24),
    0.135 * mound(x, z, -0.094, 0.34, 0.074, 0.24),
    0.145 * mound(x, z, 0.09, 0.44, 0.06, 0.055),
    0.145 * mound(x, z, -0.09, 0.44, 0.06, 0.055),
    0.1 * mound(x, z, 0.09, 0.67, 0.058, 0.16),
    0.1 * mound(x, z, -0.09, 0.67, 0.058, 0.16),
    0.235 * mound(x, z, 0.1, 0.845, 0.052, 0.05),
    0.235 * mound(x, z, -0.1, 0.845, 0.052, 0.05),
    0.075 * mound(x, z, 0.262, -0.08, 0.038, 0.3),
    0.075 * mound(x, z, -0.262, -0.08, 0.038, 0.3),
  ]);

/** The other one: head fallen to one side, one knee drawn up under the cloth. */
const turnedBody: Relief = (x, z) =>
  draped([
    0.2 * mound(x, z, 0.075, -0.75, 0.115, 0.095),
    0.155 * mound(x, z, 0.01, -0.45, 0.235, 0.075),
    0.205 * mound(x, z, 0, -0.29, 0.195, 0.17),
    0.14 * mound(x, z, 0, -0.03, 0.165, 0.13),
    0.16 * mound(x, z, 0, 0.11, 0.195, 0.1),
    0.33 * mound(x, z, 0.1, 0.42, 0.07, 0.11),
    0.13 * mound(x, z, 0.09, 0.24, 0.075, 0.14),
    0.13 * mound(x, z, 0.09, 0.6, 0.07, 0.13),
    0.125 * mound(x, z, -0.095, 0.42, 0.075, 0.3),
    0.21 * mound(x, z, -0.1, 0.86, 0.052, 0.05),
    0.14 * mound(x, z, 0.1, 0.76, 0.06, 0.055),
    0.07 * mound(x, z, -0.262, -0.08, 0.038, 0.3),
  ]);

/** A body that ends at the waist: past it the sheet falls flat. */
const halfBody: Relief = (x, z) => wholeBody(x, z) * (1 - smootherstep(range(-0.06, 0.09, z)));

/** Nobody: the sheet sags into the shape where somebody was. */
const noBody: Relief = (x, z) => -0.035 * mound(x, z, 0, -0.05, 0.27, 0.62);

/** Thrown on the floor: a heap of folds that sinks away toward its edges, so that nothing of it is a straight line. */
const crumpled: Relief = (x, z) =>
  0.21 * mound(x, z, 0.1, -0.38, 0.24, 0.3) +
  0.17 * mound(x, z, -0.12, 0.04, 0.22, 0.36) +
  0.19 * mound(x, z, 0.07, 0.5, 0.21, 0.28) +
  0.03 * Math.sin(x * 23 + z * 7) * Math.sin(z * 19 - x * 5) +
  0.014 * Math.sin(x * 41 - z * 13) -
  0.035;

/** The cloth over a relief: `across` columns, `along` rows, falling off the rails on both long sides. Normals from the shape itself. */
function sheetGeometry(relief: Relief, seed: number, mattress: number): BufferGeometry {
  const across = 18;
  const along = 40;
  const random = randomFrom(seed);
  // folds run mostly along the length, as cloth pulled over a body does
  const fold = Array.from({ length: 7 }, () => ({ a: (random() - 0.5) * 0.9, f: 22 + random() * 46, p: random() * 6.28, h: 0.0009 + random() * 0.0021 }));
  const wrinkle = (x: number, z: number) => {
    let s = 0;
    for (const w of fold) s += Math.sin((x * Math.cos(w.a) + z * Math.sin(w.a)) * w.f + w.p) * w.h;
    // a few wide slack hollows
    s += Math.sin(x * 9 + z * 3.4 + fold[0].p) * Math.sin(z * 5.3 + fold[1].p) * 0.0045;
    return s;
  };
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const hemSeed = random() * 10;
  for (let j = 0; j <= along; j++) {
    const z = lerp(-0.93, 0.92, j / along);
    for (let i = 0; i <= across; i++) {
      const c = (i / across) * 2 - 1;
      const inner = Math.abs(c) <= 0.78;
      const side = Math.sign(c) || 1;
      let x: number;
      let y: number;
      if (inner) {
        x = (c / 0.78) * 0.46;
        const fade = 1 - smootherstep(range(0.32, 0.46, Math.abs(x)));
        y = mattress + relief(x, z) * fade + wrinkle(x, z);
      } else {
        // over the rail and straight down, in shallow pleats, the hem almost even
        const t = (Math.abs(c) - 0.78) / 0.22;
        const hang = 0.23 + 0.018 * Math.sin(z * 5 + hemSeed + side);
        const pleat = Math.sin(z * 17 + hemSeed + side * 2) * 0.55 + Math.sin(z * 41 + hemSeed) * 0.45;
        x = side * (0.46 + 0.045 * Math.sin(Math.min(1, t * 2.4) * Math.PI * 0.5) + 0.016 * t * t * pleat);
        y = mattress + wrinkle(side * 0.46, z) - hang * smootherstep(t) - 0.01 * t;
      }
      positions.push(x, y, z);
      uvs.push((x + 0.52) / 1.04 + seed * 0.13, (z + 0.95) / 1.9 + seed * 0.37);
    }
  }
  for (let j = 0; j < along; j++) {
    for (let i = 0; i < across; i++) {
      const a = j * (across + 1) + i;
      const b = a + across + 1;
      indices.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ the air: hair, shaft, dust

const HAIR_VERT = /* glsl */ `
#include <fog_pars_vertex>
${WARP_GLSL}
attribute vec4 aRoot; // along the slit (-1..1), height (m), depth in the mass (-1..1), phase
attribute vec4 aFoot; // the way it spreads on the water (rad), how far (m), width (m), brightness
uniform float uTime;
uniform float uSway;
uniform vec3 uLamp;
uniform float uLampPower;
varying vec2 vRibbon;   // across (-1..1), meters along
varying vec3 vLit;
varying vec3 vStrand;   // phase, how far out in the mass, thinness (share of light kept when drawn wider than it is)

const float WALL_X = ${glf(HAIR.wallX)};
const float FALL_Z = ${glf(HAIR.z)};
const float SLIT_Y = ${glf(HAIR.y)};
const float REACH = ${glf(HAIR.fallX - HAIR.wallX)};
const float DEPTH = ${glf(HAIR.depth)};
const float SLIT_HALF = ${glf(HAIR.slitHalf)};
const float FOOT_HALF = ${glf(HAIR.footHalf)};
const float LAND = ${glf(HAIR.land)};
const float ARC = ${glf(HAIR.arc)};
const float LENGTH = ${glf(HAIR.y * 1.12 + HAIR.spread[1] * 0.5)};

vec3 strand(float v) {
  float f = min(v / LAND, 1.0);
  float y = (SLIT_Y + aRoot.y) * (1.0 - pow(f, ${glf(HAIR.gather)}));
  // out of the slit, over, and straight down
  float x = WALL_X + (REACH + DEPTH * aRoot.z * sqrt(f)) * (1.0 - exp(-f * ARC)) / (1.0 - exp(-ARC));
  float z = FALL_Z + aRoot.x * mix(SLIT_HALF, FOOT_HALF, f);
  // waves that travel down it, growing as it falls
  float p = aRoot.w * 6.2832;
  float a = uSway * f;
  x += a * (0.2 * sin(y * 0.38 + uTime * 0.55 + p) + 0.055 * sin(y * 1.13 + uTime * 0.9 + p * 3.0));
  z += a * (0.27 * cos(y * 0.31 + uTime * 0.47 + p * 2.0) + 0.05 * sin(y * 0.97 + uTime * 0.8 + p * 5.0));
  // on the water it lies down and spreads
  float r = clamp((v - LAND) / (1.0 - LAND), 0.0, 1.0);
  r = r * r * (3.0 - 2.0 * r);
  x += cos(aFoot.x) * aFoot.y * r;
  z += sin(aFoot.x) * aFoot.y * r;
  y = max(y, 0.02 + 0.012 * sin(aRoot.w * 40.0));
  return vec3(x, y, z);
}

void main() {
  float v = position.y;
  vec3 p = strand(v);
  vec3 tangent = normalize(strand(v + 0.012) - p);
  vec3 eye = normalize(cameraPosition - p);
  vec3 across = cross(tangent, eye);
  float sinView = length(across);
  across = sinView > 0.001 ? across / sinView : vec3(0.0, 0.0, 1.0);

  // thinner than a pixel it is drawn a pixel wide and dimmer, or it would shimmer
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  float pixel = -mvPosition.z * 2.0 / (projectionMatrix[1][1] * ${REFERENCE_HEIGHT});
  float taper = smoothstep(0.0, 0.05, v) * (1.0 - 0.55 * v) * (1.0 - smoothstep(0.95, 1.0, v));
  float width = aFoot.z * taper;
  float drawn = max(width, ${glf(HAIR.minPixels)} * pixel);
  mvPosition = viewMatrix * vec4(p + across * position.x * drawn * 0.5, 1.0);
  gl_Position = projectionMatrix * dreamWarp(mvPosition);
  #include <fog_vertex>

  // hair takes light along its length: broad on the side of the lamp, a bright band where it mirrors the lamp to the eye
  vec3 toLamp = uLamp - p;
  float d2 = dot(toLamp, toLamp);
  vec3 lamp = toLamp / sqrt(d2);
  float tl = dot(tangent, lamp);
  float tv = dot(tangent, eye);
  float sinL = sqrt(max(0.0, 1.0 - tl * tl));
  float sinV = sqrt(max(0.0, 1.0 - tv * tv));
  float band = pow(max(0.0, sinL * sinV - tl * tv), ${glf(HAIR.sharp)});
  // the mass shades itself: far side and heart are dark
  vec2 off = vec2(p.x - (WALL_X + REACH), p.z - FALL_Z);
  float outward = length(vec2(aRoot.x, aRoot.z));
  float facing = dot(off, normalize(lamp.xz)) / max(length(off), 0.3);
  float mass = mix(0.42, 1.0, smoothstep(-0.7, 0.8, facing)) * mix(0.5, 1.0, smoothstep(0.1, 0.85, outward));
  float hood = smoothstep(0.0, 0.1, v);
  vLit = vec3(aFoot.w) * hood * (${glf(HAIR.glow)} * mix(0.6, 1.0, mass) + uLampPower / d2 * (${glf(HAIR.broad)} * sinL * mass + ${glf(HAIR.band)} * band * mass));
  vStrand = vec3(aRoot.w, outward, width / drawn);
  vRibbon = vec2(position.x, v * LENGTH);
}
`;

const HAIR_FRAG = /* glsl */ `
#include <fog_pars_fragment>
uniform float uTime;
uniform float uFlow;
uniform vec3 uColor;
varying vec2 vRibbon;
varying vec3 vLit;
varying vec3 vStrand;

void main() {
  // a ribbon about a pixel wide is shaded at a pixel center outside it (MSAA), where this runs past +-1
  float s = clamp(vRibbon.x, -1.0, 1.0);
  float l = vRibbon.y;
  float p = vStrand.x * 6.2832;
  // it is always coming down: light and dark move along each strand
  float down = l - uTime * uFlow * (0.75 + 0.5 * fract(vStrand.x * 7.0));
  float flow = 0.74 + 0.2 * sin(down * 0.85 + p) + 0.1 * sin(down * 2.4 + p * 3.0) + 0.05 * sin(down * 6.1 + p * 7.0);
  // the loose strands outside the mass fall in lengths, with gaps between
  float loose = smoothstep(0.62, 0.95, vStrand.y);
  float gap = fract(down * 0.085 + vStrand.x * 3.0);
  float a = (1.0 - 0.5 * s * s) * mix(1.0, smoothstep(0.0, 0.12, gap) * (1.0 - smoothstep(0.82, 1.0, gap)), loose);
  a *= vStrand.z * ${glf(HAIR.cover)};
  float air = 1.0;
  #ifdef USE_FOG
    air = exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #endif
  vec3 light = uColor * vLit * flow * mix(1.0, air, ${glf(HAIR.veil)});
  gl_FragColor = vec4(light * a, a * 0.9);
}
`;

const SHAFT_VERT = /* glsl */ `
#include <fog_pars_vertex>
${WARP_GLSL}
attribute float aAlong;
varying vec3 vAt;
varying float vAlong;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vAt = world.xyz;
  vAlong = aAlong;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * dreamWarp(mvPosition);
  #include <fog_vertex>
}
`;

/** Where light falls in the shaft (0..1 at a world point): a wedge from the slit to the strip, cut by the shadows of the beams. */
const WEDGE_GLSL = /* glsl */ `
float hallWedge(vec3 at) {
  float high = clamp(at.y / ${glf(HEIGHT)}, 0.0, 1.0);
  float wide = mix(${glf(SHAFT.stripHalf)}, ${glf(ROOM.slit.half * 1.25)}, high);
  float across = exp(-2.2 * at.x * at.x / (wide * wide));
  float pitch = ${glf(ROOM.frames.pitch)};
  float toFrame = abs(mod(at.z - ${glf(ROOM.frames.first)} + pitch * 0.5, pitch) - pitch * 0.5);
  float bar = smoothstep(${glf(ROOM.beam.thick / 2 + 0.35)}, ${glf(ROOM.beam.thick / 2 + 1.05)}, toFrame);
  float ends = smoothstep(${glf(ROOM.slit.to - 1)}, ${glf(ROOM.slit.to + 5)}, at.z) * (1.0 - smoothstep(${glf(ROOM.slit.from - 5)}, ${glf(ROOM.slit.from + 1)}, at.z));
  return across * bar * ends * mix(0.2, 1.0, high * high);
}
`;

const SHAFT_FRAG = /* glsl */ `
#include <fog_pars_fragment>
${NOISE_GLSL}
${WEDGE_GLSL}
uniform vec3 uColor;
uniform float uShaft;
uniform float uAlongGain;
uniform float uCrossGain;
uniform float uTime;
varying vec3 vAt;
varying float vAlong;

void main() {
  vec3 toEye = cameraPosition - vAt;
  float dist = length(toEye);
  vec3 ray = toEye / dist;
  // a card seen edge-on says what it is: it fades before that, and nearer than a few meters
  float facing = vAlong > 0.5 ? abs(ray.x) : abs(ray.z);
  float card = smoothstep(0.1, 0.46, facing) * smoothstep(1.6, 7.0, dist);
  float foot = smoothstep(0.0, ${glf(SHAFT.sheets.foot)}, vAt.y);
  float haze = 0.62 + 0.76 * hallNoise(vec2(vAt.x * 0.21 + uTime * 0.017, vAt.y * 0.14 - uTime * 0.03 + vAt.z * 0.37));
  float air = 1.0;
  #ifdef USE_FOG
    air = exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #endif
  float gain = vAlong > 0.5 ? uAlongGain : uCrossGain;
  gl_FragColor = vec4(uColor * uShaft * gain * hallWedge(vAt) * foot * haze * card * mix(0.4, 1.0, air), 1.0);
}
`;

const DUST_VERT = /* glsl */ `
#include <fog_pars_vertex>
${WARP_GLSL}
${WEDGE_GLSL}
attribute vec4 aSpeck; // x, height share, z, its own phase
uniform float uTime;
uniform float uGain;
varying vec2 vDisc;
varying float vLight;

void main() {
  float phase = aSpeck.w * 6.2832;
  vec3 at = vec3(
    aSpeck.x + 0.35 * sin(uTime * 0.05 + phase),
    fract(aSpeck.y - uTime * ${glf(SHAFT.dust.fall)} * (0.4 + aSpeck.w) / ${glf(HEIGHT)}) * ${glf(HEIGHT)},
    aSpeck.z + 0.3 * cos(uTime * 0.043 + phase * 3.0));
  vec4 mvPosition = viewMatrix * vec4(at, 1.0);
  float depth = -mvPosition.z;
  float pixel = depth * 2.0 / (projectionMatrix[1][1] * ${REFERENCE_HEIGHT});
  float size = mix(${glf(SHAFT.dust.size[0])}, ${glf(SHAFT.dust.size[1])}, aSpeck.w);
  float drawn = max(size, ${glf(SHAFT.dust.minPixels)} * pixel);
  vLight = hallWedge(at) * uGain * (size / drawn) * (size / drawn) * smoothstep(0.4, 2.2, depth) * (0.55 + 0.45 * sin(uTime * 0.31 + phase * 5.0));
  mvPosition.xy += position.xy * drawn;
  gl_Position = projectionMatrix * dreamWarp(mvPosition);
  vDisc = position.xy * 2.0;
  #include <fog_vertex>
}
`;

const DUST_FRAG = /* glsl */ `
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform float uShaft;
varying vec2 vDisc;
varying float vLight;

void main() {
  float air = 1.0;
  #ifdef USE_FOG
    air = exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #endif
  float disc = max(0.0, 1.0 - dot(vDisc, vDisc));
  gl_FragColor = vec4(uColor * uShaft * vLight * disc * air, 1.0);
}
`;

// ------------------------------------------------------------------ the hall

interface Hanging {
  x: number;
  y: number;
  z: number;
  rate: number;
  turn: number;
  shoulder: number;
  size: number;
}

interface Lamp {
  light: { intensity: number };
  glass: MeshStandardMaterial[];
  intensity: number;
  seed: number;
}

interface Failure {
  shaft: boolean;
  steps: number;
  clock: number;
  turned: boolean;
}

/**
 * IV. Beton: a concrete hall far too large, entered and left through slits. The room itself, its one
 * shaft of cold light, and what fills its left half: the ward, the empty dresses, the hair that pours
 * from the wall; things that forgot gravity; and the head, half sunk in the floor, which is never seen
 * to move and is looking at you when you leave.
 */
export class HallShell implements DreamModule {
  readonly root = new Group();
  readonly span = [LAYOUT.hall.from, END_Z] as const;
  readonly region = 'hall' as const;
  readonly spots: readonly (SpotSpec | null)[];

  private readonly shaft: SpotSpec = { position: SHAFT.position, target: SHAFT.target, color: SHAFT.color, intensity: SHAFT.intensity, angle: SHAFT.angle, penumbra: SHAFT.penumbra };
  private readonly hairLamp: SpotSpec = { position: HAIR.lamp.position, target: HAIR.lamp.target, color: HAIR.lamp.color, intensity: HAIR.lamp.intensity, angle: HAIR.lamp.angle, penumbra: HAIR.lamp.penumbra };
  private readonly headLamp: SpotSpec = { position: [0, 0, 0], target: [HEAD.at[0], HEAD.at[1] + 1.5, HEAD.at[2]], color: HEAD.lamp.color, intensity: HEAD.lamp.intensity, angle: HEAD.lamp.angle, penumbra: HEAD.lamp.penumbra };

  /** What is only drawn once the eye is at the slit. */
  private readonly detail = new Group();
  /** How much of the shaft is on (0..1), for everything it lights: the concrete, the floor, the air. */
  private readonly shaftLevel = { value: 1 };
  private readonly time = { value: 0 };
  private readonly skyMaterial: MeshBasicMaterial;
  private readonly linen = new MeshStandardMaterial({ map: linenMap(), color: 0xe9e6dc, roughness: 0.94, side: DoubleSide });
  private readonly skyColor = new Color(...SHAFT.sky.color).multiplyScalar(SHAFT.sky.gain);
  private readonly redGlow: MeshBasicMaterial;
  private readonly redHalo: MeshBasicMaterial;

  private readonly hanging: Hanging[] = [];
  private readonly dresses: PropCrowd;
  private readonly hooks: PropCrowd;
  private readonly floatBeds: PropCrowd;
  private readonly floatSheets: InstancedMesh;
  private readonly floaters: { object: Object3D; at: V3; turn: V3; seed: number }[] = [];

  private readonly lamps: Lamp[] = [];
  private readonly chair: Object3D;
  private chairX: number = WARD.chair.from;
  private chairSpeed = 0;
  private chairGaze = 0;

  private readonly headYawGroup = new Group();
  private readonly headNodGroup = new Group();
  private readonly headAt = new Vector3(...HEAD.at);
  private readonly headLit = { value: 1 };
  private headYaw = HEAD.yaw * DEG;
  private headNext = 0;
  private headLampPower: number = HEAD.lamp.intensity;
  private failure: Failure | null = null;
  private lastWalk = 0;
  private clock = 0;

  constructor(kit: DreamKit) {
    this.root.name = 'HallShell';
    this.detail.name = 'HallShellDetail';
    this.root.add(this.detail);
    this.spots = [this.shaft, this.hairLamp, this.headLamp];

    const panels = panelMap();
    this.pourRoom(kit, panels);
    this.skyMaterial = this.buildSlit();
    this.buildGobo();
    this.buildFloor(kit);
    this.buildAir();
    const red = this.buildWayOut(kit);
    this.redGlow = red.glow;
    this.redHalo = red.halo;

    this.buildHair(kit);
    this.chair = this.buildWard(kit);
    const hung = this.buildDresses(kit);
    this.dresses = hung.dresses;
    this.hooks = hung.hooks;
    const floating = this.buildFloats(kit);
    this.floatBeds = floating.beds;
    this.floatSheets = floating.sheets;
    this.buildHead(kit, panels);
    this.buildColossi(kit);
    this.reset();
  }

  // ------------------------------------------------------------------ the room

  /** Concrete that knows the room: its pours, its water runs, what light strays onto it. */
  private pourMaterial(material: MeshStandardMaterial, panels: CanvasTexture): MeshStandardMaterial {
    const shaftLevel = this.shaftLevel;
    const centerZ = (ROOM.slit.from + ROOM.slit.to) / 2;
    const reachZ = (ROOM.slit.from - ROOM.slit.to) / 2;
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uPanels = { value: panels };
      shader.uniforms.uShaft = shaftLevel;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPourAt;\nvarying vec3 vPourNormal;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vPourAt = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vPourNormal = mat3(modelMatrix) * objectNormal;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vPourAt;
          varying vec3 vPourNormal;
          uniform sampler2D uPanels;
          uniform float uShaft;
          ${NOISE_GLSL}`,
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `#include <map_fragment>
          vec3 pourAxis = abs(vPourNormal);
          float pourUpright = 1.0 - smoothstep(0.35, 0.7, pourAxis.y);
          // along the wall from its first frame, up it from the floor
          vec2 pourOn = pourAxis.x > pourAxis.z ? vec2(vPourAt.z - ${glf(ROOM.frames.first)}, vPourAt.y) : vec2(vPourAt.x, vPourAt.y);
          vec2 pourSize = vec2(${glf(POUR.panel)}, ${glf(POUR.lift)});
          float pourTone = ${glf(POUR.tone[0])} + ${glf(POUR.tone[1])} * hash12(floor(pourOn / pourSize) + 3.7);
          float pourWide = hallNoise(vec2(pourOn.x * 0.8, pourOn.y * 0.055));
          float pourFine = hallNoise(vec2(pourOn.x * 2.9 + 9.0, pourOn.y * 0.12));
          // dark where water runs down from the roof, damp where it rises from the floor
          float pourRuns = smoothstep(0.5, 0.82, pourWide * 0.66 + pourFine * 0.34) * mix(${glf(POUR.runsLow)}, 1.0, smoothstep(4.0, 22.0, vPourAt.y));
          float pourDamp = 1.0 - smoothstep(0.1, 1.8 + 2.6 * pourFine, vPourAt.y);
          vec3 pourPanel = texture2D(uPanels, pourOn / pourSize).rgb;
          diffuseColor.rgb *= mix(1.0, pourTone * pourPanel.r * (1.0 - ${glf(POUR.runs)} * pourRuns) * (1.0 - ${glf(POUR.damp)} * pourDamp), pourUpright);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          {
            // what the lit strip on the floor sends back up
            vec3 toStrip = vec3(-vPourAt.x, ${glf(SHAFT.bounce.height)} - vPourAt.y, 0.0);
            float near2 = dot(toStrip, toStrip);
            float faces = clamp((dot(vPourNormal, toStrip) / sqrt(near2 + 0.01) + 0.3) / 1.3, 0.0, 1.0);
            float along = 1.0 - smoothstep(${glf(reachZ * 0.45)}, ${glf(reachZ * 1.1)}, abs(vPourAt.z - ${glf(centerZ)}));
            float bounce = faces * along / (1.0 + near2 / ${glf(SHAFT.bounce.reach * SHAFT.bounce.reach)});
            // and the sky on what hangs right under the slit: the sides of the beams, and the soffits around the cut
            float sides = (1.0 - pourAxis.y) * smoothstep(${glf(HEIGHT - 8)}, ${glf(HEIGHT)}, vPourAt.y) * exp(-vPourAt.x * vPourAt.x / 6.0);
            float under = pourAxis.y * smoothstep(${glf(HEIGHT - ROOM.beam.deep - 0.2)}, ${glf(HEIGHT)}, vPourAt.y) * exp(-vPourAt.x * vPourAt.x / 3.2);
            totalEmissiveRadiance += diffuseColor.rgb * uShaft * (${glf(SHAFT.bounce.gain)} * bounce + along * (${glf(SHAFT.soffit.sides)} * sides + ${glf(SHAFT.soffit.under)} * under));
          }`,
        )
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\nradiance *= ${COLD_ENV};\niblIrradiance *= ${COLD_ENV};`);
    };
    material.customProgramCacheKey = () => 'hall-pour';
    return material;
  }

  private pourRoom(kit: DreamKit, panels: CanvasTexture): void {
    const lifts = new Pour();
    const board = new Pour();
    const stained = new Pour();
    const random = randomFrom(0x4a11);
    const anyPour = (y: number): Pour => {
      const r = random();
      // the lowest lift has stood in water, the highest under the leaks
      const dark = y < POUR.lift || y >= HEIGHT - POUR.lift - 1 ? POUR.stained.wet : POUR.stained.dry;
      return r < dark ? stained : r < dark + POUR.board ? board : lifts;
    };

    const near = ROOM.startZ + ROOM.overlap;
    const far = END_Z - ROOM.endWall.thick - ROOM.overlap;
    const roofTop = HEIGHT + 0.3;
    const liftRows: number[] = [];
    for (let y = 0; y < HEIGHT - 1; y += POUR.lift) liftRows.push(y);
    liftRows.push(roofTop);

    // side walls: every bay between two frames, one pour on another
    const bays = [near, ...Array.from({ length: ROOM.frames.count }, (_, i) => frameZ(i)), far];
    for (let b = 0; b + 1 < bays.length; b++) {
      for (let r = 0; r + 1 < liftRows.length; r++) {
        const y0 = liftRows[r];
        const dy = liftRows[r + 1] - y0;
        anyPour(y0).rect([-HALF, y0, bays[b]], [0, 0, bays[b + 1] - bays[b]], [0, dy, 0]);
        anyPour(y0).rect([HALF, y0, bays[b + 1]], [0, 0, bays[b] - bays[b + 1]], [0, dy, 0]);
      }
    }

    // fins and beams: the rhythm of the place
    const { fin, beam } = ROOM;
    for (let i = 0; i < ROOM.frames.count; i++) {
      const z = frameZ(i);
      lifts.box(-HALF - 0.3, -HALF + fin.deep, 0, roofTop, z - fin.thick / 2, z + fin.thick / 2, ['+x', '+z', '-z']);
      lifts.box(HALF - fin.deep, HALF + 0.3, 0, roofTop, z - fin.thick / 2, z + fin.thick / 2, ['-x', '+z', '-z']);
      board.box(-HALF - 0.3, HALF + 0.3, HEIGHT - beam.deep, HEIGHT + 0.1, z - beam.thick / 2, z + beam.thick / 2, ['-y', '+z', '-z']);
    }

    // the roof, cut along its middle; each piece runs a little under the sides of the cut (they belong to the sky)
    const lap = 0.02;
    const roof = (x0: number, x1: number, z0: number, z1: number) => stained.rect([x0, HEIGHT, z0], [x1 - x0, 0, 0], [0, 0, z1 - z0]);
    const { slit, endWall } = ROOM;
    roof(-HALF - 0.3, -slit.half + lap, far, near);
    roof(slit.half - lap, HALF + 0.3, far, near);
    roof(-slit.half, slit.half, slit.from - lap, near);
    roof(-slit.half, slit.half, far, slit.to + lap);

    // the end wall, its pours lapping a little into the way out so that its corners stay shut
    const back = END_Z - endWall.thick;
    const columns = [-HALF - 0.3, -13.5, -7.5, -endWall.slitHalf + lap, endWall.slitHalf - lap, 7.5, 13.5, HALF + 0.3];
    for (let c = 0; c + 1 < columns.length; c++) {
      const overSlit = c === 3;
      const x0 = overSlit ? columns[c] - lap * 5 : columns[c];
      const x1 = overSlit ? columns[c + 1] + lap * 5 : columns[c + 1];
      for (let r = 0; r + 1 < liftRows.length; r++) {
        const y0 = overSlit ? Math.max(liftRows[r], endWall.slitHeight - lap) : liftRows[r];
        if (liftRows[r + 1] <= y0) continue;
        anyPour(y0).rect([x0, y0, END_Z + (overSlit ? 0.001 : 0)], [x1 - x0, 0, 0], [0, liftRows[r + 1] - y0, 0]);
      }
    }
    lifts.rect([-endWall.slitHalf, 0, END_Z], [0, 0, -endWall.thick], [0, endWall.slitHeight, 0]);
    lifts.rect([endWall.slitHalf, 0, back], [0, 0, endWall.thick], [0, endWall.slitHeight, 0]);
    lifts.rect([-endWall.slitHalf, endWall.slitHeight, back], [endWall.slitHalf * 2, 0, 0], [0, 0, endWall.thick]);
    // its back, for whoever turns around in the corridor
    lifts.rect([-endWall.slitHalf, 0, back], [-HALF - 0.3 + endWall.slitHalf, 0, 0], [0, roofTop, 0]);
    lifts.rect([HALF + 0.3, 0, back], [endWall.slitHalf - HALF - 0.3, 0, 0], [0, roofTop, 0]);
    lifts.rect([endWall.slitHalf, endWall.slitHeight, back], [-endWall.slitHalf * 2, 0, 0], [0, roofTop - endWall.slitHeight, 0]);

    // the lips of the slit the hair comes from
    const hairBay = { from: HAIR.z - HAIR.slitHalf - 0.45, to: HAIR.z + HAIR.slitHalf + 0.45 };
    lifts.box(-HALF - 0.1, -HALF + 0.42, HAIR.y + 0.38, HAIR.y + 0.86, hairBay.from, hairBay.to, ['+x', '-y', '+y', '+z', '-z']);
    lifts.box(-HALF - 0.1, -HALF + 0.42, HAIR.y - 1.02, HAIR.y - 0.62, hairBay.from, hairBay.to, ['+x', '-y', '+y', '+z', '-z']);

    // the niche of what stands behind the hair
    const niche = { from: frameZ(7) - ROOM.frames.pitch + fin.thick / 2, to: frameZ(7) - fin.thick / 2 };
    stained.box(-HALF - 0.1, -HALF + fin.deep, DEMON.lintel[0], DEMON.lintel[1], niche.from, niche.to, ['+x', '-y', '+y']);

    const surface = (key: string, tile: number, tint = 0xffffff) => this.pourMaterial(kit.surface(key, tile, { color: new Color(tint) }), panels);
    this.root.add(
      lifts.mesh(surface('conc_pour_lifts', POUR.tile.lifts)),
      board.mesh(surface('conc_board', POUR.tile.board, POUR.tint.board)),
      stained.mesh(surface('conc_stained', POUR.tile.stained, POUR.tint.stained)),
    );

    // what is black: the slit in the wall, and the box behind everything
    const black = new Pour();
    black.rect([HAIR.wallX - 0.08, HAIR.y - 0.65, hairBay.to], [0, 0, hairBay.from - hairBay.to], [0, 1.05, 0]);
    const { half, top } = ROOM.backing;
    const whole = Number.POSITIVE_INFINITY;
    black.rect([-half, 0, near], [0, 0, far - near], [0, top, 0], undefined, whole);
    black.rect([half, 0, far], [0, 0, near - far], [0, top, 0], undefined, whole);
    black.rect([-half, top, far], [half * 2, 0, 0], [0, 0, near - far], undefined, whole);
    this.root.add(black.mesh(new MeshBasicMaterial({ color: 0x000000 })));
  }

  /** The sky through the roof: a bright strip above the slab and the sides of the cut, lit from above. */
  private buildSlit(): MeshBasicMaterial {
    const { half, from, to, depth } = ROOM.slit;
    const pour = new Pour();
    const top = HEIGHT + depth;
    pour.rect([-half - 0.2, top, to - 0.2], [(half + 0.2) * 2, 0, 0], [0, 0, from - to + 0.4]);
    pour.rect([-half, HEIGHT, from], [0, 0, to - from], [0, depth, 0]);
    pour.rect([half, HEIGHT, to], [0, 0, from - to], [0, depth, 0]);
    pour.rect([half, HEIGHT, from], [-half * 2, 0, 0], [0, depth, 0]);
    pour.rect([-half, HEIGHT, to], [half * 2, 0, 0], [0, depth, 0]);
    const g = pour.geometry();
    const p = g.getAttribute('position');
    const colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      // the sides of the cut fall off away from the sky; the sky is brightest in its middle
      const y = p.getY(i);
      const c = y >= top - 0.001 ? 1 - 0.3 * Math.abs(p.getX(i) / half) : lerp(0.05, 0.5, ((y - HEIGHT) / depth) ** 2);
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = c;
    }
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const material = new MeshBasicMaterial({ vertexColors: true, fog: false });
    material.color.copy(this.skyColor);
    const mesh = new Mesh(g, material);
    mesh.frustumCulled = false;
    this.root.add(mesh);
    return material;
  }

  /**
   * Above the roof, where nobody sees it, a plate that cuts the point of light into a shaft crossed by
   * the shadows of the beams. It is the only thing up there that casts: the real roof is so near the
   * light that its beams' shadows would swallow the floor. Laid out from where each bar must fall.
   */
  private buildGobo(): void {
    const [lx, ly, lz] = SHAFT.position;
    const { y, half } = SHAFT.gobo;
    const share = (ly - y) / ly;
    const inner = SHAFT.gobo.open * share;
    const pour = new Pour();
    const plate = (x0: number, x1: number, z0: number, z1: number) => pour.rect([lx + x0, y, lz + z0], [x1 - x0, 0, 0], [0, 0, z1 - z0]);
    plate(-half, -inner, -half, half);
    plate(inner, half, -half, half);
    for (let i = 0; i < ROOM.frames.count; i++) {
      const at = (frameZ(i) - lz) * share;
      const bar = (SHAFT.barWidth * share) / 2;
      plate(-inner, inner, at - bar, at + bar);
    }
    const gobo = pour.mesh(new MeshBasicMaterial({ side: DoubleSide, colorWrite: false, depthWrite: false }));
    gobo.receiveShadow = false;
    gobo.castShadow = true;
    gobo.name = 'HallGobo';
    this.root.add(gobo);
  }

  /** Wet black ground. Water stands in its basins, mirrors the bright things of the room, and it breaks up around the head. */
  private buildFloor(kit: DreamKit): void {
    const material = kit.surface('asphalt_wet_black', FLOOR.tile, { color: new Color(FLOOR.albedo, FLOOR.albedo, FLOOR.albedo) });
    // only the shaft's light passes through its soft edge on the floor
    const lightsWithEdge = ShaderChunk.lights_fragment_begin.replace(SHAFT_SHADOW, `${SHAFT_SHADOW}\ndirectLight.color *= shaftEdge;`);
    const cracked = kit.surface('conc_cracked', POUR.tile.cracked);
    const shaftLevel = this.shaftLevel;
    const time = this.time;
    const basins = FLOOR.basins.map((b) => `vec4(${b.map(glf).join(', ')})`).join(', ');
    const { frames, slit, endWall } = ROOM;
    const [hx, , hz] = HEAD.at;
    const { joint, drain, water, rough, mirror, broken } = FLOOR;
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uShaft = shaftLevel;
      shader.uniforms.uTime = time;
      shader.uniforms.uCracked = { value: cracked.map };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGround;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          varying vec3 vGround;
          uniform float uShaft;
          uniform float uTime;
          uniform sampler2D uCracked;
          const int BASINS = ${FLOOR.basins.length};
          const vec4 BASIN[BASINS] = vec4[BASINS](${basins});
          ${NOISE_GLSL}
          /* A dark line of this half width at distance d: thinner than a pixel, only as dark as it covers. */
          float hallLine(float d, float w) {
            float f = max(fwidth(d), 1e-4);
            return clamp((w + f * 0.5 - abs(d)) / f, 0.0, 1.0) * min(1.0, 2.0 * w / f);
          }`,
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `#include <map_fragment>
          vec2 fp = vGround.xz;
          float shaftEdge = 1.0 - smoothstep(${glf(SHAFT.gobo.soft[0])}, ${glf(SHAFT.gobo.soft[1])}, abs(fp.x));
          float toBasin = 1e3;
          for (int i = 0; i < BASINS; i++) {
            vec2 q = abs(fp - BASIN[i].xy) - BASIN[i].zw;
            toBasin = min(toBasin, max(q.x, q.y));
          }
          float basinEdge = fwidth(toBasin);
          float water = 1.0 - smoothstep(-0.012, 0.012 + basinEdge, toBasin);
          // on water the shaft would be one hard dot of the lamp it really is: water only mirrors the slit, below
          shaftEdge *= 1.0 - water;
          float curb = (1.0 - water) * (1.0 - smoothstep(0.035, 0.085 + basinEdge, toBasin));
          float dampness = hallNoise(fp * 0.19) * 0.62 + hallNoise(fp * 0.71 + 5.0) * 0.38;
          // around the head the ground is broken
          float toHead = distance(fp, vec2(${glf(hx)}, ${glf(hz)})) + (hallNoise(fp * 0.33) - 0.5) * 5.0;
          float broken = 1.0 - smoothstep(${glf(broken.to)}, ${glf(broken.from)}, toHead);
          if (broken > 0.001) diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uCracked, fp / ${glf(POUR.tile.cracked)}).rgb * ${glf(broken.tone)}, broken);
          diffuseColor.rgb *= smoothstep(${glf(broken.pit[1])}, ${glf(broken.pit[0])}, toHead);
          // the pours of the floor and the drains that run along the walls and under the frames
          float pitch = ${glf(frames.pitch)};
          float underFrame = abs(mod(fp.y - ${glf(frames.first)} + pitch * 0.5, pitch) - pitch * 0.5);
          float slabJoint = max(hallLine(mod(fp.x + ${glf(joint.every / 2)}, ${glf(joint.every)}) - ${glf(joint.every / 2)}, ${glf(joint.width)}), hallLine(underFrame - pitch * 0.5, ${glf(joint.width)}));
          float drain = max(hallLine(abs(fp.x) - ${glf(drain.x)}, ${glf(drain.width)}), hallLine(underFrame, ${glf(drain.width * 0.6)}) * step(${glf(FLOOR.basins[0][2])}, abs(fp.x)) * step(abs(fp.x), ${glf(drain.x)}));
          diffuseColor.rgb *= (1.0 - ${glf(joint.dark)} * slabJoint) * (1.0 - ${glf(drain.dark)} * drain);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${glf(water.albedo)}), water);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${glf(FLOOR.curb)}), curb);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `#include <roughnessmap_fragment>
          roughnessFactor = mix(mix(roughnessFactor * mix(${glf(rough.dry)}, ${glf(rough.damp)}, dampness), ${glf(rough.broken)}, broken), ${glf(water.rough)}, water);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
          {
            // the water is almost still; rings go out from where the hair comes down
            vec2 fromFall = fp - vec2(${glf(HAIR.fallX)}, ${glf(HAIR.z)});
            float ring = sin(length(fromFall) * 5.0 - uTime * 1.1) * 0.012 * exp(-length(fromFall) * 0.3);
            vec2 still = vec2(hallNoise(fp * 1.3 + uTime * 0.06) - 0.5, hallNoise(fp.yx * 1.3 - uTime * 0.05) - 0.5) * 0.012 + normalize(fromFall + 1e-3) * ring;
            vec3 waterNormal = normalize((viewMatrix * vec4(still.x, 1.0, still.y, 0.0)).xyz);
            normal = normalize(mix(normal, waterNormal, water));
          }`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          {
            // the mirror: what is bright in this room, found by following the reflected ray to it
            vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
            worldNormal = normalize(mix(vec3(0.0, 1.0, 0.0), worldNormal, mix(0.22, 1.0, water)));
            vec3 toEye = normalize(cameraPosition - vGround);
            vec3 ray = reflect(-toEye, worldNormal);
            // near the feet (steep) the wet floor is hardly a mirror at all
            float fresnel = max(0.0, 0.98 * pow(1.0 - saturate(dot(worldNormal, toEye)), 5.0) - 0.02);
            // standing water is a mirror, wet asphalt a smear, the broken ground nothing
            float gloss = mix(mix(${glf(mirror.gloss[0])}, ${glf(mirror.gloss[1])}, dampness), ${glf(mirror.gloss[2])}, water) * (1.0 - broken);
            float blur = mix(1.0, 0.16, water);

            // the slit in the roof: a long streak on the floor along the middle of the hall
            float skyX = vGround.x + ray.x / max(ray.y, 0.35) * ${glf(HEIGHT)};
            float skyFar = smoothstep(${glf(slit.to - 4)}, ${glf(slit.to + 6)}, vGround.z);
            float sky = exp(-skyX * skyX / (blur * 3.0 + 0.8));
            totalEmissiveRadiance += ${glv(SHAFT.sky.color)} * ${glf(SHAFT.sky.gain * mirror.sky)} * uShaft * sky * skyFar * fresnel * gloss;

            // the red way out
            if (ray.z < -0.015) {
              float t = (${glf(END_Z)} - vGround.z) / ray.z;
              vec2 hit = vGround.xy + ray.xy * t;
              float spread = 0.06 + t * mix(0.05, 0.012, water);
              float wide = 1.0 - smoothstep(${glf(endWall.slitHalf)} - spread, ${glf(endWall.slitHalf)} + spread, abs(hit.x));
              float tall = 1.0 - smoothstep(${glf(endWall.slitHeight)} - spread * 3.0, ${glf(endWall.slitHeight)} + spread * 3.0, hit.y);
              totalEmissiveRadiance += ${glv(mirror.red)} * wide * tall * fresnel * gloss;
            }

            // the hair
            vec2 flat2 = ray.xz;
            float flatLen = max(dot(flat2, flat2), 1e-4);
            vec2 toFall = vec2(${glf(HAIR.fallX)}, ${glf(HAIR.z)}) - fp;
            float along = dot(toFall, flat2) / flatLen;
            if (along > 0.0) {
              vec2 off = toFall - flat2 * along;
              float d = length(off);
              float h = ray.y * along;
              float body = (1.0 - smoothstep(${glf(HAIR.footHalf * 0.45)}, ${glf(HAIR.footHalf * 1.15)}, d)) * (1.0 - smoothstep(${glf(HAIR.y * 0.55)}, ${glf(HAIR.y)}, h));
              float strands = hallNoise(vec2(dot(off, vec2(-flat2.y, flat2.x)) * 7.0 / sqrt(flatLen), h * 0.1 + uTime * 0.2));
              totalEmissiveRadiance += ${glv(HAIR.color)} * ${glf(mirror.hair)} * body * (0.3 + 0.7 * strands) * fresnel * gloss;
            }
          }`,
        )
        .replace('#include <lights_fragment_begin>', lightsWithEdge)
        .replace(
          '#include <lights_fragment_maps>',
          `#include <lights_fragment_maps>
          radiance *= ${glf(FLOOR.env)} * ${COLD_ENV};
          iblIrradiance *= ${glf(FLOOR.env)} * ${COLD_ENV};`,
        );
    };
    material.customProgramCacheKey = () => 'hall-ground';
    this.root.add(kit.floor(-HALF - 1, HALF + 1, END_Z - ROOM.endWall.thick, ROOM.startZ + 1, -0.004, material));
  }

  /** The shaft in the air: thin sheets across the hall and a few along it, each fading before it is seen edge-on; and dust. */
  private buildAir(): void {
    const { perBay, along, gain, alongGain, color } = SHAFT.sheets;
    const fogUniforms = () => UniformsUtils.clone(UniformsLib.fog);
    const light = new Color(...color);

    // sheets: one draw, a coarse grid is enough since they lie at one depth
    const positions: number[] = [];
    const flags: number[] = [];
    const indices: number[] = [];
    const grid = (corner: (a: number, b: number) => V3, nu: number, nv: number, flag: number) => {
      const base = positions.length / 3;
      for (let j = 0; j <= nv; j++) {
        for (let i = 0; i <= nu; i++) {
          positions.push(...corner(i / nu, j / nv));
          flags.push(flag);
        }
      }
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
          const c = base + j * (nu + 1) + i;
          indices.push(c, c + 1, c + nu + 2, c, c + nu + 2, c + nu + 1);
        }
      }
    };
    const { frames, beam, slit } = ROOM;
    const lit = frames.pitch - beam.thick;
    for (let bay = -1; bay < frames.count; bay++) {
      const nearEdge = frameZ(bay) - beam.thick / 2;
      for (let s = 0; s < perBay; s++) {
        const z = nearEdge - lit * ((s + 0.5) / perBay);
        if (z > slit.from + 1 || z < slit.to - 1) continue;
        grid((a, b) => [(a * 2 - 1) * lerp(SHAFT.stripHalf * 1.55, slit.half * 2.4, b), b * HEIGHT, z], 8, 6, 0);
      }
    }
    for (const x of along) {
      grid((a, b) => [x, b * HEIGHT, lerp(slit.from + 1, slit.to - 1, a)], 28, 6, 1);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('aAlong', new Float32BufferAttribute(flags, 1));
    g.setIndex(indices);
    const sheets = new Mesh(
      g,
      new ShaderMaterial({
        vertexShader: SHAFT_VERT,
        fragmentShader: SHAFT_FRAG,
        uniforms: {
          ...fogUniforms(),
          ...warpUniforms,
          uColor: { value: light },
          uCrossGain: { value: gain },
          uAlongGain: { value: alongGain },
          uTime: this.time,
          uShaft: this.shaftLevel,
        },
        fog: true,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    );
    sheets.frustumCulled = false;
    sheets.renderOrder = 3;
    sheets.name = 'HallShaft';
    this.root.add(sheets);

    // dust: small quads that turn to the eye, seen only in the light
    const { count } = SHAFT.dust;
    const random = randomFrom(0xd057);
    const specks = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      specks[i * 4] = (random() + random() - 1) * SHAFT.stripHalf;
      specks[i * 4 + 1] = random();
      specks[i * 4 + 2] = lerp(slit.from, slit.to, random());
      specks[i * 4 + 3] = random();
    }
    const quad = new InstancedBufferGeometry();
    quad.setAttribute('position', new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    quad.setAttribute('aSpeck', new InstancedBufferAttribute(specks, 4));
    quad.instanceCount = count;
    const dust = new Mesh(
      quad,
      new ShaderMaterial({
        vertexShader: DUST_VERT,
        fragmentShader: DUST_FRAG,
        uniforms: {
          ...fogUniforms(),
          ...warpUniforms,
          uColor: { value: light },
          uTime: this.time,
          uGain: { value: SHAFT.dust.gain },
          uShaft: this.shaftLevel,
        },
        fog: true,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    dust.frustumCulled = false;
    dust.renderOrder = 4;
    dust.name = 'HallDust';
    this.detail.add(dust);
  }

  /** The red behind the far wall: its light, the glow standing in the slit, and what leaks onto the wall around it. */
  private buildWayOut(kit: DreamKit): { glow: MeshBasicMaterial; halo: MeshBasicMaterial } {
    const { light, glow, halo } = RED;
    kit.lights.add(light.position, light.color, light.intensity, light.distance);
    const { slitHalf, slitHeight, thick } = ROOM.endWall;
    const additive = (rgb: V3, extra: Partial<MeshBasicMaterial>) =>
      new MeshBasicMaterial({ color: new Color(...rgb), transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false, ...extra });
    const glowMaterial = additive(glow, {});
    const glowMesh = new Mesh(new PlaneGeometry(slitHalf * 2, slitHeight), glowMaterial);
    glowMesh.position.set(0, slitHeight / 2, END_Z - thick * 0.7);
    glowMesh.renderOrder = 5;
    const haloMaterial = additive(halo, { map: haloMap() });
    const haloSize = slitHeight * 4.4;
    const haloMesh = new Mesh(new PlaneGeometry(haloSize, haloSize), haloMaterial);
    haloMesh.position.set(0, slitHeight * 0.55, END_Z + 0.04);
    haloMesh.renderOrder = 5;
    this.root.add(glowMesh, haloMesh);
    return { glow: glowMaterial, halo: haloMaterial };
  }

  // ------------------------------------------------------------------ the hair

  private buildHair(kit: DreamKit): void {
    const { strands, segments, locks } = HAIR;
    const random = randomFrom(0x5a1c);
    const lockAt = Array.from({ length: locks }, () => ({
      along: ((random() + random() + random()) / 1.5 - 1) * 1.05,
      depth: ((random() + random() + random()) / 1.5 - 1) * 1.05,
      phase: random(),
    }));
    const roots = new Float32Array(strands * 4);
    const feet = new Float32Array(strands * 4);
    for (let i = 0; i < strands; i++) {
      const lock = lockAt[Math.floor(random() * locks)];
      roots[i * 4] = lock.along + (random() + random() - 1) * 0.1;
      roots[i * 4 + 1] = (random() - 0.5) * 0.7;
      roots[i * 4 + 2] = lock.depth + (random() + random() - 1) * 0.17;
      roots[i * 4 + 3] = lock.phase + random() * 0.05;
      feet[i * 4] = random() * Math.PI * 2;
      feet[i * 4 + 1] = lerp(HAIR.spread[0], HAIR.spread[1], random() ** 2);
      feet[i * 4 + 2] = lerp(HAIR.width[0], HAIR.width[1], random() ** 1.6);
      feet[i * 4 + 3] = lerp(0.68, 1.16, random());
    }
    const positions: number[] = [];
    const indices: number[] = [];
    for (let s = 0; s <= segments; s++) positions.push(-1, s / segments, 0, 1, s / segments, 0);
    for (let s = 0; s < segments; s++) {
      const b = s * 2;
      indices.push(b, b + 1, b + 3, b, b + 3, b + 2);
    }
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.setAttribute('aRoot', new InstancedBufferAttribute(roots, 4));
    g.setAttribute('aFoot', new InstancedBufferAttribute(feet, 4));
    g.instanceCount = strands;
    const hair = new Mesh(
      g,
      new ShaderMaterial({
        vertexShader: HAIR_VERT,
        fragmentShader: HAIR_FRAG,
        uniforms: {
          ...UniformsUtils.clone(UniformsLib.fog),
          ...warpUniforms,
          uTime: this.time,
          uFlow: { value: HAIR.flow },
          uSway: { value: HAIR.sway * (REDUCED_MOTION ? 0.3 : 1) },
          uLamp: { value: new Vector3(...HAIR.lamp.position) },
          uLampPower: { value: HAIR.lamp.power },
          uColor: { value: new Color(...HAIR.color) },
        },
        fog: true,
        transparent: true,
        premultipliedAlpha: true,
        blending: NormalBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    hair.frustumCulled = false;
    hair.renderOrder = 2;
    hair.name = 'HallHair';
    this.detail.add(hair);
    kit.poi({ position: new Vector3(HAIR.fallX, HAIR.poi.y, HAIR.z), radius: HAIR.poi.radius, zoom: HAIR.poi.zoom, reach: HAIR.poi.reach });
  }

  // ------------------------------------------------------------------ the ward

  /** Twenty-four iron beds in strict rows; returns the wheelchair that crosses their aisle by itself. */
  private buildWard(kit: DreamKit): Object3D {
    const ward = new Group();
    this.detail.add(ward);
    const { rows, columns, plan, mattress, disorder, contact } = WARD;
    const random = randomFrom(0x2e7d);

    type Kind = 'w' | 't' | 'h' | 'e' | 'c';
    const places: Record<Kind, { x: number; z: number; heading: number; y: number }[]> = { w: [], t: [], h: [], e: [], c: [] };
    const upright: { x: number; z: number; heading: number }[] = [];
    const fallen: Matrix4[] = [];
    const contacts: { x: number; z: number; heading: number; size: number }[] = [];
    rows.forEach((z, r) => {
      columns.forEach((x, c) => {
        const kind = plan[r][c];
        const heading = Math.PI / 2 + (random() - 0.5) * disorder * 2;
        if (kind === 'o') {
          // over on its side or on its back, out of line; its sheet lies where it fell
          const pose = WARD.fallen[fallen.length % WARD.fallen.length];
          const h = heading + (random() - 0.5) * 0.7;
          m1.makeRotationY(h);
          m2.makeRotationFromEuler(e1.set(pose.tip, 0, pose.over, 'XYZ'));
          m3.makeTranslation(0, -0.6, 0);
          fallen.push(new Matrix4().makeTranslation(x + 0.15, pose.height, z + 0.1).multiply(m1).multiply(m2).multiply(m3));
          contacts.push({ x, z, heading: h, size: 1.15 });
          places.c.push({ x: x - 0.4, z: z + 1.05, heading: h + 0.4, y: -mattress });
          return;
        }
        upright.push({ x, z, heading });
        contacts.push({ x, z, heading, size: 1 });
        places[kind as Kind].push({ x, z, heading, y: 0 });
      });
    });

    // the iron
    const crowd = kit.props('bed_frame', upright.length, { castShadow: true });
    crowd.root.traverse((o) => {
      const mesh = o as InstancedMesh;
      if (mesh.isInstancedMesh) mesh.geometry = withoutTriangles(mesh.geometry, BED_SPRINGS);
    });
    upright.forEach((b, i) => crowd.set(i, b.x, 0, b.z, b.heading));
    crowd.commit();
    ward.add(crowd.root);

    const whole = kit.props('bed_frame', fallen.length, { castShadow: true });
    fallen.forEach((m, i) => whole.setMatrix(i, m));
    whole.commit();
    ward.add(whole.root);

    // the sheets
    const reliefs: Record<Kind, Relief> = { w: wholeBody, t: turnedBody, h: halfBody, e: noBody, c: crumpled };
    (Object.keys(places) as Kind[]).forEach((kind, k) => {
      const list = places[kind];
      const sheets = new InstancedMesh(sheetGeometry(reliefs[kind], k + 3, mattress), this.linen, list.length);
      const tone = new Color();
      list.forEach((p, i) => {
        m1.makeRotationY(p.heading);
        m1.setPosition(p.x, p.y, p.z);
        sheets.setMatrixAt(i, m1);
        sheets.setColorAt(i, tone.setScalar(lerp(0.72, 1, random())));
      });
      sheets.castShadow = true;
      sheets.receiveShadow = true;
      sheets.frustumCulled = false;
      ward.add(sheets);
    });

    // the dark each bed presses into the floor (nothing that low can cast a shadow here)
    const blobs = new InstancedMesh(
      new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: 0x000000, alphaMap: contactMap(), transparent: true, opacity: contact.dark, depthWrite: false }),
      contacts.length,
    );
    contacts.forEach((c, i) => {
      m1.compose(v1.set(c.x, 0.012, c.z), q1.setFromAxisAngle(AXIS_Y, c.heading), v2.set(contact.width * c.size, 1, contact.length * c.size));
      blobs.setMatrixAt(i, m1);
    });
    blobs.frustumCulled = false;
    blobs.renderOrder = 1;
    ward.add(blobs);

    // the fixtures, low on long cords: each its own glass, so that each fails by itself
    const cords = new Pour();
    const fixtures = new Map<BufferGeometry, BufferGeometry>();
    for (const l of WARD.lamps) {
      const fixture = kit.prop('caged_light', [l.x, WARD.lampHeight, l.z], { castShadow: false }, ward);
      const glass: MeshStandardMaterial[] = [];
      fixture.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        let coarse = fixtures.get(mesh.geometry);
        if (!coarse) fixtures.set(mesh.geometry, (coarse = coarser(mesh.geometry, WARD.lampCoarse)));
        mesh.geometry = coarse;
        const material = (mesh.material as MeshStandardMaterial).clone();
        material.emissive.setRGB(1, 1, 1);
        material.emissiveIntensity = l.intensity > 0 ? WARD.lampGlow : 0;
        mesh.material = material;
        glass.push(material);
      });
      for (const side of [-WARD.lampPlates, WARD.lampPlates]) {
        const x = l.x + side;
        const y0 = WARD.lampHeight + 0.74;
        const y1 = HEIGHT - ROOM.beam.deep + 0.05;
        cords.box(x - 0.006, x + 0.006, y0, y1, l.z - 0.006, l.z + 0.006, ['+x', '-x', '+z', '-z']);
      }
      const light = kit.lights.add([l.x, WARD.lampHeight - 0.14, l.z], WARD.lampColor, l.intensity, WARD.lampReach);
      if (l.intensity > 0) this.lamps.push({ light, glass, intensity: l.intensity, seed: l.seed });
    }
    ward.add(cords.mesh(new MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.7 })));

    // and it rolls
    return kit.prop('wheelchair', [WARD.chair.from, 0, WARD.chair.z], { rotation: [0, 90, 0] }, ward);
  }

  // ------------------------------------------------------------------ the ghosts

  /** Dresses nobody wears, each on a hook through one shoulder, on a chain from the beam above. */
  private buildDresses(kit: DreamKit): { dresses: PropCrowd; hooks: PropCrowd } {
    const group = new Group();
    this.detail.add(group);
    const dresses = kit.props('empty_dress', DRESSES.length, { castShadow: true });
    dresses.root.traverse((o) => {
      const mesh = o as InstancedMesh;
      if (mesh.isInstancedMesh) mesh.geometry = coarser(mesh.geometry, DRESS_RIG.coarse);
    });
    const hooks = kit.props('meat_hook', DRESSES.length, { scale: DRESS_RIG.hook });
    group.add(dresses.root, hooks.root);
    const random = randomFrom(0x70a1);
    const chains = new Pour();
    const { width, tile } = DRESS_RIG.chain;
    const top = HEIGHT + 0.05;
    for (const d of DRESSES) {
      const [x, y, z] = d.at;
      this.hanging.push({ x, y, z, rate: d.rate, turn: random() * Math.PI * 2, shoulder: d.shoulder, size: d.size });
      const y0 = y + DRESS_RIG.hook - 0.015;
      chains.rect([x - width / 2, y0, z], [width, 0, 0], [0, top - y0, 0]);
      chains.rect([x, y0, z - width / 2], [0, 0, width], [0, top - y0, 0]);
    }
    // the picture runs once across a card and repeats up it
    const g = chains.geometry();
    const p = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    let d = 0;
    for (let i = 0; i < p.count; i++) {
      // which chain: the cards were poured in order, and each stands at its dress's x and z
      while (Math.abs(p.getX(i) - DRESSES[d].at[0]) > width || Math.abs(p.getZ(i) - DRESSES[d].at[2]) > width) d++;
      const dx = p.getX(i) - DRESSES[d].at[0];
      const dz = p.getZ(i) - DRESSES[d].at[2];
      uv.setXY(i, (Math.abs(dx) > Math.abs(dz) ? dx : dz) / width + 0.5, p.getY(i) / tile);
    }
    const chainMesh = new Mesh(g, new MeshStandardMaterial({ map: chainMap(), alphaTest: 0.4, side: DoubleSide, metalness: 0.55, roughness: 0.62, color: 0x77726a }));
    chainMesh.frustumCulled = false;
    group.add(chainMesh);
    return { dresses, hooks };
  }

  private hangDresses(): void {
    const at = DRESS_RIG.shoulder;
    for (let i = 0; i < this.hanging.length; i++) {
      const h = this.hanging[i];
      q1.setFromAxisAngle(AXIS_Y, h.turn);
      m1.compose(v1.set(h.x, h.y, h.z), q1, UNIT);
      this.hooks.setMatrix(i, m1);
      // from the hook: turned, leaning off the one shoulder, the shoulder brought to the hook, and sized
      q2.setFromAxisAngle(AXIS_X, -h.shoulder * DRESS_RIG.lean);
      m2.makeRotationFromQuaternion(q2);
      m3.makeScale(h.size, h.size, h.size);
      m3.setPosition(-at[0] * h.size, -at[1] * h.size, -at[2] * h.size * h.shoulder);
      this.dresses.setMatrix(i, m1.multiply(m2).multiply(m3));
    }
    this.hooks.commit();
    this.dresses.commit();
  }

  // ------------------------------------------------------------------ what forgot gravity

  private buildFloats(kit: DreamKit): { beds: PropCrowd; sheets: InstancedMesh } {
    const group = new Group();
    this.detail.add(group);
    const beds = kit.props('bed_frame', FLOATS.beds.length, { castShadow: true });
    beds.root.traverse((o) => {
      const mesh = o as InstancedMesh;
      if (mesh.isInstancedMesh) mesh.geometry = withoutTriangles(mesh.geometry, BED_SPRINGS);
    });
    // the linen came too: it gives each a body up there, and a shadow down here
    const sheets = new InstancedMesh(sheetGeometry(noBody, 11, WARD.mattress), this.linen, FLOATS.beds.length);
    sheets.castShadow = true;
    sheets.receiveShadow = true;
    sheets.frustumCulled = false;
    group.add(beds.root, sheets);
    const crutches = kit.prop('crutches', FLOATS.crutches.at, { castShadow: true, anchor: 'center' }, group);
    const chair = kit.prop('wheelchair', FLOATS.chair.at, { castShadow: true, anchor: 'center' }, group);
    this.floaters.push({ object: crutches, at: FLOATS.crutches.at, turn: FLOATS.crutches.turn, seed: 3.1 }, { object: chair, at: FLOATS.chair.at, turn: FLOATS.chair.turn, seed: 5.3 });
    return { beds, sheets };
  }

  private driftFloats(): void {
    const t = (this.clock / FLOATS.period) * Math.PI * 2;
    const a = FLOATS.drift;
    const w = FLOATS.sway;
    for (let i = 0; i < FLOATS.beds.length; i++) {
      const b = FLOATS.beds[i];
      const s = i * 2.1 + 0.7;
      e1.set((b.turn[0] + w * Math.sin(t * 0.7 + s)) * DEG, (b.turn[1] + w * Math.sin(t * 0.5 + s * 2)) * DEG, (b.turn[2] + w * Math.cos(t * 0.6 + s)) * DEG, 'YXZ');
      q1.setFromEuler(e1);
      m1.makeRotationFromQuaternion(q1);
      m1.setPosition(b.at[0] + a * Math.sin(t + s), b.at[1] + a * Math.cos(t * 0.8 + s), b.at[2] + a * Math.sin(t * 0.6 + s * 3));
      // about its middle
      m2.makeTranslation(0, -0.6, 0);
      m1.multiply(m2);
      this.floatBeds.setMatrix(i, m1);
      this.floatSheets.setMatrixAt(i, m1);
    }
    this.floatBeds.commit();
    this.floatSheets.instanceMatrix.needsUpdate = true;
    for (const f of this.floaters) {
      f.object.position.set(f.at[0] + a * Math.sin(t + f.seed), f.at[1] + a * Math.cos(t * 0.8 + f.seed), f.at[2] + a * Math.sin(t * 0.6 + f.seed * 3));
      f.object.rotation.set((f.turn[0] + w * Math.sin(t * 0.7 + f.seed)) * DEG, (f.turn[1] + w * Math.sin(t * 0.5 + f.seed)) * DEG, (f.turn[2] + w * Math.cos(t * 0.6 + f.seed)) * DEG, 'YXZ');
    }
  }

  // ------------------------------------------------------------------ the head

  private buildHead(kit: DreamKit, panels: CanvasTexture): void {
    const { at, scale, pivot, cut, post } = HEAD;
    const head = kit.prop('giant_head', [0, 0, 0], { scale });
    head.position.y = -pivot * scale;
    const plaster = stone(new MeshStandardMaterial({ color: HEAD.color, roughness: 0.82, side: DoubleSide }), scale * 0.5, HEAD.crevice, HEAD.rough, { all: 1, shaft: HEAD.shaftShare }, this.headLit);
    kit.paint(head, plaster);
    head.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const g = withoutTriangles(mesh.geometry, (x, y, z, flat) => y < cut || (y < post.y && Math.abs(x) < post.x && z > post.z[0] && z < post.z[1] && flat < post.upright));
      g.setAttribute('aCavity', new Float32BufferAttribute(cavityOf(mesh.geometry), 1));
      mesh.geometry = g;
      mesh.castShadow = false;
    });
    this.headNodGroup.add(head);
    this.headYawGroup.add(this.headNodGroup);
    this.headYawGroup.position.set(at[0], at[1], at[2]);
    this.headYawGroup.name = 'TheHead';
    this.detail.add(this.headYawGroup);
    kit.poi({ position: new Vector3(...HEAD.poi.position), radius: HEAD.poi.radius, zoom: HEAD.poi.zoom, reach: HEAD.poi.reach });

    // the floor it came up through, lifted and thrown back
    const slabs = new Pour();
    const random = randomFrom(0x51ab5);
    const rebarAt: Matrix4[] = [];
    const { count, ring, width, length, thick, tilt, clearX, clearZ } = SLABS;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (random() - 0.5) * 0.3;
      const r = lerp(ring[0], ring[1], random());
      const w = lerp(width[0], width[1], random());
      const d = lerp(length[0], length[1], random());
      const lift = lerp(tilt[0], tilt[1], random());
      const turn = a + (random() - 0.5) * 0.4;
      const roll = (random() - 0.5) * 0.22;
      const reach = Math.hypot(w, d) / 2;
      const cx = at[0] + Math.sin(a) * r;
      const cz = at[2] + Math.cos(a) * r;
      // none on the side of the path, inside the walls, or out among what stands before it
      if (cx - reach < clearX || cx > HALF - 1.5 || cz + reach > clearZ) continue;
      // its outer edge under the floor, its inner edge heaved up against the head
      const y = (d / 2) * Math.sin(lift) - 0.18;
      m1.makeRotationY(turn);
      m2.makeRotationX(lift);
      m3.makeRotationZ(roll);
      const m = new Matrix4().makeTranslation(cx, y, cz).multiply(m1).multiply(m2).multiply(m3);
      slabs.box(-w / 2, w / 2, -thick / 2, thick / 2, -d / 2, d / 2, ['+y', '-y', '+x', '-x', '+z', '-z'], m);
      for (let k = 0; k < REBAR.perSlab; k++) {
        rebarAt.push(new Matrix4().copy(m).multiply(new Matrix4().makeTranslation(lerp(-w / 2, w / 2, 0.1 + random() * 0.8), 0.08, -d / 2 + 0.05)));
      }
    }
    this.detail.add(slabs.mesh(this.pourMaterial(kit.surface('conc_cracked', POUR.tile.cracked, { roughness: 0.95, color: new Color(SLABS.tint) }), panels)));
    this.buildRebar(kit, rebarAt);
  }

  private buildRebar(kit: DreamKit, onSlabs: readonly Matrix4[]): void {
    const random = randomFrom(0x4eba4);
    const rod = new TubeGeometry(
      new CatmullRomCurve3([new Vector3(0, -0.2, 0), new Vector3(0, 0.3, 0), new Vector3(0.008, 0.68, 0.004), new Vector3(0.022, 0.9, 0.012), new Vector3(0.07, 1, 0.03)]),
      7,
      REBAR.radius,
      5,
      false,
    );
    let total = onSlabs.length;
    for (const row of REBAR.rows) total += row.count;
    const rods = new InstancedMesh(rod, kit.surface('rust_streaked', REBAR.tile), total);
    let n = 0;
    const put = (base: Matrix4) => {
      const h = lerp(REBAR.height[0], REBAR.height[1], random());
      q1.setFromEuler(e1.set((random() - 0.5) * 0.3, random() * Math.PI * 2, (random() - 0.5) * 0.3, 'YXZ'));
      m1.compose(v1.set(0, 0, 0), q1, v2.set(1, h, 1));
      rods.setMatrixAt(n++, m2.multiplyMatrices(base, m1));
    };
    for (const m of onSlabs) put(m);
    for (const row of REBAR.rows) {
      for (let i = 0; i < row.count; i++) {
        m3.makeTranslation(row.x + (random() - 0.5) * 0.05, 0, row.z - i * row.step);
        put(m3);
      }
    }
    rods.frustumCulled = false;
    rods.receiveShadow = true;
    this.detail.add(rods);
  }

  /** One turn toward the eye, as far as it needs: only ever called while it cannot be seen. */
  private turnHead(eye: Vector3): void {
    const viewer = Math.atan2(eye.x - HEAD.at[0], eye.z - HEAD.at[2]);
    const wanted = viewer + HEAD.face * DEG;
    this.headYaw += clamp(wrapAngle(wanted - this.headYaw), -HEAD.step * DEG, HEAD.step * DEG);
    this.poseHead(Math.abs(wrapAngle(wanted - this.headYaw)), viewer);
  }

  /** It screams at the sky; the nearer it comes to meeting your eye, the more it lowers its own. */
  private poseHead(off: number, viewer: number): void {
    this.headYawGroup.rotation.y = this.headYaw;
    this.headNodGroup.rotation.x = lerp(HEAD.nod[1], HEAD.nod[0], smootherstep(off / (90 * DEG))) * DEG;
    const { ahead, aside, rise, away } = HEAD.lamp;
    const [x, y, z] = HEAD.at;
    if (off > 100 * DEG) {
      const a = viewer - away[0] * DEG;
      this.headLamp.position = [x + Math.sin(a) * away[1], y + rise, z + Math.cos(a) * away[1]];
      this.headLampPower = HEAD.lamp.intensity * away[2];
    } else {
      const fx = Math.sin(this.headYaw);
      const fz = Math.cos(this.headYaw);
      this.headLamp.position = [x + fx * ahead + fz * aside, y + rise, z + fz * ahead - fx * aside];
      this.headLampPower = HEAD.lamp.intensity;
    }
  }

  private updateHead(f: DreamFrame, dt: number): void {
    // the light fails at its places on the walk: in the dark it moves
    for (const at of HEAD.failures) {
      if (this.lastWalk < at.at && f.walk >= at.at) this.failure = { shaft: at.shaft, steps: at.steps, clock: 0, turned: false };
    }
    let lamp = 1;
    let sky = 1;
    const fail = this.failure;
    if (fail) {
      fail.clock += dt;
      const times = fail.shaft ? HEAD.shaftFailure : LAMP_FAILURE;
      const fall = times[0];
      const hold = times[1];
      const rise = times[2];
      const t = fail.clock;
      const level = t < fall ? 1 - smootherstep(t / fall) : t < fall + hold ? 0 : smootherstep((t - fall - hold) / rise);
      lamp = level;
      if (fail.shaft) sky = level;
      if (!fail.turned && t >= fall) {
        fail.turned = true;
        for (let s = 0; s < fail.steps; s++) this.turnHead(f.eye);
      }
      if (t >= fall + hold + rise) this.failure = null;
    }
    this.headLamp.intensity = this.headLampPower * lamp;
    this.headLit.value = lamp;
    this.shaft.intensity = SHAFT.intensity * sky;
    this.shaftLevel.value = sky;
    this.skyMaterial.color.copy(this.skyColor).multiplyScalar(sky);

    // and whenever it simply is not seen
    const distance = this.headAt.distanceTo(f.eye);
    const margin = Math.asin(Math.min(1, HEAD.radius / Math.max(distance, 0.1))) / DEG + 3;
    if (!fail && this.clock >= this.headNext && f.unseen(this.headAt, margin)) {
      const wanted = Math.atan2(f.eye.x - HEAD.at[0], f.eye.z - HEAD.at[2]) + HEAD.face * DEG;
      if (Math.abs(wrapAngle(wanted - this.headYaw)) > 2 * DEG) {
        this.turnHead(f.eye);
        this.headNext = this.clock + HEAD.every;
      }
    }
  }

  // ------------------------------------------------------------------ the two nobody is sure of

  private buildColossi(kit: DreamKit): void {
    const { at, scale, light } = ANGEL;
    const angel = kit.prop('angel', at, { scale }, this.detail);
    const rock = stone(new MeshStandardMaterial({ color: ANGEL.color, roughness: 0.92 }), scale * 0.5, ANGEL.crevice, ANGEL.rough, { all: 0, shaft: 0 }, { value: 1 });
    kit.paint(angel, rock);
    angel.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const g = new BufferGeometry();
      for (const name of Object.keys(mesh.geometry.attributes)) g.setAttribute(name, mesh.geometry.getAttribute(name));
      g.setIndex(mesh.geometry.getIndex());
      g.setAttribute('aCavity', new Float32BufferAttribute(cavityOf(mesh.geometry), 1));
      mesh.geometry = g;
    });
    kit.lights.add(light.position, light.color, light.intensity, light.distance);

    const demon = kit.prop('winged_monster', DEMON.at, { scale: DEMON.scale, rotation: [0, 90, 0] }, this.detail);
    demon.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) mesh.geometry = coarser(mesh.geometry, DEMON.coarse);
    });
    kit.lights.add(DEMON.light.position, DEMON.light.color, DEMON.light.intensity, DEMON.light.distance);
  }

  // ------------------------------------------------------------------ per frame

  update(f: DreamFrame): void {
    this.detail.visible = f.eye.z < ROOM.drawFrom && f.eye.z > ROOM.drawTo;
    if (f.paused) return;
    const dt = f.dt;
    this.clock += dt;
    this.time.value = this.clock * (REDUCED_MOTION ? 0.4 : 1);

    this.updateHead(f, dt);
    this.lastWalk = f.walk;

    // the way out stands in the dark as a red slit, until it is too near to be a picture
    const fade = range(RED.fade[0], RED.fade[1], f.eye.z);
    this.redGlow.opacity = fade;
    this.redHalo.opacity = fade;

    if (!this.detail.visible) return;

    for (const h of this.hanging) h.turn += h.rate * dt;
    this.hangDresses();
    this.driftFloats();
    this.flickerLamps();
    this.rollChair(f, dt);
  }

  /** Lamps hold, then falter: rarely, each by itself, slower than anything that could hurt. */
  private flickerLamps(): void {
    const { from, to, rate, stutter } = WARD.falter;
    for (const l of this.lamps) {
      const gust = wobble(this.clock * rate, l.seed);
      let level = 1;
      if (gust > from) {
        const depth = smootherstep(range(from, to, gust));
        const beat = REDUCED_MOTION ? 0.5 : 0.5 + 0.5 * Math.sin(this.clock * stutter + l.seed * 3);
        level = 1 - depth * (0.45 + 0.55 * beat);
      }
      l.light.intensity = l.intensity * level;
      for (const m of l.glass) m.emissiveIntensity = WARD.lampGlow * level;
    }
  }

  /** It crosses the aisle as the viewer passes; a long look stops it; it goes on when the look goes. */
  private rollChair(f: DreamFrame, dt: number): void {
    const { chair } = WARD;
    const goal = lerp(chair.from, chair.to, range(chair.walk[0], chair.walk[1], f.walk));
    v1.set(this.chairX, 0.6, chair.z);
    const halfView = Math.atan(Math.tan((f.view.fov / 2) * DEG) * f.view.aspect) / DEG;
    // well inside the view: within `gaze` degrees of where the eye points
    const lookedAt = !f.unseen(v1, chair.gaze - Math.max(halfView, f.view.fov / 2));
    this.chairGaze = lookedAt ? this.chairGaze + dt : 0;
    const go = this.chairGaze < chair.patience && goal > this.chairX + 0.01;
    this.chairSpeed = damp(this.chairSpeed, go ? chair.speed : 0, 1.6, dt);
    this.chairX = Math.min(chair.to, this.chairX + this.chairSpeed * dt);
    this.chair.position.x = this.chairX;
    this.chair.rotation.y = wobble(this.chairX * 0.7, 3) * 0.05;
  }

  reset(): void {
    this.clock = 0;
    this.time.value = 0;
    this.lastWalk = 0;
    this.failure = null;
    this.headNext = 0;
    this.headYaw = HEAD.yaw * DEG;
    this.poseHead(Math.PI, HEAD.startViewer * DEG);
    this.headLit.value = 1;
    this.shaftLevel.value = 1;
    this.shaft.intensity = SHAFT.intensity;
    this.headLamp.intensity = this.headLampPower;
    this.skyMaterial.color.copy(this.skyColor);
    this.chairX = WARD.chair.from;
    this.chairSpeed = 0;
    this.chairGaze = 0;
    this.chair.position.x = this.chairX;
    this.hangDresses();
    this.driftFloats();
  }
}
