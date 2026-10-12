/** The dream inside the photograph: what differs from the real alley, and how it unfolds along the walk. */
import { ALLEY, lightingConfig } from './scene.config';
import { walkConfig } from './walk.config';

const at = (h: number, m: number, s: number) => h * 3600 + m * 60 + s;
const ROOM = lightingConfig.windows.find((w) => w.name === 'roomWindow')!;

type V3 = readonly [number, number, number];

/** A building of the dream's lengthened alley: width in 3 m columns, floors, lean (deg, + leans over the alley). */
export interface DreamBuilding {
  columns: number;
  floors: number;
  lean: number;
}

/** A thing that has forgotten gravity (model key, center position, rotation in deg, scale, kit nodes). */
export interface FloatingThing {
  key: string;
  at: V3;
  rotation: V3;
  scale?: number;
  nodes?: readonly string[];
}

export const dreamConfig = {
  /**
   * A small figure at the far end, aiming a camera back up the alley (already in the photograph).
   * It grows smaller as you come closer, then backs away into the giant print and is gone through it.
   */
  figure: {
    clipTime: 2.9,
    position: [0.35, 0, -84] as V3,
    /** deg; 0 faces +Z, i.e. back toward the viewer. */
    heading: 0,
    /** Distance (m) under which it starts to shrink instead of growing, and over how many meters. */
    shrinkFrom: 26,
    shrinkSpan: 8,
    minScale: 0.6,
    /** Viewer distances (m) over which it backs away to `toZ` (behind the print's surface). */
    retreat: { from: 21, to: 13, toZ: -93.5 },
    poi: { height: 1.5, radius: 3, zoom: 0.4 },
  },
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
  /** The dream's air: brighter than the night, so distance fades to light instead of to black. */
  fog: { color: 0x66708e, density: 0.016, /** density at the end of the alley */ far: 0.021 },
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
  /** The alley goes on where the cross street was: buildings taller and more crooked the farther it goes. */
  extension: {
    from: ALLEY.crossStreet.near,
    to: -96,
    left: [
      { columns: 4, floors: 5, lean: 1.2 },
      { columns: 4, floors: 6, lean: -1.8 },
      { columns: 3, floors: 7, lean: 2.6 },
      { columns: 4, floors: 6, lean: -1.4 },
      { columns: 5, floors: 8, lean: 2.2 },
    ] satisfies DreamBuilding[],
    right: [
      { columns: 4, floors: 4, lean: -1 },
      { columns: 3, floors: 5, lean: 2.4 },
      { columns: 5, floors: 6, lean: -2 },
      { columns: 4, floors: 8, lean: 3 },
      { columns: 4, floors: 7, lean: 1.2 },
    ] satisfies DreamBuilding[],
    /** The wall closing the alley behind the giant print. */
    endWall: { z: -96, floors: 9 },
    lanternLight: { intensity: 5, distance: 9, height: 2.7, out: 0.9 },
    /** Wall lanterns (z, alternating sides) lighting the way. */
    lanterns: [-42, -51, -60, -69, -78, -86],
  },
  /** The giant print hanging at the end of the alley: a picture of the sea you will walk into. */
  giantPrint: {
    z: walkConfig.printZ,
    /** Times the size of the real print; its image center then sits at the walk's eye height there. */
    scale: 36,
    center: [0, 2.2] as const,
    /** It hangs from a wire with two pins (heights m). */
    wire: { height: 6.4, sag: 0.3 },
    /** A slow sway (deg, s) that settles as you come close (m). */
    sway: { amount: 0.5, period: 9, stillWithin: 14 },
    /** Farther than `live[0]` m it shows a still of the sea; nearer than `live[1]` m a live window into it. */
    live: [46, 36] as const,
    /** The still: resolution, and how far in front of the print it is taken from (m, on its axis). */
    still: { resolution: 1024, distance: 41 },
    light: { intensity: 16, distance: 18, height: 5, ahead: 4 },
    poi: { radius: 3, zoom: 0.5 },
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
  },

  /** Washing lines across the alley, pegged with photographs of places further along the walk. */
  lines: {
    /** z at the left wall, height there, z at the right wall, height there, sag (m). */
    spans: [
      [-14.5, 4.6, -15.3, 4.9, 0.5],
      [-18.6, 5.5, -18.0, 5.1, 0.55],
      [-22.6, 4.4, -23.4, 4.8, 0.45],
      [-26.9, 5.9, -26.2, 5.5, 0.55],
      [-30.6, 4.7, -31.3, 5.0, 0.5],
    ] as const,
    /** Prints per line, size (times a real print) and spacing (m along the line). */
    perLine: [5, 4, 6, 4, 5] as const,
    scale: 4.5,
    /** Pegged by their top edge: sway (rad) and period (s). */
    sway: { amount: 0.09, period: 5.5 },
  },

  /** The pictures on the lines and drifting over the sea: views rendered once, before the piece starts. */
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
      { pass: 'dream', position: [0, 1.7, -60] as V3, target: [0, 2.4, -92] as V3, fov: 46 },
      { pass: 'dream', position: [0.2, 1.4, -37] as V3, target: [0, 3.2, -44] as V3, fov: 64 },
      { pass: 'dream', position: [-0.4, 1.9, -50] as V3, target: [0.4, 3.4, -57] as V3, fov: 58 },
      { pass: 'dream', position: [0.4, 1.75, -104] as V3, target: [-20, 40, -200] as V3, fov: 56 },
      { pass: 'dream', position: [0.2, 1.65, -112] as V3, target: [0.15, 1.5, -140] as V3, fov: 44 },
    ],
  },

  /** Things that have forgotten gravity, between the giant chair and the giant print. */
  floating: {
    things: [
      { key: 'wooden_crate', at: [-0.9, 2.6, -48], rotation: [12, 30, 8] },
      { key: 'plastic_crate', at: [0.85, 4.1, -50.5], rotation: [-20, 10, 35] },
      { key: 'manhole', at: [0.1, 7.2, -52], rotation: [80, 0, 12] },
      { key: 'cardboard_box', at: [0.55, 2.95, -53], rotation: [30, 60, -10] },
      {
        key: 'trash_can',
        at: [-1.05, 5.2, -55],
        rotation: [80, 0, 20],
        nodes: ['metal_trash_can', 'metal_trash_can_lid', 'metal_trash_can_handle_left', 'metal_trash_can_handle_right'],
      },
      { key: 'monobloc_chair', at: [1.0, 3.3, -57.5], rotation: [0, 40, 160] },
      { key: 'potted_plant', at: [-0.55, 6.6, -60], rotation: [180, 20, 0] },
      { key: 'trashbag', at: [0.95, 1.5, -61.5], rotation: [0, 70, 25] },
      { key: 'wall_clock', at: [-0.5, 3.7, -63], rotation: [10, 25, 0], scale: 1.6 },
      { key: 'planter_pot', at: [0.6, 5.6, -65], rotation: [-35, 0, 140] },
      { key: 'cardboard_box', at: [-0.9, 2.3, -67], rotation: [-15, 10, 70], scale: 1.3 },
      { key: 'plastic_crate', at: [0.25, 8.4, -69], rotation: [60, 30, 0] },
    ] satisfies FloatingThing[],
    /** Each drifts up and down by `bob` m over its own period (s) and turns at its own rate (deg / s). */
    bob: 0.18,
    period: [7, 13] as const,
    spin: [2, 7] as const,
    /** The chair as large as a child remembers it, standing over the alley (overall width, m). */
    giantChair: { at: [0, 0, -44] as V3, heading: 180, width: 3.5 },
    /** A clock the size of a window over the giant print, its hands running backwards (× real time). */
    giantClock: { at: [0, 9.6, -95.85] as V3, diameter: 2.4, rate: -14 },
  },
} as const;
