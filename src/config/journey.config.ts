/**
 * The whole journey, in order: seven evenings made of walks along the dream's way (see walk.config.ts) and
 * of rooms (see experience/rooms). While a room runs the walk stands still. Times are seconds of the piece
 * when nobody touches anything; everything else about time follows from them.
 */
import type { Text } from './copy.config';

/** How a step begins: a blink to black, the white of a flash, or nothing at all. */
export type Cut = 'black' | 'flash' | 'none';

export interface WalkStep {
  /** Fractions of the walk it goes between. */
  walk: readonly [number, number];
  seconds: number;
  cut?: Cut;
}

export interface RoomStep {
  /** File name in experience/rooms/list; `corridor@3` is the third visit to that same file. */
  room: string;
  seconds: number;
  cut?: Cut;
}

export type JourneyStep = WalkStep | RoomStep;

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

/** Before the walk: the alley, the shutter, the print, the way in. */
export const PROLOGUE_SECONDS = 34;
/** After the walk: the last picture and waking. */
export const WAKING_SECONDS = 11;

export const EVENINGS: readonly Evening[] = [
  {
    title: { tr: 'Birinci Akşam', en: 'The First Evening' },
    name: { tr: 'Saç', en: 'Hair' },
    steps: [
      { walk: [0, 0.19], seconds: 38 },
      { room: 'corridor@1', seconds: 34 },
      { room: 'waitingroom', seconds: 58 },
      { room: 'birches', seconds: 16 },
      { room: 'spiders', seconds: 68 },
      { room: 'corridor@2', seconds: 22 },
      { walk: [0.19, 0.34], seconds: 32 },
    ],
  },
  {
    title: { tr: 'İkinci Akşam', en: 'The Second Evening' },
    name: { tr: 'Yarım', en: 'Half' },
    steps: [
      { room: 'evening@2', seconds: 10 },
      { room: 'kitchen', seconds: 56 },
      { room: 'beds', seconds: 15 },
      { room: 'crawl', seconds: 62 },
      { room: 'corridor@3', seconds: 22 },
      { room: 'dentist', seconds: 66 },
      { walk: [0.34, 0.525], seconds: 46 },
    ],
  },
  {
    title: { tr: 'Üçüncü Akşam', en: 'The Third Evening' },
    name: { tr: 'Uyku', en: 'Sleep' },
    steps: [
      { room: 'evening@3', seconds: 10 },
      { room: 'karabasan', seconds: 80 },
      { room: 'mirror', seconds: 56 },
      { room: 'busstop', seconds: 16 },
      { room: 'elevator', seconds: 60 },
      { room: 'corridor@4', seconds: 22 },
      { walk: [0.525, 0.635], seconds: 28 },
    ],
  },
  {
    title: { tr: 'Dördüncü Akşam', en: 'The Fourth Evening' },
    name: { tr: 'Su', en: 'Water' },
    steps: [
      { room: 'evening@4', seconds: 10 },
      { room: 'flood', seconds: 46 },
      { room: 'deep', seconds: 76 },
      { room: 'pool', seconds: 16 },
      { room: 'ward', seconds: 60 },
      { room: 'corridor@5', seconds: 22 },
      { walk: [0.635, 0.76], seconds: 28 },
    ],
  },
  {
    title: { tr: 'Beşinci Akşam', en: 'The Fifth Evening' },
    name: { tr: 'Karanlık', en: 'Dark' },
    steps: [
      { room: 'evening@5', seconds: 10 },
      { room: 'darkness', seconds: 86 },
      { room: 'washing', seconds: 15 },
      { room: 'dolls', seconds: 56 },
      { room: 'chase', seconds: 42 },
      { room: 'buried', seconds: 66 },
      { walk: [0.76, 0.895], seconds: 32 },
    ],
  },
  {
    title: { tr: 'Altıncı Akşam', en: 'The Sixth Evening' },
    name: { tr: 'Boşluk', en: 'Nothing' },
    steps: [
      { room: 'evening@6', seconds: 10 },
      { room: 'beam', seconds: 66 },
      { room: 'shaft', seconds: 32 },
      { room: 'holes', seconds: 46 },
      { room: 'teeth', seconds: 16 },
      { room: 'exam', seconds: 56 },
      { room: 'party', seconds: 50 },
      { walk: [0.895, 0.98], seconds: 28 },
    ],
  },
  {
    title: { tr: 'Son Akşam', en: 'The Last Evening' },
    name: { tr: 'Sen', en: 'You' },
    steps: [
      { room: 'evening@7', seconds: 10 },
      { room: 'home', seconds: 76 },
      { room: 'stairs', seconds: 15 },
      { room: 'funeral', seconds: 56 },
      { room: 'corridor@6', seconds: 22 },
      { room: 'album', seconds: 70 },
      { walk: [0.98, 1], seconds: 12 },
    ],
  },
];

export const JOURNEY: readonly JourneyStep[] = EVENINGS.flatMap((e) => e.steps);

export const journeySeconds = JOURNEY.reduce((sum, s) => sum + s.seconds, 0);

export const isRoom = (s: JourneyStep): s is RoomStep => 'room' in s;

/** The file a room id is built from, and which visit it is (1 unless the id says otherwise). */
export function roomFile(id: string): string {
  return id.split('@')[0];
}

export function roomVisit(id: string): number {
  return Number(id.split('@')[1] ?? 1);
}

/** The step each evening begins with. */
export const eveningStarts: readonly number[] = (() => {
  let at = 0;
  return EVENINGS.map((e) => {
    const start = at;
    at += e.steps.length;
    return start;
  });
})();
