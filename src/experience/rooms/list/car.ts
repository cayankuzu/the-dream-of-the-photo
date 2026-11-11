import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { SpotSpec } from '../../../config/nightmare.config';
import { meterUVs, type PropCrowd } from '../../dream/DreamKit';
import { randomFrom } from '../../dream/FigureKit';
import type { DreamLight } from '../../dream/LightPool';
import { DEG, range, smootherstep, wobble } from '../../math';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import type { RoomVoice, RoomVoiceOptions } from '../RoomSound';

type V3 = readonly [number, number, number];

/** The beats (s into the room): the radio, its tune dying halfway, the chair, the line, the table and the wipers, the shutter, the hush, the cut. */
const RADIO_ON = 6;
const TUNE_DIES = 9.3;
const CHAIR_SEEN = 9;
const LINE_AT = 13;
const TABLE_FROM = 14;
const SHUTTER_AT = 19;
const HUSH_AT = 21.7;
const CUT_AT = 22.5;

/** How fast the road goes by (m/s): a car feeling its way through fog. */
const SPEED = 4.8;

/** The eye, sitting in the middle of the back seat (m), and the lens (deg) before and after it fixes on the table. */
const EYE: V3 = [0, 1.26, 0.2];
const FOV = 50;
const FOV_TABLE = REDUCED_MOTION ? 50 : 42;
const PITCH = -4;
/**
 * The front of the car: where the bumper is (z, m), where the headlights' light comes from and where it looks. It is
 * set higher than the lamps really are, so that the road takes it and is not only grazed by it.
 */
const BUMPER_Z = -3.6;
const HEAD_AT: V3 = [0, 2.0, -3.4];
const HEAD_TARGET: V3 = [0, 0.15, -26];
const HEAD_POWER = 300;
const HEAD_ANGLE = 26;
const HEAD_COLOR = 0xf3ead2;

/** The road (m): its edges, the lines painted on it, the white posts beside it and how far apart they stand. */
const ROAD_LEFT = -5.3;
const ROAD_RIGHT = 2.1;
const EDGE_RIGHT = 1.85;
const EDGE_LEFT = -5.05;
const CENTER_LINE = -1.6;
const DASH = 3;
const DASH_EVERY = 9;
const POST_RIGHT = 2.55;
const POST_LEFT = -5.75;
const POST_EVERY = 10;
/** Telegraph poles along the far side of the road: where, how far apart, how tall (m). */
const POLE_X = -8.8;
const POLE_EVERY = 30;
const POLE_HEIGHT = 7;
/** Everything that passes is laid along this stretch: from far ahead to behind the car (z, m). */
const ROAD_FAR = -110;
const ROAD_SPAN = 150;
/** Image tiles of the asphalt and of the verge (m). */
const ASPHALT_TILE = 3;
const VERGE_TILE = 2;

/** The car's own small corrections: how far off the road's line it heads (rad), how far the wheel turns for them (rad). */
const HEADING = 0.008;
const WHEEL_TURN = 9 * DEG;
/** The body on its springs: roll (rad), pitch of the bumps (rad), how high they lift it (m). */
const ROLL = REDUCED_MOTION ? 0.001 : 0.0025;
const BUMP_PITCH = REDUCED_MOTION ? 0.0006 : 0.0018;
const BUMP_LIFT = REDUCED_MOTION ? 0.001 : 0.004;
/** The blow of the chair against the bumper: how far the picture dips (rad), how fast it rings (rad/s) and dies (1/s). */
const JOLT = REDUCED_MOTION ? 0.004 : 0.014;
const JOLT_RING = 16;
const JOLT_DIES = 5;

/** The chair in the lane: how far ahead it is when the headlights find it (m), how far right of the car's middle (m), how much larger than life, how it is turned (deg). */
const CHAIR_AHEAD = 13;
const CHAIR_X = 0.1;
const SIZE = 1.15;
const CHAIR_TURN = 8;
/** Half the depth of the chair (m): it is hit when its front reaches the bumper. */
const CHAIR_HALF = 0.3;
/** How it goes under the bonnet: it tips back toward the car (rad) and drops (m) over these seconds round the blow. */
const CHAIR_TIP = 1.35;
const CHAIR_DROP = 0.35;
const CHAIR_GOES: readonly [number, number] = [-0.1, 0.12];
const CHAIR_HIT = CHAIR_SEEN + (CHAIR_AHEAD - (EYE[2] - BUMPER_Z) - CHAIR_HALF) / SPEED;

/**
 * The table: its size in the file (m), and how far its near edge has come in over the bonnet at the cut (m): it is
 * wider than the car and higher than the bonnet, so its top slides in toward the glass and its legs pass the wings.
 */
const TABLE_W = 2.256 * SIZE;
const TABLE_D = 1.39 * SIZE;
const TABLE_TOP = 0.877 * SIZE;
const TABLE_OVER = 0.9;
const TABLE_STOP_Z = BUMPER_Z + TABLE_OVER - TABLE_D / 2;
/** The chairs at the table, from its middle (m) and the way each faces (rad): none on your side. */
const CHAIRS: readonly (readonly [number, number, number])[] = [
  [0, -TABLE_D / 2 - 0.32, 0],
  [-TABLE_W / 2 - 0.3, 0, Math.PI / 2],
  [TABLE_W / 2 + 0.3, 0, -Math.PI / 2],
];
/** Its lamp: how far above the cloth the shade's rim hangs (m), how far up into the shade the bulb is, its light (cd, m). */
const SHADE_ABOVE = 0.45;
const BULB_DROP = 0.06;
const LAMP_COLOR = 0xffb36b;
const LAMP_POWER = 12;
const LAMP_REACH = 8;
/** How fast the lamp comes up when the table is first there (s). */
const LAMP_RISE = 1.2;
/** Its glow: the bulb and the halo the fog makes round it (m across), never smaller than this share of how far away it is. */
const BULB_GLOW = 0.32;
const HALO_GLOW = 1.8;
const BULB_FAR = 0.022;
const HALO_FAR = 0.13;

/** The fog: its colour, how thick, and the lit fog of the headlights as soft layers: meters ahead of the bumper, height, width, height of the glow, strength. */
const FOG_COLOR = 0x090d0e;
const FOG_DENSITY = 0.026;
const LIT_FOG: readonly (readonly [number, number, number, number, number])[] = [
  [2.5, 0.65, 2.6, 0.9, 0.14],
  [6, 0.7, 4.2, 1.4, 0.13],
  [11, 0.75, 6.5, 2.0, 0.1],
  [18, 0.85, 9, 2.8, 0.07],
  [27, 1.0, 13, 3.8, 0.05],
];
const LIT_FOG_COLOR = 0xd9ded2;
/** Droplets of fog that stream through the headlights: how many, the stretch they fill (m), their size, the height of the lamps' axis (m). */
const DROPS = 1400;
const DROP_LENGTH = 24;
const DROP_SIZE = 13;
const BEAM_Y = 0.75;
const DROP_LIGHT = 0.42;

/** Lights in the car (cd, m): the dashboard's green, the fog's glow over the bonnet, the tail lights on the fog behind, the radio's dial. */
const DASH_COLOR = 0x5fd08f;
const DASH_POWER = 0.45;
const DASH_REACH = 2.4;
const SCATTER_COLOR = 0xb9c6bf;
const SCATTER_POWER = 0.9;
const SCATTER_REACH = 4.6;
const TAIL_COLOR = 0xff2a18;
const TAIL_POWER = 0.25;
const TAIL_REACH = 6.5;
const RADIO_COLOR = 0xffa040;
const RADIO_POWER = 0.09;
const RADIO_GLOW = 0.85;
/** What the headlights spill on the verge beside the front of the car, where the posts go by the window (m, cd, m). */
const SPILL_AT: V3 = [2.6, 0.9, -2];
const SPILL_POWER = 0.8;
const SPILL_REACH = 5.5;
/**
 * The headlights give way to the table's lamp as it comes: from the time it is there until a second before the
 * shutter they fall to this share, so that the lamp is the one light in the fog.
 */
const BEAM_LEFT = 0.35;
/** How much light the dials give of their own (emissive). */
const DIALS_GLOW = 0.9;

/** The wipers: one sweep and back (s), how far they swing (rad). */
const WIPE_PERIOD = 1.5;
const WIPE_SWEEP = 100 * DEG;

/** The kitchen window in the mirror: how wide at first and at the end (m). */
const WINDOW_NEAR = 0.034;
const WINDOW_FAR = 0.005;

/** The materials of an old car: vinyl, the pale roof lining, the dashboard, chrome, the paint. */
const VINYL = '#2c1714';
const LINING = '#5d584c';
const DASH_BLACK = 0x121110;
const CHROME = 0x9a9893;
const PAINT = 0x1a2320;

/** Gains of the beds (see ROOM_SOUNDS.md for each file's own level). */
const ENGINE_GAIN = 0.16;
const ROAD_GAIN = 0.11;
const WIND_GAIN = 0.07;
const DRONE_GAIN = 0.1;
const HULL_GAIN = 0.05;
const TUNE_GAIN = 0.17;
const HISS_GAIN = 0.035;

/** One-shots on their beats: second, file, how. The chair under the car, then the plates in the black. */
const CUES: readonly (readonly [number, string, RoomVoiceOptions])[] = [
  [RADIO_ON, 'rooms/intercom_crackle_1.mp3', { gain: 0.2, pan: 0.05, lowpass: 3000 }],
  [10.15, 'rooms/heart_beat.mp3', { gain: 0.22 }],
  [CHAIR_HIT, 'rooms/board_crack_2.mp3', { gain: 0.5, pan: 0.05 }],
  [CHAIR_HIT + 0.05, 'rooms/board_crack_1.mp3', { gain: 0.36, pan: -0.12 }],
  [CHAIR_HIT + 0.1, 'rooms/duct_thud_2.mp3', { gain: 0.42, lowpass: 500 }],
  [CHAIR_HIT + 0.2, 'rooms/wood_snap_small_2.mp3', { gain: 0.3, pan: 0.25 }],
  [CHAIR_HIT + 0.35, 'rooms/chair_scrape_floor.mp3', { gain: 0.2, offset: 0.4, duration: 0.9, lowpass: 1300 }],
  [CUT_AT, 'rooms/stop_thud.mp3', { gain: 0.7 }],
  [CUT_AT + 0.02, 'rooms/plate_clink_1.mp3', { gain: 0.5, pan: -0.2 }],
  [CUT_AT + 0.03, 'rooms/metal_crash_2.mp3', { gain: 0.28, lowpass: 2200 }],
  [CUT_AT + 0.04, 'rooms/glass_crack_1.mp3', { gain: 0.35, pan: 0.1 }],
  [CUT_AT + 0.07, 'rooms/plate_clink_3.mp3', { gain: 0.45, rate: 0.9, pan: 0.3 }],
  [CUT_AT + 0.1, 'rooms/plate_set_2.mp3', { gain: 0.45, rate: 0.8 }],
  [CUT_AT + 0.18, 'rooms/plate_clink_2.mp3', { gain: 0.4, rate: 1.15, pan: -0.5 }],
  [CUT_AT + 0.26, 'rooms/glass_set_1.mp3', { gain: 0.3, pan: 0.45 }],
  [CUT_AT + 0.35, 'rooms/plate_clink_4.mp3', { gain: 0.35, rate: 0.85, pan: 0.6, reverb: 0.2 }],
  [CUT_AT + 0.5, 'rooms/glass_set_2.mp3', { gain: 0.22, pan: -0.6, reverb: 0.2 }],
  [CUT_AT + 1.0, 'rooms/fork_plate_3.mp3', { gain: 0.24, pan: 0.15, reverb: 0.35 }],
];
const BEDS = ['rooms/bus_idle.mp3', 'rooms/gurney_rumble.mp3', 'rooms/wind_in_ears.mp3', 'rooms/dream_drone_low.mp3', 'rooms/cable_hum.mp3', 'rooms/lift_tune_loop.mp3', 'rooms/intercom_static.mp3', 'rooms/clock_tick.mp3'];
const SQUEAK = 'rooms/palm_on_glass_1.mp3';

export const assets: RoomAssets = {
  models: ['chair_ladder', 'dining_table', 'hanging_lamp', 'plate', 'fork', 'knife', 'tumbler', 'pot_enamel', 'buns'],
  materials: ['asphalt', 'grass_meadow', 'carpet_dirty'],
  sounds: [...new Set(CUES.map((c) => c[1])), ...BEDS, SQUEAK],
};

const ramp = (a: number, b: number, v: number): number => smootherstep(range(a, b, v));
const wrap = (v: number, span: number): number => v - Math.floor(v / span) * span;

/** How far the car heads off the road's line (rad), where that has taken it across the lane (m), and the wheel that did it (rad). */
const heading = (s: number): number => HEADING * (0.6 * Math.sin(s * 0.47 + 0.3) + 0.4 * Math.sin(s * 1.13 + 2.1));
const aside = (s: number): number => SPEED * HEADING * (-(0.6 / 0.47) * Math.cos(s * 0.47 + 0.3) - (0.4 / 1.13) * Math.cos(s * 1.13 + 2.1));
const wheel = (s: number): number => WHEEL_TURN * ((0.6 * 0.47 * Math.cos(s * 0.47 + 0.3) + 0.4 * 1.13 * Math.cos(s * 1.13 + 2.1)) / 0.734 + 0.12 * wobble(s * 1.7, 4));

/** The wipers' swing (rad from where they lie): up, back, a breath at the bottom; the first sweep starts slowly. */
function wipe(s: number): number {
  if (s < TABLE_FROM) return 0;
  const c = (s - TABLE_FROM) / WIPE_PERIOD;
  const f = c - Math.floor(c);
  const swing = smootherstep(range(0, 0.45, f)) - smootherstep(range(0.45, 0.9, f));
  return WIPE_SWEEP * swing * (c < 1 ? 0.92 + 0.08 * c : 1);
}

function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Pleated vinyl, rolled between seams, scuffed pale where people sat and slid. */
function drawVinyl(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(5);
  const pleats = 8;
  const pleat = w / pleats;
  c.fillStyle = VINYL;
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < pleats; i++) {
    const x0 = i * pleat;
    const g = c.createLinearGradient(x0, 0, x0 + pleat, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.6)');
    g.addColorStop(0.18, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(255,225,205,0.07)');
    g.addColorStop(0.82, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.6)');
    c.fillStyle = g;
    c.fillRect(x0, 0, pleat, h);
    // the stitches of the seam
    c.fillStyle = 'rgba(0,0,0,0.75)';
    for (let y = 0; y < h; y += 7) c.fillRect(x0 - 1, y, 2, 4);
  }
  // years of people: pale scuffs, fine cracks, darker where hands went
  for (let i = 0; i < 60; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = (0.01 + random() * 0.05) * w;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    const pale = random() < 0.55;
    const a = 0.04 + random() * (pale ? 0.07 : 0.18);
    g.addColorStop(0, pale ? `rgba(200,170,150,${a})` : `rgba(0,0,0,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  c.strokeStyle = 'rgba(170,140,120,0.16)';
  c.lineWidth = 1;
  for (let i = 0; i < 46; i++) {
    let x = random() * w;
    let y = random() * h;
    c.beginPath();
    c.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (random() - 0.5) * 14;
      y += (random() - 0.5) * 14;
      c.lineTo(x, y);
    }
    c.stroke();
  }
}

/** The roof lining: pale perforated vinyl gone the colour of smoke, the bows that hold it, water stains. */
function drawLining(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(9);
  c.fillStyle = LINING;
  c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(0,0,0,0.3)';
  for (let y = 3; y < h; y += 7) for (let x = (y % 14 === 3 ? 3 : 6.5); x < w; x += 7) c.fillRect(x, y, 1.6, 1.6);
  for (let i = 0; i < 9; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = (0.05 + random() * 0.16) * w;
    const g = c.createRadialGradient(x, y, r * 0.5, x, y, r);
    g.addColorStop(0, 'rgba(70,52,30,0.18)');
    g.addColorStop(0.85, 'rgba(60,42,22,0.32)');
    g.addColorStop(1, 'rgba(60,42,22,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // a bow across the car every third of a meter
  for (let y = 0; y < h; y += h / 3) {
    const g = c.createLinearGradient(0, y - 10, 0, y + 10);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, y - 10, w, 20);
  }
}

/** The dials behind the wheel, lit green from inside: the speed, the fuel at half, and a clock that says half past six. */
function drawDials(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#000';
  c.fillRect(0, 0, w, h);
  const green = '#7dffb0';
  const dim = 'rgba(125,255,176,0.35)';
  const dial = (cx: number, r: number, from: number, to: number, ticks: number, needle: number) => {
    const g = c.createRadialGradient(cx, h / 2, 0, cx, h / 2, r * 1.05);
    g.addColorStop(0, 'rgba(40,120,80,0.32)');
    g.addColorStop(1, 'rgba(10,40,24,0.2)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(cx, h / 2, r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = dim;
    c.lineWidth = r * 0.04;
    c.stroke();
    c.strokeStyle = green;
    for (let i = 0; i <= ticks; i++) {
      const a = from + ((to - from) * i) / ticks;
      const inner = i % 2 ? 0.8 : 0.72;
      c.lineWidth = i % 2 ? r * 0.025 : r * 0.045;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r * inner, h / 2 + Math.sin(a) * r * inner);
      c.lineTo(cx + Math.cos(a) * r * 0.9, h / 2 + Math.sin(a) * r * 0.9);
      c.stroke();
    }
    c.strokeStyle = '#ffffff';
    c.lineWidth = r * 0.05;
    c.beginPath();
    c.moveTo(cx, h / 2);
    c.lineTo(cx + Math.cos(needle) * r * 0.78, h / 2 + Math.sin(needle) * r * 0.78);
    c.stroke();
  };
  const r = h * 0.44;
  // speed: a car crawling through fog
  dial(w * 0.27, r, Math.PI * 0.75, Math.PI * 2.25, 16, Math.PI * 0.75 + Math.PI * 1.5 * 0.12);
  // fuel: exactly half
  dial(w * 0.62, r * 0.62, Math.PI, Math.PI * 2, 4, Math.PI * 1.5);
  // the clock: half past six
  const cx = w * 0.84;
  const cr = r * 0.62;
  c.strokeStyle = dim;
  c.lineWidth = cr * 0.05;
  c.beginPath();
  c.arc(cx, h / 2, cr, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = green;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    c.fillRect(cx + Math.cos(a) * cr * 0.8 - 1.5, h / 2 + Math.sin(a) * cr * 0.8 - 1.5, 3, 3);
  }
  c.strokeStyle = '#ffffff';
  c.lineCap = 'round';
  c.lineWidth = cr * 0.09;
  for (const [a, l] of [[Math.PI * 0.5 + Math.PI / 12, 0.5], [Math.PI * 0.5, 0.78]] as const) {
    c.beginPath();
    c.moveTo(cx, h / 2);
    c.lineTo(cx + Math.cos(a) * cr * l, h / 2 + Math.sin(a) * cr * l);
    c.stroke();
  }
}

/** The radio's face: a dark bezel, the dial window with its stations, a red needle halfway along. */
function drawRadio(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#0b0b0a';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#ff9a3a';
  c.fillRect(w * 0.2, h * 0.28, w * 0.6, h * 0.44);
  c.fillStyle = '#3a1a04';
  c.font = `bold ${Math.round(h * 0.16)}px monospace`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const stations = ['54', '60', '70', '80', '100', '120', '140', '160'];
  stations.forEach((label, i) => {
    const x = w * (0.24 + (0.52 * i) / (stations.length - 1));
    c.fillText(label, x, h * 0.42);
    c.fillRect(x - 0.5, h * 0.54, 1, h * 0.12);
  });
  c.fillStyle = '#c0140a';
  c.fillRect(w * 0.5 - 1, h * 0.28, 2.5, h * 0.44);
  // the two knobs, only their rims catch the light
  c.strokeStyle = '#2a2a28';
  c.lineWidth = h * 0.05;
  for (const x of [0.1, 0.9]) {
    c.beginPath();
    c.arc(w * x, h / 2, h * 0.26, 0, Math.PI * 2);
    c.stroke();
  }
}

/** The mirror: the road behind in the dark, its edges going back, the red of the tail lights on the fog. */
function drawMirror(c: CanvasRenderingContext2D, w: number, h: number): void {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0c1215');
  g.addColorStop(0.55, '#182024');
  g.addColorStop(1, '#2a0d0a');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  const red = c.createRadialGradient(w * 0.5, h * 1.05, 0, w * 0.5, h * 1.05, w * 0.42);
  red.addColorStop(0, 'rgba(170,30,16,0.35)');
  red.addColorStop(1, 'rgba(150,24,12,0)');
  c.fillStyle = red;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(150,150,140,0.3)';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(w * 0.1, h);
  c.lineTo(w * 0.47, h * 0.52);
  c.moveTo(w * 0.92, h);
  c.lineTo(w * 0.55, h * 0.52);
  c.stroke();
}

/** The kitchen window of the house, lit, as small as it is in a mirror: four panes and a curtain half drawn. */
function drawWindow(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#ffb35c';
  c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(255,230,180,0.6)';
  c.fillRect(w * 0.55, 0, w * 0.45, h);
  c.fillStyle = '#2a1205';
  c.fillRect(0, h * 0.46, w, h * 0.08);
  c.fillRect(w * 0.46, 0, w * 0.08, h);
  c.lineWidth = w * 0.1;
  c.strokeStyle = '#1a0c04';
  c.strokeRect(0, 0, w, h);
  // three heads at the table, seen as shadows
  c.fillStyle = 'rgba(40,16,4,0.7)';
  for (const x of [0.2, 0.36, 0.72]) {
    c.beginPath();
    c.arc(w * x, h * 0.74, w * 0.06, 0, Math.PI * 2);
    c.fill();
  }
}

/** A quad from four corners (counter-clockwise seen from where it faces). */
function quad(a: V3, b: V3, c: V3, d: V3): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([...a, ...b, ...c, ...d]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return meterUVs(g);
}

/** Pieces of one material as one mesh (the rounded boxes come unindexed, so all of them go so). */
function merged(parts: readonly BufferGeometry[]): BufferGeometry {
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

/** A grid bent by `shape` (u across, v along, both 0..1, giving a point): for the roof and the bonnet. */
function sheet(cols: number, rows: number, shape: (u: number, v: number) => V3): BufferGeometry {
  const positions: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) positions.push(...shape(i / cols, j / rows));
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      index.push(a, a + 1, a + cols + 2, a, a + cols + 2, a + cols + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return meterUVs(g);
}

const DROP_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTravel;
varying float vLight;
void main() {
  vec3 p = position;
  // the fog stands still on the road: it streams past the car
  float ahead = mod(p.z + uTravel, ${DROP_LENGTH.toFixed(1)});
  float d = ${DROP_LENGTH.toFixed(1)} - ahead;
  p.z = ${BUMPER_Z.toFixed(3)} - d;
  p.x += 0.12 * sin(uTravel * 0.21 + aSeed * 31.0);
  p.y += 0.08 * sin(uTravel * 0.17 + aSeed * 17.0);
  // lit only inside the headlights' cone, dimmer the further it is
  float reach = 0.4 + d * ${Math.tan(HEAD_ANGLE * DEG).toFixed(4)};
  float axis = ${BEAM_Y.toFixed(3)} - d * 0.02;
  float off = length(vec2(p.x / 1.4, p.y - axis));
  float beam = 1.0 - smoothstep(0.3 * reach, reach, off);
  float fade = smoothstep(0.3, 2.2, d) * (1.0 - smoothstep(${(DROP_LENGTH * 0.55).toFixed(1)}, ${DROP_LENGTH.toFixed(1)}, d));
  vLight = beam * fade / (1.0 + 0.012 * d * d) * (0.45 + 0.55 * fract(aSeed * 7.31));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(${DROP_SIZE.toFixed(1)} / max(0.5, -mv.z), 1.0, 3.2);
}`;

const DROP_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vLight;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  gl_FragColor = vec4(uColor * vLight * max(0.0, 1.0 - d * d), 1.0);
}`;

const m4 = new Matrix4();
const euler = new Euler();
const turn = new Quaternion();
const spot = new Vector3();
const ONE = new Vector3(1, 1, 1);
const NONE = new Vector3(0, 0, 0);
const tint = new Color();
const lampAt = new Vector3();

/**
 * The back seat of an old car at night on a straight road in fog. Nobody is in front; the wheel makes its own small
 * corrections. The radio plays the lift's tune and stops halfway; the headlights find a dining chair in the lane and
 * the car goes through it. Far ahead a table laid for four comes out of the fog with its lamp on, and the wipers
 * start by themselves. The picture is cut to black on the instant before the table is hit.
 */
export default class Car extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: FOG_COLOR, density: FOG_DENSITY },
    env: 'evening',
    envIntensity: 0.1,
    sky: 0,
    grade: { exposure: 1.12, saturation: 0.85, warmth: 0.02, tint: -0.02, flare: 0.004 },
  };
  film = { bloom: 0.7, bloomFrom: 0.85, bloomTint: [1, 0.86, 0.66] as const, grain: 0.42, scratches: 0.04, flicker: 0.02, weave: REDUCED_MOTION ? 0 : 0.0003, aberration: 0.1 };
  focus = 9;
  aperture = 1.6;
  drift = REDUCED_MOTION ? 0 : 0.25;
  fear = 0.3;
  control = { look: true, scroll: true, hurry: 1.6 };

  /** The car and all that moves with it; inside it, the world that goes by. */
  private readonly rig = new Group();
  private readonly cabin = new Group();
  private readonly outside = new Group();
  private readonly roadMaps: Texture[] = [];
  private readonly vergeMaps: Texture[] = [];
  private readonly posts: InstancedMesh;
  private readonly frontEyes: InstancedMesh;
  private readonly backEyes: InstancedMesh;
  private readonly dashes: InstancedMesh;
  private readonly poles: InstancedMesh;
  private readonly passing: readonly InstancedMesh[];
  /** A post's body, its band and its two reflectors. */
  private readonly postParts: readonly InstancedMesh[];
  /** The three chairs at the table, and the fourth, in the lane. */
  private readonly chairs: PropCrowd;
  private readonly table = new Group();
  private readonly wheelSpin = new Group();
  private readonly wipers: Group[] = [];
  private readonly keyPivot = new Group();
  private readonly mirrorWindow = new Group();
  private readonly radioFace: MeshStandardMaterial;
  private readonly lampGlow: Mesh[] = [];
  private readonly litFog: ShaderMaterial[] = [];
  private readonly lampBeam: ShaderMaterial;
  private readonly drops = { uTravel: { value: 0 }, uColor: { value: new Color() } };
  private readonly motes: { value: number }[] = [];
  private readonly head: SpotSpec;
  private readonly lamp: DreamLight;
  private readonly radioLight: DreamLight;
  private readonly spill: DreamLight;
  private engine: RoomVoice | null = null;
  private road: RoomVoice | null = null;
  private wind: RoomVoice | null = null;
  private drone: RoomVoice | null = null;
  private hull: RoomVoice | null = null;
  private tune: RoomVoice | null = null;
  private hiss: RoomVoice | null = null;
  private clock: RoomVoice | null = null;

  constructor(ctx: RoomContext) {
    super(ctx);
    const t = (s: number) => s / this.seconds;
    this.keys = [
      { t: 0, at: EYE, yaw: 0, pitch: PITCH, fov: FOV },
      { t: t(TABLE_FROM), at: EYE, yaw: 0, pitch: PITCH, fov: FOV },
      { t: t(SHUTTER_AT), at: EYE, yaw: 0, pitch: PITCH + 0.6, fov: FOV_TABLE + 1 },
      { t: t(CUT_AT), at: EYE, yaw: 0, pitch: PITCH + 0.8, fov: FOV_TABLE },
      { t: 1, at: EYE, yaw: 0, pitch: PITCH + 0.8, fov: FOV_TABLE },
    ];

    // the rig turns about the eye, so that a jolt is felt where you sit
    this.rig.position.set(EYE[0], EYE[1], EYE[2]);
    const inner = new Group();
    inner.position.set(-EYE[0], -EYE[1], -EYE[2]);
    this.rig.add(inner);
    inner.add(this.cabin, this.outside);
    this.root.add(this.rig);

    this.buildCabin();
    this.radioFace = this.buildDash();
    this.buildMirror();
    this.buildWipers();
    this.buildRoad();
    const passing = this.buildPosts();
    this.posts = passing.posts;
    this.frontEyes = passing.front;
    this.backEyes = passing.back;
    this.dashes = passing.dashes;
    this.poles = passing.poles;
    this.postParts = [this.posts, passing.band, this.frontEyes, this.backEyes];
    this.passing = [...this.postParts, this.dashes, this.poles];
    this.chairs = this.kit.props('chair_ladder', CHAIRS.length + 1, { scale: SIZE, castShadow: true });
    this.outside.add(this.chairs.root);
    this.lampBeam = this.buildTable();
    this.buildFog();

    this.head = this.spot(HEAD_AT, HEAD_TARGET, HEAD_COLOR, HEAD_POWER, HEAD_ANGLE, 0.55);
    this.spots = [this.head, null, null];
    this.light([-0.3, 0.98, -1.3], DASH_COLOR, DASH_POWER, DASH_REACH);
    this.light([0, 1.5, -2.5], SCATTER_COLOR, SCATTER_POWER, SCATTER_REACH);
    this.light([0, 1.5, 3.6], TAIL_COLOR, TAIL_POWER, TAIL_REACH);
    this.radioLight = this.light([0, 0.78, -1.2], RADIO_COLOR, 0, 0.7);
    this.spill = this.light(SPILL_AT, HEAD_COLOR, SPILL_POWER, SPILL_REACH);
    this.lamp = this.light([0, 0, -60], LAMP_COLOR, 0, LAMP_REACH);
    this.motes.push(this.build.motes(70, { x: [-0.62, 0.62], y: [0.45, 1.36], z: [-1.5, 0.75] }, this.cabin, { size: 0.0035, color: 0xc8d8cc, strength: 0.22, seed: 7 }).time);

    this.sounds();
  }

  /** Seats, doors, floor, roof, pillars and glass: everything of the inside but the dashboard. */
  private buildCabin(): void {
    const vinylMap = canvasTexture(512, 512, drawVinyl);
    vinylMap.repeat.setScalar(1 / 0.48);
    // double sided like the lining, so that the two share one shader
    const vinyl = new MeshStandardMaterial({ map: vinylMap, roughness: 0.42, metalness: 0, side: DoubleSide });
    const liningMap = canvasTexture(512, 512, drawLining);
    liningMap.repeat.setScalar(1);
    const lining = new MeshStandardMaterial({ map: liningMap, roughness: 0.92, metalness: 0, side: DoubleSide });
    const carpet = this.kit.surface('carpet_dirty', 0.6, { color: new Color(0x6a5a52) });
    const chrome = new MeshStandardMaterial({ color: CHROME, roughness: 0.22, metalness: 1 });
    // old glass only takes a little light away: it must never add any
    const glass = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.14, depthWrite: false, side: DoubleSide });
    const paint = new MeshStandardMaterial({ color: PAINT, roughness: 0.3, metalness: 0.45 });

    const at = (g: BufferGeometry, p: V3, rx = 0, ry = 0, rz = 0): BufferGeometry => g.applyMatrix4(m4.makeRotationFromEuler(euler.set(rx, ry, rz, 'YXZ')).setPosition(p[0], p[1], p[2]));
    const slab = (w: number, h: number, d: number, r: number) => meterUVs(new RoundedBoxGeometry(w, h, d, 3, r));
    const box = (w: number, h: number, d: number) => meterUVs(new BoxGeometry(w, h, d));

    // the seats: two in front, the bench you sit on, the door panels and their arm rests
    const seats: BufferGeometry[] = [];
    for (const x of [-0.37, 0.37]) {
      seats.push(at(slab(0.5, 0.15, 0.52, 0.05), [x, 0.53, -0.88]));
      seats.push(at(slab(0.5, 0.5, 0.11, 0.05), [x, 0.83, -0.6], 0.2));
    }
    seats.push(at(slab(1.3, 0.16, 0.52, 0.05), [0, 0.5, 0.2]));
    seats.push(at(slab(1.32, 0.48, 0.12, 0.05), [0, 0.82, 0.6], 0.35));
    for (const side of [-1, 1]) {
      seats.push(at(box(0.04, 0.62, 2.56), [side * 0.71, 0.61, -0.35]));
      seats.push(at(slab(0.07, 0.05, 0.3, 0.02), [side * 0.665, 0.72, 0.15]));
      seats.push(at(slab(0.07, 0.05, 0.3, 0.02), [side * 0.665, 0.72, -0.95]));
    }
    this.cabin.add(this.mesh(merged(seats), vinyl));

    // the floor, the tunnel down its middle, the shelf under the rear window
    const floor: BufferGeometry[] = [
      at(box(1.44, 0.02, 2.62), [0, 0.29, -0.35]),
      at(slab(0.26, 0.14, 1.6, 0.05), [0, 0.36, -0.85]),
      at(box(1.4, 0.03, 0.56), [0, 0.965, 0.93]),
    ];
    this.cabin.add(this.mesh(merged(floor), carpet));

    // the roof, bowed, and its lining down the pillars: the header over the windscreen, the B and C pillars
    const lined: BufferGeometry[] = [
      sheet(8, 6, (u, v) => {
        const x = (u - 0.5) * 1.42;
        return [x, 1.4 + 0.035 * (1 - (x / 0.71) ** 2), 0.8 - v * 1.84];
      }),
      at(box(1.34, 0.05, 0.06), [0, 1.395, -1.0]),
    ];
    for (const side of [-1, 1]) {
      lined.push(at(box(0.07, 0.06, 0.78), [side * 0.645, 1.19, -1.32], -33.2 * DEG));
      lined.push(at(box(0.04, 0.5, 0.08), [side * 0.675, 1.16, -0.3], 0, 0, side * 6 * DEG));
      lined.push(quad([side * 0.7, 0.92, side > 0 ? 1.22 : 0.6], [side * 0.7, 0.92, side > 0 ? 0.6 : 1.22], [side * 0.65, 1.4, side > 0 ? 0.52 : 0.82], [side * 0.65, 1.4, side > 0 ? 0.82 : 0.52]));
      // the rear window's frame, either side
      lined.push(quad([side * 0.6, 0.98, 1.2], [side * 0.7, 0.98, 1.2], [side * 0.68, 1.4, 0.8], [side * 0.58, 1.38, 0.78]));
    }
    // the firewall under the dashboard
    lined.push(at(box(1.44, 0.44, 0.02), [0, 0.5, -1.67]));
    this.cabin.add(this.mesh(merged(lined), lining));

    // chrome: the belt lines, the door handles and window cranks, the gear lever
    const bright: BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      bright.push(at(box(0.015, 0.012, 2.5), [side * 0.69, 0.925, -0.36]));
      for (const z of [-0.75, 0.35]) {
        bright.push(at(box(0.02, 0.025, 0.11), [side * 0.685, 0.8, z]));
        bright.push(at(meterUVs(new CylinderGeometry(0.035, 0.035, 0.012, 16)), [side * 0.685, 0.6, z + 0.12], 0, 0, Math.PI / 2));
      }
    }
    bright.push(at(meterUVs(new CylinderGeometry(0.006, 0.008, 0.32, 8)), [0, 0.58, -1.12], -0.25));
    this.cabin.add(this.mesh(merged(bright), chrome));
    // the dome light over the back seat, off
    const dome = this.mesh(meterUVs(new RoundedBoxGeometry(0.2, 0.03, 0.09, 2, 0.012)), new MeshStandardMaterial({ color: 0x3d3a33, roughness: 0.8 }));
    dome.position.set(0, 1.405, -0.12);
    this.cabin.add(dome);
    const knob = this.mesh(meterUVs(new RoundedBoxGeometry(0.045, 0.045, 0.045, 2, 0.02)), new MeshStandardMaterial({ color: DASH_BLACK, roughness: 0.3 }));
    knob.position.set(0, 0.74, -1.08);
    this.cabin.add(knob);

    // glass: the windscreen, the side windows, the rear window
    const panes: BufferGeometry[] = [
      quad([-0.66, 0.98, -1.64], [0.66, 0.98, -1.64], [0.61, 1.4, -1.0], [-0.61, 1.4, -1.0]),
      quad([0.6, 0.98, 1.2], [-0.6, 0.98, 1.2], [-0.58, 1.38, 0.78], [0.58, 1.38, 0.78]),
    ];
    for (const side of [-1, 1]) {
      panes.push(quad([side * 0.7, 0.92, -1.6], [side * 0.7, 0.92, -0.34], [side * 0.65, 1.4, -0.34], [side * 0.65, 1.4, -1.0]));
      panes.push(quad([side * 0.7, 0.92, -0.26], [side * 0.7, 0.92, 0.6], [side * 0.65, 1.4, 0.52], [side * 0.65, 1.4, -0.26]));
    }
    const glassMesh = this.mesh(merged(panes), glass);
    glassMesh.renderOrder = 2;
    this.cabin.add(glassMesh);

    // outside: the long bonnet with its crown and the wings falling away, the boot lid behind
    const body: BufferGeometry[] = [
      sheet(10, 10, (u, v) => {
        const x = (u - 0.5) * 1.66;
        const side = smootherstep(range(0.66, 0.83, Math.abs(x)));
        const nose = smootherstep(range(0.9, 1, v));
        return [x, 0.95 - 0.18 * v ** 1.3 + 0.03 * (1 - (x / 0.83) ** 2) - 0.07 * side - 0.08 * nose, -1.66 - v * 1.95];
      }),
      // laid the other way across, so that it faces up as it runs back
      sheet(8, 4, (u, v) => {
        const x = (0.5 - u) * 1.62;
        return [x, 0.975 - 0.08 * v + 0.02 * (1 - (x / 0.81) ** 2) - 0.06 * smootherstep(range(0.66, 0.81, Math.abs(x))), 1.22 + v * 0.95];
      }),
    ];
    this.cabin.add(this.mesh(merged(body), paint));
  }

  /** The dashboard: its pad, the hood over the dials, the dials, the radio, the wheel on its column. Returns the radio's face. */
  private buildDash(): MeshStandardMaterial {
    const black = new MeshStandardMaterial({ color: DASH_BLACK, roughness: 0.55, metalness: 0 });
    const at = (g: BufferGeometry, p: V3, rx = 0): BufferGeometry => g.applyMatrix4(m4.makeRotationFromEuler(euler.set(rx, 0, 0, 'YXZ')).setPosition(p[0], p[1], p[2]));
    const parts = [
      at(meterUVs(new RoundedBoxGeometry(1.44, 0.24, 0.36, 3, 0.04)), [0, 0.83, -1.47]),
      at(meterUVs(new RoundedBoxGeometry(0.46, 0.07, 0.17, 3, 0.03)), [-0.37, 0.965, -1.36]),
      at(meterUVs(new CylinderGeometry(0.03, 0.04, 0.4, 12)), [-0.37, 0.86, -1.27], 1.1),
    ];
    this.cabin.add(this.mesh(merged(parts), black));
    const trim = this.mesh(meterUVs(new BoxGeometry(0.78, 0.012, 0.01)), new MeshStandardMaterial({ color: CHROME, roughness: 0.25, metalness: 1 }));
    trim.position.set(0.3, 0.9, -1.287);
    this.cabin.add(trim);

    const dials = this.build.label(0.4, 0.105, drawDials, { px: 1100, emissive: DIALS_GLOW });
    dials.mesh.position.set(-0.37, 0.885, -1.292);
    dials.mesh.rotation.x = -10 * DEG;
    this.cabin.add(dials.mesh);
    const radio = this.build.label(0.19, 0.05, drawRadio, { px: 1400, emissive: 1 });
    radio.mesh.position.set(0, 0.79, -1.286);
    this.cabin.add(radio.mesh);
    const face = radio.mesh.material as MeshStandardMaterial;
    face.emissiveIntensity = 0;

    // the wheel: tilted toward the empty seat, a thin bakelite rim, three spokes, a chrome horn ring
    const bakelite = new MeshStandardMaterial({ color: 0x0d0c0b, roughness: 0.32, metalness: 0 });
    const tilt = new Group();
    tilt.position.set(-0.37, 1.0, -1.13);
    tilt.rotation.x = -25 * DEG;
    const rim: BufferGeometry[] = [meterUVs(new TorusGeometry(0.19, 0.013, 10, 48)), meterUVs(new CylinderGeometry(0.035, 0.035, 0.05, 16).rotateX(Math.PI / 2))];
    for (const a of [-90, 30, 150]) rim.push(meterUVs(new BoxGeometry(0.17, 0.016, 0.008)).translate(0.1, 0, -0.01).rotateZ(a * DEG));
    this.wheelSpin.add(this.mesh(merged(rim), bakelite));
    const horn = this.mesh(new TorusGeometry(0.1, 0.004, 6, 40), new MeshStandardMaterial({ color: CHROME, roughness: 0.25, metalness: 1 }));
    horn.position.z = 0.012;
    this.wheelSpin.add(horn);
    tilt.add(this.wheelSpin);
    this.cabin.add(tilt);
    return face;
  }

  /** The rear-view mirror on its stem, what it shows, and the house key that hangs from it on a string. */
  private buildMirror(): void {
    const black = new MeshStandardMaterial({ color: DASH_BLACK, roughness: 0.4 });
    const mirror = new Group();
    mirror.position.set(0, 1.335, -1.0);
    mirror.rotation.y = -10 * DEG;
    const housing = this.mesh(meterUVs(new RoundedBoxGeometry(0.255, 0.075, 0.035, 3, 0.015)), black);
    mirror.add(housing);
    const stem = this.mesh(new CylinderGeometry(0.007, 0.007, 0.09, 8), black);
    stem.position.set(0, 0.045, -0.02);
    mirror.add(stem);
    const face = this.build.label(0.235, 0.058, drawMirror, { px: 1400, emissive: 0.9 });
    face.mesh.position.z = 0.0185;
    mirror.add(face.mesh);
    // the house, behind, in the mirror: getting smaller
    const pane = this.build.label(1, 0.72, drawWindow, { px: 72, emissive: 3 });
    this.mirrorWindow.add(pane.mesh);
    this.build.glow(0, 0, 0.002, 1.8, 0xffa050, 0.5, this.mirrorWindow, 2.2);
    this.mirrorWindow.position.set(0.02, -0.006, 0.019);
    mirror.add(this.mirrorWindow);
    this.cabin.add(mirror);

    // the key: an old house key, its bow on a string
    const iron = new MeshStandardMaterial({ color: 0x1b1a18, roughness: 0.45, metalness: 0.8 });
    const string = this.mesh(new CylinderGeometry(0.0012, 0.0012, 0.07, 5).translate(0, -0.035, 0), new MeshStandardMaterial({ color: 0x5a1610, roughness: 0.9 }));
    this.keyPivot.add(string);
    const key: BufferGeometry[] = [
      meterUVs(new TorusGeometry(0.012, 0.0032, 8, 20)).translate(0, -0.082, 0),
      meterUVs(new CylinderGeometry(0.0028, 0.0028, 0.06, 8)).translate(0, -0.124, 0),
      meterUVs(new BoxGeometry(0.014, 0.012, 0.003)).translate(0.007, -0.146, 0),
      meterUVs(new BoxGeometry(0.008, 0.005, 0.003)).translate(0.006, -0.135, 0),
    ];
    this.keyPivot.add(this.mesh(merged(key), iron));
    this.keyPivot.position.set(-0.09, 1.3, -0.995);
    this.cabin.add(this.keyPivot);
  }

  /** Two wipers lying along the foot of the windscreen, outside it. */
  private buildWipers(): void {
    const glassFrame = new Group();
    glassFrame.position.set(0, 0.98, -1.64);
    glassFrame.rotation.x = 56.8 * DEG;
    const metal = new MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.5, metalness: 0.6 });
    const arm = merged([meterUVs(new BoxGeometry(0.42, 0.012, 0.008)).translate(0.21, 0, 0), meterUVs(new BoxGeometry(0.38, 0.018, 0.01)).translate(0.25, 0.006, -0.008)]);
    for (const x of [-0.42, 0.2]) {
      const pivot = new Group();
      pivot.position.set(x, 0.05, -0.02);
      pivot.add(this.mesh(arm, metal));
      glassFrame.add(pivot);
      this.wipers.push(pivot);
    }
    this.cabin.add(glassFrame);
  }

  /** The asphalt, the verges, the painted lines that do not move. */
  private buildRoad(): void {
    const asphalt = this.kit.surface('asphalt', ASPHALT_TILE, { color: new Color(0x77756f), roughness: 0.78 });
    const verge = this.kit.surface('grass_meadow', VERGE_TILE, { color: new Color(0x3b3c32) });
    for (const m of [asphalt.map, asphalt.normalMap, asphalt.roughnessMap]) if (m) this.roadMaps.push(m);
    for (const m of [verge.map, verge.normalMap, verge.roughnessMap]) if (m) this.vergeMaps.push(m);
    const far = ROAD_FAR - 20;
    const near = ROAD_FAR + ROAD_SPAN + 10;
    this.outside.add(this.kit.floor(ROAD_LEFT, ROAD_RIGHT, far, near, 0, asphalt));
    this.outside.add(this.kit.floor(ROAD_RIGHT, 60, far, near, -0.03, verge));
    this.outside.add(this.kit.floor(-60, ROAD_LEFT, far, near, -0.03, verge));
    const paintLine = new MeshStandardMaterial({ color: 0xb9b5a6, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const x of [EDGE_LEFT, EDGE_RIGHT]) {
      const line = new Mesh(new PlaneGeometry(0.12, near - far).rotateX(-Math.PI / 2), paintLine);
      line.position.set(x, 0.004, (far + near) / 2);
      line.receiveShadow = true;
      this.outside.add(line);
    }
  }

  /** The white posts either side, their reflectors front and back, the dashes of the centre line, the telegraph poles: all instanced, moved every frame. */
  private buildPosts(): { posts: InstancedMesh; band: InstancedMesh; front: InstancedMesh; back: InstancedMesh; dashes: InstancedMesh; poles: InstancedMesh } {
    const count = Math.ceil(ROAD_SPAN / POST_EVERY) * 2;
    const posts = new InstancedMesh(new BoxGeometry(0.1, 1.0, 0.1).translate(0, 0.5, 0), new MeshStandardMaterial({ color: 0xcfcbbf, roughness: 0.55 }), count);
    const band = new InstancedMesh(new BoxGeometry(0.104, 0.18, 0.104).translate(0, 0.76, 0), new MeshBasicMaterial({ color: 0x050505 }), count);
    const eye = (turn: number, z: number) => new PlaneGeometry(0.05, 0.11).rotateY(turn).translate(0, 0.76, z);
    const front = new InstancedMesh(eye(0, 0.0525), new MeshBasicMaterial({ color: 0xffb04a }), count);
    const back = new InstancedMesh(eye(Math.PI, -0.0525), new MeshBasicMaterial({ color: 0xff2a14 }), count);
    for (let i = 0; i < count; i++) {
      front.setColorAt(i, tint.setScalar(0));
      back.setColorAt(i, tint.setScalar(0));
      band.setColorAt(i, tint.setScalar(1));
    }
    const dashCount = Math.ceil(ROAD_SPAN / DASH_EVERY);
    const dashes = new InstancedMesh(new PlaneGeometry(0.12, DASH).rotateX(-Math.PI / 2).translate(0, 0.004, 0), new MeshStandardMaterial({ color: 0xb9b5a6, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), dashCount);
    const pole = merged([
      meterUVs(new CylinderGeometry(0.09, 0.13, POLE_HEIGHT, 8)).translate(0, POLE_HEIGHT / 2, 0),
      meterUVs(new BoxGeometry(1.3, 0.1, 0.1)).translate(0, POLE_HEIGHT - 0.5, 0),
      meterUVs(new CylinderGeometry(0.035, 0.05, 0.14, 6)).translate(-0.5, POLE_HEIGHT - 0.38, 0),
      meterUVs(new CylinderGeometry(0.035, 0.05, 0.14, 6)).translate(0.5, POLE_HEIGHT - 0.38, 0),
    ]);
    const poles = new InstancedMesh(pole, new MeshStandardMaterial({ color: 0x2b251f, roughness: 0.9 }), Math.ceil(ROAD_SPAN / POLE_EVERY));
    for (const m of [posts, band, front, back, dashes, poles]) {
      m.frustumCulled = false;
      m.receiveShadow = true;
      this.outside.add(m);
    }
    return { posts, band, front, back, dashes, poles };
  }

  /** The table laid for four in the middle of the road, three chairs (the fourth was in the lane), its lamp hanging from nothing. Returns the lamp's cone. */
  private buildTable(): ShaderMaterial {
    const top = TABLE_TOP;
    this.kit.prop('dining_table', [0, 0, 0], { scale: SIZE, castShadow: true }, this.table);
    this.build.contactShadow(0, 0, 1.5, this.table, 0.6);
    // four places: where each sits, which way each looks
    const places: readonly (readonly [number, number, number, number])[] = [
      [0, TABLE_D / 2 - 0.24, 0, -1],
      [0, -TABLE_D / 2 + 0.24, 0, 1],
      [-TABLE_W / 2 + 0.27, 0, 1, 0],
      [TABLE_W / 2 - 0.27, 0, -1, 0],
    ];
    // painted with the plainest materials, so that they share one shader with everything else instanced here
    const steel = new MeshStandardMaterial({ color: 0x8c8b86, roughness: 0.3, metalness: 0.9 });
    const plates = this.kit.props('plate', 4);
    const forks = this.kit.props('fork', 4, { rotation: [90, 0, 0] });
    const knives = this.kit.props('knife', 4, { rotation: [90, 0, 0] });
    const glasses = this.kit.props('tumbler', 4);
    this.kit.paint(plates.root, new MeshStandardMaterial({ color: 0xd9d5c9, roughness: 0.32 }));
    this.kit.paint(forks.root, steel);
    this.kit.paint(knives.root, steel);
    this.kit.paint(glasses.root, new MeshStandardMaterial({ color: 0x3e4845, roughness: 0.06, metalness: 0.4 }));
    places.forEach(([x, z, fx, fz], i) => {
      const rx = -fz;
      const rz = fx;
      const turn = fx !== 0 ? Math.PI / 2 : 0;
      plates.set(i, x, top + 0.002, z);
      forks.set(i, x - rx * 0.17, top + 0.003, z - rz * 0.17, turn);
      knives.set(i, x + rx * 0.17, top + 0.003, z + rz * 0.17, turn);
      glasses.set(i, x + rx * 0.16 + fx * 0.2, top + 0.002, z + rz * 0.16 + fz * 0.2);
    });
    for (const crowd of [plates, forks, knives, glasses]) {
      crowd.commit();
      this.table.add(crowd.root);
    }
    this.kit.paint(this.kit.prop('pot_enamel', [0.05, top, 0.02], {}, this.table), new MeshStandardMaterial({ color: 0x3a2416, roughness: 0.3 }));
    this.kit.paint(this.kit.prop('buns', [-0.42, top, -0.12], { rotation: [0, 20, 0] }, this.table), new MeshStandardMaterial({ color: 0x8a5a2e, roughness: 0.75 }));
    const shadeY = top + SHADE_ABOVE;
    this.kit.paint(this.kit.prop('hanging_lamp', [0, shadeY, 0], {}, this.table), new MeshStandardMaterial({ color: 0x2c3832, roughness: 0.4, metalness: 0.3 }));
    const bulb = shadeY + BULB_DROP;
    for (const size of [BULB_GLOW, HALO_GLOW]) {
      const glow = this.build.glow(0, bulb, 0, size, LAMP_COLOR, 0, this.table, 2.2);
      this.lampGlow.push(glow);
    }
    const cone = this.build.beam(0, bulb, 0, 0.14, 0.95, bulb - top, LAMP_COLOR, 0.3, this.table);
    this.table.visible = false;
    this.outside.add(this.table);
    return cone.material as ShaderMaterial;
  }

  /** The headlights in the fog: the lit air in layers, and the droplets that stream through it. */
  private buildFog(): void {
    for (const [ahead, y, w, h] of LIT_FOG) {
      const glow = this.build.glow(0, y, BUMPER_Z - ahead, 1, LIT_FOG_COLOR, 0, this.cabin, 1.6);
      glow.scale.set(w, h, 1);
      this.litFog.push(glow.material as ShaderMaterial);
    }
    // what spills sideways from the headlights, seen through the side windows
    for (const side of [-1, 1]) this.build.glow(side * 2.8, 0.45, BUMPER_Z + 0.8, 1, LIT_FOG_COLOR, 0.03, this.cabin, 1.4).scale.set(4, 1.2, 1);
    // the tail lights on the fog behind
    for (const x of [-0.6, 0.6]) this.build.glow(x, 0.82, 2.25, 0.35, TAIL_COLOR, 0.3, this.cabin, 2.4);
    this.build.glow(0, 0.9, 5, 1, TAIL_COLOR, 0.035, this.cabin, 1.5).scale.set(6, 2.4, 1);

    const random = randomFrom(31);
    const positions = new Float32Array(DROPS * 3);
    const seeds = new Float32Array(DROPS);
    for (let i = 0; i < DROPS; i++) {
      positions[i * 3] = (random() - 0.5) * 9;
      positions[i * 3 + 1] = 0.05 + random() * 2.6;
      positions[i * 3 + 2] = random() * DROP_LENGTH;
      seeds[i] = random();
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    const drops = new Points(g, new ShaderMaterial({ vertexShader: DROP_VERT, fragmentShader: DROP_FRAG, uniforms: this.drops, transparent: true, depthWrite: false, blending: AdditiveBlending }));
    drops.frustumCulled = false;
    drops.renderOrder = 3;
    this.cabin.add(drops);
  }

  private mesh(g: BufferGeometry, m: Material): Mesh {
    const mesh = new Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    return mesh;
  }

  private sounds(): void {
    const sound = this.sound;
    this.beat(0, () => {
      this.engine = sound.bed('rooms/bus_idle.mp3', { gain: ENGINE_GAIN, rate: 1.3, lowpass: 380, fade: 0.6 });
      this.road = sound.bed('rooms/gurney_rumble.mp3', { gain: ROAD_GAIN, rate: 0.7, lowpass: 700, fade: 0.6 });
      this.wind = sound.bed('rooms/wind_in_ears.mp3', { gain: WIND_GAIN, fade: 1 });
      this.drone = sound.bed('rooms/dream_drone_low.mp3', { gain: DRONE_GAIN, fade: 2 });
      this.hull = sound.bed('rooms/cable_hum.mp3', { gain: HULL_GAIN, fade: 2 });
    });
    this.beat(RADIO_ON, () => {
      this.tune = sound.bed('rooms/lift_tune_loop.mp3', { gain: TUNE_GAIN, offset: 0, lowpass: 2600, pan: 0.05 });
      this.hiss = sound.bed('rooms/intercom_static.mp3', { gain: HISS_GAIN, lowpass: 3000, pan: 0.05, fade: 0.4 });
    });
    // halfway through its phrase, dead
    this.beat(TUNE_DIES, () => this.tune?.stop(0.02));
    for (const [at, file, options] of CUES) this.beat(at, () => sound.play(file, options));
    this.beat(LINE_AT, () => this.say({ tr: 'Fren senin elinde değil.', en: 'The brake is not in your hands.' }, 3));
    // the wipers squeak each way on the dry glass
    for (let k = 0; TABLE_FROM + (k + 0.45) * WIPE_PERIOD < HUSH_AT; k++) {
      this.beat(TABLE_FROM + (k + 0.08) * WIPE_PERIOD, () => sound.play(SQUEAK, { gain: 0.06, rate: 0.92, pan: -0.15, lowpass: 3500 }));
      this.beat(TABLE_FROM + (k + 0.53) * WIPE_PERIOD, () => sound.play(SQUEAK, { gain: 0.05, rate: 0.85, pan: 0.15, lowpass: 3500 }));
    }
    // the house's clock, coming nearer with the table
    this.beat(TABLE_FROM, () => (this.clock = sound.bed('rooms/clock_tick.mp3', { gain: 0.02, fade: 1 })));
    this.beat(17, () => this.clock?.gain(0.06, 2));
    this.beat(20, () => this.clock?.gain(0.12, 1.5));
    this.beat(SHUTTER_AT, () => this.shutter(false));
    // a real silence while the table comes
    this.beat(HUSH_AT, () => {
      for (const v of [this.engine, this.road, this.wind, this.drone, this.hull, this.hiss, this.clock]) v?.gain(0, 0.25);
    });
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const travel = s * SPEED;
    const beam = 1 - (1 - BEAM_LEFT) * ramp(TABLE_FROM + 0.5, SHUTTER_AT - 1, s);
    this.head.intensity = HEAD_POWER * beam;
    this.spill.intensity = SPILL_POWER * beam;
    for (let i = 0; i < LIT_FOG.length; i++) this.litFog[i].uniforms.uColor.value.setHex(LIT_FOG_COLOR).multiplyScalar(LIT_FOG[i][4] * beam);
    this.drops.uColor.value.setHex(HEAD_COLOR).multiplyScalar(DROP_LIGHT * beam);

    // the car corrects itself: the world turns and slides a little under it; the springs; the blow of the chair
    this.outside.rotation.set(0, -heading(s), 0);
    this.outside.position.x = -aside(s);
    const since = s - CHAIR_HIT;
    const jolt = since > 0 ? JOLT * Math.exp(-since * JOLT_DIES) * Math.sin(since * JOLT_RING) : 0;
    this.rig.rotation.set(BUMP_PITCH * wobble(s * 2.3, 5) + jolt, 0, ROLL * wobble(s * 0.7, 9));
    this.rig.position.y = EYE[1] + BUMP_LIFT * wobble(s * 2.6, 7) - (since > 0 ? 0.6 * jolt : 0);
    this.wheelSpin.rotation.z = wheel(s) + (since > 0 ? 6 * jolt : 0);

    // the key swings against the turns, and after the blow, back and forth
    const kick = since > 0 ? 0.5 * Math.exp(-since * 1.5) * Math.sin(since * 6.5) : 0;
    this.keyPivot.rotation.set(0.05 * wobble(s * 1.4, 2) - kick, 0, -0.9 * wheel(s - 0.35) * 0.15 / WHEEL_TURN + 0.04 * wobble(s * 1.9, 3));

    const w = wipe(s);
    this.wipers[0].rotation.z = w;
    this.wipers[1].rotation.z = w;

    // the road goes by
    for (const m of this.roadMaps) m.offset.y = travel / ASPHALT_TILE;
    for (const m of this.vergeMaps) m.offset.y = travel / VERGE_TILE;
    const perSide = this.posts.count / 2;
    for (let i = 0; i < this.posts.count; i++) {
      const left = i >= perSide;
      const z = ROAD_FAR + wrap((i % perSide) * POST_EVERY + (left ? POST_EVERY / 2 : 0) + travel, ROAD_SPAN);
      m4.makeTranslation(left ? POST_LEFT : POST_RIGHT, 0, z);
      for (const m of this.postParts) m.setMatrixAt(i, m4);
      // a reflector shines only when a lamp finds it: the headlights ahead, the tail lights behind
      const ahead = BUMPER_Z - z;
      this.frontEyes.setColorAt(i, tint.setScalar(ahead > 0 ? (1.6 * beam) / (1 + 0.004 * ahead * ahead) : 0));
      const behind = z - 2.2;
      this.backEyes.setColorAt(i, tint.setScalar(behind > 0 ? 1.2 / (1 + 0.03 * behind * behind) : 0));
    }
    for (let i = 0; i < this.dashes.count; i++) {
      this.dashes.setMatrixAt(i, m4.makeTranslation(CENTER_LINE, 0, ROAD_FAR + wrap(i * DASH_EVERY + travel, ROAD_SPAN)));
    }
    for (let i = 0; i < this.poles.count; i++) {
      this.poles.setMatrixAt(i, m4.makeTranslation(POLE_X, 0, ROAD_FAR + wrap(i * POLE_EVERY + 7 + travel, ROAD_SPAN)));
    }
    for (const m of this.passing) m.instanceMatrix.needsUpdate = true;
    this.frontEyes.instanceColor!.needsUpdate = true;
    this.backEyes.instanceColor!.needsUpdate = true;
    this.drops.uTravel.value = travel;
    for (const m of this.motes) m.value = s;

    // the chair in the lane, until the bumper takes it under
    const tip = range(CHAIR_HIT + CHAIR_GOES[0], CHAIR_HIT + CHAIR_GOES[1], s);
    spot.set(CHAIR_X, -CHAIR_DROP * tip, EYE[2] - CHAIR_AHEAD + SPEED * (s - CHAIR_SEEN));
    turn.setFromEuler(euler.set(CHAIR_TIP * tip * tip, CHAIR_TURN * DEG, 0, 'YXZ'));
    this.chairs.setMatrix(CHAIRS.length, m4.compose(spot, turn, s < CHAIR_HIT + 0.4 ? ONE : NONE));

    // the table comes out of the fog with its lamp on
    const tableZ = TABLE_STOP_Z - SPEED * (CUT_AT - s);
    const there = s >= TABLE_FROM;
    this.table.visible = there;
    this.table.position.z = tableZ;
    for (let i = 0; i < CHAIRS.length; i++) {
      const [x, z, facing] = CHAIRS[i];
      turn.setFromEuler(euler.set(0, facing, 0, 'YXZ'));
      this.chairs.setMatrix(i, m4.compose(spot.set(x, 0, tableZ + z), turn, there ? ONE : NONE));
    }
    this.chairs.commit();
    const lit = there ? ramp(TABLE_FROM, TABLE_FROM + LAMP_RISE, s) * (1 + 0.04 * wobble(s * 0.6, 1)) : 0;
    const away = EYE[2] - tableZ;
    const through = Math.exp(-((FOG_DENSITY * away * 0.55) ** 2));
    const bulbGlow = this.lampGlow[0];
    const haloGlow = this.lampGlow[1];
    (bulbGlow.material as ShaderMaterial).uniforms.uColor.value.setHex(LAMP_COLOR).multiplyScalar(1.4 * lit * through);
    (haloGlow.material as ShaderMaterial).uniforms.uColor.value.setHex(LAMP_COLOR).multiplyScalar(0.35 * lit * (0.4 + 0.6 * through));
    bulbGlow.scale.setScalar(Math.max(BULB_GLOW, away * BULB_FAR));
    haloGlow.scale.setScalar(Math.max(HALO_GLOW, away * HALO_FAR));
    this.lampBeam.uniforms.uIntensity.value = 0.3 * lit;
    this.outside.updateMatrix();
    lampAt.set(0, TABLE_TOP + SHADE_ABOVE + BULB_DROP - 0.1, tableZ).applyMatrix4(this.outside.matrix).add(this.origin);
    this.lamp.position.copy(lampAt);
    this.lamp.intensity = LAMP_POWER * lit;

    // the radio comes on by itself and stays on after its tune has died
    const radio = ramp(RADIO_ON, RADIO_ON + 0.25, s);
    this.radioFace.emissiveIntensity = RADIO_GLOW * radio;
    this.radioLight.intensity = RADIO_POWER * radio;

    // in the mirror the house gets smaller, and sways with the car
    const size = WINDOW_NEAR + (WINDOW_FAR - WINDOW_NEAR) * Math.sqrt(range(0, CUT_AT, s));
    this.mirrorWindow.scale.setScalar(size);
    this.mirrorWindow.position.x = 0.02 + 1.6 * heading(s);

    // the lens finds the chair, then follows the table
    this.focus = there ? Math.max(3, Math.min(25, away)) : 9;
    this.fear = 0.3 + 0.25 * ramp(CHAIR_SEEN, CHAIR_HIT, s) + 0.3 * ramp(TABLE_FROM, CUT_AT, s);
    this.movingShadows = (s > CHAIR_SEEN - 1 && s < CHAIR_HIT + 0.2) || (there && s < CUT_AT);
    this.black = s >= CUT_AT ? 1 : 0;
  }
}
