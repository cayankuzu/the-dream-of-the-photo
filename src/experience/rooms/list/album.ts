import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  Object3D,
  PlaneGeometry,
  Points,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type Bone,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { SpotSpec } from '../../../config/nightmare.config';
import { rigClock, type ClockHand } from '../../dream/ClockRig';
import { randomFrom, type Crowd, type FigureSpec, type HeroFigure } from '../../dream/FigureKit';
import type { DreamLight } from '../../dream/LightPool';
import { clamp, lerp, range, smootherstep, wobble } from '../../math';
import { WARP_GLSL, warpUniforms } from '../../render/Warp';
import { GlideTrack } from '../../timeline/Track';
import type { RoomAir, RoomAssets, RoomContext, RoomControl, RoomFrame, RoomKey, RoomPose } from '../Room';
import { Room } from '../Room';
import { PALETTE } from '../RoomKit';
import type { RoomVoice } from '../RoomSound';

const STEPS = ['rooms/wet_step_1.mp3', 'rooms/wet_step_2.mp3', 'rooms/wet_step_3.mp3', 'rooms/wet_step_4.mp3'];
const STEPS_BEHIND = ['rooms/wet_step_small_1.mp3', 'rooms/wet_step_small_2.mp3', 'rooms/wet_step_small_3.mp3'];
const CANDLES = ['rooms/candle_out_1.mp3', 'rooms/candle_out_2.mp3', 'rooms/candle_out_3.mp3', 'rooms/candle_out_4.mp3'];
const FORKS = ['rooms/fork_plate_1.mp3', 'rooms/fork_plate_2.mp3', 'rooms/fork_plate_3.mp3', 'rooms/fork_plate_4.mp3', 'rooms/fork_plate_5.mp3'];
const STABS = ['rooms/fork_stab_1.mp3', 'rooms/fork_stab_2.mp3', 'rooms/fork_stab_3.mp3', 'rooms/fork_stab_4.mp3'];
const CLINKS = ['rooms/plate_clink_1.mp3', 'rooms/plate_clink_2.mp3', 'rooms/plate_clink_3.mp3', 'rooms/plate_clink_4.mp3'];
const GLASSES = ['rooms/glass_set_1.mp3', 'rooms/glass_set_2.mp3'];

export const assets: RoomAssets = {
  models: ['dining_table', 'dining_chair', 'antique_camera', 'hanging_lamp', 'plate', 'fork', 'knife', 'spoon', 'tumbler', 'tea_glass', 'pot_enamel', 'buns', 'bowl', 'wall_clock', 'roast_lump'],
  materials: ['tile_wet'],
  sounds: [
    ...STEPS,
    ...STEPS_BEHIND,
    ...CANDLES,
    ...FORKS,
    ...STABS,
    ...CLINKS,
    ...GLASSES,
    'rooms/hall_vast.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/paper_flutter.mp3',
    'rooms/print_flutter.mp3',
    'rooms/pool_drip_1.mp3',
    'rooms/clock_tick.mp3',
    'rooms/clock_tick_once.mp3',
    'rooms/deep_bell.mp3',
    'rooms/hair_fingers.mp3',
    'rooms/chair_wood_move.mp3',
    'rooms/forks_close.mp3',
    'rooms/chew_small.mp3',
    'rooms/chew_soft.mp3',
    'rooms/chew_wet.mp3',
    'rooms/lip_smack.mp3',
    'rooms/fork_scrape_1.mp3',
    'rooms/fork_down_1.mp3',
    'rooms/heart_beat.mp3',
    'rooms/polaroid_motor.mp3',
  ],
};

/** The room's own length (s): the camera keys and beats are written against it. */
const ROOM_SECONDS = 70;
/** When things happen (s). */
const STIR_AT = [3.4, 4.7, 9.4, 10.6];
const LATE_AT = 12;
/** "Otur.": just before you are seated (s). */
const SIT_LINE_AT = 28;
const SIT_AT = 30;
const TICK_AT = 40;
const RAISE_AT = 44;
const RAISED_AT = 50;
const EAT_AT = 50;
const STOP_AT = 60;
const SHUTTER_AT = 64;
const CUT_AT = 68;
/** The ring of those who stood at the edge of the dark comes closer while nothing can be seen (s). */
const RING_CLOSES_AT = 50;

/** The hall (m): half its width, the wall with the door in it, the far wall, how high the walls go. */
const HALF_W = 13.05;
const BACK_Z = 1;
const FAR_Z = -66.5;
const HIGH = 44;
/** The way out of the corridor (m): half its width, its height, the door closed behind you. */
const DOOR_HALF = 0.65;
const DOOR_H = 2.4;
const DOOR_Z = 3;
/** How far apart vertices stand on the walls (m): they must be able to bend. */
const WALL_STEP = 4;
/** The grid the prints hang on (m): columns, rows, the height of the first row; how many rows. */
const PITCH_U = 0.9;
const PITCH_V = 1.4;
const FIRST_ROW = 1.72;
const ROWS = 26;
/** A print on the wall (m), its lamp above its middle (m); the wood below (m). */
const PRINT_W = 0.5;
const PRINT_H = 0.6;
const LAMP_UP = 0.4;
const DADO = 1.05;
/** Slender piers along the way in: how far off the line (m), where each pair stands (z, m). */
const PIER_X = 3.85;
const PIER_Z = [-5, -11, -17, -23];
/** Pictures in the atlas: its side (px) and how many fit on a side. */
const ATLAS_SIZE = 2048;
const ATLAS_CELLS = 6;
/** The little map of how each lamp burns and how late it dies (cells). */
const LAMP_MAP_W = 256;
const LAMP_MAP_H = 64;
/** Share of the lamps that are already dead. */
const DEAD_LAMPS = 0.16;
/** A lamp's glint (px at 1 m, clamped) and brightness; the pool on the paper behind it (HDR). */
const GLINT_SIZE = 90;
const GLINT_GAIN = 2;
const POOL_GAIN = 2.6;
const PRINT_GAIN = 0.72;

/** The table (m): where it stands, its size against the file. */
const TABLE_Z = -30;
const TABLE_SCALE = 0.9;
const TABLE_HALF_L = 1.015;
const CHAIR_SCALE = 0.95;
/** Your eye walking and seated (m). */
const EYE_Y = 1.6;
const SEAT_EYE_Y = 1.22;
const SEAT_EYE_Z = TABLE_Z + TABLE_HALF_L + 0.26;
/** The empty chair, and how far it comes out by itself (m). */
const SEAT_Z = TABLE_Z + TABLE_HALF_L + 0.25;
const CHAIR_PULL = 0.16;
/** Where they sit (m), and how high their hips are. */
const SIDE_X = 0.84;
const SIDE_Z = TABLE_Z - 0.45;
const PLATE_X = 0.33;
const CHILD_Z = TABLE_Z - TABLE_HALF_L - 0.2;
const HIPS_Y = 0.57;
/** Time in the sitting clip that is the pose they keep (s). */
const SIT_POSE = 4.2;
/** How far the heads hang from level (rad), shared by the bones below. */
const BOW = 1.05;
const BENDS = [
  { bone: 'Bip01_Spine1', bow: 0.1, turn: 0.1 },
  { bone: 'Bip01_Spine2', bow: 0.14, turn: 0.18 },
  { bone: 'Bip01_Neck', bow: 0.32, turn: 0.3 },
  { bone: 'Bip01_Head', bow: 0.44, turn: 0.42 },
] as const;
/** Eating (m, s): a fork's length, how far the tip is from the wrist, chewing rate (Hz). */
const FORK_LENGTH = 0.185;
const GRIP = 0.2;
const CHEW_HZ = 1.7;
/** They chew, but nothing reaches a mouth: how far of the way the fork ever comes up, and how far it scrapes the plate (m). */
const FORK_LIFT = 0.1;
const FORK_SCRAPE = 0.026;
/** Forks in hands, a little larger than life so they read at this distance. */
const FORK_SIZE = 1.3;
/** The head's bone is at the top of the neck: the mouth is this far from it (m). */
const MOUTH_FORWARD = 0.115;
const MOUTH_UP = 0.015;

/** The lamp over the table (m, cd, deg). */
const LAMP_Y = 2.3;
const LAMP_I = 6.5;
const LAMP_CONE = 50;
const BOUNCE_I = 0.7;
/** How far the lamp swings after the bell (m). */
const SWING = REDUCED_MOTION ? 0.012 : 0.05;
/** The dim light that keeps the floor around you readable while you walk (cd). */
const NEAR_I = 10;
/** The one who follows lights himself this much (cd) from where you could see him. */
const FOLLOW_I = 16;

/** The clock: its scale against a wall clock of 32 cm, its middle (m), how much it glows. */
const CLOCK_SCALE = 28;
const CLOCK_R = 4.48;
const CLOCK_Y = 4.5;
const CLOCK_GLOW = 0.17;
/** The camera on its tripod (m). */
const CAMERA_X = 2.4;
const CAMERA_Z = -58;
const CAMERA_SCALE = 1.9;
/** The flash: how long before the shutter it starts to rise (s, so the picture has it), how fast it dies (1/s). */
const FLASH_LEAD = 0.05;
const FLASH_FALL = 1.15;
const FLASH_STAR = 8;

/** The river (m): where it ends under your chair; strands, segments of each. */
const RIVER_END = SEAT_Z + 0.2;
const RIVER_STRANDS = 3200;
const RIVER_SEGMENTS = 12;
/** Hair of each of them. */
const HEAD_STRANDS = 300;
const HEAD_SEGMENTS = 16;
/** The scraped-off face on its sphere (m, at a man's skull): how wide, from where to where, how finely laid, how bright beside lit skin. */
const FACE_PATCH = { width: 0.118, low: -0.1, high: 0.072, steps: 16, tone: 0.62 };
/** Those who stand in the dark: how many, how far off the table, before and after they have come nearer (m). */
const RING_MEN = 16;
const RING_FAR = 7;
const RING_NEAR = 3.4;
/** How far behind the chair the one who followed you ends up (m). */
const BEHIND_CHAIR = 0.86;
const BEHIND_I = 3;
/** Prints fallen on the river. */
const FALLEN_PRINTS = 12;
/** Air. */
const FOG_COLOR = 0x05090a;
const FOG_DENSITY = 0.0105;

const WALKING: RoomControl = { look: true, scroll: true, hurry: 1.8 };
const HELD: RoomControl = { look: true, scroll: false };

const riverTaper = (z: number): number => smootherstep(range(TABLE_Z + 2, TABLE_Z + 7, z)) * smootherstep(range(BACK_Z + 1, BACK_Z - 5, z));
/** Where the river runs (x at z). */
const riverX = (z: number): number => (0.34 * Math.sin(z * 0.19 + 0.6) + 0.16 * Math.sin(z * 0.47 + 2.1)) * riverTaper(z);
/** How wide it is (half, m). */
const riverHalf = (z: number): number => {
  const u = range(DOOR_Z, RIVER_END, z);
  return lerp(lerp(0.55, 1.45, Math.min(1, u * 1.7)), 0.8, smootherstep(range(0.68, 1, u)));
};

const walk = (seconds: number, z: number, yaw: number, pitch: number, fov: number): RoomKey => ({ t: seconds / ROOM_SECONDS, at: [riverX(z) * 0.7, EYE_Y, z], yaw, pitch, fov });
const sat = (seconds: number, yaw: number, pitch: number, fov: number): RoomKey => ({ t: seconds / ROOM_SECONDS, at: [0, SEAT_EYE_Y, SEAT_EYE_Z], yaw, pitch, fov });

const KEYS: readonly RoomKey[] = [
  walk(0, 1.9, 0, 0.5, 58),
  walk(2, 1.7, 0, 0.8, 58),
  walk(6, -2.1, 0.5, 1.5, 56),
  walk(12, -8, -1, 1, 54),
  walk(16.5, -12.6, 0.8, -6, 54),
  walk(18.6, -14.8, 2, -30, 55),
  walk(21.5, -17.9, 3, -56, 58),
  walk(24.3, -21.1, -2, -20, 50),
  walk(27.5, -25.1, 0, -8, 46),
  walk(29.55, -27.9, 0, -22, 50),
  sat(30.15, 0, -20, 50),
  sat(31.6, 0, -20, 50),
  sat(33.4, 26, -7, 42),
  sat(35.2, -26, -7, 42),
  sat(36.8, -8, -38, 38),
  sat(38.6, 0, 4.5, 32),
  sat(40, 0, 5, 31),
  sat(42.5, 0, 2, 36),
  sat(44, 0, -4, 52),
  sat(50, 0, -4, 50),
  sat(53.5, 24, -4, 32),
  sat(57.5, -24, -4, 30),
  sat(60, -24, -3, 28),
  sat(62, -24, -3, 28),
  sat(63.7, 0, -1, 52),
  sat(70, 0, -1, 53),
];

const track = (keys: readonly (readonly [number, number])[]): GlideTrack =>
  new GlideTrack(
    keys.map((k) => k[0]),
    keys.map((k) => k[1]),
  );

/** All GLSL that decides whether a lamp on the walls is still burning (see `backFront`, `farFront`). */
const LAMP_GLSL = /* glsl */ `
uniform float uBack;
uniform float uFar;
uniform float uTime;
float lampAlive(float z, float delay) {
  float behind = 1.0 - smoothstep(uBack + delay * 6.0, uBack + delay * 6.0 + 1.0, z);
  float ahead = smoothstep(uFar - delay * 10.0 - 1.0, uFar - delay * 10.0, z);
  return behind * ahead;
}
float lampBreath(float delay) {
  return 1.0 + 0.1 * sin(uTime * (0.5 + delay) + delay * 40.0);
}
float lampRise(float y) {
  float r = clamp(1.0 - y / ${HIGH.toFixed(1)}, 0.0, 1.0);
  return r * r;
}
`;

const FOG_GLSL = /* glsl */ `
uniform vec3 uFog;
uniform float uFogDensity;
vec3 fogged(vec3 color, float depth) {
  float amount = 1.0 - exp(-uFogDensity * uFogDensity * depth * depth);
  return mix(color, uFog, amount);
}
`;

const WALL_VERT = /* glsl */ `
${WARP_GLSL}
varying vec2 vWall;
varying vec3 vRoom;
varying float vDepth;
void main() {
  vWall = uv;
  vRoom = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * dreamWarp(mv);
}
`;

const WALL_FRAG = /* glsl */ `
${LAMP_GLSL}
${FOG_GLSL}
uniform sampler2D uPaper;
uniform sampler2D uLamps;
uniform vec3 uPool;
uniform float uFlash;
uniform float uTile;
varying vec2 vWall;
varying vec3 vRoom;
varying float vDepth;
void main() {
  vec3 paper = texture2D(uPaper, vWall / uTile).rgb;
  float dado = step(vWall.y, ${DADO.toFixed(2)});
  paper = mix(paper, vec3(0.03, 0.02, 0.013), dado);
  vec2 grid = vec2(vWall.x / ${PITCH_U.toFixed(3)}, (vWall.y - ${FIRST_ROW.toFixed(3)}) / ${PITCH_V.toFixed(3)} + 0.5);
  vec2 id = floor(grid);
  vec2 inCell = (grid - id - 0.5) * vec2(${PITCH_U.toFixed(3)}, ${PITCH_V.toFixed(3)});
  vec4 lamp = texture2D(uLamps, (id + 0.5) / vec2(${LAMP_MAP_W.toFixed(1)}, ${LAMP_MAP_H.toFixed(1)}));
  vec2 fromLamp = inCell - vec2(0.0, ${LAMP_UP.toFixed(3)});
  float pool = exp(-dot(fromLamp, fromLamp) * 9.0);
  float keep = (1.0 - smoothstep(${(PITCH_U * 0.36).toFixed(3)}, ${(PITCH_U * 0.5).toFixed(3)}, abs(inCell.x)))
    * (1.0 - smoothstep(${(PITCH_V * 0.4).toFixed(3)}, ${(PITCH_V * 0.5).toFixed(3)}, abs(inCell.y)));
  float lit = id.y >= 0.0 && id.y < ${ROWS.toFixed(1)} ? lamp.r : 0.0;
  float burning = lit * lampAlive(vRoom.z, lamp.g) * lampRise(abs(vRoom.y)) * lampBreath(lamp.g);
  vec3 color = paper * uPool * pool * keep * burning;
  color += paper * uFlash * 0.9;
  gl_FragColor = vec4(fogged(color, vDepth), 1.0);
}
`;

const PRINT_VERT = /* glsl */ `
${WARP_GLSL}
${LAMP_GLSL}
attribute vec4 aPrint;
varying vec2 vUv;
varying vec2 vCell;
varying float vBurning;
varying float vDepth;
void main() {
  vUv = uv;
  vCell = aPrint.xy;
  vBurning = aPrint.z * lampAlive(instanceMatrix[3][2], aPrint.w) * lampRise(abs(instanceMatrix[3][1])) * lampBreath(aPrint.w);
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * dreamWarp(mv);
}
`;

const PRINT_FRAG = /* glsl */ `
${FOG_GLSL}
uniform sampler2D uAtlas;
uniform float uFlash;
uniform vec3 uLight;
varying vec2 vUv;
varying vec2 vCell;
varying float vBurning;
varying float vDepth;
void main() {
  vec2 p = (vUv - vec2(0.06, 0.2167)) / vec2(0.88, 0.7333);
  float inside = step(0.0, p.x) * step(p.x, 1.0) * step(0.0, p.y) * step(p.y, 1.0);
  vec3 picture = texture2D(uAtlas, (vCell + clamp(p, 0.012, 0.988)) / ${ATLAS_CELLS.toFixed(1)}).rgb;
  vec3 sheet = mix(vec3(0.62, 0.59, 0.52), picture, inside);
  float fall = 0.32 + 0.68 * pow(vUv.y, 1.6);
  float near = 1.0 - smoothstep(4.0, 20.0, vDepth);
  vec3 color = sheet * uLight * fall * vBurning * mix(0.3, 1.0, near) * exp(-vDepth * vDepth * 0.0006);
  color += sheet * uFlash * 1.5;
  gl_FragColor = vec4(fogged(color, vDepth), 1.0);
}
`;

const GLINT_VERT = /* glsl */ `
${WARP_GLSL}
${LAMP_GLSL}
uniform float uSize;
uniform float uFogDensity;
attribute vec2 aLamp;
varying float vShine;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float depth = -mv.z;
  float fog = exp(-uFogDensity * uFogDensity * depth * depth);
  vShine = aLamp.x * lampAlive(position.z, aLamp.y) * lampRise(abs(position.y)) * lampBreath(aLamp.y) * fog;
  gl_Position = projectionMatrix * dreamWarp(mv);
  gl_PointSize = clamp(uSize / max(0.5, depth), 1.5, 9.0);
}
`;

const GLINT_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vShine;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.0) * vShine;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

const LAMP_LIGHT_GLSL = /* glsl */ `
uniform vec3 uLamp;
uniform float uLampPower;
float lampLight(vec3 p) {
  vec3 d = p - uLamp;
  float d2 = dot(d, d);
  float cone = smoothstep(0.25, 0.7, -d.y / sqrt(d2 + 0.0001));
  return cone * uLampPower / (0.7 + d2);
}
`;

const HEAD_HAIR_VERT = /* glsl */ `
${WARP_GLSL}
${LAMP_LIGHT_GLSL}
uniform mat4 uHead;
uniform vec2 uFlow;
uniform float uTime;
uniform float uSkull;
attribute vec4 aOut;
attribute vec4 aStrand;
attribute float aClump;
varying float vShade;
varying float vDepth;
vec3 lay(vec3 root, vec3 away, float along) {
  float len = along * aStrand.w;
  float phase = aStrand.z;
  vec3 center = root - away * uSkull;
  float rise = asin(clamp(away.y, -1.0, 1.0));
  vec2 level = normalize(away.xz + vec2(0.0001, 0.0));
  float overSkull = max(0.0, (rise + 0.2) * uSkull);
  float angle = rise - min(len, overSkull) / uSkull;
  vec3 p = center + uSkull * vec3(cos(angle) * level.x, sin(angle), cos(angle) * level.y);
  float below = max(0.0, len - overSkull);
  float clear = 0.03 * smoothstep(0.0, 0.12, below) + 0.05 * smoothstep(0.1, 0.45, below);
  p.xz += level * clear;
  p.y -= below;
  float loose = min(below, 1.3);
  p.x += sin(below * 1.6 + aClump) * 0.05 * loose + sin(below * 6.0 + phase) * 0.012 * loose + sin(uTime * 0.31 + aClump) * 0.014 * loose;
  p.z += cos(below * 1.4 + aClump * 1.7) * 0.05 * loose + cos(below * 5.0 + phase) * 0.012 * loose + cos(uTime * 0.27 + aClump * 1.3) * 0.014 * loose;
  if (p.y < 0.006) {
    float over = 0.006 - p.y;
    p.y = 0.006;
    p.xz += uFlow * over + vec2(-uFlow.y, uFlow.x) * sin(over * 1.7 + phase) * over * 0.16;
  }
  return p;
}
void main() {
  vec3 root = (uHead * vec4(position, 1.0)).xyz;
  vec3 away = normalize(mat3(uHead) * aOut.xyz);
  vec3 here = lay(root, away, aStrand.x);
  vec4 a = modelViewMatrix * vec4(here, 1.0);
  vec4 b = modelViewMatrix * vec4(lay(root, away, aStrand.x + 0.02), 1.0);
  vec2 dir = b.xy / max(0.05, -b.z) - a.xy / max(0.05, -a.z);
  vec2 across = normalize(vec2(-dir.y, dir.x) + vec2(1e-6));
  float wide = max(mix(0.001, 0.0004, aStrand.x), -a.z * 0.0003);
  a.xy += across * wide * aStrand.y;
  vDepth = -a.z;
  vShade = aOut.w * lampLight(here);
  gl_Position = projectionMatrix * dreamWarp(a);
}
`;

const HEAD_HAIR_FRAG = /* glsl */ `
${FOG_GLSL}
uniform vec3 uHair;
uniform float uGlow;
varying float vShade;
varying float vDepth;
void main() {
  gl_FragColor = vec4(fogged(uHair * (uGlow + vShade), vDepth), 1.0);
}
`;

const STRAND_VERT = /* glsl */ `
${WARP_GLSL}
${LAMP_LIGHT_GLSL}
uniform float uTime;
attribute vec3 aStrand;
varying float vBright;
varying float vLit;
varying float vDepth;
void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.33 + position.z * 1.7 + aStrand.y) * 0.016 * sin(aStrand.x * 3.14159);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDepth = -mv.z;
  vBright = aStrand.z;
  vLit = lampLight(p);
  gl_Position = projectionMatrix * dreamWarp(mv);
}
`;

const STRAND_FRAG = /* glsl */ `
${FOG_GLSL}
uniform vec3 uHair;
uniform float uGlow;
uniform float uShow;
varying float vBright;
varying float vLit;
varying float vDepth;
void main() {
  float close = 1.0 - smoothstep(9.0, 22.0, vDepth);
  gl_FragColor = vec4(fogged(uHair * vBright * (uGlow * 2.2 + vLit), vDepth), close * uShow);
}
`;

const PELT_VERT = /* glsl */ `
${WARP_GLSL}
${LAMP_LIGHT_GLSL}
varying vec2 vUv;
varying float vLit;
varying float vDepth;
void main() {
  vUv = uv;
  vLit = lampLight(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * dreamWarp(mv);
}
`;

const PELT_FRAG = /* glsl */ `
${FOG_GLSL}
uniform sampler2D uStreaks;
uniform vec3 uHair;
uniform float uGlow;
varying vec2 vUv;
varying float vLit;
varying float vDepth;
void main() {
  float strands = texture2D(uStreaks, vec2(vUv.x * 1.7, vUv.y / 2.6)).r;
  float wisp = texture2D(uStreaks, vec2(vUv.x * 0.6 + 0.3, vUv.y / 7.0)).r;
  float edge = smoothstep(0.0, 0.14 + wisp * 0.24, vUv.x) * (1.0 - smoothstep(0.86 - wisp * 0.24, 1.0, vUv.x));
  float near = smoothstep(2.0, 14.0, vDepth);
  float body = clamp(strands * mix(0.5, 1.3, near), 0.0, 1.0) * edge * mix(0.4, 1.0, smoothstep(0.1, 0.5, wisp));
  gl_FragColor = vec4(fogged(uHair * (uGlow + vLit * 0.5), vDepth), body * mix(0.45, 0.9, near));
}
`;

const STEAM_VERT = /* glsl */ `
${WARP_GLSL}
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 size = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * dreamWarp(mv);
}
`;

const STEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 p = vec2(vUv.x * 2.4 + sin(vUv.y * 4.2 + uTime * 0.42) * 0.16, vUv.y * 3.1 - uTime * 0.17);
  float wisp = noise(p) * 0.6 + noise(p * 2.3 + 7.1) * 0.3 + noise(p * 5.1 + 3.0) * 0.1;
  float column = (1.0 - smoothstep(0.08, 0.5, abs(vUv.x - 0.5))) * smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.42, 1.0, vUv.y));
  float a = pow(smoothstep(0.36, 0.82, wisp), 1.5) * column;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

/** The dark blotches where the floor is wetter: only read as a mask. */
function paintWet(c: CanvasRenderingContext2D, s: number): void {
  c.fillStyle = '#000';
  c.fillRect(0, 0, s, s);
  const random = randomFrom(913);
  for (let i = 0; i < 90; i++) {
    const x = random() * s;
    const y = random() * s;
    const r = (0.06 + random() * 0.22) * s;
    const g = c.createRadialGradient(x, y, r * 0.5, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.4 + random() * 0.55})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    for (const [dx, dy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) {
      c.setTransform(1, 0, 0, 1, dx, dy);
      c.fillRect(-s, -s, s * 3, s * 3);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
  }
}

/** Long strands drawn down the image: a mask for the mass of hair on the floor (repeats along its length). */
function paintStreaks(c: CanvasRenderingContext2D, s: number): void {
  c.fillStyle = '#000';
  c.fillRect(0, 0, s, s);
  const random = randomFrom(77);
  c.lineCap = 'round';
  for (let i = 0; i < 2200; i++) {
    const x = random() * s;
    const drift = (random() - 0.5) * s * 0.06;
    c.strokeStyle = `rgba(255,255,255,${0.06 + random() * 0.42})`;
    c.lineWidth = 0.6 + random() * 1.6;
    c.beginPath();
    c.moveTo(x, -8);
    c.bezierCurveTo(x + drift, s * 0.33, x - drift, s * 0.66, x, s + 8);
    c.stroke();
  }
}

/** A picture nobody took: for a viewer whose album is empty (the shutter did not reach them). */
function paintNothing(c: CanvasRenderingContext2D, x: number, y: number, s: number, seed: number): void {
  const random = randomFrom(seed + 11);
  const g = c.createRadialGradient(x + s * (0.3 + random() * 0.4), y + s * (0.3 + random() * 0.3), s * 0.05, x + s * 0.5, y + s * 0.5, s * 0.75);
  g.addColorStop(0, ['#7c7355', '#5a6a60', '#6e5a48'][seed % 3]);
  g.addColorStop(1, '#070807');
  c.fillStyle = g;
  c.fillRect(x, y, s, s);
  c.fillStyle = 'rgba(0,0,0,0.75)';
  c.fillRect(x + s * (0.2 + random() * 0.5), y + s * 0.35, s * 0.1, s * 0.65);
}

/** A face scraped off with something sharp, as on the print: paper where it was, ragged at the edge, a few strokes gone down to the blood. */
function scrapedFace(seed: number): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d')!;
  const random = randomFrom(seed);
  const stroke = (x: number, y: number, angle: number, length: number, width: number, color: string) => {
    c.strokeStyle = color;
    c.lineWidth = width * size;
    c.beginPath();
    c.moveTo((x - Math.cos(angle) * length * 0.5) * size, (y - Math.sin(angle) * length * 0.5) * size);
    c.lineTo((x + Math.cos(angle) * length * 0.5) * size, (y + Math.sin(angle) * length * 0.5) * size);
    c.stroke();
  };
  const main = -0.95 + random() * 0.4;
  c.lineCap = 'round';
  for (let i = 0; i < 1100; i++) {
    const r = Math.sqrt(random());
    const t = random() * Math.PI * 2;
    const turn = main + (random() - 0.5) * 0.5 + (random() < 0.18 ? 1.5 : 0);
    const pale = 205 + random() * 50;
    stroke(0.5 + Math.cos(t) * r * 0.34, 0.54 + Math.sin(t) * r * 0.36, turn, (0.1 + random() * 0.28) * (1.1 - r * 0.6), 0.006 + random() * 0.016, `rgba(${pale | 0},${(pale * 0.96) | 0},${(pale * 0.86) | 0},${0.55 + random() * 0.45})`);
  }
  for (let i = 0; i < 150; i++) {
    const r = Math.sqrt(random());
    const t = random() * Math.PI * 2;
    const blood = random() < 0.24;
    stroke(0.5 + Math.cos(t) * r * 0.26, 0.54 + Math.sin(t) * r * 0.3, main + (random() - 0.5) * 0.7, 0.04 + random() * 0.2, 0.003 + random() * 0.009, blood ? `rgba(92,7,9,${0.6 + random() * 0.4})` : `rgba(14,8,6,${0.55 + random() * 0.45})`);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** The instant print of this table, with the four faces scratched out by hand. */
function paintTablePhoto(c: CanvasRenderingContext2D, s: number): void {
  const random = randomFrom(2601);
  const air = c.createRadialGradient(s * 0.5, s * 0.2, s * 0.03, s * 0.5, s * 0.4, s * 0.8);
  air.addColorStop(0, '#d9b47a');
  air.addColorStop(0.2, '#6f5a3a');
  air.addColorStop(0.58, '#232a23');
  air.addColorStop(1, '#070a0a');
  c.fillStyle = air;
  c.fillRect(0, 0, s, s);
  // the lamp on its cord
  c.fillStyle = '#17140f';
  c.fillRect(s * 0.496, 0, s * 0.008, s * 0.09);
  c.beginPath();
  c.moveTo(s * 0.46, s * 0.09);
  c.lineTo(s * 0.54, s * 0.09);
  c.lineTo(s * 0.62, s * 0.2);
  c.lineTo(s * 0.38, s * 0.2);
  c.closePath();
  c.fill();
  const bodies = [0.21, 0.41, 0.59, 0.79];
  for (let i = 0; i < 4; i++) {
    const x = bodies[i] * s;
    const y = (0.47 + (i % 3) * 0.008) * s;
    c.fillStyle = ['#1a1d22', '#3a2a2c', '#2a2d33', '#191a1d'][i];
    c.beginPath();
    c.ellipse(x, y + s * 0.2, s * (i === 2 ? 0.075 : 0.095), s * 0.2, 0, 0, Math.PI * 2);
    c.fill();
    // hair still dark then, and a face
    c.fillStyle = '#0f0d0b';
    c.beginPath();
    c.ellipse(x, y - s * 0.015, s * 0.066, s * 0.08, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#b39878';
    c.beginPath();
    c.ellipse(x, y, s * 0.052, s * 0.066, 0, 0, Math.PI * 2);
    c.fill();
  }
  // the table and its cloth
  c.fillStyle = '#8f8876';
  c.fillRect(s * 0.06, s * 0.65, s * 0.88, s * 0.14);
  c.fillStyle = 'rgba(30,26,20,0.55)';
  for (let i = 0; i < 16; i++) c.fillRect(s * (0.06 + (i * 0.88) / 16), s * 0.65, s * 0.024, s * 0.14);
  c.fillStyle = '#0a0a09';
  c.fillRect(s * 0.1, s * 0.79, s * 0.05, s * 0.21);
  c.fillRect(s * 0.85, s * 0.79, s * 0.05, s * 0.21);
  for (let i = 0; i < 4; i++) {
    c.fillStyle = '#d6cfbe';
    c.beginPath();
    c.ellipse(bodies[i] * s, s * 0.678, s * 0.055, s * 0.016, 0, 0, Math.PI * 2);
    c.fill();
  }
  // by hand, with something sharp, over each face
  c.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const x = bodies[i] * s;
    const y = (0.47 + (i % 3) * 0.008) * s;
    for (let n = 0; n < 150; n++) {
      const a = -0.95 + random() * 0.45 + (random() < 0.32 ? 1.5 : 0);
      const len = s * (0.03 + random() * 0.12);
      const fromX = x + (random() - 0.5) * s * 0.11;
      const fromY = y + (random() - 0.5) * s * 0.13;
      c.strokeStyle = random() < 0.82 ? `rgba(242,238,226,${0.35 + random() * 0.6})` : `rgba(10,6,4,${0.3 + random() * 0.5})`;
      c.lineWidth = 0.7 + random() * 2.2;
      c.beginPath();
      c.moveTo(fromX - Math.cos(a) * len * 0.5, fromY - Math.sin(a) * len * 0.5);
      c.lineTo(fromX + Math.cos(a) * len * 0.5, fromY + Math.sin(a) * len * 0.5);
      c.stroke();
    }
  }
  // what the years did to the film
  c.fillStyle = 'rgba(214,190,140,0.08)';
  c.fillRect(0, 0, s, s);
}

interface Face {
  /** Where along it u = 0 stands, the way u runs, the way it faces (all on the floor plane). */
  x: number;
  z: number;
  dx: number;
  dz: number;
  nx: number;
  nz: number;
  length: number;
  /** Offset of its cells (m), a whole number of columns, so that no two faces burn alike. */
  shift: number;
  /** Which of the near faces this is (0.. nearest first), for what the viewer can read. */
  front?: number;
}

interface PrintSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  roll: number;
  cell: number;
  lit: number;
  delay: number;
  stir: number;
  lampX: number;
  lampY: number;
  lampZ: number;
}

interface Diner {
  hero: HeroFigure;
  /** Spine1, Spine2, Neck, Head, jaw, then the fork arm and the other arm (upper, lower, hand each). */
  bones: Bone[];
  rest: Quaternion[];
  /** The way it faces, the axis a bow turns about (world), how far the head turns to you (rad). */
  forward: Vector3;
  axis: Vector3;
  turn: number;
  /** Toward your eyes along the floor. */
  toEye: Vector3;
  /** Fork tip over the plate and the way the fork leans there; other hand; where elbows go. */
  plateAt: Vector3;
  downFork: Vector3;
  otherAt: Vector3;
  pole: Vector3;
  otherPole: Vector3;
  fork: number;
  cycle: number;
  phase: number;
  stop: number;
  head: Matrix4;
  /** The head's own axes as the clip left it (world), and how far it is bowed already (rad). */
  up: Vector3;
  face: Vector3;
  side: Vector3;
  restBow: number;
  /** How each arm's axis runs (see alongAxis). */
  axes: readonly [number, number];
}

const UP = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);
const ONE = new Vector3(1, 1, 1);
const qParent = new Quaternion();
const qLocal = new Quaternion();
const qA = new Quaternion();
const qB = new Quaternion();
const qC = new Quaternion();
const qHand = new Quaternion();
const vS = new Vector3();
const vE = new Vector3();
const vW = new Vector3();
const vD = new Vector3();
const vN = new Vector3();
const v1 = new Vector3();
const v2 = new Vector3();
const vMouth = new Vector3();
const vTip = new Vector3();
const vDir = new Vector3();
const vAim = new Vector3();
const vWrist = new Vector3();
const vAxis = new Vector3();
const vAt = new Vector3();
const vScale = new Vector3();
const mWork = new Matrix4();

/** Turn a bone by a rotation given in the world, whatever its own axes are. */
function turnBone(bone: Bone, delta: Quaternion): void {
  bone.parent!.getWorldQuaternion(qParent);
  qLocal.copy(qParent).invert().multiply(delta).multiply(qParent);
  bone.quaternion.premultiply(qLocal);
}

/** Bring a hand to a point of the world by turning shoulder and elbow; the elbow goes the way of `pole`. */
function reach(upper: Bone, lower: Bone, hand: Bone, target: Vector3, pole: Vector3): void {
  upper.getWorldPosition(vS);
  lower.getWorldPosition(vE);
  hand.getWorldPosition(vW);
  const a = vS.distanceTo(vE);
  const b = vE.distanceTo(vW);
  vD.subVectors(target, vS);
  const d = clamp(vD.length(), Math.abs(a - b) + 0.01, a + b - 0.005);
  vD.normalize();
  const along = (a * a - b * b + d * d) / (2 * d);
  const out = Math.sqrt(Math.max(0, a * a - along * along));
  vN.copy(pole).addScaledVector(vD, -pole.dot(vD)).normalize();
  v2.copy(vS).addScaledVector(vD, along).addScaledVector(vN, out).sub(vS).normalize();
  v1.subVectors(vE, vS).normalize();
  qA.setFromUnitVectors(v1, v2);
  turnBone(upper, qA);
  lower.getWorldPosition(vE);
  hand.getWorldPosition(vW);
  v1.subVectors(vW, vE).normalize();
  v2.subVectors(target, vE).normalize();
  qA.setFromUnitVectors(v1, v2);
  turnBone(lower, qA);
}

/** Which way a limb's own X axis runs along it, in this skeleton. */
function alongAxis(lower: Bone, hand: Bone): number {
  const from = lower.getWorldPosition(new Vector3());
  const to = hand.getWorldPosition(new Vector3());
  const x = new Vector3(1, 0, 0).applyQuaternion(lower.getWorldQuaternion(new Quaternion()));
  return to.sub(from).dot(x) >= 0 ? 1 : -1;
}

/** Bring a hand in line with its forearm, leaning a little toward `lean`. */
function levelHand(lower: Bone, hand: Bone, axis: number, lean: Vector3): void {
  lower.getWorldPosition(vE);
  hand.getWorldPosition(vW);
  v2.subVectors(vW, vE).normalize().multiplyScalar(0.7).addScaledVector(lean, 0.3).normalize();
  hand.getWorldQuaternion(qHand);
  v1.set(axis, 0, 0).applyQuaternion(qHand);
  qA.setFromUnitVectors(v1, v2);
  turnBone(hand, qA);
}

function setHand(hand: ClockHand | undefined, turns: number): void {
  if (hand) hand.pivot.rotation.z = Math.PI / 2 - (turns - Math.floor(turns)) * Math.PI * 2 - hand.base;
}

/**
 * The end of the dream. Every picture the shutter took of you hangs here, each under its own small lamp, up the
 * walls of a hall that has no top, and in a floor so wet the walls go down as far as they go up. A long way away a
 * lamp hangs over a table. The pale line you take for its reflection is their hair. The lamps go out behind you,
 * then in front of you. You sit down. It is half past six and the clock, which has never moved, moves.
 */
export default class TheAlbum extends Room {
  readonly keys = KEYS;
  readonly air: RoomAir = {
    fog: { color: FOG_COLOR, density: FOG_DENSITY },
    env: 'evening',
    envIntensity: 0.05,
    sky: 0,
    grade: { exposure: 1.32, saturation: 0.82, warmth: 0.015, tint: -0.015, flare: 0.002 },
  };
  control: RoomControl = WALKING;
  film = { bloom: 0.6, bloomFrom: 0.85, grain: 0.42, scratches: 0.1, flicker: 0.02, weave: 0.0004 };
  fear = 0.3;
  focus = 30;
  aperture = 0;

  private readonly shared = { uTime: { value: 0 }, uBack: { value: 20 }, uFar: { value: -200 }, uFlash: { value: 0 } };
  private readonly lampAt = { value: new Vector3() };
  private readonly lampPower = { value: LAMP_I };
  private readonly glow = { value: 0.03 };
  private readonly strandsShow = { value: 0 };
  private readonly atlas;
  private readonly lampMap;
  private readonly streaks;
  private readonly wetMap;
  private readonly faceMaps: CanvasTexture[] = [];
  private readonly prints: InstancedMesh;
  private readonly stirrers: PrintSpot[] = [];
  private stirred = false;
  private readonly clockHands: ClockHand[][] = [];
  private readonly dials: MeshStandardMaterial[] = [];
  private readonly lampRig = new Group();
  private readonly lampGlow: Mesh;
  private readonly lampBeam: Mesh;
  private readonly key: SpotSpec;
  private readonly bounce: DreamLight;
  private readonly nearLight: DreamLight;
  private readonly followLight: DreamLight;
  private readonly myChair: Object3D;
  private readonly forks;
  private readonly diners: Diner[] = [];
  private posed = false;
  private readonly men: Crowd;
  private ringNow = 0;
  private manX = 0;
  private manZ = 100;
  private manArrived = false;
  private readonly ticking: { value: number }[] = [];
  private readonly lensHair = new Group();
  private readonly steamTime = { value: 0 };
  private readonly star: Mesh;
  private eyeToLamp = 30;
  private readonly eye: RoomPose = { position: new Vector3(), yaw: 0, pitch: 0, roll: 0, fov: 50 };

  private readonly backFront = track([[0, 40], [8, BACK_Z + 2], [20, -5], [SIT_AT, TABLE_Z + 2.6]]);
  private readonly farFront = track([[0, FAR_Z - 12], [SIT_AT, FAR_Z - 12], [TICK_AT - 0.1, -52], [TICK_AT + 0.4, -40], [47, -8]]);
  private readonly focusTrack = track([[0, 40], [16, 30], [19, 2.2], [21.5, 1.8], [24.3, 8], [27.5, 4], [29.5, 2.4], [30.2, 2.6], [31.6, 2.6], [33.4, 2.1], [35.2, 2.1], [36.8, 0.56], [38.6, 40], [42.5, 40], [44, 2.2], [50, 2.1], [53.5, 2], [57.5, 2], [62, 2], [63.7, 2.5], [70, 2.5]]);
  private readonly apertureTrack = track([[0, 0], [21.5, 2], [24.3, 0], [29.5, 2], [30.2, 3.5], [38.6, 2.5], [42.5, 2.5], [44, 4], [63.7, 4], [70, 4]]);
  private readonly powerTrack = track([[0, 1], [59.9, 1], [60.4, 0.62], [64, 0.62], [70, 0.62]]);
  private readonly fearTrack = track([[0, 0.3], [20, 0.5], [30, 0.55], [TICK_AT, 0.75], [RAISED_AT, 0.85], [STOP_AT, 0.95], [SHUTTER_AT, 1], [CUT_AT, 0.4]]);

  private hall: RoomVoice | null = null;
  private tick: RoomVoice | null = null;
  private drone: RoomVoice | null = null;
  private readonly meal: RoomVoice[] = [];

  constructor(ctx: RoomContext) {
    super(ctx);
    this.atlas = this.paintAtlas();
    const lamps = this.makeLamps();
    this.lampMap = lamps.texture;
    this.streaks = this.maskFrom(512, paintStreaks, RepeatWrapping, 8);
    this.wetMap = this.maskFrom(512, paintWet, RepeatWrapping, 1);

    const faces = this.layFaces();
    this.buildWalls(faces);
    this.prints = this.hangPrints(faces, lamps.data);
    this.buildFloor();
    this.buildDoorway();
    this.buildClock();
    const top = this.buildTable();
    this.forks = top.forks;
    this.myChair = top.mine;

    // the lamp: one cord up into the dark, and everything hangs from it
    const b = this.build;
    this.root.add(this.lampRig);
    this.lampRig.position.set(0, 0, TABLE_Z);
    const shade = this.kit.prop('hanging_lamp', [0, LAMP_Y, 0], { scale: 0.9 }, this.lampRig);
    shade.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      if (/glass/.test((mesh.material as Material).name)) mesh.visible = false;
    });
    const bulb = new Mesh(new SphereGeometry(0.06, 12, 8), new MeshBasicMaterial({ color: new Color(PALETTE.warm).multiplyScalar(12) }));
    bulb.position.set(0, LAMP_Y + 0.13, 0);
    bulb.frustumCulled = false;
    this.lampRig.add(bulb);
    const cord = new Mesh(new CylinderGeometry(0.006, 0.006, HIGH, 6), new MeshBasicMaterial({ color: 0x050505 }));
    cord.position.set(0, HIGH / 2 + LAMP_Y + 1, 0);
    cord.frustumCulled = false;
    this.lampRig.add(cord);
    this.lampGlow = b.glow(0, LAMP_Y + 0.02, 0, 3.6, PALETTE.warm, 1, this.lampRig);
    this.lampBeam = b.beam(0, LAMP_Y + 0.02, 0, 0.24, 1.9, LAMP_Y, PALETTE.warm, 0.12, this.lampRig);
    // what the floor shows of it
    b.glow(0, -LAMP_Y, TABLE_Z, 3.2, PALETTE.warm, 0.7, this.root).renderOrder = -2;

    this.key = this.spot([0, LAMP_Y + 0.1, TABLE_Z], [0, 0, TABLE_Z], 0xffdcae, LAMP_I, LAMP_CONE, 0.55);
    this.spots = [this.key, null, null];
    this.bounce = this.light([0, top.y + 0.55, TABLE_Z], PALETTE.warm, BOUNCE_I, 4.5);
    this.nearLight = this.light([0, 3, 1], 0xa9c7c0, NEAR_I, 8);
    this.followLight = this.light([0, 1.3, 0], 0xbfd8d6, 0, 4);
    this.lampAt.value.set(0, LAMP_Y + 0.1, TABLE_Z);

    this.seatFamily(top.y);
    this.layRiver();
    this.men = b.headless(1 + RING_MEN, { tint: 0x474d55 });
    this.root.add(this.men.root);
    this.men.set(0, 0, -50, 0, Math.PI);
    this.placeRing(RING_FAR);

    // dust where the light is, and a little of it along the way
    this.ticking.push(b.motes(240, { x: [-5, 5], y: [0.2, 4.6], z: [TABLE_Z - 6, TABLE_Z + 6] }, this.root, { strength: 0.6, size: 0.008 }).time);
    this.ticking.push(b.motes(220, { x: [-6, 6], y: [0.2, 5], z: [-26, 1] }, this.root, { strength: 0.3, size: 0.007, seed: 51 }).time);

    // your own hair: it comes down over the picture as you sit there
    this.lensHair.position.y = 0.09;
    this.lens.add(this.lensHair);
    const myHair = b.hair(20, { x: [-0.16, 0.16], y: 0, z: [-0.19, -0.12] }, [0.02, 0.1], this.lensHair, { width: 0.00009, sway: 0.006, seed: 19, color: 0x8f8c82 });
    this.ticking.push(myHair.time);
    this.lensHair.visible = false;

    this.kit.prop('antique_camera', [CAMERA_X, 0, CAMERA_Z], { scale: CAMERA_SCALE }, this.root);
    this.star = b.glow(CAMERA_X, CAMERA_SCALE * 0.78, CAMERA_Z + 0.5, FLASH_STAR, 0xffffff, 1, this.root, 2.6);
    this.star.visible = false;

    this.placeBeats();
  }

  /** Every picture the shutter kept, in one texture; the rest of it shuffled copies. */
  private paintAtlas(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = ATLAS_SIZE;
    const c = canvas.getContext('2d')!;
    const cell = ATLAS_SIZE / ATLAS_CELLS;
    const pictures = this.album.pictures;
    const random = randomFrom(71);
    for (let i = 0; i < ATLAS_CELLS * ATLAS_CELLS; i++) {
      const x = (i % ATLAS_CELLS) * cell;
      const y = Math.floor(i / ATLAS_CELLS) * cell;
      if (pictures.length === 0) paintNothing(c, x, y, cell, i);
      else c.drawImage(pictures[i < pictures.length ? i : Math.floor(random() * pictures.length)].canvas, x, y, cell, cell);
    }
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = 4;
    return t;
  }

  private maskFrom(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void, wrap: typeof RepeatWrapping, anisotropy: number): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    draw(canvas.getContext('2d')!, size);
    const t = new CanvasTexture(canvas);
    t.wrapS = t.wrapT = wrap;
    t.anisotropy = anisotropy;
    return t;
  }

  /** How strongly each lamp burns and how late it goes out: the walls and the prints read the same numbers. */
  private makeLamps(): { texture: DataTexture; data: Uint8Array } {
    const data = new Uint8Array(LAMP_MAP_W * LAMP_MAP_H * 4);
    const random = randomFrom(4011);
    for (let y = 0; y < LAMP_MAP_H; y++) {
      for (let x = 0; x < LAMP_MAP_W; x++) {
        const wide = Math.sin(x * 0.041 + 1.3) * Math.sin(y * 0.19 + 0.4) * 0.5 + Math.sin(x * 0.093 - y * 0.067) * 0.5;
        const patch = 0.1 + 0.9 * smootherstep(range(-0.55, 0.45, wide));
        const lit = random() < DEAD_LAMPS ? 0 : (0.2 + 0.8 * random()) * patch;
        const k = (y * LAMP_MAP_W + x) * 4;
        data[k] = Math.round(lit * 255);
        data[k + 1] = Math.round(random() * 255);
        data[k + 3] = 255;
      }
    }
    const texture = new DataTexture(data, LAMP_MAP_W, LAMP_MAP_H);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.minFilter = texture.magFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return { texture, data };
  }

  /** Every flat surface that carries prints. */
  private layFaces(): Face[] {
    const length = BACK_Z - FAR_Z;
    const across = 2 * HALF_W;
    const faces: Face[] = [
      { x: -HALF_W, z: BACK_Z, dx: 0, dz: -1, nx: 1, nz: 0, length, shift: 0 },
      { x: HALF_W, z: FAR_Z, dx: 0, dz: 1, nx: -1, nz: 0, length, shift: 80 * PITCH_U },
      { x: -HALF_W, z: FAR_Z, dx: 1, dz: 0, nx: 0, nz: 1, length: across, shift: 160 * PITCH_U },
      { x: HALF_W, z: BACK_Z, dx: -1, dz: 0, nx: 0, nz: -1, length: across, shift: 200 * PITCH_U },
    ];
    const half = PITCH_U / 2;
    let shift = 0;
    PIER_Z.forEach((z, pair) => {
      for (const side of [-1, 1]) {
        const cx = side * PIER_X;
        const near = pair * 2 + (side < 0 ? 0 : 1);
        faces.push({ x: cx - half, z: z + half, dx: 1, dz: 0, nx: 0, nz: 1, length: PITCH_U, shift: (20 + shift++) * PITCH_U, front: near });
        faces.push({ x: cx + half, z: z - half, dx: -1, dz: 0, nx: 0, nz: -1, length: PITCH_U, shift: (20 + shift++) * PITCH_U });
        faces.push({ x: cx + half, z: z + half, dx: 0, dz: -1, nx: 1, nz: 0, length: PITCH_U, shift: (20 + shift++) * PITCH_U });
        faces.push({ x: cx - half, z: z - half, dx: 0, dz: 1, nx: -1, nz: 0, length: PITCH_U, shift: (20 + shift++) * PITCH_U });
      }
    });
    return faces;
  }

  /** All the walls and their reflection under the floor, as one mesh. */
  private buildWalls(faces: readonly Face[]): void {
    const positions: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    const quad = (f: Face, u0: number, u1: number, v0: number, v1: number) => {
      const nu = Math.max(1, Math.ceil((u1 - u0) / WALL_STEP));
      const nv = Math.max(1, Math.ceil((v1 - v0) / WALL_STEP));
      for (const sign of [1, -1]) {
        const base = positions.length / 3;
        for (let j = 0; j <= nv; j++) {
          const v = v0 + ((v1 - v0) * j) / nv;
          for (let i = 0; i <= nu; i++) {
            const u = u0 + ((u1 - u0) * i) / nu;
            positions.push(f.x + f.dx * u, sign * v, f.z + f.dz * u);
            uvs.push(f.shift + u, v);
          }
        }
        for (let j = 0; j < nv; j++) {
          for (let i = 0; i < nu; i++) {
            const a = base + j * (nu + 1) + i;
            const b = a + 1;
            const c = a + nu + 1;
            const d = c + 1;
            index.push(a, b, d, a, d, c);
          }
        }
      }
    };
    faces.forEach((f, i) => {
      if (i === 3) {
        // the wall with the door in it
        quad(f, 0, HALF_W - DOOR_HALF, 0, HIGH);
        quad(f, HALF_W + DOOR_HALF, f.length, 0, HIGH);
        quad(f, HALF_W - DOOR_HALF, HALF_W + DOOR_HALF, DOOR_H, HIGH);
      } else quad(f, 0, f.length, 0, HIGH);
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    const paper = (this.build.damask(PALETTE.damaskTeal, 1.1) as MeshStandardMaterial).map!;
    const material = new ShaderMaterial({
      vertexShader: WALL_VERT,
      fragmentShader: WALL_FRAG,
      uniforms: {
        ...warpUniforms,
        ...this.shared,
        uPaper: { value: paper },
        uLamps: { value: this.lampMap },
        uPool: { value: new Color(0xffb46a).multiplyScalar(POOL_GAIN) },
        uTile: { value: 1.1 },
        uFog: { value: new Color(FOG_COLOR) },
        uFogDensity: { value: FOG_DENSITY },
      },
      side: DoubleSide,
    });
    const walls = new Mesh(geometry, material);
    walls.frustumCulled = false;
    this.root.add(walls);
    // the ceiling nobody will ever see close
    const lid = new Mesh(new PlaneGeometry(HALF_W * 2 + 2, BACK_Z - FAR_Z + 2), new MeshBasicMaterial({ color: 0x020303 }));
    lid.rotation.x = Math.PI / 2;
    lid.position.set(0, HIGH, (BACK_Z + FAR_Z) / 2);
    lid.frustumCulled = false;
    this.root.add(lid);
  }

  /** The prints and their lamps: one draw each, reflections included. */
  private hangPrints(faces: readonly Face[], lampData: Uint8Array): InstancedMesh {
    const random = randomFrom(903);
    const spots: PrintSpot[] = [];
    const shown: { spot: PrintSpot; order: number }[] = [];
    for (const face of faces) {
      const cols = Math.round(face.length / PITCH_U);
      const firstCol = Math.round(face.shift / PITCH_U);
      for (let c = 0; c < cols; c++) {
        const u = (c + 0.5) * PITCH_U;
        const x = face.x + face.dx * u;
        const z = face.z + face.dz * u;
        for (let r = 0; r < ROWS; r++) {
          const y = FIRST_ROW + r * PITCH_V;
          if (face.nz < 0 && face.front === undefined && Math.abs(x) < 1.6 && y < 3.6) continue;
          if (face.nz > 0 && z < FAR_Z + 0.5 && Math.hypot(x, y - CLOCK_Y) < CLOCK_R + 0.8) continue;
          const k = ((r % LAMP_MAP_H) * LAMP_MAP_W + (firstCol + c) % LAMP_MAP_W) * 4;
          const spot: PrintSpot = {
            x: x + face.nx * 0.02,
            y: y + PRINT_H / 2,
            z: z + face.nz * 0.02,
            yaw: Math.atan2(face.nx, face.nz),
            roll: (random() - 0.5) * 0.05,
            cell: Math.floor(random() * ATLAS_CELLS * ATLAS_CELLS),
            lit: lampData[k] / 255,
            delay: lampData[k + 1] / 255,
            stir: face.front !== undefined && face.front < 4 && r === 0 ? face.front : -1,
            lampX: x + face.nx * 0.09,
            lampY: y + LAMP_UP,
            lampZ: z + face.nz * 0.09,
          };
          spots.push(spot);
          if (face.front !== undefined && r < 3) shown.push({ spot, order: r * 100 + face.front });
          if (spot.stir >= 0) spot.lit = 1;
        }
      }
    }
    // the nearest ones are every picture there is, in the order they were taken
    shown.sort((a, b) => a.order - b.order);
    const pictures = this.album.pictures.length;
    shown.forEach((s, i) => {
      s.spot.cell = pictures > 0 ? i % Math.min(pictures, ATLAS_CELLS * ATLAS_CELLS) : i;
      s.spot.lit = Math.max(s.spot.lit, 0.75);
    });
    const stirring = spots.filter((s) => s.stir >= 0).sort((a, b) => a.stir - b.stir);
    this.stirrers.push(...stirring);
    const others = spots.filter((s) => s.stir < 0);
    const count = spots.length * 2 + FALLEN_PRINTS;

    const geometry = new PlaneGeometry(1, 1);
    geometry.translate(0, -0.5, 0);
    const material = new ShaderMaterial({
      vertexShader: PRINT_VERT,
      fragmentShader: PRINT_FRAG,
      uniforms: {
        ...warpUniforms,
        ...this.shared,
        uAtlas: { value: this.atlas },
        uLight: { value: new Color(0xffd9a8).multiplyScalar(PRINT_GAIN) },
        uFog: { value: new Color(FOG_COLOR) },
        uFogDensity: { value: FOG_DENSITY },
      },
      side: DoubleSide,
    });
    const prints = new InstancedMesh(geometry, material, count);
    prints.frustumCulled = false;
    const data = new Float32Array(count * 4);
    const glints = new Float32Array(spots.length * 2 * 3);
    const glintData = new Float32Array(spots.length * 2 * 2);
    let n = 0;
    const write = (s: PrintSpot, mirrored: boolean) => {
      this.writePrint(prints, n, s, mirrored, 0);
      data[n * 4] = s.cell % ATLAS_CELLS;
      data[n * 4 + 1] = ATLAS_CELLS - 1 - Math.floor(s.cell / ATLAS_CELLS);
      data[n * 4 + 2] = s.lit;
      data[n * 4 + 3] = s.delay;
      glints[n * 3] = s.lampX;
      glints[n * 3 + 1] = mirrored ? -s.lampY : s.lampY;
      glints[n * 3 + 2] = s.lampZ;
      glintData[n * 2] = s.lit;
      glintData[n * 2 + 1] = s.delay;
      n++;
    };
    for (const s of stirring) write(s, false);
    for (const s of stirring) write(s, true);
    for (const s of others) {
      write(s, false);
      write(s, true);
    }
    // a few have come off the walls and lie on the river
    for (let i = 0; i < FALLEN_PRINTS; i++) {
      const z = lerp(-12, -21, i / (FALLEN_PRINTS - 1)) + (random() - 0.5) * 0.8;
      vAt.set(riverX(z) + (random() - 0.5) * 1.6, 0.012, z);
      qA.setFromAxisAngle(UP, random() * Math.PI * 2);
      qB.setFromAxisAngle(v1.set(1, 0, 0), -Math.PI / 2);
      mWork.compose(vAt, qA.multiply(qB), vScale.set(0.32, 0.38, 1));
      prints.setMatrixAt(n, mWork);
      data[n * 4] = i % ATLAS_CELLS;
      data[n * 4 + 1] = ATLAS_CELLS - 1 - (i % ATLAS_CELLS);
      data[n * 4 + 2] = 0.34;
      data[n * 4 + 3] = random();
      n++;
    }
    geometry.setAttribute('aPrint', new InstancedBufferAttribute(data, 4));
    prints.instanceMatrix.needsUpdate = true;
    this.root.add(prints);

    const glintGeometry = new BufferGeometry();
    glintGeometry.setAttribute('position', new BufferAttribute(glints, 3));
    glintGeometry.setAttribute('aLamp', new BufferAttribute(glintData, 2));
    const points = new Points(
      glintGeometry,
      new ShaderMaterial({
        vertexShader: GLINT_VERT,
        fragmentShader: GLINT_FRAG,
        uniforms: {
          ...warpUniforms,
          ...this.shared,
          uSize: { value: GLINT_SIZE },
          uFogDensity: { value: FOG_DENSITY },
          uColor: { value: new Color(PALETTE.warm).multiplyScalar(GLINT_GAIN) },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    points.frustumCulled = false;
    points.renderOrder = -3;
    this.root.add(points);
    return prints;
  }

  /** One print's matrix: `lift` swings it out from the wall about its top edge (rad). */
  private writePrint(prints: InstancedMesh, i: number, s: PrintSpot, mirrored: boolean, lift: number): void {
    qA.setFromAxisAngle(UP, s.yaw);
    qB.setFromAxisAngle(v1.set(0, 0, 1), s.roll);
    qC.setFromAxisAngle(v2.set(1, 0, 0), -lift);
    qA.multiply(qB).multiply(qC);
    mWork.compose(vAt.set(s.x, s.y, s.z), qA, vScale.set(PRINT_W, PRINT_H, 1));
    if (mirrored) mWork.premultiply(FLIP);
    prints.setMatrixAt(i, mWork);
  }

  /** Wet tile: straight down you see it, far off you see the hall in it. */
  private buildFloor(): void {
    const tile = this.kit.surface('tile_wet', 1.0, { roughness: 0.62, color: new Color(0x8c918f), transparent: true });
    const wet = { value: this.wetMap };
    tile.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uWet = wet;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWetUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWetUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWetUv;\nuniform sampler2D uWet;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float wet = texture2D(uWet, vWetUv / 13.0).r;
          float facing = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
          float mirror = (0.16 + 0.84 * pow(1.0 - facing, 3.1)) * mix(0.42, 1.0, wet);
          diffuseColor.a = 1.0 - clamp(mirror, 0.0, 0.92);`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= mix(1.0, 0.36, wet);');
    };
    tile.customProgramCacheKey = () => 'album-floor';
    const floor = this.kit.floor(-HALF_W, HALF_W, FAR_Z, DOOR_Z, 0, tile);
    floor.renderOrder = -1;
    this.root.add(floor);
  }

  /** The thick wall you come out of, and the door shut behind you. */
  private buildDoorway(): void {
    const b = this.build;
    const paper = b.damask(PALETTE.damaskTeal, 1.1);
    const length = DOOR_Z - BACK_Z;
    const mid = (DOOR_Z + BACK_Z) / 2;
    b.wall(DOOR_HALF, mid, length, DOOR_H, '-x', paper, this.root);
    b.wall(-DOOR_HALF, mid, length, DOOR_H, '+x', paper, this.root);
    b.wainscot(DOOR_HALF, mid, length, '-x', this.root);
    b.wainscot(-DOOR_HALF, mid, length, '+x', this.root);
    b.wall(0, DOOR_Z + 0.002, DOOR_HALF * 2, DOOR_H, '-z', paper, this.root);
    b.door(0, DOOR_Z, '-z', this.root, { color: 0x201812 });
    const lid = this.kit.floor(-DOOR_HALF, DOOR_HALF, BACK_Z, DOOR_Z, DOOR_H, b.ceiling(0.6));
    lid.rotation.x = Math.PI / 2;
    this.root.add(lid);
  }

  /** A kitchen clock the size of a house against the far wall, and its reflection. */
  private buildClock(): void {
    const lit = new Map<Material, MeshStandardMaterial>();
    for (const mirrored of [false, true]) {
      const group = new Group();
      group.position.set(0, mirrored ? -CLOCK_Y : CLOCK_Y, FAR_Z + 0.72);
      if (mirrored) group.scale.y = -1;
      this.root.add(group);
      const clock = this.kit.prop('wall_clock', [0, 0, 0], { scale: CLOCK_SCALE, anchor: 'center' }, group);
      clock.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const source = mesh.material as MeshStandardMaterial;
        if (/glass/.test(source.name)) {
          mesh.visible = false;
          return;
        }
        let own = lit.get(source);
        if (!own) {
          own = source.clone();
          own.emissive.set(0xdfe9e2);
          own.emissiveMap = source.map;
          own.emissiveIntensity = CLOCK_GLOW;
          lit.set(source, own);
          this.dials.push(own);
        }
        mesh.material = own;
      });
      // the rig looks for the dial by its name, which the prop's own pivot also bears
      this.clockHands.push(rigClock(clock.children[0]));
    }
    this.setClock(0);
    const b = this.build;
    b.glow(0, CLOCK_Y, FAR_Z + 1.6, CLOCK_R * 4, PALETTE.cold, 0.08, this.root);
    b.glow(0, -CLOCK_Y, FAR_Z + 1.6, CLOCK_R * 4, PALETTE.cold, 0.06, this.root).renderOrder = -2;
  }

  /** The table as it was left: returns its height, the forks they hold and your chair. */
  private buildTable(): { y: number; forks: ReturnType<RoomContext['kit']['props']>; mine: Object3D } {
    const k = this.kit;
    const b = this.build;
    const table = k.prop('dining_table', [0, 0, TABLE_Z], { scale: TABLE_SCALE, rotation: [0, 90, 0], castShadow: true }, this.root);
    table.updateWorldMatrix(true, true);
    const y = new Box3().setFromObject(table).max.y - this.origin.y;
    const chair = (x: number, z: number, turn: number) => k.prop('dining_chair', [x, 0, z], { scale: CHAIR_SCALE, rotation: [0, turn, 0], castShadow: true }, this.root);
    const mine = chair(0, SEAT_Z, 180);
    const sideChair = SIDE_X - 0.02;
    chair(-sideChair, SIDE_Z, 90);
    chair(sideChair, SIDE_Z, -90);
    chair(0, CHILD_Z - 0.04, 0);
    b.contactShadow(0, TABLE_Z, 2.3, this.root, 0.8);
    b.contactShadow(0, SEAT_Z, 0.5, this.root, 0.7);
    b.contactShadow(-sideChair, SIDE_Z, 0.55, this.root, 0.7);
    b.contactShadow(sideChair, SIDE_Z, 0.55, this.root, 0.7);
    b.contactShadow(0, CHILD_Z, 0.55, this.root, 0.7);

    const top = y + 0.003;
    const myPlateZ = SEAT_Z - 0.5;
    const plates = k.props('plate', 4);
    plates.set(0, -PLATE_X, top, SIDE_Z, 0);
    plates.set(1, PLATE_X, top, SIDE_Z, 0);
    plates.set(2, 0, top, CHILD_Z + 0.36, 0);
    plates.set(3, 0, top, myPlateZ, 0);
    plates.commit();
    this.root.add(plates.root);

    const lying = (crowd: ReturnType<RoomContext['kit']['props']>, i: number, x: number, z: number, dx: number, dz: number, length: number) => {
      v2.set(dx, 0, dz).normalize();
      qA.setFromUnitVectors(UP, v2);
      mWork.compose(vAt.set(x - v2.x * length * 0.5, top + 0.008, z - v2.z * length * 0.5), qA, ONE);
      crowd.setMatrix(i, mWork);
    };
    const forks = k.props('fork', 4);
    lying(forks, 3, -0.17, myPlateZ, 0, -1, FORK_LENGTH);
    forks.commit();
    this.root.add(forks.root);
    const knives = k.props('knife', 4);
    lying(knives, 0, -PLATE_X, SIDE_Z - 0.17, 1, 0, 0.228);
    lying(knives, 1, PLATE_X, SIDE_Z + 0.17, -1, 0, 0.228);
    lying(knives, 2, 0.19, CHILD_Z + 0.36, 0, 1, 0.228);
    lying(knives, 3, 0.17, myPlateZ, 0, -1, 0.228);
    knives.commit();
    this.root.add(knives.root);
    const spoons = k.props('spoon', 2);
    lying(spoons, 0, -0.23, myPlateZ, 0, -1, 0.176);
    lying(spoons, 1, 0.23, CHILD_Z + 0.36, 0, 1, 0.176);
    spoons.commit();
    this.root.add(spoons.root);

    // dinner: nobody could say what, and yours is the only one still hot
    const meat = k.props('roast_lump', 4, { rotation: [90, 0, 0] });
    meat.set(0, -PLATE_X, top + 0.012, SIDE_Z, 1.1, 1.05);
    meat.set(1, PLATE_X, top + 0.012, SIDE_Z, -0.5, 1);
    meat.set(2, 0, top + 0.012, CHILD_Z + 0.36, 2, 0.85);
    meat.set(3, 0, top + 0.012, myPlateZ, 0.3, 1.45);
    meat.commit();
    this.root.add(meat.root);
    const sauceDiscs = [[-PLATE_X, SIDE_Z], [PLATE_X, SIDE_Z], [0, CHILD_Z + 0.36], [0, myPlateZ]].map(([x, z]) => {
      const disc = new CircleGeometry(0.086, 28);
      disc.rotateX(-Math.PI / 2);
      disc.translate(x, top + 0.0105, z);
      return disc;
    });
    const sauce = new Mesh(mergeGeometries(sauceDiscs)!, new MeshStandardMaterial({ color: 0x2c0f07, roughness: 0.22 }));
    sauce.frustumCulled = false;
    sauce.receiveShadow = true;
    this.root.add(sauce);

    k.prop('pot_enamel', [0, top, TABLE_Z + 0.02], { castShadow: true, rotation: [0, 35, 0] }, this.root);
    k.prop('buns', [0.33, top, TABLE_Z + 0.45], { castShadow: true, rotation: [0, 72, 0] }, this.root);
    const bowls = k.props('bowl', 2, { castShadow: true });
    bowls.set(0, -0.28, top, TABLE_Z + 0.42, 0);
    bowls.set(1, 0.22, top, TABLE_Z - 0.32, 0);
    bowls.commit();
    this.root.add(bowls.root);
    const tumblers = k.props('tumbler', 3);
    tumblers.set(0, -0.2, top, SIDE_Z + 0.22, 0);
    tumblers.set(1, 0.2, top, SIDE_Z + 0.22, 0);
    tumblers.set(2, 0.13, top, CHILD_Z + 0.5, 0);
    tumblers.commit();
    this.root.add(tumblers.root);
    k.prop('tea_glass', [0.25, top, myPlateZ - 0.27], {}, this.root);

    // the picture of this table, by your plate
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    paintTablePhoto(canvas.getContext('2d')!, 512);
    const photo = new CanvasTexture(canvas);
    photo.colorSpace = SRGBColorSpace;
    photo.anisotropy = 4;
    const print = b.print(photo, 0.135);
    print.rotation.set(-Math.PI / 2, 0, -0.17);
    print.position.set(0.3, top + 0.004, myPlateZ + 0.05);
    this.root.add(print);

    // steam
    const plane = new PlaneGeometry(1, 1);
    plane.translate(0, 0.5, 0);
    const steam = new Mesh(
      plane,
      new ShaderMaterial({
        vertexShader: STEAM_VERT,
        fragmentShader: STEAM_FRAG,
        uniforms: { ...warpUniforms, uTime: this.steamTime, uColor: { value: new Color(0xffe6c8).multiplyScalar(0.2) } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    steam.position.set(0, top + 0.06, myPlateZ - 0.01);
    steam.scale.set(0.17, 0.4, 1);
    steam.frustumCulled = false;
    steam.renderOrder = 3;
    this.root.add(steam);
    return { y, forks, mine };
  }

  private seatFamily(tableY: number): void {
    const bottom = tableY + 0.04;
    this.seat({ avatar: 'figure_man', face: 'scratched', bleach: 0.5, tint: 0x8b8b90 }, -SIDE_X, SIDE_Z, Math.PI / 2, new Vector3(-PLATE_X, bottom, SIDE_Z), 'R', 0, 4.4, 3.5, STOP_AT + 0.25, [0.375, 0.927], [1.6, 3.2], HEAD_STRANDS, 61, 0.108);
    this.seat({ avatar: 'figure_woman', face: 'scratched', bleach: 0.65, tint: 0xa8a098 }, SIDE_X, SIDE_Z, -Math.PI / 2, new Vector3(PLATE_X, bottom, SIDE_Z), 'L', 1, 3.6, 1.99, STOP_AT, [-0.375, 0.927], [1.6, 3.2], HEAD_STRANDS, 67, 0.104);
    this.seat({ avatar: 'figure_child', face: 'scratched', bleach: 0.6 }, 0, CHILD_Z, 0, new Vector3(0, bottom, CHILD_Z + 0.36), 'R', 2, 5.2, 2.81, STOP_AT + 0.5, [0, 1], [2.6, 3.8], Math.round(HEAD_STRANDS * 0.7), 83, 0.092);
  }

  /** One of them, in a chair, with an arm on the table and a fork in it. */
  private seat(look: Omit<FigureSpec, 'clip' | 'time'>, x: number, z: number, heading: number, plate: Vector3, forkSide: 'R' | 'L', fork: number, cycle: number, phase: number, stop: number, flow: readonly [number, number], floorRun: readonly [number, number], strands: number, seed: number, skull: number): void {
    const hero = this.kit.figures.hero({ ...look, clip: 'm_sit_chair_idle_roll_head', time: SIT_POSE });
    hero.update(SIT_POSE);
    hero.root.updateMatrixWorld(true);
    const hips = hero.bone('Bip01')!.getWorldPosition(new Vector3());
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    hero.root.rotation.y = heading;
    hero.root.position.set(x - (hips.x * c + hips.z * s), HIPS_Y - hips.y, z - (-hips.x * s + hips.z * c));
    hero.root.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = true;
    });
    this.root.add(hero.root);
    hero.root.updateWorldMatrix(true, true);

    const otherSide = forkSide === 'R' ? 'L' : 'R';
    const names = [...BENDS.map((b) => b.bone), 'Bip01_MJaw', `Bip01_${forkSide}_UpperArm`, `Bip01_${forkSide}_Forearm`, `Bip01_${forkSide}_Hand`, `Bip01_${otherSide}_UpperArm`, `Bip01_${otherSide}_Forearm`, `Bip01_${otherSide}_Hand`];
    const bones = names.map((name) => hero.bone(name)!);
    const forward = new Vector3(s, 0, c);
    const axis = new Vector3().crossVectors(UP, forward);
    const head = bones[3].getWorldPosition(new Vector3()).sub(this.origin);
    const toEye = new Vector3(-head.x, 0, SEAT_EYE_Z - head.z).normalize();
    const turn = Math.atan2(Math.sin(Math.atan2(toEye.x, toEye.z) - heading), Math.cos(Math.atan2(toEye.x, toEye.z) - heading));
    // in this skeleton X runs up through the skull
    const tilt = bones[3].getWorldQuaternion(new Quaternion());
    const neck = bones[2].getWorldPosition(new Vector3());
    const up = new Vector3(1, 0, 0).applyQuaternion(tilt);
    if (up.dot(bones[3].getWorldPosition(new Vector3()).sub(neck)) < 0) up.negate();
    const one = new Vector3(0, 1, 0).applyQuaternion(tilt);
    const two = new Vector3(0, 0, 1).applyQuaternion(tilt);
    const face = Math.abs(one.dot(axis)) > Math.abs(two.dot(axis)) ? two : one;
    if (face.dot(new Vector3().copy(forward).addScaledVector(UP, -0.3)) < 0) face.negate();
    const side = new Vector3().crossVectors(up, face);
    const restBow = Math.asin(clamp(-face.y, -1, 1));
    // the arms lie on the table from the beginning: they do not have to come up through it
    const right = new Vector3(-c, 0, s);
    const lateral = forkSide === 'R' ? right : right.clone().negate();
    const shoulder = bones[5].getWorldPosition(new Vector3()).sub(this.origin);
    const plateAt = plate.clone().addScaledVector(forward, -0.02);
    const downFork = plateAt.clone().sub(shoulder).normalize();
    const otherAt = plate.clone().addScaledVector(lateral, -0.26).addScaledVector(forward, -0.13);
    otherAt.y = plate.y + 0.02;
    const pole = lateral.clone().multiplyScalar(0.45).addScaledVector(UP, -0.9).addScaledVector(forward, -0.25).normalize();
    const otherPole = lateral.clone().multiplyScalar(-0.45).addScaledVector(UP, -0.9).addScaledVector(forward, -0.25).normalize();
    const diner: Diner = {
      hero,
      bones,
      rest: bones.map((bone) => bone.quaternion.clone()),
      forward,
      axis,
      turn,
      toEye,
      plateAt,
      downFork,
      otherAt,
      pole,
      otherPole,
      fork,
      cycle,
      phase,
      stop,
      head: new Matrix4(),
      up,
      face,
      side,
      restBow,
      axes: [alongAxis(bones[6], bones[7]), alongAxis(bones[9], bones[10])],
    };
    this.diners.push(diner);
    this.growHair(diner, flow, floorRun, strands, seed, skull);
    this.scratchFace(diner, seed + 7, skull);
  }

  /** Hair to the floor and on across it: roots on the head, the rest hangs in the shader, so it falls wherever the head goes. */
  private growHair(d: Diner, flow: readonly [number, number], floorRun: readonly [number, number], strands: number, seed: number, skull: number): void {
    const random = randomFrom(seed);
    const head = d.bones[3];
    head.updateWorldMatrix(true, false);
    const matrix = head.matrixWorld.clone();
    matrix.elements[12] -= this.origin.x;
    matrix.elements[13] -= this.origin.y;
    matrix.elements[14] -= this.origin.z;
    const inverse = matrix.clone().invert();
    const center = new Vector3().setFromMatrixPosition(matrix).addScaledVector(d.up, 0.09).addScaledVector(d.face, 0.02);
    const away = d.side;
    const back = d.face.clone().negate();
    const verts = (HEAD_SEGMENTS + 1) * 2 * strands;
    const roots = new Float32Array(verts * 3);
    const outs = new Float32Array(verts * 4);
    const data = new Float32Array(verts * 4);
    const clumps = new Float32Array(verts);
    const index = new Uint32Array(HEAD_SEGMENTS * 6 * strands);
    let vi = 0;
    let ii = 0;
    const dir = new Vector3();
    const local = new Vector3();
    const reachOut = new Vector3();
    const centerLocal = center.clone().applyMatrix4(inverse);
    for (let i = 0; i < strands; i++) {
      const azimuth = (random() * 2 - 1) * 2.6;
      const elevation = Math.abs(azimuth) > 2.2 ? lerp(0.75, 1.5, random()) : lerp(-0.15, 1.5, Math.pow(random(), 0.6));
      dir.set(0, 0, 0).addScaledVector(back, Math.cos(azimuth) * Math.cos(elevation)).addScaledVector(away, Math.sin(azimuth) * Math.cos(elevation)).addScaledVector(d.up, Math.sin(elevation));
      local.copy(center).add(reachOut.copy(dir).multiplyScalar(skull)).applyMatrix4(inverse);
      reachOut.copy(center).add(dir).applyMatrix4(inverse).sub(centerLocal).normalize();
      const length = center.y + lerp(floorRun[0], floorRun[1], random());
      const phase = random() * 6.283;
      const shade = random();
      const bright = 0.22 + 0.78 * shade * shade;
      const clump = Math.floor(random() * 18) * 0.7;
      for (let s = 0; s <= HEAD_SEGMENTS; s++) {
        for (const side of [-1, 1]) {
          roots[vi * 3] = local.x;
          roots[vi * 3 + 1] = local.y;
          roots[vi * 3 + 2] = local.z;
          outs[vi * 4] = reachOut.x;
          outs[vi * 4 + 1] = reachOut.y;
          outs[vi * 4 + 2] = reachOut.z;
          outs[vi * 4 + 3] = bright;
          data[vi * 4] = Math.pow(s / HEAD_SEGMENTS, 1.8);
          data[vi * 4 + 1] = side;
          data[vi * 4 + 2] = phase;
          data[vi * 4 + 3] = length;
          clumps[vi] = clump;
          vi++;
        }
        if (s < HEAD_SEGMENTS) {
          const a = vi - 2;
          index[ii++] = a;
          index[ii++] = a + 1;
          index[ii++] = a + 2;
          index[ii++] = a + 1;
          index[ii++] = a + 3;
          index[ii++] = a + 2;
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(roots, 3));
    geometry.setAttribute('aOut', new BufferAttribute(outs, 4));
    geometry.setAttribute('aStrand', new BufferAttribute(data, 4));
    geometry.setAttribute('aClump', new BufferAttribute(clumps, 1));
    geometry.setIndex(new BufferAttribute(index, 1));
    const material = new ShaderMaterial({
      vertexShader: HEAD_HAIR_VERT,
      fragmentShader: HEAD_HAIR_FRAG,
      uniforms: {
        ...warpUniforms,
        uHead: { value: d.head },
        uFlow: { value: { x: flow[0], y: flow[1] } },
        uSkull: { value: skull },
        uTime: this.shared.uTime,
        uLamp: this.lampAt,
        uLampPower: this.lampPower,
        uHair: { value: new Color(0xd8d2c0) },
        uGlow: { value: 0.012 },
        uFog: { value: new Color(FOG_COLOR) },
        uFogDensity: { value: FOG_DENSITY },
      },
      side: DoubleSide,
    });
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.root.add(mesh);
  }

  /** The face taken off, as on the print: a ragged patch of paper laid on the front of the skull. */
  private scratchFace(d: Diner, seed: number, skull: number): void {
    const head = d.bones[3];
    head.updateWorldMatrix(true, false);
    const inverse = head.matrixWorld.clone().invert();
    const center = new Vector3().setFromMatrixPosition(head.matrixWorld).addScaledVector(d.up, 0.09).addScaledVector(d.face, 0.02);
    const radius = skull * 0.97;
    const size = skull / 0.108;
    const { width, low, high, steps, tone } = FACE_PATCH;
    const positions: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    const point = new Vector3();
    for (let j = 0; j <= steps; j++) {
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps - 0.5) * width * size;
        const b = lerp(low, high, j / steps) * size;
        const forward = Math.sqrt(Math.max(0.0002, radius * radius - a * a - b * b));
        point.copy(center).addScaledVector(d.side, a).addScaledVector(d.up, b).addScaledVector(d.face, forward).applyMatrix4(inverse);
        positions.push(point.x, point.y, point.z);
        uvs.push(i / steps, j / steps);
        if (i < steps && j < steps) {
          const v = j * (steps + 1) + i;
          index.push(v, v + 1, v + steps + 1, v + 1, v + steps + 2, v + steps + 1);
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    const map = scrapedFace(seed);
    this.faceMaps.push(map);
    const scraped = new Mesh(geometry, new MeshBasicMaterial({ map, alphaTest: 0.3, side: DoubleSide, color: new Color(tone, tone, tone) }));
    scraped.frustumCulled = false;
    head.add(scraped);
  }

  /** The hair on the floor: a soft mass, and over it strands that read as hair when you look down. */
  private layRiver(): void {
    const steps = 96;
    const peltPositions: number[] = [];
    const peltUv: number[] = [];
    const peltIndex: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const z = lerp(DOOR_Z - 0.05, RIVER_END, i / steps);
      const cx = riverX(z);
      const w = riverHalf(z);
      peltPositions.push(cx - w, 0.003, z, cx + w, 0.003, z);
      peltUv.push(0, z, 1, z);
      if (i < steps) {
        const a = i * 2;
        peltIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const pelt = new BufferGeometry();
    pelt.setAttribute('position', new Float32BufferAttribute(peltPositions, 3));
    pelt.setAttribute('uv', new Float32BufferAttribute(peltUv, 2));
    pelt.setIndex(peltIndex);
    const hair = { value: new Color(0xd8d2c0) };
    const fog = { value: new Color(FOG_COLOR) };
    const fogDensity = { value: FOG_DENSITY };
    const peltMesh = new Mesh(
      pelt,
      new ShaderMaterial({
        vertexShader: PELT_VERT,
        fragmentShader: PELT_FRAG,
        uniforms: { ...warpUniforms, uStreaks: { value: this.streaks }, uHair: hair, uGlow: this.glow, uLamp: this.lampAt, uLampPower: this.lampPower, uFog: fog, uFogDensity: fogDensity },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    peltMesh.frustumCulled = false;
    peltMesh.renderOrder = 1;
    this.root.add(peltMesh);

    const random = randomFrom(404);
    const positions: number[] = [];
    const data: number[] = [];
    const index: number[] = [];
    for (let i = 0; i < RIVER_STRANDS; i++) {
      const start = random() < 0.5 ? lerp(-12, -21, random()) : lerp(DOOR_Z - 0.4, RIVER_END + 1, random());
      const length = 2.2 + random() * 4.6;
      const across = random() * 2 - 1;
      const lateral = Math.sign(across) * Math.pow(Math.abs(across), 1.4) * 0.96;
      const phase = random() * 6.283;
      const kink = 0.03 + random() * 0.09;
      const shade = random();
      const bright = 0.2 + 0.8 * shade * shade;
      const wide = 0.0011 + random() * 0.0016;
      const y = 0.004 + random() * 0.003;
      for (let k = 0; k <= RIVER_SEGMENTS; k++) {
        const along = k / RIVER_SEGMENTS;
        const z = Math.max(RIVER_END, start - along * length);
        const x = riverX(z) + riverHalf(z) * lateral + Math.sin(z * 2.6 + phase) * kink + Math.sin(z * 7.1 + phase * 2) * kink * 0.35;
        positions.push(x - wide, y, z, x + wide, y, z);
        data.push(along, phase, bright, along, phase, bright);
        if (k < RIVER_SEGMENTS) {
          const a = positions.length / 3 - 2;
          index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aStrand', new Float32BufferAttribute(data, 3));
    geometry.setIndex(index);
    const strands = new Mesh(
      geometry,
      new ShaderMaterial({
        vertexShader: STRAND_VERT,
        fragmentShader: STRAND_FRAG,
        uniforms: { ...warpUniforms, uTime: this.shared.uTime, uShow: this.strandsShow, uHair: hair, uGlow: this.glow, uLamp: this.lampAt, uLampPower: this.lampPower, uFog: fog, uFogDensity: fogDensity },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    strands.frustumCulled = false;
    strands.renderOrder = 2;
    this.root.add(strands);
  }

  /** Those who stood waiting at the edge of the lamp: facing the table, a gap where you came in. */
  private placeRing(radius: number): void {
    const random = randomFrom(5150);
    for (let i = 0; i < RING_MEN; i++) {
      const half = RING_MEN / 2;
      const a = i < half ? lerp(0.65, Math.PI - 0.42, i / (half - 1)) : lerp(Math.PI + 0.42, Math.PI * 2 - 0.65, (i - half) / (half - 1));
      const r = radius + (random() - 0.5) * 0.7;
      this.men.set(i + 1, Math.sin(a) * r, 0, TABLE_Z + Math.cos(a) * r, a + Math.PI);
    }
    this.men.commit();
    this.ringNow = radius;
  }

  private setClock(sinceTick: number): void {
    const hop = sinceTick <= 0 ? 0 : 1 - Math.exp(-sinceTick * 22) * Math.cos(sinceTick * 38);
    const ticks = Math.max(0, Math.floor(sinceTick));
    const fraction = sinceTick - ticks;
    const seconds = ticks + 1 - Math.exp(-fraction * 26);
    for (const hands of this.clockHands) {
      setHand(hands[0], (18 + (30 + hop) / 60) / 12);
      setHand(hands[1], (30 + hop) / 60);
      setHand(hands[2], sinceTick <= 0 ? 0 : seconds / 60);
    }
  }

  private placeBeats(): void {
    const r = randomFrom(50);
    const pick = (list: readonly string[]) => list[Math.floor(r() * list.length)];
    this.beat(0, () => {
      this.hall = this.sound.bed('rooms/hall_vast.mp3', { gain: 0.25, fade: 2 });
      this.drone = this.sound.bed('rooms/dream_drone_low.mp3', { gain: 0.09, fade: 5 });
      this.sound.bed('rooms/paper_flutter.mp3', { gain: 0.05, fade: 4 });
      this.tick = this.sound.bed('rooms/clock_tick.mp3', { gain: 0.06, lowpass: 1800, reverb: 0.15 });
    });
    this.beat(5.5, () => this.sound.play('rooms/pool_drip_1.mp3', { gain: 0.2, pan: 0.4 }));
    this.beat(15.5, () => this.sound.play('rooms/pool_drip_1.mp3', { gain: 0.16, pan: -0.5 }));
    // your feet, then someone else's
    for (let t = 1.2, i = 0; t < SIT_AT - 0.6; t += 1.12, i++) {
      const file = STEPS[i % STEPS.length];
      const pan = i % 2 === 0 ? -0.06 : 0.06;
      this.beat(t, () => this.sound.play(file, { gain: 0.26, reverb: 0.35, pan }));
    }
    for (let t = 14, i = 0; t < SIT_AT - 0.4; t += 1.33, i++) {
      const u = range(14, SIT_AT, t);
      const file = STEPS_BEHIND[i % STEPS_BEHIND.length];
      const gain = lerp(0.05, 0.26, u);
      const lowpass = lerp(1200, 4200, u);
      const pan = i % 2 === 0 ? -0.1 : 0.1;
      this.beat(t, () => this.sound.play(file, { gain, reverb: 0.5, lowpass, pan }));
    }
    // four prints stir as you pass
    STIR_AT.forEach((at, i) => this.beat(at, () => this.sound.play('rooms/print_flutter.mp3', { gain: 0.2, reverb: 0.3, pan: i % 2 === 0 ? -0.5 : 0.5 })));
    // the lamps go out behind you, and later ahead
    for (let t = 8, i = 0; t < SIT_AT; t += 1.7 + r() * 1.4, i++) {
      const file = CANDLES[i % CANDLES.length];
      const pan = Math.sin(i * 2.4) * 0.7;
      this.beat(t, () => this.sound.play(file, { gain: 0.34, reverb: 0.15, pan, lowpass: 2600 }));
    }
    for (let t = SIT_AT + 1.2, i = 0; t < 46; t += 1.1 + r() * 1.2, i++) {
      const file = CANDLES[i % CANDLES.length];
      const pan = Math.sin(i * 1.7) * 0.6;
      this.beat(t, () => this.sound.play(file, { gain: 0.2, reverb: 0.15, pan, lowpass: 1800 }));
    }
    // the mother's three lines are the voice from the house
    this.beat(LATE_AT, () => this.say({ tr: 'Geç kaldın.', en: 'You are late.' }, 4, 'house'));
    this.beat(SIT_LINE_AT, () => this.say({ tr: 'Otur.', en: 'Sit.' }, 3.5, 'house'));
    this.beat(18, () => {
      const fingers = this.sound.bed('rooms/hair_fingers.mp3', { gain: 0.22, fade: 3 });
      this.beat(27, () => fingers.gain(0, 3));
    });
    this.beat(SIT_AT - 1.1, () => this.sound.play('rooms/chair_wood_move.mp3', { gain: 0.32, reverb: 0.3, offset: 0.6, duration: 2.2 }));
    // a real silence before it moves
    this.beat(TICK_AT - 2.1, () => {
      this.tick?.gain(0, 1.4);
      this.hall?.gain(0.1, 2);
      this.drone?.gain(0.03, 2);
    });
    this.beat(TICK_AT, () => {
      this.sound.play('rooms/clock_tick_once.mp3', { gain: 0.7, reverb: 0.5 });
      this.sound.play('rooms/deep_bell.mp3', { gain: 0.5, reverb: 0.6 });
      this.hall?.gain(0.25, 3);
      this.tick?.gain(0.07, 3);
    });
    // the meal: forks, then mouths, one at a time, until you would give anything for it to stop
    this.beat(EAT_AT, () => {
      this.meal.push(this.sound.bed('rooms/forks_close.mp3', { gain: 0.28, fade: 1.5 }));
      this.meal.push(this.sound.bed('rooms/chew_small.mp3', { gain: 0.2, pan: -0.55, fade: 1 }));
    });
    this.beat(EAT_AT + 3, () => this.meal.push(this.sound.bed('rooms/chew_soft.mp3', { gain: 0.16, pan: 0.5, fade: 1 })));
    this.beat(EAT_AT + 5.5, () => this.meal.push(this.sound.bed('rooms/chew_wet.mp3', { gain: 0.22, fade: 1.5 })));
    this.beat(EAT_AT + 7.2, () => {
      const lips = this.sound.bed('rooms/lip_smack.mp3', { gain: 0.12, fade: 0.4 });
      this.beat(EAT_AT + 8.7, () => lips.gain(0, 0.8));
    });
    this.beat(EAT_AT + 7.8, () => this.sound.play('rooms/fork_scrape_1.mp3', { gain: 0.25, pan: -0.5 }));
    const pans = [-0.55, 0.5, 0];
    for (let t = EAT_AT + 0.6; t < STOP_AT - 0.35; t += 0.5 + r() * 0.95) {
      const kind = r();
      const pan = pans[Math.floor(r() * pans.length)];
      const file = kind < 0.45 ? pick(FORKS) : kind < 0.72 ? pick(STABS) : kind < 0.93 ? pick(CLINKS) : pick(GLASSES);
      const gain = 0.2 + r() * 0.14;
      this.beat(t, () => this.sound.play(file, { gain, pan, reverb: 0.2 }));
    }
    // the fork stops and takes everything with it
    this.beat(STOP_AT, () => {
      for (const v of this.meal) v.gain(0, 0.12);
      this.hall?.gain(0, 0.5);
      this.drone?.gain(0, 0.5);
      this.tick?.gain(0, 0.5);
      this.sound.play('rooms/fork_down_1.mp3', { gain: 0.45, reverb: 0.2, pan: 0.45 });
    });
    this.beat(STOP_AT + 0.4, () => this.say({ tr: 'Ye. Daha soğumadı.', en: 'Eat. It has not gone cold yet.' }, 3.4, 'house'));
    this.beat(STOP_AT + 2.1, () => this.sound.play('rooms/heart_beat.mp3', { gain: 0.35 }));
    this.beat(STOP_AT + 3.1, () => this.sound.play('rooms/heart_beat.mp3', { gain: 0.42 }));
    this.beat(SHUTTER_AT, () => this.shutter());
    this.beat(SHUTTER_AT + 0.45, () => this.sound.play('rooms/polaroid_motor.mp3', { gain: 0.3, reverb: 0.5, lowpass: 2500 }));
    this.beat(CUT_AT, () => this.sound.stopAll(0.05));
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const time = frame.time;
    const u = this.shared;
    u.uTime.value = time;
    const back = this.backFront.at(s);
    u.uBack.value = back;
    u.uFar.value = this.farFront.at(s);
    this.control = s < SIT_AT - 0.4 ? WALKING : HELD;
    this.focus = this.focusTrack.at(s);
    this.aperture = this.apertureTrack.at(s);
    this.fear = this.fearTrack.at(s);
    this.steamTime.value = time;
    for (const clock of this.ticking) clock.value = time;

    // eyes opening, a blink as you sit, the cut
    this.black = s >= CUT_AT ? 1 : Math.max(1 - smootherstep(range(0, 1.5, s)), smootherstep(range(29.55, 29.85, s)) * (1 - smootherstep(range(30.2, 30.75, s))));

    const sinceFlash = s - SHUTTER_AT;
    const flash = s >= CUT_AT || sinceFlash < -FLASH_LEAD ? 0 : sinceFlash < 0 ? 1 + sinceFlash / FLASH_LEAD : Math.exp(-sinceFlash * FLASH_FALL);
    u.uFlash.value = flash;
    this.star.visible = flash > 0.01;
    if (this.star.visible) {
      const size = FLASH_STAR * (0.45 + 0.55 * flash);
      this.star.scale.set(size, size, 1);
      ((this.star.material as ShaderMaterial).uniforms.uColor.value as Color).setRGB(flash * 3, flash * 3, flash * 3);
    }

    this.glow.value = lerp(0.05, 0.07, smootherstep(range(15, 20.5, s)));
    this.strandsShow.value = smootherstep(range(13, 19.5, s));

    // after the bell the lamp has something to remember
    const rung = s - TICK_AT;
    const sway = rung > 0 ? SWING * Math.exp(-rung * 0.16) * Math.sin(rung * 1.55) : 0;
    this.lampRig.position.x = sway;
    (this.key.position as unknown as number[])[0] = this.origin.x + sway;
    (this.key.target as unknown as number[])[0] = this.origin.x + sway * 2;
    this.lampAt.value.x = sway;
    const breath = (1 + 0.05 * wobble(time * 0.6, 2)) * this.powerTrack.at(s);
    const off = range(3, 14, this.eyeToLamp);
    (this.lampGlow.material as ShaderMaterial).uniforms.uColor.value.setRGB(1, 0.58, 0.25).multiplyScalar(lerp(0, 0.85, off) * breath);
    (this.lampBeam.material as ShaderMaterial).uniforms.uIntensity.value = lerp(0, 0.12, off);
    this.key.intensity = LAMP_I * breath;
    this.bounce.intensity = BOUNCE_I * breath * (1 + 2.4 * smootherstep(range(RAISE_AT, RAISED_AT, s)));
    this.lampPower.value = LAMP_I * breath * 0.26;
    this.movingShadows = rung > 0 && rung < 24;

    for (const dial of this.dials) dial.emissiveIntensity = CLOCK_GLOW * (1 + 4 * flash + 0.8 * (rung > 0 ? Math.exp(-rung * 2.5) : 0));
    this.setClock(rung);

    if (!this.posed || (s >= RAISE_AT - 0.1 && s <= STOP_AT + 1.2)) {
      this.poseFamily(s);
      this.posed = true;
    }
    this.walkAlong(frame, s, back);

    // your chair comes out by itself, and goes back in under you
    this.myChair.position.z = SEAT_Z + CHAIR_PULL * smootherstep(range(SIT_AT - 1.1, SIT_AT - 0.2, s)) * (s < SIT_AT + 0.1 ? 1 : 0);

    // four prints stir
    const lastStir = STIR_AT[STIR_AT.length - 1] + 3.1;
    if (s >= STIR_AT[0] && (s <= lastStir || !this.stirred)) {
      for (let i = 0; i < this.stirrers.length; i++) {
        const tau = s - STIR_AT[i];
        const lift = tau < 0 || tau > 3.1 ? 0 : 0.5 * Math.exp(-1.5 * tau) * (1 - Math.cos(tau * 5.2)) * 0.5;
        this.writePrint(this.prints, i, this.stirrers[i], false, lift);
        this.writePrint(this.prints, i + this.stirrers.length, this.stirrers[i], true, lift);
      }
      const matrices = this.prints.instanceMatrix;
      matrices.addUpdateRange(0, this.stirrers.length * 2 * 16);
      matrices.needsUpdate = true;
      this.stirred = s > lastStir;
    }

    // your own hair, white, coming down
    const grown = smootherstep(range(SIT_AT + 2, SHUTTER_AT, s));
    this.lensHair.visible = s > SIT_AT + 1.5 && s < CUT_AT;
    this.lensHair.scale.y = 0.15 + 0.85 * grown;

    const ring = s < RING_CLOSES_AT ? RING_FAR : RING_NEAR;
    if (ring !== this.ringNow) this.placeRing(ring);
  }

  /** You and the one behind you. */
  private walkAlong(frame: RoomFrame, s: number, front: number): void {
    this.pose(frame.t, this.eye);
    const ex = this.eye.position.x;
    const ey = this.eye.position.y;
    const ez = this.eye.position.z;
    this.eyeToLamp = Math.abs(ez - this.origin.z - TABLE_Z);
    const walking = s < SIT_AT;
    this.nearLight.intensity = walking ? NEAR_I * range(2.5, 6, s) : 0;
    if (walking) this.nearLight.position.set(ex, ey + 1.4, ez - 0.4);

    if (!walking) {
      if (!this.manArrived) {
        this.men.set(0, 0, 0, SEAT_Z + BEHIND_CHAIR, Math.PI);
        this.men.commit();
        this.manArrived = true;
        this.followLight.position.set(this.origin.x, this.origin.y + 2.1, this.origin.z + SEAT_Z + 0.35);
        this.followLight.intensity = BEHIND_I;
      }
      return;
    }
    this.manArrived = false;
    if (s < 8) return;
    const z = Math.min(BACK_Z - 0.6, front + 0.5);
    const x = riverX(z);
    if (this.unseen(frame, this.manX, 1, this.manZ) && this.unseen(frame, x, 1, z)) {
      this.men.set(0, x, 0, z, Math.PI);
      this.men.commit();
      this.manX = x;
      this.manZ = z;
      this.followLight.position.set(this.origin.x + x, this.origin.y + 1.7, this.origin.z + z - 0.9);
    }
    this.followLight.intensity = FOLLOW_I;
  }

  /** The family, every frame they can move: heads bowed, then raised, then the forks. */
  private poseFamily(s: number): void {
    const raised = smootherstep(range(RAISE_AT, RAISED_AT, s));
    for (const d of this.diners) {
      for (let i = 0; i < d.bones.length; i++) d.bones[i].quaternion.copy(d.rest[i]);
      const running = Math.min(s, d.stop);
      const begun = smootherstep(range(EAT_AT - 0.2, EAT_AT + 1.2, s));
      const turning = ((running - EAT_AT + d.phase) / d.cycle) % 1;
      const p = turning < 0 ? turning + 1 : turning;
      const toMouth = (smootherstep(range(0.22, 0.48, p)) - smootherstep(range(0.62, 0.9, p))) * begun;
      const chewing = smootherstep(range(0.55, 0.62, p)) * (1 - smootherstep(range(0.92, 1, p))) * begun;
      const chew = Math.sin(running * Math.PI * 2 * CHEW_HZ);
      const nod = chewing * chew * 0.032 + toMouth * 0.06;
      const bow = (1 - raised) * BOW - d.restBow + nod;
      for (let i = 0; i < BENDS.length; i++) {
        qA.setFromAxisAngle(d.axis, bow * BENDS[i].bow);
        qB.setFromAxisAngle(UP, raised * d.turn * BENDS[i].turn);
        turnBone(d.bones[i], qC.multiplyQuaternions(qB, qA));
      }
      vAxis.copy(d.axis).applyAxisAngle(UP, raised * d.turn);
      qA.setFromAxisAngle(vAxis, Math.max(0, toMouth * 0.26 + chewing * (0.1 + chew * 0.1)));
      turnBone(d.bones[4], qA);

      d.bones[3].getWorldPosition(vMouth).sub(this.origin);
      vMouth.addScaledVector(d.toEye, MOUTH_FORWARD);
      vMouth.y += MOUTH_UP;
      const lifted = toMouth * FORK_LIFT;
      vTip.lerpVectors(d.plateAt, vMouth, lifted);
      vTip.y += Math.sin(toMouth * Math.PI) * 0.03;
      vTip.x += Math.sin(running * 6.1 + d.phase) * FORK_SCRAPE * begun;
      vAim.copy(d.toEye).negate();
      vAim.y += 0.22;
      vDir.lerpVectors(d.downFork, vAim, lifted).normalize();
      vWrist.copy(vTip).addScaledVector(vDir, -GRIP).add(this.origin);
      reach(d.bones[5], d.bones[6], d.bones[7], vWrist, d.pole);
      levelHand(d.bones[6], d.bones[7], d.axes[0], vDir);
      vWrist.copy(d.otherAt).add(this.origin);
      reach(d.bones[8], d.bones[9], d.bones[10], vWrist, d.otherPole);
      levelHand(d.bones[9], d.bones[10], d.axes[1], DOWN);

      qA.setFromUnitVectors(UP, vDir);
      vAt.copy(vTip).addScaledVector(vDir, -FORK_LENGTH * FORK_SIZE);
      mWork.compose(vAt, qA, vScale.setScalar(FORK_SIZE));
      this.forks.setMatrix(d.fork, mWork);

      const head = d.bones[3];
      head.updateWorldMatrix(true, false);
      d.head.copy(head.matrixWorld);
      d.head.elements[12] -= this.origin.x;
      d.head.elements[13] -= this.origin.y;
      d.head.elements[14] -= this.origin.z;
    }
    this.forks.commit();
  }

  dispose(): void {
    super.dispose();
    this.atlas.dispose();
    this.lampMap.dispose();
    this.streaks.dispose();
    this.wetMap.dispose();
    for (const map of this.faceMaps) map.dispose();
  }
}

const FLIP = new Matrix4().makeScale(1, -1, 1);
