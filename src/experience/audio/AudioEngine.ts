import { audioConfig, type BedConfig, type BedKey, type Cut, type SampleConfig, type SampleKey } from '../../config/audio.config';
import { clamp, lerp, range } from '../math';


/** A running layer of the outer bus that can be faded out and stopped as a whole. */
type Voice = { out: GainNode; sources: AudioScheduledSourceNode[] };

/** A decoded recording and the gain that normalizes its span. */
type Recording = { buffer: AudioBuffer; gain: number };

/** Linear gain that brings a measured linear level to `db` dBFS. */
const toGain = (db: number, measured: number): number => (measured > 0 ? Math.pow(10, db / 20) / measured : 0);

/**
 * The real alley is made of CC0 recordings (city air, wind, the lamp's buzz, drips, the shutter, the
 * instant-film motor, paper), each with a synthesized stand-in that plays until its file has loaded and
 * stays if it never does. The dream ambience and the near-silent tonal bed that bends when the picture is
 * taken are synthesized: they are meant to be sourceless.
 * Nothing starts before a user gesture (autoplay policy); every promise is handled.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private outer!: GainNode;
  private dream!: GainNode;
  private sea!: GainNode;
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
  private nextDreamCall = 0;
  private lastChord = -1;

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
    this.master.connect(comp).connect(ctx.destination);

    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = audioConfig.openHz;
    this.muffle.Q.value = 0.4;
    this.muffle.connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(audioConfig.reverbSeconds);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = audioConfig.reverbOuter;
    this.reverbSend.connect(this.reverb).connect(this.muffle);

    const bus = (gain: number): GainNode => {
      const node = ctx.createGain();
      node.gain.value = gain;
      node.connect(this.muffle);
      node.connect(this.reverbSend);
      return node;
    };
    this.outer = bus(1);
    this.dream = bus(0);
    this.music = bus(audioConfig.musicGain);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = audioConfig.sfxGain;
    this.sfx.connect(this.master);
    this.sfx.connect(this.reverbSend);
    this.dripFilter = this.filter('lowpass', audioConfig.drips.lowpassHz);
    this.dripFilter.connect(this.outer);

    this.noise = this.makeNoise(false);
    this.brown = this.makeNoise(true);
    this.buildOuterAmbience();
    this.buildDreamAmbience();
    this.buildSea();
    this.buildPad();
    void this.loadRecordings();
  }

  // ---------------------------------------------------------------- recordings

  /** Fetch every recording in parallel; each takes over from its synthesized stand-in as it arrives. */
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
  }

  /** Fetch and decode one file from /public; null when it is missing or cannot be decoded. */
  private async decode(url: string): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    if (!ctx) return null;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}${url}`);
      if (!res.ok) return null;
      return await ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      return null;
    }
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
  private loopBuffer(src: AudioBuffer, bed: BedConfig): AudioBuffer {
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

  /** Hand a bed over from its synthesized layer to a looped recording, normalized to the bed's level. */
  private swapBed(key: BedKey, loop: AudioBuffer): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const k = audioConfig.bedSwapSeconds;
    const voice = this.voice(0);
    const src = ctx.createBufferSource();
    src.buffer = loop;
    src.loop = true;
    const level = this.gainNode(toGain(audioConfig.beds[key].level, this.measure(loop, 0, loop.duration).rms));
    src.connect(level).connect(voice.out);
    src.start(t, Math.random() * loop.duration);
    voice.sources.push(src);
    voice.out.gain.setTargetAtTime(1, t, k);
    const old = this.beds.get(key);
    if (old) this.release(old, t, k);
    this.beds.set(key, voice);
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

  private buildDreamAmbience(): void {
    const a = audioConfig.ambience;
    // deeper, rounder air
    const air = this.gainNode(a.dreamAir);
    const lp = this.filter('lowpass', 140, 0.9);
    this.loop(this.brown, lp, 0.6);
    lp.connect(air).connect(this.dream);
    this.lfo(0.019, a.dreamAir * 0.5, air.gain);
    // a far, sourceless tone (two close sines beating very slowly)
    for (const f of [110, 110.35, 164.8]) {
      const o = this.ctx!.createOscillator();
      o.frequency.value = f;
      const g = this.gainNode(a.dreamTone);
      o.connect(g).connect(this.dream);
      o.start();
    }
  }

  /** The sea: a slow swell of low noise, a wash of hiss riding each breath (gains breathe around half their level). */
  private buildSea(): void {
    const a = audioConfig.sea;
    const level = audioConfig.ambience.sea / 2;
    this.sea = this.gainNode(0);
    this.sea.connect(this.dream);
    const layer = (source: AudioBuffer, filter: BiquadFilterNode, share: number, rate?: number) => {
      const g = this.gainNode(level * share);
      this.loop(source, filter, rate);
      filter.connect(g).connect(this.sea);
      this.lfo(a.swellHz, level * share * a.depth, g.gain);
    };
    layer(this.brown, this.filter('lowpass', a.lowHz, 0.5), 1, 0.8);
    layer(this.noise, this.filter('bandpass', a.hissHz, 0.6), a.hiss);
  }

  private buildPad(): void {
    const ctx = this.ctx!;
    const lp = this.filter('lowpass', 900, 0.3);
    lp.connect(this.music);
    this.lfo(0.05, 320, lp.frequency);
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      osc.type = i % 2 ? 'sine' : 'triangle';
      osc.frequency.value = audioConfig.chords[0][i];
      const gain = this.gainNode(0);
      osc.connect(gain).connect(lp);
      osc.start();
      this.lfo(0.07 + i * 0.013, 1.4, osc.detune);
      this.padVoices.push({ osc, gain });
    }
  }

  private setChord(index: number): void {
    if (!this.ctx || index === this.lastChord) return;
    this.lastChord = index;
    const t = this.ctx.currentTime;
    const chord = audioConfig.chords[index];
    this.padVoices.forEach((v, i) => {
      v.osc.frequency.setTargetAtTime(chord[i], t, 1.8);
      v.gain.gain.setTargetAtTime(chord[i] > 0 ? audioConfig.padVoiceGain : 0, t, 2.4);
    });
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

  private thump(t: number, freq: number, peak: number, decay: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(freq * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.03);
    const g = this.gainNode(0);
    o.connect(g).connect(this.sfx);
    this.env(g, t, 0.002, peak, decay);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  /** Play one span of `buffer` at `t` with linear fades at both cuts; `rate` re-pitches it. */
  private segment(buffer: AudioBuffer, cut: Cut, gain: number, t: number, out: AudioNode, rate = 1): void {
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
  }

  /** Play a loaded recording at `t`; returns the delay to its transient, or null while it is missing. */
  private playSample(key: SampleKey, t: number): number | null {
    const rec = this.samples.get(key);
    if (!rec) return null;
    const s: SampleConfig = audioConfig.samples[key];
    this.segment(rec.buffer, s, rec.gain, t, this.sfx);
    return (s.hit ?? s.offset) - s.offset;
  }

  private ready(): boolean {
    return !!this.ctx && this.enabled;
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

  /** The recorded SLR click over a little of the synthesized body; fully synthesized without the file. */
  shutter(): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
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

  // ---------------------------------------------------------------- per frame

  /**
   * @param s normalized story beats (see Experience): focusDuck, depth, inside, sea (0..1 beyond the
   * giant print), chord
   */
  update(s: { focusDuck: number; depth: number; inside: number; sea: number; chord: number }, dt: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const mix = audioConfig.mix;
    this.outer.gain.setTargetAtTime((1 - s.inside) * (1 - mix.focusDuck * s.focusDuck), t, mix.react);
    this.dream.gain.setTargetAtTime(s.inside, t, audioConfig.fadeSeconds);
    this.sea.gain.setTargetAtTime(s.sea, t, audioConfig.fadeSeconds);
    const cutoff = lerp(audioConfig.openHz, audioConfig.muffleHz, clamp(s.depth * (1 - s.inside * mix.openInside), 0, 1));
    this.muffle.frequency.setTargetAtTime(cutoff, t, 0.15);
    this.reverbSend.gain.setTargetAtTime(lerp(audioConfig.reverbOuter, audioConfig.reverbDream, Math.max(s.depth, s.inside)), t, 0.4);
    this.music.gain.setTargetAtTime(audioConfig.musicGain * (mix.musicFloor + (1 - mix.musicFloor) * range(0, 1, s.inside)), t, 0.8);
    this.setChord(s.chord);

    if (!this.enabled) return;
    // sparse drips in the real alley, distant sourceless calls in the dream
    this.nextDrip -= dt;
    if (this.nextDrip <= 0 && s.inside < 0.5) {
      this.nextDrip = audioConfig.drips.gap[0] + Math.random() * audioConfig.drips.gap[1];
      this.drip(t);
    }
    this.nextDreamCall -= dt;
    if (this.nextDreamCall <= 0 && s.inside > 0.5) {
      const call = audioConfig.dreamCalls;
      this.nextDreamCall = call.gap[0] + Math.random() * call.gap[1];
      const base = call.notes[Math.floor(Math.random() * call.notes.length)];
      for (const [mul, amp] of call.partials) {
        const o = this.ctx.createOscillator();
        const g = this.gainNode(0);
        o.frequency.value = base * mul;
        o.connect(g).connect(this.dream);
        this.env(g, t, call.attack, amp, call.release);
        o.start(t);
        o.stop(t + call.attack + call.release + 0.1);
      }
    }
  }
}
