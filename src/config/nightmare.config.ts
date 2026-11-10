/**
 * The nightmare's shared map: the spaces the walk goes through (walk frame, see walk.config.ts), the
 * air and light of each, how curved space is along the way and how afraid the piece is.
 * Each set piece keeps its own details in its own module; what several of them must agree on is here.
 */
import type { GradeParams } from '../experience/render/Grade';

type V3 = readonly [number, number, number];

/** The spaces, in the walk frame (z decreases along the walk). */
export const LAYOUT = {
  /** The alley goes on where the cross street was; same width. */
  street: { from: -36, to: -64, halfWidth: 1.9 },
  /** A colossal raw-concrete hall, entered and left through slits. */
  hall: { from: -64, to: -124, halfWidth: 17, height: 26, slit: { halfWidth: 1.5, height: 5 } },
  /** A low corridor in safelight red. */
  darkroom: { from: -124, to: -150, halfWidth: 2.6, height: 3.8 },
  /** A tunnel of meat (tube radius; its center is `centerY` above the floor line). */
  flesh: { from: -150, to: -186, radius: 3.1, centerY: 1.8 },
  /** Black nothing and shallow black water; the giant print hangs in it at walkConfig.printZ. */
  void: { from: -186, to: -226, halfWidth: 16, height: 30 },
} as const;

/** A spotlight of a space. Mutable on purpose: a set piece may flicker its own (`intensity`). */
export interface SpotSpec {
  position: V3;
  target: V3;
  color: number;
  intensity: number;
  /** Half angle (deg). */
  angle: number;
  penumbra: number;
}

export interface RegionLook {
  name: RegionName;
  /** Walk-frame z at which this space takes over (going down the walk). */
  from: number;
  fog: { color: number; density: number };
  /** Which image lights reflections, and how strongly. */
  env: 'evening' | 'fire' | 'bathroom';
  envIntensity: number;
  /** Brightness of the sky dome (0 = none seen, e.g. nothing above the void). */
  sky: number;
  /** How the light of this space is graded. */
  grade: GradeParams;
}

export type RegionName = 'alley' | 'street' | 'hall' | 'darkroom' | 'flesh' | 'void' | 'sea' | 'room';

/** Looks blend over this many meters around every border, so no threshold can be seen. */
export const REGION_BLEND = 3;
/** A set piece is drawn while the camera is within this distance (m, along z) of its span. */
export const REGION_MARGIN = 45;

export const REGIONS: readonly RegionLook[] = [
  {
    name: 'alley',
    from: Infinity,
    fog: { color: 0x3b3a44, density: 0.021 },
    env: 'evening',
    envIntensity: 0.34,
    sky: 1,
    grade: { exposure: 1.02, saturation: 0.78, warmth: -0.01, tint: 0, flare: 0.003 },
  },
  {
    name: 'street',
    from: LAYOUT.street.from,
    fog: { color: 0x1d1412, density: 0.026 },
    env: 'fire',
    envIntensity: 0.13,
    sky: 0.85,
    grade: { exposure: 1.06, saturation: 0.74, warmth: 0.04, tint: 0.01, flare: 0.004 },
  },
  {
    name: 'hall',
    from: LAYOUT.hall.from,
    fog: { color: 0x101217, density: 0.021 },
    env: 'bathroom',
    envIntensity: 0.06,
    sky: 1.6,
    grade: { exposure: 1.12, saturation: 0.7, warmth: -0.06, tint: -0.01, flare: 0.003 },
  },
  {
    name: 'darkroom',
    from: LAYOUT.darkroom.from,
    fog: { color: 0x240403, density: 0.046 },
    env: 'bathroom',
    envIntensity: 0.06,
    sky: 0,
    grade: { exposure: 1.1, saturation: 1.08, warmth: 0.08, tint: 0.01, flare: 0.0015 },
  },
  {
    name: 'flesh',
    from: LAYOUT.flesh.from,
    fog: { color: 0x1a0305, density: 0.062 },
    env: 'bathroom',
    envIntensity: 0.11,
    sky: 0,
    grade: { exposure: 1.08, saturation: 0.95, warmth: 0.05, tint: 0.03, flare: 0.002 },
  },
  {
    name: 'void',
    from: LAYOUT.void.from,
    fog: { color: 0x030304, density: 0.027 },
    env: 'bathroom',
    envIntensity: 0.02,
    sky: 0,
    // everything here is black and cold: the only color is the picture's, and it must burn
    grade: { exposure: 1.06, saturation: 0.82, warmth: 0, tint: 0, flare: 0.0008 },
  },
  {
    name: 'sea',
    from: -222,
    fog: { color: 0x1d0c08, density: 0.0065 },
    env: 'fire',
    envIntensity: 0.13,
    sky: 1,
    grade: { exposure: 1.02, saturation: 1.05, warmth: 0.03, tint: 0, flare: 0.0015 },
  },
];

/** One key of curved space along the walk (see render/Warp.ts). */
export interface WarpKey {
  /** Fraction of the walk. */
  at: number;
  /** The way ahead curls up (+) or falls away (-): meters at 1 m / m². */
  bendUp: number;
  /** It drifts sideways: same unit. */
  bendAside: number;
  /** It screws around the line of sight (rad / m). */
  twist: number;
  /** It breathes in a slow wave (m). */
  wave: number;
}

/**
 * Space is straight until the walk has begun (the entry into the photograph is exact), and straight
 * again around the giant print (its window and its passage are exact).
 */
export const warpConfig = {
  keys: [
    { at: 0.0, bendUp: 0, bendAside: 0, twist: 0, wave: 0 },
    { at: 0.03, bendUp: 0, bendAside: 0, twist: 0, wave: 0 },
    { at: 0.09, bendUp: 0.0016, bendAside: 0, twist: 0, wave: 0.03 },
    { at: 0.19, bendUp: 0.0034, bendAside: -0.0008, twist: 0.002, wave: 0.05 },
    { at: 0.26, bendUp: 0.0046, bendAside: 0.0012, twist: 0.008, wave: 0.07 },
    { at: 0.325, bendUp: 0.0022, bendAside: 0, twist: 0.012, wave: 0.03 },
    // the hall is rigid and enormous: at first; then it breathes once
    { at: 0.36, bendUp: 0, bendAside: 0, twist: 0, wave: 0 },
    { at: 0.43, bendUp: -0.0006, bendAside: 0, twist: 0, wave: 0.02 },
    { at: 0.47, bendUp: -0.0012, bendAside: 0.0006, twist: 0.001, wave: 0.16 },
    { at: 0.515, bendUp: 0, bendAside: 0, twist: 0, wave: 0 },
    // the corridor bends away so that its end can never be seen
    { at: 0.56, bendUp: 0.002, bendAside: 0.006, twist: 0.006, wave: 0.02 },
    { at: 0.62, bendUp: -0.002, bendAside: -0.006, twist: 0.01, wave: 0.03 },
    // the gullet
    { at: 0.69, bendUp: 0.006, bendAside: 0.004, twist: 0.03, wave: 0.2 },
    { at: 0.735, bendUp: 0, bendAside: 0, twist: 0.012, wave: 0.08 },
    // nothing moves in the void
    { at: 0.775, bendUp: 0, bendAside: 0, twist: 0, wave: 0 },
    { at: 0.905, bendUp: 0, bendAside: 0, twist: 0, wave: 0 },
    // the sea curls up around you like a bowl
    { at: 0.95, bendUp: 0.0013, bendAside: 0, twist: 0, wave: 0.02 },
    { at: 1, bendUp: 0.0019, bendAside: 0, twist: 0, wave: 0.03 },
  ] satisfies readonly WarpKey[],
  /** Wave length (rad / m along the view) and speed (rad / s). */
  wave: { frequency: 0.42, speed: 0.9 },
  /** Share of all this for visitors who ask for less motion. */
  reducedMotion: 0.25,
} as const;

/** How afraid the piece is along the walk (0..1); everything that trembles reads this. */
export const fearConfig = {
  keys: [
    [0, 0.08],
    [0.1, 0.2],
    [0.27, 0.42],
    [0.34, 0.3],
    [0.49, 0.62],
    [0.6, 0.72],
    [0.7, 0.88],
    [0.74, 0.96],
    [0.8, 0.45],
    [0.89, 0.65],
    [0.95, 0.9],
    [1, 1],
  ] as readonly (readonly [number, number])[],
  /** Before the walk: it creeps up over the prologue to this. */
  prologue: 0.08,
  /** The heart: beats per second at no fear and at full fear, and how fast each beat dies (1/s). */
  heart: { calm: 0.85, panic: 2.3, decay: 6 },
} as const;

/** The dream's fixed set of moving lights: the nearest few of everything that shines. */
export const lightPoolConfig = {
  size: 6,
} as const;
