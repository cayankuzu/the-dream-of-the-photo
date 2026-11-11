// Every line the piece says aloud, gathered into scripts/voice/lines.json for build-voice.py:
//   node scripts/voice/collect-lines.mjs
// The narrator's track and the last street's choice come from src/config/film.config.ts (Node reads it with its
// types stripped); the rooms' own lines are read out of their files, where each is said with this.say({ tr, en },
// seconds, voice) or with a constant of the same file. A line's key is the hash of its Turkish text, the same one the
// piece computes (voiceKey in src/experience/film/Film.ts), so a clip is found by what is said.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const ROOMS = join(ROOT, 'src', 'experience', 'rooms', 'list');

const { LINES, MOTTO, STREET_CHOICE } = await import(new URL('../../src/config/film.config.ts', import.meta.url));

/** 32-bit FNV-1a of the UTF-8 text, in hex: as voiceKey in Film.ts. */
function keyOf(text) {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text.trim())) {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Who says a line, by its voice: the telephone and the intercom carry the voice from the house. */
const SPEAKER = { narrator: 'narrator', house: 'house', phone: 'house', dream: 'dream' };
/** Lines heard down a telephone in someone else's voice than the house's (by their Turkish text). */
const SPEAKER_OF = { 'Hemen dönerim.': 'narrator' };
/**
 * Where a broken-off beginning of the motto is cut, per language: whole words kept, and the share of the next word
 * that is still heard (the tongue starting "yarım", the mouth starting "half").
 */
const PART_OF_NEXT = { tr: 0.42, en: 0.5 };
/**
 * Where each broken-off beginning is cut (s into the clip of the whole motto), measured on the energy of the take
 * that is published: the recogniser's word times run up to a third of a second early in it, so they only serve
 * where nothing is measured. Measure again if the whole motto is ever spoken anew.
 */
const CUT_AT = {
  'Bir fotoğrafın': { tr: 0.86, en: 0.53 },
  'Bir fotoğrafın rüyası': { tr: 1.21, en: 1.31 },
  'Bir fotoğrafın rüyası saç': { tr: 1.47, en: 1.66 },
  'Bir fotoğrafın rüyası saç beyazlatır. Bir fotoğrafın': { tr: 3.28, en: 3.53 },
  'Bir fotoğrafın rüyası saç beyazlatır. Bir fotoğrafın rüyası her': { tr: 3.84, en: 4.86 },
  'Bir fotoğrafın rüyası saç beyazlatır. Bir fotoğrafın rüyası her akşam ya-': { tr: 4.35, en: 5.58 },
};

const items = new Map();
const add = (text, voice = 'narrator', from = {}) => {
  const key = keyOf(text.tr);
  const speaker = SPEAKER_OF[text.tr.trim()] ?? SPEAKER[voice];
  const had = items.get(key);
  if (had) {
    if (had.speaker !== speaker || had.voice !== voice) throw new Error(`"${text.tr}" is said in two voices: ${had.voice} and ${voice}`);
    if (from.room && !had.rooms.includes(from.room)) had.rooms.push(from.room);
    return;
  }
  items.set(key, { key, tr: text.tr.trim(), en: text.en.trim(), voice, speaker, rooms: from.room ? [from.room] : [], ...(from.cut ?? {}) });
};

/** How a broken-off line is cut out of the whole: its whole words, and whether it stops inside the next one. */
function cutOf(part, whole) {
  const spec = {};
  for (const lang of ['tr', 'en']) {
    const words = part[lang].trim().split(/\s+/);
    const inside = words[words.length - 1].endsWith('-');
    const all = whole[lang].trim().split(/\s+/);
    const n = inside ? words.length - 1 : words.length;
    // the words must be the whole's own beginning
    for (let i = 0; i < n; i++) if (words[i].replace(/[.,]$/, '') !== all[i].replace(/[.,]$/, '')) throw new Error(`"${part[lang]}" is not the beginning of "${whole[lang]}"`);
    spec[lang] = [n, inside ? PART_OF_NEXT[lang] : 0];
  }
  return spec;
}

// the whole motto first: the broken-off lines are cut out of it
add(MOTTO);
for (const l of LINES) {
  if (l.brokenOff) add(l.text, l.voice ?? 'narrator', { cut: { cut_from: keyOf(l.brokenOff.tr), cut: cutOf(l.text, l.brokenOff), ...(CUT_AT[l.text.tr] ? { cut_at: CUT_AT[l.text.tr] } : {}) } });
  else add(l.text, l.voice ?? 'narrator');
}
add(STREET_CHOICE.home.text, STREET_CHOICE.home.voice);
add(STREET_CHOICE.stay.text, STREET_CHOICE.stay.voice);

// the rooms' own lines
const STRING = String.raw`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"`;
const TEXT = new RegExp(String.raw`\{\s*tr:\s*(?:${STRING}),\s*en:\s*(?:${STRING})\s*,?\s*\}`);
const unquote = (m, i) => (m[i] ?? m[i + 1]).replace(/\\(.)/g, '$1');
let roomLines = 0;
for (const file of readdirSync(ROOMS).filter((f) => f.endsWith('.ts'))) {
  const room = file.replace(/\.ts$/, '');
  const src = readFileSync(join(ROOMS, file), 'utf8');
  // constants of the file that hold a line: const NAME = { tr, en } (with or without a type)
  const constants = new Map();
  for (const m of src.matchAll(new RegExp(String.raw`const ([A-Z_]+)(?:: [A-Za-z]+)? = (${TEXT.source})`, 'g'))) {
    const t = TEXT.exec(m[2]);
    constants.set(m[1], { tr: unquote(t, 1), en: unquote(t, 3) });
  }
  for (const m of src.matchAll(/this\.say\(\s*([\s\S]{0,400}?)\)\s*;?\s*\)?/g)) {
    const call = m[1];
    const voice = /,\s*'(narrator|house|phone|dream)'\s*$/.exec(call.trim())?.[1] ?? 'narrator';
    const inline = TEXT.exec(call);
    if (inline && call.trimStart().startsWith('{ tr')) {
      add({ tr: unquote(inline, 1), en: unquote(inline, 3) }, voice, { room });
      roomLines++;
      continue;
    }
    const name = /^([A-Z_]+)\b/.exec(call.trim())?.[1];
    if (name && constants.has(name)) {
      add(constants.get(name), voice, { room });
      roomLines++;
      continue;
    }
    // a table of lines walked by the room (corridor: its LINES, one per visit)
    if (/^\{\s*tr:\s*line\.tr/.test(call.trim())) {
      const table = /const LINES(?:: [^=]+)? = \[([\s\S]*?)\];/.exec(src);
      if (!table) throw new Error(`${file}: says lines from a table it does not have`);
      for (const t of table[1].matchAll(new RegExp(String.raw`tr:\s*(?:${STRING}),\s*en:\s*(?:${STRING})`, 'g'))) {
        add({ tr: unquote(t, 1), en: unquote(t, 3) }, voice, { room });
        roomLines++;
      }
      continue;
    }
    throw new Error(`${file}: cannot read what is said in this.say(${call.slice(0, 80)}...)`);
  }
}

const out = [...items.values()];
writeFileSync(join(HERE, 'lines.json'), JSON.stringify(out, null, 1) + '\n');
const count = (v) => out.filter((i) => i.voice === v).length;
console.log(`${out.length} lines (${roomLines} said by rooms; narrator ${count('narrator')}, house ${count('house')}, phone ${count('phone')}, dream ${count('dream')}; ${out.filter((i) => i.cut_from).length} cut out of the motto)`);
