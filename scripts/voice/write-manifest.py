#!/usr/bin/env python3
"""
Writes src/config/voice.manifest.ts: what the piece knows of its spoken lines and its score without fetching them.

  python -I scripts/voice/write-manifest.py

It reads public/audio/voice/manifest.json (written by build-voice.py: every clip's length in each language),
scripts/voice/lines.json (written by collect-lines.mjs: which room says which line) and the cues under
public/audio/score (their lengths, measured by decoding them). Run it after either has changed.
"""
import io
import json
import os
import subprocess

import imageio_ffmpeg

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VOICE = os.path.join(ROOT, "public", "audio", "voice", "manifest.json")
LINES = os.path.join(ROOT, "scripts", "voice", "lines.json")
SCORE = os.path.join(ROOT, "public", "audio", "score")
OUT = os.path.join(ROOT, "src", "config", "voice.manifest.ts")
SR = 44100


def seconds_of(path):
    """The length of an audio file as it decodes (two channels of 32-bit floats)."""
    raw = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "quiet", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return round(len(raw) / (8 * SR), 3)


def main():
    clips = json.load(io.open(VOICE, encoding="utf-8")) if os.path.exists(VOICE) else {}
    lines = json.load(io.open(LINES, encoding="utf-8"))
    known = {it["key"] for it in lines}
    rooms = {}
    for it in lines:
        if it["key"] not in clips:
            continue
        for room in it.get("rooms", []):
            rooms.setdefault(room, []).append(it["key"])
    score = {f[:-4]: seconds_of(os.path.join(SCORE, f)) for f in sorted(os.listdir(SCORE)) if f.endswith(".mp3")} if os.path.isdir(SCORE) else {}
    whole = {k: v for k, v in sorted(clips.items()) if k in known and "tr" in v and "en" in v}
    out = [
        "/**",
        " * Written by scripts/voice/write-manifest.py: do not edit by hand. Every spoken line that has a clip under",
        " * public/audio/voice/<lang>/<key>.mp3 (the key is a hash of the line's Turkish text: see voiceKey in",
        " * experience/film/Film.ts), with its length in seconds in Turkish and in English; which lines each room says",
        " * itself; and the length of every cue of the score under public/audio/score/.",
        " */",
        "export const voiceManifest: {",
        "  readonly clips: Readonly<Record<string, readonly [tr: number, en: number]>>;",
        "  readonly rooms: Readonly<Record<string, readonly string[]>>;",
        "  readonly score: Readonly<Record<string, number>>;",
        "} = {",
        "  clips: {",
        *[f"    '{k}': [{v['tr']}, {v['en']}]," for k, v in whole.items()],
        "  },",
        "  rooms: {",
        *[f"    {room}: [{', '.join(repr(k) for k in sorted(keys))}]," for room, keys in sorted(rooms.items())],
        "  },",
        "  score: {",
        *[f"    {name}: {s}," for name, s in score.items()],
        "  },",
        "};",
        "",
    ]
    io.open(OUT, "w", encoding="utf-8", newline="\n").write("\n".join(out))
    missing = [it["key"] for it in lines if it["key"] not in whole]
    print(f"{len(whole)} clips, {len(rooms)} rooms, {len(score)} score cues; {len(missing)} lines without both clips" + (": " + ", ".join(missing[:12]) if missing else ""))


if __name__ == "__main__":
    main()
