import { narration, type Text } from '../config/copy.config';
import { REDUCED_MOTION } from '../config/experience.config';
import { cueToProgress } from '../experience/timeline/Timeline';
import { lang, tr } from './i18n';

const lines = narration.map((l) => ({ from: cueToProgress(l.from), to: cueToProgress(l.to), text: l.text }));

/** The typewriter (s): a letter, how late it may come, and the rests it takes after a comma and after a stop. */
const TYPE = { letter: 0.034, late: 0.03, comma: 0.16, stop: 0.36 };
/** Whatever the pace, the whole line is out by this share of its span: who hurries still reads it. */
const TYPED_BY = 0.45;
/** Pixels the line jumps as the carriage takes a space or a stop (it rests at 0 once typed). */
const JOLT = 1;

/** When each letter of a line strikes (s after the line begins); the same on every visit. */
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
  return times;
}

/**
 * The dream's voice: one line at a time, placed on the timeline, so it comes and goes with the scroll (and
 * comes back when you scroll back). A line is typed on, letter by letter, hesitating at its stops; it
 * leaves on a hard cut. Screen readers get the whole line at once. A language switch shows at once.
 */
export class Narration {
  /** The letters out so far, and the rest (laid out but unseen, so the line never rewraps as it is typed). */
  private readonly typed = document.createTextNode('');
  private readonly rest = document.createTextNode('');
  private current = -1;
  private language = lang();
  private text = '';
  private times: number[] = [];
  /** When the line began (ms), how many letters are out, and where the carriage threw it (px). */
  private began = 0;
  private shown = -1;
  private joltX = 0;
  private joltY = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly voice: HTMLElement,
  ) {
    const unseen = document.createElement('span');
    unseen.className = 'narration__rest';
    unseen.append(this.rest);
    el.append(this.typed, unseen);
  }

  /** A room speaks: from here to there on the timeline. */
  say(text: Text, from: number, to: number): void {
    lines.push({ from, to, text });
  }

  update(progress: number, now: number): void {
    let i = -1;
    for (let k = 0; k < lines.length; k++) {
      if (progress >= lines[k].from && progress <= lines[k].to) {
        i = k;
        break;
      }
    }
    if (i !== this.current) {
      this.current = i;
      this.began = now;
      this.el.classList.toggle('is-speaking', i >= 0);
      if (i >= 0) {
        this.write(i);
        // it lands with a small blow; the carriage takes over from here
        if (!REDUCED_MOTION) this.jolt(JOLT, -JOLT);
      } else {
        this.voice.textContent = '';
      }
    }
    if (i < 0) return;
    if (this.language !== lang()) this.write(i);
    this.type(i, progress, now);
  }

  /** The line in the language showing now (typed as far as it would be by now). */
  private write(i: number): void {
    this.language = lang();
    this.text = tr(lines[i].text);
    this.times = strikes(this.text);
    this.shown = -1;
    this.voice.textContent = this.text;
  }

  private type(i: number, progress: number, now: number): void {
    const count = this.text.length;
    let n = count;
    if (!REDUCED_MOTION) {
      const l = lines[i];
      const elapsed = (now - this.began) / 1000;
      let byTime = 0;
      while (byTime < count && this.times[byTime] <= elapsed) byTime++;
      const byProgress = Math.ceil((((progress - l.from) / (l.to - l.from)) * count) / TYPED_BY);
      n = Math.min(count, Math.max(byTime, byProgress));
    }
    if (n === this.shown) return;
    this.shown = n;
    this.typed.data = this.text.slice(0, n);
    this.rest.data = this.text.slice(n);
    if (REDUCED_MOTION) return;
    // a hard little jump with each blow of the carriage, none once the line is out
    const struck = n > 0 ? this.text[n - 1] : ' ';
    if (n === count) this.jolt(0, 0);
    else if (struck === ' ' || struck === ',' || struck === '.') this.jolt((((n * 7) % 3) - 1) * JOLT, (((n * 5) % 3) - 1) * JOLT);
  }

  private jolt(x: number, y: number): void {
    if (x === this.joltX && y === this.joltY) return;
    this.joltX = x;
    this.joltY = y;
    this.el.style.transform = x === 0 && y === 0 ? '' : `translate(${x}px, ${y}px)`;
  }
}
