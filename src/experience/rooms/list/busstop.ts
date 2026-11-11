import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SpotSpec } from '../../../config/nightmare.config';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { DreamLight } from '../../dream/LightPool';
import { wobble } from '../../math';
import { GlideTrack } from '../../timeline/Track';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['bus_shelter', 'bench_urban', 'bus_city', 'street_lamp_post', 'dog_sit_a', 'dog_sit_b', 'dog_sit_c'],
  materials: ['asphalt', 'setts_wet', 'conc_pour_lifts'],
  sounds: [
    'rooms/sodium_lamp_buzz.mp3',
    'rooms/dog_growl_close.mp3',
    'rooms/road_fog.mp3',
    'rooms/night_wind_far.mp3',
    'rooms/bus_approach.mp3',
    'rooms/air_brakes.mp3',
    'rooms/air_brakes_2.mp3',
    'rooms/bus_idle.mp3',
    'rooms/bus_door_open.mp3',
    'rooms/dog_growl_nearer.mp3',
  ],
};

type V3 = readonly [number, number, number];

const TAU = Math.PI * 2;

/**
 * The beats (s into the room). The narrator speaks at 8.5 while the door stands open: nothing loud starts
 * between 7 and 10.
 */
const HEADLIGHTS_FROM = 1.8;
const BUS_STOPS = 6;
const DOOR_OPENS = 6.5;
const DOOR_TAKES = 1.15;
const DOOR_CLOSES = 10.9;
const DOOR_SHUTS = 0.6;
/** It pulls away along the road to the right: when, how hard (m/s/s: its rear has passed the last dog's place by GROWL_BEHIND), and how far it is drawn (m). */
const LEAVE_FROM = 11.1;
const LEAVE_PULL = 6.2;
const LEAVE_FAR = 40;
/** How much of the headlights' glow in the fog comes back while it goes (share). */
const LEAVE_GLOW = 0.6;
/** The growl is behind you, close; the kerb across the road is empty. */
const GROWL_BEHIND = 13;
/** The growl coming nearer: where its one-shot is started (s into the file), and where in the file its whole chest is (s). */
const NEARER_FROM = 2.5;
const NEARER_CHEST = 5.5;
/** Where in its file the far engine arrives (s). */
const APPROACH_ARRIVES = 7;
/** Where the door is, left to right in the sound (-1..1). */
const DOOR_PAN = 0.12;
const SHUTTER_AT = 14.2;
/** If the viewer is looking elsewhere then, the picture waits for them until this second. */
const SHUTTER_LATEST = 15.2;
const CUT = 15.9;

/** The eye: last in the line and a little to its left (m); where it is along +Z at each moment; its height; lens width (deg). */
const EYE_X = -1.3;
const EYE_Y = 1.62;
const EYE_Z = [8.55, 8.42, 8.26, 8.2, 8.16];
const EYE_FOV = 42;
const EYE_PITCH = 3.2;
/** Half the tall size of the frame per meter of distance, for the width of what is thinner than a pixel. */
const PIXEL_FACTOR = 2 * Math.tan((EYE_FOV / 2) * (Math.PI / 180));

/** The street (m): the road lies below the pavement, the kerb between them. */
const ROAD_Y = -0.14;
const ROAD_W = 4.8;
const KERB_W = 0.22;
const GROUND_W = 130;
const GROUND_D = 46;
const SETT_TILE = 1.2;
const SETT_COLOR = 0x6e6a66;
const SETT_ROUGH = 0.34;
const ROAD_TILE = 3;
const ROAD_COLOR = 0x55534f;
const ROAD_ROUGH = 0.42;

/** The lamp: where its light is (m), sodium, how strong (candela-like) and how far it carries. */
const LAMP: V3 = [-1.9, 3.3, 3.5];
const SODIUM = 0xff9b3e;
const LAMP_POINT = 2.6;
const LAMP_REACH = 24;
const KEY_POWER = 15;
const KEY_ANGLE = 66;
const KEY_TARGET_Z = 2.2;

/** The queue: one line from the kerb back to you (m), how many, how far apart, a little too tall. */
const RANK_X = 0;
const RANK_Z = 0.9;
const RANK_N = 7;
const RANK_STEP = 0.9;
const RANK_SCALE = 1.06;
const CLIP = 'm_idle_roll_head_01';
const CLIP_AT = 0.2;
const COAT_TINT = 0x3b4046;
const COAT_BLEACH = 0.1;
const SACK_TINT = 0xd3cab8;
/** The sacks hold a little light of their own, so that the backs of the heads read against the fog. */
const SACK_GLOW = 0.2;
/** The skirt of the coats (m above the feet, before scale). */
const COAT_TOP = 0.92;
const COAT_HEM = 0.46;

/** The shelter and the empty bench behind the queue (m). */
const SHELTER: V3 = [3.3, 0, 1.4];
const BENCH: V3 = [-3.6, 0, 2.8];
const BENCH_SEAT = 0.46;

/** Across the road and, later, behind you: seven dogs each (m). */
const DOG_KEYS = ['dog_sit_a', 'dog_sit_b', 'dog_sit_c', 'dog_sit_a', 'dog_sit_c', 'dog_sit_b', 'dog_sit_a'] as const;
const DOG_SCALE = [1.02, 0.96, 1.05, 0.94, 1.08, 1.0, 0.97];
const DOG_EYES: Record<(typeof DOG_KEYS)[number], readonly [V3, V3]> = {
  dog_sit_a: [[0.039, 0.648, 0.328], [-0.061, 0.642, 0.322]],
  dog_sit_b: [[0.062, 0.584, 0.332], [-0.053, 0.584, 0.338]],
  dog_sit_c: [[0.019, 0.59, 0.299], [-0.087, 0.588, 0.307]],
};
/** Bigger than they should be, across the road; less so when they are near. */
const FAR_DOG_SIZE = 1.3;
const NEAR_DOG_SIZE = 1.12;
const FAR_DOG_X = [-7.2, -5.95, -4.7, -3.45, -2.2, -0.95, 0.3];
const FAR_DOG_Z = -5.4;
const FAR_LOOKS_FROM_Z = 8.4;
const NEAR_DOG_X = [-5.5, -4.1, -2.7, -1.3, 0.1, 1.5, 2.9];
const NEAR_DOG_Z = 14.4;
const NEAR_LOOKS_FROM_Z = 8.2;
/** Behind you they do not come; they are only nearer each time (s, m further than NEAR_DOG_Z). They are there once the bus hides the kerb. */
const NEAR_STEPS: readonly (readonly [number, number])[] = [[BUS_STOPS + 1, 9], [9.5, 4.5], [11.5, 0], [GROWL_BEHIND, -0.75]];
const EYE_SIZE = 0.13;
const EYE_LIGHT: V3 = [1.7, 1.45, 0.62];

/** The white hair that falls under the lamp: strands, speed (m/s), how wide its cone is at the ground (m). */
const RAIN = 110;
const RAIN_LENGTH: readonly [number, number] = [0.5, 1];
const RAIN_SPEED: readonly [number, number] = [0.3, 0.46];
const RAIN_RADIUS = 3.2;
const RAIN_WIDTH = 0.0011;
/** What has already come down: strands, and how far from the foot of the lamp (m). */
const FALLEN = 560;
/** And on the empty bench. */
const ON_THE_BENCH = 260;
const FALLEN_RADIUS = 3.3;

/** The bus: bigger than a bus; where it stops (m); how the model is askew in its file (rad). */
const BUS_SCALE = 1.2;
const BUS_X = -4.656;
const BUS_Z = -1.95;
const BUS_SKEW = 0.0255;
const BUS_HILL = 7;
const BUS_DIM = 0.08;
/** Its way along a curve, as (s, share of the curve), and the curve in plan. */
const BUS_S = [HEADLIGHTS_FROM, 3, 3.8, 4.4, 5, 5.6, BUS_STOPS];
const BUS_U = [0, 0.2, 0.42, 0.72, 0.9, 0.985, 1];
const BUS_P0 = [-7, -36] as const;
const BUS_P1 = [-13, -12] as const;
const BUS_P2 = [-24, BUS_Z] as const;
const BUS_P3 = [BUS_X, BUS_Z] as const;
const HEADLIGHT = 0xdfe9d6;
const HEAD_SPOT = 95;
const HEAD_ANGLE = 22;
const BUS_LIGHT = 0xbde8cf;
const BUS_LIGHT_POWER = 2.6;

/** Inside the bus, in the model's meters: its cabin, the band of windows that is cut open, the seats. */
const CABIN_FLOOR = 0.74;
const CABIN_TOP = 2.5;
const CABIN_NEAR = -1.0;
const CABIN_FAR = 0.92;
const CABIN_REAR = -5.3;
const CABIN_FRONT = 5.25;
const BAND_Y: readonly [number, number] = [1.34, 2.14];
const BAND_REAR: readonly [number, number] = [-5.03, -2.33];
const BAND_FRONT: readonly [number, number] = [-1.0, 3.25];
const DOOR_Z: readonly [number, number] = [3.3, 4.46];
const DOOR_Y: readonly [number, number] = [0.62, 2.46];
const DOOR_SLIDE = 0.55;
const WINDOW_Z = [-4.68, -4.0, -3.32, -2.66, -0.58, 0.09, 0.83, 1.5, 2.21, 2.88];
const SIT_X = -0.42;
const SIT_AT_DOOR: readonly (readonly [number, number])[] = [[0.48, 3.56], [0.48, 4.16]];
const SEAT_TOP = 1.4;
/** How high the seated bodies stand, so that their heads clear the top of the windows. */
const SIT_Y = 0.62;
/** How many hairs each of them has. */
const SITTER_HAIRS = 120;
const SITTER_TINT = 0x2b302f;

/** On the glass: your own hair, how many strands. */
const LENS_HAIRS = 2;
const FOG_LAMP_FALLOFF = 11;

type Bank = readonly [x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, gain: number, drift: number, scale: number];
/** Lit fog: sheets behind what must read as a silhouette. */
const BANKS: readonly Bank[] = [
  [-70, -30, 70, -30, -0.2, 17, 0.2, 0.004, 3],
  [-52, -7.2, 52, -7.2, -0.2, 2.4, 0.6, 0.012, 6],
  [-52, -5.0, 52, -5.0, -0.1, 0.6, 0.07, -0.02, 8],
  [-42, 16, 42, 16, -0.1, 1.5, 0.34, 0.01, 6],
  [-70, 36, 70, 36, -0.2, 15, 0.16, -0.006, 3],
  [-38, -40, -38, 40, -0.2, 14, 0.2, 0.005, 3],
  [38, -40, 38, 40, -0.2, 14, 0.2, -0.005, 3],
];

const ramp = (a: number, b: number, x: number): number => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RAIN_VERT = /* glsl */ `
attribute vec2 aAlong;
attribute vec4 aRoot;
attribute vec4 aShape;
uniform float uTime;
uniform float uPixel;
uniform float uWidth;
uniform float uFall;
uniform float uRadius;
varying float vFade;

vec3 strandAt(float s) {
  float dropped = mod(aRoot.z * uFall + uTime * aShape.w, uFall);
  float open = clamp(dropped / uFall, 0.0, 1.0);
  float r = uRadius * aRoot.y * (0.12 + 0.88 * open);
  float y = uFall - dropped;
  vec3 base = vec3(cos(aRoot.x) * r, y, sin(aRoot.x) * r);
  base.x += 0.07 * sin(uTime * 0.37 + aShape.y + y * 0.9);
  base.z += 0.05 * cos(uTime * 0.29 + aShape.y * 1.7 + y * 1.1);
  float tilt = aShape.z + 0.3 * sin(uTime * 0.45 + aShape.y);
  float from = tilt - 0.5 * aShape.x;
  float now = tilt + aShape.x * (s - 0.5);
  float aside = (cos(from) - cos(now)) / aShape.x * aRoot.w;
  float down = (sin(now) - sin(from)) / aShape.x * aRoot.w;
  float turn = aShape.y + uTime * 0.12;
  return base + vec3(cos(turn) * aside, -down, sin(turn) * aside);
}

void main() {
  vec3 p = strandAt(aAlong.x);
  vec3 q = strandAt(aAlong.x + 0.04);
  vec4 a = modelViewMatrix * vec4(p, 1.0);
  vec4 b = modelViewMatrix * vec4(q, 1.0);
  vec2 along = b.xy - a.xy;
  vec2 side = vec2(-along.y, along.x) / max(length(along), 0.00001);
  float pixel = -a.z * uPixel;
  a.xy += side * aAlong.y * max(uWidth, pixel) * 0.5;
  gl_Position = projectionMatrix * a;
  float thin = clamp(uWidth / pixel, 0.2, 1.0);
  float rim = 1.0 - smoothstep(0.7, 1.0, aRoot.y);
  float ground = smoothstep(0.0, 0.3, p.y);
  float ends = smoothstep(0.0, 0.1, aAlong.x) * smoothstep(1.0, 0.75, aAlong.x);
  vFade = thin * rim * ground * ends;
}`;

const RAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vFade;
void main() {
  gl_FragColor = vec4(uColor, vFade);
}`;

const GLINT_VERT = /* glsl */ `
attribute vec4 aGlint;
attribute float aPhase;
uniform float uTime;
uniform float uPixel;
uniform float uHeadX;
uniform float uHead;
varying vec3 vLight;
void main() {
  vec4 at = modelViewMatrix * vec4(position, 1.0);
  float open = 1.0;
  if (aPhase >= 0.0) open = step(0.022, fract(uTime * 0.12 + aPhase));
  float pool = (position.x - uHeadX) / 6.0;
  float flare = 1.0 + 2.6 * uHead * exp(-pool * pool);
  float px = aGlint.a / max(-at.z * uPixel, 0.00001);
  vLight = aGlint.rgb * open * flare * min(1.0, px / 1.6);
  gl_PointSize = clamp(px, 1.6, 260.0);
  gl_Position = projectionMatrix * at;
}`;

const GLINT_FRAG = /* glsl */ `
varying vec3 vLight;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = exp(-d * d * 14.0);
  float halo = exp(-d * d * 3.2) * (1.0 - d);
  gl_FragColor = vec4(vLight * (core + halo * 0.3), 1.0);
}`;

const BANK_VERT = /* glsl */ `
attribute vec3 aBank;
varying vec2 vPlace;
varying vec3 vBank;
varying vec3 vAt;
void main() {
  vPlace = uv;
  vBank = aBank;
  vAt = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const BANK_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uLampX;
uniform float uHeadX;
uniform float uHead;
varying vec2 vPlace;
varying vec3 vBank;
varying vec3 vAt;
void main() {
  vec2 p = vec2(vPlace.x * vBank.z + uTime * vBank.y, vPlace.y * 0.62);
  float n = texture2D(uNoise, p).r;
  float m = texture2D(uNoise, p * vec2(0.37, 0.8) + vec2(0.31, 0.17)).r;
  float body = smoothstep(0.0, 0.3, vPlace.y) * smoothstep(1.0, 0.5, vPlace.y);
  float ends = smoothstep(0.0, 0.07, vPlace.x) * smoothstep(1.0, 0.93, vPlace.x);
  float lamp = (vAt.x - uLampX) / ${FOG_LAMP_FALLOFF.toFixed(1)};
  float head = (vAt.x - uHeadX) / 10.0;
  vec3 light = vec3(0.012, 0.024, 0.021) + vec3(0.085, 0.043, 0.014) * exp(-lamp * lamp) + vec3(0.04, 0.048, 0.042) * uHead * exp(-head * head);
  gl_FragColor = vec4(light * vBank.x * (0.3 + n * m * 1.6) * body * ends, 1.0);
}`;

/** Soft clouds that tile: everything that is fog. */
function fogNoise(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';
  const r = seeded(5);
  for (let i = 0; i < 90; i++) {
    const x = r() * size;
    const y = r() * size;
    const radius = 18 + r() * 52;
    const a = 0.05 + r() * 0.12;
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const c = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, radius);
        c.addColorStop(0, `rgba(255,255,255,${a})`);
        c.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = c;
        g.fillRect(x + dx - radius, y + dy - radius, radius * 2, radius * 2);
      }
    }
  }
  const t = new CanvasTexture(canvas);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** A round dark blot: what is under things the lamp's shadow does not reach. */
function softDisc(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const c = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  c.addColorStop(0, 'rgba(0,0,0,1)');
  c.addColorStop(0.45, 'rgba(0,0,0,0.7)');
  c.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = c;
  g.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

/** Damp, oil and cracks for the pavement in front of the queue. */
function grimeMap(): CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const r = seeded(29);
  for (let i = 0; i < 150; i++) {
    const x = r() * size;
    const y = r() * size;
    const radius = 14 + r() * r() * 150;
    const c = g.createRadialGradient(x, y, 0, x, y, radius);
    c.addColorStop(0, `rgba(4,6,5,${0.1 + r() * 0.34})`);
    c.addColorStop(1, 'rgba(4,6,5,0)');
    g.fillStyle = c;
    g.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  g.strokeStyle = 'rgba(2,3,3,0.5)';
  for (let i = 0; i < 26; i++) {
    let x = r() * size;
    let y = r() * size;
    let a = r() * TAU;
    g.lineWidth = 0.6 + r() * 1.8;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 14; k++) {
      a += (r() - 0.5) * 1.3;
      x += Math.cos(a) * 16;
      y += Math.sin(a) * 16;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** The far wall of the cabin: a tired, sick green, blind. */
function cabinWall(): CanvasTexture {
  const w = 1024;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const v = g.createLinearGradient(0, 0, 0, h);
  v.addColorStop(0, '#7ea894');
  v.addColorStop(0.35, '#3f6a5a');
  v.addColorStop(1, '#1a2b25');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
  const r = seeded(13);
  const step = w / 15;
  for (let i = 0; i < 15; i++) {
    g.fillStyle = 'rgba(8,14,12,0.55)';
    g.fillRect(i * step, 0, 2, h);
  }
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(6,10,8,${0.05 + r() * 0.15})`;
    g.fillRect(r() * w, h * (0.15 + r() * 0.8), 1 + r() * 3, 8 + r() * 60);
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A box whose UVs are in meters, as the surfaces want. */
function meterBox(w: number, h: number, d: number): BoxGeometry {
  const g = new BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  const sizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face++) {
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      uv.setXY(i, uv.getX(i) * sizes[face][0], uv.getY(i) * sizes[face][1]);
    }
  }
  return g;
}

/** The long skirt of a coat, for the legs of a body baked in a jacket. */
function coatSkirt(): BufferGeometry {
  const rings = 7;
  const around = 20;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= rings; j++) {
    const v = j / rings;
    const y = mix(COAT_TOP, COAT_HEM, v);
    const flare = Math.pow(v, 0.8);
    const rx = mix(0.178, 0.262, flare);
    const rz = mix(0.122, 0.196, flare);
    for (let i = 0; i < around; i++) {
      const a = (i / around) * TAU;
      const fold = 1 + v * (0.05 * Math.sin(a * 7 + 1.3) + 0.03 * Math.sin(a * 3 + 0.4));
      positions.push(Math.cos(a) * rx * fold, y, Math.sin(a) * rz * fold - 0.012);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < around; i++) {
      const a = j * around + i;
      const b = j * around + ((i + 1) % around);
      const c = a + around;
      const d = b + around;
      indices.push(a, b, c, b, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Bare trunks with a few limbs, for the wood at the edge of the fog. */
function deadTree(): BufferGeometry {
  const r = seeded(61);
  const trunk = new CylinderGeometry(0.05, 0.16, 18, 7, 1, true);
  trunk.translate(0, 9, 0);
  const parts: BufferGeometry[] = [trunk];
  for (let i = 0; i < 5; i++) {
    const limb = new CylinderGeometry(0.012, 0.05, 2.6 + r() * 2, 5, 1, true);
    limb.translate(0, 1.5, 0);
    limb.rotateZ(0.8 + r() * 0.6);
    limb.rotateY(r() * TAU);
    limb.translate(0, 5 + r() * 9, 0);
    parts.push(limb);
  }
  return mergeGeometries(parts)!;
}

/**
 * The bus stop. A rank of people with sacks for heads stands with its back to you, facing the road, under the
 * one lamp, where white hair is coming down. Between their coats, across the road, seven dogs sit in a row and
 * look at you. The bus that comes has the same person in every window; it stops in front of them, its door stands
 * open, and nobody gets on. Nobody turns. It leaves, and where the dogs sat there is nothing: the growl is behind
 * you now.
 */
export default class BusStop extends Room {
  readonly keys: readonly RoomKey[] = [
    { t: 0, at: [EYE_X, EYE_Y, EYE_Z[0]], yaw: 0, pitch: EYE_PITCH, fov: EYE_FOV },
    { t: 5 / 16, at: [EYE_X, EYE_Y, EYE_Z[1]], yaw: 0, pitch: EYE_PITCH, fov: EYE_FOV },
    { t: DOOR_CLOSES / 16, at: [EYE_X, EYE_Y, EYE_Z[2]], yaw: 0, pitch: EYE_PITCH - 0.2, fov: EYE_FOV - 0.6 },
    { t: SHUTTER_AT / 16, at: [EYE_X, EYE_Y, EYE_Z[3]], yaw: 0, pitch: EYE_PITCH - 0.2, fov: EYE_FOV - 1 },
    { t: 1, at: [EYE_X, EYE_Y, EYE_Z[4]], yaw: 0, pitch: EYE_PITCH - 0.2, fov: EYE_FOV - 1 },
  ];
  readonly air: RoomAir = {
    fog: { color: 0x0a120f, density: 0.06 },
    env: 'evening',
    envIntensity: 0.05,
    sky: 0,
    grade: { exposure: 1.12, saturation: 0.85, warmth: 0.03, tint: -0.015, flare: 0.003 },
  };
  film = { bloom: 1, bloomFrom: 0.6, bloomTint: [1, 0.72, 0.42] as const, grain: 0.42, scratches: 0.05, flicker: 0.02, weave: 0.0004, aberration: 0.12 };
  focus = 5.5;
  aperture = 2.4;
  drift = 0.5;
  fear = 0.5;
  control = { look: true, scroll: true, hurry: 1.6 };

  private readonly bus = new Group();
  private readonly busTrack = new GlideTrack(BUS_S, BUS_U);
  private readonly rainTime = { value: 0 };
  private readonly fogTime = { value: 0 };
  private readonly glintTime = { value: 0 };
  private readonly pixel = { value: 0.001 };
  private readonly headX = { value: 0 };
  private readonly head = { value: 0 };
  private readonly clocks: { value: number }[] = [];
  private readonly disc = softDisc();

  private lamp!: DreamLight;
  private key!: SpotSpec;
  private readonly headFrom: [number, number, number] = [0, 0, 0];
  private readonly headTo: [number, number, number] = [0, 0, 1];
  private headSpot!: SpotSpec;
  private readonly busGlow: DreamLight[] = [];
  private doorGlow!: DreamLight;
  private nearFill!: DreamLight;

  private readonly farRow = new Group();
  private readonly nearRow = new Group();
  private headPoints!: Points;
  private leafA!: Group;
  private leafB!: Group;
  private spill!: Mesh;

  private lensHair!: Mesh;
  private shot = false;

  private bedFog: RoomVoice | null = null;
  private bedWind: RoomVoice | null = null;
  private bedIdle: RoomVoice | null = null;
  private bedGrowl: RoomVoice | null = null;

  private readonly at = new Vector3();

  constructor(ctx: RoomContext) {
    super(ctx);
    this.buildGround();
    this.buildStop();
    this.buildQueue();
    this.buildPack();
    this.buildHairRain();
    this.buildAir();
    this.buildBus();
    this.buildLens();
    this.writeBeats();
    if (REDUCED_MOTION) this.drift = 0;
  }

  private flat(w: number, d: number, material: Material, x: number, y: number, z: number, meters = true): Mesh {
    const g = new PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    const uv = g.getAttribute('uv');
    if (meters) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
    const m = new Mesh(g, material);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    this.root.add(m);
    return m;
  }

  /** The soft dark blots under things: one draw, as (x, z, radius). */
  private blots(places: readonly (readonly [number, number, number])[], strength: number, parent: Object3D, y = 0.006): void {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    places.forEach(([x, z, r], i) => {
      positions.push(x - r, y, z + r, x + r, y, z + r, x + r, y, z - r, x - r, y, z - r);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      const a = i * 4;
      indices.push(a, a + 1, a + 2, a, a + 2, a + 3);
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    const m = new Mesh(g, new MeshBasicMaterial({ map: this.disc, transparent: true, opacity: strength, depthWrite: false }));
    m.frustumCulled = false;
    m.renderOrder = 1;
    parent.add(m);
  }

  private buildGround(): void {
    const kit = this.kit;
    const setts = kit.surface('setts_wet', SETT_TILE, { color: new Color(SETT_COLOR), roughness: SETT_ROUGH });
    const road = kit.surface('asphalt', ROAD_TILE, { color: new Color(ROAD_COLOR), roughness: ROAD_ROUGH });
    this.flat(GROUND_W, GROUND_D, setts, 0, 0, KERB_W + GROUND_D / 2);
    this.flat(GROUND_W, GROUND_D, setts, 0, 0, -ROAD_W - KERB_W - GROUND_D / 2);
    this.flat(GROUND_W, ROAD_W, road, 0, ROAD_Y, -ROAD_W / 2);

    // kerb stones that do not quite line up: the joints catch what light there is
    const r = seeded(7);
    const stones = 240;
    const scratch = new Object3D();
    const kerbParts: BufferGeometry[] = [];
    for (let i = 0; i < stones; i++) {
      const far = i >= stones / 2;
      const n = i % (stones / 2);
      scratch.position.set(n - stones / 4 + 0.5, -0.1 + (r() - 0.5) * 0.012, (far ? -ROAD_W - KERB_W / 2 : KERB_W / 2) + (r() - 0.5) * 0.012);
      scratch.rotation.y = (r() - 0.5) * 0.012;
      scratch.updateMatrix();
      kerbParts.push(meterBox(0.985, 0.2, KERB_W).applyMatrix4(scratch.matrix));
    }
    const kerb = new Mesh(mergeGeometries(kerbParts)!, kit.surface('conc_pour_lifts', 2, { color: new Color(0x65655d), roughness: 0.75 }));
    kerb.receiveShadow = true;
    this.root.add(kerb);

    // the line down the middle of the road, worn
    const dashParts: BufferGeometry[] = [];
    for (let i = 0; i < 22; i++) {
      const d = new PlaneGeometry(3, 0.13);
      d.rotateX(-Math.PI / 2);
      d.translate((i - 11) * 6 + 1.2, ROAD_Y + 0.004, -ROAD_W / 2);
      dashParts.push(d);
    }
    const line = new Mesh(mergeGeometries(dashParts)!, new MeshStandardMaterial({ color: 0x6f6c60, roughness: 0.7 }));
    line.receiveShadow = true;
    this.root.add(line);

    const grime = this.flat(12, 8, new MeshBasicMaterial({ map: grimeMap(), transparent: true, depthWrite: false }), EYE_X, 0.004, KERB_W + 3.9, false);
    grime.renderOrder = 1;

    // the wood across the road and the one behind you: only outlines, against the lit fog
    const tree = deadTree();
    const treeParts: BufferGeometry[] = [];
    const t = seeded(47);
    for (let i = 0; i < 54; i++) {
      const behind = i >= 34;
      let x = (t() - 0.5) * 96;
      const z = behind ? 22 + t() * 13 : -13 - t() * 14;
      // the road the bus comes down runs through the wood
      if (!behind && x > -15 && x < -7) x = -16 - t() * 14;
      scratch.position.set(x, 0, z);
      scratch.rotation.set((t() - 0.5) * 0.06, t() * TAU, (t() - 0.5) * 0.06);
      scratch.scale.setScalar(0.85 + t() * 0.7);
      scratch.updateMatrix();
      treeParts.push(tree.clone().applyMatrix4(scratch.matrix));
    }
    this.root.add(new Mesh(mergeGeometries(treeParts)!, new MeshStandardMaterial({ color: 0x0b0f0e, roughness: 1 })));
  }

  /** Lamp, shelter, bench. */
  private buildStop(): void {
    const kit = this.kit;
    const post = kit.prop('street_lamp_post', [LAMP[0], 0, LAMP[2]], { castShadow: false }, this.root);
    post.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh && /glass/.test((mesh.material as Material).name)) mesh.material = new MeshBasicMaterial({ color: new Color(1, 0.6, 0.24).multiplyScalar(2.2) });
    });
    kit.prop('bus_shelter', SHELTER, { rotation: [0, 180, 0], castShadow: true }, this.root);
    kit.prop('bench_urban', BENCH, { rotation: [0, 180, 0], castShadow: true }, this.root);
    this.blots([[BENCH[0], BENCH[2], 1.35], [LAMP[0], LAMP[2], 0.42]], 0.55, this.root);
  }

  /** Coats from one body, sacks from another: the sack's head sits better on a coat than the coat's own. */
  private buildQueue(): void {
    const figures = this.kit.figures;
    const bodies = figures.crowd({ avatar: 'figure_man', clip: CLIP, time: CLIP_AT, face: 'blank', white: false, tint: COAT_TINT, bleach: COAT_BLEACH }, RANK_N);
    const sacks = this.build.sack(RANK_N, { clip: CLIP, time: CLIP_AT, tint: SACK_TINT });
    const name = (o: Object3D) => ((o as Mesh).material as Material).name;
    for (const part of [...bodies.root.children]) {
      if (/head|opacity/.test(name(part))) bodies.root.remove(part);
      else part.castShadow = true;
    }
    for (const part of [...sacks.root.children]) {
      if (!/head/.test(name(part))) sacks.root.remove(part);
      else part.castShadow = true;
    }
    const heads = sacks.root.children[0] as InstancedMesh;
    const sack = (heads.material as MeshStandardMaterial).clone();
    sack.emissive.set(0xffffff);
    sack.emissiveMap = sack.map;
    sack.emissiveIntensity = SACK_GLOW;
    heads.material = sack;

    const skirtMaterial = new MeshStandardMaterial({ color: 0x15171a, roughness: 0.92 });
    const skirt = coatSkirt();
    const hairOnCoat = this.coatHair();
    const skirtParts: BufferGeometry[] = [];
    const hairParts: BufferGeometry[] = [];
    const places: [number, number, number][] = [];
    const rot = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
    const scale = new Vector3().setScalar(RANK_SCALE);
    for (let i = 0; i < RANK_N; i++) {
      const z = RANK_Z + i * RANK_STEP;
      bodies.set(i, RANK_X, 0, z, Math.PI, RANK_SCALE);
      sacks.set(i, RANK_X, 0, z, Math.PI, RANK_SCALE);
      const base = new Matrix4().compose(new Vector3(RANK_X, 0, z), rot, scale);
      skirtParts.push(skirt.clone().applyMatrix4(base));
      hairParts.push(hairOnCoat.clone().applyMatrix4(base));
      places.push([RANK_X, z, 0.62]);
    }
    bodies.commit();
    sacks.commit();
    const skirts = new Mesh(mergeGeometries(skirtParts)!, skirtMaterial);
    skirts.castShadow = true;
    skirts.receiveShadow = true;
    const hairOnCoats = new Mesh(mergeGeometries(hairParts)!, new MeshStandardMaterial({ color: 0xb8ad9c, roughness: 0.55 }));
    this.root.add(bodies.root, sacks.root, skirts, hairOnCoats);
    this.blots(places, 0.72, this.root);
  }

  /** Hair that came down on them and stayed: over the shoulders and down the back, in the body's own frame. */
  private coatHair(): BufferGeometry {
    const r = seeded(23);
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const segments = 7;
    for (let i = 0; i < 14; i++) {
      let x = (r() - 0.5) * 0.46;
      const topY = 1.36 + r() * 0.1 - Math.abs(x) * 0.25;
      const length = 0.2 + r() * 0.42;
      const z = -0.16 - r() * 0.03;
      const lean = (r() - 0.5) * 0.3;
      const base = positions.length / 3;
      for (let k = 0; k <= segments; k++) {
        const along = k / segments;
        const w = 0.0028 * (1 - along * 0.7);
        const y = topY - along * length;
        positions.push(x - w, y, z - 0.004, x + w, y, z - 0.004);
        normals.push(0, 0, -1, 0, 0, -1);
        if (k < segments) {
          const a = base + k * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
        x += (lean + (r() - 0.5) * 0.5) * (length / segments);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    g.setIndex(indices);
    return g;
  }

  /** Seven sit across the road until the bus hides them. Seven more wait in the fog behind you, and are nearer each time. */
  private buildPack(): void {
    this.root.add(this.farRow);
    this.farRow.add(this.dogRow(FAR_DOG_X, FAR_DOG_Z, FAR_LOOKS_FROM_Z, FAR_DOG_SIZE, this.farRow, this.glintMaterial(1)));
    this.root.add(this.nearRow);
    this.nearRow.visible = false;
    this.nearRow.add(this.dogRow(NEAR_DOG_X, NEAR_DOG_Z, NEAR_LOOKS_FROM_Z, NEAR_DOG_SIZE, this.nearRow, this.glintMaterial(0)));
  }

  private glintMaterial(flare: number): ShaderMaterial {
    return new ShaderMaterial({
      vertexShader: GLINT_VERT,
      fragmentShader: GLINT_FRAG,
      uniforms: { uTime: this.glintTime, uPixel: this.pixel, uHeadX: this.headX, uHead: flare > 0 ? this.head : { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
  }

  private dogRow(xs: readonly number[], z: number, lookFromZ: number, size: number, parent: Object3D, material: ShaderMaterial): Points {
    const crowds = new Map<string, ReturnType<typeof this.kit.props>>();
    for (const key of new Set(DOG_KEYS)) crowds.set(key, this.kit.props(key, DOG_KEYS.filter((k) => k === key).length));
    const used = new Map<string, number>();
    const positions = new Float32Array(xs.length * 6);
    const glints = new Float32Array(xs.length * 8);
    const phases = new Float32Array(xs.length * 2);
    const places: [number, number, number][] = [];
    xs.forEach((x, i) => {
      const key = DOG_KEYS[i];
      const crowd = crowds.get(key)!;
      const n = used.get(key) ?? 0;
      used.set(key, n + 1);
      const heading = Math.atan2(EYE_X - x, lookFromZ - z);
      const scale = DOG_SCALE[i] * size;
      crowd.set(n, x, 0, z, heading, scale);
      places.push([x, z, 0.62]);
      const c = Math.cos(heading);
      const s = Math.sin(heading);
      const phase = (i * 0.37 + 0.11) % 1;
      DOG_EYES[key].forEach(([ex, ey, ez], side) => {
        const k = (i * 2 + side) * 3;
        positions[k] = x + (ex * c + (ez + 0.03) * s) * scale;
        positions[k + 1] = ey * scale;
        positions[k + 2] = z + (-ex * s + (ez + 0.03) * c) * scale;
        const g = (i * 2 + side) * 4;
        glints[g] = EYE_LIGHT[0];
        glints[g + 1] = EYE_LIGHT[1];
        glints[g + 2] = EYE_LIGHT[2];
        glints[g + 3] = EYE_SIZE;
        phases[i * 2 + side] = phase;
      });
    });
    for (const crowd of crowds.values()) {
      crowd.commit();
      parent.add(crowd.root);
    }
    this.blots(places, 0.75, parent);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aGlint', new BufferAttribute(glints, 4));
    geometry.setAttribute('aPhase', new BufferAttribute(phases, 1));
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 4;
    return points;
  }

  /** The rain: a shader moves every strand, so the falling is a pure function of the room's time. */
  private buildHairRain(): void {
    const segments = 12;
    const along: number[] = [];
    const positions: number[] = [];
    const indices: number[] = [];
    for (let k = 0; k <= segments; k++) {
      along.push(k / segments, -1, k / segments, 1);
      positions.push(0, 0, 0, 0, 0, 0);
      if (k < segments) {
        const a = k * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aAlong', new Float32BufferAttribute(along, 2));
    geometry.setIndex(indices);
    const r = seeded(83);
    const roots = new Float32Array(RAIN * 4);
    const shapes = new Float32Array(RAIN * 4);
    for (let i = 0; i < RAIN; i++) {
      roots[i * 4] = r() * TAU;
      roots[i * 4 + 1] = Math.sqrt(r());
      roots[i * 4 + 2] = r();
      roots[i * 4 + 3] = mix(RAIN_LENGTH[0], RAIN_LENGTH[1], r());
      shapes[i * 4] = (r() < 0.5 ? -1 : 1) * (0.45 + r() * 1.05);
      shapes[i * 4 + 1] = r() * TAU;
      shapes[i * 4 + 2] = (r() - 0.5) * 1.1;
      shapes[i * 4 + 3] = mix(RAIN_SPEED[0], RAIN_SPEED[1], r());
    }
    geometry.setAttribute('aRoot', new InstancedBufferAttribute(roots, 4));
    geometry.setAttribute('aShape', new InstancedBufferAttribute(shapes, 4));
    geometry.instanceCount = RAIN;
    const material = new ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      uniforms: {
        uTime: this.rainTime,
        uPixel: this.pixel,
        uWidth: { value: RAIN_WIDTH },
        uFall: { value: LAMP[1] },
        uRadius: { value: RAIN_RADIUS },
        uColor: { value: new Color(1.3, 1.16, 0.95) },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    const rain = new Mesh(geometry, material);
    rain.position.set(LAMP[0], 0, LAMP[2]);
    rain.frustumCulled = false;
    rain.renderOrder = 3;
    this.root.add(rain);

    // and what has already come down, on the pavement and on the bench
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    const lying = 12;
    const l = seeded(19);
    const laid = (x0: number, y: number, z0: number, x1?: readonly [number, number], z1?: readonly [number, number]) => {
      let x = x0;
      let z = z0;
      let heading = l() * TAU;
      let bend = (l() - 0.5) * 5;
      const step = (0.22 + l() * 0.5) / lying;
      const base = pos.length / 3;
      for (let k = 0; k <= lying; k++) {
        const w = 0.0019 * (1 - (k / lying) * 0.7);
        const nx = -Math.sin(heading) * w;
        const nz = Math.cos(heading) * w;
        pos.push(x + nx, y, z + nz, x - nx, y, z - nz);
        nor.push(0, 1, 0, 0, 1, 0);
        if (k < lying) {
          const p = base + k * 2;
          idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3);
        }
        bend += (l() - 0.5) * 2.5;
        heading += bend * step;
        x += Math.cos(heading) * step;
        z += Math.sin(heading) * step;
        if (x1) x = Math.min(x1[1], Math.max(x1[0], x));
        if (z1) z = Math.min(z1[1], Math.max(z1[0], z));
      }
    };
    for (let i = 0; i < FALLEN; i++) {
      const a = l() * TAU;
      const far = Math.pow(l(), 0.62) * FALLEN_RADIUS;
      const x = LAMP[0] + Math.cos(a) * far;
      const z = LAMP[2] + Math.sin(a) * far;
      if (z > KERB_W + 0.05) laid(x, 0.006 + l() * 0.012, z);
    }
    const seatX: readonly [number, number] = [BENCH[0] - 0.95, BENCH[0] + 0.95];
    const seatZ: readonly [number, number] = [BENCH[2] - 0.34, BENCH[2] + 0.06];
    for (let i = 0; i < ON_THE_BENCH; i++) laid(mix(seatX[0], seatX[1], l()), BENCH_SEAT + 0.006 + l() * 0.008, mix(seatZ[0], seatZ[1], l()), seatX, seatZ);
    const fallen = new BufferGeometry();
    fallen.setAttribute('position', new Float32BufferAttribute(pos, 3));
    fallen.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    fallen.setIndex(idx);
    const carpet = new Mesh(fallen, new MeshStandardMaterial({ color: 0xded8cd, roughness: 0.5 }));
    carpet.frustumCulled = false;
    carpet.receiveShadow = true;
    carpet.renderOrder = 2;
    this.root.add(carpet);
  }

  private buildAir(): void {
    const b = this.build;
    this.lamp = this.light(LAMP, SODIUM, LAMP_POINT, LAMP_REACH);
    this.key = this.spot([LAMP[0], LAMP[1] - 0.04, LAMP[2]], [LAMP[0] + 0.9, 0, KEY_TARGET_Z], SODIUM, KEY_POWER, KEY_ANGLE, 0.8);
    this.headSpot = { ...this.spot([0, 0, 0], [0, 0, 1], HEADLIGHT, 0, HEAD_ANGLE, 0.55), position: this.headFrom, target: this.headTo };
    this.spots = [this.key, this.headSpot, null];
    b.glow(LAMP[0], LAMP[1], LAMP[2], 5, SODIUM, 0.17, this.root);
    b.glow(LAMP[0], LAMP[1], LAMP[2], 1.3, 0xffd9a2, 0.8, this.root);
    this.clocks.push(b.motes(150, { x: [-6.5, 5], y: [0.15, 3.5], z: [-3, 8] }, this.root, { size: 0.008, color: 0xffd9ab, strength: 0.5 }).time);

    const positions: number[] = [];
    const uvs: number[] = [];
    const banks: number[] = [];
    const indices: number[] = [];
    BANKS.forEach(([x0, z0, x1, z1, y0, y1, gain, drift, scale], i) => {
      positions.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      for (let k = 0; k < 4; k++) banks.push(gain, drift, scale);
      const a = i * 4;
      indices.push(a, a + 1, a + 2, a, a + 2, a + 3);
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('aBank', new Float32BufferAttribute(banks, 3));
    geometry.setIndex(indices);
    const sheets = new Mesh(
      geometry,
      new ShaderMaterial({
        vertexShader: BANK_VERT,
        fragmentShader: BANK_FRAG,
        uniforms: { uNoise: { value: fogNoise() }, uTime: this.fogTime, uLampX: { value: LAMP[0] }, uHeadX: this.headX, uHead: this.head },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    );
    sheets.frustumCulled = false;
    sheets.renderOrder = 2;
    this.root.add(sheets);

    this.nearFill = this.light([EYE_X, 2.3, 11.4], SODIUM, 0, 7);
  }

  private glow(color: number, map?: CanvasTexture): MeshBasicMaterial {
    return new MeshBasicMaterial({ color, map: map ?? null });
  }

  private buildBus(): void {
    const kit = this.kit;
    const b = this.build;
    const shell = new Group();
    shell.scale.setScalar(BUS_SCALE);
    this.bus.add(shell);
    this.root.add(this.bus);
    this.bus.visible = false;

    // the model is a closed box with black quads for windows: open its door and the band of windows on the kerb side
    const model = kit.prop('bus_city', [0, 0, 0], {}, shell);
    model.updateWorldMatrix(true, true);
    const toModel = new Matrix4().copy(model.matrixWorld).invert();
    const toPivot = new Matrix4();
    const pa = new Vector3();
    const pb = new Vector3();
    const pc = new Vector3();
    const cutBand = `(vBusAt.x < -0.6 && vBusAt.y > ${BAND_Y[0].toFixed(3)} && vBusAt.y < ${BAND_Y[1].toFixed(3)} && ((vBusAt.z > ${BAND_REAR[0].toFixed(3)} && vBusAt.z < ${BAND_REAR[1].toFixed(3)}) || (vBusAt.z > ${BAND_FRONT[0].toFixed(3)} && vBusAt.z < ${BAND_FRONT[1].toFixed(3)})))`;
    model.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const source = mesh.material as MeshStandardMaterial;
      const paint = source.clone();
      paint.color.multiplyScalar(BUS_DIM);
      paint.transparent = false;
      paint.opacity = 1;
      toPivot.copy(toModel).multiply(mesh.matrixWorld);
      const name = source.name;
      if (/^mat(21|5|12|13|15)$/.test(name)) {
        const e = toPivot.elements;
        const s = e[0].toFixed(5);
        const t = `vec3(${e[12].toFixed(5)}, ${e[13].toFixed(5)}, ${e[14].toFixed(5)})`;
        paint.onBeforeCompile = (shader) => {
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vBusAt;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>\nvBusAt = position * ${s} + ${t};`);
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vBusAt;')
            .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\nif ${cutBand} discard;`);
        };
        paint.customProgramCacheKey = () => `busstop-cut-${s}`;
      }
      mesh.material = paint;
      const g = mesh.geometry;
      const p = g.getAttribute('position');
      const index = g.getIndex();
      if (!index) return;
      const keep: number[] = [];
      for (let i = 0; i < index.count; i += 3) {
        const ia = index.getX(i);
        const ib = index.getX(i + 1);
        const ic = index.getX(i + 2);
        pa.fromBufferAttribute(p, ia).applyMatrix4(toPivot);
        pb.fromBufferAttribute(p, ib).applyMatrix4(toPivot);
        pc.fromBufferAttribute(p, ic).applyMatrix4(toPivot);
        const cx = (pa.x + pb.x + pc.x) / 3;
        const cy = (pa.y + pb.y + pc.y) / 3;
        const cz = (pa.z + pb.z + pc.z) / 3;
        const door = cx < -0.85 && cz > DOOR_Z[0] && cz < DOOR_Z[1] && cy > DOOR_Y[0] && cy < DOOR_Y[1];
        const glass = name === 'mat17' && cx < -0.9 && cy > 1.25 && cy < BAND_Y[1] + 0.02 && (cz < BAND_REAR[1] || (cz > BAND_FRONT[0] && cz < BAND_FRONT[1]));
        const clutter = name === 'mat23' && Math.abs(cx) < 0.85 && cy > 0.7;
        const area = pb.sub(pa).cross(pc.sub(pa)).length() / 2;
        const backing = name === 'mat23' && cx < -0.8 && cy > BAND_Y[0] && cy < BAND_Y[1] && area > 0.03 && (cz < BAND_REAR[1] || (cz > BAND_FRONT[0] && cz < BAND_FRONT[1]));
        if (!door && !glass && !clutter && !backing) keep.push(ia, ib, ic);
      }
      if (keep.length < index.count) {
        const copy = g.clone();
        copy.setIndex(keep);
        mesh.geometry = copy;
      }
    });
    model.rotation.y = BUS_SKEW;

    // the cabin: one lit box seen from inside, with no wall on the kerb side
    const cabin = new BoxGeometry(CABIN_FAR - CABIN_NEAR, CABIN_TOP - CABIN_FLOOR, CABIN_FRONT - CABIN_REAR);
    const noWall = new MeshBasicMaterial({ visible: false });
    const inside = new Mesh(cabin, [this.glow(0xa4a4a4, cabinWall()), noWall, this.glow(0x41604f), this.glow(0x18241f), this.glow(0x2f4a3f), this.glow(0x2f4a3f)]);
    inside.position.set((CABIN_FAR + CABIN_NEAR) / 2, (CABIN_TOP + CABIN_FLOOR) / 2, (CABIN_FRONT + CABIN_REAR) / 2);
    // its faces turned round, so that it is seen only from within
    const faces = cabin.getIndex()!;
    for (let i = 0; i < faces.count; i += 3) {
      const b = faces.getX(i + 1);
      faces.setX(i + 1, faces.getX(i + 2));
      faces.setX(i + 2, b);
    }
    shell.add(inside);
    const tube = new Mesh(new BoxGeometry(0.05, 0.035, 10), this.glow(0xffffff));
    tube.position.set(CABIN_FAR - 0.08, 2.43, 0);
    (tube.material as MeshBasicMaterial).color.setRGB(2.2, 2.5, 2.2);
    shell.add(tube);

    const poleParts: BufferGeometry[] = [];
    [-3.72, -0.27, 1.16, 2.54, 3.42].forEach((z, i) => poleParts.push(new CylinderGeometry(0.018, 0.018, CABIN_TOP - CABIN_FLOOR, 8).translate(i === 4 ? -0.82 : 0.26, (CABIN_TOP + CABIN_FLOOR) / 2, z)));
    shell.add(new Mesh(mergeGeometries(poleParts)!, this.glow(0xa89244)));

    // every seat turned so that its passenger has their back to the kerb, and to you
    const sitters = WINDOW_Z.length + SIT_AT_DOOR.length;
    const seatGeometry = new RoundedBoxGeometry(0.09, 0.62, 0.46, 3, 0.035);
    const seatParts: BufferGeometry[] = [];
    const people = kit.figures.crowd({ avatar: 'figure_woman', clip: 'm_sit_chair_idle_roll_head', time: 0.3, face: 'blank', white: true, tint: SITTER_TINT, bleach: 0.05 }, sitters);
    const headPart = people.root.children.find((o) => /head/.test(((o as Mesh).material as Material).name)) as Mesh;
    headPart.geometry.computeBoundingBox();
    const hairShape = this.sitterHair(headPart.geometry.boundingBox!.min, headPart.geometry.boundingBox!.max);
    const hairParts: BufferGeometry[] = [];
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const one = new Vector3(1, 1, 1);
    const m = new Matrix4();
    const placeSitter = (i: number, x: number, z: number) => {
      people.set(i, x, SIT_Y, z, Math.PI / 2, 1);
      hairParts.push(hairShape.clone().applyMatrix4(m.compose(pa.set(x, SIT_Y, z), q, one)));
      seatParts.push(seatGeometry.clone().translate(x - 0.22, SEAT_TOP - 0.31, z));
    };
    WINDOW_Z.forEach((z, i) => placeSitter(i, SIT_X, z));
    SIT_AT_DOOR.forEach(([x, z], i) => placeSitter(WINDOW_Z.length + i, x, z));
    // and no one at the wheel
    seatParts.push(seatGeometry.clone().translate(0.3, SEAT_TOP - 0.31, 4.74));
    people.commit();
    const seats = new Mesh(mergeGeometries(seatParts)!, new MeshStandardMaterial({ color: 0x1b2422, roughness: 0.7 }));
    const hairMaterial = this.glow(0xc4c0b4);
    const hair = new Mesh(mergeGeometries(hairParts)!, hairMaterial);
    hair.frustumCulled = false;
    shell.add(people.root, seats, hair);
    const wheel = new Mesh(new TorusGeometry(0.2, 0.016, 6, 22), new MeshStandardMaterial({ color: 0x0b0c0c, roughness: 0.6 }));
    wheel.position.set(0.72, 1.38, 4.74);
    wheel.rotation.set(0, Math.PI / 2, 0);
    wheel.rotateX(0.4);
    shell.add(wheel);

    // the door: a frame where the model's was, two leaves that slide away, and what the light does to the ground
    const jambMaterial = new MeshStandardMaterial({ color: 0x07090a, roughness: 0.6 });
    const jamb = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const j = new Mesh(new BoxGeometry(w, h, d), jambMaterial);
      j.position.set(x, y, z);
      shell.add(j);
    };
    const doorMid = (DOOR_Y[0] + DOOR_Y[1]) / 2;
    jamb(0.12, DOOR_Y[1] - DOOR_Y[0], 0.05, -1.1, doorMid, DOOR_Z[0]);
    jamb(0.12, DOOR_Y[1] - DOOR_Y[0], 0.05, -1.1, doorMid, DOOR_Z[1]);
    jamb(0.12, 0.05, DOOR_Z[1] - DOOR_Z[0] + 0.05, -1.1, DOOR_Y[1], (DOOR_Z[0] + DOOR_Z[1]) / 2);
    jamb(0.14, 0.04, DOOR_Z[1] - DOOR_Z[0], -1.08, DOOR_Y[0], (DOOR_Z[0] + DOOR_Z[1]) / 2);
    const leaf = (z: number): Group => {
      const g = new Group();
      const frame = new Mesh(new BoxGeometry(0.03, 1.72, 0.56), jambMaterial);
      const pane = new Mesh(new PlaneGeometry(0.42, 1.14), this.glow(0x1c2b27));
      pane.rotation.y = -Math.PI / 2;
      pane.position.set(-0.018, 0.14, 0);
      g.add(frame, pane);
      g.position.set(-1.14, doorMid, z);
      shell.add(g);
      return g;
    };
    const mid = (DOOR_Z[0] + DOOR_Z[1]) / 2;
    this.leafA = leaf(mid - 0.29);
    this.leafB = leaf(mid + 0.29);
    this.spill = this.flat(4, 3.6, new MeshBasicMaterial({ map: this.spillMap(), transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, color: BUS_LIGHT }), BUS_X + mid * BUS_SCALE, 0.012, KERB_W + 1.7, false);
    this.spill.renderOrder = 2;

    // a board on its side, where the name of the line goes
    const board = b.label(
      1.3,
      0.25,
      (c, w, h) => {
        c.fillStyle = '#050403';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#ffa636';
        c.font = `700 ${h * 0.72}px monospace`;
        c.textBaseline = 'middle';
        c.textAlign = 'center';
        c.fillText('18:30  EVE', w / 2, h * 0.54);
        c.fillStyle = '#050403';
        for (let x = 0; x < w; x += 4) c.fillRect(x, 0, 1.2, h);
        for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 1.2);
      },
      { px: 260, emissive: 1.5 },
    );
    board.mesh.position.set(-1.13, 2.34, 2.7);
    board.mesh.rotation.y = -Math.PI / 2;
    shell.add(board.mesh);

    // the dark on the road under it
    this.blots([[0, 0, 9]], 0.85, this.bus, 0.01);

    this.busGlow.push(this.light([0, -50, 0], BUS_LIGHT, 0, 8), this.light([0, -50, 0], BUS_LIGHT, 0, 8));
    this.doorGlow = this.light([0, -50, 0], BUS_LIGHT, 0, 7);

    const positions = new Float32Array(6);
    const glints = new Float32Array(8);
    const phases = new Float32Array([-1, -1]);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('aGlint', new BufferAttribute(glints, 4).setUsage(DynamicDrawUsage));
    geometry.setAttribute('aPhase', new BufferAttribute(phases, 1));
    this.headPoints = new Points(geometry, this.glintMaterial(0));
    this.headPoints.frustumCulled = false;
    this.headPoints.renderOrder = 4;
    this.root.add(this.headPoints);
  }

  private spillMap(): CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d')!;
    const c = g.createRadialGradient(size / 2, size * 0.16, 0, size / 2, size * 0.16, size * 0.46);
    c.addColorStop(0, '#ffffff');
    c.addColorStop(0.5, '#4a4a4a');
    c.addColorStop(1, '#000000');
    g.fillStyle = c;
    g.fillRect(0, 0, size, size);
    return new CanvasTexture(canvas);
  }

  /**
   * Long white hair, the same on all of them: from the crown down the back, widening to the shoulders, and over
   * the back of the seat, in the body's own frame, seen from behind.
   */
  private sitterHair(lo: Vector3, hi: Vector3): BufferGeometry {
    const r = seeded(41);
    const cx = (lo.x + hi.x) / 2;
    const cz = (lo.z + hi.z) / 2;
    const rx = (hi.x - lo.x) * 0.46;
    const rz = (hi.z - lo.z) * 0.46;
    const top = hi.y;
    const seatY = SEAT_TOP - SIT_Y;
    // in the air behind the shoulders and the seat, so that nothing of the body covers it
    const clear = -0.29;
    const positions: number[] = [];
    const indices: number[] = [];
    const segments = 9;
    for (let i = 0; i < SITTER_HAIRS; i++) {
      const around = (r() - 0.5) * 2.5;
      const down = Math.pow(r(), 0.65) * 1.25;
      const rootX = cx + Math.sin(around) * Math.sin(down) * rx;
      const rootY = top - (1 - Math.cos(down)) * rx * 1.05;
      const rootZ = cz - Math.cos(around) * Math.sin(down) * rz;
      const tipY = seatY + 0.16 - r() * 0.42;
      const width = 0.0032 + r() * 0.0028;
      const wave = r() * TAU;
      const base = positions.length / 3;
      for (let k = 0; k <= segments; k++) {
        const s = k / segments;
        const y = mix(rootY, tipY, s);
        const z = mix(rootZ, clear, ramp(0, 0.35, s));
        const x = cx + (rootX - cx) * (1 + ramp(0.08, 0.5, s) * 0.5) + Math.sin(s * 5 + wave) * 0.028;
        const w = width * (1 - s * 0.7);
        positions.push(x - w, y, z, x + w, y, z);
        if (k < segments) {
          const a = base + k * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    return g;
  }

  /** A few strands of your own, white, coming down into the eye at the end: soft, so near the lens. */
  private buildLens(): void {
    const r = seeded(77);
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const segments = 14;
    for (let i = 0; i < LENS_HAIRS; i++) {
      const x0 = -0.15 + r() * 0.09;
      const length = 0.05 + r() * 0.05;
      const swing = 0.01 + r() * 0.02;
      const phase = r() * TAU;
      const z = -0.27 - r() * 0.04;
      const base = positions.length / 3;
      for (let k = 0; k <= segments; k++) {
        const s = k / segments;
        const y = 0.155 - s * length;
        const x = x0 + Math.sin(s * 3.4 + phase) * swing * s;
        const w = 0.0008 * (1 - s * 0.5);
        positions.push(x - w, y, z, x + w, y, z);
        uvs.push(0, s, 1, s);
        if (k < segments) {
          const a = base + k * 2;
          indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 4;
    const c = canvas.getContext('2d')!;
    const across = c.createLinearGradient(0, 0, 64, 0);
    across.addColorStop(0, 'rgba(255,255,255,0)');
    across.addColorStop(0.5, 'rgba(255,255,255,1)');
    across.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = across;
    c.fillRect(0, 0, 64, 4);
    this.lensHair = new Mesh(g, new MeshBasicMaterial({ map: new CanvasTexture(canvas), color: new Color(1.1, 1.04, 0.92), transparent: true, opacity: 0.42, depthWrite: false }));
    this.lensHair.visible = false;
    this.lensHair.frustumCulled = false;
    this.lensHair.renderOrder = 9;
    this.lens.add(this.lensHair);
  }

  private writeBeats(): void {
    const sound = this.sound;
    this.beat(0, () => {
      sound.bed('rooms/sodium_lamp_buzz.mp3', { gain: 0.16, pan: -0.08, fade: 0.4 });
      this.bedGrowl = sound.bed('rooms/dog_growl_close.mp3', { gain: 0.22, lowpass: 1500, fade: 0.4 });
      this.bedFog = sound.bed('rooms/road_fog.mp3', { gain: 0.25, lowpass: 1500, fade: 1.2 });
      this.bedWind = sound.bed('rooms/night_wind_far.mp3', { gain: 0.09, lowpass: 1200, fade: 1.5 });
    });
    // the engine in the file arrives seven seconds after it begins: started a second in, it arrives as the bus stops
    this.beat(0, () => sound.play('rooms/bus_approach.mp3', { gain: 0.4, pan: -0.55, offset: APPROACH_ARRIVES - BUS_STOPS }).pan(0.05, BUS_STOPS));
    this.beat(BUS_STOPS, () => {
      sound.play('rooms/air_brakes.mp3', { gain: 0.5, pan: 0.05 });
      this.bedIdle = sound.bed('rooms/bus_idle.mp3', { gain: 0.2, pan: 0.05, fade: 0.8 });
    });
    this.beat(DOOR_OPENS, () => sound.play('rooms/bus_door_open.mp3', { gain: 0.5, pan: DOOR_PAN }));
    // the same growl coming nearer, still dull where it starts, under the narrator; its whole chest is behind you at GROWL_BEHIND
    this.beat(GROWL_BEHIND - (NEARER_CHEST - NEARER_FROM), () => sound.play('rooms/dog_growl_nearer.mp3', { gain: 0.6, offset: NEARER_FROM }));
    // the door shuts with the breath it opened with, a little slower
    this.beat(DOOR_CLOSES, () => sound.play('rooms/bus_door_open.mp3', { gain: 0.42, pan: DOOR_PAN, rate: 0.9 }));
    // it pulls away, and everything but the buzz and the growl goes with it
    this.beat(LEAVE_FROM, () => {
      sound.play('rooms/air_brakes_2.mp3', { gain: 0.45, pan: 0.2 });
      this.bedIdle?.rate(1.45, 1.6);
      this.bedIdle?.pan(0.9, 1.9);
      this.bedIdle?.gain(0, 1.9);
      this.bedFog?.gain(0, 1.6);
      this.bedWind?.gain(0, 1.6);
    });
    this.beat(GROWL_BEHIND, () => {
      this.bedGrowl?.gain(0, 1.2);
      sound.bed('rooms/dog_growl_close.mp3', { gain: 0.3, fade: 0.25 });
    });
    this.beat(CUT, () => sound.stopAll(0.02));
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const o = this.origin;

    const hum = 1 + 0.04 * wobble(frame.time * 0.9, 5);
    this.lamp.intensity = LAMP_POINT * hum;
    this.key.intensity = KEY_POWER * hum;
    this.rainTime.value = s;
    this.fogTime.value = s;
    this.glintTime.value = s;
    this.pixel.value = PIXEL_FACTOR / Math.max(240, window.innerHeight);
    for (const c of this.clocks) c.value = frame.time;

    // the bus comes down the curve, its lights ahead of it, and stops; then it pulls away along the road, the way the curve ends
    const leaving = Math.max(0, s - LEAVE_FROM);
    const away = 0.5 * LEAVE_PULL * leaving * leaving;
    this.bus.visible = s >= HEADLIGHTS_FROM - 0.2 && away < LEAVE_FAR;
    const here = this.bus.visible ? 1 : 0;
    const u = this.busTrack.at(Math.min(BUS_STOPS, Math.max(HEADLIGHTS_FROM, s)));
    const v = 1 - u;
    const ca = v * v * v;
    const cb = 3 * v * v * u;
    const cc = 3 * v * u * u;
    const cd = u * u * u;
    const busX = ca * BUS_P0[0] + cb * BUS_P1[0] + cc * BUS_P2[0] + cd * BUS_P3[0] + away;
    const busZ = ca * BUS_P0[1] + cb * BUS_P1[1] + cc * BUS_P2[1] + cd * BUS_P3[1];
    const dx = 3 * v * v * (BUS_P1[0] - BUS_P0[0]) + 6 * v * u * (BUS_P2[0] - BUS_P1[0]) + 3 * u * u * (BUS_P3[0] - BUS_P2[0]);
    const dz = 3 * v * v * (BUS_P1[1] - BUS_P0[1]) + 6 * v * u * (BUS_P2[1] - BUS_P1[1]) + 3 * u * u * (BUS_P3[1] - BUS_P2[1]);
    const heading = Math.atan2(dx, dz);
    const busY = ROAD_Y + BUS_HILL * v * v;
    this.bus.position.set(busX, busY, busZ);
    this.bus.rotation.y = heading;
    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);

    const near = ramp(HEADLIGHTS_FROM + 2, BUS_STOPS - 0.8, s) * here;
    this.placeBusLight(this.busGlow[0], -1.9, 1.15, -2.2, busX, busY, busZ, sinH, cosH, BUS_LIGHT_POWER * near);
    this.placeBusLight(this.busGlow[1], -1.9, 1.15, 2.4, busX, busY, busZ, sinH, cosH, BUS_LIGHT_POWER * near);

    // the door: it opens in front of the first of them, stands open, and shuts on nobody
    const open = ramp(DOOR_OPENS, DOOR_OPENS + DOOR_TAKES, s) * (1 - ramp(DOOR_CLOSES, DOOR_CLOSES + DOOR_SHUTS, s));
    const mid = (DOOR_Z[0] + DOOR_Z[1]) / 2;
    const out = Math.min(1, open * 5) * 0.07;
    this.leafA.position.set(-1.14 - out, this.leafA.position.y, mid - 0.29 - open * DOOR_SLIDE);
    this.leafB.position.set(-1.14 - out, this.leafB.position.y, mid + 0.29 + open * DOOR_SLIDE);
    this.placeBusLight(this.doorGlow, -1.5, 1.7, mid, busX, busY, busZ, sinH, cosH, 3.2 * open);
    (this.spill.material as MeshBasicMaterial).opacity = 0.16 * open;

    // two lights in the fog: the air swells with them, the dogs' eyes answer
    const fx = busX + sinH * 5.45 * BUS_SCALE;
    const fy = busY + 0.85 * BUS_SCALE;
    const fz = busZ + cosH * 5.45 * BUS_SCALE;
    const eyeZ = EYE_Z[1];
    const toEyeX = EYE_X - fx;
    const toEyeZ = eyeZ - fz;
    const distance = Math.hypot(toEyeX, toEyeZ) + 0.001;
    const facing = Math.max(0, (sinH * toEyeX + cosH * toEyeZ) / distance);
    const swell = ramp(HEADLIGHTS_FROM, HEADLIGHTS_FROM + 1.8, s) * here;
    const thick = Math.exp(-Math.pow(distance * 0.034, 2));
    const sprite = swell * facing * facing * thick * 2.4;
    const positions = this.headPoints.geometry.getAttribute('position') as BufferAttribute;
    const glints = this.headPoints.geometry.getAttribute('aGlint') as BufferAttribute;
    positions.setXYZ(0, fx + cosH * 1.02, fy, fz - sinH * 1.02);
    positions.setXYZ(1, fx - cosH * 1.02, fy, fz + sinH * 1.02);
    glints.setXYZW(0, sprite, sprite * 1.02, sprite * 0.86, 1.7);
    glints.setXYZW(1, sprite, sprite * 1.02, sprite * 0.86, 1.7);
    positions.needsUpdate = true;
    glints.needsUpdate = true;

    this.headSpot.intensity = HEAD_SPOT * swell * (1 - ramp(BUS_STOPS, BUS_STOPS + 0.7, s) * 0.3);
    this.headFrom[0] = fx + o.x;
    this.headFrom[1] = fy + o.y;
    this.headFrom[2] = fz + o.z;
    this.headTo[0] = fx + sinH * 12 + o.x;
    this.headTo[1] = o.y;
    this.headTo[2] = fz + cosH * 12 + o.z;
    this.headX.value = busX + 8;
    this.head.value = swell * Math.max(1 - ramp(BUS_STOPS - 1.4, BUS_STOPS - 0.4, s), LEAVE_GLOW * ramp(LEAVE_FROM, LEAVE_FROM + 0.8, s));

    // across the road they sit until the bus is in front of them; when it has gone, there is nothing there
    this.farRow.visible = s < BUS_STOPS;

    if (!this.shot && s >= SHUTTER_AT && (Math.abs(frame.input.gazeYaw) < 0.6 || s >= SHUTTER_LATEST)) {
      this.shot = true;
      this.shutter();
    }

    // behind you
    this.nearRow.visible = s >= NEAR_STEPS[0][0];
    let z = NEAR_STEPS[0][1];
    for (let i = 1; i < NEAR_STEPS.length; i++) if (s >= NEAR_STEPS[i][0]) z = NEAR_STEPS[i][1];
    this.nearRow.position.z = z;
    this.nearFill.intensity = this.nearRow.visible ? 2.2 : 0;

    const lensDown = ramp(GROWL_BEHIND + 0.15, GROWL_BEHIND + 1.2, s);
    this.lensHair.visible = lensDown > 0;
    this.lensHair.position.y = 0.06 - 0.13 * lensDown;

    this.drift = REDUCED_MOTION ? 0 : 0.5 * (1 - ramp(DOOR_CLOSES, LEAVE_FROM + 0.8, s));
    this.fear = s < HEADLIGHTS_FROM + 1.5 ? 0.5 : s < GROWL_BEHIND ? 0.62 : 0.9;
    this.black = s >= CUT ? 1 : 0;
  }

  private placeBusLight(l: DreamLight, x: number, y: number, z: number, busX: number, busY: number, busZ: number, sinH: number, cosH: number, intensity: number): void {
    const lx = x * BUS_SCALE;
    const lz = z * BUS_SCALE;
    this.at.set(busX + lx * cosH + lz * sinH, busY + y * BUS_SCALE, busZ - lx * sinH + lz * cosH).add(this.origin);
    l.position.copy(this.at);
    l.intensity = intensity;
  }
}
