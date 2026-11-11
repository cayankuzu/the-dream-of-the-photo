import { PHASES, timelineConfig, type Cue, type Phase } from '../../config/experience.config';
import { COLD_GLIMPSE, isRoom, isWake, JOURNEY, journeySeconds, scriptAt, shownAt, STEP_IDS, type JourneyStep } from '../../config/journey.config';
import { clamp, lerp } from '../math';

export interface PhaseInfo {
  phase: Phase;
  /** 0..1 progress inside the current phase. */
  local: number;
}

type Listener = (direction: 1 | -1) => void;

const starts = PHASES.map((p) => timelineConfig.phaseStart[p]);

/** Normalized timeline position of a phase boundary. */
export function phaseStart(phase: Phase): number {
  return timelineConfig.phaseStart[phase];
}

export function phaseEnd(phase: Phase): number {
  const i = PHASES.indexOf(phase);
  return i < PHASES.length - 1 ? starts[i + 1] : 1;
}

/** Where each step of the journey lies on the timeline, and how far along the walk it begins. */
interface PlacedStep {
  step: JourneyStep;
  index: number;
  from: number;
  to: number;
  /** The walk's fraction at its start and end (a room stands still at one place of the walk). */
  walkFrom: number;
  walkTo: number;
}

export const JOURNEY_STEPS: readonly PlacedStep[] = (() => {
  const a = timelineConfig.phaseStart.WORLD;
  const b = timelineConfig.phaseStart.EXPLORATION;
  let seconds = 0;
  let walk = 0;
  return JOURNEY.map((step, index) => {
    const from = a + ((b - a) * seconds) / journeySeconds;
    seconds += step.seconds;
    const to = a + ((b - a) * seconds) / journeySeconds;
    const walkFrom = 'walk' in step ? step.walk[0] : walk;
    walk = 'walk' in step ? step.walk[1] : walk;
    return { step, index, from, to, walkFrom, walkTo: walk };
  });
})();

/** The step of the journey at `p` (the nearest one outside the journey). */
export function stepAt(p: number): PlacedStep {
  let lo = 0;
  let hi = JOURNEY_STEPS.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (p >= JOURNEY_STEPS[mid].from) lo = mid;
    else hi = mid - 1;
  }
  return JOURNEY_STEPS[lo];
}

/** The room running at `p`, and how far through its own script; null on the walk, in a waking or outside the journey. */
export function roomAt(p: number): { id: string; t: number; step: PlacedStep } | null {
  if (p < phaseStart('WORLD') || p >= phaseStart('EXPLORATION')) return null;
  const s = stepAt(p);
  return isRoom(s.step) ? { id: s.step.room, t: scriptAt(s.step, clamp((p - s.from) / (s.to - s.from), 0, 1)), step: s } : null;
}

/** The moment of the cold open in which the street is seen as it will be (timeline positions). */
const GLIMPSE = COLD_GLIMPSE.map((seconds) => seconds * timelineConfig.autoRate);

/**
 * The street at `p`, seen from outside the dream, and how far through that shot: where an evening broke off
 * (`n` 1 to 6); as it really is, after the ending (`n` 0); as it will be, for a moment of the cold open (`n` 7).
 * Null everywhere else. (See WAKES in film.config.ts.)
 */
export function wakeAt(p: number): { n: number; t: number } | null {
  const street = phaseStart('STREET');
  const credits = phaseStart('CREDITS');
  if (p >= street && p < credits) return { n: 0, t: clamp((p - street) / (credits - street), 0, 1) };
  if (p >= GLIMPSE[0] && p < GLIMPSE[1]) return { n: 7, t: (p - GLIMPSE[0]) / (GLIMPSE[1] - GLIMPSE[0]) };
  if (p < phaseStart('WORLD') || p >= phaseStart('EXPLORATION')) return null;
  const s = stepAt(p);
  return isWake(s.step) ? { n: s.step.wake, t: clamp((p - s.from) / (s.to - s.from), 0, 1) } : null;
}

/** Timeline position `seconds` into the step called `id` (see STEP_IDS), never past its end. */
export function stepProgress(id: string, seconds: number): number {
  const placed = JOURNEY_STEPS[STEP_IDS.indexOf(id)];
  if (!placed) throw new Error(`no such step on the journey: ${id}`);
  return Math.min(placed.to, placed.from + seconds * timelineConfig.autoRate);
}

function walkAt(p: number): number {
  if (p <= phaseStart('WORLD')) return 0;
  if (p >= phaseStart('EXPLORATION')) return 1;
  const s = stepAt(p);
  return lerp(s.walkFrom, s.walkTo, clamp((p - s.from) / (s.to - s.from), 0, 1));
}

/** 0..1 progress of `p` through `phase` (clamped). In WORLD: the fraction of the walk, standing still during rooms. */
export function phaseProgress(p: number, phase: Phase): number {
  if (phase === 'WORLD') return walkAt(p);
  const a = phaseStart(phase);
  const b = phaseEnd(phase);
  return clamp((p - a) / (b - a), 0, 1);
}

/** 0..1 progress of `p` across a span of phases [from.start, to.end]. */
export function spanProgress(p: number, from: Phase, to: Phase): number {
  const a = phaseStart(from);
  const b = phaseEnd(to);
  return clamp((p - a) / (b - a), 0, 1);
}

export function phaseAt(p: number): PhaseInfo {
  let i = PHASES.length - 1;
  while (i > 0 && p < starts[i]) i--;
  const phase = PHASES[i];
  return { phase, local: phaseProgress(p, phase) };
}

/** Timeline position of a cue (config stays readable when phases move). */
export function cueToProgress(cue: Cue): number {
  if (cue[0] === 'STEP') {
    const placed = JOURNEY_STEPS[cue[1]];
    return lerp(placed.from, placed.to, cue[2]);
  }
  if (cue[0] === 'ROOM') {
    const placed = JOURNEY_STEPS.find((s) => isRoom(s.step) && s.step.room === cue[1]);
    if (!placed || !isRoom(placed.step)) throw new Error(`no such room on the journey: ${cue[1]}`);
    return lerp(placed.from, placed.to, shownAt(placed.step, cue[2]));
  }
  const [phase, t] = cue;
  if (phase === 'WORLD') {
    const placed = JOURNEY_STEPS.find((s) => 'walk' in s.step && t <= s.walkTo && t >= s.walkFrom);
    if (placed) return lerp(placed.from, placed.to, (t - placed.walkFrom) / (placed.walkTo - placed.walkFrom));
  }
  return phaseStart(phase) + (phaseEnd(phase) - phaseStart(phase)) * t;
}

export const SHUTTER_PROGRESS = cueToProgress(['CAPTURE', timelineConfig.shutterAt]);

const tempo = timelineConfig.tempo.map((t) => ({ ...t, at: cueToProgress(t.at) }));

/** Seconds the target may run ahead of what is showing, at the fastest allowed; how fast the legs tire (1/s). */
const TARGET_LEAD = 1.5;
const LEGS_FADE = 1.6;

/**
 * Scroll is cinematic time: input moves a *target*, the visible timeline follows it
 * with exponential damping, a speed limit and local slow-motion around key beats,
 * so no input can skip a moment or make the picture jump.
 */
export class Timeline {
  target = 0;
  progress = 0;
  /** The dream moves on by itself (see timelineConfig.autoRate). */
  auto = false;
  /** Nothing the viewer does moves time here (a room that takes control). */
  locked = false;
  /** How far time can go from here: what comes next may not be ready, and the dream does not go back. */
  bounds: readonly [number, number] = [0, 1];
  /** How many times its own pace time may move here. */
  hurry = Infinity;
  /** Forward pushes in the last moments (timeline pixels per second, decaying): the viewer's legs. */
  legs = 0;
  private hold = 0;
  private autoHold = 0;
  private readonly marks = new Map<number, Listener[]>();

  /** Add raw scroll "pixels" (positive = forward). */
  push(pixels: number): void {
    if (this.locked) return;
    this.target = clamp(this.target + pixels / timelineConfig.scrollLength, 0, 1);
    // going back is allowed, for a moment: the dream waits before it pulls you on again
    if (pixels < 0) this.autoHold = timelineConfig.autoHold;
    else this.legs += pixels;
  }

  /** Jump immediately (debug / deep links). */
  seek(p: number): void {
    this.target = this.progress = clamp(p, 0, 1);
    // whatever held time back was about where it used to be
    this.bounds = [0, 1];
  }

  /** Fire `listener` whenever the smoothed timeline crosses `at` (with the crossing direction). */
  onCross(at: number, listener: Listener): void {
    const list = this.marks.get(at) ?? [];
    list.push(listener);
    this.marks.set(at, list);
  }

  /** Freeze the visible timeline for a moment (hit-stop). */
  freeze(seconds: number): void {
    this.hold = Math.max(this.hold, seconds);
  }

  update(dt: number): void {
    if (this.hold > 0) {
      this.hold -= dt;
      return;
    }
    this.autoHold = Math.max(0, this.autoHold - dt);
    this.legs *= Math.exp(-LEGS_FADE * dt);
    if (this.auto && this.autoHold === 0) this.target = Math.min(1, this.target + timelineConfig.autoRate * dt);
    const cap = Math.min(timelineConfig.maxSpeed, this.hurry * timelineConfig.autoRate);
    // what is pushed beyond what it could reach soon is lost: a flick of the wheel does not run on for a minute
    this.target = clamp(this.target, this.bounds[0], Math.min(this.bounds[1], this.progress + cap * TARGET_LEAD));
    const before = this.progress;
    const diff = this.target - this.progress;
    let step = diff * (1 - Math.exp(-timelineConfig.damping * dt));
    const limit = cap * this.tempoAt(this.progress) * dt;
    step = clamp(step, -limit, limit);
    if (Math.abs(diff) < 1e-5) step = diff;
    this.progress += step;
    this.emitCrossings(before, this.progress);
  }

  get info(): PhaseInfo {
    return phaseAt(this.progress);
  }

  private tempoAt(p: number): number {
    let scale = 1;
    for (const t of tempo) {
      const x = (p - t.at) / t.width;
      scale = Math.min(scale, 1 - (1 - t.scale) * Math.exp(-x * x));
    }
    return scale;
  }

  private emitCrossings(a: number, b: number): void {
    if (a === b) return;
    for (const [at, listeners] of this.marks) {
      if ((a < at && b >= at) || (a >= at && b < at)) {
        const dir = b > a ? 1 : -1;
        for (const l of listeners) l(dir);
      }
    }
  }
}
