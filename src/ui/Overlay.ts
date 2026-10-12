import { chapters, memories, type Lang, type MemoryId, type UiKey } from '../config/copy.config';
import { cueToProgress } from '../experience/timeline/Timeline';
import { lang, onLang, percent, say, setLang, tr } from './i18n';
import { Narration } from './Narration';

/** Timeline position after which the piece counts as started (the scroll cue is gone). */
const STARTED_AT = 0.008;
/** How long a new chapter stays announced, and a found memory on screen (ms). */
const CHAPTER_MS = 3600;
const TOAST_MS = 3400;
/**
 * Tutorials, in seconds of exploring: how to look is shown until the viewer has looked around (or for
 * `look` s at most); how to find memories follows `gazeAfter` s later for `gaze` s, unless one is found.
 */
const TUTORIAL = { look: 14, gazeAfter: 4, gaze: 12 };
/** Circumference of the reticle's ring (r = 15 in its 40-unit view box). */
const RING = 2 * Math.PI * 15;

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
/** UI keys that name a control (anything else in a key row is printed as it is, e.g. arrows). */
const NAMED_KEYS = new Set<string>(['wheel', 'drag', 'swipeUp', 'swipeSide', 'twoFingers']);
const chapterStarts = chapters.map((c) => cueToProgress(c.at));
const TOUCH = window.matchMedia('(pointer: coarse)').matches;

/** What the piece tells the HUD every frame. */
export interface HudState {
  progress: number;
  /** Looking around is possible (inside the picture). */
  exploring: boolean;
  /** Degrees the viewer has turned their head so far. */
  turned: number;
  dragHintAfter: number;
  /** The last shot: the title comes back. */
  ending: boolean;
  /** A memory the gaze rests on: how much of the look it needs is done (0..1), and whether it was found before. */
  focus: { memory: MemoryId; progress: number; known: boolean } | null;
  found: number;
  total: number;
}

const q = <T extends HTMLElement>(name: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(`[data-ui="${name}"]`);
  if (!el) throw new Error(`missing ui element: ${name}`);
  return el;
};

/** A row of the controls: keycaps, then what they do. */
type KeyRow = { keys: UiKey[] | string[]; does: UiKey };

/**
 * The game's interface over the scene: a title screen that loads and waits for the first step, then a
 * HUD (chapter, memories, language, sound, menu, the gaze, the journey, controls, subtitles), a pause
 * menu and an ending. Every word follows the language switch at once.
 */
export class Overlay {
  private readonly bar = q('loader-bar');
  private readonly loaderLabel = q('loader-label');
  private readonly startButton = q<HTMLButtonElement>('start-button');
  private readonly chapter = q('chapter');
  private readonly chapterNumber = q('chapter-number');
  private readonly chapterName = q('chapter-name');
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
  private readonly keys = q<HTMLUListElement>('keys');
  private readonly menuKeys = q<HTMLUListElement>('menu-keys');
  private readonly scrollCue = q('scroll-cue');
  private readonly endCount = q('end-count');
  private readonly menu = q('menu');
  private readonly sound = q<HTMLButtonElement>('sound');
  private readonly menuSoundLabel = q('menu-sound-label');
  private readonly fullscreenLabel = q('fullscreen-label');
  private readonly narration = new Narration(q('narration'));

  private begun = false;
  private isReady = false;
  private soundOn = false;
  private chapterIndex = -1;
  private chapterTimer = 0;
  private toastTimer = 0;
  private toastMemory: MemoryId | null = null;
  private dragHintDone = false;
  /** Seconds spent exploring so far, and when the look tutorial ended (in those seconds). */
  private explored = 0;
  private lookTaughtAt = -1;
  private lastTick = 0;
  private found = 0;
  private lastFill = -1;
  private loaded = 0;
  private readonly ticks: HTMLElement[] = [];
  private menuOpener: HTMLElement | null = null;
  private readonly menuSound = q<HTMLButtonElement>('menu-sound');
  private readonly fullscreen = q<HTMLButtonElement>('fullscreen');
  /** Everything the pause menu covers (inert while it is open). */
  private readonly behindMenu = [q('hud'), q('end'), q('start'), document.getElementById('stage')!];

  onSoundToggle: (() => void) | null = null;
  /** The first step; `gesture` is true when it came from a click or a key (sound may start then). */
  onBegin: ((gesture: boolean) => void) | null = null;
  onPause: ((paused: boolean) => void) | null = null;
  onRestart: (() => void) | null = null;

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
    q('menu-button').addEventListener('click', (e) => this.setPaused(true, e.currentTarget as HTMLElement));
    q('resume').addEventListener('click', () => this.setPaused(false));
    q('restart').addEventListener('click', () => {
      this.setPaused(false);
      this.onRestart?.();
    });
    q('replay').addEventListener('click', (e) => {
      (e.currentTarget as HTMLElement).blur();
      this.onRestart?.();
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

    // the journey's chapters, marked on its bar
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
    if (this.chapterIndex >= 0) this.chapterName.textContent = tr(chapters[this.chapterIndex].name);
    if (this.toastMemory) this.toastName.textContent = tr(memories[this.toastMemory]);
    this.loaderLabel.textContent = percent(this.loaded);
    this.journeyPercent.textContent = percent(Math.max(0, this.lastFill) / 100);
    this.writeKeys();
    this.writeSound();
    this.writeFullscreen();
    this.tutorialText.dataset.key = '';
  }

  private writeKeys(): void {
    const rows: KeyRow[] = TOUCH
      ? [
          { keys: ['swipeUp'], does: 'walk' },
          { keys: ['swipeSide'], does: 'look' },
          { keys: ['twoFingers'], does: 'walk' },
        ]
      : [
          { keys: ['wheel', '↑ ↓'], does: 'walk' },
          { keys: ['drag', '← →'], does: 'look' },
          { keys: ['Esc', 'M'], does: 'menu' },
        ];
    for (const list of [this.keys, this.menuKeys]) {
      list.replaceChildren(
        ...rows.map((row) => {
          const li = document.createElement('li');
          for (const k of row.keys) {
            const cap = document.createElement('span');
            cap.className = 'key';
            cap.textContent = NAMED_KEYS.has(k) ? say(k as UiKey) : k;
            li.appendChild(cap);
          }
          const does = document.createElement('span');
          does.textContent = say(row.does);
          li.appendChild(does);
          return li;
        }),
      );
    }
  }

  private writeSound(): void {
    this.sound.setAttribute('aria-pressed', String(this.soundOn));
    this.menuSound.setAttribute('aria-pressed', String(this.soundOn));
    this.menuSoundLabel.textContent = say(this.soundOn ? 'on' : 'off');
  }

  private writeFullscreen(): void {
    const on = !!document.fullscreenElement;
    this.fullscreen.setAttribute('aria-pressed', String(on));
    this.fullscreenLabel.textContent = say(on ? 'on' : 'off');
  }

  // ------------------------------------------------------------------ the title screen

  setLoadProgress(fraction: number): void {
    this.loaded = fraction;
    this.bar.style.transform = `scaleX(${fraction.toFixed(3)})`;
    this.loaderLabel.textContent = percent(fraction);
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
    // the chapter is announced as the HUD appears (not under the title screen)
    this.chapterIndex = -1;
    this.onBegin?.(gesture);
  }

  // ------------------------------------------------------------------ pause menu

  /** Open or close the pause menu (a modal: the rest is inert while it is open). */
  private setPaused(paused: boolean, opener: HTMLElement | null = null): void {
    if (paused === this.paused || (paused && !this.begun)) return;
    this.menu.hidden = !paused;
    document.body.classList.toggle('is-paused', paused);
    for (const el of this.behindMenu) el.inert = paused;
    if (paused) {
      this.menuOpener = opener;
      q<HTMLButtonElement>('resume').focus({ preventScroll: true });
    } else {
      // back where the menu was opened from; opened by key, focus simply leaves the menu
      const back = this.menuOpener;
      this.menuOpener = null;
      if (back && back.offsetParent) back.focus({ preventScroll: true });
      else (document.activeElement as HTMLElement | null)?.blur();
    }
    this.onPause?.(paused);
  }

  private onKey = (e: KeyboardEvent): void => {
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

  // ------------------------------------------------------------------ per frame

  update(s: HudState): void {
    if (s.progress > STARTED_AT) this.begin(false);
    document.body.classList.toggle('is-ending', s.ending);
    document.body.classList.toggle('is-exploring', s.exploring && !this.paused);
    this.scrollCue.classList.toggle('is-visible', this.begun && s.progress <= STARTED_AT);
    this.narration.update(s.progress);
    this.updateChapter(s.progress);
    this.updateJourney(s.progress);
    this.updateMemories(s);
    this.updateTutorial(s);
  }

  private updateChapter(progress: number): void {
    let i = chapterStarts.length - 1;
    while (i > 0 && progress < chapterStarts[i]) i--;
    if (i === this.chapterIndex) return;
    this.chapterIndex = i;
    this.chapterNumber.textContent = ROMAN[i];
    this.chapterName.textContent = tr(chapters[i].name);
    // replay the announcement
    this.chapter.classList.remove('is-new');
    void this.chapter.offsetWidth;
    this.chapter.classList.add('is-new');
    window.clearTimeout(this.chapterTimer);
    this.chapterTimer = window.setTimeout(() => this.chapter.classList.remove('is-new'), CHAPTER_MS);
  }

  private updateJourney(progress: number): void {
    const fill = Math.round(progress * 1000) / 10;
    if (fill === this.lastFill) return;
    this.lastFill = fill;
    this.journeyFill.style.width = `${fill}%`;
    this.journeyPercent.textContent = percent(fill / 100);
    this.ticks.forEach((tick, k) => tick.classList.toggle('is-passed', progress >= chapterStarts[k + 1]));
  }

  private updateMemories(s: HudState): void {
    if (s.found !== this.found || !this.memoriesCount.textContent?.endsWith(`/${s.total}`)) {
      this.found = s.found;
      const text = `${s.found}/${s.total}`;
      this.memoriesCount.textContent = text;
      this.endCount.textContent = text;
    }
    const focus = s.exploring ? s.focus : null;
    this.reticle.classList.toggle('is-focusing', !!focus);
    this.reticle.classList.toggle('is-known', !!focus?.known);
    const offset = focus ? RING * (1 - (focus.known ? 1 : focus.progress)) : RING;
    this.reticleFill.style.strokeDashoffset = offset.toFixed(2);
  }

  /** A memory found: name it for a moment, and let the counter glow. */
  memoryFound(id: MemoryId): void {
    this.toastMemory = id;
    this.toastName.textContent = tr(memories[id]);
    // only a showing toast is announced (a language switch rewrites its label without a new find)
    this.toast.removeAttribute('aria-hidden');
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

  /** First how to look, then how to find memories. */
  private updateTutorial(s: HudState): void {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - this.lastTick);
    this.lastTick = now;
    const active = s.exploring && !s.ending && !this.paused;
    if (active) this.explored += dt;
    if (!this.dragHintDone && (s.turned > s.dragHintAfter || this.explored > TUTORIAL.look)) {
      this.dragHintDone = true;
      this.lookTaughtAt = this.explored;
    }
    let key = '';
    let text: UiKey | null = null;
    if (active) {
      const sinceLook = this.explored - this.lookTaughtAt;
      if (!this.dragHintDone) {
        key = TOUCH ? '' : say('drag');
        text = TOUCH ? 'tutorialLookTouch' : 'tutorialLook';
      } else if (s.found === 0 && sinceLook > TUTORIAL.gazeAfter && sinceLook < TUTORIAL.gazeAfter + TUTORIAL.gaze) {
        text = 'tutorialMemory';
      }
    }
    this.tutorial.classList.toggle('is-visible', !!text);
    const id = `${text}:${key}:${lang()}`;
    if (!text || this.tutorialText.dataset.key === id) return;
    this.tutorialText.dataset.key = id;
    this.tutorialKey.textContent = key;
    this.tutorialText.textContent = say(text);
  }

  setSound(on: boolean): void {
    this.soundOn = on;
    this.writeSound();
  }

  fail(message: string): void {
    document.body.classList.add('has-failed');
    const el = document.createElement('div');
    el.className = 'fallback';
    el.textContent = message;
    document.body.appendChild(el);
  }
}
