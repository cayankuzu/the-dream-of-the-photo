/**
 * Behind the giant print: a calm sea under the dream's dusk, mirror-still, with things from the
 * street standing in it. Positions are walk-frame (see walk.config.ts); the whole sea is drawn at
 * `offset` from them, far beyond the alley's far plane, so neither place can ever see the other.
 * Nothing stands above the water on the alley side of the print (walk-frame z > the print's z):
 * the live window looks into the sea through the print from there.
 */
type V3 = readonly [number, number, number];

export const seaConfig = {
  offset: [0, 0, -700] as V3,
  /** A camera whose absolute z is below this stands in the sea (the alley never reaches it). */
  boundaryZ: -400,
  /** The sea's air: a warm haze the color of the horizon. */
  fog: { color: 0x8c7f93, density: 0.0065 },
  water: {
    /** Side of the water square (m), its center (walk-frame x, z) and its level (walk-frame y). */
    size: 900,
    center: [0, -140] as const,
    level: 0,
    /** Deep color under the reflection, and the reflectance seen straight down / at grazing angles. */
    color: 0x05080e,
    reflectance: [0.05, 0.8] as const,
    /**
     * Slow swell: scale (1/m, of its longest wave), screen distortion of the reflection, speed (cycles / s
     * of the longest wave), and how far it tilts the surface (changes the Fresnel, not the reflection).
     */
    ripple: { scale: 0.32, strength: 0.005, speed: 0.1, tilt: 0.03 },
    /** The swell draws reflected lights into soft vertical streaks: length (share of the view's height) at grazing angles. */
    streak: 0.03,
    /** Reflection target size as a fraction of the drawing buffer, and its MSAA samples. */
    resolution: 0.5,
    samples: 2,
  },
  /**
   * Soft additive glows in the haze (lamp halos, the light under the doors, lit windows): how tight they are
   * (higher, tighter), and how far each is drawn toward the eye (share of its smaller size) so what it surrounds does not cut it.
   */
  glow: { scatter: 22, pull: 0.5 },
  /** Street lamps standing in the water along the way, alternately right and left. */
  lamps: {
    z: [-99, -106, -113, -120, -127, -134, -146, -160] as const,
    x: 2.2,
    /** How deep each post stands in the water (m) and how far it may lean (deg): they have been here a while. */
    sink: [0.05, 0.45] as const,
    lean: 2.5,
    halo: { size: 1.1, strength: 0.6 },
    seed: 3,
  },
  /** Doors without walls, standing in the water; light leaks under them from a room that is not there. */
  doors: {
    items: [
      { piece: 'apartments/door_centered_small_01', at: [-9, 0, -112] as V3, yaw: 25 },
      { piece: 'factory/door_recessed_large_01', at: [14, 0, -126] as V3, yaw: -30 },
      { piece: 'apartments/door_centered_large_01', at: [-22, 0, -150] as V3, yaw: 10 },
      { piece: 'factory/door_centered_large_01', at: [26, 0, -168] as V3, yaw: -15 },
      { piece: 'apartments/door_centered_small_02', at: [-5, 0, -185] as V3, yaw: 5 },
    ],
    /**
     * The light under each door: share of the door's width, height of the gap (m), brightness (× window light);
     * its glow on the haze just above the water (size relative to the door's width, height m, strength).
     */
    light: { width: 0.78, height: 0.035, intensity: 9, spill: { width: 1.5, height: 0.5, strength: 0.4 } },
    /** A painted back, so a door is still a door from behind (thickness m, color, roughness); also the fallback wall of a fragment. */
    backing: { depth: 0.05, color: 0x17140f, roughness: 0.85 },
  },
  /** Pieces of houses that drifted here: kit modules, a lit room behind each window (tilt deg = sinking). */
  fragments: {
    items: [
      { pieces: ['apartments/wall_window_centered_large_01', 'apartments/window_centered_large_01'], at: [18, -0.8, -104] as V3, yaw: -40, tilt: 6 },
      { pieces: ['factory/wall_window_tall_large_01', 'factory/window_tall_large_01'], at: [-16, -1.2, -132] as V3, yaw: 35, tilt: -4 },
      { pieces: ['apartments/wall_window_centered_double_01', 'apartments/window_centered_double_01'], at: [9, -1.6, -176] as V3, yaw: -10, tilt: 3 },
    ],
    /**
     * The room behind the wall: depth (m), brightness of its back wall (× window light), its side walls by the
     * window and by the back wall (shares of that), and a faint glow at the window (size m, strength).
     */
    room: { depth: 2.4, glow: 2.4, walls: [0.06, 0.35] as const, halo: { size: 2.4, strength: 0.08 } },
  },
  /**
   * A flight of fire-escape stairs rising out of the water into the sky, climbing toward its heading
   * (yaw deg: 0 climbs toward +x, away from the way). `step` is the offset from one flight to the next
   * (along the climb, up; m): 15 treads of 0.187 × 0.258 m, measured from the model.
   */
  stairs: { at: [7, -1.6, -118] as V3, yaw: 0, flights: 10, step: [2.807, 3.867] as const },
  /**
   * The moon: a photograph of the moment you left (scale × a real print, glow of its image and paper),
   * turned toward a point of the way; a large soft halo behind it (size × its height, m behind it).
   */
  moon: {
    at: [-28, 52, -235] as V3,
    faces: [0.2, 1.7, -110] as V3,
    scale: 440,
    glow: 2.6,
    halo: { size: 2.4, strength: 0.45, color: 0xffe9cf, scatter: 6, behind: 4 },
  },
  /** Photographs drifting over the water like slow birds. */
  prints: {
    count: 22,
    region: { x: [-14, 14] as const, y: [0.8, 7] as const, z: [-98, -165] as const },
    scale: 4,
    /**
     * Drift (m) over each print's own period (s): how much of its first sway may rise and fall (share), the
     * size and rate of a second, slower sway, and the rate of its rocking (× the first).
     */
    drift: { amount: 0.5, period: [11, 19] as const, rise: 0.6, second: 0.5, secondRate: 0.61, rockRate: 1.3 },
    /** How far it rests from upright, and its slow rocking (deg). */
    lean: 20,
    rock: 7,
    /** Turning (deg / s, each at least `least` of it), about an axis that strays from the vertical by up to `stray`. */
    spin: { rate: 8, least: 0.35, stray: 0.25 },
    /** None over the way at eye level (half width, height m), none closer than `keepAway` m to what stands in the water, or `spacing` m to another. */
    clear: { halfWidth: 1.5, height: 3.6 },
    keepAway: 2.5,
    spacing: 1.6,
    seed: 7,
  },
  /** The photographer, standing on the water at the end of the way, aiming back at you. */
  figure: { position: [0.15, 0, -140] as V3, heading: 0, clipTime: 2.9 },
  /**
   * The back of the giant print, seen when you turn around in the sea: dark film (grain levels, seeded),
   * a handwritten line (size and height as shares of the canvas, tilt rad), its texture width (px).
   */
  printBack: {
    film: '#141416',
    grain: 7,
    seed: 5,
    ink: 'rgba(234, 229, 216, 0.9)',
    caption: { size: 0.085, at: 0.62, tilt: -0.04 },
    resolution: 1024,
    roughness: 0.45,
    glow: 0.12,
  },
} as const;

/** Absolute position of a walk-frame point beyond the giant print. */
export const inSea = (p: V3): [number, number, number] => [p[0] + seaConfig.offset[0], p[1] + seaConfig.offset[1], p[2] + seaConfig.offset[2]];
