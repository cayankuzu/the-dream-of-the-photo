import {
  AdditiveBlending,
  AnimationClip,
  Box3,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  KeyframeTrack,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  QuaternionKeyframeTrack,
  ShaderMaterial,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type Material,
  type BufferAttribute,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import { lang } from '../../../ui/i18n';
import { rigClock, setClock } from '../../dream/ClockRig';
import { randomFrom, type Crowd } from '../../dream/FigureKit';
import { clamp, DEG, lerp, smootherstep, wobble } from '../../math';
import { GlideTrack } from '../../timeline/Track';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import { PALETTE } from '../RoomKit';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['school_desk', 'school_chair', 'seat_theatre', 'stage_light', 'pencil', 'antique_camera', 'wall_clock'],
  materials: ['velvet_red', 'wood_floor_dark', 'plaster_pale', 'plaster_damaged', 'steel_scuffed'],
  sounds: [
    'rooms/theatre_tone.mp3',
    'rooms/hall_silence.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/power_thunk.mp3',
    'rooms/breaker_clunk_2.mp3',
    'rooms/cough_far_1.mp3',
    'rooms/cough_far_2.mp3',
    'rooms/cough_far_3.mp3',
    'rooms/cough_man.mp3',
    'rooms/seat_creak_1.mp3',
    'rooms/seat_creak_2.mp3',
    'rooms/seat_creak_3.mp3',
    'rooms/seat_creak_4.mp3',
    'rooms/crowd_rise.mp3',
    'rooms/pencil_snap.mp3',
    'rooms/page_turn.mp3',
    'rooms/paper_rustle_1.mp3',
    'rooms/paper_rustle_2.mp3',
    'rooms/paper_rustle_3.mp3',
    'rooms/clap_unison_1.mp3',
    'rooms/clap_unison_2.mp3',
    'rooms/clap_unison_3.mp3',
    'rooms/clap_unison_4.mp3',
    'rooms/shutter_wave.mp3',
    'rooms/heart_beat.mp3',
  ],
};

// the building (m); the stage's front edge lies near z = 0, the seats at -z, the stage at +z
const HALF = 14.2;
const LIP_Z = -0.35;
const ARCH_Z = 0.9;
const ARCH_HALF = 9.4;
const ARCH_TOP = 6.1;
const STAGE_H = 11;
const STAGE_BACK = 24;
const HALL_DEPTH = 22;
const HALL_FLOOR = -1.2;
const HALL_H = 18;

// the seats: rows, their pitch and rise (m), how the ends curve to the stage, how many seats wide
const ROWS = 18;
const ROW_STEP = 0.95;
const ROW_RISE = 0.52;
const ROW_Z0 = -1.25;
const ROW_FLOOR = -0.55;
const ROW_CURVE = 0.012;
const ROW_HALF = 8.8;
const ROW_WIDENS = 0.3;
const SEAT_STEP = 0.64;
const AISLE = 0.85;
/** Those nearer than this (rows, half width m) are whole bodies; the others are simplified. */
const NEAR_ROWS = 3;
const NEAR_HALF = 4.8;
const MID_ROWS = 9;
/** Where the people all look (z, m). */
const FACING_Z = 14;
/** The desk and all who sit, stand or come are drawn before the stage and the hall (only what is opaque, so the picture is the same): the boards, steps and walls they hide then fail the depth test before they are lit. */
const IN_FRONT_FIRST = -1;

// where the desk stands at each question, its center's z (m); it moves only while the eye is on the paper
const MARKS = [11.6, 8.3, 5.7, 3.4, 1];
const UP_Y = 1.24;
const UP_BACK = 0.82;
const UP_PITCH = [-4.5, -2.8, -0.6, 2, 5];
const UP_FOV = [56, 54, 54, 50, 58];
const READ_Y = 1.14;
const READ_BACK = 0.5;
const READ_PITCH = -31;
const READ_FOV = 40;

/** The eye: second, which mark it sits at, whether it reads the paper (then the lean, the pitch, the lens). */
const SHOTS: readonly { at: number; mark: number; read: boolean; yaw?: number; pitch?: number; fov?: number }[] = [
  { at: 0, mark: 0, read: false },
  { at: 8.9, mark: 0, read: false, pitch: -4, fov: 54.5 },
  { at: 10, mark: 0, read: true },
  { at: 10.6, mark: 0, read: true },
  { at: 14, mark: 1, read: true },
  { at: 14.6, mark: 1, read: true },
  { at: 16.4, mark: 1, read: false },
  { at: 18.9, mark: 1, read: false, pitch: -2.2, fov: 53 },
  { at: 20, mark: 1, read: true },
  { at: 20.6, mark: 1, read: true },
  { at: 24, mark: 2, read: true },
  { at: 24.6, mark: 2, read: true },
  { at: 26.4, mark: 2, read: false },
  { at: 28.9, mark: 2, read: false, pitch: -0.2, fov: 53 },
  { at: 30, mark: 2, read: true },
  { at: 30.6, mark: 2, read: true },
  { at: 32.5, mark: 3, read: true },
  { at: 34.4, mark: 3, read: true },
  { at: 37.4, mark: 3, read: false, yaw: -9, pitch: 3 },
  { at: 39, mark: 3, read: false, yaw: -8, pitch: 3 },
  { at: 40, mark: 3, read: true },
  { at: 40.6, mark: 3, read: true },
  { at: 43.8, mark: 4, read: true },
  { at: 44.15, mark: 4, read: true },
  { at: 45.7, mark: 4, read: false },
  { at: 47.2, mark: 4, read: false, pitch: 5.5, fov: 57 },
  { at: 54, mark: 4, read: false, pitch: 4.5, fov: 55 },
  { at: 56, mark: 4, read: false, pitch: 4.5, fov: 55 },
];

// the lens: where it looks, how shallow, on the hall and on the paper
const HALL_APERTURE = 1.1;
const READ_APERTURE = 5.5;
const READ_FOCUS = 0.72;

// the follow spot: where its lamp stands, how wide its beam (half angle), its hard edge, where the light really is along it (m)
const BOOTH: readonly [number, number, number] = [11, 12.5, -20.6];
const SPOT_ANGLE = 2.5;
const SPOT_EDGE = 0.14;
const KEY_RANGE = 14;
/** The beam lands ahead of the desk so that its pool lies where you can see it, with the desk this far from its axis (of its radius). */
const DESK_IN_BEAM = 0.7;
const KEY_POWER = 1000;
const KEY_COLOR = 0xeef3ff;
const BEAM_POWER = 0.5;
/** What the thunk does to it for a moment. */
const STRIKE = 0.7;

// the light on the seats and on the arch
const WASH_POWER = 640;
const FOOT_POWER = 6;
const FOOT_COUNT = 36;
const FOOT_SPAN = 9.2;
/** How far the footlights' sheen reaches up the boards (m), and how strong it is. */
const SHEEN_DEPTH = 3.2;
const SHEEN_POWER = 0.05;
const CLOCK_POWER = 42;
const CLOCK_Y = 4.75;
const CLOCK_SCALE = 4.4;

// times (s)
const ON_AT = 0.5;
const LIFT_AT = 4.2;
const LIFT_SECONDS = 4.4;
const CLAP_FIRST = 31;
const CLAP_EVERY = 1.3;
const CLAPS = 11;
const LAST_CLAP = CLAP_FIRST + (CLAPS - 1) * CLAP_EVERY;
const CLAP_SOFT = 0.05;
const CLAP_HARD = 0.42;
const STAND_AT = 40;
const RAISE_AT = 47.2;
const RAISE_SECONDS = 0.9;
const WAVE_AT = 48;
const WAVE_SECONDS = 3;
const SHUTTER_AT = 49.45;
/** The shutter waits for an eye that is turned this far away (rad), but not longer than this (s). */
const SHUTTER_GAZE = 1.1;
const SHUTTER_LATE = 2;
const LINE_AT = 51;
const CUT_AT = 54;
/** The light of the wave of flashes: at its crest on the front rows, and laid over the picture. */
const SWEEP_POWER = 38;
const WHITE_AT_CREST = 0.03;
/** After this second time goes at its own pace (the claps are heard in time). */
const LOCK_AT = 29.5;

// she stands before the desk at the third question: where (m from the desk's center), and when she comes
const HER_FROM = 30.3;
const HER_SETTLED = 32.4;
const HER_X = 0.78;
const HER_GAP = 2;
const HER_FAR = 5.2;

// the paper
const PAPER_W = 0.36;
const PAPER_H = 0.46;
const PAPER_PX = 2200;
const QUESTION_EM = 0.0165;
const QUESTION_TOP = 0.172;
const QUESTION_STEP = 0.072;
const QUESTIONS = [
  { at: 10, tr: '1. Bu fotoğrafı neden çektin?', en: '1. Why did you take this photograph?' },
  { at: 20, tr: '2. Sofrada kaç kişi vardı?', en: '2. How many sat at the table?' },
  { at: 30, tr: '3. Annenin yüzünü hatırlıyor musun?', en: "3. Do you remember your mother's face?" },
  { at: 40, tr: '4. Neden geri dönmedin?', en: '4. Why did you not come back?' },
];

const DESK_SCALE = 0.9;
const CHAIR_SCALE = 0.85;
const PENCIL_SCALE = 1.25;

// the people
/** Sack cloth: the bodies dark, the heads pale, so that from afar there are rows of heads. */
const SACK_BODY = 0x3b3a37;
const SACK_HEAD = 0xd6d2c4;
/** Those who stand: the cloth of the head is darker, so that the hair is seen as hair. */
const SACK_STANDING_HEAD = 0x7a766a;
const BOW_NECK = 52 * DEG;
const BOW_HEAD = 34 * DEG;
const SIT_TIME = 4.2;
const TAKE_TIMES = [0.02, 1.15, 2.6];
/** Half of the width of the wave of flashes (m). */
const SWEEP_HALF = 13.5;
const FLASH_GLOW = REDUCED_MOTION ? 0.45 : 1;
/** White hair, and what it gives back in the dark. */
const HAIR_WHITE = 0xe7e3d9;
const HAIR_GLOW = 0x34332f;
/** Those who stand wear it from behind the ears (degrees round from the face) and swept back off the shoulders (m), so none of it falls on the chest. */
const HAIR_AROUND: readonly [number, number] = [100, 260];
const HAIR_BEHIND = 0.16;
/** The cameras: big dark press cameras over the face, a dark barrel round glossy black glass, a chrome top, and a flash dish whose white bulb catches the spot. */
const CAMERA_SIZE = 1.45;
const CAMERA_BODY = 0x1e1e22;
const CAMERA_GLASS = 0x050506;
const GLASS_ROUGHNESS = 0.12;
const CAMERA_CHROME = 0xa29e94;
const CHROME_GLOW = 0x1c1b18;
const CHROME_ROUGHNESS = 0.3;
const BULB_WHITE = 0xf2f0e8;
const BULB_GLOW = 0x5c5a52;
/** The flash dish (m, before the camera's size): how far to the holder's left, how high, its rim's radius. */
const DISH_X = 0.15;
const DISH_Y = 0.02;
const DISH_RADIUS = 0.05;
/** The coats: pale lapels either side of a dark opening at the throat, down to the button (m: below the neck, the drop, half the opening, a lapel's width, what is left of it at the button, off the cloth, the patch the cloth is read over). */
const COAT_LAPEL = 0x8c8579;
const LAPEL_ROUGHNESS = 0.55;
const COAT_OPENING = 0x0f0e0d;
const LAPEL_TOP = 0.02;
const LAPEL_DROP = 0.38;
const LAPEL_OPEN = 0.06;
const LAPEL_WIDTH = 0.09;
const LAPEL_END = 0.15;
const LAPEL_LIFT = 0.026;
const OPENING_LIFT = 0.02;
const LAPEL_PATCH = 0.025;
const LAPEL_ROWS = 6;

type Aim = [number, number, number];
type V3 = readonly [number, number, number];
type Part = { geometry: BufferGeometry; material: Material };
type Uniform = { value: number };
type Posing = { uLift: Uniform; uOpen: Uniform; uShut: Uniform; uWave: Uniform; uGlowMul: Uniform };

interface Seat {
  x: number;
  y: number;
  z: number;
  heading: number;
  row: number;
  /** When its head lifts (0..1 of the lift), when its flash goes (0..1 of the sweep), how pale it is. */
  lift: number;
  wave: number;
  tone: number;
}

const rowZ = (row: number, x = 0): number => ROW_Z0 - row * ROW_STEP + ROW_CURVE * x * x;
const rowY = (row: number): number => ROW_FLOOR + row * ROW_RISE;
const smooth = (a: number, b: number, v: number): number => {
  const k = clamp((v - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

const POSE_HEAD = /* glsl */ `
attribute vec3 aA;
attribute vec3 aB;
attribute vec3 aC;
attribute vec2 aInst;
uniform float uLift;
uniform float uOpen;
uniform float uShut;
uniform float uWave;
varying float vFlash;
`;
const POSE_BODY = /* glsl */ `
float bowed = 1.0 - smoothstep(aInst.x, aInst.x + 0.2, uLift);
transformed += aA * bowed + aB * uOpen + aC * uShut;
float sinceFlash = (uWave - aInst.y) * ${WAVE_SECONDS.toFixed(1)};
vFlash = sinceFlash < 0.0 ? exp(-sinceFlash * sinceFlash * 60.0) * 0.5 : exp(-sinceFlash * 9.0);
`;

/** Bodies that move between baked poses without a skeleton: one draw, written by uniforms only. */
function posedMaterial(source: MeshStandardMaterial, posing: Posing, color?: number): MeshStandardMaterial {
  const m = source.clone();
  if (color !== undefined) m.color.set(color);
  m.normalMap = null;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, posing);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${POSE_HEAD}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${POSE_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFlash;\nuniform float uGlowMul;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vFlash * uGlowMul;');
  };
  m.customProgramCacheKey = () => 'exam-posed';
  return m;
}

function delta(to: BufferGeometry, from: BufferGeometry): Float32BufferAttribute {
  const a = to.getAttribute('position') as BufferAttribute;
  const b = from.getAttribute('position') as BufferAttribute;
  const out = new Float32Array(a.count * 3);
  for (let i = 0; i < a.count; i++) {
    out[i * 3] = a.getX(i) - b.getX(i);
    out[i * 3 + 1] = a.getY(i) - b.getY(i);
    out[i * 3 + 2] = a.getZ(i) - b.getZ(i);
  }
  return new Float32BufferAttribute(out, 3);
}

/** The body kept, its detail thrown away: vertices falling into one cell of `size` m become one. */
function simplified(g: BufferGeometry, size: number): BufferGeometry {
  const p = g.getAttribute('position') as BufferAttribute;
  const seen = new Map<number, number>();
  const remap = new Int32Array(p.count);
  const keep: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const key = (Math.floor(p.getX(i) / size + 512) * 1048576) + (Math.floor(p.getY(i) / size + 512) * 1024) + Math.floor(p.getZ(i) / size + 512);
    let n = seen.get(key);
    if (n === undefined) {
      n = keep.length;
      keep.push(i);
      seen.set(key, n);
    }
    remap[i] = n;
  }
  const out = new BufferGeometry();
  for (const name of Object.keys(g.attributes)) {
    const source = g.getAttribute(name) as BufferAttribute;
    const data = new Float32Array(keep.length * source.itemSize);
    keep.forEach((v, i) => {
      for (let c = 0; c < source.itemSize; c++) data[i * source.itemSize + c] = source.array[v * source.itemSize + c];
    });
    out.setAttribute(name, new Float32BufferAttribute(data, source.itemSize));
  }
  const index = g.index!;
  const tris: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = remap[index.getX(i)];
    const b = remap[index.getX(i + 1)];
    const c = remap[index.getX(i + 2)];
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
  out.setIndex(tris);
  return out;
}

/** One pose as a clip of its own: each source gives the bones it names, at its own moment. */
function stillClip(name: string, sources: readonly { clip: AnimationClip; time: number; only?: RegExp }[], body: Object3D, over: readonly KeyframeTrack[] = []): AnimationClip {
  const tracks = new Map<string, KeyframeTrack>();
  for (const { clip, time, only } of sources) {
    for (const t of clip.tracks) {
      if (only && !only.test(t.name)) continue;
      if (!body.getObjectByName(t.name.split('.')[0])) continue;
      const value = Array.from((t as unknown as { createInterpolant(): { evaluate(time: number): ArrayLike<number> } }).createInterpolant().evaluate(time));
      tracks.set(t.name, new (t.constructor as new (name: string, times: number[], values: number[]) => KeyframeTrack)(t.name, [0], value));
    }
  }
  for (const t of over) tracks.set(t.name, t);
  return new AnimationClip(name, 1, [...tracks.values()]);
}

/** Row upon row of steps, curved toward the stage. */
function terraces(): BufferGeometry {
  const NX = 40;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  const strip = (z0: number, y0: number, z1: number, y1: number, ny: number, nz: number) => {
    const base = positions.length / 3;
    for (let i = 0; i <= NX; i++) {
      const x = -HALF + (2 * HALF * i) / NX;
      const bow = ROW_CURVE * x * x;
      positions.push(x, y0, z0 + bow, x, y1, z1 + bow);
      normals.push(0, ny, nz, 0, ny, nz);
      uvs.push(x, 0, x, Math.hypot(z1 - z0, y1 - y0));
      if (i < NX) {
        const a = base + i * 2;
        index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  };
  strip(LIP_Z, rowY(0), rowZ(0) + ROW_STEP / 2, rowY(0), 1, 0);
  for (let row = 0; row <= ROWS; row++) {
    const back = rowZ(row) - ROW_STEP / 2;
    strip(rowZ(row) + ROW_STEP / 2, rowY(row), back, rowY(row), 1, 0);
    strip(back, rowY(row), back, rowY(row + 1), 0, 1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  return g;
}

/** A moulded ring around an opening, open at the foot; its UVs are in meters. */
function archRing(half: number, top: number, rise: number, width: number, depth: number, bevel: number, flatOutside = false): ExtrudeGeometry {
  const s = new Shape();
  s.moveTo(-(half + width), 0);
  s.lineTo(-(half + width), top + width);
  if (flatOutside) s.lineTo(half + width, top + width);
  else s.quadraticCurveTo(0, top + width + rise * 2, half + width, top + width);
  s.lineTo(half + width, 0);
  s.lineTo(half, 0);
  s.lineTo(half, top);
  s.quadraticCurveTo(0, top + rise * 2, -half, top);
  s.lineTo(-half, 0);
  s.closePath();
  return new ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 28 });
}

/** Heavy cloth in folds, hanging from y = 0 and spreading along +x; UVs in meters of cloth. */
function drape(width: number, height: number, o: { folds: number; depth: number; seed?: number; sag?: number; swags?: number; gather?: (v: number) => number; ny?: number; mirror?: boolean }): BufferGeometry {
  const nx = Math.ceil(o.folds * 7);
  const ny = o.ny ?? 22;
  const seed = o.seed ?? 1;
  const positions = new Float32Array((nx + 1) * (ny + 1) * 3);
  const uvs = new Float32Array((nx + 1) * (ny + 1) * 2);
  const index: number[] = [];
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const v = j / ny;
      const tight = o.gather ? o.gather(v) : 1;
      const hem = o.sag !== undefined ? 1 - o.sag + o.sag * Math.sin(Math.PI * u * (o.swags ?? 1)) ** 2 : 1;
      const phase = u * o.folds * Math.PI * 2 + seed + Math.sin(v * 2.2 + seed) * 0.8;
      const fold = Math.sin(phase);
      const pleat = Math.sign(fold) * Math.abs(fold) ** 0.75 * 0.75 + Math.sin(phase * 2.6 + seed * 1.7 + v * 3) * 0.25;
      const n = j * (nx + 1) + i;
      positions[n * 3] = (o.mirror ? -1 : 1) * u * width * tight;
      positions[n * 3 + 1] = -v * height * hem;
      positions[n * 3 + 2] = pleat * o.depth * (o.gather ? 1.6 - tight : 1);
      uvs[n * 2] = u * width * 1.8;
      uvs[n * 2 + 1] = v * height;
      if (i < nx && j < ny) index.push(...(o.mirror ? [n, n + 1, n + nx + 1, n + 1, n + nx + 2, n + nx + 1] : [n, n + nx + 1, n + 1, n + 1, n + nx + 1, n + nx + 2]));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Long white hair parted over the skull and falling to the shoulders, the face left open: fine ribbons that face the stage. */
function whiteHair(head: Vector3, o: { strands: number; length: readonly [number, number]; seed: number; fall?: number; around?: readonly [number, number]; behind?: number }): BufferGeometry {
  const random = randomFrom(o.seed);
  const ARC = 2;
  const FALL = o.fall ?? 3;
  const [from, to] = o.around ?? [34, 326];
  const behind = o.behind ?? 0;
  const STEPS = ARC + FALL;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  const px = new Float32Array(STEPS + 1);
  const py = new Float32Array(STEPS + 1);
  const pz = new Float32Array(STEPS + 1);
  for (let s = 0; s < o.strands; s++) {
    const a = (from + random() * (to - from)) * DEG;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const r = 0.1 * (0.98 + random() * 0.08);
    const over = (88 + random() * 22) * DEG;
    const start = random() * random() * 0.8;
    const part = (random() - 0.5) * 0.09;
    const fall = lerp(o.length[0], o.length[1], random());
    const out = random() * 0.05;
    const drift = (random() - 0.5) * 0.1;
    const kink = random() * 6.28;
    const width = 0.0016 + random() * 0.0017;
    for (let i = 0; i <= STEPS; i++) {
      if (i <= ARC) {
        const b = start + ((over - start) * i) / ARC;
        px[i] = head.x + dx * Math.sin(b) * r;
        py[i] = head.y + Math.cos(b) * r;
        pz[i] = head.z + dz * Math.sin(b) * r + part * (1 - i / ARC);
      } else {
        const t = (i - ARC) / FALL;
        const flare = out * Math.min(1, t * 3);
        px[i] = head.x + dx * (Math.sin(over) * r + flare) + drift * t * t + Math.sin(t * 5 + kink) * 0.012 * t;
        py[i] = head.y + Math.cos(over) * r - t * fall;
        pz[i] = head.z + dz * (Math.sin(over) * r + flare * 0.7) - behind * Math.min(1, t * 3);
      }
    }
    const base = positions.length / 3;
    for (let i = 0; i <= STEPS; i++) {
      const next = Math.min(i + 1, STEPS);
      const last = Math.max(i - 1, 0);
      const tx = px[next] - px[last];
      const ty = py[next] - py[last];
      const length = Math.hypot(tx, ty) || 1;
      const w = width * (i <= ARC ? 1 : 1 - ((i - ARC) / FALL) * 0.75);
      const sx = (ty / length) * w;
      const sy = (-tx / length) * w;
      positions.push(px[i] + sx, py[i] + sy, pz[i], px[i] - sx, py[i] - sy, pz[i]);
      normals.push(dx * 0.4, 0.2, 0.9, dx * 0.4, 0.2, 0.9);
      uvs.push(0.5, 0.5, 0.5, 0.5);
      if (i < STEPS) {
        const n = base + i * 2;
        index.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  return g;
}

/** The same surface seen from its other side. */
function turned(g: BufferGeometry): BufferGeometry {
  const c = g.clone();
  const index = Array.from(c.index!.array);
  for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
  c.setIndex(index);
  c.computeVertexNormals();
  return c;
}

/** A press camera, lens along +Z (four parts: the dark box, its barrel and the arm of the flash; the black glass and finder; the chrome top and the flash dish on the +X side; the bulb in the dish). */
function pressCamera(): { shell: BufferGeometry; lens: BufferGeometry; chrome: BufferGeometry; bulb: BufferGeometry } {
  const shell = mergeGeometries([
    new BoxGeometry(0.15, 0.1, 0.1),
    new BoxGeometry(0.11, 0.035, 0.07).translate(0, 0.065, -0.005),
    new BoxGeometry(0.12, 0.012, 0.12).translate(0, -0.054, 0.006),
    new BoxGeometry(DISH_X - 0.075, 0.016, 0.016).translate((DISH_X + 0.075) / 2, DISH_Y, 0.01),
    new CylinderGeometry(0.038, 0.042, 0.05, 18).rotateX(Math.PI / 2).translate(0, 0, 0.074),
  ])!;
  const lens = mergeGeometries([
    new CylinderGeometry(0.03, 0.03, 0.006, 18).rotateX(Math.PI / 2).translate(0, 0, 0.1),
    new BoxGeometry(0.085, 0.024, 0.004).translate(0, 0.066, 0.032),
  ])!;
  const chrome = mergeGeometries([
    new BoxGeometry(0.152, 0.008, 0.102).translate(0, 0.05, 0),
    new CylinderGeometry(DISH_RADIUS, 0.018, 0.045, 20, 1, true).rotateX(Math.PI / 2).translate(DISH_X, DISH_Y, 0.03),
  ])!;
  const bulb = new SphereGeometry(0.019, 10, 8).translate(DISH_X, DISH_Y, 0.034);
  for (const g of [shell, lens, chrome, bulb]) g.scale(CAMERA_SIZE, CAMERA_SIZE, CAMERA_SIZE);
  return { shell, lens, chrome, bulb };
}

/** A coat's front laid on the cloth of one pose (bake space): two lapels running down to the button either side of a dark opening at the throat. */
function coatFront(cloth: readonly BufferGeometry[], neck: Vector3): { lapels: BufferGeometry; opening: BufferGeometry } {
  // how far forward the cloth reaches round (x, y), looked for wider where it is thin
  const front = (x: number, y: number): number => {
    for (let reach = LAPEL_PATCH; reach < LAPEL_PATCH * 8; reach *= 2) {
      let z = -Infinity;
      for (const g of cloth) {
        const p = g.getAttribute('position') as BufferAttribute;
        for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i) - x) < reach && Math.abs(p.getY(i) - y) < reach) z = Math.max(z, p.getZ(i));
      }
      if (z > -Infinity) return z;
    }
    return neck.z;
  };
  const strip = (edges: (t: number) => readonly [number, number], lift: number): BufferGeometry => {
    const positions: number[] = [];
    const index: number[] = [];
    for (const side of [-1, 1]) {
      for (let r = 0; r <= LAPEL_ROWS; r++) {
        const t = r / LAPEL_ROWS;
        const y = neck.y - LAPEL_TOP - t * LAPEL_DROP;
        for (const e of edges(t)) {
          const x = neck.x + side * e;
          positions.push(x, y, front(x, y) + lift);
        }
        const n = positions.length / 3 - 2;
        // faced to +Z on either side of the middle
        if (r < LAPEL_ROWS) index.push(...(side > 0 ? [n, n + 2, n + 1, n + 1, n + 2, n + 3] : [n, n + 1, n + 2, n + 1, n + 3, n + 2]));
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new Float32BufferAttribute(new Float32Array((positions.length / 3) * 2).fill(0.5), 2));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  };
  const open = (t: number) => LAPEL_OPEN * (1 - t);
  return {
    opening: strip((t) => [0, open(t)], OPENING_LIFT),
    lapels: strip((t) => [open(t), open(t) + LAPEL_WIDTH * (1 - t * (1 - LAPEL_END))], LAPEL_LIFT),
  };
}

/** A long ribbon from the lamp to the floor: whatever the eye's place it turns its face to it, and is as wide as the beam is there. */
const BEAM_VERT = /* glsl */ `
uniform vec3 uFrom;
uniform vec3 uTo;
uniform float uWide;
varying vec2 vRibbon;
varying vec3 vWorld;
void main() {
  vec3 center = mix(uFrom, uTo, position.y);
  vec3 toEye = normalize(cameraPosition - center);
  vec3 side = normalize(cross(normalize(uTo - uFrom), toEye));
  vec3 p = center + side * position.x * mix(0.05, uWide, position.y);
  vRibbon = position.xy;
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uPower;
uniform float uTime;
varying vec2 vRibbon;
varying vec3 vWorld;
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
void main() {
  float across = abs(vRibbon.x);
  float body = smoothstep(1.0, 0.45, across) * mix(0.55, 1.0, 1.0 - across * across);
  float along = vRibbon.y;
  float fade = mix(1.0, 0.2, pow(along, 0.7)) * smoothstep(1.0, 0.8, along) * smoothstep(0.0, 0.015, along);
  vec3 drift = vec3(uTime * 0.12, uTime * 0.04, -uTime * 0.08);
  float smoke = 0.4 + 0.75 * noise(vWorld * 0.5 + drift) * noise(vWorld * 1.9 - drift);
  gl_FragColor = vec4(uColor * body * fade * smoke * uPower, 1.0);
}
`;

const POINT_VERT = /* glsl */ `
attribute vec3 aAt;
attribute vec3 aFlash;
uniform float uWave;
uniform float uLevel;
varying vec2 vQuad;
varying float vHit;
void main() {
  float since = (uWave - aFlash.x) * ${WAVE_SECONDS.toFixed(1)};
  float hit = since < 0.0 ? 0.0 : exp(-since * 11.0);
  float after = since < 0.0 ? 0.0 : 0.035 * exp(-since * 0.95);
  vHit = hit * 8.0 + after + aFlash.z * uLevel;
  vQuad = position.xy;
  vec4 mv = modelViewMatrix * vec4(aAt, 1.0);
  mv.xy += position.xy * aFlash.y * (aFlash.z > 0.0 ? 1.0 : 0.5 + hit * 0.9);
  gl_Position = projectionMatrix * mv;
}
`;
const POINT_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vQuad;
varying float vHit;
void main() {
  float d = length(vQuad) * 2.0;
  float fall = max(0.0, 1.0 - d);
  float core = pow(fall, 7.0) + 3.0 * pow(fall, 26.0) + 0.05 * fall * fall;
  float streak = exp(-abs(vQuad.y) * 120.0) * pow(max(0.0, 1.0 - abs(vQuad.x) * 2.0), 2.0);
  gl_FragColor = vec4(uColor * (core + streak * 0.3) * vHit, 1.0);
}
`;

/** Points of light that burn at a fixed level and flash as the sweep reaches them. */
function pointField(count: number, write: (i: number, at: Float32Array, flash: Float32Array) => void, color: number, uniforms: { uWave: Uniform; uLevel: Uniform }): Mesh {
  const quad = new PlaneGeometry(1, 1);
  const g = new InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute('position', quad.getAttribute('position'));
  const at = new Float32Array(count * 3);
  const flash = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) write(i, at, flash);
  g.setAttribute('aAt', new InstancedBufferAttribute(at, 3));
  g.setAttribute('aFlash', new InstancedBufferAttribute(flash, 3));
  g.instanceCount = count;
  const m = new Mesh(
    g,
    new ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      uniforms: { ...uniforms, uColor: { value: new Color(color) } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  );
  m.frustumCulled = false;
  m.renderOrder = 4;
  return m;
}

const SCHOOL_FONT = '"Times New Roman", "Liberation Serif", "DejaVu Serif", serif';

/** The photograph on the sheet: the table, three who are still at it, an empty chair, their faces scratched away. */
function drawPhotograph(c: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  const h = w * 1.22;
  const random = randomFrom(5);
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.5)';
  c.shadowBlur = 16;
  c.shadowOffsetY = 5;
  c.fillStyle = '#e6e2d6';
  c.fillRect(x, y, w, h);
  c.restore();
  const px = x + w * 0.07;
  const py = y + w * 0.07;
  const pw = w * 0.86;
  const ph = pw;
  c.save();
  c.beginPath();
  c.rect(px, py, pw, ph);
  c.clip();
  const glow = c.createRadialGradient(px + pw * 0.5, py + ph * 0.28, 0, px + pw * 0.5, py + ph * 0.3, pw * 0.8);
  glow.addColorStop(0, '#8a6636');
  glow.addColorStop(0.45, '#3a2a18');
  glow.addColorStop(1, '#0b0907');
  c.fillStyle = glow;
  c.fillRect(px, py, pw, ph);
  // the three at the table
  const figures = [
    [0.22, 0.42, 1],
    [0.5, 0.36, 1.08],
    [0.78, 0.44, 0.74],
  ];
  c.fillStyle = '#100c09';
  for (const [fx, fy, s] of figures) {
    c.beginPath();
    c.ellipse(px + pw * fx, py + ph * (fy + 0.3), pw * 0.15 * s, ph * 0.32 * s, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(px + pw * fx, py + ph * fy, pw * 0.075 * s, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = '#c9c0ac';
  c.beginPath();
  c.moveTo(px + pw * 0.12, py + ph * 0.66);
  c.lineTo(px + pw * 0.88, py + ph * 0.66);
  c.lineTo(px + pw * 1.02, py + ph);
  c.lineTo(px - pw * 0.02, py + ph);
  c.closePath();
  c.fill();
  c.strokeStyle = 'rgba(232,226,212,0.9)';
  c.lineWidth = 1.3;
  for (const [fx, fy, s] of figures) {
    for (let i = 0; i < 26; i++) {
      c.beginPath();
      c.moveTo(px + pw * (fx - 0.085 * s + random() * 0.17 * s), py + ph * (fy - 0.08 * s + random() * 0.04));
      c.lineTo(px + pw * (fx - 0.085 * s + random() * 0.17 * s), py + ph * (fy + 0.08 * s - random() * 0.04));
      c.stroke();
    }
  }
  c.fillStyle = 'rgba(0,0,0,0.2)';
  c.fillRect(px, py, pw, ph);
  c.restore();
  // the staple
  c.strokeStyle = '#6d6f72';
  c.lineWidth = 2.5;
  c.beginPath();
  c.moveTo(x + w * 0.38, y - 3);
  c.lineTo(x + w * 0.62, y - 3);
  c.stroke();
}

/** The exam sheet, with its first `count` questions. */
function drawSheet(c: CanvasRenderingContext2D, w: number, h: number, count: number): void {
  const m = (meters: number) => meters * PAPER_PX;
  const random = randomFrom(21);
  c.fillStyle = '#e8e4d9';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = 30 + random() * 170;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(150,128,92,${0.03 + random() * 0.05})`);
    g.addColorStop(1, 'rgba(150,128,92,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // a fold, and the printed margin
  c.strokeStyle = 'rgba(90,86,80,0.18)';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(0, h * 0.5);
  c.lineTo(w, h * 0.5 + 8);
  c.stroke();
  c.strokeStyle = 'rgba(40,40,44,0.65)';
  c.lineWidth = 2.5;
  c.beginPath();
  c.moveTo(m(0.03), m(0.15));
  c.lineTo(w - m(0.03), m(0.15));
  c.stroke();
  // the name, written and scratched out
  c.strokeStyle = 'rgba(46,46,50,0.75)';
  c.lineWidth = 2.2;
  c.beginPath();
  c.moveTo(m(0.032), m(0.068));
  for (let i = 0; i < 90; i++) c.lineTo(m(0.032 + random() * 0.076), m(0.052 + random() * 0.03));
  c.stroke();
  c.strokeStyle = 'rgba(40,40,44,0.5)';
  c.lineWidth = 1.5;
  c.strokeRect(w - m(0.095), m(0.05), m(0.065), m(0.045));
  drawPhotograph(c, w / 2 - m(0.05), m(0.018), m(0.1));
  // the questions, and room to answer them
  c.fillStyle = '#17151a';
  c.font = `${m(QUESTION_EM)}px ${SCHOOL_FONT}`;
  c.textBaseline = 'alphabetic';
  const language = lang();
  for (let i = 0; i < 4; i++) {
    const y = m(QUESTION_TOP + i * QUESTION_STEP);
    if (i < count) c.fillText(QUESTIONS[i][language], m(0.032), y + m(0.012));
    c.strokeStyle = 'rgba(70,84,104,0.34)';
    c.lineWidth = 1.6;
    for (let line = 1; line <= 2; line++) {
      c.beginPath();
      c.moveTo(m(0.032), y + m(0.012) + m(0.02) * line);
      c.lineTo(w - m(0.032), y + m(0.012) + m(0.02) * line);
      c.stroke();
    }
  }
}

/** What others left on the desk: cuts, ink, a tally. */
function drawDeskTop(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(9);
  c.clearRect(0, 0, w, h);
  // the sheet's own weight on the wood
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.75)';
  c.shadowBlur = 22;
  c.fillStyle = 'rgba(0,0,0,0.5)';
  c.fillRect(w * 0.5 - 0.2 * 1000, h * 0.5 - 0.24 * 1000, 0.36 * 1000, 0.46 * 1000);
  c.restore();
  c.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    c.strokeStyle = `rgba(${random() > 0.4 ? '20,14,10' : '196,176,140'},${0.08 + random() * 0.26})`;
    c.lineWidth = 0.6 + random() * 1.4;
    const x = random() * w;
    const y = random() * h;
    const a = random() * Math.PI;
    const l = 8 + random() * 70;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    c.stroke();
  }
  // tally marks, cut deep in the corner
  c.strokeStyle = 'rgba(16,11,8,0.7)';
  c.lineWidth = 2.6;
  for (let t = 0; t < 14; t++) {
    const x = w * 0.78 + (t % 5) * 11 + Math.floor(t / 5) * 66;
    if (x > w - 8) continue;
    c.beginPath();
    c.moveTo(x, h * 0.12);
    c.lineTo(x + 3, h * 0.26);
    c.stroke();
  }
  for (let i = 0; i < 7; i++) {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(10,16,30,0.5)');
    g.addColorStop(1, 'rgba(10,16,30,0)');
    c.save();
    c.translate(random() * w, random() * h);
    c.scale(6 + random() * 16, 6 + random() * 16);
    c.fillStyle = g;
    c.fillRect(-1, -1, 2, 2);
    c.restore();
  }
}

/** Boards marked for you: where the desk stood each evening, scuffs and old paint. */
function drawBoards(c: CanvasRenderingContext2D, w: number, h: number, pxPerMeter: number, zOf: (z: number) => number): void {
  const random = randomFrom(13);
  c.clearRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = 18 + random() * 90;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(6,5,4,${0.1 + random() * 0.2})`);
    g.addColorStop(1, 'rgba(6,5,4,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 160; i++) {
    c.strokeStyle = `rgba(190,180,162,${0.03 + random() * 0.08})`;
    c.lineWidth = 0.6 + random();
    const x = random() * w;
    const y = random() * h;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + (random() - 0.5) * 50, y + (random() - 0.5) * 16);
    c.stroke();
  }
  // a cross of tape at each place the desk has stood
  for (const mark of MARKS) {
    const y = h * zOf(mark - 0.42);
    const cx = w / 2;
    const arm = 0.16 * pxPerMeter;
    c.strokeStyle = 'rgba(214,206,186,0.72)';
    c.lineWidth = 0.05 * pxPerMeter;
    c.beginPath();
    c.moveTo(cx - arm, y - arm * 0.9);
    c.lineTo(cx + arm, y + arm * 0.9);
    c.moveTo(cx + arm, y - arm * 0.9);
    c.lineTo(cx - arm, y + arm * 0.9);
    c.stroke();
  }
}

const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const v1 = new Vector3();
const v2 = new Vector3();
const m1 = new Matrix4();
const q1 = new Quaternion();
const ONE = new Vector3(1, 1, 1);
const c1 = new Color();

/**
 * The exam you did not study for: alone on a bare stage at a school desk, in one hard white spot. Beyond the
 * footlights the rows climb into the dark, full of sacks with a hole for a face. Each time your eyes go down
 * to the paper the desk has moved a little nearer to them.
 */
export default class Exam extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x05090a, density: 0.03 },
    env: 'evening',
    envIntensity: 0.05,
    sky: 0,
    grade: { exposure: 1.15, saturation: 0.78, warmth: 0, tint: -0.02, flare: 0.003 },
  };
  film = { bloom: 1, bloomFrom: 0.85, grain: 0.42, scratches: 0.1, flicker: 0.02, weave: 0.0004 };
  focus = 14;
  aperture = HALL_APERTURE;
  drift = 0.35;
  fear = 0.2;

  private readonly deskTrack: GlideTrack;
  private readonly readTrack: GlideTrack;
  private readonly fearTrack: GlideTrack;
  private readonly desk = new Group();
  private readonly beam: Mesh;
  private readonly beamMaterial: ShaderMaterial;
  private readonly key = { position: [0, 0, 0] as Aim, target: [0, 0, 0] as Aim, color: KEY_COLOR, intensity: 0, angle: 6, penumbra: SPOT_EDGE };
  private readonly source: Mesh;
  private readonly sheet;
  private readonly seated: InstancedMesh[] = [];
  private readonly standing: InstancedMesh[] = [];
  private readonly rows = new Group();
  private readonly rear = new Group();
  private readonly mother: Crowd;
  private readonly herAt: { x: number; z: number };
  private readonly her = new Group();
  private readonly sweep;
  private readonly flashes: Mesh;
  private readonly footGlow: Uniform = { value: 1 };
  private readonly wave: Uniform = { value: -1 };
  private readonly glowMul: Uniform = { value: 0.55 * FLASH_GLOW };
  private readonly sitPose: Posing;
  private readonly standPose: Posing;
  private readonly clocks: { value: number }[] = [];
  private readonly added: string[] = [];
  private lastDesk = NaN;
  private herShown = false;
  private taken = false;
  private tone: RoomVoice | null = null;
  private silence: RoomVoice | null = null;
  private under: RoomVoice | null = null;

  constructor(ctx: RoomContext) {
    super(ctx);
    const times = SHOTS.map((s) => s.at / ctx.seconds);
    this.keys = SHOTS.map((shot) => ({
      t: shot.at / ctx.seconds,
      at: [0, shot.read ? READ_Y : UP_Y, MARKS[shot.mark] + (shot.read ? READ_BACK : UP_BACK)] as Aim,
      yaw: shot.yaw ?? 0,
      pitch: shot.pitch ?? (shot.read ? READ_PITCH : UP_PITCH[shot.mark]),
      fov: shot.fov ?? (shot.read ? READ_FOV : UP_FOV[shot.mark]),
    }));
    this.deskTrack = new GlideTrack(times, SHOTS.map((s) => MARKS[s.mark]));
    this.readTrack = new GlideTrack(times, SHOTS.map((s) => (s.read ? 1 : 0)));
    this.fearTrack = new GlideTrack([0, 8, 30, 44, 48, 54, 56].map((s) => s / ctx.seconds), [0.18, 0.3, 0.55, 0.96, 0.9, 0.5, 0.4]);
    this.sitPose = { uLift: { value: 0 }, uOpen: { value: 0 }, uShut: { value: 0 }, uWave: this.wave, uGlowMul: this.glowMul };
    this.standPose = { uLift: { value: 1 }, uOpen: { value: 0 }, uShut: { value: 0 }, uWave: this.wave, uGlowMul: this.glowMul };

    this.root.add(this.desk, this.rows, this.rear);
    this.buildHouse();
    const seats = this.buildSeats();
    this.buildPeople(seats);
    this.flashes = this.buildFlashes(seats);
    this.sheet = this.buildDesk();
    this.buildBehind();

    // she is a sack in a woman's shape, her hair gone white, a hole where her face should be
    const hers = { avatar: 'figure_woman', clip: 'f_idle_touch_hair_01', time: 0.1, skin: 'sack', face: 'hollow', white: false } as const;
    this.mother = this.kit.figures.crowd(hers, 1);
    this.mother.set(0, 0, 0, 0, 0);
    this.mother.commit();
    const shape = this.kit.figures.hero(hers);
    shape.update(hers.time);
    shape.root.updateMatrixWorld(true);
    const hipsAt = shape.bone('Bip01')!.getWorldPosition(new Vector3());
    const headAt = shape.bone('Bip01_Head')!.getWorldPosition(new Vector3());
    const hair = new Mesh(whiteHair(new Vector3(headAt.x - hipsAt.x, headAt.y + 0.095, headAt.z - hipsAt.z + 0.012), { strands: 320, length: [0.58, 1.02], seed: 23, fall: 5 }), new MeshStandardMaterial({ color: 0xece8dd, roughness: 0.5, emissive: new Color(0x6e6c66) }));
    hair.castShadow = true;
    for (const m of this.mother.root.children as InstancedMesh[]) {
      const cloth = (m.material as MeshStandardMaterial).clone();
      cloth.color.set(/head/.test(cloth.name) ? 0xc9c5b8 : 0x2e2d2a);
      m.material = cloth;
      m.castShadow = true;
    }
    this.her.add(this.mother.root, hair);
    this.her.visible = false;
    this.root.add(this.her);
    this.herAt = { x: HER_X, z: MARKS[3] - HER_GAP };

    // the spot and its lit air; the lamp itself is far, so that the beam is seen coming the whole way
    this.beamMaterial = new ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      uniforms: { uColor: { value: new Color(KEY_COLOR) }, uPower: { value: 0 }, uTime: { value: 0 }, uFrom: { value: new Vector3() }, uTo: { value: new Vector3() }, uWide: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    this.beam = new Mesh(new PlaneGeometry(2, 1, 1, 30).translate(0, 0.5, 0), this.beamMaterial);
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 3;
    this.root.add(this.beam);
    this.source = this.build.glow(BOOTH[0], BOOTH[1], BOOTH[2] + 0.2, 3.6, KEY_COLOR, 3.4, this.root, 5);
    this.source.visible = false;
    this.spots = [
      this.key,
      this.spot([0, 1.2, 10], [0, 9, -9], 0xa9bdbb, WASH_POWER, 34, 1),
      this.spot([0, 0.6, 4.2], [0, CLOCK_Y, ARCH_Z], 0xc8d4dc, CLOCK_POWER, 9, 0.7),
    ];
    this.aim(MARKS[0]);

    this.light([-7.5, 0.28, -0.25], PALETTE.warm, FOOT_POWER, 9);
    this.light([0, 0.28, -0.25], PALETTE.warm, FOOT_POWER, 9);
    this.light([7.5, 0.28, -0.25], PALETTE.warm, FOOT_POWER, 9);
    this.sweep = this.light([0, 1.6, -0.3], 0xe6eeff, 0, 6);
    this.light([0, 4.2, 17], 0x8ea6ac, 30, 14);

    this.light([-11.4, 5.5, 7.5], 0x8fa3b0, 70, 14);
    this.light([11.4, 5.5, 11.5], 0x8fa3b0, 70, 14);

    this.clocks.push(this.build.motes(420, { x: [-3.2, 3.2], y: [0.2, 5], z: [0.5, 14] }, this.root, { size: 0.008, strength: 0.42 }).time);
    this.clocks.push(this.build.motes(300, { x: [-12, 12], y: [0, 9], z: [-18, 0] }, this.root, { size: 0.012, strength: 0.14, seed: 47 }).time);

    for (const front of [this.desk, this.rows, this.her]) {
      front.traverse((o) => {
        const mesh = o as Mesh;
        const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (mesh.isMesh && materials.every((m) => !m.transparent)) mesh.renderOrder = IN_FRONT_FIRST;
      });
    }
    this.buildSound();
  }

  /** Stage, wings, the arch with its curtains and its clock, and the hall's walls. */
  private buildHouse(): void {
    const b = this.build;
    const k = this.kit;
    const root = this.root;
    const paint = b.paint(0x0d1213, 0.92);

    const boards = k.surface('wood_floor_dark', 2, { color: new Color(1.12, 1.2, 1.3), roughness: 0.92 });
    const stage = k.floor(-HALF, HALF, LIP_Z, STAGE_BACK, 0, boards);
    stage.receiveShadow = true;
    root.add(stage);
    const span = STAGE_BACK - LIP_Z;
    const PX = 64;
    const marks = b.label(7, span, (c, w, h) => drawBoards(c, w, h, PX, (z) => (STAGE_BACK - z) / span), { px: PX, transparent: true, roughness: 0.9 });
    marks.mesh.rotation.x = -Math.PI / 2;
    marks.mesh.position.set(0, 0.004, (STAGE_BACK + LIP_Z) / 2);
    (marks.mesh.material as MeshStandardMaterial).depthWrite = false;
    marks.mesh.receiveShadow = true;
    root.add(marks.mesh);

    const backstage = b.box(2 * HALF, STAGE_BACK - ARCH_Z, STAGE_H, { walls: paint, ceiling: paint, skip: ['+z', '-z'] }, root);
    backstage.position.z = STAGE_BACK;
    b.wall(0, STAGE_BACK, 2 * HALF, STAGE_H, '-z', k.surface('plaster_damaged', 1.85, { color: new Color(0x4b4845), roughness: 0.95 }), root);
    const damask = b.damask(PALETTE.damaskTeal, 1.5);
    const hall = b.box(2 * HALF, HALL_DEPTH + ARCH_Z, HALL_H, { walls: damask, ceiling: paint, skip: ['-z'] }, root);
    hall.position.set(0, HALL_FLOOR, ARCH_Z);
    const steps = new Mesh(terraces(), b.carpet('#120f0e', 1));
    steps.receiveShadow = true;
    root.add(steps);

    const lip = k.block(2 * HALF, 1.2, 0.14, paint);
    lip.position.set(0, -0.601, LIP_Z - 0.07);
    root.add(lip);
    const trough = k.block(2 * FOOT_SPAN + 1, 0.1, 0.08, k.surface('steel_scuffed', 1, { color: new Color(0x4d4a45), metalness: 0.6 }));
    trough.position.set(0, 0.05, -0.2);
    root.add(trough);

    // the arch, turned toward the one who is on the stage: in a dream a theatre has no back
    const plaster = k.surface('plaster_pale', 2, { color: new Color(0x2a2a26), roughness: 0.85 });
    const gilt = k.surface('plaster_pale', 1.2, { color: new Color(0x8a6d3e), roughness: 0.42, metalness: 0.4 });
    const wall = new Mesh(archRing(ARCH_HALF + 1.3, ARCH_TOP + 1.2, 0.3, HALF - ARCH_HALF - 1.3, 0.2, 0, true), plaster);
    wall.position.z = ARCH_Z - 0.2;
    root.add(wall);
    const rings: readonly [number, number, number, Material][] = [
      [1.0, 0.3, 0.42, gilt],
      [0.32, 0.68, 0.24, plaster],
      [0, 0.32, 0.6, gilt],
    ];
    for (const [inset, width, depth, material] of rings) {
      const ring = new Mesh(archRing(ARCH_HALF + inset, ARCH_TOP + inset, 0.3, width, depth, 0.035), material);
      ring.position.z = ARCH_Z - 0.2;
      ring.receiveShadow = true;
      root.add(ring);
    }

    const velvet = k.surface('velvet_red', 0.3, { color: new Color(0xb3343a), roughness: 0.96 });
    const TIE = 0.72;
    const gather = (v: number) => (v < TIE ? lerp(1, 0.26, smootherstep(v / TIE)) : lerp(0.26, 0.44, (v - TIE) / (1 - TIE)));
    const leftDrape = new Mesh(drape(4.8, ARCH_TOP + 0.55, { folds: 17, depth: 0.1, gather, seed: 1.3, ny: 32 }), velvet);
    leftDrape.position.set(-ARCH_HALF - 0.5, ARCH_TOP + 0.55, ARCH_Z + 0.05);
    leftDrape.receiveShadow = true;
    root.add(leftDrape);
    const rightDrape = new Mesh(drape(4.8, ARCH_TOP + 0.55, { folds: 17, depth: 0.1, gather, seed: 2.9, ny: 32, mirror: true }), velvet);
    rightDrape.position.set(ARCH_HALF + 0.5, ARCH_TOP + 0.55, ARCH_Z + 0.05);
    rightDrape.receiveShadow = true;
    root.add(rightDrape);
    const valance = new Mesh(drape(2 * ARCH_HALF + 2.4, 1.5, { folds: 46, depth: 0.08, sag: 0.58, swags: 5, seed: 0.6, ny: 14 }), velvet);
    valance.position.set(-ARCH_HALF - 1.2, ARCH_TOP + 0.75, ARCH_Z + 0.14);
    root.add(valance);

    // the clock hangs in the opening, on two rods: it is half past
    const dial = k.prop('wall_clock', [0, CLOCK_Y, ARCH_Z + 0.25], { scale: CLOCK_SCALE, anchor: 'center' }, root);
    setClock(rigClock(dial), 6.5 * 3600);
    const brass = new MeshStandardMaterial({ color: 0x4b3a20, roughness: 0.5, metalness: 0.7 });
    const radius = (0.32 * CLOCK_SCALE) / 2;
    for (const side of [-1, 1]) {
      const rod = new Mesh(new CylinderGeometry(0.014, 0.014, 2, 8), brass);
      rod.position.set(side * radius * 0.6, CLOCK_Y + radius + 0.8, ARCH_Z + 0.24);
      root.add(rod);
    }

    // the footlights, seen from behind the trough
    const lamps = k.props('stage_light', FOOT_COUNT, { scale: 0.34, rotation: [58, 0, 0] });
    for (let i = 0; i < FOOT_COUNT; i++) lamps.set(i, -FOOT_SPAN + (2 * FOOT_SPAN * i) / (FOOT_COUNT - 1), 0.012, -0.08, 0);
    lamps.commit();
    root.add(lamps.root);
    const random = randomFrom(29);
    const glow = pointField(
      FOOT_COUNT,
      (i, at, flash) => {
        at.set([-FOOT_SPAN + (2 * FOOT_SPAN * i) / (FOOT_COUNT - 1), 0.13, 0.02], i * 3);
        flash.set([2, 0.5, i % 7 === 3 ? 0.08 : 0.32 + random() * 0.4], i * 3);
      },
      0xffb066,
      { uWave: this.wave, uLevel: this.footGlow },
    );
    root.add(glow);

    const sheenCanvas = document.createElement('canvas');
    sheenCanvas.width = 256;
    sheenCanvas.height = 64;
    const sc = sheenCanvas.getContext('2d')!;
    const fall = sc.createLinearGradient(0, 0, 0, 64);
    fall.addColorStop(0, 'rgba(255,190,120,0)');
    fall.addColorStop(1, 'rgba(255,190,120,1)');
    sc.fillStyle = fall;
    sc.fillRect(0, 0, 256, 64);
    sc.globalCompositeOperation = 'destination-in';
    const ends = sc.createLinearGradient(0, 0, 256, 0);
    ends.addColorStop(0, 'rgba(0,0,0,0)');
    ends.addColorStop(0.12, 'rgba(0,0,0,1)');
    ends.addColorStop(0.88, 'rgba(0,0,0,1)');
    ends.addColorStop(1, 'rgba(0,0,0,0)');
    sc.fillStyle = ends;
    sc.fillRect(0, 0, 256, 64);
    const sheenMap = new CanvasTexture(sheenCanvas);
    sheenMap.colorSpace = SRGBColorSpace;
    const sheen = new Mesh(new PlaneGeometry(2 * FOOT_SPAN + 5, SHEEN_DEPTH), new MeshBasicMaterial({ map: sheenMap, transparent: true, opacity: SHEEN_POWER, depthWrite: false, blending: AdditiveBlending }));
    sheen.rotation.x = -Math.PI / 2;
    sheen.position.set(0, 0.006, SHEEN_DEPTH / 2 - 0.1);
    sheen.renderOrder = 2;
    root.add(sheen);

    // masking cloths in the wings, one behind the other
    const blackCloth = k.surface('velvet_red', 0.3, { color: new Color(0x8b858b), roughness: 1 });
    const cloths: BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const g = drape(5, 9, { folds: 11, depth: 0.09, seed: 1 + i * 1.7 + side, ny: 10, mirror: side > 0 });
        g.translate(side * (HALF - 0.2), 9, 4.5 + i * 4.6);
        cloths.push(g, turned(g));
      }
    }
    const wings = new Mesh(mergeGeometries(cloths)!, blackCloth);
    root.add(wings);

    // up in the flies, pipes with dead lamps
    const pipe = k.surface('steel_scuffed', 1, { color: new Color(0x3a3a38), metalness: 0.7 });
    const hung = k.props('stage_light', 10, { scale: 0.8, rotation: [180, 0, 0] });
    for (let i = 0; i < 2; i++) {
      const z = 5 + i * 5.2;
      const bar = new Mesh(new CylinderGeometry(0.03, 0.03, 14, 8).rotateZ(Math.PI / 2), pipe);
      bar.position.set(0, 8.6, z);
      root.add(bar);
      for (let n = 0; n < 5; n++) hung.set(i * 5 + n, -5 + n * 2.5 + i, 8.2, z + 0.1, 0);
    }
    hung.commit();
    root.add(hung.root);
  }

  /** The seats themselves. */
  private buildSeats(): Seat[] {
    const random = randomFrom(61);
    const seats: Seat[] = [];
    for (let row = 0; row < ROWS; row++) {
      const half = ROW_HALF + ROW_WIDENS * row;
      for (const side of [-1, 1]) {
        for (let n = 0; ; n++) {
          const x = side * (AISLE + SEAT_STEP * (n + 0.5));
          if (Math.abs(x) > half) break;
          const z = rowZ(row, x);
          seats.push({
            x,
            y: rowY(row),
            z,
            heading: Math.atan2(-x, FACING_Z - z) * 0.9 + (random() - 0.5) * 0.06,
            row,
            lift: clamp((row / ROWS) * 0.62 + random() * 0.16, 0, 0.8),
            wave: clamp(((x / SWEEP_HALF + 1) / 2) * 0.92 + (row / ROWS) * 0.06 + random() * 0.02, 0, 1),
            tone: 0.72 + random() * 0.34,
          });
        }
      }
    }
    const chairs = this.kit.props('seat_theatre', seats.length);
    chairs.root.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) mesh.material = (mesh.material as MeshStandardMaterial).clone();
      if (mesh.isMesh) (mesh.material as MeshStandardMaterial).color.multiplyScalar(0.3);
    });
    seats.forEach((s, i) => chairs.set(i, s.x, s.y, s.z - 0.08, s.heading));
    chairs.commit();
    this.rows.add(chairs.root);
    return seats;
  }

  /** Bodies of a list of seats, one instanced mesh a part. */
  private place(parts: readonly Part[], list: readonly Seat[], parent: Object3D, into: InstancedMesh[]): void {
    for (const p of parts) {
      const data = new Float32Array(list.length * 2);
      list.forEach((s, i) => {
        data[i * 2] = s.lift;
        data[i * 2 + 1] = s.wave;
      });
      p.geometry.setAttribute('aInst', new InstancedBufferAttribute(data, 2));
      const mesh = new InstancedMesh(p.geometry, p.material, list.length);
      mesh.frustumCulled = false;
      list.forEach((s, i) => {
        mesh.setMatrixAt(i, m1.compose(v1.set(s.x, s.y, s.z), q1.setFromAxisAngle(UP, s.heading), ONE));
        mesh.setColorAt(i, c1.setRGB(s.tone, s.tone * 0.97, s.tone * 0.9));
      });
      parent.add(mesh);
      into.push(mesh);
    }
  }

  /** Everyone, seated and bowed; the front rows also standing, in the same seats. */
  private buildPeople(seats: readonly Seat[]): void {
    const figures = this.kit.figures;
    const book = figures as unknown as { clips: Map<string, AnimationClip> };
    const man = this.kit.model('figure_man');
    const find = (name: string) => man.animations.find((a) => a.name === name)!;
    const sit = find('m_sit_chair_idle_roll_head');
    const clap = find('m_claphands_02');
    const ARM = /_(Clavicle|UpperArm|Forearm|Hand|Finger\d+)/;
    const register = (clip: AnimationClip) => {
      book.clips.set(clip.name, clip);
      this.added.push(clip.name);
      return clip.name;
    };

    // when in its own clip the hands are furthest apart and when they meet
    const clapper = figures.hero({ avatar: 'figure_man', clip: 'm_claphands_02' });
    const left = clapper.bone('Bip01_L_Hand')!;
    const right = clapper.bone('Bip01_R_Hand')!;
    const a = new Vector3();
    const b = new Vector3();
    const samples: { time: number; apart: number }[] = [];
    const STEP = 1 / 30;
    for (let time = 0; time < clap.duration; time += STEP) {
      clapper.update(time === 0 ? 0 : STEP);
      clapper.root.updateMatrixWorld(true);
      samples.push({ time, apart: left.getWorldPosition(a).distanceTo(right.getWorldPosition(b)) });
    }
    const shut = samples.reduce((best, s) => (s.apart < best.apart ? s : best), samples[0]);
    const open = samples.filter((s) => Math.abs(s.time - shut.time) < 1).reduce((best, s) => (s.apart > best.apart ? s : best), shut);

    // the head goes down by the neck and then by itself, turned about the axis across the shoulders
    const bowing = figures.hero({ avatar: 'figure_man', clip: 'm_sit_chair_idle_roll_head' });
    bowing.update(SIT_TIME);
    bowing.root.updateMatrixWorld(true);
    const neck = bowing.bone('Bip01_Neck')!;
    const head = bowing.bone('Bip01_Head')!;
    const parent = neck.parent!.getWorldQuaternion(new Quaternion());
    const nod = new Quaternion().setFromAxisAngle(X_AXIS, BOW_NECK);
    const neckLocal = parent.clone().invert().multiply(nod).multiply(parent).multiply(neck.quaternion);
    const neckWorld = parent.clone().multiply(neckLocal);
    nod.setFromAxisAngle(X_AXIS, BOW_HEAD);
    const headLocal = neckWorld.clone().invert().multiply(nod).multiply(neckWorld).multiply(head.quaternion);

    const seatOnly = [{ clip: sit, time: SIT_TIME }];
    const armsFrom = (time: number) => [...seatOnly, { clip: clap, time, only: ARM }];
    const stillSit = register(stillClip('exam_sit', seatOnly, man.scene));
    const stillBow = register(
      stillClip('exam_bow', seatOnly, man.scene, [
        new QuaternionKeyframeTrack('Bip01_Neck.quaternion', [0], neckLocal.toArray()),
        new QuaternionKeyframeTrack('Bip01_Head.quaternion', [0], headLocal.toArray()),
      ]),
    );
    const stillOpen = register(stillClip('exam_open', armsFrom(open.time), man.scene));
    const stillShut = register(stillClip('exam_shut', armsFrom(shut.time), man.scene));
    const partsOf = (crowd: Crowd) => crowd.root.children as InstancedMesh[];
    const sack = (clip: string) => partsOf(this.build.sack(1, { clip, time: 0 }));
    const up = sack(stillSit);
    const bowed = sack(stillBow);
    const opened = sack(stillOpen);
    const shutted = sack(stillShut);
    const seatedParts = up.map((mesh, i): Part => {
      const g = mesh.geometry.clone();
      g.setAttribute('aA', delta(bowed[i].geometry, mesh.geometry));
      g.setAttribute('aB', delta(opened[i].geometry, mesh.geometry));
      g.setAttribute('aC', delta(shutted[i].geometry, opened[i].geometry));
      return { geometry: g, material: posedMaterial(mesh.material as MeshStandardMaterial, this.sitPose, /head/.test((mesh.material as Material).name) ? SACK_HEAD : SACK_BODY) };
    });

    const near = seats.filter((s) => s.row < NEAR_ROWS && Math.abs(s.x) <= NEAR_HALF);
    const mid = seats.filter((s) => s.row < MID_ROWS && !(s.row < NEAR_ROWS && Math.abs(s.x) <= NEAR_HALF));
    const far = seats.filter((s) => s.row >= MID_ROWS);
    const isHead = (p: Part) => /head/.test(p.material.name);
    const coarser = (head: number, body: number) => seatedParts.map((p): Part => ({ geometry: simplified(p.geometry, isHead(p) ? head : body), material: p.material }));
    this.place(coarser(0.02, 0.032), near, this.rows, this.seated);
    const everyone: InstancedMesh[] = [];
    this.place(coarser(0.055, 0.12), mid, this.rows, everyone);
    this.place(coarser(0.1, 0.22), far, this.rows, everyone);

    // those who stand: old people in dark clothes, their hair gone white, no face
    const photographer = this.kit.model('photographer');
    const take = photographer.animations.find((c) => c.name === 'm_take_picture')!;
    book.clips.set(take.name, take);
    this.added.push(take.name);
    const poses = TAKE_TIMES.map((time, i) => register(stillClip(`exam_take_${i}`, [{ clip: take, time }], man.scene)));
    const standers = near.map((s, i) => ({ ...s, lift: 0, tone: 0.8 + (i % 5) * 0.06 }));
    const men = standers.filter((_, i) => i % 3 !== 1);
    const women = standers.filter((_, i) => i % 3 === 1);
    const camera = pressCamera();
    const whiteCanvas = document.createElement('canvas');
    whiteCanvas.width = whiteCanvas.height = 2;
    const whiteContext = whiteCanvas.getContext('2d')!;
    whiteContext.fillStyle = '#ffffff';
    whiteContext.fillRect(0, 0, 2, 2);
    const whiteMap = new CanvasTexture(whiteCanvas);
    whiteMap.colorSpace = SRGBColorSpace;
    for (const [avatar, list] of [
      ['figure_man', men],
      ['figure_woman', women],
    ] as const) {
      const three = poses.map((clip) => partsOf(this.build.sack(1, { avatar, clip, time: 0 })));
      const zeros = (n: number) => new Float32BufferAttribute(new Float32Array(n * 3), 3);
      const parts = three[0].map((mesh, i): Part => {
        const g = mesh.geometry.clone();
        g.setAttribute('aA', zeros(mesh.geometry.getAttribute('position').count));
        g.setAttribute('aB', delta(three[1][i].geometry, mesh.geometry));
        g.setAttribute('aC', delta(three[2][i].geometry, three[1][i].geometry));
        const isHead = /head/.test((mesh.material as Material).name);
        return { geometry: simplified(g, isHead ? 0.012 : 0.02), material: posedMaterial(mesh.material as MeshStandardMaterial, this.standPose, isHead ? SACK_STANDING_HEAD : SACK_BODY) };
      });
      const cloth = parts.find((p) => !/head/.test(p.material.name))!.material as MeshStandardMaterial;
      const { hands, heads, chests, neck } = this.holdings(avatar);
      const cameraPart = (source: BufferGeometry, color: number): Part => ({ geometry: this.posedProp(source, hands), material: posedMaterial(cloth, this.standPose, color) });
      const chrome = cameraPart(camera.chrome, CAMERA_CHROME);
      const chromeMaterial = chrome.material as MeshStandardMaterial;
      chromeMaterial.map = whiteMap;
      chromeMaterial.roughness = CHROME_ROUGHNESS;
      chromeMaterial.emissive.set(CHROME_GLOW);
      chromeMaterial.side = DoubleSide;
      const bulb = cameraPart(camera.bulb, BULB_WHITE);
      const bulbMaterial = bulb.material as MeshStandardMaterial;
      bulbMaterial.map = whiteMap;
      bulbMaterial.emissive.set(BULB_GLOW);
      const glass = cameraPart(camera.lens, CAMERA_GLASS);
      (glass.material as MeshStandardMaterial).roughness = GLASS_ROUGHNESS;
      const coat = coatFront(three[2].filter((mesh) => !/head/.test((mesh.material as Material).name)).map((mesh) => mesh.geometry), neck);
      const coatPart = (source: BufferGeometry, color: number): Part => ({ geometry: this.posedProp(source, chests), material: posedMaterial(cloth, this.standPose, color) });
      const lapels = coatPart(coat.lapels, COAT_LAPEL);
      (lapels.material as MeshStandardMaterial).roughness = LAPEL_ROUGHNESS;
      const hair = whiteHair(new Vector3(heads[0].x, heads[0].y + 0.095, heads[0].z + 0.012), { strands: avatar === 'figure_man' ? 130 : 190, length: avatar === 'figure_man' ? [0.3, 0.62] : [0.45, 0.92], seed: 11, around: HAIR_AROUND, behind: HAIR_BEHIND });
      const hairCount = hair.getAttribute('position').count;
      const follows = (to: Vector3, from: Vector3) => {
        const data = new Float32Array(hairCount * 3);
        for (let i = 0; i < hairCount; i++) to.clone().sub(from).toArray(data, i * 3);
        return new Float32BufferAttribute(data, 3);
      };
      hair.setAttribute('aA', zeros(hairCount));
      hair.setAttribute('aB', follows(heads[1], heads[0]));
      hair.setAttribute('aC', follows(heads[2], heads[1]));
      const hairMaterial = posedMaterial(cloth, this.standPose, HAIR_WHITE);
      hairMaterial.map = whiteMap;
      hairMaterial.emissive.set(HAIR_GLOW);
      this.place([...parts, coatPart(coat.opening, COAT_OPENING), lapels, cameraPart(camera.shell, CAMERA_BODY), glass, chrome, bulb, { geometry: hair, material: hairMaterial }], list, this.rows, this.standing);
    }
    for (const m of this.standing) m.visible = false;
  }

  /** Where the camera, the head and the coat's front go in each pose of taking a picture (bake space: hips over the origin). */
  private holdings(avatar: 'figure_man' | 'figure_woman'): { hands: Matrix4[]; heads: Vector3[]; chests: Matrix4[]; neck: Vector3 } {
    const hero = this.kit.figures.hero({ avatar, clip: 'm_take_picture' });
    const hand = hero.bone('Bip01_R_Hand')!;
    const head = hero.bone('Bip01_Head')!;
    const hips = hero.bone('Bip01')!;
    const chest = hero.bone('Bip01_Spine2') ?? hips;
    let last = 0;
    const handAt: Matrix4[] = [];
    const chestAt: Matrix4[] = [];
    const hipsAt: Vector3[] = [];
    const heads: Vector3[] = [];
    for (const time of TAKE_TIMES) {
      hero.update(time - last);
      last = time;
      hero.root.updateMatrixWorld(true);
      handAt.push(hand.matrixWorld.clone());
      chestAt.push(chest.matrixWorld.clone());
      const h = hips.getWorldPosition(new Vector3());
      hipsAt.push(h);
      heads.push(head.getWorldPosition(new Vector3()).sub(new Vector3(h.x, 0, h.z)));
    }
    const raised = head.getWorldPosition(new Vector3());
    const held = new Matrix4().makeTranslation(raised.x, raised.y + 0.07, raised.z + 0.2);
    const grip = handAt[2].clone().invert().multiply(held);
    const hands = handAt.map((hm, i) => {
      const placed = hm.clone().multiply(grip);
      placed.elements[12] -= hipsAt[i].x;
      placed.elements[14] -= hipsAt[i].z;
      return placed;
    });
    // the coat's front is laid on the last pose and carried back with the chest to the others
    const lastHips = hipsAt[2];
    const neck = (hero.bone('Bip01_Neck') ?? head).getWorldPosition(new Vector3()).sub(new Vector3(lastHips.x, 0, lastHips.z));
    const laid = chestAt[2].clone().invert().multiply(new Matrix4().makeTranslation(lastHips.x, 0, lastHips.z));
    const chests = chestAt.map((cm, i) => new Matrix4().makeTranslation(-hipsAt[i].x, 0, -hipsAt[i].z).multiply(cm).multiply(laid));
    return { hands, heads, chests, neck };
  }

  /** A small rigid thing moved with the same three poses as the body that holds it. */
  private posedProp(source: BufferGeometry, poses: readonly Matrix4[]): BufferGeometry {
    const g = source.clone();
    const p = g.getAttribute('position') as BufferAttribute;
    const count = p.count;
    const moved = poses.map((pose) => {
      const out = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) v1.fromBufferAttribute(p, i).applyMatrix4(pose).toArray(out, i * 3);
      return out;
    });
    const difference = (to: Float32Array, from: Float32Array) => new Float32BufferAttribute(to.map((value, i) => value - from[i]), 3);
    g.setAttribute('position', new Float32BufferAttribute(moved[0], 3));
    g.setAttribute('aA', new Float32BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aB', difference(moved[1], moved[0]));
    g.setAttribute('aC', difference(moved[2], moved[1]));
    return g;
  }

  /** One flash for every seat, where a camera would be held. */
  private buildFlashes(seats: readonly Seat[]): Mesh {
    const random = randomFrom(83);
    const field = pointField(
      seats.length,
      (i, at, flash) => {
        const s = seats[i];
        const standing = s.row < NEAR_ROWS && Math.abs(s.x) <= NEAR_HALF;
        const toStage = standing ? 0.3 : 0.22;
        // those who stand flash from the dish at the side of the camera
        const side = standing ? DISH_X * CAMERA_SIZE : 0;
        at.set([s.x + Math.sin(s.heading) * toStage + Math.cos(s.heading) * side, s.y + (standing ? 1.55 : 1.1), s.z + Math.cos(s.heading) * toStage - Math.sin(s.heading) * side], i * 3);
        flash.set([s.wave, (standing ? 0.8 : 1.25) + random() * 0.4, 0], i * 3);
      },
      0xe9f1ff,
      { uWave: this.wave, uLevel: { value: 0 } },
    );
    field.visible = false;
    this.root.add(field);
    return field;
  }

  /** School varnish gone dark with use. */
  private dull(object: Object3D): void {
    object.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const m = (mesh.material as MeshStandardMaterial).clone();
      m.color.setRGB(0.4, 0.33, 0.27);
      m.roughness = 0.62;
      mesh.material = m;
    });
  }

  /** The desk, its chair, the sheet, the pencil, and what is behind the chair. All of it travels together. */
  private buildDesk(): ReturnType<Exam['build']['label']> {
    const k = this.kit;
    const b = this.build;
    const desk = this.desk;
    const model = k.prop('school_desk', [0, 0, 0], { scale: DESK_SCALE, castShadow: true }, desk);
    this.dull(model);
    const top = new Box3().setFromObject(model).max.y;
    const chair = k.prop('school_chair', [0, 0, 0.98], { scale: CHAIR_SCALE, castShadow: true }, desk);
    this.dull(chair);
    b.contactShadow(0, 0.05, 0.62, desk, 0.7);
    b.contactShadow(0, 0.98, 0.42, desk, 0.6);

    const scars = b.label(0.62, 0.48, drawDeskTop, { px: 1000, transparent: true, roughness: 0.8 });
    scars.mesh.rotation.x = -Math.PI / 2;
    scars.mesh.position.set(0, top + 0.0012, 0);
    (scars.mesh.material as MeshStandardMaterial).depthWrite = false;
    desk.add(scars.mesh);

    const sheet = b.label(PAPER_W, PAPER_H, (c, w, h) => drawSheet(c, w, h, 0), { px: PAPER_PX, roughness: 0.9 });
    sheet.mesh.rotation.set(-Math.PI / 2, 0, 0.035);
    sheet.mesh.position.set(-0.02, top + 0.003, -0.015);
    (sheet.mesh.material as MeshStandardMaterial).color.setScalar(0.86);
    sheet.mesh.receiveShadow = true;
    desk.add(sheet.mesh);

    // a pencil snapped in two: each half keeps its own end and its break is left ragged
    const random = randomFrom(3);
    const piece = (keepHigh: boolean, at: V3, turn: number) => {
      const p = k.prop('pencil', at, { scale: PENCIL_SCALE, rotation: [0, turn, 0], castShadow: true }, desk);
      p.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry = mesh.geometry.clone();
        const attr = mesh.geometry.getAttribute('position') as BufferAttribute;
        let low = Infinity;
        let high = -Infinity;
        for (let i = 0; i < attr.count; i++) {
          low = Math.min(low, attr.getZ(i));
          high = Math.max(high, attr.getZ(i));
        }
        const cut = lerp(low, high, 0.52);
        for (let i = 0; i < attr.count; i++) {
          const z = attr.getZ(i);
          const ragged = cut + (random() - 0.5) * (high - low) * 0.05;
          if (keepHigh ? z < ragged : z > ragged) attr.setZ(i, ragged);
        }
      });
    };
    piece(true, [0.235, top + 0.002, -0.17], 38);
    piece(false, [0.262, top + 0.002, -0.05], 22);
    return sheet;
  }

  /** Behind you: a plate camera trained on your back and a man without a head beside it; further, desks nobody came back to. */
  private buildBehind(): void {
    const k = this.kit;
    const b = this.build;
    k.prop('antique_camera', [0.42, 0, 3.05], { scale: 1.55, rotation: [0, 180, 0] }, this.desk);
    const man = b.headless(1, { tint: 0x3a3f46 });
    man.set(0, -0.42, 0, 3.25, Math.PI);
    man.commit();
    this.desk.add(man.root);
    b.contactShadow(0.42, 3.05, 0.5, this.desk, 0.7);
    b.contactShadow(-0.42, 3.25, 0.5, this.desk, 0.75);

    const COLS = 4;
    const RANKS = 3;
    const desks = k.props('school_desk', COLS * RANKS, { scale: DESK_SCALE });
    this.dull(desks.root);
    const chairs = k.props('school_chair', COLS * RANKS, { scale: CHAIR_SCALE });
    this.dull(chairs.root);
    const sheets: BufferGeometry[] = [];
    const top = 0.883 * DESK_SCALE + 0.003;
    for (let r = 0; r < RANKS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = (c - (COLS - 1) / 2) * 2.1;
        const z = 15.4 + r * 2.5;
        desks.set(r * COLS + c, x, 0, z, 0);
        chairs.set(r * COLS + c, x, 0, z + 0.82, 0);
        sheets.push(new PlaneGeometry(0.3, 0.4).rotateX(-Math.PI / 2).rotateY((c * 0.07 - 0.1) * (r + 1)).translate(x, top, z));
      }
    }
    desks.commit();
    chairs.commit();
    this.rear.add(desks.root, chairs.root, new Mesh(mergeGeometries(sheets)!, new MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.9, emissive: new Color(0x96a2a2), emissiveIntensity: 0.05 })));

    const waiting = b.headless(2, { tint: 0x2a2e33 });
    waiting.set(0, -12.2, 0, 7.2, Math.PI / 2);
    waiting.set(1, 12.4, 0, 11.9, -Math.PI / 2);
    waiting.commit();
    this.root.add(waiting.root);
  }

  /** All that the room does once, in order. */
  private buildSound(): void {
    this.beat(0, () => {
      this.tone = this.sound.bed('rooms/theatre_tone.mp3', { gain: 0.22, fade: 0.4 });
      this.silence = this.sound.bed('rooms/hall_silence.mp3', { gain: 0.5, fade: 0.8 });
      this.under = this.sound.bed('rooms/dream_drone_low.mp3', { gain: 0.1, fade: 6 });
    });
    this.beat(ON_AT, () => this.sound.play('rooms/power_thunk.mp3', { gain: 0.5, reverb: 0.3 }));
    this.beat(3.1, () => this.sound.play('rooms/cough_far_2.mp3', { gain: 0.3, reverb: 0.5, lowpass: 3000, pan: -0.25 }));
    this.beat(3.7, () => this.sound.play('rooms/crowd_rise.mp3', { gain: 0.4, reverb: 0.5 }));
    this.beat(4.7, () => this.sound.play('rooms/seat_creak_3.mp3', { gain: 0.25, reverb: 0.4, pan: 0.45 }));
    this.beat(8.7, () => this.sound.play('rooms/pencil_snap.mp3', { gain: 0.5, reverb: 0.3 }));
    this.beat(12.7, () => this.sound.play('rooms/seat_creak_1.mp3', { gain: 0.22, reverb: 0.4, pan: -0.6 }));
    this.beat(17.2, () => this.sound.play('rooms/paper_rustle_1.mp3', { gain: 0.2, reverb: 0.2, pan: 0.35 }));
    this.beat(17.9, () => this.sound.play('rooms/cough_far_1.mp3', { gain: 0.28, reverb: 0.5, lowpass: 3000, pan: 0.55 }));
    this.beat(22.8, () => this.sound.play('rooms/paper_rustle_2.mp3', { gain: 0.24, reverb: 0.2, pan: -0.4 }));
    this.beat(23.9, () => this.sound.play('rooms/seat_creak_2.mp3', { gain: 0.25, reverb: 0.4, pan: 0.2 }));
    this.beat(26.8, () => this.sound.play('rooms/cough_man.mp3', { gain: 0.25, reverb: 0.5, lowpass: 3000, pan: -0.7 }));
    this.beat(28.2, () => this.sound.play('rooms/seat_creak_4.mp3', { gain: 0.25, reverb: 0.4, pan: 0.6 }));
    this.beat(29.3, () => this.sound.play('rooms/paper_rustle_3.mp3', { gain: 0.2, reverb: 0.2, pan: 0.1 }));
    this.beat(36.4, () => this.sound.play('rooms/cough_far_3.mp3', { gain: 0.16, reverb: 0.5, lowpass: 3000, pan: -0.3 }));

    QUESTIONS.forEach((q, i) => {
      this.beat(q.at - 0.34, () => this.sound.play('rooms/page_turn.mp3', { gain: 0.4, reverb: 0.1 }));
      this.beat(q.at, () => this.sheet.redraw((c, w, h) => drawSheet(c, w, h, i + 1)));
    });
    for (let i = 0; i < CLAPS; i++) {
      const gain = lerp(CLAP_SOFT, CLAP_HARD, (i / (CLAPS - 1)) ** 1.4);
      this.beat(CLAP_FIRST + i * CLAP_EVERY, () => this.sound.play(`rooms/clap_unison_${(i % 4) + 1}.mp3`, { gain, reverb: 0.5 }));
    }
    this.beat(LAST_CLAP + 0.03, () => {
      this.tone?.gain(0, 0.08);
      this.silence?.gain(0, 0.08);
      this.under?.gain(0, 0.08);
    });
    this.beat(46.1, () => this.sound.play('rooms/heart_beat.mp3', { gain: 0.4 }));
    this.beat(RAISE_AT, () => this.sound.play('rooms/crowd_rise.mp3', { gain: 0.3, reverb: 0.5, offset: 1.6, duration: 1.3 }));
    this.beat(WAVE_AT, () => this.sound.play('rooms/shutter_wave.mp3', { gain: 0.5, reverb: 0.5 }));
    this.beat(LINE_AT - 0.6, () => {
      this.tone?.gain(0.12, 1.2);
      this.silence?.gain(0.25, 1.2);
    });
    this.beat(LINE_AT, () => this.say({ tr: 'Süren doldu.', en: 'Your time is up.' }, 3, 'dream'));
    this.beat(CUT_AT, () => this.sound.play('rooms/breaker_clunk_2.mp3', { gain: 0.4, reverb: 0.2 }));
  }

  /** The follow spot finds the desk: the beam comes the long way, the light itself stands nearer along it. */
  private aim(desk: number): void {
    const o = this.origin;
    v1.set(0, 0, desk);
    v2.set(BOOTH[0], BOOTH[1], BOOTH[2]).sub(v1);
    const reach = v2.length();
    const rise = v2.y / reach;
    const flat = Math.sqrt(1 - rise * rise);
    const wide = reach * Math.tan(SPOT_ANGLE * DEG);
    const ahead = Math.max(0.2, ((wide * DESK_IN_BEAM) / flat - 0.8) * (flat / rise));
    v1.z -= ahead;
    v2.set(BOOTH[0], BOOTH[1], BOOTH[2]).sub(v1);
    const radius = v2.length() * Math.tan(SPOT_ANGLE * DEG);
    v2.normalize();
    const u = this.beamMaterial.uniforms;
    u.uFrom.value.set(BOOTH[0] + o.x, BOOTH[1] + o.y, BOOTH[2] + o.z);
    u.uTo.value.set(v1.x + o.x, v1.y + o.y, v1.z + o.z);
    u.uWide.value = radius;
    this.key.target[0] = v1.x + o.x;
    this.key.target[1] = v1.y + o.y;
    this.key.target[2] = v1.z + o.z;
    this.key.position[0] = v1.x + v2.x * KEY_RANGE + o.x;
    this.key.position[1] = v1.y + v2.y * KEY_RANGE + o.y;
    this.key.position[2] = v1.z + v2.z * KEY_RANGE + o.z;
    this.key.angle = Math.atan(radius / KEY_RANGE) / DEG;
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const t = frame.t;
    const deskZ = this.deskTrack.at(t);
    const read = this.readTrack.at(t);
    this.fear = this.fearTrack.at(t);
    this.control.scroll = s < LOCK_AT;

    const lit = s >= ON_AT && s < CUT_AT;
    this.black = lit ? 0 : 1;
    const power = lit ? 1 + (REDUCED_MOTION ? 0 : STRIKE * Math.exp(-(s - ON_AT) * 9)) : 0;
    this.key.intensity = KEY_POWER * power;
    this.beamMaterial.uniforms.uPower.value = BEAM_POWER * power;
    this.beamMaterial.uniforms.uTime.value = frame.time;
    this.source.visible = lit;
    this.footGlow.value = lit ? 1 + 0.12 * wobble(frame.time * 0.6, 7) : 0;

    // the desk slides only while the eye is on the paper; the spot goes with it
    const moved = deskZ !== this.lastDesk;
    if (moved) {
      this.lastDesk = deskZ;
      this.desk.position.z = deskZ;
      this.aim(deskZ);
    }

    // she comes without taking a step
    const herShown = s >= HER_FROM && s < STAND_AT;
    if (herShown) {
      const k = 1 - (1 - clamp((s - HER_FROM) / (HER_SETTLED - HER_FROM), 0, 1)) ** 2;
      this.her.position.set(this.herAt.x, 0, this.herAt.z - lerp(HER_FAR, 0, k));
      this.her.rotation.y = Math.atan2(-this.herAt.x, 1.7);
    }
    this.movingShadows = moved || herShown !== this.herShown || (herShown && s < HER_SETTLED + 0.1);
    this.herShown = herShown;
    this.her.visible = herShown;

    // heads lifting, hands clapping, all together
    this.sitPose.uLift.value = clamp((s - LIFT_AT) / LIFT_SECONDS, 0, 1) * 1.02;
    this.sitPose.uOpen.value = smooth(CLAP_FIRST - 1.1, CLAP_FIRST - 0.3, s);
    let shut = 0;
    if (s >= LAST_CLAP) shut = 1;
    else if (s >= CLAP_FIRST - 0.35) {
      const beat = (s - CLAP_FIRST) / CLAP_EVERY;
      const f = beat - Math.floor(beat);
      shut = f < 0.55 ? 1 - smooth(0, 0.55, f) : f > 0.76 ? smooth(0.76, 1, f) : 0;
    }
    this.sitPose.uShut.value = shut;
    this.standPose.uOpen.value = smooth(RAISE_AT, RAISE_AT + RAISE_SECONDS * 0.5, s);
    this.standPose.uShut.value = smooth(RAISE_AT + RAISE_SECONDS * 0.5, RAISE_AT + RAISE_SECONDS, s);
    const standing = s >= STAND_AT;
    for (const m of this.seated) m.visible = !standing;
    for (const m of this.standing) m.visible = standing;

    // the wave of flashes: each place goes off once
    const wave = (s - WAVE_AT) / WAVE_SECONDS;
    this.wave.value = wave;
    this.flashes.visible = wave > -0.05 && lit;
    const crest = wave > -0.1 && wave < 1.2 ? Math.sin(clamp((wave + 0.1) / 1.3, 0, 1) * Math.PI) : 0;
    this.sweep.intensity = SWEEP_POWER * crest * FLASH_GLOW;
    this.sweep.position.set(this.origin.x + lerp(-SWEEP_HALF, SWEEP_HALF, clamp(wave, 0, 1)) * 0.75, this.origin.y + 1.6, this.origin.z - 0.3);
    this.white = lit ? crest * crest * WHITE_AT_CREST * FLASH_GLOW : 0;

    // the lens: the rows when you look up, the paper when you look down
    this.focus = lerp(deskZ + UP_BACK + 1.7, READ_FOCUS, read);
    this.aperture = lerp(HALL_APERTURE, READ_APERTURE, read);

    if (!this.taken && s >= SHUTTER_AT && (Math.abs(frame.input.gazeYaw) < SHUTTER_GAZE || s >= SHUTTER_AT + SHUTTER_LATE)) {
      this.taken = true;
      this.shutter();
    }

    // what the eye cannot see does not need to be drawn
    const gaze = Math.abs(frame.input.gazeYaw);
    this.rear.visible = gaze > 0.9;
    this.rows.visible = gaze < 2.4;

    for (const c of this.clocks) c.value = frame.time;
  }

  override dispose(): void {
    const book = this.kit.figures as unknown as { clips: Map<string, AnimationClip> };
    for (const name of this.added) if (name !== 'm_take_picture') book.clips.delete(name);
    super.dispose();
  }
}
