import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CustomBlending,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  MultiplyBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
  type Object3D,
  type PerspectiveCamera,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import { randomFrom, type FigureSpec } from '../../dream/FigureKit';
import { wobble } from '../../math';
import { GlideTrack } from '../../timeline/Track';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey, RoomPose } from '../Room';
import { Room } from '../Room';
import { PALETTE } from '../RoomKit';
import type { RoomVoice } from '../RoomSound';
import { Snakes } from '../Snakes';

export const assets: RoomAssets = {
  models: ['handrail', 'newel_cap', 'baluster_turned', 'frame_gold', 'chair_ladder', 'dining_table', 'plate', 'fork', 'knife'],
  materials: ['wood_stair', 'wood_floor_dark', 'velvet_red'],
  sounds: [
    'rooms/water_slop_wood.mp3',
    'rooms/flooded_cellar.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/dream_drone_metal.mp3',
    'rooms/stair_tread_1.mp3',
    'rooms/stair_tread_2.mp3',
    'rooms/stair_tread_3.mp3',
    'rooms/stair_tread_4.mp3',
    'rooms/stair_tread_5.mp3',
    'rooms/stair_tread_6.mp3',
    'rooms/stair_creak_1.mp3',
    'rooms/stair_creak_3.mp3',
    'rooms/stair_creak_5.mp3',
    'rooms/wade_step_1.mp3',
    'rooms/wade_step_2.mp3',
    'rooms/wade_step_3.mp3',
    'rooms/wade_step_4.mp3',
    'rooms/wade_step_5.mp3',
    'rooms/wade_slow.mp3',
    'rooms/snakes_on_water.mp3',
    'rooms/snake_water_1.mp3',
    'rooms/snake_water_2.mp3',
    'rooms/snake_water_3.mp3',
    'rooms/snake_water_4.mp3',
    'rooms/snake_hiss_2.mp3',
    'rooms/snake_hiss_3.mp3',
    'rooms/snake_hiss_close.mp3',
    'rooms/wet_plip_2.mp3',
    'rooms/breath_in.mp3',
    'rooms/surface_close.mp3',
    'rooms/underwater_muffled.mp3',
    'rooms/bubbles_rising.mp3',
    'rooms/bubbles_exhale_1.mp3',
    'rooms/bubble_small_1.mp3',
    'rooms/bubble_small_2.mp3',
    'rooms/cutlery_far.mp3',
  ],
};

type V3 = readonly [number, number, number];

/** The stairs (m): one step's rise and run, steps from the landing to the hall floor. */
const RISE = 0.19;
const RUN = 0.28;
const STEPS = 17;
const SLOPE = RISE / RUN;
const SLOPE_ANGLE = Math.atan(SLOPE);
const TOP = RISE * STEPS;
const FOOT_Z = -STEPS * RUN;
/** The water stands 5 cm over the seventh tread (m). */
const WATER = TOP - 7 * RISE + 0.05;
/** The hall (m). The stairs lie against its left wall, 1.2 m wide. */
const HALF_W = 2.3;
const BACK_Z = 2.5;
const FAR_Z = -13.2;
const HALL_H = 6.6;
const STAIR_IN = -HALF_W + 1.2;
const RAIL_X = STAIR_IN - 0.05;
/** The rail's height over the line of the nosings (m). */
const RAIL_H = 0.92;
/** The table in the drowned hall, and the lamp that hangs over it (m). */
const TABLE_Z = -8.7;
const PENDANT_Y = 1.74;
/** The lamp at the foot of the stairs (x, z) and the two on the far wall (y). */
const SIDE_LAMP = [0.95, -4.95] as const;
const SCONCE_Y = 1.3;

/** The eye over the tread (m); when it arrives on each step, 1 to 14 (s); how long a step takes, and more in deep water (s). */
const EYE_H = 1.53;
const STEP_AT = [2.4, 3.8, 5.2, 6.6, 8.0, 9.4, 10.8, 12.2, 13.6, 15.2, 17.0, 18.8, 20.8, 23.2];
const STEP_TAKES = 0.9;
const STEP_TAKES_DEEP = 0.09;
/** x of the eye on each step from the 12th on (m): it leaves the wall for the middle of the hall. */
const EYE_XS = [-1.58, -1.25, -0.75];
const EYE_WALL_X = -1.66;
/** After the last step: seconds, x, y, z (m). */
const GLIDE: readonly (readonly [number, number, number, number])[] = [
  [26, 0, WATER + 0.004, -4.35],
  [33.82, 0, WATER + 0.004, -4.86],
  [34.1, 0, WATER - 0.1, -4.9],
  [35.2, 0, 1.62, -5.05],
  [38, 0.05, 1.32, -5.75],
  [41, 0.12, 0.94, -6.25],
  [44, 0.2, 0.52, -6.62],
  [46, 0.2, 0.5, -6.66],
];
/** Seconds, yaw, pitch, fov of the eye (deg). */
const LOOK: readonly (readonly [number, number, number, number])[] = [
  [0, -5, -45, 62],
  [4, -5, -44, 62],
  [8, -5, -39, 60],
  [11, -5, -32, 58],
  [14, -5, -25, 57],
  [17, -5, -18, 56],
  [20, -4, -12, 55],
  [23, -2, -6, 54],
  [26, 0, 0, 54],
  [33.8, 0, 0, 54],
  [35, 0, -1, 56],
  [38, 1, -2, 57],
  [44, 2, 7, 58],
  [46, 2, 7, 58],
];
/** A step's sway of the head (deg). */
const STEP_ROLL = REDUCED_MOTION ? 0 : 0.55;

/** The waterline holds across the middle of the picture from here, until the surface closes; the cut (s). */
const HOLD_FROM = 26;
const CLOSES = 34;
const CUT = 44;
/** Height of the eye over the water at which the surface starts to open, and is open (m). */
const CLEAR_FROM = 0.075;
const CLEAR_TO = 0.012;

/** Air, and water once the surface has closed: fog color, density, exposure, saturation, warmth, tint. */
const AIR = { fog: 0x060b0b, density: 0.03, exposure: 1.32, saturation: 0.82, warmth: 0.02, tint: -0.02 };
const DROWNED = { fog: 0x0b4a4a, density: 0.16, exposure: 1.3, saturation: 0.74, warmth: -0.04, tint: -0.05 };

/** Light (scene units). */
const PENDANT_LIGHT = 13;
const SIDE_LIGHT = 4.5;
const LANDING_LIGHT = 3.2;
const BULB_LIGHT = 7;
const FAN_LIGHT = 2.4;
const WATER_LIGHT = 3;
const LENS_LIGHT = 0.7;
const PENDANT_SPOT = 13;
/** The bare bulb on its long cord over the well: what lights the dry steps, and what the black water mirrors (m). */
const BULB_AT: V3 = [-0.25, 5.35, -3.3];
/** What the water glows with round each lamp (see WATER_FRAG), and where they are. */
const LAMP_GLOWS: readonly { at: V3; power: number }[] = [
  { at: [0, PENDANT_Y - 0.08, TABLE_Z], power: 0.085 },
  { at: [SIDE_LAMP[0], 1.02, SIDE_LAMP[1]], power: 0.05 },
  { at: [-1.3, SCONCE_Y, FAR_Z + 0.22], power: 0.02 },
  { at: [1.3, SCONCE_Y, FAR_Z + 0.22], power: 0.02 },
];
/** The cold half moon of glass over the far door: its middle (m). */
const FAN_AT: V3 = [0, 3.96, FAR_Z + 0.05];

/** The surface as seen from above: how much it swallows per meter of water, and how far along a ray that counts. */
const SIGMA_ABOVE = 0.62;
/** What the surface takes away at once, however shallow the water; how far the damp climbs the walls (m). */
const SURFACE_DIM = 0.34;
const DAMP_H = 1.9;
const SIGMA_OPEN = 0.1;
const REACH_ABOVE = 11;
const REACH_OPEN = 6.5;
/** The surface's mesh around the eye: rings, sectors, how far it goes (m). */
const SHEET_RINGS = 64;
const SHEET_SECTORS = 96;
const SHEET_REACH = 40;
const SHEET_GROWTH = 1.13;

/** Swimmers: how many; the first three cross alone; the rest arrive between these seconds. */
const FLOW = 54;
const FLOW_FROM = 19.4;
const FLOW_FULL = 23.4;
/** Where they start and end across the hall (x, m, hidden behind the curtains), and along it (z, m). */
const FLOW_X = [-2.5, 2.55] as const;
const FLOW_Z = [-12, -6.7] as const;
/** No swimmer's line comes nearer than this to where the eye stands (m). */
const FLOW_CLEAR = 0.42;
const EYE_WAY: readonly (readonly [number, number])[] = [
  [-1.25, -3.54],
  [-0.75, -3.82],
  [-0.3, -4.2],
  [0, -4.35],
  [0, -4.86],
];
/** The one at the lens: seconds it sets off, stops, turns away, is gone; how far off it starts and where it stops (m). */
const LENS = { from: 18.2, stop: 23, leave: 24.7, gone: 26.2, reach: 3.4, hand: 0.135 };

/** Seconds, fear (0..1). */
const FEAR: readonly (readonly [number, number])[] = [
  [0, 0.25],
  [10, 0.35],
  [16, 0.5],
  [22, 0.72],
  [26.4, 0.78],
  [28, 0.18],
  [30, 0.18],
  [34, 0.6],
  [46, 0.7],
];
/** Seconds, focus (m). */
const FOCUS: readonly (readonly [number, number])[] = [
  [0, 4.6],
  [16, 3.4],
  [22.1, 3],
  [22.9, 0.14],
  [24.9, 0.14],
  [25.9, 0.28],
  [26.6, 3.9],
  [34, 3.9],
  [38, 3.2],
  [46, 2.1],
];
const APERTURE = 3;
/** Floating things: how long each print on the water, at most, of the pictures kept. */
const PRINTS_ON_WATER = 4;
const BUBBLES = 130;
/** How much wider the hair is at its tips than at the scalp (share). */
const HAIR_FAN = 0.12;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};
/** A number from a table of (seconds, values). */
function lookup(table: readonly (readonly number[])[], seconds: number, column: number): number {
  if (seconds <= table[0][0]) return table[0][column];
  for (let i = 1; i < table.length; i++) {
    if (seconds <= table[i][0]) {
      const a = table[i - 1];
      const b = table[i];
      return a[column] + ((b[column] - a[column]) * (seconds - a[0])) / (b[0] - a[0]);
    }
  }
  return table[table.length - 1][column];
}
const trackOf = (table: readonly (readonly [number, number])[]) =>
  new GlideTrack(
    table.map((k) => k[0]),
    table.map((k) => k[1]),
  );

/** A box with texture coordinates in meters, so that a surface tiles at its true size. */
function slab(w: number, h: number, d: number, x = 0, y = 0, z = 0): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const flat = Math.abs(n.getY(i)) > 0.5;
    const side = Math.abs(n.getX(i)) > 0.5;
    uv.setXY(i, side ? p.getZ(i) + z : p.getX(i) + x, flat ? p.getZ(i) + z : p.getY(i) + y);
  }
  return g.translate(x, y, z);
}

/** A board laid along the stairs: its middle at (x, y, z). */
function raked(w: number, h: number, length: number, x: number, y: number, z: number): BufferGeometry {
  return slab(w, h, length).rotateX(-SLOPE_ANGLE).translate(x, y, z);
}

/** A disc of triangles around the eye that thin out with distance: the water near the lens can really move. */
function sheetGeometry(): BufferGeometry {
  const positions: number[] = [0, 0, 0];
  const indices: number[] = [];
  const whole = Math.pow(SHEET_GROWTH, SHEET_RINGS) - 1;
  for (let r = 1; r <= SHEET_RINGS; r++) {
    const radius = (SHEET_REACH * (Math.pow(SHEET_GROWTH, r) - 1)) / whole;
    for (let s = 0; s < SHEET_SECTORS; s++) {
      const a = (s / SHEET_SECTORS) * Math.PI * 2;
      positions.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    }
  }
  for (let s = 0; s < SHEET_SECTORS; s++) indices.push(0, 1 + ((s + 1) % SHEET_SECTORS), 1 + s);
  for (let r = 0; r < SHEET_RINGS - 1; r++) {
    for (let s = 0; s < SHEET_SECTORS; s++) {
      const a = 1 + r * SHEET_SECTORS + s;
      const b = 1 + r * SHEET_SECTORS + ((s + 1) % SHEET_SECTORS);
      const c = a + SHEET_SECTORS;
      const d = b + SHEET_SECTORS;
      indices.push(a, b, d, a, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  return g;
}

/** One tile for all the water: red is a net of light where cells meet, green and blue the slope of small ripples. */
function waterTile(): DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const random = randomFrom(11);
  const cells = 18;
  const px: number[] = [];
  const py: number[] = [];
  for (let i = 0; i < cells; i++) {
    px.push(random());
    py.push(random());
  }
  const wrap = (d: number) => d - Math.round(d);
  const tau = Math.PI * 2;
  const height = (u: number, v: number) => {
    const a = u * tau;
    const b = v * tau;
    return Math.sin(a * 3 + Math.sin(b * 2) * 1.4) * 0.5 + Math.sin(b * 5 + Math.cos(a * 3) * 1.1) * 0.3 + Math.sin((a + b) * 7) * 0.2;
  };
  const step = 1 / size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const v = j / size;
      let near = 9;
      let next = 9;
      for (let n = 0; n < cells; n++) {
        const dx = wrap(u - px[n]);
        const dy = wrap(v - py[n]);
        const d = dx * dx + dy * dy;
        if (d < near) {
          next = near;
          near = d;
        } else if (d < next) next = d;
      }
      const edge = Math.sqrt(next) - Math.sqrt(near);
      const k = (j * size + i) * 4;
      data[k] = 255 * Math.pow(clamp01(1 - edge * 5), 2.2);
      data[k + 1] = 128 + (height(u - step, v) - height(u + step, v)) * 900;
      data[k + 2] = 128 + (height(u, v - step) - height(u, v + step)) * 900;
      data[k + 3] = 255;
    }
  }
  const t = new DataTexture(data, size, size);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

const WATER_VERT = /* glsl */ `
uniform float uTime;
uniform float uSwell;
uniform vec3 uOrigin;
varying vec3 vP;
float swell(vec2 p, float t) {
  return 0.55 * sin(p.x * 1.9 + t * 0.7 + sin(p.y * 1.1 + t * 0.3) * 0.7) + 0.3 * sin(p.y * 3.7 - t * 1.1 + p.x * 1.3) + 0.15 * sin((p.x - p.y) * 7.3 + t * 1.6);
}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vP = w.xyz - uOrigin;
  float r2 = dot(position.xz, position.xz);
  float lap = uSwell * swell(vP.xz, uTime) * exp(-r2 * 0.32);
  vP.y += lap;
  w.y += lap;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/**
 * The water seen from above, and from below once the surface has closed. From above it is a black mirror that swallows
 * what lies under it, by how long a ray stays in the water; the glow round the drowned lamps is added here too, so it
 * stops dead at the surface. When the lens is at the waterline the mirror goes and the water opens: half above, half below.
 */
const WATER_FRAG = /* glsl */ `
#define LAMPS ${LAMP_GLOWS.length}
uniform float uTime;
uniform float uClear;
uniform float uUnder;
uniform float uSwell;
uniform float uRing;
uniform float uRingAge;
uniform float uFogDensity;
uniform vec3 uEye;
uniform vec3 uFog;
uniform vec3 uLampAt[LAMPS];
uniform float uLampPower[LAMPS];
uniform sampler2D uTile;
varying vec3 vP;
const float WATER = ${WATER.toFixed(3)};
const float STAIR_IN = ${STAIR_IN.toFixed(3)};
const float FOOT_Z = ${FOOT_Z.toFixed(3)};
const float SLOPE = ${SLOPE.toFixed(4)};
const vec3 FAN = vec3(${FAN_AT[0].toFixed(2)}, ${FAN_AT[1].toFixed(2)}, ${FAN_AT[2].toFixed(2)});
const vec3 BULB = vec3(${BULB_AT[0].toFixed(2)}, ${BULB_AT[1].toFixed(2)}, ${BULB_AT[2].toFixed(2)});
const vec3 WARM = vec3(1.0, 0.6, 0.27);
const vec3 TEAL = vec3(0.1, 0.5, 0.47);

float bedAt(vec2 p) {
  return p.x < STAIR_IN ? max(0.0, (p.y - FOOT_Z) * SLOPE) : 0.0;
}

void main() {
  vec3 V = normalize(vP - uEye);
  vec2 a = texture2D(uTile, vP.xz * 0.33 + vec2(uTime * 0.011, uTime * 0.007)).gb - 0.5;
  vec2 b = texture2D(uTile, vP.xz * 0.91 - vec2(uTime * 0.016, -uTime * 0.012)).gb - 0.5;
  vec2 slope = (a + b * 0.55) * (0.05 + uSwell * 3.0);
  vec2 off = vP.xz - uEye.xz;
  float r = length(off) + 0.001;
  float front = r - uRingAge * 0.62;
  slope += off / r * uRing * sin(front * 26.0) * exp(-front * front * 9.0) * exp(-uRingAge * 0.8);
  vec3 N = normalize(vec3(slope.x, 1.0, slope.y));
  vec3 color;
  float alpha = 1.0;
  if (uUnder > 0.5) {
    vec3 R = reflect(V, vec3(slope.x, -1.0, slope.y));
    vec3 lit = vec3(0.0);
    for (int i = 0; i < LAMPS; i++) {
      vec3 toLamp = normalize(uLampAt[i] - vP);
      lit += WARM * uLampPower[i] * 14.0 * pow(max(dot(R, toLamp), 0.0), 40.0);
    }
    float net = texture2D(uTile, vP.xz * 0.5 + vec2(uTime * 0.02, -uTime * 0.015)).r;
    vec3 sheen = vec3(0.028, 0.12, 0.116) * (0.65 + net * 1.6) + lit;
    float window = smoothstep(0.62, 0.7, V.y + slope.x * 0.5);
    color = mix(sheen, vec3(0.006, 0.012, 0.013) + net * vec3(0.03, 0.05, 0.05), window);
  } else {
    float cosI = clamp(-dot(V, N), 0.0, 1.0);
    float F = (0.02 + 0.98 * pow(1.0 - cosI, 3.4)) * (1.0 - uClear);
    vec3 T = normalize(mix(refract(V, N, 0.752), V, uClear));
    float depth = max(WATER - bedAt(vP.xz), 0.01);
    float len = min(depth / max(-T.y, 0.06), mix(${REACH_ABOVE.toFixed(1)}, ${REACH_OPEN.toFixed(1)}, uClear));
    vec3 glow = vec3(0.0);
    for (int i = 0; i < LAMPS; i++) {
      vec3 toLamp = uLampAt[i] - vP;
      float tc = dot(toLamp, T);
      float b2 = max(dot(toLamp, toLamp) - tc * tc, 0.0004);
      float along = sqrt(b2);
      float amount = (atan((len - tc) / along) + atan(tc / along)) / along;
      glow += uLampPower[i] * mix(TEAL, WARM, exp(-along * 0.9)) * amount * exp(-along * 0.62);
    }
    alpha = 1.0 - (1.0 - ${SURFACE_DIM.toFixed(2)} * (1.0 - uClear)) * exp(-mix(${SIGMA_ABOVE.toFixed(2)}, ${SIGMA_OPEN.toFixed(2)}, uClear) * len);
    vec3 R = reflect(V, N);
    vec3 env = mix(vec3(0.014, 0.028, 0.028), vec3(0.002, 0.004, 0.005), clamp(R.y * 1.7, 0.0, 1.0));
    vec3 toFan = normalize(FAN - vP);
    vec3 across = normalize(cross(vec3(0.0, 1.0, 0.0), toFan));
    vec3 d = R - toFan;
    float lat = dot(d, across);
    float streak = exp(-lat * lat * 300.0 - d.y * d.y * 22.0);
    vec3 toBulb = normalize(BULB - vP);
    float facing = max(dot(R, toBulb), 0.0);
    vec3 mirror = env + vec3(0.62, 0.8, 0.86) * streak * 0.14 + WARM * (pow(facing, 520.0) * 14.0 + pow(facing, 34.0) * 0.18);
    color = glow * (1.0 - F) + mirror * max(F, 0.035 * (1.0 - uClear)) + TEAL * 0.007 * alpha * (1.0 - uClear) + vec3(0.012, 0.024, 0.022) * smoothstep(0.08, 0.0, depth);
    alpha = mix(alpha, 1.0, F);
    // at the lens: a thin silver rim where the water meets it; a crest rising past the eye stays clear
    float crest = smoothstep(0.0, 0.012, V.y);
    alpha *= 1.0 - crest * uClear;
    color *= 1.0 - crest * uClear;
    color += vec3(0.09, 0.19, 0.18) * exp(-V.y * V.y * 9000.0) * uClear;
  }
  float d2 = dot(vP - uEye, vP - uEye) * uFogDensity * uFogDensity;
  color = mix(color, uFog * alpha, 1.0 - exp(-d2));
  gl_FragColor = vec4(color, alpha);
}`;

const LIGHT_VERT = /* glsl */ `
uniform vec3 uOrigin;
varying vec3 vP;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vP = w.xyz - uOrigin;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** The net of light that water throws: on the drowned floor, and up the walls above it, fading with height. */
const LIGHT_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFall;
uniform vec3 uTint;
uniform vec3 uU;
uniform vec3 uV;
uniform vec3 uLampAt[2];
uniform sampler2D uTile;
uniform sampler2D uDamp;
uniform float uIsDamp;
varying vec3 vP;
void main() {
  vec2 uv = vec2(dot(vP, uU), dot(vP, uV));
  if (uIsDamp > 0.5) {
    gl_FragColor = texture2D(uDamp, vec2(uv.x, uv.y - uFall));
    return;
  }
  float a = texture2D(uTile, uv + vec2(uTime * 0.017, uTime * 0.011)).r;
  float b = texture2D(uTile, uv * 1.31 + vec2(-uTime * 0.013, uTime * 0.019) + 0.37).r;
  float net = a * b * 1.3 + (a + b) * 0.08;
  float fall = exp(-max(vP.y - ${WATER.toFixed(3)}, 0.0) * uFall);
  vec2 d0 = vP.xz - uLampAt[0].xz;
  vec2 d1 = vP.xz - uLampAt[1].xz;
  float near = 1.0 / (1.0 + dot(d0, d0) * 0.3) + 0.6 / (1.0 + dot(d1, d1) * 0.45);
  gl_FragColor = vec4(uTint * net * fall * near, 1.0);
}`;

const BUBBLE_VERT = /* glsl */ `
uniform float uTime;
uniform float uBurst;
varying vec2 vUv;
varying float vA;
void main() {
  vec3 at = instanceMatrix[3].xyz;
  float size = length(instanceMatrix[0].xyz);
  float speed = 0.5 + fract(at.x * 37.0) * 0.9;
  float y = mod(at.y + uTime * speed + 1.0, 2.0) - 1.0;
  vec4 mv = modelViewMatrix * vec4(at.x + sin(uTime * 2.0 + at.z * 9.0) * 0.02, y, at.z, 1.0);
  mv.xy += position.xy * size;
  vUv = uv;
  vA = uBurst * smoothstep(1.0, 0.7, abs(y));
  gl_Position = projectionMatrix * mv;
}`;

const BUBBLE_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vA;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float rim = smoothstep(0.62, 0.92, d) * (1.0 - smoothstep(0.92, 1.0, d));
  float glint = smoothstep(0.28, 0.0, length(vUv - vec2(0.36, 0.64)));
  gl_FragColor = vec4(vec3(0.52, 0.8, 0.78) * (rim * 0.6 + glint * 0.9) * vA, 1.0);
}`;

/** Wallpaper that has been under water before: dark at the waterline, old tide marks higher up, runs of damp. White changes nothing. */
function dampTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const c = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  const random = randomFrom(29);
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, w, h);
  const rising = c.createLinearGradient(0, h, 0, 0);
  rising.addColorStop(0, 'rgba(12,16,14,0.95)');
  rising.addColorStop(0.1, 'rgba(26,32,28,0.8)');
  rising.addColorStop(0.45, 'rgba(70,76,70,0.3)');
  rising.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = rising;
  c.fillRect(0, 0, w, h);
  for (const [at, strength] of [[0.64, 0.5], [0.42, 0.34], [0.22, 0.24]] as const) {
    c.strokeStyle = `rgba(22,20,14,${strength})`;
    c.lineWidth = 3;
    c.beginPath();
    for (let x = 0; x <= w; x += 12) {
      const y = h * at + Math.sin(x * 0.012) * 7 + Math.sin(x * 0.041 + 1) * 3;
      if (x === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  }
  for (let i = 0; i < 150; i++) {
    const x = random() * w;
    const from = h * (0.05 + random() * 0.55);
    c.fillStyle = `rgba(20,24,20,${0.05 + random() * 0.14})`;
    c.fillRect(x, from, 1 + random() * 5, h * (0.1 + random() * 0.4));
  }
  for (let i = 0; i < 40; i++) {
    const bloom = c.createRadialGradient(0, 0, 2, 0, 0, 30 + random() * 80);
    bloom.addColorStop(0, `rgba(16,20,16,${0.08 + random() * 0.16})`);
    bloom.addColorStop(1, 'rgba(16,20,16,0)');
    c.setTransform(1, 0, 0, 0.6, random() * w, h * (0.25 + random() * 0.7));
    c.fillStyle = bloom;
    c.fillRect(-120, -120, 240, 240);
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** The photograph that floats by: a table, three at it, and their faces scratched away with something sharp. */
function drawPhotograph(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(41);
  const wall = c.createLinearGradient(0, 0, 0, h);
  wall.addColorStop(0, '#5d5345');
  wall.addColorStop(1, '#a79a81');
  c.fillStyle = wall;
  c.fillRect(0, 0, w, h);
  const glow = c.createRadialGradient(w * 0.5, h * 0.22, 3, w * 0.5, h * 0.22, w * 0.6);
  glow.addColorStop(0, 'rgba(246,230,194,0.9)');
  glow.addColorStop(1, 'rgba(246,230,194,0)');
  c.fillStyle = glow;
  c.fillRect(0, 0, w, h);
  const heads = [0.25, 0.5, 0.75];
  c.fillStyle = '#1f1a15';
  for (const x of heads) {
    c.beginPath();
    c.ellipse(w * x, h * 0.41, w * 0.058, h * 0.062, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(w * (x - 0.13), h * 0.72);
    c.quadraticCurveTo(w * (x - 0.1), h * 0.48, w * x, h * 0.47);
    c.quadraticCurveTo(w * (x + 0.1), h * 0.48, w * (x + 0.13), h * 0.72);
    c.fill();
  }
  c.fillStyle = '#dad1be';
  c.fillRect(w * 0.08, h * 0.68, w * 0.84, h * 0.11);
  c.fillStyle = '#29221c';
  c.fillRect(w * 0.13, h * 0.79, w * 0.03, h * 0.21);
  c.fillRect(w * 0.84, h * 0.79, w * 0.03, h * 0.21);
  c.strokeStyle = 'rgba(242,238,228,0.9)';
  for (const x of heads) {
    for (let n = 0; n < 34; n++) {
      c.lineWidth = 0.6 + random() * 1.8;
      c.beginPath();
      const bx = w * (x + (random() - 0.5) * 0.14);
      const by = h * (0.41 + (random() - 0.5) * 0.15);
      c.moveTo(bx, by);
      c.lineTo(bx + (random() - 0.5) * w * 0.12, by + (random() - 0.5) * h * 0.12);
      c.stroke();
    }
  }
  const vignette = c.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.72);
  vignette.addColorStop(0, 'rgba(10,8,6,0)');
  vignette.addColorStop(1, 'rgba(10,8,6,0.7)');
  c.fillStyle = vignette;
  c.fillRect(0, 0, w, h);
}

interface Drifter {
  node: Object3D;
  at: V3;
  vx: number;
  vz: number;
  /** Euler angles (rad) at time 0, and how fast they change (rad/s). */
  turn: V3;
  spin: V3;
  bob: number;
}

/**
 * The house filling. You stand at the top of the stairs and they go down into black water at the seventh step; under
 * it every lamp in the hall is still on. You go down a step at a time. Chairs float by. Snakes cross, all one way, up
 * past you, and take no notice. At the waterline the mirror opens and the picture is half air and half water, and the
 * family is at the table under the lamp, hair standing straight up. The surface closes and you go on sinking past them.
 */
export default class Flood extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: AIR.fog, density: AIR.density },
    env: 'bathroom',
    envIntensity: 0.05,
    sky: 0,
    grade: { exposure: AIR.exposure, saturation: AIR.saturation, warmth: AIR.warmth, tint: AIR.tint, flare: 0.002 },
  };
  film = { bloom: 0.9, bloomFrom: 0.62, grain: 0.42, scratches: 0.08, flicker: 0.02, weave: 0.0004 };
  focus = 4.6;
  aperture = APERTURE;

  private readonly sheet: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly time = { value: 0 };
  private readonly clear = { value: 0 };
  private readonly below = { value: 0 };
  private readonly swell = { value: 0 };
  private readonly ring = { value: 0 };
  private readonly ringAge = { value: 9 };
  private readonly eye = { value: new Vector3() };
  private readonly fogColor = { value: new Color(AIR.fog) };
  private readonly fogDensity = { value: AIR.density };
  private readonly lampPower = { value: LAMP_GLOWS.map((l) => l.power) };
  private readonly burst = { value: 0 };
  private readonly path: RoomPose = { position: new Vector3(), yaw: 0, pitch: 0, roll: 0, fov: 54 };
  private readonly fearTrack = trackOf(FEAR);
  private readonly focusTrack = trackOf(FOCUS);
  private readonly clocks: { value: number }[] = [];
  private readonly drifters: Drifter[] = [];
  private readonly crossing: Snakes;
  private readonly atLens: Snakes;
  private readonly pendant;
  private readonly side;
  private readonly landing;
  private readonly bulbLight;
  private readonly fan;
  private readonly fromWater;
  private readonly lensFill;
  private readonly bubbles: InstancedMesh;
  private readonly halos = new Group();
  private readonly shades: { material: MeshStandardMaterial; strength: number }[] = [];
  private slop: RoomVoice | null = null;
  private cellar: RoomVoice | null = null;
  private drone: RoomVoice | null = null;
  private wade: RoomVoice | null = null;
  private swarm: RoomVoice | null = null;

  constructor(ctx: RoomContext) {
    super(ctx);
    this.keys = this.way();
    this.fear = FEAR[0][1];

    this.buildShell();
    this.buildStairs();
    this.buildLanding();
    this.buildFarWall();
    this.buildDrowned();
    this.buildDrift();

    const b = this.build;
    this.pendant = this.light([0, PENDANT_Y - 0.12, TABLE_Z], PALETTE.warm, PENDANT_LIGHT, 9);
    this.side = this.light([SIDE_LAMP[0], 1.05, SIDE_LAMP[1]], PALETTE.warm, SIDE_LIGHT, 6);
    this.landing = this.light([-1.35, TOP + 1.12, 2.15], PALETTE.warm, LANDING_LIGHT, 6.5);
    this.bulbLight = this.light(BULB_AT, PALETTE.warm, BULB_LIGHT, 6.5);
    this.fan = this.light([0, 3.7, FAR_Z + 0.9], 0xbcd4dc, FAN_LIGHT, 13);
    this.fromWater = this.light([0.25, WATER + 0.55, -6.4], 0x9fd0c8, WATER_LIGHT, 8);
    this.lensFill = this.light([-0.1, WATER + 0.32, -4.1], 0xd6e6de, 0, 1.5);
    this.spots = [this.spot([0, PENDANT_Y - 0.05, TABLE_Z], [0, 0, TABLE_Z], PALETTE.warm, PENDANT_SPOT, 68, 0.75), null, null];

    b.glow(-1.35, TOP + 1.12, 2.15, 1.4, PALETTE.warm, 0.45, this.root);
    const dustAbove = b.motes(70, { x: [-HALF_W, HALF_W], y: [WATER + 0.06, HALL_H - 0.4], z: [FAR_Z, BACK_Z] }, this.root, { seed: 12 });
    dustAbove.points.renderOrder = 3;
    this.clocks.push(dustAbove.time);
    const silt = b.motes(170, { x: [-HALF_W, HALF_W], y: [0.1, WATER - 0.05], z: [FAR_Z, 1] }, this.root, { size: 0.012, color: 0x9fd6c8, strength: 0.4, seed: 13 });
    silt.points.renderOrder = 1;
    this.clocks.push(silt.time);

    // the snakes
    this.crossing = new Snakes(FLOW, { seed: 3 });
    this.placeSwimmers();
    this.root.add(this.crossing.root);
    this.atLens = new Snakes(1, { seed: 6 });
    this.atLens.place(0, { at: [0, WATER, -6], heading: 0, way: 'swim', length: 1.15, girth: 0.017, swing: 0.4 });
    this.atLens.root.visible = false;
    this.root.add(this.atLens.root);

    // the water last: it draws over all that lies under it
    const material = new ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: {
        uTime: this.time,
        uClear: this.clear,
        uUnder: this.below,
        uSwell: this.swell,
        uRing: this.ring,
        uRingAge: this.ringAge,
        uEye: this.eye,
        uFog: this.fogColor,
        uFogDensity: this.fogDensity,
        uOrigin: { value: this.origin.clone() },
        uTile: { value: this.tile },
        uLampAt: { value: LAMP_GLOWS.map((l) => new Vector3(l.at[0], l.at[1], l.at[2])) },
        uLampPower: this.lampPower,
      },
      transparent: true,
      depthWrite: true,
      side: DoubleSide,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
    });
    this.sheet = new Mesh(sheetGeometry(), material);
    this.sheet.position.y = WATER;
    this.sheet.frustumCulled = false;
    this.sheet.renderOrder = 2;
    this.root.add(this.sheet);

    this.bubbles = this.buildBubbles();
    this.score();
  }

  /** A shade or bulb that breathes with the lamps. */
  private keepShade(material: MeshStandardMaterial, strength: number): void {
    material.emissiveIntensity = strength;
    this.shades.push({ material, strength });
  }

  private readonly tile = waterTile();

  /** The eye's way: a step at a time, then along the water, then under it. */
  private way(): RoomKey[] {
    const keys: RoomKey[] = [];
    const add = (seconds: number, x: number, y: number, z: number, roll: number) =>
      keys.push({ t: seconds / this.seconds, at: [x, y, z], yaw: lookup(LOOK, seconds, 1), pitch: lookup(LOOK, seconds, 2), fov: lookup(LOOK, seconds, 3), roll });
    const yAt = (k: number) => TOP - k * RISE + EYE_H;
    const zAt = (k: number) => (k === 0 ? 0.2 : -(k - 0.35) * RUN);
    const xAt = (k: number) => (k < 12 ? EYE_WALL_X : EYE_XS[k - 12]);
    add(0, xAt(0), yAt(0), zAt(0), 0);
    STEP_AT.forEach((at, i) => {
      const k = i + 1;
      const takes = STEP_TAKES + Math.max(0, k - 7) * STEP_TAKES_DEEP;
      const sway = (k % 2 === 0 ? 1 : -1) * STEP_ROLL;
      add(at - takes, xAt(k - 1), yAt(k - 1), zAt(k - 1), -sway * 0.5);
      add(at, xAt(k), yAt(k), zAt(k), sway);
    });
    for (const [seconds, x, y, z] of GLIDE) add(seconds, x, y, z, 0);
    return keys;
  }

  private buildShell(): void {
    const b = this.build;
    const shell = new Group();
    shell.position.z = BACK_Z;
    this.root.add(shell);
    b.box(HALF_W * 2, BACK_Z - FAR_Z, HALL_H, { walls: b.damask(PALETTE.damaskTeal), floor: b.checker(0.5), ceiling: b.paint(0x14181a) }, shell);

    const velvet = this.kit.surface('velvet_red', 0.3, { color: new Color(0x2a3a3a), roughness: 0.95 });
    this.curtain(-HALF_W + 0.12, FAR_Z + 0.35, FOOT_Z - 0.2, 1, velvet);
    this.curtain(HALF_W - 0.12, FAR_Z + 0.35, -2.2, -1, velvet);

    // the light the water throws (on the floor under the water, up the walls above it) and the damp it has left
    const damp = { value: dampTexture() };
    const overlay = (u: V3, v: V3, fall: number, tint: number, isDamp: boolean) =>
      new ShaderMaterial({
        vertexShader: LIGHT_VERT,
        fragmentShader: LIGHT_FRAG,
        uniforms: {
          uTime: this.time,
          uFall: { value: fall },
          uIsDamp: { value: isDamp ? 1 : 0 },
          uDamp: damp,
          uTint: { value: new Color(tint).multiplyScalar(0.5) },
          uU: { value: new Vector3(u[0], u[1], u[2]) },
          uV: { value: new Vector3(v[0], v[1], v[2]) },
          uLampAt: { value: [new Vector3(0, 0, TABLE_Z), new Vector3(SIDE_LAMP[0], 0, SIDE_LAMP[1])] },
          uTile: { value: this.tile },
        },
        transparent: true,
        depthWrite: false,
        blending: isDamp ? MultiplyBlending : AdditiveBlending,
        premultipliedAlpha: true,
      });
    const onWall = (material: ShaderMaterial, length: number, height: number, x: number, z: number, y: number, turn: number) => {
      const m = new Mesh(new PlaneGeometry(length, height), material);
      m.position.set(x, y, z);
      m.rotation.y = turn;
      m.renderOrder = 1;
      this.root.add(m);
    };
    const midZ = (BACK_Z + FAR_Z) / 2;
    const along = BACK_Z - FAR_Z;
    const across = HALF_W * 2;
    const damped = (u: V3) => overlay(u, [0, 1 / DAMP_H, 0], (WATER - 0.05) / DAMP_H, 0xffffff, true);
    const climbing = (u: V3) => overlay(u, [0, 0.28, 0], 1.15, 0x8fdccb, false);
    const dampY = WATER + DAMP_H / 2 - 0.05;
    onWall(damped([0, 0, 0.25]), along, DAMP_H, -HALF_W + 0.006, midZ, dampY, Math.PI / 2);
    onWall(damped([0, 0, 0.25]), along, DAMP_H, HALF_W - 0.006, midZ, dampY, -Math.PI / 2);
    onWall(damped([0.25, 0, 0]), across, DAMP_H, 0, FAR_Z + 0.006, dampY, 0);
    onWall(damped([0.25, 0, 0]), across, DAMP_H, 0, BACK_Z - 0.006, dampY, Math.PI);
    onWall(climbing([0, 0, 0.55]), along, 3.4, -HALF_W + 0.012, midZ, WATER + 1.7, Math.PI / 2);
    onWall(climbing([0, 0, 0.55]), along, 3.4, HALF_W - 0.012, midZ, WATER + 1.7, -Math.PI / 2);
    onWall(climbing([0.55, 0, 0]), across, 3.4, 0, FAR_Z + 0.012, WATER + 1.7, 0);
    const floor = new Mesh(new PlaneGeometry(across, along), overlay([0.6, 0, 0], [0, 0, 0.6], 0, 0x7a5a38, false));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.012, midZ);
    floor.renderOrder = 1;
    this.root.add(floor);
  }

  /** Heavy curtains down the long walls and into the water: what crosses comes out from under them, and goes in. */
  private curtain(x: number, z0: number, z1: number, facing: number, material: Material): void {
    const length = z1 - z0;
    const g = new PlaneGeometry(length, HALL_H, Math.ceil(length * 24), 4);
    const p = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i);
      p.setZ(i, Math.sin(u * 10.5 + Math.sin(u * 2.3) * 1.5) * 0.05 + Math.sin(u * 3.7 + 1.2) * 0.025);
      uv.setXY(i, u, p.getY(i));
    }
    g.computeVertexNormals();
    const m = new Mesh(g, material);
    m.position.set(x, HALL_H / 2, (z0 + z1) / 2);
    m.rotation.y = (facing * Math.PI) / 2;
    m.receiveShadow = true;
    this.root.add(m);
  }

  private buildStairs(): void {
    const b = this.build;
    const kit = this.kit;
    const midX = (-HALF_W + STAIR_IN) / 2;
    const width = STAIR_IN + HALF_W;
    const length = Math.hypot(RUN, RISE) * STEPS;
    const midZ = FOOT_Z / 2;
    const line = (z: number) => TOP + z * SLOPE;

    const dry: BufferGeometry[] = [];
    const wet: BufferGeometry[] = [];
    const risers: BufferGeometry[] = [];
    const runner: BufferGeometry[] = [];
    const rods: BufferGeometry[] = [];
    const runnerW = 0.72;
    for (let k = 0; k < STEPS; k++) {
      const front = -k * RUN;
      const y = TOP - k * RISE;
      risers.push(slab(width, RISE, 0.02, midX, y - RISE / 2, front));
      runner.push(slab(runnerW, RISE, 0.008, midX, y - RISE / 2, front - 0.012));
      if (k === 0) continue;
      (k < 5 ? dry : wet).push(slab(width, 0.04, RUN + 0.035, midX, y - 0.02, front + RUN / 2 - 0.015));
      runner.push(slab(runnerW, 0.008, RUN, midX, y + 0.004, front + RUN / 2));
      rods.push(new CylinderGeometry(0.006, 0.006, runnerW + 0.1, 6).rotateZ(Math.PI / 2).translate(midX, y + 0.016, front + RUN - 0.022));
    }
    const addMerged = (parts: BufferGeometry[], material: Material, cast = false) => {
      const m = new Mesh(mergeGeometries(parts)!, material);
      m.receiveShadow = true;
      m.castShadow = cast;
      m.frustumCulled = false;
      this.root.add(m);
    };
    addMerged(dry, kit.surface('wood_stair', 1.2, { color: new Color(0xd8c4b0) }));
    addMerged(wet, kit.surface('wood_stair', 1.2, { color: new Color(0x8a7a70), roughness: 0.2 }));
    addMerged(risers, b.paint(0x3a342c));
    addMerged(runner, b.carpet('#472a2a', 0.5));
    addMerged(rods, new MeshStandardMaterial({ color: 0x8a6a32, roughness: 0.35, metalness: 1 }));

    // the sides and underside of the flight, the panelling that climbs the wall with it
    const wood = b.wood(1.2);
    const boards: BufferGeometry[] = [
      raked(0.05, 0.32, length, STAIR_IN + 0.025, line(midZ) - 0.12, midZ),
      raked(0.03, 0.22, length, -HALF_W + 0.018, line(midZ) + 0.05, midZ),
      raked(0.05, 0.055, length, -HALF_W + 0.03, line(midZ) + 1.06, midZ),
      slab(0.13, 1.32, 0.13, RAIL_X, 0.66, FOOT_Z + 0.04),
      slab(0.12, 1.16, 0.12, RAIL_X, TOP + 0.58, 0.03),
    ];
    for (let z = -0.3; z > FOOT_Z; z -= 0.56) boards.push(slab(0.02, 1.05, 0.07, -HALF_W + 0.018, line(z) + 0.525, z));
    addMerged(boards, wood, true);
    const soffit = new Mesh(raked(width, 0.03, length, midX, line(midZ) - 0.36, midZ), b.paint(0x1d1b19));
    soffit.frustumCulled = false;
    this.root.add(soffit);

    const panel = new BufferGeometry();
    const zFar = FOOT_Z - 0.1;
    const panelX = -HALF_W + 0.012;
    panel.setAttribute('position', new Float32BufferAttribute([panelX, line(0), 0, panelX, line(zFar), zFar, panelX, line(0) + 1.05, 0, panelX, line(zFar) + 1.05, zFar], 3));
    panel.setAttribute('uv', new Float32BufferAttribute([0, line(0), zFar, line(zFar), 0, line(0) + 1.05, zFar, line(zFar) + 1.05], 2));
    panel.setIndex([0, 1, 3, 0, 3, 2]);
    panel.computeVertexNormals();
    const panelMesh = new Mesh(panel, wood);
    panelMesh.receiveShadow = true;
    panelMesh.frustumCulled = false;
    this.root.add(panelMesh);

    // the banister
    const n = (STEPS - 1) * 2 + 20;
    const balusters = kit.props('baluster_turned', n);
    const m = new Matrix4();
    const at = new Vector3();
    const size = new Vector3();
    const still = new Quaternion();
    let i = 0;
    const stand = (x: number, y: number, z: number, height: number) => {
      at.set(x, y, z);
      size.set(0.3, height / 0.86, 0.3);
      balusters.setMatrix(i++, m.compose(at, still, size));
    };
    for (let k = 1; k < STEPS; k++) {
      const y = TOP - k * RISE;
      for (const share of [0.25, 0.75]) {
        const z = -(k - 1 + share) * RUN;
        stand(RAIL_X, y, z, line(z) + RAIL_H - y);
      }
    }
    const gallery = 20;
    for (let g = 0; g < gallery; g++) stand(RAIL_X + 0.17 + (g * (HALF_W - RAIL_X - 0.28)) / (gallery - 1), TOP, 0.03, 0.95);
    balusters.commit();
    kit.paint(balusters.root, wood);
    this.root.add(balusters.root);

    const lengthRail = (FOOT_Z - 0.04) / -Math.cos(SLOPE_ANGLE);
    const railed = kit.prop('handrail', [0, 0, 0], {}, this.root);
    kit.paint(railed, wood);
    railed.scale.set(lengthRail / 0.5, 1.6, 1.6);
    const s = Math.sin(SLOPE_ANGLE);
    const c = Math.cos(SLOPE_ANGLE);
    railed.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(0, s, c), new Vector3(0, c, -s), new Vector3(-1, 0, 0)));
    railed.position.set(RAIL_X, line((FOOT_Z + 0.04) / 2) + RAIL_H, (FOOT_Z + 0.04) / 2);
    const across = kit.prop('handrail', [(RAIL_X + HALF_W) / 2, TOP + 0.95, 0.03], {}, this.root);
    kit.paint(across, wood);
    across.scale.set((HALF_W - RAIL_X) / 0.5, 1.6, 1.6);
    const capUp = kit.prop('newel_cap', [RAIL_X, TOP + 1.16, 0.03], { scale: 1.7 }, this.root);
    kit.paint(capUp, wood);
    const capDown = kit.prop('newel_cap', [RAIL_X, 1.32, FOOT_Z + 0.04], { scale: 1.7 }, this.root);
    kit.paint(capDown, wood);

    // the pictures that go down the stairs with you: one askew, the lowest already wet
    const wallX = -HALF_W + 0.05;
    kit.prop('frame_gold', [wallX, 3.28, -1.78], { rotation: [0, 90, 7.5] }, this.root);
    kit.prop('frame_gold', [wallX, 3.98, -0.62], { rotation: [0, 90, -1.5], scale: 0.62 }, this.root);
    kit.prop('frame_gold', [wallX, 1.66, -4.05], { rotation: [0, 90, -4], scale: 0.8 }, this.root);
  }

  private buildLanding(): void {
    const b = this.build;
    const upstairs = new Group();
    upstairs.position.y = TOP;
    this.root.add(upstairs);
    const boards = this.kit.floor(-HALF_W, HALF_W, 0, BACK_Z, 0, this.kit.surface('wood_floor_dark', 2, { color: new Color(0xa89a8a) }));
    upstairs.add(boards);
    const under = this.kit.wall(HALF_W * 2, BACK_Z, b.paint(0x1a1d1c));
    under.rotation.x = Math.PI / 2;
    under.position.set(0, TOP - 0.24, BACK_Z / 2);
    this.root.add(under);
    const fascia = new Mesh(slab(HALF_W * 2 - 1.2 + 0.05, 0.24, 0.04, (STAIR_IN + HALF_W) / 2, TOP - 0.12, 0.02), b.wood(1.2));
    fascia.frustumCulled = false;
    this.root.add(fascia);

    b.wainscot(-HALF_W, BACK_Z / 2, BACK_Z, '+x', upstairs);
    b.wainscot(HALF_W, BACK_Z / 2, BACK_Z, '-x', upstairs);
    b.wainscot(-1.15, BACK_Z, 2.3, '-z', upstairs);
    b.wainscot(1.7, BACK_Z, 1.2, '-z', upstairs);
    b.door(0.55, BACK_Z, '-z', upstairs, { open: 0.16, beyond: 0x030304 });
    const table = b.lampTable(-1.35, 2.15, upstairs, Math.PI);
    this.keepShade(table.shade, 1.6);
    b.contactShadow(-1.35, 2.15, 0.6, upstairs, 0.7);

    const cord = new Mesh(new CylinderGeometry(0.004, 0.004, HALL_H - BULB_AT[1], 5), new MeshStandardMaterial({ color: 0x0c0b0a, roughness: 0.8 }));
    cord.position.set(BULB_AT[0], (HALL_H + BULB_AT[1]) / 2, BULB_AT[2]);
    cord.frustumCulled = false;
    this.root.add(cord);
    const bulbMaterial = new MeshStandardMaterial({ color: 0x20160c, emissive: new Color(0xffe2b4) });
    this.keepShade(bulbMaterial, 6);
    const bulb = new Mesh(new SphereGeometry(0.04, 12, 8), bulbMaterial);
    bulb.position.set(BULB_AT[0], BULB_AT[1], BULB_AT[2]);
    this.root.add(bulb);
    b.glow(BULB_AT[0], BULB_AT[1], BULB_AT[2], 0.9, PALETTE.warm, 0.4, this.root);
  }

  private buildFarWall(): void {
    const b = this.build;
    b.wainscot(-1.525, FAR_Z, 1.55, '+z', this.root);
    b.wainscot(1.525, FAR_Z, 1.55, '+z', this.root);
    b.door(0, FAR_Z, '+z', this.root, { width: 1.25, height: 3.5, open: 1, beyond: 0x000000, color: 0x1c1712 });
    const pane = new MeshStandardMaterial({ color: 0x0a0f10, emissive: new Color(0xb6d0d8), emissiveIntensity: 1.1 });
    const fan = new Mesh(new CircleGeometry(0.66, 36, 0, Math.PI), pane);
    fan.position.set(0, 3.62, FAR_Z + 0.02);
    this.root.add(fan);
    const bars: BufferGeometry[] = [new TorusGeometry(0.22, 0.012, 6, 20, Math.PI), new TorusGeometry(0.69, 0.045, 8, 36, Math.PI)];
    for (let a = 1; a < 6; a++) bars.push(slab(0.025, 0.66, 0.02, 0, 0.33, 0).rotateZ(Math.PI / 2 - (a * Math.PI) / 6));
    const framing = new Mesh(mergeGeometries(bars.map((g) => g.translate(0, 3.62, FAR_Z + 0.03)))!, b.wood(1.2));
    framing.frustumCulled = false;
    this.root.add(framing);

    for (const x of [-1.3, 1.3]) {
      const bulb = new MeshStandardMaterial({ color: 0x20160c, emissive: new Color(PALETTE.warm) });
      const glass = new Mesh(new SphereGeometry(0.06, 12, 8), bulb);
      glass.position.set(x, SCONCE_Y, FAR_Z + 0.2);
      this.keepShade(bulb, 5);
      this.root.add(glass);
      const arm = new Mesh(slab(0.03, 0.2, 0.18, x, SCONCE_Y - 0.12, FAR_Z + 0.1), b.wood(1.2));
      arm.frustumCulled = false;
      this.root.add(arm);
    }
  }

  private buildDrowned(): void {
    const b = this.build;
    const kit = this.kit;
    kit.prop('dining_table', [0, 0, TABLE_Z], { castShadow: true }, this.root);
    const rug = kit.floor(-1.9, 1.9, TABLE_Z - 1.55, TABLE_Z + 1.55, 0.008, b.carpet('#2a1416', 0.7));
    rug.receiveShadow = true;
    this.root.add(rug);
    b.contactShadow(0, TABLE_Z, 1.7, this.root, 0.8, 0.014);

    const top = 0.88;
    const places: readonly (readonly [number, number])[] = [
      [-0.74, TABLE_Z - 0.42],
      [0, TABLE_Z - 0.42],
      [0.74, TABLE_Z - 0.42],
      [-0.1, TABLE_Z + 0.42],
    ];
    const plates = kit.props('plate', places.length);
    const forks = kit.props('fork', places.length, { rotation: [90, 0, 0] });
    const knives = kit.props('knife', places.length, { rotation: [90, 0, 0] });
    places.forEach(([x, z], i) => {
      plates.set(i, x, top, z, 0, 1);
      forks.set(i, x - 0.17, top, z, 0, 1);
      knives.set(i, x + 0.17, top, z, 0, 1);
    });
    for (const crowd of [plates, forks, knives]) {
      crowd.commit();
      this.root.add(crowd.root);
    }

    // the empty place: pushed back and turned, as it was left
    kit.prop('chair_ladder', [-0.62, 0, TABLE_Z + 0.98], { rotation: [0, 158, 0], castShadow: true }, this.root);
    b.contactShadow(-0.62, TABLE_Z + 0.98, 0.42, this.root, 0.7, 0.014);

    const sit = 'm_sit_chair_idle_roll_head';
    const people: { x: number; spec: FigureSpec; headless: boolean; hair: number; seed: number }[] = [
      { x: -0.74, spec: { avatar: 'figure_woman', clip: sit, time: 4.2, face: 'scratched', bleach: 0.5, tint: 0x6e6c68 }, headless: false, hair: 190, seed: 71 },
      { x: 0, spec: { avatar: 'figure_man', clip: sit, time: 3 }, headless: true, hair: 0, seed: 72 },
      { x: 0.74, spec: { avatar: 'figure_man', clip: sit, time: 2, face: 'scratched', bleach: 0.45, tint: 0x5f646c }, headless: false, hair: 170, seed: 73 },
    ];
    const hips = new Vector3();
    const head = new Vector3();
    const neck = new Vector3();
    for (const person of people) {
      const chairZ = TABLE_Z - 0.95;
      kit.prop('chair_ladder', [person.x, 0, chairZ], { castShadow: true }, this.root);
      const probe = kit.figures.hero(person.spec);
      probe.update(person.spec.time ?? 0);
      probe.root.updateMatrixWorld(true);
      probe.bone('Bip01')!.getWorldPosition(hips);
      probe.bone('Bip01_Head')!.getWorldPosition(head);
      probe.bone('Bip01_Neck')!.getWorldPosition(neck);
      const crowd = person.headless ? b.headless(1, { ...person.spec, cutAt: neck.y + 0.02, tint: 0x565c66, bleach: 0.3 }) : kit.figures.crowd(person.spec, 1);
      const x = person.x - hips.x;
      const z = chairZ - hips.z + 0.04;
      crowd.set(0, x, 0, z, 0);
      crowd.commit();
      this.root.add(crowd.root);
      if (person.headless) {
        // an empty collar, dark inside: the man who stayed, not a wound
        const stump = new Mesh(new SphereGeometry(0.075, 10, 8), new MeshStandardMaterial({ color: 0x050505, roughness: 0.9 }));
        stump.position.set(x + neck.x, neck.y + 0.015, z + neck.z);
        stump.scale.y = 0.35;
        this.root.add(stump);
      }
      if (person.hair > 0) {
        const root = head.y + 0.12;
        const cx = x + head.x;
        const cz = z + head.z;
        const hair = b.hair(person.hair, { x: [cx - 0.085, cx + 0.085], y: root, z: [cz - 0.09, cz + 0.09] }, [WATER - root - 0.24, WATER - root - 0.015], this.root, { width: 0.0016, seed: person.seed, sway: 0.03, color: 0x6e6c64 });
        // it has been rising for years: it spreads a little, and each strand wanders on its own
        const strands = hair.mesh.geometry.getAttribute('position');
        const hairAt = hair.mesh.geometry.getAttribute('hairAt');
        for (let v = 0; v < strands.count; v++) {
          const up = hairAt.getX(v);
          const phase = hairAt.getY(v);
          strands.setX(v, strands.getX(v) + (strands.getX(v) - cx) * up * HAIR_FAN + Math.sin(up * 7 + phase) * 0.012 * up);
          strands.setZ(v, strands.getZ(v) + (strands.getZ(v) - cz) * up * HAIR_FAN + Math.cos(up * 6 + phase * 1.3) * 0.012 * up);
        }
        hair.mesh.scale.y = -1;
        hair.mesh.position.y = 2 * root;
        this.clocks.push(hair.time);
      }
    }

    // the lamp over the table, on its chain from far above the water
    const chain = new Mesh(new CylinderGeometry(0.006, 0.006, HALL_H - PENDANT_Y, 6), new MeshStandardMaterial({ color: 0x40321c, roughness: 0.5, metalness: 0.9, emissive: new Color(0x2a1c0e), emissiveIntensity: 0.4 }));
    chain.position.set(0, (HALL_H + PENDANT_Y) / 2, TABLE_Z);
    chain.frustumCulled = false;
    this.root.add(chain);
    const shadeMaterial = new MeshStandardMaterial({ color: 0xd8b98c, roughness: 0.8, emissive: new Color(PALETTE.warm) });
    this.keepShade(shadeMaterial, 1.5);
    const shade = new Mesh(new LatheGeometry([new Vector2(0.3, 0), new Vector2(0.285, 0.04), new Vector2(0.22, 0.14), new Vector2(0.16, 0.22), new Vector2(0.125, 0.27)], 36), shadeMaterial);
    shade.position.set(0, PENDANT_Y - 0.16, TABLE_Z);
    this.root.add(shade);
    const bulbMaterial = new MeshStandardMaterial({ color: 0x201810, emissive: new Color(0xfff0d4), emissiveIntensity: 9 });
    const bulb = new Mesh(new SphereGeometry(0.05, 12, 8), bulbMaterial);
    bulb.position.set(0, PENDANT_Y - 0.1, TABLE_Z);
    this.root.add(bulb);

    const side = b.lampTable(SIDE_LAMP[0], SIDE_LAMP[1], this.root, 0.4);
    this.keepShade(side.shade, 1.9);
    b.contactShadow(SIDE_LAMP[0], SIDE_LAMP[1], 0.55, this.root, 0.7, 0.014);

    // once you are under, the lamps have halos of their own; from above the water does it (see WATER_FRAG)
    this.halos.visible = false;
    this.root.add(this.halos);
    b.glow(0, PENDANT_Y - 0.1, TABLE_Z, 3.2, PALETTE.warm, 0.16, this.halos);
    b.glow(SIDE_LAMP[0], 1.05, SIDE_LAMP[1], 2.2, PALETTE.warm, 0.14, this.halos);
    b.glow(-1.3, SCONCE_Y, FAR_Z + 0.22, 1.4, PALETTE.warm, 0.14, this.halos);
    b.glow(1.3, SCONCE_Y, FAR_Z + 0.22, 1.4, PALETTE.warm, 0.14, this.halos);
  }

  /** What the water has lifted and is carrying, all slowly the same way. Written as where each is at 8 s. */
  private buildDrift(): void {
    const kit = this.kit;
    const toRad = Math.PI / 180;
    const add = (node: Object3D, at: V3, v: readonly [number, number], turn: V3, spin: V3, bob: number) =>
      this.drifters.push({ node, at, vx: v[0], vz: v[1], turn: [turn[0] * toRad, turn[1] * toRad, turn[2] * toRad], spin: [spin[0] * toRad, spin[1] * toRad, spin[2] * toRad], bob });
    const pale = this.build.paint(0x8d897f);
    const chair = (painted: boolean) => {
      const piece = kit.prop('chair_ladder', [0, 0, 0], { anchor: 'center' }, this.root);
      if (painted) kit.paint(piece, pale);
      return piece;
    };
    add(chair(false), [0.75, WATER - 0.08, -4.0], [0.05, 0.06], [68, 40, 12], [0.9, -1.4, 0.6], 0.4);
    add(chair(true), [1.55, WATER - 0.16, -1.8], [-0.03, -0.02], [-32, 120, 18], [-0.5, 0.9, 0.7], 1.8);
    add(chair(false), [1.2, WATER - 0.14, -7.2], [0.016, 0.045], [62, -50, 20], [0.7, 0.9, -0.4], 3);
    add(chair(false), [-1.55, WATER - 0.95, -7.0], [0.01, 0.02], [-110, 20, 30], [1.2, -0.6, 0.5], 4.4);

    const framed = kit.prop('frame_gold', [0, 0, 0], { nodes: ['fancy_picture_frame_02'], anchor: 'center' }, this.root);
    const photo = this.build.label(0.56, 0.66, drawPhotograph, { px: 400 });
    photo.mesh.position.z = 0.012;
    framed.add(photo.mesh);
    add(framed, [-0.35, WATER + 0.035, -3.1], [0.07, 0.05], [-82, 0, 22], [0.2, 0.3, 1.6], 2.2);

    this.album.pictures.slice(0, PRINTS_ON_WATER).forEach((picture, i) => {
      const print = this.build.print(this.album.texture(picture), 0.3);
      this.root.add(print);
      add(print, [-0.4 + i * 0.75, WATER + 0.01, -4.6 + i * 0.5], [0.04, 0.04], [-90, 0, i * 40 + 12], [0, 0, i % 2 === 0 ? 1.2 : -1.2], i * 1.3);
    });
  }

  private placeSwimmers(): void {
    const first: readonly (readonly [number, number, number, number])[] = [
      [-6.4, -2.75, 15.9, 0.5],
      [-8.3, -4.5, 18.2, 0.6],
      [-9.6, -5.2, 18.9, 0.62],
    ];
    const heading = (dx: number, dz: number, way: number) => Math.atan2(-dx / way, -dz / way);
    const dx = FLOW_X[1] - FLOW_X[0];
    first.forEach(([z0, z1, delay, speed], i) => {
      const dz = z1 - z0;
      this.crossing.place(i, { at: [FLOW_X[0], WATER, z0], heading: heading(dx, dz, Math.hypot(dx, dz)), way: 'swim', speed, length: 1.25 - i * 0.1, girth: 0.0125, delay, loop: 0 });
    });
    const random = randomFrom(47);
    const clear = (z0: number, z1: number) => {
      for (const [px, pz] of EYE_WAY) {
        const ex = FLOW_X[1] - FLOW_X[0];
        const ez = z1 - z0;
        const k = clamp01(((px - FLOW_X[0]) * ex + (pz - z0) * ez) / (ex * ex + ez * ez));
        if (Math.hypot(FLOW_X[0] + ex * k - px, z0 + ez * k - pz) < FLOW_CLEAR) return false;
      }
      return true;
    };
    for (let i = first.length; i < FLOW; i++) {
      let z0 = FLOW_Z[0];
      let z1 = -5.2;
      for (let tries = 0; tries < 40; tries++) {
        z0 = FLOW_Z[0] + random() * (FLOW_Z[1] - FLOW_Z[0]);
        z1 = -5.2 + (z0 - FLOW_Z[0]) * 0.5 + (random() - 0.5) * 0.7;
        if (clear(z0, z1)) break;
      }
      const dz = z1 - z0;
      const way = Math.hypot(dx, dz);
      const length = 1 + random() * 0.7;
      const girth = 0.009 + random() * 0.005;
      const share = (i - first.length) / (FLOW - first.length - 1);
      this.crossing.place(i, { at: [FLOW_X[0], WATER, z0], heading: heading(dx, dz, way), way: 'swim', speed: 0.7 + random() * 0.32, length, girth, delay: FLOW_FROM + share * (FLOW_FULL - FLOW_FROM), loop: 0 });
    }
  }

  /** Your own air, on the lens: rising past it in the burst when the surface closes, and when you breathe out. */
  private buildBubbles(): InstancedMesh {
    const material = new ShaderMaterial({
      vertexShader: BUBBLE_VERT,
      fragmentShader: BUBBLE_FRAG,
      uniforms: { uTime: this.time, uBurst: this.burst },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, BUBBLES);
    const random = randomFrom(83);
    const m = new Matrix4();
    for (let i = 0; i < BUBBLES; i++) {
      const size = 0.006 + random() * random() * 0.05;
      m.makeScale(size, size, size);
      m.setPosition((random() - 0.5) * 1.2, (random() - 0.5) * 2, -0.14 - random() * 1.2);
      mesh.setMatrixAt(i, m);
    }
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.visible = false;
    this.lens.add(mesh);
    return mesh;
  }

  private score(): void {
    const s = this.sound;
    this.beat(0, () => {
      this.slop = s.bed('rooms/water_slop_wood.mp3', { gain: 0.09 });
      this.cellar = s.bed('rooms/flooded_cellar.mp3', { gain: 0.06, reverb: 0.2 });
      this.drone = s.bed('rooms/dream_drone_low.mp3', { gain: 0.1 });
    });
    this.beat(3, () => this.say({ tr: 'Ev dolarken kimse kalkmadı.', en: 'No one got up while the house filled.' }, 5));
    this.beat(6, () => {
      this.slop?.gain(0.2, 6);
      this.cellar?.gain(0.1, 6);
    });
    STEP_AT.forEach((at, i) => {
      const k = i + 1;
      this.beat(at - 0.12, () => {
        if (k <= 6) {
          s.play(`rooms/stair_tread_${k}.mp3`, { gain: 0.4, reverb: 0.15, pan: -0.15 });
          if (k % 2 === 1) s.play(`rooms/stair_creak_${k}.mp3`, { gain: 0.26, reverb: 0.15, pan: 0.2 });
        } else {
          s.play(`rooms/wade_step_${((k - 7) % 5) + 1}.mp3`, { gain: Math.max(0.2, 0.42 - (k - 7) * 0.03), reverb: 0.15 });
        }
      });
    });
    this.beat(13.6, () => {
      this.wade = s.bed('rooms/wade_slow.mp3', { gain: 0.3, fade: 5 });
    });
    this.beat(16, () => {
      this.swarm = s.bed('rooms/snakes_on_water.mp3', { gain: 0.35, fade: 7, reverb: 0.2 });
    });
    const touches = [[16.3, -0.7], [17.1, -0.5], [18.3, -0.4], [18.9, 0.1], [19.7, 0.3], [20.4, -0.3], [21, 0.5], [21.6, 0.2], [22.2, -0.1], [22.8, 0.6]] as const;
    touches.forEach(([at, pan], i) => this.beat(at, () => s.play(`rooms/snake_water_${(i % 4) + 1}.mp3`, { gain: 0.3, reverb: 0.25, pan })));
    this.beat(20.3, () => s.play('rooms/snake_hiss_3.mp3', { gain: 0.25, reverb: 0.2, pan: 0.35 }));
    this.beat(21.4, () => s.play('rooms/snake_hiss_2.mp3', { gain: 0.3, reverb: 0.15, pan: -0.4 }));
    this.beat(22, () => s.play('rooms/snake_hiss_close.mp3', { gain: 0.35 }));
    // everything goes out; the shutter falls in the silence
    this.beat(26.4, () => {
      this.slop?.gain(0, 1.5);
      this.cellar?.gain(0, 1.5);
      this.drone?.gain(0, 1.5);
      this.swarm?.gain(0, 1.5);
      this.wade?.gain(0, 1);
    });
    this.beat(30, () => this.shutter());
    this.beat(31.4, () => s.play('rooms/wet_plip_2.mp3', { gain: 0.12, reverb: 0.3 }));
    this.beat(32.1, () => s.play('rooms/breath_in.mp3', { gain: 0.24 }));
    this.beat(CLOSES, () => {
      this.slop?.stop(0.01);
      this.cellar?.stop(0.01);
      this.drone?.stop(0.01);
      this.swarm?.stop(0.01);
      this.wade?.stop(0.01);
      s.play('rooms/surface_close.mp3', { gain: 0.6 });
      s.bed('rooms/underwater_muffled.mp3', { gain: 0.14 });
      s.bed('rooms/bubbles_rising.mp3', { gain: 0.12, lowpass: 3500 });
      s.bed('rooms/dream_drone_metal.mp3', { gain: 0.12, lowpass: 900 });
    });
    this.beat(36, () => s.play('rooms/bubbles_exhale_1.mp3', { gain: 0.35, lowpass: 2600 }));
    this.beat(39, () => s.bed('rooms/cutlery_far.mp3', { gain: 0.14, lowpass: 520, reverb: 0.4, fade: 3 }));
    this.beat(41.5, () => s.play('rooms/bubble_small_1.mp3', { gain: 0.18, lowpass: 1800 }));
    this.beat(43.3, () => s.play('rooms/bubble_small_2.mp3', { gain: 0.14, lowpass: 1800 }));
    this.beat(CUT, () => s.stopAll(0.03));
  }

  prepare(camera: PerspectiveCamera): void {
    this.eye.value.copy(camera.position).sub(this.origin);
    this.sheet.position.x = this.eye.value.x;
    this.sheet.position.z = this.eye.value.z;
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    this.pose(frame.t, this.path);
    const height = this.path.position.y - this.origin.y - WATER;
    const under = s >= CLOSES;
    const looks = under ? DROWNED : AIR;
    const open = under ? 0 : 1 - ease((height - CLEAR_TO) / (CLEAR_FROM - CLEAR_TO));

    this.air.fog.color = looks.fog;
    this.air.fog.density = looks.density;
    this.air.grade.exposure = looks.exposure;
    this.air.grade.saturation = looks.saturation;
    this.air.grade.warmth = looks.warmth;
    this.air.grade.tint = looks.tint;
    this.halos.visible = under;
    this.fogColor.value.set(looks.fog);
    this.fogDensity.value = looks.density;

    const breath = 1 + 0.06 * wobble(s * 0.7, 3);
    this.pendant.intensity = PENDANT_LIGHT * breath;
    this.side.intensity = SIDE_LIGHT * (1 + 0.05 * wobble(s * 0.5, 7));
    this.landing.intensity = LANDING_LIGHT;
    // the higher you leave it behind the less it reaches: the stairwell over the water goes dark
    this.bulbLight.intensity = BULB_LIGHT * (1 + 0.06 * wobble(s * 0.9, 5)) * (1 - 0.82 * ease((s - 13) / 10));
    this.fan.intensity = FAN_LIGHT;
    this.fromWater.intensity = WATER_LIGHT * (1 + 0.14 * wobble(s * 0.4, 11));
    this.lensFill.intensity = LENS_LIGHT * ease((s - LENS.stop + 2) / 2) * (1 - ease((s - LENS.leave) / 2));
    for (let i = 0; i < LAMP_GLOWS.length; i++) this.lampPower.value[i] = LAMP_GLOWS[i].power * breath;
    for (let i = 0; i < this.shades.length; i++) this.shades[i].material.emissiveIntensity = this.shades[i].strength * breath;

    this.time.value = s;
    this.clear.value = open;
    this.below.value = under ? 1 : 0;
    this.swell.value = 0.002 + 0.01 * (1 - ease(height / 1.1));
    this.sheet.material.depthWrite = open < 0.5;
    let since = 9;
    for (let i = 0; i < STEP_AT.length; i++) if (STEP_AT[i] <= s) since = s - STEP_AT[i];
    this.ring.value = s >= STEP_AT[6] && s < HOLD_FROM ? 0.06 : 0;
    this.ringAge.value = since;

    for (let i = 0; i < this.drifters.length; i++) {
      const d = this.drifters[i];
      const k = s - 8;
      d.node.position.set(d.at[0] + d.vx * k, d.at[1] + 0.012 * Math.sin(s * 0.7 + d.bob), d.at[2] + d.vz * k);
      d.node.rotation.set(d.turn[0] + d.spin[0] * s, d.turn[1] + d.spin[1] * s, d.turn[2] + d.spin[2] * s);
    }
    this.crossing.update(s);
    this.atLens.update(s);
    this.moveLensSnake(s);
    for (let i = 0; i < this.clocks.length; i++) this.clocks[i].value = s;

    const breathOut = ease((s - 36.2) / 0.6) * (1 - ease((s - 38.6) / 0.8));
    const close = under ? 1 - clamp01((s - CLOSES) / 1.7) : 0;
    this.burst.value = Math.max(close, 0.45 * breathOut);
    this.bubbles.visible = this.burst.value > 0.002;

    this.fear = this.fearTrack.at(s);
    this.focus = this.focusTrack.at(s);
    this.black = s >= CUT ? 1 : 0;
    this.control.look = s < HOLD_FROM || under;
    this.drift = s >= HOLD_FROM - 0.8 && !under ? 0 : under ? 0.5 : 0.8;
  }

  /** The one that comes straight at you, stops a hand away, looks, and goes round. */
  private moveLensSnake(s: number): void {
    const snake = this.atLens;
    if (s < LENS.from || s >= LENS.gone) {
      snake.root.visible = false;
      return;
    }
    snake.root.visible = true;
    const eyeX = this.path.position.x - this.origin.x;
    const eyeZ = this.path.position.z - this.origin.z;
    const yaw = this.path.yaw;
    const eyeOver = this.path.position.y - this.origin.y - WATER;
    const lift = Math.min(0.11, Math.max(0.02, eyeOver * 0.75));
    if (s < LENS.leave) {
      const u = clamp01((s - LENS.from) / (LENS.stop - LENS.from));
      const left = 1 - u;
      const d = LENS.hand + (LENS.reach - LENS.hand) * left * left * (1 + 2 * u);
      const sideways = 0.28 * left + 0.004 * Math.sin(s * 2.1);
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      snake.pose(0, eyeX + fx * d - fz * sideways, WATER, eyeZ + fz * d + fx * sideways, yaw + Math.PI, LENS.reach - d, 0, lift);
      return;
    }
    const v = ease((s - LENS.leave) / (LENS.gone - LENS.leave));
    const turned = Math.min(1, v * 3);
    const round = v * 2.5;
    const r = LENS.hand + v * 0.5;
    const a = yaw - round;
    snake.pose(0, eyeX - Math.sin(a) * r, WATER, eyeZ - Math.cos(a) * r, yaw + Math.PI + (turned * Math.PI) / 2 - round, LENS.reach - LENS.hand + round * r, 2.4 * turned, lift * (1 - v * 0.4));
  }
}
