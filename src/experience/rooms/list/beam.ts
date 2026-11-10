import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
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
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import { meterUVs } from '../../dream/DreamKit';
import { WARP_GLSL, warpUniforms } from '../../render/Warp';
import type { DreamLight } from '../../dream/LightPool';
import { DEG, lerp, range, smootherstep, wobble } from '../../math';
import type { RoomAir, RoomAssets, RoomContext, RoomControl, RoomFrame, RoomKey, RoomPose } from '../Room';
import { Room } from '../Room';
import { PALETTE } from '../RoomKit';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['chair_white', 'phone_ornate'],
  materials: ['rust_sheet', 'rust_streaked', 'conc_pour_lifts', 'steel_scuffed'],
  sounds: [
    'rooms/wind_high_gusts.mp3',
    'rooms/wind_high_tube.mp3',
    'rooms/wind_high_whistle.mp3',
    'rooms/far_city.mp3',
    'rooms/dream_drone_hollow.mp3',
    'rooms/cable_hum.mp3',
    'rooms/breath_calm.mp3',
    'rooms/breath_in.mp3',
    'rooms/thunder_far_1.mp3',
    'rooms/thunder_far_2.mp3',
    'rooms/thunder_far_3.mp3',
    'rooms/thunder_far_4.mp3',
    'rooms/step_steel_1.mp3',
    'rooms/step_steel_2.mp3',
    'rooms/step_steel_3.mp3',
    'rooms/step_steel_4.mp3',
    'rooms/steel_creak_1.mp3',
    'rooms/steel_creak_2.mp3',
    'rooms/steel_creak_3.mp3',
    'rooms/steel_creak_4.mp3',
    'rooms/steel_creak_5.mp3',
    'rooms/steel_creak_long.mp3',
    'rooms/rust_flake.mp3',
    'rooms/pigeons_below.mp3',
    'rooms/phone_bell_thin.mp3',
    'rooms/phone_pickup_1.mp3',
    'rooms/phone_line_dead.mp3',
    'rooms/phone_line_breath.mp3',
    'rooms/door_far_metal.mp3',
    'rooms/bolt_ping_1.mp3',
    'rooms/bolt_ping_2.mp3',
    'rooms/bolt_ping_3.mp3',
    'rooms/bolt_ping_long.mp3',
    'rooms/cable_twang_1.mp3',
    'rooms/cable_twang_2.mp3',
    'rooms/bolts_fall.mp3',
    'rooms/steel_stress.mp3',
    'rooms/steel_throb_1.mp3',
    'rooms/groan_steel.mp3',
    'rooms/chair_slide_steel.mp3',
    'rooms/gasp_2.mp3',
    'rooms/whoosh_fall.mp3',
    'rooms/fall_wind.mp3',
  ],
};

/** The beam (m): its top's width, the height of its section, the thickness of flange and web. */
const FLANGE = 0.66;
const SECTION = 0.86;
const FLANGE_T = 0.05;
const WEB_T = 0.04;
/** Along the beam from the door (m): where it stops, how far it is gone, where it reaches the other tower. */
const HALF = 21;
const GAP = 10;
const SPAN = HALF * 2 + GAP;
/** Where the eye stands on it (m along) and the two chairs. */
const START = 1.3;
const STOP = 17.9;
const CHAIR_ALONG = HALF - 1.4;
/** How far the chair stands off the middle of the beam (m). */
const CHAIR_X = -0.04;
const FAR_CHAIR_ALONG = HALF + GAP + 1.4;
/** Height of a seat, and how far the wire reaches before it tears (m). */
const SEAT = 0.46;
const WIRE_REACH = 15;

/** Towers (m): the near one's size and door hole, the far one's size, how high they all go, and the rhythm of their floors. */
const NEAR_W = 44;
const NEAR_D = 60;
const HOLE_HALF = 0.5;
const HOLE_H = 2.16;
const HALL = 4.4;
const FAR_W = 24;
const FAR_D = 24;
const TOWER_TOP = 620;
const LEDGE_STEP = 15.6;
/** The towers nobody sees until lightning shows them: center x, center z, width, depth (m). They are only a silhouette in the sky. */
const TOWERS: readonly (readonly [number, number, number, number])[] = [
  [-105, -250, 18, 18],
  [110, -300, 20, 18],
  [-240, -340, 24, 22],
  [212, -290, 26, 24],
  [-46, -520, 30, 30],
  [62, -610, 34, 30],
  [-400, -520, 32, 30],
  [420, -560, 34, 34],
  [-320, -120, 28, 26],
  [330, -70, 30, 28],
  [-280, 130, 30, 28],
  [270, 150, 34, 30],
  [-96, 300, 36, 34],
  [130, 340, 40, 36],
];

/** The storm (m): floor of the cloud deck, how thick it is, the wisps over it, the city under it. */
const DECK = -360;
const DECK_THICK = 80;
const WISPS = -128;
const CITY = -1700;
/** How far below the eye the other beams lie (m): each halved in the same place, each with its chair. */
const LEVELS = [22, 58, 96, 138, 184, 234, 288];

/** Lightning inside the cloud: second, x, z (m), how wide (m), how strong. Never two at once. */
const STRIKES: readonly (readonly [number, number, number, number, number])[] = [
  [6.1, 30, -18, 300, 0.95],
  [14.4, -360, -900, 520, 0.85],
  [23.0, -190, -160, 320, 0.9],
  [31.2, 40, -1050, 620, 1.05],
  [39.6, -40, -560, 480, 0.8],
  [46.5, 0, -1500, 800, 1.15],
  [55.5, 20, -60, 300, 1],
  [60.1, 0, -30, 320, 1.1],
  [63.9, 10, -40, 360, 1.2],
];
/** Lightning: seconds to its peak, seconds it takes to die away. One hit, never a strobe. */
const FLASH_RISE = 0.05;
const FLASH_FALL = 0.5;

/** Seconds: the walk begins, one step, the halt in the gust, when the walk is over. */
const WALK_FROM = 12;
const STEP_TIME = 0.84;
const STEPS_BEFORE = 11;
const HALT_FROM = WALK_FROM + STEPS_BEFORE * STEP_TIME;
const HALT_TO = 24.1;
const STEPS_AFTER = 13;
const WALK_TO = HALT_TO + STEPS_AFTER * STEP_TIME;
const STEPS = STEPS_BEFORE + STEPS_AFTER;
const STRIDE = (STOP - START) / STEPS;
/** Seconds: the phone. */
const RINGS = [35.2, 38.2, 41.2];
const PROMPT_AT = 38;
const ANSWER_BY = 43;
const WIND_DIES = 44.7;
const LINE_CUTS = 47.3;
/** Seconds: the door, how long it takes to shut, and the bolts one by one. */
const DOOR_AT = 48;
const DOOR_TIME = 0.42;
const BOLT_TIMES = [48.6, 49.16, 49.68, 50.16, 50.61, 51.03, 51.42, 51.79, 52.14, 52.48];
/** Seconds: the last bolt lets go, the chair starts to move, the eye slides, the shutter, the fall, the cut. */
const LET_GO = 52.5;
const CHAIR_MOVES = 53.2;
const SLIDE_AT = 58;
const SHUTTER_AT = 60.25;
const FALL_AT = 60.5;
const CUT_AT = 65;

/** Degrees: what one bolt costs, the lurch of the last, the slow tilt after it, and the beam's twist. */
const BOLT_SAG = 0.24;
const LURCH = 1.6;
const TILT = 13;
const TWIST = 5;
/** The chair: how fast it slides (m/s2), how fast it falls (m/s2, slower than a real one, to be watched). */
const CHAIR_SLIDE = 1;
const CHAIR_FALL = 1.6;
/** The eye's fall (m/s2), how long the throw off the beam takes (s), its spin (rad/s), and its roll (rad/s2). */
const FALL_G = 24;
const THROW_TIME = 1.4;
const SPIN = 0.3;
const FALL_ROLL = 0.05;
/** How much of the slow bend and of a step's give goes into space (warp units). */
const SAG = 0.0011;
const GIVE = 0.0007;
const GUST_BEND = 0.0005;

/** Light: fog, its density, exposure; spill from the door, the column on the chair. */
const FOG_DARK = 0x1a2a30;
const FOG_LIT = 0x3b4a66;
const FOG_DENSITY = 0.017;
const FOG_CLEAR = 0.0065;
const EXPOSURE = 1.25;
const SPILL = 130;
const FAR_SPILL = 260;
const COLUMN = 520;
/** How much of the column shows in the air. */
const COLUMN_AIR = 0.05;

/** Flakes: how many at each step and at each bolt, how long one takes to vanish (s). */
const FLAKES_A_STEP = 5;
const FLAKES_A_BOLT = 6;
const FLAKE_LIFE = 32;
/** Pigeons: how many, and when they take off (s). */
const PIGEONS = 26;
const PIGEONS_AT = 22.4;

const WIRE_RINGS = 22;

const STEP_FILES = ['rooms/step_steel_1.mp3', 'rooms/step_steel_2.mp3', 'rooms/step_steel_3.mp3', 'rooms/step_steel_4.mp3'];
const CREAK_FILES = ['rooms/steel_creak_1.mp3', 'rooms/steel_creak_2.mp3', 'rooms/steel_creak_3.mp3', 'rooms/steel_creak_4.mp3', 'rooms/steel_creak_5.mp3'];
const BOLT_FILES = ['rooms/bolt_ping_1.mp3', 'rooms/bolt_ping_2.mp3', 'rooms/bolt_ping_3.mp3'];

const DOWN_LINE = { tr: 'Aşağı bakma.', en: 'Do not look down.' };
const PHONE_LINE = { tr: 'Yemek soğuyor. Neredesin?', en: 'Dinner is getting cold. Where are you?' };
const PROMPT = { tr: 'Bas: aç', en: 'Press: answer' };

const WALKS: RoomControl = { look: true, scroll: true, hurry: 2.5 };
const HELD: RoomControl = { look: true, scroll: false };
const CALLS: RoomControl = { look: true, scroll: false, press: true };

const f = (v: number): string => v.toFixed(1);

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  p.z = p.w * 0.99999;
  gl_Position = p;
}
`;

/** Everything there is under the sky: the storm's deck by a short march through its height, the city through its holes, the air over it. */
const SKY_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform sampler2D uCity;
uniform vec3 uOrigin;
uniform vec3 uFog;
uniform vec3 uStrike;
uniform float uFlash;
uniform float uTime;
varying vec3 vDir;

const float DECK = ${f(DECK)};
const float THICK = ${f(DECK_THICK)};
const float WISPS = ${f(WISPS)};
const float CITY = ${f(CITY)};
const float SCALE = 0.0015;
const vec3 LIGHTNING = vec3(0.60, 0.68, 1.0);
const vec3 AMBER = vec3(1.0, 0.46, 0.16);
const vec3 PALE = vec3(0.0199, 0.9921, 0.1234);
const int TOWER_COUNT = ${TOWERS.length};
const vec4 TOWER_LIST[${TOWERS.length}] = vec4[${TOWERS.length}](${TOWERS.map(([x, z, w, d]) => `vec4(${f(x)}, ${f(z)}, ${f(w / 2)}, ${f(d / 2)})`).join(', ')});

float skyline(vec3 eye, vec3 d) {
  vec2 inv = 1.0 / (d.xz + vec2(0.00001));
  float hit = 0.0;
  for (int i = 0; i < TOWER_COUNT; i++) {
    vec2 a = (TOWER_LIST[i].xy - TOWER_LIST[i].zw - eye.xz) * inv;
    vec2 b = (TOWER_LIST[i].xy + TOWER_LIST[i].zw - eye.xz) * inv;
    vec2 n = min(a, b);
    vec2 g = max(a, b);
    float enter = max(n.x, n.y);
    if (min(g.x, g.y) > max(enter, 0.0)) hit = max(hit, smoothstep(DECK + 40.0, DECK + 130.0, eye.y + d.y * enter));
  }
  return hit;
}

float billow(vec2 p, float lod) {
  vec4 a = textureLod(uNoise, p * SCALE, lod);
  vec4 b = textureLod(uNoise, p * SCALE * 3.7 + a.rg * 0.22, lod + 1.2);
  return smoothstep(0.31, 0.71, a.r * 0.58 + b.g * 0.42);
}

void main() {
  vec3 d = normalize(vDir);
  vec3 eye = cameraPosition - uOrigin;
  vec2 drift = vec2(uTime * 2.6, uTime * 0.9);
  float toward = max(dot(normalize(d.xz + vec2(0.0001)), normalize(uStrike.xy - eye.xz + vec2(0.001))), 0.0);
  vec3 air = uFog + LIGHTNING * uFlash * (0.03 + 0.18 * toward * toward * toward);

  float up = max(d.y, 0.0);
  vec3 high = mix(air, vec3(0.0028, 0.0052, 0.0072), smoothstep(0.3, 1.0, up));
  high *= 0.84 + 0.32 * texture2D(uNoise, d.xz / (up + 0.2) * 0.1 + drift * 0.0002).r;
  float pale = max(dot(d, PALE), 0.0);
  high += vec3(0.55, 0.66, 0.72) * (pow(pale, 700.0) * 0.4 + pow(pale, 26.0) * 0.012);

  vec3 low = air;
  if (d.y < 0.012) {
    float sd = min(d.y, -0.003);
    float t0 = max(0.0, (eye.y - (DECK + THICK)) / -sd);
    float t1 = max(t0 + 1.0, (eye.y - DECK) / -sd);
    float dt = (t1 - t0) / 6.0;
    float lod = clamp(log2(max(t0 * 0.0008 / max(-sd, 0.03) / 2.6, 1.0)), 0.0, 6.0);
    float t = t0;
    float h = 0.0;
    vec3 p = eye + d * t;
    for (int i = 0; i < 6; i++) {
      h = billow(p.xz + drift, lod);
      if (p.y <= DECK + h * THICK) break;
      t += dt;
      p = eye + d * t;
    }
    float fine = textureLod(uNoise, (p.xz + drift) * SCALE * 11.0, lod + 1.5).b;
    float finer = textureLod(uNoise, (p.xz + drift) * SCALE * 29.0, lod).r;
    float v = clamp(h * 0.68 + 0.16 + (fine - 0.5) * 0.36 + (finer - 0.5) * 0.24, 0.0, 1.0);
    v = v * v * (3.0 - 2.0 * v);
    vec3 deck = mix(vec3(0.006, 0.011, 0.015), vec3(0.04, 0.055, 0.068), v);
    float district = smoothstep(0.38, 0.72, textureLod(uNoise, p.xz * 0.00041 + 0.31, lod).a);
    deck += AMBER * district * (0.006 + 0.075 * (1.0 - v) * (1.0 - v));
    float open = smoothstep(0.36, 0.1, h);
    float down = (eye.y - CITY) / -sd;
    deck += texture2D(uCity, (eye.xz + d.xz * down) / 3200.0).rgb * open * (0.9 + 3.0 * district);

    vec2 rel = p.xz - uStrike.xy;
    float r2 = dot(rel, rel) / (uStrike.z * uStrike.z);
    float core = exp(-r2);
    float wide = exp(-sqrt(r2) * 0.7);
    float thin = 1.0 - v;
    float vein = pow(1.0 - abs(textureLod(uNoise, p.xz * SCALE * 2.2 + uStrike.xy * 0.013, lod).b * 2.0 - 1.0), 16.0);
    deck += LIGHTNING * uFlash * (core * (0.12 + 2.4 * thin * thin) + wide * (0.04 + 0.2 * thin) + uFlash * core * core * vein * 0.5) * 0.85;

    low = mix(deck, air, 1.0 - exp(-t * 0.00048));

    float tw = (eye.y - WISPS) / -sd;
    if (tw > 0.0) {
      float lw = clamp(log2(max(tw * 0.0008 / max(-sd, 0.03) / 1.8, 1.0)), 0.0, 6.0);
      float n = textureLod(uNoise, (eye.xz + d.xz * tw + drift * 3.0) * 0.0021, lw).g;
      float a = smoothstep(0.52, 0.8, n) * smoothstep(0.0, 60.0, tw) * exp(-tw * 0.0009) * 0.6;
      low = mix(low, air * 1.2, a);
    }
  }
  vec3 col = mix(low, high, smoothstep(-0.012, 0.012, d.y));
  col = mix(col, vec3(0.004, 0.006, 0.008), skyline(eye, d) * smoothstep(0.06, 0.3, uFlash));
  gl_FragColor = vec4(col, 1.0);
}
`;

const COLUMN_VERT = /* glsl */ `
${WARP_GLSL}
varying vec2 vUv;
varying float vFar;
void main() {
  vUv = uv;
  vec3 base = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 toEye = normalize(vec3(cameraPosition.x - base.x, 0.0, cameraPosition.z - base.z));
  vec3 p = base + vec3(toEye.z, 0.0, -toEye.x) * position.x + vec3(0.0, position.y, 0.0);
  vFar = smoothstep(3.0, 10.0, distance(cameraPosition.xz, base.xz));
  gl_Position = projectionMatrix * dreamWarp(viewMatrix * vec4(p, 1.0));
}
`;

const COLUMN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
varying float vFar;
void main() {
  float x = (vUv.x - 0.5) * 2.0;
  gl_FragColor = vec4(uColor * exp(-x * x * 7.0) * pow(1.0 - vUv.y, 1.5) * uIntensity * vFar, 1.0);
}
`;

const GRIME_VARY_V = /* glsl */ `
uniform vec3 uOrigin;
varying vec3 vRoom;
varying vec3 vFace;
`;

const GRIME_VERTEX = /* glsl */ `
vRoom = (modelMatrix * vec4(transformed, 1.0)).xyz - uOrigin;
vFace = normal;
gl_Position.z = min(gl_Position.z, gl_Position.w * 0.99995);
`;

const GRIME_PARS = /* glsl */ `
uniform sampler2D uNoise;
uniform vec3 uOrigin;
uniform vec3 uStrike;
uniform float uFlash;
uniform float uWindows;
varying vec3 vRoom;
varying vec3 vFace;
float glowWindow = 0.0;
float beamTread = 0.0;
`;

const GRIME_ALBEDO = /* glsl */ `
{
  vec2 plane = abs(vFace.y) > 0.5 ? vRoom.xz : (abs(vFace.z) > 0.5 ? vRoom.xy : vRoom.zy);
  float big = texture2D(uNoise, plane * vec2(0.017, 0.0071)).r;
  float rain = texture2D(uNoise, plane * vec2(0.19, 0.0083)).g;
  diffuseColor.rgb *= (0.42 + 1.1 * big) * (0.62 + 0.76 * rain);
  if (uWindows > 0.5) {
    if (abs(vFace.y) < 0.5) {
      vec2 cell = plane / vec2(5.2, 3.9);
      vec2 fw = fwidth(cell);
      vec2 g = fract(cell);
      float w = smoothstep(0.22 - fw.x, 0.22 + fw.x, g.x) * (1.0 - smoothstep(0.78 - fw.x, 0.78 + fw.x, g.x))
              * smoothstep(0.3 - fw.y, 0.3 + fw.y, g.y) * (1.0 - smoothstep(0.84 - fw.y, 0.84 + fw.y, g.y));
      float sharp = 1.0 - smoothstep(0.22, 0.7, max(fw.x, fw.y));
      float clear = smoothstep(9.0, 14.0, length((plane - vec2(0.0, 1.0)) * vec2(1.0, 0.8)));
      float id = fract(sin(dot(floor(cell), vec2(127.1, 311.7))) * 43758.5453);
      diffuseColor.rgb *= 1.0 - w * sharp * clear * 0.9 * step(0.12, fract(id * 7.0));
      float small = smoothstep(0.46 - fw.x, 0.46 + fw.x, g.x) * (1.0 - smoothstep(0.54 - fw.x, 0.54 + fw.x, g.x)) * smoothstep(0.5 - fw.y, 0.5 + fw.y, g.y) * (1.0 - smoothstep(0.66 - fw.y, 0.66 + fw.y, g.y));
      glowWindow = step(0.982, id) * small * clear * (1.0 - smoothstep(0.5, 1.4, max(fw.x, fw.y)));
    }
  } else {
    beamTread = smoothstep(0.26, 0.07, abs(vRoom.x)) * step(0.5, vFace.y);
    float speck = smoothstep(0.7, 0.8, texture2D(uNoise, vRoom.xz * vec2(1.9, 1.3)).b) * (1.0 - beamTread);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.32, 0.27), speck * 0.7);
    diffuseColor.rgb *= 1.0 + beamTread * 0.25;
  }
}
`;

const GRIME_ROUGH = /* glsl */ `
roughnessFactor *= 1.0 - 0.42 * beamTread;
`;

const GRIME_FLASH = /* glsl */ `
{
  float under = max(-vFace.y, 0.0);
  float depthGlow = smoothstep(20.0, -220.0, vRoom.y);
  float reach = uWindows > 0.5 ? 0.02 + 0.5 * depthGlow : 0.035;
  reflectedLight.indirectDiffuse += material.diffuseColor * vec3(0.6, 0.68, 1.0) * uFlash * (reach + under * 1.3) * 3.0;
  if (uWindows > 0.5) reflectedLight.indirectDiffuse += material.diffuseColor * (vec3(0.9, 0.5, 0.26) * (0.02 + 0.2 * depthGlow) + vec3(0.32, 0.44, 0.52) * 0.26);
  else reflectedLight.indirectDiffuse += material.diffuseColor * (vec3(0.32, 0.44, 0.52) * 0.45 * max(vFace.y, 0.0) + vec3(0.9, 0.5, 0.26) * 0.1 * max(-vFace.y, 0.0));
}
`;

const GRIME_AFTER = /* glsl */ `
{
  float fogged = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  vec3 toHere = normalize(vRoom - (cameraPosition - uOrigin));
  vec3 behind = mix(mix(fogColor, vec3(0.0028, 0.0052, 0.0072), smoothstep(0.3, 1.0, toHere.y)), vec3(0.02, 0.03, 0.037), smoothstep(0.03, -0.35, toHere.y));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, behind, fogged);
  float sink = smoothstep(${f(DECK + 150)}, ${f(DECK + 30)}, vRoom.y + (texture2D(uNoise, vRoom.xz * 0.008 + vRoom.y * 0.002).r - 0.5) * 90.0);
  if (sink > 0.0) {
    vec2 rel = vRoom.xz - uStrike.xy;
    float core = exp(-dot(rel, rel) / (uStrike.z * uStrike.z));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.012, 0.018, 0.024) + vec3(0.6, 0.68, 1.0) * uFlash * core * 1.1, sink);
  }
  gl_FragColor.rgb += vec3(1.0, 0.56, 0.24) * glowWindow * 1.4 * exp(-vFogDepth * 0.0048);
}
`;

/** A box whose texture repeats in meters, standing where it should. */
const part = (w: number, h: number, d: number, x: number, y: number, z: number, segY = 1, segZ = 1): BufferGeometry =>
  meterUVs(new BoxGeometry(w, h, d, 1, segY, segZ)).translate(x, y, z);

/** Tiling noise for cloud and dirt: r and g are two clouds, b finer, a large soft shapes. */
function cloudNoise(): DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const layer = (channel: number, period: number, octaves: number, seed: number) => {
    const out = new Float32Array(size * size);
    let amplitude = 1;
    let p = period;
    for (let o = 0; o < octaves; o++) {
      const cells = new Float32Array(p * p);
      for (let i = 0; i < p * p; i++) {
        const v = Math.sin(i * 12.9898 + seed * 78.233 + o * 37.719) * 43758.5453;
        cells[i] = v - Math.floor(v);
      }
      for (let y = 0; y < size; y++) {
        const fy = (y / size) * p;
        const iy = Math.floor(fy);
        const ty = fy - iy;
        const sy = ty * ty * (3 - 2 * ty);
        for (let x = 0; x < size; x++) {
          const fx = (x / size) * p;
          const ix = Math.floor(fx);
          const tx = fx - ix;
          const sx = tx * tx * (3 - 2 * tx);
          const at = (cx: number, cy: number) => cells[(cy % p) * p + (cx % p)];
          out[y * size + x] += amplitude * lerp(lerp(at(ix, iy), at(ix + 1, iy), sx), lerp(at(ix, iy + 1), at(ix + 1, iy + 1), sx), sy);
        }
      }
      amplitude *= 0.55;
      p *= 2;
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < out.length; i++) {
      lo = Math.min(lo, out[i]);
      hi = Math.max(hi, out[i]);
    }
    for (let i = 0; i < out.length; i++) data[i * 4 + channel] = Math.round(((out[i] - lo) / (hi - lo)) * 255);
  };
  layer(0, 4, 5, 1);
  layer(1, 5, 5, 2);
  layer(2, 9, 4, 3);
  layer(3, 3, 2, 4);
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** A city at night seen from very high: streets of small lights, warm, some cold. */
function cityLights(): CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#000';
  c.fillRect(0, 0, size, size);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 9000; i++) {
    const along = rnd() < 0.5;
    const street = (Math.floor(rnd() * 56) / 56) * size;
    const run = rnd() * size;
    const r = rnd();
    c.fillStyle = r < 0.76 ? `rgba(255,${(140 + rnd() * 60) | 0},${(60 + rnd() * 40) | 0},${(0.35 + rnd() * 0.65).toFixed(2)})` : `rgba(205,222,255,${(0.3 + rnd() * 0.5).toFixed(2)})`;
    const w = 1 + rnd() * 1.6;
    c.fillRect(along ? street : run, along ? run : street, w, w);
  }
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 26; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 50 + rnd() * 130;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.95)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  return texture;
}

/** The section of the beam, face on: a fresh cut. */
function cutFace(): BufferGeometry {
  const w = FLANGE / 2;
  const t = FLANGE_T;
  const h = SECTION;
  const e = WEB_T / 2;
  const s = new Shape();
  s.moveTo(-w, 0);
  s.lineTo(w, 0);
  s.lineTo(w, -t);
  s.lineTo(e, -t);
  s.lineTo(e, -h + t);
  s.lineTo(w, -h + t);
  s.lineTo(w, -h);
  s.lineTo(-w, -h);
  s.lineTo(-w, -h + t);
  s.lineTo(-e, -h + t);
  s.lineTo(-e, -t);
  s.lineTo(-w, -t);
  s.closePath();
  const g = new ShapeGeometry(s);
  g.setAttribute('uv1', g.getAttribute('uv').clone());
  return g;
}

/**
 * Heights. A steel beam leaves a door in a concrete tower and runs out over a storm to another tower, and home is
 * lit behind you and lit ahead of you. It stops halfway. There is a chair at the end of it, and the telephone on
 * the chair is ringing. Under you the same beam again, and again, each halved in the same place.
 */
export default class Beam extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: FOG_DARK, density: FOG_DENSITY },
    env: 'evening',
    envIntensity: 0.05,
    sky: 0,
    grade: { exposure: EXPOSURE, saturation: 0.82, warmth: 0.02, tint: -0.02, flare: 0.002 },
  };
  film = { bloom: 0.75, bloomFrom: 0.7, grain: 0.27, scratches: 0.05, flicker: 0.015, weave: 0.0004, barrel: 0, aberration: 0 };
  drift = 0.2;
  fear = 0.5;

  private readonly noise = cloudNoise();
  private readonly shared = {
    uNoise: { value: this.noise },
    uFlash: { value: 0 },
    uStrike: { value: new Vector3(0, -300, 300) },
    uOrigin: { value: this.origin },
  };
  private readonly fogNow = new Color(FOG_DARK);
  private readonly fogDark = new Color(FOG_DARK);
  private readonly fogLit = new Color(FOG_LIT);
  private readonly skyTime = { value: 0 };
  private readonly skyFog = { value: new Color(FOG_DARK) };

  private readonly half = new Group();
  private readonly chair = new Group();
  private readonly turn = new Euler();
  private readonly v0 = new Vector3();
  private readonly v1 = new Vector3();
  private readonly dummy = new Object3D();
  private readonly release = new Vector3();
  private readonly endA = new Vector3();
  private readonly endB = new Vector3();

  private readonly shaft;
  private readonly spill;
  private readonly farSpill;
  private readonly column;
  private readonly hallLight: DreamLight;
  private readonly porch: DreamLight;
  private readonly farPool: DreamLight;
  private readonly storm: DreamLight;
  private readonly sparkLight: DreamLight;
  private readonly chairLight: DreamLight;
  private readonly nearLeaf: Object3D;
  private readonly farLeaf: Object3D;
  private readonly farGlow: Mesh;
  private readonly heads: InstancedMesh;
  private readonly spark: Mesh;
  private readonly sparkColor = new Color(0xffb27a);
  private readonly wirePositions = new Float32Array(WIRE_RINGS * 9);
  private readonly wireGeometry: BufferGeometry;
  private readonly floorWire: Mesh;
  private readonly handset: Object3D;
  private readonly handsetRest = new Vector3();
  private readonly chairPaint: MeshStandardMaterial[] = [];
  private chairShade = 1;
  private readonly man: Group;
  private readonly flakes: InstancedMesh;
  private readonly flakeData: Float32Array;
  private readonly birds: InstancedMesh;
  private readonly birdData: Float32Array;

  private strike = 0;
  private answered: number | null = null;
  private spoke = false;
  private prompted = false;
  private heardSteps = 0;
  private readonly stepOptions = { gain: 0.42, reverb: 0.3 };
  private readonly creakOptions = { gain: 0.24, reverb: 0.3 };
  private readonly flakeOptions = { gain: 0.22, reverb: 0.3 };

  private gusts: RoomVoice | null = null;
  private tube: RoomVoice | null = null;
  private whistle: RoomVoice | null = null;
  private city: RoomVoice | null = null;
  private droneVoice: RoomVoice | null = null;
  private cable: RoomVoice | null = null;
  private breath: RoomVoice | null = null;
  private bell: RoomVoice | null = null;
  private lineDead: RoomVoice | null = null;
  private lineBreath: RoomVoice | null = null;
  private readonly rolls: RoomVoice[] = [];

  constructor(ctx: RoomContext) {
    super(ctx);
    const b = this.build;
    const kit = this.kit;
    const seconds = this.seconds;
    const key = (s: number, x: number, y: number, yaw: number, pitch: number, fov: number, roll = 0): RoomKey => ({ t: s / seconds, at: [x, y, 0], yaw, pitch, fov, roll });
    const turned = REDUCED_MOTION ? 0 : 178;
    this.keys = [
      key(0, 0, 1.62, 0, -8.5, 44),
      key(2.8, 0, 1.62, 0, -9, 44),
      ...(REDUCED_MOTION
        ? [key(5.6, 0.15, 1.6, -4, -46, 50), key(7.7, 0.15, 1.6, -4, -48, 50)]
        : [key(5.6, 0.4, 1.36, -9, -74, 62, -3), key(7.7, 0.46, 1.14, -10, -80, 88, -4)]),
      key(9.6, 0, 1.62, 0, -7, 50),
      key(12, 0, 1.62, 0, -7, 50),
      key(HALT_FROM, 0, 1.62, 0, -6.5, 48),
      key(22.7, -0.05, 1.6, 36, -30, 46, 1),
      key(HALT_TO - 0.1, -0.05, 1.6, 32, -28, 46, 1),
      key(25.3, 0, 1.62, 0, -7, 47),
      key(33.4, 0, 1.62, 0, -9, 46),
      key(WALK_TO, 0.16, 1.6, -1, -17, 44),
      key(38, 0.16, 1.6, -2, -24, 42),
      key(WIND_DIES - 0.3, 0.16, 1.58, -2, -24, 42),
      key(46.4, 0, 1.6, 0, -2.5, 38),
      key(46.95, 0, 1.6, 0, -2.5, 38),
      key(DOOR_AT + 0.05, 0, 1.6, turned, turned ? -4 : -14, 50),
      key(49.1, 0, 1.6, turned, turned ? -4 : -14, 50),
      key(LET_GO, 0, 1.55, turned, turned ? -1 : -22, 50),
      key(53.7, 0.1, 1.5, -2, -30, 46),
      key(55, 0.22, 1.5, -6, -34, 44, -1),
      key(55.8, 0.3, 1.5, -6, -46, 42, -1),
      key(56.9, 0.36, 1.5, -9, -60, 40, -2),
      key(58.1, 0.4, 1.45, -9, -68, 38, -3),
      key(SHUTTER_AT, 0.25, 1.2, -4, -84, 60, -4),
      key(FALL_AT, 0.25, 1.2, -4, -86, 64, -4),
      key(CUT_AT, 0, 1.2, 0, -88, 92, -4),
      key(seconds, 0, 1.2, 0, -88, 92, -4),
    ];

    this.root.add(this.half);
    this.root.add(this.chair);

    // the sky, the storm, the city
    const sky = new Mesh(
      new SphereGeometry(10, 32, 20),
      new ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: { ...this.shared, uCity: { value: cityLights() }, uFog: this.skyFog, uTime: this.skyTime },
        side: BackSide,
      }),
    );
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.root.add(sky);

    // concrete: the near tower cut round its door, the far one, the rest
    const concrete = this.grime(kit.surface('conc_pour_lifts', 2, { color: new Color(0x8a8e8c), roughness: 0.95 }), 1);
    const low = DECK - 20;
    const tall = TOWER_TOP - low;
    const mid = (TOWER_TOP + low) / 2;
    const rows = 14;
    const walls: BufferGeometry[] = [];
    const w = NEAR_W / 2;
    walls.push(part(w - HOLE_HALF, tall, NEAR_D, -(w + HOLE_HALF) / 2, mid, NEAR_D / 2, rows));
    walls.push(part(w - HOLE_HALF, tall, NEAR_D, (w + HOLE_HALF) / 2, mid, NEAR_D / 2, rows));
    walls.push(part(HOLE_HALF * 2, TOWER_TOP - HOLE_H, NEAR_D, 0, (TOWER_TOP + HOLE_H) / 2, NEAR_D / 2, 6));
    walls.push(part(HOLE_HALF * 2, -0.01 - low, NEAR_D, 0, (-0.01 + low) / 2, NEAR_D / 2, 6));
    walls.push(part(HOLE_HALF * 2, HOLE_H + 0.01, NEAR_D - HALL, 0, HOLE_H / 2, (NEAR_D + HALL) / 2));
    walls.push(part(FAR_W, tall, FAR_D, 0, mid, -SPAN - FAR_D / 2, rows));
    for (let y = -7.2 - LEDGE_STEP * 22; y < 330; y += LEDGE_STEP) {
      walls.push(part(NEAR_W + 0.5, 0.26, NEAR_D + 0.5, 0, y, NEAR_D / 2));
      walls.push(part(FAR_W + 0.5, 0.26, FAR_D + 0.5, 0, y, -SPAN - FAR_D / 2));
    }
    for (const x of [-20, -13, -6, 6, 13, 20]) walls.push(part(0.9, tall, 0.7, x, mid, -0.35, rows));
    for (const x of [-9, -3.4, 3.4, 9]) walls.push(part(0.9, tall, 0.7, x, mid, -SPAN + 0.35, rows));
    const towers = new Mesh(mergeGeometries(walls)!, concrete);
    towers.frustumCulled = false;
    towers.receiveShadow = true;
    this.root.add(towers);

    // steel: the half you walk on turns about the door; the rest stays where it is
    const rust = this.grime(kit.surface('rust_sheet', 1.25, { roughness: 0.9, metalness: 0.35, color: new Color(0xc9b6a6) }), 0);
    const streaked = this.grime(kit.surface('rust_streaked', 2, { roughness: 0.9, metalness: 0.3, color: new Color(0xb08a70) }), 0);
    const addBeam = (flanges: BufferGeometry[], webs: BufferGeometry[], from: number, to: number, y: number, seg = 1.5) => {
      const length = to - from;
      const z = -(from + to) / 2;
      const n = Math.max(1, Math.ceil(length / seg));
      flanges.push(part(FLANGE, FLANGE_T, length, 0, y - FLANGE_T / 2, z, 1, n));
      flanges.push(part(FLANGE, FLANGE_T, length, 0, y - SECTION + FLANGE_T / 2, z, 1, n));
      webs.push(part(WEB_T, SECTION - 2 * FLANGE_T, length, 0, y - SECTION / 2, z, 1, n));
    };
    const whole = (geometries: BufferGeometry[], material: MeshStandardMaterial, parent: Object3D, cast = false) => {
      const m = new Mesh(mergeGeometries(geometries)!, material);
      m.frustumCulled = false;
      m.castShadow = cast;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const myFlanges: BufferGeometry[] = [];
    const myWeb: BufferGeometry[] = [];
    addBeam(myFlanges, myWeb, 0, HALF, 0);
    for (const a of [5.25, 10.5, 15.75]) myFlanges.push(part(FLANGE + 0.03, 0.016, 0.72, 0, 0.008, -a));
    whole(myFlanges, rust, this.half);
    whole(myWeb, streaked, this.half);

    const flanges: BufferGeometry[] = [];
    const webs: BufferGeometry[] = [];
    addBeam(flanges, webs, HALF + GAP, SPAN, 0);
    for (const a of [HALF + GAP + 5.25, HALF + GAP + 10.5, HALF + GAP + 15.75]) flanges.push(part(FLANGE + 0.03, 0.016, 0.72, 0, 0.008, -a));
    for (const depth of LEVELS) {
      addBeam(flanges, webs, 0, HALF, -depth, 21);
      addBeam(flanges, webs, HALF + GAP, SPAN, -depth, 21);
    }
    whole(flanges, rust, this.root);
    whole(webs, streaked, this.root);

    const fresh = this.grime(kit.surface('steel_scuffed', 0.5, { color: new Color(0xbcc4c8), metalness: 0.9, roughness: 0.35, emissive: new Color(0x5a6a72), emissiveIntensity: 0.5 }), 0);
    const cutGeometry = cutFace();
    whole([part(FLANGE, 0.003, 0.02, 0, 0.0015, -HALF + 0.01)], fresh, this.half);
    whole([part(FLANGE, 0.003, 0.02, 0, 0.0015, -HALF - GAP - 0.01)], fresh, this.root);
    const myCut = new Mesh(cutGeometry, fresh);
    myCut.position.set(0, 0, -HALF - 0.002);
    myCut.rotation.y = Math.PI;
    myCut.frustumCulled = false;
    this.half.add(myCut);
    const farCut = new Mesh(cutGeometry, fresh);
    farCut.position.set(0, 0, -HALF - GAP + 0.002);
    farCut.frustumCulled = false;
    this.root.add(farCut);

    // the chairs on all the beams below
    const lowChairs = kit.props('chair_white', LEVELS.length);
    LEVELS.forEach((depth, i) => lowChairs.set(i, 0, -depth, -CHAIR_ALONG, 84 * DEG, 1));
    lowChairs.commit();
    this.root.add(lowChairs.root);

    // rivets along both edges, bolts down the middle
    const studGeometry = new SphereGeometry(0.017, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2);
    studGeometry.scale(1, 0.7, 1);
    const studMaterial = new MeshStandardMaterial({ color: 0x4a3526, roughness: 0.6, metalness: 0.4 });
    const studs = (from: number, to: number, parent: Object3D) => {
      const n = Math.floor((to - from) / 0.2) * 2;
      const m = new InstancedMesh(studGeometry, studMaterial, n);
      for (let i = 0; i < n; i++) {
        this.dummy.position.set((i % 2 === 0 ? -1 : 1) * (FLANGE / 2 - 0.055), 0, -from - Math.floor(i / 2) * 0.2 - 0.1);
        this.dummy.updateMatrix();
        m.setMatrixAt(i, this.dummy.matrix);
      }
      m.frustumCulled = false;
      m.receiveShadow = true;
      parent.add(m);
    };
    studs(0, HALF, this.half);
    studs(HALF + GAP, SPAN, this.root);

    const boltMaterial = new MeshStandardMaterial({ color: 0x53463a, roughness: 0.45, metalness: 0.7 });
    this.heads = new InstancedMesh(new CylinderGeometry(0.045, 0.05, 0.04, 6), boltMaterial, BOLT_TIMES.length);
    this.heads.instanceMatrix.setUsage(DynamicDrawUsage);
    this.heads.frustumCulled = false;
    this.half.add(this.heads);
    const washers = new InstancedMesh(new CylinderGeometry(0.078, 0.082, 0.01, 14), boltMaterial, BOLT_TIMES.length);
    washers.frustumCulled = false;
    this.half.add(washers);
    for (let i = 0; i < BOLT_TIMES.length; i++) {
      this.dummy.position.set(0, 0.005, -this.boltAlong(i));
      this.dummy.updateMatrix();
      washers.setMatrixAt(i, this.dummy.matrix);
      this.dummy.position.y = 0.028;
      this.dummy.updateMatrix();
      this.heads.setMatrixAt(i, this.dummy.matrix);
    }
    this.spark = b.glow(0, 0, 0, 1.2, 0xffb27a, 1, this.half);
    this.spark.visible = false;

    // behind you: the house
    const near = b.door(0, 0, '-z', this.root, { open: 0.9, color: 0x2b241c });
    near.beyond.visible = false;
    this.nearLeaf = near.leaf;
    const hall = new Group();
    hall.rotation.y = Math.PI;
    this.root.add(hall);
    b.box(0.98, HALL, 2.14, { walls: b.damask(PALETTE.damaskGreen), floor: b.checker(0.5), ceiling: b.ceiling(0.6), skip: ['-z'] }, hall);
    const table = b.lampTable(0, HALL - 0.45, this.root, Math.PI);
    b.clock(0.12, table.top + 0.018, HALL - 0.72, this.root, 1).root.rotation.y = Math.PI;
    this.hallLight = this.light(table.lightAt, PALETTE.warm, 7, 7);
    b.glow(table.lightAt[0], table.lightAt[1], table.lightAt[2], 1.3, PALETTE.warm, 0.5, this.root);
    this.porch = this.light([0, 1.9, -0.8], PALETTE.warm, 2.2, 6);

    // ahead of you: the same door, a long way off, and a chair where the beam stops again
    const far = b.door(0, -SPAN, '+z', this.root, { open: 1, color: 0x2b241c });
    (far.beyond.material as MeshBasicMaterial).color.setRGB(1.6, 0.9, 0.42);
    this.farLeaf = far.leaf;
    this.farGlow = b.glow(0, 1.1, -SPAN + 0.2, 3.2, PALETTE.warm, 0.14, this.root);
    this.farPool = this.light([0, 1.7, -SPAN + 1.2], PALETTE.warm, 7, 9);
    kit.prop('chair_white', [0, 0, -FAR_CHAIR_ALONG], {}, this.root);
    this.man = b.headless(1, { clip: 'm_sit_chair_idle_roll_head', time: 2, tint: 0x14161a }).root;
    this.man.position.set(0, 0, -FAR_CHAIR_ALONG);
    this.man.visible = false;
    this.root.add(this.man);

    // the chair at the end, and the telephone on it
    kit.prop('chair_white', [0, 0, 0], { rotation: [0, 84, 0], castShadow: true }, this.chair).traverse((o) => {
      const m = (o as Mesh).material as MeshStandardMaterial | undefined;
      if (m?.color && !this.chairPaint.includes(m)) this.chairPaint.push(m);
    });
    const phone = kit.prop('phone_ornate', [0, SEAT, 0], { rotation: [0, -8, 0], castShadow: true }, this.chair);
    this.handset = phone.getObjectByName('handset')!;
    this.handsetRest.copy(this.handset.position);

    // the telephone wire: along the beam to the end, then over nothing to the other half
    const black = new MeshBasicMaterial({ color: 0x050505, side: DoubleSide });
    this.floorWire = new Mesh(
      new TubeGeometry(
        new CatmullRomCurve3([new Vector3(0, SEAT + 0.05, -0.09), new Vector3(0.01, SEAT + 0.01, -0.17), new Vector3(0.03, SEAT - 0.08, -0.3), new Vector3(0.05, 0.14, -0.38), new Vector3(0.06, 0.012, -0.5), new Vector3(0.03, 0.012, -0.95), new Vector3(0, 0.012, -1.4)]),
        36,
        0.005,
        5,
      ),
      black,
    );
    this.floorWire.frustumCulled = false;
    this.chair.add(this.floorWire);
    this.wireGeometry = new BufferGeometry();
    this.wireGeometry.setAttribute('position', new BufferAttribute(this.wirePositions, 3).setUsage(DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i < WIRE_RINGS - 1; i++) {
      for (let k = 0; k < 3; k++) {
        const p = i * 3 + k;
        const q = i * 3 + ((k + 1) % 3);
        index.push(p, q, p + 3, q, q + 3, p + 3);
      }
    }
    this.wireGeometry.setIndex(index);
    const wire = new Mesh(this.wireGeometry, black);
    wire.frustumCulled = false;
    this.root.add(wire);


    // flakes and pigeons: everything about them is decided here, so that their flight is a pure function of time
    const flakeCount = FLAKES_A_STEP * STEPS + FLAKES_A_BOLT * BOLT_TIMES.length;
    this.flakeData = new Float32Array(flakeCount * 7);
    this.flakes = new InstancedMesh(new PlaneGeometry(0.03, 0.02), new MeshBasicMaterial({ color: 0x5c3d2a, side: DoubleSide }), flakeCount);
    this.flakes.instanceMatrix.setUsage(DynamicDrawUsage);
    this.flakes.frustumCulled = false;
    this.root.add(this.flakes);
    this.seedFlakes();
    this.birdData = new Float32Array(PIGEONS * 4);
    for (let i = 0; i < PIGEONS * 4; i++) {
      const v = Math.sin(i * 91.17 + 3.3) * 43758.5453;
      this.birdData[i] = v - Math.floor(v);
    }
    const wing = new PlaneGeometry(0.34, 0.13).translate(0.17, 0, 0).rotateX(-Math.PI / 2);
    this.birds = new InstancedMesh(wing, new MeshBasicMaterial({ color: 0x9a9fa3, side: DoubleSide }), PIGEONS * 2);
    this.birds.instanceMatrix.setUsage(DynamicDrawUsage);
    this.birds.frustumCulled = false;
    this.birds.visible = false;
    this.root.add(this.birds);

    // light: a column on the chair that casts the room's only shadow; the spill from the house on the first meters of steel
    this.shaft = this.spot([-0.3, 16, -CHAIR_ALONG + 3.2], [CHAIR_X, 0.4, -CHAIR_ALONG], 0xcfe0ea, COLUMN, 6.5, 0.55);
    this.spill = this.spot([0, 1.9, 1], [0, 0, -9], 0xffc98a, SPILL, 12, 0.55);
    this.farSpill = this.spot([0, 1.72, -SPAN - 1.2], [0, 0, -SPAN + 9], 0xffc98a, FAR_SPILL, 12, 0.55);
    this.spots = [this.shaft, this.spill, this.farSpill];
    this.column = new Mesh(
      new PlaneGeometry(1.5, 46).translate(0, 23, 0),
      new ShaderMaterial({
        vertexShader: COLUMN_VERT,
        fragmentShader: COLUMN_FRAG,
        uniforms: { ...warpUniforms, uColor: { value: new Color(0xcfe0ea) }, uIntensity: { value: COLUMN_AIR } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.column.position.set(0.04, 0, -CHAIR_ALONG);
    this.column.frustumCulled = false;
    this.column.renderOrder = 3;
    this.root.add(this.column);
    this.storm = this.light([0, -7, -8], 0xb9c6ff, 0, 60);
    this.sparkLight = this.light([0, 0, 0], 0xffb27a, 0, 7);
    this.chairLight = this.light([0, 0, 0], 0xcfe0ea, 0, 16);

    this.place(0.25, 1.2, HALF + 0.25, FALL_AT, this.release);
    this.writeBeats();
  }

  /** Where bolt number i sits, along the beam (m). */
  private boltAlong(i: number): number {
    return 1.6 + (i * (STOP - 0.55 - 1.6)) / (BOLT_TIMES.length - 1);
  }

  /** Concrete and rust: world-sized stains, windows on the towers, the path worn down the beam, light from under it. */
  private grime(material: MeshStandardMaterial, windows: number): MeshStandardMaterial {
    const uniforms = { ...this.shared, uWindows: { value: windows } };
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GRIME_VARY_V}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${GRIME_VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GRIME_PARS}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${GRIME_ALBEDO}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${GRIME_ROUGH}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${GRIME_FLASH}`)
        .replace('#include <fog_fragment>', GRIME_AFTER);
    };
    material.customProgramCacheKey = () => 'beam-grime';
    return material;
  }

  private seedFlakes(): void {
    const d = this.flakeData;
    let n = 0;
    const rnd = (i: number) => {
      const v = Math.sin(i * 57.31 + n * 3.77) * 43758.5453;
      return v - Math.floor(v);
    };
    const add = (born: number, x: number, y: number, along: number, fall: number) => {
      d[n * 7] = born;
      d[n * 7 + 1] = x;
      d[n * 7 + 2] = y;
      d[n * 7 + 3] = -along;
      d[n * 7 + 4] = fall;
      d[n * 7 + 5] = rnd(5) * 6.28;
      d[n * 7 + 6] = 0.5 + rnd(6) * 1.3;
      n++;
    };
    for (let k = 0; k < STEPS; k++) {
      const landed = k < STEPS_BEFORE ? WALK_FROM + (k + 1) * STEP_TIME : HALT_TO + (k - STEPS_BEFORE + 1) * STEP_TIME;
      const along = START + (k + 1) * STRIDE;
      for (let i = 0; i < FLAKES_A_STEP; i++) add(landed + rnd(1) * 0.4, (rnd(2) < 0.5 ? -1 : 1) * (FLANGE / 2 + 0.004), -0.04, along + 0.5 + rnd(3) * 5.5, 0.8 + rnd(4) * 1.4);
    }
    for (let k = 0; k < BOLT_TIMES.length; k++) {
      for (let i = 0; i < FLAKES_A_BOLT; i++) add(BOLT_TIMES[k] + rnd(1) * 0.3, (rnd(2) < 0.5 ? -1 : 1) * FLANGE * rnd(3) * 0.5, 0.02, this.boltAlong(k), 1 + rnd(4) * 1.6);
    }
  }

  private writeBeats(): void {
    const s = this.sound;
    this.beat(0, () => {
      this.gusts = s.bed('rooms/wind_high_gusts.mp3', { gain: 0.24 });
      this.tube = s.bed('rooms/wind_high_tube.mp3', { gain: 0.13 });
      this.whistle = s.bed('rooms/wind_high_whistle.mp3', { gain: 0.08 });
      this.city = s.bed('rooms/far_city.mp3', { gain: 0.16, lowpass: 1800 });
      this.droneVoice = s.bed('rooms/dream_drone_hollow.mp3', { gain: 0.1 });
    });
    this.beat(3, () => {
      s.play('rooms/breath_in.mp3', { gain: 0.2 });
      this.whistle?.gain(0.14, 2);
      this.city?.gain(0.28, 2);
    });
    this.beat(5, () => this.say(DOWN_LINE, 3.4));
    this.beat(9, () => {
      this.whistle?.gain(0.08, 2);
      this.city?.gain(0.16, 2);
    });
    const roll = (at: number, file: string, gain: number) => this.beat(at, () => this.rolls.push(s.play(file, { gain })));
    roll(9.3, 'rooms/thunder_far_1.mp3', 0.45);
    roll(17.6, 'rooms/thunder_far_4.mp3', 0.3);
    roll(26.3, 'rooms/thunder_far_2.mp3', 0.36);
    roll(34.2, 'rooms/thunder_far_3.mp3', 0.32);
    roll(58.2, 'rooms/thunder_far_4.mp3', 0.42);
    this.beat(10, () => {
      this.breath = s.bed('rooms/breath_calm.mp3', { gain: 0.07, fade: 2 });
    });
    this.beat(WALK_FROM, () => {
      this.cable = s.bed('rooms/cable_hum.mp3', { gain: 0.12, fade: 3 });
    });
    this.beat(HALT_FROM, () => {
      this.gusts?.gain(0.38, 0.8);
      s.play('rooms/steel_creak_long.mp3', { gain: 0.3, reverb: 0.3 });
    });
    this.beat(PIGEONS_AT, () => s.play('rooms/pigeons_below.mp3', { gain: 0.2, lowpass: 3000, reverb: 0.5, pan: -0.4 }));
    this.beat(HALT_TO, () => this.gusts?.gain(0.24, 1.2));
    this.beat(34.7, () => {
      this.gusts?.gain(0.1, 0.5);
      this.tube?.gain(0.07, 0.5);
      this.breath?.gain(0, 0.8);
    });
    this.beat(36.2, () => this.gusts?.gain(0.16, 1.5));
    for (const at of RINGS) {
      this.beat(at, () => {
        if (this.answered === null) this.bell = s.play('rooms/phone_bell_thin.mp3', { gain: 0.25, reverb: 0.2 });
      });
    }
    this.beat(WIND_DIES, () => {
      const fade = LINE_CUTS - WIND_DIES - 0.2;
      for (const v of [this.gusts, this.tube, this.whistle, this.city, this.droneVoice, this.cable, this.breath]) v?.gain(0, fade);
      for (const v of this.rolls) v.gain(0, fade);
    });
    this.beat(LINE_CUTS, () => {
      this.lineDead?.stop(0.04);
      this.lineBreath?.stop(0.04);
    });
    this.beat(DOOR_AT, () => s.play('rooms/door_far_metal.mp3', { gain: 0.5 }));
    this.beat(DOOR_AT + 0.4, () => {
      this.gusts?.gain(0.3, 3);
      this.tube?.gain(0.16, 3);
      this.whistle?.gain(0.1, 3);
      this.cable?.gain(0.16, 2);
      this.droneVoice?.gain(0.1, 3);
      s.play('rooms/steel_stress.mp3', { gain: 0.25, reverb: 0.3 });
    });
    BOLT_TIMES.forEach((at, i) => {
      const near = i / (BOLT_TIMES.length - 1);
      this.beat(at, () => {
        s.play(BOLT_FILES[i % 3], { gain: lerp(0.28, 0.62, near), reverb: 0.5, lowpass: lerp(2200, 16000, near * near) });
        if (i % 3 === 2) s.play(i % 2 === 0 ? 'rooms/cable_twang_1.mp3' : 'rooms/cable_twang_2.mp3', { gain: 0.22, reverb: 0.3 });
      });
    });
    this.beat(LET_GO, () => {
      s.play('rooms/bolt_ping_long.mp3', { gain: 0.45, reverb: 0.5 });
      s.play('rooms/groan_steel.mp3', { gain: 0.3, lowpass: 2000, reverb: 0.4 });
      s.play('rooms/bolts_fall.mp3', { gain: 0.35, reverb: 0.3 });
      s.play('rooms/steel_throb_1.mp3', { gain: 0.3, reverb: 0.2 });
    });
    this.beat(CHAIR_MOVES, () => s.play('rooms/chair_slide_steel.mp3', { gain: 0.35, reverb: 0.2 }));
    this.beat(SLIDE_AT, () => {
      s.play('rooms/gasp_2.mp3', { gain: 0.3 });
      s.play('rooms/steel_creak_long.mp3', { gain: 0.34, reverb: 0.3 });
    });
    this.beat(SHUTTER_AT, () => this.shutter());
    this.beat(FALL_AT, () => {
      for (const v of [this.gusts, this.tube, this.whistle, this.city, this.droneVoice, this.cable]) v?.gain(0, 0.4);
      s.play('rooms/whoosh_fall.mp3', { gain: 0.5 });
      s.bed('rooms/fall_wind.mp3', { gain: 0.26, lowpass: 8000, fade: 0.6 });
    });
  }

  /** How many steps the eye has taken at second `s`; the fraction is the step under way. */
  private stepsAt(s: number): number {
    if (s <= WALK_FROM) return 0;
    const first = (s - WALK_FROM) / STEP_TIME;
    if (first < STEPS_BEFORE) return first;
    if (s < HALT_TO) return STEPS_BEFORE;
    return Math.min(STEPS, STEPS_BEFORE + (s - HALT_TO) / STEP_TIME);
  }

  /** How far along the beam the eye stands. */
  private alongAt(s: number): number {
    if (s > SLIDE_AT) {
      const u = range(SLIDE_AT, FALL_AT, s);
      return lerp(STOP, HALF + 0.25, u * u);
    }
    const steps = this.stepsAt(s);
    const done = Math.floor(steps);
    return START + STRIDE * (done + smootherstep(steps - done));
  }

  /** The wind against the eye (0..1.4). */
  private gust(s: number): number {
    const g = 0.5 + 0.5 * wobble(s * 0.31, 5);
    return g * g + 0.9 * smootherstep(range(HALT_FROM - 0.4, HALT_FROM + 0.6, s)) * (1 - smootherstep(range(HALT_TO - 0.8, HALT_TO + 0.2, s)));
  }

  /** How far the beam has tipped (rad). */
  private tiltAt(s: number): number {
    if (s <= BOLT_TIMES[0]) return 0;
    let a = 0;
    for (let i = 0; i < BOLT_TIMES.length; i++) a += BOLT_SAG * smootherstep(range(BOLT_TIMES[i], BOLT_TIMES[i] + 0.16, s));
    const after = range(LET_GO, FALL_AT, s);
    return (a + LURCH * smootherstep(range(LET_GO, LET_GO + 0.3, s)) + TILT * after * after) * DEG;
  }

  private twistAt(s: number): number {
    const after = range(LET_GO, FALL_AT, s);
    return TWIST * after * after * DEG;
  }

  /** A point of the beam's own frame at second `s`, in the room's frame. */
  private place(x: number, y: number, along: number, s: number, out: Vector3): Vector3 {
    this.turn.set(-this.tiltAt(s), 0, this.twistAt(s));
    return out.set(x, y, -along).applyEuler(this.turn);
  }

  /** How far the viewer has bent to the telephone (0..1). */
  private bentAt(s: number): number {
    if (this.answered === null) return 0;
    const since = s - this.answered;
    return smootherstep(range(0, 0.85, since)) * (1 - smootherstep(range(1, 2.4, since)));
  }

  override pose(t: number, out: RoomPose): RoomPose {
    super.pose(t, out);
    const o = this.origin;
    const s = t * this.seconds;
    const calm = REDUCED_MOTION ? 0.3 : 1;
    if (s >= FALL_AT) {
      const fell = s - FALL_AT;
      const g = REDUCED_MOTION ? FALL_G * 0.2 : FALL_G;
      out.position.set(o.x + this.release.x, o.y + this.release.y - 0.5 * g * fell * fell, o.z + lerp(this.release.z, -HALF - GAP / 2, smootherstep(Math.min(1, fell / THROW_TIME))));
      out.yaw += fell * SPIN * calm;
      out.roll += fell * fell * FALL_ROLL * calm + this.twistAt(FALL_AT) * 0.7;
      return out;
    }
    const steps = this.stepsAt(s);
    const done = Math.floor(steps);
    const stride = Math.sin(Math.PI * (steps - done));
    const foot = done % 2 === 0 ? 1 : -1;
    const wind = this.gust(s);
    const bent = this.bentAt(s);
    const hold = 1 - range(SLIDE_AT, FALL_AT, s);
    const x = out.position.x - o.x + (foot * 0.018 * stride + wind * 0.06 * hold * Math.sin(s * 0.71)) * calm;
    const y = out.position.y - o.y - 0.012 * (1 - stride) * calm - 0.5 * bent;
    this.place(x, y, this.alongAt(s) + 0.55 * bent, s, this.v0);
    out.position.set(o.x + this.v0.x, o.y + this.v0.y, o.z + this.v0.z);
    out.roll += ((foot * 0.6 * stride + wind * 2.2 * hold * Math.sin(s * 0.93 + 1)) * DEG * calm) + this.twistAt(s) * 0.7;
    out.pitch -= (stride * 0.25 + 15 * bent) * DEG * calm;
    return out;
  }

  /** The beam gives under each step, and the whole of space with it. */
  override warpAt(t: number, amount: { x: number; y: number; z: number; w: number }): void {
    const s = t * this.seconds;
    const steps = this.stepsAt(s);
    const since = (steps - Math.floor(steps)) * STEP_TIME;
    const walking = s > WALK_FROM && s < WALK_TO && (s < HALT_FROM || s > HALT_TO) ? 1 : 0;
    const calm = REDUCED_MOTION ? 0.25 : 1;
    const held = range(WALK_FROM, WALK_TO, s) * (1 - range(46, 48, s));
    amount.x = -(SAG * held + GIVE * walking * Math.exp(-since / 0.3)) * calm;
    amount.y = GUST_BEND * this.gust(s) * Math.sin(s * 0.63) * calm * (s < 46 ? 1 : 0);
    amount.z = 0;
    amount.w = 0;
  }

  private flashAt(s: number): number {
    let best = 0;
    for (let i = 0; i < STRIKES.length; i++) {
      const k = STRIKES[i];
      const age = s - k[0];
      if (age < 0) break;
      if (age > 4) continue;
      const v = k[4] * (age < FLASH_RISE ? age / FLASH_RISE : Math.exp(-(age - FLASH_RISE) / FLASH_FALL));
      if (v >= best) {
        best = v;
        this.strike = i;
      }
    }
    return best * (REDUCED_MOTION ? 0.7 : 1);
  }

  private answer(at: number, s: number): void {
    this.answered = at;
    this.hint(null);
    this.bell?.stop(0.06);
    this.breath?.gain(0, 0.5);
    if (s - at < 1.5) this.sound.play('rooms/phone_pickup_1.mp3', { gain: 0.45 });
    if (s < LINE_CUTS - 0.6) this.lineDead = this.sound.bed('rooms/phone_line_dead.mp3', { gain: 0.18 });
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    this.listen(s, frame);
    this.weather(s);
    this.steel(s);
    this.house(s);
    this.chairAt(s);
    this.flakesAt(s);
    this.pigeonsAt(s);
    this.fear = lerp(0.5, 0.62, range(WALK_FROM, 20, s)) + 0.18 * range(35, 38, s) + 0.2 * range(DOOR_AT, 54, s);
    const down = Math.max(range(3.2, 5.6, s) * (1 - range(8, 9.8, s)), range(53, 58, s));
    this.air.fog.density = lerp(FOG_DENSITY, FOG_CLEAR, down);
    this.film.barrel = 0.09 * down * (REDUCED_MOTION ? 0 : 1);
    this.film.aberration = 0.018 * down * (REDUCED_MOTION ? 0 : 1);
    this.movingShadows = s >= BOLT_TIMES[0] - 0.1 && s <= FALL_AT;
    this.black = REDUCED_MOTION ? smootherstep(range(FALL_AT + 0.4, FALL_AT + 2, s)) : s >= CUT_AT ? 1 : 0;
  }

  private listen(s: number, frame: RoomFrame): void {
    this.control = s < WALK_TO ? WALKS : s >= PROMPT_AT && this.answered === null ? CALLS : HELD;
    if (this.answered === null) {
      if (s >= PROMPT_AT && s < ANSWER_BY) {
        if (!this.prompted) {
          this.prompted = true;
          this.hint(PROMPT);
        }
        if (frame.input.pressed) this.answer(s, s);
      } else if (s >= ANSWER_BY) this.answer(ANSWER_BY, s);
    }
    if (this.answered !== null && !this.spoke && s >= this.answered + 1) {
      this.spoke = true;
      if (s < LINE_CUTS - 0.5) {
        this.say(PHONE_LINE, 3.6);
        this.lineBreath = this.sound.bed('rooms/phone_line_breath.mp3', { gain: 0.2, fade: 1.2 });
      }
    }
    const landed = Math.floor(this.stepsAt(s) + 0.02);
    if (landed > this.heardSteps) {
      this.heardSteps = landed;
      this.sound.play(STEP_FILES[landed % 4], this.stepOptions);
      if (landed % 3 === 0) {
        this.creakOptions.gain = 0.2 + landed * 0.006;
        this.sound.play(CREAK_FILES[((landed / 3) | 0) % 5], this.creakOptions);
      }
      if (landed % 5 === 2) this.sound.play('rooms/rust_flake.mp3', this.flakeOptions);
    }
  }

  private weather(s: number): void {
    const flash = this.flashAt(s);
    const k = STRIKES[this.strike];
    this.shared.uFlash.value = flash;
    this.shared.uStrike.value.set(k[1], k[2], k[3]);
    this.skyTime.value = s;
    this.fogNow.copy(this.fogDark).lerp(this.fogLit, Math.min(1, flash * 0.28));
    this.skyFog.value.copy(this.fogNow);
    this.air.fog.color = this.fogNow.getHex();
    this.air.envIntensity = 0.05 + 0.3 * flash * (1 - range(53, 55, s));
    this.film.bloom = 0.75 + 0.5 * flash;
    this.storm.intensity = 90 * flash * (1 - 0.7 * range(53, 55, s));
    this.storm.position.set(this.origin.x, this.origin.y - 7, this.origin.z - lerp(START, STOP, range(WALK_FROM, WALK_TO, s)));
  }

  private steel(s: number): void {
    const half = this.half;
    half.rotation.set(-this.tiltAt(s), 0, this.twistAt(s));
    if (s >= BOLT_TIMES[0] - 0.05 && s <= BOLT_TIMES[BOLT_TIMES.length - 1] + 2.2) {
      const d = this.dummy;
      let latest = -1;
      for (let i = 0; i < BOLT_TIMES.length; i++) {
        const age = s - BOLT_TIMES[i];
        if (age >= 0) latest = i;
        const out = i % 2 === 0 ? 1 : -1;
        if (age < 0) {
          d.position.set(0, 0.028, -this.boltAlong(i));
          d.rotation.set(0, 0, 0);
          d.scale.setScalar(1);
        } else if (age < 1.9) {
          d.position.set(out * 0.95 * age, 0.028 + 5.2 * age - 4.9 * age * age, -this.boltAlong(i));
          d.rotation.set(age * 13, age * 7, 0);
          d.scale.setScalar(1);
        } else d.scale.setScalar(0);
        d.updateMatrix();
        this.heads.setMatrixAt(i, d.matrix);
      }
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(1);
      this.heads.instanceMatrix.needsUpdate = true;
      const age = latest >= 0 ? s - BOLT_TIMES[latest] : 1;
      const heat = Math.max(0, 1 - age / 0.32);
      this.spark.visible = heat > 0;
      this.sparkLight.intensity = 16 * heat * heat;
      if (latest >= 0) {
        const along = this.boltAlong(latest);
        this.spark.position.set(0, 0.06, -along);
        ((this.spark.material as ShaderMaterial).uniforms.uColor.value as Color).copy(this.sparkColor).multiplyScalar(2.4 * heat);
        this.place(0, 0.25, along, s, this.v0);
        this.sparkLight.position.set(this.origin.x + this.v0.x, this.origin.y + this.v0.y, this.origin.z + this.v0.z);
      }
    } else {
      this.spark.visible = false;
      this.sparkLight.intensity = 0;
    }
  }

  private house(s: number): void {
    const shut = s < DOOR_AT ? 0 : Math.min(1, ((s - DOOR_AT) / DOOR_TIME) ** 2);
    this.nearLeaf.rotation.y = 1.5 * (1 - shut);
    const lit = 1 - shut;
    this.spill.intensity = SPILL * lit;
    this.porch.intensity = 2.2 * lit;
    this.hallLight.intensity = 7 * lit;
    const farShut = range(DOOR_AT + 0.5, DOOR_AT + 0.9, s);
    this.farLeaf.rotation.y = 1.7 * (1 - farShut);
    this.farPool.intensity = 7 * (1 - farShut);
    this.farSpill.intensity = FAR_SPILL * (1 - farShut);
    this.farGlow.visible = farShut < 1;
    ((this.farGlow.material as ShaderMaterial).uniforms.uColor.value as Color).setHex(PALETTE.warm).multiplyScalar(0.14 * (1 - farShut));
    this.shaft.intensity = COLUMN * lerp(1, 0.55, range(DOOR_AT, DOOR_AT + 1, s)) * (1 - range(55, 58, s) * 0.8);
    (this.column.material as ShaderMaterial).uniforms.uIntensity.value = COLUMN_AIR * lerp(1, 0.5, range(DOOR_AT, DOOR_AT + 1, s)) * (1 - range(54, 56, s));
    this.man.visible = s >= 46.3 && s < DOOR_AT + 0.8;
  }

  /** The chair: on the beam, sliding, then gone, and the wire that follows it; all as functions of time. */
  private chairAt(s: number): void {
    const c = this.chair;
    const age = s - CHAIR_MOVES;
    const reach = HALF - CHAIR_ALONG;
    const off = CHAIR_MOVES + Math.sqrt((2 * reach) / CHAIR_SLIDE);
    const phone = this.v0;
    const b = this.endB.set(0.03, this.man.visible ? 1.22 : SEAT + 0.16, -FAR_CHAIR_ALONG + 0.04);
    let sag = 1.5;
    if (s < off) {
      const slid = age <= 0 ? 0 : Math.max(0, 0.5 * CHAIR_SLIDE * age * age + 0.015 * Math.sin(age * 14) * Math.min(1, age));
      this.place(CHAIR_X, 0, CHAIR_ALONG + slid, s, c.position);
      const over = smootherstep(range(reach - 0.25, reach + 0.1, slid)) * 0.5;
      c.rotation.set(-this.tiltAt(s) - over, 0, this.twistAt(s));
      this.chairLight.intensity = 0;
      this.place(CHAIR_X, SEAT + 0.05, CHAIR_ALONG + slid + 0.14, s, this.endA);
      this.floorWire.visible = slid <= 0;
      this.paintChair(1);
      if (slid <= 0) this.place(0, 0.012, HALF, s, this.endA);
    } else {
      const fell = s - off;
      this.place(CHAIR_X, 0, HALF - 0.05, off, c.position);
      c.position.set(c.position.x + 0.95 * (1 - Math.exp(-fell * 0.7)), c.position.y - 0.5 * CHAIR_FALL * fell * fell, c.position.z - 0.65 * fell);
      c.rotation.set(-this.tiltAt(off) - 0.5 - fell * 0.7, fell * 0.2, this.twistAt(off) + fell * 0.34);
      this.floorWire.visible = false;
      this.chairLight.intensity = 14 * range(off, off + 1.2, s) * (1 - range(58.5, 59.8, s));
      this.paintChair(lerp(1, 0.12, range(off, off + 3.6, s)));
      this.chairLight.position.set(this.origin.x + c.position.x, this.origin.y + c.position.y + 2.5, this.origin.z + c.position.z + 1);
      phone.set(0, 0.5, 0).applyEuler(c.rotation).add(c.position);
      const tore = smootherstep(range(off + 0.3, off + 1.3, s));
      const dist = this.v1.copy(phone).sub(b).length();
      this.endA.copy(phone);
      if (dist > WIRE_REACH) this.endA.sub(b).multiplyScalar(WIRE_REACH / dist).add(b);
      sag = lerp(0.3, 0.02, tore);
      this.endA.lerp(this.v1.set(b.x + Math.sin(s * 1.1) * 0.8, b.y - WIRE_REACH, b.z + 0.3), tore);
    }
    const p = this.wirePositions;
    const a = this.endA;
    for (let i = 0; i < WIRE_RINGS; i++) {
      const u = i / (WIRE_RINGS - 1);
      const x = lerp(a.x, b.x, u);
      const y = lerp(a.y, b.y, u) - 4 * sag * u * (1 - u);
      const z = lerp(a.z, b.z, u);
      for (let k = 0; k < 3; k++) {
        const angle = (k * Math.PI * 2) / 3;
        p[(i * 3 + k) * 3] = x + Math.cos(angle) * 0.006;
        p[(i * 3 + k) * 3 + 1] = y + Math.sin(angle) * 0.006;
        p[(i * 3 + k) * 3 + 2] = z;
      }
    }
    this.wireGeometry.getAttribute('position').needsUpdate = true;

    // the telephone rattles while it rings; the receiver lifts and goes to the ear, until the chair takes it away
    let shake = 0;
    if (this.answered === null) {
      for (let i = 0; i < RINGS.length; i++) if (s >= RINGS[i] && s < RINGS[i] + 2.4) shake = 1 - range(RINGS[i] + 1.9, RINGS[i] + 2.4, s);
    }
    const since = this.answered === null ? -1 : s - this.answered;
    const lift = since < 0 ? 0 : smootherstep(Math.min(1, since / 0.9));
    this.handset.position.set(this.handsetRest.x + Math.sin(s * 70) * 0.0012 * shake + 0.18 * lift, this.handsetRest.y + Math.abs(Math.sin(s * 41)) * 0.002 * shake + 0.7 * lift, this.handsetRest.z + 0.55 * lift);
    this.handset.visible = lift < 1;
  }

  private paintChair(v: number): void {
    if (v === this.chairShade) return;
    this.chairShade = v;
    for (let i = 0; i < this.chairPaint.length; i++) this.chairPaint[i].color.setScalar(v);
  }

  private flakesAt(s: number): void {
    const d = this.dummy;
    const data = this.flakeData;
    const count = data.length / 7;
    for (let i = 0; i < count; i++) {
      const age = s - data[i * 7];
      if (age < 0 || age > FLAKE_LIFE) d.scale.setScalar(0);
      else {
        const phase = data[i * 7 + 5];
        d.position.set(data[i * 7 + 1] + age * 0.32 + Math.sin(age * 1.3 + phase) * 0.14, data[i * 7 + 2] - data[i * 7 + 4] * age, data[i * 7 + 3] + Math.cos(age * 0.9 + phase) * 0.1);
        d.rotation.set(age * 2.3 + phase, age * 1.7, phase);
        d.scale.setScalar(data[i * 7 + 6] * (1 - range(FLAKE_LIFE - 6, FLAKE_LIFE, age)));
      }
      d.updateMatrix();
      this.flakes.setMatrixAt(i, d.matrix);
    }
    d.rotation.set(0, 0, 0);
    d.scale.setScalar(1);
    this.flakes.instanceMatrix.needsUpdate = true;
  }

  private pigeonsAt(s: number): void {
    const age = s - PIGEONS_AT;
    this.birds.visible = age > 0 && s < 42;
    if (!this.birds.visible) return;
    const d = this.dummy;
    const data = this.birdData;
    const out = smootherstep(Math.min(1, age / 3.5));
    for (let i = 0; i < PIGEONS; i++) {
      const r0 = data[i * 4];
      const r1 = data[i * 4 + 1];
      const r2 = data[i * 4 + 2];
      const r3 = data[i * 4 + 3];
      const theta = r0 * 6.28 + age * (0.34 + r1 * 0.14);
      const radius = 7 + r1 * 22;
      const x = lerp(-3 + r2 * 6, -24 + Math.cos(theta) * radius, out);
      const y = lerp(-22 + r3, -25 + r3 * 12 + Math.sin(age * 0.7 + r0 * 9) * 2, out);
      const z = lerp(-11 - r0 * 7, -22 + Math.sin(theta) * radius, out);
      const flap = Math.sin(s * (17 + r2 * 6) + r3 * 9) * 0.9;
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? 1 : -1;
        d.position.set(x, y, z);
        d.rotation.set(0, -theta, sign * flap);
        d.scale.set(sign, 1, 1);
        d.updateMatrix();
        this.birds.setMatrixAt(i * 2 + side, d.matrix);
      }
    }
    d.rotation.set(0, 0, 0);
    d.scale.setScalar(1);
    this.birds.instanceMatrix.needsUpdate = true;
  }
}

