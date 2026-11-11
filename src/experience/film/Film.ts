import type { Text } from '../../config/copy.config';
import { at, PHASES, type Phase } from '../../config/experience.config';
import { filmConfig, LINES, ROOM_VOICES, SCORE, STREET_CHOICE, type FilmCue, type VoiceStyle } from '../../config/film.config';
import { isRoom, JOURNEY, roomFile, STEP_IDS } from '../../config/journey.config';
import { voiceManifest } from '../../config/voice.manifest';
import { lang, onLang } from '../../ui/i18n';
import { JOURNEY_STEPS, phaseStart, stepProgress } from '../timeline/Timeline';

/** What the film needs from the sound: clips fetched ahead, one voice at a time, one cue of the score at a time. */
export interface FilmSound {
  /** Fetch and decode files under public/audio before their time comes. */
  preload(files: readonly string[]): Promise<void>;
  /** Forget every preloaded file that is not in `keep`. */
  release(keep: ReadonlySet<string>): void;
  /** Say one line now (the line before it stops); false when it cannot be heard (no sound, no clip). */
  speak(file: string, style: VoiceStyle): boolean;
  /** The line that is being said stops, over `seconds`. */
  hush(seconds?: number): void;
  /** A cue of the score from its beginning, over whatever cue is playing (null: the score fades out). */
  score(file: string | null, options?: { gain?: number; fade?: number }): void;
  /** Voice and score stop dead: the dream has broken off. */
  cut(): void;
  /** Everything that is not the film's voice or score goes down to this share of itself (0..1), over `seconds`: the cold open, the names. */
  quiet(share: number, seconds: number): void;
}

/** What the film needs from the page: the line at the foot of the picture. */
export interface FilmScreen {
  /** Show a spoken line for `seconds` (null takes the one showing away). */
  subtitle(text: Text | null, seconds: number, style: VoiceStyle): void;
}

/** The key of a line's clip: 32-bit FNV-1a of its Turkish text (UTF-8), in hex. The voice builder computes the same. */
export function voiceKey(text: string): string {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text.trim())) {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const clipFile = (key: string): string => `voice/${lang()}/${key}.mp3`;
const scoreFile = (cue: string): string => `score/${cue}.mp3`;

/** Seconds a line takes to say: its clip's length, or a guess from its letters when it has none. */
function spokenSeconds(text: Text): number {
  const clip = voiceManifest.clips[voiceKey(text.tr)];
  if (clip) return clip[lang() === 'tr' ? 0 : 1];
  const F = filmConfig.unvoiced;
  return Math.max(F.least, text[lang()].length * F.perLetter + F.rest);
}

/** Timeline position of a cue: seconds into a phase, or into a step of the journey. */
function cuePosition([where, seconds]: FilmCue): number {
  return (PHASES as readonly string[]).includes(where) ? phaseStart(where as Phase) + at(seconds) : stepProgress(where, seconds);
}

/** Timeline position at which a step of the journey (or a phase) ends. */
function cueEnd(where: string): number {
  const i = (PHASES as readonly string[]).indexOf(where);
  if (i >= 0) return i < PHASES.length - 1 ? phaseStart(PHASES[i + 1]) : 1;
  const placed = JOURNEY_STEPS[STEP_IDS.indexOf(where)];
  if (!placed) throw new Error(`no such step on the journey: ${where}`);
  return placed.to;
}

interface Placed {
  p: number;
  /** Where it lies now (a line that breaks off with its step lies one clip's length before the step's end, in the language showing). */
  position: () => number;
  fire: () => void;
  /** The file it needs, in the language showing. */
  file: () => string;
  /** The step of the journey it belongs to: -1 before the journey, the number of steps after it. */
  step: number;
}

/**
 * The film around the dream: the narrator's voice (the photograph's), the lines at the foot of the picture, and
 * the score. Lines and cues lie on the timeline (film.config.ts) and are said as time crosses them; a room's own
 * lines come through here too. One line at a time: a new one cuts the one before it.
 */
export class Film {
  /** The narrator is heard (the lines are shown either way). */
  voiceOn = true;
  private readonly placed: Placed[] = [];
  /** Files said or played by the piece itself rather than at a place of the timeline (the last street's choice), and their step. */
  private readonly also: { file: () => string; step: number }[] = [];
  private next = 0;
  private last = 0;
  private loadedFor: number | null = null;

  constructor(
    private readonly sound: FilmSound,
    private readonly screen: FilmScreen,
  ) {
    const stepOf = (where: string) => {
      const phase = (PHASES as readonly string[]).indexOf(where);
      return phase < 0 ? STEP_IDS.indexOf(where) : phase < PHASES.indexOf('WORLD') ? -1 : JOURNEY.length;
    };
    for (const line of LINES) {
      const style = line.voice ?? 'narrator';
      const position = () => (line.toEnd ? cueEnd(line.at[0]) - at(spokenSeconds(line.text)) : cuePosition(line.at));
      this.placed.push({ p: 0, position, fire: () => this.speak(line.text, style), file: () => clipFile(voiceKey(line.text.tr)), step: stepOf(line.at[0]) });
    }
    for (const cue of SCORE) {
      const position = () => (cue.toEnd ? cueEnd(cue.at[0]) - at(voiceManifest.score[cue.cue] ?? 0) : cuePosition(cue.at));
      this.placed.push({ p: 0, position, fire: () => this.sound.score(scoreFile(cue.cue), { gain: cue.gain, fade: cue.fade }), file: () => scoreFile(cue.cue), step: stepOf(cue.at[0]) });
    }
    for (const text of [STREET_CHOICE.home.text, STREET_CHOICE.stay.text]) this.also.push({ file: () => clipFile(voiceKey(text.tr)), step: JOURNEY.length });
    this.also.push({ file: () => scoreFile(STREET_CHOICE.home.cue), step: JOURNEY.length });
    // a clip's length and its file are the language's: both follow the switch
    onLang(() => {
      for (const c of this.placed) c.p = c.position();
      this.placed.sort((a, b) => a.p - b.p);
      this.seek(this.last);
      const index = this.loadedFor;
      this.loadedFor = null;
      if (index !== null) this.ahead(index);
    });
  }

  /** What lies ahead of `p` is what comes next. */
  private seek(p: number): void {
    this.next = this.placed.findIndex((c) => c.p > p);
    if (this.next < 0) this.next = this.placed.length;
  }

  /** A line said now: by the narrator's track, or by a room. */
  speak(text: Text, style: VoiceStyle = ROOM_VOICES[text.tr] ?? 'narrator', seconds = 0): void {
    const key = voiceKey(text.tr);
    const hold = Math.max(seconds && !voiceManifest.clips[key] ? seconds : 0, spokenSeconds(text) + filmConfig.subtitleRest);
    this.screen.subtitle(text, hold, style);
    if (this.voiceOn && voiceManifest.clips[key]) this.sound.speak(clipFile(key), style);
    else this.sound.hush(filmConfig.hush);
  }

  /** A cue of the score now (by its name under public/audio/score). */
  cue(name: string, fade = 0): void {
    this.sound.score(scoreFile(name), { fade });
  }

  /** The dream breaks off (a waking begins): nothing of the film is left in the air. */
  cut(): void {
    this.sound.cut();
    this.screen.subtitle(null, 0, 'narrator');
  }

  /**
   * Every frame: say what time has just crossed. A jump (a deep link, a skipped part, starting over) says nothing,
   * and going back puts what lies ahead back in line.
   */
  update(p: number, paused: boolean): void {
    if (paused) return;
    const step = p - this.last;
    this.last = p;
    if (step < 0 || step > at(filmConfig.jump)) {
      this.seek(p);
      if (step < 0) this.cut();
      return;
    }
    while (this.next < this.placed.length && this.placed[this.next].p <= p) this.placed[this.next++].fire();
  }

  /**
   * The journey has come to step `index` (-1 before it, the number of steps after it): fetch what this step and
   * the next two will say and play, and forget the rest.
   */
  ahead(index: number): void {
    if (index === this.loadedFor) return;
    this.loadedFor = index;
    const files = new Set<string>();
    for (const c of [...this.placed, ...this.also]) if (c.step >= index && c.step <= index + filmConfig.stepsAhead) files.add(c.file());
    // what the rooms of those steps say themselves
    for (let k = Math.max(0, index); k <= index + filmConfig.stepsAhead && k < JOURNEY.length; k++) {
      const s = JOURNEY[k];
      if (isRoom(s)) for (const key of voiceManifest.rooms[roomFile(s.room)] ?? []) files.add(clipFile(key));
    }
    this.sound.release(files);
    void this.sound.preload([...files]);
  }
}
