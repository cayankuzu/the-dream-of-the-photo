import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  ClampToEdgeWrapping,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RGBADepthPacking,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  Vector4,
  type IUniform,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { SpotSpec } from '../../../config/nightmare.config';
import { randomFrom, type Crowd } from '../../dream/FigureKit';
import type { DreamLight } from '../../dream/LightPool';
import { DEG, lerp, range, smootherstep, wobble } from '../../math';
import { WARP_GLSL, warpUniforms } from '../../render/Warp';
import { GlideTrack } from '../../timeline/Track';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey, RoomPose } from '../Room';
import { Room } from '../Room';
import { PALETTE } from '../RoomKit';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['bed_gothic', 'dresser', 'nightstand', 'door_six', 'door_knob', 'door_frame', 'window_wood', 'frame_round', 'vase', 'mri_head', 'pillow'],
  materials: ['wood_floor_dark', 'linen_white'],
  sounds: [
    'rooms/bedroom_tone.mp3',
    'rooms/curtain_breathing.mp3',
    'rooms/draft_drone.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/door_creak_slow.mp3',
    'rooms/breath_calm.mp3',
    'rooms/breath_panic.mp3',
    'rooms/breath_labored.mp3',
    'rooms/breath_open_mouth.mp3',
    'rooms/breath_catch_1.mp3',
    'rooms/breath_catch_2.mp3',
    'rooms/breath_catch_3.mp3',
    'rooms/breath_catch_4.mp3',
    'rooms/whisper_gabble.mp3',
    'rooms/floor_creak_2.mp3',
    'rooms/floor_creak_4.mp3',
    'rooms/floor_step_near_1.mp3',
    'rooms/floor_step_near_3.mp3',
    'rooms/bed_weight_1.mp3',
    'rooms/bed_weight_2.mp3',
    'rooms/bed_weight_3.mp3',
    'rooms/bed_sit_soft.mp3',
    'rooms/bed_settle.mp3',
    'rooms/sheet_scooch.mp3',
    'rooms/blanket_move.mp3',
    'rooms/sniff_1.mp3',
    'rooms/hair_fingers.mp3',
    'rooms/hair_binaural.mp3',
    'rooms/chest_pressure.mp3',
    'rooms/throat_crackle.mp3',
    'rooms/mouth_wet_1.mp3',
    'rooms/mouth_click_2.mp3',
    'rooms/mouth_click_4.mp3',
    'rooms/heart_beat.mp3',
    'rooms/breath_in.mp3',
    'rooms/breath_out.mp3',
    'rooms/gasp_1.mp3',
    'rooms/pine_beetle_tick_1.mp3',
    'rooms/pine_beetle_tick_3.mp3',
    'rooms/clock_tock_far.mp3',
  ],
};

/** The room's walls (m), the eye at the origin looking along -Z. */
const L = -1.75;
const R = 1.5;
const FAR = -3.7;
const NEAR = 0.62;
const H = 2.6;
/** Where the bed stands: its foot at about -1.6, its head behind the eye. */
const BED_Z = -0.55;
const EYE: readonly [number, number, number] = [0, 0.68, 0];
/** The window in the left wall: center along the wall, center height, and its opening. */
const WINDOW = { z: -2.5, y: 1.62, w: 2.0, h: 1.46 };
const DOOR = { x: -0.05, w: 0.838, h: 1.981 };
/** The drapes: the height of the rod and of their hem (m). */
const ROD_Y = 2.47;
const HEM_Y = 0.1;
/** Wallpaper: pixels per meter of a wall's own paper, width of a strip (m), size of the pattern (m). */
const PAPER_PX = 340;
const PAPER_STRIP = 0.53;
const PAPER_TILE = 0.72;
/** How the quilt lies: the mattress's height (m). */
const QUILT_Y = 0.475;
/** The light of the morning. */
const DAWN_LIGHT = 0xe8dfd8;
/** The moon, what the lit wall gives back, and the air and film of the night. */
const MOON_LIGHT = 0xa9c6ec;
const MOON_FILL = 0x6f90b8;
const NIGHT_FOG = { color: 0x04070b, density: 0.02 };
const NIGHT_FILM = { bloom: 0.8, scratches: 0.06 };
/** The one bar of moon that crosses the chest, from where to where. */
const BAR_FROM = [-1.75, 1.75, -0.3] as const;
const BAR_TO = [0.35, 0.56, -0.3] as const;

/** The script (s). A blink starts at its time, is shut from BLINK_SHUT to BLINK_OPEN of it, and over at BLINK_END. */
const LINE_AWAKE = 3;
const LINE_CANNOT = 12;
const DOOR_OPENS = 16;
const DOOR_OPENED = 21.6;
const BREATH_FROM = 22;
const BLINKS: readonly number[] = [30, 37, 44, 50];
const BLINK_SHUT = 0.4;
const BLINK_OPEN = 0.8;
const BLINK_END = 1.2;
const WEIGHT_AT = 45.7;
const CLIMB_AT = 54;
const PRESS_AT = 58;
const FACE_AT = 62;
const SHUTTER_AT = 64;
const DARK_AT = 68;
const DAWN_AT = 72;
const STRAND_AT = 75.2;
const CEILING_AT = 77;
const LOOK_UP_AT = 77.5;
const CUT_AT = 79.5;
/** How high the viewer has to look (rad) for the thing on the ceiling to be seen by their own doing. */
const LOOKED_UP = 0.62;
/** The flash gun at the eye. */
const FLASH = 0.8;
/** The door's angle away from the room (rad): after it opens, after the first blink, and when someone stands before it. */
const DOOR_AJAR = [0.19, 0.31, 0.46] as const;
/** The figure standing: stretched past a person (height, girth), the height of its head at scale 1 (m), its body's color. */
const FIGURE_TALL = 1.2;
const FIGURE_SLIM = 0.92;
const FIGURE_HEAD = 1.59;
const FIGURE_TINT = 0x16171b;
/** Where it stands (x, z, m): before the door, then just past the foot of the bed. */
const STAND_DOOR = [-0.1, FAR + 0.16] as const;
const STAND_FOOT = [0.03, -2.25] as const;
/** On the ceiling: its head (height and z, m), how far the head is bowed to look at the eye (rad). */
const CEILING_HEAD = [1.5, -0.2] as const;
const CEILING_BOW = 1.33;
/** How far the head comes down in the last second (m). */
const CEILING_STOOP = 0.1;
/** The dark mass that kneels on you, ring by ring from the mattress up: height, how far forward, half width, half depth (m). */
const HUNCH: readonly (readonly [number, number, number, number])[] = [
  [-0.05, -0.34, 0.52, 0.44],
  [0.07, -0.33, 0.46, 0.4],
  [0.22, -0.3, 0.39, 0.34],
  [0.39, -0.25, 0.34, 0.28],
  [0.55, -0.18, 0.36, 0.24],
  [0.7, -0.1, 0.42, 0.22],
  [0.79, -0.04, 0.4, 0.19],
  [0.85, 0.02, 0.26, 0.14],
  [0.88, 0.06, 0.1, 0.08],
  [0.89, 0.07, 0.012, 0.012],
];
/** How big the mass is: when it kneels, when it is on your chest. */
const HUNCH_SCALE = [1.1, 1.4] as const;
/** Share of the hair drawn on the standing figure. */
const HAIR_STANDING = 0.2;
/** Tunnel vision at the shutter and at the last of it (1 is the edge of the picture). */
const TUNNEL = [0.74, 0.5] as const;
/** The head's size (the file is 1 m tall), and where the skull sits in it, in the file's own meters. */
const HEAD_SCALE = 0.3;
const SKULL = { y: 0.56, rx: 0.36, ry: 0.44, rz: 0.43, z: -0.03 } as const;
/** The hair: strands, segments of a strand, lengths (m), widths (m); every `body`-th strand is a soft one, `bodyWidth` times as wide. */
const HAIR = { strands: 3200, segments: 16, length: [0.6, 1.5], width: [0.00012, 0.00036], body: 5, bodyWidth: 14 } as const;
/** Share of the strands that grow from the crown, and are drawn first. */
const CROWN_SHARE = 0.3;
/** The strands that come down one by one in front of the eye; the first few are the ones seen at dawn. */
const DAWN_STRANDS = 3;
const FALL = { strands: 48, segments: 14, length: [0.38, 0.62], width: [0.00012, 0.00026] } as const;
/** Trying to move: the least seconds between two catches of the breath, how far the picture jumps (m). */
const CATCH_GAP = 1.5;
const SHUDDER = 0.0035;
/** The chest: how far it rises with a breath (m), breaths per second at rest and when it is hard to get. */
const CHEST = 0.012;
/** The heart in your ears under the weight: seconds between beats, first and last. */
const HEART_GAP = [0.98, 0.64] as const;
const BREATH_RATE = [0.19, 0.46] as const;

/**
 * Where the head is through the climb: seconds, then x, y, z (m), bow and tilt (rad; a bow of about 1 looks down
 * at the bed). It comes up over the top of the picture and back down into the light.
 */
const HEAD_WAY: readonly (readonly [number, number, number, number, number, number])[] = [
  [50.6, 0.0, 1.14, -1.02, 1.05, 0.14],
  [52.8, 0.0, 1.14, -1.02, 1.05, 0.14],
  [54.6, 0.0, 1.26, -0.86, 1.08, 0.1],
  [56.5, -0.03, 1.34, -0.68, 1.12, 0.07],
  [58.0, -0.02, 1.3, -0.54, 1.15, 0.05],
  [60.0, -0.01, 1.1, -0.44, 1.0, 0.02],
  [FACE_AT, 0.0, 0.92, -0.38, 0.55, 0.0],
  [SHUTTER_AT, 0.0, 0.76, -0.33, 0.2, 0.02],
  [DARK_AT, 0.0, 0.76, -0.24, 0.08, 0.03],
];
/** Where the mass is through the climb: its knees at this z and y (m), and how far it leans over (rad). */
const BODY_WAY: readonly (readonly [number, number, number, number])[] = [
  [50.6, -1.28, 0.5, 0.0],
  [52.8, -1.28, 0.5, 0.0],
  [54.6, -1.1, 0.53, 0.12],
  [56.5, -0.98, 0.56, 0.24],
  [58.0, -0.92, 0.58, 0.3],
  [FACE_AT, -0.84, 0.58, 0.42],
  [DARK_AT, -0.8, 0.56, 0.46],
];
/** The eye: dips and turns with what the bed takes. Seconds, y, pitch, roll (deg), fov. */
const EYE_WAY: readonly (readonly [number, number, number, number, number])[] = [
  [0, EYE[1], 9, 0, 50],
  [WEIGHT_AT, EYE[1], 9, 0, 50],
  [WEIGHT_AT + 0.35, EYE[1] - 0.021, 8.6, -0.3, 50],
  [WEIGHT_AT + 1.6, EYE[1] - 0.012, 8.8, -0.12, 50],
  [50.5, EYE[1] - 0.012, 9, -0.1, 50],
  [50.95, EYE[1] - 0.03, 10, 0.25, 49.5],
  [CLIMB_AT, EYE[1] - 0.026, 10.5, 0.1, 49],
  [55.1, EYE[1] - 0.036, 11, -0.25, 48],
  [56.5, EYE[1] - 0.04, 12, 0.2, 47],
  [PRESS_AT, EYE[1] - 0.046, 13, 0, 46],
  [PRESS_AT + 0.7, EYE[1] - 0.075, 14, 0.1, 45],
  [FACE_AT, EYE[1] - 0.08, 18, 0, 44],
  [SHUTTER_AT, EYE[1] - 0.08, 15, 0, 44],
  [DARK_AT - 0.01, EYE[1] - 0.085, 12, 0, 42],
  [DAWN_AT, EYE[1], 7, 0, 50],
  [LOOK_UP_AT, EYE[1], 7, 0, 50],
  [LOOK_UP_AT + 0.75, EYE[1], 80, 0, 50],
  [80, EYE[1], 82, 0, 46],
];

const SHAFT_VERT = /* glsl */ `
${WARP_GLSL}
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * dreamWarp(modelViewMatrix * vec4(position, 1.0));
}
`;
const SHAFT_FRAG = /* glsl */ `
uniform vec3 uShaft;
varying vec2 vUv;
void main() {
  float across = pow(max(0.0, 1.0 - abs(vUv.x - 0.5) * 2.0), 2.2);
  float along = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
  gl_FragColor = vec4(uShaft * across * along, 1.0);
}
`;

/** Eyelids and the tunnel: drawn on the lens, in its own meters. */
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
uniform float uTunnel;
varying vec2 vAt;
void main() {
  vec2 q = vAt / uHalf;
  // lids: the upper one comes down further than the lower comes up, both curved
  float open = uLid * (1.2 - 0.1 * q.x * q.x);
  float lids = max(smoothstep(open - 0.1, open + 0.08, q.y + 0.08 * (1.0 - uLid)), smoothstep(open * 0.9 - 0.1, open * 0.9 + 0.08, -q.y));
  // the tunnel: what the eye loses first, unevenly
  float wander = sin(atan(q.y, q.x) * 5.0 + 1.3) * 0.03 + sin(atan(q.y, q.x) * 11.0) * 0.015;
  float tunnel = smoothstep(uTunnel, uTunnel + 0.55, length(q * vec2(0.7, 1.0)) + wander);
  gl_FragColor = vec4(0.0, 0.0, 0.0, max(lids, tunnel));
}
`;

/** Hair: soft ribbons always facing the eye, rooted on a moving head, falling, lying on what they reach, parting around the eye. */
const HAIR_VERT = /* glsl */ `
${WARP_GLSL}
attribute vec3 aRoot;
attribute vec4 aStrand;
attribute vec3 aLook;
uniform vec3 uHead;
uniform mat3 uHeadTurn;
uniform float uDrop;
uniform float uTime;
uniform float uSway;
uniform float uFloor;
uniform float uLong;
uniform float uThin;
uniform float uPart;
uniform vec3 uEye;
uniform vec3 uAxis;
uniform vec3 uTent;
uniform float uBell;
uniform float uRelief;
uniform float uPuff;
uniform float uPartEase;
uniform float uRootFade;
uniform vec3 uMoon;
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec4 uCone;
varying vec3 vColor;
varying float vAcross;
varying float vAlpha;

vec3 strandAt(float s) {
  vec3 root = uHead + uHeadTurn * aRoot;
  vec3 away = root - uHead;
  vec3 p = root + vec3(away.x, 0.0, away.z) * (1.0 - exp(-s * 14.0)) * uPuff;
  p.y -= aLook.x * uLong * s;
  // the strands of a lock come together toward their ends (position holds the root of the lock)
  p.xz += (uHeadTurn * (position - aRoot)).xz * smoothstep(0.12, 0.85, s) * 0.85;
  // locks: waves shared by the strands of a lock, widening toward the ends
  float wide = s * (0.6 + 0.4 * s);
  p.x += (sin(s * 8.0 + aStrand.w) * 0.05 + sin(s * 19.0 + aStrand.w * 3.1) * 0.011) * wide + s * s * uSway * sin(uTime * 0.7 + aStrand.w + s * 2.0);
  p.z += (cos(s * 6.0 + aStrand.w * 1.7) * 0.05 + cos(s * 23.0 + aStrand.w * 2.3) * 0.011) * wide + s * s * uSway * cos(uTime * 0.53 + aStrand.w * 1.3 + s * 1.7);
  // let go from above, each lock falls away from the others like a bell
  p.xz += vec2(cos(aStrand.w), sin(aStrand.w)) * uBell * s * s;
  // parted: each strand keeps to its own side of the face
  p.x += sign(away.x + 0.003 * sin(aStrand.w * 11.0)) * uPart * smoothstep(0.0, uPartEase, s) * (0.6 + 0.4 * sin(aStrand.w * 3.0));
  // it lies on whatever it reaches
  float under = uFloor - p.y;
  if (under > 0.0) {
    p.y = uFloor + 0.003 + 0.004 * sin(aStrand.w * 9.0);
    vec2 flow = normalize(away.xz + vec2(sin(aStrand.w), cos(aStrand.w * 1.3)) * 0.05 + vec2(1e-3));
    p.xz += flow * under * 0.42 + vec2(-flow.y, flow.x) * sin(under * 21.0 + aStrand.w * 5.0) * 0.022;
  }
  // and it parts around the eye: a hollow, narrow at the eye and wider away from it, that leaves the roots alone
  vec3 a = p - uEye;
  float k = max(dot(a, uAxis), 0.0);
  vec3 radial = a - uAxis * k;
  float r = length(radial) + 1e-4;
  float want = (uTent.x + uTent.y * k) * uTent.z * smoothstep(0.02, 0.2, s);
  p += radial / r * (sqrt(r * r + want * want) - r);
  return p;
}

void main() {
  float reveal = smoothstep(aStrand.z, aStrand.z + 0.2, uDrop);
  float s = aStrand.x * reveal;
  vec3 p = strandAt(s);
  vec3 w = s > 0.97 ? p - strandAt(s - 0.025) : strandAt(s + 0.025) - p;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 tangentV = normalize(mat3(modelViewMatrix) * w + vec3(0.0, 1e-5, 0.0));
  vec3 side = normalize(cross(tangentV, normalize(-mv.xyz)) + vec3(1e-5, 0.0, 0.0));
  // very near the eye a strand is out of focus: wide and thin, like a scratch of light
  float near = smoothstep(0.26, 0.07, -mv.z);
  float body = step(0.001, aLook.y);
  float width = max(aLook.y * (1.0 - aStrand.x * 0.6), -mv.z * 0.00078) * (1.0 + near * 2.2 * (1.0 - body));
  mv.xyz += side * aStrand.y * width;
  vAcross = aStrand.y;
  // the wide faint strands are the soft body of the hair, the thin ones the light on it
  vAlpha = (0.22 + 0.5 * aLook.z) / (1.0 + near * 1.6) * smoothstep(1.0, 0.8, aStrand.x) * mix(1.0, uThin, aStrand.x) * clamp(0.00045 / aLook.y, 0.1, 1.0) * mix(1.0, smoothstep(0.12, 0.55, -mv.z), body) * mix(1.0, smoothstep(0.02, 0.45, aStrand.x), uRootFade);
  vec3 T = normalize(w + vec3(0.0, 1e-5, 0.0));
  float along = dot(T, uMoon);
  float lit = 1.0 - along * along;
  // the cone of moon across the chest: what enters it shines
  vec3 toP = normalize(p - uCone.xyz);
  float cone = uCone.w * smoothstep(0.965, 0.995, dot(toP, normalize(vec3(2.1, -1.19, 0.0))));
  float bright = (0.5 + 0.5 * aLook.z) * (0.6 + 0.4 * sin(aStrand.w * 5.0 + 1.0));
  // the side of the hair turned to the moon is lit, the far side goes into the dark
  float form = mix(1.0, 0.5 + 0.5 * clamp(dot((p - uHead).xz, -normalize(uMoon.xz)) / 0.16, -1.0, 1.0), uRelief);
  vColor = bright * (uShade + uLit * lit * lit * form + cone * lit * vec3(0.75, 0.88, 1.08));
  gl_Position = projectionMatrix * dreamWarp(mv);
}
`;
const HAIR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAcross;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(vColor, vAlpha * clamp(1.0 - vAcross * vAcross, 0.0, 1.0));
}
`;

const sstep = (a: number, b: number, v: number): number => {
  const x = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
/** A soft maximum: cloth bridges what lies under it. */
const smax = (a: number, b: number, k: number): number => {
  const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (a - b)) / k));
  return b + (a - b) * h + k * h * (1 - h);
};
const gauss = (d: number, s: number): number => Math.exp(-(d * d) / (s * s));

/** A limb tapering along a smooth path, to be merged (no uvs). */
function sinew(path: Vector3[], from: number, to: number, sides = 7, rows = 14): BufferGeometry {
  const curve = new CatmullRomCurve3(path);
  const frames = curve.computeFrenetFrames(rows, false);
  const positions: number[] = [];
  const index: number[] = [];
  const at = new Vector3();
  for (let j = 0; j <= rows; j++) {
    curve.getPointAt(j / rows, at);
    const r = from + ((to - from) * j) / rows;
    const n = frames.normals[j];
    const b = frames.binormals[j];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const c = Math.cos(a) * r;
      const d = Math.sin(a) * r;
      positions.push(at.x + n.x * c + b.x * d, at.y + n.y * c + b.y * d, at.z + n.z * c + b.z * d);
      if (j < rows) {
        const row = j * sides;
        const next = (i + 1) % sides;
        index.push(row + i, row + next, row + sides + i, row + next, row + sides + next, row + sides + i);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** One foot under the cloth: long slope toward the shin, a steep one toward the bed's end. */
const footAt = (x: number, z: number, atX: number, atZ: number, lean: number, peak: number): number => {
  const dz = z - atZ;
  const dx = x - atX - lean * dz;
  return peak * gauss(dx, 0.085) * gauss(dz, dz > 0 ? 0.22 : 0.07);
};

/** Height of the quilt over the mattress at (x, z): a body on its back under it, and its feet up at the far end. */
function quiltAt(x: number, z: number): number {
  // a thick quilt hardly shows the body: a low long swell, a little higher at the chest
  const trunk = 0.085 * gauss(x, 0.34) * sstep(-0.12, -0.34, z) * sstep(-1.1, -0.72, z);
  const shins = 0.07 * gauss(x, 0.27) * sstep(-0.72, -0.98, z) * sstep(-1.5, -1.32, z);
  const left = footAt(x, z, -0.15, -1.4, -0.14, 0.125);
  const right = footAt(x, z, 0.13, -1.37, 0.1, 0.112);
  let h = smax(smax(smax(trunk, shins, 0.05), left, 0.03), right, 0.03);
  // creases fanning from each toe toward the knees
  const fanL = Math.atan2(x + 0.145, z + 1.41);
  const fanR = Math.atan2(x - 0.125, z + 1.38);
  const reach = sstep(-1.48, -1.34, z) * sstep(-0.82, -1.18, z);
  h += reach * 0.011 * (Math.abs(Math.sin(fanL * 7 + 1.3)) + Math.abs(Math.sin(fanR * 6 + 0.4)) - 1);
  // the weight of it: a few long lazy folds, broken here and there, and off the sides of the mattress
  const u = x * 2.2 + z * 0.9 + Math.sin(z * 2.1 + x * 1.3) * 0.55;
  const v = -x * 1.4 + z * 1.8 + Math.sin(x * 2.7 - z * 1.1) * 0.5;
  h += 0.017 * Math.pow(0.5 + 0.5 * Math.sin(u * 5.2), 4) * sstep(0.08, 0.34, Math.abs(x) + Math.abs(z + 0.9) * 0.2);
  h += 0.012 * Math.pow(0.5 + 0.5 * Math.sin(v * 4.4 + 1.7), 4);
  h += 0.0035 * Math.sin(z * 17 + x * 9 + Math.sin(z * 5) * 2);
  h -= 0.17 * sstep(0.58, 0.74, Math.abs(x));
  // the sheet folded back over it, under the chin
  h += 0.016 * gauss(z + 0.2, 0.05);
  return h;
}

/** The quilt's cloth as seen flat: faded sateen, a border of stitched bands, a field of stitched lozenges (a yorgan). */
function drawQuilt(c: CanvasRenderingContext2D, w: number, h: number, bump: boolean): void {
  const random = randomFrom(5);
  c.fillStyle = bump ? '#909090' : '#57474a';
  c.fillRect(0, 0, w, h);
  if (!bump) {
    // sateen: long faint streaks and years of washing
    for (let i = 0; i < 900; i++) {
      c.fillStyle = `rgba(${random() < 0.5 ? '210,220,225' : '0,0,0'},${random() * 0.035})`;
      c.fillRect(random() * w, random() * h, 1 + random() * 3, 30 + random() * 220);
    }
    for (let i = 0; i < 24; i++) {
      const x = random() * w;
      const y = random() * h;
      const r = (0.05 + random() * 0.18) * h;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,0.2)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }
  }
  c.strokeStyle = bump ? '#3c3c3c' : 'rgba(186,196,200,0.3)';
  c.lineWidth = bump ? 5 : 1.8;
  const m = w * 0.075;
  // the border bands
  for (const inset of [0.5, 1, 1.5, 2.3, 2.9]) c.strokeRect(m * inset, m * inset, w - 2 * m * inset, h - 2 * m * inset);
  // the lozenges inside them
  c.save();
  c.beginPath();
  c.rect(m * 2.9, m * 2.9, w - 2 * m * 2.9, h - 2 * m * 2.9);
  c.clip();
  const step = w * 0.1;
  c.beginPath();
  for (let i = -24; i < 24; i++) {
    c.moveTo(i * step, 0);
    c.lineTo(i * step + h * 0.42, h);
    c.moveTo(i * step + h * 0.42, 0);
    c.lineTo(i * step, h);
  }
  c.stroke();
  c.restore();
  if (!bump) return;
  // the stitches pull the padding in: a soft valley along each line
  c.globalAlpha = 0.25;
  c.filter = 'blur(6px)';
  c.drawImage(c.canvas, 0, 0);
  c.filter = 'none';
  c.globalAlpha = 1;
}

/** The damask of the house, hung in strips by hand and left for fifty years. */
function drawPaper(c: CanvasRenderingContext2D, w: number, h: number, tile: CanvasImageSource, seed: number): void {
  const random = randomFrom(seed);
  const strip = PAPER_STRIP * PAPER_PX;
  const size = PAPER_TILE * PAPER_PX;
  for (let s = 0; s * strip < w; s++) {
    const x0 = s * strip;
    // no strip was hung quite in line with the last
    const shift = Math.floor(random() * 3) * size * 0.04 - size * 0.04;
    c.save();
    c.beginPath();
    c.rect(x0, 0, strip + 1, h);
    c.clip();
    for (let y = -size; y < h; y += size) for (let x = Math.floor(x0 / size) * size; x < x0 + strip; x += size) c.drawImage(tile, x, y + shift, size, size);
    // each strip faded by its own amount
    c.fillStyle = `rgba(${random() < 0.5 ? '0,0,0' : '150,175,170'},${random() * 0.07})`;
    c.fillRect(x0, 0, strip, h);
    c.restore();
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(x0, 0, 1.5, h);
    c.fillStyle = 'rgba(190,205,200,0.1)';
    c.fillRect(x0 + 1.5, 0, 1.2, h);
  }
  // soot toward the ceiling, damp toward the floor
  const soot = c.createLinearGradient(0, 0, 0, h);
  soot.addColorStop(0, 'rgba(0,0,0,0.55)');
  soot.addColorStop(0.2, 'rgba(0,0,0,0.05)');
  soot.addColorStop(0.62, 'rgba(0,0,0,0)');
  soot.addColorStop(1, 'rgba(10,8,4,0.5)');
  c.fillStyle = soot;
  c.fillRect(0, 0, w, h);
  // stains with a tide line
  for (let i = 0; i < 9; i++) {
    const x = random() * w;
    const y = random() * h * 0.7;
    const r = (0.1 + random() * 0.38) * PAPER_PX;
    const g = c.createRadialGradient(x, y, r * 0.55, x, y, r);
    g.addColorStop(0, 'rgba(20,16,8,0.2)');
    g.addColorStop(0.86, 'rgba(26,20,10,0.28)');
    g.addColorStop(0.95, 'rgba(120,110,80,0.2)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.save();
    c.translate(x, y);
    c.scale(1, 0.6 + random() * 1.1);
    c.translate(-x, -y);
    c.fillStyle = g;
    c.fillRect(x - r, y - r * 2, r * 2, r * 4);
    c.restore();
  }
  // long runs of damp down from the top
  for (let i = 0; i < 26; i++) {
    const x = random() * w;
    const y = random() * h * 0.3;
    const l = (0.3 + random() * 1.4) * PAPER_PX;
    const g = c.createLinearGradient(0, y, 0, y + l);
    g.addColorStop(0, `rgba(10,8,4,${0.1 + random() * 0.22})`);
    g.addColorStop(1, 'rgba(10,8,4,0)');
    c.fillStyle = g;
    c.fillRect(x, y, 1 + random() * 3.5, l);
  }
  // where a strip has come away from the plaster at its top
  for (let i = 0; i < 2; i++) {
    const x = Math.floor(random() * (w / strip)) * strip;
    const y = h * (0.08 + random() * 0.2);
    const a = (0.05 + random() * 0.07) * PAPER_PX;
    const b = (0.14 + random() * 0.26) * PAPER_PX;
    c.fillStyle = '#3f3e36';
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + a, y);
    c.lineTo(x + a * 0.2, y + b);
    c.lineTo(x, y + b * 1.1);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.lineWidth = 2;
    c.stroke();
  }
}

/** The plaster overhead: old paint, patches of old leaks, a crack that has been there longer than you. */
function drawCeiling(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(9);
  c.fillStyle = '#8b8a80';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 6000; i++) {
    c.fillStyle = `rgba(${random() < 0.5 ? '0,0,0' : '230,228,215'},${random() * 0.05})`;
    c.fillRect(random() * w, random() * h, 1 + random() * 4, 1 + random() * 4);
  }
  // a leak's edge is never a circle: many small rounds along a wandering line
  for (let k = 0; k < 4; k++) {
    let x = random() * w;
    let y = random() * h;
    let a = random() * Math.PI * 2;
    for (let i = 0; i < 26; i++) {
      a += (random() - 0.5) * 1.1;
      x += Math.cos(a) * 26;
      y += Math.sin(a) * 26;
      const r = 18 + random() * 46;
      const g = c.createRadialGradient(x, y, r * 0.4, x, y, r);
      g.addColorStop(0, 'rgba(70,54,30,0.03)');
      g.addColorStop(0.92, 'rgba(62,46,24,0.1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  c.strokeStyle = 'rgba(16,12,8,0.75)';
  for (let k = 0; k < 5; k++) {
    let x = random() * w;
    let y = random() * h;
    let a = random() * Math.PI * 2;
    c.lineWidth = 0.6 + random() * 1.6;
    c.beginPath();
    c.moveTo(x, y);
    for (let i = 0; i < 40; i++) {
      a += (random() - 0.5) * 0.9;
      x += Math.cos(a) * 14;
      y += Math.sin(a) * 14;
      c.lineTo(x, y);
    }
    c.stroke();
  }
}

/** What hangs on the wall: four at a table in sepia, and someone has gone over the faces with a nail. */
function drawPortrait(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(4);
  const g = c.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, w * 0.7);
  g.addColorStop(0, '#6f614c');
  g.addColorStop(1, '#1d1710');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#120d09';
  c.fillRect(w * 0.1, h * 0.62, w * 0.8, h * 0.4);
  for (let i = 0; i < 4; i++) {
    const x = w * (0.2 + i * 0.2);
    const y = h * (0.44 + (i % 2) * 0.02);
    c.fillStyle = '#0f0b07';
    c.beginPath();
    c.ellipse(x, y + h * 0.16, w * 0.085, h * 0.14, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#92846d';
    c.beginPath();
    c.ellipse(x, y, w * 0.05, h * 0.06, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(235,230,216,0.9)';
    c.lineWidth = w * 0.006;
    for (let n = 0; n < 16; n++) {
      c.beginPath();
      c.moveTo(x + (random() - 0.5) * w * 0.1, y + (random() - 0.5) * h * 0.11);
      c.lineTo(x + (random() - 0.5) * w * 0.1, y + (random() - 0.5) * h * 0.11);
      c.stroke();
    }
  }
}

/**
 * The face, as a flat picture over the head, front on (u across, v up the head): dead skin gone grey as an old
 * print, the eyes and most of what was above the mouth scored away with a nail down to the white of the paper.
 * On the bump map the scoring is cut in.
 */
function drawFace(c: CanvasRenderingContext2D, s: number, bump: boolean): void {
  const random = randomFrom(33);
  const X = (x: number) => (x / (2 * SKULL.rx) + 0.5) * s;
  const Y = (y: number) => (1 - y) * s;
  if (bump) {
    c.fillStyle = '#a0a0a0';
    c.fillRect(0, 0, s, s);
  } else {
    c.fillStyle = '#8e8a7e';
    c.fillRect(0, 0, s, s);
    // the print's blotches
    for (let i = 0; i < 40; i++) {
      const x = random() * s;
      const y = random() * s;
      const r = (0.02 + random() * 0.09) * s;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${random() < 0.6 ? '30,26,20' : '190,184,165'},${0.1 + random() * 0.2})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
    }
    for (let i = 0; i < 26000; i++) {
      c.fillStyle = `rgba(${random() < 0.5 ? '0,0,0' : '240,235,220'},${random() * 0.06})`;
      c.fillRect(random() * s, random() * s, 1 + random(), 1 + random());
    }
    const shade = (x: number, y: number, rx: number, ry: number, alpha: number) => {
      c.save();
      c.translate(X(x), Y(y));
      c.scale((rx / (2 * SKULL.rx)) * s, ry * s);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(6,4,3,${alpha})`);
      g.addColorStop(0.7, `rgba(10,7,5,${alpha * 0.8})`);
      g.addColorStop(1, 'rgba(10,7,5,0)');
      c.fillStyle = g;
      c.fillRect(-1, -1, 2, 2);
      c.restore();
    };
    // sockets, the shade under the nose, the mouth: a thin black line that opens as the jaw drops
    shade(-0.14, 0.53, 0.105, 0.055, 1);
    shade(0.14, 0.53, 0.105, 0.055, 1);
    shade(-0.14, 0.53, 0.07, 0.036, 1);
    shade(0.14, 0.53, 0.07, 0.036, 1);
    shade(0, 0.31, 0.07, 0.022, 0.4);
    shade(0, 0.245, 0.135, 0.04, 1);
  }
  // scored by hand, again and again, in the one way a hand goes
  c.lineCap = 'round';
  const score = (x: number, y: number, spreadX: number, spreadY: number, count: number, reach: number) => {
    for (let n = 0; n < count; n++) {
      const px = x + (random() - 0.5) * spreadX;
      const py = y + (random() - 0.5) * spreadY;
      const dir = -1 + random() * 0.55 + (random() < 0.22 ? 1.5 : 0);
      const len = (0.3 + random()) * reach;
      const deep = random();
      c.lineWidth = (0.0012 + random() * random() * 0.009) * s;
      if (bump) c.strokeStyle = `rgba(0,0,0,${0.35 + random() * 0.6})`;
      else c.strokeStyle = deep < 0.62 ? `rgba(226,221,206,${0.3 + random() * 0.65})` : deep < 0.9 ? `rgba(8,5,4,${0.35 + random() * 0.6})` : `rgba(58,10,8,${0.4 + random() * 0.5})`;
      c.beginPath();
      c.moveTo(X(px), Y(py));
      const bend = (random() - 0.5) * reach * 0.3;
      c.quadraticCurveTo(X(px + Math.cos(dir) * len * 0.5 + bend), Y(py + Math.sin(dir) * len * 0.5 + bend), X(px + Math.cos(dir) * len), Y(py + Math.sin(dir) * len));
      c.stroke();
    }
  };
  score(-0.14, 0.53, 0.2, 0.12, 90, 0.1);
  score(0.14, 0.53, 0.2, 0.12, 90, 0.1);
  score(0, 0.6, 0.62, 0.34, 190, 0.17);
  score(0, 0.4, 0.5, 0.24, 80, 0.14);
  score(0, 0.12, 0.42, 0.14, 26, 0.1);
  if (bump) return;
  // above the brow and round the back it is scalp under white hair, seen when the head is bowed
  c.save();
  c.beginPath();
  c.rect(0, 0, s, s * 0.13);
  c.ellipse(s / 2, Y(0.5), s * 0.5, s * 0.36, 0, 0, Math.PI, true);
  c.restore();
  const scalp = c.createLinearGradient(0, Y(1), 0, Y(0.8));
  scalp.addColorStop(0, 'rgba(20,20,22,0.96)');
  scalp.addColorStop(0.7, 'rgba(20,20,22,0.9)');
  scalp.addColorStop(1, 'rgba(20,20,22,0)');
  c.fillStyle = scalp;
  c.fillRect(0, 0, s, Y(0.8));
  for (let i = 0; i < 1500; i++) {
    const x = random() * s;
    const y = random() * Y(0.78);
    c.strokeStyle = `rgba(200,204,206,${0.08 + random() * 0.3})`;
    c.lineWidth = 0.6 + random() * 1.4;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + (x - s / 2) * 0.08 + (random() - 0.5) * 6, y + 26 + random() * 60);
    c.stroke();
  }
}

/** A strip of ribbons for the hair's shader: roots from `root(i)`, which says where a strand grows and how it looks. */
function strands(count: number, segments: number, root: (i: number, out: { at: Vector3; lockAt: Vector3; lock: number; length: number; width: number; bright: number; order: number }) => void): BufferGeometry {
  const positions = new Float32Array(count * (segments + 1) * 2 * 3);
  const roots = new Float32Array(count * (segments + 1) * 2 * 3);
  const strand = new Float32Array(count * (segments + 1) * 2 * 4);
  const looks = new Float32Array(count * (segments + 1) * 2 * 3);
  const index: number[] = [];
  const spec = { at: new Vector3(), lockAt: new Vector3(), lock: 0, length: 1, width: 0.001, bright: 1, order: 0 };
  let v = 0;
  for (let i = 0; i < count; i++) {
    root(i, spec);
    for (let k = 0; k <= segments; k++) {
      const along = k / segments;
      for (const side of [-1, 1]) {
        positions.set([spec.lockAt.x, spec.lockAt.y, spec.lockAt.z], v * 3);
        roots.set([spec.at.x, spec.at.y, spec.at.z], v * 3);
        strand.set([along, side, spec.order, spec.lock], v * 4);
        looks.set([spec.length, spec.width, spec.bright], v * 3);
        v++;
      }
      if (k < segments) {
        const a = v - 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('aRoot', new Float32BufferAttribute(roots, 3));
  g.setAttribute('aStrand', new Float32BufferAttribute(strand, 4));
  g.setAttribute('aLook', new Float32BufferAttribute(looks, 3));
  g.setIndex(index);
  return g;
}

/** What the hair's shader is told each frame. */
interface HairUniforms {
  uBell: { value: number };
  uRelief: { value: number };
  uPuff: { value: number };
  uPartEase: { value: number };
  uRootFade: { value: number };
  uHead: { value: Vector3 };
  uHeadTurn: { value: Matrix3 };
  uDrop: { value: number };
  uTime: { value: number };
  uSway: { value: number };
  uFloor: { value: number };
  uLong: { value: number };
  uThin: { value: number };
  uPart: { value: number };
  uEye: { value: Vector3 };
  uAxis: { value: Vector3 };
  uTent: { value: Vector3 };
  uMoon: { value: Vector3 };
  uLit: { value: Color };
  uShade: { value: Color };
  uCone: { value: Vector4 };
  [name: string]: IUniform;
}

const hairUniforms = (): HairUniforms => ({
  uBell: { value: 0 },
  uRelief: { value: 0 },
  uPuff: { value: 0.42 },
  uPartEase: { value: 0.35 },
  uRootFade: { value: 0 },
  uHead: { value: new Vector3() },
  uHeadTurn: { value: new Matrix3() },
  uDrop: { value: 2 },
  uTime: { value: 0 },
  uSway: { value: 0.015 },
  uFloor: { value: 0 },
  uLong: { value: 1 },
  uThin: { value: 1 },
  uPart: { value: 0 },
  uEye: { value: new Vector3(EYE[0], EYE[1], EYE[2]) },
  uAxis: { value: new Vector3(0, 0, -1) },
  uTent: { value: new Vector3(0, 0, 0) },
  uMoon: { value: new Vector3(0.82, -0.2, -0.52) },
  uLit: { value: new Color(0.6, 0.72, 0.9) },
  uShade: { value: new Color(0.02, 0.03, 0.04) },
  uCone: { value: new Vector4(BAR_FROM[0], BAR_FROM[1], BAR_FROM[2], 0) },
});

const place = new Matrix4();
const placeAt = new Vector3();
const placeScale = new Vector3();
const placeTurn = new Quaternion();
const turnEuler = new Euler();
const toFace = new Vector3();

/**
 * Sleep paralysis, the peak of the piece: a moonlit bedroom seen from the pillow, and nothing the viewer does moves
 * anything. Something is let in by the door and comes nearer only while the eye is shut, and at the end there is the
 * dawn, and the hands work again, and it is on the ceiling.
 */
export default class Karabasan extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: NIGHT_FOG.color, density: NIGHT_FOG.density },
    env: 'bathroom',
    envIntensity: 0.035,
    sky: 0,
    grade: { exposure: 1.25, saturation: 0.82, warmth: -0.04, tint: -0.01, flare: 0.002 },
  };
  control = { look: false, scroll: false, hurry: 1 };
  drift = 0;
  film = { bloom: NIGHT_FILM.bloom, bloomFrom: 0.55, bloomTint: [0.8, 0.92, 1.15] as const, grain: 0.4, scratches: NIGHT_FILM.scratches, weave: 0.0003, ghost: 0 };
  focus = 3.6;
  aperture = 3;
  fear = 0.2;

  private readonly draught = { value: 0.03 };
  private readonly shaftLight = { value: new Color(0x4a6488).multiplyScalar(0.06) };
  private readonly shaftBase = this.shaftLight.value.clone();
  private readonly moteTime: { value: number };
  private readonly moteColor: { value: Color };
  private readonly moteBase: Color;
  private readonly lid = { uHalf: { value: 0.03 }, uLid: { value: 1 }, uTunnel: { value: 1.6 } };
  private readonly quiltU = {
    uChest: { value: 0 },
    uDentA: { value: new Vector3(0, -1, 0) },
    uDentB: { value: new Vector3(0, -1, 0) },
    uDentC: { value: new Vector3(0, -1, 0) },
    uSag: { value: 0 },
  };

  private readonly hinge = new Object3D();
  private readonly moon: SpotSpec;
  private readonly bar: SpotSpec;
  private readonly fill: SpotSpec;
  private readonly flash: SpotSpec;
  private readonly nightSpots: readonly SpotSpec[];
  private readonly withFlash: readonly SpotSpec[];
  private readonly bounce: DreamLight[];
  private readonly under: DreamLight;
  private readonly side: DreamLight;
  private readonly nightSky: Mesh;
  private readonly dawnSky: Mesh;
  private readonly drapeGlow = { value: 0.55 };
  private readonly spiral: MeshStandardMaterial;
  private readonly stand: Crowd;
  private readonly hunch: Mesh;
  private readonly clinger: Mesh;
  private readonly head = new Group();
  private readonly face: Mesh;
  private readonly hollow: Mesh;
  private readonly hair: Mesh;
  private readonly hairU = hairUniforms();
  private readonly fall: Mesh;
  private readonly fallU = hairUniforms();
  private readonly hands: { root: Object3D; side: number }[] = [];
  private readonly headX: GlideTrack;
  private readonly headY: GlideTrack;
  private readonly headZ: GlideTrack;
  private readonly headBow: GlideTrack;
  private readonly headTilt: GlideTrack;
  private readonly bodyZ: GlideTrack;
  private readonly bodyY: GlideTrack;
  private readonly bodyLean: GlideTrack;

  private lastIdle = 1000;
  private sinceCatch = 10;
  private catchTurn = 0;
  private shudder = 0;
  private strain = 0;
  private breathPhase = 0;
  private sinceBeat = 0;
  private blinkUp = false;
  private heart = false;
  private tone: RoomVoice | null = null;
  private curtain: RoomVoice | null = null;
  private draft: RoomVoice | null = null;
  private breath: RoomVoice | null = null;
  private panic: RoomVoice | null = null;

  constructor(ctx: RoomContext) {
    super(ctx);
    const b = this.build;
    const k = this.kit;
    this.keys = EYE_WAY.map(([s, y, pitch, roll, fov]) => ({ t: Math.min(1, s / this.seconds), at: [EYE[0], y, EYE[2]] as const, yaw: 0, pitch, roll, fov }));
    const track = <T extends readonly number[]>(way: readonly T[], i: number) => new GlideTrack(way.map((w) => w[0]), way.map((w) => w[i]));
    this.headX = track(HEAD_WAY, 1);
    this.headY = track(HEAD_WAY, 2);
    this.headZ = track(HEAD_WAY, 3);
    this.headBow = track(HEAD_WAY, 4);
    this.headTilt = track(HEAD_WAY, 5);
    this.bodyZ = track(BODY_WAY, 1);
    this.bodyY = track(BODY_WAY, 2);
    this.bodyLean = track(BODY_WAY, 3);

    this.shell();

    // the bed, and on it your own body under the quilt
    k.prop('bed_gothic', [0, 0, BED_Z], { rotation: [0, 180, 0], castShadow: true }, this.root);
    this.root.add(this.quilt());
    this.pillow();
    k.prop('dresser', [R - 0.3, 0, -2.75], { rotation: [0, -90, 0], castShadow: true }, this.root);
    k.prop('nightstand', [-1.05, 0, 0.05], { rotation: [0, 90, 0] }, this.root);
    b.contactShadow(R - 0.3, -2.75, 0.9, this.root, 0.8);

    // on the dresser: the clock of the house, and dry twigs in a vase that throw their shadow on the paper
    const clock = b.clock(R - 0.34, 1.212, -2.45, this.root, 0.72);
    clock.root.rotation.y = -0.45;
    this.spiral = clock.spiral;
    k.prop('vase', [R - 0.3, 1.212, -3.12], { castShadow: true }, this.root);
    this.root.add(this.twigs(R - 0.3, 1.5, -3.12));
    this.portrait();
    this.door();

    // the night, and the dawn, outside the window
    this.nightSky = this.skyOutside('#1a2a44', '#48638c', '#2a3a54', true, 1.6);
    this.dawnSky = this.skyOutside('#6d7c8c', '#c9c6c2', '#e0cfc4', false, 1.7);
    this.dawnSky.visible = false;
    k.prop('window_wood', [L - 0.05, WINDOW.y - 0.75, WINDOW.z], { rotation: [0, 90, 0], castShadow: true }, this.root);
    this.curtains();

    // the moon: through the window, onto the far wall and the door; and one bar of it across the chest
    this.moon = this.spot([-4.75, 2.12, -0.9], [0.3, 1.25, FAR], MOON_LIGHT, 120, 24, 0.25);
    this.bar = this.spot(BAR_FROM, BAR_TO, MOON_LIGHT, 5, 13, 0.75);
    this.fill = this.spot([0.1, 1.5, -0.4], [0.1, 1.45, FAR], MOON_FILL, 1.8, 62, 1);
    this.flash = this.spot([EYE[0], EYE[1] + 0.02, EYE[2] + 0.04], [0, 0.72, -0.36], 0xdfe6ee, 0, 42, 0.8);
    this.nightSpots = [this.moon, this.bar, this.fill];
    this.withFlash = [this.moon, this.bar, this.flash];
    this.spots = this.nightSpots;
    // what the lit wall gives back; just enough that the dark has shapes in it
    this.bounce = [
      this.light([0.25, 1.05, -2.3], 0x7f9fc8, 0.9, 5),
      this.light([0.45, 1.9, -1.4], 0x5f80a8, 0.5, 5),
      this.light([-0.9, 1.6, -0.4], 0x5f80a8, 0.25, 4),
    ];
    this.under = this.light([0.08, 1.02, -0.26], 0xd8d4cc, 0, 2.2);
    this.side = this.light([0.55, 0.82, -0.12], 0x6f8fb8, 0, 2);
    b.glow(L - 0.2, 1.8, -2.6, 2.2, 0x8fb0e0, 0.35, this.root);
    this.root.add(this.shaft(new Vector3(L + 0.15, 1.6, -2.5), new Vector3(0.3, 1.25, FAR + 0.02), 1.0, 1.5));
    const motes = b.motes(70, { x: [-1.4, 0.9], y: [0.9, 2.2], z: [-3.5, -2.2] }, this.root, { strength: 0.28, color: 0xa9c6ec });
    this.moteTime = motes.time;
    this.moteColor = (motes.points.material as ShaderMaterial).uniforms.uColor as { value: Color };
    this.moteBase = this.moteColor.value.clone();

    // the one who comes
    const body = { avatar: 'figure_woman', tint: FIGURE_TINT, bleach: 1, white: false } as const;
    this.stand = k.figures.crowd({ ...body, clip: 'm_idle_roll_head_01', time: 0.2 }, 1);
    // its own head and hair are not wanted: it has another
    for (const part of this.stand.root.children as Mesh[]) {
      part.castShadow = true;
      part.visible = !/head|opacity/.test((part.material as MeshStandardMaterial).name);
    }
    this.stand.root.visible = false;
    this.root.add(this.stand.root);
    const black = new MeshStandardMaterial({ color: 0x06070a, roughness: 0.92 });
    this.hunch = this.hunchMesh(black);
    this.clinger = this.clingerMesh(black);
    this.root.add(this.hunch, this.clinger);
    this.face = this.faceMesh();
    this.face.scale.setScalar(HEAD_SCALE);
    this.face.position.set(0, -SKULL.y * HEAD_SCALE, -SKULL.z * HEAD_SCALE);
    this.head.add(this.face);
    // a head with no face yet, and later whatever shows through the scan's open underside: dark
    this.hollow = new Mesh(new SphereGeometry(1, 16, 12), new MeshStandardMaterial({ color: 0x000000, roughness: 1, envMapIntensity: 0 }));
    this.head.add(this.hollow);
    this.head.visible = false;
    this.root.add(this.head);
    this.hair = this.hairMesh();
    this.fall = this.fallMesh();
    this.root.add(this.hair, this.fall);
    for (const side of [-1, 1]) {
      const hand = this.hand(side, black);
      hand.visible = false;
      this.root.add(hand);
      this.hands.push({ root: hand, side });
    }
    this.lens.add(this.lids());

    this.score();
  }

  /** What is said and heard, once each, as time reaches it. */
  private score(): void {
    const s = this.sound;
    // near silence: the room, the curtain, a draught
    this.beat(0, () => {
      this.tone = s.bed('rooms/bedroom_tone.mp3', { gain: 0.25 });
      this.curtain = s.bed('rooms/curtain_breathing.mp3', { gain: 0.45, pan: -0.65, offset: 0 });
      this.draft = s.bed('rooms/draft_drone.mp3', { gain: 0.14 });
      s.bed('rooms/dream_drone_low.mp3', { gain: 0.1, fade: 6 });
    });
    this.beat(LINE_AWAKE, () => this.say({ tr: 'Uyandın.', en: 'You are awake.' }, 4));
    this.beat(7.4, () => s.play('rooms/pine_beetle_tick_1.mp3', { gain: 0.16, pan: 0.55 }));
    this.beat(8.3, () => s.play('rooms/pine_beetle_tick_3.mp3', { gain: 0.14, pan: 0.55 }));
    this.beat(9.6, () => s.play('rooms/clock_tock_far.mp3', { gain: 0.25, lowpass: 2000, reverb: 0.5, pan: 0.3 }));
    this.beat(LINE_CANNOT, () => this.say({ tr: 'Kıpırdayamıyorsun.', en: 'You cannot move.' }, 4));

    // the door: the curtain holds its breath, and then the long creak
    this.beat(DOOR_OPENS - 1.2, () => this.curtain?.gain(0.12, 1));
    this.beat(DOOR_OPENS, () => s.play('rooms/door_creak_slow.mp3', { gain: 0.4, reverb: 0.3, pan: -0.05 }));
    this.beat(DOOR_OPENED + 1, () => this.curtain?.gain(0.3, 3));

    // your own breath, close, and something a long way off in the house
    this.beat(BREATH_FROM, () => {
      this.breath = s.bed('rooms/breath_calm.mp3', { gain: 0.12, fade: 2 });
    });
    this.beat(33.2, () => s.play('rooms/floor_creak_2.mp3', { gain: 0.24, lowpass: 1800, reverb: 0.15 }));

    // nothing at all, as the eye opens on it
    this.beat(BLINKS[1] - 0.5, () => {
      this.breath?.gain(0, 0.4);
      this.curtain?.gain(0.05, 0.4);
      this.tone?.gain(0.08, 0.4);
    });
    this.beat(BLINKS[1] + 2, () => {
      s.play('rooms/breath_in.mp3', { gain: 0.2 });
      s.bed('rooms/whisper_gabble.mp3', { gain: 0.1, lowpass: 2000, reverb: 0.3, fade: 12 });
    });
    this.beat(BLINKS[1] + 3.6, () => {
      this.panic = s.bed('rooms/breath_panic.mp3', { gain: 0.14, fade: 3 });
      this.tone?.gain(0.16, 3);
    });
    this.beat(41.2, () => s.play('rooms/floor_creak_4.mp3', { gain: 0.3, reverb: 0.15, lowpass: 2600, pan: -0.05 }));
    this.beat(42.7, () => s.play('rooms/floor_step_near_1.mp3', { gain: 0.3, reverb: 0.1 }));
    this.beat(43.6, () => s.play('rooms/floor_step_near_3.mp3', { gain: 0.34, reverb: 0.1 }));

    // the weight on the bed
    this.beat(BLINKS[2] + 0.2, () => this.panic?.gain(0.04, 0.3));
    this.beat(WEIGHT_AT, () => {
      s.play('rooms/bed_weight_1.mp3', { gain: 0.5 });
      s.play('rooms/bed_sit_soft.mp3', { gain: 0.6 });
    });
    this.beat(WEIGHT_AT + 0.5, () => s.play('rooms/bed_settle.mp3', { gain: 0.35, reverb: 0.1 }));
    this.beat(WEIGHT_AT + 2, () => this.panic?.gain(0.2, 2));
    this.beat(BLINKS[3] + 0.2, () => s.play('rooms/sheet_scooch.mp3', { gain: 0.6 }));
    this.beat(BLINKS[3] + 0.8, () => s.play('rooms/bed_weight_2.mp3', { gain: 0.5 }));
    this.beat(52.9, () => s.play('rooms/sniff_1.mp3', { gain: 0.25, pan: -0.75 }));

    // it climbs: cloth, the frame of the bed, its breath, and hair on your scalp
    this.beat(CLIMB_AT, () => {
      s.play('rooms/blanket_move.mp3', { gain: 0.6 });
      s.bed('rooms/breath_open_mouth.mp3', { gain: 0.22, fade: 3, pan: 0.12 });
    });
    this.beat(55.1, () => s.play('rooms/bed_weight_3.mp3', { gain: 0.45 }));
    this.beat(CLIMB_AT + 1.2, () => {
      s.bed('rooms/hair_fingers.mp3', { gain: 0.45, fade: 4 });
    });
    this.beat(56.5, () => s.play('rooms/bed_weight_2.mp3', { gain: 0.5, rate: 0.86 }));
    this.beat(56.9, () => s.play('rooms/hair_binaural.mp3', { gain: 0.8 }));

    // on the chest: air is what there is not
    this.beat(PRESS_AT, () => {
      s.play('rooms/chest_pressure.mp3', { gain: 0.7 });
      s.play('rooms/bed_weight_3.mp3', { gain: 0.45, rate: 0.8 });
      this.panic?.gain(0, 0.5);
      s.bed('rooms/breath_labored.mp3', { gain: 0.25, fade: 0.8 });
      this.tone?.gain(0, 2);
      this.draft?.gain(0, 2);
      this.curtain?.gain(0, 2);
      this.heart = true;
    });
    this.beat(60.4, () => {
      s.bed('rooms/throat_crackle.mp3', { gain: 0.45, fade: 1.5 });
    });
    this.beat(FACE_AT - 0.5, () => s.play('rooms/mouth_wet_1.mp3', { gain: 0.3 }));
    this.beat(FACE_AT, () => this.say({ tr: 'Yemek soğuyor.', en: 'Dinner is getting cold.' }, 5));
    this.beat(FACE_AT + 0.9, () => s.play('rooms/mouth_click_2.mp3', { gain: 0.5 }));
    this.beat(FACE_AT + 1.5, () => s.play('rooms/mouth_click_4.mp3', { gain: 0.5 }));
    this.beat(SHUTTER_AT, () => this.shutter());

    // then nothing: four seconds of nothing at all
    this.beat(DARK_AT, () => {
      this.heart = false;
      s.stopAll(0.04);
    });

    // morning: a long breath in, a long breath out, the room again
    this.beat(DAWN_AT + 0.1, () => s.play('rooms/breath_in.mp3', { gain: 0.25 }));
    this.beat(DAWN_AT + 1.9, () => s.play('rooms/breath_out.mp3', { gain: 0.25 }));
    this.beat(DAWN_AT + 0.6, () => {
      this.tone = s.bed('rooms/bedroom_tone.mp3', { gain: 0.25, fade: 2 });
      this.curtain = s.bed('rooms/curtain_breathing.mp3', { gain: 0.35, pan: -0.65, fade: 3 });
    });
    this.beat(DAWN_AT + 2.8, () => {
      this.breath = s.bed('rooms/breath_calm.mp3', { gain: 0.12, fade: 1 });
    });
    // the room stops, a moment before you are shown why
    this.beat(LOOK_UP_AT - 0.5, () => {
      this.tone?.gain(0, 0.4);
      this.curtain?.gain(0, 0.4);
      this.breath?.gain(0, 0.3);
    });
    this.beat(LOOK_UP_AT + 0.1, () => {
      s.play('rooms/gasp_1.mp3', { gain: 0.3 });
      s.bed('rooms/breath_open_mouth.mp3', { gain: 0.22, pan: 0 });
      s.bed('rooms/whisper_gabble.mp3', { gain: 0.14, reverb: 0.3, lowpass: 2400, fade: 1 });
    });
    this.beat(LOOK_UP_AT + 0.9, () => s.play('rooms/mouth_click_4.mp3', { gain: 0.5 }));
    this.beat(CUT_AT, () => s.stopAll(0.03));
  }

  /** Walls, floor, ceiling and their mouldings. */
  private shell(): void {
    const b = this.build;
    const k = this.kit;
    const damask = b.damask(PALETTE.damaskTeal, PAPER_TILE) as MeshStandardMaterial;
    const paper = (width: number, seed: number): MeshStandardMaterial => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(width * PAPER_PX);
      canvas.height = Math.ceil(H * PAPER_PX);
      drawPaper(canvas.getContext('2d')!, canvas.width, canvas.height, damask.map!.image as CanvasImageSource, seed);
      const map = new CanvasTexture(canvas);
      map.colorSpace = SRGBColorSpace;
      map.anisotropy = 4;
      map.wrapS = map.wrapT = ClampToEdgeWrapping;
      map.repeat.set(1 / width, 1 / H);
      return new MeshStandardMaterial({ map, roughness: 0.84, normalMap: damask.normalMap, normalScale: damask.normalScale });
    };
    const width = R - L;
    const depth = NEAR - FAR;
    const place_ = (m: Mesh, x: number, y: number, z: number, heading: number) => {
      m.position.set(x, y, z);
      m.rotation.y = heading;
      this.root.add(m);
      return m;
    };
    place_(k.wall(depth, H, paper(depth, 12), depth / 2, H / 2), R, H / 2, (NEAR + FAR) / 2, -Math.PI / 2);
    place_(k.wall(width, H, paper(width, 13), width / 2, H / 2), (L + R) / 2, H / 2, NEAR, Math.PI);
    // the far wall, cut for the door
    const far = paper(width, 11);
    const dx0 = DOOR.x - DOOR.w / 2;
    const dx1 = DOOR.x + DOOR.w / 2;
    const farPanel = (x0: number, x1: number, y0: number, y1: number) => {
      place_(k.wall(x1 - x0, y1 - y0, far, (x0 + x1) / 2 - L, (y0 + y1) / 2), (x0 + x1) / 2, (y0 + y1) / 2, FAR, 0);
    };
    farPanel(L, dx0, 0, H);
    farPanel(dx1, R, 0, H);
    farPanel(dx0, dx1, DOOR.h, H);
    // the left wall, cut for the window: its paper runs on across the pieces
    const left = paper(depth, 14);
    const { z, y, w, h } = WINDOW;
    const panel = (z0: number, z1: number, y0: number, y1: number) => {
      const m = k.wall(z1 - z0, y1 - y0, left, (z0 + z1) / 2 - FAR, (y0 + y1) / 2);
      m.castShadow = true;
      place_(m, L, (y0 + y1) / 2, (z0 + z1) / 2, Math.PI / 2);
    };
    panel(FAR, NEAR, y + h / 2, H);
    panel(FAR, NEAR, 0, y - h / 2);
    panel(FAR, z - w / 2, y - h / 2, y + h / 2);
    panel(z + w / 2, NEAR, y - h / 2, y + h / 2);

    this.root.add(k.floor(L, R, FAR, NEAR, 0, k.surface('wood_floor_dark', 2, { color: new Color(0x8a8f96) })));
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    drawCeiling(canvas.getContext('2d')!, 1024, 1024);
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    map.repeat.set(1 / width, 1 / depth);
    const plaster = b.paint(0xffffff, 0.95) as MeshStandardMaterial;
    const overhead = k.wall(width, depth, new MeshStandardMaterial({ map, roughness: 0.95, normalMap: plaster.normalMap, normalScale: plaster.normalScale }), width / 2, depth / 2);
    overhead.rotation.x = Math.PI / 2;
    overhead.position.set((L + R) / 2, H, (NEAR + FAR) / 2);
    this.root.add(overhead);

    // dark wood: panelling to the sill and a cornice
    const panelling = 0.88;
    b.wainscot(R, (NEAR + FAR) / 2, depth, '-x', this.root, panelling);
    b.wainscot((L + dx0 - 0.06) / 2, FAR, dx0 - 0.06 - L, '+z', this.root, panelling);
    b.wainscot((R + dx1 + 0.06) / 2, FAR, R - dx1 - 0.06, '+z', this.root, panelling);
    b.wainscot(L, (NEAR + FAR) / 2, depth, '+x', this.root, panelling);
    b.wainscot((L + R) / 2, NEAR, width, '-z', this.root, panelling);
    const wood = b.wood(1.2);
    const cornice = 0.07;
    const rail = (x: number, zz: number, along: number, across: number) => {
      const m = k.block(along, 0.08, across, wood);
      m.position.set(x, H - 0.04, zz);
      this.root.add(m);
    };
    rail((L + R) / 2, FAR + cornice / 2, width, cornice);
    rail((L + R) / 2, NEAR - cornice / 2, width, cornice);
    rail(R - cornice / 2, (NEAR + FAR) / 2, cornice, depth);
    rail(L + cornice / 2, (NEAR + FAR) / 2, cornice, depth);
  }

  /** The door, opening away into a blackness: hinged on its right, so that the moon reaches into the gap. */
  private door(): void {
    const k = this.kit;
    const beyond = new Mesh(new PlaneGeometry(DOOR.w + 1.2, DOOR.h + 1.4), new MeshStandardMaterial({ color: 0x000000, roughness: 1, envMapIntensity: 0 }));
    beyond.position.set(DOOR.x, DOOR.h / 2, FAR - 1.2);
    this.root.add(beyond);
    this.tintAll(k.prop('door_frame', [DOOR.x, 0, FAR + 0.012], {}, this.root), 0x7f8588);
    // the wall's thickness in the opening
    const lining = new MeshStandardMaterial({ color: 0x2c3034, roughness: 0.8 });
    const jamb = (w: number, h: number, d: number, x: number, y: number) => {
      const m = k.block(w, h, d, lining);
      m.position.set(x, y, FAR - d / 2);
      this.root.add(m);
    };
    jamb(0.02, DOOR.h, 0.12, DOOR.x - DOOR.w / 2 - 0.01, DOOR.h / 2);
    jamb(0.02, DOOR.h, 0.12, DOOR.x + DOOR.w / 2 + 0.01, DOOR.h / 2);
    jamb(DOOR.w, 0.02, 0.12, DOOR.x, DOOR.h + 0.01);
    this.hinge.position.set(DOOR.x + DOOR.w / 2, 0, FAR - 0.03);
    this.root.add(this.hinge);
    this.tintAll(k.prop('door_six', [-DOOR.w / 2, 0, 0], { castShadow: true }, this.hinge), 0x707578);
    k.prop('door_knob', [-DOOR.w + 0.07, 0.96, 0.0], {}, this.hinge);
  }

  /** A sky behind the window: a gradient, and for the night a moon too large for it. */
  private skyOutside(top: string, middle: string, low: string, moon: boolean, glow: number): Mesh {
    const sky = this.build.label(5, 3.4, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, top);
      g.addColorStop(0.6, middle);
      g.addColorStop(1, low);
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      if (!moon) return;
      const mx = w * 0.62;
      const my = h * 0.34;
      const halo = c.createRadialGradient(mx, my, 0, mx, my, h * 0.5);
      halo.addColorStop(0, 'rgba(220,235,255,0.9)');
      halo.addColorStop(0.16, 'rgba(180,205,240,0.55)');
      halo.addColorStop(1, 'rgba(120,150,200,0)');
      c.fillStyle = halo;
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#f2f6ff';
      c.beginPath();
      c.arc(mx, my, h * 0.09, 0, Math.PI * 2);
      c.fill();
    }, { px: 160, emissive: glow });
    sky.mesh.rotation.y = Math.PI / 2;
    sky.mesh.position.set(L - 0.6, 1.9, -3.2);
    this.root.add(sky.mesh);
    return sky.mesh;
  }

  /** The oval portrait on the wall. */
  private portrait(): void {
    const frame = this.kit.prop('frame_round', [0.92, 1.42, FAR + 0.02], { scale: 0.9 }, this.root);
    frame.traverse((o) => {
      const mesh = o as Mesh;
      const m = mesh.material as MeshStandardMaterial | undefined;
      if (!mesh.isMesh || !m) return;
      if (m.name.endsWith('artwork')) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 320;
        drawPortrait(canvas.getContext('2d')!, 256, 320);
        const art = m.clone();
        art.map = this.like(new CanvasTexture(canvas), m.map);
        mesh.material = art;
      } else if (!m.transparent) {
        const dark = m.clone();
        dark.color.setHex(0x3a3a3c);
        mesh.material = dark;
      }
    });
  }

  /** A texture drawn here that takes the place of a model's own map. */
  private like(map: CanvasTexture, source: Texture | null): CanvasTexture {
    map.colorSpace = SRGBColorSpace;
    if (source) {
      map.flipY = source.flipY;
      map.wrapS = source.wrapS;
      map.wrapT = source.wrapT;
    }
    return map;
  }

  /** The pillow under your head, seen only if you turn. */
  private pillow(): void {
    const linen = this.kit.surface('linen_white', 0.5, { color: new Color(0x8c9196), roughness: 0.95 });
    this.kit.paint(this.kit.prop('pillow', [0.04, 0.44, 0.2], { rotation: [0, 8, 0], scale: 1.05 }, this.root), linen);
  }

  /** A few dry twigs standing in the vase. */
  private twigs(x: number, y: number, z: number): Mesh {
    const random = randomFrom(21);
    const parts: BufferGeometry[] = [];
    const up = new Vector3(0, 1, 0);
    const grow = (from: Vector3, heading: Vector3, length: number, radius: number, depth: number) => {
      const to = from.clone().addScaledVector(heading, length);
      const g = new CylinderGeometry(radius * 0.7, radius, length, 5, 1, true);
      const m = new Object3D();
      m.position.copy(from).add(to).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(up, heading);
      m.updateMatrix();
      g.applyMatrix4(m.matrix);
      parts.push(g);
      if (depth === 0) return;
      for (let i = 0; i < 2; i++) {
        const next = heading.clone().add(new Vector3((random() - 0.5) * 0.9, (random() - 0.2) * 0.4, (random() - 0.5) * 0.9)).normalize();
        grow(to, next, length * (0.55 + random() * 0.25), radius * 0.7, depth - 1);
      }
    };
    for (let i = 0; i < 4; i++) grow(new Vector3(x, y, z), new Vector3((random() - 0.5) * 0.5, 1, (random() - 0.5) * 0.5).normalize(), 0.24 + random() * 0.14, 0.0045, 3);
    const mesh = new Mesh(mergeGeometries(parts)!, new MeshStandardMaterial({ color: 0x17120d, roughness: 0.9 }));
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** A shaft of lit dust: three soft planes crossed along the way of the light, gone before they reach the wall. */
  private shaft(from: Vector3, to: Vector3, widthFrom: number, widthTo: number): Object3D {
    const g = new Group();
    const length = from.distanceTo(to);
    const geometry = new PlaneGeometry(1, 1, 1, 1);
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const along = position.getY(i) + 0.5;
      position.setX(i, position.getX(i) * (widthFrom + (widthTo - widthFrom) * (1 - along)));
      position.setY(i, (along - 0.5) * length);
    }
    const material = new ShaderMaterial({
      vertexShader: SHAFT_VERT,
      fragmentShader: SHAFT_FRAG,
      uniforms: { ...warpUniforms, uShaft: this.shaftLight },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    for (let i = 0; i < 3; i++) {
      const plane = new Mesh(geometry, material);
      plane.rotation.y = (i * Math.PI) / 3;
      plane.frustumCulled = false;
      plane.renderOrder = 3;
      g.add(plane);
    }
    g.position.copy(from).add(to).multiplyScalar(0.5);
    g.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), from.clone().sub(to).normalize());
    return g;
  }

  /** The quilt: a grid of its own, so that it can show a body, and so that it can be pressed. */
  private quilt(): Mesh {
    const columns = 96;
    const rows = 130;
    const x0 = -0.74;
    const x1 = 0.74;
    const z0 = -1.53;
    const z1 = -0.13;
    const positions: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= columns; i++) {
        const x = x0 + ((x1 - x0) * i) / columns;
        const z = z0 + ((z1 - z0) * j) / rows;
        positions.push(x, QUILT_Y + quiltAt(x, z), z);
        uvs.push(i / columns, j / rows);
        if (i < columns && j < rows) {
          const a = j * (columns + 1) + i;
          const c = a + columns + 1;
          index.push(a, c, a + 1, a + 1, c, c + 1);
        }
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    const sheet = (bump: boolean) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 1024;
      drawQuilt(canvas.getContext('2d')!, 1024, 1024, bump);
      const t = new CanvasTexture(canvas);
      t.anisotropy = 4;
      if (!bump) t.colorSpace = SRGBColorSpace;
      return t;
    };
    const cloth = new MeshStandardMaterial({ map: sheet(false), bumpMap: sheet(true), bumpScale: 1.1, roughness: 0.66 });
    // the chest rises with the breath; knees and hands press dents in it, and the whole mattress sags
    const lift = /* glsl */ `
      float quiltLift(vec2 p) {
        float chest = uChest * exp(-pow(p.x / 0.3, 2.0)) * smoothstep(-0.16, -0.32, p.y) * smoothstep(-0.8, -0.46, p.y);
        float dents = uDentA.z * exp(-dot(p - uDentA.xy, p - uDentA.xy) / 0.012) + uDentB.z * exp(-dot(p - uDentB.xy, p - uDentB.xy) / 0.012) + uDentC.z * exp(-dot(p - uDentC.xy, p - uDentC.xy) / 0.09);
        return chest - dents - uSag * smoothstep(0.8, 0.2, abs(p.x));
      }`;
    cloth.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, this.quiltU);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uChest;\nuniform float uSag;\nuniform vec3 uDentA;\nuniform vec3 uDentB;\nuniform vec3 uDentC;\n${lift}`)
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
          float quiltH0 = quiltLift(position.xz);
          objectNormal = normalize(objectNormal - vec3((quiltLift(position.xz + vec2(0.012, 0.0)) - quiltH0) / 0.012, 0.0, (quiltLift(position.xz + vec2(0.0, 0.012)) - quiltH0) / 0.012));`,
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += quiltH0;');
    };
    cloth.customProgramCacheKey = () => 'karabasan-quilt';
    const mesh = new Mesh(g, cloth);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Two drapes by the window, pleated, moved by a slow draught (the shadow moves too). */
  private curtains(): void {
    const breath = this.draught;
    const glow = this.drapeGlow;
    const cloth = this.kit.surface('linen_white', 0.45, { color: new Color(0x5e646c), roughness: 0.96, side: DoubleSide });
    const displace = `
      float drapeFall = clamp((${ROD_Y.toFixed(2)} - position.y) / ${(ROD_Y - HEM_Y).toFixed(2)}, 0.0, 1.0);
      transformed.x += uDraught * drapeFall * drapeFall * (0.7 + 0.3 * sin(position.z * 4.0 + position.y * 1.3 + uDraught * 3.0));
      transformed.z += uDraught * 0.2 * drapeFall * sin(position.y * 2.0 + position.z * 3.0);`;
    cloth.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uDraught = breath;
      shader.uniforms.uDrapeGlow = glow;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uDraught;\nvarying vec3 vDrape;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${displace}\nvDrape = position;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uDrapeGlow;\nvarying vec3 vDrape;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          // the sky through the cloth, only where the window is behind it; thin in the valleys of the pleats
          float behind = smoothstep(${(WINDOW.z - WINDOW.w / 2).toFixed(2)}, ${(WINDOW.z - WINDOW.w / 2 + 0.12).toFixed(2)}, vDrape.z) * smoothstep(${(WINDOW.z + WINDOW.w / 2).toFixed(2)}, ${(WINDOW.z + WINDOW.w / 2 - 0.12).toFixed(2)}, vDrape.z)
            * smoothstep(${(WINDOW.y - WINDOW.h / 2 - 0.3).toFixed(2)}, ${(WINDOW.y - WINDOW.h / 2 + 0.12).toFixed(2)}, vDrape.y) * smoothstep(${(WINDOW.y + WINDOW.h / 2).toFixed(2)}, ${(WINDOW.y + WINDOW.h / 2 - 0.1).toFixed(2)}, vDrape.y);
          float pleat = smoothstep(${(L + 0.09).toFixed(3)}, ${(L + 0.2).toFixed(3)}, vDrape.x);
          totalEmissiveRadiance += vec3(0.42, 0.56, 0.78) * uDrapeGlow * (0.015 + behind * (0.2 + 0.8 * (1.0 - pleat)));`,
        );
    };
    cloth.customProgramCacheKey = () => 'karabasan-drape';
    const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    depth.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uDraught = breath;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uDraught;').replace('#include <begin_vertex>', `#include <begin_vertex>\n${displace}`);
    };
    depth.customProgramCacheKey = () => 'karabasan-drape-depth';
    for (const [z0, z1, seed] of [[-3.6, -2.98, 3], [-2.02, -1.4, 8]] as const) {
      const mesh = new Mesh(this.drape(z0, z1, seed), cloth);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.customDepthMaterial = depth;
      this.root.add(mesh);
    }
    // the rod
    const iron = new MeshStandardMaterial({ color: 0x15130f, roughness: 0.5, metalness: 0.9 });
    const rod = new Mesh(new CylinderGeometry(0.014, 0.014, WINDOW.w + 0.6, 10), iron);
    rod.rotation.x = Math.PI / 2;
    rod.position.set(L + 0.15, ROD_Y + 0.03, WINDOW.z);
    this.root.add(rod);
  }

  /** One drape along the wall from z0 to z1: tight pleats at the rod, loosening toward the hem. */
  private drape(z0: number, z1: number, seed: number): BufferGeometry {
    const random = randomFrom(seed);
    const columns = 84;
    const rows = 26;
    const pleats = 6 + random() * 2;
    const phase = random() * 6.28;
    const positions: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    for (let j = 0; j <= rows; j++) {
      const fall = j / rows;
      const y = ROD_Y + (HEM_Y - ROD_Y) * fall;
      for (let i = 0; i <= columns; i++) {
        const along = i / columns;
        const wander = 0.22 * Math.sin(fall * 3.1 + along * 5 + phase) * fall;
        const fold = Math.sin(along * pleats * Math.PI * 2 + phase + wander * 3);
        const deep = 0.035 + 0.05 * fall * (0.7 + 0.3 * Math.sin(along * 9 + phase));
        const x = L + 0.15 + fold * deep;
        const hem = 0.018 * Math.sin(along * pleats * Math.PI * 2 + phase) * fall * fall;
        const z = z0 + (z1 - z0) * along + 0.012 * Math.cos(along * pleats * Math.PI * 2 + phase) * fall;
        positions.push(x, y + hem, z);
        uvs.push(along * (z1 - z0) * 1.6, y);
        if (i < columns && j < rows) {
          const a = j * (columns + 1) + i;
          const c = a + columns + 1;
          index.push(a, c, a + 1, a + 1, c, c + 1);
        }
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    g.setAttribute('uv1', new Float32BufferAttribute(uvs, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  }

  /** The head: a real head from a scan, its jaw free to drop, its eyes hollowed, its face a scratched print. */
  private faceMesh(): Mesh {
    let source: BufferGeometry | null = null;
    this.kit.model('mri_head').scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && !source) source = m.geometry;
    });
    const scan = this.kit.prop('mri_head', [0, 0, 0], {}).children[0];
    scan.updateMatrixWorld(true);
    let matrix = new Matrix4();
    scan.traverse((o) => {
      if ((o as Mesh).isMesh) matrix = o.matrixWorld.clone();
    });
    const g = (source as unknown as BufferGeometry).clone().applyMatrix4(matrix);
    // decompressed attributes may be normalized integers: work on plain floats
    const from = g.getAttribute('position');
    const rest = new Float32Array(from.count * 3);
    const open = new Float32Array(from.count * 3);
    const uv = new Float32Array(from.count * 2);
    for (let i = 0; i < from.count; i++) {
      const x = from.getX(i);
      let y = from.getY(i);
      let z = from.getZ(i);
      uv[i * 2] = x / (2 * SKULL.rx) + 0.5;
      uv[i * 2 + 1] = y;
      const front = sstep(0.1, 0.24, z);
      // the eyes are gone: their places pressed in
      const eyeL = gauss(Math.hypot(x + 0.14, (y - 0.53) * 1.5), 0.075);
      const eyeR = gauss(Math.hypot(x - 0.14, (y - 0.53) * 1.5), 0.075);
      z -= front * 0.05 * (eyeL + eyeR);
      rest.set([x, y, z], i * 3);
      // the jaw: everything under the mouth comes down, the lips draw back, the mouth goes in
      const under = sstep(0.262, 0.215, y) * gauss(x, 0.27) * front;
      const round = Math.hypot(x / 0.115, (y - 0.235) / 0.06);
      const inward = front * sstep(1.2, 0.2, round);
      y -= under * 0.21 * (1 - 0.25 * sstep(0.2, 0.0, y));
      y += front * gauss(x, 0.14) * sstep(0.245, 0.27, y) * sstep(0.34, 0.27, y) * 0.022;
      z -= inward * 0.42;
      open.set([x, y, z], i * 3);
    }
    g.setAttribute('position', new Float32BufferAttribute(rest, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const opened = g.clone();
    opened.setAttribute('position', new Float32BufferAttribute(open, 3));
    opened.computeVertexNormals();
    g.morphAttributes.position = [opened.getAttribute('position')];
    g.morphAttributes.normal = [opened.getAttribute('normal')];
    g.morphTargetsRelative = false;
    const sheet = (bump: boolean) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1024;
      drawFace(canvas.getContext('2d')!, 1024, bump);
      const t = new CanvasTexture(canvas);
      t.anisotropy = 4;
      if (!bump) t.colorSpace = SRGBColorSpace;
      return t;
    };
    const skin = new MeshStandardMaterial({ map: sheet(false), bumpMap: sheet(true), bumpScale: 2.2, roughness: 0.62, envMapIntensity: 0.15 });
    const mesh = new Mesh(g, skin);
    mesh.frustumCulled = false;
    mesh.updateMorphTargets();
    return mesh;
  }

  /** The long white hair of the one who comes. */
  private hairMesh(): Mesh {
    const random = randomFrom(71);
    const locks = 420;
    const lockAt: Vector3[] = [];
    const lockPhase: number[] = [];
    while (lockAt.length < locks) {
      // anywhere on the skull but the face
      const a = random() * Math.PI * 2;
      const up = random() * 2 - 1;
      const r = Math.sqrt(1 - up * up);
      const d = new Vector3(Math.cos(a) * r, up, Math.sin(a) * r);
      if (d.y < -0.25 && d.z > -0.2) continue;
      if (d.z > 0.42 && d.y < 0.7) continue;
      lockAt.push(d);
      lockPhase.push(random() * 6.28);
    }
    const g = strands(HAIR.strands, HAIR.segments, (i, out) => {
      // the first strands drawn grow from the crown: a bowed head with little hair drawn is still veiled by them
      let lock = Math.floor(random() * locks);
      if (i < HAIR.strands * CROWN_SHARE) while (lockAt[lock].y < 0.5 || lockAt[lock].z < -0.15) lock = Math.floor(random() * locks);
      const d = lockAt[lock];
      const a = random() * Math.PI * 2;
      const spread = random() * 0.16;
      const x = d.x + Math.cos(a) * spread;
      const y = d.y + Math.sin(a) * spread;
      const z = d.z + Math.sin(a * 2.3) * spread;
      out.at.set(x * SKULL.rx * HEAD_SCALE, y * SKULL.ry * HEAD_SCALE, (z * SKULL.rz) * HEAD_SCALE);
      out.lockAt.set(d.x * SKULL.rx * HEAD_SCALE, d.y * SKULL.ry * HEAD_SCALE, d.z * SKULL.rz * HEAD_SCALE);
      out.lock = lockPhase[lock] + (random() - 0.5) * 0.25;
      out.length = HAIR.length[0] + (HAIR.length[1] - HAIR.length[0]) * Math.pow(random(), 2.2);
      out.width = (HAIR.width[0] + (HAIR.width[1] - HAIR.width[0]) * random()) * (i % HAIR.body === 0 ? HAIR.bodyWidth : 1);
      out.bright = random();
      out.order = -1;
    });
    const material = new ShaderMaterial({ vertexShader: HAIR_VERT, fragmentShader: HAIR_FRAG, uniforms: { ...warpUniforms, ...this.hairU }, side: DoubleSide, transparent: true, depthWrite: false });
    const mesh = new Mesh(g, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 4;
    return mesh;
  }

  /** The strands that come down one after the other right in front of the eye, and the one that comes down at dawn. */
  private fallMesh(): Mesh {
    const random = randomFrom(19);
    const g = strands(FALL.strands, FALL.segments, (i, out) => {
      const z = -0.05 - random() * 0.17;
      // the first ones hang where the eye will find them at dawn; the others keep to the sides
      const x = i < DAWN_STRANDS ? (i - 1) * 0.02 + 0.012 : (0.25 + random() * 0.95) * -z * (random() < 0.5 ? -1 : 1);
      out.at.set(x, random() * 0.03, i < DAWN_STRANDS ? -0.13 - i * 0.03 : z);
      out.lockAt.copy(out.at);
      out.lock = random() * 6.28;
      out.length = FALL.length[0] + (FALL.length[1] - FALL.length[0]) * random();
      out.width = FALL.width[0] + (FALL.width[1] - FALL.width[0]) * random();
      out.bright = random() * 0.999;
      // few at first, far apart; then more and more
      out.order = Math.pow(i / FALL.strands, 0.55);
    });
    const material = new ShaderMaterial({ vertexShader: HAIR_VERT, fragmentShader: HAIR_FRAG, uniforms: { ...warpUniforms, ...this.fallU }, side: DoubleSide, transparent: true, depthWrite: false });
    const mesh = new Mesh(g, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 5;
    return mesh;
  }

  /** The mass that kneels on you: rings of cloth around a bent spine, one silhouette, no limbs to read. */
  private hunchMesh(material: MeshStandardMaterial): Mesh {
    const rows = 44;
    const columns = 64;
    const along = HUNCH.map((_, i) => i);
    const rings = [0, 1, 2, 3].map((c) => new GlideTrack(along, HUNCH.map((r) => r[c])));
    const positions: number[] = [];
    const index: number[] = [];
    for (let j = 0; j <= rows; j++) {
      const f = (j / rows) * (HUNCH.length - 1);
      const y = rings[0].at(f);
      for (let i = 0; i <= columns; i++) {
        // the seam at the back, where nobody sees it
        const a = -Math.PI / 2 + (i / columns) * Math.PI * 2;
        const folds = 1 + (0.05 * Math.sin(a * 7 + y * 4 + 0.7) + 0.022 * Math.sin(a * 15 + y * 9)) * (1.05 - y);
        positions.push(Math.cos(a) * rings[2].at(f) * folds, y, rings[1].at(f) + Math.sin(a) * rings[3].at(f) * folds);
        if (i < columns && j < rows) {
          const k = j * (columns + 1) + i;
          const up = k + columns + 1;
          index.push(k, up, k + 1, k + 1, up, up + 1);
        }
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    const mesh = new Mesh(g, material);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.visible = false;
    return mesh;
  }

  /** What is on the ceiling at the end: thin and black and flat against the plaster, its limbs out like a spider's. */
  private clingerMesh(material: MeshStandardMaterial): Mesh {
    const at = (x: number, below: number, z: number) => new Vector3(x, H - below, z);
    const parts: BufferGeometry[] = [sinew([at(0, 0.1, 0.02), at(0.01, 0.16, -0.3), at(0, 0.12, -0.62)], 0.17, 0.12, 9, 12)];
    for (const side of [-1, 1]) {
      const wrist = at(side * 0.86, 0.03, 0.5);
      parts.push(sinew([at(side * 0.14, 0.1, 0.02), at(side * 0.62, 0.26, 0.12), at(side * 0.98, 0.1, 0.2), wrist], 0.055, 0.022));
      for (let f = 0; f < 4; f++) {
        const fan = (f - 1.5) * side;
        parts.push(sinew([wrist, at(side * 0.84 + fan * 0.05, 0.02, 0.62), at(side * 0.82 + fan * 0.1, 0.008, 0.78 - Math.abs(fan) * 0.03)], 0.012, 0.0045, 5, 6));
      }
      parts.push(sinew([at(side * 0.1, 0.1, -0.62), at(side * 0.55, 0.3, -0.5), at(side * 0.95, 0.08, -0.6), at(side * 0.72, 0.03, -1.02), at(side * 0.66, 0.008, -1.22)], 0.08, 0.024));
    }
    // the neck has grown down to you, straight up behind the head
    parts.push(sinew([at(0, 0.12, -0.1), at(0.04, 0.42, -0.2), at(-0.02, 0.72, -0.26), new Vector3(0, CEILING_HEAD[0] + 0.05, CEILING_HEAD[1] - 0.02)], 0.055, 0.04, 9, 20));
    const mesh = new Mesh(mergeGeometries(parts)!, material);
    mesh.castShadow = false;
    mesh.frustumCulled = false;
    mesh.visible = false;
    // it has been there for a while: the plaster around it is darker
    this.build.contactShadow(0, -0.25, 1.75, mesh, 0.9, H - 0.006).rotation.x = Math.PI / 2;
    return mesh;
  }

  /** A hand too long in the fingers, and the sleeve going up into the dark from it; its fingertips are at the origin's height. */
  private hand(side: number, sleeve: MeshStandardMaterial): Object3D {
    const pale: BufferGeometry[] = [];
    const dark: BufferGeometry[] = [];
    const up = new Vector3(0, 1, 0);
    const limb = (to: BufferGeometry[], a: Vector3, b: Vector3, ra: number, rb: number) => {
      const g = new CylinderGeometry(rb, ra, a.distanceTo(b), 7, 2);
      const m = new Object3D();
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
      m.updateMatrix();
      g.applyMatrix4(m.matrix);
      g.deleteAttribute('uv');
      to.push(g);
    };
    const knuckle = (p: Vector3, r: number) => {
      const g = new SphereGeometry(r, 7, 5);
      g.translate(p.x, p.y, p.z);
      g.deleteAttribute('uv');
      pale.push(g);
    };
    const wrist = new Vector3(0, 0.09, -0.16);
    const palm = new Vector3(0, 0.074, -0.05);
    limb(pale, wrist, palm, 0.017, 0.027);
    knuckle(wrist, 0.019);
    // the fingers: spread, far too long, coming down to the cloth at their tips
    for (let f = 0; f < 5; f++) {
      const a = (f - 2) * 0.26 * side;
      const thumb = f === 4;
      const base = new Vector3((f - 2) * 0.014 * side + (thumb ? 0.024 * side : 0), 0.07, -0.05 + (thumb ? -0.05 : 0));
      const dir = new Vector3(Math.sin(a + (thumb ? 0.9 * side : 0)), 0, Math.cos(a));
      const l = thumb ? 0.05 : 0.082 + 0.018 * Math.sin((f + 1) * 0.9);
      const p1 = base.clone().addScaledVector(dir, l).setY(0.078);
      const p2 = p1.clone().addScaledVector(dir, l * 0.82).setY(0.05);
      const p3 = p2.clone().addScaledVector(dir, l * 0.66).setY(0.004);
      limb(pale, base, p1, 0.0062, 0.005);
      limb(pale, p1, p2, 0.005, 0.0042);
      limb(pale, p2, p3, 0.0042, 0.0028);
      knuckle(p1, 0.0056);
      knuckle(p2, 0.0047);
    }
    // the arm goes up and back into what it belongs to, black from the wrist
    const elbow = new Vector3(-0.02 * side, 0.46, -0.5);
    limb(dark, wrist, elbow, 0.02, 0.04);
    limb(dark, elbow, new Vector3(-0.1 * side, 0.92, -0.8), 0.04, 0.05);
    const root = new Group();
    root.add(new Mesh(mergeGeometries(pale)!, new MeshStandardMaterial({ color: 0x56585a, roughness: 0.66 })), new Mesh(mergeGeometries(dark)!, sleeve));
    root.traverse((o) => {
      o.frustumCulled = false;
    });
    return root;
  }

  /** The eyelids and the tunnel, on the lens. */
  private lids(): Mesh {
    const mask = new Mesh(
      new PlaneGeometry(0.4, 0.3),
      new ShaderMaterial({ vertexShader: LID_VERT, fragmentShader: LID_FRAG, uniforms: this.lid, transparent: true, depthWrite: false, depthTest: false }),
    );
    mask.position.z = -0.07;
    mask.renderOrder = 900;
    mask.frustumCulled = false;
    return mask;
  }

  private tintAll(object: Object3D, color: number): void {
    object.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const m = (mesh.material as MeshStandardMaterial).clone();
      m.color.setHex(color);
      mesh.material = m;
    });
  }

  /** The eye's own small movements on top of the keys. */
  pose(t: number, out: RoomPose): RoomPose {
    super.pose(t, out);
    const seconds = t * this.seconds;
    const held = seconds < DARK_AT;
    if (!REDUCED_MOTION) {
      out.position.y += this.shudder * SHUDDER * Math.sin(seconds * 37) + (held ? Math.sin(this.breathPhase * Math.PI * 2) * 0.0012 : 0);
      out.roll += this.shudder * 0.0016 * Math.sin(seconds * 29);
    }
    this.lid.uHalf.value = 0.07 * Math.tan((out.fov * DEG) / 2);
    return out;
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const dt = frame.paused ? 0 : frame.dt;
    this.moteTime.value = frame.time;
    this.draught.value = 0.05 + 0.05 * Math.sin((frame.time / 5.2) * Math.PI * 2) + 0.012 * wobble(frame.time * 0.4, 2);
    this.movingShadows = true;
    this.updateDoor(s);
    this.updateLight(s);
    this.updateFigure(s, frame.time);
    this.updateBody(s, dt);
    this.updateEye(s);
    this.control.look = s >= DAWN_AT && s < (REDUCED_MOTION ? LOOK_UP_AT - 0.3 : LOOK_UP_AT + 0.75);
    this.reach(s, frame);
  }

  /** The door opens once by itself, and after that only while the eye is shut; by morning it is shut. */
  private updateDoor(s: number): void {
    let open = smootherstep(range(DOOR_OPENS, DOOR_OPENED, s)) * DOOR_AJAR[0];
    if (s >= BLINKS[0] + 0.6) open = DOOR_AJAR[1];
    if (s >= BLINKS[1] + 0.6) open = DOOR_AJAR[2];
    if (s >= DARK_AT) open = 0;
    this.hinge.rotation.y = -open;
  }

  /** The night as it goes on, the moon put out by what climbs, and then the dawn. */
  private updateLight(s: number): void {
    const dawn = s >= DARK_AT;
    if (dawn) this.spots = this.nightSpots;
    this.nightSky.visible = !dawn;
    this.dawnSky.visible = dawn;
    const g = this.air.grade;
    if (dawn) {
      this.moon.intensity = 40;
      this.moon.color = DAWN_LIGHT;
      this.bar.intensity = 4;
      this.bar.color = DAWN_LIGHT;
      this.fill.intensity = 14;
      this.fill.color = DAWN_LIGHT;
      this.bounce[0].intensity = 3.4;
      this.bounce[1].intensity = 5;
      this.bounce[2].intensity = 4.6;
      this.side.intensity = 0;
      this.under.intensity = s >= CEILING_AT ? 1.1 : 0;
      this.drapeGlow.value = 2;
      this.shaftLight.value.setRGB(0.05, 0.045, 0.042);
      this.moteColor.value.copy(this.moteBase).multiplyScalar(0.6);
      this.spiral.emissiveIntensity = 0;
      this.air.fog.color = 0x5a5654;
      this.air.fog.density = 0.055;
      g.exposure = 1.5;
      g.saturation = 0.62;
      g.warmth = 0.16;
      this.film.scratches = 0.02;
      this.film.bloom = 1;
      return;
    }
    this.under.intensity = 0;
    // written back every frame: a jump in time must not leave the morning's air in the night
    this.moon.color = MOON_LIGHT;
    this.bar.color = MOON_LIGHT;
    this.fill.color = MOON_FILL;
    this.air.fog.color = NIGHT_FOG.color;
    this.air.fog.density = NIGHT_FOG.density;
    this.film.scratches = NIGHT_FILM.scratches;
    this.film.bloom = NIGHT_FILM.bloom;
    // its shape comes between you and the moon
    const eclipse = smootherstep(range(CLIMB_AT - 1, PRESS_AT, s));
    this.moon.intensity = 120 * (1 - 0.97 * eclipse);
    this.fill.intensity = 1.8 * (1 - 0.92 * eclipse);
    this.bounce[0].intensity = 0.9 * (1 - 0.8 * eclipse);
    this.bounce[1].intensity = 0.5 * (1 - 0.8 * eclipse);
    this.bounce[2].intensity = 0.25 * (1 - 0.5 * eclipse);
    this.drapeGlow.value = 0.55 * (1 - 0.55 * eclipse);
    this.shaftLight.value.copy(this.shaftBase).multiplyScalar(1 - 0.85 * eclipse);
    this.moteColor.value.copy(this.moteBase).multiplyScalar(1 - 0.7 * eclipse);
    this.spiral.emissiveIntensity = 0.7 + 0.2 * Math.sin(this.breathPhase * Math.PI * 2);
    (this.nightSky.material as MeshStandardMaterial).emissiveIntensity = 1.6 * (1 - 0.4 * eclipse);
    this.side.intensity = 0.12 * smootherstep(range(FACE_AT - 2, FACE_AT, s));
    // the shutter fires a real flash into the face, and the picture is taken in it
    const flash = s >= SHUTTER_AT ? Math.exp(-(s - SHUTTER_AT) / 0.16) : 0;
    this.flash.intensity = FLASH * flash;
    this.spots = flash > 0.01 ? this.withFlash : this.nightSpots;
    // the one bar of light left, on the chest, grows as the face comes down into it
    this.bar.intensity = lerp(5, 11, smootherstep(range(FACE_AT - 2, SHUTTER_AT, s)));
    g.exposure = 1.25;
    g.saturation = 0.82 - 0.3 * smootherstep(range(PRESS_AT, DARK_AT, s));
    g.warmth = -0.04;
  }

  /** Where the one who comes is, and how its hair hangs. */
  private updateFigure(s: number, time: number): void {
    const stand = this.stand;
    const inDoor = s >= BLINKS[1] + 0.6 && s < BLINKS[2] + 0.6;
    const atFoot = s >= BLINKS[2] + 0.6 && s < BLINKS[3] + 0.6;
    const onBed = s >= BLINKS[3] + 0.6 && s < DARK_AT;
    const above = s >= CEILING_AT;
    const seen = inDoor || atFoot || onBed || above;
    const stoop = smootherstep(range(LOOK_UP_AT + 0.7, CUT_AT, s));
    stand.root.visible = inDoor || atFoot;
    this.hunch.visible = onBed;
    this.clinger.visible = above;
    this.head.visible = seen;
    this.hair.visible = seen;
    this.fall.visible = onBed ? s >= CLIMB_AT : s >= STRAND_AT && s < LOOK_UP_AT + 0.4;
    if (s >= STRAND_AT) {
      // morning, and one white hair coming down out of nowhere in front of the eye
      const one = this.fallU;
      one.uTime.value = time;
      one.uDrop.value = range(STRAND_AT, CEILING_AT + 0.4, s) * 0.3;
      one.uHead.value.set(0, 1.62, 0);
      one.uLong.value = 2;
      one.uFloor.value = 0;
      one.uLit.value.setRGB(0.5, 0.5, 0.47);
      one.uShade.value.setRGB(0.1, 0.1, 0.09);
      one.uCone.value.w = 0;
      this.fall.geometry.setDrawRange(0, DAWN_STRANDS * FALL.segments * 6);
    } else {
      // the first strands hang in the middle of the picture: by the time the face comes they have been moved aside
      this.fall.geometry.setDrawRange(s < FACE_AT - 1.5 ? 0 : DAWN_STRANDS * FALL.segments * 6, Infinity);
    }
    if (!seen) return;
    const hair = this.hairU;
    const drawn = this.hair.geometry.index!.count;
    hair.uTime.value = time;
    let x = 0;
    let y = 0;
    let z = 0;
    let bow = 0;
    let tilt = 0;
    hair.uBell.value = 0;
    hair.uRelief.value = 0;
    hair.uRootFade.value = 0;
    hair.uPartEase.value = 0.35;
    hair.uPuff.value = 0.42;
    if (inDoor || atFoot) {
      // stretched past a person; the face is a black place between two falls of hair
      const where = inDoor ? STAND_DOOR : STAND_FOOT;
      const at = where[0];
      const depth = where[1];
      const lean = inDoor ? 0 : 0.06;
      placeTurn.setFromEuler(turnEuler.set(lean, 0, 0));
      place.compose(placeAt.set(at, 0, depth), placeTurn, placeScale.set(FIGURE_SLIM, FIGURE_TALL, FIGURE_SLIM));
      stand.setMatrix(0, place);
      stand.commit();
      this.hair.geometry.setDrawRange(0, drawn * HAIR_STANDING);
      x = at;
      y = FIGURE_HEAD * FIGURE_TALL * Math.cos(lean) - 0.03;
      z = depth + FIGURE_HEAD * FIGURE_TALL * Math.sin(lean) + 0.04;
      bow = 0.22;
      tilt = inDoor ? 0.13 : -0.09;
      hair.uFloor.value = 0;
      hair.uLong.value = 1;
      hair.uThin.value = 1;
      hair.uPuff.value = 0.12;
      hair.uPart.value = 0.1;
      hair.uPartEase.value = 0.1;
      hair.uRelief.value = 0.8;
      hair.uTent.value.z = 0;
      hair.uLit.value.setRGB(0.3, 0.37, 0.47);
      hair.uShade.value.setRGB(0.01, 0.013, 0.018);
      hair.uMoon.value.set(0.82, -0.2, -0.52);
      hair.uCone.value.w = 0;
    } else if (onBed) {
      this.hunch.position.set(0, this.bodyY.at(s), this.bodyZ.at(s));
      this.hunch.rotation.x = this.bodyLean.at(s);
      // it gets bigger than coming nearer can account for
      this.hunch.scale.setScalar(lerp(HUNCH_SCALE[0], HUNCH_SCALE[1], smootherstep(range(CLIMB_AT, PRESS_AT, s))));
      hair.uPuff.value = lerp(0.2, 0.42, smootherstep(range(CLIMB_AT + 2, FACE_AT - 2, s)));
      this.hair.geometry.setDrawRange(0, drawn * lerp(0.2, 0.36, smootherstep(range(CLIMB_AT, FACE_AT, s))));
      x = this.headX.at(s);
      y = this.headY.at(s);
      z = this.headZ.at(s);
      bow = this.headBow.at(s);
      tilt = this.headTilt.at(s);
      hair.uFloor.value = 0.55;
      hair.uLong.value = 0.8;
      hair.uThin.value = 0.3;
      hair.uPart.value = 0.17 * smootherstep(range(CLIMB_AT + 0.5, FACE_AT, s));
      hair.uLit.value.setRGB(0.07, 0.09, 0.12);
      hair.uShade.value.setRGB(0.005, 0.007, 0.01);
      hair.uMoon.value.set(0.87, -0.49, 0);
      hair.uCone.value.w = 0.04 + 0.42 * smootherstep(range(FACE_AT - 2.5, SHUTTER_AT, s));
      // the curtain parts around the eye as the face comes down through it
      toFace.set(x, y, z).sub(hair.uEye.value);
      hair.uAxis.value.copy(toFace).normalize();
      hair.uTent.value.set(0.03, 0.34, smootherstep(range(CLIMB_AT + 1, FACE_AT, s)));
    } else {
      // on the ceiling: the hair let go, a few strands first, and all of it by the time the eye has gone up
      this.hair.geometry.setDrawRange(0, drawn * lerp(0.03, 0.5, smootherstep(range(CEILING_AT + 0.3, LOOK_UP_AT + 0.6, s))));
      x = 0;
      y = CEILING_HEAD[0] - stoop * CEILING_STOOP;
      z = CEILING_HEAD[1];
      bow = CEILING_BOW;
      tilt = 0.06;
      hair.uFloor.value = 0;
      hair.uLong.value = 0.85;
      hair.uThin.value = 0.35;
      hair.uPart.value = 0;
      hair.uBell.value = 0.5;
      hair.uRootFade.value = 1;
      hair.uLit.value.setRGB(0.42, 0.42, 0.4);
      hair.uShade.value.setRGB(0.11, 0.11, 0.11);
      hair.uMoon.value.set(0.7, -0.3, -0.6);
      hair.uCone.value.w = 0;
      hair.uTent.value.z = 0;
    }
    this.head.position.set(x, y, z);
    this.head.rotation.set(bow, 0, tilt);
    this.head.updateMatrix();
    hair.uHead.value.copy(this.head.position);
    hair.uHeadTurn.value.setFromMatrix4(this.head.matrix);
    // until it comes down into the light there is no face, only a dark place the shape of a head
    const faced = above || (onBed && s >= PRESS_AT);
    this.face.visible = faced;
    const hollow = faced ? 0.72 : 1;
    this.hollow.scale.set(SKULL.rx * HEAD_SCALE * hollow, SKULL.ry * HEAD_SCALE * hollow, SKULL.rz * HEAD_SCALE * (faced ? 0.6 : 1));
    this.hollow.position.z = faced ? -0.03 : 0;
    // the mouth, wider and wider
    this.face.morphTargetInfluences![0] = onBed ? smootherstep(range(FACE_AT - 2.4, DARK_AT, s)) * 0.95 : above ? lerp(0.55, 0.95, stoop) : 0;
    // what comes down in front of the eye: one strand and then another
    const fall = this.fallU;
    fall.uTime.value = time;
    if (onBed) {
      fall.uDrop.value = range(CLIMB_AT + 0.4, 60.4, s) * 1.2;
      fall.uHead.value.set(this.headX.at(s), 1.08, 0);
      fall.uFloor.value = -1;
      fall.uLit.value.setRGB(0.2, 0.25, 0.32);
      fall.uShade.value.setRGB(0.012, 0.016, 0.022);
      fall.uMoon.value.set(0.87, -0.49, 0);
      fall.uCone.value.w = 0.04 + 0.1 * smootherstep(range(FACE_AT - 2.5, SHUTTER_AT, s));
      fall.uSway.value = 0.012;
    }
  }

  /** The body under the quilt: its breath, and what is pressing on it. Sound on the moments it cannot wait for a beat. */
  private updateBody(s: number, dt: number): void {
    const held = s >= PRESS_AT && s < DARK_AT;
    const rate = held ? BREATH_RATE[1] : lerp(BREATH_RATE[0], BREATH_RATE[1], smootherstep(range(BLINKS[1], PRESS_AT, s)));
    this.breathPhase = (this.breathPhase + rate * dt) % 1;
    const wave = 0.5 + 0.5 * Math.sin(this.breathPhase * Math.PI * 2);
    // under the weight the chest hardly lifts at all
    this.quiltU.uChest.value = CHEST * wave * (held ? 0.18 : 1);
    const q = this.quiltU;
    q.uSag.value = 0;
    q.uDentA.value.z = q.uDentB.value.z = q.uDentC.value.z = 0;
    if (s < DARK_AT) {
      q.uSag.value = 0.016 * smootherstep(range(WEIGHT_AT, WEIGHT_AT + 0.4, s)) + 0.016 * smootherstep(range(50.6, 51, s)) + 0.012 * smootherstep(range(PRESS_AT, PRESS_AT + 0.7, s));
      if (s >= BLINKS[3] + 0.6) {
        const z = this.bodyZ.at(s) + 0.1;
        q.uDentC.value.set(0, z, 0.05);
        q.uDentA.value.set(-0.17, z + 0.04, 0.03);
        q.uDentB.value.set(0.17, z + 0.04, 0.03);
      } else if (s >= WEIGHT_AT) {
        q.uDentC.value.set(0.02, -1.42, 0.035 * smootherstep(range(WEIGHT_AT, WEIGHT_AT + 0.4, s)));
      }
    }
    for (const { root, side } of this.hands) {
      root.visible = s >= BLINKS[3] + 0.6 && s < DARK_AT;
      if (!root.visible) continue;
      // first one, then the other, each put down slowly on the cloth nearer to you
      const first = side < 0;
      const a = first ? smootherstep(range(CLIMB_AT + 0.5, CLIMB_AT + 2, s)) : smootherstep(range(CLIMB_AT + 1.6, CLIMB_AT + 3.1, s));
      const b = first ? smootherstep(range(CLIMB_AT + 3.6, CLIMB_AT + 5, s)) : smootherstep(range(CLIMB_AT + 4.6, CLIMB_AT + 6, s));
      const along = a * 0.5 + b * 0.5;
      const lifted = Math.sin(a * Math.PI) * 0.05 + Math.sin(b * Math.PI) * 0.05;
      const z = lerp(-1.02, -0.34, along);
      const x = side * lerp(0.3, 0.52, along);
      root.position.set(x, 0.555 + quiltAt(x, z) * 0.8 + lifted, z);
      root.rotation.y = -side * 0.22;
    }
  }

  /** Lids, tunnel, focus, how afraid. */
  private updateEye(s: number): void {
    let lid = 1;
    for (const at of BLINKS) {
      const shut = smootherstep(range(at, at + BLINK_SHUT, s)) * (1 - smootherstep(range(at + BLINK_OPEN, at + BLINK_END, s)));
      lid = Math.min(lid, 1 - shut);
    }
    if (this.blinkUp) lid = Math.min(lid, 1 - smootherstep(range(CEILING_AT - 0.25, CEILING_AT - 0.05, s)) * (1 - smootherstep(range(CEILING_AT + 0.05, CEILING_AT + 0.3, s))));
    if (REDUCED_MOTION) lid = Math.min(lid, 1 - smootherstep(range(LOOK_UP_AT - 0.3, LOOK_UP_AT, s)) * (1 - smootherstep(range(LOOK_UP_AT + 0.75, LOOK_UP_AT + 1.1, s))));
    this.lid.uLid.value = lid;
    // tunnel vision: it closes as the air goes; trying to move closes it a little more
    const closing = s < PRESS_AT ? lerp(1.7, 1.25, smootherstep(range(CLIMB_AT, PRESS_AT, s))) : s < SHUTTER_AT ? lerp(1.25, TUNNEL[0], smootherstep(range(PRESS_AT, SHUTTER_AT, s))) : lerp(TUNNEL[0], TUNNEL[1], smootherstep(range(SHUTTER_AT, DARK_AT, s)));
    this.lid.uTunnel.value = s < DARK_AT ? closing - this.strain * 0.1 : 1.7;
    this.black = s >= DARK_AT && s < DAWN_AT ? 1 : s >= DAWN_AT ? Math.max(1 - smootherstep(range(DAWN_AT, DAWN_AT + 0.9, s)), s >= CUT_AT ? 1 : 0) : 0;
    this.focus = s < CLIMB_AT ? 3.6 : lerp(1.2, 0.34, smootherstep(range(CLIMB_AT, FACE_AT + 1, s)));
    if (s >= DAWN_AT) this.focus = 3.4;
    this.aperture = s < CLIMB_AT ? 3 : s < DARK_AT ? 1.2 : 2;
    this.fear = s < DOOR_OPENS ? 0.2 : s < BLINKS[1] ? 0.35 : s < CLIMB_AT ? lerp(0.45, 0.7, range(BLINKS[1], CLIMB_AT, s)) : s < DARK_AT ? lerp(0.7, 1, range(CLIMB_AT, PRESS_AT, s)) : s < LOOK_UP_AT ? 0.12 : 0.9;
  }

  /** Whatever the viewer tries: the breath catches, the picture shudders a hair, nothing moves. And the ceiling at the end. */
  private reach(s: number, frame: RoomFrame): void {
    const input = frame.input;
    const dt = frame.paused ? 0 : frame.dt;
    this.sinceCatch += dt;
    this.shudder *= Math.exp(-7 * dt);
    this.strain *= Math.exp(-1.2 * dt);
    const tried = input.idle < this.lastIdle - 1e-3;
    this.lastIdle = input.idle;
    if (tried && s > 1 && s < DARK_AT && this.sinceCatch > CATCH_GAP + ((this.catchTurn * 0.37) % 1)) {
      this.sinceCatch = 0;
      this.shudder = 1;
      this.strain = 1;
      this.catchTurn = (this.catchTurn + 1) % 4;
      this.sound.play(`rooms/breath_catch_${this.catchTurn + 1}.mp3`, { gain: 0.3 });
    }
    // the thing on the ceiling is there from now on; if the viewer is looking up already, the eye has to shut once
    if (!this.blinkUp && s >= CEILING_AT - 0.25 && s < CEILING_AT && input.gazePitch > LOOKED_UP) this.blinkUp = true;
    // the heart, in your own ears
    this.sinceBeat += dt;
    const gap = lerp(HEART_GAP[0], HEART_GAP[1], range(PRESS_AT, DARK_AT, s));
    if (this.heart && this.sinceBeat > gap) {
      this.sinceBeat = 0;
      this.sound.play('rooms/heart_beat.mp3', { gain: 0.4 });
    }
  }
}
