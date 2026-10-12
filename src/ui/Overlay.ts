import { LANG, say } from '../config/copy.config';
import { Narration } from './Narration';

/** Timeline position after which the piece counts as started (title gone, scroll hint gone). */
const STARTED_AT = 0.008;
/** The scroll hint waits a moment after the title appears. */
const HINT_DELAY_MS = 1800;

const q = <T extends HTMLElement>(name: string): T => {
  const el = document.querySelector<T>(`[data-ui="${name}"]`);
  if (!el) throw new Error(`missing ui element: ${name}`);
  return el;
};

/** The only DOM UI: a title that dissolves (and returns at the end), the narration, two whispers and a sound switch. */
export class Overlay {
  private readonly bar = q('loader-bar');
  private readonly scrollHint = q('hint-scroll');
  private readonly dragHint = q('hint-drag');
  private readonly sound = q<HTMLButtonElement>('sound');
  private readonly soundLabel = q('sound-label');
  private readonly narration = new Narration();
  private dragHintDone = false;
  private scrollHintArmed = false;

  onSoundToggle: (() => void) | null = null;

  constructor() {
    document.documentElement.lang = LANG;
    q('hint-scroll-label').textContent = say('scroll');
    // on touch screens a sideways swipe looks, an upward one walks
    const touch = window.matchMedia('(pointer: coarse)').matches;
    q('hint-drag-label').textContent = say(touch ? 'dragTouch' : 'drag');
    this.sound.setAttribute('aria-label', say('soundLabel'));
    this.setSound(false);
    this.sound.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onSoundToggle?.();
    });
  }

  /** True for events coming from the sound switch (it handles its own clicks). */
  isSoundButton(target: EventTarget | null): boolean {
    return target instanceof Node && this.sound.contains(target);
  }

  setLoadProgress(fraction: number): void {
    this.bar.style.transform = `scaleX(${fraction.toFixed(3)})`;
  }

  ready(): void {
    document.body.classList.add('is-ready');
    window.setTimeout(() => (this.scrollHintArmed = true), HINT_DELAY_MS);
  }

  /** Called every frame with the visible timeline position. */
  update(progress: number, exploring: boolean, turnedDegrees: number, dragHintAfter: number, ending: boolean): void {
    const started = progress > STARTED_AT;
    document.body.classList.toggle('has-started', started);
    document.body.classList.toggle('is-ending', ending);
    this.scrollHint.classList.toggle('is-visible', this.scrollHintArmed && !started);
    document.body.classList.toggle('is-exploring', exploring);
    if (turnedDegrees > dragHintAfter) this.dragHintDone = true;
    this.dragHint.classList.toggle('is-visible', exploring && !this.dragHintDone);
    this.narration.update(progress);
  }

  setSound(on: boolean): void {
    this.sound.setAttribute('aria-pressed', String(on));
    this.soundLabel.textContent = say(on ? 'soundOn' : 'soundOff');
  }

  fail(message: string): void {
    document.body.classList.add('has-failed');
    const el = document.createElement('div');
    el.className = 'fallback';
    el.textContent = message;
    document.body.appendChild(el);
  }
}
