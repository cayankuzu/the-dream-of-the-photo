/**
 * Every word the piece says, in English and Turkish (the visitor switches between them at any time;
 * see src/ui/i18n.ts for which one is showing).
 */
import type { Cue } from './experience.config';

export type Lang = 'en' | 'tr';

export const LANGS: readonly Lang[] = ['tr', 'en'];

export type Text = Readonly<Record<Lang, string>>;

/** A line of narration, shown between two cues (see src/ui/Narration.ts for how it is set). */
export interface NarrationLine {
  from: Cue;
  to: Cue;
  text: Text;
}

/** The voice of the nightmare: few words, each on its own, never over a moment that speaks for itself. */
export const narration: readonly NarrationLine[] = [
  {
    from: ['CAMERA_RAISE', 0.15],
    to: ['AIM', 0.9],
    text: { en: 'You should not have taken this.', tr: 'Bunu çekmemeliydin.' },
  },
  {
    from: ['PHOTO_EJECT', 0.15],
    to: ['PHOTO_REVEAL', 0.5],
    text: { en: 'No one comes out of the developer the same.', tr: 'Banyodan kimse eskisi gibi çıkmaz.' },
  },
  {
    from: ['PHOTO_REVEAL', 0.65],
    to: ['PHOTO_APPROACH', 0.9],
    text: { en: 'Look. No one stands behind you. In the picture, someone does.', tr: 'Bak. Arkanda kimse yok. Fotoğrafta var.' },
  },
  {
    from: ['WORLD', 0.012],
    to: ['WORLD', 0.05],
    text: { en: 'This is not rain. It is hair. Someone\'s.', tr: 'Bu yağmur değil. Saç. Birinin saçı.' },
  },
  {
    from: ['WORLD', 0.055],
    to: ['WORLD', 0.09],
    text: { en: 'Every strand, a night gone white.', tr: 'Her tel, ağarmış bir gece.' },
  },
  {
    from: ['WORLD', 0.1],
    to: ['WORLD', 0.15],
    text: { en: 'You did not scratch out the faces. Not yet.', tr: 'Yüzleri kazıyan sen değilsin. Henüz.' },
  },
  {
    from: ['WORLD', 0.2],
    to: ['WORLD', 0.25],
    text: { en: 'They walk when you are not looking.', tr: 'Bakmadığın zaman yürüyorlar.' },
  },
  {
    from: ['WORLD', 0.27],
    to: ['WORLD', 0.33],
    text: { en: 'Half of them are here. The other half sits down to dinner every evening.', tr: 'Yarısı burada. Öteki yarısı her akşam sofraya oturuyor.' },
  },
  {
    from: ['WORLD', 0.355],
    to: ['WORLD', 0.4],
    text: { en: 'This was not built for you. It was not built for anyone.', tr: 'Burası senin için yapılmadı. Kimse için yapılmadı.' },
  },
  {
    from: ['WORLD', 0.43],
    to: ['WORLD', 0.47],
    text: { en: 'When you wake, your head stays here.', tr: 'Uyanınca başın burada kalacak.' },
  },
  {
    from: ['WORLD', 0.48],
    to: ['WORLD', 0.52],
    text: { en: 'The back on the screen is yours. What stands behind it isn\'t.', tr: 'Ekrandaki sırt senin. Arkandaki değil.' },
  },
  {
    from: ['WORLD', 0.55],
    to: ['WORLD', 0.62],
    text: { en: 'With every frame it is one step closer.', tr: 'Her kare bir adım daha yakın.' },
  },
  {
    from: ['WORLD', 0.645],
    to: ['WORLD', 0.69],
    text: { en: 'The wall is breathing. You are not.', tr: 'Duvar nefes alıyor. Sen almıyorsun.' },
  },
  {
    from: ['WORLD', 0.7],
    to: ['WORLD', 0.74],
    text: { en: 'It remembers you. With its teeth.', tr: 'Seni hatırlıyor. Dişleriyle.' },
  },
  {
    from: ['WORLD', 0.79],
    to: ['WORLD', 0.87],
    text: { en: 'No one leaves a photograph. You only fall deeper into it.', tr: 'Bir fotoğraftan çıkılmaz. Daha derinine düşülür.' },
  },
  {
    from: ['WORLD', 0.905],
    to: ['WORLD', 0.94],
    text: { en: 'Every evening the sun stops halfway.', tr: 'Güneş her akşam yarıda kalır.' },
  },
  {
    from: ['WORLD', 0.945],
    to: ['WORLD', 0.98],
    text: { en: 'They are all you. All their hair is white.', tr: 'Hepsi sensin. Hepsinin saçı beyaz.' },
  },
  {
    from: ['WORLD', 0.985],
    to: ['EXPLORATION', 0.03],
    text: { en: 'It was always you pressing the shutter.', tr: 'Deklanşöre basan hep sendin.' },
  },
  {
    from: ['EXPLORATION', 0.18],
    to: ['EXPLORATION', 0.42],
    text: { en: 'Do not keep the photograph.', tr: 'Fotoğrafı saklama.' },
  },
];

/** The motto comes on at the end (EXPLORATION fraction), and stays until everything goes black. */
export const endTitleFrom = 0.45;

/**
 * Chapters of the journey: where each begins, and its name. The HUD names the one you are in and
 * marks them all on the journey bar.
 */
export const chapters: readonly { at: Cue; name: Text }[] = [
  { at: ['INTRO', 0], name: { en: 'The Shutter', tr: 'Deklanşör' } },
  { at: ['PHOTO_EJECT', 0], name: { en: 'Developing', tr: 'Banyo' } },
  { at: ['PHOTO_APPROACH', 0], name: { en: 'The Threshold', tr: 'Eşik' } },
  { at: ['WORLD', 0], name: { en: 'Hair', tr: 'Saç' } },
  { at: ['WORLD', 0.09], name: { en: 'Scratched Faces', tr: 'Kazınmış Yüzler' } },
  { at: ['WORLD', 0.19], name: { en: 'Half', tr: 'Yarım' } },
  { at: ['WORLD', 0.34], name: { en: 'Concrete', tr: 'Beton' } },
  { at: ['WORLD', 0.525], name: { en: 'The Darkroom', tr: 'Karanlık Oda' } },
  { at: ['WORLD', 0.635], name: { en: 'Meat', tr: 'Et' } },
  { at: ['WORLD', 0.74], name: { en: 'The Void', tr: 'Boşluk' } },
  { at: ['WORLD', 0.895], name: { en: 'The Half Sun', tr: 'Yarım Güneş' } },
  { at: ['WORLD', 0.98], name: { en: 'The Photographer', tr: 'Fotoğrafçı' } },
  { at: ['EXPLORATION', 0.07], name: { en: 'Waking', tr: 'Uyanış' } },
];

/** Memories: things inside the dream that reveal themselves to a long look (the HUD counts them). */
export const memories = {
  found: { en: 'The found photograph', tr: 'Bulunmuş fotoğraf' },
  window: { en: 'A window onto the real moment', tr: 'Gerçek ana açılan pencere' },
  faces: { en: 'The scratched faces', tr: 'Kazınmış yüzler' },
  half: { en: 'The one left halfway', tr: 'Yarım kalan' },
  head: { en: 'The half-buried head', tr: 'Yarısı gömülü baş' },
  dinner: { en: 'The table, every evening', tr: 'Her akşamki sofra' },
  screens: { en: 'The screens that show you', tr: 'Seni gösteren ekranlar' },
  frame: { en: 'One frame closer', tr: 'Bir kare daha yakın' },
  eye: { en: 'The eye that looks back', tr: 'Sana bakan göz' },
  teeth: { en: 'The teeth', tr: 'Dişler' },
  giant: { en: 'The print that waits', tr: 'Bekleyen fotoğraf' },
  sun: { en: 'The half sun', tr: 'Yarım güneş' },
  moon: { en: 'The moon is a photograph', tr: 'Ay bir fotoğraf' },
  photographer: { en: 'The photographer on the water', tr: 'Sudaki fotoğrafçı' },
} satisfies Record<string, Text>;

export type MemoryId = keyof typeof memories;

export const ui = {
  kicker: { en: 'a three-minute nightmare', tr: 'üç dakikalık bir kâbus' },
  /** The piece's motto: on the title screen, and the last words. */
  motto: {
    en: 'The dream of a photograph turns hair white,\nThe dream of a photograph, every evening, half.',
    tr: 'Bir fotoğrafın rüyası saç beyazlatır,\nBir fotoğrafın rüyası her akşam yarım.',
  },
  warning: { en: 'Contains disturbing images, sudden sounds and flickering light.', tr: 'Rahatsız edici görüntüler, ani sesler ve titreyen ışık içerir.' },
  moves: { en: 'Moves by itself', tr: 'Kendiliğinden ilerler' },
  hurry: { en: 'Hurry', tr: 'Hızlan' },
  back: { en: 'Back', tr: 'Geri dön' },
  tutorialWalk: { en: 'The dream does not wait. Scroll to hurry it, or to go back for a moment.', tr: 'Rüya beklemez. Kaydırırsan hızlanır, geri kaydırırsan bir an durur.' },
  loading: { en: 'Developing', tr: 'Banyo ediliyor' },
  start: { en: 'Begin', tr: 'Başla' },
  resume: { en: 'Resume', tr: 'Devam et' },
  restart: { en: 'Start over', tr: 'Baştan başla' },
  replay: { en: 'Dream it again', tr: 'Yeniden gör' },
  headphones: { en: 'Best with headphones', tr: 'Kulaklıkla deneyimleyin' },
  paused: { en: 'Paused', tr: 'Duraklatıldı' },
  language: { en: 'Language', tr: 'Dil' },
  sound: { en: 'Sound', tr: 'Ses' },
  on: { en: 'On', tr: 'Açık' },
  off: { en: 'Off', tr: 'Kapalı' },
  fullscreen: { en: 'Full screen', tr: 'Tam ekran' },
  controls: { en: 'Controls', tr: 'Kontroller' },
  credits: {
    en: "Assets: CC0 and public domain (Poly Haven, ambientCG, Freesound, SMK, Smithsonian, Khronos, OpenGameArt, Wikimedia Commons, Poly Pizza); CC BY (heart: neshallads; dentist's chair: li chang; teeth, raven: Poly by Google); MIT (Microsoft Rocketbox). Fonts: OFL, Apache 2.0.",
    tr: 'Varlıklar: CC0 ve kamu malı (Poly Haven, ambientCG, Freesound, SMK, Smithsonian, Khronos, OpenGameArt, Wikimedia Commons, Poly Pizza); CC BY (kalp: neshallads; dişçi koltuğu: li chang; dişler, kuzgun: Poly by Google); MIT (Microsoft Rocketbox). Yazı tipleri: OFL, Apache 2.0.',
  },
  source: { en: 'Source code', tr: 'Kaynak kod' },
  notices: { en: 'Licences', tr: 'Lisanslar' },
  menu: { en: 'Menu', tr: 'Menü' },
  memories: { en: 'Memories', tr: 'Anılar' },
  memoryFound: { en: 'Memory found', tr: 'Anı bulundu' },
  scroll: { en: 'Scroll', tr: 'Kaydır' },
  look: { en: 'Look', tr: 'Bak' },
  wheel: { en: 'Wheel', tr: 'Tekerlek' },
  drag: { en: 'Drag', tr: 'Sürükle' },
  swipeUp: { en: 'Swipe up', tr: 'Yukarı kaydır' },
  swipeDown: { en: 'Swipe down', tr: 'Aşağı kaydır' },
  swipeSide: { en: 'Swipe sideways', tr: 'Yana kaydır' },
  tutorialLook: { en: 'Look around', tr: 'Etrafına bak' },
  tutorialLookTouch: { en: 'Swipe sideways to look, up to hurry', tr: 'Bakmak için yana, hızlanmak için yukarı kaydır' },
  tutorialMemory: { en: 'Do not look away: what you stare at becomes a memory', tr: 'Gözünü ayırma: baktığın şey anı olur' },
  endMemories: { en: 'memories found', tr: 'anı bulundu' },
  menuLabel: { en: 'Open the menu', tr: 'Menüyü aç' },
  noWebgl: { en: 'This piece needs a browser with WebGL 2.', tr: 'Bu eser WebGL 2 destekleyen bir tarayıcı gerektirir.' },
  failed: { en: 'The picture could not be developed. Please reload.', tr: 'Fotoğraf banyo edilemedi. Lütfen sayfayı yenileyin.' },
  lost: { en: 'The picture faded. Please reload the page.', tr: 'Fotoğraf soldu. Lütfen sayfayı yenileyin.' },
  /** Handwritten on the back of the giant print (seen from the sea). */
  printBack: { en: 'half of you stayed here', tr: 'yarın burada kaldı' },
} satisfies Record<string, Text>;

export type UiKey = keyof typeof ui;
