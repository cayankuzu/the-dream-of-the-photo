import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Material,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import { meterUVs } from '../../dream/DreamKit';
import { randomFrom } from '../../dream/FigureKit';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import { PALETTE } from '../RoomKit';
import type { RoomVoice } from '../RoomSound';
import { Snakes, type SnakePlace } from '../Snakes';

export const assets: RoomAssets = {
  models: ['pool_ladder', 'chair_white', 'chair_worn', 'faucet', 'locker', 'bench_changing', 'drain_grate'],
  materials: ['tile_pool', 'tile_white', 'tile_bone', 'plaster_mould'],
  sounds: [
    'rooms/pool_room_tone.mp3',
    'rooms/underwater_pool.mp3',
    'rooms/dream_drone_hollow.mp3',
    'rooms/pool_drip_1.mp3',
    'rooms/pool_drip_2.mp3',
    'rooms/tap_start.mp3',
    'rooms/drain_gurgle.mp3',
    'rooms/water_trickle.mp3',
    'rooms/snakes_scales.mp3',
    'rooms/crowd_rise.mp3',
    'rooms/snake_hiss_close.mp3',
  ],
};

type V3 = readonly [number, number, number];

/** The hall: half its width, the wall behind the viewer, the wall under the window, its height, how high the tile goes (m). */
const HALL_X = 5.1;
const HALL_BACK = 1.6;
const HALL_FAR = -17.4;
const HALL_H = 6.4;
const TILE_TO = 2.2;
/** Where the piers and the beams they carry stand (z, m). */
const PIERS = [-1.2, -5.2, -9.2, -13.2];
/** The basin: half its width and its shallow and deep walls (m). */
const BASIN_X = 3.2;
const BASIN_NEAR = -2.6;
const BASIN_FAR = -15.6;
/** Its floor, [z, y] (m): a short level, one long slope, the sump. */
const PROFILE: readonly (readonly [number, number])[] = [
  [BASIN_NEAR, -1.0],
  [-3.0, -1.07],
  [-13.6, -3.0],
  [BASIN_FAR, -3.1],
];
/** The slope's angle (rad) and the way it faces. */
const RAKE = Math.atan2(PROFILE[1][1] - PROFILE[2][1], PROFILE[1][0] - PROFILE[2][0]);
const SLOPE: V3 = [0, Math.cos(RAKE), -Math.sin(RAKE)];
/** Dark lane lines on the floor (m off the middle), and the lip round the basin as [out from the edge, height] (m). */
const LANE_X = 1.6;
const LIP: readonly (readonly [number, number])[] = [
  [0.36, 0],
  [0.36, 0.018],
  [0.07, 0.024],
  [0.015, 0.012],
  [-0.012, -0.018],
  [0, -0.08],
];
/** Chrome ladders, [side, z], how far below the deck each one ends (m). */
const LADDERS: readonly (readonly [number, number])[] = [
  [-1, -6.4],
  [-1, -12.6],
  [1, -5.2],
  [1, -12.4],
];
const LADDER_FOOT = -0.78;

/** The audience: rows and columns of chairs (m), the seat nobody sits in, how far back on a chair a body sits (m). */
const ROW_Z = [-7.4, -8.7, -10, -11.3, -12.6];
const COLUMN_X = [-1.96, -0.98, 0, 0.98, 1.96];
const EMPTY = { row: 1, column: 3 };
const SIT_BACK = 0.03;
/** The poses of the seat clip that are used (s), and the cloth (a color that multiplies). */
const POSES = [4.2, 5.6, 2.8];
const CLOTH = 0xe7edec;
/** The chairs: old varnish under what paint is left (multiplies). */
const CHAIR_TINT = 0x9c8f78;
/** How far every head hangs forward until they lift (rad), and the point above the neck's foot it turns about (m). */
const BOW = 0.68;
const NECK_ABOVE = 0.06;
/** The one on the deck who has been looking at you all along: where it sits (m). */
const WATCHER: V3 = [4.35, 0, -11.6];
/** What is laid in black tile on the deep wall, its cells (m), and where its middle is (y). */
const NUMERAL_TEXT = '18.30';
const NUMERAL_CELL = 0.13;
const NUMERAL_Y = -1.2;

/** The window: its middle x, sill, width and height (m), its panes, how deep the glass stands, its light. */
const WINDOW_X = 1.5;
const WINDOW_SILL = 2.5;
const WINDOW_W = 2.6;
const WINDOW_H = 2.3;
const WINDOW_COLUMNS = 5;
const WINDOW_ROWS = 5;
const WINDOW_DEPTH = 0.36;
const WINDOW_GLOW = 2.4;
/** The moon lands here (x, z): on bare tile behind the last row, so that the rows throw their shadows toward you. */
const MOON_AT = [0.3, -6.5] as const;
/** Its lamp stands this many times as far from there as the window is, so its rays are nearly parallel; candela. */
const MOON_BEYOND = 2.6;
const MOON = 6000;
/** How much more moon when they have looked at you (share). */
const MOON_SURGE = 0.3;
/** Lights: water-light on the backs, the deck, the light on their faces when they turn, the lamp behind you. */
const WATER_FILL = 4.5;
/** The moon that fills the hall above the rows, whatever the window does not reach. */
const MOON_WASH = 22;
const DECK_FILL = 0.7;
const FACE_FILL = 20;
const LAMP = 3.2;

/** Water-light: speed of the ripple (per s), its time at the start, its strength before and after they look at you. */
const RIPPLE_SPEED = REDUCED_MOTION ? 0.14 : 0.42;
const RIPPLE_START = 19;
const RIPPLE_CALM = 1;
const RIPPLE_LOOKED = 1.6;
/** The chairs and those in them are drawn before the tile (only what is opaque, so the picture is the same): the tile they hide then fails the depth test before its water-light and its years are worked out. */
const IN_FRONT_FIRST = -1;

/** Seconds: the tap, the line, the many, the hush before they lift, heads up, heads round, the shutter, the cut. */
const TAP_AT = 8;
const LINE_AT = 11;
const MANY_FROM = 11.7;
const MANY_BY = 12.5;
const HUSH_AT = 12.7;
const LIFT_FROM = 12.9;
const LIFT_TO = 13.4;
const TURN_FROM = 13.05;
const TURN_TO = 13.85;
const SHUTTER_AT = 13.92;
const CUT_AT = 15;
/** The tap on the far wall of the basin (m), where the first thin one comes from under the eye (z), how fast and how long they are (m/s, m), and their radius (m). */
const TAP_Y = -0.62;
const TAP_Z = -5;
const LINE_Z = -6.7;
const LINE_SPEED = 1.3;
const LINE_LENGTH = 3.4;
const LINE_GIRTH = 0.024;
/** The many: those that come out of the foot of the walls, those that knot on the slope and in the sump, and the near ones that climb. */
const CRAWLERS = 84;
const KNOTS_SLOPE = 420;
const KNOTS_SUMP = 44;
/** Big ones that come out of the wall right under the eye, where a snake can be seen for what it is. */
const BIG_ONES = 14;
/** Seconds a knot takes to swell to its size once it exists, and how high all heads come up (m). */
const GROW = 0.32;
const RISE = 0.3;
const RISE_NEAR = 0.52;
const SEED = 17;
/** Where every head looks at the end: the eye as it is when they turn. */
const EYE_AT: V3 = [-3.92, 1.56, -4.55];

/** Cells of the numerals, as laid in tile. */
const NUMERALS: Record<string, readonly string[]> = {
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '3': ['01110', '10001', '00001', '00110', '00001', '10001', '01110'],
  '0': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  '.': ['00', '00', '00', '00', '00', '11', '11'],
};

function floorAt(z: number): number {
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const [z0, y0] = PROFILE[i];
    const [z1, y1] = PROFILE[i + 1];
    if (z >= z1) return y0 + ((y1 - y0) * (z - z0)) / (z1 - z0);
  }
  return PROFILE[PROFILE.length - 1][1];
}

function steps(from: number, to: number, size: number): number[] {
  const n = Math.max(1, Math.ceil(Math.abs(to - from) / size));
  return Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
}

function ease(from: number, to: number, x: number): number {
  const u = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return u * u * u * (u * (6 * u - 15) + 10);
}

/** A grid of quads, meters for UVs so that the tiles keep their size on the slope; it faces U x V. */
function sheet(us: readonly number[], vs: readonly number[], place: (u: number, v: number) => V3, uv: (u: number, v: number) => readonly [number, number]): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (const v of vs) {
    for (const u of us) {
      positions.push(...place(u, v));
      uvs.push(...uv(u, v));
    }
  }
  const n = us.length;
  for (let r = 0; r < vs.length - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const a = r * n + c;
      index.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** One side of the lip, from corner a to corner b; each corner's `out` says which way is away from the water. */
function lipSide(a: readonly [number, number], b: readonly [number, number], outA: readonly [number, number], outB: readonly [number, number]): BufferGeometry {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return sheet(
    steps(0, 1, 0.5 / length),
    LIP.map((_, i) => i),
    (f, i) => {
      const [out, y] = LIP[i];
      return [a[0] + (b[0] - a[0]) * f + (outA[0] + (outB[0] - outA[0]) * f) * out, y, a[1] + (b[1] - a[1]) * f + (outA[1] + (outB[1] - outA[1]) * f) * out];
    },
    (f, i) => [f * length, i * 0.09],
  );
}

/** The basin as one mesh: floor, sides and ends. */
function basinGeometry(): BufferGeometry {
  const zs = [...PROFILE.slice(0, -1).flatMap(([z], i) => steps(z, PROFILE[i + 1][0], 0.5).slice(0, -1)), BASIN_FAR];
  const arcs = zs.map(() => 0);
  for (let i = 1; i < zs.length; i++) arcs[i] = arcs[i - 1] + Math.hypot(zs[i] - zs[i - 1], floorAt(zs[i]) - floorAt(zs[i - 1]));
  const across = steps(-BASIN_X, BASIN_X, 0.5);
  const down = steps(0, 1, 0.2);
  const floor = sheet(across, zs.map((_, i) => i), (x, i) => [x, floorAt(zs[i]), zs[i]], (x, i) => [x, arcs[i]]);
  const right = sheet(zs, down, (z, f) => [BASIN_X, f * floorAt(z), z], (z, f) => [z, f * floorAt(z)]);
  const left = sheet([...zs].reverse(), down, (z, f) => [-BASIN_X, f * floorAt(z), z], (z, f) => [z, f * floorAt(z)]);
  const near = sheet(across, down, (x, f) => [x, f * PROFILE[0][1], BASIN_NEAR], (x, f) => [x, f * PROFILE[0][1]]);
  const far = sheet([...across].reverse(), down, (x, f) => [x, f * PROFILE[3][1], BASIN_FAR], (x, f) => [x, f * PROFILE[3][1]]);
  return mergeGeometries([floor, right, left, near, far])!;
}

function poolFloorGlsl(): string {
  const f = (v: number) => v.toFixed(3);
  const [a, b, c, d] = PROFILE;
  return `float poolFloor(float z) {
    if (z > ${f(b[0])}) return mix(${f(b[1])}, ${f(a[1])}, (z - ${f(b[0])}) / ${f(a[0] - b[0])});
    if (z > ${f(c[0])}) return mix(${f(c[1])}, ${f(b[1])}, (z - ${f(c[0])}) / ${f(b[0] - c[0])});
    return mix(${f(d[1])}, ${f(c[1])}, (z - ${f(d[0])}) / ${f(c[0] - d[0])});
  }`;
}

const RIPPLE_VERT_PARS = /* glsl */ `
uniform vec3 uPoolOrigin;
varying vec3 vPoolAt;
varying vec3 vPoolUp;
`;

const RIPPLE_VERT = /* glsl */ `
vec4 poolPlace = vec4(transformed, 1.0);
vec3 poolUp = objectNormal;
#ifdef USE_INSTANCING
  poolPlace = instanceMatrix * poolPlace;
  poolUp = mat3(instanceMatrix) * poolUp;
#endif
vPoolAt = (modelMatrix * poolPlace).xyz - uPoolOrigin;
vPoolUp = mat3(modelMatrix) * poolUp;
`;

const RIPPLE_FRAG_PARS = /* glsl */ `
uniform float uPoolTime;
uniform float uPoolLight;
varying vec3 vPoolAt;
varying vec3 vPoolUp;
${poolFloorGlsl()}
float poolHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float poolNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(poolHash(i), poolHash(i + vec2(1.0, 0.0)), f.x), mix(poolHash(i + vec2(0.0, 1.0)), poolHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float poolFbm(vec2 p) {
  return 0.55 * poolNoise(p) + 0.3 * poolNoise(p * 2.1 + 7.3) + 0.15 * poolNoise(p * 4.3 + 3.1);
}
// The net of light that water throws: there is no water.
float poolNet(vec2 uv, float t) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  for (int n = 0; n < 4; n++) {
    float s = t * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(s - i.x) + sin(s + i.y), sin(s - i.y) + cos(s + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + s) / 0.005), p.y / (cos(i.y + s) / 0.005)));
  }
  c = 1.17 - pow(c / 4.0, 1.4);
  return pow(abs(c), 8.0);
}
float poolWaterLight(vec3 w) {
  // projected from above and slanted, so that walls take it stretched, as real water-light is
  vec2 at = w.xz + w.y * vec2(0.3, 0.46);
  at += 0.22 * vec2(sin(w.z * 0.63 + w.y), cos(w.x * 0.71 - w.y * 0.8));
  float net = poolNet(at / 2.7, uPoolTime);
  float inBasin = 1.0 - smoothstep(-0.18, 0.12, w.y);
  float toDeep = 1.0 - smoothstep(-12.0, -2.0, w.z);
  float breath = 0.78 + 0.22 * sin(uPoolTime * 0.9 + w.z * 0.35 + w.x * 0.2);
  return mix(0.2, mix(0.55, 1.15, toDeep), inBasin) * breath * (0.04 + net * 1.35);
}
`;

const RIPPLE_GRIME = /* glsl */ `
vec3 poolN = normalize(vPoolUp);
float poolBelow = 1.0 - smoothstep(-0.02, 0.02, vPoolAt.y);
float poolFlat = smoothstep(0.55, 0.85, poolN.y);
float poolWall = (1.0 - poolFlat) * poolBelow;
float poolLevel = poolFlat * poolBelow;
float poolRun = abs(poolN.x) > abs(poolN.z) ? vPoolAt.z : vPoolAt.x;
float poolBlot = poolFbm(vPoolAt.xz * 0.9 + vPoolAt.y * 0.7);
// stains, lines and rust belong to the basin's walls: anywhere else they weigh exactly nothing, so they are not worked out there
float poolStreak = 0.0;
float poolLines = 0.0;
float poolRust = 0.0;
if (poolWall > 0.0) {
  poolStreak = poolFbm(vec2(poolRun * 6.0, vPoolAt.y * 0.3 + 11.0));
  poolLines = poolFbm(vec2(poolRun * 0.5, vPoolAt.y * 11.0));
  poolRust = poolWall * smoothstep(0.6, 0.72, poolFbm(vec2(poolRun * 1.7, 3.0))) * smoothstep(-2.6, -0.25, vPoolAt.y);
}
float poolAbove = max(vPoolAt.y - poolFloor(vPoolAt.z), 0.0);
float poolCorner = poolWall * exp(-poolAbove * 2.4) + poolLevel * (exp(-(${BASIN_X.toFixed(2)} - abs(vPoolAt.x)) * 3.0) + exp(-(vPoolAt.z - (${BASIN_FAR.toFixed(2)})) * 3.0));
float poolGutter = poolWall * smoothstep(-0.25, -0.23, vPoolAt.y) * (1.0 - smoothstep(-0.12, -0.10, vPoolAt.y));
float poolLane = poolLevel * (1.0 - smoothstep(0.1, 0.125, min(abs(abs(vPoolAt.x) - ${LANE_X.toFixed(2)}), abs(vPoolAt.x)))) * smoothstep(${(BASIN_FAR + 0.9).toFixed(2)}, ${(BASIN_FAR + 1.1).toFixed(2)}, vPoolAt.z) * (1.0 - smoothstep(${(BASIN_NEAR - 1.1).toFixed(2)}, ${(BASIN_NEAR - 0.9).toFixed(2)}, vPoolAt.z));
// and the wet patches to the floor of the deep end
float poolDry = smoothstep(-11.0, -6.0, vPoolAt.z);
float poolWet = (1.0 - poolBelow) * poolFlat * smoothstep(0.5, 0.7, poolBlot) * 0.45;
if (poolLevel > 0.0 && poolDry < 1.0) poolWet = poolLevel * smoothstep(0.52, 0.7, poolFbm(vPoolAt.xz * 0.55 + 4.0)) * (1.0 - poolDry) + poolWet;
diffuseColor.rgb *= mix(0.84, 1.08, poolBlot);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.6, 0.57, 0.44), smoothstep(0.36, 0.72, poolBlot) * poolBelow * 0.7);
diffuseColor.rgb *= 1.0 - poolWall * (smoothstep(0.5, 0.72, poolStreak) * 0.36 + smoothstep(0.56, 0.7, poolLines) * 0.24);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.075, 0.035), poolRust * 0.62);
diffuseColor.rgb *= mix(1.0, 0.8, poolLevel * (1.0 - smoothstep(-3.1, -1.2, vPoolAt.y)));
diffuseColor.rgb *= 1.0 - min(0.8, poolCorner * 0.75);
diffuseColor.rgb *= 1.0 - 0.93 * poolGutter;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.13, poolLane);
`;

const RIPPLE_WET = /* glsl */ `
roughnessFactor = mix(roughnessFactor, 0.24, min(poolWet, 1.0));
`;

/** On tile the water-light is green; on cloth, chairs and whatever else sits in it, paler and weaker. */
const RIPPLE_GLOW_BUILT = /* glsl */ `
totalEmissiveRadiance += diffuseColor.rgb * vec3(0.5, 0.9, 0.8) * poolWaterLight(vPoolAt) * uPoolLight;
`;
const RIPPLE_GLOW_CLOTH = /* glsl */ `
totalEmissiveRadiance += diffuseColor.rgb * (vec3(0.09, 0.1, 0.105) + vec3(0.42, 0.46, 0.46) * poolWaterLight(vPoolAt)) * uPoolLight;
`;

/** Less pink than their own skin, and on the bigger ones grey saddles, which is what says snake from across a hall (the thin first ones stay pale, like water). */
const SNAKE_SKIN = /* glsl */ `
float poolRing = vSnake.w / vSnakeMark.z;
float poolBand = smoothstep(-0.1, 0.35, sin(poolRing * 0.52 + vSnakeMark.x * 31.0) + 0.4 * sin(poolRing * 1.43 + vSnakeMark.x * 17.0));
float poolBody = smoothstep(5.5, 6.5, vSnake.z) * smoothstep(0.024, 0.03, vSnakeMark.z);
diffuseColor.rgb = mix(snakeColor * vec3(0.84, 0.92, 0.8), snakeColor * vec3(0.36, 0.39, 0.33), poolBand * poolBody);
`;

/** What the glass looks like from inside at night: dirty panes, the moon behind them, bare branches. */
function paintWindow(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(41);
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#a4c0d2');
  sky.addColorStop(1, '#5d7f96');
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);
  const moon = c.createRadialGradient(w * 0.64, h * 0.3, 0, w * 0.64, h * 0.3, h * 0.6);
  moon.addColorStop(0, 'rgba(255,255,255,1)');
  moon.addColorStop(0.16, 'rgba(245,250,255,1)');
  moon.addColorStop(0.2, 'rgba(214,230,242,0.6)');
  moon.addColorStop(1, 'rgba(160,190,210,0)');
  c.fillStyle = moon;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(6,12,16,0.9)';
  c.lineCap = 'round';
  const grow = (x: number, y: number, angle: number, length: number, width: number, left: number) => {
    const tx = x + Math.cos(angle) * length;
    const ty = y + Math.sin(angle) * length;
    c.lineWidth = width;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(tx, ty);
    c.stroke();
    if (left === 0) return;
    grow(tx, ty, angle + 0.22 + random() * 0.55, length * (0.62 + random() * 0.2), width * 0.66, left - 1);
    grow(tx, ty, angle - 0.22 - random() * 0.55, length * (0.62 + random() * 0.2), width * 0.66, left - 1);
  };
  grow(-0.03 * w, h * 0.98, -0.82, h * 0.36, h * 0.05, 7);
  grow(w * 1.03, h * 0.78, -2.45, h * 0.3, h * 0.04, 6);
  for (let i = 0; i < 60; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = (0.03 + random() * 0.12) * h;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(10,18,20,${0.16 + random() * 0.4})`);
    g.addColorStop(1, 'rgba(10,18,20,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  // panes that are darker than the others: blacked out, boarded, years ago
  c.fillStyle = 'rgba(4,10,12,0.82)';
  for (const [i, j] of [[0, 0], [0, 1], [3, 4], [4, 4], [1, 4]]) c.fillRect((i / WINDOW_COLUMNS) * w, (j / WINDOW_ROWS) * h, w / WINDOW_COLUMNS, h / WINDOW_ROWS);
}

/** A soft dark round, for where things meet the floor. */
function softBlob(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d')!;
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  return new CanvasTexture(canvas);
}

/** Where the neck goes into a head mesh baked in a pose, in that mesh's own coordinates. */
function neckOf(head: InstancedMesh): Vector3 {
  const p = head.geometry.getAttribute('position');
  let low = Infinity;
  for (let i = 0; i < p.count; i++) low = Math.min(low, p.getY(i));
  let n = 0;
  let x = 0;
  let z = 0;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) >= low + 0.03) continue;
    x += p.getX(i);
    z += p.getZ(i);
    n++;
  }
  return new Vector3(x / Math.max(1, n), low + NECK_ABOVE, z / Math.max(1, n));
}

/** The two feet of a seated body, in its own coordinates. */
function feetOf(body: InstancedMesh): [Vector3, Vector3] {
  const p = body.geometry.getAttribute('position');
  const a = new Vector3();
  const b = new Vector3();
  let na = 0;
  let nb = 0;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0.12) continue;
    if (p.getX(i) > 0) {
      a.x += p.getX(i);
      a.z += p.getZ(i);
      na++;
    } else {
      b.x += p.getX(i);
      b.z += p.getZ(i);
      nb++;
    }
  }
  a.divideScalar(Math.max(1, na));
  b.divideScalar(Math.max(1, nb));
  a.z -= 0.05;
  b.z -= 0.05;
  return [a, b];
}

/** One who sits: its head is its own mesh, and turns about the neck. */
interface Sitter {
  head: InstancedMesh;
  index: number;
  neck: Vector3;
  body: Matrix4;
  /** Where the head ends up, off the way the body faces (rad). */
  yaw: number;
  pitch: number;
}

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const qa = new Quaternion();
const qb = new Quaternion();
const va = new Vector3();
const turned = new Matrix4();
const whole = new Matrix4();
const scratch = new Matrix4();

/**
 * A drained swimming pool at night. Rows of chairs stand on the floor of the deep end, facing the deep wall, with the
 * stitched people sitting in them and one seat empty. Water-light ripples over everything though there is no water,
 * and on the deep wall in black tile where the depth should be it says the hour of the dinner. A tap comes on, a thin
 * pale line comes down the slope, it is many, and when the whole floor is alive every head comes up and looks at you.
 */
export default class Pool extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x071210, density: 0.026 },
    env: 'evening',
    envIntensity: 0.1,
    sky: 0,
    grade: { exposure: 1.18, saturation: 0.8, warmth: -0.01, tint: -0.02, flare: 0.003 },
  };
  film = { bloom: 0.95, bloomFrom: 0.6, bloomTint: [0.82, 0.95, 1] as const, grain: 0.45, flicker: 0.02, weave: 0.0004 };
  focus = 10;
  aperture = 4;
  drift = REDUCED_MOTION ? 0.3 : 0.7;
  fear = 0.35;

  private readonly rippleTime = { value: RIPPLE_START };
  private readonly rippleLight = { value: RIPPLE_CALM };
  private readonly rippleOrigin = { value: this.origin };
  private readonly dust: { value: number }[] = [];
  private readonly sitters: Sitter[] = [];
  private readonly heads: InstancedMesh[] = [];
  private readonly watcher: Sitter;
  private readonly watcherFrom: Quaternion;
  private readonly watcherNeck: Vector3;
  private readonly moonlight;
  private readonly faceLight;
  private readonly water: Mesh;
  private readonly fall: number;
  private readonly swarm: Snakes;
  private readonly close: Snakes;
  private readonly closeCount: number;
  private readonly appears: Float32Array;
  private readonly placed: Float32Array;
  private readonly focusAt: Vector3;
  private growing = false;
  private lift = -1;
  private turn = -1;
  private readonly hushed: RoomVoice[] = [];
  private trickle: RoomVoice | null = null;

  constructor(ctx: RoomContext) {
    super(ctx);
    const kit = this.kit;
    const b = this.build;
    const root = this.root;
    const at = (s: number) => s / this.seconds;
    this.keys = [
      { t: 0, at: [-4.05, 1.58, -2.0], yaw: -21, pitch: -9.5, fov: 44 },
      { t: at(5), at: [-4.03, 1.58, -2.75], yaw: -23.5, pitch: -9.5, fov: 43 },
      { t: at(9), at: [-3.98, 1.57, -3.45], yaw: -27.5, pitch: -15, fov: 39 },
      { t: at(12), at: [-3.94, 1.56, -4.15], yaw: -33, pitch: -20, fov: 36 },
      { t: at(13.2), at: [-3.92, 1.56, -4.5], yaw: -36, pitch: -23, fov: 34 },
      { t: 1, at: [-3.92, 1.56, -4.8], yaw: -37, pitch: -23.5, fov: 32 },
    ];
    if (!REDUCED_MOTION) {
      this.warp = [
        { at: 0, bendUp: 0.001, bendAside: -0.0008, twist: 0, wave: 0 },
        { at: at(LINE_AT), bendUp: 0.0015, bendAside: 0.0008, twist: 0.0006, wave: 0 },
        { at: at(TURN_TO), bendUp: 0.012, bendAside: 0.002, twist: 0.002, wave: 0 },
        { at: 1, bendUp: 0.013, bendAside: 0.002, twist: 0.002, wave: 0 },
      ];
    }

    const part = (list: BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number) => {
      list.push(meterUVs(new BoxGeometry(w, h, d, Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)), Math.max(1, Math.ceil(d)))).translate(x, y, z));
    };
    const solid = (parts: BufferGeometry[], material: Material, casts = false) => {
      const m = new Mesh(mergeGeometries(parts)!, material);
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.castShadow = casts;
      root.add(m);
      return m;
    };

    // the hall
    const deck = this.tiled('tile_white', 0.9, 0x6e8279, 0.55);
    const wallTile = this.tiled('tile_white', 1.2, 0xa9c4b2);
    const plaster = this.tiled('plaster_mould', 1.8, 0x7f8f86);
    const structure = this.tiled('plaster_mould', 1.8, 0x59675f);
    const floorPiece = (x0: number, x1: number, z0: number, z1: number) => root.add(kit.floor(x0, x1, z0, z1, 0, deck));
    floorPiece(-HALL_X, -BASIN_X, HALL_FAR, HALL_BACK);
    floorPiece(BASIN_X, HALL_X, HALL_FAR, HALL_BACK);
    floorPiece(-BASIN_X, BASIN_X, HALL_FAR, BASIN_FAR);
    floorPiece(-BASIN_X, BASIN_X, BASIN_NEAR, HALL_BACK);
    const roof = kit.floor(-HALL_X, HALL_X, HALL_FAR, HALL_BACK, HALL_H, plaster);
    roof.rotation.x = Math.PI / 2;
    root.add(roof);
    const hallLong = HALL_BACK - HALL_FAR;
    const hallMid = (HALL_BACK + HALL_FAR) / 2;
    for (const [side, facing] of [[1, '-x'], [-1, '+x']] as const) {
      b.wall(side * HALL_X, hallMid, hallLong, TILE_TO, facing, wallTile, root);
      b.wall(side * HALL_X, hallMid, hallLong, HALL_H - TILE_TO, facing, plaster, root, TILE_TO);
    }
    b.wall(0, HALL_BACK, 2 * HALL_X, TILE_TO, '-z', wallTile, root);
    b.wall(0, HALL_BACK, 2 * HALL_X, HALL_H - TILE_TO, '-z', plaster, root, TILE_TO);
    b.wall(0, HALL_FAR, 2 * HALL_X, TILE_TO, '+z', wallTile, root);
    const windowLeft = WINDOW_X - WINDOW_W / 2;
    const windowRight = WINDOW_X + WINDOW_W / 2;
    const windowHead = WINDOW_SILL + WINDOW_H;
    const windowMid = WINDOW_SILL + WINDOW_H / 2;
    b.wall(0, HALL_FAR, 2 * HALL_X, WINDOW_SILL - TILE_TO, '+z', plaster, root, TILE_TO);
    b.wall(0, HALL_FAR, 2 * HALL_X, HALL_H - windowHead, '+z', plaster, root, windowHead);
    b.wall((-HALL_X + windowLeft) / 2, HALL_FAR, windowLeft + HALL_X, WINDOW_H, '+z', plaster, root, WINDOW_SILL);
    b.wall((windowRight + HALL_X) / 2, HALL_FAR, HALL_X - windowRight, WINDOW_H, '+z', plaster, root, WINDOW_SILL);

    // piers, beams, the rail where tile meets plaster
    const frame: BufferGeometry[] = [];
    for (const z of PIERS) {
      for (const side of [-1, 1]) part(frame, 0.26, HALL_H, 0.5, side * (HALL_X - 0.13), HALL_H / 2, z);
      part(frame, 2 * HALL_X, 0.56, 0.42, 0, HALL_H - 0.28, z);
    }
    for (const side of [-1, 1]) part(frame, 0.05, 0.08, hallLong, side * (HALL_X - 0.025), TILE_TO, hallMid);
    part(frame, 2 * HALL_X, 0.08, 0.05, 0, TILE_TO, HALL_FAR + 0.025);
    part(frame, 2 * HALL_X, 0.08, 0.05, 0, TILE_TO, HALL_BACK - 0.025);
    solid(frame, structure);

    // the basin and its lip, which draws the pool's outline in the dark
    solid([basinGeometry()], this.tiled('tile_pool', 1.4, 0xeaf5e8, 0.62));
    const corners = { nl: [-BASIN_X, BASIN_NEAR], nr: [BASIN_X, BASIN_NEAR], fr: [BASIN_X, BASIN_FAR], fl: [-BASIN_X, BASIN_FAR] } as const;
    const out = { nl: [-1, 1], nr: [1, 1], fr: [1, -1], fl: [-1, -1] } as const;
    solid(
      [lipSide(corners.fl, corners.nl, out.fl, out.nl), lipSide(corners.nr, corners.fr, out.nr, out.fr), lipSide(corners.nl, corners.nr, out.nl, out.nr), lipSide(corners.fr, corners.fl, out.fr, out.fl)],
      this.tiled('tile_bone', 1.1, 0xece9dc, 0.55),
    );

    // what it says on the deep wall, where the depth should be
    const letters = NUMERAL_TEXT.split('');
    const across = letters.reduce((sum, d) => sum + NUMERALS[d][0].length + 1, -1);
    const numerals = b.label(
      across * NUMERAL_CELL,
      7 * NUMERAL_CELL,
      (c, w, h) => {
        const r = randomFrom(23);
        const q = w / across;
        const k = h / 7;
        let x = 0;
        for (const d of letters) {
          NUMERALS[d].forEach((row, j) => {
            for (let i = 0; i < row.length; i++) {
              if (row[i] !== '1' || r() < 0.05) continue;
              const v = 5 + Math.floor(r() * 14);
              c.fillStyle = `rgba(${v},${v + 4},${v + 3},0.94)`;
              c.fillRect((x + i) * q + 1, j * k + 1, q - 2, k - 2);
            }
          });
          x += NUMERALS[d][0].length + 1;
        }
      },
      { transparent: true, px: 120, roughness: 0.3 },
    ).mesh;
    numerals.position.set(0, NUMERAL_Y, BASIN_FAR + 0.012);
    root.add(numerals);

    // the window: real depth, iron bars, and behind it a sheet that lets the moon through only here
    const glass = b.label(WINDOW_W, WINDOW_H, paintWindow, { emissive: WINDOW_GLOW, px: 200 }).mesh;
    glass.position.set(WINDOW_X, windowMid, HALL_FAR - WINDOW_DEPTH);
    root.add(glass);
    const iron: BufferGeometry[] = [];
    const barZ = HALL_FAR - 0.18;
    for (let i = 0; i <= WINDOW_COLUMNS; i++) part(iron, i % WINDOW_COLUMNS === 0 ? 0.09 : 0.034, WINDOW_H, 0.05, windowLeft + (i * WINDOW_W) / WINDOW_COLUMNS, windowMid, barZ);
    for (let j = 0; j <= WINDOW_ROWS; j++) part(iron, WINDOW_W, j % WINDOW_ROWS === 0 ? 0.09 : 0.034, 0.05, WINDOW_X, WINDOW_SILL + (j * WINDOW_H) / WINDOW_ROWS, barZ);
    part(iron, 0.04, WINDOW_H + 0.08, WINDOW_DEPTH, windowLeft - 0.02, windowMid, HALL_FAR - WINDOW_DEPTH / 2);
    part(iron, 0.04, WINDOW_H + 0.08, WINDOW_DEPTH, windowRight + 0.02, windowMid, HALL_FAR - WINDOW_DEPTH / 2);
    part(iron, WINDOW_W + 0.08, 0.04, WINDOW_DEPTH, WINDOW_X, WINDOW_SILL - 0.02, HALL_FAR - WINDOW_DEPTH / 2);
    part(iron, WINDOW_W + 0.08, 0.04, WINDOW_DEPTH, WINDOW_X, windowHead + 0.02, HALL_FAR - WINDOW_DEPTH / 2);
    const ironPaint = new MeshStandardMaterial({ color: 0x0b1110, roughness: 0.6, metalness: 0.4 });
    solid(iron, ironPaint, true);
    const sheetZ = HALL_FAR - WINDOW_DEPTH - 0.5;
    const blind: BufferGeometry[] = [];
    part(blind, 30, 12, 0.1, WINDOW_X, windowHead + 6, sheetZ);
    part(blind, 30, 12, 0.1, WINDOW_X, WINDOW_SILL - 6, sheetZ);
    part(blind, 12, WINDOW_H, 0.1, windowLeft - 6, windowMid, sheetZ);
    part(blind, 12, WINDOW_H, 0.1, windowRight + 6, windowMid, sheetZ);
    solid(blind, ironPaint, true);
    b.glow(WINDOW_X, windowMid, HALL_FAR + 0.25, 7.5, PALETTE.cold, 0.3, root);

    // the moon goes over their heads and lies on the bare tile behind them
    const emptyX = COLUMN_X[EMPTY.column];
    const emptyZ = ROW_Z[EMPTY.row];
    this.focusAt = new Vector3(emptyX, floorAt(emptyZ) + 0.6, emptyZ);
    const target = new Vector3(MOON_AT[0], floorAt(MOON_AT[1]), MOON_AT[1]);
    const pane = new Vector3(WINDOW_X, windowMid, HALL_FAR);
    const lamp = target.clone().add(pane.clone().sub(target).multiplyScalar(MOON_BEYOND));
    const coneDeg = (Math.atan((Math.hypot(WINDOW_W, WINDOW_H) * 0.72) / pane.distanceTo(lamp)) * 180) / Math.PI;
    this.moonlight = this.spot([lamp.x, lamp.y, lamp.z], [target.x, target.y, target.z], PALETTE.cold, MOON, coneDeg, 0.08);
    this.spots = [this.moonlight, null, null];
    const shaft = (offset: number, top: number, bottom: number, strength: number) => {
      const from = new Vector3(WINDOW_X + offset, windowMid, HALL_FAR);
      const to = new Vector3(target.x + offset * 1.6, target.y - 0.3, target.z);
      const length = from.distanceTo(to);
      const m = b.beam(0, 0, 0, top, bottom, length, PALETTE.cold, strength, root);
      m.position.copy(from).add(to).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(AXIS_Y, from.clone().sub(to).normalize());
    };
    shaft(0, 1.35, 2.3, 0.11);
    shaft(-0.55, 0.42, 0.72, 0.1);
    shaft(0.5, 0.36, 0.62, 0.12);

    // the other lights: nothing else in here should be seen to shine
    this.light([-0.5, -0.2, -5.6], 0xd2dee0, WATER_FILL, 12);
    this.light([-4.2, 3.2, -6], 0x7fa0a0, DECK_FILL, 9);
    this.light([0.4, 3.2, -8.2], 0xd8e2ee, MOON_WASH, 11);
    this.faceLight = this.light([-2.6, 3.4, -5.6], 0xd6e8e2, 0, 12);

    // ladders that go down to nothing, a tap, the drain
    const chrome = new MeshStandardMaterial({ color: 0xd8e0e0, metalness: 0.55, roughness: 0.22 });
    for (const [side, z] of LADDERS) kit.paint(kit.prop('pool_ladder', [side * BASIN_X, LADDER_FOOT, z], { rotation: [0, side < 0 ? 90 : -90, 0], castShadow: true }, root), chrome);
    kit.prop('faucet', [BASIN_X - 0.1, TAP_Y, TAP_Z], { rotation: [0, -90, 0], scale: 2.2, anchor: 'center' }, root);
    const pipe = new Mesh(new CylinderGeometry(0.018, 0.018, -TAP_Y, 8), chrome);
    pipe.position.set(BASIN_X - 0.03, TAP_Y / 2, TAP_Z);
    root.add(pipe);
    kit.prop('drain_grate', [0, floorAt(-14.6) + 0.003, -14.6], { scale: 3.4 }, root);
    this.fall = TAP_Y - 0.14 - floorAt(TAP_Z);
    this.water = new Mesh(new CylinderGeometry(0.007, 0.0045, 1, 5, 1).translate(0, -0.5, 0), new MeshStandardMaterial({ color: 0x000000, emissive: new Color(0x8fb0a8) }));
    this.water.position.set(BASIN_X - 0.28, TAP_Y - 0.14, TAP_Z);
    this.water.frustumCulled = false;
    this.water.visible = false;
    root.add(this.water);

    // lockers and benches along the deck
    const lockers = kit.props('locker', 16, { scale: 1.5, rotation: [0, 90, 0] });
    for (let i = 0; i < 16; i++) lockers.set(i, -HALL_X + 0.16, 0, (i < 10 ? -1.75 : -2.1) - i * 0.31, 0, 1);
    lockers.commit();
    kit.paint(lockers.root, this.tiled('plaster_mould', 1.8, 0x414d48));
    root.add(lockers.root);
    const benches = kit.props('bench_changing', 3, { rotation: [0, -90, 0] });
    for (let i = 0; i < 3; i++) benches.set(i, HALL_X - 0.34, 0, -2.8 - i * 3.9, 0, 1);
    benches.commit();
    root.add(benches.root);

    // behind you: the doors you did not come through, and the table with the clock
    for (const x of [-0.56, 0.56]) b.door(x, HALL_BACK, '-z', root, { color: 0x18221f, width: 1.04, height: 2.3 });
    const table = b.lampTable(-3.4, HALL_BACK - 0.36, root, Math.PI);
    this.light(table.lightAt, PALETTE.warm, LAMP, 3.2);
    b.glow(table.lightAt[0], table.lightAt[1], table.lightAt[2], 1, PALETTE.warm, 0.4, root);
    b.clock(-3.1, table.top + 0.018, HALL_BACK - 0.42, root, 1).root.rotation.y = Math.PI;

    this.dust.push(b.motes(150, { x: [-HALL_X, HALL_X], y: [-2.8, 5.6], z: [HALL_FAR, HALL_BACK] }, root, { size: 0.006, color: 0xcfe0dc, strength: 0.28 }).time);
    this.dust.push(b.motes(110, { x: [-1.4, 3.4], y: [-1.4, 4.2], z: [-15, -7] }, root, { size: 0.009, color: 0xe4eff6, strength: 0.75, seed: 5 }).time);

    // the chairs, tipped with the floor they stand on
    const random = randomFrom(SEED);
    const rows = ROW_Z.length;
    const columns = COLUMN_X.length;
    const chairs = kit.props('chair_white', rows * columns, { castShadow: true });
    this.rippleOn(chairs.root, CHAIR_TINT);
    this.inFrontFirst(chairs.root);
    const tilt = new Quaternion().setFromAxisAngle(AXIS_X, -RAKE);
    const ONE = new Vector3(1, 1, 1);
    const every: Matrix4[] = [];
    const seats: Matrix4[] = [];
    let emptySeat = new Matrix4();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const x = COLUMN_X[c] + (random() - 0.5) * 0.05;
        const z = ROW_Z[r] + (random() - 0.5) * 0.06;
        const face = new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI + (random() - 0.5) * 0.07);
        const m = new Matrix4().compose(new Vector3(x, floorAt(z), z), tilt.clone().multiply(face), ONE);
        chairs.setMatrix(r * columns + c, m);
        every.push(m);
        if (r === EMPTY.row && c === EMPTY.column) emptySeat = m;
        else seats.push(m);
      }
    }
    chairs.commit();
    root.add(chairs.root);

    // contact: nothing here is near the moon's shadow except what stands in it
    const blobs = new InstancedMesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: softBlob(), transparent: true, depthWrite: false }), rows * columns + seats.length + 2);
    blobs.frustumCulled = false;
    blobs.renderOrder = 1;
    const flatOn = new Quaternion().setFromAxisAngle(AXIS_X, -Math.PI / 2);
    const lay = (i: number, seat: Matrix4, z: number, sx: number, sy: number) => {
      blobs.setMatrixAt(i, scratch.copy(seat).multiply(new Matrix4().compose(new Vector3(0, 0.012, z), flatOn, new Vector3(sx, sy, 1))));
    };
    every.forEach((seat, i) => lay(i, seat, 0, 0.74, 0.82));
    seats.forEach((seat, i) => lay(rows * columns + i, seat, 0.42, 0.62, 0.42));
    lay(rows * columns + seats.length, new Matrix4().makeTranslation(WATCHER[0], 0, WATCHER[2]), 0, 1.3, 1.3);
    lay(rows * columns + seats.length + 1, new Matrix4().makeTranslation(-3.4, 0, HALL_BACK - 0.36), 0, 1.5, 1.1);
    blobs.instanceMatrix.needsUpdate = true;
    root.add(blobs);

    // those who sit, with one on the deck who sits apart
    kit.prop('chair_worn', [WATCHER[0], 0, WATCHER[2]], { rotation: [0, -90, 0], scale: 0.8 }, root);
    const watcherTurn = new Quaternion().setFromAxisAngle(AXIS_Y, -Math.PI / 2);
    const bodies = seats.map((seat) => seat.clone().multiply(new Matrix4().makeTranslation(0, 0, -SIT_BACK)));
    bodies.push(new Matrix4().compose(new Vector3(WATCHER[0], 0, WATCHER[2]), watcherTurn, ONE).multiply(new Matrix4().makeTranslation(0, 0, -SIT_BACK)));
    const cloth = new Map<Material, MeshStandardMaterial>();
    const eye = new Vector3(...EYE_AT);
    const feet: Vector3[] = [];
    POSES.forEach((time, pose) => {
      const mine = bodies.flatMap((body, i) => (i % POSES.length === pose ? [{ body, i }] : []));
      const crowd = b.sack(mine.length, { clip: 'm_sit_chair_idle_roll_head', time, tint: CLOTH });
      const parts = crowd.root.children as InstancedMesh[];
      const head = parts.find((m) => /head/.test((m.material as Material).name))!;
      const trunk = parts.find((m) => m !== head)!;
      const neck = neckOf(head);
      const [footA, footB] = feetOf(trunk);
      for (const m of parts) {
        const source = m.material as MeshStandardMaterial;
        if (!cloth.has(source)) cloth.set(source, this.rippled(source, false));
        m.material = cloth.get(source)!;
        m.castShadow = true;
      }
      mine.forEach(({ body, i }, index) => {
        crowd.setMatrix(index, body);
        const q = new Quaternion().setFromRotationMatrix(body);
        const toEye = eye.clone().sub(neck.clone().applyMatrix4(body)).applyQuaternion(q.clone().invert());
        const sitter: Sitter = { head, index, neck, body, yaw: Math.atan2(toEye.x, toEye.z), pitch: Math.min(1.1, Math.atan2(toEye.y, Math.hypot(toEye.x, toEye.z))) };
        if (i === bodies.length - 1) this.watcherSeated = sitter;
        else {
          this.sitters.push(sitter);
          feet.push(footA.clone().applyMatrix4(body), footB.clone().applyMatrix4(body));
        }
      });
      crowd.commit();
      this.heads.push(head);
      root.add(crowd.root);
      this.inFrontFirst(crowd.root);
    });
    this.watcher = this.watcherSeated!;
    this.watcherFrom = watcherTurn.clone().invert();
    this.watcherNeck = this.watcher.neck.clone().applyMatrix4(this.watcher.body);
    this.poseHeads(0, 0);

    // the first thin one and those that climb: near snakes
    const climbers: SnakePlace[] = [];
    const climb = (post: Vector3, radius: number, delay: number, speed: number, length: number) => {
      const heading = random() * Math.PI * 2;
      const girth = length * 0.015;
      const r = radius + girth;
      climbers.push({
        at: [post.x + Math.cos(heading) * r, floorAt(post.z), post.z - Math.sin(heading) * r],
        heading,
        way: 'crawl',
        speed,
        length,
        girth,
        bend: 1 / r,
        climb: 0.24,
        swing: 0.12,
        waves: 1,
        delay,
        normal: SLOPE,
      });
    };
    for (const [lx, lz] of [[0.18, 0.22], [-0.18, 0.22], [0.18, -0.2], [-0.18, -0.2], [0.18, 0.22]] as const) climb(new Vector3(lx, 0, lz).applyMatrix4(emptySeat), 0.022, 12 + random() * 0.4, 0.5 + random() * 0.25, 1 + random() * 0.5);
    for (const i of [2, 9, 14, 21, 26, 33, 38, 45]) climb(feet[i], 0.055, 12.1 + random() * 0.5, 0.38 + random() * 0.2, 0.9 + random() * 0.5);
    for (let i = 0; i < BIG_ONES; i++) {
      const z = -6.9 - random() * 2.9;
      climbers.push({ at: [-BASIN_X, floorAt(z), z], heading: -Math.PI / 2 + (random() - 0.5) * 0.8, way: 'crawl', speed: 0.55 + random() * 0.35, length: 2.3 + random() * 1.3, girth: 0.034 + random() * 0.016, swing: 0.7, waves: 1.6, delay: 11.9 + random() * 0.5, normal: SLOPE });
    }
    this.close = new Snakes(2 + climbers.length, { seed: 5 });
    const line = (i: number, x: number, z: number, delay: number) =>
      this.close.place(i, {
        at: [x, floorAt(z), z],
        heading: Math.atan2(x - emptyX, z - emptyZ),
        way: 'crawl',
        speed: LINE_SPEED,
        length: LINE_LENGTH,
        girth: LINE_GIRTH,
        swing: 0.42,
        waves: 3.4,
        bend: 0.14,
        delay,
        normal: SLOPE,
      });
    line(0, -BASIN_X, LINE_Z, LINE_AT + 0.35);
    // this one has left the foot of the wall under the tap already when it comes into sight, at 11
    line(1, BASIN_X, TAP_Z, LINE_AT - 0.9);
    climbers.forEach((spec, i) => this.close.place(2 + i, spec));
    this.closeCount = 2 + climbers.length;
    this.reskin(this.close);
    root.add(this.close.root);

    // the many: from the foot of the walls, and then, from the walls inward, the floor itself
    const spawns: { appear: number; spec: SnakePlace }[] = [];
    for (let i = 0; i < CRAWLERS; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const z = -6.9 - random() * 6.4;
      const delay = MANY_FROM + random() * (MANY_BY - MANY_FROM);
      const length = 0.9 + random() * 1.2;
      spawns.push({
        appear: delay - 0.6,
        spec: { at: [side * BASIN_X, floorAt(z), z], heading: side * (Math.PI / 2 + (random() - 0.5) * 0.9), way: 'crawl', speed: 0.9 + random() * 0.8, length, girth: length * 0.012, delay, normal: SLOPE },
      });
    }
    for (let i = 0; i < KNOTS_SLOPE + KNOTS_SUMP; i++) {
      const onSlope = i < KNOTS_SLOPE;
      const x = (random() * 2 - 1) * (BASIN_X - 0.22);
      const z = onSlope ? -6.8 - random() * 6.6 : -13.9 - random() * 1.5;
      const inward = 1 - Math.abs(x) / BASIN_X;
      const length = 1.3 + random() * 1.5;
      // a few wind over themselves in one place; most lie in the slow curves of a snake on its way
      const tight = random() < 0.18;
      spawns.push({
        appear: MANY_FROM + 0.1 + (MANY_BY - MANY_FROM - 0.2) * inward + random() * 0.14,
        spec: { at: [x, floorAt(z), z], heading: random() * Math.PI * 2, way: tight ? 'knot' : 'crawl', speed: tight ? undefined : 0.02 + random() * 0.05, length, girth: length * (0.0125 + random() * 0.0055), swing: tight ? 2.2 + random() * 0.6 : 0.85 + random() * 0.35, waves: tight ? 1 + random() * 0.5 : 1.4 + random() * 0.9, normal: onSlope ? SLOPE : undefined },
      });
    }
    spawns.sort((a, c) => a.appear - c.appear);
    this.swarm = new Snakes(spawns.length, { detail: 'crowd', seed: 9 });
    spawns.forEach((w, i) => this.swarm.place(i, w.spec));
    this.appears = Float32Array.from(spawns, (w) => w.appear);
    this.placed = new Float32Array(spawns.length * 16);
    for (let i = 0; i < spawns.length; i++) {
      this.swarm.root.getMatrixAt(i, scratch);
      scratch.toArray(this.placed, i * 16);
    }
    this.reskin(this.swarm);
    root.add(this.swarm.root);

    this.beat(0, () => {
      this.hushed.push(this.sound.bed('rooms/pool_room_tone.mp3', { gain: 0.3, fade: 1.6 }));
      this.hushed.push(this.sound.bed('rooms/underwater_pool.mp3', { gain: 0.08, lowpass: 1400, fade: 3 }));
      this.hushed.push(this.sound.bed('rooms/dream_drone_hollow.mp3', { gain: 0.1, fade: 3 }));
    });
    this.beat(2.3, () => this.sound.play('rooms/pool_drip_1.mp3', { gain: 0.45, pan: -0.3 }));
    this.beat(5.7, () => this.sound.play('rooms/pool_drip_2.mp3', { gain: 0.4, pan: 0.45 }));
    this.beat(TAP_AT, () => this.hushed.push(this.sound.play('rooms/tap_start.mp3', { gain: 0.3, pan: 0.55 })));
    this.beat(9.6, () => this.hushed.push(this.sound.bed('rooms/drain_gurgle.mp3', { gain: 0.12, lowpass: 1500, fade: 2 })));
    this.beat(LINE_AT, () => {
      this.trickle = this.sound.bed('rooms/water_trickle.mp3', { gain: 0.2, reverb: 0.4, pan: 0.35, fade: 0.5 });
      this.hushed.push(this.trickle);
    });
    this.beat(MANY_FROM, () => {
      this.trickle?.gain(0, 0.5);
      this.hushed.push(this.sound.bed('rooms/snakes_scales.mp3', { gain: 0.28, reverb: 0.3, fade: 0.9 }));
    });
    // every sound stops at once, the hiss and the coats come out of nothing
    this.beat(HUSH_AT, () => {
      for (const v of this.hushed) v.gain(0, 0.14);
    });
    this.beat(LIFT_FROM, () => {
      this.sound.play('rooms/crowd_rise.mp3', { gain: 0.4, reverb: 0.5 });
      this.sound.play('rooms/snake_hiss_close.mp3', { gain: 0.35 });
    });
    this.beat(SHUTTER_AT, () => this.shutter());
    this.beat(CUT_AT, () => this.sound.stopAll(0.04));
  }

  private watcherSeated: Sitter | null = null;

  /** A material of this room: the water-light and, for what is built, the years. */
  private rippled(material: MeshStandardMaterial, grime: boolean): MeshStandardMaterial {
    const m = material.clone();
    m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uPoolTime = this.rippleTime;
      shader.uniforms.uPoolLight = this.rippleLight;
      shader.uniforms.uPoolOrigin = this.rippleOrigin;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${RIPPLE_VERT_PARS}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${RIPPLE_VERT}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${RIPPLE_FRAG_PARS}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${grime ? RIPPLE_GRIME : ''}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${grime ? RIPPLE_WET : ''}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${grime ? RIPPLE_GLOW_BUILT : RIPPLE_GLOW_CLOTH}`);
    };
    m.customProgramCacheKey = () => `pool-ripple-${grime}`;
    return m;
  }

  /** Draws what is opaque under `root` before the tile behind it (see IN_FRONT_FIRST). */
  private inFrontFirst(root: Object3D): void {
    root.traverse((o) => {
      const mesh = o as Mesh;
      const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mesh.isMesh && materials.every((m) => !m.transparent)) mesh.renderOrder = IN_FRONT_FIRST;
    });
  }

  /** Changes how these snakes look, on top of their own shader. */
  private reskin(snakes: Snakes): void {
    const material = snakes.root.material as MeshStandardMaterial;
    const own = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      own.call(material, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace('diffuseColor.rgb = snakeColor;', SNAKE_SKIN);
    };
    material.customProgramCacheKey = () => 'room-snake-banded';
  }

  private tiled(key: string, tile: number, color: number, roughness?: number): MeshStandardMaterial {
    return this.rippled(this.kit.surface(key, tile, roughness === undefined ? { color: new Color(color) } : { color: new Color(color), roughness }), true);
  }

  private rippleOn(root: Object3D, tint: number): void {
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const material = this.rippled(mesh.material as MeshStandardMaterial, false);
      material.color.setHex(tint);
      mesh.material = material;
    });
  }

  /** Turns a head about its neck: `yaw` round, then `nod` forward (rad), in the frame of its body. */
  private aim(s: Sitter, yaw: number, nod: number): void {
    qa.setFromAxisAngle(AXIS_Y, yaw).multiply(qb.setFromAxisAngle(AXIS_X, nod));
    turned.makeRotationFromQuaternion(qa);
    va.copy(s.neck).applyQuaternion(qa);
    turned.setPosition(s.neck.x - va.x, s.neck.y - va.y, s.neck.z - va.z);
    s.head.setMatrixAt(s.index, whole.multiplyMatrices(s.body, turned));
  }

  private poseHeads(lift: number, turn: number): void {
    for (let i = 0; i < this.sitters.length; i++) {
      const s = this.sitters[i];
      this.aim(s, s.yaw * turn, BOW * (1 - lift) - s.pitch * lift);
    }
    for (let i = 0; i < this.heads.length; i++) this.heads[i].instanceMatrix.needsUpdate = true;
    this.lift = lift;
    this.turn = turn;
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const looked = ease(LIFT_FROM, TURN_TO, s);
    this.rippleTime.value = RIPPLE_START + s * RIPPLE_SPEED;
    this.rippleLight.value = RIPPLE_CALM + (RIPPLE_LOOKED - RIPPLE_CALM) * looked;
    this.moonlight.intensity = MOON * (1 + MOON_SURGE * looked);
    this.faceLight.intensity = FACE_FILL * looked;
    for (let i = 0; i < this.dust.length; i++) this.dust[i].value = frame.time;

    const running = ease(TAP_AT + 0.8, TAP_AT + 1.7, s);
    this.water.visible = running > 0;
    this.water.scale.y = Math.max(0.001, running * this.fall);

    this.close.update(s);
    this.swarm.update(s);
    this.close.reveal(s < LINE_AT - 1.5 ? 0 : s < MANY_FROM ? 2 : this.closeCount);
    let n = 0;
    while (n < this.appears.length && this.appears[n] <= s) n++;
    this.swarm.reveal(n);
    // each one swells out of the tile instead of being there all at once
    const swelling = s > this.appears[0] && s < this.appears[this.appears.length - 1] + GROW;
    if (swelling || this.growing) {
      for (let i = 0; i < n; i++) {
        const g = 0.25 + 0.75 * ease(this.appears[i], this.appears[i] + GROW, s);
        scratch.fromArray(this.placed, i * 16);
        const e = scratch.elements;
        for (let k = 0; k < 11; k++) if (k !== 3 && k !== 7) e[k] *= g;
        this.swarm.root.setMatrixAt(i, scratch);
      }
      this.swarm.root.instanceMatrix.needsUpdate = true;
      this.growing = swelling;
    }
    const up = ease(LIFT_FROM, LIFT_TO + 0.3, s);
    this.swarm.raise(RISE * up, EYE_AT, up);
    this.close.raise(RISE_NEAR * up, EYE_AT, up);

    const lift = ease(LIFT_FROM, LIFT_TO, s);
    const turn = ease(TURN_FROM, TURN_TO, s);
    if (lift !== this.lift || turn !== this.turn) this.poseHeads(lift, turn);
    // the one on the deck turns as you go by, from the first moment
    va.copy(frame.eye).sub(this.watcherNeck).applyQuaternion(this.watcherFrom);
    this.aim(this.watcher, Math.atan2(va.x, va.z), -Math.atan2(va.y, Math.hypot(va.x, va.z)));
    this.watcher.head.instanceMatrix.needsUpdate = true;

    this.focus = Math.hypot(frame.eye.x - this.focusAt.x, frame.eye.y - this.focusAt.y, frame.eye.z - this.focusAt.z);
    this.fear = 0.35 + 0.15 * ease(TAP_AT, LINE_AT, s) + 0.5 * ease(LINE_AT, TURN_TO, s);
    this.drift = s >= LIFT_FROM ? 0 : REDUCED_MOTION ? 0.3 : 0.7;
    this.black = s >= CUT_AT ? 1 : 0;
  }
}
