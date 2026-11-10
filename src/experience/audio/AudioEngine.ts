import { fearConfig, type RegionName } from '../../config/nightmare.config';
import {
  audioConfig,
  nightConfig as night,
  type Along,
  type BedConfig,
  type BedKey,
  type CueConfig,
  type Cut,
  type HitConfig,
  type Keys,
  type LoopKey,
  type Place,
  type PlayConfig,
  type SampleConfig,
  type SampleKey,
  type ShotKey,
  type Span,
  type TapeKey,
  type TrackConfig,
  type TrackKey,
  type TunePlay,
} from '../../config/audio.config';
import { walkConfig } from '../../config/walk.config';
import { clamp, damp, DEG, lerp, range, smootherstep, wobble } from '../math';
import { GlideTrack } from '../timeline/Track';

/** A running layer of the outer bus that can be faded out and stopped as a whole. */
type Voice = { out: GainNode; sources: AudioScheduledSourceNode[] };

/** A decoded recording and the gain that normalizes its span. */
type Recording = { buffer: AudioBuffer; gain: number };

/** Linear gain that brings a measured linear level to `db` dBFS. */
const toGain = (db: number, measured: number): number => (measured > 0 ? Math.pow(10, db / 20) / measured : 0);

const fromDb = (db: number): number => Math.pow(10, db / 20);

/** The blows the picture and the sound land together. */
export type ScareSound = 'crowd' | 'blackout' | 'lightsBack' | 'screens' | 'teeth' | 'face' | 'slam';

/** What the nightmare's sound follows, every frame. */
export interface NightmareSound {
  /** 0..1 progress of the walk. */
  walk: number;
  /** 0..1 how afraid the piece is. */
  fear: number;
  /** A heartbeat fell this frame. */
  beat: boolean;
  region: RegionName;
  /** 0..1 how far inside the picture the listener is. */
  inside: number;
}

/** A value along the walk: linear between its keys, held at both ends; of two keys at one place, the later wins. */
function valueAt(keys: Keys, walk: number): number {
  const last = keys.length - 1;
  if (walk < keys[0][0]) return keys[0][1];
  if (walk >= keys[last][0]) return keys[last][1];
  let i = 0;
  while (walk >= keys[i + 1][0]) i++;
  const [a, va] = keys[i];
  const [b, vb] = keys[i + 1];
  return va + (vb - va) * ((walk - a) / (b - a));
}

/** A layer's share along the walk: nothing outside its keys. */
function shareAt(keys: Keys, walk: number): number {
  return walk < keys[0][0] || walk > keys[keys.length - 1][0] ? 0 : valueAt(keys, walk);
}

const along = (v: Along, walk: number): number => (typeof v === 'number' ? v : valueAt(v, walk));

/** A deterministic random sequence: every run sounds the same. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where the walk carries the listener: the same curves the camera follows. */
const walkTrack = (pick: (key: (typeof walkConfig.keys)[number]) => number) =>
  new GlideTrack(
    walkConfig.keys.map((k) => k.at),
    walkConfig.keys.map(pick),
  );
const WALK = { x: walkTrack((k) => k.position[0]), z: walkTrack((k) => k.position[2]), yaw: walkTrack((k) => k.yaw) };

/** The walk fraction at which the eye crosses a walk-frame z (z only falls along the walk). */
function walkAtZ(z: number): number {
  let a = 0;
  let b = 1;
  for (let i = 0; i < 24; i++) {
    const m = (a + b) / 2;
    if (WALK.z.at(m) > z) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** The blows of the walk, in the order they fall. */
const CUES: readonly (CueConfig & { fall: number })[] = night.cues.map((c) => ({ ...c, fall: c.at ?? walkAtZ(c.z) })).sort((p, q) => p.fall - q.fall);

/** Walk per second at the piece's own pace. */
const AUTO_WALK = 1 / night.walkSeconds;
/** Hurrying counts up to this many times the piece's own pace; how fast it is noticed (1/s). */
const MOST_MOVING = 1.6;
const MOVING_RATE = 4;
const TAU = Math.PI * 2;
/** Below this share a layer counts as silent. */
const SILENT = 0.0006;
/** The sample rate of files decoded before there is a context (Hz). */
const DECODE_RATE = 48000;
/** A share jumping by this much within one mixing step is a cut in its keys. */
const CUT_JUMP = 0.2;
/** Scrolling back this far past a blow (walk) undoes it. */
const UNDO = 0.002;
/** The compressor node makes up gain by this power of its curve's level at full scale (one kernel, in every browser). */
const MAKE_UP = 0.6;
/** How many recordings are fetched at once. */
const FETCHES = 4;
/** `wobble` of time times this has its strongest sway at about the rate asked for. */
const WANDER = 3;
/** How much of a blow's pan its reverb send keeps. */
const WET_LEAN = 0.65;

/** Soft saturation (an input of 2 is nearly the ceiling): fed at half level, small signals pass at unity. */
const SATURATION = (() => {
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i - 1024) / 1024) * 2);
  return curve;
})();

/** One layer of the nightmare: its nodes exist all the time, its source only while it is heard. */
interface Layer {
  key: TrackKey;
  config: TrackConfig;
  base: number;
  level: GainNode;
  /** Filters that follow the walk or wander. */
  moving: { node: BiquadFilterNode; hz: Along; wanders: boolean }[];
  air: BiquadFilterNode | null;
  pan: StereoPannerNode;
  src: AudioBufferSourceNode | null;
  norm: number;
  share: number;
  gain: number;
  quietFor: number;
  seed: number;
}

/** A loop made seamless, and what normalizes it to 0 dBFS RMS. */
type Loop = { buffer: AudioBuffer; norm: number };

/** Slices of a tape, each with the gain that normalizes it to 0 dBFS peak. */
type Sliced = { buffer: AudioBuffer; gains: number[] };

/** The tune, drawn once: forwards, backwards, when each of its bars begins, and when its last note falls (s). */
type Tune = { forward: AudioBuffer; backward: AudioBuffer; bars: number[]; stopAt: number };

/** How one playing of the tune sounds. */
type TuneSound = Pick<TunePlay, 'bar' | 'reversed' | 'rate' | 'peak' | 'pan' | 'lowpass' | 'dry' | 'wet'>;

/** The tune while it plays. */
type TuneVoice = { src: AudioBufferSourceNode; gain: GainNode; lowpass: BiquadFilterNode; pan: StereoPannerNode; send: GainNode; level: number; play: TunePlay | null };

/**
 * The real alley is made of CC0 recordings (city air, wind, the lamp's buzz, drips, the shutter, the
 * instant-film motor, paper), each with a synthesized stand-in that plays until its file has loaded and
 * stays if it never does. The near-silent tonal bed that bends when the picture is taken is synthesized.
 *
 * The nightmare is a table along the walk (nightConfig in audio.config.ts): layers that are a pure
 * function of the walk, blows that fall where the walk crosses them, and what only synthesis can make:
 * rain, hair, wire, the ship's horn, the blows' bodies, and the tune, a broken music box that never ends.
 * Every recording is optional: without its file a layer or a blow is simply not there.
 * Nothing starts before a user gesture (autoplay policy); every promise is handled.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  /** Everything but the blows: closing it is silence, reverb tails included. */
  private cut!: GainNode;
  private outer!: GainNode;
  private thin!: BiquadFilterNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private muffle!: BiquadFilterNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private dripFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private samples = new Map<SampleKey, Recording>();
  private drops: { buffer: AudioBuffer; gains: number[] } | null = null;
  private beds = new Map<BedKey, Voice>();
  private padVoices: { osc: OscillatorNode; gain: GainNode }[] = [];
  private enabled = false;
  private hidden = false;
  private paused = false;
  private nextDrip = 0;
  private lastChord = -1;

  // the nightmare's nodes
  /** What the walk plays, straight to the ears; and what it sends to the reverb of the space. */
  private dryBus!: GainNode;
  private silentDecoder: OfflineAudioContext | null = null;
  private wetBus!: GainNode;
  private spaceRoom!: GainNode;
  private spaceHall!: GainNode;
  private cavern!: ConvolverNode;
  private cavernOpen!: GainNode;
  private impact!: GainNode;
  private impactWet!: GainNode;
  private follower!: PannerNode;
  private heartIn!: GainNode;

  // what it has loaded
  private readonly files = new Map<string, Promise<AudioBuffer | null>>();
  private readonly loops = new Map<string, Loop>();
  private readonly shots = new Map<ShotKey, Sliced>();
  private readonly airSources: AudioBufferSourceNode[] = [];
  private heartTape: { buffer: AudioBuffer; lub: number[]; dub: number[] } | null = null;
  private faceTape: Recording | null = null;
  private tune: Tune | null = null;

  // where the nightmare stands
  private readonly layers: Layer[] = [];
  private readonly random = seeded(1959);
  private readonly turns = new Map<ShotKey, number>();
  private readonly sprinkleTimers = night.sprinkles.map(() => 0);
  private tuneVoice: TuneVoice | null = null;
  private inhaling: { sources: AudioBufferSourceNode[]; gains: GainNode[] } | null = null;
  private time = 0;
  private lastWalk = 0;
  private nextCue = 0;
  private control = 0;
  /** How much the viewer is moving: 1 at the piece's own pace. */
  private moving = 1;
  private pulse = 0;
  private layersOn = 0;
  private blows = 0;
  private lubTurn = 0;
  private printRumble = 0;
  private sinceShutter = 0;
  private awakeFor = 0;
  private wasAwake = false;
  private wrongDone = false;
  private wakingTuneDone = false;
  /** Where along the walk the teeth closed. */
  private shutAt = Infinity;
  /** The blackout: where along the walk it began, and when it gives up by itself. */
  private dark = false;
  private darkAt = 0;
  private darkUntil = 0;
  /** The last shutter has deafened you; the last slam has fallen. */
  private deafened = false;
  private slammed = false;
  private bodyHz: number = audioConfig.openHz;
  private space: RegionName | null = null;
  /** Last result of `hear`: how near the place is (0..1), its pan, how much behind you (0..1). */
  private heardNear = 0;
  private heardPan = 0;
  private heardBehind = 0;

  /**
   * Must be called from a user gesture. Returns the new on/off state. Everything happens synchronously,
   * inside the gesture: the state flips first, and a suspended context is asked to resume right away.
   */
  async toggle(): Promise<boolean> {
    if (!this.ctx) this.start();
    if (!this.ctx) return false;
    this.enabled = !this.enabled;
    this.applyMaster(audioConfig.fadeSeconds);
    this.resume();
    return this.enabled;
  }

  /** True once the browser lets the context play. */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Fetch one file under public/audio for a room (null when missing or the sound is off for good). */
  async fetchSound(file: string): Promise<AudioBuffer | null> {
    return this.decode(`audio/${file}`);
  }

  /** Let go of a room's file: its samples live on only while a voice still plays them. */
  releaseSound(file: string): void {
    this.files.delete(`audio/${file}`);
  }

  /** Where a room's voices go, once sound runs. */
  roomOutput(): { ctx: AudioContext; sfx: AudioNode; reverb: AudioNode } | null {
    return this.ctx && this.sfx ? { ctx: this.ctx, sfx: this.sfx, reverb: this.reverbSend } : null;
  }

  private resume(): void {
    if (this.enabled && this.ctx?.state === 'suspended') this.ctx.resume().catch(() => undefined);
  }

  /** A hidden tab falls silent; sound comes back (if it was on) when the tab returns. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.applyMaster(hidden ? audioConfig.hideSeconds : audioConfig.fadeSeconds);
  }

  /** The pause menu: the dream goes on, quieter. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyMaster(audioConfig.fadeSeconds);
  }

  private applyMaster(timeConstant: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const level = this.enabled && !this.hidden ? audioConfig.masterGain * (this.paused ? audioConfig.pausedLevel : 1) : 0;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(level, t, timeConstant);
  }

  /** A gesture: switch sound on the first time (the default intention), and wake a context the browser held back. */
  async unlock(): Promise<boolean> {
    if (!this.ctx) return this.toggle();
    this.resume();
    return this.enabled;
  }

  private start(): void {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    try {
      this.ctx = new Ctx({ latencyHint: 'interactive' });
    } catch {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    // below its threshold the limiter must change nothing: the gain the node makes up by itself is taken off again
    const { threshold, ratio, attack, release } = audioConfig.limiter;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = threshold;
    limiter.knee.value = 0;
    limiter.ratio.value = ratio;
    limiter.attack.value = attack;
    limiter.release.value = release;
    const trim = this.gainNode(fromDb((threshold - threshold / ratio) * MAKE_UP));
    this.master.connect(comp).connect(limiter).connect(trim).connect(ctx.destination);

    this.cut = this.gainNode(1);
    this.cut.connect(this.master);

    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = audioConfig.openHz;
    this.muffle.Q.value = 0.4;
    this.muffle.connect(this.cut);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(audioConfig.reverbSeconds);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = audioConfig.reverbOuter;
    this.reverbSend.connect(this.reverb).connect(this.muffle);

    // the alley's air can thin out when you wake (at rest this high-pass is below anything it carries)
    this.thin = this.filter('highpass', night.waking.restHz);
    this.thin.connect(this.muffle);
    this.outer = this.gainNode(1);
    this.outer.connect(this.thin);
    this.outer.connect(this.reverbSend);
    this.music = this.gainNode(audioConfig.musicGain);
    this.music.connect(this.muffle);
    this.music.connect(this.reverbSend);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = audioConfig.sfxGain;
    this.sfx.connect(this.cut);
    this.sfx.connect(this.reverbSend);
    this.dripFilter = this.filter('lowpass', audioConfig.drips.lowpassHz);
    this.dripFilter.connect(this.outer);

    this.noise = this.makeNoise(false);
    this.brown = this.makeNoise(true);
    this.buildOuterAmbience();
    this.buildPad();
    this.buildNight();
    this.loadRecordings().catch(() => undefined);
  }

  // ---------------------------------------------------------------- recordings

  /** Fetch every recording; the prologue's first, each taking over from its synthesized stand-in as it arrives. */
  private async loadRecordings(): Promise<void> {
    const { samples, beds, drips } = audioConfig;
    await Promise.allSettled([
      ...(Object.keys(samples) as SampleKey[]).map(async (key) => {
        const s: SampleConfig = samples[key];
        const buffer = await this.decode(s.url);
        if (buffer) this.samples.set(key, { buffer, gain: toGain(s.peak, this.measure(buffer, s.offset, s.duration).peak) });
      }),
      ...(Object.keys(beds) as BedKey[]).map(async (key) => {
        const buffer = await this.decode(beds[key].url);
        if (buffer) this.swapBed(key, this.loopBuffer(buffer, beds[key]));
      }),
      (async () => {
        const buffer = await this.decode(drips.url);
        if (!buffer) return;
        const gains = drips.slices.map((offset) => toGain(drips.peak, this.measure(buffer, offset, drips.duration).peak));
        this.drops = { buffer, gains };
      })(),
    ]);
    await this.breathe();
    this.cavern.buffer = this.hallImpulse();
    await this.breathe();
    this.loops.set('rustle', { buffer: this.makeRustle(), norm: 1 });
    await Promise.allSettled([this.loadTapes(), this.renderTune()]);
    this.files.clear();
  }

  /** Give the page a frame between long stretches of work. */
  private breathe(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve));
  }

  /** The nightmare's recordings, a few at a time. */
  private async loadTapes(): Promise<void> {
    const queue = Object.keys(night.tapes) as TapeKey[];
    const fetcher = async (): Promise<void> => {
      for (let key = queue.shift(); key; key = queue.shift()) {
        const buffer = await this.decode(night.tapes[key]);
        if (buffer) this.takeTape(key, buffer);
      }
    };
    await Promise.allSettled(Array.from({ length: FETCHES }, fetcher));
  }

  /** What each layer and each blow needs of a tape that has arrived. */
  private takeTape(key: TapeKey, buffer: AudioBuffer): void {
    for (const name of Object.keys(night.loops) as LoopKey[]) {
      if (night.loops[name].tape !== key) continue;
      const loop = this.loopBuffer(buffer, night.loops[name]);
      this.loops.set(name, { buffer: loop, norm: toGain(0, this.measure(loop, 0, loop.duration).rms) });
    }
    for (const name of Object.keys(night.shots) as ShotKey[]) {
      const shot = night.shots[name];
      if (shot.tape === key) this.shots.set(name, { buffer, gains: this.sliceGains(buffer, shot.slices) });
    }
    if (key === night.heart.tape) this.heartTape = { buffer, lub: this.sliceGains(buffer, night.heart.lub), dub: this.sliceGains(buffer, night.heart.dub) };
    if (key === night.scares.face.tape) {
      const backwards = this.reversedSpan(buffer, night.scares.face.span);
      this.faceTape = { buffer: backwards, gain: toGain(0, this.measure(backwards, 0, backwards.duration).peak) };
    }
  }

  private sliceGains(buffer: AudioBuffer, slices: readonly (readonly [number, number])[]): number[] {
    return slices.map(([offset, duration]) => toGain(0, this.measure(buffer, offset, duration).peak));
  }

  /** A span of a recording played backwards. */
  private reversedSpan(src: AudioBuffer, span: Span): AudioBuffer {
    const from = Math.floor(span.offset * src.sampleRate);
    const n = Math.min(Math.floor(span.duration * src.sampleRate), src.length - from);
    const out = this.ctx!.createBuffer(src.numberOfChannels, n, src.sampleRate);
    for (let ch = 0; ch < src.numberOfChannels; ch++) {
      const d = src.getChannelData(ch);
      const o = out.getChannelData(ch);
      for (let i = 0; i < n; i++) o[i] = d[from + n - 1 - i];
    }
    return out;
  }

  /** Fetch and decode one file from /public (once); null when it is missing or cannot be decoded. */
  private decode(url: string): Promise<AudioBuffer | null> {
    let file = this.files.get(url);
    if (!file) {
      file = this.fetchFile(url);
      this.files.set(url, file);
    }
    return file;
  }

  private async fetchFile(url: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}${url}`);
      if (!res.ok) return null;
      return await this.decoder().decodeAudioData(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  /** The live context, or before the first gesture one that never plays: a decoded buffer works in any context. */
  private decoder(): BaseAudioContext {
    if (this.ctx) return this.ctx;
    this.silentDecoder ??= new OfflineAudioContext(2, 1, DECODE_RATE);
    return this.silentDecoder;
  }

  /** Peak and RMS (linear, over all channels) of a span of `buffer`. */
  private measure(buffer: AudioBuffer, offset: number, duration: number): { peak: number; rms: number } {
    const from = Math.floor(offset * buffer.sampleRate);
    const to = Math.min(buffer.length, from + Math.floor(duration * buffer.sampleRate));
    let peak = 0;
    let sum = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const d = buffer.getChannelData(ch);
      for (let i = from; i < to; i++) {
        peak = Math.max(peak, Math.abs(d[i]));
        sum += d[i] * d[i];
      }
    }
    return { peak, rms: Math.sqrt(sum / Math.max(1, (to - from) * buffer.numberOfChannels)) };
  }

  /**
   * Cut a bed's span into a seamless loop: the audio right after the span is laid over its head with an
   * equal-power crossfade, corrected for how correlated the two overlapping stretches are (a tonal buzz
   * would otherwise swell at the seam; for noise the correction vanishes).
   */
  private loopBuffer(src: AudioBuffer, bed: Span & Pick<BedConfig, 'crossfade'>): AudioBuffer {
    const sr = src.sampleRate;
    const start = Math.min(Math.round(bed.offset * sr), src.length - 1);
    const n = Math.min(Math.round(bed.duration * sr), src.length - start);
    const x = Math.min(Math.round(bed.crossfade * sr), n, src.length - start - n);
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let ch = 0; ch < src.numberOfChannels; ch++) {
      const d = src.getChannelData(ch);
      for (let i = 0; i < x; i++) {
        ab += d[start + i] * d[start + n + i];
        aa += d[start + i] * d[start + i];
        bb += d[start + n + i] * d[start + n + i];
      }
    }
    const r = aa > 0 && bb > 0 ? clamp(ab / Math.sqrt(aa * bb), 0, 1) : 0;
    const loop = this.ctx!.createBuffer(src.numberOfChannels, n, sr);
    for (let ch = 0; ch < src.numberOfChannels; ch++) {
      const d = src.getChannelData(ch);
      const o = loop.getChannelData(ch);
      o.set(d.subarray(start, start + n));
      for (let i = 0; i < x; i++) {
        const th = (i / x) * Math.PI * 0.5;
        o[i] = (d[start + i] * Math.sin(th) + d[start + n + i] * Math.cos(th)) / Math.sqrt(1 + r * Math.sin(2 * th));
      }
    }
    return loop;
  }

  /** Hand a bed over from its synthesized layer to a looped recording, normalized to the bed's level; the nightmare may use the loop too. */
  private swapBed(key: BedKey, loop: AudioBuffer): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const k = audioConfig.bedSwapSeconds;
    const voice = this.voice(0);
    const src = ctx.createBufferSource();
    src.buffer = loop;
    src.loop = true;
    const rms = this.measure(loop, 0, loop.duration).rms;
    const level = this.gainNode(toGain(audioConfig.beds[key].level, rms));
    src.connect(level).connect(voice.out);
    src.start(t, Math.random() * loop.duration);
    voice.sources.push(src);
    voice.out.gain.setTargetAtTime(1, t, k);
    const old = this.beds.get(key);
    if (old) this.release(old, t, k);
    this.beds.set(key, voice);
    this.airSources.push(src);
    this.loops.set(key, { buffer: loop, norm: toGain(0, rms) });
  }

  /** Fade a voice out over time constant `k`, then stop and disconnect it. */
  private release(voice: Voice, t: number, k: number): void {
    voice.out.gain.setTargetAtTime(0, t, k);
    voice.sources[0]?.addEventListener('ended', () => voice.out.disconnect(), { once: true });
    for (const s of voice.sources) s.stop(t + k * 8);
  }

  // ---------------------------------------------------------------- building blocks

  private makeNoise(brown: boolean): AudioBuffer {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (brown) {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        } else d[i] = w;
      }
    }
    return buf;
  }

  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 80 ? i / 80 : 1);
      }
    }
    return buf;
  }

  /**
   * The colossal hall: a slow build-up of reflections, a few slaps off far walls, and a tail that loses its
   * highs long before it dies. The convolver normalizes its energy, so this only shapes it.
   */
  private hallImpulse(): AudioBuffer {
    const ctx = this.ctx!;
    const h = night.hall;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * h.seconds);
    const buf = ctx.createBuffer(2, len, sr);
    const fall = Math.exp(-6.91 / (h.t60 * sr));
    const built = Math.exp(-1 / (h.build * sr));
    const darker = Math.exp(-1 / (h.darkens * sr));
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let amp = 1;
      let unbuilt = 1;
      let bright = h.bright - h.dark;
      let low = 0;
      for (let i = 0; i < len; i++) {
        low += (h.dark + bright) * (Math.random() * 2 - 1 - low);
        d[i] = low * amp * (1 - unbuilt);
        amp *= fall;
        unbuilt *= built;
        bright *= darker;
      }
      // each ear hears the far walls a little apart
      for (const [at, share] of h.slaps) {
        const from = Math.floor(at * sr * (ch ? 1.031 : 1));
        const n = Math.floor(sr * 0.004);
        for (let i = 0; i < n; i++) d[from + i] += share * (Math.random() * 2 - 1) * (1 - i / n);
      }
    }
    return buf;
  }

  /** Dry hair: short grains of noise, a different crackle in each ear, wrapping around so the loop has no seam. */
  private makeRustle(): AudioBuffer {
    const ctx = this.ctx!;
    const c = night.rustle;
    const len = Math.floor(ctx.sampleRate * c.seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const random = seeded(ch + 11);
      for (let i = 0; i < len; i++) d[i] = (random() * 2 - 1) * c.floor;
      for (let g = 0; g < c.seconds * c.grains; g++) {
        const at = Math.floor(random() * len);
        const n = Math.floor(lerp(c.shortest, c.longest, random() ** 3));
        const a = random() ** 2;
        for (let i = 0; i < n; i++) {
          const fade = 1 - i / n;
          d[(at + i) % len] += a * (random() * 2 - 1) * fade * fade;
        }
      }
    }
    return buf;
  }

  private loop(buffer: AudioBuffer, out: AudioNode, rate = 1): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    src.loopStart = Math.random() * 2;
    src.connect(out);
    src.start(0, Math.random() * 3);
    return src;
  }

  private lfo(freq: number, depth: number, target: AudioParam): OscillatorNode {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(target);
    o.start();
    return o;
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private gainNode(v: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = v;
    return g;
  }

  private saturator(): WaveShaperNode {
    const s = this.ctx!.createWaveShaper();
    s.curve = SATURATION;
    return s;
  }

  /** An empty layer feeding the outer bus. */
  private voice(gain: number): Voice {
    const out = this.gainNode(gain);
    out.connect(this.outer);
    return { out, sources: [] };
  }

  // ---------------------------------------------------------------- beds

  /** Synthesized stand-ins of the recorded beds. */
  private buildOuterAmbience(): void {
    this.beds.set('city', this.synthCity());
    this.beds.set('wind', this.synthWind());
    this.beds.set('buzz', this.synthBuzz());
  }

  /** Distant city: brown rumble with slow traffic swells. */
  private synthCity(): Voice {
    const a = audioConfig.ambience.city;
    const voice = this.voice(1);
    const city = this.gainNode(a);
    const lp = this.filter('lowpass', 260);
    voice.sources.push(this.loop(this.brown, lp), this.lfo(0.031, a * 0.45, city.gain));
    lp.connect(city).connect(voice.out);
    return voice;
  }

  /** Wind through the alley: band-passed noise breathing slowly. */
  private synthWind(): Voice {
    const a = audioConfig.ambience.wind;
    const voice = this.voice(1);
    const bp = this.filter('bandpass', 520, 0.55);
    const wind = this.gainNode(a);
    voice.sources.push(this.loop(this.noise, bp, 0.5), this.lfo(0.07, 260, bp.frequency), this.lfo(0.045, a * 0.6, wind.gain));
    bp.connect(wind).connect(voice.out);
    return voice;
  }

  /** The street lamp's mains hum. */
  private synthBuzz(): Voice {
    const a = audioConfig.ambience.buzz;
    const voice = this.voice(1);
    const hum = this.gainNode(a);
    const lp = this.filter('lowpass', 420);
    for (const [f, g] of [
      [50, 1],
      [100, 0.55],
      [150, 0.3],
      [250, 0.12],
    ]) {
      const o = this.ctx!.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.connect(this.gainNode(g)).connect(lp);
      o.start();
      voice.sources.push(o);
    }
    voice.sources.push(this.lfo(0.23, a * 0.25, hum.gain));
    lp.connect(hum).connect(voice.out);
    return voice;
  }

  private buildPad(): void {
    const ctx = this.ctx!;
    const lp = this.filter('lowpass', 900, 0.3);
    lp.connect(this.music);
    this.lfo(0.05, 320, lp.frequency);
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      osc.type = i % 2 ? 'sine' : 'triangle';
      osc.frequency.value = audioConfig.chords[0][i] || audioConfig.chords[1][0];
      const gain = this.gainNode(0);
      osc.connect(gain).connect(lp);
      osc.start();
      this.lfo(0.07 + i * 0.013, 1.4, osc.detune);
      this.padVoices.push({ osc, gain });
    }
  }

  /** A voice with no note just fades, holding its pitch. */
  private setChord(index: number): void {
    if (!this.ctx || index === this.lastChord) return;
    this.lastChord = index;
    const t = this.ctx.currentTime;
    const chord = audioConfig.chords[index];
    this.padVoices.forEach((v, i) => {
      if (chord[i] > 0) v.osc.frequency.setTargetAtTime(chord[i], t, 1.8);
      v.gain.gain.setTargetAtTime(chord[i] > 0 ? audioConfig.padVoiceGain : 0, t, 2.4);
    });
  }

  // ---------------------------------------------------------------- the nightmare's graph

  /** All of it exists from the start: only sources come and go. */
  private buildNight(): void {
    const ctx = this.ctx!;
    this.dryBus = this.gainNode(1);
    this.dryBus.connect(this.muffle);
    this.wetBus = this.gainNode(1);
    this.spaceRoom = this.gainNode(0);
    this.spaceHall = this.gainNode(0);
    this.wetBus.connect(this.spaceRoom).connect(this.reverbSend);
    // the long reverb's impulse is drawn a moment later (see loadRecordings); until then it is silent
    this.cavern = ctx.createConvolver();
    this.wetBus.connect(this.spaceHall).connect(this.cavern);
    this.cavern.connect(this.muffle);
    this.cavernOpen = this.gainNode(0);
    this.cavern.connect(this.cavernOpen).connect(this.master);

    // the blows land past the cut: they are what is heard when everything else has stopped
    this.impact = this.gainNode(1);
    this.impact.connect(this.gainNode(0.5)).connect(this.saturator()).connect(this.master);
    this.impactWet = this.gainNode(0);
    this.impact.connect(this.impactWet).connect(this.cavern);

    // the one who follows: one voice, placed behind you for each step
    this.follower = ctx.createPanner();
    this.follower.panningModel = 'HRTF';
    this.follower.distanceModel = 'linear';
    this.follower.rolloffFactor = 0;
    this.follower.connect(this.dryBus);

    // the heart: and a saturated copy of it, for speakers that cannot play its lows
    this.heartIn = this.gainNode(1);
    this.heartIn.connect(this.dryBus);
    this.heartIn
      .connect(this.gainNode(0.5))
      .connect(this.saturator())
      .connect(this.filter('highpass', 110))
      .connect(this.gainNode(night.heart.drive))
      .connect(this.dryBus);

    this.loops.set('noise', { buffer: this.noise, norm: 1 });
    this.loops.set('brown', { buffer: this.brown, norm: 1 });
    (Object.keys(night.tracks) as TrackKey[]).forEach((key, i) => this.layers.push(this.buildLayer(key, i)));
  }

  private buildLayer(key: TrackKey, index: number): Layer {
    const config: TrackConfig = night.tracks[key];
    const level = this.gainNode(0);
    let tail: AudioNode = level;
    if (config.drive) {
      tail = tail
        .connect(this.gainNode(fromDb(config.drive) * 0.5))
        .connect(this.saturator())
        .connect(this.gainNode(fromDb(-config.drive)));
    }
    const moving: Layer['moving'] = [];
    const wanders = Boolean(config.wander?.filter);
    for (const f of config.filters ?? []) {
      const node = this.filter(f.type, along(f.hz, 0), f.q);
      tail = tail.connect(node);
      if (typeof f.hz !== 'number' || wanders) moving.push({ node, hz: f.hz, wanders });
    }
    let air: BiquadFilterNode | null = null;
    if (config.at) {
      air = this.filter('lowpass', night.air.near);
      tail = tail.connect(air);
    }
    const pan = this.ctx!.createStereoPanner();
    pan.pan.value = along(config.pan ?? 0, 0);
    tail.connect(pan);
    pan.connect(this.gainNode(config.dry ?? 1)).connect(this.dryBus);
    if (config.wet) pan.connect(this.gainNode(config.wet)).connect(this.wetBus);
    return { key, config, base: fromDb(config.level), level, moving, air, pan, src: null, norm: 1, share: 0, gain: 0, quietFor: 0, seed: index * 3.7 };
  }

  /** Where a place of the walk frame is, heard from the walk at this point. */
  private hear(place: Place, walk: number): void {
    const yaw = WALK.yaw.at(walk) * DEG;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const dx = place.x - WALK.x.at(walk);
    const dz = place.z - WALK.z.at(walk);
    const d = Math.max(Math.hypot(dx, dz), 0.01);
    this.heardNear = 1 / (1 + (d / place.ref) ** 2);
    this.heardPan = clamp((dz * fx - dx * fz) / d, -1, 1);
    this.heardBehind = clamp(-(dx * fx + dz * fz) / d, 0, 1);
  }

  /** How much of its highs the last heard place keeps (Hz). */
  private airCutoff(): number {
    const a = night.air;
    return lerp(a.far, a.near, Math.sqrt(this.heardNear)) * lerp(1, a.behind, this.heardBehind);
  }

  /** Nothing of the walk's layers or sparse events sounds here. */
  private stopped(walk: number): boolean {
    return this.deafened || this.slammed || (walk >= this.shutAt && walk < night.teeth);
  }

  private mixLayers(s: NightmareSound, t: number, step: number): void {
    const walk = s.walk;
    const stopped = !this.enabled || this.stopped(walk);
    let on = 0;
    for (const l of this.layers) {
      const c = l.config;
      let share = stopped ? 0 : shareAt(c.keys, walk) * s.inside;
      if (l.key === 'rumble' && !stopped) share = Math.max(share, this.printRumble);

      if (share > SILENT) {
        l.quietFor = 0;
        if (!l.src) this.begin(l, t);
      } else if (l.src) {
        l.quietFor += step;
        if (l.quietFor > night.release) this.end(l, t);
      }
      if (l.src) {
        on++;
        this.mixLayer(l, s, share, t);
      }
      l.share = share;
    }
    this.layersOn = on;
  }

  private mixLayer(l: Layer, s: NightmareSound, share: number, t: number): void {
    const c = l.config;
    const w = c.wander;
    const walk = s.walk;
    let gain = share * l.base * l.norm;
    if (c.move) gain *= 1 - c.move + c.move * this.moving;
    if (c.fear) gain *= 1 + c.fear * (s.fear - 0.5);
    if (c.pulse) gain *= 1 + c.pulse * this.pulse;
    let pan = along(c.pan ?? 0, walk);
    if (c.at) {
      this.hear(c.at, walk);
      gain *= this.heardNear;
      pan = this.heardPan;
      l.air!.frequency.setTargetAtTime(this.airCutoff(), t, 0.15);
    }
    if (w?.gain) gain *= 1 + w.gain * wobble(this.time * w.hz * WANDER, l.seed);
    if (w?.pan) pan += w.pan * wobble(this.time * w.hz * WANDER, l.seed + 2.3);
    if (c.at || w?.pan || typeof c.pan === 'object') l.pan.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.2);

    const jump = Math.abs(share - l.share) > CUT_JUMP;
    if (jump || Math.abs(gain - l.gain) > 0.01 * l.gain + 1e-5) {
      l.level.gain.setTargetAtTime(gain, t, jump ? night.cutFade : (c.fade ?? night.fade));
      l.gain = gain;
    }
    if (c.rate !== undefined && typeof c.rate !== 'number') l.src!.playbackRate.setTargetAtTime(valueAt(c.rate, walk), t, 0.5);
    for (const f of l.moving) {
      const sway = f.wanders ? 1 + w!.filter! * wobble(this.time * w!.hz * WANDER, l.seed + 5.1) : 1;
      f.node.frequency.setTargetAtTime(along(f.hz, walk) * sway, t, 0.2);
    }
  }

  private begin(l: Layer, t: number): void {
    const loop = this.loops.get(l.config.source);
    if (!loop) return;
    const src = this.ctx!.createBufferSource();
    src.buffer = loop.buffer;
    src.loop = true;
    src.playbackRate.value = along(l.config.rate ?? 1, this.lastWalk);
    src.connect(l.level);
    src.start(t, l.config.start ?? this.random() * loop.buffer.duration);
    l.src = src;
    l.norm = loop.norm;
  }

  private end(l: Layer, t: number): void {
    l.src!.stop(t);
    l.src!.disconnect();
    l.src = null;
    l.gain = 0;
    l.level.gain.cancelScheduledValues(t);
    l.level.gain.setValueAtTime(0, t);
  }

  /** How much of the wet send goes to the small room and how much to the long hall. */
  private mixSpace(region: RegionName, t: number): void {
    if (region === this.space) return;
    this.space = region;
    const s = night.spaces[region];
    this.spaceRoom.gain.setTargetAtTime(s.room, t, night.spaceFade);
    this.spaceHall.gain.setTargetAtTime(s.hall, t, night.spaceFade);
  }

  // ---------------------------------------------------------------- one-shots

  private env(g: GainNode, t: number, attack: number, peak: number, decay: number): void {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private burst(t: number, freq: number, q: number, peak: number, decay: number, out: AudioNode = this.sfx): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.filter('bandpass', freq, q);
    const g = this.gainNode(0);
    src.connect(f).connect(g).connect(out);
    this.env(g, t, 0.001, peak, decay);
    src.start(t, Math.random() * 2);
    src.stop(t + decay + 0.05);
  }

  private thump(t: number, freq: number, peak: number, decay: number, out: AudioNode = this.sfx): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(freq * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.03);
    const g = this.gainNode(0);
    o.connect(g).connect(out);
    this.env(g, t, 0.002, peak, decay);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  /** A blow of pure synthesis, past the cut. */
  private hit(t: number, h: HitConfig): void {
    const o = this.ctx!.createOscillator();
    o.frequency.setValueAtTime(h.from, t);
    o.frequency.exponentialRampToValueAtTime(h.hz, t + h.sweep);
    const g = this.gainNode(0);
    o.connect(g).connect(this.impact);
    this.env(g, t, 0.002, fromDb(h.peak), h.decay);
    o.start(t);
    o.stop(t + h.decay + 0.05);
    if (h.noise) this.burst(t, h.noise.hz, h.noise.q, fromDb(h.noise.peak), h.noise.decay, this.impact);
  }

  /** Play one span of `buffer` at `t` with linear fades at both cuts; `rate` re-pitches it. */
  private segment(buffer: AudioBuffer, cut: Cut, gain: number, t: number, out: AudioNode, rate = 1): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.gainNode(0);
    const len = cut.duration / rate;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + cut.fadeIn);
    g.gain.setValueAtTime(gain, t + len - cut.fadeOut);
    g.gain.linearRampToValueAtTime(0, t + len);
    src.connect(g).connect(out);
    src.start(t, cut.offset, cut.duration);
    return src;
  }

  /** Play a loaded recording at `t`; returns the delay to its transient, or null while it is missing. */
  private playSample(key: SampleKey, t: number): number | null {
    const rec = this.samples.get(key);
    if (!rec) return null;
    const s: SampleConfig = audioConfig.samples[key];
    this.segment(rec.buffer, s, rec.gain, t, this.sfx);
    return (s.hit ?? s.offset) - s.offset;
  }

  /**
   * One blow of the nightmare from its slices. Without `out` it goes through the walk's own buses: the
   * cut silences it, the space's reverb carries it. With `out` (the blows' bus) nothing stops it.
   */
  private play(key: ShotKey, o: PlayConfig, out: AudioNode | null = null): void {
    const shot = this.shots.get(key);
    if (!shot) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const cfg = night.shots[key];
    const i = (o.slice ?? this.turn(key, cfg.slices.length)) % cfg.slices.length;
    const [offset, duration] = cfg.slices[i];
    let gain = shot.gains[i] * fromDb(o.peak);
    let lowpass = o.lowpass;
    let pan = o.pan ?? 0;
    let wet = o.wet ?? 0;
    if (o.from) {
      this.hear(o.from, this.lastWalk);
      gain *= this.heardNear;
      pan = this.heardPan;
      wet *= Math.sqrt(this.heardNear);
      lowpass = Math.min(lowpass ?? Infinity, this.airCutoff());
    }
    const entry = this.gainNode(1);
    let tail: AudioNode = entry;
    if (lowpass) tail = tail.connect(this.filter('lowpass', lowpass));
    if (o.highpass) tail = tail.connect(this.filter('highpass', o.highpass));
    if (out) {
      tail.connect(out);
    } else {
      const dry = this.gainNode(o.dry ?? 1);
      tail.connect(dry);
      if (o.behind) {
        const [x, z] = o.behind;
        this.follower.positionX.setValueAtTime(x, t);
        this.follower.positionZ.setValueAtTime(z, t);
        dry.connect(this.follower);
      } else {
        const stereo = ctx.createStereoPanner();
        stereo.pan.value = clamp(pan, -1, 1);
        dry.connect(stereo).connect(this.dryBus);
      }
      if (wet > 0) {
        // the room around a far sound leans the same way, or nothing far away would have a direction
        const room = ctx.createStereoPanner();
        room.pan.value = clamp(pan * WET_LEAN, -1, 1);
        tail.connect(this.gainNode(wet)).connect(room).connect(this.wetBus);
      }
    }
    const stop = o.stopAfter;
    const cut: Cut = { offset, duration: stop ?? duration, fadeIn: cfg.fadeIn, fadeOut: stop ? 0.006 : cfg.fadeOut };
    const src = this.segment(shot.buffer, cut, gain, t, entry, o.rate ?? 1);
    this.blows++;
    src.addEventListener('ended', () => this.blows--, { once: true });
  }

  /** The next slice of a shot, in turn. */
  private turn(key: ShotKey, count: number): number {
    const i = this.turns.get(key) ?? 0;
    this.turns.set(key, (i + 1) % count);
    return i;
  }

  private ready(): boolean {
    return !!this.ctx && this.enabled;
  }

  /** While the browser holds the context back no time passes in it: whatever was fired now would all sound at once later. */
  private audible(): boolean {
    return this.enabled && this.ctx?.state === 'running';
  }

  /** Strap, sleeve and a small plastic click as the camera comes up. */
  raise(): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 5; i++) this.burst(t + i * 0.06 + Math.random() * 0.03, 1800 + Math.random() * 1500, 0.6, 0.05, 0.12);
    this.burst(t + 0.42, 5200, 3, 0.18, 0.02);
  }

  /** Lens ring: a row of tiny detents. */
  focus(): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 7; i++) this.burst(t + i * 0.045, 6500, 6, 0.07, 0.012);
  }

  /** The recorded SLR click over a little of the synthesized body; fully synthesized without the file. At the end of the walk it deafens. */
  shutter(): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    if (this.lastWalk >= night.deafen.from) {
      this.deafen(t);
      return;
    }
    const hit = this.playSample('shutter', t);
    if (hit !== null) {
      this.mechanism(t + hit, audioConfig.shutterMechanism);
      return;
    }
    this.burst(t, 4200, 2.2, 0.55, 0.018);
    this.burst(t + 0.004, 1600, 1.4, 0.3, 0.03);
    this.burst(t + audioConfig.shutterSecondCurtain, 3800, 2.5, 0.42, 0.02);
    this.mechanism(t, 1);
  }

  /** Body and spring of the shutter: two low thumps and a short rattle, scaled by `amount`. */
  private mechanism(t: number, amount: number): void {
    this.thump(t, 140, 0.32 * amount, 0.07);
    this.thump(t + audioConfig.shutterSecondCurtain, 120, 0.2 * amount, 0.06);
    for (let i = 0; i < 4; i++) this.burst(t + 0.08 + i * 0.018, 7000, 8, (0.05 / (i + 1)) * amount, 0.01);
  }

  /** The last picture: both curtains as loud as the piece can go, then nothing but what it did to your ears. */
  private deafen(t: number): void {
    const d = night.deafen;
    this.deafened = true;
    this.stopTune(t);
    this.closeCut(t, 0.004);
    const rec = this.samples.get('shutter');
    if (rec) {
      const cut: SampleConfig = audioConfig.samples.shutter;
      const gain = rec.gain * fromDb(d.peak - cut.peak);
      this.segment(rec.buffer, cut, gain, t, this.impact);
      this.segment(rec.buffer, cut, gain, t + d.second, this.impact, 0.8);
    }
    this.hit(t, d.hit);
    this.hit(t + d.second, d.hit);
    for (const hz of d.ring.hz) {
      const o = this.ctx!.createOscillator();
      o.frequency.value = hz;
      const g = this.gainNode(0);
      o.connect(g).connect(this.impact);
      this.env(g, t + d.second, 0.01, fromDb(d.ring.peak), d.ring.decay);
      o.start(t);
      o.stop(t + d.second + d.ring.decay + 0.1);
    }
  }

  /** Instant-film motor pushing the print out. */
  eject(): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    if (this.playSample('eject', t) !== null) return;
    const dur = audioConfig.ejectSeconds;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(62, t);
    o.frequency.linearRampToValueAtTime(78, t + 0.2);
    o.frequency.linearRampToValueAtTime(70, t + dur);
    const lp = this.filter('lowpass', 900, 2);
    const g = this.gainNode(0);
    o.connect(lp).connect(g).connect(this.sfx);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.05);
    g.gain.setValueAtTime(0.16, t + dur - 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.05);
    // paper sliding over rollers
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.filter('bandpass', 2600, 0.9);
    const pg = this.gainNode(0);
    src.connect(bp).connect(pg).connect(this.sfx);
    pg.gain.setValueAtTime(0, t + 0.1);
    pg.gain.linearRampToValueAtTime(0.06, t + 0.3);
    pg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.start(t);
    src.stop(t + dur + 0.05);
    this.burst(t + dur - 0.04, 3000, 3, 0.12, 0.03);
  }

  /** A memory found: a small, clear bell, far away. */
  discover(): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const d = audioConfig.discover;
    for (const [mul, amp] of d.partials) {
      const o = this.ctx!.createOscillator();
      const g = this.gainNode(0);
      o.frequency.value = d.note * mul;
      o.connect(g).connect(this.sfx);
      this.env(g, t, d.attack, amp, d.release);
      o.start(t);
      o.stop(t + d.attack + d.release + 0.1);
    }
  }

  /** Fingers taking the print. */
  paper(): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    if (this.playSample('paper', t) !== null) return;
    for (let i = 0; i < 6; i++) this.burst(t + i * 0.05 + Math.random() * 0.04, 2800 + Math.random() * 2400, 0.8, 0.07, 0.07);
  }

  /** One drop: a random recorded slice, slightly re-pitched and dulled; a tiny falling blip without it. */
  private drip(t: number): void {
    const d = audioConfig.drips;
    if (this.drops) {
      const i = Math.floor(Math.random() * d.slices.length);
      const rate = 1 + (Math.random() * 2 - 1) * d.pitch;
      this.segment(this.drops.buffer, { ...d, offset: d.slices[i] }, this.drops.gains[i], t, this.dripFilter, rate);
      return;
    }
    const o = this.ctx!.createOscillator();
    const g = this.gainNode(0);
    const f = 900 + Math.random() * 700;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.04);
    o.connect(g).connect(this.outer);
    this.env(g, t, 0.001, 0.03, 0.06);
    o.start(t);
    o.stop(t + 0.1);
  }

  /** The ghost ship, very low and very far. */
  private horn(o: PlayConfig): void {
    const ctx = this.ctx!;
    const h = night.horn;
    const t = ctx.currentTime;
    const lp = this.filter('lowpass', h.lowpass);
    const g = this.gainNode(0);
    const level = fromDb(o.peak) / h.voices.length;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + h.attack);
    g.gain.setValueAtTime(level, t + h.attack + h.hold);
    g.gain.linearRampToValueAtTime(0, t + h.attack + h.hold + h.release);
    const end = t + h.attack + h.hold + h.release + 0.05;
    for (const hz of h.voices) {
      const v = ctx.createOscillator();
      v.type = 'sawtooth';
      v.frequency.value = hz;
      v.connect(lp);
      v.start(t);
      v.stop(end);
    }
    const stereo = ctx.createStereoPanner();
    stereo.pan.value = o.pan ?? 0;
    lp.connect(g).connect(stereo);
    stereo.connect(this.gainNode(o.dry ?? 1)).connect(this.dryBus);
    stereo.connect(this.gainNode(o.wet ?? 0)).connect(this.wetBus);
  }

  // ---------------------------------------------------------------- the heart

  /** One beat, as it falls: lub now, dub where the director will place it, the sub under both; in your chest, not in the room. */
  private heartbeat(s: NightmareSound): void {
    this.pulse = 1;
    const h = night.heart;
    const share = this.stopped(s.walk) ? 0 : shareAt(h.keys, s.walk) * s.inside;
    if (share <= SILENT || !this.audible()) return;
    const t = this.ctx!.currentTime;
    const level = fromDb(lerp(h.quiet, h.loud, s.fear)) * share;
    const rate = lerp(1, h.panicRate, s.fear);
    const period = 1 / lerp(fearConfig.heart.calm, fearConfig.heart.panic, s.fear);
    const dubAt = t + period * h.dubAt;
    this.thump(t, h.sub.hz, fromDb(h.sub.peak) * level, h.sub.decay, this.heartIn);
    this.thump(dubAt, h.sub.hz, fromDb(h.sub.peak) * level * h.dubShare, h.sub.decay, this.heartIn);
    const tape = this.heartTape;
    if (!tape) return;
    const i = this.lubTurn;
    this.lubTurn = (i + 1) % h.lub.length;
    const slice = (span: readonly [number, number]): Cut => ({ offset: span[0], duration: span[1], fadeIn: h.fadeIn, fadeOut: h.fadeOut });
    this.segment(tape.buffer, slice(h.lub[i]), tape.lub[i] * level, t, this.heartIn, rate);
    this.segment(tape.buffer, slice(h.dub[i]), tape.dub[i] * level * h.dubShare, dubAt, this.heartIn, rate);
  }

  // ---------------------------------------------------------------- the tune

  /**
   * Draw the broken music box once, a few notes at a time. The wow, the hand winding it and the tines out
   * of tune are written into the buffer, so it stumbles in the same places every time it is heard.
   */
  private async renderTune(): Promise<void> {
    const c = night.tune;
    const random = seeded(c.seed);
    const notes: { at: number; cents: number; level: number }[] = [];
    const bars: number[] = [];
    let at: number = c.leadIn;
    let last = at;
    score: for (let b = 0; b < c.score.length; b++) {
      const bar = c.score[b];
      bars.push(at);
      // it runs down towards the place where it stops, and its speed was never steady
      const runDown = 1 + (c.ritard - 1) * range(c.ritardFrom - 1, c.stop.bar - 2, b) ** 2;
      const beat = c.beat * runDown * (1 + c.drift * Math.sin(b * 1.9 + 0.6));
      if (b === c.stop.bar - 1) at += c.hesitate;
      for (const [cents, on] of bar.under) notes.push({ at: at + on * beat + (on === 0 ? 0 : c.jitter * beat * (random() * 2 - 1)), cents, level: on === 0 ? c.levels.bass : c.levels.inner });
      let place = 0;
      for (let n = 0; n < bar.tune.length; n++) {
        const noteAt = at + place * beat + (place === 0 ? 0 : c.jitter * beat * (random() * 2 - 1));
        notes.push({ at: noteAt, cents: bar.tune[n][0], level: c.levels.melody });
        last = noteAt;
        if (b === c.stop.bar - 1 && n === c.stop.note) break score;
        place += bar.tune[n][1];
      }
      at += 3 * beat;
    }
    const rate = c.rate;
    // what follows the stop note in its own bar never sounds: only what falls at or before it does
    const heard = notes.filter((n) => n.at <= last + 1e-3);
    const data = new Float32Array(Math.ceil((last + c.ringOut) * rate));
    const tines = new Map<number, number>();
    for (let i = 0; i < heard.length; i++) {
      const n = heard[i];
      if (!tines.has(n.cents)) tines.set(n.cents, c.outOfTune * (random() * 2 - 1));
      this.strike(data, rate, n.at, c.tonic * 2 ** ((n.cents + tines.get(n.cents)!) / 1200), n.level, c.dead.includes(n.cents));
      if (i % 2 === 1) await this.breathe();
    }
    this.catchCylinder(data, rate, last + c.ring, random);
    const fade = Math.floor(0.3 * rate);
    for (let i = 0; i < fade; i++) data[data.length - 1 - i] *= i / fade;
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    const ctx = this.ctx!;
    const forward = ctx.createBuffer(1, data.length, rate);
    const backward = ctx.createBuffer(1, data.length, rate);
    const f = forward.getChannelData(0);
    const r = backward.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      f[i] = data[i] / peak;
      r[data.length - 1 - i] = f[i];
    }
    this.tune = { forward, backward, bars, stopAt: last };
  }

  /** One tine: struck with a little FM bite, ringing hollow with a sharp twin, wavering as the whole box does. */
  private strike(out: Float32Array, rate: number, at: number, hz: number, level: number, dead: boolean): void {
    const c = night.tune.tine;
    const dt = 1 / rate;
    const decay = (dead ? c.deadDecay : c.decay) * (440 / hz) ** 0.35;
    const start = Math.round(at * rate);
    const n = Math.min(out.length - start, Math.round(decay * 5 * rate));
    const fall = Math.exp(-dt / decay);
    const fmFall = Math.exp(-dt / c.fmDecay);
    const tick = night.tune.tick;
    const tickFall = Math.exp(-dt / tick.decay);
    const random = seeded(start);
    const overtones = c.overtones.filter(([ratio]) => hz * ratio < rate * 0.45);
    const ovAmp = overtones.map(([, amp]) => amp);
    const ovFall = overtones.map(([, , d]) => Math.exp(-dt / d));
    let ring = 1;
    let fm = c.fm;
    let tickAmp = tick.peak;
    let phase = 0;
    let twin = 0;
    for (let i = 0; i < n; i++) {
      const time = i * dt;
      const now = at + time;
      const wow = c.wow * (Math.sin(now * 1.45) * 0.6 + Math.sin(now * 3.83 + 1.3) * 0.4);
      const vibrato = c.vibrato * Math.min(1, time * 3) * Math.sin(time * c.vibratoHz * TAU);
      const step = hz * (1 + wow + vibrato) * dt * TAU;
      phase += step;
      twin += step * c.beatRatio;
      let v = ring * (Math.sin(phase + fm * Math.sin(phase * c.fmRatio)) + c.beat * Math.sin(twin));
      for (let k = 0; k < overtones.length; k++) {
        v += ovAmp[k] * Math.sin(phase * overtones[k][0]);
        ovAmp[k] *= ovFall[k];
      }
      v += tickAmp * (random() * 2 - 1);
      out[start + i] += level * Math.min(1, time / c.attack) * v;
      ring *= fall;
      fm *= fmFall;
      tickAmp *= tickFall;
    }
  }

  /** After the last note: the cylinder catching, a soft dull click, and that is all. */
  private catchCylinder(out: Float32Array, rate: number, at: number, random: () => number): void {
    const c = night.tune.catch;
    const start = Math.round(at * rate);
    const n = Math.min(out.length - start, Math.round(c.decay * 4 * rate));
    const fall = Math.exp(-1 / (c.decay * rate));
    let amp = c.peak;
    for (let i = 0; i < n; i++) {
      out[start + i] += amp * (Math.sin((i / rate) * c.hz * TAU) + 0.4 * (random() * 2 - 1));
      amp *= fall;
    }
  }

  /** Start the tune from a bar (backwards: from its end). */
  private startTune(o: TuneSound, play: TunePlay | null, t: number): AudioBufferSourceNode | null {
    const tune = this.tune;
    if (!tune) return null;
    this.stopTune(t);
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = o.reversed ? tune.backward : tune.forward;
    src.playbackRate.value = o.rate ?? 1;
    const lowpass = this.filter('lowpass', o.lowpass);
    const gain = this.gainNode(0);
    const pan = ctx.createStereoPanner();
    pan.pan.value = o.pan ?? 0;
    const send = this.gainNode(o.wet);
    src.connect(lowpass).connect(gain).connect(pan);
    pan.connect(this.gainNode(o.dry ?? 1)).connect(this.dryBus);
    pan.connect(send).connect(this.wetBus);
    const level = fromDb(o.peak);
    gain.gain.setValueAtTime(0, t);
    gain.gain.setTargetAtTime(play?.place ? 0 : level, t, 0.01);
    src.start(t, o.reversed ? 0 : tune.bars[o.bar - 1]);
    src.addEventListener(
      'ended',
      () => {
        if (this.tuneVoice?.src === src) this.tuneVoice = null;
      },
      { once: true },
    );
    this.tuneVoice = { src, gain, lowpass, pan, send, level, play };
    return src;
  }

  private stopTune(t: number): void {
    const v = this.tuneVoice;
    if (!v) return;
    this.tuneVoice = null;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0, t, 0.04);
    v.src.stop(t + 0.3);
  }

  /** Each playing begins where the walk crosses it. */
  private startPlays(walk: number, fast: boolean, t: number): void {
    if (fast || !this.audible()) return;
    const plays = night.tune.plays;
    for (let i = 0; i < plays.length; i++) {
      if (this.lastWalk < plays[i].from && walk >= plays[i].from) this.startTune(plays[i], plays[i], t);
    }
  }

  /** It ends where the walk leaves it, and while it plays it sounds from where it is. */
  private mixTune(walk: number, t: number): void {
    const v = this.tuneVoice;
    const play = v?.play;
    if (!v || !play) return;
    if (walk < play.from || walk > play.to) {
      this.stopTune(t);
    } else if (play.place) {
      this.hear(play.place, walk);
      v.gain.gain.setTargetAtTime(v.level * this.heardNear, t, 0.15);
      v.send.gain.setTargetAtTime(play.wet * Math.sqrt(this.heardNear), t, 0.15);
      v.pan.pan.setTargetAtTime(this.heardPan, t, 0.15);
      v.lowpass.frequency.setTargetAtTime(Math.min(play.lowpass, this.airCutoff()), t, 0.15);
    }
  }

  /** Back in the alley it starts again, and runs down, and stops where it always stops. */
  private wakingTune(t: number): void {
    const w = night.tune.waking;
    const src = this.startTune(w, null, t);
    if (!src || !this.tune) return;
    // the rate falls in a straight line: this long, it takes to get through what is left of the tune
    const left = this.tune.stopAt - this.tune.bars[w.bar - 1];
    const seconds = (2 * left) / (1 + w.endRate);
    src.playbackRate.setValueAtTime(1, t);
    src.playbackRate.linearRampToValueAtTime(w.endRate, t + seconds);
  }

  // ---------------------------------------------------------------- the blows

  /** Close the cut (the blows stay audible). */
  private closeCut(t: number, seconds: number): void {
    const g = this.cut.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + seconds);
  }

  private openCut(t: number, seconds: number): void {
    const g = this.cut.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(1, t + seconds);
  }

  /** Silence from `at` for `hold` s, then the world coming back over `back` s. */
  private silence(t: number, at: number, hold: number, back: number): void {
    const g = this.cut.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    if (at > 0) g.setValueAtTime(g.value, t + at);
    g.linearRampToValueAtTime(0, t + at + 0.005);
    g.setValueAtTime(0, t + at + hold);
    g.linearRampToValueAtTime(1, t + at + hold + back);
  }

  /** A blow of the nightmare (see director/Scares.ts). */
  scare(kind: ScareSound): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const c = night.scares;
    switch (kind) {
      case 'crowd':
        this.hit(t, c.crowd.hit);
        break;
      case 'blackout':
        this.closeCut(t, c.blackout.fade);
        this.dark = true;
        this.darkAt = this.lastWalk;
        this.darkUntil = t + c.blackout.longest;
        this.hit(t, c.blackout.hit);
        break;
      case 'lightsBack':
        this.lightsBack(t);
        break;
      case 'screens':
        this.screens(t);
        break;
      case 'teeth':
        this.teeth(t);
        break;
      case 'face':
        this.faceFalls(t);
        break;
      case 'slam':
        this.slam(t);
        break;
    }
  }

  /** The tube's starter ticking, and its buzz back at once. */
  private lightsBack(t: number): void {
    const c = night.scares.lightsBack;
    this.dark = false;
    this.openCut(t, c.fade);
    this.play(c.flicker.shot, c.flicker);
    for (const d of c.ticks) this.burst(t + d, c.tick.hz, c.tick.q, c.tick.peak, c.tick.decay, this.dryBus);
  }

  /** A second of television at full blast with somebody screaming in it; then it chokes, and there is nothing at all. */
  private screens(t: number): void {
    const c = night.scares.screens;
    this.silence(t, 0, c.seconds + c.hold, c.back);
    this.play(c.burst.shot, c.burst, this.impact);
    this.play(c.shriek.shot, c.shriek, this.impact);
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    const g = this.gainNode(0);
    src.connect(this.filter('bandpass', c.hiss.hz, c.hiss.q)).connect(g).connect(this.impact);
    g.gain.setValueAtTime(c.hiss.peak, t);
    g.gain.setValueAtTime(c.hiss.peak, t + c.seconds - 0.012);
    g.gain.linearRampToValueAtTime(0, t + c.seconds);
    src.start(t, Math.random() * 2);
    src.stop(t + c.seconds + 0.02);
    this.hit(t, c.hit);
  }

  /** The jaws: bone and meat on one enormous low blow, and everything stops. */
  private teeth(t: number): void {
    const c = night.scares.teeth;
    this.shutAt = Math.min(this.shutAt, this.lastWalk);
    this.stopTune(t);
    this.silence(t, 0, c.hold, 0.05);
    this.hit(t, c.hit);
    this.hit(t + c.bounce, c.again);
    for (const layer of c.layers) this.play(layer.shot, layer, this.impact);
  }

  /** A scream drawn in, backwards, with a breath rising under it. It stops dead by itself; the blow itself comes just as it would. */
  private inhale(o: PlayConfig): void {
    const c = night.scares.face;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const end = t + c.seconds;
    const sources: AudioBufferSourceNode[] = [];
    const gains: GainNode[] = [];
    if (this.faceTape) {
      const src = ctx.createBufferSource();
      src.buffer = this.faceTape.buffer;
      src.playbackRate.value = this.faceTape.buffer.duration / c.seconds;
      const g = this.gainNode(0);
      src.connect(g).connect(this.impact);
      const level = this.faceTape.gain * fromDb(o.peak);
      g.gain.setValueAtTime(level * c.from, t);
      g.gain.exponentialRampToValueAtTime(level, end - 0.004);
      g.gain.linearRampToValueAtTime(0, end);
      src.start(t);
      src.stop(end + 0.01);
      sources.push(src);
      gains.push(g);
    }
    const b = c.breath;
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    const band = this.filter('bandpass', b.from, b.q);
    band.frequency.exponentialRampToValueAtTime(b.to, end);
    const g = this.gainNode(0);
    air.connect(band).connect(g).connect(this.impact);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(b.peak, end - 0.004);
    g.gain.linearRampToValueAtTime(0, end);
    air.start(t, Math.random() * 2);
    air.stop(end + 0.01);
    sources.push(air);
    gains.push(g);
    this.inhaling = { sources, gains };
  }

  /** The face: whatever is left of the scream stops dead here, and for a moment there is nothing at all. */
  private faceFalls(t: number): void {
    const c = night.scares.face;
    const v = this.inhaling;
    if (v) {
      this.inhaling = null;
      for (const g of v.gains) {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0, t + 0.004);
      }
      for (const src of v.sources) src.stop(t + 0.01);
    }
    this.silence(t, 0, c.hold, c.back);
  }

  /** One enormous door, a sub that takes seconds to die, and then nothing at all, for good. */
  private slam(t: number): void {
    const c = night.scares.slam;
    this.slammed = true;
    this.stopTune(t);
    this.closeCut(t, c.fade);
    for (const h of c.hits) this.hit(t, h);
    for (const layer of c.layers) this.play(layer.shot, layer, this.impact);
    // the door has a room: its reverb is the only thing allowed past the cut, and only for a while
    const end = t + c.closes + 3;
    this.impactWet.gain.setValueAtTime(c.wet, t);
    this.impactWet.gain.setValueAtTime(0, t + 0.6);
    this.cavernOpen.gain.setValueAtTime(1, t);
    this.cavernOpen.gain.setValueAtTime(1, t + c.closes);
    this.cavernOpen.gain.linearRampToValueAtTime(0, end);
  }

  /** Scrolling back past a blow undoes it. */
  private undoBlows(walk: number, t: number): void {
    if (walk < this.shutAt - UNDO) this.shutAt = Infinity;
    if (this.dark && (walk < this.darkAt - UNDO || t >= this.darkUntil)) {
      this.dark = false;
      this.openCut(t, 0.1);
    }
    if (this.deafened && walk < night.deafen.from) {
      this.deafened = false;
      this.openCut(t, 0.1);
    }
  }

  // ---------------------------------------------------------------- per frame

  /** The blows of the walk that it has just crossed, going forward at a walking pace. */
  private fireCues(walk: number, fast: boolean): void {
    while (this.nextCue > 0 && CUES[this.nextCue - 1].fall > walk) this.nextCue--;
    while (this.nextCue < CUES.length && CUES[this.nextCue].fall <= walk) {
      const cue = CUES[this.nextCue++];
      if (fast || !this.audible() || this.stopped(walk)) continue;
      if (cue.shot === 'horn') this.horn(cue);
      else if (cue.shot === 'inhale') this.inhale(cue);
      else this.play(cue.shot, cue);
    }
  }

  /** Sparse events of a stretch of the walk. */
  private sprinkle(walk: number, dt: number): void {
    for (let i = 0; i < night.sprinkles.length; i++) {
      const c = night.sprinkles[i];
      if (walk < c.from || walk > c.to) continue;
      this.sprinkleTimers[i] -= dt;
      if (this.sprinkleTimers[i] > 0) continue;
      this.sprinkleTimers[i] = c.gap[0] + this.random() * c.gap[1];
      if (!this.audible() || this.stopped(walk) || this.layersOn + this.blows >= night.maxVoices) continue;
      this.play(c.shot, {
        peak: lerp(c.peak[0], c.peak[1], this.random()),
        pan: c.pan ? lerp(c.pan[0], c.pan[1], this.random()) : 0,
        rate: c.rate ? lerp(c.rate[0], c.rate[1], this.random()) : 1,
        lowpass: c.lowpass,
        highpass: c.highpass,
        dry: c.dry,
        wet: c.wet,
        from: c.place,
      });
    }
  }

  /** The nightmare's layers follow the walk (called every frame, after `update`). */
  nightmare(s: NightmareSound, dt: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const walk = s.walk;
    const speed = dt > 0 ? (walk - this.lastWalk) / dt : 0;
    const fast = speed > night.fastestCue;
    this.time += dt;
    this.moving = damp(this.moving, Math.min(Math.abs(speed) / AUTO_WALK, MOST_MOVING), MOVING_RATE, dt);
    this.pulse *= Math.exp(-fearConfig.heart.decay * dt);
    this.undoBlows(walk, t);
    // paused, nothing falls; but the walk can still be sent back to the start from the menu
    this.fireCues(walk, fast || this.paused);
    if (!this.paused) {
      this.startPlays(walk, fast, t);
      this.sprinkle(walk, dt);
      if (s.beat) this.heartbeat(s);
    }
    this.control -= dt;
    if (this.control <= 0) {
      const period = 1 / night.controlRate;
      this.control += period;
      if (this.control <= 0) this.control = period;
      this.mixLayers(s, t, period);
      this.mixTune(walk, t);
      this.mixSpace(s.inside < 0.5 ? 'alley' : s.region, t);
      this.bodyHz = s.inside < 0.5 ? audioConfig.openHz : valueAt(night.bodyHz, walk);
    }
    this.lastWalk = walk;
  }

  /**
   * The story around the nightmare: the alley's air up to the shutter and after it, the passage into the
   * picture, and waking up.
   * @param s normalized story beats (see Experience): focusDuck, depth, inside, sea (0..1 beyond the
   * giant print), chord (the story's stage: see audioConfig.chords)
   */
  update(s: { focusDuck: number; depth: number; inside: number; sea: number; chord: number }, dt: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const mix = audioConfig.mix;
    const { prologue, waking } = night;
    const awake = s.chord === audioConfig.chords.length - 1;
    const advance = this.paused ? 0 : dt;
    this.sinceShutter = s.chord === 0 ? 0 : this.sinceShutter + advance;
    this.awakeFor = awake ? this.awakeFor + advance : 0;
    if (s.chord === 0) this.wrongDone = false;
    if (!awake && this.wakingTuneDone) {
      this.wakingTuneDone = false;
      if (this.tuneVoice && !this.tuneVoice.play) this.stopTune(t);
    }
    if (this.slammed && !awake) {
      this.slammed = false;
      this.cavernOpen.gain.cancelScheduledValues(t);
      this.cavernOpen.gain.setValueAtTime(0, t);
      this.impactWet.gain.cancelScheduledValues(t);
      this.impactWet.gain.setValueAtTime(0, t);
      this.openCut(t, 0.3);
    }
    if (this.deafened && awake && this.awakeFor >= waking.back) {
      this.deafened = false;
      this.openCut(t, waking.backIn);
    }

    // up to the shutter the air is as it always was; then it decays; on waking it comes back thinner
    const air = awake
      ? waking.air * smootherstep(range(waking.airAfter, waking.airAfter + waking.airIn, this.awakeFor))
      : s.chord === 0
        ? 1
        : lerp(prologue.floor, 1, Math.exp(-this.sinceShutter / prologue.air));
    this.outer.gain.setTargetAtTime((1 - s.inside) * (1 - mix.focusDuck * s.focusDuck) * air, t, mix.react);
    if (awake !== this.wasAwake) {
      this.wasAwake = awake;
      this.thin.frequency.setTargetAtTime(awake ? waking.thinHz : waking.restHz, t, 0.3);
      for (const src of this.airSources) src.playbackRate.setTargetAtTime(awake ? waking.rate : 1, t, 0.3);
    }

    this.printRumble = s.depth ** night.printRumble * (1 - s.inside);
    const cutoff = lerp(audioConfig.openHz, audioConfig.muffleHz, clamp(s.depth * (1 - s.inside * mix.openInside), 0, 1));
    this.muffle.frequency.setTargetAtTime(Math.min(cutoff, this.bodyHz), t, 0.15);
    this.reverbSend.gain.setTargetAtTime(lerp(audioConfig.reverbOuter, audioConfig.reverbDream, Math.max(s.depth, s.inside)), t, 0.4);
    this.setChord(s.chord);

    if (!this.audible()) return;
    // sparse drips in the real alley before the picture, never after it
    this.nextDrip -= dt;
    if (this.nextDrip <= 0 && s.inside < 0.5 && !awake) {
      this.nextDrip = audioConfig.drips.gap[0] + Math.random() * audioConfig.drips.gap[1];
      this.drip(t);
    }
    // after the shutter, one distant wrong sound; not if the viewer has already hurried past it
    if (!this.paused && !this.wrongDone && s.chord === 1 && this.sinceShutter >= prologue.wrongAfter) {
      this.wrongDone = true;
      if (s.depth < 0.5) this.play(prologue.wrong.shot, prologue.wrong);
    }
    if (awake && !this.wakingTuneDone && this.awakeFor >= night.tune.waking.after) {
      this.wakingTuneDone = true;
      this.wakingTune(t);
    }
  }
}
