import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  ShaderMaterial,
  SRGBColorSpace,
  TubeGeometry,
  Vector2,
  Vector3,
  type Bone,
  type Material,
  type Skeleton,
  type SkinnedMesh,
} from 'three';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { SpotSpec } from '../../../config/nightmare.config';
import { randomFrom, type Crowd, type FigureSpec, type HeroFigure } from '../../dream/FigureKit';
import { clamp, damp, lerp, range, smootherstep } from '../../math';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import type { RoomVoice } from '../RoomSound';

type V3 = readonly [number, number, number];

export const assets: RoomAssets = {
  models: ['sink', 'sink_drain', 'faucet', 'molar', 'lightbulb', 'pull_chain_socket', 'soap_dispenser', 'toothbrush', 'comb', 'towel_ring', 'door_flush', 'mug', 'radiator', 'bucket', 'coat_hook', 'drain_grate'],
  materials: ['tile_white', 'tile_wet', 'plaster_mould', 'linen_white', 'steel_scuffed'],
  sounds: [
    'rooms/bathroom_tone.mp3',
    'rooms/bulb_hum.mp3',
    'rooms/bulb_hum_unsteady.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/dream_drone_glass.mp3',
    'rooms/drain_gurgle.mp3',
    'rooms/tile_drip_1.mp3',
    'rooms/tile_drip_2.mp3',
    'rooms/tile_drip_3.mp3',
    'rooms/tile_drip_4.mp3',
    'rooms/tile_drip_5.mp3',
    'rooms/tooth_tink_big.mp3',
    'rooms/tooth_tink_1.mp3',
    'rooms/tooth_tink_2.mp3',
    'rooms/tooth_tink_3.mp3',
    'rooms/tooth_tink_4.mp3',
    'rooms/tooth_tink_5.mp3',
    'rooms/tooth_tink_6.mp3',
    'rooms/tooth_roll.mp3',
    'rooms/teeth_scatter.mp3',
    'rooms/tooth_clink.mp3',
    'rooms/pull_cord.mp3',
    'rooms/breath_held.mp3',
    'rooms/heart_beat.mp3',
    'rooms/glass_creak_1.mp3',
    'rooms/glass_creak_2.mp3',
    'rooms/glass_creak_3.mp3',
    'rooms/glass_creak_4.mp3',
    'rooms/palm_on_glass_1.mp3',
    'rooms/palm_squeak_long.mp3',
    'rooms/glass_crack_1.mp3',
    'rooms/glass_crack_long.mp3',
    'rooms/door_creak_short.mp3',
    'rooms/wet_step_1.mp3',
    'rooms/wet_step_2.mp3',
    'rooms/wet_step_3.mp3',
    'rooms/wet_step_4.mp3',
  ],
};

/** Inner width, length (mirror wall to door) and height of the room, and where the wall tile stops (m). */
const W = 1.52;
const L = 2.75;
const H = 2.38;
const TILE_TOP = 2.04;
/** The glass lies in the plane of the wall, z = 0: its width, height, and the height of its center (m). */
const GLASS_W = 0.58;
const GLASS_H = 0.76;
const GLASS_Y = 1.58;
/** The door behind you: center along the wall, width and height (m). */
const DOOR_X = -0.3;
const DOOR_W = 0.838;
const DOOR_H = 1.981;
/** How far the door behind the glass stands open at the end (rad). */
const DOOR_OPEN = 1.25;
/** The basin's lowest point (m) and the samples of its bowl across x and z. */
const SINK_Y = 0.671;
const BOWL_X = 0.31;
const BOWL_Z = [0.005, 0.5] as const;
const BOWL_NX = 34;
const BOWL_NZ = 30;
/** The bulb on its cord: the bottom of the cord (m) and how far it hangs from the mirror wall (m). */
const CORD_END = 2.1;
const BULB_Z = 0.24;
/** What is really lit by it, a little away from it so that the wall does not burn out (m). */
const BULB_LIGHT: V3 = [0, 1.98, 0.5];
const ECHO_LIGHT: V3 = [0, 1.98, -0.5];
/** The bulb's halo: its size (m) and from how far it is that size (m). */
const HALO_SIZE = 0.52;
const HALO_FULL_AT = 1.25;
/** Point light power (cd), the same bulb's echo behind the glass, and their reach (m). */
const BULB_POWER = 0.22;
const ECHO_POWER = 0.11;
const LIGHT_REACH = 3;
/** The pool the bulb throws on the wall, the shelf and the basin: power (cd), spread (deg). */
const POOL_LIGHT = 2.5;
const POOL_ANGLE = 48;
/** A little cold light so that the far end of each room still has shapes in it (cd, m). */
const FILL_POWER = 0.27;
const FILL_REACH = 2.6;
/** The spot that shows the old man: where it stands, and what it gives his face at any distance. */
const FACE_SPOT_AT: V3 = [0, 2.24, -0.16];
const FACE_LIGHT = 3.2;
/** The spot from the bulb into the basin (cd). */
const BASIN_LIGHT = 1.2;
/** While you look into the basin the key light casts its shadows there (s). */
const BASIN_SPOT = [26.8, 34.6] as const;
/** The sourceless light left behind the glass when the bulb is off (cd), its reach (m). */
const HAUNT_LIGHT: V3 = [0.1, 1.9, -1.5];
const HAUNT_POWER = 1.15;
/** Air and film. */
const ENV = 0.1;
const ENV_DARK = 0.012;
/** The longest a line of the eye can turn by the old man's neck (rad). */
const MAX_TURN = 1.25;
const MAX_NOD = 0.8;
/** The old man's lag behind your gaze (s): at first, and at the worst. */
const LAG_EARLY = 0.09;
const LAG_LATE = 1.7;
/** The stretch over which the lag grows (s). */
const LAG_GROWS = [12, 24] as const;
/** It goes on turning after you stopped: the earliest it can, the latest it will (s), and by how much (rad). */
const OVERRUN_FROM = 14;
const OVERRUN_AT = 19.4;
const OVERRUN = 0.2;
/** How much of a turn of the head is done by the neck; the rest by the head. */
const NECK_SHARE = 0.38;
/** His breath while he still has it: height (m), rate (rad/s), and when it stops (s). */
const BREATH_Y = 0.0028;
const BREATH_RATE = 1.15;
const STILL_AT = [18, 23] as const;
/** When it tilts its head, how far (rad). */
const TILT_AT = 21.6;
const TILT = 0.26;
/** After this it stops following you and only looks at you (s). */
const FOLLOW_ENDS = 24.2;
/** The mouth: when it opens, how wide (rad), when the smile comes, when the teeth are gone from the map (s). */
const MOUTH_AT = 24;
const JAW_OPEN = 0.36;
const SMILE_FROM = 30.5;
const GUMS_AT = 31.8;
/** The bulb's last hours: [second, brightness]. The shortest step is 0.4 s, far below 3 Hz. */
const BULB: readonly (readonly [number, number])[] = [
  [0, 1],
  [33.4, 0.92],
  [34.1, 1],
  [34.8, 0.7],
  [35.4, 0.97],
  [36, 0],
  [38.2, 0.95],
  [40.2, 0],
  [41.1, 0.85],
  [43, 0.72],
  [43.7, 0.86],
  [45.6, 0.66],
  [46.4, 0.8],
  [47.8, 0.55],
  [48.2, 0],
  [48.8, 0.5],
  [50.7, 0.12],
  [51.1, 0.5],
  [52, 0.1],
  [52.4, 0.46],
  [53.3, 0.08],
  [53.7, 0.4],
];
/** When the cord is pulled by nobody (s). */
const PULLS = [36, 38.2, 40.2, 41.1, 48.2] as const;
/** Seconds a change of the bulb takes (a filament is not a switch). */
const BULB_RAMP = REDUCED_MOTION ? 0.28 : 0.08;
/** The mirror: the old man leaves, comes back with no head, the neck, the look, the shutter (s). */
const EMPTY_AT = 36;
const HEADLESS_AT = 38.2;
const NECK_FROM = 40.4;
const NECK_TO = 44.1;
const LOOKS_FROM = 44;
const LOOKS_TO = 44.95;
const SHUTTER_AT = 45.05;
/** The viewer's gaze is held here so that the moment is on screen (s). */
const HOLD_GAZE = [41.2, 46.6] as const;
/** The palm: rises, touches, leaves; the crack; all of him gone (s). */
const PALM_FROM = 45.45;
const PALM_AT = 46.25;
const PALM_OFF = 47.5;
const CRACK_AT = 47.8;
const GONE_AT = 48.2;
const CUT_AT = 54;
/** The palm on the glass (m), and how far below and behind it the wrist stays. */
const PALM_X = 0.12;
const PALM_Y = 1.56;
const WRIST_ASIDE = -0.02;
const WRIST_BELOW = 0.046;
const WRIST_BACK = 0.022;
/** How far each joint of a finger straightens against the glass (rad). */
const FLAT = [0.34, 0.4, 0.28] as const;
/** When you stop breathing on the glass (s). */
const BREATH_STOPS = MOUTH_AT + 0.1;
/** What stays of the mist once the glass has cracked. */
const MIST_LEFT = 0.42;
/** How much nearer to the glass the body stands to reach it (m). */
const REACH_LEAN = 0.24;
/** Where the door's visitor stands on each return (x, z in the room behind the glass). */
const VISITOR: readonly (readonly [number, number])[] = [
  [DOOR_X, -L - 0.08],
  [-0.2, -L + 0.85],
  [-0.1, -L + 1.55],
  [0, -0.6],
];
/** Without being looked away from, it still comes on at these seconds, under a dip of the bulb. */
const VISITOR_STEPS = [50.8, 52.1, 53.4] as const;
/** How deep in the body the long neck starts, so that the head rises out of the collar (m). */
const NECK_IN = 0.32;
/** Radius of the neck where it leaves the collar (m), and how far above the collar it has thinned to its own (m). */
const COLLAR_R = 0.05;
const COLLAR_TAPER = 0.3;
/** Once this much neck has come (m), its own skin fills the collar and the short one goes. */
const STUMP_GOES = NECK_IN + 0.05;
/** The long neck: up out of the collar of the body that has none, over, and round to the front (x, y, z from the collar; m). */
const NECK_PATH: readonly V3[] = [
  [0, -NECK_IN, 0],
  [0, 0, 0],
  [0.01, 0.24, -0.02],
  [0.03, 0.43, -0.04],
  [-0.08, 0.52, -0.02],
  [-0.29, 0.4, 0.07],
  [-0.38, 0.11, 0.18],
  [-0.32, -0.09, 0.28],
  [-0.24, -0.03, 0.34],
  [-0.22, 0.055, 0.36],
];
const NECK_RINGS = 64;
const NECK_SIDES = 10;
/** Radius of the neck (m): at its far end, where the head takes it, and just before that. */
const NECK_R = [0.02, 0.045, 0.031] as const;
/** The basin's teeth: when each leaves the mouth (s), where it first hits and comes to rest about the drain (angle rad, radius m), how far it rolls (s). */
const TEETH = [
  { at: 25, hit: [0.6, 0.075], rest: [3.0, 0.062], roll: 1.5, lies: 1.5, axis: [0.8, 0.2, 0.5], loud: 'rooms/tooth_tink_big.mp3' },
  { at: 26.7, hit: [2.5, 0.09], rest: [-0.7, 0.07], roll: 1.25, lies: -1.32, axis: [0.3, 0.7, -0.6], loud: 'rooms/tooth_tink_2.mp3' },
  { at: 28.1, hit: [-1.4, 0.06], rest: [-2.3, 0.082], roll: 0.9, lies: 1.2, axis: [-0.5, 0.3, 0.8], loud: 'rooms/tooth_tink_1.mp3' },
  { at: 29.3, hit: [1.2, 0.1], rest: [1.75, 0.075], roll: 1.1, lies: 2.2, axis: [0.9, -0.2, 0.2], loud: 'rooms/tooth_tink_4.mp3' },
  { at: 30.9, hit: [-2.9, 0.08], rest: [-1.55, 0.045], roll: 0.8, lies: -1.75, axis: [0.1, 0.8, 0.6], loud: 'rooms/tooth_tink_3.mp3' },
  { at: 31.6, hit: [0.2, 0.05], rest: [0.45, 0.088], roll: 1, lies: 1.42, axis: [-0.7, 0.5, -0.5], loud: 'rooms/tooth_tink_6.mp3' },
] as const;
/** Where they fall from: your own mouth, this far under and before the eye (m), and how long the fall takes (s). */
const MOUTH_DROP = [0.115, 0.07] as const;
const TOOTH_FALL = 0.27;
/** A tooth's height at scale 1 (m) and how far from true size they are. */
const TOOTH_HEIGHT = 0.021;
const TOOTH_SCALE = 1.75;
/** The tap's drips (s): each is heard as it lands. */
const DRIPS = [2.2, 6.6, 9.8, 14.5, 18.1, 21.7, 23.3, 27.4, 32.6, 34.3, 37.1, 42.2, 49.6, 53] as const;
/** How long a drop takes to fall, and how long it hangs before (s). */
const DRIP_FALL = 0.2;
const DRIP_HANGS = 1.5;
/** Glass under stress: when it creaks (s). */
const CREAKS = [12.8, 21.1, 33.2, 39.4, 43.1] as const;

/** The camera, in seconds: you step up to the sink, you turn a little, you lean in, you look down, you look up, and stay. */
const SECONDS = 56;
const key = (s: number, x: number, y: number, z: number, yaw: number, pitch: number, fov: number): RoomKey => ({ t: s / SECONDS, at: [x, y, z], yaw, pitch, fov });
const KEYS: readonly RoomKey[] = [
  key(0, 0.03, 1.57, 1.36, 0, -4, 56),
  key(5, 0.02, 1.58, 1.16, 0, -3, 54),
  key(11, 0, 1.6, 0.8, 0, 0, 48),
  key(15, 0, 1.6, 0.76, 6.5, 0.5, 46),
  key(19, 0, 1.6, 0.73, 6.5, 0.5, 45),
  key(22.5, 0, 1.6, 0.68, 1.5, 0, 41),
  key(24.5, 0, 1.6, 0.62, 0, 0, 36),
  key(26.2, 0, 1.585, 0.58, 0, -8, 36),
  key(28.4, 0, 1.37, 0.38, 0, -70, 44),
  key(33, 0, 1.34, 0.36, 0, -72, 42),
  key(35.4, 0, 1.6, 0.62, 0, 1, 40),
  key(45, 0, 1.6, 0.6, 0, 1.5, 42),
  key(48, 0, 1.6, 0.58, 0, 1, 42),
  key(SECONDS, 0, 1.6, 0.56, 0, 0, 38),
];

const EYE_BONES = ['Bip01_LEye', 'Bip01_REye'] as const;
/** Where the teeth lie on the head map: two arcs (u from, u to) between v 0.112 and 0.28. */
const TEETH_MAP = [
  [0.006, 0.0645],
  [0.083, 0.14],
] as const;
/** The lips at the widest smile (m; x toward +X of the room, y up, z forward, as he faces you). */
const LIPS: readonly { bone: string; by: V3 }[] = [
  { bone: 'Bip01_LMouthCorner', by: [0.011, 0.008, -0.005] },
  { bone: 'Bip01_RMouthCorner', by: [-0.011, 0.008, -0.005] },
  { bone: 'Bip01_MUpperLip', by: [0, 0.008, 0.001] },
  { bone: 'Bip01_LUpperlip', by: [0.004, 0.008, 0] },
  { bone: 'Bip01_RUpperlip', by: [-0.004, 0.008, 0] },
  { bone: 'Bip01_MBottomLip', by: [0, -0.005, 0.002] },
  { bone: 'Bip01_LMouthBottom', by: [0.004, -0.004, 0.001] },
  { bone: 'Bip01_RMouthBottom', by: [-0.004, -0.004, 0.001] },
];
const SPEC: FigureSpec = { avatar: 'figure_man', clip: 'm_idle_roll_head_01', face: 'keep', white: true, bleach: 0.5, tint: 0x70756f };
const POSE_TIME = 0.2;

const v1 = new Vector3();
const v2 = new Vector3();
const v3 = new Vector3();
const v4 = new Vector3();
const v5 = new Vector3();
const v6 = new Vector3();
const q1 = new Quaternion();
const q2 = new Quaternion();
const q3 = new Quaternion();
const q4 = new Quaternion();
const q5 = new Quaternion();
const m1 = new Matrix4();
const eye = new Vector3();
const look = new Vector3();
const euler = new Euler();
const IDENTITY = new Quaternion();
const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const TO_CENTER = new Matrix4().makeTranslation(0, -TOOTH_HEIGHT / 2, 0);

/** Turn a bone in world space by `delta`. */
function turnWorld(bone: Object3D, delta: Quaternion): void {
  bone.getWorldQuaternion(q3);
  q3.premultiply(delta);
  setWorld(bone, q3);
}

/** Give a bone a world orientation. */
function setWorld(bone: Object3D, target: Quaternion): void {
  bone.parent!.getWorldQuaternion(q4);
  bone.quaternion.copy(q4.invert().multiply(target));
  bone.updateMatrixWorld(true);
}

const cat = (a: number, b: number, c: number, d: number, t: number): number =>
  0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);

/** A point on a smooth line through `path`. */
function pathPoint(path: readonly V3[], u: number, out: Vector3): Vector3 {
  const n = path.length - 1;
  const f = clamp(u, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(f));
  const t = f - i;
  const a = path[Math.max(0, i - 1)];
  const b = path[i];
  const c = path[i + 1];
  const d = path[Math.min(n, i + 2)];
  return out.set(cat(a[0], b[0], c[0], d[0], t), cat(a[1], b[1], c[1], d[1], t), cat(a[2], b[2], c[2], d[2], t));
}

/** How bright the bulb is at second `s`. */
function bulbAt(s: number): number {
  let level = 1;
  let before = 1;
  let since = 0;
  for (let i = 0; i < BULB.length && BULB[i][0] <= s; i++) {
    before = level;
    level = BULB[i][1];
    since = s - BULB[i][0];
  }
  return lerp(before, level, clamp(since / BULB_RAMP, 0, 1));
}

/** The moulding of a window: `profile` is swept around its rectangle ((distance out, height), from the glass out). */
function moulding(halfW: number, halfH: number, profile: readonly (readonly [number, number])[]): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const sides = [
    [1, 1, -1, 1],
    [-1, 1, -1, -1],
    [-1, -1, 1, -1],
    [1, -1, 1, 1],
  ];
  for (const [ax, ay, bx, by] of sides) {
    for (let i = 0; i < profile.length - 1; i++) {
      const [d0, z0] = profile[i];
      const [d1, z1] = profile[i + 1];
      const point = (sx: number, sy: number, d: number, z: number) => [sx * (halfW + d), sy * (halfH + d), z];
      const a0 = point(ax, ay, d0, z0);
      const b0 = point(bx, by, d0, z0);
      const a1 = point(ax, ay, d1, z1);
      const b1 = point(bx, by, d1, z1);
      pos.push(...a0, ...b1, ...b0, ...a0, ...a1, ...b1);
      const u = (p: number[]) => [ay === by ? p[0] : p[1], p[2] + d0];
      uv.push(...u(a0), ...u(b1), ...u(b0), ...u(a0), ...u(a1), ...u(b1));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.computeVertexNormals();
  return g;
}

/** A soft spot of paint (`color` an rgba string). */
function spot(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string): void {
  c.save();
  c.translate(x, y);
  c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, color);
  g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  c.fillStyle = g;
  c.fillRect(-rx, -rx, rx * 2, rx * 2);
  c.restore();
}

/** A hand-drawn line (a flat list x, y, x, y...; drawn smooth). */
function stroke(c: CanvasRenderingContext2D, points: readonly number[], width: number, color: string): void {
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath();
  c.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length - 2; i += 2) c.quadraticCurveTo(points[i], points[i + 1], (points[i] + points[i + 2]) / 2, (points[i + 1] + points[i + 3]) / 2);
  c.lineTo(points[points.length - 2], points[points.length - 1]);
  c.stroke();
}

/** A skin that has seen eighty winters, over the avatar's own face (the map's face is upside down: chin toward v = 0.5, forehead toward 0.85). */
function ageFace(source: CanvasImageSource): HTMLCanvasElement {
  const S = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const c = canvas.getContext('2d')!;
  c.imageSmoothingQuality = 'high';
  c.drawImage(source, 0, 0, S, S);
  const rand = randomFrom(1951);
  const p = (u: number) => u * S;
  // waxy and drained: the color goes, a little green stays
  c.globalCompositeOperation = 'saturation';
  c.fillStyle = 'rgba(128,128,128,0.68)';
  c.fillRect(0, p(0.28), S, p(0.72));
  c.globalCompositeOperation = 'multiply';
  c.fillStyle = '#d3d4bd';
  c.fillRect(0, p(0.28), S, p(0.72));
  c.globalCompositeOperation = 'source-over';
  c.filter = 'blur(0.8px)';
  for (const side of [-1, 1]) {
    const x = (u: number) => p(0.5 + side * u);
    // orbits sunk into the skull
    spot(c, x(0.067), p(0.722), p(0.064), p(0.043), 'rgba(16,10,12,0.72)');
    spot(c, x(0.067), p(0.7), p(0.056), p(0.022), 'rgba(40,24,28,0.42)');
    // hollow cheeks, heavy jowls, the shadow of the temple
    spot(c, x(0.125), p(0.612), p(0.07), p(0.058), 'rgba(24,18,20,0.5)');
    spot(c, x(0.1), p(0.532), p(0.05), p(0.032), 'rgba(40,30,28,0.4)');
    spot(c, x(0.155), p(0.74), p(0.055), p(0.05), 'rgba(30,20,20,0.35)');
    // bags under the eyes
    stroke(c, [x(0.105), p(0.706), x(0.07), p(0.69), x(0.03), p(0.705)], 3.5, 'rgba(26,16,18,0.6)');
    stroke(c, [x(0.112), p(0.692), x(0.072), p(0.673), x(0.03), p(0.69)], 2.6, 'rgba(26,16,18,0.38)');
    // crow's feet
    for (let i = -2; i <= 2; i++) {
      const a = i * 0.26;
      stroke(c, [x(0.118), p(0.722 + a * 0.01), x(0.15), p(0.722 + Math.sin(a) * 0.028), x(0.178), p(0.722 + Math.sin(a) * 0.05)], 1.7, 'rgba(24,16,16,0.55)');
    }
    // nose to mouth, mouth to chin
    stroke(c, [x(0.048), p(0.65), x(0.085), p(0.615), x(0.098), p(0.566)], 5, 'rgba(22,14,14,0.42)');
    stroke(c, [x(0.048), p(0.65), x(0.083), p(0.615), x(0.096), p(0.566)], 1.8, 'rgba(18,10,10,0.75)');
    stroke(c, [x(0.062), p(0.578), x(0.075), p(0.552), x(0.074), p(0.522)], 3.2, 'rgba(22,14,14,0.5)');
    // eyebrows gone white and wild
    for (let i = 0; i < 90; i++) {
      const t = rand();
      const bx = 0.03 + t * 0.098;
      const by = 0.749 + Math.sin(t * 3.1) * 0.009 + (rand() - 0.5) * 0.009;
      stroke(c, [x(bx), p(by), x(bx + rand() * 0.018 - 0.006), p(by + 0.008 + rand() * 0.014)], 1.1 + rand(), 'rgba(226,224,212,0.82)');
    }
  }
  // the forehead
  for (let k = 0; k < 4; k++) {
    const v = 0.781 + k * 0.019 + rand() * 0.005;
    const points: number[] = [];
    for (let u = 0.345 + rand() * 0.04; u < 0.655 - rand() * 0.04; u += 0.04) points.push(p(u), p(v + Math.sin(u * 16 + k) * 0.003 + (rand() - 0.5) * 0.003));
    stroke(c, points, 2.1, 'rgba(22,14,14,0.26)');
    stroke(c, points.map((n, i) => (i % 2 ? n - 3 : n)), 1.1, 'rgba(240,232,216,0.08)');
  }
  // between the brows, above the lip
  for (const u of [0.484, 0.516]) stroke(c, [p(u), p(0.733), p(u + (u - 0.5) * 0.25), p(0.75), p(u), p(0.768)], 2.4, 'rgba(18,12,12,0.6)');
  for (let i = 0; i < 26; i++) {
    const u = 0.452 + (i / 25) * 0.096;
    stroke(c, [p(u), p(0.607 + rand() * 0.004), p(u + (rand() - 0.5) * 0.004), p(0.622 + rand() * 0.012)], 1, 'rgba(26,16,16,0.4)');
  }
  // age: spots on the skin and white stubble
  for (let i = 0; i < 130; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand());
    const size = 0.6 + rand() * rand() * 5;
    spot(c, p(0.5 + Math.cos(a) * r * 0.19), p(0.68 + Math.sin(a) * r * 0.2), size, size * (0.7 + rand() * 0.5), `rgba(62,36,20,${(0.18 + rand() * 0.36).toFixed(2)})`);
  }
  for (let i = 0; i < 1500; i++) {
    const u = 0.5 + (rand() - 0.5) * 0.3;
    const v = 0.5 + rand() * 0.11;
    c.fillStyle = `rgba(232,232,222,${(0.22 + rand() * 0.4).toFixed(2)})`;
    c.fillRect(p(u), p(v), 1 + rand() * 1.2, 1 + rand() * 1.2);
  }
  c.filter = 'none';
  // the eye: yellowed, threaded with veins
  spot(c, p(0.262), p(0.06), p(0.078), p(0.078), 'rgba(126,104,62,0.62)');
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2;
    stroke(c, [p(0.262 + Math.cos(a) * 0.075), p(0.06 + Math.sin(a) * 0.075), p(0.262 + Math.cos(a + 0.2) * 0.05), p(0.06 + Math.sin(a + 0.2) * 0.05), p(0.262 + Math.cos(a) * 0.032), p(0.06 + Math.sin(a) * 0.032)], 1, 'rgba(110,18,20,0.5)');
  }
  const irisX = p(0.2625);
  const irisY = p(0.0655);
  const irisR = p(0.021);
  const iris = c.createRadialGradient(irisX, irisY, irisR * 0.36, irisX, irisY, irisR);
  iris.addColorStop(0, 'rgba(2,2,2,1)');
  iris.addColorStop(0.35, 'rgba(18,14,10,1)');
  iris.addColorStop(0.85, 'rgba(34,26,18,1)');
  iris.addColorStop(1, 'rgba(10,8,6,1)');
  c.fillStyle = iris;
  c.beginPath();
  c.arc(irisX, irisY, irisR, 0, Math.PI * 2);
  c.fill();
  spot(c, irisX - irisR * 0.34, irisY + irisR * 0.32, irisR * 0.3, irisR * 0.3, 'rgba(250,246,232,0.92)');
  // a black throat; the teeth come back from the original, yellowed by years
  c.globalCompositeOperation = 'multiply';
  c.fillStyle = '#54403f';
  c.fillRect(0, 0, p(0.176), p(0.42));
  c.globalCompositeOperation = 'source-over';
  for (const [u0, u1] of TEETH_MAP) c.drawImage(source, p(u0), p(0.112), p(u1 - u0), p(0.168), p(u0), p(0.112), p(u1 - u0), p(0.168));
  c.globalCompositeOperation = 'multiply';
  c.fillStyle = '#bda877';
  for (const [u0, u1] of TEETH_MAP) c.fillRect(p(u0), p(0.112), p(u1 - u0), p(0.168));
  c.globalCompositeOperation = 'source-over';
  return canvas;
}

/** The same map once the teeth have gone: raw gum where they stood. */
function gumsOf(aged: HTMLCanvasElement): HTMLCanvasElement {
  const S = aged.width;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const c = canvas.getContext('2d')!;
  c.drawImage(aged, 0, 0);
  const rand = randomFrom(77);
  const p = (u: number) => u * S;
  for (const [u0, u1] of TEETH_MAP) {
    c.fillStyle = '#9b6a63';
    c.fillRect(p(u0), p(0.112), p(u1 - u0), p(0.168));
    for (let i = 0; i < 16; i++) {
      const v = 0.122 + (i / 15) * 0.145;
      const mid = (u0 + u1) / 2 + Math.sin((i / 15) * Math.PI) * (u0 < 0.05 ? -0.012 : 0.012);
      spot(c, p(mid), p(v), p(0.016), p(0.0085), `rgba(${18 + rand() * 12},4,6,0.96)`);
      if (i % 3 === 0) spot(c, p(mid + 0.004), p(v + 0.003), p(0.006), p(0.004), 'rgba(226,196,170,0.5)');
    }
  }
  return canvas;
}

/** The parts of a face moved by hand. */
class Face {
  readonly head: Object3D;
  readonly neck: Object3D;
  readonly jaw: Object3D;
  private readonly headRest: Quaternion;
  private readonly neckRest: Quaternion;
  private readonly jawRest: Quaternion;
  private readonly lips: { bone: Object3D; rest: Vector3; by: V3 }[];

  constructor(figure: HeroFigure) {
    this.head = figure.bone('Bip01_Head')!;
    this.neck = figure.bone('Bip01_Neck')!;
    this.jaw = figure.bone('Bip01_MJaw')!;
    this.head.updateWorldMatrix(true, true);
    figure.bone('Bip01_LEye')!.getWorldPosition(v1);
    figure.bone('Bip01_REye')!.getWorldPosition(v2);
    turnWorld(this.head, q1.setFromUnitVectors(v1.sub(v2).normalize(), AXIS_X));
    this.headRest = this.head.quaternion.clone();
    let skeleton: Skeleton | null = null;
    figure.root.traverse((o) => {
      if ((o as SkinnedMesh).isSkinnedMesh) skeleton ??= (o as SkinnedMesh).skeleton;
    });
    const skin = skeleton! as Skeleton;
    const bindOf = (b: Object3D) => new Matrix4().copy(skin.boneInverses[skin.bones.indexOf(b as Bone)]).invert();
    for (const name of EYE_BONES) {
      const eye = figure.bone(name)!;
      bindOf(eye.parent!).invert().multiply(bindOf(eye)).decompose(v1, eye.quaternion, v2);
    }
    this.neckRest = this.neck.quaternion.clone();
    this.jawRest = this.jaw.quaternion.clone();
    this.lips = LIPS.map((l) => {
      const bone = figure.bone(l.bone)!;
      return { bone, rest: bone.position.clone(), by: l.by };
    });
  }

  /** Back to the pose it was born with. */
  rest(): void {
    this.head.quaternion.copy(this.headRest);
    this.neck.quaternion.copy(this.neckRest);
    this.jaw.quaternion.copy(this.jawRest);
    for (const l of this.lips) l.bone.position.copy(l.rest);
  }

  /** Open the mouth (rad) and draw the lips back (0..1); `turn` is how far the head has turned from its rest. */
  mouth(open: number, smile: number, turn: Quaternion): void {
    v1.copy(AXIS_X).applyQuaternion(turn);
    turnWorld(this.jaw, q1.setFromAxisAngle(v1, open));
    if (smile <= 0) return;
    for (const l of this.lips) {
      v2.setFromMatrixPosition(l.bone.matrixWorld);
      v3.set(l.by[0], l.by[1], l.by[2]).multiplyScalar(smile).applyQuaternion(turn);
      v2.add(v3);
      l.bone.parent!.worldToLocal(v2);
      l.bone.position.copy(v2);
    }
    this.head.updateMatrixWorld(true);
  }
}

/** The glass's own weather: R the hand-print, G the mist, B the cracks. */
function glassMask(w: number, h: number, palmU: number, palmV: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d')!;
  const rand = randomFrom(404);
  c.fillStyle = '#000';
  c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = 'lighter';
  const perMeter = w / GLASS_W;
  const px = palmU * w;
  const py = (1 - palmV) * h;
  // the print: a heel, a palm, four fingers and a thumb, a little smeared
  c.save();
  c.filter = 'blur(2.5px)';
  c.translate(px, py);
  const m = (v: number) => v * perMeter;
  c.fillStyle = '#ff0000';
  c.beginPath();
  c.ellipse(m(0.003), m(0.03), m(0.046), m(0.05), 0, 0, Math.PI * 2);
  c.fill();
  const finger = (x: number, y: number, length: number, width: number, angle: number) => {
    c.save();
    c.translate(m(x), m(y));
    c.rotate(angle);
    c.beginPath();
    c.roundRect(m(-width / 2), m(-length), m(width), m(length), m(width / 2));
    c.fill();
    c.restore();
  };
  finger(-0.03, -0.012, 0.075, 0.019, -0.14);
  finger(-0.008, -0.022, 0.09, 0.02, -0.05);
  finger(0.015, -0.018, 0.084, 0.02, 0.05);
  finger(0.036, -0.004, 0.066, 0.018, 0.16);
  finger(-0.047, 0.03, 0.07, 0.022, -0.9);
  c.restore();
  // mist in soft clouds and fine droplets
  for (let i = 0; i < 70; i++) {
    const r = 20 + rand() * 50;
    const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `rgba(0,${Math.round(30 + rand() * 42)},0,1)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.save();
    c.translate(rand() * w, rand() * h);
    c.fillStyle = g;
    c.fillRect(-r, -r, r * 2, r * 2);
    c.restore();
  }
  for (let i = 0; i < 3400; i++) {
    c.fillStyle = `rgba(0,${Math.round(70 + rand() * 170)},0,1)`;
    c.fillRect(rand() * w, rand() * h, 1 + rand() * 1.6, 1 + rand() * 1.6);
  }
  // cracks: rays out of the palm, chords across them
  c.strokeStyle = '#0000ff';
  c.lineCap = 'round';
  const rays = 17;
  const ends: { x: number[]; y: number[] }[] = [];
  for (let i = 0; i < rays; i++) {
    const heading = (i / rays) * Math.PI * 2 + rand() * 0.28;
    const length = 0.05 + rand() * rand() * rand() * 0.62;
    const xs = [px];
    const ys = [py];
    let x = px;
    let y = py;
    let a = heading;
    const steps = 6 + Math.floor(length * 40);
    for (let k = 0; k < steps; k++) {
      a += (rand() - 0.5) * 0.34;
      const step = m(length / steps);
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      xs.push(x);
      ys.push(y);
    }
    ends.push({ x: xs, y: ys });
    c.lineWidth = 0.55 + rand() * 0.65;
    c.beginPath();
    c.moveTo(xs[0], ys[0]);
    for (let k = 1; k < xs.length; k++) c.lineTo(xs[k], ys[k]);
    c.stroke();
  }
  for (const f of [0.14, 0.3, 0.52]) {
    for (let i = 0; i < rays; i++) {
      if (rand() < 0.4) continue;
      const a = ends[i];
      const b = ends[(i + 1) % rays];
      const ia = Math.min(a.x.length - 1, Math.floor(a.x.length * f));
      const ib = Math.min(b.x.length - 1, Math.floor(b.x.length * f));
      c.lineWidth = 0.4 + rand() * 0.4;
      c.beginPath();
      c.moveTo(a.x[ia], a.y[ia]);
      c.lineTo((a.x[ia] + b.x[ib]) / 2 + (rand() - 0.5) * 8, (a.y[ia] + b.y[ib]) / 2 + (rand() - 0.5) * 8);
      c.lineTo(b.x[ib], b.y[ib]);
      c.stroke();
    }
  }
  return canvas;
}

const GLASS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GLASS_FRAG = /* glsl */ `
  uniform sampler2D uMask;
  uniform vec2 uPalm;
  uniform vec2 uAspect;
  uniform float uFog;
  uniform float uPrint;
  uniform float uCrack;
  uniform float uLight;
  uniform float uMist;
  uniform float uBreath;
  uniform vec2 uMouth;
  varying vec2 vUv;
  void main() {
    vec3 m = texture2D(uMask, vUv).rgb;
    float d = length((vUv - uPalm) * uAspect);
    float front = smoothstep(uFog, uFog - 0.2, d - m.g * 0.09);
    float mist = uMist * front * (0.16 + 0.48 * m.g) * (1.0 - m.r * uPrint);
    float breath = uBreath * smoothstep(0.17, 0.02, length((vUv - uMouth) * uAspect) + (m.g - 0.5) * 0.06) * (0.3 + 0.7 * m.g);
    float crack = m.b * smoothstep(uCrack, uCrack - 0.08, d);
    float haze = mist * 0.72 + breath * 0.36;
    float alpha = clamp(haze + crack * 0.8, 0.0, 1.0);
    vec3 color = (vec3(0.42, 0.48, 0.44) * haze + vec3(0.72, 0.78, 0.74) * crack) * (0.14 + uLight) / max(alpha, 0.001);
    gl_FragColor = vec4(color, alpha);
  }
`;

/** A wall's grime, all the marks of a long life without air (w is its width in meters; `more` adds what only that wall has). */
function grime(seed: number, wide: number, dark: 'left' | 'right' | 'even' | null, more?: (c: CanvasRenderingContext2D, X: (x: number) => number, Y: (y: number) => number) => void) {
  return (c: CanvasRenderingContext2D, w: number, h: number) => {
    const rand = randomFrom(seed);
    const X = (x: number) => (x / wide) * w;
    const Y = (y: number) => (1 - y / H) * h;
    c.clearRect(0, 0, w, h);
    const foot = c.createLinearGradient(0, Y(0), 0, Y(0.6));
    foot.addColorStop(0, 'rgba(8,10,6,0.85)');
    foot.addColorStop(1, 'rgba(8,10,6,0)');
    c.fillStyle = foot;
    c.fillRect(0, Y(0.6), w, Y(0) - Y(0.6));
    const top = c.createLinearGradient(0, Y(H), 0, Y(H - 0.42));
    top.addColorStop(0, 'rgba(5,7,4,0.8)');
    top.addColorStop(1, 'rgba(5,7,4,0)');
    c.fillStyle = top;
    c.fillRect(0, 0, w, Y(H - 0.42));
    for (const corner of [0.015, wide - 0.015]) {
      for (let i = 0; i < 90; i++) {
        const y = rand() < 0.65 ? H - rand() * rand() * 0.75 : rand() * 0.5;
        const r = X(0.012 + rand() * rand() * 0.1);
        spot(c, X(corner + (rand() - 0.5) * 0.55), Y(y), r, r * (0.7 + rand() * 0.6), `rgba(8,12,6,${(0.1 + rand() * 0.34).toFixed(2)})`);
      }
    }
    for (let i = 0; i < 12; i++) {
      const r = X(0.08 + rand() * 0.2);
      spot(c, rand() * w, Y(rand() * TILE_TOP), r, r * 1.4, `rgba(58,46,16,${(0.05 + rand() * 0.1).toFixed(2)})`);
    }
    for (let i = 0; i < 46; i++) {
      const x = rand() * w;
      const y0 = TILE_TOP * (0.4 + rand() * 0.6);
      const len = 0.15 + rand() * rand() * 1.3;
      const points: number[] = [];
      for (let k = 0; k <= 5; k++) points.push(x + (rand() - 0.5) * 2.5, Y(y0 - (k / 5) * len));
      stroke(c, points, 0.8 + rand() * 2.4, `rgba(40,30,12,${(0.06 + rand() * 0.2).toFixed(2)})`);
    }
    if (dark === 'even') {
      c.fillStyle = 'rgba(3,5,4,0.46)';
      c.fillRect(0, 0, w, h);
    } else if (dark) {
      const near = dark === 'left' ? 1 : 0;
      const away = c.createLinearGradient(0, 0, w, 0);
      away.addColorStop(near, 'rgba(3,5,4,0)');
      away.addColorStop(near ? 0.94 : 0.06, 'rgba(3,5,4,0.08)');
      away.addColorStop(near ? 0.62 : 0.38, 'rgba(3,5,4,0.8)');
      away.addColorStop(1 - near, 'rgba(3,5,4,0.92)');
      c.fillStyle = away;
      c.fillRect(0, 0, w, h);
    }
    more?.(c, X, Y);
  };
}

/** Old enamel, chipped and rusting at every edge. */
function enamelMap(): CanvasTexture {
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const c = canvas.getContext('2d')!;
  const rand = randomFrom(31);
  c.fillStyle = '#b3b19c';
  c.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const r = 1 + rand() * rand() * rand() * 14;
    spot(c, rand() * S, rand() * S, r, r * (0.6 + rand() * 0.6), rand() < 0.65 ? `rgba(76,46,20,${(0.2 + rand() * 0.6).toFixed(2)})` : `rgba(18,14,10,${(0.25 + rand() * 0.6).toFixed(2)})`);
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = 1000;
  t.repeat.setScalar(1 / 0.42);
  t.anisotropy = 4;
  return t;
}

/** The dirt on the back of a mirror: the silver going from its edges in, specks, dust and a wiped arc. */
function drawFoxing(c: CanvasRenderingContext2D, w: number, h: number): void {
  const rand = randomFrom(11);
  c.clearRect(0, 0, w, h);
  for (let i = 0; i < 620; i++) {
    const side = Math.floor(rand() * 4);
    const depth = rand() * rand() * rand() * 0.28 * w;
    const along = rand();
    const x = side === 0 ? depth : side === 1 ? w - depth : along * w;
    const y = side === 2 ? depth : side === 3 ? h - depth : along * h;
    const r = 2 + rand() * rand() * 26;
    spot(c, x, y, r, r * (0.6 + rand() * 0.7), `rgba(10,8,4,${(0.2 + rand() * 0.6).toFixed(2)})`);
  }
  for (let i = 0; i < 700; i++) {
    c.fillStyle = `rgba(14,10,6,${(0.18 + rand() * 0.55).toFixed(2)})`;
    c.fillRect(rand() * w, rand() * h, 0.6 + rand() * 1.6, 0.6 + rand() * 1.6);
  }
  for (let i = 0; i < 22; i++) {
    c.fillStyle = `rgba(214,218,200,${(0.05 + rand() * 0.14).toFixed(2)})`;
    c.fillRect(w * (0.25 + rand() * 0.5), h * (0.62 + rand() * 0.34), 0.7 + rand() * 1.4, 0.7 + rand() * 1.4);
  }
}

/**
 * A narrow bathroom at night. The room is built twice: behind the glass there is no wall but the same room,
 * flipped, and the old man in it is a real body that stands where your reflection would stand. It is you.
 * It follows your gaze, later and later. Its teeth come out of your mouth. The bulb goes, and the mirror
 * does what it likes: empty, no head, a head that was never meant to be attached that way.
 */
export default class Mirror extends Room {
  readonly keys = KEYS;
  readonly air: RoomAir = {
    fog: { color: 0x0a100c, density: 0.1 },
    env: 'bathroom',
    envIntensity: ENV,
    sky: 0,
    grade: { exposure: 1.18, saturation: 0.8, warmth: 0.015, tint: 0.025, flare: 0.003 },
  };
  film = { bloom: 0.95, bloomFrom: 0.62, grain: 0.42, scratches: 0.05, flicker: 0.02, weave: 0.0004, aberration: 0 };
  focus = 2.6;
  aperture = 3;
  drift = 0.35;
  movingShadows = true;
  fear = 0.25;

  private readonly man: HeroFigure;
  private readonly face: Face;
  private readonly headMeshes: Mesh[] = [];
  private readonly headMaterial: MeshStandardMaterial;
  private readonly toothed: CanvasTexture;
  private readonly gums: CanvasTexture;
  private readonly eyeOffset = new Vector3();
  private readonly eyes: { bone: Object3D; rest: Quaternion; world: Quaternion }[];
  private readonly stump: Mesh;
  private readonly arm: { upper: Object3D; fore: Object3D; hand: Object3D; upperRest: Quaternion; foreRest: Quaternion; handRest: Quaternion };
  private readonly fingers: { bone: Object3D; rest: Quaternion; spread: number; joint: number }[] = [];
  private readonly palmTurn = new Quaternion();
  private faceYaw = 0;
  private facePitch = 0;
  private overrunAt = 0;
  private overrunSign = -1;

  /** The neck that comes round, and the head it ends in. */
  private readonly neck: Mesh;
  private readonly neckPos: BufferAttribute;
  private readonly neckNor: BufferAttribute;
  private readonly neckUv: BufferAttribute;
  private readonly neckCenters = new Float32Array((NECK_RINGS + 1) * 3);
  private readonly neckTable = new Float32Array(121);
  private readonly neckLength: number;
  private readonly ghost: HeroFigure;
  private readonly ghostRest = new Vector3();

  private readonly bowl = new Float32Array(BOWL_NX * BOWL_NZ);
  private readonly drain = new Vector2();
  private readonly teeth;
  private readonly teethParts: { fall: number; base: Quaternion; axis: Vector3 }[] = [];
  private readonly atRest = new Uint8Array(TEETH.length);
  private readonly drop: Mesh;
  private readonly tapTip = new Vector3();
  private readonly freshBlood: MeshBasicMaterial;

  private readonly bulbLight;
  private readonly echoLight;
  private readonly hauntLight;
  private readonly doorLight;
  private readonly faceSpot: SpotSpec;
  private readonly basinSpot: SpotSpec;
  private readonly poolSpot: SpotSpec;
  private readonly backFill;
  private readonly backEcho;
  private readonly faceSpots: (SpotSpec | null)[];
  private readonly basinSpots: (SpotSpec | null)[];
  private readonly bulbMaterial: MeshBasicMaterial;
  private readonly halo;
  private readonly glass: { [K in 'uFog' | 'uPrint' | 'uCrack' | 'uLight' | 'uMist' | 'uBreath']: { value: number } };
  private readonly mouthOnGlass = new Vector2(0.5, 0.5);
  private readonly chain: Object3D | null;
  private readonly clocks: { value: number }[] = [];

  private readonly doorLeaf: Object3D;
  private readonly visitor: Crowd;
  private visitorStep = -1;
  private walked = 0;
  private turnedAway = false;
  private shuttered = false;
  private voices: { tone?: RoomVoice; hum?: RoomVoice; flicker?: RoomVoice; low?: RoomVoice; high?: RoomVoice; drain?: RoomVoice } = {};
  private humOn = true;
  private cut = false;

  constructor(ctx: RoomContext) {
    super(ctx);
    const kit = this.kit;
    const b = this.build;
    const root = this.root;

    const mats = {
      tile: kit.surface('tile_white', 1.2, { color: new Color(0x8ea27a), roughness: 0.4 }),
      sideTile: kit.surface('tile_white', 1.2, { color: new Color(0x8ea27a), roughness: 0.68 }),
      plaster: kit.surface('plaster_mould', 1.8, { color: new Color(0x8a8e78) }),
      ceiling: kit.surface('plaster_mould', 1.4, { color: new Color(0x2a2c26) }),
      floor: kit.surface('tile_wet', 1, { roughness: 0.42, color: new Color(0x7c7d70) }),
      cap: new MeshStandardMaterial({ color: 0x2d3a2b, roughness: 0.3 }),
      enamel: new MeshStandardMaterial({ map: enamelMap(), roughness: 0.34, color: 0xb6b4a6 }),
      paint: b.paint(0x56604e, 0.58),
      towel: kit.surface('linen_white', 0.4, { color: new Color(0x7f8270), side: DoubleSide }),
      pipe: kit.surface('steel_scuffed', 1, { color: new Color(0x5e5d52), metalness: 0.25, roughness: 0.6 }),
      brass: new MeshStandardMaterial({ color: 0x7a6a3c, roughness: 0.35, metalness: 1 }),
    };

    // the real room, and behind the glass the same room flipped
    const flip = new Group();
    flip.scale.z = -1;
    root.add(flip);
    this.shell(root, true, mats);
    const leaf = this.shell(flip, false, mats);
    this.doorLeaf = leaf;

    // what is on the mirror wall; the frame's reflection lies inside the frame, as it does
    const frame = () => new Mesh(moulding(GLASS_W / 2, GLASS_H / 2, FRAME_PROFILE), mats.enamel);
    const real = frame();
    real.position.y = GLASS_Y;
    real.castShadow = false;
    real.receiveShadow = true;
    root.add(real);
    const hardware = new MeshStandardMaterial({ color: 0x5a564a, roughness: 0.38, metalness: 0.85 });
    const knob = new Mesh(new CylinderGeometry(0.0085, 0.0095, 0.022, 14), hardware);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(GLASS_W / 2 + 0.024, GLASS_Y, 0.03);
    root.add(knob);
    for (const y of [GLASS_Y - 0.26, GLASS_Y + 0.26]) {
      const hinge = new Mesh(new CylinderGeometry(0.0045, 0.0045, 0.05, 8), hardware);
      hinge.position.set(-GLASS_W / 2 - 0.0425, y, 0.022);
      root.add(hinge);
    }
    const echoFrame = frame();
    echoFrame.position.y = GLASS_Y;
    flip.add(echoFrame);

    // the basin
    const sink = kit.prop('sink', [0, SINK_Y, 0.2515], { castShadow: true }, root);
    this.tuneSink(sink);
    kit.prop('sink', [0, SINK_Y, 0.2515], {}, flip);
    this.scanBowl(sink);
    kit.prop('sink_drain', [this.drain.x, this.bowlAt(this.drain.x, this.drain.y) + 0.0012, this.drain.y], {}, root);

    const tapL = kit.prop('faucet', [-0.13, 0.965, 0.069], { castShadow: true }, root);
    kit.prop('faucet', [0.13, 0.965, 0.069], { castShadow: true }, root);
    tapL.updateWorldMatrix(true, true);
    const tapBox = new Box3().setFromObject(tapL);
    this.tapTip.set((tapBox.min.x + tapBox.max.x) / 2 - this.origin.x, tapBox.min.y - this.origin.y + 0.012, tapBox.max.z - this.origin.z - 0.012);

    // plumbing under the basin, a riser in the corner
    this.pipe([[0, 0.69, this.drain.y], [0, 0.48, this.drain.y], [0, 0.41, this.drain.y + 0.06], [0, 0.48, this.drain.y + 0.11], [0, 0.5, 0.12], [0, 0.5, 0.0]], 0.02, mats.pipe, root, 0.18);
    this.pipe([[W / 2 - 0.07, 0, L - 0.08], [W / 2 - 0.07, H, L - 0.08]], 0.036, mats.pipe, root, 0.5);
    this.pipe([[-0.13, 0, 0.022], [-0.13, 0.97, 0.022]], 0.009, mats.pipe, root, 0.1);
    this.pipe([[0.13, 0, 0.022], [0.13, 0.97, 0.022]], 0.009, mats.pipe, root, 0.1);
    b.contactShadow(0, 0.28, 0.62, root, 0.85);

    this.shelf(root, mats);

    // the bulb on its cord
    const cord = new Mesh(new CylinderGeometry(0.0035, 0.0035, H - CORD_END, 6), new MeshStandardMaterial({ color: 0x151310, roughness: 0.6 }));
    cord.position.set(0, (H + CORD_END) / 2, BULB_Z);
    root.add(cord);
    const rose = new Mesh(new CylinderGeometry(0.045, 0.06, 0.03, 18), mats.enamel);
    rose.position.set(0, H - 0.015, BULB_Z);
    root.add(rose);
    const fixture = kit.prop('pull_chain_socket', [0, CORD_END, BULB_Z], { anchor: 'top' }, root);
    fixture.updateWorldMatrix(true, true);
    const socketPart = fixture.getObjectByName('pull_chain_light_socket') ?? fixture;
    const socketBottom = new Box3().setFromObject(socketPart).min.y - this.origin.y;
    const chainPart = fixture.getObjectByName('pull_chain_light_socket_chain');
    this.chain = chainPart ? this.hingeChain(chainPart, fixture) : null;
    this.bulbMaterial = new MeshBasicMaterial({ color: 0xffffff });
    this.dressBulb(socketBottom);
    this.halo = b.glow(0, socketBottom - 0.05, BULB_Z, HALO_SIZE, 0xffcf96, 0.75, root);

    this.bulbLight = this.light(BULB_LIGHT, 0xffd6a2, BULB_POWER, LIGHT_REACH);
    this.echoLight = this.light(ECHO_LIGHT, 0xffd6a2, ECHO_POWER, LIGHT_REACH);
    this.hauntLight = this.light(HAUNT_LIGHT, 0x8fb4a0, 0, 4);
    this.doorLight = this.light([DOOR_X * 0.5, 2.05, -L + 0.5], 0xbdd2c6, 0, 3.4);
    this.faceSpot = this.spot(FACE_SPOT_AT, [0, 1.4, -0.92], 0xffe0b6, FACE_LIGHT, 44, 0.7);
    this.basinSpot = this.spot([0, 2.02, BULB_Z], [this.drain.x, 0.78, this.drain.y], 0xffdcae, BASIN_LIGHT, 30, 0.75);
    this.poolSpot = this.spot([0, 2.02, BULB_Z + 0.02], [0, 0.94, 0.06], 0xffd6a2, POOL_LIGHT, POOL_ANGLE, 1);
    this.faceSpots = [this.faceSpot, this.poolSpot, null];
    this.basinSpots = [this.basinSpot, this.poolSpot, this.faceSpot];
    this.backFill = this.light([0.15, 1.5, L - 0.95], 0x6f8f86, FILL_POWER, FILL_REACH);
    this.backEcho = this.light([0.15, 1.5, -L + 0.95], 0x6f8f86, FILL_POWER, FILL_REACH);
    this.spots = this.faceSpots;

    // the old man in the glass: the bones are moved by hand so that what he does is a function of time alone
    this.man = kit.figures.hero(SPEC);
    this.man.update(POSE_TIME);
    this.man.root.updateMatrixWorld(true);
    root.add(this.man.root);
    let materialDone: MeshStandardMaterial | null = null;
    this.man.root.traverse((o) => {
      const mesh = o as SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const material = mesh.material as MeshStandardMaterial;
      if (/head/.test(material.name)) {
        materialDone ??= material;
        this.headMeshes.push(mesh);
      } else if (/opacity/.test(material.name)) this.headMeshes.push(mesh);
    });
    const shared = materialDone! as MeshStandardMaterial;
    const aged = ageFace(shared.map!.image as CanvasImageSource);
    this.toothed = this.faceTexture(aged, shared);
    this.gums = this.faceTexture(gumsOf(aged), shared);
    this.headMaterial = shared.clone();
    this.headMaterial.map = this.toothed;
    this.headMaterial.roughness = 0.58;
    for (const mesh of this.headMeshes) if (/head/.test((mesh.material as Material).name)) mesh.material = this.headMaterial;

    this.face = new Face(this.man);
    this.eyes = EYE_BONES.map((name) => {
      const bone = this.man.bone(name)!;
      return { bone, rest: bone.quaternion.clone(), world: new Quaternion() };
    });
    this.eyes[0].bone.getWorldPosition(v1);
    this.eyes[1].bone.getWorldPosition(v2);
    this.eyeOffset.addVectors(v1, v2).multiplyScalar(0.5).sub(this.origin);
    const armBones = (name: string) => this.man.bone(`Bip01_L_${name}`)!;
    const upper = armBones('UpperArm');
    const fore = armBones('Forearm');
    const hand = armBones('Hand');
    this.arm = { upper, fore, hand, upperRest: upper.quaternion.clone(), foreRest: fore.quaternion.clone(), handRest: hand.quaternion.clone() };
    for (let f = 0; f < 5; f++) {
      for (let j = 0; j < 3; j++) {
        const bone = this.man.bone(`Bip01_L_Finger${f}${j === 0 ? '' : j}`);
        if (bone) this.fingers.push({ bone, rest: bone.quaternion.clone(), spread: j === 0 && f > 0 ? (f - 2.5) * 0.11 : 0, joint: j });
      }
    }
    // palm flat to the glass, fingers up: the hand's own x along the fingers, its y out of the palm
    v1.set(0.1, 1, 0).normalize();
    v2.set(0, 0, 1);
    v3.crossVectors(v1, v2).normalize();
    v2.crossVectors(v3, v1).normalize();
    this.palmTurn.setFromRotationMatrix(m1.makeBasis(v1, v2, v3));

    // the head that comes round, on its own body-less bones
    this.ghost = kit.figures.hero(SPEC);
    this.ghost.update(POSE_TIME);
    this.ghost.root.updateMatrixWorld(true);
    this.ghost.root.traverse((o) => {
      const mesh = o as SkinnedMesh;
      if (!mesh.isMesh) return;
      const name = (mesh.material as Material).name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (/head/.test(name)) mesh.material = this.headMaterial;
      else if (!/opacity/.test(name)) mesh.visible = false;
    });
    this.ghost.root.visible = false;
    root.add(this.ghost.root);
    const ghostFace = new Face(this.ghost);
    this.ghost.root.updateMatrixWorld(true);
    ghostFace.head.getWorldPosition(this.ghostRest).sub(this.origin);
    ghostFace.mouth(0.14, 0.9, IDENTITY);

    // its tube of neck: same skin as the corridor's, a geometry of our own that grows along the path
    const curve = new CatmullRomCurve3(NECK_PATH.map((p) => new Vector3(p[0], p[1], p[2])));
    this.neckLength = curve.getLength();
    const made = b.neck([[0, 0, 0], [0, 0.1, 0], [0, 0.2, 0]], root, { radius: NECK_R[1], sway: 0, color: 0xb2c4cc });
    this.neck = made.mesh;
    this.neck.visible = false;
    this.stump = this.makeStump(this.neck.material as Material);
    root.add(this.stump);
    const verts = (NECK_RINGS + 1) * (NECK_SIDES + 1);
    this.neckPos = new BufferAttribute(new Float32Array(verts * 3), 3);
    this.neckNor = new BufferAttribute(new Float32Array(verts * 3), 3);
    this.neckUv = new BufferAttribute(new Float32Array(verts * 2), 2);
    const index: number[] = [];
    for (let i = 0; i < NECK_RINGS; i++) {
      for (let j = 0; j < NECK_SIDES; j++) {
        const a = i * (NECK_SIDES + 1) + j;
        const c = a + NECK_SIDES + 1;
        index.push(a, a + 1, c, c, a + 1, c + 1);
      }
    }
    const tube = new BufferGeometry();
    tube.setAttribute('position', this.neckPos);
    tube.setAttribute('normal', this.neckNor);
    tube.setAttribute('uv', this.neckUv);
    tube.setIndex(index);
    this.neck.geometry.dispose();
    this.neck.geometry = tube;
    let run = 0;
    for (let i = 1; i <= 240; i++) {
      pathPoint(NECK_PATH, (i - 1) / 240, v1);
      pathPoint(NECK_PATH, i / 240, v2);
      run += v1.distanceTo(v2);
      if (i % 2 === 0) this.neckTable[i / 2] = run;
    }

    // who comes in the door behind the glass
    this.visitor = kit.figures.crowd({ avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 0.2, face: 'hollow', veil: true, tint: 0x6c716c, bleach: 0.55 }, 1);
    for (const part of this.visitor.root.children as InstancedMesh[]) {
      const name = (part.material as Material).name;
      if (/head|opacity/.test(name)) part.visible = false;
      else if (/body/.test(name)) continue;
      else {
        const veil = (part.material as MeshStandardMaterial).clone();
        veil.color.setScalar(0.62);
        part.material = veil;
      }
    }
    this.visitor.root.visible = false;
    root.add(this.visitor.root);

    // the faint surface of the glass
    const foxing = b.label(GLASS_W, GLASS_H, drawFoxing, { px: 900, transparent: true, roughness: 0.25 }).mesh;
    foxing.position.set(0, GLASS_Y, 0.0008);
    foxing.renderOrder = 4;
    (foxing.material as Material).depthWrite = false;
    root.add(foxing);
    const palmU = PALM_X / GLASS_W + 0.5;
    const palmV = (PALM_Y - GLASS_Y) / GLASS_H + 0.5;
    const mask = new CanvasTexture(glassMask(760, Math.round((760 * GLASS_H) / GLASS_W), palmU, palmV));
    mask.anisotropy = 4;
    this.glass = { uFog: { value: 0 }, uPrint: { value: 1 }, uCrack: { value: 0 }, uLight: { value: 1 }, uMist: { value: 1 }, uBreath: { value: 0 } };
    const breath = new Mesh(
      new PlaneGeometry(GLASS_W, GLASS_H),
      new ShaderMaterial({
        vertexShader: GLASS_VERT,
        fragmentShader: GLASS_FRAG,
        uniforms: { uMask: { value: mask }, uPalm: { value: new Vector2(palmU, palmV) }, uAspect: { value: new Vector2(1, GLASS_H / GLASS_W) }, uMouth: { value: this.mouthOnGlass }, ...this.glass },
        transparent: true,
        depthWrite: false,
      }),
    );
    breath.position.set(0, GLASS_Y, 0.0014);
    breath.renderOrder = 5;
    breath.frustumCulled = false;
    root.add(breath);

    // teeth: real molars, roots stained dark
    this.teeth = kit.props('molar', TEETH.length, { castShadow: true, scale: TOOTH_SCALE });
    const toothMesh = this.teeth.root.children[0] as InstancedMesh;
    const toothGeo = toothMesh.geometry.clone();
    const p = toothGeo.getAttribute('position');
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < p.count; i++) {
      low = Math.min(low, p.getY(i));
      high = Math.max(high, p.getY(i));
    }
    const colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const up = (p.getY(i) - low) / (high - low);
      const crown = smootherstep(range(0.34, 0.6, up));
      const blood = 1 - smootherstep(range(0.0, 0.5, up));
      colors[i * 3] = lerp(0.2 + blood * 0.1, 0.84, crown);
      colors[i * 3 + 1] = lerp(0.09 - blood * 0.06, 0.76, crown);
      colors[i * 3 + 2] = lerp(0.06 - blood * 0.045, 0.58, crown);
    }
    toothGeo.setAttribute('color', new BufferAttribute(colors, 3));
    toothMesh.geometry = toothGeo;
    toothMesh.material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.32 });
    this.teeth.drawn = 0;
    root.add(this.teeth.root);
    for (const t of TEETH) {
      const fall = TOOTH_FALL;
      const axis = new Vector3(t.axis[0], t.axis[1], t.axis[2]).normalize();
      const finalTurn = new Quaternion().setFromAxisAngle(AXIS_X, t.lies).multiply(new Quaternion().setFromAxisAngle(AXIS_Y, t.at * 2.3));
      const base = new Quaternion().setFromAxisAngle(axis, -this.rollTurn(t, t.roll + 0.4 + fall)).premultiply(finalTurn);
      this.teethParts.push({ fall, base, axis });
    }

    // the wet in the basin
    this.basinDecal(drawBasinStain, new MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 1 }));
    this.freshBlood = new MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0, color: 0xffffff });
    this.basinDecal(drawBasinBlood, this.freshBlood);

    // a drop on the tap
    this.drop = new Mesh(new CylinderGeometry(0.0015, 0.0034, 0.009, 8), new MeshStandardMaterial({ color: 0xcfd6d0, roughness: 0.08, metalness: 0.1 }));
    this.drop.frustumCulled = false;
    this.drop.visible = false;
    root.add(this.drop);

    this.clocks.push(b.motes(28, { x: [-W / 2, W / 2], y: [0.25, H], z: [0.55, L] }, root, { strength: 0.3, size: 0.7 }).time);
    this.clocks.push(b.motes(26, { x: [-W / 2, W / 2], y: [0.25, H], z: [-L, -1.5] }, root, { strength: 0.3, seed: 9, size: 0.7 }).time);

    this.scoreSound();
  }

  /** The walls, floor, ceiling and door of one of the two rooms. Returns the door's pivot. */
  private shell(parent: Object3D, real: boolean, m: Record<'tile' | 'sideTile' | 'plaster' | 'ceiling' | 'floor' | 'cap' | 'paint' | 'towel' | 'pipe' | 'brass', Material>): Object3D {
    const kit = this.kit;
    const b = this.build;
    const put = (material: Material, cx: number, cy: number, cz: number, w: number, h: number, yaw: number, u: number, v: number) => {
      const wall = kit.wall(w, h, material, u, v);
      wall.position.set(cx, cy, cz);
      wall.rotation.y = yaw;
      parent.add(wall);
    };
    const near = (x0: number, x1: number, y0: number, y1: number, material: Material) => put(material, (x0 + x1) / 2, (y0 + y1) / 2, 0, x1 - x0, y1 - y0, 0, (x0 + x1) / 2, (y0 + y1) / 2);
    const far = (x0: number, x1: number, y0: number, y1: number, material: Material) => put(material, (x0 + x1) / 2, (y0 + y1) / 2, L, x1 - x0, y1 - y0, Math.PI, -(x0 + x1) / 2, (y0 + y1) / 2);
    if (real) {
      const left = -GLASS_W / 2;
      const right = GLASS_W / 2;
      const foot = GLASS_Y - GLASS_H / 2;
      const head = GLASS_Y + GLASS_H / 2;
      near(-W / 2, left, 0, TILE_TOP, m.tile);
      near(right, W / 2, 0, TILE_TOP, m.tile);
      near(left, right, 0, foot, m.tile);
      near(left, right, head, TILE_TOP, m.tile);
      near(-W / 2, W / 2, TILE_TOP, H, m.plaster);
    }
    for (const side of [-1, 1]) {
      put(m.sideTile, (side * W) / 2, TILE_TOP / 2, L / 2, L, TILE_TOP, (-side * Math.PI) / 2, (L / 2) * side, TILE_TOP / 2);
      put(m.plaster, (side * W) / 2, (TILE_TOP + H) / 2, L / 2, L, H - TILE_TOP, (-side * Math.PI) / 2, (L / 2) * side, (TILE_TOP + H) / 2);
      const cap = kit.block(L, 0.028, 0.012, m.cap);
      cap.position.set((side * W) / 2 - side * 0.006, TILE_TOP, L / 2);
      cap.rotation.y = Math.PI / 2;
      parent.add(cap);
    }
    far(-W / 2, DOOR_X - DOOR_W / 2, 0, TILE_TOP, m.tile);
    far(DOOR_X + DOOR_W / 2, W / 2, 0, TILE_TOP, m.tile);
    far(DOOR_X - DOOR_W / 2, DOOR_X + DOOR_W / 2, DOOR_H, TILE_TOP, m.tile);
    far(-W / 2, W / 2, TILE_TOP, H, m.plaster);
    for (const z of real ? [0.006, L - 0.006] : [L - 0.006]) {
      const cap = kit.block(W, 0.028, 0.012, m.cap);
      cap.position.set(0, TILE_TOP, z);
      parent.add(cap);
    }
    parent.add(kit.floor(-W / 2, W / 2, 0, L, 0, m.floor));
    const ceiling = kit.floor(-W / 2, W / 2, 0, L, H, m.ceiling);
    ceiling.rotation.x = Math.PI / 2;
    parent.add(ceiling);

    // the door, in a frame; only the one behind the glass has anything behind it
    const jamb = (w: number, h: number, x: number, y: number) => {
      const piece = kit.block(w, h, 0.075, m.paint);
      piece.position.set(x, y, L - 0.015);
      parent.add(piece);
    };
    jamb(0.07, DOOR_H + 0.05, DOOR_X - DOOR_W / 2 - 0.035, (DOOR_H + 0.05) / 2);
    jamb(0.07, DOOR_H + 0.05, DOOR_X + DOOR_W / 2 + 0.035, (DOOR_H + 0.05) / 2);
    jamb(DOOR_W + 0.14, 0.07, DOOR_X, DOOR_H + 0.035);
    const pivot = new Object3D();
    pivot.position.set(DOOR_X - DOOR_W / 2, 0, L + 0.022);
    parent.add(pivot);
    const leaf = kit.paint(kit.prop('door_flush', [DOOR_W / 2, 0, 0], {}, pivot), m.paint);
    leaf.traverse((o) => {
      if ((o as Mesh).isMesh) o.frustumCulled = false;
    });
    const knob = new Mesh(new CylinderGeometry(0.024, 0.024, 0.12, 12), m.brass);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(DOOR_W - 0.07, 1.0, 0);
    pivot.add(knob);
    if (!real) {
      const hallMaterial = new MeshStandardMaterial({ color: 0x0c0f0c, roughness: 0.9 });
      const hall = b.box(1.5, 1.7, 2.25, { walls: hallMaterial, floor: hallMaterial, ceiling: hallMaterial, skip: ['-z'] }, parent);
      hall.position.set(DOOR_X, 0, L + 0.04);
      hall.rotation.y = Math.PI;
    }

    // what the years have done to the walls
    const dirt = (width: number, x: number, z: number, yaw: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) => {
      const mesh = b.label(width, H, draw, { px: 300, transparent: true, roughness: 0.9 }).mesh;
      mesh.position.set(x, H / 2, z);
      mesh.rotation.y = yaw;
      mesh.renderOrder = 1;
      (mesh.material as Material).depthWrite = false;
      mesh.frustumCulled = false;
      parent.add(mesh);
    };
    if (real) dirt(W, 0, 0.0018, 0, grime(5, W, null, mirrorWallMarks));
    dirt(L, -W / 2 + 0.0018, L / 2, Math.PI / 2, grime(7, L, 'left'));
    dirt(L, W / 2 - 0.0018, L / 2, -Math.PI / 2, grime(8, L, 'right'));
    dirt(W, 0, L - 0.0018, Math.PI, grime(9, W, 'even'));

    // a towel on the left wall, a dark form at the edge of things
    kit.prop('towel_ring', [-W / 2 + 0.022, 1.42, 0.64], { rotation: [0, 90, 0] }, parent);
    parent.add(this.towelMesh(m.towel));
    if (real) {
      kit.prop('radiator', [W / 2 - 0.14, 0.05, 1.55], { rotation: [0, 90, 0], castShadow: false }, parent);
      b.contactShadow(W / 2 - 0.14, 1.55, 0.7, parent, 0.75);
      kit.prop('bucket', [-W / 2 + 0.26, 0, L - 0.42], {}, parent);
      b.contactShadow(-W / 2 + 0.26, L - 0.42, 0.34, parent, 0.8);
      kit.prop('coat_hook', [W / 2 - 0.36, 1.72, L - 0.032], { rotation: [0, 180, 0] }, parent);
      kit.prop('drain_grate', [0.12, 0.003, 1.15], { scale: 0.42 }, parent);
    }
    return pivot;
  }

  private towelMesh(material: Material): Mesh {
    const g = new PlaneGeometry(0.29, 0.64, 18, 22);
    const p = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      const x0 = p.getX(i);
      const y = p.getY(i);
      const down = clamp(0.5 - y / 0.64, 0, 1);
      const pinch = lerp(0.42, 1, smootherstep(range(0, 0.28, down)));
      const x = x0 * pinch + Math.sin(down * 5) * 0.012;
      const z = (Math.sin(x0 * 42) * 0.012 + Math.sin(x0 * 19 + 1.2) * 0.02 + Math.sin(x0 * 73 + y * 4) * 0.004) * (0.5 + down * 0.6) + 0.018;
      p.setXYZ(i, x, y, z);
      uv.setXY(i, x, y);
    }
    g.computeVertexNormals();
    const towel = new Mesh(g, material);
    towel.position.set(-W / 2 + 0.018, 1.16, 0.64);
    towel.rotation.y = Math.PI / 2;
    towel.frustumCulled = false;
    towel.receiveShadow = true;
    return towel;
  }

  /** A pipe along points (radius m; `seam` a stain repeat in m). */
  private pipe(points: readonly V3[], radius: number, material: Material, parent: Object3D, seam: number): void {
    const curve = new CatmullRomCurve3(points.map((p) => new Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.12);
    const g = new TubeGeometry(curve, Math.max(10, points.length * 8), radius, 10, false);
    const uv = g.getAttribute('uv');
    const length = curve.getLength();
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (length / (seam * 4)), uv.getY(i) * 0.2);
    const mesh = new Mesh(g, material);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }

  /** The glass shelf under the mirror and what is left on it. */
  private shelf(root: Object3D, m: { enamel: Material; pipe: Material }): void {
    const kit = this.kit;
    const b = this.build;
    const y = GLASS_Y - GLASS_H / 2 - 0.1;
    const board = kit.block(0.5, 0.012, 0.088, new MeshStandardMaterial({ color: 0x4f4c40, roughness: 0.5 }));
    board.position.set(0, y, 0.044);
    root.add(board);
    for (const x of [-0.2, 0.2]) {
      const bracket = kit.block(0.012, 0.05, 0.075, m.pipe);
      bracket.position.set(x, y - 0.032, 0.036);
      root.add(bracket);
    }
    const mug = kit.prop('mug', [-0.15, y + 0.006, 0.05], { rotation: [0, 32, 0] }, root);
    mug.traverse((o) => {
      if ((o as Mesh).isMesh) ((o as Mesh).material as MeshStandardMaterial).color?.multiplyScalar(0.55);
    });
    kit.prop('toothbrush', [-0.145, y + 0.018, 0.052], { rotation: [-76, 22, 0] }, root);
    kit.prop('comb', [0.14, y + 0.0065, 0.05], { rotation: [0, -12, 0] }, root);
    kit.prop('soap_dispenser', [0.0, y + 0.006, 0.045], { rotation: [0, 14, 0], scale: 0.95 }, root);
    this.clocks.push(b.tangle(26, { x: [0.07, 0.2], y: y + 0.0075, z: [0.03, 0.08] }, [0.04, 0.12], root, { seed: 8, width: 0.00035, lift: 0.001, color: 0xa8a79a }).time);
  }

  /** Make the basin's glaze wet-looking (it comes as a flat painted model). */
  private tuneSink(sink: Object3D): void {
    sink.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const m = (mesh.material as MeshStandardMaterial).clone();
      m.color.set(0xd0cec0);
      m.roughness = 0.2;
      m.envMapIntensity = 1.4;
      mesh.material = m;
      mesh.castShadow = true;
    });
  }

  /** Where the basin really is: every tooth that lands in it lands on it. */
  private scanBowl(sink: Object3D): void {
    sink.updateWorldMatrix(true, true);
    const ray = new Raycaster();
    const from = new Vector3();
    const down = new Vector3(0, -1, 0);
    let lowest = Infinity;
    for (let iz = 0; iz < BOWL_NZ; iz++) {
      for (let ix = 0; ix < BOWL_NX; ix++) {
        const x = lerp(-BOWL_X, BOWL_X, ix / (BOWL_NX - 1));
        const z = lerp(BOWL_Z[0], BOWL_Z[1], iz / (BOWL_NZ - 1));
        ray.set(from.set(x, 2, z).add(this.origin), down);
        const hit = ray.intersectObject(sink, true)[0];
        const y = hit ? hit.point.y - this.origin.y : NaN;
        this.bowl[ix + iz * BOWL_NX] = y;
        if (!Number.isNaN(y) && y < lowest) lowest = y;
      }
    }
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (let iz = 0; iz < BOWL_NZ; iz++) {
      for (let ix = 0; ix < BOWL_NX; ix++) {
        const x = lerp(-BOWL_X, BOWL_X, ix / (BOWL_NX - 1));
        const z = lerp(BOWL_Z[0], BOWL_Z[1], iz / (BOWL_NZ - 1));
        const y = this.bowl[ix + iz * BOWL_NX];
        const inside = Math.abs(x) < 0.2 && z > 0.08 && z < 0.42;
        if (inside && (Number.isNaN(y) || y < lowest + 0.004)) {
          sx += x;
          sz += z;
          n++;
        }
        if (Number.isNaN(y)) this.bowl[ix + iz * BOWL_NX] = inside ? lowest : SINK_Y;
      }
    }
    this.drain.set(n ? sx / n : 0, n ? sz / n : 0.25);
  }

  private bowlAt(x: number, z: number): number {
    const fx = clamp((x + BOWL_X) / (2 * BOWL_X), 0, 1) * (BOWL_NX - 1);
    const fz = clamp((z - BOWL_Z[0]) / (BOWL_Z[1] - BOWL_Z[0]), 0, 1) * (BOWL_NZ - 1);
    const ix = Math.min(BOWL_NX - 2, Math.floor(fx));
    const iz = Math.min(BOWL_NZ - 2, Math.floor(fz));
    const tx = fx - ix;
    const tz = fz - iz;
    const at = (i: number, j: number) => this.bowl[i + j * BOWL_NX];
    return lerp(lerp(at(ix, iz), at(ix + 1, iz), tx), lerp(at(ix, iz + 1), at(ix + 1, iz + 1), tx), tz);
  }

  /** A sheet that lies on the bowl's real surface (for what stains it). */
  private basinDecal(draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, material: MeshBasicMaterial): void {
    const canvas = document.createElement('canvas');
    canvas.width = 620;
    canvas.height = 500;
    draw(canvas.getContext('2d')!, 620, 500);
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    material.map = map;
    const g = new BufferGeometry();
    const pos = new Float32Array(BOWL_NX * BOWL_NZ * 3);
    const uv = new Float32Array(BOWL_NX * BOWL_NZ * 2);
    for (let iz = 0; iz < BOWL_NZ; iz++) {
      for (let ix = 0; ix < BOWL_NX; ix++) {
        const x = lerp(-BOWL_X, BOWL_X, ix / (BOWL_NX - 1));
        const z = lerp(BOWL_Z[0], BOWL_Z[1], iz / (BOWL_NZ - 1));
        const k = ix + iz * BOWL_NX;
        pos[k * 3] = x;
        pos[k * 3 + 1] = this.bowl[k] + 0.0012;
        pos[k * 3 + 2] = z;
        uv[k * 2] = ix / (BOWL_NX - 1);
        uv[k * 2 + 1] = 1 - iz / (BOWL_NZ - 1);
      }
    }
    const index: number[] = [];
    for (let iz = 0; iz < BOWL_NZ - 1; iz++) {
      for (let ix = 0; ix < BOWL_NX - 1; ix++) {
        const a = ix + iz * BOWL_NX;
        const c = a + BOWL_NX;
        index.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    g.setIndex(index);
    const mesh = new Mesh(g, material);
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    this.root.add(mesh);
  }

  private hingeChain(part: Object3D, fixture: Object3D): Object3D {
    fixture.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(part);
    const at = new Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
    const hinge = new Object3D();
    hinge.position.copy(fixture.worldToLocal(at));
    fixture.add(hinge);
    hinge.updateWorldMatrix(true, false);
    hinge.attach(part);
    return hinge;
  }

  /** A bare bulb screwed in under the socket; only its glass burns. */
  private dressBulb(socketBottom: number): void {
    const probe = new Box3();
    let baseLow = 0;
    let glassLow = 0;
    const scene = this.kit.model('lightbulb').scene;
    scene.updateWorldMatrix(true, true);
    scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      probe.setFromObject(mesh);
      if (/glass/.test((mesh.material as Material).name)) glassLow = probe.min.y;
      else baseLow = probe.min.y;
    });
    const bulb = this.kit.prop('lightbulb', [0, socketBottom + 0.022, BULB_Z], { anchor: 'top', rotation: baseLow < glassLow ? [180, 0, 0] : [0, 0, 0] }, this.root);
    bulb.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh && /glass/.test((mesh.material as Material).name)) mesh.material = this.bulbMaterial;
    });
  }

  private faceTexture(canvas: HTMLCanvasElement, like: MeshStandardMaterial): CanvasTexture {
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.flipY = like.map!.flipY;
    t.wrapS = like.map!.wrapS;
    t.wrapT = like.map!.wrapT;
    t.anisotropy = 4;
    return t;
  }

  /** A short neck closed over with skin, in the collar of a man with no head: the long neck's own skin, nothing raw. */
  private makeStump(skin: Material): Mesh {
    const profile = [
      [0.052, -0.07],
      [0.05, 0.0],
      [0.046, 0.018],
      [0.037, 0.031],
      [0.022, 0.04],
      [0.0, 0.043],
    ].map(([r, y]) => new Vector2(r, y));
    const g = new LatheGeometry(profile, 24);
    // the grain of the skin runs along the neck, as it does on the long one
    const p = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getY(i) + 0.07) * 2.2, uv.getX(i));
    const stump = new Mesh(g, skin);
    stump.frustumCulled = false;
    stump.castShadow = true;
    stump.receiveShadow = true;
    stump.visible = false;
    return stump;
  }

  /** A tooth's rolling, in rad, at `tau` seconds after it fell. */
  private rollTurn(t: (typeof TEETH)[number], tau: number): number {
    return t.at * 3.7 + 8 * clamp(tau / (t.roll + 0.4), 0, 1.5) + Math.min(tau, t.roll + 0.4) * 2;
  }

  private scoreSound(): void {
    const sound = this.sound;
    this.beat(0, () => {
      this.voices.tone = sound.bed('rooms/bathroom_tone.mp3', { gain: 0.2, fade: 1.2 });
      this.voices.hum = sound.bed('rooms/bulb_hum.mp3', { gain: 0.1, fade: 0.6 });
      this.voices.low = sound.bed('rooms/dream_drone_low.mp3', { gain: 0.12, fade: 9 });
    });
    this.beat(3, () => this.say({ tr: 'Bu sen misin?', en: 'Is that you?' }, 4));
    this.beat(11.5, () => {
      this.voices.high = sound.bed('rooms/dream_drone_glass.mp3', { gain: 0.04, fade: 11 });
      this.voices.drain = sound.bed('rooms/drain_gurgle.mp3', { gain: 0.12, lowpass: 1500, fade: 5 });
    });
    DRIPS.forEach((at, i) => this.beat(at, () => sound.play(`rooms/tile_drip_${(i % 5) + 1}.mp3`, { gain: 0.28, reverb: 0.25, pan: -0.16, rate: 0.96 + ((i * 7) % 5) * 0.02 })));
    CREAKS.forEach((at, i) => this.beat(at, () => sound.play(`rooms/glass_creak_${(i % 4) + 1}.mp3`, { gain: 0.2 + i * 0.012, reverb: 0.15, pan: 0.12 - i * 0.05 })));
    this.beat(MOUTH_AT + 0.25, () => sound.play('rooms/breath_held.mp3', { gain: 0.26 }));
    TEETH.forEach((t, i) => {
      const land = t.at + this.teethParts[i].fall;
      const pan = clamp(Math.cos(t.hit[0]) * 0.6, -0.5, 0.5);
      this.beat(land, () => sound.play(t.loud, { gain: i === 0 ? 0.42 : 0.38, reverb: 0.15, pan, rate: 0.92 + (i % 3) * 0.05 }));
      if (i % 2 === 0) this.beat(land + 0.22, () => sound.play('rooms/tooth_roll.mp3', { gain: 0.3, reverb: 0.15, pan, rate: 0.95 + i * 0.03 }));
    });
    this.beat(32.05, () => sound.play('rooms/teeth_scatter.mp3', { gain: 0.3, reverb: 0.15, pan: -0.05 }));
    this.beat(33.1, () => sound.play('rooms/tooth_clink.mp3', { gain: 0.32, reverb: 0.15, pan: 0.18 }));
    this.beat(30, () => this.say({ tr: 'Dişlerin.', en: 'Your teeth.' }, 3.4));
    // the bed goes to nothing before the bulb does
    this.beat(34.5, () => {
      this.voices.low?.gain(0, 1.4);
      this.voices.high?.gain(0, 1.4);
      this.voices.drain?.gain(0, 1.2);
      this.voices.tone?.gain(0.08, 1.4);
    });
    this.beat(34.8, () => {
      this.voices.hum?.gain(0, 0.5);
      this.voices.flicker = sound.bed('rooms/bulb_hum_unsteady.mp3', { gain: 0.08, fade: 0.4 });
    });
    PULLS.forEach((at, i) => this.beat(at, () => sound.play('rooms/pull_cord.mp3', { gain: i % 2 ? 0.2 : 0.28, reverb: 0.1 })));
    this.beat(HEADLESS_AT - 0.75, () => sound.play('rooms/breath_held.mp3', { gain: 0.3 }));
    this.beat(HEADLESS_AT + 0.35, () => sound.play('rooms/heart_beat.mp3', { gain: 0.36 }));
    this.beat(NECK_FROM + 1.1, () => sound.play('rooms/glass_crack_long.mp3', { gain: 0.1, reverb: 0.2, rate: 0.52, lowpass: 1600 }));
    this.beat(LOOKS_FROM + 0.1, () => sound.play('rooms/heart_beat.mp3', { gain: 0.42, rate: 0.9 }));
    this.beat(PALM_AT, () => {
      sound.play('rooms/palm_on_glass_1.mp3', { gain: 0.34, pan: 0.2 });
      sound.play('rooms/palm_squeak_long.mp3', { gain: 0.16, pan: 0.18, rate: 0.82 });
    });
    this.beat(CRACK_AT, () => {
      sound.play('rooms/glass_crack_1.mp3', { gain: 0.46, reverb: 0.15, pan: 0.15 });
      sound.play('rooms/glass_crack_long.mp3', { gain: 0.3, reverb: 0.15, pan: 0.1 });
    });
    this.beat(GONE_AT + 0.45, () => {
      sound.play('rooms/door_creak_short.mp3', { gain: 0.34, reverb: 0.3, pan: -0.1 });
      this.voices.low?.gain(0.11, 1.4);
      this.voices.high?.gain(0.05, 1.4);
    });
    this.beat(49, () => this.say({ tr: 'Arkana bakma. Orada değil. Burada.', en: 'Do not look behind you. It is not there. It is here.' }, 4.6));
    this.beat(CUT_AT + 1.1, () => sound.play('rooms/tooth_tink_6.mp3', { gain: 0.3, reverb: 0.3, pan: 0.05 }));
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    eye.copy(frame.view.position).sub(this.origin);
    frame.view.getWorldDirection(look);
    const level = bulbAt(s);

    this.lightRoom(level, s);
    this.showReflection(frame, s);
    this.growNeck(frame.time, s);
    this.layTeeth(s);
    this.dripTap(s);
    this.weatherGlass(s, level);
    this.door(frame, s);
    if (!this.shuttered && s >= SHUTTER_AT && s < PALM_AT && !this.unseen(frame, 0, GLASS_Y, 0, 0)) {
      this.shuttered = true;
      this.shutter();
    }

    // the chain swings by itself after each click of the cord
    if (this.chain) {
      const since = s < EMPTY_AT ? 99 : s - lastPull(s);
      this.chain.rotation.z = 0.2 * Math.exp(-since * 0.7) * Math.sin(since * 4.6);
      this.chain.rotation.x = 0.1 * Math.exp(-since * 0.5) * Math.cos(since * 3.7);
    }

    // eyes are where they are looking: at the glass's man, or at the basin
    const down = smootherstep(range(-0.45, -0.78, look.y));
    this.focus = lerp(Math.max(0.8, eye.z * 2), Math.max(0.5, eye.y - 0.8), down);
    this.fear = 0.22 + 0.34 * range(12, 30, s) + 0.34 * range(36, 46, s);
    this.film.aberration = !REDUCED_MOTION && CRACK_AT <= s && s < CRACK_AT + 0.7 ? 0.004 * (1 - (s - CRACK_AT) / 0.7) : 0;
    this.black = s >= CUT_AT ? 1 : 0;
    this.control.look = s < HOLD_GAZE[0] || s > HOLD_GAZE[1];
    if (s >= CUT_AT && !this.cut) {
      this.cut = true;
      this.sound.stopAll(0.05);
    }
    for (const c of this.clocks) c.value = frame.time;
  }

  private lightRoom(level: number, s: number): void {
    this.bulbLight.intensity = BULB_POWER * level;
    this.echoLight.intensity = ECHO_POWER * level;
    this.basinSpot.intensity = BASIN_LIGHT * level;
    this.poolSpot.intensity = POOL_LIGHT * level;
    this.backFill.intensity = FILL_POWER * clamp(level * 2, 0.12, 1);
    this.backEcho.intensity = FILL_POWER * clamp(level * 2, 0.12, 1) * (s >= HEADLESS_AT && s < GONE_AT ? 0.45 : 1);
    // his face keeps one exposure, wherever you stand
    v1.set(FACE_SPOT_AT[0], FACE_SPOT_AT[1], FACE_SPOT_AT[2]);
    v2.set(eye.x, eye.y, -eye.z);
    this.faceSpot.intensity = FACE_LIGHT * level * clamp(v1.distanceToSquared(v2), 0.2, 4);
    const off = 1 - clamp(level / 0.22, 0, 1);
    this.hauntLight.intensity = HAUNT_POWER * off * smootherstep(range(0, 0.8, s - EMPTY_AT));
    this.air.envIntensity = lerp(ENV_DARK, ENV, clamp(level, 0, 1));
    this.bulbMaterial.color.setRGB(3.4 * level + 0.02, 2.6 * level + 0.01, 1.7 * level + 0.002);
    (this.halo.material as ShaderMaterial).uniforms.uColor.value.setRGB(0.75, 0.56, 0.35).multiplyScalar(level * level);
    const near = clamp(eye.distanceTo(v3.set(0, 2, BULB_Z)) / HALO_FULL_AT, 0.22, 1);
    this.halo.scale.set(HALO_SIZE * near, HALO_SIZE * near, 1);
    const basin = s >= BASIN_SPOT[0] && s < BASIN_SPOT[1];
    const wanted = basin ? this.basinSpots : this.faceSpots;
    if (this.spots !== wanted) this.spots = wanted;

    const humming = level > 0.2;
    if (humming !== this.humOn) {
      this.humOn = humming;
      this.voices.flicker?.gain(humming ? 0.08 : 0, 0.06);
      this.voices.hum?.gain(humming && s < 34 ? 0.1 : 0, 0.06);
    }
  }

  private showReflection(frame: RoomFrame, s: number): void {
    const man = this.man.root;
    const shown = s < EMPTY_AT || (s >= HEADLESS_AT && s < GONE_AT);
    man.visible = shown;
    const headed = s < EMPTY_AT;
    for (const m of this.headMeshes) m.visible = headed;
    this.stump.visible = shown && !headed;
    if (!shown) return;
    const map = s >= GUMS_AT ? this.gums : this.toothed;
    if (this.headMaterial.map !== map) this.headMaterial.map = map;

    const face = this.face;
    face.rest();
    for (const e of this.eyes) e.bone.quaternion.copy(e.rest);
    const a = this.arm;
    a.upper.quaternion.copy(a.upperRest);
    a.fore.quaternion.copy(a.foreRest);
    a.hand.quaternion.copy(a.handRest);
    for (const f of this.fingers) f.bone.quaternion.copy(f.rest);

    const palm = smootherstep(range(PALM_FROM, PALM_AT, s)) * (1 - smootherstep(range(PALM_OFF, PALM_OFF + 0.5, s)));
    const stillness = smootherstep(range(STILL_AT[0], STILL_AT[1], s));
    const breathe = (1 - stillness) * BREATH_Y * Math.sin(s * BREATH_RATE);
    man.position.set(eye.x - this.eyeOffset.x, eye.y - this.eyeOffset.y + breathe, -eye.z - this.eyeOffset.z + REACH_LEAN * palm);
    man.updateMatrixWorld(true);
    for (const e of this.eyes) e.bone.getWorldQuaternion(e.world);

    // the mirror keeps x and y of a direction and flips z: what you look at, it looks at
    const follow = 1 - smootherstep(range(FOLLOW_ENDS, FOLLOW_ENDS + 1.3, s));
    const wantYaw = clamp(Math.atan2(look.x, -look.z), -MAX_TURN, MAX_TURN);
    const wantPitch = clamp(-Math.asin(clamp(look.y, -1, 1)), -MAX_NOD, MAX_NOD);
    const lag = lerp(LAG_EARLY, LAG_LATE, smootherstep(range(LAG_GROWS[0], LAG_GROWS[1], s)));
    this.faceYaw = damp(this.faceYaw, wantYaw * follow, 1 / lag, frame.dt);
    this.facePitch = damp(this.facePitch, wantPitch * follow, 1 / lag, frame.dt);

    if (this.overrunAt === 0 && s >= OVERRUN_FROM && s < FOLLOW_ENDS) {
      const stopped = frame.input.idle > 0.5 && Math.abs(frame.input.gazeYaw) > 0.06;
      if (stopped || s >= OVERRUN_AT) {
        this.overrunAt = s;
        this.overrunSign = wantYaw < 0 ? -1 : 1;
      }
    }
    const overrun = this.overrunAt > 0 ? OVERRUN * this.overrunSign * smootherstep(range(this.overrunAt, this.overrunAt + 1.9, s)) * follow : 0;
    const tilt = TILT * smootherstep(range(TILT_AT, TILT_AT + 2, s));
    euler.set(this.facePitch, this.faceYaw + overrun, tilt, 'YXZ');
    q2.setFromEuler(euler);
    if (headed || this.stump.visible) {
      q1.identity().slerp(q2, NECK_SHARE);
      turnWorld(face.neck, q1);
      q1.invert();
      q5.copy(q2).multiply(q1);
      turnWorld(face.head, q5);
      const open = JAW_OPEN * smootherstep(range(MOUTH_AT, MOUTH_AT + 2.2, s));
      const smile = smootherstep(range(SMILE_FROM, SMILE_FROM + 3.2, s));
      face.mouth(open, smile, q2);
      for (const e of this.eyes) setWorld(e.bone, e.world);
    }

    if (palm > 0) this.reachGlass(palm);
    man.updateMatrixWorld(true);

    if (!headed) {
      face.neck.getWorldPosition(v1).sub(this.origin);
      this.stump.position.set(v1.x, v1.y + 0.03, v1.z + 0.008);
    }
  }

  /** Two-bone reach for the wrist, the palm laid flat on the inside of the glass. */
  private reachGlass(w: number): void {
    const { upper, fore, hand } = this.arm;
    upper.getWorldPosition(v1);
    fore.getWorldPosition(v2);
    hand.getWorldPosition(v3);
    v4.set(PALM_X + WRIST_ASIDE, PALM_Y - WRIST_BELOW, -WRIST_BACK).add(this.origin);
    v4.lerpVectors(v3, v4, w);
    const a = v1.distanceTo(v2);
    const b = v2.distanceTo(v3);
    const c = clamp(v1.distanceTo(v4), Math.abs(a - b) + 1e-4, a + b - 1e-4);
    v5.subVectors(v4, v1).normalize();
    v6.set(0.5, -0.8, -0.5).addScaledVector(v5, -v5.dot(v1.set(0.5, -0.8, -0.5))).normalize();
    upper.getWorldPosition(v1);
    const cosA = clamp((a * a + c * c - b * b) / (2 * a * c), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    v4.copy(v1).addScaledVector(v5, a * cosA).addScaledVector(v6, a * sinA);
    v3.subVectors(v2, v1).normalize();
    v2.subVectors(v4, v1).normalize();
    turnWorld(upper, q1.setFromUnitVectors(v3, v2));
    fore.getWorldPosition(v2);
    hand.getWorldPosition(v3);
    v3.sub(v2).normalize();
    v4.copy(v1).addScaledVector(v5, c).sub(v2).normalize();
    turnWorld(fore, q1.setFromUnitVectors(v3, v4));
    hand.getWorldQuaternion(q2);
    q2.slerp(this.palmTurn, w);
    setWorld(hand, q2);
    for (const f of this.fingers) {
      q1.setFromAxisAngle(AXIS_Z, -FLAT[f.joint] * w);
      f.bone.quaternion.multiply(q1);
      if (f.spread !== 0) f.bone.quaternion.multiply(q1.setFromAxisAngle(AXIS_Y, f.spread * w));
      f.bone.updateMatrixWorld(true);
    }
    hand.updateMatrixWorld(true);
  }

  /** The neck as far as it has come, and the head where it has got to. */
  private growNeck(time: number, s: number): void {
    const hide = s < NECK_FROM || s >= GONE_AT;
    this.neck.visible = !hide;
    this.ghost.root.visible = !hide;
    if (hide) return;
    const grown = 1 - (1 - smootherstep(range(NECK_FROM, NECK_TO, s))) ** 1.3;
    const length = Math.max(0.06, this.neckLength * grown);
    // it rises out of the collar, where the short neck stands until its own skin fills it
    const collar = this.stump.position;
    if (length > STUMP_GOES) this.stump.visible = false;
    const centers = this.neckCenters;
    for (let i = 0; i <= NECK_RINGS; i++) {
      const u = this.neckAt((i / NECK_RINGS) * length);
      pathPoint(NECK_PATH, u, v1);
      const along = i / NECK_RINGS;
      const sway = along * 0.012 * smootherstep(range(NECK_IN, NECK_IN + COLLAR_TAPER, along * length));
      centers[i * 3] = v1.x + collar.x + sway * Math.sin(time * 0.7 + along * 7);
      centers[i * 3 + 1] = v1.y + collar.y + sway * 0.6 * Math.sin(time * 0.53 + along * 9);
      centers[i * 3 + 2] = v1.z + collar.z + sway * Math.cos(time * 0.61 + along * 5);
    }
    v2.set(1, 0, 0);
    for (let i = 0; i <= NECK_RINGS; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(NECK_RINGS, i + 1);
      v1.set(centers[b * 3] - centers[a * 3], centers[b * 3 + 1] - centers[a * 3 + 1], centers[b * 3 + 2] - centers[a * 3 + 2]).normalize();
      v2.addScaledVector(v1, -v2.dot(v1));
      if (v2.lengthSq() < 1e-4) v2.set(0, 0, 1).addScaledVector(v1, -v1.z);
      v2.normalize();
      v3.crossVectors(v1, v2);
      const along = i / NECK_RINGS;
      const knuckle = Math.sin(along * this.neckLength * 96);
      const own = lerp(NECK_R[0], NECK_R[2], along) + (NECK_R[1] - NECK_R[2]) * smootherstep(range(0.93, 1, along));
      const collared = COLLAR_R * (1 - smootherstep(range(NECK_IN, NECK_IN + COLLAR_TAPER, along * length)));
      const r = Math.max(own, collared) * (1 + 0.11 * knuckle * knuckle * Math.sign(knuckle));
      const uvx = along * this.neckLength * 2.2;
      for (let j = 0; j <= NECK_SIDES; j++) {
        const ang = (j / NECK_SIDES) * Math.PI * 2;
        const c = Math.cos(ang);
        const sn = Math.sin(ang);
        const nx = v2.x * c + v3.x * sn;
        const ny = v2.y * c + v3.y * sn;
        const nz = v2.z * c + v3.z * sn;
        const k = i * (NECK_SIDES + 1) + j;
        this.neckPos.setXYZ(k, centers[i * 3] + nx * r, centers[i * 3 + 1] + ny * r, centers[i * 3 + 2] + nz * r);
        this.neckNor.setXYZ(k, nx, ny, nz);
        this.neckUv.setXY(k, uvx, j / NECK_SIDES);
      }
    }
    this.neckPos.needsUpdate = true;
    this.neckNor.needsUpdate = true;
    this.neckUv.needsUpdate = true;

    // the head: upright, looking where it is going, and at last at you
    const n = NECK_RINGS;
    v1.set(centers[n * 3], centers[n * 3 + 1], centers[n * 3 + 2]);
    v2.set(centers[n * 3] - centers[(n - 3) * 3], centers[n * 3 + 1] - centers[(n - 3) * 3 + 1], centers[n * 3 + 2] - centers[(n - 3) * 3 + 2]).normalize();
    const looks = smootherstep(range(LOOKS_FROM, LOOKS_TO, s));
    v3.set(eye.x - v1.x, eye.y - v1.y, eye.z - v1.z).normalize();
    v4.set(v2.x, 0, v2.z);
    if (v4.lengthSq() < 0.02) v4.set(-0.8, 0, 0.5);
    v4.normalize().lerp(v3, looks).normalize();
    v5.set(0, 1, 0).addScaledVector(v2, -0.34 * (1 - looks)).normalize();
    v5.addScaledVector(v4, -v5.dot(v4)).normalize();
    v6.crossVectors(v5, v4).normalize();
    m1.makeBasis(v6, v5, v4);
    q1.setFromRotationMatrix(m1);
    q2.setFromAxisAngle(v4, 0.2 * looks + 0.08);
    q1.premultiply(q2);
    const ghost = this.ghost.root;
    ghost.quaternion.copy(q1);
    v2.copy(this.ghostRest).applyQuaternion(q1);
    ghost.position.copy(v1).sub(v2);
  }

  /** How far along the path (0..1) a length of neck reaches. */
  private neckAt(d: number): number {
    const table = this.neckTable;
    const n = table.length - 1;
    if (d >= table[n]) return 1;
    let i = 0;
    while (i < n - 1 && table[i + 1] < d) i++;
    return (i + (d - table[i]) / Math.max(1e-6, table[i + 1] - table[i])) / n;
  }

  private layTeeth(s: number): void {
    let shown = 0;
    let moved = false;
    for (let i = 0; i < TEETH.length; i++) {
      const t = TEETH[i];
      const tau = s - t.at;
      if (tau < 0) break;
      shown = i + 1;
      const part = this.teethParts[i];
      const roll = t.roll + 0.4;
      const done = tau > part.fall + roll + 0.1;
      if (done && this.atRest[i]) continue;
      this.atRest[i] = done ? 1 : 0;
      moved = true;
      const hitX = this.drain.x + Math.cos(t.hit[0]) * t.hit[1];
      const hitZ = this.drain.y + Math.sin(t.hit[0]) * t.hit[1];
      let x: number;
      let y: number;
      let z: number;
      if (tau < part.fall) {
        const f = tau / part.fall;
        x = lerp(eye.x + 0.005, hitX, f);
        z = lerp(eye.z - MOUTH_DROP[1], hitZ, f);
        y = lerp(eye.y - MOUTH_DROP[0], this.bowlAt(hitX, hitZ) + 0.02, f * f);
      } else {
        const e = smootherstep(clamp((tau - part.fall) / roll, 0, 1));
        const angle = lerp(t.hit[0], t.rest[0] + Math.PI * 2 * Math.sign(t.rest[0] - t.hit[0]), e);
        const radius = lerp(t.hit[1], t.rest[1], e);
        x = this.drain.x + Math.cos(angle) * radius;
        z = this.drain.y + Math.sin(angle) * radius;
        const hop = tau - part.fall < 0.22 ? 0.05 * Math.sin(((tau - part.fall) / 0.22) * Math.PI) : 0;
        y = this.bowlAt(x, z) + TOOTH_SCALE * 0.0085 + hop;
      }
      q1.setFromAxisAngle(part.axis, this.rollTurn(t, tau)).multiply(part.base);
      m1.compose(v1.set(x, y, z), q1, v2.setScalar(TOOTH_SCALE)).multiply(TO_CENTER);
      this.teeth.setMatrix(i, m1);
    }
    this.teeth.drawn = shown;
    if (moved) this.teeth.commit();
    this.freshBlood.opacity = 0.75 * smootherstep(range(26, 33.5, s));
  }

  private dripTap(s: number): void {
    let next = -1;
    for (let i = 0; i < DRIPS.length; i++) {
      if (DRIPS[i] > s) {
        next = DRIPS[i];
        break;
      }
    }
    const away = next - s;
    if (next < 0 || away > DRIP_HANGS + DRIP_FALL) {
      this.drop.visible = false;
      return;
    }
    this.drop.visible = true;
    const tip = this.tapTip;
    if (away > DRIP_FALL) {
      const grow = clamp(1 - (away - DRIP_FALL) / DRIP_HANGS, 0.25, 1);
      this.drop.position.set(tip.x, tip.y - 0.004 * grow, tip.z);
      this.drop.scale.setScalar(grow);
    } else {
      const f = (DRIP_FALL - away) / DRIP_FALL;
      const floor = this.bowlAt(tip.x, tip.z);
      this.drop.position.set(tip.x, lerp(tip.y - 0.004, floor, f * f), tip.z);
      this.drop.scale.set(0.8, 1.5, 0.8);
    }
  }

  private weatherGlass(s: number, level: number): void {
    const g = this.glass;
    g.uFog.value = 0.45 * smootherstep(range(PALM_AT, PALM_AT + 1.3, s));
    g.uCrack.value = s < CRACK_AT ? 0 : 1.6 * clamp((s - CRACK_AT) / 0.14, 0, 1);
    g.uLight.value = clamp(level, 0, 1);
    this.mouthOnGlass.set(eye.x / GLASS_W + 0.5, (eye.y - MOUTH_DROP[0] - GLASS_Y) / GLASS_H + 0.5);
    const wave = 0.5 + 0.5 * Math.sin(s * BREATH_RATE);
    g.uBreath.value = smootherstep(range(1.05, 0.74, eye.z)) * (1 - smootherstep(range(BREATH_STOPS - 0.8, BREATH_STOPS, s))) * wave * wave;
    g.uMist.value = lerp(1, MIST_LEFT, smootherstep(range(CRACK_AT, CRACK_AT + 2.4, s)));
  }

  private door(frame: RoomFrame, s: number): void {
    const open = s >= GONE_AT;
    this.doorLeaf.rotation.y = open ? -DOOR_OPEN : 0;
    this.visitor.root.visible = open;
    const dim = bulbAt(s);
    this.doorLight.intensity = open ? 0.75 * clamp(dim * 1.8, 0.1, 1) : 0;
    if (!open) return;
    const looking = !this.unseen(frame, 0, GLASS_Y, 0, 0) && look.z < -0.2;
    if (s > GONE_AT + 0.7) {
      if (!looking) this.turnedAway = true;
      else if (this.turnedAway) {
        this.turnedAway = false;
        this.walked++;
      }
    }
    let timed = 0;
    for (let i = 0; i < VISITOR_STEPS.length; i++) if (s >= VISITOR_STEPS[i]) timed = i + 1;
    const step = Math.min(VISITOR.length - 1, Math.max(timed, this.walked));
    if (step !== this.visitorStep) {
      const first = this.visitorStep < 0;
      this.visitorStep = step;
      const [x, z] = VISITOR[step];
      this.visitor.set(0, x, 0, z, 0, 1);
      this.visitor.commit();
      if (!first) this.sound.play(`rooms/wet_step_${(step % 4) + 1}.mp3`, { gain: 0.18 + step * 0.1, reverb: 0.25, lowpass: 900 + step * 600, pan: -0.1 });
    }
  }
}

/** Second of the last click of the cord before `s`. */
function lastPull(s: number): number {
  let at = 0;
  for (let i = 0; i < PULLS.length; i++) if (PULLS[i] <= s) at = PULLS[i];
  return at;
}

/** Glass front, enamel, a flange against the wall (distance from the glass, height over the wall; m). */
const FRAME_PROFILE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.003, 0.01],
  [0.01, 0.02],
  [0.038, 0.02],
  [0.043, 0.013],
  [0.043, 0.004],
  [0.06, 0.004],
  [0.062, 0],
];

/** What only the mirror wall has: the frame's dark, what has run from it and from the taps, the shelf and the basin's shadow. */
function mirrorWallMarks(c: CanvasRenderingContext2D, X: (x: number) => number, Y: (y: number) => number): void {
  const half = W / 2;
  const rand = randomFrom(21);
  const xAt = (x: number) => X(x + half);
  const left = xAt(-GLASS_W / 2 - 0.08);
  const right = xAt(GLASS_W / 2 + 0.08);
  const top = Y(GLASS_Y + GLASS_H / 2 + 0.08);
  const bottom = Y(GLASS_Y - GLASS_H / 2 - 0.08);
  c.save();
  c.filter = 'blur(9px)';
  c.fillStyle = 'rgba(4,6,3,0.72)';
  c.fillRect(left - 3, top + 2, right - left + 6, bottom - top + 12);
  c.restore();
  // rust that ran from the two lower corners and the mirror's hinge
  for (const x of [-GLASS_W / 2 - 0.058, GLASS_W / 2 + 0.058, -0.1, 0.07, 0.2]) {
    const n = Math.abs(x) > 0.25 ? 9 : 3;
    for (let i = 0; i < n; i++) {
      const x0 = xAt(x + (rand() - 0.5) * 0.04);
      const y0 = Y(GLASS_Y - GLASS_H / 2 - 0.07);
      const points = [x0, y0];
      for (let k = 1; k <= 5; k++) points.push(x0 + (rand() - 0.5) * 4, y0 + (k / 5) * (40 + rand() * 80));
      stroke(c, points, 1 + rand() * 3.4, `rgba(72,42,14,${(0.2 + rand() * 0.3).toFixed(2)})`);
    }
  }
  // the green that grows under old taps
  for (const x of [-0.13, 0.13]) {
    for (let i = 0; i < 3; i++) stroke(c, [xAt(x + (rand() - 0.5) * 0.014), Y(0.98), xAt(x + (rand() - 0.5) * 0.02), Y(0.92)], 1.2 + rand() * 1.5, `rgba(28,60,44,${(0.25 + rand() * 0.2).toFixed(2)})`);
  }
  // under the shelf and the basin
  c.save();
  c.filter = 'blur(7px)';
  c.fillStyle = 'rgba(4,6,3,0.5)';
  const shelfY = Y(GLASS_Y - GLASS_H / 2 - 0.1);
  c.fillRect(xAt(-0.27), shelfY + 1, xAt(0.27) - xAt(-0.27), 13);
  c.restore();
  const under = c.createLinearGradient(0, Y(0.87), 0, Y(0.3));
  under.addColorStop(0, 'rgba(3,5,2,0.86)');
  under.addColorStop(1, 'rgba(3,5,2,0)');
  c.save();
  c.filter = 'blur(26px)';
  c.fillStyle = under;
  c.fillRect(xAt(-0.36), Y(0.87), xAt(0.36) - xAt(-0.36), Y(0.3) - Y(0.87));
  c.restore();
  // tiles that have lost their corners or fallen
  const chip = (x: number, y: number, size: number) => {
    const points = 7;
    c.fillStyle = 'rgba(16,14,10,0.92)';
    c.beginPath();
    for (let i = 0; i < points; i++) {
      const a = (i / points) * Math.PI * 2;
      const r = size * (0.6 + rand() * 0.55);
      c.lineTo(xAt(x) + Math.cos(a) * r, Y(y) + Math.sin(a) * r);
    }
    c.closePath();
    c.fill();
  };
  for (const [x, y, size] of [[-0.56, 1.32, 5], [0.62, 1.16, 7], [-0.62, 1.86, 4], [0.34, 1.44, 3]]) chip(x, y, size);
  // clean the glass's own hole out of the sheet
  c.clearRect(xAt(-GLASS_W / 2), Y(GLASS_Y + GLASS_H / 2), xAt(GLASS_W / 2) - xAt(-GLASS_W / 2), Y(GLASS_Y - GLASS_H / 2) - Y(GLASS_Y + GLASS_H / 2));
}

/** The basin's old life: a scum line round the drain, the brown track from the tap, crazing. */
function drawBasinStain(c: CanvasRenderingContext2D, w: number, h: number): void {
  const rand = randomFrom(61);
  c.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h * 0.52;
  const shade = c.createRadialGradient(cx, cy, 60, cx, cy, 250);
  shade.addColorStop(0, 'rgba(26,28,20,0)');
  shade.addColorStop(0.6, 'rgba(26,28,20,0.24)');
  shade.addColorStop(1, 'rgba(26,28,20,0.46)');
  c.fillStyle = shade;
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const r = 24 + rand() * 30;
    spot(c, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 8 + rand() * 18, 8 + rand() * 16, `rgba(82,54,18,${(0.08 + rand() * 0.2).toFixed(2)})`);
  }
  c.save();
  c.filter = 'blur(5px)';
  for (let i = 0; i < 9; i++) {
    const x0 = w * 0.3 + rand() * 18;
    const points = [x0, h * 0.2];
    for (let k = 1; k <= 7; k++) points.push(lerp(x0, cx + (rand() - 0.5) * 10, k / 7) + Math.sin(k * 0.9 + i) * 8, lerp(h * 0.2, cy, k / 7));
    stroke(c, points, 3 + rand() * 7, `rgba(92,62,20,${(0.08 + rand() * 0.14).toFixed(2)})`);
  }
  c.restore();
  for (let i = 0; i < 70; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const a = rand() * Math.PI * 2;
    const len = 12 + rand() * 50;
    stroke(c, [x, y, x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5, x + Math.cos(a + 0.5) * len, y + Math.sin(a + 0.5) * len], 0.7, 'rgba(50,44,30,0.22)');
  }
  keepInBowl(c, w, h);
}

/** What the teeth left: a thin pink wash and one thread running to the drain. */
function drawBasinBlood(c: CanvasRenderingContext2D, w: number, h: number): void {
  const rand = randomFrom(62);
  c.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h * 0.52;
  for (let i = 0; i < 22; i++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * 62;
    spot(c, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 10 + rand() * 22, 8 + rand() * 18, `rgba(112,10,12,${(0.06 + rand() * 0.14).toFixed(2)})`);
  }
  for (let i = 0; i < 3; i++) {
    const a = rand() * Math.PI * 2;
    const r = 40 + rand() * 30;
    const points = [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    for (let k = 1; k <= 6; k++) {
      const f = 1 - k / 6;
      points.push(cx + Math.cos(a + (1 - f) * 0.5) * (r * f + 8) + (rand() - 0.5) * 3, cy + Math.sin(a + (1 - f) * 0.5) * (r * f + 8) + (rand() - 0.5) * 3);
    }
    stroke(c, points, 0.8 + rand() * 1.6, `rgba(96,6,8,${(0.3 + rand() * 0.34).toFixed(2)})`);
  }
  keepInBowl(c, w, h);
}

/** Nothing on a sheet lying on the bowl may reach the steep sides, where its grid is too coarse to follow them. */
function keepInBowl(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.save();
  c.globalCompositeOperation = 'destination-in';
  c.translate(w / 2, h * 0.52);
  c.scale(1, 0.8);
  const g = c.createRadialGradient(0, 0, 150, 0, 0, 212);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(-w, -h, w * 2, h * 3);
  c.restore();
}

