/** The dream inside the photograph: what differs from the real alley, and how it unfolds along the walk. */
import { lightingConfig } from './scene.config';
import { walkConfig } from './walk.config';

const at = (h: number, m: number, s: number) => h * 3600 + m * 60 + s;
const ROOM = lightingConfig.windows.find((w) => w.name === 'roomWindow')!;

type V3 = readonly [number, number, number];

export const dreamConfig = {
  clock: {
    /** The real alley's clock has stopped at this instant; inside the picture it runs on from there. */
    stoppedAt: at(10, 9, 41),
    rate: 1,
    /** The stopped second hand only twitches (when sin(t * rate) > threshold, by `seconds`). */
    twitch: { rate: 4.1, threshold: 0.96, seconds: 0.35 },
  },
  /** Reflection strength of the impossible sky in the puddles (the real alley uses the dusk). */
  puddles: { intensity: 0.11 },
  /**
   * Over the night street a daylight sky (the puddles knew it first): a little of it is already in the
   * photograph, all of it by `fullAt` of the walk, its horizon leaning and slowly turning.
   */
  sky: {
    captured: 0.22,
    fullAt: 0.42,
    rotation: 1.9,
    /** rad / s */
    turnRate: 0.004,
    /** deg */
    tilt: 9,
  },
  /**
   * Changes that happen only while you are not looking (seconds spent inside before each may happen).
   * `margin` (deg) widens the field of view used to decide "not looking".
   */
  beats: {
    margin: 12,
    window: 4,
    chair: 12,
    stairs: 16,
    cctv: 2,
  },
  /** The giant print hanging over the void: a picture of the sea you will walk into. */
  giantPrint: {
    z: walkConfig.printZ,
    /** Times the size of the real print; its image center then sits at the walk's eye height there. */
    scale: 36,
    center: [0, 2.2] as const,
    /** A slow sway (deg, s) that settles as you come close (m). */
    sway: { amount: 0.5, period: 9, stillWithin: 14 },
    /** Farther than `live[0]` m it shows a still of the sea; nearer than `live[1]` m a live window into it. */
    live: [46, 36] as const,
    /** The still: resolution, and how far in front of the print it is taken from (m, on its axis). */
    still: { resolution: 1024, distance: 41 },
    /**
     * What the picture throws on whatever faces it (candela, reach m): the light stands `behind` m behind the
     * paper, on the image's axis, so that it falls on the things in front and never on the print itself.
     */
    light: { color: 0xe8cdb4, intensity: 110, distance: 50, behind: 4 },
    poi: { radius: 3, zoom: 0.5 },
    /** The chains and hooks are not drawn from farther up the walk than this (z, m): the meat hides them. */
    hardwareFrom: -160,
    /** It hangs by two butcher's hooks driven through the white border above the image. */
    hooks: {
      /** Distance of each hook from the middle (m) and its height (m: the scan is 1 m tall). */
      x: 1.05,
      height: 1.3,
      /** How far the bottom of the curve lies under the paper's top edge (m): less than the border (0.234 m), or it would cross the image. */
      bite: 0.196,
      /** Turn of the curve away from the paper's plane (deg): the point comes through toward you, and from the front it still reads as a hook. */
      turn: 55,
      /** Where the chain takes it, the top bar of its loop: height, and offset across the curve's plane (shares of its height). */
      bar: [0.981, -0.045] as const,
      /** Radius of its steel (m). */
      steel: 0.025,
      /** Rust repeats every this many of the scan's UV units (about 0.8 m), and how much it still shines. */
      tile: 0.42,
      metalness: 0.3,
      /** What one hook's reflection may cost (triangles). */
      reflected: 500,
    },
    /** Real links, straight up into the dark: the height they reach (m), each link's outer length and width and its wire's radius (m). */
    chain: {
      top: 40,
      length: 0.42,
      width: 0.24,
      wire: 0.03,
      /** Links of each chain, from the hook up, that the light reaches: only these get the finer geometry. */
      lit: 28,
      /** Rust repeats every this many meters of wire. */
      tile: 1.1,
      /** No two links lie alike: shift (m), turn and lean (deg), and how much the rust's brightness varies. */
      jitter: { shift: 0.004, turn: 5, lean: 1.2, tone: [0.7, 1.15] as const },
      seed: 11,
    },
    /** Where each hook went through the paper: the torn hole and the rust it wept (size across, m, and its texture width, px). */
    wound: { width: 0.62, resolution: 256, runs: 46, hole: 0.036, lift: 0.006 },
  },
  /** The fire escape keeps climbing past the roof into the sky. */
  stairs: { from: 9, to: 54, step: 3, probeHeight: 20 },
  /** A window that shows the real alley from where you first stood (aspect = width / height of the pane). */
  window: { resolution: 192, aspect: ROOM.width / ROOM.height, brightness: 1.6, everyNthFrame: 6, zoom: 0.24, poiRadius: 4, renderMargin: 5 },
  /** The lone chair walks to the middle of the alley and faces you. */
  chair: { position: [0.15, 0, -12.2] as V3, heading: 0 },
  /** Seconds for the security camera to turn toward you. */
  cctvTurn: 45,
  /** Life in the real and the dreamt alley (amplitudes in rad / m, periods in s). */
  alive: {
    /** Each motion comes and goes in its own slow gust (period s), so they rarely move together. */
    gustPeriod: 23,
    cableSway: 0.035,
    cablePeriod: 6.5,
    lampSwing: 0.06,
    lampPeriod: 4.2,
    plantSway: 0.025,
    bulbFlicker: 0.35,
  },
  /** The photograph found taped to the cabinet behind you (height m, tilt deg, attention zoom). */
  found: { resolution: 512, height: 0.8, tilt: -4, zoom: 0.18, radius: 4, curl: 0.0016 },

  /**
   * Rain stopped by the shutter: every drop hangs where it was. Behind the viewer time runs again
   * (drops farther than `fall.from` m behind start falling, fully after `fall.blend` m more, at `fall.speed` m/s).
   * Then, once the walk has begun, every drop lengthens into a strand of white hair (`hair`).
   */
  rain: {
    count: 9000,
    region: { x: [-1.75, 1.75] as const, y: [0.15, 9] as const, z: [-1.6, -40] as const },
    /** Streak width and length (m). */
    size: [0.0045, 0.055] as const,
    color: 0xcfd8ff,
    /** Linear brightness (the drops catch the dream's light, they do not emit it) and opacity. */
    brightness: 0.55,
    opacity: 0.55,
    /** Drops within `radius` m of the eye drift aside by up to `push` m (no one walks through a drop). */
    part: { radius: 1.1, push: 0.6 },
    fall: { from: 1.2, blend: 4, speed: 5.5 },

    hair: {
      /** Stretch of the walk (fractions) over which the rain becomes hair; a strand takes `growShare` of it. */
      grow: [0.01, 0.07] as const,
      growShare: 0.36,
      /** Strands begin near the way ahead and it spreads: share of the morph it takes between these distances down the alley (m). */
      growWave: 0.42,
      growNear: [5, 40] as const,
      /** Ribbon segments (triangles = count * segments * 2), crowded toward the free end by this power. */
      segments: 8,
      tipBias: 1.6,
      /** Hair that was never rain, over this stretch of the alley (z), to make the first of it a forest. */
      thick: { count: 3000, segments: 5, z: [-2.5, -15.5] as const },
      /** Bone white, what it shows of itself with no lamp near (linear), and how much it covers. */
      color: 0xece6d6,
      brightness: 0.34,
      opacity: 0.9,
      /** Width of a strand (m): most are thin. */
      width: [0.006, 0.024] as const,
      /** It hangs from above this height (m; the roofs are at 9 to 15), and is this long (m). */
      rootAbove: 12.5,
      length: [3, 14] as const,
      shape: {
        /** Share of its length over which the tip widens, the root's share of its width, and how dark the root is. */
        tipTaper: 0.16,
        rootThin: 0.55,
        rootDark: 0.38,
        /** Shares of its length that fade out at the tip and at the root. */
        tipFade: 0.05,
        rootFade: 0.22,
        /** How finely a near strand shows the hairs it is made of (rad across its width). */
        fibres: 15,
        /** Nearer than this to the lens it dissolves (m), and the hair ends softly at this z: gone, then whole. */
        nearFade: [0.15, 0.9] as const,
        end: [-41, -33.5] as const,
      },
      locks: {
        /** How many; a strand within `reach` m joins the nearest, unless it is one of the `loose` share. */
        count: 720,
        reach: 0.55,
        loose: 0.16,
        /** Share of a strand's length, from its end, over which it gathers to its lock's point; above that it hangs straight. */
        gather: 0.34,
        /** Strands of a lock end up to this much above its point (m), within this radius of it (m). */
        tipSpread: 2.2,
        tipRadius: 0.045,
        /** Where they hang thick and thin: rate of that along z and across x (rad / m). */
        clumps: [1.13, 2.1] as const,
      },
      /**
       * What it leaves free of itself: a vault over the way, from its crown to the walls (heights in m). Over the forest it
       * hangs low; from `liftFrom` to `liftTo` (z: starts, done) it rises above the faces on the washing lines.
       */
      vault: {
        forest: [2.7, 0.2] as const,
        forestShape: 1.7,
        faces: [4.5, 0.9] as const,
        facesShape: 2.6,
        liftFrom: [-12, -15.5] as const,
        liftTo: [-32, -36] as const,
        /** A lock ends up to this far above the vault (m); the power keeps most of them near it. */
        spread: 4.2,
        spreadPower: 2.2,
        /** This share of the locks within `within` m of the middle hang low over the way (m). */
        low: { share: 0.06, height: [0.9, 2.2] as const, within: 0.75 },
      },
      /** A loose wave of its own (m), its rate along the strand and that of the curl at its end (rad / m). */
      wave: { amount: [0.04, 0.17] as const, rate: 0.62, curl: 3.1 },
      wind: {
        /** A free end sways this far per meter of strand; `reduced` is the share of that for visitors who ask for less motion. */
        amount: 0.045,
        reduced: 0.2,
        /** The wave: rad / s, rad / m along the alley and across it, how much it lags down a strand and between locks (rad). */
        speed: 0.55,
        along: 0.33,
        across: 0.5,
        lag: 1.3,
        lock: 0.9,
        /** Share of the sway across the alley, a second wave's share, and how much of the sway near the walls is taken away. */
        side: 0.35,
        second: 0.4,
        walls: 0.7,
      },
      /** Within `radius` m of the eye it bends `push` m aside; `flat` shortens height in that distance, `tail` what is behind you. */
      part: { radius: 1.6, push: 1.1, flat: 0.5, tail: 0.55 },
      /**
       * Behind you it comes down: from `from` m behind, fully after `blend` m more, in `1 / rate` s from root to
       * ground. What reaches the ground lies on it, at this height (m), this share of its length. Between these
       * distances behind you (m) it is gone.
       */
      fall: { rate: 1 / 24, from: 3, blend: 8, floor: 0.012, lie: 0.3, gone: [10, 13] as const },
      /** Albedo of a thread, strength and sharpness of its sheen, its share that adds, the closest a lamp counts as (m), and how much of a lamp's color it takes. */
      light: { diffuse: 0.26, sheen: 0.6, shine: 36, additive: 0.08, lampNear: 1, tinge: 0.4 },
    },
  },

  /** Washing lines across the alley, pegged with scratched faces, and gas masks like laundry. */
  lines: {
    /** z at the left wall, height there, z at the right wall, height there, sag (m). */
    spans: [
      [-15.9, 4.9, -16.3, 5.2, 0.5],
      [-18.7, 4.5, -18.2, 4.2, 0.45],
      [-21.2, 5.5, -21.8, 5.2, 0.5],
      [-23.9, 4.7, -24.5, 5.0, 0.5],
      [-26.8, 4.2, -26.3, 4.0, 0.35],
      [-29.3, 5.4, -29.9, 5.1, 0.5],
      [-32.1, 4.6, -31.7, 4.9, 0.45],
    ] as const,
    /** Things pegged on each line; the fifth is the densest, low over the way. */
    perLine: [5, 5, 5, 5, 6, 5, 5] as const,
    /** Which line, which place on it, holds a gas mask instead of a print. */
    masks: [
      [0, 3],
      [1, 0],
      [2, 4],
      [3, 1],
      [5, 2],
    ] as const,
    /** The densest line (its faces are a memory), and which of its places holds the one face not yet scratched. */
    densest: 4,
    unscratched: 2,
    /** Size of a print (times a real print) and of a mask (times a real one). */
    scale: 7,
    maskScale: 1.25,
    /** Pegged by their top edge: sway (rad) and period (s). */
    sway: { amount: 0.08, period: 6.5 },
    /** The memory on the densest line: angular radius (deg) and how far a long look narrows the view. */
    poi: { radius: 16, zoom: 0.62 },
  },

  /** The pictures drifting over the sea: views rendered once, before the piece starts. */
  moments: {
    resolution: 256,
    /**
     * pass 'real': the real moment before the shot (the photographer, from where no one stood);
     * pass 'dream': places further along the walk (walk-frame positions are offset into the sea past the print).
     */
    views: [
      { pass: 'real', position: [0.35, 1.7, -2.4] as V3, target: [0, 1.62, 0] as V3, fov: 40 },
      { pass: 'real', position: [0.2, 9.5, -1.2] as V3, target: [0, 0, -0.6] as V3, fov: 50 },
      { pass: 'real', position: [0.5, 1.5, -14] as V3, target: [0, 1.4, 0] as V3, fov: 22 },
      { pass: 'dream', position: [0, 1.7, -40] as V3, target: [0, 3, -62] as V3, fov: 58 },
      { pass: 'dream', position: [-2, 1.7, -68] as V3, target: [4, 5, -110] as V3, fov: 70 },
      { pass: 'dream', position: [0, 1.62, -128] as V3, target: [0, 1.5, -146] as V3, fov: 60 },
      { pass: 'dream', position: [0, 1.7, -154] as V3, target: [0, 1.7, -180] as V3, fov: 66 },
      { pass: 'dream', position: [0.2, 1.65, -240] as V3, target: [0.15, 2, -300] as V3, fov: 56 },
    ],
  },

} as const;
