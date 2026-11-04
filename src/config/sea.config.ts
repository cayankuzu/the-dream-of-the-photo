/**
 * Behind the giant print: a sea of black oil under a burning sky, heavy and slow, a half sun stopped on
 * its horizon, and everyone you ever were standing in it up to the waist. Positions are walk-frame (see
 * walk.config.ts); the whole sea is drawn at `offset` from them, far beyond the alley's far plane, so
 * neither place can ever see the other. Nothing stands above the oil on the alley side of the print
 * (walk-frame z > the print's z): the live window looks into the sea through the print from there.
 */
type V3 = readonly [number, number, number];

/** One long wave of the swell: unit direction, length (m), height from its middle (m), period (s). */
export interface SwellWave {
  direction: readonly [number, number];
  length: number;
  height: number;
  period: number;
}

/** Bodies of one pose, as FigureSpec fields (see FigureKit.ts). */
export interface CrowdPose {
  avatar: 'figure_man' | 'figure_nurse';
  clip: string;
  time: number;
  veil?: boolean;
  /** Multiplies the clothes. */
  tint?: number;
  bleach?: number;
  /** How many stand near the way (full detail) and how many far out (thinned). */
  near: number;
  far: number;
}

export const seaConfig = {
  offset: [0, 0, -570] as V3,
  /** A camera whose absolute z is below this stands in the sea (the alley never reaches it). */
  boundaryZ: -400,
  water: {
    /** Level of the surface (walk-frame y). */
    level: 0,
    /**
     * The grid that lies under the eye, finer the nearer: rings, each `growth` times as far from the last
     * as the last from the one before; sectors; its radius (m: its edge is the horizon, about where the sun
     * enters the oil, and the sky's horizon stays on it); the step in which it follows the eye (m).
     * Triangles: 2 × rings × sectors.
     */
    grid: { rings: 92, growth: 1.06, sectors: 192, radius: 150, snap: 0.5 },
    /** Color of the oil itself, and how much it mirrors looking straight down / along its surface. */
    color: 0x020102,
    reflectance: [0.01, 0.4] as const,
    /** Falloff of the mirror from grazing to straight down: higher keeps the near oil blacker. */
    fresnelPower: 5,
    /** The swell, longest first: so slow and so long that it reads as weight. */
    swell: [
      { direction: [0.34, 0.94], length: 37, height: 0.14, period: 13 },
      { direction: [-0.52, 0.85], length: 23, height: 0.085, period: 10 },
      { direction: [0.76, 0.65], length: 13.5, height: 0.045, period: 7.5 },
      { direction: [-0.83, 0.56], length: 7.9, height: 0.018, period: 5.8 },
      { direction: [0.12, 0.99], length: 4.3, height: 0.0045, period: 4.2 },
    ] satisfies readonly SwellWave[],
    /** The swell's trains drift through each other: a slow bend of their common ground (1/m, m, 1/s). */
    swellBend: { frequency: 0.085, reach: 4.5, rate: 0.023 },
    /** The grid stops heaving between these distances (m): out there nothing is left to see of it. */
    heaveFade: [70, 170] as const,
    /** How far a slope of the surface moves the mirrored image (share of the frame per unit: across, up and down). */
    deflection: [0.5, 0.85] as const,
    /** Reflected lights draw out into soft vertical streaks: length (share of the frame's height) at grazing angles. */
    streak: 0.018,
    /** Far out, where the swell is too fine to see, the streaks grow by as much as this (× per m of a pixel, up to the limit). */
    streakGrowth: [0.25, 1.2] as const,
    /** Reflection target size as a fraction of the drawing buffer, and its MSAA samples. */
    resolution: 0.5,
    samples: 2,
    /** Toward its edge (shares of the radius) the oil's own body goes over into the haze, and at the very last its mirror too: no edge is to be seen where nothing shines. */
    rim: { body: [0.62, 0.96] as const, mirror: [0.97, 1] as const },
    /**
     * The hot heart of the sun's reflection, a column running from under it to your feet: its color, half width
     * (sine of the angle at the eye), how far from the mirror's direction it reaches (sine of the angle up), and how
     * strongly the oil's sluggish folds break it up (0..1).
     */
    column: { color: [7, 1, 0.06] as V3, width: 0.05, reach: 0.34, broken: 0.75 },
    /** The film of oil: how large its patches are (1/m), how fast they creep (1/s), how many colors a patch runs through, how strongly. */
    sheen: { scale: 0.05, creep: 0.006, bands: 1.5, strength: 0.07 },
  },
  /** The sun that stopped halfway: a disc standing in the oil, facing the way. Colors are light, far past white in the middle. */
  sun: {
    at: [-14, 0, -395] as V3,
    radius: 42,
    /** Light of its heart, its body, its limb, and of the dirt that crawls over it; how much cooler its top is than where it enters the oil. */
    heart: [8.5, 2.1, 0.16] as V3,
    body: [2.9, 0.3, 0.012] as V3,
    limb: [1.05, 0.05, 0.004] as V3,
    vein: [0.26, 0.012, 0.002] as V3,
    cool: 0.5,
    /** Size of the boiling cells (per radius) and how fast they boil (1/s). */
    boil: { scale: 7, rate: 0.03 },
    /** Smoke drifting before it: long bands (per radius, along and across), how fast (× the boil), how much light they take, from what density to what. */
    smoke: { along: 1.3, across: 6.5, drift: 1.6, strength: 0.62, from: 0.44, to: 0.7 },
    /** The rim's glow (light, and how fast it dies per radius outside the disc), the wide halo (light, reach in radii), size of the sheet carrying them (radii). */
    rim: { color: [2.2, 0.26, 0.014] as V3, falloff: 15 },
    halo: { color: [0.17, 0.016, 0.0028] as V3, reach: 0.9 },
    sheet: 9,
    /** The sheet lies this far (m) behind the disc. */
    behind: 2,
    /** A long look: angular radius (deg), zoom, reach (m), and how far above its center (m) curved space shows it. */
    poi: { radius: 17, zoom: 0.82, reach: 220, lift: 52 },
  },
  /** What the sun does to everything it faces, without being a light: a shader term (see DreamSea.ts). */
  sunlight: {
    /** Toward where it seems to come from (walk frame). */
    from: [-14, 34, -395] as V3,
    color: [7.5, 1.05, 0.085] as V3,
    /** Light wraps this far (share) around what faces away, and grazing surfaces catch this much of the fire behind them. */
    wrap: 0.25,
    rim: 0.55,
    /** The burning sky from above, and what comes up from the black oil (irradiance). */
    sky: [0.8, 0.13, 0.042] as V3,
    oil: [0.05, 0.012, 0.008] as V3,
  },
  /**
   * Hepsi sensin. Hepsinin saçı beyaz. Standing in the oil, their backs to you, facing the sun; whenever one is out of
   * your sight it may turn. By the blink all of them have turned, and more have come up.
   */
  crowd: {
    poses: [
      { avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 5, near: 22, far: 24 },
      { avatar: 'figure_nurse', clip: 'f_idle_touch_hair_01', time: 1, tint: 0x8a8378, near: 16, far: 12 },
      { avatar: 'figure_nurse', clip: 'f_walk_injured', time: 0.5, veil: true, near: 12, far: 0 },
      { avatar: 'figure_man', clip: 'm_gestic_laugh_extreme', time: 3.83, near: 10, far: 0 },
      { avatar: 'figure_man', clip: 'm_wave_02', time: 1.2, near: 0, far: 24 },
    ] satisfies readonly CrowdPose[],
    /** Height (m above its feet) below which a body is not there at all: always under the oil, whatever the swell does. */
    cutAt: 0.42,
    /** Vertices of a far body closer than this (m) collapse into one. */
    thin: 0.055,
    /** Their feet stand this deep (m). */
    depth: [0.82, 1.08] as const,
    /** Bodies this much taller or smaller than life. */
    scale: [0.97, 1.05] as const,
    /**
     * Those right beside the way: how many, along which stretch (walk-frame z), how far from the way (m), how close they
     * may come once they have turned (m), and what share of their distance they keep then.
     */
    beside: { count: 18, z: [-235, -258] as const, reach: [2.1, 5.6] as const, closest: 1.5, closer: 0.72 },
    /** The rest of those in full detail, further out: stretch of z, reach from the way (m). */
    around: { z: [-228, -300] as const, reach: [4, 26] as const },
    /** Those far out: stretch of z, reach from the way (m). */
    afar: { z: [-234, -322] as const, reach: [13, 60] as const },
    /** How far apart their loose rows run (m), and how close two may stand (m; twice that far out). */
    rowStep: 4.5,
    spacing: 2.2,
    /** No one here: around the photographer, and straight ahead beyond them where the column burns (half width, z). */
    corridor: { halfWidth: 4.5, z: [-256, -292] as const },
    /** The share of those near the way that wait under the oil until they are not seen. */
    risen: 0.4,
    /** When each wants to turn (walk), and how far off (deg) a turned one may be from facing you before it corrects itself unseen. */
    turn: [0.905, 0.948] as const,
    reaim: 7,
    /** How far they stand off from upright (deg), and how far those beside the way lean to you once they have turned. */
    tilt: 3,
    lean: 13,
    /** Margin of "out of sight" (deg). */
    margin: 10,
    seed: 41,
    /** How many of them, nearest first, the mirror still shows (share). */
    mirrored: 0.5,
  },
  /** You blink. It is what it takes: a heavy lid, once. When it opens they have all turned. */
  blink: {
    /** Walk at which the lid starts to fall. */
    at: 0.951,
    /** Seconds: falling, closed, rising. */
    close: 0.11,
    hold: 0.07,
    open: 0.3,
  },
  /** Where a body stands the oil creeps: rings in it. Reach (m), its light at the body, how slowly it travels (m/s), its waves per m. */
  rings: { reach: 1.4, light: 0.06, speed: 0.12, frequency: 2.2, tint: [1, 0.2, 0.08] as V3 },
  /** Her mouth is the choir you hear: colossal, plaster, sunk until the oil reaches her lip. */
  singer: {
    at: [36, -24.3, -316] as V3,
    /** Height (m), heading (deg). */
    scale: 47,
    heading: -52,
    color: 0xcfc8ba,
    /**
     * The scan's lips hardly part: her jaw is dropped for her. In the model's own numbers (its shape runs from -1 to 1): where
     * the lips meet, which way the face looks there (deg), how far the jaw drops, how wide the part that drops is and how far
     * down it reaches; and the half width and half height of the dark in the mouth.
     */
    mouth: { at: [0.259, 0.112, 0.515] as V3, facing: 30, drop: 0.07, wide: 0.2, reach: 0.26, dark: [0.066, 0.046] as const },
  },
  /** Sunk to the eyes, far off, before the sun's left shoulder. */
  drowned: {
    at: [-47, -39.6, -362] as V3,
    scale: 62,
    heading: 9,
    color: 0xb7b0a2,
  },
  /** Stone stained by what it stands in: how fast the stains change (1/m), how high the oil has climbed (m). */
  stain: { scale: 0.13, tide: 4.5 },
  /** Half sunk, listing, its rags hanging; a black shape on the right. */
  ship: {
    at: [63, -11.5, -305] as V3,
    /** Times the model's size (its length is 34 m), list (deg), heading (deg), trim (deg). */
    scale: 2.05,
    list: -13,
    heading: 62,
    trim: -6,
    /** Hull and rigging go black; what is left of the sails stays a little paler. */
    black: 0.1,
    sails: 0.34,
  },
  /** A rubber duck the size of a house, on the oil. Serious as a corpse. */
  duck: {
    at: [-16, 0, -262] as V3,
    /** Times the toy's size, how deep it floats (m), and its own light (so that it stays yellow). */
    scale: 26.7,
    draught: 1.25,
    glow: 0.22,
    /** It looks away (rad) until this span of the walk has brought its face around to you. */
    away: 1.9,
    turn: [0.9, 0.962] as const,
    /** Over how long a stretch of the swell (m) its hull feels the slope, and how far that slope tips it. */
    hull: 3.2,
    tip: 1.1,
  },
  /**
   * Soft additive glows in the haze (lamp halos, the light under the doors): how tight they are (higher,
   * tighter), and how far each is drawn toward the eye (share of its smaller size) so what it surrounds does not cut it.
   */
  glow: { scatter: 22, pull: 0.5 },
  /** Street lamps left standing in the oil, flickering; each keeps a light of its own (how bright, how far, how far its light may dip, how fast). */
  lamps: {
    items: [
      { at: [1.95, -0.35, -241.5] as V3, yaw: 40, lean: [-2, 3] as const },
      { at: [-5.2, -0.5, -256] as V3, yaw: 200, lean: [4, -1] as const },
    ],
    halo: { size: 1.3, strength: 0.75 },
    light: { intensity: 16, distance: 10, dip: 0.82, rate: 1.1 },
  },
  /** Doors without walls, standing in the oil; light leaks under them from a room that is not there. */
  doors: {
    items: [
      { piece: 'apartments/door_centered_small_01', at: [-6, 0.06, -250] as V3, yaw: 20 },
      { piece: 'factory/door_recessed_large_01', at: [5.5, 0.06, -264] as V3, yaw: -18 },
      { piece: 'apartments/door_centered_large_01', at: [-10, 0.06, -300] as V3, yaw: 10 },
    ],
    /**
     * The light under each door: share of the door's width, height of its strip (m, down into the oil from above the sill),
     * brightness (× window light); its glow on the haze just above the oil (size relative to the door's width, height m, strength);
     * its light on what stands near (candela, reach m).
     */
    light: { width: 0.78, height: 0.42, lip: 0.05, intensity: 9, spill: { width: 1.5, height: 0.5, strength: 0.4 }, cast: { intensity: 5, distance: 6, ahead: 0.5, up: 0.25 } },
    /** A painted back, so a door is still a door from behind (thickness m, color, roughness). */
    backing: { depth: 0.05, color: 0x17140f, roughness: 0.85 },
  },
  /**
   * A flight of fire-escape stairs rising out of the oil into the sky, climbing toward its heading
   * (yaw deg: 0 climbs toward +x, away from the way). `step` is the offset from one flight to the next
   * (along the climb, up; m): 15 treads of 0.187 × 0.258 m, measured from the model.
   */
  stairs: { at: [7, -1.6, -248] as V3, yaw: 0, flights: 10, step: [2.807, 3.867] as const },
  /**
   * The moon: a photograph of the moment you left, dim and reddish, high up, an unsettling second thing in the sky
   * (scale × a real print, light of its paper); turned toward a point of the way; a soft halo behind it (size × its height, m behind it).
   */
  moon: {
    at: [-92, 58, -358] as V3,
    faces: [0.2, 1.7, -240] as V3,
    scale: 210,
    glow: [0.3, 0.07, 0.05] as V3,
    /** How the picture itself is graded: dim, drained, red. */
    grade: { exposure: 0.3, saturation: 0.35, warmth: 0.5, tint: -0.08, flare: 0.008 },
    halo: { size: 2.1, strength: 0.14, color: 0xff6a3a, scatter: 6, behind: 4 },
    /** Looking at it long enough draws the view toward it (angular radius deg, zoom, reach m, and how far above it (m) curved space shows it). */
    poi: { radius: 10, zoom: 0.55, reach: 220, lift: 26 },
  },
  /** Burnt photographs still drifting over the oil like slow birds. */
  prints: {
    count: 8,
    region: { x: [-13, 13] as const, y: [1.6, 8] as const, z: [-232, -285] as const },
    scale: 5,
    /**
     * Drift (m) over each print's own period (s): how much of its first sway may rise and fall (share), the
     * size and rate of a second, slower sway, and the rate of its rocking (× the first).
     */
    drift: { amount: 0.7, period: [13, 21] as const, rise: 0.6, second: 0.5, secondRate: 0.61, rockRate: 1.3 },
    /** How far it rests from upright, and its slow rocking (deg). */
    lean: 22,
    rock: 8,
    /** Turning (deg / s, each at least `least` of it), about an axis that strays from the vertical by up to `stray`. */
    spin: { rate: 7, least: 0.35, stray: 0.25 },
    /** None over the way at eye level (half width, height m), none closer than `spacing` m to another. */
    clear: { halfWidth: 1.8, height: 3.8 },
    spacing: 3.5,
    seed: 7,
    /** How far in the fire has eaten (share of the way to its middle), how raggedly, the color of the char, and its live edge's light. */
    burn: { reach: 0.42, grain: 0.55, char: 0.012, ember: [5.5, 1.1, 0.12] as V3 },
  },
  /** Ash coming down, and a few sparks in it: flakes around the eye (how many, the box they fall through m, their size m, speed m/s, share of sparks). */
  ash: { count: 420, box: [26, 13, 26] as V3, size: 0.03, fall: 0.22, sway: 0.5, sparks: 0.14, spark: [4.5, 0.85, 0.08] as V3, dark: [0.012, 0.006, 0.005] as V3 },
  /**
   * The photographer, standing on the oil at the end of the way, aiming back at you: a little too large, white-haired, and
   * cut through from the crown down: the plane leans `opening` deg toward you so that you can see into them, `offset` m off
   * the body's middle toward their missing side. Their camera is whole.
   */
  figure: {
    position: [0.15, 0, -270] as V3,
    heading: 0,
    clipTime: 2.9,
    scale: 1.38,
    opening: 34,
    offset: -0.006,
    /** A long look: angular radius (deg), zoom, reach (m). */
    poi: { radius: 9, zoom: 0.42, reach: 42 },
    /** Colors of the cut: meat, what runs through it, the wet of it. */
    meat: { deep: [0.05, 0.003, 0.004] as V3, red: [0.3, 0.018, 0.016] as V3, fat: [0.42, 0.2, 0.13] as V3, glow: 0.14 },
  },
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
