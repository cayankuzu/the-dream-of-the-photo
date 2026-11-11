#!/usr/bin/env python3
"""
The spoken lines of the piece: every file of a voice folder is rendered by this script, on this machine.

  VENV = .asset-cache\\voice\\venv\\Scripts\\python.exe      (set up once with scripts/voice/setup-voice.ps1)

  VENV scripts/voice/build-voice.py --lines lines.json --out public/audio/voice
  VENV scripts/voice/build-voice.py --lines lines.json --out public/audio/voice --lang tr
  VENV scripts/voice/build-voice.py --lines lines.json --out public/audio/voice --only wake_1,wake_2,table_*
  VENV scripts/voice/build-voice.py --lines lines.json --out public/audio/voice --check     measure what is on disk

lines.json is a list: [{"key": "wake_1", "tr": "Uyandın.", "en": "You are awake.", "voice": "narrator"}, ...]
with voice one of narrator, house, phone, dream (see VOICES below); "speaker" may name another speaker than the
voice's own (the narrator's voice heard down a telephone). A line with "cut_from" (the key of another line) and
"cut" ({"tr": [words, share], "en": [...]}) is not spoken: it is cut out of that line's finished clip after its
first `words` words (and `share` of the next one), or at "cut_at" ({"tr": s, "en": s}) where that was measured, so
that the voice stops dead in the middle of its tune. It writes

  <out>/<lang>/<key>.mp3      mono, 44.1 kHz, 80 kbps
  <out>/manifest.json         {key: {"tr": seconds, "en": seconds}}
  <out>/report.json           every measurement of every line, and of every take that was thrown away
  <out>/.voice-cache/         the takes as wav and the hashes; safe to delete, never to be published

How a line is made. The speech engine is asked for several takes of it (it is stochastic: no two are the same).
The engine is then put away and a speech recogniser (Whisper large-v3) listens to every take: a take that does not
say the words of the line, says more than them, or ends in the middle of a sound, fails. Of the takes that pass,
the one a naturalness predictor (UTMOS) likes best is kept. A line with no passing take is rendered again with new
seeds, up to --rounds times; after that the least bad take is kept and the line is marked "failed" in report.json
and the script exits with status 2. Only one model is in memory at any time.

The kept take is cut to the speech with 60 ms of its own air on either side, high-passed at 30 Hz, given the
treatment of its voice (the phone line), brought to the same integrated loudness as every other line (ITU-R
BS.1770-4, K-weighted and gated; see lufs()) under a look-ahead limiter, and encoded the way
scripts/build-room-audio.py encodes: float PCM piped into the ffmpeg of imageio-ffmpeg, libmp3lame.

A line whose text, voice and settings have not changed since the last run is skipped (a hash is kept in
<out>/.voice-cache/state.json); --force renders it again.

Everything runs locally. Engines, weights, speakers and their licences: scripts/voice/README.md.
"""
import argparse
import gc
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, ".asset-cache", "voice")
MODELS = os.path.join(CACHE, "models")
REFS = os.path.join(HERE, "refs")

# every cache a library might want goes under .asset-cache/voice/models (gitignored); set before they are imported
for _name, _sub in (("HF_HOME", "hf"), ("TORCH_HOME", "torch"), ("XDG_CACHE_HOME", "xdg"), ("MODELSCOPE_CACHE", "modelscope"), ("NLTK_DATA", "nltk"), ("NUMBA_CACHE_DIR", "numba"), ("PKUSEG_HOME", "pkuseg")):
    os.environ.setdefault(_name, os.path.join(MODELS, _sub))
os.environ.setdefault("HF_HUB_OFFLINE", "1")  # every weight is a file under MODELS already; nothing is fetched while building
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("PYTHONUTF8", "1")

import numpy as np
import imageio_ffmpeg

SR = 44100
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
KBPS = 80
LUFS = -19.0  # integrated loudness of every line
CEILING = -1.5  # dBFS, sample peak after the limiter
PAD = 0.060  # seconds of air kept before and after the speech
SETTINGS_VERSION = 1  # raise it to make every line render again


# ---------------------------------------------------------------- measuring and levels (as in build-room-audio.py)


def db(v):
    return 20 * np.log10(np.maximum(v, 1e-12))


def from_db(d):
    return 10 ** (d / 20)


def peak(x):
    return float(np.abs(x).max()) if x.size else 0.0


def rms(x):
    return float(np.sqrt(np.mean(np.square(x)))) if x.size else 0.0


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


def filt(x, H, sr=SR):
    """Zero-phase filter by a real gain curve H(f); the signal is padded by reflection."""
    n = x.shape[-1]
    pad = min(max(n - 1, 0), sr // 4)
    z = np.pad(x, (pad, pad), mode="reflect") if pad else x
    m = fast_len(z.shape[-1])
    f = np.fft.rfftfreq(m, 1 / sr)
    y = np.fft.irfft(np.fft.rfft(z, m) * H(f), m)
    return y[pad : pad + n]


def hp(x, hz, order=4, sr=SR):
    return filt(x, lambda f: 1 / np.sqrt(1 + (hz / np.maximum(f, 1e-3)) ** (2 * order)), sr)


def lp(x, hz, order=4, sr=SR):
    return filt(x, lambda f: 1 / np.sqrt(1 + (f / hz) ** (2 * order)), sr)


def bell(x, hz, gain_db, octaves=0.5, sr=SR):
    g = gain_db / 20

    def H(f):
        o = np.log2(np.maximum(f, 1.0) / hz) / max(octaves, 1e-3)
        return 10 ** (g * np.exp(-2.77 * o * o))

    return filt(x, H, sr)


def fade(x, a=0.005, b=0.005, sr=SR):
    n = x.shape[-1]
    y = np.array(x, dtype=np.float64)
    ia, ib = min(n // 2, int(a * sr)), min(n // 2, int(b * sr))
    if ia > 0:
        y[:ia] *= np.sin(0.5 * np.pi * (np.arange(ia) + 0.5) / ia) ** 2
    if ib > 0:
        y[n - ib :] *= np.cos(0.5 * np.pi * (np.arange(ib) + 0.5) / ib) ** 2
    return y


def resample(x, sr_from, sr_to):
    if sr_from == sr_to:
        return np.asarray(x, dtype=np.float64)
    from scipy.signal import resample_poly

    g = math.gcd(int(sr_from), int(sr_to))
    return resample_poly(np.asarray(x, dtype=np.float64), sr_to // g, sr_from // g)


# ---------------------------------------------------------------- loudness: ITU-R BS.1770-4


def _k_curve(f, sr):
    """The K-weighting as a complex response at frequencies f: the two biquads of BS.1770, re-derived for this sample rate."""
    z = np.exp(-2j * np.pi * f / sr)
    # stage 1: the head, a high shelf of +4 dB
    f0, G, Q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    K = np.tan(np.pi * f0 / sr)
    Vh = 10 ** (G / 20)
    Vb = Vh**0.4996667741545416
    a0 = 1 + K / Q + K * K
    b = ((Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0)
    a = (2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0)
    H1 = (b[0] + b[1] * z + b[2] * z * z) / (1 + a[0] * z + a[1] * z * z)
    # stage 2: the RLB curve, a high-pass at 38 Hz
    f0, Q = 38.13547087602444, 0.5003270373238773
    K = np.tan(np.pi * f0 / sr)
    a0 = 1 + K / Q + K * K
    a = (2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0)
    H2 = (1 - 2 * z + z * z) / (1 + a[0] * z + a[1] * z * z)
    return H1 * H2


def k_weight(x, sr=SR):
    n = x.shape[-1]
    m = fast_len(n + sr // 2)  # room for the filters to ring out instead of wrapping round
    f = np.fft.rfftfreq(m, 1 / sr)
    return np.fft.irfft(np.fft.rfft(x, m) * _k_curve(f, sr), m)[:n]


def lufs(x, sr=SR):
    """Integrated loudness of a mono signal, LUFS: K-weighted, 400 ms blocks 75 % overlapped, gated at -70 absolute
    and at 10 LU under what passes that. A sound shorter than one block is measured as one block of its own length."""
    y = k_weight(np.asarray(x, dtype=np.float64), sr)
    block = int(0.4 * sr)
    if y.shape[-1] < block:
        z = np.array([np.mean(y * y)]) if y.size else np.array([0.0])
    else:
        hop = block // 4
        c = np.concatenate([[0.0], np.cumsum(y * y)])
        starts = np.arange(0, y.shape[-1] - block + 1, hop)
        z = (c[starts + block] - c[starts]) / block
    lk = -0.691 + 10 * np.log10(np.maximum(z, 1e-12))
    keep = z[lk > -70.0]
    if keep.size == 0:
        return -70.0
    rel = -0.691 + 10 * np.log10(np.mean(keep)) - 10.0
    keep = z[(lk > -70.0) & (lk > rel)]
    if keep.size == 0:
        return -70.0
    return float(-0.691 + 10 * np.log10(np.mean(keep)))


def limit(x, ceiling_db=CEILING, look=0.002, release=0.050, sr=SR):
    """Look-ahead peak limiter: the gain is already down when the peak arrives and comes back slowly."""
    c = from_db(ceiling_db)
    need = np.minimum(1.0, c / np.maximum(np.abs(x), 1e-12))
    if need.min() >= 1.0:
        return x
    from scipy.ndimage import minimum_filter1d, uniform_filter1d

    L = max(1, int(look * sr))
    R = max(1, int(release * sr))
    g = minimum_filter1d(need, size=2 * L + 1, mode="nearest")  # held from L before to L after each peak
    g = minimum_filter1d(g, size=R, origin=-(R // 2), mode="nearest")  # and for the release time after it
    g = uniform_filter1d(g, size=L, mode="nearest")  # eased; still never above what the peak needs
    return x * np.minimum(g, need)


def to_lufs(x, target=LUFS, ceiling_db=CEILING, sr=SR):
    """Gain to the target loudness under the limiter; the limiter takes a little loudness away, so it is done twice."""
    y = x
    for _ in range(3):
        now = lufs(y, sr)
        if now <= -69.0:
            return y
        y = limit(y * from_db(target - now), ceiling_db, sr=sr)
        if abs(lufs(y, sr) - target) < 0.05:
            break
    return y


# ---------------------------------------------------------------- files


def decode_file(path, sr=SR):
    """A file as mono float64 at sr."""
    p = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(sr), "pipe:1"], capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(f"cannot decode {path}: {p.stderr.decode('utf-8', 'replace')[:200]}")
    return np.frombuffer(p.stdout, dtype=np.float32).astype(np.float64)


def encode(path, x, kbps=KBPS, sr=SR):
    """Mono mp3, the way build-room-audio.py writes one."""
    tmp = path + ".tmp.mp3"
    p = subprocess.run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "pipe:0",
         "-c:a", "libmp3lame", "-b:a", f"{kbps}k", "-compression_level", "2", "-id3v2_version", "0", "-map_metadata", "-1", tmp],
        input=np.asarray(x, dtype=np.float32).tobytes(),
    )
    assert p.returncode == 0, path
    os.replace(tmp, path)


def write_wav(path, x, sr):
    import wave

    pcm = np.clip(np.asarray(x, dtype=np.float64), -1.0, 1.0)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(sr))
        w.writeframes((pcm * 32767.0).round().astype("<i2").tobytes())


def read_wav(path):
    import wave

    with wave.open(path, "rb") as w:
        sr = w.getframerate()
        ch = w.getnchannels()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768.0
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    return x, sr


# ---------------------------------------------------------------- where the speech is


def frame_db(x, sr, win=0.020, hop=0.005):
    """Level of the signal in short frames, dBFS, and the hop in samples."""
    w = max(1, int(win * sr))
    h = max(1, int(hop * sr))
    if x.shape[-1] < w:
        return np.array([db(rms(x))]), h
    c = np.concatenate([[0.0], np.cumsum(np.square(x))])
    starts = np.arange(0, x.shape[-1] - w + 1, h)
    return 10 * np.log10(np.maximum((c[starts + w] - c[starts]) / w, 1e-12)), h


def speech_span(x, sr):
    """First and last sample of the speech, and the frame levels used to find them. Speech is what comes within
    45 dB of the loudest frame (within 25 dB when the take has no silence in it at all)."""
    y = hp(x, 70.0, sr=sr) if x.shape[-1] > 64 else x
    lv, h = frame_db(y, sr)
    top = float(lv.max())
    floor = float(np.percentile(lv, 5))
    thr = min(top - 25.0, max(top - 45.0, floor + 8.0))
    on = np.flatnonzero(lv > thr)
    if on.size == 0:
        return 0, x.shape[-1], lv, h, thr
    w = int(0.020 * sr)
    return int(on[0] * h), int(min(x.shape[-1], on[-1] * h + w)), lv, h, thr


def pauses(x, sr, a, b, shortest=0.10):
    """Silences inside the speech: [(start seconds, end seconds)], at least `shortest` long."""
    y = hp(x, 70.0, sr=sr)
    lv, h = frame_db(y, sr)
    top = float(lv.max())
    quiet = lv < top - 35.0
    out = []
    i0, i1 = a // h, max(a // h, b // h - 4)
    start = None
    for i in range(i0, min(i1, len(quiet))):
        if quiet[i] and start is None:
            start = i
        elif not quiet[i] and start is not None:
            if (i - start) * h / sr >= shortest:
                out.append((start * h / sr + 0.010, i * h / sr + 0.010))
            start = None
    return out


def trim(x, sr, pad=PAD):
    """The take cut to its speech, with `pad` of what was really around it on either side (silence where there was
    nothing), eased in and out."""
    a, b, _, _, _ = speech_span(x, sr)
    k = int(pad * sr)
    head = x[max(0, a - k) : a]
    tail = x[b : b + k]
    head = np.concatenate([np.zeros(k - head.shape[-1]), head])
    tail = np.concatenate([tail, np.zeros(k - tail.shape[-1])])
    y = np.concatenate([head, x[a:b], tail])
    return fade(y, pad * 0.5, pad * 0.5, sr)


# ---------------------------------------------------------------- text


VOWELS = {"tr": set("aeıioöuüâîû"), "en": set("aeiouy")}
_ONES = {
    "tr": ["sıfır", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"],
    "en": ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"],
}
_TENS = {
    "tr": ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"],
    "en": ["", "ten", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"],
}


def number_words(n, lang):
    """0..9999 the way it is said; only used to read digits the recogniser writes."""
    if n > 9999:
        return " ".join(_ONES[lang][int(c)] for c in str(n))
    ones, tens = _ONES[lang], _TENS[lang]
    out = []
    if n >= 1000:
        k = n // 1000
        out += ([ones[k]] if not (lang == "tr" and k == 1) else []) + ["bin" if lang == "tr" else "thousand"]
        n %= 1000
    if n >= 100:
        k = n // 100
        out += ([ones[k]] if not (lang == "tr" and k == 1) else []) + ["yüz" if lang == "tr" else "hundred"]
        n %= 100
    if lang == "en" and 0 < n < 20:
        out.append(ones[n])
    else:
        if n >= 10:
            out.append(tens[n // 10])
        if n % 10 or not out:
            out.append(ones[n % 10])
    return " ".join(out)


def plain(s, lang):
    """Text as it is compared: lower case (the Turkish way for Turkish), digits as words, no punctuation."""
    s = unicodedata.normalize("NFC", s)
    if lang == "tr":
        s = s.replace("İ", "i").replace("I", "ı")
    s = s.lower().replace("i̇", "i")
    for a, b in (("â", "a"), ("î", "i"), ("û", "u")):
        s = s.replace(a, b)
    # the recogniser writes a half hour as a clock time: "6.30'da" is "altı buçukta", "6:30" is "half past six"
    if lang == "tr":
        s = re.sub(r"(\d{1,2})\s*[.:]\s*30(?!\d)", lambda m: number_words(int(m.group(1)), lang) + " buçuk", s)
        s = re.sub(r"buçuk['’]d([ae])\b", r"buçukt\1", s)
    else:
        s = re.sub(r"(\d{1,2})\s*[.:]\s*30(?!\d)", lambda m: "half past " + number_words(int(m.group(1)), lang), s)
    s = re.sub(r"\d+", lambda m: " " + number_words(int(m.group()), lang) + " ", s)
    s = re.sub(r"['’]", "", s)
    s = re.sub(r"[^\w\s]|_", " ", s)
    return " ".join(s.split())


def edits(a, b):
    """Levenshtein distance."""
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def cer(ref, hyp, lang):
    r, h = plain(ref, lang), plain(hyp, lang)
    return edits(r, h) / max(1, len(r))


def vowel_count(text, lang):
    """Syllable nuclei: every vowel letter in Turkish; vowel groups, less a silent final e, in English (an estimate)."""
    t = plain(text, lang)
    if lang == "tr":
        return sum(c in VOWELS["tr"] for c in t)
    n = 0
    for w in t.split():
        k = len(re.findall(r"[aeiouy]+", w))
        if w.endswith("e") and not w.endswith(("le", "ee")) and k > 1:
            k -= 1
        if w.endswith("ed") and k > 1 and not w.endswith(("ted", "ded")):
            k -= 1
        n += max(1, k)
    return n


def speakable(text):
    """What is given to the engine: one line, plain quotes, no brackets (VoxCPM reads a leading bracket as a direction)."""
    t = " ".join(text.replace("\n", " ").split())
    for a, b in (("“", '"'), ("”", '"'), ("‘", "'"), ("’", "'"), ("…", "..."), ("—", ", "), ("–", ", "), ("(", ""), (")", ""), ("[", ""), ("]", "")):
        t = t.replace(a, b)
    return t.strip()


# ---------------------------------------------------------------- the voices

# A voice is a speaker and what is done to its takes afterwards. A speaker is a pair of reference clips in
# scripts/voice/refs (one per language, the same designed voice in both); the clips are themselves synthetic, see
# README.md: nobody's voice is copied.
VOICES = {
    "narrator": {"ref": "narrator", "post": "plain"},  # the photograph: a calm woman, close
    "house": {"ref": "house", "post": "plain"},  # the voice from the house, a mother's: lower, darker, older
    "phone": {"ref": "house", "post": "plain"},  # that voice down a telephone line (the line itself is the player's: see AudioEngine)
    "dream": {"ref": "dream", "post": "plain"},  # someone in a room of the dream: a man, hushed, tired
}

# How each engine is driven. The engine is chosen with --engine; DEFAULT_ENGINE is what the measurements favoured.
ENGINES = {
    # Resemble AI Chatterbox Multilingual V3: cfg (how closely the reference's pace is followed; lower is slower),
    # exaggeration (how much feeling; 0.5 is neutral, lower is flatter), temperature (how far takes differ)
    "chatterbox": {"cfg": 0.5, "exaggeration": 0.5, "temperature": 0.8},
    # OpenBMB VoxCPM2: mode "cont" continues the reference clip (closest to it, about twice as slow),
    # mode "ref" only takes its speaker; cfg and steps as in its documentation
    "voxcpm2": {"mode": "cont", "cfg": 2.0, "steps": 10},
}
DEFAULT_ENGINE = {"tr": "chatterbox", "en": "chatterbox"}


def post_phone(x):
    """A telephone line: 300 to 3400 Hz, the handset's hump near 2 kHz, the carbon grit of a loud syllable."""
    y = lp(hp(x, 300.0, order=3), 3400.0, order=4)
    y = bell(y, 2000.0, 4.0, 1.2)
    y = y / max(peak(y), 1e-9)
    y = np.tanh(1.6 * y) / np.tanh(1.6)
    return lp(y, 3600.0, order=6)


POST = {"plain": lambda x: x, "phone": post_phone}


def finish(take, sr, voice):
    """A take as it is published: 44.1 kHz, cut to the speech, high-passed, treated, levelled."""
    x = resample(take - np.mean(take), sr, SR)
    x = hp(x, 30.0, order=2)
    x = trim(x, SR)
    x = POST[VOICES[voice]["post"]](x)
    x = fade(x, 0.004, 0.004)
    return to_lufs(x)


# ---------------------------------------------------------------- engines (one in memory at a time)


def _free():
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def pick_device(want):
    import torch

    if want in (None, "auto"):
        return "cuda" if torch.cuda.is_available() else "cpu"
    return want


def seed_everything(seed):
    import torch

    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    np.random.seed(seed % (2**31))


_refs = None


def speaker_of(item):
    """Whose voice a line is said in: the item's own speaker, else its voice's."""
    return item.get("speaker") or VOICES[item.get("voice", "narrator")]["ref"]


def ref_of(speaker, lang):
    """The reference clip of a speaker for a language, and what is said in it."""
    global _refs
    if _refs is None:
        _refs = load_json(os.path.join(REFS, "refs.json"), None)
        if _refs is None:
            raise SystemExit(f"no refs.json in {REFS}")
    name = f"{speaker}_{lang}"
    if name not in _refs:
        raise SystemExit(f"no reference clip {name} in {REFS}")
    return os.path.join(REFS, _refs[name]["file"]), _refs[name]["text"]


class Chatterbox:
    """Resemble AI Chatterbox Multilingual V3 (MIT), 24 kHz. The speaker is a reference clip in the language spoken.
    Its output carries Resemble's inaudible Perth watermark."""

    name = "chatterbox"

    def __init__(self, device, cfg=0.5, exaggeration=0.5, temperature=0.8, **_):
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS

        self.cfg, self.exaggeration, self.temperature = cfg, exaggeration, temperature
        self.m = ChatterboxMultilingualTTS.from_local(os.path.join(MODELS, "chatterbox"), device, t3_model="v3")
        self.sr = int(self.m.sr)
        self._ref = None

    def render(self, text, lang, speaker, seed):
        ref, _ = ref_of(speaker, lang)
        seed_everything(seed)
        if ref != self._ref:
            self.m.prepare_conditionals(ref, exaggeration=self.exaggeration)
            self._ref = ref
        x = self.m.generate(speakable(text), language_id=lang, exaggeration=self.exaggeration, cfg_weight=self.cfg, temperature=self.temperature)
        return x.squeeze().detach().cpu().numpy().astype(np.float64)

    def close(self):
        self.m = None
        _free()


class VoxCPM2:
    """OpenBMB VoxCPM2 (Apache-2.0), 2B parameters, 48 kHz. The speaker is a reference clip; the language is read
    off the text. It needs about 6 GB of video memory."""

    name = "voxcpm2"

    def __init__(self, device, mode="cont", cfg=2.0, steps=10, **_):
        from voxcpm import VoxCPM

        self.mode, self.cfg, self.steps = mode, cfg, steps
        self.m = VoxCPM(voxcpm_model_path=os.path.join(MODELS, "VoxCPM2"), zipenhancer_model_path=None, enable_denoiser=False, optimize=False, device=device)
        self.sr = int(self.m.tts_model.sample_rate)

    def render(self, text, lang, speaker, seed):
        ref, ref_text = ref_of(speaker, lang)
        seed_everything(seed)
        more = {"prompt_wav_path": ref, "prompt_text": ref_text} if self.mode == "cont" else {}
        x = self.m.generate(text=speakable(text), reference_wav_path=ref, cfg_value=self.cfg, inference_timesteps=self.steps, retry_badcase=True, **more)
        return np.asarray(x, dtype=np.float64).reshape(-1)

    def close(self):
        self.m = None
        _free()


ENGINE_CLASSES = {"chatterbox": Chatterbox, "voxcpm2": VoxCPM2}


def open_engine(name, device):
    return ENGINE_CLASSES[name](pick_device(device), **ENGINES[name])


# ---------------------------------------------------------------- listening: the recogniser and the judge


class Listener:
    """Whisper large-v3 through faster-whisper (MIT): what a take says, word by word, with times."""

    def __init__(self, device="auto"):
        import torch  # its CUDA libraries are the ones ctranslate2 needs on Windows
        from faster_whisper import WhisperModel

        lib = os.path.join(os.path.dirname(torch.__file__), "lib")
        if os.path.isdir(lib) and hasattr(os, "add_dll_directory"):
            os.add_dll_directory(lib)
            os.environ["PATH"] = lib + os.pathsep + os.environ.get("PATH", "")
        path = os.path.join(MODELS, "faster-whisper-large-v3")
        dev = pick_device(device)
        try:
            self.m = WhisperModel(path, device=dev, compute_type="float16" if dev == "cuda" else "int8")
            self.device = dev
        except Exception as exc:  # no usable CUDA runtime for ctranslate2: the CPU does it, slower
            print("listener: cuda failed, using the cpu:", repr(exc)[:120], flush=True)
            self.m = WhisperModel(path, device="cpu", compute_type="int8", cpu_threads=8)
            self.device = "cpu"

    def _decode(self, y, lang, shift):
        segs, _ = self.m.transcribe(y, language=lang, beam_size=5, temperature=0.0, condition_on_previous_text=False, word_timestamps=True, vad_filter=False)
        words = []
        for s in segs:
            if s.no_speech_prob > 0.6 and s.avg_logprob < -0.4:
                continue  # made up over silence
            for w in s.words or []:
                words.append((w.word.strip(), float(w.start) + shift, float(w.end) + shift))
        while words and words[-1][2] - words[-1][1] <= 0.0:
            words.pop()  # words of no length at the end are made up too
        return " ".join(w[0] for w in words), words

    def hear(self, x, sr, lang, text=None):
        """(text, [(word, start, end)]) of a take; times in seconds of the take. Only the stretch with speech in it is
        given to the recogniser. After the last word Whisper sometimes makes up a farewell ("Thanks for watching!");
        that is the recogniser's doing, not the take's, so when the line is known the take is heard twice, with and
        without a little silence around it, and the hearing nearer to the line counts: words the take really says
        are in both."""
        a, b, _, _, _ = speech_span(x, sr)
        a = max(0, a - int(0.15 * sr))
        b = min(x.shape[-1], b + int(0.15 * sr))
        y = resample(x[a:b], sr, 16000).astype(np.float32)
        best = self._decode(y, lang, a / sr)
        if text is None or edits(plain(text, lang), plain(best[0], lang)) == 0:
            return best
        pad = np.zeros(6400, dtype=np.float32)
        other = self._decode(np.concatenate([pad, y, pad]), lang, a / sr - 0.4)
        if edits(plain(text, lang), plain(other[0], lang)) < edits(plain(text, lang), plain(best[0], lang)):
            best = other
        return best

    def close(self):
        self.m = None
        _free()


class Judge:
    """UTMOS (the 2022 "strong" system, re-implemented in tarepan/SpeechMOS, MIT): a predicted mean opinion score of
    naturalness, 1 (bad) to 5 (excellent), trained on English listening tests. Between takes of one line it ranks;
    across languages it is only a hint."""

    def __init__(self, device="auto"):
        import torch

        self.torch = torch
        self.device = pick_device(device)
        local = os.path.join(os.environ["TORCH_HOME"], "hub", "tarepan_SpeechMOS_v1.2.0")
        if os.path.isdir(local):  # fetched once from GitHub; after that it is read from the disk
            m = torch.hub.load(local, "utmos22_strong", source="local", verbose=False)
        else:
            m = torch.hub.load("tarepan/SpeechMOS:v1.2.0", "utmos22_strong", trust_repo=True, verbose=False)
        self.m = m.to(self.device).eval()

    def score(self, x, sr):
        y = resample(x, sr, 16000).astype(np.float32)
        if y.shape[-1] < 8000:  # the predictor wants half a second; a one-word line is padded with its own silence
            y = np.concatenate([y, np.zeros(8000 - y.shape[-1], dtype=np.float32)])
        with self.torch.no_grad():
            return float(self.m(self.torch.from_numpy(y).unsqueeze(0).to(self.device), 16000)[0])

    def close(self):
        self.m = None
        _free()


# ---------------------------------------------------------------- measuring a take


def pitch(x, sr):
    """f0 of the voiced frames, Hz: mean, median, 5th and 95th percentile (librosa pyin)."""
    import librosa

    y = resample(x, sr, 16000).astype(np.float32)
    f0, voiced, _ = librosa.pyin(y, fmin=60, fmax=450, sr=16000, frame_length=1024, hop_length=320)
    v = f0[voiced & ~np.isnan(f0)]
    if v.size < 5:
        return {"f0_mean": None, "f0_median": None, "f0_p5": None, "f0_p95": None, "f0_range": None, "voiced": float(v.size) / max(1, f0.size)}
    p5, p95 = np.percentile(v, [5, 95])
    return {"f0_mean": round(float(v.mean()), 1), "f0_median": round(float(np.median(v)), 1), "f0_p5": round(float(p5), 1), "f0_p95": round(float(p95), 1),
            "f0_range": round(float(p95 - p5), 1), "voiced": round(float(v.size) / max(1, f0.size), 3)}


def _marks(text, lang):
    """Where the line has a comma or a full stop inside it: [(index of the word before it, ',' or '.')]."""
    out = []
    words = text.split()
    for i, w in enumerate(words[:-1]):
        if not plain(w, lang):
            continue
        k = len(plain(" ".join(words[: i + 1]), lang).split()) - 1
        if re.search(r"[.!?…]+[\"')\]]*$", w):
            out.append((k, "."))
        elif re.search(r"[,;:]+[\"')\]]*$", w):
            out.append((k, ","))
    return out


def punctuation_pauses(text, lang, words, gaps):
    """How long the voice stops at each comma and full stop inside the line: the words of the line are matched to
    the recogniser's words, and the silence found at the end of the word before the mark is the pause."""
    import difflib

    ref = plain(text, lang).split()
    hyp = [plain(w[0], lang) for w in words]
    keep = [i for i, w in enumerate(hyp) if w]
    hyp_w = [hyp[i] for i in keep]
    sm = difflib.SequenceMatcher(a=ref, b=hyp_w, autojunk=False)
    where = {}
    for a, b, n in sm.get_matching_blocks():
        for k in range(n):
            where[a + k] = keep[b + k]
    out = {",": [], ".": []}
    for k, mark in _marks(text, lang):
        if k not in where:
            continue
        i = where[k]
        end = words[i][2]
        nxt = words[i + 1][1] if i + 1 < len(words) else end + 0.5
        best = 0.0
        for g0, g1 in gaps:  # the longest silence between this word and the next (the recogniser's times are loose)
            if g1 > end - 0.2 and g0 < max(nxt, end) + 0.2:
                best = max(best, g1 - g0)
        out[mark].append(round(best, 3))
    return out


def measure(x, sr, text, lang, seconds_to_make=None):
    """Everything that can be said about a raw take without ears."""
    n = x.shape[-1]
    a, b, lv, h, thr = speech_span(x, sr)
    speech = x[a:b]
    dur = (b - a) / sr
    gaps = pauses(x, sr, a, b)
    inner = sum(g1 - g0 for g0, g1 in gaps)
    vowels = vowel_count(text, lang)
    tail = x[max(0, n - int(0.050 * sr)) :]
    head = x[: int(0.050 * sr)]
    quiet = lv[lv < thr]
    m = {
        "seconds": round(n / sr, 3),
        "speech_seconds": round(dur, 3),
        "lead_silence": round(a / sr, 3),
        "trail_silence": round((n - b) / sr, 3),
        "vowels": vowels,
        "vowels_per_second": round(vowels / max(dur, 1e-3), 2),
        "vowels_per_second_no_pauses": round(vowels / max(dur - inner, 1e-3), 2),
        "pauses": [(round(g0 - a / sr, 3), round(g1 - g0, 3)) for g0, g1 in gaps],
        "peak_db": round(float(db(peak(x))), 1),
        "clipped_samples": int(np.sum(np.abs(x) >= 0.999)),
        "dc_offset": round(float(np.mean(x)), 5),
        "speech_rms_db": round(float(db(rms(speech))), 1),
        "last_50ms_db": round(float(db(rms(tail))), 1),
        "first_50ms_db": round(float(db(rms(head))), 1),
        "last_50ms_under_speech_db": round(float(db(rms(speech)) - db(rms(tail))), 1),
        "noise_floor_db": round(float(np.median(quiet)), 1) if quiet.size else None,
        "lufs": round(lufs(resample(x, sr, SR)), 1),
    }
    m.update(pitch(speech, sr))
    if seconds_to_make is not None:
        m["render_seconds"] = round(seconds_to_make, 2)
        m["rtf"] = round(seconds_to_make / max(n / sr, 1e-3), 2)
    return m


def judge_take(m, text, lang, heard, words):
    """Adds what the recogniser heard to a take's measurements and decides whether the take fails, and why."""
    ref, hyp = plain(text, lang), plain(heard, lang)
    d = edits(ref, hyp)
    m["heard"] = heard
    m["cer"] = round(d / max(1, len(ref)), 4)
    m["edits"] = d
    m["extra_words"] = max(0, len(hyp.split()) - len(ref.split()))
    gaps = [(g0 + m["lead_silence"], g0 + m["lead_silence"] + g) for g0, g in m["pauses"]]
    pp = punctuation_pauses(text, lang, words, gaps)
    m["comma_pauses"] = pp[","]
    m["stop_pauses"] = pp["."]
    why = []
    short = len(ref) <= 6  # a single short word is beyond the recogniser; it is judged by its length and its ending
    if not short and m["cer"] > 0.10 and d > 1:
        why.append("words")
    if short and d > max(2, len(ref) // 2) and len(hyp) > 2 * len(ref) + 4:
        why.append("words")
    if m["extra_words"] >= 2 and not short:
        why.append("extra words")
    if m["vowels_per_second"] < 1.2 and not short:
        why.append("too slow or silent")
    if m["vowels_per_second_no_pauses"] > 9.0:
        why.append("too fast")
    if short and m["speech_seconds"] > 0.5 + 0.45 * m["vowels"]:
        why.append("too long")
    if m["last_50ms_under_speech_db"] < 12.0 and m["trail_silence"] < 0.03:
        why.append("cut off")
    if m["clipped_samples"] > 8:
        why.append("clipped")
    if m["speech_seconds"] < 0.12:
        why.append("empty")
    m["failed"] = why
    return m


# ---------------------------------------------------------------- the build


def line_hash(item, lang, engine):
    spec = json.dumps([SETTINGS_VERSION, item[lang], item.get("voice", "narrator"), speaker_of(item), lang, engine, ENGINES[engine], VOICES[item.get("voice", "narrator")], LUFS, CEILING, PAD, KBPS], sort_keys=True, ensure_ascii=False)
    refs = os.path.join(REFS, "refs.json")
    if os.path.exists(refs):
        spec += hashlib.sha1(open(refs, "rb").read()).hexdigest()
    return hashlib.sha1(spec.encode("utf-8")).hexdigest()


def seed_of(key, lang, round_no, take):
    return int(hashlib.sha1(f"{key}|{lang}|{round_no}|{take}".encode("utf-8")).hexdigest()[:7], 16)


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=True)
    os.replace(tmp, path)


def best_take(takes):
    """Passing takes first; among them the fewest wrong characters, then the most natural."""
    return sorted(takes, key=lambda t: (len(t["failed"]) > 0, round(t["cer"], 2), -(t.get("mos") or 0.0)))[0]


def build(args):
    items = load_json(args.lines, None)
    if not isinstance(items, list):
        raise SystemExit(f"cannot read {args.lines}")
    keys = [it["key"] for it in items]
    if len(set(keys)) != len(keys):
        raise SystemExit("duplicate keys in " + args.lines)
    for it in items:
        if it.get("voice", "narrator") not in VOICES:
            raise SystemExit(f"{it['key']}: unknown voice {it.get('voice')}")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", it["key"]):
            raise SystemExit(f"{it['key']}: a key is a file name")
    langs = [l for l in args.lang.split(",") if l]
    for l in langs:
        if l not in DEFAULT_ENGINE:
            raise SystemExit(f"unknown language {l}")
    engine_of = {l: (DEFAULT_ENGINE[l] if args.engine == "auto" else args.engine) for l in langs}
    if args.only:
        wanted = args.only.split(",")
        unknown = [w for w in wanted if not w.endswith("*") and w not in keys]
        if unknown:
            raise SystemExit("unknown: " + ", ".join(unknown))
        chosen = [it for it in items if any(it["key"] == w or (w.endswith("*") and it["key"].startswith(w[:-1])) for w in wanted)]
    else:
        chosen = items
    out = os.path.abspath(args.out)
    cache = os.path.join(out, ".voice-cache")
    os.makedirs(cache, exist_ok=True)
    state = load_json(os.path.join(cache, "state.json"), {})
    report = load_json(os.path.join(out, "report.json"), {})
    manifest = load_json(os.path.join(out, "manifest.json"), {})

    todo = []
    for it in chosen:
        if it.get("cut_from"):
            continue  # cut out of its whole line afterwards (see cut_fragments)
        for lang in langs:
            if not it.get(lang):
                continue
            h = line_hash(it, lang, engine_of[lang])
            path = os.path.join(out, lang, it["key"] + ".mp3")
            if not args.force and state.get(f"{lang}/{it['key']}") == h and os.path.exists(path):
                continue
            todo.append((it, lang, h))
    print(f"{len(todo)} to render, {sum(1 for it in chosen for l in langs if it.get(l)) - len(todo)} unchanged", flush=True)

    t0 = time.time()
    takes = {(it["key"], lang): [] for it, lang, _ in todo}
    pending = list(todo)
    for round_no in range(1, args.rounds + 1):
        if not pending:
            break
        fresh = []
        # 1. the engine speaks (one engine after the other when the languages use different ones)
        for name in sorted(set(engine_of.values())):
            mine = [(it, l, h) for it, l, h in pending if engine_of[l] == name]
            if not mine:
                continue
            eng = open_engine(name, args.device)
            for n, (it, lang, _) in enumerate(mine):
                os.makedirs(os.path.join(cache, lang), exist_ok=True)
                for k in range(args.takes):
                    seed = seed_of(it["key"], lang, round_no, k)
                    t1 = time.time()
                    try:
                        x = eng.render(it[lang], lang, speaker_of(it), seed)
                    except Exception as exc:
                        print(f"  {lang}/{it['key']} take {round_no}.{k}: the engine failed: {exc!r}"[:200], flush=True)
                        continue
                    wav = os.path.join(cache, lang, f"{it['key']}.{round_no}.{k}.wav")
                    write_wav(wav, x, eng.sr)
                    fresh.append({"key": it["key"], "lang": lang, "text": it[lang], "round": round_no, "take": k, "seed": seed, "wav": wav, "engine": eng.name, "made_in": time.time() - t1})
                print(f"  round {round_no}, {name}: {n + 1}/{len(mine)} {lang}/{it['key']}", flush=True)
            eng.close()
            del eng
        # 2. the recogniser listens
        ear = Listener(args.device)
        for t in fresh:
            x, sr = read_wav(t["wav"])
            m = measure(x, sr, t["text"], t["lang"], t.pop("made_in"))
            heard, words = ear.hear(x, sr, t["lang"], t["text"])
            t.update(judge_take(m, t["text"], t["lang"], heard, words))
        ear.close()
        del ear
        # 3. the judge scores
        judge = Judge(args.device)
        for t in fresh:
            x, sr = read_wav(t["wav"])
            a, b, _, _, _ = speech_span(x, sr)
            t["mos"] = round(judge.score(x[a:b], sr), 3)
        judge.close()
        del judge
        for t in fresh:
            takes[(t["key"], t["lang"])].append(t)
        still = []
        for it, lang, h in pending:
            mine = takes[(it["key"], lang)]
            if not mine or best_take(mine)["failed"]:
                still.append((it, lang, h))
        pending = still
        if pending:
            print(f"round {round_no}: {len(pending)} lines have no good take yet: " + ", ".join(f"{l}/{it['key']}" for it, l, _ in pending)[:300], flush=True)

    # 4. the kept take of every line is finished and written
    failed = []
    for it, lang, h in todo:
        mine = takes[(it["key"], lang)]
        name = f"{lang}/{it['key']}"
        if not mine:
            failed.append(name)
            continue
        best = best_take(mine)
        x, sr = read_wav(best["wav"])
        y = finish(x, sr, it.get("voice", "narrator"))
        os.makedirs(os.path.join(out, lang), exist_ok=True)
        path = os.path.join(out, lang, it["key"] + ".mp3")
        encode(path, y)
        back = decode_file(path)
        seconds = round(back.shape[-1] / SR, 3)
        manifest.setdefault(it["key"], {})[lang] = seconds
        n_failed = sum(1 for t in mine if t["failed"])
        report.setdefault(it["key"], {})[lang] = {
            "text": it[lang],
            "voice": it.get("voice", "narrator"),
            "engine": best["engine"],
            "seconds": seconds,
            "bytes": os.path.getsize(path),
            "lufs": round(lufs(back), 2),
            "peak_db": round(float(db(peak(back))), 2),
            "takes": len(mine),
            "takes_failed": n_failed,
            "failed": best["failed"],
            "kept": {k: v for k, v in best.items() if k not in ("wav", "text", "key", "lang")},
            "others": [{k: t[k] for k in ("round", "take", "seed", "cer", "mos", "heard", "failed", "speech_seconds")} for t in mine if t is not best],
        }
        if best["failed"]:
            failed.append(name)
        else:
            state[f"{lang}/{it['key']}"] = h
        print(f"{name:28s} {seconds:6.2f} s  cer {best['cer']:.2f}  mos {best.get('mos', 0):.2f}  {report[it['key']][lang]['lufs']:6.1f} LUFS  takes {len(mine)} ({n_failed} failed)" + ("  FAILED: " + ", ".join(best["failed"]) if best["failed"] else ""), flush=True)
        if not args.keep_takes:
            for t in mine:
                try:
                    os.remove(t["wav"])
                except OSError:
                    pass
    failed += cut_fragments(items, chosen, out, langs, args.device, manifest, report)
    # lines that are no longer in the file leave the manifest
    if not args.only:
        for key in [k for k in manifest if k not in keys]:
            del manifest[key]
            report.pop(key, None)
    save_json(os.path.join(out, "manifest.json"), manifest)
    save_json(os.path.join(out, "report.json"), report)
    save_json(os.path.join(cache, "state.json"), state)
    print(f"built {len(todo) - len(failed)} of {len(todo)} in {time.time() - t0:.0f} s")
    if failed:
        print("failed: " + ", ".join(failed))
        return 2
    return 0


def _quietest(x, around, reach=0.06, win=0.010):
    """The quietest moment (s) within `reach` of `around`: where one word lets go of the next."""
    best, at = None, around
    t = max(0.0, around - reach)
    while t <= around + reach:
        a, b = int(t * SR), int((t + win) * SR)
        if b <= x.shape[-1]:
            e = rms(x[a:b])
            if best is None or e < best:
                best, at = e, t + win / 2
        t += 0.002
    return at


def word_times(text, lang, heard):
    """For each word of `text`, when it starts and ends in a take, from what the recogniser heard ([(word, start,
    end)]). The recogniser may split a word or join two, so the words are matched by their letters, counted from
    the start of the line. None where the take runs out first."""
    def count(w):
        return sum(1 for ch in plain(w, lang) if ch.isalnum())

    ends, total = [], 0
    for w in text.split():
        total += count(w)
        ends.append(total)
    spans, i, said = [], 0, 0
    for target in ends:
        first = i
        while i < len(heard) and said < target:
            said += count(heard[i][0])
            i += 1
        if said < target or first >= len(heard):
            spans.append(None)
            continue
        spans.append((heard[first][1], heard[i - 1][2]))
    return spans


def cut_fragments(items, chosen, out, langs, device, manifest, report):
    """Every line that is a broken-off beginning of another is cut out of that line's finished clip, at the end of
    its last whole word (the quietest moment near where the recogniser puts it) or part way into the next word;
    a few milliseconds of fade so that the cut does not click, and nothing after it."""
    by_key = {it["key"]: it for it in items}
    frags = [it for it in chosen if it.get("cut_from")]
    if not frags:
        return []
    failed = []
    ear = Listener(device)
    heard = {}
    for it in frags:
        whole = by_key.get(it["cut_from"])
        for lang in langs:
            name = f"{lang}/{it['key']}"
            src = os.path.join(out, lang, it["cut_from"] + ".mp3")
            if whole is None or not os.path.exists(src):
                print(f"{name}: nothing to cut it from ({it['cut_from']})", flush=True)
                failed.append(name)
                continue
            if (it["cut_from"], lang) not in heard:
                x = decode_file(src)
                heard[(it["cut_from"], lang)] = (x, ear.hear(x, SR, lang, whole[lang])[1])
            x, words = heard[(it["cut_from"], lang)]
            n, share = it["cut"][lang]
            spans = word_times(whole[lang], lang, words)
            last, following = spans[n - 1], spans[n] if n < len(spans) else None
            if last is None or (share > 0 and following is None):
                print(f"{name}: the recogniser did not hear the whole line far enough to cut it ({words})", flush=True)
                failed.append(name)
                continue
            if it.get("cut_at", {}).get(lang) is not None:
                end = float(it["cut_at"][lang])  # measured on the take (see CUT_AT in collect-lines.mjs)
            elif share > 0:
                end = following[0] + share * (following[1] - following[0])
            elif following is None:
                end = last[1]
            else:
                # where the last word lets go of the next one: the quietest moment between them
                a, b = min(last[1], following[0]), max(last[1], following[0])
                end = _quietest(x, (a + b) / 2, reach=(b - a) / 2 + 0.03)
            y = x[: int(end * SR)].copy()
            y = fade(y, 0.0, 0.006)
            path = os.path.join(out, lang, it["key"] + ".mp3")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            encode(path, y)
            back = decode_file(path)
            seconds = round(back.shape[-1] / SR, 3)
            manifest.setdefault(it["key"], {})[lang] = seconds
            said, _ = ear.hear(back, SR, lang, it[lang])
            report.setdefault(it["key"], {})[lang] = {"text": it[lang], "cut_from": it["cut_from"], "cut_at": round(end, 3), "seconds": seconds, "heard": said}
            print(f"{name:28s} {seconds:6.2f} s  cut at {end:.3f} s  heard: {said}", flush=True)
    ear.close()
    return failed


def check(args):
    """Reads back what is on disk: length, loudness, peak."""
    out = os.path.abspath(args.out)
    manifest = load_json(os.path.join(out, "manifest.json"), {})
    bad = 0
    total = 0
    print(f"{'file':34s} {'sec':>7s} {'LUFS':>6s} {'peak':>6s} {'KiB':>6s}")
    for key in sorted(manifest):
        for lang, seconds in sorted(manifest[key].items()):
            path = os.path.join(out, lang, key + ".mp3")
            if not os.path.exists(path):
                print(f"{lang + '/' + key:34s} MISSING")
                bad += 1
                continue
            y = decode_file(path)
            size = os.path.getsize(path)
            total += size
            l = lufs(y)
            flag = ""
            if abs(l - LUFS) > 0.7 or abs(y.shape[-1] / SR - seconds) > 0.06:
                flag = "  <-- CHECK"
                bad += 1
            print(f"{lang + '/' + key:34s} {y.shape[-1] / SR:7.2f} {l:6.1f} {db(peak(y)):6.1f} {size / 1024:6.0f}{flag}")
    print(f"total {total} bytes, {total / 1024 / 1024:.2f} MiB; {bad} problems")
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser(description="Renders the spoken lines of the piece with a local speech engine.")
    ap.add_argument("--lines", help="json: [{key, tr, en, voice}]")
    ap.add_argument("--out", required=True, help="folder to write <lang>/<key>.mp3, manifest.json and report.json into")
    ap.add_argument("--lang", default="tr,en", help="tr, en or tr,en")
    ap.add_argument("--only", help="comma separated keys, or a prefix ending in *")
    ap.add_argument("--takes", type=int, default=3, help="takes per line and round")
    ap.add_argument("--rounds", type=int, default=3, help="how often a line with no good take is tried again")
    ap.add_argument("--device", default="auto", help="auto, cuda or cpu")
    ap.add_argument("--engine", default="auto", choices=["auto"] + sorted(ENGINES), help="auto: the one chosen per language in DEFAULT_ENGINE")
    ap.add_argument("--force", action="store_true", help="render also what has not changed")
    ap.add_argument("--keep-takes", action="store_true", help="leave every take in <out>/.voice-cache")
    ap.add_argument("--check", action="store_true", help="measure the files on disk")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if args.check:
        return check(args)
    if not args.lines:
        raise SystemExit("--lines is needed")
    return build(args)


if __name__ == "__main__":
    sys.exit(main())
