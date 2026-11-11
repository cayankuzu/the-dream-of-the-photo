import {
  AdditiveBlending,
  AnimationMixer,
  Box3,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type AnimationClip,
  type Material,
  type SkinnedMesh,
} from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { SpotSpec } from '../../../config/nightmare.config';
import { REDUCED_MOTION } from '../../../config/experience.config';
import { lang } from '../../../ui/i18n';
import type { DreamKit, PropCrowd } from '../../dream/DreamKit';
import { randomFrom, type AvatarKey, type Crowd } from '../../dream/FigureKit';
import type { DreamLight } from '../../dream/LightPool';
import { clamp, lerp, range, wobble } from '../../math';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import { PALETTE } from '../RoomKit';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['cake', 'cake_stand', 'candle_party', 'party_hat', 'balloon', 'gramophone', 'horn_bulb', 'table_kitchen', 'table_small', 'chair_white', 'plate', 'fork', 'spoon', 'lamp_pendant', 'curtains', 'coat_stand'],
  materials: ['wood_floor_dark', 'carpet_dirty', 'plaster_mould', 'velvet_red'],
  sounds: [
    'rooms/dream_drone_low.mp3',
    'rooms/record_crackle.mp3',
    'rooms/needle_drop.mp3',
    'rooms/fairground_organ_slow.mp3',
    'rooms/candle_out_1.mp3',
    'rooms/candle_out_2.mp3',
    'rooms/candle_out_3.mp3',
    'rooms/candle_out_4.mp3',
    'rooms/candle_blow.mp3',
    'rooms/flame_out.mp3',
    'rooms/clown_horn_slow.mp3',
    'rooms/horns_all.mp3',
    'rooms/breath_sack.mp3',
    'rooms/balloon_rub.mp3',
    'rooms/balloon_squeak_1.mp3',
    'rooms/balloon_squeak_2.mp3',
    'rooms/balloon_squeak_3.mp3',
    'rooms/balloon_squeak_4.mp3',
    'rooms/wood_creak_small_1.mp3',
    'rooms/wood_creak_small_2.mp3',
    'rooms/wood_creak_small_3.mp3',
    'rooms/wood_creak_small_4.mp3',
    'rooms/wood_creak_small_5.mp3',
    'rooms/chair_wood_move.mp3',
    'rooms/wood_block_1.mp3',
  ],
};

type V3 = readonly [number, number, number];
type Ctx = CanvasRenderingContext2D;

/** The room (m): width, height, where its back and far walls stand. */
const W = 4.9;
const H = 2.75;
const Z_BACK = 2.0;
const Z_FAR = -7.0;
/** The table (m): half its width, its top, its near and far end, how far the cloth hangs. */
const TABLE_HALF = 0.475;
const TABLE_TOP = 0.77;
const TABLE_NEAR = -0.4;
const TABLE_FAR = -5.4;
const CLOTH_DROP = 0.17;
/** The chairs (m): the rows' distance from the axis, the six places of a row, the chair at either end. */
const CHAIR_X = 0.72;
const CHAIR_Z = [-1.0, -1.78, -2.56, -3.34, -4.12, -4.9] as const;
const CHAIR_FAR = -5.95;
const CHAIR_NEAR = 0.02;
/** Where the cake stands and the pendant hangs along the table (m). */
const CAKE_Z = -4.6;
const LAMP_Z = -3.4;
/** Where the eye stands by the last candles, the chair beside it. */
const EYE_END: V3 = [1.25, 1.5, -2.0];
/**
 * Where it stands when the light comes back: at the head of the table, behind your own chair, where it stood
 * when the room began; and where it has crept to by the cut. How it looks down the table from there (deg).
 */
const HOME: V3 = [0, 1.5, 1.25];
const HOME_END: V3 = [0, 1.48, 1.02];
const HOME_PITCH = -9;
const HOME_FOV = 46;
/** How far the eye turns at the honk (deg of yaw, from looking down the room). */
const TURN_YAW = REDUCED_MOTION ? 95 : 152;

/**
 * The clock of the room (s of its own script; the journey shows it from 1 to 50 in 40 s). The narrator counts
 * the candles over the full cake at about 9.6 (7 s on screen): the room keeps still from 7.7 to 11.4, the
 * first candle goes as he finishes, and the clown first changes chairs after him.
 */
const T_NEEDLE = 1.2;
const T_ORGAN = 2;
const T_HONK = 20;
const T_QUIET = 18.4;
const T_BREATH = 34;
const T_LAST = 38;
/** After the last candle, in the dark: the party, heard and never seen; it stops dead; the lamp; the picture; the two lines. */
const T_PARTY = T_LAST + 0.55;
const T_HUSH = T_PARTY + 3.45;
const T_LAMP = T_HUSH + 0.8;
const T_SHUTTER = 43.7;
const T_CAME = 44.6;
const T_BUT_YOU = 47.05;
const T_CUT = 49.9;

const CANDLES = 33;
/** Seconds a flame takes to die, how fast the room's light falls with the count (power of its share). */
const FLAME_DIES = 0.22;
const CANDLE_CURVE = 1;
/** The candles' light: on the far end around the cake, the shadows it throws toward the viewer, the white cloth's bounce. */
const CAKE_LIGHT = 11;
const CAKE_SPOT = 15;
const BOUNCE_LIGHT = 0.9;
/** The candles on the wall behind him: what makes him a silhouette. */
const WALL_SPOT = 7.5;
/** The candlelight that reaches the near end of the room, and how much of it stays as they go (0..1). */
const AIR_FILL = 2.4;
const AIR_STAYS = 0.3;
/** Beside the viewer the last candles need a little help to reach a face. */
const FACE_FILL = 0.7;
/** The room's own lamp: point, spot, the globe's emission. */
const LAMP_LIGHT = 7;
const LAMP_SPOT = 26;
/** A flat fill from your end of the table under the lamp: the worst light there is. */
const LAMP_FILL = 1.5;
const LAMP_GLOBE = 2.6;
/** Picture: exposure with all the candles, with few, under the lamp. */
const EXPOSURE_FULL = 1.15;
const EXPOSURE_FEW = 1.55;
const EXPOSURE_LAMP = 0.86;
/** How much sourceless teal is in the room by candle and by the lamp. */
const ENV_CANDLE = 0.08;
const ENV_LAMP = 0.2;
/** How the flames sag when he changes chairs (s to fall, s to recover, depth 0..1). */
const DIP_IN = 0.14;
const DIP_OUT = 0.34;
const DIP_DEPTH = REDUCED_MOTION ? 0.75 : 0.97;
/** How long a breath of the sack lasts (s). */
const BREATH_CYCLE = 3.4;
/** Seconds the last wick glows: then he is gone, and so is everything they laid. */
const EMBER = 1.3;
const T_GONE = T_LAST + EMBER;
/** How hard the heart goes while the party is heard in the dark (0..1). */
const PARTY_FEAR = 0.9;
/** The lens once it is over: focus (m) and strength. */
const END_FOCUS = 2.2;
const END_APERTURE = 1.4;

/** Offsets on the bones (m at scale 1): the sack's center above the head bone, the hat's seat on it, how big the hat is. */
const HEAD_UP = 0.09;
const HAT_Y = 0.13;
const HAT_SCALE = 0.64;
/** How deep a seated body sits: its feet are on the floor. */
const SIT_Y = 0;

/** What they left behind: the paper hats that came off (besides those of the places), the horns put down. */
const HATS_DROPPED = 30;
const HORNS_LEFT = 9;
/** How far the chairs were pushed back from the table (m, least and most) and turned (rad, either way). */
const PUSH_BACK: readonly [number, number] = [0.2, 0.48];
const PUSH_TURN = 0.65;
/**
 * The places whose chairs went over backwards (see `places`; the first is his last chair), if nothing lies where
 * they would fall; those with a hat left on the seat.
 */
const FALLEN = [5, 8] as const;
const SEAT_HATS = [1, 2, 9] as const;
/** How much of the cake is left (rad round its axis: what was cut away faces you), your slice (rad), how it is turned on your plate (rad). */
const CAKE_LEFT = 4.2;
const SLICE = 0.56;
const SLICE_HEADING = 2.1;
/** Where your own paper hat still stands, from the middle of your plate (m, x and z). */
const YOUR_HAT: readonly [number, number] = [0.25, 0.1];
/** Samples along a cut through the cake, from its axis to its rim. */
const CUT_SAMPLES = 40;
/** A paper hat on its side rests on its rim and its pompom: how far its axis then tips past level (rad), how high its middle is at scale 1 (m). */
const HAT_TIP = 0.267;
const HAT_LIFT = 0.0723;
/** Where the uneaten part of the cake begins round its axis (rad), and an angle that keeps all of it. */
const CAKE_FROM = Math.PI - CAKE_LEFT / 2;
const WHOLE = Math.PI * 2 + 1;

/** When each candle goes: slowly once he has counted them, then the honk, twelve behind your back, nine more, the last three slowly. */
const SLOW = 6;
const DEATHS: readonly number[] = (() => {
  const out: number[] = [];
  for (let i = 0, s = 12.2; i < SLOW; i++, s += 1.7 - i * 0.1) out.push(s);
  out.push(20.05, 20.12, 20.22);
  for (let i = 0; i < 12; i++) out.push(20.7 + i * 0.38);
  for (let i = 0; i < 9; i++) out.push(25.6 + i * 1.01);
  out.push(35, 36.5, T_LAST);
  return out;
})();

/** The candles he changes chairs under, and the earliest he may take his chance if you look away (s). */
const HOP_CANDLE = [1, 3, 4, 17, 24, 29] as const;
const HOP_AT: readonly number[] = HOP_CANDLE.map((c) => DEATHS[c]);
const HOP_EARLY = [13, 15, 16.9, 21.2, 27.6, 31] as const;

/** The chairs he comes through, from the far end to the one beside you. */
const SEATS = [
  { x: 0, z: CHAIR_FAR, heading: 0 },
  { x: -CHAIR_X, z: CHAIR_Z[5], heading: Math.PI / 2 },
  { x: CHAIR_X, z: CHAIR_Z[4], heading: -Math.PI / 2 },
  { x: -CHAIR_X, z: CHAIR_Z[3], heading: Math.PI / 2 },
  { x: CHAIR_X, z: CHAIR_Z[3], heading: -Math.PI / 2 },
  { x: -CHAIR_X, z: CHAIR_Z[2], heading: Math.PI / 2 },
  { x: CHAIR_X, z: CHAIR_Z[2], heading: -Math.PI / 2 },
] as const;
const LAST_SEAT = SEATS.length - 1;

/** The banner: the half that still reads, the half that fell. */
const BANNER = { tr: ['İYİ Kİ DOĞ', 'DUN'], en: ['HAPPY BIR', 'THDAY'] } as const;
/** One flag of it (m). */
const FLAG = 0.3;
const FLAG_H = 0.34;

const CANDLE_OUT = ['rooms/candle_out_1.mp3', 'rooms/candle_out_2.mp3', 'rooms/candle_out_3.mp3', 'rooms/candle_out_4.mp3'] as const;
const CREAKS = ['rooms/wood_creak_small_1.mp3', 'rooms/wood_creak_small_2.mp3', 'rooms/wood_creak_small_3.mp3', 'rooms/wood_creak_small_4.mp3', 'rooms/wood_creak_small_5.mp3'] as const;

const UP = new Vector3(0, 1, 0);
const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const AVATARS: readonly AvatarKey[] = ['figure_man', 'figure_nurse', 'figure_woman', 'figure_child'];
const smooth = (t: number): number => t * t * (3 - 2 * t);

function surfaceCanvas(width: number, height: number): { canvas: HTMLCanvasElement; c: Ctx } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, c: canvas.getContext('2d')! };
}

function textureOf(canvas: HTMLCanvasElement, color: boolean): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = color ? SRGBColorSpace : NoColorSpace;
  t.anisotropy = 4;
  t.wrapS = RepeatWrapping;
  return t;
}

/** A body's clip by name, wherever it lives. */
function clipNamed(kit: DreamKit, name: string): AnimationClip {
  for (const key of AVATARS) {
    const clip = kit.model(key).animations.find((a: AnimationClip) => a.name === name);
    if (clip) return clip;
  }
  throw new Error(`no clip ${name}`);
}

/** Where the head of a pose lies, in the frame of the crowd baked from it. */
function headOf(kit: DreamKit, avatar: AvatarKey, clip: string, time: number): Vector3 {
  const body = cloneSkinned(kit.model(avatar).scene);
  const mixer = new AnimationMixer(body);
  mixer.clipAction(clipNamed(kit, clip)).play();
  mixer.setTime(time);
  body.updateMatrixWorld(true);
  let low = Infinity;
  const v = new Vector3();
  body.traverse((o) => {
    const mesh = o as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.skeleton.update();
    const p = mesh.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i += 3) {
      v.fromBufferAttribute(p, i);
      mesh.applyBoneTransform(i, v);
      v.applyMatrix4(mesh.matrixWorld);
      low = Math.min(low, v.y);
    }
  });
  const hips = body.getObjectByName('Bip01')!.getWorldPosition(new Vector3());
  return body.getObjectByName('Bip01_Head')!.getWorldPosition(new Vector3()).sub(new Vector3(hips.x, low, hips.z));
}

/** The painted mouth: how far round the head it reaches either side and how far its corners rise (radians of the head), kept on the face and below the eyes. */
const MOUTH_HALF = 0.86;
const MOUTH_LIFT = 0.31;
/** Its paint, old and dried dark into the weave: the fill, the dull streaks in it, height in red and roughness in green (matte), what it gives back in the dark. */
const MOUTH_PAINT = '#2d1511';
const MOUTH_STREAK = '72,40,30';
const MOUTH_SURFACE = 'rgb(122,236,0)';
const MOUTH_GLOW = '#3a140e';

/** The line of the painted mouth (polar angle of the head) at an azimuth. */
function mouthPhi(th: number): number {
  return 2.025 - MOUTH_LIFT * Math.pow(Math.abs(th) / MOUTH_HALF, 2.4);
}

/** A point of the sack: a long face under cloth, brow and nose pressed from inside, the cloth dragged in folds toward the neck. */
function sackPoint(th: number, phi: number, suck: number, out: Vector3): Vector3 {
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  const lump = 1 + 0.03 * Math.sin(3 * th + 1.1) * Math.sin(2 * phi + 0.4) + 0.018 * Math.sin(7 * th + 2.3) * Math.sin(5 * phi + 1.7);
  const jaw = 1 - 0.16 * smooth(range(1.35, 2.2, phi)) - 0.3 * smooth(range(2.15, 2.95, phi));
  const pull = smooth(range(1.7, 2.9, phi));
  const fold = Math.pow(Math.abs(Math.sin(th * 6.5 + Math.sin(th * 2.1 + 0.6) * 1.6 + phi * 0.9)), 0.6) - 0.55;
  const bump = (a: number, b: number, wa: number, wb: number) => Math.exp(-(((th - a) / wa) ** 2) - (((phi - b) / wb) ** 2));
  const front = Math.max(0, Math.cos(th));
  const brow = 0.008 * Math.exp(-(((phi - 1.2) / 0.1) ** 2)) * front * front;
  const eyes = -0.022 * (bump(-0.44, 1.42, 0.2, 0.15) + bump(0.44, 1.42, 0.2, 0.15));
  const nose = 0.022 * bump(0, 1.74, 0.15, 0.2);
  const cheeks = -0.008 * (bump(-0.85, 1.95, 0.32, 0.3) + bump(0.85, 1.95, 0.32, 0.3));
  const chin = 0.012 * bump(0, 2.38, 0.3, 0.16);
  const smile = Math.abs(th) < MOUTH_HALF * 0.96 ? -0.006 * Math.exp(-(((phi - mouthPhi(th)) / 0.045) ** 2)) : 0;
  const breath = -0.034 * suck * bump(0, 2.02, 0.6, 0.36);
  const push = brow + eyes + nose + cheeks + chin + smile + breath + pull * 0.013 * fold;
  const dent = -0.012 * Math.exp(-((phi / 0.5) ** 2));
  return out.set((0.094 * jaw * lump + push) * s * Math.sin(th), (0.142 * lump + push * 0.4) * c + dent, (0.112 * jaw * lump + push) * s * Math.cos(th));
}

/** The sack as a mesh, with a morph in which its cloth is drawn in over the mouth. */
function sackGeometry(columns: number, rows: number): BufferGeometry {
  const v = new Vector3();
  const build = (suck: number) => {
    const g = new BufferGeometry();
    const positions: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= columns; i++) {
        sackPoint((i / columns - 0.5) * Math.PI * 2, (j / rows) * Math.PI, suck, v);
        positions.push(v.x, v.y, v.z);
        uvs.push(i / columns, 1 - j / rows);
      }
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < columns; i++) {
        const a = j * (columns + 1) + i;
        const b = a + columns + 1;
        index.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  };
  const rest = build(0);
  const drawn = build(1);
  rest.morphAttributes.position = [drawn.getAttribute('position')];
  rest.morphAttributes.normal = [drawn.getAttribute('normal')];
  return rest;
}

/** The cloth, the paint, and the lack of eyes: the head's three maps (color, height in red and roughness in green, the paint alone). */
function sackMaterial(): MeshStandardMaterial {
  const random = randomFrom(71);
  const WIDE = 1024;
  const TALL = 512;
  const color = surfaceCanvas(WIDE, TALL);
  const surface = surfaceCanvas(WIDE, TALL);
  const paint = surfaceCanvas(512, 256);

  const tile = (base: string, over: string, under: string): CanvasPattern => {
    const t = surfaceCanvas(8, 8);
    t.c.fillStyle = base;
    t.c.fillRect(0, 0, 8, 8);
    t.c.fillStyle = over;
    t.c.fillRect(0, 1, 4, 2);
    t.c.fillRect(4, 5, 4, 2);
    t.c.fillStyle = under;
    t.c.fillRect(5, 0, 2, 4);
    t.c.fillRect(1, 4, 2, 4);
    return t.c.createPattern(t.canvas, 'repeat')!;
  };
  color.c.fillStyle = tile('#847866', '#94886f', '#716756');
  color.c.fillRect(0, 0, WIDE, TALL);
  surface.c.fillStyle = tile('rgb(96,245,0)', 'rgb(160,245,0)', 'rgb(128,245,0)');
  surface.c.fillRect(0, 0, WIDE, TALL);
  paint.c.fillStyle = '#000';
  paint.c.fillRect(0, 0, 512, 256);

  // old stains and soot
  for (let i = 0; i < 320; i++) {
    const r = 12 + random() * 70;
    const x = random() * WIDE;
    const y = random() * TALL;
    const g = color.c.createRadialGradient(x, y, 0, x, y, r);
    const dark = random() < 0.72;
    g.addColorStop(0, dark ? `rgba(24,20,14,${0.07 + random() * 0.12})` : `rgba(150,140,118,${0.04 + random() * 0.07})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    color.c.fillStyle = g;
    color.c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const shade = color.c.createLinearGradient(0, 0, 0, TALL);
  shade.addColorStop(0, 'rgba(12,10,8,0.55)');
  shade.addColorStop(0.2, 'rgba(12,10,8,0)');
  shade.addColorStop(0.74, 'rgba(12,10,8,0)');
  shade.addColorStop(1, 'rgba(12,10,8,0.75)');
  color.c.fillStyle = shade;
  color.c.fillRect(0, 0, WIDE, TALL);

  // the mouth: wider than a face has room for, its corners turned up short of the eyes
  const cx = WIDE / 2;
  const half = (MOUTH_HALF / (Math.PI * 2)) * WIDE;
  const y0 = 330;
  const lift = (MOUTH_LIFT / Math.PI) * TALL;
  const tilt = -10;
  const mid = (dx: number) => y0 - lift * Math.pow(Math.abs(dx) / half, 2.4) + (tilt * dx) / half;
  const lip = (dx: number, size: number) => size * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(dx) / half, 1.6)), 0.8);
  const STEPS = 80;
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const dx = -half + (2 * half * i) / STEPS;
    upper.push(mid(dx) - lip(dx, 16) * (1 - 0.32 * Math.exp(-((dx / 20) ** 2))) + (random() - 0.5) * 4);
    lower.push(mid(dx) + lip(dx, 38) + (random() - 0.5) * 6);
  }
  const trace = (c: Ctx, k: number) => {
    c.beginPath();
    for (let i = 0; i <= STEPS; i++) c.lineTo((cx - half + (2 * half * i) / STEPS) * k, upper[i] * k);
    for (let i = STEPS; i >= 0; i--) c.lineTo((cx - half + (2 * half * i) / STEPS) * k, lower[i] * k);
    c.closePath();
  };
  // it never ran: the draws its runs once took are still taken, so the rest of the face stays where it was
  for (let i = 0; i < 8 * 3; i++) random();

  // laid on long ago and dried dark into the cloth: no sheen, no halo, nothing past its edge
  color.c.fillStyle = MOUTH_PAINT;
  trace(color.c, 1);
  color.c.fill();
  color.c.lineCap = 'round';
  color.c.save();
  trace(color.c, 1);
  color.c.clip();
  for (let i = 0; i < 190; i++) {
    const dx = (random() - 0.5) * 2 * half;
    const y = mid(dx) + (random() - 0.4) * 46;
    const dark = random() < 0.6;
    color.c.strokeStyle = dark ? `rgba(26,2,2,${0.14 + random() * 0.28})` : `rgba(${MOUTH_STREAK},${0.1 + random() * 0.24})`;
    color.c.lineWidth = 1 + random() * 3.2;
    color.c.beginPath();
    color.c.moveTo(cx + dx, y);
    color.c.lineTo(cx + dx + 14 + random() * 52, y + (random() - 0.5) * 5);
    color.c.stroke();
  }
  color.c.restore();
  // the cloth shows through where the brush ran dry
  for (let i = 0; i < 64; i++) {
    const dx = (random() - 0.5) * 2 * half * 0.94;
    color.c.fillStyle = `rgba(104,92,74,${0.2 + random() * 0.4})`;
    color.c.fillRect(cx + dx, mid(dx) + (random() - 0.35) * 38, 2 + random() * 10, 1 + random() * 3);
  }
  // the opening of it, a black line that never quite closes
  const slit = (c: Ctx, fill: string) => {
    c.fillStyle = fill;
    c.beginPath();
    for (let i = 0; i <= STEPS; i++) {
      const dx = -half * 0.9 + (2 * half * 0.9 * i) / STEPS;
      c.lineTo(cx + dx, mid(dx) + 3 - lip(dx, 4.5));
    }
    for (let i = STEPS; i >= 0; i--) {
      const dx = -half * 0.9 + (2 * half * 0.9 * i) / STEPS;
      c.lineTo(cx + dx, mid(dx) + 3 + lip(dx, 9));
    }
    c.closePath();
    c.fill();
  };
  slit(color.c, '#0b0303');

  surface.c.fillStyle = MOUTH_SURFACE;
  surface.c.lineCap = 'round';
  trace(surface.c, 1);
  surface.c.fill();
  slit(surface.c, 'rgb(20,240,0)');

  paint.c.fillStyle = MOUTH_GLOW;
  trace(paint.c, 0.5);
  paint.c.fill();

  // no eyes: two holes, cut by someone in a hurry
  const hole = (x: number, y: number, rx: number, ry: number) => {
    const rim: number[] = [];
    for (let a = 0; a < 26; a++) rim.push(0.82 + random() * 0.36);
    const draw = (c: Ctx, fill: string) => {
      c.fillStyle = fill;
      c.beginPath();
      rim.forEach((r, a) => {
        const t = (a / rim.length) * Math.PI * 2;
        c.lineTo(x + Math.cos(t) * rx * r, y + Math.sin(t) * ry * r);
      });
      c.closePath();
      c.fill();
    };
    const soot = color.c.createRadialGradient(x, y, ry * 0.6, x, y, rx * 2.2);
    soot.addColorStop(0, 'rgba(8,6,4,0.8)');
    soot.addColorStop(1, 'rgba(8,6,4,0)');
    color.c.fillStyle = soot;
    color.c.fillRect(x - rx * 2.4, y - rx * 2.4, rx * 4.8, rx * 4.8);
    // two thin lines of dirt run down from it
    color.c.strokeStyle = 'rgba(10,8,6,0.45)';
    color.c.lineWidth = 2.2;
    for (let i = 0; i < 2; i++) {
      const fromX = x + (random() - 0.5) * rx;
      color.c.beginPath();
      color.c.moveTo(fromX, y + ry);
      color.c.lineTo(fromX + (random() - 0.5) * 8, y + ry + 34 + random() * 40);
      color.c.stroke();
    }
    draw(color.c, '#020101');
    draw(surface.c, 'rgb(0,250,0)');
  };
  const thread = (c: Ctx, from: readonly [number, number], to: readonly [number, number], fill: string, width: number) => {
    c.strokeStyle = fill;
    c.lineWidth = width;
    c.beginPath();
    c.moveTo(from[0], from[1]);
    c.lineTo(to[0], to[1]);
    c.stroke();
  };
  const sew = (x0: number, y0Seam: number, x1: number, y1: number, count: number, reach: number) => {
    for (let i = 0; i <= count; i++) {
      const u = i / count;
      const x = lerp(x0, x1, u) + (random() - 0.5) * 3;
      const y = lerp(y0Seam, y1, u) + (random() - 0.5) * 3;
      const ax: readonly [number, number] = [x - reach * 0.6, y - reach];
      const ay: readonly [number, number] = [x + reach * 0.6, y + reach];
      thread(color.c, ax, ay, '#14100b', 3.2);
      thread(surface.c, ax, ay, 'rgb(230,220,0)', 3);
    }
  };
  hole(cx - 74, 232, 22, 18);
  hole(cx + 76, 241, 18, 21);
  // part of the mouth was sewn up too, badly, at one side
  for (let i = 0; i < 6; i++) {
    const dx = -150 + i * (20 + random() * 8);
    const m0 = mid(dx);
    thread(color.c, [cx + dx - 2, m0 - 15], [cx + dx + 3, m0 + 19], '#0c0906', 3.2);
    thread(surface.c, [cx + dx - 2, m0 - 15], [cx + dx + 3, m0 + 19], 'rgb(230,220,0)', 3);
  }
  // the seam over the crown, and the one down the back
  sew(cx + 4, 0, cx - 8, 150, 8, 9);
  sew(cx - 505, 40, cx - 505, 420, 20, 8);

  const material = new MeshStandardMaterial({
    map: textureOf(color.canvas, true),
    bumpMap: textureOf(surface.canvas, false),
    roughnessMap: textureOf(surface.canvas, false),
    roughness: 1,
    bumpScale: 1.1,
    emissive: new Color(0xffffff),
    emissiveMap: textureOf(paint.canvas, true),
    emissiveIntensity: 0.12,
  });
  return material;
}

/** White hair through the seams of the sack: long fine strands down the side, and a short tuft by the hat. Never at the chin. */
function tuftGeometry(): BufferGeometry {
  const random = randomFrom(44);
  const positions: number[] = [];
  const index: number[] = [];
  const SEGMENTS = 6;
  const p = new Vector3();
  const across = new Vector3();
  const strand = (place: (t: number, out: Vector3) => void, wide: number) => {
    across.set(random() - 0.5, random() * 0.2, random() - 0.5).normalize();
    const base = positions.length / 3;
    for (let k = 0; k <= SEGMENTS; k++) {
      const t = k / SEGMENTS;
      const w = wide * (1 - t * 0.75);
      place(t, p);
      positions.push(p.x - across.x * w, p.y - across.y * w, p.z - across.z * w);
      positions.push(p.x + across.x * w, p.y + across.y * w, p.z + across.z * w);
      if (k < SEGMENTS) {
        const b = base + k * 2;
        index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
  };
  for (let s = 0; s < 44; s++) {
    const side = s < 32 ? -1 : 1;
    const x = side * (0.062 + random() * 0.03);
    const y = 0.05 + random() * 0.06;
    const z = -0.065 + random() * 0.07;
    const long = side < 0 ? 0.15 + random() * 0.17 : 0.09 + random() * 0.1;
    const out = 0.012 + random() * 0.014;
    const drift = (random() - 0.5) * 0.045;
    const curl = random() * 6;
    strand((t, o) => {
      o.set(x + side * (out * Math.sin(t * 2.2) + 0.008 * t) + Math.sin(t * 5 + curl) * 0.004 * t, y - long * t, z + drift * t);
    }, 0.0012);
  }
  for (let s = 0; s < 26; s++) {
    const side = s % 3 === 0 ? 1 : -1;
    const x = side * (0.022 + random() * 0.058);
    const y = 0.112 + random() * 0.02;
    const z = -0.045 + random() * 0.06;
    const long = 0.05 + random() * 0.05;
    const ox = side * (0.5 + random() * 0.5);
    const oz = (random() - 0.5) * 0.7;
    strand((t, o) => {
      o.set(x + ox * long * t, y + 0.6 * long * t - long * t * t * 1.05, z + oz * long * t);
    }, 0.0022);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** The table's cloth as one sheet, falling over the edges with folds. */
function clothGeometry(): BufferGeometry {
  const halfL = (TABLE_NEAR - TABLE_FAR) / 2;
  const midZ = (TABLE_NEAR + TABLE_FAR) / 2;
  const sheetW = TABLE_HALF * 2 + CLOTH_DROP * 2;
  const sheetL = halfL * 2 + CLOTH_DROP * 2;
  const NX = 24;
  const NZ = 120;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const px = (i / NX - 0.5) * sheetW;
      const pz = (j / NZ - 0.5) * sheetL;
      const ox = Math.max(0, Math.abs(px) - TABLE_HALF);
      const oz = Math.max(0, Math.abs(pz) - halfL);
      const hang = Math.hypot(ox, oz);
      const along = ox > oz ? pz : px;
      const folds = (Math.sin(along * 21 + Math.sin(along * 6 + 1.2) * 1.5) * 0.011 + Math.sin(along * 47 + 0.4) * 0.004) * smooth(clamp(hang / CLOTH_DROP, 0, 1));
      const x = Math.sign(px) * (Math.min(Math.abs(px), TABLE_HALF) + (ox > 0 ? 0.009 + (ox >= oz ? folds : 0) : 0));
      const z = midZ + Math.sign(pz) * (Math.min(Math.abs(pz), halfL) + (oz > 0 ? 0.009 + (oz > ox ? folds : 0) : 0));
      const y = TABLE_TOP + 0.004 - hang * 0.98 + (hang === 0 ? Math.sin(px * 9 + 1) * Math.sin(pz * 5) * 0.0015 : 0);
      positions.push(x, y, z);
      uvs.push(i / NX, 1 - j / NZ);
    }
  }
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      const b = a + NX + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** An old cloth, washed and stained, with the rings of other evenings. */
function clothMap(): CanvasTexture {
  const { canvas, c } = surfaceCanvas(512, 2048);
  const random = randomFrom(17);
  c.fillStyle = '#8f8673';
  c.fillRect(0, 0, 512, 2048);
  // a faded woven stripe along both edges
  c.fillStyle = 'rgba(96,58,44,0.3)';
  for (const x of [60, 72, 92, 420, 440, 452]) c.fillRect(x, 0, 5, 2048);
  // ironed creases
  c.fillStyle = 'rgba(60,52,40,0.14)';
  for (let i = 1; i < 7; i++) c.fillRect(0, (i * 2048) / 7, 512, 3);
  c.fillRect(255, 0, 3, 2048);
  for (let i = 0; i < 2200; i++) {
    c.fillStyle = `rgba(${random() < 0.5 ? '255,250,235' : '40,32,22'},${0.02 + random() * 0.05})`;
    c.fillRect(random() * 512, random() * 2048, 1 + random() * 3, 1 + random() * 3);
  }
  for (let i = 0; i < 46; i++) {
    const x = 70 + random() * 372;
    const y = random() * 2048;
    const r = 16 + random() * 46;
    if (random() < 0.55) {
      c.strokeStyle = `rgba(74,48,28,${0.14 + random() * 0.26})`;
      c.lineWidth = 1 + random() * 3;
      c.beginPath();
      c.arc(x, y, r * 0.6, random() * 6, random() * 6 + 5);
      c.stroke();
    } else {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      const red = random() < 0.3;
      g.addColorStop(0, red ? 'rgba(92,20,20,0.42)' : 'rgba(70,50,30,0.3)');
      g.addColorStop(0.75, red ? 'rgba(92,20,20,0.24)' : 'rgba(70,50,30,0.17)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  const t = textureOf(canvas, true);
  return t;
}

/** The damp of a living room nobody has opened: blooms, runs, a ring round the lamp, specks. Four cells of one image. */
function grimeAtlas(): CanvasTexture {
  const size = 1024;
  const half = size / 2;
  const { canvas, c } = surfaceCanvas(size, size);
  const random = randomFrom(9);
  const blot = (x: number, y: number, r: number, alpha: number, tone: string) => {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${tone},${alpha})`);
    g.addColorStop(0.7, `rgba(${tone},${alpha * 0.55})`);
    g.addColorStop(1, `rgba(${tone},0)`);
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, r, 0, 7);
    c.fill();
  };
  const near = () => (random() + random() + random()) / 3;
  for (let i = 0; i < 110; i++) blot(half * near(), half * near(), 18 + random() * 76, 0.04 + random() * 0.12, random() < 0.7 ? '6,10,8' : '26,18,10');
  for (let i = 0; i < 54; i++) {
    const x = half + 40 + random() * (half - 80);
    const long = 60 + random() * 400;
    const g = c.createLinearGradient(0, 0, 0, long);
    g.addColorStop(0, `rgba(8,8,6,${0.2 + random() * 0.3})`);
    g.addColorStop(1, 'rgba(8,8,6,0)');
    c.fillStyle = g;
    c.fillRect(x, 8, 1 + random() * 7, long);
  }
  for (let ring = 0; ring < 6; ring++) {
    c.strokeStyle = `rgba(30,20,10,${0.12 + random() * 0.18})`;
    c.lineWidth = 3 + random() * 8;
    c.beginPath();
    for (let a = 0; a <= 90; a++) {
      const t = (a / 90) * Math.PI * 2;
      const r = (60 + ring * 28) * (1 + 0.1 * Math.sin(t * 3 + ring) + 0.05 * Math.sin(t * 8 + ring * 2));
      c.lineTo(half / 2 + Math.cos(t) * r, half * 1.5 + Math.sin(t) * r);
    }
    c.stroke();
  }
  for (let i = 0; i < 40; i++) blot(half / 2 + (near() - 0.5) * 300, half * 1.5 + (near() - 0.5) * 300, 20 + random() * 60, 0.05 + random() * 0.07, '24,18,10');
  for (let i = 0; i < 900; i++) {
    c.fillStyle = `rgba(6,8,6,${0.1 + random() * 0.4})`;
    c.fillRect(half + half * near() - 6, half + half * near() - 6, 1 + random() * 5, 1 + random() * 5);
  }
  return textureOf(canvas, true);
}

/** Paper chains from `from` to `to` with a sag: real links in faded colors, one draw. */
function paperChains(runs: readonly (readonly [V3, V3, number])[]): InstancedMesh {
  const random = randomFrom(5);
  const PAPER = ['#8c2f26', '#ad8a3c', '#2f6a66', '#c7bda5', '#6e3b5c'].map((c) => new Color(c));
  const LINK = 0.058;
  const placed: { p: Vector3; t: Vector3; roll: boolean; color: Color }[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const at = (from: V3, to: V3, sag: number, u: number, out: Vector3) => out.set(lerp(from[0], to[0], u), lerp(from[1], to[1], u) - sag * 4 * u * (1 - u), lerp(from[2], to[2], u));
  for (const [from, to, sag] of runs) {
    const long = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const n = Math.ceil(long / LINK);
    let last = random() * 5;
    for (let i = 0; i < n; i++) {
      at(from, to, sag, i / n, a);
      at(from, to, sag, (i + 1) / n, b);
      last += 1 + Math.floor(random() * 2);
      placed.push({ p: a.clone(), t: b.clone().sub(a).normalize(), roll: i % 2 === 0, color: PAPER[Math.floor(last) % PAPER.length] });
    }
  }
  const mesh = new InstancedMesh(new CylinderGeometry(0.033, 0.033, 0.024, 9, 1, true), new MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, side: DoubleSide }), placed.length);
  const m = new Matrix4();
  const n = new Vector3();
  const axis = new Vector3();
  const other = new Vector3();
  const stretched = new Vector3();
  placed.forEach((l, i) => {
    n.crossVectors(l.t, UP).normalize();
    if (l.roll) axis.copy(n);
    else axis.crossVectors(n, l.t).normalize();
    other.crossVectors(l.t, axis).normalize();
    stretched.copy(l.t).multiplyScalar(1.4);
    m.makeBasis(stretched, axis, other).setPosition(l.p);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, l.color);
  });
  mesh.frustumCulled = false;
  return mesh;
}

/** Soft dark rounds under things [x, z, radius], one mesh (only the key light casts). */
function discMesh(spots: readonly (readonly [number, number, number])[], strength: number): Mesh {
  const { canvas, c } = surfaceCanvas(128, 128);
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, `rgba(0,0,0,${strength})`);
  g.addColorStop(0.55, `rgba(0,0,0,${strength * 0.6})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  spots.forEach(([x, z, r], i) => {
    positions.push(x - r, 0.009, z - r, x + r, 0.009, z - r, x + r, 0.009, z + r, x - r, 0.009, z + r);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    index.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

/** The flames: a quad each that faces the eye; after the flame the same quad is the thread of smoke. A function of the room's clock. */
function flameLayer(at: readonly Vector3[], deaths: readonly number[]): { mesh: Mesh; uniforms: { uSeconds: { value: number }; uTime: { value: number }; uLevel: { value: number }; uSmoke: { value: Color } } } {
  const plane = new PlaneGeometry(1, 1);
  const g = new InstancedBufferGeometry();
  g.index = plane.index;
  g.setAttribute('position', plane.getAttribute('position'));
  g.setAttribute('uv', plane.getAttribute('uv'));
  g.instanceCount = at.length;
  const pos = new Float32Array(at.length * 3);
  at.forEach((p, i) => p.toArray(pos, i * 3));
  g.setAttribute('aPos', new InstancedBufferAttribute(pos, 3));
  g.setAttribute('aDeath', new InstancedBufferAttribute(new Float32Array(deaths), 1));
  const random = randomFrom(3);
  g.setAttribute('aSeed', new InstancedBufferAttribute(new Float32Array(at.map(() => random())), 1));
  const uniforms = { uSeconds: { value: 0 }, uTime: { value: 0 }, uLevel: { value: 1 }, uSmoke: { value: new Color() } };
  const mesh = new Mesh(
    g,
    new ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: `
        uniform float uSeconds;
        attribute vec3 aPos; attribute float aDeath; attribute float aSeed;
        varying vec2 vUv; varying float vLife; varying float vSeed; varying float vAge;
        void main() {
          vLife = clamp((aDeath - uSeconds) / ${FLAME_DIES.toFixed(3)}, 0.0, 1.0);
          vAge = uSeconds - aDeath;
          vUv = uv; vSeed = aSeed;
          if (vAge > 3.2) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vec4 center = modelViewMatrix * vec4(aPos, 1.0);
          if (vAge > 0.0) center.xy += vec2(position.x * 0.12, (position.y + 0.5) * (0.06 + vAge * 0.24));
          else center.xy += position.xy * 0.14;
          gl_Position = projectionMatrix * center;
        }`,
      fragmentShader: `
        uniform float uTime; uniform float uLevel; uniform vec3 uSmoke;
        varying vec2 vUv; varying float vLife; varying float vSeed; varying float vAge;
        void main() {
          if (vAge > 0.0) {
            float y = vUv.y;
            float wander = sin(y * 9.0 + vAge * 1.4 + vSeed * 30.0) * 0.14 * y + sin(y * 21.0 + vSeed * 50.0 - vAge) * 0.04 * y;
            float d = abs(vUv.x - 0.5 - wander);
            float a = (1.0 - smoothstep(0.0, 0.012 + y * 0.08, d)) * (1.0 - vAge / 3.2) * (1.0 - y) * smoothstep(0.0, 0.06, y);
            gl_FragColor = vec4(uSmoke * a, 1.0);
            return;
          }
          vec2 p = vUv - vec2(0.5, 0.34);
          float lean = sin(uTime * 3.1 + vSeed * 40.0) * 0.016 + sin(uTime * 5.3 + vSeed * 91.0) * 0.008;
          p.x -= lean * smoothstep(0.0, 0.3, p.y);
          float tall = 0.24 * (0.9 + 0.1 * sin(uTime * 4.1 + vSeed * 17.0)) * vLife;
          float y = p.y / max(tall, 0.001);
          float wide = 0.055 * vLife * pow(clamp(y, 0.0, 1.0), 0.55) * pow(clamp(1.0 - y, 0.0, 1.0), 0.8) * 2.3;
          float d = abs(p.x) / max(wide, 0.0005);
          float body = step(0.0, y) * step(y, 1.0) * (1.0 - smoothstep(0.35, 1.0, d));
          vec3 tint = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.82, 0.48), 1.0 - smoothstep(0.1, 1.0, d));
          tint = mix(vec3(0.18, 0.28, 0.85), tint, smoothstep(0.02, 0.2, y));
          vec2 g = p - vec2(0.0, tall * 0.4);
          float halo = exp(-dot(g, g) * 70.0) * 0.1 * vLife;
          gl_FragColor = vec4((tint * body * 3.0 + vec3(1.0, 0.5, 0.18) * halo) * uLevel, 1.0);
        }`,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return { mesh, uniforms };
}

/** One hand-cut flag banner: paper flags on a string. */
function drawBanner(text: string): (c: Ctx, w: number, h: number) => void {
  return (c, w, h) => {
    const letters = [...text];
    const fw = w / letters.length;
    const random = randomFrom(text.length * 7);
    c.clearRect(0, 0, w, h);
    letters.forEach((ch, i) => {
      if (ch === ' ') return;
      const x = i * fw;
      c.save();
      c.translate(x + fw / 2, h * 0.05);
      c.rotate((random() - 0.5) * 0.09);
      c.fillStyle = '#c9bd9f';
      c.beginPath();
      c.moveTo(-fw * 0.45, 0);
      c.lineTo(fw * 0.45, 0);
      c.lineTo(fw * 0.45, h * 0.86);
      c.lineTo(0, h * 0.7);
      c.lineTo(-fw * 0.45, h * 0.86);
      c.closePath();
      c.fill();
      for (let k = 0; k < 18; k++) {
        c.fillStyle = `rgba(52,34,18,${0.05 + random() * 0.16})`;
        c.fillRect((random() - 0.5) * fw * 0.88, random() * h * 0.7, 2 + random() * 14, 1 + random() * 9);
      }
      c.fillStyle = '#6a150f';
      c.font = `700 ${Math.round(h * 0.52)}px Georgia, 'Times New Roman', serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(ch, (random() - 0.5) * 3, h * 0.34, fw * 0.82);
      c.restore();
    });
    c.strokeStyle = '#cfc6ae';
    c.lineWidth = Math.max(2, h * 0.02);
    c.beginPath();
    c.moveTo(0, h * 0.05);
    c.lineTo(w, h * 0.05);
    c.stroke();
  };
}

/** A child's crayon drawing of a table: everyone smiling, and one of them scribbled out. */
function drawCrayon(c: Ctx, w: number, h: number): void {
  const random = randomFrom(23);
  c.fillStyle = '#b7ac92';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 220; i++) {
    c.fillStyle = `rgba(70,50,30,${0.02 + random() * 0.08})`;
    c.fillRect(random() * w, random() * h, 2 + random() * 12, 2 + random() * 12);
  }
  const crayon = (color: string, width: number, pts: readonly (readonly [number, number])[]) => {
    for (let pass = 0; pass < 3; pass++) {
      c.strokeStyle = color;
      c.lineWidth = width;
      c.globalAlpha = 0.6;
      c.beginPath();
      for (const [x, y] of pts) c.lineTo(x * w + (random() - 0.5) * width * 1.4, y * h + (random() - 0.5) * width * 1.4);
      c.stroke();
    }
    c.globalAlpha = 1;
  };
  // the table
  crayon('#5a2c14', 7, [[0.12, 0.66], [0.88, 0.66], [0.88, 0.74], [0.12, 0.74], [0.12, 0.66]]);
  crayon('#5a2c14', 7, [[0.2, 0.74], [0.2, 0.93]]);
  crayon('#5a2c14', 7, [[0.8, 0.74], [0.8, 0.93]]);
  const person = (x: number, gone: boolean) => {
    if (gone) {
      for (let i = 0; i < 90; i++) crayon('#111', 6, [[x + (random() - 0.5) * 0.16, 0.26 + random() * 0.38], [x + (random() - 0.5) * 0.16, 0.26 + random() * 0.38]]);
      return;
    }
    const pts: [number, number][] = [];
    for (let a = 0; a <= 16; a++) pts.push([x + Math.cos((a / 16) * 6.3) * 0.075, 0.38 + Math.sin((a / 16) * 6.3) * 0.06]);
    crayon('#27333a', 5, pts);
    crayon('#27333a', 5, [[x, 0.44], [x, 0.65]]);
    crayon('#c31a10', 9, [[x - 0.085, 0.37], [x - 0.04, 0.41], [x + 0.04, 0.41], [x + 0.085, 0.37]]);
    crayon('#111', 7, [[x - 0.028, 0.35], [x - 0.024, 0.355]]);
    crayon('#111', 7, [[x + 0.024, 0.35], [x + 0.028, 0.355]]);
  };
  person(0.22, false);
  person(0.41, false);
  person(0.6, false);
  person(0.79, true);
}

/** A faded portrait in a dark frame, with the face scratched away. */
function drawPortrait(seed: number): (c: Ctx, w: number, h: number) => void {
  return (c, w, h) => {
    const random = randomFrom(seed);
    c.fillStyle = '#17110c';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#5b4f3c';
    c.fillRect(w * 0.08, h * 0.07, w * 0.84, h * 0.86);
    const g = c.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, h * 0.6);
    g.addColorStop(0, 'rgba(165,145,108,0.8)');
    g.addColorStop(1, 'rgba(40,30,20,0.9)');
    c.fillStyle = g;
    c.fillRect(w * 0.08, h * 0.07, w * 0.84, h * 0.86);
    c.fillStyle = 'rgba(32,26,20,0.92)';
    c.beginPath();
    c.ellipse(w / 2, h * 0.86, w * 0.3, h * 0.28, 0, 0, 7);
    c.fill();
    c.beginPath();
    c.ellipse(w / 2, h * 0.38, w * 0.13, h * 0.13, 0, 0, 7);
    c.fill();
    for (let i = 0; i < 70; i++) {
      c.strokeStyle = `rgba(200,190,165,${0.2 + random() * 0.4})`;
      c.lineWidth = 1 + random() * 2;
      const x = w / 2 + (random() - 0.5) * w * 0.24;
      const y = h * 0.38 + (random() - 0.5) * h * 0.22;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + (random() - 0.5) * w * 0.2, y + (random() - 0.5) * h * 0.15);
      c.stroke();
    }
  };
}

/** A prop of the room gone darker. */
function darkened(object: Object3D, k: number): Object3D {
  object.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const own = (mesh.material as MeshStandardMaterial).clone();
    own.color.multiplyScalar(k);
    mesh.material = own;
  });
  return object;
}

/**
 * The cake's own scan, kept only between two angles round its axis: `wedge` is where that begins and how far
 * round it goes (rad, atan2(x, z) in the scan's frame). Every piece shares one program.
 */
function wedgeMaterial(source: MeshStandardMaterial, wedge: Vector2): MeshStandardMaterial {
  const material = source.clone();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWedge = { value: wedge };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRound;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRound = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uWedge;\nvarying vec2 vRound;')
      .replace('void main() {', 'void main() {\n  if (mod(atan(vRound.x, vRound.y) - uWedge.x, 6.2831853) > uWedge.y) discard;');
  };
  material.customProgramCacheKey = () => 'party-cake-wedge';
  return material;
}

/**
 * The faces where a knife went through the cake, in its scan's frame: at angle `a`, facing round toward larger
 * angles (`side` 1) or smaller (-1), from its bottom up to the top it has there (found by dropping rays on it,
 * so the face fits the scan). `v` runs down from the top, so the frosting follows it.
 */
function cutFaces(mesh: Mesh, cuts: readonly (readonly [number, number])[], ray: Raycaster): { geometry: BufferGeometry; inner: number; outer: number } {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox!;
  const rim = Math.max(box.max.x, box.max.z, -box.min.x, -box.min.z);
  const height = box.max.y - box.min.y;
  const down = new Vector3(0, -1, 0);
  const p = new Vector3();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  let inner = rim;
  let outer = 0;
  for (const [a, side] of cuts) {
    const tops: number[] = [];
    for (let i = 0; i <= CUT_SAMPLES; i++) {
      const r = (rim * i) / CUT_SAMPLES;
      mesh.localToWorld(p.set(Math.sin(a) * r, box.max.y + 0.2, Math.cos(a) * r));
      ray.set(p, down);
      const hit = ray.intersectObject(mesh, false)[0];
      const y = hit ? mesh.worldToLocal(hit.point).y : -Infinity;
      tops.push(y > box.min.y + height * 0.1 ? y : NaN);
    }
    const nx = side * Math.cos(a);
    const nz = -side * Math.sin(a);
    for (let i = 0; i < CUT_SAMPLES; i++) {
      if (Number.isNaN(tops[i]) || Number.isNaN(tops[i + 1])) continue;
      const r0 = (rim * i) / CUT_SAMPLES;
      const r1 = (rim * (i + 1)) / CUT_SAMPLES;
      inner = Math.min(inner, r0);
      outer = Math.max(outer, r1);
      const base = positions.length / 3;
      for (const [r, y, top] of [[r0, box.min.y, tops[i]], [r1, box.min.y, tops[i + 1]], [r1, tops[i + 1], tops[i + 1]], [r0, tops[i], tops[i]]] as const) {
        positions.push(Math.sin(a) * r, y, Math.cos(a) * r);
        normals.push(nx, 0, nz);
        uvs.push(r / rim, 1 - (top - y) / height);
      }
      // counter-clockwise from the side that looks toward smaller angles
      if (side < 0) index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else index.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return { geometry, inner, outer };
}

/** Inside the cake where it was cut, read from the top down: its frosting, carrot sponge, a line of cream, the darker bottom. */
function spongeMap(): CanvasTexture {
  const { canvas, c } = surfaceCanvas(256, 256);
  const random = randomFrom(61);
  const g = c.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#b47c45');
  g.addColorStop(0.85, '#a26c3a');
  g.addColorStop(1, '#6e4626');
  c.fillStyle = g;
  c.fillRect(0, 0, 256, 256);
  // crumb, carrot and nut
  for (let i = 0; i < 2400; i++) {
    const k = random();
    c.fillStyle = k < 0.55 ? `rgba(48,26,12,${0.2 + random() * 0.35})` : k < 0.85 ? `rgba(170,110,60,${0.2 + random() * 0.3})` : `rgba(196,92,30,${0.4 + random() * 0.4})`;
    c.fillRect(random() * 256, 40 + random() * 216, 1 + random() * 3, 1 + random() * 2.5);
  }
  // the cream between the layers, never quite level
  const band = (y: number, thick: number, fill: string) => {
    c.fillStyle = fill;
    c.beginPath();
    for (let x = 0; x <= 256; x += 8) c.lineTo(x, y + Math.sin(x * 0.05 + y) * 2 + (random() - 0.5) * 2);
    for (let x = 256; x >= 0; x -= 8) c.lineTo(x, y + thick + Math.sin(x * 0.07 + y) * 2 + (random() - 0.5) * 2);
    c.closePath();
    c.fill();
  };
  band(-4, 42, '#e6dcc6');
  band(37, 3, 'rgba(90,52,24,0.6)');
  band(120, 16, '#ddd2b9');
  return textureOf(canvas, true);
}

/** What a fork leaves of a slice on a plate: frosting dragged round, and crumbs. */
function crumbMap(): CanvasTexture {
  const { canvas, c } = surfaceCanvas(128, 128);
  const random = randomFrom(83);
  c.lineCap = 'round';
  c.strokeStyle = 'rgba(222,210,186,0.9)';
  c.lineWidth = 7;
  c.beginPath();
  c.arc(62, 70, 28, 3.7, 5.3);
  c.stroke();
  c.lineWidth = 3;
  c.beginPath();
  c.arc(66, 64, 20, 3.9, 5.0);
  c.stroke();
  for (let i = 0; i < 70; i++) {
    c.fillStyle = `rgba(${110 + Math.floor(random() * 40)},${62 + Math.floor(random() * 25)},${30 + Math.floor(random() * 15)},${0.7 + random() * 0.3})`;
    c.beginPath();
    c.arc(64 + (random() - 0.5) * 76, 66 + (random() - 0.5) * 64, 1 + random() * 3.2, 0, 7);
    c.fill();
  }
  return textureOf(canvas, true);
}

/** Flat pictures laid on things [x, y, z, turn], one mesh. */
function decalMesh(spots: readonly (readonly [number, number, number, number])[], size: number, material: MeshStandardMaterial): Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  const h = size / 2;
  spots.forEach(([x, y, z, turn], i) => {
    const c = Math.cos(turn) * h;
    const s = Math.sin(turn) * h;
    positions.push(x - c - s, y, z + s - c, x + c - s, y, z - s - c, x + c + s, y, z - s + c, x - c + s, y, z + s + c);
    uvs.push(0, 1, 1, 1, 1, 0, 0, 0);
    index.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

/** Where the fall of the light has got to at second `s`. */
function dipAt(s: number): number {
  let d = 0;
  for (let i = 0; i < HOP_AT.length; i++) {
    const x = s - HOP_AT[i];
    if (x > -DIP_IN && x < DIP_OUT) d = Math.max(d, x < 0 ? 1 + x / DIP_IN : 1 - x / DIP_OUT);
  }
  return smooth(d);
}

/** Lens focus through the room [second, meters]. */
const FOCUS_AT: readonly (readonly [number, number])[] = [[0, 6.4], [19.6, 4.3], [21.4, 2.6], [26, 3.1], [33.6, 0.84], [T_GONE, 0.84], [T_LAMP - 0.4, END_FOCUS]];

function focusAt(s: number): number {
  for (let i = 1; i < FOCUS_AT.length; i++) {
    if (s < FOCUS_AT[i][0]) return lerp(FOCUS_AT[i - 1][1], FOCUS_AT[i][1], smooth(range(FOCUS_AT[i - 1][0], FOCUS_AT[i][0], s)));
  }
  return FOCUS_AT[FOCUS_AT.length - 1][1];
}

/** Him in one chair: his body, his head, his hat, his horn on the table before him. */
interface Dress {
  body: Matrix4;
  head: Matrix4;
  hat: Matrix4;
  horn: Matrix4;
}

/** Things of the table, each crowd with a matrix for each of its copies. */
type Placing = readonly (readonly [PropCrowd, readonly Matrix4[]])[];

const OPEN = { look: true, scroll: true };
const HELD = { look: true, scroll: false };

/**
 * Your birthday. A long table in a dark living room, thirty-three candles the only light, and at the far end a
 * stitched sack with a painted mouth too wide. It is never seen moving: under each candle that goes out, or the
 * moment you look away, it is in another chair, a chair nearer. When the last candle has gone the party happens
 * in the dark, all round you, and is only heard; and when the room's own lamp comes on it is over. Everyone
 * came: the chairs pushed back, the hats on the floor, the cake cut. Your slice is on your plate.
 */
export default class Party extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x060909, density: 0.045 },
    env: 'evening',
    envIntensity: ENV_CANDLE,
    sky: 0,
    grade: { exposure: EXPOSURE_FULL, saturation: 0.82, warmth: 0.05, tint: -0.02, flare: 0.004 },
  };
  film = { bloom: 0.55, bloomFrom: 0.85, grain: 0.42, scratches: 0.08, flicker: 0.02, weave: 0.0005 };
  focus = 6.4;
  aperture = 6;
  drift = 0.55;

  private readonly cakeLight: DreamLight;
  private readonly bounce: DreamLight;
  private readonly faceFill: DreamLight;
  private readonly reach: DreamLight;
  private readonly lampLight: DreamLight;
  private readonly lampFill: DreamLight;
  private readonly cakeSpot: SpotSpec;
  private readonly wallSpot: SpotSpec;
  private readonly lampSpot: SpotSpec;
  private readonly candleSpots: readonly (SpotSpec | null)[];
  private readonly lampSpots: readonly (SpotSpec | null)[];
  private readonly globe: MeshStandardMaterial;
  private readonly flames: ReturnType<typeof flameLayer>;
  private readonly smokeBase = new Color(0.6, 0.56, 0.5);
  private readonly deaths: readonly number[];
  private readonly halo: Color;
  private readonly haloBase = new Color();
  private readonly ember: Mesh;
  private readonly emberColor: Color;
  private readonly balloons: PropCrowd;
  private readonly balloonData: { x: number; z: number; y: number; from: number; rate: number; rest: number; turn: number; size: number; phase: number }[] = [];
  private readonly hang: Mesh;
  private readonly hub: Object3D | null;
  private readonly nearHorn: Object3D;
  private readonly motes: { time: { value: number }; color: Color; base: Color };

  private readonly body: Crowd;
  private readonly headMaterial: MeshStandardMaterial;
  private readonly heroHead: Mesh;
  private readonly hats: PropCrowd;
  private readonly horns: PropCrowd;
  private readonly seatPlans: Dress[];
  private readonly placesCount: number;

  /** The table laid, and as they left it (see `clear`). */
  private readonly laid: Placing;
  private readonly left: Placing;
  /** What only the end has: the cut cake's faces, your slice, the crumbs, the chairs' new shadows; and the shadows they had. */
  private readonly aftermath: readonly Object3D[];
  private readonly laidShadows: Mesh;
  /** How much of the cake on its stand is still there (see wedgeMaterial). */
  private readonly cakeWedge: Vector2;

  private seat = 0;
  private after = false;
  private shadowFrames = 0;
  private creak = 0;
  private organ: RoomVoice | null = null;
  private crackle: RoomVoice | null = null;
  private drone: RoomVoice | null = null;
  private rub: RoomVoice | null = null;
  private breath: RoomVoice | null = null;

  constructor(ctx: RoomContext) {
    super(ctx);
    const pace = (s: number) => s / ctx.seconds;
    const pass: V3 = [1.25, 1.5, -0.9];
    const [ex, ey, ez] = EYE_END;
    this.keys = [
      { t: 0, at: [0, 1.5, 0.62], yaw: 0, pitch: -2.5, fov: 30 },
      { t: pace(6), at: [0, 1.5, 0.5], yaw: 0, pitch: -2.5, fov: 30 },
      { t: pace(11), at: [0.4, 1.5, 0.46], yaw: 3, pitch: -3, fov: 35 },
      { t: pace(15), at: [1.02, 1.5, 0.1], yaw: 11, pitch: -4, fov: 41 },
      { t: pace(19.6), at: pass, yaw: 20, pitch: -5, fov: 44 },
      { t: pace(20.4), at: pass, yaw: 20, pitch: -5, fov: 44 },
      { t: pace(22.7), at: pass, yaw: 20 + TURN_YAW * 0.87, pitch: -15, fov: 46 },
      { t: pace(24.7), at: pass, yaw: 20 + TURN_YAW * 0.84, pitch: -13, fov: 46 },
      { t: pace(27), at: [1.25, 1.5, -0.98], yaw: 24, pitch: -6, fov: 46 },
      { t: pace(33.6), at: [ex, ey, ez], yaw: 37, pitch: -11, fov: 48 },
      { t: pace(T_GONE), at: [ex, ey, ez], yaw: 37, pitch: -11, fov: 46 },
      // in the black the eye goes back to where it came in, so that the lamp finds the first picture emptied
      { t: pace(T_LAMP - 0.6), at: HOME, yaw: 0, pitch: HOME_PITCH, fov: HOME_FOV },
      { t: 1, at: HOME_END, yaw: 0, pitch: HOME_PITCH - 1.5, fov: HOME_FOV - 2 },
    ];
    this.fear = 0.3;

    const b = this.build;
    const kit = this.kit;
    const root = this.root;
    const L = Z_BACK - Z_FAR;
    const zMid = (Z_BACK + Z_FAR) / 2;

    // the room: damask, wainscot, boards with a rug, a damp plaster ceiling
    const shell = new Group();
    shell.position.z = Z_BACK;
    root.add(shell);
    b.box(W, L, H, { walls: b.damask(PALETTE.damaskTeal, 0.85), floor: kit.surface('wood_floor_dark', 2), ceiling: kit.surface('plaster_mould', 1.8, { color: new Color(0x8d8f7c) }) }, shell);
    root.add(kit.floor(-W / 2 + 0.55, W / 2 - 0.55, Z_FAR + 0.7, Z_BACK - 0.9, 0.006, kit.surface('carpet_dirty', 0.6, { color: new Color(0x9a6f58) })));
    b.wainscot(W / 2, zMid, L, '-x', root);
    b.wainscot(-W / 2, zMid, L, '+x', root);
    b.wainscot(0, Z_FAR, W, '+z', root);
    b.wainscot(0, Z_BACK, W, '-z', root);
    b.door(-0.6, Z_BACK, '-z', root, { color: 0x1d140e });
    b.door(-W / 2, -5.85, '+x', root, { open: 0.14, beyond: 0x010101, color: 0x1d140e });

    // what the room owns: curtains over its windows, two old portraits, a bare coat stand
    const velvet = kit.surface('velvet_red', 0.3, { color: new Color(0x5e3431) });
    kit.paint(kit.prop('curtains', [W / 2 - 0.07, 0, -5.0], { rotation: [0, -90, 0] }, root), velvet);
    kit.paint(kit.prop('curtains', [-W / 2 + 0.07, 0, -2.6], { rotation: [0, 90, 0] }, root), velvet);
    kit.prop('coat_stand', [0.95, 0, 1.72], {}, root);
    const hang = (x: number, y: number, z: number, heading: number, seed: number) => {
      const portrait = b.label(0.46, 0.6, drawPortrait(seed), { px: 400 }).mesh;
      portrait.position.set(x, y, z);
      portrait.rotation.y = heading;
      root.add(portrait);
    };
    hang(-W / 2 + 0.012, 1.62, -4.7, Math.PI / 2, 2);
    hang(W / 2 - 0.012, 1.6, 0.55, -Math.PI / 2, 5);
    hang(-W / 2 + 0.012, 1.58, 0.45, Math.PI / 2, 8);
    const crayon = b.label(0.36, 0.48, drawCrayon, { px: 640 }).mesh;
    crayon.position.set(0.32, 1.42, Z_BACK - 0.012);
    crayon.rotation.y = Math.PI;
    crayon.rotation.z = 0.03;
    root.add(crayon);

    // the record player, turning on a low table by the wall
    darkened(kit.prop('table_small', [W / 2 - 0.38, 0, -4.2], { rotation: [0, 90, 0] }, root), 0.45);
    const player = kit.prop('gramophone', [W / 2 - 0.42, 0.8, -4.2], { rotation: [0, -90, 0] }, root);
    this.hub = this.findPlatter(player);

    // the table: three trestles end to end under one long cloth
    const tables = kit.props('table_kitchen', 3, { scale: 0.8 });
    for (let i = 0; i < 3; i++) tables.set(i, 0, 0, lerp(TABLE_NEAR - 0.85, TABLE_FAR + 0.85, i / 2), Math.PI / 2);
    tables.commit();
    root.add(tables.root);
    const cloth = new Mesh(clothGeometry(), new MeshStandardMaterial({ map: clothMap(), roughness: 0.92 }));
    cloth.receiveShadow = true;
    root.add(cloth);
    const under = b.contactShadow(0, (TABLE_NEAR + TABLE_FAR) / 2, 1.5, root, 0.8);
    under.scale.y = 2.4;

    // every place laid: a plate, a paper hat, a spoon and a fork, a glass
    const places: { x: number; z: number; side: number }[] = [];
    for (const z of CHAIR_Z) places.push({ x: -0.29, z, side: 1 }, { x: 0.29, z, side: -1 });
    places.push({ x: 0, z: TABLE_FAR + 0.28, side: 0 }, { x: 0, z: TABLE_NEAR - 0.3, side: 2 });
    this.placesCount = places.length;
    const yours = places.length - 1;
    const plates = kit.props('plate', places.length);
    const forks = kit.props('fork', places.length, { rotation: [90, 0, 0] });
    const spoons = kit.props('spoon', places.length, { rotation: [90, 0, 0] });
    this.hats = kit.props('party_hat', places.length + 1 + HATS_DROPPED, { castShadow: true });
    const chairs = kit.props('chair_white', places.length, { castShadow: true });
    const chairSpots: [number, number, number][] = [];
    const random = randomFrom(101);
    const q = new Quaternion();
    const euler = new Euler();
    /** A matrix standing a thing here, turned `heading` about the vertical, as PropCrowd.set does. */
    const placed = (x: number, y: number, z: number, heading: number, scale = 1) => new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(UP, heading), new Vector3(scale, scale, scale));
    const laidPlates: Matrix4[] = [];
    const laidForks: Matrix4[] = [];
    const laidSpoons: Matrix4[] = [];
    const laidHats: Matrix4[] = [];
    const laidChairs: Matrix4[] = [];
    places.forEach((p) => {
      const along = p.side === 0 || p.side === 2;
      const heading = along ? 0 : Math.PI / 2;
      const utensil = 0.155;
      const toward = p.side === 2 ? 1 : p.side === 0 ? -1 : p.side;
      laidPlates.push(placed(p.x, TABLE_TOP + 0.004, p.z, 0));
      if (along) {
        laidForks.push(placed(p.x - utensil, TABLE_TOP + 0.004, p.z, heading));
        laidSpoons.push(placed(p.x + utensil, TABLE_TOP + 0.004, p.z, heading));
      } else {
        laidForks.push(placed(p.x, TABLE_TOP + 0.004, p.z - utensil, heading));
        laidSpoons.push(placed(p.x, TABLE_TOP + 0.004, p.z + utensil, heading));
      }
      q.setFromEuler(euler.set((random() - 0.5) * 0.1, random() * 6, (random() - 0.5) * 0.1, 'YXZ'));
      laidHats.push(new Matrix4().compose(new Vector3(p.x, TABLE_TOP + 0.016, p.z), q, new Vector3(0.9, 0.9, 0.9)));
      const chairX = along ? 0 : -toward * CHAIR_X;
      const chairZ = p.side === 0 ? CHAIR_FAR : p.side === 2 ? CHAIR_NEAR : p.z;
      const chairHeading = p.side === 0 ? 0 : p.side === 2 ? Math.PI : toward > 0 ? Math.PI / 2 : -Math.PI / 2;
      laidChairs.push(placed(chairX + (random() - 0.5) * 0.05, 0, chairZ + (random() - 0.5) * 0.05, chairHeading + (random() - 0.5) * 0.09));
      chairSpots.push([chairX, chairZ, 0.36]);
    });
    darkened(chairs.root, 0.46);
    this.laidShadows = discMesh(chairSpots, 0.66);
    root.add(plates.root, forks.root, spoons.root, chairs.root, this.hats.root, this.laidShadows);

    // the cake, thirty-three candles in two rings on its crest
    const stand = kit.prop('cake_stand', [0, TABLE_TOP + 0.004, CAKE_Z], { scale: 1.7 }, root);
    stand.scale.y *= 0.5;
    const cake = kit.prop('cake', [0, TABLE_TOP + 0.066, CAKE_Z], { scale: 1.7 }, root);
    b.contactShadow(0, CAKE_Z, 0.36, root, 0.7, TABLE_TOP + 0.009);
    root.updateWorldMatrix(true, true);
    const ray = new Raycaster();
    const down = new Vector3(0, -1, 0);
    const cakeTop = TABLE_TOP + 0.066 + 0.098 * 1.7;
    const wicks: Vector3[] = [];
    const bases: Vector3[] = [];
    for (let i = 0; i < CANDLES; i++) {
      const outer = i < 20;
      const n = outer ? 20 : 13;
      const a = ((outer ? i : i - 20) / n) * Math.PI * 2 + (outer ? 0 : 0.24);
      const r = outer ? 0.15 : 0.103;
      const x = Math.sin(a) * r;
      const z = CAKE_Z + Math.cos(a) * r;
      ray.set(this.world(x, 2, z), down);
      const hit = ray.intersectObject(cake, true)[0];
      const y = hit ? hit.point.y - this.origin.y : cakeTop;
      bases.push(new Vector3(x, y - 0.006, z));
      wicks.push(new Vector3(x, y - 0.006 + 0.098 * 1.3 + 0.004, z));
    }
    const candles = kit.props('candle_party', CANDLES, { nodes: ['candle'], scale: 1.3 });
    const laidCandles = bases.map((p, i) => placed(p.x, p.y, p.z, i * 2.4));
    root.add(candles.root);
    // which candle goes when: seeded, so that the last three stand on the side toward the viewer
    const order = DEATHS.slice(0, CANDLES - 3);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const lastThree = [0, 1, 19];
    let taken = 0;
    this.deaths = wicks.map((_, i) => {
      const k = lastThree.indexOf(i);
      return k >= 0 ? DEATHS[CANDLES - 3 + k] : order[taken++];
    });
    this.flames = flameLayer(wicks, this.deaths);
    root.add(this.flames.mesh);
    const haloMesh = b.glow(0, TABLE_TOP + 0.42, CAKE_Z, 1.3, 0xffa45c, 0.19, root);
    this.halo = (haloMesh.material as ShaderMaterial).uniforms.uColor.value as Color;
    this.haloBase.copy(this.halo);
    const lastWick = wicks[this.deaths.indexOf(T_LAST)];
    this.ember = b.glow(lastWick.x, lastWick.y, lastWick.z, 0.045, 0xff4412, 1, root, 1.6);
    this.ember.visible = false;
    this.emberColor = (this.ember.material as ShaderMaterial).uniforms.uColor.value as Color;

    // the only light there is: tied to the count of the flames
    this.cakeLight = this.light([0, TABLE_TOP + 0.5, CAKE_Z], 0xffa35a, CAKE_LIGHT, 8);
    this.bounce = this.light([0.1, TABLE_TOP + 0.22, -2.2], 0xffa35a, BOUNCE_LIGHT, 3.4);
    this.faceFill = this.light([ex - 0.15, 1.12, ez - 0.28], 0xff9a58, 0, 1.4);
    this.reach = this.light([0.2, 1.9, 0.4], 0xffb070, 0, 5.5);
    this.lampLight = this.light([0, 2.0, LAMP_Z], 0xe6dcad, 0, 9);
    this.lampFill = this.light([0.3, 1.95, -0.15], 0xe6dcad, 0, 3.2);
    this.cakeSpot = this.spot([0, TABLE_TOP + 0.52, CAKE_Z - 0.02], [0, 0.45, 0.2], 0xffad66, CAKE_SPOT, 68, 0.75);
    this.wallSpot = this.spot([0, TABLE_TOP + 0.5, CAKE_Z - 0.3], [0, 1.5, Z_FAR], 0xffa45c, WALL_SPOT, 46, 1);
    this.lampSpot = this.spot([0.02, 2.16, LAMP_Z], [0.1, 0, LAMP_Z], 0xe6dcad, 0, 74, 0.9);
    this.candleSpots = [this.cakeSpot, this.wallSpot, null];
    this.lampSpots = [this.lampSpot, null, null];
    this.spots = this.candleSpots;

    // the lamp that has been there all along, unlit
    const lamp = kit.prop('lamp_pendant', [0, H, LAMP_Z], { scale: 0.8, anchor: 'top' }, root);
    let globe: MeshStandardMaterial | null = null;
    lamp.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const own = (mesh.material as MeshStandardMaterial).clone();
      own.emissive = new Color(0xfff0c4);
      own.emissiveIntensity = 0;
      own.envMapIntensity = 0.15;
      own.color.set(0x4a423a);
      mesh.material = own;
      if (/glass|globe/.test(own.name) || !globe) globe = own;
    });
    this.globe = globe!;

    // balloons, sinking along the walls: dark, half gone flat; none comes down in front of you
    const balloonCount = 9;
    this.balloons = kit.props('balloon', balloonCount);
    root.add(this.balloons.root);
    for (const part of this.balloons.root.children) {
      const mesh = part as Mesh;
      const own = (mesh.material as MeshStandardMaterial).clone();
      own.color.multiplyScalar(0.36);
      own.roughness = 0.62;
      own.envMapIntensity = 0.2;
      mesh.material = own;
    }
    for (let i = 0; i < balloonCount; i++) {
      this.balloonData.push({
        x: i % 2 ? -1.45 - random() * 0.8 : 1.75 + random() * 0.45,
        z: -1.3 - random() * 5.2,
        y: H - 0.98 - random() * 0.08,
        from: 6 + random() * 10,
        rate: 0.07 + random() * 0.03,
        rest: -0.62,
        turn: random() * 6,
        size: 0.8 + random() * 0.14,
        phase: random() * 6,
      });
    }

    // paper chains fanning from the lamp, and one that has come down
    const rose: V3 = [0, H - 0.02, LAMP_Z];
    const top = H - 0.05;
    root.add(
      paperChains([
        [rose, [-W / 2 + 0.1, top, Z_BACK - 0.3], 0.5],
        [rose, [W / 2 - 0.1, top, Z_BACK - 0.3], 0.56],
        [rose, [-W / 2 + 0.1, top, Z_FAR + 0.3], 0.5],
        [rose, [W / 2 - 0.1, top, Z_FAR + 0.3], 0.46],
        [rose, [-W / 2 + 0.1, top, LAMP_Z], 0.34],
        [rose, [W / 2 - 0.1, top, LAMP_Z + 0.2], 0.38],
        [[-W / 2 + 0.1, top, -5.4], [-1.36, 1.28, -5.28], 0.04],
      ]),
    );

    // the banner: half of it still says something, half of it has come down
    const [readable, fallen] = BANNER[lang()];
    const reads = [...readable].length * FLAG;
    const banner = b.label(reads, FLAG_H, drawBanner(readable), { px: 300, transparent: true, roughness: 0.95 }).mesh;
    const sag = new PlaneGeometry(reads, FLAG_H, 44, 1);
    const sagP = sag.getAttribute('position');
    for (let i = 0; i < sagP.count; i++) {
      const u = sagP.getX(i) / (reads / 2);
      sagP.setY(i, sagP.getY(i) - 0.07 * (1 - u * u));
    }
    banner.geometry = sag;
    const left = -reads / 2 - 0.2;
    banner.position.set(left + reads / 2, 2.32, Z_FAR + 0.035);
    banner.rotation.z = -0.018;
    root.add(banner);
    const hanging = [...fallen].length * FLAG;
    this.hang = b.label(hanging, FLAG_H, drawBanner(fallen), { px: 300, transparent: true, roughness: 0.95 }).mesh;
    this.hang.geometry.translate(hanging / 2, -FLAG_H * 0.05, 0);
    this.hang.position.set(left + reads, 2.26, Z_FAR + 0.04);
    this.hang.rotation.z = -Math.PI / 2 + 0.05;
    root.add(this.hang);

    // the clown: a man in a dark suit, with a paper hat and a stitched sack for a head
    const sitting = { clip: 'm_sit_chair_idle_roll_head', time: 0.5 };
    const headMark = headOf(kit, 'figure_man', sitting.clip, sitting.time);
    this.body = kit.figures.crowd({ avatar: 'figure_man', clip: sitting.clip, time: sitting.time, face: 'blank', bleach: 0.28, tint: 0x767a82 }, 1);
    for (const part of this.body.root.children) {
      const mesh = part as Mesh;
      mesh.castShadow = true;
      if (/head|opacity/.test((mesh.material as Material).name)) mesh.visible = false;
    }
    root.add(this.body.root);
    this.headMaterial = sackMaterial();
    this.heroHead = new Mesh(sackGeometry(96, 72), this.headMaterial);
    this.heroHead.castShadow = true;
    this.heroHead.frustumCulled = false;
    this.heroHead.morphTargetInfluences = [0];
    root.add(this.heroHead);
    // the white hair through his seams goes where the head goes
    const tufts = new Mesh(tuftGeometry(), new MeshStandardMaterial({ color: 0xd4d0c6, roughness: 0.65, side: DoubleSide }));
    tufts.frustumCulled = false;
    this.heroHead.add(tufts);
    this.horns = kit.props('horn_bulb', 1 + HORNS_LEFT);
    root.add(this.horns.root);

    const dressOf = (x: number, z: number, heading: number, eye: Vector3, seed: number, roll: number, hornAt: readonly [number, number]): Dress => {
      const tilt = randomFrom(seed * 11 + 17);
      const bodyQ = new Quaternion().setFromAxisAngle(UP, heading);
      const feetAt = new Vector3(x, SIT_Y, z);
      const one = new Vector3(1, 1, 1);
      const body = new Matrix4().compose(feetAt, bodyQ, one);
      const headAt = headMark.clone().applyQuaternion(bodyQ).add(feetAt);
      headAt.y += HEAD_UP;
      const headQ = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye, headAt, UP));
      headQ.multiply(new Quaternion().setFromEuler(new Euler(tilt() * 0.12 - 0.04, 0, roll)));
      const head = new Matrix4().compose(headAt, headQ, one);
      const hatQ = headQ.clone().multiply(new Quaternion().setFromEuler(new Euler((tilt() - 0.5) * 0.26, tilt() * 3, (tilt() - 0.5) * 0.3)));
      const hatAt = headAt.clone().add(new Vector3(0.008, HAT_Y, -0.012).applyQuaternion(headQ));
      const hat = new Matrix4().compose(hatAt, hatQ, new Vector3().setScalar(HAT_SCALE));
      const horn = new Matrix4().compose(new Vector3(hornAt[0], TABLE_TOP + 0.003, hornAt[1]), new Quaternion().setFromAxisAngle(UP, x * 1.3 + z), one);
      return { body, head, hat, horn };
    };

    // every chair he passes through, looking at where the viewer will be at that moment
    const seen = { position: new Vector3(), yaw: 0, pitch: 0, roll: 0, fov: 0 };
    this.seatPlans = SEATS.map((s, i) => {
      const at = i === 0 ? 0 : HOP_AT[i - 1];
      this.pose(pace(at + 0.2), seen);
      const eye = seen.position.clone().sub(this.origin);
      const hornX = s.x === 0 ? 0.25 : s.x * 0.34;
      const hornZ = s.x === 0 ? TABLE_FAR + 0.36 : s.z + 0.2;
      return dressOf(s.x, s.z, s.heading, eye, 90 + i, i === LAST_SEAT ? -0.3 : (i % 2 ? 0.12 : -0.1), [hornX, hornZ]);
    });

    // as they left it. Its own seed: everything before it stays as it was.
    const strew = randomFrom(131);
    const spread = (from: number, to: number) => from + strew() * (to - from);
    const probe = kit.prop('plate', [0, 0, 0]);
    probe.updateWorldMatrix(true, true);
    ray.set(new Vector3(0, 1, 0), down);
    const plateFloor = ray.intersectObject(probe, true)[0]?.point.y ?? 0.006;

    // the cake: cut, the gap toward you; your slice on your plate
    const scan = cake.getObjectByProperty('isMesh', true) as Mesh;
    const icing = scan.material as MeshStandardMaterial;
    this.cakeWedge = new Vector2(0, WHOLE);
    scan.material = wedgeMaterial(icing, this.cakeWedge);
    const sponge = new MeshStandardMaterial({ map: spongeMap(), roughness: 0.9 });
    // the faces take shadow as the cloth does, so that they are drawn with its program
    const cakeCuts = new Mesh(cutFaces(scan, [[CAKE_FROM, -1], [CAKE_FROM + CAKE_LEFT, 1]], ray).geometry, sponge);
    cakeCuts.receiveShadow = true;
    scan.add(cakeCuts);
    const slice = kit.prop('cake', [0, 0, 0], { scale: 1.7 }, root);
    const sliceScan = slice.getObjectByProperty('isMesh', true) as Mesh;
    sliceScan.material = wedgeMaterial(icing, new Vector2(-SLICE / 2, SLICE));
    const sliceCut = cutFaces(scan, [[-SLICE / 2, -1], [SLICE / 2, 1]], ray);
    const sliceFaces = new Mesh(sliceCut.geometry, sponge);
    sliceFaces.receiveShadow = true;
    sliceScan.add(sliceFaces);
    // turned on the plate so that its middle sits on the plate's middle
    const middle = ((sliceCut.inner + sliceCut.outer) / 2) * scan.getWorldScale(new Vector3()).x;
    const own = places[yours];
    slice.rotation.y = SLICE_HEADING;
    slice.position.set(own.x - Math.sin(SLICE_HEADING) * middle, TABLE_TOP + 0.004 + plateFloor, own.z - Math.cos(SLICE_HEADING) * middle);
    // the candles of the part that is left stay in it; the others were pulled out and laid by the stand
    const lieDown = new Quaternion().setFromAxisAngle(AXIS_Z, Math.PI / 2);
    const leftCandles = bases.map((p, i) => {
      const round = (((Math.atan2(p.x, p.z - CAKE_Z) - CAKE_FROM) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (round > 0.12 && round < CAKE_LEFT - 0.12) return laidCandles[i];
      return new Matrix4().compose(new Vector3(spread(0.38, 0.43), TABLE_TOP + 0.009, CAKE_Z + spread(0.04, 0.16)), new Quaternion().setFromAxisAngle(UP, spread(-0.5, 0.5)).multiply(lieDown), new Vector3(1, 1, 1));
    });

    // the chairs pushed back and turned as they got up; one or two went over
    const floorTaken: [number, number, number][] = [[W / 2 - 0.38, -4.2, 0.42]];
    for (const d of this.balloonData) floorTaken.push([d.x, d.z, 0.2]);
    const heroHorn = this.seatPlans[LAST_SEAT].horn.elements;
    const clothTaken: [number, number, number][] = [[heroHorn[12], heroHorn[14], 0.17]];
    const chairProbe = kit.prop('chair_white', [0, 0, 0]);
    chairProbe.updateWorldMatrix(true, true);
    const chairBox = new Box3().setFromObject(chairProbe);
    // where a hat left on a seat lies: the top of the seat, a little in front of its middle
    ray.set(new Vector3(0, 2, 0.05), down);
    const seatTop = ray.intersectObject(chairProbe, true)[0]?.point.y ?? 0.45;
    const onSeats: Vector3[] = [];
    const fallBack = new Quaternion().setFromAxisAngle(AXIS_X, -Math.PI / 2);
    const leftChairs: Matrix4[] = [];
    const leftShadows: [number, number, number][] = [];
    const leftPlates: Matrix4[] = [];
    const leftForks: Matrix4[] = [];
    const leftSpoons: Matrix4[] = [];
    const crumbsAt: [number, number, number, number][] = [];
    places.forEach((p, i) => {
      const [cx, cz] = chairSpots[i];
      if (i === yours) {
        // yours, as it was laid: nobody sat in it
        leftChairs.push(laidChairs[i]);
        leftShadows.push(chairSpots[i]);
        leftPlates.push(laidPlates[i]);
        leftForks.push(laidForks[i]);
        leftSpoons.push(laidSpoons[i]);
        return;
      }
      const end = p.side === 0;
      // one that went over fell straight back, clear of its neighbours
      const falls = (FALLEN as readonly number[]).includes(i);
      const push = falls ? PUSH_BACK[0] : spread(PUSH_BACK[0], PUSH_BACK[1]);
      const x = end ? cx + spread(-0.1, 0.1) : cx - p.side * push;
      const z = end ? cz - push : cz + spread(-0.06, 0.06);
      const heading = (end ? 0 : p.side > 0 ? Math.PI / 2 : -Math.PI / 2) + spread(-PUSH_TURN, PUSH_TURN) * (falls ? 0.2 : 1);
      // lying, it reaches from where its feet stood to the top of its back: clear of that strip by half its width
      const reach = new Vector3(0, 0, -chairBox.max.y).applyAxisAngle(UP, heading);
      const clearOf = ([tx, tz, r]: readonly [number, number, number]) => {
        const u = clamp(((tx - x) * reach.x + (tz - z) * reach.z) / reach.lengthSq(), 0, 1);
        return Math.hypot(tx - x - u * reach.x, tz - z - u * reach.z) > r + (chairBox.max.x - chairBox.min.x) / 2;
      };
      if (falls && floorTaken.every(clearOf)) {
        // on its back, its legs toward the table
        leftChairs.push(new Matrix4().compose(new Vector3(x, -chairBox.min.z, z), new Quaternion().setFromAxisAngle(UP, heading).multiply(fallBack), new Vector3(1, 1, 1)));
        leftShadows.push([x + reach.x * 0.5, z + reach.z * 0.5, 0.55]);
        floorTaken.push([x + reach.x * 0.25, z + reach.z * 0.25, 0.3], [x + reach.x * 0.75, z + reach.z * 0.75, 0.3]);
      } else {
        const chair = placed(x, 0, z, heading);
        leftChairs.push(chair);
        leftShadows.push([x, z, 0.36]);
        floorTaken.push([x, z, 0.34]);
        if ((SEAT_HATS as readonly number[]).includes(i)) onSeats.push(new Vector3(0, seatTop, 0.05).applyMatrix4(chair));
      }
      // the plate where it was pushed, what the fork left on it, the fork and the spoon put down anyhow
      const along = p.side === 2 || end;
      const px = p.x + spread(-0.02, 0.02);
      const pz = p.z + spread(-0.02, 0.02);
      leftPlates.push(placed(px, TABLE_TOP + 0.004, pz, strew() * 6));
      crumbsAt.push([px, TABLE_TOP + 0.004 + plateFloor + 0.0012, pz, strew() * 6]);
      const utensil = (side: number) => {
        const off = side * (0.165 + spread(0, 0.025));
        return placed(along ? p.x + off : p.x, TABLE_TOP + 0.004, along ? p.z : p.z + off, (along ? 0 : Math.PI / 2) + spread(-0.35, 0.35));
      };
      leftForks.push(utensil(-1));
      leftSpoons.push(utensil(1));
    });

    // a free place for something `size` across: on the floor out where the lamp reaches, or on the cloth between two places
    const free = (taken: [number, number, number][], size: number, pick: () => readonly [number, number]): readonly [number, number] | null => {
      for (let tries = 0; tries < 60; tries++) {
        const [x, z] = pick();
        if (taken.every(([tx, tz, r]) => Math.hypot(x - tx, z - tz) > r + size)) {
          taken.push([x, z, size]);
          return [x, z];
        }
      }
      return null;
    };
    const floorPick = () => [(strew() < 0.5 ? -1 : 1) * spread(0.95, 2.1), spread(Z_FAR + 0.6, -1.9)] as const;
    const clothPick = () => {
      const row = Math.floor(strew() * (CHAIR_Z.length - 2));
      return [spread(-0.12, 0.12), (CHAIR_Z[row] + CHAIR_Z[row + 1]) / 2 + spread(-0.06, 0.06)] as const;
    };
    const lying = (x: number, y: number, z: number, heading: number) =>
      new Matrix4().compose(new Vector3(x, y + HAT_LIFT * 0.9, z), new Quaternion().setFromAxisAngle(UP, heading).multiply(new Quaternion().setFromAxisAngle(AXIS_X, Math.PI / 2 + HAT_TIP)), new Vector3(0.9, 0.9, 0.9));

    // the hats came off: on the floor, on a seat or two, a couple on the cloth; yours still stands by your plate
    const leftHats: Matrix4[] = [];
    for (let i = 0; i < places.length + 1 + HATS_DROPPED; i++) {
      if (i === yours) {
        leftHats.push(placed(own.x + YOUR_HAT[0], TABLE_TOP + 0.004, own.z + YOUR_HAT[1], 0.4, 0.9));
        continue;
      }
      const seat = i < places.length ? onSeats.pop() : undefined;
      if (seat) {
        leftHats.push(lying(seat.x, seat.y, seat.z, strew() * 6));
        continue;
      }
      // across the table, so that from its head one sees what they are
      const onCloth = i < places.length && strew() < 0.25 ? free(clothTaken, 0.15, clothPick) : null;
      if (onCloth) {
        leftHats.push(lying(onCloth[0], TABLE_TOP + 0.004, onCloth[1], Math.PI / 2 + spread(-0.5, 0.5)));
        continue;
      }
      const [x, z] = free(floorTaken, 0.12, floorPick) ?? floorPick();
      leftHats.push(strew() < 0.8 ? lying(x, 0, z, strew() * 6) : placed(x, 0, z, strew() * 6, 0.9));
    }
    // and the horns were put down: his where he sat, the others on the cloth and the floor
    const leftHorns = [this.seatPlans[LAST_SEAT].horn];
    for (let i = 0; i < HORNS_LEFT; i++) {
      const onCloth = i < 2 ? free(clothTaken, 0.17, clothPick) : null;
      if (onCloth) leftHorns.push(placed(onCloth[0], TABLE_TOP + 0.003, onCloth[1], spread(-0.4, 0.4)));
      else {
        const [x, z] = free(floorTaken, 0.17, floorPick) ?? floorPick();
        leftHorns.push(placed(x, 0, z, strew() * 6));
      }
    }

    const crumbs = decalMesh(crumbsAt, 0.15, new MeshStandardMaterial({ map: crumbMap(), transparent: true, depthWrite: false, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 }));
    const leftShadowMesh = discMesh(leftShadows, 0.66);
    root.add(crumbs, leftShadowMesh);
    this.aftermath = [cakeCuts, slice, crumbs, leftShadowMesh];
    this.laid = [
      [plates, laidPlates],
      [forks, laidForks],
      [spoons, laidSpoons],
      [this.hats, laidHats],
      [chairs, laidChairs],
      [candles, laidCandles],
    ];
    this.left = [
      [plates, leftPlates],
      [forks, leftForks],
      [spoons, leftSpoons],
      [this.hats, leftHats],
      [chairs, leftChairs],
      [candles, leftCandles],
      [this.horns, leftHorns],
    ];
    this.clear(false);

    // on the near chair, for as long as your back was turned to it: the horn
    this.nearHorn = kit.prop('horn_bulb', [0.02, 0.49, CHAIR_NEAR], { rotation: [0, 40, 0] }, root);
    this.nearHorn.visible = false;

    // what the damp has done
    const grime = this.grimeLayer();
    root.add(grime);
    const dust = b.motes(170, { x: [-W / 2 + 0.1, W / 2 - 0.1], y: [0.2, H - 0.2], z: [Z_FAR + 0.1, Z_BACK - 0.1] }, root, { strength: 0.42, size: 0.007 });
    const moteColor = (dust.points.material as ShaderMaterial).uniforms.uColor.value as Color;
    this.motes = { time: dust.time, color: moteColor, base: moteColor.clone() };

    // the beats
    this.beat(0, () => {
      this.drone = this.sound.bed('rooms/dream_drone_low.mp3', { gain: 0.1, fade: 2 });
    });
    this.beat(T_NEEDLE, () => {
      this.sound.play('rooms/needle_drop.mp3', { gain: 0.35, pan: 0.45 });
      this.crackle = this.sound.bed('rooms/record_crackle.mp3', { gain: 0.14, pan: 0.45 });
    });
    this.beat(T_ORGAN, () => {
      this.organ = this.sound.bed('rooms/fairground_organ_slow.mp3', { gain: 0.3, offset: 0, reverb: 0.2, lowpass: 3500, pan: 0.4 });
    });
    this.beat(9, () => {
      this.rub = this.sound.bed('rooms/balloon_rub.mp3', { gain: 0.09, pan: -0.4, reverb: 0.2, fade: 3 });
    });
    this.beat(14, () => this.organ?.pan(0.55, 3));
    DEATHS.forEach((at, i) => {
      // the first two at the honk are lost under it
      if (i === SLOW || i === SLOW + 1) return;
      this.beat(at, () => {
        if (i >= 30) {
          if (i < 32) this.sound.play('rooms/flame_out.mp3', { gain: 0.35, pan: -0.15 });
          return;
        }
        this.sound.play(CANDLE_OUT[i % 4], { gain: at < T_HONK || i > 20 ? 0.55 : 0.28, reverb: 0.15, pan: -0.3 + (i % 5) * 0.14 });
      });
    });
    const squeak = (at: number, n: number, pan: number) => this.beat(at, () => this.sound.play(`rooms/balloon_squeak_${n}.mp3`, { gain: 0.3, reverb: 0.15, pan }));
    squeak(15.9, 1, -0.3);
    squeak(16.4, 3, 0.25);
    squeak(28.6, 2, -0.5);
    squeak(31.2, 4, 0.3);
    squeak(37.1, 2, -0.2);
    // a real silence: the record, the air, all of it, and then the horn behind you
    this.beat(T_QUIET, () => {
      this.organ?.gain(0, 0.6);
      this.crackle?.gain(0, 0.6);
      this.drone?.gain(0, 0.8);
      this.rub?.gain(0, 0.6);
    });
    this.beat(T_HONK, () => this.sound.play('rooms/clown_horn_slow.mp3', { gain: 0.55, reverb: 0.12, pan: -0.35 }));
    this.beat(T_HONK + 2.4, () => {
      this.organ?.gain(0.2, 3);
      this.organ?.pan(0.25, 3);
      this.organ?.rate(0.94, 4);
      this.crackle?.gain(0.14, 1.5);
      this.drone?.gain(0.12, 2);
      this.rub?.gain(0.08, 3);
    });
    this.beat(27, () => this.sound.play('rooms/chair_wood_move.mp3', { gain: 0.35, reverb: 0.3, pan: -0.6 }));
    this.beat(30, () => this.organ?.rate(0.88, 6));
    this.beat(32.6, () => {
      this.breath = this.sound.bed('rooms/breath_sack.mp3', { gain: 0.35, pan: -0.25, fade: 1.6 });
    });
    this.beat(T_LAST - 0.7, () => this.breath?.gain(0, 0.5));
    this.beat(T_LAST, () => {
      // the last one is not going out by itself: someone beside you blows
      this.sound.play('rooms/candle_blow.mp3', { gain: 0.42, pan: -0.25 });
      this.organ?.gain(0, 0.1);
      this.drone?.gain(0, 0.4);
      this.rub?.gain(0, 0.4);
    });
    // in the dark, the party: every horn at once, the record back up to speed, a room full of chairs and breath
    this.beat(T_PARTY, () => {
      this.sound.play('rooms/horns_all.mp3', { gain: 0.6 });
      this.organ?.rate(1.06, 0.25);
      this.organ?.gain(0.42, 0.2);
      this.drone?.gain(0.14, 0.4);
      this.rub?.gain(0.16, 0.3);
      for (const [pan, rate, offset] of [[-0.7, 0.84, 2.1], [0.15, 1, 7.7], [0.7, 1.17, 12.4]] as const) {
        this.sound.bed('rooms/breath_sack.mp3', { gain: 0.28, pan, rate, offset, fade: 0.5 });
      }
    });
    // (seconds after the party begins) chairs scraped back all round, creaks, balloons, single horns, and every horn again
    const crowdNoise = randomFrom(149);
    for (const [after, pan, rate] of [[0.25, -0.6, 1.2], [0.95, 0.65, 0.9], [1.95, 0.1, 1.35], [2.65, -0.3, 1.05]] as const) {
      this.beat(T_PARTY + after, () => this.sound.play('rooms/chair_wood_move.mp3', { gain: 0.32, reverb: 0.3, pan, rate }));
    }
    for (let k = 0; k < 14; k++) {
      const at = T_PARTY + 0.2 + k * 0.22 + crowdNoise() * 0.15;
      const pan = (k % 2 ? 1 : -1) * (0.2 + crowdNoise() * 0.7);
      const gain = 0.26 + crowdNoise() * 0.08;
      this.beat(at, () => this.sound.play(CREAKS[k % CREAKS.length], { gain, reverb: 0.2, pan }));
    }
    squeak(T_PARTY + 0.55, 1, 0.5);
    squeak(T_PARTY + 1.25, 3, -0.6);
    squeak(T_PARTY + 2.05, 2, 0.2);
    squeak(T_PARTY + 2.85, 4, -0.2);
    for (const [after, pan, rate, gain] of [[0.75, 0.6, 1.15, 0.45], [1.55, -0.65, 0.86, 0.5], [2.35, 0.2, 1.3, 0.42], [3.0, -0.2, 0.95, 0.48]] as const) {
      this.beat(T_PARTY + after, () => this.sound.play('rooms/clown_horn_slow.mp3', { gain, reverb: 0.12, pan, rate }));
    }
    this.beat(T_PARTY + 2.7, () => this.sound.play('rooms/horns_all.mp3', { gain: 0.55, rate: 0.93 }));
    // it stops dead: a real silence, then the switch, and only the record going round in its last groove
    this.beat(T_HUSH, () => this.sound.stopAll(0.04));
    this.beat(T_LAMP, () => {
      this.sound.play('rooms/wood_block_1.mp3', { gain: 0.32 });
      this.sound.bed('rooms/record_crackle.mp3', { gain: 0.11, pan: 0.45, fade: 0.3 });
    });
    this.beat(T_SHUTTER, () => this.shutter(false));
    this.beat(T_CAME, () => this.say({ tr: 'Herkes geldi.', en: 'Everyone came.' }, 2));
    this.beat(T_BUT_YOU, () => this.say({ tr: 'Bir sen yoksun.', en: 'Everyone but you.' }, 2.4));
    this.beat(T_CUT, () => this.sound.stopAll(0.05));
  }

  /** The turntable of the record player, on a hub of its own; a paper label so that one can see it turn. */
  private findPlatter(player: Object3D): Object3D | null {
    player.updateWorldMatrix(true, true);
    const box = new Box3();
    const size = new Vector3();
    let found: Mesh | null = null as Mesh | null;
    let top = -Infinity;
    player.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      box.setFromObject(mesh);
      box.getSize(size);
      if (size.y < 0.04 && size.x > 0.16 && size.z > 0.16 && box.max.y > top) {
        top = box.max.y;
        found = mesh;
      }
    });
    if (!found) return null;
    box.setFromObject(found);
    const center = box.getCenter(new Vector3());
    const hub = new Object3D();
    hub.position.copy(player.worldToLocal(center));
    player.add(hub);
    hub.updateWorldMatrix(true, false);
    hub.attach(found);
    const { canvas, c } = surfaceCanvas(128, 128);
    c.fillStyle = '#6e1a14';
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = '#d8ccae';
    c.fillRect(30, 18, 68, 12);
    c.beginPath();
    c.arc(64, 64, 4, 0, 7);
    c.fillStyle = '#111';
    c.fill();
    const label = new Mesh(new CircleGeometry(0.05, 24), new MeshStandardMaterial({ map: textureOf(canvas, true), roughness: 0.8 }));
    label.rotation.x = -Math.PI / 2;
    label.position.y = box.max.y - center.y + 0.0015;
    hub.add(label);
    return hub;
  }

  /** The stains of the walls and the ceiling: one mesh, one image. */
  private grimeLayer(): Mesh {
    const positions: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    const add = (center: V3, ax: V3, ay: V3, halfA: number, halfB: number, cell: number) => {
      const u0 = cell % 2 === 0 ? 0 : 0.5;
      const v0 = cell < 2 ? 0.5 : 0;
      const base = positions.length / 3;
      for (const [sa, sb, u, w] of [[-1, 1, u0, v0 + 0.5], [1, 1, u0 + 0.5, v0 + 0.5], [1, -1, u0 + 0.5, v0], [-1, -1, u0, v0]] as const) {
        positions.push(center[0] + ax[0] * sa * halfA + ay[0] * sb * halfB, center[1] + ax[1] * sa * halfA + ay[1] * sb * halfB, center[2] + ax[2] * sa * halfA + ay[2] * sb * halfB);
        uvs.push(u, w);
      }
      index.push(base, base + 2, base + 1, base, base + 3, base + 2);
    };
    const right = W / 2 - 0.006;
    const onRight = (z: number, y: number, a: number, b: number, cell: number) => add([right, y, z], [0, 0, 1], [0, 1, 0], a, b, cell);
    const onLeft = (z: number, y: number, a: number, b: number, cell: number) => add([-right, y, z], [0, 0, -1], [0, 1, 0], a, b, cell);
    const onFar = (x: number, y: number, a: number, b: number, cell: number) => add([x, y, Z_FAR + 0.006], [1, 0, 0], [0, 1, 0], a, b, cell);
    const onBack = (x: number, y: number, a: number, b: number, cell: number) => add([x, y, Z_BACK - 0.006], [-1, 0, 0], [0, 1, 0], a, b, cell);
    const overhead = (x: number, z: number, a: number, cell: number) => add([x, H - 0.006, z], [1, 0, 0], [0, 0, 1], a, a, cell);
    onFar(-1.9, 1.6, 1.2, 1.3, 0);
    onFar(1.9, 1.5, 1.3, 1.4, 0);
    onFar(-0.4, 2.2, 1.6, 0.6, 1);
    onFar(1.2, 2.2, 1.0, 0.5, 3);
    onLeft(-6.2, 1.8, 1.0, 1.1, 0);
    onLeft(-0.2, 1.9, 1.6, 0.9, 1);
    onLeft(1.2, 1.5, 0.9, 1.1, 0);
    onRight(-5.7, 1.9, 1.2, 0.9, 1);
    onRight(-2.6, 2.0, 1.4, 0.8, 1);
    onRight(-1.7, 1.45, 1.0, 1.2, 0);
    onRight(1.2, 1.5, 1.0, 1.2, 3);
    onBack(1.5, 1.6, 1.2, 1.3, 0);
    onBack(-1.8, 1.5, 1.0, 1.2, 0);
    onBack(0.2, 2.25, 2.0, 0.6, 1);
    overhead(0, LAMP_Z, 1.1, 2);
    overhead(-1.3, -5.3, 1.4, 2);
    overhead(1.4, -0.2, 1.3, 0);
    overhead(1.5, -4.4, 1.2, 3);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    g.setIndex(index);
    const mesh = new Mesh(g, new MeshBasicMaterial({ map: grimeAtlas(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    return mesh;
  }

  /** He is in this chair now. */
  private sitAt(seat: number): void {
    this.seat = seat;
    const p = this.seatPlans[seat];
    this.body.setMatrix(0, p.body);
    this.body.commit();
    p.head.decompose(this.heroHead.position, this.heroHead.quaternion, this.heroHead.scale);
    this.hats.setMatrix(this.placesCount, p.hat);
    this.hats.commit();
    this.horns.setMatrix(0, p.horn);
    this.horns.commit();
    this.shadowFrames = 3;
  }

  /** The table as it was laid, with him at it; or as they left it, with nobody. */
  private clear(after: boolean): void {
    this.after = after;
    for (const [crowd, matrices] of after ? this.left : this.laid) {
      for (let i = 0; i < matrices.length; i++) crowd.setMatrix(i, matrices[i]);
      crowd.commit();
    }
    this.hats.drawn = this.placesCount + 1 + (after ? HATS_DROPPED : 0);
    this.horns.drawn = 1 + (after ? HORNS_LEFT : 0);
    this.body.root.visible = !after;
    this.heroHead.visible = !after;
    for (const o of this.aftermath) o.visible = after;
    this.laidShadows.visible = !after;
    this.cakeWedge.set(after ? CAKE_FROM : 0, after ? CAKE_LEFT : WHOLE);
    if (!after) this.sitAt(this.seat);
    this.shadowFrames = 3;
  }

  /** Whether he changes chairs now: when a candle takes the light, or the moment nobody is looking. */
  private settle(s: number, frame: RoomFrame): void {
    let due = 0;
    let may = 0;
    for (let i = 0; i < HOP_AT.length; i++) {
      if (s >= HOP_AT[i]) due = i + 1;
      if (s >= HOP_EARLY[i]) may = i + 1;
    }
    let seat = this.seat;
    if (seat < due) seat = due;
    else if (seat > may) seat = may;
    else if (seat < may && this.unseen(frame, this.heroHead.position.x, this.heroHead.position.y, this.heroHead.position.z, 4)) seat += 1;
    if (seat === this.seat) return;
    this.sitAt(seat);
    this.creak = (this.creak + 2) % CREAKS.length;
    this.sound.play(CREAKS[this.creak], { gain: 0.32, reverb: 0.2, pan: clamp(SEATS[seat].x * 0.5, -0.8, 0.8) });
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    // once the last wick is out he is gone, and so is the table as it was laid
    const after = s >= T_GONE;
    if (after !== this.after) this.clear(after);
    if (!after) this.settle(s, frame);

    let burning = 0;
    for (let i = 0; i < CANDLES; i++) burning += clamp((this.deaths[i] - s) / FLAME_DIES, 0, 1);
    const share = burning / CANDLES;
    const dip = dipAt(s) * DIP_DEPTH;
    const sway = 1 + 0.05 * wobble(frame.time * 1.1, 4);
    const candle = Math.pow(share, CANDLE_CURVE) * (1 - dip) * sway;
    const lamp = s >= T_LAMP ? 1 : 0;

    this.cakeLight.intensity = CAKE_LIGHT * candle;
    this.bounce.intensity = BOUNCE_LIGHT * candle;
    this.cakeSpot.intensity = CAKE_SPOT * candle;
    this.wallSpot.intensity = WALL_SPOT * candle;
    this.reach.intensity = burning > 0.01 ? AIR_FILL * (AIR_STAYS + (1 - AIR_STAYS) * share) * (1 - dip) : 0;
    this.faceFill.intensity = FACE_FILL * range(30, 34, s) * (burning > 0.01 ? 1 - dip : 0);
    this.lampLight.intensity = LAMP_LIGHT * lamp;
    this.lampFill.intensity = LAMP_FILL * lamp;
    this.lampSpot.intensity = LAMP_SPOT * lamp;
    this.globe.emissiveIntensity = LAMP_GLOBE * lamp;

    const wanted = s >= T_LAST ? this.lampSpots : this.candleSpots;
    if (this.spots !== wanted) this.spots = wanted;
    this.movingShadows = this.shadowFrames > 0;
    if (this.shadowFrames > 0) this.shadowFrames--;

    this.flames.uniforms.uSeconds.value = s;
    this.flames.uniforms.uTime.value = frame.time;
    this.flames.uniforms.uLevel.value = 1 - dip;
    this.flames.uniforms.uSmoke.value.copy(this.smokeBase).multiplyScalar(0.06 + 0.6 * Math.max(candle, 0.08));
    this.halo.copy(this.haloBase).multiplyScalar(candle);
    this.motes.color.copy(this.motes.base).multiplyScalar(0.12 + 0.88 * Math.max(candle, lamp * 0.8));
    this.motes.time.value = frame.time;

    // the last wick, a dot of red in the dark
    const emberLeft = s >= T_LAST ? 1 - (s - T_LAST) / EMBER : 0;
    this.ember.visible = emberLeft > 0;
    if (emberLeft > 0) this.emberColor.setRGB(1.4 * emberLeft, 0.28 * emberLeft, 0.05 * emberLeft);

    // exposure opens as the candles go, as an eye would; the lamp shuts it
    const fine = s >= T_LAMP ? 1 : 0;
    this.air.grade.exposure = lerp(lerp(EXPOSURE_FULL, EXPOSURE_FEW, 1 - Math.pow(share, 0.6)), EXPOSURE_LAMP, fine);
    this.air.envIntensity = lerp(ENV_CANDLE, ENV_LAMP, fine);
    this.air.grade.saturation = lerp(0.82, 0.58, fine);
    this.air.grade.warmth = lerp(0.05, -0.02, fine);
    this.air.grade.tint = lerp(-0.02, 0.02, fine);
    this.film.bloom = lerp(0.55, 0.42, fine);
    this.film.grain = lerp(0.42, 0.55, fine);

    this.black = after && s < T_LAMP ? 1 : dip * 0.82;
    this.focus = focusAt(s);
    this.aperture = s >= T_LAMP ? END_APERTURE : lerp(6, 7, range(30, 34, s));
    this.drift = s >= T_BREATH - 0.5 ? 0 : 0.55;
    this.control = s >= T_LAST ? HELD : OPEN;

    // real silence holds its breath; the heart is part of the mix, so it stops too, except while the party is heard
    const quiet = (s >= T_QUIET && s < T_HONK) || s >= T_LAST;
    this.fear = s >= T_PARTY && s < T_HUSH ? PARTY_FEAR : quiet ? 0 : lerp(0.28, 0.85, range(6, T_LAST, s));

    for (let i = 0; i < this.balloonData.length; i++) {
      const d = this.balloonData[i];
      const fallen = Math.max(0, s - d.from) * d.rate;
      const y = d.y - fallen;
      const settled = y <= d.rest;
      this.balloons.set(i, d.x + (settled ? 0 : 0.03 * Math.sin(frame.time * 0.23 + d.phase)), settled ? d.rest : y + 0.012 * Math.sin(frame.time * 0.7 + d.phase), d.z, d.turn + s * 0.04, d.size);
    }
    this.balloons.commit();

    this.hang.rotation.z = -Math.PI / 2 + 0.05 + 0.014 * Math.sin(frame.time * 0.5);
    // the record never stops: after the party it goes round in its last groove
    if (this.hub) this.hub.rotation.y = -Math.max(0, s - T_NEEDLE) * 2.2;

    const rocked = s >= T_HONK && s < 26.5;
    this.nearHorn.visible = rocked;
    if (rocked) this.nearHorn.rotation.z = 0.1 * Math.exp(-(s - T_HONK) * 1.1) * Math.sin((s - T_HONK) * 9);

    // the sack draws in over the mouth, and lets go: the first thing it has ever been seen to do
    const breathing = this.seat === LAST_SEAT && s >= T_BREATH ? range(T_BREATH, T_BREATH + 1, s) : 0;
    this.heroHead.morphTargetInfluences![0] = breathing * (0.5 + 0.5 * Math.sin(((s - T_BREATH) / BREATH_CYCLE) * Math.PI * 2 - 1.2));

    // the red holds on a little longer than the rest of the room
    this.headMaterial.emissiveIntensity = lerp(0.1, 0.42, smooth(range(0.4, 0.05, share)));
  }
}
