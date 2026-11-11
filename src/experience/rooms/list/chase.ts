import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  DoubleSide,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { SpotSpec } from '../../../config/nightmare.config';
import type { DreamLight } from '../../dream/LightPool';
import { randomFrom, type Crowd } from '../../dream/FigureKit';
import type { PropCrowd } from '../../dream/DreamKit';
import { clamp, DEG, lerp, range, smootherstep } from '../../math';
import { GlideTrack } from '../../timeline/Track';
import type { RoomAir, RoomAssets, RoomContext, RoomControl, RoomFrame, RoomKey, RoomPose } from '../Room';
import { Room } from '../Room';
import { PALETTE, type Facing } from '../RoomKit';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['rat', 'mri_head', 'radiator', 'chair_ladder'],
  materials: ['flesh_smeared'],
  sounds: [
    'rooms/run_feet.mp3',
    'rooms/run_feet_hard.mp3',
    'rooms/breath_fast.mp3',
    'rooms/run_breath.mp3',
    'rooms/heart_fast.mp3',
    'rooms/wet_weight.mp3',
    'rooms/rats_claws.mp3',
    'rooms/meat_kneaded.mp3',
    'rooms/breath_open_mouth.mp3',
    'rooms/dream_drone_hollow.mp3',
    'rooms/rats_pass_1.mp3',
    'rooms/rats_pass_2.mp3',
    'rooms/rats_pass_3.mp3',
    'rooms/rat_squeal_1.mp3',
    'rooms/rat_squeal_2.mp3',
    'rooms/rat_squeal_3.mp3',
    'rooms/rat_squeal_4.mp3',
    'rooms/rat_chirp_far_1.mp3',
    'rooms/rat_chirp_far_3.mp3',
    'rooms/run_step_1.mp3',
    'rooms/run_step_2.mp3',
    'rooms/run_step_3.mp3',
    'rooms/run_step_4.mp3',
    'rooms/breath_catch_1.mp3',
    'rooms/breath_catch_2.mp3',
    'rooms/breath_catch_4.mp3',
    'rooms/breath_out.mp3',
    'rooms/belt_slither_1.mp3',
    'rooms/belt_slither_2.mp3',
    'rooms/belt_slither_3.mp3',
    'rooms/door_pass_1.mp3',
    'rooms/wet_slap_1.mp3',
    'rooms/wet_slap_2.mp3',
    'rooms/wet_slap_3.mp3',
    'rooms/wet_slap_4.mp3',
    'rooms/mouth_wet_1.mp3',
    'rooms/mouth_wet_3.mp3',
    'rooms/door_slam.mp3',
    'rooms/door_thud.mp3',
    'rooms/door_knock_heavy.mp3',
    'rooms/door_creak_slow.mp3',
    'rooms/heart_beat.mp3',
  ],
};

/** The paper of this corridor: ground and pattern, a little lighter than the house's teal, so that the dark between lamps is still a wall. */
const WALLPAPER = ['#16353c', '#4a8488'] as const;
/** Inner width and height of the corridor, and one repeat of it, a lap (m). */
const W = 2.6;
const H = 2.75;
const LAP = 12;
/** Repeats that exist, and where the first of them starts (m along z). */
const COPIES = 9;
const FIRST_Z = 48;
/** Length of the long surfaces (m): from FIRST_Z to beyond the fog. */
const LONG = 108;
/** Which repeats have a real light (the pool holds six: five lamps and the cold one that comes with it). */
const LIT = [3, 4, 5, 6, 7] as const;
/** Inside a lap (z from its start): the table, the man, the radiator, the chair, the dead tube (m). */
const TABLE_Z = -3.6;
const TABLE_X = W / 2 - 0.3;
const MAN_Z = -5.6;
const MAN_X = W / 2 - 0.3;
const RADIATOR_Z = -2.9;
const CHAIR_Z = -10.1;
const TUBE_Z = -9.3;
/** The doors of a lap: side (+1 right, -1 left), z, how far ajar. */
const SIDE_DOORS = [
  { side: -1, z: -8.6, open: 0.2 },
  { side: 1, z: -10.6, open: 0 },
] as const;
const CLOCK_SIZE = 1.5;
const PRINT_Y = 1.62;
/** Lamp: warm, candela and reach (m); the far ones come on gently inside this z (m). */
const LAMP_LIGHT = 7.5;
const LAMP_REACH = 9.5;
const LAMP_FAR: readonly [number, number] = [-29, -20];
const LAMP_BEHIND: readonly [number, number] = [14, 20];
/** What is left of a lamp once the skin has reached it. */
const LAMP_UNDER_SKIN = 0.14;

/** Seconds of the room. */
const LEGS_GO = 24;
const WATER_FULL = 30;
/** By now it is settled whether they ran; the door was passed, the leaf slams; scrolling ends. */
const DECIDE = 29;
const STOP = 34.1;
const SLAM = 33.85;
const LOCK = 33;
/** Caught: the frame is full of it, the socket closes over you. Escaped: the same door opens. Both end at CUT. */
const SHOT_CAUGHT = 35.4;
const SWALLOWED = 36.3;
const DOOR_OPENS = 39;
const SHOT_ESCAPED = 40.3;
const CUT = 41;

/** Running pace, and pace in water (m/s); a step (m). */
const PACE = REDUCED_MOTION ? 2.4 : 4.2;
const PACE_WATER = REDUCED_MOTION ? 0.6 : 0.8;
const STEP = 1.2;
/** Where a lap stands at the start (m): chosen so that a table stands by the viewer at the look back at 28. */
const START_PHASE = -0.8;
/** Resolution of the table of distance run (s). */
const RUN_STEP = 0.05;
/** Seconds to turn the head by itself. */
const TURN = REDUCED_MOTION ? 2.4 : 0.95;
const TURN_LATE = Math.min(TURN, 1.4);
/** How much faster scrolling can drive the room: running, and in water. */
const HURRY_RUN = 3.2;
const HURRY_WATER = 1.12;
/** Bob of the head (m): at its own pace and with everything; sideways (m); roll and nod (rad). */
const BOB = 0.055;
const BOB_HARD = 0.095;
const SWAY = 0.028;
const ROLL = 1.3 * DEG;
const NOD = 0.8 * DEG;
const EYE_Y = 1.6;

/** How far behind it comes (s, m), when nobody scrolls. */
const GAP_WAY: readonly (readonly [number, number])[] = [
  [0, 34],
  [15, 21],
  [24, 11],
  [28, 6.6],
  [31, 4],
  [33, 2.4],
  [SHOT_CAUGHT, 1.55],
  [SWALLOWED, 0.28],
];
/** Meters of distance scrolling buys per second at full legs; lost per second; at most (m). */
const CREDIT_RATE = 1.6;
const CREDIT_LOSS = 0.45;
const CREDIT_MAX = 14;
/** Mean of legs over the room that counts as having run all the way; how close it is when the door slams (m). */
const ESCAPE_EFFORT = 0.42;
const ESCAPE_GAP = 4.4;
/** The doors of the end, in a lap: z of the first and of the same door again (m); how far past the first the viewer stops; how far ahead it stands when it is seen first; wall thickness. */
const DOOR_Z = -0.6;
const DOOR2_Z = -6.8;
const DOOR_PAST = 1.7;
const DOOR_AHEAD = 26;
const DOOR_T = 0.16;
/** How far open the first door stands (rad), how far the second opens (rad). */
const LEAF_OPEN = 1.5;
const LEAF2_OPEN = 0.85;
/** Blows on the door after the slam (s). */
const BLOWS = [SLAM + 0.02, 34.55, 35.3, 36.35] as const;
/** When the light under the door goes out: the thing has gone from behind it, and that is the relief (s). */
const LEAK_ENDS: readonly [number, number] = [36.7, 37.5];

/** Head: its height (m), the height of its eyes (m); how far the socket shifts to come over the eye at the end (m). */
const HEAD = 3;
const EYE_LEVEL = 1.62;
const SOCKET_X = 0.41;
/** Passes that wear the scan's terraces away. */
const HEAD_RELAX = 3;
/** The scan's features (its own space, 1 tall, nose +Z). */
const SCAN = { eyeX: 0.137, eyeY: 0.5165, mouthX: 0.012, mouthY: 0.2505 };
/** The sleeve of skin: around, along (rings), how far it reaches ahead of the nose and behind it (m), the throat it closes on (m), its folds around, the arch it covers (rad). */
const SLEEVE = { around: 150, along: 110, lip: 5.2, back: 0.55, rx: 0.9, ry: 1.22, cy: 1.5, folds: 38, from: -64 * DEG, to: 244 * DEG, tile: 3 };
/** How much farther the fingers of the sleeve reach (m); the sleeve's own lightness. */
const FINGER = 2.1;
const SLEEVE_SHADE = 0.72;
/** Its light: spot candela, and the cold that creeps ahead of it. */
const FACE_SPOT = 15;
const FACE_GLOW = 1.8;
/** Where the spot on the face stands (m), up and to one side of it and ahead of its nose. */
const FACE_FROM = { x: 1.05, y: 2.62, ahead: 1.7 };
const FACE_GLOW_REACH = 13;

/** Rats: how many, how many are the real model; size; where they start and vanish (m); how much faster than you they run (m/s). */
const RATS = 120;
const RATS_NEAR = 34;
const RAT_SIZE: readonly [number, number] = [2.6, 3.7];
/** How light their coats are, how much flatter than the file they run, how far each one's way leans (rad). */
const RAT_SHADE = 0.95;
const RAT_FLAT = 0.8;
const RAT_LEAN = 0.3;
const RAT_FROM_Z = 1.4;
const RAT_GONE_Z = -46;
const RAT_NEAR_Z = -8;
const RAT_FASTER: readonly [number, number] = [1.2, 4.6];
const RATS_START = 6;
const RATS_END = 24;
/** Things said by the rats (s, pan): the file index cycles. */
const SQUEALS = [
  [7.1, -0.5], [8.6, 0.6], [10.9, -0.3], [13.1, 0.4], [14.9, -0.7], [16.4, 0.7], [18.2, 0], [19.6, -0.4], [21.3, 0.5], [22.9, -0.6], [23.6, 0.2],
] as const;
const SQUEAL_FILES = ['rooms/rat_squeal_1.mp3', 'rooms/rat_squeal_2.mp3', 'rooms/rat_squeal_3.mp3', 'rooms/rat_squeal_4.mp3'] as const;
/** The rats that pass with the camera on their side (s, file). */
const PASSES = [
  [9.3, 'rooms/rats_pass_1.mp3'],
  [12.4, 'rooms/rats_pass_2.mp3'],
  [17.1, 'rooms/rats_pass_1.mp3'],
  [20.6, 'rooms/rats_pass_2.mp3'],
  [22.4, 'rooms/rats_pass_3.mp3'],
] as const;
/** Each step made by hand once the legs have gone (s). */
const HEAVY_STEPS = [25.2, 26.3, 27.5, 28.8, 30.2, 31.7] as const;
const STEP_FILES = ['rooms/run_step_1.mp3', 'rooms/run_step_2.mp3', 'rooms/run_step_3.mp3', 'rooms/run_step_4.mp3'] as const;
/** Its wet blows on the walls (s, pan). */
const SLAPS = [[26.6, 0], [29.2, -0.5], [30.9, 0.5], [31.9, -0.3], [33.2, 0.2]] as const;
const SLAP_FILES = ['rooms/wet_slap_1.mp3', 'rooms/wet_slap_2.mp3', 'rooms/wet_slap_3.mp3', 'rooms/wet_slap_4.mp3'] as const;
/** Real silences (s from, s to): only the room's air under them. */
const SILENCES = [[LEGS_GO + 0.5, LEGS_GO + 1.2], [32.5, 33.3]] as const;

interface Rat {
  x: number;
  y: number;
  start: number;
  every: number;
  pace: number;
  size: number;
  seed: number;
  linger: number;
  lean: number;
}

/** A canvas as a color map repeating every (w, h) of meters of UV. */
function canvasMap(width: number, height: number, tileU: number, tileV: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!, width, height);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(1 / tileU, 1 / tileV);
  t.anisotropy = 4;
  return t;
}

/**
 * Everything under `proto`, repeated `copies` times along -Z, one mesh per look of material: a whole corridor for
 * the draws of one stretch of it.
 */
function repeatAlongZ(proto: Object3D, copies: number, firstZ: number, into: Object3D): void {
  proto.updateMatrixWorld(true);
  const sets = new Map<string, { material: Material; order: number; parts: BufferGeometry[] }>();
  proto.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as MeshStandardMaterial;
    const key = [m.type, m.color?.getHex(), m.roughness, m.metalness, m.map?.uuid, m.emissive?.getHex(), m.emissiveMap?.uuid, m.transparent, m.side].join('/');
    let set = sets.get(key);
    if (!set) {
      set = { material: m, order: mesh.renderOrder, parts: [] };
      sets.set(key, set);
    }
    const placed = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    for (let k = 0; k < copies; k++) set.parts.push(placed.clone().translate(0, 0, firstZ - k * LAP));
  });
  for (const set of sets.values()) {
    const mesh = new Mesh(mergeGeometries(set.parts)!, set.material);
    mesh.renderOrder = set.order;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    into.add(mesh);
  }
}

/** The dark above the wainscot: damp from the ceiling, and what it wore in the paper, coming through here every evening. */
function drawWallGrime(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(404);
  const lineAcross = (y: number, amp: number, k: number, phase: number) => {
    c.beginPath();
    for (let x = 0; x <= w; x += 12) {
      const py = y + Math.sin((x / w) * Math.PI * 2 * k + phase) * amp;
      if (x === 0) c.moveTo(x, py);
      else c.lineTo(x, py);
    }
    c.stroke();
  };
  for (let i = 0; i < 130; i++) {
    const x = 16 + random() * (w - 32);
    const length = (0.15 + random() ** 2 * 0.62) * h;
    const g = c.createLinearGradient(0, 0, 0, length);
    g.addColorStop(0, `rgba(6,7,5,${0.12 + random() * 0.24})`);
    g.addColorStop(1, 'rgba(6,7,5,0)');
    c.fillStyle = g;
    c.fillRect(x, 0, 2 + random() ** 3 * 26, length);
  }
  // where the damp stopped, above the rail
  const tide = (1 - 1.05 / H) * h;
  const band = c.createLinearGradient(0, tide - 90, 0, tide + 6);
  band.addColorStop(0, 'rgba(10,10,6,0)');
  band.addColorStop(1, 'rgba(10,10,6,0.3)');
  c.fillStyle = band;
  c.fillRect(0, tide - 90, w, 96);
  for (let i = 0; i < 18; i++) {
    c.strokeStyle = i % 3 ? `rgba(196,196,172,${0.03 + random() * 0.05})` : `rgba(0,0,0,${0.1 + random() * 0.16})`;
    c.lineWidth = 1 + random() ** 2 * 3.5;
    lineAcross(20 + random() ** 2 * (tide - 40), 2 + random() * 7, 1 + Math.floor(random() * 3), random() * 6.28);
  }
  // the seams of the paper, and strips of it come away from the top
  for (let i = 0; i < 7; i++) {
    const x = w * (0.06 + i * 0.125 + random() * 0.05);
    c.strokeStyle = 'rgba(0,0,0,0.42)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x + (random() - 0.5) * 5, tide);
    c.stroke();
    const top = 6 + random() * 40;
    const long = 30 + random() * 95;
    const wide = 5 + random() * 11;
    c.fillStyle = `rgba(30,26,20,${0.55 + random() * 0.3})`;
    c.beginPath();
    c.moveTo(x, top);
    c.lineTo(x + wide, top + long * 0.15);
    c.lineTo(x + wide * 0.4, top + long);
    c.lineTo(x, top + long * 0.8);
    c.closePath();
    c.fill();
  }
  c.fillStyle = 'rgba(3,4,3,0.5)';
  for (let i = 0; i < 700; i++) c.fillRect(random() * w, random() ** 3 * h * 0.26, 1 + random() * 2.5, 1 + random() * 2.5);
}

/** The floor's grime along the corridor: a worn way down the middle, what dragged along both sides. */
function drawFloorGrime(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(77);
  for (let i = 0; i < 190; i++) {
    const x = random() * w;
    const y = 30 + random() * (h - 60);
    const r = 14 + random() * 64;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(4,3,2,${0.1 + random() * 0.3})`);
    g.addColorStop(1, 'rgba(4,3,2,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // long wet marks where it comes through, seamless along the corridor
  for (const side of [0.11, 0.89]) {
    for (let i = 0; i < 16; i++) {
      c.strokeStyle = `rgba(0,0,0,${0.08 + random() * 0.2})`;
      c.lineWidth = 2 + random() * 9;
      const x = (side + (random() - 0.5) * 0.14) * w;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    }
  }
}

/** The shade of the lamp on the wall beside it: the light it lets out only above and below. Black, its alpha is where the shade stands in the way. */
function drawLampOnWall(c: CanvasRenderingContext2D, w: number, h: number): void {
  const image = c.createImageData(w, h);
  const wide = 3.2;
  const lampY = 1.1;
  const off = 0.3;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const dz = (px / w - 0.5) * wide;
      const dy = (1 - py / h) * H - lampY;
      const slope = dy / Math.hypot(dz, off);
      const open = dy > 0 ? smootherstep(range(0.72, 1.15, slope)) : smootherstep(range(0.36, 0.62, -slope));
      const alpha = (1 - open) * 0.66 * (1 - smootherstep(range(0.9, 1.6, Math.abs(dz))));
      image.data[(py * w + px) * 4 + 3] = alpha * 255;
    }
  }
  c.putImageData(image, 0, 0);
}

/** Pale skin in long stretched lines (U around the sleeve, V along it). */
function drawSkin(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(9);
  c.fillStyle = '#d2bfae';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 240; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = 18 + random() * 120;
    const tone = random();
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    const rgb = tone < 0.4 ? '128,92,76' : tone < 0.7 ? '92,108,88' : tone < 0.85 ? '110,70,88' : '255,246,226';
    g.addColorStop(0, `rgba(${rgb},${0.05 + random() * 0.1})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 260; i++) {
    c.strokeStyle = i % 4 ? `rgba(76,50,44,${0.05 + random() * 0.14})` : `rgba(248,240,226,${0.08 + random() * 0.12})`;
    c.lineWidth = 0.7 + random() * 2.6;
    const x = random() * w;
    c.beginPath();
    c.moveTo(x, 0);
    c.bezierCurveTo(x + (random() - 0.5) * 34, h * 0.33, x + (random() - 0.5) * 34, h * 0.66, x, h);
    c.stroke();
  }
  for (let i = 0; i < 420; i++) {
    c.strokeStyle = `rgba(58,38,34,${0.08 + random() * 0.2})`;
    c.lineWidth = 0.7 + random() * 2;
    const x = random() * w;
    const y = random() * h;
    const half = 20 + random() * 70;
    c.beginPath();
    c.moveTo(x - half, y);
    c.quadraticCurveTo(x, y + (random() - 0.5) * 12, x + half, y + (random() - 0.5) * 8);
    c.stroke();
  }
  for (let i = 0; i < 30; i++) {
    c.strokeStyle = `rgba(52,58,104,${0.2 + random() * 0.24})`;
    c.lineWidth = 1 + random() * 2.4;
    let x = random() * w;
    let y = 0;
    c.beginPath();
    c.moveTo(x, y);
    while (y < h) {
      x += (random() - 0.5) * 40;
      y += 16 + random() * 44;
      c.lineTo(x, y);
    }
    c.stroke();
  }
}

/**
 * The face that comes down the corridor, laid flat from the front (x + 0.5, y of the scan). Pale, mottled, and where
 * you scratched it out of the photograph, gone: the sockets and the mouth are nail marks with nothing behind them.
 */
function drawFace(c: CanvasRenderingContext2D, s: number): void {
  const random = randomFrom(71);
  const X = (x: number) => (x + 0.5) * s;
  const Y = (y: number) => (1 - y) * s;
  const soft = (x: number, y: number, rx: number, ry: number, rgb: string, a: number, turn = 0) => {
    c.save();
    c.translate(X(x), Y(y));
    c.rotate(turn);
    c.scale(rx * s, ry * s);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, 1, 0, Math.PI * 2);
    c.fill();
    c.restore();
  };
  c.fillStyle = '#c0b6a5';
  c.fillRect(0, 0, s, s);
  for (let i = 0; i < 300; i++) {
    const tone = random();
    soft(random() - 0.5, random(), 0.015 + random() * 0.08, 0.015 + random() * 0.08, tone < 0.45 ? '134,98,78' : tone < 0.75 ? '98,112,94' : '255,246,226', 0.05 + random() * 0.07);
  }
  c.fillStyle = 'rgba(62,42,32,0.14)';
  for (let i = 0; i < 7000; i++) c.fillRect(random() * s, random() * s, 1 + random(), 1 + random());
  // where a face holds its own shadow
  const hollowed = (side: number, ex: number) => {
    soft(ex, 0.59, 0.105, 0.05, '24,18,16', 0.62);
    soft(ex + side * 0.095, 0.53, 0.05, 0.075, '30,24,22', 0.42);
    soft(ex * 0.42, 0.455, 0.032, 0.085, '36,26,22', 0.46);
    soft(ex + side * 0.02, 0.33, 0.07, 0.085, '40,30,26', 0.36);
    soft(side * 0.335, 0.43, 0.13, 0.44, '18,16,16', 0.78);
    soft(side * 0.03, 0.352, 0.016, 0.011, '6,4,3', 0.96);
    soft(side * 0.07, 0.3, 0.012, 0.09, '50,34,28', 0.3, side * 0.35);
  };
  hollowed(1, SCAN.eyeX);
  hollowed(-1, -SCAN.eyeX);
  soft(0.01, 0.345, 0.05, 0.02, '30,20,16', 0.55);
  soft(SCAN.mouthX, 0.203, 0.075, 0.022, '26,18,14', 0.55);
  soft(0, 0.74, 0.3, 0.06, '50,40,34', 0.18);
  // fine lines: the forehead, the corners of the eyes
  c.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    c.strokeStyle = `rgba(52,36,28,${0.14 + random() * 0.2})`;
    c.lineWidth = (1 + random() * 2) * (s / 1024);
    const y = 0.655 + random() * 0.14;
    const half = 0.09 + random() * 0.17;
    const x = (random() - 0.5) * 0.08;
    c.beginPath();
    c.moveTo(X(x - half), Y(y + 0.006));
    c.quadraticCurveTo(X(x), Y(y - 0.012), X(x + half), Y(y + 0.006));
    c.stroke();
  }
  for (const side of [1, -1]) {
    for (let i = 0; i < 9; i++) {
      c.strokeStyle = `rgba(48,34,28,${0.14 + random() * 0.18})`;
      c.lineWidth = (0.8 + random() * 1.4) * (s / 1024);
      const a = -0.5 + i * 0.13;
      c.beginPath();
      c.moveTo(X(side * 0.235), Y(0.52 + a * 0.03));
      c.lineTo(X(side * (0.29 + random() * 0.05)), Y(0.52 + a * 0.13));
      c.stroke();
    }
  }
  // the nail
  const ragged = (cx: number, cy: number, rx: number, ry: number, turn: number) => {
    c.save();
    c.translate(X(cx), Y(cy));
    c.rotate(turn);
    c.beginPath();
    for (let a = 0; a < Math.PI * 2; a += 0.13) {
      const r = 0.82 + random() * 0.32;
      c.lineTo(Math.cos(a) * rx * r * s, Math.sin(a) * ry * r * s);
    }
    c.closePath();
    c.fillStyle = '#000000';
    c.fill();
    c.restore();
  };
  const gouge = (cx: number, cy: number, rx: number, ry: number, turn: number, strokes: number) => {
    c.save();
    c.translate(X(cx), Y(cy));
    c.rotate(turn);
    for (let i = 0; i < strokes; i++) {
      const across = (random() + random() - 1) * ry * 1.4 * s;
      const a = -rx * (0.6 + random() * 0.7) * s;
      const b = rx * (0.6 + random() * 0.7) * s;
      c.strokeStyle = random() < 0.8 ? `rgba(4,2,2,${0.5 + random() * 0.5})` : `rgba(238,230,214,${0.3 + random() * 0.45})`;
      c.lineWidth = (0.8 + random() ** 3 * 5) * (s / 1024);
      c.beginPath();
      c.moveTo(a, across);
      c.quadraticCurveTo((a + b) / 2, across + (random() - 0.5) * 10, b, across + (random() - 0.5) * 12);
      c.stroke();
    }
    c.restore();
  };
  for (const side of [1, -1]) {
    const ex = side * SCAN.eyeX;
    soft(ex, SCAN.eyeY, 0.16, 0.125, '58,42,58', 0.34);
    soft(ex, SCAN.eyeY, 0.118, 0.094, '0,0,0', 0.9, side * 0.16);
    gouge(ex, SCAN.eyeY, 0.085, 0.066, side * 0.5 - 0.35, 34);
    gouge(ex, SCAN.eyeY, 0.075, 0.056, -side * 0.9 + 0.2, 20);
    ragged(ex, SCAN.eyeY, 0.076, 0.06, side * 0.16);
  }
  soft(SCAN.mouthX, 0.252, 0.125, 0.075, '0,0,0', 0.75);
  gouge(SCAN.mouthX, 0.25, 0.09, 0.034, 0.02, 32);
  ragged(SCAN.mouthX, 0.25, 0.084, 0.038, 0.03);
  soft(0, 0.83, 0.4, 0.17, '26,20,18', 0.72);
  soft(0, 0.1, 0.38, 0.13, '20,16,14', 0.62);
  // the skin pulled into each hole
  const puckered = (cx: number, cy: number, rx: number, ry: number, lines: number) => {
    for (let i = 0; i < lines; i++) {
      const a = random() * Math.PI * 2;
      const from = 1 + random() * 0.25;
      const to = from + 0.45 + random() * 0.8;
      c.strokeStyle = `rgba(36,24,22,${0.12 + random() * 0.24})`;
      c.lineWidth = (0.8 + random() * 1.5) * (s / 1024);
      c.beginPath();
      c.moveTo(X(cx + Math.cos(a) * rx * from), Y(cy + Math.sin(a) * ry * from));
      c.lineTo(X(cx + Math.cos(a) * rx * to), Y(cy + Math.sin(a) * ry * to));
      c.stroke();
    }
  };
  puckered(SCAN.eyeX, SCAN.eyeY, 0.078, 0.062, 46);
  puckered(-SCAN.eyeX, SCAN.eyeY, 0.078, 0.062, 46);
  puckered(SCAN.mouthX, 0.25, 0.088, 0.042, 36);
  for (let i = 0; i < 34; i++) {
    c.strokeStyle = `rgba(62,74,104,${0.1 + random() * 0.14})`;
    c.lineWidth = (0.8 + random() * 1.6) * (s / 1024);
    let x = (random() - 0.5) * 0.56;
    let y = 0.62 + random() * 0.24;
    c.beginPath();
    c.moveTo(X(x), Y(y));
    for (let k = 0; k < 7; k++) {
      x += (random() - 0.5) * 0.05;
      y -= 0.012 + random() * 0.03;
      c.lineTo(X(x), Y(y));
    }
    c.stroke();
  }
  // three long scores, down to the paper
  for (const [x0, y0, x1, y1] of [[-0.3, 0.6, 0.26, 0.47], [-0.22, 0.42, 0.31, 0.57], [-0.12, 0.66, 0.12, 0.38]] as const) {
    c.strokeStyle = 'rgba(3,2,2,0.75)';
    c.lineWidth = 2.4 * (s / 1024);
    c.beginPath();
    c.moveTo(X(x0), Y(y0));
    c.lineTo(X(x1), Y(y1));
    c.stroke();
    c.strokeStyle = 'rgba(240,233,218,0.55)';
    c.lineWidth = 0.8 * (s / 1024);
    c.beginPath();
    c.moveTo(X(x0), Y(y0) + 3 * (s / 1024));
    c.lineTo(X(x1), Y(y1) + 3 * (s / 1024));
    c.stroke();
  }
}

/** The scan is a whole head with a skull in it: only the triangles of the shell that holds the tip of the nose. */
function outerShell(position: ArrayLike<number>, index: ArrayLike<number>): number[] {
  const parent = Array.from({ length: position.length / 3 }, (_, i) => i);
  const find = (a: number) => {
    let x = a;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let t = 0; t < index.length; t += 3) {
    parent[find(index[t])] = find(index[t + 1]);
    parent[find(index[t + 2])] = find(index[t + 1]);
  }
  let nose = 0;
  for (let i = 0; i < parent.length; i++) if (position[i * 3 + 2] > position[nose * 3 + 2]) nose = i;
  const shell = find(nose);
  const out: number[] = [];
  for (let t = 0; t < index.length; t += 3) if (find(index[t]) === shell) out.push(index[t], index[t + 1], index[t + 2]);
  return out;
}

/** The scan has the terraces of its slices: a few passes of averaging each point with its neighbours wear them away. */
function relaxed(position: Float32Array, index: readonly number[], passes: number, amount: number): Float32Array {
  const count = position.length / 3;
  let from = position;
  for (let pass = 0; pass < passes; pass++) {
    const sum = new Float32Array(count * 3);
    const n = new Uint16Array(count);
    for (let t = 0; t < index.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = index[t + e];
        const b = index[t + ((e + 1) % 3)];
        for (let k = 0; k < 3; k++) {
          sum[a * 3 + k] += from[b * 3 + k];
          sum[b * 3 + k] += from[a * 3 + k];
        }
        n[a]++;
        n[b]++;
      }
    }
    const to = from.slice();
    for (let i = 0; i < count; i++) {
      if (n[i]) for (let k = 0; k < 3; k++) to[i * 3 + k] = lerp(from[i * 3 + k], sum[i * 3 + k] / n[i], amount);
    }
    from = to;
  }
  return from;
}

/** How much a point of the scan sinks into the head (scan units): the sockets, the mouth, the gaunt places. */
function sink(x: number, y: number, z: number): number {
  if (z < 0.08) return 0;
  const front = Math.min(1, (z - 0.08) / 0.08);
  const pit = (cx: number, cy: number, rx: number, ry: number, depth: number) => depth * Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2));
  let d = pit(SCAN.mouthX, 0.25, 0.1, 0.045, 0.07);
  for (const side of [1, -1]) {
    const ex = side * SCAN.eyeX;
    d += pit(ex, SCAN.eyeY, 0.075, 0.058, 0.13);
    d -= 0.014 * Math.exp(-(((Math.hypot((x - ex) / 0.075, (y - SCAN.eyeY) / 0.058) - 1.32) / 0.3) ** 2));
    d += pit(side * 0.165, 0.345, 0.055, 0.075, 0.016);
    d += pit(side * 0.24, 0.625, 0.05, 0.06, 0.016);
  }
  return d * front;
}

/** How far the sleeve's edge runs ahead here (m): long fingers along the walls and the ceiling, longest over the ceiling. */
function tongue(u: number): number {
  const over = Math.sin(u * Math.PI) ** 2;
  const fingers = (0.5 + 0.5 * Math.sin(u * 48 + 1.7 * Math.sin(u * 11))) ** 3;
  return 0.35 * over + FINGER * fingers * (0.6 + 0.4 * over);
}

/** A shared sleeve-and-head material: skin that moves along itself toward you, and a jaw that lets go. */
function skinShader(flow: { value: number }, jaw: { value: number }): (shader: WebGLProgramParametersWithUniforms) => void {
  return (shader) => {
    shader.uniforms.uFlow = flow;
    shader.uniforms.uJaw = jaw;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFlow;\nattribute float aJaw;\nuniform float uFlow;\nuniform float uJaw;')
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        float flowPhase = aFlow.y * 3.6 + uFlow * 2.5 + sin(aFlow.x * 1.1) * 0.7;
        objectNormal.z += cos(flowPhase) * aFlow.z * 6.0;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed += normalize(normal) * sin(flowPhase) * aFlow.z;
        transformed.z -= aFlow.w * (0.3 * sin(aFlow.x * 0.9 + uFlow * 0.7) + 0.22 * sin(aFlow.x * 2.3 - uFlow * 1.1));
        transformed.y -= aJaw * uJaw;`,
      );
    shader.fragmentShader = shader.fragmentShader.replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb *= smoothstep(0.01, 0.06, sampledDiffuseColor.g);\n#include <tonemapping_fragment>');
  };
}

/** Attributes the skin shader needs, on a geometry that does not move. */
function noFlow(geometry: BufferGeometry, count: number): void {
  geometry.setAttribute('aFlow', new BufferAttribute(new Float32Array(count * 4), 4));
}

/**
 * It is the neck: a tube of pale skin as wide as the corridor, on its way along the ceiling and walls like water
 * through a pipe, with a face at the front of it from which someone has scratched the eyes and the mouth. You run in
 * a loop: the same table, the same clock, the same man with no head, again. The rats know before you do.
 */
export default class Chase extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x0c1a18, density: 0.042 },
    env: 'bathroom',
    envIntensity: 0.14,
    sky: 0,
    grade: { exposure: 1.3, saturation: 0.76, warmth: 0.02, tint: -0.02, flare: 0.002 },
  };
  film = { bloom: 0.85, bloomFrom: 0.62, grain: 0.42, scratches: 0.14, flicker: 0.03, weave: 0.0006, aberration: 0.003, barrel: 0.05, ghost: 0.05 };
  focus = 6;
  aperture = 1.8;
  drift = 0;
  control: RoomControl = { look: true, scroll: true, hurry: HURRY_RUN };

  private readonly run: Float32Array;
  private readonly gapWay: GlideTrack;
  private readonly scroll = new Group();
  private readonly lamps: DreamLight[] = [];
  private readonly lampFace: MeshStandardMaterial;
  private readonly spiral: MeshStandardMaterial;
  private readonly men: Crowd;
  private lastLap = -1;
  private readonly clocks: { value: number }[] = [];

  private readonly it = new Group();
  private readonly head: Mesh;
  private readonly sleeve: Mesh;
  private readonly flow = { value: 0 };
  private readonly jaw = { value: 0 };
  private readonly faceSpot: SpotSpec;
  private readonly glowCold: DreamLight;

  private readonly ratsNear: PropCrowd;
  private readonly ratsFar: InstancedMesh;
  private readonly rats: Rat[] = [];
  private readonly ratM = new Matrix4();
  private readonly ratP = new Vector3();
  private readonly ratS = new Vector3();
  private readonly ratQ = new Quaternion();
  private readonly ratE = new Euler(0, 0, 0, 'YXZ');

  private readonly ending = new Group();
  private readonly door1: Object3D;
  private readonly leaf1: Object3D;
  private readonly leaf2: Object3D;
  private readonly doorGlow: Mesh;
  private readonly leak: MeshBasicMaterial;
  private readonly leakPool: Mesh;
  /** The road at the moment the door is passed, and how much of it the doors stand from the lap they share. */
  private readonly roadStop: number;
  private readonly doorShift: number;

  private readonly blackOut: MeshBasicMaterial;
  private readonly afterImage: MeshBasicMaterial;

  private effort = 0;
  private effortTime = 0;
  private credit = 0;
  private decided = false;
  private escaped = false;
  private gapDecided = 0;
  private shot = false;
  private nextMix = 0;

  /** The eye in this frame, written in update and added in pose. */
  private bobX = 0;
  private bobY = 0;
  private bobRoll = 0;
  private bobPitch = 0;
  private bobFov = 0;
  private keyYaw = 0;

  private feet: RoomVoice | null = null;
  private feetHard: RoomVoice | null = null;
  private breath: RoomVoice | null = null;
  private runBreath: RoomVoice | null = null;
  private heart: RoomVoice | null = null;
  private wet: RoomVoice | null = null;
  private claws: RoomVoice | null = null;
  private kneaded: RoomVoice | null = null;
  private drone: RoomVoice | null = null;

  constructor(ctx: RoomContext) {
    super(ctx);
    this.keys = this.wayOfTheEye();
    const calm = REDUCED_MOTION ? 0.45 : 1;
    this.warp = [
      { at: 0, bendUp: 0.0005, bendAside: 0.0026 * calm, twist: 0, wave: 0 },
      { at: 7 / 42, bendUp: 0.001, bendAside: -0.003 * calm, twist: 0.002 * calm, wave: 0 },
      { at: 15 / 42, bendUp: 0.0005, bendAside: 0.0028 * calm, twist: -0.002 * calm, wave: 0 },
      { at: LEGS_GO / 42, bendUp: 0.001, bendAside: -0.0022 * calm, twist: 0.002 * calm, wave: 0 },
      { at: WATER_FULL / 42, bendUp: 0.0075 * calm, bendAside: 0, twist: 0.007 * calm, wave: 0.05 * calm },
      { at: 36 / 42, bendUp: 0.0095 * calm, bendAside: 0.001 * calm, twist: 0.009 * calm, wave: 0.07 * calm },
      { at: 1, bendUp: 0.0095 * calm, bendAside: 0.001 * calm, twist: 0.009 * calm, wave: 0.07 * calm },
    ];

    this.run = new Float32Array(Math.ceil(this.seconds / RUN_STEP) + 2);
    let run = 0;
    for (let i = 0; i < this.run.length; i++) {
      this.run[i] = run;
      run += lerp(PACE, PACE_WATER, smootherstep(range(LEGS_GO, WATER_FULL, i * RUN_STEP))) * RUN_STEP;
    }
    this.gapWay = new GlideTrack(GAP_WAY.map((k) => k[0]), GAP_WAY.map((k) => k[1]));
    const n = Math.round((this.ran(DECIDE) + START_PHASE + DOOR_AHEAD + DOOR_Z) / LAP);
    this.doorShift = LAP * n;
    this.roadStop = DOOR_PAST - DOOR_Z + this.doorShift;

    const b = this.build;
    const walls = b.damask(WALLPAPER, LAP / 13);
    this.root.add(this.scroll);
    const corridor = b.box(W, LONG, H, { walls, floor: b.checker(0.5), ceiling: b.ceiling(0.6) }, this.scroll);
    corridor.position.z = FIRST_Z;

    // grime on the paper and on the floor, repeating with the lap
    const grime = canvasMap(2048, 512, LAP, H, drawWallGrime);
    const grimeOn = new MeshStandardMaterial({ map: grime, transparent: true, depthWrite: false, roughness: 0.8, metalness: 0 });
    for (const side of [1, -1]) {
      const m = this.kit.wall(LONG, H, grimeOn, 0, H / 2);
      m.position.set(side * (W / 2 - 0.004), H / 2, FIRST_Z - LONG / 2);
      m.rotation.y = (-side * Math.PI) / 2;
      m.renderOrder = 1;
      this.scroll.add(m);
    }
    const floorDirt = canvasMap(256, 1024, W, LAP, drawFloorGrime);
    floorDirt.offset.x = 0.5;
    const floorOn = this.kit.floor(-W / 2, W / 2, FIRST_Z - LONG, FIRST_Z, 0.003, new MeshStandardMaterial({ map: floorDirt, transparent: true, depthWrite: false, roughness: 0.5, metalness: 0 }));
    floorOn.renderOrder = 1;
    this.scroll.add(floorOn);

    // one lap, built once and repeated: every lap is this very one
    const lap = new Group();
    const wainscotRun = (x: number, z0: number, z1: number, facing: Facing) => {
      const count = Math.max(1, Math.round((z0 - z1) / 2.4));
      const piece = (z0 - z1) / count;
      for (let i = 0; i < count; i++) b.wainscot(x, z0 - piece * (i + 0.5), piece, facing, lap);
    };
    const leftDoor = SIDE_DOORS[0].z;
    const rightDoor = SIDE_DOORS[1].z;
    wainscotRun(-W / 2, 0, leftDoor + 0.56, '+x');
    wainscotRun(-W / 2, leftDoor - 0.56, -LAP, '+x');
    wainscotRun(W / 2, 0, rightDoor + 0.56, '-x');
    wainscotRun(W / 2, rightDoor - 0.56, -LAP, '-x');
    for (const d of SIDE_DOORS) b.door((d.side * W) / 2, d.z, d.side > 0 ? '-x' : '+x', lap, { open: d.open, beyond: 0x020302 });

    const table = b.lampTable(TABLE_X, TABLE_Z, lap, -Math.PI / 2);
    this.lampFace = table.shade;
    this.spiral = b.clock(TABLE_X - 0.03, table.top + 0.018, TABLE_Z + 0.28, lap, CLOCK_SIZE).spiral;
    const contact = b.contactShadow(TABLE_X, TABLE_Z, 0.8, lap, 0.72);
    for (const [x, z, r] of [[MAN_X, MAN_Z, 0.6], [-W / 2 + 0.16, RADIATOR_Z, 0.75], [-W / 2 + 0.36, CHAIR_Z, 0.5]] as const) {
      b.contactShadow(x, z, r, lap, 0.72).material = contact.material as Material;
    }
    const lampWall = canvasMap(256, 220, 1, 1, drawLampOnWall);
    const lampOnWall = new Mesh(new PlaneGeometry(3.2, H, 8, 8), new MeshBasicMaterial({ map: lampWall, transparent: true, depthWrite: false }));
    lampOnWall.position.set(W / 2 - 0.006, H / 2, TABLE_Z);
    lampOnWall.rotation.y = -Math.PI / 2;
    lampOnWall.renderOrder = 2;
    lap.add(lampOnWall);
    const tubeBox = new Mesh(new BoxGeometry(1.25, 0.05, 0.32), new MeshStandardMaterial({ color: 0x1d1f1a, roughness: 0.7, metalness: 0.2 }));
    const tubeGlass = new Mesh(new BoxGeometry(1.15, 0.012, 0.24), new MeshStandardMaterial({ color: 0x3c4038, roughness: 0.5, metalness: 0 }));
    tubeBox.position.set(0, H - 0.026, TUBE_Z);
    tubeGlass.position.set(0, H - 0.056, TUBE_Z);
    lap.add(tubeBox, tubeGlass);
    const last = this.album.pictures[this.album.pictures.length - 1];
    if (last) {
      const print = b.print(this.album.texture(last));
      print.position.set(W / 2 - 0.012, PRINT_Y, TABLE_Z - 0.2);
      print.rotation.y = -Math.PI / 2;
      print.rotation.z = -0.03;
      lap.add(print);
    }
    repeatAlongZ(lap, COPIES, FIRST_Z, this.scroll);

    const radiators = this.kit.props('radiator', COPIES);
    const chairs = this.kit.props('chair_ladder', COPIES);
    for (let k = 0; k < COPIES; k++) {
      const z = FIRST_Z - k * LAP;
      radiators.set(k, -W / 2 + 0.15, 0, z + RADIATOR_Z, Math.PI / 2);
      chairs.set(k, -W / 2 + 0.36, 0, z + CHAIR_Z, Math.PI / 2 + 0.28);
    }
    radiators.commit();
    chairs.commit();
    this.scroll.add(radiators.root, chairs.root);
    this.men = b.headless(COPIES, { tint: 0x6f7a82 });
    this.scroll.add(this.men.root);

    for (const k of LIT) {
      const z = FIRST_Z - k * LAP;
      this.lamps.push(this.light([table.lightAt[0], table.lightAt[1], table.lightAt[2] + z], PALETTE.warm, LAMP_LIGHT, LAMP_REACH));
      b.glow(table.lightAt[0], table.lightAt[1], table.lightAt[2] + z, 1.3, PALETTE.warm, 0.5, this.scroll);
      const dust = b.motes(70, { x: [-W / 2, W / 2], y: [0.2, H], z: [-LAP, 0] }, this.scroll, { seed: 33 });
      dust.points.position.z = z;
      this.clocks.push(dust.time);
    }

    // what comes behind
    this.root.add(this.it);
    const smear = this.kit.surface('flesh_smeared', 1.1);
    const compile = skinShader(this.flow, this.jaw);
    const skin = new MeshStandardMaterial({
      map: canvasMap(1024, 1024, SLEEVE.tile, SLEEVE.tile, drawSkin),
      normalMap: smear.normalMap,
      normalScale: new Vector2(1, 1),
      roughnessMap: smear.roughnessMap,
      roughness: 0.62,
      metalness: 0,
      vertexColors: true,
      side: DoubleSide,
    });
    skin.onBeforeCompile = compile;
    skin.customProgramCacheKey = () => 'chase-skin';
    this.sleeve = new Mesh(this.growSleeve(), skin);
    this.sleeve.frustumCulled = false;
    this.it.add(this.sleeve);

    const faceNormal = smear.normalMap!.clone();
    faceNormal.repeat.setScalar(5);
    faceNormal.needsUpdate = true;
    const faceRough = smear.roughnessMap!.clone();
    faceRough.repeat.setScalar(5);
    faceRough.needsUpdate = true;
    const faceMap = canvasMap(2048, 2048, 1, 1, (c, w) => drawFace(c, w));
    const face = new MeshStandardMaterial({
      map: faceMap,
      normalMap: faceNormal,
      normalScale: new Vector2(1.2, 1.2),
      roughnessMap: faceRough,
      roughness: 0.6,
      metalness: 0,
      vertexColors: true,
      side: DoubleSide,
    });
    face.onBeforeCompile = compile;
    face.customProgramCacheKey = () => 'chase-skin';
    this.head = new Mesh(this.growHead(), face);
    this.head.position.y = EYE_LEVEL;
    this.head.frustumCulled = false;
    this.it.add(this.head);
    const plug = new Mesh(new PlaneGeometry(W + 1, H + 1), new MeshBasicMaterial({ color: 0x000000, side: DoubleSide }));
    plug.position.set(0, H / 2, SLEEVE.back + 0.3);
    plug.frustumCulled = false;
    this.it.add(plug);
    this.faceSpot = this.spot([FACE_FROM.x, FACE_FROM.y, 30], [0, 1.6, 34], 0xdfe2d4, FACE_SPOT, 33, 0.8);
    this.spots = [null, this.faceSpot, null];
    this.glowCold = this.light([0, 1.5, 32], PALETTE.sick, FACE_GLOW, FACE_GLOW_REACH);

    // rats, the real one near and a shape of one far off
    this.ratsNear = this.kit.props('rat', RATS_NEAR);
    const ratMesh = this.ratsNear.root.children[0] as Mesh;
    ratMesh.material = (ratMesh.material as MeshStandardMaterial).clone();
    (ratMesh.material as MeshStandardMaterial).color.setScalar(RAT_SHADE);
    this.root.add(this.ratsNear.root);
    const body = new SphereGeometry(1, 7, 5);
    body.scale(0.0155, 0.015, 0.05);
    body.translate(0, 0.016, 0.012);
    const tail = new ConeGeometry(0.004, 0.07, 4);
    tail.rotateX(-Math.PI / 2);
    tail.translate(0, 0.008, -0.07);
    this.ratsFar = new InstancedMesh(mergeGeometries([body, tail])!, ratMesh.material as MeshStandardMaterial, RATS - RATS_NEAR + 8);
    this.ratsFar.frustumCulled = false;
    this.root.add(this.ratsFar);
    this.layRats();

    // the end of the corridor, for those who reach it, and the same door again
    this.root.add(this.ending);
    this.ending.visible = false;
    const partition = (z: number) => {
      for (const side of [1, -1]) {
        const piece = this.kit.block(W / 2 - 0.56, H, DOOR_T, walls);
        piece.position.set(side * (0.56 + (W / 2 - 0.56) / 2), H / 2, z);
        this.ending.add(piece);
        b.wainscot(side * (0.56 + (W / 2 - 0.56) / 2), z + DOOR_T / 2 + 0.002, W / 2 - 0.56, '+z', this.ending);
        b.wainscot(side * (0.56 + (W / 2 - 0.56) / 2), z - DOOR_T / 2 - 0.002, W / 2 - 0.56, '-z', this.ending);
      }
      const lintel = this.kit.block(1.12, H - 2.16, DOOR_T, walls);
      lintel.position.set(0, (H + 2.16) / 2, z);
      this.ending.add(lintel);
    };
    partition(DOOR_Z);
    partition(DOOR2_Z);
    const door1 = b.door(0, DOOR_Z - DOOR_T / 2, '-z', this.ending, { color: 0x201812 });
    door1.beyond.visible = false;
    door1.leaf.rotation.y = LEAF_OPEN;
    this.door1 = door1.root;
    this.leaf1 = door1.leaf;
    const frame1 = b.door(0, DOOR_Z + DOOR_T / 2, '+z', this.ending, { color: 0x201812 });
    frame1.beyond.visible = false;
    frame1.leaf.visible = false;
    const door2 = b.door(0, DOOR2_Z + DOOR_T / 2, '+z', this.ending, { color: 0x201812 });
    door2.beyond.visible = false;
    this.leaf2 = door2.leaf;
    this.doorGlow = b.glow(0, 1.15, DOOR_Z + 0.1, 2.4, PALETTE.warm, 0.7, this.ending);
    this.leak = new MeshBasicMaterial({ color: PALETTE.sick, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
    const under = new Mesh(new PlaneGeometry(0.9, 0.028), this.leak);
    under.position.set(0, 0.016, DOOR_Z - DOOR_T / 2 - 0.05);
    under.rotation.y = Math.PI;
    under.frustumCulled = false;
    this.ending.add(under);
    const crack = new Mesh(new PlaneGeometry(0.014, 2.02), this.leak);
    crack.position.set(-0.458, 1.04, DOOR_Z - DOOR_T / 2 - 0.05);
    crack.rotation.y = Math.PI;
    crack.frustumCulled = false;
    this.ending.add(crack);
    this.leakPool = b.glow(0, 0.04, DOOR_Z - DOOR_T / 2 - 0.55, 1, PALETTE.sick, 0.55, this.ending);

    // when it has you: black on the glass, and far away in it the clock
    this.blackOut = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    const blackQuad = new Mesh(new PlaneGeometry(2, 2), this.blackOut);
    blackQuad.position.z = -0.2;
    blackQuad.frustumCulled = false;
    blackQuad.renderOrder = 20;
    const after = canvasMap(128, 128, 1, 1, (c, w, h) => {
      c.fillStyle = '#000000';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#ffffff';
      c.lineWidth = 4;
      c.lineCap = 'round';
      c.beginPath();
      for (let a = 0; a < Math.PI * 7; a += 0.08) {
        const r = (a / (Math.PI * 7)) * 56;
        c.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
      }
      c.stroke();
    });
    this.afterImage = new MeshBasicMaterial({ map: after, color: 0xff7a1e, transparent: true, opacity: 0, blending: AdditiveBlending, depthTest: false, depthWrite: false });
    const spiralAfter = new Mesh(new PlaneGeometry(0.016, 0.016), this.afterImage);
    spiralAfter.position.z = -0.19;
    spiralAfter.frustumCulled = false;
    spiralAfter.renderOrder = 21;
    this.lens.add(blackQuad, spiralAfter);

    this.writeBeats();
  }

  /** The eye's way: it runs on the spot and the corridor comes, so only where it looks is kept here. */
  private wayOfTheEye(): RoomKey[] {
    const way: readonly (readonly [number, number, number, number, number, number])[] = [
      [0, 0, -2, -3, 0, 64],
      [4.5, 0.03, 2, -2, 0, 64],
      [8.4, -0.04, 1, -4, 0, 64],
      [9.7, -0.04, 0, -18, -1, 62],
      [11.2, 0, 0, -5, 0, 64],
      [15 - TURN, 0.03, 3, -2, 1, 64],
      [15, 0.06, 166, -3, 4, 58],
      [15.9, 0.06, 171, -2, 4, 56],
      [15.9 + TURN, 0, 2, -3, 0, 64],
      [23.4, 0, -2, -2, 0, 64],
      [24.7, 0, -1, -5, 0, 60],
      [28 - TURN, 0, 1, -7, 0, 50],
      [28, -0.06, -164, -2, -5, 46],
      [28.9, -0.06, -170, -1, -5, 44],
      [28.9 + TURN_LATE, 0, -2, -1, 0, 48],
      [32.9 - TURN_LATE - 0.1, 0, 0, 1, 0, 46],
      [32.9, 0, 176, -4, 0, 54],
      [38.5, 0, 180, -2, 0, 54],
      [39.7, 0, 0, 0, 0, 46],
      [42, 0, 0, 0, 0, 46],
    ];
    return way.map(([s, x, yaw, pitch, roll, fov]) => ({ t: s / this.seconds, at: [x, EYE_Y, 0] as const, yaw, pitch, roll, fov }));
  }

  /** Meters run by second `s` at the piece's own pace. */
  private ran(s: number): number {
    const x = clamp(s, 0, this.seconds) / RUN_STEP;
    const i = Math.min(Math.floor(x), this.run.length - 2);
    return lerp(this.run[i], this.run[i + 1], x - i);
  }

  /** The sleeve: the corridor's own section, skinned, closing around the face. */
  private growSleeve(): BufferGeometry {
    const nu = SLEEVE.around;
    const nv = SLEEVE.along;
    const count = (nu + 1) * (nv + 1);
    const position = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const color = new Float32Array(count * 3);
    const flow = new Float32Array(count * 4);
    const index: number[] = [];
    const total = SLEEVE.lip + SLEEVE.back;
    const around = H + W * 2;
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      for (let i = 0; i <= nu; i++) {
        const u = i / nu;
        const k = j * (nu + 1) + i;
        const a = lerp(SLEEVE.from, SLEEVE.to, u);
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const inward = smootherstep(range(0.5, 1, v));
        const rim = 1 + 0.05 * Math.sin(u * 9.3 + 1) + 0.035 * Math.sin(u * 23.7 + 4);
        let x = lerp((W / 2) * Math.sign(c) * Math.abs(c) ** (1 / 3), SLEEVE.rx * rim * c, inward);
        let y = lerp(H / 2 + (H / 2) * Math.sign(sn) * Math.abs(sn) ** (1 / 3), SLEEVE.cy + SLEEVE.ry * rim * sn, inward);
        const turn = u * SLEEVE.folds + 1.4 * Math.sin(u * 19 + 1.2) + 0.6 * Math.sin(u * 47);
        const lobe = Math.abs(Math.sin(Math.PI * turn)) ** 0.55;
        const closes = smootherstep(range(0.12, 0.85, v));
        const ring = 0.5 + 0.5 * Math.sin(v * 64 + 2.4 * Math.sin(u * 13));
        const ringFine = 0.5 + 0.5 * Math.sin(v * 130 + 3.1 * Math.sin(u * 29 + 1));
        const near = smootherstep(range(0.02, 0.7, v));
        const edge = Math.min(1, Math.min(u, 1 - u) * 18);
        const thick = 0.02 + 0.1 * smootherstep(range(0, 0.07, v)) + 0.05 * smootherstep(range(0.05, 0.45, v));
        const inset = (thick + lerp(0.055, 0.12, closes) * lobe * (1 - 0.75 * smootherstep(range(0.86, 1, v))) + (0.04 * ring + 0.018 * ringFine) * lerp(0.5, 1, near)) * edge;
        const len = Math.hypot(x, H / 2 - y) || 1;
        x -= (x / len) * inset;
        y += ((H / 2 - y) / len) * inset;
        const z = -SLEEVE.lip + total * v - tongue(u) * (1 - smootherstep(range(0, 0.6, v)));
        position[k * 3] = x;
        position[k * 3 + 1] = y;
        position[k * 3 + 2] = z;
        uv[k * 2] = u * around;
        uv[k * 2 + 1] = v * total;
        const mottle = 0.84 + 0.16 * Math.sin(u * 37.7 + v * 23.1) * Math.sin(u * 91 + v * 61);
        const value = SLEEVE_SHADE * mottle * lerp(0.4, 1, lobe) * lerp(1, lerp(0.6, 1, ring) * lerp(0.82, 1, ringFine), lerp(0.55, 1, near)) * lerp(0.55, 1, smootherstep(range(0, 0.05, v))) * lerp(1, 0.4, smootherstep(range(0.84, 1, v)));
        color[k * 3] = value;
        color[k * 3 + 1] = value * 0.97;
        color[k * 3 + 2] = value * 0.94;
        flow[k * 4] = u * around;
        flow[k * 4 + 1] = v * total;
        flow[k * 4 + 2] = 0.075 * smootherstep(range(0.03, 0.22, v)) * (1 - smootherstep(range(0.86, 1, v))) * edge;
        flow[k * 4 + 3] = 1 - smootherstep(range(0, 0.42, v));
        if (i < nu && j < nv) {
          const a0 = k;
          const b0 = k + 1;
          const c0 = k + nu + 1;
          const d0 = k + nu + 2;
          index.push(a0, c0, b0, b0, c0, d0);
        }
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(position, 3));
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    g.setAttribute('color', new BufferAttribute(color, 3));
    g.setAttribute('aFlow', new BufferAttribute(flow, 4));
    g.setAttribute('aJaw', new BufferAttribute(new Float32Array(count), 1));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  }

  /** The real head from the scan, sunk where it was scratched, its face toward -Z, about the height of its eyes. */
  private growHead(): BufferGeometry {
    const scan = this.kit.model('mri_head').scene;
    scan.updateMatrixWorld(true);
    let found: Mesh | null = null;
    scan.traverse((o) => {
      if ((o as Mesh).isMesh) found = o as Mesh;
    });
    const source = (found as unknown as Mesh).geometry.clone().applyMatrix4((found as unknown as Mesh).matrixWorld);
    const p = source.getAttribute('position');
    const count = p.count;
    const raw = new Float32Array(count * 3);
    let noseZ = -Infinity;
    for (let i = 0; i < count; i++) {
      raw[i * 3] = p.getX(i);
      raw[i * 3 + 1] = p.getY(i);
      raw[i * 3 + 2] = p.getZ(i);
      noseZ = Math.max(noseZ, raw[i * 3 + 2]);
    }
    const index = outerShell(raw, source.getIndex()!.array);
    const smooth = relaxed(raw, index, HEAD_RELAX, 0.55);
    const position = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const color = new Float32Array(count * 3);
    const jaw = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const x = smooth[i * 3];
      const y = smooth[i * 3 + 1];
      const z = smooth[i * 3 + 2];
      position[i * 3] = -x * HEAD;
      position[i * 3 + 1] = (y - SCAN.eyeY) * HEAD;
      position[i * 3 + 2] = (noseZ - z + sink(x, y, z)) * HEAD;
      uv[i * 2] = x + 0.5;
      uv[i * 2 + 1] = y;
      const side = lerp(0.35, 1, smootherstep(range(-0.05, 0.18, z)));
      color[i * 3] = side;
      color[i * 3 + 1] = side;
      color[i * 3 + 2] = side;
      jaw[i] = smootherstep(range(SCAN.mouthY + 0.004, SCAN.mouthY - 0.05, y)) * (1 - smootherstep(range(0.14, 0.24, Math.abs(x - SCAN.mouthX)))) * smootherstep(range(0.02, 0.1, z));
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(position, 3));
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    g.setAttribute('color', new BufferAttribute(color, 3));
    g.setAttribute('aJaw', new BufferAttribute(jaw, 1));
    noFlow(g, count);
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  }

  /** Where every rat runs, once: a pure function of time decides the rest. */
  private layRats(): void {
    const random = randomFrom(2024);
    for (let i = 0; i < RATS; i++) {
      const kind = random();
      const side = random() < 0.5 ? -1 : 1;
      const faster = lerp(RAT_FASTER[0], RAT_FASTER[1], random()) * (REDUCED_MOTION ? 0.6 : 1);
      const every = (RAT_FROM_Z - RAT_GONE_Z) / faster;
      const feet = kind > 0.55 && kind <= 0.93;
      const rail = kind > 0.93;
      this.rats.push({
        x: feet ? (random() - 0.5) * 1.5 : rail ? side * (W / 2 - 0.03) : side * (W / 2 - 0.07 - random() ** 2 * 0.5),
        y: rail ? 1.05 : 0,
        start: feet ? 7.4 + random() * 3.2 : RATS_START + random() ** 0.85 * Math.min(every, 11),
        every,
        pace: PACE + faster,
        size: lerp(RAT_SIZE[0], RAT_SIZE[1], random()) * (rail ? 0.72 : 1),
        seed: random() * 6.283,
        linger: random() * 2,
        lean: (random() - 0.5) * 2 * RAT_LEAN,
      });
    }
  }

  private writeBeats(): void {
    const s = this.sound;
    this.beat(0, () => {
      this.feet = s.bed('rooms/run_feet.mp3', { gain: 0.3, reverb: 0.15 });
      this.feetHard = s.bed('rooms/run_feet_hard.mp3', { gain: 0, reverb: 0.15 });
      this.breath = s.bed('rooms/breath_fast.mp3', { gain: 0.2 });
      this.runBreath = s.bed('rooms/run_breath.mp3', { gain: 0 });
      this.heart = s.bed('rooms/heart_fast.mp3', { gain: 0.12, lowpass: 800 });
      this.wet = s.bed('rooms/wet_weight.mp3', { gain: 0.05, reverb: 0.25 });
      this.claws = s.bed('rooms/rats_claws.mp3', { gain: 0 });
      this.kneaded = s.bed('rooms/meat_kneaded.mp3', { gain: 0, lowpass: 5000 });
      this.drone = s.bed('rooms/dream_drone_hollow.mp3', { gain: 0.14 });
    });
    this.beat(1, () => this.hint({ tr: 'KAYDIR: KOŞ', en: 'SCROLL: RUN' }));
    this.beat(2, () => this.say({ tr: 'Koş.', en: 'Run.' }, 2.2));
    this.beat(RATS_START + 0.2, () => s.play('rooms/rats_pass_3.mp3', { gain: 0.5 }));
    PASSES.forEach(([at, file], i) => this.beat(at, () => s.play(file, { gain: 0.45, pan: i % 2 ? 0.2 : -0.2 })));
    SQUEALS.forEach(([at, pan], i) => this.beat(at, () => s.play(SQUEAL_FILES[i % 4], { gain: 0.3, pan, reverb: 0.2 })));
    this.beat(14.7, () => s.play('rooms/breath_catch_2.mp3', { gain: 0.3 }));
    this.beat(LEGS_GO - 0.2, () => this.hint(null));
    this.beat(LEGS_GO, () => this.say({ tr: 'Bacakların söz dinlemiyor.', en: 'Your legs will not obey you.' }, 4.2));
    this.beat(26, () => s.play('rooms/rat_chirp_far_1.mp3', { gain: 0.2, reverb: 0.3, pan: 0.3 }));
    this.beat(27.4, () => s.play('rooms/rat_chirp_far_3.mp3', { gain: 0.16, reverb: 0.3, pan: -0.3 }));
    this.beat(27.7, () => s.play('rooms/breath_catch_4.mp3', { gain: 0.3 }));
    HEAVY_STEPS.forEach((at, i) =>
      this.beat(at, () => {
        if (!(this.escaped && at > DECIDE)) s.play(STEP_FILES[i % 4], { gain: 0.42, rate: 0.82, reverb: 0.15, pan: i % 2 ? 0.14 : -0.14 });
      }),
    );
    SLAPS.forEach(([at, pan], i) => this.beat(at, () => s.play(SLAP_FILES[i % 4], { gain: 0.35, pan, reverb: 0.2 })));
    this.beat(30, () => s.play('rooms/door_pass_1.mp3', { gain: 0.4 }));
    this.beat(30.4, () => s.play('rooms/belt_slither_1.mp3', { gain: 0.35, pan: -0.7 }));
    this.beat(31.2, () => s.play('rooms/belt_slither_3.mp3', { gain: 0.35, pan: 0.7 }));
    this.beat(32.1, () => s.play('rooms/belt_slither_2.mp3', { gain: 0.35, pan: -0.2 }));
    this.beat(33.3, () => {
      if (this.escaped) return;
      s.play('rooms/heart_beat.mp3', { gain: 0.45 });
      s.bed('rooms/breath_open_mouth.mp3', { gain: 0.22, fade: 1 });
    });
    this.beat(34.2, () => {
      if (!this.escaped) s.play('rooms/mouth_wet_1.mp3', { gain: 0.3 });
    });
    this.beat(34.9, () => {
      if (!this.escaped) s.play('rooms/mouth_wet_3.mp3', { gain: 0.3 });
    });
    this.beat(37, () => {
      if (!this.escaped) s.play('rooms/heart_beat.mp3', { gain: 0.35 });
    });
    this.beat(38.3, () => {
      if (!this.escaped) s.play('rooms/heart_beat.mp3', { gain: 0.3 });
    });

    // the door, for those who ran
    this.beat(SLAM, () => {
      if (this.escaped) s.play('rooms/door_slam.mp3', { gain: 0.7, reverb: 0.3 });
    });
    this.beat(BLOWS[1], () => {
      if (this.escaped) s.play('rooms/door_thud.mp3', { gain: 0.6, reverb: 0.2, lowpass: 1000 });
    });
    this.beat(BLOWS[2], () => {
      if (this.escaped) s.play('rooms/door_thud.mp3', { gain: 0.6, reverb: 0.2, lowpass: 1000 });
    });
    this.beat(BLOWS[3], () => {
      if (this.escaped) s.play('rooms/door_knock_heavy.mp3', { gain: 0.7 });
    });
    this.beat(37.3, () => {
      if (this.escaped) s.play('rooms/breath_out.mp3', { gain: 0.25 });
    });
    this.beat(DOOR_OPENS, () => {
      if (this.escaped) s.play('rooms/door_creak_slow.mp3', { gain: 0.42, reverb: 0.4 });
    });
    this.beat(DOOR_OPENS + 0.5, () => {
      if (this.escaped) s.play('rooms/breath_catch_1.mp3', { gain: 0.3 });
    });
    this.beat(CUT, () => s.stopAll(0.08));
  }

  override pose(t: number, out: RoomPose): RoomPose {
    super.pose(t, out);
    this.keyYaw = out.yaw;
    out.position.x += this.bobX;
    out.position.y += this.bobY;
    out.roll += this.bobRoll;
    out.pitch += this.bobPitch;
    out.fov += this.bobFov;
    return out;
  }

  private mix(s: number, legs: number, water: number, gap: number): void {
    const going = s < LEGS_GO ? 1 : 1 - range(LEGS_GO, LEGS_GO + 1.1, s);
    const found = this.escaped && s < SLAM ? smootherstep(range(DECIDE, DECIDE + 0.8, s)) : 0;
    const over = this.escaped ? s >= SLAM : s >= SWALLOWED;
    let hush = 1;
    for (const w of SILENCES) hush *= 1 - Math.min(range(w[0] - 0.25, w[0], s), 1 - range(w[1], w[1] + 0.25, s));
    const open = over ? 0 : hush;
    const run = Math.max(going, found);
    const hard = Math.max(clamp(legs * 1.4, 0, 1), found);
    this.feet?.gain(0.3 * run * (1 - hard * 0.75) * open, 0.25);
    this.feet?.rate(lerp(1, 1.14, legs) * lerp(0.55, 1, run), 0.25);
    this.feetHard?.gain(0.3 * run * hard * open, 0.25);
    this.breath?.gain(0.2 * (1 - range(11, 14, s)) * open, 0.4);
    this.runBreath?.gain(lerp(0, 0.2, range(11, 14, s)) * lerp(0.45, 1, going) * open, 0.4);
    this.runBreath?.rate(lerp(0.78, 1, going), 0.4);
    this.heart?.gain((0.1 + 0.2 * (1 - clamp(gap / 30, 0, 1))) * open, 0.4);
    this.heart?.rate(lerp(1, 0.82, water), 0.4);
    this.wet?.gain(lerp(0.05, 0.42, (1 - clamp(gap / 34, 0, 1)) ** 1.7) * open, 0.4);
    this.claws?.gain(0.3 * range(RATS_START, RATS_START + 2, s) * (1 - range(LEGS_GO, LEGS_GO + 2.5, s)) * open, 0.4);
    this.kneaded?.gain(0.2 * (1 - range(3, 13, gap)) * open, 0.5);
    this.drone?.gain(0.14 * (over ? 0.6 : hush), 0.4);
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const legs = frame.input.legs;
    const dt = frame.paused ? 0 : frame.dt;
    const water = smootherstep(range(LEGS_GO, WATER_FULL, s));
    this.control.hurry = lerp(HURRY_RUN, HURRY_WATER, water);
    this.control.scroll = s < LOCK;
    this.flow.value = frame.time;
    for (const c of this.clocks) c.value = frame.time;

    // what they earned with their legs
    if (s < DECIDE) {
      this.decided = false;
      this.escaped = false;
      this.effort += legs * dt;
      this.effortTime += dt;
    }
    const earning = s < LEGS_GO ? legs * CREDIT_RATE - CREDIT_LOSS : -CREDIT_LOSS * 1.6;
    this.credit = clamp(this.credit + earning * dt, 0, CREDIT_MAX);
    let gap = this.gapWay.at(s) + this.credit * (1 - smootherstep(range(27, 33, s)));
    if (s >= DECIDE && !this.decided) {
      this.decided = true;
      this.escaped = this.effort >= ESCAPE_EFFORT * Math.max(this.effortTime, 1);
      this.gapDecided = gap;
      this.lastLap = -1;
    }
    if (this.escaped) gap = lerp(this.gapDecided, ESCAPE_GAP, smootherstep(range(DECIDE, STOP, s)));

    // the corridor comes
    const road = this.roadAt(s);
    const shifted = ((road % LAP) + LAP) % LAP;
    this.scroll.position.z = shifted;
    const lap = Math.floor(road / LAP);
    if (lap !== this.lastLap) this.turnMen(lap);

    // the head
    const stopped = this.escaped ? s >= STOP : false;
    const running = (stopped ? 0 : 1) * lerp(1, 0.7, water) * (1 - smootherstep(range(31.5, 33.2, s)) * (this.escaped ? 0 : 0.85));
    if (!REDUCED_MOTION) {
      const step = (Math.PI * road) / STEP;
      const sin = Math.sin(step);
      const amp = lerp(BOB, BOB_HARD, legs) * running;
      this.bobY = amp * (Math.abs(sin) - 0.64);
      this.bobX = SWAY * Math.sin(step) * running;
      this.bobRoll = ROLL * Math.sin(step + 0.6) * running;
      this.bobPitch = NOD * Math.cos(2 * step) * running;
    }
    this.bobFov = REDUCED_MOTION ? 0 : legs * 5 * (1 - water);

    this.writeRats(s);
    this.writeLamps(shifted, gap, frame.heartbeat);
    this.writeIt(s, gap);
    this.writeEnding(s, road);

    // the lens: on what it is looking at
    const lookedBack = 0.5 - 0.5 * Math.cos(this.keyYaw + frame.input.gazeYaw);
    const late = range(29, 31, s);
    this.focus = lerp(lerp(6, 3, late), clamp(gap + 0.3, 0.8, 30), lookedBack);
    this.aperture = (this.escaped ? s >= STOP : s >= SWALLOWED - 0.4) ? 0 : lerp(lerp(1.8, 0.5, late), 1, lookedBack);
    this.film.ghost = lerp(0.05, 0.42, water);
    this.film.aberration = lerp(0.003, 0.012, water);
    this.film.barrel = lerp(0.05, 0.09, water);
    this.fear = (this.escaped ? s >= SLAM + 2 : false) ? 0.25 : lerp(0.42, 0.85, 1 - clamp(gap / 34, 0, 1));

    // the picture and how it ends
    const shotAt = this.escaped ? SHOT_ESCAPED : SHOT_CAUGHT;
    if (!this.shot && s >= shotAt) {
      const seen = this.escaped ? !this.unseen(frame, 0, EYE_LEVEL, DOOR2_Z + road - this.doorShift, 0) : !this.unseen(frame, 0, EYE_LEVEL, gap + 0.2, 0);
      if (seen || s >= shotAt + 0.6) {
        this.shot = true;
        this.shutter();
      }
    }
    const inTheDark = this.escaped ? 0 : smootherstep(range(SWALLOWED - 0.16, SWALLOWED, s));
    this.blackOut.opacity = inTheDark;
    this.afterImage.opacity = this.escaped ? 0 : smootherstep(range(SWALLOWED, SWALLOWED + 0.5, s)) * (1 - smootherstep(range(CUT - 1.4, CUT - 0.1, s))) * 0.8;
    this.black = s >= CUT ? 1 : Math.max(0, 1 - s / 0.3);

    if (frame.time >= this.nextMix) {
      this.nextMix = frame.time + 0.12;
      this.mix(s, legs, water, gap);
    }
  }

  private roadAt(s: number): number {
    if (!this.escaped) return this.ran(s) + START_PHASE;
    const x = range(DECIDE, STOP, s);
    return lerp(this.ran(DECIDE) + START_PHASE, this.roadStop, x * x * (3 - 2 * x));
  }

  /** Each man is turned the way his place in the road says: those far ahead when the legs went have already turned to you. */
  private turnMen(lap: number): void {
    this.lastLap = lap;
    const road24 = this.ran(LEGS_GO) + START_PHASE;
    for (let k = 0; k < COPIES; k++) {
      const x = LAP * (lap + k - FIRST_Z / LAP) - MAN_Z;
      const inTheWay = this.escaped && x > this.doorShift - DOOR_Z && x < this.doorShift - DOOR2_Z;
      this.men.set(k, MAN_X, 0, FIRST_Z - k * LAP + MAN_Z, x > road24 + 24 ? -0.1 : Math.PI / 2, inTheWay ? 0.0001 : 1);
    }
    this.men.commit();
  }

  private writeRats(s: number): void {
    const now = this.ran(s);
    let near = 0;
    let far = 0;
    for (const r of this.rats) {
      if (s < r.start || RATS_END - r.linger < r.start) continue;
      const lastRun = Math.floor((RATS_END - r.linger - r.start) / r.every);
      const born = r.start + Math.min(lastRun, Math.floor((s - r.start) / r.every)) * r.every;
      const age = s - born;
      const z = RAT_FROM_Z - r.pace * age + now - this.ran(born);
      if (z < RAT_GONE_Z) continue;
      const gallop = age * 15 + r.seed;
      const wiggle = age * 6.3 + r.seed * 3;
      this.ratP.set(r.x + Math.sin(wiggle) * 0.04, r.y + Math.abs(Math.sin(gallop)) * 0.02 * r.size, z);
      this.ratQ.setFromEuler(this.ratE.set(Math.sin(gallop) * 0.2, Math.PI + r.lean + Math.cos(wiggle) * 0.3, 0));
      this.ratS.set(r.size, r.size * RAT_FLAT, r.size * (1 + Math.sin(gallop + 1) * 0.12));
      this.ratM.compose(this.ratP, this.ratQ, this.ratS);
      if (z > RAT_NEAR_Z && near < RATS_NEAR) this.ratsNear.setMatrix(near++, this.ratM);
      else if (far < this.ratsFar.instanceMatrix.count) this.ratsFar.setMatrixAt(far++, this.ratM);
    }
    this.ratsNear.drawn = near;
    this.ratsNear.commit();
    this.ratsFar.count = far;
    this.ratsFar.instanceMatrix.needsUpdate = true;
  }

  private writeLamps(shifted: number, gap: number, heartbeat: number): void {
    const eaten = this.escaped ? 999 : gap;
    for (let i = 0; i < LIT.length; i++) {
      const z = FIRST_Z - LIT[i] * LAP + TABLE_Z + shifted;
      const l = this.lamps[i];
      l.position.z = this.origin.z + z + 0.08;
      const here = smootherstep(range(LAMP_FAR[0], LAMP_FAR[1], z)) * (1 - smootherstep(range(LAMP_BEHIND[0], LAMP_BEHIND[1], z))) * (1 - smootherstep(range(eaten - 3, eaten - 1.2, z))) * lerp(1, LAMP_UNDER_SKIN, smootherstep(range(eaten - SLEEVE.lip - 2.5, eaten - SLEEVE.lip - 0.3, z)));
      l.intensity = LAMP_LIGHT * here;
    }
    this.lampFace.emissiveIntensity = 1.8;
    this.spiral.emissiveIntensity = 3.5 + 1.5 * heartbeat;
  }

  private writeIt(s: number, gap: number): void {
    const hide = this.escaped && s >= SLAM + 0.3;
    if (hide) {
      // it has gone round, as it does: from now on it waits behind the same door
      const z = DOOR2_Z + DOOR_T / 2 + this.roadAt(s) - this.doorShift - 0.85;
      this.it.position.set(-0.13, 0, z);
      this.it.rotation.y = Math.PI;
      this.sleeve.visible = false;
      this.head.rotation.z = 0;
      this.jaw.value = 0;
      this.glowCold.intensity = 0;
      const p = this.faceSpot.position as [number, number, number];
      const t = this.faceSpot.target as [number, number, number];
      p[0] = this.origin.x + 0.5;
      p[1] = this.origin.y + 2.25;
      p[2] = this.origin.z + z + 0.74;
      t[0] = this.origin.x - 0.1;
      t[1] = this.origin.y + 1.5;
      t[2] = this.origin.z + z - 0.1;
      this.faceSpot.intensity = 5;
      return;
    }
    const swallow = this.escaped ? 0 : smootherstep(range(SHOT_CAUGHT + 0.05, SWALLOWED, s));
    this.it.position.set(swallow * SOCKET_X, 0, gap);
    this.it.rotation.y = 0;
    this.sleeve.visible = true;
    const doorAt = this.escaped ? DOOR_Z + this.roadAt(s) - this.doorShift : -999;
    this.sleeve.scale.z = this.escaped ? clamp((gap - doorAt - 0.25) / SLEEVE.lip, 0.02, 1) : 1;
    this.head.rotation.z = lerp(0.16, -0.1, smootherstep(range(10, 28, s))) * (1 - smootherstep(range(31, 35, s)));
    this.jaw.value = this.escaped ? 0 : smootherstep(range(33.6, SHOT_CAUGHT, s)) * 0.36;
    this.glowCold.position.set(this.origin.x, this.origin.y + 1.7, this.origin.z + gap - lerp(4.8, 2.2, range(3, 12, gap)));
    this.glowCold.intensity = FACE_GLOW;
    const p = this.faceSpot.position as [number, number, number];
    const t = this.faceSpot.target as [number, number, number];
    p[0] = this.origin.x + FACE_FROM.x;
    p[1] = this.origin.y + FACE_FROM.y;
    p[2] = this.origin.z + gap - FACE_FROM.ahead;
    t[0] = this.origin.x + swallow * SOCKET_X;
    t[1] = this.origin.y + 1.6;
    t[2] = this.origin.z + gap + 0.2;
    this.faceSpot.intensity = FACE_SPOT * lerp(0.6, 1, range(2, 6, gap));
  }

  private writeEnding(s: number, road: number): void {
    const shown = s > 27.2;
    this.ending.visible = shown;
    if (!shown) return;
    this.ending.position.z = road - this.doorShift;
    this.doorGlow.visible = DOOR_Z + road - this.doorShift < -5;
    const closing = this.escaped ? range(SLAM - 0.2, SLAM, s) : 0;
    let knock = 0;
    if (this.escaped) {
      for (const t of BLOWS) {
        const d = s - t;
        if (d >= 0 && d < 0.55) knock = Math.max(knock, Math.exp(-d * 9));
      }
    }
    const leaking = this.escaped ? smootherstep(range(SLAM, SLAM + 0.25, s)) * (1 - smootherstep(range(LEAK_ENDS[0], LEAK_ENDS[1], s))) * (0.7 + 0.3 * knock) : 0;
    this.leak.opacity = leaking;
    this.leakPool.visible = leaking > 0.01;
    this.leakPool.scale.set(1.5 * leaking, 1.5 * leaking, 1);
    this.leaf1.rotation.y = LEAF_OPEN * (1 - closing * closing * closing) + 0.016 * knock;
    this.door1.position.z = DOOR_Z - DOOR_T / 2 + 0.012 * knock;
    if (!REDUCED_MOTION && knock > 0) this.bobY += knock * 0.012;
    this.leaf2.rotation.y = this.escaped ? LEAF2_OPEN * smootherstep(range(DOOR_OPENS, DOOR_OPENS + 1.7, s)) : 0;
  }
}
