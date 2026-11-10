import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
  type Bone,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { FigureSpec, HeroFigure } from '../../dream/FigureKit';
import type { DreamLight } from '../../dream/LightPool';
import { DEG, clamp, lerp, range, smootherstep } from '../../math';
import { GlideTrack } from '../../timeline/Track';
import type { RoomAir, RoomAssets, RoomContext, RoomControl, RoomFilm, RoomFrame, RoomKey, RoomPose } from '../Room';
import { Room } from '../Room';
import { PALETTE } from '../RoomKit';
import type { RoomVoice } from '../RoomSound';

const CRAWLS = ['rooms/duct_crawl_1.mp3', 'rooms/duct_crawl_2.mp3', 'rooms/duct_crawl_3.mp3', 'rooms/duct_crawl_4.mp3', 'rooms/duct_crawl_5.mp3', 'rooms/duct_crawl_6.mp3'];
const SCRAPES = ['rooms/duct_scrape_1.mp3', 'rooms/duct_scrape_2.mp3', 'rooms/duct_scrape_3.mp3'];
const THUDS = ['rooms/duct_thud_1.mp3', 'rooms/duct_thud_2.mp3', 'rooms/duct_thud_3.mp3', 'rooms/duct_thud_4.mp3'];
const WOMPS = ['rooms/sheet_metal_womp_1.mp3', 'rooms/sheet_metal_womp_2.mp3', 'rooms/sheet_metal_womp_3.mp3', 'rooms/sheet_metal_womp_4.mp3', 'rooms/sheet_metal_womp_5.mp3'];
const POPS = ['rooms/sheet_metal_pop_1.mp3', 'rooms/sheet_metal_pop_2.mp3', 'rooms/sheet_metal_pop_3.mp3', 'rooms/sheet_metal_pop_4.mp3', 'rooms/sheet_metal_pop_5.mp3'];
const CATCHES = ['rooms/breath_catch_1.mp3', 'rooms/breath_catch_2.mp3', 'rooms/breath_catch_3.mp3', 'rooms/breath_catch_4.mp3'];

export const assets: RoomAssets = {
  models: ['dining_table', 'dining_chair', 'plate', 'fork', 'knife', 'roast_lump', 'pot_enamel', 'jug', 'bread_half', 'forearm', 'vent_cover'],
  materials: ['duct_galvanized', 'rust_sheet'],
  sounds: [
    ...CRAWLS,
    ...SCRAPES,
    ...THUDS,
    ...WOMPS,
    ...POPS,
    ...CATCHES,
    'rooms/duct_air.mp3',
    'rooms/dream_drone_metal.mp3',
    'rooms/inside_fridge.mp3',
    'rooms/breath_calm.mp3',
    'rooms/breath_in.mp3',
    'rooms/breath_out.mp3',
    'rooms/breath_scared.mp3',
    'rooms/breath_fast.mp3',
    'rooms/breath_panic.mp3',
    'rooms/heart_fast.mp3',
    'rooms/heart_beat.mp3',
    'rooms/cutlery_far.mp3',
    'rooms/fork_down_1.mp3',
    'rooms/duct_scrape_long.mp3',
    'rooms/duct_hit_low.mp3',
    'rooms/duct_hit_high.mp3',
    'rooms/duct_wet_behind.mp3',
    'rooms/panel_buckle.mp3',
    'rooms/bolts_fall.mp3',
    'rooms/whoosh_fall.mp3',
    'rooms/metal_crash.mp3',
    'rooms/metal_crash_2.mp3',
    'rooms/scrap_fall.mp3',
  ],
};

/** The section of the duct (m), where it is wide and where it has narrowed. */
const WIDE = { w: 0.7, h: 0.55 };
const NARROW = { w: 0.45, h: 0.35 };
const HALF_W = WIDE.w / 2;
/** Where it narrows (z, m); how far it runs behind the start and ahead. */
const TAPER_FROM = -4.6;
const TAPER_TO = -5.6;
const BACK_Z = 18;
const END_Z = -11;
/** One sheet of the duct is this long (m); a joint between each two. */
const JOINT = 0.9;
/** The grille in the floor: center z, half its size, pitch and half the width of its bars (m). */
const GRILLE_Z = -4.05;
const GRILLE_HALF = 0.25;
const BAR_GAP = 0.085;
const BAR_HALF = 0.0028;
/** How far under the grille the light that comes through it seems to stand (m). */
const GOBO_DEPTH = 1.5;
/** The sheet of floor that gives way (z, m). */
const PANEL_FROM = -6.3;
const PANEL_TO = -7.2;
/** Where you are stuck (z, m), how far along the duct its walls close in (m) and by what share at the end. */
const STUCK_Z = -6.95;
const PRESS_REACH = 1.7;
const PRESS_W = 0.3;
const PRESS_H = 0.25;
/** Past here (z, m) the duct draws out while you are stuck, by this share of what lies beyond. */
const DRAW_FROM = -8;
const DRAW_OUT = 0.9;
/** Centimeters the viewer's legs can buy, how fast (m/s at full legs), and what each buys in walls. */
const BUY_MAX = 0.16;
const BUY_RATE = 0.075;
const BUY_PRESS = 0.3;
/** Slots for dents on the roof at once. */
const DENT_SLOTS = 5;

/** The room below: floor and lamp height (m), its size, the table's center. */
const DINING = { floor: -3.72, lamp: -1.92, w: 5.4, d: 4.6, h: 3.67 };
const TABLE = { x: 0.12, z: -4.05, top: 0.877, sideZ: 0.98, endX: 1.4 };
/** Seated: height of the hips, the frozen time of the pose (s). */
const SEAT_HIPS = 0.57;
const SIT_TIME = 4.2;
/** How far her neck takes her face up (rad, spread over spine, neck and head), and when (s). */
const LOOK_UP = { from: 17.3, to: 20.6, bends: [0.14, 0.42, 0.66] };
const LOOK_BONES = ['Bip01_Spine2', 'Bip01_Neck', 'Bip01_Head'] as const;
/** How fast his eating clip runs. */
const EATING_RATE = 0.55;

/** Lights: the bounce above the grille, the lamp over the table, the far cold vent, what is around the eye. */
const WARM = 0xffb878;
const COLD = 0x79b9b4;
const PALE = 0xdcd6c6;
const BOUNCE = 0.8;
const GRILLE_LIGHT = 3.4;
const LAMP_SPOT = 3.6;
const LAMP_FILL = 1.15;
const FACE_LIGHT = 0.3;
const VENT_LIGHT = 1.15;
const EYE_FILL = 0.13;
const DENT_LIGHT = 0.1;
const HAIR_LIGHT = 0.3;

/** Every push of the crawl: when it starts (s), how long it takes (s), how far it goes (m), how hard (1 a plain push). */
const PUSHES: readonly (readonly [number, number, number, number])[] = [
  [0.7, 1.0, 0.32, 0.8],
  [2.6, 1.05, 0.46, 1],
  [4.7, 1.0, 0.48, 1],
  [6.6, 1.1, 0.46, 1],
  [8.6, 1.0, 0.48, 1],
  [10.5, 1.1, 0.46, 1],
  [12.4, 1.1, 0.48, 1],
  [14.2, 1.25, 0.46, 0.8],
  [16.0, 1.2, 0.458, 0.5],
  [22.5, 1.0, 0.42, 1.1],
  [23.9, 1.0, 0.46, 1],
  [25.3, 1.05, 0.44, 1],
  [26.7, 1.15, 0.4, 1.1],
  [28.2, 1.2, 0.38, 1.1],
  [29.9, 1.3, 0.36, 1.2],
  [31.7, 1.3, 0.3, 1.2],
  [33.4, 0.9, 0.1, 1.3],
  // stuck: all that strength, and a centimeter or two for it
  [35.3, 1.5, 0.018, 1.5],
  [37.6, 1.4, 0.02, 1.4],
  [41.6, 1.3, 0.016, 1.4],
  [43.8, 1.1, 0.012, 1.1],
  [50.9, 1.2, 0.012, 1.6],
  [53.2, 1.0, 0.01, 1.5],
];
/** Pushes from this one on scrape both shoulders. */
const FIRST_SCRAPE = 11;
const STUCK_FROM = 17;
/** The eye's z after each push. */
const AFTER_PUSH = PUSHES.reduce<number[]>((all, p, i) => [...all, (i ? all[i - 1] : 0) - p[2]], []);
/** What each push does to the eye: dip (m), roll, sway and nod (deg). */
const DIP = 0.018;
const ROLL = 2.6;
const SWAY = 1.4;
const NOD = 1.6;
/** Your hands: how far ahead of where the eye will be each one lands, how far out (m). */
const HAND = { reach: 0.2, x: 0.17, y: 0.05, scale: 0.42 };

/** What crawls on top of the duct: when each hand comes down (s), where (x, z, m), how deep (m), how long it stays (s). */
const STEPS: readonly (readonly [number, number, number, number, number])[] = [
  [25.7, 0.07, -9.0, 0.03, 1.4],
  [27.0, -0.08, -8.6, 0.035, 1.4],
  [28.3, 0.08, -8.25, 0.04, 1.4],
  [29.6, -0.08, -7.95, 0.045, 1.4],
  [30.9, 0.07, -7.7, 0.05, 1.6],
  [32.2, -0.03, -7.5, 0.05, 3.3],
  [35.5, 0.08, -7.1, 0.055, 1.2],
  [36.5, -0.07, -6.75, 0.055, 1.2],
  [37.5, 0.07, -6.35, 0.05, 1.1],
  [38.4, -0.07, -5.95, 0.04, 1.0],
  [39.2, 0.06, -5.55, 0.03, 0.9],
];
const STEP_GAINS = [0.16, 0.2, 0.26, 0.3, 0.36, 0.44, 0.46, 0.46, 0.36, 0.26, 0.16];
/** The body behind those hands: where the sag of the roof is (s, z) and how deep (s, m). */
const SAG_Z: readonly (readonly [number, number])[] = [[25, -9.5], [32.5, -8.0], [35.5, -7.7], [39.8, -5.4]];
const SAG_DEPTH: readonly (readonly [number, number])[] = [[25, 0], [30, 0.018], [33, 0.024], [36.8, 0.042], [39, 0.02], [40.2, 0]];
const SAG_LENGTH = 0.42;

/** The white hair: where its front stands at the start (z), its pace (m/s), how much it gains under the flash (m). */
const HAIR = { start: 8, speed: 0.25, jump: 0.2, depth: 1.5, ropes: 66, perRope: 20, runners: 420, segments: 14 };
/** The hand in the hair: how much ahead of the front, its stride (m), its place in the section (x, y). */
const FOLLOW = { ahead: 0.06, step: 0.42, x: 0.1, y: 0.3, armY: 0.185, scale: 0.55, gap: 0.13 };
/** Turning round as far as a neck can: deg, m, and when (s). */
const TURN = { yaw: 179, pitch: -0.5, roll: 8, fov: 21, shift: 0.02, start: 45.2, end: 46.8, back: 49.4, done: 50.6 };
/** The shutter fires once the viewer has held the hair in view this long (s), from this moment on (s), at the latest then. */
const SEEN_HOLD = 0.4;
const SEEN_FROM = 40.5;
const SHUTTER_AT = 46.95;
/** The floor: when it buckles and gives way (s). */
const BUCKLE_AT = 52;
const FALL_AT = 56;
const CRASH_AT = 58;

/** The eye's slow path (s, x, y, yaw, pitch, fov): along z it goes by the pushes. */
const EYE: readonly (readonly [number, number, number, number, number, number])[] = [
  [0, 0.02, 0.215, 0, 1.5, 58],
  [3, 0, 0.21, 0.6, 1, 57],
  [9, -0.02, 0.205, -0.6, 0, 54],
  [13, 0, 0.205, 0, -6, 52],
  [14.7, 0, 0.215, 0, -30, 52],
  [16.4, 0, 0.215, 0, -68, 52],
  [17.5, 0, 0.205, 0, -85, 52],
  [18.8, 0, 0.2, 0, -82, 46],
  [20.7, 0, 0.195, 0, -70, 19],
  [22.35, 0, 0.19, 0, -70, 16],
  [23.0, 0, 0.2, 0, -40, 42],
  [24.1, 0, 0.2, 0, -4, 52],
  [25.3, 0, 0.19, 0, -1, 50],
  [27, 0, 0.17, 0, 0, 48],
  [30, 0, 0.165, 0, 3, 46],
  [32.2, 0, 0.16, 0, 13, 42],
  [33.4, 0, 0.155, 0, 19, 40],
  [35.2, 0, 0.15, 0, 16, 40],
  [36.4, 0, 0.14, 0, 8, 42],
  [38.4, 0, 0.135, 0, 2, 42],
  [42, 0, 0.128, 0, 0, 38],
  [45, 0, 0.122, 0, 0, 34],
  [50.6, 0, 0.122, 0, -2, 34],
  [52, 0, 0.118, 0, -9, 32],
  [54.4, 0, 0.116, 0, -26, 32],
  [56, 0, 0.11, 0, -30, 34],
  [56.8, 0, 0.11, 0, 80, 58],
  [58, 0, 0.11, 0, 84, 66],
];
const FEAR: readonly (readonly [number, number])[] = [[0, 0.24], [14, 0.34], [17, 0.42], [21, 0.62], [24.5, 0.5], [32, 0.68], [39.5, 0.74], [45, 0.82], [47, 0.95], [52, 1], [56, 1], [58, 0.1], [62, 0]];
const FOCUS: readonly (readonly [number, number])[] = [[0, 3.6], [13, 3], [17, 3.1], [20.7, 2.7], [22.4, 2.7], [23.5, 3], [31, 1.1], [33.4, 0.62], [36, 0.6], [38.5, 2.6], [45, 3], [46.8, 2.8], [50, 2.2], [52, 1.2], [56, 1]];

const f = (n: number): string => n.toFixed(4);

/** The section of the duct at z: how much of the wide one is left, in x and y. */
const SECTION_GLSL = /* glsl */ `
uniform float uPress;
vec2 crawlSection(float z) {
  float k = clamp((z - ${f(TAPER_FROM)}) / ${f(TAPER_TO - TAPER_FROM)}, 0.0, 1.0);
  k = k * k * (3.0 - 2.0 * k);
  float away = (z - ${f(STUCK_Z)}) / ${f(PRESS_REACH)};
  float near = exp(-away * away) * k * uPress;
  return vec2(mix(1.0, ${f(NARROW.w / WIDE.w)}, k) * (1.0 - ${f(PRESS_W)} * near), mix(1.0, ${f(NARROW.h / WIDE.h)}, k) * (1.0 - ${f(PRESS_H)} * near));
}
`;

/** A hand lying flat, as a signed distance (m): fingers toward +y. */
const HAND_GLSL = /* glsl */ `
float crawlBone(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)) - r;
}
float crawlHand(vec2 p) {
  float d = length((p - vec2(0.0, -0.005)) * vec2(1.0, 0.82)) - 0.052;
  d = min(d, crawlBone(p, vec2(-0.04, 0.05), vec2(-0.052, 0.125), 0.0105));
  d = min(d, crawlBone(p, vec2(-0.014, 0.06), vec2(-0.018, 0.16), 0.0115));
  d = min(d, crawlBone(p, vec2(0.012, 0.06), vec2(0.016, 0.15), 0.0115));
  d = min(d, crawlBone(p, vec2(0.037, 0.05), vec2(0.048, 0.112), 0.01));
  d = min(d, crawlBone(p, vec2(0.05, -0.02), vec2(0.098, 0.035), 0.0125));
  return d;
}
`;

const TUBE_VERT = /* glsl */ `
${SECTION_GLSL}
${HAND_GLSL}
uniform vec4 uDents[${DENT_SLOTS}];
uniform vec3 uSag;
uniform vec2 uBuckle;
uniform float uDraw;
attribute float aHard;
varying vec3 vRef;
varying vec3 vRefN;
varying float vHard;

float crawlDents(vec2 q) {
  float deepest = 0.0;
  for (int i = 0; i < ${DENT_SLOTS}; i++) {
    vec4 d = uDents[i];
    if (d.z <= 0.0) continue;
    vec2 r = q - d.xy;
    float away = dot(r, r);
    if (away > 0.12) continue;
    r.x *= d.w;
    float mark = 1.0 - smoothstep(-0.016, 0.024, crawlHand(r));
    deepest = max(deepest, d.z * max(mark, 0.4 * exp(-away / 0.024)));
  }
  return deepest;
}

vec3 crawlAt(vec3 p) {
  vec2 section = crawlSection(p.z);
  vec3 q = vec3(p.x * section.x, p.y * section.y, p.z);
  float up = smoothstep(${f(WIDE.h * 0.82)}, ${f(WIDE.h)}, p.y);
  if (up > 0.0) {
    float along = (q.z - uSag.x) / uSag.z;
    float across = q.x / ${f(NARROW.w / 2)};
    q.y -= up * (crawlDents(q.xz) + uSag.y * exp(-along * along) * max(0.0, 1.0 - across * across));
  }
  float low = 1.0 - smoothstep(0.0, ${f(WIDE.h * 0.18)}, p.y);
  if (low > 0.0 && p.z < ${f(PANEL_FROM + 0.02)} && p.z > ${f(PANEL_TO - 0.02)}) {
    float bend = sin(3.14159 * clamp((p.z - ${f(PANEL_FROM)}) / ${f(PANEL_TO - PANEL_FROM)}, 0.0, 1.0));
    float across = abs(p.x) / ${f(HALF_W)};
    q.y -= low * bend * (uBuckle.x * (1.0 - across * across) + uBuckle.y * (1.0 - across));
  }
  q.x += sin(p.z * 1.9 + 0.7) * 0.004;
  if (p.z < ${f(DRAW_FROM)}) q.z += (p.z - ${f(DRAW_FROM)}) * uDraw;
  return q;
}

vec3 crawlNormal(vec3 p, vec3 n) {
  vec3 a = abs(n.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 u = normalize(cross(n, a));
  vec3 v = cross(n, u);
  vec3 o = crawlAt(p);
  vec3 m = normalize(cross(crawlAt(p + u * 0.004) - o, crawlAt(p + v * 0.004) - o));
  return dot(m, n) < 0.0 ? -m : m;
}
`;

const TUBE_FRAG_HEAD = /* glsl */ `
${HAND_GLSL}
uniform sampler2D uRustMap;
uniform vec3 uGrilleLight;
varying vec3 vRef;
varying vec3 vRefN;
varying float vHard;
float crawlHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float crawlNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 s = fract(p);
  s = s * s * (3.0 - 2.0 * s);
  return mix(mix(crawlHash(i), crawlHash(i + vec2(1.0, 0.0)), s.x), mix(crawlHash(i + vec2(0.0, 1.0)), crawlHash(i + vec2(1.0, 1.0)), s.x), s.y);
}
float crawlFbm(vec2 p) { return crawlNoise(p) * 0.55 + crawlNoise(p * 2.1 + 3.1) * 0.3 + crawlNoise(p * 4.3 + 7.7) * 0.15; }
`;

/** Old galvanized sheet: every sheet its own age, rust from the joints, dust on what faces up, cleaned down the middle by whoever went before. */
const TUBE_GRIME = /* glsl */ `
vec3 tubeN = normalize(vRefN);
bool tubeFlat = abs(tubeN.y) > 0.5;
float tubeAcross = tubeFlat ? vRef.x / ${f(HALF_W)} : (vRef.y - ${f(WIDE.h / 2)}) / ${f(WIDE.h / 2)};
float tubeFace = tubeFlat ? (tubeN.y > 0.0 ? 1.0 : 2.0) : (tubeN.x > 0.0 ? 3.0 : 4.0);
vec2 tubeSheet = (tubeFlat ? vRef.xz : vRef.yz) + tubeFace * 3.7;
float tubeSeed = crawlHash(vec2(floor(vRef.z / ${f(JOINT)}), tubeFace));
float tubeJoint = abs(fract(vRef.z / ${f(JOINT)} + 0.5) - 0.5) * ${f(JOINT)};
float tubeBig = crawlFbm(tubeSheet * vec2(2.4, 1.2) + tubeSeed * 17.0);
float tubeFine = crawlFbm(tubeSheet * 13.0);
float tubeBias = 0.22 + 0.4 * (1.0 - smoothstep(0.0, 0.2, tubeJoint)) + 0.2 * smoothstep(0.7, 1.0, abs(tubeAcross)) + (tubeSeed - 0.5) * 0.5;
float tubeRust = smoothstep(0.66 - tubeBias * 0.45, 0.86 - tubeBias * 0.45, tubeBig + tubeFine * 0.18);
vec3 tubeRustColor = texture2D(uRustMap, tubeSheet * 0.8).rgb * vec3(0.95, 0.72, 0.55);
diffuseColor.rgb *= mix(0.55, 1.05, tubeSeed);
diffuseColor.rgb = mix(diffuseColor.rgb, tubeRustColor, tubeRust);
float tubeDust = 0.0;
if (tubeN.y > 0.5) {
  float lump = crawlFbm(tubeSheet * vec2(5.0, 2.2));
  float track = 1.0 - smoothstep(0.16, 0.42, abs(tubeAcross + 0.06 * sin(vRef.z * 1.7)));
  tubeDust = clamp(0.4 + smoothstep(0.4, 1.0, abs(tubeAcross)) * 0.55 + (lump - 0.5) * 1.35 - track * 0.7, 0.0, 1.0);
  if (vRef.z < -0.5 && vRef.z > -3.72) {
    float n = floor(vRef.z / 0.44);
    float h = crawlHash(vec2(n, 3.0));
    float lr = mod(n, 2.0) < 0.5 ? 1.0 : -1.0;
    vec2 r = vec2((vRef.x - lr * (0.14 + 0.03 * h)) * lr, vRef.z - (n + 0.5) * 0.44);
    float a = (h - 0.5) * 0.7 - 0.25;
    r = vec2(r.x * cos(a) - r.y * sin(a), r.x * sin(a) + r.y * cos(a));
    tubeDust *= smoothstep(-0.004, 0.008, crawlHand(r * 1.05));
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.17, 0.16, 0.14), tubeDust * 0.9);
}
if (!tubeFlat && abs(tubeN.z) < 0.5) {
  float drip = smoothstep(0.58, 0.9, crawlNoise(vec2(vRef.z * 23.0 + tubeSeed * 5.0, vRef.y * 0.9)));
  diffuseColor.rgb *= 1.0 - drip * smoothstep(0.02, 0.5, vRef.y / ${f(WIDE.h)}) * 0.55;
}
if (vHard > 1.5) diffuseColor.rgb *= 0.1;
if (vHard < 0.5) {
  diffuseColor.rgb *= mix(0.3, 1.0, smoothstep(0.0, 0.26, 1.0 - abs(tubeAcross))) * mix(0.34, 1.0, smoothstep(0.012, 0.07, tubeJoint));
}
`;

/** A sheet stiffened by an X pressed into it, as ducts are: it only shows where light rakes it. */
const TUBE_CREASE = /* glsl */ `
if (vHard < 0.5 && abs(tubeN.z) < 0.5) {
  vec2 facet = vec2(tubeAcross, (fract(vRef.z / ${f(JOINT)}) - 0.5) * 2.0);
  float side = smoothstep(-0.03, 0.03, abs(facet.x) - abs(facet.y));
  vec3 lean = tubeFlat ? vec3(sign(facet.x) * side, 0.0, sign(facet.y) * (1.0 - side)) : vec3(0.0, sign(facet.x) * side, sign(facet.y) * (1.0 - side));
  normal = normalize(normal + mat3(viewMatrix) * lean * (0.012 + 0.03 * tubeSeed));
}
`;

/** What comes up through the grille, its bars thrown on roof and walls. */
const TUBE_GOBO = /* glsl */ `
vec2 goboQ = vec2(vRef.x, vRef.z - ${f(GRILLE_Z)}) * (${f(GOBO_DEPTH)} / (vRef.y + ${f(GOBO_DEPTH)}));
float goboOpen = (1.0 - smoothstep(${f(GRILLE_HALF - 0.015)}, ${f(GRILLE_HALF)}, abs(goboQ.x))) * (1.0 - smoothstep(${f(GRILLE_HALF - 0.015)}, ${f(GRILLE_HALF)}, abs(goboQ.y)));
if (goboOpen > 0.0) {
  float goboBar = smoothstep(${f(BAR_HALF * 1.2)}, ${f(BAR_HALF * 1.2 + 0.01)}, abs(fract(goboQ.y / ${f(BAR_GAP)}) - 0.5) * ${f(BAR_GAP)});
  vec3 goboDir = normalize(vec3(-vRef.x, -vRef.y - ${f(GOBO_DEPTH)}, ${f(GRILLE_Z)} - vRef.z));
  totalEmissiveRadiance += diffuseColor.rgb * uGrilleLight * goboOpen * goboBar * max(dot(normal, normalize(mat3(viewMatrix) * goboDir)), 0.0);
}
`;

/** Long hair on a head: rooted on the skull, it goes wherever the head goes and hangs where gravity says. */
const MANE_VERT = /* glsl */ `
attribute vec4 aStrand;
attribute vec4 aFlow;
attribute float aShade;
uniform mat4 uHead;
uniform float uManeTime;
varying vec3 vHair;
vec3 maneAt(float v) {
  return (uHead * vec4(position, 1.0)).xyz
    + vec3(aFlow.x, 0.0, aFlow.y) * (v * aFlow.z + sin(v * 9.0 + aStrand.w) * 0.016 * v)
    + vec3(sin(uManeTime * 0.7 + aStrand.w + v * 3.0) * 0.012 * v, -aFlow.w * pow(v, 1.15), cos(uManeTime * 0.5 + aStrand.w * 1.6) * 0.012 * v);
}
`;

const MANE_POINT = /* glsl */ `
vec3 maneCenter = maneAt(aStrand.z);
vec3 maneEye = cameraPosition - (modelMatrix * vec4(maneCenter, 1.0)).xyz;
vec3 maneSide = normalize(cross(normalize(maneAt(aStrand.z + 0.08) - maneCenter), normalize(maneEye)) + vec3(0.00001));
vec3 transformed = maneCenter + maneSide * aStrand.x * aStrand.y * (1.0 - aStrand.z * 0.7);
vHair = vec3(0.44, 0.42, 0.37) * aShade * (1.0 - 0.45 * aStrand.z) * mix(0.45, 1.0, smoothstep(0.0, 0.2, aStrand.z));
`;

const HAIR_VERT = /* glsl */ `
${SECTION_GLSL}
attribute vec3 aNext;
attribute vec4 aStrand;
attribute vec2 aLook;
uniform float uFront;
uniform float uHairTime;
uniform float uHairLit;
uniform float uHairGlow;
uniform vec3 uHollow;
varying vec3 vHair;
vec3 hairAt(vec3 p) {
  p.z += uFront;
  p.x += aStrand.z * 0.014 * sin(uHairTime * 0.63 + aStrand.w + p.y * 5.0);
  p.y += aStrand.z * 0.006 * cos(uHairTime * 0.47 + aStrand.w * 1.7);
  float across = p.x - uHollow.x;
  float above = (p.y - uHollow.y) / (uHollow.z * 1.9);
  p.x += (across < 0.0 ? -1.0 : 1.0) * max(0.0, uHollow.z * max(0.0, 1.0 - above * above) * (1.0 - smoothstep(0.55, 1.25, aLook.y)) * (1.0 + 0.32 * fract(aStrand.w * 7.31)) - abs(across));
  p.x = clamp(p.x, ${f(-HALF_W + 0.004)}, ${f(HALF_W - 0.004)});
  p.y = clamp(p.y, 0.004, ${f(WIDE.h - 0.004)});
  vec2 section = crawlSection(p.z);
  return vec3(p.x * section.x, p.y * section.y, p.z);
}
`;

const HAIR_POINT = /* glsl */ `
vec3 hairCenter = hairAt(position);
vec3 hairEye = cameraPosition - (modelMatrix * vec4(hairCenter, 1.0)).xyz;
float hairDist = length(hairEye);
vec3 hairSide = normalize(cross(normalize(hairAt(aNext) - hairCenter), hairEye / hairDist) + vec3(0.00001));
vec3 transformed = hairCenter + hairSide * aStrand.x * aStrand.y * (1.0 - aStrand.z * 0.75) * clamp(hairDist / 2.6, 0.08, 1.0);
float hairGrille = (hairCenter.z - ${f(GRILLE_Z)}) / 0.6;
float hairUp = position.y / ${f(WIDE.h)};
float hairNear = smoothstep(0.75, 2.1, length(position.xy - uHollow.xy) / uHollow.z);
vHair = smoothstep(0.1, 0.8, hairDist) * vec3(0.62, 0.6, 0.54) * aLook.x * mix(1.0, 0.16, smoothstep(0.04, 1.2, aLook.y)) * mix(0.5, 1.0, smoothstep(0.08, 0.95, hairUp)) * mix(0.4, 1.0, hairNear) * uHairLit
  + vec3(1.0, 0.56, 0.26) * exp(-hairGrille * hairGrille) * (1.0 - 0.7 * hairUp) * uHairGlow * (0.25 + 0.5 * aLook.x);
`;

type V = readonly [number, number, number];

/** Evenly spaced values from a to b, about `step` apart. */
function span(a: number, b: number, step: number): number[] {
  const n = Math.max(1, Math.ceil(Math.abs(b - a) / step));
  return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
}

/** Several spans, end to end. */
function spans(...parts: readonly (readonly [number, number, number])[]): number[] {
  const out: number[] = [];
  parts.forEach((p, i) => out.push(...span(p[0], p[1], p[2]).slice(i === 0 ? 0 : 1)));
  return out;
}

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sheet metal in the duct's own straight frame: the shader narrows, dents and buckles it. */
class Sheet {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly hards: number[] = [];
  private readonly indices: number[] = [];

  grid(us: readonly number[], vs: readonly number[], at: (u: number, v: number) => V, normal: V | ((u: number, v: number) => V), hard = 0): void {
    const base = this.positions.length / 3;
    const across = us.length;
    const a = at(us[0], vs[0]);
    const b = at(us[1], vs[0]);
    const c = at(us[0], vs[1]);
    const n0 = typeof normal === 'function' ? normal(us[0], vs[0]) : normal;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const straight = (uy * vz - uz * vy) * n0[0] + (uz * vx - ux * vz) * n0[1] + (ux * vy - uy * vx) * n0[2] > 0;
    for (const v of vs) {
      for (const u of us) {
        const p = at(u, v);
        const n = typeof normal === 'function' ? normal(u, v) : normal;
        this.positions.push(p[0], p[1], p[2]);
        this.normals.push(n[0], n[1], n[2]);
        this.uvs.push(Math.abs(n[0]) > 0.5 ? p[2] : p[0], Math.abs(n[1]) > 0.5 ? p[2] : p[1]);
        this.hards.push(hard);
      }
    }
    for (let j = 0; j < vs.length - 1; j++) {
      for (let i = 0; i < across - 1; i++) {
        const k = base + j * across + i;
        if (straight) this.indices.push(k, k + 1, k + across, k + 1, k + across + 1, k + across);
        else this.indices.push(k, k + across, k + 1, k + 1, k + across, k + across + 1);
      }
    }
  }

  /** A low dome on a surface. */
  rivet(c: V, n: V): void {
    const a: V = Math.abs(n[1]) > 0.5 ? [1, 0, 0] : [0, 1, 0];
    const b: V = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
    const radial = (u: number, k: number): number => a[k] * Math.cos(u) + b[k] * Math.sin(u);
    const rings = [0.0068, 0.0046, 0.0001];
    const rises = [0, 0.0028, 0.004];
    const leans = [0.9, 0.55, 0];
    this.grid(
      span(0, Math.PI * 2, Math.PI / 3),
      [0, 1, 2],
      (u, v) => [c[0] + radial(u, 0) * rings[v] + n[0] * rises[v], c[1] + radial(u, 1) * rings[v] + n[1] * rises[v], c[2] + radial(u, 2) * rings[v] + n[2] * rises[v]],
      (u, v) => {
        const l = leans[v];
        const x = radial(u, 0) * l + n[0] * (1 - l);
        const y = radial(u, 1) * l + n[1] * (1 - l);
        const z = radial(u, 2) * l + n[2] * (1 - l);
        const m = Math.hypot(x, y, z);
        return [x / m, y / m, z / m];
      },
      1,
    );
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setIndex(this.indices);
    g.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('uv1', new Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('aHard', new Float32BufferAttribute(this.hards, 1));
    return g;
  }
}

const nodAxis = new Quaternion();

/**
 * On your belly in a sheet-metal duct. A square of light far ahead comes up from a grille, and through the grille,
 * straight down, the table: they are eating, one of them stops and looks up. Then the duct narrows; something crawls
 * back along the roof with hands that dent it; you are stuck, and the only thing that still moves in here is what is
 * behind you. White hair fills the tube, at your own pace, and it has a hand. There is no room to turn.
 */
export default class Crawl extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x050807, density: 0.14 },
    env: 'bathroom',
    envIntensity: 0.05,
    sky: 0,
    grade: { exposure: 1.25, saturation: 0.78, warmth: 0.03, tint: -0.015, flare: 0.002 },
  };
  control: RoomControl = { look: true, scroll: true, hurry: 1.6 };
  fear = 0.24;
  drift = 0;
  film: RoomFilm = { bloom: 0.75, bloomFrom: 0.72, grain: 0.42, scratches: 0.05, flicker: 0.02, weave: 0.0004, barrel: 0.08, aberration: 0.03 };
  focus = 3.6;
  aperture = 4;

  private readonly shape = {
    uPress: { value: 0 },
    uDents: { value: Array.from({ length: DENT_SLOTS }, () => new Vector4()) },
    uSag: { value: new Vector3(0, 0, SAG_LENGTH) },
    uBuckle: { value: new Vector2() },
    uDraw: { value: 0 },
    uGrilleLight: { value: new Color() },
  };
  private readonly hairShape = {
    uPress: this.shape.uPress,
    uFront: { value: HAIR.start },
    uHairTime: { value: 0 },
    uHairLit: { value: 0.8 },
    uHairGlow: { value: 0 },
    uHollow: { value: new Vector3(FOLLOW.x, FOLLOW.y + 0.015, FOLLOW.gap) },
  };
  private readonly clocks: { value: number }[] = [];
  private readonly fearAt = new GlideTrack(FEAR.map((k) => k[0]), FEAR.map((k) => k[1]));
  private readonly focusAt = new GlideTrack(FOCUS.map((k) => k[0]), FOCUS.map((k) => k[1]));
  private readonly sagZAt = new GlideTrack(SAG_Z.map((k) => k[0]), SAG_Z.map((k) => k[1]));
  private readonly sagDepthAt = new GlideTrack(SAG_DEPTH.map((k) => k[0]), SAG_DEPTH.map((k) => k[1]));

  private readonly dining = new Group();
  private readonly mother: HeroFigure;
  private readonly father: HeroFigure;
  private readonly motherBones: Bone[] = [];
  private readonly motherAxes: Vector3[] = [];
  private readonly motherRest: Quaternion[] = [];
  private readonly manes: { bone: Bone; matrix: { value: Matrix4 } }[] = [];
  private readonly motherHead: Vector3;
  private lampShade!: MeshStandardMaterial;
  private grilleGlow!: Mesh;
  private sheetLight!: MeshBasicMaterial;
  private dentLight!: DreamLight;
  private hair!: Mesh;
  private readonly pours: Mesh[] = [];
  private panelHinge!: Object3D;
  private ventCover!: Object3D;
  private ventBack!: Mesh;
  private ventGlow!: Mesh;
  private ventPlane!: MeshBasicMaterial;
  private readonly hands: Object3D[] = [];
  private follower!: Object3D;
  private gapShade!: Mesh;
  private vignette!: Mesh;
  private vignetteMaterial!: MeshBasicMaterial;
  private shoulder!: Mesh;
  private shoulderMaterial!: MeshBasicMaterial;
  private lensHair!: BufferGeometry;
  private lensHairMaterial!: MeshBasicMaterial;
  private lensHairCount = 0;

  private bounce!: DreamLight;
  private below!: DreamLight;
  private cold!: DreamLight;
  private eyeFill!: DreamLight;
  private hairLight!: DreamLight;

  private airBed: RoomVoice | null = null;
  private drone: RoomVoice | null = null;
  private fridge: RoomVoice | null = null;
  private dinner: RoomVoice | null = null;
  private breath: RoomVoice | null = null;
  private heart: RoomVoice | null = null;
  private wet: RoomVoice | null = null;

  /** Where the crawl has the eye, set by `crawl`. */
  private eyeZ = 0;
  private pushArc = 0;
  private pushSide = 1;
  private bought = 0;
  private gazeYaw = 0;
  private gazePitch = 0;
  private ownYaw = 0;
  private turnSide = 0;
  private sink = 0;
  private seenFor = 0;
  private looksAhead = true;
  private shot = false;
  private nextStrain = 0;
  private strainCount = 0;
  private nextPan = 0;

  constructor(ctx: RoomContext) {
    super(ctx);
    this.buildDuct();
    this.buildGrilleLight();
    this.mother = this.seat({ avatar: 'figure_woman', clip: 'm_sit_chair_idle_roll_head', time: SIT_TIME, face: 'blank', bleach: 0.6, tint: 0x847c72 }, TABLE.x - 0.42, TABLE.z - TABLE.sideZ + 0.04, 0, SIT_TIME);
    this.father = this.seat({ avatar: 'figure_man', clip: 'm_idle_touch_face_01', time: 1.4, face: 'blank', bleach: 0.45, tint: 0x70737a }, TABLE.x - TABLE.endX + 0.06, TABLE.z + 0.03, Math.PI / 2, 1.4);
    this.dining.updateMatrixWorld(true);
    this.motherHead = this.mother.bone('Bip01_Head')!.getWorldPosition(new Vector3());
    this.keys = EYE.map((k) => this.aimed(k, ctx.seconds));
    this.buildDining();
    this.blankFace(this.mother);
    this.growMane(this.motherBones[2], 520, 61);
    this.growMane(this.father.bone('Bip01_Head')!, 300, 83);
    this.buildHair();
    this.buildHands();
    this.buildLens();
    this.placeBeats();
    this.spots = [this.spot([TABLE.x, DINING.lamp, TABLE.z], [TABLE.x, DINING.floor, TABLE.z], WARM, LAMP_SPOT, 50, 0.35), null, null];
  }

  /** A key of the eye: those that hold on her look straight at where her head will be. */
  private aimed(k: (typeof EYE)[number], length: number): RoomKey {
    if (k[0] < 20 || k[0] > 23) return { t: k[0] / length, at: [k[1], k[2], 0], yaw: k[3], pitch: k[4], fov: k[5] };
    if (k[0] === 23.0) return { t: k[0] / length, at: [k[1], k[2], 0], yaw: k[3], pitch: k[4], fov: k[5] };
    const h = this.motherHead;
    const dx = h.x - k[1];
    const dz = h.z - 0.05 - AFTER_PUSH[8];
    const aim = Math.atan2(-dx, -dz);
    return { t: k[0] / length, at: [k[1], k[2], 0], yaw: aim / DEG, pitch: Math.atan2(h.y + 0.04 - k[2], Math.hypot(dx, dz)) / DEG, fov: k[5] };
  }

  /** The duct's shape on any metal of it: one program. */
  private dress(material: MeshStandardMaterial, rust: Texture): MeshStandardMaterial {
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, this.shape, { uRustMap: { value: rust } });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${TUBE_VERT}`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = crawlNormal(position, normal);')
        .replace('#include <begin_vertex>', 'vec3 transformed = crawlAt(position);\nvRef = position;\nvRefN = normal;\nvHard = aHard;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${TUBE_FRAG_HEAD}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${TUBE_GRIME}`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(clamp(roughnessFactor, 0.42, 0.9), 0.97, max(tubeDust, tubeRust));')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(0.38, 0.0, max(tubeDust, tubeRust * 0.9));')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${TUBE_CREASE}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${TUBE_GOBO}`);
    };
    material.customProgramCacheKey = () => 'crawl-tube';
    return material;
  }

  private buildDuct(): void {
    const k = this.kit;
    const rust = k.surface('rust_sheet', 1.25).map!;
    rust.wrapS = rust.wrapT = RepeatWrapping;
    const metal = this.dress(k.surface('duct_galvanized', 1, { color: new Color(0x8c9a95) }), rust);
    const W = HALF_W;
    const H = WIDE.h;
    const sheet = new Sheet();
    const xs = span(-W, W, 0.03);
    const ys = span(0, H, 0.055);
    const up: V = [0, 1, 0];
    const down: V = [0, -1, 0];
    const flat = (y: number) => (u: number, v: number): V => [u, y, v];

    // the floor, with the grille's hole in it and the one sheet that will go
    sheet.grid(xs, spans([BACK_Z, 1, 0.6], [1, GRILLE_Z + GRILLE_HALF, 0.08]), flat(0), up);
    sheet.grid(span(-W, -GRILLE_HALF, 0.03), span(GRILLE_Z + GRILLE_HALF, GRILLE_Z - GRILLE_HALF, 0.08), flat(0), up);
    sheet.grid(span(GRILLE_HALF, W, 0.03), span(GRILLE_Z + GRILLE_HALF, GRILLE_Z - GRILLE_HALF, 0.08), flat(0), up);
    sheet.grid(xs, span(GRILLE_Z - GRILLE_HALF, PANEL_FROM, 0.06), flat(0), up);
    sheet.grid(xs, span(PANEL_TO, END_Z, 0.1), flat(0), up);

    // the roof: fine where hands will press it
    const roofRows = (a: number, b: number, step: number, across: number) => sheet.grid(span(-W, W, across), span(a, b, step), flat(H), down);
    roofRows(BACK_Z, 1, 0.6, 0.05);
    roofRows(1, -5.2, 0.08, 0.05);
    roofRows(-5.2, -8.2, 0.0125, 0.0125);
    roofRows(-8.2, -9.5, 0.025, 0.025);
    roofRows(-9.5, END_Z, 0.12, 0.05);

    const wallRows = spans([BACK_Z, 1, 0.6], [1, -4.4, 0.1], [-4.4, -5.8, 0.04], [-5.8, END_Z, 0.09]);
    sheet.grid(ys, wallRows, (u, v) => [-W, u, v], [1, 0, 0]);
    sheet.grid(ys, wallRows, (u, v) => [W, u, v], [-1, 0, 0]);
    sheet.grid(xs, ys, (u, v) => [u, v, END_Z], [0, 0, 1]);
    sheet.grid(xs, ys, (u, v) => [u, v, BACK_Z], [0, 0, -1]);

    // joints, their rivets, and the locked seams in the corners
    const rise = 0.007;
    const lip = 0.014;
    const ribXs = span(-W, W, 0.04);
    const ribYs = span(0, H, 0.06);
    const rivetXs = span(-W + 0.05, W - 0.05, 0.1);
    const rivetYs = span(0.05, H - 0.05, 0.1);
    for (let n = Math.ceil(BACK_Z / JOINT); n * JOINT >= END_Z; n--) {
      const z = n * JOINT;
      for (const [y0, y1, nY] of [[0, rise, 1], [H, H - rise, -1]] as const) {
        sheet.grid(ribXs, [z + lip, z - lip], (u, v) => [u, y1, v], [0, nY, 0], 1);
        sheet.grid(ribXs, [y0, y1], (u, v) => [u, v, z + lip], [0, 0, 1], 1);
        sheet.grid(ribXs, [y0, y1], (u, v) => [u, v, z - lip], [0, 0, -1], 1);
        for (const x of rivetXs) sheet.rivet([x, y1, z + lip * 0.55], [0, nY, 0]);
      }
      for (const [x0, x1, nX] of [[-W, -W + rise, 1], [W, W - rise, -1]] as const) {
        sheet.grid(ribYs, [z + lip, z - lip], (u, v) => [x1, u, v], [nX, 0, 0], 1);
        sheet.grid([x0, x1], ribYs, (u, v) => [u, v, z + lip], [0, 0, 1], 1);
        sheet.grid([x0, x1], ribYs, (u, v) => [u, v, z - lip], [0, 0, -1], 1);
        for (const y of rivetYs) sheet.rivet([x1, y, z + lip * 0.55], [nX, 0, 0]);
      }
    }
    const seamRows = span(BACK_Z, END_Z, 0.25);
    const seam = 0.016;
    const diag = Math.SQRT1_2;
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      const y0 = sy > 0 ? 0 : H;
      sheet.grid([0, 1], seamRows, (u, v) => [sx * (W - seam * (1 - u)), y0 + sy * seam * u, v], [-sx * diag, sy * diag, 0]);
    }

    // the grille: its frame and its bars, across the duct
    const frame = 0.02;
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
      sheet.grid([x0, (x0 + x1) / 2, x1], [z0, z1], (u, v) => [u, y1, v], up, 2);
      sheet.grid([x0, x1], [y0, y1], (u, v) => [u, v, z0], [0, 0, 1], 2);
      sheet.grid([x0, x1], [y0, y1], (u, v) => [u, v, z1], [0, 0, -1], 2);
      sheet.grid([z0, z1], [y0, y1], (u, v) => [x0, v, u], [-1, 0, 0], 2);
      sheet.grid([z0, z1], [y0, y1], (u, v) => [x1, v, u], [1, 0, 0], 2);
    };
    const G = GRILLE_HALF;
    box(-G - frame, G + frame, -0.03, 0.006, GRILLE_Z + G + frame, GRILLE_Z + G);
    box(-G - frame, G + frame, -0.03, 0.006, GRILLE_Z - G, GRILLE_Z - G - frame);
    box(-G - frame, -G, -0.03, 0.006, GRILLE_Z + G, GRILLE_Z - G);
    box(G, G + frame, -0.03, 0.006, GRILLE_Z + G, GRILLE_Z - G);
    for (let n = -3; n < 3; n++) {
      const z = GRILLE_Z + (n + 0.5) * BAR_GAP;
      box(-G, G, -0.024, 0.003, z + BAR_HALF, z - BAR_HALF);
    }

    this.root.add(new Mesh(sheet.geometry(), metal));

    // the sheet that goes: it turns about the joint behind it
    const panelSheet = new Sheet();
    panelSheet.grid(span(-W, W, 0.02), span(PANEL_FROM, PANEL_TO, 0.03), flat(0), up);
    const panel = new Mesh(panelSheet.geometry(), metal);
    panel.frustumCulled = false;
    panel.position.z = -PANEL_FROM;
    this.panelHinge = new Object3D();
    this.panelHinge.position.z = PANEL_FROM;
    this.panelHinge.add(panel);
    this.root.add(this.panelHinge);

    // from below, the duct is only a black shape with a hole in it
    const black = new MeshBasicMaterial({ color: 0x000000, fog: false });
    const under = (x0: number, x1: number, z0: number, z1: number) => {
      const m = k.floor(x0, x1, z1, z0, -0.016, black);
      m.rotation.x = Math.PI / 2;
      this.root.add(m);
    };
    under(-7, 7, PANEL_TO + 0.05, -14);
    under(-7, 7, -4.72, PANEL_FROM - 0.05);
    under(-7, -0.16, PANEL_FROM - 0.05, PANEL_TO + 0.05);
    under(0.16, 7, PANEL_FROM - 0.05, PANEL_TO + 0.05);

    // far ahead, a vent with something cold behind it
    this.ventCover = k.paint(k.prop('vent_cover', [0, 0.03, END_Z + 0.03], { scale: 0.75 }, this.root), new MeshStandardMaterial({ color: 0x23292a, roughness: 0.55, metalness: 0.4 }));
    this.ventPlane = new MeshBasicMaterial({ color: COLD, fog: false });
    this.ventBack = new Mesh(new PlaneGeometry(0.3, 0.24), this.ventPlane);
    this.ventBack.position.set(0, 0.17, END_Z + 0.012);
    this.root.add(this.ventBack);
    this.ventGlow = this.build.glow(0, 0.17, END_Z + 0.2, 1.1, COLD, 0.5, this.root);
    this.cold = this.light([0, 0.17, END_Z + 0.55], COLD, 0, 6.5);

    // what has been left in here
    k.prop('fork', [0.19, 0.006, -2.46], { rotation: [90, 0, 0] }, this.root).rotation.y = 0.7;
    this.clocks.push(this.build.hair(6, { x: [-0.27, -0.13], y: H - 0.008, z: [-2.1, -1.2] }, [0.1, 0.3], this.root, { width: 0.0008, color: 0x5f5c54, seed: 12 }).time);
    this.clocks.push(this.build.motes(120, { x: [-0.32, 0.32], y: [0.02, 0.52], z: [-10, 2] }, this.root, { size: 0.006, strength: 0.32 }).time);
    this.clocks.push(this.build.motes(70, { x: [-0.28, 0.28], y: [0.02, 0.53], z: [GRILLE_Z - 0.45, GRILLE_Z + 0.45] }, this.root, { size: 0.007, color: WARM, strength: 0.8, seed: 9 }).time);
    this.eyeFill = this.light([0, 0.3, 0], 0x79a8a4, EYE_FILL, 2.2);
    this.hairLight = this.light([0, 0.3, HAIR.start], PALE, 0, 3.2);
    this.dentLight = this.light([-0.04, 0.19, -7.12], COLD, 0, 1.3);
  }

  /** The light through the grille: on the roof it is the shader; here the air it stands in. */
  private buildGrilleLight(): void {
    const b = this.build;
    this.grilleGlow = b.glow(0, 0.1, GRILLE_Z, 1, WARM, 0.2, this.root);
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const rise = g.createLinearGradient(0, 128, 0, 0);
    rise.addColorStop(0, 'rgba(255,196,140,0.95)');
    rise.addColorStop(0.5, 'rgba(255,178,120,0.3)');
    rise.addColorStop(1, 'rgba(255,170,110,0.02)');
    g.fillStyle = rise;
    g.fillRect(0, 0, 128, 128);
    g.globalCompositeOperation = 'destination-in';
    const sides = g.createLinearGradient(0, 0, 128, 0);
    sides.addColorStop(0, 'rgba(0,0,0,0)');
    sides.addColorStop(0.2, 'rgba(0,0,0,1)');
    sides.addColorStop(0.8, 'rgba(0,0,0,1)');
    sides.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sides;
    g.fillRect(0, 0, 128, 128);
    const map = new CanvasTexture(c);
    map.colorSpace = SRGBColorSpace;
    this.sheetLight = new MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false, blending: AdditiveBlending, opacity: 0.4 });
    for (const dz of [-0.14, 0, 0.14]) {
      const plane = new Mesh(new PlaneGeometry(WIDE.w * 0.96, WIDE.h * 0.98), this.sheetLight);
      plane.position.set(0, WIDE.h / 2, GRILLE_Z + dz);
      plane.renderOrder = 2;
      this.root.add(plane);
    }
    this.bounce = this.light([0, 0.3, GRILLE_Z], WARM, BOUNCE, 4.2);
  }

  /** One at the table, by her hips. */
  private seat(spec: FigureSpec, x: number, z: number, heading: number, time: number): HeroFigure {
    const hero = this.kit.figures.hero(spec);
    hero.update(time);
    hero.root.updateMatrixWorld(true);
    const hips = hero.bone('Bip01')!.getWorldPosition(new Vector3());
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    hero.root.rotation.y = heading;
    hero.root.position.set(x - (hips.x * c + hips.z * s), DINING.floor + SEAT_HIPS - hips.y, z - (-hips.x * s + hips.z * c));
    hero.root.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = true;
    });
    this.dining.add(hero.root);
    return hero;
  }

  private buildDining(): void {
    const k = this.kit;
    const b = this.build;
    const group = this.dining;
    this.root.add(group);
    const floor = DINING.floor;
    const tx = TABLE.x;
    const tz = TABLE.z;
    const shell = b.box(DINING.w, DINING.d, DINING.h, { walls: b.damask(PALETTE.damaskGreen), floor: b.checker(0.46) }, group);
    shell.position.set(tx, floor, tz + DINING.d / 2);
    group.add(k.floor(tx - 2.5, tx + 2.5, tz - 2.1, tz + 2.1, floor + 0.006, b.carpet('#2b1310', 0.8)));
    k.prop('dining_table', [tx, floor + 0.006, tz], { castShadow: true }, group);
    const top = floor + 0.006 + TABLE.top;
    const chairs = k.props('dining_chair', 4, { castShadow: true });
    chairs.set(0, tx - 0.42, floor + 0.006, tz - TABLE.sideZ, 0);
    chairs.set(1, tx + 0.1, floor + 0.006, tz + TABLE.sideZ, Math.PI);
    chairs.set(2, tx - TABLE.endX, floor + 0.006, tz, Math.PI / 2);
    chairs.set(3, tx + TABLE.endX, floor + 0.006, tz, -Math.PI / 2);
    chairs.commit();
    group.add(chairs.root);

    const seats: readonly (readonly [number, number, number])[] = [
      [tx - 0.42, tz - 0.46, 0],
      [tx + 0.1, tz + 0.46, Math.PI],
      [tx - 0.84, tz, Math.PI / 2],
      [tx + 0.84, tz, -Math.PI / 2],
    ];
    const plates = k.props('plate', 4);
    const forks = k.props('fork', 4, { rotation: [90, 0, 0] });
    const knives = k.props('knife', 4, { rotation: [90, 0, 0] });
    const meat = k.props('roast_lump', 4, { rotation: [90, 0, 0] });
    seats.forEach(([x, z, h], i) => {
      const rx = Math.cos(h);
      const rz = -Math.sin(h);
      plates.set(i, x, top, z, h);
      forks.set(i, x - 0.16 * rx, top + 0.004, z - 0.16 * rz, h);
      knives.set(i, x + 0.16 * rx, top + 0.004, z + 0.16 * rz, h);
      meat.set(i, x + 0.02, top + 0.014, z - 0.01, h * 1.7 + 0.3, i === 3 ? 2.1 : 1.15);
    });
    for (const crowd of [plates, forks, knives, meat]) {
      crowd.commit();
      group.add(crowd.root);
    }
    k.prop('pot_enamel', [tx + 0.34, top, tz + 0.05], {}, group);
    k.prop('jug', [tx - 0.34, top, tz - 0.02], {}, group);
    k.prop('bread_half', [tx + 0.06, top, tz + 0.1], {}, group);

    // the child is whole, and far down
    const child = k.figures.crowd({ avatar: 'figure_child', clip: 'm_sit_chair_idle_roll_head', time: 2, face: 'blank', bleach: 0.5 }, 1);
    child.set(0, tx + 0.1, floor + 0.13, tz + TABLE.sideZ - 0.02, Math.PI);
    child.commit();
    child.root.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = true;
    });
    group.add(child.root);

    // her neck is posed about the axis that lifts a face
    const forward = new Vector3(0, 0, 1);
    const axis = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
    this.mother.root.updateMatrixWorld(true);
    for (const name of LOOK_BONES) {
      const bone = this.mother.bone(name)!;
      this.motherBones.push(bone);
      this.motherAxes.push(axis.clone().applyQuaternion(bone.getWorldQuaternion(new Quaternion()).invert()));
      this.motherRest.push(bone.quaternion.clone());
    }

    // the lamp: a parchment cone on a cord, seen from above
    const lampY = DINING.lamp;
    this.lampShade = new MeshStandardMaterial({ color: 0x8a6a42, emissive: 0xffa95c, emissiveIntensity: 1.6, roughness: 0.8 });
    const shade = new Mesh(new LatheGeometry([new Vector2(0.17, 0), new Vector2(0.11, 0.1), new Vector2(0.06, 0.16), new Vector2(0.012, 0.17)], 28), this.lampShade);
    shade.position.set(tx, lampY - 0.02, tz);
    group.add(shade);
    const cord = new Mesh(new CylinderGeometry(0.005, 0.005, 1, 6), new MeshStandardMaterial({ color: 0x0c0a08, roughness: 0.7 }));
    const cordFrom = lampY + 0.15;
    cord.scale.y = -0.04 - cordFrom;
    cord.position.set(tx, (cordFrom - 0.04) / 2, tz);
    group.add(cord);
    b.glow(tx, lampY + 0.05, tz, 1.1, WARM, 0.5, group);
    this.below = this.light([tx, -1.3, tz], WARM, LAMP_FILL, 5);
  }

  private buildHair(): void {
    const random = seeded(73);
    const positions: number[] = [];
    const nexts: number[] = [];
    const strands: number[] = [];
    const looks: number[] = [];
    const indices: number[] = [];
    const add = (points: readonly number[], width: number, phase: number, shade: number, depth: number) => {
      const count = points.length / 3;
      const base = positions.length / 3;
      for (let i = 0; i < count; i++) {
        const j = i * 3;
        const n = i < count - 1 ? j + 3 : j;
        const back = i < count - 1 ? j : j - 3;
        for (const side of [-1, 1]) {
          positions.push(points[j], points[j + 1], points[j + 2]);
          if (i < count - 1) nexts.push(points[n], points[n + 1], points[n + 2]);
          else nexts.push(points[j] * 2 - points[back], points[j + 1] * 2 - points[back + 1], points[j + 2] * 2 - points[back + 2]);
          strands.push(side, width, i / (count - 1), phase);
          looks.push(shade, depth);
        }
        if (i < count - 1) {
          const a = base + i * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    };
    const W = HALF_W;
    const H = WIDE.h;
    const S = HAIR.segments;
    for (let r = 0; r < HAIR.ropes; r++) {
      const c0 = -W + ((r + 0.5 + (random() - 0.5) * 0.8) / HAIR.ropes) * 2 * W;
      const depth = Math.pow(random(), 0.7) * HAIR.depth;
      const reach = random() < 0.55 ? 1 : 0.55 + random() * 0.4;
      const waveA = 0.012 + random() * 0.04;
      const waveF = 3 + random() * 5;
      const waveP = random() * 6.283;
      const spread = 0.018 + random() * 0.04;
      const bow = (1 - (c0 / W) * (c0 / W)) * 0.22;
      const shade = 0.34 + 0.66 * random() * random();
      const phase = random() * 6.283;
      for (let n = 0; n < HAIR.perRope; n++) {
        const ox = (random() - 0.5) * 2 * spread;
        const oz = (random() - 0.5) * 0.07;
        const foot = 0.08 + random() * 0.4;
        const points: number[] = [];
        for (let k = 0; k <= S; k++) {
          const v = k / S;
          const narrow = 1 - 0.8 * Math.pow(v, 1.4);
          const fall = Math.min(1, v / 0.9) * reach;
          const toe = reach === 1 ? Math.max(0, (v - 0.82) / 0.18) : 0;
          points.push(
            c0 + ox * narrow + Math.sin(v * waveF + waveP) * waveA * (0.25 + v),
            Math.max(0.003, H * (1 - fall)),
            depth + oz * narrow - bow * Math.sin(Math.PI * Math.min(1, v / 0.9)) + Math.sin(v * waveF * 0.6 + waveP * 1.3) * 0.03 - toe * foot,
          );
        }
        add(points, 0.0015 + random() * 0.0012, phase + random() * 0.4, shade * (0.7 + 0.3 * random()), depth);
      }
    }
    for (let r = 0; r < 5; r++) {
      const c0 = FOLLOW.x + (r - 2) * 0.05 + (random() - 0.5) * 0.02;
      const waveP = random() * 6.283;
      const depth = -0.34 + random() * 0.3;
      for (let n = 0; n < HAIR.perRope; n++) {
        const ox = (random() - 0.5) * 0.05;
        const points: number[] = [];
        for (let k = 0; k <= S; k++) {
          const v = k / S;
          points.push(c0 + ox * (1 - 0.7 * v) + Math.sin(v * 6 + waveP) * 0.02 * v, Math.max(0.003, H * (1 - v)), depth + (random() - 0.5) * 0.01);
        }
        add(points, 0.0014 + random() * 0.001, waveP + random() * 0.4, 0.45 + 0.4 * random(), 0.02);
      }
    }
    for (let i = 0; i < HAIR.runners; i++) {
      const face = random();
      const kind = face < 0.55 ? 0 : face < 0.7 ? 1 : face < 0.85 ? 2 : 3;
      const start = random() * 0.55;
      const length = kind === 0 ? 0.3 + Math.pow(random(), 1.1) * 3.2 : 0.3 + Math.pow(random(), 1.3) * 1.1;
      const across = random() * 2 - 1;
      const wander = 0.05 + random() * 0.14;
      const fine = 0.008 + random() * 0.016;
      const waveF = 2 + random() * 5;
      const waveP = random() * 6.283;
      const lift = 0.003 + random() * 0.012;
      const points: number[] = [];
      for (let k = 0; k <= S; k++) {
        const v = k / S;
        const a = clamp(across + Math.sin(v * waveF + waveP) * wander + Math.sin(v * waveF * 7 + waveP * 3) * fine, -0.97, 0.97);
        const z = start - length * v;
        if (kind === 0) points.push(a * W, lift, z);
        else if (kind === 1) points.push(-W + lift, (a * 0.5 + 0.5) * H, z);
        else if (kind === 2) points.push(W - lift, (a * 0.5 + 0.5) * H, z);
        else points.push(a * W, H - lift, z);
      }
      add(points, 0.0007 + random() * 0.0006, random() * 6.283, kind === 0 ? 0.42 + 0.45 * random() : 0.3 + 0.35 * random(), 0);
    }
    const geometry = new BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aNext', new Float32BufferAttribute(nexts, 3));
    geometry.setAttribute('aStrand', new Float32BufferAttribute(strands, 4));
    geometry.setAttribute('aLook', new Float32BufferAttribute(looks, 2));
    const material = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide });
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, this.hairShape);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${HAIR_VERT}`)
        .replace('#include <begin_vertex>', HAIR_POINT);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vHair;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vHair;');
    };
    material.customProgramCacheKey = () => 'crawl-hair';
    this.hair = new Mesh(geometry, material);
    this.hair.frustumCulled = false;
    this.root.add(this.hair);

    // and once there is a hole, it comes after you
    for (const x of [[-0.16, -0.05], [0.05, 0.16]] as const) {
      const pour = this.build.hair(60, { x, y: 0, z: [PANEL_TO + 0.06, PANEL_FROM - 0.08] }, [0.25, 1], this.root, { width: 0.001, color: 0x7f7c72, seed: 31 });
      pour.mesh.visible = false;
      this.pours.push(pour.mesh);
      this.clocks.push(pour.time);
    }
  }

  /** Where her face was, a smooth oval: painted faces read as glasses or a game from up here. */
  private blankFace(hero: HeroFigure): void {
    const head = hero.bone('Bip01_Head')!;
    head.updateWorldMatrix(true, false);
    const headAt = head.getWorldPosition(new Vector3());
    const turned = head.getWorldQuaternion(new Quaternion());
    const left = hero.bone('Bip01_LEye')!.getWorldPosition(new Vector3());
    const right = hero.bone('Bip01_REye')!.getWorldPosition(new Vector3());
    const eyes = left.clone().add(right).multiplyScalar(0.5);
    const across = left.clone().sub(right).normalize();
    const skull = eyes.clone().sub(headAt);
    // in this skeleton X runs up through the skull
    const up = new Vector3(1, 0, 0).applyQuaternion(turned);
    if (up.y < 0) up.negate();
    const front = new Vector3().crossVectors(across, up).normalize();
    if (front.dot(skull) < 0) front.negate();
    const x = new Vector3().crossVectors(up, front).normalize();
    const oval = new Mesh(new SphereGeometry(1, 24, 18), new MeshStandardMaterial({ color: 0xb6ac9d, roughness: 0.78 }));
    oval.position.copy(eyes).addScaledVector(front, -0.018).addScaledVector(up, -0.024).applyMatrix4(head.matrixWorld.clone().invert());
    oval.quaternion.copy(turned.clone().invert()).multiply(new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, up, front)));
    const size = head.getWorldScale(new Vector3());
    oval.scale.set(0.073 / size.x, 0.106 / size.y, 0.058 / size.z);
    head.add(oval);
  }

  /** Long white hair on one head (none across the face). */
  private growMane(head: Bone, strands: number, seed: number): void {
    const random = seeded(seed);
    head.updateWorldMatrix(true, false);
    const inverse = head.matrixWorld.clone().invert();
    const center = head.getWorldPosition(new Vector3()).add(new Vector3(0, 0.09, -0.012));
    const segments = 9;
    const roots: number[] = [];
    const strand: number[] = [];
    const flow: number[] = [];
    const shades: number[] = [];
    const indices: number[] = [];
    const facing = Math.abs(head.getWorldDirection(new Vector3()).x) > 0.9 ? 1 : 0;
    const root = new Vector3();
    for (let i = 0; i < strands; i++) {
      const a = (random() * 2 - 1) * (i % 3 === 0 ? 2.8 : 2.2);
      const up = -0.1 + random() * 1.5;
      const flat = Math.cos(up);
      const dx = Math.sin(a) * flat;
      const dz = -Math.cos(a) * flat;
      const ax = facing ? dz : dx;
      const az = facing ? -dx : dz;
      root.set(center.x + ax * 0.098, center.y + Math.sin(up) * 0.098, center.z + az * 0.098).applyMatrix4(inverse);
      const horizontal = Math.hypot(ax, az) + 0.001;
      const out = 0.05 + random() * random() * 0.22;
      const drop = 0.75 + random() * 0.65;
      const phase = random() * 6.283;
      const shade = 0.3 + 0.7 * random();
      const width = 0.0011 + random() * 0.0009;
      const base = roots.length / 3;
      for (let k = 0; k <= segments; k++) {
        for (const side of [-1, 1]) {
          roots.push(root.x, root.y, root.z);
          strand.push(side, width, k / segments, phase);
          flow.push(ax / horizontal, az / horizontal, out, drop);
          shades.push(shade);
        }
        if (k < segments) {
          const v = base + k * 2;
          indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new Float32BufferAttribute(roots, 3));
    geometry.setAttribute('aStrand', new Float32BufferAttribute(strand, 4));
    geometry.setAttribute('aFlow', new Float32BufferAttribute(flow, 4));
    geometry.setAttribute('aShade', new Float32BufferAttribute(shades, 1));
    const matrix = { value: new Matrix4() };
    const material = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide });
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uHead = matrix;
      shader.uniforms.uManeTime = this.hairShape.uHairTime;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${MANE_VERT}`).replace('#include <begin_vertex>', MANE_POINT);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vHair;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vHair;');
    };
    material.customProgramCacheKey = () => 'crawl-mane';
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.dining.add(mesh);
    this.manes.push({ bone: head, matrix });
  }

  private buildHands(): void {
    const k = this.kit;
    const skin = new MeshStandardMaterial({ color: 0x2f2925, roughness: 0.72 });
    const sleeve = new MeshStandardMaterial({ color: 0x08090a, roughness: 0.95 });
    for (let i = 0; i < 2; i++) {
      const pivot = new Object3D();
      k.paint(k.prop('forearm', [0, 0, 0], { scale: HAND.scale, anchor: 'center', rotation: [-90, 0, i === 0 ? 0 : 0] }, pivot), skin);
      const cuff = new Mesh(new CylinderGeometry(0.04, 0.036, 0.3, 10), sleeve);
      cuff.rotation.x = Math.PI / 2 - 0.1;
      cuff.position.set(0, 0.02, HAND.scale * 0.5 + 0.12);
      pivot.add(cuff);
      pivot.visible = false;
      this.root.add(pivot);
      this.hands.push(pivot);
    }
    const wax = new MeshStandardMaterial({ color: 0xbcb19c, roughness: 0.6, vertexColors: true, emissive: 0x0d0b09 });
    this.follower = new Object3D();
    const arm = k.paint(k.prop('forearm', [0, 0, 0], { scale: FOLLOW.scale, anchor: 'center', rotation: [0, -90, 35] }, this.follower), wax);
    arm.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry = mesh.geometry.clone();
      mesh.geometry.computeBoundingBox();
      const low = mesh.geometry.boundingBox!.min.y;
      const tall = mesh.geometry.boundingBox!.max.y - low;
      const p = mesh.geometry.getAttribute('position');
      const color = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) color.fill(smootherstep(range(low + 0.22 * tall, low + 0.62 * tall, p.getY(i))), i * 3, i * 3 + 3);
      mesh.geometry.setAttribute('color', new Float32BufferAttribute(color, 3));
    });
    this.follower.visible = false;
    this.root.add(this.follower);
    const gap = document.createElement('canvas');
    gap.width = gap.height = 128;
    const g2d = gap.getContext('2d')!;
    const hole = g2d.createRadialGradient(64, 64, 8, 64, 64, 64);
    hole.addColorStop(0, 'rgba(0,0,0,0.96)');
    hole.addColorStop(0.6, 'rgba(0,0,0,0.8)');
    hole.addColorStop(1, 'rgba(0,0,0,0)');
    g2d.fillStyle = hole;
    g2d.fillRect(0, 0, 128, 128);
    const gapMap = new CanvasTexture(gap);
    gapMap.colorSpace = SRGBColorSpace;
    this.gapShade = new Mesh(new PlaneGeometry(FOLLOW.gap * 2.3, FOLLOW.gap * 3.8), new MeshBasicMaterial({ map: gapMap, transparent: true, depthWrite: false, fog: false }));
    this.gapShade.rotation.y = Math.PI;
    this.gapShade.visible = false;
    this.root.add(this.gapShade);
  }

  /** What is on the lens: the tunnel closing, your own shoulder when you look back, and at the last, hair. */
  private buildLens(): void {
    const canvas = (w: number, h: number) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    };
    const texture = (c: HTMLCanvasElement) => {
      const t = new CanvasTexture(c);
      t.colorSpace = SRGBColorSpace;
      return t;
    };
    const tunnel = canvas(256, 256);
    const t2d = tunnel.getContext('2d')!;
    const ring = t2d.createRadialGradient(128, 128, 54, 128, 128, 170);
    ring.addColorStop(0, 'rgba(0,0,0,0)');
    ring.addColorStop(0.55, 'rgba(0,0,0,0.55)');
    ring.addColorStop(1, 'rgba(0,0,0,1)');
    t2d.fillStyle = ring;
    t2d.fillRect(0, 0, 256, 256);
    this.vignetteMaterial = new MeshBasicMaterial({ map: texture(tunnel), transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
    this.vignette = new Mesh(new PlaneGeometry(1, 1), this.vignetteMaterial);
    this.vignette.position.z = -0.06;
    this.vignette.renderOrder = 20;
    this.lens.add(this.vignette);

    const cloth = canvas(512, 288);
    const c2d = cloth.getContext('2d')!;
    c2d.filter = 'blur(9px)';
    const edge = () => {
      c2d.beginPath();
      c2d.moveTo(530, 70);
      c2d.bezierCurveTo(452, 84, 400, 132, 386, 192);
      c2d.bezierCurveTo(378, 240, 382, 272, 398, 310);
      c2d.lineTo(530, 310);
      c2d.closePath();
    };
    edge();
    c2d.fillStyle = 'rgb(7,7,8)';
    c2d.fill();
    c2d.filter = 'blur(3px)';
    c2d.globalCompositeOperation = 'source-atop';
    c2d.strokeStyle = 'rgba(120,88,58,0.5)';
    c2d.lineWidth = 7;
    edge();
    c2d.stroke();
    this.shoulderMaterial = new MeshBasicMaterial({ map: texture(cloth), transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
    this.shoulder = new Mesh(new PlaneGeometry(1, 1), this.shoulderMaterial);
    this.shoulder.position.z = -0.065;
    this.shoulder.renderOrder = 19;
    this.lens.add(this.shoulder);

    // hair over the glass: it grows from the edges of the picture, all at once, one segment at a time
    const random = seeded(19);
    const lines: { root: [number, number]; dir: number; bend: number; length: number }[] = [];
    for (let i = 0; i < 10; i++) {
      const fromTop = i % 2 === 0;
      lines.push({
        root: fromTop ? [-0.05 + random() * 0.05, 0.03] : [0.05 - random() * 0.04, -0.03],
        dir: (fromTop ? -1.1 : 2.0) + (random() - 0.5) * 0.9,
        bend: (random() - 0.5) * 18,
        length: 0.05 + random() * 0.05,
      });
    }
    const segments = 22;
    const positions: number[] = [];
    const quads: { along: number; a: number }[] = [];
    lines.forEach((l, s) => {
      let x = l.root[0];
      let y = l.root[1];
      let dir = l.dir;
      const step = l.length / segments;
      const half = 0.000045;
      for (let k = 0; k <= segments; k++) {
        const w = half * (1 - (k / segments) * 0.7);
        positions.push(x + Math.sin(dir) * w, y - Math.cos(dir) * w, -0.075, x - Math.sin(dir) * w, y + Math.cos(dir) * w, -0.075);
        if (k < segments) quads.push({ along: k / segments + s * 0.003, a: s * (segments + 1) * 2 + k * 2 });
        dir += (l.bend + Math.sin(k * 0.7 + s) * 9) * step;
        x += Math.cos(dir) * step;
        y += Math.sin(dir) * step;
      }
    });
    quads.sort((p, q) => p.along - q.along);
    const indices: number[] = [];
    for (const q of quads) indices.push(q.a, q.a + 2, q.a + 1, q.a + 1, q.a + 2, q.a + 3);
    this.lensHairCount = indices.length;
    this.lensHair = new BufferGeometry();
    this.lensHair.setIndex(indices);
    this.lensHair.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.lensHair.setDrawRange(0, 0);
    this.lensHairMaterial = new MeshBasicMaterial({ color: 0xc3bfb2, depthTest: false, depthWrite: false, transparent: true, fog: false });
    const strands = new Mesh(this.lensHair, this.lensHairMaterial);
    strands.frustumCulled = false;
    strands.renderOrder = 21;
    this.lens.add(strands);
  }

  private placeBeats(): void {
    const s = this.sound;
    const breathe = (file: string, gain: number, fade: number) => {
      this.breath?.stop(fade);
      this.breath = s.bed(file, { gain, fade });
    };
    this.beat(0, () => {
      this.airBed = s.bed('rooms/duct_air.mp3', { gain: 0.12, fade: 1.5 });
      this.drone = s.bed('rooms/dream_drone_metal.mp3', { gain: 0.08, fade: 4 });
      breathe('rooms/breath_calm.mp3', 0.12, 0.8);
    });
    this.beat(3, () => this.say({ tr: 'Geri dönemezsin.', en: 'You cannot turn back.' }, 4));

    PUSHES.forEach((p, i) => {
      const side = i % 2 === 0 ? 0.3 : -0.3;
      if (i < STUCK_FROM) this.beat(p[0], () => s.play(CRAWLS[(i * 5) % 6], { gain: 0.45, pan: side * 0.8, rate: 0.95 + ((i * 7) % 5) * 0.025 }));
      if (i >= FIRST_SCRAPE) this.beat(p[0] + 0.1, () => s.play(i >= STUCK_FROM ? SCRAPES[0] : SCRAPES[i % 3], { gain: 0.35, pan: i % 2 === 0 ? 0.65 : -0.65 }));
      if (i >= STUCK_FROM) this.beat(p[0] + 0.05, () => s.play(CATCHES[i % 4], { gain: 0.3 }));
    });

    // the dinner, as it comes nearer: and then only a fork put down
    this.beat(6.5, () => (this.dinner = s.bed('rooms/cutlery_far.mp3', { gain: 0.17, fade: 7, lowpass: 1500, reverb: 0.3 })));
    this.beat(16.9, () => {
      s.play('rooms/fork_down_1.mp3', { gain: 0.34, reverb: 0.25, lowpass: 3200 });
      this.dinner?.gain(0, 1);
      this.breath?.gain(0, 0.5);
      s.play('rooms/breath_in.mp3', { gain: 0.25 });
    });
    this.beat(22.45, () => {
      s.play('rooms/breath_out.mp3', { gain: 0.3 });
      breathe('rooms/breath_scared.mp3', 0.2, 0.8);
      this.dinner?.stop(0.3);
    });
    this.beat(24, () => {
      this.fridge = s.bed('rooms/inside_fridge.mp3', { gain: 0.12, fade: 3 });
      this.airBed?.gain(0.04, 3);
    });

    STEPS.forEach((step, i) => {
      const gain = STEP_GAINS[i];
      const pan = step[1] * 2.4;
      this.beat(step[0], () => {
        s.play(THUDS[i % 4], { gain, pan, lowpass: i < 3 ? 1500 : 6000 });
        s.play(WOMPS[(i * 3) % 5], { gain: gain * 0.8, pan });
      });
      this.beat(step[0] + step[4], () => s.play(POPS[(i * 2) % 5], { gain: gain * 0.8, pan }));
    });
    this.beat(35.5, () => s.play('rooms/duct_hit_low.mp3', { gain: 0.5 }));
    this.beat(36.5, () => s.play('rooms/duct_hit_high.mp3', { gain: 0.4, pan: -0.2 }));

    this.beat(34, () => {
      this.hint({ tr: 'Kaydır: sürün', en: 'Scroll: crawl' });
      s.play('rooms/duct_scrape_long.mp3', { gain: 0.3 });
    });
    this.beat(50, () => this.hint(null));

    // quiet, and then it is behind you
    this.beat(38.7, () => {
      this.fridge?.gain(0.02, 1);
      this.drone?.gain(0.02, 1.2);
      this.breath?.gain(0.03, 1);
    });
    this.beat(40, () => (this.wet = s.bed('rooms/duct_wet_behind.mp3', { gain: 0.3, fade: 1.4 })));
    this.beat(41, () => breathe('rooms/breath_fast.mp3', 0.2, 1.2));
    this.beat(42, () => (this.heart = s.bed('rooms/heart_fast.mp3', { gain: 0.2, fade: 2 })));
    this.beat(TURN.start - 0.4, () => {
      this.breath?.gain(0, 0.3);
      s.play('rooms/breath_catch_2.mp3', { gain: 0.3 });
    });

    this.beat(SHUTTER_AT, () => {
      if (this.shot) return;
      this.shot = true;
      this.shutter();
    });
    this.beat(47.2, () => {
      this.say({ tr: 'Dönecek yer yok.', en: 'There is no room to turn.' }, 4.5);
      s.play('rooms/heart_beat.mp3', { gain: 0.45 });
    });
    this.beat(47.6, () => breathe('rooms/breath_panic.mp3', 0.2, 0.5));

    this.beat(BUCKLE_AT, () => {
      s.play('rooms/panel_buckle.mp3', { gain: 0.5 });
      this.heart?.rate(1.12, 1);
    });
    this.beat(BUCKLE_AT + 0.7, () => s.play('rooms/bolts_fall.mp3', { gain: 0.25, reverb: 0.1 }));
    this.beat(54.6, () => s.play(POPS[2], { gain: 0.4 }));
    this.beat(55.5, () => s.play(POPS[4], { gain: 0.42, pan: 0.3 }));
    this.beat(FALL_AT - 0.14, () => {
      for (const v of [this.breath, this.wet, this.heart, this.fridge, this.drone, this.airBed]) v?.gain(0, 0.1);
    });
    this.beat(FALL_AT, () => {
      s.play('rooms/whoosh_fall.mp3', { gain: 0.5 });
      s.play('rooms/duct_hit_high.mp3', { gain: 0.45 });
    });
    this.beat(CRASH_AT, () => s.play('rooms/metal_crash.mp3', { gain: 0.7, reverb: 0.5 }));
    this.beat(CRASH_AT + 0.22, () => s.play('rooms/metal_crash_2.mp3', { gain: 0.6, reverb: 0.5 }));
    this.beat(CRASH_AT + 0.7, () => s.play('rooms/scrap_fall.mp3', { gain: 0.6, reverb: 0.5 }));
    this.beat(CRASH_AT + 1.8, () => s.play('rooms/bolts_fall.mp3', { gain: 0.25, reverb: 0.5, lowpass: 2000 }));
  }

  /** How far the neck has turned the eye, 0..1 (s). */
  private turnAt(s: number): number {
    const T = TURN;
    const rise = REDUCED_MOTION
      ? smootherstep(range(T.start - 1.8, T.end, s))
      : 0.62 * smootherstep(range(T.start, T.start + 0.8, s)) + 0.04 * smootherstep(range(T.start + 0.8, T.start + 1.15, s)) + 0.34 * smootherstep(range(T.start + 1.15, T.end, s));
    return rise * (1 - smootherstep(range(T.back, T.done, s)));
  }

  /** Where the pushes have brought the eye at second `s`. */
  private crawl(s: number): void {
    let z = 0;
    let arc = 0;
    let side = this.pushSide;
    for (let i = 0; i < PUSHES.length; i++) {
      const p = PUSHES[i];
      if (s <= p[0]) break;
      const w = Math.min(1, (s - p[0]) / p[1]);
      z -= p[2] * smootherstep(w);
      if (w < 1) {
        arc = Math.sin(Math.PI * w) * p[3];
        side = i % 2 === 0 ? 1 : -1;
      }
    }
    this.eyeZ = z;
    this.pushArc = arc;
    this.pushSide = side;
  }

  /** The slow path from the keys; the crawl, the turn and the fall on top of it. */
  override pose(t: number, out: RoomPose): RoomPose {
    super.pose(t, out);
    const s = t * this.seconds;
    this.crawl(s);
    const motion = REDUCED_MOTION ? 0.3 : 1;
    out.position.z = this.origin.z + this.eyeZ - this.bought;
    out.position.y += -DIP * this.pushArc * motion + Math.sin(s * 1.5) * 0.0028 - this.sink;
    out.roll += ROLL * DEG * this.pushSide * this.pushArc * motion;
    out.yaw += SWAY * DEG * this.pushSide * this.pushArc * motion;
    out.pitch -= NOD * DEG * this.pushArc * motion;
    const turn = this.turnAt(s);
    if (turn > 0) {
      if (this.turnSide === 0) this.turnSide = this.gazeYaw < -0.4 ? -1 : 1;
      const side = this.turnSide;
      out.yaw = lerp(out.yaw, side * TURN.yaw * DEG - this.gazeYaw, turn);
      out.pitch = lerp(out.pitch, TURN.pitch * DEG - this.gazePitch, turn);
      out.roll = lerp(out.roll, REDUCED_MOTION ? 0 : -side * TURN.roll * DEG, turn);
      out.fov = lerp(out.fov, TURN.fov, turn);
      out.position.x += -side * TURN.shift * turn;
    }
    if (REDUCED_MOTION) out.fov = lerp(out.fov, 46, 0.5);
    else if (s > BUCKLE_AT && s < BUCKLE_AT + 0.7) out.position.y += Math.exp(-(s - BUCKLE_AT) * 6) * Math.sin((s - BUCKLE_AT) * 40) * 0.01;
    if (!REDUCED_MOTION && s > FALL_AT) {
      const fell = Math.min(2, s - FALL_AT);
      out.position.y -= 4.9 * fell * fell;
      out.roll += fell * fell * 0.5;
    }
    this.ownYaw = out.yaw;
    return out;
  }

  private sectionX(z: number): number {
    const k = smootherstep(range(TAPER_FROM, TAPER_TO, z));
    const away = (z - STUCK_Z) / PRESS_REACH;
    return lerp(1, NARROW.w / WIDE.w, k) * (1 - PRESS_W * Math.exp(-away * away) * k * this.shape.uPress.value);
  }

  private frontAt(s: number): number {
    return HAIR.start - HAIR.speed * s - HAIR.jump * smootherstep(range(46.98, 47.1, s));
  }

  private placeHand(hand: number, s: number, eyeZ: number): void {
    const pivot = this.hands[hand];
    const side = hand === 0 ? 1 : -1;
    let plant = AFTER_PUSH[0] + HAND.reach;
    let z = plant;
    let lift = 0;
    for (let i = hand === 0 ? 0 : 1; i < PUSHES.length; i += 2) {
      const from = i === 0 ? -1 : PUSHES[i - 1][0] + PUSHES[i - 1][1];
      if (s < from) break;
      const next = AFTER_PUSH[i] - HAND.reach;
      const land = PUSHES[i][0] - 0.04;
      if (s < land) {
        const w = range(from, land, s);
        z = lerp(plant, next, smootherstep(w));
        lift = Math.sin(Math.PI * w) * 0.035;
        break;
      }
      plant = next;
      z = next;
    }
    pivot.visible = s < FALL_AT && z < eyeZ - 0.1 && this.looksAhead && (s < 14.4 || s > 23.2);
    pivot.position.set(side * HAND.x * this.sectionX(z), HAND.y + lift, z + HAND.scale * 0.5 - 0.02);
    pivot.rotation.y = -side * 0.14;
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const dt = Math.min(frame.dt, 0.1);
    const input = frame.input;
    const o = this.origin;
    this.gazeYaw = input.gazeYaw;
    this.gazePitch = input.gazePitch;
    this.control.hurry = s < 34 ? 1.6 : 1;
    this.fear = this.fearAt.at(s);
    this.air.envIntensity = s > FALL_AT ? 0 : s < 44 ? 0.14 : lerp(0.05, 0.18, range(49, 50.6, s));
    this.focus = this.focusAt.at(s);
    this.aperture = s > 53 ? 0 : s > 31 && s < 38 ? 2.2 : 4;
    for (const c of this.clocks) c.value = frame.time;

    // the viewer's legs: a little, and what it costs
    const stuck = s >= 34 && s < 50;
    if (stuck && input.legs > 0.02) {
      this.bought = Math.min(BUY_MAX, this.bought + input.legs * BUY_RATE * (1 - this.bought / BUY_MAX) * dt);
      if (frame.time >= this.nextStrain && input.legs > 0.08) {
        this.nextStrain = frame.time + 0.75;
        this.strainCount++;
        this.sound.play(SCRAPES[this.strainCount % 3], { gain: 0.33, pan: this.strainCount % 2 === 0 ? 0.6 : -0.6 });
        this.sound.play(CATCHES[this.strainCount % 4], { gain: 0.28 });
      }
    }
    this.shape.uPress.value = smootherstep(range(33.5, 50, s)) * 0.88 + (this.bought / BUY_MAX) * BUY_PRESS * 0.4 + frame.heartbeat * 0.015 * range(40, 46, s);

    // the hands on the roof
    const dents = this.shape.uDents.value;
    let slot = 0;
    for (let i = 0; i < STEPS.length && slot < DENT_SLOTS; i++) {
      const step = STEPS[i];
      const on = range(step[0], step[0] + 0.14, s);
      if (on <= 0) break;
      const gone = range(step[0] + step[4], step[0] + step[4] + 0.5, s);
      if (gone >= 1) continue;
      dents[slot++].set(step[1], step[2], step[3] * on * (1 - gone * gone), i % 2 === 0 ? 1 : -1);
    }
    while (slot < DENT_SLOTS) dents[slot++].set(0, 0, 0, 1);
    const sagZ = this.sagZAt.at(s);
    const sagDepth = this.sagDepthAt.at(s);
    this.shape.uSag.value.set(sagZ, sagDepth, SAG_LENGTH);

    // the floor
    const buckle = range(BUCKLE_AT, BUCKLE_AT + 0.22, s);
    const more = range(54.6, 54.85, s) * 0.5 + range(55.5, 55.7, s);
    const dome = 0.012 * buckle + 0.008 * more;
    const crease = 0.018 * buckle + 0.012 * more;
    this.shape.uBuckle.value.set(dome, crease);
    const eye = this.eyeZ - this.bought;
    const away = (eye - sagZ) / SAG_LENGTH;
    const onPanel = Math.sin(Math.PI * clamp((eye - PANEL_FROM) / (PANEL_TO - PANEL_FROM), 0, 1));
    this.sink = sagDepth * 0.5 * Math.exp(-away * away) + onPanel * (dome + crease);
    const gone = range(FALL_AT, FALL_AT + 0.35, s);
    this.panelHinge.rotation.x = -1.3 * gone * gone - (buckle * 0.012 + more * 0.012);
    this.panelHinge.visible = gone < 1;

    // the light that comes up from the table, until the hair is over it
    const front = this.frontAt(s);
    const covered = 1 - 0.8 * smootherstep(range(-3.5, -5.3, front));
    const breath = 1 + 0.05 * Math.sin(frame.time * 0.9) + 0.03 * Math.sin(frame.time * 2.3 + 1);
    const grille = covered * breath;
    this.shape.uGrilleLight.value.setHex(WARM).multiplyScalar(GRILLE_LIGHT * grille);
    const fromGrille = smootherstep(range(0.6, 1.9, Math.abs(eye - GRILLE_Z)));
    this.bounce.intensity = BOUNCE * grille * lerp(0.12, 1, fromGrille);
    this.sheetLight.opacity = 0.42 * smootherstep(range(1.0, 3.2, Math.abs(eye - GRILLE_Z))) * grille;
    this.grilleGlow.scale.setScalar(0.001 + fromGrille);
    if (s < 28) {
      this.dentLight.position.set(o.x + this.motherHead.x, o.y + this.motherHead.y + 0.3, o.z + this.motherHead.z + 0.3);
      this.dentLight.color.setHex(WARM);
      this.dentLight.distance = 0.85;
      this.dentLight.intensity = FACE_LIGHT * smootherstep(range(LOOK_UP.from, LOOK_UP.to, s));
    } else {
      this.dentLight.position.set(o.x - 0.04, o.y + 0.19, o.z - 7.12);
      this.dentLight.color.setHex(COLD);
      this.dentLight.distance = 1.3;
      this.dentLight.intensity = DENT_LIGHT * smootherstep(range(30.9, 32.4, s)) * (1 - smootherstep(range(35, 36.2, s)));
    }
    this.lampShade.emissiveIntensity = 1.6 * breath;
    const lookedUp = smootherstep(range(LOOK_UP.from, LOOK_UP.to, s)) * (1 - range(22.5, 23.4, s));
    this.below.intensity = LAMP_FILL * breath * (1 - 0.7 * lookedUp);
    this.spots[0]!.intensity = LAMP_SPOT * (1 - 0.55 * lookedUp);

    // the way out, while there still is one
    const vent = range(13, 18, s) * (1 - smootherstep(range(43.2, 44.8, s)));
    this.cold.intensity = VENT_LIGHT * vent;
    this.ventPlane.color.setHex(COLD).multiplyScalar(1.4 * vent);
    this.ventGlow.scale.setScalar(0.001 + 1.1 * vent);
    const draw = DRAW_OUT * smootherstep(range(34, 50, s));
    this.shape.uDraw.value = draw;
    const farEnd = END_Z + (END_Z - DRAW_FROM) * draw;
    this.ventCover.position.z = farEnd + 0.03;
    this.ventBack.position.z = farEnd + 0.012;
    this.ventGlow.position.z = farEnd + 0.2;
    this.cold.position.z = o.z + farEnd + 0.55;
    this.eyeFill.position.set(o.x, o.y + (eye < TAPER_TO ? 0.17 : 0.3), o.z + eye + 0.08);

    // the family
    const near = s > 8.5 && s < 27;
    this.dining.visible = near;
    this.movingShadows = s > 8.5 && s < 23.4;
    if (near) {
      this.father.update(frame.dt * EATING_RATE);
      const lift = smootherstep(range(LOOK_UP.from, LOOK_UP.to, s));
      const chew = s < 17 ? Math.sin(s * 2.1) * 0.05 + 0.04 : 0.04 * (1 - lift);
      for (const mane of this.manes) {
        mane.bone.updateWorldMatrix(true, false);
        const e = mane.matrix.value.copy(mane.bone.matrixWorld).elements;
        e[12] -= o.x;
        e[13] -= o.y;
        e[14] -= o.z;
      }
      for (let i = 0; i < 3; i++) this.motherBones[i].quaternion.copy(this.motherRest[i]).multiply(nodAxis.setFromAxisAngle(this.motherAxes[i], LOOK_UP.bends[i] * lift - (i === 2 ? chew : 0)));
    }

    // what follows, at your own pace
    const yawNow = this.ownYaw + input.gazeYaw;
    const back = Math.cos(yawNow);
    this.hair.visible = s > 36 || back < 0.25;
    this.hairShape.uFront.value = front;
    this.hairShape.uHairTime.value = frame.time;
    const distance = front - eye;
    const close = smootherstep(range(7, 2, Math.abs(distance)));
    this.hairShape.uHairLit.value = 0.46 + 0.5 * close;
    this.hairShape.uHairGlow.value = 0.9 * covered;
    this.hairLight.position.set(o.x, o.y + 0.26, o.z + front - 0.55);
    this.hairLight.intensity = HAIR_LIGHT * close * (1 + 1.7 * smootherstep(range(3.2, 1.4, Math.abs(distance))));
    const stride = (HAIR.start - front) / FOLLOW.step;
    const n = Math.floor(stride);
    const reach = n + smootherstep(range(0, 0.45, stride - n));
    const handZ = HAIR.start - reach * FOLLOW.step - FOLLOW.ahead;
    const sx = this.sectionX(handZ);
    this.follower.visible = this.hair.visible;
    this.follower.position.set(FOLLOW.x * sx, FOLLOW.armY * lerp(1, NARROW.h / WIDE.h, smootherstep(range(TAPER_FROM, TAPER_TO, handZ))), handZ + 0.1);
    this.follower.rotation.z = Math.sin(frame.time * 1.3) * 0.03;
    this.gapShade.visible = this.hair.visible;
    this.gapShade.position.set(FOLLOW.x * sx, FOLLOW.y * lerp(1, NARROW.h / WIDE.h, smootherstep(range(TAPER_FROM, TAPER_TO, handZ))), handZ + 0.34);
    this.hairShape.uHollow.value.set(FOLLOW.x, FOLLOW.y + 0.015, FOLLOW.gap);

    // seen: the shutter, once
    const inView = back < -0.82 && s > SEEN_FROM;
    this.seenFor = inView ? this.seenFor + dt : Math.max(0, this.seenFor - dt);
    if (!this.shot && inView && this.seenFor > SEEN_HOLD) {
      this.shot = true;
      this.shutter();
    }

    this.looksAhead = back > 0.25;
    this.placeHand(0, s, eye);
    this.placeHand(1, s, eye);

    // the lens
    const view = frame.view;
    const tall = Math.tan((view.fov * DEG) / 2);
    const wide = tall * view.aspect;
    const closing = 0.1 + 0.42 * smootherstep(range(24, 50, s));
    this.vignette.scale.set(2 * 0.06 * wide * 1.3, 2 * 0.06 * tall * 1.3, 1);
    this.vignetteMaterial.opacity = closing;
    const showShoulder = Math.max(this.turnAt(s), smootherstep(range(-0.1, -0.7, back)));
    const flip = this.turnSide !== 0 ? this.turnSide : yawNow >= 0 ? 1 : -1;
    this.shoulder.scale.set(2 * 0.065 * wide * flip, 2 * 0.065 * tall, 1);
    this.shoulderMaterial.opacity = showShoulder;
    const across = smootherstep(range(53.3, FALL_AT, s));
    this.lensHair.setDrawRange(0, Math.floor(across * this.lensHairCount / 6) * 6);
    this.lensHairMaterial.opacity = 0.75 * (1 - range(FALL_AT, FALL_AT + 0.2, s));

    // and the rest of the piece: the film going, the fall
    this.film.aberration = 0.03;
    this.film.barrel = 0.08 + 0.16 * smootherstep(range(24, 50, s));
    const fell = s - FALL_AT;
    for (const pour of this.pours) {
      pour.visible = fell > 0;
      if (fell > 0) pour.scale.y = Math.max(0.02, 5.4 * fell * fell);
    }
    this.black = REDUCED_MOTION ? smootherstep(range(FALL_AT, FALL_AT + 0.35, s)) : smootherstep(range(FALL_AT + 0.95, FALL_AT + 1.55, s));
    this.control.look = s < FALL_AT;

    // where it is heard from: always behind you, wherever that is by now
    if (this.wet && frame.time >= this.nextPan) {
      this.nextPan = frame.time + 0.25;
      this.wet.pan(-Math.sin(yawNow) * 0.7, 0.25);
    }
  }
}
