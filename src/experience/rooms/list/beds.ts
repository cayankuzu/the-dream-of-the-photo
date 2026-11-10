import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { REDUCED_MOTION } from '../../../config/experience.config';
import { DEG, lerp, range, smootherstep } from '../../math';
import type { RoomAir, RoomAssets, RoomContext, RoomFilm, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['bed_iron'],
  materials: ['grass_meadow', 'linen_white'],
  sounds: [
    'rooms/wind_grass.mp3',
    'rooms/night_wind_far.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/bedspring_1.mp3',
    'rooms/sheet_rise.mp3',
    'rooms/sheets_thousand.mp3',
    'rooms/sheet_sit_up.mp3',
  ],
};

/** The eye: chest height (m), and where it starts and stops in z (m). It stops in the cross-aisle, where every bed's foot points. */
const EYE = 1.3;
const START_Z = 0;
const STOP_Z = -6;
/** The beds: meters between columns and between rows, and from the cross-aisle to the first row. */
const COLUMN_GAP = 3;
const ROW_GAP = 3.2;
const FIRST_ROW = 2.3;
/** The field: its radius around the cross-aisle (m), and how it climbs like the inside of a dish (height = rise * (r - from)^2). */
const FIELD_RADIUS = 165;
const BOWL_FROM = 16;
const BOWL_RISE = 0.00058;
/** Distance from the eye's path (m) where a bed changes: the real one, then real rails and a coarse sheet, then drawn rails, then a card. */
const NEAR_BEDS = 6.4;
const MID_BEDS = 13;
const FAR_BEDS = 34;
/** The one bed that stands alone in the aisle (m beyond the stop), and the second to rise (column, row). */
const LONE_DISTANCE = 32;
const SECOND_BED = [0, 3] as const;
/** The bed that was not there before the flash: in the aisle, right in front of you (z, m). */
const GHOST_Z = -8.4;
/** Seconds: the first rises slowly and alone, then the second, then the wind stops, then all of them together; shutter; cut. */
const FIRST_AT = 6;
const FIRST_RISE = 4;
const FIRST_WEIGHT = 0.94;
const SECOND_AT = 9;
const SECOND_RISE = 2.3;
const SECOND_WEIGHT = 0.97;
const HUSH_AT = 10.3;
const HUSH_LENGTH = 1.1;
const ALL_AT = 11.5;
const ALL_RISE = 0.95;
const ALL_RISE_CALM = 1.9;
/** How much taller than a person they go on getting during the hold (fraction of the sitting shape). */
const HOLD_GROWTH = 0.1;
const FLASH_AT = 12.46;
const SHUTTER_AT = 12.5;
const CUT_AT = 14;
/** The flash on the field: seconds of its fall, power (cd) at the eye, reach (m). */
const FLASH_FALL = 0.2;
const FLASH_POWER = 30;
const FLASH_REACH = 42;
/** The inside of the sky (m): nearer than the walk's black dome at 180 m, which would otherwise draw over it, and beyond the field. */
const SKY_RADIUS = 172;
/** The moon: elevation and angular radius (deg), brightness of its face (linear). */
const MOON_ELEVATION = 9.5;
const MOON_RADIUS = 5.6;
const MOON_GAIN = 1.85;
/** Moonlight on the beds near you: where the lamp is, whose shadow it is, what it aims at, its power (cd), half angle (deg). Shadows reach only 40 m. */
const MOONLIGHT_AT = [-6, 7.5, -38] as const;
const MOONLIGHT_AIM = [0, 0, -2] as const;
const MOONLIGHT_POWER = 5200;
const MOONLIGHT_ANGLE = 34;
/** Air, in linear light: night overhead, night at the horizon, the cool band along it, the warm band under the moon, the halo wide and tight. */
const ZENITH = [0.0035, 0.0105, 0.0135] as const;
const HORIZON = [0.02, 0.046, 0.052] as const;
const BAND_COOL = [0.02, 0.042, 0.046] as const;
const BAND_WARM = [0.4, 0.3, 0.17] as const;
const HALO_WIDE = [0.06, 0.05, 0.032] as const;
const HALO_TIGHT = [0.34, 0.26, 0.15] as const;
/** Far beds fade into the air over this distance (m). */
const FADE_DISTANCE = 58;
/** The mist: heights of its slices over the ground (m), thickness of one (m), density (per m of path). */
const MIST_LAYERS = [0.07, 0.18, 0.3, 0.42, 0.55] as const;
const MIST_SLICE = 0.13;
const MIST_DENSITY = 0.19;
/** What the moon adds to the mist near you, in linear light. */
const MIST_LIGHT = [0.035, 0.055, 0.06] as const;
/** Grass: how many blades, how far along the aisles (m, from z = GRASS_NEAR), their height (m) and half width (m). */
const GRASS_BLADES = 38000;
const GRASS_NEAR = 3;
const GRASS_LENGTH = 34;
const GRASS_HEIGHT = [0.16, 0.44] as const;
const GRASS_HALF_WIDTH = [0.004, 0.009] as const;
/** The white of the sheets and of the rails (linear albedo). */
const SHEET_ALBEDO = [0.86, 0.86, 0.82] as const;
const IRON_ALBEDO = [0.46, 0.46, 0.43] as const;
/** Someone sitting up under a sheet (m): the height the sheet lies at, and the crown of the head. */
const SHEET_TOP = 0.62;
const SIT_TOP = 1.48;
/** The sitter, over u = height from the sheet to the crown, 0..1: how much the model's shape is drawn in (a head, a neck, shoulders), and where its middle was and is now (m toward the feet from the head). */
const SIT_RADIUS: Curve = [[0, 1], [0.12, 1], [0.209, 0.66], [0.326, 0.58], [0.442, 0.53], [0.558, 0.64], [0.651, 0.69], [0.692, 0.47], [0.733, 0.33], [0.79, 0.4], [0.855, 0.54], [0.907, 0.61], [0.957, 0.53], [1, 0.9]];
const SIT_WAS: Curve = [[0, 0.215], [0.33, 0.215], [0.48, 0.145], [0.67, 0.07], [0.855, 0.025], [1, 0]];
const SIT_NOW: Curve = [[0, 0.215], [0.33, 0.2], [0.48, 0.12], [0.67, 0.06], [0.855, 0.1], [1, 0.1]];
const SIT_DEPTH: Curve = [[0, 1], [0.4, 1], [0.55, 0.72], [0.7, 0.72], [0.78, 1], [1, 1]];
/** How deep the sheet's folds fall from the shoulders (m). */
const SIT_FOLD = 0.02;
/** The skull the sheet closes over (m): half its width, half its height from the crown (at SIT_TOP) to the chin, half its depth from the face to the back. */
const SKULL = [0.084, 0.118, 0.098] as const;
/** How far round from the crown the sheet lies on the skull before it falls to the neck (rad), and the share of the head over which the sitting shape gives way to it. */
const SKULL_ARC = 2.45;
const SKULL_EASE = 0.3;
/** Where the skull begins, as the sitter's u. */
const SKULL_FROM = 1 - (SKULL[1] * (1 - Math.cos(SKULL_ARC))) / (SIT_TOP - SHEET_TOP);
/** The face pressing up through the sheet: how far the nose stands out (m), how far round from the crown it is (rad), its spread across and down (rad). */
const NOSE = [0.015, 1.75, 0.3, 0.36] as const;
/** What the flash finds on every face and nothing else does: height of its middle (m), width and height of the scratches (m), seconds it can be seen. */
const FACE_Y = 1.36;
const FACE_SIZE = [0.24, 0.28] as const;
const FACE_SHOWN = 0.45;

type Curve = readonly (readonly [number, number])[];

const curve = (pairs: Curve, u: number): number => {
  for (let i = 1; i < pairs.length; i++) {
    if (u <= pairs[i][0]) return lerp(pairs[i - 1][1], pairs[i][1], range(pairs[i - 1][0], pairs[i][0], u));
  }
  return pairs[pairs.length - 1][1];
};

/** The wind's own clock: it stops during the hush, and everything it moves stops where it happens to be. */
const windClock = (s: number): number => {
  if (s <= HUSH_AT) return s;
  const u = Math.min(s - HUSH_AT, HUSH_LENGTH);
  return HUSH_AT + u * (1 - (0.5 * u) / HUSH_LENGTH);
};

const groundAt = (x: number, z: number): number => {
  const over = Math.max(0, Math.hypot(x, z - STOP_Z) - BOWL_FROM);
  return BOWL_RISE * over * over;
};

const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const LATTICE = new Float32Array(65536);
for (let i = 0; i < LATTICE.length; i++) LATTICE[i] = hash(i * 0.731);

/** Tiling value noise; `mask` is the period minus one (a power of two). */
function lattice(x: number, y: number, mask: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const x0 = xi & mask;
  const x1 = (xi + 1) & mask;
  const y0 = (yi & mask) * 256;
  const y1 = ((yi + 1) & mask) * 256;
  const a = LATTICE[(x0 + y0 + seed) & 65535];
  const b = LATTICE[(x1 + y0 + seed) & 65535];
  const c = LATTICE[(x0 + y1 + seed) & 65535];
  const d = LATTICE[(x1 + y1 + seed) & 65535];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, octaves: number, period: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let px = x;
  let py = y;
  let p = period;
  for (let i = 0; i < octaves; i++) {
    sum += amp * lattice(px, py, p - 1, seed + i * 911);
    norm += amp;
    amp *= 0.5;
    px *= 2;
    py *= 2;
    p *= 2;
  }
  return sum / norm;
}

const glsl = (c: readonly [number, number, number]): string => `vec3(${c[0].toFixed(4)}, ${c[1].toFixed(4)}, ${c[2].toFixed(4)})`;

/** One air for the sky, the mist and the far beds, so that they dissolve into each other with no seam. */
const AIR_GLSL = /* glsl */ `
uniform vec3 uMoonDir;
uniform float uHorizonY;
vec3 airAt(vec3 d) {
  float c = max(dot(d, uMoonDir), 0.0);
  float flatC = max(dot(normalize(d.xz + 1e-5), normalize(uMoonDir.xz)), 0.0);
  float above = max(d.y - uHorizonY, 0.0);
  vec3 col = mix(${glsl(HORIZON)}, ${glsl(ZENITH)}, 1.0 - exp(-above * 4.5));
  float band = exp(-above * 16.0);
  col += ${glsl(BAND_COOL)} * band * (0.4 + 0.6 * flatC);
  col += ${glsl(BAND_WARM)} * band * pow(flatC, 46.0);
  col += ${glsl(HALO_WIDE)} * pow(c, 26.0);
  col += ${glsl(HALO_TIGHT)} * pow(c, 140.0);
  return col;
}
`;

const RAY_VERT = /* glsl */ `
varying vec3 vRay;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vRay = w.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const SKY_FRAG = /* glsl */ `
${AIR_GLSL}
uniform sampler2D uNoise;
uniform sampler2D uMoonMap;
uniform float uT;
uniform float uMoonR;
uniform float uMoonGain;
varying vec3 vRay;
void main() {
  vec3 d = normalize(vRay);
  vec3 col = airAt(d);
  float y = max(d.y, 0.015);
  vec2 sp = d.xz / (y + 0.14);
  sp.y *= 2.2;
  float n1 = texture2D(uNoise, sp * 0.05 + vec2(uT * 0.0016, 0.0)).r;
  float n2 = texture2D(uNoise, sp * 0.14 + vec2(-uT * 0.0028, uT * 0.001)).g;
  float body = smoothstep(0.52, 0.78, n1 * 0.68 + n2 * 0.32);
  float cosM = dot(d, uMoonDir);
  float bar = 0.0;
  float disc = 0.0;
  if (cosM > 0.5) {
    vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
    vec3 u = cross(uMoonDir, r);
    vec2 p = vec2(dot(d, r), dot(d, u)) / (uMoonR * cosM);
    float R = length(p);
    float sink = smoothstep(uHorizonY + 0.004, uHorizonY + 0.06, d.y);
    vec3 moon = texture2D(uMoonMap, p * 0.5 + 0.5).rgb * uMoonGain;
    moon *= mix(vec3(0.42, 0.26, 0.14), vec3(1.0), sink);
    disc = 1.0 - smoothstep(0.982, 1.0, R);
    col = mix(col, moon, disc * mix(0.2, 1.0, sink));
    float barY = (p.y + 0.3 + (n2 - 0.5) * 0.55) / 0.085;
    bar = exp(-barY * barY) * (1.0 - smoothstep(0.9, 3.4, abs(p.x)));
  }
  float cover = max(body * 0.85 * (1.0 - 0.7 * disc), bar * 0.8) * smoothstep(uHorizonY, uHorizonY + 0.05, d.y);
  vec3 cloud = mix(vec3(0.008, 0.016, 0.02), vec3(0.16, 0.12, 0.075), pow(max(cosM, 0.0), 60.0));
  col = mix(col, cloud, cover);
  gl_FragColor = vec4(col, 1.0);
}
`;

const MIST_VERT = /* glsl */ `
varying vec3 vRay;
varying vec2 vXZ;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vRay = w.xyz - cameraPosition;
  vXZ = position.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const MIST_FRAG = /* glsl */ `
${AIR_GLSL}
uniform sampler2D uNoise;
uniform float uT;
uniform float uLayer;
uniform float uSlice;
uniform float uDensity;
varying vec3 vRay;
varying vec2 vXZ;
void main() {
  float d = length(vRay);
  vec3 r = vRay / d;
  float path = uSlice / max(abs(r.y), 0.03);
  float n = texture2D(uNoise, vXZ * 0.021 + vec2(uT * 0.006, uT * 0.002) + uLayer * 0.37).r;
  float m = texture2D(uNoise, vXZ * 0.083 + vec2(-uT * 0.011, uT * 0.007) + uLayer * 0.71).g;
  float low = mix(0.26, 0.5, uLayer);
  float thick = 0.1 + 0.9 * smoothstep(low - 0.12, low + 0.4, n * 0.62 + m * 0.38);
  float a = 1.0 - exp(-uDensity * thick * path);
  a *= smoothstep(2.5, 9.0, d);
  vec3 c = airAt(vec3(r.x, max(r.y, uHorizonY), r.z)) * mix(0.62, 1.0, smoothstep(2.0, 46.0, d));
  c += ${glsl(MIST_LIGHT)} * (1.0 - smoothstep(60.0, 170.0, d));
  gl_FragColor = vec4(c, a);
}
`;

const DRAWN_VERT = /* glsl */ `
attribute vec3 aSit;
attribute vec3 aSitN;
attribute float aPart;
uniform float uW;
varying vec3 vN;
varying vec3 vW;
varying float vPart;
void main() {
  vec3 p = position + aSit * uW;
  vec3 n = normalize(normal + aSitN * min(uW, 1.0));
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vN = mat3(modelMatrix) * mat3(instanceMatrix) * n;
  vW = w.xyz;
  vPart = aPart;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const DRAWN_FRAG = /* glsl */ `
${AIR_GLSL}
uniform vec3 uLitDir;
uniform float uFlash;
varying vec3 vN;
varying vec3 vW;
varying float vPart;
void main() {
  vec3 ray = vW - cameraPosition;
  float d = length(ray);
  ray /= d;
  vec3 n = normalize(vN);
  if (dot(n, ray) > 0.0) n = -n;
  vec3 albedo = mix(${glsl(SHEET_ALBEDO)}, ${glsl(IRON_ALBEDO)} * 0.7, vPart);
  float l = dot(n, uLitDir);
  vec3 c = albedo * (mix(vec3(0.018, 0.035, 0.04), vec3(0.05, 0.09, 0.1), n.y * 0.5 + 0.5) + vec3(0.4, 0.33, 0.22) * max(l * 0.8 + 0.2, 0.0));
  c += albedo * uFlash / (1.0 + d * d) * max(-dot(n, ray), 0.0);
  float fade = 1.0 - exp(-pow(d / ${FADE_DISTANCE.toFixed(1)}, 2.0));
  gl_FragColor = vec4(mix(c, airAt(vec3(ray.x, max(ray.y, uHorizonY), ray.z)), fade), 1.0);
}
`;

const CARD_VERT = /* glsl */ `
attribute vec3 aAt;
attribute vec2 aKind;
varying vec2 vQ;
varying vec3 vW;
varying float vHalf;
varying float vHeadAt;
varying float vRand;
void main() {
  vec4 base = modelMatrix * vec4(aAt, 1.0);
  vec3 toEye = cameraPosition - base.xyz;
  toEye.y = 0.0;
  vec3 f = normalize(toEye);
  vec3 right = vec3(f.z, 0.0, -f.x);
  float hw = mix(0.53, 1.06, abs(f.x));
  vec2 q = vec2(position.x * (hw + 0.03), position.y * 1.75);
  vec3 w = base.xyz + right * q.x + vec3(0.0, q.y, 0.0);
  vQ = q;
  vW = w;
  vHalf = hw;
  vHeadAt = 0.33 * aKind.x * f.x;
  vRand = aKind.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const CARD_FRAG = /* glsl */ `
${AIR_GLSL}
uniform vec3 uLitDir;
uniform float uW;
uniform float uFlash;
varying vec2 vQ;
varying vec3 vW;
varying float vHalf;
varying float vHeadAt;
varying float vRand;
void main() {
  float a = abs(vQ.x - vHeadAt);
  float body = mix(1.2, 0.72, smoothstep(0.14, 0.5, a));
  float head = a < 0.14 ? 1.33 + 0.15 * sqrt(1.0 - a * a / 0.0196) : 0.0;
  float top = mix(0.66, max(body, head), uW);
  if (vQ.y > top || abs(vQ.x) > vHalf) discard;
  vec3 ray = vW - cameraPosition;
  float d = length(ray);
  ray /= d;
  float edge = 1.0 - smoothstep(0.0, 0.16, top - vQ.y);
  float facing = dot(normalize(ray.xz), normalize(uLitDir.xz));
  float lit = mix(0.3 * edge + 0.06, 0.62, 1.0 - smoothstep(-0.7, 0.2, facing));
  vec3 c = ${glsl(SHEET_ALBEDO)} * (vec3(0.05, 0.09, 0.1) + vec3(0.38, 0.31, 0.2) * lit) * (0.8 + 0.4 * vRand);
  c += ${glsl(SHEET_ALBEDO)} * uFlash / (1.0 + d * d);
  float fade = 1.0 - exp(-pow(d / ${FADE_DISTANCE.toFixed(1)}, 2.0));
  gl_FragColor = vec4(mix(c, airAt(vec3(ray.x, max(ray.y, uHorizonY), ray.z)), fade), 1.0);
}
`;

interface Bed {
  x: number;
  y: number;
  z: number;
  /** +1: its head is away from the cross-aisle on the far side; -1: on the near side. Whoever sits up faces the cross-aisle. */
  flip: number;
  /** Meters from the eye's path. */
  away: number;
}

interface Cloth {
  position: Float32Array;
  normal: Float32Array;
  sit: Float32Array;
  sitNormal: Float32Array;
  index: number[];
}

const normalsOf = (positions: Float32Array, index: number[]): Float32Array => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g.getAttribute('normal').array as Float32Array;
};

/** The real sheet and its sitting shape sampled down to a grid of nx by nz: what the farther beds wear, so that they rise alike. */
function clothGrid(source: Mesh, nx: number, nz: number): Cloth {
  source.updateWorldMatrix(true, false);
  const m = source.matrixWorld;
  const scale = m.getMaxScaleOnAxis();
  const from = source.geometry.getAttribute('position');
  const moved = source.geometry.morphAttributes.position![0];
  const n = from.count;
  const rest = new Float32Array(n * 3);
  const move = new Float32Array(n * 3);
  const v = new Vector3();
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(from, i).applyMatrix4(m);
    rest[i * 3] = v.x;
    rest[i * 3 + 1] = v.y;
    rest[i * 3 + 2] = v.z;
    move[i * 3] = moved.getX(i) * scale;
    move[i * 3 + 1] = moved.getY(i) * scale;
    move[i * 3 + 2] = moved.getZ(i) * scale;
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minZ = Math.min(minZ, v.z);
    maxZ = Math.max(maxZ, v.z);
  }
  const position = new Float32Array(nx * nz * 3);
  const sit = new Float32Array(nx * nz * 3);
  const radius = 0.75 * Math.min((maxX - minX) / (nx - 1), (maxZ - minZ) / (nz - 1));
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const X = lerp(minX, maxX, ix / (nx - 1));
      const Z = lerp(minZ, maxZ, iz / (nz - 1));
      const out = (iz * nx + ix) * 3;
      let sum = 0;
      let best = Infinity;
      let bestI = 0;
      const acc = [0, 0, 0, 0, 0, 0];
      for (let k = 0; k < n; k++) {
        const dist = Math.hypot(rest[k * 3] - X, rest[k * 3 + 2] - Z);
        if (dist < best) {
          best = dist;
          bestI = k;
        }
        if (dist >= radius) continue;
        const w = (1 - dist / radius) ** 2;
        sum += w;
        for (let c = 0; c < 3; c++) {
          acc[c] += rest[k * 3 + c] * w;
          acc[c + 3] += move[k * 3 + c] * w;
        }
      }
      for (let c = 0; c < 3; c++) {
        position[out + c] = sum > 0 ? acc[c] / sum : rest[bestI * 3 + c];
        sit[out + c] = sum > 0 ? acc[c + 3] / sum : move[bestI * 3 + c];
      }
    }
  }
  const index: number[] = [];
  for (let iz = 0; iz < nz - 1; iz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = iz * nx + ix;
      const b = a + 1;
      const d = a + nx;
      const c = d + 1;
      index.push(a, d, c, a, c, b);
    }
  }
  const normal = normalsOf(position, index);
  const sat = position.slice();
  for (let i = 0; i < sat.length; i++) sat[i] += sit[i];
  const satNormal = normalsOf(sat, index);
  const sitNormal = satNormal.slice();
  for (let i = 0; i < sitNormal.length; i++) sitNormal[i] -= normal[i];
  return { position, normal, sit, sitNormal, index };
}

function clothGeometry(c: Cloth): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(c.position, 3));
  g.setAttribute('normal', new BufferAttribute(c.normal, 3));
  g.setIndex(c.index);
  g.morphAttributes.position = [new BufferAttribute(c.sit, 3)];
  g.morphAttributes.normal = [new BufferAttribute(c.sitNormal, 3)];
  g.morphTargetsRelative = true;
  return g;
}

/** A polar sheet of ground around the cross-aisle, following the dish; finer near the middle. Its UVs are in meters. */
function groundDisc(rings: number, segments: number): BufferGeometry {
  const verts = (rings + 1) * (segments + 1);
  const p = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const index: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const r = FIELD_RADIUS * (i / rings) ** 1.7;
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const x = r * Math.cos(a);
      const z = STOP_Z + r * Math.sin(a);
      const k = i * (segments + 1) + j;
      p[k * 3] = x;
      p[k * 3 + 1] = groundAt(x, z);
      p[k * 3 + 2] = z;
      uv[k * 2] = x;
      uv[k * 2 + 1] = z;
      if (i < rings && j < segments) {
        const b = k + segments + 1;
        index.push(k, b + 1, b, k, k + 1, b + 1);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(p, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/**
 * A meadow under a low moon, and iron hospital beds in straight rows to the horizon. One sheet rises, far off
 * under the moon; then one nearer; then the wind stops; then all of them, together, sit up and face you. The
 * field is a shallow dish so that the rows can be seen climbing away. Four levels of bed carry it to the horizon:
 * the real one near you, then coarser ones that share its shape, then cards drawn in the shader, all dissolving
 * into one air shared with the mist and the sky.
 */
export default class Beds extends Room {
  readonly keys: readonly RoomKey[] = [
    { t: 0, at: [0, EYE, START_Z], yaw: 0, pitch: -2.6, fov: 47 },
    { t: 0.4, at: [0, EYE - 0.01, lerp(START_Z, STOP_Z, 0.52)], yaw: 0, pitch: -2.2, fov: 46.5 },
    { t: 0.74, at: [0, EYE, STOP_Z], yaw: 0, pitch: -1.6, fov: 45 },
    { t: 1, at: [0, EYE, STOP_Z], yaw: 0, pitch: -1.6, fov: 44.5 },
  ];
  readonly air: RoomAir = {
    fog: { color: 0x0e1a1e, density: 0.006 },
    env: 'evening',
    envIntensity: 0.05,
    sky: 0,
    grade: { exposure: 1.2, saturation: 0.9, warmth: -0.03, tint: -0.035, flare: 0.003 },
  };
  film: RoomFilm = { bloom: 0.65, bloomFrom: 0.55, bloomTint: [1, 0.92, 0.8], grain: 0.4, scratches: 0.06, flicker: 0.02, weave: 0.0004, aberration: 0.001 };
  focus = 30;
  aperture = 3;

  private readonly u = {
    uMoonDir: { value: new Vector3() },
    uLitDir: { value: new Vector3() },
    uHorizonY: { value: 0 },
    uNoise: { value: null as Texture | null },
    uT: { value: 0 },
    uW: { value: 0 },
    uFlash: { value: 0 },
  };
  private readonly sheet: InstancedMesh;
  private readonly midSheet: InstancedMesh;
  private readonly carrier = { morphTargetInfluences: [0] } as unknown as Mesh;
  private readonly nearCount: number;
  private readonly loneIndex: number;
  private readonly secondIndex: number;
  private readonly flashLamp;
  private readonly faces: InstancedMesh;
  private readonly ghost: Object3D;
  private readonly ghostSheet: InstancedMesh;
  private readonly clocks: { value: number }[] = [];
  private stamp = -1;

  constructor(ctx: RoomContext) {
    super(ctx);
    const kit = this.kit;
    this.fear = 0.18;
    this.drift = 0.35;

    const moonDir = new Vector3(0, Math.sin(MOON_ELEVATION * DEG), -Math.cos(MOON_ELEVATION * DEG));
    this.u.uMoonDir.value.copy(moonDir);
    this.u.uLitDir.value.set(-0.18, 0.2, -0.96).normalize();
    this.u.uHorizonY.value = (groundAt(0, STOP_Z - FIELD_RADIUS) + 0.5 - EYE) / FIELD_RADIUS;
    this.u.uNoise.value = this.noiseTexture();

    this.buildSky();
    const ground = new Mesh(groundDisc(40, 72), kit.surface('grass_meadow', 2, { color: new Color(0x4a5a48), roughness: 0.8 }));
    ground.receiveShadow = true;
    this.root.add(ground);
    this.buildMist();
    this.root.add(this.grass());

    // every bed of the field, by how far it stands from the path of the eye
    const field: Bed[] = [];
    const across = Math.ceil(FIELD_RADIUS / COLUMN_GAP);
    const down = Math.ceil(FIELD_RADIUS / ROW_GAP);
    for (let c = -across; c < across; c++) {
      const x = (c + 0.5) * COLUMN_GAP;
      for (let r = 0; r < down; r++) {
        for (const flip of [1, -1]) {
          const z = STOP_Z - flip * (FIRST_ROW + r * ROW_GAP);
          if (Math.hypot(x, z - STOP_Z) > FIELD_RADIUS) continue;
          const along = z > START_Z ? z - START_Z : z < STOP_Z ? STOP_Z - z : 0;
          field.push({ x, y: groundAt(x, z), z, flip, away: Math.hypot(x, along) });
        }
      }
    }
    const secondX = (SECOND_BED[0] + 0.5) * COLUMN_GAP;
    const secondZ = STOP_Z - (FIRST_ROW + SECOND_BED[1] * ROW_GAP);
    const isSecond = (d: Bed): boolean => d.x === secondX && Math.abs(d.z - secondZ) < 0.01;
    const loneZ = STOP_Z - LONE_DISTANCE;
    const lone: Bed = { x: 0, y: groundAt(0, loneZ), z: loneZ, flip: 1, away: 0 };
    const near = [lone, ...field.filter((d) => d.away < NEAR_BEDS || isSecond(d)).sort((p, q) => p.away - q.away)];
    this.nearCount = near.length;
    this.loneIndex = 0;
    this.secondIndex = near.findIndex(isSecond);
    const mid = field.filter((d) => d.away >= NEAR_BEDS && d.away < MID_BEDS && !isSecond(d));
    const drawn = field.filter((d) => d.away >= MID_BEDS && d.away < FAR_BEDS);
    const cards = field.filter((d) => d.away >= FAR_BEDS);

    // the real beds: one crowd, frame and sheet together, each sheet by itself
    const real = kit.props('bed_iron', near.length, { castShadow: true });
    const paint = new Color();
    near.forEach((d, i) => {
      const s = 1 - 0.14 * hash(i * 3.7);
      real.set(i, d.x, d.y, d.z, (d.flip > 0 ? 0 : Math.PI) + (hash(i * 5.1) - 0.5) * 0.018, 1);
      for (const part of real.root.children as InstancedMesh[]) part.setColorAt(i, paint.setRGB(s, s, s * (0.96 + 0.04 * hash(i * 1.9))));
    });
    real.commit();
    this.root.add(real.root);
    const parts = real.root.children as InstancedMesh[];
    this.sheet = parts.find((m) => m.geometry.morphAttributes.position)!;
    this.sheet.morphTargetInfluences = [0];
    for (let i = 0; i < near.length; i++) this.sheet.setMorphAt(i, this.carrier);
    this.sheet.morphTexture!.needsUpdate = true;
    const sheetMaterial = this.soiledSheet(this.sheet.material as MeshStandardMaterial);
    const ironMaterial = this.rustedIron(parts.find((m) => m !== this.sheet && (m.geometry.getIndex()?.count ?? 0) > 100)!.material as MeshStandardMaterial);
    const dress = (list: InstancedMesh[]): void => {
      for (const part of list) {
        if (part.geometry.morphAttributes.position) part.material = sheetMaterial;
        else if ((part.geometry.getIndex()?.count ?? 0) > 100) part.material = ironMaterial;
        if (part.instanceColor) part.instanceColor.needsUpdate = true;
      }
    };
    dress(parts);

    // nearly real: their rails are real, their sheets are the real sheet, sampled down
    const probe = kit.prop('bed_iron', [0, 0, 0], {});
    probe.updateWorldMatrix(true, true);
    const probeSheet = probe.getObjectByName('sheet') as Mesh;
    const frameAt = probe.getObjectByName('frame')!.getWorldPosition(new Vector3());
    const sitter = this.sculptSitter(probeSheet);
    this.sheet.geometry = sitter.geometry;
    probeSheet.geometry = sitter.geometry;
    const midFrames = kit.props('bed_iron', mid.length, { nodes: ['frame'] });
    this.midSheet = new InstancedMesh(clothGeometry(clothGrid(probeSheet, 13, 21)), sheetMaterial, mid.length);
    this.midSheet.morphTargetInfluences = [0];
    this.midSheet.castShadow = true;
    this.midSheet.receiveShadow = true;
    const place = new Object3D();
    mid.forEach((d, i) => {
      midFrames.set(i, d.x + d.flip * frameAt.x, d.y, d.z + d.flip * frameAt.z, d.flip > 0 ? 0 : Math.PI, 1);
      place.position.set(d.x, d.y, d.z);
      place.rotation.y = d.flip > 0 ? 0 : Math.PI;
      place.updateMatrix();
      this.midSheet.setMatrixAt(i, place.matrix);
      const s = 1 - 0.14 * hash(i * 2.3 + 9);
      this.midSheet.setColorAt(i, paint.setRGB(s, s, s));
      for (const part of midFrames.root.children as InstancedMesh[]) part.setColorAt(i, paint);
    });
    midFrames.commit();
    dress(midFrames.root.children as InstancedMesh[]);
    this.root.add(midFrames.root, this.midSheet);

    // the one that was not there: it arrives under the flash, in the aisle, facing you
    const ghostBed: Bed = { x: 0, y: 0, z: GHOST_Z, flip: 1, away: 0 };
    const ghost = kit.props('bed_iron', 1, { castShadow: true });
    ghost.set(0, 0, 0, GHOST_Z, 0, 1);
    ghost.commit();
    const ghostParts = ghost.root.children as InstancedMesh[];
    for (const part of ghostParts) part.setColorAt(0, paint.setRGB(1, 1, 1));
    dress(ghostParts);
    this.ghostSheet = ghostParts.find((m) => m.geometry.morphAttributes.position)!;
    this.ghostSheet.geometry = sitter.geometry;
    this.ghostSheet.morphTargetInfluences = [1];
    this.ghost = ghost.root;
    this.ghost.visible = false;
    this.root.add(this.ghost);

    this.root.add(this.drawnBeds(drawn, clothGrid(probeSheet, 7, 13), frameAt));
    this.root.add(this.cardBeds(cards));
    this.contactPads([...near.slice(1), ...mid, { x: 0, y: 0, z: START_Z + 2, flip: -1, away: 0 }]);
    this.faces = this.scratchedFaces([...near, ...mid, ghostBed], sitter.headX, sitter.faceZ);
    this.root.add(this.faces);

    // the one that stands alone under the moon has a little light of its own, from nowhere
    this.light([0, lone.y + 2.6, loneZ - 1.5], 0xe9dcc0, 7, 10);

    // moonlight: a lamp low over the near field, because the shadow reaches only so far; and a cold breath from above
    this.spots = [this.spot(MOONLIGHT_AT, MOONLIGHT_AIM, 0xd9dccf, MOONLIGHT_POWER, MOONLIGHT_ANGLE, 0.7), null, null];
    this.light([0, 6, STOP_Z + 4], 0x7fa3b0, 30, 30);
    this.flashLamp = this.light([0, EYE + 0.15, STOP_Z + 0.1], 0xfff0e0, 0, FLASH_REACH);

    this.yourBed(dress);

    // sound: the wind, one bedspring and a sheet far off, a sheet nearer, then nothing at all, then a thousand sheets
    let wind: RoomVoice | null = null;
    let far: RoomVoice | null = null;
    let drone: RoomVoice | null = null;
    this.beat(0, () => {
      wind = this.sound.bed('rooms/wind_grass.mp3', { gain: 0.2, fade: 1.5 });
      far = this.sound.bed('rooms/night_wind_far.mp3', { gain: 0.1, lowpass: 1200, fade: 2.5 });
      drone = this.sound.bed('rooms/dream_drone_low.mp3', { gain: 0.06, fade: 4 });
    });
    this.beat(FIRST_AT - 0.35, () => this.sound.play('rooms/bedspring_1.mp3', { gain: 0.3, reverb: 0.4, lowpass: 3200 }));
    this.beat(FIRST_AT, () => this.sound.play('rooms/sheet_rise.mp3', { gain: 0.45, reverb: 0.3, lowpass: 4000 }));
    this.beat(SECOND_AT, () => this.sound.play('rooms/sheet_rise.mp3', { gain: 0.55, reverb: 0.2, lowpass: 6500, pan: 0.4 }));
    this.beat(HUSH_AT, () => {
      wind?.gain(0, HUSH_LENGTH);
      far?.gain(0, HUSH_LENGTH);
      drone?.gain(0, HUSH_LENGTH);
    });
    this.beat(ALL_AT, () => {
      this.sound.play('rooms/sheets_thousand.mp3', { gain: 0.55, reverb: 0.3 });
      this.sound.play('rooms/sheet_sit_up.mp3', { gain: 0.4, pan: -0.6, reverb: 0.1 });
      this.sound.play('rooms/sheet_sit_up.mp3', { gain: 0.4, pan: 0.6, reverb: 0.1, rate: 0.93 });
    });
    this.beat(SHUTTER_AT, () => this.shutter());
    this.beat(CUT_AT, () => this.sound.stopAll(0.04));
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const wind = windClock(s);
    this.u.uT.value = wind;
    for (const c of this.clocks) c.value = wind;

    const rise = REDUCED_MOTION ? ALL_RISE_CALM : ALL_RISE;
    const w = smootherstep(range(ALL_AT, ALL_AT + rise, s)) * (1 + HOLD_GROWTH * smootherstep(range(ALL_AT + rise, CUT_AT, s)));
    const first = FIRST_WEIGHT * smootherstep(range(FIRST_AT, FIRST_AT + FIRST_RISE, s));
    const second = SECOND_WEIGHT * smootherstep(range(SECOND_AT, SECOND_AT + SECOND_RISE, s));
    const stamp = w + first * 3 + second * 7;
    if (stamp !== this.stamp) {
      this.stamp = stamp;
      const influence = this.carrier.morphTargetInfluences!;
      for (let i = 0; i < this.nearCount; i++) {
        influence[0] = i === this.loneIndex ? Math.max(w, first) : i === this.secondIndex ? Math.max(w, second) : w;
        this.sheet.setMorphAt(i, this.carrier);
      }
      this.sheet.morphTexture!.needsUpdate = true;
      this.midSheet.morphTargetInfluences![0] = w;
      this.u.uW.value = w;
    }
    this.faces.visible = s >= FLASH_AT && s < FLASH_AT + FACE_SHOWN;
    this.ghost.visible = s >= FLASH_AT;
    this.ghostSheet.morphTargetInfluences![0] = Math.max(1, w);
    this.faces.position.y = (w - 1) * (SIT_TOP - 0.7);
    this.movingShadows = (s > SECOND_AT && s < SECOND_AT + SECOND_RISE) || (s > ALL_AT && s < FLASH_AT + 0.15);

    const since = s - FLASH_AT;
    const flash = since >= 0 && s < CUT_AT ? Math.exp(-since / FLASH_FALL) * (REDUCED_MOTION ? 0.5 : 1) : 0;
    this.flashLamp.intensity = flash * FLASH_POWER;
    this.u.uFlash.value = flash * FLASH_POWER;

    this.black = s >= CUT_AT ? 1 : 0;
    this.drift = s < ALL_AT ? 0.35 : 0;
    this.fear = 0.18 + 0.32 * range(FIRST_AT, HUSH_AT, s) + 0.4 * range(ALL_AT, ALL_AT + 0.6, s);
  }

  private shaderUniforms(): Record<string, { value: unknown }> {
    return { ...this.u };
  }

  private buildSky(): void {
    const sky = new Mesh(
      new SphereGeometry(SKY_RADIUS, 32, 20),
      new ShaderMaterial({
        vertexShader: RAY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: { ...this.shaderUniforms(), uMoonMap: { value: this.moonTexture() }, uMoonR: { value: Math.tan(MOON_RADIUS * DEG) }, uMoonGain: { value: MOON_GAIN } },
        side: BackSide,
      }),
    );
    sky.position.set(0, 0, STOP_Z);
    this.root.add(sky);
  }

  private buildMist(): void {
    const geometry = groundDisc(26, 56);
    MIST_LAYERS.forEach((y, i) => {
      const mist = new Mesh(
        geometry,
        new ShaderMaterial({
          vertexShader: MIST_VERT,
          fragmentShader: MIST_FRAG,
          uniforms: { ...this.shaderUniforms(), uLayer: { value: i / (MIST_LAYERS.length - 1) }, uSlice: { value: MIST_SLICE }, uDensity: { value: MIST_DENSITY } },
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
        }),
      );
      mist.position.y = y;
      mist.renderOrder = i;
      this.root.add(mist);
    });
  }

  /** Noise that tiles: R broad, G middle, B fine. */
  private noiseTexture(): DataTexture {
    const size = 256;
    const data = new Uint8Array(size * size * 4);
    const stretch = (v: number): number => Math.round(255 * Math.min(1, Math.max(0, (v - 0.26) / 0.48)));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        data[i] = stretch(fbm((x / size) * 8, (y / size) * 8, 5, 8, 13));
        data[i + 1] = stretch(fbm((x / size) * 16, (y / size) * 16, 4, 16, 4441));
        data[i + 2] = stretch(fbm((x / size) * 64, (y / size) * 64, 2, 64, 9127));
        data[i + 3] = 255;
      }
    }
    const texture = new DataTexture(data, size, size, RGBAFormat);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  }

  /** A real moon's face, seas and craters; and over the middle of it, what a pin does to the face on a print. */
  private moonTexture(): CanvasTexture {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d')!;
    const image = g.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = ((x + 0.5) / size) * 2 - 1;
        const v = ((y + 0.5) / size) * 2 - 1;
        const r = Math.hypot(u, v);
        const i = (y * size + x) * 4;
        if (r > 1.02) continue;
        const wx = fbm(u * 1.6 + 11, v * 1.6 + 5, 3, 64, 7) - 0.5;
        const wy = fbm(u * 1.6 + 2, v * 1.6 + 17, 3, 64, 23) - 0.5;
        const sea = Math.min(1, Math.max(0, (fbm((u + wx * 0.7) * 1.9 + 4, (v + wy * 0.7) * 1.9 + 9, 5, 128, 31) - 0.43) / 0.11));
        const fine = fbm(u * 16 + 2, v * 16 + 3, 4, 256, 77);
        const limb = Math.sqrt(Math.max(0, 1 - r * r));
        const tone = (0.94 - 0.26 * sea * sea * (3 - 2 * sea)) * (0.86 + 0.26 * fine) * (0.72 + 0.28 * limb ** 0.6);
        const low = Math.min(1, Math.max(0, (v + 0.2) / 1.2));
        image.data[i] = Math.min(255, 255 * tone);
        image.data[i + 1] = Math.min(255, 255 * tone * (0.9 - 0.06 * low));
        image.data[i + 2] = Math.min(255, 255 * tone * (0.75 - 0.15 * low));
        image.data[i + 3] = 255;
      }
    }
    g.putImageData(image, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 180; i++) {
      const a = hash(i * 3.1 + 1) * Math.PI * 2;
      const r = Math.sqrt(hash(i * 7.7 + 2)) * 0.97 * (size / 2);
      const x = size / 2 + Math.cos(a) * r;
      const y = size / 2 + Math.sin(a) * r;
      const c = 1.2 + hash(i * 9.3 + 5) ** 3 * 13;
      g.fillStyle = 'rgba(30,22,12,0.08)';
      g.beginPath();
      g.arc(x, y, c, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255,240,210,0.12)';
      g.lineWidth = 0.6 + c * 0.12;
      g.beginPath();
      g.arc(x - 0.4, y - 0.4, c, 0, Math.PI * 2);
      g.stroke();
    }
    g.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const cx = size * (0.5 + (hash(i + 0.5) - 0.5) * 0.34);
      const cy = size * (0.44 + (hash(i * 2.3) - 0.5) * 0.42);
      const angle = (i % 3 === 0 ? 2.1 : 1) + (hash(i * 5.1) - 0.5) * 0.55;
      const length = size * (0.1 + hash(i * 8.7) * 0.22);
      const dx = Math.cos(angle) * length;
      const dy = Math.sin(angle) * length;
      g.strokeStyle = i % 6 === 0 ? 'rgba(255,245,225,0.35)' : 'rgba(18,12,8,0.3)';
      g.lineWidth = 0.7 + hash(i * 3.3) * 1.3;
      g.beginPath();
      g.moveTo(cx - dx, cy - dy);
      g.quadraticCurveTo(cx + dy * 0.1, cy - dx * 0.1, cx + dx, cy + dy);
      g.stroke();
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }

  /** Wet grass, baked into one mesh and moved by the wind's clock. */
  private grass(): Mesh {
    const n = GRASS_BLADES;
    const position = new Float32Array(n * 15);
    const normal = new Float32Array(n * 15);
    const color = new Float32Array(n * 15);
    const bend = new Float32Array(n * 5);
    const index = new Uint32Array(n * 9);
    for (let i = 0; i < n; i++) {
      const zone = hash(i * 0.77);
      const along = GRASS_NEAR - hash(i * 1.13 + 0.2) ** 2.2 * GRASS_LENGTH;
      const aisle = (hash(i * 2.3 + 0.4) - 0.5) * (COLUMN_GAP - 1.04);
      let x: number;
      let z: number;
      if (zone < 0.42) {
        x = aisle;
        z = along;
      } else if (zone < 0.68) {
        const k = 1 + Math.floor(hash(i * 3.3) ** 2 * 4);
        x = (hash(i * 4.9) < 0.5 ? -k : k) * COLUMN_GAP + aisle;
        z = along;
      } else if (zone < 0.8) {
        x = (hash(i * 6.7) - 0.5) * 30;
        z = STOP_Z + (hash(i * 8.1) - 0.5) * 1.6;
      } else {
        x = (hash(i * 6.7) - 0.5) * 18;
        z = lerp(GRASS_NEAR, -22, hash(i * 8.1));
      }
      const y = groundAt(x, z);
      const r1 = hash(i * 9.9);
      const r2 = hash(i * 11.3);
      const r3 = hash(i * 13.7);
      const h = lerp(GRASS_HEIGHT[0], GRASS_HEIGHT[1], r1 * r1);
      const yaw = r2 * Math.PI * 2;
      const lean = r3 * Math.PI * 2;
      const away = Math.max(0, Math.abs(z - lerp(START_Z, STOP_Z, 0.5)) - 3) + Math.abs(x) * 0.8;
      const w = lerp(GRASS_HALF_WIDTH[0], GRASS_HALF_WIDTH[1], hash(i * 15.1)) * (1 + away / 7);
      const wx = Math.cos(yaw) * w;
      const wz = Math.sin(yaw) * w;
      const reach = h * (0.14 + 0.36 * hash(i * 17.9));
      const lx = Math.cos(lean) * reach;
      const lz = Math.sin(lean) * reach;
      const nx = -Math.sin(yaw) * 0.55;
      const nz = Math.cos(yaw) * 0.55;
      const pale = hash(i * 21.7) < 0.07;
      const g = hash(i * 23.3);
      const red = pale ? 0.12 : lerp(0.01, 0.03, g);
      const green = pale ? 0.1 : lerp(0.026, 0.05, g);
      const blue = pale ? 0.05 : lerp(0.02, 0.018, g);
      const v = i * 5;
      const put = (k: number, px: number, py: number, pz: number, b: number, shade: number): void => {
        const o = (v + k) * 3;
        position[o] = px;
        position[o + 1] = py;
        position[o + 2] = pz;
        normal[o] = nx;
        normal[o + 1] = 0.83;
        normal[o + 2] = nz;
        color[o] = red * shade;
        color[o + 1] = green * shade;
        color[o + 2] = blue * shade;
        bend[v + k] = b;
      };
      put(0, x - wx, y, z - wz, 0, 0.3);
      put(1, x + wx, y, z + wz, 0, 0.3);
      put(2, x - wx * 0.72 + lx * 0.35, y + h * 0.55, z - wz * 0.72 + lz * 0.35, 0.45, 0.75);
      put(3, x + wx * 0.72 + lx * 0.35, y + h * 0.55, z + wz * 0.72 + lz * 0.35, 0.45, 0.75);
      put(4, x + lx, y + h, z + lz, 1, 1.15);
      index.set([v, v + 1, v + 2, v + 1, v + 3, v + 2, v + 2, v + 3, v + 4], i * 9);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(position, 3));
    g.setAttribute('normal', new BufferAttribute(normal, 3));
    g.setAttribute('color', new BufferAttribute(color, 3));
    g.setAttribute('aBend', new BufferAttribute(bend, 1));
    g.setIndex(new BufferAttribute(index, 1));
    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, side: DoubleSide });
    const windTime = this.u.uT;
    const sway = REDUCED_MOTION ? 0.35 : 1;
    material.onBeforeCompile = (s: WebGLProgramParametersWithUniforms) => {
      s.uniforms.uWind = windTime;
      s.fragmentShader = s.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directSpecular *= 0.16;');
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aBend;\nuniform float uWind;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float wPhase = position.x * 0.7 + position.z * 0.5;
          float wGust = sin(wPhase * 0.6 + uWind * 1.1) * 0.5 + 0.5;
          float wSway = sin(wPhase * 3.1 + uWind * 3.3) * 0.6 + sin(wPhase * 7.3 + uWind * 5.1) * 0.25;
          float wTip = aBend * aBend * ${sway.toFixed(2)};
          transformed.x += wTip * (0.05 + 0.1 * wGust) * (wSway + 0.7);
          transformed.z += wTip * (0.03 + 0.05 * wGust) * wSway;`,
        );
    };
    material.customProgramCacheKey = () => `beds-grass-${sway}`;
    const mesh = new Mesh(g, material);
    mesh.receiveShadow = true;
    return mesh;
  }

  /** The sheet the moon has been lying on: damp patches, a little yellow, each bed its own. */
  private soiledSheet(source: MeshStandardMaterial): MeshStandardMaterial {
    const m = source.clone();
    m.color.setRGB(SHEET_ALBEDO[0], SHEET_ALBEDO[1], SHEET_ALBEDO[2]);
    m.roughness = 0.82;
    const noise = this.u.uNoise;
    m.onBeforeCompile = (s: WebGLProgramParametersWithUniforms) => {
      s.uniforms.uNoise = noise;
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCloth;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCloth = vec3(position.xz, instanceMatrix[3][0] * 0.31 + instanceMatrix[3][2] * 0.17);');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCloth;\nuniform sampler2D uNoise;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float clothDamp = texture2D(uNoise, vCloth.xy * 0.22 + vCloth.z).r;
          float clothFine = texture2D(uNoise, vCloth.xy * 1.6 + vCloth.z * 1.7).b;
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.74, 0.7, 0.6), smoothstep(0.55, 0.85, clothDamp)) * (0.93 + 0.14 * clothFine);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          float crease = texture2D(uNoise, vCloth.xy * vec2(1.1, 0.35) + vCloth.z).r;
          vec2 creaseSlope = vec2(dFdx(crease), dFdy(crease)) * 0.016;
          vec3 creaseX = dFdx(-vViewPosition);
          vec3 creaseY = dFdy(-vViewPosition);
          vec3 creaseR1 = cross(creaseY, normal);
          vec3 creaseR2 = cross(normal, creaseX);
          float creaseDet = dot(creaseX, creaseR1) * faceDirection;
          normal = normalize(abs(creaseDet) * normal - sign(creaseDet) * (creaseSlope.x * creaseR1 + creaseSlope.y * creaseR2));`,
        );
    };
    m.customProgramCacheKey = () => 'beds-sheet';
    return m;
  }

  /** White enamel gone to rust at the joints, mud up the legs. */
  private rustedIron(source: MeshStandardMaterial): MeshStandardMaterial {
    const m = source.clone();
    m.color.setRGB(IRON_ALBEDO[0], IRON_ALBEDO[1], IRON_ALBEDO[2]);
    const noise = this.u.uNoise;
    m.onBeforeCompile = (s: WebGLProgramParametersWithUniforms) => {
      s.uniforms.uNoise = noise;
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec4 vIron;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvIron = vec4(position.xy + position.z * vec2(0.41, 0.73), instanceMatrix[3][0] * 0.31 + instanceMatrix[3][2] * 0.17, (instanceMatrix * vec4(position, 1.0)).y);',
        );
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec4 vIron;\nuniform sampler2D uNoise;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float ironRust = smoothstep(0.54, 0.76, texture2D(uNoise, vIron.xy * 0.45 + vIron.z).r * 0.6 + texture2D(uNoise, vIron.xy * 2.7 + vIron.z * 1.3).g * 0.4);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.075, 0.035), ironRust * 0.85);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.045, 0.03), (1.0 - smoothstep(0.05, 0.34, vIron.w)) * 0.9);`,
        );
    };
    m.customProgramCacheKey = () => 'beds-iron';
    return m;
  }

  /** The real sitting shape, made a person's: a round head on a neck, shoulders, the sheet falling in folds from them, the hems tucked at the foot. */
  private sculptSitter(source: Mesh): { geometry: BufferGeometry; headX: number; faceZ: number } {
    source.updateWorldMatrix(true, false);
    const m = source.matrixWorld;
    const scale = m.getMaxScaleOnAxis();
    const g = source.geometry.clone();
    const from = g.getAttribute('position');
    const file = g.getAttribute('normal');
    const moved = g.morphAttributes.position![0];
    const n = from.count;
    const rest = new Float32Array(n * 3);
    const sat = new Float32Array(n * 3);
    const v = new Vector3();
    let top = -Infinity;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(from, i).applyMatrix4(m);
      rest.set([v.x, v.y, v.z], i * 3);
      sat.set([v.x + moved.getX(i) * scale, v.y + moved.getY(i) * scale, v.z + moved.getZ(i) * scale], i * 3);
      top = Math.max(top, sat[i * 3 + 1]);
    }
    let headX = 0;
    let headZ = 0;
    let crown = 0;
    for (let i = 0; i < n; i++) {
      if (sat[i * 3 + 1] <= top - 0.05) continue;
      headX += sat[i * 3];
      headZ += sat[i * 3 + 2];
      crown++;
    }
    headX /= crown;
    headZ /= crown;
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const y = sat[i * 3 + 1];
      const u = Math.min(1, Math.max(0, (y - SHEET_TOP) / (top - SHEET_TOP)));
      const xr = sat[i * 3] - headX;
      const zr = sat[i * 3 + 2] - (headZ + curve(SIT_WAS, u));
      const angle = Math.atan2(zr, xr);
      const band = Math.min(range(0.08, 0.2, u), 1 - range(0.62, 0.74, u));
      const radius = Math.hypot(xr, zr);
      const fold = 1 + (SIT_FOLD * band * (Math.sin(7 * angle + 1.3) + 0.6 * Math.sin(13 * angle + 4.1))) / Math.max(radius, 0.12) + (SIT_FOLD * 0.35 * range(0.72, 0.8, u) * Math.sin(5 * angle + 0.7)) / Math.max(radius, 0.08);
      const radial = curve(SIT_RADIUS, u) * fold;
      const forward = rest[i * 3 + 2] - headZ;
      const hem = 0.85 * smootherstep(range(0.2, 0.5, Math.abs(rest[i * 3] - headX))) * smootherstep(range(0.15, 0.6, forward));
      // over the head the sheet closes round a skull, the face pressing through: never a peak
      const skull = smootherstep(range(SKULL_FROM, SKULL_FROM + SKULL_EASE * (1 - SKULL_FROM), u));
      const phi = (1 - range(SKULL_FROM, 1, u)) * SKULL_ARC;
      const nose = NOSE[0] * Math.exp(-(((angle - Math.PI / 2) / NOSE[2]) ** 2) - ((phi - NOSE[1]) / NOSE[3]) ** 2);
      const nx = lerp(headX + xr * radial, headX + Math.cos(angle) * SKULL[0] * Math.sin(phi), skull);
      const nz = lerp(headZ + curve(SIT_NOW, u) + zr * radial * curve(SIT_DEPTH, u), headZ + curve(SIT_NOW, 1) + Math.sin(angle) * (SKULL[2] * Math.sin(phi) + nose), skull);
      const shins = smootherstep(range(0.35, 0.6, forward)) * (1 - smootherstep(range(1.15, 1.4, forward)));
      const legs = shins * 0.032 * (Math.exp(-(((sat[i * 3] - headX - 0.13) / 0.085) ** 2)) + Math.exp(-(((sat[i * 3] - headX + 0.13) / 0.085) ** 2)));
      const raised = (u > 0 ? lerp(SHEET_TOP + (SIT_TOP - SHEET_TOP) * u, SIT_TOP - SKULL[1] * (1 - Math.cos(phi)), skull) : y) + legs;
      const ny = lerp(raised, 0.66, smootherstep(range(0.12, 0.42, headZ + curve(SIT_NOW, 1) - nz)) * 0.9);
      out[i * 3] = lerp(nx, rest[i * 3], hem);
      out[i * 3 + 1] = lerp(ny, rest[i * 3 + 1], hem);
      out[i * 3 + 2] = lerp(nz, rest[i * 3 + 2], hem);
    }
    let faceZ = -Infinity;
    for (let i = 0; i < n; i++) {
      if (Math.abs(out[i * 3 + 1] - FACE_Y) < 0.03 && Math.abs(out[i * 3] - headX) < 0.04) faceZ = Math.max(faceZ, out[i * 3 + 2]);
    }
    const satNormal = normalsOf(out, Array.from(g.getIndex()!.array));
    const delta = new Float32Array(n * 3);
    const sitNormal = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) delta[i * 3 + c] = (out[i * 3 + c] - rest[i * 3 + c]) / scale;
      sitNormal[i * 3] = satNormal[i * 3] - file.getX(i);
      sitNormal[i * 3 + 1] = satNormal[i * 3 + 1] - file.getY(i);
      sitNormal[i * 3 + 2] = satNormal[i * 3 + 2] - file.getZ(i);
    }
    g.morphAttributes.position = [new BufferAttribute(delta, 3)];
    g.morphAttributes.normal = [new BufferAttribute(sitNormal, 3)];
    return { geometry: g, headX, faceZ };
  }

  /** What the flash finds under the cloth, for as long as the flash lasts: the scratches that took the faces out of the photograph. */
  private scratchedFaces(list: readonly Bed[], headX: number, faceZ: number): InstancedMesh {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d')!;
    g.lineCap = 'round';
    for (let i = 0; i < 90; i++) {
      const a = hash(i * 1.7) * Math.PI * 2;
      const r = Math.sqrt(hash(i * 2.9 + 3));
      const x = size / 2 + Math.cos(a) * r * size * 0.3;
      const y = size / 2 + Math.sin(a) * r * size * 0.36;
      const angle = (i % 2 === 0 ? 0.9 : 2.2) + (hash(i * 4.3) - 0.5) * 0.7;
      const length = size * (0.12 + hash(i * 6.1) * 0.24);
      g.strokeStyle = `rgba(10,7,5,${0.5 + 0.4 * hash(i * 8.3)})`;
      g.lineWidth = 1.4 + hash(i * 9.7) * 1.8;
      g.beginPath();
      g.moveTo(x - Math.cos(angle) * length, y - Math.sin(angle) * length);
      g.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      g.stroke();
    }
    g.globalCompositeOperation = 'destination-in';
    const edge = g.createRadialGradient(size / 2, size / 2, size * 0.32, size / 2, size / 2, size * 0.5);
    edge.addColorStop(0, 'rgba(0,0,0,1)');
    edge.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = edge;
    g.fillRect(0, 0, size, size);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const mesh = new InstancedMesh(new PlaneGeometry(FACE_SIZE[0], FACE_SIZE[1]), new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }), list.length);
    const place = new Object3D();
    list.forEach((d, i) => {
      place.position.set(d.x + d.flip * headX, d.y + FACE_Y, d.z + d.flip * (faceZ + 0.008));
      place.rotation.y = d.flip > 0 ? 0 : Math.PI;
      place.updateMatrix();
      mesh.setMatrixAt(i, place.matrix);
    });
    mesh.visible = false;
    return mesh;
  }

  /** Beds in the middle distance: a sampled sheet and rails drawn as flat strips. Merged, one draw, one uniform for the sitting. */
  private drawnBeds(list: readonly Bed[], cloth: Cloth, frameAt: Vector3): InstancedMesh {
    const ps: number[] = [];
    const ns: number[] = [];
    const index = [...cloth.index];
    const base = cloth.position.length / 3;
    const width = 0.011;
    const strip = (ax: number, ay: number, bx: number, by: number, z: number): void => {
      const len = Math.hypot(bx - ax, by - ay);
      const px = (-(by - ay) / len) * width;
      const py = ((bx - ax) / len) * width;
      const v = base + ps.length / 3;
      for (const [x, y] of [[ax - px, ay - py], [ax + px, ay + py], [bx + px, by + py], [bx - px, by - py]]) {
        ps.push(x + frameAt.x, y, z + frameAt.z);
        ns.push(0, 0.2, 0.98);
      }
      index.push(v, v + 1, v + 2, v, v + 2, v + 3);
    };
    const halfWidth = 0.447;
    const rail = (z: number, top: number, edge: number): void => {
      const y = (x: number): number => top - ((top - edge) * x * x) / (halfWidth * halfWidth);
      const xs = [-halfWidth, -0.22, 0, 0.22, halfWidth];
      for (let i = 0; i < 4; i++) strip(xs[i], y(xs[i]), xs[i + 1], y(xs[i + 1]), z);
      strip(-halfWidth, 0, -halfWidth, edge, z);
      strip(halfWidth, 0, halfWidth, edge, z);
      for (const x of [-0.22, 0, 0.22]) strip(x, 0.44, x, y(x), z);
      strip(-halfWidth, 0.44, halfWidth, 0.44, z);
    };
    rail(-0.975, 1.125, 1.05);
    rail(0.975, 0.905, 0.83);
    const total = base + ps.length / 3;
    const position = new Float32Array(total * 3);
    const normal = new Float32Array(total * 3);
    const sit = new Float32Array(total * 3);
    const sitNormal = new Float32Array(total * 3);
    const part = new Float32Array(total);
    position.set(cloth.position);
    normal.set(cloth.normal);
    sit.set(cloth.sit);
    sitNormal.set(cloth.sitNormal);
    position.set(ps, cloth.position.length);
    normal.set(ns, cloth.normal.length);
    part.fill(1, base);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(position, 3));
    g.setAttribute('normal', new BufferAttribute(normal, 3));
    g.setAttribute('aSit', new BufferAttribute(sit, 3));
    g.setAttribute('aSitN', new BufferAttribute(sitNormal, 3));
    g.setAttribute('aPart', new BufferAttribute(part, 1));
    g.setIndex(index);
    const mesh = new InstancedMesh(g, new ShaderMaterial({ vertexShader: DRAWN_VERT, fragmentShader: DRAWN_FRAG, uniforms: this.shaderUniforms(), side: DoubleSide }), list.length);
    const place = new Object3D();
    list.forEach((d, i) => {
      place.position.set(d.x, d.y, d.z);
      place.rotation.y = d.flip > 0 ? 0 : Math.PI;
      place.updateMatrix();
      mesh.setMatrixAt(i, place.matrix);
    });
    return mesh;
  }

  /** Beds toward the horizon: a card each, turned to the eye, on which the shader draws a sheet and whoever sits under it. */
  private cardBeds(list: readonly Bed[]): Mesh {
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const at = new Float32Array(list.length * 3);
    const kind = new Float32Array(list.length * 2);
    list.forEach((d, i) => {
      at[i * 3] = d.x;
      at[i * 3 + 1] = d.y;
      at[i * 3 + 2] = d.z;
      kind[i * 2] = d.flip;
      kind[i * 2 + 1] = hash(i * 7.3);
    });
    g.setAttribute('aAt', new InstancedBufferAttribute(at, 3));
    g.setAttribute('aKind', new InstancedBufferAttribute(kind, 2));
    g.instanceCount = list.length;
    const mesh = new Mesh(g, new ShaderMaterial({ vertexShader: CARD_VERT, fragmentShader: CARD_FRAG, uniforms: this.shaderUniforms(), side: DoubleSide }));
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Where each near bed meets the wet ground: only the key casts, and only so far. */
  private contactPads(list: readonly Bed[]): void {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d')!;
    const soft = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    soft.addColorStop(0, 'rgba(255,255,255,1)');
    soft.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = soft;
    g.fillRect(0, 0, size, size);
    const geometry = new PlaneGeometry(1.8, 3);
    geometry.rotateX(-Math.PI / 2);
    const pads = new InstancedMesh(geometry, new MeshBasicMaterial({ map: new CanvasTexture(canvas), color: 0x000000, transparent: true, opacity: 0.72, depthWrite: false }), list.length);
    const place = new Object3D();
    list.forEach((d, i) => {
      place.position.set(d.x, d.y + 0.015, d.z);
      place.updateMatrix();
      pads.setMatrixAt(i, place.matrix);
    });
    pads.renderOrder = -2;
    this.root.add(pads);
  }

  /** Behind you, in the aisle: the one bed nobody is in. The sheet thrown back, a hollow worn in the mattress, white hair where the head was. */
  private yourBed(dress: (list: InstancedMesh[]) => void): void {
    const kit = this.kit;
    const z = START_Z + 2;
    const frame = kit.props('bed_iron', 1, { nodes: ['frame'] });
    frame.set(0, 0, 0, z, Math.PI, 1);
    frame.commit();
    const parts = frame.root.children as InstancedMesh[];
    for (const part of parts) part.setColorAt(0, new Color(0.9, 0.9, 0.86));
    dress(parts);
    this.root.add(frame.root);
    const sheet = new PlaneGeometry(1.14, 1.34, 22, 26);
    sheet.rotateX(-Math.PI / 2);
    const p = sheet.getAttribute('position');
    const uv = sheet.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const v = p.getZ(i);
      const t = (v + 0.67) / 1.34;
      const over = Math.max(0, Math.abs(x) - 0.44);
      const fold = 0.09 * Math.exp(-(((t - 0.9) / 0.12) ** 2));
      const rumple = (fbm(x * 3.1 + 5, v * 3.1 + 9, 3, 64, 201) - 0.5) * 0.11;
      p.setY(i, 0.6 + fold + rumple * (1 - over * 2) - over * 2.3);
      uv.setXY(i, x, v);
    }
    sheet.translate(0, 0, z - 0.42);
    sheet.computeVertexNormals();
    const linen = new Mesh(sheet, kit.surface('linen_white', 0.4, { color: new Color(0xb9b9b0), roughness: 0.9 }));
    linen.receiveShadow = true;
    this.root.add(linen);
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size * 2;
    const c = canvas.getContext('2d')!;
    const blot = (x: number, y: number, rx: number, ry: number, a: number): void => {
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(26,18,10,${a})`);
      g.addColorStop(1, 'rgba(26,18,10,0)');
      c.save();
      c.translate(x * size, y * size * 2);
      c.scale(rx * size, ry * size * 2);
      c.fillStyle = g;
      c.fillRect(-1, -1, 2, 2);
      c.restore();
    };
    blot(0.5, 0.14, 0.2, 0.09, 0.7);
    blot(0.5, 0.42, 0.34, 0.22, 0.75);
    blot(0.5, 0.74, 0.28, 0.2, 0.55);
    const plate = new PlaneGeometry(0.72, 1.7);
    plate.rotateX(-Math.PI / 2);
    const hollow = new InstancedMesh(plate, new MeshBasicMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false }), 1);
    const place = new Object3D();
    place.position.set(0, 0.572, z + 0.02);
    place.rotation.y = Math.PI;
    place.updateMatrix();
    hollow.setMatrixAt(0, place.matrix);
    this.root.add(hollow);
    this.clocks.push(this.build.tangle(240, { x: [-0.26, 0.26], y: 0.6, z: [z + 0.54, z + 0.84] }, [0.2, 0.55], this.root, { seed: 5 }).time);
  }
}
