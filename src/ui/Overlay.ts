import { chapters, memories, type Lang, type MemoryId, type UiKey } from '../config/copy.config';
import { scaresConfig } from '../experience/director/Scares';
import { cueToProgress } from '../experience/timeline/Timeline';
import { lang, onLang, percent, say, setLang, tr } from './i18n';
import { Narration } from './Narration';

/** Timeline position after which the piece counts as started. */
const STARTED_AT = 0.008;
/** Timeline position of the slam to black: the motto goes with the picture. */
const BLACK_AT = cueToProgress(['EXPLORATION', scaresConfig.end.at]);
/** Timeline position at which the piece is over: the last panel, on that black. */
const OVER_AT = 0.99999;
/** How long a chapter's stamp and a found memory stay on the picture (ms). */
const STAMP_MS = 2600;
const TOAST_MS = 3400;
/** Stillness after which the HUD leaves the picture (ms). */
const HUD_SLEEP_MS = 3400;
/** A press that travels less than this is a tap, not a look (px). */
const TAP_PX = 10;
/** A mouse that moves less than this in one event was only breathing (px). */
const MOUSE_PX = 1;
/**
 * The hints, in seconds, each shown once: how the dream moves (at most `walk`, gone at the first scroll),
 * how to look (at most `look`, gone once the viewer has looked), and `gazeAfter` later how a memory is
 * found (for `gaze`, unless one is found first).
 */
const TUTORIAL = { walk: 9, look: 7, gazeAfter: 9, gaze: 7 };
/** The square of the gaze: its scale when it opens, and when it has closed on a memory. */
const RETICLE = { open: 1.3, closed: 0.72 };
/** Where the choice of walking by itself is remembered (a convenience: everything works without it). */
const MOVES_KEY = 'dream-of-the-photo.moves';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII'];
const chapterStarts = chapters.map((c) => cueToProgress(c.at));
const TOUCH = window.matchMedia('(pointer: coarse)').matches;
const HOVER = window.matchMedia('(hover: hover)').matches;
/** Focus that the keyboard put there (a browser too old to tell the difference: any focus). */
const KEYBOARD_FOCUS = CSS.supports('selector(:focus-visible)') ? ':focus-visible' : ':focus';

/** What the piece tells the HUD every frame. */
export interface HudState {
  progress: number;
  /** Looking around is possible (inside the picture). */
  exploring: boolean;
  /** Degrees the viewer has turned their head so far. */
  turned: number;
  dragHintAfter: number;
  /** The last shot: the motto comes on and stays. */
  ending: boolean;
  /** A memory the gaze rests on: how much of the look it needs is done (0..1), and whether it was found before. */
  focus: { memory: MemoryId; progress: number; known: boolean } | null;
  found: number;
  total: number;
}

/** Which hint comes next ('wait' is the silence before the last one). */
type Hint = 'walk' | 'look' | 'wait' | 'memory' | 'none';

const q = <T extends HTMLElement>(name: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(`[data-ui="${name}"]`);
  if (!el) throw new Error(`missing ui element: ${name}`);
  return el;
};

function storedMoves(): boolean {
  try {
    return window.localStorage.getItem(MOVES_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** The motto, one block per line: each balances by itself (browsers do not balance across a forced break). */
function writeMotto(el: HTMLElement): void {
  el.replaceChildren(
    ...say('motto')
      .split('\n')
      .map((line) => {
        const span = document.createElement('span');
        span.textContent = line;
        return span;
      }),
  );
}

/**
 * The interface over the scene, and as hard as the scene: a title screen that loads and waits for the first
 * step, then almost nothing: a HUD at the edges that leaves when nothing is touched, chapters stamped on
 * the picture, the square of the gaze, the voice. A pause menu, the motto over the last picture, and a panel
 * on black. Every word follows the language switch at once.
 */
export class Overlay {
  private readonly loader = q('load');
  private readonly bar = q('loader-bar');
  private readonly loaderLabel = q('loader-label');
  private readonly startButton = q<HTMLButtonElement>('start-button');
  private readonly motto = q('motto');
  private readonly movesNote = q('moves-note');
  private readonly edge = q('hud-edge');
  private readonly chapterNumber = q('chapter-number');
  private readonly chapterName = q('chapter-name');
  private readonly stamp = q('stamp');
  private readonly stampNumber = q('stamp-number');
  private readonly stampName = q('stamp-name');
  private readonly memoriesChip = q('memories');
  private readonly memoriesCount = q('memories-count');
  private readonly reticle = q('reticle');
  private readonly reticleFill = q('reticle-fill');
  private readonly toast = q('toast');
  private readonly toastName = q('toast-name');
  private readonly tutorial = q('tutorial');
  private readonly tutorialKey = q('tutorial-key');
  private readonly tutorialText = q('tutorial-text');
  private readonly journeyFill = q('journey-fill');
  private readonly journeyTicks = q('journey-ticks');
  private readonly journeyPercent = q('journey-percent');
  private readonly menuKeys = q<HTMLUListElement>('menu-keys');
  private readonly finale = q('finale');
  private readonly endCount = q('end-count');
  private readonly replay = q<HTMLButtonElement>('replay');
  private readonly menu = q('menu');
  private readonly sound = q<HTMLButtonElement>('sound');
  private readonly soundState = q('sound-state');
  private readonly menuSound = q<HTMLButtonElement>('menu-sound');
  private readonly menuSoundLabel = q('menu-sound-label');
  private readonly fullscreen = q<HTMLButtonElement>('fullscreen');
  private readonly fullscreenLabel = q('fullscreen-label');
  private readonly movesToggle = q<HTMLButtonElement>('moves');
  private readonly movesLabel = q('moves-label');
  private readonly narration = new Narration(q('narration'), q('narration-voice'));
  /** Everything the pause menu covers (inert while it is open). */
  private readonly behindMenu = [q('hud'), q('end'), q('start'), document.getElementById('stage')!];
  private readonly ticks: HTMLElement[] = [];

  private begun = false;
  private isReady = false;
  private soundOn = false;
  /** The dream walks by itself: on unless the visitor switched it off (now or on an earlier visit). */
  private moves = storedMoves();
  private loaded = 0;

  private exploring = false;
  private ending = false;
  private black = false;
  private over = false;
  private asleep = false;
  private lastInput = 0;
  private lastTick = 0;
  private pressX = 0;
  private pressY = 0;

  private chapterIndex = -1;
  /** The furthest chapter stamped so far (the stamp shows it): going back and forth over a border does not stamp it again. */
  private announced = -1;
  private stampTimer = 0;

  private journeyStep = -1;
  private journeyWhole = 0;

  private found = -1;
  private total = -1;
  private reticleStep = -1;
  private toastTimer = 0;
  private toastMemory: MemoryId | null = null;

  private hint: Hint = 'walk';
  private hintTime = 0;
  private hintShown: UiKey | null = null;
  private scrolled = false;

  private menuOpener: HTMLElement | null = null;

  onSoundToggle: (() => void) | null = null;
  /** The first step; `gesture` is true when it came from a click or a key (sound may start then). */
  onBegin: ((gesture: boolean) => void) | null = null;
  onPause: ((paused: boolean) => void) | null = null;
  onRestart: (() => void) | null = null;
  /** The visitor switched the walking by itself on or off. */
  onAuto: ((on: boolean) => void) | null = null;

  constructor() {
    for (const group of document.querySelectorAll<HTMLElement>('[data-ui="lang"]')) {
      group.addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-lang]');
        if (button) setLang(button.dataset.lang as Lang);
      });
    }
    this.startButton.addEventListener('click', () => this.begin(true));
    this.sound.addEventListener('click', () => this.onSoundToggle?.());
    this.menuSound.addEventListener('click', () => this.onSoundToggle?.());
    this.movesToggle.addEventListener('click', () => this.setMoves(!this.moves));
    q('menu-button').addEventListener('click', (e) => this.setPaused(true, e.currentTarget as HTMLElement));
    q('resume').addEventListener('click', (e) => this.setPaused(false, null, e.detail > 0));
    q('restart').addEventListener('click', (e) => {
      this.setPaused(false, null, e.detail > 0);
      this.restart();
    });
    this.replay.addEventListener('click', () => {
      this.replay.blur();
      this.restart();
    });
    // a mouse click leaves focus on the HUD's buttons, where Space would press them again: hand it back
    for (const b of document.querySelectorAll<HTMLButtonElement>('.hud button')) {
      b.addEventListener('click', (e) => {
        if (e.detail > 0 && !this.paused) b.blur();
      });
    }
    if (document.fullscreenEnabled) {
      this.fullscreen.addEventListener('click', () => {
        const done = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
        done.catch(() => undefined);
      });
      document.addEventListener('fullscreenchange', () => this.writeFullscreen());
    } else {
      q('fullscreen-row').hidden = true;
    }
    this.menu.setAttribute('role', 'dialog');
    this.menu.setAttribute('aria-modal', 'true');
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('pointerdown', this.onPointerDown, { passive: true });
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('pointerup', this.onPointerUp, { passive: true });

    // the journey's chapters, marked on its line
    for (const at of chapterStarts.slice(1)) {
      const tick = document.createElement('i');
      tick.style.left = `${(at * 100).toFixed(2)}%`;
      this.journeyTicks.appendChild(tick);
      this.ticks.push(tick);
    }
    onLang(() => this.translate());
  }

  /** True for events coming from the interface itself (it handles its own clicks and keys). */
  isInterface(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest('button, a, .menu');
  }

  /** True for the sound switches (they toggle sound themselves). */
  isSoundControl(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest('[data-ui="sound"], [data-ui="menu-sound"]');
  }

  get paused(): boolean {
    return !this.menu.hidden;
  }

  // ------------------------------------------------------------------ language

  private translate(): void {
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = say(el.dataset.i18n as UiKey);
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-label]')) el.setAttribute('aria-label', say(el.dataset.i18nLabel as UiKey));
    for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang()));
    writeMotto(this.motto);
    if (this.ending) writeMotto(this.finale);
    if (this.chapterIndex >= 0) this.chapterName.textContent = tr(chapters[this.chapterIndex].name);
    if (this.announced >= 0) this.stampName.textContent = tr(chapters[this.announced].name);
    if (this.toastMemory) this.toastName.textContent = tr(memories[this.toastMemory]);
    this.loaderLabel.textContent = percent(this.loaded);
    this.journeyPercent.textContent = percent(this.journeyWhole / 100);
    this.hintShown = null;
    this.writeKeys();
    this.writeSound();
    this.writeFullscreen();
    this.writeMoves();
  }

  private writeKeys(): void {
    const rows: readonly { caps: readonly string[]; does: UiKey }[] = TOUCH
      ? [
          { caps: [say('swipeUp')], does: 'hurry' },
          { caps: [say('swipeDown')], does: 'back' },
          { caps: [say('swipeSide')], does: 'look' },
        ]
      : [
          { caps: [`${say('wheel')} ↓`, '↓'], does: 'hurry' },
          { caps: [`${say('wheel')} ↑`, '↑'], does: 'back' },
          { caps: [say('drag'), '←', '→'], does: 'look' },
          { caps: ['Esc', 'M'], does: 'menu' },
        ];
    this.menuKeys.replaceChildren(
      ...rows.map((row) => {
        const caps = document.createElement('span');
        caps.className = 'keys__caps';
        for (const text of row.caps) {
          const cap = document.createElement('span');
          cap.className = 'key';
          cap.textContent = text;
          caps.appendChild(cap);
        }
        const does = document.createElement('span');
        does.textContent = say(row.does);
        const li = document.createElement('li');
        li.append(caps, does);
        return li;
      }),
    );
  }

  private writeSound(): void {
    const state = say(this.soundOn ? 'on' : 'off');
    this.sound.setAttribute('aria-pressed', String(this.soundOn));
    this.soundState.textContent = state;
    this.menuSound.setAttribute('aria-pressed', String(this.soundOn));
    this.menuSoundLabel.textContent = state;
  }

  private writeFullscreen(): void {
    const on = !!document.fullscreenElement;
    this.fullscreen.setAttribute('aria-pressed', String(on));
    this.fullscreenLabel.textContent = say(on ? 'on' : 'off');
  }

  private writeMoves(): void {
    this.movesToggle.setAttribute('aria-pressed', String(this.moves));
    this.movesLabel.textContent = say(this.moves ? 'on' : 'off');
    this.movesNote.hidden = !this.moves;
  }

  private setMoves(on: boolean): void {
    this.moves = on;
    try {
      window.localStorage.setItem(MOVES_KEY, on ? 'on' : 'off');
    } catch {
      // private mode or blocked storage: the choice simply is not remembered
    }
    this.writeMoves();
    this.onAuto?.(on);
  }

  // ------------------------------------------------------------------ the title screen

  setLoadProgress(fraction: number): void {
    this.loaded = fraction;
    this.bar.style.transform = `scaleX(${fraction.toFixed(3)})`;
    this.loaderLabel.textContent = percent(fraction);
    this.loader.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
  }

  ready(): void {
    this.isReady = true;
    document.body.classList.add('is-ready');
    this.startButton.disabled = false;
    this.startButton.focus({ preventScroll: true });
  }

  /** Leave the title screen (Begin, Enter / Space, or the first scroll into the piece). */
  private begin(gesture: boolean): void {
    if (this.begun || !this.isReady) return;
    this.begun = true;
    document.body.classList.add('has-begun');
    this.startButton.blur();
    // the chapter is stamped as the title screen goes (not under it)
    this.chapterIndex = -1;
    this.wake();
    this.onAuto?.(this.moves);
    this.onBegin?.(gesture);
  }

  /** From the top again: the chapters are stamped anew; what was found stays found, what was taught stays taught. */
  private restart(): void {
    this.chapterIndex = -1;
    this.announced = -1;
    this.onRestart?.();
  }

  // ------------------------------------------------------------------ pause menu

  /** Open or close the pause menu (a modal: the rest is inert while it is open). */
  private setPaused(paused: boolean, opener: HTMLElement | null = null, byPointer = false): void {
    if (paused === this.paused || (paused && !this.begun)) return;
    this.menu.hidden = !paused;
    for (const el of this.behindMenu) el.inert = paused;
    if (paused) {
      this.menuOpener = opener;
      q<HTMLButtonElement>('resume').focus({ preventScroll: true });
    } else {
      // back where the menu was opened from; opened by key or left with the mouse, focus simply leaves the menu
      const back = this.menuOpener;
      this.menuOpener = null;
      if (this.over) this.replay.focus({ preventScroll: true });
      else if (back && back.offsetParent && !byPointer) back.focus({ preventScroll: true });
      else (document.activeElement as HTMLElement | null)?.blur();
      this.wake();
    }
    this.onPause?.(paused);
  }

  private onKey = (e: KeyboardEvent): void => {
    // the arrows that turn the head are looking, not reaching for the controls
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') this.wake();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'PageDown' || e.key === 'PageUp') this.scrolled = true;
    if (e.repeat) return;
    // M as well as Esc: in full screen the browser keeps Esc for itself
    const m = e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey && this.begun;
    if (e.key === 'Escape' || m) {
      this.setPaused(!this.paused);
      e.preventDefault();
    } else if (!this.begun && this.isReady && (e.key === 'Enter' || e.key === ' ') && !this.isInterface(e.target)) {
      this.begin(true);
      e.preventDefault();
    }
  };

  // ------------------------------------------------------------------ what wakes the HUD

  private wake(): void {
    this.lastInput = performance.now();
  }

  private onWheel = (): void => {
    this.scrolled = true;
    this.wake();
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.pressX = e.clientX;
    this.pressY = e.clientY;
  };

  /** A mouse moved with no button held is reaching for the controls (dragging is looking); a finger up or down is hurrying. */
  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      if (e.buttons === 0 && Math.abs(e.movementX) + Math.abs(e.movementY) > MOUSE_PX) this.wake();
    } else if (e.buttons !== 0 && Math.abs(e.clientY - this.pressY) > TAP_PX && Math.abs(e.clientY - this.pressY) > Math.abs(e.clientX - this.pressX)) {
      this.scrolled = true;
    }
  };

  /** A tap wakes it, a swipe (looking) does not. */
  private onPointerUp = (e: PointerEvent): void => {
    if (Math.abs(e.clientX - this.pressX) + Math.abs(e.clientY - this.pressY) < TAP_PX) this.wake();
  };

  /** The HUD stays while it is in use: under the pointer, or holding the keyboard's focus. */
  private inUse(): boolean {
    return (HOVER && this.edge.matches(':hover')) || !!this.edge.querySelector(KEYBOARD_FOCUS);
  }

  private updateSleep(now: number): void {
    const asleep = this.begun && !this.paused && now - this.lastInput > HUD_SLEEP_MS && !this.inUse();
    if (asleep === this.asleep) return;
    this.asleep = asleep;
    document.body.classList.toggle('hud-asleep', asleep);
  }

  // ------------------------------------------------------------------ per frame

  update(s: HudState): void {
    if (s.progress > STARTED_AT) this.begin(false);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const exploring = s.exploring && !this.paused;
    if (exploring !== this.exploring) {
      this.exploring = exploring;
      document.body.classList.toggle('is-exploring', exploring);
    }
    this.narration.update(s.progress, now);
    this.updateChapter(s.progress);
    this.updateJourney(s.progress);
    this.updateMemories(s);
    this.updateTutorial(s, dt);
    this.updateEnding(s);
    this.updateSleep(now);
  }

  private updateChapter(progress: number): void {
    let i = chapterStarts.length - 1;
    while (i > 0 && progress < chapterStarts[i]) i--;
    if (i === this.chapterIndex) return;
    this.chapterIndex = i;
    const name = tr(chapters[i].name);
    this.chapterNumber.textContent = ROMAN[i];
    this.chapterName.textContent = name;
    if (!this.begun || i <= this.announced) return;
    this.announced = i;
    this.stampNumber.textContent = ROMAN[i];
    this.stampName.textContent = name;
    // the blow again, also if the last stamp is still there
    this.stamp.classList.remove('is-on');
    void this.stamp.offsetWidth;
    this.stamp.classList.add('is-on');
    window.clearTimeout(this.stampTimer);
    this.stampTimer = window.setTimeout(() => this.stamp.classList.remove('is-on'), STAMP_MS);
  }

  private updateJourney(progress: number): void {
    const step = Math.round(progress * 1000);
    if (step === this.journeyStep) return;
    this.journeyStep = step;
    this.journeyFill.style.transform = `scaleX(${(step / 1000).toFixed(3)})`;
    const whole = Math.round(progress * 100);
    if (whole !== this.journeyWhole) {
      this.journeyWhole = whole;
      this.journeyPercent.textContent = percent(whole / 100);
    }
    this.ticks.forEach((tick, k) => tick.classList.toggle('is-passed', progress >= chapterStarts[k + 1]));
  }

  private updateMemories(s: HudState): void {
    if (s.found !== this.found || s.total !== this.total) {
      this.found = s.found;
      this.total = s.total;
      this.memoriesCount.textContent = `${s.found}/${s.total}`;
      this.endCount.textContent = `${s.found} / ${s.total}`;
    }
    const focus = s.exploring ? s.focus : null;
    const closed = focus ? (focus.known ? 1 : Math.min(1, focus.progress)) : 0;
    const step = focus ? Math.round(closed * 100) : -1;
    if (step === this.reticleStep) return;
    this.reticleStep = step;
    this.reticle.classList.toggle('is-focusing', !!focus);
    this.reticle.classList.toggle('is-known', !!focus?.known);
    if (!focus) return;
    this.reticleFill.style.strokeDashoffset = String(100 - step);
    this.reticle.style.transform = `scale(${(RETICLE.open + (RETICLE.closed - RETICLE.open) * closed).toFixed(3)})`;
  }

  /** A memory found: name it for a moment, and let the counter turn over. */
  memoryFound(id: MemoryId): void {
    this.wake();
    this.toastMemory = id;
    this.toastName.textContent = tr(memories[id]);
    // only a showing toast is announced (a language switch rewrites its label without a new find)
    this.toast.removeAttribute('aria-hidden');
    this.toast.classList.remove('is-visible');
    void this.toast.offsetWidth;
    this.toast.classList.add('is-visible');
    this.memoriesChip.classList.remove('is-pulsing');
    void this.memoriesChip.offsetWidth;
    this.memoriesChip.classList.add('is-pulsing');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.classList.remove('is-visible');
      this.toast.setAttribute('aria-hidden', 'true');
      this.toastName.textContent = '';
      this.toastMemory = null;
    }, TOAST_MS);
  }

  private nextHint(hint: Hint): void {
    this.hint = hint;
    this.hintTime = 0;
  }

  /** Plain words, each once: how the dream moves; how to look; later, how a memory is found. */
  private updateTutorial(s: HudState, dt: number): void {
    let text: UiKey | null = null;
    if (this.begun && !this.paused && !s.ending) {
      if (this.hint === 'walk') {
        this.hintTime += dt;
        // with the walking switched off it stays until the viewer has understood that it is theirs
        const learned = this.moves ? this.scrolled || this.hintTime > TUTORIAL.walk : s.progress > STARTED_AT;
        if (learned) this.nextHint('look');
        else text = this.moves ? 'tutorialWalk' : 'scroll';
      } else if (s.exploring) {
        this.hintTime += dt;
        if (this.hint === 'look') {
          if (s.turned > s.dragHintAfter || this.hintTime > TUTORIAL.look) this.nextHint('wait');
          else text = TOUCH ? 'tutorialLookTouch' : 'tutorialLook';
        } else if (this.hint === 'wait') {
          if (this.hintTime > TUTORIAL.gazeAfter) this.nextHint('memory');
        } else if (this.hint === 'memory') {
          if (s.found > 0 || this.hintTime > TUTORIAL.gaze) this.nextHint('none');
          else text = 'tutorialMemory';
        }
      }
    }
    if (text === this.hintShown) return;
    this.hintShown = text;
    this.tutorial.classList.toggle('is-visible', !!text);
    if (!text) return;
    this.tutorialKey.textContent = text === 'tutorialLook' ? say('drag') : '';
    this.tutorialText.textContent = say(text);
  }

  /** The motto lands on the last picture and stays until the slam to black; then, in the black, the last panel. */
  private updateEnding(s: HudState): void {
    if (s.ending !== this.ending) {
      this.ending = s.ending;
      document.body.classList.toggle('is-ending', s.ending);
      if (s.ending) writeMotto(this.finale);
      else this.finale.replaceChildren();
    }
    const black = s.progress >= BLACK_AT;
    if (black !== this.black) {
      this.black = black;
      document.body.classList.toggle('is-black', black);
    }
    const over = s.progress >= OVER_AT;
    if (over === this.over) return;
    this.over = over;
    document.body.classList.toggle('is-over', over);
    if (over && !this.paused) this.replay.focus({ preventScroll: true });
    else if (!over) this.replay.blur();
  }

  setSound(on: boolean): void {
    this.soundOn = on;
    this.writeSound();
  }

  fail(message: string): void {
    document.body.classList.add('has-failed');
    const el = document.createElement('div');
    el.className = 'fallback';
    el.setAttribute('role', 'alert');
    el.textContent = message;
    document.body.appendChild(el);
  }
}
