import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Bone,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Points,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { SpotSpec } from '../../../config/nightmare.config';
import { rigClock, setClock } from '../../dream/ClockRig';
import { meterUVs, type PropCrowd } from '../../dream/DreamKit';
import { randomFrom, type FigureSpec, type HeroFigure } from '../../dream/FigureKit';
import type { DreamLight } from '../../dream/LightPool';
import { clamp, range, smootherstep } from '../../math';
import { WARP_GLSL, warpUniforms } from '../../render/Warp';
import { GlideTrack } from '../../timeline/Track';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey, RoomPose } from '../Room';
import { Room } from '../Room';
import { PALETTE, type Facing } from '../RoomKit';
import type { RoomVoice, RoomVoiceOptions } from '../RoomSound';

type V3 = readonly [number, number, number];

/** The dining room (m): half its width, the wall with the doorway you stand in, the wall with the way to the front door, its height, how thick its walls are. */
const HALF_W = 2.25;
const NEAR_Z = 1.9;
const FAR_Z = -3.1;
const H = 2.8;
const WALL_T = 0.14;
/** The doorway you stand in, and the corridor of the evenings behind it (m). */
const DOORWAY_HALF = 0.65;
const DOORWAY_H = 2.2;
const CORRIDOR_HALF = 0.85;
const CORRIDOR_END = 6.2;
/** The opening in the far wall, the hall beyond it, the front door at its end and the frosted glass above that door (m). */
const OPENING_HALF = 0.65;
const OPENING_H = 2.25;
const HALL_HALF = 1.05;
const HALL_END = -6.6;
const FRONT_W = 1.1;
const FRONT_H = 2.15;
const FANLIGHT: readonly [number, number] = [2.27, 2.6];
/** How far the front door stands open (rad), and how far its leaf stands off the floor: the line of light under it (m). */
const FRONT_OPEN = 1.72;
const UNDER_DOOR = 0.016;
/** Outside: how deep the step is, how far below the floor its top and the street lie, where the grey of the street in fog hangs (m). */
const STEP_DEPTH = 0.8;
const STEP_TOP = -0.02;
const GROUND_Y = -0.17;
const SKY_Z = -19;

/** The table (m): where it stands, its size against the file, half its length once turned. The chairs' size against the file. */
const TABLE_Z = -0.55;
const TABLE_SCALE = 0.9;
const TABLE_HALF_L = 1.015;
const CHAIR_SCALE = 0.95;
/** Where they sit (m): the father on the left, the mother on the right, the plates in from the edge; how high hips are on these chairs. */
const SIDE_X = 0.84;
const FATHER_Z = TABLE_Z - 0.38;
const MOTHER_Z = TABLE_Z - 0.16;
const PLATE_X = 0.33;
const HIPS_Y = 0.57;
/** The little one sits at the far end, turned in its chair toward the front door (m, rad: its heading, how far its head turns further, how far it bows). */
const CHILD_Z = TABLE_Z - TABLE_HALF_L - 0.25;
const CHILD_HEADING = -Math.PI / 2;
const CHILD_LOOK = -1.05;
const CHILD_BOW = 0.14;
/** Your place, at the near end (m), and where your chair is put away later: against the right wall. */
const MY_CHAIR_Z = TABLE_Z + TABLE_HALF_L + 0.25;
const MY_PLATE_Z = TABLE_Z + TABLE_HALF_L - 0.3;
const CHILD_PLATE_Z = TABLE_Z - TABLE_HALF_L + 0.3;
const PUT_AWAY: readonly [number, number] = [HALF_W - 0.31, TABLE_Z + 0.12];
/** Where the little one's chair is left once they have gone: off to one side, still turned toward the front door (m, rad). */
const CHILD_CHAIR_LEFT: readonly [number, number, number] = [-0.98, CHILD_Z + 0.05, 2.95];
/** How far in the chairs are pushed once nobody sits on them (m). */
const PUSHED_IN = 0.15;
/** Where the brim of a hat sits on a head: this far above the head's bone (m). */
const HAT_ON_HEAD = 0.13;
/** Time in the sitting clip that is the pose they keep (s). */
const SIT_POSE = 4.2;

/** The lamp over the table: the bottom of its cloth shade and how tall that is (m), how its cloth glows, the light it pours down (cd, half angle in deg). */
const LAMP_Y = 1.92;
const SHADE_H = 0.26;
const SHADE_GLOW = 0.75;
const LAMP_I = 5.6;
const LAMP_CONE = 60;
/** What the lamp gives the rest of the room: through its cloth, up and round (cd, m), and back up off the white of the cloth on the table. */
const GLOW_I = 1.6;
const GLOW_REACH = 5;
const BOUNCE_I = 0.6;
const BOUNCE_REACH = 4;
/** The grey from the open front door: from outside, a little above the door (m, cd, deg), then what of it comes through the far opening onto the table. */
const DOOR_LIGHT_AT: V3 = [0, 2.2, HALL_END - 2.2];
const DOOR_LIGHT_TO: V3 = [0, 0.2, FAR_Z + 0.5];
const DOOR_I = 60;
const DOOR_CONE = 34;
const GREY_AT: V3 = [0, 1.55, HALL_END + 0.9];
const GREY_TO: V3 = [0, 0.65, 0.4];
const GREY_I = 30;
const GREY_CONE = 13;
const GREY = 0xd2d8dc;
/** The hall's own faint light, from the glass over the front door: before, while the door stands open (low: their backs stay dark), once it has shut (cd). The corridor's lamp behind you. */
const HALL_DARK = 0.25;
const HALL_OPEN = 0.15;
const HALL_SHUT = 0.55;
const CORRIDOR_I = 1.3;
/** How its shade glows (the kit's lamp table glows this much). */
const CORRIDOR_SHADE = 1.8;
/** What of the grey reaches the dining room's walls once the lamp is out, over the table and by the near wall, while the door is open and once it has shut (cd, m). */
const ROOM_GREY_I = 1.1;
const ROOM_GREY_SHUT = 0.6;
const ROOM_GREY_REACH = 6;
const NEAR_GREY_I = 1.4;
const NEAR_GREY_SHUT = 0.6;
const NEAR_GREY_REACH = 4.5;
/** How bright the glass over the front door and the gap under it are (times their color). */
const FANLIGHT_GLOW = 0.2;
const GAP_GLOW = 0.8;

/** Eating (m, s): a fork's length and how much larger than life, how far the wrist is from its tip, how far toward the mouth it comes, how it leans there, chewing (Hz). */
const FORK_LENGTH = 0.185;
const FORK_SIZE = 1.2;
const GRIP = 0.2;
const FORK_LIFT = 0.62;
const AIM_BACK = 0.55;
const AIM_UP = 0.85;
const FORK_SCRAPE = 0.022;
const CHEW_HZ = 1.6;
/** The mouth from the head's bone (m), how far heads are bowed over plates, how far a bite and a chew nod them (rad). */
const MOUTH_FORWARD = 0.1;
const EAT_BOW = 0.42;
const BITE_NOD = 0.12;
const CHEW_NOD = 0.03;
/** Bones a bow or a turn is shared out over (its share of each). */
const BENDS = [
  { bone: 'Bip01_Spine1', bow: 0.1, turn: 0.1 },
  { bone: 'Bip01_Spine2', bow: 0.14, turn: 0.18 },
  { bone: 'Bip01_Neck', bow: 0.32, turn: 0.3 },
  { bone: 'Bip01_Head', bow: 0.44, turn: 0.42 },
] as const;
/** She hears something: how far her head lifts, turns toward you and tilts (rad). */
const LISTEN_LIFT = 0.3;
const LISTEN_TURN = 0.38;
const LISTEN_TILT = 0.24;

/** When things happen (s). The narrator speaks over the room at 2: nothing loud near it. */
const CREAK_AT = 5.7;
const LISTEN_AT = 6;
const LISTEN_HOLD = 1.4;
const BLINKS = [12, 17, 22] as const;
/** A blink: how long the eye is shut (s), how long it takes to close and to open. What changes, changes while it is shut. */
const BLINK = 0.25;
const BLINK_IN = 0.05;
const BLINK_OUT = 0.08;
const CHANGES = BLINKS.map((at) => at + BLINK / 2);
const SILENCE_AT = 20.8;
const SHUTTER_AT = 23;
/** Their coats as they stand at the door (s). */
const COAT_AT = 23.6;
const LINE_AT = 24.3;
const CLOSE_AT = 30;
const CLOSE_LEN = 1.2;
const SHUT_AT = CLOSE_AT + CLOSE_LEN - 0.05;
/** The key, from outside: each turn grinds and then the bolt goes (s). The second lands on the cut. */
const KEY_TURNS: readonly (readonly [grind: number, length: number, bolt: number])[] = [
  [31.18, 0.3, 31.5],
  [33.02, 0.8, 33.88],
];

/** Air: the dinner under its lamp, then the grey from the door. */
const AIR_WARM: RoomAir = {
  fog: { color: 0x080b0a, density: 0.03 },
  env: 'evening',
  envIntensity: 0.05,
  sky: 0,
  grade: { exposure: 1.32, saturation: 0.8, warmth: 0.035, tint: -0.015, flare: 0.002 },
};
const AIR_GREY: RoomAir = {
  fog: { color: 0x0a0d0f, density: 0.03 },
  env: 'evening',
  envIntensity: 0.04,
  sky: 0,
  grade: { exposure: 1.34, saturation: 0.58, warmth: -0.04, tint: -0.01, flare: 0.002 },
};
/** How much the eye floats while it walks and while it stands. */
const DRIFT_WALK = REDUCED_MOTION ? 0.3 : 0.7;
const DRIFT_STILL = REDUCED_MOTION ? 0.15 : 0.35;

const FORKS = ['rooms/fork_plate_1.mp3', 'rooms/fork_plate_2.mp3', 'rooms/fork_plate_3.mp3', 'rooms/fork_plate_4.mp3', 'rooms/fork_plate_5.mp3'];
const STABS = ['rooms/fork_stab_1.mp3', 'rooms/fork_stab_2.mp3', 'rooms/fork_stab_3.mp3', 'rooms/fork_stab_4.mp3'];
/** Beds: the house, the low dread under it, the clock, the dinner, a mouth on each side; the street through the open door. */
const BED = {
  house: 'rooms/house_tone.mp3',
  drone: 'rooms/dream_drone_low.mp3',
  clock: 'rooms/clock_tick.mp3',
  forks: 'rooms/forks_close.mp3',
  chewFather: 'rooms/chew_soft.mp3',
  chewMother: 'rooms/chew_small.mp3',
  street: 'rooms/road_fog.mp3',
  wind: 'rooms/night_wind_far.mp3',
} as const;
/** The dinner's one-shots: from when (s, once the narrator has spoken), how far apart (s, the least and how much more at most). */
const FORKS_FROM = 4.6;
const FORK_GAP: readonly [number, number] = [0.45, 1.1];
/** Beds that follow where their source is for the eye: the father's mouth, the mother's, the whole table (m). */
const PANNED: readonly (readonly ['chewFather' | 'chewMother' | 'forks', number, number])[] = [
  ['chewFather', -SIDE_X, FATHER_Z],
  ['chewMother', SIDE_X, MOTHER_Z],
  ['forks', 0, TABLE_Z],
];
/** Their levels while the dinner goes on (the dinner thins after each blink). */
const LEVEL = { house: 0.2, drone: 0.08, clock: 0.07, forks: [0.24, 0.18, 0.13], chewFather: 0.12, chewMother: 0.13, street: 0.22, wind: 0.1 } as const;
/** One-shots on their beats: second, file, how. */
const CUES: readonly (readonly [number, string, RoomVoiceOptions])[] = [
  [CREAK_AT, 'rooms/floor_step_near_2.mp3', { gain: 0.32 }],
  [BLINKS[0] - BLINK_IN, 'rooms/eye_blink.mp3', { gain: 0.4 }],
  [BLINKS[1] - BLINK_IN, 'rooms/eye_blink.mp3', { gain: 0.4 }],
  [BLINKS[2] - BLINK_IN, 'rooms/eye_blink.mp3', { gain: 0.45 }],
  [COAT_AT, 'rooms/coat_move.mp3', { gain: 0.22, lowpass: 2400, reverb: 0.45 }],
  [CLOSE_AT, 'rooms/door_creak_short.mp3', { gain: 0.38, lowpass: 3000, reverb: 0.45 }],
  [SHUT_AT, 'rooms/door_shut_soft.mp3', { gain: 0.5, lowpass: 3600, reverb: 0.4 }],
  ...KEY_TURNS.flatMap(([grind, length, bolt], i): (readonly [number, string, RoomVoiceOptions])[] => [
    [grind, 'rooms/music_box_wind.mp3', { gain: 0.2, offset: 0.25 + i * 0.35, duration: length, rate: 0.7 - i * 0.08, lowpass: 2200, reverb: 0.3 }],
    [bolt, i ? 'rooms/relay_clunk_4.mp3' : 'rooms/relay_clunk_2.mp3', { gain: 0.42, rate: 0.78, lowpass: 1900, reverb: 0.35 }],
  ]),
];

export const assets: RoomAssets = {
  models: [
    'dining_table', 'dining_chair', 'plate', 'fork', 'knife', 'spoon', 'tumbler', 'pot_enamel', 'buns', 'roast_lump', 'jug',
    'dresser', 'wall_clock', 'window_wood', 'curtains', 'radiator', 'frame_gold', 'fedora',
  ],
  materials: ['wood_floor_dark', 'concrete_worn', 'linen_white'],
  sounds: [...new Set([...CUES.map((c) => c[1]), ...FORKS, ...STABS, ...Object.values(BED)])],
};

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

function canvasOf(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Which way a wall turns to face into the room (rad about Y). */
const YAW: Record<Facing, number> = { '+z': 0, '-z': Math.PI, '+x': Math.PI / 2, '-x': -Math.PI / 2 };

/** Old ceiling paint: pale, gone yellow and grey in soft patches. */
function drawPlaster(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#6f685c';
  c.fillRect(0, 0, w, h);
  const random = randomFrom(17);
  for (let i = 0; i < 30; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = (0.08 + random() * 0.3) * w;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, random() < 0.6 ? `rgba(40,30,16,${0.08 + random() * 0.14})` : `rgba(255,248,230,${0.04 + random() * 0.06})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
}

/** The street outside as the hall sees it: grey fog, lighter low down where the road goes, a darker sky over it. */
function drawStreet(c: CanvasRenderingContext2D, w: number, h: number): void {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2c3034');
  g.addColorStop(0.42, '#7d8387');
  g.addColorStop(0.62, '#a3a8aa');
  g.addColorStop(1, '#6a6f70');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  // the fog is never even
  const random = randomFrom(71);
  for (let i = 0; i < 40; i++) {
    const x = random() * w;
    const y = h * (0.3 + random() * 0.5);
    const r = (0.05 + random() * 0.18) * w;
    const blot = c.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.04 + random() * 0.07;
    blot.addColorStop(0, random() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`);
    blot.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = blot;
    c.fillRect(0, 0, w, h);
  }
}

/** Frosted glass over the front door: the grey behind it, three glazing bars, dirt in the corners. */
function drawFanlight(c: CanvasRenderingContext2D, w: number, h: number): void {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#7b8184');
  g.addColorStop(1, '#9ea3a5');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  const random = randomFrom(5);
  for (let i = 0; i < 900; i++) {
    c.fillStyle = `rgba(0,0,0,${random() * 0.06})`;
    c.fillRect(random() * w, random() * h, 2, 2);
  }
  const edge = c.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, w * 0.6);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(20,18,14,0.55)');
  c.fillStyle = edge;
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#16120d';
  for (const x of [0.25, 0.5, 0.75]) c.fillRect(x * w - w * 0.012, 0, w * 0.024, h);
}

/** Dusk behind the curtains: a cold blue going to black. */
function drawDusk(c: CanvasRenderingContext2D, w: number, h: number): void {
  const g = c.createRadialGradient(w * 0.55, h * 0.3, 0, w * 0.55, h * 0.3, w * 0.8);
  g.addColorStop(0, '#2b3a49');
  g.addColorStop(1, '#070a0e');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}

/** Light lying on the floor in front of a door, from the gap under it: bright at the door, gone in a hand's width. */
function drawSpill(c: CanvasRenderingContext2D, w: number, h: number): void {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  const side = c.createLinearGradient(0, 0, w, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)');
  side.addColorStop(0.15, 'rgba(0,0,0,0)');
  side.addColorStop(0.85, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)');
  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = side;
  c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = 'source-over';
}

/** One of them at the table: its bones, how it sits, and how it eats. */
interface Diner {
  hero: HeroFigure;
  /** Spine1, Spine2, Neck, Head, jaw, then the fork arm and the other arm (upper, lower, hand each). */
  bones: Bone[];
  rest: Quaternion[];
  /** The way it faces and the axis a bow turns about. */
  forward: Vector3;
  axis: Vector3;
  /** Fork tip over the plate and the way the fork leans there, and up at the mouth; the other hand; where elbows go. */
  plateAt: Vector3;
  downFork: Vector3;
  aim: Vector3;
  otherAt: Vector3;
  pole: Vector3;
  otherPole: Vector3;
  fork: number;
  cycle: number;
  phase: number;
  /** How far its head is bowed already in the pose (rad), and which way each arm's own axis runs. */
  restBow: number;
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
const qD = new Quaternion();
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

/** A blink at `at`: 0 open, 1 shut. */
function blinkAt(s: number, at: number): number {
  if (s < at - BLINK_IN || s > at + BLINK + BLINK_OUT) return 0;
  if (s < at) return smootherstep(range(at - BLINK_IN, at, s));
  if (s <= at + BLINK) return 1;
  return 1 - smootherstep(range(at + BLINK, at + BLINK + BLINK_OUT, s));
}

const track = (keys: readonly (readonly [number, number])[]): GlideTrack =>
  new GlideTrack(
    keys.map((k) => k[0]),
    keys.map((k) => k[1]),
  );

/**
 * You came as far as the door. The dining room of the house, under its lamp: the three of them eating, your
 * place laid, steam from the pot. You walk in and round the table and nobody sees you; once she nearly hears
 * you. Then you blink, and your plate is gone; you blink, and your chair stands against the wall; you blink,
 * and the table is bare, the lamp is out, and they are at the open front door in their coats, their backs to
 * you. The door shuts. The key turns, twice, from outside.
 */
export default class Unseen extends Room {
  readonly keys: readonly RoomKey[];
  air: RoomAir = AIR_WARM;
  film = { bloom: 0.65, bloomFrom: 0.8, grain: 0.4, scratches: 0.08, flicker: 0.015, weave: 0.0003 };
  focus = 3;
  aperture = 1.6;
  drift = DRIFT_WALK;
  fear = 0.25;

  private readonly eye: RoomPose = { position: new Vector3(), yaw: 0, pitch: 0, roll: 0, fov: 50 };
  private readonly lampSpots: Room['spots'];
  private readonly greySpots: Room['spots'];
  private readonly doorKey: SpotSpec;
  private readonly greyKey: SpotSpec;
  private readonly bounce: DreamLight;
  private readonly lampGlow: DreamLight;
  private readonly hallFill: DreamLight;
  private readonly roomGrey: DreamLight;
  private readonly nearGrey: DreamLight;
  private readonly corridorLamp: DreamLight;
  private readonly glowing: MeshStandardMaterial[];
  private readonly shading: Mesh;
  private readonly lit: Object3D[] = [];
  private readonly bulb: MeshBasicMaterial;
  private readonly setting = new Group();
  private readonly mine: PropCrowd[] = [];
  private readonly forks: PropCrowd;
  private readonly diners: Diner[] = [];
  private readonly child: HeroFigure;
  private readonly chairs: { father: Object3D; mother: Object3D; child: Object3D; mine: Object3D };
  private readonly leavers = new Group();
  private readonly frontLeaf: Object3D;
  private readonly gap: Mesh;
  private readonly spill: Mesh;
  private readonly warmMotes: Points;
  private readonly hallMotes: Points;
  private readonly ticking: { value: number }[] = [];
  private readonly steamTime = { value: 0 };
  private stage = -1;
  private shadowFrames = 0;

  private readonly focusTrack = track([[0, 3.2], [4.4, 2.6], [6, 1.15], [7.6, 1.15], [11.6, 1.7], [13.2, 1.5], [16.6, 1.25], [18, 1.3], [19.8, 2.2], [21.7, 3.6], [22.2, 8.4], [34, 7.9]]);
  private readonly apertureTrack = track([[0, 1.6], [21.7, 1.6], [22.2, 2.6], [34, 2.6]]);
  private readonly fearTrack = track([[0, 0.22], [6, 0.32], [12, 0.38], [17, 0.45], [SILENCE_AT, 0.55], [22.2, 0.62], [CLOSE_AT, 0.55], [34, 0.6]]);

  private readonly beds = new Map<keyof typeof BED, RoomVoice>();
  private readonly pans = new Map<keyof typeof BED, number>();

  constructor(ctx: RoomContext) {
    super(ctx);
    const S = this.seconds;
    const key = (s: number, at: V3, yaw: number, pitch: number, fov: number): RoomKey => ({ t: s / S, at, yaw, pitch, fov });
    this.keys = [
      key(0, [0, 1.6, 2.25], 0, -9, 46),
      key(2.6, [0, 1.6, 2.02], 0, -9, 46),
      key(3.6, [0.06, 1.6, 1.72], -4, -9, 46),
      key(4.7, [0.78, 1.6, 0.82], -14, -12, 47),
      key(LISTEN_AT, [1.48, 1.6, -0.12], 54, -22, 47),
      key(LISTEN_AT + LISTEN_HOLD + 0.2, [1.5, 1.6, -0.08], 56, -21, 47),
      key(11.6, [1.22, 1.6, 1.18], 51, -27, 46),
      key(13.2, [0.72, 1.6, 1.42], 22, -30, 46),
      key(16.6, [0.02, 1.6, 1.5], 0, -33, 46),
      key(18, [0, 1.6, 1.44], -6, -27, 46),
      key(19.6, [-0.1, 1.6, 1.3], -46, -16, 44),
      key(21.7, [0, 1.6, 1.08], 0, -7, 37),
      key(SHUTTER_AT, [0, 1.6, 1.04], 0, -6, 35),
      key(CLOSE_AT - 0.2, [0, 1.6, 0.8], 0, -5, 31),
      key(S, [0, 1.6, 0.72], 0, -5, 30),
    ];

    const house = this.buildHouse();
    this.shading = house.shading;
    this.corridorLamp = house.corridor.light;
    const table = this.buildTable();
    this.forks = table.forks;
    this.chairs = table.chairs;
    const lamp = this.buildLamp(table.top);
    this.bulb = lamp.bulb;
    this.glowing = [lamp.shade, house.corridor.shade];
    this.buildDressing();
    const front = this.buildFrontDoor();
    this.frontLeaf = front.leaf;
    this.gap = front.gap;
    this.spill = front.spill;

    // the family at dinner: the father eats with his right hand, the mother with her left; the little one is turned away
    const plateY = table.top + 0.04;
    this.diners.push(this.diner({ avatar: 'figure_man', face: 'blank', bleach: 0.45, tint: 0x726e68 }, -SIDE_X, FATHER_Z, Math.PI / 2, new Vector3(-PLATE_X, plateY, FATHER_Z), 'R', 0, 4.6, 1.3));
    this.diners.push(this.diner({ avatar: 'figure_woman', face: 'blank', bleach: 0.55, tint: 0x8c827b }, SIDE_X, MOTHER_Z, -Math.PI / 2, new Vector3(PLATE_X, plateY, MOTHER_Z), 'L', 1, 4, 2.6));
    this.child = this.sitDown({ avatar: 'figure_child', face: 'blank', bleach: 0.5 }, 0, CHILD_Z, CHILD_HEADING);
    this.turnChild();
    this.poseDiners(0);

    this.buildLeavers();

    // light: the lamp over the table while they eat; then the grey from the open door
    const lampAt: V3 = [0, LAMP_Y + 0.1, TABLE_Z];
    this.lampSpots = [this.spot(lampAt, [0, 0, TABLE_Z], 0xffd2a0, LAMP_I, LAMP_CONE, 0.55), null, null];
    this.doorKey = this.spot(DOOR_LIGHT_AT, DOOR_LIGHT_TO, GREY, DOOR_I, DOOR_CONE, 0.45);
    this.greyKey = this.spot(GREY_AT, GREY_TO, GREY, GREY_I, GREY_CONE, 0.7);
    this.greySpots = [this.doorKey, this.greyKey, null];
    this.spots = this.lampSpots;
    this.bounce = this.light([0, table.top + 0.25, TABLE_Z], PALETTE.warm, BOUNCE_I, BOUNCE_REACH);
    this.lampGlow = this.light([0, LAMP_Y + SHADE_H * 0.6, TABLE_Z], PALETTE.warm, GLOW_I, GLOW_REACH);
    this.hallFill = this.light([0, 2.35, HALL_END + 0.4], 0xb8c4cc, HALL_DARK, 4);
    // the far wall faces away from its own opening: it stays the darkest, round the bright door
    this.roomGrey = this.light([0, 2.2, TABLE_Z + 0.75], GREY, 0, ROOM_GREY_REACH);
    this.nearGrey = this.light([0, 2.3, NEAR_Z - 0.7], GREY, 0, NEAR_GREY_REACH);

    // dust: warm in the lamp's air, grey in the hall's once the door is open
    const b = this.build;
    const warm = b.motes(150, { x: [-1.3, 1.3], y: [0.9, 2.5], z: [TABLE_Z - 1.6, TABLE_Z + 1.6] }, this.root, { strength: 0.38, size: 0.007, color: 0xffd9b0 });
    this.warmMotes = warm.points;
    this.ticking.push(warm.time);
    const grey = b.motes(160, { x: [-0.9, 0.9], y: [0.2, 2.4], z: [HALL_END + 0.3, FAR_Z + 1.5] }, this.root, { strength: 0.42, size: 0.007, color: 0xdfe6ea, seed: 41 });
    this.hallMotes = grey.points;
    this.ticking.push(grey.time);

    this.placeBeats();
    this.applyStage(0);
  }

  /** Walls, floor and ceiling: the corridor behind you, the dining room, the hall to the front door. Returns the walls that keep the door's grey out, and the corridor's lamp. */
  private buildHouse(): { shading: Mesh; corridor: { shade: MeshStandardMaterial; light: DreamLight } } {
    const b = this.build;
    const k = this.kit;
    const root = this.root;
    const paper = b.damask(PALETTE.damaskGreen, 0.9);
    const floor = k.surface('wood_floor_dark', 2, { color: new Color(0x9c8c7a), roughness: 0.62 });
    root.add(k.floor(-HALF_W, HALF_W, HALL_END - WALL_T, CORRIDOR_END, 0, floor));
    const plaster = canvasOf(256, 256, drawPlaster);
    plaster.wrapS = plaster.wrapT = RepeatWrapping;
    plaster.repeat.setScalar(1 / 1.6);
    const ceilingPaint = new MeshStandardMaterial({ map: plaster, roughness: 0.95 });
    const ceiling = k.floor(-HALF_W, HALF_W, HALL_END - WALL_T, CORRIDOR_END, H, ceilingPaint);
    ceiling.rotation.x = Math.PI / 2;
    root.add(ceiling);

    // every wall is one draw: paper above, wood below; the walls that face the front door's light apart, to cast its shadow
    const papered: BufferGeometry[] = [];
    const shading: BufferGeometry[] = [];
    const panels: BufferGeometry[] = [];
    const loose = new Group();
    const plane = (x: number, z: number, w: number, h: number, facing: Facing, y: number, into: BufferGeometry[]) => {
      const m = k.wall(w, h, paper);
      m.position.set(x, y + h / 2, z);
      m.rotation.y = YAW[facing];
      m.updateMatrix();
      into.push(m.geometry.applyMatrix4(m.matrix));
    };
    const panel = (x: number, z: number, length: number, facing: Facing) => {
      const g = b.wainscot(x, z, length, facing, loose);
      g.updateMatrixWorld(true);
      g.traverse((o) => {
        if ((o as Mesh).isMesh) panels.push((o as Mesh).geometry.clone().applyMatrix4(o.matrixWorld));
      });
    };
    const across = (x0: number, x1: number, z: number, facing: Facing, into = papered, y0 = 0, y1 = H) => {
      plane((x0 + x1) / 2, z, x1 - x0, y1 - y0, facing, y0, into);
      if (y0 === 0) panel((x0 + x1) / 2, z, x1 - x0, facing);
    };
    const along = (x: number, z0: number, z1: number, facing: Facing) => {
      plane(x, (z0 + z1) / 2, z1 - z0, H, facing, 0, papered);
      panel(x, (z0 + z1) / 2, z1 - z0, facing);
    };

    // the dining room; its far wall keeps the grey of the door out but for its opening
    along(-HALF_W, FAR_Z, NEAR_Z, '+x');
    along(HALF_W, FAR_Z, NEAR_Z, '-x');
    across(-HALF_W, -DOORWAY_HALF, NEAR_Z, '-z');
    across(DOORWAY_HALF, HALF_W, NEAR_Z, '-z');
    across(-DOORWAY_HALF, DOORWAY_HALF, NEAR_Z, '-z', papered, DOORWAY_H);
    across(-HALF_W, -OPENING_HALF, FAR_Z, '+z', shading);
    across(OPENING_HALF, HALF_W, FAR_Z, '+z', shading);
    across(-OPENING_HALF, OPENING_HALF, FAR_Z, '+z', shading, OPENING_H);
    // the corridor of the evenings, behind you
    const back = NEAR_Z + WALL_T;
    along(-CORRIDOR_HALF, back, CORRIDOR_END, '+x');
    along(CORRIDOR_HALF, back, CORRIDOR_END, '-x');
    across(-CORRIDOR_HALF, -DOORWAY_HALF, back, '+z');
    across(DOORWAY_HALF, CORRIDOR_HALF, back, '+z');
    across(-CORRIDOR_HALF, CORRIDOR_HALF, back, '+z', papered, DOORWAY_H);
    across(-CORRIDOR_HALF, CORRIDOR_HALF, CORRIDOR_END, '-z');
    // the hall to the front door
    const hall = FAR_Z - WALL_T;
    along(-HALL_HALF, HALL_END, hall, '+x');
    along(HALL_HALF, HALL_END, hall, '-x');
    across(-HALL_HALF, -FRONT_W / 2, HALL_END, '+z', shading);
    across(FRONT_W / 2, HALL_HALF, HALL_END, '+z', shading);
    plane(0, HALL_END, FRONT_W, H - FRONT_H, '+z', FRONT_H, shading);

    // the thickness of the walls where you can see through them (matte: the door's light grazes along it), their wooden casings, a cornice
    const linings: BufferGeometry[] = [];
    const block = (into: BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number) => into.push(meterUVs(new BoxGeometry(w, h, d)).translate(x, y, z));
    const box = (w: number, h: number, d: number, x: number, y: number, z: number) => block(panels, w, h, d, x, y, z);
    const lining = (w: number, h: number, d: number, x: number, y: number, z: number) => block(linings, w, h, d, x, y, z);
    const opening = (half: number, h: number, z: number, faces: readonly number[]) => {
      for (const side of [-1, 1]) lining(0.02, h, WALL_T, side * (half + 0.01), h / 2, z - WALL_T / 2);
      lining(half * 2 + 0.04, 0.02, WALL_T, 0, h + 0.01, z - WALL_T / 2);
      for (const face of faces) {
        const fz = face > 0 ? z + 0.012 : z - WALL_T - 0.012;
        for (const side of [-1, 1]) box(0.09, h + 0.09, 0.024, side * (half + 0.045), (h + 0.09) / 2, fz);
        box(half * 2 + 0.18, 0.09, 0.024, 0, h + 0.045, fz);
      }
    };
    opening(DOORWAY_HALF, DOORWAY_H, back, [1, -1]);
    opening(OPENING_HALF, OPENING_H, FAR_Z, [1]);
    for (const side of [-1, 1]) lining(0.02, FRONT_H, WALL_T, side * (FRONT_W / 2 + 0.01), FRONT_H / 2, HALL_END - WALL_T / 2);
    lining(FRONT_W + 0.04, 0.02, WALL_T, 0, FRONT_H + 0.01, HALL_END - WALL_T / 2);
    const cornice = (w: number, x: number, z: number, alongX: boolean) => box(alongX ? w : 0.07, 0.1, alongX ? 0.07 : w, x, H - 0.05, z);
    cornice(HALF_W * 2, 0, NEAR_Z - 0.035, true);
    cornice(HALF_W * 2, 0, FAR_Z + 0.035, true);
    cornice(NEAR_Z - FAR_Z, -HALF_W + 0.035, (NEAR_Z + FAR_Z) / 2, false);
    cornice(NEAR_Z - FAR_Z, HALF_W - 0.035, (NEAR_Z + FAR_Z) / 2, false);

    const whole = (parts: BufferGeometry[], material: Material): Mesh => {
      const mesh = new Mesh(mergeGeometries(parts)!, material);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      root.add(mesh);
      return mesh;
    };
    whole(papered, paper);
    whole(panels, b.wood(1.2));
    whole(linings, ceilingPaint);
    const shade = whole(shading, paper);

    // a rug under the table, and the rose in the ceiling the lamp hangs from
    root.add(k.floor(-1.45, 1.45, TABLE_Z - 2, TABLE_Z + 1.95, 0.006, b.carpet('#2c1913', 0.8)));
    const rose = new Mesh(new LatheGeometry([[0, -0.03], [0.05, -0.03], [0.07, -0.015], [0.16, -0.012], [0.2, -0.004], [0.23, 0]].map(([r, y]) => new Vector2(r, y)), 28), ceilingPaint);
    rose.position.set(0, H, TABLE_Z);
    rose.frustumCulled = false;
    root.add(rose);

    // at the end of the corridor, its lamp on its little table
    const corner = b.lampTable(0, CORRIDOR_END - 0.3, root);
    b.contactShadow(0, CORRIDOR_END - 0.3, 0.5, root, 0.6).scale.set(1, 0.65, 1);
    return { shading: shade, corridor: { shade: corner.shade, light: this.light(corner.lightAt, PALETTE.warm, CORRIDOR_I, 4.6) } };
  }

  /** The table as they left it every evening: its top, the forks they hold, and the chairs. */
  private buildTable(): { top: number; forks: PropCrowd; chairs: { father: Object3D; mother: Object3D; child: Object3D; mine: Object3D } } {
    const k = this.kit;
    const b = this.build;
    const table = k.prop('dining_table', [0, 0, TABLE_Z], { scale: TABLE_SCALE, rotation: [0, 90, 0], castShadow: true }, this.root);
    table.updateWorldMatrix(true, true);
    const top = new Box3().setFromObject(table).max.y - this.origin.y + 0.003;
    const shadow = b.contactShadow(0, TABLE_Z, 1.5, this.root, 0.8);
    shadow.scale.set(0.8, 1.2, 1);

    const chair = (x: number, z: number, heading: number): Object3D => {
      const c = k.prop('dining_chair', [x, 0, z], { scale: CHAIR_SCALE, castShadow: true }, this.root);
      c.rotation.y = heading;
      b.contactShadow(0, 0, 0.42, c, 0.62);
      return c;
    };
    const chairs = {
      father: chair(-SIDE_X + 0.02, FATHER_Z, Math.PI / 2),
      mother: chair(SIDE_X - 0.02, MOTHER_Z, -Math.PI / 2),
      child: chair(-0.02, CHILD_Z, CHILD_HEADING),
      mine: chair(0, MY_CHAIR_Z, Math.PI),
    };

    // what is on it: one group, cleared at once
    const g = this.setting;
    this.root.add(g);
    const lying = (crowd: PropCrowd, i: number, x: number, z: number, dx: number, dz: number, length: number) => {
      v2.set(dx, 0, dz).normalize();
      qA.setFromUnitVectors(UP, v2);
      mWork.compose(vAt.set(x - v2.x * length * 0.5, top + 0.008, z - v2.z * length * 0.5), qA, ONE);
      crowd.setMatrix(i, mWork);
    };
    const crowd = (key: string, count: number, mine: boolean, opts: { rotation?: V3; castShadow?: boolean } = {}): PropCrowd => {
      const c = k.props(key, count, opts);
      g.add(c.root);
      if (mine) this.mine.push(c);
      return c;
    };
    // the last of each of these is yours
    const plates = crowd('plate', 4, true);
    plates.set(0, -PLATE_X, top, FATHER_Z, 0);
    plates.set(1, PLATE_X, top, MOTHER_Z, 0);
    plates.set(2, 0, top, CHILD_PLATE_Z, 0);
    plates.set(3, 0, top, MY_PLATE_Z, 0);
    plates.commit();
    const forks = crowd('fork', 4, true);
    lying(forks, 2, 0.17, CHILD_PLATE_Z, 0, 1, FORK_LENGTH);
    lying(forks, 3, -0.17, MY_PLATE_Z, 0, -1, FORK_LENGTH);
    forks.commit();
    const knives = crowd('knife', 3, true);
    lying(knives, 0, -PLATE_X, FATHER_Z - 0.17, 1, 0, 0.228);
    lying(knives, 1, PLATE_X, MOTHER_Z + 0.17, -1, 0, 0.228);
    lying(knives, 2, 0.17, MY_PLATE_Z, 0, -1, 0.228);
    knives.commit();
    const spoons = crowd('spoon', 2, true);
    lying(spoons, 0, -0.2, CHILD_PLATE_Z, 0, 1, 0.176);
    lying(spoons, 1, 0.23, MY_PLATE_Z, 0, -1, 0.176);
    spoons.commit();
    const tumblers = crowd('tumbler', 4, true);
    tumblers.set(0, -0.2, top, FATHER_Z + 0.24, 0);
    tumblers.set(1, 0.2, top, MOTHER_Z - 0.24, 0);
    tumblers.set(2, 0.16, top, CHILD_PLATE_Z - 0.17, 0);
    tumblers.set(3, 0.22, top, MY_PLATE_Z - 0.24, 0);
    tumblers.commit();

    // their dinner, half eaten; your plate clean
    const meat = crowd('roast_lump', 3, false, { rotation: [90, 0, 0] });
    meat.set(0, -PLATE_X, top + 0.012, FATHER_Z + 0.02, 1.1, 0.95);
    meat.set(1, PLATE_X, top + 0.012, MOTHER_Z - 0.02, -0.5, 0.85);
    meat.set(2, 0.02, top + 0.012, CHILD_PLATE_Z, 2, 0.75);
    meat.commit();
    const discs = [[-PLATE_X, FATHER_Z], [PLATE_X, MOTHER_Z], [0, CHILD_PLATE_Z]].map(([x, z]) => new CircleGeometry(0.08, 28).rotateX(-Math.PI / 2).translate(x, top + 0.0105, z));
    const sauce = new Mesh(mergeGeometries(discs)!, new MeshStandardMaterial({ color: 0x2c0f07, roughness: 0.22 }));
    sauce.frustumCulled = false;
    sauce.receiveShadow = true;
    g.add(sauce);

    // the pot, open and steaming, its lid beside it; bread; water
    k.prop('pot_enamel', [0, top, TABLE_Z + 0.05], { nodes: ['pot_enamel_01_base'], castShadow: true }, g);
    k.prop('pot_enamel', [0.27, top, TABLE_Z + 0.3], { nodes: ['pot_enamel_01_lid'], rotation: [0, 40, 0] }, g);
    const soup = new Mesh(new CircleGeometry(0.088, 28).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: 0x3a1a0c, roughness: 0.15 }));
    soup.position.set(0, top + 0.11, TABLE_Z + 0.05);
    soup.frustumCulled = false;
    g.add(soup);
    k.prop('buns', [-0.2, top, TABLE_Z + 0.42], { rotation: [0, 80, 0] }, g);
    k.prop('jug', [0.4, top, TABLE_Z - 0.6], { rotation: [0, 200, 0] }, g);
    const steam = new Mesh(
      new PlaneGeometry(1, 1).translate(0, 0.5, 0),
      new ShaderMaterial({
        vertexShader: STEAM_VERT,
        fragmentShader: STEAM_FRAG,
        uniforms: { ...warpUniforms, uTime: this.steamTime, uColor: { value: new Color(0xffe6c8).multiplyScalar(0.24) } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    steam.position.set(0, top + 0.12, TABLE_Z + 0.05);
    steam.scale.set(0.22, 0.55, 1);
    steam.frustumCulled = false;
    steam.renderOrder = 3;
    g.add(steam);
    return { top, forks, chairs };
  }

  /** The lamp over the table on its cord from the rose: a cloth shade with the bulb in it, its halo and the light it pours down. */
  private buildLamp(top: number): { bulb: MeshBasicMaterial; shade: MeshStandardMaterial } {
    const b = this.build;
    const rig = new Group();
    rig.position.set(0, 0, TABLE_Z);
    this.root.add(rig);
    const cordLength = H - LAMP_Y - SHADE_H;
    const cord = new Mesh(new CylinderGeometry(0.005, 0.005, cordLength, 6), new MeshStandardMaterial({ color: 0x15120f, roughness: 0.6 }));
    cord.position.y = LAMP_Y + SHADE_H + cordLength / 2;
    const profile = [[0.28, 0], [0.276, 0.025], [0.24, 0.1], [0.16, 0.19], [0.085, 0.24], [0.06, SHADE_H]].map(([r, y]) => new Vector2(r, y));
    const shade = new MeshStandardMaterial({ color: 0x7a5a3c, roughness: 0.9, side: DoubleSide, emissive: new Color(PALETTE.warm), emissiveIntensity: SHADE_GLOW });
    const cloth = new Mesh(new LatheGeometry(profile, 40), shade);
    cloth.position.y = LAMP_Y;
    const bulb = new MeshBasicMaterial({ color: new Color(PALETTE.warm).multiplyScalar(12) });
    const bulbMesh = new Mesh(new SphereGeometry(0.045, 12, 8), bulb);
    bulbMesh.position.y = LAMP_Y + 0.09;
    for (const m of [cord, cloth, bulbMesh]) {
      m.frustumCulled = false;
      rig.add(m);
    }
    this.lit.push(b.glow(0, LAMP_Y + 0.05, 0, 1.25, PALETTE.warm, 0.42, rig));
    this.lit.push(b.beam(0, LAMP_Y + 0.02, 0, 0.26, 1.0, LAMP_Y - top, PALETTE.warm, 0.08, rig));
    return { bulb, shade };
  }

  /** What stands round the walls, and the window. */
  private buildDressing(): void {
    const k = this.kit;
    const b = this.build;
    const root = this.root;
    k.prop('dresser', [-HALF_W + 0.3, 0, 0.75], { rotation: [0, 90, 0] }, root);
    b.contactShadow(-HALF_W + 0.3, 0.75, 0.7, root, 0.7).scale.set(0.5, 1.05, 1);
    k.prop('radiator', [HALF_W - 0.15, 0, -2.25], { rotation: [0, -90, 0] }, root);
    k.prop('frame_gold', [HALF_W - 0.05, 1.68, PUT_AWAY[1]], { rotation: [0, -90, -2], anchor: 'center', scale: 0.72 }, root);
    // the clock: half past six, as always; it ticks, and it does not move
    const clock = k.prop('wall_clock', [HALF_W - 0.03, 1.98, -1.55], { rotation: [0, -90, 0], anchor: 'center' }, root);
    setClock(rigClock(clock), 18.5 * 3600);

    // the window on the street, its curtains drawn
    const windowZ = -1.45;
    const dusk = new Mesh(new PlaneGeometry(1.6, 1.2), new MeshBasicMaterial({ map: canvasOf(128, 96, drawDusk) }));
    dusk.rotation.y = Math.PI / 2;
    dusk.position.set(-HALF_W + 0.008, 1.52, windowZ);
    root.add(dusk);
    k.prop('window_wood', [-HALF_W + 0.09, 0.88, windowZ], { rotation: [0, 90, 0], scale: 0.85 }, root);
    const curtains = k.prop('curtains', [-HALF_W + 0.25, 0.3, windowZ], { rotation: [0, 90, 0], scale: 0.95 }, root);
    k.paint(curtains, k.surface('linen_white', 0.4, { color: new Color(0x4a382c) }));
  }

  /** The front door, the frosted glass over it, what lies outside, and the light from there. */
  private buildFrontDoor(): { leaf: Object3D; gap: Mesh; spill: Mesh } {
    const b = this.build;
    const k = this.kit;
    const root = this.root;
    const door = b.door(0, HALL_END, '+z', root, { width: FRONT_W, height: FRONT_H, color: 0x2a2620 });
    door.beyond.visible = false;
    door.leaf.position.y = UNDER_DOOR;

    // the glass over the door
    const glass = new Mesh(new PlaneGeometry(FRONT_W, FANLIGHT[1] - FANLIGHT[0]), new MeshBasicMaterial({ map: canvasOf(256, 80, drawFanlight), color: new Color(FANLIGHT_GLOW, FANLIGHT_GLOW, FANLIGHT_GLOW) }));
    glass.position.set(0, (FANLIGHT[0] + FANLIGHT[1]) / 2, HALL_END + 0.006);
    glass.frustumCulled = false;
    root.add(glass);
    const bars: BufferGeometry[] = [];
    const bar = (w: number, h: number, y: number) => bars.push(meterUVs(new BoxGeometry(w, h, 0.05)).translate(0, y, HALL_END + 0.02));
    bar(FRONT_W + 0.2, 0.06, FANLIGHT[0] - 0.03);
    bar(FRONT_W + 0.2, 0.06, FANLIGHT[1] + 0.03);
    const frame = new Mesh(mergeGeometries(bars)!, b.wood(1.2));
    frame.frustumCulled = false;
    root.add(frame);

    // under the shut door, a line of the grey; and a little of it on the boards
    const gap = new Mesh(new PlaneGeometry(FRONT_W, UNDER_DOOR + 0.004), new MeshBasicMaterial({ color: new Color(GREY).multiplyScalar(GAP_GLOW) }));
    gap.position.set(0, UNDER_DOOR / 2, HALL_END - 0.03);
    gap.frustumCulled = false;
    root.add(gap);
    const spill = new Mesh(
      new PlaneGeometry(FRONT_W + 0.2, 0.42),
      new MeshBasicMaterial({ map: canvasOf(64, 64, drawSpill), color: new Color(GREY).multiplyScalar(0.07), transparent: true, depthWrite: false, blending: AdditiveBlending }),
    );
    spill.rotation.x = -Math.PI / 2;
    spill.position.set(0, 0.004, HALL_END + 0.21);
    spill.frustumCulled = false;
    spill.renderOrder = 2;
    root.add(spill);

    // outside: the step, the street, the grey of it in fog
    const stone = k.surface('concrete_worn', 3, { color: new Color(0x8c8a86), roughness: 0.85 });
    const step = k.block(1.7, 0.16, STEP_DEPTH, stone);
    step.position.set(0, STEP_TOP - 0.08, HALL_END - WALL_T - STEP_DEPTH / 2);
    root.add(step);
    root.add(k.floor(-12, 12, SKY_Z, HALL_END - WALL_T, GROUND_Y, stone));
    const street = new Mesh(new PlaneGeometry(34, 15), new MeshBasicMaterial({ map: canvasOf(64, 256, drawStreet) }));
    street.position.set(0, 4, SKY_Z);
    street.frustumCulled = false;
    root.add(street);
    return { leaf: door.leaf, gap, spill };
  }

  /** Someone sits down on one of the chairs: a body with its own bones, its hips where the chair's seat is. */
  private sitDown(look: Omit<FigureSpec, 'clip' | 'time'>, x: number, z: number, heading: number): HeroFigure {
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
    return hero;
  }

  /** One of them, in a chair, one arm on the table and a fork in the other hand. */
  private diner(look: Omit<FigureSpec, 'clip' | 'time'>, x: number, z: number, heading: number, plate: Vector3, forkSide: 'R' | 'L', fork: number, cycle: number, phase: number): Diner {
    const hero = this.sitDown(look, x, z, heading);
    const otherSide = forkSide === 'R' ? 'L' : 'R';
    const names = [...BENDS.map((bend) => bend.bone), 'Bip01_MJaw', `Bip01_${forkSide}_UpperArm`, `Bip01_${forkSide}_Forearm`, `Bip01_${forkSide}_Hand`, `Bip01_${otherSide}_UpperArm`, `Bip01_${otherSide}_Forearm`, `Bip01_${otherSide}_Hand`];
    const bones = names.map((name) => hero.bone(name)!);
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const forward = new Vector3(s, 0, c);
    const axis = new Vector3().crossVectors(UP, forward);
    // in this skeleton X runs up through the skull: find which of the others looks out of the face
    const tilt = bones[3].getWorldQuaternion(new Quaternion());
    const one = new Vector3(0, 1, 0).applyQuaternion(tilt);
    const two = new Vector3(0, 0, 1).applyQuaternion(tilt);
    const face = Math.abs(one.dot(axis)) > Math.abs(two.dot(axis)) ? two : one;
    if (face.dot(new Vector3().copy(forward).addScaledVector(UP, -0.3)) < 0) face.negate();
    const right = new Vector3(-c, 0, s);
    const lateral = forkSide === 'R' ? right : right.clone().negate();
    const shoulder = bones[5].getWorldPosition(new Vector3()).sub(this.origin);
    const plateAt = plate.clone().addScaledVector(forward, -0.02);
    const otherAt = plate.clone().addScaledVector(lateral, -0.26).addScaledVector(forward, -0.13);
    otherAt.y = plate.y + 0.02;
    return {
      hero,
      bones,
      rest: bones.map((bone) => bone.quaternion.clone()),
      forward,
      axis,
      plateAt,
      downFork: plateAt.clone().sub(shoulder).normalize(),
      aim: forward.clone().multiplyScalar(-AIM_BACK).addScaledVector(UP, AIM_UP).normalize(),
      otherAt,
      pole: lateral.clone().multiplyScalar(0.45).addScaledVector(UP, -0.9).addScaledVector(forward, -0.25).normalize(),
      otherPole: lateral.clone().multiplyScalar(-0.45).addScaledVector(UP, -0.9).addScaledVector(forward, -0.25).normalize(),
      fork,
      cycle,
      phase,
      restBow: Math.asin(clamp(-face.y, -1, 1)),
      axes: [alongAxis(bones[6], bones[7]), alongAxis(bones[9], bones[10])],
    };
  }

  /** The little one, turned in its chair, looks over its shoulder toward the front door. Once: it does not move. */
  private turnChild(): void {
    const forward = new Vector3(Math.sin(CHILD_HEADING), 0, Math.cos(CHILD_HEADING));
    const axis = new Vector3().crossVectors(UP, forward);
    for (const bend of BENDS) {
      const bone = this.child.bone(bend.bone)!;
      qA.setFromAxisAngle(axis, CHILD_BOW * bend.bow);
      qB.setFromAxisAngle(UP, CHILD_LOOK * bend.turn);
      turnBone(bone, qC.multiplyQuaternions(qB, qA));
    }
  }

  /** The three of them at the open front door in their coats, their backs to you, on the step. */
  private buildLeavers(): void {
    const k = this.kit;
    const b = this.build;
    const g = this.leavers;
    this.root.add(g);
    const coat = { face: 'blank', bleach: 0.12 } as const;
    const people: readonly (readonly [FigureSpec, number, number])[] = [
      [{ ...coat, avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 0.2, tint: 0x3a3c40 }, -0.4, HALL_END - WALL_T - 0.32],
      [{ ...coat, avatar: 'figure_woman', clip: 'm_idle_roll_head_01', time: 1.1, tint: 0x46403c }, 0.38, HALL_END - WALL_T - 0.28],
      [{ ...coat, avatar: 'figure_child', clip: 'm_idle_breathe_01', time: 0.6, tint: 0x3c4146 }, 0.02, HALL_END - WALL_T - 0.12],
    ];
    people.forEach(([spec, x, z], i) => {
      // bodies with their own bones like the three at the table, held in one pose
      const body = k.figures.hero(spec);
      body.update(spec.time ?? 0);
      body.root.rotation.y = Math.PI;
      body.root.position.set(x, STEP_TOP, z);
      body.root.traverse((o) => {
        if ((o as Mesh).isMesh) o.castShadow = true;
      });
      g.add(body.root);
      b.contactShadow(x, z, 0.3, g, 0.7, STEP_TOP + 0.004);
      if (i === 0) {
        // the father's hat
        body.root.updateWorldMatrix(true, true);
        const head = body.bone('Bip01_Head')!.getWorldPosition(new Vector3()).sub(this.origin);
        k.prop('fedora', [head.x, head.y + HAT_ON_HEAD, head.z], { rotation: [0, 180, 0], castShadow: true }, g);
      }
    });
  }

  private placeBeats(): void {
    this.beat(0, () => {
      const start = (name: keyof typeof BED, gain: number, options: RoomVoiceOptions = {}) => this.beds.set(name, this.sound.bed(BED[name], { gain, fade: 0.6, ...options }));
      start('house', LEVEL.house);
      start('drone', LEVEL.drone, { fade: 2 });
      start('clock', LEVEL.clock, { pan: 0.4, reverb: 0.1 });
      start('forks', LEVEL.forks[0]);
      start('chewFather', LEVEL.chewFather);
      start('chewMother', LEVEL.chewMother);
    });
    for (const [at, file, options] of CUES) this.beat(at, () => this.sound.play(file, options));

    // the dinner, fork by fork: never near the narrator, and the mother's still while she listens
    const r = randomFrom(29);
    const sources: readonly (readonly [number, number])[] = [[-PLATE_X, FATHER_Z], [PLATE_X, MOTHER_Z]];
    for (let t = FORKS_FROM; t < SILENCE_AT - 0.3; t += FORK_GAP[0] + r() * FORK_GAP[1]) {
      const who = r() < 0.5 ? 0 : 1;
      if (who === 1 && t > LISTEN_AT - 0.2 && t < LISTEN_AT + LISTEN_HOLD + 0.1) continue;
      const file = r() < 0.6 ? FORKS[Math.floor(r() * FORKS.length)] : STABS[Math.floor(r() * STABS.length)];
      const gain = 0.2 + r() * 0.12;
      const [x, z] = sources[who];
      this.beat(t, () => this.sound.play(file, { gain, pan: this.panOf(x, z), reverb: 0.15 }));
    }

    // she hears something: her fork stops, and the table with her; then it goes on
    this.beat(LISTEN_AT, () => {
      this.beds.get('forks')?.gain(0.05, 0.15);
      this.beds.get('chewMother')?.gain(0, 0.2);
    });
    this.beat(LISTEN_AT + LISTEN_HOLD, () => {
      this.beds.get('forks')?.gain(LEVEL.forks[0], 0.5);
      this.beds.get('chewMother')?.gain(LEVEL.chewMother, 0.6);
      this.sound.play(FORKS[2], { gain: 0.35, pan: this.panOf(PLATE_X, MOTHER_Z), reverb: 0.12 });
    });
    // each blink leaves the dinner thinner
    this.beat(CHANGES[0], () => this.beds.get('forks')?.gain(LEVEL.forks[1], 0.4));
    this.beat(CHANGES[1], () => this.beds.get('forks')?.gain(LEVEL.forks[2], 0.4));
    // a real silence before the last blink
    this.beat(SILENCE_AT, () => {
      for (const [name, voice] of this.beds) voice.gain(name === 'house' ? LEVEL.house * 0.15 : 0, 0.3);
    });
    // the door stands open: the street comes in
    this.beat(CHANGES[2], () => {
      this.beds.set('street', this.sound.bed(BED.street, { gain: LEVEL.street, lowpass: 1800, reverb: 0.4, fade: 0.6 }));
      this.beds.set('wind', this.sound.bed(BED.wind, { gain: LEVEL.wind, lowpass: 1200, fade: 1 }));
      this.beds.get('house')?.gain(LEVEL.house * 0.4, 0.5);
    });
    this.beat(SHUTTER_AT, () => this.shutter(false));
    this.beat(LINE_AT, () => this.say({ tr: 'Tabağını yıllar önce kaldırmışlardı.', en: 'They had cleared your plate years ago.' }, 3.6));
    // shut: only the house and its clock are left
    this.beat(SHUT_AT, () => {
      this.beds.get('street')?.stop(0.12);
      this.beds.get('wind')?.stop(0.12);
      this.beds.get('house')?.gain(LEVEL.house, 0.4);
      this.beds.get('clock')?.gain(LEVEL.clock * 0.7, 0.6);
    });
  }

  /** Where a sound at (x, z) of the room lies for the eye now, -1 left to 1 right. */
  private panOf(x: number, z: number): number {
    const dx = x - (this.eye.position.x - this.origin.x);
    const dz = z - (this.eye.position.z - this.origin.z);
    const d = Math.hypot(dx, dz) || 1;
    return clamp(((Math.cos(this.eye.yaw) * dx - Math.sin(this.eye.yaw) * dz) / d) * 0.8, -0.8, 0.8);
  }

  /** What each blink has done: 0 nothing yet, 1 your place gone, 2 your chair put away, 3 they have gone to the door. */
  private applyStage(stage: number): void {
    this.stage = stage;
    const gone = stage >= 3;
    for (const crowd of this.mine) crowd.drawn = crowd.count - (stage >= 1 ? 1 : 0);
    const mine = this.chairs.mine;
    if (stage >= 2) {
      mine.position.set(PUT_AWAY[0], 0, PUT_AWAY[1]);
      mine.rotation.y = -Math.PI / 2;
    } else {
      mine.position.set(0, 0, MY_CHAIR_Z);
      mine.rotation.y = Math.PI;
    }
    this.setting.visible = !gone;
    for (const d of this.diners) d.hero.root.visible = !gone;
    this.child.root.visible = !gone;
    this.leavers.visible = gone;
    const push = gone ? PUSHED_IN : 0;
    this.chairs.father.position.x = -SIDE_X + 0.02 + push;
    this.chairs.mother.position.x = SIDE_X - 0.02 - push;
    // the little one's chair is left where it turned to watch the door
    this.chairs.child.position.set(gone ? CHILD_CHAIR_LEFT[0] : -0.02, 0, gone ? CHILD_CHAIR_LEFT[1] : CHILD_Z);
    this.chairs.child.rotation.y = gone ? CHILD_CHAIR_LEFT[2] : CHILD_HEADING;
    for (const o of this.lit) o.visible = !gone;
    this.bulb.color.set(PALETTE.warm).multiplyScalar(gone ? 0.02 : 12);
    this.glowing[0].emissiveIntensity = gone ? 0 : SHADE_GLOW;
    this.glowing[1].emissiveIntensity = gone ? 0 : CORRIDOR_SHADE;
    this.warmMotes.visible = !gone;
    this.bounce.intensity = gone ? 0 : BOUNCE_I;
    this.lampGlow.intensity = gone ? 0 : GLOW_I;
    this.corridorLamp.intensity = gone ? 0 : CORRIDOR_I;
    this.shading.castShadow = gone;
    this.spots = gone ? this.greySpots : this.lampSpots;
    this.air = gone ? AIR_GREY : AIR_WARM;
    this.shadowFrames = 3;
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    this.pose(frame.t, this.eye);
    for (const clock of this.ticking) clock.value = frame.time;
    this.steamTime.value = frame.time;

    this.black = Math.max(blinkAt(s, BLINKS[0]), blinkAt(s, BLINKS[1]), blinkAt(s, BLINKS[2]));
    const stage = s < CHANGES[0] ? 0 : s < CHANGES[1] ? 1 : s < CHANGES[2] ? 2 : 3;
    if (stage !== this.stage) this.applyStage(stage);
    const gone = stage >= 3;

    this.focus = this.focusTrack.at(s);
    this.aperture = this.apertureTrack.at(s);
    this.fear = this.fearTrack.at(s);
    this.drift = gone ? DRIFT_STILL : DRIFT_WALK;

    // the front door: open from the last blink, then it swings shut by itself
    const open = gone ? 1 - smootherstep(range(CLOSE_AT, CLOSE_AT + CLOSE_LEN, s)) : 0;
    this.frontLeaf.rotation.y = -FRONT_OPEN * open;
    const through = smootherstep(range(0, 0.3, open));
    this.doorKey.intensity = DOOR_I * through;
    this.greyKey.intensity = GREY_I * through;
    this.hallFill.intensity = gone ? HALL_SHUT + (HALL_OPEN - HALL_SHUT) * through : HALL_DARK;
    this.roomGrey.intensity = gone ? ROOM_GREY_SHUT + (ROOM_GREY_I - ROOM_GREY_SHUT) * through : 0;
    this.nearGrey.intensity = gone ? NEAR_GREY_SHUT + (NEAR_GREY_I - NEAR_GREY_SHUT) * through : 0;
    this.hallMotes.visible = through > 0.01;
    this.gap.visible = open < 0.02;
    this.spill.visible = open < 0.02;

    if (!gone) {
      // the mother's fork stops while she listens, then goes on where it stopped
      const listen = smootherstep(range(LISTEN_AT, LISTEN_AT + 0.45, s)) * (1 - smootherstep(range(LISTEN_AT + LISTEN_HOLD - 0.5, LISTEN_AT + LISTEN_HOLD, s)));
      const herTime = s < LISTEN_AT ? s : s < LISTEN_AT + LISTEN_HOLD ? LISTEN_AT : s - LISTEN_HOLD;
      this.poseDiner(this.diners[0], s, 0);
      this.poseDiner(this.diners[1], herTime, listen);
      this.forks.commit();
      for (const [name, x, z] of PANNED) {
        const pan = this.panOf(x, z);
        if (Math.abs(pan - (this.pans.get(name) ?? 0)) < 0.05) continue;
        this.pans.set(name, pan);
        this.beds.get(name)?.pan(pan, 0.3);
      }
    }

    // the eaters move under the lamp; later the door's leaf moves in the grey
    const swinging = gone && s > CLOSE_AT - 0.05 && s < CLOSE_AT + CLOSE_LEN + 0.1;
    this.movingShadows = !gone || swinging || this.shadowFrames > 0;
    if (this.shadowFrames > 0) this.shadowFrames--;
  }

  /** The family, every frame while they eat: bowed over their plates, a fork up toward the mouth, chewing. */
  private poseDiners(s: number): void {
    for (const d of this.diners) this.poseDiner(d, s, 0);
    this.forks.commit();
  }

  private poseDiner(d: Diner, eat: number, listen: number): void {
    for (let i = 0; i < d.bones.length; i++) d.bones[i].quaternion.copy(d.rest[i]);
    const turning = ((eat + d.phase) / d.cycle) % 1;
    const p = turning < 0 ? turning + 1 : turning;
    const toMouth = smootherstep(range(0.22, 0.48, p)) - smootherstep(range(0.62, 0.9, p));
    const chewing = smootherstep(range(0.55, 0.62, p)) * (1 - smootherstep(range(0.92, 1, p)));
    const chew = Math.sin(eat * Math.PI * 2 * CHEW_HZ);
    const bow = EAT_BOW - d.restBow + chewing * chew * CHEW_NOD + toMouth * BITE_NOD - listen * LISTEN_LIFT;
    for (let i = 0; i < BENDS.length; i++) {
      qA.setFromAxisAngle(d.axis, bow * BENDS[i].bow);
      qB.setFromAxisAngle(UP, listen * LISTEN_TURN * BENDS[i].turn);
      qC.setFromAxisAngle(d.forward, listen * LISTEN_TILT * BENDS[i].turn);
      turnBone(d.bones[i], qD.multiplyQuaternions(qC, qB).multiply(qA));
    }
    vAxis.copy(d.axis).applyAxisAngle(UP, listen * LISTEN_TURN);
    qA.setFromAxisAngle(vAxis, Math.max(0, toMouth * 0.2 + chewing * (0.08 + chew * 0.08)));
    turnBone(d.bones[4], qA);

    d.bones[3].getWorldPosition(vMouth).sub(this.origin);
    vMouth.addScaledVector(d.forward, MOUTH_FORWARD);
    const lifted = toMouth * FORK_LIFT;
    vTip.lerpVectors(d.plateAt, vMouth, lifted);
    vTip.y += Math.sin(toMouth * Math.PI) * 0.03;
    vTip.addScaledVector(d.axis, Math.sin(eat * 6.1 + d.phase) * FORK_SCRAPE * (1 - toMouth));
    vDir.lerpVectors(d.downFork, d.aim, lifted).normalize();
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
  }
}
