/**
 * Every word the piece says, in English and Turkish (the visitor switches between them at any time;
 * see src/ui/i18n.ts for which one is showing).
 */
import type { Cue } from './experience.config';
import { EVENINGS, eveningStarts } from './journey.config';

export type Lang = 'en' | 'tr';

export const LANGS: readonly Lang[] = ['tr', 'en'];

export type Text = Readonly<Record<Lang, string>>;

/**
 * Chapters of the film: where each begins, and its name. The HUD names the one you are in and marks where
 * each evening begins on the journey bar; an evening is stamped on the picture with its title and its number.
 */
export const chapters: readonly { at: Cue; name: Text; title?: Text; number?: string }[] = [
  { at: ['INTRO', 0], name: { en: 'The Shutter', tr: 'Deklanşör' } },
  { at: ['PHOTO_EJECT', 0], name: { en: 'Developing', tr: 'Banyo' } },
  { at: ['PHOTO_APPROACH', 0], name: { en: 'The Threshold', tr: 'Eşik' } },
  ...EVENINGS.map((e, i) => ({ at: ['STEP', eveningStarts[i], 0] as const, name: e.name, title: e.title, number: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][i] })),
  { at: ['EXPLORATION', 0.07], name: { en: 'Waking', tr: 'Uyanış' } },
];

/** Who made the piece (the credits name them as they are, in either language). */
export const DIRECTOR = 'Çayan Kuzu';
/** The speech engine the voices were made with, named in the credits (see scripts/voice). */
export const VOICE_ENGINE = 'Chatterbox Multilingual (Resemble AI, MIT); voices designed with VoxCPM2 (OpenBMB, Apache-2.0)';

export const ui = {
  kicker: { en: 'seven evenings, thirty-three minutes', tr: 'yedi akşam, otuz üç dakika' },
  /** The piece's motto, whole: in the credits. */
  motto: {
    en: 'The dream of a photograph turns hair white,\nThe dream of a photograph, every evening, half.',
    tr: 'Bir fotoğrafın rüyası saç beyazlatır,\nBir fotoğrafın rüyası her akşam yarım.',
  },
  /** The motto on the title screen: its second line breaks off, as every evening of the dream does. */
  mottoTitle: {
    en: 'The dream of a photograph turns hair white,\nThe dream of a photograph, every evening,',
    tr: 'Bir fotoğrafın rüyası saç beyazlatır,\nBir fotoğrafın rüyası her akşam',
  },
  warning: {
    en: 'For adults (18+). Disturbing images, sudden sounds, flickering light and common fears: spiders, insects, needles, dentists, tight spaces, heights, flying, deep water, being lost, the dark, sleep paralysis, dolls, clowns, birds, clusters of holes, being buried, death. Any part can be skipped from the menu.',
    tr: 'Yetişkinler içindir (18+). Rahatsız edici görüntüler, ani sesler, titreyen ışık ve yaygın korkular: örümcek, böcek, iğne, dişçi, kapalı alan, yükseklik, uçuş, derin su, kaybolma, karanlık, karabasan, oyuncak bebek, palyaço, kuş, delik kümeleri, diri diri gömülme, ölüm. Her bölüm menüden atlanabilir.',
  },
  skip: { en: 'Skip this part', tr: 'Bu bölümü atla' },
  continueFrom: { en: 'Go on from', tr: 'Şuradan devam et:' },
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
  /** The voices that say the lines (switched off, the lines are still shown). */
  voice: { en: 'Voice', tr: 'Seslendirme' },
  on: { en: 'On', tr: 'Açık' },
  off: { en: 'Off', tr: 'Kapalı' },
  fullscreen: { en: 'Full screen', tr: 'Tam ekran' },
  controls: { en: 'Controls', tr: 'Kontroller' },
  credits: {
    en: "Assets: CC0 and public domain (Poly Haven, ambientCG, Freesound, SMK, Smithsonian, Khronos, OpenGameArt, Wikimedia Commons, Poly Pizza, The Base Mesh); CC BY (heart: neshallads; clay figurine: Nagaoka Municipal Science Museum; dentist's chair: li chang; teeth, raven, roach, fly, shoes, staircase, window, curtains, easel, dental tools: Poly by Google; spider: p0ss, sunburn; waiting seats: Andrew-John Hickman; roses: Christopher F; theatre seat: Cormac White; gramophone: Don Carson; hospital things: GRADD CO, Brady Arnold; syringe: J-Toastie; floor lamp: Justin Randall; bus: Nick Ladd; sounds: qubodup; bus shelter: Zsky); MIT (Microsoft Rocketbox). Fonts: OFL, Apache 2.0.",
    tr: 'Varlıklar: CC0 ve kamu malı (Poly Haven, ambientCG, Freesound, SMK, Smithsonian, Khronos, OpenGameArt, Wikimedia Commons, Poly Pizza, The Base Mesh); CC BY (kalp: neshallads; kil heykelcik: Nagaoka Municipal Science Museum; dişçi koltuğu: li chang; dişler, kuzgun, hamamböceği, sinek, ayakkabı, merdiven, pencere, perde, şövale, dişçi aletleri: Poly by Google; örümcek: p0ss, sunburn; bekleme koltukları: Andrew-John Hickman; güller: Christopher F; tiyatro koltuğu: Cormac White; gramofon: Don Carson; hastane eşyaları: GRADD CO, Brady Arnold; şırınga: J-Toastie; ayaklı lamba: Justin Randall; otobüs: Nick Ladd; sesler: qubodup; durak: Zsky); MIT (Microsoft Rocketbox). Yazı tipleri: OFL, Apache 2.0.',
  },
  source: { en: 'Source code', tr: 'Kaynak kod' },
  notices: { en: 'Licences', tr: 'Lisanslar' },
  menu: { en: 'Menu', tr: 'Menü' },
  scroll: { en: 'Scroll', tr: 'Kaydır' },
  look: { en: 'Look', tr: 'Bak' },
  wheel: { en: 'Wheel', tr: 'Tekerlek' },
  drag: { en: 'Drag', tr: 'Sürükle' },
  swipeUp: { en: 'Swipe up', tr: 'Yukarı kaydır' },
  swipeDown: { en: 'Swipe down', tr: 'Aşağı kaydır' },
  swipeSide: { en: 'Swipe sideways', tr: 'Yana kaydır' },
  tutorialLook: { en: 'Look around', tr: 'Etrafına bak' },
  tutorialLookTouch: { en: 'Swipe sideways to look, up to hurry', tr: 'Bakmak için yana, hızlanmak için yukarı kaydır' },
  /** The credits, rolling up over black after the last street. */
  creditDirection: { en: 'Concept and direction', tr: 'Konsept ve yönetim' },
  creditVoice: { en: "The narrator's voice is synthetic", tr: 'Anlatıcının sesi sentetiktir' },
  creditScore: { en: 'Score', tr: 'Müzik' },
  creditScoreText: { en: 'The lullaby was composed for this piece', tr: 'Ninni bu eser için bestelendi' },
  creditAssets: { en: 'Assets and licences', tr: 'Varlıklar ve lisanslar' },
  creditCc0: {
    en: 'CC0 and public domain: Poly Haven, ambientCG, Freesound, SMK, Smithsonian, Khronos, OpenGameArt, Wikimedia Commons, Poly Pizza, The Base Mesh',
    tr: 'CC0 ve kamu malı: Poly Haven, ambientCG, Freesound, SMK, Smithsonian, Khronos, OpenGameArt, Wikimedia Commons, Poly Pizza, The Base Mesh',
  },
  creditCcBy: {
    en: 'CC BY: Poly by Google, neshallads, Nagaoka Municipal Science Museum, li chang, p0ss, sunburn, Andrew-John Hickman, Christopher F, Cormac White, Don Carson, GRADD CO, Brady Arnold, J-Toastie, Justin Randall, Nick Ladd, qubodup, Zsky',
    tr: 'CC BY: Poly by Google, neshallads, Nagaoka Municipal Science Museum, li chang, p0ss, sunburn, Andrew-John Hickman, Christopher F, Cormac White, Don Carson, GRADD CO, Brady Arnold, J-Toastie, Justin Randall, Nick Ladd, qubodup, Zsky',
  },
  creditOther: { en: 'MIT: Microsoft Rocketbox. Fonts: OFL, Apache 2.0.', tr: 'MIT: Microsoft Rocketbox. Yazı tipleri: OFL, Apache 2.0.' },
  endAlbum: { en: 'It was always you pressing the shutter. These are yours.', tr: 'Deklanşöre basan hep sendin. Bunlar senin.' },
  menuLabel: { en: 'Open the menu', tr: 'Menüyü aç' },
  noWebgl: { en: 'This piece needs a browser with WebGL 2.', tr: 'Bu eser WebGL 2 destekleyen bir tarayıcı gerektirir.' },
  failed: { en: 'The picture could not be developed. Please reload.', tr: 'Fotoğraf banyo edilemedi. Lütfen sayfayı yenileyin.' },
  lost: { en: 'The picture faded. Please reload the page.', tr: 'Fotoğraf soldu. Lütfen sayfayı yenileyin.' },
  /** Handwritten on the back of the giant print (seen from the sea). */
  printBack: { en: 'half of you stayed here', tr: 'yarın burada kaldı' },
} satisfies Record<string, Text>;

export type UiKey = keyof typeof ui;
