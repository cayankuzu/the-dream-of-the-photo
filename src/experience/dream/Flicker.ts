import { REDUCED_MOTION } from '../../config/experience.config';
import { randomFrom } from './FigureKit';

/** The least time between two dips of one lamp (s): nothing here ever comes near 3 Hz. */
const LEAST_GAP = 0.45;
/** After a dip a lamp sometimes stutters once more (chance). */
const STUTTER = 0.35;
/** How deep a dip goes: share of the light left at most and at least. */
const DEPTH = [0.03, 0.4] as const;
/** The whole place losing its light: how fast it goes, how fast it comes back (s), and the slower way for those who ask for less motion. */
const FALL = 0.04;
const RISE = 0.28;
const GENTLE = { fall: 0.45, rise: 0.9 };
/** Below this share of its light the place counts as dark: nothing in it can be seen moving. */
const DARK = 0.12;
/** A jump along the walk bigger than this in one frame is a seek, not a walk: no blink falls on it. */
const LARGEST_STEP = 0.02;

/**
 * The life of a failing lamp: steady, and rarely, at no regular interval, a dip of a fraction of a second.
 * Steady for visitors who ask for less motion.
 */
export class Flicker {
  /** 0..1 how much of its light the lamp gives now. */
  level = 1;
  private readonly random: () => number;
  private wait: number;
  private dip = 0;

  /**
   * @param every seconds between dips, least and most
   * @param length seconds a dip lasts, least and most
   */
  constructor(seed: number, private readonly every: readonly [number, number], private readonly length: readonly [number, number] = [0.06, 0.22]) {
    this.random = randomFrom(seed);
    this.wait = this.between(every);
  }

  private between(span: readonly [number, number]): number {
    return span[0] + this.random() * (span[1] - span[0]);
  }

  update(dt: number): void {
    if (REDUCED_MOTION) return;
    if (this.dip > 0) {
      this.dip -= dt;
      if (this.dip > 0) return;
      this.level = 1;
      this.wait = this.random() < STUTTER ? LEAST_GAP : Math.max(LEAST_GAP, this.between(this.every));
      return;
    }
    this.wait -= dt;
    if (this.wait > 0) return;
    this.dip = this.between(this.length);
    this.level = this.between(DEPTH);
  }
}

/** A moment the whole place loses its light: where along the walk, and how long it stays dark (s). */
export interface Blink {
  at: number;
  hold: number;
}

/**
 * The whole place losing its light for an instant at fixed points of the walk. A viewer who only ever looks
 * ahead still has moments of not seeing: this is when the things that move only unseen move in front of them.
 */
export class Blinks {
  /** 0..1 how much of its light the place has now. */
  level = 1;
  /** The dark began this frame. */
  fell = false;
  /** Which blink is running (its place in the list); -1 when none. */
  current = -1;
  /** Seconds since the light began to return (0 until then). */
  returning = 0;
  private t = 0;
  private last = 0;

  constructor(private readonly blinks: readonly Blink[]) {}

  /** The place is dark enough that nothing in it can be seen moving. */
  get dark(): boolean {
    return this.level < DARK;
  }

  update(walk: number, dt: number): void {
    this.fell = false;
    if (Math.abs(walk - this.last) < LARGEST_STEP) {
      for (let i = 0; i < this.blinks.length; i++) {
        if (this.last < this.blinks[i].at !== walk < this.blinks[i].at) {
          this.current = i;
          this.t = 0;
          this.returning = 0;
        }
      }
    }
    this.last = walk;
    if (this.current < 0) return;

    const fall = REDUCED_MOTION ? GENTLE.fall : FALL;
    const rise = REDUCED_MOTION ? GENTLE.rise : RISE;
    const hold = this.blinks[this.current].hold;
    const before = this.t;
    this.t += dt;
    if (before < fall && this.t >= fall) this.fell = true;
    if (this.t < fall) this.level = 1 - this.t / fall;
    else if (this.t < fall + hold) this.level = 0;
    else {
      this.returning = this.t - fall - hold;
      this.level = Math.min(1, this.returning / rise);
      if (this.returning >= rise) {
        this.level = 1;
        this.current = -1;
        this.returning = 0;
      }
    }
  }

  /** Back to the instant of capture. */
  reset(): void {
    this.level = 1;
    this.fell = false;
    this.current = -1;
    this.returning = 0;
    this.t = 0;
    this.last = 0;
  }
}
