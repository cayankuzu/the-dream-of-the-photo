/**
 * The film around the dream: the narrator's lines and the score's cues, placed on the timeline; and what the
 * street looks like each time an evening breaks off and the viewer is back in it for a moment (a waking), with
 * the print in the hand a little further along and the hair a little whiter.
 */
import type { Text } from './copy.config';

/**
 * Who speaks: the photograph; the voice from the house (a mother's), through a window or close; that voice through a
 * telephone or an intercom; someone in a room of the dream (a whisper that belongs to nobody).
 */
export type VoiceStyle = 'narrator' | 'house' | 'phone' | 'dream';

/**
 * A moment of the film: seconds into a step of the journey (its id: 'walk@1', 'kitchen', 'wake@2': see STEP_IDS
 * in journey.config.ts) or into a phase of the timeline ('COLD', 'INTRO', 'EXPLORATION', 'CREDITS').
 */
export type FilmCue = readonly [where: string, seconds: number];

export interface FilmLine {
  at: FilmCue;
  text: Text;
  voice?: VoiceStyle;
  /**
   * The whole sentence this line is the beginning of: its clip is cut out of one take of the whole sentence (see
   * scripts/voice/build-voice.py), so the voice stops in the middle of its tune, a little later each evening.
   */
  brokenOff?: Text;
  /** It ends exactly with its step (placed backwards from the step's end by its length: the seconds of its cue are not used). */
  toEnd?: boolean;
}

export interface ScoreCue {
  at: FilmCue;
  /** File name under public/audio/score, without its ending. */
  cue: string;
  gain?: number;
  /** Seconds over which it comes in over the cue before it. */
  fade?: number;
  /** It ends exactly with its step (placed backwards from the step's end: the seconds of its cue are not used). */
  toEnd?: boolean;
}

export const filmConfig = {
  /** A line with no clip (the voice switched off, a line with the viewer's own time in it) stays this long: seconds per letter, a rest, at least. */
  unvoiced: { perLetter: 0.075, rest: 0.6, least: 1.6 },
  /** A line stays this long after its last word (s). */
  subtitleRest: 0.5,
  /** A voice that must stop for a line without a clip stops over this long (s). */
  hush: 0.12,
  /** A step of the timeline longer than this many seconds of the piece is a jump: nothing is said. */
  jump: 3,
  /** Steps of the journey ahead whose clips are fetched. */
  stepsAhead: 2,
} as const;

/** The motto, whole: said once, at the end. Every evening before that breaks off a little later in it. */
export const MOTTO: Text = {
  tr: 'Bir fotoğrafın rüyası saç beyazlatır. Bir fotoğrafın rüyası her akşam yarım.',
  en: 'The dream of a photograph turns hair white. The dream of a photograph, every evening, half.',
};

/** A line at a moment of the film. */
const line = (where: string, seconds: number, tr: string, en: string, voice?: VoiceStyle): FilmLine => ({ at: [where, seconds], text: { tr, en }, voice });
/** The motto, broken off as far as an evening gets (by default at the very end of its step, where the dream breaks off). */
const brokenOff = (where: string, tr: string, en: string, seconds?: number): FilmLine => ({ at: [where, seconds ?? 0], text: { tr, en }, brokenOff: MOTTO, toEnd: seconds === undefined });

/**
 * The narrator's track: the photograph speaks to you, about you. It never names what the picture already shows
 * and never announces a blow; it says less every evening. Rooms say their own lines themselves (Room.say): they
 * are spoken too. Times are seconds on the screen from the start of the step (see DIRECTORS_CUT in the repository
 * history for the reasons behind each placement: before a picture, after a blow, never over one).
 */
export const LINES: readonly FilmLine[] = [
  // the cold open: black, the table heard; for a moment the street as it will be
  line('COLD', 1, 'Otur artık, yemek soğuyor.', 'Sit down now, dinner is getting cold.', 'house'),
  line('COLD', 4.5, 'Hemen dönerim, dedin.', "I'll be right back, you said."),
  line('COLD', 8, 'Otuz üç yıl sonra hâlâ sokaktaydın.', 'Thirty-three years later you were still in the street.'),
  // the prologue: the street, the shutter, the print
  line('INTRO', 0.8, 'Altı buçuktu. Pencerede üç gölge vardı. Bir de boş sandalye.', 'It was half past six. Three shadows in the window. And one empty chair.'),
  line('INTRO', 6.5, 'Annen, baban, kardeşin. Boş sandalye senindi.', 'Your mother, your father, the little one. The empty chair was yours.'),
  line('INTRO', 11.4, 'Sokağa çıktın. Dönüp eve baktın.', 'You went out into the street. You turned and looked at the house.'),
  line('INTRO', 17.5, 'Ben o fotoğrafım.', 'I am that photograph.'),
  line('INTRO', 21, 'Ben belirirken bir rüya görürüm.', 'While my image comes up, I dream.'),
  line('INTRO', 24.5, 'Rüyamın sonunu ben de bilmiyorum. Her akşam yarıda kesiliyor.', 'I do not know how my dream ends either. Every evening it breaks off halfway.'),
  line('INTRO', 30.3, 'Gel. Sonunu birlikte görelim.', 'Come. Let us see the end together.'),

  // I Saç
  line('walk@1', 3, 'Yağan, yağmur değil. Saç. Bekleyenlerin saçı.', 'That is not rain. It is hair. The hair of those who wait.'),
  line('walk@1', 11, 'Ben yalnızca bu sokağı gördüm. Gerisini uyduruyorum.', 'I only ever saw this street. The rest I am making up.'),
  line('walk@1', 18.5, 'Sokağın sonundaki kapı, sizin evin kapısı.', 'The door at the end of the street is the door of your house.'),
  line('corridor@1', 2, 'Evin koridoru. Hatırladığından uzun.', 'The corridor of the house. Longer than you remember.'),
  line('corridor@1', 7, 'Kapıların ardını bilmem. Sen bilirsin.', 'I do not know what is behind the doors. You do.'),
  line('corridor@1', 12.5, 'Sofra, bu koridorun sonunda.', 'The table is at the end of this corridor.'),
  line('barber', 3, 'Saçın son kez siyah.', 'Your hair is black for the last time.'),
  line('barber', 12, 'Yere düşen her tel, bir akşam.', 'Every strand on the floor is an evening.'),
  line('waitingroom', 4.5, 'Onlar seni bekliyor. Sen sıranı bekliyorsun.', 'They are waiting for you. You are waiting for your turn.'),
  line('birches', 6.5, 'Giderken arkana bakmadın. Onlar baktı.', 'You did not look back as you left. They did.'),
  line('spiders', 8, 'İlk yalan küçüktü. Hemen dönerim.', "The first lie was small. I'll be right back."),
  line('walk@2', 2, 'Bekleyenlerin yarısı burada. Öbür yarısı sofrada, her akşam.', 'Half of those who wait are here. The other half is at the table, every evening.'),
  line('walk@2', 14, 'Kapıya az kaldı.', 'The door is close.'),
  brokenOff('corridor@2', 'Bir fotoğrafın', 'The dream'),
  line('wake@1', 2.5, 'Yemek soğuyor!', 'Dinner is getting cold!', 'house'),
  line('wake@1', 5.6, 'Rüyada dört yıl geçti. Ben hâlâ belirmedim.', 'Four years have passed in the dream. My image has still not come up.'),
  line('wake@1', 10.3, 'Tabağın hâlâ sofrada. İçine bakmak ister misin?', 'Your plate is still on the table. Do you want to look into it?'),

  // II Yarım
  line('evening@2', 2.5, 'İkinci akşam. Sofra seni bekledi. Yemek bekleyemedi.', 'The second evening. The table waited for you. The food could not.'),
  line('kitchen', 3, 'Tabağını kaldırmadılar. Yıllarca.', 'They did not clear your plate. For years.'),
  line('kitchen', 25.5, 'Yarım kalan yemeği başkaları bitirir.', 'What is left half eaten, others finish.'),
  line('cellar', 11.3, 'Tabağını her akşam ayırdılar. Atmaya kıyamadılar.', 'Every evening they set your plate aside. They could not throw it away.'),
  line('crawl', 12.5, 'Yukarı bakan, annen.', 'The one looking up is your mother.'),
  line('studio', 0.8, 'Her yıl bir aile fotoğrafı çektirdiler. Yerini boş bıraktılar.', 'Every year they had a family portrait taken. They left your place empty.'),
  line('dentist', 8, 'Mektup yazmadın. Telefon etmedin. Ağzını açmadın.', 'You did not write. You did not call. You did not open your mouth.'),
  line('walk@3', 2, 'Sokaktan ötesini görmedim. Dünyayı, pencereden gördüğüm eşyadan kurdum.', 'I never saw past the street. I built the world from the things I saw through the window.'),
  line('walk@3', 14, 'Çocukken her şey bu kadar büyüktü. Gurbette yine büyür.', 'When you were a child everything was this large. Far from home, it grows large again.'),
  brokenOff('corridor@3', 'Bir fotoğrafın rüyası', 'The dream of a photograph'),
  line('wake@2', 2.5, 'Hadi yavrum, yemek soğuyor.', 'Come on, my dear, dinner is getting cold.', 'house'),
  line('wake@2', 6, 'Dokuz yıl.', 'Nine years.'),
  line('wake@2', 8.5, 'Bu dokuz yıl neredeydin?', 'Where were you, these nine years?'),

  // III Uyku
  line('evening@3', 2.5, 'Üçüncü akşam. Uzaktasın. Uyuyamıyorsun.', 'The third evening. You are far away. You cannot sleep.'),
  line('busstop', 8.5, 'O akşam bu otobüse bindin.', 'That evening you got on this bus.'),
  line('plane', 1.5, 'Sonra daha uzağa gittin. Denizin ötesine.', 'Then you went further. Across the sea.'),
  line('payphone', 2, 'Her akşam altı buçukta çaldı. Açmadın.', 'It rang every evening at half past six. You did not answer.'),
  line('beds', 1, 'Uyuyamayanlar sabahı böyle bekler.', 'This is how the sleepless wait for morning.'),
  line('walk@4', 2, 'Fotoğraflar burada doğar. Karanlık odada.', 'This is where photographs are born. The darkroom.'),
  line('walk@4', 12, 'Banyodan kimse eskisi gibi çıkmaz.', 'No one comes out of the developer the same.'),
  line('mirror', 8, 'Yüzünü hiç görmedim. Sen hep makinenin arkasındaydın.', 'I never saw your face. You were always behind the camera.'),
  line('mirror', 13.5, 'Seni ancak yaşlı düşünebiliyorum.', 'I can only picture you old.'),
  // in the dawn after the four seconds of silence: cut dead, then the eye looks up
  brokenOff('karabasan', 'Bir fotoğrafın rüyası saç', 'The dream of a photograph turns', 54.2),
  line('wake@3', 2.5, 'Seni bekliyoruz. Yemek soğuyor.', 'We are waiting for you. Dinner is getting cold.', 'house'),
  line('wake@3', 6.5, 'On üç yıl.', 'Thirteen years.'),
  line('wake@3', 8.5, 'Annen artık pencereye gelmiyor.', 'Your mother no longer comes to the window.'),

  // IV Su
  line('evening@4', 2.5, 'Dördüncü akşam. Aranızda artık bir deniz var.', 'The fourth evening. There is a sea between you and them now.'),
  line('flood', 6, 'Ağlamadılar. Ev ağladı.', 'They did not cry. The house did.'),
  // after the flash has shown the face, before the eye opens
  line('deep', 39.3, 'Bekleyenler büyür. Uykuda bile.', 'Those who wait grow larger. Even asleep.'),
  line('lost', 2, 'Küçükken bir kere kayboldun.', 'Once, when you were small, you got lost.'),
  line('ward', 14, 'Hastanede herkes kapıya bakar.', 'In a hospital everyone watches the door.'),
  // in the long tone
  line('ward', 41.9, 'Gelmedin.', 'You did not come.'),
  line('walk@5', 2, 'Söylemediğin her söz burada kaldı.', 'Every word you did not say stayed here.'),
  line('walk@5', 12, 'İnsanın boğazı, yuttuğu sözlerle dolar.', 'A throat fills with the words it swallows.'),
  line('corridor@5', 9, 'Suya bak. Yukarıda artık olmayan biri var.', 'Look at the water. Someone is there who is no longer up here.'),
  brokenOff('corridor@5', 'Bir fotoğrafın rüyası saç beyazlatır. Bir fotoğrafın', 'The dream of a photograph turns hair white. The dream'),
  line('wake@4', 2.5, 'Yemek soğudu.', 'Dinner has gone cold.', 'house'),
  line('wake@4', 6.5, 'On yedi yıl. Pencereye bak.', 'Seventeen years. Look at the window.'),
  line('wake@4', 10, 'Sıra kimde?', 'Whose turn is next?'),

  // V Karanlık
  line('evening@5', 2.5, 'Beşinci akşam. Işığı söndürdüler. Bekleyen azaldı.', 'The fifth evening. They put out the light. Fewer are waiting.'),
  line('washing', 2, 'Çamaşırı hep dört kişilik astı. Sonuna kadar.', 'She always hung out washing for four. To the end.'),
  line('dolls', 11, 'Odana dokunmadılar. Oyuncakların seni bekledi.', 'They did not touch your room. Your toys waited for you.'),
  line('walk@6', 2, 'Fotoğraflar birbirini görür. Seni soruyorlar.', 'Photographs can see one another. They are asking about you.'),
  line('walk@6', 13, 'Bir fotoğraftan çıkılmaz. Daha derinine düşülür.', 'No one leaves a photograph. You only fall deeper into it.'),
  // after the fork has rung on the chair
  line('birds', 6.5, 'Haberi kuşlar getirdi. Babanı gömmüşler.', 'The birds brought the news. They had already buried your father.'),
  brokenOff('buried', 'Bir fotoğrafın rüyası saç beyazlatır. Bir fotoğrafın rüyası her', 'The dream of a photograph turns hair white. The dream of a photograph, every'),
  line('wake@5', 2.5, 'Soğudu.', 'Gone cold.', 'house'),
  line('wake@5', 6.5, 'Yirmi iki yıl. Bir kişi kaldı.', 'Twenty-two years. One is left.'),

  // VI Boşluk
  line('evening@6', 2.5, 'Altıncı akşam. Kardeşin de gitti. Sofra duruyor.', 'The sixth evening. The little one has gone too. The table still stands.'),
  // once the beam's cut end has come into view
  line('beam', 18.5, 'Yolun hep buraya kadardı. Yarısına kadar.', 'Your road always came this far. Halfway.'),
  // after the one who sits has appeared
  line('teeth', 11, 'Sandalyen kıyıda kaldı.', 'Your chair stayed on the shore.'),
  line('walk@7', 2, 'Güneş her akşam yarıda kalır.', 'Every evening the sun stops halfway.'),
  line('walk@7', 12, 'Suyun üstündekilerin hepsi sensin.', 'The ones on the water are all you.'),
  // after the third question
  line('exam', 25.5, 'Yüzleri yok. Çünkü unuttun.', 'They have no faces. Because you forgot them.'),
  line('party', 7, 'Doğum günün. Otuz üç mum.', 'Your birthday. Thirty-three candles.'),
  line('car', 2, 'Bir kere, dönmek için yola çıktın.', 'Once, you set out to go back.'),
  line('unseen', 2, 'Bir kere kapıya kadar geldin.', 'Once, you came as far as the door.'),
  brokenOff('unseen', 'Bir fotoğrafın rüyası saç beyazlatır. Bir fotoğrafın rüyası her akşam ya-', 'The dream of a photograph turns hair white. The dream of a photograph, every evening, ha-'),
  line('wake@6', 8, 'Yirmi yedi yıl.', 'Twenty-seven years.'),

  // VII Sen
  line('evening@7', 2.5, 'Son akşam. Bu kez rüya yarıda kalmayacak.', 'The last evening. This time the dream will not break off.'),
  line('home', 2.6, 'Döndün. Anahtar hâlâ paspasın altındaydı.', 'You came back. The key was still under the mat.'),
  // when the viewer turns and finds only a coat
  line('home', 56.8, 'Seni arıyordu. Otuz üç yıldır.', 'He was looking for you. For thirty-three years.'),
  line('stairs', 1, 'Bir ömür.', 'A life.'),
  // once the picture has turned over and you lie in it
  line('funeral', 23.5, 'Bu cenazeye geldin. Gelmemek elinde değildi.', 'You came to this funeral. It was not in your hands to stay away.'),
  line('album', 19, 'Saçları sofradan buraya kadar uzadı. Beklerken.', 'Their hair grew from the table all the way here. While they waited.'),
  // just after the bell, when the clock has moved
  line('album', 41.5, 'Altı buçuğu bir geçiyor. Otuz üç yıldır ilk kez.', 'Six thirty-one. For the first time in thirty-three years.'),
  line('walk@8', 2, 'Şimdi o seni çekiyor.', 'Now he is taking your picture.'),

  // the ending: the street, thirty-three years on
  line('EXPLORATION', 5, 'Belirdim. Artık tamamım.', 'My image has come up. I am whole now.'),
  line('EXPLORATION', 13, 'Otuz üç dakika mı sürdü, otuz üç yıl mı?', 'Did it take thirty-three minutes, or thirty-three years?'),
  line('EXPLORATION', 20, 'Saçına bak.', 'Look at your hair.'),
  { at: ['EXPLORATION', 27], text: MOTTO },

  // the street as it really is (what follows depends on the viewer: see STREET_CHOICE)
  line('STREET', 1.5, 'Yemek soğuyor!', 'Dinner is getting cold!', 'house'),
  line('STREET', 3.6, 'Saat hâlâ altı buçuk. Daha belirmedim bile.', 'It is still half past six. My image has not even begun to come up.'),
  line('STREET', 8.1, 'Saçına bak.', 'Look at your hair.'),
  line('STREET', 10.2, 'Bunların hiçbiri olmadı. Henüz.', 'None of this has happened. Yet.'),
];

/**
 * The one choice of the film, in the last street: from `ask` (s into it) the viewer may press to go home; pressed,
 * the screen goes black and the house is heard taking you back; not pressed by `decide`, the print starts to come
 * up and the picture is taken. Either way it is black by `black` (and the names follow).
 */
export const STREET_CHOICE = {
  ask: 12.8,
  decide: 16.6,
  black: { home: 0.6, stay: 1.6 },
  prompt: { tr: 'Bas: eve dön', en: 'Press: go home' } as Text,
  home: { text: { tr: 'Nerede kaldın?', en: 'Where have you been?' } as Text, voice: 'house' as VoiceStyle, after: 2.4, cue: 'home' },
  stay: { text: { tr: 'Hemen dönerim, dedin.', en: "I'll be right back, you said." } as Text, voice: 'narrator' as VoiceStyle, shutterAfter: 1.9 },
} as const;

/**
 * The score: the lullaby, a bar further each evening and cut with the voice where the dream breaks off; a low
 * note under each evening's title; the table heard in the dark at the start; the lullaby whole at the table and
 * under the names. Evening III (karabasan) and V (the grave) break off in silence.
 */
export const SCORE: readonly ScoreCue[] = [
  { at: ['COLD', 0.02], cue: 'cold', fade: 0 },
  { at: ['COLD', 8.8], cue: 'breakoff', fade: 0 },
  { at: ['walk@1', 0], cue: 'card' },
  { at: ['corridor@2', 0], cue: 'theme_1', toEnd: true, fade: 0.4 },
  { at: ['evening@2', 0], cue: 'card' },
  { at: ['corridor@3', 0], cue: 'theme_2', toEnd: true, fade: 0.4 },
  { at: ['evening@3', 0], cue: 'card' },
  { at: ['evening@4', 0], cue: 'card' },
  { at: ['corridor@5', 0], cue: 'theme_4', toEnd: true, fade: 0.4 },
  { at: ['evening@5', 0], cue: 'card' },
  { at: ['evening@6', 0], cue: 'card' },
  { at: ['unseen', 0], cue: 'theme_6', toEnd: true, fade: 0.6 },
  { at: ['evening@7', 0], cue: 'card' },
  { at: ['album', 40], cue: 'theme_7', fade: 0.2 },
  { at: ['CREDITS', 1], cue: 'theme_7', fade: 1 },
];

/** Lines that rooms say themselves in another voice than the narrator's (by their Turkish text), when they do not name it. */
export const ROOM_VOICES: Readonly<Record<string, VoiceStyle>> = {};

type V3 = readonly [number, number, number];

/** What the camera looks at in the street: a point, or one of the things that move. */
export type WakeTarget = V3 | 'print' | 'head' | 'window';

/**
 * The window of the house at the end of the street (see Alley.setHome): the dinner table behind a curtain, seen
 * as the shadows the lamp throws on it.
 */
export interface HomeWindow {
  /** How bright the room is (0..1). */
  light: number;
  /** What lights it: the lamp over the table, a television (its blue, flickering slowly), or nothing. */
  kind: 'lamp' | 'tv' | 'dark';
  /**
   * How many sit at the table, 0 to 4. Those who leave go in the story's order (the mother, then the father, then
   * the little one); the fourth is you, in the chair that otherwise stands empty.
   */
  seated: number;
  /** The mother stands at the curtain, looking out. */
  standing?: boolean;
  /** How much of the curtain is drawn aside, from the left (0 closed, 1 open). */
  drawn?: number;
}

/** Who stands in the street: the ones who have left the window. */
export type StreetFigure = 'mother' | 'father' | 'little';

export interface WakeSpec {
  /** How white the hair is by now (0..1). */
  white: number;
  /** How far the print in the hand has come up (0..1). */
  develop: number;
  window: HomeWindow;
  /** Who stands in the street, and where (x and z, m: the photographer stands at the origin facing -Z); each faces him. */
  people?: readonly { who: StreetFigure; at: readonly [x: number, z: number] }[];
  /**
   * The shot (world space): where the camera starts and ends, what it looks at (`targetTo`: what it looks at by the
   * end, when that changes), its field of view at both ends (deg), where it focuses and how shallow that is.
   */
  shot: { from: V3; to: V3; target: WakeTarget; targetTo?: WakeTarget; fov: readonly [number, number]; focus: WakeTarget; aperture: number };
}

/**
 * Index 0 is the street as it really is, after the ending: nothing has happened yet. 1 to 6 follow the first six
 * evenings. 7 is the glimpse in the cold open: the street as it will be. (The ending itself: see walkConfig.ending.)
 * Each is one slow move: 0 comes in from the prologue's own framing to his dark hair, the grey print and the lit
 * window; 1 is close over his shoulder on the print; 2 and 3 are long lenses on the window past his head (from
 * high on the right, then from low on the left); 4 looks deep down the street to the one who stands under the
 * bulb; 5 is a telephoto from far behind, his head between the two under the cold lamp and the window above it;
 * 6 draws back from his head past the three who stand behind him; 7 is his white head, small, in the dark window.
 */
export const WAKES: readonly WakeSpec[] = [
  {
    white: 0,
    develop: 0,
    window: { light: 1, kind: 'lamp', seated: 3 },
    shot: { from: [0.8, 1.62, 2.5], to: [0.62, 1.74, 1.15], target: [-0.3, 1.45, -8], targetTo: [-2.04, 1.82, -9.52], fov: [32, 24], focus: 'head', aperture: 6 },
  },
  {
    white: 0.24,
    develop: 0.16,
    window: { light: 1, kind: 'lamp', seated: 3 },
    shot: { from: [0.42, 1.76, 0.66], to: [0.36, 1.75, 0.5], target: [-1.6, 1.45, -9], fov: [26, 24], focus: 'print', aperture: 10 },
  },
  {
    white: 0.37,
    develop: 0.3,
    window: { light: 1, kind: 'lamp', seated: 2, standing: true },
    shot: { from: [0.3, 1.86, 3.1], to: [0.2, 1.86, 3], target: [-0.24, 1.88, -12], fov: [9, 8.4], focus: 'window', aperture: 5 },
  },
  {
    white: 0.5,
    develop: 0.44,
    window: { light: 0.72, kind: 'lamp', seated: 3, drawn: 0.5 },
    shot: { from: [-0.5, 1.28, 3.2], to: [-0.44, 1.3, 3.05], target: [0.5, 2.75, -14], fov: [9.5, 9], focus: 'window', aperture: 5 },
  },
  {
    white: 0.63,
    develop: 0.58,
    window: { light: 0.6, kind: 'lamp', seated: 2 },
    people: [{ who: 'mother', at: [-0.45, -29.5] }],
    shot: { from: [0.95, 1.48, 2], to: [0.85, 1.5, 1.75], target: [-2.2, 1.85, -20], fov: [24, 21], focus: [-0.45, 1.5, -29.5], aperture: 3 },
  },
  {
    white: 0.76,
    develop: 0.72,
    window: { light: 0.42, kind: 'lamp', seated: 1 },
    people: [
      { who: 'mother', at: [-1.05, -15] },
      { who: 'father', at: [1.1, -14.4] },
    ],
    shot: { from: [0.1, 1.72, 9.6], to: [0.08, 1.72, 9.2], target: [0.05, 2.05, -20], targetTo: [0.05, 2.1, -20], fov: [11, 10], focus: 'head', aperture: 3 },
  },
  {
    white: 0.88,
    develop: 0.86,
    window: { light: 0.55, kind: 'tv', seated: 0 },
    people: [
      { who: 'mother', at: [-0.95, 3.4] },
      { who: 'father', at: [0.65, 3] },
      { who: 'little', at: [-0.45, 2.4] },
    ],
    shot: { from: [0.24, 1.84, 0.85], to: [0.12, 1.7, 6.1], target: [0, 1.95, -20], fov: [30, 34], focus: 'head', aperture: 6 },
  },
  {
    white: 1,
    develop: 1,
    window: { light: 0, kind: 'dark', seated: 0 },
    shot: { from: [-0.014, 0.44, 20], to: [-0.014, 0.46, 19.6], target: 'window', fov: [7, 6.8], focus: 'head', aperture: 4 },
  },
];

/** The window after the seventh evening, in the ending: nothing is lit. */
export const LAST_WINDOW: HomeWindow = { light: 0, kind: 'dark', seated: 0 };
