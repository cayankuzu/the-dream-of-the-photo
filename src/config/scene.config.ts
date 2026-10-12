import type { FacadeSpec, Facing } from '../experience/world/FacadeBuilder';

/** The designed instant camera (meters): body, lens, film slot. */
export const cameraObjectConfig = {
  body: { width: 0.128, height: 0.118, depth: 0.062, radius: 0.011 },
  lens: { radius: 0.024, length: 0.024, offset: { x: 0, y: -0.012 } },
  slot: { width: 0.094, depth: 0.004, z: 0.012, insideDepth: 0.0555 },
  /** How far the print travels out of the slot (m). */
  ejectDistance: 0.096,
  colors: { body: 0x2a2b2e, leather: 0x19191a, metal: 0xb9b6ae },
} as const;

/**
 * Physical layout of the alley (meters). The alley runs along -Z; the photographer stands at the origin
 * looking down it. +X is the photographer's right.
 */
export const ALLEY = {
  halfWidth: 1.9,
  /** Alley floor extent along Z. */
  back: 15,
  front: -36,
  /** The cross street at the far end. */
  crossStreet: { near: -36, far: -45, halfLength: 24 },
  /** The street behind the viewer (alley mouth). */
  mouth: { near: 15, far: 23, halfLength: 18 },
} as const;

const APT_INSERTS = {
  wall_window_centered_small_01: ['window_centered_small_01'],
  wall_window_centered_small_02: ['window_centered_small_02'],
  wall_window_centered_large_01: ['window_centered_large_01'],
  wall_window_centered_large_02: ['window_centered_large_02'],
  wall_window_centered_double_01: ['window_centered_double_01'],
  wall_window_centered_double_02: ['window_centered_double_02'],
  wall_window_offset_small_01: ['window_offset_small_01'],
  wall_window_offset_small_03: ['window_offset_small_03'],
  wall_door_centered_small_01: ['door_centered_small_01'],
  wall_door_centered_small_02: ['door_centered_small_02'],
  wall_door_centered_large_01: ['door_centered_large_01'],
} as const;

const FACTORY_INSERTS = {
  wall_window_tall_small_01: ['window_tall_small_01'],
  wall_window_tall_small_02: ['window_tall_small_02'],
  wall_window_tall_large_01: ['window_tall_large_01'],
  wall_window_tall_large_02: ['window_tall_large_02'],
  wall_window_centered_medium_01: ['window_centered_medium_01'],
  wall_window_centered_medium_02: ['window_centered_medium_02'],
  wall_window_centered_small_01: ['window_centered_small_01'],
  wall_window_centered_small_02: ['window_centered_small_02'],
  wall_door_recessed_large_01: ['door_recessed_large_01'],
  wall_door_centered_large_01: ['door_centered_large_01'],
  wall_door_garage_door_01: ['door_garage_door_01'],
} as const;

/** An apartment-kit facade with its trims and window/door inserts. */
export const apt = (spec: Omit<FacadeSpec, 'kit' | 'band' | 'crown' | 'inserts'>): FacadeSpec => ({
  kit: 'apartments',
  band: 'cornice_standard_standard_01',
  bandOffset: -0.1,
  crown: 'crown_standard_standard_01',
  inserts: APT_INSERTS,
  ...spec,
});

/** A factory-kit facade with its trims and window/door inserts. */
export const factory = (spec: Omit<FacadeSpec, 'kit' | 'band' | 'crown' | 'inserts'>): FacadeSpec => ({
  kit: 'factory',
  band: 'cornice01_standard_standard_01',
  bandOffset: -0.08,
  crown: 'crown_standard_standard_01',
  inserts: FACTORY_INSERTS,
  ...spec,
});

const W = 'wall_standard_standard_01';
const H = ALLEY.halfWidth;

/** Every facade of the street. Columns are 3 m; floors are 3 m. */
export const FACADES: FacadeSpec[] = [
  // ---- left side (faces +X), from the alley mouth inward
  apt({
    facing: 'east',
    start: [-H, 15],
    run: [0, -1],
    floors: [
      [W, 'wall_door_centered_small_02', W, 'wall_window_offset_small_01', W, 'wall_door_centered_small_01', W],
      ['wall_window_centered_small_01', 'wall_window_centered_large_01', 'wall_window_centered_small_01', W, 'wall_window_centered_small_01', 'wall_window_centered_large_01', 'wall_window_centered_small_01'],
      ['wall_window_centered_small_02', 'wall_window_centered_large_02', 'wall_window_centered_small_02', W, 'wall_window_centered_small_02', 'wall_window_centered_large_02', 'wall_window_centered_small_02'],
      ['wall_window_centered_small_02', 'wall_window_centered_large_02', 'wall_window_centered_small_02', W, 'wall_window_centered_small_02', 'wall_window_centered_large_02', 'wall_window_centered_small_02'],
    ],
  }),
  factory({
    facing: 'east',
    start: [-H, -6],
    run: [0, -1],
    floors: [
      [W, 'wall_window_centered_small_01', 'wall_door_garage_door_01', 'wall_window_centered_small_01', W],
      ['wall_window_tall_small_01', 'wall_window_tall_large_01', 'wall_window_tall_large_01', 'wall_window_tall_large_01', 'wall_window_tall_small_01', 'wall_window_tall_small_01'],
      ['wall_window_tall_small_02', 'wall_window_tall_large_02', 'wall_window_tall_large_02', 'wall_window_tall_large_02', 'wall_window_tall_small_02', 'wall_window_tall_small_02'],
      ['wall_window_centered_medium_02', 'wall_window_centered_medium_02', W, 'wall_window_centered_medium_02', 'wall_window_centered_medium_02', W],
    ],
  }),
  apt({
    facing: 'east',
    start: [-H, -24],
    run: [0, -1],
    floors: [
      [W, 'wall_door_centered_large_01', W, 'wall_window_offset_small_01'],
      ['wall_window_centered_double_01', 'wall_window_centered_small_01', 'wall_window_centered_double_01', 'wall_window_centered_small_01'],
      ['wall_window_centered_double_02', 'wall_window_centered_small_02', 'wall_window_centered_double_02', 'wall_window_centered_small_02'],
      ['wall_window_centered_double_02', 'wall_window_centered_small_02', 'wall_window_centered_double_02', 'wall_window_centered_small_02'],
      ['wall_window_centered_double_02', 'wall_window_centered_small_02', 'wall_window_centered_double_02', 'wall_window_centered_small_02'],
    ],
  }),

  // ---- right side (faces -X)
  factory({
    facing: 'west',
    start: [H, 15],
    run: [0, -1],
    floors: [
      [W, 'wall_window_centered_small_01', W, 'wall_door_recessed_large_01', W, 'wall_window_centered_small_01'],
      ['wall_window_centered_medium_01', 'wall_window_centered_medium_01', 'wall_window_centered_medium_01', W, 'wall_window_centered_medium_01', 'wall_window_centered_medium_01'],
      ['wall_window_centered_medium_02', 'wall_window_centered_medium_02', 'wall_window_centered_medium_02', W, 'wall_window_centered_medium_02', 'wall_window_centered_medium_02'],
      ['wall_window_centered_small_02', 'wall_window_centered_small_02', 'wall_window_centered_small_02', W, 'wall_window_centered_small_02', 'wall_window_centered_small_02'],
    ],
  }),
  apt({
    facing: 'west',
    start: [H, -3],
    run: [0, -1],
    floors: [
      [W, 'wall_door_centered_small_01', 'wall_window_offset_small_03', W, W],
      ['wall_window_centered_small_01', 'wall_window_centered_large_01', 'wall_window_centered_small_01', 'wall_window_centered_double_01', W],
      ['wall_window_centered_small_02', 'wall_window_centered_large_02', 'wall_window_centered_small_02', 'wall_window_centered_double_02', W],
    ],
  }),
  factory({
    facing: 'west',
    start: [H, -18],
    run: [0, -1],
    floors: [
      [W, 'wall_window_centered_small_01', W, 'wall_door_centered_large_01', 'wall_window_centered_small_01', W],
      ['wall_window_tall_small_01', 'wall_window_tall_small_01', 'wall_window_tall_large_01', 'wall_window_tall_large_01', 'wall_window_tall_small_01', 'wall_window_tall_small_01'],
      ['wall_window_tall_small_02', 'wall_window_tall_small_02', 'wall_window_tall_large_02', 'wall_window_tall_large_02', 'wall_window_tall_small_02', 'wall_window_tall_small_02'],
      ['wall_window_centered_medium_02', W, 'wall_window_centered_medium_02', 'wall_window_centered_medium_02', W, 'wall_window_centered_medium_02'],
    ],
  }),

  // ---- across the cross street, facing back up the alley (south = +Z)
  apt({
    region: 'far',
    facing: 'south',
    start: [-10.5, ALLEY.crossStreet.far],
    run: [1, 0],
    floors: [
      ['wall_window_offset_small_01', W, 'wall_door_centered_large_01', W, 'wall_window_centered_small_01', W, 'wall_window_offset_small_01'],
      ['wall_window_centered_small_01', 'wall_window_centered_large_01', 'wall_window_centered_small_01', 'wall_window_centered_double_01', 'wall_window_centered_small_01', 'wall_window_centered_large_01', 'wall_window_centered_small_01'],
      ['wall_window_centered_small_02', 'wall_window_centered_large_02', 'wall_window_centered_small_02', 'wall_window_centered_double_02', 'wall_window_centered_small_02', 'wall_window_centered_large_02', 'wall_window_centered_small_02'],
      ['wall_window_centered_small_02', 'wall_window_centered_large_02', 'wall_window_centered_small_02', 'wall_window_centered_double_02', 'wall_window_centered_small_02', 'wall_window_centered_large_02', 'wall_window_centered_small_02'],
      ['wall_window_centered_small_02', 'wall_window_centered_large_02', 'wall_window_centered_small_02', 'wall_window_centered_double_02', 'wall_window_centered_small_02', 'wall_window_centered_large_02', 'wall_window_centered_small_02'],
    ],
  }),
  // ---- corners of the alley onto the cross street (facing the cross street, north = -Z)
  apt({
    region: 'far',
    facing: 'north',
    start: [-H, ALLEY.crossStreet.near],
    run: [-1, 0],
    floors: [[W, 'wall_window_offset_small_01', W], ['wall_window_centered_small_01', W, 'wall_window_centered_small_01'], ['wall_window_centered_small_02', W, 'wall_window_centered_small_02'], ['wall_window_centered_small_02', W, 'wall_window_centered_small_02'], ['wall_window_centered_small_02', W, 'wall_window_centered_small_02']],
  }),
  factory({
    region: 'far',
    facing: 'north',
    start: [H + 9, ALLEY.crossStreet.near],
    run: [-1, 0],
    floors: [[W, 'wall_window_centered_small_01', W], ['wall_window_centered_medium_01', W, 'wall_window_centered_medium_01'], ['wall_window_centered_medium_02', W, 'wall_window_centered_medium_02'], ['wall_window_centered_small_02', W, 'wall_window_centered_small_02']],
  }),
  // ---- the street behind the alley mouth (seen when turning around inside the picture)
  factory({
    facing: 'north',
    start: [-12, ALLEY.mouth.far],
    run: [1, 0],
    floors: [
      [W, 'wall_window_centered_small_01', 'wall_door_garage_door_01', 'wall_window_centered_small_01', 'wall_window_centered_small_01', W, 'wall_window_centered_small_01', W],
      ['wall_window_centered_medium_01', 'wall_window_centered_medium_01', 'wall_window_centered_medium_01', 'wall_window_centered_medium_01', 'wall_window_centered_medium_01', 'wall_window_centered_medium_01', 'wall_window_centered_medium_01', 'wall_window_centered_medium_01'],
      ['wall_window_centered_medium_02', 'wall_window_centered_medium_02', 'wall_window_centered_medium_02', 'wall_window_centered_medium_02', 'wall_window_centered_medium_02', 'wall_window_centered_medium_02', 'wall_window_centered_medium_02', 'wall_window_centered_medium_02'],
    ],
  }),
  apt({
    facing: 'south',
    start: [-H, ALLEY.mouth.near],
    run: [-1, 0],
    floors: [[W, 'wall_window_centered_small_01', W], ['wall_window_centered_small_01', W, 'wall_window_centered_small_01'], ['wall_window_centered_small_02', W, 'wall_window_centered_small_02'], ['wall_window_centered_small_02', W, 'wall_window_centered_small_02']],
  }),
  factory({
    facing: 'south',
    start: [H + 9, ALLEY.mouth.near],
    run: [-1, 0],
    floors: [[W, 'wall_window_centered_small_01', W], ['wall_window_centered_medium_01', W, 'wall_window_centered_medium_01'], ['wall_window_centered_medium_02', W, 'wall_window_centered_medium_02'], ['wall_window_centered_small_02', W, 'wall_window_centered_small_02']],
  }),
];

/** Kelvin-ish colors for practical lights. */
export const LIGHT_COLORS = {
  tungsten: 0xffb06a,
  sodium: 0xff9a4a,
  coolLed: 0xcfe0ff,
  window: 0xffc488,
} as const;

/** The fire escape on the left wall (the dream lets its stairs keep climbing). */
export const fireEscape = {
  x: -ALLEY.halfWidth + 0.72,
  platformZ: -13.0,
  stairsZ: -12.2,
  /** Heights of the real platforms; each flight of stairs hangs this far below its platform. */
  platforms: [3.0, 6.0] as const,
  stairsDrop: 2.35,
  platformNodes: ['modular_fire_escape_platform_middle', 'modular_fire_escape_railing_middle'] as const,
  stairsNodes: ['modular_fire_escape_stairs'] as const,
};

/** A warm room seen through a window: its back wall glows and its light spills into the alley. */
export interface WindowLight {
  position: readonly [number, number, number];
  facing: Facing;
  intensity: number;
  width: number;
  height: number;
  /** Named windows can be used by the dream. */
  name?: string;
  /** Rooms too far away to light anything only glow. */
  unlit?: boolean;
}

/** A sheer curtain half-drawn in the lit room on the right, moving in a draught. */
export const curtainConfig = {
  window: 'curtainWindow',
  /** Distance in front of the room's back wall (toward the alley) and size. */
  inset: 0.32,
  width: 0.62,
  height: 1.85,
  /** How far across the window it is drawn (fraction of its width, from the left). */
  drawn: 0.42,
  color: 0xe9e2d6,
  opacity: 0.78,
  /** Draught: amplitude (m) and speed. */
  sway: 0.035,
  speed: 0.9,
} as const;

/** Practical lights of the real alley (intensities in candela, distances in meters). */
export const lightingConfig = {
  exposure: 0.92,
  environmentIntensity: 0.42,
  backgroundIntensity: 0.55,
  /** Heading of the real dusk sky (rad). */
  skyRotation: 1.9,
  fog: { color: 0x3a4658, density: 0.02 },
  /** The wall lantern behind the photographer: casts the long shadow down the alley. */
  key: {
    position: [-1.32, 3.32, 3.0],
    target: [0.2, 0, -3],
    intensity: 70,
    angle: 62,
    penumbra: 0.7,
    color: LIGHT_COLORS.tungsten,
    shadow: { near: 0.3, far: 40, bias: -0.0004, normalBias: 0.02, radius: 4 },
  },
  security: { position: [1.5, 3.05, -13.5], target: [0.4, 0, -14], intensity: 34, angle: 70, penumbra: 0.8, color: LIGHT_COLORS.coolLed },
  bulb: { position: [-1.62, 2.95, -28.5], intensity: 6, distance: 9, color: LIGHT_COLORS.tungsten },
  crossStreet: { position: [2.8, 3.7, -39.6], target: [0, 0, -37], intensity: 90, angle: 75, penumbra: 0.9, color: LIGHT_COLORS.sodium },
  /** Emissive strength of the lamps' glass. */
  lampGlow: 6,
  /** Lit rooms: glow of the back wall per unit of light intensity, light range, light offset toward the window. */
  room: { glow: 0.35, distance: 7, offset: 0.25 },
  /** Warm rooms behind a few windows: back wall of the room (inside the building) and the way it faces. */
  windows: [
    { position: [2.6, 4.6, -7.5], facing: 'west', intensity: 4, width: 1.1, height: 1.9, name: 'curtainWindow' },
    // across the street behind the alley mouth, straight back from where you stand inside the picture:
    // a dim room now; inside the picture it shows the moment you came from
    { position: [1.5, 1.46, 23.25], facing: 'north', intensity: 1.2, width: 0.9, height: 1.72, name: 'roomWindow' },
    { position: [-2.6, 7.6, -1.5], facing: 'east', intensity: 2.5, width: 1.1, height: 1.9 },
    { position: [-0.5, 4.5, -45.7], facing: 'south', intensity: 5, width: 2.0, height: 1.9, unlit: true },
    { position: [5.5, 7.5, -45.7], facing: 'south', intensity: 3.5, width: 1.1, height: 1.9, unlit: true },
  ] as readonly WindowLight[],
  flash: { intensity: 900, distance: 30, decay: 2 },
  /**
   * Soft spill from a lit window in front of the photographer. It exists only in the real moment
   * (outer layer), so it shapes the hands, camera and print without changing the photographed world.
   */
  fill: { position: [1.2, 2.3, -1.6], intensity: 1.6, distance: 5, color: LIGHT_COLORS.window },
} as const;
