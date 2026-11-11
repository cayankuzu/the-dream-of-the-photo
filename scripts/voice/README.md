# The voices

Every line the piece says aloud is a file under `public/audio/voice/<lang>/<key>.mp3`, made on this machine:

1. `node scripts/voice/collect-lines.mjs` gathers every line into `scripts/voice/lines.json`: the narrator's track and
   the last street's choice from `src/config/film.config.ts`, and every line a room says with `this.say(...)`. A
   line's key is the hash of its Turkish text, the same one the piece computes (`voiceKey` in
   `src/experience/film/Film.ts`).
2. `.asset-cache\voice\venv\Scripts\python.exe -I scripts/voice/build-voice.py --lines scripts/voice/lines.json --out public/audio/voice`
   speaks them (only what has changed since the last run): several takes of each line, every take heard back by a
   speech recogniser, the best one kept, trimmed and levelled. The motto's broken-off beginnings are cut out of one
   take of the whole motto, so the voice stops dead in the middle of its tune.
3. `python -I scripts/voice/write-manifest.py` writes `src/config/voice.manifest.ts`: the length of every clip and of
   every cue of the score, so the piece can place a line before it has fetched it.

The environment (about 25 GB, all of it under the git-ignored `.asset-cache\voice`) is set up once with
`powershell -ExecutionPolicy Bypass -File scripts\voice\setup-voice.ps1`.

## Engines and licences

| What | Licence | Where |
| --- | --- | --- |
| Chatterbox Multilingual (Resemble AI): the speech | MIT | https://github.com/resemble-ai/chatterbox, weights https://huggingface.co/ResembleAI/chatterbox |
| VoxCPM2 (OpenBMB): the three speakers were designed with it from a written description | Apache-2.0 | https://huggingface.co/openbmb/VoxCPM2 |
| Whisper large-v3 through faster-whisper: hears every take back | MIT | https://github.com/SYSTRAN/faster-whisper |
| UTMOS (tarepan/SpeechMOS): ranks the takes that pass | MIT | https://github.com/tarepan/SpeechMOS |

## The speakers

`refs/` holds one reference clip per speaker and language: `narrator` (the photograph: a calm woman, close), `house`
(the voice from the house, a mother's: lower and darker) and `dream` (someone in a room of the dream: a man, hushed).
They are synthetic: VoxCPM2 made them from the descriptions kept in `refs/refs.json`. Nobody's voice was recorded or
copied. A telephone line (`phone`) is the house's voice; the line itself is made by the player (`AudioEngine`).
