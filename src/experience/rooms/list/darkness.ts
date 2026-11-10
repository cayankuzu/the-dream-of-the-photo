import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type InstancedMesh,
  type Material,
  type PerspectiveCamera,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { SpotSpec } from '../../../config/nightmare.config';
import { rigClock, setClock } from '../../dream/ClockRig';
import { headMap, randomFrom, type Crowd, type FigureSpec } from '../../dream/FigureKit';
import { meterUVs } from '../../dream/DreamKit';
import { clamp, range, smootherstep } from '../../math';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import { PALETTE } from '../RoomKit';
import type { RoomVoiceOptions } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['sheet_chair', 'sheet_armchair', 'sheet_sofa', 'sheet_table', 'sheet_lamp', 'armchair', 'lamp_floor', 'lamp_pendant', 'chair_ladder', 'dining_table', 'sideboard', 'wall_clock', 'window_wood', 'curtains', 'plate', 'fork', 'knife', 'tumbler', 'bread_half', 'pot_enamel'],
  materials: ['wood_floor_dark', 'carpet_dirty', 'plaster_pale', 'linen_white', 'velvet_red'],
  sounds: [
    'rooms/house_tone.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/dream_drone_glass.mp3',
    'rooms/flash_charge.mp3',
    'rooms/flash_charge_long.mp3',
    'rooms/flash_pop_1.mp3',
    'rooms/flash_pop_2.mp3',
    'rooms/flash_pop_3.mp3',
    'rooms/flash_powder.mp3',
    'rooms/camera_click_empty.mp3',
    'rooms/polaroid_motor.mp3',
    'rooms/sheet_slide_floor.mp3',
    'rooms/sheet_drop_long.mp3',
    'rooms/door_creak_short.mp3',
    'rooms/floor_creak_1.mp3',
    'rooms/floor_creak_2.mp3',
    'rooms/floor_creak_3.mp3',
    'rooms/floor_creak_4.mp3',
    'rooms/floor_creak_long.mp3',
    'rooms/step_wood_1.mp3',
    'rooms/step_wood_2.mp3',
    'rooms/step_wood_3.mp3',
    'rooms/step_wood_4.mp3',
    'rooms/floor_step_near_1.mp3',
    'rooms/floor_step_near_2.mp3',
    'rooms/floor_step_near_3.mp3',
    'rooms/crawl_wood_3.mp3',
    'rooms/breath_beside.mp3',
    'rooms/breath_other.mp3',
    'rooms/sniff_1.mp3',
    'rooms/sniff_2.mp3',
    'rooms/coat_move.mp3',
    'rooms/heart_beat.mp3',
    'rooms/chair_scrape_floor.mp3',
    'rooms/cutlery_far.mp3',
    'rooms/fork_plate_2.mp3',
    'rooms/fork_down_1.mp3',
    'rooms/whisper_gabble.mp3',
  ],
};

/** Half the side of the square room, its height, the eye at its exact middle (m). */
const R = 5.6;
const H = 3.7;
const EYE = 1.55;
/** The door in the middle of each wall: width, height, how far the corridor goes on behind it (m), how far it stands open (rad). */
const DOOR = { w: 0.92, h: 2.1, beyond: 3.6, open: -1.3 };
/** Heading of each wall's door from the eye, in the order they are built. */
const DOOR_TURN = [0, Math.PI, Math.PI / 2, -Math.PI / 2];
/** Where the chair that faces you stands, and the table it turned out to belong to (m ahead of the eye). */
const CHAIR_Z = -3.25;
const TABLE_Z = -4.3;
/** Where the viewer's own prints hang: which wall, x along it, height (m). */
const PRINTS: readonly (readonly [number, number, number])[] = [
  [0, -1.35, 1.55],
  [0, 1.35, 1.5],
  [0, -2.07, 1.5],
  [0, 2.07, 1.6],
  [1, -1.3, 1.5],
  [1, 1.3, 1.6],
  [2, -1.5, 1.55],
  [2, 1.5, 1.5],
  [3, 1.5, 1.55],
  [3, -1.5, 1.6],
];
/** Height of the picture rail (m), and the long damp stains on the walls: which wall, x along it, width (m), which of the four. */
const FRIEZE = 2.46;
const DAMP: readonly (readonly [number, number, number, number])[] = [
  [0, -2.7, 1.8, 0],
  [0, 3.3, 1.5, 1],
  [1, 1.8, 2.2, 2],
  [2, -2.4, 1.6, 3],
  [2, 3.4, 1.4, 0],
  [3, 2.2, 2, 1],
  [3, -3.3, 1.5, 2],
];
/** The far corner where the low sheet stands, and later the tall one (x, z, m). */
const CORNER = [-3.05, -4.8] as const;
/** The linen against the flash: all of it, and the sheet nearest the lens, which would burn out. */
const LINEN = { all: 0.8, near: 0.42 };
/** The sheet that stands: a covered stand, narrower and taller than the one by the far wall (scale), and let into the floor so that its hem reaches it all the way round (m). */
const TALL = { across: 0.76, up: 1.28, sink: 0.26 };
/** Varnished panelling under a flash goes pale: how much its shine and its color are held down. */
const PANEL = { roughness: 0.74, shade: 0.6 };
/** The floor's shine: waxed, and for the ninth, whose gun stands so low that it would lay a white slab on the boards. */
const BOARDS = { waxed: 0.4, ninth: 0.95 };
/** Cream paint keeps too much light inside a shadow: how dark the doors are in the ninth. */
const DOOR_NINTH = 0.55;
/** Side of the carpet (m). */
const RUG = 7.4;
/** How much darker than the file the table and its cloth are. */
const TABLE_SHADE = 0.55;
const LEG_SHADE = 0.1;
/** Height of a contact shadow: just over the carpet. */
const ON_RUG = 0.016;
/** In the fourth shot, where the three are (x, z from the eye, m); how much nearer the chair is in the fifth. */
const THREE: readonly (readonly [number, number])[] = [
  [-1.45, -3.2],
  [0.35, -4.0],
  [1.7, -3.25],
];
const CHAIR_CREPT = 0.5;
/** How far from the eye the face of the seventh shot is (m). */
const FACE_AT = 0.235;
const FACE_LIFT = 0.03;

/** Seconds into the room at which the camera fires by itself if the viewer has not got that far. */
const FALLBACK = [12, 22, 31, 40, 48, 56, 63, 70];
/** Seconds the flash takes to charge again after each shot: its battery is dying. */
const RECHARGE = [2.5, 2.5, 2.5, 2.5, 3.2, 5.1, 2.5, 0];
/** Second of the room at which the one behind you fires, and at which everything is cut. */
const NINTH = 76;
const CUT = 84;
/** What the room's own air gives (env intensity); in the ninth more, so that the paper can be made out inside the shadows: it is that which makes them shadows. */
const AIR = 0.012;
const IN_THE_SHADOWS = 0.05;
/** The light of a shot is real for this long, and goes out over this long (s); then only the afterimage is left. */
const LIT_HOLD = 0.3;
const LIT_FALL = 0.16;
/** The afterimage lets go of what is left of the picture between these seconds after a shot (the ninth: twice as long). */
const LET_GO = [3.2, 6.4];
/** The white over the picture at the pop falls away in this long (s). */
const WHITE_FALL = 0.13;

/** What each shot (0 is the ninth) throws: gun and fill (candela), the gun's offset from the lens (m), the afterimage's length (`film.ghost`). */
const SHOTS = [
  { gun: 1450, fill: 7, right: 0, up: -0.7, back: 4.8, ghost: 0.8, white: 0.55, angle: 32, emissive: 0.02, low: -0.25, hair: 1 },
  { gun: 150, fill: 8, right: 0.42, up: 0.34, back: 0, ghost: 0.56, white: 1, angle: 48, emissive: 0.02, low: 0.55, hair: 0.42 },
  { gun: 150, fill: 8, right: 0.42, up: 0.34, back: 0, ghost: 0.56, white: 1, angle: 48, emissive: 0.02, low: 0.55, hair: 0.42 },
  { gun: 200, fill: 12, right: 0.42, up: 0.34, back: 0, ghost: 0.58, white: 1, angle: 47, emissive: 0.02, low: 0.55, hair: 0.42 },
  { gun: 170, fill: 8, right: 0.42, up: 0.34, back: 0, ghost: 0.58, white: 1, angle: 48, emissive: 0.02, low: 0.55, hair: 0.36 },
  { gun: 150, fill: 8, right: 0.42, up: 0.34, back: 0, ghost: 0.62, white: 1, angle: 48, emissive: 0.02, low: 0.55, hair: 0.42 },
  { gun: 11, fill: 0, right: 0.3, up: 0.3, back: 0, ghost: 0.66, white: 1, angle: 56, emissive: 0.02, low: 0.55, hair: 0.85 },
  { gun: 0.62, fill: 0, right: 0.1, up: 0.1, back: 0, ghost: 0.74, white: 1, angle: 60, emissive: 0.015, low: 0, hair: 1 },
  { gun: 170, fill: 10, right: 0.42, up: 0.34, back: 0, ghost: 0.62, white: 1, angle: 47, emissive: 0.02, low: 0.55, hair: 0.42 },
] as const;

/** The silence between the pop and the whine (s). */
const WHINE_AFTER = 0.4;
/** How long after a shot the room's tone starts to come back (s), and how long it takes. */
const TONE_BACK = 1.5;
const TONE_FADE = 3;
/** Seconds before a shot that fires by itself that every sound in the room stops. */
const HUSH = 0.9;
/** The last stretch, to the second of the room: another flash charging behind you, the silence, the pop (`NINTH`), its print coming out. */
const THEIR_CHARGE = 70.25;
const THEIR_HUSH = 75.4;
const THEIR_PRINT = 78;
/** How long after the last frame the dinner can be heard, and after which second of the room nothing of it goes on. */
const DINNER_FROM = 8;
const DINNER_ENDS = 69.2;

/** The counter on the camera's back: how fast its wheel steps (1/s), how bright it is, its size and place (shares of the picture's height), and how long after a shot the wheel moves on and the number can be seen again (s). */
const DIAL = { rate: 16, glow: 0.42, size: 0.05, margin: 0.06, depth: 0.16, tick: 1.9, back: [2.3, 3.8] };
/** The little neon lamp beside it: how bright when the flash is ready, and how bright it creeps up while charging. */
const NEON = { ready: 2.4, charging: 0.12 };
/** Seconds after these shots that something stands between you and your own camera, and its lights go out (shot, from, to). */
const COVERED: readonly (readonly [number, number, number])[] = [
  [5, 5.1, 6.5],
  [8, 15, 17],
];
/** Dust caught in the flash right before the lens: how many specks, and how strong. */
const SPECKS = { count: 16, strength: 0.34 };

/** One sound that comes out of the dark: seconds after the shot before it, the file, where it is in the room (x, z), its gain, and a far one is dulled. */
interface Cue {
  at: number;
  file: string;
  x: number;
  z: number;
  gain: number;
  far?: boolean;
  reverb?: number;
}
/** What comes between the shots (the first row before the first, in seconds of the room): far, nearer, here, and each time it stops before you know. */
const BETWEEN: readonly (readonly Cue[])[] = [
  [{ at: 8.6, file: 'rooms/floor_creak_2.mp3', x: -3.5, z: -4.6, gain: 0.22, far: true, reverb: 0.25 }],
  [
    { at: 3.3, file: 'rooms/sheet_slide_floor.mp3', x: 0, z: -3.1, gain: 0.42, far: true, reverb: 0.3 },
    { at: 5.9, file: 'rooms/floor_creak_3.mp3', x: -1.6, z: -3.9, gain: 0.2, far: true, reverb: 0.2 },
    { at: 7.7, file: 'rooms/floor_creak_1.mp3', x: -3.0, z: -4.6, gain: 0.2, far: true, reverb: 0.2 },
  ],
  [
    { at: 3.1, file: 'rooms/floor_creak_4.mp3', x: -2.4, z: -5.0, gain: 0.22, far: true, reverb: 0.2 },
    { at: 5.2, file: 'rooms/door_creak_short.mp3', x: 0, z: -5.6, gain: 0.34, far: true, reverb: 0.3 },
    { at: 7.2, file: 'rooms/step_wood_1.mp3', x: 0, z: -5.2, gain: 0.26, far: true, reverb: 0.2 },
  ],
  [
    { at: 2.9, file: 'rooms/step_wood_2.mp3', x: 0.2, z: -4.9, gain: 0.26, far: true, reverb: 0.2 },
    { at: 4.2, file: 'rooms/step_wood_3.mp3', x: -1.1, z: -4.6, gain: 0.28, far: true, reverb: 0.2 },
    { at: 5.5, file: 'rooms/step_wood_4.mp3', x: 1.3, z: -4.4, gain: 0.28, far: true, reverb: 0.2 },
    { at: 7.1, file: 'rooms/step_wood_1.mp3', x: 0.3, z: -4.0, gain: 0.3, reverb: 0.15 },
  ],
  [
    { at: 3.4, file: 'rooms/floor_step_near_1.mp3', x: -1.4, z: -2.1, gain: 0.26, reverb: 0.1 },
    { at: 5.1, file: 'rooms/floor_step_near_2.mp3', x: 1.5, z: -1.8, gain: 0.28, reverb: 0.1 },
    { at: 6.4, file: 'rooms/floor_creak_long.mp3', x: 1.2, z: 1.6, gain: 0.2, reverb: 0.15 },
  ],
  // the worst: nothing, for a long time, and then someone is breathing
  [
    { at: 6.2, file: 'rooms/sniff_2.mp3', x: 0.8, z: 0.5, gain: 0.2 },
  ],
  [
    { at: 2.4, file: 'rooms/coat_move.mp3', x: -0.5, z: -0.6, gain: 0.36, reverb: 0.1 },
    { at: 4.3, file: 'rooms/sniff_1.mp3', x: 0.7, z: -0.3, gain: 0.26 },
  ],
  // every sheet in the room comes down in the dark
  [
    { at: 1.3, file: 'rooms/heart_beat.mp3', x: 0, z: 0, gain: 0.4 },
    { at: 3.1, file: 'rooms/sheet_drop_long.mp3', x: -3.6, z: -2, gain: 0.34, reverb: 0.25 },
    { at: 3.7, file: 'rooms/sheet_drop_long.mp3', x: 3.6, z: 0.5, gain: 0.3, reverb: 0.25 },
    { at: 4.5, file: 'rooms/sheet_slide_floor.mp3', x: 0.6, z: 3.5, gain: 0.34, reverb: 0.3 },
  ],
  // after the last frame: someone sits down to dinner
  [
    { at: 4.5, file: 'rooms/chair_scrape_floor.mp3', x: -1.2, z: -4.2, gain: 0.2, far: true, reverb: 0.3 },
    { at: 12, file: 'rooms/fork_plate_2.mp3', x: 0.4, z: -4.2, gain: 0.26, far: true, reverb: 0.2 },
    { at: 17, file: 'rooms/chair_scrape_floor.mp3', x: 1.3, z: -4.3, gain: 0.2, reverb: 0.3 },
    { at: 22.5, file: 'rooms/crawl_wood_3.mp3', x: -1.8, z: 0.5, gain: 0.3 },
    { at: 28, file: 'rooms/floor_step_near_3.mp3', x: 1.0, z: 0.8, gain: 0.26, reverb: 0.1 },
  ],
];
/** Each pop is one of these in turn. */
const POPS = ['rooms/flash_pop_1.mp3', 'rooms/flash_pop_2.mp3', 'rooms/flash_pop_3.mp3'];
/** How afraid the piece is after each shot (0 is the ninth, and the time before the first). */
const FEAR = [0.9, 0.3, 0.38, 0.46, 0.56, 0.68, 0.78, 0.95, 0.5];

/** The people's hair (see hairCurtain), the skull it lies on (half its width, height and depth, m) and how far above the head's joint that sits (m). */
const HAIR: { skull: readonly [number, number, number]; lift: number } & Omit<HairSpec, 'seed'> = { strands: 1300, length: 0.66, width: 0.00072, segments: 8, bow: 0.42, part: 0, fringe: 0, strays: 0, taper: 0.4, slim: 0, locks: 13, gather: 0.75, crown: 0, skull: [0.094, 0.126, 0.112], lift: 0.1 };
/** The hair of those seen across the room: close to the head, fine, and down to the waist, or at that distance it is a mop. */
const FAR_HAIR = { strands: 2000, width: 0.0005, length: 0.84, slim: 0.75, locks: 26, gather: 0.35, crown: 0.6 };

/**
 * Those standing behind you in the ninth (x, z behind the eye, heading, scale), left clear around your own shadow
 * in the middle and rising outward from it; the pose of your own body, which has a hand at its face.
 */
const BEHIND_MEN: readonly (readonly [number, number, number, number])[] = [
  [0.64, 0.5, -0.1, 1],
  [-1.2, 0.9, 0.2, 1],
  [1.42, 1.1, -0.2, 1.03],
  [-0.7, 1.5, 0.1, 1],
];
const BEHIND_WOMEN: readonly (readonly [number, number, number, number])[] = [
  [1.2, 0.9, -0.2, 1.04],
  [-1.42, 1.1, 0.2, 1.03],
  [0.72, 1.5, -0.1, 1.02],
];
const BEHIND_HEADLESS: readonly (readonly [number, number, number, number])[] = [
  [-0.95, 0.7, 0.2, 1.03],
  [0.95, 0.7, -0.3, 1.03],
];
/** The one who has turned to you, and whose arm's shadow comes to your shadow's shoulder (x, z behind the eye, the time in its clip). */
const REACHING = { x: -0.72, z: 0.42, time: 1 };
const YOU_POSE = 1.6;
/** Their heads are bowed in the shadow too; yours is not (rad). */
const BEHIND_BOW = 0.45;

/** Old dust sheets: off-white, yellowed where it hung longest, grey where the dust lies, dirty at the hem. They come with no UVs. */
function stainCloth(mesh: Mesh): void {
  const g = mesh.geometry;
  if (g.getAttribute('uv')) return;
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  mesh.updateWorldMatrix(true, false);
  const s = mesh.matrixWorld.getMaxScaleOnAxis();
  const uv = new Float32Array(p.count * 2);
  const color = new Float32Array(p.count * 3);
  let low = Infinity;
  for (let i = 0; i < p.count; i++) low = Math.min(low, p.getY(i) * s);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) * s;
    const y = p.getY(i) * s;
    const z = p.getZ(i) * s;
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    uv[i * 2] = ay >= ax && ay >= az ? x : ax >= az ? z : x;
    uv[i * 2 + 1] = ay >= ax && ay >= az ? z : y;
    const blotch = Math.sin(x * 2.3 + Math.sin(z * 1.7) * 1.4) * Math.sin(z * 2.9 + Math.sin(y * 2.1) * 1.3) * Math.sin(y * 3.1 + x * 1.1);
    const fine = Math.sin(x * 11.0 + y * 7.0) * Math.sin(z * 13.0 - y * 5.0);
    const yellow = 0.5 + 0.5 * blotch;
    const dust = Math.max(0, n.getY(i)) * 0.16;
    const hem = Math.max(0, 1 - (y - low) / 0.34) * 0.3;
    const v = 0.9 - dust - hem + fine * 0.025;
    color[i * 3] = v * (1 - yellow * 0.05);
    color[i * 3 + 1] = v * (1 - yellow * 0.1);
    color[i * 3 + 2] = v * (1 - yellow * 0.22);
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setAttribute('color', new BufferAttribute(color, 3));
}

/**
 * Long hair round a head (its middle at the origin, the face toward +Z): pale threads with black between them.
 * `bow` tips the crown forward (rad), so that it falls before the face; `part` keeps this angle (rad) either side
 * of the face clear, but for `strays`, and then `fringe` threads leave the parting and cross the temples.
 */
interface HairSpec {
  seed: number;
  strands: number;
  length: number;
  width: number;
  segments: number;
  bow: number;
  part: number;
  fringe: number;
  strays: number;
  /** How much of its width a thread loses by its end. */
  taper: number;
  /** 0 stands loose and wide of the head, 1 follows the skull and falls close. */
  slim: number;
  /** How many loose locks a head of hair falls into on each side, and how much of the way to its lock a thread goes. */
  locks: number;
  gather: number;
  /** How much darker a thread is where it leaves the head, where they lie thickest and the flash would burn them white. */
  crown: number;
}

function hairCurtain(o: HairSpec): BufferGeometry {
  const random = randomFrom(o.seed);
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  const [rx, ry, rz] = HAIR.skull;
  let base = 0;
  const thread = (a: number, polar: number, tip: number, gather: number, long: number, shade: number, wave: number, width: number, hang: number) => {
    const kink = random() * 6.28;
    const y0 = Math.cos(polar) * ry;
    for (let k = 0; k <= o.segments; k++) {
      // most of the joints where it lies over the skull
      const t = (k / o.segments) ** 1.6;
      const y = y0 - long * t;
      const turn = a + (tip - a) * smootherstep(range(0, gather, t)) + Math.sin(t * 6 + kink) * wave * t;
      const sn = Math.sin(turn);
      const cs = Math.cos(turn);
      const wide = rx * Math.abs(sn) + rz * Math.abs(cs);
      const skull = wide + (1 / Math.hypot(sn / rx, cs / rz) - wide) * o.slim;
      const hug = Math.abs(y) < ry ? Math.sqrt(1 - (y / ry) ** 2) * skull * 1.03 : 0;
      // it does not go in under the head: from the widest of the skull it only falls
      const fall = y < 0 ? skull * 1.03 + hang * (1 - o.slim * 0.7) * smootherstep(range(0, -0.5, y)) : 0;
      const rho = Math.max(hug, fall);
      const x = rho * sn + Math.sin(t * 13 + kink) * 0.004 * t;
      const z = rho * cs;
      const w = width * (1 - t * o.taper);
      positions.push(x - cs * w, y, z + sn * w, x + cs * w, y, z - sn * w);
      normals.push(sn, 0.2, cs, sn, 0.2, cs);
      const v = shade * (1 - o.crown * (1 - smootherstep(range(0.02, 0.3, t))));
      colors.push(v, v * 0.985, v * 0.95, v, v * 0.985, v * 0.95);
      if (k < o.segments) {
        const i = base + k * 2;
        index.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
      }
    }
    base += (o.segments + 1) * 2;
  };
  const cosBow = Math.cos(o.bow);
  const sinBow = Math.sin(o.bow);
  // half of them pale, half lying in the others' shade: it is the black between them that reads as hair
  const shadeOf = (v: number) => (v < 0.45 ? 0.03 + v * 0.3 : 0.3 + (v - 0.45) * 1.2);
  for (let n = 0; n < o.strands; n++) {
    const a0 = (random() * 2 - 1) * Math.PI;
    const polar0 = Math.acos(Math.max(-0.2, 1 - random() * 1.15));
    const vx = Math.sin(polar0) * Math.sin(a0);
    const vy = Math.cos(polar0);
    const vz = Math.sin(polar0) * Math.cos(a0);
    let a = Math.atan2(vx, vy * sinBow + vz * cosBow);
    const polar = Math.acos(clamp(vy * cosBow - vz * sinBow, -1, 1));
    if (o.part > 0 && Math.abs(a) < o.part) a = Math.sign(a || 1) * (o.part + random() * 0.7);
    // toward its end each thread falls in with the nearest of a few loose locks
    const lock = Math.round((a / Math.PI) * o.locks) * (Math.PI / o.locks);
    thread(a, polar, a + (lock - a) * o.gather + (random() - 0.5) * 0.06, 1, o.length * (0.55 + random() * 0.55), shadeOf(random()), 0.015 + random() * 0.03, o.width * (0.5 + random() * 0.9), 0.03 + random() * 0.05);
  }
  for (let n = 0; n < o.fringe; n++) {
    const side = n % 2 === 0 ? -1 : 1;
    const a = side * (0.05 + random() * 0.8);
    thread(a, 0.04 + random() * 0.45, side * (o.part + 0.1 + random() * 0.45), 0.16 + random() * 0.12, o.length * (0.6 + random() * 0.5), shadeOf(random()), 0.03, o.width * (0.6 + random() * 0.8), 0.03 + random() * 0.03);
  }
  for (let n = 0; n < o.strays; n++) {
    const a = (random() * 2 - 1) * (o.part + 0.2);
    thread(a, 0.55 + random() * 0.6, a + (random() - 0.5) * 0.7, 1, o.length * (0.22 + random() * 0.4), 0.25 + random() * 0.5, 0.2, o.width * (0.4 + random() * 0.3), 0.02);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  return g;
}

/** A face scratched out by hand, as a face is scratched out of a print: the rest of it left whole, and only the eyes and the mouth gone under paper-white gouges. */
function scratchedFace(source: Texture): CanvasTexture {
  const whole = headMap(source, 'keep', true, 977).image as HTMLCanvasElement;
  const side = Math.max(2048, whole.width);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = side;
  const c = canvas.getContext('2d')!;
  c.drawImage(whole, 0, 0, side, side);
  // old and bloodless: its color gone, its light and shade kept
  c.globalCompositeOperation = 'saturation';
  c.fillStyle = 'rgba(40,40,40,0.82)';
  c.fillRect(0, 0, side, side);
  c.globalCompositeOperation = 'source-over';
  const random = randomFrom(5150);
  // years: blotches and fine lines over the whole face
  for (let i = 0; i < 90; i++) {
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(random());
    const x = (0.5 + Math.cos(a) * r * 0.17) * side;
    const y = (0.685 + Math.sin(a) * r * 0.21) * side;
    const g = c.createRadialGradient(x, y, 0, x, y, (0.004 + random() * 0.012) * side);
    g.addColorStop(0, `rgba(70,52,40,${0.05 + random() * 0.14})`);
    g.addColorStop(1, 'rgba(70,52,40,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, side, side);
  }
  c.strokeStyle = 'rgba(40,28,22,0.22)';
  c.lineWidth = 0.0009 * side;
  for (let i = 0; i < 46; i++) {
    const x = (0.36 + random() * 0.28) * side;
    const y = (0.5 + random() * 0.38) * side;
    const l = (0.015 + random() * 0.05) * side;
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + l / 2, y + (random() - 0.5) * l * 0.4, x + l, y + (random() - 0.5) * l * 0.25);
    c.stroke();
  }
  // a scratch comes to a point at both ends; beside it a thin dark line, where it cut in
  const gouge = (cx: number, cy: number, angle: number, length: number, width: number, white: number) => {
    const steps = 6;
    const xs: number[] = [];
    const ys: number[] = [];
    let x = cx - (Math.cos(angle) * length) / 2;
    let y = cy - (Math.sin(angle) * length) / 2;
    for (let i = 0; i <= steps; i++) {
      xs.push(x);
      ys.push(y);
      const a = angle + (random() - 0.5) * 0.24;
      x += (Math.cos(a) * length) / steps;
      y += (Math.sin(a) * length) / steps;
    }
    const needle = (grow: number, shift: number, fill: string) => {
      const nx = -Math.sin(angle);
      const ny = Math.cos(angle);
      c.fillStyle = fill;
      c.beginPath();
      for (let i = 0; i <= steps; i++) {
        const w = width * grow * Math.sin((i / steps) * Math.PI) + shift;
        c[i === 0 ? 'moveTo' : 'lineTo']((xs[i] + nx * w) * side, (ys[i] + ny * w) * side);
      }
      for (let i = steps; i >= 0; i--) {
        const w = -width * grow * Math.sin((i / steps) * Math.PI) + shift;
        c.lineTo((xs[i] + nx * w) * side, (ys[i] + ny * w) * side);
      }
      c.closePath();
      c.fill();
    };
    needle(1, width * 0.9, 'rgba(10,6,5,0.75)');
    needle(1, 0, `rgba(240,234,218,${white})`);
  };
  // nothing of the eye is left: its own patch, and a black pit under the gouges
  c.fillStyle = '#030202';
  c.beginPath();
  c.arc(0.264 * side, 0.058 * side, 0.085 * side, 0, Math.PI * 2);
  c.fill();
  for (const [x, y, rx, ry] of [[0.434, 0.72, 0.05, 0.03], [0.568, 0.72, 0.05, 0.03], [0.5, 0.59, 0.07, 0.022]] as const) {
    c.beginPath();
    c.ellipse(x * side, y * side, rx * side, ry * side, 0, 0, Math.PI * 2);
    c.fill();
  }
  // back and forth over the eyes and the mouth, harder each time, and a few long ones across the whole
  const targets = [[0.434, 0.72, 0.06, 0.042, 330], [0.568, 0.72, 0.06, 0.042, 330], [0.5, 0.59, 0.085, 0.032, 280], [0.5, 0.685, 0.14, 0.2, 40]] as const;
  for (const [tx, ty, spreadX, spreadY, count] of targets) {
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2;
      const r = Math.sqrt(random());
      const across = random() < 0.2 ? 1.25 : 0;
      const long = count < 50 ? 0.09 + random() * 0.14 : 0.02 + random() * 0.08;
      gouge(tx + Math.cos(a) * r * spreadX, ty + Math.sin(a) * r * spreadY, -0.72 + (random() - 0.5) * 0.45 + across, long, 0.0003 + random() * random() * 0.0016, 0.55 + random() * 0.45);
    }
  }
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.flipY = source.flipY;
  map.wrapS = source.wrapS;
  map.wrapT = source.wrapT;
  map.anisotropy = 4;
  return map;
}

/** The family's carpet: dark madder and darker blue, rows of plain octagons gone faint, worn pale where people walked. */
function drawRug(c: CanvasRenderingContext2D, size: number): void {
  const m = size / RUG;
  const random = randomFrom(61);
  c.fillStyle = '#2b100e';
  c.fillRect(0, 0, size, size);
  const step = 0.78 * m;
  for (let row = -6; row <= 6; row++) {
    for (let col = -6; col <= 6; col++) {
      const x = size / 2 + col * step + (row % 2 === 0 ? 0 : step / 2);
      const y = size / 2 + row * step * 0.8;
      for (const [r, fill] of [[0.33, '#150b0b'], [0.3, '#4c3a2a'], [0.27, '#1d1012'], [0.15, '#3f1712'], [0.075, '#55452f']] as const) {
        const q = r * m;
        c.fillStyle = fill;
        c.beginPath();
        for (let i = 0; i < 8; i++) c[i === 0 ? 'moveTo' : 'lineTo'](x + Math.cos(i * 0.785 + 0.39) * q, y + Math.sin(i * 0.785 + 0.39) * q * 0.82);
        c.closePath();
        c.fill();
      }
    }
  }
  const band = (from: number, width: number, fill: string) => {
    c.strokeStyle = fill;
    c.lineWidth = width * m;
    const q = (from + width / 2) * m;
    c.strokeRect(q, q, size - 2 * q, size - 2 * q);
  };
  band(0, 0.08, '#120d0b');
  band(0.08, 0.03, '#4c3a2a');
  band(0.11, 0.4, '#10141a');
  band(0.51, 0.03, '#4c3a2a');
  band(0.54, 0.05, '#150b0b');
  c.fillStyle = '#4a3c2a';
  const stops = Math.floor(RUG / 0.2);
  for (let i = 0; i < stops; i++) {
    const t = ((i + 0.5) / stops) * size;
    const q = 0.31 * m;
    for (const [x, y] of [[t, q], [t, size - q], [q, t], [size - q, t]]) {
      c.save();
      c.translate(x, y);
      c.rotate(0.785);
      c.fillRect(-0.035 * m, -0.035 * m, 0.07 * m, 0.07 * m);
      c.restore();
    }
  }
  // years of feet and dust: bare where people walked, darker where they did not
  for (let i = 0; i < 240; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = (0.12 + random() * 0.8) * m;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    const worn = Math.hypot(x - size / 2, y - size / 2) < size * 0.34 && random() < 0.55;
    const tone = worn ? '92,76,58' : '4,3,3';
    const a = worn ? 0.08 + random() * 0.2 : 0.1 + random() * 0.26;
    g.addColorStop(0, `rgba(${tone},${a})`);
    g.addColorStop(1, `rgba(${tone},0)`);
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 120000; i++) {
    c.fillStyle = i % 2 === 0 ? 'rgba(0,0,0,0.26)' : 'rgba(170,150,120,0.05)';
    c.fillRect(random() * size, random() * size, 1 + random() * 1.5, 1 + random() * 1.5);
  }
}

/** The ceiling: old distemper, rings of damp, a crack or two. */
function drawCeilingStains(c: CanvasRenderingContext2D, size: number): void {
  const random = randomFrom(83);
  c.fillStyle = '#6a685c';
  c.fillRect(0, 0, size, size);
  for (let i = 0; i < 26; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = (0.04 + random() * 0.16) * size;
    const g = c.createRadialGradient(x, y, r * 0.5, x, y, r);
    const a = 0.1 + random() * 0.26;
    g.addColorStop(0, `rgba(36,30,20,${a * 0.5})`);
    g.addColorStop(0.86, `rgba(30,24,16,${a})`);
    g.addColorStop(1, 'rgba(30,24,16,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  c.strokeStyle = 'rgba(14,12,10,0.6)';
  for (let i = 0; i < 7; i++) {
    let x = random() * size;
    let y = random() * size;
    let a = random() * 6.28;
    c.lineWidth = 0.6 + random() * 1.4;
    c.beginPath();
    c.moveTo(x, y);
    for (let k = 0; k < 16; k++) {
      a += (random() - 0.5) * 1.1;
      x += Math.cos(a) * size * 0.02;
      y += Math.sin(a) * size * 0.02;
      c.lineTo(x, y);
    }
    c.stroke();
  }
}

/** Damp down a wall: black with its own alpha, four long stains side by side on one canvas. */
function drawDamp(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(29);
  const cell = w / 4;
  for (let n = 0; n < 4; n++) {
    const cx = (n + 0.5) * cell;
    for (let i = 0; i < 26; i++) {
      const x = cx + (random() - 0.5) * cell * 0.7;
      const y = random() * h * 0.5;
      const r = (0.05 + random() * 0.14) * cell * 2;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${0.08 + random() * 0.2})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 34; i++) {
      const x = cx + (random() - 0.5) * cell * 0.8;
      const top = random() * h * 0.4;
      const long = (0.2 + random() * 0.6) * h;
      const g = c.createLinearGradient(0, top, 0, top + long);
      const a = 0.08 + random() * 0.26;
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x, top, 1 + random() * 5, long);
    }
  }
}

/** Old cream paint on a door, streaked and blotched all over (its panels have UVs of their own: nothing here can go by place). */
function drawDoorPaint(c: CanvasRenderingContext2D, w: number, h: number): void {
  const random = randomFrom(53);
  c.fillStyle = '#7f7564';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 150; i++) {
    c.fillStyle = `rgba(40,32,22,${0.03 + random() * 0.09})`;
    c.fillRect(random() * w, random() * h, 1 + random() * 3, (0.05 + random() * 0.4) * h);
  }
  for (let i = 0; i < 46; i++) {
    const r = 2 + random() * 24;
    const x = random() * w;
    const y = random() * h;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(24,18,12,${0.05 + random() * 0.18})`);
    g.addColorStop(1, 'rgba(24,18,12,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** A canvas as a texture. */
function canvasOf(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A body's head bent forward about the neck (a copy of the bake: the bake is shared). */
function bowed(source: BufferGeometry, neck: Vector3, angle: number): BufferGeometry {
  const g = source.clone();
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    const w = smootherstep(range(neck.y - 0.03, neck.y + 0.05, p.getY(i)));
    if (w <= 0) continue;
    const c = Math.cos(angle * w);
    const sn = Math.sin(angle * w);
    const y = p.getY(i) - neck.y;
    const z = p.getZ(i) - neck.z;
    p.setY(i, neck.y + y * c - z * sn);
    p.setZ(i, neck.z + y * sn + z * c);
    const ny = n.getY(i);
    const nz = n.getZ(i);
    n.setY(i, ny * c - nz * sn);
    n.setZ(i, ny * sn + nz * c);
  }
  return g;
}

interface Solid {
  object: Object3D;
  x: number;
  z: number;
  r: number;
}

/**
 * The dark. A large room in the house, its furniture under sheets, every light off. The only light there is
 * is the viewer's own flash: eight frames. Each shows what has happened while it was dark, and what it shows
 * goes by how many have been fired, never by the time. The room has a door in every wall, and the eye stands
 * in its exact middle, so whichever way the viewer turns in the dark there is a picture there.
 */
export default class Darkness extends Room {
  readonly keys: readonly RoomKey[] = [
    { t: 0, at: [0, EYE, 0], yaw: 0, pitch: -3.5, fov: 56 },
    { t: 1, at: [0, EYE, -0.3], yaw: 0, pitch: -3.5, fov: 54 },
  ];
  readonly air: RoomAir = {
    fog: { color: 0x000000, density: 0.012 },
    env: 'bathroom',
    envIntensity: AIR,
    sky: 0,
    grade: { exposure: 1.05, saturation: 0.72, warmth: 0, tint: -0.02, flare: 0 },
  };
  film = { bloom: 0.55, bloomFrom: 0.9, grain: 0, ghost: 0, scratches: 0, aberration: 0.004 };
  control = { look: true, scroll: true, press: false, hurry: 2.5 };
  drift = 0.25;
  fear = 0.25;

  private readonly stage = new Group();
  private readonly gunAt: [number, number, number] = [0, 0, 0];
  private readonly gunTo: [number, number, number] = [0, 0, 0];
  private readonly fillAt: [number, number, number] = [0, 0, 0];
  private readonly fillTo: [number, number, number] = [0, 0, 0];
  private readonly gun: SpotSpec;
  private readonly fillLight: SpotSpec;
  private readonly linen: MeshStandardMaterial;
  private readonly chairWood: Material;
  private readonly hairLit: MeshStandardMaterial;
  private boards!: MeshStandardMaterial;
  private readonly solids: Solid[] = [];
  private readonly leaves: Object3D[] = [];
  private readonly mote: { value: number };
  private clock!: Object3D;
  private standing!: Object3D;

  // what changes from shot to shot
  private readonly chairSheet: Object3D;
  private readonly chairBare: Object3D;
  private readonly lowSheet: Object3D;
  private readonly tallSheet: Object3D;
  private readonly bareChair: Object3D;
  private readonly actors = new Group();
  private readonly atDoor = new Group();
  private readonly trio = new Group();
  private readonly row = new Group();
  private readonly gazeRig = new Group();
  private readonly table = new Group();
  private readonly behind = new Group();

  // the camera in the viewer's hands: its counter and lamp, and what the flash catches right before the lens
  private readonly dial = new Group();
  private readonly dialMap: Texture;
  private readonly dialLight: MeshBasicMaterial;
  private readonly neon: MeshBasicMaterial;
  private readonly specks: Mesh;
  private wheel = 1;
  private shutterDue = false;
  private whineDue = false;

  // what is heard
  private readonly voice: RoomVoiceOptions = {};
  private toneOn = false;
  private cue = 0;
  private dinnerOn = false;
  private hushed = false;

  // the viewer's camera
  private fired = 0;
  private since = Infinity;
  private charge = 2.5;
  private ninthDone = false;

  constructor(ctx: RoomContext) {
    super(ctx);
    const b = this.build;
    const k = this.kit;
    this.root.add(this.stage);
    const weave = k.surface('linen_white', 0.4).normalMap!;
    this.linen = new MeshStandardMaterial({ color: new Color(0xece8dc).multiplyScalar(LINEN.all), vertexColors: true, normalMap: weave, normalScale: new Vector2(0.5, 0.5), roughness: 0.96, metalness: 0 });
    const nearLinen = this.linen.clone();
    nearLinen.color.multiplyScalar(LINEN.near);
    this.hairLit = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, side: DoubleSide, roughness: 0.5, metalness: 0, emissive: new Color(0xc9c2b2), emissiveIntensity: 0.02 });

    this.chairWood = b.wood(0.7);
    this.buildShell();
    this.chairSheet = this.cloth('sheet_chair', 0, CHAIR_Z, 0, 0.95, nearLinen);
    this.chairBare = this.solid('chair_ladder', 0, CHAIR_Z, 0, 0.5, 1, this.chairWood);
    this.lowSheet = this.cloth('sheet_armchair', CORNER[0], CORNER[1], 28, 1.35);
    // a stand's square top under the linen, never a head: it is furniture that is taller than it was
    this.tallSheet = this.cloth('sheet_lamp', CORNER[0], CORNER[1], 20, 0.85);
    this.tallSheet.scale.set(TALL.across, TALL.up, TALL.across);
    this.tallSheet.position.y = -TALL.sink;
    this.tallSheet.children[this.tallSheet.children.length - 1].position.y += TALL.sink / TALL.up;
    this.bareChair = this.solid('armchair', CORNER[0], CORNER[1], 28, 0.7);
    this.dress();
    this.buildPeople();
    this.buildTable();
    this.buildBehind();
    this.stage.add(this.actors);
    this.actors.add(this.trio, this.row, this.gazeRig, this.table, this.behind);
    this.stage.add(this.atDoor);
    this.mote = b.motes(150, { x: [-R, R], y: [0.1, H], z: [-R, R] }, this.stage, { strength: 0.8, size: 0.009 }).time;

    this.gun = this.spot([0, 0, 0], [0, 0, -1], 0xfff3e4, 0, 48, 0.78);
    this.fillLight = this.spot([0, 0, 0], [0, 0, -1], 0xd5e6e2, 0, 40, 0.9);
    this.gun.position = this.gunAt;
    this.gun.target = this.gunTo;
    this.fillLight.position = this.fillAt;
    this.fillLight.target = this.fillTo;
    this.spots = [this.gun, this.fillLight, null];

    // a two-sided pane would be drawn, and compiled, twice
    this.stage.traverse((part) => {
      const m = (part as Mesh).material as Material | undefined;
      if (m?.transparent && m.side === DoubleSide) m.forceSinglePass = true;
    });

    // the camera, on the lens
    const digits = canvasOf(96, 96 * 11, (c) => {
      c.font = "700 76px 'Special Elite', 'Courier New', monospace";
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#f4e6c8';
      for (const [i, digit] of ['9', '8', '7', '6', '5', '4', '3', '2', '1', '0', '9'].entries()) c.fillText(digit, 48, 96 * i + 50);
    });
    digits.repeat.set(1, 1 / 11);
    this.dialMap = digits;
    this.dialLight = new MeshBasicMaterial({ map: digits, transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending, color: 0x000000 });
    const wheel = new Mesh(new PlaneGeometry(1, 1), this.dialLight);
    wheel.frustumCulled = false;
    wheel.renderOrder = 20;
    const glowDot = canvasOf(32, 32, (c) => {
      const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, '#fff');
      g.addColorStop(0.28, '#ddd');
      g.addColorStop(0.45, '#333');
      g.addColorStop(1, '#000');
      c.fillStyle = g;
      c.fillRect(0, 0, 32, 32);
    });
    this.neon = new MeshBasicMaterial({ map: glowDot, transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending, color: 0x000000 });
    const lamp = new Mesh(new PlaneGeometry(0.42, 0.42), this.neon);
    lamp.position.set(-0.86, 0, 0);
    lamp.frustumCulled = false;
    lamp.renderOrder = 20;
    this.dial.add(wheel, lamp);
    this.lens.add(this.dial);
    this.specks = this.buildSpecks();
    this.lens.add(this.specks);

    this.beat(0, () => this.toneUp());
    this.beat(2.4, () => this.play('rooms/flash_charge.mp3', 0.14));
    this.beat(3, () => this.say({ tr: 'Işık yok. Sekiz karen var.', en: 'There is no light. You have eight frames.' }, 5));
    this.beat(4.6, () => (this.control.press = true));
    this.beat(5, () => {
      if (this.fired === 0) this.hint({ tr: 'Bas: flaş', en: 'Press: flash' });
    });
    this.beat(40, () => this.say({ tr: 'Annen seni çağırıyor. Cevap verme.', en: 'Your mother is calling you. Do not answer.' }, 5.5));
    // not words: only the shape of someone calling from the far end of a house, once the silence after a flash at 40 is over
    this.beat(41.2, () => this.loop('rooms/whisper_gabble.mp3', 0.1, 2.5, -0.2, 0.45, 900));
    this.beat(DINNER_ENDS, () => this.endDinner());
    this.beat(THEIR_CHARGE, () => this.theirCharge());
    this.beat(THEIR_HUSH, () => this.sound.stopAll(0.12));
    this.beat(THEIR_PRINT, () => this.play('rooms/polaroid_motor.mp3', 0.3, 0, 0.15));
    this.beat(80, () => this.say({ tr: 'Dokuzuncuyu sen çekmedin.', en: 'You did not take the ninth.' }, 4));
  }

  /** The walls, the floor and the ceiling; a door in every wall and the corridor of the house behind each. */
  private buildShell(): void {
    const b = this.build;
    const k = this.kit;
    const paper = b.damask(PALETTE.damaskTeal, 0.86);
    const varnish = b.wood() as MeshStandardMaterial;
    varnish.roughness = PANEL.roughness;
    varnish.color.setScalar(PANEL.shade);
    const dark = k.surface('plaster_pale', 2.2, { color: new Color(0x45453e) });
    const papered: BufferGeometry[] = [];
    const lids: BufferGeometry[] = [];
    const floors: BufferGeometry[] = [];
    const doorPaint = canvasOf(256, 584, (c) => drawDoorPaint(c, 256, 584));
    doorPaint.wrapS = doorPaint.wrapT = RepeatWrapping;
    doorPaint.repeat.set(1 / DOOR.w, 1 / DOOR.h);
    const seat = new Matrix4();
    const place = (list: BufferGeometry[], mesh: Mesh, wall: Group) => {
      mesh.updateMatrix();
      wall.updateMatrix();
      list.push(mesh.geometry.applyMatrix4(seat.multiplyMatrices(wall.matrix, mesh.matrix)));
    };
    for (const [wx, wz, turn] of [[0, -R, 0], [0, R, Math.PI], [-R, 0, Math.PI / 2], [R, 0, -Math.PI / 2]] as const) {
      const wall = new Group();
      wall.position.set(wx, 0, wz);
      wall.rotation.y = turn;
      this.stage.add(wall);
      const side = R - DOOR.w / 2;
      for (const s of [-1, 1]) {
        const x = (s * (R + DOOR.w / 2)) / 2;
        const piece = k.wall(side, H, paper, x, H / 2);
        piece.position.set(x, H / 2, 0);
        place(papered, piece, wall);
        b.wainscot(x, 0, side, '+z', wall);
      }
      const lintel = k.wall(DOOR.w, H - DOOR.h, paper, 0, (H + DOOR.h) / 2);
      lintel.position.set(0, (H + DOOR.h) / 2, 0);
      place(papered, lintel, wall);
      const door = b.door(0, 0, '+z', wall, { color: 0xffffff });
      door.beyond.removeFromParent();
      ((door.leaf.children[0] as Mesh).material as MeshStandardMaterial).map = doorPaint;
      this.leaves.push(door.leaf);
      const half = DOOR.w / 2 + 0.1;
      place(floors, k.floor(-half, half, -DOOR.beyond, 0.02, 0, b.checker(0.5)), wall);
      for (const s of [-1, 1]) {
        const w = k.wall(DOOR.beyond, DOOR.h + 0.3, paper);
        w.position.set(s * half, (DOOR.h + 0.3) / 2, -DOOR.beyond / 2);
        w.rotation.y = -s * (Math.PI / 2);
        place(papered, w, wall);
      }
      const top = k.floor(-half, half, -DOOR.beyond, 0.02, DOOR.h + 0.3, dark);
      top.rotation.x = Math.PI / 2;
      place(lids, top, wall);
      const end = k.wall(DOOR.w + 0.3, DOOR.h + 0.3, dark);
      end.position.set(0, (DOOR.h + 0.3) / 2, -DOOR.beyond);
      place(lids, end, wall);
    }
    const whole = (list: BufferGeometry[], material: Material) => {
      const mesh = new Mesh(mergeGeometries(list)!, material);
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.stage.add(mesh);
    };
    whole(papered, paper);
    whole(lids, dark);
    whole(floors, b.checker(0.5));

    this.boards = k.surface('wood_floor_dark', 2, { color: new Color(0x8c8378), roughness: BOARDS.waxed });
    this.stage.add(k.floor(-R, R, -R, R, 0, this.boards));
    const stains = canvasOf(1024, 1024, (c) => drawCeilingStains(c, 1024));
    stains.wrapS = stains.wrapT = RepeatWrapping;
    stains.repeat.setScalar(1 / (2 * R));
    stains.offset.setScalar(0.5);
    const top = k.floor(-R, R, -R, R, H, k.surface('plaster_pale', 2.2, { map: stains }));
    top.rotation.x = Math.PI / 2;
    this.stage.add(top);

    const pile = canvasOf(2048, 2048, (c) => drawRug(c, 2048));
    pile.wrapS = pile.wrapT = RepeatWrapping;
    pile.repeat.setScalar(1 / RUG);
    pile.offset.setScalar(0.5);
    const rug = k.block(RUG, 0.012, RUG, k.surface('carpet_dirty', 0.6, { map: pile, roughness: 1 }));
    rug.position.set(0, 0.006, 0);
    this.stage.add(rug);

    this.buildMouldings();
    this.buildGrime();
  }

  /** What runs round the top of the room: a picture rail, a stepped plaster cornice. */
  private buildMouldings(): void {
    const b = this.build;
    const rail: BufferGeometry[] = [];
    const cornice: BufferGeometry[] = [];
    const seat = new Matrix4();
    const y = new Vector3(0, 1, 0);
    DOOR_TURN.forEach((turn) => {
      seat.makeRotationAxis(y, turn);
      seat.setPosition(-Math.sin(turn) * R, 0, -Math.cos(turn) * R);
      rail.push(meterUVs(new BoxGeometry(2 * R, 0.05, 0.035)).translate(0, FRIEZE, 0.018).applyMatrix4(seat));
      for (const [h, d, at] of [[0.05, 0.05, 0.03], [0.05, 0.1, 0.075], [0.09, 0.15, 0.145]] as const) {
        cornice.push(meterUVs(new BoxGeometry(2 * R, h, d)).translate(0, H - at, d / 2).applyMatrix4(seat));
      }
    });
    const whole = (list: BufferGeometry[], material: Material) => {
      const mesh = new Mesh(mergeGeometries(list)!, material);
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.stage.add(mesh);
    };
    whole(rail, b.wood());
    whole(cornice, b.paint(0x45433b, 0.85));
  }

  /** What a render never has: the corners and the joints gone dark, and damp down the walls. */
  private buildGrime(): void {
    const positions: number[] = [];
    const colors: number[] = [];
    const index: number[] = [];
    const corner = (turn: number, x: number, y: number, z: number, alpha: number) => {
      const c = Math.cos(turn);
      const sn = Math.sin(turn);
      positions.push(-sn * R + x * c + z * sn, y, -c * R - x * sn + z * c);
      colors.push(0, 0, 0, alpha);
    };
    /** A strip on a wall from (x0, y0) to (x1, y1), its alpha going from a0 (along x0 or y0) to a1. */
    const strip = (turn: number, x0: number, y0: number, x1: number, y1: number, z: number, along: 'x' | 'y', a0: number, a1: number) => {
      const b = positions.length / 3;
      corner(turn, x0, y0, z, a0);
      corner(turn, x1, y0, z, along === 'x' ? a1 : a0);
      corner(turn, x1, y1, z, a1);
      corner(turn, x0, y1, z, along === 'x' ? a0 : a1);
      index.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    for (const turn of DOOR_TURN) {
      // under the cornice, and into both corners, in front of the paper and of the panelling
      strip(turn, -R, H - 0.21, R, H - 1.2, 0.007, 'y', 0.72, 0);
      for (const s of [-1, 1]) {
        strip(turn, s * R, 1.1, s * (R - 1.5), H - 0.21, 0.007, 'x', 0.8, 0);
        strip(turn, s * R, 0, s * (R - 1.5), 1.1, 0.062, 'x', 0.8, 0);
      }
      // the floor along the wall
      const b = positions.length / 3;
      corner(turn, -R, 0.005, 0, 0.7);
      corner(turn, R, 0.005, 0, 0.7);
      corner(turn, R, 0.005, 1.3, 0);
      corner(turn, -R, 0.005, 1.3, 0);
      index.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new Float32BufferAttribute(colors, 4));
    g.setIndex(index);
    const white = canvasOf(2, 2, (c) => {
      c.fillStyle = '#fff';
      c.fillRect(0, 0, 2, 2);
    });
    g.setAttribute('uv', new Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
    const dim = new Mesh(g, new MeshBasicMaterial({ map: white, vertexColors: true, transparent: true, depthWrite: false, fog: false }));
    dim.frustumCulled = false;
    dim.renderOrder = 1;
    this.stage.add(dim);

    // the long stains: [which wall, x along it, width, which of the four]
    const dampMap = canvasOf(1024, 512, (c) => drawDamp(c, 1024, 512));
    const parts: BufferGeometry[] = [];
    const seat = new Matrix4();
    const y = new Vector3(0, 1, 0);
    for (const [wall, x, width, which] of DAMP) {
      const turn = DOOR_TURN[wall];
      const q = new PlaneGeometry(width, H - 1.25);
      const uv = q.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setX(i, (which + uv.getX(i)) / 4);
      seat.makeRotationAxis(y, turn);
      seat.setPosition(-Math.sin(turn) * R, 0, -Math.cos(turn) * R);
      q.translate(x, (H + 1.2) / 2 - 0.16, 0.009);
      parts.push(q.applyMatrix4(seat));
    }
    const damp = new Mesh(mergeGeometries(parts)!, new MeshBasicMaterial({ map: dampMap, transparent: true, depthWrite: false, color: 0xffffff }));
    damp.frustumCulled = false;
    damp.renderOrder = 1;
    this.stage.add(damp);
  }

  /** Furniture under a sheet. */
  private cloth(key: string, x: number, z: number, heading: number, spread: number, material: Material = this.linen): Object3D {
    const o = this.kit.prop(key, [x, 0, z], { rotation: [0, heading, 0], castShadow: true }, this.stage);
    o.traverse((part) => {
      const mesh = part as Mesh;
      if (!mesh.isMesh) return;
      stainCloth(mesh);
      mesh.material = material;
    });
    this.build.contactShadow(0, 0, spread, o, 0.72, ON_RUG);
    return o;
  }

  /** Furniture as it is; `shade` darkens what the file paints too bright for this room. */
  private solid(key: string, x: number, z: number, heading: number, spread: number, shade = 1, material?: Material): Object3D {
    const o = this.kit.prop(key, [x, 0, z], { rotation: [0, heading, 0], castShadow: true }, this.stage);
    if (shade !== 1) this.darken(o, shade);
    if (material) this.kit.paint(o, material);
    this.build.contactShadow(0, 0, spread, o, 0.72, ON_RUG);
    return o;
  }

  private darken(o: Object3D, shade: number): void {
    o.traverse((part) => {
      const mesh = part as Mesh;
      if (!mesh.isMesh) return;
      const m = (mesh.material as MeshStandardMaterial).clone();
      m.color.multiplyScalar(shade);
      mesh.material = m;
    });
  }

  /** Everything else in the room; every piece of it can be in the way, and goes when it is. */
  private dress(): void {
    const k = this.kit;
    const piece = (o: Object3D, x: number, z: number, r: number) => this.solids.push({ object: o, x, z, r });
    piece(this.cloth('sheet_lamp', 3.7, -4.85, 0, 0.9), 3.7, -4.85, 0.8);
    this.standing = this.solid('lamp_floor', 2.25, -5.0, 0, 0.42, 0.5);
    piece(this.standing, 2.25, -5, 0.4);
    piece(this.cloth('sheet_sofa', -4.5, -1.2, 90, 2.2), -4.5, -1.2, 1.7);
    piece(this.cloth('sheet_table', 4.5, -1.6, 90, 1.7), 4.5, -1.6, 1.35);
    piece(this.solid('sideboard', -3.1, 5.25, 180, 1.4), -3.1, 5.25, 1.2);
    piece(this.cloth('sheet_armchair', 3.5, 4.3, 205, 1.35), 3.5, 4.3, 1);
    piece(this.cloth('sheet_sofa', 4.55, 1.9, -90, 2.2), 4.55, 1.9, 1.7);
    piece(this.cloth('sheet_chair', -4.7, 3.1, 80, 0.95), -4.7, 3.1, 0.65);
    piece(this.cloth('sheet_chair', -4.65, 1.7, 100, 0.95), -4.65, 1.7, 0.65);

    const clock = k.prop('wall_clock', [0, 2.62, -R + 0.03], { scale: 1.5 }, this.stage);
    const panes: Object3D[] = [];
    clock.traverse((part) => {
      const mesh = part as Mesh;
      if (mesh.isMesh && /glass/.test((mesh.material as Material).name)) panes.push(mesh);
    });
    for (const pane of panes) pane.removeFromParent();
    this.darken(clock, 0.3);
    setClock(rigClock(clock.children[0]), 18.5 * 3600);

    this.clock = clock;
    const pendant = k.prop('lamp_pendant', [0, H, -0.7], { anchor: 'top', castShadow: true }, this.stage);
    this.darken(pendant, 0.7);

    // both side walls have two windows, shut and curtained: black glass that only ever holds the flash
    const black = new MeshStandardMaterial({ color: 0x020304, roughness: 0.07, metalness: 0.2 });
    const velvet = k.surface('velvet_red', 0.3, { color: new Color(0x6a4a46), roughness: 0.9 });
    for (const side of [-1, 1]) {
      for (const z of [-3.35, 3.35]) {
        const turn = (side * -Math.PI) / 2;
        const glass = new Mesh(new PlaneGeometry(1.96, 1.42), black);
        glass.position.set(side * (R - 0.014), 1.86, z);
        glass.rotation.y = turn;
        glass.receiveShadow = false;
        glass.frustumCulled = false;
        this.stage.add(glass);
        k.prop('window_wood', [side * (R - 0.09), 1.11, z], { rotation: [0, (side * -90), 0] }, this.stage);
        k.paint(k.prop('curtains', [side * (R - 0.2), 0.32, z], { rotation: [0, (side * -90), 0], castShadow: true }, this.stage), velvet);
      }
    }

    // the viewer's own pictures, as in the corridor: this is the same house
    this.album.pictures.slice(0, PRINTS.length).forEach((picture, i) => {
      const [wall, x, y] = PRINTS[i];
      const print = this.build.print(this.album.texture(picture));
      const turn = DOOR_TURN[wall];
      print.position.set(-Math.sin(turn) * (R - 0.012) + x * Math.cos(turn), y, -Math.cos(turn) * (R - 0.012) - x * Math.sin(turn));
      print.rotation.y = turn;
      print.rotation.z = ((i * 17) % 7) * 0.008 - 0.024;
      print.traverse((part) => (part.receiveShadow = true));
      this.stage.add(print);
    });
  }

  /** One person: a body frozen in a pose, its head bowed by `bow` rad, and hair of its own, standing at the origin. `head` is the middle of the head. */
  private person(spec: FigureSpec, seed: number, hairs: Partial<HairSpec> = {}): { body: Group; crowd: Crowd; head: Vector3 } {
    const body = new Group();
    const crowd = this.kit.figures.crowd(spec, 1);
    crowd.set(0, 0, 0, 0, 0);
    crowd.commit();
    body.add(crowd.root);
    const hero = this.kit.figures.hero(spec);
    hero.update(spec.time ?? 0);
    hero.root.updateMatrixWorld(true);
    const neck = hero.bone('Bip01_Head')!.getWorldPosition(new Vector3());
    const hips = hero.bone('Bip01')!.getWorldPosition(new Vector3());
    neck.x -= hips.x;
    neck.z -= hips.z;
    const bow = hairs.bow ?? HAIR.bow;
    if (bow !== 0) {
      crowd.root.traverse((part) => {
        const mesh = part as InstancedMesh;
        if (!mesh.isMesh) return;
        mesh.geometry = bowed(mesh.geometry, neck, bow);
        mesh.userData.shared = false;
      });
    }
    const head = new Vector3(neck.x, neck.y + HAIR.lift * Math.cos(bow) - 0.012 * Math.sin(bow), neck.z + HAIR.lift * Math.sin(bow) + 0.012 * Math.cos(bow));
    const hair = new Mesh(hairCurtain({ ...HAIR, seed, ...hairs }), this.hairLit);
    hair.position.copy(head);
    hair.frustumCulled = false;
    hair.castShadow = true;
    hair.receiveShadow = false;
    body.add(hair);
    return { body, crowd, head };
  }

  /** The people of the house: who stands in the door, the three halfway, the row, the one a hand away. */
  private buildPeople(): void {
    const suit = 0x3c4148;
    const dress = 0x34363a;
    const man = { avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 0.2, face: 'scratched', tint: suit, bleach: 0.55 } as const;
    const woman = { avatar: 'figure_woman', clip: 'm_idle_roll_head_01', time: 0.2, face: 'scratched', tint: dress, bleach: 0.55 } as const;
    const other = { avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 1.1, face: 'scratched', tint: 0x383c40, bleach: 0.7 } as const;
    this.atDoor.add(this.person(woman, 11, FAR_HAIR).body);

    const walkers: readonly [FigureSpec, number][] = [
      [{ ...man, clip: 'm_walk_bruised', time: 0.55 }, 0.1],
      [{ ...woman, clip: 'f_walk_injured', time: 0.35 }, -0.05],
      [{ ...other, clip: 'm_walk_bruised', time: 1.8 }, -0.14],
    ];
    walkers.forEach(([spec, heading], i) => {
      const p = this.person(spec, 21 + i, FAR_HAIR);
      p.body.position.set(THREE[i][0], 0, THREE[i][1]);
      p.body.rotation.y = heading;
      this.trio.add(p.body);
    });

    const standing: readonly [FigureSpec, number, number][] = [
      [man, -0.62, -0.98],
      [woman, 0.0, -1.06],
      [other, 0.62, -0.96],
    ];
    standing.forEach(([spec, x, z], i) => {
      // close to, there is a slit in the hair and something pale behind it
      const p = this.person(spec, 31 + i, { strands: 2200, width: 0.00034, segments: 10, taper: 0.75, length: 0.72, part: 0.2, fringe: 300, strays: 12 });
      p.body.position.set(x, 0, z);
      this.row.add(p.body);
    });

    // a hand away
    const close = this.person(woman, 41, { bow: 0, part: 0.84, strands: 2600, width: 0.00018, segments: 24, taper: 0.75, fringe: 1200, strays: 30, length: 0.9 });
    const own = this.kit.assets.models.get('figure_woman')!;
    close.crowd.root.traverse((part) => {
      const mesh = part as InstancedMesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as MeshStandardMaterial;
      if (!/head/.test(material.name)) return;
      own.scene.traverse((o) => {
        const source = (o as Mesh).material as MeshStandardMaterial | undefined;
        if (!source?.map || !/head/.test(source.name) || mesh.material !== material) return;
        const face = material.clone();
        face.map = scratchedFace(source.map);
        mesh.material = face;
      });
    });
    close.body.position.set(-close.head.x, -close.head.y + FACE_LIFT, -FACE_AT - close.head.z);
    this.gazeRig.add(close.body);
  }

  /** What was under all the sheets. */
  private buildTable(): void {
    const k = this.kit;
    const board = k.prop('dining_table', [0, 0, TABLE_Z], { castShadow: true }, this.table);
    this.darken(board, TABLE_SHADE);
    // its legs, pale pine in the file, burn orange in a flash
    board.traverse((part) => {
      if ((part as Mesh).isMesh && part.name === 'dining_table') this.darken(part, LEG_SHADE);
    });
    const chairs = k.props('chair_ladder', 4, { castShadow: true });
    chairs.set(0, 0, 0, CHAIR_Z, 0);
    chairs.set(1, -1.42, 0, TABLE_Z, Math.PI / 2);
    chairs.set(2, 1.42, 0, TABLE_Z, -Math.PI / 2);
    chairs.set(3, 0, 0, TABLE_Z - 0.92, 0);
    chairs.commit();
    k.paint(chairs.root, this.chairWood);
    this.table.add(chairs.root);
    const top = 0.877;
    const plates = k.props('plate', 4);
    const forks = k.props('fork', 4, { rotation: [90, 0, 0] });
    const knives = k.props('knife', 4, { rotation: [90, 0, 0] });
    const glasses = k.props('tumbler', 4);
    const seats = [[0, TABLE_Z + 0.46, 0], [-0.84, TABLE_Z, Math.PI / 2], [0.84, TABLE_Z, -Math.PI / 2], [0, TABLE_Z - 0.46, Math.PI]] as const;
    seats.forEach(([x, z, h], i) => {
      plates.set(i, x, top, z, h);
      const c = Math.cos(h);
      const s = Math.sin(h);
      forks.set(i, x - 0.17 * c, top, z + 0.17 * s, h);
      knives.set(i, x + 0.17 * c, top, z - 0.17 * s, h);
      glasses.set(i, x + 0.16 * c - 0.2 * s, top, z - 0.16 * s - 0.2 * c, 0);
    });
    for (const crowd of [plates, forks, knives, glasses]) {
      crowd.commit();
      this.table.add(crowd.root);
    }
    k.prop('bread_half', [-0.28, top, TABLE_Z - 0.04], { rotation: [0, 30, 0], castShadow: true }, this.table);
    k.prop('pot_enamel', [0.26, top, TABLE_Z + 0.02], { castShadow: true }, this.table);
    this.build.contactShadow(0, TABLE_Z, 1.9, this.table, 0.72, ON_RUG);
    this.build.contactShadow(0, CHAIR_Z, 0.5, this.table, 0.72, ON_RUG);
  }

  /** Those who cast the ninth's shadows: never seen themselves, only on the far wall. */
  private buildBehind(): void {
    const hide = (o: Object3D) => {
      o.traverse((part) => {
        const mesh = part as Mesh;
        if (!mesh.isMesh) return;
        const m = (mesh.material as Material).clone();
        m.colorWrite = false;
        m.depthWrite = false;
        mesh.material = m;
        mesh.castShadow = true;
      });
      this.behind.add(o);
    };
    const crowdOf = (spec: FigureSpec, people: readonly (readonly [number, number, number, number])[], bow = BEHIND_BOW) => {
      const crowd = this.kit.figures.crowd(spec, people.length);
      people.forEach(([x, z, h, size], i) => crowd.set(i, x, 0, z, h + Math.PI, size));
      crowd.commit();
      if (bow !== 0) {
        const hero = this.kit.figures.hero(spec);
        hero.update(spec.time ?? 0);
        hero.root.updateMatrixWorld(true);
        const neck = hero.bone('Bip01_Head')!.getWorldPosition(new Vector3());
        const hips = hero.bone('Bip01')!.getWorldPosition(new Vector3());
        neck.x -= hips.x;
        neck.z -= hips.z;
        crowd.root.traverse((part) => {
          const mesh = part as InstancedMesh;
          if (!mesh.isMesh) return;
          mesh.geometry = bowed(mesh.geometry, neck, bow);
          mesh.userData.shared = false;
        });
      }
      hide(crowd.root);
    };
    crowdOf({ avatar: 'figure_man', clip: 'm_idle_touch_face_01', time: YOU_POSE, face: 'blank' }, [[0, 0.22, 0, 1]], 0);
    crowdOf({ avatar: 'figure_man', clip: 'm_knock_door', time: REACHING.time, face: 'blank' }, [[REACHING.x, REACHING.z, -Math.PI / 2, 1.02]], BEHIND_BOW / 2);
    crowdOf({ avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 0.2, face: 'blank' }, BEHIND_MEN);
    crowdOf({ avatar: 'figure_woman', clip: 'm_idle_roll_head_01', time: 0.2, face: 'blank', veil: true }, BEHIND_WOMEN);
    const headless = this.build.headless(BEHIND_HEADLESS.length);
    BEHIND_HEADLESS.forEach(([x, z, h, size], i) => headless.set(i, x, 0, z, h + Math.PI, size));
    headless.commit();
    hide(headless.root);
    const [nx, nz] = BEHIND_HEADLESS[0];
    // it goes on up the wall and over the ceiling, and where it ends is not to be seen
    hide(this.build.neck([[nx, 1.46, nz], [nx + 0.07, 1.58, nz], [nx - 0.06, 1.72, nz], [nx + 0.08, 1.88, nz], [nx + 0.02, 2.2, nz], [nx + 0.14, 3.4, nz]], new Group(), { radius: 0.034, taper: 1, sway: 0 }).mesh);
  }

  /** Dust right before the lens that only the flash ever shows: soft pale rounds, as in any flash picture of a dusty room. */
  private buildSpecks(): Mesh {
    const random = randomFrom(97);
    const positions: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const index: number[] = [];
    for (let i = 0; i < SPECKS.count; i++) {
      const d = 0.22 + random() * 1.4;
      const x = (random() * 2 - 1) * d * 0.95;
      const y = (random() * 2 - 1) * d * 0.55;
      const q = d * (0.012 + random() * random() * 0.06);
      const v = 0.05 + random() * random() * 0.3;
      const b = positions.length / 3;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        positions.push(x + sx * q, y + sy * q, -d);
        uvs.push((sx + 1) / 2, (sy + 1) / 2);
        colors.push(v, v * 0.97, v * 0.9, 1);
      }
      index.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new Float32BufferAttribute(colors, 4));
    g.setIndex(index);
    const round = canvasOf(64, 64, (c) => {
      const r = c.createRadialGradient(32, 32, 0, 32, 32, 31);
      r.addColorStop(0, '#5c5c5c');
      r.addColorStop(0.75, '#6a6a6a');
      r.addColorStop(0.92, '#7e7e7e');
      r.addColorStop(1, '#000');
      c.fillStyle = r;
      c.fillRect(0, 0, 64, 64);
    });
    const mesh = new Mesh(g, new MeshBasicMaterial({ map: round, vertexColors: true, transparent: true, depthWrite: false, fog: false, blending: AdditiveBlending, opacity: 0 }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    return mesh;
  }

  /** A file once. */
  private play(file: string, gain: number, pan = 0, reverb = 0, lowpass = 0, rate = 1, offset = 0): void {
    const v = this.voice;
    v.gain = gain;
    v.pan = pan;
    v.reverb = reverb;
    v.lowpass = lowpass;
    v.rate = rate;
    v.offset = offset;
    v.fade = 0;
    this.sound.play(file, v);
  }

  /** A file looping, from wherever it happens to be. */
  private loop(file: string, gain: number, fade: number, pan = 0, reverb = 0, lowpass = 0): void {
    const v = this.voice;
    v.gain = gain;
    v.pan = pan;
    v.reverb = reverb;
    v.lowpass = lowpass;
    v.rate = 1;
    v.offset = undefined;
    v.fade = fade;
    this.sound.bed(file, v);
  }

  /** The room's tone comes back after a silence; the later, the more of it, and the more wrong. */
  private toneUp(): void {
    if (this.toneOn || this.ninthDone) return;
    this.toneOn = true;
    const shot = this.fired;
    this.loop('rooms/house_tone.mp3', 0.16 + shot * 0.012, TONE_FADE);
    if (shot >= 2) this.loop('rooms/dream_drone_low.mp3', 0.05 + shot * 0.012, TONE_FADE);
    if (shot >= 5 && shot < 8) this.loop('rooms/dream_drone_glass.mp3', 0.035, TONE_FADE);
    // someone stands by you from the worst one on, and is still there after each flash
    if (shot >= 5 && shot < 7) this.loop('rooms/breath_beside.mp3', 0.1 + (shot - 5) * 0.09, TONE_FADE + 2, shot === 5 ? -0.9 : 0.9);
    if (shot === 8) this.loop('rooms/breath_other.mp3', 0.14, 7, 0.9);
  }

  /** All of it stops at once: the forks too. */
  private endDinner(): void {
    if (!this.dinnerOn) return;
    this.dinnerOn = false;
    this.sound.stopAll(0.06);
    this.play('rooms/fork_down_1.mp3', 0.3, 0, 0.25, 1600);
  }

  /** The whine they know, but this one is not theirs: their lamp is dark, and it does not stop where it stopped. */
  private theirCharge(): void {
    this.sound.stopAll(0.2);
    this.toneOn = true;
    this.play('rooms/flash_charge_long.mp3', 0.12, 0, 0.2, 7000);
  }

  /** A sound from a place in the room: its side goes by where the viewer is looking now. */
  private heard(c: Cue, frame: RoomFrame): void {
    const dx = c.x - frame.eye.x;
    const dz = c.z - frame.eye.z;
    const off = Math.atan2(-dx, -dz) - this.gazeOf(frame.view);
    this.play(c.file, c.gain, clamp(-Math.sin(off) * Math.min(1, Math.hypot(dx, dz) / 1.2), -0.92, 0.92), c.reverb ?? 0, c.far ? 2100 : 0);
  }

  /** Where the eye turned, as a heading about Y. */
  private gazeOf(view: PerspectiveCamera): number {
    const m = view.matrixWorld.elements;
    return Math.atan2(m[8], m[10]);
  }

  /** The flash goes off from here, this way. */
  private aim(view: PerspectiveCamera, shot: number): void {
    const look = SHOTS[shot];
    const m = view.matrixWorld.elements;
    const e = view.position;
    const flat = shot === 0;
    // the ninth stands on the floor behind you; the rest go with the lens
    const fx = flat ? -Math.sin(this.gazeOf(view)) : -m[8];
    const fy = flat ? 0 : -m[9];
    const fz = flat ? -Math.cos(this.gazeOf(view)) : -m[10];
    const ux = flat ? 0 : m[4];
    const uy = flat ? 1 : m[5];
    const uz = flat ? 0 : m[6];
    const rx = flat ? -fz : m[0];
    const ry = flat ? 0 : m[1];
    const rz = flat ? fx : m[2];
    this.gunAt[0] = e.x + rx * look.right + ux * look.up - fx * look.back;
    this.gunAt[1] = e.y + ry * look.right + uy * look.up - fy * look.back;
    this.gunAt[2] = e.z + rz * look.right + uz * look.up - fz * look.back;
    this.gunTo[0] = e.x + fx * 6 - ux * look.low;
    this.gunTo[1] = e.y + fy * 6 - uy * look.low;
    this.gunTo[2] = e.z + fz * 6 - uz * look.low;
    // the gun of the ninth stands too low to light a table top: a pool straight down on it, that no wall can see
    this.fillAt[0] = flat ? e.x - fx * TABLE_Z : e.x - fx * 7;
    this.fillAt[1] = flat ? H - 0.1 : e.y - fy * 7 + 0.5;
    this.fillAt[2] = flat ? e.z - fz * TABLE_Z : e.z - fz * 7;
    this.fillTo[0] = e.x - fx * TABLE_Z;
    this.fillTo[1] = flat ? 0 : e.y + fy * 4;
    this.fillTo[2] = e.z - fz * TABLE_Z;
    this.fillLight.angle = flat ? 19 : 40;
    this.gun.angle = look.angle;
    this.hairLit.emissiveIntensity = look.emissive;
    this.hairLit.color.setScalar(look.hair);
  }

  /** The room as this shot finds it. */
  private arrange(shot: number, frame: RoomFrame): void {
    const yaw = this.gazeOf(frame.view);
    const e = frame.eye;
    this.actors.position.set(e.x, 0, e.z);
    // the table is where you look, unless you look where it stood all along
    this.actors.rotation.y = shot >= 8 && Math.abs(yaw) < 0.45 ? 0 : yaw;
    this.chairSheet.visible = shot === 1;
    this.chairBare.visible = shot >= 2 && shot <= 7;
    // nothing has happened, but this
    this.chairBare.position.z = shot === 5 ? CHAIR_Z + CHAIR_CREPT : CHAIR_Z;
    this.lowSheet.visible = shot === 1;
    this.tallSheet.visible = shot === 2;
    this.bareChair.visible = shot >= 3 && shot <= 7;
    this.atDoor.visible = shot === 3;
    this.trio.visible = shot === 4;
    this.row.visible = shot === 6;
    this.gazeRig.visible = shot === 7;
    this.table.visible = shot >= 8 || shot === 0;
    // it would stand on the head of the one in the middle
    this.clock.visible = shot !== 6 && shot !== 7;
    this.behind.visible = shot === 0;
    if (shot === 7) {
      this.gazeRig.position.y = e.y;
      this.gazeRig.rotation.x = Math.asin(clamp(-frame.view.matrixWorld.elements[9], -1, 1));
    }
    if (shot === 3) {
      const door = this.nearestDoor(yaw);
      for (let i = 0; i < 4; i++) this.leaves[i].rotation.y = i === door ? DOOR.open : 0;
      const turn = DOOR_TURN[door];
      this.atDoor.position.set(-Math.sin(turn) * (R - 0.42), 0, -Math.cos(turn) * (R - 0.42));
      this.atDoor.rotation.y = turn;
    }
    if (shot >= 8 || shot === 0) for (const leaf of this.leaves) leaf.rotation.y = 0;
    // the three come from where you look: what stands in the way is not there
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    for (const s of this.solids) {
      let free = shot < 8 && shot > 0;
      if (free && shot === 4) {
        for (const [x, z] of THREE) {
          if (Math.hypot(e.x + x * c + z * sn - s.x, e.z - x * sn + z * c - s.z) < s.r + 0.4) free = false;
        }
      }
      s.object.visible = free;
    }
    // from here it would be in the hand of the one on the right
    if (shot === 4) this.standing.visible = false;
  }

  private nearestDoor(yaw: number): number {
    let best = 0;
    let closest = Infinity;
    for (let i = 0; i < 4; i++) {
      const off = Math.abs(Math.atan2(Math.sin(yaw - DOOR_TURN[i]), Math.cos(yaw - DOOR_TURN[i])));
      if (off < closest) {
        closest = off;
        best = i;
      }
    }
    return best;
  }

  /** The pop: and after it nothing at all, for a moment, but the whine of the charging. */
  private fire(shot: number, frame: RoomFrame): void {
    this.fired = shot;
    this.since = 0;
    this.charge = RECHARGE[shot - 1];
    this.cue = 0;
    this.aim(frame.view, shot);
    this.arrange(shot, frame);
    this.movingShadows = true;
    this.hint(null);
    this.toneOn = false;
    this.hushed = false;
    this.dinnerOn = false;
    this.sound.stopAll(0.05);
    this.play(POPS[shot % POPS.length], 0.6);
    this.fear = FEAR[shot];
    if (shot === 7) this.shutterDue = true;
    this.whineDue = shot < 8;
  }

  /** Not yours. */
  private fireNinth(frame: RoomFrame): void {
    this.ninthDone = true;
    this.since = 0;
    this.boards.roughness = BOARDS.ninth;
    for (const leaf of this.leaves) ((leaf.children[0] as Mesh).material as MeshStandardMaterial).color.setScalar(DOOR_NINTH);
    this.aim(frame.view, 0);
    this.arrange(0, frame);
    this.movingShadows = true;
    this.toneOn = false;
    this.fear = FEAR[0];
    this.sound.stopAll(0.03);
    this.play('rooms/flash_powder.mp3', 0.6, 0, 0.3);
  }

  /** The counter sits in the corner whatever the shape of the screen. */
  prepare(camera: PerspectiveCamera): void {
    const h = 2 * DIAL.depth * Math.tan((camera.fov * Math.PI) / 360);
    const size = h * DIAL.size;
    this.dial.scale.setScalar(size);
    this.dial.position.set(camera.aspect * h * 0.5 - h * DIAL.margin, -h * 0.5 + h * DIAL.margin + size * 0.2, -DIAL.depth);
  }

  update(frame: RoomFrame): void {
    if (frame.paused) return;
    const dt = frame.dt;
    const seconds = frame.seconds;
    this.mote.value = frame.time;
    this.movingShadows = false;
    this.black = seconds >= CUT ? 1 : 0;
    this.since += dt;
    this.charge = Math.max(0, this.charge - dt);

    // what the viewer does, and what happens if they do not
    const input = frame.input;
    if (input.pressed && this.control.press) {
      if (this.fired >= 8) this.play('rooms/camera_click_empty.mp3', 0.4);
      else if (this.charge <= 0) this.fire(this.fired + 1, frame);
    }
    let due = 0;
    while (due < FALLBACK.length && FALLBACK[due] <= seconds) due++;
    if (due > this.fired) this.fire(due, frame);
    if (!this.ninthDone && seconds >= NINTH) this.fireNinth(frame);

    // the picture
    const shot = this.ninthDone ? 0 : this.fired;
    const look = SHOTS[shot];
    const lit = shot === 0 && !this.ninthDone ? 0 : this.since < LIT_HOLD ? 1 : 1 - clamp((this.since - LIT_HOLD) / LIT_FALL, 0, 1);
    this.gun.intensity = look.gun * lit;
    this.fillLight.intensity = look.fill * lit;
    this.stage.visible = lit > 0;
    this.white = (REDUCED_MOTION ? 0.3 : 1) * look.white * Math.max(0, 1 - this.since / WHITE_FALL) ** 2;
    if (this.shutterDue && this.since >= WHITE_FALL) {
      this.shutterDue = false;
      this.shutter();
    }
    this.specks.visible = lit > 0 && !this.ninthDone;
    if (lit > 0) {
      (this.specks.material as MeshBasicMaterial).opacity = SPECKS.strength * lit;
      this.specks.rotation.z = shot * 2.4;
    }
    // while there is no picture to keep there is no afterimage: it would smear the counter; and a new flash wipes the eye clean of the last one
    const hold = this.ninthDone ? 2 : 1;
    this.film.ghost = this.since === 0 || (shot === 0 && !this.ninthDone) ? 0 : look.ghost * (1 - smootherstep(range(LET_GO[0] * hold, LET_GO[1] * hold, this.since)));
    const picture = this.since === Infinity ? 0 : 1 - smootherstep(range(2.6, 5, this.since));
    this.air.envIntensity = this.ninthDone ? IN_THE_SHADOWS : AIR;
    this.film.grain = 0.28 * picture;
    this.film.scratches = 0.12 * picture;
    const cooling = smootherstep(range(0.4, 2.6, this.since));
    this.air.grade.warmth = -0.1 * cooling;
    this.air.grade.tint = -0.02 + 0.14 * cooling;

    // the camera's own small lights
    if (this.since >= DIAL.tick) {
      const steps = this.ninthDone ? 10 : 1 + this.fired;
      this.wheel += (steps - this.wheel) * (1 - Math.exp(-DIAL.rate * dt));
    }
    this.dialMap.offset.y = 1 - (this.wheel + 1) / 11;
    let open = 1;
    for (let i = 0; i < COVERED.length; i++) {
      const c = COVERED[i];
      if (c[0] === this.fired && !this.ninthDone) open = Math.min(open, 1 - smootherstep(range(c[1], c[1] + 0.12, this.since)) * (1 - smootherstep(range(c[2] - 0.2, c[2], this.since))));
    }
    const glow = open * DIAL.glow * smootherstep(range(0.3, 2.2, seconds)) * (this.since === Infinity ? 1 : smootherstep(range(DIAL.back[0], DIAL.back[1], this.since)));
    this.dialLight.color.setRGB(glow, glow * 0.86, glow * 0.62);
    const armed = seconds >= 5 && this.fired < 8 && !this.ninthDone;
    const neon = open * (!armed ? 0 : this.charge <= 0 ? NEON.ready : NEON.charging * (1 - this.charge / Math.max(RECHARGE[Math.max(0, this.fired - 1)], 0.1)));
    this.neon.color.setRGB(neon, neon * 0.3, neon * 0.06);

    // what is heard between the shots
    if (this.whineDue && this.since >= WHINE_AFTER) {
      this.whineDue = false;
      // the battery is dying: the last ones take longer, and the whine has dropped with it
      const whole = RECHARGE[this.fired - 1];
      if (whole > 4) this.play('rooms/flash_charge_long.mp3', 0.1, 0, 0, 0, 1, WHINE_AFTER);
      else this.play('rooms/flash_charge.mp3', 0.14, 0, 0, 0, 2.6 / whole, (WHINE_AFTER * 2.6) / whole);
    }
    if (!this.ninthDone) {
      if (!this.toneOn && this.since > TONE_BACK) this.toneUp();
      const row = BETWEEN[this.fired];
      const clockOf = this.fired === 0 ? seconds : this.since;
      while (this.cue < row.length && row[this.cue].at <= clockOf) {
        if (seconds < DINNER_ENDS || this.fired < 8) this.heard(row[this.cue], frame);
        this.cue++;
      }
      // the last frame spent early, and time left: someone has started on the dinner
      if (this.fired === 8 && !this.dinnerOn && this.since > DINNER_FROM && seconds < DINNER_ENDS - 6) {
        this.dinnerOn = true;
        this.loop('rooms/cutlery_far.mp3', 0.13, 5, 0, 0.35, 1000);
      }
      // silence the instant before one that fires by itself
      if (this.fired < 8 && !this.hushed && FALLBACK[this.fired] - seconds < HUSH && FALLBACK[this.fired] - seconds > 0) {
        this.hushed = true;
        this.sound.stopAll(0.5);
      }
    }
  }
}
