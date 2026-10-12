import { PHASES, timelineConfig, type Cue, type Phase } from '../../config/experience.config';
import { clamp } from '../math';

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

/** 0..1 progress of `p` through `phase` (clamped). */
export function phaseProgress(p: number, phase: Phase): number {
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

/** Timeline position of a [phase, fraction-of-phase] cue (config stays readable when phases move). */
export const cueToProgress = ([phase, t]: Cue): number => phaseStart(phase) + (phaseEnd(phase) - phaseStart(phase)) * t;

export const SHUTTER_PROGRESS = cueToProgress(['CAPTURE', timelineConfig.shutterAt]);

const tempo = timelineConfig.tempo.map((t) => ({ ...t, at: cueToProgress(t.at) }));

/**
 * Scroll is cinematic time: input moves a *target*, the visible timeline follows it
 * with exponential damping, a speed limit and local slow-motion around key beats,
 * so no input can skip a moment or make the picture jump.
 */
export class Timeline {
  target = 0;
  progress = 0;
  private hold = 0;
  private readonly marks = new Map<number, Listener[]>();

  /** Add raw scroll "pixels" (positive = forward). */
  push(pixels: number): void {
    this.target = clamp(this.target + pixels / timelineConfig.scrollLength, 0, 1);
  }

  /** Jump immediately (debug / deep links). */
  seek(p: number): void {
    this.target = this.progress = clamp(p, 0, 1);
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
    const before = this.progress;
    const diff = this.target - this.progress;
    let step = diff * (1 - Math.exp(-timelineConfig.damping * dt));
    const limit = timelineConfig.maxSpeed * this.tempoAt(this.progress) * dt;
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
