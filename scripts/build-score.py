#!/usr/bin/env python3
"""
The score of the film: every cue is a row of CUES in this script, rendered offline and checked by measurement.

  python -I scripts/build-score.py                     render every cue, then measure each one
  python -I scripts/build-score.py --only theme_7,card render only these (a name may end in *)
  python -I scripts/build-score.py --out DIR           where the files go (default: a folder in the temp directory)
  python -I scripts/build-score.py --list              the cues
  python -I scripts/build-score.py --alt               also render the cues marked "alt" (other instruments, to compare)
  python -I scripts/build-score.py --selftest          the resampler, the loudness meter and the onset detector against known signals
  python -I scripts/build-score.py --musicbox-report   partials, decay and brightness of the music box candidates and of a real box

Needs numpy and imageio-ffmpeg (which brings its own ffmpeg: used to write MP3 and to read MP3 back).
Instruments are CC0 samples kept in .asset-cache/score (gitignored; see DOWNLOADS.json there) and one synthesised
music box. Nothing here was judged by ear: each render is followed by a table of expected against measured notes,
loudness (BS.1770), true peak, DC, energy above 16 kHz, stereo correlation and the silence after a cut.

To add a cue: add a row to CUES. A track names an instrument of INSTRUMENTS and lists notes as
(start in beats, length in beats, pitch, velocity 1..127[, options]); see the comment above CUES.
"""
import argparse
import glob
import json
import os
import struct
import subprocess
import sys
import tempfile
import time
import zlib

import numpy as np
import imageio_ffmpeg

SR = 44100
TAU = 2 * np.pi
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".asset-cache", "score")
# the piece's own recordings (public/audio), for the cues that are put together out of sounds rather than notes
AUDIO = os.path.join(ROOT, "public", "audio")
DEFAULT_OUT = os.path.join(tempfile.gettempdir(), "the_photo_score")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
KBPS = 128
PEAK_CEILING = -1.0  # dBTP, of the MP3 as decoded
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


# ---------------------------------------------------------------- small things


def db(v):
    return 20 * np.log10(np.maximum(v, 1e-12))


def from_db(d):
    return 10 ** (d / 20)


def midi_of(pitch):
    """'C#4' or 'Bb3' to a MIDI number (C4 = 60); a number is passed through."""
    if not isinstance(pitch, str):
        return float(pitch)
    letter, rest = pitch[0].upper(), pitch[1:]
    step = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[letter]
    while rest[0] in "#b":
        step += 1 if rest[0] == "#" else -1
        rest = rest[1:]
    return 12 * (int(rest) + 1) + step


def hz_of(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def name_of(hz):
    m = 69 + 12 * np.log2(hz / 440)
    k = int(round(m))
    return f"{NAMES[k % 12]}{k // 12 - 1}"


def cents(hz, ref):
    return 1200 * np.log2(hz / ref)


def fast_len(n):
    """The smallest 5-smooth number that is at least n: FFT sizes that stay fast."""
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


def filt(x, H):
    """A zero-phase filter by a real gain curve H(f), the ends padded by reflection."""
    n = x.shape[-1]
    pad = min(n - 1, SR // 4)
    z = np.pad(x, [(0, 0)] * (x.ndim - 1) + [(pad, pad)], mode="reflect") if pad > 0 else x
    m = fast_len(z.shape[-1])
    f = np.fft.rfftfreq(m, 1 / SR)
    return np.fft.irfft(np.fft.rfft(z, m, axis=-1) * H(f), m, axis=-1)[..., pad : pad + n]


def hp(x, hz, order=2):
    return filt(x, lambda f: 1 / np.sqrt(1 + (hz / np.maximum(f, 1e-3)) ** (2 * order)))


def lp(x, hz, order=2):
    return filt(x, lambda f: 1 / np.sqrt(1 + (f / hz) ** (2 * order)))


def conv(a, b):
    m = fast_len(len(a) + len(b))
    return np.fft.irfft(np.fft.rfft(a, m) * np.fft.rfft(b, m), m)[: len(a) + len(b) - 1]


def smooth_step(u):
    u = np.clip(u, 0.0, 1.0)
    return 0.5 - 0.5 * np.cos(np.pi * u)


def box_rms(x, n):
    """The RMS of x over a sliding window of n samples, centred."""
    c = np.concatenate([[0.0], np.cumsum(x * x)])
    half = n // 2
    i = np.arange(len(x))
    a, b = np.maximum(0, i - half), np.minimum(len(x), i + n - half)
    return np.sqrt((c[b] - c[a]) / np.maximum(1, b - a))


# ---------------------------------------------------------------- files


def read_wav(path):
    """A PCM or float WAV as float64, channels by samples, and its sample rate."""
    b = open(path, "rb").read()
    assert b[:4] == b"RIFF" and b[8:12] == b"WAVE", path
    i, fmt, data = 12, None, None
    while i + 8 <= len(b):
        cid, size = b[i : i + 4], struct.unpack("<I", b[i + 4 : i + 8])[0]
        body = b[i + 8 : i + 8 + size]
        if cid == b"fmt ":
            tag, ch, sr, _, _, bits = struct.unpack("<HHIIHH", body[:16])
            if tag == 0xFFFE:
                tag = struct.unpack("<H", body[24:26])[0]
            fmt = (tag, ch, sr, bits)
        elif cid == b"data":
            data = body
        i += 8 + size + (size & 1)
    tag, ch, sr, bits = fmt
    if tag == 3:
        x = np.frombuffer(data, dtype="<f4" if bits == 32 else "<f8").astype(np.float64)
    elif bits == 16:
        x = np.frombuffer(data[: len(data) // 2 * 2], dtype="<i2").astype(np.float64) / 32768
    elif bits == 24:
        n = len(data) // 3
        a = np.frombuffer(data[: n * 3], dtype=np.uint8).reshape(n, 3).astype(np.int32)
        v = a[:, 0] | (a[:, 1] << 8) | (a[:, 2] << 16)
        x = np.where(v >= 1 << 23, v - (1 << 24), v).astype(np.float64) / (1 << 23)
    elif bits == 32:
        x = np.frombuffer(data[: len(data) // 4 * 4], dtype="<i4").astype(np.float64) / (1 << 31)
    else:
        raise ValueError(f"{path}: {fmt}")
    n = len(x) // ch
    return x[: n * ch].reshape(n, ch).T, sr


def write_wav(path, x, bits=24):
    """Stereo (2 by n) or mono float to a PCM WAV."""
    x = np.atleast_2d(x)
    ch, n = x.shape
    full = (1 << (bits - 1)) - 1
    v = np.clip(np.round(x.T * full), -full - 1, full).astype(np.int32)
    if bits == 16:
        body = v.astype("<i2").tobytes()
    else:
        raw = v.reshape(-1).astype("<i4").view(np.uint8).reshape(-1, 4)[:, :3]
        body = raw.tobytes()
    head = struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", 36 + len(body), b"WAVE", b"fmt ", 16, 1, ch, SR, SR * ch * bits // 8, ch * bits // 8, bits, b"data", len(body))
    with open(path, "wb") as f:
        f.write(head + body)


def decode_file(path):
    """Any file ffmpeg reads, as float64, 2 by n, at SR; a mono file comes back with the same samples on both sides."""
    p = subprocess.run([FFMPEG, "-hide_banner", "-i", path, "-f", "f32le", "-ar", str(SR), "pipe:1"], capture_output=True)
    info = p.stderr.decode("utf-8", "replace")
    channels = 1 if ", mono," in info.split("Output #0")[0] else 2
    x = np.frombuffer(p.stdout, dtype=np.float32).astype(np.float64)
    return np.stack([x, x]) if channels == 1 else x.reshape(-1, 2).T


def encode_mp3(path, x, kbps=KBPS):
    """Stereo float to MP3 through ffmpeg's libmp3lame, as scripts/build-room-audio.py does it: no ID3, no metadata."""
    tmp = path + ".tmp.mp3"
    p = subprocess.run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "pipe:0",
         "-c:a", "libmp3lame", "-b:a", f"{kbps}k", "-compression_level", "2", "-id3v2_version", "0", "-map_metadata", "-1", tmp],
        input=x.T.astype(np.float32).tobytes(),
    )
    assert p.returncode == 0, path
    os.replace(tmp, path)


def ffmpeg_loudness(path):
    """Integrated loudness and true peak as ffmpeg's own ebur128 filter reads them: a second opinion on the meter below."""
    p = subprocess.run([FFMPEG, "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True)
    text = p.stderr.decode("utf-8", "replace").split("Summary:")[-1]
    out = [None, None]
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("I:") and out[0] is None:
            out[0] = float(s.split()[1])
        if s.startswith("Peak:"):
            out[1] = float(s.split()[1])
    return out


# ---------------------------------------------------------------- resampling

_KERNELS = {}
SINC_ZEROS = 32  # zero crossings on each side
SINC_PHASES = 512
SINC_BETA = 10.0  # Kaiser window: about 100 dB down in the stop band
SINC_CUT = 0.9  # of the lower Nyquist: with 32 zero crossings the stop band then starts just under that Nyquist


def _kernel(cutoff):
    key = round(cutoff, 5)
    k = _KERNELS.get(key)
    if k is None:
        half = int(np.ceil(SINC_ZEROS / key))
        j = np.arange(-half + 1, half + 1)
        ph = np.arange(SINC_PHASES + 1) / SINC_PHASES
        t = j[None, :] - ph[:, None]
        w = np.i0(SINC_BETA * np.sqrt(np.maximum(0.0, 1 - (t / half) ** 2))) / np.i0(SINC_BETA)
        h = key * np.sinc(key * t) * w
        h /= h.sum(axis=1, keepdims=True)
        k = _KERNELS[key] = (half, h)
    return k


def resample(x, ratio, n_out=None, start=0.0):
    """Windowed-sinc resampling from a table of 512 phases (linear between phases).

    Output sample k reads x at start + k * ratio, so ratio 2 plays an octave up. The low-pass sits at 0.9 of
    whichever Nyquist is lower, so pitching up cannot alias and pitching down leaves no images."""
    half, h = _kernel(SINC_CUT * min(1.0, 1.0 / ratio))
    taps = 2 * half
    n = x.shape[-1]
    if n_out is None:
        n_out = int(np.floor((n - 1 - start) / ratio)) + 1
    xp = np.pad(x, [(0, 0)] * (x.ndim - 1) + [(half, half + 2)])
    last = xp.shape[-1] - 1
    out = np.zeros(x.shape[:-1] + (n_out,))
    step = max(1024, 2_000_000 // taps)
    off = np.arange(1, taps + 1)
    for a in range(0, n_out, step):
        k = np.arange(a, min(n_out, a + step))
        pos = start + k * ratio
        i = np.floor(pos).astype(np.int64)
        fr = (pos - i) * SINC_PHASES
        p0 = np.minimum(fr.astype(np.int64), SINC_PHASES - 1)
        u = (fr - p0)[:, None]
        kern = h[p0] * (1 - u) + h[p0 + 1] * u
        idx = np.clip(i[:, None] + off[None, :], 0, last)
        out[..., a : a + len(k)] = np.einsum("...mt,mt->...m", xp[..., idx], kern)
    return out


# ---------------------------------------------------------------- pitch


def yin(x, fmin=25.0, fmax=3000.0):
    """The fundamental of a frame by YIN: (Hz, how aperiodic the best period is, 0 is perfect)."""
    n = len(x)
    tmax = min(int(SR / fmin) + 2, n // 2)
    tmin = max(2, int(SR / fmax))
    w = n - tmax
    m = fast_len(2 * n)
    r = np.fft.irfft(np.conj(np.fft.rfft(x[:w], m)) * np.fft.rfft(x, m), m)[: tmax + 1]
    e = np.concatenate([[0.0], np.cumsum(x * x)])
    tau = np.arange(tmax + 1)
    d = e[w] + (e[tau + w] - e[tau]) - 2 * r
    cm = np.ones(tmax + 1)
    cm[1:] = d[1:] * tau[1:] / np.maximum(np.cumsum(d[1:]), 1e-30)
    best = None
    for thr in (0.1, 0.2, 0.35):
        below = np.where(cm[tmin:tmax] < thr)[0]
        if len(below):
            t = below[0] + tmin
            while t + 1 < tmax and cm[t + 1] < cm[t]:
                t += 1
            best = t
            break
    if best is None:
        best = int(np.argmin(cm[tmin:tmax]) + tmin)
    y0, y1, y2 = cm[best - 1], cm[best], cm[best + 1]
    den = y0 - 2 * y1 + y2
    shift = 0.5 * (y0 - y2) / den if abs(den) > 1e-20 else 0.0
    return SR / (best + shift), float(cm[best])


def yin_median(x, fmin, fmax, frame=None, hops=9):
    """The median YIN reading of several frames spread over x (a vibrato averages out)."""
    frame = frame or int(max(4096, 6 * SR / fmin))
    if len(x) < frame:
        return yin(x, fmin, fmax)
    got = [yin(x[int(a) : int(a) + frame], fmin, fmax) for a in np.linspace(0, len(x) - frame, hops)]
    good = [g for g in got if g[1] < 0.5] or got
    return float(np.median([g[0] for g in good])), float(np.median([g[1] for g in good]))


def spectrum_peaks(x, lo, hi, count=1, pad=8):
    """The strongest spectral peaks between lo and hi Hz: [(Hz, amplitude)], strongest first (Hann window, parabolic in log)."""
    n = len(x)
    m = fast_len(n * pad)
    S = np.abs(np.fft.rfft(x * np.hanning(n), m))
    f = np.fft.rfftfreq(m, 1 / SR)
    a, b = np.searchsorted(f, lo), np.searchsorted(f, hi)
    seg = S[a:b]
    out = []
    width = max(2, int(pad * 2))
    order = np.argsort(seg)[::-1]
    taken = np.zeros(len(seg), bool)
    for i in order:
        if len(out) >= count:
            break
        if taken[i] or i == 0 or i == len(seg) - 1 or not (seg[i] >= seg[i - 1] and seg[i] >= seg[i + 1]):
            continue
        y0, y1, y2 = np.log(seg[i - 1 : i + 2] + 1e-30)
        den = y0 - 2 * y1 + y2
        shift = 0.5 * (y0 - y2) / den if abs(den) > 1e-20 else 0.0
        out.append(((a + i + shift) * SR / m, float(seg[i])))
        taken[max(0, i - width) : i + width + 1] = True
    return out


# ---------------------------------------------------------------- sampled instruments
#
# kind "sustain": bowed sections. The file's own slow start is skipped up to `start_db` under its held level, then
#   `attack` fades the note in; the held part (levelled slowly, see Sample) is used at its natural length and looped
#   with a cross-fade only when a note is longer than it.
# kind "struck": piano, bars, tines. The note starts at the sample's own onset. With `ring` it is left to ring
#   whatever its written length; otherwise it is damped over `release` at its end.
# layers: (glob under .asset-cache/score, level of the layer in dB), softest first. Velocity moves from one to the
#   next; a note with "cresc" moves through them in time.
# The names of the files are not trusted for pitch (the string files are named an octave low): each sample's
# pitch is measured when it is first read, and kept in analysis.json next to the samples.

INSTRUMENTS = {
    "violins": dict(kind="sustain", attack=0.55, release=0.9, start_db=-12.0, layers=[("VSCO-2-CE/Strings/Violin Section/susVib/*_v1.wav", 0.0), ("VSCO-2-CE/Strings/Violin Section/susVib/*_v2.wav", 6.0)]),
    "violas": dict(kind="sustain", attack=0.55, release=0.9, start_db=-12.0, layers=[("VSCO-2-CE/Strings/Viola Section/susvib/*_v1_1.wav", 0.0), ("VSCO-2-CE/Strings/Viola Section/susvib/*_v2_1.wav", 9.0)]),
    "cellos": dict(kind="sustain", attack=0.5, release=0.9, start_db=-12.0, layers=[("VSCO-2-CE/Strings/Cello Section/susvib/*_v1_1.wav", 0.0), ("VSCO-2-CE/Strings/Cello Section/susvib/*_v3_1.wav", 9.0)]),
    "bass": dict(kind="sustain", attack=0.6, release=1.0, start_db=-12.0, layers=[("VSCO-2-CE/Strings/Solo Contrabass/SusVib/*_v1_rr1.wav", 0.0)]),
    # the upright's recordings carry a steady hum on 27.67 Hz and its harmonics, as loud as the note's own low
    # partials when it is played pianissimo: `dehum` takes those lines out (see dehum below)
    "piano": dict(kind="struck", release=0.5, dehum=27.67, layers=[("VSCO-2-CE/Keys/Upright Nr1/*_pp_RR1.wav", 0.0)]),
    "glock": dict(kind="struck", ring=True, pitch="peak", layers=[("VCSL/Idiophones/Struck Idiophones/Glockenspiel/glock_soft_*.wav", 0.0), ("VSCO-2-CE/Percussion/Glock/glock_medium_*.wav", 6.0)]),
    # a real music box, sixteen notes of a D major comb from D5 to E7 (Freesound 70173 to 70188, CC0, HQ previews)
    "musicbox_real": dict(kind="struck", ring=True, pitch="peak", t60=3.2, layers=[("freesound/701[78]?.mp3", 0.0)]),
    # the synthesised music box: see tine() below
    "musicbox": dict(kind="synth"),
    # not an instrument: recordings of the piece itself, placed in time (see the "sounds" tracks of the cues)
    "sound": dict(kind="sound"),
}

_ANALYSIS = None
_SAMPLES = {}
_BANKS = {}
USED_FILES = {}  # instrument -> set of sample files that actually sounded


def _analysis():
    global _ANALYSIS
    if _ANALYSIS is None:
        path = os.path.join(CACHE, "analysis.json")
        try:
            _ANALYSIS = json.load(open(path, encoding="utf-8"))
        except (OSError, ValueError):
            _ANALYSIS = {}
    return _ANALYSIS


def _save_analysis():
    with open(os.path.join(CACHE, "analysis.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(_ANALYSIS, f, indent=1, sort_keys=True)


def dehum(x, about, harmonics=14):
    """Takes a steady hum out of a recording: its exact frequency is read off the last two seconds (where the note has
    died away), and that line and its harmonics are cut by narrow zero-phase notches (0.3 to 1 Hz wide)."""
    tail = x.mean(axis=0)[-2 * SR :]
    third = spectrum_peaks(tail, 3 * about - 1.0, 3 * about + 1.0)
    f0 = third[0][0] / 3 if third else about

    def H(f):
        g = np.ones(len(f))
        for k in range(1, harmonics + 1):
            g *= 1 - np.exp(-0.5 * ((f - k * f0) / (0.3 + 0.05 * k)) ** 2)
        return g

    return filt(x, H), f0


class Sample:
    """One recording, cut to where it starts, levelled, with its measured pitch."""

    def __init__(self, path, kind, pitch_by, start_db, hum=None):
        self.path = path
        self.rel = os.path.relpath(path, CACHE).replace("\\", "/")
        if path.lower().endswith(".wav"):
            x, sr = read_wav(path)
            if x.shape[0] == 1:
                x = np.concatenate([x, x])
            if sr != SR:
                x = resample(x, sr / SR)
        else:
            x = decode_file(path)
        x = x[:2] - x[:2].mean(axis=1, keepdims=True)
        self.hum = None
        if hum:
            x, self.hum = dehum(x, hum)
        m = x.mean(axis=0)
        key = f"{self.rel}:{os.path.getsize(path)}:{kind}:{start_db}:{hum}"
        info = _analysis().get(key)
        if info is None:
            info = self._measure(m, kind, pitch_by, start_db)
            _analysis()[key] = info
            _save_analysis()
        self.hz, self.t60 = info["hz"], info.get("t60")
        a, b = info["start"], info["end"]
        self.hold = info["hold"] - a  # samples of held sound from the cut start (sustains)
        self.x = x[:, a:b] / info["level"]
        if kind == "sustain":
            # a section playing very softly swells and sags by several dB over a few seconds: the held part is
            # levelled slowly (half a second), so that a pad stays a pad and a loop has no step in it
            env = box_rms(self.x.mean(axis=0), int(0.5 * SR))
            mid = float(np.median(env[: self.hold]))
            g = np.clip(mid / np.maximum(env, 1e-9), from_db(-6.0), from_db(9.0))
            g[self.hold :] = g[self.hold - 1]
            k = int(0.25 * SR)
            g = conv(np.pad(g, (k, k), mode="edge"), np.hanning(2 * k + 1) / np.hanning(2 * k + 1).sum())[2 * k : 2 * k + len(g)]
            self.x = self.x * g
            self.x /= np.sqrt(np.mean(self.x.mean(axis=0)[: self.hold] ** 2))
        k = min(self.x.shape[1] // 2, int(0.06 * SR))
        self.x[:, -k:] *= np.cos(0.5 * np.pi * (np.arange(k) + 0.5) / k) ** 2
        self.midi = 69 + 12 * np.log2(self.hz / 440)

    @staticmethod
    def _measure(m, kind, pitch_by, start_db):
        n = len(m)
        if kind == "sustain":
            env = box_rms(m, int(0.1 * SR))
            held = np.percentile(env, 80)
            above = np.where(env > held * from_db(start_db))[0]
            start = int(above[0])
            near = np.where(env > held * from_db(-4.0))[0]
            hold = int(near[-1]) - int(0.05 * SR)
            end = min(n, int(above[-1]) + int(0.1 * SR))
            mid = m[start + (hold - start) // 5 : start + (hold - start) * 4 // 5]
            hz, _ = yin_median(mid, 25.0, 2500.0)
            level = float(np.sqrt(np.mean(m[start:hold] ** 2)))
            return dict(hz=hz, start=start, end=end, hold=hold, level=level)
        env = box_rms(m, int(0.0005 * SR) | 1)
        top = env.max()
        start = max(0, int(np.argmax(env > top * from_db(-26.0))) - int(0.001 * SR))
        slow = box_rms(m, int(0.05 * SR))
        floor = np.sqrt(np.mean(m[-int(0.1 * SR) :] ** 2))
        alive = np.where(slow > max(floor * 2, slow.max() * from_db(-66.0)))[0]
        end = min(n, int(alive[-1]) + int(0.05 * SR))
        body = m[start:end]
        if pitch_by == "peak":
            seg = body[int(0.03 * SR) : int(0.03 * SR) + min(len(body) - int(0.03 * SR), int(1.5 * SR))]
            hz = spectrum_peaks(seg, 60.0, 6000.0)[0][0]
        else:
            seg = body[int(0.15 * SR) : int(0.15 * SR) + int(1.2 * SR)]
            hz, _ = yin_median(seg, 25.0, 2500.0, hops=5)
        level = float(np.sqrt(np.mean(body[: int(0.3 * SR)] ** 2)))
        # decay time of the whole sound, between 5 and 30 dB under its top
        lv = db(slow[start:end])
        j0 = int(np.argmax(lv))
        a = j0 + int(np.argmax(lv[j0:] < lv[j0] - 5))
        under = np.where(lv[a:] < max(lv[j0] - 30, db(floor) + 8))[0]
        b = a + (int(under[0]) if len(under) else len(lv) - a - 1)
        t60 = None
        if b - a > SR // 10:
            slope = np.polyfit(np.arange(a, b) / SR, lv[a:b], 1)[0]
            t60 = float(-60 / slope) if slope < 0 else None
        return dict(hz=hz, start=start, end=end, hold=end, level=level, t60=t60)


def bank(name):
    """The layers of an instrument: for each, its samples sorted by pitch and the layer's level."""
    b = _BANKS.get(name)
    if b is None:
        spec = INSTRUMENTS[name]
        b = []
        for pattern, level_db in spec["layers"]:
            files = sorted(glob.glob(os.path.join(CACHE, *pattern.split("/"))))
            if not files:
                raise SystemExit(f"no samples for {name}: {pattern} (see .asset-cache/score/DOWNLOADS.json)")
            samples = []
            for f in files:
                s = _SAMPLES.get(f)
                if s is None:
                    s = _SAMPLES[f] = Sample(f, spec["kind"], spec.get("pitch", "yin"), spec.get("start_db", -12.0), spec.get("dehum"))
                samples.append(s)
            b.append((sorted(samples, key=lambda s: s.midi), from_db(level_db)))
        _BANKS[name] = b
    return b


def _looped(s, n_src, start):
    """n_src samples of a sustained sample from `start`: its held part as it is, and round a cross-faded loop beyond it."""
    usable = s.hold
    if start + n_src <= usable:
        return s.x[:, start : start + n_src], False
    a = start + (usable - start) // 4
    xf = min(SR, (usable - a) // 3)
    head, tail = s.x[:, a : a + xf], s.x[:, usable - xf : usable]
    r = max(0.0, float(np.sum(head.mean(0) * tail.mean(0)) / max(np.sqrt(np.sum(head.mean(0) ** 2) * np.sum(tail.mean(0) ** 2)), 1e-12)))
    u = (np.arange(xf) + 0.5) / xf
    norm = np.sqrt(u * u + (1 - u) * (1 - u) + 2 * r * u * (1 - u))
    body = np.array(s.x[:, a : usable - xf])
    body[:, :xf] = head * (u / norm) + tail * ((1 - u) / norm)
    parts = [s.x[:, start : usable - xf]]
    have = usable - xf - start
    while have < n_src:
        parts.append(body)
        have += body.shape[1]
    return np.concatenate(parts, axis=1)[:, :n_src], True


def _shape_curve(points, n):
    """A level curve over n samples from [(place 0..1, level 0..1), ...], with smooth joins."""
    u = np.arange(n) / max(1, n - 1)
    out = np.zeros(n)
    for (a, va), (b, vb) in zip(points[:-1], points[1:]):
        sel = (u >= a) & (u <= b)
        out[sel] = va + (vb - va) * smooth_step((u[sel] - a) / max(b - a, 1e-9))
    return out


def sampler_note(name, midi, seconds, velocity, opt):
    """One note of a sampled instrument: stereo, starting at the note's start, its release (or ring) included.

    Also returns what it was made of: the sample of each layer, how far it was moved, whether it had to be looped."""
    spec = INSTRUMENTS[name]
    layers = bank(name)
    target = hz_of(midi + opt.get("cents", 0.0) / 100)
    sustain = spec["kind"] == "sustain"
    ring = spec.get("ring", False) and not opt.get("damp")
    release = opt.get("release", spec.get("release", 0.3))
    attack = opt.get("attack", spec.get("attack", 0.0))
    cresc = bool(opt.get("cresc")) and len(layers) == 2
    if len(layers) == 1:
        weights = [1.0]
    elif cresc:
        weights = [1.0, 1.0]  # mixed in time, below
    else:
        w = float(np.clip((velocity - 56) / 56.0, 0.0, 1.0))
        weights = [np.cos(0.5 * np.pi * w), np.sin(0.5 * np.pi * w)]
    parts = []
    info = dict(files=[], looped=False)
    for (samples, level), weight in zip(layers, weights):
        if weight < 1e-4:
            parts.append(np.zeros((2, 0)))
            continue
        s = min(samples, key=lambda s: (abs(s.midi - midi), s.rel))
        USED_FILES.setdefault(name, set()).add(s.rel)
        ratio = target / s.hz
        info["files"].append(f"{os.path.basename(s.rel)} {12 * np.log2(ratio):+.2f} st" + (f", hum of {s.hum:.2f} Hz taken out" if s.hum else ""))
        if ring:
            n_out = int((s.x.shape[1] - 1) / ratio)
            src = s.x
        else:
            n_out = int((seconds + release) * SR)
            if sustain:
                src, looped = _looped(s, int(n_out * ratio) + 8, 0)
                info["looped"] = info["looped"] or looped
            else:
                src = s.x[:, : int(n_out * ratio) + 8]
                n_out = min(n_out, int((src.shape[1] - 1) / ratio))
        y = resample(src, ratio, n_out) * (level * weight)
        if ring and spec.get("t60") and s.t60:
            # a sample played lower rings longer: bring its decay back to the instrument's own
            extra = 6.91 / spec["t60"] - 6.91 / (s.t60 / ratio)
            if extra > 0:
                y *= np.exp(-extra * np.arange(n_out) / SR)
        parts.append(y)
    n = max(y.shape[1] for y in parts)
    parts = [np.pad(y, [(0, 0), (0, n - y.shape[1])]) for y in parts]
    t = np.arange(n) / SR
    env = np.ones(n)
    if attack > 0:
        env *= smooth_step(t / attack)
    if not ring:
        env *= 1 - smooth_step((t - seconds) / max(release, 1e-4))
    shape = opt.get("shape")
    if shape:
        level = _shape_curve(shape, int(seconds * SR))
        level = np.concatenate([level, np.full(max(0, n - len(level)), level[-1])])[:n]
        env *= level
        if cresc:
            # the soft players at first, the loud ones as the swell rises past a third of its height
            w = np.clip((level - 0.3) / 0.7, 0.0, 1.0)
            parts = [parts[0] * np.cos(0.5 * np.pi * w), parts[1] * np.sin(0.5 * np.pi * w)]
    else:
        env *= (velocity / 127.0) ** 1.5
    return sum(parts) * env, info


# ---------------------------------------------------------------- the synthesised music box
#
# A physical-style additive model of one tooth of a comb, set from sixteen real notes (Freesound 70173 to 70188):
# there the fundamental carries the note and rings for 1 to 5 s (T60); a second and third harmonic sit 6 to 34 dB
# under it; the tooth's next bending mode is at 8.7 to 10.9 times the fundamental (a plain bar has it at 6.27; a
# tooth weighted at its tip has it higher) and is gone in 0.10 to 0.25 s; the neighbouring teeth answer 25 to 43 dB
# down; the first 30 ms are 1.3 to 6 times brighter than what follows.

# Hz, Q, gain: kept between the notes of the scale, and low, so that no note of the tune sits on a resonance and jumps out
BOX_MODES = [(415.0, 8.0, 0.35), (622.0, 9.0, 0.3), (1010.0, 10.0, 0.3), (1700.0, 9.0, 0.25), (2900.0, 8.0, 0.2)]
MUSICBOX_SCALE = [midi_of(p) for p in ("C#4", "D4", "E4", "F4", "G4", "A4", "Bb4", "C#5", "D5", "E5", "F5", "G5", "A5", "Bb5", "C#6", "D6")]


def tooth(midi):
    """What one tooth always is: its own small mistuning, ring, level and upper mode."""
    rng = np.random.default_rng(zlib.crc32(f"tooth {midi:.2f}".encode()))
    return dict(cents=float(rng.uniform(-3.0, 3.0)), ring=float(rng.uniform(0.88, 1.12)), level=float(rng.uniform(-1.0, 1.0)),
                mode=float(rng.uniform(0.985, 1.015)), twin=float(rng.uniform(1.8, 3.2)), bright=float(rng.uniform(-3.0, 3.0)))


def tine(midi, velocity, rng, cents_off=0.0):
    """One plucked tooth, mono, before the box: the tooth and its twin, its harmonics, its bending modes, its neighbours, the pin's click."""
    me = tooth(midi)
    hz = hz_of(midi + (me["cents"] + cents_off) / 100)
    v = velocity / 127.0
    t60 = float(np.clip(3.2 * (660.0 / hz) ** 0.3, 1.2, 3.8)) * me["ring"]
    n = int(min(t60 * 1.45, 7.0) * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    top = 0.45 * SR

    def partial(f, level_db, decay, phase=0.0, rise=0.0):
        if f < top:
            p = from_db(level_db) * np.exp(-6.91 * t / decay) * np.sin(TAU * f * t + phase)
            y[:] += p * (1 - np.exp(-t / rise)) if rise else p

    bright = me["bright"] + 12 * np.log10(max(v, 0.05))
    partial(hz, 0.0, t60)
    partial(2 * hz, -19.0 + 0.5 * bright, 0.55 * t60)
    partial(3 * hz, -27.0 + 0.5 * bright, 0.4 * t60)
    # the twin tooth: a second tooth of the same note, a few cents off, answering the first
    partial(hz * 2 ** (me["twin"] / 1200), -11.0, 0.85 * t60, phase=rng.uniform(0, TAU), rise=0.012)
    # the tooth's higher bending modes: inharmonic, bright and short
    r2 = float(np.clip(10.9 - 1.55 * np.log2(hz / 600.0), 6.3, 12.5)) * me["mode"]
    partial(r2 * hz, -6.0 + bright, 0.16)
    partial(1.63 * r2 * hz, -20.0 + bright, 0.35)
    partial(1.69 * r2 * hz, -27.0 + bright, 0.25, phase=1.0)
    # the neighbouring teeth of the comb answer, far under the note
    near = sorted(MUSICBOX_SCALE, key=lambda m: abs(m - midi))
    for m in [m for m in near if abs(m - midi) > 0.5][:2]:
        partial(hz_of(m + tooth(m)["cents"] / 100), -33.0, 1.5, phase=rng.uniform(0, TAU), rise=0.02)
    # the pin letting go of the tooth: a few milliseconds of band-limited noise
    k = int(0.02 * SR)
    click = rng.standard_normal(k) * np.exp(-np.arange(k) / (0.0012 * SR))
    click = filt(click, lambda f: 1 / np.sqrt(1 + (2500.0 / np.maximum(f, 1e-3)) ** 4) / np.sqrt(1 + (f / 9000.0) ** 6))
    y[:k] += click * from_db(-12.0 + bright) / max(np.abs(click).max(), 1e-9)
    y *= np.minimum(1.0, t / 0.0004) * (1 - smooth_step((t - (t[-1] - 0.03)) / 0.03))
    return y * from_db(me["level"]) * v ** 1.3


def box(x):
    """The small wooden box the comb is screwed to: a handful of panel resonances beside the direct sound, and no bass."""
    n = x.shape[-1]
    m = fast_len(n + SR // 2)
    f = np.maximum(np.fft.rfftfreq(m, 1 / SR), 1e-3)
    H = np.ones(len(f), complex)
    for fk, q, g in BOX_MODES:
        H += g / (1 + 1j * q * (f / fk - fk / f))
    H *= (1j * f / 170.0) / (1 + 1j * f / 170.0)
    H /= 1.25
    return np.fft.irfft(np.fft.rfft(x, m, axis=-1) * H, m, axis=-1)[..., :n]


# ---------------------------------------------------------------- reverb

_IRS = {}
REVERBS = {
    # T60 at mid frequencies, pre-delay, how the decay time changes with frequency, early reflections
    "room": dict(t60=0.45, pre=0.004, build=0.002, tilt=[(100, 1.0), (1000, 1.0), (4000, 0.8), (10000, 0.55)], early=6, seed=11),
    "hall": dict(t60=2.4, pre=0.022, build=0.012, tilt=[(100, 1.1), (500, 1.0), (2000, 0.8), (6000, 0.5), (12000, 0.3)], early=9, seed=23),
}


def impulse_response(name):
    """A synthetic stereo impulse response: filtered noise with an exponential decay that is faster at the top, two unrelated sides."""
    ir = _IRS.get(name)
    if ir is None:
        p = REVERBS[name]
        rng = np.random.default_rng(p["seed"])
        n = int((p["t60"] * 1.25 + p["pre"]) * SR)
        t = np.arange(n) / SR
        edges = np.geomspace(90.0, 16000.0, 9)
        fq = np.log([q[0] for q in p["tilt"]])
        gq = [q[1] for q in p["tilt"]]
        m = fast_len(n)
        f = np.fft.rfftfreq(m, 1 / SR)
        lf = np.log(np.maximum(f, 1.0))
        sides = []
        for _ in range(2):
            W = np.fft.rfft(rng.standard_normal(n), m)
            y = np.zeros(n)
            for lo, hi in zip(edges[:-1], edges[1:]):
                # bands that add up to one: raised cosines in log frequency
                c, half = 0.5 * (np.log(lo) + np.log(hi)), np.log(hi) - np.log(lo)
                band = np.where(np.abs(lf - c) < half, np.cos(0.5 * np.pi * (lf - c) / half) ** 2, 0.0)
                decay = p["t60"] * float(np.interp(c, fq, gq))
                y += np.fft.irfft(W * band, m)[:n] * np.exp(-6.91 * t / decay)
            y *= 1 - np.exp(-t / p["build"])
            for _ in range(p["early"]):
                at = rng.uniform(0.004, 0.07 if name == "hall" else 0.02)
                k = int(at * SR)
                y[k : k + 3] += rng.choice([-1, 1]) * np.array([0.5, 1.0, 0.5]) * 0.35 * np.sqrt(np.sum(y * y)) * np.exp(-at / 0.03) / 6
            y = np.concatenate([np.zeros(int(p["pre"] * SR)), y])[:n]
            y *= 1 - smooth_step((t - (t[-1] - 0.05)) / 0.05)
            sides.append(y / np.sqrt(np.sum(y * y)))
        ir = _IRS[name] = np.stack(sides)
    return ir


def reverb(x, name):
    """The wet signal only: each side of x through its own side of the response. As long as x plus the response."""
    ir = impulse_response(name)
    return np.stack([conv(x[0], ir[0]), conv(x[1], ir[1])])


# ---------------------------------------------------------------- loudness and peaks


def k_weight(x):
    """The two filters of BS.1770 (a high shelf of 4 dB and a high-pass at 38 Hz), applied through their frequency response."""
    n = x.shape[-1]
    m = fast_len(n + SR)
    z = np.exp(-1j * TAU * np.fft.rfftfreq(m))
    k = np.tan(np.pi * 1681.974450955533 / SR)
    vh = 10 ** (3.999843853973347 / 20)
    vb = vh ** 0.4996667741545416
    q = 0.7071752369554196
    a0 = 1 + k / q + k * k
    shelf = ((vh + vb * k / q + k * k) / a0 + 2 * (k * k - vh) / a0 * z + (vh - vb * k / q + k * k) / a0 * z * z) / (1 + 2 * (k * k - 1) / a0 * z + (1 - k / q + k * k) / a0 * z * z)
    k = np.tan(np.pi * 38.13547087602444 / SR)
    q = 0.5003270373238773
    a0 = 1 + k / q + k * k
    high = (1 - 2 * z + z * z) / (1 + 2 * (k * k - 1) / a0 * z + (1 - k / q + k * k) / a0 * z * z)
    return np.fft.irfft(np.fft.rfft(x, m, axis=-1) * shelf * high, m, axis=-1)[..., :n]


def loudness(x):
    """Integrated loudness in LUFS (ITU-R BS.1770-4: K weighting, 400 ms blocks every 100 ms, gates at -70 LUFS and at 10 LU under)."""
    x = np.atleast_2d(x)
    block, hop = int(0.4 * SR), int(0.1 * SR)
    if x.shape[-1] < block:
        x = np.pad(x, [(0, 0), (0, block - x.shape[-1])])
    y = k_weight(x)
    c = np.concatenate([np.zeros((y.shape[0], 1)), np.cumsum(y * y, axis=1)], axis=1)
    starts = np.arange(0, y.shape[1] - block + 1, hop)
    z = ((c[:, starts + block] - c[:, starts]) / block).sum(axis=0)
    l = -0.691 + 10 * np.log10(np.maximum(z, 1e-20))
    keep = l > -70.0
    if not keep.any():
        return float("-inf")
    rel = -0.691 + 10 * np.log10(z[keep].mean()) - 10.0
    keep &= l > rel
    return float(-0.691 + 10 * np.log10(z[keep].mean()))


def true_peak(x):
    """The peak in dBTP: the signal brought to four times the rate (band-limited, by FFT) before looking."""
    x = np.atleast_2d(x)
    n = x.shape[-1]
    m = fast_len(n + 2048)
    X = np.fft.rfft(x, m, axis=-1)
    up = np.fft.irfft(np.pad(X, [(0, 0), (0, 2 * m - X.shape[-1] + 1)]), 4 * m, axis=-1) * 4
    return float(db(np.abs(up).max()))


# ---------------------------------------------------------------- measuring a render


def find_onsets(x, gap=0.12):
    """Where notes begin in a mono signal, in seconds, found from the signal alone.

    The attack of a struck or plucked note is a burst above 2 kHz: an onset is where the 1 ms level of that band
    jumps to four times what it was over the 30 ms before, and its time is where it first passes a fifth of the
    top it reaches in the next 15 ms."""
    h = hp(x, 2000.0, 3)
    fast = box_rms(h, int(0.001 * SR))
    k = int(0.03 * SR)
    c = np.concatenate([[0.0], np.cumsum(h * h)])
    i = np.arange(len(h))
    before = np.sqrt((c[np.maximum(0, i - 66)] - c[np.maximum(0, i - 66 - k)]) / k)
    floor = max(fast.max() * from_db(-34.0), 1e-9)
    hot = (fast > 4 * before + floor)
    out = []
    j = 0
    idx = np.where(hot)[0]
    while j < len(idx):
        a = idx[j]
        top = fast[a : a + int(0.015 * SR)].max()
        first = a - int(0.004 * SR) + int(np.argmax(fast[max(0, a - int(0.004 * SR)) : a + int(0.015 * SR)] > 0.2 * top))
        out.append(max(0, first) / SR)
        nxt = a + int(gap * SR)
        j = int(np.searchsorted(idx, nxt))
    return out


def note_pitch(x, a, b, guess_lo=180.0, guess_hi=1300.0):
    """The pitch of x between a and b seconds, two ways: YIN, and the lowest strong spectral peak that was not there before a."""
    seg = x[int(a * SR) : int(b * SR)]
    if len(seg) < int(0.05 * SR):
        return None, None, None
    hz, ap = yin(seg, guess_lo, guess_hi)
    S = spectrum_peaks(seg, guess_lo, guess_hi, count=6)
    pre = x[max(0, int(a * SR) - len(seg) - int(0.04 * SR)) : max(0, int(a * SR) - int(0.04 * SR))]
    new = None
    if len(pre) >= int(0.05 * SR):
        n = len(seg)
        pre = np.pad(pre, (0, n - len(pre))) if len(pre) < n else pre[-n:]
        m = fast_len(n * 8)
        before = np.abs(np.fft.rfft(pre * np.hanning(n), m))
        grown = [(p[0], p[1] - before[int(round(p[0] * m / SR))]) for p in S]
        most = max(g[1] for g in grown)
        # a note's fundamental is its lowest partial: the lowest peak that is new and within 12 dB of the strongest new one
        new = min(g[0] for g in grown if g[1] > most * from_db(-12.0))
    else:
        new = S[0][0]
    return hz, ap, new


def stereo_report(x):
    l, r = x[0], x[1]
    corr = float(np.sum(l * r) / max(np.sqrt(np.sum(l * l) * np.sum(r * r)), 1e-20))
    mid, side = 0.5 * (l + r), 0.5 * (l - r)
    return corr, float(db(np.sqrt(np.mean(side**2)) / max(np.sqrt(np.mean(mid**2)), 1e-20)))


def band_share(x, lo, hi=None):
    """The energy of x between lo and hi Hz as dB under its whole energy."""
    m = x.mean(axis=0) if x.ndim == 2 else x
    S = np.abs(np.fft.rfft(m)) ** 2
    f = np.fft.rfftfreq(len(m), 1 / SR)
    sel = (f >= lo) & (f < (hi or SR))
    return float(10 * np.log10(max(S[sel].sum(), 1e-30) / max(S.sum(), 1e-30)))


def level_db(x, a, b):
    seg = x[..., int(a * SR) : int(b * SR)]
    if seg.size == 0:
        return float("-inf"), float("-inf")
    return float(db(np.sqrt(np.mean(seg**2)))), float(db(np.abs(seg).max()))


# ---------------------------------------------------------------- the cues
#
# A cue:  tempo (quarter notes a minute), lufs (target integrated loudness), lead (seconds of silence before beat 0),
#         tracks, and how it ends:
#           ring=S        the file runs S seconds past the last melody note and fades over its last `fade_out`
#           cut=dict(after_last=0.15, fade=0.04, tail=1.2)   every dry sound is faded out `after_last` seconds after
#                         the last melody note starts; only the reverb goes on, for `tail` seconds
#           hard_cut=dict(at=2.0, fade=0.005, length=2.2)    everything, reverb too, is cut at `at` and the file is
#                         digital silence from there to `length`
#           length=S      a fixed length, the last `fade_out` seconds faded
# A track: name, inst (a key of INSTRUMENTS), gain (dB), pan (-1 left .. 1 right), send ({"hall": dB, "room": dB}),
#          notes, and optionally transpose (semitones), melody=True (its onsets and pitches are checked against the
#          table) and check: False leaves its pitch out of the check, "partials" compares the partials of a struck
#          low note with the harmonics of the lowest written pitch (YIN is no use on two piano notes an octave apart).
# A note:  (start beat, length in beats, pitch, velocity) and optionally a dict:
#          shape=[(place 0..1, level 0..1), ...]  a swell over the note's length (velocity is then ignored)
#          cresc=True   move from the soft to the loud layer as the shape rises
#          attack, release (seconds), cents, damp=True (stop a ringing instrument at the note's end)

MELODY_INSTRUMENT = "musicbox"

# The lullaby: D minor, 3/4, quarter = 66. Eight bars; the short cues stop inside it.
MELODY = [
    (0, 2, "A4", 96), (2, 1, "G4", 84),
    (3, 2, "F4", 90), (5, 1, "E4", 80),
    (6, 1, "F4", 84), (7, 1, "G4", 88), (8, 1, "A4", 94),
    (9, 3, "E4", 88),
    (12, 2, "Bb4", 100), (14, 1, "A4", 88),
    (15, 2, "G4", 92), (17, 1, "F4", 82),
    (18, 1, "E4", 84), (19, 1, "F4", 86), (20, 1, "C#4", 90),
    (21, 3, "D4", 86),
]
# Dm | Bb | Dm/F | A || Gm | Dm/A | A7 | Dm, one line to a track
VIOLINS = [(0, 9, "F4", 44), (9, 3, "E4", 44), (12, 3, "G4", 46), (15, 3, "F4", 44), (18, 3, "E4", 44), (21, 5, "F4", 44)]
VIOLAS_1 = [(0, 9, "D4", 44), (9, 3, "C#4", 44), (12, 6, "D4", 44), (18, 3, "C#4", 44), (21, 5, "D4", 44)]
VIOLAS_2 = [(0, 3, "A3", 44), (3, 3, "Bb3", 44), (6, 6, "A3", 44), (12, 3, "Bb3", 44), (15, 3, "A3", 44), (18, 3, "G3", 44), (21, 5, "A3", 44)]
CELLOS = [(0, 3, "D3", 46), (3, 3, "Bb2", 46), (6, 3, "F3", 46), (9, 3, "A2", 46), (12, 3, "G2", 46), (15, 6, "A2", 46), (21, 5, "D3", 46)]
BASSES = [(21, 5, "D2", 50)]


def bars(notes, last_bar):
    """The notes that begin in bars 1 to last_bar (three beats to the bar)."""
    return [n for n in notes if n[0] < 3 * last_bar]


def theme(last_bar, cut, inst=None, tail=1.2, **more):
    inst = inst or MELODY_INSTRUMENT
    cue = dict(
        tempo=66, lufs=-20.0, lead=0.05,
        tracks=[
            dict(name="melody", inst=inst, gain=0.0, pan=-0.06, send={"room": -15.0, "hall": -8.0}, notes=bars(MELODY, last_bar), melody=True),
            dict(name="melody 8va", inst=inst, gain=-8.0, pan=0.1, send={"room": -15.0, "hall": -8.0}, notes=bars(MELODY, last_bar), transpose=12, melody=True, check=False),
            dict(name="violins", inst="violins", gain=-23.0, pan=-0.3, send={"hall": -5.0}, notes=bars(VIOLINS, last_bar)),
            dict(name="violas 1", inst="violas", gain=-23.0, pan=0.12, send={"hall": -5.0}, notes=bars(VIOLAS_1, last_bar)),
            dict(name="violas 2", inst="violas", gain=-23.0, pan=0.2, send={"hall": -5.0}, notes=bars(VIOLAS_2, last_bar)),
            dict(name="cellos", inst="cellos", gain=-21.0, pan=0.3, send={"hall": -6.0}, notes=bars(CELLOS, last_bar)),
            dict(name="basses", inst="bass", gain=-24.0, pan=0.15, send={"hall": -8.0}, notes=bars(BASSES, last_bar)),
        ],
    )
    if cut:
        cue["cut"] = dict(after_last=0.15, fade=0.04, tail=tail)
    else:
        cue["ring"] = 7.0
        cue["fade_out"] = 2.0
    cue.update(more)
    return cue


SWELL = [(0.0, 0.0), (0.52, 1.0), (1.0, 0.0)]
GROW = [(0.0, 0.0), (0.45, 0.22), (1.0, 1.0)]

# The table, heard in the dark before anything is seen (the cold open, 14 s): a meal, a chair pushed back, steps, the
# door; the street outside for the moment it is seen; one fork set down in the black. Beats are seconds (tempo 60).
COLD = [
    (0.0, 7.4, "rooms/cutlery_far.mp3", -10.0, dict(fade_in=0.6, fade_out=0.25)),
    (0.35, 0, "rooms/fork_plate_2.mp3", -9.0), (1.55, 0, "rooms/plate_clink_1.mp3", -12.0), (2.45, 0, "rooms/glass_set_1.mp3", -13.0),
    (3.2, 0, "rooms/fork_plate_4.mp3", -11.0), (4.1, 0, "rooms/chew_soft.mp3", -20.0),
    (5.4, 0, "rooms/chair_wood_move.mp3", -8.0), (6.15, 0, "rooms/step_wood_1.mp3", -9.0), (6.7, 0, "rooms/step_wood_2.mp3", -10.0),
    (7.15, 0.35, "rooms/door_shut_soft.mp3", -8.0, dict(fade_out=0.01)),
    (7.5, 3.5, "rooms/night_wind_far.mp3", -6.0, dict(fade_in=0.01, fade_out=0.01)),
    (12.5, 0, "rooms/fork_down_1.mp3", -10.0),
]
# Going home, in the black after the last street: the door, the steps, the chair pulled in, a fork, the room.
HOME = [
    (0.0, 0, "rooms/door_handle_slow.mp3", -9.0), (0.9, 0, "rooms/door_shut_soft.mp3", -10.0),
    (1.5, 0, "rooms/step_wood_3.mp3", -11.0), (2.0, 0, "rooms/step_wood_4.mp3", -11.0),
    (2.6, 0, "rooms/chair_wood_move.mp3", -10.0), (3.6, 0, "rooms/fork_plate_1.mp3", -10.0),
    (1.2, 6.8, "rooms/cutlery_far.mp3", -13.0, dict(fade_in=1.5, fade_out=2.5)),
]

CUES = {
    # the lullaby that stops halfway: theme_7 is all eight bars; the others are the evenings, a little further each,
    # cut dead 0.15 s into the last note of bars 2, 3, 5 and 7 (the leading note that never falls), and the room
    # rings on only for a moment: where they end, the dream breaks off and everything stops
    "theme_7": theme(8, False),
    "theme_1": theme(2, True, tail=0.35),
    "theme_2": theme(3, True, tail=0.35),
    "theme_4": theme(5, True, tail=0.35),
    "theme_6": theme(7, True, tail=0.35),
    "cold": dict(tempo=60, lufs=-23.0, lead=0.0, length=14.0, fade_out=0.3, tracks=[dict(name="the table", inst="sound", notes=COLD, check=False)]),
    "home": dict(tempo=60, lufs=-24.0, lead=0.0, length=8.0, fade_out=1.5, tracks=[dict(name="going home", inst="sound", notes=HOME, check=False)]),
    # for the chapter title cards: a very low D struck pianissimo, a bowed D swelling out of it and going again
    "card": dict(
        tempo=60, lufs=-24.0, lead=0.03, length=4.5, fade_out=0.9,
        tracks=[
            dict(name="piano low", inst="piano", gain=9.0, pan=-0.05, send={"hall": -9.0}, notes=[(0, 4.4, "D1", 46), (0, 4.4, "D2", 40)], check="partials"),
            dict(name="cellos", inst="cellos", gain=-2.0, pan=0.1, send={"hall": -7.0}, notes=[(0.15, 4.2, "D3", 60, dict(shape=SWELL, attack=0.0, release=0.12))]),
        ],
    ),
    # the dream breaking off: a cluster growing out of nothing, cut to nothing
    "breakoff": dict(
        tempo=60, lufs=-17.0, lead=0.0, hard_cut=dict(at=2.0, fade=0.005, length=2.2),
        tracks=[
            dict(name=f"cluster {p}", inst=inst, gain=g, pan=pan, send={"hall": -7.0},
                 notes=[(0, 2.05, p, 100, dict(shape=GROW, cresc=True, attack=0.0, release=0.05))])
            for p, inst, g, pan in (("D3", "cellos", 0.0, 0.3), ("Eb3", "cellos", 0.0, 0.1), ("A3", "violas", 0.0, 0.15), ("Bb3", "violas", 0.0, -0.1), ("E4", "violins", 0.0, -0.3))
        ],
    ),
    # the same lullaby on the other candidates for the music box, to compare (rendered with --alt)
    "theme_7_realbox": theme(8, False, inst="musicbox_real", alt=True),
    "theme_7_glock": theme(8, False, inst="glock", alt=True),
}


# ---------------------------------------------------------------- rendering


def place(x, pan):
    """A stereo stem moved between the speakers: equal power, the centre left as it is."""
    a = (pan + 1) * np.pi / 4
    return np.stack([x[0] * np.cos(a) * np.sqrt(2), x[1] * np.sin(a) * np.sqrt(2)])


def render_sounds(track, cue, total):
    """A track of recordings: each (start beat, length in beats or 0 for all of it, file under public/audio, level dB,
    and optionally fade_in and fade_out in seconds) laid into a stereo stem."""
    beat = 60.0 / cue["tempo"]
    stem = np.zeros((2, total))
    for note in track["notes"]:
        start, length, file, level = note[:4]
        opt = dict(note[4]) if len(note) > 4 else {}
        y = decode_file(os.path.join(AUDIO, file))
        if length:
            y = y[:, : int(round(length * beat * SR))]
        y = y * from_db(level)
        n = y.shape[1]
        ramp = np.ones(n)
        fi, fo = int(opt.get("fade_in", 0.004) * SR), int(opt.get("fade_out", 0.02) * SR)
        if fi:
            ramp[:fi] *= np.linspace(0.0, 1.0, fi)
        if fo:
            ramp[n - fo :] *= np.linspace(1.0, 0.0, fo)
        y = y * ramp
        a = int(round((cue["lead"] + start * beat) * SR))
        b = min(total, a + n)
        if b > a:
            stem[:, a:b] += y[:, : b - a]
    return stem, []


def render_track(track, cue, total):
    """A track's dry stem, 2 by total, before its gain and pan, and the place of each note in it."""
    beat = 60.0 / cue["tempo"]
    inst = track["inst"]
    if INSTRUMENTS[inst]["kind"] == "sound":
        return render_sounds(track, cue, total)
    synth = INSTRUMENTS[inst]["kind"] == "synth"
    stem = np.zeros((1, total) if synth else (2, total))
    placed = []
    for i, note in enumerate(track["notes"]):
        start, length, pitch, velocity = note[:4]
        opt = dict(note[4]) if len(note) > 4 else {}
        midi = midi_of(pitch) + track.get("transpose", 0)
        rng = np.random.default_rng(zlib.crc32(f"{track['name']} {start} {midi}".encode()))
        at = cue["lead"] + start * beat
        info = {}
        if synth:
            at += float(rng.uniform(0.0, 0.004))  # a cylinder's pins are not laid by a clock
            y = tine(midi, velocity, rng, opt.get("cents", 0.0))[None, :]
        else:
            y, info = sampler_note(inst, midi, length * beat, velocity, opt)
        a = int(round(at * SR))
        b = min(total, a + y.shape[1])
        if b > a:
            stem[:, a:b] += y[:, : b - a]
        placed.append(dict(at=at, nominal=cue["lead"] + start * beat, seconds=length * beat, midi=midi, start=start, pitch=pitch, shaped="shape" in opt, **info))
    if synth:
        mono = box(stem[0])
        stem = np.stack([mono, mono]) * np.sqrt(0.5)
    return hp(stem, 22.0, 2), placed


def render(name):
    """Renders a cue: its mix, its dry melody, and everything the check needs."""
    cue = CUES[name]
    beat = 60.0 / cue["tempo"]
    melody_starts = [cue["lead"] + n[0] * beat for t in cue["tracks"] if t.get("melody") for n in t["notes"]]
    last = max(melody_starts) if melody_starts else 0.0
    cut_at = cut_end = None
    if "cut" in cue:
        cut_at = last + cue["cut"]["after_last"]
        cut_end = cut_at + cue["cut"]["fade"]
        length = cut_end + cue["cut"]["tail"]
    elif "hard_cut" in cue:
        cut_end = cue["hard_cut"]["at"]
        cut_at = cut_end - cue["hard_cut"]["fade"]
        length = cue["hard_cut"]["length"]
    elif "length" in cue:
        length = cue["length"]
    else:
        length = last + cue["ring"]
    work = int(round(length * SR))
    t = np.arange(work) / SR
    dry_gate = np.ones(work)
    if cut_at is not None:
        dry_gate = 1 - smooth_step((t - cut_at) / (cut_end - cut_at))
        dry_gate[t >= cut_end] = 0.0
    dry = np.zeros((2, work))
    melody = np.zeros((2, work))
    sends = {}
    stems = []
    for track in cue["tracks"]:
        raw, placed = render_track(track, cue, work)
        stem = place(raw, track.get("pan", 0.0)) * from_db(track.get("gain", 0.0)) * dry_gate
        dry += stem
        if track.get("melody"):
            melody += stem
        for bus, level in track.get("send", {}).items():
            sends[bus] = sends.get(bus, 0) + stem * from_db(level)
        stems.append(dict(track=track, raw=raw, stem=stem, notes=placed))
    wet = np.zeros((2, work))
    for bus, x in sends.items():
        wet += reverb(x, bus)[:, :work]
    if "cut" in cue:
        # the tail is the room's own, hurried so that it is gone when the file ends
        u = np.clip((t - cut_end) / cue["cut"]["tail"], 0.0, 1.0)
        wet *= from_db(-34.0 * u) * (1 - smooth_step((t - (length - 0.08)) / 0.08))
    mix = dry + wet
    if "hard_cut" in cue:
        mix *= dry_gate
    elif "cut" not in cue:
        fade = cue.get("fade_out", 1.0)
        out = 1 - smooth_step((t - (length - fade)) / fade)
        mix *= out
        melody *= out
    # level: the target loudness, then the ceiling
    notes = []
    gain = from_db(cue["lufs"] - loudness(mix))
    peak = true_peak(mix * gain)
    if peak > PEAK_CEILING - 0.3:
        gain *= from_db(PEAK_CEILING - 0.3 - peak)
        notes.append(f"held under the ceiling: {peak - (PEAK_CEILING - 0.3):.1f} dB quieter than the target loudness")
    return dict(name=name, cue=cue, mix=mix * gain, melody=melody * gain, stems=stems, gain=gain, length=length, cut_at=cut_at, cut_end=cut_end, last=last, notes=notes)


def write(r, out_dir):
    """Writes the MP3 (and the dry melody as WAV); lowers the level if the MP3 as decoded overshoots the ceiling."""
    path = os.path.join(out_dir, r["name"] + ".mp3")
    held = bool(r["notes"])
    for turn in range(5):
        encode_mp3(path, r["mix"])
        back = decode_file(path)
        over = true_peak(back) - PEAK_CEILING
        off = r["cue"]["lufs"] - loudness(back)
        if over > 0:
            g = from_db(-over - 0.1)
            held = True
            r["notes"].append(f"MP3 overshoot: lowered by {over + 0.1:.2f} dB")
        elif abs(off) > 0.05 and not held and turn < 3:
            # the encoder does not give back the level it was given (LAME scales by about 0.95): aim at the file as decoded
            g = from_db(min(off, -over - 0.1))
            r["trim"] = r.get("trim", 0.0) + db(g)
        else:
            break
        r["mix"] *= g
        r["melody"] *= g
        r["gain"] *= g
    r["mp3"] = path
    r["decoded"] = back
    if any(t.get("melody") for t in r["cue"]["tracks"]):
        r["melody_wav"] = os.path.join(out_dir, r["name"] + "_melody_dry.wav")
        write_wav(r["melody_wav"], r["melody"], 24)
    return path


# ---------------------------------------------------------------- the check


def check(r):
    """Prints what was asked for against what is measured in the render. Returns the number of failures."""
    cue, name = r["cue"], r["name"]
    bad = 0
    print(f"\n=== {name}: {r['length']:.3f} s, tempo {cue['tempo']}, target {cue['lufs']:.1f} LUFS ===")
    for n in r["notes"]:
        print("  note:", n)
    if r.get("trim"):
        print(f"  the mix was raised by {r['trim']:+.2f} dB after a first encoding, so that the MP3 as decoded is on target")
    # 1. the melody: onsets and pitches, measured on the dry melody stem
    lead = [s for s in r["stems"] if s["track"].get("melody") and s["track"].get("check", True)]
    if lead:
        mono = r["melody"].mean(axis=0)
        found = find_onsets(mono)
        expected = sorted(lead[0]["notes"], key=lambda n: n["at"])
        print(f"  melody, from the dry melody stem ({len(found)} onsets found, {len(expected)} written):")
        print("    #  bar.beat note   written s  found s   diff ms |  written Hz   YIN Hz   cents | new peak Hz  cents | ok")
        used = set()
        for i, n in enumerate(expected):
            near = min(range(len(found)), key=lambda j: abs(found[j] - n["nominal"])) if found else None
            t_found = found[near] if near is not None else float("nan")
            if near is not None:
                used.add(near)
            nxt = expected[i + 1]["nominal"] if i + 1 < len(expected) else r["length"]
            stop = min(nxt - 0.02, t_found + 0.4)
            if r["cut_at"] is not None:
                stop = min(stop, r["cut_at"])
            want = hz_of(n["midi"])
            hz, ap, new = note_pitch(mono, t_found + 0.03, stop, want / 1.9, want * 2.6) if near is not None else (None, None, None)
            d_ms = (t_found - n["nominal"]) * 1000
            c1 = cents(hz, want) if hz else float("nan")
            c2 = cents(new, want) if new else float("nan")
            ok = abs(d_ms) <= 20 and abs(c1) <= 20 and abs(c2) <= 20
            bad += 0 if ok else 1
            bar, bt = divmod(n["start"], 3)
            print(f"   {i + 1:2d}  {int(bar) + 1}.{bt + 1:<4g} {n['pitch']:5s} {n['nominal']:9.3f} {t_found:9.3f} {d_ms:+8.1f} | {want:10.2f} {hz or 0:9.2f} {c1:+7.1f} | {new or 0:10.2f} {c2:+6.1f} | {'yes' if ok else 'NO'}")
        extra = [f"{found[j]:.3f}" for j in range(len(found)) if j not in used]
        if extra or len(found) != len(expected):
            print(f"    onsets with no written note: {', '.join(extra) or 'none'}")
            bad += 1
    # 2. every other line: the pitch of each note in its own dry stem
    rows = []
    for s in r["stems"]:
        tr = s["track"]
        if tr.get("melody") or tr.get("check", True) is not True:
            continue
        mono = s["raw"].mean(axis=0)
        for n in s["notes"]:
            a = n["at"] + max(0.45 * n["seconds"], min(0.8, 0.6 * n["seconds"]))
            b = n["at"] + 0.92 * n["seconds"]
            if r["cut_at"] is not None and "hard_cut" not in cue:
                b = min(b, r["cut_at"])
            if b - a < 0.45:
                continue
            want = hz_of(n["midi"])
            hz, ap = yin_median(mono[int(a * SR) : int(b * SR)], want / 1.9, want * 1.9, frame=int(max(2048, 8 * SR / want)), hops=7)
            c = cents(hz, want)
            ok = abs(c) <= 20
            bad += 0 if ok else 1
            lv = db(box_rms(mono[int(a * SR) : int(b * SR)], int(0.3 * SR))[int(0.15 * SR) : -int(0.15 * SR)])
            held = "swell" if n.get("shaped") else f"level within {lv.max() - lv.min():3.1f} dB"
            rows.append(f"    {tr['name']:12s} {n['pitch']:4s} at {n['at']:6.2f} s for {n['seconds']:4.1f} s  written {want:7.2f} Hz  YIN {hz:7.2f} Hz {c:+5.1f} cents  {'yes' if ok else 'NO '}  {held}{', looped' if n.get('looped') else ''}  [{'; '.join(n.get('files', []))}]")
    for s in r["stems"]:
        tr = s["track"]
        if tr.get("check") != "partials":
            continue
        low = min(n["midi"] for n in s["notes"])
        at = min(n["at"] for n in s["notes"])
        seg = s["raw"].mean(axis=0)[int((at + 0.1) * SR) : int((at + 2.1) * SR)]
        got, off = [], []
        for hz, amp in sorted(spectrum_peaks(seg, hz_of(low) * 0.7, hz_of(low) * 12.5, count=8)):
            k = max(1, int(round(hz / hz_of(low))))
            off.append(cents(hz, k * hz_of(low)))
            got.append(f"{hz:.1f} Hz = {k} x {name_of(hz_of(low))} {off[-1]:+.0f} c")
        # a piano's bass strings are stiff: their partials lie wider apart than whole multiples, so the low ones read
        # flat and the high ones sharp around the pitch the note was tuned to. The middle of them is what is judged.
        ok = abs(float(np.median(off))) <= 20
        bad += 0 if ok else 1
        rows.append(f"    {tr['name']:12s} {', '.join(n['pitch'] for n in s['notes'])} struck at {at:.2f} s: strongest partials: " + "; ".join(got) + f"; median {np.median(off):+.0f} c  {'yes' if ok else 'NO'}  [{'; '.join(f for n in s['notes'] for f in n.get('files', []))}]")
    if rows:
        print("  the other lines, each note in its own dry stem (median YIN over the later part of the note; then how steady its level is there, and the sample with how far it was moved):")
        print("\n".join(rows))
    # 3. the mix as written and as the MP3 decodes
    wav, mp3 = r["mix"], r["decoded"]
    n = min(wav.shape[1], mp3.shape[1])
    a, b = wav.mean(0)[:n], mp3.mean(0)[:n]
    m = fast_len(2 * n)
    xc = np.fft.irfft(np.conj(np.fft.rfft(a, m)) * np.fft.rfft(b, m), m)
    lag = int(np.argmax(xc))
    lag = lag - m if lag > m // 2 else lag
    il, tp = loudness(mp3), true_peak(mp3)
    ff_i, ff_tp = ffmpeg_loudness(r["mp3"])
    corr, side = stereo_report(mp3)
    dc = np.abs(mp3.mean(axis=1)).max()
    print(f"  mix (WAV before MP3): {loudness(wav):6.2f} LUFS, true peak {true_peak(wav):6.2f} dBTP, {wav.shape[1] / SR:.3f} s")
    print(f"  MP3 as decoded      : {il:6.2f} LUFS, true peak {tp:6.2f} dBTP, {mp3.shape[1] / SR:.3f} s, {os.path.getsize(r['mp3'])} bytes; ffmpeg ebur128 reads {ff_i} LUFS, {ff_tp} dBTP")
    print(f"    against the WAV: starts {lag / SR * 1000:+.2f} ms later, {mp3.shape[1] - wav.shape[1]:+d} samples longer")
    short = r["length"] < 3.0
    tol = 1.0 if short else 0.3
    if abs(il - cue["lufs"]) > tol and not r["notes"]:
        print(f"    LOUDNESS off target by {il - cue['lufs']:+.2f} LU")
        bad += 1
    if tp > PEAK_CEILING + 1e-6:
        print("    TRUE PEAK over the ceiling")
        bad += 1
    print(f"    DC: {dc:.2e} of full scale ({db(dc):.0f} dBFS); under 20 Hz: {band_share(mp3, 0, 20):.1f} dB of the whole")
    print(f"    above 16 kHz: WAV {band_share(wav, 16000):.1f} dB, MP3 {band_share(mp3, 16000):.1f} dB of the whole; above 19 kHz: WAV {band_share(wav, 19000):.1f} dB")
    print(f"    stereo: correlation {corr:+.2f}, side {side:.1f} dB under mid")
    if dc > 1e-3 or corr < 0.0:
        bad += 1
    # 4. loudness of the lines inside the mix
    parts = []
    for s in r["stems"]:
        parts.append(f"{s['track']['name']} {loudness(s['stem'] * r['gain']):.1f}")
    print("    dry lines, LUFS each: " + ", ".join(parts))
    if lead:
        tune = sum(s["stem"] for s in r["stems"] if s["track"].get("melody"))
        rest = sum(s["stem"] for s in r["stems"] if not s["track"].get("melody"))
        print(f"    the melody together {loudness(tune * r['gain']):.1f} LUFS, everything else together {loudness(rest * r['gain']):.1f} LUFS (dry)")
    if r["length"] < 6.5:
        print("    MP3 level every 0.25 s (dBFS rms): " + " ".join(f"{level_db(mp3, u, u + 0.25)[0]:.0f}" for u in np.arange(0, r["length"] - 1e-6, 0.25)))
    # 5. the cut
    if "cut" in cue:
        ce = r["cut_end"]
        dry_after = sum(float(np.abs(s["stem"][:, int(np.ceil(ce * SR)) :]).max()) for s in r["stems"])
        print(f"  cut: last melody note at {r['last']:.3f} s, dry sound fades from {r['cut_at']:.3f} to {ce:.3f} s; dry stems after that: peak {dry_after:.1e} ({'silent' if dry_after == 0 else 'NOT SILENT'})")
        bad += 0 if dry_after == 0 else 1
        for label, x in (("WAV", wav), ("MP3", mp3)):
            seq = ", ".join(f"{u:.2f}-{v:.2f} s {level_db(x, ce + u, ce + v)[0]:6.1f}" for u, v in ((-0.25, -0.05), (0.0, 0.2), (0.4, 0.6), (0.8, 1.0), (1.1, 1.2)))
            print(f"    {label} level round the cut (dBFS rms; times from the end of the fade): {seq}")
        print(f"    reverb tail kept: {r['length'] - ce:.3f} s; last 20 ms of the MP3: {level_db(mp3, mp3.shape[1] / SR - 0.02, mp3.shape[1] / SR)[1]:.1f} dBFS peak")
    if "hard_cut" in cue:
        at = cue["hard_cut"]["at"]
        w_after = float(np.abs(wav[:, int(round(at * SR)) :]).max())
        print(f"  hard cut at {at:.3f} s ({cue['hard_cut']['fade'] * 1000:.0f} ms fade before it): WAV after it: peak {w_after:.1e} ({'digital silence' if w_after == 0 else 'NOT SILENT'})")
        bad += 0 if w_after == 0 else 1
        print(f"    level just before the cut ({at - 0.1:.2f} to {at - 0.01:.2f} s): WAV {level_db(wav, at - 0.1, at - 0.01)[0]:.1f}, MP3 {level_db(mp3, at - 0.1, at - 0.01)[0]:.1f} dBFS rms")
        for u, v in ((0.0, 0.01), (0.01, 0.03), (0.03, 0.2)):
            rms_, pk_ = level_db(mp3, at + u, min(at + v, mp3.shape[1] / SR))
            print(f"    MP3 {at + u:.2f} to {at + v:.2f} s: rms {rms_:7.1f} dBFS, peak {pk_:7.1f} dBFS")
        tail_pk = level_db(mp3, at + 0.03, mp3.shape[1] / SR)[1]
        if tail_pk > -60:
            bad += 1
    if "cut" not in cue and "hard_cut" not in cue:
        print(f"  end: last 50 ms of the MP3 peak {level_db(mp3, mp3.shape[1] / SR - 0.05, mp3.shape[1] / SR)[1]:.1f} dBFS")
    print(f"  {name}: {'all within tolerance' if bad == 0 else str(bad) + ' OUT OF TOLERANCE'}")
    return bad


# ---------------------------------------------------------------- reports


def partial_report(x, label, top=8):
    """Partials of one note: frequency, ratio to the fundamental, level, decay time; brightness over time; overall decay."""
    x = x.mean(axis=0) if x.ndim == 2 else x
    env = np.abs(x)
    on = int(np.argmax(env > 0.1 * env.max()))
    x = x[max(0, on - 64) :]
    n, hop = 4096, 256
    w = np.hanning(n)
    k = 1 + max(0, (len(x) - n) // hop)
    idx = np.arange(n)[None, :] + hop * np.arange(k)[:, None]
    S = np.abs(np.fft.rfft(x[idx] * w, axis=1)) * 2 / w.sum()
    t = (np.arange(k) * hop + n // 2) / SR
    first = S[: max(1, int(0.25 * SR / hop))].max(axis=0)
    peaks = []
    for i in range(3, len(first) - 3):
        if first[i] > first[i - 1] and first[i] >= first[i + 1] and first[i] == first[max(0, i - 6) : i + 7].max():
            a, b, c = np.log(first[i - 1 : i + 2] + 1e-12)
            peaks.append((first[i], (i + 0.5 * (a - c) / (a - 2 * b + c)) * SR / n, i))
    peaks.sort(reverse=True)
    peaks = [p for p in peaks if db(p[0] / peaks[0][0]) > -50][:top]
    f0 = min(p[1] for p in peaks if db(p[0] / peaks[0][0]) > -25)
    tail = db(np.sqrt(np.mean(x[-int(0.15 * SR) :] ** 2)))
    lines = []
    for amp, hz, i in sorted(peaks, key=lambda p: p[1]):
        track = db(S[:, i - 1 : i + 2].max(axis=1))
        j0 = int(np.argmax(track))
        j1 = j0
        while j1 + 1 < len(track) and track[j1 + 1] > max(track[j0] - 30, tail - 12):
            j1 += 1
        t60 = float("nan")
        if j1 - j0 >= 4:
            slope = np.polyfit(t[j0 : j1 + 1], track[j0 : j1 + 1], 1)[0]
            t60 = -60 / slope if slope < 0 else float("inf")
        lines.append(f"x{hz / f0:6.2f} {db(amp / peaks[0][0]):6.1f} dB {t60:5.2f} s")
    bright = []
    for a, b in ((0.0, 0.03), (0.03, 0.1), (0.1, 0.3), (0.3, 1.0)):
        seg = x[int(a * SR) + 64 : int(b * SR) + 64]
        if len(seg) > 256:
            P = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2
            ff = np.fft.rfftfreq(len(seg), 1 / SR)
            bright.append(np.sum(ff * P) / np.sum(P))
    e = db(box_rms(x, 1024))
    j0 = int(np.argmax(e))
    a = j0 + int(np.argmax(e[j0:] < e[j0] - 5))
    under = np.where(e[a:] < max(e[j0] - 35, tail + 6))[0]
    b = a + (int(under[0]) if len(under) else len(e) - a - 1)
    t60 = -60 / np.polyfit(np.arange(a, b) / SR, e[a:b], 1)[0] if b - a > 2000 else float("nan")
    rise = (int(np.argmax(env[on:] >= 0.9 * env.max())) + on - int(np.argmax(env > 0.1 * env.max()))) / SR * 1000
    print(f"  {label:34s} f0 {f0:7.1f} Hz {name_of(f0):4s} T60 {t60:5.2f} s  rise {rise:5.1f} ms  centroid/f0: " + " ".join(f"{c / f0:5.2f}" for c in bright) + f"  ({bright[0]:.0f} Hz to {bright[-1]:.0f} Hz)")
    print("      partials (ratio, level, T60): " + " | ".join(lines))
    return dict(f0=f0, t60=t60, bright=[c / f0 for c in bright])


def musicbox_report():
    print("Real music box (Freesound 70173 to 70188, folkman, CC0), each note as recorded:")
    real = []
    for s in sorted(bank("musicbox_real")[0][0], key=lambda s: s.midi):
        real.append(partial_report(s.x * 1.0, os.path.basename(s.path)))
    low = [r for r in real if r["f0"] < 1400]
    print(f"  summary of the notes under 1400 Hz: T60 {min(r['t60'] for r in low):.1f} to {max(r['t60'] for r in low):.1f} s (median {np.median([r['t60'] for r in low]):.1f}); "
          f"centroid/f0 in the first 30 ms {min(r['bright'][0] for r in low):.2f} to {max(r['bright'][0] for r in low):.2f}, after 100 ms {min(r['bright'][2] for r in low):.2f} to {max(r['bright'][2] for r in low):.2f}")
    for label, inst in (("synthesised music box", "musicbox"), ("real music box, re-pitched", "musicbox_real"), ("glockenspiel, re-pitched", "glock")):
        print(f"\n{label}, single dry notes:")
        for pitch in ("D4", "A4", "Bb4", "D5", "A5"):
            cue = dict(tempo=60, lead=0.05)
            track = dict(name="report", inst=inst, notes=[(0, 1, pitch, 96)])
            raw, _ = render_track(track, cue, int(9 * SR))
            last = np.where(np.abs(raw).max(axis=0) > 1e-7)[0]
            partial_report(raw[:, : int(last[-1]) + 1], f"{inst} {pitch}")


def selftest():
    bad = 0
    print("resampler (windowed sinc, 32 zero crossings, Kaiser beta 10, 512 phases): a sine in, what comes out")
    n = SR * 2
    t = np.arange(n) / SR
    for f_in, semis in ((440.0, 2), (440.0, -1), (880.0, -12), (5000.0, 3), (15000.0, -5), (15000.0, 4), (20500.0, 7)):
        ratio = 2 ** (semis / 12)
        y = resample(np.sin(TAU * f_in * t), ratio)[2000:-2000]
        amp = db(np.sqrt(2 * np.mean(y * y)))
        y = y * np.hanning(len(y))
        S = np.abs(np.fft.rfft(y))
        f = np.fft.rfftfreq(len(y), 1 / SR)
        want = f_in * ratio
        if want < SR / 2:
            i = int(np.argmax(S))
            peak = S[i]
            spur = S.copy()
            spur[max(0, i - 40) : i + 41] = 0
            print(f"  {f_in:7.0f} Hz {semis:+3d} semitones -> strongest at {f[i]:8.1f} Hz (written {want:8.1f}), level {amp:+6.2f} dB, strongest other component {db(spur.max() / peak):6.1f} dB at {f[int(np.argmax(spur))]:7.0f} Hz")
            ok = abs(f[i] - want) < 1.0 and db(spur.max() / peak) < -80 and (abs(amp) < 0.1 or want > 0.4 * SR)
        else:
            print(f"  {f_in:7.0f} Hz {semis:+3d} semitones -> would be {want:.0f} Hz, over Nyquist: what is left is {db(S.max() * 4 / len(y)):6.1f} dB at {f[int(np.argmax(S))]:.0f} Hz (aliasing if it were loud)")
            ok = db(S.max() * 4 / len(y)) < -80
        bad += 0 if ok else 1
    print("loudness meter (BS.1770): known signals")
    s = np.sin(TAU * 1000 * np.arange(SR * 20) / SR)
    for label, x, want in (("1 kHz sine, -23 dBFS, both channels (EBU 3341 case 1)", np.stack([s, s]) * from_db(-23), -23.0),
                           ("1 kHz sine, -33 dBFS, both channels (EBU 3341 case 2)", np.stack([s, s]) * from_db(-33), -33.0),
                           ("997 Hz sine, 0 dBFS, left only (BS.1770: -3.01)", np.stack([np.sin(TAU * 997 * np.arange(SR * 20) / SR), np.zeros(SR * 20)]), -3.01)):
        got = loudness(x)
        print(f"  {label}: {got:.2f} LUFS (should be {want:.2f})")
        bad += 0 if abs(got - want) < 0.1 else 1
    gated = np.concatenate([np.stack([s, s])[:, : SR * 10] * from_db(-36), np.stack([s, s])[:, : SR * 10] * from_db(-23)], axis=1)
    got = loudness(gated)
    print(f"  10 s at -36 then 10 s at -23 dBFS (relative gate, EBU 3341 case 3 in short): {got:.2f} LUFS (should be -23.0)")
    bad += 0 if abs(got + 23.0) < 0.1 else 1
    quarter = np.sin(TAU * np.arange(SR) / 4 + np.pi / 4) * smooth_step(np.arange(SR) / 4000) * smooth_step((SR - np.arange(SR)) / 4000)
    print(f"true peak: a full-scale sine at a quarter of the rate, 45 degrees off the samples, has a sample peak of {db(np.abs(quarter).max()):.2f} dBFS and reads {true_peak(quarter):.2f} dBTP (should be 0.00)")
    bad += 0 if abs(true_peak(quarter)) < 0.05 else 1
    print("reverb: the synthetic impulse responses, measured (decay time from a line through each band's level over time, 5 to 45 dB under its top)")
    for name, p in REVERBS.items():
        ir = impulse_response(name)
        n, hop = 2048, 512
        k = 1 + (ir.shape[1] - n) // hop
        idx = np.arange(n)[None, :] + hop * np.arange(k)[:, None]
        P = np.abs(np.fft.rfft(ir[0][idx] * np.hanning(n), axis=1)) ** 2 + np.abs(np.fft.rfft(ir[1][idx] * np.hanning(n), axis=1)) ** 2
        f = np.fft.rfftfreq(n, 1 / SR)
        t = (np.arange(k) * hop + n / 2) / SR
        row = []
        for lo, hi in ((177, 354), (707, 1414), (2828, 5657), (8000, 16000)):
            e = 10 * np.log10(P[:, (f >= lo) & (f < hi)].sum(axis=1) + 1e-30)
            j0 = int(np.argmax(e))
            sel = (np.arange(k) > j0) & (e > e[j0] - 45) & (e < e[j0] - 5)
            row.append(f"{int(np.sqrt(lo * hi))} Hz {-60 / np.polyfit(t[sel], e[sel], 1)[0]:.2f} s")
        first = int(np.argmax(np.abs(ir[0]) > 1e-4 * np.abs(ir[0]).max()))
        lr = float(np.sum(ir[0] * ir[1]))
        print(f"  {name}: written T60 {p['t60']} s, pre-delay {p['pre'] * 1000:.0f} ms; {ir.shape[1] / SR:.2f} s long, first sound after {first / SR * 1000:.1f} ms, T60 " + ", ".join(row) + f"; left against right correlation {lr:+.3f}")
        bad += 0 if abs(lr) < 0.2 else 1
    print("onset detector: synthesised music box notes at known times, ringing over each other")
    rng = np.random.default_rng(5)
    x = np.zeros(SR * 6)
    times = [0.25, 1.159, 1.61, 2.068, 2.977, 3.2, 4.3]
    for at, m in zip(times, (69, 67, 65, 64, 77, 62, 61)):
        y = tine(m, 90, rng)
        a = int(round(at * SR))
        x[a : a + len(y)] += y[: len(x) - a]
    found = find_onsets(box(x))
    print("  written: " + " ".join(f"{v:.4f}" for v in times))
    print("  found  : " + " ".join(f"{v:.4f}" for v in found))
    if len(found) == len(times):
        err = [(a - b) * 1000 for a, b in zip(found, times)]
        print(f"  error: {min(err):+.2f} to {max(err):+.2f} ms")
        bad += 0 if max(abs(e) for e in err) < 5 else 1
    else:
        bad += 1
    print(f"selftest: {'passed' if bad == 0 else str(bad) + ' FAILED'}")
    return bad


def main():
    ap = argparse.ArgumentParser(description="Renders the film's score from the CUES table and checks each cue by measurement.")
    ap.add_argument("--only", help="comma separated cue names, or a prefix ending in *")
    ap.add_argument("--out", default=DEFAULT_OUT, help="folder for the MP3 files and the dry melody WAV files")
    ap.add_argument("--alt", action="store_true", help="also render the cues marked alt")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--musicbox-report", action="store_true")
    ap.add_argument("--wav", action="store_true", help="also write the mix as WAV")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if args.list:
        for name, cue in CUES.items():
            print(name, "alt" if cue.get("alt") else "", f"{cue['lufs']} LUFS", ", ".join(f"{t['name']} ({t['inst']})" for t in cue["tracks"]))
        return
    if args.selftest:
        raise SystemExit(1 if selftest() else 0)
    if args.musicbox_report:
        musicbox_report()
        return
    names = [n for n, c in CUES.items() if args.alt or not c.get("alt")]
    if args.only:
        wanted = args.only.split(",")
        unknown = [w for w in wanted if not w.endswith("*") and w not in CUES]
        if unknown:
            raise SystemExit("unknown: " + ", ".join(unknown))
        names = [n for n in CUES if any(n == w or (w.endswith("*") and n.startswith(w[:-1])) for w in wanted)]
    os.makedirs(args.out, exist_ok=True)
    t0 = time.time()
    bad = 0
    for name in names:
        t1 = time.time()
        r = render(name)
        write(r, args.out)
        if args.wav:
            write_wav(os.path.join(args.out, name + ".wav"), r["mix"], 24)
        print(f"\nrendered {name} in {time.time() - t1:.1f} s -> {r['mp3']}" + (f" and {r['melody_wav']}" if "melody_wav" in r else ""))
        bad += check(r)
    print("\nsample files that sounded:")
    for inst in sorted(USED_FILES):
        print(f"  {inst}: " + ", ".join(sorted(USED_FILES[inst])))
    print(f"\n{len(names)} cues in {time.time() - t0:.0f} s; {'every check within tolerance' if bad == 0 else str(bad) + ' checks OUT OF TOLERANCE'}")
    if bad:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
