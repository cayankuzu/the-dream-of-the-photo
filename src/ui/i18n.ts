import { LANGS, ui, type Lang, type Text, type UiKey } from '../config/copy.config';

/** Where the visitor's choice is remembered (a convenience: everything works without it). */
const STORAGE_KEY = 'dream-of-the-photo.lang';

const listeners = new Set<(lang: Lang) => void>();

function stored(): Lang | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'en' || v === 'tr' ? v : null;
  } catch {
    return null;
  }
}

/** `?lang=` first, then the visitor's earlier choice, then the browser's preference (Turkish or English). */
function initial(): Lang {
  const asked = new URLSearchParams(window.location.search).get('lang');
  if (asked === 'en' || asked === 'tr') return asked;
  const remembered = stored();
  if (remembered) return remembered;
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const l of preferred) {
    if (/^tr\b/i.test(l)) return 'tr';
    if (/^en\b/i.test(l)) return 'en';
  }
  return 'en';
}

let current: Lang = initial();
document.documentElement.lang = current;

/** The language showing now. */
export const lang = (): Lang => current;

/** A text in the language showing now. */
export const tr = (text: Text): string => text[current];

/** A UI string in the language showing now. */
export const say = (key: UiKey): string => ui[key][current];

/** A share as a percentage, written the way the language writes it ('%45' in Turkish, '45%' in English). */
export const percent = (fraction: number): string => {
  let format = percentFormats.get(current);
  if (!format) {
    format = new Intl.NumberFormat(current, { style: 'percent', maximumFractionDigits: 0 });
    percentFormats.set(current, format);
  }
  return format.format(fraction);
};
const percentFormats = new Map<Lang, Intl.NumberFormat>();

/** Switch language everywhere at once (and remember it). */
export function setLang(next: Lang): void {
  if (next === current || !LANGS.includes(next)) return;
  current = next;
  document.documentElement.lang = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // private mode or blocked storage: the choice simply is not remembered
  }
  for (const l of listeners) l(next);
}

/** Call `listener` now and on every change of language. */
export function onLang(listener: (lang: Lang) => void): void {
  listeners.add(listener);
  listener(current);
}
