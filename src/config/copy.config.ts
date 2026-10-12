/**
 * Every word the piece says, in English and Turkish. The language follows the browser
 * (Turkish when it is preferred, English otherwise); `?lang=en` or `?lang=tr` overrides it.
 */
import type { Cue } from './experience.config';

export type Lang = 'en' | 'tr';

function pickLang(): Lang {
  const asked = new URLSearchParams(window.location.search).get('lang');
  if (asked === 'en' || asked === 'tr') return asked;
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const l of preferred) {
    if (/^tr\b/i.test(l)) return 'tr';
    if (/^en\b/i.test(l)) return 'en';
  }
  return 'en';
}

export const LANG: Lang = pickLang();

type Text = Readonly<Record<Lang, string>>;

/** A line of narration, shown between two cues (it fades in and out over `fade` of its span). */
export interface NarrationLine {
  from: Cue;
  to: Cue;
  text: Text;
}

/** The voice of the dream: few words, each on its own, never over a moment that speaks for itself. */
export const narration: readonly NarrationLine[] = [
  {
    from: ['CAMERA_RAISE', 0.15],
    to: ['AIM', 0.9],
    text: { en: 'Every photograph is a door that opens only once.', tr: 'Her fotoğraf, yalnızca bir kez açılan bir kapıdır.' },
  },
  {
    from: ['PHOTO_EJECT', 0.15],
    to: ['PHOTO_REVEAL', 0.5],
    text: { en: 'The moment is over. The picture is not.', tr: 'An bitti. Fotoğraf bitmedi.' },
  },
  {
    from: ['PHOTO_REVEAL', 0.65],
    to: ['PHOTO_APPROACH', 0.9],
    text: { en: 'Look long enough, and it begins to look back.', tr: 'Yeterince uzun bakarsan, o da sana bakmaya başlar.' },
  },
  {
    from: ['WORLD', 0.012],
    to: ['WORLD', 0.072],
    text: { en: 'Inside a photograph, nothing has finished happening.', tr: 'Bir fotoğrafın içinde hiçbir şey bitmiş değildir.' },
  },
  {
    from: ['WORLD', 0.08],
    to: ['WORLD', 0.145],
    text: {
      en: 'The rain has waited here since the shutter closed. Only behind you does it remember how to fall.',
      tr: 'Yağmur, deklanşör kapandığından beri burada bekliyor. Yalnızca arkanda düşmeyi hatırlıyor.',
    },
  },
  {
    from: ['WORLD', 0.158],
    to: ['WORLD', 0.222],
    text: { en: 'Every picture on these lines was taken a few steps further on.', tr: 'Bu iplerdeki her fotoğraf, birkaç adım ileriden çekilmiş.' },
  },
  {
    from: ['WORLD', 0.235],
    to: ['WORLD', 0.298],
    text: { en: 'Memory does not keep the past. It keeps the way it looked.', tr: 'Hafıza geçmişi saklamaz. Onun nasıl göründüğünü saklar.' },
  },
  {
    from: ['WORLD', 0.31],
    to: ['WORLD', 0.37],
    text: { en: 'The street should end here. Tonight you remember it longer.', tr: 'Sokak burada bitmeliydi. Bu gece onu daha uzun hatırlıyorsun.' },
  },
  {
    from: ['WORLD', 0.38],
    to: ['WORLD', 0.44],
    text: { en: 'Things are the size you remember them.', tr: 'Eşyalar, onları hatırladığın büyüklükte.' },
  },
  {
    from: ['WORLD', 0.455],
    to: ['WORLD', 0.525],
    text: { en: 'Gravity is only a habit. Here, things are slowly forgetting it.', tr: 'Yerçekimi yalnızca bir alışkanlık. Burada eşyalar onu yavaşça unutuyor.' },
  },
  {
    from: ['WORLD', 0.535],
    to: ['WORLD', 0.585],
    text: { en: 'So are you.', tr: 'Sen de.' },
  },
  {
    from: ['WORLD', 0.62],
    to: ['WORLD', 0.69],
    text: { en: 'The closer you come, the farther it waits.', tr: 'Yaklaştıkça, daha da uzakta bekliyor.' },
  },
  {
    from: ['WORLD', 0.71],
    to: ['WORLD', 0.775],
    text: { en: 'To leave a picture, you walk deeper into it.', tr: 'Bir fotoğraftan çıkmak için, onun daha da derinine yürürsün.' },
  },
  {
    from: ['WORLD', 0.84],
    to: ['WORLD', 0.885],
    text: { en: 'Behind every street lies the sky it once reflected.', tr: 'Her sokağın ardında, bir zamanlar yansıttığı gökyüzü uzanır.' },
  },
  {
    from: ['WORLD', 0.892],
    to: ['WORLD', 0.935],
    text: { en: 'Tonight the moon is a photograph of the moment you left.', tr: 'Bu gece ay, ayrıldığın anın bir fotoğrafı.' },
  },
  {
    from: ['WORLD', 0.945],
    to: ['EXPLORATION', 0.02],
    text: {
      en: 'Who is dreaming whom: the one holding the camera, or the one inside the picture?',
      tr: 'Kim kimin rüyası: fotoğraf makinesini tutan mı, fotoğrafın içindeki mi?',
    },
  },
  {
    from: ['EXPLORATION', 0.2],
    to: ['EXPLORATION', 0.48],
    text: { en: 'It was never a picture of the street.', tr: 'Hiçbir zaman sokağın fotoğrafı değildi.' },
  },
  {
    from: ['EXPLORATION', 0.5],
    to: ['EXPLORATION', 0.78],
    text: { en: 'It was a picture of you, arriving.', tr: 'Senin gelişinin fotoğrafıydı.' },
  },
];

/** Share of a line's span spent fading in (and again fading out). */
export const narrationFade = 0.22;

/** The title comes back at the very end (EXPLORATION fraction). */
export const endTitleFrom = 0.82;

const ui = {
  scroll: { en: 'scroll', tr: 'kaydır' },
  drag: { en: 'drag to look around', tr: 'etrafa bakmak için sürükle' },
  dragTouch: { en: 'swipe sideways to look · up to walk', tr: 'bakmak için yana · yürümek için yukarı kaydır' },
  soundOn: { en: 'sound on', tr: 'ses açık' },
  soundOff: { en: 'sound off', tr: 'ses kapalı' },
  soundLabel: { en: 'Toggle sound', tr: 'Sesi aç / kapat' },
  noWebgl: { en: 'This piece needs a browser with WebGL 2.', tr: 'Bu eser WebGL 2 destekleyen bir tarayıcı gerektirir.' },
  failed: { en: 'The picture could not be developed. Please reload.', tr: 'Fotoğraf banyo edilemedi. Lütfen sayfayı yenileyin.' },
  lost: { en: 'The picture faded. Please reload the page.', tr: 'Fotoğraf soldu. Lütfen sayfayı yenileyin.' },
  /** Handwritten on the back of the giant print (seen from the sea). */
  printBack: { en: 'you were here', tr: 'buradaydın' },
} satisfies Record<string, Text>;

/** A UI string in the visitor's language. */
export const say = (key: keyof typeof ui): string => ui[key][LANG];
