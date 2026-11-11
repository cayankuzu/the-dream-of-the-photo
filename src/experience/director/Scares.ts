import { BackSide, BoxGeometry, Group, HalfFloatType, Mesh, MeshBasicMaterial, PerspectiveCamera, WebGLRenderTarget } from 'three';
import { LAYERS, REDUCED_MOTION, renderConfig } from '../../config/experience.config';
import type { AudioEngine } from '../audio/AudioEngine';
import { randomFrom, type FigureSpec } from '../dream/FigureKit';
import type { DreamLight } from '../dream/LightPool';
import { damp, DEG, lerp, range, smootherstep } from '../math';
import type { DreamFx } from '../render/Pipeline';
import { phaseProgress, SHUTTER_PROGRESS, type Timeline } from '../timeline/Timeline';
import { GlideTrack } from '../timeline/Track';
import type { DreamDirector } from './DreamDirector';

type V3 = readonly [number, number, number];

/** The color of the glow in each kind of air. */
const NEUTRAL: V3 = [1, 1, 1];
const DUSK: V3 = [1.12, 0.92, 0.74];
const COLD: V3 = [0.66, 0.84, 1.2];
const SAFELIGHT: V3 = [1.3, 0.32, 0.22];
const WET: V3 = [1.15, 0.72, 0.62];

/** How the film looks at one point of the way (see DreamFx for what each channel means). */
interface Look {
  /** Fraction of the walk; past 1, 1 + fraction of EXPLORATION (the waking). */
  at: number;
  bloom: number;
  /** Linear light above which things glow. */
  from: number;
  tint: V3;
  ghost: number;
  aberration: number;
  barrel: number;
  scratches: number;
  weave: number;
  flicker: number;
  grain: number;
  burn: number;
}

const REST: Omit<Look, 'at'> = { bloom: 0, from: 1, tint: NEUTRAL, ghost: 0, aberration: 0, barrel: 0, scratches: 0, weave: 0, flicker: 0, grain: 0, burn: 0 };

/** The look along the way: each space has its own film stock. Whatever a key does not name is at rest there. */
const LOOK: readonly Look[] = [
  // the way in stays exactly as it was
  { ...REST, at: 0 },
  { ...REST, at: 0.025 },
  // alley: faint
  { ...REST, at: 0.075, bloom: 0.22, scratches: 0.05, grain: 0.1 },
  { ...REST, at: 0.175, bloom: 0.26, scratches: 0.1, grain: 0.22, weave: 0.0004 },
  // street: grain, a slight weave, scratches rising
  { ...REST, at: 0.215, bloom: 0.3, tint: DUSK, scratches: 0.16, grain: 0.5, weave: 0.0007, flicker: 0.02 },
  { ...REST, at: 0.325, bloom: 0.32, tint: DUSK, scratches: 0.45, grain: 0.65, weave: 0.0012, flicker: 0.05 },
  // hall: a strong cold bloom from the slit, little else: enormous stillness
  { ...REST, at: 0.36, bloom: 1, from: 0.85, tint: COLD, scratches: 0.05, grain: 0.12 },
  { ...REST, at: 0.515, bloom: 1.1, from: 0.85, tint: COLD, scratches: 0.07, grain: 0.18 },
  // darkroom: red bloom, scratches, the first trails
  { ...REST, at: 0.545, bloom: 1.1, from: 0.3, tint: SAFELIGHT, ghost: 0.25, scratches: 0.4, grain: 0.3, weave: 0.0006, flicker: 0.04 },
  { ...REST, at: 0.625, bloom: 1.2, from: 0.3, tint: SAFELIGHT, ghost: 0.25, scratches: 0.5, grain: 0.35, weave: 0.0008, flicker: 0.05 },
  // flesh: the lens swells with the heart, colors part, everything wet glows
  { ...REST, at: 0.655, bloom: 0.85, from: 0.55, tint: WET, ghost: 0.3, aberration: 0.008, barrel: 0.07, scratches: 0.25, grain: 0.35, weave: 0.0008, flicker: 0.05 },
  { ...REST, at: 0.73, bloom: 1, from: 0.5, tint: WET, ghost: 0.3, aberration: 0.014, barrel: 0.11, scratches: 0.35, grain: 0.45, weave: 0.0012, flicker: 0.08 },
  // void: almost nothing but long trails and heavy grain
  { ...REST, at: 0.77, ghost: 0.55, grain: 1.2 },
  { ...REST, at: 0.885, ghost: 0.55, grain: 1.35 },
  // sea: a big bloom, a slight split
  { ...REST, at: 0.915, bloom: 1.15, tint: DUSK, aberration: 0.004, scratches: 0.05, grain: 0.25 },
  { ...REST, at: 0.975, bloom: 1.2, tint: DUSK, aberration: 0.005, scratches: 0.14, grain: 0.3, weave: 0.0005 },
  // the photographer waits: the film starts to go
  { ...REST, at: 1, bloom: 1.2, tint: DUSK, aberration: 0.006, scratches: 0.3, grain: 0.45, weave: 0.001, flicker: 0.04 },
  // waking: the damage grows heavy, the film jams and burns, then the end
  { ...REST, at: 1.0257, bloom: 0.9, scratches: 0.45, grain: 0.5, weave: 0.0012, flicker: 0.05 },
  { ...REST, at: 1.3, bloom: 0.5, from: 0.9, scratches: 0.6, grain: 0.6, weave: 0.0016, flicker: 0.07 },
  { ...REST, at: 1.76, bloom: 0.5, from: 0.9, scratches: 0.9, grain: 0.9, weave: 0.0024, flicker: 0.1 },
  { ...REST, at: 1.985, bloom: 0.6, from: 0.9, scratches: 1, grain: 1.1, weave: 0.004, flicker: 0.14, burn: 0.45 },
];

const lookTrack = (pick: (key: Look) => number) =>
  new GlideTrack(
    LOOK.map((k) => k.at),
    LOOK.map(pick),
  );

const TRACK = {
  bloom: lookTrack((k) => k.bloom),
  from: lookTrack((k) => k.from),
  tintR: lookTrack((k) => k.tint[0]),
  tintG: lookTrack((k) => k.tint[1]),
  tintB: lookTrack((k) => k.tint[2]),
  ghost: lookTrack((k) => k.ghost),
  aberration: lookTrack((k) => k.aberration),
  barrel: lookTrack((k) => k.barrel),
  scratches: lookTrack((k) => k.scratches),
  weave: lookTrack((k) => k.weave),
  flicker: lookTrack((k) => k.flicker),
  grain: lookTrack((k) => k.grain),
  burn: lookTrack((k) => k.burn),
};

export const scaresConfig = {
  /** One frame of the film (s): the cuts are counted in these, whatever the screen's own rate. */
  frame: 1 / 24,
  /** Fear and the heart reach the picture over this much of the walk (none before it: the way in is exact). */
  presence: 0.03,
  /** Fear lifts each channel of the look by this share at full fear. */
  fear: { bloom: 0.2, scratches: 0.7, weave: 0.8, flicker: 1, aberration: 0.5 },
  /** The lens rests at this share of its bulge between heartbeats, and swells toward the beat at this rate (1/s): it heaves, it does not jump. */
  barrelFloor: 0.3,
  swellRate: 16,
  /** A timeline step larger than this (progress) is a jump, not a passing: nothing falls. */
  jump: 0.03,
  /** A cut-in picture is a piece of another, worse film: the damage and the gate's jump while it shows. */
  splice: { scratches: 0.75, weave: 0.003, grain: 0.8 },

  /** At the first shutter: the crowd behind the photographer, over the flash (film frames). */
  shutter: { frames: 2 },
  /**
   * The street goes dark: the fall and the dark (s), then the lights struggle back over `back` s through these
   * levels (one dip, its cycle no shorter than a third of a second: under 3 Hz). `veil` is how far even
   * what shines by itself goes dark with it; `fear` is added to the fear.
   */
  blackout: { at: 0.27, fall: 0.05, hold: 0.35, back: 0.5, backAt: [0, 0.16, 0.33, 0.5], backTo: [0, 0.62, 0.08, 1], veil: 0.9, fear: 0.3 },
  /** The stinger at the screens: the face (film frames), then the negative, fading (s). */
  screens: { at: 0.49, frames: 1, negative: 0.15, fear: 0.25 },
  /** The teeth close behind you: dark (s) and its lift (s), and a kick to the gate and the lens that dies at `rate` (1/s), gone after `over` s. */
  teeth: { at: 0.7497, hold: 0.2, lift: 0.05, veil: 0.97, fear: 0.2, kick: { weave: 0.012, barrel: 0.3, rate: 4, over: 1.2 } },
  /** Through the giant print: the face, closest of all (film frames). */
  face: { at: 0.893, frames: 1, fear: 0.2 },
  /** The end: black, at this fraction of EXPLORATION, until the viewer goes back or starts over. */
  end: { at: 0.985 },

  /**
   * Small sags of the exposure, seeded along the walk, each only if the piece is afraid enough by then (`need`):
   * walk gap between them, their length (s), their depth at no fear and at full fear. None in the void.
   */
  dips: { seed: 41, from: 0.05, to: 0.98, gap: [0.045, 0.11], need: [0.12, 0.8], seconds: [0.1, 0.3], depth: [0.2, 0.6], none: [0.74, 0.895] },

  /** For those who ask for less motion: no cuts, no negative, no kick, slow dark instead of a blow. */
  reduced: {
    scale: { weave: 0.15, barrel: 0.2, flicker: 0.25, aberration: 0.5, scratches: 0.6 },
    dip: { seconds: 0.8, depth: 0.3 },
    blackout: { fall: 0.45, hold: 0.35, back: 1.1 },
    teeth: { fall: 0.3, hold: 0.2, back: 0.8 },
  },

  /** What only the cut-in pictures see. */
  stage: {
    /** Under the alley, far below everything: the dream pass sees it there, and nothing else ever does. */
    at: [0, -500, -8] as V3,
    /** Side of a picture (px). */
    resolution: 512,
    seed: 23,
    /** The people, shuffled through the ranks. The first is the one in the middle of the front rank: the close-ups are of him. */
    bodies: [
      { avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 0, face: 'scratched' },
      { avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 3.8, face: 'scratched' },
      { avatar: 'figure_woman', clip: 'f_idle_touch_hair_01', time: 0, face: 'scratched' },
      { avatar: 'figure_nurse', clip: 'f_idle_touch_hair_01', time: 0, face: 'scratched' },
      { avatar: 'figure_woman', clip: 'f_idle_touch_hair_01', time: 0, face: 'scratched', veil: true },
    ] satisfies readonly FigureSpec[] as readonly FigureSpec[],
    /** Ranks going back from the lens, their distance apart (m), the spacing of bodies (m), how loosely they stand (m). */
    ranks: 12,
    rankDepth: 0.75,
    spacing: 0.6,
    jitter: 0.14,
    /** How far from dead on the lens each one looks (rad), how much their heights differ (share), and how far past the frame's sides they go on (share). */
    turn: 0.06,
    heights: 0.03,
    overscan: 1.05,
    /** The flash is all the light there is: the evening's reflections stay at this share. */
    ambient: 0.2,
    flashColor: 0xfff4e8,
    /** Side of the black room around it all (m): the dream's sky must not show. */
    room: 80,
    /**
     * The pictures, in the stage's own meters (the man in the middle stands at its origin, facing +Z; his nose at
     * [0, 1.64, 0.15], measured). A square frame that the screen crops: what matters lies in its middle.
     * lens, target, fov (deg); the flash: its offset from the lens (m), candela, reach (m). The flash is sized to
     * put his face near white (at this distance, with his plaster's albedo of about .5); the ranks fall into the dark behind him.
     */
    pictures: {
      crowd: { lens: [0, 2.15, 1.35] as V3, target: [0, 1, -3] as V3, fov: 66, from: [0.06, 0.12, 0] as V3, flash: 32, reach: 11 },
      face: { lens: [0.001, 1.655, 0.7] as V3, target: [0.001, 1.655, 0] as V3, fov: 44, from: [0.04, 0.07, 0] as V3, flash: 4.4, reach: 5 },
      closest: { lens: [0.001, 1.672, 0.27] as V3, target: [0.001, 1.672, 0] as V3, fov: 58, from: [0.015, 0.03, 0] as V3, flash: 0.42, reach: 2 },
    },
  },
} as const;

const C = scaresConfig;
const R = C.reduced;

/** Slowly down into the dark, slowly back: 1 before it and after it. */
function gentleDark(t: number, shape: { readonly fall: number; readonly hold: number; readonly back: number }): number {
  if (t < shape.fall) return 1 - smootherstep(t / shape.fall);
  return smootherstep((t - shape.fall - shape.hold) / shape.back);
}

export interface ScareContext {
  timeline: Timeline;
  audio: AudioEngine;
  dream: DreamDirector;
  fx: DreamFx;
}

/** Something that falls once as the walk passes it going forward, and is ready again when the viewer goes back before it. */
interface Blow {
  at: number;
  armed: boolean;
  fall: () => void;
}

/** A picture of the stage, and how it is taken. */
interface Picture {
  target: WebGLRenderTarget;
  lens: PerspectiveCamera;
  shot: (typeof C.stage.pictures)[keyof typeof C.stage.pictures];
}

/**
 * What frightens: each space's own film stock, and the blows that fall at fixed points of the way. It writes
 * `fx` and the dream's light every frame; all of it rests until the walk begins (the way into the photograph is
 * exact), except for the two frames of the shutter.
 */
export class Scares {
  private readonly stage = new Group();
  private readonly flash: DreamLight;
  private readonly crowd: Picture;
  private readonly face: Picture;
  private readonly closest: Picture;
  private readonly blows: Blow[] = [];
  private readonly lightsBack = new GlideTrack(C.blackout.backAt, C.blackout.backTo);

  /** Seconds since each blow fell (Infinity: it is not running; adding to Infinity keeps it so). */
  private sinceBlackout = Infinity;
  private sinceTeeth = Infinity;
  private sinceScreens = Infinity;
  private sinceDip = Infinity;
  /** The lights are still to come back: its sound is owed. */
  private lightsOwed = false;
  private dipSeconds = 1;
  private dipDepth = 0;
  /** Seconds left of the picture being cut in. */
  private cutLeft = 0;
  private endArmed = true;
  private lastP = 0;
  private lastWalk = 0;
  /** The beat, as the lens feels it. */
  private swell = 0;

  /** The journey's cut between steps: how much it covers the picture, and with what. */
  readonly journeyCut = { cover: 0, white: false };

  constructor(private readonly ctx: ScareContext) {
    const S = C.stage;
    this.flash = ctx.dream.kit.lights.add([S.at[0], S.at[1], S.at[2]], S.flashColor, 0, 1);
    this.buildStage();
    this.crowd = this.picture(S.pictures.crowd);
    this.face = this.picture(S.pictures.face);
    this.closest = this.picture(S.pictures.closest);

    ctx.timeline.onCross(SHUTTER_PROGRESS, (direction) => {
      if (direction < 0) return;
      ctx.audio.scare('crowd');
      this.cut(this.crowd, C.shutter.frames);
    });
    const blow = (at: number, fall: () => void) => this.blows.push({ at, armed: true, fall });
    blow(C.blackout.at, () => this.fallBlackout());
    blow(C.screens.at, () => this.fallScreens());
    blow(C.teeth.at, () => this.fallTeeth());
    blow(C.face.at, () => this.fallFace());
    this.seedDips(blow);
  }

  // ------------------------------------------------------------------ the pictures

  /** People standing right behind where the photographer stands, with nothing for faces, looking at the lens. */
  private buildStage(): void {
    const S = C.stage;
    const random = randomFrom(S.seed);
    const places: { x: number; z: number; heading: number; height: number }[][] = S.bodies.map(() => []);
    places[0].push({ x: 0, z: 0, heading: 0, height: 1 });
    const lens = S.pictures.crowd.lens;
    const reach = Math.tan((S.pictures.crowd.fov / 2) * DEG) * S.overscan;
    for (let rank = 0; rank < S.ranks; rank++) {
      const z = -rank * S.rankDepth;
      const side = (lens[2] - z) * reach;
      const count = Math.ceil((2 * side) / S.spacing);
      for (let i = 0; i <= count; i++) {
        const x = -side + (i + (rank % 2) * 0.5) * S.spacing + (random() - 0.5) * S.jitter;
        const at = z + (random() - 0.5) * S.jitter;
        const who = Math.floor(random() * S.bodies.length);
        const heading = Math.atan2(lens[0] - x, lens[2] - at) + (random() - 0.5) * S.turn;
        const height = 1 + (random() - 0.5) * S.heights;
        // the place in the middle of the front rank is taken
        if (rank === 0 && Math.abs(x) < S.spacing * 0.75) continue;
        places[who].push({ x, z: at, heading, height });
      }
    }
    S.bodies.forEach((spec, k) => {
      const crowd = this.ctx.dream.kit.figures.crowd(spec, places[k].length);
      places[k].forEach((b, i) => crowd.set(i, b.x, 0, b.z, b.heading, b.height));
      crowd.commit();
      this.stage.add(crowd.root);
    });
    this.stage.add(new Mesh(new BoxGeometry(S.room, S.room, S.room), new MeshBasicMaterial({ color: 0, side: BackSide, fog: false })));
    this.stage.position.set(S.at[0], S.at[1], S.at[2]);
    // the director has been through the dream already: what is added now sees to this itself
    this.stage.traverse((o) => {
      o.layers.set(LAYERS.DREAM);
      o.frustumCulled = false;
    });
    this.stage.visible = false;
    this.ctx.dream.stage.add(this.stage);
  }

  private picture(shot: Picture['shot']): Picture {
    const [x, y, z] = C.stage.at;
    const target = new WebGLRenderTarget(C.stage.resolution, C.stage.resolution, { type: HalfFloatType, samples: renderConfig.denseSamples });
    const lens = new PerspectiveCamera(shot.fov, 1, renderConfig.near, renderConfig.far);
    lens.position.set(x + shot.lens[0], y + shot.lens[1], z + shot.lens[2]);
    lens.lookAt(x + shot.target[0], y + shot.target[1], z + shot.target[2]);
    lens.layers.set(LAYERS.WORLD);
    lens.layers.enable(LAYERS.DREAM);
    return { target, lens, shot };
  }

  /** Once, after the shaders compile: the pictures that will be cut in. */
  develop(): void {
    const { dream } = this.ctx;
    this.stage.visible = true;
    dream.dim = C.stage.ambient;
    for (const { target, lens, shot } of [this.crowd, this.face, this.closest]) {
      this.flash.position.set(lens.position.x + shot.from[0], lens.position.y + shot.from[1], lens.position.z + shot.from[2]);
      this.flash.intensity = shot.flash / C.stage.ambient;
      this.flash.distance = shot.reach;
      dream.kit.renderDream(target, lens);
    }
    this.flash.intensity = 0;
    dream.dim = 1;
    this.stage.visible = false;
  }

  // ------------------------------------------------------------------ the blows

  /** Sags of the exposure along the way, tied to how afraid the piece is by then. */
  private seedDips(blow: (at: number, fall: () => void) => void): void {
    const D = C.dips;
    const random = randomFrom(D.seed);
    for (let at = lerp(D.from, D.from + D.gap[1], random()); at < D.to; at += lerp(D.gap[0], D.gap[1], random())) {
      const need = lerp(D.need[0], D.need[1], random());
      const seconds = lerp(D.seconds[0], D.seconds[1], random());
      if (at > D.none[0] && at < D.none[1]) continue;
      blow(at, () => {
        const { fear } = this.ctx.dream;
        if (fear >= need) this.dipNow(seconds, lerp(D.depth[0], D.depth[1], fear));
      });
    }
  }

  private dipNow(seconds: number, depth: number): void {
    this.sinceDip = 0;
    this.dipSeconds = REDUCED_MOTION ? Math.max(seconds, R.dip.seconds) : seconds;
    this.dipDepth = REDUCED_MOTION ? Math.min(depth, R.dip.depth) : depth;
  }

  /** A picture cut into the film, for this many of its frames; for those who ask for less motion, only a sag of the light. */
  private cut(picture: Picture, frames: number): void {
    if (REDUCED_MOTION) {
      this.dipNow(R.dip.seconds, R.dip.depth);
      return;
    }
    this.ctx.fx.insert = picture.target.texture;
    this.cutLeft = frames * C.frame;
  }

  private fallBlackout(): void {
    this.sinceBlackout = 0;
    this.lightsOwed = true;
    this.ctx.audio.scare('blackout');
    this.ctx.dream.fearBoost += C.blackout.fear;
  }

  private fallScreens(): void {
    this.sinceScreens = 0;
    this.ctx.audio.scare('screens');
    this.ctx.dream.fearBoost += C.screens.fear;
    this.cut(this.face, C.screens.frames);
  }

  private fallTeeth(): void {
    this.sinceTeeth = 0;
    this.ctx.audio.scare('teeth');
    this.ctx.dream.fearBoost += C.teeth.fear;
  }

  private fallFace(): void {
    this.ctx.audio.scare('face');
    this.ctx.dream.fearBoost += C.face.fear;
    this.cut(this.closest, C.face.frames);
  }

  /** How much light the street has: down fast, nothing, then back in fits. */
  private blackoutLight(): number {
    const B = C.blackout;
    const t = this.sinceBlackout;
    if (REDUCED_MOTION) return gentleDark(t, R.blackout);
    if (t < B.fall) return 1 - t / B.fall;
    const back = t - B.fall - B.hold;
    if (back < 0) return 0;
    return back < B.back ? this.lightsBack.at(back) : 1;
  }

  private teethLight(): number {
    const T = C.teeth;
    if (REDUCED_MOTION) return gentleDark(this.sinceTeeth, R.teeth);
    return range(T.hold, T.hold + T.lift, this.sinceTeeth);
  }

  // ------------------------------------------------------------------ per frame

  /** The film's stock at this point of the way, and what fear and the heart do to it. */
  private writeLook(along: number, walk: number, dt: number): void {
    const { fx, dream } = this.ctx;
    const F = C.fear;
    const presence = smootherstep(walk / C.presence);
    const fear = dream.fear * presence;
    fx.fear = fear;
    fx.heartbeat = dream.heartbeat * presence;
    fx.bloom = TRACK.bloom.at(along) * (1 + fear * F.bloom);
    fx.bloomFrom = TRACK.from.at(along);
    fx.bloomTint.setRGB(TRACK.tintR.at(along), TRACK.tintG.at(along), TRACK.tintB.at(along));
    fx.ghost = TRACK.ghost.at(along);
    fx.aberration = TRACK.aberration.at(along) * (1 + fear * F.aberration);
    this.swell = damp(this.swell, fx.heartbeat, C.swellRate, dt);
    fx.barrel = TRACK.barrel.at(along) * (C.barrelFloor + (1 - C.barrelFloor) * this.swell);
    fx.scratches = Math.min(1, TRACK.scratches.at(along) * (1 + fear * F.scratches));
    fx.weave = TRACK.weave.at(along) * (1 + fear * F.weave);
    fx.flicker = TRACK.flicker.at(along) * (1 + fear * F.flicker);
    fx.grain = TRACK.grain.at(along);
    fx.burn = TRACK.burn.at(along);
    const room = dream.room;
    if (room) {
      const f = room.film;
      fx.bloom = (f.bloom ?? 0) * (1 + fear * F.bloom);
      fx.bloomFrom = f.bloomFrom ?? REST.from;
      const tint = f.bloomTint ?? NEUTRAL;
      fx.bloomTint.setRGB(tint[0], tint[1], tint[2]);
      fx.ghost = f.ghost ?? 0;
      fx.aberration = (f.aberration ?? 0) * (1 + fear * F.aberration);
      fx.barrel = (f.barrel ?? 0) * (C.barrelFloor + (1 - C.barrelFloor) * this.swell);
      fx.scratches = Math.min(1, (f.scratches ?? 0) * (1 + fear * F.scratches));
      fx.weave = (f.weave ?? 0) * (1 + fear * F.weave);
      fx.flicker = (f.flicker ?? 0) * (1 + fear * F.flicker);
      fx.grain = f.grain ?? 0.2;
      fx.burn = f.burn ?? 0;
    }
  }

  /** What the blows running now do on top of it. */
  private writeBlows(ended: boolean, dt: number): void {
    const { fx, dream } = this.ctx;
    const blackout = this.blackoutLight();
    const teeth = this.teethLight();
    dream.dim = Math.min(blackout, teeth);
    fx.black = ended ? 1 : Math.max((1 - blackout) * C.blackout.veil, (1 - teeth) * C.teeth.veil, this.journeyCut.white ? 0 : this.journeyCut.cover, dream.room?.black ?? 0);
    fx.white = Math.max(this.journeyCut.white ? this.journeyCut.cover : 0, dream.room?.white ?? 0);
    // over: nothing is left to spill or to linger
    if (ended) fx.bloom = fx.ghost = 0;
    fx.dip = this.sinceDip < this.dipSeconds ? this.dipDepth * Math.sin((Math.PI * this.sinceDip) / this.dipSeconds) : 0;

    const K = C.teeth.kick;
    if (!REDUCED_MOTION && this.sinceTeeth < K.over) {
      const kick = Math.exp(-K.rate * this.sinceTeeth);
      fx.weave += K.weave * kick;
      fx.barrel += K.barrel * kick;
    }

    // to the nearest frame of the screen
    const showing = this.cutLeft > dt / 2;
    fx.insertMix = showing ? 1 : 0;
    if (showing) {
      const P = C.splice;
      fx.scratches = Math.max(fx.scratches, P.scratches);
      fx.weave = Math.max(fx.weave, P.weave);
      fx.grain += P.grain;
    }
    this.cutLeft = Math.max(0, this.cutLeft - dt);
    // the face is gone and the picture has turned inside out: it comes back by itself
    const after = this.sinceScreens - C.screens.frames * C.frame;
    fx.negative = !REDUCED_MOTION && after >= 0 && after < C.screens.negative ? 1 - after / C.screens.negative : 0;
  }

  update(p: number, walk: number, _time: number, dt: number, paused: boolean, street = false): void {
    const { fx, audio } = this.ctx;
    if (paused) {
      // the picture holds still behind the menu; a cut does not hold
      this.cutLeft = 0;
      fx.insertMix = 0;
      return;
    }
    if (walk > 0 || this.cutLeft > 0) fx.film += dt;
    this.sinceBlackout += dt;
    this.sinceTeeth += dt;
    this.sinceScreens += dt;
    this.sinceDip += dt;

    // starting over: nothing carries back into the way in
    if (walk === 0 && this.lastWalk > 0) {
      this.sinceBlackout = this.sinceTeeth = this.sinceScreens = this.sinceDip = Infinity;
      this.lightsOwed = false;
    }
    this.lastWalk = walk;

    const jumped = Math.abs(p - this.lastP) > C.jump;
    this.lastP = p;
    for (const b of this.blows) {
      if (walk < b.at) b.armed = true;
      else if (b.armed) {
        b.armed = false;
        if (!jumped) b.fall();
      }
    }
    if (this.lightsOwed && this.sinceBlackout >= (REDUCED_MOTION ? R.blackout.fall + R.blackout.hold : C.blackout.fall + C.blackout.hold)) {
      this.lightsOwed = false;
      audio.scare('lightsBack');
    }

    // in the street between two evenings (and after the credits) the film is whole again
    const e = phaseProgress(p, 'EXPLORATION');
    const ended = e >= C.end.at && !street;
    if (!ended) this.endArmed = true;
    else if (this.endArmed) {
      this.endArmed = false;
      if (!jumped) audio.scare('slam');
    }

    this.writeLook(street ? 0 : e > 0 ? 1 + e : walk, street ? 0 : walk, dt);
    this.writeBlows(ended, dt);

    if (REDUCED_MOTION) {
      const S = R.scale;
      fx.weave *= S.weave;
      fx.barrel *= S.barrel;
      fx.flicker *= S.flicker;
      fx.aberration *= S.aberration;
      fx.scratches *= S.scratches;
    }
  }
}
