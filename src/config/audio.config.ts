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
 * Mix and voicing of the sound design (gains are linear, levels in dBFS).
 * Recordings are CC0 Freesound HQ previews in public/audio (licence checked on each sound's page);
 * their spans come from a 20 ms RMS envelope of the decoded files. Every recording is optional:
 * a file that fails to load leaves the synthesized version in place.
 */
export const audioConfig = {
  masterGain: 0.9,
  musicGain: 0.5,
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
  /**
   * Story mix: how much the alley ducks while the lens focuses, how fast the beds react (s), how much the
   * muffle opens again inside, and the music's level outside the picture (fraction of musicGain).
   */
  mix: { focusDuck: 0.65, react: 0.12, openInside: 0.7, musicFloor: 0.6 },
  /** Distant, sourceless tones inside the picture: gap (s, first + random second), notes (Hz), partials. */
  dreamCalls: {
    gap: [14, 22],
    notes: [196, 233.1, 261.6, 293.7],
    partials: [
      [1, 0.05],
      [2.76, 0.018],
      [5.4, 0.008],
    ] as [number, number][],
    attack: 0.02,
    release: 6,
  },
  ejectSeconds: 1.45,
  padVoiceGain: 0.022,
  /** Synthesized layers; city, wind and buzz are the fallbacks of the recorded beds. */
  ambience: { city: 0.22, wind: 0.07, buzz: 0.012, dreamAir: 0.3, dreamTone: 0.006, sea: 0.22 },
  /**
   * The calm sea behind the giant print: a low swell of filtered noise breathing at `swellHz`, with a
   * faint wash of higher hiss on each breath (filters in Hz, `hiss` relative to the swell).
   */
  sea: { swellHz: 0.075, lowHz: 380, hissHz: 1500, hiss: 0.22, depth: 0.7 },
  /** Gain of the synthesized shutter body and spring layered under the recorded click. */
  shutterMechanism: 0.3,
  /** Seconds between the shutter's two curtains (measured on the recording, used by the synthesized layers). */
  shutterSecondCurtain: 0.036,
  /** Time constant (s) of the hand-over from a synthesized bed to its recording. */
  bedSwapSeconds: 0.8,
  /**
   * Tonal bed per story stage (Hz, 0 = silent voice):
   * 0 the real alley (an open fifth), 1 after the shutter (minor colour), 2 inside the picture,
   * 3 the sea (the same voices opening into a wide major chord), 4 awake again (the first fifth, an octave lower).
   */
  chords: [
    [146.83, 220.0, 0, 0],
    [146.83, 220.0, 174.61, 0],
    [116.54, 174.61, 261.63, 293.66],
    [130.81, 196.0, 329.63, 392.0],
    [73.42, 110.0, 220.0, 0],
  ] as number[][],
  samples: {
    /**
     * Freesound 520684 (Tonik1105), a Contarex SLR: the first curtain at `hit`, the second ~36 ms later,
     * ringing out by 1.05 s. The loudest event of the piece.
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
  /** Sparse drips in the real alley (silent inside the picture). */
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
