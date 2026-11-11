import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Material,
  Object3D,
  type PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import { REDUCED_MOTION } from '../../../config/experience.config';
import { clamp, DEG, lerp, range, smootherstep, wobble } from '../../math';
import type { DreamKit } from '../../dream/DreamKit';
import { GlideTrack } from '../../timeline/Track';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey, RoomPose } from '../Room';
import { Room } from '../Room';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['mri_head', 'syringe', 'dental_mirror', 'scalpel', 'tweezers', 'pliers', 'dental_drill', 'molar', 'xray_light'],
  materials: ['tile_white', 'tile_hospital_broken', 'flesh_smeared'],
  sounds: [
    'rooms/dental_room_tone.mp3',
    'rooms/bulb_hum.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/dream_drone_glass.mp3',
    'rooms/breath_calm.mp3',
    'rooms/breath_in.mp3',
    'rooms/heart_beat.mp3',
    'rooms/chair_motor.mp3',
    'rooms/gloves_on.mp3',
    'rooms/glove_snap.mp3',
    'rooms/suction_air.mp3',
    'rooms/suction_gulp.mp3',
    'rooms/suction_loud.mp3',
    'rooms/suction_patient.mp3',
    'rooms/tray_slide.mp3',
    'rooms/tray_metal_1.mp3',
    'rooms/tray_metal_3.mp3',
    'rooms/tray_metal_4.mp3',
    'rooms/syringe_flick.mp3',
    'rooms/needle_skin.mp3',
    'rooms/numb_jolt.mp3',
    'rooms/drill_low.mp3',
    'rooms/drill_start.mp3',
    'rooms/drill_high.mp3',
    'rooms/drill_bite.mp3',
    'rooms/drill_stabs.mp3',
    'rooms/drill_spool_down.mp3',
    'rooms/spray_hiss.mp3',
    'rooms/mouth_wet_1.mp3',
    'rooms/mouth_wet_3.mp3',
    'rooms/mouth_wet_5.mp3',
    'rooms/tooth_tap_1.mp3',
    'rooms/tooth_tap_2.mp3',
    'rooms/tooth_tap_3.mp3',
    'rooms/tooth_pull.mp3',
    'rooms/bone_crack_2.mp3',
    'rooms/hair_pull_wet.mp3',
    'rooms/hair_pull_1.mp3',
    'rooms/hair_pull_2.mp3',
    'rooms/machine_breathing.mp3',
  ],
};

type V3 = readonly [number, number, number];
type Rgb = readonly [number, number, number];

/** The script: seconds into the room. */
const LINE_OPEN = 2;
const NURSE_ON: readonly [number, number] = [3.4, 6.2];
const SUCTION_ON: readonly [number, number] = [8, 14.8];
const EARLY_BLINK = 11.3;
const TRAY_IN = 15;
const TRAY_TIME = 1.3;
const HAND_COMES = 16.3;
const SYRINGE_TAKEN = 17.1;
const SHOWN = 18.4;
const NEEDLE_DOWN = 19.6;
const NEEDLE_AT = 24;
const NEEDLE_AWAY = 27;
const DROP_FALLS = 26.75;
const JOLT = 28;
const BLINK_SHUT = 30.5;
const CUT = 31.8;
const BLINK_OPEN = 32.3;
const DRILL_ENTERS = 37;
const DRILL_BITES = 40;
const DRILL_LEAVES = 46.4;
const FORCEPS_IN = 47.7;
const FORCEPS_GRIP = 48.9;
const CRACK = 52.6;
const HANDS_HAUL = 53.3;
const SHUTTER = 55.3;
const LEANS = 55.7;
const LEANED = 56.9;
const MASK_FROM = 56.7;
const MASK_TO = 57.95;
const LINE_ONE_MORE = 58;
const THE_CUT = 64;

/** The tiled well: half its width, the height of its rim and of the pale glass over it (m). */
const HALF = 1.3;
const RIM = 4;
const SKY = 8;
/** Where the tile changes to the ruined tile, and the dark band between them (m). */
const BAND_Y = 2.95;
const BAND_H = 0.12;
/** One repeat of the tile surfaces (m), and their colors. */
const TILE = 1.8;
const SAGE = 0x8ea592;
const SAGE_OLD = 0x6a7e70;
/** Those who look down from the rim: how many from the start, how many join at each blink, how far they lean (rad). */
const WATCHERS = 15;
const WATCHERS_LATE = 10;
const WATCH_LEAN = 0.24;

/** The eye in the chair and in the mouth (m). */
const EYE_CHAIR: V3 = [0, 1.05, 0];
const EYE_MOUTH: V3 = [0, 0.98, -0.08];
/** The eye's turn at the needle (deg) and its lens. */
const HOLD_YAW = 7;
const HOLD_PITCH = 79;
const HOLD_ROLL = 1.5;
const HOLD_FOV = 44;
/** How far the viewer's drag can move the held head (rad). */
const LOOK_LIMIT = 7 * DEG;
/** The tremor of the drill: rad of the picture, and m of the teeth. */
const TREMOR = 0.0021;
const TREMOR_NEAR = 0.0006;

/** The lamp: its place, the radius of its dome (m), how far past white its lenses burn. */
const LAMP: V3 = [0.03, 2, 0.02];
const LAMP_R = 0.19;
const LAMP_POWER = 9;

/** The glass tray: height, x of its center when parked and when in, its size (m), its light. */
const PANE_Y = 1.52;
const TRAY_PARKED = 0.66;
const TRAY_HOME = 0.29;
const PANE_W = 0.47;
const PANE_D = 0.27;
const PANE_LOW = 0.07;
const PANE_CORE = 0.85;
const PANE_CORE_R = 0.16;
/** The syringe: its size, where it lies on the tray, how far from the eye the needle stops (m). */
const SYRINGE_SCALE = 1.35;
const SYRINGE_X = 0.05;
const SYRINGE_TIP_Z = -0.135;
const NEEDLE_GAP = 0.072;
const NEEDLE_LEN = 0.125;

/** The two heads (m tall, as scans); the lift of cap and mask over the skin (m). */
const HEAD_H = 0.25;
const CAP_LIFT = 0.006;
/** The head mirror, worn on the forehead as doctors wore it: where it sits (deg round and up the head), how far out it stands, its radius (m). */
const MIRROR_EYE = 15;
const MIRROR_UP = 42;
const MIRROR_OUT = 0.022;
const MIRROR_R = 0.036;
const MASK_LIFT = 0.0105;
const MASK_UNDER = 0.0062;
/** How far the outer mask folds down (rad). */
const MASK_FOLD = 1.85;

/** Inside the mouth, in the frame of the eye: half the width and the depth of the arches, tilt of each jaw (rad), their hinge (m). */
const ARCH_W = 0.1;
const ARCH_D = 0.205;
const ARCH_BACK = -0.05;
const UPPER_TILT = 0.47;
const LOWER_TILT = 0.42;
const UPPER_Y = 0.012;
const LOWER_Y = -0.012;
/** Which tooth on the left comes out, and the size of the real molar that stands in it. */
const PULLED_TOOTH = 5;
const MOLAR_SCALE = 2.5;
/** The hair: strands, points along each, how fast it travels (strokes of the hands, s). */
const STRANDS = 16;
const NODES = 34;
const HAUL_SPEED = 1.15;
const HAUL_PERIOD = 1.74;
/** Spray on the lens, and dust from the tooth. */
const LENS_DROPS = 110;
const DUST = 190;

const SATURATION = 0.78;
const SATURATION_NUMB = 0.05;
const APERTURE = 4.5;
const TWO_PI = Math.PI * 2;

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const vec = (a: V3): Vector3 => new Vector3(a[0], a[1], a[2]);

function basis(pitch: number, yaw: number, roll: number): { f: Vector3; r: Vector3; u: Vector3 } {
  const e = new Euler(pitch * DEG, yaw * DEG, roll * DEG, 'YXZ');
  return { f: new Vector3(0, 0, -1).applyEuler(e), r: new Vector3(1, 0, 0).applyEuler(e), u: new Vector3(0, 1, 0).applyEuler(e) };
}

function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  draw(el.getContext('2d')!, w, h);
  const t = new CanvasTexture(el);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** The little round mirror of a doctor, from in front: the lamp is in it, and a hole in its middle. */
function headMirror(): CanvasTexture {
  return canvasTexture(256, 256, (c, w, h) => {
    // silvered glass giving back the dim room with the lamp burning in it: never the white of an eye
    const sky = c.createRadialGradient(w * 0.42, h * 0.4, 0, w * 0.5, h * 0.5, w * 0.52);
    sky.addColorStop(0, '#9aa49c');
    sky.addColorStop(0.45, '#66726b');
    sky.addColorStop(0.85, '#3a443f');
    sky.addColorStop(1, '#1e2421');
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h);
    const sheen = c.createLinearGradient(w * 0.15, 0, w * 0.85, h);
    sheen.addColorStop(0.3, 'rgba(235,240,232,0)');
    sheen.addColorStop(0.42, 'rgba(235,240,232,0.55)');
    sheen.addColorStop(0.5, 'rgba(235,240,232,0)');
    c.fillStyle = sheen;
    c.fillRect(0, 0, w, h);
    const burn = (x: number, y: number, r: number) => {
      const d = c.createRadialGradient(x, y, 0, x, y, r);
      d.addColorStop(0, 'rgba(255,255,250,1)');
      d.addColorStop(0.6, 'rgba(255,255,245,0.9)');
      d.addColorStop(1, 'rgba(255,255,245,0)');
      c.fillStyle = d;
      c.beginPath();
      c.arc(x, y, r, 0, TWO_PI);
      c.fill();
    };
    burn(w * 0.34, h * 0.66, w * 0.05);
    for (let k = 0; k < 6; k++) burn(w * 0.34 + Math.cos((k / 6) * TWO_PI) * w * 0.12, h * 0.66 + Math.sin((k / 6) * TWO_PI) * w * 0.12, w * 0.05);
    // the small hole he looks through
    c.fillStyle = '#141917';
    c.beginPath();
    c.arc(w / 2, h / 2, w * 0.032, 0, TWO_PI);
    c.fill();
  });
}

/** Tubes of changing width, all in one geometry, each vertex with its own color. */
class Loft {
  private readonly p: number[] = [];
  private readonly c: number[] = [];
  private readonly ix: number[] = [];

  sweep(points: readonly V3[], steps: number, sides: number, radius: (s: number) => number, shade: (s: number) => Rgb, o: { squash?: number; boxy?: number; start?: V3 } = {}): void {
    const curve = new CatmullRomCurve3(points.map(vec), false, 'centripetal');
    const base = this.p.length / 3;
    const at = new Vector3();
    const t = new Vector3();
    const n = new Vector3();
    const b = new Vector3();
    curve.getTangent(0, t);
    if (o.start) n.set(o.start[0], o.start[1], o.start[2]);
    else n.set(Math.abs(t.x) < 0.9 ? 1 : 0, Math.abs(t.x) < 0.9 ? 0 : 1, 0);
    const boxy = o.boxy ?? 1;
    const squash = o.squash ?? 1;
    for (let j = 0; j <= steps; j++) {
      const s = j / steps;
      curve.getPoint(s, at);
      curve.getTangent(s, t);
      n.addScaledVector(t, -n.dot(t)).normalize();
      b.crossVectors(t, n);
      const r = radius(s);
      const col = shade(s);
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * TWO_PI;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const x = Math.sign(ca) * Math.abs(ca) ** boxy * r;
        const y = Math.sign(sa) * Math.abs(sa) ** boxy * r * squash;
        this.p.push(at.x + n.x * x + b.x * y, at.y + n.y * x + b.y * y, at.z + n.z * x + b.z * y);
        this.c.push(col[0], col[1], col[2]);
      }
    }
    for (let j = 0; j < steps; j++) {
      for (let i = 0; i < sides; i++) {
        const a0 = base + j * sides + i;
        const b0 = base + j * sides + ((i + 1) % sides);
        const c0 = a0 + sides;
        const d0 = b0 + sides;
        this.ix.push(a0, b0, c0, b0, d0, c0);
      }
    }
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.c), 3));
    g.setIndex(this.ix);
    g.computeVertexNormals();
    return g;
  }
}

const HALF_ARCH = [
  { w: 0.86, h: 0.044, kind: 0 },
  { w: 0.68, h: 0.041, kind: 0 },
  { w: 0.78, h: 0.05, kind: 1 },
  { w: 0.72, h: 0.039, kind: 2 },
  { w: 0.72, h: 0.037, kind: 2 },
  { w: 1.02, h: 0.034, kind: 3 },
  { w: 0.98, h: 0.032, kind: 3 },
] as const;

const capped = (s: number, from: number): number => (s > from ? Math.sqrt(Math.max(0.001, 1 - ((s - from) / (1 - from)) ** 2)) : 1);

/** One jaw: the biting edge on y = 0, the gum above it, incisors toward -z. `slot` says where the missing tooth was. */
function archGeometry(seed: number, missing: number, slot: Vector3): BufferGeometry {
  const rnd = seeded(seed);
  const loft = new Loft();
  const samples = 400;
  const step = Math.PI / 2 / samples;
  const arc: number[] = [0];
  for (let i = 1; i <= samples; i++) {
    const u = (i - 0.5) * step;
    arc.push(arc[i - 1] + step * Math.hypot(ARCH_W * Math.cos(u), ARCH_D * Math.sin(u)));
  }
  const unit = arc[samples] / HALF_ARCH.reduce((t, k) => t + k.w, 0);
  const angleAt = (d: number): number => {
    let i = 0;
    while (i < samples - 1 && arc[i + 1] < d) i++;
    return (i + clamp((d - arc[i]) / (arc[i + 1] - arc[i]), 0, 1)) * step;
  };
  for (const side of [-1, 1]) {
    let along = 0;
    HALF_ARCH.forEach((t, i) => {
      const u = side * angleAt(along + (t.w * unit) / 2);
      along += t.w * unit;
      const cx = ARCH_W * Math.sin(u);
      const cz = -ARCH_D * Math.cos(u);
      if (side < 0 && i === missing) {
        slot.set(cx, 0, cz);
        return;
      }
      const l = Math.hypot(ARCH_W * Math.cos(u), ARCH_D * Math.sin(u));
      const tx = (ARCH_W * Math.cos(u)) / l;
      const tz = (ARCH_D * Math.sin(u)) / l;
      const r = (t.w * unit * 0.47) / (t.kind === 0 ? 1 : 1.04);
      const yellow = 0.52 + rnd() * 0.12;
      const color: Rgb = [0.92 * yellow, 0.82 * yellow, 0.6 * yellow];
      const shade = (s: number): Rgb => {
        const k = smootherstep(clamp(s / 0.42, 0, 1));
        return [lerp(0.22, color[0], k), lerp(0.14, color[1], k), lerp(0.1, color[2], k)];
      };
      const radius = (s: number): number => {
        const neck = lerp(0.68, 1, smootherstep(clamp(s / 0.36, 0, 1)));
        if (t.kind === 1) return r * neck * lerp(1, 0.12, smootherstep(clamp((s - 0.42) / 0.58, 0, 1))) * capped(s, 0.97);
        return r * neck * capped(s, t.kind === 0 ? 0.95 : 0.88);
      };
      const lean = (rnd() - 0.5) * 0.006;
      const lean2 = (rnd() - 0.5) * 0.006;
      loft.sweep([[cx + lean, t.h, cz + lean2], [cx + lean * 0.5, t.h * 0.45, cz + lean2 * 0.5], [cx, -0.0005 - rnd() * 0.0025, cz]], 16, 14, radius, shade, { squash: t.kind === 0 ? 0.46 : t.kind === 1 ? 0.72 : 0.92, boxy: t.kind === 1 ? 0.95 : 0.84, start: [tx, 0, tz] });
      if (t.kind >= 2) {
        const nx = -tz;
        const nz = tx;
        const cusp = (a: number, b: number) => {
          const px = cx + tx * a * r + nx * b * r;
          const pz = cz + tz * a * r + nz * b * r;
          loft.sweep([[px, 0.012, pz], [px, 0.002, pz], [px, -0.0065 - rnd() * 0.002, pz]], 8, 10, (s) => r * 0.42 * capped(s, 0.4), () => color);
        };
        cusp(0.52, 0.45);
        cusp(-0.52, 0.45);
        cusp(0.52, -0.45);
        if (t.kind === 3) cusp(-0.52, -0.45);
      }
    });
  }
  const path: V3[] = [];
  for (let k = 0; k <= 26; k++) {
    const u = (k / 26 - 0.5) * Math.PI * 1.06;
    path.push([ARCH_W * Math.sin(u), 0.062, -ARCH_D * Math.cos(u)]);
  }
  loft.sweep(path, 120, 14, () => 0.034, () => [0.11, 0.024, 0.028], { squash: 0.8 });
  return loft.geometry();
}

interface HandPose {
  curls: readonly V3[];
  splay: readonly number[];
  thumb: readonly V3[];
}

const FINGERS = [
  { x: 0.031, y: 0.092, l: [0.045, 0.026, 0.022], r: 0.0086 },
  { x: 0.0105, y: 0.098, l: [0.05, 0.03, 0.024], r: 0.0088 },
  { x: -0.0105, y: 0.094, l: [0.046, 0.029, 0.023], r: 0.0083 },
  { x: -0.031, y: 0.084, l: [0.036, 0.022, 0.02], r: 0.0072 },
] as const;

/** A hand laid against the side of a head. */
const HAND_HOLD: HandPose = {
  curls: [[0.25, 0.4, 0.25], [0.3, 0.45, 0.3], [0.3, 0.45, 0.3], [0.35, 0.5, 0.3]],
  splay: [0.08, 0.02, -0.04, -0.1],
  thumb: [[0.03, 0.028, 0.012], [0.062, 0.06, 0.018], [0.082, 0.094, 0.028], [0.09, 0.122, 0.04]],
};
/** A hand closed around a tool, the tool's axis along x. */
const HAND_GRIP: HandPose = {
  curls: [[0.9, 0.95, 0.55], [1, 1, 0.6], [1.05, 1.05, 0.6], [1.1, 1.05, 0.6]],
  splay: [0.06, 0.02, -0.02, -0.06],
  thumb: [[0.03, 0.028, 0.014], [0.054, 0.062, 0.038], [0.046, 0.097, 0.06], [0.024, 0.115, 0.067]],
};
const GRIP_POINT: V3 = [0, 0.112, 0.038];
/** Finger and thumb closed on something thin. */
const HAND_PINCH: HandPose = {
  curls: [[0.6, 0.8, 0.5], [0.95, 1.15, 0.7], [1.05, 1.2, 0.7], [1.1, 1.2, 0.7]],
  splay: [0.05, 0.02, -0.02, -0.06],
  thumb: [[0.03, 0.028, 0.014], [0.055, 0.068, 0.04], [0.05, 0.105, 0.06], [0.034, 0.128, 0.071]],
};
const PINCH_POINT: V3 = [0.03, 0.128, 0.072];
/** One finger hooked, the others shut. */
const HAND_HOOK: HandPose = {
  curls: [[0.35, 0.75, 0.75], [1.1, 1.3, 0.8], [1.15, 1.3, 0.8], [1.2, 1.3, 0.8]],
  splay: [0.05, 0.02, -0.02, -0.06],
  thumb: [[0.03, 0.028, 0.014], [0.05, 0.06, 0.04], [0.035, 0.09, 0.05], [0.015, 0.105, 0.05]],
};
const HOOK_POINT: V3 = [0.03, 0.142, 0.06];

const LATEX: Rgb = [0.56, 0.54, 0.46];
const SLEEVE: Rgb = [0.05, 0.08, 0.068];

const creased = (s: number, joints: readonly number[]): Rgb => {
  let k = 1;
  for (const j of joints) k -= 0.26 * Math.exp(-(((s - j) / 0.016) ** 2));
  return [LATEX[0] * k, LATEX[1] * k, LATEX[2] * k];
};

const fingerRadius = (s: number, r: number, joints: readonly number[]): number => {
  let k = 1 - 0.24 * s;
  if (s > 0.93) k *= Math.sqrt(Math.max(0, 1 - ((s - 0.93) / 0.07) ** 2));
  for (const j of joints) k *= 1 - 0.07 * Math.exp(-(((s - j) / 0.02) ** 2));
  return r * k;
};

/** A hand in a latex glove: wrist at the origin, fingers along +y, palm toward +z, thumb on +x; and the arm behind it. */
function handGeometry(pose: HandPose): BufferGeometry {
  const loft = new Loft();
  FINGERS.forEach((f, i) => {
    const spl = pose.splay[i];
    const points: V3[] = [[f.x, f.y - 0.02, 0], [f.x, f.y, 0]];
    let cur: V3 = points[1];
    let total = 0;
    for (let k = 0; k < 3; k++) {
      total += pose.curls[i][k];
      const c = Math.cos(total);
      cur = [cur[0] + Math.sin(spl) * c * f.l[k], cur[1] + Math.cos(spl) * c * f.l[k], cur[2] + Math.sin(total) * f.l[k]];
      points.push(cur);
    }
    const joints = [0.5, 0.75];
    loft.sweep(points, 26, 10, (s) => fingerRadius(s, f.r, joints), (s) => creased(s, joints));
  });
  const widths = new GlideTrack([0, 0.08, 0.3, 0.72, 0.93, 1], [0.012, 0.028, 0.035, 0.042, 0.036, 0.002]);
  loft.sweep([[0, -0.02, 0], [0, 0.02, 0.003], [0, 0.06, 0.004], [0, 0.1, 0.001], [0, 0.118, 0]], 20, 26, (s) => widths.at(s), () => LATEX, { squash: 0.34, boxy: 0.72, start: [1, 0, 0] });
  loft.sweep([[0.012, -0.004, 0.012], [0.03, 0.03, 0.018], [0.046, 0.06, 0.02]], 12, 12, (s) => 0.021 * Math.sqrt(Math.max(0.02, 1 - (2 * s - 1) ** 2)), () => LATEX);
  const joints = [0.5, 0.75];
  loft.sweep(pose.thumb, 24, 10, (s) => fingerRadius(s, 0.0108, joints), (s) => creased(s, joints));
  // the cuff of the glove, and the arm in its sleeve
  loft.sweep([[0, 0.012, 0], [0, -0.04, 0], [0, -0.075, 0], [0, -0.092, 0]], 12, 16, (s) => 0.03 + 0.005 * s + 0.0035 * Math.exp(-(((s - 0.94) / 0.05) ** 2)), () => LATEX, { squash: 0.8, start: [1, 0, 0] });
  loft.sweep([[0, -0.085, 0], [0, -0.2, 0], [0, -0.42, 0], [0, -0.7, 0]], 8, 12, (s) => 0.04 + 0.035 * s, () => SLEEVE, { squash: 0.85, start: [1, 0, 0] });
  return loft.geometry();
}

/** How far a scanned head reaches in every direction from its center, smoothed so that a cloth laid over it stays taut. */
const FIELD_W = 90;
const FIELD_H = 45;

class HeadField {
  private readonly g = new Float32Array(FIELD_W * FIELD_H);
  /** Elevation of the tip of the nose (rad). */
  readonly nose: number;

  constructor(scan: Object3D) {
    const v = new Vector3();
    const g = this.g;
    scan.updateWorldMatrix(true, true);
    scan.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
        const r = v.length();
        const az = Math.atan2(v.x, v.z);
        const el = Math.asin(clamp(v.y / r, -1, 1));
        const ix = Math.min(FIELD_W - 1, Math.floor(((az + Math.PI) / TWO_PI) * FIELD_W));
        const iy = Math.min(FIELD_H - 1, Math.floor(((el + Math.PI / 2) / Math.PI) * FIELD_H));
        g[iy * FIELD_W + ix] = Math.max(g[iy * FIELD_W + ix], r);
      }
    });
    for (let pass = 0; pass < 14; pass++) this.smooth(pass > 9 ? 'blur' : pass > 7 ? 'grow' : 'fill');
    let best = 0;
    let nose = 0;
    for (let d = -40; d <= 40; d++) {
      const r = this.radius(0, d * DEG) * Math.cos(d * DEG);
      if (r > best) {
        best = r;
        nose = d * DEG;
      }
    }
    this.nose = nose;
  }

  private smooth(mode: 'fill' | 'grow' | 'blur'): void {
    const c = this.g.slice();
    for (let y = 0; y < FIELD_H; y++) {
      for (let x = 0; x < FIELD_W; x++) {
        const i = y * FIELD_W + x;
        if (mode === 'fill' && c[i] > 0) continue;
        let sum = 0;
        let n = 0;
        let most = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= FIELD_H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const v = c[yy * FIELD_W + ((x + dx + FIELD_W) % FIELD_W)];
            if (v <= 0) continue;
            sum += v;
            n++;
            most = Math.max(most, v);
          }
        }
        if (n === 0) continue;
        this.g[i] = mode === 'grow' ? most : sum / n;
      }
    }
  }

  radius(az: number, el: number): number {
    const x = ((az + Math.PI) / TWO_PI) * FIELD_W - 0.5;
    const y = clamp(((el + Math.PI / 2) / Math.PI) * FIELD_H - 0.5, 0, FIELD_H - 1.001);
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const at = (a: number, b: number) => this.g[b * FIELD_W + ((a + FIELD_W) % FIELD_W)];
    return lerp(lerp(at(ix, iy), at(ix + 1, iy), fx), lerp(at(ix, iy + 1), at(ix + 1, iy + 1), fx), fy);
  }
}

interface DrapePoint {
  az: number;
  el: number;
  lift: number;
  shade: number;
}

/** A cloth laid over a head field: `at` says where each (u, v) lies. */
function drape(field: HeadField, cols: number, rows: number, color: Rgb, at: (u: number, v: number, out: DrapePoint) => void): BufferGeometry {
  const n = (cols + 1) * (rows + 1);
  const p = new Float32Array(n * 3);
  const c = new Float32Array(n * 3);
  const pt: DrapePoint = { az: 0, el: 0, lift: 0, shade: 1 };
  let w = 0;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      at(i / cols, j / rows, pt);
      const r = field.radius(pt.az, pt.el) + pt.lift;
      p[w * 3] = r * Math.cos(pt.el) * Math.sin(pt.az);
      p[w * 3 + 1] = r * Math.sin(pt.el);
      p[w * 3 + 2] = r * Math.cos(pt.el) * Math.cos(pt.az);
      c[w * 3] = color[0] * pt.shade;
      c[w * 3 + 1] = color[1] * pt.shade;
      c[w * 3 + 2] = color[2] * pt.shade;
      w++;
    }
  }
  const ix: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      ix.push(a, b, d, b, e, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(p, 3));
  g.setAttribute('color', new BufferAttribute(c, 3));
  g.setIndex(ix);
  g.computeVertexNormals();
  return g;
}

const CLOTH_SHADOW = 0.62;

/** A real head under a cap and a surgical mask; the outer mask can fold down, and there is another under it. */
class MaskedHead {
  readonly root = new Group();
  readonly under: Mesh;
  /** Top middle of the outer mask, in the head's frame, as it is folded now. */
  readonly hook = new Vector3();
  private readonly outer: Mesh;
  private readonly outerCloth: MeshStandardMaterial;
  private readonly restP: Float32Array;
  private readonly restN: Float32Array;
  private readonly weight: Float32Array;
  private readonly pivotY: number;
  private readonly pivotZ: number;
  private readonly hookIndex: number;

  constructor(kit: DreamKit, skin: Material, cloth: Material, trimMaterial: Material, opts: { cap: Rgb; mask: Rgb; mirror: boolean; seed: number }) {
    const scan = kit.prop('mri_head', [0, 0, 0], { scale: HEAD_H, anchor: 'center' }, this.root);
    kit.paint(scan, skin);
    const field = new HeadField(scan);
    const nose = field.nose;
    const seedA = opts.seed * 2.3;

    const hem = (az: number) => {
      const k = Math.abs(az) / Math.PI;
      return nose + lerp(44 * DEG, -24 * DEG, smootherstep(k));
    };
    const cap = drape(field, 120, 28, opts.cap, (u, v, o) => {
      const az = (u - 0.5) * TWO_PI;
      const from = hem(az);
      o.az = az;
      o.el = lerp(from, 88 * DEG, v);
      const gather = (1 - v) ** 3;
      const fold = Math.sin(az * 31 + 3 * Math.sin(az * 5 + seedA)) * 0.5 + 0.5;
      const big = Math.sin(az * 7 + o.el * 5 + seedA) * Math.sin(o.el * 9 - az * 3);
      o.lift = CAP_LIFT + 0.024 * Math.sin(v * Math.PI * 0.62) ** 0.6 - 0.0028 * fold * gather + 0.004 * big * (1 - gather);
      o.shade = 1 - CLOTH_SHADOW * gather * (1 - fold) * 0.45 - 0.1 * Math.max(0, -big);
    });
    this.root.add(new Mesh(cap, cloth));

    const span = 86 * DEG;
    const ease = (az: number) => Math.cos(((az / span) * Math.PI) / 2) ** 1.1;
    const maskAt = (lift: number, stain: number) => (u: number, v: number, o: DrapePoint) => {
      const az = (u - 0.5) * 2 * span;
      const e = ease(az);
      o.az = az;
      o.el = lerp(nose + lerp(-22 * DEG, -58 * DEG, e), nose + lerp(-4 * DEG, 7 * DEG, e), v);
      const edge = 1 - Math.abs(2 * u - 1) ** 3;
      const inPleats = range(0.16, 0.26, v) * (1 - range(0.74, 0.84, v));
      const f = (v * 3.4) % 1;
      const saw = f < 0.72 ? f / 0.72 : (1 - f) / 0.28;
      o.lift = lift + 0.0052 * saw * inPleats * edge + 0.0024 * Math.exp(-(((v - 0.965) / 0.03) ** 2)) * e;
      const mouth = Math.exp(-((u - 0.5) ** 2) / 0.012 - (v - 0.47) ** 2 / 0.03);
      o.shade = 1 - CLOTH_SHADOW * (1 - saw) * inPleats * edge * 1.2 - stain * mouth;
    };
    const outerG = drape(field, 44, 22, opts.mask, maskAt(MASK_LIFT, 0.05));
    // its own copy of the cloth, so that it can go dim as it folds
    this.outerCloth = (cloth as MeshStandardMaterial).clone();
    this.outer = new Mesh(outerG, this.outerCloth);
    this.outer.frustumCulled = false;
    this.root.add(this.outer);
    this.under = new Mesh(drape(field, 44, 22, [0.84, 0.88, 0.78], maskAt(MASK_UNDER, 0.3)), cloth);
    this.under.visible = false;
    this.root.add(this.under);

    const pos = outerG.getAttribute('position') as BufferAttribute;
    const nor = outerG.getAttribute('normal') as BufferAttribute;
    pos.setUsage(DynamicDrawUsage);
    nor.setUsage(DynamicDrawUsage);
    this.restP = (pos.array as Float32Array).slice();
    this.restN = (nor.array as Float32Array).slice();
    this.weight = new Float32Array(pos.count);
    const cols = 45;
    this.hookIndex = 22 * cols + 22;
    const chin = 22;
    this.pivotY = this.restP[chin * 3 + 1];
    this.pivotZ = this.restP[chin * 3 + 2];
    for (let j = 0; j <= 22; j++) {
      for (let i = 0; i <= 44; i++) {
        const side = Math.abs((2 * i) / 44 - 1) ** 3;
        this.weight[j * cols + i] = smootherstep(j / 22) * (1 - 0.9 * side);
      }
    }
    this.bend(0);

    const trim = new Loft();
    const onHead = (az: number, el: number, lift: number): V3 => {
      const r = field.radius(az * DEG, nose + el * DEG) + lift;
      return [r * Math.cos(nose + el * DEG) * Math.sin(az * DEG), r * Math.sin(nose + el * DEG), r * Math.cos(nose + el * DEG) * Math.cos(az * DEG)];
    };
    const loop = (side: number) => {
      const shade = (): Rgb => [0.7, 0.72, 0.66];
      const wire = () => 0.0019;
      trim.sweep([onHead(side * 84, 1, 0.008), onHead(side * 98, 8, 0.01), onHead(side * 118, 2, 0.01), onHead(side * 104, -14, 0.01), onHead(side * 84, -26, 0.008)], 24, 5, wire, shade);
    };
    loop(1);
    loop(-1);
    if (opts.mirror) {
      // a doctor's round mirror on a band, up on the brow, with a small hole in it
      const black = (): Rgb => [0.012, 0.014, 0.014];
      const band: V3[] = [];
      for (let az = -130; az <= 130; az += 13) band.push(onHead(az, 33, lerp(0.004, 0.036, smootherstep(Math.abs(az) / 70))));
      trim.sweep(band, 60, 6, () => 0.0042, black);
      const brow = onHead(MIRROR_EYE, MIRROR_UP, 0.002);
      const at: V3 = [brow[0], brow[1], brow[2] + MIRROR_OUT];
      const pin: V3 = [at[0], at[1] - MIRROR_R, at[2]];
      const from = onHead(MIRROR_EYE, 28, 0.006);
      trim.sweep([from, [(from[0] + pin[0]) / 2, (from[1] + pin[1]) / 2 + 0.006, (from[2] + pin[2]) / 2 + 0.006], pin], 10, 6, () => 0.0032, black);
      const ring: V3[] = [];
      for (let k = 0; k <= 36; k++) ring.push([at[0] + Math.cos((k / 36) * TWO_PI) * MIRROR_R, at[1] + Math.sin((k / 36) * TWO_PI) * MIRROR_R, at[2]]);
      trim.sweep(ring, 72, 6, () => 0.0026, () => [0.2, 0.21, 0.2]);
      const dish = new Mesh(new CircleGeometry(MIRROR_R, 36), new MeshBasicMaterial({ map: headMirror(), color: new Color(0.9, 0.92, 0.88), fog: false }));
      dish.position.set(at[0], at[1], at[2] + 0.0004);
      this.root.add(dish);
    }
    // the eyes under it are shut: dark curved lines
    const lid = (side: number) =>
      trim.sweep([onHead(side * 8, 19, 0.0015), onHead(side * 15.5, 15.5, 0.0015), onHead(side * 23, 18.5, 0.0015)], 12, 5, (s) => 0.0018 * (1.05 - 0.5 * Math.abs(2 * s - 1)), () => [0.03, 0.03, 0.028]);
    lid(1);
    lid(-1);
    this.root.add(new Mesh(trim.geometry(), trimMaterial));

    const shoulders = new Mesh(new SphereGeometry(1, 24, 16), new MeshStandardMaterial({ color: 0x24332d, roughness: 0.9 }));
    shoulders.scale.set(0.2, 0.42, 0.14);
    shoulders.position.set(0, -0.46, -0.08);
    this.root.add(shoulders);
  }

  /** The outer mask folded `theta` rad, down from its top edge; no allocation. */
  bend(theta: number): void {
    const pos = this.outer.geometry.getAttribute('position') as BufferAttribute;
    const nor = this.outer.geometry.getAttribute('normal') as BufferAttribute;
    const p = pos.array as Float32Array;
    const n = nor.array as Float32Array;
    const count = pos.count;
    for (let i = 0; i < count; i++) {
      const a = theta * this.weight[i];
      const c = Math.cos(a);
      const s = Math.sin(a);
      const i3 = i * 3;
      const dy = this.restP[i3 + 1] - this.pivotY;
      const dz = this.restP[i3 + 2] - this.pivotZ;
      p[i3] = this.restP[i3];
      p[i3 + 1] = this.pivotY + dy * c - dz * s;
      p[i3 + 2] = this.pivotZ + dy * s + dz * c;
      n[i3] = this.restN[i3];
      n[i3 + 1] = this.restN[i3 + 1] * c - this.restN[i3 + 2] * s;
      n[i3 + 2] = this.restN[i3 + 1] * s + this.restN[i3 + 2] * c;
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    const h = this.hookIndex * 3;
    this.hook.set(p[h], p[h + 1], p[h + 2]);
    this.outerCloth.color.setScalar(1 - 0.42 * Math.min(1, theta / MASK_FOLD));
  }
}

/** A wet white hair and its neighbours, drawn as ribbons that face the eye (eye at the origin of its frame). */
class WetHair {
  readonly mesh: Mesh;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly posAttr: BufferAttribute;
  private readonly colAttr: BufferAttribute;
  private readonly angle = new Float32Array(STRANDS);
  private readonly apart = new Float32Array(STRANDS);
  private readonly twist = new Float32Array(STRANDS);
  private readonly tone = new Float32Array(STRANDS);

  constructor() {
    const n = STRANDS * NODES * 2;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    const ix: number[] = [];
    for (let j = 0; j < STRANDS; j++) {
      for (let k = 0; k < NODES - 1; k++) {
        const a = (j * NODES + k) * 2;
        ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const rnd = seeded(41);
    for (let j = 0; j < STRANDS; j++) {
      this.angle[j] = rnd() * TWO_PI;
      this.apart[j] = 0.35 + rnd() * 0.65;
      this.twist[j] = 2 + rnd() * 5;
      this.tone[j] = 0.45 + rnd() * 0.5;
    }
    const g = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.pos, 3);
    this.colAttr = new BufferAttribute(this.col, 3);
    this.posAttr.setUsage(DynamicDrawUsage);
    this.colAttr.setUsage(DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    g.setIndex(ix);
    this.mesh = new Mesh(g, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: false }));
    this.mesh.frustumCulled = false;
  }

  /** From `a` near the eye, through `c`, to `b`. `travel` slides it along itself, `shiver` shakes it. */
  update(a: Vector3, c: Vector3, b: Vector3, travel: number, shiver: number): void {
    const p = this.pos;
    const col = this.col;
    let w = 0;
    for (let j = 0; j < STRANDS; j++) {
      const ang = this.angle[j];
      const apart = this.apart[j];
      const tw = this.twist[j];
      const tone = this.tone[j];
      for (let k = 0; k < NODES; k++) {
        const s = k / (NODES - 1);
        const i = 1 - s;
        let x = i * i * a.x + 2 * i * s * c.x + s * s * b.x;
        let y = i * i * a.y + 2 * i * s * c.y + s * s * b.y;
        const z = i * i * a.z + 2 * i * s * c.z + s * s * b.z;
        const tx = 2 * i * (c.x - a.x) + 2 * s * (b.x - c.x);
        const ty = 2 * i * (c.y - a.y) + 2 * s * (b.y - c.y);
        const tz = 2 * i * (c.z - a.z) + 2 * s * (b.z - c.z);
        // the strands part near the eye and gather as they go out
        const spread = apart * (0.0013 + 0.022 * i * i * i);
        const turn = ang + s * tw + travel * 0.6;
        x += Math.cos(turn) * spread;
        y += Math.sin(turn) * spread;
        const shake = shiver * Math.sin(s * Math.PI) * Math.sin(s * 29 - travel * 8 + ang) * 0.005;
        x += shake;
        y += shake * 0.6;
        const ox = ty * -z + tz * y;
        const oy = tz * -x + tx * z;
        const oz = tx * -y + ty * x;
        const depth = Math.max(0, -z);
        const scale = (0.0003 + 0.00105 * depth) / Math.max(1e-6, Math.sqrt(ox * ox + oy * oy + oz * oz));
        p[w] = x - ox * scale;
        p[w + 1] = y - oy * scale;
        p[w + 2] = z - oz * scale;
        p[w + 3] = x + ox * scale;
        p[w + 4] = y + oy * scale;
        p[w + 5] = z + oz * scale;
        const glint = Math.max(0, Math.sin(s * 53 - travel * 14 + ang * 3)) ** 18 * 3.2;
        const g = tone * lerp(0.62, 1.05, s) + glint;
        col[w] = col[w + 3] = g * 0.94;
        col[w + 1] = col[w + 4] = g * 0.96;
        col[w + 2] = col[w + 5] = g * 0.9;
        w += 6;
      }
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}

const LID_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
}`;

const LID_FRAG = /* glsl */ `
uniform float uOpen;
uniform float uAspect;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  p.x *= uAspect;
  float curve = 0.15 * p.x * p.x;
  float halfOpen = uOpen > 0.9 ? mix(0.95, 1.8, (uOpen - 0.9) / 0.1) : mix(-0.04, 0.95, uOpen / 0.9);
  float up = halfOpen - curve - p.y;
  float low = halfOpen - curve * 0.75 + p.y;
  float edge = min(up, low);
  float a = 1.0 - smoothstep(0.0, 0.2, edge);
  float lash = smoothstep(0.55, 1.0, sin(p.x * 96.0 + 3.0 * sin(p.x * 21.0))) * smoothstep(0.42, 0.04, abs(edge - 0.07)) * step(0.0, edge + 0.04);
  vec3 lit = mix(vec3(0.03, 0.007, 0.007), vec3(0.24, 0.045, 0.036), smoothstep(1.7, 0.0, length(p)));
  lit *= mix(1.0, 0.16, smoothstep(0.6, 0.92, uOpen));
  a = clamp(a + lash * 0.4, 0.0, 1.0);
  gl_FragColor = vec4(mix(lit, vec3(0.004, 0.004, 0.005), lash), a);
}`;

/**
 * The dentist. You lie at the bottom of a tall tiled well, your head held by gloved hands, looking up into an
 * operating lamp, and a ring of those who wait look down at you over the rim, against a pale glass. Everything is
 * very clean. The needle stops just before the eye. Then you are inside your own mouth, looking out between your teeth.
 */
export default class Dentist extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x0a0f0d, density: 0.028 },
    env: 'bathroom',
    envIntensity: 0.1,
    sky: 0,
    grade: { exposure: 1.12, saturation: SATURATION, warmth: 0, tint: -0.015, flare: 0.003 },
  };
  film = { bloom: 1.25, bloomFrom: 1.6, grain: 0.35, scratches: 0.06, flicker: 0.015, weave: 0.0003, ghost: 0, aberration: 0, barrel: 0.02 };
  focus = 1;
  aperture = APERTURE;
  drift = 0;
  fear = 0.25;
  control = { look: true, scroll: false, hurry: 1 };

  private readonly held = new Group();
  private readonly chairSet = new Group();
  private readonly mouthSet = new Group();
  private readonly latex = new MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0, emissive: 0x0a0806 });
  private readonly latexDark = new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, color: 0x4a4a48 });
  private readonly motes: { value: number }[] = [];
  private gazeYaw = 0;
  private gazePitch = 0;
  private heldYaw = 0;
  private heldPitch = 0;

  private lampFace!: MeshBasicMaterial;
  private ghostLamp!: Group;
  private ghostFace!: MeshBasicMaterial;
  private skyMaterial!: MeshBasicMaterial;
  private tray!: Group;
  private pane!: Mesh;
  private litAt = NaN;
  private rig!: Group;
  private rigHand!: Mesh;
  private rigHandRest = new Vector3();
  private readonly rigTracks: GlideTrack[] = [];
  private tipDrop!: Mesh;
  private dropMaterial!: MeshBasicMaterial;
  private nurseR!: Mesh;
  private nurseL!: Mesh;
  private hoseA!: Mesh;
  private watchersLate!: Object3D;
  private dentistHead!: MaskedHead;
  private nurseHead!: MaskedHead;
  private maskHand!: Mesh;

  private drillRig!: Group;
  private forcepsRig!: Group;
  private molar!: Group;
  private socket!: Mesh;
  private hair!: WetHair;
  private haulA!: Mesh;
  private haulB!: Mesh;
  private haulOffsetA = new Vector3();
  private haulOffsetB = new Vector3();
  private contactGlow!: Mesh;
  private dust!: Points;
  private dustSeed!: Float32Array;
  private dustAttr!: BufferAttribute;
  private lensDrops!: InstancedMesh;
  private dropSeed!: Float32Array;

  private readonly lid = { uOpen: { value: 1 }, uAspect: { value: 16 / 9 } };
  private lidMesh!: Mesh;

  private fill;
  private spill;
  private mouthLight;
  private throatLight;
  private fillSpot;

  private tone?: RoomVoice;
  private hum?: RoomVoice;
  private drone?: RoomVoice;
  private glass?: RoomVoice;
  private breath?: RoomVoice;
  private suction?: RoomVoice;
  private muffled?: RoomVoice;
  private drillLow?: RoomVoice;
  private drillHigh?: RoomVoice;
  private drillBite?: RoomVoice;
  private hairVoice?: RoomVoice;

  private readonly v = new Vector3();
  private readonly w = new Vector3();
  private readonly x = new Vector3();
  private readonly hairA = new Vector3();
  private readonly hairB = new Vector3();
  private readonly hairC = new Vector3();
  private readonly m = new Matrix4();

  private readonly eyeChair = vec(EYE_CHAIR);
  private readonly eyeMouth = vec(EYE_MOUTH);
  private readonly mouthBasis = basis(84, 0, 0);
  private readonly dentistFar = new Vector3();
  private readonly dentistNear = new Vector3();
  private readonly nursePlace = new Vector3();
  private readonly burrAt = new Vector3();
  private readonly molarAt = new Vector3();
  private readonly burrFrom = new Vector3();
  private readonly toolAxis = new Vector3();

  constructor(ctx: RoomContext) {
    super(ctx);
    this.keys = this.cameraKeys();
    this.lens.add(this.held);
    this.held.add(this.chairSet);
    this.held.add(this.mouthSet);

    const eye = this.eyeMouth;
    const { f, r, u } = this.mouthBasis;
    const inFrame = (x: number, y: number, d: number, out: Vector3) =>
      out.copy(eye).addScaledVector(f, d).addScaledVector(r, d * Math.tan(x * DEG)).addScaledVector(u, d * Math.tan(y * DEG));
    inFrame(-13, 9, 0.58, this.dentistFar);
    inFrame(0, 3, 0.42, this.dentistNear);
    inFrame(17, -7, 0.62, this.nursePlace);

    this.buildWell();
    this.buildLamp();
    this.buildTray();
    this.buildSyringe();
    this.buildNurse();
    this.buildHeads();
    this.buildMouth();
    this.buildTools();
    this.buildLensLife();

    this.fill = this.light([0, 0.2, -0.3], 0xd9e4d4, 0.6, 3.2);
    this.spill = this.light([LAMP[0], 2.4, LAMP[2]], 0xe6efe2, 3.6, 5.5);
    this.mouthLight = this.light([eye.x + f.x * 0.27, eye.y + f.y * 0.27, eye.z + f.z * 0.27], 0xf6efe0, 0, 0.42);
    this.throatLight = this.light([eye.x - f.x * 0.015 - u.x * 0.015, eye.y - f.y * 0.015 - u.y * 0.015, eye.z - f.z * 0.015 - u.z * 0.015], 0xff8f78, 0, 0.3);
    this.fillSpot = this.spot([0, -1.2, -0.2], [0, 5, 0.1], 0xc9dccf, 6, 19, 0.8);
    this.spots = [this.fillSpot, null, null];

    this.score();
  }

  private cameraKeys(): RoomKey[] {
    const t = (s: number) => s / this.seconds;
    const chair = EYE_CHAIR;
    const mouth = EYE_MOUTH;
    return [
      { t: 0, at: [0, 1.12, 0.01], yaw: 0, pitch: 78, fov: 62 },
      { t: t(7.5), at: chair, yaw: 0, pitch: 84, fov: 62 },
      { t: t(NEEDLE_DOWN), at: chair, yaw: 0, pitch: 84, fov: 58 },
      { t: t(NEEDLE_AT), at: chair, yaw: HOLD_YAW, pitch: HOLD_PITCH, roll: HOLD_ROLL, fov: HOLD_FOV },
      { t: t(NEEDLE_AWAY), at: chair, yaw: HOLD_YAW, pitch: HOLD_PITCH, roll: HOLD_ROLL, fov: HOLD_FOV },
      { t: t(JOLT + 0.6), at: chair, yaw: 3, pitch: 82, roll: -1.5, fov: 52 },
      { t: t(CUT - 0.02), at: chair, yaw: -2, pitch: 84.5, roll: -4, fov: 58 },
      { t: t(CUT + 0.02), at: mouth, yaw: 0, pitch: 84, roll: 0, fov: 62 },
      { t: t(46), at: mouth, yaw: 0, pitch: 84, roll: 0, fov: 60 },
      { t: 1, at: mouth, yaw: 0, pitch: 84, roll: 0, fov: 54 },
    ];
  }

  private buildWell(): void {
    const { kit, build: b, root } = this;
    const tile = kit.surface('tile_white', TILE, { color: new Color(SAGE), roughness: 0.3 });
    const ruined = kit.surface('tile_hospital_broken', 1.2, { color: new Color(SAGE_OLD), roughness: 0.55 });
    const W = HALF * 2;
    const walls = (material: Material, h: number, y: number) => {
      b.wall(HALF, 0, W, h, '-x', material, root, y);
      b.wall(-HALF, 0, W, h, '+x', material, root, y);
      b.wall(0, HALF, W, h, '-z', material, root, y);
      b.wall(0, -HALF, W, h, '+z', material, root, y);
    };
    walls(tile, BAND_Y, 0);
    walls(ruined, RIM - BAND_Y, BAND_Y);
    const ring = (y: number, h: number, depth: number, material: Material) => {
      for (const [x, z, turn] of [
        [0, HALF - depth / 2, 0],
        [0, -HALF + depth / 2, 0],
        [HALF - depth / 2, 0, 1],
        [-HALF + depth / 2, 0, 1],
      ] as const) {
        const m = kit.block(W, h, depth, material);
        m.position.set(x, y + h / 2, z);
        m.rotation.y = (turn * Math.PI) / 2;
        root.add(m);
      }
    };
    const dark = b.paint(0x1a2621, 0.4);
    ring(BAND_Y, BAND_H, 0.025, dark);
    ring(RIM, 0.22, 0.04, dark);
    root.add(kit.floor(-HALF, HALF, -HALF, HALF, 0, dark));

    // the pale glass high over everything, its bars the same grid as the tile
    const sky = canvasTexture(1024, 1024, (c, w) => {
      const g = c.createRadialGradient(w / 2, w / 2, w * 0.05, w / 2, w / 2, w * 0.62);
      g.addColorStop(0, '#6d8279');
      g.addColorStop(0.5, '#3c4c46');
      g.addColorStop(1, '#10181a');
      c.fillStyle = g;
      c.fillRect(0, 0, w, w);
      c.fillStyle = 'rgba(8,12,11,0.92)';
      const n = 7;
      for (let i = 0; i <= n; i++) {
        const at = (i / n) * w;
        c.fillRect(at - 5, 0, 10, w);
        c.fillRect(0, at - 5, w, 10);
      }
      const rnd = seeded(17);
      c.fillStyle = 'rgba(10,14,12,0.16)';
      for (let i = 0; i < 90; i++) {
        c.beginPath();
        c.ellipse(rnd() * w, rnd() * w, 3 + rnd() * 26, 3 + rnd() * 12, rnd() * 3, 0, TWO_PI);
        c.fill();
      }
    });
    this.skyMaterial = new MeshBasicMaterial({ map: sky, fog: false, color: new Color(1.7, 1.85, 1.75) });
    const glass = new Mesh(new PlaneGeometry(10, 10), this.skyMaterial);
    glass.rotation.x = Math.PI / 2;
    glass.position.set(0, SKY, 0);
    root.add(glass);

    // those who stand at the rim and look down: more of them after each time you close your eyes
    const place = (crowd: ReturnType<typeof kit.figures.crowd>, count: number, seed: number) => {
      const rnd = seeded(seed);
      const m = new Matrix4();
      const r = new Matrix4();
      const l = new Matrix4();
      for (let i = 0; i < count; i++) {
        const a = ((i + rnd() * 0.5) / count) * TWO_PI + seed;
        // around a square, not a circle: they stand along the edges of the well
        const c = Math.cos(a);
        const s = Math.sin(a);
        const k = (HALF + 0.42 + rnd() * 0.12) / Math.max(Math.abs(c), Math.abs(s));
        const x = c * k;
        const z = s * k;
        r.makeRotationY(Math.atan2(-x, -z));
        l.makeRotationX(WATCH_LEAN + rnd() * 0.12);
        m.copy(r).multiply(l).setPosition(x, RIM - 0.02, z);
        crowd.setMatrix(i, m);
      }
      crowd.commit();
      root.add(crowd.root);
    };
    const spec = { avatar: 'figure_nurse' as const, clip: 'm_idle_roll_head_01', time: 0.4, face: 'blank' as const, tint: 0x2f3b36 };
    place(kit.figures.crowd(spec, WATCHERS), WATCHERS, 1);
    const late = kit.figures.crowd({ ...spec, avatar: 'figure_man' as const, clip: 'm_idle_roll_head_01', time: 1.8, tint: 0x26302c }, WATCHERS_LATE);
    place(late, WATCHERS_LATE, 2.7);
    this.watchersLate = late.root;
    this.watchersLate.visible = false;

    // a lightbox on the wall, an old film of someone's jaw; nobody has looked at it for a long time
    kit.prop('xray_light', [-HALF + 0.05, 2.9, 0.22], { anchor: 'center' }, root);
    const filmTexture = canvasTexture(174, 246, (c, w, h) => {
      c.fillStyle = '#040605';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#26332e';
      c.beginPath();
      c.ellipse(w / 2, h * 0.46, w * 0.42, h * 0.3, 0, 0, TWO_PI);
      c.fill();
      const rnd = seeded(5);
      for (let row = 0; row < 2; row++) {
        for (let i = -6; i <= 6; i++) {
          const a = (i / 7) * 1.25;
          const x = w / 2 + Math.sin(a) * w * 0.38;
          const y = h * 0.46 + (row ? 1 : -1) * Math.cos(a) * h * 0.055 + (row ? 1 : -1) * h * 0.02;
          c.fillStyle = `rgba(232,240,232,${0.75 + rnd() * 0.25})`;
          c.fillRect(x - w * 0.018, row ? y : y - h * 0.09, w * 0.036, h * 0.09);
        }
      }
      c.strokeStyle = 'rgba(245,250,245,0.9)';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(w * 0.27, h * 0.33);
      c.bezierCurveTo(w * 0.2, h * 0.05, w * 0.72, h * 0.12, w * 0.5, h * 0.98);
      c.stroke();
    });
    const film = new Mesh(new PlaneGeometry(0.58, 0.82), new MeshBasicMaterial({ map: filmTexture, fog: false, color: new Color(0.75, 0.75, 0.75) }));
    film.rotation.y = Math.PI / 2;
    film.position.set(-HALF + 0.1, 2.9, 0.22);
    root.add(film);
    this.motes.push(b.motes(70, { x: [-0.7, 0.7], y: [1.2, 2.3], z: [-0.7, 0.7] }, root, { strength: 0.6 }).time);
    this.motes.push(b.motes(46, { x: [-HALF, HALF], y: [2.3, RIM], z: [-HALF, HALF] }, root).time);
  }

  private buildLamp(): void {
    const { build: b, root } = this;
    const lamp = new Group();
    lamp.position.set(LAMP[0], LAMP[1], LAMP[2]);
    root.add(lamp);

    const face = canvasTexture(512, 512, (c, w) => {
      c.fillStyle = '#0c0a06';
      c.fillRect(0, 0, w, w);
      const r = w * 0.155;
      const lens = (x: number, y: number) => {
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.55, '#fff6e2');
        g.addColorStop(0.88, '#b9a47a');
        g.addColorStop(1, '#2a2013');
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, r, 0, TWO_PI);
        c.fill();
        c.strokeStyle = 'rgba(60,45,20,0.18)';
        c.lineWidth = 1.5;
        for (let k = 1; k < 7; k++) {
          c.beginPath();
          c.arc(x, y, (r * k) / 7, 0, TWO_PI);
          c.stroke();
        }
      };
      lens(w / 2, w / 2);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TWO_PI + 0.26;
        lens(w / 2 + Math.cos(a) * w * 0.33, w / 2 + Math.sin(a) * w * 0.33);
      }
    });
    this.lampFace = new MeshBasicMaterial({ map: face, fog: false, color: new Color(LAMP_POWER, LAMP_POWER, LAMP_POWER * 0.95) });
    const disc = new CircleGeometry(LAMP_R * 0.9, 64);
    disc.rotateX(Math.PI / 2);
    const faceMesh = new Mesh(disc, this.lampFace);
    faceMesh.position.y = -0.005;
    lamp.add(faceMesh);

    const profile = [
      [0, 0.1],
      [0.06, 0.098],
      [0.13, 0.085],
      [0.18, 0.055],
      [LAMP_R, 0.02],
      [LAMP_R + 0.006, 0],
      [LAMP_R - 0.002, -0.012],
      [LAMP_R * 0.9, -0.01],
    ].map(([x, y]) => new Vector2(x, y));
    const dome = new LatheGeometry(profile, 64);
    dome.setAttribute('color', new BufferAttribute(new Float32Array(dome.getAttribute('position').count * 3).fill(1), 3));
    lamp.add(new Mesh(dome, new MeshStandardMaterial({ vertexColors: true, color: 0xb8beb4, roughness: 0.4, metalness: 0.1, side: DoubleSide })));

    // the handle in the middle of the lenses, a pupil
    const handleMaterial = new MeshStandardMaterial({ color: 0x0b0b09, roughness: 0.5 });
    const handle = new Mesh(new CylinderGeometry(0.018, 0.024, 0.09, 16), handleMaterial);
    handle.position.y = -0.05;
    lamp.add(handle);
    const ball = new Mesh(new SphereGeometry(0.034, 20, 14), handleMaterial);
    ball.position.y = -0.1;
    lamp.add(ball);

    b.glow(LAMP[0], LAMP[1] - 0.05, LAMP[2], 2, 0xfff4dc, 0.42, root, 2);

    // its arm: a long steel neck out of the wall
    const neck = new Loft();
    neck.sweep([[-HALF, 2.72, 0.05], [-0.78, 2.66, 0.05], [-0.3, 2.34, 0.04], [LAMP[0], LAMP[1] + 0.09, LAMP[2]]], 40, 10, () => 0.017, () => [0.3, 0.33, 0.31]);
    root.add(new Mesh(neck.geometry(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.75 })));

    // numb: a second lamp slides out of the first
    this.ghostLamp = new Group();
    this.ghostLamp.position.set(LAMP[0], LAMP[1], LAMP[2]);
    this.ghostFace = new MeshBasicMaterial({ map: face, fog: false, transparent: true, depthWrite: false, opacity: 0.8, color: new Color(LAMP_POWER * 0.45, LAMP_POWER * 0.45, LAMP_POWER * 0.42) });
    this.ghostLamp.add(new Mesh(disc, this.ghostFace));
    this.ghostLamp.visible = false;
    root.add(this.ghostLamp);
  }

  private buildTray(): void {
    const { kit } = this;
    this.tray = new Group();
    this.tray.position.set(TRAY_PARKED, PANE_Y, -0.05);
    this.tray.rotation.set(0.07, 0.1, 0);
    this.root.add(this.tray);

    const dirt = canvasTexture(512, 294, (c, w, h) => {
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, w, h);
      const rnd = seeded(23);
      c.strokeStyle = 'rgba(70,80,74,0.1)';
      c.lineWidth = 1;
      for (let i = 0; i < 120; i++) {
        const x = rnd() * w;
        const y = rnd() * h;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + (rnd() - 0.5) * 120, y + (rnd() - 0.5) * 40);
        c.stroke();
      }
      c.fillStyle = 'rgba(60,70,66,0.05)';
      for (let i = 0; i < 26; i++) {
        c.beginPath();
        c.ellipse(rnd() * w, rnd() * h, 12 + rnd() * 26, 10 + rnd() * 18, rnd() * 3, 0, TWO_PI);
        c.fill();
      }
    });
    const g = new PlaneGeometry(PANE_W, PANE_D, 26, 16);
    g.rotateX(Math.PI / 2);
    const n = g.getAttribute('position').count;
    const colors = new BufferAttribute(new Float32Array(n * 3), 3);
    colors.setUsage(DynamicDrawUsage);
    g.setAttribute('color', colors);
    this.pane = new Mesh(g, new MeshBasicMaterial({ map: dirt, vertexColors: true, fog: false, transparent: true, opacity: 0.88 }));
    this.tray.add(this.pane);

    const steel = new MeshStandardMaterial({ color: 0x5c645f, roughness: 0.32, metalness: 0.85 });
    const bar = (w: number, d: number, x: number, z: number) => {
      const m = kit.block(w, 0.012, d, steel);
      m.position.set(x, -0.002, z);
      this.tray.add(m);
    };
    bar(PANE_W + 0.016, 0.016, 0, PANE_D / 2);
    bar(PANE_W + 0.016, 0.016, 0, -PANE_D / 2);
    bar(0.016, PANE_D, PANE_W / 2, 0);
    bar(0.016, PANE_D, -PANE_W / 2, 0);
    const arm = new Mesh(new CylinderGeometry(0.012, 0.012, 1.3, 10), steel);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(PANE_W / 2 + 0.65, 0.01, 0);
    this.tray.add(arm);

    // laid out in perfect order, seen from below against the light: only their outlines
    const black = new MeshStandardMaterial({ color: 0x090b0a, roughness: 0.35, metalness: 0.6 });
    const lay = (key: string, x: number, z: number, rotation: V3, scale = 1) => {
      const p = kit.prop(key, [x, -0.004, z], { rotation, scale, anchor: 'top' }, this.tray);
      kit.paint(p, black);
      return p;
    };
    lay('dental_mirror', -0.105, 0, [0, 54, 0]);
    lay('tweezers', -0.052, 0.006, [90, 0, 0], 1.5);
    lay('scalpel', -0.012, -0.004, [0, 90, 0]);
    lay('pliers', 0.135, 0.004, [0, 0, 0]);
    const probes = new Loft();
    const probe = (x: number, hook: number) => {
      const shade = (): Rgb => [0.02, 0.024, 0.022];
      probes.sweep([[x, -0.008, -0.09], [x, -0.008, 0.04], [x, -0.008, 0.09]], 6, 8, (s) => 0.0034 + 0.0006 * s, shade);
      probes.sweep([[x, -0.008, -0.085], [x + hook * 0.004, -0.008, -0.11], [x + hook * 0.014, -0.008, -0.118], [x + hook * 0.02, -0.008, -0.106]], 14, 6, (s) => 0.0016 * (1 - s * 0.7), shade);
    };
    probe(-0.19, 1);
    probe(-0.15, -1);
    this.tray.add(new Mesh(probes.geometry(), this.latex));
  }

  private lightPane(trayX: number): void {
    const g = this.pane.geometry;
    const p = g.getAttribute('position');
    const c = g.getAttribute('color') as BufferAttribute;
    const cx = LAMP[0] * 0.49 - trayX;
    const cz = LAMP[2] * 0.49 + 0.05;
    for (let i = 0; i < p.count; i++) {
      const dx = p.getX(i) - cx;
      const dz = p.getZ(i) - cz;
      const k = PANE_LOW + PANE_CORE * Math.exp(-(dx * dx + dz * dz) / (PANE_CORE_R * PANE_CORE_R));
      c.setXYZ(i, k, k * 1.02, k * 0.94);
    }
    c.needsUpdate = true;
  }

  private buildSyringe(): void {
    const { kit } = this;
    this.rig = new Group();
    this.root.add(this.rig);
    kit.prop('syringe', [0, -NEEDLE_LEN + 0.05, 0], { scale: SYRINGE_SCALE, anchor: 'top' }, this.rig);
    // the needle itself: longer than any needle should be, a hair of light
    const needle = new Loft();
    needle.sweep([[0, -NEEDLE_LEN, 0], [0, -NEEDLE_LEN * 0.5, 0], [0, 0, 0]], 16, 6, (s) => 0.00092 * Math.min(1, (1 - s) * 30 + 0.02), () => [1, 1, 1]);
    this.rig.add(new Mesh(needle.geometry(), new MeshBasicMaterial({ fog: false, color: new Color(2.4, 2.5, 2.5) })));
    this.rigHand = new Mesh(handGeometry(HAND_GRIP), this.latexDark);
    this.seat(this.rigHand, GRIP_POINT, new Vector3(0, -NEEDLE_LEN - 0.12, 0), new Vector3(0, 0.643, 0.766), new Vector3(0, -0.766, 0.643));
    this.rigHandRest.copy(this.rigHand.position);
    this.rig.add(this.rigHand);

    const from: V3 = [TRAY_HOME + SYRINGE_X, PANE_Y - 0.012, SYRINGE_TIP_Z - 0.05];
    const hold = basis(HOLD_PITCH, HOLD_YAW, HOLD_ROLL);
    const tip = this.eyeChair.clone().addScaledVector(hold.f, NEEDLE_GAP).addScaledVector(hold.r, 0.0015).addScaledVector(hold.u, 0.001);
    const dir = hold.f.clone().multiplyScalar(-1).addScaledVector(hold.r, -0.62).addScaledVector(hold.u, -0.46).normalize();
    const rows = [
      [SYRINGE_TAKEN, from[0], from[1], from[2], 0, 0, -1],
      [SYRINGE_TAKEN + 0.9, 0.3, 1.4, -0.12, -0.2, -0.1, -0.97],
      [SHOWN, 0.17, 1.4, 0.02, -0.65, 0.18, 0.74],
      [NEEDLE_DOWN, 0.16, 1.395, 0.02, -0.64, 0.16, 0.75],
      [NEEDLE_DOWN + 2.3, 0.075, 1.25, -0.012, -0.35, -0.72, 0.55],
      [NEEDLE_AT, tip.x, tip.y, tip.z, dir.x, dir.y, dir.z],
      [NEEDLE_AWAY, tip.x, tip.y, tip.z, dir.x, dir.y, dir.z],
      [JOLT - 0.1, 0.02, 1.02, -0.34, -0.05, -0.75, -0.35],
    ];
    const at = rows.map((row) => row[0]);
    for (let c = 1; c <= 6; c++) this.rigTracks.push(new GlideTrack(at, rows.map((row) => row[c])));

    const dropTexture = canvasTexture(128, 128, (c, w) => {
      c.clearRect(0, 0, w, w);
      // water on glass: nothing at the rim but a bright crescent below and a dark one above
      c.save();
      c.beginPath();
      c.arc(w / 2, w / 2, w * 0.46, 0, TWO_PI);
      c.clip();
      let g = c.createLinearGradient(0, 0, 0, w);
      g.addColorStop(0, 'rgba(10,16,14,0.42)');
      g.addColorStop(0.45, 'rgba(120,140,132,0.05)');
      g.addColorStop(1, 'rgba(240,250,240,0.5)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, w);
      g = c.createRadialGradient(w * 0.5, w * 0.74, 0, w * 0.5, w * 0.74, w * 0.2);
      g.addColorStop(0, 'rgba(255,255,245,0.9)');
      g.addColorStop(1, 'rgba(255,255,245,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, w);
      c.restore();
      c.fillStyle = 'rgba(255,255,255,0.8)';
      c.beginPath();
      c.arc(w * 0.38, w * 0.32, w * 0.035, 0, TWO_PI);
      c.fill();
    });
    this.dropMaterial = new MeshBasicMaterial({ map: dropTexture, transparent: true, fog: false, color: new Color(2.4, 2.4, 2.4) });
    this.tipDrop = new Mesh(new PlaneGeometry(1, 1), this.dropMaterial);
    this.tipDrop.visible = false;
    this.tipDrop.frustumCulled = false;
    this.tipDrop.renderOrder = 6;
    this.root.add(this.tipDrop);
  }

  /** Puts a hand so that its `grip` point lies at `at`, the fingers closed around `axis`, the arm going away toward `elbow`. */
  private seat(hand: Mesh, grip: V3, at: Vector3, axis: Vector3, elbow: Vector3): Vector3 {
    const X = axis.clone().normalize();
    const Y = elbow.clone().addScaledVector(X, -elbow.dot(X)).normalize().multiplyScalar(-1);
    const Z = new Vector3().crossVectors(X, Y);
    hand.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(X, Y, Z));
    const sx = hand.scale.x;
    const offset = new Vector3()
      .addScaledVector(X, grip[0] * sx)
      .addScaledVector(Y, grip[1])
      .addScaledVector(Z, grip[2])
      .multiplyScalar(-1);
    hand.position.copy(at).add(offset);
    return offset;
  }

  private buildNurse(): void {
    const g = handGeometry(HAND_HOLD);
    const place = (hand: Mesh, side: number) => {
      const Y = new Vector3(side * -0.22, -0.95, -0.2).normalize();
      const Z = new Vector3(side * -0.95, 0.2, 0.1).normalize();
      Z.addScaledVector(Y, -Z.dot(Y)).normalize();
      const X = new Vector3().crossVectors(Y, Z);
      hand.scale.x = side;
      hand.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(X, Y, Z));
      this.chairSet.add(hand);
    };
    this.nurseR = new Mesh(g, this.latex);
    this.nurseL = new Mesh(g, this.latex);
    place(this.nurseR, 1);
    place(this.nurseL, -1);
    this.hoseA = new Mesh(this.hoseGeometry([[0.34, -0.2, -0.22], [0.21, -0.125, -0.17], [0.125, -0.075, -0.135], [0.055, -0.06, -0.118], [0, -0.068, -0.11]]), this.latex);
    this.chairSet.add(this.hoseA);
  }

  private hoseGeometry(points: readonly V3[]): BufferGeometry {
    const loft = new Loft();
    const ribs = (s: number) => 0.5 + 0.5 * Math.sin(s * 300);
    loft.sweep(
      points,
      120,
      10,
      (s) => 0.0085 * (1 + 0.1 * ribs(s)) * (s > 0.985 ? 0.55 : 1),
      (s) => {
        const k = 0.5 + 0.25 * ribs(s);
        return s > 0.9 ? [0.6, 0.62, 0.58] : [k, k * 1.02, k * 0.96];
      },
    );
    return loft.geometry();
  }

  private buildHeads(): void {
    const skin = new MeshStandardMaterial({ color: 0xc8c2b4, roughness: 0.55, emissive: 0x1c1a16 });
    const cloth = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: DoubleSide });
    this.dentistHead = new MaskedHead(this.kit, skin, cloth, this.latex, { cap: [0.26, 0.34, 0.3], mask: [0.64, 0.72, 0.68], mirror: true, seed: 1 });
    this.nurseHead = new MaskedHead(this.kit, skin, cloth, this.latex, { cap: [0.34, 0.4, 0.36], mask: [0.8, 0.86, 0.82], mirror: false, seed: 3.1 });
    this.root.add(this.dentistHead.root);
    this.root.add(this.nurseHead.root);
    this.maskHand = new Mesh(handGeometry(HAND_HOOK), this.latex);
    this.maskHand.rotation.y = Math.PI;
    this.maskHand.visible = false;
    this.dentistHead.root.add(this.maskHand);
  }

  private buildMouth(): void {
    const { kit, mouthSet: m } = this;
    const flesh = kit.surface('flesh_smeared', 0.16, { color: new Color(0x3a1315), roughness: 0.36 });
    const rings = 52;
    const around = 84;
    const at = [0, 0.14, 0.5, 0.8, 0.9, 0.955, 1];
    const zTrack = new GlideTrack(at, [0.07, 0.03, -0.13, -0.225, -0.255, -0.275, -0.305]);
    const rx = new GlideTrack(at, [0.02, 0.16, 0.21, 0.215, 0.205, 0.19, 0.24]);
    const ry = new GlideTrack(at, [0.02, 0.13, 0.17, 0.165, 0.15, 0.135, 0.18]);
    const n = (rings + 1) * (around + 1);
    const p = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    let w = 0;
    for (let j = 0; j <= rings; j++) {
      const v = j / rings;
      const calm = 1 - range(0.78, 0.93, v);
      for (let i = 0; i <= around; i++) {
        const a = (i / around) * TWO_PI;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const lump = 1 + (0.045 * Math.sin(a * 3 + v * 9 + 1) * Math.sin(v * 13) + 0.012 * Math.sin(a * 7 + v * 21)) * calm;
        const ridge = sa > 0 ? 0.03 * sa * sa * Math.sin(v * 84) * (v > 0.3 && v < 0.82 ? 1 : 0) : 0;
        const k = lump - ridge;
        p[w * 3] = Math.sign(ca) * Math.abs(ca) ** 0.85 * rx.at(v) * k;
        p[w * 3 + 1] = Math.sign(sa) * Math.abs(sa) ** 0.85 * ry.at(v) * k;
        p[w * 3 + 2] = zTrack.at(v);
        uv[w * 2] = a * 0.16;
        uv[w * 2 + 1] = v * 0.4;
        w++;
      }
    }
    const ix: number[] = [];
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < around; i++) {
        const a = j * (around + 1) + i;
        const b = a + 1;
        const c = a + around + 1;
        const d = c + 1;
        ix.push(a, b, c, b, d, c);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(p, 3));
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    g.setIndex(ix);
    g.computeVertexNormals();
    const cave = new Mesh(g, flesh);
    cave.frustumCulled = false;
    m.add(cave);

    const tongueGeometry = new SphereGeometry(1, 56, 36);
    const tp = tongueGeometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < tp.count; i++) {
      const x = tp.getX(i);
      const y = tp.getY(i);
      const groove = y > 0 ? 0.09 * Math.exp(-(x * x) / 0.03) : 0;
      tp.setXYZ(i, x * (1 + 0.02 * Math.sin(y * 19)), y * (1 - groove), tp.getZ(i));
    }
    tongueGeometry.computeVertexNormals();
    const tongue = new Mesh(tongueGeometry, kit.surface('flesh_smeared', 0.3, { color: new Color(0x22090b), roughness: 0.42 }));
    tongue.scale.set(0.11, 0.07, 0.2);
    tongue.position.set(0, -0.155, -0.13);
    tongue.frustumCulled = false;
    m.add(tongue);

    const enamel = new MeshStandardMaterial({ vertexColors: true, roughness: 0.25 });
    const slot = new Vector3();
    const upper = new Group();
    upper.position.set(0, UPPER_Y, ARCH_BACK);
    upper.rotation.x = UPPER_TILT;
    const upperTeeth = new Mesh(archGeometry(11, PULLED_TOOTH, slot), enamel);
    upperTeeth.frustumCulled = false;
    upper.add(upperTeeth);
    m.add(upper);
    const lower = new Group();
    lower.position.set(0, LOWER_Y, ARCH_BACK);
    lower.rotation.x = -LOWER_TILT;
    lower.scale.y = -1;
    const lowerTeeth = new Mesh(archGeometry(29, -1, new Vector3()), enamel);
    lowerTeeth.frustumCulled = false;
    lower.add(lowerTeeth);
    m.add(lower);

    upper.updateMatrix();
    this.molarAt.set(slot.x, 0.026, slot.z).applyMatrix4(upper.matrix);
    this.burrAt.set(slot.x + 0.004, -0.004, slot.z + 0.004).applyMatrix4(upper.matrix);
    this.molar = new Group();
    this.molar.position.copy(this.molarAt);
    this.molar.rotation.set(Math.PI + UPPER_TILT, 0, 0);
    const realMolar = kit.prop('molar', [0, 0, 0], { scale: MOLAR_SCALE, anchor: 'center' }, this.molar);
    kit.paint(realMolar, new MeshStandardMaterial({ color: 0xd9ccb0, roughness: 0.28 }));
    realMolar.traverse((c) => {
      c.frustumCulled = false;
    });
    m.add(this.molar);

    this.socket = new Mesh(new SphereGeometry(1, 20, 14), new MeshStandardMaterial({ color: 0x0c0304, roughness: 0.2 }));
    this.socket.scale.set(0.021, 0.018, 0.021);
    this.socket.position.set(slot.x, 0.02, slot.z);
    this.socket.visible = false;
    upper.add(this.socket);
  }

  private buildTools(): void {
    const { kit, mouthSet: m, build: b } = this;
    const burr = this.burrAt;
    // the tools lean in from the middle of the opening
    const out = new Vector3(0.05, -0.03, -0.42).sub(burr).normalize();
    this.toolAxis.copy(out);
    this.burrFrom.copy(burr).addScaledVector(out, 0.55);

    const tool = (axisBack: Vector3, flip: number): Group => {
      const rig = new Group();
      const Z = axisBack.clone().multiplyScalar(-1);
      const Y = new Vector3(0, flip, 0).addScaledVector(Z, -flip * Z.y).normalize();
      const X = new Vector3().crossVectors(Y, Z);
      rig.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(X, Y, Z));
      m.add(rig);
      return rig;
    };

    this.drillRig = tool(out, -1);
    const drill = kit.prop('dental_drill', [0, 0, 0], { scale: 1.5, anchor: 'center' }, this.drillRig);
    drill.updateWorldMatrix(true, true);
    let steel: Mesh | null = null;
    drill.traverse((c) => {
      const mesh = c as Mesh;
      if (mesh.isMesh && (mesh.material as Material).name.includes('steel')) steel = mesh;
      c.frustumCulled = false;
    });
    const box = new Box3().setFromObject(steel ?? drill);
    const invert = new Matrix4().copy(this.drillRig.matrixWorld).invert();
    this.drillRig.updateWorldMatrix(true, false);
    invert.copy(this.drillRig.matrixWorld).invert();
    const nose = new Vector3((box.min.x + box.max.x) / 2, box.min.y, box.max.z - 0.012).applyMatrix4(invert);
    drill.position.sub(nose);
    const drillHand = new Mesh(handGeometry(HAND_GRIP), this.latexDark);
    const elbow = new Vector3(0.5, 0.75, -0.45).applyQuaternion(this.drillRig.quaternion.clone().invert());
    this.seat(drillHand, GRIP_POINT, new Vector3(0, -0.01, -0.3), new Vector3(0, 0, 1), elbow);
    this.drillRig.add(drillHand);
    this.drillRig.visible = false;

    this.contactGlow = b.glow(burr.x, burr.y, burr.z, 0.08, 0xfff8ec, 1.1, m, 2.2);
    this.contactGlow.visible = false;

    this.forcepsRig = tool(out, 1);
    // extraction forceps: two long steel arms crossing at a pivot, the beaks short and curved
    const arms = new Loft();
    for (const side of [1, -1]) {
      arms.sweep([[side * 0.0085, 0, 0.004], [side * 0.0075, 0, -0.02], [side * 0.002, 0, -0.058], [side * -0.012, 0, -0.16], [side * -0.024, 0, -0.33]], 44, 8, (s) => lerp(0.0032, 0.0052, Math.min(1, s * 3)) * (s > 0.97 ? 0.6 : 1), () => [0.5, 0.53, 0.5], { squash: 0.75 });
    }
    const forceps = new Mesh(arms.geometry(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.55 }));
    forceps.frustumCulled = false;
    this.forcepsRig.add(forceps);
    const forcepsHand = new Mesh(handGeometry(HAND_GRIP), this.latexDark);
    const forcepsElbow = new Vector3(0.55, 0.7, -0.45).applyQuaternion(this.forcepsRig.quaternion.clone().invert());
    this.seat(forcepsHand, GRIP_POINT, new Vector3(0, 0, -0.29), new Vector3(0, 0, 1), forcepsElbow);
    this.forcepsRig.add(forcepsHand);
    this.forcepsRig.visible = false;

    this.hair = new WetHair();
    this.hair.mesh.visible = false;
    m.add(this.hair.mesh);
    const pinch = handGeometry(HAND_PINCH);
    const rope = new Vector3(0.03, 0.26, -1).normalize();
    this.haulA = new Mesh(pinch, this.latexDark);
    this.haulOffsetA.copy(this.seat(this.haulA, PINCH_POINT, new Vector3(), rope, new Vector3(0.72, 0.5, -0.5)));
    this.haulB = new Mesh(pinch, this.latexDark);
    this.haulB.scale.x = -1;
    this.haulOffsetB.copy(this.seat(this.haulB, PINCH_POINT, new Vector3(), rope, new Vector3(-0.72, 0.42, -0.5)));
    this.haulA.visible = this.haulB.visible = false;
    m.add(this.haulA);
    m.add(this.haulB);
  }

  private buildLensLife(): void {
    const rnd = seeded(77);
    this.lensDrops = new InstancedMesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: this.dropMaterial.map, transparent: true, depthWrite: false, depthTest: false, fog: false, color: new Color(1.4, 1.4, 1.4) }), LENS_DROPS);
    this.lensDrops.frustumCulled = false;
    this.lensDrops.renderOrder = 880;
    this.lensDrops.count = 0;
    this.lens.add(this.lensDrops);
    this.dropSeed = new Float32Array(LENS_DROPS * 5);
    for (let i = 0; i < LENS_DROPS; i++) {
      const k = i * 5;
      this.dropSeed[k] = (rnd() - 0.5) * 0.17;
      this.dropSeed[k + 1] = (rnd() - 0.5) * 0.094;
      this.dropSeed[k + 2] = 0.0006 + rnd() ** 3 * 0.0034;
      this.dropSeed[k + 3] = lerp(DRILL_BITES + 0.3, DRILL_LEAVES, rnd() ** 0.8);
      this.dropSeed[k + 4] = 0.0004 + rnd() * rnd() * 0.0065;
    }

    const dot = canvasTexture(32, 32, (c, w) => {
      const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, w);
    });
    const geometry = new BufferGeometry();
    this.dustAttr = new BufferAttribute(new Float32Array(DUST * 3), 3);
    this.dustAttr.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', this.dustAttr);
    this.dust = new Points(geometry, new PointsMaterial({ map: dot, size: 0.0045, sizeAttenuation: true, transparent: true, depthWrite: false, fog: false, color: new Color(1.5, 1.5, 1.45) }));
    this.dust.frustumCulled = false;
    this.dust.visible = false;
    this.mouthSet.add(this.dust);
    this.dustSeed = new Float32Array(DUST * 4);
    for (let i = 0; i < DUST; i++) {
      const k = i * 4;
      this.dustSeed[k] = rnd();
      this.dustSeed[k + 1] = (rnd() - 0.35) * 0.42;
      this.dustSeed[k + 2] = (rnd() - 0.6) * 0.28;
      this.dustSeed[k + 3] = 0.6 + rnd() * 1.1;
    }

    this.lidMesh = new Mesh(new PlaneGeometry(1, 1), new ShaderMaterial({ vertexShader: LID_VERT, fragmentShader: LID_FRAG, uniforms: this.lid, transparent: true, depthWrite: false, depthTest: false }));
    this.lidMesh.renderOrder = 900;
    this.lidMesh.frustumCulled = false;
    this.lens.add(this.lidMesh);
  }

  /** What is said and heard, once each, as time reaches it. */
  private score(): void {
    const s = this.sound;
    this.beat(0, () => {
      this.tone = s.bed('rooms/dental_room_tone.mp3', { gain: 0.3 });
      this.hum = s.bed('rooms/bulb_hum.mp3', { gain: 0.08 });
      this.drone = s.bed('rooms/dream_drone_low.mp3', { gain: 0.1, fade: 6 });
      this.breath = s.bed('rooms/breath_calm.mp3', { gain: 0.1, fade: 2 });
      s.play('rooms/chair_motor.mp3', { gain: 0.3 });
    });
    // the dentist speaks in the dream's whisper
    this.beat(LINE_OPEN, () => this.say({ tr: 'Açık tut. Birazdan geçer.', en: 'Keep it open. It will pass.' }, 5, 'dream'));
    this.beat(3.2, () => s.play('rooms/gloves_on.mp3', { gain: 0.4, pan: 0.15 }));
    this.beat(NURSE_ON[1] - 0.1, () => s.play('rooms/glove_snap.mp3', { gain: 0.3, pan: -0.35 }));
    this.beat(8, () => s.play('rooms/suction_air.mp3', { gain: 0.25, pan: 0.35 }));
    this.beat(9.6, () => {
      this.suction = s.bed('rooms/suction_patient.mp3', { gain: 0.2, fade: 0.8 });
      s.play('rooms/suction_gulp.mp3', { gain: 0.3, pan: 0.25 });
    });
    this.beat(12.8, () => s.play('rooms/suction_loud.mp3', { gain: 0.3, pan: 0.25 }));
    this.beat(14.6, () => this.suction?.gain(0, 0.5));
    this.beat(TRAY_IN, () => s.play('rooms/tray_slide.mp3', { gain: 0.3, pan: 0.6 }));
    this.beat(TRAY_IN + 1.5, () => s.play('rooms/tray_metal_1.mp3', { gain: 0.3, pan: 0.55, reverb: 0.1 }));
    this.beat(SYRINGE_TAKEN - 0.1, () => s.play('rooms/tray_metal_4.mp3', { gain: 0.3, pan: 0.5, reverb: 0.1 }));
    this.beat(NEEDLE_DOWN, () => s.play('rooms/tray_slide.mp3', { gain: 0.14, pan: 0.6, lowpass: 2400 }));
    this.beat(SHOWN - 0.3, () => s.play('rooms/syringe_flick.mp3', { gain: 0.26, pan: 0.15, duration: 1.6 }));
    this.beat(NEEDLE_DOWN - 0.3, () => {
      s.play('rooms/breath_in.mp3', { gain: 0.22 });
      this.breath?.gain(0, 1.2);
      this.glass = s.bed('rooms/dream_drone_glass.mp3', { gain: 0.05, fade: 3.5 });
    });
    this.beat(NEEDLE_AT - 0.4, () => {
      this.tone?.gain(0.05, 0.9);
      this.hum?.gain(0.02, 0.9);
      this.drone?.gain(0.03, 0.9);
    });
    this.beat(NEEDLE_AT + 1.1, () => s.play('rooms/heart_beat.mp3', { gain: 0.32 }));
    this.beat(NEEDLE_AT + 2.3, () => s.play('rooms/heart_beat.mp3', { gain: 0.34 }));
    this.beat(JOLT - 0.3, () => s.play('rooms/needle_skin.mp3', { gain: 0.3 }));
    this.beat(JOLT, () => {
      s.play('rooms/numb_jolt.mp3', { gain: 0.5 });
      this.glass?.gain(0, 0.2);
      this.tone?.gain(0, 0.3);
      this.hum?.gain(0, 0.3);
      this.drone?.gain(0, 0.6);
    });
    this.beat(CUT, () => {
      this.muffled = s.bed('rooms/dental_room_tone.mp3', { gain: 0.2, lowpass: 1500, fade: 1.6 });
      this.drillLow = s.bed('rooms/drill_low.mp3', { gain: 0.03, pan: -0.25, lowpass: 2600 });
      this.drillLow.gain(0.14, 4.5);
    });
    this.beat(BLINK_OPEN + 0.8, () => {
      this.suction?.gain(0.18, 1.2);
      s.play('rooms/mouth_wet_1.mp3', { gain: 0.26 });
    });
    this.beat(35.4, () => s.play('rooms/mouth_wet_3.mp3', { gain: 0.24, pan: 0.2 }));
    this.beat(DRILL_ENTERS, () => {
      this.drillLow?.gain(0, 0.5);
      this.suction?.gain(0.05, 1);
      s.play('rooms/drill_start.mp3', { gain: 0.17, pan: -0.15, duration: 3.1 });
    });
    this.beat(DRILL_ENTERS + 2.4, () => {
      this.drillHigh = s.bed('rooms/drill_high.mp3', { gain: 0.1, pan: -0.35, fade: 0.6 });
    });
    this.beat(DRILL_BITES, () => {
      this.drillHigh?.gain(0.05, 0.2);
      this.drillBite = s.bed('rooms/drill_bite.mp3', { gain: 0.2, pan: -0.45, fade: 0.12 });
      s.play('rooms/spray_hiss.mp3', { gain: 0.2, pan: -0.3 });
    });
    this.beat(DRILL_BITES + 3.6, () => s.play('rooms/spray_hiss.mp3', { gain: 0.16, pan: -0.3 }));
    this.beat(DRILL_BITES + 3.9, () => s.play('rooms/drill_stabs.mp3', { gain: 0.15, pan: -0.45, duration: 2.5 }));
    this.beat(DRILL_LEAVES, () => {
      this.drillBite?.gain(0, 0.1);
      this.drillHigh?.gain(0, 0.1);
      this.suction?.gain(0, 0.2);
      this.muffled?.gain(0.04, 0.3);
      s.play('rooms/drill_spool_down.mp3', { gain: 0.2, pan: -0.3 });
    });
    this.beat(FORCEPS_IN - 0.2, () => s.play('rooms/tray_metal_3.mp3', { gain: 0.22, pan: 0.5, reverb: 0.1, lowpass: 2800 }));
    this.beat(FORCEPS_GRIP - 0.45, () => s.play('rooms/tooth_tap_1.mp3', { gain: 0.5, pan: -0.4 }));
    this.beat(FORCEPS_GRIP - 0.12, () => s.play('rooms/tooth_tap_2.mp3', { gain: 0.5, pan: -0.4 }));
    this.beat(FORCEPS_GRIP + 0.1, () => s.play('rooms/tooth_tap_3.mp3', { gain: 0.6, pan: -0.45 }));
    this.beat(CRACK - 4.4, () => s.play('rooms/tooth_pull.mp3', { gain: 0.55, pan: -0.25, offset: 4 }));
    this.beat(CRACK, () => s.play('rooms/bone_crack_2.mp3', { gain: 0.5, pan: -0.35 }));
    this.beat(CRACK + 0.6, () => {
      this.hairVoice = s.bed('rooms/hair_pull_wet.mp3', { gain: 0.35, fade: 0.3, offset: 0 });
      s.play('rooms/mouth_wet_5.mp3', { gain: 0.28 });
    });
    this.beat(HANDS_HAUL + 0.05, () => s.play('rooms/hair_pull_1.mp3', { gain: 0.34 }));
    this.beat(HANDS_HAUL + 1.1, () => s.play('rooms/hair_pull_2.mp3', { gain: 0.3 }));
    this.beat(SHUTTER, () => this.shutter());
    this.beat(LEANS, () => {
      this.hairVoice?.gain(0.1, 1.2);
      this.muffled?.gain(0, 1.5);
    });
    this.beat(LINE_ONE_MORE, () => {
      this.hairVoice?.gain(0, 0.4);
      this.say({ tr: 'Bir tane daha.', en: 'One more.' }, 4.5, 'dream');
    });
    this.beat(LINE_ONE_MORE + 0.4, () => s.bed('rooms/machine_breathing.mp3', { gain: 0.1, reverb: 0.2, fade: 1.2 }));
    this.beat(62, () => s.bed('rooms/drill_low.mp3', { gain: 0.08, lowpass: 3000, fade: 1.8 }));
    this.beat(THE_CUT, () => s.stopAll(0.03));
  }

  prepare(camera: PerspectiveCamera): void {
    this.lid.uAspect.value = camera.aspect;
  }

  /** The shiver of the drill and of the pull: pure in time, gentle under reduced motion. */
  private tremor(s: number): number {
    const bite = range(DRILL_BITES - 0.1, DRILL_BITES + 0.2, s) * (1 - range(DRILL_LEAVES - 0.15, DRILL_LEAVES + 0.05, s));
    const pull = 0.4 * range(FORCEPS_GRIP + 0.2, CRACK, s) * (s < CRACK ? 1 : 0);
    return Math.max(bite, pull) * (REDUCED_MOTION ? 0.15 : 1);
  }

  /** The eye's small movements, on top of the keys. */
  pose(t: number, out: RoomPose): RoomPose {
    super.pose(t, out);
    const s = t * this.seconds;
    out.yaw += this.heldYaw - this.gazeYaw;
    out.pitch += this.heldPitch - this.gazePitch;
    const a = this.tremor(s);
    if (a > 0) {
      out.yaw += a * (Math.sin(s * 197) + 0.6 * Math.sin(s * 313 + 1)) * TREMOR;
      out.pitch += a * (Math.sin(s * 163 + 2) + 0.6 * Math.sin(s * 271)) * TREMOR;
      out.roll += a * Math.sin(s * 229 + 4) * TREMOR * 0.6;
    }
    if (s > JOLT && s < CUT) {
      const since = s - JOLT;
      const k = REDUCED_MOTION ? 0.3 : 1;
      out.roll += k * Math.exp(-since * 3.2) * Math.sin(since * 9) * 0.05;
      out.yaw += k * smootherstep(range(0, 2.5, since)) * Math.sin(since * 0.9) * 0.018;
    }
    if (s > CRACK && s < CRACK + 0.8 && !REDUCED_MOTION) out.pitch += Math.exp(-(s - CRACK) * 7) * 0.02;
    return out;
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    this.gazeYaw = frame.input.gazeYaw;
    this.gazePitch = frame.input.gazePitch;
    this.heldYaw = LOOK_LIMIT * Math.tanh(this.gazeYaw / LOOK_LIMIT);
    this.heldPitch = LOOK_LIMIT * Math.tanh(this.gazePitch / LOOK_LIMIT);
    const a = this.tremor(s);
    this.held.rotation.set(-this.heldPitch, -this.heldYaw, 0);
    this.held.position.set(a * TREMOR_NEAR * Math.sin(s * 241), a * TREMOR_NEAR * Math.sin(s * 173 + 2), 0);
    for (let i = 0; i < this.motes.length; i++) this.motes[i].value = frame.time;

    const inChair = s < CUT;
    this.chairSet.visible = inChair;
    this.mouthSet.visible = !inChair;
    this.tray.visible = inChair;
    this.rig.visible = inChair && s < JOLT;
    this.watchersLate.visible = s >= EARLY_BLINK;
    this.updateAir(s);
    this.updateLids(s);
    this.updateHeads(s, frame.time);
    if (inChair) this.updateChair(s);
    else this.updateMouth(s);
  }

  private updateAir(s: number): void {
    const numb = smootherstep(range(JOLT, JOLT + 2.4, s));
    const g = this.air.grade;
    const inChair = s < CUT;
    const f = this.film;
    this.black = s >= THE_CUT ? 1 : 0;
    this.white = s > CRACK && s < CRACK + 0.14 ? (REDUCED_MOTION ? 0.1 : 0.34) * (1 - (s - CRACK) / 0.14) : 0;
    if (inChair) {
      g.saturation = lerp(SATURATION, SATURATION_NUMB, numb);
      g.exposure = 1.12;
      f.ghost = numb * (REDUCED_MOTION ? 0.25 : 0.72);
      f.aberration = numb * 0.016;
      f.bloom = lerp(1.25, 1.6, numb);
      const near = smootherstep(range(NEEDLE_DOWN, NEEDLE_AT, s));
      this.focus = lerp(1, NEEDLE_GAP, near);
      this.aperture = lerp(lerp(APERTURE, 1.4, near), 6, numb);
      this.fear = clamp(0.24 + 0.4 * range(TRAY_IN, NEEDLE_AT, s) + 0.28 * range(NEEDLE_AT, NEEDLE_AWAY, s) - 0.5 * numb, 0, 1);
      // as the needle arrives the room goes away: only the lamp and the needle are left
      const hush = smootherstep(range(NEEDLE_DOWN + 1, NEEDLE_AT, s)) * (1 - smootherstep(range(NEEDLE_AWAY, JOLT, s)));
      const dim = 1 - 0.7 * hush;
      this.fill.intensity = 0.6 * dim;
      this.fillSpot.intensity = 6 * dim;
      this.spill.intensity = 3.6 * dim;
      this.skyMaterial.color.setRGB(1.7 * dim, 1.85 * dim, 1.75 * dim);
      const power = LAMP_POWER * (1 - 0.3 * hush);
      this.lampFace.color.setRGB(power, power, power * 0.95);
      this.mouthLight.intensity = 0;
      this.throatLight.intensity = 0;
      this.ghostLamp.visible = numb > 0.01;
      if (this.ghostLamp.visible) {
        const apart = numb * 0.1;
        this.ghostLamp.position.set(LAMP[0] + apart * (1.2 + 0.5 * Math.sin(s * 0.7)), LAMP[1], LAMP[2] + apart * 0.4 * Math.cos(s * 0.5));
        this.ghostFace.opacity = 0.8 * numb;
      }
    } else {
      const open = smootherstep(range(BLINK_OPEN, BLINK_OPEN + 1.4, s));
      g.saturation = lerp(0.2, 0.72, open);
      g.exposure = 1.2;
      f.ghost = lerp(0.3, 0, open);
      f.aberration = lerp(0.008, 0.0015, open);
      f.bloom = 1;
      this.focus = 0.62;
      this.aperture = 1;
      const pull = range(FORCEPS_GRIP, CRACK, s);
      this.fear = clamp(0.55 + 0.25 * range(DRILL_ENTERS, DRILL_BITES, s) + 0.15 * pull - 0.3 * range(LEANS, MASK_TO, s), 0, 1);
      this.ghostLamp.visible = false;
      this.skyMaterial.color.setRGB(1.7, 1.85, 1.75);
      this.fill.intensity = 0.2;
      this.fillSpot.intensity = 2 + 2.2 * smootherstep(range(LEANS, LEANED, s));
      this.spill.intensity = 2.2;
      const eclipse = 1 - 0.7 * smootherstep(range(LEANS, LEANED, s));
      this.mouthLight.intensity = 0.09 * eclipse;
      this.throatLight.intensity = 0.012;
    }
  }

  private updateLids(s: number): void {
    let open = smootherstep(range(0, 0.8, s));
    const blink = 1 - smootherstep(range(EARLY_BLINK - 0.3, EARLY_BLINK, s)) * (1 - smootherstep(range(EARLY_BLINK + 0.05, EARLY_BLINK + 0.45, s)));
    open = Math.min(open, blink);
    if (s > NEEDLE_DOWN + 2 && s < JOLT + 1) {
      // the lid wants to come down, and cannot
      const strain = range(NEEDLE_DOWN + 2, NEEDLE_AT, s) * (1 - range(JOLT, JOLT + 1, s));
      open = Math.min(open, 1 - strain * (0.085 + 0.025 * wobble(s * 3.1, 7) ** 2));
    }
    if (s >= JOLT && s < CUT) open = Math.min(open, 1 - 0.05 * smootherstep(range(JOLT, JOLT + 2, s)));
    if (s >= BLINK_SHUT && s < CUT) open = Math.min(open, 1 - smootherstep(range(BLINK_SHUT, CUT - 0.1, s)));
    if (s >= CUT) open = smootherstep(range(BLINK_OPEN, BLINK_OPEN + 1.3, s));
    this.lid.uOpen.value = open;
    this.lidMesh.visible = open < 0.999 || s < CUT;
  }

  private aimHead(head: MaskedHead, x: number, y: number, z: number, eye: Vector3, ux: number, uy: number, uz: number): void {
    head.root.position.set(x, y, z);
    this.v.set(x, y, z);
    this.w.set(ux, uy, uz);
    this.m.lookAt(eye, this.v, this.w);
    head.root.quaternion.setFromRotationMatrix(this.m);
  }

  private updateHeads(s: number, time: number): void {
    const d = this.dentistHead;
    const n = this.nurseHead;
    const breathe = Math.sin(time * 1.1) * 0.0012;
    if (s < CUT) {
      n.root.visible = false;
      const come = smootherstep(range(0.5, 15, s));
      const back = smootherstep(range(JOLT, JOLT + 2.2, s));
      const x = lerp(lerp(-0.05, -0.24, come), -0.32, back);
      const y = lerp(lerp(1.43, 1.46, come), 1.5, back) + breathe;
      const z = lerp(lerp(0.205, 0.11, come), 0.2, back);
      this.aimHead(d, x, y, z, this.eyeChair, lerp(0.15, 0.9, come), 0.25, lerp(-1, -0.35, come));
    } else {
      n.root.visible = true;
      const { r, u } = this.mouthBasis;
      const lean = smootherstep(range(LEANS, LEANED, s));
      this.v.lerpVectors(this.dentistFar, this.dentistNear, lean);
      const px = this.v.x;
      const py = this.v.y + breathe;
      const pz = this.v.z;
      const psi = lerp(-34.7, 82, lean) * DEG;
      const c = Math.cos(psi);
      const sn = Math.sin(psi);
      this.aimHead(d, px, py, pz, this.eyeMouth, r.x * c + u.x * sn, r.y * c + u.y * sn, r.z * c + u.z * sn);
      const npsi = 157.6 * DEG;
      const nc = Math.cos(npsi);
      const ns = Math.sin(npsi);
      this.aimHead(n, this.nursePlace.x, this.nursePlace.y - breathe, this.nursePlace.z, this.eyeMouth, r.x * nc + u.x * ns, r.y * nc + u.y * ns, r.z * nc + u.z * ns);

      // the hand comes up, hooks the top of the mask, and draws it down: and under it, the other
      const hookIn = smootherstep(range(MASK_FROM - 0.8, MASK_FROM, s));
      const down = smootherstep(range(MASK_FROM, MASK_TO, s));
      d.under.visible = s >= LEANS;
      d.bend(down * MASK_FOLD);
      this.maskHand.visible = hookIn > 0 && s < THE_CUT;
      if (this.maskHand.visible) {
        const leave = smootherstep(range(MASK_TO + 0.4, MASK_TO + 1.4, s));
        this.maskHand.position.set(d.hook.x + HOOK_POINT[0], d.hook.y - HOOK_POINT[1] - (1 - hookIn) * 0.28 - leave * 0.34, d.hook.z + HOOK_POINT[2] + (1 - hookIn) * 0.1 + leave * 0.1);
      }
      if (s >= MASK_TO) d.under.scale.z = 1 + 0.018 * Math.sin((s - MASK_TO) * 4.45);
    }
  }

  private updateChair(s: number): void {
    const slide = smootherstep(range(TRAY_IN, TRAY_IN + TRAY_TIME, s)) - smootherstep(range(NEEDLE_DOWN, NEEDLE_DOWN + 1.5, s));
    const trayX = lerp(TRAY_PARKED, TRAY_HOME, slide);
    this.tray.position.x = trayX;
    if (trayX !== this.litAt) {
      this.litAt = trayX;
      this.lightPane(trayX);
    }

    const on = smootherstep(range(NURSE_ON[0], NURSE_ON[1], s));
    const away = smootherstep(range(BLINK_SHUT - 0.6, CUT, s));
    const reach = 1 - on + away;
    const press = Math.sin(clamp((s - NURSE_ON[1] + 0.25) / 0.25, 0, 1) * Math.PI) * 0.004;
    this.nurseR.position.set(0.262 + reach * 0.13 - press, 0.14 + reach * 0.15, -0.172 + reach * 0.03);
    this.nurseL.position.set(-0.262 - reach * 0.13 + press, 0.14 + reach * 0.15, -0.172 + reach * 0.03);

    const hoseIn = smootherstep(range(SUCTION_ON[0], SUCTION_ON[0] + 1.5, s)) * (1 - smootherstep(range(SUCTION_ON[1], SUCTION_ON[1] + 1, s)));
    this.hoseA.visible = hoseIn > 0.001;
    const gulp = 0.0012 * Math.max(0, Math.sin(s * 11 + 1)) * Math.max(0, Math.sin(s * 2.3));
    this.hoseA.position.set((1 - hoseIn) * 0.2 + gulp, -(1 - hoseIn) * 0.08 + gulp, 0);

    if (s < JOLT) this.updateSyringe(s, trayX);
  }

  private updateSyringe(s: number, trayX: number): void {
    const t = this.rigTracks;
    let tx: number;
    let ty: number;
    let tz: number;
    let dx: number;
    let dy: number;
    let dz: number;
    if (s < SYRINGE_TAKEN) {
      tx = trayX + SYRINGE_X;
      ty = PANE_Y - 0.012;
      tz = SYRINGE_TIP_Z - 0.05;
      dx = 0;
      dy = 0;
      dz = -1;
    } else {
      tx = t[0].at(s);
      ty = t[1].at(s);
      tz = t[2].at(s);
      dx = t[3].at(s);
      dy = t[4].at(s);
      dz = t[5].at(s);
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
    }
    if (s > SHOWN - 0.1 && s < NEEDLE_DOWN) {
      // two flicks at the barrel
      const flick = Math.exp(-((s - SHOWN) % 0.55) * 9) * 0.0016;
      tx += flick;
      tz -= flick;
    }
    if (s > NEEDLE_AT && s < NEEDLE_AWAY) {
      // it is held by a hand: not quite still
      tx += 0.00022 * wobble(s * 5, 2);
      tz += 0.00022 * wobble(s * 4, 9);
    }
    this.rig.position.set(tx, ty, tz);
    // the needle's axis is the rig's +y, and the arm leaves toward the right of the picture
    const Y = this.v.set(dx, dy, dz);
    const Z = this.w.set(1, 0, 0).addScaledVector(Y, -dx).normalize();
    const X = this.x.crossVectors(Y, Z);
    this.m.makeBasis(X, Y, Z);
    this.rig.quaternion.setFromRotationMatrix(this.m);

    const handIn = smootherstep(range(HAND_COMES, SYRINGE_TAKEN, s));
    this.rigHand.position.copy(this.rigHandRest);
    this.rigHand.position.z += (1 - handIn) * 0.42;
    this.rigHand.position.y -= (1 - handIn) * 0.06;
    this.rigHand.visible = handIn > 0.001;

    // the drop: it gathers on the tip, hangs, and at the end of the hold it falls
    const gather = smootherstep(range(SHOWN + 0.1, SHOWN + 1.1, s));
    const falling = smootherstep(range(DROP_FALLS, DROP_FALLS + 0.22, s));
    this.tipDrop.visible = gather > 0.01 && falling < 1;
    if (this.tipDrop.visible) {
      const swell = 1 + 0.3 * range(NEEDLE_AT, DROP_FALLS, s);
      const size = 0.0115 * gather * swell * lerp(1, 0.6, falling);
      this.v.set(tx, ty, tz);
      this.tipDrop.position.set(this.v.x, this.v.y - size * 0.35, this.v.z);
      this.tipDrop.position.lerp(this.eyeChair, falling * 0.9);
      this.tipDrop.quaternion.copy(this.lens.quaternion);
      this.tipDrop.scale.set(size, size, 1);
    }
    this.updateLensDrops(s);
  }

  private updateLensDrops(s: number): void {
    const seed = this.dropSeed;
    const m = this.m;
    let n = 0;
    // the drop from the needle lands on the eye; a blink later it is gone
    const landed = DROP_FALLS + 0.22;
    if (s >= landed && s < landed + 1.3) {
      const age = s - landed;
      const size = 0.008 + 0.003 * Math.min(1, age * 3);
      m.makeScale(size, size, 1);
      m.setPosition(-0.002, -0.004 - age * 0.0022, -0.075);
      this.lensDrops.setMatrixAt(n++, m);
    }
    if (s >= DRILL_BITES) {
      for (let i = 0; i < LENS_DROPS; i++) {
        const k = i * 5;
        const at = seed[k + 3];
        if (s < at) continue;
        const age = s - at;
        const y = seed[k + 1] - age * seed[k + 4];
        if (y < -0.06) continue;
        const size = seed[k + 2];
        m.makeScale(size, size * 1.08, 1);
        m.setPosition(seed[k], y, -0.075);
        this.lensDrops.setMatrixAt(n++, m);
      }
    }
    this.lensDrops.count = n;
    this.lensDrops.instanceMatrix.needsUpdate = true;
  }

  private updateMouth(s: number): void {
    const burr = this.burrAt;
    const a = this.tremor(s);
    this.updateLensDrops(s);

    // the drill: it comes in slowly and finds the molar
    const inMotion = smootherstep(range(DRILL_ENTERS, DRILL_BITES, s));
    const out = smootherstep(range(DRILL_LEAVES, DRILL_LEAVES + 0.9, s));
    this.drillRig.visible = s >= DRILL_ENTERS - 0.05 && out < 1;
    if (this.drillRig.visible) {
      const reach = (1 - inMotion) * 0.55 + out * 0.6;
      this.drillRig.position.copy(burr).addScaledVector(this.toolAxis, reach);
      this.drillRig.position.x += a * 0.0007 * Math.sin(s * 311);
      this.drillRig.position.y += a * 0.0007 * Math.sin(s * 277 + 1);
    }
    const biting = a > 0.05 && s >= DRILL_BITES && s < DRILL_LEAVES;
    this.contactGlow.visible = biting;
    this.dust.visible = biting || (s >= DRILL_LEAVES && s < DRILL_LEAVES + 1.2);
    if (this.dust.visible) this.updateDust(s, biting);
    if (biting) {
      const k = 0.07 + 0.012 * Math.sin(s * 37);
      this.contactGlow.scale.set(k, k, 1);
    }

    // the forceps: the pull is slow, a turn each way, and the jaw follows it
    const fIn = smootherstep(range(FORCEPS_IN, FORCEPS_GRIP, s));
    this.forcepsRig.visible = s >= FORCEPS_IN - 0.05 && s < HANDS_HAUL + 0.9;
    const pull = range(FORCEPS_GRIP + 0.2, CRACK, s);
    const twist = Math.sin((s - FORCEPS_GRIP) * 3.4) * 0.012 * pull;
    const after = smootherstep(range(CRACK, HANDS_HAUL + 0.8, s));
    const flown = s >= CRACK ? 0.012 + after * 0.72 : 0;
    const creep = pull * pull * 0.004;
    const px = this.molarAt.x + this.toolAxis.x * (creep + flown) + twist;
    const py = this.molarAt.y - 0.016 + this.toolAxis.y * (creep + flown) + (s >= CRACK ? -0.008 : 0);
    const pz = this.molarAt.z + this.toolAxis.z * (creep + flown);
    if (this.forcepsRig.visible) {
      const reach = (1 - fIn) * 0.55;
      this.forcepsRig.position.set(px + this.toolAxis.x * reach, py + this.toolAxis.y * reach, pz + this.toolAxis.z * reach);
    }
    this.molar.position.set(px, py + 0.016, pz);
    this.molar.rotation.x = Math.PI + UPPER_TILT + pull * 0.1 * Math.sin((s - FORCEPS_GRIP) * 3.4);
    this.molar.visible = s < HANDS_HAUL + 0.9;
    this.socket.visible = s >= CRACK - 0.02;

    this.updateHair(s, px, py, pz);
  }

  private updateDust(s: number, biting: boolean): void {
    const burr = this.burrAt;
    const seed = this.dustSeed;
    const p = this.dustAttr.array as Float32Array;
    for (let i = 0; i < DUST; i++) {
      const k = i * 4;
      const age = (s * seed[k + 3] + seed[k]) % 1;
      const fade = biting ? 1 : 1 - range(DRILL_LEAVES, DRILL_LEAVES + 1.2, s);
      p[i * 3] = burr.x + seed[k + 1] * age * 0.6;
      p[i * 3 + 1] = burr.y + seed[k + 2] * age * 0.5 - 0.09 * age * age * fade;
      p[i * 3 + 2] = burr.z - age * 0.22 * (0.4 + seed[k]);
    }
    this.dustAttr.needsUpdate = true;
  }

  private updateHair(s: number, tx: number, ty: number, tz: number): void {
    const hair = this.hair;
    hair.mesh.visible = s >= CRACK && s < THE_CUT;
    if (!hair.mesh.visible) {
      this.haulA.visible = this.haulB.visible = false;
      return;
    }
    const a = this.hairA.set(-0.008, -0.078, -0.03);
    const taken = smootherstep(range(HANDS_HAUL - 0.4, HANDS_HAUL + 0.9, s));
    const b = this.hairB.set(tx, ty + 0.03, tz);
    b.lerp(this.w.set(0.028, 0.19, -0.92), taken);
    const taut = smootherstep(range(CRACK, CRACK + 0.45, s));
    const c = this.hairC.set(-0.17, -0.03, -0.06);
    c.lerp(this.v.addVectors(a, b).multiplyScalar(0.5), taut);
    c.y -= (1 - taken) * 0.006;
    const stop = range(LEANS, MASK_TO, s);
    const travel = (Math.min(s, LEANS) - CRACK) * HAUL_SPEED + (s > LEANS ? (s - LEANS) * lerp(HAUL_SPEED, 0.22, stop) : 0);
    const shiver = 0.6 * (1 - stop) + 0.18 * Math.max(0, Math.sin(s * 3.06)) ** 4;
    hair.update(a, c, b, travel, shiver);

    // hand over hand: one takes it near the teeth and draws it out while the other goes back for more
    const present = smootherstep(range(HANDS_HAUL - 0.6, HANDS_HAUL + 0.1, s)) * (1 - smootherstep(range(LEANS - 0.1, LEANS + 0.8, s)));
    this.haulA.visible = this.haulB.visible = present > 0.001;
    if (present <= 0.001) return;
    const q = (s - HANDS_HAUL) / HAUL_PERIOD;
    this.placeHaul(this.haulA, this.haulOffsetA, (q % 1 + 1) % 1, 1, present, a, b);
    this.placeHaul(this.haulB, this.haulOffsetB, (((q + 0.5) % 1) + 1) % 1, -1, present, a, b);
  }

  /** Where a hand is on its way out along the hair and back. */
  private placeHaul(hand: Mesh, offset: Vector3, phase: number, side: number, present: number, a: Vector3, b: Vector3): void {
    const near = 0.4;
    const far = 0.86;
    let u: number;
    let aside = 0;
    if (phase < 0.5) {
      u = lerp(near, far, smootherstep(phase / 0.5));
    } else {
      const k = (phase - 0.5) / 0.5;
      u = lerp(far, near, smootherstep(k));
      aside = Math.sin(k * Math.PI) * 0.11;
    }
    const gone = 1 - present;
    const depth = u;
    const px = lerp(a.x, b.x, (depth + 0.03) / 0.95) + side * (aside + gone * 0.5);
    const py = lerp(a.y, b.y, (depth + 0.03) / 0.95) + aside * 0.5 + gone * 0.2;
    const pz = lerp(a.z, b.z, (depth + 0.03) / 0.95);
    hand.position.set(px + offset.x, py + offset.y, pz + offset.z);
  }
}
