import { chapters, DIRECTOR, VOICE_ENGINE, type Lang, type Text, type UiKey } from '../config/copy.config';
import { at, REDUCED_MOTION, RUN_SECONDS } from '../config/experience.config';
import type { VoiceStyle } from '../config/film.config';
import { range } from '../experience/math';
import { cueToProgress, phaseStart } from '../experience/timeline/Timeline';
import { lang, onLang, percent, say, setLang, tr } from './i18n';
import { Narration } from './Narration';

/** Timeline position after which the piece counts as started. */
const STARTED_AT = at(1.44);
/** From the street as it really is, the film plays out without its HUD: a key pressed there is the film's one choice. */
const ENDING_AT = phaseStart('STREET');
/** The page's own black, under the credits: the street before it is the film's. */
const BLACK_AT = phaseStart('CREDITS');
/** Seconds before the very end at which the credits have come to rest, the last panel in the middle of the screen. */
const ROLL_REST_SECONDS = 3;
const ROLL_END = 1 - at(ROLL_REST_SECONDS);
/** Timeline position at which the piece is over: Dream it again takes the focus. */
const OVER_AT = 0.99999;
/** The years the dream has reached are counted from the film's start, and shown once the journey has begun. */
const JOURNEY_AT = phaseStart('WORLD');
/** Minutes the whole film lasts: in the dream, a minute is a year. */
const FILM_MINUTES = Math.round(RUN_SECONDS / 60);
/** How long a chapter's stamp stays on the picture (ms). */
const STAMP_MS = 2600;
/** Stillness after which the HUD leaves the picture (ms). */
const HUD_SLEEP_MS = 3400;
/** A press that travels less than this is a tap, not a look (px). */
const TAP_PX = 10;
/** A mouse that moves less than this in one event was only breathing (px). */
const MOUSE_PX = 1;
/** The hints, in seconds, each shown once: how the dream moves (at most `walk`, gone at the first scroll), and how to look (at most `look`, gone once the viewer has looked). */
const TUTORIAL = { walk: 9, look: 7 };
/** Where the choices of walking by itself and of hearing the voices are remembered (a convenience: everything works without it). */
const MOVES_KEY = 'dream-of-the-photo.moves';
const VOICE_KEY = 'dream-of-the-photo.voice';

const chapterStarts = chapters.map((c) => cueToProgress(c.at));
/** Where each evening begins, marked on the journey's line. */
const eveningMarks = chapters.filter((c) => c.title).map((c) => cueToProgress(c.at));
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
}

/** Which hint comes next. */
type Hint = 'walk' | 'look' | 'none';

const q = <T extends HTMLElement>(name: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(`[data-ui="${name}"]`);
  if (!el) throw new Error(`missing ui element: ${name}`);
  return el;
};

/** A switch the visitor may have set on an earlier visit (on unless it was switched off). */
function storedOn(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== 'off';
  } catch {
    return true;
  }
}

function storeOn(key: string, on: boolean): void {
  try {
    window.localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    // private mode or blocked storage: the choice simply is not remembered
  }
}

/** The motto, one block per line: each balances by itself (browsers do not balance across a forced break). */
function writeMotto(el: HTMLElement, key: 'motto' | 'mottoTitle'): void {
  el.replaceChildren(
    ...say(key)
      .split('\n')
      .map((line) => {
        const span = document.createElement('span');
        span.textContent = line;
        return span;
      }),
  );
}

/**
 * The page around the film: a title screen that loads and waits for the first step; then the picture, framed
 * like a film, with the spoken lines at its foot, chapters stamped on it and a HUD at the edges that is there only
 * while the pointer moves; a pause menu; and after the last street, the credits rolling up over black into a last
 * panel. Every word follows the language switch at once.
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
  private readonly tutorial = q('tutorial');
  private readonly tutorialKey = q('tutorial-key');
  private readonly tutorialText = q('tutorial-text');
  private readonly journeyFill = q('journey-fill');
  private readonly journeyTicks = q('journey-ticks');
  private readonly years = q('years');
  private readonly menuKeys = q<HTMLUListElement>('menu-keys');
  private readonly end = q('end');
  private readonly roll = q('end-roll');
  private readonly cards = [...this.roll.children] as HTMLElement[];
  private readonly endPanel = q('end-panel');
  private readonly creditsMotto = q('credits-motto');
  private readonly replay = q<HTMLButtonElement>('replay');
  private readonly menu = q('menu');
  private readonly sound = q<HTMLButtonElement>('sound');
  private readonly soundState = q('sound-state');
  private readonly menuSound = q<HTMLButtonElement>('menu-sound');
  private readonly menuSoundLabel = q('menu-sound-label');
  private readonly voiceToggle = q<HTMLButtonElement>('voice');
  private readonly voiceState = q('voice-state');
  private readonly menuVoice = q<HTMLButtonElement>('menu-voice');
  private readonly menuVoiceLabel = q('menu-voice-label');
  private readonly fullscreen = q<HTMLButtonElement>('fullscreen');
  private readonly fullscreenLabel = q('fullscreen-label');
  private readonly movesToggle = q<HTMLButtonElement>('moves');
  private readonly movesLabel = q('moves-label');
  private readonly narration = new Narration(q('narration'), q('narration-voice'));
  private readonly roomHint = q('room-hint');
  private roomHintText: Text | null = null;
  private readonly continueButton = q<HTMLButtonElement>('continue');
  private readonly continueName = q('continue-name');
  private continueText: Text | null = null;
  /** Everything the pause menu covers (inert while it is open). */
  private readonly behindMenu = [q('hud'), q('end'), q('start'), document.getElementById('stage')!];
  private readonly ticks: HTMLElement[] = [];

  private begun = false;
  private isReady = false;
  private soundOn = false;
  /** The dream walks by itself, and the voices are heard: on unless the visitor switched them off (now or on an earlier visit). */
  private moves = storedOn(MOVES_KEY);
  private voice = storedOn(VOICE_KEY);
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
  /** The furthest chapter reached so far (an evening is stamped as it is reached): going back and forth over a border does not stamp it again. */
  private announced = -1;
  private stampTimer = 0;

  private journeyStep = -1;
  private year = -2;

  /** Where the credits run from and to (px: the roll's offset with its top at the foot of the screen, and with the last panel in the middle); measured when needed. */
  private rollSpan: { from: number; to: number } | null = null;
  private rollY = Number.NaN;
  /** With less motion, the credits are shown one card at a time: the one showing. */
  private card = -1;

  private hint: Hint = 'walk';
  private hintTime = 0;
  private hintShown: UiKey | null = null;
  private scrolled = false;

  private menuOpener: HTMLElement | null = null;

  onSoundToggle: (() => void) | null = null;
  /** The visitor switched the voices on or off (the lines are shown either way). */
  onVoiceToggle: ((on: boolean) => void) | null = null;
  /** The first step; `gesture` is true when it came from a click or a key (sound may start then). */
  onBegin: ((gesture: boolean) => void) | null = null;
  onPause: ((paused: boolean) => void) | null = null;
  onRestart: (() => void) | null = null;
  /** The viewer leaves this part of the journey behind. */
  onSkip: (() => void) | null = null;
  /** The viewer takes up where an earlier visit left off. */
  onContinue: (() => void) | null = null;
  /** What the shutter has kept (shown at the end). */
  albumPictures: (() => HTMLCanvasElement[]) | null = null;
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
    this.voiceToggle.addEventListener('click', () => this.setVoice(!this.voice));
    this.menuVoice.addEventListener('click', () => this.setVoice(!this.voice));
    this.movesToggle.addEventListener('click', () => this.setMoves(!this.moves));
    q('menu-button').addEventListener('click', (e) => this.setPaused(true, e.currentTarget as HTMLElement));
    q('resume').addEventListener('click', (e) => this.setPaused(false, null, e.detail > 0));
    q('skip').addEventListener('click', (e) => {
      this.onSkip?.();
      this.setPaused(false, null, e.detail > 0);
    });
    this.continueButton.addEventListener('click', () => {
      this.onContinue?.();
      this.begin(true);
    });
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
    // the credits are laid out anew on another screen
    window.addEventListener('resize', () => (this.rollSpan = null));

    // the evenings, marked on the journey's line
    for (const mark of eveningMarks) {
      const tick = document.createElement('i');
      tick.style.left = `${(mark * 100).toFixed(2)}%`;
      this.journeyTicks.appendChild(tick);
      this.ticks.push(tick);
    }
    q('credit-director').textContent = DIRECTOR;
    q('credit-engine').textContent = VOICE_ENGINE;
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
    writeMotto(this.motto, 'mottoTitle');
    writeMotto(this.creditsMotto, 'motto');
    if (this.chapterIndex >= 0) this.chapterName.textContent = tr(chapters[this.chapterIndex].name);
    const stamped = chapters[this.announced];
    if (stamped?.title) {
      this.stampName.textContent = tr(stamped.name);
      this.stampNumber.textContent = tr(stamped.title);
    }
    if (this.roomHintText) this.roomHint.textContent = tr(this.roomHintText);
    if (this.continueText) this.continueName.textContent = tr(this.continueText);
    this.loaderLabel.textContent = percent(this.loaded);
    this.hintShown = null;
    this.rollSpan = null;
    this.writeKeys();
    this.writeSound();
    this.writeVoice();
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
          { caps: [`${say('wheel')} ↓`, '↓', 'W'], does: 'hurry' },
          { caps: [`${say('wheel')} ↑`, '↑', 'S'], does: 'back' },
          { caps: [say('drag'), '←', '→', 'A', 'D'], does: 'look' },
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

  private writeVoice(): void {
    const state = say(this.voice ? 'on' : 'off');
    this.voiceToggle.setAttribute('aria-pressed', String(this.voice));
    this.voiceState.textContent = state;
    this.menuVoice.setAttribute('aria-pressed', String(this.voice));
    this.menuVoiceLabel.textContent = state;
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
    storeOn(MOVES_KEY, on);
    this.writeMoves();
    this.onAuto?.(on);
  }

  private setVoice(on: boolean): void {
    this.voice = on;
    storeOn(VOICE_KEY, on);
    this.writeVoice();
    this.onVoiceToggle?.(on);
  }

  // ------------------------------------------------------------------ the title screen

  setLoadProgress(fraction: number): void {
    this.loaded = fraction;
    this.bar.style.transform = `scaleX(${fraction.toFixed(3)})`;
    this.loaderLabel.textContent = percent(fraction);
    this.loader.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
  }

  /** A spoken line at the foot of the picture, for `seconds`, set as its voice is (null takes the one showing away). */
  subtitle(text: Text | null, seconds: number, style: VoiceStyle): void {
    this.narration.show(text, seconds, style);
  }

  /** What a room lets the viewer do now (null when nothing). */
  roomPrompt(text: Text | null): void {
    this.roomHintText = text;
    if (text) this.roomHint.textContent = tr(text);
    this.roomHint.classList.toggle('is-on', Boolean(text));
  }

  /** An earlier visit got this far: the title offers to go on from it. */
  offerContinue(name: Text): void {
    this.continueText = name;
    this.continueName.textContent = tr(name);
    this.continueButton.hidden = false;
  }

  ready(): void {
    this.isReady = true;
    document.body.classList.add('is-ready');
    this.startButton.disabled = false;
    this.startButton.focus({ preventScroll: true });
    // the voices as the visitor left them, before the first line can be said
    this.onVoiceToggle?.(this.voice);
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

  /** From the top again: the evenings are stamped anew; what was taught stays taught. */
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
    // behind the menu the film stands still, and so does the line it was saying
    this.narration.update(this.paused ? 0 : dt);
    this.updateChapter(s.progress);
    this.updateJourney(s.progress);
    this.updateEnding(s.progress);
    this.updateTutorial(s, dt);
    this.updateSleep(now);
  }

  private updateChapter(progress: number): void {
    let i = chapterStarts.length - 1;
    while (i > 0 && progress < chapterStarts[i]) i--;
    if (i === this.chapterIndex) return;
    this.chapterIndex = i;
    const name = tr(chapters[i].name);
    this.chapterNumber.textContent = chapters[i].number ?? '';
    this.chapterName.textContent = name;
    if (!this.begun || i <= this.announced) return;
    this.announced = i;
    // only an evening is stamped: over the tray it begins with
    const title = chapters[i].title;
    if (!title) return;
    this.stampNumber.textContent = tr(title);
    this.stampName.textContent = name;
    // the blow again, also if the last stamp is still there
    this.stamp.classList.remove('is-on');
    void this.stamp.offsetWidth;
    this.stamp.classList.add('is-on');
    window.clearTimeout(this.stampTimer);
    this.stampTimer = window.setTimeout(() => this.stamp.classList.remove('is-on'), STAMP_MS);
  }

  /** The journey's line, its evenings, and the year the dream has reached (a minute of the film is a year of it). */
  private updateJourney(progress: number): void {
    const step = Math.round(progress * 1000);
    if (step !== this.journeyStep) {
      this.journeyStep = step;
      this.journeyFill.style.transform = `scaleX(${(step / 1000).toFixed(3)})`;
      this.ticks.forEach((tick, k) => tick.classList.toggle('is-passed', progress >= eveningMarks[k]));
    }
    const year = progress < JOURNEY_AT ? -1 : Math.min(FILM_MINUTES, Math.floor((progress * RUN_SECONDS) / 60));
    if (year === this.year) return;
    this.year = year;
    this.years.textContent = year < 0 ? '' : `${year} / ${FILM_MINUTES}`;
  }

  private nextHint(hint: Hint): void {
    this.hint = hint;
    this.hintTime = 0;
  }

  /** Plain words, each once: how the dream moves, then how to look. */
  private updateTutorial(s: HudState, dt: number): void {
    let text: UiKey | null = null;
    if (this.begun && !this.paused && !this.ending) {
      if (this.hint === 'walk') {
        this.hintTime += dt;
        // with the walking switched off it stays until the viewer has understood that it is theirs
        const learned = this.moves ? this.scrolled || this.hintTime > TUTORIAL.walk : s.progress > STARTED_AT;
        if (learned) this.nextHint('look');
        else text = this.moves ? 'tutorialWalk' : 'scroll';
      } else if (this.hint === 'look' && s.exploring) {
        this.hintTime += dt;
        if (s.turned > s.dragHintAfter || this.hintTime > TUTORIAL.look) this.nextHint('none');
        else text = TOUCH ? 'tutorialLookTouch' : 'tutorialLook';
      }
    }
    if (text === this.hintShown) return;
    this.hintShown = text;
    this.tutorial.classList.toggle('is-visible', !!text);
    if (!text) return;
    this.tutorialKey.textContent = text === 'tutorialLook' ? say('drag') : '';
    this.tutorialText.textContent = say(text);
  }

  /** The last street is the film's own; then the page's black, the credits rolling up it, and the last panel. */
  private updateEnding(progress: number): void {
    const ending = progress >= ENDING_AT;
    if (ending !== this.ending) {
      this.ending = ending;
      document.body.classList.toggle('is-ending', ending);
    }
    const black = progress >= BLACK_AT;
    if (black !== this.black) {
      this.black = black;
      document.body.classList.toggle('is-black', black);
      if (black) this.hangAlbum();
      this.rollSpan = null;
      this.cards[this.card]?.classList.remove('is-shown');
      this.card = -1;
    }
    if (black) this.updateCredits(range(BLACK_AT, ROLL_END, progress));
    const over = progress >= OVER_AT;
    if (over === this.over) return;
    this.over = over;
    if (over && !this.paused) this.replay.focus({ preventScroll: true });
    else if (!over) this.replay.blur();
  }

  /** The credits, `f` (0..1) of the way: rolling up, or (with less motion) one card after another. */
  private updateCredits(f: number): void {
    if (REDUCED_MOTION) {
      const card = Math.min(this.cards.length - 1, Math.floor(f * this.cards.length));
      if (card === this.card) return;
      this.cards[this.card]?.classList.remove('is-shown');
      this.card = card;
      this.cards[card].classList.add('is-shown');
      return;
    }
    const span = (this.rollSpan ??= this.measureRoll());
    const y = span.from + (span.to - span.from) * f;
    if (Math.abs(y - this.rollY) < 0.1) return;
    this.rollY = y;
    this.roll.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
  }

  private measureRoll(): { from: number; to: number } {
    const screen = this.end.clientHeight;
    return { from: screen, to: screen / 2 - (this.endPanel.offsetTop + this.endPanel.offsetHeight / 2) };
  }

  /** The pictures the shutter kept, copied onto the last panel. */
  private hangAlbum(): void {
    const pictures = this.albumPictures?.() ?? [];
    const album = q('end-album');
    album.replaceChildren(
      ...pictures.map((picture) => {
        const copy = document.createElement('canvas');
        copy.width = picture.width;
        copy.height = picture.height;
        copy.getContext('2d')!.drawImage(picture, 0, 0);
        return copy;
      }),
    );
    q('end-caption').hidden = pictures.length === 0;
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
