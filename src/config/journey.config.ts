/**
 * The whole journey, in order: seven evenings made of walks along the dream's way (see walk.config.ts), of
 * rooms (see experience/rooms) and, where an evening breaks off, of a moment back in the street (a waking).
 * While a room or a waking runs the walk stands still. Times are seconds of the piece when nobody touches
 * anything; everything else about time follows from them.
 *
 * A room is cut like a shot: `script` is the length it was written for, `play` the part of that script that
 * is shown, `seconds` how long that part takes on the screen (less than its own length: it runs faster).
 */
import type { Text } from './copy.config';

/** How a step begins: a blink to black, the white of a flash, a blink too short to notice, or nothing at all. */
export type Cut = 'black' | 'flash' | 'hard' | 'none';

export interface WalkStep {
  /** Fractions of the walk it goes between. */
  walk: readonly [number, number];
  seconds: number;
  cut?: Cut;
}

export interface RoomStep {
  /** File name in experience/rooms/list; `corridor@3` is the third visit to that same file. */
  room: string;
  /** Seconds on the screen. */
  seconds: number;
  /** Seconds the room's own script lasts (what the room is told it lasts); `seconds` when absent. */
  script?: number;
  /** The part of that script that is shown (seconds of the script); all of it when absent. */
  play?: readonly [number, number];
  cut?: Cut;
}

export interface WakeStep {
  /** Which waking it is (1 after the first evening): the dream breaks off and the street is there again. */
  wake: number;
  seconds: number;
  cut?: Cut;
}

export type JourneyStep = WalkStep | RoomStep | WakeStep;

export interface Evening {
  /** Which evening it is, and what it is about. */
  title: Text;
  name: Text;
  steps: readonly JourneyStep[];
}

/** Rooms lie along +x from here, beyond the far plane of the walk and of each other. */
export const ROOM_SPACE = 3000;
export const ROOM_STEP = 600;
/** Places rooms take turns in: never more than the running room and its neighbours exist at once. */
export const ROOM_SLOTS = 3;

/** Before anything is seen: the table, heard in the dark; and, for a moment, the street as it will be. */
export const COLD_SECONDS = 14;
/** Seconds of the cold open between which the street is seen as it will be, thirty-three years on. */
export const COLD_GLIMPSE: readonly [number, number] = [7.5, 11];
/** Before the walk: the alley, the shutter, the print, the way in. */
export const PROLOGUE_SECONDS = 34;
/** After the walk: the last picture and the street again, thirty-three years on. */
export const WAKING_SECONDS = 40;
/** Then the street as it really is: half past six, and a choice. */
export const STREET_SECONDS = 19;
/** Then the names. */
export const CREDITS_SECONDS = 41;

/** A waking is cut to with nothing between: the dream stops in the middle of a word. */
const wake = (n: number, seconds: number): WakeStep => ({ wake: n, seconds, cut: 'none' });

export const EVENINGS: readonly Evening[] = [
  {
    title: { tr: 'Birinci Akşam', en: 'The First Evening' },
    name: { tr: 'Saç', en: 'Hair' },
    steps: [
      { walk: [0, 0.19], seconds: 24 },
      { room: 'corridor@1', script: 34, seconds: 30, cut: 'hard' },
      { room: 'barber', seconds: 28, cut: 'hard' },
      { room: 'waitingroom', script: 58, play: [2, 56], seconds: 43, cut: 'hard' },
      { room: 'birches', script: 16, seconds: 13, cut: 'hard' },
      { room: 'spiders', script: 68, play: [0, 66], seconds: 48, cut: 'hard' },
      { walk: [0.19, 0.34], seconds: 26 },
      { room: 'corridor@2', seconds: 22, cut: 'hard' },
      wake(1, 14),
    ],
  },
  {
    title: { tr: 'İkinci Akşam', en: 'The Second Evening' },
    name: { tr: 'Yarım', en: 'Half' },
    steps: [
      { room: 'evening@2', script: 10, seconds: 9, cut: 'hard' },
      { room: 'kitchen', script: 56, play: [3, 54], seconds: 44, cut: 'hard' },
      { room: 'cellar', seconds: 16, cut: 'hard' },
      { room: 'crawl', script: 62, play: [1, 60], seconds: 47, cut: 'hard' },
      { room: 'studio', seconds: 24, cut: 'hard' },
      { room: 'dentist', script: 66, play: [1.5, 64], seconds: 51, cut: 'hard' },
      { walk: [0.34, 0.525], seconds: 30 },
      { room: 'corridor@3', seconds: 22, cut: 'hard' },
      wake(2, 12),
    ],
  },
  {
    title: { tr: 'Üçüncü Akşam', en: 'The Third Evening' },
    name: { tr: 'Uyku', en: 'Sleep' },
    steps: [
      { room: 'evening@3', script: 10, seconds: 9, cut: 'hard' },
      { room: 'busstop', seconds: 16, cut: 'hard' },
      { room: 'plane', seconds: 24, cut: 'hard' },
      { room: 'payphone', seconds: 22, cut: 'hard' },
      { room: 'elevator', script: 60, play: [1, 59], seconds: 45, cut: 'hard' },
      { room: 'beds', script: 15, seconds: 13, cut: 'hard' },
      { room: 'corridor@4', script: 22, seconds: 18 },
      { walk: [0.525, 0.635], seconds: 26 },
      { room: 'mirror', script: 56, play: [2, 54], seconds: 42, cut: 'hard' },
      { room: 'karabasan', script: 80, play: [8, 80], seconds: 60 },
      wake(3, 12),
    ],
  },
  {
    title: { tr: 'Dördüncü Akşam', en: 'The Fourth Evening' },
    name: { tr: 'Su', en: 'Water' },
    steps: [
      { room: 'evening@4', script: 10, seconds: 9, cut: 'hard' },
      { room: 'flood', script: 46, play: [1, 40], seconds: 32, cut: 'hard' },
      { room: 'deep', script: 76, play: [2, 74], seconds: 56, cut: 'hard' },
      { room: 'pool', script: 16, seconds: 14, cut: 'hard' },
      { room: 'lost', seconds: 28, cut: 'hard' },
      { room: 'ward', script: 60, play: [2, 58], seconds: 46, cut: 'hard' },
      { walk: [0.635, 0.76], seconds: 26 },
      { room: 'corridor@5', seconds: 22, cut: 'hard' },
      wake(4, 13),
    ],
  },
  {
    title: { tr: 'Beşinci Akşam', en: 'The Fifth Evening' },
    name: { tr: 'Karanlık', en: 'Dark' },
    steps: [
      { room: 'evening@5', script: 10, seconds: 9, cut: 'hard' },
      { room: 'darkness', script: 86, play: [2.5, 84], seconds: 54, cut: 'hard' },
      { room: 'washing', script: 15, seconds: 13, cut: 'hard' },
      { room: 'dolls', script: 56, play: [1, 54], seconds: 42 },
      { room: 'chase', script: 42, seconds: 38, cut: 'hard' },
      { walk: [0.76, 0.895], seconds: 26 },
      { room: 'birds', seconds: 14, cut: 'hard' },
      { room: 'buried', script: 66, play: [1, 66], seconds: 54 },
      wake(5, 12),
    ],
  },
  {
    title: { tr: 'Altıncı Akşam', en: 'The Sixth Evening' },
    name: { tr: 'Boşluk', en: 'Nothing' },
    steps: [
      { room: 'evening@6', script: 10, seconds: 9, cut: 'hard' },
      { room: 'beam', script: 66, play: [1, 65], seconds: 48, cut: 'hard' },
      { room: 'shaft', script: 32, seconds: 28, cut: 'none' },
      { room: 'holes', script: 46, play: [8, 44], seconds: 28, cut: 'hard' },
      { room: 'teeth', script: 16, seconds: 14, cut: 'hard' },
      { walk: [0.895, 0.98], seconds: 26 },
      { room: 'exam', script: 56, play: [1, 54], seconds: 43 },
      { room: 'party', script: 50, play: [1, 50], seconds: 40, cut: 'hard' },
      { room: 'car', seconds: 24, cut: 'hard' },
      { room: 'unseen', seconds: 34, cut: 'hard' },
      wake(6, 13),
    ],
  },
  {
    title: { tr: 'Son Akşam', en: 'The Last Evening' },
    name: { tr: 'Sen', en: 'You' },
    steps: [
      { room: 'evening@7', script: 10, seconds: 9, cut: 'hard' },
      { room: 'home', script: 76, play: [2, 74], seconds: 60, cut: 'hard' },
      { room: 'stairs', script: 15, seconds: 13, cut: 'hard' },
      { room: 'funeral', script: 56, play: [2, 55], seconds: 44, cut: 'hard' },
      { room: 'corridor@6', script: 22, seconds: 19, cut: 'hard' },
      { room: 'album', seconds: 68 },
      { walk: [0.98, 1], seconds: 14 },
    ],
  },
];

export const JOURNEY: readonly JourneyStep[] = EVENINGS.flatMap((e) => e.steps);

export const journeySeconds = JOURNEY.reduce((sum, s) => sum + s.seconds, 0);

export const isRoom = (s: JourneyStep): s is RoomStep => 'room' in s;

export const isWake = (s: JourneyStep): s is WakeStep => 'wake' in s;

/** The file a room id is built from, and which visit it is (1 unless the id says otherwise). */
export function roomFile(id: string): string {
  return id.split('@')[0];
}

export function roomVisit(id: string): number {
  return Number(id.split('@')[1] ?? 1);
}

/** Seconds a room's own script lasts. */
export function scriptSeconds(step: RoomStep): number {
  return step.script ?? step.seconds;
}

/** How far through its own script (0..1) a room is when the fraction `shown` (0..1) of its time on screen has passed. */
export function scriptAt(step: RoomStep, shown: number): number {
  const length = scriptSeconds(step);
  const [from, to] = step.play ?? [0, length];
  return (from + (to - from) * shown) / length;
}

/** The reverse: how much of its time on screen has passed when a room is `t` (0..1) through its own script. */
export function shownAt(step: RoomStep, t: number): number {
  const length = scriptSeconds(step);
  const [from, to] = step.play ?? [0, length];
  return Math.min(1, Math.max(0, (t * length - from) / (to - from)));
}

/** A name for every step: a room's id, `walk@3` for the third stretch of the walk, `wake@2` for the second waking. */
export const STEP_IDS: readonly string[] = (() => {
  let walks = 0;
  return JOURNEY.map((s) => (isRoom(s) ? s.room : isWake(s) ? `wake@${s.wake}` : `walk@${++walks}`));
})();

/** The step each evening begins with. */
export const eveningStarts: readonly number[] = (() => {
  let at = 0;
  return EVENINGS.map((e) => {
    const start = at;
    at += e.steps.length;
    return start;
  });
})();
