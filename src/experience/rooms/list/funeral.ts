import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Vector3,
  type Material,
  type SkinnedMesh,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { Crowd, HeroFigure } from '../../dream/FigureKit';
import type { DreamLight } from '../../dream/LightPool';
import { DEG, lerp, range, smootherstep, wobble } from '../../math';
import { dateNow } from '../FourthWall';
import type { RoomAir, RoomAssets, RoomContext, RoomControl, RoomFrame, RoomKey, RoomPose } from '../Room';
import { Room } from '../Room';
import { PALETTE } from '../RoomKit';
import type { RoomVoice, RoomVoiceOptions } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['coffin', 'coffin_lid', 'easel', 'roses', 'urn', 'chair_white', 'window_wood', 'pillow'],
  materials: ['plaster_pale', 'wood_floor_dark', 'wood_raw_boards', 'wood_dark_paint', 'linen_white'],
  sounds: [
    'rooms/hall_silence.mp3',
    'rooms/hall_vast.mp3',
    'rooms/rain_roof.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/dream_drone_glass.mp3',
    'rooms/breath_calm.mp3',
    'rooms/cough_far_1.mp3',
    'rooms/cough_far_3.mp3',
    'rooms/seat_creak_2.mp3',
    'rooms/seat_creak_4.mp3',
    'rooms/chair_wood_move.mp3',
    'rooms/wood_creak_small_2.mp3',
    'rooms/wood_creak_small_4.mp3',
    'rooms/nails_tin.mp3',
    'rooms/nails_tin_box.mp3',
    'rooms/nails_coffin.mp3',
    'rooms/crowd_rise.mp3',
    'rooms/sheet_over_face.mp3',
    'rooms/mourners_lean.mp3',
    'rooms/coat_move.mp3',
    'rooms/lid_slide.mp3',
    'rooms/lid_slide_short.mp3',
    'rooms/lid_shut.mp3',
  ],
};

/** The hall (m): width, height, near and far wall, height of the panelling and of the rail above the wallpaper. */
const W = 8.6;
const H = 5.6;
const Z_NEAR = 1.4;
const Z_FAR = -18;
const WAINSCOT = 1.25;
const DADO = 3;
/** Length of a bay of the roof (m); the windows' sills (m). */
const BAY = 4.6;
const WINDOW_SILL = 3.55;
/** Where the box stands, the top of its trestles, and its stretch to room size (the model is a little small to lie in). */
const COFFIN_Z = -14.5;
const TRESTLE_TOP = 0.42;
const COFFIN_SCALE = [1.05, 1.55, 1.08] as const;
const RIM_Y = TRESTLE_TOP + 0.412 * COFFIN_SCALE[1];
/** Walking up to it, it is only this high (its scale in y): a box seen from a coffin is deeper than the same box seen from outside. */
const WALK_DEPTH = 1.15;
/** The model's rim at scale 1 (m): half width at the head, the shoulders and the foot, and the shoulders' place; its head lies toward the door. */
const HEAD_HALF = 0.12;
const SHOULDER_HALF = 0.36;
const FOOT_HALF = 0.17;
const SHOULDER_Z = 0.54;
const END_Z = 1.05;
const OUTLINE = [
  [HEAD_HALF, END_Z],
  [-HEAD_HALF, END_Z],
  [-SHOULDER_HALF, SHOULDER_Z],
  [-FOOT_HALF, -END_Z],
  [FOOT_HALF, -END_Z],
  [SHOULDER_HALF, SHOULDER_Z],
] as const;
/** Height of the old man's spine; of the mattress and of the top of his face (m). */
const BODY_Y = 0.67;
const MATTRESS_Y = 0.555;
const FACE_Y = 0.805;
/** Standing body's hips (m), and where its feet lie along the box (from its center). */
const HIPS = 0.95;
const FEET = 0.98;
/** The eye that lies in the box. */
const EYE = [0, 0.77, COFFIN_Z + 0.68] as const;
/** The opening of light in the roof: its center is just where a head lying still looks. Half sizes (m). */
const OVAL_Z = EYE[2] - 0.41;
const OVAL_X = 1.2;
const OVAL_L = 1.45;
/** The opening is cut square, so that a head over it never leaves a sliver shaped like a moon: how much of the half sizes it takes (about the oval's light), and its moulding's width and depth (m). */
const SKYLIGHT_FILL = 0.88;
const MOULDING_W = 0.13;
const MOULDING_D = 0.12;

/** Seconds: the line, the box seen open, the eye held still, the shutter, the print turning, the blink. */
const LINE_AT = 3;
const OPEN_AT = 16;
const HELD_AT = 24.4;
const SHUTTER_AT = 26;
const TURN_FROM = 27.05;
const TURN_TO = 27.9;
const BLINK_AT = 28.02;
const CUT_AT = 28.1;
const OPEN_FROM = 28.7;
const OPEN_TO = 29.5;
const FLUTTER = [30.2, 30.75] as const;
/** Seconds: the last head comes over, the eye rolls back, the photograph develops, "Today", the lid, its stop, its end. */
const ROLL_AT = 39.25;
const ROLLED_AT = 41.8;
const DEVELOP = [39.7, 42.8] as const;
const TODAY_AT = 42;
const LID_AT = 46;
const LID_STOP = 49.9;
const LID_ON = 52;
const LID_SHUT = 53.35;

/** The line of mourners on each side: how many, first z, step (m), half width of the aisle at the door and at the box (m). */
const LINE_EACH = 10;
const LINE_FROM = -2.7;
const LINE_STEP = 1.02;
const AISLE = [1.62, 1.16] as const;
/** Those you have passed stand this much nearer the middle (share of x), and turn when no one is looking. */
const PULLED_IN = 0.34;
const BEHIND = 1.4;
/** The color of the coats. */
const COAT = 0x54585a;
/** The sacks' cloth, in the hall and seen from the box. */
const SACK_HALL = 0xa6a69e;
const SACK_NEAR = 0x5f5f59;
/** Bowed poses of the idle clip: its time (s), and the head's up and face directions in it (measured from the clip). */
const BOWS = [
  { time: 3.07, up: [0.04, 0.73, 0.68], face: [-0.25, -0.65, 0.72] },
  { time: 3.33, up: [0.17, 0.65, 0.74], face: [-0.05, -0.74, 0.67] },
  { time: 3.58, up: [0.32, 0.64, 0.7], face: [0.06, -0.75, 0.66] },
  { time: 2.82, up: [-0.07, 0.8, 0.6], face: [-0.46, -0.56, 0.69] },
] as const;
const RING_BOW = { time: 3.45, up: [0.23, 0.64, 0.73], face: [0.01, -0.75, 0.66] } as const;
/** The sack: the hole in its map (center v, half sizes in u and v), how far the cloth sinks in there (m). */
const HOLE_V = 0.63;
const HOLE_U = 0.07;
const HOLE_DV = 0.185;
const HOLE_SINK = 0.012;
/** Those round the box are a little too big once you lie down (scale), stoop this much at rest (deg), and bend their knees as they lean (m at 50 deg). */
const RING_SCALE = 1.15;
const RING_STOOP = 4;
const RING_DIP = 0.17;
/** At the flash those who are there stand this much further down the box (m), and where a head lying still looks, near by, is this far along it. */
const FLASH_BACK = 0.34;
const NEAR_AIM = -0.07;
/** How long a lean takes (s). */
const LEAN_TIME = 2.4;
const PART_FROM = 39.4;
const PART_TO = 41.4;
/**
 * x (m), z from the eye (m, + toward the crown), second it leans, how far (deg); `more`/`moreAt` a second lean; `part` where it
 * stands back to. `late` ones are not there at the flash: they would stand against the eye; `leaves` is gone when you roll your eyes back.
 */
const RING = [
  { x: -0.7, z: -0.1, at: 32.6, lean: 31, more: 52, moreAt: 37.6 },
  { x: 0.7, z: 0.49, at: 33.6, lean: 46, more: 50, moreAt: 38, late: true, leaves: true },
  { x: -0.7, z: -0.66, at: 34.5, lean: 46, more: 52, moreAt: 37.8 },
  { x: 0.7, z: -0.13, at: 35.4, lean: 33, more: 40, moreAt: 38.2 },
  { x: -0.7, z: 0.51, at: 36.2, lean: 46, more: 50, moreAt: 38.3, part: 7, late: true },
  { x: 0.7, z: -0.68, at: 37, lean: 46, more: 52, moreAt: 38.1 },
  { x: -0.6, z: -2.3, at: 99, lean: 4 },
  { x: 0.02, z: -2.36, at: 99, lean: 4 },
  { x: 0.62, z: -2.3, at: 99, lean: 4 },
] as const;

/** Light: the column from the oval, the fill under the windows, the flash gun, the eye's fill and the roof's wash. */
const KEY_POWER = 78;
const KEY_UNDER = 26;
const SIDE_POWER = 15;
const HALL_FILL = 6.8;
const FLASH_POWER = 3.6;
const FLASH_FADE = 0.2;
const EYE_FILL = 0.42;
const ROOF_WASH = 1.5;
const LAMP = 3.2;
const FEET_FILL = 1.3;
const COLD = 0xc6d2d2;
/** The sky in a window and in the oval, as a multiple of its painted grey. */
const WINDOW_SKY = 0.42;
const OVAL_SKY = 0.86;
/** How fast the hair outside falls (image heights a second), and the strands that come in through the roof (m/s). */
const RAIN_SLOW = 0.052;
const RAIN_FAST = 0.083;
const FALL = 0.2;
/** Height of the pillow under the hair (m). */
const PILLOW_TOP = 0.682;
/** Brightness of the old man's suit and of his hands (multiplies their image). */
const SUIT = 0.14;
const HAND = 0.92;
/** Strands combed over the pillow. */
const COMBED = 1050;
/** They lie round the head on the pillow, most to the sides and short at the crown, so that seen from the head of the box nothing hangs below the face like a beard: their reach past the scalp (m), the share of it left at the crown, how far round toward the sides they are laid, how strongly they part into bands. */
const HAIR_LAY = 0.15;
const HAIR_CROWN = 0.35;
const HAIR_SWEEP = 1.2;
const HAIR_BANDS = 0.12;
/** How dark the hollow where the face is: a little light is left on it. */
const FACE_SHADE = 0.55;
/** The print on the face: its width (m). */
const PRINT_W = 0.235;
/** The photograph on the easel: width, height (m), elevation seen from the eye (deg), distance (m), offset to the side (m). */
const PHOTO_W = 1.02;
const PHOTO_H = 1.36;
const PHOTO_ELEVATION = 58;
const PHOTO_DISTANCE = 2.1;
const PHOTO_SIDE = 0.52;
const PHOTO_GLOW = 0.86;
/** The plank that comes across (m): width, length, and the center's place out of sight. */
const LID_W = 1;
const LID_L = 2.9;
const LID_OUT = -0.86;
const LID_HALF = -LID_W / 2;
/** Its leading edge, lit by what light is left. */
const LID_EDGE = 0.12;

const WALKING: RoomControl = { look: true, scroll: true, hurry: 2 };
const STILL: RoomControl = { look: false, scroll: true, hurry: 1.4 };
const HELD: RoomControl = { look: false, scroll: false, hurry: 1 };

const UP = new Vector3(0, 1, 0);
const XAXIS = new Vector3(1, 0, 0);
const POSE: RoomPose = { position: new Vector3(), yaw: 0, pitch: 0, roll: 0, fov: 0 };
const M1 = new Matrix4();
const M2 = new Matrix4();
const V1 = new Vector3();
const V2 = new Vector3();
const Q1 = new Quaternion();
const Q2 = new Quaternion();

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function painted(w: number, h: number, paint: (c: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  paint(canvas.getContext('2d')!);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function blotches(c: CanvasRenderingContext2D, r: () => number, count: number, w: number, h: number, rgb: string, strength: number, size: readonly [number, number]): void {
  for (let i = 0; i < count; i++) {
    const x = r() * w;
    const y = r() * h;
    const radius = size[0] + r() * (size[1] - size[0]);
    const g = c.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, `rgba(${rgb},${strength * (0.4 + r() * 0.6)})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g;
    c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
}

/** Fine white hair falling on a tile of sky (4 m tall): the tile repeats, so the strands are drawn across its edge too. */
function hairRain(seed: number, strands: number, sky: string | null): CanvasTexture {
  return painted(512, 1024, (c) => {
    const r = seeded(seed);
    if (sky) {
      c.fillStyle = sky;
      c.fillRect(0, 0, 512, 1024);
      blotches(c, r, 26, 512, 1024, '235,240,238', 0.22, [60, 220]);
      blotches(c, r, 14, 512, 1024, '70,80,82', 0.16, [50, 180]);
    }
    c.lineCap = 'round';
    for (let i = 0; i < strands; i++) {
      const x = r() * 512;
      const y = r() * 1024;
      const length = 220 + r() * 560;
      const bend = (r() - 0.5) * 54;
      const lean = (r() - 0.5) * 26;
      c.strokeStyle = `rgba(245,243,233,${0.1 + r() * 0.6})`;
      c.lineWidth = 0.5 + r() * 1;
      for (const shift of [-1024, 0, 1024]) {
        c.beginPath();
        c.moveTo(x, y + shift);
        c.quadraticCurveTo(x + bend, y + shift + length * 0.5, x + lean, y + shift + length);
        c.stroke();
      }
    }
  });
}

/** One bay of a side wall above the rail: dark runs below the sill, damp in the corners. */
function bayGrime(seed: number): CanvasTexture {
  return painted(1024, 512, (c) => {
    const r = seeded(seed);
    const fall = c.createLinearGradient(0, 0, 0, 512);
    fall.addColorStop(0, 'rgba(4,6,6,0.66)');
    fall.addColorStop(0.3, 'rgba(4,6,6,0.14)');
    fall.addColorStop(0.72, 'rgba(4,6,6,0.1)');
    fall.addColorStop(1, 'rgba(4,6,6,0.56)');
    c.fillStyle = fall;
    c.fillRect(0, 0, 1024, 512);
    const sill = 512 * (1 - (WINDOW_SILL - DADO) / (H - DADO));
    for (let i = 0; i < 110; i++) {
      const x = 512 + (r() - 0.5) * 470;
      const width = 1 + r() * r() * 13;
      const length = 40 + r() * 180;
      const y = sill - 8 + r() * 10;
      const run = c.createLinearGradient(0, y, 0, y + length);
      run.addColorStop(0, `rgba(6,8,7,${0.12 + r() * 0.42})`);
      run.addColorStop(1, 'rgba(6,8,7,0)');
      c.fillStyle = run;
      c.fillRect(x, y, width, length);
    }
    blotches(c, r, 34, 1024, 512, '8,10,8', 0.24, [30, 130]);
  });
}

/** The roof: old rings of damp. */
function roofGrime(seed: number): CanvasTexture {
  return painted(1024, 1024, (c) => {
    const r = seeded(seed);
    blotches(c, r, 40, 1024, 1024, '10,11,9', 0.3, [60, 240]);
    for (let i = 0; i < 16; i++) {
      c.strokeStyle = `rgba(52,42,28,${0.1 + r() * 0.22})`;
      c.lineWidth = 2 + r() * 7;
      c.beginPath();
      c.ellipse(r() * 1024, r() * 1024, 40 + r() * 170, 30 + r() * 120, r() * 3, 0, Math.PI * 2);
      c.stroke();
    }
  });
}

/** The end wall: a paler oblong where something large was taken down, and rising damp. */
function endGrime(seed: number): CanvasTexture {
  return painted(1024, 672, (c) => {
    const r = seeded(seed);
    blotches(c, r, 26, 1024, 672, '6,8,8', 0.3, [60, 220]);
    c.fillStyle = 'rgba(170,186,180,0.04)';
    c.fillRect(372, 110, 280, 214);
    c.strokeStyle = 'rgba(0,0,0,0.42)';
    c.lineWidth = 4;
    c.strokeRect(372, 110, 280, 214);
    const damp = c.createLinearGradient(0, 480, 0, 672);
    damp.addColorStop(0, 'rgba(5,6,6,0)');
    damp.addColorStop(1, 'rgba(5,6,6,0.6)');
    c.fillStyle = damp;
    c.fillRect(0, 480, 1024, 192);
  });
}

function softDisc(rgb: string, edge: number): CanvasTexture {
  return painted(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, `rgba(${rgb},1)`);
    g.addColorStop(edge, `rgba(${rgb},0.9)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
}

/** Paper that holds nothing: the print of someone the album has not met. */
function darkPaper(): Texture {
  return painted(64, 64, (c) => {
    const r = seeded(5);
    c.fillStyle = '#0d0c0b';
    c.fillRect(0, 0, 64, 64);
    blotches(c, r, 10, 64, 64, '42,38,34', 0.5, [8, 26]);
  });
}

/** Long glow along the waxed boards: what the column of light does on the floor. */
function floorShine(): CanvasTexture {
  return painted(128, 1024, (c) => {
    const along = c.createLinearGradient(0, 0, 0, 1024);
    along.addColorStop(0, 'rgba(255,255,255,0.95)');
    along.addColorStop(0.3, 'rgba(255,255,255,0.46)');
    along.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = along;
    c.fillRect(0, 0, 128, 1024);
    c.globalCompositeOperation = 'destination-in';
    const across = c.createLinearGradient(0, 0, 128, 0);
    across.addColorStop(0, 'rgba(0,0,0,0)');
    across.addColorStop(0.5, 'rgba(0,0,0,1)');
    across.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = across;
    c.fillRect(0, 0, 128, 1024);
  });
}

/** What the mourners have been keeping from you: a photograph of a stone, today's date cut in it, and a dash nobody has finished. */
function paintStone(c: CanvasRenderingContext2D, w: number, h: number, date: string): void {
  const r = seeded(4407);
  c.fillStyle = '#4a463c';
  c.fillRect(0, 0, w, h);
  const mx = w * 0.07;
  const my = h * 0.055;
  const pw = w - mx * 2;
  const ph = h - my * 2;
  c.save();
  c.beginPath();
  c.rect(mx, my, pw, ph);
  c.clip();
  const sky = c.createLinearGradient(0, my, 0, my + ph * 0.62);
  sky.addColorStop(0, '#3d4242');
  sky.addColorStop(0.7, '#7f8583');
  sky.addColorStop(1, '#9ca19b');
  c.fillStyle = sky;
  c.fillRect(mx, my, pw, ph);
  blotches(c, r, 30, w, h * 0.6, '200,205,200', 0.1, [60, 200]);
  c.fillStyle = '#141816';
  for (let i = 0; i < 300; i++) {
    c.beginPath();
    c.arc(mx + r() * pw, my + ph * (0.57 + r() * 0.06), (6 + r() * 26) * (w / 800), 0, Math.PI * 2);
    c.fill();
  }
  const ground = c.createLinearGradient(0, my + ph * 0.62, 0, my + ph);
  ground.addColorStop(0, '#2a2f26');
  ground.addColorStop(1, '#0f120d');
  c.fillStyle = ground;
  c.fillRect(mx, my + ph * 0.62, pw, ph * 0.38);
  for (let i = 0; i < 2600; i++) {
    const x = mx + r() * pw;
    const y = my + ph * (0.64 + r() * 0.36);
    c.strokeStyle = r() < 0.5 ? 'rgba(10,12,9,0.5)' : 'rgba(120,128,104,0.16)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + (r() - 0.5) * 7, y - 6 - r() * 16);
    c.stroke();
  }

  // the stone: wide and plain
  const sw = pw * 0.84;
  const sx = mx + (pw - sw) / 2;
  const top = my + ph * 0.2;
  const bottom = my + ph * 0.88;
  const radius = sw * 0.09;
  const slab = () => {
    c.beginPath();
    c.moveTo(sx, bottom);
    c.lineTo(sx, top + radius);
    c.quadraticCurveTo(sx, top, sx + radius, top);
    c.lineTo(sx + sw - radius, top);
    c.quadraticCurveTo(sx + sw, top, sx + sw, top + radius);
    c.lineTo(sx + sw, bottom);
    c.closePath();
  };
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.75)';
  c.shadowBlur = 30;
  c.shadowOffsetX = 10;
  c.fillStyle = '#7e7e77';
  slab();
  c.fill();
  c.restore();
  c.save();
  slab();
  c.clip();
  const face = c.createLinearGradient(sx, top, sx + sw, bottom);
  face.addColorStop(0, '#8e8d85');
  face.addColorStop(1, '#55554e');
  c.fillStyle = face;
  c.fillRect(sx, top, sw, bottom - top);
  for (let i = 0; i < 16000; i++) {
    c.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.16)';
    c.fillRect(sx + r() * sw, top + r() * (bottom - top), 1 + r() * 3, 1 + r() * 3);
  }
  // old cracks, and the lichen that likes them
  c.strokeStyle = 'rgba(14,14,12,0.6)';
  for (let i = 0; i < 7; i++) {
    let px = sx + r() * sw;
    let py = top + r() * (bottom - top);
    c.lineWidth = 1 + r() * 2;
    c.beginPath();
    c.moveTo(px, py);
    for (let k = 0; k < 9; k++) {
      px += (r() - 0.5) * 40;
      py += r() * 30;
      c.lineTo(px, py);
    }
    c.stroke();
  }
  blotches(c, r, 26, w, h, '60,62,48', 0.2, [20, 90]);
  blotches(c, r, 12, w, h, '188,184,150', 0.14, [16, 60]);
  c.restore();

  // cut with a chisel: a dark floor, a shadow under the upper lip, a light on the lower one
  const size = Math.round(sw * 0.158);
  c.font = `bold ${size}px Georgia, "Times New Roman", serif`;
  c.textBaseline = 'alphabetic';
  const width = c.measureText(date).width;
  const dash = size * 0.86;
  const gap = size * 0.24;
  const x = sx + (sw - width - gap - dash) / 2;
  const y = top + (bottom - top) * 0.47;
  const dashY = y - size * 0.31;
  const cut = (dx: number, dy: number, fill: string) => {
    c.fillStyle = fill;
    c.fillText(date, x + dx, y + dy);
    c.fillRect(x + width + gap + dx, dashY + dy, dash * 0.58, size * 0.08);
  };
  cut(2.4, 3, 'rgba(232,230,220,0.72)');
  cut(-1.6, -2, 'rgba(6,6,5,0.9)');
  cut(0, 0, '#1a1b18');
  // the rest of the dash: only marked out, and the chisel stopped
  c.strokeStyle = 'rgba(20,20,18,0.6)';
  c.lineWidth = 1.2;
  const from = x + width + gap + dash * 0.58;
  for (let i = 0; i < 3; i++) {
    c.beginPath();
    c.moveTo(from - 2, dashY + size * (0.012 + i * 0.03));
    c.lineTo(from + dash * (0.2 + r() * 0.22), dashY + size * (0.012 + i * 0.03) + (r() - 0.5) * 2);
    c.stroke();
  }
  for (let i = 0; i < 12; i++) {
    c.fillStyle = 'rgba(232,230,220,0.5)';
    c.fillRect(from + r() * dash * 0.16, dashY - 3 + r() * size * 0.12, 1 + r() * 2.6, 1 + r() * 2);
  }
  c.restore();

  // the film
  const vignette = c.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.68);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.42)');
  c.fillStyle = vignette;
  c.fillRect(mx, my, pw, ph);
  for (let i = 0; i < 9000; i++) {
    c.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.08)';
    c.fillRect(mx + r() * pw, my + r() * ph, 1.5, 1.5);
  }
}

const worldOf = (o: Object3D): Vector3 => o.getWorldPosition(new Vector3());

/** Turn a bone so that the world direction `from` comes to lie along `to`. */
function turnBone(bone: Object3D, from: Vector3, to: Vector3): void {
  applyTurn(bone, new Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize()));
}

function applyTurn(bone: Object3D, turn: Quaternion): void {
  const own = bone.getWorldQuaternion(new Quaternion());
  const parent = bone.parent!.getWorldQuaternion(new Quaternion());
  bone.quaternion.copy(parent.invert().multiply(turn).multiply(own));
  bone.updateWorldMatrix(false, true);
}

/** Bring a wrist to a point by turning shoulder and elbow; the elbow goes the way of `pole`. */
function reach(body: HeroFigure, side: 'L' | 'R', target: Vector3, pole: Vector3): void {
  const upper = body.bone(`Bip01_${side}_UpperArm`)!;
  const fore = body.bone(`Bip01_${side}_Forearm`)!;
  const hand = body.bone(`Bip01_${side}_Hand`)!;
  const a = worldOf(upper);
  const b = worldOf(fore);
  const la = a.distanceTo(b);
  const lb = b.distanceTo(worldOf(hand));
  const toward = target.clone().sub(a);
  const d = Math.min(toward.length(), la + lb - 0.005);
  toward.normalize();
  const along = (la * la - lb * lb + d * d) / (2 * d);
  const bend = pole.clone().sub(a);
  bend.addScaledVector(toward, -bend.dot(toward)).normalize();
  const elbow = a.clone().addScaledVector(toward, along).addScaledVector(bend, Math.sqrt(Math.max(0, la * la - along * along)));
  turnBone(upper, b.clone().sub(a), elbow.sub(a));
  const b2 = worldOf(fore);
  turnBone(fore, worldOf(hand).sub(b2), target.clone().sub(b2));
}

/** Lay a hand down: its fingers along `fingers`, its palm toward `palm`. */
function layHand(body: HeroFigure, side: 'L' | 'R', fingers: Vector3, palm: Vector3): void {
  const hand = body.bone(`Bip01_${side}_Hand`)!;
  const at = worldOf(hand);
  const f = worldOf(body.bone(`Bip01_${side}_Finger2`)!).sub(at).normalize();
  const t = worldOf(body.bone(`Bip01_${side}_Finger0`)!).sub(at);
  t.addScaledVector(f, -t.dot(f)).normalize();
  const n = new Vector3().crossVectors(f, t).multiplyScalar(side === 'L' ? 1 : -1);
  const wantF = fingers.clone().normalize();
  const wantN = palm.clone().addScaledVector(wantF, -palm.dot(wantF)).normalize();
  const from = new Matrix4().makeBasis(f, n, new Vector3().crossVectors(f, n));
  const to = new Matrix4().makeBasis(wantF, wantN, new Vector3().crossVectors(wantF, wantN));
  applyTurn(hand, new Quaternion().setFromRotationMatrix(to.multiply(from.transpose())));
}

/** Half the inner width of the box at a place along it (z from its center), from its real outline. */
function innerHalf(z: number): number {
  const zs = z / COFFIN_SCALE[2];
  const half = zs > SHOULDER_Z ? lerp(SHOULDER_HALF, HEAD_HALF, (zs - SHOULDER_Z) / (END_Z - SHOULDER_Z)) : lerp(FOOT_HALF, SHOULDER_HALF, (zs + END_Z) / (END_Z + SHOULDER_Z));
  return half * COFFIN_SCALE[0] - 0.03;
}

/** Burlap, dirtier toward the neck, a seam down the back and a hole cut in the front with big stitches round it. */
function burlap(): CanvasTexture {
  return painted(512, 512, (c) => {
    const r = seeded(2203);
    c.fillStyle = '#b6b4aa';
    c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 512; i += 2) {
      c.fillStyle = `rgba(${r() < 0.5 ? '52,50,44' : '232,230,220'},${0.05 + r() * 0.14})`;
      c.fillRect(0, i, 512, 1);
      c.fillStyle = `rgba(${r() < 0.5 ? '52,50,44' : '232,230,220'},${0.05 + r() * 0.14})`;
      c.fillRect(i, 0, 1, 512);
    }
    blotches(c, r, 44, 512, 512, '44,42,36', 0.36, [10, 80]);
    const neck = c.createLinearGradient(0, 440, 0, 512);
    neck.addColorStop(0, 'rgba(20,16,12,0)');
    neck.addColorStop(1, 'rgba(10,8,6,0.95)');
    c.fillStyle = neck;
    c.fillRect(0, 440, 512, 72);
    c.strokeStyle = 'rgba(30,24,16,0.7)';
    c.lineWidth = 3;
    for (const x of [0, 512]) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, 512);
      c.stroke();
    }
    const cx = 256;
    const cy = (1 - HOLE_V) * 512;
    const rx = HOLE_U * 512;
    const ry = HOLE_DV * 512;
    const stain = c.createRadialGradient(cx, cy, Math.min(rx, ry), cx, cy, ry * 1.34);
    stain.addColorStop(0, 'rgba(26,18,12,0.5)');
    stain.addColorStop(1, 'rgba(26,18,12,0)');
    c.fillStyle = stain;
    c.fillRect(0, 0, 512, 512);
    // cut by hand: the edge is not an ellipse
    c.fillStyle = '#010101';
    c.beginPath();
    for (let a = 0; a <= 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      const j = 1 + (r() - 0.5) * 0.045;
      c.lineTo(cx + Math.cos(t) * rx * j, cy + Math.sin(t) * ry * j);
    }
    c.closePath();
    c.fill();
    c.lineCap = 'round';
    // the cloth pulled tight round the cut: creases that run away from it, and a seam up over the skull
    for (let t = 0.1; t < Math.PI * 2; t += 0.34) {
      const x = cx + Math.cos(t) * rx * 1.12;
      const y = cy + Math.sin(t) * ry * 1.1;
      c.strokeStyle = 'rgba(10,8,6,0.9)';
      c.lineWidth = 2.4;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(t + 0.7) * 11, y + Math.sin(t + 0.7) * 11);
      c.stroke();
    }
    for (let i = 0; i < 40; i++) {
      const t = (i / 40) * Math.PI * 2 + r() * 0.12;
      const x = cx + Math.cos(t) * rx * 1.14;
      const y = cy + Math.sin(t) * ry * 1.12;
      const reach = 22 + r() * r() * 96;
      c.strokeStyle = `rgba(20,17,12,${0.3 + r() * 0.42})`;
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(t) * reach, y + Math.sin(t) * reach);
      c.stroke();
      c.strokeStyle = 'rgba(246,238,216,0.2)';
      c.beginPath();
      c.moveTo(x + 1.6, y + 1.2);
      c.lineTo(x + Math.cos(t) * reach + 1.6, y + Math.sin(t) * reach + 1.2);
      c.stroke();
    }
  });
}

/** A sack over a head, gathered into the collar: in its own frame +Y runs up the head, +Z the way the face looks, its origin at the middle of the head. */
function sackGeometry(seed: number): BufferGeometry {
  const r = seeded(seed);
  const cols = 36;
  const rows = 22;
  const a1 = r() * 6.28;
  const a2 = r() * 6.28;
  const a3 = r() * 6.28;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const th = (u - 0.5) * Math.PI * 2;
      // up the neck, then round the skull; at the top it flattens to a seam across
      const t = range(0.18, 1, v);
      const y = v < 0.18 ? lerp(-0.215, -0.14, v / 0.18) : lerp(-0.14, 0.17, t);
      const swell = v < 0.18 ? lerp(0.078, 0.066, v / 0.18) : lerp(0.066, 0.098, smootherstep(t / 0.5));
      const dome = t > 0.6 ? Math.sqrt(Math.max(0, 1 - ((t - 0.6) / 0.4) ** 2)) : 1;
      const lump = 1 + 0.035 * Math.sin(th * 2 + a1) * Math.sin(v * 5 + a2) + 0.025 * Math.sin(th * 3 + v * 7 + a3);
      const gather = (1 - smootherstep(t / 0.5)) * (Math.sin(th * 11 + a1) * 0.005 + Math.sin(th * 17 + a2) * 0.002);
      const hole = (th / (HOLE_U * Math.PI * 2)) ** 2 + ((v - HOLE_V) / HOLE_DV) ** 2;
      const sink = hole < 1 ? HOLE_SINK * Math.sqrt(1 - hole) : 0;
      const crease = v > 0.18 ? Math.sin(th * 5 + v * 3 + a2) * 0.0035 + Math.sin(v * 15 + th * 1.7 + a3) * 0.0042 + Math.sin(v * 27 - th * 3 + a1) * 0.0016 : 0;
      const radius = swell * dome * lump + gather + crease - sink;
      const flatten = smootherstep(range(0.62, 1, t));
      positions.push(Math.sin(th) * radius * (1 + flatten * 0.04), y, Math.cos(th) * radius * (1 - flatten * 0.12));
      uvs.push(u, v);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + cols + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return g;
}

interface Mourner {
  crowd: number;
  index: number;
  x: number;
  z: number;
  heading: number;
  scale: number;
  turned: boolean;
}

interface Leaner {
  x: number;
  z: number;
  heading: number;
  at: number;
  lean: number;
  more: number;
  moreAt: number;
  part: number;
  late: boolean;
  leaves: boolean;
}

/**
 * The funeral. A long plain hall in grey light, its people along both sides with their sacks bowed; at the far
 * end, under an oval in the roof, a box on trestles. Over it you find an old man with a print where his face
 * should be, and when the print turns over you are lying in it, and they come over the edge one by one until
 * they have closed the light. On the easel, upside down: today's date, cut in a stone. Then the lid, as far as half.
 */
export default class Funeral extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x0b1011, density: 0.032 },
    env: 'bathroom',
    envIntensity: 0.15,
    sky: 0,
    grade: { exposure: 1.28, saturation: 0.6, warmth: -0.015, tint: -0.02, flare: 0.002 },
  };
  film = { bloom: 0.9, bloomFrom: 0.62, grain: 0.42, scratches: 0.12, flicker: 0.02, weave: 0.0004 };
  focus = 14;
  aperture = 3.6;
  control: RoomControl = WALKING;

  private readonly clocks: { value: number }[] = [];
  private readonly ownMaterials: Material[] = [];
  private readonly beds = new Map<string, RoomVoice>();
  private readonly people = new Group();
  private readonly crowds: Crowd[] = [];
  private readonly dirty: boolean[] = [];
  private readonly mourners: Mourner[] = [];
  private readonly leaners: Leaner[] = [];
  private readonly head: Mesh[] = [];
  private readonly falling: Mesh[] = [];
  private readonly ovalParts: Mesh[] = [];
  private readonly ownGeometries: BufferGeometry[] = [];
  private burlapMaterial!: MeshStandardMaterial;
  private shadows!: InstancedMesh;
  private ring!: Crowd;
  private ringShadows!: InstancedMesh;
  private ringDone = false;
  private rainBack!: Texture;
  private rainFront!: Texture;
  private hallFill: DreamLight[] = [];
  private flash!: DreamLight;
  private eyeFill!: DreamLight;
  private roofWash!: DreamLight;
  private feetFill!: DreamLight;
  private photoFill!: DreamLight;
  private readonly keySpot;
  private readonly sideA;
  private readonly sideB;
  private printHinge!: Group;
  private faceHole!: Mesh;
  private easelBack!: Object3D;
  private photograph!: Group;
  private photoMaterial!: MeshStandardMaterial;
  private lid!: Group;
  private leaning!: Object3D;
  private lamp!: DreamLight;
  private coffin!: Object3D;
  private liningMesh!: Mesh;
  private column!: Mesh;
  private haze!: Mesh;
  private halo!: Mesh;

  constructor(ctx: RoomContext) {
    super(ctx);
    const S = this.seconds;
    const eye = EYE as unknown as [number, number, number];
    const near = REDUCED_MOTION;
    this.keys = [
      { t: 0, at: [0, 1.56, -0.2], yaw: 0, pitch: -2, fov: near ? 44 : 31 },
      { t: 9 / S, at: [0.05, 1.58, -4.6], yaw: -0.5, pitch: -2, fov: near ? 44 : 36 },
      { t: OPEN_AT / S, at: [-0.03, 1.8, -9.3], yaw: 0.4, pitch: -7, fov: 44 },
      { t: 22 / S, at: [0, 2.02, COFFIN_Z + 2.25], yaw: 0, pitch: -33, fov: 54 },
      { t: SHUTTER_AT / S, at: [0, 2.02, COFFIN_Z + 1.86], yaw: 0, pitch: -34, fov: 62 },
      { t: TURN_FROM / S, at: [0, 2, COFFIN_Z + 1.82], yaw: 0, pitch: -36, fov: 60 },
      { t: BLINK_AT / S, at: near ? [0, 2, COFFIN_Z + 1.82] : [0, 1.02, EYE[2] + 0.02], yaw: 0, pitch: near ? -36 : -85, fov: near ? 60 : 40 },
      { t: CUT_AT / S, at: eye, yaw: 0, pitch: 26, roll: near ? 0 : 10, fov: 70 },
      { t: 30.8 / S, at: eye, yaw: 0, pitch: 31, roll: near ? 0 : 4, fov: 70 },
      { t: 33 / S, at: eye, yaw: 0, pitch: 85, roll: near ? 0 : 2, fov: 66 },
      { t: ROLL_AT / S, at: eye, yaw: 0, pitch: 85, roll: 0, fov: 62 },
      { t: (ROLL_AT + 0.01) / S, at: eye, yaw: 180, pitch: 85, roll: 180, fov: 62 },
      { t: ROLLED_AT / S, at: eye, yaw: 180, pitch: PHOTO_ELEVATION, roll: 180, fov: 58 },
      { t: 1, at: eye, yaw: 180, pitch: PHOTO_ELEVATION, roll: 180, fov: 55 },
    ];
    this.keySpot = this.spot([-0.7, H - 0.1, OVAL_Z + 0.3], [0, 0.85, EYE[2] - 0.5], COLD, KEY_POWER, 19, 0.75);
    this.sideA = this.spot([-W / 2 + 0.5, 4.5, -5.4], [1.5, 1.1, -7.6], 0xaebcbd, SIDE_POWER, 26, 0.9);
    this.sideB = this.spot([W / 2 - 0.5, 4.5, -9.9], [-1.3, 1.1, -11.8], 0xaebcbd, SIDE_POWER, 26, 0.9);
    this.spots = [this.keySpot, this.sideA, this.sideB];

    this.buildHall();
    this.buildWindows();
    this.buildBox();
    this.buildPeople();
    this.buildRing();
    this.buildFlowers();
    this.buildPhotograph();
    this.buildLid();
    this.buildAir();
    this.score();
  }

  /** The body of the hall: panelled, papered, plastered, timbered; old water has been running down all of it. */
  private buildHall(): void {
    const b = this.build;
    const k = this.kit;
    const L = Z_NEAR - Z_FAR;
    const mid = (Z_NEAR + Z_FAR) / 2;
    const plaster = k.surface('plaster_pale', 2.2, { color: new Color(0x76847f) });
    const roof = k.surface('plaster_pale', 3, { color: new Color(0x5f6866) });
    const paper = b.damask(PALETTE.damaskTeal, 0.85);
    const wood = b.wood(1.2);
    const floor = k.surface('wood_floor_dark', 2, { roughness: 0.4, color: new Color(0x8c8c84) });
    const shell = new Group();
    shell.position.z = Z_NEAR;
    this.root.add(shell);
    b.box(W, L, H, { floor, ceiling: roof }, shell);

    for (const [x, facing] of [
      [-W / 2, '+x'],
      [W / 2, '-x'],
    ] as const) {
      b.wall(x, mid, L, DADO, facing, paper, this.root);
      b.wall(x, mid, L, H - DADO, facing, plaster, this.root, DADO);
      b.wainscot(x, mid, L, facing, this.root, WAINSCOT);
      const inward = x < 0 ? 1 : -1;
      const rail = k.block(0.08, 0.13, L, wood);
      rail.position.set(x + inward * 0.04, DADO, mid);
      const cornice = k.block(0.16, 0.2, L, wood);
      cornice.position.set(x + inward * 0.08, H - 0.1, mid);
      this.root.add(rail, cornice);
    }
    b.wall(0, Z_NEAR, W, H, '-z', plaster, this.root);
    b.wall(0, Z_FAR, W, H, '+z', paper, this.root);
    b.wainscot(0, Z_NEAR, W, '-z', this.root, WAINSCOT);
    b.wainscot(0, Z_FAR, W, '+z', this.root, WAINSCOT);
    for (const [z, inward] of [
      [Z_NEAR, -1],
      [Z_FAR, 1],
    ] as const) {
      const rail = k.block(W, 0.13, 0.08, wood);
      rail.position.set(0, DADO, z + inward * 0.04);
      const cornice = k.block(W, 0.2, 0.16, wood);
      cornice.position.set(0, H - 0.1, z + inward * 0.08);
      this.root.add(rail, cornice);
    }
    b.door(0, Z_NEAR, '-z', this.root, { color: 0x1c1712, width: 1.7, height: 2.8 });
    b.door(W / 2, -16.7, '-x', this.root, { open: 0.14, beyond: 0x020302, color: 0x1c1712 });

    // the timbers of the roof, and the posts that carry them down the wall
    for (let z = OVAL_Z + BAY / 2; z < Z_NEAR - 0.5; z += BAY) this.bay(z, wood);
    this.bay(OVAL_Z - BAY / 2, wood);

    const wallGrime = new MeshBasicMaterial({ map: bayGrime(13), transparent: true, depthWrite: false });
    const sheets: BufferGeometry[] = [];
    for (const sign of [-1, 1]) {
      const g = new PlaneGeometry(L, H - DADO);
      g.rotateY((-sign * Math.PI) / 2);
      g.translate(sign * (W / 2 - 0.012), (H + DADO) / 2, mid);
      const p = g.getAttribute('position');
      const uv = g.getAttribute('uv');
      for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getZ(i) - OVAL_Z) / BAY + 0.5, (p.getY(i) - DADO) / (H - DADO));
      sheets.push(g);
    }
    const walls = new Mesh(mergeGeometries(sheets), wallGrime);
    walls.frustumCulled = false;
    walls.renderOrder = 1;

    const roofDirt = new Mesh(new PlaneGeometry(W, L), new MeshBasicMaterial({ map: roofGrime(29), transparent: true, depthWrite: false }));
    roofDirt.geometry.getAttribute('uv').applyMatrix4(new Matrix4().makeScale(1, L / W, 1));
    roofDirt.rotation.x = Math.PI / 2;
    roofDirt.position.set(0, H - 0.01, mid);
    roofDirt.frustumCulled = false;
    roofDirt.renderOrder = 1;

    const endDirt = new Mesh(new PlaneGeometry(W, H), new MeshBasicMaterial({ map: endGrime(47), transparent: true, depthWrite: false }));
    endDirt.position.set(0, H / 2, Z_FAR + 0.012);
    endDirt.frustumCulled = false;
    endDirt.renderOrder = 1;

    const shine = new Mesh(new PlaneGeometry(2.6, 15.4), new MeshBasicMaterial({ map: floorShine(), color: new Color(COLD).multiplyScalar(0.075), transparent: true, depthWrite: false, blending: AdditiveBlending }));
    shine.rotation.x = -Math.PI / 2;
    shine.position.set(0, 0.006, COFFIN_Z + 0.6 + 7.7);
    shine.frustumCulled = false;
    shine.renderOrder = 1;
    this.root.add(walls, roofDirt, endDirt, shine);
  }

  private bay(z: number, wood: Material): void {
    const beam = this.kit.block(W, 0.36, 0.3, wood);
    beam.position.set(0, H - 0.18, z);
    this.root.add(beam);
    for (const sign of [-1, 1]) {
      const post = this.kit.block(0.16, H - DADO, 0.26, wood);
      post.position.set(sign * (W / 2 - 0.08), (H + DADO) / 2, z);
      this.root.add(post);
    }
  }

  /** The windows, high up, and the oval in the roof: a grey sky, and white hair falling past it. */
  private buildWindows(): void {
    const k = this.kit;
    this.rainBack = hairRain(61, 180, '#aab3b2');
    this.rainFront = hairRain(97, 130, null);
    const back = new MeshBasicMaterial({ map: this.rainBack, color: new Color().setScalar(WINDOW_SKY) });
    const front = new MeshBasicMaterial({ map: this.rainFront, color: new Color().setScalar(0.5), transparent: true, depthWrite: false, blending: AdditiveBlending });
    const r = seeded(211);
    const frames = k.props('window_wood', 8);
    const panes: BufferGeometry[] = [];
    let n = 0;
    for (let z = OVAL_Z; z < Z_NEAR - 1; z += BAY) {
      for (const sign of [-1, 1]) {
        frames.set(n++, sign * (W / 2 - 0.1), WINDOW_SILL, z, (-sign * Math.PI) / 2, 1);
        const g = new PlaneGeometry(2, 1.46);
        const uv = g.getAttribute('uv');
        const u0 = r();
        const v0 = r();
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + u0, uv.getY(i) * (1.46 / 4) + v0);
        g.rotateY((-sign * Math.PI) / 2);
        g.translate(sign * (W / 2 - 0.03), WINDOW_SILL + 0.75, z);
        panes.push(g);
      }
    }
    frames.commit();
    const merged = mergeGeometries(panes);
    const sky = new Mesh(merged, back);
    const hair = new Mesh(merged, front);
    sky.frustumCulled = hair.frustumCulled = false;
    hair.renderOrder = 2;
    this.root.add(frames.root, sky, hair);

    // the opening: a hole of light with square corners, so that no head leaning over it leaves a moon of it
    const disc = new PlaneGeometry(2, 2);
    const p = disc.getAttribute('position');
    const uv = disc.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) * OVAL_X * SKYLIGHT_FILL;
      const y = p.getY(i) * OVAL_L * SKYLIGHT_FILL;
      p.setXY(i, x, y);
      uv.setXY(i, x / 2, -y / 4);
    }
    disc.rotateX(Math.PI / 2);
    const brighter = back.clone();
    brighter.color.setScalar(OVAL_SKY);
    const oval = new Mesh(disc, brighter);
    oval.position.set(0, H - 0.018, OVAL_Z);
    oval.frustumCulled = false;
    const ovalHair = new Mesh(disc, front);
    ovalHair.position.set(0, H - 0.02, OVAL_Z);
    ovalHair.frustumCulled = false;
    ovalHair.renderOrder = 2;
    const rimX = OVAL_X * SKYLIGHT_FILL;
    const rimZ = OVAL_L * SKYLIGHT_FILL;
    const rim = mergeGeometries([
      new BoxGeometry(MOULDING_W, MOULDING_D, rimZ * 2 + MOULDING_W).translate(-rimX, 0, 0),
      new BoxGeometry(MOULDING_W, MOULDING_D, rimZ * 2 + MOULDING_W).translate(rimX, 0, 0),
      new BoxGeometry(rimX * 2 - MOULDING_W, MOULDING_D, MOULDING_W).translate(0, 0, -rimZ),
      new BoxGeometry(rimX * 2 - MOULDING_W, MOULDING_D, MOULDING_W).translate(0, 0, rimZ),
    ])!;
    const moulding = new Mesh(rim, k.surface('wood_dark_paint', 1.6));
    moulding.position.set(0, H - 0.03, OVAL_Z);
    moulding.frustumCulled = false;
    this.root.add(oval, ovalHair, moulding);
    this.ovalParts.push(oval, ovalHair, moulding);
    this.halo = this.build.glow(0, H - 0.3, OVAL_Z, 5, COLD, 0.05, this.root);

    this.haze = this.build.glow(0, H - 0.25, OVAL_Z, 6.5, COLD, 0.14, this.root);
    const strand = { width: 0.0007, sway: 0.12, color: 0xa39f94 };
    this.falling.push(
      this.build.hair(20, { x: [-0.95, -0.5], y: H + 2.2, z: [OVAL_Z - 1.2, OVAL_Z + 0.25] }, [2.4, 4.2], this.root, { seed: 31, ...strand }).mesh,
      this.build.hair(20, { x: [0.5, 0.95], y: H + 5, z: [OVAL_Z - 1.2, OVAL_Z + 0.25] }, [2.4, 4.2], this.root, { seed: 37, ...strand }).mesh,
      this.build.hair(14, { x: [-1, 1], y: H + 8.4, z: [OVAL_Z - 1.2, OVAL_Z - 0.2] }, [3, 4.8], this.root, { seed: 41, ...strand }).mesh,
    );
  }

  /** The box on its trestles, its lining, the body, the print, the combed hair. */
  private buildBox(): void {
    const k = this.kit;
    const b = this.build;
    const boards = k.surface('wood_raw_boards', 1, { color: new Color(0xb9b6a8) });
    const coffin = k.prop('coffin', [0, TRESTLE_TOP, COFFIN_Z], { castShadow: true, rotation: [0, 180, 0] }, this.root);
    k.paint(coffin, boards);
    coffin.scale.set(COFFIN_SCALE[0], WALK_DEPTH, COFFIN_SCALE[2]);
    this.coffin = coffin;
    const dark = k.surface('wood_dark_paint', 1.6);
    for (const z of [COFFIN_Z - 0.66, COFFIN_Z + 0.66]) this.root.add(this.trestle(z, dark));

    // ash-colored linen: the hair and the print must be the palest things in here
    const linen = k.surface('linen_white', 0.4, { color: new Color(0x4d524c) });
    this.liningMesh = this.lining(linen);
    this.root.add(this.liningMesh, this.mattress(linen));
    const pillow = k.prop('pillow', [0, MATTRESS_Y - 0.005, EYE[2] + 0.07], { scale: 0.8 }, this.root);
    k.paint(pillow, linen);

    const body = k.figures.hero({ avatar: 'figure_man', clip: 'm_idle_roll_head_01', face: 'blank', white: true, bleach: 0.7 });
    body.update(0);
    body.root.updateMatrixWorld(true);
    turnBone(body.bone('Bip01_Head')!, new Vector3(0, -0.19, 0.98), new Vector3(0, 0.04, 1));
    const hips = worldOf(body.bone('Bip01')!);
    const point = (x: number, y: number, z: number) => hips.clone().add(new Vector3(x, y, z));
    reach(body, 'L', point(0.09, 0.13, 0.155), point(0.55, 0.12, -0.25));
    reach(body, 'R', point(-0.1, 0.2, 0.178), point(-0.55, 0.12, -0.25));
    const palm = new Vector3(0, 0, -1);
    layHand(body, 'L', new Vector3(-0.96, 0.28, 0), palm);
    layHand(body, 'R', new Vector3(0.96, 0.28, 0), palm);
    body.root.rotation.set(-Math.PI / 2, 0, Math.PI);
    body.root.position.set(0, BODY_Y, COFFIN_Z - FEET);
    body.root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.receiveShadow = true;
      if (/head|opacity/.test((mesh.material as Material).name)) {
        this.head.push(mesh);
      } else {
        mesh.castShadow = true;
        this.darkenSuit(mesh as SkinnedMesh);
      }
    });
    this.root.add(body.root);
    this.root.add(this.combedHair());

    const first = this.album.pictures[0];
    const print = b.print(first ? this.album.texture(first) : darkPaper(), PRINT_W);
    print.rotation.x = -Math.PI / 2;
    print.position.z = PRINT_W * 0.6;
    this.printHinge = new Group();
    this.printHinge.position.set(0, FACE_Y + 0.012, EYE[2] + 0.01 - PRINT_W * 0.6);
    this.printHinge.add(print);
    this.root.add(this.printHinge);
    this.faceHole = new Mesh(new PlaneGeometry(0.2, 0.27), new MeshBasicMaterial({ map: softDisc('0,0,0', 0.74), transparent: true, depthWrite: false, opacity: FACE_SHADE }));
    this.faceHole.rotation.x = -Math.PI / 2;
    this.faceHole.position.set(0, FACE_Y + 0.004, EYE[2] + 0.01);
    this.faceHole.frustumCulled = false;
    this.root.add(this.faceHole);

    this.leaning = k.prop('coffin_lid', [-2.45, 0, Z_FAR + 0.42], { rotation: [80, 0, 0], scale: 1.04 }, this.root);
    k.paint(this.leaning, boards);
  }

  /** The suit goes dark; the hands, painted in the same image, stay the color of the old: told apart by their bones. */
  private darkenSuit(mesh: SkinnedMesh): void {
    const hands = mesh.skeleton.bones.map((b) => /Hand|Finger/.test(b.name));
    const geometry = mesh.geometry.clone();
    const index = geometry.getAttribute('skinIndex');
    const weight = geometry.getAttribute('skinWeight');
    const colors = new Float32Array(index.count * 3);
    for (let i = 0; i < index.count; i++) {
      let h = 0;
      for (let c = 0; c < 4; c++) if (hands[index.getComponent(i, c)]) h += weight.getComponent(i, c);
      colors[i * 3] = lerp(SUIT, HAND, h);
      colors[i * 3 + 1] = lerp(SUIT, HAND * 0.96, h);
      colors[i * 3 + 2] = lerp(SUIT * 1.08, HAND * 0.88, h);
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    const material = (mesh.material as MeshStandardMaterial).clone();
    material.vertexColors = true;
    mesh.geometry = geometry;
    mesh.material = material;
    this.ownGeometries.push(geometry);
    this.ownMaterials.push(material);
  }

  private trestle(z: number, material: Material): Mesh {
    const parts: BufferGeometry[] = [];
    const bar = (w: number, h: number, d: number, x: number, y: number, zz: number, rx = 0) => {
      const g = new BoxGeometry(w, h, d);
      g.rotateX(rx);
      g.translate(x, y, zz);
      parts.push(g);
    };
    const span = 0.46;
    const top = TRESTLE_TOP;
    bar(0.86, 0.07, 0.09, 0, top - 0.035, 0);
    for (const x of [-span, span]) {
      bar(0.055, 0.56, 0.055, x, top * 0.46, 0.14, 0.42);
      bar(0.055, 0.56, 0.055, x, top * 0.46, -0.14, -0.42);
    }
    bar(0.86, 0.04, 0.03, 0, top * 0.34, 0.22);
    bar(0.86, 0.04, 0.03, 0, top * 0.34, -0.22);
    const mesh = new Mesh(mergeGeometries(parts), material);
    mesh.position.z = z;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Cloth pleated down the inside of the box. */
  private lining(material: Material): Mesh {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const rows = 7;
    const y0 = MATTRESS_Y;
    const y1 = RIM_Y - 0.012;
    OUTLINE.forEach((p, i) => {
      const q = OUTLINE[(i + 1) % OUTLINE.length];
      const ax = p[0] * COFFIN_SCALE[0] * 0.88;
      const az = p[1] * COFFIN_SCALE[2] * 0.965;
      const bx = q[0] * COFFIN_SCALE[0] * 0.88;
      const bz = q[1] * COFFIN_SCALE[2] * 0.965;
      const len = Math.hypot(bx - ax, bz - az);
      const cols = Math.ceil(len / 0.03);
      let nx = -(bz - az) / len;
      let nz = (bx - ax) / len;
      if (nx * (ax + bx) + nz * (az + bz) > 0) {
        nx = -nx;
        nz = -nz;
      }
      const start = positions.length / 3;
      for (let r = 0; r <= rows; r++) {
        const v = r / rows;
        for (let c = 0; c <= cols; c++) {
          const u = c / cols;
          const pleat = (Math.sin(u * len * 46 + i) * 0.012 + Math.sin(u * len * 13 + v * 2.6 + i * 2) * 0.012) * (0.5 + 0.5 * Math.sin(v * Math.PI));
          positions.push(ax + (bx - ax) * u + nx * pleat, y0 + (y1 - y0) * v, az + (bz - az) * u + nz * pleat);
          uvs.push(u * len, v * (y1 - y0));
        }
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const a = start + r * (cols + 1) + c;
          const d = a + cols + 1;
          indices.push(a, a + 1, d, a + 1, d + 1, d);
        }
      }
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    const mesh = new Mesh(g, material);
    mesh.position.z = COFFIN_Z;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  private mattress(material: Material): Mesh {
    const shape = new Shape();
    OUTLINE.forEach((p, i) => {
      const x = p[0] * COFFIN_SCALE[0] * 0.9;
      const y = -p[1] * COFFIN_SCALE[2] * 0.97;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    const g = new ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    const mesh = new Mesh(g, material);
    mesh.position.set(0, MATTRESS_Y, COFFIN_Z);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** White hair, combed: someone took their time over it, laid out round the head on the pillow. */
  private combedHair(): Mesh {
    const r = seeded(19);
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const segments = 12;
    for (let i = 0; i < COMBED; i++) {
      const across = (i / (COMBED - 1)) * 2 - 1 + (r() - 0.5) * 0.02;
      const a = across * 1.42;
      const x0 = Math.sin(a) * 0.08;
      const z0 = 0.71 + Math.cos(a) * 0.1;
      const y0 = BODY_Y + 0.015 + Math.cos(a) * 0.05;
      const ridge = Math.sin(across * 34) * 0.0045;
      const wiggle = r() * 6.28;
      const tone = (0.62 + r() * 0.38) * (0.7 + HAIR_BANDS * Math.sin(across * 38 + 1.2));
      // out from the scalp and round toward the sides, longest beside the ears
      const reach = HAIR_LAY * (HAIR_CROWN + (1 - HAIR_CROWN) * Math.abs(Math.sin(a))) * (0.85 + (0.3 * wiggle) / 6.28);
      const laid = a * HAIR_SWEEP;
      const midX = Math.sin(a) * (0.08 + reach * 0.5);
      const midZ = 0.71 + Math.cos(a) * (0.1 + reach * 0.5);
      const endX = Math.sin(laid) * (0.08 + reach);
      const endZ = 0.71 + Math.cos(laid) * (0.1 + reach);
      const base = positions.length / 3;
      for (let k = 0; k <= segments; k++) {
        const t = k / segments;
        const mt = 1 - t;
        const px = mt * mt * x0 + 2 * mt * t * midX + t * t * endX + ridge * t + Math.sin(t * 7 + wiggle) * 0.0014;
        const pz = mt * mt * z0 + 2 * mt * t * midZ + t * t * endZ;
        const limit = innerHalf(pz);
        const x = Math.max(-limit, Math.min(limit, px));
        const y = lerp(y0, PILLOW_TOP, Math.min(1, t * 5));
        const w = 0.00115 * (1 - t * 0.55);
        const dz = -2 * mt * z0 + 2 * (mt - t) * midZ + 2 * t * endZ;
        const dx = -2 * mt * x0 + 2 * (mt - t) * midX + 2 * t * endX;
        const dl = Math.hypot(dx, dz) || 1;
        const side = dz / dl;
        const along = -dx / dl;
        positions.push(x - side * w, y, COFFIN_Z + pz - along * w, x + side * w, y, COFFIN_Z + pz + along * w);
        normals.push(0, 1, 0, 0, 1, 0);
        colors.push(tone, tone, tone * 0.96, tone, tone, tone * 0.96);
        if (k < segments) {
          const c = base + k * 2;
          indices.push(c, c + 2, c + 1, c + 1, c + 2, c + 3);
        }
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    g.setIndex(indices);
    const mesh = new Mesh(g, new MeshStandardMaterial({ color: 0xe9e5d9, roughness: 0.48, vertexColors: true }));
    mesh.frustumCulled = false;
    return mesh;
  }

  /** A body in its own dark clothes, and over the head a sack, sewn to the pose the head has been frozen in. */
  private mourner(avatar: 'figure_man' | 'figure_woman', bow: (typeof BOWS)[number] | typeof RING_BOW, count: number, seed: number): Crowd {
    const crowd = this.kit.figures.crowd({ avatar, clip: 'm_idle_roll_head_01', time: bow.time, face: 'blank', white: false, bleach: 0.8, tint: COAT }, count);
    const up = new Vector3(bow.up[0], bow.up[1], bow.up[2]).normalize();
    const face = new Vector3(bow.face[0], bow.face[1], bow.face[2]);
    face.addScaledVector(up, -face.dot(up)).normalize();
    const side = new Vector3().crossVectors(up, face);
    for (const o of crowd.root.children) {
      const mesh = o as Mesh;
      const name = (mesh.material as Material).name;
      if (/opacity/.test(name)) mesh.visible = false;
      if (!/head/.test(name)) continue;
      // the middle of the head as the bake left it; the sack's foot stays round the real neck, whatever the head does
      const head = mesh.geometry.getAttribute('position');
      const center = new Vector3();
      let lowest = Infinity;
      for (let i = 0; i < head.count; i++) {
        center.add(V1.fromBufferAttribute(head, i));
        lowest = Math.min(lowest, V1.y);
      }
      center.divideScalar(head.count).addScaledVector(up, 0.03).addScaledVector(face, 0.012);
      const neck = new Vector3();
      let around = 0;
      for (let i = 0; i < head.count; i++) {
        V1.fromBufferAttribute(head, i);
        if (V1.y > lowest + 0.02) continue;
        neck.add(V1);
        around++;
      }
      neck.divideScalar(around);
      const sack = sackGeometry(seed);
      const p = sack.getAttribute('position');
      const foot = center.clone().addScaledVector(up, -0.215);
      const collar = neck.addScaledVector(UP, 0.02).sub(foot);
      const place = new Matrix4().makeBasis(side, up, face).setPosition(center);
      for (let i = 0; i < p.count; i++) {
        V1.fromBufferAttribute(p, i);
        const y = V1.y;
        V1.applyMatrix4(place).addScaledVector(collar, smootherstep(range(-0.04, -0.215, y)));
        p.setXYZ(i, V1.x, V1.y, V1.z);
      }
      sack.computeVertexNormals();
      this.ownGeometries.push(sack);
      mesh.geometry = sack;
      mesh.material = this.burlapMaterial;
    }
    return crowd;
  }

  private buildPeople(): void {
    const r = seeded(83);
    this.burlapMaterial = new MeshStandardMaterial({ map: burlap(), roughness: 1, color: SACK_HALL });
    this.ownMaterials.push(this.burlapMaterial);
    interface Place {
      x: number;
      z: number;
      heading: number;
      scale: number;
      line: boolean;
    }
    const places: Place[] = [];
    for (let i = 0; i < LINE_EACH; i++) {
      for (const side of [-1, 1]) {
        const along = i / (LINE_EACH - 1);
        places.push({ x: side * lerp(AISLE[0], AISLE[1], along) + (r() - 0.5) * 0.1, z: LINE_FROM - i * LINE_STEP + (r() - 0.5) * 0.16, heading: (-side * Math.PI) / 2 + (r() - 0.5) * 0.34, scale: 0.98 + r() * 0.09, line: true });
      }
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 9; i++) places.push({ x: side * (3.72 + r() * 0.2), z: -2.4 - i * 1.62 + (r() - 0.5) * 0.3, heading: (-side * Math.PI) / 2 + (r() - 0.5) * 0.5, scale: 0.98 + r() * 0.08, line: false });
    }
    for (const x of [-3.2, -1.7, 0, 1.7, 3.2]) places.push({ x: x + (r() - 0.5) * 0.3, z: -16.7 + (r() - 0.5) * 0.3, heading: (r() - 0.5) * 0.3, scale: 0.98 + r() * 0.08, line: false });

    const counts = BOWS.map(() => 0);
    const assigned = places.map((_, i) => {
      const pose = (i * 5 + ((i * 7) >> 2)) % BOWS.length;
      return { pose, index: counts[pose]++ };
    });
    BOWS.forEach((bow, pose) => {
      const crowd = this.mourner(pose === 2 ? 'figure_woman' : 'figure_man', bow, counts[pose], 700 + pose * 13);
      this.crowds.push(crowd);
      this.dirty.push(false);
      this.people.add(crowd.root);
    });
    const blobGeometry = new PlaneGeometry(1, 1);
    blobGeometry.rotateX(-Math.PI / 2);
    const blobMaterial = new MeshBasicMaterial({ map: softDisc('0,0,0', 0.4), transparent: true, depthWrite: false, opacity: 0.8 });
    this.shadows = new InstancedMesh(blobGeometry, blobMaterial, places.length);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.people.add(this.shadows);
    places.forEach((p, i) => {
      const a = assigned[i];
      this.crowds[a.pose].set(a.index, p.x, 0, p.z, p.heading, p.scale);
      M1.makeScale(1.25, 1, 1.25).setPosition(p.x, 0.005, p.z);
      this.shadows.setMatrixAt(i, M1);
      if (p.line) this.mourners.push({ crowd: a.pose, index: a.index, x: p.x, z: p.z, heading: p.heading, scale: p.scale, turned: false });
    });
    for (const c of this.crowds) c.commit();
    this.shadows.instanceMatrix.needsUpdate = true;

    // rows of chairs nobody sits in, behind those who stand
    const seats: [number, number, number][] = [];
    for (let row = 0; row < 8; row++) {
      for (const x of [-3.28, -2.74, -2.2, 2.2, 2.74, 3.28]) {
        if (r() < 0.12) continue;
        seats.push([x + (r() - 0.5) * 0.05, -2.6 - row * 1.32 + (r() - 0.5) * 0.08, Math.PI + (r() - 0.5) * 0.16]);
      }
    }
    const chairs = this.kit.props('chair_white', seats.length);
    seats.forEach((s, i) => chairs.set(i, s[0], 0, s[1], s[2], 1));
    chairs.commit();
    for (const o of chairs.root.children) {
      const mesh = o as Mesh;
      const worn = (mesh.material as MeshStandardMaterial).clone();
      worn.color.setScalar(0.5);
      mesh.material = worn;
    }
    this.people.add(chairs.root);
    this.root.add(this.people);
  }

  /** Those round the box: not there until the flash shows them. */
  private buildRing(): void {
    this.ring = this.mourner('figure_man', RING_BOW, RING.length, 911);
    this.ring.root.visible = false;
    this.root.add(this.ring.root);
    const blobs = new PlaneGeometry(1, 1);
    blobs.rotateX(-Math.PI / 2);
    this.ringShadows = new InstancedMesh(blobs, new MeshBasicMaterial({ map: softDisc('0,0,0', 0.4), transparent: true, depthWrite: false, opacity: 0.85 }), RING.length);
    this.ringShadows.frustumCulled = false;
    this.ringShadows.renderOrder = 1;
    this.ringShadows.visible = false;
    this.root.add(this.ringShadows);
    RING.forEach((p, i) => {
      const r = p as { more?: number; moreAt?: number; part?: number; late?: boolean; leaves?: boolean };
      this.leaners.push({ x: p.x, z: EYE[2] + p.z, heading: Math.atan2(-p.x, NEAR_AIM - p.z), at: p.at, lean: p.lean, more: r.more ?? p.lean, moreAt: r.moreAt ?? Infinity, part: r.part ?? NaN, late: r.late ?? false, leaves: r.leaves ?? false });
      M1.makeScale(r.late ? 0 : 1.4, 1, r.late ? 0 : 1.4).setPosition(p.x, 0.006, EYE[2] + p.z - FLASH_BACK);
      this.ringShadows.setMatrixAt(i, M1);
    });
    this.ringShadows.instanceMatrix.needsUpdate = true;
  }

  /** Flowers that have stopped trying, and the easel with its back to you. */
  private buildFlowers(): void {
    const k = this.kit;
    const dark = k.surface('wood_dark_paint', 1.6);
    const stand = (x: number, z: number, tilt: readonly [number, number, number]) => {
      const post = k.block(0.3, 1.02, 0.3, dark);
      post.position.set(x, 0.51, z);
      post.castShadow = true;
      this.root.add(post);
      k.prop('urn', [x, 1.02, z], { scale: 0.74 }, this.root);
      k.prop('roses', [x, 1.22, z], { rotation: tilt, scale: 1.06 }, this.root);
    };
    stand(-1.55, COFFIN_Z - 0.3, [16, 40, -30]);
    stand(1.6, COFFIN_Z - 0.55, [-22, 200, 20]);
    k.prop('roses', [0.3, 0, COFFIN_Z + 1.6], { rotation: [86, 25, 0], scale: 0.86 }, this.root);
    const table = this.build.lampTable(-1.5, COFFIN_Z + 1.5, this.root, Math.PI / 2);
    table.shade.emissiveIntensity = 1.5;
    this.lamp = this.light(table.lightAt, PALETTE.warm, LAMP, 4.4);
    this.build.glow(table.lightAt[0], table.lightAt[1], table.lightAt[2], 1.1, PALETTE.warm, 0.42, this.root);

    const r = seeded(151);
    const petal = new PlaneGeometry(0.034, 0.026);
    petal.rotateX(-Math.PI / 2);
    const petals = new InstancedMesh(petal, new MeshStandardMaterial({ color: 0x3b0c10, roughness: 0.75 }), 90);
    for (let i = 0; i < 90; i++) {
      const near = i % 3;
      const cx = near === 0 ? -1.55 : near === 1 ? 0.3 : 1.6;
      const cz = near === 0 ? COFFIN_Z - 0.3 : near === 1 ? COFFIN_Z + 1.6 : COFFIN_Z - 0.55;
      const a = r() * 6.28;
      const d = 0.12 + r() * r() * 0.85;
      Q1.setFromAxisAngle(UP, r() * 6.28);
      M1.compose(V1.set(cx + Math.cos(a) * d, 0.0045, cz + Math.sin(a) * d), Q1, V2.setScalar(0.7 + r() * 0.8));
      petals.setMatrixAt(i, M1);
    }
    petals.instanceMatrix.needsUpdate = true;
    petals.frustumCulled = false;
    petals.receiveShadow = true;
    this.root.add(petals);

    this.easelBack = k.prop('easel', [1.42, 0, COFFIN_Z + 0.82], { rotation: [0, 180, 0], scale: 1.12, castShadow: true }, this.root);
    k.paint(this.easelBack, dark);
    for (const [x, z, power] of [
      [-1.55, COFFIN_Z - 0.3, 0.7],
      [1.6, COFFIN_Z - 0.55, 0.7],
      [1.42, COFFIN_Z + 0.82, 0.7],
      [-1.5, COFFIN_Z + 1.5, 0.7],
      [0, COFFIN_Z - 0.66, 1],
      [0, COFFIN_Z + 0.66, 1],
    ] as const) {
      const g = new Mesh(new PlaneGeometry(1.5, 1.5), this.ringShadows.material);
      g.rotation.x = -Math.PI / 2;
      g.position.set(x, 0.0055, z);
      g.scale.setScalar(power);
      g.frustumCulled = false;
      g.renderOrder = 1;
      this.root.add(g);
    }
  }

  /** What was on the easel all along: seen from where you lie now it stands over your head, the wrong way up. */
  private buildPhotograph(): void {
    const k = this.kit;
    const b = this.build;
    const date = dateNow();
    const sin = Math.sin(PHOTO_ELEVATION * DEG);
    const cos = Math.cos(PHOTO_ELEVATION * DEG);
    const g = new Group();
    g.position.set(PHOTO_SIDE, EYE[1] + sin * PHOTO_DISTANCE, EYE[2] + cos * PHOTO_DISTANCE);
    this.root.add(g);
    // square to the eye that looks at it, so that it reads as one thing, the wrong way up
    g.up.set(0, cos, -sin);
    g.lookAt(this.world(0, EYE[1], EYE[2]));

    const picture = b.label(PHOTO_W, PHOTO_H, (c, w, h) => paintStone(c, w, h, date), { px: 720, emissive: 1, roughness: 0.5 });
    this.photoMaterial = picture.mesh.material as MeshStandardMaterial;
    this.photoMaterial.emissiveIntensity = 0;
    g.add(picture.mesh);
    const black = k.surface('wood_dark_paint', 1.6);
    for (const [w, h, x, y] of [
      [PHOTO_W + 0.14, 0.08, 0, PHOTO_H / 2 + 0.04],
      [PHOTO_W + 0.14, 0.08, 0, -PHOTO_H / 2 - 0.04],
      [0.08, PHOTO_H, PHOTO_W / 2 + 0.04, 0],
      [0.08, PHOTO_H, -PHOTO_W / 2 - 0.04, 0],
    ] as const) {
      const bar = k.block(w, h, 0.05, black);
      bar.position.set(x, y, -0.005);
      g.add(bar);
    }
    const ledge = k.block(PHOTO_W + 0.34, 0.08, 0.14, black);
    ledge.position.set(0, -PHOTO_H / 2 - 0.12, 0);
    g.add(ledge);
    for (const x of [-PHOTO_W * 0.36, PHOTO_W * 0.36]) {
      const leg = k.block(0.07, 5, 0.05, black);
      leg.position.set(x, 0, -0.07);
      g.add(leg);
    }
    this.photograph = g;
    g.visible = false;
  }

  /** Planks, not the model's lid: its edge has to divide the picture in two, straight. Nails already through it. */
  private buildLid(): void {
    const k = this.kit;
    this.lid = new Group();
    this.lid.position.set(LID_OUT, RIM_Y + 0.03, COFFIN_Z);
    const plank = k.block(LID_W, 0.05, LID_L, k.surface('wood_raw_boards', 1.2, { color: new Color(0x6e6556) }));
    this.lid.add(plank);
    const edge = new Mesh(new BoxGeometry(0.012, 0.05, LID_L), new MeshBasicMaterial({ color: new Color().setScalar(LID_EDGE) }));
    edge.position.x = LID_W / 2 + 0.006;
    edge.frustumCulled = false;
    this.lid.add(edge);
    const cone = new ConeGeometry(0.0045, 0.07, 6);
    cone.rotateX(Math.PI);
    cone.translate(0, -0.06, 0);
    const steps = 18;
    const nails = new InstancedMesh(cone, new MeshStandardMaterial({ color: 0x4a4b4c, roughness: 0.42, metalness: 0.7 }), steps);
    for (let i = 0; i < steps; i++) {
      M1.makeTranslation(LID_W / 2 - 0.05, 0, -LID_L / 2 + 0.16 + (i * (LID_L - 0.32)) / (steps - 1));
      nails.setMatrixAt(i, M1);
    }
    nails.instanceMatrix.needsUpdate = true;
    nails.frustumCulled = false;
    this.lid.add(nails);
    this.lid.visible = false;
    this.root.add(this.lid);
  }

  /** Light and air: one column, grey light from the windows, and the small lights that only work from inside the box. */
  private buildAir(): void {
    const b = this.build;
    this.column = b.beam(0, H - 0.05, OVAL_Z, OVAL_X * 0.86, OVAL_X * 1.1, H - 1.4, COLD, 0.2, this.root);
    this.column.scale.z *= OVAL_L / OVAL_X;
    for (const z of [OVAL_Z + BAY, OVAL_Z + BAY * 2]) {
      const slant = b.beam(-1.5, 4.25, z, 0.72, 1.3, 6.6, 0xaebcbd, 0.05, this.root);
      slant.position.y = 2.15;
      slant.rotation.z = 49.5 * DEG;
    }
    b.glow(0, 1.2, COFFIN_Z, 3, COLD, 0.035, this.root);
    for (const [x, z] of [
      [-2.6, -2.8],
      [2.6, -7],
      [-2.6, -11.2],
    ] as const) {
      this.hallFill.push(this.light([x, 4.1, z], 0x9fb0b2, HALL_FILL, 8.5));
    }
    this.flash = this.light([0, 2.02, COFFIN_Z + 1.86], 0xfff4e8, 0, 7);
    this.eyeFill = this.light([0.26, 1.02, EYE[2] + 0.12], 0xb9c4bf, 0, 2.6);
    this.roofWash = this.light([0, H - 1.1, OVAL_Z], 0xb4c1c1, 0, 7);
    this.feetFill = this.light([0.3, 2.2, EYE[2] - 2.05], 0xa9b5b3, 0, 3.2);
    this.photoFill = this.light([PHOTO_SIDE, 2.3, EYE[2] + 1.0], 0xa5b2b0, 0, 2.6);
    this.clocks.push(b.motes(240, { x: [-W / 2, W / 2], y: [0.1, H - 0.2], z: [Z_FAR, Z_NEAR] }, this.root, { seed: 7 }).time);
    this.clocks.push(b.motes(120, { x: [-1.6, 1.6], y: [0.6, H - 0.4], z: [OVAL_Z - 1.8, OVAL_Z + 2.2] }, this.root, { seed: 9, strength: 1.6 }).time);

  }

  /** The sound: a big hushed room; silence before the flash; then the box, where everything is far but you; then nothing. */
  private score(): void {
    const s = this.sound;
    const bed = (name: string, file: string, o: RoomVoiceOptions) => this.beds.set(name, s.bed(file, o));
    const fade = (name: string, gain: number, seconds: number) => this.beds.get(name)?.gain(gain, seconds);
    this.beat(0, () => {
      bed('hall', 'rooms/hall_silence.mp3', { gain: 0.42 });
      bed('building', 'rooms/hall_vast.mp3', { gain: 0.2 });
      bed('rain', 'rooms/rain_roof.mp3', { gain: 0.2, reverb: 0.1 });
      bed('floor', 'rooms/dream_drone_low.mp3', { gain: 0.06, fade: 4 });
    });
    this.beat(1.4, () => s.play('rooms/seat_creak_2.mp3', { gain: 0.16, pan: 0.62, reverb: 0.4 }));
    this.beat(LINE_AT, () => this.say({ tr: 'Geç kalmadın. Tam vaktinde.', en: 'You are not late. You are right on time.' }, 4.2));
    this.beat(6.5, () => {
      s.play('rooms/cough_far_1.mp3', { gain: 0.3, pan: 0.5, reverb: 0.5, lowpass: 3000 });
      fade('rain', 0.11, 1.4);
      fade('hall', 0.28, 1.4);
    });
    this.beat(9.2, () => {
      s.play('rooms/chair_wood_move.mp3', { gain: 0.18, pan: -0.72, reverb: 0.3, lowpass: 2500 });
      fade('rain', 0.2, 4);
      fade('hall', 0.42, 4);
    });
    this.beat(12.6, () => s.play('rooms/nails_tin.mp3', { gain: 0.2, pan: 0.2, reverb: 0.5, lowpass: 2600 }));
    this.beat(15, () => s.play('rooms/cough_far_3.mp3', { gain: 0.2, pan: -0.55, reverb: 0.5, lowpass: 3000 }));
    this.beat(OPEN_AT, () => s.play('rooms/wood_creak_small_2.mp3', { gain: 0.2, reverb: 0.2 }));
    this.beat(21.2, () => {
      fade('rain', 0.1, 2);
      fade('building', 0.1, 2);
    });
    this.beat(24.1, () => {
      fade('hall', 0, 1.6);
      fade('building', 0, 1.6);
      fade('rain', 0, 1.6);
      fade('floor', 0, 1.6);
    });
    this.beat(SHUTTER_AT, () => this.shutter());
    this.beat(SHUTTER_AT + 0.5, () => s.play('rooms/crowd_rise.mp3', { gain: 0.3, reverb: 0.5, duration: 1.9 }));
    this.beat(TURN_FROM, () => s.play('rooms/seat_creak_4.mp3', { gain: 0.12, reverb: 0.4 }));
    this.beat(BLINK_AT, () => {
      s.play('rooms/sheet_over_face.mp3', { gain: 0.42, lowpass: 3000 });
      for (const name of ['hall', 'building', 'rain', 'floor']) this.beds.get(name)?.stop(0.1);
      bed('box', 'rooms/hall_vast.mp3', { gain: 0.16, lowpass: 900 });
      bed('rain under', 'rooms/rain_roof.mp3', { gain: 0.14, lowpass: 700 });
      bed('breath', 'rooms/breath_calm.mp3', { gain: 0.12, fade: 2 });
    });
    this.beat(29.6, () => s.play('rooms/mourners_lean.mp3', { gain: 0.3, reverb: 0.3 }));
    this.leaners.forEach((l, i) => {
      if (l.at > LID_AT) return;
      this.beat(l.at, () => s.play('rooms/coat_move.mp3', { gain: 0.34, pan: l.x < 0 ? -0.55 : 0.55, reverb: 0.1, rate: 0.9 + (i % 3) * 0.08 }));
    });
    this.beat(38.3, () => s.play('rooms/wood_creak_small_4.mp3', { gain: 0.16, pan: -0.3, reverb: 0.2 }));
    this.beat(38.6, () => {
      fade('rain under', 0, 1.6);
      fade('box', 0, 1.6);
    });
    this.beat(40.2, () => bed('thin', 'rooms/dream_drone_glass.mp3', { gain: 0.04, fade: 3 }));
    this.beat(TODAY_AT, () => this.say({ tr: 'Bugün.', en: 'Today.' }, 3.2));
    this.beat(44.6, () => s.play('rooms/nails_tin_box.mp3', { gain: 0.24, pan: 0.32, reverb: 0.5, lowpass: 3200 }));
    this.beat(LID_AT, () => s.play('rooms/lid_slide.mp3', { gain: 0.5, pan: -0.35, reverb: 0.3 }));
    this.beat(LID_STOP, () => {
      fade('breath', 0, 0.3);
      fade('thin', 0, 0.3);
    });
    this.beat(50.3, () => s.play('rooms/nails_coffin.mp3', { gain: 0.34, pan: 0.28, duration: 1.2 }));
    this.beat(LID_ON, () => s.play('rooms/lid_slide_short.mp3', { gain: 0.5, reverb: 0.3, rate: 0.96 }));
    this.beat(LID_SHUT, () => {
      s.play('rooms/lid_shut.mp3', { gain: 0.7 });
      for (const v of this.beds.values()) v.stop(0.05);
      this.beds.clear();
    });
  }

  /** Whoever you have passed turns, and steps into the aisle behind you: only while no one is looking. */
  private passBy(frame: RoomFrame, eyeX: number, eyeZ: number): void {
    for (let i = 0; i < this.mourners.length; i++) {
      const m = this.mourners[i];
      const want = m.z > eyeZ + BEHIND;
      if (want === m.turned) continue;
      if (!this.unseen(frame, m.x, 1.3, m.z, 7)) continue;
      if (!this.unseen(frame, m.x * PULLED_IN, 1.3, m.z, 7)) continue;
      m.turned = want;
      const x = want ? m.x * PULLED_IN : m.x;
      this.crowds[m.crowd].set(m.index, x, 0, m.z, want ? Math.atan2(eyeX - x, eyeZ - m.z) : m.heading, m.scale);
      this.dirty[m.crowd] = true;
      M1.makeScale(1.25, 1, 1.25).setPosition(x, 0.005, m.z);
      this.shadows.setMatrixAt(i, M1);
      this.shadows.instanceMatrix.needsUpdate = true;
    }
    for (let i = 0; i < this.crowds.length; i++) {
      if (!this.dirty[i]) continue;
      this.crowds[i].commit();
      this.dirty[i] = false;
    }
  }

  private leanRing(s: number): void {
    for (let i = 0; i < this.leaners.length; i++) {
      const l = this.leaners[i];
      let deg = RING_STOOP + (l.lean - RING_STOOP) * smootherstep(range(l.at, l.at + LEAN_TIME, s));
      if (l.moreAt !== Infinity) deg += (l.more - l.lean) * smootherstep(range(l.moreAt, l.moreAt + 1.2, s));
      if (!Number.isNaN(l.part)) deg += (l.part - deg) * smootherstep(range(PART_FROM, PART_TO, s));
      const scale = s < CUT_AT ? (l.late ? 0 : 1) : l.leaves && s >= ROLL_AT ? 0 : RING_SCALE;
      Q1.setFromAxisAngle(UP, l.heading).multiply(Q2.setFromAxisAngle(XAXIS, deg * DEG));
      M1.compose(V1.set(l.x, HIPS * scale - (RING_DIP * Math.max(0, deg)) / 50, s < CUT_AT ? l.z - FLASH_BACK : l.z), Q1, V2.setScalar(scale)).multiply(M2.makeTranslation(0, -HIPS, 0));
      this.ring.setMatrix(i, M1);
    }
    this.ring.commit();
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const under = s >= CUT_AT;
    this.pose(frame.t, POSE);
    const eyeX = POSE.position.x - this.origin.x;
    const eyeZ = POSE.position.z - this.origin.z;
    for (const c of this.clocks) c.value = frame.time;
    this.rainBack.offset.y = frame.time * RAIN_SLOW;
    this.rainFront.offset.y = frame.time * RAIN_FAST;
    for (const m of this.falling) {
      m.position.y = -s * FALL;
      m.visible = s < ROLL_AT;
    }
    for (const m of this.ovalParts) m.visible = s < ROLL_AT;

    this.control = s < HELD_AT ? WALKING : s < CUT_AT ? STILL : HELD;
    this.drift = s < HELD_AT ? 1 : 0;
    if (!under) this.passBy(frame, eyeX, eyeZ);
    this.people.visible = !under;
    this.film.grain = under ? 0.3 : 0.42;
    this.burlapMaterial.color.setHex(under ? SACK_NEAR : SACK_HALL);

    // the ring: the flash shows them; afterwards only their leaning changes
    const shown = s >= SHUTTER_AT;
    this.ring.root.visible = shown;
    this.ringShadows.visible = shown && !under;
    if (shown && (s < 42 || !this.ringDone)) {
      this.leanRing(s);
      this.ringDone = s >= 42;
    }
    const since = s - SHUTTER_AT;
    this.flash.intensity = since >= 0 && since < 2 ? FLASH_POWER * Math.exp(-since / FLASH_FADE) : 0;

    // the old man, the print turning over
    const flip = smootherstep(range(TURN_FROM, TURN_TO, s));
    this.printHinge.rotation.x = -flip * 2.9;
    this.printHinge.visible = !under;
    this.faceHole.visible = !under;
    for (const m of this.head) m.visible = !under;
    this.easelBack.visible = !under;
    this.leaning.visible = !under;
    this.photograph.visible = s >= ROLL_AT;
    this.column.visible = !under;
    this.haze.visible = !under;
    this.halo.visible = under && s < ROLL_AT;
    const depth = under ? COFFIN_SCALE[1] : WALK_DEPTH;
    this.coffin.scale.y = depth;
    const walkLining = (TRESTLE_TOP + 0.412 * WALK_DEPTH - 0.012 - MATTRESS_Y) / (RIM_Y - 0.012 - MATTRESS_Y);
    this.liningMesh.scale.y = under ? 1 : walkLining;
    this.liningMesh.position.y = under ? 0 : MATTRESS_Y * (1 - walkLining);

    // what closes: the lids, a second half-blink, and at the end the box
    const lids = smootherstep(range(BLINK_AT - 0.18, BLINK_AT, s)) * (1 - smootherstep(range(OPEN_FROM, OPEN_TO, s)));
    const flutter = s > FLUTTER[0] && s < FLUTTER[1] ? Math.sin(((s - FLUTTER[0]) / (FLUTTER[1] - FLUTTER[0])) * Math.PI) * 0.72 : 0;
    this.black = s >= LID_SHUT ? 1 : Math.max(lids, flutter);

    // the light goes out of the roof a head at a time
    const breath = 1 + 0.07 * wobble(frame.time * 0.17, 5);
    const closed = smootherstep(range(36.4, 39.2, s));
    const developed = smootherstep(range(DEVELOP[0], DEVELOP[1], s));
    this.keySpot.intensity = (under ? KEY_UNDER * (1 - closed) : KEY_POWER) * breath;
    this.lamp.intensity = LAMP * (1 - closed) * (1 + 0.06 * wobble(frame.time * 0.8, 3));
    this.sideA.intensity = this.sideB.intensity = under ? 0 : SIDE_POWER * breath;
    for (const l of this.hallFill) l.intensity = under ? 0 : HALL_FILL * breath;
    this.eyeFill.intensity = under ? EYE_FILL * lerp(1, 0.2, closed) * smootherstep(range(OPEN_FROM, OPEN_TO, s)) : 0;
    this.roofWash.intensity = under ? ROOF_WASH * (1 - closed * 0.9) : 0;
    this.feetFill.intensity = under ? FEET_FILL * smootherstep(range(OPEN_FROM, OPEN_TO, s)) * (1 - smootherstep(range(31.2, 33.2, s))) : 0;
    this.photoFill.intensity = under ? 1.1 * developed : 0;
    this.photoMaterial.emissiveIntensity = PHOTO_GLOW * developed;

    // the lid: to half, stays, goes on
    const first = smootherstep(range(LID_AT, LID_STOP, s));
    const second = range(LID_ON, LID_SHUT, s);
    this.lid.visible = under && s < LID_SHUT + 0.2;
    this.lid.position.x = lerp(lerp(LID_OUT, LID_HALF, first), 0, second * second);

    // the lens and the fear
    if (!under) {
      const toPrint = eyeZ - EYE[2];
      this.focus = lerp(Math.max(1.6, eyeZ - COFFIN_Z), Math.max(1.2, Math.hypot(toPrint, POSE.position.y - FACE_Y)), smootherstep(range(20, 24, s)));
      this.aperture = lerp(3.6, 5.5, smootherstep(range(18, 25, s)));
    } else {
      this.focus = lerp(lerp(4, 1.1, smootherstep(range(31, 36, s))), 2.4, smootherstep(range(ROLL_AT, ROLLED_AT, s)));
      this.aperture = 1.4;
    }
    this.fear = s < 20 ? lerp(0.32, 0.5, s / 20) : s < LID_SHUT ? lerp(0.62, 0.92, range(26, 40, s)) : 0;
  }

  dispose(): void {
    super.dispose();
    for (const m of this.ownMaterials) m.dispose();
    for (const g of this.ownGeometries) g.dispose();
    this.ownMaterials.length = 0;
    this.ownGeometries.length = 0;
  }
}
