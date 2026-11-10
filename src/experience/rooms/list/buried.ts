import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  Object3D,
  PlaneGeometry,
  Points,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  type Material,
  type PerspectiveCamera,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { DreamLight } from '../../dream/LightPool';
import { randomFrom } from '../../dream/FigureKit';
import { DEG, wobble } from '../../math';
import { dateNow } from '../FourthWall';
import type { RoomAir, RoomAssets, RoomContext, RoomControl, RoomFilm, RoomFrame, RoomKey, RoomPose } from '../Room';
import { Room } from '../Room';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['lighter_zippo', 'eyeball'],
  materials: ['wood_raw_boards', 'wood_rot', 'soil_dark'],
  sounds: [
    'rooms/dirt_on_lid_1.mp3',
    'rooms/dirt_on_lid_2.mp3',
    'rooms/dirt_on_lid_3.mp3',
    'rooms/dirt_on_lid_4.mp3',
    'rooms/dirt_on_lid_far.mp3',
    'rooms/shovel_1.mp3',
    'rooms/shovel_2.mp3',
    'rooms/shovel_3.mp3',
    'rooms/earth_pressure.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/dream_drone_glass.mp3',
    'rooms/breath_calm.mp3',
    'rooms/breath_fast.mp3',
    'rooms/breath_panic.mp3',
    'rooms/breath_in.mp3',
    'rooms/lighter_lid.mp3',
    'rooms/lighter_wheel_1.mp3',
    'rooms/lighter_wheel_2.mp3',
    'rooms/lighter_wheel_3.mp3',
    'rooms/lighter_wheel_4.mp3',
    'rooms/lighter_catch.mp3',
    'rooms/lighter_flame.mp3',
    'rooms/nails_scrape_1.mp3',
    'rooms/nails_scrape_2.mp3',
    'rooms/nails_scrape_3.mp3',
    'rooms/nails_scrape_4.mp3',
    'rooms/nails_scrape_5.mp3',
    'rooms/nails_frantic.mp3',
    'rooms/nails_other_side.mp3',
    'rooms/hair_fingers.mp3',
    'rooms/dirt_trickle.mp3',
    'rooms/lid_creak_1.mp3',
    'rooms/lid_creak_3.mp3',
    'rooms/wood_stress.mp3',
    'rooms/board_crack_1.mp3',
    'rooms/board_crack_2.mp3',
    'rooms/board_crack_3.mp3',
    'rooms/board_crack_4.mp3',
    'rooms/earth_inrush.mp3',
    'rooms/flame_out.mp3',
  ],
};

type V3 = readonly [number, number, number];
type Ctx = CanvasRenderingContext2D;

/**
 * The box stands on its foot end in the room's frame, so that the lid is a wall before the eye and looking
 * round is plain yaw and pitch: -z is up out of the grave, +z is your back, +y the crown of your head (m).
 */
const LID_Z = -0.3;
const FLOOR_Z = 0.1;
const HEAD_Y = 2.02;
const SHOULDER_Y = 1.5;
/** Half the width of the box at the head, at the shoulders and at the feet (m): a coffin's outline. */
const HEAD_HALF = 0.2;
const SHOULDER_HALF = 0.275;
const FOOT_HALF = 0.18;
/** Thickness of a board, and how ragged a sawn edge is (m). */
const BOARD = 0.022;
const RAG = 0.0016;
/** Where the lid's boards meet (x, m), and the patch of it near the face that gets its own picture (m). */
const LID_SEAMS = [-0.186, -0.066, 0.064, 0.181];
const LID_PATCH = { x: [-0.3, 0.3], y: [1.33, 2.08], px: [1024, 1280] } as const;
/** How far the lid comes down: two fingers (m), in two slips. */
const LID_DROP = [0.012, 0.034];
/** The coffin's outline where the walls meet the lid, round from the right foot (x, y; m). */
const OUTLINE: readonly (readonly [number, number])[] = [
  [FOOT_HALF, 0],
  [SHOULDER_HALF, SHOULDER_Y],
  [HEAD_HALF, HEAD_Y],
  [-HEAD_HALF, HEAD_Y],
  [-SHOULDER_HALF, SHOULDER_Y],
  [-FOOT_HALF, 0],
];
/**
 * The lining: cheap satin gathered round the top of the walls where the lid shuts on it, so the flame finds the
 * coffin's outline. How far it stands out of the corner, the ruffle laid on the lid beyond it, how far it keeps off
 * the boards, one gather to the next and the mesh's step along it (m); how deep the gathers are (share of the depth).
 */
const FRILL_DEPTH = 0.016;
const FRILL_SKIRT = 0.011;
const FRILL_OFF = 0.003;
const FRILL_PLEAT = 0.011;
const FRILL_STEP = 0.002;
const FRILL_GATHER = 0.16;
const FRILL_COLOR = 0xa39579;
/** The points of the nails that shut the lid, come through it and the lining: in from the walls, apart, how long, how thick (m), and how far a point may lean (rad). */
const NAIL_INSET = 0.024;
const NAIL_GAP = 0.105;
const NAIL_LONG = [0.016, 0.026] as const;
const NAIL_THICK = 0.0026;
const NAIL_LEAN = 0.5;
/** The grit on the lens is washed out of the eye while the head turns to the wall (s), so nothing seems to fall round the gap. */
const GRIT_WASHED = 1.0;
/** The eye at rest, and where the wall at your left opens (local to that wall: up it, along it; both m), its reach and its height. */
const EYE: V3 = [0, 1.78, 0];
const SLIT = { up: 0.293, along: -0.115, sigma: 0.05, open: 0.0078 };
/** The wall's picture: across and along the boards (m). */
const WALL_PATCH = { across: 0.56, along0: -0.41, along: 0.56, px: 896 };
/** The eye behind the wall: 1 is a real one, and how far back it sits when it has come up to the gap (m). */
const EYE_SCALE = 1.75;
const EYE_BACK = 0.031;
const EYE_FAR = 0.13;

/** The lighter's flame at rest and when it is brought over to the wall (m). */
const FLAME_REST: V3 = [0.042, 1.748, -0.186];
const FLAME_LEFT: V3 = [-0.156, 1.76, -0.111];
/** Height and half width of the full flame, and of the bead at the end (m). */
const FLAME_H = 0.038;
const FLAME_W = 0.0085;
const BEAD_H = 0.0052;
/** Point light of the flame at full air (cd), its reach (m), and the cold nothing that keeps shapes in the dark. */
const FLAME_POWER = 0.2;
const FLAME_REACH = 2.2;
const FILL_POWER = 0.02;
/** What is left to see the eye by when nothing is left (cd), and how far it reaches (m). */
const EYE_GLOW = 0.016;
const EYE_GLOW_REACH = 0.3;
/** Air left, seconds against 0..1: the flame's size and its light follow it. */
const AIR: readonly (readonly [number, number])[] = [
  [10, 1],
  [30, 0.82],
  [44, 0.58],
  [49, 0.27],
  [52, 0.1],
  [53.2, 0],
];

/** Seconds of the room. */
const PROMPT_LIGHT_AT = 8;
const LIGHT_FALLBACK_AT = 10;
const PROMPT_SCRATCH_AT = 26;
const AUTO_SCRATCH_FROM = 32;
const AUTO_SCRATCH_TO = 41;
const TALLY_AT = 16.6;
const TRICKLE_AT = 22;
const OTHER_SIDE_AT = 42;
const EYE_RISES_AT = 42;
const EYE_RISEN_AT = 45.5;
const TURN_FROM = REDUCED_MOTION ? 44.2 : 45.8;
const TURN_TO = 48.4;
/** The last of the flame shrinks to a dull red bead, never blue: no cold round light that could be a screen. */
const EMBER_FROM = 50.5;
const EMBER_AT = 52.3;
const FLAME_DIES_AT = 53.2;
const CRACK_AT = 53.9;
const EARTH_FROM = 54.2;
const EARTH_NEAR = 55.3;
const EARTH_OVER = 57.35;
const EARTH_TO = 57.7;
const SILENCE_AT = 58;
const LAST_LINE_AT = 64;
/** The sparks of a wheel that does not catch (s). */
const SPARKS = [5.1, 7.0, 9.1];
/** Seconds the eye must be on screen before the shutter, and how far inside the view it must be (deg). */
const SHOT_AFTER = 1.45;
const SHOT_MARGIN = -5;

/** How much faster than its pace scrolling can drive the room: you are held still. */
const HURRY = 1.5;
/** The lens: blur strength on the lid and on the eye, and their distances (m). */
const APERTURE_LID = 0.2;
const APERTURE_EYE = 0.09;
const FOCUS_LID = 0.33;
const FOCUS_EYE = 0.19;
/** A stroke of the nails: how long it takes (s), how often while holding and when it scratches by itself (s). */
const STROKE_TIME = 0.42;
const HOLD_PERIOD = 0.85;
const AUTO_PERIOD = 1.3;
/** How late the one behind the wall answers (s). */
const ECHO_DELAY = 0.46;
/** Strokes the lid can hold, nails to a stroke, width of a nail's track (m). */
const MAX_STROKES = 44;
const NAILS = 4;
const TRACK_WIDTH = 0.0021;
/** How fast crumbs fall (m/s²): slow enough to be seen. */
const CRUMB_FALL = 5.6;
/** How the breath quickens: radians per second at the start, and added per second of the room. */
const BREATH_RATE = 1.45;
const BREATH_RISE = 0.0135;
/** Distance of what is laid over the picture (m): the earth coming down. */
const OVER_D = 0.2;
/** How far out on the eye the flame's reflection lies, as a share of its radius, and its size (m). */
const GLINT_OUT = 1.03;
const GLINT_SIZE = 0.0058;

const SCRATCH_FILES = ['rooms/nails_scrape_1.mp3', 'rooms/nails_scrape_2.mp3', 'rooms/nails_scrape_3.mp3', 'rooms/nails_scrape_4.mp3', 'rooms/nails_scrape_5.mp3'];
/** What fell on the lid: second, file, gain, low-pass (Hz). Each fainter and duller than the one before. */
const THUDS: readonly (readonly [number, string, number, number])[] = [
  [0.15, 'rooms/dirt_on_lid_1.mp3', 0.6, 3400],
  [1.6, 'rooms/dirt_on_lid_2.mp3', 0.52, 2800],
  [3.25, 'rooms/dirt_on_lid_3.mp3', 0.43, 2200],
  [4.85, 'rooms/dirt_on_lid_4.mp3', 0.34, 1700],
  [6.55, 'rooms/dirt_on_lid_2.mp3', 0.24, 1200],
  [8.35, 'rooms/dirt_on_lid_far.mp3', 0.42, 900],
  [10.7, 'rooms/dirt_on_lid_far.mp3', 0.26, 700],
  [13.6, 'rooms/dirt_on_lid_far.mp3', 0.15, 520],
];
/** Handfuls of crumbs: when, how many, where from and how widely, and whether they come at the eye. */
const CRUMB_FALLS = [
  { from: 13.75, to: 14.1, n: 12, x: 0, y: 1.84, w: 0.2, h: 0.14, aim: false },
  { from: TRICKLE_AT, to: 25.4, n: 72, x: -0.066, y: 1.802, w: 0.004, h: 0.012, aim: true },
  { from: 30.02, to: 30.55, n: 30, x: 0, y: 1.78, w: 0.2, h: 0.24, aim: false },
  { from: 31.18, to: 31.85, n: 40, x: 0, y: 1.8, w: 0.22, h: 0.26, aim: false },
];
/** Blows that shake the eye: second and how hard (rad). */
const JOLTS: readonly (readonly [number, number])[] = [
  [30.02, 0.0065],
  [31.2, 0.011],
  [CRACK_AT, 0.0075],
  [54.5, 0.01],
  [55.1, 0.007],
];

const ramp = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const lidDown = (s: number, at: number, hold: number): number => ramp(at, at + 0.09, s) * (1 - ramp(at + hold, at + hold + 0.22, s));
const breathPhase = (s: number): number => s * (BREATH_RATE + s * BREATH_RISE);
/** Half the width of the box at a height (m): it tapers from the shoulders to the head and to the feet. */
const boxHalf = (y: number): number => (y > SHOULDER_Y ? mix(SHOULDER_HALF, HEAD_HALF, (y - SHOULDER_Y) / (HEAD_Y - SHOULDER_Y)) : mix(FOOT_HALF, SHOULDER_HALF, y / SHOULDER_Y));

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const AXIS_Z = new Vector3(0, 0, 1);
const AXIS_Y = new Vector3(0, 1, 0);

function context(w: number, h: number): Ctx {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d')!;
}

function colorTexture(c: Ctx): CanvasTexture {
  const t = new CanvasTexture(c.canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A picture of raw boards: real wood magnified, fibres and saw marks drawn over it, and a relief to raise a normal map from. */
class BoardPainter {
  readonly color: Ctx;
  readonly relief: Ctx;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly r: () => number,
  ) {
    this.color = context(w, h);
    this.relief = context(w, h);
  }

  /** Lay boards side by side (`edges`, px across), their grain along the picture's height. */
  lay(wood: CanvasImageSource, woodPx: number, edges: readonly (readonly [number, number])[], pxPerM: number): void {
    const c = this.color;
    const { h, r } = this;
    c.fillStyle = '#040302';
    c.fillRect(0, 0, this.w, h);
    const inWood = woodPx / 1.4 / pxPerM;
    for (const [a, b] of edges) {
      const width = b - a;
      c.save();
      c.beginPath();
      c.rect(a, 0, width, h);
      c.clip();
      // each board is its own tree: real wood, magnified, then squeezed over itself for the fine grain
      const sw = width * inWood;
      const sh = h * inWood;
      c.filter = `brightness(${0.42 + r() * 0.42}) contrast(1.5) saturate(${0.62 + r() * 0.4})`;
      c.drawImage(wood, r() * (woodPx - sw), r() * (woodPx - sh), sw, sh, a, 0, width, h);
      c.globalCompositeOperation = 'overlay';
      c.globalAlpha = 0.85;
      c.filter = 'contrast(1.7)';
      const fine = Math.min(woodPx * 0.9, sw * 3.4);
      c.drawImage(wood, r() * (woodPx - fine), r() * (woodPx - sh), fine, sh, a, 0, width, h);
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1;
      c.filter = 'none';
      for (let i = 0; i < width * 9; i++) {
        c.fillStyle = r() < 0.72 ? `rgba(8,5,2,${0.08 + r() * 0.32})` : `rgba(214,178,132,${0.03 + r() * 0.1})`;
        c.fillRect(a + r() * width, r() * h, 0.5 + r() * 1.1, 10 + r() * r() * 520);
      }
      for (let y = r() * 20; y < h; y += 12 + r() * 34) {
        c.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.09})`;
        c.fillRect(a, y, width, 1 + r() * 2.6);
      }
      for (let n = 0; n < 11; n++) this.check(a + r() * width, r() * h, 60 + r() * r() * 640);
      for (let n = 0; n < 2; n++) this.knot(a + width * (0.2 + r() * 0.6), r() * h, 7 + r() * 17);
      for (let side = 0; side < 2; side++) {
        const x0 = side === 0 ? a : b;
        const g = c.createLinearGradient(x0, 0, x0 + (side === 0 ? 34 : -34), 0);
        g.addColorStop(0, 'rgba(3,2,1,0.92)');
        g.addColorStop(0.3, 'rgba(5,3,2,0.42)');
        g.addColorStop(1, 'rgba(5,3,2,0)');
        c.fillStyle = g;
        c.fillRect(a, 0, width, h);
      }
      c.restore();
    }
    this.relief.drawImage(c.canvas, 0, 0);
  }

  /** A split along the grain, where the board has dried and opened. */
  private check(x: number, y: number, length: number): void {
    const c = this.color;
    const r = this.r;
    let px = x;
    let py = y;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(px, py);
    for (let k = 0; k < length; k += 12) {
      px += (r() - 0.5) * 3.4;
      py += 12;
      c.lineTo(px, py);
    }
    c.strokeStyle = `rgba(3,2,1,${0.55 + r() * 0.4})`;
    c.lineWidth = 0.7 + r() * r() * 3.2;
    c.stroke();
  }

  /** A square-cut nail, and the rust that has run from it. */
  nail(x: number, y: number): void {
    const { color: c, relief: h, r } = this;
    c.fillStyle = `rgba(92,40,16,${0.16 + r() * 0.22})`;
    c.fillRect(x - 3 + r() * 2, y, 4 + r() * 3, 26 + r() * 70);
    c.fillStyle = '#0c0705';
    c.fillRect(x - 8, y - 8, 16, 16);
    c.fillStyle = 'rgba(118,60,30,0.85)';
    c.fillRect(x - 5.5 - r(), y - 5.5 - r(), 10, 10);
    h.fillStyle = '#ffffff';
    h.fillRect(x - 7, y - 7, 14, 14);
  }

  private knot(x: number, y: number, size: number): void {
    const c = this.color;
    const g = c.createRadialGradient(x, y, 1, x, y, size);
    g.addColorStop(0, 'rgba(6,3,1,0.95)');
    g.addColorStop(0.6, 'rgba(24,12,6,0.7)');
    g.addColorStop(1, 'rgba(20,10,4,0)');
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(x, y, size * 0.8, size * 1.25, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(8,4,2,0.34)';
    c.lineWidth = 0.9;
    for (let k = 1; k < 6; k++) {
      c.beginPath();
      c.ellipse(x, y, size * (0.6 + k * 0.34), size * (1 + k * 0.72), 0, 0, Math.PI * 2);
      c.stroke();
    }
  }
  /** Darkening that is no relief: damp, soot, a shadow of glue. */
  stain(x: number, y: number, rx: number, ry: number, alpha: number): void {
    const c = this.color;
    c.save();
    c.translate(x, y);
    c.scale(rx, ry);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(5,3,2,${alpha})`);
    g.addColorStop(0.55, `rgba(5,3,2,${alpha * 0.55})`);
    g.addColorStop(1, 'rgba(5,3,2,0)');
    c.fillStyle = g;
    c.fillRect(-1, -1, 2, 2);
    c.restore();
  }

  /** Grey-green mould, in specks, and earth that has seeped along a board. */
  mould(x: number, y: number, spread: number, n: number): void {
    const c = this.color;
    const r = this.r;
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const d = spread * r() * r();
      c.fillStyle = `rgba(112,126,104,${0.05 + r() * 0.2})`;
      c.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.8 + r() * 2.4, 0.8 + r() * 2.4);
    }
  }

  smear(x: number, y: number, length: number, width: number): void {
    const c = this.color;
    const r = this.r;
    for (let k = 0; k < length; k += 2) {
      c.fillStyle = `rgba(6,4,2,${0.14 + r() * 0.34})`;
      const w = width * (1 - k / length) * (0.5 + r());
      c.fillRect(x - w / 2 + (r() - 0.5) * 3, y + k, w, 2.5);
    }
  }

  /** A stroke of `nails` fingers. `depth` 0..1 how hard, `fresh` 0..1 how pale the wood still is in it. */
  scratch(x: number, y: number, angle: number, length: number, nails: number, depth: number, fresh: number): void {
    const { color: c, relief: h, r } = this;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const gap = 13 + r() * 8;
    for (let n = 0; n < nails; n++) {
      const off = (n - (nails - 1) / 2) * gap;
      const x0 = x - dy * off + (r() - 0.5) * 5;
      const y0 = y + dx * off + (r() - 0.5) * 5;
      const l = length * (0.7 + r() * 0.32);
      const bend = (r() - 0.5) * 0.14 * l;
      const mx = x0 + (dx * l) / 2 - dy * bend;
      const my = y0 + (dy * l) / 2 + dx * bend;
      const x1 = x0 + dx * l;
      const y1 = y0 + dy * l;
      const width = (0.55 + r() * 1.25) * (0.55 + depth);
      const line = (t: Ctx, ox: number, oy: number): void => {
        t.beginPath();
        t.moveTo(x0 + ox, y0 + oy);
        t.quadraticCurveTo(mx + ox, my + oy, x1 + ox, y1 + oy);
        t.stroke();
      };
      c.lineCap = 'round';
      c.strokeStyle = `rgba(216,184,142,${0.1 + fresh * 0.5 + r() * 0.12})`;
      c.lineWidth = width * 1.1;
      line(c, 1.2, 1.2);
      c.strokeStyle = `rgba(5,3,2,${0.42 + depth * 0.5})`;
      c.lineWidth = width;
      line(c, 0, 0);
      h.lineCap = 'round';
      h.strokeStyle = `rgba(0,0,0,${0.55 + depth * 0.45})`;
      h.lineWidth = width * 1.5;
      line(h, 0, 0);
    }
  }

  /** One deep mark of a tally, cut again and again with something blunt. */
  mark(x0: number, y0: number, x1: number, y1: number): void {
    const { color: c, relief: h, r } = this;
    c.lineCap = 'round';
    h.lineCap = 'round';
    for (let pass = 0; pass < 3; pass++) {
      const jx = (r() - 0.5) * 2.4;
      const jy = (r() - 0.5) * 3.4;
      c.strokeStyle = `rgba(4,2,1,${0.72 + r() * 0.2})`;
      c.lineWidth = 5.4 + r() * 2;
      c.beginPath();
      c.moveTo(x0 + jx, y0 + jy);
      c.lineTo(x1 + jx, y1 + jy);
      c.stroke();
      h.strokeStyle = 'rgba(0,0,0,0.92)';
      h.lineWidth = 6.8;
      h.beginPath();
      h.moveTo(x0 + jx, y0 + jy);
      h.lineTo(x1 + jx, y1 + jy);
      h.stroke();
    }
    c.strokeStyle = `rgba(226,194,150,${0.62 + r() * 0.26})`;
    c.lineWidth = 1.5 + r();
    c.beginPath();
    c.moveTo(x0 + 1.4, y0 + 1);
    c.lineTo(x1 + 1.4, y1 - 1);
    c.stroke();
  }

  vignette(strength: number): void {
    const c = this.color;
    const g = c.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.25, this.w / 2, this.h / 2, this.h * 0.82);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${strength})`);
    c.fillStyle = g;
    c.fillRect(0, 0, this.w, this.h);
  }

  /** The relief, as a normal map. */
  normals(strength: number): CanvasTexture {
    const { w, h } = this;
    const data = this.relief.getImageData(0, 0, w, h).data;
    const height = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) height[i] = (data[i * 4] * 0.4 + data[i * 4 + 1] * 0.45 + data[i * 4 + 2] * 0.15) / 255;
    const out = context(w, h);
    const image = out.createImageData(w, h);
    const px = image.data;
    for (let y = 0; y < h; y++) {
      const up = y > 0 ? y - 1 : y;
      const down = y < h - 1 ? y + 1 : y;
      for (let x = 0; x < w; x++) {
        const left = x > 0 ? x - 1 : x;
        const right = x < w - 1 ? x + 1 : x;
        const nx = (height[left + y * w] - height[right + y * w]) * strength;
        const ny = (height[x + down * w] - height[x + up * w]) * strength;
        const length = Math.sqrt(nx * nx + ny * ny + 1);
        const i = (x + y * w) * 4;
        px[i] = (nx / length) * 127.5 + 127.5;
        px[i + 1] = (ny / length) * 127.5 + 127.5;
        px[i + 2] = (1 / length) * 127.5 + 127.5;
        px[i + 3] = 255;
      }
    }
    out.putImageData(image, 0, 0);
    const t = new CanvasTexture(out.canvas);
    t.colorSpace = NoColorSpace;
    t.anisotropy = 8;
    return t;
  }
}

interface PlankSpec {
  across: readonly [number, number];
  along: readonly [number, number];
  rows: number;
  seed: number;
  /** How far each long edge gives way at a point along the board (m). */
  open?: (edge: 0 | 1, v: number) => number;
}

/** A raw board with ragged long edges and a real thickness: (u across, v along, n out of its face) go through `place`. */
function plank(o: PlankSpec, place: (u: number, v: number, n: number) => V3, uvOf: (u: number, v: number) => readonly [number, number]): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  const COLUMNS = 7;
  const chamfer = 0.0022;
  const ragged = (v: number, seed: number): number => wobble(v * 31 + seed, seed) * 0.55 + wobble(v * 173 + seed * 2, seed + 1) * 0.45;
  for (let row = 0; row <= o.rows; row++) {
    const v = mix(o.along[0], o.along[1], row / o.rows);
    const e0 = o.across[0] + ragged(v, o.seed) * RAG + (o.open?.(0, v) ?? 0);
    const e1 = o.across[1] + ragged(v, o.seed + 9) * RAG - (o.open?.(1, v) ?? 0);
    const cup = wobble(v * 5 + o.seed, o.seed) * 0.0009;
    const us = [e0, e0, e0 + chamfer, (e0 + e1) / 2, e1 - chamfer, e1, e1];
    const ns = [-BOARD, -chamfer * 0.7, 0, cup, 0, -chamfer * 0.7, -BOARD];
    for (let c = 0; c < COLUMNS; c++) {
      const [x, y, z] = place(us[c], v, ns[c]);
      positions.push(x, y, z);
      const [a, b] = uvOf(us[c], v);
      uvs.push(a, b);
    }
  }
  for (let row = 0; row < o.rows; row++) {
    for (let c = 0; c < COLUMNS - 1; c++) {
      const a = row * COLUMNS + c;
      index.push(a, a + 1, a + COLUMNS + 1, a, a + COLUMNS + 1, a + COLUMNS);
    }
  }
  const g = new BufferGeometry();
  g.setIndex(index);
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

/** A side wall: boards laid across the box. (+1: the right; -1: the left; `upper`: above the shoulder.) */
function wallPlace(side: 1 | -1, upper: boolean): (u: number, v: number, n: number) => V3 {
  const ox = side * (upper ? SHOULDER_HALF : FOOT_HALF);
  const oy = upper ? SHOULDER_Y : 0;
  const tx = upper ? HEAD_HALF - SHOULDER_HALF : SHOULDER_HALF - FOOT_HALF;
  const ty = upper ? HEAD_Y - SHOULDER_Y : SHOULDER_Y;
  const length = Math.hypot(tx, ty);
  // up along the wall, and into the box
  const ax = (side * tx) / length;
  const ay = ty / length;
  const nx = -side * ay;
  const ny = side * ax;
  return (u, v, n) => {
    const along = side === -1 ? u : -u;
    return [ox + ax * along + nx * n, oy + ay * along + ny * n, v];
  };
}

/** Ribbons of hair, each turned to the eye once and for all (the eye barely moves). */
class HairBuilder {
  readonly positions: number[] = [];
  readonly hair: number[] = [];
  readonly index: number[] = [];

  constructor(private readonly eye: Vector3) {}

  strand(points: readonly Vector3[], width: number, delay: number, phase: number): void {
    const base = this.positions.length / 3;
    const n = points.length;
    for (let k = 0; k < n; k++) {
      const p = points[k];
      _v.copy(points[Math.min(n - 1, k + 1)]).sub(points[Math.max(0, k - 1)]);
      _s.copy(this.eye).sub(p);
      _v.cross(_s).normalize().multiplyScalar(width * (1 - (0.72 * k) / (n - 1)));
      this.positions.push(p.x - _v.x, p.y - _v.y, p.z - _v.z, p.x + _v.x, p.y + _v.y, p.z + _v.z);
      const along = k / (n - 1);
      this.hair.push(along, delay, phase, along, delay, phase);
      if (k < n - 1) {
        const a = base + k * 2;
        this.index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setIndex(this.index);
    g.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    g.setAttribute('aHair', new Float32BufferAttribute(this.hair, 3));
    return g;
  }
}

/** A lock lying on a flat place: it follows the crack a little, then leaves it in one long curve. */
function lock(x: number, y: number, z: number, heading: number, turn: number, length: number, strands: number, delay: number, r: () => number, emit: (points: Vector3[], delay: number) => void): void {
  const steps = 26;
  const step = length / steps;
  const bx: number[] = [];
  const by: number[] = [];
  const nx: number[] = [];
  const ny: number[] = [];
  let bend = turn;
  for (let k = 0; k <= steps; k++) {
    bx.push(x);
    by.push(y);
    nx.push(-Math.sin(heading));
    ny.push(Math.cos(heading));
    heading += bend * step;
    bend += (r() - 0.5) * 3.2;
    x += Math.cos(heading) * step;
    y += Math.sin(heading) * step;
  }
  for (let s = 0; s < strands; s++) {
    const o0 = (r() - 0.5) * 0.0018;
    const o1 = (r() - 0.5) * 0.024;
    const phase = r() * 6.28;
    const points: Vector3[] = [];
    const count = Math.floor(steps * (0.5 + r() * 0.5));
    for (let k = 0; k <= count; k++) {
      const t = k / steps;
      const off = o0 + o1 * t * t + Math.sin(t * 14 + phase) * 0.0008 * t;
      points.push(new Vector3(bx[k] + nx[k] * off, by[k] + ny[k] * off, z + 0.0009));
    }
    emit(points, delay + r() * 0.1);
  }
}

/** A hair that has come through and hangs at your face, spreading as it falls. */
function hanging(root: Vector3, lx: number, ly: number, length: number, r: () => number): Vector3[] {
  const points: Vector3[] = [];
  const steps = 18;
  const phase = r() * 6.28;
  const wave = 0.012 + r() * 0.02;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const spread = t * (1 - 0.45 * t);
    points.push(new Vector3(root.x + lx * spread + Math.sin(t * 5 + phase) * wave * t, root.y + ly * spread + Math.cos(t * 4 + phase * 1.3) * wave * t, root.z + length * Math.pow(t, 1.35)));
  }
  return points;
}
const FLAME_VERTEX = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FLAME_FRAGMENT = /* glsl */ `
varying vec2 vP;
uniform float uT, uH, uW, uLean, uEmber, uGain, uHalo, uSpark, uSeed;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float h = vP.y / uH;
  float sway = uH * (uLean * h * h + 0.075 * h * sin(h * 3.6 - uT * 4.3) + 0.04 * h * h * sin(h * 7.0 - uT * 6.1));
  float x = vP.x - sway;
  float belly = max(uW * 2.05 * pow(clamp(h + 0.06, 0.0, 1.0), 0.5) * pow(clamp(1.03 - h, 0.0, 1.0), 0.72), 1e-4);
  float d = abs(x) / belly;
  float inside = smoothstep(1.0, 0.18, d) * step(-0.06, h) * step(h, 1.05);
  float tip = smoothstep(1.03, 0.62, h);
  float foot = smoothstep(-0.05, 0.16, h);
  vec3 hot = mix(vec3(1.0, 0.36, 0.05), vec3(1.0, 0.82, 0.46), smoothstep(0.25, 0.85, inside) * smoothstep(1.0, 0.4, h));
  hot = mix(hot, vec3(1.0, 0.93, 0.72), smoothstep(0.82, 1.0, inside) * smoothstep(0.62, 0.25, h) * smoothstep(0.08, 0.3, h));
  vec3 color = hot * pow(inside, 1.35) * tip * foot * 3.8;
  color *= mix(0.25, 1.0, smoothstep(0.02, 0.26, h + d * 0.14));
  float skirt = smoothstep(1.35, 0.55, d) * smoothstep(0.3, 0.0, h) * smoothstep(-0.1, 0.0, h);
  color += vec3(0.09, 0.24, 1.0) * skirt * 1.8;
  float r = length(vec2(x, vP.y - uH * 0.35)) / max(uH * 0.62, 1e-4);
  vec3 bead = vec3(1.1, 0.24, 0.04) * pow(max(0.0, 1.0 - r), 1.5) * 2.4 + vec3(1.0, 0.62, 0.3) * pow(max(0.0, 1.0 - r * 1.8), 2.0) * 1.8;
  color = mix(color, bead, uEmber);
  vec2 c = vP - vec2(0.0, uH * 0.45);
  color += mix(vec3(1.0, 0.46, 0.14), vec3(0.55, 0.14, 0.03), uEmber) * exp(-dot(c, c) / 0.0032) * uHalo;
  color *= uGain;
  if (uSpark > 0.0) {
    for (int i = 0; i < 6; i++) {
      float f = float(i);
      vec2 at = vec2(hash(uSeed + f * 3.1) - 0.5, hash(uSeed + f * 7.7) * 0.9 + 0.05) * 0.03;
      vec2 e = vP - at;
      color += vec3(1.0, 0.56, 0.2) * exp(-dot(e, e) / 0.0000008) * uSpark * 9.0;
    }
    color += vec3(1.0, 0.62, 0.3) * exp(-dot(vP, vP) / 0.0006) * uSpark * 1.1;
  }
  gl_FragColor = vec4(color, 1.0);
}`;

const HAIR_VERTEX = /* glsl */ `
attribute vec3 aHair;
uniform float uGrow, uT, uBreath, uLevel;
uniform vec3 uFlame;
varying float vLight;
varying float vAlong;
varying float vLimit;
void main() {
  vec3 p = position;
  float a = aHair.x;
  vAlong = a;
  vLimit = aHair.y < 0.0 ? 2.0 : (uGrow - aHair.y) / max(1.0 - aHair.y, 0.001);
  p.x += a * a * (0.003 * sin(uT * 0.7 + aHair.z + a * 2.5) + 0.004 * uBreath);
  p.y += a * a * (0.003 * cos(uT * 0.53 + aHair.z * 1.7) - 0.006 * uBreath);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vec3 d = uFlame - world.xyz;
  vLight = uLevel * min(1.2, 0.022 / (dot(d, d) + 0.003));
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const HAIR_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vLight;
varying float vAlong;
varying float vLimit;
void main() {
  if (vAlong > vLimit) discard;
  gl_FragColor = vec4(uColor * vLight, 1.0);
}`;

const MOTE_VERTEX = /* glsl */ `
attribute vec2 aMote;
uniform float uT, uLevel;
uniform vec3 uFlame;
varying float vLight;
void main() {
  vec3 p = position;
  p.x += sin(uT * 0.21 + aMote.x) * 0.018;
  p.y += cos(uT * 0.17 + aMote.x * 1.7) * 0.022;
  p.z += sin(uT * 0.13 + aMote.x * 2.3) * 0.012;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vec3 d = uFlame - world.xyz;
  vLight = uLevel * min(0.9, 0.0045 / (dot(d, d) + 0.004));
  vec4 view = viewMatrix * world;
  gl_PointSize = clamp(aMote.y * 0.12 / -view.z, 1.0, 5.0);
  gl_Position = projectionMatrix * view;
}`;

const MOTE_FRAGMENT = /* glsl */ `
varying float vLight;
void main() {
  float a = 1.0 - smoothstep(0.08, 0.5, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(vec3(1.0, 0.76, 0.52) * vLight * a, 1.0);
}`;

/**
 * Buried alive. You lie on your back in a box of raw boards with a lighter and the air that is in the box.
 * There are scratches on the lid that are older than you, thirty-three marks, white hair coming in at the
 * seams; and at some point someone behind the wall at your left is scratching in your rhythm.
 */
export default class Buried extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x000000, density: 0.85 },
    env: 'evening',
    envIntensity: 0,
    sky: 0,
    grade: { exposure: 1.18, saturation: 0.86, warmth: 0.015, tint: -0.015, flare: 0.001 },
  };
  film: RoomFilm = { bloom: 1.05, bloomFrom: 0.95, bloomTint: [1, 0.66, 0.4], grain: 0.5, weave: 0.0004, flicker: 0.015 };
  focus = FOCUS_LID;
  aperture = APERTURE_LID;
  drift = 0;
  fear = 0.3;
  control: RoomControl = { look: true, scroll: true, press: false, hurry: HURRY };

  private readonly flame: DreamLight;
  private readonly fill: DreamLight;
  private readonly eyeGlow: DreamLight;
  private readonly flameMesh: Mesh;
  private readonly flameU = {
    uT: { value: 0 },
    uH: { value: FLAME_H },
    uW: { value: FLAME_W },
    uLean: { value: 0 },
    uEmber: { value: 0 },
    uGain: { value: 1 },
    uHalo: { value: 0.16 },
    uSpark: { value: 0 },
    uSeed: { value: 0 },
  };
  private readonly held = new Group();
  private readonly fist: Mesh;
  private readonly fogs: Mesh[] = [];
  private readonly lid = new Group();
  private readonly hairU = {
    uGrow: { value: 0 },
    uT: { value: 0 },
    uBreath: { value: 0 },
    uLevel: { value: 0 },
    uFlame: { value: new Vector3() },
    uColor: { value: new Color(0.64, 0.58, 0.5) },
  };
  private readonly lidHairU = { ...this.hairU, uLevel: { value: 0 } };
  private readonly moteU = { uT: { value: 0 }, uLevel: { value: 0 }, uFlame: this.hairU.uFlame };
  private readonly crawler = new Group();

  private readonly nailTracks: InstancedMesh;
  private readonly stX = new Float32Array(MAX_STROKES);
  private readonly stY = new Float32Array(MAX_STROKES);
  private readonly stAngle = new Float32Array(MAX_STROKES);
  private readonly stLength = new Float32Array(MAX_STROKES);
  private readonly stBorn = new Float32Array(MAX_STROKES).fill(Infinity);
  private strokeNext = 1;
  private lastBorn = -Infinity;
  private nextStroke = 0;
  private echoAt = Infinity;
  private soundIndex = 0;
  private wasScratching = false;
  private readonly handShadow: Mesh;
  private readonly handShadowMaterial: MeshBasicMaterial;

  private readonly crumbs: InstancedMesh;
  private readonly crumbBorn: Float32Array;
  private readonly crumbX: Float32Array;
  private readonly crumbY: Float32Array;
  private readonly crumbSize: Float32Array;
  private readonly crumbAim: Uint8Array;

  private readonly eyeGroup = new Group();
  private readonly eyeBall: Object3D;
  private readonly glint: Mesh;
  private readonly glintMaterial: MeshBasicMaterial;
  private readonly lensDirtMeshes: Mesh[] = [];
  private readonly overFit = new Group();
  private readonly earth: Mesh;
  private readonly fallMaterial: MeshBasicMaterial;
  private readonly fallTexture: CanvasTexture;

  private litAt = Infinity;
  private strikes = 0;
  private pressSparkAt = -Infinity;
  private shot = false;
  private seenFor = 0;
  private gazeYaw = 0;
  private lastSeconds = 0;
  private bedAir = -1;

  private earthBed: RoomVoice | null = null;
  private drone: RoomVoice | null = null;
  private glass: RoomVoice | null = null;
  private calm: RoomVoice | null = null;
  private fast: RoomVoice | null = null;
  private panic: RoomVoice | null = null;
  private flameBed: RoomVoice | null = null;
  private hairBed: RoomVoice | null = null;
  private frantic: RoomVoice | null = null;
  private other: RoomVoice | null = null;

  constructor(ctx: RoomContext) {
    super(ctx);
    const at = (s: number): number => s / this.seconds;
    const C1: V3 = [-0.06, 1.77, -0.012];
    const C2: V3 = [-0.082, 1.772, -0.03];
    this.keys = [
      { t: 0, at: EYE, yaw: 0, pitch: 12, roll: 0, fov: 60 },
      { t: at(10), at: EYE, yaw: 0, pitch: 12, roll: 0, fov: 60 },
      { t: at(15), at: [0.005, 1.78, 0], yaw: -3, pitch: 14, roll: -0.5, fov: 58 },
      { t: at(21), at: EYE, yaw: 2, pitch: 12, roll: 0.5, fov: 58 },
      { t: at(30), at: EYE, yaw: 1, pitch: 11, roll: 0, fov: 56 },
      { t: at(38), at: EYE, yaw: 3, pitch: 10, roll: -0.7, fov: 54 },
      { t: at(TURN_FROM), at: [-0.01, 1.78, 0], yaw: 8, pitch: 8, roll: 0, fov: 52 },
      { t: at(TURN_TO), at: C1, yaw: 59.3, pitch: 5.7, roll: 0, fov: 33 },
      { t: at(52.8), at: C2, yaw: 60.7, pitch: 5.9, roll: 0, fov: 30 },
      { t: 1, at: C2, yaw: 60.7, pitch: 5.9, roll: 0, fov: 30 },
    ];

    this.flame = this.light(FLAME_REST, 0xffa35a, 0, FLAME_REACH);
    this.fill = this.light([-0.04, 1.86, -0.14], 0x33586a, 0, 1.6);
    this.eyeGlow = this.light([-0.16, 1.782, -0.066], 0xaaaba4, 0, EYE_GLOW_REACH);

    const wood = this.kit.surface('wood_raw_boards', 0.9, { color: new Color(0x6b5e50), roughness: 0.92 });
    const rot = this.kit.surface('wood_rot', 0.76, { color: new Color(0x64584c), roughness: 0.95 });
    const soil = this.kit.surface('soil_dark', 0.7, { color: new Color(0x5a4c40) });
    this.buildBox(wood, rot, soil);
    this.lid.position.z = 0;
    this.root.add(this.lid);
    this.buildLid(wood);
    this.buildLining();
    this.nailTracks = this.buildTracks();
    this.lid.add(this.nailTracks);
    this.handShadowMaterial = new MeshBasicMaterial({ map: this.handShadowTexture(), color: 0x000000, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.handShadow = new Mesh(new PlaneGeometry(0.26, 0.26), this.handShadowMaterial);
    this.handShadow.position.set(0, 1.8, LID_Z + 0.0018);
    this.handShadow.renderOrder = 3;
    this.handShadow.visible = false;
    this.lid.add(this.handShadow);

    this.buildWallLeft();
    this.eyeBall = this.buildEye();
    const glint = context(48, 72);
    const glintGradient = glint.createRadialGradient(24, 40, 1, 24, 40, 24);
    glintGradient.addColorStop(0, 'rgba(255,255,255,1)');
    glintGradient.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    glintGradient.addColorStop(1, 'rgba(255,255,255,0)');
    glint.fillStyle = glintGradient;
    glint.beginPath();
    glint.moveTo(24, 2);
    glint.quadraticCurveTo(48, 36, 40, 56);
    glint.quadraticCurveTo(24, 76, 8, 56);
    glint.quadraticCurveTo(0, 36, 24, 2);
    glint.fill();
    this.glintMaterial = new MeshBasicMaterial({ map: colorTexture(glint), transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false, color: 0 });
    this.glint = new Mesh(new PlaneGeometry(GLINT_SIZE * 0.66, GLINT_SIZE), this.glintMaterial);
    this.glint.frustumCulled = false;
    this.glint.renderOrder = 7;
    this.glint.visible = false;
    this.root.add(this.glint);
    this.buildHair();

    // the flame in your hand
    const lighter = this.kit.prop('lighter_zippo', [-0.0191, -0.0513, -0.0005], {}, this.held);
    lighter.traverse((o) => {
      o.frustumCulled = false;
    });
    // its open lid turned away, edge on
    this.held.rotation.set(0, -1.13, -0.08);
    this.root.add(this.held);
    this.fist = new Mesh(new PlaneGeometry(0.22, 0.176), new MeshBasicMaterial({ map: this.fistTexture(), transparent: true, depthWrite: false, fog: false }));
    this.fist.position.set(0.012, -0.118, 0.012);
    this.fist.frustumCulled = false;
    this.held.add(this.fist);
    this.flameMesh = new Mesh(
      new PlaneGeometry(0.44, 0.44),
      new ShaderMaterial({ vertexShader: FLAME_VERTEX, fragmentShader: FLAME_FRAGMENT, uniforms: this.flameU, transparent: true, depthWrite: false, blending: AdditiveBlending }),
    );
    this.flameMesh.frustumCulled = false;
    this.flameMesh.renderOrder = 6;
    this.flameMesh.visible = false;
    this.root.add(this.flameMesh);

    this.buildAir();
    this.looseEarth();
    const made = this.buildCrumbs();
    this.crumbs = made.mesh;
    this.crumbBorn = made.born;
    this.crumbX = made.x;
    this.crumbY = made.y;
    this.crumbSize = made.size;
    this.crumbAim = made.aim;
    this.root.add(this.crumbs);

    // your own body, for whoever looks down at it; the collar is empty because you are looking out of it
    const body = this.build.headless(1, { tint: 0x35322e });
    body.set(0, 0, 0.1, 0.012, Math.PI);
    body.commit();
    this.root.add(body.root);
    const collar = new Mesh(new SphereGeometry(1, 16, 12), new MeshStandardMaterial({ color: 0x0b0a09, roughness: 1 }));
    collar.scale.set(0.2, 0.15, 0.13);
    collar.position.set(0, 1.57, 0);
    this.root.add(collar);

    this.buildLensDirt();

    this.fallTexture = this.fallingTexture();
    this.fallMaterial = new MeshBasicMaterial({ map: this.fallTexture, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
    const fall = new Mesh(new PlaneGeometry(OVER_D * 4.6, OVER_D * 2.2), this.fallMaterial);
    fall.position.z = -OVER_D;
    fall.renderOrder = 91;
    fall.frustumCulled = false;
    this.earth = new Mesh(
      new PlaneGeometry(OVER_D * 4.6, OVER_D * 4.8),
      new MeshBasicMaterial({ map: this.earthTexture(), transparent: true, depthTest: false, depthWrite: false, fog: false }),
    );
    this.earth.position.set(0, OVER_D * 3.2, -OVER_D);
    this.earth.renderOrder = 92;
    this.earth.frustumCulled = false;
    this.earth.visible = false;
    this.overFit.add(fall, this.earth);
    this.lens.add(this.overFit);

    this.placeBeats();
  }

  private looseEarth(): void {
    // the loose earth on the floor of the box, where a hand could find it
    const r = randomFrom(404);
    const rest = new InstancedMesh(new IcosahedronGeometry(1, 0), new MeshStandardMaterial({ color: 0x241810, roughness: 1 }), 220);
    rest.frustumCulled = false;
    for (let i = 0; i < 220; i++) {
      const side = r() < 0.5 ? -1 : 1;
      const y = 1.3 + r() * 0.72;
      const halfAt = y > SHOULDER_Y ? mix(SHOULDER_HALF, HEAD_HALF, (y - SHOULDER_Y) / (HEAD_Y - SHOULDER_Y)) : SHOULDER_HALF;
      const size = 0.002 + r() * r() * 0.007;
      _m.compose(_p.set(side * (halfAt - r() * r() * 0.12), y, FLOOR_Z - size * 0.5), _q.identity(), _s.set(size, size, size * 0.7));
      rest.setMatrixAt(i, _m);
    }
    rest.instanceMatrix.needsUpdate = true;
    this.root.add(rest);
  }

  private buildBox(wood: Material, rot: Material, soil: Material): void {
    const r = randomFrom(11);
    const boards: BufferGeometry[] = [];
    const rots: BufferGeometry[] = [];
    const tile = (a: number, b: number) => (u: number, v: number) => [u + a, v + b] as const;
    // the right wall above the shoulder, boards laid across
    const across = (upper: boolean, side: 1 | -1, target: BufferGeometry[]): void => {
      const place = wallPlace(side, upper);
      const length = upper ? 0.54 : 1.56;
      // the right wall's boards count the other way
      let start = side === 1 ? -length : -0.02;
      const end = side === 1 ? 0.02 : length;
      while (start < end) {
        const w = 0.085 + r() * 0.05;
        target.push(plank({ across: [start, start + w], along: [-0.37, 0.14], rows: 18, seed: r() * 90 }, place, tile(r() * 3, r() * 3)));
        start += w + 0.0028 + r() * 0.0026;
      }
    };
    across(true, 1, boards);
    across(false, 1, boards);
    across(false, -1, boards);
    // the head, the feet and the floor
    const head = (u: number, v: number, n: number): V3 => [v, HEAD_Y - n, -u];
    const feet = (u: number, v: number, n: number): V3 => [v, n, u];
    const floor = (u: number, v: number, n: number): V3 => [-u, v, FLOOR_Z - n];
    for (const [a, b] of [[-0.14, 0.015], [0.018, 0.19], [0.193, 0.38]] as const) {
      boards.push(plank({ across: [a, b], along: [-0.3, 0.3], rows: 14, seed: r() * 90 }, head, tile(r() * 3, r() * 3)));
      rots.push(plank({ across: [a, b], along: [-0.3, 0.3], rows: 8, seed: r() * 90 }, feet, tile(r() * 3, r() * 3)));
    }
    let x = -0.33;
    while (x < 0.33) {
      const w = 0.1 + r() * 0.05;
      rots.push(plank({ across: [x, x + w], along: [-0.03, 2.06], rows: 30, seed: r() * 90 }, floor, tile(r() * 3, r() * 3)));
      x += w + 0.003;
    }
    const mesh = new Mesh(mergeGeometries(boards)!, wood);
    mesh.frustumCulled = false;
    const rotten = new Mesh(mergeGeometries(rots)!, rot);
    rotten.frustumCulled = false;
    // earth pressing at the seams
    const earth = new Mesh(new PlaneGeometry(0.8, 2.3), soil);
    earth.position.set(0, 1.02, LID_Z - 0.055);
    this.root.add(mesh, rotten, earth);
    // someone has already scratched today's date over your head
    const date = this.build.label(0.2, 0.06, (c, w, h) => this.scratchedDate(c, w, h), { transparent: true, px: 2600 });
    date.mesh.position.set(-0.01, HEAD_Y - 0.0016, -0.11);
    date.mesh.rotation.x = Math.PI / 2;
    this.root.add(date.mesh);
  }

  /** Today's date, cut with a nail in straight strokes: each gone over twice, no two digits alike. */
  private scratchedDate(c: Ctx, w: number, h: number): void {
    const SEGMENTS: Record<string, readonly number[]> = { '0': [0, 1, 2, 4, 5, 6], '1': [2, 5], '2': [0, 2, 3, 4, 6], '3': [0, 2, 3, 5, 6], '4': [1, 2, 3, 5], '5': [0, 1, 3, 5, 6], '6': [0, 1, 3, 4, 5, 6], '7': [0, 2, 5], '8': [0, 1, 2, 3, 4, 5, 6], '9': [0, 1, 2, 3, 5, 6] };
    const LINES = [[0, 0, 1, 0], [0, 0, 0, 1], [1, 0, 1, 1], [0, 1, 1, 1], [0, 1, 0, 2], [1, 1, 1, 2], [0, 2, 1, 2]];
    const r = randomFrom(99);
    const text = dateNow();
    const size = h * 0.36;
    let x = (w - text.length * size * 0.92) / 2;
    c.clearRect(0, 0, w, h);
    c.lineCap = 'round';
    for (const ch of text) {
      const lift = (r() - 0.5) * size * 0.2;
      if (ch === '.') {
        c.fillStyle = 'rgba(216,186,146,0.8)';
        c.fillRect(x + size * 0.1, h * 0.5 + size * 0.9 + lift, 3.5, 3.5);
        x += size * 0.5;
        continue;
      }
      for (const n of SEGMENTS[ch] ?? []) {
        const s = LINES[n];
        for (let pass = 0; pass < 3; pass++) {
          const jx = (r() - 0.5) * 2.6;
          const jy = (r() - 0.5) * 2.6;
          c.strokeStyle = pass === 0 ? 'rgba(6,3,2,0.8)' : 'rgba(216,186,146,0.75)';
          c.lineWidth = pass === 0 ? 4.4 : 1.8;
          c.beginPath();
          c.moveTo(x + s[0] * size * 0.62 + jx + (r() - 0.5) * 3, h * 0.5 - size + s[1] * size + lift + jy);
          c.lineTo(x + s[2] * size * 0.62 + jx + (r() - 0.5) * 3, h * 0.5 - size + s[3] * size + lift + jy);
          c.stroke();
        }
      }
      x += size * 0.92;
    }
  }

  private woodImage(wood: Material): CanvasImageSource {
    return (wood as MeshStandardMaterial).map!.image as CanvasImageSource;
  }

  private buildLid(wood: MeshStandardMaterial): void {
    const { x: rx, y: ry, px } = LID_PATCH;
    const [W, H] = px;
    const pxPerM = W / (rx[1] - rx[0]);
    const X = (x: number): number => ((x - rx[0]) / (rx[1] - rx[0])) * W;
    const Y = (y: number): number => (1 - (y - ry[0]) / (ry[1] - ry[0])) * H;
    const r = randomFrom(77);
    const edges: [number, number][] = [];
    let last = rx[0] - 0.08;
    for (const seam of [...LID_SEAMS, rx[1] + 0.08]) {
      edges.push([X(last + 0.0034), X(seam - 0.0034)]);
      last = seam;
    }
    const p = new BoardPainter(W, H, r);
    p.lay(this.woodImage(wood), 1024, edges, pxPerM);
    // soot over where the lighter is held, damp, glue, earth seeping in
    p.stain(X(FLAME_REST[0]), Y(FLAME_REST[1]), 70, 92, 0.5);
    for (let i = 0; i < 16; i++) p.stain(X(-0.28 + r() * 0.56), Y(1.4 + r() * 0.64), 40 + r() * 130, 60 + r() * 260, 0.08 + r() * 0.24);
    for (let i = 0; i < 9; i++) p.mould(X(-0.26 + r() * 0.52), Y(1.45 + r() * 0.6), 30 + r() * 70, 240);
    for (const seam of LID_SEAMS) for (let i = 0; i < 9; i++) p.smear(X(seam) + (r() - 0.5) * 8, Y(1.45 + r() * 0.56), 40 + r() * 170, 7 + r() * 16);
    // hundreds of strokes, in frenzies, thickest over the face, older than anyone; and bare wood between them
    const gauss = (): number => (r() + r() + r() - 1.5) / 1.5;
    for (let k = 0; k < 50; k++) {
      const cx = X(gauss() * 0.26);
      const cy = Y(1.79 + gauss() * 0.28);
      const base = r() * 6.28;
      const n = 3 + r() * 13;
      for (let i = 0; i < n; i++) p.scratch(cx + (r() - 0.5) * 84, cy + (r() - 0.5) * 110, base + (r() - 0.5) * 0.8, 36 + r() * r() * 270, r() < 0.7 ? 4 : r() < 0.6 ? 3 : 2, 0.2 + r() * 0.75, r() < 0.12 ? 0.55 : r() * 0.15);
    }
    for (let i = 0; i < 80; i++) p.scratch(X(gauss() * 0.27), Y(1.8 + gauss() * 0.26), Math.PI / 2 + (r() - 0.5) * 0.9, 130 + r() * 430, r() < 0.5 ? 4 : 3, 0.25 + r() * 0.5, r() * 0.12);
    for (const y of [1.985, 1.41]) for (let i = 0; i < LID_SEAMS.length + 1; i++) p.nail(X(-0.243 + i * 0.122 + (r() - 0.5) * 0.02), Y(y + (r() - 0.5) * 0.008));
    // the tally: six fives and three, the last one not yet there
    const ROWS = [1.963, 1.912, 1.861, 1.81];
    const groupAt = (g: number): readonly [number, number] => [0.086 + (g % 2) * 0.046, ROWS[Math.floor(g / 2)]];
    for (let g = 0; g < 7; g++) {
      const x0 = groupAt(g)[0] + (r() - 0.5) * 0.004;
      const y0 = groupAt(g)[1] + (r() - 0.5) * 0.005;
      const marks = g === 6 ? 2 : 4;
      for (let m = 0; m < marks; m++) {
        const lean = (r() - 0.5) * 7;
        const mx = X(x0 + m * 0.0088);
        p.mark(mx + lean, Y(y0 + 0.017 + r() * 0.002), mx - lean, Y(y0 - 0.017 - r() * 0.002));
      }
      if (g !== 6) p.mark(X(x0 - 0.0052), Y(y0 - 0.015), X(x0 + 0.034), Y(y0 + 0.016));
      this.tallyMark[0] = x0 + 2 * 0.0088;
      this.tallyMark[1] = y0;
    }
    // the print's shadow of glue
    p.stain(X(0), Y(1.86), 96, 108, 0.62);
    p.vignette(0.68);

    const material = new MeshStandardMaterial({ map: colorTexture(p.color), normalMap: p.normals(2.6), normalScale: new Vector2(1.5, 1.5), roughness: 0.88 });

    const place = (u: number, v: number, n: number): V3 => [u, v, LID_Z + n];
    const uvOf = (u: number, v: number) => [(u - rx[0]) / (rx[1] - rx[0]), (v - ry[0]) / (ry[1] - ry[0])] as const;
    const tile = (u: number, v: number) => [u * 1 + 0.4, v] as const;
    const open = (seam: number) => (edge: 0 | 1, v: number): number => {
      const left = edge === 1 && seam === LID_SEAMS[1];
      const right = edge === 0 && seam === LID_SEAMS[1];
      return left || right ? 0.0045 * Math.exp(-(((v - 1.802) / 0.03) ** 2)) : 0;
    };
    const hero: BufferGeometry[] = [];
    const lower: BufferGeometry[] = [];
    let u0 = -0.36;
    for (let i = 0; i <= LID_SEAMS.length; i++) {
      const u1 = i < LID_SEAMS.length ? LID_SEAMS[i] : 0.36;
      const spec = { across: [u0 + 0.0034, u1 - 0.0034] as const, seed: 3 + i * 7.3 };
      const fn = (edge: 0 | 1, v: number): number => (edge === 0 ? (i > 0 ? open(LID_SEAMS[i - 1])(0, v) : 0) : i < LID_SEAMS.length ? open(LID_SEAMS[i])(1, v) : 0);
      hero.push(plank({ ...spec, along: [ry[0], HEAD_Y + 0.06], rows: 62, open: fn }, place, uvOf));
      lower.push(plank({ ...spec, along: [-0.05, ry[0]], rows: 24, open: fn }, place, tile));
      u0 = u1;
    }
    const heroMesh = new Mesh(mergeGeometries(hero)!, material);
    heroMesh.frustumCulled = false;
    const lowerMesh = new Mesh(mergeGeometries(lower)!, wood);
    lowerMesh.frustumCulled = false;
    this.lid.add(heroMesh, lowerMesh);

    this.buildCorners();
    this.buildPrint();

    // the earth that has got as far as the seams and stuck there
    const stuck = new InstancedMesh(new IcosahedronGeometry(1, 0), new MeshStandardMaterial({ color: 0x1d130c, roughness: 1 }), 170);
    stuck.frustumCulled = false;
    for (let i = 0; i < 170; i++) {
      const seam = LID_SEAMS[1 + Math.floor(r() * 2)] + (r() - 0.5) * 0.005;
      const size = 0.001 + r() * r() * 0.0048;
      _m.compose(_p.set(seam, 1.48 + r() * 0.54, LID_Z - 0.001 + size * 0.3), _q.setFromAxisAngle(AXIS_Z, r() * 6.28), _s.set(size, size * (0.7 + r()), size * 0.7));
      stuck.setMatrixAt(i, _m);
    }
    stuck.instanceMatrix.needsUpdate = true;
    this.lid.add(stuck);
  }

  /**
   * What makes the box a coffin and nothing else: a gathered satin lining round the top of the walls, which the flame
   * finds and so draws the tapered outline; and the points of the nails that shut the lid, come in through it.
   */
  private buildLining(): void {
    const r = randomFrom(616);
    const positions: number[] = [];
    const colors: number[] = [];
    const index: number[] = [];
    // across the frill: a rounded fold out of the corner, then the ruffle laid on the lid
    const COLUMNS = 10;
    const COVE = 6;
    for (let e = 0; e < OUTLINE.length; e++) {
      const [ax, ay] = OUTLINE[e];
      const [bx, by] = OUTLINE[(e + 1) % OUTLINE.length];
      const length = Math.hypot(bx - ax, by - ay);
      const dx = (bx - ax) / length;
      const dy = (by - ay) / length;
      const rows = Math.ceil(length / FRILL_STEP);
      const base = positions.length / 3;
      for (let row = 0; row <= rows; row++) {
        const t = (row / rows) * length;
        // gathers by hand: uneven in width and in depth, and the satin gone brown with damp in places
        const wave = (t / FRILL_PLEAT) * Math.PI * 2 + e + 3 * wobble(t * 25 + e, e + 5);
        const gather = Math.sin(wave) * (0.55 + 0.45 * wobble(t * 9 + e, e + 7));
        const stain = 1 - 0.5 * Math.max(0, wobble(t * 5 + e * 3.7, e + 2)) - 0.15 * r();
        for (let k = 0; k < COLUMNS; k++) {
          let inset: number;
          let depth: number;
          if (k < COVE) {
            const a = (k / (COVE - 1)) * (Math.PI / 2);
            const w = FRILL_DEPTH * (1 + FRILL_GATHER * gather * Math.sin(2 * a));
            inset = FRILL_OFF + (w - FRILL_OFF) * Math.sin(a);
            depth = FRILL_OFF + (w - FRILL_OFF) * Math.cos(a);
          } else {
            const u = (k - COVE + 1) / (COLUMNS - COVE);
            inset = FRILL_DEPTH + FRILL_SKIRT * u * (1 + 0.12 * Math.sin(wave + 1.3));
            depth = FRILL_OFF + 0.003 * u * (1 + gather);
          }
          // the outline runs round with the inside of the box on its left
          positions.push(ax + dx * t - dy * inset, ay + dy * t + dx * inset, LID_Z + depth);
          colors.push(stain, stain * 0.97, stain * 0.92);
        }
      }
      for (let row = 0; row < rows; row++) {
        for (let k = 0; k < COLUMNS - 1; k++) {
          const a = base + row * COLUMNS + k;
          index.push(a, a + 1, a + COLUMNS + 1, a, a + COLUMNS + 1, a + COLUMNS);
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setIndex(index);
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const lining = new Mesh(geometry, new MeshStandardMaterial({ color: FRILL_COLOR, roughness: 0.42, vertexColors: true, side: 2 }));
    lining.frustumCulled = false;
    this.lid.add(lining);

    // the points, through the ruffle along both walls and at the head
    const spots: (readonly [number, number])[] = [];
    for (const side of [-1, 1]) for (let y = HEAD_Y - 0.1; y > 0.15; y -= NAIL_GAP) spots.push([side * (boxHalf(y) - NAIL_INSET), y]);
    spots.push([-0.07, HEAD_Y - NAIL_INSET], [0.07, HEAD_Y - NAIL_INSET]);
    const nails = new InstancedMesh(new ConeGeometry(NAIL_THICK, 1, 4), new MeshStandardMaterial({ color: 0x4a3426, roughness: 0.45, metalness: 0.35, flatShading: true }), spots.length);
    nails.frustumCulled = false;
    for (let i = 0; i < spots.length; i++) {
      const long = mix(NAIL_LONG[0], NAIL_LONG[1], r()) + 0.002;
      const lean = r() * NAIL_LEAN;
      const turn = r() * Math.PI * 2;
      _v.set(Math.sin(lean) * Math.cos(turn), Math.sin(lean) * Math.sin(turn), Math.cos(lean));
      _q.setFromUnitVectors(AXIS_Y, _v);
      _p.set(spots[i][0], spots[i][1], LID_Z - 0.002).addScaledVector(_v, long * 0.5);
      _m.compose(_p, _q, _s.set(1, long, 1));
      nails.setMatrixAt(i, _m);
    }
    nails.instanceMatrix.needsUpdate = true;
    this.lid.add(nails);
  }

  /** The dark that gathers where boards meet: only the flame could light it, and it cannot reach. */
  private buildCorners(): void {
    const g = context(8, 128);
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(0,0,0,0.95)');
    grad.addColorStop(0.35, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 8, 128);
    const map = new CanvasTexture(g.canvas);
    const positions: number[] = [];
    const uvs: number[] = [];
    const quad = (p0: V3, p1: V3, q0: V3, q1: V3): void => {
      positions.push(...p0, ...p1, ...q1, ...p0, ...q1, ...q0);
      uvs.push(0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0);
    };
    const z = LID_Z + 0.0012;
    const half = boxHalf;
    for (const side of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const y0 = k === 0 ? 0 : SHOULDER_Y;
        const y1 = k === 0 ? SHOULDER_Y : HEAD_Y;
        // on the lid, along the wall
        quad([side * half(y0), y0, z], [side * half(y1), y1, z], [side * (half(y0) - 0.075), y0, z], [side * (half(y1) - 0.075), y1, z]);
        // on the wall, along the lid
        const inX = -side * 0.0014;
        quad([side * half(y0) + inX, y0, LID_Z], [side * half(y1) + inX, y1, LID_Z], [side * half(y0) + inX, y0, LID_Z + 0.075], [side * half(y1) + inX, y1, LID_Z + 0.075]);
      }
    }
    quad([-HEAD_HALF, HEAD_Y, z], [HEAD_HALF, HEAD_Y, z], [-HEAD_HALF, HEAD_Y - 0.075, z], [HEAD_HALF, HEAD_Y - 0.075, z]);
    quad([-HEAD_HALF, HEAD_Y - 0.0014, LID_Z], [HEAD_HALF, HEAD_Y - 0.0014, LID_Z], [-HEAD_HALF, HEAD_Y - 0.0014, LID_Z + 0.08], [HEAD_HALF, HEAD_Y - 0.0014, LID_Z + 0.08]);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    const material = new MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false, side: 2, color: 0x000000 });
    const mesh = new Mesh(geometry, material);
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    this.lid.add(mesh);
  }

  /** The small print glued above your eyes: too dark to see, though a thing or two is in it. */
  private buildPrint(): void {
    const c = context(352, 428);
    const W = c.canvas.width;
    const H = c.canvas.height;
    const r = randomFrom(5);
    c.fillStyle = '#4c4235';
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 3600; i++) {
      c.fillStyle = `rgba(14,9,5,${r() * 0.16})`;
      c.fillRect(r() * W, r() * H, 1 + r() * 4, 1 + r() * 4);
    }
    const g = c.createRadialGradient(W / 2, H / 2, W * 0.25, W / 2, H / 2, W * 0.72);
    g.addColorStop(0, 'rgba(20,14,8,0)');
    g.addColorStop(1, 'rgba(20,14,8,0.6)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    const side = W * 0.86;
    const x0 = (W - side) / 2;
    const y0 = W * 0.07;
    const kept = this.album.pictures[this.album.pictures.length - 1];
    c.fillStyle = '#050403';
    c.fillRect(x0, y0, side, side);
    if (kept) {
      c.globalAlpha = 0.34;
      c.drawImage(kept.canvas, x0, y0, side, side);
      c.globalAlpha = 1;
      c.fillStyle = 'rgba(3,2,2,0.84)';
      c.fillRect(x0, y0, side, side);
    }
    const material = new MeshStandardMaterial({ map: colorTexture(c), roughness: 0.5 });
    const geometry = new PlaneGeometry(0.07, 0.085, 8, 8);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const cx = Math.abs(pos.getX(i)) / 0.035;
      const cy = Math.abs(pos.getY(i)) / 0.0425;
      pos.setZ(i, Math.pow(cx * cy, 3) * 0.0035);
    }
    geometry.computeVertexNormals();
    const print = new Mesh(geometry, material);
    print.position.set(-0.002, 1.86, LID_Z + 0.002);
    print.rotation.z = 0.07;
    this.lid.add(print);
  }

  private readonly tallyMark = [0, 0];

  private buildTracks(): InstancedMesh {
    const r = randomFrom(9);
    const c = context(128, 16);
    c.clearRect(0, 0, 128, 16);
    const g = c.createLinearGradient(0, 0, 0, 16);
    g.addColorStop(0, 'rgba(6,3,2,0)');
    g.addColorStop(0.3, 'rgba(8,4,2,0.9)');
    g.addColorStop(0.48, 'rgba(232,202,160,1)');
    g.addColorStop(0.62, 'rgba(232,202,160,0.9)');
    g.addColorStop(0.78, 'rgba(8,4,2,0.8)');
    g.addColorStop(1, 'rgba(6,3,2,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 16);
    c.globalCompositeOperation = 'destination-in';
    const along = c.createLinearGradient(0, 0, 128, 0);
    along.addColorStop(0, 'rgba(0,0,0,0.5)');
    along.addColorStop(0.08, 'rgba(0,0,0,1)');
    along.addColorStop(0.82, 'rgba(0,0,0,1)');
    along.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = along;
    c.fillRect(0, 0, 128, 16);
    const geometry = new PlaneGeometry(1, 1);
    geometry.translate(0.5, 0, 0);
    const material = new MeshStandardMaterial({ map: colorTexture(c), color: 0xa89888, transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2 });
    const mesh = new InstancedMesh(geometry, material, MAX_STROKES * NAILS);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_STROKES * NAILS; i++) mesh.setMatrixAt(i, _m);
    mesh.instanceMatrix.needsUpdate = true;
    for (let i = 1; i < MAX_STROKES; i++) {
      this.stX[i] = -0.15 + r() * 0.3;
      this.stY[i] = 1.66 + r() * 0.3;
      this.stAngle[i] = -Math.PI / 2 + (r() - 0.5) * 1.0 + (r() < 0.3 ? Math.PI : 0);
      this.stLength[i] = 0.055 + r() * 0.06;
    }
    // the first is the thirty-third mark: one nail, straight, cut by no one
    this.stX[0] = this.tallyMark[0];
    this.stY[0] = this.tallyMark[1] + 0.018;
    this.stAngle[0] = -Math.PI / 2 - 0.02;
    this.stLength[0] = 0.036;
    this.stBorn[0] = TALLY_AT;
    return mesh;
  }

  private handShadowTexture(): CanvasTexture {
    const c = context(256, 256);
    c.filter = 'blur(10px)';
    c.fillStyle = '#000';
    c.strokeStyle = '#000';
    c.beginPath();
    c.ellipse(128, 178, 54, 60, 0, 0, Math.PI * 2);
    c.fill();
    c.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      c.lineWidth = 25;
      c.beginPath();
      c.moveTo(92 + i * 25, 150);
      c.lineTo(74 + i * 37, 38 + Math.abs(i - 1.4) * 14);
      c.stroke();
    }
    c.lineWidth = 27;
    c.beginPath();
    c.moveTo(176, 186);
    c.lineTo(234, 128);
    c.stroke();
    return new CanvasTexture(c.canvas);
  }

  /** The hand that holds it is below the picture, and dark: only someone who looks down finds it. */
  private fistTexture(): CanvasTexture {
    const c = context(256, 205);
    c.filter = 'blur(6px)';
    c.fillStyle = '#060403';
    c.beginPath();
    c.ellipse(122, 96, 72, 62, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(70, 150);
    c.lineTo(256, 170);
    c.lineTo(256, 205);
    c.lineTo(120, 205);
    c.closePath();
    c.fill();
    return colorTexture(c);
  }
  /** The wall at your left, with the place where two of its boards do not meet. */
  private buildWallLeft(): void {
    const wood = this.kit.surface('wood_raw_boards', 0.9);
    const { across, along0, along, px } = WALL_PATCH;
    const pxPerM = px / across;
    const X = (a: number): number => (a / across) * px;
    const Y = (v: number): number => (1 - (v - along0) / along) * px;
    const r = randomFrom(303);
    const baseGap = 0.0042;
    const list: [number, number][] = [
      [-0.03, 0.098],
      [0.1012, 0.1969],
      [0.1995, SLIT.up - baseGap],
      [SLIT.up + baseGap, 0.4105],
      [0.413, 0.58],
    ];
    const p = new BoardPainter(px, px, r);
    p.lay(this.woodImage(wood), 1024, list.map(([a, b]) => [X(a), X(b)] as [number, number]), pxPerM);
    for (let i = 0; i < 10; i++) p.stain(r() * px, r() * px, 40 + r() * 160, 50 + r() * 180, 0.1 + r() * 0.26);
    for (let i = 0; i < 6; i++) p.mould(r() * px, r() * px, 34 + r() * 70, 220);
    const sx = X(SLIT.up);
    const sy = Y(SLIT.along);
    p.stain(sx, sy, 190, 300, 0.58);
    for (let i = 0; i < 64; i++) {
      const near = r() < 0.5;
      const x = near ? sx + (r() - 0.5) * 300 : r() * px;
      const y = near ? sy + (r() - 0.5) * 420 : r() * px;
      p.scratch(x, y, (r() - 0.5) * 1.5 + (r() < 0.5 ? Math.PI : 0), 40 + r() * 170, r() < 0.7 ? 4 : 3, 0.25 + r() * 0.6, r() * 0.06);
    }
    // the gap has been worked at, from the other side: raw gouges at both its lips
    for (let i = 0; i < 26; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const v = sy + (r() - 0.5) * (i < 16 ? 190 : 360);
      p.scratch(sx + side * (12 + r() * 10), v, (side < 0 ? Math.PI : 0) + (r() - 0.5) * 1.1, 12 + r() * 44, r() < 0.5 ? 1 : 2, 0.75, 0.1 + r() * 0.22);
    }
    p.vignette(0.54);
    const material = new MeshStandardMaterial({ map: colorTexture(p.color), normalMap: p.normals(2.6), normalScale: new Vector2(1.5, 1.5), roughness: 0.88 });
    const place = wallPlace(-1, true);
    const uvOf = (u: number, v: number) => [u / across, (v - along0) / along] as const;
    const slit = (v: number): number => {
      const bump = Math.exp(-(((v - SLIT.along) / SLIT.sigma) ** 2));
      return SLIT.open * bump + 0.0016 * bump * wobble(v * 92, 3);
    };
    const boards = list.map(([a, b], i) =>
      plank(
        {
          across: [a, b],
          along: [along0 + 0.04, along0 + along - 0.02],
          rows: 72,
          seed: 40 + i * 5.1,
          open: i === 2 ? (edge, v) => (edge === 1 ? slit(v) : 0) : i === 3 ? (edge, v) => (edge === 0 ? slit(v) : 0) : undefined,
        },
        place,
        uvOf,
      ),
    );
    const mesh = new Mesh(mergeGeometries(boards)!, material);
    mesh.frustumCulled = false;
    this.root.add(mesh);
  }

  /** Who is on the other side: only an eye, and the skin round it, kept back from the gap until it is time. */
  private buildEye(): Object3D {
    // the same frame as the wall: +x into the box, +y up along it
    const t = Math.atan2(HEAD_HALF - SHOULDER_HALF, HEAD_Y - SHOULDER_Y);
    this.eyeGroup.position.set(-SHOULDER_HALF - Math.sin(t) * SLIT.up, SHOULDER_Y + Math.cos(t) * SLIT.up, SLIT.along);
    this.eyeGroup.rotation.z = t;
    this.eyeGroup.visible = false;
    this.root.add(this.eyeGroup);

    const pivot = this.kit.prop('eyeball', [0, 0, 0], { nodes: ['ball'], scale: EYE_SCALE, anchor: 'center', rotation: [0, 90, 0] }, this.eyeGroup);
    const ball = pivot.getObjectByName('ball')!;
    ball.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        const own = (m.material as MeshStandardMaterial).clone();
        own.color.setScalar(0.5);
        m.material = own;
        m.frustumCulled = false;
      }
    });

    const R = 0.0126 * EYE_SCALE;
    const A = 0.056;
    const B = 0.033;
    const geometry = new PlaneGeometry(A * 2, B * 2, 72, 44);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const d = Math.hypot(x, y);
      const onBall = Math.sqrt(Math.max(R * R - d * d, R * R * 0.15)) + 0.0008;
      const onFace = 0.0105 - 0.018 * ((x / A) ** 2 + (y / B) ** 2);
      pos.setZ(i, mix(onBall, onFace, ramp(R * 0.72, R * 1.25, d)));
    }
    geometry.computeVertexNormals();
    const material = new MeshStandardMaterial({ map: this.skinTexture(A, B), alphaTest: 0.5, roughness: 0.62 });
    const skin = new Mesh(geometry, material);
    skin.rotation.y = Math.PI / 2;
    skin.frustumCulled = false;
    this.eyeGroup.add(skin);
    // the shadow of the lids on the ball, and its veins: it stays with the lids when the ball turns
    const capGeometry = new SphereGeometry(R * 1.012, 40, 28, 0, Math.PI * 2, 0, Math.PI / 2);
    capGeometry.rotateX(Math.PI / 2);
    const capPos = capGeometry.attributes.position;
    const capUv = capGeometry.attributes.uv;
    for (let i = 0; i < capPos.count; i++) capUv.setXY(i, 0.5 + capPos.getX(i) / (2.04 * R), 0.5 + capPos.getY(i) / (2.04 * R));
    const cap = new Mesh(capGeometry, new MeshBasicMaterial({ map: this.lidShadowTexture(), transparent: true, depthWrite: false, fog: false }));
    cap.rotation.y = Math.PI / 2;
    cap.frustumCulled = false;
    cap.renderOrder = 1;
    this.eyeGroup.add(cap);
    return ball;
  }

  private lidShadowTexture(): CanvasTexture {
    const c = context(256, 256);
    const r = randomFrom(19);
    const band = (y0: number, y1: number, alpha: number): void => {
      const g = c.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, `rgba(6,3,2,${alpha})`);
      g.addColorStop(1, 'rgba(6,3,2,0)');
      c.fillStyle = g;
      c.fillRect(0, Math.min(y0, y1) - 80, 256, Math.abs(y1 - y0) + 80);
    };
    band(58, 116, 0.92);
    const low = c.createLinearGradient(0, 190, 0, 150);
    low.addColorStop(0, 'rgba(6,3,2,0.6)');
    low.addColorStop(1, 'rgba(6,3,2,0)');
    c.fillStyle = low;
    c.fillRect(0, 150, 256, 106);
    for (const side of [0, 256]) {
      const g = c.createLinearGradient(side, 0, side === 0 ? 92 : 164, 0);
      g.addColorStop(0, 'rgba(6,3,2,0.86)');
      g.addColorStop(0.42, 'rgba(6,3,2,0.5)');
      g.addColorStop(1, 'rgba(6,3,2,0)');
      c.fillStyle = g;
      c.fillRect(side === 0 ? 0 : 164, 0, 92, 256);
    }
    c.lineCap = 'round';
    for (let i = 0; i < 40; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      let x = 128 + side * (120 - r() * 10);
      let y = 128 + (r() - 0.5) * 54;
      c.strokeStyle = `rgba(52,15,13,${0.26 + r() * 0.4})`;
      c.lineWidth = 0.4 + r() * 0.8;
      c.beginPath();
      c.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x -= side * (4 + r() * 5);
        y += (r() - 0.5) * 7;
        c.lineTo(x, y);
      }
      c.stroke();
    }
    return colorTexture(c);
  }

  private skinTexture(A: number, B: number): CanvasTexture {
    const W = 768;
    const H = 452;
    const c = context(W, H);
    const r = randomFrom(61);
    const X = (x: number): number => W / 2 + (x / A) * (W / 2);
    const Y = (y: number): number => H / 2 - (y / B) * (H / 2);
    c.fillStyle = '#3f322a';
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 7200; i++) {
      c.fillStyle = r() < 0.6 ? `rgba(22,13,9,${r() * 0.2})` : `rgba(160,132,112,${r() * 0.09})`;
      c.beginPath();
      c.arc(r() * W, r() * H, 0.4 + r() * 2.6, 0, Math.PI * 2);
      c.fill();
    }
    // the folds of something very old
    c.lineCap = 'round';
    for (let i = 0; i < 90; i++) {
      const side = r() < 0.5 ? -1 : 1;
      const x0 = X(side * (0.02 + r() * 0.03));
      const y0 = Y((r() - 0.5) * 0.05);
      c.strokeStyle = `rgba(16,9,6,${0.2 + r() * 0.42})`;
      c.lineWidth = 0.8 + r() * 1.7;
      c.beginPath();
      c.moveTo(x0, y0);
      c.quadraticCurveTo(x0 + side * (30 + r() * 60), y0 + (r() - 0.5) * 40, x0 + side * (70 + r() * 140), y0 + (r() - 0.5) * 70);
      c.stroke();
    }
    const hw = 0.0208;
    const hu = 0.0078;
    const hl = 0.0062;
    const almond = (grow: number): void => {
      c.beginPath();
      c.moveTo(X(-hw - grow), Y(0));
      c.quadraticCurveTo(X(0), Y(2 * (hu + grow)), X(hw + grow), Y(0));
      c.quadraticCurveTo(X(0), Y(-2 * (hl + grow)), X(-hw - grow), Y(0));
      c.closePath();
    };
    c.save();
    c.filter = 'blur(7px)';
    c.strokeStyle = 'rgba(22,12,8,0.75)';
    c.lineWidth = 22;
    almond(0.0058);
    c.stroke();
    c.restore();
    c.save();
    c.filter = 'blur(2px)';
    c.strokeStyle = 'rgba(96,44,34,0.8)';
    c.lineWidth = 4.5;
    almond(0.0005);
    c.stroke();
    c.restore();
    // the lashes have gone white too
    const curve = (t: number, up: boolean): readonly [number, number, number, number] => {
      const x = mix(-hw, hw, t);
      const q = (up ? hu : -hl) * 4 * t * (1 - t);
      return [X(x), Y(q), (t - 0.5) * 1.5, up ? -1 : 1];
    };
    c.lineWidth = 2;
    for (let i = 0; i < 52; i++) {
      const up = i < 34;
      const t = 0.08 + r() * 0.84;
      const [x, y, fan, dir] = curve(t, up);
      const length = (up ? 22 : 10) + r() * (up ? 30 : 10);
      c.strokeStyle = `rgba(150,140,128,${0.42 + r() * 0.4})`;
      c.lineWidth = 0.7 + r() * 1;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + fan * length * 0.4, y + dir * length * 0.65, x + fan * length, y + dir * length);
      c.stroke();
    }
    // beyond the lids there is no face to speak of: it falls away into the dark
    const falling = c.createRadialGradient(W / 2, H / 2, W * 0.2, W / 2, H / 2, W * 0.39);
    falling.addColorStop(0, 'rgba(0,0,0,0)');
    falling.addColorStop(0.6, 'rgba(0,0,0,0.72)');
    falling.addColorStop(1, 'rgba(0,0,0,1)');
    c.fillStyle = falling;
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = '#000';
    almond(0);
    c.fill();
    return colorTexture(c);
  }

  private buildHair(): void {
    const r = randomFrom(2024);
    const eye = new Vector3(EYE[0], EYE[1], EYE[2]);
    const lid = new HairBuilder(eye);
    const z = LID_Z;
    const seamPick = (): number => {
      const v = r();
      return v < 0.55 ? LID_SEAMS[1] : v < 0.85 ? LID_SEAMS[2] : v < 0.94 ? LID_SEAMS[0] : LID_SEAMS[3];
    };
    const emit = (points: Vector3[], delay: number): void => lid.strand(points, 0.00014, Math.min(0.9, delay), r() * 6.28);
    for (let i = 0; i < 60; i++) {
      const seam = i < 18 ? LID_SEAMS[1] : seamPick();
      const y = 1.58 + r() * 0.42;
      const toward = r() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
      const turn = (r() < 0.5 ? -1 : 1) * (5 + r() * 9);
      lock(seam, y, z, toward + (r() - 0.5) * 0.25, turn, 0.09 + r() * r() * 0.3, 3 + Math.floor(r() * 9), i < 16 ? r() * 0.08 : 0.1 + r() * 0.62, r, emit);
    }
    for (let i = 0; i < 84; i++) {
      const seam = i < 60 ? LID_SEAMS[1] : seamPick();
      const y = i < 70 ? 1.8 + (r() - 0.5) * 0.08 : 1.62 + r() * 0.38;
      const long = r() * r();
      lid.strand(hanging(new Vector3(seam, y, z - 0.002), (r() - 0.5) * 0.17, (r() - 0.5) * 0.17, 0.03 + long * 0.13, r), 0.00015, 0.12 + r() * 0.72, r() * 6.28);
    }
    const hairMaterial = new ShaderMaterial({ vertexShader: HAIR_VERTEX, fragmentShader: HAIR_FRAGMENT, uniforms: this.hairU, side: 2 });
    const lidHairMaterial = new ShaderMaterial({ vertexShader: HAIR_VERTEX, fragmentShader: HAIR_FRAGMENT, uniforms: this.lidHairU, side: 2 });
    const lidHair = new Mesh(lid.build(), lidHairMaterial);
    lidHair.frustumCulled = false;
    this.lid.add(lidHair);

    // your own on the boards under your head
    const room = new HairBuilder(eye);
    const onFloor = (points: Vector3[]): void => room.strand(points, 0.000075, -1, r() * 6.28);
    for (let i = 0; i < 16; i++) lock(-0.12 + r() * 0.24, 1.8 + r() * 0.2, FLOOR_Z - 0.0042, r() * 6.28, (r() < 0.5 ? -1 : 1) * (9 + r() * 14), 0.05 + r() * 0.13, 3 + Math.floor(r() * 6), 0, r, onFloor);
    const roomHair = new Mesh(room.build(), hairMaterial);
    roomHair.frustumCulled = false;
    this.root.add(roomHair);

    // what comes up your legs in the dark: a head of hair, and nothing else you could swear to
    const near = new HairBuilder(new Vector3(0, 1.1, 0.1));
    for (let i = 0; i < 280; i++) {
      const a = r() * 6.28;
      const length = 0.4 + r() * 0.55;
      const lateral = (r() - 0.5) * 0.3;
      const points: Vector3[] = [];
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        points.push(new Vector3(Math.sin(a) * 0.08 + lateral * t + Math.sin(t * 9 + a) * 0.007, 0.04 + length * t, -0.16 - Math.cos(a) * 0.05 * (1 - t) - Math.sin(t * 6 + a) * 0.005));
      }
      near.strand(points, 0.0006, -1, r() * 6.28);
    }
    const crawlerHair = new Mesh(near.build(), hairMaterial);
    crawlerHair.frustumCulled = false;
    const head = new Mesh(new SphereGeometry(0.1, 20, 14), new MeshStandardMaterial({ color: 0x0a0807, roughness: 1 }));
    head.scale.set(0.9, 1.1, 0.9);
    head.position.set(0, 0, -0.11);
    this.crawler.add(head, crawlerHair);
    this.crawler.position.set(0, 0.2, 0);
    this.root.add(this.crawler);

    // the strands that reach the lens when it is late
    const onLens = new HairBuilder(new Vector3(0, 0, 0));
    for (let i = 0; i < 16; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x0 = side * (0.05 + r() * 0.04);
      const points: Vector3[] = [];
      const bow = (r() - 0.5) * 0.05;
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        points.push(new Vector3(x0 - side * t * (0.025 + r() * 0.0006) + Math.sin(t * 3.1) * bow, 0.055 - t * (0.05 + (i % 3) * 0.02), -0.082 - t * 0.012));
      }
      onLens.strand(points, 0.00016, 0.74 + r() * 0.18, r() * 6.28);
    }
    const lensHair = new Mesh(onLens.build(), lidHairMaterial);
    lensHair.frustumCulled = false;
    this.lens.add(lensHair);
  }

  private buildAir(): void {
    const r = randomFrom(71);
    const n = 90;
    const positions = new Float32Array(n * 3);
    const motes = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = (r() - 0.5) * 0.44;
      positions[i * 3 + 1] = 1.42 + r() * 0.56;
      positions[i * 3 + 2] = -0.28 + r() * 0.28;
      motes[i * 2] = r() * 6.28;
      motes[i * 2 + 1] = 2 + r() * 3.4;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aMote', new Float32BufferAttribute(motes, 2));
    const points = new Points(geometry, new ShaderMaterial({ vertexShader: MOTE_VERTEX, fragmentShader: MOTE_FRAGMENT, uniforms: this.moteU, transparent: true, depthWrite: false, blending: AdditiveBlending }));
    points.frustumCulled = false;
    points.renderOrder = 4;
    this.root.add(points);

    // what you breathe out, where the flame can find it
    const c = context(128, 128);
    for (let i = 0; i < 90; i++) {
      const x = 64 + (r() - 0.5) * 70;
      const y = 64 + (r() - 0.5) * 70;
      const g = c.createRadialGradient(x, y, 0, x, y, 8 + r() * 26);
      g.addColorStop(0, `rgba(255,255,255,${0.03 + r() * 0.06})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 128, 128);
    }
    const map = new CanvasTexture(c.canvas);
    for (let i = 0; i < 2; i++) {
      const fog = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false, color: 0 }));
      fog.frustumCulled = false;
      fog.renderOrder = 5;
      fog.rotation.z = i * 1.7;
      this.fogs.push(fog);
      this.root.add(fog);
    }
  }

  private buildCrumbs(): { mesh: InstancedMesh; born: Float32Array; x: Float32Array; y: Float32Array; size: Float32Array; aim: Uint8Array } {
    const r = randomFrom(4711);
    let n = 0;
    for (const f of CRUMB_FALLS) n += f.n;
    const born = new Float32Array(n);
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    const size = new Float32Array(n);
    const aim = new Uint8Array(n);
    let i = 0;
    for (const f of CRUMB_FALLS) {
      for (let k = 0; k < f.n; k++) {
        born[i] = mix(f.from, f.to, r() * 0.5 + (k / f.n) * 0.5);
        x[i] = f.aim ? f.x + (r() - 0.5) * f.w : LID_SEAMS[Math.floor(r() * LID_SEAMS.length)] + (r() - 0.5) * 0.004;
        y[i] = f.y + (r() - 0.5) * f.h;
        size[i] = 0.0006 + r() * r() * 0.0024;
        aim[i] = f.aim ? 1 : 0;
        i++;
      }
    }
    const mesh = new InstancedMesh(new IcosahedronGeometry(1, 0), new MeshStandardMaterial({ color: 0x3a2717, roughness: 1 }), n);
    mesh.frustumCulled = false;
    mesh.visible = false;
    return { mesh, born, x, y, size, aim };
  }

  /** Grit on the lens: it stays where it lands. */
  private buildLensDirt(): void {
    const r = randomFrom(13);
    const spots = [
      { cx: -0.06, cy: 0.05, spread: 0.16, n: 240 },
      { cx: -0.2, cy: -0.05, spread: 0.26, n: 300 },
      { cx: 0.2, cy: 0.16, spread: 0.42, n: 420 },
    ];
    for (const s of spots) {
      const c = context(1024, 576);
      for (let i = 0; i < s.n; i++) {
        const a = r() * 6.28;
        const d = r() * r() * s.spread;
        const size = 0.5 + r() * r() * r() * 3.4;
        c.fillStyle = `rgba(4,3,2,${0.6 + r() * 0.4})`;
        c.beginPath();
        c.ellipse((0.5 + (s.cx + Math.cos(a) * d) * 0.56) * 1024, (0.5 - (s.cy + Math.sin(a) * d)) * 576, size, size * (0.5 + r() * 0.5), r() * 3, 0, Math.PI * 2);
        c.fill();
      }
      const material = new MeshBasicMaterial({ map: colorTexture(c), transparent: true, depthTest: false, depthWrite: false, fog: false });
      const mesh = new Mesh(new PlaneGeometry(0.2, 0.1125), material);
      mesh.position.z = -0.074;
      mesh.renderOrder = 80;
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.lens.add(mesh);
      this.lensDirtMeshes.push(mesh);
    }
  }
  private earthTexture(): CanvasTexture {
    const W = 512;
    const H = 1024;
    const c = context(W, H);
    const r = randomFrom(88);
    c.fillStyle = '#000';
    c.fillRect(0, 0, W, H);
    const edge = (x: number): number => 640 + Math.sin(x * 0.019) * 26 + Math.sin(x * 0.073 + 1.4) * 15 + Math.sin(x * 0.21 + 3) * 7;
    c.globalCompositeOperation = 'destination-out';
    c.beginPath();
    c.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) c.lineTo(x, edge(x) + (r() - 0.5) * 7);
    c.lineTo(W, H);
    c.closePath();
    c.fill();
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#000';
    for (let i = 0; i < 2600; i++) {
      const x = r() * W;
      const down = r() * r() * r() * 380;
      c.beginPath();
      c.ellipse(x, edge(x) + down, 0.6 + r() * 3.6 * (1 - down / 380), 0.6 + r() * 4.4 * (1 - down / 380), r() * 3, 0, Math.PI * 2);
      c.fill();
    }
    return new CanvasTexture(c.canvas);
  }

  private fallingTexture(): CanvasTexture {
    const c = context(512, 256);
    const r = randomFrom(21);
    c.fillStyle = '#000';
    for (let i = 0; i < 170; i++) {
      c.beginPath();
      c.ellipse(r() * 512, r() * 256, 0.5 + r() * r() * 2, 1 + r() * 3.6, 0, 0, Math.PI * 2);
      c.fill();
    }
    const t = new CanvasTexture(c.canvas);
    t.wrapS = t.wrapT = RepeatWrapping;
    return t;
  }


  private strike(gain: number, file: string): void {
    this.sound.play(file, { gain, pan: 0.15 });
  }

  private ignite(s: number): void {
    if (this.litAt !== Infinity) return;
    this.litAt = s;
    this.hint(null);
    this.sound.play('rooms/lighter_catch.mp3', { gain: 0.45, pan: 0.15 });
    this.flameBed = this.sound.bed('rooms/lighter_flame.mp3', { gain: 0.2, fade: 0.4 });
  }

  /** Every sound is placed here. Beats fire once, also when the room is hurried. */
  private placeBeats(): void {
    const s = this.sound;
    this.beat(0, () => {
      this.earthBed = s.bed('rooms/earth_pressure.mp3', { gain: 0.3, fade: 1 });
      this.drone = s.bed('rooms/dream_drone_low.mp3', { gain: 0.05, fade: 5 });
      this.calm = s.bed('rooms/breath_calm.mp3', { gain: 0.12, fade: 2.5 });
    });
    THUDS.forEach(([at, file, gain, lowpass], i) => {
      this.beat(at, () => {
        s.play(file, { gain, lowpass });
        if (i < 4) s.play(`rooms/shovel_${(i % 3) + 1}.mp3`, { gain: gain * 0.34, lowpass: 1000, offset: 0 });
      });
    });
    this.beat(2, () => this.say({ tr: 'Sesini duyamıyorlar.', en: 'They cannot hear you.' }, 4.5));
    this.beat(3.9, () => s.play('rooms/lighter_lid.mp3', { gain: 0.32, pan: 0.15 }));
    this.beat(SPARKS[0], () => this.strike(0.42, 'rooms/lighter_wheel_1.mp3'));
    this.beat(SPARKS[1], () => this.strike(0.42, 'rooms/lighter_wheel_2.mp3'));
    this.beat(SPARKS[2], () => {
      if (this.litAt === Infinity) this.strike(0.42, 'rooms/lighter_wheel_3.mp3');
    });
    this.beat(PROMPT_LIGHT_AT, () => {
      if (this.litAt === Infinity) this.hint({ tr: 'Bas: çakmak', en: 'Press: lighter' });
    });
    this.beat(LIGHT_FALLBACK_AT, () => this.ignite(LIGHT_FALLBACK_AT));
    this.beat(14, () => {
      this.glass = s.bed('rooms/dream_drone_glass.mp3', { gain: 0.02, fade: 8 });
      this.hairBed = s.bed('rooms/hair_fingers.mp3', { gain: 0.14, fade: 7 });
    });
    this.beat(TALLY_AT, () => s.play('rooms/nails_scrape_2.mp3', { gain: 0.12, lowpass: 2600, pan: 0.25 }));
    this.beat(20, () => {
      this.calm?.gain(0, 4);
      this.fast = s.bed('rooms/breath_fast.mp3', { gain: 0.16, fade: 4 });
    });
    this.beat(TRICKLE_AT, () => s.play('rooms/dirt_trickle.mp3', { gain: 0.5, pan: -0.1 }));
    this.beat(PROMPT_SCRATCH_AT, () => {
      this.hint({ tr: 'Basılı tut: tırmala', en: 'Hold: scratch' });
      this.frantic = s.bed('rooms/nails_frantic.mp3', { gain: 0 });
    });
    this.beat(30, () => {
      s.play('rooms/lid_creak_1.mp3', { gain: 0.5 });
      this.fast?.rate(1.12, 6);
    });
    this.beat(31.2, () => {
      s.play('rooms/lid_creak_3.mp3', { gain: 0.5 });
      s.play('rooms/board_crack_4.mp3', { gain: 0.3 });
    });
    this.beat(32.4, () => s.play('rooms/wood_stress.mp3', { gain: 0.3 }));
    this.beat(36, () => this.hint(null));
    this.beat(40, () => {
      this.say({ tr: 'Üstünde iki metre var.', en: 'There are two meters above you.' }, 4.5);
      this.hairBed?.gain(0.3, 4);
    });
    this.beat(OTHER_SIDE_AT, () => {
      this.fast?.gain(0, 2);
      this.panic = s.bed('rooms/breath_panic.mp3', { gain: 0.2, fade: 2 });
      this.other = s.bed('rooms/nails_other_side.mp3', { gain: 0.35, pan: -0.82, fade: 0.2 });
    });
    // everything holds its breath while the head comes round
    this.beat(46.7, () => {
      this.other?.gain(0, 0.5);
      this.panic?.gain(0.05, 0.8);
      this.drone?.gain(0.02, 0.8);
      this.glass?.gain(0, 0.8);
      this.hairBed?.gain(0.04, 0.8);
    });
    this.beat(47.5, () => s.play('rooms/breath_in.mp3', { gain: 0.22 }));
    this.beat(FLAME_DIES_AT, () => {
      s.play('rooms/flame_out.mp3', { gain: 0.35 });
      this.flameBed?.stop(0.1);
      this.hint(null);
    });
    this.beat(CRACK_AT, () => {
      s.play('rooms/board_crack_1.mp3', { gain: 0.5 });
      s.play('rooms/earth_inrush.mp3', { gain: 0.6, lowpass: 3000, offset: 6.9, duration: 4, fade: 0.25 });
    });
    this.beat(54.5, () => s.play('rooms/board_crack_2.mp3', { gain: 0.5 }));
    this.beat(55.1, () => s.play('rooms/board_crack_3.mp3', { gain: 0.5 }));
    this.beat(54.7, () => {
      this.drone?.gain(0, 1.3);
      this.glass?.gain(0, 0.6);
    });
    this.beat(55.7, () => this.hairBed?.gain(0, 0.6));
    this.beat(56.4, () => this.panic?.stop(0.05));
    this.beat(57.2, () => this.other?.gain(0, 0.4));
    this.beat(57.85, () => this.earthBed?.gain(0, 0.25));
    this.beat(LAST_LINE_AT, () => this.say({ tr: 'Kimse gelmedi.', en: 'No one came.' }, 2));
  }

  private stroke(s: number): void {
    const slot = this.strokeNext;
    this.strokeNext = 1 + (this.strokeNext % (MAX_STROKES - 1));
    this.stBorn[slot] = s;
    this.lastBorn = s;
    this.sound.play(SCRATCH_FILES[this.soundIndex++ % SCRATCH_FILES.length], { gain: 0.3, pan: (this.stX[slot] / 0.15) * 0.25 });
    if (s >= OTHER_SIDE_AT) this.echoAt = s + ECHO_DELAY;
  }

  private writeTracks(s: number): void {
    for (let i = 0; i < MAX_STROKES; i++) {
      const age = s - this.stBorn[i];
      const tally = i === 0;
      const grow = age < 0 ? 0 : ramp(0, tally ? 1.1 : STROKE_TIME, age);
      for (let n = 0; n < NAILS; n++) {
        const index = i * NAILS + n;
        if (grow <= 0 || (tally && n > 0)) {
          _m.makeScale(0, 0, 0);
        } else {
          const angle = this.stAngle[i] + (n - 1.5) * 0.035;
          const off = tally ? 0 : (n - 1.5) * 0.0105;
          const length = this.stLength[i] * (0.82 + ((i + n * 3) % 5) * 0.06) * grow;
          _m.compose(
            _p.set(this.stX[i] + Math.cos(this.stAngle[i] + Math.PI / 2) * off, this.stY[i] + Math.sin(this.stAngle[i] + Math.PI / 2) * off, LID_Z + 0.0014),
            _q.setFromAxisAngle(AXIS_Z, angle),
            _s.set(length, TRACK_WIDTH * (tally ? 1.9 : 1), 1),
          );
        }
        this.nailTracks.setMatrixAt(index, _m);
      }
    }
    this.nailTracks.instanceMatrix.needsUpdate = true;
  }

  private airAt(s: number): number {
    if (s < this.litAt) return 0;
    const n = AIR.length;
    if (s >= AIR[n - 1][0]) return 0;
    const come = ramp(this.litAt, this.litAt + 0.4, s);
    if (s <= AIR[0][0]) return come * AIR[0][1];
    for (let i = 1; i < n; i++) {
      if (s < AIR[i][0]) return come * mix(AIR[i - 1][1], AIR[i][1], (s - AIR[i - 1][0]) / (AIR[i][0] - AIR[i - 1][0]));
    }
    return 0;
  }

  private dropAt(s: number): number {
    return LID_DROP[0] * ramp(30, 30.32, s) + (LID_DROP[1] - LID_DROP[0]) * ramp(31.18, 31.42, s);
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const input = frame.input;
    this.gazeYaw = input.gazeYaw;
    this.control.press = s >= PROMPT_LIGHT_AT && s < FLAME_DIES_AT;

    // the wheel: the first press may only spark
    if (input.pressed && s >= PROMPT_LIGHT_AT && this.litAt === Infinity) {
      this.pressSparkAt = s;
      this.strikes++;
      this.sound.play(`rooms/lighter_wheel_${(this.strikes % 2) + 3}.mp3`, { gain: 0.42, pan: 0.15 });
      if (this.strikes >= 2 || s > LIGHT_FALLBACK_AT - 0.9) this.ignite(s);
    }

    let spark = Math.max(0, 1 - Math.abs(s - this.pressSparkAt - 0.04) / 0.09);
    for (let i = 0; i < SPARKS.length; i++) {
      if (s < this.litAt) spark = Math.max(spark, 1 - Math.abs(s - SPARKS[i] - 0.04) / 0.09);
    }
    spark = Math.max(0, spark);
    const air = this.airAt(s);
    const flicker = 1 + 0.085 * wobble(s * 2.2, 3) + 0.04 * wobble(s * 3.1, 8);
    const level = Math.pow(air, 1.3) * flicker;
    const ember = ramp(EMBER_FROM, EMBER_AT, s);

    // the flame goes where the head is going
    const toLeft = ramp(45.6, 48.2, s);
    const tremble = 0.0011 + 0.0016 * ramp(30, 50, s);
    const fx = mix(FLAME_REST[0], FLAME_LEFT[0], toLeft) + tremble * wobble(s * 1.7, 2);
    const fy = mix(FLAME_REST[1], FLAME_LEFT[1], toLeft) + tremble * wobble(s * 1.3, 5);
    const fz = mix(FLAME_REST[2], FLAME_LEFT[2], toLeft);
    this.held.position.set(fx, fy, fz);
    this.flameMesh.position.set(fx, fy, fz);
    this.flameMesh.visible = level > 0.001 || spark > 0;
    const height = mix(BEAD_H, FLAME_H, Math.pow(Math.max(air, 0), 0.72));
    this.world(fx, fy + height * 0.45, fz, this.flame.position);
    const pitchPhase = breathPhase(s);
    const exhale = Math.pow(Math.max(0, Math.sin(pitchPhase)), 2);
    this.flameU.uT.value = s;
    this.flameU.uH.value = height;
    this.flameU.uW.value = mix(BEAD_H * 0.42, FLAME_W, Math.pow(air, 0.6));
    this.flameU.uLean.value = 0.08 + 0.26 * exhale - (fx > 0 ? 0.16 : -0.08);
    this.flameU.uEmber.value = ember * (1 - ramp(0.03, 0.2, air) * (1 - ember) * 2);
    this.flameU.uGain.value = Math.min(1, level * 1.7 + 0.1) * (s < this.litAt ? 0 : 1);
    this.flameU.uHalo.value = 0.075 * level + 0.003 * air;
    this.flameU.uSpark.value = spark;
    this.flameU.uSeed.value = Math.floor(s * 7) * 0.37;

    this.flame.intensity = FLAME_POWER * level * (1 + 0.04 * exhale) + spark * 0.05;
    this.flame.color.setRGB(1, mix(0.64, 0.36, ember), mix(0.35, 0.12, ember));
    this.fill.intensity = FILL_POWER * Math.min(1, level * 3);

    if (this.flameBed && Math.abs(air - this.bedAir) > 0.02) {
      this.bedAir = air;
      this.flameBed.gain(0.2 * air, 0.3);
    }

    // the hair, the dust, the breath in the flame
    const light = level + spark * 0.26;
    this.hairU.uGrow.value = 0.08 + 0.92 * Math.pow(ramp(9, 52, s), 1.05);
    this.hairU.uT.value = s;
    this.hairU.uBreath.value = exhale;
    this.hairU.uLevel.value = light;
    this.lidHairU.uLevel.value = light * (1 - 0.88 * ramp(TURN_FROM, TURN_TO, s));
    this.world(fx, fy + height * 0.45, fz, this.hairU.uFlame.value);
    this.moteU.uT.value = s;
    this.moteU.uLevel.value = light;
    this.updateBreathFog(s, level, pitchPhase);
    this.crawler.position.y = mix(0.2, 0.96, ramp(12, 54, s));

    // the lid
    const drop = this.dropAt(s);
    this.lid.position.z = drop;
    this.focus = mix(FOCUS_LID - drop, FOCUS_EYE, ramp(TURN_FROM + 0.6, TURN_TO, s));
    this.aperture = s > FLAME_DIES_AT ? 0 : mix(APERTURE_LID, APERTURE_EYE, ramp(TURN_FROM, TURN_TO, s));

    // the nails
    const lit = air > 0 && s < FLAME_DIES_AT - 0.5;
    const auto = s >= AUTO_SCRATCH_FROM && s < AUTO_SCRATCH_TO;
    const holding = input.holding && s >= PROMPT_SCRATCH_AT && lit;
    const scratching = holding || (auto && lit);
    if (this.nextStroke > s + 3) this.nextStroke = s;
    if (scratching && s >= this.nextStroke) {
      this.stroke(s);
      this.nextStroke = s + (holding ? HOLD_PERIOD * (0.8 + 0.4 * ((this.soundIndex * 7) % 3) * 0.5) : AUTO_PERIOD);
    }
    if (holding !== this.wasScratching) {
      this.wasScratching = holding;
      this.frantic?.gain(holding ? 0.2 : 0, holding ? 0.2 : 0.3);
      if (holding) this.hint(null);
    }
    if (s >= this.echoAt) {
      this.echoAt = Infinity;
      this.sound.play(SCRATCH_FILES[(this.soundIndex + 2) % SCRATCH_FILES.length], { gain: 0.2, pan: -0.85, lowpass: 1500 });
    }
    if (s < this.lastSeconds || s - this.lastBorn < STROKE_TIME + 0.06 || (s >= TALLY_AT && s <= TALLY_AT + 1.2)) this.writeTracks(s);
    this.updateHandShadow(s, level);

    this.updateCrumbs(s, drop);

    // the eye behind the wall comes up out of the dark
    this.eyeGroup.visible = s >= EYE_RISES_AT;
    if (this.eyeGroup.visible) {
      const t = Math.atan2(HEAD_HALF - SHOULDER_HALF, HEAD_Y - SHOULDER_Y);
      const back = mix(EYE_FAR, EYE_BACK, ramp(EYE_RISES_AT, EYE_RISEN_AT, s));
      const ox = -SHOULDER_HALF - Math.sin(t) * SLIT.up;
      this.eyeGroup.position.x = ox - Math.cos(t) * back;
      this.eyeGroup.position.y = SHOULDER_Y + Math.cos(t) * SLIT.up - Math.sin(t) * back;
    }

    // the flame, very small, on the wet of the eye; and when there is no flame, something colder
    const warm = Math.min(1, level * 6);
    const cold = this.eyeGlow.intensity / EYE_GLOW;
    this.glint.visible = this.eyeGroup.visible && (warm > 0.003 || cold > 0.003);
    this.glintMaterial.color.setRGB(1.5 * warm + 0.62 * cold, mix(0.55, 1.05, 1 - ember) * warm + 0.62 * cold, mix(0.18, 0.55, 1 - ember) * warm + 0.6 * cold);

    // it is on screen long enough to know what it is: click
    if (!this.shot && s >= EYE_RISEN_AT && s < FLAME_DIES_AT - 0.6) {
      const inView = !this.unseen(frame, this.eyeGroup.position.x, this.eyeGroup.position.y, this.eyeGroup.position.z, SHOT_MARGIN);
      this.seenFor = inView ? this.seenFor + frame.dt : 0;
      if (this.seenFor >= SHOT_AFTER) {
        this.shot = true;
        this.shutter();
        this.panic?.gain(0.22, 0.25);
        this.other?.gain(0.3, 1.2);
        this.drone?.gain(0.05, 0.6);
      }
    }

    // when nothing is left the eye is still there, by no light at all; and the earth comes down over it
    this.eyeGlow.intensity = EYE_GLOW * ramp(FLAME_DIES_AT - 0.15, FLAME_DIES_AT + 0.75, s) * (1 - ramp(EARTH_TO - 0.15, SILENCE_AT - 0.03, s));
    // down to just above the eye, then a long crawl across it, then all at once
    const crawl = ramp(EARTH_NEAR, EARTH_OVER, s);
    const edge = 1.05 - 0.63 * ramp(EARTH_FROM, EARTH_NEAR, s) - 0.56 * crawl - 0.96 * ramp(EARTH_OVER, EARTH_TO, s) - 0.014 * Math.sin(s * 4.1) * crawl * (1 - crawl);
    this.earth.visible = s >= EARTH_FROM;
    this.earth.position.y = (edge + 0.6) * OVER_D;
    this.film.bloom = mix(1.05, 0.6, ember);
    this.fallMaterial.opacity = ramp(EARTH_FROM - 0.2, EARTH_FROM + 0.4, s) * (1 - ramp(EARTH_TO, EARTH_TO + 0.3, s));
    this.fallTexture.offset.y = s * 0.85;

    // grit on the lens, until the eye waters it away as the head turns
    const grit = 1 - ramp(TURN_FROM, TURN_FROM + GRIT_WASHED, s);
    for (let i = 0; i < this.lensDirtMeshes.length; i++) {
      const dirt = this.lensDirtMeshes[i];
      dirt.visible = grit > 0 && s >= (i === 0 ? TRICKLE_AT + 0.38 : i === 1 ? TRICKLE_AT + 1.4 : 31.3);
      (dirt.material as MeshBasicMaterial).opacity = grit;
    }
    // eyelids: grit in the eye, the lid coming down, and the end
    this.black = Math.max(lidDown(s, TRICKLE_AT + 0.36, 0.14), lidDown(s, 31.22, 0.05) * 0.85, s >= SILENCE_AT ? 1 : 0);
    this.fear = s >= 56 ? 0.05 * (1 - ramp(56, 57.5, s)) : 0.3 + 0.62 * ramp(8, 50, s);
    this.lastSeconds = s;
  }

  private updateBreathFog(s: number, level: number, phase: number): void {
    const wrapped = phase - Math.floor(phase / (Math.PI * 2)) * Math.PI * 2;
    for (let i = 0; i < this.fogs.length; i++) {
      const u = Math.min(1, Math.max(0, wrapped / Math.PI - i * 0.18));
      const fog = this.fogs[i];
      fog.position.set(mix(-0.004, 0.02, u), mix(1.706, 1.738, u), mix(-0.066, -0.18, u));
      const size = mix(0.05, 0.17, u);
      fog.scale.set(size, size, 1);
      (fog.material as MeshBasicMaterial).color.setRGB(1.05 * level * Math.sin(u * Math.PI), 0.66 * level * Math.sin(u * Math.PI), 0.36 * level * Math.sin(u * Math.PI));
      fog.visible = s > this.litAt && u > 0 && u < 1;
    }
  }

  private updateHandShadow(s: number, level: number): void {
    const age = s - this.lastBorn;
    const active = age >= 0 && age < STROKE_TIME + 0.5;
    this.handShadow.visible = active && level > 0.02;
    if (!this.handShadow.visible) return;
    const slot = this.strokeNext === 1 ? MAX_STROKES - 1 : this.strokeNext - 1;
    const g = ramp(0, STROKE_TIME, age);
    const a = this.stAngle[slot];
    const l = this.stLength[slot] * 1.2 * g;
    // it falls up and away from the flame, large
    this.handShadow.position.x = this.stX[slot] + Math.cos(a) * l - 0.04;
    this.handShadow.position.y = this.stY[slot] + Math.sin(a) * l + 0.05;
    this.handShadow.rotation.z = a + Math.PI / 2 + (a > 0 ? Math.PI : 0);
    this.handShadowMaterial.opacity = 0.6 * Math.min(1, level * 2.2) * ramp(0, 0.1, age) * (1 - ramp(STROKE_TIME, STROKE_TIME + 0.45, age));
  }

  private updateCrumbs(s: number, drop: number): void {
    const shown = (s > 13.7 && s < 14.7) || (s > TRICKLE_AT && s < 26) || (s > 30 && s < 32.6);
    this.crumbs.visible = shown;
    if (!shown) return;
    const lidZ = LID_Z + drop;
    for (let i = 0; i < this.crumbBorn.length; i++) {
      const age = s - this.crumbBorn[i];
      const z = lidZ + 0.5 * CRUMB_FALL * age * age;
      let x = this.crumbX[i];
      let y = this.crumbY[i];
      let gone = age < 0 || z > 0.09;
      if (this.crumbAim[i]) {
        // this one comes at the eye: the air in your mouth draws it
        const u = (z - lidZ) / (-0.075 - lidZ);
        gone = gone || u >= 1;
        x = mix(x, -0.016, u);
        y = mix(y, EYE[1] - 0.004, u);
      }
      const size = gone ? 0 : this.crumbSize[i];
      _m.makeScale(size, size, size);
      _m.setPosition(x, y, z);
      this.crumbs.setMatrixAt(i, _m);
    }
    this.crumbs.instanceMatrix.needsUpdate = true;
  }

  /** The head comes round by itself unless the viewer has already turned it there; blows shake it. */
  override pose(t: number, out: RoomPose): RoomPose {
    super.pose(t, out);
    const s = t * this.seconds;
    const turned = ramp(TURN_FROM, TURN_TO, s);
    out.yaw -= turned * Math.min(Math.max(this.gazeYaw, 0), 59 * DEG);
    if (!REDUCED_MOTION) {
      let shake = 0;
      for (let i = 0; i < JOLTS.length; i++) {
        const age = s - JOLTS[i][0];
        if (age > 0 && age < 1.2) shake += JOLTS[i][1] * Math.exp(-age * 5.5) * Math.sin(age * 44);
      }
      const flinch = ramp(TRICKLE_AT + 0.33, TRICKLE_AT + 0.5, s) * (1 - ramp(TRICKLE_AT + 0.6, TRICKLE_AT + 1.8, s));
      out.pitch += shake + flinch * 0.022;
      out.yaw -= shake * 0.4 + flinch * 0.03;
      out.roll += shake * 0.7;
      out.position.y += shake * 0.25;
    }
    return out;
  }

  prepare(camera: PerspectiveCamera): void {
    this.flameMesh.quaternion.copy(camera.quaternion);
    for (const fog of this.fogs) fog.quaternion.copy(camera.quaternion);
    this.fist.lookAt(camera.position);
    const k = Math.tan((camera.fov * DEG) / 2);
    this.overFit.scale.set(k, k, 1);
    // the eye looks at the eye
    if (this.eyeGroup.visible) {
      const room = _v.copy(camera.position).sub(this.origin);
      const g = this.eyeGroup;
      const dx = room.x - g.position.x;
      const dy = room.y - g.position.y;
      const dz = room.z - g.position.z;
      const c = Math.cos(g.rotation.z);
      const n = Math.sin(g.rotation.z);
      const lx = dx * c + dy * n;
      const ly = -dx * n + dy * c;
      // in the ball's own frame (it was turned 90 degrees to face into the box)
      const bx = -dz;
      const bz = lx;
      this.eyeBall.rotation.y = Math.atan2(bx, bz);
      this.eyeBall.rotation.x = -Math.atan2(ly, Math.hypot(bx, bz));
      // the reflection lies where the way to the viewer and the way to the flame meet on the ball
      _a.copy(room).sub(g.position).normalize();
      _b.copy(this.hairU.uFlame.value).sub(this.origin).sub(g.position).normalize();
      _a.add(_b).normalize();
      this.glint.position.copy(g.position).addScaledVector(_a, 0.0126 * EYE_SCALE * GLINT_OUT);
      this.glint.quaternion.copy(camera.quaternion);
    }
  }
}
