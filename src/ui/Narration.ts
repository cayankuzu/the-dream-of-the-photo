import type { Text } from '../config/copy.config';
import { REDUCED_MOTION } from '../config/experience.config';
import type { VoiceStyle } from '../config/film.config';
import { lang, tr } from './i18n';

/**
 * The rhythm of the typewriter (s): a letter, how late it may come, and the rests after a comma and after a stop.
 * Only its proportions count: a line is stretched or squeezed to be typed in TYPED_BY of the time it stays.
 */
const TYPE = { letter: 0.034, late: 0.03, comma: 0.16, stop: 0.36 };
/** Share of the time a line stays by which all of it has been typed. */
const TYPED_BY = 0.45;

/** When each letter of a line strikes, as a share of its typing (the first at 0, the last at 1); the same on every visit. */
function strikes(text: string): number[] {
  const times: number[] = [];
  let t = 0;
  let seed = text.length;
  for (let i = 0; i < text.length; i++) {
    times.push(t);
    seed = (seed * 37 + 11) % 101;
    const c = text[i];
    t += TYPE.letter + TYPE.late * (seed / 100) + (c === ',' ? TYPE.comma : c === '.' ? TYPE.stop : 0);
  }
  const last = times[times.length - 1] || 1;
  return times.map((s) => s / last);
}

/**
 * The line at the foot of the picture: what is being said, by whom (the voice shows in how it is set), for as long
 * as it is said. It is typed on, hesitating at its stops, and leaves on a hard cut; a new line replaces it at once.
 * Screen readers get the whole line at once. A language switch shows at once.
 */
export class Narration {
  /** The letters out so far, and the rest (laid out but unseen, so the line never rewraps as it is typed). */
  private readonly typed = document.createTextNode('');
  private readonly rest = document.createTextNode('');
  private line: Text | null = null;
  /** How long the line stays, and how long it has been up (s; the time behind the menu does not count). */
  private seconds = 0;
  private elapsed = 0;
  private language = lang();
  private text = '';
  private times: number[] = [];
  private shown = -1;

  constructor(
    private readonly el: HTMLElement,
    private readonly voice: HTMLElement,
  ) {
    const unseen = document.createElement('span');
    unseen.className = 'narration__rest';
    unseen.append(this.rest);
    el.append(this.typed, unseen);
  }

  /** A line said now, for `seconds`, in the voice `style`; null takes the one showing away. */
  show(text: Text | null, seconds: number, style: VoiceStyle): void {
    if (!text || seconds <= 0) {
      this.clear();
      return;
    }
    this.line = text;
    this.seconds = seconds;
    this.elapsed = 0;
    this.el.dataset.voice = style;
    this.el.classList.add('is-speaking');
    this.write();
  }

  /** Every frame: `dt` seconds of the film have passed (none while it is paused). */
  update(dt: number): void {
    if (!this.line) return;
    this.elapsed += dt;
    if (this.elapsed >= this.seconds) {
      this.clear();
      return;
    }
    if (this.language !== lang()) this.write();
    this.type();
  }

  private clear(): void {
    if (!this.line) return;
    this.line = null;
    this.el.classList.remove('is-speaking');
    this.typed.data = '';
    this.rest.data = '';
    this.voice.textContent = '';
  }

  /** The line in the language showing now (typed as far as it would be by now). */
  private write(): void {
    this.language = lang();
    this.text = tr(this.line!);
    this.times = strikes(this.text);
    this.shown = -1;
    this.voice.textContent = this.text;
    this.type();
  }

  private type(): void {
    const count = this.text.length;
    let n = count;
    if (!REDUCED_MOTION) {
      const share = this.elapsed / (this.seconds * TYPED_BY);
      n = 0;
      while (n < count && this.times[n] <= share) n++;
    }
    if (n === this.shown) return;
    this.shown = n;
    this.typed.data = this.text.slice(0, n);
    this.rest.data = this.text.slice(n);
  }
}
