/**
 * Every word the piece says, in English and Turkish (the visitor switches between them at any time;
 * see src/ui/i18n.ts for which one is showing).
 */
import type { Cue } from './experience.config';

export type Lang = 'en' | 'tr';

export const LANGS: readonly Lang[] = ['tr', 'en'];

export type Text = Readonly<Record<Lang, string>>;

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

/**
 * Chapters of the journey: where each begins, and its name. The HUD names the one you are in and
 * marks them all on the journey bar.
 */
export const chapters: readonly { at: Cue; name: Text }[] = [
  { at: ['INTRO', 0], name: { en: 'The Shutter', tr: 'Deklanşör' } },
  { at: ['PHOTO_EJECT', 0], name: { en: 'Developing', tr: 'Banyo' } },
  { at: ['PHOTO_APPROACH', 0], name: { en: 'The Threshold', tr: 'Eşik' } },
  { at: ['WORLD', 0], name: { en: 'The Rain That Waits', tr: 'Bekleyen Yağmur' } },
  { at: ['WORLD', 0.15], name: { en: 'Pictures From Further On', tr: 'İleriden Fotoğraflar' } },
  { at: ['WORLD', 0.31], name: { en: 'The Street That Goes On', tr: 'Bitmeyen Sokak' } },
  { at: ['WORLD', 0.45], name: { en: 'Weightless', tr: 'Yerçekimsiz' } },
  { at: ['WORLD', 0.6], name: { en: 'The Print That Waits', tr: 'Bekleyen Fotoğraf' } },
  { at: ['WORLD', 0.82], name: { en: 'The Mirror Sea', tr: 'Ayna Deniz' } },
  { at: ['WORLD', 0.95], name: { en: 'The Photographer', tr: 'Fotoğrafçı' } },
  { at: ['EXPLORATION', 0.07], name: { en: 'Waking', tr: 'Uyanış' } },
];

/** Memories: things inside the dream that reveal themselves to a long look (the HUD counts them). */
export const memories = {
  figure: { en: 'The one at the far end', tr: 'Uzaktaki fotoğrafçı' },
  found: { en: 'The found photograph', tr: 'Bulunmuş fotoğraf' },
  window: { en: 'A window onto the real moment', tr: 'Gerçek ana açılan pencere' },
  chair: { en: 'The chair, as large as you remember it', tr: 'Hatırladığın büyüklükte sandalye' },
  clock: { en: 'The clock that runs backwards', tr: 'Geri giden saat' },
  giant: { en: 'The print that waits', tr: 'Bekleyen fotoğraf' },
  moon: { en: 'The moon is a photograph', tr: 'Ay bir fotoğraf' },
  photographer: { en: 'The photographer on the water', tr: 'Sudaki fotoğrafçı' },
} satisfies Record<string, Text>;

export type MemoryId = keyof typeof memories;

export const ui = {
  kicker: { en: 'an interactive dream', tr: 'etkileşimli bir rüya' },
  subtitle: { en: 'Step into a photograph and walk through its dream.', tr: 'Bir fotoğrafın içine gir ve rüyasında yürü.' },
  loading: { en: 'Developing', tr: 'Banyo ediliyor' },
  start: { en: 'Begin', tr: 'Başla' },
  resume: { en: 'Resume', tr: 'Devam et' },
  restart: { en: 'Start over', tr: 'Baştan başla' },
  replay: { en: 'Dream again', tr: 'Yeniden düşle' },
  headphones: { en: 'Best with headphones', tr: 'Kulaklıkla deneyimleyin' },
  paused: { en: 'Paused', tr: 'Duraklatıldı' },
  language: { en: 'Language', tr: 'Dil' },
  sound: { en: 'Sound', tr: 'Ses' },
  on: { en: 'On', tr: 'Açık' },
  off: { en: 'Off', tr: 'Kapalı' },
  fullscreen: { en: 'Full screen', tr: 'Tam ekran' },
  controls: { en: 'Controls', tr: 'Kontroller' },
  credits: { en: 'Assets: CC0 (Poly Haven, ambientCG, Freesound) and MIT (Microsoft Rocketbox).', tr: 'Varlıklar: CC0 (Poly Haven, ambientCG, Freesound) ve MIT (Microsoft Rocketbox).' },
  source: { en: 'Source code', tr: 'Kaynak kod' },
  menu: { en: 'Menu', tr: 'Menü' },
  chapter: { en: 'Chapter', tr: 'Bölüm' },
  memories: { en: 'Memories', tr: 'Anılar' },
  memoryFound: { en: 'Memory found', tr: 'Anı bulundu' },
  journey: { en: 'Journey', tr: 'Yolculuk' },
  scroll: { en: 'Scroll', tr: 'Kaydır' },
  walk: { en: 'Walk', tr: 'Yürü' },
  look: { en: 'Look', tr: 'Bak' },
  turn: { en: 'Turn', tr: 'Dön' },
  wheel: { en: 'Wheel', tr: 'Tekerlek' },
  drag: { en: 'Drag', tr: 'Sürükle' },
  swipeUp: { en: 'Swipe up', tr: 'Yukarı kaydır' },
  swipeSide: { en: 'Swipe sideways', tr: 'Yana kaydır' },
  twoFingers: { en: 'Two fingers', tr: 'İki parmak' },
  tutorialLook: { en: 'Look around', tr: 'Etrafına bak' },
  tutorialLookTouch: { en: 'Swipe sideways to look, up to walk', tr: 'Bakmak için yana, yürümek için yukarı kaydır' },
  tutorialMemory: { en: 'Hold your gaze on something strange to find a memory', tr: 'Tuhaf bir şeye bakışını sabitle: anıyı bul' },
  endMemories: { en: 'memories found', tr: 'anı bulundu' },
  soundLabel: { en: 'Toggle sound', tr: 'Sesi aç / kapat' },
  menuLabel: { en: 'Open the menu', tr: 'Menüyü aç' },
  noWebgl: { en: 'This piece needs a browser with WebGL 2.', tr: 'Bu eser WebGL 2 destekleyen bir tarayıcı gerektirir.' },
  failed: { en: 'The picture could not be developed. Please reload.', tr: 'Fotoğraf banyo edilemedi. Lütfen sayfayı yenileyin.' },
  lost: { en: 'The picture faded. Please reload the page.', tr: 'Fotoğraf soldu. Lütfen sayfayı yenileyin.' },
  /** Handwritten on the back of the giant print (seen from the sea). */
  printBack: { en: 'you were here', tr: 'buradaydın' },
} satisfies Record<string, Text>;

export type UiKey = keyof typeof ui;
