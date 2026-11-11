import { audioConfig } from '../../config/audio.config';
import { roomFile } from '../../config/journey.config';
import type { AudioEngine } from '../audio/AudioEngine';

export interface RoomVoice {
  /** Gain now (fades over `seconds`). */
  gain(value: number, seconds?: number): void;
  /** Stereo place, -1..1. */
  pan(value: number, seconds?: number): void;
  /** Playback speed. */
  rate(value: number, seconds?: number): void;
  stop(seconds?: number): void;
}

export interface RoomVoiceOptions {
  gain?: number;
  /** Stereo place, -1..1. */
  pan?: number;
  rate?: number;
  /** Seconds of the file to start from, and how long to play (a one-shot only). */
  offset?: number;
  duration?: number;
  /** Sends this much to the long reverb. */
  reverb?: number;
  /** Low-pass (Hz), for what is heard through a wall or under water. */
  lowpass?: number;
  /** Seconds to fade in. */
  fade?: number;
}

const SILENT_VOICE: RoomVoice = { gain() {}, pan() {}, rate() {}, stop() {} };

/**
 * The sound of a room: its own files from public/audio, fetched before it is built and dropped afterwards.
 * Rooms run while the walk's layers are silent; they pass through the engine's master, limiter and reverb.
 * Every file is optional: a missing one is silence.
 */
export class RoomSound {
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly voices = new Set<{ src: AudioBufferSourceNode; level: GainNode }>();

  /** What the room now playing is lifted by in the mix (linear). */
  private trim = 1;
  /**
   * The room is being run forward to the moment it is cut into: what would sound once on the way there does not
   * (what loops starts as it would have).
   */
  skipping = false;

  constructor(private readonly engine: AudioEngine) {}

  /** The room that is starting: its voices are levelled against the other rooms' (see audioConfig.roomTrim). */
  levelFor(room: string | null): void {
    this.trim = 10 ** ((room ? (audioConfig.roomTrim[roomFile(room)] ?? 0) : 0) / 20);
  }

  /** Fetch and decode files (names under public/audio) before the room is built. */
  async load(files: readonly string[]): Promise<void> {
    await Promise.all(
      files.map(async (file) => {
        if (this.buffers.has(file)) return;
        const buffer = await this.engine.fetchSound(file);
        if (buffer) this.buffers.set(file, buffer);
      }),
    );
  }

  /** Drop files nothing needs anymore. */
  forget(keep: ReadonlySet<string>): void {
    for (const file of this.buffers.keys()) {
      if (keep.has(file)) continue;
      this.buffers.delete(file);
      this.engine.releaseSound(file);
    }
  }

  private start(file: string, loop: boolean, o: RoomVoiceOptions): RoomVoice {
    const buffer = this.buffers.get(file);
    const nodes = this.engine.roomOutput();
    if (!buffer || !nodes || (this.skipping && !loop)) return SILENT_VOICE;
    const { ctx, sfx, reverb } = nodes;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    src.playbackRate.value = o.rate ?? 1;
    const level = ctx.createGain();
    const trim = this.trim;
    const target = (o.gain ?? 1) * trim;
    const t = ctx.currentTime;
    level.gain.setValueAtTime(o.fade ? 0 : target, t);
    if (o.fade) level.gain.linearRampToValueAtTime(target, t + o.fade);
    const panner = ctx.createStereoPanner();
    panner.pan.value = o.pan ?? 0;
    let head: AudioNode = level;
    if (o.lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = o.lowpass;
      src.connect(filter);
      filter.connect(level);
    } else src.connect(level);
    head = level;
    head.connect(panner);
    panner.connect(sfx);
    if (o.reverb) {
      const send = ctx.createGain();
      send.gain.value = o.reverb;
      panner.connect(send);
      send.connect(reverb);
    }
    const voice = { src, level };
    this.voices.add(voice);
    src.onended = () => this.voices.delete(voice);
    if (loop) src.start(t, o.offset ?? Math.random() * buffer.duration);
    else if (o.duration !== undefined) src.start(t, o.offset ?? 0, o.duration);
    else src.start(t, o.offset ?? 0);
    return {
      gain: (value, seconds = 0.15) => level.gain.setTargetAtTime(value * trim, ctx.currentTime, Math.max(0.01, seconds / 3)),
      pan: (value, seconds = 0.15) => panner.pan.setTargetAtTime(value, ctx.currentTime, Math.max(0.01, seconds / 3)),
      rate: (value, seconds = 0.15) => src.playbackRate.setTargetAtTime(value, ctx.currentTime, Math.max(0.01, seconds / 3)),
      stop: (seconds = 0.2) => {
        level.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.01, seconds / 3));
        src.stop(ctx.currentTime + seconds + 0.1);
      },
    };
  }

  /** A file once. */
  play(file: string, options: RoomVoiceOptions = {}): RoomVoice {
    return this.start(file, false, options);
  }

  /** A file looping until stopped. */
  bed(file: string, options: RoomVoiceOptions = {}): RoomVoice {
    return this.start(file, true, options);
  }

  /** Everything of this room fades out. */
  stopAll(seconds = 0.3): void {
    const nodes = this.engine.roomOutput();
    if (!nodes) return;
    for (const v of this.voices) {
      v.level.gain.setTargetAtTime(0, nodes.ctx.currentTime, Math.max(0.01, seconds / 3));
      v.src.stop(nodes.ctx.currentTime + seconds + 0.1);
    }
    this.voices.clear();
  }
}
