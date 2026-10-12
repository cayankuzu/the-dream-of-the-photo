import { LANG, narration, narrationFade } from '../config/copy.config';
import { smootherstep } from '../experience/math';
import { cueToProgress } from '../experience/timeline/Timeline';

const lines = narration.map((l) => ({ from: cueToProgress(l.from), to: cueToProgress(l.to), text: l.text[LANG] }));
/** Visible change below which the line's style is left alone (no style writes on still frames). */
const STEP = 0.004;
/** Rise (rem) and blur (px) of a line while it is still arriving or already leaving. */
const RISE = 0.5;
const BLUR = 5;

/**
 * The dream's voice: one line at a time, placed on the timeline, so it comes and goes with the scroll
 * (and comes back when you scroll back). A line surfaces out of a blur and sinks back into it.
 */
export class Narration {
  private readonly el: HTMLElement;
  private current = -1;
  private shown = -1;

  constructor() {
    const el = document.querySelector<HTMLElement>('[data-ui="narration"]');
    if (!el) throw new Error('missing ui element: narration');
    this.el = el;
  }

  update(progress: number): void {
    const i = lines.findIndex((l) => progress >= l.from && progress <= l.to);
    let visible = 0;
    if (i >= 0) {
      const l = lines[i];
      const t = (progress - l.from) / (l.to - l.from);
      visible = smootherstep(Math.min(t, 1 - t) / narrationFade);
      if (i !== this.current) {
        this.current = i;
        this.el.textContent = l.text;
      }
    }
    if (Math.abs(visible - this.shown) < STEP && visible !== 0 && visible !== 1) return;
    if (visible === this.shown) return;
    this.shown = visible;
    const s = this.el.style;
    s.opacity = visible.toFixed(3);
    s.transform = `translate(-50%, ${((1 - visible) * RISE).toFixed(3)}rem)`;
    s.filter = visible > 0.995 ? 'none' : `blur(${((1 - visible) * BLUR).toFixed(2)}px)`;
  }
}
