import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type InstancedMesh,
  type Material,
  type Object3D,
  type PerspectiveCamera,
  type Texture,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SpotSpec } from '../../../config/nightmare.config';
import { REDUCED_MOTION } from '../../../config/experience.config';
import { meterUVs } from '../../dream/DreamKit';
import { randomFrom, type Crowd, type FigureSpec } from '../../dream/FigureKit';
import type { DreamLight } from '../../dream/LightPool';
import { PALETTE } from '../RoomKit';
import type { RoomAir, RoomAssets, RoomContext, RoomFilm, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import type { RoomVoice } from '../RoomSound';

type V3 = readonly [number, number, number];

/** The three flashes (s): years pass in each. The shutter keeps the third, this long after it, once its white has gone (s). */
const FLASHES = [5, 10, 15] as const;
const SHUTTER_AFTER = 0.42;
/** The old man on the stool is there only in the third flash's afterglow (s). */
const OLD_GONE = 16.5;
/** The photographer's word; the flash charging for a fourth that never comes; the cut (s). */
const LINE_AT = 20;
const CHARGE_AT = 20.9;
const CUT_AT = 23.5;

/** The studio (m): half its width, its back wall, the wall behind the camera, its ceiling. */
const HALF_W = 3.7;
const BACK_Z = -6.5;
const FRONT_Z = 2.2;
const HEIGHT = 3.8;
/** The painted backdrop (m): its middle, where it hangs, its width, its roller, the curve where it meets the floor, how far it lies on the floor. */
const DROP_X = 0.3;
const DROP_Z = -5.5;
const DROP_W = 4.0;
const DROP_TOP = 3.3;
const DROP_CURVE = 0.38;
const DROP_FLAT = 0.3;
/** How deep the waves of a cloth that was kept rolled are (m). */
const DROP_WAVE = 0.016;
/** Pixels of the painting per meter of cloth. */
const PAINT_PX = 360;
/** Where the painted horizon lies, how high the painted balustrade stands (m above the floor, on the cloth). */
const HORIZON = 1.12;
const RAIL_TOP = 0.76;
const RAIL_FOOT = 0.38;
/** How much light the old paint gives back (it has darkened). */
const PAINT_SHADE = 0x9c9a94;

/** The bench (m): its middle, its depth, its length, its seat, its legs, its apron. */
const BENCH_X = 0.35;
const BENCH_Z = -4.25;
const BENCH_L = 2.8;
const BENCH_D = 0.5;
const SEAT_TOP = 0.47;
const CUSHION = 0.075;
const APRON = 0.07;
/** The stool (your place) in front, between the two of them (m): where, how wide its seat, how thick. */
const STOOL_X = -0.02;
const STOOL_Z = -3.58;
const STOOL_R = 0.19;
const STOOL_SEAT = 0.06;
/** The folded coat on it (m): its size laid flat, how thick where it is folded double. */
const COAT_W = 0.5;
const COAT_D = 0.38;
const COAT_THICK = 0.045;
/** Where the three sit (m, rad: 0 faces the camera, positive turns them to their left). The child sits at the far end, turned away. */
const MAN_X = -0.7;
const WOMAN_X = 0.66;
const CHILD_X = 1.4;
const SIT_Z = BENCH_Z + 0.03;
const MAN_TURN = 0.16;
const WOMAN_TURN = -0.14;
const CHILD_TURN = 2.05;
/** How much smaller than its body the child is drawn: a child of seven. */
const CHILD_SIZE = 0.84;
/** Their pose: the seated clip, the moment of it (s). */
const SIT = 'm_sit_chair_idle_roll_head';
const SIT_TIME = 4.2;
const CHILD_TIME = 2;
/** The old man's thin white hair, from the back and sides of his head to his collar: strands, their length (m). */
const OLD_HAIRS = 70;
const OLD_HAIR_LENGTH: readonly [number, number] = [0.1, 0.2];
/** The velvet of the bench and the stool, and of the drape at the left (multipliers of a deep red velvet): old and gone brown. */
const VELVET = 0x4c5654;
const DRAPE = 0x46484a;
/** Their best clothes (multipliers of the bleached cloth). */
const SUIT = 0x2e3034;
const DRESS = 0x3e3539;
const SMOCK = 0x4b4842;
const GROWN_DRESS = 0x5b5650;
const OLD_SUIT = 0x55565a;
/** Grey hair: how far between the dark and the white the head is painted, how bright the hair itself is kept. */
const GREY = 0.55;
const GREY_HAIR = 0.55;
/** His hat on his knees (in his own frame, m), and how it lies on the bench once he has gone (m, rad). */
const LAP: V3 = [0.02, 0, 0.24];
const HAT_ON_BENCH: V3 = [MAN_X + 0.04, SEAT_TOP, SIT_Z + 0.02];
const HAT_TURN = 0.5;

/** The eye: the ground glass of a view camera on its stand (m, deg). */
const EYE: V3 = [0.3, 1.15, 0];
const PITCH = -3;
const FOV = 28;
/** The lens: where it is focused (m); how open it is while you compose on the glass, and stopped down for the exposure. */
const FOCUS = 4.2;
const APERTURE_GLASS = 2.2;
const APERTURE_SHOT = 0.8;

/** The one lamp of the studio, high at the front left, and its pool (cd, deg). It weakens with every flash. */
const KEY_AT: V3 = [-2.1, 3.0, -0.7];
const KEY_TARGET: V3 = [0.45, 0.45, -4.1];
const KEY_POWER = 95;
const KEY_ANGLE = 25;
const KEY_COLOR = 0xffd6a6;
const KEY_LEFT = [1, 0.93, 0.86, 0.8] as const;
/** After the old man has gone the lamp fades a little more, slowly, until the cut (share of its light, from when, s). */
const AFTER_DIM = 0.3;
const AFTER_FROM = 17;
/** How large the lamp itself is, on its stand at the front left (out of the picture: the eye cannot turn). */
const LAMP_SCALE = 1.1;
/** What the white wall at the right gives back (cd, m), and the faint light of the room (environment). */
const BOUNCE_AT: V3 = [2.6, 1.3, -2.6];
const BOUNCE_POWER = 1.3;
const BOUNCE_REACH = 4.5;
const ENV = 0.07;
/** The flash (a tray held up over the camera): its light (cd, m), how fast its white and its light fall (s), and the third's afterglow (s). */
const FLASH_AT: V3 = [0.25, 1.85, 0.35];
const FLASH_POWER = 120;
const FLASH_REACH = 14;
const WHITE_FALL = 0.15;
const LIGHT_FALL = 0.45;
const AFTERGLOW = 0.75;
/** The ground glass: dimmer than the print, the grid's squares (share of its height), how dark its lines, the cut corners (share of its height), its grain. */
const GLASS_DIM = 0.7;
const GLASS_GRID = 1 / 7;
const GLASS_LINE = 0.32;
const GLASS_CORNER = 0.06;
const GLASS_GRAIN = 0.07;
/** Exposure on the glass and on the print. */
const EXPOSURE_GLASS = 1.05;
const EXPOSURE_PRINT = 1.32;

/** Gains: the empty house, the clock on the wall at the left, the drone; how low they go before a flash and how long before it (s). */
const TONE_GAIN = 0.2;
const CLOCK_GAIN = 0.07;
const DRONE_GAIN = 0.06;
const HUSH = 0.85;
const HUSHED = 0.12;
/** How far to one side a sound sits for each meter its source is from the middle of the picture (pan per m). */
const PAN_PER_M = 0.22;

export const assets: RoomAssets = {
  models: ['fedora', 'curtains', 'potted_plant', 'stage_light'],
  materials: ['wood_floor_dark', 'velvet_red'],
  sounds: [
    'rooms/house_tone.mp3',
    'rooms/clock_tick.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/flash_powder.mp3',
    'rooms/seat_creak_2.mp3',
    'rooms/seat_creak_3.mp3',
    'rooms/seat_creak_4.mp3',
    'rooms/breath_out.mp3',
    'rooms/flash_charge.mp3',
  ],
};

/** On a screen wide enough the page cuts the picture to 2.39:1 (see main.css): the glass must fit what is seen. */
const WIDE = window.matchMedia('(min-aspect-ratio: 161/100) and (min-width: 40rem)');
const LETTERBOX = 2.39;

const GLASS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
}`;

/** The ground glass seen from under the cloth: its grid, its cut corners, its fall-off; after the first flash, only a print's soft edge. */
const GLASS_FRAG = /* glsl */ `
uniform float uGlass;
uniform float uAspect;
uniform float uBand;
varying vec2 vUv;

float grain(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  float wide = uAspect / uBand;
  vec2 q = vec2((vUv.x - 0.5) * wide, (vUv.y - 0.5) / uBand);
  vec2 edge = vec2(0.5 * wide, 0.5) - abs(q);
  float inside = smoothstep(0.0, 0.004, min(edge.x, edge.y)) * smoothstep(0.0, 0.004, edge.x + edge.y - ${GLASS_CORNER.toFixed(3)});
  float r = length(q / vec2(0.5 * wide, 0.5));
  float fall = mix(1.0, 0.16, smoothstep(0.3, 1.4, r));
  vec2 cell = q / ${GLASS_GRID.toFixed(4)};
  vec2 d = abs(fract(cell + 0.5) - 0.5) / fwidth(cell);
  float line = 1.0 - clamp(min(d.x, d.y) - 0.25, 0.0, 1.0);
  float glass = inside * fall * (1.0 - ${GLASS_LINE.toFixed(3)} * line) * (1.0 - ${GLASS_GRAIN.toFixed(3)} * grain(gl_FragCoord.xy)) * ${GLASS_DIM.toFixed(3)};
  float print = mix(1.0, 0.5, smoothstep(0.45, 1.45, r));
  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0 - mix(print, glass, uGlass));
}`;

const smooth = (a: number, b: number, v: number): number => {
  const x = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Length of the cloth from its roller to its end on the floor (m). */
const DROP_LENGTH = DROP_TOP - DROP_CURVE + (Math.PI / 2) * DROP_CURVE + DROP_FLAT;

/**
 * The painted garden of a small-town studio: a pale sky, far trees and a lake, a stone balustrade with urns, a path,
 * dark painted trees framing it. Old: stained, creased where it was rolled, its edges gone dark.
 */
function paintGarden(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(71);
  const Y = (m: number) => ((DROP_TOP - m) / DROP_LENGTH) * h;
  const blob = (x: number, y: number, r: number, color: string, alpha: number) => {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace('A', String(alpha)));
    g.addColorStop(1, color.replace('A', '0'));
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  };

  // the sky, lightest at the horizon, and its clouds
  const sky = c.createLinearGradient(0, 0, 0, Y(HORIZON));
  sky.addColorStop(0, '#2f3532');
  sky.addColorStop(0.45, '#596057');
  sky.addColorStop(1, '#9c977f');
  c.fillStyle = sky;
  c.fillRect(0, 0, w, Y(HORIZON) + 2);
  // clouds: soft, lit from the left, with darker bellies
  for (let i = 0; i < 26; i++) {
    const x = random() * w;
    const y = Y(HORIZON + 0.35 + random() * 1.4);
    const r = (0.05 + random() * 0.09) * w;
    blob(x + r * 0.25, y + r * 0.2, r, 'rgba(30,34,30,A)', 0.18 + random() * 0.12);
    blob(x, y, r * 0.8, 'rgba(196,190,168,A)', 0.2 + random() * 0.2);
  }

  // far hills and the trees along the lake
  c.fillStyle = '#80816f';
  c.beginPath();
  c.moveTo(0, Y(HORIZON));
  for (let x = 0; x <= w; x += w / 40) c.lineTo(x, Y(HORIZON + 0.07 + 0.05 * Math.sin(x * 0.006 + 1) + 0.03 * Math.sin(x * 0.017)));
  c.lineTo(w, Y(HORIZON));
  c.fill();
  for (let i = 0; i < 90; i++) {
    const x = random() * w;
    const y = Y(HORIZON + 0.02 + random() * 0.16);
    blob(x, y, (0.012 + random() * 0.03) * w, random() < 0.5 ? 'rgba(72,80,66,A)' : 'rgba(58,66,54,A)', 0.7 + random() * 0.3);
  }
  // two tall dark trees standing over the far shore
  for (const [u, top] of [[0.27, 2.25], [0.7, 2.05]] as const) {
    for (let i = 0; i < 26; i++) {
      const up = random();
      // narrower toward the crown
      const spread = 0.008 + 0.03 * (1 - up);
      blob(u * w + (random() - 0.5) * spread * w, Y(HORIZON + up * (top - HORIZON)), (0.012 + random() * 0.016 * (1.3 - up)) * w, 'rgba(46,54,44,A)', 0.8);
    }
  }

  // the lake, with the sky in it
  const lake = c.createLinearGradient(0, Y(HORIZON), 0, Y(HORIZON - 0.16));
  lake.addColorStop(0, '#a9a690');
  lake.addColorStop(1, '#8b8b78');
  c.fillStyle = lake;
  c.fillRect(0, Y(HORIZON), w, Y(HORIZON - 0.16) - Y(HORIZON));
  c.strokeStyle = 'rgba(220,214,192,0.35)';
  for (let i = 0; i < 40; i++) {
    const y = Y(HORIZON - random() * 0.15);
    const x = random() * w;
    c.lineWidth = 1 + random() * 1.5;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + (0.02 + random() * 0.08) * w, y);
    c.stroke();
  }

  // the lawn and the path running down to the balustrade
  const lawn = c.createLinearGradient(0, Y(HORIZON - 0.16), 0, h);
  lawn.addColorStop(0, '#6a6c58');
  lawn.addColorStop(0.5, '#56584a');
  lawn.addColorStop(1, '#2e2f28');
  c.fillStyle = lawn;
  c.fillRect(0, Y(HORIZON - 0.16), w, h);
  c.fillStyle = 'rgba(150,144,120,0.55)';
  c.beginPath();
  c.moveTo(w * 0.47, Y(HORIZON - 0.16));
  c.lineTo(w * 0.53, Y(HORIZON - 0.16));
  c.lineTo(w * 0.64, Y(RAIL_TOP));
  c.lineTo(w * 0.36, Y(RAIL_TOP));
  c.fill();

  // the balustrade: rails, posts with urns on them, and balusters between, lit from the left
  const stone = (x0: number, y0: number, x1: number, y1: number) => {
    const g = c.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, '#c9c0a6');
    g.addColorStop(0.55, '#a39b84');
    g.addColorStop(1, '#6e6857');
    c.fillStyle = g;
    c.fillRect(x0, y0, x1 - x0, y1 - y0);
  };
  const left = w * 0.08;
  const right = w * 0.92;
  const posts = [0.08, 0.3, 0.5, 0.7, 0.92];
  const postW = w * 0.034;
  const rail = Y(RAIL_TOP);
  const railLow = Y(RAIL_TOP - 0.07);
  const foot = Y(RAIL_FOOT + 0.07);
  const ground = Y(RAIL_FOOT);
  for (let u = 0.08; u < 0.92; u += 0.0185) {
    if (posts.some((p) => Math.abs(p - u) < 0.03)) continue;
    const x = u * w;
    const bw = w * 0.0072;
    const g = c.createLinearGradient(x - bw * 1.4, 0, x + bw * 1.4, 0);
    g.addColorStop(0, '#cfc6ad');
    g.addColorStop(0.5, '#a49c84');
    g.addColorStop(1, '#5d5848');
    c.fillStyle = g;
    // a turned baluster: a thin neck, a full belly, a foot
    c.beginPath();
    const top = railLow;
    const tall = foot - top;
    c.moveTo(x - bw * 0.9, top);
    c.lineTo(x + bw * 0.9, top);
    c.bezierCurveTo(x + bw * 0.5, top + tall * 0.18, x + bw * 1.5, top + tall * 0.55, x + bw * 1.1, top + tall * 0.86);
    c.lineTo(x + bw * 1.2, foot);
    c.lineTo(x - bw * 1.2, foot);
    c.lineTo(x - bw * 1.1, top + tall * 0.86);
    c.bezierCurveTo(x - bw * 1.5, top + tall * 0.55, x - bw * 0.5, top + tall * 0.18, x - bw * 0.9, top);
    c.fill();
  }
  stone(left, rail, right, railLow);
  stone(left, foot, right, ground);
  c.fillStyle = 'rgba(20,18,14,0.35)';
  c.fillRect(left, railLow, right - left, (railLow - rail) * 0.35);
  for (const u of posts) {
    const x = u * w;
    stone(x - postW / 2, Y(RAIL_TOP + 0.05), x + postW / 2, ground);
    stone(x - postW * 0.62, Y(RAIL_TOP + 0.07), x + postW * 0.62, Y(RAIL_TOP + 0.03));
    if (u === 0.3 || u === 0.7) {
      // an urn with something trailing out of it
      const base = Y(RAIL_TOP + 0.07);
      const g = c.createLinearGradient(x - postW, 0, x + postW, 0);
      g.addColorStop(0, '#c4bba1');
      g.addColorStop(1, '#5f5a4a');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(x - postW * 0.25, base);
      c.lineTo(x + postW * 0.25, base);
      c.lineTo(x + postW * 0.2, base - h * 0.012);
      c.bezierCurveTo(x + postW * 0.9, base - h * 0.03, x + postW * 0.75, base - h * 0.06, x + postW * 0.62, base - h * 0.065);
      c.lineTo(x - postW * 0.62, base - h * 0.065);
      c.bezierCurveTo(x - postW * 0.75, base - h * 0.06, x - postW * 0.9, base - h * 0.03, x - postW * 0.2, base - h * 0.012);
      c.fill();
      for (let i = 0; i < 18; i++) blob(x + (random() - 0.5) * postW * 1.6, base - h * (0.07 + random() * 0.03), postW * (0.2 + random() * 0.3), 'rgba(54,62,48,A)', 0.85);
    }
  }

  // dark painted trees down both sides, framing it all
  for (const side of [0, 1]) {
    for (let i = 0; i < 160; i++) {
      const across = random() ** 1.6 * 0.17;
      const x = side ? w * (1 - across) : w * across;
      const y = random() * Y(RAIL_FOOT);
      blob(x, y, (0.02 + random() * 0.05) * w, random() < 0.6 ? 'rgba(34,40,32,A)' : 'rgba(52,60,46,A)', 0.55 + random() * 0.4);
    }
    const trunkX = side ? w * 0.955 : w * 0.045;
    c.fillStyle = 'rgba(30,26,20,0.85)';
    c.fillRect(trunkX - w * 0.008, Y(1.7), w * 0.016, Y(0) - Y(1.7));
  }

  // the brush: short strokes of light and dark all over
  for (let i = 0; i < 5200; i++) {
    const x = random() * w;
    const y = random() * h;
    const a = random() * Math.PI;
    const l = 3 + random() * 9;
    c.strokeStyle = random() < 0.5 ? `rgba(240,232,210,${0.03 + random() * 0.05})` : `rgba(10,10,6,${0.04 + random() * 0.06})`;
    c.lineWidth = 1 + random() * 2;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l * 0.4);
    c.stroke();
  }
  // years: water stains, creases where it was rolled, the edges and the foot gone dark
  for (let i = 0; i < 22; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = (0.02 + random() * 0.08) * w;
    c.strokeStyle = `rgba(70,52,30,${0.12 + random() * 0.14})`;
    c.lineWidth = 2;
    c.beginPath();
    c.ellipse(x, y, r, r * (0.6 + random() * 0.5), random() * 3, 0, Math.PI * 2);
    c.stroke();
    blob(x, y, r, 'rgba(90,70,40,A)', 0.1 + random() * 0.1);
  }
  for (let i = 1; i < 7; i++) {
    const y = (i / 7) * Y(0) + (random() - 0.5) * h * 0.03;
    const g = c.createLinearGradient(0, y - 6, 0, y + 6);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.45, 'rgba(255,248,230,0.1)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, y - 6, w, 12);
  }
  const sides = c.createLinearGradient(0, 0, w, 0);
  sides.addColorStop(0, 'rgba(0,0,0,0.55)');
  sides.addColorStop(0.12, 'rgba(0,0,0,0)');
  sides.addColorStop(0.88, 'rgba(0,0,0,0)');
  sides.addColorStop(1, 'rgba(0,0,0,0.55)');
  c.fillStyle = sides;
  c.fillRect(0, 0, w, h);
  const footDark = c.createLinearGradient(0, Y(0.5), 0, h);
  footDark.addColorStop(0, 'rgba(0,0,0,0)');
  footDark.addColorStop(1, 'rgba(0,0,0,0.6)');
  c.fillStyle = footDark;
  c.fillRect(0, Y(0.5), w, h - Y(0.5));
}

/** The backdrop as a sheet: hanging from its roller, bending onto the floor, with the soft waves of a cloth kept rolled. */
function backdropGeometry(): BufferGeometry {
  const cols = 72;
  const rows = 64;
  const hang = DROP_TOP - DROP_CURVE;
  const arc = (Math.PI / 2) * DROP_CURVE;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const s = (j / rows) * DROP_LENGTH;
    let y = 0;
    let z = 0;
    if (s <= hang) {
      y = DROP_TOP - s;
    } else if (s <= hang + arc) {
      const a = (s - hang) / DROP_CURVE;
      y = DROP_CURVE - DROP_CURVE * Math.sin(a);
      z = DROP_CURVE - DROP_CURVE * Math.cos(a);
    } else {
      y = 0.004;
      z = DROP_CURVE + (s - hang - arc);
    }
    // the waves are strongest halfway down and die out where it bends
    const waving = smooth(0, 0.9, s) * (1 - smooth(hang - 0.9, hang, s));
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const x = (u - 0.5) * DROP_W;
      const wave = DROP_WAVE * (Math.sin(x * 5.3 + 0.4) * 0.6 + Math.sin(x * 12.7 + 2.1) * 0.3 + Math.sin(x * 27 + s * 1.3) * 0.1) * waving;
      positions.push(x, y, z + wave);
      uvs.push(u, 1 - s / DROP_LENGTH);
      if (i < cols && j < rows) {
        const a = j * (cols + 1) + i;
        index.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Wool of a good overcoat: dark brown-grey, a herringbone you see only close to. */
function drawWool(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(5);
  c.fillStyle = '#2a2622';
  c.fillRect(0, 0, w, h);
  const step = w / 32;
  for (let x = 0; x < w; x += step) {
    const flip = Math.floor(x / step) % 2 ? 1 : -1;
    for (let y = 0; y < h; y += step * 0.5) {
      c.strokeStyle = random() < 0.5 ? 'rgba(120,108,92,0.35)' : 'rgba(10,8,6,0.35)';
      c.lineWidth = step * 0.22;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + step, y + flip * step * 0.45);
      c.stroke();
    }
  }
  for (let i = 0; i < 400; i++) {
    c.fillStyle = `rgba(${random() < 0.5 ? '160,150,130' : '0,0,0'},${0.05 + random() * 0.1})`;
    c.fillRect(random() * w, random() * h, 1 + random() * 2, 1 + random() * 2);
  }
}

/** A folded coat laid on the stool: a soft slab of wool on the round seat, its edges falling over it, one sleeve hanging. */
function coatGeometry(): BufferGeometry {
  const slab = new PlaneGeometry(COAT_W, COAT_D, 30, 26);
  slab.rotateX(-Math.PI / 2);
  const p = slab.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z);
    // folded double: thickest along the fold, lumps of wool
    let y = COAT_THICK * (0.75 + 0.25 * Math.cos((x / COAT_W) * Math.PI)) + 0.004 * Math.sin(x * 37 + z * 11) * Math.sin(z * 29);
    let k = 1;
    const over = r - STOOL_R;
    if (over > 0) {
      // past the seat's edge the heavy cloth bends down a little and draws in under itself
      k = (STOOL_R + over * 0.55) / r;
      y -= over * 0.75 + over * over * 3;
    }
    p.setXYZ(i, x * k, y, z * k);
  }
  slab.computeVertexNormals();
  // the collar, rolled along the back of the fold
  const collar = new TubeGeometry(
    new CatmullRomCurve3([new Vector3(-0.2, COAT_THICK * 0.8, -0.13), new Vector3(-0.07, COAT_THICK * 1.25, -0.165), new Vector3(0.07, COAT_THICK * 1.25, -0.165), new Vector3(0.2, COAT_THICK * 0.8, -0.13)]),
    16,
    0.022,
    8,
    false,
  );
  // one sleeve has slipped out of the fold and hangs down the front
  const sleeve = new TubeGeometry(
    new CatmullRomCurve3([new Vector3(0.1, COAT_THICK * 0.9, 0.12), new Vector3(0.12, COAT_THICK * 0.4, 0.2), new Vector3(0.13, -0.1, 0.215), new Vector3(0.12, -0.27, 0.205)]),
    20,
    0.038,
    12,
    false,
  );
  const parts = [slab, collar, sleeve].map((g) => {
    g.deleteAttribute('uv');
    return g.toNonIndexed();
  });
  return meterUVs(mergeGeometries(parts)!);
}

/** The lowest point of a body under its hips (m above its feet): where it rests on a seat. */
function seatOf(crowd: Crowd): number {
  let low = Infinity;
  for (const child of crowd.root.children) {
    const mesh = child as InstancedMesh;
    if (/opacity/.test((mesh.material as Material).name)) continue;
    const p = mesh.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) if (p.getX(i) ** 2 + p.getZ(i) ** 2 < 0.01) low = Math.min(low, p.getY(i));
  }
  return Number.isFinite(low) ? low : SEAT_TOP;
}

/** The highest point of a body around a place in its own frame, under `below` (m): where something laid there rests. */
function topOf(crowd: Crowd, x: number, z: number, reach: number, below: number): number {
  let high = -Infinity;
  for (const child of crowd.root.children) {
    const p = (child as InstancedMesh).geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < below && (p.getX(i) - x) ** 2 + (p.getZ(i) - z) ** 2 < reach * reach) high = Math.max(high, y);
    }
  }
  return Number.isFinite(high) ? high : below;
}

/** The middle of a body's skull in its own frame (m): the middle of what its head's map covers in the top fifth of a meter. */
function skullOf(crowd: Crowd): Vector3 {
  const middle = new Vector3();
  for (const child of crowd.root.children) {
    const mesh = child as InstancedMesh;
    if (!/head/.test((mesh.material as Material).name)) continue;
    const p = mesh.geometry.getAttribute('position');
    let top = -Infinity;
    for (let i = 0; i < p.count; i++) top = Math.max(top, p.getY(i));
    let n = 0;
    let low = Infinity;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < top - 0.2) continue;
      middle.x += p.getX(i);
      middle.z += p.getZ(i);
      low = Math.min(low, p.getY(i));
      n++;
    }
    middle.set(middle.x / Math.max(1, n), (top + low) / 2, middle.z / Math.max(1, n));
  }
  return middle;
}

/**
 * An old man's thin white hair: from round the back and the sides of a bald head down over the ears to the collar,
 * as flat strands in the head's own frame (the middle of the skull at the origin, the face toward +Z).
 */
function oldHair(): BufferGeometry {
  const random = randomFrom(29);
  const positions: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  const segments = 6;
  const skull = 0.095;
  let base = 0;
  for (let s = 0; s < OLD_HAIRS; s++) {
    // round the back of the head, from ear to ear
    const a = Math.PI * (0.25 + 1.5 * random());
    const dx = Math.cos(a);
    const dz = -Math.abs(Math.sin(a)) * 0.9 + 0.15 * Math.sign(Math.sin(a));
    const length = OLD_HAIR_LENGTH[0] + random() * (OLD_HAIR_LENGTH[1] - OLD_HAIR_LENGTH[0]);
    const width = 0.0012 + random() * 0.0018;
    const rootY = 0.03 - random() * 0.05;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const out = skull + 0.006 + t * 0.012;
      const x = dx * out + Math.sin(t * 4 + s) * 0.004;
      const y = rootY - t * length;
      const z = dz * out - t * 0.01;
      const w = width * (1 - t * 0.6);
      positions.push(x - dz * w, y, z + dx * w, x + dz * w, y, z - dx * w);
      normals.push(dx, 0.2, dz, dx, 0.2, dz);
      if (i < segments) {
        const b = base + i * 2;
        index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    base += (segments + 1) * 2;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setIndex(index);
  return g;
}

/** Two of a head's maps laid one over the other: hair halfway between dark and white. */
function blendMaps(dark: Texture, white: Texture, amount: number): CanvasTexture {
  const a = dark.image as HTMLCanvasElement;
  const b = white.image as HTMLCanvasElement;
  const t = canvasTexture(a.width, a.height, (c, w, h) => {
    c.drawImage(a, 0, 0, w, h);
    c.globalAlpha = amount;
    c.drawImage(b, 0, 0, w, h);
  });
  t.flipY = dark.flipY;
  t.wrapS = dark.wrapS;
  t.wrapT = dark.wrapT;
  return t;
}

/** One who sits for the portrait, in the four stretches of the room (before the first flash, after each). */
interface Sitter {
  root: Object3D;
  from: number;
  to: number;
}

/**
 * A small-town photographer's studio, seen on the ground glass of a view camera from under its black cloth: upside
 * down, dim, gridded. A painted garden, a bench, a family in their best clothes with their faces scratched out, and
 * between the man and the woman an empty stool with a folded coat on it. Three flashes, and years pass in each: the
 * hair goes grey, then white; the child is grown; the man is gone and his hat lies on the bench; for a moment an old
 * white-haired man sits on the stool. Then it is empty, and the photographer asks them to smile.
 */
export default class Studio extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x0c1112, density: 0.018 },
    env: 'evening',
    envIntensity: ENV,
    sky: 0,
    grade: { exposure: EXPOSURE_GLASS, saturation: 0.6, warmth: 0.01, tint: -0.02, flare: 0.002 },
  };
  film: RoomFilm = { bloom: 0.6, bloomFrom: 0.75, bloomTint: [1, 0.94, 0.84], grain: 0.44, scratches: 0.07, flicker: 0.02, weave: REDUCED_MOTION ? 0 : 0.0003 };
  control = { look: false, scroll: true };
  focus = FOCUS;
  aperture = APERTURE_GLASS;
  drift = 0;
  fear = 0.3;

  private readonly glass = { uGlass: { value: 1 }, uAspect: { value: 16 / 9 }, uBand: { value: 1 } };
  private readonly key: SpotSpec;
  private readonly flashLight: DreamLight;
  private readonly sitters: Sitter[] = [];
  private readonly oldMan: Object3D;
  private readonly coat: Mesh;
  private readonly hat: Object3D;
  private readonly hatOnLap = new Vector3();
  private readonly motes: { value: number };
  private stage = -1;
  private oldThere = false;
  private shadowFrames = 0;
  private tone: RoomVoice | null = null;
  private clock: RoomVoice | null = null;
  private drone: RoomVoice | null = null;

  constructor(ctx: RoomContext) {
    super(ctx);
    // fixed on its stand; on the glass the picture stands on its head, and the first flash rights it
    const turned = (FLASHES[0] - 0.02) / this.seconds;
    const righted = FLASHES[0] / this.seconds;
    const pose = (t: number, roll: number): RoomKey => ({ t, at: EYE, yaw: 0, pitch: PITCH, roll, fov: FOV });
    this.keys = [pose(0, 180), pose(turned, 180), pose(righted, 0), pose(1, 0)];

    this.buildRoom();
    this.buildBackdrop();
    const velvet = this.kit.surface('velvet_red', 0.3, { color: new Color(VELVET) });
    this.buildBench(velvet);
    this.buildStool(velvet);
    this.coat = new Mesh(coatGeometry(), new MeshStandardMaterial({ map: this.wool(), roughness: 0.95 }));
    this.coat.position.set(STOOL_X, SEAT_TOP, STOOL_Z);
    this.coat.rotation.y = 0.12;
    this.coat.castShadow = true;
    this.coat.receiveShadow = true;
    this.root.add(this.coat);

    // the family, as they are in each stretch
    const man: FigureSpec = { avatar: 'figure_man', clip: SIT, time: SIT_TIME, face: 'scratched', tint: SUIT, bleach: 0.55 };
    const woman: FigureSpec = { avatar: 'figure_woman', clip: SIT, time: SIT_TIME, face: 'scratched', tint: DRESS, bleach: 0.5 };
    const child: FigureSpec = { avatar: 'figure_child', clip: SIT, time: CHILD_TIME, face: 'scratched', tint: SMOCK, bleach: 0.5 };
    const manWhite = this.sit({ ...man, white: true }, MAN_X, SIT_Z, MAN_TURN, 2, 2);
    const manDark = this.sit({ ...man, white: false }, MAN_X, SIT_Z, MAN_TURN, 0, 0);
    this.sitGrey(man, manWhite, MAN_X, SIT_Z, MAN_TURN);
    const womanWhite = this.sit({ ...woman, white: true }, WOMAN_X, SIT_Z, WOMAN_TURN, 2, 3);
    this.sit({ ...woman, white: false }, WOMAN_X, SIT_Z, WOMAN_TURN, 0, 0);
    this.sitGrey(woman, womanWhite, WOMAN_X, SIT_Z, WOMAN_TURN);
    this.sit({ ...child, white: false }, CHILD_X, SIT_Z - 0.06, CHILD_TURN, 0, 0, CHILD_SIZE);
    this.sitGrey(child, this.kit.figures.crowd({ ...child, white: true }, 1), CHILD_X, SIT_Z - 0.06, CHILD_TURN, CHILD_SIZE);
    this.sit({ avatar: 'figure_woman', clip: SIT, time: SIT_TIME, face: 'scratched', tint: GROWN_DRESS, bleach: 0.6, white: true }, CHILD_X, SIT_Z - 0.06, CHILD_TURN, 2, 3);

    // you, as the photograph can only picture you: old, white-haired, no face it ever saw
    const old = this.sit({ avatar: 'figure_man', clip: SIT, time: SIT_TIME, face: 'blank', tint: OLD_SUIT, bleach: 0.7, white: true }, STOOL_X, STOOL_Z, 0, 9, 9);
    const skull = skullOf(old);
    const hair = new Mesh(oldHair(), new MeshStandardMaterial({ color: 0xe2ded4, roughness: 0.55, side: DoubleSide }));
    hair.position.set(STOOL_X + skull.x, SEAT_TOP - seatOf(old) + skull.y, STOOL_Z + skull.z);
    hair.castShadow = true;
    hair.frustumCulled = false;
    old.root.add(hair);
    this.oldMan = old.root;

    // his hat on his knees, and on the bench once he is gone
    const c = Math.cos(MAN_TURN);
    const s = Math.sin(MAN_TURN);
    const hips = seatOf(manDark);
    const lapY = SEAT_TOP - hips + topOf(manDark, LAP[0], LAP[2], 0.07, hips + 0.3);
    this.hatOnLap.set(MAN_X + LAP[0] * c + LAP[2] * s, lapY - 0.012, SIT_Z - LAP[0] * s + LAP[2] * c);
    this.hat = this.kit.prop('fedora', [0, 0, 0], { castShadow: true }, this.root);

    this.buildStudio();
    this.motes = this.build.motes(240, { x: [-2.2, 2.6], y: [0.2, 3.1], z: [-5.3, -1.2] }, this.root, { size: 0.006, strength: 0.3, color: 0xe8dcc4, seed: 17 }).time;

    // the light: one lamp, what the wall gives back, and the flash
    this.key = this.spot(KEY_AT, KEY_TARGET, KEY_COLOR, KEY_POWER, KEY_ANGLE, 0.8);
    this.spots = [this.key, null, null];
    this.light(BOUNCE_AT, 0xd8c8b0, BOUNCE_POWER, BOUNCE_REACH);
    this.flashLight = this.light(FLASH_AT, 0xfff3e2, 0, FLASH_REACH);

    // the ground glass, laid over the whole picture
    const glass = new Mesh(
      new PlaneGeometry(1, 1),
      new ShaderMaterial({ vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG, uniforms: this.glass, transparent: true, depthTest: false, depthWrite: false }),
    );
    glass.frustumCulled = false;
    glass.renderOrder = 10;
    this.lens.add(glass);

    this.buildSound();
  }

  /** A body sitting on the bench or the stool, there in stretches `from` to `to` (9: only by hand). */
  private sit(spec: FigureSpec, x: number, z: number, heading: number, from: number, to: number, size = 1): Crowd {
    const crowd = this.kit.figures.crowd(spec, 1);
    this.place(crowd, x, z, heading, from, to, size);
    return crowd;
  }

  private place(crowd: Crowd, x: number, z: number, heading: number, from: number, to: number, size: number): void {
    crowd.set(0, x, SEAT_TOP - seatOf(crowd) * size, z, heading, size);
    crowd.commit();
    crowd.root.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = true;
    });
    crowd.root.visible = false;
    this.root.add(crowd.root);
    this.sitters.push({ root: crowd.root, from, to });
  }

  /** The same body after the first flash: its head painted between its dark and its white map, its hair greyed. */
  private sitGrey(spec: FigureSpec, white: Crowd, x: number, z: number, heading: number, size = 1): void {
    const crowd = this.kit.figures.crowd({ ...spec, white: false }, 1);
    const pale = white.root.children as InstancedMesh[];
    for (const part of crowd.root.children as InstancedMesh[]) {
      const own = part.material as MeshStandardMaterial;
      const twin = pale.find((m) => (m.material as Material).name === own.name)?.material as MeshStandardMaterial | undefined;
      if (!twin) continue;
      if (/head/.test(own.name) && own.map && twin.map) {
        const head = own.clone();
        head.map = blendMaps(own.map, twin.map, GREY);
        part.material = head;
        part.userData.shared = false;
      } else if (/opacity/.test(own.name)) {
        const hair = twin.clone();
        hair.color.multiplyScalar(GREY_HAIR);
        part.material = hair;
        part.userData.shared = false;
      }
    }
    this.place(crowd, x, z, heading, 1, 1, size);
  }

  private wool(): CanvasTexture {
    const t = canvasTexture(256, 256, drawWool);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.setScalar(1 / 0.12);
    return t;
  }

  /** Floor, walls, ceiling: a closed room, damp paper over dark panelling, old boards, a worn rug under the bench. */
  private buildRoom(): void {
    const b = this.build;
    const k = this.kit;
    const shell = b.box(HALF_W * 2, FRONT_Z - BACK_Z, HEIGHT, { walls: b.damask(PALETTE.damaskTeal, 0.8), ceiling: b.paint(0x1b1d1a, 0.95) }, this.root);
    shell.position.z = FRONT_Z;
    this.root.add(k.floor(-HALF_W, HALF_W, BACK_Z, FRONT_Z, 0, k.surface('wood_floor_dark', 2, { color: new Color(0x9a8f84) })));
    b.wainscot(0, BACK_Z + 0.005, HALF_W * 2, '+z', this.root);
    b.wainscot(-HALF_W + 0.005, (BACK_Z + FRONT_Z) / 2, FRONT_Z - BACK_Z, '+x', this.root);
    b.wainscot(HALF_W - 0.005, (BACK_Z + FRONT_Z) / 2, FRONT_Z - BACK_Z, '-x', this.root);
    b.wainscot(0, FRONT_Z - 0.005, HALF_W * 2, '-z', this.root);
    const rug = k.block(3.5, 0.012, 1.9, b.carpet('#2c2420', 0.7));
    rug.position.set(BENCH_X - 0.1, 0.006, BENCH_Z + 0.35);
    this.root.add(rug);
    b.contactShadow(BENCH_X, BENCH_Z, 0.62, this.root, 0.7, 0.014).scale.set(BENCH_L / 1.1, 1, 1);
    b.contactShadow(STOOL_X, STOOL_Z, 0.32, this.root, 0.6, 0.014);
  }

  /** The painted garden on its cloth, its two stands. */
  private buildBackdrop(): void {
    const painting = canvasTexture(Math.round(DROP_W * PAINT_PX), Math.round(DROP_LENGTH * PAINT_PX), paintGarden);
    const plaster = this.kit.assets.materials.get('plaster_damaged')!;
    const weave = plaster.normalMap.clone();
    weave.repeat.set(DROP_W / 1.2, DROP_LENGTH / 1.2);
    weave.needsUpdate = true;
    const cloth = new Mesh(backdropGeometry(), new MeshStandardMaterial({ map: painting, color: PAINT_SHADE, roughness: 0.92, normalMap: weave, normalScale: new Vector2(0.18, 0.18) }));
    cloth.position.set(DROP_X, 0, DROP_Z);
    cloth.receiveShadow = true;
    cloth.frustumCulled = false;
    this.root.add(cloth);

    const parts: BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const x = DROP_X + side * (DROP_W / 2 + 0.06);
      parts.push(meterUVs(new CylinderGeometry(0.022, 0.026, DROP_TOP + 0.15, 10)).translate(x, (DROP_TOP + 0.15) / 2, DROP_Z - 0.02));
      parts.push(meterUVs(new BoxGeometry(0.06, 0.04, 0.6)).translate(x, 0.02, DROP_Z));
      parts.push(meterUVs(new BoxGeometry(0.42, 0.04, 0.06)).translate(x, 0.02, DROP_Z));
    }
    parts.push(meterUVs(new CylinderGeometry(0.035, 0.035, DROP_W + 0.2, 14)).rotateZ(Math.PI / 2).translate(DROP_X, DROP_TOP + 0.02, DROP_Z - 0.03));
    const stands = new Mesh(mergeGeometries(parts)!, this.build.wood());
    stands.castShadow = true;
    stands.receiveShadow = true;
    stands.frustumCulled = false;
    this.root.add(stands);
  }

  /** A long backless bench: a velvet cushion on a dark frame and six turned legs. */
  private buildBench(velvet: Material): void {
    const legH = SEAT_TOP - CUSHION - APRON;
    const turned = [[0.02, 0], [0.026, 0.02], [0.02, 0.06], [0.03, 0.14], [0.018, 0.24], [0.026, legH - 0.04], [0.03, legH]].map(([r, y]) => new Vector2(r, y));
    const parts: BufferGeometry[] = [meterUVs(new BoxGeometry(BENCH_L - 0.08, APRON, BENCH_D - 0.06)).translate(0, legH + APRON / 2, 0)];
    for (const x of [-1, 0, 1]) {
      for (const z of [-1, 1]) parts.push(meterUVs(new LatheGeometry(turned, 12)).translate(x * (BENCH_L / 2 - 0.09), 0, z * (BENCH_D / 2 - 0.07)));
    }
    parts.push(meterUVs(new BoxGeometry(BENCH_L - 0.2, 0.03, 0.03)).translate(0, 0.12, 0));
    const frame = new Mesh(mergeGeometries(parts)!, this.build.wood());
    const cushion = new Mesh(meterUVs(new RoundedBoxGeometry(BENCH_L, CUSHION, BENCH_D, 3, 0.03)), velvet);
    cushion.position.y = SEAT_TOP - CUSHION / 2;
    const bench = new Group();
    for (const m of [frame, cushion]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      bench.add(m);
    }
    bench.position.set(BENCH_X, 0, BENCH_Z);
    this.root.add(bench);
  }

  /** A round posing stool on three splayed legs, its seat of the same velvet. */
  private buildStool(velvet: Material): void {
    const top = SEAT_TOP - STOOL_SEAT;
    const splay = 0.12;
    const spread = 0.11;
    const turned = [[0.016, 0], [0.02, 0.02], [0.014, 0.1], [0.022, 0.2], [0.015, 0.3], [0.02, top - 0.03], [0.022, top]].map(([r, y]) => new Vector2(r, y - top));
    const parts: BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      parts.push(meterUVs(new LatheGeometry(turned, 10).rotateZ(splay).rotateY(-a).translate(Math.cos(a) * spread, top, Math.sin(a) * spread)));
    }
    const ringY = 0.16;
    const ringR = spread + (top - ringY) * Math.sin(splay);
    parts.push(meterUVs(new TorusGeometry(ringR, 0.009, 6, 36).rotateX(Math.PI / 2).translate(0, ringY, 0)));
    parts.push(meterUVs(new CylinderGeometry(STOOL_R - 0.02, STOOL_R - 0.03, 0.035, 32)).translate(0, top - 0.0175, 0));
    const frame = new Mesh(mergeGeometries(parts)!, this.build.wood());
    const profile = [[0, 0], [STOOL_R - 0.01, 0], [STOOL_R, 0.012], [STOOL_R, STOOL_SEAT - 0.02], [STOOL_R - 0.025, STOOL_SEAT - 0.002], [0, STOOL_SEAT]].map(([r, y]) => new Vector2(r, y));
    const seat = new Mesh(meterUVs(new LatheGeometry(profile, 36)), velvet);
    seat.position.y = top;
    const stool = new Group();
    for (const m of [frame, seat]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      stool.add(m);
    }
    stool.position.set(STOOL_X, 0, STOOL_Z);
    this.root.add(stool);
  }

  /** What stands in the dark at the edges: the lamp on its stand, a velvet drape at the left, a palm behind the backdrop at the right. */
  private buildStudio(): void {
    const k = this.kit;
    const aim = new Vector3(KEY_TARGET[0] - KEY_AT[0], KEY_TARGET[1] - KEY_AT[1], KEY_TARGET[2] - KEY_AT[2]).normalize();
    const metal = new MeshStandardMaterial({ color: 0x1d1d1c, roughness: 0.45, metalness: 0.7 });
    const lamp = k.paint(k.prop('stage_light', [0, 0, 0], { scale: LAMP_SCALE }, this.root), metal);
    lamp.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), aim);
    lamp.position.set(KEY_AT[0] - aim.x * 0.46, KEY_AT[1] - aim.y * 0.46, KEY_AT[2] - aim.z * 0.46);
    // its stand rises into the middle of the lamp
    const footX = KEY_AT[0] - aim.x * 0.23;
    const footZ = KEY_AT[2] - aim.z * 0.23;
    const top = KEY_AT[1] - aim.y * 0.23;
    const stand: BufferGeometry[] = [new CylinderGeometry(0.018, 0.022, top, 8).translate(footX, top / 2, footZ)];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      stand.push(new CylinderGeometry(0.012, 0.012, 0.62, 6).translate(0, -0.31, 0).rotateX(0.75).rotateY(a).translate(footX, 0.45, footZ));
    }
    this.root.add(new Mesh(mergeGeometries(stand)!, metal));
    const drape = k.prop('curtains', [-3.05, 0, DROP_Z + 0.3], { scale: 1.42, castShadow: true }, this.root);
    k.paint(drape, k.surface('velvet_red', 0.3, { color: new Color(DRAPE) }));
    k.prop('potted_plant', [3.05, 0, DROP_Z - 0.55], { scale: 1.9 }, this.root);
    this.build.contactShadow(3.05, DROP_Z - 0.55, 0.45, this.root, 0.7);
  }

  private buildSound(): void {
    const pan = (x: number) => Math.max(-1, Math.min(1, (x - EYE[0]) * PAN_PER_M));
    this.beat(0, () => {
      this.tone = this.sound.bed('rooms/house_tone.mp3', { gain: TONE_GAIN, fade: 1.5 });
      this.clock = this.sound.bed('rooms/clock_tick.mp3', { gain: CLOCK_GAIN, pan: -0.55, reverb: 0.12, fade: 2 });
      this.drone = this.sound.bed('rooms/dream_drone_low.mp3', { gain: DRONE_GAIN, fade: 4 });
    });
    FLASHES.forEach((at, i) => {
      // hold still: the room goes quiet, the clock with it
      this.beat(at - HUSH, () => {
        this.tone?.gain(TONE_GAIN * HUSHED, 0.5);
        this.clock?.gain(0, 0.3);
        this.drone?.gain(DRONE_GAIN * HUSHED, 0.5);
      });
      this.beat(at, () => this.sound.play('rooms/flash_powder.mp3', { gain: 0.6, rate: 1 - i * 0.05, reverb: 0.3 }));
      // the room comes back; after the last the clock does not
      this.beat(at + 0.9, () => {
        this.tone?.gain(TONE_GAIN, 1.6);
        this.drone?.gain(DRONE_GAIN, 2);
        if (i < 2) this.clock?.gain(CLOCK_GAIN, 1.2);
      });
    });
    this.beat(7.4, () => this.sound.play('rooms/seat_creak_2.mp3', { gain: 0.12, pan: pan(WOMAN_X), reverb: 0.4 }));
    this.beat(12.3, () => this.sound.play('rooms/seat_creak_4.mp3', { gain: 0.1, pan: pan(CHILD_X), reverb: 0.4 }));
    this.beat(FLASHES[2] + SHUTTER_AFTER, () => this.shutter(false));
    this.beat(FLASHES[2] + 0.6, () => this.sound.play('rooms/breath_out.mp3', { gain: 0.16, pan: pan(STOOL_X) }));
    this.beat(OLD_GONE, () => this.sound.play('rooms/seat_creak_3.mp3', { gain: 0.2, pan: pan(STOOL_X), reverb: 0.2 }));
    this.beat(LINE_AT, () => this.say({ tr: 'Gülümseyin.', en: 'Smile.' }, 2, 'dream'));
    this.beat(CHARGE_AT, () => this.sound.play('rooms/flash_charge.mp3', { gain: 0.14 }));
    this.beat(CUT_AT, () => this.sound.stopAll(0.02));
  }

  prepare(camera: PerspectiveCamera): void {
    this.glass.uAspect.value = camera.aspect;
    this.glass.uBand.value = WIDE.matches ? Math.min(1, camera.aspect / LETTERBOX) : 1;
  }

  /** Who is there in this stretch, and where his hat lies. */
  private show(stage: number): void {
    for (const s of this.sitters) if (s.from !== 9) s.root.visible = stage >= s.from && stage <= s.to;
    this.coat.visible = stage < 3;
    if (stage < 3) {
      this.hat.position.copy(this.hatOnLap);
      this.hat.rotation.set(-0.12, MAN_TURN + 0.3, 0.05);
    } else {
      this.hat.position.set(HAT_ON_BENCH[0], HAT_ON_BENCH[1], HAT_ON_BENCH[2]);
      this.hat.rotation.set(0, HAT_TURN, 0);
    }
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const stage = s < FLASHES[0] ? 0 : s < FLASHES[1] ? 1 : s < FLASHES[2] ? 2 : 3;
    if (stage !== this.stage) {
      this.stage = stage;
      this.show(stage);
      this.shadowFrames = 2;
    }
    const old = s >= FLASHES[2] && s < OLD_GONE;
    if (old !== this.oldThere) {
      this.oldThere = old;
      this.oldMan.visible = old;
      this.shadowFrames = 2;
    }
    this.movingShadows = this.shadowFrames > 0;
    if (this.shadowFrames > 0) this.shadowFrames--;

    // each flash: one hit of white, its light falling off; the third lingers
    let white = 0;
    let light = 0;
    for (let i = 0; i < FLASHES.length; i++) {
      const since = s - FLASHES[i];
      if (since < 0 || since > 4) continue;
      white = Math.max(white, Math.exp(-since / WHITE_FALL));
      light = Math.max(light, Math.exp(-since / (i === 2 ? AFTERGLOW : LIGHT_FALL)));
    }
    this.white = white * (REDUCED_MOTION ? 0.3 : 1);
    this.flashLight.intensity = light * FLASH_POWER;
    this.key.intensity = KEY_POWER * KEY_LEFT[stage] * (1 - AFTER_DIM * smooth(AFTER_FROM, CUT_AT, s));

    const onGlass = stage === 0;
    this.glass.uGlass.value = onGlass ? 1 : 0;
    this.air.grade.exposure = onGlass ? EXPOSURE_GLASS : EXPOSURE_PRINT;
    this.aperture = onGlass ? APERTURE_GLASS : APERTURE_SHOT;
    this.motes.value = s;
    this.fear = 0.3 + 0.35 * smooth(4, FLASHES[2], s) + (old ? 0.25 : 0) - 0.2 * smooth(OLD_GONE, LINE_AT, s);
    this.black = s >= CUT_AT ? 1 : 0;
  }
}
