import { narration, narrationFade } from '../config/copy.config';
import { smootherstep } from '../experience/math';
import { cueToProgress } from '../experience/timeline/Timeline';
import { lang, tr } from './i18n';

const lines = narration.map((l) => ({ from: cueToProgress(l.from), to: cueToProgress(l.to), text: l.text }));
/** Visible change below which the line's style is left alone (no style writes on still frames). */
const STEP = 0.004;
/** Rise (rem) and blur (px) of a line while it is still arriving or already leaving. */
const RISE = 0.5;
const BLUR = 5;

/**
 * The dream's voice, set like a game's subtitles: one line at a time, placed on the timeline, so it
 * comes and goes with the scroll (and comes back when you scroll back). A line surfaces out of a blur
 * and sinks back into it.
 */
export class Narration {
  private current = -1;
  private written = '';
  private shown = -1;

  constructor(private readonly el: HTMLElement) {}

  update(progress: number): void {
    const i = lines.findIndex((l) => progress >= l.from && progress <= l.to);
    let visible = 0;
    if (i >= 0) {
      const l = lines[i];
      const t = (progress - l.from) / (l.to - l.from);
      visible = smootherstep(Math.min(t, 1 - t) / narrationFade);
      // the line, in the language showing now
      const key = `${i}:${lang()}`;
      if (key !== this.written) {
        this.written = key;
        this.current = i;
        this.el.textContent = tr(l.text);
      }
    }
    this.el.classList.toggle('is-speaking', visible > 0 && this.current >= 0);
    if (visible === this.shown || (Math.abs(visible - this.shown) < STEP && visible !== 0 && visible !== 1)) return;
    this.shown = visible;
    const s = this.el.style;
    s.opacity = visible.toFixed(3);
    s.transform = `translate(-50%, ${((1 - visible) * RISE).toFixed(3)}rem)`;
    s.filter = visible > 0.995 ? 'none' : `blur(${((1 - visible) * BLUR).toFixed(2)}px)`;
  }
}
