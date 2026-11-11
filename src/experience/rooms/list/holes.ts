import {
  AnimationMixer,
  Box3,
  BoxGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Bone,
  type BufferGeometry,
  type IUniform,
  type Material,
  type MeshStandardMaterial,
  type SkinnedMesh,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import { randomFrom, type Crowd, type FigureSpec } from '../../dream/FigureKit';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey, RoomPose } from '../Room';
import { Room } from '../Room';
import type { RoomVoice } from '../RoomSound';

const numbered = (name: string, n: number) => Array.from({ length: n }, (_, i) => `rooms/${name}_${i + 1}.mp3`);

export const assets: RoomAssets = {
  models: ['mri_head'],
  materials: ['plaster_gallery', 'wood_floor_dark'],
  sounds: [
    'rooms/museum_tone.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/seed_clicks.mp3',
    'rooms/seed_clicks_dense.mp3',
    'rooms/holes_open.mp3',
    'rooms/breath_open_mouth.mp3',
    'rooms/coat_move.mp3',
    'rooms/eye_turn.mp3',
    ...numbered('step_gallery', 3),
    ...numbered('wet_click', 5),
    ...numbered('mouth_click', 6),
    ...numbered('wet_plip', 4),
  ],
};

/** The gallery (m): half its width at the start and when it has closed in, its height, its two end walls. */
const HALF_WIDE = 2.9;
const HALF_NARROW = 2.3;
const HEIGHT = 4.5;
const END_Z = -11;
const BACK_Z = 4.4;
/** One bay of the ceiling and of the walls (m), the glass in it (m). */
const BAY = 2.567;
const PANEL_W = 3.1;
const PANEL_L = 2.0;
/** Where the old man stands (z, m), and the eye's height (m). */
const MAN_Z = -8.6;
const EYE = 1.52;
/** The doors in the side walls (z, m). */
const DOOR_LEFT = -6.5;
const DOOR_RIGHT = -1.9;
/** The one light: where it stands, what it looks at, its power, its half angle (deg). */
const KEY_AT = [-2.6, 1.1, -1.6] as const;
const KEY_TO = [0.5, 1.45, END_Z] as const;
const KEY_POWER = 430;
const KEY_ANGLE = 12;
/** The light that finds his face once he has turned, its power. */
const FACE_POWER = 11;

/** What he wears and how bleached it is. */
const SUIT_TINT = 0x8c9096;
const SUIT_BLEACH = 0.65;
/** The clip he turns with (s of the clip are spread over the seconds below). */
const TURN_CLIP = 'm_turn_right_180';
/** The real head for his face: height (m), and where its back half stops (m in front of its center). */
const SCAN_H = 0.258;
const SCAN_CUT = -0.012;
/** How far the eye stops from the tip of his nose (m), when the shutter falls and at the cut. */
const FACE_AT_SHUTTER = 0.52;
const FACE_AT_CUT = 0.44;

/** The story, in seconds. */
const TURN_FROM = 32;
const TURN_TO = 37.6;
const SHUTTER_AT = 38;
const LINE_AT = 40;
const OPEN_TO = 43;
const CUT_AT = 44;
/** The real silence before he turns (s), when the clicking stops and when the breath begins. */
const HUSH_AT = 30.8;
const BREATH_AT = 34.2;
const BREATH_PERIOD = 3.7;
/** How far apart the one behind you stays (m). */
const BEHIND_GAP = 3.4;

/** Pairs of (second, value), straight between. */
const PIN_CURVE = [0, 0.26, 5.6, 0.3, 8.5, 0.8, 12, 1];
const BLOOM_CURVE = [11, 0, 14, 1, 17, 2.2, 20, 3.6, 24, 6.2, 28, 9.5, 34, 18];
const BEHIND_CURVE = [16.5, 0, 22, 2.2, 28, 7.5, 34, 14];
const FLOOR_CURVE = [20, 0, 23, 1.4, 26, 3.3, 29, 6.2, 34, 13];
const BODY_CURVE = [25.5, 0, 28, 0.55, 31, 1.7];
/** Light of the glass ceiling, nearest the viewer and at the man's end; of the key; of glints. */
const LAY_NEAR_CURVE = [0, 3.4, 12, 3, 20, 2, 27, 1, 34, 0.5, 44, 0.3];
const LAY_FAR_CURVE = [0, 10.5, 12, 10, 22, 6.5, 30, 3.8, 34, 2.4, 38, 1, 44, 0.5];
const KEY_CURVE = [0, 1, 26, 0.92, 32, 0.6, 36, 0.22, 38, 0.13, 44, 0.07];
const GLASS_NEAR_CURVE = [0, 0.46, 10, 0.42, 18, 0.22, 24, 0.06, 34, 0.02];
const GLASS_FAR_CURVE = [0, 1.25, 16, 1.2, 28, 0.62, 36, 0.2, 44, 0.08];
const FEAR_CURVE = [0, 0.14, 12, 0.22, 26, 0.5, 34, 0.8, 44, 0.9];

/** Footsteps of the viewer (s); and one more, later, from behind. */
const STEPS = [2.1, 4.8, 7.4, 10.1, 12.8, 15.4, 18.1, 20.8, 23.4, 26.2, 28.9];
const STEP_BEHIND = 31.7;
/** Single small clicks, placed by hand: second, file, stereo place, gain. */
const TICKS: readonly (readonly [number, string, number, number])[] = [
  [5.9, 'wet_click_2', -0.35, 0.14],
  [7.2, 'mouth_click_3', 0.5, 0.1],
  [8.1, 'wet_click_4', -0.7, 0.12],
  [9.6, 'wet_click_1', 0.2, 0.16],
  [10.3, 'mouth_click_1', 0.75, 0.1],
  [11, 'wet_click_5', -0.2, 0.14],
  [12.2, 'wet_plip_2', 0.05, 0.16],
  [13, 'mouth_click_5', -0.6, 0.14],
  [13.4, 'wet_click_3', 0.4, 0.16],
  [14.6, 'mouth_click_2', 0.8, 0.14],
  [15.2, 'wet_plip_1', -0.45, 0.16],
  [16.1, 'mouth_click_4', 0.2, 0.18],
  [17, 'wet_plip_3', 0.6, 0.18],
  [18.3, 'mouth_click_6', -0.8, 0.2],
  [21.4, 'wet_plip_4', -0.3, 0.22],
  [26.5, 'eye_turn', 0.45, 0.14],
  [27.8, 'eye_turn', -0.6, 0.12],
  [29.4, 'eye_turn', 0.1, 0.16],
];

const f = (n: number) => n.toFixed(3);

const VERT_HEAD = /* glsl */ `
uniform vec3 uPitOrigin;
uniform vec3 uPitKeyW;
uniform float uPitScale;
uniform float uPitFeet;
uniform float uPitBody;
uniform float uPitSwell;
uniform float uPitTime;
varying vec3 vPitP;
varying vec3 vPitN;
#ifdef PIT_SOLID
varying vec3 vPitQ;
varying vec3 vPitV;
varying vec3 vPitL;
#endif
`;

const VERT_SWELL = /* glsl */ `
#ifdef PIT_FACE
  transformed += normalize(objectNormal) * uPitSwell * (0.7 + 0.3 * sin(position.y * 5.0 + uPitTime * 0.6)) / uPitScale;
#endif
`;

const VERT_PASS = /* glsl */ `
#ifdef PIT_SOLID
  #if defined(USE_SKINNING)
    mat4 pitBones = skinWeight.x * boneMatX + skinWeight.y * boneMatY + skinWeight.z * boneMatZ + skinWeight.w * boneMatW;
    vec4 pitRest = bindMatrix * vec4(position, 1.0);
    vec3 pitWorld = (pitBones * pitRest).xyz;
    mat3 pitTurn = mat3(pitBones);
    vPitQ = vec3(pitRest.x, pitRest.z + uPitFeet, -pitRest.y) * uPitBody;
    vec3 pitRestN = mat3(bindMatrix) * normal;
    vPitN = vec3(pitRestN.x, pitRestN.z, -pitRestN.y);
  #elif defined(USE_INSTANCING)
    mat4 pitWhole = modelMatrix * instanceMatrix;
    vec3 pitWorld = (pitWhole * vec4(position, 1.0)).xyz;
    mat3 pitTurn = mat3(pitWhole);
    vPitQ = position;
    vPitN = normal;
  #else
    vec3 pitWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
    mat3 pitTurn = mat3(modelMatrix);
    vPitQ = position * uPitScale;
    vPitN = normal;
  #endif
  vPitV = (cameraPosition - pitWorld) * pitTurn;
  vPitL = (uPitKeyW - pitWorld) * pitTurn;
  #if defined(USE_SKINNING)
    vPitV = vec3(vPitV.x, vPitV.z, -vPitV.y);
    vPitL = vec3(vPitL.x, vPitL.z, -vPitL.y);
  #endif
  vPitP = pitWorld - uPitOrigin;
#else
  vec4 pitPlace = modelMatrix * vec4(transformed, 1.0);
  vPitP = pitPlace.xyz - uPitOrigin;
  vPitN = normalize(mat3(modelMatrix) * objectNormal);
#endif
`;

const FRAG_HEAD = /* glsl */ `
uniform float uPitGrow;
uniform float uPitGrowB;
uniform float uPitFeather;
uniform float uPitIslands;
uniform float uPitPin;
uniform float uPitOpen;
uniform float uPitMove;
uniform float uPitLamp;
uniform float uPitBreath;
uniform float uPitTime;
uniform float uPitLayFar;
uniform float uPitLayNear;
uniform float uPitHalf;
uniform float uPitKeyOn;
uniform float uPitGlint;
uniform vec3 uPitSeedA;
uniform vec3 uPitSeedB;
uniform vec3 uPitOrigin;
uniform vec3 uPitKey;
uniform vec3 uPitFlush;
uniform vec3 uPitLip;
uniform vec3 uPitDeep;
varying vec3 vPitP;
varying vec3 vPitN;
#ifdef PIT_SOLID
varying vec3 vPitQ;
varying vec3 vPitV;
varying vec3 vPitL;
#endif

struct PitHit { float e; vec3 v; float r; vec4 rnd; float lip; };

vec4 pitHash(vec3 c) {
  vec4 p = fract(c.xyzx * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p += dot(p, p.wzxy + 33.33);
  return fract((p.xxyz + p.yzzw) * p.zywx);
}

float pitShow(float s, float fw) { return smoothstep(1.0, 2.6, 0.33 * s / fw); }

/*
 * One layer of pits. A feature point per lattice cell, jittered; only the 4 (or 8) cells around the nearest
 * lattice corner can hold a pit that reaches this point, as no radius exceeds half a cell.
 */
void pitLayer(vec3 x, vec3 n, float s, float salt, float birth, float spread, float wide, float g, float open, float show, inout PitHit best) {
  if (show <= 0.0) return;
  vec3 c0 = x / s;
  vec3 base = floor(c0 - 0.5);
#ifdef PIT_SOLID
  for (int k = 0; k < 8; k++) {
    vec3 cell = base + vec3(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    vec4 rnd = pitHash(cell + salt);
    vec3 v = c0 - (cell + 0.5 + (rnd.xyz - 0.5) * 0.66);
#else
  for (int k = 0; k < 4; k++) {
    vec3 cell = vec3(base.xy + vec2(k & 1, (k >> 1) & 1), salt);
    vec4 rnd = pitHash(cell);
    vec3 v = vec3(c0.xy - (cell.xy + 0.5 + (rnd.xy - 0.5) * 0.66), 0.0);
#endif
    if (rnd.w > 0.86) continue;
    float at = birth + rnd.w * spread;
    float born = smoothstep(at, at + 0.5, g);
    if (born <= 0.0) continue;
    float r = min((wide + rnd.z * 0.15) * born * open * show, 0.49);
#ifdef PIT_SOLID
    float h = dot(v, n);
    v -= n * h;
    float r2 = r * r - h * h;
    if (r2 <= 0.0) continue;
    r = sqrt(r2);
#endif
    float e = (length(v) - r) * s;
    if (e < best.e) { best.e = e; best.v = v * s; best.r = r * s; best.rnd = rnd; best.lip = 1.0; }
  }
}

vec3 pitBump(vec3 N, vec2 dH, float side) {
  vec3 sx = dFdx(-vViewPosition);
  vec3 sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, N);
  vec3 r2 = cross(N, sx);
  float det = dot(sx, r1) * side;
  vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * N - grad);
}
`;

/** The field of pits at this point of the surface, and everything the rest of the shader needs from it. */
const FRAG_FIELD = /* glsl */ `
vec3 pitEye = cameraPosition - uPitOrigin - vPitP;
float pitInside = 0.0;
float pitRim = 0.0;
float pitPink = 0.0;
float pitCover = 0.0;
vec3 pitColor = vec3(0.0);
vec3 pitGrad = vec3(0.0);
vec3 pitShine = vec3(0.0);
PitHit pit = PitHit(1000.0, vec3(0.0), 1.0, vec4(0.0), 0.0);
vec3 pitX;
vec3 pitN;
vec3 pitView;
vec3 pitLight;
float pitG;
float pitPatch;
float pitOpen = uPitOpen;
#ifdef PIT_SOLID
  pitN = normalize(vPitN);
  pitView = normalize(vPitV);
  pitLight = normalize(vPitL);
  pitX = vPitQ + 0.003 * sin(vPitQ.zxy * 83.0 + 1.3);
  vec3 pitA1 = pitX * 9.3 + vec3(1.1, 4.7, 2.9);
  vec3 pitA2 = pitX.zxy * 27.1 + vec3(3.3, 9.2, 5.5);
  float pitN1 = dot(sin(pitA1), cos(pitA1.zxy)) / 1.5;
  float pitN2 = dot(sin(pitA2), cos(pitA2.zxy)) / 1.5;
  float pitCluster = pitN1 * 0.65 + pitN2 * 0.35;
  pitPatch = smoothstep(-0.15, 0.5, pitN1);
  #ifdef PIT_FACE
    if (pitX.z < ${f(SCAN_CUT)}) discard;
    vec3 pitFace = pitX * ${f(0.245 / SCAN_H)};
    float pitEyes = min(length((pitFace - vec3(0.033, -0.004, 0.092)) * vec3(0.85, 1.25, 1.0)), length((pitFace - vec3(-0.033, -0.004, 0.092)) * vec3(0.85, 1.25, 1.0)));
    float pitMouth = length((pitFace - vec3(0.0, -0.066, 0.098)) * vec3(0.72, 1.7, 1.0));
    float pitDark = 1.0 - smoothstep(0.012, 0.036, min(pitEyes, pitMouth));
    pitPatch = max(pitPatch * 0.5, pitDark);
    // the nose stays a nose: only the smallest holes on its ridge
    vec3 pitNoseAt = (pitFace - vec3(0.0, -0.022, 0.112)) / vec3(0.017, 0.042, 0.03);
    float pitNose = 3.2 * (1.0 - smoothstep(0.55, 1.15, length(pitNoseAt)));
    pitG = 2.6 + pitCluster * 0.4;
    pitOpen *= 1.0 + uPitBreath * (0.12 + 0.06 * sin(pitX.y * 26.0 + uPitTime * 0.8));
    float pitFw = max(sqrt(length(dFdx(pitX)) * length(dFdy(pitX))), 1e-6);
    pitLayer(pitX, pitN, 0.0068, 11.0, -1.0, 0.9, 0.33, pitG, pitOpen, pitShow(0.0068, pitFw), pit);
    pitLayer(pitX, pitN, 0.013, 23.0, -0.4 + pitNose, 1.0, 0.35, pitG, pitOpen, pitShow(0.013, pitFw), pit);
    pitLayer(pitX, pitN, 0.0255, 37.0, 2.4 - pitPatch * 3.0 + pitNose, 1.0, 0.37, pitG, pitOpen, pitShow(0.0255, pitFw), pit);
  #else
    pitG = (uPitGrow - distance(pitX, uPitSeedA)) / uPitFeather + pitCluster * uPitIslands;
    pitG -= smoothstep(1.53, 1.59, pitX.y) * 6.0 * (1.0 - smoothstep(0.24, 0.36, (diffuseColor.r - diffuseColor.b) / max(diffuseColor.r, 0.01)));
    float pitFw = max(sqrt(length(dFdx(pitX)) * length(dFdy(pitX))), 1e-6);
    if (pitG > -0.2) {
      pitLayer(pitX, pitN, 0.0088, 11.0, -0.1, 0.8, 0.31, pitG, pitOpen, pitShow(0.0088, pitFw), pit);
      pitLayer(pitX, pitN, 0.0165, 23.0, 0.35, 0.9, 0.33, pitG, pitOpen, pitShow(0.0165, pitFw), pit);
      pitLayer(pitX, pitN, 0.03, 37.0, 1.1 + (1.0 - pitPatch) * 1.3, 1.0, 0.34, pitG, pitOpen, pitShow(0.03, pitFw), pit);
    }
  #endif
#else
  vec3 pitNr = normalize(vPitN);
  vec3 pitAbs = abs(pitNr);
  vec3 pitToLight = uPitKey - vPitP;
  if (pitAbs.x > 0.6) {
    float pitSide = sign(pitNr.x);
    pitX = vec3(vPitP.zy, 0.0);
    pitView = normalize(vec3(pitEye.zy, pitEye.x * pitSide));
    pitLight = normalize(vec3(pitToLight.zy, pitToLight.x * pitSide));
  } else if (pitAbs.y > 0.6) {
    float pitSide = sign(pitNr.y);
    pitX = vec3(vPitP.xz, 0.0);
    pitView = normalize(vec3(pitEye.xz, pitEye.y * pitSide));
    pitLight = normalize(vec3(pitToLight.xz, pitToLight.y * pitSide));
  } else {
    float pitSide = sign(pitNr.z);
    pitX = vec3(vPitP.xy, 0.0);
    pitView = normalize(vec3(pitEye.xy, pitEye.z * pitSide));
    pitLight = normalize(vec3(pitToLight.xy, pitToLight.z * pitSide));
  }
  pitN = vec3(0.0, 0.0, 1.0);
  pitX.xy += 0.02 * vec2(sin(pitX.y * 7.3 + sin(pitX.x * 4.1) * 1.3), cos(pitX.x * 6.7 - sin(pitX.y * 3.7) * 1.1));

  // the room's own age: what it is before anything happens to it
  float pitDx = uPitHalf - abs(vPitP.x);
  float pitDy = min(vPitP.y * 1.25, ${f(HEIGHT)} - vPitP.y);
  float pitDz = min(vPitP.z - ${f(END_Z)}, ${f(BACK_Z)} - vPitP.z);
  float pitAo = 1.0;
  if (pitAbs.x < 0.6) pitAo *= mix(0.46, 1.0, smoothstep(0.0, 0.75, pitDx));
  if (pitAbs.y < 0.6) pitAo *= mix(0.5, 1.0, smoothstep(0.0, 0.6, pitDy));
  if (pitAbs.z < 0.6) pitAo *= mix(0.46, 1.0, smoothstep(0.0, 0.75, pitDz));
  diffuseColor.rgb *= pitAo;
  vec3 pitG1 = vPitP * 0.73 + vec3(2.0, 7.0, 1.0);
  vec3 pitG2 = vPitP.yzx * 3.1;
  float pitGrime = (dot(sin(pitG1), cos(pitG1.zxy)) / 1.5 * 0.5 + 0.5) * 0.7 + (dot(sin(pitG2), cos(pitG2.zxy)) / 1.5 * 0.5 + 0.5) * 0.3;
  #ifndef PIT_FLOOR
    diffuseColor.rgb *= mix(0.86, 1.05, pitGrime);
    float pitFoot = 1.0 - smoothstep(0.0, 0.5 + 0.3 * pitGrime, vPitP.y);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.6, 0.64, 0.56), pitFoot);
    if (pitAbs.y < 0.6) diffuseColor.rgb *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.012, abs(vPitP.y - 3.12)));
    // pale places where pictures hung, their labels still there, their nails
    if (pitAbs.x > 0.6) {
      float pitBay = floor((vPitP.z + 1.2) / ${f(BAY)});
      float pitWall = sign(vPitP.x);
      vec4 pitB = pitHash(vec3(pitBay, 3.0, pitWall));
      vec2 pitC = vec2((pitBay + 0.5) * ${f(BAY)} - 1.2 + (pitB.x - 0.5) * 0.25, 1.62 + (pitB.y - 0.5) * 0.12);
      vec2 pitS = vec2(0.36 + pitB.y * 0.44, 0.44 + pitB.z * 0.42);
      if (abs(pitC.x - (pitWall < 0.0 ? ${f(DOOR_LEFT)} : ${f(DOOR_RIGHT)})) > 1.2) {
        vec2 pitD = abs(vPitP.zy - pitC) - pitS;
        float pitEdge = max(pitD.x, pitD.y);
        diffuseColor.rgb *= 1.0 + 0.17 * (1.0 - smoothstep(-0.004, 0.004, pitEdge));
        diffuseColor.rgb *= 1.0 - 0.24 * (1.0 - smoothstep(0.0, 0.014, abs(pitEdge)));
        vec2 pitNail = vPitP.zy - pitC - vec2(0.0, pitS.y - 0.14);
        diffuseColor.rgb *= smoothstep(0.003, 0.006, length(pitNail));
        vec2 pitL = abs(vPitP.zy - pitC - vec2(pitWall * (pitS.x + 0.17), -0.42)) - vec2(0.055, 0.036);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.77, 0.72), 1.0 - smoothstep(-0.002, 0.002, max(pitL.x, pitL.y)));
      }
    } else if (pitAbs.z > 0.6 && vPitP.z < 0.0) {
      vec2 pitD = abs(vPitP.xy - vec2(0.0, 1.8)) - vec2(1.28, 0.92);
      float pitEdge = max(pitD.x, pitD.y);
      diffuseColor.rgb *= 1.0 + 0.15 * (1.0 - smoothstep(-0.004, 0.004, pitEdge));
      diffuseColor.rgb *= 1.0 - 0.26 * (1.0 - smoothstep(0.0, 0.014, abs(pitEdge)));
    }
  #endif

  float pitFw = max(sqrt(length(dFdx(pitX)) * length(dFdy(pitX))), 1e-6);
  vec3 pitA1 = vPitP * 1.33 + vec3(1.7, 4.1, 9.2);
  vec3 pitA2 = vPitP.zxy * 3.71 + vec3(7.3, 2.2, 5.9);
  float pitN1 = dot(sin(pitA1), cos(pitA1.zxy)) / 1.5;
  float pitN2 = dot(sin(pitA2), cos(pitA2.zxy)) / 1.5;
  float pitCluster = pitN1 * 0.68 + pitN2 * 0.32;
  pitPatch = smoothstep(-0.15, 0.5, pitN1);
  float pitFrontA = (uPitGrow - distance(vPitP, uPitSeedA)) / uPitFeather;
  float pitFrontB = (uPitGrowB - distance(vPitP, uPitSeedB)) / uPitFeather;
  pitG = max(pitFrontA, pitFrontB) + pitCluster * uPitIslands;
  pitOpen *= 1.0 + uPitBreath * 0.05 + uPitMove * 0.1 * sin(distance(vPitP, uPitSeedA) * 1.9 - uPitTime * 0.8);
  if (pitG > -0.2) {
    float pitS2 = pitShow(0.022, pitFw);
    float pitS1 = pitShow(0.05, pitFw);
    float pitS0 = pitShow(0.105, pitFw);
    pitLayer(pitX, pitN, 0.022, 11.0, -0.05, 0.9, 0.25, pitG, pitOpen, pitS2, pit);
    pitLayer(pitX, pitN, 0.05, 23.0, 0.4, 1.1, 0.25, pitG, pitOpen, pitS1, pit);
    pitLayer(pitX, pitN, 0.105, 37.0, 1.1 + (1.0 - pitPatch) * 1.6, 1.2, 0.25, pitG, pitOpen, pitS0, pit);
    pitCover = clamp(((1.0 - pitS2) * 0.26 * smoothstep(-0.05, 0.9, pitG) + (1.0 - pitS1) * 0.32 * smoothstep(0.45, 1.6, pitG) + (1.0 - pitS0) * 0.3 * smoothstep(1.2, 2.6, pitG)), 0.0, 0.72);
  }
  #ifndef PIT_FLOOR
  if (uPitPin > 0.0) {
    // the first holes, far apart: the size of a nail's, and always at least a pixel
    vec3 pitC0 = pitX / 0.41;
    vec2 pitBase = floor(pitC0.xy - 0.5);
    float pitChance = uPitPin * (0.1 + 0.55 * smoothstep(9.0, 1.0, distance(vPitP, uPitSeedA)));
    for (int k = 0; k < 4; k++) {
      vec2 pitCell = pitBase + vec2(k & 1, (k >> 1) & 1);
      vec4 pitRnd = pitHash(vec3(pitCell, 51.0));
      if (pitRnd.w > pitChance) continue;
      vec2 pitV = (pitC0.xy - (pitCell + 0.5 + (pitRnd.xy - 0.5) * 0.9)) * 0.41;
      float pitR = max(0.0095 + pitRnd.z * 0.009, pitFw * 0.75);
      float pitE = length(pitV) - pitR;
      if (pitE < pit.e) { pit.e = pitE; pit.v = vec3(pitV, 0.0); pit.r = pitR; pit.rnd = pitRnd; pit.lip = 0.0; }
    }
  }
  #endif
  #ifdef PIT_FLOOR
  float pitGloss = 1.0 - clamp(pitG, 0.0, 1.0) * 0.8;
  #endif
#endif

if (pit.e < 900.0) {
  float r = pit.r;
  float aa = max(pitFw, 0.00015);
  pitInside = 1.0 - smoothstep(-aa, aa, pit.e);
  float lipW = r * 0.75 + 0.002;
  float k = clamp(pit.e / lipW, 0.0, 1.0);
  float roll = clamp(-pit.e / (r * 0.3), 0.0, 1.0);
  float swell = r * 0.38 * pit.lip;
  float slope = pit.e > 0.0 ? -swell * 6.0 * k * (1.0 - k) / lipW : swell * 2.4 * roll / (r * 0.3);
  vec3 radial = pit.v / (length(pit.v) + 1e-6);
  pitGrad = radial * slope * (1.0 - pitInside * 0.6);
  pitRim = (pit.e > 0.0 ? (1.0 - k) * (1.0 - k) : 1.0) * pit.lip;
  pitPink = (1.0 - smoothstep(0.0, r * 1.8 + 0.004, max(pit.e, 0.0))) * pit.lip;

  // looking down into it: where the ray from the eye first meets its wall or its floor
  float vn = max(dot(pitView, pitN), 0.07);
  vec3 drift = -(pitView - pitN * dot(pitView, pitN)) / vn;
  float depth = r * (1.1 + 2.1 * pit.rnd.y);
  float curve = depth / (r * r);
  float qa = dot(drift, drift);
  float qb = dot(pit.v, drift);
  float qc = dot(pit.v, pit.v);
  float bq = 1.0 + 2.0 * curve * qb;
  float cq = curve * qc - depth;
  float sHit = clamp(-2.0 * cq / max(bq + sqrt(max(bq * bq - 4.0 * curve * qa * cq, 0.0)), 0.0001), 0.0, depth * 1.2);
  vec3 hit = pit.v + drift * sHit;
  float deep = clamp(sHit / depth, 0.0, 1.0);
  vec3 bowl = normalize(pitN - 2.0 * curve * hit);
  float lit = clamp(dot(bowl, pitLight), 0.0, 1.0);
  float core = smoothstep(0.22, 0.82, deep);
  pitColor = mix(uPitLip * mix(0.72, 0.2, smoothstep(0.0, 0.4, deep)), uPitDeep, core) * (0.42 + 1.5 * lit);
  float wet = pow(max(dot(reflect(-pitLight, bowl), pitView), 0.0), 28.0);
  pitShine += vec3(0.9, 0.86, 0.8) * wet * (1.0 - smoothstep(0.35, 0.9, deep)) * uPitGlint * 0.5 * pit.lip;

  // in some of them a seed, sitting in the dark, that is not quite still
  float seedKey = fract(pit.rnd.z * 37.1 + pit.rnd.x * 13.7);
  if (seedKey < 0.09 && r > 0.0035 && pit.lip > 0.5) {
    float ph = pit.rnd.x * 6.283;
    vec3 t1 = normalize(cross(pitN, vec3(0.31, 0.93, 0.19)));
    vec3 t2 = cross(pitN, t1);
    float wander = uPitMove * r * 0.22;
    float rise = uPitMove * pow(0.5 + 0.5 * sin(uPitTime * (0.4 + pit.rnd.y) + ph), 5.0);
    float sink = depth * (0.7 - 0.42 * rise) + depth * 0.1 * uPitBreath;
    float rs = r * (0.46 + 0.2 * pit.rnd.y);
    vec3 cs = t1 * cos(uPitTime * 0.37 + ph) * wander + t2 * sin(uPitTime * 0.29 + ph * 2.0) * wander - pitN * sink;
    vec3 dir = drift - pitN;
    vec3 oc = pit.v - cs;
    float a2 = dot(dir, dir);
    float b2 = dot(oc, dir);
    float c2 = dot(oc, oc) - rs * rs;
    float disc = b2 * b2 - a2 * c2;
    if (disc > 0.0) {
      float sp = (-b2 - sqrt(disc)) / a2;
      if (sp > 0.0 && sp < sHit) {
        vec3 ns = (pit.v + dir * sp - cs) / rs;
        float dif = clamp(dot(ns, pitLight), 0.0, 1.0);
        float facing = clamp(dot(ns, pitView), 0.0, 1.0);
        pitColor = vec3(0.74, 0.69, 0.55) * (0.2 + 1.2 * dif) * mix(0.35, 1.0, facing);
        float iris = smoothstep(0.9, 0.955, facing) * uPitLamp;
        pitColor = mix(pitColor, vec3(0.012, 0.01, 0.012), iris);
        float spec = pow(max(dot(reflect(-pitLight, ns), pitView), 0.0), 48.0);
        pitShine += vec3(1.0, 0.97, 0.92) * spec * 1.4 * uPitGlint;
        pitShine += uPitLamp * vec3(1.0, 0.52, 0.16) * (smoothstep(0.972, 0.995, facing) * 8.0 + 0.35 * (1.0 - iris));
      }
    }
  }
}
if (pitCover > 0.0) diffuseColor.rgb *= 1.0 - pitCover;
diffuseColor.rgb = mix(diffuseColor.rgb, uPitFlush, pitPink * 0.72);
diffuseColor.rgb = mix(diffuseColor.rgb, uPitLip, pitRim * 0.55);
diffuseColor.rgb = mix(diffuseColor.rgb, pitColor, pitInside);
`;

const FRAG_ROUGH = /* glsl */ `
roughnessFactor = mix(roughnessFactor, 0.34, max(pitRim, pitPink * 0.5));
roughnessFactor = mix(roughnessFactor, 0.22, pitInside);
`;

const FRAG_NORMAL = /* glsl */ `
normal = pitBump(normal, vec2(dot(pitGrad, dFdx(pitX)), dot(pitGrad, dFdy(pitX))), faceDirection);
`;

const FRAG_EMIT = /* glsl */ `
totalEmissiveRadiance += pitShine * pitInside;
`;

/** The glass ceiling as one long soft source, and the waxed floor's picture of the room. */
const FRAG_LIGHT = /* glsl */ `
{
  vec3 pitNw = inverseTransformDirection(normal, viewMatrix);
  vec3 pitToLay = vec3(0.0, ${f(HEIGHT - 0.05)}, clamp(vPitP.z, ${f(END_Z + 1)}, ${f(BACK_Z - 1)})) - vPitP;
  float pitLayD = length(pitToLay);
  vec3 pitLayL = pitToLay / max(pitLayD, 0.01);
  float pitWrap = max(dot(pitNw, pitLayL) * 0.75 + 0.25, 0.0);
  float pitLayI = mix(uPitLayNear, uPitLayFar, smoothstep(-3.0, -10.0, vPitP.z));
  vec3 pitLayC = vec3(0.93, 0.95, 0.93);
  vec3 pitE = normalize(pitEye);
  float pitUp = pitLayI * (0.2 + 0.5 * max(-pitNw.y, 0.0) / (1.0 + pitLayD * pitLayD));
  reflectedLight.directDiffuse += pitLayC * pitLayI * pitWrap / (pitLayD + 0.9) * BRDF_Lambert(material.diffuseContribution);
  reflectedLight.indirectDiffuse += pitLayC * pitUp * 0.35 * BRDF_Lambert(material.diffuseContribution);
  reflectedLight.directSpecular *= 1.0 - pitInside * 0.9;
  reflectedLight.indirectSpecular *= 1.0 - pitInside * 0.9;
  reflectedLight.directSpecular += pitLayC * pitLayI * 0.05 * pow(max(dot(pitNw, normalize(pitLayL + pitE)), 0.0), 70.0) * pitRim;
  #ifdef PIT_FLOOR
  vec3 pitR = reflect(-pitE, pitNw);
  if (pitR.y > 0.002) {
    float tCeil = (${f(HEIGHT)} - vPitP.y) / pitR.y;
    float tEnd = pitR.z < -0.0001 ? (${f(END_Z)} - vPitP.z) / pitR.z : 10000.0;
    float tBack = pitR.z > 0.0001 ? (${f(BACK_Z)} - vPitP.z) / pitR.z : 10000.0;
    float tSide = (uPitHalf - sign(pitR.x) * vPitP.x) / max(abs(pitR.x), 0.0001);
    float t = min(min(tCeil, min(tEnd, tBack)), tSide);
    vec3 h = vPitP + pitR * t;
    float lv = mix(uPitLayNear, uPitLayFar, smoothstep(-3.0, -10.0, h.z)) / 10.0;
    vec3 c = vec3(0.19, 0.2, 0.195) * lv;
    if (t == tCeil) {
      float glass = 1.0 - smoothstep(${f(PANEL_W / 2 - 0.35)}, ${f(PANEL_W / 2 + 0.25)}, abs(h.x));
      c = vec3(0.6, 0.68, 0.7) * lv * glass + vec3(0.05) * lv;
    } else if (t == tEnd) {
      float q = dot(h.xy - vec2(0.55, 1.35), h.xy - vec2(0.55, 1.35));
      c = vec3(0.2, 0.2, 0.19) * lv + vec3(1.0, 0.95, 0.85) * uPitKeyOn * exp(-q / 2.4);
    }
    float tMan = pitR.z < -0.0001 ? (${f(MAN_Z)} - vPitP.z) / pitR.z : -1.0;
    if (tMan > 0.0) {
      vec3 m = vPitP + pitR * tMan;
      float soft = 0.06 + 0.3 * m.y;
      float w = mix(mix(0.15, 0.27, smoothstep(0.8, 1.0, m.y)), 0.1, smoothstep(1.42, 1.54, m.y));
      c *= 1.0 - 0.9 * (1.0 - smoothstep(w - soft * 0.5, w + soft, abs(m.x))) * (1.0 - smoothstep(0.35, 1.7, m.y));
    }
    float fres = 0.05 + 0.85 * pow(1.0 - max(dot(pitE, pitNw), 0.0), 4.0);
    reflectedLight.indirectSpecular += c * fres * (1.0 - pitInside) * pitGloss * 0.85;
  }
  #endif
}
`;

type PitMode = 'wall' | 'floor' | 'body' | 'face';
const PIT_FLAGS: Record<PitMode, string> = {
  wall: '',
  floor: '#define PIT_FLOOR\n',
  body: '#define PIT_SOLID\n',
  face: '#define PIT_SOLID\n#define PIT_FACE\n',
};

/** Holes on a material of the room: what they are comes from `uniforms`, one program for each mode. */
function pitted<T extends MeshStandardMaterial>(material: T, mode: PitMode, uniforms: Record<string, IUniform>): T {
  const flags = PIT_FLAGS[mode];
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${flags}${VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_SWELL}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_PASS}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${flags}${FRAG_HEAD}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAG_FIELD}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMIT}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${FRAG_LIGHT}`);
  };
  material.customProgramCacheKey = () => `holes-${mode}`;
  return material;
}

/** A box with UVs in meters, placed where it stands. */
function slab(w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(n.getX(i)) > 0.5) uv.setXY(i, p.getZ(i), p.getY(i));
    else if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, p.getX(i), p.getZ(i));
    else uv.setXY(i, p.getX(i), p.getY(i));
  }
  g.setAttribute('uv1', uv.clone());
  g.translate(x, y, z);
  return g;
}

/** The stepped plaster under the ceiling and the plain board at the floor, along a wall lying in the x or the z direction. */
function moulding(along: 'x' | 'z', length: number, center: number, wall: number, inward: number, steps: readonly (readonly [number, number, number])[]): BufferGeometry {
  return mergeGeometries(
    steps.map(([y, h, d]) => (along === 'z' ? slab(d, h, length, wall + (inward * d) / 2, y + h / 2, center) : slab(length, h, d, center, y + h / 2, wall + (inward * d) / 2))),
  );
}

const CORNICE = [
  [3.92, 0.14, 0.05],
  [4.06, 0.08, 0.1],
  [4.14, 0.07, 0.17],
  [4.21, 0.32, 0.05],
] as const;
const SKIRTING = [[0, 0.19, 0.022]] as const;

/** Frosted glass in its lead, with what has died on it. */
function milkGlass(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const random = randomFrom(41);
  g.fillStyle = '#c9cecb';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 34; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = 30 + random() * 80;
    const blot = g.createRadialGradient(x, y, 0, x, y, r);
    const tone = random() < 0.5 ? '255,255,250' : '120,124,116';
    blot.addColorStop(0, `rgba(${tone},0.13)`);
    blot.addColorStop(1, `rgba(${tone},0)`);
    g.fillStyle = blot;
    g.fillRect(0, 0, size, size);
  }
  g.strokeStyle = 'rgba(34,38,36,0.92)';
  g.lineWidth = 4;
  g.beginPath();
  for (let i = 0; i <= 4; i++) {
    g.moveTo((i * size) / 4, 0);
    g.lineTo((i * size) / 4, size);
    g.moveTo(0, (i * size) / 4);
    g.lineTo(size, (i * size) / 4);
  }
  g.stroke();
  g.fillStyle = 'rgba(24,22,20,0.75)';
  for (let i = 0; i < 26; i++) {
    g.beginPath();
    g.ellipse(random() * size, random() * size, 1 + random() * 1.5, 0.6 + random(), random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function ramp(s: number, a: number, b: number): number {
  const x = Math.min(1, Math.max(0, (s - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

function follow(curve: readonly number[], s: number): number {
  if (s <= curve[0]) return curve[1];
  for (let i = 2; i < curve.length; i += 2) {
    if (s <= curve[i]) return curve[i - 1] + ((curve[i + 1] - curve[i - 1]) * (s - curve[i - 2])) / (curve[i] - curve[i - 2]);
  }
  return curve[curve.length - 1];
}

const UP = new Vector3(0, 1, 0);

/**
 * A long pale gallery and an old man looking at a blank wall. A few nail holes. Then more, and then the wall,
 * the ceiling, the floor to your feet, his jacket, his neck: pits in meter space, each one really a hole in the
 * surface you can see down into, some with a pale thing sitting in the dark. He turns, slowly. His face is all of
 * it, and it breathes. One long silence before he turns; and behind you the same old man, always as far away.
 */
export default class Holes extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x14181a, density: 0.01 },
    env: 'evening',
    envIntensity: 0.12,
    sky: 0,
    grade: { exposure: 1.25, saturation: 0.8, warmth: 0.02, tint: 0, flare: 0.002 },
  };
  film = { bloom: 0.5, bloomFrom: 0.8, grain: 0.32, scratches: 0.06, flicker: 0.012, weave: 0.0004 };
  focus = 8;
  aperture = 2.5;
  control = { look: true, scroll: true, hurry: 2 };
  drift = 0.6;

  private readonly common = {
    uPitGrowB: { value: 0 },
    uPitPin: { value: 0 },
    uPitOpen: { value: 1 },
    uPitMove: { value: 0 },
    uPitLamp: { value: 0 },
    uPitBreath: { value: 0 },
    uPitTime: { value: 0 },
    uPitLayFar: { value: 12 },
    uPitLayNear: { value: 7 },
    uPitHalf: { value: HALF_WIDE },
    uPitKeyOn: { value: 1 },
    uPitGlint: { value: 1 },
    uPitSwell: { value: 0 },
    uPitScale: { value: 1 },
    uPitFeet: { value: 0 },
    uPitBody: { value: 1 },
    uPitSeedB: { value: new Vector3(0, 1.5, BACK_Z) },
    uPitOrigin: { value: new Vector3() },
    uPitKey: { value: new Vector3(KEY_AT[0], KEY_AT[1], KEY_AT[2]) },
    uPitKeyW: { value: new Vector3() },
  };
  private readonly wallGrow = { value: 0 };
  private readonly floorGrow = { value: 0 };
  private readonly bodyGrow = { value: 0 };
  private readonly left = new Group();
  private readonly right = new Group();
  private readonly glassNear: MeshBasicMaterial;
  private readonly glassFar: MeshBasicMaterial;
  private readonly key;
  private readonly faceLight;
  private readonly mixer: AnimationMixer;
  private readonly clipLength: number;
  private readonly head: Bone;
  private readonly other: Crowd;
  private readonly otherShadow: Mesh;
  private otherZ = BEHIND_GAP;
  private readonly clocks: { value: number }[] = [];
  private readonly eye: RoomPose = { position: new Vector3(), yaw: 0, pitch: 0, roll: 0, fov: 40 };
  private readonly headAt = new Vector3();
  /** Where the light that shapes his holes comes from: the key, then the light on his face. */
  private readonly keyFrom = new Vector3();
  private readonly faceFrom = new Vector3();
  private readonly q0 = new Quaternion();
  private readonly q1 = new Quaternion();
  private readonly q2 = new Quaternion();
  /** The head as the clip leaves it: a mixer writes a bone only when the clip has changed it. */
  private readonly headPose = new Quaternion();
  private museum: RoomVoice | null = null;
  private drone: RoomVoice | null = null;
  private seeds: RoomVoice | null = null;
  private dense: RoomVoice | null = null;

  constructor(ctx: RoomContext) {
    super(ctx);
    const kit = this.kit;
    const b = this.build;
    const o = this.origin;
    const c = this.common;
    c.uPitOrigin.value.copy(o);
    this.keyFrom.set(KEY_AT[0] + o.x, KEY_AT[1] + o.y, KEY_AT[2] + o.z);
    c.uPitKeyW.value.copy(this.keyFrom);

    const palette = (flush: number, lip: number, deep: number) => ({
      uPitFlush: { value: new Color(flush) },
      uPitLip: { value: new Color(lip) },
      uPitDeep: { value: new Color(deep) },
    });
    const wallU = {
      ...c,
      ...palette(0xc49a86, 0xe6d9c0, 0x170607),
      uPitGrow: this.wallGrow,
      uPitFeather: { value: 1.5 },
      uPitIslands: { value: 0.85 },
      uPitSeedA: { value: new Vector3(0, 1.45, END_Z) },
    };
    const floorU = { ...wallU, ...palette(0x8f6a58, 0xc9b49a, 0x0e0405), uPitGrow: this.floorGrow, uPitSeedA: { value: new Vector3(0, 0, MAN_Z) }, uPitPin: { value: 0 } };
    const clothU = { ...c, ...palette(0x24211f, 0x4e4843, 0x070203), uPitGrow: this.bodyGrow, uPitGrowB: { value: 0 }, uPitFeather: { value: 0.2 }, uPitIslands: { value: 0.7 }, uPitSeedA: { value: new Vector3(0, 1.42, -0.1) }, uPitPin: { value: 0 } };
    const skinU = { ...clothU, ...palette(0x9a6f5e, 0xdccdb8, 0x120405) };

    // the architecture: everything but the glass is the same plaster, and it can all go the same way
    const plaster = pitted(kit.surface('plaster_gallery', 3.2, { color: new Color(0xe9e4d8), roughness: 0.9 }), 'wall', wallU);
    const dark = pitted(kit.surface('plaster_gallery', 3.2, { color: new Color(0x30322f), roughness: 0.5 }), 'wall', wallU);
    const boards = pitted(kit.surface('wood_floor_dark', 1.6, { color: new Color(0x9a9894), roughness: 0.42 }), 'floor', floorU);
    const zc = (END_Z + BACK_Z) / 2;
    const length = BACK_Z - END_Z;
    this.root.add(kit.floor(-HALF_WIDE - 1, HALF_WIDE + 1, END_Z - 0.5, BACK_Z + 0.5, 0, boards));
    const ceiling = kit.wall(2 * HALF_WIDE + 2, length + 1, plaster, 0, zc);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, HEIGHT, zc);
    this.root.add(ceiling);
    for (const [wall, turn, z] of [
      [this.left, Math.PI / 2, DOOR_LEFT],
      [this.right, -Math.PI / 2, DOOR_RIGHT],
    ] as const) {
      const inward = wall === this.left ? 1 : -1;
      const plane = kit.wall(length + 1, HEIGHT + 0.6, plaster, zc, (HEIGHT + 0.6) / 2);
      plane.rotation.y = turn;
      plane.position.set(0, (HEIGHT + 0.6) / 2, zc);
      wall.add(plane);
      wall.add(this.solid(moulding('z', length + 1, zc, 0, inward, CORNICE), plaster));
      wall.add(this.solid(moulding('z', length + 1, zc, 0, inward, SKIRTING), dark));
      const door = b.door(0, z, inward > 0 ? '+x' : '-x', wall, { color: 0x8a8578 });
      this.paintDoor(door.root, door.beyond, plaster);
      this.root.add(wall);
    }
    for (const [z, turn, inward] of [
      [END_Z, 0, 1],
      [BACK_Z, Math.PI, -1],
    ] as const) {
      const plane = kit.wall(2 * HALF_WIDE + 2, HEIGHT + 0.6, plaster, 0, (HEIGHT + 0.6) / 2);
      plane.rotation.y = turn;
      plane.position.set(0, (HEIGHT + 0.6) / 2, z);
      this.root.add(plane);
      this.root.add(this.solid(moulding('x', 2 * HALF_WIDE + 2, 0, z, inward, CORNICE), plaster));
      this.root.add(this.solid(moulding('x', 2 * HALF_WIDE + 2, 0, z, inward, SKIRTING), dark));
    }
    const backDoor = b.door(0, BACK_Z, '-z', this.root, { color: 0x8a8578 });
    this.paintDoor(backDoor.root, backDoor.beyond, plaster);

    // the ceiling: plaster beams and the glass between them
    const beams: BufferGeometry[] = [];
    const nearGlass: BufferGeometry[] = [];
    const farGlass: BufferGeometry[] = [];
    for (let i = 0; i <= 6; i++) beams.push(slab(2 * HALF_WIDE + 2, 0.36, 0.44, 0, HEIGHT - 0.18, END_Z + i * BAY));
    for (let i = 0; i < 6; i++) {
      const z = END_Z + (i + 0.5) * BAY;
      const glass = new PlaneGeometry(PANEL_W, PANEL_L);
      glass.rotateX(Math.PI / 2);
      glass.translate(0, HEIGHT - 0.02, z);
      const level = [1, 0.96, 0.92, 0.62, 0.3, 0.72][i];
      glass.setAttribute('color', new Float32BufferAttribute(new Array(glass.getAttribute('position').count * 3).fill(level), 3));
      (i < 3 ? farGlass : nearGlass).push(glass);
    }
    this.root.add(this.solid(mergeGeometries(beams), plaster));
    const panel = milkGlass();
    this.glassFar = new MeshBasicMaterial({ map: panel, vertexColors: true, fog: false });
    this.glassNear = new MeshBasicMaterial({ map: panel, vertexColors: true, fog: false });
    this.root.add(new Mesh(mergeGeometries(farGlass), this.glassFar), new Mesh(mergeGeometries(nearGlass), this.glassNear));

    // the old man: a real body, every frame of its turn, and a real head for the face he will show
    const spec: FigureSpec = { avatar: 'figure_man', clip: TURN_CLIP, time: 0, face: 'keep', tint: SUIT_TINT, bleach: SUIT_BLEACH };
    const hero = kit.figures.hero(spec);
    const body = hero.root.children[0];
    this.mixer = new AnimationMixer(body);
    const clip = kit.model('figure_man').animations.find((a) => a.name === TURN_CLIP)!;
    this.clipLength = clip.duration;
    this.mixer.clipAction(clip).play();
    this.head = hero.bone('Bip01_Head')!;
    hero.root.rotation.y = Math.PI;
    hero.root.position.set(0, 0, MAN_Z);
    this.root.add(hero.root);

    const meshes: SkinnedMesh[] = [];
    body.traverse((m) => {
      if ((m as SkinnedMesh).isSkinnedMesh) meshes.push(m as SkinnedMesh);
    });
    const named = (m: SkinnedMesh) => (m.material as Material).name;
    const heads = meshes.filter((m) => /head/.test(named(m))).sort((p, q) => q.geometry.index!.count - p.geometry.index!.count);
    const [faceOfFile, skull, ...smallBits] = heads;
    const point = new Vector3();
    const measure = (mesh: SkinnedMesh, box: Box3) => {
      mesh.skeleton.update();
      const p = mesh.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        point.fromBufferAttribute(p, i);
        mesh.applyBoneTransform(i, point);
        point.applyMatrix4(mesh.matrixWorld);
        box.expandByPoint(point);
      }
    };
    // stand him on the floor, exactly where he stands
    this.mixer.setTime(0);
    this.root.updateMatrixWorld(true);
    const whole = new Box3();
    for (const m of meshes) measure(m, whole);
    const hips = body.getObjectByName('Bip01')!.getWorldPosition(new Vector3()).sub(o);
    hero.root.position.set(-hips.x, -(whole.min.y - o.y), MAN_Z * 2 - hips.z);
    this.root.updateMatrixWorld(true);

    // the body's own space, the one its holes are fixed in: z is up in the file, and it stands on its feet
    const rest = new Box3();
    for (const m of meshes) {
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) rest.expandByPoint(point.fromBufferAttribute(p, i).applyMatrix4(m.bindMatrix));
    }
    c.uPitBody.value = (whole.max.y - whole.min.y) / (rest.max.z - rest.min.z);
    c.uPitFeet.value = -rest.min.z;

    faceOfFile.visible = false;
    for (const m of smallBits) m.visible = false;
    const skullSkin = new Box3();
    measure(faceOfFile, skullSkin);
    skullSkin.translate(point.copy(o).negate());
    const front = skullSkin.min.z;
    const faceScan = kit.prop('mri_head', [(skullSkin.min.x + skullSkin.max.x) / 2, skullSkin.min.y + SCAN_H / 2 + 0.006, front - 0.006 + (SCAN_H * 0.9) / 2], { scale: SCAN_H, anchor: 'center', rotation: [0, 180, 0] }, this.root);
    const paintedFace = kit.surface('plaster_gallery', 3.2, { color: new Color(0xb79d8a), roughness: 0.58 });
    let scanScale = 1;
    faceScan.traverse((m) => {
      if ((m as Mesh).isMesh) {
        scanScale = m.getWorldScale(point).y;
        m.castShadow = true;
      }
    });
    const faceU = { ...skinU, uPitScale: { value: scanScale } };
    kit.paint(faceScan, pitted(paintedFace, 'face', faceU));
    this.root.updateMatrixWorld(true);
    this.head.attach(faceScan);

    for (const m of meshes) {
      if (!m.visible) continue;
      m.castShadow = true;
      if (/opacity/.test(named(m))) continue;
      m.material = pitted((m.material as MeshStandardMaterial).clone(), 'body', m === skull ? skinU : clothU);
    }
    b.contactShadow(0, MAN_Z, 0.62, this.root, 0.72);

    // where his face will be when he has turned: the eye goes there
    const sec = (at: number) => at / this.seconds;
    this.mixer.setTime(this.clipLength - 0.001);
    this.root.updateMatrixWorld(true);
    const face = faceScan.getWorldPosition(new Vector3()).sub(o);
    this.mixer.setTime(0);
    this.headPose.copy(this.head.quaternion);
    const nose = face.z + SCAN_H * 0.45;
    this.keys = [
      { t: 0, at: [0, EYE, 0], yaw: 0, pitch: 1.6, fov: 40 },
      { t: sec(8), at: [0, EYE, -1.75], yaw: 0, pitch: 1.4, fov: 40 },
      { t: sec(16), at: [0, EYE, -3.55], yaw: 0, pitch: 0.4, fov: 39 },
      { t: sec(22), at: [0, EYE, -5], yaw: 0, pitch: -4, fov: 39 },
      { t: sec(25.6), at: [0.02, EYE - 0.02, -5.85], yaw: 0, pitch: -15, fov: 41 },
      { t: sec(29.5), at: [0.04, EYE, -6.72], yaw: 0, pitch: 3.5, fov: 36 },
      { t: sec(32), at: [0.02, EYE + 0.01, -7.05], yaw: 0, pitch: 6, fov: 33 },
      { t: sec(35.4), at: [face.x * 0.5, (EYE + face.y) / 2, -7.5], yaw: 0, pitch: 4, fov: 33 },
      { t: sec(SHUTTER_AT), at: [face.x, face.y - 0.012, nose + FACE_AT_SHUTTER], yaw: 0, pitch: 1.4, fov: 33 },
      { t: sec(CUT_AT), at: [face.x, face.y - 0.008, nose + FACE_AT_CUT], yaw: 0, pitch: 1.1, fov: 34 },
      { t: 1, at: [face.x, face.y - 0.008, nose + FACE_AT_CUT], yaw: 0, pitch: 1.1, fov: 34 },
    ];

    // and behind the viewer the same old man, looking at the other wall, never nearer, never further
    this.other = kit.figures.crowd(spec, 1);
    this.other.root.traverse((m) => {
      const mesh = m as Mesh;
      if (!mesh.isMesh) return;
      const name = (mesh.material as Material).name;
      if (/opacity/.test(name)) return;
      mesh.material = pitted((mesh.material as MeshStandardMaterial).clone(), 'body', /head/.test(name) ? skinU : clothU);
    });
    this.other.set(0, 0, 0, this.otherZ, 0);
    this.other.commit();
    this.root.add(this.other.root);
    this.otherShadow = b.contactShadow(0, this.otherZ, 0.6, this.root, 0.7);

    this.key = this.spot([KEY_AT[0], KEY_AT[1], KEY_AT[2]], [KEY_TO[0], KEY_TO[1], KEY_TO[2]], 0xfff0dd, KEY_POWER, KEY_ANGLE, 0.75);
    this.faceFrom.set(face.x - 1.25 + o.x, face.y + 0.75 + o.y, nose + 0.85 + o.z);
    this.faceLight = this.spot([face.x - 1.25, face.y + 0.75, nose + 0.85], [face.x, face.y, face.z], 0xfff4e6, 0, 18, 0.7);
    this.spots = [this.key, this.faceLight, this.spot([0.4, 3.4, BACK_Z - 5], [0, 1.2, BACK_Z], 0xcfdcdc, 16, 26, 0.8)];

    this.clocks.push(b.motes(150, { x: [-HALF_NARROW, HALF_NARROW], y: [0.2, 3.7], z: [END_Z + 0.4, 2] }, this.root, { strength: 0.55 }).time);

    this.beat(0, () => {
      this.museum = this.sound.bed('rooms/museum_tone.mp3', { gain: 0.14 });
    });
    STEPS.forEach((at, i) => this.beat(at, () => this.sound.play(`rooms/step_gallery_${(i % 3) + 1}.mp3`, { gain: 0.2, pan: i % 2 === 0 ? -0.12 : 0.12, reverb: 0.4 })));
    for (const [at, file, pan, gain] of TICKS) this.beat(at, () => this.sound.play(`rooms/${file}.mp3`, { gain, pan }));
    this.beat(12, () => {
      this.drone = this.sound.bed('rooms/dream_drone_low.mp3', { gain: 0.07, fade: 9 });
    });
    this.beat(14, () => {
      this.seeds = this.sound.bed('rooms/seed_clicks.mp3', { gain: 0.07, fade: 5 });
    });
    this.beat(20, () => this.seeds?.gain(0.2, 4));
    this.beat(24, () => this.seeds?.gain(0.3, 2));
    this.beat(26, () => {
      this.seeds?.gain(0.05, 3);
      this.dense = this.sound.bed('rooms/seed_clicks_dense.mp3', { gain: 0.3, fade: 3 });
    });
    this.beat(HUSH_AT, () => {
      this.seeds?.gain(0, 0.7);
      this.dense?.gain(0, 0.7);
      this.drone?.gain(0, 0.7);
      this.museum?.gain(0, 0.7);
    });
    this.beat(STEP_BEHIND, () => this.sound.play('rooms/step_gallery_2.mp3', { gain: 0.1, lowpass: 1800, reverb: 0.7 }));
    this.beat(TURN_FROM + 0.2, () => this.sound.play('rooms/coat_move.mp3', { gain: 0.4, reverb: 0.1 }));
    this.beat(BREATH_AT, () => this.sound.bed('rooms/breath_open_mouth.mp3', { gain: 0.22, fade: 2 }));
    this.beat(SHUTTER_AT, () => this.shutter());
    this.beat(SHUTTER_AT + 0.5, () => this.dense?.gain(0.1, 1.5));
    this.beat(LINE_AT, () => {
      this.say({ tr: 'On iki bin akşam. Her biri bir delik.', en: 'Twelve thousand evenings. Each one a hole.' }, 3.6);
      this.sound.play('rooms/holes_open.mp3', { gain: 0.5 });
      this.dense?.gain(0.3, 2);
    });
    this.beat(CUT_AT, () => this.sound.stopAll(0.02));
  }

  private solid(geometry: BufferGeometry, material: Material): Mesh {
    const mesh = new Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  private paintDoor(root: Group, beyond: Mesh, material: Material): void {
    root.traverse((m) => {
      if ((m as Mesh).isMesh && m !== beyond) (m as Mesh).material = material;
    });
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const c = this.common;
    c.uPitTime.value = frame.time;
    c.uPitPin.value = follow(PIN_CURVE, s);
    this.wallGrow.value = follow(BLOOM_CURVE, s);
    c.uPitGrowB.value = follow(BEHIND_CURVE, s);
    this.floorGrow.value = follow(FLOOR_CURVE, s);
    this.bodyGrow.value = follow(BODY_CURVE, s);
    c.uPitMove.value = ramp(s, 25, 28.5);
    c.uPitLayNear.value = follow(LAY_NEAR_CURVE, s);
    c.uPitLayFar.value = follow(LAY_FAR_CURVE, s);
    c.uPitOpen.value = 1 + 0.27 * ramp(s, LINE_AT, OPEN_TO);
    c.uPitLamp.value = ramp(s, LINE_AT + 0.3, OPEN_TO - 0.4);
    c.uPitGlint.value = 0.5 + 0.5 * ramp(s, 24, 34);
    const keyOn = follow(KEY_CURVE, s);
    c.uPitKeyOn.value = keyOn;
    this.key.intensity = KEY_POWER * keyOn;
    const onFace = ramp(s, TURN_FROM + 1, TURN_TO);
    this.faceLight.intensity = FACE_POWER * onFace;
    c.uPitKeyW.value.copy(this.keyFrom).lerp(this.faceFrom, onFace);
    this.glassNear.color.setScalar(follow(GLASS_NEAR_CURVE, s));
    this.glassFar.color.setScalar(follow(GLASS_FAR_CURVE, s));
    this.fear = follow(FEAR_CURVE, s);

    // the walls come in a little
    const half = HALF_WIDE + (HALF_NARROW - HALF_WIDE) * (REDUCED_MOTION ? 0.3 : ramp(s, 5, 34));
    c.uPitHalf.value = half;
    this.left.position.x = -half;
    this.right.position.x = half;

    // it breathes: every hole at once, and the skin of the face with them
    const on = ramp(s, BREATH_AT - 1, BREATH_AT + 1.2);
    const breath = Math.sin(((s - BREATH_AT) / BREATH_PERIOD) * Math.PI * 2) * on;
    c.uPitBreath.value = breath;
    c.uPitSwell.value = REDUCED_MOTION ? 0 : breath * 0.0032;

    // he turns as slowly as a very old man can, the head a little ahead of the rest
    const turn = ramp(s, TURN_FROM, TURN_TO);
    this.head.quaternion.copy(this.headPose);
    this.mixer.setTime(turn * (this.clipLength - 0.001));
    this.headPose.copy(this.head.quaternion);
    const lead = (Math.sin(Math.min(1, Math.max(0, (s - TURN_FROM) / (TURN_TO - TURN_FROM))) * Math.PI) * -0.42 + Math.sin(s * 0.17) * 0.012) * (REDUCED_MOTION ? 0.5 : 1);
    this.head.parent!.getWorldQuaternion(this.q0);
    this.q1.setFromAxisAngle(UP, lead);
    this.q2.copy(this.q0).invert().multiply(this.q1).multiply(this.q0);
    this.head.quaternion.premultiply(this.q2);
    this.movingShadows = s > TURN_FROM - 0.1 && s < TURN_TO + 0.1;

    // the lens follows his head
    this.pose(frame.t, this.eye);
    this.head.getWorldPosition(this.headAt);
    this.focus = Math.max(0.3, this.eye.position.distanceTo(this.headAt) - 0.08);
    this.aperture = 2.2 + 8 * ramp(s, 24, 36);
    this.drift = s > TURN_FROM ? 0.12 : 0.6;
    this.black = s >= CUT_AT ? 1 : 0;

    for (const k of this.clocks) k.value = frame.time;

    // he is always the same way behind you, and only moves when you cannot see him do it
    const eyeZ = this.eye.position.z - this.origin.z;
    const wanted = Math.min(eyeZ + BEHIND_GAP, BACK_Z - 1.1);
    if (Math.abs(wanted - this.otherZ) > 0.05 && this.unseen(frame, 0, 1, this.otherZ, 16)) {
      this.otherZ = wanted;
      this.other.set(0, 0, 0, wanted, 0);
      this.other.commit();
      this.otherShadow.position.z = wanted;
    }
  }
}
