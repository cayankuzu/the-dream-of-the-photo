import type { Cue } from '../../config/experience.config';
import { smootherstep } from '../math';
import { cueToProgress } from './Timeline';

interface Key {
  at: number;
  value: number;
}

/** Scalar track through cued keys with eased segments (every key is a deliberate beat). */
export class NumberTrack {
  private readonly keys: Key[];

  constructor(keys: readonly (readonly [Cue, number])[]) {
    this.keys = keys.map(([cue, value]) => ({ at: cueToProgress(cue), value }));
  }

  at(p: number): number {
    const keys = this.keys;
    const last = keys.length - 1;
    if (p <= keys[0].at) return keys[0].value;
    if (p >= keys[last].at) return keys[last].value;
    let i = 0;
    while (i < last && p > keys[i + 1].at) i++;
    const a = keys[i];
    const b = keys[i + 1];
    return a.value + (b.value - a.value) * smootherstep((p - a.at) / (b.at - a.at));
  }
}

/**
 * Scalar curve through keys that never stops between them: a monotone cubic (Fritsch–Carlson), so the
 * speed changes smoothly and nothing overshoots its keys. It eases out of the first key and into the last.
 */
export class GlideTrack {
  private readonly slopes: number[] = [];

  constructor(
    private readonly xs: readonly number[],
    private readonly ys: readonly number[],
  ) {
    const n = xs.length;
    const secant = Array.from({ length: n - 1 }, (_, k) => (ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
    const m = this.slopes;
    m[0] = 0;
    m[n - 1] = 0;
    for (let k = 1; k < n - 1; k++) m[k] = secant[k - 1] * secant[k] > 0 ? (secant[k - 1] + secant[k]) / 2 : 0;
    for (let k = 0; k < n - 1; k++) {
      if (secant[k] === 0) {
        m[k] = m[k + 1] = 0;
        continue;
      }
      const a = m[k] / secant[k];
      const b = m[k + 1] / secant[k];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[k] = t * a * secant[k];
        m[k + 1] = t * b * secant[k];
      }
    }
  }

  at(x: number): number {
    const { xs, ys, slopes: m } = this;
    const last = xs.length - 1;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[last]) return ys[last];
    let k = 0;
    while (k < last - 1 && x > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k];
    const t = (x - xs[k]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
  }
}
