import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MultiplyBlending,
  type Material,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  SplineCurve,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { SpotSpec } from '../../../config/nightmare.config';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { DreamLight } from '../../dream/LightPool';
import { DEG, clamp, lerp, range, smootherstep, wobble } from '../../math';
import type { RoomAir, RoomAssets, RoomContext, RoomControl, RoomFilm, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import type { RoomVoice, RoomVoiceOptions } from '../RoomSound';
import { Swarm, type CrawlSurface } from '../Swarm';

type V3 = readonly [number, number, number];

const TICK_FILES = [1, 2, 3, 4, 5, 6].map((n) => `rooms/spider_tick_${n}.mp3`);
const SOFT_TICK_FILES = [1, 2, 3, 4].map((n) => `rooms/spider_tick_soft_${n}.mp3`);

export const assets: RoomAssets = {
  models: ['spider', 'spider_low', 'bed_iron', 'pillow', 'nightstand_painted', 'door_six', 'door_frame', 'door_knob', 'alarm_clock'],
  materials: ['wallpaper_old', 'plaster_mould', 'wood_floor_dark', 'carpet_dirty'],
  sounds: [
    ...TICK_FILES,
    ...SOFT_TICK_FILES,
    'rooms/bedroom_tone.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/breath_calm.mp3',
    'rooms/breath_scared.mp3',
    'rooms/breath_rising.mp3',
    'rooms/bedspring_2.mp3',
    'rooms/floor_creak_3.mp3',
    'rooms/spider_skitter.mp3',
    'rooms/spider_legs_soft.mp3',
    'rooms/spider_legs_hard.mp3',
    'rooms/spider_chitter.mp3',
    'rooms/swarm_swell.mp3',
    'rooms/bugs_writhe.mp3',
    'rooms/insects_contact_wide.mp3',
    'rooms/hair_fingers.mp3',
    'rooms/legs_on_skin.mp3',
    'rooms/gasp_2.mp3',
  ],
};

/** Length of the room (s). */
const SECONDS = 68;
/** Inner size of the room (m): width, depth from the head wall at z = 0, height. */
const W = 3.2;
const D = 3.4;
const H = 2.5;
/** The bed's center line (m), its head end (m), the top of its mattress (m). */
const BED_X = -0.55;
const BED_HEAD_Z = -0.07;
const MATTRESS_TOP = 0.6;
/** The eye on the pillow, and where it goes as the head rolls right or left (m). */
const EYE: V3 = [BED_X, 0.75, -0.52];
const HEAD_RIGHT: V3 = [BED_X + 0.03, 0.75, -0.52];
const HEAD_LEFT: V3 = [BED_X - 0.05, 0.76, -0.55];
/** How far the head lies over when it looks at the lamp (deg). */
const LAMP_ROLL = 16;

/** The night table (m) and the lamp on it. Radii and height of the shade (m). */
const TABLE_X = -1.33;
const TABLE_Z = -1.45;
const TABLE_TOP = 0.616;
const LAMP_X = -1.3;
const LAMP_Z = -1.45;
const SHADE_Y = 1.04;
const SHADE_HEIGHT = 0.21;
const SHADE_BOTTOM = 0.14;
const SHADE_TOP = 0.075;
const BULB: V3 = [LAMP_X, 1.025, LAMP_Z];
/** The one lamp: the cone it throws up through the shade's top and the one down on the table (candela, half angle deg), the glow of the paper. */
const LAMP_UP = 10;
const LAMP_UP_ANGLE = 46;
const LAMP_UP_AIM: V3 = [-0.6, H, -2.1];
const LAMP_DOWN = 2.2;
const LAMP_DOWN_ANGLE = 58;
const LAMP_POINT = 1;
const LAMP_REACH = 4.2;
const WARM = 0xffc48a;
/** What keeps the dark side from being nothing: faint and cold (candela, m). */
const FILL_COLOR = 0x6f9aa8;
const DOOR_FILL = 1.05;
const WEB_FILL = 0.6;

/** The ceiling's fall at the later blinks (m). */
const DROP_AT_41 = 0.14;
const DROP_AT_45 = 0.3;

/** The door in the far wall: its center (m), how far it stands ajar at each stage (rad). */
const DOOR_X = 1.08;
const DOOR_AJAR = [0.22, 0.34, 0.5, 0.74];

/** The first spider: where it starts (m), its size against the file, a stride of it (m). */
const HERO_SCALE = 1.7;
const HERO_AT = [-0.45, -2.45] as const;
const HERO_STRIDE = 0.075;
/** How far its legs swing and lift (rad), how loud one step is (gain). */
const HERO_SWING = 0.26;
const HERO_LIFT = 0.42;
const HERO_TICK = 0.16;
/** Its walks: from and to (s), and where to (x, z in m). */
const HERO_WALKS = [
  [3.6, 6.4, -0.36, -2.28],
  [9.4, 10, -0.24, -2.18],
  [13.4, 17, -0.3, -1.82],
] as const;
/** Looking away from it after this second for this long (s) takes it. */
const AWAY_FROM = 12;
const AWAY_FOR = 2;

/** Where the eyes shut fully (s), and how long each half of the blink takes (s). */
const BLINK_SCALE = REDUCED_MOTION ? 1.3 : 1;
const BLINKS: readonly (readonly [number, number])[] = [
  [0, 1.1],
  [20, 1.3 * BLINK_SCALE],
  [36, 0.75 * BLINK_SCALE],
  [41, 0.7 * BLINK_SCALE],
  [45, 0.65 * BLINK_SCALE],
];
const FIVE_AT = 36;
const THIRTY_AT = 41;
const THOUSANDS_AT = 45;

/** The five, by hand (x, z, heading in rad, scale); the rest of the thirty are scattered. */
const FIVE = [
  [-0.42, -1.92, 2.4, 1.35],
  [0.3, -1.62, -0.7, 1.2],
  [-0.86, -1.36, 0.9, 1.1],
  [0.62, -2.42, 1.6, 1.15],
  [-0.1, -2.8, -2.2, 1.05],
] as const;
/** The height of the `spider` file (m). */
const SPIDER_HEIGHT = 0.089;

/** The thousands. */
const SWARM_COUNT = REDUCED_MOTION ? 1800 : 3200;
const SWARM_RATE = REDUCED_MOTION ? 0.4 : 1;
/** When they all turn toward the bed (s), and how hard they then go there. */
const SWARM_TURN_AT = 49.5;
const SWARM_PULL = -0.42;

/** The hanks of white hair: where each comes through the ceiling (x, z in m), when (s). */
const HANKS = [
  [-0.95, -2.25, 47.0],
  [-0.4, -1.3, 47.8],
  [0.1, -2.5, 48.2],
  [0.4, -1.2, 49.0],
  [0.8, -2.05, 49.4],
  [-1.2, -1.05, 50.0],
  [-0.18, -0.92, 50.6],
  [1.05, -1.15, 51.2],
] as const;
/** How long a hank takes to come down (s), its strands, its half width and its length (m). */
const HAIR_FALL = 6;
const HANK_STRANDS = 70;
const HANK_HALF = 0.085;
const HAIR_LENGTH = [0.45, 1.3] as const;

/** Those who come down on silk: how many, from when (s), over how long they start (s). */
const SILK_COUNT = 52;
const SILK_AT = 47.4;
const SILK_SPREAD = 7;
const SILK_SPIN = REDUCED_MOTION ? 0.3 : 1;
/** How high above the eye they must stop, and how far off its axis they stay (m). */
const SILK_CLEAR = 0.32;
const SILK_AXIS = 0.34;

/** The shadow on the shade: when it comes, when it has gone (s). */
const SHADE_FROM = 30;
const SHADE_LEAVE = 33.2;
const SHADE_GONE = 33.8;

/** The big one: size against the file; when it comes, when it stops, the shutter, when it covers the lens (s). */
const BIG_SCALE = 3.4;
const BIG_FROM = 52;
const BIG_STOP = 55.5;
const SHUTTER_AT = 56.8;
const COVER_AT = 58;
const COVER_TIME = REDUCED_MOTION ? 1.2 : 0.65;
/** Its way over the lens: second, x, y, z (m, in front of the eye), pitch and roll (deg). */
const BIG_WAY = [
  [51.9, 0.06, -0.58, -0.3, -88, 6],
  [53.2, 0.03, -0.36, -0.27, -84, -4],
  [54.4, -0.03, -0.2, -0.25, -80, 8],
  [55.5, 0.01, -0.05, -0.225, -72, 0],
  [56.4, 0.0, 0.012, -0.215, -17, 0],
  [COVER_AT - 0.2, 0.0, 0.012, -0.2, -14, 0],
  [COVER_AT + COVER_TIME, 0.0, 0.0, -0.06, -4, 0],
] as const;
/** Steps a second of the big one, how far its legs swing and lift (rad). */
const BIG_GAIT = REDUCED_MOTION ? 0.7 : 1.6;
/** The light on it (candela): from the lamp's side, and from behind. */
const BIG_KEY = 0.8;
const BIG_RIM = 0.35;
const BIG_SWING = 0.3;
const BIG_LIFT = 0.42;

/** The lens: focus (m) and blur on the ceiling, on the lamp, on the big one. */
const FOCUS_CEILING = 2.3;
const APERTURE_CEILING = 3.5;
const FOCUS_LAMP = 1.22;
const APERTURE_LAMP = 6;
/** The big one's eyes on its head (m at scale 1): x, y, z, radius; each is mirrored. */
const SPIDER_EYES = [
  [0.0031, 0.0444, 0.0203, 0.0023],
  [0.0085, 0.0446, 0.0186, 0.0018],
  [0.0044, 0.0507, 0.0172, 0.0019],
  [0.0108, 0.0512, 0.0142, 0.0023],
] as const;
const FOCUS_BIG = 0.2;
const APERTURE_BIG = 1.5;

/** When the voice speaks, and when the room is over (s). */
const SAY_ONLY_AT = 2;
const SAY_WHERE_AT = 21;
const SAY_LAST_AT = 62;
const CUT_AT = 66;
/** How loud the skittering under the first walks is (gain). */
const WALK_SOFT = 0.06;
const WALK_HARD = 0.035;
/** The silence, and what comes through it (s). */
const HUSH_AT = 21.6;
const SPRING_AT = 23.1;
const FLOORBOARD_AT = 27.2;
const SHADE_SOUND_AT = 33.3;
const BEFORE_FIVE_AT = 35.6;
const SKITTER_OFF_AT = 40.2;
/** Ticks across the stereo, from the door to the lamp and back up to the ceiling: how many, from when, how long (s). */
const ACROSS_TICKS = 22;
const ACROSS_FROM = 27.9;
const ACROSS_FOR = 2;
const BACK_TICKS = 9;
const BACK_FROM = 33.9;
const BACK_FOR = 1.5;
/** Single ticks while the five do not move (s, pan). */
const STILL_TICKS = [[37.3, -0.5], [37.9, 0.3], [38.6, -0.1], [39.5, 0.6]] as const;

/** The keys of the head, from the pillow. */
const key = (s: number, yaw: number, pitch: number, fov: number, roll = 0, at: V3 = EYE): RoomKey => ({ t: s / SECONDS, at, yaw, pitch, roll, fov });
const LOOKS: readonly RoomKey[] = [
  key(0, 3, 31, 60),
  key(13, 2.5, 35, 59),
  key(21, 2, 38, 58),
  key(23.2, 2, 37, 58),
  key(26.4, -11, 22, 52, 3, HEAD_RIGHT),
  key(27.6, -10, 21, 51, 3, HEAD_RIGHT),
  key(30.2, 38, 8, 27, LAMP_ROLL, HEAD_LEFT),
  key(33.6, 38.5, 8.2, 23, LAMP_ROLL, HEAD_LEFT),
  key(35.6, 3, 33, 60),
  key(45, 3, 35, 60),
  key(52, 3, 37, 62),
  key(68, 3, 37, 62),
];

const LEG_NAMES = ['leg_L1', 'leg_L2', 'leg_L3', 'leg_L4', 'leg_R1', 'leg_R2', 'leg_R3', 'leg_R4'] as const;

const LID_VERT = /* glsl */ `
varying vec2 vAt;
void main() {
  vAt = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const LID_FRAG = /* glsl */ `
uniform float uHalf;
uniform float uLid;
varying vec2 vAt;
void main() {
  vec2 q = vAt / uHalf;
  float open = uLid * (1.2 - 0.1 * q.x * q.x);
  float lids = max(smoothstep(open - 0.1, open + 0.08, q.y + 0.08 * (1.0 - uLid)), smoothstep(open * 0.9 - 0.1, open * 0.9 + 0.08, -q.y));
  gl_FragColor = vec4(0.0, 0.0, 0.0, lids);
}
`;

/** The paper of the shade, lit from inside, and what walks between it and the bulb. */
const SHADE_HEAD = /* glsl */ `
uniform vec2 uLegs[33];
uniform float uShadow;
uniform float uGlow;
varying vec3 vShade;
float capsule(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
`;
const SHADE_BODY = /* glsl */ `
float shadeAngle = atan(vShade.x, vShade.z);
vec2 shadeAt = vec2(shadeAngle * 0.115, vShade.y);
vec2 shadeFrom = shadeAt - vec2(0.0, -0.01);
float shadeHot = exp(-dot(shadeFrom, shadeFrom) * 52.0);
float shadeEdge = smoothstep(${(SHADE_HEIGHT / 2).toFixed(3)}, ${(SHADE_HEIGHT / 2 - 0.045).toFixed(3)}, abs(vShade.y));
float shadeAge = 0.86 + 0.14 * sin(shadeAngle * 3.0 + vShade.y * 17.0) * sin(shadeAngle * 7.0 - vShade.y * 31.0);
float shadePleat = 0.92 + 0.08 * sin(shadeAngle * 74.0);
vec3 shadeLit = mix(vec3(0.62, 0.27, 0.085), vec3(2.7, 1.55, 0.62), shadeHot) * shadePleat * shadeAge * mix(0.55, 1.0, shadeEdge);
if (uShadow > 0.001) {
  float d = 1e3;
  for (int i = 0; i < 8; i++) {
    vec2 a = uLegs[i * 4];
    vec2 b = uLegs[i * 4 + 1];
    vec2 c = uLegs[i * 4 + 2];
    vec2 e = uLegs[i * 4 + 3];
    d = min(d, capsule(shadeAt, a, b) - 0.0092);
    d = min(d, capsule(shadeAt, b, c) - 0.0068);
    d = min(d, capsule(shadeAt, c, e) - 0.0034);
  }
  vec2 body = shadeAt - uLegs[32];
  d = min(d, length(body * vec2(1.0, 0.86)) - 0.025);
  d = min(d, length((body - vec2(0.0, -0.05)) * vec2(1.0, 0.76)) - 0.039);
  // the hairs of its legs break the edge of the shadow
  d += 0.0013 * sin(shadeAt.x * 1400.0 + shadeAt.y * 300.0) * sin(shadeAt.y * 1100.0 - shadeAt.x * 200.0);
  shadeLit *= 1.0 - smoothstep(0.006, -0.003, d) * uShadow * 0.965;
}
diffuseColor.rgb = shadeLit * uGlow;
`;

/** A deterministic random sequence. */
function randomFrom(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(size: number, draw: (c: CanvasRenderingContext2D, size: number) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** A wet patch dried many times over: each drying left its tide line. */
function tide(c: CanvasRenderingContext2D, S: number, x: number, z: number, radius: number, strength: number, rnd: () => number): void {
  const cx = ((x + W / 2) / W) * S;
  const cy = (-z / D) * S;
  const stretch = 0.75 + rnd() * 0.5;
  for (let ring = 0; ring < 3; ring++) {
    const k = 1 - ring * 0.23;
    const rx = (radius / W) * S * k;
    const ry = (radius / D) * S * k * stretch;
    const p1 = rnd() * 6.28;
    const p2 = rnd() * 6.28;
    const p3 = rnd() * 6.28;
    c.beginPath();
    for (let i = 0; i <= 140; i++) {
      const a = (i / 140) * Math.PI * 2;
      const r = 1 + 0.15 * Math.sin(a * 3 + p1) + 0.09 * Math.sin(a * 7 + p2) + 0.04 * Math.sin(a * 17 + p3);
      const px = cx + Math.cos(a) * rx * r;
      const py = cy + Math.sin(a) * ry * r;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry) * 1.2);
    g.addColorStop(0, `rgba(150,114,66,${0.05 * strength})`);
    g.addColorStop(0.7, `rgba(138,100,54,${0.13 * strength})`);
    g.addColorStop(1, `rgba(96,66,34,${0.3 * strength})`);
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = `rgba(74,50,26,${0.26 * strength})`;
    c.lineWidth = 1.5 + rnd() * 2;
    c.stroke();
  }
}

/** One crack, wandering, with branches. */
function crack(c: CanvasRenderingContext2D, x0: number, y0: number, heading: number, length: number, width: number, rnd: () => number, depth = 0): void {
  let x = x0;
  let y = y0;
  let dir = heading;
  const step = 7;
  c.beginPath();
  c.moveTo(x, y);
  for (let walked = 0; walked < length; walked += step) {
    dir += (rnd() - 0.5) * 0.75;
    x += Math.cos(dir) * step;
    y += Math.sin(dir) * step;
    c.lineTo(x, y);
    if (depth < 2 && rnd() < 0.03) {
      const px = x;
      const py = y;
      c.strokeStyle = `rgba(32,25,18,${0.6 - depth * 0.17})`;
      c.lineWidth = width;
      c.stroke();
      crack(c, px, py, dir + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd()), (length - walked) * (0.3 + rnd() * 0.4), width * 0.65, rnd, depth + 1);
      c.beginPath();
      c.moveTo(px, py);
    }
  }
  c.strokeStyle = `rgba(32,25,18,${0.6 - depth * 0.17})`;
  c.lineWidth = width;
  c.stroke();
}

/** The ceiling's whole age, drawn once: lays on it like a photograph multiplied over the plaster. */
function drawStains(c: CanvasRenderingContext2D, S: number): void {
  const rnd = randomFrom(11);
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, S, S);
  // dirt gathers where ceiling meets wall
  const edge = 0.4 * (S / W);
  const fade = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(52,44,32,0.5)');
    g.addColorStop(1, 'rgba(52,44,32,0)');
    c.fillStyle = g;
    c.fillRect(rx, ry, rw, rh);
  };
  fade(0, 0, edge, 0, 0, 0, edge, S);
  fade(S, 0, S - edge, 0, S - edge, 0, edge, S);
  fade(0, 0, 0, edge, 0, 0, S, edge);
  fade(0, S, 0, S - edge, 0, S - edge, S, edge);
  // the water came through many times, in the same places
  tide(c, S, -0.3, -2.05, 0.62, 0.9, rnd);
  tide(c, S, 0.92, -1.4, 0.58, 1, rnd);
  tide(c, S, -1.05, -2.75, 0.42, 0.8, rnd);
  tide(c, S, -0.75, -0.72, 0.36, 0.6, rnd);
  // and from the worst of it, thin brown runs that have legs if you look long enough
  const cx = ((-0.3 + W / 2) / W) * S;
  const cy = (2.05 / D) * S;
  c.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    let a = 0.2 + (i / 8) * Math.PI * 2 + rnd() * 0.3;
    let x = cx + Math.cos(a) * 0.15 * (S / W);
    let y = cy + Math.sin(a) * 0.15 * (S / W);
    const length = (0.85 + rnd() * 0.55) * (S / W);
    const steps = 44;
    for (let k = 0; k < steps; k++) {
      const along = k / steps;
      a += (rnd() - 0.5) * 0.16 + (k === Math.floor(steps * 0.44) ? 0.5 : 0);
      const nx = x + Math.cos(a) * (length / steps);
      const ny = y + Math.sin(a) * (length / steps);
      c.strokeStyle = `rgba(94,64,34,${0.09 * (1 - along * 0.8)})`;
      c.lineWidth = (1 - along * 0.88) * 0.03 * (S / W);
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(nx, ny);
      c.stroke();
      x = nx;
      y = ny;
    }
  }
  crack(c, S * 0.08, S * 0.36, 0.22, S * 0.62, 2.6, rnd);
  crack(c, S * 0.72, S * 0.02, 1.9, S * 0.5, 2.1, rnd);
  crack(c, S * 0.32, S * 0.97, -1.2, S * 0.3, 1.8, rnd);
  // flyspeck and mould, in colonies
  for (let i = 0; i < 15; i++) {
    const mx = rnd() * S;
    const my = rnd() * S;
    const spread = 18 + rnd() * 70;
    const n = 30 + rnd() * 120;
    for (let k = 0; k < n; k++) {
      const a = rnd() * 6.28;
      const r = rnd() * rnd() * spread * 1.8;
      const size = 0.6 + rnd() * 2.2;
      c.fillStyle = `rgba(40,36,26,${0.1 + rnd() * 0.2})`;
      c.fillRect(mx + Math.cos(a) * r, my + Math.sin(a) * r, size, size);
    }
  }
  // edges of paint that has lifted
  for (let i = 0; i < 38; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 6 + rnd() * 26;
    const from = rnd() * 6.28;
    c.strokeStyle = `rgba(40,32,22,${0.16 + rnd() * 0.3})`;
    c.lineWidth = 1 + rnd() * 1.6;
    c.beginPath();
    c.arc(x, y, r, from, from + 1.2 + rnd() * 2.6);
    c.stroke();
  }
}

/** What the years have done to a wall: soot under the ceiling, water run down from it. */
function drawWallAge(c: CanvasRenderingContext2D, S: number): void {
  const rnd = randomFrom(71);
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, S, S);
  const soot = c.createLinearGradient(0, 0, 0, S * 0.32);
  soot.addColorStop(0, 'rgba(30,28,22,0.7)');
  soot.addColorStop(1, 'rgba(30,28,22,0)');
  c.fillStyle = soot;
  c.fillRect(0, 0, S, S * 0.32);
  for (let i = 0; i < 52; i++) {
    const x = rnd() * S;
    const length = S * (0.14 + rnd() * rnd() * 0.72);
    const w = 3 + rnd() * rnd() * 34;
    const g = c.createLinearGradient(x, 0, x, length);
    g.addColorStop(0, `rgba(68,54,36,${0.1 + rnd() * 0.22})`);
    g.addColorStop(1, 'rgba(68,54,36,0)');
    c.fillStyle = g;
    c.fillRect(x - w / 2, 0, w, length);
  }
}

/** A spider's soft shadow, for what is seen from below: the lamp puts it just beside the feet. */
function drawSpiderShadow(c: CanvasRenderingContext2D, S: number): void {
  c.clearRect(0, 0, S, S);
  c.translate(S / 2, S / 2);
  c.lineCap = 'round';
  c.strokeStyle = 'rgba(0,0,0,0.62)';
  for (const side of [-1, 1]) {
    for (let n = 0; n < 4; n++) {
      const a = (n < 2 ? 0.8 - n * 0.52 : -0.55 - (n - 2) * 0.6) + Math.PI / 2;
      const dx = side * Math.sin(a);
      const dy = -Math.cos(a);
      c.lineWidth = S * 0.018;
      c.beginPath();
      c.moveTo(side * S * 0.04, -S * 0.02 + n * S * 0.03);
      c.quadraticCurveTo(side * S * 0.04 + dx * S * 0.28, -S * 0.02 + dy * S * 0.28 + n * S * 0.03 - S * 0.03, side * S * 0.04 + dx * S * 0.44, -S * 0.02 + dy * S * 0.44 + n * S * 0.03);
      c.stroke();
    }
  }
  c.fillStyle = 'rgba(0,0,0,0.7)';
  c.beginPath();
  c.ellipse(0, S * 0.09, S * 0.1, S * 0.15, 0, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.ellipse(0, -S * 0.06, S * 0.07, S * 0.09, 0, 0, Math.PI * 2);
  c.fill();
}

/** A very old web: gauze and sagging thread more than a pattern, torn in places, with what it caught still in it. */
function drawWeb(c: CanvasRenderingContext2D, S: number): void {
  const rnd = randomFrom(31);
  const cx = S * 0.52;
  const cy = S * 0.47;
  c.lineCap = 'round';
  for (let i = 0; i < 280; i++) {
    const a = rnd() * 6.28;
    const r = S * (0.03 + rnd() * 0.46);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.86;
    const size = S * (0.02 + rnd() * 0.08);
    const g = c.createRadialGradient(x, y, 0, x, y, size);
    g.addColorStop(0, `rgba(198,202,192,${0.005 + rnd() * 0.014})`);
    g.addColorStop(1, 'rgba(198,202,192,0)');
    c.fillStyle = g;
    c.fillRect(x - size, y - size, size * 2, size * 2);
  }
  const wounds = [[0.3, 0.64, 0.17], [0.74, 0.3, 0.14], [0.64, 0.78, 0.13], [0.18, 0.24, 0.11]] as const;
  const torn = (x: number, y: number): boolean => wounds.some(([wx, wy, wr]) => Math.hypot(x / S - wx, y / S - wy) < wr);
  const dangle = (x: number, y: number) => {
    const length = S * (0.02 + rnd() * 0.08);
    c.strokeStyle = `rgba(214,218,208,${0.2 + rnd() * 0.3})`;
    c.lineWidth = 0.8 + rnd();
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + (rnd() - 0.5) * length * 0.5, y + length * 0.5, x + (rnd() - 0.5) * length * 0.3, y + length);
    c.stroke();
  };
  const spokes: number[] = [];
  for (let a = 0; a < Math.PI * 2 - 0.1; a += 0.1 + rnd() * 0.26) spokes.push(a);
  const reach = spokes.map(() => S * (0.3 + rnd() * 0.2));
  spokes.forEach((a, i) => {
    let x = cx;
    let y = cy;
    const step = S * 0.012;
    const cosA = Math.cos(a);
    const sinA = Math.sin(a) * 0.86;
    c.strokeStyle = `rgba(226,230,220,${0.22 + rnd() * 0.36})`;
    c.lineWidth = 1.3 + rnd() * 1.7;
    c.beginPath();
    c.moveTo(x, y);
    for (let r = step; r < reach[i]; r += step) {
      const nx = cx + cosA * r + (rnd() - 0.5) * 1.6;
      const ny = cy + sinA * r + (rnd() - 0.5) * 1.6 + (r / S) * (r / S) * S * 0.09;
      if (torn(nx, ny)) break;
      c.lineTo(nx, ny);
      x = nx;
      y = ny;
    }
    c.stroke();
    if (rnd() < 0.5) dangle(x, y);
  });
  let ring = 0;
  for (let r = S * 0.035; r < S * 0.47; r += S * (0.011 + (r / S) * 0.035)) {
    ring++;
    for (let i = 0; i < spokes.length; i++) {
      const j = (i + 1) % spokes.length;
      if (r > reach[i] * 0.97 || r > reach[j] * 0.97) continue;
      const a0 = spokes[i];
      const a1 = spokes[j] + (j === 0 ? Math.PI * 2 : 0);
      const r0 = r * (0.97 + rnd() * 0.06);
      const r1 = r * (0.97 + rnd() * 0.06);
      const x0 = cx + Math.cos(a0) * r0;
      const y0 = cy + Math.sin(a0) * r0 * 0.86 + (r0 / S) * (r0 / S) * S * 0.09;
      const x1 = cx + Math.cos(a1) * r1;
      const y1 = cy + Math.sin(a1) * r1 * 0.86 + (r1 / S) * (r1 / S) * S * 0.09;
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      if (torn(mx, my)) {
        if (rnd() < 0.3) dangle(x0, y0);
        continue;
      }
      if (rnd() < 0.05 + (r / S) * 0.5) continue;
      const span = Math.hypot(x1 - x0, y1 - y0);
      c.strokeStyle = `rgba(218,222,212,${0.14 + rnd() * 0.3})`;
      c.lineWidth = 0.7 + rnd() * 1.2;
      c.beginPath();
      c.moveTo(x0, y0);
      c.quadraticCurveTo(mx + (cx - mx) * 0.06, my + span * (0.12 + rnd() * 0.3), x1, y1);
      c.stroke();
    }
  }
  for (let i = 0; i < 34; i++) {
    const a = rnd() * 6.28;
    const r = S * (0.16 + rnd() * 0.3);
    const x0 = cx + Math.cos(a) * r;
    const y0 = cy + Math.sin(a) * r;
    const b0 = a + 1.6 + rnd() * 2;
    const x1 = cx + Math.cos(b0) * r;
    const y1 = cy + Math.sin(b0) * r;
    c.strokeStyle = `rgba(214,218,208,${0.1 + rnd() * 0.2})`;
    c.lineWidth = 0.7 + rnd();
    c.beginPath();
    c.moveTo(x0, y0);
    c.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + S * 0.12, x1, y1);
    c.stroke();
  }
  for (let i = 0; i < 40; i++) {
    const a = rnd() * 6.28;
    const r = S * (0.08 + rnd() * 0.36);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (torn(x, y)) continue;
    const size = S * (0.006 + rnd() * 0.014);
    const g = c.createRadialGradient(x, y, 0, x, y, size);
    g.addColorStop(0, 'rgba(212,214,204,0.5)');
    g.addColorStop(1, 'rgba(212,214,204,0)');
    c.fillStyle = g;
    c.fillRect(x - size, y - size, size * 2, size * 2);
  }
  for (let i = 0; i < 13; i++) {
    const a = rnd() * 6.28;
    const r = S * (0.1 + rnd() * 0.32);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    c.fillStyle = 'rgba(30,24,16,0.9)';
    c.beginPath();
    c.ellipse(x, y, S * 0.004, S * (0.007 + rnd() * 0.006), rnd() * 3, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(200,200,188,0.4)';
    c.lineWidth = 1;
    for (let k = 0; k < 9; k++) {
      const t = rnd() * 6.28;
      c.beginPath();
      c.moveTo(x - Math.cos(t) * S * 0.012, y - Math.sin(t) * S * 0.012);
      c.lineTo(x + Math.cos(t) * S * 0.012, y + Math.sin(t) * S * 0.012);
      c.stroke();
    }
  }
}

/** The silk pulled round it, turn over turn: dark where a band bites in, then fine strands over everything. */
function drawWrap(c: CanvasRenderingContext2D, S: number): void {
  const rnd = randomFrom(47);
  c.fillStyle = '#8f8a7c';
  c.fillRect(0, 0, S, S);
  for (let i = 0; i < 46; i++) {
    const y = (i / 46) * S * 1.3 - S * 0.15 + rnd() * 12;
    const slope = 0.26 + rnd() * 0.16;
    c.strokeStyle = `rgba(28,24,18,${0.28 + rnd() * 0.3})`;
    c.lineWidth = 2 + rnd() * 9;
    c.beginPath();
    c.moveTo(-10, y);
    c.lineTo(S + 10, y + slope * S);
    c.stroke();
  }
  for (let i = 0; i < 900; i++) {
    const y = rnd() * S;
    const slope = (rnd() - 0.5) * 0.5 + 0.28;
    c.strokeStyle = rnd() < 0.7 ? `rgba(240,236,226,${0.1 + rnd() * 0.28})` : `rgba(54,46,38,${0.08 + rnd() * 0.18})`;
    c.lineWidth = 0.6 + rnd() * 1.6;
    c.beginPath();
    c.moveTo(-10, y);
    c.lineTo(S + 10, y + slope * S);
    c.stroke();
  }
}

/** The picture of them: three at the table and an empty chair. Somebody went over each face with a needle. */
function drawFamily(c: CanvasRenderingContext2D, w: number, h: number): void {
  const rnd = randomFrom(5);
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#76664c');
  g.addColorStop(1, '#3a3022');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#2c241a';
  const figure = (x: number, top: number, size: number) => {
    c.beginPath();
    c.ellipse(x, top + size * 0.5, size * 0.45, size * 0.55, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(x - size * 1.3, h);
    c.quadraticCurveTo(x - size * 1.1, top + size * 1.2, x, top + size * 1.05);
    c.quadraticCurveTo(x + size * 1.1, top + size * 1.2, x + size * 1.3, h);
    c.fill();
  };
  const people = [[0.24, 0.2, 0.24], [0.5, 0.25, 0.21], [0.72, 0.44, 0.13]] as const;
  for (const [x, top, size] of people) figure(x * w, top * h, size * h);
  // the chair nobody came back to
  c.fillStyle = '#231c13';
  c.fillRect(w * 0.82, h * 0.42, w * 0.015, h * 0.3);
  c.fillRect(w * 0.9, h * 0.42, w * 0.015, h * 0.3);
  c.fillRect(w * 0.82, h * 0.44, w * 0.095, h * 0.05);
  c.fillStyle = '#8d7e66';
  c.fillRect(w * 0.08, h * 0.66, w * 0.84, h * 0.06);
  c.fillStyle = '#1f1910';
  c.fillRect(w * 0.08, h * 0.72, w * 0.84, h * 0.28);
  c.lineCap = 'round';
  for (const [x, top, size] of people) {
    const fx = x * w;
    const fy = (top + size * 0.5) * h;
    const rw = size * h * 0.55;
    for (let i = 0; i < 130; i++) {
      c.strokeStyle = `rgba(238,232,214,${0.3 + rnd() * 0.6})`;
      c.lineWidth = 0.6 + rnd() * 1.4;
      c.beginPath();
      c.moveTo(fx + (rnd() - 0.5) * rw * 2, fy + (rnd() - 0.5) * rw * 2.4);
      c.lineTo(fx + (rnd() - 0.5) * rw * 2, fy + (rnd() - 0.5) * rw * 2.4);
      c.stroke();
    }
  }
}

/** The thousands: fifty triangles each. Nose +Z, feet on y = 0, as Swarm wants. */
function tinySpider(): BufferGeometry {
  const p: number[] = [];
  const tri = (a: V3, b: V3, c: V3) => p.push(...a, ...b, ...c);
  const lump = (z: number, rx: number, ry: number, rz: number) => {
    const y = 0.022;
    const top: V3 = [0, y + ry, z];
    const under: V3 = [0, y - ry, z];
    const ring: V3[] = [[rx, y, z], [0, y, z + rz], [-rx, y, z], [0, y, z - rz]];
    for (let i = 0; i < 4; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % 4];
      tri(top, a, b);
      tri(under, b, a);
    }
  };
  const ribbon = (a: V3, b: V3, half: number) => {
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * half;
    const nz = (dx / len) * half;
    tri([a[0] - nx, a[1], a[2] - nz], [a[0] + nx, a[1], a[2] + nz], [b[0] + nx, b[1], b[2] + nz]);
    tri([a[0] - nx, a[1], a[2] - nz], [b[0] + nx, b[1], b[2] + nz], [b[0] - nx, b[1], b[2] - nz]);
  };
  lump(0.018, 0.015, 0.012, 0.019);
  lump(-0.03, 0.024, 0.017, 0.036);
  for (const side of [-1, 1]) {
    for (let n = 0; n < 4; n++) {
      const hipZ = 0.03 - n * 0.013;
      const a = n < 2 ? 0.8 - n * 0.52 : -0.55 - (n - 2) * 0.6;
      const dx = side * Math.cos(a);
      const dz = Math.sin(a);
      const hip: V3 = [side * 0.012, 0.022, hipZ];
      const knee: V3 = [hip[0] + dx * 0.05, 0.05, hipZ + dz * 0.05];
      const foot: V3 = [hip[0] + dx * 0.105, 0, hipZ + dz * 0.105];
      ribbon(hip, knee, 0.0034);
      ribbon(knee, foot, 0.0024);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

/** The moulding where the ceiling meets the walls (it comes down with the ceiling). */
function corniceGeometry(): BufferGeometry {
  const profile = [[0, 0.21], [0.012, 0.2], [0.02, 0.17], [0.05, 0.11], [0.09, 0.07], [0.1, 0.035], [0.15, 0.014], [0.17, 0]] as const;
  const p: number[] = [];
  const run = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number) => {
    for (let i = 0; i < profile.length - 1; i++) {
      const [o0, d0] = profile[i];
      const [o1, d1] = profile[i + 1];
      const a: V3 = [ax + nx * o0, H - d0, az + nz * o0];
      const b: V3 = [bx + nx * o0, H - d0, bz + nz * o0];
      const c: V3 = [ax + nx * o1, H - d1, az + nz * o1];
      const d: V3 = [bx + nx * o1, H - d1, bz + nz * o1];
      p.push(...a, ...b, ...c, ...c, ...b, ...d);
    }
  };
  run(-W / 2, -D, W / 2, -D, 0, 1);
  run(W / 2, 0, -W / 2, 0, 0, -1);
  run(W / 2, -D, W / 2, 0, -1, 0);
  run(-W / 2, 0, -W / 2, -D, 1, 0);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

/** The blanket over you, turned down under the chin: `u` across, `v` from the hem to the foot, in meters. */
function blanketGeometry(): BufferGeometry {
  const NU = 46;
  const NV = 76;
  const LENGTH = 1.42;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const top = (u: number, v: number): number => {
    const across = Math.exp(-((u / 0.27) ** 4));
    const chest = Math.exp(-(((v - 0.42) / 0.36) ** 2)) * 0.15 * across;
    const legs = Math.exp(-(((v - 1.0) / 0.42) ** 2)) * 0.085 * (Math.exp(-(((u - 0.1) / 0.09) ** 2)) + Math.exp(-(((u + 0.1) / 0.09) ** 2)));
    const feet = Math.exp(-(((v - 1.34) / 0.08) ** 2)) * 0.16 * (Math.exp(-(((u - 0.11) / 0.07) ** 2)) + Math.exp(-(((u + 0.11) / 0.07) ** 2)));
    const wrinkles = 0.022 * Math.sin(u * 15 + v * 4 + 1.2) * Math.sin(v * 7 - u * 2) + 0.012 * Math.sin(u * 31 - v * 13 + 0.6) + 0.005 * Math.sin(u * 63 + v * 47);
    return MATTRESS_TOP + 0.035 + chest + legs + feet + wrinkles;
  };
  for (let j = 0; j <= NV; j++) {
    const v = (j / NV) * LENGTH;
    for (let i = 0; i <= NU; i++) {
      const u = -0.68 + (i / NU) * 1.36;
      const over = Math.abs(u) - 0.5;
      const x = over > 0 ? Math.sign(u) * 0.515 : u;
      const y = over > 0 ? top(0.5 * Math.sign(u), v) - over * 1.1 : top(u, v);
      positions.push(BED_X + x, y, BED_HEAD_Z - 0.65 - v);
      uvs.push(u, v);
    }
  }
  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NU; i++) {
      const a = j * (NU + 1) + i;
      const b = a + NU + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setAttribute('uv1', new Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

/** Something wrapped: a body's outline turned on a lathe, then pulled in by the silk and leaned over. */
function cocoonGeometry(): BufferGeometry {
  const outline = [[0.015, 0], [0.09, 0.08], [0.15, 0.28], [0.18, 0.55], [0.215, 0.8], [0.2, 0.93], [0.085, 1.02], [0.075, 1.06], [0.125, 1.14], [0.135, 1.22], [0.1, 1.31], [0.0, 1.35]] as const;
  const g = new LatheGeometry(new SplineCurve(outline.map(([r, y]) => new Vector2(r, y))).getPoints(58), 44);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let z = p.getZ(i);
    const y = p.getY(i);
    const theta = Math.atan2(x, z);
    const pull = 1 + 0.1 * Math.sin(y * 24 + theta * 3) + 0.05 * Math.sin(y * 57 - theta * 5) + 0.05 * Math.sin(y * 7 + theta * 2);
    x *= pull;
    z *= pull * 0.72;
    x += Math.max(0, y - 0.9) * 0.34;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

/** A hank of white hair, ribbons that face the bed: they gather a little as they fall, and none is straight. */
function hankGeometry(x: number, top: number, z: number, strands: number, spread: number, reach: readonly [number, number], seed: number, moves = true, fan = 0): BufferGeometry {
  const rnd = randomFrom(seed);
  const SEGMENTS = 12;
  const positions: number[] = [];
  const along: number[] = [];
  const indices: number[] = [];
  const toEye = Math.hypot(EYE[0] - x, EYE[2] - z) || 1;
  const wx = -(EYE[2] - z) / toEye;
  const wz = (EYE[0] - x) / toEye;
  for (let i = 0; i < strands; i++) {
    const a0 = rnd() * Math.PI * 2;
    const r0 = Math.sqrt(rnd()) * spread;
    const rx = Math.cos(a0) * r0;
    const rz = Math.sin(a0) * r0;
    const length = lerp(reach[0], reach[1], rnd());
    const phase = rnd() * 6.283;
    const wave = 0.016 + rnd() * 0.05;
    const turns = 1.4 + rnd() * 2.4;
    const gather = 0.3 + rnd() * 0.6;
    const base = positions.length / 3;
    for (let k = 0; k <= SEGMENTS; k++) {
      const v = k / SEGMENTS;
      const half = 0.0012 * (1 - v * 0.85);
      const ox = rx * (1 - gather * v + fan * v) + wave * v * Math.sin(v * turns * 6.283 + phase);
      const oz = rz * (1 - gather * v + fan * v) + wave * v * Math.cos(v * turns * 8.1 + phase * 1.7);
      const y = top - length * v;
      positions.push(x + ox - wx * half, y, z + oz - wz * half, x + ox + wx * half, y, z + oz + wz * half);
      along.push(moves ? v : 0, phase, moves ? v : 0, phase);
      if (k < SEGMENTS) {
        const c = base + k * 2;
        indices.push(c, c + 1, c + 2, c + 1, c + 3, c + 2);
      }
    }
  }
  const g = new BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('hairAt', new Float32BufferAttribute(along, 2));
  return g;
}

/** A `spider` prop of its own, darker: what is on the ceiling and on the lens should be a shape before it is a surface. */
function darken(spider: Object3D, amount: number, roughness: number): void {
  const copies = new Map<Material, Material>();
  spider.traverse((o) => {
    o.frustumCulled = false;
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    let copy = copies.get(mesh.material as Material);
    if (!copy) {
      const made = (mesh.material as MeshStandardMaterial).clone();
      made.color.multiplyScalar(amount);
      made.roughness = roughness;
      copy = made;
      copies.set(mesh.material as Material, copy);
    }
    mesh.material = copy;
  });
}

/** Sets a `spider` prop's legs for a place in its walk (cycles): two groups of four, in turn. */
function stride(legs: readonly Object3D[], phase: number, swing: number, lift: number): void {
  for (let i = 0; i < 8; i++) {
    const left = i < 4;
    const n = i % 4;
    const offset = (n % 2 === 0) === left ? 0 : 0.5;
    const p = (((phase + offset + n * 0.03) % 1) + 1) % 1;
    const down = p < 0.62;
    const q = down ? p / 0.62 : (p - 0.62) / 0.38;
    const reach = down ? 1 - 2 * q : -1 + 2 * q;
    const up = down ? 0 : Math.sin(q * Math.PI);
    legs[i].rotation.y = (left ? -1 : 1) * reach * swing;
    legs[i].rotation.z = (left ? 1 : -1) * up * lift;
  }
}

/** One thing on silk. */
interface Hanging {
  x: number;
  z: number;
  from: number;
  fall: number;
  reach: number;
  spin: number;
  phase: number;
  scale: number;
}

const m = new Matrix4();
const q = new Quaternion();
const q2 = new Quaternion();
const p = new Vector3();
const scaleV = new Vector3();
const UP = new Vector3(0, 1, 0);
const ACROSS = new Vector3(1, 0, 0);
const NOTHING = new Matrix4().makeScale(0, 0, 0);

/**
 * You lie on your back in a narrow bed and there is one spider on the ceiling. Only one. The room is the ceiling:
 * its old water, its cracks, one warm lamp at the edge of the eye, a door you did not leave open. It goes when you
 * stop watching it, and after that every time you blink there are more, and the ceiling is a little lower.
 */
export default class Spiders extends Room {
  readonly keys: readonly RoomKey[] = LOOKS;
  readonly air: RoomAir = {
    fog: { color: 0x070b0a, density: 0.03 },
    env: 'bathroom',
    envIntensity: 0.14,
    sky: 0,
    grade: { exposure: 1.2, saturation: 0.8, warmth: 0.05, tint: -0.02, flare: 0.003 },
  };
  film: RoomFilm = { bloom: 0.75, bloomFrom: 0.75, grain: 0.38, scratches: 0.06, flicker: 0.02, weave: 0.0004 };
  focus = FOCUS_CEILING;
  aperture = APERTURE_CEILING;
  drift = 0.18;
  fear = 0.18;
  control: RoomControl = { look: true, scroll: true, hurry: 1.5 };

  /** All that comes down with the ceiling. */
  private readonly ceiling = new Group();
  private readonly lid = { uHalf: { value: 0.045 }, uLid: { value: 0 } };
  private readonly shade = { uLegs: { value: Array.from({ length: 33 }, () => new Vector2()) }, uShadow: { value: 0 }, uGlow: { value: 1 } };
  private readonly lampLight: DreamLight;
  private readonly lampUp: SpotSpec;
  private readonly lampDown: SpotSpec;
  private readonly bigLight: DreamLight;
  private readonly bigRim: DreamLight;
  private readonly doorHinge: Object3D;

  private readonly hero: Object3D;
  private readonly heroLegs: readonly Object3D[];
  private readonly heroShadow: Mesh;
  /** Each walk of the first spider, worked out once: from, to, start and end, its heading, its length. */
  private readonly walks: { from: number; to: number; x0: number; z0: number; x1: number; z1: number; heading: number; length: number }[] = [];
  private away = 0;
  private lookedAway = false;
  private lastStep = 0;
  private lastSeconds = 0;

  private readonly still: ReturnType<RoomContext['kit']['props']>;
  private readonly swarm: Swarm;
  private readonly hanging: Hanging[] = [];
  private readonly hung: ReturnType<RoomContext['kit']['props']>;
  private readonly silk: LineSegments;
  private readonly silkAt: Float32Array;
  private readonly hanks: Mesh[] = [];
  private readonly hairClock: { value: number };
  private readonly clocks: { value: number }[] = [];

  private readonly big: Object3D;
  private readonly bigLegs: readonly Object3D[];

  private readonly voices: RoomVoice[] = [];
  private soft: RoomVoice | null = null;
  private hard: RoomVoice | null = null;
  private skitter: RoomVoice | null = null;
  private tone: RoomVoice | null = null;
  private breath: RoomVoice | null = null;
  private skin: RoomVoice | null = null;
  private readonly tickOptions: RoomVoiceOptions = { gain: 0.2, pan: 0 };
  private tickIndex = 0;
  private wasWalking = false;
  private panClock = 0;

  constructor(ctx: RoomContext) {
    super(ctx);
    this.root.add(this.ceiling);
    this.buildRoom();
    this.buildBed();
    const lit = this.buildLamp();
    this.lampLight = lit.point;
    this.lampUp = lit.up;
    this.lampDown = lit.down;
    this.spots = [this.lampDown, this.lampUp, null];
    this.doorHinge = this.buildDoor();
    const strand = this.build.hair(1, { x: [0, 0], y: H, z: [0, 0] }, [0.01, 0.01], this.ceiling, { sway: 0.04, color: 0xa39c8d });
    strand.mesh.visible = false;
    this.hairClock = strand.time;
    this.buildWeb(strand.mesh.material as Material);
    this.light([0.2, 1.75, -2.6], FILL_COLOR, DOOR_FILL, 3.6);
    this.light([0.72, 2.25, 0.2], FILL_COLOR, WEB_FILL, 2.2);
    this.bigLight = this.light([EYE[0] - 0.355, EYE[1] - 0.1, EYE[2] - 0.097], WARM, 0, 1.2);
    this.bigRim = this.light([EYE[0] + 0.415, EYE[1] + 0.234, EYE[2] - 0.108], 0xa9c6d6, 0, 1.2);

    // the first one
    this.hero = this.kit.prop('spider', [HERO_AT[0], H, HERO_AT[1]], { rotation: [180, 0, 0], anchor: 'top', scale: HERO_SCALE }, this.ceiling);
    this.heroLegs = LEG_NAMES.map((n) => this.hero.getObjectByName(n)!);
    darken(this.hero, 0.55, 0.7);
    let x0: number = HERO_AT[0];
    let z0: number = HERO_AT[1];
    for (const [from, to, x1, z1] of HERO_WALKS) {
      this.walks.push({ from, to, x0, z0, x1, z1, heading: Math.atan2(-(x1 - x0), -(z1 - z0)), length: Math.hypot(x1 - x0, z1 - z0) });
      x0 = x1;
      z0 = z1;
    }
    const shadowMap = canvasTexture(128, drawSpiderShadow);
    const shadowSize = 0.26 * HERO_SCALE;
    const shadowGeometry = new PlaneGeometry(shadowSize, shadowSize);
    shadowGeometry.rotateX(Math.PI / 2);
    this.heroShadow = new Mesh(shadowGeometry, new MeshBasicMaterial({ map: shadowMap, transparent: true, premultipliedAlpha: true, depthWrite: false, color: 0x000000, fog: false }));
    this.heroShadow.renderOrder = 2;
    this.heroShadow.frustumCulled = false;
    this.ceiling.add(this.heroShadow);

    // the five and the thirty are the same animal, and stiller than anything alive
    this.still = this.kit.props('spider', 30, { rotation: [180, 0, 0] });
    const scatter = randomFrom(63);
    const taken: [number, number][] = [];
    for (let i = 0; i < 30; i++) {
      let x: number;
      let z: number;
      let heading: number;
      let scale: number;
      if (i < FIVE.length) {
        [x, z, heading, scale] = FIVE[i];
      } else {
        let tries = 0;
        do {
          x = -1.42 + scatter() * 2.84;
          z = -3.18 + scatter() * 2.62;
          tries++;
        } while (tries < 60 && taken.some(([a, b]) => Math.hypot(a - x, b - z) < 0.3));
        heading = scatter() * 6.283;
        scale = 0.85 + scatter() * 0.55;
      }
      taken.push([x, z]);
      this.still.set(i, x, H - SPIDER_HEIGHT * scale, z, heading, scale);
    }
    this.still.commit();
    this.still.root.visible = false;
    this.ceiling.add(this.still.root);

    const ceilingPlane: CrawlSurface = { corner: [-W / 2, H, -D], u: [W, 0, 0], v: [0, 0, D] };
    const surfaces: CrawlSurface[] = [
      ceilingPlane, ceilingPlane, ceilingPlane, ceilingPlane, ceilingPlane, ceilingPlane, ceilingPlane,
      { corner: [-W / 2, H - 0.6, -D], u: [W, 0, 0], v: [0, 0.6, 0] },
      { corner: [-W / 2, H - 0.7, 0], u: [0, 0, -D], v: [0, 0.7, 0] },
      { corner: [W / 2, H - 0.7, -D], u: [0, 0, D], v: [0, 0.7, 0] },
    ];
    const tiny = new Mesh(tinySpider(), new MeshStandardMaterial({ color: 0x0d0b09, roughness: 0.55, side: DoubleSide }));
    this.swarm = new Swarm(tiny, SWARM_COUNT, surfaces, { size: [0.55, 1.3], speed: [0.06, 0.3], lift: 0.004, tremble: 0.1, seed: 17 });
    this.swarm.root.visible = false;
    this.swarm.reveal(0);
    this.ceiling.add(this.swarm.root);

    // what comes down
    for (let i = 0; i < HANKS.length; i++) {
      const hank = new Mesh(hankGeometry(HANKS[i][0], H, HANKS[i][1], HANK_STRANDS, HANK_HALF, HAIR_LENGTH, 41 + i * 7), strand.mesh.material);
      hank.frustumCulled = false;
      hank.visible = false;
      this.ceiling.add(hank);
      this.hanks.push(hank);
    }

    const hangs = randomFrom(83);
    for (let i = 0; i < SILK_COUNT; i++) {
      let x: number;
      let z: number;
      do {
        x = -1.35 + hangs() * 2.5;
        z = -3.0 + hangs() * 2.65;
      } while (Math.hypot(x - EYE[0], z - EYE[2]) < SILK_AXIS);
      const lowest = H - (EYE[1] + SILK_CLEAR);
      this.hanging.push({
        x,
        z,
        from: SILK_AT + hangs() * SILK_SPREAD,
        fall: 2.2 + hangs() * 2.4,
        reach: Math.min(lowest, 0.5 + hangs() * 1.0),
        spin: (0.25 + hangs() * 0.7) * (hangs() < 0.5 ? -1 : 1) * SILK_SPIN,
        phase: hangs() * 6.283,
        scale: 0.8 + hangs() * 0.75,
      });
    }
    this.hung = this.kit.props('spider_low', SILK_COUNT);
    this.hung.root.visible = false;
    this.ceiling.add(this.hung.root);
    this.silkAt = new Float32Array(SILK_COUNT * 6);
    const silkGeometry = new BufferGeometry();
    const silkAttribute = new Float32BufferAttribute(this.silkAt, 3);
    silkAttribute.setUsage(DynamicDrawUsage);
    silkGeometry.setAttribute('position', silkAttribute);
    this.silk = new LineSegments(silkGeometry, new LineBasicMaterial({ color: 0xd8d3c2, transparent: true, opacity: 0.72 }));
    this.silk.frustumCulled = false;
    this.silk.visible = false;
    this.ceiling.add(this.silk);

    // on the lens
    this.big = this.kit.prop('spider', [0, -1, -0.3], { scale: BIG_SCALE, anchor: 'center' }, this.lens);
    this.big.rotation.order = 'ZXY';
    this.bigLegs = LEG_NAMES.map((n) => this.big.getObjectByName(n)!);
    darken(this.big, 0.3, 0.55);
    this.big.visible = false;
    this.eyes(this.big);
    const lids = new Mesh(new PlaneGeometry(0.5, 0.4), new ShaderMaterial({ vertexShader: LID_VERT, fragmentShader: LID_FRAG, uniforms: this.lid, transparent: true, depthWrite: false, depthTest: false }));
    lids.position.z = -0.07;
    lids.renderOrder = 900;
    lids.frustumCulled = false;
    this.lens.add(lids);

    this.clocks.push(this.build.motes(45, { x: [-W / 2, W / 2], y: [0.8, H - 0.1], z: [-D, -0.3] }, this.root, { strength: 0.3 }).time);

    this.schedule();
  }

  private buildRoom(): void {
    const { kit, build: b } = this;
    // the paper: a damask printed on a sheet that has aged
    const paper = kit.surface('wallpaper_old', 2.5, { roughness: 1 });
    const ink = (b.damask(['#0f3236', '#6fa7a0']) as MeshStandardMaterial).map!.image as CanvasImageSource;
    const aged = paper.map!.image as CanvasImageSource;
    const S = 1536;
    const sheet = canvasTexture(S, (c) => {
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) c.drawImage(ink, (i * S) / 6, (j * S) / 6, S / 6, S / 6);
      c.globalCompositeOperation = 'multiply';
      c.globalAlpha = 0.6;
      c.drawImage(aged, 0, 0, S, S);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
    });
    sheet.wrapS = sheet.wrapT = RepeatWrapping;
    sheet.repeat.setScalar(1 / 2.5);
    paper.map = sheet;
    b.box(W, D, H, { walls: paper, floor: kit.surface('wood_floor_dark', 2.0) }, this.root);
    b.wainscot(W / 2, -D / 2, D, '-x', this.root, 0.72);
    b.wainscot(-W / 2, -D / 2, D, '+x', this.root, 0.72);
    b.wainscot(0, -D, W, '+z', this.root, 0.72);
    b.wainscot(0, 0, W, '-z', this.root, 0.72);

    const plaster = kit.floor(-W / 2, W / 2, -D, 0, H, kit.surface('plaster_mould', 1.8, { color: new Color(1.5, 1.42, 1.24) }));
    plaster.rotation.x = Math.PI / 2;
    this.ceiling.add(plaster);
    const stains = new Mesh(
      new PlaneGeometry(W, D),
      new MeshBasicMaterial({ map: canvasTexture(2048, drawStains), blending: MultiplyBlending, transparent: true, premultipliedAlpha: true, depthWrite: false, fog: false }),
    );
    stains.rotation.x = Math.PI / 2;
    stains.position.set(0, H - 0.0015, -D / 2);
    stains.renderOrder = 1;
    stains.frustumCulled = false;
    this.ceiling.add(stains);
    const age = canvasTexture(1024, drawWallAge);
    const aged2 = new MeshBasicMaterial({ map: age, blending: MultiplyBlending, transparent: true, premultipliedAlpha: true, depthWrite: false, fog: false });
    const dirty = (width: number, x: number, z: number, heading: number) => {
      const plane = new Mesh(new PlaneGeometry(width, H), aged2);
      plane.position.set(x, H / 2, z);
      plane.rotation.y = heading;
      plane.renderOrder = 1;
      plane.frustumCulled = false;
      this.root.add(plane);
    };
    dirty(W, 0, -D + 0.002, 0);
    dirty(D, -W / 2 + 0.002, -D / 2, Math.PI / 2);
    dirty(D, W / 2 - 0.002, -D / 2, -Math.PI / 2);
    const cornice = new Mesh(corniceGeometry(), new MeshStandardMaterial({ color: 0x8f8b7c, roughness: 0.85 }));
    cornice.frustumCulled = false;
    cornice.receiveShadow = true;
    this.ceiling.add(cornice);

    // the picture, on the wall by the bed
    const hung = new Group();
    hung.position.set(-W / 2 + 0.018, 1.62, -0.55);
    hung.rotation.y = Math.PI / 2;
    this.root.add(hung);
    const frameParts = [[0.74, 0.05, 0, 0.245], [0.74, 0.05, 0, -0.245], [0.05, 0.54, 0.345, 0], [0.05, 0.54, -0.345, 0]] as const;
    const frame = new Mesh(mergeGeometries(frameParts.map(([fw, fh, fx, fy]) => new BoxGeometry(fw, fh, 0.03).translate(fx, fy, 0.012)))!, new MeshStandardMaterial({ color: 0x1a120c, roughness: 0.5 }));
    frame.frustumCulled = false;
    hung.add(frame);
    const picture = b.label(0.64, 0.44, drawFamily, { px: 900, roughness: 0.5 });
    picture.mesh.position.z = 0.004;
    hung.add(picture.mesh);
  }

  private buildBed(): void {
    const { kit, build: b } = this;
    kit.prop('bed_iron', [BED_X, 0, BED_HEAD_Z - 1.05], { rotation: [0, 180, 0], nodes: ['frame'] }, this.root);
    kit.prop('pillow', [BED_X, MATTRESS_TOP - 0.02, BED_HEAD_Z - 0.2], { rotation: [0, 4, 0] }, this.root);
    const blanket = new Mesh(blanketGeometry(), kit.surface('carpet_dirty', 0.5, { color: new Color(0.8, 0.86, 0.82) }));
    blanket.frustumCulled = false;
    blanket.receiveShadow = true;
    this.root.add(blanket);
    b.contactShadow(BED_X, BED_HEAD_Z - 1.05, 1.2, this.root, 0.75);
    b.contactShadow(TABLE_X, TABLE_Z, 0.5, this.root, 0.75);
  }

  private buildLamp(): { point: DreamLight; up: SpotSpec; down: SpotSpec } {
    const { kit, build: b } = this;
    kit.prop('nightstand_painted', [TABLE_X, 0, TABLE_Z], { rotation: [0, 90, 0] }, this.root);
    const lamp = new Group();
    lamp.position.set(LAMP_X, TABLE_TOP, LAMP_Z);
    this.root.add(lamp);
    const glaze = new MeshStandardMaterial({ color: 0x1a2a26, roughness: 0.22, metalness: 0 });
    const body = [[0, 0], [0.055, 0], [0.062, 0.014], [0.046, 0.036], [0.074, 0.106], [0.086, 0.165], [0.062, 0.236], [0.026, 0.29], [0.02, 0.32], [0.012, 0.355], [0, 0.355]] as const;
    const base = new Mesh(new LatheGeometry(body.map(([r, y]) => new Vector2(r, y)), 28), glaze);
    base.frustumCulled = false;
    base.castShadow = true;
    lamp.add(base);
    const brass = new MeshStandardMaterial({ color: 0x5c4a28, roughness: 0.42, metalness: 1 });
    const inShade = new Group();
    inShade.position.y = SHADE_Y - TABLE_TOP;
    // the shade's own front faces the bed, so that what crawls inside is seen at its widest
    inShade.rotation.y = Math.atan2(EYE[0] - LAMP_X, EYE[2] - LAMP_Z);
    lamp.add(inShade);
    const half = SHADE_HEIGHT / 2;
    const paper = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide });
    paper.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, this.shade);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vShade;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvShade = position;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${SHADE_HEAD}`).replace('#include <color_fragment>', `#include <color_fragment>\n${SHADE_BODY}`);
    };
    paper.customProgramCacheKey = () => 'spiders-shade';
    const profile = [new Vector2(SHADE_BOTTOM, -half), new Vector2(SHADE_BOTTOM - 0.012, -half + 0.05), new Vector2((SHADE_BOTTOM + SHADE_TOP) / 2 + 0.002, 0), new Vector2(SHADE_TOP + 0.01, half - 0.05), new Vector2(SHADE_TOP, half)];
    const shadeMesh = new Mesh(new LatheGeometry(new SplineCurve(profile).getPoints(14), 64), paper);
    shadeMesh.frustumCulled = false;
    inShade.add(shadeMesh);
    for (const [radius, y] of [[SHADE_BOTTOM, -half], [SHADE_TOP, half]] as const) {
      const rim = new Mesh(new TorusGeometry(radius, 0.0035, 6, 56), brass);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = y;
      rim.frustumCulled = false;
      inShade.add(rim);
    }
    const bulb = new Mesh(new SphereGeometry(0.03, 14, 10), new MeshBasicMaterial({ color: new Color(9, 6.2, 3.2) }));
    bulb.position.y = BULB[1] - TABLE_TOP;
    lamp.add(bulb);

    // on the table: the clock that says half past, a glass of water gone flat
    const clock = kit.prop('alarm_clock', [TABLE_X + 0.1, TABLE_TOP, TABLE_Z + 0.15], { castShadow: true }, this.root);
    clock.updateWorldMatrix(true, true);
    const setHand = (name: string, rest: number, angle: number) => {
      const hand = clock.getObjectByName(name)!;
      const axle = new Group();
      axle.position.set(0, 0.0646, 0);
      hand.parent!.add(axle);
      axle.updateWorldMatrix(true, false);
      axle.attach(hand);
      axle.rotation.z = rest - angle;
    };
    setHand('houd_hand', 2.7724, 195 * DEG);
    setHand('minute_hand', 5.2257, Math.PI);
    setHand('second_hand', 0.4136, 0);
    clock.rotation.y = Math.atan2(EYE[0] - clock.position.x, EYE[2] - clock.position.z);

    b.glow(LAMP_X, SHADE_Y, LAMP_Z, 1.0, WARM, 0.1, this.root);
    const point = this.light(BULB, WARM, LAMP_POINT, LAMP_REACH);
    const up = this.spot(BULB, LAMP_UP_AIM, 0xffcc94, LAMP_UP, LAMP_UP_ANGLE, 0.42);
    const down = this.spot(BULB, [LAMP_X, 0, LAMP_Z], 0xffcc94, LAMP_DOWN, LAMP_DOWN_ANGLE, 0.5);
    return { point, up, down };
  }

  private buildDoor(): Object3D {
    const { kit } = this;
    const paint = new MeshStandardMaterial({ color: 0x343a35, roughness: 0.55 });
    kit.paint(kit.prop('door_frame', [DOOR_X, 0, -D + 0.012], {}, this.root), paint);
    const beyond = new Mesh(new PlaneGeometry(0.86, 2.0), new MeshBasicMaterial({ color: 0x000000 }));
    beyond.position.set(DOOR_X, 1.0, -D + 0.004);
    beyond.frustumCulled = false;
    this.root.add(beyond);
    const hinge = new Group();
    hinge.position.set(DOOR_X + 0.419, 0.015, -D + 0.03);
    this.root.add(hinge);
    kit.paint(kit.prop('door_six', [-0.419, 0, 0], {}, hinge), paint);
    kit.prop('door_knob', [-0.77, 0.94, 0], {}, hinge);
    return hinge;
  }

  private buildWeb(hairMaterial: Material): void {
    const size = 3.0;
    const at = new Vector3(1.02, 1.74, -0.34);
    const web = new Mesh(new PlaneGeometry(size, size), new MeshBasicMaterial({ map: canvasTexture(1536, drawWeb), transparent: true, depthWrite: false, color: new Color(0.36, 0.4, 0.38) }));
    web.position.copy(at);
    web.lookAt(at.x - 0.86, at.y - 0.5, at.z);
    web.frustumCulled = false;
    web.renderOrder = 2;
    this.root.add(web);
    // a second, nearer layer, so that threads pass in front of what it holds
    const veil = new Mesh(new PlaneGeometry(1.5, 1.5), web.material);
    veil.position.set(at.x - 0.3, at.y - 0.02, at.z + 0.06);
    veil.lookAt(at.x - 0.3 - 0.86, at.y - 0.02 - 0.5, at.z + 0.06);
    veil.rotation.z += 0.5;
    veil.frustumCulled = false;
    veil.renderOrder = 3;
    this.root.add(veil);

    const wrap = canvasTexture(1024, drawWrap);
    wrap.wrapS = wrap.wrapT = RepeatWrapping;
    wrap.repeat.set(2, 1);
    const cocoon = new Mesh(cocoonGeometry(), new MeshStandardMaterial({ map: wrap, roughness: 0.95, emissive: new Color(0.018, 0.02, 0.018) }));
    cocoon.position.set(1.04, 0.8, -0.34);
    cocoon.rotation.set(0.05, Math.PI / 2, 0.06);
    cocoon.scale.setScalar(1.05);
    cocoon.frustumCulled = false;
    cocoon.receiveShadow = true;
    this.root.add(cocoon);
    // the hair comes out at the top of it, and has gone on growing; it does not stir
    const hair = new Mesh(hankGeometry(0.82, 2.08, -0.48, 44, 0.09, [0.6, 1.75], 77, false, 1.6), hairMaterial);
    hair.frustumCulled = false;
    this.root.add(hair);
  }

  /** Eight eyes, on a dark rise of the head, and the lamp in each of them. */
  private eyes(spider: Object3D): void {
    const glass: BufferGeometry[] = [];
    const sparks: BufferGeometry[] = [];
    for (const [x, y, z, r] of SPIDER_EYES) {
      for (const side of [-1, 1]) {
        glass.push(new SphereGeometry(r, 14, 10).translate(side * x, y, z));
        sparks.push(new SphereGeometry(r * 0.13, 6, 4).translate(side * x - r * 0.48, y - r * 0.34, z + r * 0.8));
      }
    }
    const holder = spider.getObjectByName('body')!.parent!;
    const eyeball = new Mesh(mergeGeometries(glass)!, new MeshStandardMaterial({ color: 0x030304, roughness: 0.08 }));
    const spark = new Mesh(mergeGeometries(sparks)!, new MeshBasicMaterial({ color: new Color(1.7, 0.95, 0.42) }));
    eyeball.frustumCulled = false;
    spark.frustumCulled = false;
    holder.add(eyeball, spark);
  }

  private tick(pan: number, gain: number, soft: boolean): void {
    const files = soft ? SOFT_TICK_FILES : TICK_FILES;
    this.tickIndex = (this.tickIndex + 1) % files.length;
    this.tickOptions.gain = gain;
    this.tickOptions.pan = pan;
    this.sound.play(files[this.tickIndex % files.length], this.tickOptions);
  }

  /** Everything that happens once. */
  private schedule(): void {
    const s = this.sound;
    const keep = (v: RoomVoice) => {
      this.voices.push(v);
      return v;
    };
    this.beat(0, () => {
      this.tone = keep(s.bed('rooms/bedroom_tone.mp3', { gain: 0.25, fade: 1.5 }));
      this.breath = keep(s.bed('rooms/breath_calm.mp3', { gain: 0.07, fade: 3 }));
      this.soft = keep(s.bed('rooms/spider_legs_soft.mp3', { gain: 0 }));
      this.hard = keep(s.bed('rooms/spider_legs_hard.mp3', { gain: 0, rate: 0.9 }));
    });
    this.beat(SAY_ONLY_AT, () => this.say({ tr: 'Sadece bir tane.', en: 'Only one.' }, 4));
    this.beat(SAY_WHERE_AT, () => this.say({ tr: 'Nerede?', en: 'Where is it?' }, 3));
    this.beat(HUSH_AT, () => {
      this.breath?.gain(0, 2);
      this.tone?.gain(0.09, 1.5);
    });
    this.beat(SPRING_AT, () => s.play('rooms/bedspring_2.mp3', { gain: 0.14, reverb: 0.1 }));
    this.beat(FLOORBOARD_AT, () => s.play('rooms/floor_creak_3.mp3', { gain: 0.3, pan: 0.7, lowpass: 1800, reverb: 0.15 }));
    for (let i = 0; i < ACROSS_TICKS; i++) {
      const k = i / (ACROSS_TICKS - 1);
      const at = ACROSS_FROM + k * ACROSS_FOR + ((i * 7) % 3) * 0.04;
      this.beat(at, () => this.tick(lerp(0.95, -0.85, k), lerp(0.14, 0.24, k), i < 7));
    }
    this.beat(SHADE_FROM, () => {
      this.soft?.pan(-0.75, 0.3);
      this.soft?.gain(0.08, 0.5);
    });
    this.beat(SHADE_SOUND_AT, () => this.soft?.gain(0, 0.5));
    for (let i = 0; i < BACK_TICKS; i++) {
      const k = i / (BACK_TICKS - 1);
      this.beat(BACK_FROM + k * BACK_FOR, () => this.tick(lerp(-0.8, 0, k), lerp(0.2, 0.08, k), true));
    }
    this.beat(BEFORE_FIVE_AT, () => this.tone?.gain(0.03, 0.3));
    this.beat(FIVE_AT, () => {
      this.skitter = keep(s.bed('rooms/spider_skitter.mp3', { gain: 0.12, pan: -0.9 }));
      this.skitter.pan(0.9, 4.2);
      keep(s.bed('rooms/dream_drone_low.mp3', { gain: 0.08, fade: 6 }));
      keep(s.bed('rooms/breath_scared.mp3', { gain: 0.12, fade: 1.5 }));
      this.tone?.gain(0.12, 1);
    });
    this.beat(SKITTER_OFF_AT, () => this.skitter?.gain(0, 0.5));
    for (const [at, pan] of STILL_TICKS) this.beat(at, () => this.tick(pan, 0.22, false));
    this.beat(THIRTY_AT, () => {
      this.soft?.pan(0, 0.4);
      this.soft?.gain(0.11, 1);
      this.hard?.gain(0.05, 1);
      keep(s.play('rooms/breath_rising.mp3', { gain: 0.24 }));
    });
    this.beat(THOUSANDS_AT, () => {
      keep(s.play('rooms/swarm_swell.mp3', { gain: 0.5 }));
      keep(s.bed('rooms/bugs_writhe.mp3', { gain: 0.12, fade: 3 }));
      this.hard?.gain(0.1, 1);
      this.soft?.gain(0.14, 1);
    });
    this.beat(SWARM_TURN_AT, () => this.swarm.steer(EYE[0], H, EYE[2], SWARM_PULL));
    this.beat(HANKS[0][2], () => keep(s.bed('rooms/hair_fingers.mp3', { gain: 0.2, fade: 3 })));
    this.beat(BIG_FROM, () => {
      keep(s.bed('rooms/spider_chitter.mp3', { gain: 0.08, fade: 1 }));
      keep(s.bed('rooms/insects_contact_wide.mp3', { gain: 0.14, fade: 1.5 }));
      this.hard?.rate(1.12, 1);
    });
    this.beat(SHUTTER_AT, () => this.shutter());
    this.beat(COVER_AT - 0.12, () => s.play('rooms/gasp_2.mp3', { gain: 0.3 }));
    this.beat(COVER_AT, () => {
      for (const v of this.voices) v.stop(0.06);
      this.voices.length = 0;
      this.skin = s.bed('rooms/legs_on_skin.mp3', { gain: 0.3, fade: 0.25 });
    });
    this.beat(SAY_LAST_AT, () => this.say({ tr: 'Bir tane demiştin.', en: 'You said only one.' }, 3.4));
    this.beat(CUT_AT, () => this.skin?.stop(0.05));
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    this.lid.uHalf.value = 0.07 * Math.tan((frame.view.fov * DEG) / 2);
    let open = 1;
    for (let i = 0; i < BLINKS.length; i++) {
      const d = Math.abs(s - BLINKS[i][0]) / BLINKS[i][1];
      if (d < 1) open = Math.min(open, smootherstep(d));
    }
    this.lid.uLid.value = open;
    this.black = open < 0.01 ? 1 : range(COVER_AT - 0.1, COVER_AT + COVER_TIME * 0.7, s);

    this.ceiling.position.y = s < THIRTY_AT ? 0 : s < THOUSANDS_AT ? -DROP_AT_41 : -DROP_AT_45;
    this.doorHinge.rotation.y = DOOR_AJAR[s < FIVE_AT ? 0 : s < THIRTY_AT ? 1 : s < THOUSANDS_AT ? 2 : 3];
    for (const clock of this.clocks) clock.value = frame.time;

    this.walkTheFirst(frame, s);

    const stillCount = s < FIVE_AT ? 0 : s < THIRTY_AT ? FIVE.length : s < THOUSANDS_AT ? 30 : 0;
    this.still.root.visible = stillCount > 0;
    this.still.drawn = stillCount;

    const crawling = s >= THOUSANDS_AT;
    this.swarm.root.visible = crawling;
    if (crawling) {
      this.swarm.reveal(SWARM_COUNT);
      this.swarm.update(frame.dt, SWARM_RATE * lerp(0.7, 1.15, range(THOUSANDS_AT, BIG_FROM, s)));
    }

    this.layTheShade(frame, s);
    this.comeDown(frame, s);
    this.theBigOne(s);

    const toLamp = smootherstep(range(27.6, 30, s)) * (1 - smootherstep(range(33.6, 35.4, s)));
    const toBig = smootherstep(range(53, 55.4, s));
    this.focus = lerp(lerp(FOCUS_CEILING, FOCUS_LAMP, toLamp), FOCUS_BIG, toBig);
    this.aperture = lerp(lerp(APERTURE_CEILING, APERTURE_LAMP, toLamp), APERTURE_BIG, toBig);
    this.fear = s < FIVE_AT ? lerp(0.18, 0.42, s / FIVE_AT) : s < COVER_AT ? lerp(0.5, 1, range(FIVE_AT, BIG_FROM, s)) : lerp(1, 0.3, range(COVER_AT, CUT_AT, s));
    this.film.aberration = lerp(0, 0.3, range(BIG_FROM, BIG_STOP, s));
    this.lastSeconds = s;
  }

  /** The first one: a pure function of time, until it is looked away from. */
  private walkTheFirst(frame: RoomFrame, s: number): void {
    if (s < AWAY_FROM) {
      this.away = 0;
      this.lookedAway = false;
    }
    const gone = this.lookedAway || s >= 20;
    this.hero.visible = !gone;
    this.heroShadow.visible = !gone;
    if (gone) {
      if (this.wasWalking) {
        this.wasWalking = false;
        this.soft?.gain(0, 0.2);
        this.hard?.gain(0, 0.2);
      }
      return;
    }
    let moving = false;
    let x: number = HERO_AT[0];
    let z: number = HERO_AT[1];
    let heading = 0.35;
    let walked = 0;
    for (let i = 0; i < this.walks.length; i++) {
      const w = this.walks[i];
      if (s < w.from - 0.5) break;
      heading += (w.heading - heading) * smootherstep(range(w.from - 0.5, w.from + 0.2, s));
      const k = range(w.from, w.to, s);
      x = lerp(w.x0, w.x1, k);
      z = lerp(w.z0, w.z1, k);
      walked += w.length * k;
      if (k > 0 && k < 1) moving = true;
    }
    this.hero.position.set(x, H, z);
    this.hero.rotation.y = heading;
    stride(this.heroLegs, walked / HERO_STRIDE, HERO_SWING, HERO_LIFT);
    // when it has stopped, the front pair feels the air
    const feel = Math.sin(Math.PI * range(7.2, 8.8, s)) + Math.sin(Math.PI * range(11.2, 12.5, s)) + Math.sin(Math.PI * range(17.6, 19, s));
    this.heroLegs[0].rotation.z += feel * 0.34;
    this.heroLegs[4].rotation.z -= feel * 0.34;

    const lx = x - LAMP_X;
    const lz = z - LAMP_Z;
    const away = 0.038 / (Math.hypot(lx, lz) || 1);
    this.heroShadow.position.set(x + lx * away, H - 0.002, z + lz * away);
    this.heroShadow.rotation.y = heading + Math.PI;

    const step = Math.floor(walked / (HERO_STRIDE / 6));
    if (step !== this.lastStep && s > this.lastSeconds) this.tick(clamp((x - EYE[0]) / 1.1, -1, 1), HERO_TICK, false);
    this.lastStep = step;

    if (moving !== this.wasWalking) {
      this.wasWalking = moving;
      this.soft?.gain(moving ? WALK_SOFT : 0, 0.2);
      this.hard?.gain(moving ? WALK_HARD : 0, 0.2);
    }
    if (moving && frame.time - this.panClock > 0.2) {
      this.panClock = frame.time;
      const pan = clamp((x - EYE[0]) / 1.1, -1, 1);
      this.soft?.pan(pan, 0.2);
      this.hard?.pan(pan, 0.2);
    }

    if (s >= AWAY_FROM && !frame.paused) {
      this.away = this.unseen(frame, x, H, z, 2) ? this.away + frame.dt : 0;
      if (this.away >= AWAY_FOR) this.lookedAway = true;
    }
  }

  /** The shade: its light, and at 30 what is inside it. */
  private layTheShade(frame: RoomFrame, s: number): void {
    const enter = smootherstep(range(SHADE_FROM, SHADE_FROM + 1.1, s));
    const leave = smootherstep(range(SHADE_LEAVE, SHADE_GONE, s));
    const show = enter * (1 - leave);
    const breath = 1 + 0.05 * wobble(frame.time * 0.5, 3);
    this.shade.uShadow.value = enter > 0 && leave < 1 ? 1 : 0;
    const dim = 1 - show * 0.22;
    this.shade.uGlow.value = breath;
    this.lampLight.intensity = LAMP_POINT * breath * dim;
    this.lampUp.intensity = LAMP_UP * breath * dim;
    this.lampDown.intensity = LAMP_DOWN * breath * dim;
    if (this.shade.uShadow.value === 0) return;

    const j = this.shade.uLegs.value;
    const bodyX = 0.012 * wobble(s * 0.7, 1);
    const bodyY = lerp(0.2, -0.002, enter) + 0.28 * leave + 0.008 * wobble(s * 0.5, 4);
    j[32].set(bodyX, bodyY);
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1;
      const n = i % 4;
      const moved = wobble(s * (0.45 + n * 0.11), i * 2.3) * 0.2 + wobble(s * 1.5, i * 5.1) * 0.05;
      const a0 = side * (0.42 + n * 0.62 + moved);
      const hipX = bodyX + side * 0.018;
      const hipY = bodyY + 0.012 - n * 0.012;
      const kneeX = hipX + Math.sin(a0) * 0.07;
      const kneeY = hipY + Math.cos(a0) * 0.07 + 0.01;
      const a1 = a0 + side * 0.42;
      const footX = kneeX + Math.sin(a1) * 0.082;
      const footY = kneeY + Math.cos(a1) * 0.082 - 0.012;
      const a2 = a1 + side * 0.45;
      j[i * 4].set(hipX, hipY);
      j[i * 4 + 1].set(kneeX, kneeY);
      j[i * 4 + 2].set(footX, footY);
      j[i * 4 + 3].set(footX + Math.sin(a2) * 0.062, footY + Math.cos(a2) * 0.062);
    }
  }

  /** Hair, and those on silk. */
  private comeDown(frame: RoomFrame, s: number): void {
    this.hairClock.value = frame.time;
    for (let i = 0; i < HANKS.length; i++) {
      const from = HANKS[i][2];
      this.hanks[i].visible = s >= from;
      if (s >= from) this.hanks[i].position.y = (1 - smootherstep(range(from, from + HAIR_FALL, s))) * (HAIR_LENGTH[1] + 0.1);
    }
    const silkOn = s >= SILK_AT;
    this.hung.root.visible = silkOn;
    this.silk.visible = silkOn;
    if (!silkOn) return;
    for (let i = 0; i < SILK_COUNT; i++) {
      const h = this.hanging[i];
      const k = range(h.from, h.from + h.fall, s);
      const offset = i * 6;
      if (k <= 0) {
        this.hung.setMatrix(i, NOTHING);
        this.silkAt.fill(0, offset, offset + 6);
        continue;
      }
      const fallen = h.reach * smootherstep(k) + 0.012 * Math.sin(s * 1.3 + h.phase) * k;
      const x = h.x + 0.018 * Math.sin(s * 0.6 + h.phase) * k;
      const y = H - fallen;
      const z = h.z + 0.018 * Math.cos(s * 0.47 + h.phase) * k;
      q.setFromAxisAngle(UP, h.spin * s + h.phase);
      q2.setFromAxisAngle(ACROSS, 1.25);
      q.multiply(q2);
      m.compose(p.set(x, y, z), q, scaleV.setScalar(h.scale));
      this.hung.setMatrix(i, m);
      this.silkAt[offset] = h.x;
      this.silkAt[offset + 1] = H;
      this.silkAt[offset + 2] = h.z;
      this.silkAt[offset + 3] = x;
      this.silkAt[offset + 4] = y + 0.03 * h.scale;
      this.silkAt[offset + 5] = z;
    }
    this.hung.commit();
    this.silk.geometry.getAttribute('position').needsUpdate = true;
  }

  /** The big one, on the lens. */
  private theBigOne(s: number): void {
    const shown = s >= BIG_WAY[0][0] && s < COVER_AT + COVER_TIME + 0.4;
    this.big.visible = shown;
    this.bigLight.intensity = shown ? BIG_KEY : 0;
    this.bigRim.intensity = shown ? BIG_RIM : 0;
    if (!shown) return;
    let i = 0;
    while (i < BIG_WAY.length - 2 && s >= BIG_WAY[i + 1][0]) i++;
    const a = BIG_WAY[i];
    const b = BIG_WAY[i + 1];
    const k = smootherstep(range(a[0], b[0], s));
    const walking = Math.min(s, BIG_STOP) - BIG_FROM;
    this.big.position.set(lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k));
    this.big.rotation.set(lerp(a[4], b[4], k) * DEG, 0, lerp(a[5], b[5], k) * DEG);
    stride(this.bigLegs, Math.max(0, walking) * BIG_GAIT, BIG_SWING, BIG_LIFT);
    // it has stopped: the front legs come up, the second pair half way
    const threat = smootherstep(range(BIG_STOP, BIG_STOP + 0.9, s));
    const shiver = 0.012 * wobble(s * 2.6, 9) * threat;
    this.bigLegs[0].rotation.z += threat * 0.5 + shiver;
    this.bigLegs[4].rotation.z -= threat * 0.5 + shiver;
    this.bigLegs[1].rotation.z += threat * 0.22;
    this.bigLegs[5].rotation.z -= threat * 0.22;
    this.bigLegs[0].rotation.y += threat * 0.34;
    this.bigLegs[4].rotation.y -= threat * 0.34;
  }
}
