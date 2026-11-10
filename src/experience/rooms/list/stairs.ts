import { BoxGeometry, CanvasTexture, Color, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Shape, SphereGeometry, SRGBColorSpace } from 'three';
import type { Object3D, ShaderMaterial, Texture } from 'three';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { SpotSpec } from '../../../config/nightmare.config';
import type { Crowd } from '../../dream/FigureKit';
import { lerp, range, smootherstep, wobble } from '../../math';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['booties', 'boot_felt', 'sandal', 'shoes_leather', 'slippers', 'lightbulb', 'pull_chain_socket'],
  materials: ['wood_raw_boards', 'wood_stair', 'wood_floor_dark', 'plaster_pale', 'paint_green'],
  sounds: [
    'rooms/bulb_hum.mp3',
    'rooms/pull_cord.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/dream_drone_glass.mp3',
    'rooms/wet_step_1.mp3',
    'rooms/wet_step_2.mp3',
    'rooms/wet_step_3.mp3',
    'rooms/wet_step_4.mp3',
    'rooms/stair_tread_2.mp3',
    'rooms/stair_tread_4.mp3',
    'rooms/stair_tread_5.mp3',
    'rooms/tile_drip_1.mp3',
    'rooms/tile_drip_3.mp3',
    'rooms/tile_drip_4.mp3',
    'rooms/breath_out.mp3',
  ],
};

const DEG = Math.PI / 180;

/** The bare room (m): inner width, ceiling, and how far it runs behind the foot of the stair (+z). */
const ROOM_W = 3.4;
const H = 2.55;
const REAR = 5.4;
/** Height of the old green paint on the walls (m). */
const DADO = 1.18;
/** The stair (m): width, run of one tread in plan, how much riser shows, the first riser, a tread's overhang and thickness. */
const STAIR_W = 1.3;
const RUN = 0.62;
const RISER = 0.3;
const FIRST_RISER = 0.2;
const NOSE = 0.03;
const SLAB = 0.045;
/** How far each tread tips toward the eye (deg, lowest first). The stair is built like a stage set for the one line it is seen along: nobody can tell, and every step offers itself. */
const RAKE = [5, 8, 16, 24, 32];
/** Across a tread, as a fraction of its run from the front edge: where the shoes stand and where the prints fall. */
const SHOES_AT = 0.75;
const PRINT_AT = 0.235;
/** A foot's print (m). */
const FOOT_W = 0.178;
const FOOT_L = 0.313;
const FOOT_APART = 0.085;
/** How much a print is lengthened along its tread for the angle it is seen at (highest first). */
const FOOT_STRETCH = [1.42, 1.28, 1.12];

/** The bulb (m) and its light. */
const BULB_X = -0.5;
const BULB_Y = 2.14;
const BULB_Z = 0.2;
const KEY = 44;
const KEY_ANGLE = 72;
const KEY_AIM: [number, number, number] = [0, 1.2, -1.7];
const KEY_COLOR = 0xffd4a6;
const SPILL = 1.3;
/** A narrower cone of the same bulb, for the pool on the boards in front of the first step. */
const POOL = 30;
const POOL_ANGLE = 26;
const GLOW = 7;
/** The halo round the bulb (m across): large while the room is seen from far off, small once the bulb hangs near the eye. */
const HALO_FAR = 1.6;
const HALO_NEAR = 0.8;
/** And how much stronger it is from far off. */
const HALO_FAR_GAIN = 1.6;
/** How much the bulb's light wavers on its own, and how far its cord sways (0..1, rad). */
const WAVER = 0.06;
const CORD_SWAY = 0.012;
/** Exposure of the picture: opened a little for the first look at the whole room, then settled. */
const EXPOSURE_OPEN = 1.38;
const EXPOSURE = 1.2;
/** How much the wet prints shine on their own, for what they mirror. */
const SHEEN = 0.5;

/** The eye: seconds, x, y, z, yaw, pitch, fov. It climbs at one unhurried pace, a pair at the center at a time, and opens wide when something starts to come down. */
const SHOT: readonly (readonly [number, number, number, number, number, number, number])[] = [
  [0, 0, 0.85, 3.75, 0, 3, 44],
  [1.7, 0, 0.88, 3.62, 0, 2, 40],
  [3.6, 0, 1, 3.45, 0, -11, 30],
  [4.9, 0, 1.25, 3.05, 0, -8.7, 28],
  [6.2, 0, 1.6, 2.65, 0, -6.9, 28],
  [7.6, 0, 1.95, 2.25, 0, -4, 27],
  [9, 0, 2.28, 1.85, 0, -1.5, REDUCED_MOTION ? 24 : 19],
  [11, 0, 2.33, 1.5, 0, -8.5, 27],
  [12.5, 0, 2.35, 1.15, 0, -13, REDUCED_MOTION ? 34 : 38],
  [15, 0, 2.35, 1.08, 0, -14, REDUCED_MOTION ? 34 : 38],
];
/** The lens: seconds and distance in focus (m). */
const FOCUS: readonly (readonly [number, number])[] = [[0, 4.4], [3.6, 3.9], [9, 4.7], [11, 3.6], [12.3, 2.9]];
const APERTURE = 3.2;

/** A pair of wet prints a tread (0 is the lowest): when each foot comes down (s). */
const PRINTS = [
  { step: 4, left: 9, right: 9.55 },
  { step: 3, left: 11, right: 11.5 },
  { step: 2, left: 12.2, right: 12.4 },
];
/** How long a foot takes to press itself out, heel to toe (s), and how soft that wet front is (of a foot's length). */
const FOOT_PRESS = 0.3;
const FOOT_EDGE = 0.12;
/** How the bulb sags at each footfall (s, how far 0..1, how long s). Slow, well under the flicker limit. */
const SAGS = [
  { at: 9, depth: 0.2, long: 0.8 },
  { at: 11, depth: 0.3, long: 0.8 },
  { at: 12.2, depth: 0.55, long: 0.7 },
];
/** The bulb after the flash, of its full light. */
const AFTER_LEVEL = 0.72;
/** Water that falls from where a hand would hang (m and s): when it lands, on which tread, how far out. */
const DROPS = [
  { land: 9.85, step: 4, x: 0.27 },
  { land: 10.5, step: 4, x: 0.27 },
  { land: 11.75, step: 3, x: -0.26 },
  { land: 12.05, step: 3, x: -0.26 },
];
const DROP_FALL = 0.42;
const DROP_HEIGHT = 0.86;

/** The shutter (s), how long its light stays and dies (s), and how long until the shoes are found moved (s after it). */
const SHUTTER_AT = 12.5;
const FLASH_END = 13.1;
const FLASH_DECAY = 0.28;
const SHOES_MOVE = 0.05;
/** The flash: held out high to the left of the lens, so that what stands on the last prints throws its shadow up the stair. */
const FLASH: readonly [number, number, number] = [-0.75, 2.44, 1.3];
const FLASH_AIM: readonly [number, number, number] = [0.12, 1.4, -2.3];
const FLASH_POWER = 72;
const FLASH_ANGLE = 50;
/** What throws that shadow: one body, on the last prints, and how large (scale of the man). */
const THROWER_SCALE = 1.08;
/** The drop on the glass (s); the tug on the cord and the cut to black (s); how far the cord is pulled (m). */
const LENS_DROP_AT = 13.05;
const TUG_AT = 13.8;
const CUT_AT = 14;
const TUG = 0.03;
/** That drop on the glass: size and height on the lens (m), how fast it runs down. */
const LENS_DROP_SIZE = 0.011;
const LENS_DROP_Y = 0.02;
const LENS_DROP_RUN = 0.01;

/** What is heard: seconds, file, gain, reverb, low-pass (0 none), pan. The same wet foot, from far above to very near. */
const HEARD: readonly (readonly [number, string, number, number, number, number])[] = [
  [3.6, 'wet_step_1', 0.07, 0.5, 1000, 0.02],
  [5.7, 'wet_step_2', 0.11, 0.42, 1500, 0.02],
  [7.6, 'wet_step_3', 0.17, 0.35, 2000, 0.03],
  [9, 'wet_step_4', 0.27, 0.3, 2500, 0.04],
  [9, 'stair_tread_2', 0.22, 0.15, 0, 0.04],
  [9.55, 'wet_step_1', 0.22, 0.3, 2500, -0.04],
  [9.85, 'tile_drip_1', 0.15, 0.3, 0, 0.2],
  [10.5, 'tile_drip_3', 0.13, 0.3, 0, 0.2],
  [11, 'wet_step_2', 0.42, 0.25, 3600, 0.05],
  [11, 'stair_tread_4', 0.34, 0.15, 0, 0.05],
  [11.5, 'wet_step_3', 0.34, 0.25, 3600, -0.05],
  [11.75, 'tile_drip_4', 0.22, 0.25, 0, -0.15],
  [12.05, 'tile_drip_1', 0.26, 0.2, 0, -0.15],
  [12.2, 'wet_step_4', 0.56, 0.15, 0, 0.06],
  [12.2, 'stair_tread_5', 0.46, 0.12, 0, 0.06],
  [12.4, 'wet_step_1', 0.52, 0.15, 0, -0.06],
  [LENS_DROP_AT, 'tile_drip_3', 0.34, 0.04, 0, 0.1],
  [13.3, 'breath_out', 0.2, 0, 0, 0],
  [CUT_AT, 'pull_cord', 0.34, 0.14, 0, -0.25],
  [14.55, 'wet_step_2', 0.58, 0.06, 0, 0],
];
/** When the room tone is taken away so that the last step falls in a real silence (s). */
const HUSH_AT = 11.85;

interface Tread {
  /** Height and z of the front edge (m). */
  y: number;
  z: number;
  /** Tip (rad), how much higher the back edge is (m), length along the slope (m). */
  rake: number;
  rise: number;
  length: number;
}

function layTreads(): Tread[] {
  let y = FIRST_RISER;
  return RAKE.map((deg, i) => {
    const rake = deg * DEG;
    const rise = RUN * Math.tan(rake);
    const tread = { y, z: -i * RUN, rake, rise, length: RUN / Math.cos(rake) };
    y += rise + RISER;
    return tread;
  });
}

const TREADS = layTreads();
const STAIR_END = -TREADS.length * RUN;

function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** A box with its UVs in meters and its grain across the stair (the boards run along V). */
function plank(w: number, h: number, d: number, seed: number): BoxGeometry {
  const g = new BoxGeometry(w, h, d);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const side = Math.abs(n.getX(i)) > 0.5;
    const flat = Math.abs(n.getY(i)) > 0.5;
    uv.setXY(i, (side || flat ? p.getZ(i) : p.getY(i)) + seed, (side ? p.getY(i) : p.getX(i)) + seed * 1.7);
  }
  return g;
}

/** A plane of w x h with UVs in meters. */
function panel(w: number, h: number): PlaneGeometry {
  const g = new PlaneGeometry(w, h);
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) + w / 2, p.getY(i) + h / 2);
  return g;
}

function texture(c: HTMLCanvasElement, srgb = true): CanvasTexture {
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** One old water stain: an irregular patch with the darker rim such a stain dries to. */
function blot(g: CanvasRenderingContext2D, x: number, y: number, r: number, rnd: () => number, fill: number, rim: number): void {
  const n = 18;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = r * (0.7 + rnd() * 0.55);
    xs.push(x + Math.cos(a) * k);
    ys.push(y + Math.sin(a) * k * 0.82);
  }
  g.beginPath();
  g.moveTo((xs[n - 1] + xs[0]) / 2, (ys[n - 1] + ys[0]) / 2);
  for (let i = 0; i < n; i++) g.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[(i + 1) % n]) / 2, (ys[i] + ys[(i + 1) % n]) / 2);
  g.closePath();
  g.fillStyle = `rgba(13,14,9,${fill})`;
  g.fill();
  g.strokeStyle = `rgba(22,16,7,${rim})`;
  g.lineWidth = 1 + rnd() * 2.6;
  g.stroke();
}

const GRIME_PX = 120;

/** What sixty years do to a wall: a canvas that lies over it and only darkens. */
function grime(wide: number, high: number, seed: number, paint?: (g: CanvasRenderingContext2D, px: number, rnd: () => number) => void): CanvasTexture {
  const px = GRIME_PX;
  const [c, g] = canvas(Math.round(wide * px), Math.round(high * px));
  const rnd = seeded(seed);
  const W = c.width;
  const V = c.height;
  const veil = g.createLinearGradient(0, 0, 0, V);
  veil.addColorStop(0, 'rgba(9,10,8,0.6)');
  veil.addColorStop(0.3, 'rgba(9,10,8,0.2)');
  veil.addColorStop(0.72, 'rgba(9,10,8,0.16)');
  veil.addColorStop(1, 'rgba(9,10,8,0.55)');
  g.fillStyle = veil;
  g.fillRect(0, 0, W, V);
  paint?.(g, px, rnd);
  for (let i = 0; i < wide * 9; i++) blot(g, rnd() * W, rnd() * V, (0.05 + rnd() * 0.38) * px, rnd, 0.04 + rnd() * 0.14, 0.08 + rnd() * 0.22);
  // two tide lines where the damp climbed and stopped
  for (let tide = 0; tide < 2; tide++) {
    g.beginPath();
    g.moveTo(0, V);
    for (let x = 0; x <= W; x += 9) g.lineTo(x, V - (tide === 0 ? 0.34 : 0.62) * px - Math.sin(x * 0.011 + seed + tide) * 16 - rnd() * 7);
    g.lineTo(W, V);
    g.closePath();
    g.fillStyle = 'rgba(8,9,6,0.18)';
    g.fill();
    g.strokeStyle = 'rgba(26,20,10,0.4)';
    g.lineWidth = 2;
    g.stroke();
  }
  // long runs of water down from the top
  for (let i = 0; i < wide * 7; i++) {
    let x = rnd() * W;
    const y = rnd() < 0.7 ? 0 : rnd() * V * 0.5;
    const length = (0.3 + rnd() * 1.5) * px;
    const run = g.createLinearGradient(0, y, 0, y + length);
    run.addColorStop(0, `rgba(8,9,7,${0.25 + rnd() * 0.4})`);
    run.addColorStop(1, 'rgba(8,9,7,0)');
    g.strokeStyle = run;
    g.lineWidth = 0.8 + rnd() * rnd() * 7;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 1; k <= 12; k++) g.lineTo((x += (rnd() - 0.5) * 5), y + (length * k) / 12);
    g.stroke();
  }
  for (let i = 0; i < wide * 0.9; i++) {
    let x = rnd() * W;
    let y = rnd() * V;
    let a = rnd() * 6.28;
    g.strokeStyle = 'rgba(5,5,4,0.65)';
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 14; k++) {
      a += (rnd() - 0.5) * 1.1;
      x += Math.cos(a) * px * 0.07;
      y += Math.sin(a) * px * 0.07;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return texture(c);
}

/** What lies on a tread (the top of the image is its back): dark varnish at both sides, the bare lane a carpet runner wore in the middle, then dust. */
function treadSkin(seed: number): CanvasTexture {
  const [c, g] = canvas(768, 384);
  const rnd = seeded(seed);
  for (const side of [0, 1]) {
    const edge = 768 * (side ? 0.755 : 0.245);
    g.beginPath();
    g.moveTo(side ? 768 : 0, 0);
    for (let y = 0; y <= 384; y += 8) g.lineTo(edge + (rnd() - 0.5) * 14 + Math.sin(y * 0.03 + seed) * 7, y);
    g.lineTo(side ? 768 : 0, 384);
    g.closePath();
    g.fillStyle = 'rgba(18,11,7,0.84)';
    g.fill();
    // the line of dirt along the runner's edge, and its tack holes
    g.strokeStyle = 'rgba(8,6,4,0.55)';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(edge, 0);
    g.lineTo(edge + (rnd() - 0.5) * 8, 384);
    g.stroke();
    g.fillStyle = 'rgba(4,3,2,0.9)';
    for (let y = 18; y < 384; y += 58) g.fillRect(edge + (side ? 10 : -13), y + rnd() * 10, 3, 3);
  }
  for (let i = 0; i < 90; i++) {
    const x = rnd() * 768;
    const y = rnd() * 384;
    const r = 18 + rnd() * 90;
    const puff = g.createRadialGradient(x, y, 0, x, y, r);
    puff.addColorStop(0, `rgba(150,140,122,${0.015 + rnd() * 0.05})`);
    puff.addColorStop(1, 'rgba(176,166,146,0)');
    g.fillStyle = puff;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const back = g.createLinearGradient(0, 0, 0, 130);
  back.addColorStop(0, 'rgba(132,122,106,0.26)');
  back.addColorStop(1, 'rgba(160,150,132,0)');
  g.fillStyle = back;
  g.fillRect(0, 0, 768, 130);
  // specks, the nick of old scuffs, and the worn front edge
  for (let i = 0; i < 700; i++) {
    g.fillStyle = rnd() < 0.35 ? `rgba(190,182,166,${rnd() * 0.3})` : `rgba(14,10,7,${rnd() * 0.55})`;
    g.fillRect(rnd() * 768, rnd() * 384, 1 + rnd() * 2, 1 + rnd() * 1.6);
  }
  g.lineWidth = 0.9;
  for (let i = 0; i < 44; i++) {
    let x = 768 * (0.25 + rnd() * 0.5);
    let y = rnd() * 384;
    g.strokeStyle = `rgba(20,15,10,${0.15 + rnd() * 0.35})`;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo((x += (rnd() - 0.5) * 70), (y += (rnd() - 0.5) * 18));
    g.stroke();
  }
  return texture(c);
}

/** An old cream-painted riser, yellowed and kicked: the top of the image is the top of the riser. */
function riserPaint(seed: number): CanvasTexture {
  const [c, g] = canvas(768, 192);
  const rnd = seeded(seed);
  g.fillStyle = '#938a72';
  g.fillRect(0, 0, 768, 192);
  for (let i = 0; i < 130; i++) {
    const x = rnd() * 768;
    const y = rnd() * 192;
    const r = 14 + rnd() * 70;
    const patch = g.createRadialGradient(x, y, 0, x, y, r);
    patch.addColorStop(0, `rgba(62,50,30,${0.04 + rnd() * 0.14})`);
    patch.addColorStop(1, 'rgba(62,50,30,0)');
    g.fillStyle = patch;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const under = g.createLinearGradient(0, 0, 0, 60);
  under.addColorStop(0, 'rgba(24,18,10,0.72)');
  under.addColorStop(1, 'rgba(24,18,10,0)');
  g.fillStyle = under;
  g.fillRect(0, 0, 768, 60);
  // where toes have struck it, and where the paint has come away from the wood
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(34,25,16,${0.1 + rnd() * 0.3})`;
    g.fillRect(190 + rnd() * 390, 130 + rnd() * 62, 4 + rnd() * 26, 1 + rnd() * 5);
  }
  for (let i = 0; i < 30; i++) {
    const edge = rnd() < 0.7;
    const x = edge ? (rnd() < 0.5 ? rnd() * 90 : 678 + rnd() * 90) : rnd() * 768;
    const y = rnd() * 192;
    g.fillStyle = `rgba(36,24,15,${0.5 + rnd() * 0.45})`;
    g.beginPath();
    g.ellipse(x, y, 1.5 + rnd() * rnd() * 16, 1 + rnd() * rnd() * 7, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  return texture(c);
}

/** The sole of a heavy old foot that has touched the wood, x across (the big toe's side is negative), y from heel to toe. */
const SOLE: readonly (readonly [number, number])[] = [
  [0, 0], [0.22, 0.015], [0.37, 0.085], [0.41, 0.18], [0.38, 0.29], [0.4, 0.4], [0.47, 0.52], [0.58, 0.62], [0.63, 0.71], [0.58, 0.79], [0.36, 0.83], [0.08, 0.848], [-0.2, 0.848],
  [-0.48, 0.828], [-0.62, 0.765], [-0.63, 0.685], [-0.52, 0.605], [-0.42, 0.535], [-0.32, 0.46], [-0.27, 0.37], [-0.29, 0.29], [-0.34, 0.22], [-0.37, 0.14], [-0.25, 0.04],
];
/** Five toes: x, y, half width, half length. */
const TOES: readonly (readonly [number, number, number, number])[] = [
  [-0.48, 0.925, 0.2, 0.07],
  [-0.2, 0.962, 0.115, 0.05],
  [0.04, 0.955, 0.1, 0.045],
  [0.26, 0.93, 0.09, 0.04],
  [0.46, 0.885, 0.085, 0.035],
];

/** A wet print: the wood's dark with the shape of a foot in its alpha; the same shape as height, for its bead of water; and what it mirrors. `side` -1 is the foot on the left of the picture. */
function footMaps(side: 1 | -1, seed: number): { color: CanvasTexture; bump: CanvasTexture; sheen: CanvasTexture } {
  const [small, g] = canvas(96, 192);
  const rnd = seeded(seed);
  const X = (x: number): number => 48 + side * x * 54;
  const Y = (y: number): number => 11 + y * 170;
  g.fillStyle = 'rgba(255,255,255,0.86)';
  g.beginPath();
  const n = SOLE.length;
  for (let i = 0; i <= n; i++) {
    const [ax, ay] = SOLE[i % n];
    const [bx, by] = SOLE[(i + 1) % n];
    if (i === 0) g.moveTo(X((ax + bx) / 2), Y((ay + by) / 2));
    else g.quadraticCurveTo(X(ax), Y(ay), X((ax + bx) / 2), Y((ay + by) / 2));
  }
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.7)';
  for (const [x, y, rx, ry] of [[0, 0.13, 0.32, 0.11], [-0.05, 0.74, 0.54, 0.085]] as const) {
    g.beginPath();
    g.ellipse(X(x), Y(y), rx * 54, ry * 170, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(255,255,255,0.92)';
  for (const [x, y, rx, ry] of TOES) {
    g.beginPath();
    g.ellipse(X(x), Y(y), rx * 54, ry * 170, side * 0.25, 0, Math.PI * 2);
    g.fill();
  }
  // a broken edge, and the small beads a wet foot throws around it
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 18; i++) {
    const [ex, ey] = SOLE[Math.floor(rnd() * n)];
    g.beginPath();
    g.arc(X(ex) + (rnd() - 0.5) * 5, Y(ey) + (rnd() - 0.5) * 5, 0.8 + rnd() * 1.7, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 26; i++) {
    const [ex, ey] = SOLE[Math.floor(rnd() * n)];
    const out = 1.05 + rnd() * 0.3;
    g.fillStyle = `rgba(255,255,255,${0.45 + rnd() * 0.5})`;
    g.beginPath();
    g.arc(X(ex * out), Y(0.5 + (ey - 0.5) * out), 0.5 + rnd() * rnd() * 2, 0, Math.PI * 2);
    g.fill();
  }
  const [large, l] = canvas(256, 512);
  l.imageSmoothingQuality = 'high';
  l.drawImage(small, 0, 0, 256, 512);
  l.globalCompositeOperation = 'source-in';
  l.fillStyle = '#150d08';
  l.fillRect(0, 0, 256, 512);
  const [height, h] = canvas(128, 256);
  h.fillStyle = '#000';
  h.fillRect(0, 0, 128, 256);
  h.imageSmoothingQuality = 'high';
  h.drawImage(small, 0, 0, 128, 256);
  const [mirror, m] = canvas(128, 256);
  m.imageSmoothingQuality = 'high';
  m.drawImage(small, 0, 0, 128, 256);
  m.globalCompositeOperation = 'source-in';
  const shine = m.createLinearGradient(0, 0, 0, 256);
  shine.addColorStop(0, 'rgba(255,255,255,0.16)');
  shine.addColorStop(0.45, 'rgba(255,255,255,0.05)');
  shine.addColorStop(1, 'rgba(255,255,255,0.1)');
  m.fillStyle = shine;
  m.fillRect(0, 0, 128, 256);
  m.globalCompositeOperation = 'destination-over';
  m.fillStyle = '#000';
  m.fillRect(0, 0, 128, 256);
  // the thin broken line of light where the water stands up at its edge
  m.globalCompositeOperation = 'source-over';
  m.lineCap = 'round';
  const mx = (x: number): number => (X(x) * 128) / 96;
  const my = (y: number): number => (Y(y) * 256) / 192;
  for (let i = 0; i < n; i++) {
    if (rnd() < 0.42) continue;
    const [ax, ay] = SOLE[i];
    const [bx, by] = SOLE[(i + 1) % n];
    m.strokeStyle = `rgba(255,255,255,${0.2 + rnd() * 0.5})`;
    m.lineWidth = 0.7 + rnd() * 0.8;
    m.beginPath();
    m.moveTo(mx(ax), my(ay));
    m.lineTo(mx(bx), my(by));
    m.stroke();
  }
  for (const [x, y, rx, ry] of TOES) {
    m.strokeStyle = `rgba(255,255,255,${0.2 + rnd() * 0.4})`;
    m.lineWidth = 0.7;
    m.beginPath();
    m.ellipse(mx(x), my(y), rx * 72, ry * 227, side * 0.25, 2.6 + rnd(), 5 + rnd());
    m.stroke();
  }
  return { color: texture(large), bump: texture(height, false), sheen: texture(mirror) };
}

/** Black at the bottom, white at the top: slid over a foot, it presses the print out from the heel. */
function pressRamp(): CanvasTexture {
  const [c, g] = canvas(4, 64);
  const ramp = g.createLinearGradient(0, 64, 0, 0);
  ramp.addColorStop(0, '#000');
  ramp.addColorStop(1, '#fff');
  g.fillStyle = ramp;
  g.fillRect(0, 0, 4, 64);
  return texture(c, false);
}

/** The shape someone leaves on a wall when the only lamp is in front of him; he has no head. */
function headlessShadow(): CanvasTexture {
  const [small, g] = canvas(160, 320);
  const u = 160 / 1.25;
  const X = (x: number): number => 80 + x * u;
  const Y = (y: number): number => 320 - y * u;
  const side = [[0.075, 1.72], [0.085, 1.62], [0.26, 1.56], [0.31, 1.42], [0.33, 1.1], [0.34, 0.86], [0.31, 0.74], [0.255, 0.78], [0.25, 1.08], [0.23, 0.92], [0.2, 0.02], [0.05, 0.02], [0.02, 0.8]] as const;
  g.fillStyle = '#000';
  g.beginPath();
  g.moveTo(X(-0.02), Y(0.8));
  for (const [x, y] of side) g.lineTo(X(x), Y(y));
  for (let i = side.length - 1; i >= 0; i--) g.lineTo(X(-side[i][0]), Y(side[i][1]));
  g.closePath();
  g.fill();
  const [large, l] = canvas(512, 1024);
  l.imageSmoothingQuality = 'high';
  l.filter = 'blur(10px)';
  l.drawImage(small, 0, 0, 512, 1024);
  return texture(large);
}

/** A drop of water on the glass, soft because the lens is focused far beyond it. */
function bead(): CanvasTexture {
  const [c, g] = canvas(128, 128);
  const rim = g.createRadialGradient(64, 67, 16, 64, 64, 60);
  rim.addColorStop(0, 'rgba(214,220,214,0.09)');
  rim.addColorStop(0.58, 'rgba(26,28,28,0.14)');
  rim.addColorStop(0.86, 'rgba(8,9,9,0.4)');
  rim.addColorStop(1, 'rgba(8,9,9,0)');
  g.fillStyle = rim;
  g.fillRect(0, 0, 128, 128);
  return texture(c);
}

/** One value along a track of (seconds, value). */
function along(track: readonly (readonly [number, number])[], s: number): number {
  if (s <= track[0][0]) return track[0][1];
  for (let i = 1; i < track.length; i++) {
    if (s < track[i][0]) return lerp(track[i - 1][1], track[i][1], smootherstep(range(track[i - 1][0], track[i][0], s)));
  }
  return track[track.length - 1][1];
}

/** A copy of a prop's materials, their color multiplied. */
function tint(o: Object3D, r: number, g: number, b: number, roughness?: number): void {
  o.traverse((part) => {
    const mesh = part as Mesh;
    if (!mesh.isMesh) return;
    const m = (mesh.material as MeshStandardMaterial).clone();
    m.color.setRGB(m.color.r * r, m.color.g * g, m.color.b * b);
    if (roughness !== undefined) m.roughness = roughness;
    mesh.material = m;
  });
}

/**
 * A bare room, one bulb, and a plain wooden stair that climbs to the ceiling and stops at it. On every step a pair
 * of shoes, set neatly together, one life from the bottom to the top. Then a barefoot print comes down out of the
 * old man's slippers, a step at a time, toward the one looking, with nobody to make it. The flash finds what stands
 * on the last pair by its shadow alone, and when the white has gone every pair has come one step nearer.
 */
export default class Stairs extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x0a100e, density: 0.05 },
    env: 'bathroom',
    envIntensity: 0.06,
    sky: 0,
    grade: { exposure: EXPOSURE, saturation: 0.66, warmth: 0, tint: -0.03, flare: 0.003 },
  };
  film = { bloom: 0.7, bloomFrom: 0.7, grain: 0.42, scratches: 0.05, flicker: 0.02, weave: 0.0004 };
  focus = FOCUS[0][1];
  aperture = APERTURE;
  drift = REDUCED_MOTION ? 0 : 0.5;
  control = { look: true, scroll: true, hurry: 1.6 };

  private readonly pairs: Group[] = [];
  private readonly feet: { mesh: Mesh; press: Texture; look: MeshStandardMaterial; at: number }[] = [];
  private readonly drops: Mesh[] = [];
  private readonly thrower: Crowd;
  private readonly bulbSpot: SpotSpec;
  private readonly flashSpot: SpotSpec;
  private readonly poolSpot: SpotSpec;
  private readonly bulbLit: readonly (SpotSpec | null)[];
  private readonly flashLit: readonly (SpotSpec | null)[];
  private readonly bulbFill;
  private readonly filament: MeshBasicMaterial;
  private readonly haloMesh: Mesh;
  private readonly halo: ShaderMaterial;
  private readonly haloColor: Color;
  private readonly cord: Group;
  private readonly cordRest: number;
  private readonly lensDrop: Mesh;
  private readonly dust: { value: number };
  private hum: RoomVoice | null = null;
  private tone: RoomVoice | null = null;
  private high: RoomVoice | null = null;
  private moved = false;
  private flashing = false;
  private shadowFrames = 0;

  constructor(ctx: RoomContext) {
    super(ctx);
    const { kit, build: b } = this;
    this.keys = SHOT.map(([s, x, y, z, yaw, pitch, fov]): RoomKey => ({ t: s / this.seconds, at: [x, y, z], yaw, pitch, fov }));
    this.fear = 0.3;

    // the room: dirty plaster, old green paint to the waist, dark boards
    const length = REAR - STAIR_END;
    const middle = (REAR + STAIR_END) / 2;
    const plaster = kit.surface('plaster_pale', 2, { color: new Color(0.8, 0.8, 0.68) });
    const boards = kit.surface('wood_floor_dark', 2, { color: new Color(0.72, 0.64, 0.58), roughness: 0.5 });
    const overhead = kit.surface('plaster_pale', 2, { color: new Color(0.36, 0.37, 0.32) });
    b.box(ROOM_W, length, H, { walls: plaster, floor: boards, ceiling: overhead }, this.root).position.z = REAR;
    const paint = kit.surface('paint_green', 2, { color: new Color(0.5, 0.62, 0.52) });
    const skirting = new MeshStandardMaterial({ color: 0x120d09, roughness: 0.6 });
    const veil = (t: CanvasTexture) => new MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const family = grime(ROOM_W, H, 23, (g, px) => {
      // four pictures hung here once, and left their places on the plaster
      const places = [[-1.44, 1.93], [-1.12, 1.96], [-1.45, 1.52], [-1.11, 1.55]];
      for (const [x, y] of places) {
        const w = 0.22 * px;
        const h = 0.3 * px;
        const cx = (x + ROOM_W / 2) * px;
        const cy = (H - y) * px;
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = 'rgba(0,0,0,0.5)';
        g.fillRect(cx - w / 2, cy - h / 2, w, h);
        g.globalCompositeOperation = 'source-over';
        g.strokeStyle = 'rgba(6,6,5,0.6)';
        g.lineWidth = 1.5;
        g.strokeRect(cx - w / 2, cy - h / 2, w, h);
        g.fillStyle = 'rgba(3,3,2,0.9)';
        g.fillRect(cx - 1.5, cy - h / 2 - 0.05 * px, 3, 3);
      }
    });
    const sides: readonly (readonly [number, number, number, number, CanvasTexture])[] = [
      [-ROOM_W / 2, middle, Math.PI / 2, length, grime(length, H, 7)],
      [ROOM_W / 2, middle, -Math.PI / 2, length, grime(length, H, 61)],
      [0, STAIR_END, 0, ROOM_W, family],
      [0, REAR, Math.PI, ROOM_W, grime(ROOM_W, H, 88)],
    ];
    for (const [x, z, turn, wide, stains] of sides) {
      const inward = 0.006;
      const dx = Math.sin(turn) * inward;
      const dz = Math.cos(turn) * inward;
      const dado = new Mesh(panel(wide, DADO), paint);
      dado.position.set(x + dx, DADO / 2, z + dz);
      dado.rotation.y = turn;
      dado.receiveShadow = true;
      const dirt = new Mesh(new PlaneGeometry(wide, H), veil(stains));
      dirt.position.set(x + dx * 2, H / 2, z + dz * 2);
      dirt.rotation.y = turn;
      const foot = new Mesh(new BoxGeometry(wide, 0.13, 0.025), skirting);
      foot.position.set(x + dx * 2.5, 0.065, z + dz * 2.5);
      foot.rotation.y = turn;
      foot.receiveShadow = true;
      this.root.add(dado, dirt, foot);
    }
    const ceilingDirt = new Mesh(new PlaneGeometry(ROOM_W, length), veil(grime(ROOM_W, length, 41, (g, px, rnd) => {
      // the stair was let through here once, and the hole has been plastered over
      const left = (ROOM_W / 2 - 0.82) * px;
      const near = (REAR + 1.72) * px;
      const across = 1.64 * px;
      g.strokeStyle = 'rgba(5,5,4,0.8)';
      g.lineWidth = 2.5;
      g.strokeRect(left, near, across, (REAR - STAIR_END) * px - near);
      for (let i = 0; i < 34; i++) {
        blot(g, left + rnd() * across, (REAR - STAIR_END - rnd() * rnd() * 1.5) * px, (0.08 + rnd() * 0.32) * px, rnd, 0.16 + rnd() * 0.26, 0.2 + rnd() * 0.3);
      }
    })));
    ceilingDirt.rotation.x = Math.PI / 2;
    ceilingDirt.position.set(0, H - 0.006, middle);
    this.root.add(ceilingDirt);
    b.door(1.2, STAIR_END, '+z', this.root, { open: 0.1, beyond: 0x010201, color: 0x1b1712, width: 0.8, height: 2.02 });

    // the stair: a plain flight, each tread tipped a little more than the last
    const treadWood = kit.surface('wood_raw_boards', 1.4, { color: new Color(0.68, 0.55, 0.42) });
    const stringWood = kit.surface('wood_stair', 1.2, { color: new Color(0.19, 0.15, 0.13) });
    const skins = [31, 67].map((seed) => new MeshStandardMaterial({ map: treadSkin(seed), transparent: true, roughness: 0.72, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    const risers = [13, 47].map((seed) => new MeshStandardMaterial({ map: riserPaint(seed), roughness: 0.78 }));
    const groups = TREADS.map((t, i) => {
      const g = new Group();
      g.position.set(0, t.y, t.z);
      g.rotation.x = t.rake;
      const slab = new Mesh(plank(STAIR_W, SLAB, t.length + NOSE, i * 0.37), treadWood);
      slab.position.set(0, -SLAB / 2, (NOSE - t.length) / 2);
      slab.castShadow = true;
      slab.receiveShadow = true;
      const skin = new Mesh(new PlaneGeometry(STAIR_W, t.length), skins[i % 2]);
      skin.rotation.x = -Math.PI / 2;
      skin.position.set(0, 0.0012, -t.length / 2);
      skin.receiveShadow = true;
      if (i % 3 === 1) skin.scale.x = -1;
      g.add(slab, skin);
      this.root.add(g);
      const below = i === 0 ? 0 : TREADS[i - 1].y + TREADS[i - 1].rise - 0.02;
      const riser = new Mesh(new BoxGeometry(STAIR_W, t.y - below, 0.04), risers[i % 2]);
      riser.position.set(0, (t.y + below) / 2, t.z - 0.015);
      riser.castShadow = true;
      riser.receiveShadow = true;
      this.root.add(riser);
      return g;
    });
    const profile = new Shape();
    profile.moveTo(0.04, 0);
    profile.lineTo(0.04, FIRST_RISER + 0.14);
    TREADS.forEach((t) => profile.lineTo(t.z - RUN, t.y + t.rise + 0.14));
    profile.lineTo(STAIR_END, 0);
    profile.closePath();
    const string = new ExtrudeGeometry(profile, { depth: 0.055, bevelEnabled: false });
    for (const x of [STAIR_W / 2 + 0.055, -STAIR_W / 2]) {
      const side = new Mesh(string, stringWood);
      side.rotation.y = -Math.PI / 2;
      side.position.x = x;
      side.castShadow = true;
      side.receiveShadow = true;
      this.root.add(side);
    }
    b.contactShadow(0, 0.1, 1.1, this.root, 0.6);

    // one life, a pair to a step: each group is the pair's own place, set down on a tread by `seat`
    const put = (key: string, g: Group, x: number, scale: number, turn: number): Object3D => kit.prop(key, [x, -0.002, 0], { scale, rotation: [0, turn, 0], castShadow: true }, g);
    const pair = (radius: number): Group => {
      const g = new Group();
      b.contactShadow(0, 0, radius, g, 0.6, 0.003);
      this.root.add(g);
      this.pairs.push(g);
      return g;
    };
    tint(put('booties', pair(0.13), 0, 1.1, 0), 0.78, 0.7, 0.56);
    const child = pair(0.15);
    put('boot_felt', child, -0.068, 0.66, -3);
    put('boot_felt', child, 0.068, 0.66, 3).scale.x *= -1;
    const boy = pair(0.18);
    tint(put('sandal', boy, -0.072, 0.78, -2), 0.7, 0.6, 0.5);
    const right = put('sandal', boy, 0.072, 0.78, 2);
    tint(right, 0.7, 0.6, 0.5);
    right.scale.x *= -1;
    tint(put('shoes_leather', pair(0.24), 0, 1, 0), 0.3, 0.22, 0.18, 0.3);
    const slippers = put('slippers', pair(0.22), 0, 1, 0);
    kit.paint(slippers, new MeshStandardMaterial({ color: 0x352b26, roughness: 0.96 }));
    slippers.scale.y *= 0.8;
    this.pairs.forEach((g, i) => this.seat(g, i));

    // the wet feet, waiting in their places
    const foot = { '-1': footMaps(-1, 5), '1': footMaps(1, 19) };
    const ramp = pressRamp();
    for (let p = 0; p < PRINTS.length; p++) {
      const { step, left, right: second } = PRINTS[p];
      const t = TREADS[step];
      for (const side of [-1, 1] as const) {
        const maps = foot[side];
        const press = ramp.clone();
        press.repeat.set(1, 1 / FOOT_EDGE);
        press.needsUpdate = true;
        const look = new MeshStandardMaterial({ map: maps.color, bumpMap: maps.bump, bumpScale: 0.0025, alphaMap: press, emissive: new Color(0xfff0dc), emissiveMap: maps.sheen, emissiveIntensity: SHEEN, transparent: true, roughness: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
        const mesh = new Mesh(new PlaneGeometry(FOOT_W, FOOT_L), look);
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.z = side * (0.09 + p * 0.03) * -1;
        mesh.scale.y = FOOT_STRETCH[p];
        mesh.position.set(side * FOOT_APART, 0.003, -PRINT_AT * t.length - ((FOOT_STRETCH[p] - 1) * FOOT_L) / 2 + side * p * 0.012);
        mesh.receiveShadow = true;
        mesh.visible = false;
        groups[step].add(mesh);
        this.feet.push({ mesh, press, look, at: side < 0 ? left : second });
      }
    }

    // water from where a hand would hang, starting out of nothing
    const dropShape = new SphereGeometry(1, 6, 5);
    const dropLook = new MeshBasicMaterial({ color: new Color(1.5, 1.7, 1.6), transparent: true, opacity: 0.8, depthWrite: false });
    for (const d of DROPS) {
      const m = new Mesh(dropShape, dropLook);
      const t = TREADS[d.step];
      m.position.set(d.x, 0, t.z - PRINT_AT * RUN);
      m.scale.set(0.0035, 0.03, 0.0035);
      m.visible = false;
      this.root.add(m);
      this.drops.push(m);
    }

    // the one bulb, on a short cord, with its chain
    const cordTop = H;
    const cordEnd = BULB_Y + 0.108;
    const dark = new MeshStandardMaterial({ color: 0x0b0907, roughness: 0.7 });
    const cordLine = new Mesh(new CylinderGeometry(0.004, 0.004, cordTop - cordEnd, 6), dark);
    cordLine.position.set(BULB_X, (cordTop + cordEnd) / 2, BULB_Z);
    const rose = new Mesh(new CylinderGeometry(0.045, 0.055, 0.025, 14), new MeshStandardMaterial({ color: 0x3e3930, roughness: 0.8 }));
    rose.position.set(BULB_X, H - 0.0125, BULB_Z);
    const wire = new Mesh(new CylinderGeometry(0.0045, 0.0045, REAR - BULB_Z, 5), dark);
    wire.rotation.x = Math.PI / 2;
    wire.position.set(BULB_X, H - 0.006, (REAR + BULB_Z) / 2);
    this.root.add(cordLine, rose, wire);
    const holder = new Mesh(new CylinderGeometry(0.017, 0.022, 0.06, 12), new MeshStandardMaterial({ color: 0x0b0907, roughness: 0.5 }));
    holder.position.set(BULB_X, BULB_Y + 0.078, BULB_Z);
    this.root.add(holder);
    const lamp = kit.prop('lightbulb', [BULB_X, BULB_Y + 0.05, BULB_Z], { anchor: 'top', rotation: [180, 0, 0] }, this.root);
    this.filament = new MeshBasicMaterial({ color: new Color(GLOW, GLOW * 0.76, GLOW * 0.5) });
    lamp.traverse((part) => {
      const mesh = part as Mesh;
      if (mesh.isMesh && (mesh.material as MeshStandardMaterial).name.includes('glass')) mesh.material = this.filament;
    });
    this.haloMesh = b.glow(BULB_X, BULB_Y, BULB_Z, HALO_NEAR, KEY_COLOR, 0.55, this.root, 3);
    this.halo = this.haloMesh.material as ShaderMaterial;
    this.haloColor = (this.halo.uniforms.uColor.value as Color).clone();
    // a length of string from the chain, and what pulls on it at the end
    this.cord = new Group();
    this.cord.position.set(BULB_X - 0.03, BULB_Y + 0.075, BULB_Z);
    this.cordRest = this.cord.position.y;
    kit.prop('pull_chain_socket', [0, 0, 0], { anchor: 'top', nodes: ['pull_chain_light_socket_chain'] }, this.cord);
    const stringLine = new Mesh(new CylinderGeometry(0.002, 0.002, 0.42, 5), dark);
    stringLine.position.y = -0.356;
    const toggle = new Mesh(new CylinderGeometry(0.008, 0.012, 0.036, 8), new MeshStandardMaterial({ color: 0x4a3722, roughness: 0.6 }));
    toggle.position.y = -0.584;
    this.cord.add(stringLine, toggle);
    this.root.add(this.cord);

    // the light: the bulb's own spot, what it spills, a breath of teal in the darks
    this.bulbSpot = this.spot([BULB_X, BULB_Y, BULB_Z], KEY_AIM, KEY_COLOR, KEY, KEY_ANGLE, 0.85);
    this.flashSpot = this.spot([FLASH[0], FLASH[1], FLASH[2]], [FLASH_AIM[0], FLASH_AIM[1], FLASH_AIM[2]], 0xdfe9f2, FLASH_POWER, FLASH_ANGLE, 0.5);
    this.poolSpot = this.spot([BULB_X, BULB_Y, BULB_Z], [-0.2, 0.05, 0.95], KEY_COLOR, POOL, POOL_ANGLE, 0.9);
    this.bulbLit = [this.bulbSpot, this.poolSpot, null];
    this.flashLit = [this.flashSpot, null, null];
    this.spots = this.bulbLit;
    this.bulbFill = this.light([BULB_X, BULB_Y - 0.1, BULB_Z], KEY_COLOR, SPILL, 5.5);
    this.light([1.2, 1.1, 2.2], 0x2f6b66, 1.5, 5);
    this.light([0, 2, 4.85], 0x4a7a74, 3.2, 3.6);

    // what stands on the last prints: seen by nothing but the flash, it waits under the floor until then
    this.thrower = b.headless(1);
    const unseen = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.thrower.root.traverse((part) => {
      const mesh = part as Mesh;
      if (!mesh.isMesh) return;
      mesh.material = unseen;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
    });
    this.root.add(this.thrower.root);
    this.parkThrower(false);

    // on the wall behind you: your own shadow, and the bulb is in front of you
    const behind = new Mesh(new PlaneGeometry(1.25, 2.5), new MeshBasicMaterial({ map: headlessShadow(), transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    behind.rotation.y = Math.PI;
    behind.position.set(0.05, 1.25, REAR - 0.018);
    this.root.add(behind);

    // a drop on the glass, when it has come that close
    this.lensDrop = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: bead(), transparent: true, depthTest: false, depthWrite: false, fog: false }));
    this.lensDrop.position.set(0.024, LENS_DROP_Y, -0.14);
    this.lensDrop.scale.setScalar(LENS_DROP_SIZE);
    this.lensDrop.visible = false;
    this.lens.add(this.lensDrop);

    this.dust = b.motes(170, { x: [-ROOM_W / 2, ROOM_W / 2], y: [0.15, H], z: [STAIR_END, REAR - 1] }, this.root, { size: 1.15 }).time;

    // sound: a cord pulled, the bulb's thin tone, a foot from very far off that keeps coming; then nothing, and the last of it
    this.beat(0, () => {
      this.sound.play('rooms/pull_cord.mp3', { gain: 0.3, reverb: 0.1, pan: -0.25 });
      this.hum = this.sound.bed('rooms/bulb_hum.mp3', { gain: 0.1, fade: 0.3 });
      this.tone = this.sound.bed('rooms/dream_drone_low.mp3', { gain: 0.1, fade: 2.5 });
    });
    this.beat(7.2, () => (this.high = this.sound.bed('rooms/dream_drone_glass.mp3', { gain: 0.035, fade: 3 })));
    this.beat(HUSH_AT, () => {
      this.hum?.gain(0, 0.25);
      this.tone?.gain(0, 0.3);
      this.high?.gain(0, 0.25);
    });
    for (const [at, file, gain, reverb, lowpass, pan] of HEARD) {
      this.beat(at, () => this.sound.play(`rooms/${file}.mp3`, { gain, reverb, lowpass: lowpass || undefined, pan }));
    }
    this.beat(SHUTTER_AT, () => this.shutter());
  }

  /** A pair of shoes set down on tread `step` (below the lowest, on the floor at the foot of the stair). */
  private seat(pair: Group, step: number): void {
    if (step < 0) {
      pair.position.set(0, 0, 0.42);
      pair.rotation.x = 0;
      return;
    }
    const t = TREADS[step];
    pair.position.set(0, t.y + SHOES_AT * t.rise, t.z - SHOES_AT * RUN);
    pair.rotation.x = t.rake;
  }

  private parkThrower(out: boolean): void {
    const t = TREADS[PRINTS[2].step];
    if (out) this.thrower.set(0, 0, t.y + PRINT_AT * t.rise, t.z - PRINT_AT * RUN, 0, THROWER_SCALE);
    else this.thrower.set(0, 0, -3, -1.5, 0, 1);
    this.thrower.commit();
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const calm = REDUCED_MOTION ? 0.4 : 1;

    // the flash takes the place of the bulb for as long as it lasts
    const flash = s >= SHUTTER_AT && s < FLASH_END;
    const burst = flash ? Math.exp(-(s - SHUTTER_AT) / FLASH_DECAY) : 0;
    if (flash !== this.flashing) {
      this.flashing = flash;
      this.parkThrower(flash);
      this.spots = flash ? this.flashLit : this.bulbLit;
    }
    this.flashSpot.intensity = FLASH_POWER * burst;

    let sag = 0;
    for (let i = 0; i < SAGS.length; i++) {
      const x = range(SAGS[i].at, SAGS[i].at + SAGS[i].long, s);
      sag = Math.max(sag, SAGS[i].depth * Math.sin(Math.PI * x) ** 2);
    }
    const waver = 1 - WAVER * calm * Math.max(0, wobble(s * 0.9, 7));
    const lit = smootherstep(range(0, 0.14, s)) * waver * (1 - sag) * (s < SHUTTER_AT ? 1 : AFTER_LEVEL) * (1 - burst);
    this.bulbSpot.intensity = KEY * lit;
    this.poolSpot.intensity = POOL * lit;
    this.bulbFill.intensity = SPILL * lit;
    this.filament.color.setRGB(GLOW * lit, GLOW * 0.76 * lit, GLOW * 0.5 * lit);
    const near = smootherstep(range(2, 8, s));
    const halo = lerp(HALO_FAR, HALO_NEAR, near);
    this.haloMesh.scale.set(halo, halo, 1);
    (this.halo.uniforms.uColor.value as Color).copy(this.haloColor).multiplyScalar(lit * lerp(HALO_FAR_GAIN, 1, near));

    // all the pairs have come one step nearer once the white has covered it
    const moved = s >= SHUTTER_AT + SHOES_MOVE;
    if (moved !== this.moved) {
      this.moved = moved;
      for (let i = 0; i < this.pairs.length; i++) this.seat(this.pairs[i], moved ? i - 1 : i);
      this.shadowFrames = 3;
    }
    this.movingShadows = flash || this.shadowFrames > 0;
    if (this.shadowFrames > 0) this.shadowFrames--;

    for (let i = 0; i < this.feet.length; i++) {
      const foot = this.feet[i];
      const press = smootherstep(range(foot.at, foot.at + FOOT_PRESS, s));
      foot.mesh.visible = press > 0;
      foot.press.offset.y = (press * (1 + FOOT_EDGE) - 1) / FOOT_EDGE;
      foot.look.emissiveIntensity = SHEEN * lit;
    }

    for (let i = 0; i < this.drops.length; i++) {
      const u = (s - DROPS[i].land + DROP_FALL) / DROP_FALL;
      const m = this.drops[i];
      m.visible = u > 0 && u < 1;
      if (m.visible) {
        const t = TREADS[DROPS[i].step];
        m.position.y = t.y + PRINT_AT * t.rise + DROP_HEIGHT * (1 - u * u);
      }
    }

    const onGlass = s >= LENS_DROP_AT && s < CUT_AT;
    this.lensDrop.visible = onGlass;
    if (onGlass) {
      const since = s - LENS_DROP_AT;
      this.lensDrop.position.y = LENS_DROP_Y - since * since * LENS_DROP_RUN;
      this.lensDrop.scale.y = LENS_DROP_SIZE * (1 + since * 0.6);
      this.lensDrop.scale.x = LENS_DROP_SIZE * Math.min(1, 0.7 + since * 8);
    }

    const tug = smootherstep(range(TUG_AT, TUG_AT + 0.12, s));
    this.cord.position.y = this.cordRest - TUG * tug;
    this.cord.rotation.z = CORD_SWAY * calm * wobble(frame.time * 0.5, 3);

    this.focus = along(FOCUS, s);
    this.air.grade.exposure = lerp(EXPOSURE_OPEN, EXPOSURE, smootherstep(range(1.8, 3.6, s)));
    this.dust.value = frame.time;
    this.fear = s < SHUTTER_AT ? lerp(0.3, 0.92, smootherstep(range(6, 12.4, s))) : 0.7;
    this.black = s >= CUT_AT ? 1 : 0;
  }
}
