/** A span of a recording, in seconds from the start of its file. */
export type Span = { offset: number; duration: number };

/** A span played as a one-shot, with linear fades (s) so its cut points never click. */
export type Cut = Span & { fadeIn: number; fadeOut: number };

/** A recorded one-shot: `peak` is the dBFS its span is normalized to; `hit` is the transient's time in the file. */
export type SampleConfig = Cut & { url: string; peak: number; hit?: number };

/** A recorded bed looped over its span with an equal-power seam of `crossfade` s; `level` is its RMS in dBFS. */
export type BedConfig = Span & { url: string; level: number; crossfade: number };

export type SampleKey = 'shutter' | 'eject' | 'paper';

export type BedKey = 'city' | 'wind' | 'buzz';

/**
 * Mix and voicing of the real alley (gains are linear, levels in dBFS).
 * Recordings are CC0 Freesound HQ previews in public/audio (licence checked on each sound's page);
 * their spans come from a 20 ms RMS envelope of the decoded files. Every recording is optional:
 * a file that fails to load leaves the synthesized version in place.
 */
export const audioConfig = {
  masterGain: 0.9,
  musicGain: 0.3,
  sfxGain: 0.85,
  reverbSeconds: 3.8,
  reverbOuter: 0.12,
  reverbDream: 0.55,
  /** Low-pass cutoff when sound turns muffled while entering the photograph, and when it is open. */
  muffleHz: 520,
  openHz: 18000,
  /** Time constants (s): sound switching on/off, and falling silent when the tab is hidden. */
  fadeSeconds: 0.6,
  hideSeconds: 0.05,
  /** Share of the level left while the pause menu is open. */
  pausedLevel: 0.35,
  /** Last stage on the master, so the blows stay below -1 dBFS: threshold (dB), ratio, attack and release (s). */
  limiter: { threshold: -2.5, ratio: 20, attack: 0.001, release: 0.12 },
  /** The bell of a found memory: note (Hz), partials (multiple, amplitude), envelope (s). */
  discover: {
    note: 783.99,
    partials: [
      [1, 0.09],
      [2.01, 0.035],
      [3.97, 0.012],
    ] as [number, number][],
    attack: 0.008,
    release: 3.2,
  },
  /** Story mix: how much the alley ducks while the lens focuses, how fast the beds react (s), how much the muffle opens again inside. */
  mix: { focusDuck: 0.65, react: 0.12, openInside: 0.7 },
  ejectSeconds: 1.45,
  padVoiceGain: 0.022,
  /** Synthesized layers; city, wind and buzz are the fallbacks of the recorded beds. */
  ambience: { city: 0.22, wind: 0.07, buzz: 0.012 },
  /** Gain of the synthesized shutter body and spring layered under the recorded click. */
  shutterMechanism: 0.3,
  /** Seconds between the shutter's two curtains (measured on the recording, used by the synthesized layers). */
  shutterSecondCurtain: 0.036,
  /** Time constant (s) of the hand-over from a synthesized bed to its recording. */
  bedSwapSeconds: 0.8,
  /**
   * Near-silent tonal bed per story stage (Hz, 0 = silent voice): 0 the real alley (an open fifth), 1 after
   * the shutter (minor colour), 2 inside the picture and 3 the sea (nothing consoling remains), 4 awake
   * again (the first fifth an octave lower, and a little flat: the same alley, wrong).
   */
  chords: [
    [146.83, 220.0, 0, 0],
    [146.83, 220.0, 174.61, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [71.4, 107.1, 0, 0],
  ] as number[][],
  samples: {
    /**
     * Freesound 520684 (Tonik1105), a Contarex SLR: the first curtain at `hit`, the second ~36 ms later,
     * ringing out by 1.05 s. The loudest event of the prologue.
     */
    shutter: { url: 'audio/shutter.mp3', offset: 0.8, duration: 0.32, hit: 0.8186, peak: -3, fadeIn: 0.004, fadeOut: 0.1 },
    /**
     * Freesound 345906 (satanicupsman), a Polaroid Sun600: its shutter fires at 0.975 s, the motor runs
     * from 1.416 s to the stop at 3.13 s. Only the motor is used.
     */
    eject: { url: 'audio/instant.mp3', offset: 1.395, duration: 2, peak: -8, fadeIn: 0.01, fadeOut: 0.15 },
    /** Freesound 464302 (eyesonlegs): the last second of a photo sliding out, its stop at 1.39 s. */
    paper: { url: 'audio/paper.mp3', offset: 0.5, duration: 1.06, peak: -14, fadeIn: 0.12, fadeOut: 0.1 },
  } satisfies Record<SampleKey, SampleConfig>,
  /** Recorded beds of the real alley; each replaces its synthesized layer once loaded. */
  beds: {
    /** Freesound 427841 (leonelmail), quiet night city air; the file is the original's 50–78 s, cut on MP3 frames. */
    city: { url: 'audio/city.mp3', offset: 1.5, duration: 24, level: -33, crossfade: 2 },
    /** Freesound 45642 (stomachache), wind in a narrow street at night. */
    wind: { url: 'audio/wind.mp3', offset: 0.15, duration: 9.4, level: -40, crossfade: 1.5 },
    /**
     * Freesound 553075 (Nox_Sound), an exterior bulb buzzing at 50 Hz. The span length matches the
     * waveform at the seam (normalized cross-correlation 0.88 over the crossfade), so the loop stays in phase.
     */
    buzz: { url: 'audio/buzz.mp3', offset: 0.1, duration: 18.7859, level: -48, crossfade: 1 },
  } satisfies Record<BedKey, BedConfig>,
  /** Sparse drips in the real alley. */
  drips: {
    /**
     * Freesound 139749 (hybu), drops on a plate; the file is the original's 2.4–10.2 s, cut on MP3 frames.
     * Each slice rings out within `duration`.
     */
    url: 'audio/drops.mp3',
    // each slice starts ~25 ms before its drop: decoders differ on the first frame of a file cut on MP3 frames
    slices: [0.612, 2.729, 4.844, 6.958],
    duration: 0.45,
    peak: -26,
    fadeIn: 0.003,
    fadeOut: 0.15,
    lowpassHz: 3000,
    /** Random playback-rate spread (±) of each drop. */
    pitch: 0.1,
    /** Seconds between drips: the first value plus up to the second, at random. */
    gap: [2.5, 6],
  },
} as const;

// ---------------------------------------------------------------------------------- the nightmare

/**
 * Automation along the walk: [walk fraction, value] pairs, linear between them. Two keys at the same
 * walk are a cut: the layer stops or starts dead there.
 */
export type Keys = readonly (readonly [number, number])[];

/** A constant, or a value that follows the walk. */
export type Along = number | Keys;

/** A place in the walk frame (m): the layer or the blow comes from there; `ref` is the distance at which it is at half level. */
export interface Place {
  x: number;
  z: number;
  ref: number;
}

export interface FilterConfig {
  type: BiquadFilterType;
  hz: Along;
  q?: number;
}

/** Slow random motion: its speed (Hz, never faster than a sway) and depth of gain (share), pan, and filter (share). */
export interface Wander {
  hz: number;
  gain?: number;
  pan?: number;
  filter?: number;
}

/** What the nightmare synthesizes rather than records. */
export type NoiseKey = 'noise' | 'brown' | 'rustle';

/** The recordings of the nightmare (see scripts/audio-sources.json for where each comes from). */
const tapes = {
  breath: 'audio/breath.mp3',
  presence: 'audio/presence.mp3',
  whispers: 'audio/whispers.mp3',
  wall: 'audio/wall.mp3',
  heart: 'audio/heart.mp3',
  scrape: 'audio/scrape.mp3',
  chain: 'audio/chain.mp3',
  groan: 'audio/groan.mp3',
  creak: 'audio/creak.mp3',
  neon: 'audio/neon.mp3',
  child: 'audio/child.mp3',
  vocal: 'audio/vocal.mp3',
  drone: 'audio/drone.mp3',
  static: 'audio/static.mp3',
  projector: 'audio/projector.mp3',
  teeth: 'audio/teeth.mp3',
  bones: 'audio/bones.mp3',
  tear: 'audio/tear.mp3',
  wet: 'audio/wet.mp3',
  flies: 'audio/flies.mp3',
  scream: 'audio/scream.mp3',
  shriek: 'audio/shriek.mp3',
  choir: 'audio/choir.mp3',
  hum: 'audio/hum.mp3',
  tinnitus: 'audio/tinnitus.mp3',
  phone: 'audio/phone.mp3',
  steps: 'audio/steps.mp3',
  cave: 'audio/cave.mp3',
  room: 'audio/room.mp3',
  drops: audioConfig.drips.url,
  shutter: audioConfig.samples.shutter.url,
} as const;

export type TapeKey = keyof typeof tapes;

/** A span of a tape made into a seamless loop (lengths measured on the files, so tonal seams stay in phase). */
export interface LoopConfig extends Span {
  tape: TapeKey;
  crossfade: number;
}

const loops = {
  breath: { tape: 'breath', offset: 0.05, duration: 7.1845, crossfade: 0.15 },
  presence: { tape: 'presence', offset: 0.05, duration: 19.0705, crossfade: 2 },
  // four swells with silence between them: nothing to hide at the seam
  whispers: { tape: 'whispers', offset: 0.2, duration: 31.7, crossfade: 0.05 },
  wall: { tape: 'wall', offset: 0.5, duration: 17.5595, crossfade: 1.5 },
  neon: { tape: 'neon', offset: 0.2, duration: 18.1779, crossfade: 1.5 },
  vocal: { tape: 'vocal', offset: 0.5, duration: 15.652, crossfade: 1.5 },
  drone: { tape: 'drone', offset: 0.1, duration: 11.8965, crossfade: 1 },
  static: { tape: 'static', offset: 0.2, duration: 11.181, crossfade: 1 },
  // 14 turns of the reel's 2 Hz rhythm
  projector: { tape: 'projector', offset: 0.2, duration: 7.0019, crossfade: 0.8 },
  chatter: { tape: 'teeth', offset: 0.05, duration: 8.4685, crossfade: 0.3 },
  wet: { tape: 'wet', offset: 0.2, duration: 11.567, crossfade: 1.2 },
  flies: { tape: 'flies', offset: 0.2, duration: 10.4835, crossfade: 1.2 },
  choir: { tape: 'choir', offset: 0.2, duration: 23.59, crossfade: 2 },
  hum: { tape: 'hum', offset: 0.2, duration: 11.5775, crossfade: 1.1 },
  tinnitus: { tape: 'tinnitus', offset: 0.1, duration: 7.2369, crossfade: 0.8 },
  room: { tape: 'room', offset: 0.2, duration: 13.8155, crossfade: 1.6 },
} satisfies Record<string, LoopConfig>;

export type LoopKey = keyof typeof loops;

/**
 * A layer of the nightmare. It runs only while it is audible, and is a pure function of the walk (and
 * of fear, and of moving at all), so scrolling back undoes it.
 */
export interface TrackConfig {
  /** A recorded loop (also the alley's own wind and buzz), or a noise. */
  source: LoopKey | 'wind' | 'buzz' | NoiseKey;
  /** dB at full share: its RMS for a recording, a plain gain for a noise. */
  level: number;
  /** Its share (0..1) along the walk; 0 outside the keys. */
  keys: Keys;
  rate?: Along;
  filters?: readonly FilterConfig[];
  pan?: Along;
  wander?: Wander;
  /** Send levels: straight to the ears (default 1), and to the reverb of the space (default 0). */
  dry?: number;
  wet?: number;
  /** Time constant (s) of its level following the keys. */
  fade?: number;
  /** How much fear changes it: gain × (1 + fear × (f - .5)). */
  fear?: number;
  /** How much it swells on each heartbeat (share). */
  pulse?: number;
  /** How much of it depends on moving at all: at rest only (1 - move) is left. */
  move?: number;
  /** Saturation (dB of drive), so a sub drone gets harmonics that small speakers can play. */
  drive?: number;
  at?: Place;
  /** Where in its loop it starts (s); random without it. */
  start?: number;
}

/** Where things stand in the walk frame (they are the set pieces' own places). */
const PHONE: Place = { x: -1.75, z: -27, ref: 2.6 };
const CHAIR: Place = { x: 1.3, z: -21, ref: 3.2 };
const DINNER: Place = { x: 10.8, z: -78, ref: 14 };
const WHEELCHAIR: Place = { x: -9, z: -86, ref: 12 };
const CLASS: Place = { x: -11, z: -116, ref: 30 };
const SCREENS: Place = { x: 0, z: -123.5, ref: 10 };
const PROJECTOR: Place = { x: 2.16, z: -130.4, ref: 3.4 };

/** Seconds of the walk at the piece's own pace. */
const WALK_SECONDS = 135;

/** The teeth close here at the latest (the blow itself may come a little earlier). */
const TEETH = 0.74;
/** The passage through the giant print. */
const PASSAGE = 0.8935;
/** Where the face falls (Scares: C.face.at), and how long the scream takes to be drawn in before it (s). */
const FACE = 0.893;
const FACE_SECONDS = 1.15;

const tracks = {
  // the way in, and later the inside of the body and the print ahead
  rumble: {
    source: 'brown',
    level: -7,
    rate: 0.7,
    filters: [{ type: 'lowpass', hz: 150, q: 0.6 }],
    keys: [[0, 1], [0.03, 0.55], [0.07, 0], [0.637, 0], [0.665, 0.6], [TEETH, 1], [TEETH, 0], [0.852, 0], [PASSAGE, 1], [PASSAGE, 0], [0.9, 0], [0.93, 0.35], [1, 0.5]],
    drive: 12,
    fade: 0.3,
  },
  // I Saç: the rain's hiss dies
  hiss: {
    source: 'noise',
    level: -33,
    filters: [{ type: 'highpass', hz: 2600 }, { type: 'lowpass', hz: 9500 }],
    keys: [[0, 1], [0.012, 1], [0.052, 0]],
    wet: 0.25,
    fade: 0.5,
  },
  rustle: {
    source: 'rustle',
    level: -15,
    filters: [{ type: 'highpass', hz: 1500 }],
    keys: [[0.002, 0], [0.018, 1], [0.09, 0.9], [0.12, 0.25], [0.19, 0.12], [0.205, 0]],
    wander: { hz: 0.33, gain: 0.45, pan: 0.3 },
    move: 0.8,
    wet: 0.08,
  },
  breath: {
    source: 'breath',
    level: -37,
    rate: [[0, 0.86], [0.2, 0.86], [0.54, 0.96], [0.62, 1.28], [0.66, 1.36], [0.75, 0.88], [0.81, 0.88], [0.84, 1.26], [0.89, 1.08]],
    keys: [
      [0.006, 0], [0.03, 1], [0.09, 0.85], [0.135, 0],
      // the darkroom: it quickens
      [0.535, 0], [0.57, 0.55], [0.625, 1], [0.637, 0.7], [0.655, 0],
      // the void: and at .81 you hold it, and the other one goes on
      [0.752, 0], [0.77, 0.55], [0.8095, 0.6], [0.8105, 0], [0.84, 0], [0.85, 0.65], [0.889, 0.8], [PASSAGE, 0],
    ],
  },
  whispers: {
    source: 'whispers',
    level: -39,
    filters: [{ type: 'lowpass', hz: [[0, 2300], [0.2, 2600], [0.335, 7500]], q: 0.5 }],
    keys: [[0.008, 0], [0.035, 0.34], [0.095, 0.3], [0.13, 0], [0.2, 0], [0.25, 0.5], [0.335, 0.9], [0.342, 0]],
    wander: { hz: 0.09, pan: 0.55 },
    dry: 0.55,
    wet: 0.7,
  },
  // II Kazınmış Yüzler: wind in wires
  gusts: {
    source: 'wind',
    level: -40,
    filters: [{ type: 'bandpass', hz: 640, q: 1.4 }],
    keys: [[0.07, 0], [0.105, 1], [0.19, 0.85], [0.225, 0]],
    wander: { hz: 0.13, gain: 0.35, pan: 0.3, filter: 0.25 },
    wet: 0.3,
  },
  wire: {
    source: 'noise',
    level: -17,
    filters: [{ type: 'bandpass', hz: 1180, q: 22 }],
    keys: [[0.085, 0], [0.115, 1], [0.185, 0.9], [0.215, 0]],
    wander: { hz: 0.17, gain: 0.6, pan: 0.5, filter: 0.05 },
    wet: 0.25,
  },
  // III Yarım: the tube, the drone, the voices come closer
  neon: {
    source: 'neon',
    level: -29,
    pan: 0.25,
    keys: [[0.19, 0], [0.206, 1], [0.338, 1], [0.344, 0]],
    wander: { hz: 0.31, gain: 0.28, pan: 0.55 },
    wet: 0.2,
  },
  tube: {
    source: 'buzz',
    level: -32,
    pan: -0.2,
    keys: [[0.19, 0], [0.21, 1], [0.338, 1], [0.344, 0]],
    wander: { hz: 0.47, gain: 0.4, pan: 0.4 },
    wet: 0.1,
    fear: 0.6,
  },
  drone: {
    source: 'drone',
    level: -18,
    rate: [[0.12, 0.8], [0.335, 1], [0.637, 0.62], [TEETH, 1.35], [0.852, 0.55], [PASSAGE, 0.95]],
    keys: [[0.13, 0], [0.19, 0.3], [0.335, 1], [0.344, 0], [0.637, 0], [0.665, 0.55], [TEETH, 1], [TEETH, 0], [0.852, 0], [PASSAGE, 0.9], [PASSAGE, 0]],
    drive: 14,
    wet: 0.2,
    fade: 0.3,
  },
  // IV Beton: enormous space
  room: {
    source: 'room',
    level: -29,
    keys: [[0.338, 0], [0.352, 1], [0.52, 1], [0.527, 0]],
    wet: 0.45,
  },
  air: {
    source: 'wind',
    level: -40,
    rate: 0.46,
    filters: [{ type: 'lowpass', hz: 800 }],
    keys: [[0.338, 0], [0.36, 1], [0.52, 0.8], [0.527, 0]],
    wander: { hz: 0.06, gain: 0.35, pan: 0.4 },
    dry: 0.4,
    wet: 0.8,
  },
  vocal: {
    source: 'vocal',
    level: -35,
    filters: [{ type: 'lowpass', hz: 1700 }],
    keys: [[0.375, 0], [0.44, 0.6], [0.515, 1], [0.527, 0]],
    wander: { hz: 0.07, gain: 0.3, pan: 0.4 },
    dry: 0.6,
    wet: 0.8,
    fear: 0.5,
  },
  static: {
    source: 'static',
    level: -30,
    filters: [{ type: 'highpass', hz: 350 }],
    // up to the burst at the screens; back again after the silence, rising; the slit in the wall chokes it
    keys: [[0.45, 0], [0.49, 0.8], [0.4905, 0.2], [0.5255, 1], [0.5255, 0]],
    at: SCREENS,
    wander: { hz: 0.6, gain: 0.2 },
    wet: 0.5,
    fade: 0.2,
  },
  // V Karanlık Oda: the choir, low and dark; the reel
  choirDark: {
    source: 'choir',
    level: -26,
    rate: 0.8,
    filters: [{ type: 'lowpass', hz: 800 }],
    keys: [[0.528, 0], [0.565, 0.6], [0.632, 0.85], [0.64, 0]],
    dry: 0.8,
    wet: 0.5,
  },
  projector: {
    source: 'projector',
    level: -29,
    keys: [[0.53, 0], [0.55, 1], [0.592, 1], [0.596, 0]],
    at: PROJECTOR,
    wet: 0.25,
  },
  // VI Et
  wet: {
    source: 'wet',
    level: -33,
    keys: [[0.634, 0], [0.638, 1], [0.7, 0.85], [TEETH, 1], [TEETH, 0]],
    pulse: 0.5,
    fade: 0.15,
  },
  flies: {
    source: 'flies',
    level: -30,
    keys: [[0.645, 0], [0.675, 1], [0.71, 0.7], [TEETH, 0.45], [TEETH, 0]],
    wander: { hz: 0.21, gain: 0.25, pan: 0.7 },
    fade: 0.15,
  },
  chatter: {
    source: 'chatter',
    level: -28,
    rate: [[0.665, 0.86], [TEETH, 1.12]],
    keys: [[0.665, 0], [0.705, 0.2], [TEETH, 1], [TEETH, 0]],
    wander: { hz: 0.4, pan: 0.3 },
    fade: 0.15,
  },
  // VII Boşluk
  tinnitus: {
    source: 'tinnitus',
    level: -48,
    keys: [[0.748, 0], [0.772, 1], [0.85, 1], [PASSAGE, 0.6], [PASSAGE, 0]],
    fade: 0.6,
  },
  presence: {
    source: 'presence',
    level: -30,
    // the first exhale begins 2.6 s after it starts: just before you hold your breath at .81
    start: 0.1,
    pan: [[0.78, -0.62], [0.84, -0.62], [0.9, 0.58], [1, 0.58]],
    keys: [[0.785, 0], [0.802, 0.7], [0.827, 0.7], [0.836, 0], [0.905, 0], [0.93, 1], [0.985, 1], [1, 0.5]],
    wet: 0.1,
  },
  // VIII Yarım Güneş: oil, low wind, the choir in ruin
  lapping: {
    source: 'wet',
    level: -37,
    rate: 0.42,
    filters: [{ type: 'lowpass', hz: 620 }],
    keys: [[0.8955, 0], [0.912, 1], [0.985, 0.8], [1, 0.7]],
    wander: { hz: 0.085, gain: 0.45, pan: 0.3 },
    wet: 0.5,
  },
  seaWind: {
    source: 'wind',
    level: -41,
    rate: 0.62,
    filters: [{ type: 'lowpass', hz: 1300 }],
    keys: [[0.8955, 0], [0.92, 1], [1, 0.8]],
    wander: { hz: 0.1, gain: 0.4, pan: 0.5 },
    wet: 0.4,
  },
  ruin: {
    source: 'choir',
    level: -18,
    rate: 0.5,
    filters: [{ type: 'lowpass', hz: [[0.9, 900], [1, 1800]] }],
    keys: [[0.897, 0], [0.93, 0.75], [0.985, 1], [1, 1]],
    // it falls apart in slow holes, like a rotten film
    wander: { hz: 0.11, gain: 0.45, pan: 0.2 },
    dry: 0.7,
    wet: 1,
  },
  ruinUnder: {
    source: 'choir',
    level: -24,
    rate: 0.375,
    filters: [{ type: 'lowpass', hz: 420 }],
    keys: [[0.91, 0], [0.95, 1], [1, 1]],
    wet: 0.6,
  },
  hum: {
    source: 'hum',
    level: -27,
    rate: 0.75,
    filters: [{ type: 'lowpass', hz: 1000 }],
    keys: [[0.915, 0], [0.955, 1], [1, 1]],
    wander: { hz: 0.06, gain: 0.3, pan: 0.35 },
    dry: 0.5,
    wet: 0.8,
  },
  // ... growing with the walk to the photographer
  wall: {
    source: 'wall',
    level: -21,
    filters: [{ type: 'lowpass', hz: [[0.93, 1600], [1, 9000]], q: 0.5 }],
    keys: [[0.93, 0], [0.965, 0.1], [0.985, 0.38], [1, 1]],
    wander: { hz: 0.15, pan: 0.2 },
    wet: 0.45,
  },
} satisfies Record<string, TrackConfig>;

export type TrackKey = keyof typeof tracks;

/** Slices of a tape played as blows and events: [offset, duration] (s). Each is normalized by its own peak. */
export interface ShotConfig {
  tape: TapeKey;
  slices: readonly (readonly [number, number])[];
  fadeIn: number;
  fadeOut: number;
}

const shots = {
  step: { tape: 'steps', slices: [[0.012, 0.56], [0.6, 0.56], [1.175, 0.56], [1.755, 0.56], [2.375, 0.56], [2.985, 0.56]], fadeIn: 0.003, fadeOut: 0.14 },
  ring: { tape: 'phone', slices: [[0.2, 3.4], [5.55, 3.4]], fadeIn: 0.004, fadeOut: 0.9 },
  // the hinge's two falling and rising creaks: forth, back
  rock: { tape: 'creak', slices: [[5.6, 1.25], [9.1, 1.3]], fadeIn: 0.1, fadeOut: 0.12 },
  wheel: { tape: 'creak', slices: [[0.02, 2.28]], fadeIn: 0.05, fadeOut: 0.15 },
  // a long drag ending in its two hits at +5.3 s and +6.5 s, and a stretch of bare scraping
  drag: { tape: 'scrape', slices: [[11, 8.1]], fadeIn: 0.8, fadeOut: 0.6 },
  roll: { tape: 'scrape', slices: [[1.5, 4]], fadeIn: 0.6, fadeOut: 1 },
  slamHit: { tape: 'scrape', slices: [[17.455, 1.7]], fadeIn: 0.002, fadeOut: 0.5 },
  // all of the door; only its long main groan; only its knock and the groan's beginning
  groan: { tape: 'groan', slices: [[0.25, 9.05], [3.4, 5.2], [0.25, 5.4]], fadeIn: 0.01, fadeOut: 0.8 },
  knock: { tape: 'groan', slices: [[0.38, 0.6]], fadeIn: 0.002, fadeOut: 0.12 },
  chain: { tape: 'chain', slices: [[0.05, 3.2], [3.38, 3.5], [7.0, 5.8]], fadeIn: 0.02, fadeOut: 0.3 },
  cave: { tape: 'cave', slices: [[0.2, 6.2], [6.68, 6.2], [13.2, 5.7]], fadeIn: 0.003, fadeOut: 1.5 },
  drop: { tape: 'drops', slices: audioConfig.drips.slices.map((at) => [at, audioConfig.drips.duration] as const), fadeIn: 0.003, fadeOut: 0.15 },
  // a whisper right at your ear, its second of attack
  ear: { tape: 'whispers', slices: [[19.95, 1.9]], fadeIn: 0.06, fadeOut: 0.5 },
  // the rhyme stops at its third line, before anything falls
  child: { tape: 'child', slices: [[0.1, 8.35]], fadeIn: 0.05, fadeOut: 0.05 },
  flicker: { tape: 'neon', slices: [[6.4, 1.6], [2.9, 1.8]], fadeIn: 0.01, fadeOut: 0.2 },
  click: { tape: 'shutter', slices: [[0.8, 0.32]], fadeIn: 0.004, fadeOut: 0.1 },
  neck: { tape: 'presence', slices: [[2.7, 3.6]], fadeIn: 0.2, fadeOut: 1.6 },
  runout: { tape: 'projector', slices: [[8.6, 4.1]], fadeIn: 0.4, fadeOut: 0.6 },
  tear: { tape: 'tear', slices: [[0.55, 2], [4.8, 0.9], [7.7, 2]], fadeIn: 0.01, fadeOut: 0.3 },
  bone: {
    tape: 'bones',
    slices: [[0.335, 0.22], [0.585, 0.24], [2.5, 0.24], [3.775, 0.24], [4.635, 0.24], [5.67, 0.24], [7.035, 0.24], [7.715, 0.24]],
    fadeIn: 0.002,
    fadeOut: 0.08,
  },
  clack: { tape: 'teeth', slices: [[3.38, 0.16]], fadeIn: 0.002, fadeOut: 0.05 },
  slop: { tape: 'wet', slices: [[1.9, 0.9]], fadeIn: 0.005, fadeOut: 0.3 },
  through: { tape: 'shriek', slices: [[0.1, 2.2], [2.4, 2.3]], fadeIn: 0.4, fadeOut: 0.8 },
  shriek: { tape: 'shriek', slices: [[0.4, 1.05]], fadeIn: 0.004, fadeOut: 0.03 },
  burst: { tape: 'static', slices: [[4.2, 1.05]], fadeIn: 0.002, fadeOut: 0.02 },
} satisfies Record<string, ShotConfig>;

export type ShotKey = keyof typeof shots;

/** How one blow is played. `peak` is the dBFS its slice is normalized to. */
export interface PlayConfig {
  /** Which slice: in turn without it. */
  slice?: number;
  peak: number;
  rate?: number;
  pan?: number;
  lowpass?: number;
  highpass?: number;
  dry?: number;
  wet?: number;
  /** It comes from a place of the walk frame: `peak` is its level when you stand there. */
  from?: Place;
  /** It comes from behind (HRTF): meters to the side and behind you. */
  behind?: readonly [number, number];
  /** It stops dead after this many seconds, however far it had to go. */
  stopAfter?: number;
}

/**
 * One blow, falling where the walk crosses `at`, or the eye crosses `z`, going forward. Walking
 * back fires nothing; walking on again fires it again.
 */
export type CueConfig = PlayConfig & ({ at: number; z?: undefined } | { z: number; at?: undefined }) & { shot: ShotKey | 'horn' | 'inhale' };

/** Who follows you: a few steps from behind, and when you stop, they stop (they are fired by walking). */
const followed = (walks: readonly number[], behind: number, peak: number, lowpass: number, dry: number, wet: number): CueConfig[] =>
  walks.map((at, i) => ({ at, shot: 'step', slice: i, peak, behind: [i % 2 ? 0.5 : -0.5, behind] as const, lowpass, dry, wet }));

/** The darkroom's eight frames along the eye's way (their z in Darkroom.ts): one step per frame passed, each closer. */
const FRAMES = [-128, -130.7, -133.4, -136.1, -137.9, -141.6, -144.3, -147];
const framesSteps: CueConfig[] = FRAMES.map((z, i) => {
  const k = i / (FRAMES.length - 1);
  return {
    z,
    shot: 'step',
    slice: i,
    peak: -20 + 12 * k ** 1.5,
    rate: 0.94,
    behind: [i % 2 ? 0.35 : -0.35, 11 - 10 * k] as const,
    lowpass: 1100 * (8000 / 1100) ** k,
    dry: 0.5 + 0.5 * k,
    wet: 0.8 - 0.72 * k,
  };
});

const cues: readonly CueConfig[] = [
  // II: the telephone, ringing on your left as you come to it, cut off mid-ring just as you have passed it
  { at: 0.108, shot: 'ring', slice: 0, peak: -21, from: PHONE, wet: 0.6 },
  { at: 0.128, shot: 'ring', slice: 1, peak: -21, from: PHONE, wet: 0.6 },
  { at: 0.148, shot: 'ring', slice: 0, peak: -21, from: PHONE, wet: 0.6 },
  { at: 0.168, shot: 'ring', slice: 1, peak: -21, from: PHONE, wet: 0.6, stopAfter: 0.72 },
  // III: behind you, a few steps; a chair dragged once; closer steps; then they stop too
  ...followed([0.2195, 0.2241, 0.229, 0.2352], 15, -15, 2600, 0.55, 0.7),
  { at: 0.256, shot: 'drag', peak: -18, rate: 0.96, pan: 0.55, lowpass: 3800, dry: 0.7, wet: 0.7 },
  ...followed([0.2865, 0.2911, 0.2957, 0.301], 8, -10, 3600, 0.7, 0.55),
  // and right at your ear, just before the street ends
  { at: 0.324, shot: 'ear', peak: -15, pan: -0.92, lowpass: 9000 },
  // IV: the door somewhere ahead on the left; the chain; the wheelchair among the beds rolls by itself
  { at: 0.37, shot: 'groan', slice: 2, peak: -18, rate: 0.85, pan: -0.65, lowpass: 1700, dry: 0.45, wet: 1 },
  { at: 0.393, shot: 'chain', slice: 0, peak: -23, pan: -0.85, lowpass: 3000, dry: 0.5, wet: 1 },
  { at: 0.408, shot: 'wheel', peak: -21, rate: 0.62, from: WHEELCHAIR, lowpass: 2600, dry: 0.7, wet: 0.7 },
  { at: 0.411, shot: 'roll', peak: -24, rate: 0.75, from: WHEELCHAIR, lowpass: 2600, dry: 0.7, wet: 0.7 },
  // the music box has just stopped: from the class, very far, a child's voice answers it
  { at: 0.432, shot: 'child', peak: -13, rate: 0.97, from: CLASS, lowpass: 1500, highpass: 260, dry: 0.18, wet: 1 },
  { at: 0.444, shot: 'chain', slice: 2, peak: -22, pan: -0.8, lowpass: 3000, dry: 0.5, wet: 1 },
  // the door again, from behind and closer, its main groan running up to the screens
  { at: 0.47, shot: 'groan', slice: 1, peak: -15, rate: 0.72, pan: 0.6, lowpass: 1500, dry: 0.5, wet: 1 },
  // V: one step per frame passed; the reel runs out; the last step is at your neck, and it breathes
  ...framesSteps,
  { z: -137.5, shot: 'click', peak: -15, pan: 0.65, dry: 0.8, wet: 0.35 },
  { at: 0.593, shot: 'runout', peak: -18, from: PROJECTOR, wet: 0.3 },
  { at: 0.627, shot: 'neck', peak: -13, behind: [-0.25, 0.3] },
  // VI: swallowed; then tearing and bones, rarely
  { at: 0.636, shot: 'tear', slice: 1, peak: -15, rate: 0.5, lowpass: 2200 },
  { at: 0.668, shot: 'tear', slice: 0, peak: -23, pan: -0.4 },
  { at: 0.692, shot: 'bone', slice: 3, peak: -19, pan: 0.5 },
  { at: 0.712, shot: 'tear', slice: 2, peak: -20, pan: 0.35 },
  { at: 0.726, shot: 'bone', slice: 6, peak: -17, pan: -0.5 },
  // VII: one drop in water; one ring of the telephone, very far, stopped halfway
  { at: 0.778, shot: 'cave', slice: 1, peak: -20, rate: 0.92, pan: 0.25, dry: 0.6, wet: 1 },
  { at: 0.82, shot: 'ring', slice: 0, peak: -24, pan: 0.65, lowpass: 1500, dry: 0.3, wet: 1, stopAfter: 0.72 },
  // and the scream drawn in, up to the face at the print
  { at: FACE - FACE_SECONDS / WALK_SECONDS, shot: 'inhale', peak: -2.5 },
  // VIII: the ghost ship, off to the right
  { at: 0.925, shot: 'horn', peak: -24, pan: 0.6, dry: 0.5, wet: 1 },
  { at: 0.963, shot: 'horn', peak: -20, pan: 0.5, dry: 0.5, wet: 1 },
];

/** Sparse events inside a stretch of the walk: gap (s) is the first value plus up to the second; the ranges are drawn at random. */
export interface SprinkleConfig {
  shot: ShotKey;
  from: number;
  to: number;
  gap: readonly [number, number];
  peak: readonly [number, number];
  pan?: readonly [number, number];
  rate?: readonly [number, number];
  lowpass?: number;
  highpass?: number;
  dry?: number;
  wet?: number;
  place?: Place;
}

const sprinkles: readonly SprinkleConfig[] = [
  // the rocking chair, forth and back, whoever sits in it
  { shot: 'rock', from: 0.088, to: 0.195, gap: [1.3, 0.04], peak: [-22, -20], rate: [0.82, 0.9], lowpass: 3600, place: CHAIR, wet: 0.3 },
  // drops with huge echoes in the hall
  { shot: 'cave', from: 0.348, to: 0.52, gap: [3, 3.5], peak: [-30, -22], pan: [-0.9, 0.9], rate: [0.82, 1], dry: 0.4, wet: 1 },
  // close, in the darkroom
  { shot: 'drop', from: 0.535, to: 0.63, gap: [1.2, 2.2], peak: [-33, -22], pan: [-0.75, 0.75], rate: [0.9, 1.1], lowpass: 5000, wet: 0.25 },
  // somebody, heard through flesh
  { shot: 'through', from: 0.652, to: 0.73, gap: [4.2, 4.5], peak: [-16, -9], pan: [-0.8, 0.8], rate: [0.75, 1], lowpass: 360, wet: 0.05 },
];

/** A blow of pure synthesis: a sine falling from `from` to `hz` over `sweep` s and dying over `decay` s, under a band of noise. */
export interface HitConfig {
  hz: number;
  from: number;
  sweep: number;
  decay: number;
  peak: number;
  noise?: { hz: number; q: number; peak: number; decay: number };
}

/** Pitches of the tune, in cents above its tonic: a neutral second as in a Turkish lullaby, and a raised fourth that should not be there. */
const [D, E, F, G, Gs, A, Bb, C, Dh] = [0, 150, 300, 500, 610, 700, 800, 1000, 1200];
const [D4, E4, F4, G4, A4] = [D - 1200, E - 1200, F - 1200, G - 1200, A - 1200];
const [G3, A3, Bb3, C4] = [G - 2400, A - 2400, Bb - 2400, C - 2400];
const Cl = C - 1200;

/**
 * The sound of the nightmare, as a table along the walk: layers (`tracks`) that fade in and out with it,
 * blows (`cues`) that fall where it crosses them, sparse events (`sprinkles`), the heart, the tune, and the
 * big blows that the picture lands with (`scares`, called from director/Scares.ts). Levels are dBFS (peak for
 * blows, RMS for recorded layers), set from measurement, not by ear: A-weighted levels of an offline render of
 * the whole piece, with the alley at rest at about -40 dBA. Every recording is optional.
 */
export const nightConfig = {
  tapes,
  loops: loops as Readonly<Record<LoopKey, LoopConfig>>,
  tracks: tracks as Readonly<Record<TrackKey, TrackConfig>>,
  shots: shots as Readonly<Record<ShotKey, ShotConfig>>,
  cues,
  sprinkles,
  teeth: TEETH,
  walkSeconds: WALK_SECONDS,
  /** At most this many layers and blows at once: past it, sprinkled events wait. */
  maxVoices: 14,
  /** Layers are mixed at this rate (Hz). */
  controlRate: 30,
  /** Default time constant of a layer following its keys (s), the same at a cut, and how long it keeps running in silence (s). */
  fade: 0.35,
  cutFade: 0.025,
  release: 3,
  /** Going faster than this (walk / s) nothing is fired: a fast scroll must not rattle through every blow. */
  fastestCue: 0.06,
  /** The print's rumble follows how deep into the paper you are, to this power. */
  printRumble: 2,
  /** Where a place's distance dulls it: cutoff (Hz) far away and close to; behind you, a share of that. */
  air: { far: 1400, near: 9000, behind: 0.6 },
  /** The whole picture's cap of highs along the walk: a body is dull inside, until the mouth opens. */
  bodyHz: [[0.632, 18000], [0.65, 2800], [0.715, 3400], [TEETH, 9000], [0.745, 18000]] as Keys,
  /** How much of a layer's reverb send goes to each impulse, in each space: the small room and the long hall. */
  spaces: {
    alley: { room: 1, hall: 0.5 },
    street: { room: 1, hall: 0.25 },
    hall: { room: 0.3, hall: 1 },
    darkroom: { room: 0.7, hall: 0 },
    flesh: { room: 0.2, hall: 0 },
    void: { room: 0, hall: 1 },
    sea: { room: 0.2, hall: 1 },
  },
  spaceFade: 0.8,
  /**
   * The long reverb, drawn at start: seconds, T60 (s), the build-up of a huge room (s), brightness (a
   * one-pole's coefficient) at first and at the end with its time constant (s), and the first slaps off
   * the walls [s, share].
   */
  hall: {
    seconds: 8.5,
    t60: 7.2,
    build: 0.14,
    bright: 0.55,
    dark: 0.05,
    darkens: 1.3,
    slaps: [[0.083, 0.5], [0.137, 0.42], [0.211, 0.36], [0.347, 0.32], [0.523, 0.22], [0.79, 0.14]] as (readonly [number, number])[],
  },
  /** Grains per second of the dry rustle of hair, and how long they ring (samples). */
  rustle: { seconds: 3, grains: 85, shortest: 25, longest: 420, floor: 0.012 },
  /**
   * The heart: lub and dub are slices, the dub falling at `dubAt` of the beat's period (the director's
   * SECOND_BEAT); level (dB) at no fear and at full fear, the dub's share, how much faster the slices
   * run in panic, the synthesized sub under them, and how much the beat is saturated for small speakers.
   */
  heart: {
    tape: 'heart' as TapeKey,
    lub: [[0.25, 0.27], [1.42, 0.27], [3.87, 0.27], [5.03, 0.27], [10.03, 0.27]] as (readonly [number, number])[],
    dub: [[0.56, 0.34], [1.74, 0.34], [4.19, 0.34], [9.04, 0.34], [11.49, 0.34]] as (readonly [number, number])[],
    fadeIn: 0.01,
    fadeOut: 0.09,
    dubAt: 0.28,
    dubShare: 0.72,
    quiet: -12,
    loud: -1.5,
    panicRate: 1.25,
    sub: { hz: 47, peak: -5, decay: 0.24 },
    drive: 0.6,
    /** Its share along the walk: faint at the darkroom's end, in your chest in the meat (most under the great heart at z -172), barely in the void. */
    keys: [[0.585, 0], [0.635, 0.22], [0.645, 0.7], [0.7, 1], [0.72, 0.85], [TEETH, 1], [TEETH, 0], [0.758, 0], [0.775, 0.05], [0.86, 0.07], [PASSAGE, 0.2], [PASSAGE, 0], [0.93, 0], [0.99, 0.28], [1, 0.32]] as Keys,
  },
  /** The ship's horn: Hz of its voices, low-pass, and its envelope (s). */
  horn: { voices: [49, 49.3, 73.8], lowpass: 340, attack: 1.5, hold: 3.2, release: 2.8 },
  /** After the shutter: the alley's air decays to `floor` over `air` s, and one far wrong sound comes after `wrongAfter` s. */
  prologue: {
    air: 7,
    floor: 0.25,
    wrongAfter: 7.5,
    wrong: { shot: 'groan', peak: -24, rate: 0.62, pan: 0.6, lowpass: 1000, dry: 0.35, wet: 1 } as PlayConfig & { shot: ShotKey },
  },
  /**
   * Waking: the air comes back `airAfter` s after the view does, thinner (high-passed, slowed a little,
   * at a lower level). The cut made by the deafening shutter lifts at `back`, over `backIn` s. The tune comes last.
   */
  waking: { back: 0.8, backIn: 1.6, airAfter: 0.8, airIn: 2.4, air: 0.5, thinHz: 420, restHz: 20, rate: 0.93 },
  /** The last picture: the shutter's own level (dB), its second curtain late (s), the blow under it, and the ringing it leaves. */
  deafen: {
    peak: 2,
    second: 0.13,
    hit: { hz: 58, from: 190, sweep: 0.03, decay: 0.5, peak: -1.5, noise: { hz: 3000, q: 0.35, peak: 8, decay: 0.85 } } as HitConfig,
    ring: { hz: [5600, 3930], peak: -40, decay: 2.8 },
    /** Walk past which the shutter is the last one. */
    from: 0.999,
  },
  /** The blows of the piece (see director/Scares.ts). */
  scares: {
    crowd: { hit: { hz: 41, from: 68, sweep: 0.05, decay: 0.55, peak: -16 } as HitConfig },
    blackout: {
      fade: 0.012,
      /** Sound comes back by itself after this long (s), should the lights never be told to. */
      longest: 9,
      hit: { hz: 39, from: 96, sweep: 0.06, decay: 1.7, peak: -5, noise: { hz: 210, q: 0.7, peak: -3, decay: 0.45 } } as HitConfig,
    },
    lightsBack: {
      fade: 0.05,
      flicker: { shot: 'flicker', peak: -18, pan: 0.3, wet: 0.2 } as PlayConfig & { shot: ShotKey },
      /** The starter's ticks: delays (s). */
      ticks: [0, 0.11, 0.19, 0.42],
      tick: { hz: 4300, q: 5, peak: 0.07, decay: 0.012 },
    },
    screens: {
      seconds: 1,
      /** Silence after the burst (s), then the room coming back over this long. */
      hold: 0.55,
      back: 1.6,
      burst: { shot: 'burst', peak: -2.5 } as PlayConfig & { shot: ShotKey },
      shriek: { shot: 'shriek', peak: -5, rate: 1.08, highpass: 500 } as PlayConfig & { shot: ShotKey },
      hiss: { hz: 2600, q: 0.35, peak: 0.7 },
      hit: { hz: 52, from: 150, sweep: 0.06, decay: 0.85, peak: -3 } as HitConfig,
    },
    teeth: {
      /** Everything else is gone for this long (s), by then the layers have stopped too. */
      hold: 0.7,
      hit: { hz: 37, from: 135, sweep: 0.07, decay: 1, peak: -1.5, noise: { hz: 1300, q: 0.45, peak: 5, decay: 0.32 } } as HitConfig,
      /** The jaw bouncing once, after this long (s). */
      bounce: 0.105,
      again: { hz: 62, from: 180, sweep: 0.04, decay: 0.4, peak: -8 } as HitConfig,
      layers: [
        { shot: 'clack', peak: 4, rate: 0.42 },
        { shot: 'bone', slice: 0, peak: 3, rate: 0.55 },
        { shot: 'bone', slice: 7, peak: -1, rate: 0.8 },
        { shot: 'tear', slice: 1, peak: -2, rate: 0.6, stopAfter: 0.32 },
        { shot: 'slop', peak: -1, rate: 0.5, lowpass: 2400, stopAfter: 0.28 },
      ] as (PlayConfig & { shot: ShotKey })[],
    },
    face: {
      /** The swell's length (s): it begins this long before the blow falls (see the cues), which cuts it dead. */
      seconds: FACE_SECONDS,
      /** The span of the scream that is drawn in backwards (s), and how much of a gain it swells from. */
      span: { offset: 0.25, duration: 2.2 } as Span,
      tape: 'scream' as TapeKey,
      from: 0.02,
      /** The breath drawn with it: a band of noise rising (Hz). */
      breath: { from: 500, to: 5200, q: 0.8, peak: 0.22 },
      /** Silence after the cut (s), then the world coming back over this long. */
      hold: 0.75,
      back: 1,
    },
    slam: {
      fade: 0.006,
      hits: [
        { hz: 30, from: 125, sweep: 0.11, decay: 5.4, peak: -1, noise: { hz: 420, q: 0.6, peak: 5, decay: 0.7 } },
        { hz: 63, from: 70, sweep: 0.03, decay: 1.7, peak: -8, noise: { hz: 1500, q: 0.5, peak: 3, decay: 0.2 } },
        { hz: 113, from: 120, sweep: 0.02, decay: 0.75, peak: -12 },
      ] as HitConfig[],
      layers: [
        { shot: 'slamHit', peak: 2, rate: 0.55 },
        { shot: 'knock', peak: 0, rate: 0.5 },
      ] as (PlayConfig & { shot: ShotKey })[],
      /** The door's room: how much goes to the long reverb, and when its return closes (s after the blow, over 3 s). */
      wet: 0.7,
      closes: 3,
    },
  },
  /**
   * THE TUNE: a broken music box, composed for this piece, synthesized. Sixteen bars of a lullaby in
   * 3/4 (the score is below); it has never once reached its end. It stops at `stop`, on the note that
   * wants to fall to the tonic, just before it does: "her akşam yarım".
   */
  tune: {
    /** Tonic (Hz), seconds per beat, the sample rate it is drawn at, its random seed, and the silence before it (s). */
    tonic: 587.33,
    beat: 0.46,
    rate: 24000,
    seed: 1959,
    leadIn: 0.05,
    /** The hand that winds it: each note up to this share of a beat early or late; each bar's tempo drifting by a share. */
    jitter: 0.05,
    drift: 0.04,
    /** It runs down: from this bar on, its beats stretch, up to this many times in the last whole bar; and it hesitates (s) before the note it stops on. */
    ritardFrom: 11,
    ritard: 1.55,
    hesitate: 0.18,
    /** Bar (from 1) and note of the melody that it stops on; `ring` s later its cylinder catches, and the note is left ringing for `ringOut` s. */
    stop: { bar: 14, note: 0 },
    ring: 0.62,
    ringOut: 2.8,
    /** Each tine is out of tune by up to these cents. The G has lost its temper: it barely rings. */
    outOfTune: 13,
    dead: [G, G4] as readonly number[],
    tine: {
      /** Attack and ring (s), that of a dead tine; lower tines ring longer. */
      attack: 0.0008,
      decay: 0.82,
      deadDecay: 0.16,
      /** FM bite at the strike: index and how fast it dies (s). */
      fm: 1.5,
      fmDecay: 0.05,
      fmRatio: 3.01,
      /** A second, slightly sharp fundamental: the hollow beating of a cracked comb. */
      beat: 0.38,
      beatRatio: 1.0037,
      /** The tine's own overtones: ratio, amplitude, decay (s). */
      overtones: [[5.43, 0.26, 0.2], [13.3, 0.07, 0.04]] as (readonly [number, number, number])[],
      /** Slow wow of the whole box (share of pitch), and a tremble in each note (share, Hz). */
      wow: 0.0095,
      vibrato: 0.0028,
      vibratoHz: 4.4,
    },
    /** How hard each hand plays; and the pin's tick at each strike (level, decay in s). */
    levels: { melody: 1, bass: 0.58, inner: 0.34 },
    tick: { peak: 0.1, decay: 0.002 },
    /** The catch of its cylinder after the last note: a soft dull click (Hz, level, decay in s). */
    catch: { hz: 300, peak: 0.16, decay: 0.03 },
    /** One [pitch, beats] list per bar for the melody, and [pitch, on which beat] under it. */
    score: [
      { tune: [[A, 1], [F, 0.5], [E, 0.5], [F, 1]], under: [[D4, 0], [A4, 2]] },
      { tune: [[E, 1.5], [D, 0.5], [E, 1]], under: [[C4, 0], [G4, 2]] },
      { tune: [[F, 1], [G, 0.5], [F, 0.5], [E, 1]], under: [[Bb3, 0], [F4, 2]] },
      { tune: [[D, 2], [Cl, 1]], under: [[A3, 0]] },
      { tune: [[A, 1], [F, 0.5], [E, 0.5], [F, 1]], under: [[D4, 0], [A4, 2]] },
      { tune: [[Bb, 1.5], [A, 0.5], [G, 1]], under: [[G3, 0], [D4, 2]] },
      { tune: [[A, 1], [Gs, 0.5], [F, 0.5], [E, 1]], under: [[A3, 0], [E4, 2]] },
      { tune: [[D, 3]], under: [[D4, 0], [A4, 1], [D, 2]] },
      { tune: [[Dh, 1], [C, 0.5], [Bb, 0.5], [A, 1]], under: [[Bb3, 0], [F4, 2]] },
      { tune: [[Bb, 1], [A, 0.5], [G, 0.5], [F, 1]], under: [[G3, 0], [D4, 2]] },
      { tune: [[G, 1.5], [F, 0.5], [E, 1]], under: [[C4, 0], [G4, 2]] },
      { tune: [[F, 1], [Gs, 1], [A, 1]], under: [[A3, 0], [E4, 2]] },
      { tune: [[A, 1], [F, 0.5], [E, 0.5], [F, 1]], under: [[D4, 0], [A4, 2]] },
      // the D that follows here has never been heard
      { tune: [[E, 1.5], [D, 0.5], [Cl, 1]], under: [[C4, 0], [G4, 2]] },
      { tune: [[D, 1], [E, 0.5], [F, 0.5], [E, 1]], under: [[Bb3, 0], [F4, 2]] },
      { tune: [[D, 3]], under: [[D4, 0], [A4, 1], [D, 2]] },
    ] as readonly { tune: readonly (readonly [number, number])[]; under: readonly (readonly [number, number])[] }[],
    /**
     * Where it plays along the walk: from bar `bar`, between `from` and `to` (walk fractions): faint in
     * the hair, nearer by the dinner table, backwards and slowed in the darkroom. `peak` as for a blow.
     */
    plays: [
      { from: 0.008, to: 0.175, bar: 1, peak: -28, pan: -0.45, lowpass: 1700, dry: 0.4, wet: 0.9 },
      { from: 0.332, to: 0.45, bar: 6, peak: -21, place: DINNER, lowpass: 5200, wet: 0.65 },
      { from: 0.535, to: 0.625, bar: 1, reversed: true, rate: 0.72, peak: -28, pan: 0.3, lowpass: 1500, dry: 0.5, wet: 0.8 },
    ] as readonly TunePlay[],
    /** In the waking alley, `after` s after the view comes back: from bar `bar`, slowing to `endRate`, and it stops. */
    waking: { after: 1.5, bar: 11, endRate: 0.62, peak: -24, pan: -0.25, lowpass: 3200, dry: 0.6, wet: 0.7 },
  },
} as const;

/** One playing of the tune along the walk. */
export interface TunePlay {
  from: number;
  to: number;
  bar: number;
  reversed?: boolean;
  rate?: number;
  peak: number;
  pan?: number;
  place?: Place;
  lowpass: number;
  dry?: number;
  wet: number;
}
