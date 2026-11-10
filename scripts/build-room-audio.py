#!/usr/bin/env python3
"""
The sound library of the rooms: every file of public/audio/rooms/ is a recipe in this script.

  python -I scripts/build-room-audio.py                  build everything
  python -I scripts/build-room-audio.py --only a,b,c     build only these
  python -I scripts/build-room-audio.py --check          measure what is on disk (level, length, loop seam)
  python -I scripts/build-room-audio.py --docs DIR       write ROOM_SOUNDS.md and notices_sounds.md into DIR

Needs numpy and imageio-ffmpeg (which brings its own ffmpeg). Recordings are the public HQ MP3 previews of CC0
sounds on Freesound; they are downloaded once into .asset-cache/freesound/ (gitignored). Nothing here needs a
login. Everything marked "made for this piece" is synthesized below, from a fixed random seed, so a rebuild
gives the same files. Files are written at 44.1 kHz: mono unless stereo matters, 96 kbps mono, 128 kbps stereo.

A bed is looped whole by the room (RoomSound.bed), from a random place, so its two ends must meet: its last
seconds are cross-faded into its first ones, and it is encoded with a stretch of its own other end on either
side, which the MP3's LAME tag then tells the decoder to drop: the codec sees no edge at all.
"""
import argparse
import os
import struct
import subprocess
import sys
import time
import urllib.request
import zlib

import numpy as np
import imageio_ffmpeg

SR = 44100
TAU = 2 * np.pi
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "audio", "rooms")
CACHE = os.path.join(ROOT, ".asset-cache", "freesound")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
MAX_DOWNLOAD = 7 * 1024 * 1024  # bytes: long field recordings are only needed from their start
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
PEAK_SHOT = -3.0  # dBFS, one-shots
RMS_BED = -24.0  # dBFS, beds
LICENCE_CHECKED = "2026-11-05"


# ---------------------------------------------------------------- reading recordings

_decoded = {}
_used = []  # (freesound id, from, to) of the recipe being built


def _download(fid):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{fid}.mp3")
    if os.path.exists(path) and os.path.getsize(path) > 2000:
        return path
    url = "https://cdn.freesound.org/previews/" + SOURCES[fid][2]
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Range": f"bytes=0-{MAX_DOWNLOAD - 1}"})
            with urllib.request.urlopen(req, timeout=240) as r:
                body = r.read(MAX_DOWNLOAD)
            with open(path + ".part", "wb") as f:
                f.write(body)
            os.replace(path + ".part", path)
            return path
        except Exception as exc:
            print("retry", fid, repr(exc)[:80], flush=True)
            time.sleep(3 + 3 * attempt)
    raise SystemExit(f"cannot download {fid}: {url}")


def decode_file(path):
    """A file as float32, 2 by n, at SR; a mono file comes back with the same samples on both sides, at the same level."""
    p = subprocess.run([FFMPEG, "-hide_banner", "-i", path, "-f", "f32le", "-ar", str(SR), "pipe:1"], capture_output=True)
    info = p.stderr.decode("utf-8", "replace")
    channels = 1 if ", mono," in info.split("Output #0")[0] else 2
    x = np.frombuffer(p.stdout, dtype=np.float32)
    return np.stack([x, x]) if channels == 1 else x.reshape(-1, 2).T


def _decode(fid):
    x = _decoded.get(fid)
    if x is None:
        x = decode_file(_download(fid))
        if sum(v.shape[1] for v in _decoded.values()) > 80_000_000:
            _decoded.clear()
        _decoded[fid] = x
    return x


def rec(fid, a=0.0, b=None, ch="mid"):
    """A span of a preview, as float64: `ch` is mid, left, right (mono arrays) or stereo (2 by n)."""
    x = _decode(fid)
    i = int(round(a * SR))
    j = x.shape[1] if b is None else min(x.shape[1], int(round(b * SR)))
    _used.append((fid, a, j / SR))
    if ch == "stereo":
        return x[:, i:j].astype(np.float64)
    if ch == "left":
        return x[0, i:j].astype(np.float64)
    if ch == "right":
        return x[1, i:j].astype(np.float64)
    return 0.5 * (x[0, i:j].astype(np.float64) + x[1, i:j].astype(np.float64))


# ---------------------------------------------------------------- measuring and levels


def db(v):
    return 20 * np.log10(np.maximum(v, 1e-12))


def from_db(d):
    return 10 ** (d / 20)


def peak(x):
    return float(np.abs(x).max()) if x.size else 0.0


def rms(x):
    return float(np.sqrt(np.mean(np.square(x)))) if x.size else 0.0


def to_peak(x, d=PEAK_SHOT):
    return x * (from_db(d) / max(peak(x), 1e-12))


def to_rms(x, d=RMS_BED):
    return x * (from_db(d) / max(rms(x), 1e-12))


# ---------------------------------------------------------------- shaping


def fast_len(n):
    best = None
    p5 = 1
    while p5 < 2 * n:
        p3 = p5
        while p3 < 2 * n:
            p2 = p3
            while p2 < n:
                p2 *= 2
            if best is None or p2 < best:
                best = p2
            p3 *= 3
        p5 *= 5
    return best


def filt(x, H, periodic=False):
    """Zero-phase filter by a real gain curve H(f); the signal is padded by reflection unless it is a loop."""
    n = x.shape[-1]
    if periodic:
        f = np.fft.rfftfreq(n, 1 / SR)
        return np.fft.irfft(np.fft.rfft(x, axis=-1) * H(f), n, axis=-1)
    pad = min(n, SR // 4)
    widths = [(0, 0)] * (x.ndim - 1) + [(pad, pad)]
    z = np.pad(x, widths, mode="reflect") if pad else x
    m = fast_len(z.shape[-1])
    f = np.fft.rfftfreq(m, 1 / SR)
    y = np.fft.irfft(np.fft.rfft(z, m, axis=-1) * H(f), m, axis=-1)
    return y[..., pad : pad + n]


def hp(x, hz, order=4, periodic=False):
    return filt(x, lambda f: 1 / np.sqrt(1 + (hz / np.maximum(f, 1e-3)) ** (2 * order)), periodic)


def lp(x, hz, order=4, periodic=False):
    return filt(x, lambda f: 1 / np.sqrt(1 + (f / hz) ** (2 * order)), periodic)


def bp(x, lo, hi, order=4, periodic=False):
    return filt(x, lambda f: 1 / np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** (2 * order)) / np.sqrt(1 + (f / hi) ** (2 * order)), periodic)


def bell(x, hz, gain_db, octaves=0.5, periodic=False):
    """A peak or dip of gain_db around hz, as wide as `octaves`."""
    g = gain_db / 20

    def H(f):
        o = np.log2(np.maximum(f, 1.0) / hz) / max(octaves, 1e-3)
        return 10 ** (g * np.exp(-2.77 * o * o))

    return filt(x, H, periodic)


def speed(x, rate, periodic=False):
    """Playback speed (pitch and time together), band-limited."""
    if abs(rate - 1) < 1e-6:
        return x
    n = x.shape[-1]
    if not periodic:
        widths = [(0, 0)] * (x.ndim - 1) + [(0, 8192)]
        x = np.pad(x, widths)
    m = x.shape[-1]
    m2 = int(round(m / rate))
    S = np.fft.rfft(x, axis=-1)
    bins = m2 // 2 + 1
    if bins > S.shape[-1]:
        widths = [(0, 0)] * (x.ndim - 1) + [(0, bins - S.shape[-1])]
        S = np.pad(S, widths)
    else:
        S = S[..., :bins]
    y = np.fft.irfft(S, m2, axis=-1) * (m2 / m)
    return y if periodic else y[..., : int(round(n / rate))]


def warp(x, rates):
    """Varispeed: `rates` holds the speed for each sample of the result (a tape running down)."""
    pos = np.cumsum(rates)
    pos = pos[pos < x.shape[-1] - 2]
    i = pos.astype(np.int64)
    u = pos - i
    return x[..., i] * (1 - u) + x[..., i + 1] * u


def reverse(x):
    return x[..., ::-1]


def fade(x, a=0.002, b=0.01):
    n = x.shape[-1]
    y = np.array(x, dtype=np.float64)
    ia, ib = min(n // 2, int(a * SR)), min(n // 2, int(b * SR))
    if ia > 0:
        y[..., :ia] *= np.sin(0.5 * np.pi * (np.arange(ia) + 0.5) / ia) ** 2
    if ib > 0:
        y[..., n - ib :] *= np.cos(0.5 * np.pi * (np.arange(ib) + 0.5) / ib) ** 2
    return y


def shape(x, points):
    """Gain over time: [(seconds, gain), ...], in dB-free straight lines."""
    n = x.shape[-1]
    t = np.arange(n) / SR
    return x * np.interp(t, [p[0] for p in points], [p[1] for p in points])


def mono(x):
    return x if x.ndim == 1 else x.mean(axis=0)


def stereo(x):
    return np.stack([x, x]) if x.ndim == 1 else x


def place(x, p):
    """Mono to stereo at place p, -1..1, equal power."""
    a = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)])


def _gain_curve(x, gain_db_fn, attack, release):
    hop = 64
    m = np.abs(x).max(axis=0) if x.ndim == 2 else np.abs(x)
    k = max(1, len(m) // hop)
    lv = db(m[: k * hop].reshape(k, hop).max(axis=1))
    ga = np.exp(-hop / (attack * SR))
    gr = np.exp(-hop / (release * SR))
    env = np.zeros(k)
    v = lv[0]
    for i, e in enumerate(lv.tolist()):
        c = ga if e > v else gr
        v = c * v + (1 - c) * e
        env[i] = v
    g = gain_db_fn(env)
    t = np.arange(len(m))
    return from_db(np.interp(t, (np.arange(k) + 0.5) * hop, g))


def compress(x, threshold, ratio, attack=0.004, release=0.08):
    """Brings transients down towards what lies between them. Threshold in dBFS."""
    def gain(env):
        return np.where(env > threshold, (threshold - env) * (1 - 1 / ratio), 0.0)

    return x * _gain_curve(x, gain, attack, release)


def tame_loop(x, above_rms=14.0, ratio=6.0):
    """A loop's stray spikes taken down, the gain worked out with the loop's own end before its start, so that it stays a loop."""
    twice = np.concatenate([x, x], axis=-1)
    y = compress(twice, db(rms(x)) + above_rms, ratio, attack=0.001, release=0.06)
    n = x.shape[-1]
    return y[..., n:]


def lead_off(x, threshold=-40.0, keep=0.004):
    """Takes off what comes before the sound starts (threshold in dB under the peak)."""
    m = np.abs(mono(x))
    i = int(np.argmax(m > peak(m) * from_db(threshold)))
    k = int(keep * SR)
    return x[..., i - k :] if i > k else x


def seam(x, seconds):
    """A loop out of a span: its last `seconds` are cross-faded into its first, equal power (allowing for how alike they are)."""
    n = x.shape[-1]
    k = int(seconds * SR)
    head, tail = x[..., :k], x[..., n - k :]
    a, b = mono(head), mono(tail)
    r = float(np.dot(a, b) / max(np.sqrt(np.dot(a, a) * np.dot(b, b)), 1e-12))
    r = max(0.0, r)
    u = (np.arange(k) + 0.5) / k
    norm = np.sqrt(u * u + (1 - u) * (1 - u) + 2 * r * u * (1 - u))
    y = np.array(x[..., : n - k], dtype=np.float64)
    y[..., :k] = head * (u / norm) + tail * ((1 - u) / norm)
    return y


class Tape:
    """A stretch of time to lay events on. With `wrap`, what runs past the end comes in again at its start: a loop by construction."""

    def __init__(self, seconds, channels=1, wrap=False):
        self.n = int(round(seconds * SR))
        self.channels = channels
        self.wrap = wrap
        self.x = np.zeros((channels, self.n) if channels == 2 else self.n)

    def put(self, sound, at=0.0, gain=1.0, pan=None):
        s = sound
        if self.channels == 2:
            s = place(s, pan or 0.0) if s.ndim == 1 else s
        elif s.ndim == 2:
            s = s.mean(axis=0)
        s = s * gain
        i = int(round(at * SR))
        m = s.shape[-1]
        if self.wrap:
            idx = (i + np.arange(m)) % self.n
            np.add.at(self.x, (..., idx), s)
        else:
            if i >= self.n or i + m <= 0:
                return self
            a = max(0, -i)
            b = min(m, self.n - i)
            self.x[..., i + a : i + b] += s[..., a:b]
        return self


def chain(*sounds, gap=0.0):
    two = any(s.ndim == 2 for s in sounds)
    parts = []
    silence = int(gap * SR)
    for s in sounds:
        parts.append(stereo(s) if two else s)
        if silence:
            parts.append(np.zeros((2, silence) if two else silence))
    return np.concatenate(parts, axis=-1)


def room_verb(x, t60=2.0, wet=0.5, dark=4000.0, pre=0.0, seed=7, early=()):
    """A simple algorithmic reverb, by convolution with decaying noise; used only where a file's own place is the point."""
    rng = np.random.default_rng(seed)
    n = int((t60 * 1.1 + pre) * SR)
    t = np.arange(n) / SR

    def ir():
        w = rng.standard_normal(n)
        low = lp(w, dark, order=1)
        high = w - low
        i = low * np.exp(-6.91 * t / t60) + high * np.exp(-6.91 * t / (t60 * 0.45))
        i[: int(pre * SR)] = 0
        for at, g in early:
            i[int(at * SR)] += g * np.sqrt(np.sum(i * i)) / 4
        return i / np.sqrt(np.sum(i * i))

    def conv(sig, i):
        m = fast_len(len(sig) + len(i))
        return np.fft.irfft(np.fft.rfft(sig, m) * np.fft.rfft(i, m), m)[: len(sig) + len(i)]

    if x.ndim == 1:
        y = conv(x, ir())
        y[: len(x)] += x / max(wet, 1e-6) * (1 - wet) if wet < 1 else 0
        return y * wet if wet < 1 else y
    a, b = conv(x[0], ir()), conv(x[1], ir())
    y = np.stack([a, b]) * wet
    y[..., : x.shape[-1]] += x * (1 - wet)
    return y


# ---------------------------------------------------------------- synthesis helpers


def seconds(n):
    return np.arange(n) / SR


def tone(hz, dur, decay=None, phase=0.0, attack=0.001):
    n = int(dur * SR)
    t = seconds(n)
    y = np.sin(TAU * hz * t + phase)
    if decay:
        y *= np.exp(-t / decay)
    if attack:
        y *= np.minimum(1, t / attack)
    return y


def noise_loop(n, H, rng, channels=1):
    """Noise that is periodic in n samples, shaped by gain curve H(f), unit RMS."""
    f = np.fft.rfftfreq(n, 1 / SR)

    def one():
        y = np.fft.irfft(np.fft.rfft(rng.standard_normal(n)) * H(f), n)
        return y / max(np.std(y), 1e-12)

    return np.stack([one(), one()]) if channels == 2 else one()


def lfo(n, rng, cycles=(1, 2, 3, 5), depth=1.0):
    """A slow wander, periodic in n samples: sum of whole numbers of cycles, in -1..1 or so."""
    t = np.arange(n) / n
    y = np.zeros(n)
    for c in cycles:
        y += np.sin(TAU * c * t + rng.uniform(0, TAU)) / np.sqrt(c)
    return depth * y / max(np.abs(y).max(), 1e-9)


def whole_hz(hz, loop_seconds):
    """The nearest frequency with a whole number of cycles in the loop."""
    return round(hz * loop_seconds) / loop_seconds


def pink_gain(f, knee=20.0):
    return 1 / np.sqrt(np.maximum(f, knee))



# ---------------------------------------------------------------- finding events in a recording


def find_hits(x, count, before=0.003, after=0.08, min_gap=0.06):
    """The strongest separate hits in a stretch, strongest first, as (from, to) in samples. A cut stops before the next hit begins."""
    m = np.abs(mono(x))
    hop = int(0.001 * SR)
    k = len(m) // hop
    env = m[: k * hop].reshape(k, hop).max(axis=1)
    # a slow wave's zero crossings must not look like a new hit
    smooth = np.max(np.lib.stride_tricks.sliding_window_view(np.pad(env, (4, 4), mode="edge"), 9), axis=1)
    w = int(min_gap / 0.001)
    order = np.argsort(env)[::-1]
    taken = []
    blocked = np.zeros(k, dtype=bool)
    for i in order.tolist():
        if blocked[i]:
            continue
        # walk back to where this hit starts
        j = i
        while j > 0 and i - j < 40 and env[j - 1] > env[i] * 0.12:
            j -= 1
        stop = min(k, i + int(after / 0.001))
        lowest = smooth[i]
        for t in range(i + max(w, 15), stop):
            lowest = min(lowest, smooth[t])
            if smooth[t] > 0.25 * smooth[i] and smooth[t] > 3.0 * lowest:
                stop = t - 6
                break
        taken.append((max(0, j * hop - int(before * SR)), min(len(m), stop * hop)))
        blocked[max(0, i - w) : i + w] = True
        if len(taken) == count:
            break
    return taken


def find_spans(x, count, threshold=-30.0, gap=0.12, shortest=0.05, longest=None, pad=(0.01, 0.06)):
    """The loudest stretches that stand above threshold (dB under the peak) with gaps of less than `gap`, loudest first, as (from, to) in samples. Where the stretches run together the threshold rises until enough of them come apart."""
    m = np.abs(mono(x))
    hop = int(0.005 * SR)
    k = len(m) // hop
    env = np.sqrt(np.mean(np.square(m[: k * hop].reshape(k, hop)), axis=1))
    g = int(gap / 0.005)
    best = []
    for level in np.arange(threshold, -2.0, 2.0):
        on = env > env.max() * from_db(level)
        found = []
        i = 0
        while i < k:
            if not on[i]:
                i += 1
                continue
            j = i
            while True:
                nxt = np.where(on[j + 1 : j + 1 + g])[0]
                if len(nxt) == 0:
                    break
                j = j + 1 + int(nxt[-1])
            if (j - i + 1) * 0.005 >= shortest:
                found.append((float(np.sum(env[i : j + 1] ** 2)), i * hop, (j + 1) * hop))
            i = j + 1
        if len(found) > len(best):
            best = found
        if len(best) >= count:
            break
    best.sort(reverse=True)
    out = []
    for _, a, b in best[:count]:
        b2 = b if longest is None else min(b, a + int(longest * SR))
        out.append((max(0, a - int(pad[0] * SR)), min(len(m), b2 + int(pad[1] * SR))))
    return out

# ---------------------------------------------------------------- the recordings

ROOM_ORDER = ["all", "corridor", "evening", "waitingroom", "birches", "spiders", "kitchen", "beds", "crawl", "dentist", "karabasan", "mirror", "busstop", "elevator", "flood", "deep", "pool", "ward", "darkness", "washing", "dolls", "chase", "buried", "beam", "shaft", "holes", "teeth", "exam", "party", "home", "stairs", "funeral", "album"]
# id: author, title, path of the HQ preview under cdn.freesound.org/previews/ (and what the uploader asks for, if anything). CC0 on each sound's own page, checked on the date above.
SOURCES = {
    11736: ('xyzr_kx', 'cigarette_lighter.wav', '11/11736_31076-hq.mp3'),
    15826: ('transitking', 'telephonering.wav', '15/15826_31028-hq.mp3'),
    20108: ('cognito perceptu', 'air over mic.wav', '20/20108_57789-hq.mp3', 'his profile: he likes to be credited as cognito perceptu'),
    34175: ('Dalibor', 'pour out gravel on the stairs.wav', '34/34175_25449-hq.mp3'),
    44192: ('cubic.archon', 'Short twangs cleaned.wav', '44/44192_360265-hq.mp3'),
    50596: ('Spandau', 'stairwell_wind.aif', '50/50596_25133-hq.mp3'),
    51153: ('RutgerMuller', 'Head Hair Scratching.wav', '51/51153_179538-hq.mp3'),
    59160: ('f_ilippo', 'grincements_helvetia.aif', '59/59160_745228-hq.mp3'),
    73257: ('jakobhandersen', 'Ship groans in harbour.wav', '73/73257_1068580-hq.mp3'),
    76802: ('carlSablowEdwards', 'balloon_rubbing_01.flac', '76/76802_210407-hq.mp3'),
    79382: ('j1987', 'boxofscrews.wav', '79/79382_367313-hq.mp3', 'credit welcomed'),
    85715: ('tmkappelt', 'Zippo_open.aif', '85/85715_1275446-hq.mp3'),
    100401: ('vnss', 'steelcable_deck_contact2.wav', '100/100401_57225-hq.mp3'),
    104013: ('RutgerMuller', 'Wood Plank Scraping Close-Mic Long.aif', '104/104013_179538-hq.mp3'),
    104016: ('RutgerMuller', 'Tap Water Open.aif', '104/104016_179538-hq.mp3'),
    104019: ('RutgerMuller', 'Door Handle Wood Clack.aif', '104/104019_179538-hq.mp3'),
    104351: ('RutgerMuller', 'Metal Chair Scraping Concrete Basement Floor.aif', '104/104351_179538-hq.mp3'),
    108276: ('klakmart', 'SweepingWithLargeBroom.aif', '108/108276_179679-hq.mp3'),
    116395: ('DiArchangeli', 'TV Static.wav', '116/116395_1779874-hq.mp3'),
    116609: ('mrmccormack', 'MrM_OldShutter_Nikon2020.wav', '116/116609_2073257-hq.mp3'),
    119831: ('kbnevel', 'Coindrop_porcelain.aif', '119/119831_1990690-hq.mp3'),
    125064: ('EverydaySounds', 'Faulty Fluorescent Light Starter & Hum.wav', '125/125064_2273054-hq.mp3'),
    125310: ('alienistcog', 'wooden-door-creak-slow.aif', '125/125310_296888-hq.mp3'),
    125958: ('Ryding', 'Wooden door open-close', '125/125958_981397-hq.mp3'),
    133851: ('aroth4', 'heavy knocking', '133/133851_2064945-hq.mp3'),
    139970: ('jessepash', 'Switch.Big.Power.wav', '139/139970_968325-hq.mp3'),
    143125: ('Zabuhailo', 'ratSqueak.wav', '143/143125_2580450-hq.mp3'),
    143291: ('Manuel Calurano', 'Ants (Riaza)', '143/143291_1038035-hq.mp3'),
    144042: ('gchase', 'Room_Tone_Ambience_Large_Theatre_Low_Hum.wav', '144/144042_430339-hq.mp3'),
    145119: ('gilligan_itm', 'Fluorescent lamp start 9.wav', '145/145119_1803710-hq.mp3'),
    146436: ('felix.blume', 'Dry grass rustling in the wind, in the desert of Chile.', '146/146436_1661766-hq.mp3'),
    146805: ('kforetek', 'Wood Chest Slid.3.wav', '146/146805_583328-hq.mp3'),
    148267: ('satanicupsman', 'off camera flash charging', '148/148267_1474788-hq.mp3'),
    148952: ('deleted_user_2104797', 'Squeak_window_4.wav', '148/148952_2104797-hq.mp3'),
    149486: ('xxyxroad', 'Ventilation shaft', '149/149486_1027271-hq.mp3'),
    151799: ('JamesMontour', 'shutterWflashCharge-polaroidOneStep.wav', '151/151799_2497980-hq.mp3'),
    152613: ('rob3rt', 'Machine sucking and expelling air.wav', '152/152613_2399655-hq.mp3'),
    155913: ('tiptoe84', 'TweezerTooth.wav', '155/155913_2371260-hq.mp3'),
    159645: ('rightpurdy', 'CHAIR,_WOODEN_SQUEAKS2.wav', '159/159645_2426942-hq.mp3'),
    161229: ('lolamadeus', 'Lightswitch clicks.wav', '161/161229_544580-hq.mp3'),
    169931: ('u3190', 'Gasp Inhale', '169/169931_1316584-hq.mp3'),
    171942: ('esperar', 'surprise_gasps.wav', '171/171942_377731-hq.mp3'),
    171945: ('RebekahDay', 'LowWhalesong.wav', '171/171945_3206712-hq.mp3'),
    172411: ('EagleStealthTeam', 'Creaking Metal - Slow', '172/172411_2915633-hq.mp3'),
    174634: ('altfuture', 'Guts Dragging', '174/174634_3015949-hq.mp3'),
    174718: ('paespedro', 'Single Water Drop', '174/174718_1850811-hq.mp3'),
    174754: ('sgarrison2127', 'glass creaking.aif', '174/174754_2977210-hq.mp3'),
    177017: ('iampagan', 'Slimy flesh', '177/177017_2484711-hq.mp3'),
    178083: ('sgarrison2127', 'throat sounds', '178/178083_2977210-hq.mp3'),
    181267: ('CapsLok', 'Gas Lighter.wav', '181/181267_850742-hq.mp3'),
    183452: ('utsuru', 'Wood Crack 2', '183/183452_418644-hq.mp3'),
    183453: ('utsuru', 'Wood Crack 1', '183/183453_418644-hq.mp3'),
    185059: ('unfa', 'Deafening Whispers', '185/185059_1038806-hq.mp3', "if credited: Tobiasz 'unfa' Karoń, with a link to the sound"),
    188204: ('SpliceSound', 'Wooden chair, slide scrape on wood floor.wav', '188/188204_1480854-hq.mp3'),
    192351: ('Yuval', 'stereo bubbles (straw)', '192/192351_770707-hq.mp3'),
    197435: ('Yuval', 'clapping group unisono', '197/197435_770707-hq.mp3'),
    197751: ('wjoojoo', 'underwater_ambience_lake_lbj_08232013_1.flac', '197/197751_93137-hq.mp3'),
    199919: ('sittingmonkeyanim', 'Skittering Dog', '199/199919_2489807-hq.mp3'),
    201788: ('ST303', 'Room with Buzz Incandescent light bulb', '201/201788_2449563-hq.mp3'),
    202108: ('spookymodem', 'Spider Chattering.wav', '202/202108_3756348-hq.mp3'),
    202612: ('LudwigMueller', 'FXLM neon lights flicker bathroom.wav', '202/202612_1442200-hq.mp3', 'credit welcomed'),
    204114: ('marcjunker', 'Man Eating Teriyaki Noodles.wav', '204/204114_2046665-hq.mp3'),
    204531: ('peridactyloptrix', 'Candle flicker/ blown out x4', '204/204531_2737063-hq.mp3'),
    206171: ('ahill86', 'TeaCup44.wav', '206/206171_2568776-hq.mp3'),
    209014: ('OwlStorm', 'Ceramic Tink', '209/209014_140737-hq.mp3', 'no credit needed; if given, Ashe Kirk or Owlish Media'),
    209973: ('jrosin', 'Very old lift.flac', '209/209973_2713464-hq.mp3'),
    210592: ('Yuval', "neighbour's footsteps", '210/210592_770707-hq.mp3'),
    215385: ('Reitanna', 'porcelain clinks slides.wav', '215/215385_950925-hq.mp3', 'the profile recommends a credit, as Reitanna Seishin'),
    216606: ('unfa', 'Strange Cloth Rubbing', '216/216606_1038806-hq.mp3', "if credited: Tobiasz 'unfa' Karoń, with a link to the sound"),
    216664: ('lolamadeus', 'Broken Fridge Slowly Going Insane.wav', '216/216664_544580-hq.mp3'),
    217459: ('JarredGibb', 'Metal Ping 1.wav', '217/217459_4056007-hq.mp3'),
    217461: ('JarredGibb', 'Metal Ping 3.wav', '217/217461_4056007-hq.mp3'),
    217462: ('JarredGibb', 'Metal Ping 4.wav', '217/217462_4056007-hq.mp3'),
    217463: ('JarredGibb', 'Long Metal Pings.wav', '217/217463_4056007-hq.mp3'),
    217884: ('felix.blume', 'Strong wind blowing at night in New Mexico, USA.', '217/217884_1661766-hq.mp3'),
    218163: ('peridactyloptrix', 'Slow wooden creaks x5', '218/218163_2737063-hq.mp3'),
    218928: ('bassboybg', 'Creepy old elevator 2', '218/218928_2019774-hq.mp3'),
    219677: ('harrietniamh', 'Wooden Chair Move.mp3', '219/219677_4061049-hq.mp3', 'the profile asks for a credit when a sound is used in a production'),
    232021: ('Ubehag', 'Stereotypical sinking submarine sound (NO REVERB).aif', '232/232021_3839046-hq.mp3'),
    232130: ('Werra', 'Vintage Camera Flash Powder and Shutter', '232/232130_525427-hq.mp3'),
    238289: ('LoafDV', 'Long Metal Creak', '238/238289_1554038-hq.mp3'),
    240914: ('bdvictor', 'Wheat in the Wind', '240/240914_793708-hq.mp3'),
    242867: ('Reitanna', 'blowing out candle.wav', '242/242867_950925-hq.mp3', 'the profile recommends a credit, as Reitanna Seishin'),
    250105: ('phatcorns', 'Camera Shutter', '250/250105_2772007-hq.mp3'),
    254735: ('jergonda', "Hang Man's Rope", '254/254735_2307999-hq.mp3'),
    257483: ('Sycopation', 'flax2.wav', '257/257483_4459226-hq.mp3'),
    259733: ('YOH', 'Bad Fluorescent Lamp clicks', '259/259733_325907-hq.mp3'),
    264995: ('sethlind', 'Intercom static and buttons.wav', '264/264995_4101863-hq.mp3'),
    268862: ('PhilllChabbb', 'Slow Cracking Ice', '268/268862_4205952-hq.mp3'),
    271130: ('sassyde', 'Pouring Gravel.mp3', '271/271130_726633-hq.mp3'),
    271245: ('bertiehs', 'Gasp Male', '271/271245_1621583-hq.mp3'),
    272171: ('dethrok', 'Evil Dentist', '272/272171_3186672-hq.mp3'),
    272435: ('ryanharding95', 'Old Elevator Door Closing.wav', '272/272435_5163890-hq.mp3'),
    272438: ('ryanharding95', 'Opening Old Elevator Door.wav', '272/272438_5163890-hq.mp3'),
    273150: ('michorvath', 'Heart Beating', '273/273150_3094998-hq.mp3', 'credit welcomed'),
    276473: ('unkleceeg', 'Chair creaking back and forth 01.wav', '276/276473_3327014-hq.mp3'),
    320913: ('mickdow', 'Paper Flutter .wav', '320/320913_2636846-hq.mp3'),
    324590: ('kangaroovindaloo', 'Blowflies!', '324/324590_1728127-hq.mp3'),
    325256: ('deleted_user_2104797', 'Whoosh slow low.wav', '325/325256_2104797-hq.mp3'),
    327534: ('Taberius', 'hissing_gas - zischendes gas.wav', '327/327534_2968631-hq.mp3'),
    328766: ('aerror', 'rattling screws.wav', '328/328766_2472895-hq.mp3'),
    329569: ('leonelmail', 'Roomtone Bedroom Yew', '329/329569_4437257-hq.mp3'),
    330638: ('leonelmail', 'Cloth Flapping On A Clothesline Thickly', '330/330638_4437257-hq.mp3'),
    330639: ('leonelmail', 'Cloth Flapping On A Clothesline Gently', '330/330639_4437257-hq.mp3'),
    331516: ('nikitralala', 'lift_relais.flac', '331/331516_2352202-hq.mp3'),
    334144: ('BonnyOrbit', 'Refrigerator from inside.wav', '334/334144_5902878-hq.mp3'),
    336355: ('Ev-Dawg', 'Heater Vent Hit Lower Part', '336/336355_1772601-hq.mp3'),
    336356: ('Ev-Dawg', 'Heater Vent Hit Higher Part.wav', '336/336356_1772601-hq.mp3'),
    338102: ('SpliceSound', 'Apartment, small quiet bathroom.wav', '338/338102_1480854-hq.mp3'),
    338106: ('SpliceSound', 'Footsteps, barefoot on wet tile.wav', '338/338106_1480854-hq.mp3'),
    342546: ('timbreknight', 'Ice cracking', '342/342546_3562222-hq.mp3'),
    342932: ('ryansitz', 'Wading in Shallow Water.wav', '342/342932_5800259-hq.mp3'),
    342976: ('breiti', 'Metal Sheet Cabinet Hit against 50cmx50cmx200cm hollow Part 1.wav', '342/342976_567141-hq.mp3'),
    344654: ('daymonjlong', 'Belt Slide.mp3', '344/344654_5103151-hq.mp3'),
    345459: ('Artmasterrich', 'Male_Slow_Breathing_01', '345/345459_4038846-hq.mp3'),
    346835: ('yatoimtop', 'PageTurn.wav', '346/346835_2816123-hq.mp3'),
    352964: ('Shain_T', 'HumanSniffing.wav', '352/352964_4428706-hq.mp3'),
    353125: ('BenjaminNelan', 'Paper Rustle', '353/353125_1196020-hq.mp3'),
    353907: ('dr19', 'Shovel_dirt.wav', '353/353907_5984825-hq.mp3'),
    361423: ('taure', 'Whalesong.wav', '361/361423_2940947-hq.mp3'),
    363120: ('TheWoodlandNomad', 'Water Trickle', '363/363120_6612464-hq.mp3'),
    365617: ('Caitlin_100', 'Footsteps running on the floor.mp3', '365/365617_5407590-hq.mp3'),
    365642: ('Dimas3010', 'Old Elevator', '365/365642_3074228-hq.mp3'),
    366159: ('DCSFX', 'Underwater [Loop] AMB.wav', '366/366159_6725579-hq.mp3', 'credit optional'),
    367050: ('TheBuilder15', 'Footsteps with floor creak', '367/367050_6090639-hq.mp3'),
    367328: ('CarloVan19', '160170_wind blowing curtain_OWI.WAV', '367/367328_6108025-hq.mp3'),
    367826: ('shutup_outcast', 'Snapping Stick.wav', '367/367826_6104883-hq.mp3'),
    367955: ('cribbler', 'Well Lid.WAV', '367/367955_3728489-hq.mp3'),
    369294: ('georgisound', 'Creepy_Breathing.wav', '369/369294_6790631-hq.mp3'),
    371019: ('theshuggie', 'Gurney.wav', '371/371019_4541240-hq.mp3'),
    371278: ('Mafon2', 'Сeramic Сlick', '371/371278_1196472-hq.mp3'),
    376205: ('jdaniel1999', 'Camera shutter.wav', '376/376205_3123844-hq.mp3'),
    376644: ('Bronxio', 'Demential, strong wind through the edges of an aluminum door 1 @ 96 KHz 24bit', '376/376644_997039-hq.mp3', 'credit optional, welcomed'),
    378866: ('kijjaz', '20170101 Slide Glass Door 02', '378/378866_26950-hq.mp3'),
    379372: ('13FPanska_Sychra_Petr', 'bus_door_opening.wav', '379/379372_7024255-hq.mp3'),
    380769: ('szczur_banshee', 'BS _Swarm of roaches.wav', '380/380769_1732954-hq.mp3'),
    381650: ('BeeProductive', 'dripping tap.wav', '381/381650_4298084-hq.mp3'),
    382643: ('bbrocer', 'Ceramic Plate Set Down.wav', '382/382643_4297074-hq.mp3'),
    382647: ('bbrocer', 'Ceramic and Glassware Set Down.wav', '382/382647_4297074-hq.mp3'),
    382648: ('bbrocer', 'Ceramic Plate Sounds.wav', '382/382648_4297074-hq.mp3'),
    382654: ('bbrocer', 'Paper Fluttering.wav', '382/382654_4297074-hq.mp3'),
    382671: ('bbrocer', 'Wet Sloppy Eating 2.wav', '382/382671_4297074-hq.mp3'),
    383783: ('deleted_user_7146007', 'Man Coughing Cough', '383/383783_7146007-hq.mp3'),
    384362: ('Ali_6868', 'Digging a Hole and Shovelling Soil/Dirt 2', '384/384362_984733-hq.mp3'),
    388014: ('supersplat1', 'bucket sloshing.mp3', '388/388014_3376993-hq.mp3'),
    388454: ('vovere', 'Movement in bed, blanket.wav', '388/388454_3122595-hq.mp3'),
    389794: ('krnash', 'Crawling on a Wooden Floor.wav', '389/389794_6136319-hq.mp3'),
    391680: ('hz37', 'Distant freeway at night april 2010', '391/391680_123355-hq.mp3'),
    394026: ('rightaway', 'medium jacket ruffling running coat rubbing cloth.wav', '394/394026_2746608-hq.mp3'),
    394596: ('LolitaPerdurabo', 'boleskine house flooded basement', '394/394596_1854719-hq.mp3'),
    397127: ('fattirewhitey', 'SFX - Scratches on Wood.wav', '397/397127_4838185-hq.mp3'),
    398032: ('swordofkings128', 'Splash', '398/398032_7586736-hq.mp3'),
    398694: ('bbrocer', 'Shake, Pepples, Short Roll - Scurry.wav', '398/398694_4297074-hq.mp3'),
    399540: ('Vendarro', 'Leather', '399/399540_4519159-hq.mp3'),
    400653: ('LampEight', 'Wood panel small snap crack prise', '400/400653_706234-hq.mp3'),
    405155: ('Whiplaff', 'Clown Horn', '405/405155_3240081-hq.mp3'),
    406197: ('kyles', 'door metal big heavy close kinda slam thud echo offmic.wav', '406/406197_612689-hq.mp3'),
    409201: ('rosmerypillcofarfan', '33 cabello.wav', '409/409201_7677231-hq.mp3'),
    416908: ('Unknown_Audio', 'Hemp Shaker.aif', '416/416908_2094016-hq.mp3'),
    417537: ('danthaiwang', 'Scratching with Fingernails', '417/417537_3136812-hq.mp3'),
    418487: ('dersinnsspace', 'Nuts and bolts falling down.wav', '418/418487_8224400-hq.mp3'),
    420440: ('davjanus', 'Plates Set Down.wav', '420/420440_6893939-hq.mp3'),
    425702: ('moogy73', 'Woosh_Low_Long01.wav', '425/425702_760420-hq.mp3'),
    431535: ('AnnaFalzzzz', 'ACRYLIC NAILS TAPPING-St.R.wav', '431/431535_8708069-hq.mp3'),
    435469: ('MelvinJaepel', 'forest ambiance at night in germany.wav', '435/435469_6125359-hq.mp3'),
    443037: ('AmberdeMeillon', 'Brushing_Knotty_Hair.WAV', '443/443037_8282799-hq.mp3'),
    444660: ('MirkaElina', 'CityNoise_Soft_48k.wav', '444/444660_4213224-hq.mp3'),
    447375: ('felix.blume', 'Wind singing in an old tube on the top of the mountain', '447/447375_1661766-hq.mp3'),
    449127: ('HarpyHarpHarp', 'Rustling Paper', '449/449127_8895476-hq.mp3'),
    449248: ('boosmyller', 'Gross Chewing with mouth open', '449/449248_128457-hq.mp3'),
    450177: ('kyles', 'sled dogs 2 packs barking howling in distance with building slapback echo.flac', '450/450177_612689-hq.mp3'),
    450255: ('kyles', 'Lovis ship sailboat below deck wood creaks next to mast bottom close intense cool +water sloshing.flac', '450/450255_612689-hq.mp3'),
    451140: ('kyles', 'fly buzz around close to mic.flac', '451/451140_612689-hq.mp3'),
    451914: ('kyles', 'room tone bassy hospital stairwell hum +distant noises.flac', '451/451914_612689-hq.mp3'),
    451918: ('kyles', 'room tone depanneur corner store fluorescent light only hum Montreal, Canada.flac', '451/451918_612689-hq.mp3'),
    451922: ('kyles', 'room tone hospital exam room noisy ventilation Montreal, Canada.flac', '451/451922_612689-hq.mp3'),
    451933: ('kyles', 'switch big breaker metal click on, off.flac', '451/451933_612689-hq.mp3'),
    452625: ('kyles', 'fluorescent light switch on off electric hum prickly close2 two starts.wav', '452/452625_612689-hq.mp3'),
    453443: ('kyles', 'hiss small pipe ext like propane gas.flac', '453/453443_612689-hq.mp3'),
    454092: ('kyles', 'mountain wind heavy strong gusts Swiss Alps.flac', '454/454092_612689-hq.mp3'),
    454378: ('kyles', 'wood creak low sit down on loose park bench and get up.flac', '454/454378_612689-hq.mp3'),
    454420: ('kyles', 'bus coach ext pull up brake air release idle.wav', '454/454420_612689-hq.mp3'),
    455808: ('kyles', 'metal pipe or sign sheet hit thud soft resonate.flac', '455/455808_612689-hq.mp3'),
    456033: ('TiesWijnen', 'Pull switch', '456/456033_1511977-hq.mp3'),
    456037: ('florianreichelt', 'heavy breathing while running', '456/456037_6253486-hq.mp3', 'the profile asks for a tag of instagram.com/florianreichelt in the description'),
    456433: ('mycompasstv', 'Old Rotary Phone Ringing - Western Electric Bell 500 phone', '456/456433_3902754-hq.mp3', 'the profile: credit much appreciated, do not re-post the sound or claim it as your own'),
    457542: ('depwl9992', 'Flexing a Piece of Resonating Copper Sheet Metal', '457/457542_4916028-hq.mp3'),
    459146: ('decembered', 'wind_drone.wav', '459/459146_454894-hq.mp3'),
    459970: ('florianreichelt', 'Footsteps on hollow wood', '459/459970_6253486-hq.mp3', 'the profile asks for a tag of instagram.com/florianreichelt in the description'),
    463902: ('buzzatsea', 'fork stabbing food eating clinking plate.wav', '463/463902_3298379-hq.mp3'),
    465250: ('P_Chester', 'breathing on your right side.wav', '465/465250_1829455-hq.mp3'),
    465495: ('taure', 'syringe.wav', '465/465495_2940947-hq.mp3'),
    465811: ('tomi_slav', 'stones', '465/465811_803201-hq.mp3'),
    467014: ('audioninja001', 'Wood-break-stress.wav', '467/467014_2699264-hq.mp3'),
    468937: ('timothyd4y', 'Closet Doorknob Turn', '468/468937_288104-hq.mp3'),
    470082: ('Sheyvan', 'Watersplish', '470/470082_3248005-hq.mp3'),
    476318: ('ecfike', 'Quarry Tunnel Ambience 1, Large Splash', '476/476318_2337290-hq.mp3'),
    482288: ('richwise', 'Wind over chimney (closed stove)', '482/482288_1481531-hq.mp3'),
    484307: ('RutgerMuller', 'Dentist Cleaning Polishing (96KHz-24Bit).wav', '484/484307_179538-hq.mp3'),
    485421: ('IENBA', 'Footsteps on wood floor', '485/485421_9616576-hq.mp3'),
    486374: ('an_na_ba_na_na', 'breaking a pencil.wav', '486/486374_10441105-hq.mp3'),
    489442: ('Soapuel', 'Creaking Metal.wav', '489/489442_10448599-hq.mp3'),
    491740: ('_lourii', 'Sitting on bed.wav', '491/491740_9624076-hq.mp3'),
    496453: ('Harrisando', 'Setting_Down_Needle.wav', '496/496453_9855691-hq.mp3'),
    500008: ('phonoflora', 'liner gangplank groaning.WAV', '500/500008_401348-hq.mp3'),
    501302: ('JappeHallunken', 'Cracking wood', '501/501302_10865671-hq.mp3'),
    505663: ('dentalx', 'Dental turbine.wav', '505/505663_9836065-hq.mp3'),
    509477: ('be_a_hero_not_a_patriot', 'room tone, big hall, heavy ventilation hum, extremely sparse people.wav', '509/509477_5804919-hq.mp3'),
    512741: ('exe2be', 'Man breathing regularly then faster', '512/512741_2587400-hq.mp3'),
    513665: ('115VAC', 'Crossbar Kiss Off.wav', '513/513665_4457368-hq.mp3'),
    513818: ('115VAC', 'Crossbar Timing Relays.wav', '513/513818_4457368-hq.mp3'),
    514306: ('Lewooz', 'Sub Sul FONDO.mp3', '514/514306_4984902-hq.mp3'),
    517729: ('ZoviPoland', 'clothes drop 5', '517/517729_5845877-hq.mp3'),
    520684: ('Tonik1105', 'Contarex camera shutter.wav', '520/520684_10067806-hq.mp3'),
    521697: ('naturenotesuk', 'Fingernail scratching along a flat wood surface - contact mic', '521/521697_7455632-hq.mp3'),
    524205: ('JovianSounds', 'Radio Sign Off / Squelch', '524/524205_9561949-hq.mp3'),
    524807: ('SamuelGremaud', 'STAIRS (SLOWLY)', '524/524807_8031303-hq.mp3'),
    529383: ('calebrankin', 'Bubbles In Water', '529/529383_5072671-hq.mp3'),
    530437: ('Noted451', 'Small wood Block.wav', '530/530437_9818404-hq.mp3'),
    532180: ('mcmikai', 'Pigeons flying', '532/532180_9735871-hq.mp3'),
    534853: ('deerlord', 'MetalScrape_4.wav', '534/534853_10898147-hq.mp3'),
    536770: ('doctorphil', 'Footsteps on a wooden floor.wav', '536/536770_2594261-hq.mp3'),
    536780: ('egomassive', 'Clink.ogg', '536/536780_1415754-hq.mp3'),
    540162: ('schreibsel', 'Snake hissing.mp3', '540/540162_7898982-hq.mp3'),
    542752: ('PanPiper5', 'Seeds.wav', '542/542752_8499836-hq.mp3'),
    547234: ('bmt79', 'Lip Smacking Sound', '547/547234_10510576-hq.mp3'),
    547898: ('nicotep', 'Gromphadorhina_portentosa_hissing.aif', '547/547898_7529214-hq.mp3'),
    547976: ('trijohnstone', 'sheet metal sound one: womps.wav', '547/547976_8838719-hq.mp3'),
    553075: ('Nox_Sound', 'Foley_Mechanism_Light_Buzz_Short_Loop_Mono_DR05.wav', '553/553075_9250976-hq.mp3'),
    553241: ('NachtmahrTV', 'Wet Footsteps', '553/553241_5620304-hq.mp3'),
    554071: ('christophe1138', 'drowning noise.wav', '554/554071_9054093-hq.mp3'),
    554307: ('casiba842', 'Scared Male Heavy Breathing', '554/554307_10081166-hq.mp3'),
    554906: ('Nox_Sound', 'Male_Breath_Scared_Frozen_Loop_Stereo.wav', '554/554906_9250976-hq.mp3'),
    554907: ('Nox_Sound', 'Male_Breath_Fast_Loop_Stereo.wav', '554/554907_9250976-hq.mp3'),
    556369: ('Nox_Sound', 'Foley_Object_Fridge_Motor_Humming_Loop_Mono_NTG4.wav', '556/556369_9250976-hq.mp3'),
    556722: ('Breviceps', 'Record Player Needle is dropped & Vinyl crackling', '556/556722_9159316-hq.mp3', 'links to the work welcomed'),
    559475: ('Nox_Sound', 'Foley_Phone_Old_PickUp_HangUp_Mono.wav', '559/559475_9250976-hq.mp3'),
    561013: ('TurboFool', 'Polite coughing', '561/561013_9160390-hq.mp3'),
    563138: ('Nox_Sound', 'Foley_Object_Flame_Thrower_Loop_Stereo.wav', '563/563138_9250976-hq.mp3'),
    567732: ('TRP', '200614 Flies, close buzzing, periodic, wide stereo 7am.flac', '567/567732_97550-hq.mp3'),
    568758: ('bowlingballout', 'Cup and Saucer 2.wav', '568/568758_485650-hq.mp3'),
    569255: ('Nakhas', 'Claws animal (foley)', '569/569255_717697-hq.mp3'),
    569256: ('Nakhas', 'Balloon squeaks', '569/569256_717697-hq.mp3'),
    569257: ('Nakhas', 'mirror touchs and squeaks', '569/569257_717697-hq.mp3'),
    569644: ('nicotep', 'Vagues, galets, Qeparo, Albanie.wav', '569/569644_7529214-hq.mp3'),
    571797: ('NachtmahrTV', 'Door slamming hard', '571/571797_5620304-hq.mp3'),
    573728: ('MWsfx', 'Sheets - Scooch Up.wav', '573/573728_12956274-hq.mp3'),
    573730: ('MWsfx', 'Sheets - Sitting Up.wav', '573/573730_12956274-hq.mp3'),
    574170: ('MWsfx', 'Setting Table.wav', '574/574170_12956274-hq.mp3'),
    574752: ('ericnorcross81', 'Bone Breaks (celery snaps)', '574/574752_6970469-hq.mp3'),
    577317: ('TRP', 'Thunder, dry distant rolling, field, NOTL, 2011.wav', '577/577317_97550-hq.mp3'),
    577320: ('TRP', 'Tricycle wheel squeek.wav', '577/577320_97550-hq.mp3'),
    577880: ('casiba842', 'Heavy Bubbles', '577/577880_10081166-hq.mp3'),
    580967: ('PelicanPolice', 'Fabric flaps', '580/580967_13110737-hq.mp3'),
    585935: ('MeliaRoger', 'ANMLInsect_BR Serrinha do alambari Ants walking on contact mics in a nest loudness -16_Melia Roger_Contacts.wav', '585/585935_13222620-hq.mp3'),
    587442: ('SamsterBirdies', 'Dropping sheet metal', '587/587442_5487341-hq.mp3', 'credit welcomed'),
    587443: ('SamsterBirdies', 'Scrap metal dropping / crashing', '587/587443_5487341-hq.mp3', 'credit welcomed'),
    588400: ('FunWithSound', 'Concert Hall Silence Ambiance.mp3', '588/588400_6456158-hq.mp3', 'credit welcomed'),
    590171: ('Greg_Surr', 'Creaking in Room 8.wav', '590/590171_8198141-hq.mp3'),
    593990: ('mincedbeats', 'Gel Squelches.wav', '593/593990_723858-hq.mp3'),
    610543: ('xkeril', 'Rain on roof (interior perspective)', '610/610543_13504080-hq.mp3'),
    611001: ('crowcountingman', 'Fire_Burning_Stove_Closed_Door.wav', '611/611001_10727842-hq.mp3'),
    611197: ('klankbeeld', 'wind in ears.wav', '611/611197_1648170-hq.mp3'),
    624488: ('ValentinPetiteau', 'Rope - leash - slide - tie - swoosh - movement - handle.wav', '624/624488_10443988-hq.mp3'),
    627004: ('rosenberg3', 'Walking through water', '627/627004_13855267-hq.mp3'),
    629445: ('puppetmaster685719', 'Skittering.wav', '629/629445_1181959-hq.mp3'),
    629528: ('lmcgraw1', 'Fork Knife on plate Scuffs and scrapes close to mic', '629/629528_3274630-hq.mp3'),
    629942: ('kyles', 'wood creaks heavy deep old armoir wardrobe closet door open close.wav', '629/629942_612689-hq.mp3'),
    631970: ('PDaefaul', 'Putting on Latex Medical Gloves.wav', '631/631970_11018779-hq.mp3'),
    634746: ('TravieDoodle', 'Pile of Bugs', '634/634746_6637516-hq.mp3'),
    635481: ('kyles', 'bed springs old noisy various creaks and movements get up sit down2.flac', '635/635481_612689-hq.mp3'),
    637534: ('kyles', 'flap flag throw unfurl dramatically, or laundry sheet or blanket.flac', '637/637534_612689-hq.mp3'),
    637585: ('kyles', 'gloves latex rubber snap.flac', '637/637585_612689-hq.mp3'),
    637809: ('kyles', 'rope thick handling rough hairy fishing nets.flac', '637/637809_612689-hq.mp3'),
    637957: ('kyles', 'water movements swimming around small splashes random.flac', '637/637957_612689-hq.mp3'),
    639332: ('felix.blume', 'Roomtone Elwood Museum 1st floor temporary exhibition gallery, AC very loud (Air Conditionner)', '639/639332_1661766-hq.mp3'),
    641306: ('aleclubin', 'House Room Tone', '641/641306_6970169-hq.mp3'),
    641385: ('WhiteFire43', 'Footsteps Running 01.wav', '641/641385_14113815-hq.mp3'),
    646698: ('SoundDesignForYou', 'Scraping Metal Sheet in an Underpass', '646/646698_13085623-hq.mp3'),
    647220: ('kentnelson64', 'Torch Swooshes.WAV', '647/647220_2612143-hq.mp3'),
    649076: ('ValentinPetiteau', 'Wood - stairs - creak - squeak - plank - bend.wav', '649/649076_10443988-hq.mp3'),
    653416: ('cinningbao', '0409_114910 plate scrapes.WAV', '653/653416_100936-hq.mp3'),
    656439: ('IENBA', 'Ghost Whispers', '656/656439_9616576-hq.mp3'),
    660319: ('Samx89', 'Crawling_inside_air_vent.wav', '660/660319_7036697-hq.mp3'),
    672069: ('ilmari_freesound', 'ancient-hatch.wav', '672/672069_12458758-hq.mp3'),
    676033: ('nathankwright', 'Creaking Floor-Creaking Ship Timbers.m4a', '676/676033_5948823-hq.mp3'),
    676375: ('drewtait', 'Film Camera Click Shutter', '676/676375_14682229-hq.mp3'),
    677400: ('whalesofjupiter', 'a handful of antique rusty coffin nails.wav', '677/677400_2631311-hq.mp3'),
    682772: ('thomasanthony321', 'Running footsteps on wood.WAV', '682/682772_14662423-hq.mp3'),
    684518: ('felix.blume', 'Breathing of a human with half open mouth, close recording inside a car in a quiet desert', '684/684518_1661766-hq.mp3'),
    693860: ('Fission9', 'CRT TV Switches On', '693/693860_9395330-hq.mp3'),
    696021: ('Funky_Audio', 'LIQImpt_clay subtle movements and plops_Funky Audio_FASS.wav', '696/696021_14953219-hq.mp3'),
    698697: ('IENBA', 'Footsteps on Metal', '698/698697_9616576-hq.mp3'),
    703025: ('VoxHumanaMusiCurators', 'Breathing machine', '703/703025_25142-hq.mp3'),
    705299: ('felix.blume', 'Dogs barking far with echo in a small village at night', '705/705299_1661766-hq.mp3'),
    706430: ('bruno.auzet', 'swiming pool underwater.wav', '706/706430_11519060-hq.mp3', 'the profile asks you to think about crediting freesound.org'),
    706804: ('lori.mortimer', 'Head scratching & hair brushing - binaural.wav', '706/706804_9190375-hq.mp3'),
    706977: ('JesterWhoo', 'Angry snake hissing. OWI.wav', '706/706977_14781925-hq.mp3'),
    706981: ('JesterWhoo', 'Room tone. Inside a reptile room with a snake. AMB. OWI.wav', '706/706981_14781925-hq.mp3'),
    707320: ('mht23SD', 'Dental chair rising slowly .wav', '707/707320_15272986-hq.mp3'),
    707321: ('mht23SD', 'Dental suction pipe in mouthwash , loud.wav', '707/707321_15272986-hq.mp3'),
    707322: ('mht23SD', 'Dental tube sucking in mouthwash, suction pipe.wav', '707/707322_15272986-hq.mp3'),
    707330: ('mht23SD', 'Dentil Drill.wav', '707/707330_15272986-hq.mp3'),
    707378: ('mht23SD', 'Dental office room tone.wav', '707/707378_15272986-hq.mp3'),
    717845: ('TRP', '230405 Thunder DRY rolling distant low rumbles, roof, EM272s, Toronto 7am', '717/717845_97550-hq.mp3'),
    719430: ('BaggoNotes', 'Door_HandleTurn_Take1', '719/719430_15107322-hq.mp3'),
    722675: ('renrenrenrenren', 'Fabric - Clothes Rustling - Ren', '722/722675_14812013-hq.mp3'),
    722717: ('tsjhwt', 'Soft Slow Breaths', '722/722717_2006228-hq.mp3'),
    727114: ('berboberbo', 'Mice Squeaks', '727/727114_15781963-hq.mp3'),
    728347: ('ricmetal', 'Dentist High-Speed Drill Turning On and Off', '728/728347_354782-hq.mp3'),
    737948: ('tickytac', 'Old Elevator Chime', '737/737948_14665891-hq.mp3'),
    746557: ('capt48', 'Pine Beetle with a great rhythm as it destroys a south Mississippi pine.', '746/746557_16182709-hq.mp3'),
    755366: ('goochiano', 'Wild fire. Large', '755/755366_1185437-hq.mp3'),
    759531: ('Tribunal01', 'Metal_Clinking', '759/759531_16314214-hq.mp3'),
    761405: ('Valerie-Vivegnis', 'Mouth noises 2', '761/761405_15375955-hq.mp3'),
    782907: ('treesound1951', 'wind gale gust whistle', '782/782907_3151368-hq.mp3'),
    783808: ('roisin.gleeson', 'Gentle_water_movements_STEREO_v01', '783/783808_12896641-hq.mp3'),
    785302: ('tylerholtman', 'Fast moving feet', '785/785302_2814449-hq.mp3'),
    786515: ('newlocknew', 'ELECBuzz_An Incandescent lamp.The Last seconds.Unstable Buzzing_EM', '786/786515_5828667-hq.mp3', 'the profile asks for the nickname and the file name in the credits'),
    789065: ('Ultra-Edward', 'Creaking Floorboards', '789/789065_16786392-hq.mp3'),
    790019: ('Nox_Sound', 'Foley_Object_Clock_Old_Tick_Sequence_Stereo', '790/790019_9250976-hq.mp3'),
    790896: ('RinshiFox', 'Head Rubbing Sounds', '790/790896_16253943-hq.mp3'),
    794817: ('SamsterBirdies', 'Fireplace Rumble', '794/794817_5487341-hq.mp3', 'credit welcomed'),
    799662: ('LukaCafuka', 'Analog video hum 2', '799/799662_16236894-hq.mp3'),
    800114: ('CVLTIV8R', 'quartz crystal tapping ceramic plate-003.wav', '800/800114_2520418-hq.mp3', 'credit welcomed'),
    800117: ('CVLTIV8R', 'shells and quartz crystals rustling and scraping on marble.wav', '800/800117_2520418-hq.mp3', 'credit welcomed'),
    803193: ('letaidye', 'Wet Slaps/Footsteps', '803/803193_11468367-hq.mp3'),
    807384: ('tt_runscript', 'Contactor/motor overload relay noises', '807/807384_5365416-hq.mp3'),
    811077: ('DangerLaef', 'Solo Skydive Interior Plane and Freefall', '811/811077_16473-hq.mp3'),
    828623: ('c64cosmin', 'bug legs tapping', '828/828623_7834773-hq.mp3'),
    848923: ('michaelkroz', 'ambience_big hangar', '848/848923_9246803-hq.mp3'),
    859154: ('qubodup', 'Loud Bang Crashing Metal Chunk Dropped in Metal Dumpster', '859/859154_71257-hq.mp3', 'CC0 on its page, while its signature points to the CC BY credit on the profile: name qubodup under sounds, so that either reading is met'),
    860518: ('litamedinger', 'Sick Lung Breath Sounds', '860/860518_17559342-hq.mp3'),
    861352: ('qubodup', 'Annoying Voiceover Wet Mouth Clicks', '861/861352_71257-hq.mp3', 'CC0 on its page, while its signature points to the CC BY credit on the profile: name qubodup under sounds, so that either reading is met'),
    868756: ('Audiofisch', 'Low dog growl', '868/868756_16501964-hq.mp3'),
    870603: ('CHallSmith', 'Weird Sheet Rustle', '870/870603_18412227-hq.mp3'),
    871185: ('richwise', 'Squeaky metal bed', '871/871185_1481531-hq.mp3'),
    875944: ('loganzsound', 'Fluorescent Light Clicks', '875/875944_16682330-hq.mp3'),
}
COURTESY_NOTE = "CC0 needs no credit; these are courtesies. Some uploaders only ask to hear where a sound went, by a comment on its page (it takes a Freesound login, so nobody has done it yet): 828623 (c64cosmin), 417537 (danthaiwang), 320913 (mickdow), 634746 (TravieDoodle), 696021 (Funky_Audio), 547976 (trijohnstone), 524807 (SamuelGremaud), 172411 (EagleStealthTeam), 459970 (florianreichelt), 574752 (ericnorcross81), 418487 (dersinnsspace), 719430 (BaggoNotes). felix.blume (684518, 447375, 639332, 217884, 146436) and klankbeeld (611197) invite comments and ratings. Worth keeping a copy of the page: 639332 and 509477 mention faint voices or sparse people outside the stretches used (the spans used were checked by spectrogram, not by ear); 848923 says it was composed of its uploader's recordings in a shopping mall, pitched down, with reverb; 451914 mentions distant noises, of which only the bass under 350 Hz is used; 185059 (whisper_gabble): its uploader does not consent to training generative models; playing it is fine, do not feed it to any such pipeline. RutgerMuller (51153, 104013, 104016, 104019, 104351, 484307) asks that his unedited sounds are not sold on, and that a credit does not read as a collaboration: everything here is cut and filtered."

# ---------------------------------------------------------------- the list of sounds


class Sound:
    def __init__(self, name, kind, rooms, desc, gain, fx, fn, level, kbps):
        self.name, self.kind, self.rooms, self.desc, self.gain, self.fx, self.fn, self.level, self.kbps = name, kind, rooms.split(), desc, gain, fx, fn, level, kbps
        self.used = []


SOUNDS = {}


def _register(name, kind, rooms, desc, gain, fx, fn, level, kbps):
    assert name not in SOUNDS, name
    SOUNDS[name] = Sound(name, kind, rooms, desc, gain, fx, fn, level, kbps)


def shot(name, rooms, desc, gain, fx="dry", peak_db=PEAK_SHOT, kbps=None):
    """A one-shot, drawn by the function it decorates."""
    def deco(fn):
        _register(name, "one-shot", rooms, desc, gain, fx, fn, peak_db, kbps)
        return fn

    return deco


def bed(name, rooms, desc, gain, fx="dry", level=RMS_BED, kbps=None):
    """A bed, drawn by the function it decorates, which returns a loop whose ends already meet."""
    def deco(fn):
        _register(name, "bed", rooms, desc, gain, fx, fn, level, kbps)
        return fn

    return deco


def cut(name, rooms, desc, gain, fx, fid, a, b, hp_hz=0, lp_hz=0, rate=1.0, ch="mid", fades=(0.003, 0.012), peak_db=PEAK_SHOT, kbps=None):
    """A one-shot that is one span of one recording."""
    def fn(rng):
        x = rec(fid, a, b, ch)
        if hp_hz:
            x = hp(x, hp_hz)
        if lp_hz:
            x = lp(x, lp_hz)
        x = speed(x, rate)
        return fade(x, *fades)

    _register(name, "one-shot", rooms, desc, gain, fx, fn, peak_db, kbps)


def loop(name, rooms, desc, gain, fx, fid, a, b, xf=2.0, hp_hz=0, lp_hz=0, rate=1.0, ch="mid", level=RMS_BED, kbps=None):
    """A bed that is one span of one recording, its ends cross-faded into each other."""
    def fn(rng):
        x = rec(fid, a, b, ch)
        if hp_hz:
            x = hp(x, hp_hz)
        if lp_hz:
            x = lp(x, lp_hz)
        x = speed(x, rate)
        return seam(x, xf)

    _register(name, "bed", rooms, desc, gain, fx, fn, level, kbps)


def family(name, count, rooms, desc, gain, fx, fid, a, b, kind="hits", ch="mid", hp_hz=0, lp_hz=0, rate=1.0, fades=(0.002, 0.02), peak_db=PEAK_SHOT, keep=None, drop=(), **find):
    """name_1 .. name_count: the strongest separate events in one span of one recording (hits, or spans with some length).
    `drop`: numbers that no room plays, so they are not built; the others keep their names and their events."""
    numbers = keep or list(range(1, count + 1))

    def maker(k):
        def fn(rng):
            x = rec(fid, a, b, ch)
            if hp_hz:
                x = hp(x, hp_hz)
            if lp_hz:
                x = lp(x, lp_hz)
            found = find_hits(x, max(numbers), **find) if kind == "hits" else find_spans(x, max(numbers), **find)
            i, j = found[k - 1]
            _used[-1] = (fid, a + i / SR, a + j / SR)
            return fade(speed(x[..., i:j], rate), *fades)

        return fn

    for n, k in enumerate(numbers, 1):
        if n not in drop:
            _register(f"{name}_{n}", "one-shot", rooms, desc, gain, fx, maker(k), peak_db, None)


# ---------------------------------------------------------------- lights and relays


def align_seam(x, seconds, search=0.03):
    """A loop out of a span with a steady tone in it: its end point moves a little until the two ends agree in phase."""
    n = x.shape[-1]
    k = int(seconds * SR)
    m = mono(x)
    head = m[:k]
    best, best_end = -2.0, n
    span = int(search * SR)
    # try only every 8th sample first: a hum's phase moves slowly
    for end in range(n - span, n + 1, 8):
        tail = m[end - k : end]
        r = float(np.dot(head, tail))
        if r > best:
            best, best_end = r, end
    return seam(x[..., :best_end], seconds)


def _hum_loop(fid, a, b, xf, hp_hz=0, lp_hz=0, ch="mid"):
    x = rec(fid, a, b, ch)
    if hp_hz:
        x = hp(x, hp_hz)
    if lp_hz:
        x = lp(x, lp_hz)
    return align_seam(x, xf)


@bed("fluorescent_hum", "corridor waitingroom elevator ward", "A room with nothing on but its fluorescent tubes: a shop at night, mains hum and its overtones, steady. The waiting room's whole bed, the corridor's.", 0.1, "dry")
def _fluor_hum(rng):
    return _hum_loop(451918, 1.5, 22.0, 1.5, hp_hz=40)


@bed("fluorescent_hum_close", "kitchen elevator dentist", "One tube right over you, a clean buzz on 100 Hz with its overtones. For the kitchen once the light is on, the lift's ceiling.", 0.1, "dry")
def _fluor_close(rng):
    return _hum_loop(125064, 6.0, 21.5, 1.5, hp_hz=60)


@bed("fluorescent_hum_bad", "kitchen waitingroom elevator ward", "A tube about to fail: prickly hum full of small crackles. For a light that should worry you.", 0.08, "dry")
def _fluor_bad(rng):
    return _hum_loop(452625, 7.0, 25.0, 1.5, hp_hz=80)


cut("fluorescent_start_1", "kitchen waitingroom", "A tube starting: two dull thumps and it catches.", 0.34, "dry", 145119, 0.2, 2.45, hp_hz=40, fades=(0.002, 0.25))
cut("fluorescent_start_2", "kitchen", "A tube starting with a harsh prickly buzz, then the hum.", 0.26, "dry", 452625, 0.15, 2.9, hp_hz=60, fades=(0.002, 0.35))
family("fluorescent_tick", 6, "kitchen waitingroom", "One starter click with its small metal ring. Scatter them unevenly in the dark before the light comes on.", 0.2, "dry", 875944, 0.0, 25.3, kind="hits", hp_hz=300, before=0.002, after=0.26, min_gap=0.2)
cut("fluorescent_stutter_1", "kitchen", "An irregular burst of starter clicks, about a second: the first failed try.", 0.24, "dry", 875944, 2.0, 3.2, hp_hz=300, fades=(0.002, 0.08))
cut("fluorescent_stutter_2", "kitchen", "Another burst of starter clicks, two seconds, sparser: the second try.", 0.24, "dry", 259733, 2.05, 4.4, hp_hz=200, fades=(0.002, 0.1))
cut("light_die", "kitchen elevator ward", "A tube dying: the buzz falling apart over a few seconds of bad contact. For a light that goes.", 0.2, "dry", 202612, 1.0, 6.0, fades=(0.01, 1.0))

family("relay_clunk", 5, "waitingroom", "A heavy contactor dropping out: one hard metal clack with a short tail. One for each row of lights going out, walking toward you: louder and drier as it comes.", 0.36, "reverb 0.3, low-pass 2500 far away", 807384, 40.0, 112.0, kind="hits", hp_hz=90, before=0.002, after=0.42, min_gap=0.5)
cut("breaker_clunk_1", "waitingroom exam kitchen", "A big breaker thrown on: a hard chunk with low weight.", 0.4, "reverb 0.2", 451933, 0.05, 1.05, fades=(0.001, 0.1))
cut("breaker_clunk_2", "waitingroom exam ward", "The same breaker thrown off, with a rattle after it.", 0.4, "reverb 0.2", 451933, 1.55, 3.3, fades=(0.001, 0.2))
cut("power_thunk", "exam elevator", "A big switch in an industrial room: a heavy blow and the transformers starting to hum. The follow spot coming on; the lift's emergency light.", 0.5, "reverb 0.3", 139970, 1.15, 5.5, hp_hz=30, fades=(0.001, 1.2))
cut("switch_small", "kitchen home elevator waitingroom dolls", "A plain wall switch.", 0.3, "reverb 0.1", 161229, 0.62, 0.95, fades=(0.001, 0.05))
cut("pull_cord", "mirror stairs dolls evening", "A pull cord on a ceiling lamp.", 0.3, "reverb 0.1", 456033, 0.8, 1.2, fades=(0.001, 0.05))
family("lift_relay", 3, "elevator", "A telephone-exchange relay letting go, a dry rattle of contacts. Once for each floor that passes.", 0.3, "reverb 0.1", 513665, 0.0, 1.0, kind="hits", before=0.002, after=0.14, min_gap=0.12)
loop("relay_chatter", "elevator", "Timing relays in an old exchange ticking on and on, unevenly. Faint behind the lift's walls: the machine thinking.", 0.05, "low-pass 3000", 513818, 0.5, 12.5, xf=1.0, hp_hz=200)


# ---------------------------------------------------------------- bulbs


@bed("bulb_hum", "mirror stairs dolls dentist", "A bare bulb: thin high filament buzz and a little mains. Very low; it is what you hear when nothing else is there.", 0.1, "dry")
def _bulb(rng):
    return _hum_loop(201788, 30.0, 58.0, 2.0, hp_hz=70)


@bed("bulb_hum_unsteady", "mirror", "A bulb on its way out: unsteady, high buzzing. For 36 in the mirror, under the blinking.", 0.08, "dry")
def _bulb_bad(rng):
    return seam(hp(rec(786515, 2.0, 30.0), 300), 2.0)


@bed("sodium_lamp_buzz", "busstop", "The mains buzz of a street lamp, thin and steady. It is all that is left at the end of the bus stop.", 0.16, "dry")
def _sodium(rng):
    return _hum_loop(553075, 0.5, 19.5, 1.5)


# ---------------------------------------------------------------- the clock


@bed("clock_tick", "corridor waitingroom home album", "An old wooden wall clock, tick and tock not quite even, about one a second, with the little room around it. Twelve ticks that loop. Low, off to one side.", 0.08, "reverb 0.15 at most")
def _clock(rng):
    # from just before one tick to just before the tick twelve later: the seam falls in the silence between them
    x = hp(rec(790019, 0.93, 13.26), 60)
    return seam(x, 0.05)


@shot("clock_tick_once", "album home funeral", "The same clock, one tick, close and huge, slowed a little with a blow made for this piece under it. It has never moved before: 18:31.", 0.7, "reverb 0.5")
def _clock_once(rng):
    t = fade(speed(hp(rec(790019, 9.22, 9.75), 60), 0.72), 0.001, 0.12)
    n = int(1.2 * SR)
    s = np.arange(n) / SR
    thump = np.sin(TAU * (48 * s + 3 * np.exp(-s / 0.03))) * np.exp(-s / 0.16)
    tape = Tape(1.2)
    tape.put(t / peak(t), 0.0, 1.0)
    tape.put(thump, 0.0, 0.5)
    return tape.x


cut("clock_tock_far", "album karabasan", "A single tock, a little dull, to place far away by hand.", 0.25, "low-pass 2000, reverb 0.5", 790019, 10.2, 10.72, hp_hz=60, fades=(0.001, 0.08))
family("pine_beetle_tick", 3, "karabasan home", "A beetle in the wood: one dry tick. A clock inside the walls, for a very quiet moment.", 0.16, "dry", 746557, 2.9, 18.2, kind="hits", hp_hz=500, before=0.002, after=0.05, min_gap=0.3, drop=(2,))


# ---------------------------------------------------------------- paper

cut("paper_ticket", "waitingroom exam", "A small paper slip handled: a short dry rustle.", 0.3, "dry", 353125, 0.1, 1.1, hp_hz=200, fades=(0.005, 0.05))
family("paper_rustle", 4, "waitingroom exam funeral", "A sheet moved in fingers, somewhere in the room. Separate rustles, between half a second and a second.", 0.24, "reverb 0.2", 449127, 0.0, 6.4, kind="spans", threshold=-34.0, gap=0.2, shortest=0.2, hp_hz=200, pad=(0.01, 0.04), drop=(4,))
cut("page_turn", "exam", "One page turned: the paper at each new question.", 0.4, "reverb 0.1", 346835, 0.0, 0.5, hp_hz=150, fades=(0.002, 0.03))


@bed("paper_flutter", "shaft album", "A great many sheets of paper fluttering in moving air, without end. In the shaft it falls with you; in the album, very low, the prints stirring.", 0.14, "dry")
def _flutter(rng):
    a = hp(rec(320913, 14.0, 33.0), 220)
    return seam(a, 2.0)


cut("print_flutter", "album corridor", "A short shake of stiff paper: one print stirring as you pass.", 0.2, "reverb 0.3", 382654, 13.0, 14.0, hp_hz=300, fades=(0.02, 0.2))


# ---------------------------------------------------------------- breath


def quiet_loop(x, xf=0.12, search=0.7):
    """A loop of something that has pauses in it (breath, steps): both ends are moved to the quietest moment near them, and the seam falls there."""
    m = np.abs(mono(x))
    hop = int(0.02 * SR)
    k = len(m) // hop
    env = np.sqrt(np.mean(np.square(m[: k * hop].reshape(k, hop)), axis=1))
    w = int(search / 0.02)
    i = int(np.argmin(env[:w]))
    j = k - w + int(np.argmin(env[k - w :]))
    return seam(x[..., i * hop : (j + 1) * hop + int(xf * SR)], xf)


def _breath_loop(fid, a, b, hp_hz=60, lp_hz=0, xf=0.12, search=0.7, ch="mid"):
    x = hp(rec(fid, a, b, ch), hp_hz)
    if lp_hz:
        x = lp(x, lp_hz)
    return quiet_loop(x, xf, search)


@bed("breath_calm", "all", "Your own breath, slow and even, a man's, dry and right in the head. Three cycles.", 0.12, "dry, centred")
def _b_calm(rng):
    return _breath_loop(345459, 0.05, 7.4, hp_hz=40, search=0.3)


@bed("breath_other", "karabasan home darkness waitingroom elevator", "Someone else's slow breath, very soft, two long cycles. Hard to one side, close: someone sits there.", 0.2, "dry; pan to one ear")
def _b_other(rng):
    return _breath_loop(722717, 10.0, 30.5, hp_hz=60, search=1.2)


@bed("breath_beside", "waitingroom darkness karabasan", "A person breathing slowly beside you, recorded from one side, close to the mic. Use at 40 in the waiting room against the left ear, at any time behind you in the dark.", 0.25, "dry; pan -0.9 or 0.9")
def _b_beside(rng):
    return _breath_loop(465250, 2.0, 24.0, hp_hz=80)


@bed("breath_open_mouth", "karabasan chase holes", "A wet throat breathing through a half open mouth in nearly silent air, very natural and very close. For the thing leaning over you.", 0.22, "dry")
def _b_mouth(rng):
    return _breath_loop(684518, 17.6, 36.0, hp_hz=70, search=1.0)


@bed("breath_scared", "elevator crawl home spiders", "A man holding himself still: quick shallow breaths through the mouth with stops between them. A held fear. Loops every seven seconds.", 0.2, "dry")
def _b_scared(rng):
    return _breath_loop(554906, 0.0, 7.05, hp_hz=120, search=0.25, xf=0.04)


@bed("breath_fast", "crawl chase buried", "Fast shallow breath, even, in and out, about one cycle a second. Raise `rate` a little as it gets worse.", 0.2, "dry")
def _b_fast(rng):
    return _breath_loop(554907, 0.0, 5.18, hp_hz=120, search=0.15, xf=0.03)


@bed("breath_panic", "crawl chase karabasan buried", "A man badly frightened: arrhythmic, heavy, catching. A long take, twenty-five seconds before it comes round again.", 0.2, "dry")
def _b_panic(rng):
    return _breath_loop(554307, 0.2, 26.0, hp_hz=80, search=1.0)


@bed("breath_labored", "karabasan home", "Labored breathing with a groan in it, from somebody who should not be close to the microphone. Performed. Sparse: for the line on the telephone, or the weight on your chest.", 0.25, "dry")
def _b_labored(rng):
    return _breath_loop(369294, 3.0, 21.3, hp_hz=70, search=0.8)


cut("breath_rising", "crawl spiders home", "Sixteen seconds of a man's breath that starts slow and turns fast near the end. Start it 11 s before the moment.", 0.24, "dry", 512741, 0.05, 16.2, hp_hz=100, fades=(0.05, 0.1))
cut("breath_lungs", "ward karabasan", "A long breath out through sick lungs: small squeaks and rattles inside the chest. Very quiet, and it needs a quiet room.", 0.4, "dry", 860518, 9.0, 11.1, hp_hz=200, fades=(0.05, 0.2))
cut("breath_in", "all", "One long calm breath in through the nose and mouth.", 0.25, "dry", 345459, 4.8, 6.75, hp_hz=40, fades=(0.03, 0.1))
cut("breath_out", "all", "One long calm breath out.", 0.25, "dry", 345459, 2.15, 3.3, hp_hz=40, fades=(0.01, 0.15))
cut("breath_held", "deep elevator home mirror", "A quick breath drawn in and then nothing: the moment of holding it. Stop every other sound on its end.", 0.3, "dry", 554906, 2.22, 2.9, hp_hz=120, fades=(0.01, 0.06))
cut("breath_let_go", "deep elevator home", "The air let go after being held: one long shaky breath out.", 0.3, "dry", 554307, 3.8, 5.3, hp_hz=80, fades=(0.02, 0.2))
family("breath_catch", 4, "karabasan chase crawl", "A short involuntary catch of the breath. In karabasan: every time the viewer tries to move.", 0.3, "dry", 554307, 8.0, 34.0, kind="spans", threshold=-20.0, gap=0.05, shortest=0.2, longest=0.5, hp_hz=80, pad=(0.005, 0.03))
family("gasp", 4, "karabasan spiders beam mirror", "A man's sharp gasp, drawn in with surprise. Use one at most per room.", 0.3, "dry", 171942, 0.0, 15.0, kind="spans", threshold=-24.0, gap=0.15, shortest=0.15, hp_hz=70, pad=(0.01, 0.06), drop=(3, 4))
cut("gasp_small", "karabasan home", "A very small male gasp, almost nothing.", 0.3, "dry", 271245, 0.0, 0.6, hp_hz=70, fades=(0.005, 0.05))
cut("gasp_surface", "deep flood", "A man coming up for air: a long desperate drawn breath. In the deep, when the breath is let go.", 0.4, "low-pass 2200 under water", 169931, 0.0, 2.6, hp_hz=70, fades=(0.005, 0.2))
family("sniff", 2, "karabasan home darkness", "Someone sniffing through the nose, close, once. Being smelled.", 0.25, "dry; hard to one side", 352964, 2.0, 14.0, kind="spans", threshold=-24.0, gap=0.12, shortest=0.2, longest=1.6, hp_hz=200, ch="left", pad=(0.02, 0.05))


# ---------------------------------------------------------------- the heart

_LUBS = [(0.25, 0.27), (1.42, 0.27), (3.87, 0.27), (5.03, 0.27), (10.03, 0.27)]
_DUBS = [(0.56, 0.34), (1.74, 0.34), (4.19, 0.34), (9.04, 0.34), (11.49, 0.34)]


def _heart_slices():
    src = lp(rec(273150, 0.0, 12.18), 2500)
    lub = [fade(src[int(a * SR) : int((a + d) * SR)], 0.003, 0.08) for a, d in _LUBS]
    dub = [fade(src[int(a * SR) : int((a + d) * SR)], 0.003, 0.1) for a, d in _DUBS]
    return [x / peak(x) for x in lub], [x / peak(x) for x in dub]


def _heart_loop(period, count, rng):
    lub, dub = _heart_slices()
    tape = Tape(period * count, wrap=True)
    n = int(0.3 * SR)
    s = np.arange(n) / SR
    sub = np.sin(TAU * 47 * s) * np.exp(-s / 0.08)
    for i in range(count):
        at = i * period
        tape.put(lub[i % 5], at, 1.0)
        tape.put(sub, at, 0.5)
        tape.put(dub[(i * 2) % 5], at + 0.28 * period, 0.72)
        tape.put(sub, at + 0.28 * period, 0.3)
    return tape.x


@bed("heart_slow", "crawl deep ward", "A heart at rest, felt more than heard, one beat every 1.1 s, exact. `rate` follows it up.", 0.3, "low-pass 800 under water")
def _heart_s(rng):
    return _heart_loop(1.1, 8, rng)


@bed("heart_fast", "crawl chase deep", "A frightened heart, one beat every 0.6 s, exact, with weight under it for small speakers to miss and headphones to feel.", 0.3, "low-pass 800 under water")
def _heart_f(rng):
    return _heart_loop(0.6, 12, rng)


@shot("heart_beat", "all", "One heartbeat, lub and dub. Fire it by hand on `frame.heartbeat`, or once in a silence.", 0.4, "dry")
def _heart_one(rng):
    lub, dub = _heart_slices()
    tape = Tape(0.9)
    n = int(0.3 * SR)
    s = np.arange(n) / SR
    sub = np.sin(TAU * 47 * s) * np.exp(-s / 0.08)
    tape.put(lub[0], 0.0)
    tape.put(sub, 0.0, 0.5)
    tape.put(dub[0], 0.3, 0.72)
    tape.put(sub, 0.3, 0.3)
    return fade(tape.x, 0.001, 0.05)


# ---------------------------------------------------------------- bed and sheets

cut("bed_weight_1", "karabasan", "Something heavy coming down on the mattress, heard from under it: a squeak and a click and the frame taking it. At 44.", 0.5, "dry", 871185, 35.2, 37.6, hp_hz=50, fades=(0.005, 0.25))
cut("bed_weight_2", "karabasan", "The same bed taking more weight, a short squeak. At 50, kneeling over the legs.", 0.5, "dry", 871185, 44.2, 46.0, hp_hz=50, fades=(0.005, 0.25))
cut("bed_weight_3", "karabasan home", "A bed frame giving, longer and slower, metal and wood.", 0.45, "dry", 871185, 9.14, 11.84, hp_hz=50, fades=(0.005, 0.3))
cut("bed_sit_soft", "karabasan", "A person sitting on a thick mattress: mass and air, no squeak. You feel the bed tip. Lay it under the other weights.", 0.6, "dry", 491740, 2.6, 4.24, fades=(0.005, 0.2))
cut("bed_settle", "karabasan spiders", "Old springs slowly settling after someone has sat down.", 0.35, "reverb 0.1", 635481, 34.5, 38.6, hp_hz=60, fades=(0.01, 0.4))
family("bedspring", 3, "beds spiders karabasan", "One old bedspring, one small complaint. In the meadow: far off, with reverb, at 6.", 0.3, "reverb 0.4 outdoors", 635481, 40.0, 110.0, kind="spans", threshold=-22.0, gap=0.08, shortest=0.15, longest=1.2, hp_hz=120, pad=(0.01, 0.1), drop=(3,))
cut("sheet_sit_up", "karabasan beds ward", "One smooth movement of a body sitting up under sheets, close.", 0.5, "dry", 573730, 0.3, 3.1, hp_hz=60, fades=(0.05, 0.2))
cut("sheet_scooch", "karabasan home ward", "A body sliding slowly across bedsheets, drawing closer. No bumps.", 0.6, "dry", 573728, 1.08, 4.3, hp_hz=60, fades=(0.08, 0.3))
cut("blanket_move", "karabasan spiders", "A slow movement under a blanket, six seconds long.", 0.6, "dry", 388454, 17.08, 23.02, hp_hz=100, fades=(0.2, 0.5))
cut("sheet_over_face", "ward funeral", "A sheet drawn up over you and settling: slow cloth, then still.", 0.5, "low-pass 3000", 870603, 6.2, 10.46, fades=(0.3, 0.8))
cut("sheet_slide_floor", "darkness", "A sheet slipping off furniture to the floor: a sigh of cloth and a soft landing. Somewhere in the dark, between shots.", 0.5, "reverb 0.3; low-pass 2500 when far", 517729, 0.0, 1.0, fades=(0.005, 0.1))
cut("sheet_drop_long", "darkness washing", "A big sheet thrown down and falling open, four seconds, with an unfurling at the start.", 0.4, "reverb 0.2", 637534, 0.1, 4.7, fades=(0.01, 0.4))


@shot("sheets_thousand", "beds", "A thousand sheets moving together, made from one heavy sheet shaken: it rises slowly over three seconds from all sides. At 11.5.", 0.55, "already wide; reverb 0.3", kbps=128)
def _sheets(rng):
    src = lp(rec(870603, 0.12, 10.46), 6000)
    src = src / peak(src)
    tape = Tape(7.0, channels=2)
    for _ in range(90):
        a = int(rng.uniform(0, src.shape[0] - 2.5 * SR))
        piece = fade(src[a : a + int(2.5 * SR)], 0.4, 1.2)
        piece = speed(piece, rng.uniform(0.8, 1.25))
        at = rng.uniform(0.0, 3.2) + rng.uniform(0.0, 1.0)
        tape.put(piece, at, rng.uniform(0.1, 0.5), rng.uniform(-1, 1))
    return fade(shape(tape.x, [(0, 0.1), (3.0, 1.0), (5.0, 0.8), (7.0, 0.0)]), 0.3, 0.8)


# ---------------------------------------------------------------- floors, doors

family("floor_creak", 6, "karabasan spiders darkness home", "One board taking weight: a single slow creak, between half a second and a second and a half. Low-pass them and they are in another room, or above.", 0.3, "reverb 0.15; low-pass 1800 for far or above", 789065, 0.0, 35.0, kind="spans", threshold=-20.0, gap=0.1, shortest=0.4, longest=1.6, ch="mid", hp_hz=80, pad=(0.01, 0.08), drop=(5, 6))
cut("floor_creak_long", "karabasan darkness home mirror", "A person shifting their weight slowly on an old floor: a long creak that goes on for six seconds.", 0.3, "reverb 0.15", 676033, 14.82, 20.6, hp_hz=60, fades=(0.05, 0.4))
family("floor_step_near", 3, "darkness karabasan", "A slow bare footstep on a wooden floor with a little creak, near.", 0.3, "reverb 0.1", 367050, 0.0, 3.0, kind="hits", before=0.01, after=0.55, min_gap=0.4, hp_hz=50)
family("step_wood", 5, "home darkness chase", "A shoe on a wooden floor, unhurried, one step.", 0.35, "reverb 0.15", 485421, 0.0, 18.0, kind="hits", before=0.01, after=0.4, min_gap=0.35, hp_hz=50, drop=(5,))
family("tread_heavy", 4, "home", "A heavy tread on a wooden floor, slowed down until it is too big. The headless man walking the room.", 0.45, "reverb 0.2", 459970, 0.0, 27.0, kind="hits", before=0.01, after=0.45, min_gap=0.35, hp_hz=40, rate=0.82)
cut("steps_above_walk", "home", "Someone walking across the room above, a dozen unhurried steps through the ceiling. Pan it across at 24.", 0.55, "dry", 210592, 2.0, 12.0, fades=(0.1, 0.5))
cut("steps_above_stop", "home", "After a pause, the last heavier step above, where it stops.", 0.6, "dry", 210592, 32.5, 33.5, fades=(0.01, 0.15))
family("stair_tread", 6, "home flood stairs", "One tread of an old wooden staircase under a slow foot, each one different. One at a time, unhurried: nearer and louder.", 0.4, "reverb 0.15", 524807, 0.0, 21.0, kind="hits", before=0.02, after=0.6, min_gap=0.45, hp_hz=40)
family("stair_creak", 6, "home flood karabasan darkness", "A stair or plank bending: a long dry creak, cut from silence. They work as any old wood under weight.", 0.35, "reverb 0.15", 649076, 0.0, 22.9, kind="spans", threshold=-26.0, gap=0.1, shortest=0.3, longest=1.4, hp_hz=70, pad=(0.005, 0.06), drop=(2, 6))
family("wood_creak_small", 5, "dolls washing funeral party", "A small dry creak of wood: a chair, a shelf, a joint. Short and thin.", 0.25, "reverb 0.2", 159645, 0.0, 6.9, kind="spans", threshold=-20.0, gap=0.08, shortest=0.08, longest=0.7, hp_hz=200, pad=(0.003, 0.03))

cut("door_creak_slow", "corridor karabasan home", "A wooden door opening by itself: one very long slow creak with the wood's low groan under it. Lightly dulled it is far off.", 0.4, "reverb 0.3", 125310, 0.05, 5.7, hp_hz=70, fades=(0.15, 0.5))
cut("door_creak_short", "corridor mirror darkness", "The same door moved a hand's width: one short creak.", 0.4, "reverb 0.3", 125310, 5.95, 7.45, hp_hz=70, fades=(0.08, 0.2))
cut("door_handle_slow", "home mirror", "An antique knob on a heavy door turned very slowly, and let spring back. At 40 in the wardrobe.", 0.4, "reverb 0.1", 468937, 0.14, 1.18, fades=(0.005, 0.04))
cut("door_handle_slow_2", "home karabasan", "A handle turned at its slowest and let go: the release is the frightening part.", 0.4, "reverb 0.1", 719430, 2.0, 3.48, fades=(0.005, 0.05))
cut("door_shut_soft", "home karabasan", "A wooden door pulled quietly shut.", 0.4, "reverb 0.2", 125958, 1.85, 2.85, fades=(0.005, 0.1))
cut("door_slam", "chase corridor", "A wooden door slammed hard. It holds.", 0.7, "reverb 0.3", 571797, 0.95, 2.5, fades=(0.001, 0.2))
cut("door_thud", "chase", "A dull heavy blow on a shut door, from the other side.", 0.6, "reverb 0.2; low-pass 1000", 133851, 1.04, 1.42, fades=(0.002, 0.08))
cut("door_knock_heavy", "chase corridor", "Five very heavy knocks on a door, nearly all below hearing. Felt.", 0.7, "dry", 133851, 1.04, 3.16, fades=(0.002, 0.05))
cut("door_far_metal", "beam ward", "A heavy metal door shut far away: a thud and its echo.", 0.5, "dry, already far", 406197, 0.25, 3.0, fades=(0.002, 0.3))
cut("wardrobe_door", "home", "A wardrobe door opened and pulled shut from inside: dry wood, deep creak. At the cut into the wardrobe.", 0.4, "dry", 629942, 3.5, 7.3, hp_hz=60, fades=(0.02, 0.3))
cut("crawl_wood_3", "karabasan darkness", "A person crawling on a wooden floor, nearer and a little faster: cloth, palms and knees. Very quiet in the source, so it carries its own room.", 0.5, "dry", 389794, 7.06, 8.94, hp_hz=70, fades=(0.05, 0.2))
cut("slat_push", "home", "A thin wooden slat bent inward: the small creak when it is pushed.", 0.45, "dry", 649076, 7.6, 8.6, hp_hz=120, fades=(0.005, 0.1))


# ---------------------------------------------------------------- insects and spiders


loop("spider_legs_soft", "spiders", "All ten fingertips drummed on a floor: many soft legs at once, close, in near silence. Pan it with the thing on the ceiling; bring it up with the hard one.", 0.14, "dry", 828623, 1.42, 18.6, xf=1.2, hp_hz=150)
loop("spider_legs_hard", "spiders", "Acrylic nails on a hollow surface, about twelve hard clicks a second: the legs that have claws. Short loop; `rate` 0.8 to 1.2 keeps it alive. Layer it over the soft one.", 0.1, "dry", 431535, 0.06, 5.8, xf=0.3, hp_hz=300)
loop("spider_skitter", "spiders kitchen", "A dry, dense run of broadband ticks, from far off to close. Pan it across the stereo at 36.", 0.12, "dry", 629445, 33.5, 41.5, xf=0.6, hp_hz=300)
loop("spider_chitter", "spiders holes", "Mandibles, not feet: a thin high chitter and steps with nothing below 4 kHz. Close to the ear, very low; at 52 when the big one is on the lens.", 0.08, "dry", 202108, 0.12, 12.7, xf=0.8, ch="stereo", kbps=128)
family("spider_tick", 6, "spiders", "One leg set down, a single dry tick. From where it is, while it walks and stops. Pan each one.", 0.2, "dry", 431535, 0.06, 5.8, kind="hits", hp_hz=300, before=0.001, after=0.035, min_gap=0.06, fades=(0.001, 0.008))
family("spider_tick_soft", 4, "spiders", "A soft fingertip tap of a leg. When it is still far from you.", 0.25, "dry", 828623, 1.42, 18.6, kind="hits", hp_hz=150, before=0.002, after=0.06, min_gap=0.08)


@bed("legs_on_skin", "spiders", "Ticks on skin, right here, on your face in the black: soft tapping and dry scalp scratching together. From 58 on.", 0.3, "dry", kbps=112)
def _on_skin(rng):
    a = hp(rec(828623, 4.0, 16.0), 200)
    b = hp(rec(51153, 1.62, 4.44), 1500)
    tape = Tape(12.0, wrap=True)
    tape.put(a / peak(a), 0.0, 1.0)
    for at in (0.7, 3.4, 5.1, 8.3, 10.0):
        tape.put(fade(b, 0.02, 0.1) / peak(b), at, 0.2)
    return tape.x


@shot("swarm_swell", "spiders kitchen", "Everything moving at once, rising from nothing to all round the head over six seconds, then held. For 45 in the spiders, 38 in the kitchen. Stop it dead when the light returns.", 0.5, "dry; already wide", kbps=128)
def _swarm(rng):
    a = rec(585935, 15.0, 31.0, "stereo")
    b = rec(634746, 20.0, 45.0, "stereo")
    n = int(9.0 * SR)
    t = np.arange(n) / SR
    up = np.minimum(1, t / 6.0) ** 2
    x = hp(a[..., :n], 200) / peak(a) + hp(b[..., :n], 200) / peak(b) * 0.8
    return fade(x * up, 0.2, 0.05)


loop("insects_contact", "kitchen spiders", "Contact mics dropped on an anthill: real bodies walking on the sensor, crowded and dry. What a surface hears when it is covered. Keep it close.", 0.14, "dry", 585935, 15.0, 31.0, xf=1.5, ch="stereo", kbps=128)
loop("insects_contact_wide", "kitchen holes spiders", "Ants on contact mics, left and right unrelated, so it goes round the head on headphones. Thinner and higher than the other.", 0.14, "dry", 143291, 20.42, 36.0, xf=2.0, ch="stereo", kbps=112)
loop("roach_box", "kitchen", "A real box of cockroaches next to the microphone, hiss floor and all. A flat crawl with crunches in it.", 0.14, "dry", 380769, 19.5, 31.22, xf=1.0, ch="stereo", hp_hz=100, kbps=128)
loop("bugs_writhe", "kitchen spiders buried", "About two hundred beetles in a mesh bag, mic right up against them: a flat writhing wall, no events. When it is everywhere.", 0.12, "dry", 634746, 20.0, 38.0, xf=2.0, ch="stereo", kbps=112)
family("roach_hiss", 4, "kitchen", "A hissing cockroach, one dry burst of air, close. From the plate, from the wall.", 0.25, "reverb 0.05", 547898, 45.0, 62.0, kind="spans", threshold=-24.0, gap=0.05, shortest=0.2, longest=0.9, hp_hz=1500, pad=(0.01, 0.03), drop=(4,))


@shot("roach_scatter", "kitchen", "Hundreds scattering when the light comes on: a sudden rush of feet across the table in all directions, gone in two seconds. Fire it on the second stutter.", 0.6, "dry; already wide", kbps=128)
def _scatter(rng):
    a = rec(629445, 33.5, 41.5, "stereo")
    b = rec(634746, 25.0, 45.0, "stereo")
    c = rec(431535, 0.06, 5.8)
    n = int(2.6 * SR)
    t = np.arange(n) / SR
    env = np.minimum(1, t / 0.08) * np.exp(-t / 0.55)
    x = hp(a[..., :n], 400) / peak(a) * 0.8 + hp(b[..., :n], 300) / peak(b) * 0.9
    x = x * env
    tape = Tape(2.6, channels=2)
    tape.put(x)
    h = hp(c, 400) / peak(c)
    for _ in range(60):
        a0 = int(rng.uniform(0, len(h) - 1200))
        at = rng.exponential(0.5)
        if at < 2.2:
            tape.put(fade(h[a0 : a0 + 1200], 0.001, 0.005), at, rng.uniform(0.1, 0.5) * np.exp(-at / 0.8), rng.uniform(-1, 1))
    return fade(tape.x, 0.002, 0.3)


# ---------------------------------------------------------------- flies

loop("flies_room", "kitchen", "Blowflies filling a room, a dense steady drone of them. Under everything at the end of the kitchen.", 0.14, "dry", 324590, 1.5, 13.5, xf=1.2, ch="stereo", hp_hz=120, kbps=128)
loop("flies_passing", "kitchen", "Flies coming and going close to wide microphones: gaps and passes. At 47 when they land on the lens.", 0.18, "dry", 567732, 20.0, 40.0, xf=2.0, hp_hz=150, ch="stereo", kbps=112)
cut("fly_land_1", "kitchen", "A fly close by, buzzing, and it stops: it has landed.", 0.4, "dry", 451140, 8.2, 10.4, hp_hz=120, fades=(0.01, 0.02))
cut("fly_land_2", "kitchen", "Another fly coming close and stopping, longer.", 0.4, "dry", 451140, 19.3, 21.9, hp_hz=120, fades=(0.01, 0.02))
cut("fly_land_3", "kitchen", "A short close fly, and it stops.", 0.4, "dry", 451140, 27.4, 28.7, hp_hz=120, fades=(0.01, 0.02))

# ---------------------------------------------------------------- fridge


@bed("fridge_wrong", "kitchen home", "A broken fridge going slowly insane: a rising, dirty overtone cluster over the hum. For when the room has stopped being a kitchen.", 0.08, "dry")
def _fridge_bad(rng):
    return _hum_loop(216664, 110.0, 128.0, 2.0, hp_hz=60)


cut("fridge_stop", "kitchen", "The compressor giving up: the hum drops out with a shudder, and the room's silence comes in. At 38.", 0.3, "dry", 216664, 159.4, 166.0, hp_hz=40, fades=(0.2, 1.5))

# ---------------------------------------------------------------- the table

family("fork_plate", 5, "kitchen album shaft", "A fork or knife on an empty plate, close: a short metal stroke and a ring of the plate. The slowed moment of the shaft is one of these alone.", 0.35, "reverb 0.1; low-pass 3000 for far", 629528, 30.0, 125.0, kind="hits", hp_hz=120, before=0.003, after=0.8, min_gap=0.8)
family("fork_scrape", 4, "kitchen album", "A fork scraped on a plate in a particularly ugly way, with tones at 3 to 8 kHz. It hurts; use it once or twice in the piece.", 0.25, "dry", 653416, 15.0, 23.0, kind="spans", threshold=-18.0, gap=0.04, shortest=0.2, longest=1.4, hp_hz=150, pad=(0.005, 0.05), drop=(2, 3, 4))
family("fork_stab", 4, "kitchen album", "A fork going into food and touching the plate under it: small, wet, ordinary.", 0.35, "reverb 0.1", 463902, 0.0, 5.26, kind="hits", before=0.003, after=0.35, min_gap=0.3)
family("plate_set", 3, "kitchen album evening", "A ceramic plate set down on a table, firmly.", 0.35, "reverb 0.2", 382643, 0.0, 25.6, kind="hits", before=0.003, after=0.6, min_gap=0.8, drop=(1, 3))
family("plate_clink", 4, "kitchen album party", "Plates touching, a small ceramic clink with a rattle after it.", 0.35, "reverb 0.2", 382648, 0.0, 45.0, kind="hits", before=0.003, after=0.45, min_gap=0.5)
family("glass_set", 2, "kitchen album", "A glass set down on a table among plates.", 0.3, "reverb 0.2", 382647, 0.0, 34.0, kind="hits", before=0.003, after=0.45, min_gap=0.6)
family("wet_plip", 4, "kitchen holes flood", "A small wet plop, a thing climbing out of soup. Hair gel, very close.", 0.3, "dry", 593990, 0.0, 29.0, kind="hits", hp_hz=150, before=0.003, after=0.2, min_gap=0.4)
loop("rice_moving", "kitchen", "Something tiny and wet moving in a mass: a slow, soft squirming with small clicks. Clay handled close to a microphone, thinned out. When the rice moves.", 0.3, "dry", 696021, 0.3, 17.0, xf=1.5, hp_hz=500)
loop("meat_kneaded", "kitchen chase", "A piece of raw meat kneaded in the hand: wet, slow and unpleasant, with hiss around it. Far under the mix.", 0.2, "low-pass 5000", 177017, 10.0, 26.0, xf=2.0, hp_hz=150)


@bed("cutlery_far", "corridor evening", "A dinner going on somewhere else in the house: forks and plates, slow and irregular, no voices at all. Sits behind a wall with `lowpass` 900 and some reverb.", 0.16, "low-pass 900, reverb 0.4")
def _cutlery(rng):
    pieces = []
    for fid, a, b in [(382648, 0.0, 45.0), (382643, 0.0, 25.6), (463902, 0.0, 5.26), (420440, 0.0, 36.0), (629528, 30.0, 60.0), (574170, 0.0, 23.6)]:
        x = rec(fid, a, b)
        hits = find_hits(x, 8, before=0.003, after=0.5, min_gap=0.4)
        for i, j in hits:
            pieces.append(fade(x[i:j], 0.002, 0.15) / max(peak(x[i:j]), 1e-9))
    tape = Tape(24.0, wrap=True)
    at = 0.0
    while at < 23.5:
        # someone eats in small bursts, with long gaps
        burst = int(rng.integers(1, 5))
        for _ in range(burst):
            p = pieces[int(rng.integers(0, len(pieces)))]
            tape.put(p, at, rng.uniform(0.2, 0.8))
            at += rng.uniform(0.25, 0.9)
        at += rng.uniform(0.8, 3.8)
    return tape.x


@bed("forks_close", "album", "Forks and knives close, at the table, four people eating slowly without talking: clinks and scrapes, ordinary and unbearable. From 50 on.", 0.28, "dry", kbps=128)
def _forks(rng):
    pieces = []
    for fid, a, b in [(629528, 30.0, 125.0), (463902, 0.0, 5.26), (382648, 0.0, 45.0), (382647, 0.0, 34.0)]:
        x = hp(rec(fid, a, b), 120)
        for i, j in find_hits(x, 10, before=0.003, after=0.4, min_gap=0.4):
            pieces.append(fade(x[i:j], 0.002, 0.12) / max(peak(x[i:j]), 1e-9))
    tape = Tape(20.0, channels=2, wrap=True)
    for pan_ in (-0.7, -0.2, 0.25, 0.75):
        at = rng.uniform(0, 2)
        while at < 19.5:
            p = pieces[int(rng.integers(0, len(pieces)))]
            tape.put(p, at, rng.uniform(0.3, 0.9), pan_)
            at += rng.uniform(0.9, 3.6)
    return tape.x


family("fork_down", 2, "album kitchen", "A fork laid down on a plate, gently, and nothing after it. At 60: the mother's fork stops. Take everything else away with it.", 0.45, "reverb 0.2", 629528, 60.0, 125.0, kind="hits", hp_hz=120, before=0.003, after=0.9, min_gap=1.2, drop=(2,))


# ---------------------------------------------------------------- mouths

loop("chew_wet", "album", "Wet, sloppy open-mouthed eating with real chewing thuds under it. Close and dry. For anyone who has misophonia it is the worst thing here; keep it alone for a while.", 0.24, "dry", 382671, 18.02, 25.58, xf=0.2)
loop("chew_small", "album", "Chewing with the mouth open: small wet clicks with room between them, which is worse.", 0.24, "dry", 449248, 7.64, 26.0, xf=0.3)
loop("chew_soft", "album", "A man chewing noodles in a booth: softer, close-up, for another seat at the table.", 0.2, "dry", 204114, 36.32, 45.12, xf=0.3)
loop("lip_smack", "album", "Sharp lip smacks and wet pops, relentless: someone eating gum very loudly. Only for a moment.", 0.12, "dry", 547234, 8.18, 13.8, xf=0.2, level=-26.0)
family("mouth_wet", 5, "karabasan chase kitchen dentist", "Slimy mouth sounds, a slow wet smack. Something about to speak, or about to eat.", 0.3, "dry", 761405, 2.06, 15.42, kind="spans", threshold=-24.0, gap=0.04, shortest=0.08, longest=0.6, hp_hz=120, pad=(0.003, 0.03), drop=(4,))
family("mouth_click", 6, "karabasan holes birches", "A wet click of lips and tongue, close to a broadcast microphone. Tiny.", 0.5, "dry", 861352, 0.18, 9.92, kind="hits", hp_hz=100, before=0.004, after=0.08, min_gap=0.12)
loop("throat_crackle", "karabasan home", "Pops and crackles from a throat and a mouth, mucus, very quiet. Heard only when something is very close.", 0.45, "dry", 178083, 2.58, 15.48, xf=0.5, hp_hz=150)


# ---------------------------------------------------------------- the duct

family("duct_crawl", 6, "crawl", "A push along the duct: elbows and knees on thin metal, a hollow boom round you. One per push, a little different each time. Very dry and close.", 0.45, "dry until it opens", 660319, 0.2, 9.74, kind="hits", hp_hz=60, before=0.005, after=0.5, min_gap=0.4)


@bed("duct_air", "crawl", "Air in a ventilation shaft: a hollow steady tone and a breath of draught. All there is between pushes.", 0.12, "dry")
def _duct_air(rng):
    return _hum_loop(149486, 22.0, 42.0, 2.0, hp_hz=50)


family("sheet_metal_pop", 5, "crawl elevator", "A thin metal sheet flexing and popping back, with a falling, rubbery ring. The duct's roof giving under weight.", 0.4, "dry", 457542, 5.0, 35.0, kind="spans", threshold=-24.0, gap=0.04, shortest=0.2, longest=1.2, pad=(0.003, 0.08))
family("sheet_metal_womp", 5, "crawl", "A sheet of metal bowed by hand: a slow womp, rising and falling. Something heavy crawling on top of the duct, coming back.", 0.4, "dry", 547976, 6.0, 16.0, kind="hits", before=0.01, after=0.5, min_gap=0.35)
cut("duct_hit_low", "crawl", "A dull blow on the lower part of a heater vent, low and boxy.", 0.5, "dry", 336355, 0.0, 0.8, fades=(0.001, 0.1))
cut("duct_hit_high", "crawl", "A blow higher up on the same vent: brighter, with rattle in it.", 0.5, "dry", 336356, 0.0, 0.8, fades=(0.001, 0.1))
family("duct_thud", 4, "crawl chase", "A soft-handed blow on a metal pipe or a sign, a thud with a low resonance in it. Roof, dented from above.", 0.4, "dry", 455808, 0.0, 39.0, kind="hits", before=0.003, after=0.75, min_gap=0.9)
family("duct_scrape", 3, "crawl", "A hard scrape along a sheet of metal: shoulders against both walls where the duct narrows.", 0.35, "dry", 646698, 0.0, 4.5, kind="spans", threshold=-22.0, gap=0.06, shortest=0.2, longest=1.4, hp_hz=100, pad=(0.005, 0.05))
cut("duct_scrape_long", "crawl", "Metal scraped slowly for six seconds, for the moment you are stuck.", 0.3, "dry", 534853, 0.5, 6.5, hp_hz=100, fades=(0.1, 0.4))
cut("panel_buckle", "crawl", "A big metal panel buckling, a long resonant womp with a rattle. At 52. Under it the floor is starting to go.", 0.5, "dry", 342976, 7.6, 11.4, fades=(0.001, 1.0))
cut("metal_crash", "crawl elevator", "A sheet of metal dropped and crashing, big, with a long ringing fall. At 58, with reverb now that the duct is gone.", 0.7, "reverb 0.5", 587442, 0.0, 3.0, fades=(0.001, 0.6))
cut("metal_crash_2", "crawl", "Another sheet coming down after the first, wider and noisier.", 0.6, "reverb 0.5", 587442, 3.0, 5.0, fades=(0.001, 0.5))
cut("scrap_fall", "crawl elevator", "Scrap metal dropped in a heap: many pieces and their rattling down.", 0.6, "reverb 0.5", 587443, 4.6, 7.8, fades=(0.001, 0.6))


@bed("duct_wet_behind", "crawl", "Something wet, unhurried, coming along the tube behind you: slow wet cloth, dull and boxed in. From 40 on, always from behind.", 0.3, "dry", kbps=96)
def _duct_wet(rng):
    x = hp(rec(174634, 0.0, 18.0, "left"), 150)
    x = speed(x, 0.74)
    x = bell(lp(x, 2600), 480, 9.0, 0.5)
    return seam(x, 2.0)


# ---------------------------------------------------------------- the dentist


@bed("dental_room_tone", "dentist ward", "The room tone of a dental office with nobody talking: ventilation and a far machine. The left channel alone: the recording is out of phase with itself.", 0.3, "dry")
def _dent_room(rng):
    return seam(hp(rec(707378, 30.0, 50.0, "left"), 50), 2.0)


loop("drill_high", "dentist", "A dental turbine held steady, far too high and clean. Keep it low at first, while it is only near.", 0.12, "dry", 505663, 11.24, 18.5, xf=0.5, hp_hz=300)
loop("drill_low", "dentist", "A slow handpiece, 1.85 kHz with a wobbling pitch and a tinny buzz: the drill as it starts to bite. Starts low at 30.", 0.16, "dry", 707330, 0.34, 7.2, xf=0.4, hp_hz=200)


@bed("drill_bite", "dentist", "The drill in contact: a grinding Dremel under the turbine, with the tooth in it. The sound is the point; bring it up over the shake. Hold it for as long as you dare.", 0.2, "dry", kbps=112)
def _bite(rng):
    a = hp(rec(272171, 2.3, 11.12), 300)
    b = hp(rec(707330, 0.34, 7.2), 200)
    n = min(a.shape[0], b.shape[0] * 2)
    tape = Tape(n / SR)
    tape.put(a / peak(a), 0.0, 1.0)
    tape.put(np.tile(b, 2)[:n] / peak(b), 0.0, 0.45)
    return seam(tape.x, 0.5)


cut("drill_start", "dentist", "A real high-speed dental drill: the whine climbs to 3.9 kHz in half a second, holds, and falls away at the end. A commenter: it made him physically recoil.", 0.2, "dry", 728347, 0.4, 8.7, fades=(0.01, 0.2))
cut("drill_stabs", "dentist", "The turbine pumped in short stabs, each a falling whine: ten unbearable seconds.", 0.16, "dry", 505663, 21.0, 31.0, fades=(0.01, 0.1))
cut("drill_spool_down", "dentist", "The turbine letting go and running down. Then the room is very quiet.", 0.2, "dry", 728347, 7.0, 8.7, fades=(0.02, 0.15))
loop("suction_patient", "dentist", "From the chair: a saliva ejector and a scaler heard from the patient's own place, with the mouth around them.", 0.2, "dry", 484307, 120.0, 140.0, xf=2.0, hp_hz=70)
cut("suction_gulp", "dentist", "A dental suction pipe in liquid: a hollow tone with wet hiss, stepping as it gulps. Right by the ear.", 0.35, "dry", 707322, 0.56, 4.72, hp_hz=100, fades=(0.02, 0.1))
cut("suction_loud", "dentist", "The same pipe, loud, finding the liquid with a slurp.", 0.3, "dry", 707321, 3.7, 6.86, hp_hz=100, fades=(0.01, 0.1))
cut("suction_air", "dentist", "The pipe with only air in it: a thin hiss before it finds anything.", 0.25, "dry", 707321, 0.84, 3.6, hp_hz=100, fades=(0.05, 0.05))
cut("gloves_on", "dentist ward", "Latex gloves going on, slowly, and rubber worked afterwards: thirteen seconds of someone about to begin.", 0.4, "dry", 631970, 15.82, 29.1, hp_hz=100, fades=(0.05, 0.3))
cut("glove_snap", "dentist ward", "One latex glove snapped at the wrist.", 0.4, "dry", 637585, 0.68, 1.42, fades=(0.002, 0.05))
family("tray_metal", 5, "dentist ward", "An instrument put down on a steel tray: a light hard clink with a ring.", 0.35, "reverb 0.1", 759531, 8.0, 30.0, kind="hits", hp_hz=200, before=0.002, after=0.32, min_gap=0.25, drop=(5,))
family("needle_set", 3, "dentist ward", "A needle laid on a desk: a tiny click with a small metal ring.", 0.4, "dry", 496453, 0.0, 24.8, kind="hits", before=0.002, after=0.12, min_gap=0.5, drop=(2, 3))
cut("syringe_flick", "dentist ward", "Fingers flicking a glass barrel to clear the bubbles: a dozen hard ticks. Before it comes down.", 0.3, "dry", 465495, 18.1, 25.84, hp_hz=150, fades=(0.002, 0.03))
family("syringe_tick", 3, "dentist ward", "One flick of a glass syringe.", 0.3, "dry", 465495, 18.1, 25.84, kind="hits", hp_hz=150, before=0.002, after=0.08, min_gap=0.15, drop=(3,))
family("tooth_tap", 3, "dentist", "Tweezers tapping real teeth: metal on enamel, small, from inside the skull.", 0.6, "dry", 155913, 2.08, 11.94, kind="hits", hp_hz=200, before=0.002, after=0.07, min_gap=0.25)
cut("tray_slide", "dentist ward", "A steel instrument tray swung in on its arm: a short metal scrape. At 15.", 0.3, "dry", 534853, 0.3, 1.7, hp_hz=120, fades=(0.02, 0.2))
cut("chair_motor", "dentist", "A real dentist's chair rising slowly: a steady electric motor with a creak at each end. Before anything has happened.", 0.3, "dry", 707320, 0.1, 7.9, fades=(0.02, 0.1))
family("bone_crack", 4, "dentist buried", "A hard crack (celery snapped): the forceps' moment. Under `tooth_pull`, or by itself.", 0.5, "dry", 574752, 0.0, 8.27, kind="hits", hp_hz=60, before=0.002, after=0.22, min_gap=0.4, drop=(1, 3, 4))


@shot("tooth_pull", "dentist", "The long pull: wood under slowly growing stress, dull and inside the head, ending in a crack. Eight seconds. For 48 to 56.", 0.55, "dry")
def _pull(rng):
    a = rec(218163, 8.2, 11.02)
    b = rec(218163, 3.76, 6.62)
    x = lp(speed(chain(a, b, a), 0.8), 1500)
    x = x / peak(x)
    n = x.shape[-1]
    t = np.arange(n) / n
    x = x * (0.25 + 0.75 * t**1.5)
    s = hp(rec(574752, 0.3, 0.9), 60)
    s = s / peak(s)
    return chain(fade(x[: int(8.0 * SR)], 0.2, 0.02), fade(s, 0.001, 0.05))


@bed("hair_pull_wet", "dentist", "Long wet hair being drawn out, hand over hand, it does not end: a slow hiss of strands and a small wet click at each pull, about one a second. From 52.", 0.35, "dry", kbps=96)
def _hair_wet(rng):
    strands = hp(rec(443037, 5.26, 10.4), 300)
    pull = hp(rec(409201, 1.96, 4.02), 200)
    wet = hp(rec(761405, 2.06, 15.42), 150)
    hits = find_hits(wet, 8, before=0.003, after=0.12, min_gap=0.3)
    tape = Tape(9.6, wrap=True)
    at = 0.0
    k = 0
    while at < 9.4:
        i = int(rng.integers(0, strands.shape[0] - int(1.0 * SR)))
        tape.put(fade(strands[i : i + int(1.0 * SR)], 0.15, 0.3) / peak(strands), at, 0.8)
        j = int(rng.integers(0, pull.shape[0] - int(0.5 * SR)))
        tape.put(fade(pull[j : j + int(0.5 * SR)], 0.01, 0.1) / peak(pull), at + 0.1, 0.5)
        a, b = hits[k % len(hits)]
        tape.put(fade(wet[a:b], 0.002, 0.03) / peak(wet[a:b]), at + 0.02, 0.35)
        at += rng.uniform(1.05, 1.35)
        k += 1
    return tape.x


family("hair_pull", 3, "dentist karabasan", "Dry hair given a sharp tug.", 0.4, "dry", 409201, 0.0, 4.02, kind="spans", threshold=-30.0, gap=0.03, shortest=0.05, longest=0.6, pad=(0.003, 0.03), drop=(3,))
loop("hair_fingers", "karabasan spiders buried album", "Fingers combing slowly through hair, lightly over the scalp. Long and calm, close: hair on your face.", 0.45, "dry", 790896, 11.66, 28.0, xf=1.5, hp_hz=150)
cut("hair_binaural", "karabasan spiders", "Head scratching on ear microphones, in stereo. On headphones it is your own scalp.", 0.8, "dry", 706804, 9.22, 12.76, ch="stereo", hp_hz=100, fades=(0.05, 0.1), kbps=128)
cut("spray_hiss", "dentist", "An air syringe let go: a sudden hiss that swells and dies, four seconds. The water spray on the lens.", 0.2, "dry", 327534, 0.98, 5.0, hp_hz=600, fades=(0.005, 0.5))


@shot("numb_jolt", "dentist", "The jolt when the picture goes numb, made for this piece: one low dull blow and a thin ringing that fades over six seconds.", 0.5, "dry")
def _numb(rng):
    n = int(6.5 * SR)
    t = np.arange(n) / SR
    blow = np.sin(TAU * np.cumsum(38 + 60 * np.exp(-t / 0.05)) / SR) * np.exp(-t / 0.3)
    ring = (np.sin(TAU * 3920 * t) + 0.6 * np.sin(TAU * 3931 * t) + 0.3 * np.sin(TAU * 5610 * t)) * np.exp(-t / 2.0) * np.minimum(1, t / 0.5) * 0.03
    return fade(blow + ring, 0.001, 1.5)


# ---------------------------------------------------------------- the mirror


@bed("bathroom_tone", "mirror", "A small quiet bathroom at night: air, tile and a far pipe, close to nothing.", 0.2, "dry")
def _bath(rng):
    return seam(hp(rec(338102, 2.0, 22.0), 40), 2.0)


family("tile_drip", 5, "mirror stairs", "One drop from a tap into water in a basin, close. Every few seconds; the same drop twice is fine, it is a tap.", 0.3, "reverb 0.25", 381650, 0.0, 120.0, kind="hits", hp_hz=150, before=0.003, after=0.3, min_gap=1.5)
family("tooth_tink", 4, "mirror teeth", "A hard small thing falling on glazed ceramic: tink. A quartz crystal on a plate, and its bounce. A tooth in the basin: pan them a little and vary `rate`.", 0.4, "reverb 0.15", 800114, 0.0, 4.0, kind="hits", ch="mid", before=0.001, after=0.1, min_gap=0.12, peak_db=-3.0)
cut("tooth_tink_5", "mirror teeth", "A very short hard ceramic click.", 0.4, "reverb 0.15", 371278, 0.0, 0.1, fades=(0.0005, 0.01))
cut("tooth_tink_6", "mirror teeth", "A small high clink, glass-like.", 0.35, "reverb 0.15", 536780, 0.0, 0.3, fades=(0.001, 0.03))
cut("tooth_tink_big", "mirror", "A bigger hard tink on ceramic with a ring: the first tooth, when it counts.", 0.4, "reverb 0.15", 209014, 0.18, 0.9, fades=(0.001, 0.08))
cut("tooth_clink", "mirror party", "A small clink on a saucer, a little lower.", 0.4, "reverb 0.15", 568758, 0.12, 0.62, fades=(0.001, 0.05))


@shot("tooth_roll", "mirror", "A tooth rolling round a white basin, slowing and settling: a coin on porcelain, slowed down to bring it to size.", 0.4, "reverb 0.15")
def _roll(rng):
    x = rec(119831, 0.2, 1.25)
    x = speed(hp(x, 1500), 0.55)
    return fade(x, 0.001, 0.25)


cut("teeth_scatter", "mirror teeth", "A handful of small stones shaken once and rolled: many teeth at once.", 0.35, "reverb 0.15", 398694, 0.0, 1.0, fades=(0.005, 0.08))
family("glass_creak", 4, "mirror", "Glass scratched against glass: a long thin eerie creak. The mirror taking pressure.", 0.22, "reverb 0.15", 174754, 0.0, 18.0, kind="spans", threshold=-24.0, gap=0.05, shortest=0.3, longest=1.8, hp_hz=800, pad=(0.01, 0.06))
family("palm_on_glass", 4, "mirror", "A hand touching and squeaking on a mirror, right there in front of you. At 46.", 0.3, "dry", 569257, 0.0, 34.0, kind="spans", threshold=-22.0, gap=0.06, shortest=0.1, longest=1.0, hp_hz=300, pad=(0.005, 0.03), drop=(2, 3, 4))
cut("palm_squeak_long", "mirror", "A palm dragged down a window: one long high squeak, three seconds.", 0.2, "dry", 148952, 0.2, 3.1, fades=(0.02, 0.1))
family("glass_crack", 3, "mirror", "Thin glass under stress: one sharp crack and a splinter of smaller ones. Ice, really, which is why it does not sound like a stage effect.", 0.45, "reverb 0.15", 342546, 0.0, 7.6, kind="hits", hp_hz=300, before=0.002, after=0.5, min_gap=0.8, drop=(2, 3))
cut("glass_crack_long", "mirror", "A slow crack running: small ticks that join up over five seconds.", 0.35, "reverb 0.15", 268862, 40.0, 45.0, hp_hz=500, fades=(0.1, 0.2))
loop("drain_gurgle", "mirror pool", "Something moving far down in the drain, a quiet and irregular slosh of old pipes. Barely.", 0.14, "low-pass 1500", 394596, 40.0, 56.0, xf=2.0, hp_hz=120)

# ---------------------------------------------------------------- the lift


@bed("lift_motor", "elevator", "An old lift's motor from inside the car: a low steady hum, with ticks of the shaft going by. Going down.", 0.2, "dry")
def _lift_motor(rng):
    return _hum_loop(365642, 1.0, 14.0, 1.5, hp_hz=40)


@bed("lift_ride_old", "elevator", "A creepy old lift riding: hum, with thin metal squeaks high above it. Twenty-five seconds without repeating. Under the first half.", 0.18, "dry")
def _lift_old(rng):
    return seam(hp(rec(218928, 2.0, 27.0), 40), 1.5)


@bed("lift_machine_room", "elevator", "Between two lift motors of a medical centre, by the relays that drive them: a hard motor drone and a click now and then. Heard through the ceiling. Stereo, from ear microphones.", 0.1, "low-pass 1200 through the roof", kbps=128)
def _lift_room(rng):
    return seam(hp(rec(331516, 11.0, 29.0, "stereo"), 40), 2.0)


cut("lift_doors_close", "elevator", "Old lift doors grinding shut, ending in a dull thud. At 2.", 0.5, "reverb 0.1", 272435, 0.1, 4.8, hp_hz=60, fades=(0.05, 0.3))
cut("lift_doors_open", "elevator", "Old lift doors grinding open. At 50.", 0.5, "reverb 0.1", 272438, 0.4, 3.9, hp_hz=60, fades=(0.05, 0.2))
cut("lift_ding", "elevator waitingroom", "A worn lift chime, two notes, tape-tired. One each time the indicator shows a floor if you want; it should get on your nerves.", 0.25, "dry", 737948, 0.0, 3.3, fades=(0.001, 0.4))
cut("lift_bell_dead", "elevator", "A very old lift's dead bell, a bent dull clank of a thing that used to ring. From a hospital in Tallinn. For the stop between floors.", 0.4, "dry", 209973, 14.9, 17.5, hp_hz=120, fades=(0.002, 0.3))
cut("lift_jolt", "elevator", "The jolt when it stops: a heavy metal chunk dropped, big and low, and everything in the car rattling after it. At 24.", 0.7, "dry", 859154, 0.0, 2.2, fades=(0.001, 0.5))
loop("intercom_static", "elevator", "A broken intercom: static with small crackles, thin as a telephone. Under the typed line from 34.", 0.14, "dry", 264995, 40.0, 52.0, xf=1.0, hp_hz=300, lp_hz=5000)
family("intercom_crackle", 4, "elevator home", "A burst of bad contact on an old intercom.", 0.25, "dry", 264995, 5.0, 30.0, kind="hits", hp_hz=300, lp_hz=5000, before=0.003, after=0.7, min_gap=0.8, drop=(2, 4))
cut("intercom_on", "elevator", "An intercom opening: its button, a surge of noise.", 0.3, "dry", 264995, 2.0, 4.0, hp_hz=200, lp_hz=5000, fades=(0.005, 0.3))
cut("intercom_off", "elevator", "The line closing, a short squelch.", 0.3, "dry", 524205, 0.0, 0.7, fades=(0.002, 0.05))
family("cable_twang", 3, "elevator beam", "A long steel thing let go and vibrating: a table knife twanged on a desk, slowed down.", 0.35, "reverb 0.3", 44192, 0.0, 26.0, kind="spans", threshold=-16.0, gap=0.05, shortest=0.5, longest=2.0, ch="left", rate=0.6, pad=(0.002, 0.2), drop=(3,))


@bed("cable_hum", "elevator beam", "A steel cable under load, from a contact mic on the stay of a small boat: a dark throb in the steel, no sky. Under the car.", 0.2, "dry")
def _cable_hum(rng):
    return seam(lp(hp(rec(100401, 3.0, 21.0), 45), 900), 2.0)


@shot("cable_snap", "elevator", "The cable going: a metal twang with a crack made for this piece on top, one lash, the whip of it dying upward. At 54. Then the wind.", 0.7, "reverb 0.3")
def _snap(rng):
    n = int(3.5 * SR)
    t = np.arange(n) / SR
    crack = hp(rng.standard_normal(n), 1400) * np.exp(-t / 0.006) * 2.0
    body = np.sin(TAU * np.cumsum(90 + 900 * np.exp(-t / 0.05)) / SR) * np.exp(-t / 0.22) * 0.8
    x = rec(44192, 0.0, 26.0, "left")
    i, j = find_spans(x, 1, threshold=-16.0, gap=0.05, shortest=0.5, longest=2.0, pad=(0.002, 0.2))[0]
    tw = speed(x[i:j], 0.5)
    tw = tw / peak(tw)
    tape = Tape(3.5)
    tape.put(crack + body)
    tape.put(fade(tw, 0.001, 0.8), 0.01, 0.7)
    return fade(tape.x, 0.0005, 0.6)


loop("draft_drone", "corridor crawl karabasan", "A draught pumping through a crevice in an apartment house's hall: a low, slowly pulsing note. Barely a sound; very good under a corridor.", 0.14, "dry", 459146, 10.0, 30.0, xf=2.5)


# ---------------------------------------------------------------- the darkroom


@bed("tray_water", "evening", "A shallow tray of developer being rocked by hand: soft slow slops of a little water, close. The darkroom of the evenings.", 0.14, "reverb 0.3")
def _tray(rng):
    x = hp(rec(388014, 14.0, 21.0), 150)
    x = lp(speed(x, 0.8), 4500)
    return seam(x, 0.8)


@shot("darkroom_drip", "evening", "A few slow drips in the dark, ten seconds of them, uneven. Plays once at the start of the evening.", 0.3, "reverb 0.6")
def _drip_room(rng):
    x = hp(rec(381650, 0.0, 120.0), 150)
    hits = find_hits(x, 6, before=0.003, after=0.3, min_gap=1.5)
    tape = Tape(10.0)
    for (i, j), at, g in zip(hits, (0.2, 2.7, 3.9, 6.8, 8.5), (1.0, 0.7, 0.5, 0.85, 0.6)):
        tape.put(fade(x[i:j], 0.002, 0.1) / peak(x[i:j]), at, g)
    return tape.x


# ---------------------------------------------------------------- the flood

loop("flooded_cellar", "flood corridor", "A flooded basement in the burnt ruin of a house: water falling from the ceiling onto water everywhere, close and dense. The house, filling.", 0.1, "dry", 394596, 40.0, 60.0, xf=2.0, hp_hz=120, ch="stereo", kbps=112)
loop("water_slop_wood", "flood", "Below deck on an old wooden ship: water slopping against timber, and the timbers creaking with it. Water against the stairs.", 0.2, "dry", 450255, 0.36, 12.32, xf=1.0, ch="stereo", kbps=112)
family("wade_step", 5, "flood", "A foot going into shallow water and out of it.", 0.4, "reverb 0.15", 342932, 0.0, 18.0, kind="spans", threshold=-24.0, gap=0.08, shortest=0.25, longest=1.0, hp_hz=120, pad=(0.01, 0.08))
loop("wade_slow", "flood", "A body walking slowly through deep water, rich low swells and no splashes. From 14, rising.", 0.3, "dry", 627004, 0.3, 8.0, xf=0.8, ch="stereo", kbps=112)


@shot("surface_close", "flood", "The surface closing overhead: a splash heard from just below with a blow made for this piece under it, a dull heavy gulp and a burst of bubbles. At 34, in one cut with the filter on everything else.", 0.6, "dry")
def _surface(rng):
    a = lp(rec(398032, 0.0, 1.3), 900)
    b = lp(rec(554071, 0.2, 3.0), 2200)
    n = int(0.35 * SR)
    s = np.arange(n) / SR
    thump = np.sin(TAU * np.cumsum(30 + 90 * np.exp(-s / 0.03)) / SR) * np.exp(-s / 0.1)
    tape = Tape(3.2)
    tape.put(a / peak(a), 0.0, 0.8)
    tape.put(thump, 0.0, 0.7)
    tape.put(fade(b, 0.05, 0.8) / peak(b), 0.15, 0.6)
    return fade(tape.x, 0.0005, 0.5)


# ---------------------------------------------------------------- under water


loop("underwater_muffled", "flood deep", "The classic: a recording from under water crushed under a 1.5 kHz wall, hot and pressing on the ears. It instantly reads as submerged.", 0.14, "dry", 366159, 20.0, 44.0, xf=3.0, ch="stereo", kbps=112)
loop("underwater_weight", "deep", "A contact mic under a rail bridge in a lake: a real weight above you, with slow changes and rare ticks.", 0.16, "dry", 197751, 14.72, 36.0, xf=3.0)
loop("underwater_pool", "deep pool", "A hydrophone in an empty metal swimming pool: a pipe note and a far ring, nobody in it. The strangest of the waters.", 0.25, "dry", 706430, 0.0, 24.0, xf=3.0, hp_hz=40)
cut("bubbles_exhale_1", "deep flood", "A person breathing out under water in a basin: a long bubbling stream. Your own bubbles.", 0.35, "low-pass 2600", 554071, 0.12, 6.88, fades=(0.02, 0.4))
cut("bubbles_exhale_2", "deep flood", "Another long bubbling breath out.", 0.35, "low-pass 2600", 554071, 7.9, 12.66, fades=(0.02, 0.4))
cut("bubbles_burst", "deep", "A burst of air let go at once: the moment the breath is released.", 0.4, "low-pass 3000", 577880, 0.5, 3.5, fades=(0.005, 0.5))
loop("bubbles_rising", "deep flood", "Thin streams of bubbles close to a hydrophone, in stereo, always rising.", 0.14, "low-pass 3500", 192351, 2.0, 18.0, xf=1.5, ch="stereo", kbps=112)
family("bubble_small", 3, "flood deep pool", "A few bubbles and a plop.", 0.3, "dry", 529383, 0.0, 39.0, kind="spans", threshold=-14.0, gap=0.04, shortest=0.15, longest=0.8, pad=(0.005, 0.03), drop=(3,))
family("groan_ship", 3, "deep", "A cruise liner's gangplank rubbing on the quay, slowed by half: an enormous groan with real harmonics. Through everything at 48.", 0.5, "low-pass 1500, reverb 0.4", 500008, 0.0, 60.0, kind="spans", threshold=-8.0, gap=0.3, shortest=2.0, longest=6.0, rate=0.5, hp_hz=40, pad=(0.02, 0.2), fades=(0.2, 0.8), drop=(3,))
cut("groan_steel", "deep beam", "A ship groaning in a harbour, slowed: a high, squealing steel note going down.", 0.3, "low-pass 2000, reverb 0.4", 73257, 14.32, 18.84, rate=0.6, fades=(0.2, 0.6))
cut("groan_whale_1", "deep", "A voice made into a whale: a long wavering moan in open space, wide in stereo, with silence around it. Nobody could say what it is.", 0.4, "reverb 0.5", 361423, 18.46, 23.78, ch="stereo", hp_hz=40, fades=(0.1, 0.6), kbps=128)
cut("groan_whale_2", "deep", "A second call of the same thing, a little higher.", 0.4, "reverb 0.5", 361423, 25.88, 30.52, ch="stereo", hp_hz=40, fades=(0.1, 0.6), kbps=128)
cut("groan_low", "deep", "One huge low note: a moan slowed until it has no voice left. Felt in the chest.", 0.5, "reverb 0.4", 171945, 10.0, 15.84, hp_hz=40, fades=(0.2, 0.8))
cut("hull_bottom", "deep elevator", "A submarine touching the bottom of the sea: something slow, heavy and metal settling, with creaks and stress. For when the face is lit.", 0.5, "dry", 514306, 2.5, 12.1, hp_hz=30, fades=(0.2, 1.2))
family("hull_creak", 3, "deep", "A steel hull under pressure, a low creak that comes in pulses.", 0.3, "dry", 232021, 0.0, 44.0, kind="spans", threshold=-16.0, gap=0.1, shortest=1.5, longest=4.0, hp_hz=70, pad=(0.05, 0.2), fades=(0.1, 0.4), drop=(3,))


@shot("current_rush", "deep", "A slow rush of water taking you, made from moving air under a heavy filter: swelling for eight seconds. At 66.", 0.5, "dry", kbps=112)
def _current(rng):
    a = lp(rec(20108, 0.0, 12.0, "stereo"), 500)
    x = hp(a, 30)
    n = x.shape[-1]
    t = np.arange(n) / n
    return fade(x * (0.05 + 0.95 * t**2), 0.5, 0.8)


@shot("flash_underwater", "deep", "The flash firing under water: an old flash pop under a heavy filter, one dull thud and a hiss of light.", 0.6, "reverb 0.4")
def _flash_uw(rng):
    x = lp(rec(232130, 0.54, 1.68), 1200)
    return fade(x, 0.001, 0.2)


# ---------------------------------------------------------------- the pool


def _tiled(x, t60=5.5, wet=0.6):
    """A big tiled room: hard early reflections and a long bright tail."""
    return room_verb(x, t60=t60, wet=wet, dark=7000.0, pre=0.02, seed=5, early=((0.031, 0.8), (0.047, 0.6), (0.083, 0.5), (0.129, 0.42), (0.19, 0.3), (0.27, 0.25)))


@shot("pool_drip_1", "pool album", "One drop in a huge tiled room: a small sharp drop and six seconds of tile after it, already baked in.", 0.45, "already wet")
def _pool1(rng):
    x = rec(174718, 0.0, 0.5)
    return fade(_tiled(fade(hp(x, 300), 0.001, 0.05)), 0.0, 1.5)


@shot("pool_drip_2", "pool", "Another drop, lower, in the same huge tiled room.", 0.45, "already wet")
def _pool2(rng):
    x = hp(rec(381650, 0.0, 120.0), 150)
    i, j = find_hits(x, 3, before=0.003, after=0.25, min_gap=1.5)[2]
    return fade(_tiled(speed(fade(x[i:j], 0.001, 0.05), 0.8), t60=5.0), 0.0, 1.5)


@shot("tap_start", "pool mirror", "A tap being turned, a far pipe knocking and the water coming, in a huge tiled room. At 8.", 0.3, "already wet")
def _tap(rng):
    x = hp(rec(104016, 0.0, 6.0), 150)
    return fade(_tiled(fade(x, 0.01, 0.8), t60=4.0, wet=0.55), 0.0, 1.5)


loop("water_trickle", "pool flood", "A thin trickle of water on stone, with nothing else: a line of water finding its way down a slope.", 0.2, "reverb 0.4", 363120, 2.0, 16.0, xf=2.0, hp_hz=200)


# ---------------------------------------------------------------- the ward


loop("ventilator", "ward", "A real ventilator: two valve clicks every 3.66 s over a mechanical bed. Eight exact cycles. It is keeping someone alive in the next bed.", 0.18, "reverb 0.15", 703025, 3.0, 32.27, xf=0.02)
loop("machine_breathing", "ward dentist", "A machine sucking and expelling air, strokes of about 1.4 s, each with its own tone. Wrong and clear.", 0.1, "reverb 0.2", 152613, 1.96, 13.0, xf=0.5, hp_hz=50, lp_hz=13000)
loop("gas_hiss", "ward", "A small pipe hissing like propane, steady, with faint tones in it. It reads as gas, not air. Very low.", 0.08, "dry", 453443, 0.5, 14.0, xf=2.0)


def _squeaks():
    x = rec(577320, 0.0, 6.5)
    return x, find_spans(x, 6, threshold=-12.0, gap=0.03, shortest=0.08, longest=0.5, pad=(0.003, 0.03))


@bed("gurney_wheel", "ward", "One bad wheel on a gurney: a squeak on every turn, about one a second, not quite even. Add `gurney_rumble` under it. Raise `rate` to go faster.", 0.14, "reverb 0.25")
def _wheel(rng):
    x, spans_ = _squeaks()
    tape = Tape(11.2, wrap=True)
    at = 0.0
    k = 0
    while at < 10.9:
        i, j = spans_[k % len(spans_)]
        tape.put(fade(x[i:j], 0.003, 0.03) / peak(x[i:j]), at + rng.uniform(-0.02, 0.02), rng.uniform(0.55, 1.0))
        at += 0.933
        k += 1
    return tape.x + noise_loop(tape.n, lambda f: pink_gain(f, 100) / np.sqrt(1 + (f / 2000) ** 2), rng) * 0.0008


loop("gurney_rumble", "ward", "A real gurney pushed down a hallway: soft rubber wheels, a rattle of its frame.", 0.2, "reverb 0.2", 371019, 0.3, 7.4, xf=0.8, hp_hz=40, kbps=96)
cut("gurney_stop", "ward", "Wheels stopped: the frame settling with a dull knock.", 0.35, "reverb 0.2", 371019, 5.3, 6.2, hp_hz=40, fades=(0.02, 0.2))
cut("belt_slither_1", "ward home chase", "A hand sliding along a leather belt, slowed: dry, scaled, with small catches. A thick body going by; hair through a tube.", 0.35, "dry", 344654, 4.52, 5.32, rate=0.75, fades=(0.005, 0.03))
cut("belt_slither_2", "ward home chase", "A shorter slide of the same.", 0.35, "dry", 344654, 0.7, 1.05, rate=0.75, fades=(0.005, 0.03))
cut("belt_slither_3", "ward home chase", "Another short slide.", 0.35, "dry", 344654, 1.55, 1.85, rate=0.75, fades=(0.005, 0.03))
cut("tube_fill", "ward", "Liquid moving in a thin tube: quiet water drawn up.", 0.5, "dry", 465495, 0.9, 1.9, hp_hz=300, lp_hz=6000, rate=0.7, fades=(0.05, 0.1))
cut("needle_skin", "ward dentist", "Nothing but a small dull click and a stretch of silence: skin giving. Very low; do not make more of it.", 0.3, "dry", 496453, 1.36, 1.48, rate=0.5, lp_hz=3000, fades=(0.001, 0.02))

# ---------------------------------------------------------------- the flash


cut("flash_charge", "darkness", "A real flash's capacitor whine climbing from 2 to about 4 kHz, 2.6 s, then ready. One per shot; nothing can fire before it ends.", 0.14, "dry", 148267, 1.26, 3.86, hp_hz=800, fades=(0.02, 0.03))
cut("flash_charge_long", "darkness shaft", "The same whine, all five seconds of it up to 7 kHz. It can be the sound of the photographer waiting.", 0.1, "dry", 148267, 1.26, 6.42, hp_hz=800, fades=(0.02, 0.1))
family("flash_pop", 3, "darkness deep beam", "A flash firing: one flat hard pop and a small ring. The silence after it stays.", 0.6, "dry", 148267, 0.0, 30.3, kind="hits", before=0.002, after=0.45, min_gap=3.0)
cut("flash_powder", "darkness exam album", "Old flash powder going off with a shutter, a 1920s press camera: a soft boom instead of a click. From behind you, at 76.", 0.6, "reverb 0.3", 232130, 0.54, 1.68, fades=(0.001, 0.1))
cut("camera_click_empty", "darkness", "The camera with nothing left: its small dry click. After the eighth, every press.", 0.4, "dry", 676375, 0.95, 1.3, hp_hz=300, fades=(0.001, 0.03))
cut("polaroid_motor", "darkness album", "An instant camera's shutter and motor pushing a print out.", 0.35, "dry", 151799, 0.48, 3.02, fades=(0.002, 0.1))


# ---------------------------------------------------------------- room tones

loop("bedroom_tone", "spiders karabasan", "A bedroom at night, nothing happening, a faint electric presence. Almost silence, which is a very different thing from silence.", 0.25, "dry", 329569, 2.0, 22.0, xf=2.0, hp_hz=40, ch="mid")
loop("house_tone", "home darkness", "An empty house: low air, a far appliance. A room you could be in. The room of the telephone.", 0.28, "dry", 641306, 14.0, 34.0, xf=2.0, hp_hz=35)
loop("waiting_room_tone", "waitingroom corridor funeral ward album", "A big hall with heavy ventilation, no one speaking. Lay it very low under the tube's hum: it gives the room its size.", 0.12, "dry", 509477, 3.0, 21.0, xf=2.0, hp_hz=40)
loop("theatre_tone", "exam funeral", "A large theatre, empty, with a low steady hum in it. The far end of the room is a long way away.", 0.22, "dry", 144042, 2.0, 22.0, xf=2.5, hp_hz=35)
loop("hall_silence", "exam album funeral", "The silence of a real concert hall: air, tiny creaks and a shoe somewhere. The sound of hundreds of people holding still.", 0.5, "dry", 588400, 29.0, 53.0, xf=2.0, hp_hz=40)
loop("museum_tone", "holes", "A quiet gallery in a small museum: air conditioning and nothing. Museum near-silence.", 0.14, "dry", 639332, 1.0, 19.0, xf=2.0, hp_hz=50)
loop("pool_room_tone", "pool", "A big flooded quarry tunnel: low air with slow water drops and long stone tails. The drops are far apart; the room is huge.", 0.3, "dry", 476318, 1.0, 25.0, xf=2.5, hp_hz=60, ch="stereo", kbps=112)

cut("window_slide", "waitingroom", "A frosted glass window sliding open behind a counter: a long smooth rumble on its runners. At 50, far off.", 0.45, "reverb 0.4", 378866, 0.65, 2.6, hp_hz=80, fades=(0.05, 0.15))
cut("hatch_heavy", "waitingroom elevator crawl", "An old heavy hatch being opened, with long machinery in it.", 0.35, "reverb 0.3", 672069, 0.1, 4.2, hp_hz=50, fades=(0.02, 0.4))

# ---------------------------------------------------------------- outdoors at night

loop("forest_night", "birches", "A forest at night in winter or close to it: near silence with a far low wind. No insects, no birds. Keep it just audible.", 0.3, "dry", 435469, 0.5, 21.5, xf=2.0, hp_hz=70, ch="mid")


@bed("wind_grass", "beds washing", "Wind going through dry grass over a wide plain: low rushes, a high thin rustle on top, slowly in and out. Stereo; the meadow.", 0.2, "dry", kbps=128)
def _grass(rng):
    a = rec(146436, 30.0, 52.0, "stereo")
    b = hp(rec(240914, 30.0, 52.0, "stereo"), 800)
    n = min(a.shape[-1], b.shape[-1])
    x = hp(a[..., :n], 50) / peak(a) + b[..., :n] / peak(b) * 0.25
    return seam(x, 2.5)


loop("night_wind_far", "busstop washing birches teeth beds", "Strong wind at night, far off and low, across a field. As an open place under anything outdoors. It has a few far crickets in it if you listen.", 0.14, "dry; low-pass 1200 to take the crickets out", 217884, 60.0, 84.0, xf=3.0, hp_hz=40, ch="stereo", kbps=112)
loop("road_fog", "busstop", "A street in the far distance on a quiet evening: an almost-sound of a city, no traffic you can name. Fog.", 0.25, "low-pass 1500", 444660, 5.0, 25.0, xf=2.5, hp_hz=40)
family("twig_snap", 2, "birches", "One dry twig giving, a long way off between the trees.", 0.25, "reverb 0.6, low-pass 4000", 367826, 0.0, 19.0, kind="hits", hp_hz=200, before=0.002, after=0.2, min_gap=1.0)

# ---------------------------------------------------------------- eyes


def _blink_parts():
    x = hp(rec(761405, 2.06, 15.42), 200)
    return x, find_spans(x, 8, threshold=-24.0, gap=0.04, shortest=0.08, longest=0.4, pad=(0.002, 0.03))


@shot("eye_blink", "birches", "One wet blink: a small slick of a lid on an eye, tiny, close. Made from a wet mouth sound. Alone it is nothing; fire it when the eye closes on the lens.", 0.5, "dry")
def _blink(rng):
    x, spans_ = _blink_parts()
    i, j = spans_[1]
    return fade(speed(x[i:j], 1.25), 0.002, 0.02)


@shot("eye_blink_many", "birches", "Every eye in the forest closing at once: one wet blink many thousand times over, inside half a second, round the whole head. At 14.5, with the light. Then silence.", 0.5, "already wide", kbps=128)
def _blinks(rng):
    x, spans_ = _blink_parts()
    pieces = [speed(fade(x[i:j], 0.002, 0.02), rng.uniform(1.0, 1.6)) for i, j in spans_]
    tape = Tape(1.3, channels=2)
    for _ in range(900):
        p = pieces[int(rng.integers(0, len(pieces)))]
        at = abs(rng.normal(0.28, 0.08))
        tape.put(p / peak(p), at, rng.uniform(0.02, 0.1), rng.uniform(-1, 1))
    n = int(1.3 * SR)
    t = np.arange(n) / SR
    tape.put(np.sin(TAU * 52 * t) * np.exp(-((t - 0.3) ** 2) / 0.006), 0.0, 0.2)
    return fade(tape.x, 0.001, 0.15)


@shot("eye_turn", "birches holes deep", "Something wet and small turning in its socket: a slow squelch. Very low: many eyes keeping you in view.", 0.4, "dry")
def _eye_turn(rng):
    x, spans_ = _blink_parts()
    i, j = spans_[3]
    return fade(speed(x[i:j], 0.5), 0.02, 0.06)

# ---------------------------------------------------------------- the bed in the meadow, the sheet, the curtain


@shot("sheet_rise", "beds", "One sheet slowly lifting, far off, as if someone were sitting up under it: a long slow breath of cloth with a spring in it. At 6 and 9.", 0.45, "reverb 0.3, low-pass 4000")
def _sheet_rise(rng):
    a = speed(hp(rec(573730, 0.3, 3.1), 80), 0.7)
    return fade(a, 0.2, 0.8)


@bed("curtain_breathing", "karabasan", "A curtain moved by a slow draught, in and out about every five seconds, soft cloth on a sill. The only thing moving in the room.", 0.45, "dry", kbps=96)
def _curtain(rng):
    cloth = hp(rec(216606, 15.0, 45.0), 90)
    low = hp(rec(367328, 0.3, 8.6), 40)
    T = 25.0
    n = int(T * SR)
    t = np.arange(n) / SR
    u = (t / 5.0) % 1.0
    env = np.sin(np.pi * np.minimum(u / 0.55, 1.0)) ** 2 * (u < 0.55)
    env = env * (0.7 + 0.3 * np.sin(TAU * t / T))
    tape = Tape(T, wrap=True)
    tape.put(cloth[:n] / peak(cloth) * env * 1.3 + 0.0)
    tape.put(np.tile(low, 4)[:n] / peak(low) * 0.25 * (0.2 + env))
    return tape.x




@bed("whisper_gabble", "karabasan", "Whisper-level gabble, nobody's words: whispers run backwards and dulled, so that it is only the shape of speech. Far under the mix: you should not be sure it is there.", 0.1, "low-pass 2000, reverb 0.3", kbps=112)
def _gabble(rng):
    a = hp(rec(656439, 0.0, 22.0, "stereo"), 300)
    b = hp(rec(185059, 4.0, 26.0, "stereo"), 300)
    n = min(a.shape[-1], b.shape[-1])
    x = reverse(a[..., :n]) / peak(a) + reverse(b[..., :n]) / peak(b) * 0.7
    return seam(lp(x, 2400), 2.5)


@shot("chest_pressure", "karabasan buried", "Weight on the chest, made for this piece: a slow pressure below hearing that swells over six seconds and does not let go. At 58, with the picture pressed down.", 0.7, "dry")
def _chest(rng):
    n = int(9.0 * SR)
    t = np.arange(n) / SR
    up = np.minimum(1, t / 6.0) ** 2
    x = (np.sin(TAU * 31 * t) + 0.6 * np.sin(TAU * 46.5 * t + 1) + 0.3 * np.sin(TAU * 62.7 * t)) * up
    air = lp(rng.standard_normal(n), 180) * 2.0 * up
    return fade(x + air, 0.5, 1.5)


# ---------------------------------------------------------------- the bus stop


loop("bus_idle", "busstop", "A big diesel idling, heard from the kerb: engine and air, nothing else. When it has stopped. Fade out by 13.", 0.2, "dry; low-pass 1800 while it is far", 454420, 15.0, 40.0, xf=2.5, hp_hz=30)


@shot("bus_approach", "busstop", "A far engine coming up the road in fog, made from the idling bus: swelling for seven seconds from nothing, opening as it comes. At 1 s, to arrive at 8.", 0.4, "dry")
def _bus_come(rng):
    x = hp(rec(454420, 12.0, 21.0), 30)
    n = x.shape[-1]
    t = np.arange(n) / n
    far = lp(x, 500)
    return fade((far * (1 - t) + x * t) * t**1.6, 0.8, 0.6)


cut("air_brakes", "busstop", "Air brakes on a coach: a sharp burst and a long hiss dying. At 8.", 0.5, "dry", 454420, 4.1, 7.1, hp_hz=50, fades=(0.005, 0.5))
cut("air_brakes_2", "busstop", "A second, shorter release of air, a moment later.", 0.45, "dry", 454420, 10.9, 12.9, hp_hz=50, fades=(0.005, 0.4))
cut("bus_door_open", "busstop", "A bus's doors opening, pneumatic and tired. At about 10.", 0.5, "dry", 379372, 0.0, 2.0, hp_hz=50, fades=(0.005, 0.1))

# ---------------------------------------------------------------- cloth, wind, washing

loop("cloth_flap_gentle", "washing", "White cloth flapping gently on a line. A real clothesline in a small wind. The whole row, before they lift.", 0.3, "dry", 330639, 2.0, 24.0, xf=2.5, hp_hz=50, ch="stereo", kbps=112)
loop("cloth_flap_thick", "washing", "Heavier cloth on a line, thick flaps with the wind. From 6, when they lift together.", 0.25, "dry", 330638, 2.0, 22.0, xf=2.0, hp_hz=50, ch="stereo", kbps=112)
family("cloth_flap", 3, "washing corridor", "One heavy fabric flap.", 0.4, "dry", 580967, 0.0, 39.0, kind="hits", hp_hz=50, before=0.005, after=0.7, min_gap=1.0, drop=(3,))


@shot("sheets_lift", "washing", "All the sheets lifting together on a gust, made from one heavy flap and many cloth snaps, round the head, four seconds. At 6.", 0.5, "already wide", kbps=128)
def _lift(rng):
    x = hp(rec(330638, 4.0, 30.0), 60)
    x = x / peak(x)
    tape = Tape(5.0, channels=2)
    for _ in range(30):
        a = int(rng.uniform(0, x.shape[0] - 1.5 * SR))
        tape.put(fade(x[a : a + int(1.5 * SR)], 0.1, 0.5), rng.uniform(0, 2.5), rng.uniform(0.25, 0.6), rng.uniform(-1, 1))
    gust = lp(rec(217884, 60.0, 65.0, "stereo"), 1500)
    tape.put(gust / peak(gust), 0.0, 0.6)
    return fade(shape(tape.x, [(0, 0.2), (1.2, 1.0), (3.0, 0.9), (5.0, 0.0)]), 0.3, 0.6)


@shot("faces_press", "washing", "Cloth pushed out from behind, many at once: a slow stretching strain of fabric and a soft rub. At 9.", 0.5, "dry; pan each if you use it twice")
def _press(rng):
    x = hp(rec(216606, 25.0, 40.0), 150)
    x = x / peak(x)
    tape = Tape(3.5)
    for _ in range(10):
        a = int(rng.uniform(0, x.shape[0] - 1.5 * SR))
        tape.put(fade(speed(x[a : a + int(1.5 * SR)], 0.8), 0.3, 0.6), rng.uniform(0, 1.5), rng.uniform(0.3, 0.7))
    return fade(tape.x, 0.2, 0.5)


family("peg_creak", 3, "washing", "A wooden peg on a line, a tiny dry creak.", 0.25, "reverb 0.2", 590171, 0.0, 3.0, kind="spans", threshold=-14.0, gap=0.03, shortest=0.05, longest=0.6, hp_hz=300, pad=(0.003, 0.02), drop=(3,))

# ---------------------------------------------------------------- dolls

family("porcelain_click", 6, "dolls", "Two small porcelain things touching: a tiny hard click. Only ever from behind: pan it hard and low-pass a little.", 0.3, "low-pass 5000, reverb 0.2", 215385, 0.0, 50.0, kind="hits", before=0.001, after=0.1, min_gap=0.6)
cut("porcelain_rattle", "dolls", "A few porcelain pieces rattling for a second: more than one of them moved.", 0.25, "low-pass 5000, reverb 0.2", 206171, 0.1, 1.5, fades=(0.002, 0.1))
family("head_creak", 3, "dolls", "A tiny high creak of a doll's head turning on its neck. Dry; small enough to wonder about.", 0.2, "dry", 590171, 0.0, 3.0, kind="spans", threshold=-20.0, gap=0.02, shortest=0.08, longest=0.4, hp_hz=600, rate=1.4, pad=(0.003, 0.02))


@bed("cord_swing", "dolls ward", "A weight swinging slowly on a thick cord, full of fibre, about 2.8 s a swing. The bulb, from 30.", 0.3, "dry")
def _cord(rng):
    return quiet_loop(hp(rec(254735, 0.46, 17.84), 300), 0.1, 0.9)


loop("attic_wind", "dolls", "Cold mountain wind forced through the edges of an old door, with whistles. Under the attic.", 0.1, "low-pass 3000", 376644, 18.66, 33.8, xf=2.0, hp_hz=60)
cut("doll_jaw_drop", "dolls", "A jaw dropping open on a wooden hinge: one dry knock. At 46.", 0.5, "dry", 104019, 0.0, 0.44, fades=(0.001, 0.04))
family("wood_block", 3, "dolls party", "A small dry wood block: a doll set down, a head knocking on a shelf.", 0.3, "reverb 0.15", 530437, 0.0, 10.0, kind="hits", before=0.001, after=0.1, min_gap=0.3)
family("wood_snap_small", 3, "dolls funeral", "A small panel snapping or giving way, a dry crack.", 0.35, "reverb 0.15", 400653, 0.0, 11.7, kind="hits", before=0.002, after=0.16, min_gap=0.4, drop=(1, 3))

# ---------------------------------------------------------------- running


@bed("run_feet", "chase", "Your feet: running on a wooden floor, about three and a half steps a second, steady. Set `rate` with `legs`; let it drag from 24.", 0.3, "reverb 0.15")
def _run(rng):
    x = hp(rec(682772, 1.0, 12.5), 60)
    return quiet_loop(x, 0.02, 0.25)


@bed("run_feet_hard", "chase", "Harder running, with more shoe: for running with everything you have.", 0.3, "reverb 0.15")
def _run2(rng):
    x = hp(rec(365617, 0.5, 8.3), 100)
    return quiet_loop(x, 0.02, 0.25)


family("run_step", 4, "chase", "One hard heavy footfall on a wooden floor, when legs stop working and each one has to be made.", 0.4, "reverb 0.15", 641385, 2.5, 8.1, kind="hits", hp_hz=40, before=0.002, after=0.32, min_gap=0.3)
loop("run_breath", "chase", "A man out of breath, really running, outdoors in moving air: rough, big, irregular. For the second half.", 0.2, "dry", 456037, 2.0, 22.0, xf=1.5, hp_hz=120)


@bed("wet_weight", "chase", "Its wet weight dragging along the walls: slow heavy wet cloth and meat on plaster, low and big. Comes on from behind, unhurried, under everything.", 0.3, "reverb 0.25")
def _wet_weight(rng):
    a = rec(174634, 0.0, 18.0)
    b = rec(177017, 20.0, 38.0)
    n = min(a.shape[-1], b.shape[-1])
    x = hp(a[..., :n], 120) / peak(a) + hp(b[..., :n], 120) / peak(b) * 0.5
    x = speed(x, 0.62)
    x = lp(x, 3500)
    return seam(x, 3.0)


family("wet_slap", 4, "chase home kitchen stairs", "A wet slap on a hard floor. Something with no shoes.", 0.35, "reverb 0.2", 803193, 0.0, 9.5, kind="hits", hp_hz=80, before=0.003, after=0.4, min_gap=0.45)

# ---------------------------------------------------------------- buried


def _dirt_thud(rng, i, far):
    src = rec(384362, 0.0, 27.3)
    hits = find_hits(src, 6, before=0.01, after=0.55, min_gap=2.0)
    a, b = hits[i]
    x = fade(lp(src[a:b], 400 if not far else 220), 0.002, 0.2)
    grit = hp(rec(34175, 0.22, 5.1), 500)
    g0 = int(0.3 * i * SR) % (grit.shape[0] - int(0.6 * SR))
    y = fade(grit[g0 : g0 + int(0.6 * SR)], 0.005, 0.3)
    tape = Tape(0.9)
    tape.put(x / peak(x), 0.0, 1.0)
    tape.put(y / peak(y), 0.012, 0.16 if not far else 0.03)
    return fade(tape.x, 0.002, 0.15)


for _k in range(4):
    def _maker(k):
        return lambda rng: _dirt_thud(rng, k, False)

    _register(f"dirt_on_lid_{_k + 1}", "one-shot", "buried", "A shovelful of earth landing on the lid, heard from under it: a low thud and grit on wood. From 0 to 10, each a little weaker.", 0.6, "dry", _maker(_k), PEAK_SHOT, None)


@shot("dirt_on_lid_far", "buried", "The same with much more earth above you now: just a thump in the chest. The last of them.", 0.6, "dry")
def _dirt_far(rng):
    return _dirt_thud(rng, 4, True)


family("shovel", 3, "buried", "A shovel going into soil, outside and above: thuds and tearing roots. Very dull from where you are.", 0.4, "low-pass 1200", 353907, 0.0, 9.0, kind="hits", hp_hz=60, before=0.005, after=0.4, min_gap=0.8)
cut("dirt_trickle", "buried", "A small dry trickle of grit through a crack onto your face. At 22.", 0.5, "dry", 34175, 3.2, 5.1, hp_hz=300, fades=(0.1, 0.3))
cut("earth_inrush", "buried", "The earth coming in: gravel pouring, loud and rising, and it stops dead. At 52. Cut sound by layers under it.", 0.6, "low-pass 3000", 271130, 12.0, 22.9, hp_hz=60, fades=(0.2, 0.01))
family("nails_scrape", 5, "buried", "Nails dragged on a board, from inside something: a long scrape with a body to it. Made for a thing scratching in a closet. One per stroke while they hold.", 0.3, "dry", 397127, 0.0, 23.6, kind="spans", threshold=-20.0, gap=0.06, shortest=0.5, longest=2.5, hp_hz=80, pad=(0.005, 0.06))
loop("nails_frantic", "buried", "Fingernails on solid wood, fast and frantic: after the air starts to run out. For when the viewer holds.", 0.3, "dry", 417537, 3.42, 14.9, xf=0.3, hp_hz=70)
loop("nails_other_side", "buried", "A fingernail drawn along a plank, recorded from inside the plank with contact mics: from the other side of the wall, at your left, in your rhythm. From 42. Slow, single strokes.", 0.35, "dry; pan -0.8", 521697, 0.68, 8.92, xf=0.3, ch="left")
family("lid_creak", 3, "buried", "Huge slow wooden stick-slip: the lid, under what is on it. A pitched down noisemaker; it fills the box.", 0.5, "dry", 218163, 0.0, 19.5, kind="spans", threshold=-18.0, gap=0.1, shortest=0.6, longest=3.0, pad=(0.005, 0.1), lp_hz=3000, drop=(2,))
cut("lid_shut", "funeral buried", "A heavy old wooden lid dropped shut, low and gritty, with crumbs on top. At 52 in the funeral. Nothing after it.", 0.7, "reverb 0.3 in a hall, dry in the box", 367955, 20.9, 21.55, fades=(0.001, 0.08))
family("lighter_wheel", 4, "buried", "A lighter's wheel struck with the thumb: a rasp and a tiny spark. Try it a few times before it catches.", 0.45, "dry", 181267, 0.0, 7.7, kind="hits", before=0.01, after=0.35, min_gap=0.5, hp_hz=60)
cut("lighter_catch", "buried", "A strike that catches: the rasp and the small breath of the flame coming up.", 0.45, "dry", 11736, 5.9, 7.1, fades=(0.005, 0.15))
cut("lighter_lid", "buried", "A metal lighter's lid flicked back: one small clean click and ring.", 0.4, "dry", 85715, 0.2, 0.6, fades=(0.001, 0.03))


@bed("lighter_flame", "buried", "A very small flame close to the face, made for this piece: a soft flutter of air and now and then a tiny tick. Follow its size with `gain`.", 0.2, "dry")
def _flame(rng):
    T = 12.0
    n = int(T * SR)
    flutter = 0.6 + 0.4 * lfo(n, rng, (11, 17, 23, 31, 41))
    air = noise_loop(n, lambda f: (1 / np.sqrt(1 + (f / 500) ** 2)) * (1 / np.sqrt(1 + (70 / np.maximum(f, 1)) ** 4)), rng) * flutter
    tape = Tape(T, wrap=True)
    for _ in range(9):
        k = int(0.004 * SR)
        tape.put(rng.standard_normal(k) * np.exp(-np.arange(k) / (k / 3)), rng.uniform(0, T), rng.uniform(0.2, 0.7))
    return air * 0.15 + hp(tape.x, 1500, periodic=True) * 0.3


@shot("flame_out", "buried party", "A very small flame going out, made for this piece: a soft breathy pfft with a tiny tick. The blue bead, at 52; a match.", 0.35, "dry")
def _flame_out(rng):
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    y = bp(rng.standard_normal(n), 300, 3500, order=2) * np.exp(-t / 0.07) * np.minimum(1, t / 0.012)
    k = int(0.004 * SR)
    y[int(0.11 * SR) : int(0.11 * SR) + k] += rng.standard_normal(k) * np.exp(-np.arange(k) / (k / 3)) * 0.25
    return fade(y, 0.001, 0.2)


cut("board_crack_1", "buried", "A board cracking under load: a hard dry split.", 0.5, "dry", 501302, 0.0, 1.4, fades=(0.001, 0.2))
cut("board_crack_2", "buried", "Wood cracking, big and close.", 0.5, "dry", 183453, 0.05, 0.75, fades=(0.001, 0.1))
cut("board_crack_3", "buried", "Wood cracking again, the second give.", 0.5, "dry", 183453, 1.0, 1.6, fades=(0.001, 0.1))
cut("board_crack_4", "buried", "A smaller split in the boards.", 0.5, "dry", 183452, 1.3, 1.9, fades=(0.001, 0.1))
cut("wood_stress", "buried beam", "Heavy timber under stress, a groan and small cracks over eight seconds.", 0.5, "dry", 467014, 10.0, 18.0, fades=(0.1, 0.5))


loop("inside_fridge", "buried crawl kitchen", "Recorded from inside a small old empty refrigerator: motor, boil and knock, no air at all. Claustrophobia as a bed; it should feel like there is a lid on the sound.", 0.12, "dry", 334144, 18.0, 38.0, xf=2.0, hp_hz=60)


@bed("earth_pressure", "buried", "Being under two metres of earth, made for this piece: almost nothing, a dull pressure below 120 Hz with a slow drift. It is the sound of no outside.", 0.3, "dry")
def _earth(rng):
    T = 24.0
    n = int(T * SR)
    x = noise_loop(n, lambda f: 1 / np.sqrt(1 + (f / 70) ** 4) / np.sqrt(1 + (22 / np.maximum(f, 1)) ** 4), rng)
    return x * (1 + 0.4 * lfo(n, rng, (1, 2, 3)))


# ---------------------------------------------------------------- the beam

loop("wind_high_whistle", "beam", "A gale from inside a skyscraper: a thin whistle wavering at about 1.1 kHz through the gaps of the building. Height, heard.", 0.12, "dry", 782907, 6.0, 28.0, xf=3.0)
loop("wind_high_tube", "beam shaft", "Wind singing in an old lift tube at the top of a Bolivian mountain: one low wavering note, almost a voice. The bottom layer of the wind.", 0.14, "dry", 447375, 34.0, 58.0, xf=3.0, ch="stereo", kbps=112)
loop("wind_high_gusts", "beam", "Heavy gusts in the Alps, with buffeting: wind that wants to move you. The top layer.", 0.25, "dry", 454092, 0.0, 24.82, xf=2.5, ch="stereo", kbps=112)
loop("far_city", "beam", "A city a long way below, at night: the hum of it and not one car.", 0.25, "low-pass 1800", 391680, 5.0, 25.0, xf=3.0, hp_hz=40)
family("steel_creak", 5, "beam elevator", "A great steel rope and its fittings taking load: a metallic groan of a second or two with hard harmonics. One per step, or the beam giving.", 0.3, "reverb 0.3", 59160, 0.0, 90.0, kind="spans", threshold=-24.0, gap=0.15, shortest=0.6, longest=2.5, hp_hz=120, pad=(0.02, 0.2), fades=(0.05, 0.25))
cut("steel_creak_long", "beam deep", "A deep metal creak with gliding harmonics, three seconds.", 0.3, "reverb 0.3", 238289, 0.0, 3.1, fades=(0.1, 0.4))
cut("steel_stress", "beam elevator", "A giant metal structure under rapid stress, slowed from a squealing desk: sixteen seconds of a slow scream of steel. At 48, when the bolts go.", 0.25, "reverb 0.3", 172411, 0.2, 16.2, fades=(0.5, 1.0))
family("steel_throb", 2, "beam elevator", "A tortured metal creak with a body in it, from a drum throne, played very close.", 0.3, "reverb 0.2", 489442, 0.0, 42.0, kind="spans", threshold=-12.0, gap=0.3, shortest=1.0, longest=3.0, hp_hz=80, pad=(0.01, 0.3), fades=(0.02, 0.4), drop=(2,))
family("step_steel", 4, "beam", "A shoe on a steel plate: a hard step with a metal ring. Walking the beam.", 0.45, "reverb 0.3", 698697, 0.0, 10.3, kind="hits", before=0.002, after=0.5, min_gap=0.9, hp_hz=60)
cut("bolt_ping_1", "beam", "A bolt going: one hard high ping that rings away. They come one by one, in a line, toward you.", 0.5, "reverb 0.5", 217459, 0.0, 0.4, fades=(0.001, 0.05))
cut("bolt_ping_2", "beam", "Another bolt, lower.", 0.5, "reverb 0.5", 217461, 0.0, 0.4, fades=(0.001, 0.05))
cut("bolt_ping_3", "beam", "Another bolt, shorter.", 0.5, "reverb 0.5", 217462, 0.0, 0.3, fades=(0.001, 0.05))
cut("bolt_ping_long", "beam", "Several bolts letting go in a line, three seconds.", 0.45, "reverb 0.5", 217463, 0.0, 3.3, fades=(0.001, 0.2))
cut("bolts_fall", "beam elevator crawl", "Nuts and bolts falling, a handful, on metal.", 0.35, "reverb 0.3", 418487, 0.3, 4.0, fades=(0.005, 0.3))
cut("rust_flake", "beam", "A few grains falling away on metal: tiny. For rust flakes that fall a long time.", 0.3, "reverb 0.3", 418487, 6.5, 7.6, hp_hz=1000, fades=(0.005, 0.2))
cut("phone_bell_thin", "beam", "An old telephone's bell, thin and far, band-limited as if the wind were eating it. Keep it under the wind; it rings at 35 and 38 and 41 on the chair.", 0.25, "reverb 0.2", 15826, 0.58, 3.42, hp_hz=1800, lp_hz=6000, fades=(0.005, 0.2))
cut("chair_slide_steel", "beam", "A chair sliding on metal and concrete: a scrape that ends in nothing. At about 50.", 0.35, "reverb 0.2", 104351, 0.1, 4.4, hp_hz=60, fades=(0.05, 0.3))
cut("pigeons_below", "beam", "A flock of pigeons taking off, a long way down.", 0.2, "low-pass 3000, reverb 0.5", 532180, 0.0, 5.0, hp_hz=200, fades=(0.05, 0.6))
cut("whoosh_fall", "beam shaft elevator crawl", "A synthesized low whoosh that hits and takes five seconds to die. For the instant of the drop.", 0.5, "dry", 425702, 0.06, 5.6, ch="stereo", fades=(0.005, 0.5), kbps=128)

# ---------------------------------------------------------------- the fall

loop("fall_wind", "shaft beam elevator", "A real solo skydive: seventy seconds of freefall cut to half a minute, a roar with life in it. Loud on purpose: gain low.", 0.12, "low-pass 8000", 811077, 25.0, 49.0, xf=3.0, ch="stereo", kbps=112)
loop("air_rush", "shaft", "Air over a microphone at speed, racing downhill on a bicycle: a clean rush of noise with no buffeting.", 0.1, "dry", 20108, 0.0, 18.0, xf=3.0)
loop("wind_in_ears", "shaft deep", "Wind in your ears, a muffled version with nothing above 1.5 kHz: from inside the head.", 0.25, "dry", 611197, 0.14, 22.0, xf=3.0)
cut("door_pass_1", "shaft chase", "A low swoosh of a thing going by, long.", 0.4, "dry", 325256, 2.6, 8.2, fades=(0.1, 0.4))
cut("door_pass_2", "shaft chase", "The same going by faster: an open door past you.", 0.4, "dry", 325256, 2.6, 8.2, rate=1.5, fades=(0.1, 0.3))
cut("door_pass_3", "shaft", "The same very fast.", 0.4, "dry", 325256, 2.6, 8.2, rate=2.3, fades=(0.05, 0.2))

# ---------------------------------------------------------------- holes


def _click_bank():
    bank = []
    for fid, a, b, hz in [(542752, 0.0, 0.2, 800), (416908, 0.0, 3.7, 1200), (257483, 0.0, 3.6, 1200), (696021, 0.3, 28.0, 700), (861352, 0.18, 9.92, 300), (800117, 0.0, 30.0, 800)]:
        x = hp(rec(fid, a, b), hz)
        for i, j in find_hits(x, 14, before=0.001, after=0.03, min_gap=0.03):
            c = fade(x[i:j], 0.0005, 0.012)
            bank.append(c / max(peak(c), 1e-9))
    return bank


def _clicks(rng, per_second, T=16.0, swell=True):
    bank = _click_bank()
    tape = Tape(T, channels=2, wrap=True)
    n = int(per_second * T)
    for _ in range(n):
        c = bank[int(rng.integers(0, len(bank)))]
        at = rng.uniform(0, T)
        d = 1.0 + 0.5 * np.sin(TAU * (at / T) * 3 + 1.0) if swell else 1.0
        if rng.uniform(0, 1.5) < d:
            tape.put(speed(c, rng.uniform(0.7, 1.6)), at, rng.lognormal(-2.2, 0.6), rng.uniform(-1, 1))
    return tape.x


@bed("seed_clicks", "holes", "A wet dry clicking, tiny, everywhere: seeds in a pod, a small wet tongue, built from thousands of tiny clicks round the head. From about 20, rising.", 0.3, "dry", kbps=128)
def _seeds(rng):
    return _clicks(rng, 60)


@bed("seed_clicks_dense", "holes", "The same, far denser, a crawl of it: when it is on his face. Cross-fade to it at 26.", 0.3, "dry", kbps=128)
def _seeds2(rng):
    return _clicks(rng, 300)


family("wet_click", 5, "holes kitchen", "A tiny wet click, clay or a mouth, alone.", 0.4, "dry", 696021, 0.3, 28.0, kind="hits", hp_hz=700, before=0.002, after=0.06, min_gap=0.2)


@shot("holes_open", "holes", "Everything opening a little wider, together, built from those clicks and wet hair gel: a long soft wet sigh of a thousand small mouths, five seconds. At 40.", 0.5, "already wide", kbps=128)
def _open(rng):
    x = _clicks(rng, 1000, T=6.0, swell=False)
    n = x.shape[-1]
    t = np.arange(n) / SR
    wet = hp(rec(593990, 5.0, 11.0, "mid"), 200)
    wet = wet / peak(wet)
    tape = Tape(6.0, channels=2)
    tape.put(x * np.minimum(1, t / 2.5) * np.minimum(1, (6.0 - t) / 2.0))
    tape.put(fade(speed(wet[: int(3.5 * SR)], 0.5), 0.6, 1.0), 0.0, 0.5)
    return fade(tape.x, 0.2, 0.4)


family("step_gallery", 3, "holes", "A leather shoe on a hard polished floor, in a quiet room.", 0.3, "reverb 0.4", 536770, 0.0, 43.0, kind="hits", before=0.005, after=0.35, min_gap=0.5, hp_hz=60)
cut("coat_move", "holes busstop funeral home waitingroom elevator darkness", "A coat or a jacket moving on a shoulder, small and close.", 0.4, "reverb 0.1", 394026, 2.0, 5.0, hp_hz=120, fades=(0.05, 0.25))

# ---------------------------------------------------------------- the beach of teeth


@bed("waves_teeth", "teeth", "Small waves running up a beach of something hard: a real pebble beach with a clatter of small hard things laid into every wave. Their draw-back rattles like teeth. The whole room.", 0.25, "reverb 0.1", kbps=128)
def _waves(rng):
    x = hp(rec(569644, 2.0, 26.0, "stereo"), 40)
    x = x / peak(x)
    shells = hp(rec(800117, 0.0, 31.0), 700)
    shells = shells / peak(shells)
    m = mono(x)
    k = int(0.1 * SR)
    env = np.sqrt(np.convolve(m * m, np.ones(k) / k, mode="same"))
    env = env / env.max()
    n = x.shape[-1]
    layer_ = np.tile(shells, 2)[:n]
    other = np.roll(layer_, int(5.3 * SR))
    clatter = np.stack([layer_, other]) * env**1.5
    return seam(x + clatter * 0.8, 2.5)


@shot("wave_draw_back", "teeth", "A wave drawing back with the clatter of all of them: stones rolling down and a thousand hard small clicks falling away. At 7.", 0.5, "already wide", kbps=128)
def _draw(rng):
    a = hp(rec(569644, 12.0, 17.0, "stereo"), 60)
    a = a / peak(a)
    c = hp(rec(465811, 0.0, 28.0), 300)
    c = c / peak(c)
    shells = hp(rec(800117, 0.0, 31.0), 700)
    shells = shells / peak(shells)
    n = a.shape[-1]
    t = np.arange(n) / n
    tape = Tape(n / SR, channels=2)
    tape.put(a, 0.0, 0.7)
    tape.put(np.stack([shells[:n], shells[n : 2 * n]]) * np.exp(-t * 2.2), 0.0, 1.0)
    return fade(tape.x, 0.3, 1.2)


loop("pebbles_only", "teeth mirror", "Small hard things moved on a hard surface, with no sea at all: shells and quartz on marble, close. A clatter you can bring up over the waves.", 0.2, "dry", 800117, 0.0, 30.0, xf=1.0, hp_hz=500)

# ---------------------------------------------------------------- the exam

family("cough_far", 3, "exam funeral waitingroom", "One polite cough in a big room. Far off, once, and everything goes quieter after it.", 0.3, "reverb 0.5, low-pass 3000", 561013, 3.8, 6.4, kind="spans", threshold=-30.0, gap=0.1, shortest=0.1, longest=0.7, pad=(0.01, 0.1))
cut("cough_man", "exam funeral", "A man coughing, four times, as one does in a hall.", 0.25, "reverb 0.5, low-pass 3000", 383783, 2.2, 4.3, fades=(0.01, 0.1))
family("seat_creak", 4, "exam waitingroom funeral", "One seat creaking under someone shifting their weight.", 0.25, "reverb 0.4", 276473, 0.0, 10.0, kind="spans", threshold=-18.0, gap=0.08, shortest=0.2, longest=1.0, hp_hz=200, pad=(0.005, 0.08))
cut("bench_sit", "waitingroom funeral", "Sitting down on a loose wooden bench, and getting up: low creaks.", 0.35, "reverb 0.3", 454378, 0.5, 6.5, hp_hz=60, fades=(0.05, 0.3))
cut("chair_wood_move", "funeral exam party album", "A wooden chair moved on a floor, slow.", 0.35, "reverb 0.3", 219677, 0.0, 6.0, hp_hz=70, fades=(0.02, 0.3))
cut("chair_scrape_floor", "album evening", "A chair dragged across a hard floor, dry.", 0.3, "reverb 0.3", 188204, 0.5, 6.0, hp_hz=70, fades=(0.02, 0.3))
cut("pencil_snap", "exam", "A pencil snapped in the fingers: one dry crack. The first thing you hear in that silence.", 0.5, "reverb 0.3", 486374, 2.25, 3.0, hp_hz=200, fades=(0.001, 0.1))


def _claps():
    x = hp(rec(197435, 0.0, 60.0, "stereo"), 150)
    return x, find_hits(x, 40, before=0.004, after=0.4, min_gap=0.4)


def _big_clap(x, hits, rng, voices=5):
    """One clap of a small group, stacked with itself until it is hundreds in a big room."""
    tape = Tape(0.7, channels=2)
    for _ in range(voices):
        i, j = hits[int(rng.integers(0, len(hits)))]
        c = fade(x[..., i:j], 0.001, 0.06)
        tape.put(speed(c, rng.uniform(0.92, 1.08)) / peak(c), rng.uniform(0.0, 0.03), rng.uniform(0.5, 1.0))
    return tape.x


for _k in range(4):
    def _maker2(k):
        def fn(rng):
            x, hits = _claps()
            return fade(_big_clap(x, hits, np.random.default_rng(100 + k)), 0.001, 0.08)

        return fn

    _register(f"clap_unison_{_k + 1}", "one-shot", "exam", "One clap of hundreds in unison, with a little room. Fire them by hand on a slow beat, one every 1.3 s, gain growing.", 0.3, "reverb 0.5", _maker2(_k), PEAK_SHOT, 128)


@shot("shutter_wave", "exam", "A single wave of hundreds of cameras going off, sweeping once from the left to the right of the hall in three seconds. Stereo; not a strobe. At 48.", 0.5, "reverb 0.5", kbps=128)
def _wave(rng):
    bank = []
    for fid, a, b in [(520684, 0.7, 1.3), (250105, 0.0, 4.3), (676375, 0.9, 2.7), (376205, 0.0, 2.4), (116609, 0.0, 18.8)]:
        x = hp(rec(fid, a, b), 400)
        for i, j in find_hits(x, 6, before=0.002, after=0.09, min_gap=0.2):
            c = fade(x[i:j], 0.001, 0.02)
            bank.append(c / max(peak(c), 1e-9))
    T = 3.8
    tape = Tape(T, channels=2)
    for _ in range(300):
        u = float(rng.beta(2.4, 2.4))
        c = bank[int(rng.integers(0, len(bank)))]
        at = 0.1 + u * 3.2
        pan_ = -1 + 2 * u + rng.uniform(-0.12, 0.12)
        tape.put(speed(c, rng.uniform(0.85, 1.2)), at, rng.lognormal(-1.5, 0.6), float(np.clip(pan_, -1, 1)))
    return fade(tape.x, 0.01, 0.2)


@shot("crowd_rise", "exam funeral pool", "Hundreds of people lifting their heads or getting to their feet without a word: a slow rumble of coats and seats, six seconds. Wide, low.", 0.4, "reverb 0.5", kbps=128)
def _crowd(rng):
    cloth = hp(rec(394026, 0.0, 16.9), 100)
    cloth = cloth / peak(cloth)
    seat = hp(rec(276473, 0.0, 10.0), 200)
    seat = seat / peak(seat)
    tape = Tape(6.5, channels=2)
    for _ in range(70):
        a = int(rng.uniform(0, cloth.shape[0] - 1.2 * SR))
        tape.put(fade(cloth[a : a + int(1.2 * SR)], 0.2, 0.5), rng.uniform(0, 5.0), rng.uniform(0.08, 0.3), rng.uniform(-1, 1))
    for _ in range(30):
        a = int(rng.uniform(0, seat.shape[0] - 0.6 * SR))
        tape.put(fade(seat[a : a + int(0.6 * SR)], 0.01, 0.2), rng.uniform(0, 5.5), rng.uniform(0.04, 0.16), rng.uniform(-1, 1))
    return fade(shape(tape.x, [(0, 0.3), (2.0, 1.0), (4.0, 0.9), (6.5, 0.0)]), 0.3, 0.5)


# ---------------------------------------------------------------- the party

cut("clown_horn_slow", "party", "One honk of a clown's bulb horn, detuned and slow, a sick low bray. The honk behind you at 20.", 0.55, "reverb 0.2", 405155, 0.96, 1.7, rate=0.62, fades=(0.002, 0.08))


@shot("horns_all", "party", "Thirty horns at once, one honk: a wide, ragged, close bray, slightly out of tune, slightly out of time. At 48. Then the cut.", 0.6, "already wide", kbps=128)
def _horns(rng):
    x = fade(rec(405155, 0.96, 1.7), 0.002, 0.05)
    x = x / peak(x)
    tape = Tape(1.4, channels=2)
    for _ in range(30):
        tape.put(speed(x, rng.uniform(0.55, 0.95)), rng.uniform(0.0, 0.05), rng.uniform(0.2, 0.6), rng.uniform(-1, 1))
    return fade(tape.x, 0.002, 0.1)


family("balloon_squeak", 4, "party", "A balloon rubbed by a fingertip: a short rubbery squeak. They sink, they touch things.", 0.3, "reverb 0.15", 569256, 20.0, 180.0, kind="spans", threshold=-16.0, gap=0.04, shortest=0.1, longest=0.7, hp_hz=150, pad=(0.003, 0.03))
loop("balloon_rub", "party", "A balloon slowly rubbed, on and on, soft and low: something moving in the paper chains.", 0.15, "reverb 0.2", 76802, 2.0, 18.0, xf=1.0, hp_hz=100)
family("candle_out", 4, "party album", "A candle flame flickering and blown out: a soft low flutter and it is gone. Every couple of seconds from 8.", 0.6, "reverb 0.15", 204531, 0.0, 9.9, kind="spans", threshold=-20.0, gap=0.15, shortest=0.4, longest=1.5, hp_hz=60, pad=(0.01, 0.15))
cut("candle_blow", "party", "A breath blowing a candle out: closer, a small puff.", 0.4, "reverb 0.1", 242867, 0.0, 0.8, hp_hz=100, fades=(0.005, 0.1))
cut("needle_drop", "party", "A needle set down on a record, and its first crackle.", 0.35, "dry", 556722, 0.0, 3.5, hp_hz=100, fades=(0.002, 0.3))


@bed("breath_sack", "party", "Breath behind cloth, made from a soft recording under a heavy filter: slow, dull, close. The sack moves.", 0.35, "dry")
def _sack(rng):
    x = lp(hp(rec(722717, 10.0, 30.5), 80), 900)
    x = bell(x, 400, 5.0, 1.0)
    return quiet_loop(x, 0.12, 1.2)


# ---------------------------------------------------------------- the telephone, the television


cut("phone_ring", "home", "A 1950s Western Electric telephone ringing, one long ring, brass bells, very loud in that room. At 12; again at 15 and at 18; once at 67.", 0.55, "reverb 0.2", 456433, 7.2, 10.4, fades=(0.002, 0.25))
cut("phone_pickup_1", "home beam", "An old handset lifted from its cradle: a clack and a rattle.", 0.45, "dry", 559475, 0.98, 1.65, fades=(0.002, 0.04))
cut("phone_hangup_2", "home", "An old handset put down: a hang-up.", 0.45, "dry", 559475, 5.2, 5.85, fades=(0.002, 0.04))


@bed("phone_line_breath", "home beam", "Someone breathing on the line, at the other end of an old telephone: the labored breath squeezed into the telephone's band with line hiss and mains under it. At 21.", 0.3, "dry", kbps=96)
def _line(rng):
    x = _breath_loop(369294, 3.0, 21.3, hp_hz=70, search=0.8)
    n = x.shape[-1]
    y = bp(x, 340, 3200, order=4, periodic=True)
    y = np.tanh(y / peak(y) * 2.0)
    t = np.arange(n) / SR
    hum = np.sin(TAU * whole_hz(50, n / SR) * t) * 0.012 + np.sin(TAU * whole_hz(150, n / SR) * t) * 0.006
    hiss = noise_loop(n, lambda f: np.exp(-(((f - 1800) / 1400) ** 2)), rng) * 0.018
    return y * 0.6 + hum + hiss


@bed("phone_line_dead", "home beam", "An open telephone line with nobody on it, made for this piece: mains hum in the earpiece, thin hiss.", 0.2, "dry")
def _line_dead(rng):
    T = 12.0
    n = int(T * SR)
    t = np.arange(n) / SR
    hum = sum(a * np.sin(TAU * k * 50 * t + k) for k, a in ((1, 0.4), (3, 0.8), (5, 0.3), (7, 0.15)))
    hiss = noise_loop(n, lambda f: np.exp(-(((f - 1800) / 1400) ** 2)), rng)
    return bp(hum, 200, 3400, order=2, periodic=True) * 0.5 + hiss * 0.3


loop("tv_hum", "home", "A cathode ray set: a video hum and whine. It should be there the moment it comes on, and be hard to place.", 0.1, "dry", 799662, 0.5, 10.2, xf=1.0)
loop("tv_static", "home", "A dead channel: static, full and hissing. At 62, under the picture of the wardrobe.", 0.08, "dry", 116395, 5.0, 25.0, xf=2.0, kbps=96)
cut("tv_on", "home", "An old set switched on: click, thump, the tube and static rising. At 62.", 0.4, "dry", 693860, 0.0, 6.0, ch="stereo", fades=(0.001, 0.3), kbps=128)


@bed("neck_sway", "home", "The sway of something wet: a long heavy thing swinging slowly in the air, a soft wet creak about every three seconds, like a rope of meat. From 40, close at 50.", 0.35, "reverb 0.1", kbps=96)
def _neck(rng):
    x = hp(rec(174634, 0.0, 40.0, "left"), 200)
    x = speed(x, 0.7)
    x = x / peak(x)
    cord = hp(rec(254735, 0.46, 17.84), 300)
    cord = lp(cord, 1800) / peak(cord)
    T = 18.0
    n = int(T * SR)
    t = np.arange(n) / SR
    u = (t / 3.0) % 1.0
    env = np.sin(np.pi * u) ** 3
    tape = Tape(T, wrap=True)
    tape.put(x[: n] * env * 1.5)
    tape.put(cord[: n] * 0.5)
    return tape.x


family("dust_fall", 2, "home", "A little dust and grit coming down from the ceiling.", 0.3, "dry", 34175, 0.22, 5.1, kind="spans", threshold=-22.0, gap=0.05, shortest=0.1, longest=0.8, hp_hz=800, pad=(0.005, 0.1))

# ---------------------------------------------------------------- stairs, the funeral, the album

family("wet_step", 4, "stairs album mirror", "A slow bare wet foot on a hard floor: a soft slap and the skin peeling off it. Far to near, the same foot: lower the gain and add low-pass for far.", 0.5, "reverb 0.25; low-pass 2500 for far", 338106, 0.0, 18.7, kind="hits", hp_hz=100, before=0.005, after=0.42, min_gap=0.45)
family("wet_step_small", 3, "album stairs", "A lighter wet footstep, on a floor that is wet all over.", 0.4, "reverb 0.5", 553241, 0.0, 19.0, kind="hits", hp_hz=100, before=0.005, after=0.35, min_gap=0.4)
loop("rain_roof", "funeral home", "Rain on a roof, from the inside of the house: a soft mass of it. In the funeral, on high windows.", 0.2, "reverb 0.1", 610543, 10.0, 32.0, xf=3.0, hp_hz=60, ch="stereo", kbps=112)
cut("nails_tin", "funeral", "Nails rattled in a tin, then still: someone taking a handful. Far, in that big room.", 0.3, "reverb 0.5", 328766, 0.5, 5.5, fades=(0.01, 0.3))
cut("nails_tin_box", "funeral", "A box of screws lifted and shaken once.", 0.3, "reverb 0.5", 79382, 0.0, 4.2, fades=(0.01, 0.3))
cut("nails_coffin", "funeral buried", "A handful of antique rusty coffin nails handled in the fingers: very close and very small.", 0.5, "dry", 677400, 8.54, 13.06, hp_hz=1500, fades=(0.01, 0.2))
cut("lid_slide", "funeral", "An old wooden lid dragged across a box, heavy, four seconds. It stops at half. Then it goes on.", 0.5, "reverb 0.3", 104013, 0.1, 4.0, fades=(0.02, 0.2))
cut("lid_slide_short", "funeral", "The same wood moved only a little.", 0.5, "reverb 0.3", 146805, 0.0, 1.4, fades=(0.005, 0.15))
cut("mourners_lean", "funeral", "Many dark coats leaning in together, slowly: a soft mass of cloth.", 0.35, "reverb 0.3", 722675, 2.0, 12.0, hp_hz=120, fades=(0.5, 1.0))


# ---------------------------------------------------------------- made for this piece: drones


def _beating(n, T, rng, voices, width=0.6):
    """Pairs of sines a slow beat apart, each with a swell of its own; whole cycles in the loop, so it closes by itself."""
    t = np.arange(n) / SR
    out = np.zeros((2, n))
    for hz, beat, amp in voices:
        a = whole_hz(hz, T)
        b = whole_hz(hz + beat, T)
        if a == b:
            b = a + 1 / T
        swell = 1 + 0.55 * lfo(n, rng, (1, 2, 3))
        for c in range(2):
            p = rng.uniform(0, TAU, 2)
            if c == 1:
                p = p * width
            out[c] += amp * swell * (np.sin(TAU * a * t + p[0]) + np.sin(TAU * b * t + p[1])) / 2
    return out


DRONE_SECONDS = 30.0


@bed("dream_drone_low", "all", "Low dread, made for this piece: slow beating sines around E1 and A1 over a dark noise; no melody. The default floor of a room.", 0.12, "dry; barely audible is right", kbps=112)
def _drone_low(rng):
    T = DRONE_SECONDS
    n = int(T * SR)
    voices = [(41.2, 0.28, 1.0), (55.0, 0.19, 0.55), (58.27, 0.11, 0.2), (82.4, 0.31, 0.42), (110.0, 0.23, 0.24), (123.47, 0.17, 0.1), (164.8, 0.37, 0.1), (220.0, 0.29, 0.05), (329.6, 0.41, 0.02)]
    x = _beating(n, T, rng, voices)
    air = noise_loop(n, lambda f: pink_gain(f, 25) / np.sqrt(1 + (f / 260) ** 4), rng, 2) * 0.11
    return hp(x + air * (1 + 0.5 * lfo(n, rng, (1, 2))), 22, periodic=True)


@bed("dream_drone_hollow", "all", "Hollow, made for this piece: air blown across something the size of a building, odd overtones of 73 Hz that breathe slowly. For long rooms and tunnels.", 0.14, "dry", kbps=112)
def _drone_hollow(rng):
    T = DRONE_SECONDS
    n = int(T * SR)

    def pipe(f0):
        def H(f):
            g = np.zeros_like(f)
            for k in range(1, 13):
                fk = f0 * (2 * k - 1)
                g += np.exp(-(((f - fk) / (1.6 + 0.9 * k)) ** 2)) / k**0.7
            return g

        return noise_loop(n, H, rng, 2)

    a, b = pipe(73.4), pipe(74.2)
    u = 0.5 + 0.5 * lfo(n, rng, (1, 2))
    x = a * np.sqrt(u) + b * np.sqrt(1 - u)
    rumble = noise_loop(n, lambda f: 1 / np.sqrt(1 + (f / 90) ** 4) / np.sqrt(1 + (24 / np.maximum(f, 1)) ** 4), rng, 2) * 0.35
    return (x * (1 + 0.5 * lfo(n, rng, (2, 3, 5))) + rumble) * 0.5


@bed("dream_drone_glass", "all", "Thin and high, made for this piece: a cluster around 1.2 to 3 kHz beating very slowly, like a wet finger on a far glass, over a faint low hum. For what is about to go wrong.", 0.04, "dry; keep it very low", kbps=112)
def _drone_glass(rng):
    T = DRONE_SECONDS
    n = int(T * SR)
    voices = [(1174.7, 0.13, 1.0), (1396.9, 0.21, 0.7), (1661.2, 0.09, 0.5), (2217.5, 0.17, 0.32), (3135.9, 0.23, 0.16), (70.0, 0.14, 0.5), (140.0, 0.2, 0.18)]
    x = _beating(n, T, rng, voices, width=1.0)
    hiss = noise_loop(n, lambda f: np.exp(-(((f - 2000) / 1400) ** 2)), rng, 2) * 0.03
    return x * (1 + 0.4 * lfo(n, rng, (1, 3))) + hiss


@bed("dream_drone_metal", "all", "Metal, made for this piece: the unrelated overtones of a very big plate, each slowly rising and falling: a hull, a far machine. For institutions and for deep water.", 0.12, "dry, or low-pass 900 through a wall", kbps=112)
def _drone_metal(rng):
    T = DRONE_SECONDS
    n = int(T * SR)
    base = 46.25
    ratios = [1, 1.593, 2.136, 2.295, 2.917, 3.598, 4.153, 5.404, 6.27, 7.81, 9.13, 11.4]
    voices = [(base * r, 0.09 + 0.05 * (i % 5), 1.0 / (1 + i) ** 0.8) for i, r in enumerate(ratios)]
    x = np.zeros((2, n))
    for v in voices:
        # each partial has its own slow rise and fall, so that the colour of the thing keeps changing
        x += _beating(n, T, rng, [v]) * (0.5 + 0.5 * lfo(n, rng, (1, 2, 3)))
    bed_air = noise_loop(n, lambda f: pink_gain(f, 40) / np.sqrt(1 + (f / 800) ** 4), rng, 2) * 0.06
    return hp(x + bed_air, 24, periodic=True)


# ---------------------------------------------------------------- made for this piece: signals


def _chime(hz, seconds=2.4, decay=1.0):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for ratio, amp, d in [(1.0, 1.0, decay), (1.003, 0.4, decay * 0.8), (2.0, 0.42, decay * 0.55), (3.01, 0.16, decay * 0.3), (4.17, 0.07, decay * 0.16), (6.3, 0.03, decay * 0.07)]:
        y += amp * np.sin(TAU * hz * ratio * t) * np.exp(-t / d)
    return fade(y * np.minimum(1, t / 0.004), 0.0, seconds * 0.4)


@shot("ding_two_note", "waitingroom", "The counter's soft two-note ding, made for this piece: a falling third from a cheap ceiling speaker. Fire it each time the number changes.", 0.3, "reverb 0.25")
def _ding(rng):
    tape = Tape(3.4)
    tape.put(_chime(659.25), 0.02, 1.0)
    tape.put(_chime(523.25), 0.66, 0.92)
    return bp(tape.x, 260, 5200, order=2)


@shot("ding_two_note_wrong", "waitingroom album", "The same ding, one note sagging and late, made for this piece. For the number that should not have come: 33.", 0.3, "reverb 0.3")
def _ding_wrong(rng):
    tape = Tape(4.0)
    tape.put(_chime(659.25), 0.02, 1.0)
    low = _chime(523.25 * 2 ** (-38 / 1200), 3.0, 1.4)
    sag = 1 - 0.018 * (1 - np.exp(-np.arange(len(low)) / SR / 0.8))
    low = warp(low, sag)
    tape.put(low, 0.86, 0.92)
    return bp(tape.x, 240, 4600, order=2)


@shot("monitor_beep", "ward", "One clean beep of the heart monitor, made for this piece, 1 kHz with a small speaker's edge. Fire it yourself so that it can quicken.", 0.16, "reverb 0.1")
def _monitor(rng):
    n = int(0.16 * SR)
    t = np.arange(n) / SR
    y = np.sin(TAU * 1000 * t) + 0.12 * np.sin(TAU * 2000 * t) + 0.05 * np.sin(TAU * 3000 * t)
    return fade(y, 0.004, 0.012)


@shot("monitor_flatline", "ward", "The one long tone, made for this piece: same pitch as the beep, steady for eight seconds. Stop it when you want the silence after it: `stop(0.02)`.", 0.16, "reverb 0.1")
def _flatline(rng):
    n = int(8.0 * SR)
    t = np.arange(n) / SR
    y = np.sin(TAU * 1000 * t) + 0.12 * np.sin(TAU * 2000 * t) + 0.05 * np.sin(TAU * 3000 * t)
    return fade(y, 0.004, 0.05)


@shot("sonar_ping", "deep", "A sonar's ping, made for this piece: a pure 1.2 kHz strike and its own long ring and two far returns, already wet because the ring is the sound.", 0.28, "already wet; low-pass 3000 if it is too clean")
def _sonar(rng):
    n = int(6.5 * SR)
    t = np.arange(n) / SR
    y = np.sin(TAU * (1187 * t + 3 * np.exp(-t / 0.05))) * np.exp(-t / 0.13) * np.minimum(1, t / 0.002)
    y += 0.25 * np.sin(TAU * 2374 * t) * np.exp(-t / 0.04)
    tape = Tape(6.5)
    tape.put(y, 0.0, 1.0)
    tape.put(y, 1.34, 0.16)
    tape.put(y, 2.91, 0.06)
    wet = room_verb(tape.x, t60=4.5, wet=0.42, dark=2400.0, pre=0.03, seed=11)
    return fade(wet[: int(6.5 * SR)], 0.001, 1.2)


@shot("deep_bell", "album funeral", "A very deep bell, made for this piece: one stroke of something enormous around 58 Hz, ringing for fourteen seconds with slow beats. For 18:31, and nothing else.", 0.5, "reverb 0.6")
def _bell(rng):
    seconds_ = 16.0
    n = int(seconds_ * SR)
    t = np.arange(n) / SR
    f0 = 58.27
    y = np.zeros(n)
    for ratio, amp, t60 in [(0.5, 0.65, 15), (1.0, 1.0, 13), (1.19, 0.55, 10), (1.5, 0.34, 8), (2.0, 0.85, 7), (2.52, 0.33, 5), (3.0, 0.3, 3.6), (4.02, 0.2, 2.4), (5.33, 0.12, 1.5), (6.72, 0.07, 1.0), (8.17, 0.05, 0.7)]:
        for det in (1.0, 1.0 + rng.uniform(0.0008, 0.003)):
            y += 0.6 * amp * np.sin(TAU * f0 * ratio * det * t + rng.uniform(0, TAU)) * np.exp(-6.91 * t / t60)
    strike = lp(rng.standard_normal(n), 900) * np.exp(-t / 0.03) * 2.2
    thump = np.sin(TAU * 44 * t) * np.exp(-t / 0.18) * 0.9
    return fade(y * np.minimum(1, t / 0.006) + strike + thump, 0.001, 2.0)


def _shepard(n, T, rng, rising=True, base=40.0, octaves=8):
    """A tone that keeps rising and never arrives; after T seconds it is exactly where it began."""
    t = np.arange(n) / SR
    y = np.zeros(n)
    u = t / T
    for k in range(octaves):
        w = (k + u) / octaves if rising else (k + 1 - u) / octaves
        amp = np.sin(np.pi * w) ** 2
        # the instantaneous frequency doubles over T, so the phase is its integral
        phase = base * 2.0**k * T / np.log(2) * (2.0**u - 1) if rising else base * 2.0 ** (k + 1) * T / np.log(2) * (1 - 2.0 ** (-u))
        p0 = rng.uniform(0, TAU)
        y += amp * np.sin(TAU * phase + p0)
    return y


@shot("rising_tone", "shaft beam", "A tone that rises without arriving, made for this piece: fourteen seconds, thickening with air, ending at its top. Start it at 16 s in the shaft so that it ends in the stop.", 0.3, "dry")
def _rising(rng):
    T = 7.0
    n = int(14.0 * SR)
    a = _shepard(n, T, rng)
    gust = noise_loop(n, lambda f: pink_gain(f, 60) / np.sqrt(1 + (f / 5000) ** 2), rng)
    up = np.arange(n) / n
    return fade(a * (0.25 + 0.75 * up) + gust * 0.25 * up**2, 0.8, 0.01)


@bed("shepard_rise", "shaft", "The same rising tone as a bed, made for this piece: it rises for ever. Keep it under the wind; slow `rate` for the slowed moment.", 0.1, "dry")
def _shepard_bed(rng):
    T = 12.0
    n = int(T * SR)
    # four staggered copies of the 12 s cycle are unnecessary: the octaves themselves hand over
    return _shepard(n, T, rng)


@shot("stop_thud", "shaft elevator beam", "A huge dead stop, made for this piece: one blow far below hearing with a dull body and no splash. Cut everything else on it.", 0.8, "dry")
def _stop(rng):
    n = int(2.6 * SR)
    t = np.arange(n) / SR
    f = 26 + 130 * np.exp(-t / 0.035)
    sub = np.sin(TAU * np.cumsum(f) / SR) * np.exp(-t / 0.55)
    body = lp(rng.standard_normal(n), 420) * np.exp(-t / 0.05) * 1.6
    mid = bp(rng.standard_normal(n), 900, 2400) * np.exp(-t / 0.008) * 0.5
    return fade(sub + body + mid, 0.0005, 0.6)


# ---------------------------------------------------------------- made for this piece: the tune

_D, _E, _F, _G, _Gs, _A, _Bb, _C, _Dh = 0, 150, 300, 500, 610, 700, 800, 1000, 1200
_D4, _E4, _F4, _G4, _A4 = _D - 1200, _E - 1200, _F - 1200, _G - 1200, _A - 1200
_G3, _A3, _Bb3, _C4 = _G - 2400, _A - 2400, _Bb - 2400, _C - 2400
_Cl = _C - 1200
# the lullaby the walk's music box plays (config/audio.config.ts), bar by bar: melody [cents, beats], and under it [cents, on which beat]
_SCORE = [
    ([(_A, 1), (_F, 0.5), (_E, 0.5), (_F, 1)], [(_D4, 0), (_A4, 2)]),
    ([(_E, 1.5), (_D, 0.5), (_E, 1)], [(_C4, 0), (_G4, 2)]),
    ([(_F, 1), (_G, 0.5), (_F, 0.5), (_E, 1)], [(_Bb3, 0), (_F4, 2)]),
    ([(_D, 2), (_Cl, 1)], [(_A3, 0)]),
    ([(_A, 1), (_F, 0.5), (_E, 0.5), (_F, 1)], [(_D4, 0), (_A4, 2)]),
    ([(_Bb, 1.5), (_A, 0.5), (_G, 1)], [(_G3, 0), (_D4, 2)]),
    ([(_A, 1), (_Gs, 0.5), (_F, 0.5), (_E, 1)], [(_A3, 0), (_E4, 2)]),
    ([(_D, 3)], [(_D4, 0), (_A4, 1), (_D, 2)]),
    ([(_Dh, 1), (_C, 0.5), (_Bb, 0.5), (_A, 1)], [(_Bb3, 0), (_F4, 2)]),
    ([(_Bb, 1), (_A, 0.5), (_G, 0.5), (_F, 1)], [(_G3, 0), (_D4, 2)]),
    ([(_G, 1.5), (_F, 0.5), (_E, 1)], [(_C4, 0), (_G4, 2)]),
    ([(_F, 1), (_Gs, 1), (_A, 1)], [(_A3, 0), (_E4, 2)]),
]
_TONIC = 587.33


def _tine(hz, at, level, dead, rng, bright=1.0):
    decay = (0.16 if dead else 0.82) * (440 / hz) ** 0.35
    n = int(decay * 5 * SR)
    t = np.arange(n) / SR
    now = at + t
    wow = 0.0095 * (np.sin(now * 1.45) * 0.6 + np.sin(now * 3.83 + 1.3) * 0.4)
    vib = 0.0028 * np.minimum(1, t * 3) * np.sin(t * 4.4 * TAU)
    phase = np.cumsum(hz * (1 + wow + vib) / SR * TAU)
    v = np.exp(-t / decay) * (np.sin(phase + 1.5 * np.exp(-t / 0.05) * np.sin(phase * 3.01)) + 0.38 * np.sin(phase * 1.0037))
    for ratio, amp, d in [(5.43, 0.26 * bright, 0.2), (13.3, 0.07 * bright, 0.04)]:
        if hz * ratio < SR * 0.45:
            v += amp * np.exp(-t / d) * np.sin(phase * ratio)
    v += 0.1 * bright * np.exp(-t / 0.002) * rng.standard_normal(n)
    return level * np.minimum(1, t / 0.0008) * v


def _catch(rng, level=0.16):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    return level * np.exp(-t / 0.03) * (np.sin(TAU * 300 * t) + 0.4 * rng.standard_normal(n))


def _music_box(rng, bars, stop_note, beat=0.5, bend=0.0, slow=1.0, bright=1.0, ring=0.62, ring_out=2.8):
    """Plays the given bars of the lullaby and stops on the note it stops on: half a phrase, and then its cylinder catches."""
    notes = []
    at = 0.05
    last = at
    tines = {}
    done = False
    for k, b in enumerate(bars):
        melody, under = _SCORE[b]
        stretch = 1 + (slow - 1) * (k / max(1, len(bars) - 1)) ** 2
        beat_now = beat * stretch
        for cents, on in under:
            notes.append((at + on * beat_now + (0 if on == 0 else 0.05 * beat_now * rng.uniform(-1, 1)), cents, 0.58 if on == 0 else 0.34))
        place_ = 0.0
        for i, (cents, length) in enumerate(melody):
            t_ = at + place_ * beat_now + (0 if place_ == 0 else 0.05 * beat_now * rng.uniform(-1, 1))
            notes.append((t_, cents, 1.0))
            last = t_
            if k == len(bars) - 1 and i == stop_note:
                done = True
                break
            place_ += length
        if done:
            break
        at += 3 * beat_now
    heard = [n for n in notes if n[0] <= last + 1e-3]
    tape = Tape(last + ring_out + 0.2)
    for t_, cents, level in heard:
        off = tines.setdefault(cents, 13 * rng.uniform(-1, 1))
        dead = cents in (_G, _G4)
        tape.put(_tine(_TONIC * 2 ** ((cents + off + bend) / 1200), t_, level, dead, rng, bright), t_, 1.0)
    tape.put(_catch(rng), last + ring)
    return tape.x


@shot("music_box_half_1", "dolls", "The music box, made for this piece: the piece's own lullaby, two bars and one note, then its cylinder catches. It never gets further. Your main one: play it, leave a silence, play it again.", 0.36, "reverb 0.25; low-pass 5000 when it comes from behind")
def _mb1(rng):
    return fade(_music_box(rng, [0, 1, 2], 0), 0.001, 0.3)


@shot("music_box_half_2", "dolls", "The same box further on, made for this piece: it climbs, and stops on the wrong note, the raised fourth. For when they are nearer.", 0.36, "reverb 0.25")
def _mb2(rng):
    return fade(_music_box(rng, [4, 5, 6], 1), 0.001, 0.3)


@shot("music_box_half_3", "dolls", "The high part of the same tune, made for this piece: stops after one and a half bars.", 0.36, "reverb 0.25")
def _mb3(rng):
    return fade(_music_box(rng, [8, 9], 1), 0.001, 0.3)


@shot("music_box_slowing", "dolls", "The box running out of spring, made for this piece: the opening bars dragging apart and a little flat. For the last time before the doll.", 0.36, "reverb 0.25")
def _mb4(rng):
    return fade(_music_box(rng, [0, 1, 2], 0, beat=0.62, bend=-22, slow=1.9), 0.001, 0.3)


@shot("music_box_jaw", "dolls", "The tune at arm's length, from inside the doll's jaw, made for this piece: comb and pins loud and dry, stopping halfway. For 46.", 0.5, "dry")
def _mb5(rng):
    x = _music_box(rng, [0, 1, 2], 2, beat=0.56, bright=2.4, ring=0.4, ring_out=2.0)
    box = bell(x, 700, 5, 1.2)
    return fade(box, 0.001, 0.2)


@shot("music_box_wind", "dolls", "A small key being wound, made for this piece: a dry ratchet, about two seconds. It can come from where nobody is standing.", 0.2, "reverb 0.2")
def _mb_wind(rng):
    tape = Tape(2.2)
    t_ = 0.02
    while t_ < 1.95:
        n = int(0.03 * SR)
        s = np.arange(n) / SR
        c = rng.standard_normal(n) * np.exp(-s / 0.0016) + 0.5 * np.sin(TAU * 1400 * s) * np.exp(-s / 0.004) + 0.3 * np.sin(TAU * 610 * s) * np.exp(-s / 0.008)
        tape.put(c, t_, rng.uniform(0.55, 1.0))
        t_ += 0.046 + 0.02 * np.sin(t_ * 6.0) + rng.uniform(-0.006, 0.006)
    return hp(tape.x, 300)


# ---------------------------------------------------------------- made for this piece: the lift's tune


def _vibes(hz, seconds_, rng):
    n = int((seconds_ + 0.7) * SR)
    t = np.arange(n) / SR
    e = np.exp(-t / 0.8) * np.minimum(1, t / 0.002)
    y = (np.sin(TAU * hz * t) + 0.3 * np.sin(TAU * 4 * hz * t) * np.exp(-t / 0.12) + 0.12 * np.sin(TAU * 10 * hz * t) * np.exp(-t / 0.025)) * e
    return fade(y * (1 + 0.22 * np.sin(TAU * 5.2 * t)), 0.0, 0.25)


def _epiano(cents, seconds_):
    n = int((seconds_ + 0.2) * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for c in cents:
        hz = 293.66 * 2 ** (c / 1200)
        y += (np.sin(TAU * hz * t) + 0.3 * np.sin(TAU * 2 * hz * t) * np.exp(-t / 0.3)) * np.exp(-t / 0.9)
    return y * np.minimum(1, t / 0.005) * np.minimum(1, (n / SR - t) / 0.08)


def _lift_phrase(rng):
    # the lullaby again, brought into the major and made polite: it stops on the E before the D, every time
    beat = 0.40
    melody = [
        [(700, 1), (400, 0.5), (200, 0.5), (400, 1)], [(200, 1.5), (0, 0.5), (200, 1)], [(400, 1), (500, 0.5), (400, 0.5), (200, 1)], [(0, 2), (-100, 1)],
        [(700, 1), (400, 0.5), (200, 0.5), (400, 1)], [(900, 1.5), (700, 0.5), (500, 1)], [(700, 1), (600, 0.5), (400, 0.5), (200, 1)],
    ]
    chords = [[0, 400, 700], [-500, -100, 200], [-700, -300, 0], [-500, -100, 200, 500], [0, 400, 700], [-700, -300, 0], [-500, -100, 200, 500]]
    bass = [-1200, -1700, -1900, -1700, -1200, -1900, -1700]
    stop_at = beat * 3 * 6 + beat * 2  # the last note of bar seven starts here
    tape = Tape(stop_at + beat * 0.86)
    for b, bar in enumerate(melody):
        at = b * 3 * beat
        p = 0.0
        for cents, length in bar:
            tape.put(_vibes(587.33 * 2 ** (cents / 1200), length * beat, rng), at + p * beat + rng.uniform(-0.004, 0.004), 0.8)
            p += length
        hz = 293.66 * 2 ** (bass[b] / 1200)
        pluck = sum(a_ * tone(hz * h, beat * 0.9, 0.3 / h, attack=0.004) for h, a_ in ((1, 1.0), (2, 0.7), (3, 0.5), (4, 0.25)))
        tape.put(fade(pluck, 0.0, 0.06) * 0.35, at, 1.0)
        for k in (1, 2):
            tape.put(_epiano(chords[b], beat * 0.7), at + k * beat, 0.12)
        for k in (0, 1, 2):
            n = int(0.06 * SR)
            tape.put(hp(rng.standard_normal(n), 4000) * np.exp(-np.arange(n) / SR / 0.012), at + k * beat, 0.05 if k else 0.08)
    x = tape.x
    wow = 1 + 0.004 * np.sin(TAU * 0.9 * np.arange(len(x)) / SR) + 0.0015 * np.sin(TAU * 6.1 * np.arange(len(x)) / SR)
    x = warp(x, wow)
    x = bp(x, 340, 3400, order=3)
    x = np.tanh(x / max(peak(x), 1e-9) * 1.8)
    return x


@bed("lift_tune_loop", "elevator", "The lift's tinny tune from a small ceiling speaker, as a bed, made for this piece: it stops mid-phrase, a second and a half of speaker hiss, and it starts again, for ever. Start it with `offset: 0`; at 24 stop it with `stop(0.02)`: it dies mid-note.", 0.2, "dry", kbps=96)
def _lift_bed(rng):
    p = fade(_lift_phrase(rng), 0.002, 0.003)
    T = p.shape[-1] / SR + 1.5
    tape = Tape(T, wrap=True)
    tape.put(p)
    hiss = noise_loop(tape.n, lambda f: np.exp(-(((f - 1800) / 1500) ** 2)), rng) * 0.0035
    return tape.x + hiss


# ---------------------------------------------------------------- made for this piece: the fairground organ


def _reed_table(harmonics):
    n = 4096
    k = np.arange(1, harmonics + 1)
    amp = 1 / k**0.85 * (1 + 0.9 * np.exp(-(((k - 6) / 3.0) ** 2)))
    phase = np.linspace(0, TAU, n, endpoint=False)
    y = np.zeros(n)
    for a, h in zip(amp, k):
        y += a * np.sin(h * phase + h * h * 0.31)
    return y / np.abs(y).max()


_REEDS = {h: _reed_table(h) for h in (3, 6, 12, 24, 48, 96)}


def _reed(hz, seconds_, rng, level=1.0, tremolo=0.06):
    """One note of a tired reed rank: three pipes that do not agree, a bellows that sags, an attack with air in it."""
    n = int((seconds_ + 0.12) * SR)
    t = np.arange(n) / SR
    sag = 1 - 0.006 * (1 - np.exp(-t / 0.35)) + 0.002 * np.sin(TAU * 0.7 * t + rng.uniform(0, TAU))
    y = np.zeros(n)
    grid = np.linspace(0, 1, 4096, endpoint=False)
    for detune, amp, oct_ in [(rng.uniform(-22, 22), 0.6, 1), (rng.uniform(-30, 30), 0.5, 1), (rng.uniform(-14, 14), 0.25, 2)]:
        f = hz * oct_ * 2 ** (detune / 1200) * sag
        # only as many overtones as fit under half the sample rate: the rest would fold back as noise
        limit = (SR * 0.45) / np.max(f)
        table = _REEDS[max(h for h in _REEDS if h <= max(limit, 3))]
        ph = np.cumsum(f / SR) + rng.uniform(0, 1)
        y += amp * np.interp(ph % 1.0, grid, table)
    env = np.minimum(1, t / 0.03) * np.minimum(1, (n / SR - t) / 0.09) ** 2
    y = y * env * (1 + tremolo * np.sin(TAU * 5.6 * t + rng.uniform(0, TAU)))
    chiff = hp(rng.standard_normal(n), 1800) * np.exp(-t / 0.018) * 0.12
    return level * (y + chiff)


def _organ_loop(rng):
    """Seven bars of the lullaby as a band organ would play them, never reaching the cadence; recorded at speed, for slowing down later."""
    beat = 0.62
    T = 7 * 3 * beat
    tape = Tape(T, wrap=True)
    chords = [[0, 700, 1200], [-200, 500, 1000], [-400, 300, 800], [-500, 200, 700], [0, 700, 1200], [-700, 0, 500], [-500, 200, 700]]
    for b in range(7):
        melody, under = _SCORE[b]
        at = b * 3 * beat
        p = 0.0
        for cents, length in melody:
            hz = _TONIC * 2 ** ((cents - 0) / 1200)
            tape.put(_reed(hz, length * beat * 0.94, rng, 0.9), at + p * beat + rng.uniform(-0.012, 0.012))
            p += length
        root = 146.83 * 2 ** ((under[0][0] + 1200) / 1200)
        tape.put(_reed(root, beat * 0.72, rng, 1.0, 0.03), at)
        for k in (1, 2):
            for c in chords[b]:
                tape.put(_reed(293.66 * 2 ** (c / 1200), beat * 0.46, rng, 0.3, 0.03), at + k * beat + rng.uniform(-0.01, 0.01))
        # the machine's own drum and its clack
        n = int(0.3 * SR)
        s = np.arange(n) / SR
        tape.put(np.sin(TAU * (58 * s + 2 * np.exp(-s / 0.02))) * np.exp(-s / 0.09), at, 0.9)
        for k in (1, 2):
            tape.put(bp(rng.standard_normal(n), 1400, 5200) * np.exp(-s / 0.022), at + k * beat, 0.22)
    return tape.x


_ORGAN = {}


def _organ_slowed(rng):
    if "x" not in _ORGAN:
        y = bp(_organ_loop(rng), 90, 5600, order=2, periodic=True)
        y = speed(y, 0.5, periodic=True)
        _ORGAN["x"] = y / peak(y)
    return _ORGAN["x"]


@bed("fairground_organ_slow", "party", "A band organ on a tired record, made for this piece: the lullaby as a waltz, every pipe out of tune, at half speed and an octave down. Seven bars that never reach their cadence. Start with `offset: 0` at 2 s.", 0.3, "reverb 0.2; low-pass 3500 for the record's dullness")
def _organ_bed(rng):
    return _organ_slowed(np.random.default_rng(4242))


@shot("organ_run_down", "party", "The record running down, made for this piece: the organ sagging to a stop over six seconds. At 40, stop the bed and fire this with the last candle.", 0.32, "reverb 0.2")
def _organ_down(rng):
    x = _organ_slowed(np.random.default_rng(4242))
    n = int(7.0 * SR)
    u = np.arange(n) / n
    rates = (1 - u) ** 1.4
    y = warp(np.tile(x, 2), rates)
    y = lp(y, 4200)
    return fade(y, 0.002, 0.6)


@bed("record_crackle", "party", "A record's surface, made for this piece: slow scratch ticks once per turn over dust and hiss, and a low rumble of the platter. Keep it going under the organ and after it stops.", 0.14, "dry")
def _crackle(rng):
    turn = 1.8
    T = turn * 8
    tape = Tape(T, wrap=True)
    n = tape.n
    for _ in range(int(T * 26)):
        k = int(rng.uniform(0.0002, 0.0012) * SR) + 2
        s = rng.standard_normal(k) * np.exp(-np.arange(k) / max(1, k / 4))
        tape.put(s, rng.uniform(0, T), rng.lognormal(-3.6, 0.8))
    for i in range(8):
        k = int(0.004 * SR)
        s = rng.standard_normal(k) * np.exp(-np.arange(k) / (k / 3))
        tape.put(s, i * turn + 0.31, 0.3)
    x = bp(tape.x, 700, 9000, order=2, periodic=True)
    hiss = noise_loop(n, lambda f: pink_gain(f, 200) * np.exp(-(((np.log2(np.maximum(f, 1)) - 11.3) / 2.6) ** 2)), rng) * 0.012
    rumble = noise_loop(n, lambda f: np.exp(-(((f - 48) / 22) ** 2)), rng) * 0.018
    groove = 0.006 * np.sin(TAU * (1 / turn) * np.arange(n) / SR * 1)
    return x + hiss + rumble * (1 + groove * 40)


# ---------------------------------------------------------------- the last fears: helpers


def even_loop(x, smooth=0.5, amount=0.7):
    """A loop's slow swells taken down, worked out round the loop so that it stays one."""
    power = np.maximum(filt(np.square(mono(x)), lambda f: np.exp(-np.square(f * smooth)), periodic=True), 1e-12)
    return x * (np.mean(power) / power) ** (0.5 * amount)


def moving(x, points):
    """Mono to stereo with its place moving: [(seconds, place -1..1), ...], equal power."""
    t = np.arange(x.shape[-1]) / SR
    a = (np.interp(t, [p[0] for p in points], [p[1] for p in points]) + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)])


# ---------------------------------------------------------------- dogs

# the Labrador's growls without the breaths between them, in seconds of the recording
_GROWLS = [(4.02, 5.72), (6.94, 8.92), (10.54, 12.08), (13.58, 15.36), (16.88, 18.56), (20.18, 21.3), (34.12, 35.86), (37.38, 38.44), (39.7, 40.92)]


def _growl_line(length, rng, rate=0.92, overlap=0.28, wrap=False):
    """One growl that does not stop: the takes end to end over each other's edges, all at one level."""
    x = hp(rec(868756, 0.0, 41.0), 45)
    tape = Tape(length, wrap=wrap)
    at = 0.0
    order = []
    while at < length:
        order = order or rng.permutation(len(_GROWLS)).tolist()
        a, b = _GROWLS[order.pop()]
        take = speed(to_rms(x[int(a * SR) : int(b * SR)]), rate * rng.uniform(0.97, 1.03))
        tape.put(fade(take, overlap * 0.6, overlap), at)
        at += take.shape[-1] / SR - overlap
    return tape.x


@bed("dog_growl_close", "busstop", "A dog's low growl, close and continuous, no bark in it and no breath: a Labrador recorded close up, slowed a little, its growls run together, with a second lower chest under it. It never rises and never stops. Under `sodium_lamp_buzz` from the first second.", 0.22, "dry; low-pass 1500 from across the road")
def _growl_bed(rng):
    a = _growl_line(20.0, rng, wrap=True)
    b = _growl_line(20.0, rng, rate=0.84, wrap=True)
    return even_loop(a + 0.45 * b, 0.6, 0.7)


@shot("dog_growl_nearer", "busstop", "The same growl coming nearer: dull and far at first, the whole chest of it after five and a half seconds, and it stays for two more. Fire it at 8 to have it behind you at 13.5.", 0.6, "dry")
def _growl_near(rng):
    x = _growl_line(7.6, rng) + 0.45 * _growl_line(7.6, rng, rate=0.84)
    t = np.arange(x.shape[-1]) / SR
    u = np.minimum(1.0, t / 5.5)
    u = u * u * (3 - 2 * u)
    y = lp(x, 420) * (1 - u) + x * u
    y = y + room_verb(y, t60=1.2, wet=1.0, dark=1200)[: y.shape[-1]] * (1 - u) * 0.5
    return fade(y * from_db(-24 + 24 * u), 0.002, 0.25)


@bed("dogs_pack_far", "busstop washing", "A pack barking at night a long way off, outdoors: the many dogs of a distant village, in bursts and long calls, with their echo, and none of them near. The loud bursts are held down so that it stays far.", 0.18, "dry; low-pass 2500 to take it further", kbps=112)
def _pack_far(rng):
    x = lp(hp(rec(705299, 11.2, 37.2, "stereo"), 220), 6500, order=2)
    return seam(compress(x, -34.0, 3.0, attack=0.03, release=0.5), 2.5)


cut("dogs_howl_far", "busstop washing", "One far howl, long and thin, alone for nearly three seconds; then others take it up, and by six seconds a few of them are howling over each other with the slap of a building behind them. Sled dogs a long way off. Stop it dead when they should stop.", 0.3, "reverb 0.3", 450177, 191.7, 204.8, hp_hz=220, lp_hz=5000, ch="stereo", fades=(0.01, 1.2), kbps=112)


# ---------------------------------------------------------------- rats

_CLAW_RATES = (1.3, 1.65, 2.05)
_RUNS = [(1.2, 5.5), (5.9, 9.8), (11.9, 13.8), (15.2, 20.0), (20.5, 25.0)]  # the dog's claws on bare wood, in seconds of the recording
_PAW_RUNS = [(5.0, 6.8), (7.0, 8.9), (9.0, 11.4), (11.8, 13.4), (14.0, 15.6), (16.2, 18.0)]  # the fingertips on the desk, likewise


def _claw_bank():
    """Single claws set down, cut from a clean foley take and raised to the size of a rat: near, and dulled for far."""
    x = hp(rec(569255, 20.0, 38.0), 500)
    near, far = [], []
    for i, j in find_hits(x, 30, before=0.001, after=0.045, min_gap=0.1):
        t = fade(x[i:j], 0.0005, 0.012)
        t = t / peak(t)
        for r in _CLAW_RATES:
            s = speed(t, r)
            near.append(s)
            far.append(lp(s, 2400, order=2))
    return near, far


def _skitter():
    """A dog's claws skittering on a bare wood floor, its weight taken out."""
    x = hp(rec(199919, 1.2, 25.0), 900)
    return [x[int((a - 1.2) * SR) : int((b - 1.2) * SR)] for a, b in _RUNS]


def _paws():
    """Fingertips running on a wooden desk: the soft weight of the feet under the claws."""
    x = hp(rec(785302, 5.0, 38.0), 260)
    return [x[int((a - 5.0) * SR) : int((b - 5.0) * SR)] for a, b in _PAW_RUNS]


def _one_rat(tape, rng, near, far, at, length, level, p0, p1):
    """One animal crossing: a gallop of ticks in pairs, loudest as it goes by."""
    t = at
    stride = rng.uniform(0.1, 0.15)
    bank = near if level > 0.45 else far
    while t < at + length:
        u = (t - at) / length
        here = level * np.sin(np.pi * min(u, 1.0)) ** 1.4
        pan = p0 + (p1 - p0) * u
        for off in (0.0, 0.016, stride * 0.5, stride * 0.5 + 0.02):
            tape.put(bank[int(rng.integers(len(bank)))], t + off + rng.uniform(-0.004, 0.004), here * rng.uniform(0.35, 1.0), float(np.clip(pan + rng.uniform(-0.08, 0.08), -1, 1)))
        t += stride * rng.uniform(0.85, 1.15)


def _one_run(tape, rng, runs, at, length, level, p0, p1):
    """A stretch of a run sped up and sliding across, under the ticks."""
    run = runs[int(rng.integers(len(runs)))]
    r = rng.uniform(1.6, 2.1)
    n = min(run.shape[-1] - 1, int(length * r * SR))
    a = int(rng.integers(0, run.shape[-1] - n))
    s = speed(run[a : a + n], r)
    s = fade(s / max(peak(s), 1e-9), length * 0.3, length * 0.4)
    tape.put(moving(s, [(0.0, p0), (s.shape[-1] / SR, p1)]), at, level)


@bed("rats_claws", "chase corridor", "Rats running by over wood and stone, many of them: quick small claws in pairs, near ones over far ones, crossing both ears all the time, with the soft patter of their feet under it. No squeals. Foley, no rat: a dog's claws on a bare floor sped up, claw foley raised to the size of a rat, fingertips on a desk.", 0.3, "dry; low-pass 2500 behind a wainscot", kbps=112)
def _rats_bed(rng):
    near, far = _claw_bank()
    runs = _skitter()
    paws = _paws()
    length = 16.0
    tape = Tape(length, channels=2, wrap=True)
    count = 26
    for k in range(count):
        side = rng.choice((-1.0, 1.0))
        _one_rat(tape, rng, near, far, (k + rng.uniform(0, 1)) * length / count, rng.uniform(1.0, 2.2), rng.uniform(0.15, 1.0) ** 2, side * rng.uniform(0.3, 1.0), -side * rng.uniform(0.3, 1.0))
    count = 20
    for k in range(count):
        side = rng.choice((-1.0, 1.0))
        _one_run(tape, rng, runs, (k + rng.uniform(0, 1)) * length / count, rng.uniform(0.8, 1.6), rng.uniform(0.08, 0.22), side * rng.uniform(0.2, 1.0), -side * rng.uniform(0.2, 1.0))
    count = 12
    for k in range(count):
        side = rng.choice((-1.0, 1.0))
        _one_run(tape, rng, paws, (k + rng.uniform(0, 1)) * length / count, rng.uniform(1.0, 2.0), rng.uniform(0.12, 0.3), side * rng.uniform(0.2, 0.9), -side * rng.uniform(0.2, 0.9))
    return even_loop(tape.x, 0.5, 0.6)


def _rats_pass(rng, length, count, p0, p1, width=0.25):
    near, far = _claw_bank()
    runs = _skitter()
    paws = _paws()
    tape = Tape(length, channels=2)
    for k in range(count):
        at = (k + rng.uniform(0, 1)) * length * 0.5 / count
        _one_rat(tape, rng, near, far, at, rng.uniform(length * 0.4, length * 0.5), rng.uniform(0.25, 1.0) ** 1.5, float(np.clip(p0 + rng.uniform(-width, width), -1, 1)), float(np.clip(p1 + rng.uniform(-width, width), -1, 1)))
    for k in range(count // 2):
        at = (k + rng.uniform(0, 1)) * length * 0.55 / (count // 2)
        _one_run(tape, rng, runs, at, rng.uniform(0.7, 1.4), rng.uniform(0.08, 0.2), p0, p1)
        _one_run(tape, rng, paws, at, rng.uniform(0.9, 1.6), rng.uniform(0.12, 0.28), p0, p1)
    return fade(tape.x, 0.01, 0.1)


@shot("rats_pass_1", "chase corridor", "A few rats running past, left to right, three seconds. Foley, like `rats_claws`.", 0.45, "dry", kbps=112)
def _rats1(rng):
    return _rats_pass(rng, 3.0, 9, -0.9, 0.9)


@shot("rats_pass_2", "chase corridor", "More of them, right to left, four seconds, the bulk in the middle.", 0.45, "dry", kbps=112)
def _rats2(rng):
    return _rats_pass(rng, 4.0, 16, 0.9, -0.9)


@shot("rats_pass_3", "chase corridor", "A stream of them over your feet from behind and on ahead: all round the head at first, dulling as it runs away from you. Five seconds.", 0.5, "dry", kbps=112)
def _rats3(rng):
    x = _rats_pass(rng, 5.0, 22, 0.0, 0.0, width=0.95)
    u = np.minimum(1, np.arange(x.shape[-1]) / SR / 5.0) ** 2
    return x * (1 - u) + lp(x, 1800, order=2) * u


cut("rat_squeal_1", "chase corridor", "A real rat's sharp squeak, close: a tone at about 2 kHz with a rough edge, a fifth of a second.", 0.3, "reverb 0.2", 143125, 7.33, 7.56, hp_hz=700, rate=0.92, fades=(0.002, 0.03))
cut("rat_squeal_2", "chase corridor", "Another, lower and more upset.", 0.3, "reverb 0.2", 143125, 7.82, 8.06, hp_hz=700, rate=0.85, fades=(0.002, 0.03))
cut("rat_squeal_3", "chase corridor", "Another, higher and shorter.", 0.3, "reverb 0.2", 143125, 8.52, 8.7, hp_hz=700, fades=(0.002, 0.03))
cut("rat_squeal_4", "chase corridor", "Two squeaks close together, one rat running over another.", 0.3, "reverb 0.2", 143125, 9.3, 10.0, hp_hz=700, rate=0.92, fades=(0.002, 0.03))
cut("rat_chirp_far_1", "corridor chase", "Mice under a real floor: one thin high chirp around 6 kHz, and nothing else. For behind the wainscot.", 0.2, "reverb 0.3", 727114, 1.42, 1.8, hp_hz=3200, fades=(0.002, 0.05))
cut("rat_chirp_far_3", "corridor chase", "Two chirps close together from under the floor.", 0.2, "reverb 0.3", 727114, 4.32, 5.2, hp_hz=3200, fades=(0.002, 0.05))


# ---------------------------------------------------------------- fire


@bed("fire_behind_door", "corridor shaft", "A room burning behind a door: the low flutter of a big fire with a soft crackle in it, nothing standing out. A fireplace's rumble, a stove heard through its closed door and a brush fire's crackle with the snaps held down, dulled as a door dulls them. For a door that gives, raise it and open `lowpass`.", 0.3, "dry; low-pass 1200 for a heavier door", kbps=112)
def _fire_door(rng):
    flutter = hp(rec(794817, 12.0, 36.0, "stereo"), 35)
    stove = hp(rec(611001, 1.5, 25.5, "stereo"), 35)
    crackle = hp(rec(755366, 4.0, 28.0), 500)
    crackle = compress(crackle, db(rms(crackle)) + 4.0, 6.0, attack=0.001, release=0.05)
    n = min(flutter.shape[-1], stove.shape[-1], crackle.shape[-1])
    x = flutter[..., :n] / rms(flutter) + stove[..., :n] / rms(stove) * 0.9 + stereo(crackle[..., :n]) / rms(crackle) * 0.3
    return seam(lp(x, 2800, order=2), 2.5)


@shot("fire_roar_by", "shaft corridor", "One burst of fire going by as a roar: a real torch swung past a microphone, slowed to the size of a whole floor, with a flame thrower and a crackle falling in pitch across it. It swells in under a second and is gone by four, left ear to right.", 0.6, "dry; already wide", kbps=128)
def _fire_roar(rng):
    swing = hp(speed(rec(647220, 16.55, 18.1), 0.38), 30)
    n = swing.shape[-1]
    env = np.sin(np.pi * np.arange(n) / n) ** 2
    flame = warp(rec(563138, 0.3, 11.5), np.linspace(1.15, 0.72, n))
    low = warp(rec(794817, 20.0, 30.0), np.linspace(1.05, 0.8, n))
    crackle = hp(rec(755366, 10.0, 18.0), 600)
    m = min(n, flame.shape[-1], low.shape[-1], crackle.shape[-1])
    x = swing[:m] / peak(swing) + (flame[:m] / peak(flame) * 1.1 + low[:m] / peak(low) * 0.35 + crackle[:m] / peak(crackle) * 0.45) * env[:m]
    return fade(moving(x, [(0.0, -0.75), (m / SR * 0.42, 0.0), (m / SR, 0.75)]), 0.01, 0.5)


# ---------------------------------------------------------------- thunder


def _thunder(fid, a, b, tail):
    return fade(hp(lp(rec(fid, a, b, "stereo"), 1500, order=2), 26), 0.04, tail)


@shot("thunder_far_1", "beam", "Thunder from under the clouds, far below: a dull roll that opens in two seconds and goes on for twenty. Recorded dry from a roof: no rain, no crack, nothing above 1.5 kHz.", 0.45, "dry", kbps=80)
def _thunder1(rng):
    return _thunder(717845, 0.6, 21.2, 2.5)


@shot("thunder_far_2", "beam", "Another roll, slower to open, with a long grumbling middle and a long tail.", 0.45, "dry", kbps=80)
def _thunder2(rng):
    return _thunder(717845, 125.2, 146.0, 3.0)


@shot("thunder_far_3", "beam", "The longest: one low blow and then twenty-five seconds of it going away, down to nothing.", 0.45, "dry", kbps=80)
def _thunder3(rng):
    return _thunder(717845, 150.4, 176.8, 4.0)


@shot("thunder_far_4", "beam", "A rougher roll in several steps, heavier at the bottom, with a shorter tail.", 0.45, "dry", kbps=80)
def _thunder4(rng):
    return _thunder(577317, 25.6, 41.6, 3.0)


# ---------------------------------------------------------------- snakes


@bed("snakes_scales", "pool flood", "Dry scales sliding on hard ground, a great many: slow slides over each other from every side, each pushing and gliding at its own pace, and it never stops. Foley, no animal: a hairy rope through hands, a leash, a broom on concrete and old leather, slowed.", 0.25, "reverb 0.3 on tile", kbps=112)
def _scales(rng):
    rope = hp(rec(637809, 70.0, 118.0), 450)
    leash = hp(rec(624488, 0.0, 13.2), 150)
    broom = hp(rec(108276, 8.0, 28.0), 600)
    leather = hp(rec(399540, 8.0, 20.0), 1000)
    length = 18.0
    tape = Tape(length, channels=2, wrap=True)

    def slide(src, dur, r):
        n = min(src.shape[-1] - 1, int(dur * r * SR))
        a = int(rng.integers(0, src.shape[-1] - n))
        s = speed(src[a : a + n], r)
        # a body pushes and glides: each slide swells at its own slow pace
        push = 0.5 + 0.5 * np.sin(TAU * rng.uniform(0.7, 1.6) * np.arange(s.shape[-1]) / SR + rng.uniform(0, TAU))
        return fade(s / max(rms(s), 1e-9) * (0.25 + 0.75 * push), s.shape[-1] / SR * 0.3, s.shape[-1] / SR * 0.4)

    for src, count, level, rates, reach in ((rope, 12, 0.5, (0.5, 0.6), (3.0, 3.6)), (rope, 16, 1.0, (0.55, 0.8), (1.4, 3.2)), (leash, 12, 0.6, (0.6, 0.85), (1.4, 3.2)), (broom, 8, 0.3, (0.6, 0.8), (1.4, 3.2)), (leather, 9, 0.2, (0.7, 1.0), (1.4, 3.2))):
        for k in range(count):
            p = rng.uniform(-0.9, 0.9)
            s = slide(src, rng.uniform(*reach), rng.uniform(*rates))
            tape.put(moving(s, [(0.0, p), (s.shape[-1] / SR, float(np.clip(p + rng.uniform(-0.5, 0.5), -1, 1)))]), (k + rng.uniform(0, 1)) * length / count, level * rng.uniform(0.45, 1.0))
    return even_loop(lp(tape.x, 7000, order=2, periodic=True), 0.5, 0.4)


cut("snake_hiss_close", "pool flood", "A real snake right beside you, upset: one long hiss that swells for four seconds and is bitten off. The close one.", 0.35, "dry", 706977, 0.85, 6.14, hp_hz=900, fades=(0.02, 0.012))
cut("snake_hiss_2", "pool flood", "A shorter hiss, pulsing about four times a second, a little further off.", 0.3, "reverb 0.15", 540162, 0.85, 2.7, hp_hz=900, fades=(0.005, 0.15))
cut("snake_hiss_3", "pool flood", "A real hiss from across a room, three seconds. At the back of the many.", 0.25, "reverb 0.2", 706981, 94.8, 98.1, hp_hz=1500, rate=0.92, fades=(0.15, 0.05))


@bed("snakes_on_water", "pool flood", "The small wet sound of many thin bodies crossing a surface: tiny plinks and sips and a little swirl, no splash, from side to side. Foley, no animal: gentle movement in a tub of water, and a swimmer's small splashes sped up.", 0.35, "reverb 0.2", kbps=112)
def _on_water(rng):
    plinks = hp(rec(783808, 106.0, 113.5, "stereo"), 450)
    more = hp(rec(783808, 117.0, 126.0, "stereo"), 450)
    swirl = speed(hp(rec(637957, 5.0, 21.5, "stereo"), 500), 1.3)
    length = 18.0
    tape = Tape(length, channels=2, wrap=True)
    for src, count, level in ((plinks, 18, 1.0), (more, 18, 1.0), (swirl, 16, 0.3)):
        for k in range(count):
            n = min(src.shape[-1] - 1, int(rng.uniform(1.4, 3.0) * SR))
            a = int(rng.integers(0, src.shape[-1] - n))
            s = fade(src[..., a : a + n], 0.1, 0.25)
            tilt = rng.uniform(-0.6, 0.6)
            tape.put(s / max(rms(s), 1e-9) * np.array([[1 - tilt], [1 + tilt]]), (k + rng.uniform(0, 1)) * length / count, level * rng.uniform(0.5, 1.0))
    return tame_loop(even_loop(lp(tape.x, 10000, order=2, periodic=True), 0.5, 0.6), 12.0, 4.0)


family("snake_water", 4, "pool flood", "One thin wet touch on the surface: a finger flicked in water, a small sip with a few drops after it. For the one that swims straight at you, or scattered.", 0.3, "reverb 0.25", 470082, 20.0, 31.0, kind="hits", hp_hz=350, before=0.002, after=0.6, min_gap=0.7, fades=(0.001, 0.08))


# ---------------------------------------------------------------- the fridge, the hall, the hospital, the shaft


@bed("fridge_hum", "kitchen", "A fridge motor in a dark kitchen: a steady low hum on 49 Hz with thin overtones, brought down at the bottom so that small speakers hear it too. No rattle, no event.", 0.12, "dry; low-pass 700 from the next room")
def _fridge(rng):
    # the recording is its uploader's own loop: turned round, so that its one stumble (at 8.3 s) falls out
    x = np.concatenate([rec(556369, 8.7, 11.9), rec(556369, 0.0, 8.15)])
    return align_seam(bell(hp(x, 35), 49, -9.0, 0.3), 1.0)


loop("hall_vast", "album funeral", "A vast empty hall: moving low air, a very light hum, nothing else for a long way. Slow and wide, no voices. The album's bed; in the funeral, the building around the chairs.", 0.25, "reverb is in it already", 848923, 100.0, 126.0, xf=3.0, hp_hz=35, ch="stereo", kbps=112)


@bed("hospital_room_tone", "ward", "An empty hospital room: the ventilation of an exam room, with the bass of the building's far machines under it. No voices. Under all the monitors.", 0.3, "dry", kbps=112)
def _hospital(rng):
    vent = hp(rec(451922, 195.0, 219.0, "stereo"), 40)
    far = lp(hp(rec(451914, 60.0, 84.0, "stereo"), 30), 350)
    n = min(vent.shape[-1], far.shape[-1])
    return seam(vent[..., :n] / rms(vent) + far[..., :n] / rms(far) * 0.55, 2.0)


@bed("shaft_wind", "shaft", "Wind in a very deep shaft: a slow rumble with gusts, as heard from the bottom of a chimney, and a low moan moving about in it a long way up, with long stone tails.", 0.22, "dry", kbps=112)
def _shaft_wind(rng):
    deep = hp(rec(482288, 88.0, 114.0, "stereo"), 30)
    moan = speed(hp(rec(50596, 42.0, 59.0, "stereo"), 150), 0.66)
    n = min(deep.shape[-1], moan.shape[-1])
    x = deep[..., :n] / rms(deep) + moan[..., :n] / rms(moan) * 0.3
    y = x + room_verb(x, t60=3.5, wet=1.0, dark=900)[..., :n] * 0.6
    return seam(y, 3.0)


# ---------------------------------------------------------------- writing files

KEEP_PEAKS = {"clock_tick", "cutlery_far", "forks_close", "gurney_wheel", "heart_slow", "heart_fast", "relay_chatter", "lift_tune_loop", "ventilator", "run_feet", "run_feet_hard"}
# recordings with something synthesized laid under or over them
WITH_SYNTHESIS = {"clock_tick_once", "surface_close", "cable_snap", "heart_slow", "heart_fast", "heart_beat", "eye_blink_many", "phone_line_breath", "gurney_wheel"}
LOOP_PAD = 2304  # samples of its own other end a loop is encoded with on either side (two MP3 frames)


def _crc16(data):
    crc = 0
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def _patch_gapless(path, add_start, length):
    """Tells the LAME tag that all but `length` samples, starting add_start in, are padding, so that decoders drop them."""
    b = bytearray(open(path, "rb").read())
    i = b.find(b"Info")
    if i < 0:
        i = b.find(b"Xing")
    assert i >= 0, path
    flags = struct.unpack(">I", bytes(b[i + 4 : i + 8]))[0]
    j = i + 8 + (4 if flags & 1 else 0) + (4 if flags & 2 else 0) + (100 if flags & 4 else 0) + (4 if flags & 8 else 0)
    v = int.from_bytes(b[j + 21 : j + 24], "big")
    frames = struct.unpack(">I", bytes(b[i + 8 : i + 12]))[0]
    d = (v >> 12) + add_start
    # decoders keep frames * 1152 - delay - padding samples
    p = frames * 1152 - d - length
    assert flags & 1 and d < 4096 and 0 <= p < 4096, (path, d, p)
    b[j + 21 : j + 24] = ((d << 12) | p).to_bytes(3, "big")
    # the tag's own checksum covers the first 190 bytes of its frame
    frame = bytes(b).rfind(b"\xff", 0, i)
    while frame > 0 and not (b[frame + 1] & 0xE0 == 0xE0 and b[frame + 2 :].find(b"Info", 0, 40) >= 0):
        frame = bytes(b).rfind(b"\xff", 0, frame)
    crc = _crc16(bytes(b[frame : frame + 190]))
    b[frame + 190 : frame + 192] = crc.to_bytes(2, "big")
    with open(path, "wb") as f:
        f.write(b)


def encode(path, x, kbps, is_loop):
    channels = 1 if x.ndim == 1 else 2
    data = x
    if is_loop:
        data = np.concatenate([x[..., -LOOP_PAD:], x, x[..., :LOOP_PAD]], axis=-1)
    pcm = data.astype(np.float32) if channels == 1 else data.T.astype(np.float32)
    tmp = path + ".tmp.mp3"
    p = subprocess.run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", str(SR), "-ac", str(channels), "-i", "pipe:0",
         "-c:a", "libmp3lame", "-b:a", f"{kbps}k", "-compression_level", "2", "-id3v2_version", "0", "-map_metadata", "-1", tmp],
        input=pcm.tobytes(),
    )
    assert p.returncode == 0, path
    if is_loop:
        _patch_gapless(tmp, LOOP_PAD, x.shape[-1])
    os.replace(tmp, path)


def build(s):
    global _used
    _used = []
    rng = np.random.default_rng(zlib.crc32(s.name.encode()))
    x = s.fn(rng)
    if s.kind == "bed":
        # what is a texture and only has stray spikes must not be held down by them; what is made of events keeps its peaks
        if s.name not in KEEP_PEAKS and db(peak(x)) - db(rms(x)) > 22.0:
            x = tame_loop(x)
        x = to_rms(x, s.level)
        if peak(x) > from_db(-3.0):
            x = to_peak(x, -3.0)
    else:
        x = to_peak(fade(lead_off(x), 0.001, 0.002), s.level)
    kbps = s.kbps or (96 if x.ndim == 1 else 128)
    encode(os.path.join(OUT, s.name + ".mp3"), x, kbps, s.kind == "bed")
    s.used = list(_used)
    return x


def check():
    """Reads back what is on disk: level, length, and for a bed how much of a step its seam makes."""
    total = 0
    bad = 0
    names = sorted(SOUNDS)
    print(f"{'file':34s} {'kind':8s} {'sec':>7s} {'peak':>6s} {'rms':>6s} {'KiB':>6s} seam")
    for name in names:
        s = SOUNDS[name]
        path = os.path.join(OUT, name + ".mp3")
        if not os.path.exists(path):
            print(f"{name:34s} MISSING")
            bad += 1
            continue
        size = os.path.getsize(path)
        total += size
        y = decode_file(path)
        line = f"{name:34s} {s.kind:8s} {y.shape[1] / SR:7.2f} {db(peak(y)):6.1f} {db(rms(y)):6.1f} {size / 1024:6.0f}"
        if s.kind == "bed":
            m = y.mean(axis=0)
            d = np.abs(np.diff(m))
            step = abs(float(m[0] - m[-1]))
            typical = float(np.percentile(d, 99.9))
            around = np.concatenate([m[-2205:], m[:2205]])
            level = rms(around) / max(rms(m), 1e-9)
            line += f" step/typ {step / max(typical, 1e-9):5.2f}  level there {db(level):5.1f} dB"
            if step > 2.5 * typical:
                line += "  <-- SEAM"
                bad += 1
        print(line)
    print(f"total {len(names)} files, {total} bytes, {total / 1024 / 1024:.2f} MiB; {bad} problems")


# ---------------------------------------------------------------- the two documents


def _span_text(used):
    by = {}
    for fid, a, b in used:
        by.setdefault(fid, [])
        t = (round(a, 2), round(b, 2))
        if t not in by[fid]:
            by[fid].append(t)
    return by


def docs(where):
    """ROOM_SOUNDS.md (for whoever writes a room) and notices_sounds.md (rows for the manifest and courtesy credits)."""
    # who used what is only known after drawing: draw again without encoding when that was not done in this run
    missing = [s for s in SOUNDS.values() if not s.used and s.name not in _DRAWN]
    for s in missing:
        global _used
        _used = []
        s.fn(np.random.default_rng(zlib.crc32(s.name.encode())))
        s.used = list(_used)
        _DRAWN.add(s.name)
    rooms = {}
    for s in SOUNDS.values():
        for r in s.rooms:
            rooms.setdefault(r, []).append(s)
    order = [r for r in ROOM_ORDER if r in rooms] + sorted(set(rooms) - set(ROOM_ORDER))

    def row(s):
        path = os.path.join(OUT, s.name + ".mp3")
        y = decode_file(path) if os.path.exists(path) else np.zeros((2, 0))
        s.seconds = y.shape[1] / SR
        ch = "stereo" if float(np.abs(y[0] - y[1]).max() if y.size else 0) > 1e-5 else "mono"
        kind = s.kind + (", stereo" if ch == "stereo" else "")
        return f"| `rooms/{s.name}.mp3` | {kind} | {s.seconds:.1f} s | {s.desc} | {s.gain} | {s.fx} |"

    lines = [
        "# Sounds of the rooms",
        "",
        "Every file is in `public/audio/rooms/`; name it in `assets.sounds` as `rooms/x.mp3` and play it with `this.sound.play` (one-shot) or `this.sound.bed` (bed). Built by `scripts/build-room-audio.py`. "
        "One-shots peak at about -3 dBFS and start at once, so a beat lands on the sound. Beds have an RMS of about -24 dBFS (those made of separate events are lower: their peaks stop at -3 dBFS) and loop without a seam from any starting point; `bed` starts from a random place unless you give `offset`, and in the tunes you should give `offset: 0`. Files are dry unless the line says otherwise. "
        "Gain is a starting point for the `gain` option, chosen so that a bed sits low and an event reads over it. Nothing has been heard yet: all of it was judged by numbers and spectrograms, so trust your ears over these numbers. "
        "A bed fades in with `fade`, and any file can be pitched with `rate` (0.8 to 0.9 hides that a sound was used before), panned with `pan` and dulled with `lowpass`. Sounds of other rooms are all allowed: the rooms are only where each was meant to go.",
        "",
    ]
    for r in order:
        lines += [f"## {r}", "", "| File | Kind | Length | What it is, how to use it | Gain | Reverb, low-pass |", "| --- | --- | ---: | --- | ---: | --- |"]
        lines += [row(s) for s in sorted(rooms[r], key=lambda s: s.name)]
        lines.append("")
    with open(os.path.join(where, "ROOM_SOUNDS.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))

    rows = []
    total = 0
    courtesy = {}
    for s in sorted(SOUNDS.values(), key=lambda s: s.name):
        path = os.path.join(OUT, s.name + ".mp3")
        size = os.path.getsize(path) if os.path.exists(path) else 0
        total += size
        by = _span_text(s.used)
        if by:
            titles = "; ".join(f"{SOURCES[i][1]} ({SOURCES[i][0]})" for i in by)
            src = "Freesound " + ", ".join(str(i) for i in by)
            url = ", ".join(f"[freesound.org/s/{i}](https://freesound.org/s/{i}/)" for i in by)
            lic = "CC0" + (", with sound made for this piece" if s.name in WITH_SYNTHESIS else "")
            ver = "; ".join(
                f"HQ preview MP3 ([file](https://cdn.freesound.org/previews/{SOURCES[i][2]})), the original's " + ", ".join(f"{a:g}–{b:g} s" for a, b in spans)
                for i, spans in by.items()
            )
            ver += "; cut, filtered and re-encoded by `scripts/build-room-audio.py`"
            for i in by:
                if len(SOURCES[i]) > 3:
                    courtesy[i] = SOURCES[i]
        else:
            titles, src, url, lic = "Made for this piece", "Synthesized in `scripts/build-room-audio.py`", "–", "Made for this piece"
            ver = "Fixed random seed; no third-party material"
        rows.append(f"| `audio/rooms/{s.name}.mp3` | {titles} | {src} | {url} | {lic} | {ver} | {size / 1024:.0f} KiB | {s.desc} |")
    out = [
        "# Notices for the sounds of the rooms",
        "",
        "## For ASSET_MANIFEST.md, section Audio",
        "",
        f"### The rooms",
        "",
        f"Source: [Freesound](https://freesound.org), each sound under [CC0 1.0](http://creativecommons.org/publicdomain/zero/1.0/) (checked on each sound's own page, and on its uploader's profile for added terms, on {LICENCE_CHECKED}), and sound made for this piece. "
        "The files are cut from Freesound's public HQ MP3 previews; every cut, filter and synthesis is in `scripts/build-room-audio.py`. Every file is optional: a file that fails to load leaves silence.",
        "",
        "| Asset (file) | Source asset (author) | Source | URL | License | Version used | Size | Purpose in the piece |",
        "| --- | --- | --- | --- | --- | --- | ---: | --- |",
    ] + rows + [
        "",
        f"Total: {len(rows)} files, {total:,} bytes ({total / 1024 / 1024:.2f} MiB).",
        "",
        "## For THIRD_PARTY_NOTICES.md, section Courtesy credits for sounds (CC0)",
        "",
    ]
    if courtesy:
        out.append("Freesound uploaders who ask for or welcome a credit, in the rooms: " + "; ".join(f"{i} ({v[1]}, by {v[0]}: {v[3]})" for i, v in sorted(courtesy.items())) + ".")
    else:
        out.append("None of the recordings used in the rooms carries a request.")
    out += ["", COURTESY_NOTE, "", "## For ASSET_MANIFEST.md, Notes for the record", "", REJECTED_NOTE, ""]
    with open(os.path.join(where, "notices_sounds.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(out))


_DRAWN = set()
REJECTED_NOTE = (
    "Add to the rejected list, though their Freesound field says CC0: 353159, 370935, 656033, 670070 (Kinoton: each page says that using the sound is agreeing to a license agreement, "
    "and his profile's terms of use forbid making the raw files available to a third party); 646874 (Andron827: the profile adds a you may not, and contact me for commercial use). "
    "Unclear terms, so not used. "
    "Also read and turned down on the same reading: 842778 (cesar-gutierrez-99: the signature asks for a credit and says not for AI); 805676 (giddster: the profile asks to be credited, with a link); "
    "618352, 618353, 618354, 678673, 679047, 679048 (tferrino: each page says the raw file may not be put online or re-distributed); 122183 (qubodup: the signature points to CC BY requirements); "
    "196619 and 89448 (built from other people's sounds, not all named); 177007 (built partly from purchased effects); 398013 (recorded off a storm simulator)."
)


def main():
    ap = argparse.ArgumentParser(description="Builds public/audio/rooms from Freesound previews and from synthesis.")
    ap.add_argument("--only", help="comma separated names, or a prefix ending in *")
    ap.add_argument("--check", action="store_true", help="measure the files on disk")
    ap.add_argument("--docs", help="write ROOM_SOUNDS.md and notices_sounds.md into this folder")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if args.list:
        for s in SOUNDS.values():
            print(s.name, s.kind, ",".join(s.rooms))
        return
    if args.check:
        check()
        return
    if args.docs:
        docs(args.docs)
        return
    os.makedirs(OUT, exist_ok=True)
    names = list(SOUNDS)
    if args.only:
        wanted = args.only.split(",")
        names = [n for n in names if any(n == w or (w.endswith("*") and n.startswith(w[:-1])) for w in wanted)]
        unknown = [w for w in wanted if not w.endswith("*") and w not in SOUNDS]
        if unknown:
            raise SystemExit("unknown: " + ", ".join(unknown))
    t0 = time.time()
    failed = []
    for i, name in enumerate(names):
        s = SOUNDS[name]
        try:
            x = build(s)
        except Exception as exc:
            failed.append(f"{name}: {exc!r}")
            print(f"{i + 1:3d}/{len(names)} {name:34s} FAILED {exc!r}", flush=True)
            continue
        _DRAWN.add(name)
        print(f"{i + 1:3d}/{len(names)} {name:34s} {s.kind:8s} {x.shape[-1] / SR:6.2f} s  {'stereo' if x.ndim == 2 else 'mono':6s} peak {db(peak(x)):5.1f} rms {db(rms(x)):5.1f}", flush=True)
    print(f"built {len(names) - len(failed)} of {len(names)} in {time.time() - t0:.0f} s")
    if failed:
        raise SystemExit("failed: " + "; ".join(failed))


if __name__ == "__main__":
    main()
