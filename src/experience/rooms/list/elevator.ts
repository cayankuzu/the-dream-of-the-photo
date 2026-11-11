import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  FrontSide,
  HalfFloatType,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Path,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Shape,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  WebGLRenderTarget,
  type Bone,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYERS, REDUCED_MOTION, renderConfig } from '../../../config/experience.config';
import type { SpotSpec } from '../../../config/nightmare.config';
import { meterUVs } from '../../dream/DreamKit';
import { randomFrom, type Crowd, type FigureSpec, type HeroFigure } from '../../dream/FigureKit';
import type { DreamLight } from '../../dream/LightPool';
import { clamp, lerp, range, smootherstep, wobble } from '../../math';
import { dateNow } from '../FourthWall';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey, RoomPose } from '../Room';
import { Room } from '../Room';
import { PALETTE } from '../RoomKit';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['tube_light', 'lamp_bulkhead', 'bell_service', 'air_vent', 'dining_table', 'chair_ladder'],
  materials: ['steel_scuffed', 'metal_plate_dark', 'rust_streaked', 'wood_dark_paint', 'tile_checker', 'plaster_damaged', 'plaster_mould'],
  sounds: [
    'rooms/fluorescent_hum_close.mp3',
    'rooms/lift_machine_room.mp3',
    'rooms/lift_doors_close.mp3',
    'rooms/lift_tune_loop.mp3',
    'rooms/lift_ding.mp3',
    'rooms/lift_motor.mp3',
    'rooms/lift_ride_old.mp3',
    'rooms/lift_relay_1.mp3',
    'rooms/lift_relay_2.mp3',
    'rooms/lift_relay_3.mp3',
    'rooms/lift_jolt.mp3',
    'rooms/light_die.mp3',
    'rooms/lift_bell_dead.mp3',
    'rooms/power_thunk.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/cable_hum.mp3',
    'rooms/relay_chatter.mp3',
    'rooms/breath_calm.mp3',
    'rooms/breath_scared.mp3',
    'rooms/breath_held.mp3',
    'rooms/breath_let_go.mp3',
    'rooms/intercom_on.mp3',
    'rooms/intercom_static.mp3',
    'rooms/intercom_crackle_1.mp3',
    'rooms/intercom_crackle_3.mp3',
    'rooms/intercom_off.mp3',
    'rooms/coat_move.mp3',
    'rooms/steel_creak_2.mp3',
    'rooms/steel_creak_4.mp3',
    'rooms/steel_stress.mp3',
    'rooms/hatch_heavy.mp3',
    'rooms/sheet_metal_pop_2.mp3',
    'rooms/lift_doors_open.mp3',
    'rooms/cable_snap.mp3',
    'rooms/whoosh_fall.mp3',
    'rooms/fall_wind.mp3',
    'rooms/stop_thud.mp3',
  ],
};

/** The car, inside (m): width, depth, height; the doors are in the wall at z = -D. */
const W = 1.7;
const D = 2.4;
const H = 2.2;
/** The door's opening (m) and the frame around it. */
const DOOR_X = 0.18;
const DOOR_W = 0.9;
const DOOR_H = 1.86;
const JAMB = 0.06;
const LEAF_TRAVEL = DOOR_W + 0.12;
/** The porthole in the door: its center (m above the floor) and radius (m). */
const PORT_Y = 1.5;
const PORT_R = 0.21;
/** Height of the eye (m), and how far toward the door the fall draws it (z). */
const EYE = 1.5;
const FALL_Z = REDUCED_MOTION ? -0.72 : -1.1;
/** Panelling (m): the kick plate, the rail, the top of the steel, the width of a bay. */
const KICK = 0.16;
const RAIL = 0.95;
const TOP = 2.04;
const BAY = 0.58;
/** The ceiling hatch: its center and side (m). */
const HATCH_X = 0.12;
const HATCH_Z = -1.15;
const HATCH_SIZE = 0.64;
/** Where the tube hangs (m). */
const TUBE_X = DOOR_X;
const TUBE_Z = -1.75;
/** The brass fan over the door and its numeral window (m). */
const FAN_Y = DOOR_H + JAMB;
const FAN_R = 0.27;
const NUMERAL_W = 0.22;
const NUMERAL_H = 0.125;
/** What the drum can show (the last ones go by in the fall), top to bottom. */
const NUMERALS = ['5', '4', '3', '2', '1', '0', '-1', '-2', '-3', '-4', '-5', '-6', '-7', '-8', '-9', '-10', '-11', '-12', '-13', '-14', '-15'];
/** The cell it starts wrapping at in the fall, and how many cells it wraps over. */
const FALL_CELL = 8;
const FALL_CELLS = 12;

/** Time (s). */
const DOOR_SHUT = [2, 6.1] as const;
const RIDE = [10, 24] as const;
/** How far it gets: the drum stops halfway between -2 and -3. */
const STOP_FLOOR = 7.5;
/** 0..1 how long each lit floor seems to stay in the porthole. */
const LINGER = 0.62;
/** Height of one storey of the shaft (m). */
const FLOOR_PERIOD = 3.2;
const RED_ON = 25.05;
const BREATH_FROM = 28;
/** One breath (s): three in breath_calm.mp3. */
const BREATH_PERIOD = 2.4;
/** How far each shoulder rises with it (rad). */
const SHOULDER_RISE = 0.13;
const WATCH = [34, 46] as const;
/** Looking at him this long (s) inside this cone (cos of its half angle) makes him move once you look away. */
const WATCH_FOR = 2;
const WATCH_CONE = Math.cos(24 * (Math.PI / 180));
const BLINK_ONE = 40;
const BLINK_TWO = 43;
const NECK_DOWN = [47.2, 48.8] as const;
const HEAD_TURN = [49.45, 51] as const;
const DOOR_OUT = [50, 51.9] as const;
/** The head leaves the slit: when (s) and how far to the side (m). */
const HEAD_ASIDE = [51.45, 52.5] as const;
const ASIDE_X = -0.155;
const FLASH_AT = 52.75;
const FALL_AT = 54;
const CUT_AT = 59;
/** What stands where the eye is, so that the picture of you has someone in it: its z and scale. */
const YOU_Z = -0.62;
const YOU_SCALE = 0.93;
/** Where the picture of you is taken from, and its side (px); the only target here, drawn once. */
const PICTURE_Z = -0.14;
const PICTURE_SIZE = 256;
/** While the door opens the picture is taken again, every this many frames, so that it shows the door opening on it. */
const PICTURE_EVERY = 3;
/** The print on the brick: width (m) and how much light it gives back. */
const PRINT_WIDTH = 0.36;
const PRINT_GAIN = 4;

/** Scale of the room seen through the porthole (it stands close, and from the eye looks far) and where it is (m). */
const SET_SCALE = 0.2;
const SET_Z = -D - 1.7;
const SET_Y = PORT_Y - 1.95 * SET_SCALE;
/** The suit of all of them: multiplies the clothes, and how bleached. */
const SUIT = 0x0f1012;
const SUIT_BLEACH = 0.1;
/** How far his head has bowed toward the corner (rad). */
const HEAD_BOW = 0.2;

/** Intensities: the tube (cd), its spot, the red lamp, what fills the near dark, the flash and its spot. */
const TUBE_POINT = 2.4;
const TUBE_SPOT = 11;
const TUBE_GLOW = 5;
const RED_POINT = 1.7;
const RED_SPOT = 15;
const RED_FILL = 0.22;
const FLASH_POINT = 20;
const FLASH_SPOT = 85;
const FLASH_DECAY = 9;
const FACE_LIGHT = 0.11;
const BRICK_LIGHT = 1.3;
const FALL_LIGHT = 4.5;
/** How the picture shakes (m, rad) at the jolt and in the fall. */
const JOLT_MOVE = REDUCED_MOTION ? 0.004 : 0.03;
const JOLT_ROLL = REDUCED_MOTION ? 0 : 0.03;
const FALL_SHAKE = REDUCED_MOTION ? 0 : 0.008;

/** The moves he makes, each when you have looked and looked away: how far out of the corner (m), how far he has turned (rad). */
const STEPS = [
  { out: 0, turn: 0 },
  { out: 0.15, turn: 0.14 },
  { out: 0.26, turn: 0.38 },
  { out: 0.36, turn: 0.68 },
  { out: 0.5, turn: 1.04 },
] as const;
const CORNER_OUT = 0.25;
const CORNER_HEADING = -2.356;

/** The crowd: the rows (z), how wide the slit is at each (half, m), half a body (m). */
const ROWS = [-1.03, -1.42, -1.82, -2.2];
const SLIT = [0.12, 0.13, 0.17, 0.2];
const BODY = 0.23;
const FAR_LEFT = -0.6;

/** The neck: from the collar of the first one, up through the hatch, over and back down, and to your face (m). */
const NECK_POINTS: readonly (readonly [number, number, number])[] = [
  [-0.17, 1.42, -1.03],
  [-0.17, 1.62, -1.05],
  [-0.12, 1.9, -1.1],
  [-0.02, 2.14, -1.16],
  [0.08, 2.46, -1.2],
  [0.2, 2.56, -1.22],
  [0.3, 2.42, -1.18],
  [0.3, 2.16, -1.12],
  [0.18, 1.9, -1.04],
  [0.02, 1.62, -0.93],
  [-0.04, 1.36, -0.88],
  [0, 1.16, -0.9],
  [0.1, 1.12, -0.94],
  [0.18, 1.24, -0.97],
  [0.18, 1.42, -0.97],
];
/** Height of the middle of the head above its feet, as baked (m), and how far past the neck's end it sits (m). */
const HEAD_CENTER_Y = 1.66;
/** How far the head has bowed once it has turned to you (rad). */
const HEAD_NOD = 0.24;
const HEAD_ON_NECK = 0.085;
/** Where the head is taken off the body (m above the feet): above the collar. */
const HEAD_CUT = 1.535;

/** The picture's lens (deg), and how far the lights of the fall run before they come round again (m). */
const SHOT_CAMERA_FOV = 60;
const STREAK_SPAN = 9;

const UP = new Vector3(0, 1, 0);
const ACROSS = new Vector3(1, 0, 0);
const v1 = new Vector3();
const v2 = new Vector3();
const v3 = new Vector3();
const q1 = new Quaternion();
const q2 = new Quaternion();
const m1 = new Matrix4();
const m2 = new Matrix4();

/** A canvas as a color map repeating every `tile` m of UV. */
function tileMap(size: number, tile: number, draw: (c: CanvasRenderingContext2D, s: number) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.setScalar(1 / tile);
  t.anisotropy = 4;
  return t;
}

/** Years of hands and bags on steel, as a transparent skin: soot at the edges, rust running down, grease, scratches. */
function drawGrime(c: CanvasRenderingContext2D, w: number, h: number, seed: number, floor = false, scratches = 150, darkEnd = 0): void {
  const random = randomFrom(seed);
  const toward = (x0: number, y0: number, x1: number, y1: number, alpha: number) => {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(5,4,3,${alpha})`);
    g.addColorStop(1, 'rgba(5,4,3,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  };
  toward(0, 0, 0, h * 0.13, floor ? 0.8 : 0.62);
  toward(0, h, 0, h * (floor ? 0.87 : 0.58), 0.78);
  toward(0, 0, w * 0.12, 0, 0.7);
  toward(w, 0, w * 0.88, 0, 0.7);
  // the end of the car farthest from the tube has never been really lit
  if (darkEnd !== 0) toward(darkEnd < 0 ? 0 : w, 0, darkEnd < 0 ? w * 0.86 : w * 0.14, 0, 0.95);
  if (!floor) {
    for (let i = 0; i < 52; i++) {
      const x = random() * w;
      const y0 = random() * h * 0.5;
      const len = h * (0.14 + random() * 0.5);
      const width = 1 + random() * random() * 15;
      const a = 0.1 + random() * 0.3;
      const hue = random() < 0.55 ? '44,25,12' : '11,13,11';
      const g = c.createLinearGradient(0, y0, 0, y0 + len);
      g.addColorStop(0, `rgba(${hue},0)`);
      g.addColorStop(0.15, `rgba(${hue},${a})`);
      g.addColorStop(1, `rgba(${hue},0)`);
      c.fillStyle = g;
      c.fillRect(x, y0, width, len);
    }
  }
  for (let i = 0; i < (floor ? 40 : 18); i++) {
    const x = random() * w;
    const y = floor ? random() * h : h * (0.4 + random() * 0.24);
    const r = (floor ? 30 : 14) + random() * 60;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, floor ? `rgba(16,12,8,${0.16 + random() * 0.25})` : `rgba(196,186,156,${0.05 + random() * 0.1})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const scratch = (x: number, y: number, len: number, angle: number, alpha: number, lw: number, ink: string) => {
    c.strokeStyle = `rgba(${ink},${alpha})`;
    c.lineWidth = lw;
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + Math.cos(angle) * len * 0.5 + (random() - 0.5) * 14, y + Math.sin(angle) * len * 0.5 + (random() - 0.5) * 14, x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    c.stroke();
  };
  for (let i = 0; i < scratches; i++) scratch(random() * w, random() * h, 10 + random() * 170, random() * Math.PI, 0.05 + random() * 0.26, 0.6 + random() * 1.2, random() < 0.7 ? '214,208,190' : '10,9,8');
  // something was dragged along here, again and again
  for (let k = 0; k < 7; k++) {
    const y = h * (0.55 + random() * 0.22);
    const x = random() * w * 0.5;
    const len = w * (0.3 + random() * 0.5);
    for (let i = 0; i < 9; i++) scratch(x + random() * 24, y + i * 2.5 + random() * 3, len, 0.01 * (random() - 0.5), 0.05 + random() * 0.2, 0.7, '220,214,198');
  }
}

/** The inside of the door: what hands did trying to get it open, and someone's count. */
function drawLeafMarks(c: CanvasRenderingContext2D, w: number, h: number, portX: number, portY: number, portR: number): void {
  drawGrime(c, w, h, 41, false, 40);
  const random = randomFrom(29);
  c.lineCap = 'round';
  // rust has run down from the ring
  for (let i = 0; i < 12; i++) {
    const x = portX + (random() - 0.5) * portR * 1.5;
    const y0 = portY + portR * (0.85 + random() * 0.2);
    const len = 40 + random() * 190;
    const g = c.createLinearGradient(0, y0, 0, y0 + len);
    g.addColorStop(0, `rgba(58,30,12,${0.25 + random() * 0.35})`);
    g.addColorStop(1, 'rgba(58,30,12,0)');
    c.fillStyle = g;
    c.fillRect(x, y0, 1.5 + random() * 5, len);
  }
  // four nails dragged down the steel, again and again, from the height of the glass
  for (let i = 0; i < 11; i++) {
    const x = w * (0.06 + random() * 0.82);
    const y = h * (0.18 + random() * 0.46);
    const len = 70 + random() * 210;
    const lean = (random() - 0.5) * 30;
    const gap = 9 + random() * 7;
    const a = 0.06 + random() * 0.13;
    for (let k = 0; k < 4; k++) {
      c.strokeStyle = `rgba(218,212,196,${a * (0.6 + random() * 0.5)})`;
      c.lineWidth = 1 + random() * 1.2;
      c.beginPath();
      c.moveTo(x + k * gap, y + (k === 0 || k === 3 ? 8 : 0));
      c.quadraticCurveTo(x + k * gap + lean * 0.5 + random() * 6, y + len * 0.5, x + k * gap + lean, y + len * (0.7 + random() * 0.3));
      c.stroke();
    }
  }
  // someone's count, low on the door, in fives
  c.strokeStyle = 'rgba(222,216,198,0.3)';
  c.lineWidth = 1.4;
  for (let n = 0; n < 7; n++) {
    const x = w * 0.13 + (n % 4) * 56 + random() * 4;
    const y = h * 0.72 + Math.floor(n / 4) * 52 + random() * 4;
    for (let k = 0; k < 4; k++) {
      c.beginPath();
      c.moveTo(x + k * 9, y + random() * 3);
      c.lineTo(x + k * 9 + random() * 2 - 1, y + 32 + random() * 4);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(x - 5, y + 28);
    c.lineTo(x + 33, y + 5);
    c.stroke();
  }
  c.globalCompositeOperation = 'destination-out';
  c.beginPath();
  c.arc(portX, portY, portR * 1.0, 0, Math.PI * 2);
  c.fill();
  c.globalCompositeOperation = 'source-over';
}

/** The numerals on their drum, one under another: amber glass behind a stencil. */
function drawDrum(c: CanvasRenderingContext2D, w: number, cell: number): void {
  c.fillStyle = '#050302';
  c.fillRect(0, 0, w, cell * NUMERALS.length);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `bold ${Math.round(cell * 0.82)}px Georgia, "Times New Roman", serif`;
  NUMERALS.forEach((text, i) => {
    const y = cell * (i + 0.5) + 2;
    c.shadowColor = '#ff8f2a';
    c.shadowBlur = 20;
    c.fillStyle = '#ffc06a';
    c.fillText(text, w / 2, y);
    c.shadowBlur = 0;
    c.fillStyle = '#fff0cc';
    c.fillText(text, w / 2, y);
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(0, cell * i, w, 3);
  });
}

/** The plate of the buttons: worn brass, engraved. */
function drawPanel(c: CanvasRenderingContext2D, w: number, h: number): void {
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#6a5328');
  g.addColorStop(0.5, '#8a6f38');
  g.addColorStop(1, '#4f3c1c');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(20,12,4,0.8)';
  c.lineWidth = 4;
  c.strokeRect(5, 5, w - 10, h - 10);
  const random = randomFrom(7);
  for (let i = 0; i < 120; i++) {
    c.strokeStyle = `rgba(230,214,170,${random() * 0.14})`;
    c.lineWidth = 1;
    const x = random() * w;
    const y = random() * h;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + (random() - 0.5) * 40, y + (random() - 0.5) * 40);
    c.stroke();
  }
  c.fillStyle = 'rgba(16,10,4,0.92)';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = 'bold 34px Georgia, serif';
  ['5', '4', '3', '2', '1', '0', '-1', '-2'].forEach((text, i) => c.fillText(text, w * 0.3, h * (0.09 + i * 0.094)));
  for (const [x, y] of [[0.1, 0.03], [0.9, 0.03], [0.1, 0.97], [0.9, 0.97]]) {
    c.fillStyle = 'rgba(14,9,4,0.9)';
    c.beginPath();
    c.arc(w * x, h * y, 5, 0, Math.PI * 2);
    c.fill();
  }
}

/** The maker's plate, with how many it is meant for. */
function drawCapacity(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#5e4a24';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(16,10,4,0.85)';
  c.lineWidth = 3;
  c.strokeRect(3, 3, w - 6, h - 6);
  c.fillStyle = 'rgba(12,8,3,0.95)';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = 'bold 26px "Courier New", monospace';
  c.fillText('4 KİŞİ / PERSONS', w / 2, h * 0.34);
  c.font = 'bold 20px "Courier New", monospace';
  c.fillText('320 KG', w / 2, h * 0.72);
}

/** The inspection card on the back wall. The date is today's. */
function drawCard(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#b7ae93';
  c.fillRect(0, 0, w, h);
  const g = c.createRadialGradient(w * 0.7, h * 0.3, 10, w * 0.5, h * 0.5, w * 0.8);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(50,34,14,0.55)');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(24,18,12,0.92)';
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  c.font = 'bold 19px "Courier New", monospace';
  c.fillText('SON KONTROL', 16, h * 0.2);
  c.font = '15px "Courier New", monospace';
  c.fillText('LAST INSPECTED', 16, h * 0.37);
  c.font = 'bold 26px "Courier New", monospace';
  c.fillText(dateNow(), 16, h * 0.63);
  c.fillText('18:30', 16, h * 0.86);
}

/** A wall of old brick: dark mortar, every brick its own burn, a century of soot. */
function drawBricks(c: CanvasRenderingContext2D, s: number): void {
  const random = randomFrom(19);
  c.fillStyle = '#19140f';
  c.fillRect(0, 0, s, s);
  const rows = 16;
  const cols = 5;
  const bh = s / rows;
  const bw = s / cols;
  for (let j = 0; j < rows; j++) {
    for (let i = -1; i <= cols; i++) {
      const x = (i + (j % 2) * 0.5) * bw;
      const y = j * bh;
      const tone = random();
      const burn = random() < 0.16 ? 0.45 : 1;
      c.fillStyle = `rgb(${Math.round((74 + tone * 56) * burn)},${Math.round((30 + tone * 22) * burn)},${Math.round((20 + tone * 14) * burn)})`;
      c.fillRect(x + 3 + random() * 2, y + 3 + random() * 2, bw - 7, bh - 6);
      for (let k = 0; k < 18; k++) {
        c.fillStyle = `rgba(${random() < 0.5 ? '0,0,0' : '200,160,120'},${random() * 0.15})`;
        c.fillRect(x + random() * bw, y + random() * bh, 1 + random() * 5, 1 + random() * 3);
      }
    }
  }
  for (let i = 0; i < 18; i++) {
    const x = random() * s;
    const y = random() * s;
    const r = (0.08 + random() * 0.2) * s;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${0.2 + random() * 0.3})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  }
}

/** Wired glass: a grid of wire, and dirt gathered at the rim. */
function drawGlass(c: CanvasRenderingContext2D, s: number): void {
  c.clearRect(0, 0, s, s);
  const g = c.createRadialGradient(s / 2, s / 2, s * 0.26, s / 2, s / 2, s * 0.5);
  g.addColorStop(0, 'rgba(120,140,126,0.05)');
  g.addColorStop(0.7, 'rgba(40,44,34,0.16)');
  g.addColorStop(1, 'rgba(12,12,8,0.75)');
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
  c.strokeStyle = 'rgba(14,14,12,0.34)';
  c.lineWidth = 1.3;
  const step = s / 14;
  for (let i = -14; i <= 28; i++) {
    c.beginPath();
    c.moveTo(i * step, 0);
    c.lineTo(i * step + s, s);
    c.moveTo(i * step + s, 0);
    c.lineTo(i * step, s);
    c.stroke();
  }
}

/** Boxes of one material become one mesh; UVs in meters, each panel shifted so that none repeats its neighbor. */
function box(into: BufferGeometry[], frame: Matrix4, w: number, h: number, d: number, x: number, y: number, z: number, shiftU = 0, shiftV = 0): void {
  const g = meterUVs(new BoxGeometry(w, h, d));
  if (shiftU !== 0 || shiftV !== 0) {
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + shiftU, uv.getY(i) + shiftV);
  }
  g.translate(x, y, z).applyMatrix4(frame);
  into.push(g);
}

/** Boxes and turned parts in one mesh: only boxes come with the second UV set, so the others borrow their first. */
function merged(parts: BufferGeometry[]): BufferGeometry {
  for (const g of parts) if (!g.getAttribute('uv1')) g.setAttribute('uv1', g.getAttribute('uv'));
  return mergeGeometries(parts)!;
}

function rod(into: BufferGeometry[], frame: Matrix4, radius: number, length: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z'): void {
  const g = new CylinderGeometry(radius, radius, length, 12);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  else if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z).applyMatrix4(frame);
  into.push(g);
}

/** How far the car has come (floors): a slow start, and the same dead stop, a little lingering on each floor. */
function floorAt(s: number): number {
  const x = range(RIDE[0], RIDE[1], s);
  const u = (x < 0.12 ? (x * x) / 0.24 : x - 0.06) / 0.94;
  const floors = u * STOP_FLOOR;
  return floors - (LINGER / (2 * Math.PI)) * Math.sin(2 * Math.PI * floors);
}

/** Your own eyelids: shut around `at`, for a moment. */
function blink(s: number, at: number): number {
  const x = s - at;
  if (x < -0.1 || x > 0.45) return 0;
  if (x < 0) return (x + 0.1) / 0.1;
  return x < 0.12 ? 1 : 1 - smootherstep((x - 0.12) / 0.33);
}

/** The tube going: it catches once, and is gone. */
function tubeLevel(s: number): number {
  if (s < RIDE[1]) return 1;
  if (s < RIDE[1] + 0.2) return 0.1;
  if (s < RIDE[1] + 0.55) return 0.72;
  return 0;
}

interface Shoulder {
  bone: Bone;
  base: Quaternion;
  axis: Vector3;
}

/**
 * Being shut in with someone. An old lift of brass and scuffed steel, one tube, a man in the far corner facing
 * the corner too closely. It goes down past a dinner table with one fewer at it each floor, and stops halfway
 * between two floors. The red light; his shoulders keep time with your breath; he moves when you look away. Two
 * blinks and it is full of them, their backs to you. Then his neck comes back down to you and turns. The door
 * opens on a brick wall and a picture of you, from behind, and the flash comes from behind you. The cable goes.
 */
export default class Elevator extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x050706, density: 0.025 },
    env: 'bathroom',
    envIntensity: 0.14,
    sky: 0,
    grade: { exposure: 1.2, saturation: 0.82, warmth: 0, tint: -0.04, flare: 0.002 },
  };
  film = { bloom: 0.6, bloomFrom: 0.85, grain: 0.42, scratches: 0.1, flicker: 0.02, weave: 0.0004, ghost: 0, aberration: 0.0012, barrel: 0.03 };
  focus = 1.9;
  aperture = 2.5;
  drift = 0.3;

  private readonly leaf = new Group();
  private readonly shaft = new Group();
  private readonly corridor = new Group();
  private readonly table = new Group();
  private readonly landing = new Group();
  private readonly lid = new Group();

  private readonly hero: HeroFigure;
  private readonly heroShadow: Mesh;
  private readonly shoulders: Shoulder[] = [];
  private readonly heroHead: Bone;
  private readonly heroHeadBase = new Quaternion();
  private readonly heroHeadAxis = new Vector3();
  private readonly cornerX: number;
  private readonly cornerZ: number;
  private step = 0;
  private watched = 0;
  private due = false;

  private you!: Crowd;
  private father!: Crowd;
  private mother!: Crowd;
  private child!: Crowd;
  private readonly menA: Crowd;
  private readonly menB: Crowd;
  private readonly behind: Crowd;
  private readonly first: Crowd;
  private readonly plug: Mesh;
  private readonly self: Crowd;
  private readonly head: Crowd;
  private phase = -1;

  private readonly curve: CatmullRomCurve3;
  private readonly neckMesh: Mesh;
  private readonly neckSegments: number;
  private readonly neckBack: number;
  private readonly tipShift = { value: new Vector3() };

  private drum!: CanvasTexture;
  private numeral!: MeshBasicMaterial;
  private lit!: Mesh;
  private intercomLamp!: MeshBasicMaterial;
  private readonly tubeLamp: MeshStandardMaterial;
  private readonly bulb: MeshBasicMaterial;
  private readonly tubeHalo: ShaderMaterial;
  private readonly redHalo: ShaderMaterial;
  private portHalo!: ShaderMaterial;
  private readonly moteColor: Color;

  private readonly tubeLight: DreamLight;
  private readonly tubeLight2: DreamLight;
  private corridorLight!: DreamLight;
  private hallLamp!: DreamLight;
  private tableLamp!: DreamLight;
  private readonly redLight: DreamLight;
  private readonly fillLight: DreamLight;
  private readonly faceLight: DreamLight;
  private readonly flashLight: DreamLight;
  private brickLight!: DreamLight;
  private readonly fallLight: DreamLight;

  private readonly tubeSpot: SpotSpec;
  private readonly redSpot: SpotSpec;
  private readonly flashSpot: SpotSpec;
  private readonly tubeSpots: readonly (SpotSpec | null)[];
  private readonly redSpots: readonly (SpotSpec | null)[];
  private readonly flashSpots: readonly (SpotSpec | null)[];

  private readonly streaks: Mesh[] = [];
  private readonly streakData: { mesh: number; at: number; length: number; seed: number; speed: number }[] = [];
  private dark!: Mesh;
  private readonly clocks: { value: number }[] = [];

  private readonly pictureTarget = new WebGLRenderTarget(PICTURE_SIZE, PICTURE_SIZE, { type: HalfFloatType });
  private readonly pictureLens = new PerspectiveCamera(SHOT_CAMERA_FOV, 1, renderConfig.near, renderConfig.far);
  private renderPicture: ((target: WebGLRenderTarget, camera: PerspectiveCamera) => void) | null = null;
  private pictureTaken = false;
  private frames = 0;

  private hum: RoomVoice | null = null;
  private machine: RoomVoice | null = null;
  private tune: RoomVoice | null = null;
  private motor: RoomVoice | null = null;
  private ride: RoomVoice | null = null;
  private static: RoomVoice | null = null;
  private drone: RoomVoice | null = null;
  private cable: RoomVoice | null = null;
  private chatter: RoomVoice | null = null;
  private calm: RoomVoice | null = null;
  private scared: RoomVoice | null = null;
  private stress: RoomVoice | null = null;

  constructor(ctx: RoomContext) {
    super(ctx);
    const seconds = ctx.seconds;
    // with reduced motion the lens barely travels: no push-ins, no vertigo
    const at = (s: number, z: number, yaw: number, pitch: number, fov: number, roll = 0): RoomKey => ({ t: s / seconds, at: [DOOR_X, EYE, z], yaw, pitch, roll, fov: REDUCED_MOTION ? 46 + (fov - 46) * 0.3 : fov });
    this.keys = [
      at(0, -0.24, 0, -7, 68),
      at(2, -0.25, 0, -6.5, 67),
      at(6.5, -0.3, 0, -4, 60),
      at(10, -0.38, 0, -1.2, 53),
      at(16, -0.5, 0, 0, 44),
      at(23.7, -0.62, 0, 0, 34),
      at(24.7, -0.62, 8, -1, 50),
      at(27.4, -0.62, 13, 0, 49),
      at(29.6, -0.62, 27, 1, 39),
      at(33.6, -0.62, 28, 1, 36),
      at(35.2, -0.62, -15, 2, 42),
      at(37.7, -0.62, -15, 1, 39),
      at(38.8, -0.62, 25, 0, 44),
      at(39.9, -0.62, 26, 0, 43),
      at(40.2, -0.62, 12, 0, 58),
      at(42.85, -0.62, 12, 0, 56),
      at(43.12, -0.62, 0, 0, 46),
      at(45.9, -0.62, 0, 0, 42),
      at(46.9, -0.62, 38, 10, 72),
      at(47.4, -0.62, 20, 34, 72),
      at(47.95, -0.62, 9, 36, 68),
      at(48.7, -0.62, 2, 8, 56),
      at(49.3, -0.62, 0, 3, 50),
      at(51.3, -0.62, 0, 3, 48),
      at(52.6, -0.62, 0, 0, 31),
      at(54, -0.62, 0, 0, 30),
      at(54.45, -0.66, 0, 0, REDUCED_MOTION ? 46 : 52),
      at(58.9, FALL_Z, 0, -2, REDUCED_MOTION ? 50 : 74, REDUCED_MOTION ? 0 : 6),
      at(60, FALL_Z, 0, -2, REDUCED_MOTION ? 50 : 76, REDUCED_MOTION ? 0 : 6),
    ];

    const b = this.build;
    const root = this.root;
    this.buildCar();
    this.buildDoor();
    this.buildIndicator();
    this.buildPanel();
    this.buildCeiling();
    this.buildCorridor();
    this.buildShaft();
    this.buildLanding();

    // the tube
    const tube = this.kit.prop('tube_light', [TUBE_X, H, TUBE_Z], { anchor: 'top' }, root);
    this.tubeLamp = new MeshStandardMaterial({ color: 0x000000, roughness: 0.4, emissive: new Color(0xd8f2e8), emissiveIntensity: TUBE_GLOW });
    this.kit.paint(tube, new MeshStandardMaterial({ color: 0x55584f, roughness: 0.6, metalness: 0.4 }));
    (tube.getObjectByName('tube') as Mesh).material = this.tubeLamp;
    const halo = b.glow(TUBE_X, H - 0.15, TUBE_Z, 1, 0xcfeadf, 0.1, root, 2.4);
    halo.scale.set(2.6, 0.8, 1);
    this.tubeHalo = halo.material as ShaderMaterial;
    this.tubeLight = this.light([TUBE_X - 0.3, H - 0.18, TUBE_Z], 0xd8efe6, TUBE_POINT, 3.2);
    this.tubeLight2 = this.light([TUBE_X + 0.3, H - 0.18, TUBE_Z], 0xd8efe6, TUBE_POINT, 3.2);
    this.tubeSpot = this.spot([TUBE_X, H - 0.16, TUBE_Z], [TUBE_X - 0.12, 0, TUBE_Z + 0.2], 0xd8efe6, TUBE_SPOT, 74, 0.9);
    this.tubeSpots = [this.tubeSpot, null, null];

    // the lamp that comes on when the tube has gone, dead until then
    const lamp = this.kit.prop('lamp_bulkhead', [0.71, 2.0, -D + 0.044], { scale: 0.55, anchor: 'center' }, root);
    this.kit.paint(lamp, new MeshStandardMaterial({ color: 0x4a1f18, roughness: 0.5, metalness: 0.5 }));
    this.bulb = new MeshBasicMaterial({ color: 0x000000 });
    const bulbMesh = new Mesh(new SphereGeometry(0.028, 12, 10), this.bulb);
    bulbMesh.position.set(0.71, 2.0, -D + 0.055);
    root.add(bulbMesh);
    const redHalo = b.glow(0.71, 2.0, -D + 0.08, 0.9, 0xff2a12, 0.0, root, 2.0);
    this.redHalo = redHalo.material as ShaderMaterial;
    this.redLight = this.light([0.42, 1.98, -D + 0.55], 0xff2a10, 0, 3.6);
    this.fillLight = this.light([DOOR_X - 0.1, 2.0, -0.42], 0xff2c14, 0, 1.9);
    this.redSpot = this.spot([0.7, 1.94, -D + 0.16], [-0.12, 0, -0.75], 0xff2810, 0, 66, 0.9);
    this.redSpots = [this.redSpot, null, null];

    // the flash that comes from behind you
    this.flashLight = this.light([DOOR_X, 1.85, 0.75], 0xeef2ff, 0, 9);
    this.flashSpot = this.spot([DOOR_X, 1.8, 1], [DOOR_X, 1.5, -D], 0xeef2ff, 0, 34, 0.5);
    this.flashSpots = [this.flashSpot, null, null];

    this.faceLight = this.light([DOOR_X + 0.5, 1.75, -0.86], 0xcfe0d8, 0, 0.9);
    this.fallLight = this.light([DOOR_X, 1.4, -D - 0.25], 0xffd9a0, 0, 5);

    const motes = b.motes(70, { x: [-W / 2, W / 2], y: [0.2, H], z: [-D, 0] }, root, { strength: 0.3 });
    this.clocks.push(motes.time);
    this.moteColor = (motes.points.material as ShaderMaterial).uniforms.uColor.value as Color;

    // him
    const heroSpec: FigureSpec = { avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 0.2, face: 'blank', tint: SUIT, bleach: SUIT_BLEACH };
    this.hero = this.kit.figures.hero(heroSpec);
    this.hero.update(0.2);
    this.hero.root.traverse((o) => {
      if ((o as Mesh).isMesh) o.receiveShadow = true;
    });
    root.add(this.hero.root);
    this.cornerX = -W / 2 + CORNER_OUT * Math.SQRT1_2;
    this.cornerZ = -D + CORNER_OUT * Math.SQRT1_2;
    this.heroShadow = b.contactShadow(this.cornerX, this.cornerZ, 0.46, root, 0.85);
    this.placeHim();
    this.hero.root.updateWorldMatrix(true, true);
    for (const side of ['L', 'R']) {
      const clavicle = this.hero.bone(`Bip01_${side}_Clavicle`);
      const arm = this.hero.bone(`Bip01_${side}_UpperArm`);
      if (!clavicle || !arm || !clavicle.parent) continue;
      clavicle.getWorldPosition(v1);
      arm.getWorldPosition(v2);
      const out = v2.sub(v1).normalize();
      const axis = out.clone().cross(UP).normalize().applyQuaternion(clavicle.parent.getWorldQuaternion(q1).invert());
      this.shoulders.push({ bone: clavicle, base: clavicle.quaternion.clone(), axis });
    }
    this.heroHead = this.hero.bone('Bip01_Head')!;
    this.heroHead.parent!.getWorldQuaternion(q1).invert();
    this.heroHeadAxis.copy(UP).applyQuaternion(q1).normalize();
    // his forehead almost against the corner
    this.hero.root.getWorldQuaternion(q2);
    v1.set(1, 0, 0).applyQuaternion(q2).applyQuaternion(q1).normalize();
    this.heroHeadBase.setFromAxisAngle(v1, HEAD_BOW).multiply(this.heroHead.quaternion);
    this.heroHead.quaternion.copy(this.heroHeadBase);

    // the others: two poses so that no two backs are the same; and those at your back, kept apart so the picture can do without them
    const menSpec: FigureSpec = { avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 0.2, face: 'blank', tint: SUIT, bleach: SUIT_BLEACH };
    this.menA = this.kit.figures.crowd(menSpec, 8);
    this.menB = this.kit.figures.crowd({ ...menSpec, time: 1.8 }, 7);
    this.behind = this.kit.figures.crowd({ ...menSpec, time: 3.1 }, 4);
    this.first = b.headless(1, { tint: SUIT, bleach: SUIT_BLEACH });
    this.first.set(0, -0.17, 0, -1.03, Math.PI);
    this.first.commit();
    // nothing shows in the empty collar but the neck coming out of it
    this.plug = new Mesh(new CylinderGeometry(0.07, 0.082, 0.05, 16), new MeshStandardMaterial({ color: 0x050505, roughness: 1 }));
    this.plug.position.set(-0.17, 1.445, -1.03);
    this.plug.visible = false;
    root.add(this.plug);
    this.self = this.kit.figures.crowd({ ...menSpec, time: 1.1 }, 1);
    this.self.set(0, DOOR_X, 0, YOU_Z, Math.PI, YOU_SCALE);
    this.self.commit();
    this.self.root.visible = false;
    for (const crowd of [this.menA, this.menB, this.behind, this.first, this.self]) root.add(crowd.root);
    this.menA.drawn = 0;
    this.menB.drawn = 0;
    this.behind.drawn = 0;
    this.first.drawn = 0;

    // the head at the end of the neck: only what is above the collar of a man
    this.head = this.kit.figures.crowd({ ...menSpec, face: 'scratched', half: 'upper', cutAt: HEAD_CUT, bleach: SUIT_BLEACH }, 1);
    this.head.drawn = 0;
    root.add(this.head.root);

    this.curve = new CatmullRomCurve3(NECK_POINTS.map((p) => new Vector3(...p)));
    const length = this.curve.getLength();
    const neck = b.neck(NECK_POINTS, root, { radius: 0.04, taper: 1, sway: 0 });
    neck.mesh.castShadow = false;
    this.neckMesh = neck.mesh;
    this.neckSegments = Math.max(24, Math.round(length * 26));
    this.clocks.push(neck.time);
    // how much of it stays above the ceiling or on the way up until it comes down
    let back = 1;
    for (let u = 0.98; u > 0; u -= 0.005) {
      if (this.curve.getPointAt(u).y >= H) {
        back = u;
        break;
      }
    }
    this.neckBack = back;
    const material = neck.mesh.material as MeshStandardMaterial;
    const sway = material.onBeforeCompile;
    const from = (length - 1) * 2.2;
    const to = length * 2.2;
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
      sway.call(material, shader, renderer);
      shader.uniforms.uTipShift = this.tipShift;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uTipShift;')
        .replace('#include <project_vertex>', `transformed += uTipShift * smoothstep(${from.toFixed(2)}, ${to.toFixed(2)}, uv.x);\n#include <project_vertex>`);
    };
    material.customProgramCacheKey = () => 'elevator-neck';
    neck.mesh.visible = false;

    // the fall: lights streaming past the open door
    const glow = tileMap(64, 1, (c, s) => {
      const g = c.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
    });
    const random = randomFrom(71);
    const streaks = (count: number, color: Color) => {
      const positions = new Float32Array(count * 12);
      const uvs = new Float32Array(count * 8);
      const index: number[] = [];
      const mesh = this.streaks.length;
      for (let i = 0; i < count; i++) {
        const x = DOOR_X + (random() - 0.5) * 2.4;
        const z = -D - 0.9 - random() * 3;
        const half = 0.008 + random() * 0.03;
        positions.set([x - half, 0, z, x + half, 0, z, x - half, 0, z, x + half, 0, z], i * 12);
        uvs.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
        index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
        this.streakData.push({ mesh, at: i * 4, length: 2.4 + random() * 5, seed: random() * 40, speed: 3 + random() * 6 });
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
      geometry.setIndex(index);
      const m = new Mesh(geometry, new MeshBasicMaterial({ map: glow, color, transparent: true, depthWrite: false, blending: AdditiveBlending }));
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = 3;
      this.streaks.push(m);
      root.add(m);
    };
    streaks(38, new Color(1, 0.72, 0.42).multiplyScalar(2.6));
    streaks(22, new Color(0.86, 0.9, 1).multiplyScalar(2.2));

    this.pictureLens.layers.enable(LAYERS.DREAM);

    // what is heard
    const s = this.sound;
    this.beat(0, () => {
      this.hum = s.bed('rooms/fluorescent_hum_close.mp3', { gain: 0.1 });
      this.machine = s.bed('rooms/lift_machine_room.mp3', { gain: 0.07, lowpass: 1200 });
    });
    this.beat(DOOR_SHUT[0], () => {
      s.play('rooms/lift_doors_close.mp3', { gain: 0.5, reverb: 0.1 });
      this.tune = s.bed('rooms/lift_tune_loop.mp3', { gain: 0.2, offset: 0 });
    });
    // the lift asks in the dream's whisper; the intercom later is the voice from the house, through its speaker
    this.beat(6, () => this.say({ tr: 'Hangi kata?', en: 'Which floor?' }, 3.2, 'dream'));
    this.beat(RIDE[0] - 0.7, () => s.play('rooms/lift_ding.mp3', { gain: 0.25 }));
    this.beat(RIDE[0], () => {
      this.motor = s.bed('rooms/lift_motor.mp3', { gain: 0.2, fade: 0.6 });
      this.ride = s.bed('rooms/lift_ride_old.mp3', { gain: 0.13, fade: 1.6 });
    });
    for (let n = 1; n <= 7; n++) {
      let when: number = RIDE[0];
      while (floorAt(when) < n && when < RIDE[1]) when += 0.02;
      this.beat(when, () => {
        s.play(`rooms/lift_relay_${(n % 3) + 1}.mp3`, { gain: 0.3, reverb: 0.1 });
        if (n === 5 || n === 6) s.play('rooms/lift_ding.mp3', { gain: 0.17, rate: 0.97 - n * 0.01 });
      });
    }
    this.beat(RIDE[1], () => {
      this.tune?.stop(0.02);
      this.motor?.stop(0.04);
      this.ride?.stop(0.04);
      this.hum?.stop(0.7);
      this.machine?.gain(0.03, 0.3);
      s.play('rooms/lift_jolt.mp3', { gain: 0.7 });
      s.play('rooms/light_die.mp3', { gain: 0.2 });
    });
    this.beat(RIDE[1] + 0.85, () => s.play('rooms/lift_bell_dead.mp3', { gain: 0.4 }));
    this.beat(RED_ON, () => {
      s.play('rooms/power_thunk.mp3', { gain: 0.5, reverb: 0.3 });
      this.drone = s.bed('rooms/dream_drone_low.mp3', { gain: 0.12, fade: 2 });
      this.cable = s.bed('rooms/cable_hum.mp3', { gain: 0.2, fade: 1.5 });
      this.chatter = s.bed('rooms/relay_chatter.mp3', { gain: 0.05, lowpass: 3000, fade: 3 });
    });
    this.beat(26.4, () => s.play('rooms/steel_creak_2.mp3', { gain: 0.3, reverb: 0.3, pan: -0.3 }));
    this.beat(BREATH_FROM, () => {
      this.calm = s.bed('rooms/breath_calm.mp3', { gain: 0.12, offset: 0 });
    });
    this.beat(31.7, () => s.play('rooms/steel_creak_4.mp3', { gain: 0.22, reverb: 0.3, pan: 0.4 }));
    this.beat(34.4, () => s.play('rooms/intercom_on.mp3', { gain: 0.3, pan: 0.45 }));
    this.beat(35, () => {
      this.static = s.bed('rooms/intercom_static.mp3', { gain: 0.14, pan: 0.45 });
    });
    this.beat(35.6, () => s.play('rooms/intercom_crackle_1.mp3', { gain: 0.25, pan: 0.45 }));
    this.beat(36, () => this.say({ tr: 'Tabağın hâlâ burada.', en: 'Your plate is still here.' }, 3.4, 'phone'));
    this.beat(37.4, () => s.play('rooms/intercom_crackle_3.mp3', { gain: 0.25, pan: 0.45 }));
    this.beat(38.6, () => s.play('rooms/intercom_crackle_1.mp3', { gain: 0.22, pan: 0.45 }));
    this.beat(39.6, () => {
      this.static?.stop(0.1);
      this.static = null;
      s.play('rooms/intercom_off.mp3', { gain: 0.3, pan: 0.45 });
    });
    this.beat(BLINK_ONE, () => s.play('rooms/coat_move.mp3', { gain: 0.4, reverb: 0.1, pan: 0.25 }));
    this.beat(BLINK_TWO, () => {
      s.play('rooms/coat_move.mp3', { gain: 0.5, reverb: 0.1, pan: -0.5 });
      s.play('rooms/coat_move.mp3', { gain: 0.42, reverb: 0.1, pan: 0.55, rate: 0.92 });
      this.calm?.gain(0, 0.25);
      this.scared = s.bed('rooms/breath_scared.mp3', { gain: 0.17, fade: 0.8 });
    });
    this.beat(44.2, () => {
      this.stress = s.play('rooms/steel_stress.mp3', { gain: 0.13, reverb: 0.3, fade: 2 });
    });
    this.beat(44.8, () => s.play('rooms/hatch_heavy.mp3', { gain: 0.35, reverb: 0.3 }));
    this.beat(NECK_DOWN[0], () => s.play('rooms/sheet_metal_pop_2.mp3', { gain: 0.4 }));
    // the breath held, and then nothing at all, while it turns
    this.beat(HEAD_TURN[0] - 0.3, () => {
      s.play('rooms/breath_held.mp3', { gain: 0.3 });
      this.drone?.gain(0, 0.5);
      this.cable?.gain(0, 0.5);
      this.chatter?.gain(0, 0.5);
      this.machine?.gain(0, 0.5);
      this.scared?.gain(0, 0.4);
      this.stress?.gain(0, 0.5);
    });
    this.beat(DOOR_OUT[0], () => s.play('rooms/lift_doors_open.mp3', { gain: 0.5, reverb: 0.1 }));
    this.beat(FLASH_AT, () => this.shutter());
    this.beat(FLASH_AT + 0.5, () => s.play('rooms/breath_let_go.mp3', { gain: 0.3 }));
    this.beat(FALL_AT, () => {
      s.play('rooms/cable_snap.mp3', { gain: 0.7, reverb: 0.3 });
      s.play('rooms/whoosh_fall.mp3', { gain: 0.5 });
      s.bed('rooms/fall_wind.mp3', { gain: 0.18, lowpass: 8000, fade: 1.6 });
    });
    this.beat(CUT_AT, () => {
      s.stopAll(0.02);
      s.play('rooms/stop_thud.mp3', { gain: 0.8 });
    });
  }

  override develop(render: (target: WebGLRenderTarget, camera: PerspectiveCamera) => void): void {
    this.renderPicture = render;
  }

  override pose(t: number, out: RoomPose): RoomPose {
    super.pose(t, out);
    const s = t * this.seconds;
    const jolt = s - RIDE[1];
    if (jolt > 0 && jolt < 1.3) {
      const fall = Math.exp(-jolt * 5);
      out.position.y += Math.sin(jolt * 34) * JOLT_MOVE * fall;
      out.roll += Math.sin(jolt * 23 + 1) * JOLT_ROLL * fall;
    }
    const fell = s - FALL_AT;
    if (fell > 0) {
      const pull = Math.exp(-fell * 3.2);
      out.position.y += Math.sin(fell * 30) * JOLT_MOVE * 1.4 * pull + wobble(fell * 11, 3) * FALL_SHAKE;
      out.yaw += wobble(fell * 9, 5) * FALL_SHAKE * 0.4;
    }
    return out;
  }

  override dispose(): void {
    super.dispose();
    this.pictureTarget.dispose();
  }

  /** The car's walls: bays of steel between brass strips, a rail, a dark kick plate; one mesh per material. */
  private buildCar(): void {
    const k = this.kit;
    const b = this.build;
    const steel = k.surface('steel_scuffed', 1, { metalness: 0.38, color: new Color(0x8f968d) });
    const lower = k.surface('steel_scuffed', 0.8, { metalness: 0.3, color: new Color(0x3f4641) });
    const plate = k.surface('metal_plate_dark', 2, { metalness: 0.2 });
    const brass = new MeshStandardMaterial({ color: 0x7f6433, roughness: 0.5, metalness: 1 });
    const steelParts: BufferGeometry[] = [];
    const lowerParts: BufferGeometry[] = [];
    const plateParts: BufferGeometry[] = [];
    const brassParts: BufferGeometry[] = [];
    const random = randomFrom(5);
    const ID = new Matrix4();
    const FRONT = new Matrix4().makeTranslation(0, 0, -D);
    const LEFT = new Matrix4().makeRotationY(Math.PI / 2).setPosition(-W / 2, 0, -D / 2);
    const RIGHT = new Matrix4().makeRotationY(-Math.PI / 2).setPosition(W / 2, 0, -D / 2);
    const BACK = new Matrix4().makeRotationY(Math.PI);
    const run = (frame: Matrix4, x0: number, x1: number, rail: boolean) => {
      const L = x1 - x0;
      const bays = Math.max(1, Math.round(L / BAY));
      const bw = L / bays;
      const mid = (x0 + x1) / 2;
      box(plateParts, frame, L, H, 0.004, mid, H / 2, -0.002);
      for (let i = 0; i < bays; i++) {
        const cx = x0 + (i + 0.5) * bw;
        box(steelParts, frame, bw - 0.008, TOP - RAIL, 0.008, cx, (TOP + RAIL) / 2, 0.004, random() * 6, random() * 6);
        box(lowerParts, frame, bw - 0.008, RAIL - KICK, 0.008, cx, (RAIL + KICK) / 2, 0.004, random() * 6, random() * 6);
        for (const sx of [-1, 1]) {
          for (const y of [RAIL + 0.05, TOP - 0.05, KICK + 0.05, RAIL - 0.05]) {
            const g = new CylinderGeometry(0.006, 0.0075, 0.004, 8).rotateX(Math.PI / 2);
            g.translate(cx + sx * (bw / 2 - 0.05), y, 0.01).applyMatrix4(frame);
            brassParts.push(g);
          }
        }
      }
      for (let i = 0; i <= bays; i++) box(brassParts, frame, 0.022, TOP - KICK, 0.014, x0 + i * bw, (TOP + KICK) / 2, 0.007);
      box(brassParts, frame, L, 0.018, 0.018, mid, TOP, 0.009);
      box(brassParts, frame, L, 0.026, 0.02, mid, RAIL, 0.01);
      box(plateParts, frame, L, KICK, 0.016, mid, KICK / 2, 0.008, random() * 6);
      box(lowerParts, frame, L, H - TOP, 0.006, mid, (H + TOP) / 2, 0.003, random() * 6);
      if (rail) {
        rod(brassParts, frame, 0.016, L - 0.04, mid, RAIL - 0.02, 0.06, 'x');
        for (let i = 0; i <= bays; i++) rod(brassParts, frame, 0.008, 0.05, x0 + 0.02 + (i * (L - 0.04)) / bays, RAIL - 0.02, 0.035, 'z');
      }
    };
    run(LEFT, -D / 2, D / 2, true);
    run(RIGHT, -D / 2, D / 2, true);
    run(BACK, -W / 2, W / 2, true);
    const apertureLeft = DOOR_X - DOOR_W / 2;
    const apertureRight = DOOR_X + DOOR_W / 2;
    run(FRONT, -W / 2, apertureLeft - JAMB, false);
    run(FRONT, apertureRight + JAMB, W / 2, false);
    // the frame of the door and what is over it
    box(plateParts, FRONT, DOOR_W + JAMB * 2, H - DOOR_H, 0.004, DOOR_X, (H + DOOR_H) / 2, -0.002);
    box(lowerParts, FRONT, DOOR_W + JAMB * 2, H - DOOR_H - JAMB, 0.008, DOOR_X, (H + DOOR_H + JAMB) / 2, 0.004, 1.3);
    box(brassParts, FRONT, JAMB, DOOR_H + JAMB, 0.022, apertureLeft - JAMB / 2, (DOOR_H + JAMB) / 2, 0.011);
    box(brassParts, FRONT, JAMB, DOOR_H + JAMB, 0.022, apertureRight + JAMB / 2, (DOOR_H + JAMB) / 2, 0.011);
    box(brassParts, FRONT, DOOR_W + JAMB * 2, JAMB, 0.022, DOOR_X, DOOR_H + JAMB / 2, 0.011);
    box(plateParts, FRONT, 0.012, DOOR_H, 0.09, apertureLeft - 0.006, DOOR_H / 2, -0.045);
    box(plateParts, FRONT, 0.012, DOOR_H, 0.09, apertureRight + 0.006, DOOR_H / 2, -0.045);
    box(plateParts, FRONT, DOOR_W, 0.012, 0.09, DOOR_X, DOOR_H + 0.006, -0.045);
    // the sill the door runs in, worn bright
    box(brassParts, ID, DOOR_W + JAMB * 2, 0.012, 0.09, DOOR_X, 0.002, -D - 0.042);
    box(plateParts, ID, DOOR_W + JAMB * 2, 0.012, 0.016, DOOR_X, 0.006, -D - 0.05);
    // a strip of brass down each corner
    for (const [x, z] of [[-W / 2 + 0.016, -D + 0.016], [W / 2 - 0.016, -D + 0.016], [-W / 2 + 0.016, -0.016], [W / 2 - 0.016, -0.016]] as const) box(brassParts, ID, 0.032, H, 0.032, x, H / 2, z);

    const solid = (parts: BufferGeometry[], material: Material) => {
      const m = new Mesh(merged(parts), material);
      m.frustumCulled = false;
      m.receiveShadow = true;
      this.root.add(m);
    };
    solid(steelParts, steel);
    solid(lowerParts, lower);
    solid(plateParts, plate);
    solid(brassParts, brass);

    // the floor: the house's own checker, gone grey under feet
    const floor = k.surface('tile_checker', 0.9, { roughness: 0.9, color: new Color(0xb9b4a6) });
    this.root.add(k.floor(-W / 2, W / 2, -D, 0, 0, floor));

    // what years leave on it
    const skin = (w: number, h: number, seed: number, floorSkin: boolean, x: number, y: number, z: number, ry: number, rx = 0, darkEnd = 0) => {
      const px = 430;
      const skinCanvas = document.createElement('canvas');
      skinCanvas.width = Math.ceil(w * px);
      skinCanvas.height = Math.ceil(h * px);
      const c = skinCanvas.getContext('2d')!;
      drawGrime(c, skinCanvas.width, skinCanvas.height, seed, floorSkin, floorSkin ? 90 : 150, darkEnd);
      if (seed === 3) {
        // the door's own opening stays clear
        const l = (apertureLeft + W / 2 + JAMB * 0) / W;
        c.clearRect(l * skinCanvas.width, ((H - DOOR_H) / H) * skinCanvas.height, (DOOR_W / W) * skinCanvas.width, (DOOR_H / H) * skinCanvas.height);
      }
      const t = new CanvasTexture(skinCanvas);
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 4;
      const m = new Mesh(new PlaneGeometry(w, h), new MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.75, metalness: 0.1 }));
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, 0, 'YXZ');
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.renderOrder = 1;
      this.root.add(m);
    };
    skin(W, H, 3, false, 0, H / 2, -D + 0.024, 0);
    skin(D, H, 13, false, -W / 2 + 0.024, H / 2, -D / 2, Math.PI / 2, 0, -1);
    skin(D, H, 23, false, W / 2 - 0.024, H / 2, -D / 2, -Math.PI / 2, 0, 1);
    skin(W, H, 33, false, 0, H / 2, -0.024, Math.PI);
    skin(W, D, 43, true, 0, 0.003, -D / 2, 0, -Math.PI / 2);

    // a folded-down seat, and on it someone's bell
    const seatWood = k.surface('wood_dark_paint', 1.6);
    const seat = new Mesh(meterUVs(new BoxGeometry(0.3, 0.028, 0.42)), seatWood);
    seat.position.set(W / 2 - 0.16, 0.62, -1.72);
    seat.receiveShadow = true;
    seat.frustumCulled = false;
    seat.castShadow = true;
    this.root.add(seat);
    k.paint(k.prop('bell_service', [W / 2 - 0.15, 0.634, -1.66], { rotation: [0, 30, 0] }, this.root), brass);
    k.paint(k.prop('air_vent', [-W / 2 + 0.012, 2.12, -0.9], { rotation: [0, 90, 0], anchor: 'center' }, this.root), new MeshStandardMaterial({ color: 0x2c2a25, roughness: 0.7, metalness: 0.5 }));

    // the card behind you
    const card = b.label(0.19, 0.13, drawCard, { px: 900, roughness: 0.8 });
    card.mesh.position.set(0.05, 1.5, -0.016);
    card.mesh.rotation.y = Math.PI;
    card.mesh.rotation.z = 0.02;
    card.mesh.receiveShadow = true;
    this.root.add(card.mesh);
  }

  private buildDoor(): void {
    const k = this.kit;
    const b = this.build;
    const width = DOOR_W + 0.12;
    const height = DOOR_H + 0.08;
    const shape = new Shape();
    shape.moveTo(-width / 2, 0);
    shape.lineTo(width / 2, 0);
    shape.lineTo(width / 2, height);
    shape.lineTo(-width / 2, height);
    shape.closePath();
    const hole = new Path();
    hole.absarc(0, PORT_Y, PORT_R, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const steel = k.surface('steel_scuffed', 0.9, { metalness: 0.42, color: new Color(0x656c66) });
    const leafGeometry = new ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: false, curveSegments: 48 });
    leafGeometry.setAttribute('uv1', leafGeometry.getAttribute('uv'));
    const leaf = new Mesh(leafGeometry, steel);
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    leaf.frustumCulled = false;
    this.leaf.add(leaf);
    this.leaf.position.set(DOOR_X, 0, -D - 0.055);

    const brass = new MeshStandardMaterial({ color: 0x6e5a2f, roughness: 0.55, metalness: 1 });
    const plate = k.surface('metal_plate_dark', 2, { metalness: 0.2 });
    const ID = new Matrix4();
    const brassParts: BufferGeometry[] = [new TorusGeometry(PORT_R + 0.008, 0.019, 12, 64).translate(0, PORT_Y, 0.044)];
    const plateParts: BufferGeometry[] = [];
    box(plateParts, ID, width, 0.18, 0.006, 0, 0.09, 0.038);
    box(brassParts, ID, width, 0.012, 0.006, 0, 0.186, 0.04);
    // the pull
    rod(brassParts, ID, 0.012, 0.42, width / 2 - 0.14, 1.05, 0.088, 'y');
    for (const y of [0.88, 1.22]) rod(brassParts, ID, 0.008, 0.06, width / 2 - 0.14, y, 0.06, 'z');
    // ring of bolts round the glass
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const g = new CylinderGeometry(0.007, 0.009, 0.006, 8).rotateX(Math.PI / 2);
      g.translate(Math.cos(a) * (PORT_R + 0.052), PORT_Y + Math.sin(a) * (PORT_R + 0.052), 0.04);
      brassParts.push(g);
    }
    const addMerged = (parts: BufferGeometry[], material: Material) => {
      const m = new Mesh(merged(parts), material);
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
      this.leaf.add(m);
    };
    addMerged(brassParts, brass);
    addMerged(plateParts, plate);

    // the door's marks
    const px = 430;
    const skinCanvas = document.createElement('canvas');
    skinCanvas.width = Math.ceil(width * px);
    skinCanvas.height = Math.ceil(height * px);
    drawLeafMarks(skinCanvas.getContext('2d')!, skinCanvas.width, skinCanvas.height, skinCanvas.width / 2, (height - PORT_Y) * px, PORT_R * px);
    const t = new CanvasTexture(skinCanvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    const skin = new Mesh(new PlaneGeometry(width, height), new MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.75, metalness: 0.1 }));
    skin.position.set(0, height / 2, 0.0365);
    skin.frustumCulled = false;
    skin.receiveShadow = true;
    skin.renderOrder = 1;
    this.leaf.add(skin);

    // wired glass, a reflection on it
    const glassCanvas = document.createElement('canvas');
    glassCanvas.width = glassCanvas.height = 256;
    drawGlass(glassCanvas.getContext('2d')!, 256);
    const glassMap = new CanvasTexture(glassCanvas);
    glassMap.colorSpace = SRGBColorSpace;
    const glass = new Mesh(new CircleGeometry(PORT_R, 48), new MeshStandardMaterial({ map: glassMap, transparent: true, depthWrite: false, roughness: 0.12, metalness: 0.1 }));
    glass.position.set(0, PORT_Y, 0.02);
    glass.frustumCulled = false;
    glass.renderOrder = 2;
    this.leaf.add(glass);
    const halo = b.glow(0, PORT_Y, 0.03, 1.15, PALETTE.warm, 0, this.leaf, 2.1);
    this.portHalo = halo.material as ShaderMaterial;
    this.root.add(this.leaf);
  }

  private buildIndicator(): void {
    const fan = new Shape();
    fan.absarc(0, 0, FAN_R, 0, Math.PI, false);
    fan.closePath();
    const brass = new MeshStandardMaterial({ color: 0x75602f, roughness: 0.48, metalness: 1 });
    const dark = new MeshStandardMaterial({ color: 0x0c0a07, roughness: 0.6, metalness: 0.4 });
    const plate = new Mesh(new ExtrudeGeometry(fan, { depth: 0.012, bevelEnabled: false, curveSegments: 40 }), brass);
    plate.position.set(DOOR_X, FAN_Y, -D + 0.022);
    plate.frustumCulled = false;
    plate.receiveShadow = true;
    this.root.add(plate);
    const rim = new Mesh(new TorusGeometry(FAN_R, 0.009, 10, 48, Math.PI), brass);
    rim.position.set(DOOR_X, FAN_Y, -D + 0.036);
    rim.frustumCulled = false;
    this.root.add(rim);
    const ticks: BufferGeometry[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI;
      ticks.push(meterUVs(new BoxGeometry(0.03, 0.004, 0.002)).translate(FAN_R - 0.032, 0, 0).rotateZ(a).translate(DOOR_X, FAN_Y, -D + 0.035));
    }
    const window = meterUVs(new BoxGeometry(NUMERAL_W + 0.03, NUMERAL_H + 0.03, 0.006)).translate(DOOR_X, FAN_Y + NUMERAL_H * 0.5 + 0.052, -D + 0.036);
    const tickMesh = new Mesh(mergeGeometries([...ticks, window])!, dark);
    tickMesh.frustumCulled = false;
    this.root.add(tickMesh);
    const cell = 128;
    const canvas = document.createElement('canvas');
    canvas.width = 224;
    canvas.height = cell * NUMERALS.length;
    drawDrum(canvas.getContext('2d')!, canvas.width, cell);
    this.drum = new CanvasTexture(canvas);
    this.drum.colorSpace = SRGBColorSpace;
    this.drum.repeat.set(1, 1 / NUMERALS.length);
    this.drum.offset.y = 1 - 1 / NUMERALS.length;
    this.numeral = new MeshBasicMaterial({ map: this.drum });
    const numeral = new Mesh(new PlaneGeometry(NUMERAL_W, NUMERAL_H), this.numeral);
    numeral.position.set(DOOR_X, FAN_Y + NUMERAL_H * 0.5 + 0.052, -D + 0.04);
    numeral.frustumCulled = false;
    this.root.add(numeral);
  }

  private buildPanel(): void {
    const b = this.build;
    const panelX = DOOR_X - DOOR_W / 2 - JAMB - 0.13;
    const panelY = 1.28;
    const panelH = 0.62;
    const panel = b.label(0.21, panelH, drawPanel, { px: 900, roughness: 0.42 });
    (panel.mesh.material as MeshStandardMaterial).metalness = 0.55;
    panel.mesh.position.set(panelX, panelY, -D + 0.02);
    panel.mesh.receiveShadow = true;
    this.root.add(panel.mesh);
    const cream = new MeshStandardMaterial({ color: 0xcabf9f, roughness: 0.32, metalness: 0 });
    const buttons: BufferGeometry[] = [];
    const rowY = (i: number) => panelY + panelH / 2 - panelH * (0.09 + i * 0.094);
    for (let i = 0; i < 8; i++) buttons.push(new CylinderGeometry(0.0165, 0.018, 0.012, 18).rotateX(Math.PI / 2).translate(panelX + 0.035, rowY(i), -D + 0.026));
    const buttonMesh = new Mesh(mergeGeometries(buttons)!, cream);
    buttonMesh.frustumCulled = false;
    this.root.add(buttonMesh);
    this.lit = new Mesh(new CircleGeometry(0.0135, 18), new MeshBasicMaterial({ color: new Color(1, 0.62, 0.22).multiplyScalar(3) }));
    this.lit.position.set(panelX + 0.035, rowY(0), -D + 0.0327);
    this.lit.frustumCulled = false;
    this.root.add(this.lit);
    const capacity = b.label(0.2, 0.075, drawCapacity, { px: 900, roughness: 0.42 });
    capacity.mesh.position.set(panelX - 0.01, panelY + panelH / 2 + 0.09, -D + 0.02);
    this.root.add(capacity.mesh);

    // the intercom, in the jamb on the right
    const intercomX = DOOR_X + DOOR_W / 2 + JAMB + 0.08;
    const intercomY = 1.62;
    const grille = b.label(0.1, 0.1, (c, w, h) => {
      c.fillStyle = '#0f0d0a';
      c.beginPath();
      c.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(160,136,92,0.8)';
      for (let i = 0; i < 40; i++) {
        for (let j = 0; j < 40; j++) {
          const x = (i + 0.5 + (j % 2) * 0.5) * (w / 40);
          const y = (j + 0.5) * (h / 40);
          if (Math.hypot(x - w / 2, y - h / 2) < w * 0.45 && (i + j) % 2 === 0) c.fillRect(x, y, 2, 2);
        }
      }
    }, { px: 900, transparent: true, roughness: 0.6 });
    grille.mesh.position.set(intercomX, intercomY, -D + 0.021);
    this.root.add(grille.mesh);
    const ring = new Mesh(new TorusGeometry(0.052, 0.008, 10, 36), new MeshStandardMaterial({ color: 0xa8843f, roughness: 0.4, metalness: 1 }));
    ring.position.set(intercomX, intercomY, -D + 0.022);
    ring.frustumCulled = false;
    this.root.add(ring);
    this.intercomLamp = new MeshBasicMaterial({ color: 0x120403 });
    const led = new Mesh(new CircleGeometry(0.009, 14), this.intercomLamp);
    led.position.set(intercomX, intercomY + 0.09, -D + 0.022);
    led.frustumCulled = false;
    this.root.add(led);
  }

  private buildCeiling(): void {
    const k = this.kit;
    const ceiling = k.surface('rust_streaked', 2, { color: new Color(0x7c7c70), roughness: 0.9, metalness: 0.3 });
    const x0 = HATCH_X - HATCH_SIZE / 2;
    const x1 = HATCH_X + HATCH_SIZE / 2;
    const z0 = HATCH_Z - HATCH_SIZE / 2;
    const z1 = HATCH_Z + HATCH_SIZE / 2;
    for (const [a, b, c, d] of [[-W / 2, W / 2, -D, z0], [-W / 2, W / 2, z1, 0], [-W / 2, x0, z0, z1], [x1, W / 2, z0, z1]] as const) {
      const m = k.floor(a, b, c, d, H, ceiling);
      m.rotation.x = Math.PI / 2;
      this.root.add(m);
    }
    const trim = new MeshStandardMaterial({ color: 0x3d3324, roughness: 0.5, metalness: 0.8 });
    const ID = new Matrix4();
    const parts: BufferGeometry[] = [];
    const f = 0.03;
    box(parts, ID, HATCH_SIZE + f * 2, 0.022, f, HATCH_X, H - 0.008, z0 - f / 2);
    box(parts, ID, HATCH_SIZE + f * 2, 0.022, f, HATCH_X, H - 0.008, z1 + f / 2);
    box(parts, ID, f, 0.022, HATCH_SIZE, x0 - f / 2, H - 0.008, HATCH_Z);
    box(parts, ID, f, 0.022, HATCH_SIZE, x1 + f / 2, H - 0.008, HATCH_Z);
    // ribs across the rest of it
    for (const z of [-0.42, -2.12]) box(parts, ID, W, 0.03, 0.05, 0, H - 0.015, z);
    const frame = new Mesh(merged(parts), trim);
    frame.frustumCulled = false;
    frame.receiveShadow = true;
    this.root.add(frame);
    // above the hatch, the dark
    const shaftAbove = new Mesh(new BoxGeometry(1.4, 1, 1.4).scale(-1, 1, 1), new MeshBasicMaterial({ color: 0x010101 }));
    shaftAbove.position.set(HATCH_X, H + 0.5, HATCH_Z);
    shaftAbove.frustumCulled = false;
    this.root.add(shaftAbove);
    // the lid, hinged at the edge nearest you
    const steel = k.surface('steel_scuffed', 1, { metalness: 0.55, color: new Color(0x5a6058) });
    const lid = new Mesh(meterUVs(new BoxGeometry(HATCH_SIZE - 0.01, 0.016, HATCH_SIZE - 0.01)).translate(0, 0, -HATCH_SIZE / 2), steel);
    lid.frustumCulled = false;
    lid.receiveShadow = true;
    this.lid.add(lid);
    const handle = new Mesh(new TorusGeometry(0.04, 0.007, 8, 18, Math.PI), new MeshStandardMaterial({ color: 0x9a7c44, roughness: 0.4, metalness: 1 }));
    handle.rotation.set(Math.PI, 0, 0);
    handle.position.set(0, -0.01, -HATCH_SIZE * 0.72);
    handle.frustumCulled = false;
    this.lid.add(handle);
    this.lid.position.set(HATCH_X, H - 0.002, z1);
    this.root.add(this.lid);
  }

  /** The last of the corridor: there until the doors have shut and the car has left it. */
  private buildCorridor(): void {
    const b = this.build;
    const c = this.corridor;
    c.position.set(DOOR_X, 0, -D - 0.055);
    b.box(2.1, 6.4, 2.75, { walls: b.damask(PALETTE.damaskGreen), floor: b.checker(0.5), ceiling: b.ceiling(0.6), skip: ['-z'] }, c);
    b.wainscot(1.05, -3.2, 6.4, '-x', c);
    b.wainscot(-1.05, -3.2, 6.4, '+x', c);
    b.wainscot(0, -6.4, 2.1, '+z', c);
    const table = b.lampTable(0, -5.7, c, 0);
    table.shade.side = FrontSide;
    b.glow(table.lightAt[0], table.lightAt[1], table.lightAt[2], 1.2, PALETTE.warm, 0.5, c);
    b.contactShadow(0, -5.7, 0.7, c);
    this.root.add(c);
    this.hallLamp = this.light([DOOR_X + table.lightAt[0], table.lightAt[1], c.position.z + table.lightAt[2]], PALETTE.warm, 8, 8);
    this.corridorLight = this.light([DOOR_X, 2.45, -D - 0.7], PALETTE.warm, 3, 5);
    (b.checker(0.5) as MeshStandardMaterial).roughness = 0.5;
  }

  /** What goes by in the porthole: bands of shaft, and through the gaps, the same room again. */
  private buildShaft(): void {
    const k = this.kit;
    const b = this.build;
    const wall = k.surface('plaster_mould', 1.8, { color: new Color(0x6a6b60), roughness: 0.95 });
    for (let i = -2; i <= 1; i++) {
      const band = k.block(6, 0.96, 0.03, wall);
      band.position.set(DOOR_X, PORT_Y + (i + 0.5) * FLOOR_PERIOD, -D - 0.2);
      this.shaft.add(band);
      // the lip of the slab over each opening
      const lip = k.block(6, 0.08, 0.06, wall);
      lip.position.set(DOOR_X, PORT_Y + (i + 0.5) * FLOOR_PERIOD - 0.5, -D - 0.18);
      this.shaft.add(lip);
    }
    this.shaft.visible = false;
    this.root.add(this.shaft);

    // the dinner table: a small room standing near, which from the eye is a big one far away
    const s = this.table;
    s.scale.setScalar(SET_SCALE);
    s.position.set(DOOR_X, SET_Y, SET_Z);
    this.root.add(s);
    const room = new Group();
    room.position.z = 2.4;
    b.box(7.2, 4.8, 2.9, { walls: b.damask(PALETTE.damaskTeal), floor: b.checker(0.55), ceiling: b.ceiling(0.6), skip: ['-z'] }, room);
    s.add(room);
    k.paint(k.prop('dining_table', [0, 0, 0], {}, s), new MeshStandardMaterial({ color: 0xa79f8c, roughness: 0.8 }));
    const chairs = k.props('chair_ladder', 4);
    k.paint(chairs.root, new MeshStandardMaterial({ color: 0x1a1410, roughness: 0.6 }));
    chairs.set(0, 0.38, 0, 0.98, Math.PI);
    chairs.set(1, -1.42, 0, 0, Math.PI / 2);
    chairs.set(2, 1.42, 0, 0, -Math.PI / 2);
    chairs.set(3, -0.38, 0, -0.98, 0);
    chairs.commit();
    s.add(chairs.root);
    const sit = 'm_sit_chair_idle_roll_head';
    this.you = k.figures.crowd({ avatar: 'figure_man', clip: sit, time: 3, face: 'blank', tint: SUIT, bleach: SUIT_BLEACH }, 1);
    this.you.set(0, 0.38, 0, 1.0, Math.PI);
    this.father = k.figures.crowd({ avatar: 'figure_man', clip: sit, time: 2, face: 'blank', tint: SUIT, bleach: SUIT_BLEACH }, 1);
    this.father.set(0, -1.44, 0, 0, Math.PI / 2);
    this.mother = k.figures.crowd({ avatar: 'figure_woman', clip: sit, time: 1, face: 'blank', bleach: 0.3 }, 1);
    this.mother.set(0, -0.38, 0, -1.0, 0);
    this.child = k.figures.crowd({ avatar: 'figure_child', clip: sit, time: 1.5, face: 'blank' }, 1);
    this.child.set(0, 1.4, 0, 0, -Math.PI / 2, 1);
    for (const crowd of [this.you, this.father, this.mother, this.child]) {
      crowd.commit();
      s.add(crowd.root);
    }
    // the lamp over it
    const shadeMesh = new Mesh(new CylinderGeometry(0.14, 0.44, 0.3, 24, 1, true), new MeshBasicMaterial({ color: new Color(1, 0.72, 0.42).multiplyScalar(2.4) }));
    shadeMesh.position.set(0, 2.05, 0);
    shadeMesh.frustumCulled = false;
    s.add(shadeMesh);
    const cord = new Mesh(new CylinderGeometry(0.008, 0.008, 0.7, 6), new MeshBasicMaterial({ color: 0x050403 }));
    cord.position.set(0, 2.55, 0);
    cord.frustumCulled = false;
    s.add(cord);
    b.glow(0, 2.0, 0, 2.2, PALETTE.warm, 0.32, s);
    s.visible = false;
    this.tableLamp = this.light([DOOR_X, SET_Y + 1.95 * SET_SCALE, SET_Z], PALETTE.warm, 0, 1.9);
  }

  /** Where the door opens to at last: a floor at chest height, a brick wall, the picture. */
  private buildLanding(): void {
    const k = this.kit;
    const b = this.build;
    const g = this.landing;
    const back = -D - 0.72;
    const floorY = 1.12;
    const left = DOOR_X - 1.1;
    const right = DOOR_X + 1.1;
    const brick = k.surface('plaster_damaged', 1.2, { roughness: 0.95, color: new Color(0xffffff) });
    brick.map = tileMap(1024, 1.2, drawBricks);
    brick.normalScale.setScalar(0.5);
    const raw = k.surface('plaster_mould', 1.8, { color: new Color(0x4c4a42), roughness: 0.95 });
    const wall = k.wall(right - left, 1.5, brick);
    wall.position.set(DOOR_X, floorY + 0.75, back);
    g.add(wall);
    for (const [x, ry] of [[left, Math.PI / 2], [right, -Math.PI / 2]] as const) {
      const side = k.wall(0.8, 1.5, brick);
      side.position.set(x, floorY + 0.75, -D - 0.36);
      side.rotation.y = ry;
      g.add(side);
    }
    const lid = k.floor(left, right, back, -D, floorY + 1.5, raw);
    lid.rotation.x = Math.PI / 2;
    g.add(lid);
    g.add(k.floor(left, right, back, -D - 0.08, floorY, b.checker(0.5)));
    const below = k.wall(right - left, 3, raw);
    below.position.set(DOOR_X, floorY - 1.5, -D - 0.08);
    g.add(below);
    const edge = k.block(right - left, 0.1, 0.03, raw);
    edge.position.set(DOOR_X, floorY - 0.05, -D - 0.08);
    g.add(edge);
    b.contactShadow(DOOR_X, back + 0.02, 0.5, g, 0.5, floorY + 0.004);

    // the picture of you, on a nail
    const print = b.print(this.pictureTarget.texture, PRINT_WIDTH);
    print.position.set(DOOR_X, floorY + 0.44, back + 0.012);
    print.rotation.z = -0.022;
    const image = print.children[1] as Mesh;
    image.material = new MeshBasicMaterial({ map: this.pictureTarget.texture, color: new Color().setScalar(PRINT_GAIN) });
    g.add(print);
    const nail = new Mesh(new SphereGeometry(0.006, 8, 6), new MeshStandardMaterial({ color: 0x2a241c, roughness: 0.4, metalness: 0.8 }));
    nail.position.set(DOOR_X, floorY + 0.44 + PRINT_WIDTH * 0.57, back + 0.018);
    nail.frustumCulled = false;
    g.add(nail);
    g.visible = false;
    this.root.add(g);
    this.brickLight = this.light([DOOR_X - 0.12, floorY + 0.95, back + 0.5], PALETTE.warm, 0, 1.5);

    // what is behind the streaks when all that has gone
    this.dark = new Mesh(new PlaneGeometry(9, 14), new MeshBasicMaterial({ color: 0x020101 }));
    this.dark.position.set(DOOR_X, 0, -D - 4.4);
    this.dark.frustumCulled = false;
    this.dark.visible = false;
    this.root.add(this.dark);
  }

  /** Where he stands, after however many times you have looked away. */
  private placeHim(): void {
    const s = STEPS[this.step];
    const x = this.cornerX + s.out * Math.SQRT1_2;
    const z = this.cornerZ + s.out * Math.SQRT1_2;
    this.hero.root.position.set(x, 0, z);
    this.hero.root.rotation.y = CORNER_HEADING + s.turn;
    this.heroShadow.position.x = x;
    this.heroShadow.position.z = z;
  }

  /** Those who were not there: two, facing the walls; and then all of them, with their backs to you. */
  private arrange(phase: number): void {
    this.phase = phase;
    this.plug.visible = phase === 2;
    const random = randomFrom(61);
    const a = this.menA;
    const b = this.menB;
    if (phase === 0) {
      a.drawn = b.drawn = this.behind.drawn = 0;
      this.first.drawn = 0;
      this.head.drawn = 0;
      return;
    }
    if (phase === 1) {
      a.set(0, 0.58, 0, ROWS[1], Math.PI / 2);
      b.set(0, FAR_LEFT, 0, ROWS[1], -Math.PI / 2);
      a.commit();
      b.commit();
      a.drawn = b.drawn = 1;
      this.behind.drawn = 0;
      this.first.drawn = 0;
      return;
    }
    const place = (i: number, x: number, z: number, heading: number) => {
      const crowd = i % 2 === 0 ? a : b;
      crowd.set(Math.floor(i / 2), x + (random() - 0.5) * 0.02, 0, z + (random() - 0.5) * 0.03, heading + (random() - 0.5) * 0.14, 0.97 + random() * 0.06);
    };
    const right = (row: number) => DOOR_X + SLIT[row] + BODY;
    const left = (row: number) => DOOR_X - SLIT[row] - BODY;
    let i = 0;
    place(i++, right(1), ROWS[1], Math.PI);
    place(i++, FAR_LEFT, ROWS[1], Math.PI);
    place(i++, right(0), ROWS[0], Math.PI);
    place(i++, FAR_LEFT, ROWS[0], Math.PI);
    place(i++, left(1), ROWS[1], Math.PI);
    place(i++, left(2), ROWS[2], Math.PI);
    place(i++, right(2), ROWS[2], Math.PI);
    place(i++, FAR_LEFT, ROWS[2], Math.PI);
    place(i++, left(3), ROWS[3], Math.PI);
    place(i++, right(3), ROWS[3], Math.PI);
    place(i++, FAR_LEFT, ROWS[3], Math.PI);
    // beside you, facing out
    place(i++, FAR_LEFT, YOU_Z, -Math.PI / 2);
    place(i++, 0.6, YOU_Z - 0.02, Math.PI / 2);
    a.commit();
    b.commit();
    a.drawn = Math.ceil(i / 2);
    b.drawn = Math.floor(i / 2);
    [-0.6, -0.17, 0.2, 0.6].forEach((x, k) => this.behind.set(k, x, 0, -0.27, (random() - 0.5) * 0.12, 0.98 + random() * 0.04));
    this.behind.commit();
    this.behind.drawn = 4;
    this.first.drawn = 1;
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const pos = floorAt(s);
    const n = Math.round(pos);
    const off = pos - n;
    const open = 1 - smootherstep(range(DOOR_SHUT[0], DOOR_SHUT[1], s)) + smootherstep(range(DOOR_OUT[0], DOOR_OUT[1], s));
    this.leaf.position.x = DOOR_X + open * LEAF_TRAVEL;

    // behind the door
    const riding = s < RIDE[1];
    const shutDone = s >= DOOR_SHUT[1] - 0.05 && s < DOOR_OUT[0];
    this.shaft.visible = shutDone;
    this.shaft.position.y = off * FLOOR_PERIOD;
    this.corridor.visible = n === 0 && riding;
    this.corridor.position.y = pos * FLOOR_PERIOD;
    const dinner = riding && n >= 1 && n <= 5;
    this.table.visible = dinner;
    if (dinner) {
      this.table.position.y = SET_Y + off * FLOOR_PERIOD * SET_SCALE;
      this.you.root.visible = n <= 1;
      this.child.root.visible = n <= 2;
      this.mother.root.visible = n <= 3;
      this.father.root.visible = n <= 4;
    }
    this.tableLamp.intensity = dinner ? 0.42 : 0;
    this.tableLamp.position.y = this.origin.y + SET_Y + 1.95 * SET_SCALE + off * FLOOR_PERIOD * SET_SCALE;

    // the drum and the button: it follows them down, and stays halfway
    const fell = s - FALL_AT;
    let cell = pos;
    if (fell > 0) {
      const run = pos + (fell * fell * 1.4 + fell * 1.5) * (REDUCED_MOTION ? 0.3 : 1);
      cell = run < FALL_CELL ? run : FALL_CELL + ((run - FALL_CELL) % FALL_CELLS);
    }
    this.drum.offset.y = 1 - (cell + 1) / NUMERALS.length;
    const litRow = clamp(Math.round(pos), 0, 7);
    this.lit.position.y = 1.28 + 0.31 - 0.62 * (0.09 + litRow * 0.094);

    this.updateLight(frame, s, n, off, open);
    this.updateHim(frame, s);
    this.updateThem(s);
    this.updateNeck(s);
    this.updateFall(s, fell);

    this.black = s >= CUT_AT ? 1 : Math.max(blink(s, BLINK_ONE), blink(s, BLINK_TWO));
    this.control.look = s < 46 || s >= FALL_AT;
    for (const c of this.clocks) c.value = frame.time;
    this.movingShadows = (s > DOOR_SHUT[0] && s < DOOR_SHUT[1] + 0.2) || (s > DOOR_OUT[0] && s < DOOR_OUT[1] + 0.2);
  }

  private updateLight(frame: RoomFrame, s: number, n: number, off: number, open: number): void {
    const tube = tubeLevel(s);
    const red = smootherstep(range(RED_ON, RED_ON + 0.45, s)) * (1 + 0.1 * wobble(frame.time * 1.1, 7));
    const flash = s >= FLASH_AT ? Math.exp(-(s - FLASH_AT) * FLASH_DECAY) : 0;
    const fell = range(FALL_AT, FALL_AT + 1, s);

    this.tubeLamp.emissiveIntensity = TUBE_GLOW * tube;
    this.tubeLight.intensity = TUBE_POINT * tube;
    this.tubeLight2.intensity = TUBE_POINT * tube;
    this.tubeSpot.intensity = TUBE_SPOT * tube;
    (this.tubeHalo.uniforms.uColor.value as Color).setHex(0xcfeadf).multiplyScalar(0.22 * tube);

    const redKeeps = red * (1 - fell * 0.55);
    this.redLight.intensity = RED_POINT * redKeeps;
    this.redSpot.intensity = RED_SPOT * redKeeps;
    this.fillLight.intensity = RED_FILL * redKeeps;
    this.bulb.color.setRGB(1, 0.12, 0.05).multiplyScalar(5 * red);
    (this.redHalo.uniforms.uColor.value as Color).setHex(0xff2a12).multiplyScalar(0.34 * red);

    this.spots = flash > 0.04 ? this.flashSpots : s >= RIDE[1] + 0.56 ? this.redSpots : this.tubeSpots;
    this.flashLight.intensity = FLASH_POINT * flash;
    this.flashSpot.intensity = FLASH_SPOT * flash;
    this.film.ghost = s >= FLASH_AT ? 0.5 * (1 - range(FLASH_AT, FLASH_AT + 1.2, s)) : 0;

    // the corridor as long as the door lets it in; the dinner as it goes by
    const gap = s < DOOR_SHUT[1] ? clamp(open, 0, 1) : 0;
    this.corridorLight.intensity = 3.4 * gap;
    this.hallLamp.intensity = s < RIDE[1] ? 8 : 0;
    const pass = n >= 0 && n <= 5 && s < RIDE[1] ? Math.max(0, 1 - Math.abs(off) * 2.2) * (s >= DOOR_SHUT[1] - 0.05 ? 1 : gap < 0.02 ? 1 : 0) : 0;
    (this.portHalo.uniforms.uColor.value as Color).setHex(PALETTE.warm).multiplyScalar(0.22 * pass);

    // the face in a light of its own; the brick wall in its; the fall
    this.faceLight.intensity = FACE_LIGHT * smootherstep(range(HEAD_TURN[0], HEAD_TURN[1], s)) * (1 - range(FLASH_AT, FLASH_AT + 0.1, s));
    this.brickLight.intensity = BRICK_LIGHT * smootherstep(range(DOOR_OUT[0], DOOR_OUT[1], s)) * (s < FALL_AT ? 1 : 0);
    this.fallLight.intensity = fell * FALL_LIGHT * (0.7 + 0.3 * wobble(frame.time * 2.1, 3));

    // the numeral dims with the car, and the intercom's lamp is on only while it speaks
    const numeralLevel = s < RIDE[1] ? 3.2 : lerp(0.4, 2.4, red);
    this.numeral.color.setRGB(1, 0.86, 0.72).multiplyScalar(numeralLevel);
    this.intercomLamp.color.setRGB(1, 0.1, 0.05).multiplyScalar(s > 34.4 && s < 39.7 ? 4 : 0.08);
    if (red > 0) this.moteColor.setRGB(0.36, 0.05, 0.03);
    else this.moteColor.setRGB(0.24, 0.25, 0.23);

    // the grade: cold at first, the red saturated
    const g = this.air.grade;
    g.exposure = lerp(1.2, 1.5, clamp(red, 0, 1));
    g.saturation = lerp(0.82, 1.05, clamp(red, 0, 1));
    g.tint = lerp(-0.04, 0, clamp(red, 0, 1));
    this.film.barrel = 0.03 + 0.12 * fell * (REDUCED_MOTION ? 0 : 1);
    this.film.aberration = 0.0012 + 0.003 * fell * (REDUCED_MOTION ? 0 : 1);
    this.fear = s < RIDE[1] ? 0.3 : s < BLINK_TWO ? 0.5 + ((s - RIDE[1]) / (BLINK_TWO - RIDE[1])) * 0.25 : 0.85;

    // the lens: on the door, then on the face, then on what is at the end of the slit
    let focus = 1.9;
    let aperture = 2.5;
    if (s >= NECK_DOWN[1] - 0.3) {
      focus = lerp(0.38, 2.4, smootherstep(range(HEAD_ASIDE[0], HEAD_ASIDE[1], s)));
      aperture = 3.4;
    } else if (s >= BLINK_TWO) {
      focus = 1.6;
      aperture = 3;
    }
    this.focus = focus;
    this.aperture = s >= FALL_AT ? 1.2 : aperture;
  }

  private updateHim(frame: RoomFrame, s: number): void {
    const gone = s >= BLINK_TWO + 0.05;
    this.hero.root.visible = !gone;
    this.heroShadow.visible = !gone;
    if (gone) return;
    const breath = (1 - Math.cos(((s - BREATH_FROM) / BREATH_PERIOD) * Math.PI * 2)) * 0.5 * range(BREATH_FROM, BREATH_FROM + 0.5, s);
    for (const sh of this.shoulders) sh.bone.quaternion.setFromAxisAngle(sh.axis, breath * SHOULDER_RISE).multiply(sh.base);

    if (s < WATCH[0] || s >= WATCH[1]) return;
    frame.view.getWorldDirection(v1);
    const p = this.hero.root.position;
    this.world(p.x, 1.45, p.z, v2).sub(frame.view.position).normalize();
    if (v1.dot(v2) > WATCH_CONE) {
      this.watched += frame.dt;
      if (this.watched >= WATCH_FOR) this.due = true;
    }
    // the eye that is not looking; a passive one is shown it too
    if ((s > 36.5 && this.step === 0) || (s > BLINK_ONE + 0.02 && this.step === 1)) this.due = true;
    const hidden = this.unseen(frame, p.x, 1.4, p.z, 3) || this.black > 0.95;
    if (this.due && hidden && this.step < STEPS.length - 1) {
      this.step++;
      this.due = false;
      this.watched = 0;
      this.placeHim();
      const turn = STEPS[this.step].turn;
      this.heroHead.quaternion.setFromAxisAngle(this.heroHeadAxis, -turn * 0.85).multiply(this.heroHeadBase);
      this.sound.play('rooms/coat_move.mp3', { gain: 0.3, reverb: 0.1, pan: -0.55 });
    }
  }

  private updateThem(s: number): void {
    const phase = s >= BLINK_TWO + 0.02 ? 2 : s >= BLINK_ONE + 0.02 ? 1 : 0;
    if (phase !== this.phase) this.arrange(phase);
    this.lid.rotation.x = phase === 2 ? 1.75 : 0;
    this.frames++;
    // first under the second blink; then again while the door opens on it, every so often
    const again = s >= DOOR_OUT[0] - 0.1 && s < FLASH_AT && this.frames % PICTURE_EVERY === 0;
    if (phase === 2 && ((!this.pictureTaken && s >= BLINK_TWO + 0.06) || again)) this.takePictureOfYou();
  }

  /** The print on the brick: this lift, these men, you from behind. */
  private takePictureOfYou(): void {
    if (!this.renderPicture) return;
    this.pictureTaken = true;
    const lens = this.pictureLens;
    this.world(DOOR_X + 0.03, 1.66, PICTURE_Z, lens.position);
    lens.lookAt(this.world(DOOR_X, 1.42, -D, v1));
    lens.updateMatrixWorld(true);
    this.behind.root.visible = false;
    this.self.root.visible = true;
    this.renderPicture(this.pictureTarget, lens);
    this.self.root.visible = false;
    this.behind.root.visible = true;
  }

  private updateNeck(s: number): void {
    const shown = s >= BLINK_TWO + 0.02;
    this.neckMesh.visible = shown;
    if (!shown) return;
    const down = smootherstep(range(NECK_DOWN[0], NECK_DOWN[1], s));
    const pulled = range(FALL_AT, FALL_AT + 0.45, s);
    const u = lerp(this.neckBack, 1, down * (1 - pulled * pulled));
    this.neckMesh.geometry.setDrawRange(0, Math.floor(u * this.neckSegments) * 84);
    const aside = smootherstep(range(HEAD_ASIDE[0], HEAD_ASIDE[1], s)) * (1 - pulled);
    this.tipShift.value.set(ASIDE_X * aside, 0, 0);
    const head = this.head;
    const present = s >= NECK_DOWN[0] && u > this.neckBack + 0.002;
    head.drawn = present ? 1 : 0;
    if (!present) return;
    this.curve.getPointAt(Math.max(0, u - 0.004), v3);
    this.curve.getPointAt(u, v1);
    v2.subVectors(v1, v3).normalize();
    v1.addScaledVector(v2, HEAD_ON_NECK);
    v1.x += ASIDE_X * aside;
    q1.setFromUnitVectors(UP, v2);
    const turn = smootherstep(range(HEAD_TURN[0], HEAD_TURN[1], s));
    q2.setFromAxisAngle(UP, Math.PI * (1 - turn) + 0.18 * turn);
    q1.multiply(q2);
    q2.setFromAxisAngle(ACROSS, HEAD_NOD * turn);
    q1.multiply(q2);
    m1.compose(v1, q1, v3.setScalar(1));
    m2.makeTranslation(0, -HEAD_CENTER_Y, 0);
    head.setMatrix(0, m1.multiply(m2));
    head.commit();
  }

  private updateFall(s: number, fell: number): void {
    this.landing.visible = s >= DOOR_OUT[0] && s < FALL_AT + 0.8;
    this.landing.position.y = fell > 0 ? fell * fell * (REDUCED_MOTION ? 3 : 14) : 0;
    const falling = fell > 0 && s < CUT_AT;
    this.dark.visible = s >= DOOR_OUT[0];
    for (const m of this.streaks) m.visible = falling;
    if (!falling) return;
    const run = (fell * fell * 1.6 + fell * 3) * (REDUCED_MOTION ? 0.2 : 1);
    for (const d of this.streakData) {
      const y = ((d.seed + run * d.speed) % STREAK_SPAN) - STREAK_SPAN / 2;
      const p = this.streaks[d.mesh].geometry.getAttribute('position');
      p.setY(d.at, y - d.length / 2);
      p.setY(d.at + 1, y - d.length / 2);
      p.setY(d.at + 2, y + d.length / 2);
      p.setY(d.at + 3, y + d.length / 2);
    }
    for (const m of this.streaks) m.geometry.getAttribute('position').needsUpdate = true;
  }
}
