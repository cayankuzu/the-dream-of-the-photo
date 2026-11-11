import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
  Vector4,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { REDUCED_MOTION } from '../../../config/experience.config';
import { DEG, clamp, lerp, range, smootherstep, wobble } from '../../math';
import { randomFrom } from '../../dream/FigureKit';
import type { DreamKit } from '../../dream/DreamKit';
import { clockNow, dateNow } from '../FourthWall';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey, RoomPose } from '../Room';
import { Room } from '../Room';
import type { RoomVoice } from '../RoomSound';
import { PALETTE, type RoomKit } from '../RoomKit';

export const assets: RoomAssets = {
  models: ['bed_iron', 'shroud_body', 'iv_stand', 'monitor_ecg', 'pillow', 'forearm', 'mri_head', 'door_flush', 'wheelchair'],
  materials: ['tile_hospital_broken', 'tile_white', 'plaster_pale', 'plaster_mould', 'linen_white'],
  sounds: [
    'rooms/hospital_room_tone.mp3',
    'rooms/fluorescent_hum.mp3',
    'rooms/waiting_room_tone.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/gurney_wheel.mp3',
    'rooms/gurney_rumble.mp3',
    'rooms/gurney_stop.mp3',
    'rooms/door_far_metal.mp3',
    'rooms/ventilator.mp3',
    'rooms/gas_hiss.mp3',
    'rooms/monitor_beep.mp3',
    'rooms/monitor_flatline.mp3',
    'rooms/glove_snap.mp3',
    'rooms/tray_metal_2.mp3',
    'rooms/tray_slide.mp3',
    'rooms/needle_set_1.mp3',
    'rooms/syringe_tick_1.mp3',
    'rooms/syringe_tick_2.mp3',
    'rooms/needle_skin.mp3',
    'rooms/tube_fill.mp3',
    'rooms/belt_slither_1.mp3',
    'rooms/belt_slither_2.mp3',
    'rooms/belt_slither_3.mp3',
    'rooms/breath_lungs.mp3',
    'rooms/sheet_over_face.mp3',
  ],
};

type V3 = readonly [number, number, number];
type Rgb = readonly [number, number, number];

const TWO_PI = Math.PI * 2;

/** The script, in seconds of the room. */
const LINE_COME = 3;
const DOORS_HIT = 17.4;
const DOORS_PASS = 18.6;
const DOORS_BACK = 19.9;
const DOORS_SHUT = 21.4;
const BEEP_FROM = 21.2;
const BRAKE_AT = 24.4;
const STOP_AT = 27.4;
const LOOK_AT_ARM = 28.2;
const NEEDLE_COMES = 28.9;
const NEEDLE_THERE = 30;
const NEEDLE_PRESS = 30.8;
const SKIN_GIVES = 31.6;
const NEEDLE_IN = 33.4;
const GLOVE_LEAVES = 33.9;
/** The small lamp on your arm goes out once the needle is in (s). */
const ARM_LAMP_OFF = 35.4;
const RED_FROM = 34;
const RED_TOP = 38;
const WHITE_FROM = 38;
const WHITE_TOP = 40;
const SHUTTER_AT = 40;
const SHUTTER_LATEST = 41.4;
const LINE_MOTHER = 42;
const FLAT_AT = 50;
const TONE_ENDS = 51.9;
const HAND_FROM = 51.85;
const HAND_OVER = 52.7;
const SHEET_FROM = 53.1;
const SHEET_OVER = 54.7;
const WHEELS_AGAIN = 54.6;
const CUT_AT = 58;
/** The sheet slips while nobody is looking: not before, not after these (s). */
const SLIP_EARLIEST = 38.4;
const SLIP_LATEST = 41;

/** The gurney (m/s, m): how fast it rolls, how fast it leaves, how far it veers to come to rest beside her. */
const ROLL_SPEED = 1.5;
const AWAY_SPEED = 0.95;
const LANE_X = -1.55;
const VEER_FROM = 21.6;
const VEER_TO = 26.9;
const STOP_DIST = ROLL_SPEED * (BRAKE_AT + (STOP_AT - BRAKE_AT) / 2);
const STOP_Z = -STOP_DIST;
/** The mattress under you (m), how wide it is, where the pole's hook is, in the gurney's own frame. */
const GURNEY_TOP = 0.88;
const GURNEY_HALF = 0.38;
const HOOK = new Vector3(0.5, 1.96, 0.12);
/** How far the bag swings (rad) and how long a swing takes (s). */
const SWING = 0.13;
const SWING_PERIOD = 1.9;

/** The corridor (m): width, height, how far it goes behind you, the tubes on its ceiling and how bright they are. */
const CW = 2.5;
const CH = 2.62;
const CORRIDOR_BACK = 8;
const DOOR_Z = -ROLL_SPEED * DOORS_PASS;
const DOOR_W = 2.2;
const DOOR_H = 2.24;
const TUBE_FIRST = 0.25;
const TUBE_STEP = 2.7;
const TUBE_POWER = 3.4;
const TUBE_REACH = 5.5;
/** Where the white hair begins to hang from the ceiling, in meters before the doors. */
const HAIR_FROM = 13;

/** The ward (m): width, height, far wall, the rows of beds. */
const WW = 9.6;
const WH = 3.5;
const WARD_END = -61;
const ROWS = 12;
const ROW_FIRST = DOOR_Z - 2.4;
const ROW_STEP = 2.5;
const BED_X = 3.62;
const MATTRESS = 0.565;
/** The bed everything runs to: where her head is and where the bed stands. */
const HER_Z = STOP_Z + 0.1;
const BED_Z = HER_Z - 0.78;
/** Her shroud, made a body's: how far the cloth above the mattress swells from a tent toward a mound (1 leaves it as it is), and how many slices along the body its ridge is measured in. */
const SHROUD_SWELL = 1.8;
const SHROUD_SLICES = 40;
/** The orderly's skin: a cool, bloodless tint (linear), matte so that nothing glints in the sockets; the shadow beside the nose (strength, spread in m²) and at the mouth under the mask (strength, spread across and down, height, in the mask's u and v). */
const ORDERLY_SKIN: Rgb = [0.58, 0.68, 0.7];
const ORDERLY_MATTE = 0.92;
const NOSE_SHADE = [0.6, 0.0004] as const;
const MOUTH_SHADE = [0.35, 0.09, 0.07, 0.5] as const;
/** A fallen ceiling tile, looked up into: how deep the dark goes (m); how far the broken edge bites into the square and how wide its raw edge shows (m); the pipe across the dark (how far up as a share, radius in m); the tile's raw edge, the void's walls at the lip and deep in, the pipe (albedo); the little light that gets in (linear) and how far it spreads (m²). */
const HOLE_DEPTH = 0.34;
const HOLE_BITE = [0.075, 0.012] as const;
const HOLE_PIPE = [0.62, 0.032] as const;
const HOLE_EDGE: Rgb = [0.5, 0.52, 0.48];
const HOLE_LIP: Rgb = [0.2, 0.21, 0.2];
const HOLE_DEEP: Rgb = [0.008, 0.01, 0.01];
const HOLE_IRON: Rgb = [0.16, 0.14, 0.12];
const HOLE_GLOW: Rgb = [0.03, 0.038, 0.042];
const HOLE_GLOW_SPREAD = 0.04;
/** The one lamp over her bed: height (m), power of its spot (cd) and its half angle (deg). */
const LAMP_Y = 2.74;
const KEY_POWER = 17;
const KEY_ANGLE = 30;
const KEY_NARROW = 12;
/** The narrow light that finds your arm: power (cd), half angle (deg). */
const ARM_POWER = 3.4;
const ARM_ANGLE = 10.5;
/** How many hairs hang from the corridor's ceiling. */
const CEILING_HAIRS = 2800;

/** Your forearm, in the gurney's frame: elbow end, wrist end (m), which way its inside faces, how large the scan is. */
const ARM_FROM = new Vector3(0.335, 0.945, -0.3);
const ARM_TO = new Vector3(0.27, 0.93, -0.54);
const ARM_UP = new Vector3(-0.28, 0.94, 0.2);
const ARM_SCALE = 0.44;
/** Where along the scan's own height the hand begins, cut away under the cloth. */
const ARM_CUT = 0.5;
/** Where it goes in (m along the arm), the needle's length, how much of it goes in, its angle to the skin (deg). */
const INJECT_AT = 0.115;
const NEEDLE_L = 0.085;
const NEEDLE_DEEP = 0.03;
const NEEDLE_ANGLE = 17;
/** How far the gloved hand is turned about the needle (rad). */
const GLOVE_TURN = 0.9;
/** The radius of the dimple in the skin (m), and how deep its shading says it is. */
const DENT_R = 0.013;
const DENT_DEPTH = 0.0048;

/** The bag (m), the hair in it. */
const BAG_W = 0.2;
const BAG_H = 0.34;
const BAG_D = 0.055;
const BAG_LOCKS = 44;
const BAG_LOCK_HAIRS = 30;
const BAG_SEGMENTS = 28;
/** Hair across her pillow: how many, how many segments each. */
const FAN_HAIRS = 1300;
const FAN_SEGMENTS = 22;
/** The heart monitor: samples of its trace, seconds for one sweep. */
const TRACE_N = 96;
const TRACE_SWEEP = 2.8;

const reduced = REDUCED_MOTION ? 0.25 : 1;
const UP = new Vector3(0, 1, 0);
const ease = (a: number, b: number, v: number): number => smootherstep(range(a, b, v));
const bump = (x: number, z: number, cx: number, cz: number, rx: number, rz: number): number => Math.exp(-(((x - cx) / rx) ** 2) - ((z - cz) / rz) ** 2);

/** Meters along -Z the wheels have carried you. */
function rolled(s: number): number {
  if (s <= BRAKE_AT) return ROLL_SPEED * s;
  if (s <= STOP_AT) {
    const u = s - BRAKE_AT;
    return ROLL_SPEED * (BRAKE_AT + u - (u * u) / (2 * (STOP_AT - BRAKE_AT)));
  }
  const u = s - WHEELS_AGAIN;
  if (u <= 0) return STOP_DIST;
  return STOP_DIST + (u < 1.6 ? (AWAY_SPEED * u * u) / 3.2 : AWAY_SPEED * (u - 0.8));
}

function laneAt(s: number): number {
  return LANE_X * ease(VEER_FROM, VEER_TO, s);
}

/** Which way the gurney points (rad). */
function headingAt(s: number): number {
  const e = 0.04;
  const forward = rolled(s + e) - rolled(s - e);
  if (forward < 1e-4) return 0;
  return -Math.atan2(laneAt(s + e) - laneAt(s - e), forward);
}

/** A slow blink: 1 with the lids shut, at second `at`. */
function blinkAt(s: number, at: number): number {
  return Math.exp(-(((s - at) / 0.16) ** 2));
}

function rollingAt(s: number): number {
  const e = 0.04;
  return (rolled(s + e) - rolled(s - e)) / (2 * e * ROLL_SPEED);
}

/** Tubes of changing width, all in one geometry, each vertex with its own color. */
class Loft {
  private readonly p: number[] = [];
  private readonly c: number[] = [];
  private readonly ix: number[] = [];

  sweep(points: readonly V3[], steps: number, sides: number, radius: (s: number) => number, shade: (s: number) => Rgb, o: { squash?: number; start?: V3; even?: boolean } = {}): void {
    const curve = new CatmullRomCurve3(points.map((p) => new Vector3(p[0], p[1], p[2])), false, 'centripetal');
    const base = this.p.length / 3;
    const at = new Vector3();
    const t = new Vector3();
    const n = new Vector3();
    const b = new Vector3();
    const squash = o.squash ?? 1;
    curve.getTangent(0, t);
    if (o.start) n.set(o.start[0], o.start[1], o.start[2]);
    else n.set(Math.abs(t.x) < 0.9 ? 1 : 0, Math.abs(t.x) < 0.9 ? 0 : 1, 0);
    for (let j = 0; j <= steps; j++) {
      const s = j / steps;
      if (o.even) {
        curve.getPointAt(s, at);
        curve.getTangentAt(s, t);
      } else {
        curve.getPoint(s, at);
        curve.getTangent(s, t);
      }
      n.addScaledVector(t, -n.dot(t)).normalize();
      b.crossVectors(t, n);
      const r = radius(s);
      const col = shade(s);
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * TWO_PI;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r * squash;
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

/** Cloth over a height field, with UVs in meters. */
function clothGrid(x0: number, x1: number, z0: number, z1: number, cols: number, rows: number, height: (x: number, z: number) => number): BufferGeometry {
  const p: number[] = [];
  const uv: number[] = [];
  const ix: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const z = lerp(z0, z1, j / rows);
    for (let i = 0; i <= cols; i++) {
      const x = lerp(x0, x1, i / cols);
      p.push(x, height(x, z), z);
      uv.push(x, z);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      ix.push(a, d, b, b, d, e);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  return g;
}

/** Everything opaque in this room shares a program: it only ever differs in color. */
function tinted(g: BufferGeometry, r: number, gr: number, b: number): BufferGeometry {
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = r;
    c[i * 3 + 1] = gr;
    c[i * 3 + 2] = b;
  }
  g.setAttribute('color', new BufferAttribute(c, 3));
  return g;
}

/** One instance of a mesh: it shares its program with the instanced planes of this room. */
function single(geometry: BufferGeometry, material: Material): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, 1);
  mesh.setMatrixAt(0, new Matrix4());
  mesh.frustumCulled = false;
  return mesh;
}

/** Every mesh of a prop takes one color and the room's plain material. */
function paintSolid(prop: Object3D, material: Material, r: number, g: number, b: number): void {
  prop.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    tinted(m.geometry, r, g, b);
    m.material = material;
  });
}

function canvasMap(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  return map;
}

/** Where a ceiling tile has fallen: the square it leaves, its edge broken, and up into the dark above it, where a pipe may cross and a little light gets in. */
function fallenTile(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  const f = (x: number): string => x.toFixed(6);
  const v3 = (c: Rgb): string => `vec3(${c.map(f).join(', ')})`;
  const varyings = 'varying vec3 vHoleView;\nvarying vec3 vHoleAt;\nvarying vec2 vHoleSeed;';
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${varyings}`).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      mat4 holeTo = modelMatrix;
      #ifdef USE_INSTANCING
        holeTo = holeTo * instanceMatrix;
      #endif
      vHoleAt = transformed;
      vHoleView = transformed - (inverse(holeTo) * vec4(cameraPosition, 1.0)).xyz;
      vHoleSeed = holeTo[3].xz;`,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${varyings}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 holeGlow = vec3(0.0);
        {
          vec3 d = normalize(vHoleView);
          d = vec3(abs(d.x) < 1e-4 ? 1e-4 : d.x, max(d.y, 1e-3), abs(d.z) < 1e-4 ? 1e-4 : d.z);
          vec2 p = vHoleAt.xz;
          float seed = fract(sin(dot(vHoleSeed, vec2(12.9898, 78.233))) * 43758.5453);
          vec2 a = abs(p);
          float along = a.x > a.y ? p.y : p.x;
          float inside = 0.3 - max(a.x, a.y) - ${f(HOLE_BITE[0])} * (0.55 + 0.45 * sin(along * 23.0 + seed * 40.0) * sin(along * 61.0 - seed * 17.0));
          if (inside < 0.0) discard;
          vec3 o = vec3(p.x, 0.0, p.y);
          vec3 tt = (vec3(sign(d.x) * 0.3, ${f(HOLE_DEPTH)}, sign(d.z) * 0.3) - o) / d;
          float t = min(min(tt.x, tt.z), tt.y);
          vec3 h = o + d * t;
          vec3 col = mix(${v3(HOLE_LIP)}, ${v3(HOLE_DEEP)}, smoothstep(0.0, 0.7, h.y / ${f(HOLE_DEPTH)}));
          vec2 gap = (vec2(seed, fract(seed * 7.13)) - 0.5) * 0.4;
          if (tt.y <= t) holeGlow = ${v3(HOLE_GLOW)} * exp(-dot(h.xz - gap, h.xz - gap) / ${f(HOLE_GLOW_SPREAD)});
          if (seed > 0.35) {
            vec2 q = vec2(-${f(HOLE_PIPE[0] * HOLE_DEPTH)}, p.y - (fract(seed * 3.7) - 0.5) * 0.36);
            float qa = dot(d.yz, d.yz);
            float qb = dot(q, d.yz);
            float disc = qb * qb - qa * (dot(q, q) - ${f(HOLE_PIPE[1] ** 2)});
            float tp = (-qb - sqrt(max(disc, 0.0))) / qa;
            if (disc > 0.0 && tp > 0.0 && tp < t) {
              vec2 n = (q + d.yz * tp) / ${f(HOLE_PIPE[1])};
              col = ${v3(HOLE_IRON)} * (0.3 + 0.7 * max(0.0, -n.x));
              holeGlow = vec3(0.0);
            }
          }
          diffuseColor.rgb = mix(col, ${v3(HOLE_EDGE)}, 1.0 - smoothstep(0.0, ${f(HOLE_BITE[1])}, inside));
        }`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += holeGlow;');
  };
  m.customProgramCacheKey = () => 'ward-fallen-tile';
  return m;
}

/** Her shroud, made a body's: in every slice across it the cloth above the mattress swells from a tent toward a mound, its ridge kept where it was, so that end on it never rises to a peak. */
function roundedShroud(source: BufferGeometry): BufferGeometry {
  const g = source.clone();
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  g.computeBoundingBox();
  const box = g.boundingBox!;
  const along = box.max.z - box.min.z >= box.max.x - box.min.x ? 2 : 0;
  const across = 2 - along;
  const from = box.min.getComponent(along);
  const span = box.max.getComponent(along) - from;
  const middle = (box.min.getComponent(across) + box.max.getComponent(across)) / 2;
  const half = (box.max.getComponent(across) - box.min.getComponent(across)) / 2;
  // the mattress: the lowest the cloth lies flat on it
  let base = Infinity;
  for (let i = 0; i < p.count; i++) {
    if (n.getY(i) > 0.8 && Math.abs(p.getComponent(i, across) - middle) < 0.7 * half) base = Math.min(base, p.getY(i));
  }
  if (!Number.isFinite(base)) return g;
  const at = (i: number): number => ((p.getComponent(i, along) - from) / span) * SHROUD_SLICES;
  const ridge = new Float32Array(SHROUD_SLICES);
  for (let i = 0; i < p.count; i++) {
    const s = Math.min(SHROUD_SLICES - 1, Math.floor(at(i)));
    ridge[s] = Math.max(ridge[s], p.getY(i) - base);
  }
  for (let i = 0; i < p.count; i++) {
    const h = p.getY(i) - base;
    if (h <= 0) continue;
    const x = Math.min(SHROUD_SLICES - 1, Math.max(0, at(i) - 0.5));
    const s = Math.min(SHROUD_SLICES - 2, Math.floor(x));
    const top = Math.max(h, lerp(ridge[s], ridge[s + 1], x - s));
    p.setY(i, base + top * (1 - (1 - h / top) ** SHROUD_SWELL));
  }
  g.computeVertexNormals();
  return g;
}

/** The inside of a forearm: pale, mottled, three veins, and the small hairs. */
function drawSkin(c: CanvasRenderingContext2D): void {
  const w = c.canvas.width;
  const h = c.canvas.height;
  const rnd = randomFrom(5);
  c.fillStyle = '#d9cec2';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 1500; i++) {
    const r = 2 + rnd() * 12;
    const x = rnd() * w;
    const y = rnd() * h;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    const tone = rnd() < 0.6 ? '186,146,136' : '150,160,170';
    g.addColorStop(0, `rgba(${tone},0.1)`);
    g.addColorStop(1, `rgba(${tone},0)`);
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  c.lineCap = 'round';
  for (let v = 0; v < 3; v++) {
    const y0 = h * (0.3 + v * 0.2);
    const k = rnd() * 6;
    for (let pass = 0; pass < 3; pass++) {
      c.filter = 'blur(3px)';
      c.strokeStyle = `rgba(104,122,148,${0.05 + pass * 0.03})`;
      c.lineWidth = 9 - pass * 3;
      c.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = y0 + Math.sin(x * 0.012 + k) * h * 0.09 + Math.sin(x * 0.041 + k * 2) * h * 0.02;
        if (x === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
    }
  }
  c.filter = 'none';
  c.lineWidth = 0.7;
  for (let i = 0; i < 420; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    c.strokeStyle = `rgba(84,70,58,${0.1 + rnd() * 0.16})`;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + 4 + rnd() * 7, y + (rnd() - 0.5) * 4);
    c.stroke();
  }
}

/** Water that came through a ceiling, again and again: dark rings with a soft edge. */
function drawStain(c: CanvasRenderingContext2D): void {
  const s = c.canvas.width;
  const rnd = randomFrom(9);
  c.clearRect(0, 0, s, s);
  for (let i = 0; i < 26; i++) {
    const x = s * (0.28 + rnd() * 0.44);
    const y = s * (0.28 + rnd() * 0.44);
    const r = s * (0.05 + rnd() * 0.18);
    const g = c.createRadialGradient(x, y, r * 0.2, x, y, r);
    g.addColorStop(0, 'rgba(24,16,8,0.07)');
    g.addColorStop(0.8, 'rgba(24,16,8,0.12)');
    g.addColorStop(0.92, 'rgba(14,9,4,0.32)');
    g.addColorStop(1, 'rgba(24,16,8,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  }
}

/** A tall ward window at night: wired glass, two mullions, a little blue. */
function drawWindow(c: CanvasRenderingContext2D): void {
  const w = c.canvas.width;
  const h = c.canvas.height;
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0c1a22');
  g.addColorStop(0.7, '#071116');
  g.addColorStop(1, '#040a0d');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(160,190,210,0.05)';
  c.lineWidth = 1;
  for (let i = -h; i < w; i += 22) {
    c.beginPath();
    c.moveTo(i, 0);
    c.lineTo(i + h, h);
    c.moveTo(i + h, 0);
    c.lineTo(i, h);
    c.stroke();
  }
  c.fillStyle = '#04070a';
  c.fillRect(0, 0, w, h * 0.03);
  c.fillRect(0, h * 0.97, w, h * 0.03);
  c.fillRect(0, 0, w * 0.05, h);
  c.fillRect(w * 0.95, 0, w * 0.05, h);
  c.fillRect(w * 0.48, 0, w * 0.04, h);
  c.fillRect(0, h * 0.47, w, h * 0.03);
}

/** The cloth you see from under it: long soft folds, a little light through the weave, and at the top the edge coming up. */
function drawCover(c: CanvasRenderingContext2D): void {
  const w = c.canvas.width;
  const h = c.canvas.height;
  const image = c.createImageData(w, h);
  const d = image.data;
  const rnd = randomFrom(13);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = 46 + 18 * Math.sin(x * 0.0102 + 1) + 9 * Math.sin(x * 0.031 + 2) + 3 * Math.sin(x * 0.09);
      const fold = 0.66 + 0.34 * Math.sin(x * 0.0125 + 2.4 * Math.sin(y * 0.0082 + 1) + y * 0.004) * Math.sin(y * 0.0068 - x * 0.0026 + 2);
      const hem = Math.exp(-(((y - edge - 18) / 16) ** 2)) * 0.22;
      const tone = 255 * clamp((fold + hem) * (0.965 + 0.05 * rnd()), 0, 1);
      const i = (y * w + x) * 4;
      d[i] = tone * 0.97;
      d[i + 1] = tone * 0.98;
      d[i + 2] = tone * 0.95;
      d[i + 3] = 255 * (0.7 + 0.08 * rnd()) * smootherstep(range(edge - 14, edge + 12, y));
    }
  }
  c.putImageData(image, 0, 0);
}

/** How far a scanned head reaches in every direction from its center, smoothed so that cloth laid over it stays taut. */
const FIELD_W = 90;
const FIELD_H = 45;

class HeadField {
  private readonly g = new Float32Array(FIELD_W * FIELD_H);
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
        v.fromBufferAttribute(p as BufferAttribute, i).applyMatrix4(m.matrixWorld);
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

/** A real head in a surgical mask, its eyes shut. Bare: upside down, a dark cap below the face reads as a beard. */
function maskedHead(kit: DreamKit, skin: Material, cloth: Material): Group {
  const root = new Group();
  const scan = kit.prop('mri_head', [0, 0, 0], { scale: 0.25, anchor: 'center' }, root);
  const field = new HeadField(scan);
  const nose = field.nose;
  const span = 86 * DEG;
  const e = (az: number) => Math.cos(((az / span) * Math.PI) / 2) ** 1.1;
  const mask = drape(field, 44, 22, [0.3, 0.35, 0.35], (u, v, o) => {
    const az = (u - 0.5) * 2 * span;
    const k = e(az);
    o.az = az;
    o.el = lerp(nose + lerp(-22 * DEG, -58 * DEG, k), nose + lerp(-4 * DEG, 7 * DEG, k), v);
    const edge = 1 - Math.abs(2 * u - 1) ** 3;
    const pleats = range(0.16, 0.26, v) * (1 - range(0.74, 0.84, v));
    const f = (v * 3.4) % 1;
    const saw = f < 0.72 ? f / 0.72 : (1 - f) / 0.28;
    o.lift = 0.0105 + 0.0052 * saw * pleats * edge;
    o.shade = (1 - 0.74 * (1 - saw) * pleats * edge) * (1 - MOUTH_SHADE[0] * Math.exp(-(((u - 0.5) / MOUTH_SHADE[1]) ** 2) - ((v - MOUTH_SHADE[3]) / MOUTH_SHADE[2]) ** 2));
  });
  root.add(new Mesh(mask, cloth));
  // the lids: dark curved lines, as on someone who is asleep on his feet
  const onHead = (az: number, el: number): V3 => {
    const r = field.radius(az * DEG, nose + el * DEG) + 0.0015;
    return [r * Math.cos(nose + el * DEG) * Math.sin(az * DEG), r * Math.sin(nose + el * DEG), r * Math.cos(nose + el * DEG) * Math.cos(az * DEG)];
  };
  const loops = new Loft();
  const wire: V3[] = [];
  for (let az = -66; az <= 66; az += 11) wire.push(onHead(az, lerp(-4, 7, e(az * DEG)) + 0.5));
  loops.sweep(wire, 40, 5, () => 0.0017, () => [0.46, 0.5, 0.48]);
  for (const side of [1, -1]) {
    loops.sweep([onHead(side * 84, 1), onHead(side * 98, 8), onHead(side * 118, 2), onHead(side * 104, -14), onHead(side * 84, -26)], 24, 5, () => 0.002, () => [0.5, 0.55, 0.53]);
  }
  root.add(new Mesh(loops.geometry(), cloth));
  // the skin in shadow, the sockets deep: lit from above, a face looking down at you has no eyes to speak of
  scan.updateWorldMatrix(true, true);
  const eyes = [onHead(16, 16), onHead(-16, 16)].map((e) => new Vector3(e[0], e[1], e[2]));
  const bridge = [onHead(8, 11), onHead(-8, 11)].map((e) => new Vector3(e[0], e[1], e[2]));
  const at = new Vector3();
  scan.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const position = m.geometry.getAttribute('position');
    const c = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      at.fromBufferAttribute(position as BufferAttribute, i).applyMatrix4(m.matrixWorld);
      const socket = Math.max(Math.exp(-at.distanceToSquared(eyes[0]) / 0.0013), Math.exp(-at.distanceToSquared(eyes[1]) / 0.0013));
      const nose = Math.max(Math.exp(-at.distanceToSquared(bridge[0]) / NOSE_SHADE[1]), Math.exp(-at.distanceToSquared(bridge[1]) / NOSE_SHADE[1]));
      const k = (1 - 0.975 * socket) * (1 - NOSE_SHADE[0] * nose);
      c[i * 3] = k * ORDERLY_SKIN[0];
      c[i * 3 + 1] = k * ORDERLY_SKIN[1];
      c[i * 3 + 2] = k * ORDERLY_SKIN[2];
    }
    m.geometry.setAttribute('color', new BufferAttribute(c, 3));
    m.material = skin;
  });
  return root;
}

interface HandPose {
  curls: readonly (readonly [number, number, number])[];
  splay: readonly number[];
  thumb: readonly V3[];
}

const FINGERS = [
  { x: 0.031, y: 0.092, l: [0.045, 0.026, 0.022], r: 0.0086 },
  { x: 0.0105, y: 0.098, l: [0.05, 0.03, 0.024], r: 0.0088 },
  { x: -0.0105, y: 0.094, l: [0.046, 0.029, 0.023], r: 0.0083 },
  { x: -0.031, y: 0.084, l: [0.036, 0.022, 0.02], r: 0.0072 },
] as const;

/** Finger and thumb closed on something thin; `PINCH_POINT` is where they meet. */
const HAND_PINCH: HandPose = {
  curls: [[0.6, 0.8, 0.5], [0.95, 1.15, 0.7], [1.05, 1.2, 0.7], [1.1, 1.2, 0.7]],
  splay: [0.05, 0.02, -0.02, -0.06],
  thumb: [[0.03, 0.028, 0.014], [0.055, 0.068, 0.04], [0.05, 0.105, 0.06], [0.034, 0.128, 0.071]],
};
const PINCH_POINT = new Vector3(0.03, 0.128, 0.072);
/** Flat and open, to close someone's eyes with. */
const HAND_OPEN: HandPose = {
  curls: [[0.14, 0.2, 0.14], [0.12, 0.18, 0.12], [0.12, 0.18, 0.12], [0.14, 0.22, 0.14]],
  splay: [0.14, 0.04, -0.05, -0.16],
  thumb: [[0.03, 0.028, 0.012], [0.066, 0.055, 0.02], [0.094, 0.082, 0.03], [0.11, 0.106, 0.038]],
};

const fingerRadius = (s: number, r: number): number => r * (1 - 0.2 * s) * (s > 0.9 ? Math.sqrt(Math.max(0.03, 1 - ((s - 0.9) / 0.1) ** 2)) : 1) * (1 + 0.07 * Math.exp(-(((s - 0.5) / 0.05) ** 2)) + 0.07 * Math.exp(-(((s - 0.75) / 0.05) ** 2)));

/** A hand in a latex glove: wrist at the origin, fingers along +y, palm toward +z, thumb on +x; and the arm behind it. */
function handGeometry(pose: HandPose, latex: Rgb, sleeve: Rgb, sleeveLength = 0.7): BufferGeometry {
  const loft = new Loft();
  const crease = (s: number): Rgb => {
    const k = 1 - 0.34 * (Math.exp(-(((s - 0.5) / 0.022) ** 2)) + Math.exp(-(((s - 0.75) / 0.022) ** 2)));
    return [latex[0] * k, latex[1] * k, latex[2] * k];
  };
  FINGERS.forEach((f, i) => {
    const points: V3[] = [[f.x, f.y - 0.02, 0], [f.x, f.y, 0]];
    let cur: V3 = points[1];
    let total = 0;
    for (let k = 0; k < 3; k++) {
      total += pose.curls[i][k];
      const c = Math.cos(total);
      cur = [cur[0] + Math.sin(pose.splay[i]) * c * f.l[k], cur[1] + Math.cos(pose.splay[i]) * c * f.l[k], cur[2] + Math.sin(total) * f.l[k]];
      points.push(cur);
    }
    loft.sweep(points, 26, 10, (s) => fingerRadius(s, f.r), crease);
  });
  const widths = [0.012, 0.028, 0.035, 0.042, 0.036, 0.002];
  const stops = [0, 0.08, 0.3, 0.72, 0.93, 1];
  const width = (s: number): number => {
    let i = 0;
    while (i < stops.length - 2 && s > stops[i + 1]) i++;
    return lerp(widths[i], widths[i + 1], smootherstep(range(stops[i], stops[i + 1], s)));
  };
  loft.sweep([[0, -0.02, 0], [0, 0.02, 0.003], [0, 0.06, 0.004], [0, 0.1, 0.001], [0, 0.118, 0]], 20, 26, width, () => latex, { squash: 0.34, start: [1, 0, 0] });
  loft.sweep([[0.012, -0.004, 0.012], [0.03, 0.03, 0.018], [0.046, 0.06, 0.02]], 12, 12, (s) => 0.021 * Math.sqrt(Math.max(0.02, 1 - (2 * s - 1) ** 2)), () => latex);
  loft.sweep(pose.thumb, 24, 10, (s) => fingerRadius(s, 0.0108), crease);
  loft.sweep([[0, 0.012, 0], [0, -0.04, 0], [0, -0.075, 0], [0, -0.092, 0]], 12, 16, (s) => 0.03 + 0.005 * s + 0.0035 * Math.exp(-(((s - 0.94) / 0.05) ** 2)), () => latex, { squash: 0.8, start: [1, 0, 0] });
  loft.sweep([[0, -0.085, 0], [0, -0.2, 0], [0, -0.42, 0], [0, -sleeveLength, 0]], 8, 12, (s) => 0.04 + 0.035 * s, () => sleeve, { squash: 0.85, start: [1, 0, 0] });
  return loft.geometry();
}

/** One strand of a flat ribbon of hair, pushed into `p`, `c`, `ix`. */
function ribbon(p: number[], c: number[], ix: number[], points: readonly V3[], width: (u: number) => number, side: (i: number, out: Vector3) => void, shade: (u: number) => number): void {
  const base = p.length / 3;
  const sv = new Vector3();
  const n = points.length - 1;
  for (let k = 0; k <= n; k++) {
    side(k, sv);
    const w = width(k / n);
    p.push(points[k][0] - sv.x * w, points[k][1] - sv.y * w, points[k][2] - sv.z * w, points[k][0] + sv.x * w, points[k][1] + sv.y * w, points[k][2] + sv.z * w);
    const tone = shade(k / n);
    c.push(tone, tone, tone * 0.97, tone, tone, tone * 0.97);
    if (k < n) {
      const a = base + k * 2;
      ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
}

/**
 * The ward. On your back on a gurney, under a corridor's tubes, one in three dead; a masked face upside down over
 * yours; the ceiling begins to grow white hair. Through the doors a long ward of covered shapes, and every tube of
 * every drip stand runs across the floor to one bed under the one lamp. The gurney is parked beside it. A gloved hand
 * finds the inside of your arm. What comes up the tube is first red and then white, and the bag on the pole has been
 * full of it all along. In the next bed the sheet has slipped. The monitor goes flat. A hand closes your eyes.
 */
export default class Ward extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x090f0e, density: 0.05 },
    env: 'bathroom',
    envIntensity: 0.09,
    sky: 0,
    grade: { exposure: 1.22, saturation: 0.7, warmth: 0.0, tint: -0.03, flare: 0.002 },
  };
  film = { bloom: 0.9, bloomFrom: 0.72, grain: 0.36, scratches: 0.1, flicker: 0.02, weave: 0.0004, aberration: 0.0005 };
  focus = 1.6;
  aperture = 1.2;
  drift = 0.2;
  fear = 0.3;
  control = { look: true, scroll: true, hurry: 2 };

  private readonly gurney = new Group();
  private readonly corridor = new Group();
  private readonly wardRoom = new Group();
  private readonly her = new Group();
  private readonly covered = new Group();
  private readonly swing = new Group();
  private readonly tubeLine = new Group();
  private readonly needle = new Group();
  private readonly glove = new Group();
  private readonly coverSheet: Mesh;
  private readonly closingHand: Mesh;

  private readonly clocks: { value: number }[] = [];
  private readonly hairShades: MeshBasicMaterial[] = [];
  private readonly litTubes: number[] = [];
  private readonly doorLeaves: Group[] = [];
  private readonly keyLight;
  private readonly armLight;
  private readonly wardSpots;
  private readonly armSpots;
  private readonly solid = new MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
  private readonly white2 = canvasMap(2, 2, (c) => {
    c.fillStyle = '#fff';
    c.fillRect(0, 0, 2, 2);
  });
  private readonly leaning = new Matrix4();
  private readonly spinBack = new Matrix4().makeRotationY(Math.PI);
  private readonly headFrom = new Quaternion();
  private readonly headTo = new Quaternion();
  private farGlow!: Mesh;
  private nearGlow!: Mesh;
  private orderlyBody!: ReturnType<RoomKit['headless']>;
  private threadShade!: MeshBasicMaterial;
  private readonly lampGlow: MeshBasicMaterial;

  private readonly beeps: number[] = [];
  private nextBeep = 0;
  private shot = false;
  private slipped = false;

  private dent = { value: new Vector4(0, 0, 0, 0) };
  private ridgeFrom = { value: new Vector3() };
  private ridgeTo = { value: new Vector4(0, 0, 0, 0) };
  private entry = new Vector3();
  private needleDir = new Vector3();
  private skinNormal = new Vector3();
  private bead!: Mesh;
  private rightRail!: Mesh;
  private orderlyHead!: Group;
  private bagFill!: Mesh;
  private bagPlastic!: Mesh;
  private redThread!: Mesh;
  private whiteThread!: Mesh;
  private threadSteps = 1;
  private threadSides = 1;
  private fan!: Mesh;
  private fanIndices = 0;
  private bagIndices = 0;
  private bagLight;
  private monitorLight;
  private feetLight;
  private manLight;
  private men!: ReturnType<RoomKit['headless']>;
  private tracePositions!: Float32Array;
  private traceColors!: Float32Array;
  private traceGeometry!: BufferGeometry;
  private traceW = 0.3;
  private traceH = 0.16;
  private screenCanvas!: CanvasRenderingContext2D;
  private screenMap!: CanvasTexture;
  private readonly glovePosition = new Vector3();
  private readonly v = new Vector3();

  private toneVoice: RoomVoice | null = null;
  private humVoice: RoomVoice | null = null;
  private wheelVoice: RoomVoice | null = null;
  private rumbleVoice: RoomVoice | null = null;
  private droneVoice: RoomVoice | null = null;
  private ventilatorVoice: RoomVoice | null = null;
  private gasVoice: RoomVoice | null = null;
  private hallVoice: RoomVoice | null = null;
  private flatVoice: RoomVoice | null = null;

  constructor(ctx: RoomContext) {
    super(ctx);
    const SUPINE: V3 = [0, 1.02, 0];
    const RAISED: V3 = [0, 1.55, -0.05];
    const OVER_ARM: V3 = [0.12, 1.46, -0.16];
    const AT_BAG: V3 = [-0.05, 1.3, -0.12];
    const TO_HER: V3 = [0.05, 1.66, -0.08];
    const key = (s: number, at: V3, yaw: number, pitch: number, roll: number, fov: number): RoomKey => ({ t: s / this.seconds, at, yaw, pitch, roll, fov });
    this.keys = [
      key(0, SUPINE, 0, 80, 0, 62),
      key(7, SUPINE, 1.5, 78, -1.5, 62),
      key(13, SUPINE, -1.5, 81, 1.5, 63),
      key(17.6, [0, 1.03, 0], 0, 80, 0, 64),
      key(20.4, RAISED, 0, -8, 0, 44),
      key(24, RAISED, -14, -9, 0, 42),
      key(26.4, RAISED, -30, -12, 0, 42),
      key(27.6, RAISED, -33, -14, 0, 42),
      key(LOOK_AT_ARM, RAISED, -33, -15, 0, 42),
      key(29.7, OVER_ARM, -35, -56, 2, 31),
      key(34, [0.13, 1.44, -0.18], -35.5, -56.5, 3, 27),
      key(36, [0.1, 1.32, -0.1], -100, -26, 2, 24),
      key(38, [-0.02, 1.32, -0.12], -113, 8, 1, 36),
      key(40, AT_BAG, -113, 35, 0, 34),
      key(41.8, AT_BAG, -113.5, 35.5, 0, 31),
      key(44.4, [0.02, 1.36, -0.1], -89, 5, 0, 46),
      key(45.1, [0.02, 1.36, -0.1], -89.5, 4.5, 0, 46),
      key(47.2, TO_HER, -77, -33, 0, 42),
      key(50, TO_HER, -76, -33, 0, 36),
      key(52.9, TO_HER, -76, -33, 0, 36),
      key(53, SUPINE, 0, 82, 0, 60),
      key(60, SUPINE, 0, 80, 0, 60),
    ];

    this.root.add(this.gurney);
    this.gurney.add(this.swing);
    this.swing.position.copy(HOOK);
    this.swing.add(this.tubeLine);
    this.gurney.add(this.needle);
    this.gurney.add(this.glove);

    this.keyLight = this.spot([0, LAMP_Y - 0.08, HER_Z - 0.1], [0, 0.6, HER_Z + 0.06], 0xe9f4ec, KEY_POWER, KEY_ANGLE, 0.92);
    this.wardSpots = [this.keyLight, null, null];
    this.spots = this.wardSpots;
    this.bagLight = this.light([LANE_X + 0.2, 1.5, STOP_Z - 0.15], 0xdfeee6, 0, 1.6);
    this.monitorLight = this.light([0.62, 0.92, HER_Z + 0.26], 0xa8e6c8, 0.12, 1.3);
    this.feetLight = this.light([0, 1.8, 0], 0xcfe0da, 0, 2.6);
    this.manLight = this.light([0.72, 2.3, HER_Z - 0.6], 0xd6e6dc, 0, 3.2);

    this.lampGlow = new MeshBasicMaterial({ map: this.white2, transparent: true, color: new Color(2.6, 2.7, 2.5) });
    this.buildCorridor();
    this.buildWard();
    this.buildGurney();
    this.buildArm();
    const armAt = this.entry;
    this.armLight = this.spot([LANE_X + 0.42, 1.68, STOP_Z + 0.42], [LANE_X + armAt.x, armAt.y, STOP_Z + armAt.z], 0xf1f4ea, ARM_POWER, ARM_ANGLE, 0.85);
    this.armSpots = [this.armLight, this.keyLight, null];
    this.buildTube();
    this.buildBag();
    this.buildOrderly();
    this.buildHer();
    this.buildMonitor();

    // what lies on the lens: a gloved hand coming down, and the sheet coming up
    this.closingHand = new Mesh(handGeometry(HAND_OPEN, [0.05, 0.055, 0.06], [0.02, 0.02, 0.024]), new MeshStandardMaterial({ vertexColors: true, roughness: 0.36 }));
    this.closingHand.rotation.z = Math.PI;
    this.closingHand.visible = false;
    this.closingHand.frustumCulled = false;
    this.lens.add(this.closingHand);
    this.coverSheet = single(new PlaneGeometry(0.9, 0.6), new MeshBasicMaterial({ map: canvasMap(768, 480, drawCover), transparent: true, depthTest: false, depthWrite: false, fog: false }));
    this.coverSheet.renderOrder = 900;
    this.coverSheet.position.z = -0.2;
    this.coverSheet.visible = false;
    this.lens.add(this.coverSheet);

    this.layBeeps();
    this.score();
  }

  /** Beeps at rest, and then quicker, and then not. */
  private layBeeps(): void {
    let at = BEEP_FROM;
    while (at < FLAT_AT) {
      this.beeps.push(at);
      const quick = range(LINE_MOTHER - 1, FLAT_AT, at);
      at += at < LINE_MOTHER - 1 ? 1.2 - 0.3 * range(LOOK_AT_ARM, LINE_MOTHER, at) : lerp(0.92, 0.36, quick ** 1.15);
    }
  }

  /** What the voice says and what the room sounds like, at the seconds it happens. */
  private score(): void {
    const s = this.sound;
    this.beat(0, () => {
      this.toneVoice = s.bed('rooms/hospital_room_tone.mp3', { gain: 0.24 });
      this.humVoice = s.bed('rooms/fluorescent_hum.mp3', { gain: 0.07 });
      this.wheelVoice = s.bed('rooms/gurney_wheel.mp3', { gain: 0.14, reverb: 0.25 });
      this.rumbleVoice = s.bed('rooms/gurney_rumble.mp3', { gain: 0.2, reverb: 0.2 });
      this.droneVoice = s.bed('rooms/dream_drone_low.mp3', { gain: 0.08, fade: 6 });
    });
    this.beat(LINE_COME, () => this.say({ tr: 'Geldin mi?', en: 'Have you come?' }, 3.6, 'house'));
    this.beat(DOORS_HIT, () => s.play('rooms/gurney_stop.mp3', { gain: 0.2, reverb: 0.2 }));
    this.beat(DOORS_PASS + 0.8, () => {
      this.hallVoice = s.bed('rooms/waiting_room_tone.mp3', { gain: 0.12, fade: 3 });
      this.humVoice?.gain(0.03, 2);
      this.toneVoice?.gain(0.3, 3);
    });
    this.beat(DOORS_SHUT, () => s.play('rooms/door_far_metal.mp3', { gain: 0.34, lowpass: 2400 }));
    this.beat(DOORS_SHUT + 0.5, () => {
      this.ventilatorVoice = s.bed('rooms/ventilator.mp3', { gain: 0.16, pan: 0.45, reverb: 0.15, fade: 3 });
    });
    this.beat(BRAKE_AT, () => {
      this.wheelVoice?.rate(0.7, 3.4);
      this.rumbleVoice?.rate(0.8, 3.4);
      this.wheelVoice?.gain(0, 3.6);
      this.rumbleVoice?.gain(0, 3.8);
    });
    this.beat(STOP_AT, () => {
      s.play('rooms/gurney_stop.mp3', { gain: 0.35, reverb: 0.2 });
      this.droneVoice?.gain(0.11, 4);
    });
    this.beat(STOP_AT + 0.55, () => s.play('rooms/tray_slide.mp3', { gain: 0.26, pan: 0.5 }));
    this.beat(LOOK_AT_ARM - 0.3, () => s.play('rooms/glove_snap.mp3', { gain: 0.34, pan: 0.5 }));
    this.beat(NEEDLE_COMES - 0.3, () => s.play('rooms/tray_metal_2.mp3', { gain: 0.3, pan: 0.5, reverb: 0.1 }));
    this.beat(NEEDLE_COMES + 0.4, () => s.play('rooms/needle_set_1.mp3', { gain: 0.4, pan: 0.35 }));
    this.beat(NEEDLE_THERE - 0.5, () => s.play('rooms/syringe_tick_1.mp3', { gain: 0.3, pan: 0.3 }));
    this.beat(NEEDLE_THERE - 0.05, () => s.play('rooms/syringe_tick_2.mp3', { gain: 0.3, pan: 0.3 }));
    this.beat(NEEDLE_PRESS - 0.2, () => {
      // the room goes quiet for the skin, so that it can be heard
      this.ventilatorVoice?.gain(0.06, 0.5);
      this.toneVoice?.gain(0.16, 0.5);
      this.gasVoice = s.bed('rooms/gas_hiss.mp3', { gain: 0.08, fade: 4 });
    });
    this.beat(SKIN_GIVES, () => s.play('rooms/needle_skin.mp3', { gain: 0.34, pan: 0.2 }));
    this.beat(GLOVE_LEAVES, () => {
      this.ventilatorVoice?.gain(0.16, 2);
      this.toneVoice?.gain(0.3, 2);
    });
    this.beat(RED_FROM, () => s.play('rooms/tube_fill.mp3', { gain: 0.5, pan: 0.3 }));
    this.beat(RED_FROM + 1.9, () => s.play('rooms/tube_fill.mp3', { gain: 0.42, pan: 0.45, rate: 0.82 }));
    this.beat(WHITE_FROM, () => s.play('rooms/belt_slither_1.mp3', { gain: 0.35, pan: 0.5 }));
    this.beat(WHITE_FROM + 1, () => s.play('rooms/belt_slither_2.mp3', { gain: 0.35, pan: 0.55 }));
    this.beat(WHITE_FROM + 1.55, () => s.play('rooms/belt_slither_3.mp3', { gain: 0.35, pan: 0.6 }));
    this.beat(LINE_MOTHER, () => this.say({ tr: 'Annen seni sordu.', en: 'Your mother was asking for you.' }, 4.5, 'dream'));
    this.beat(LINE_MOTHER + 3.6, () => s.play('rooms/breath_lungs.mp3', { gain: 0.4, pan: 0.6 }));
    this.beat(LINE_MOTHER + 6.4, () => s.play('rooms/breath_lungs.mp3', { gain: 0.3, pan: 0.6, rate: 0.9 }));
    this.beat(FLAT_AT, () => {
      this.flatVoice = s.play('rooms/monitor_flatline.mp3', { gain: 0.16, reverb: 0.1 });
      this.writeScreen('- - -', clockNow());
      this.ventilatorVoice?.gain(0, 1.4);
      this.gasVoice?.gain(0, 1.4);
      this.droneVoice?.gain(0, 1.6);
      this.hallVoice?.gain(0, 1.6);
      this.toneVoice?.gain(0, 1.7);
      this.humVoice?.gain(0, 1.2);
    });
    this.beat(TONE_ENDS, () => this.flatVoice?.stop(0.02));
    this.beat(SHEET_FROM - 0.2, () => s.play('rooms/sheet_over_face.mp3', { gain: 0.5, lowpass: 3000 }));
    this.beat(WHEELS_AGAIN, () => {
      this.wheelVoice?.stop(0.1);
      this.rumbleVoice?.stop(0.1);
      this.wheelVoice = s.bed('rooms/gurney_wheel.mp3', { gain: 0.12, reverb: 0.25, lowpass: 1500, fade: 0.6 });
      this.rumbleVoice = s.bed('rooms/gurney_rumble.mp3', { gain: 0.16, reverb: 0.2, lowpass: 1200, fade: 0.6 });
    });
    this.beat(CUT_AT, () => {
      this.wheelVoice?.stop(0.04);
      this.rumbleVoice?.stop(0.04);
    });
  }

  private ceilingLights(parent: Group, zs: readonly number[], y: number, xs: readonly number[], isLit: (i: number) => boolean, drop: number): void {
    const housing = new InstancedMesh(new BoxGeometry(1.24, 0.05, 0.11), new MeshStandardMaterial({ color: 0x747a73, roughness: 0.55 }), zs.length * xs.length);
    const cover = new InstancedMesh(new CylinderGeometry(0.018, 0.018, 1.12, 8).rotateZ(Math.PI / 2), this.lampGlow, zs.length * xs.length);
    const dead = new InstancedMesh(new CylinderGeometry(0.018, 0.018, 1.12, 8).rotateZ(Math.PI / 2), new MeshStandardMaterial({ color: 0x565a54, roughness: 0.4 }), zs.length * xs.length);
    const m = new Matrix4();
    let lit = 0;
    let off = 0;
    zs.forEach((z, zi) => {
      xs.forEach((x, xi) => {
        const n = zi * xs.length + xi;
        housing.setMatrixAt(n, m.makeTranslation(x, y - 0.025, z));
        const tube = m.makeTranslation(x, y - 0.066 - drop, z);
        if (isLit(n)) cover.setMatrixAt(lit++, tube);
        else dead.setMatrixAt(off++, tube);
      });
    });
    cover.count = lit;
    dead.count = off;
    for (const mesh of [housing, cover, dead]) {
      mesh.frustumCulled = false;
      parent.add(mesh);
    }
  }

  private buildCorridor(): void {
    const b = this.build;
    const k = this.kit;
    const g = this.corridor;
    this.root.add(g);
    const plaster = k.surface('plaster_mould', 1.8, { color: new Color(0x8aa096) });
    const tile = k.surface('tile_white', 1.2, { color: new Color(0x7ea294), roughness: 0.42 });
    const floor = k.surface('tile_hospital_broken', 1.2, { color: new Color(0x6d7269), roughness: 0.38 });
    const ceiling = b.ceiling(0.6);
    const length = CORRIDOR_BACK - DOOR_Z;
    const mid = (CORRIDOR_BACK + DOOR_Z) / 2;
    b.box(CW, length, CH, { walls: plaster, floor, ceiling, skip: ['+z'] }, g).position.z = CORRIDOR_BACK;
    b.wall(CW / 2 - 0.006, mid, length, 1.5, '-x', tile, g);
    b.wall(-CW / 2 + 0.006, mid, length, 1.5, '+x', tile, g);
    const strip = (CW - DOOR_W) / 2;
    const off = (CW + DOOR_W) / 4;
    b.wall(-off, DOOR_Z, strip, CH, '+z', plaster, g);
    b.wall(off, DOOR_Z, strip, CH, '+z', plaster, g);
    b.wall(0, DOOR_Z, DOOR_W, CH - DOOR_H, '+z', plaster, g, DOOR_H);

    // the tubes: two lit and one dead, on and on
    const zs: number[] = [];
    for (let i = -3; ; i++) {
      const z = TUBE_FIRST - i * TUBE_STEP;
      if (z < DOOR_Z + 1) break;
      zs.push(z);
    }
    const isLit = (i: number) => (((i - 3) % 3) + 3) % 3 !== 2;
    this.ceilingLights(g, zs, CH, [0], isLit, 0);
    zs.forEach((z, i) => {
      if (!isLit(i)) return;
      this.light([0, CH - 0.16, z], 0xd8eee4, TUBE_POWER, TUBE_REACH);
      this.litTubes.push(z);
      b.glow(0, CH - 0.09, z, 1.3, 0xdff0e6, 0.2, g);
    });

    const pipes = new Loft();
    const grey = (): Rgb => [0.34, 0.36, 0.33];
    const rust = (s: number): Rgb => [0.15 + 0.03 * Math.sin(s * 40), 0.13, 0.1];
    pipes.sweep([[-1.12, 2.36, CORRIDOR_BACK], [-1.12, 2.36, mid], [-1.12, 2.36, DOOR_Z]], 2, 10, () => 0.03, rust);
    pipes.sweep([[-1.02, 2.47, CORRIDOR_BACK], [-1.02, 2.47, mid], [-1.02, 2.47, DOOR_Z]], 2, 8, () => 0.022, grey);
    pipes.sweep([[1.13, 2.42, CORRIDOR_BACK], [1.13, 2.42, mid], [1.13, 2.42, DOOR_Z]], 2, 8, () => 0.03, grey);
    for (let z = CORRIDOR_BACK - 1; z > DOOR_Z; z -= 2.2) {
      pipes.sweep([[-1.25, 2.3, z], [-1.14, 2.31, z], [-1.08, 2.4, z], [-1.14, 2.47, z]], 8, 5, () => 0.007, grey);
      pipes.sweep([[1.25, 2.38, z + 0.7], [1.14, 2.44, z + 0.7], [1.12, 2.46, z + 0.7]], 6, 5, () => 0.006, grey);
    }
    // what comes out of the holes in the ceiling
    pipes.sweep([[0.35, CH, -17.6], [0.34, 2.42, -17.66], [0.42, 2.18, -17.5], [0.38, 2.0, -17.54]], 14, 4, () => 0.004, () => [0.06, 0.06, 0.06]);
    pipes.sweep([[-0.5, CH, -21.5], [-0.46, 2.3, -21.46], [-0.62, 2.06, -21.6]], 12, 4, () => 0.0035, () => [0.16, 0.05, 0.04]);
    pipes.sweep([[0.8, CH, -23.3], [0.76, 2.28, -23.2], [0.9, 2.1, -23.3], [0.82, 1.95, -23.32]], 14, 4, () => 0.0035, () => [0.05, 0.06, 0.05]);
    const pipeMesh = new Mesh(pipes.geometry(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 }));
    pipeMesh.frustumCulled = false;
    g.add(pipeMesh);

    // tiles have fallen; the holes get more frequent toward the doors
    const rnd = randomFrom(31);
    const holes = new InstancedMesh(new PlaneGeometry(0.6, 0.6).rotateX(Math.PI / 2), fallenTile(), 40);
    const m = new Matrix4();
    let holeCount = 0;
    for (let i = 0; i < 40; i++) {
      const z = lerp(-9, DOOR_Z + 0.6, rnd() ** 0.65);
      const x = (Math.floor(rnd() * 4) - 2 + 0.5) * 0.6;
      if (Math.abs(x) < 0.4 && zs.some((tz) => Math.abs(tz - z) < 0.6)) continue;
      holes.setMatrixAt(holeCount++, m.makeTranslation(x, CH - 0.003, Math.round(z / 0.6) * 0.6 + 0.3));
    }
    holes.count = holeCount;
    holes.frustumCulled = false;
    g.add(holes);
    this.stains(g, 34, CH, CW * 0.5, DOOR_Z, CORRIDOR_BACK, 41);

    this.buildLocks(g);

    // doors along the walls; one of them stands open a little and somebody has left a lamp on in there
    const leaf = new PlaneGeometry(1, 2.1);
    tinted(leaf, 0.14, 0.17, 0.15);
    const lintel = new PlaneGeometry(1.16, 2.2);
    tinted(lintel, 0.04, 0.05, 0.045);
    const shut = (z: number, sign: number) => {
      const frame = new Mesh(lintel, this.solid);
      frame.position.set((sign * CW) / 2 - sign * 0.004, 1.1, z);
      frame.rotation.y = (-sign * Math.PI) / 2;
      const door = new Mesh(leaf, this.solid);
      door.position.set((sign * CW) / 2 - sign * 0.01, 1.05, z);
      door.rotation.y = (-sign * Math.PI) / 2;
      g.add(frame, door);
    };
    shut(-5.8, 1);
    shut(-8.2, -1);
    shut(-15.2, 1);
    shut(3.2, -1);
    shut(5.2, 1);
    const warmth = new Mesh(tinted(new PlaneGeometry(1, 2.1), 0.5, 0.34, 0.16), this.basicColored());
    warmth.position.set(-CW / 2 + 0.006, 1.05, -11.7);
    warmth.rotation.y = Math.PI / 2;
    const ajar = new Mesh(leaf, this.solid);
    ajar.position.set(-CW / 2 + 0.13, 1.05, -11.72);
    ajar.rotation.y = Math.PI / 2 - 0.26;
    g.add(warmth, ajar);
    this.light([-CW / 2 + 0.16, 1.8, -11.7], PALETTE.warm, 1.7, 3.6);
    this.clocks.push(b.motes(420, { x: [-1.2, 1.2], y: [0.7, 2.55], z: [DOOR_Z, 3] }, g, { strength: 0.8 }).time);
  }

  /** White hair coming down out of the ceiling: a few strands at first, then more than can be counted; the middle stays clear. */
  private buildLocks(g: Group): void {
    const rnd = randomFrom(3);
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const pts: V3[] = [];
    const segments = 10;
    let lock = { x: 0, z: 0, left: 0 };
    for (let n = 0; n < CEILING_HAIRS; n++) {
      const along = (n / CEILING_HAIRS) ** 0.6;
      // some hairs come in locks, from one place
      if (lock.left <= 0) {
        lock = { x: (rnd() < 0.5 ? -1 : 1) * (0.26 + rnd() * 0.9), z: lerp(DOOR_Z + HAIR_FROM, DOOR_Z + 0.3, along) + (rnd() - 0.5) * 1.4, left: Math.floor(6 + rnd() * 34) };
      }
      lock.left--;
      const inLock = rnd() < 0.6;
      const side = rnd() < 0.5 ? -1 : 1;
      const x0 = inLock ? lock.x + (rnd() - 0.5) * 0.2 : side * (0.24 + rnd() * 0.98);
      const z0 = inLock ? lock.z + (rnd() - 0.5) * 0.2 : lerp(DOOR_Z + HAIR_FROM, DOOR_Z + 0.3, along) + (rnd() - 0.5) * 0.4;
      const l = lerp(0.42, 1.2, along) * (0.55 + 0.45 * rnd());
      const f = 3 + rnd() * 6;
      const p = rnd() * TWO_PI;
      const wave = 0.008 + rnd() * 0.02;
      pts.length = 0;
      for (let k = 0; k <= segments; k++) {
        const u = k / segments;
        pts.push([x0 + wave * u * Math.sin(u * f + p), CH - 0.012 - l * u, z0 + wave * u * Math.cos(u * f + p * 1.7)]);
      }
      const s0 = rnd() * TWO_PI;
      const sx = Math.cos(s0);
      const sz = Math.sin(s0);
      const glow = 0.45 + 0.55 * rnd();
      ribbon(
        pos,
        col,
        idx,
        pts,
        (u) => 0.0011 * (1 - 0.7 * u),
        (_i, out) => {
          out.set(sx, 0, sz);
        },
        (u) => glow * Math.min(0.08 + 0.92 * smootherstep(range(0, 0.3, u)), 1 - 0.6 * u),
      );
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(col, 3));
    geometry.setIndex(idx);
    const material = this.basicColored();
    this.hairShades.push(material);
    const locks = new Mesh(geometry, material);
    locks.frustumCulled = false;
    g.add(locks);
  }

  /** Water stains on a ceiling. */
  private stains(parent: Group, count: number, y: number, halfWidth: number, z0: number, z1: number, seed: number): void {
    const mesh = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(Math.PI / 2), new MeshBasicMaterial({ map: canvasMap(256, 256, drawStain), transparent: true, depthWrite: false }), count);
    const rnd = randomFrom(seed);
    const m = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const e = new Vector3();
    const up = new Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const size = 0.6 + rnd() * 1.7;
      m.compose(p.set((rnd() * 2 - 1) * halfWidth, y - 0.004, lerp(z0, z1, rnd())), q.setFromAxisAngle(up, rnd() * TWO_PI), e.set(size, 1, size * (0.7 + rnd() * 0.5)));
      mesh.setMatrixAt(i, m);
    }
    mesh.frustumCulled = false;
    parent.add(mesh);
  }

  private buildWard(): void {
    const b = this.build;
    const k = this.kit;
    const g = this.wardRoom;
    this.root.add(g);
    const plaster = k.surface('plaster_pale', 2, { color: new Color(0x6f8a80) });
    const tile = k.surface('tile_white', 1.2, { color: new Color(0x769c8e), roughness: 0.4 });
    const floor = k.surface('tile_hospital_broken', 1.2, { color: new Color(0x7a827a), roughness: 0.62 });
    floor.normalScale.setScalar(0.35);
    const ceiling = b.ceiling(0.6);
    const length = DOOR_Z - WARD_END;
    const mid = (DOOR_Z + WARD_END) / 2;
    b.box(WW, length, WH, { walls: plaster, floor, ceiling, skip: ['-z'] }, g).position.z = DOOR_Z;
    b.wall(WW / 2 - 0.006, mid, length, 1.7, '-x', tile, g);
    b.wall(-WW / 2 + 0.006, mid, length, 1.7, '+x', tile, g);
    b.wall(0, WARD_END + 0.006, WW, 1.7, '+z', tile, g);
    const off = (WW + DOOR_W) / 4;
    const side = (WW - DOOR_W) / 2;
    b.wall(-off, DOOR_Z, side, WH, '-z', plaster, g);
    b.wall(off, DOOR_Z, side, WH, '-z', plaster, g);
    b.wall(0, DOOR_Z, DOOR_W, WH - DOOR_H, '-z', plaster, g, DOOR_H);

    // the doors, that swing back behind you
    for (const sign of [-1, 1]) {
      const hinge = new Group();
      hinge.position.set((sign * DOOR_W) / 2, 0, DOOR_Z - 0.03);
      const leaf = k.prop('door_flush', [(-sign * DOOR_W) / 4, 0, 0], {}, hinge);
      paintSolid(leaf, this.solid, 0.17, 0.2, 0.18);
      leaf.scale.set(DOOR_W / 2 / 0.838, DOOR_H / 1.981, 1);
      g.add(hinge);
      this.doorLeaves.push(hinge);
      const jamb = new Mesh(tinted(new BoxGeometry(0.07, DOOR_H, 0.26), 0.1, 0.12, 0.11), this.solid);
      jamb.position.set(sign * (DOOR_W / 2 + 0.035), DOOR_H / 2, DOOR_Z);
      g.add(jamb);
    }
    const head = new Mesh(tinted(new BoxGeometry(DOOR_W + 0.14, 0.07, 0.26), 0.1, 0.12, 0.11), this.solid);
    head.position.set(0, DOOR_H + 0.035, DOOR_Z);
    g.add(head);

    // windows between the beds, with the night in them
    const windows = new InstancedMesh(new PlaneGeometry(1.15, 2), new MeshBasicMaterial({ map: canvasMap(128, 224, drawWindow), transparent: true }), (ROWS + 1) * 2);
    const m = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const one = new Vector3(1, 1, 1);
    let w = 0;
    for (let i = 0; i <= ROWS; i++) {
      const z = ROW_FIRST + ROW_STEP / 2 - i * ROW_STEP;
      for (const sign of [-1, 1]) windows.setMatrixAt(w++, m.compose(p.set(sign * (WW / 2 - 0.012), 2.34, z), q.setFromAxisAngle(UP, (-sign * Math.PI) / 2), one));
    }
    windows.frustumCulled = false;
    g.add(windows);

    // the lamps: nearly all of them dead
    const zs: number[] = [];
    for (let z = DOOR_Z - 2; z > WARD_END + 1; z -= 3.2) zs.push(z);
    this.ceilingLights(g, zs, WH, [-1.7, 1.7], () => false, 0);
    this.stains(g, 60, WH, WW * 0.48, WARD_END, DOOR_Z, 77);

    // the rows
    const n = ROWS * 2;
    const beds = k.props('bed_iron', n + 1, { nodes: ['frame'] });
    const shrouds = k.props('shroud_body', n);
    const stands = k.props('iv_stand', n + 2);
    const blots = new InstancedMesh(new CircleGeometry(0.5, 20).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: canvasMap(128, 128, (c) => {
      const g2 = c.createRadialGradient(64, 64, 8, 64, 64, 64);
      g2.addColorStop(0, 'rgba(0,0,0,0.78)');
      g2.addColorStop(0.6, 'rgba(0,0,0,0.5)');
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g2;
      c.fillRect(0, 0, 128, 128);
    }), transparent: true, depthWrite: false }), n + 2);
    const rnd = randomFrom(55);
    const loft = new Loft();
    const hubX = 0;
    const hubZ = BED_Z;
    const pale = (): Rgb => [0.4, 0.42, 0.38];
    const shadowScale = new Vector3(1.4, 1, 2.6);
    const bodyScale = new Vector3(1, 1.14, 1);
    shrouds.root.children.forEach((mesh) => {
      const material = ((mesh as InstancedMesh).material as MeshStandardMaterial).clone();
      material.color.set(0xb4bdb7);
      (mesh as InstancedMesh).material = material;
    });
    for (let i = 0; i < ROWS; i++) {
      const z = ROW_FIRST - i * ROW_STEP;
      for (const sign of [1, -1]) {
        const at = i * 2 + (sign > 0 ? 0 : 1);
        const heading = (-sign * Math.PI) / 2;
        beds.set(at, sign * BED_X, 0, z, heading, 1);
        m.compose(p.set(sign * BED_X, MATTRESS - 0.25, z), q.setFromAxisAngle(UP, heading), bodyScale);
        shrouds.setMatrix(at, m);
        const sx = sign * (BED_X + 0.74);
        const sz = z + 0.64;
        stands.set(at, sx, 0, sz, rnd() * 6, 1);
        blots.setMatrixAt(at, m.compose(p.set(sign * BED_X, 0.006, z), q.setFromAxisAngle(UP, heading), shadowScale));
        // every drip stand's line comes down and goes across the floor to the same bed
        const fx = sx - sign * 0.5;
        const fz = sz + 0.1;
        const tox = hubX + sign * (0.1 + 0.3 * (i / (ROWS - 1)));
        const toz = hubZ + clamp((z - hubZ) * 0.12, -0.85, 0.85);
        const bend = (rnd() < 0.5 ? -1 : 1) * (0.45 + rnd() * 1.1);
        const at0 = (u: number, off: number): V3 => {
          const lx = tox - fx;
          const lz = toz - fz;
          const len = Math.hypot(lx, lz) || 1;
          return [fx + lx * u - (lz / len) * off, 0.016, fz + lz * u + (lx / len) * off];
        };
        loft.sweep(
          [[sx, 1.62, sz], [sx - sign * 0.06, 1.05, sz + 0.03], [sx - sign * 0.14, 0.22, sz + 0.06], [fx, 0.016, fz], at0(0.25, bend * 0.8), at0(0.5, bend), at0(0.75, bend * 0.5), at0(0.93, bend * 0.1), [tox, 0.016, toz]],
          110,
          5,
          () => 0.0075,
          pale,
          { even: true },
        );
      }
    }
    // the one bed
    // a plain steel look for every stand: no blue pump, no glass, one program
    const standSteel = new MeshStandardMaterial({ color: 0x5f6663, roughness: 0.42, metalness: 0.6 });
    stands.root.children.forEach((mesh) => ((mesh as InstancedMesh).material = standSteel));
    beds.set(n, 0, 0, BED_Z, Math.PI, 1);
    const hers = k.props('shroud_body', 1);
    m.compose(p.set(0, MATTRESS - 0.25, BED_Z), q.setFromAxisAngle(UP, Math.PI), bodyScale);
    hers.setMatrix(0, m);
    hers.root.children.forEach((mesh) => ((mesh as InstancedMesh).geometry = roundedShroud((mesh as InstancedMesh).geometry)));
    hers.commit();
    hers.root.children.forEach((mesh) => ((mesh as InstancedMesh).material = (shrouds.root.children[0] as InstancedMesh).material));
    this.covered.add(hers.root);
    g.add(this.covered);
    stands.set(n, 0.66, 0, HER_Z + 0.25, 1, 1);
    stands.set(n + 1, -0.7, 0, HER_Z + 0.55, 3, 1);
    blots.setMatrixAt(n, m.compose(p.set(0, 0.006, BED_Z), q.identity(), shadowScale));
    blots.setMatrixAt(n + 1, m.makeTranslation(9, -1, 9));
    beds.commit();
    shrouds.commit();
    stands.commit();
    blots.frustumCulled = false;
    g.add(beds.root, shrouds.root, stands.root, blots);
    const lines = new Mesh(loft.geometry(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, emissive: 0x1a1f1b }));
    lines.frustumCulled = false;
    g.add(lines);

    // the lamp, hung low on two chains
    const lamp = new Group();
    lamp.position.set(0, 0, HER_Z - 0.1);
    this.ceilingLights(lamp, [0], LAMP_Y, [0], () => true, 0);
    lamp.children.forEach((child) => (child.rotation.y = Math.PI / 2));
    g.add(lamp);
    const chains = new Loft();
    for (const z of [-0.45, 0.45]) chains.sweep([[0, LAMP_Y, z], [0, WH, z]], 1, 5, () => 0.006, () => [0.1, 0.1, 0.1]);
    const chainMesh = new Mesh(chains.geometry(), this.solid);
    chainMesh.position.z = HER_Z - 0.1;
    g.add(chainMesh);
    this.farGlow = b.glow(0, LAMP_Y - 0.08, HER_Z - 0.1, 2.2, 0xdff0e6, 0.3, g);
    this.nearGlow = b.glow(0, LAMP_Y - 0.08, HER_Z - 0.1, 1, 0xdff0e6, 0.16, g);

    // what stands in the dark
    paintSolid(k.prop('wheelchair', [0.3, 0, BED_Z - 11.5], { rotation: [0, 8, 0] }, g), this.solid, 0.1, 0.11, 0.1);
    const farLeaf = new Mesh(tinted(new PlaneGeometry(1.5, 2.3), 0.05, 0.07, 0.06), this.solid);
    farLeaf.position.set(0, 1.15, WARD_END + 0.03);
    g.add(farLeaf);
    const pane = new Mesh(tinted(new PlaneGeometry(0.34, 0.5), 1.3, 0.8, 0.4), this.basicColored());
    pane.position.set(0, 1.66, WARD_END + 0.1);
    g.add(pane);
    b.glow(0, 1.66, WARD_END + 0.2, 1.1, PALETTE.warm, 0.3, g);
    this.light([0, 3.1, -52], PALETTE.cold, 7, 22);
    this.light([0, 3.2, DOOR_Z - 3.5], PALETTE.cold, 2.6, 10);
    this.clocks.push(b.motes(460, { x: [-4.6, 4.6], y: [0.2, 3.4], z: [WARD_END + 1, DOOR_Z - 0.4] }, g, { strength: 0.8 }).time);
  }

  private buildGurney(): void {
    const g = this.gurney;
    const k = this.kit;
    const linen = k.surface('linen_white', 0.4, { color: new Color(0x686e68), roughness: 0.96 });
    const folds = (x: number, z: number) => 0.0075 * Math.sin(x * 19 + z * 7 + 1) + 0.0055 * Math.sin(x * 37 - z * 13 + 2) + 0.0045 * Math.sin(z * 31 + Math.sin(x * 11) * 2) + 0.012 * Math.sin(z * 5.3 + x * 3) * Math.sin(x * 8);
    const body = (x: number, z: number) =>
      0.12 * bump(x, z, 0, -0.62, 0.2, 0.34) +
      0.11 * (bump(x, z, -0.1, -1.25, 0.085, 0.42) + bump(x, z, 0.1, -1.25, 0.085, 0.42)) +
      0.15 * (bump(x, z, -0.09, -1.72, 0.085, 0.09) + bump(x, z, 0.09, -1.72, 0.085, 0.09));
    const sheet = new Mesh(
      clothGrid(-GURNEY_HALF - 0.08, GURNEY_HALF + 0.08, -2, -0.2, 34, 70, (x, z) => GURNEY_TOP + 0.012 + body(x, z) + folds(x, z) - 0.34 * smootherstep(range(GURNEY_HALF, GURNEY_HALF + 0.08, Math.abs(x))) - 0.3 * smootherstep(range(-1.92, -2, z))),
      linen,
    );
    sheet.castShadow = true;
    sheet.receiveShadow = true;
    g.add(sheet);
    const under = new Mesh(clothGrid(-GURNEY_HALF, GURNEY_HALF, -0.3, 0.32, 16, 16, (x, z) => GURNEY_TOP + folds(x, z) * 0.6), linen);
    under.receiveShadow = true;
    g.add(under);
    k.paint(k.prop('pillow', [0, GURNEY_TOP - 0.02, 0.1], {}, g), linen);

    const metal = new MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.78 });
    const steel = (): Rgb => [0.62, 0.65, 0.63];
    const dark = (): Rgb => [0.06, 0.06, 0.06];
    const frame = new Loft();
    for (const x of [-0.3, 0.3]) {
      frame.sweep([[x, 0.66, 0.1], [x, 0.66, -0.9], [x, 0.66, -1.9]], 2, 8, () => 0.024, steel);
      for (const z of [0.05, -1.85]) {
        frame.sweep([[x, 0.66, z], [x, 0.3, z], [x, 0.1, z]], 2, 8, () => 0.02, steel);
        frame.sweep([[x - 0.03, 0.08, z], [x + 0.03, 0.08, z]], 1, 14, () => 0.075, dark);
      }
    }
    frame.sweep([[-0.3, 0.66, -0.9], [0, 0.66, -0.9], [0.3, 0.66, -0.9]], 2, 8, () => 0.02, steel);
    // the left rail stays up; the pole
    frame.sweep([[-0.43, 1.13, -1.72], [-0.43, 1.14, -0.8], [-0.43, 1.14, 0.1]], 2, 8, () => 0.012, steel);
    for (const z of [-1.7, -0.8, 0.08]) frame.sweep([[-0.43, 0.84, z], [-0.43, 1.14, z]], 1, 6, () => 0.009, steel);
    frame.sweep([[0.3, 0.68, HOOK.z], [0.66, 0.7, HOOK.z]], 1, 6, () => 0.012, steel);
    frame.sweep([[0.66, 0.7, HOOK.z], [0.66, 1.3, HOOK.z], [0.66, 1.99, HOOK.z]], 2, 8, () => 0.012, steel);
    frame.sweep([[0.66, 1.99, HOOK.z], [HOOK.x, 1.995, HOOK.z], [HOOK.x, 1.965, HOOK.z]], 8, 6, () => 0.006, steel);
    const frameMesh = new Mesh(frame.geometry(), metal);
    frameMesh.castShadow = true;
    frameMesh.frustumCulled = false;
    g.add(frameMesh);
    const rail = new Loft();
    rail.sweep([[0.43, 1.13, -1.72], [0.43, 1.14, -0.8], [0.43, 1.14, 0.1]], 2, 8, () => 0.012, steel);
    for (const z of [-1.7, -0.8, 0.08]) rail.sweep([[0.43, 0.84, z], [0.43, 1.14, z]], 1, 6, () => 0.009, steel);
    this.rightRail = new Mesh(rail.geometry(), metal);
    this.rightRail.frustumCulled = false;
    g.add(this.rightRail);
  }

  /** Your forearm: a real cast of one, in pale skin, laid on the sheet between two rolls of cloth. */
  private buildArm(): void {
    const meshes: Mesh[] = [];
    const scan = this.kit.model('forearm').scene;
    scan.updateWorldMatrix(true, true);
    scan.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    });
    const source = meshes[0];
    const pos = source.geometry.getAttribute('position') as BufferAttribute;
    const nor = source.geometry.getAttribute('normal') as BufferAttribute;
    const index = source.geometry.index!;
    const start = new Vector3(0.033, 0, -0.158);
    const axisIn = new Vector3(-0.113, 0.52, 0.15).normalize();
    const faceIn = new Vector3(1, 0, 0).addScaledVector(axisIn, -axisIn.x).normalize();
    const sideIn = new Vector3().crossVectors(axisIn, faceIn);
    const axisOut = new Vector3().subVectors(ARM_TO, ARM_FROM).normalize();
    const faceOut = ARM_UP.clone().addScaledVector(axisOut, -ARM_UP.dot(axisOut)).normalize();
    const sideOut = new Vector3().crossVectors(axisOut, faceOut);
    const p = new Float32Array(pos.count * 3);
    const n = new Float32Array(pos.count * 3);
    const uv = new Float32Array(pos.count * 2);
    const keep = new Uint8Array(pos.count);
    const v = new Vector3();
    const local = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(source.matrixWorld);
      keep[i] = v.y < ARM_CUT ? 1 : 0;
      local.subVectors(v, start);
      const a = local.dot(axisIn) * ARM_SCALE;
      const f = local.dot(faceIn) * ARM_SCALE;
      const b = local.dot(sideIn) * ARM_SCALE;
      v.copy(ARM_FROM).addScaledVector(axisOut, a).addScaledVector(faceOut, f).addScaledVector(sideOut, b);
      p[i * 3] = v.x;
      p[i * 3 + 1] = v.y;
      p[i * 3 + 2] = v.z;
      uv[i * 2] = a / 0.26;
      uv[i * 2 + 1] = 0.5 + b / 0.14;
      v.fromBufferAttribute(nor, i).transformDirection(source.matrixWorld);
      const nx = v.dot(axisIn);
      const ny = v.dot(faceIn);
      const nz = v.dot(sideIn);
      v.set(0, 0, 0).addScaledVector(axisOut, nx).addScaledVector(faceOut, ny).addScaledVector(sideOut, nz);
      n[i * 3] = v.x;
      n[i * 3 + 1] = v.y;
      n[i * 3 + 2] = v.z;
    }
    const ix: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      if (keep[a] && keep[b] && keep[c]) ix.push(a, b, c);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(p, 3));
    geometry.setAttribute('normal', new BufferAttribute(n, 3));
    geometry.setAttribute('uv', new BufferAttribute(uv, 2));
    geometry.setIndex(ix);

    const skin = new MeshStandardMaterial({ map: canvasMap(512, 256, drawSkin), roughness: 0.62, metalness: 0, emissive: 0x100c0a });
    skin.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uDent = this.dent;
      shader.uniforms.uRidgeFrom = this.ridgeFrom;
      shader.uniforms.uRidgeTo = this.ridgeTo;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vArmAt;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvArmAt = position;');
      const r2 = (DENT_R * DENT_R).toFixed(7);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vArmAt;\nuniform vec4 uDent;\nuniform vec3 uRidgeFrom;\nuniform vec4 uRidgeTo;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec3 dentQ = vArmAt - uDent.xyz;
          float dentF = exp(-dot(dentQ, dentQ) / ${r2}) * uDent.w;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.02, 0.86, 0.84), clamp(dentF * 2.0, 0.0, 1.0));
          diffuseColor.rgb *= 1.0 - 0.34 * dentF;`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          vec3 pressQ = vArmAt - uDent.xyz;
          normal = normalize(normal - (viewMatrix * vec4(pressQ, 0.0)).xyz * exp(-dot(pressQ, pressQ) / ${r2}) * uDent.w * ${((2 * DENT_DEPTH) / (DENT_R * DENT_R)).toFixed(3)});
          vec3 ridgeAxis = uRidgeTo.xyz - uRidgeFrom;
          float ridgeU = clamp(dot(vArmAt - uRidgeFrom, ridgeAxis) / max(dot(ridgeAxis, ridgeAxis), 1e-8), 0.0, 1.0);
          vec3 ridgeQ = vArmAt - (uRidgeFrom + ridgeAxis * ridgeU);
          normal = normalize(normal + (viewMatrix * vec4(ridgeQ, 0.0)).xyz * exp(-dot(ridgeQ, ridgeQ) / 0.00004) * uRidgeTo.w * 60.0);`,
        );
    };
    skin.customProgramCacheKey = () => 'ward-skin';
    const arm = new Mesh(geometry, skin);
    arm.castShadow = true;
    arm.receiveShadow = true;
    arm.frustumCulled = false;
    this.gurney.add(arm);

    // find where the needle goes
    const probe = new Mesh(geometry);
    probe.updateMatrixWorld();
    const at = ARM_FROM.clone().addScaledVector(axisOut, INJECT_AT);
    const hit = new Raycaster(at.clone().addScaledVector(faceOut, 0.3), faceOut.clone().negate()).intersectObject(probe)[0];
    this.entry.copy(hit ? hit.point : at.addScaledVector(faceOut, 0.05));
    this.skinNormal.copy(faceOut);
    if (hit?.face) this.skinNormal.lerp(hit.face.normal, 0.5).normalize();
    const across = new Vector3(-0.82, 0, 0.35);
    across.addScaledVector(this.skinNormal, -across.dot(this.skinNormal)).normalize();
    const sink = NEEDLE_ANGLE * DEG;
    this.needleDir.copy(across).multiplyScalar(Math.cos(sink)).addScaledVector(this.skinNormal, -Math.sin(sink)).normalize();
    this.dent.value.set(this.entry.x, this.entry.y, this.entry.z, 0);

    // cloth over the hand and over the elbow, so that the arm is only this much
    const flapCloth = this.kit.surface('linen_white', 0.32, { color: new Color(0x5e635e), roughness: 0.96 });
    const flapY = (a: number, b: number, hem: number, hump: number) => {
      const lay = smootherstep(range(0.25, 0.14, Math.abs(b)));
      return GURNEY_TOP + 0.014 + (hump + 0.008 * Math.sin(b * 41 + a * 9)) * Math.exp(-((b / 0.066) ** 2)) * (0.86 + 0.14 * Math.exp(-Math.abs(a - hem) * 22)) * lay + 0.0045 * Math.sin(a * 37 + b * 19) + 0.004 * Math.sin(a * 17 - b * 43);
    };
    const place = (a: number, b: number, target: number[]): number[] => {
      target[0] = ARM_FROM.x + axisOut.x * a + sideOut.x * b;
      target[2] = ARM_FROM.z + axisOut.z * a + sideOut.z * b;
      return target;
    };
    const flap = (a0: number, a1: number, hem: number, hump: number) => {
      const g = clothGrid(a0, a1, -0.25, 0.25, 26, 32, (a, b) => flapY(a, b, hem, hump));
      const pg = g.getAttribute('position') as BufferAttribute;
      const out = [0, 0, 0];
      for (let i = 0; i < pg.count; i++) {
        place(pg.getX(i), pg.getZ(i) + 0.008 * Math.sin(pg.getX(i) * 73), out);
        pg.setXYZ(i, out[0], pg.getY(i), out[2]);
      }
      g.computeVertexNormals();
      return g;
    };
    const over = new Mesh(flap(0.232, 0.6, 0.232, 0.105), flapCloth);
    const back = new Mesh(flap(-0.26, 0.016, 0.016, 0.12), flapCloth);
    // the fold-back of each hem, and the creases the arm has made in the sheet under it
    const hems = new Loft();
    const fold = (t: number): Rgb => {
      const k = 0.22 + 0.05 * Math.sin(t * 90) + 0.04 * Math.sin(t * 37);
      return [k, k, k * 0.96];
    };
    const hemAt = (hemA: number, hump: number) => {
      const pts: V3[] = [];
      for (let i = -8; i <= 8; i++) {
        const b0 = (i / 8) * 0.25;
        const q = place(hemA, b0, [0, 0, 0]);
        pts.push([q[0], flapY(hemA, b0, hemA, hump) + 0.003, q[2]]);
      }
      hems.sweep(pts, 80, 8, (t) => 0.011 * (1 + 0.28 * Math.sin(t * 30)), fold, { squash: 0.7 });
    };
    hemAt(0.232, 0.105);
    hemAt(0.016, 0.12);
    const hemMesh = new Mesh(hems.geometry(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    hemMesh.castShadow = true;
    hemMesh.frustumCulled = false;
    this.gurney.add(hemMesh);
    const creases = new Mesh(
      clothGrid(-0.03, 0.27, -0.34, 0.34, 54, 64, (a, b) => {
        const off = Math.abs(b);
        const lift = 0.018 * Math.exp(-off / 0.09) * (0.5 + 0.5 * Math.sin(b * 28 + a * 12 + 1.7));
        return GURNEY_TOP + 0.02 + lift + 0.0035 * Math.sin(a * 51 - b * 17) + 0.0028 * Math.sin(b * 79 + a * 9);
      }),
      flapCloth,
    );
    const pc = creases.geometry.getAttribute('position') as BufferAttribute;
    const out2 = [0, 0, 0];
    for (let i = 0; i < pc.count; i++) {
      place(pc.getX(i), pc.getZ(i), out2);
      pc.setXYZ(i, out2[0], pc.getY(i) - 0.34 * smootherstep(range(GURNEY_HALF, GURNEY_HALF + 0.08, Math.abs(out2[0]))), out2[2]);
    }
    creases.geometry.computeVertexNormals();
    creases.receiveShadow = true;
    this.gurney.add(creases);
    for (const mesh of [over, back]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.gurney.add(mesh);
    }
    const straps = new Loft();
    const band = (c: Vector3, r0: number, r1: number) => {
      const pts: V3[] = [];
      for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * Math.PI;
        const q = c.clone().addScaledVector(sideOut, Math.cos(a) * r0).addScaledVector(faceOut, Math.sin(a) * r1 - 0.012);
        pts.push([q.x, q.y, q.z]);
      }
      straps.sweep(pts, 32, 6, () => 0.014, () => [0.07, 0.07, 0.065], { squash: 0.14, start: [axisOut.x, axisOut.y, axisOut.z] });
    };
    band(ARM_FROM.clone().addScaledVector(axisOut, 0.215), 0.062, 0.058);
    const strapMesh = new Mesh(straps.geometry(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.72 }));
    strapMesh.castShadow = true;
    strapMesh.frustumCulled = false;
    this.gurney.add(strapMesh);

    // the needle, with a butterfly's small hub; its root is the origin, the tip along +y
    const steel = new MeshStandardMaterial({ vertexColors: true, metalness: 0.65, roughness: 0.2, emissive: 0x4a5052 });
    const shaft = new Mesh(tinted(new CylinderGeometry(0.00042, 0.00075, NEEDLE_L, 8).translate(0, NEEDLE_L / 2, 0), 0.87, 0.9, 0.9), steel);
    shaft.castShadow = true;
    const hub = new Mesh(tinted(new CylinderGeometry(0.0022, 0.0036, 0.028, 10).translate(0, -0.014, 0), 0.72, 0.8, 0.76), this.solid);
    const wing = new Mesh(tinted(new BoxGeometry(0.036, 0.016, 0.0012), 0.3, 0.4, 0.44), this.solid);
    wing.position.set(0, -0.012, 0);
    this.needle.add(shaft, hub, wing);
    const yAxis = new Vector3(0, 1, 0);
    this.needle.quaternion.setFromUnitVectors(yAxis, this.needleDir);
    this.needle.visible = false;

    this.bead = new Mesh(tinted(new SphereGeometry(1, 12, 10), 0.24, 0.01, 0.02), new MeshStandardMaterial({ vertexColors: true, roughness: 0.12, emissive: 0x0b0000 }));
    this.bead.position.copy(this.entry).addScaledVector(this.skinNormal, 0.0006);
    this.bead.scale.setScalar(0.0001);
    this.bead.visible = false;
    this.gurney.add(this.bead);

    // the hand that holds it: palm to the skin, finger and thumb on the hub
    const hand = new Mesh(handGeometry(HAND_PINCH, [0.022, 0.024, 0.028], [0.016, 0.016, 0.02]), new MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));
    hand.castShadow = true;
    hand.frustumCulled = false;
    this.glove.add(hand);
    const yy = this.needleDir.clone();
    const zz = this.skinNormal.clone().negate();
    zz.addScaledVector(yy, -zz.dot(yy)).normalize();
    // turned about the needle, so that we are shown its fingers and not the back of a hand
    zz.applyAxisAngle(yy, GLOVE_TURN);
    const xx = new Vector3().crossVectors(yy, zz);
    this.glove.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(xx, yy, zz));
    this.glove.visible = false;
  }

  /** The line from the needle up to the bag, with what comes up it. */
  private buildTube(): void {
    const hubAt = new Vector3().copy(this.entry).addScaledVector(this.needleDir, NEEDLE_DEEP - NEEDLE_L);
    const start = hubAt.clone().addScaledVector(this.needleDir, -0.026);
    const out = start.clone().addScaledVector(this.needleDir, -0.08);
    const toLocal = (x: number, y: number, z: number): V3 => [x - HOOK.x, y - HOOK.y, z - HOOK.z];
    const points: V3[] = [
      toLocal(start.x, start.y, start.z),
      toLocal(out.x, out.y + 0.01, out.z),
      toLocal(0.5, 1.0, -0.2),
      toLocal(0.62, 1.06, 0.1),
      toLocal(0.62, 1.3, 0.22),
      toLocal(HOOK.x, 1.46, HOOK.z),
    ];
    const steps = 120;
    const sides = 8;
    this.threadSteps = steps;
    this.threadSides = sides;
    const clear = new Loft();
    clear.sweep(points, steps, sides, () => 0.0036, () => [0.84, 0.88, 0.86], { even: true });
    const plastic = new Mesh(clear.geometry(), new MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.34, roughness: 0.2, depthWrite: false, side: DoubleSide }));
    plastic.frustumCulled = false;
    this.tubeLine.add(plastic);
    const red = new Loft();
    red.sweep(points, steps, sides, () => 0.0033, () => [0.34, 0.016, 0.028], { even: true });
    this.redThread = new Mesh(red.geometry(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.3, emissive: 0x340405 }));
    this.redThread.frustumCulled = false;
    this.redThread.visible = false;
    this.tubeLine.add(this.redThread);
    const white = new Loft();
    white.sweep(points, steps, sides, () => 0.0026, (u) => {
      const k = 0.72 + 0.28 * Math.sin(u * 340) * Math.sin(u * 127);
      return [0.92 * k, 0.92 * k, 0.88 * k];
    }, { even: true });
    this.threadShade = this.basicColored();
    this.whiteThread = new Mesh(white.geometry(), this.threadShade);
    this.whiteThread.frustumCulled = false;
    this.whiteThread.visible = false;
    this.tubeLine.add(this.whiteThread);
  }

  /** Unlit and colored per vertex: hair, the white thread, the green line, a lit pane. */
  private basicColored(): MeshBasicMaterial {
    return new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
  }

  /** The bag on the pole, and what is in it. */
  private buildBag(): void {
    const bag = new Group();
    bag.position.set(0, -0.06 - BAG_H / 2, 0);
    bag.rotation.y = -Math.PI / 2 - 0.42;
    this.swing.add(bag);
    const faceAt = (u: number, v: number, sign: number, out: number[]): void => {
      const su = 2 * u - 1;
      const sv = 2 * v - 1;
      const w = (BAG_W / 2) * (1 - 0.1 * sv ** 8);
      const belly = (1 - su * su) ** 0.55 * (1 - sv * sv * sv * sv) ** 0.6;
      const wrinkle = 0.0024 * Math.sin(u * 23 + v * 9) * (1 - belly) + 0.0015 * Math.sin(v * 41 + u * 5);
      out.push(su * w, sv * (BAG_H / 2), sign * (BAG_D * belly + wrinkle * belly));
    };
    const p: number[] = [];
    const ix: number[] = [];
    const cols = 24;
    const rows = 30;
    for (const sign of [1, -1]) {
      const base = p.length / 3;
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) faceAt(i / cols, j / rows, sign, p);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const a = base + j * (cols + 1) + i;
          const b = a + 1;
          const d = a + cols + 1;
          const e = d + 1;
          if (sign > 0) ix.push(a, b, d, b, e, d);
          else ix.push(a, d, b, b, d, e);
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(p, 3));
    geometry.setIndex(ix);
    geometry.computeVertexNormals();
    tinted(geometry, 0.52, 0.58, 0.56);
    this.bagPlastic = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.13, roughness: 0.16, side: DoubleSide, depthWrite: false }));
    this.bagPlastic.renderOrder = 30;
    this.bagPlastic.frustumCulled = false;
    bag.add(this.bagPlastic);

    // the seam it was welded along, its tab, its two ports, and a drip chamber
    const parts = new Loft();
    const milky = (): Rgb => [0.42, 0.47, 0.45];
    const ring: V3[] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * TWO_PI;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      ring.push([Math.sign(ca) * Math.abs(ca) ** 0.28 * (BAG_W / 2), Math.sign(sa) * Math.abs(sa) ** 0.28 * (BAG_H / 2), 0]);
    }
    parts.sweep(ring, 96, 6, () => 0.0045, milky, { squash: 0.2, start: [0, 0, 1] });
    parts.sweep([[0, BAG_H / 2, 0], [0, BAG_H / 2 + 0.025, 0], [0, BAG_H / 2 + 0.06, 0]], 3, 8, () => 0.012, milky, { squash: 0.14, start: [1, 0, 0] });
    parts.sweep([[0.02, -BAG_H / 2, 0], [0.02, -BAG_H / 2 - 0.03, 0]], 2, 8, () => 0.006, milky);
    parts.sweep([[-0.02, -BAG_H / 2, 0], [-0.02, -BAG_H / 2 - 0.024, 0]], 2, 8, () => 0.0048, milky);
    const partMesh = new Mesh(parts.geometry(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.3, transparent: true, opacity: 0.55, side: DoubleSide, depthWrite: false }));
    partMesh.frustumCulled = false;
    bag.add(partMesh);
    const chamber = new Mesh(tinted(new CylinderGeometry(0.009, 0.009, 0.062, 12), 0.8, 0.86, 0.84), new MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.4, roughness: 0.2, side: DoubleSide, depthWrite: false }));
    chamber.position.set(0, -0.06 - BAG_H - 0.075, 0);
    this.swing.add(chamber);

    // the hair: it comes up from the port in long locks that wind around the inside of the plastic
    const rnd = randomFrom(17);
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const pts: V3[] = [];
    const dir = new Vector3();
    for (let l = 0; l < BAG_LOCKS; l++) {
      const a = rnd() * TWO_PI;
      const twist = (rnd() < 0.5 ? -1 : 1) * (3 + rnd() * 6);
      const rise = 0.84 + rnd() * 0.16;
      const open = 0.7 + rnd() * 0.3;
      const f = 1.5 + rnd() * 3;
      const p = rnd() * TWO_PI;
      const lit = 0.3 + rnd() * 0.7;
      for (let h = 0; h < BAG_LOCK_HAIRS; h++) {
        const ox = (rnd() - 0.5) * 0.026;
        const oz = (rnd() - 0.5) * 0.016;
        const reach = 0.72 + rnd() * 0.28;
        const q = rnd() * TWO_PI;
        pts.length = 0;
        for (let k = 0; k <= BAG_SEGMENTS; k++) {
          const u = k / BAG_SEGMENTS;
          const y = -BAG_H / 2 + 0.006 + u ** 0.7 * (BAG_H - 0.024) * rise * reach + 0.006 * Math.sin(u * 13 + q);
          const rr = y / (BAG_H / 2);
          const shape = Math.sqrt(Math.max(0, 1 - rr ** 4));
          const ring = Math.min(1, 0.18 + u * 1.5) * open;
          const ang = a + twist * u + 0.5 * Math.sin(u * f + p);
          pts.push([clamp(Math.cos(ang) * ring * (BAG_W / 2 - 0.012) * shape + ox * (0.25 + u), -BAG_W / 2 + 0.006, BAG_W / 2 - 0.006), y, clamp(Math.sin(ang) * ring * (BAG_D - 0.008) * shape + oz * (0.25 + u), -BAG_D + 0.002, BAG_D - 0.002)]);
        }
        const width = 0.00055 + rnd() * 0.00065;
        const front = clamp(0.5 + (pts[14][2] / BAG_D) * 0.5, 0, 1);
        ribbon(
          pos,
          col,
          idx,
          pts,
          (u) => width * (1 - 0.5 * u),
          (i, out) => {
            const a0 = pts[Math.max(0, i - 1)];
            const b0 = pts[Math.min(pts.length - 1, i + 1)];
            dir.set(b0[0] - a0[0], b0[1] - a0[1], 0).normalize();
            out.set(-dir.y, dir.x, 0);
          },
          ((b0) => (u: number) => b0 * (1 - 0.2 * u))(0.14 + 0.82 * lit * (0.25 + 0.75 * front) * (0.65 + 0.35 * rnd())),
        );
      }
    }
    const hair = new BufferGeometry();
    hair.setAttribute('position', new Float32BufferAttribute(pos, 3));
    hair.setAttribute('color', new Float32BufferAttribute(col, 3));
    hair.setIndex(idx);
    this.bagIndices = idx.length;
    this.bagFill = new Mesh(hair, this.basicColored());
    this.bagFill.frustumCulled = false;
    bag.add(this.bagFill);

    // the print on the plastic; the expiry date is the date you are watching this
    const date = dateNow();
    const printed = single(
      new PlaneGeometry(0.13, 0.2),
      new MeshBasicMaterial({
        map: canvasMap(182, 280, (c) => {
          const w = c.canvas.width;
          const h = c.canvas.height;
          c.clearRect(0, 0, w, h);
          c.fillStyle = 'rgba(40,66,112,0.9)';
          c.font = `700 ${h * 0.1}px Arial, sans-serif`;
          c.fillText('500 ml', w * 0.08, h * 0.13);
          c.font = `${h * 0.05}px Arial, sans-serif`;
          for (let i = 0; i < 5; i++) {
            const y = h * (0.26 + i * 0.13);
            c.fillRect(w * 0.08, y, w * 0.26, h * 0.006);
            c.fillText(String(500 - i * 100), w * 0.4, y + h * 0.02);
          }
          c.fillText(date, w * 0.08, h * 0.97);
        }),
        transparent: true,
        depthWrite: false,
      }),
    );
    printed.position.set(-0.012, 0.002, BAG_D + 0.002);
    printed.renderOrder = 31;
    bag.add(printed);
  }

  /** The one who pushes you: a real face, eyes shut, bent over yours; he straightens up at the doors. */
  private buildOrderly(): void {
    const skin = new MeshStandardMaterial({ vertexColors: true, roughness: ORDERLY_MATTE, emissive: 0x070908 });
    const cloth = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, emissive: 0x161c1b });
    this.orderlyHead = maskedHead(this.kit, skin, cloth);
    const neck = new Loft();
    neck.sweep([[0, -0.07, -0.02], [0, -0.16, -0.03], [0, -0.26, -0.05]], 8, 14, (u) => lerp(0.062, 0.11, u), () => [0.05, 0.06, 0.055]);
    this.orderlyHead.add(new Mesh(neck.geometry(), cloth));
    const x = new Vector3(1, 0, 0);
    const y180 = new Quaternion().setFromAxisAngle(UP, Math.PI);
    this.headFrom.setFromAxisAngle(x, -72 * DEG).multiply(y180).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.16));
    this.headTo.setFromAxisAngle(x, -28 * DEG).multiply(y180);
    this.gurney.add(this.orderlyHead);
    this.orderlyBody = this.build.headless(1, { tint: 0x36463f });
    this.leanOrderly(0);
    this.gurney.add(this.orderlyBody.root);
  }

  /** 0: bent over you. 1: standing straight behind you. */
  private leanOrderly(u: number): void {
    const angle = lerp(24, 7, u) * DEG;
    const feet = lerp(0.92, 1.0, u);
    this.leaning.makeRotationX(-angle).multiply(this.spinBack);
    this.leaning.setPosition(0, 0, feet);
    this.orderlyBody.setMatrix(0, this.leaning);
    this.orderlyBody.commit();
    this.orderlyHead.position.set(0, lerp(1.37, 1.63, u), lerp(0.08, 0.72, u));
    this.orderlyHead.quaternion.slerpQuaternions(this.headFrom, this.headTo, u);
  }

  /** The very old woman in the next bed, once the sheet has slipped; the man who stayed; what lies on her pillow. */
  private buildHer(): void {
    const k = this.kit;
    const g = this.her;
    this.root.add(g);
    g.visible = false;
    const pillowCloth = k.surface('linen_white', 0.45, { color: new Color(0x585c57), roughness: 0.96 });
    k.paint(k.prop('pillow', [0, MATTRESS - 0.05, HER_Z], { scale: 1.08 }, g), pillowCloth);
    const sheetCloth = k.surface('linen_white', 0.42, { color: new Color(0x4d514b), roughness: 0.96 });
    const hem = HER_Z - 0.15;
    const y = (x: number, z: number) => {
      const body =
        0.15 * bump(x, z, 0, HER_Z - 0.48, 0.3, 0.42) +
        0.07 * (bump(x, z, -0.09, HER_Z - 1.2, 0.1, 0.55) + bump(x, z, 0.09, HER_Z - 1.2, 0.1, 0.55)) +
        0.12 * (bump(x, z, -0.09, HER_Z - 1.62, 0.08, 0.09) + bump(x, z, 0.09, HER_Z - 1.62, 0.08, 0.09));
      const folds = 0.006 * Math.sin(x * 17 + z * 9) + 0.004 * Math.sin(x * 31 - z * 16 + 1) + 0.003 * Math.sin(z * 29 + 2 * Math.sin(x * 13));
      return MATTRESS + 0.012 + body + folds - 0.3 * smootherstep(range(0.44, 0.54, Math.abs(x)));
    };
    const sheet = new Mesh(clothGrid(-0.54, 0.54, BED_Z - 1.0, hem, 36, 60, y), sheetCloth);
    sheet.receiveShadow = true;
    g.add(sheet);
    const roll = new Loft();
    roll.sweep([[-0.5, y(-0.5, hem), hem], [-0.2, y(-0.2, hem) + 0.006, hem], [0.2, y(0.2, hem) + 0.006, hem], [0.5, y(0.5, hem), hem]], 40, 8, (s) => 0.018 * (1 + 0.14 * Math.sin(s * 23)), () => [0.3, 0.31, 0.28], { squash: 0.55 });
    const rollMesh = new Mesh(roll.geometry(), this.solid);
    rollMesh.frustumCulled = false;
    g.add(rollMesh);

    // her head, turned away from you; only its back shows, and little of that
    const head = k.prop('mri_head', [0, MATTRESS + 0.155, HER_Z], { scale: 0.225, anchor: 'center' }, g);
    k.paint(head, new MeshStandardMaterial({ vertexColors: true, color: new Color(1.9, 1.85, 1.7), roughness: 0.6 }));
    const c15 = Math.cos(15 * DEG);
    const s15 = Math.sin(15 * DEG);
    head.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(-s15, c15, 0), new Vector3(0, 0, 1), new Vector3(c15, s15, 0)));

    // her hand, open, on the sheet, as near to you as the bed allows
    const oldSkin: Rgb = [0.3, 0.27, 0.23];
    const hand = new Mesh(handGeometry(HAND_OPEN, oldSkin, [0.3, 0.31, 0.29], 0.3), new MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
    const wristY = new Vector3(-0.92, -0.04, -0.38).normalize();
    const palmUp = new Vector3(0, 1, 0).addScaledVector(wristY, -wristY.y).normalize();
    const thumbSide = new Vector3().crossVectors(wristY, palmUp);
    hand.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(thumbSide, wristY, palmUp));
    hand.position.set(-0.29, MATTRESS + 0.08, HER_Z - 0.46);
    hand.scale.setScalar(0.94);
    hand.frustumCulled = false;
    g.add(hand);

    // her hair: it has been growing across the pillow, and over the edge, for a very long time
    const rnd = randomFrom(29);
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const pts: V3[] = [];
    const dir = new Vector3();
    const pillow = (x: number, zz: number) => {
      const dome = Math.max(0, 1 - (x / 0.36) ** 2 - ((zz - HER_Z) / 0.19) ** 2);
      const fall = Math.max(0, -x - 0.45);
      return MATTRESS + 0.004 + 0.085 * dome ** 0.5 - Math.min(0.5, fall * 1.8);
    };
    let lockAngle = 0;
    let lockCurl = 0;
    let lockLeft = 0;
    for (let n = 0; n < FAN_HAIRS; n++) {
      if (lockLeft-- <= 0) {
        lockAngle = Math.PI + (rnd() * 2 - 1) * 2.05;
        lockCurl = (rnd() - 0.5) * 0.9;
        lockLeft = 5 + Math.floor(rnd() * 22);
      }
      const start = lockAngle + (rnd() - 0.5) * 0.25;
      // it goes farther along the pillow than toward its edge, so that it lies around her head and hangs from nowhere
      const toward = Math.abs(Math.cos(start));
      const length = lerp(0.56, 0.34, toward) * (0.5 + rnd() ** 1.8 * 1.25);
      const step = length / FAN_SEGMENTS;
      const overHead = rnd() < 0.12;
      const r0 = overHead ? 0.02 + rnd() * 0.06 : 0.088 + rnd() * 0.03;
      const wander = 0.22 + rnd() * 0.4;
      const f1 = 0.5 + rnd() * 0.7;
      const p1 = rnd() * TWO_PI;
      const drift = ((lockCurl + (rnd() - 0.5) * 0.35) / FAN_SEGMENTS) * 2;
      let hx = Math.cos(start) * r0;
      let hz = HER_Z + Math.sin(start) * r0;
      let dirA = start;
      pts.length = 0;
      for (let k = 0; k <= FAN_SEGMENTS; k++) {
        const u = k / FAN_SEGMENTS;
        pts.push([hx, pillow(hx, hz) + 0.003 + Math.max(0, 1 - u / 0.38) ** 2 * (overHead ? 0.17 : 0.095), hz]);
        dirA += drift + wander * Math.sin(k * f1 + p1);
        hx += Math.cos(dirA) * step;
        hz += Math.sin(dirA) * step;
      }
      ribbon(
        pos,
        col,
        idx,
        pts,
        (u) => 0.00062 * (1 - 0.6 * u),
        (i, out) => {
          const a0 = pts[Math.max(0, i - 1)];
          const b0 = pts[Math.min(pts.length - 1, i + 1)];
          dir.set(b0[0] - a0[0], 0, b0[2] - a0[2]).normalize();
          out.set(-dir.z, 0, dir.x);
        },
        ((b0) => (u: number) => b0 * (1 - 0.5 * u))(0.32 + 0.6 * rnd()),
      );
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(col, 3));
    geometry.setIndex(idx);
    this.fanIndices = idx.length;
    this.fan = new Mesh(geometry, this.basicColored());
    this.fan.frustumCulled = false;
    g.add(this.fan);

    // two who wait: one at your knee, with the gloves; one on the far side of her bed
    this.men = this.build.headless(2, { tint: 0x66727a });
    this.men.set(0, LANE_X + 0.98, 0, STOP_Z - 1.5, -Math.PI / 2 + 0.5);
    this.men.set(1, 0.92, 0, HER_Z - 0.42, -Math.PI / 2);
    this.men.commit();
    this.root.add(this.men.root);
    this.men.root.visible = false;
  }

  /** The monitor on its column behind her head; its picture is drawn here, not in the model. */
  private buildMonitor(): void {
    const k = this.kit;
    const g = this.wardRoom;
    const mz = HER_Z + 0.3;
    const prop = k.prop('monitor_ecg', [1.25, 0.58, mz], { rotation: [0, -90, 0] }, g);
    const column = new Mesh(tinted(new CylinderGeometry(0.04, 0.04, WH, 12), 0.22, 0.24, 0.23), this.solid);
    column.position.set(1.78, WH / 2, mz);
    g.add(column);
    prop.updateWorldMatrix(true, true);
    let screenAt = new Vector3(0.82, 1.1, mz);
    let w = 0.3;
    let h = 0.16;
    prop.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const materials = Array.isArray(m.material) ? m.material : [m.material];
      const isScreen = materials.some((x) => x.name.includes('ECG_Monitor'));
      tinted(m.geometry, 0.11, 0.13, 0.14);
      m.material = this.solid;
      if (!isScreen) return;
      m.geometry.computeBoundingBox();
      const box = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
      box.min.sub(this.origin);
      box.max.sub(this.origin);
      screenAt = new Vector3(box.min.x - 0.004, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
      w = box.max.z - box.min.z;
      h = box.max.y - box.min.y;
    });
    const screen = new Group();
    screen.position.copy(screenAt);
    screen.rotation.y = -Math.PI / 2;
    g.add(screen);
    const back = new Mesh(tinted(new PlaneGeometry(w, h), 0.004, 0.012, 0.01), this.basicColored());
    screen.add(back);
    this.traceW = w * 0.92;
    this.traceH = h * 0.55;
    const count = (TRACE_N + 1) * 2;
    this.tracePositions = new Float32Array(count * 3);
    this.traceColors = new Float32Array(count * 3);
    const ix: number[] = [];
    for (let i = 0; i < TRACE_N; i++) {
      const a = i * 2;
      ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.traceGeometry = new BufferGeometry();
    const attr = new BufferAttribute(this.tracePositions, 3);
    attr.setUsage(DynamicDrawUsage);
    this.traceGeometry.setAttribute('position', attr);
    const color = new BufferAttribute(this.traceColors, 3);
    color.setUsage(DynamicDrawUsage);
    this.traceGeometry.setAttribute('color', color);
    this.traceGeometry.setIndex(ix);
    const trace = new Mesh(this.traceGeometry, this.basicColored());
    trace.position.z = 0.002;
    trace.frustumCulled = false;
    screen.add(trace);
    this.screenMap = canvasMap(256, 128, (c) => (this.screenCanvas = c));
    const digits = single(new PlaneGeometry(w * 0.42, h * 0.34), new MeshBasicMaterial({ map: this.screenMap, transparent: true, depthWrite: false }));
    digits.position.set(w * 0.26, h * 0.3, 0.003);
    screen.add(digits);
    this.writeScreen('72', '');
  }

  /** The eye's small movements, on top of the keys, and the wheels carrying it. */
  pose(t: number, out: RoomPose): RoomPose {
    super.pose(t, out);
    const s = t * this.seconds;
    const zAlong = rolled(s);
    out.position.x += laneAt(s);
    out.position.z -= zAlong;
    out.yaw += headingAt(s);
    const moving = rollingAt(s);
    if (moving > 0.001) {
      out.position.y += moving * reduced * (0.0014 * Math.sin(s * 43) + 0.001 * Math.sin(s * 71 + 1.3) + 0.003 * Math.abs(Math.sin(zAlong * 2.6)) ** 24);
      out.roll += moving * reduced * 0.0022 * Math.sin(s * 29 + 0.7);
    }
    out.position.y += 0.003 * Math.sin(s * 1.3) * (1 - Math.min(1, moving * 2));
    return out;
  }

  /** How far the needle is back from the skin, along its own line (negative: it is in). */
  private carried(s: number): number {
    if (s < NEEDLE_COMES) return 0.34;
    if (s < NEEDLE_THERE) return lerp(0.34, 0.006, ease(NEEDLE_COMES, NEEDLE_THERE, s));
    if (s < NEEDLE_PRESS) return 0.006;
    if (s < SKIN_GIVES) return lerp(0.006, -0.0045, range(NEEDLE_PRESS, SKIN_GIVES, s) ** 2);
    return lerp(-0.0045, -NEEDLE_DEEP, smootherstep(range(SKIN_GIVES, NEEDLE_IN, s)));
  }

  /** The nearest beep to a moment, and how long it was from that moment. */
  private ecgAt(at: number): number {
    if (at > FLAT_AT || this.beeps.length === 0) return 0;
    let lo = 0;
    let hi = this.beeps.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (this.beeps[m] <= at) lo = m;
      else hi = m - 1;
    }
    const near = lo + 1 < this.beeps.length && this.beeps[lo + 1] - at < at - this.beeps[lo] ? lo + 1 : lo;
    const tau = at - this.beeps[near];
    if (at < this.beeps[0] - 0.4) return 0;
    return 0.12 * Math.exp(-(((tau + 0.16) / 0.035) ** 2)) - 0.14 * Math.exp(-(((tau + 0.03) / 0.012) ** 2)) + Math.exp(-((tau / 0.014) ** 2)) - 0.26 * Math.exp(-(((tau - 0.035) / 0.016) ** 2)) + 0.24 * Math.exp(-(((tau - 0.24) / 0.055) ** 2));
  }

  /** The green line, a pure function of the moment. */
  private drawTrace(s: number): void {
    const p = this.tracePositions;
    const c = this.traceColors;
    const head = ((s % TRACE_SWEEP) + TRACE_SWEEP) % TRACE_SWEEP;
    const dx = this.traceW / TRACE_N;
    let prev = 0;
    for (let i = 0; i <= TRACE_N; i++) {
      const x = i / TRACE_N;
      let age = head / TRACE_SWEEP - x;
      if (age < 0) age += 1;
      const y = this.ecgAt(s - age * TRACE_SWEEP) * this.traceH * 0.5 - this.traceH * 0.1;
      const next = this.ecgAt(s - (age - 1 / TRACE_N < 0 ? age - 1 / TRACE_N + 1 : age - 1 / TRACE_N) * TRACE_SWEEP) * this.traceH * 0.5 - this.traceH * 0.1;
      const dy = (i === 0 ? next - y : next - prev) / (i === 0 ? 1 : 2);
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * 0.0026;
      const ny = (dx / len) * 0.0026;
      const px = (x - 0.5) * this.traceW;
      p[i * 6] = px + nx;
      p[i * 6 + 1] = y + ny;
      p[i * 6 + 2] = 0;
      p[i * 6 + 3] = px - nx;
      p[i * 6 + 4] = y - ny;
      p[i * 6 + 5] = 0;
      const glow = age > 0.94 ? 0 : (1 - 0.72 * age) * 2.3;
      c[i * 6] = c[i * 6 + 3] = 0.16 * glow;
      c[i * 6 + 1] = c[i * 6 + 4] = 1 * glow;
      c[i * 6 + 2] = c[i * 6 + 5] = 0.52 * glow;
      prev = y;
    }
    this.traceGeometry.getAttribute('position').needsUpdate = true;
    this.traceGeometry.getAttribute('color').needsUpdate = true;
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const zNow = -rolled(s);
    this.gurney.position.set(laneAt(s), 0, zNow);
    this.gurney.rotation.y = headingAt(s);
    this.feetLight.position.set(this.origin.x + laneAt(s) + 0.8, this.origin.y + 1.5, this.origin.z + zNow - 1.3);
    this.feetLight.intensity = 0.5 * ease(19.4, 21, s) * (1 - ease(STOP_AT, LOOK_AT_ARM, s));
    this.manLight.intensity = 2.4 * ease(LINE_MOTHER, 43.6, s) * (1 - ease(46.4, 48, s));

    for (const c of this.clocks) c.value = frame.time;

    this.corridor.visible = s < DOORS_SHUT + 1;
    this.wardRoom.visible = s > DOORS_HIT - 1.5;

    // the bag swings on its hook while the gurney rolls, and comes to rest
    const left = s < STOP_AT ? 1 - 0.5 * range(BRAKE_AT, STOP_AT, s) : Math.exp(-(s - STOP_AT) * 1.5);
    const swing = SWING * left * Math.sin((s / SWING_PERIOD) * TWO_PI) * reduced;
    this.swing.rotation.x = swing;
    this.swing.rotation.z = swing * 0.35;
    this.rightRail.position.y = -0.3 * ease(STOP_AT + 0.3, STOP_AT + 0.75, s);
    this.leanOrderly(ease(16.2, 19, s) * (1 - ease(SHEET_FROM - 0.4, SHEET_FROM, s)));

    // the doors: open as the gurney's end reaches them, back when you have gone through
    const open = ease(DOORS_HIT, DOORS_HIT + 0.9, s) * (1 - ease(DOORS_BACK, DOORS_SHUT, s));
    this.doorLeaves[0].rotation.y = 1.72 * open;
    this.doorLeaves[1].rotation.y = -1.72 * open;

    // how much tube light is overhead right now, for what the lights cannot reach
    let near = 0;
    for (const z of this.litTubes) {
      const d = z - zNow;
      near = Math.max(near, Math.exp(-(d * d) / 6));
    }
    const hairTone = 0.18 + 0.72 * near;
    for (const m of this.hairShades) m.color.setRGB(0.72 * hairTone, 0.71 * hairTone, 0.66 * hairTone);

    this.updateLook(s);
    this.updateNeedle(s);
    this.updateFlow(frame, s);
    this.updateNeighbour(frame, s);
    if (s > BEEP_FROM - 1) this.drawTrace(s);
    this.updateBeeps(s);

    // light: the lamp over her breathes a little and dims when everything is over
    const kk = 1 + 0.05 * wobble(frame.time * 0.7, 5) - 0.1 * Math.max(0, wobble(frame.time * 0.31, 9) - 0.75) * 4;
    const aside = 1 - 0.95 * ease(LOOK_AT_ARM, LOOK_AT_ARM + 0.8, s) * (1 - ease(LINE_MOTHER, LINE_MOTHER + 2, s));
    this.keyLight.angle = lerp(KEY_ANGLE, KEY_NARROW, ease(LINE_MOTHER, 47, s));
    const herPool = 1 - 0.3 * ease(46, 47.5, s);
    this.keyLight.intensity = KEY_POWER * kk * (s < DOORS_HIT ? 0 : 1) * aside * herPool * (1 - 0.85 * ease(HAND_OVER, CUT_AT - 1, s));
    this.lampGlow.color.setRGB(2.6 * kk, 2.7 * kk, 2.5 * kk);
    this.movingShadows = s > 23 && s < ARM_LAMP_OFF + 0.2;
    this.spots = s > LOOK_AT_ARM - 0.3 && s < ARM_LAMP_OFF ? this.armSpots : this.wardSpots;
    this.armLight.intensity = ARM_POWER * ease(LOOK_AT_ARM - 0.3, LOOK_AT_ARM + 0.2, s) * (1 - ease(ARM_LAMP_OFF - 1.4, ARM_LAMP_OFF, s));
    this.farGlow.visible = s < LOOK_AT_ARM;
    this.nearGlow.visible = s >= LOOK_AT_ARM;
  }

  /** The curtain the eyelids make, the lens, how afraid the piece is. */
  private updateLook(s: number): void {
    let black = 1 - range(0, 0.9, s);
    black = Math.max(black, blinkAt(s, 10.8), blinkAt(s, 17.1) * 0.9);
    black = Math.max(black, range(HAND_OVER - 0.25, HAND_OVER + 0.1, s) * (1 - range(SHEET_FROM + 0.05, SHEET_FROM + 0.6, s)));
    black = Math.max(black, range(CUT_AT - 0.4, CUT_AT, s));
    this.black = black;

    let f = 1.6;
    let a = 1.2;
    const wide = ease(20, 23, s);
    f = lerp(f, 9, wide);
    a = lerp(a, 3, wide);
    const arm = ease(LOOK_AT_ARM, 29.4, s);
    f = lerp(f, 0.57, arm);
    a = lerp(a, 9, arm);
    const up = ease(34.6, 38.5, s);
    f = lerp(f, 0.74, up);
    a = lerp(a, 8, up);
    const him = ease(LINE_MOTHER, 44.4, s);
    f = lerp(f, 2.5, him);
    a = lerp(a, 4, him);
    const her = ease(45, 47.2, s);
    f = lerp(f, 1.6, her);
    a = lerp(a, 7, her);
    const end = ease(HAND_OVER - 0.2, HAND_OVER + 0.2, s);
    f = lerp(f, 0.16, end);
    a = lerp(a, 11, end);
    this.focus = f;
    this.aperture = a;

    let fear = lerp(0.3, 0.45, ease(20, 26, s));
    fear = lerp(fear, 0.72, ease(LOOK_AT_ARM, NEEDLE_THERE, s));
    fear = lerp(fear, 0.92, ease(RED_FROM, WHITE_TOP, s));
    fear = lerp(fear, 1, ease(LINE_MOTHER, FLAT_AT, s));
    this.fear = s < FLAT_AT ? fear : 0;

    this.air.fog.density = lerp(0.055, 0.042, ease(19, 23, s));

    // the hand comes down and shuts everything
    const hand = range(HAND_FROM, HAND_OVER, s);
    this.closingHand.visible = hand > 0 && hand < 1;
    if (this.closingHand.visible) {
      const e = hand * hand * (3 - 2 * hand);
      this.closingHand.position.set(0.01, lerp(0.46, 0.09, e), lerp(-0.45, -0.09, e));
      this.closingHand.rotation.x = lerp(0.5, 0, e);
    }

    // the sheet comes up from your feet: you look through cloth, and less and less comes through it
    const sheet = range(SHEET_FROM, SHEET_OVER, s);
    this.coverSheet.visible = sheet > 0;
    if (this.coverSheet.visible) {
      this.coverSheet.position.y = lerp(-0.47, -0.04, smootherstep(sheet));
      const pass = 0.2 * Math.exp(-(((s - 56.1) / 0.45) ** 2));
      (this.coverSheet.material as MeshBasicMaterial).color.setScalar(lerp(0.74, 0.13, ease(SHEET_OVER - 0.4, CUT_AT - 0.3, s)) + pass);
    }
  }

  private updateNeedle(s: number): void {
    const carry = this.carried(s);
    const gone = ease(GLOVE_LEAVES, GLOVE_LEAVES + 1.4, s);
    this.needle.visible = s >= NEEDLE_COMES;
    this.glove.visible = s >= NEEDLE_COMES && gone < 1;
    this.v.copy(this.entry).addScaledVector(this.needleDir, -carry - NEEDLE_L);
    this.needle.position.copy(this.v);
    if (this.glove.visible) {
      this.glovePosition.copy(PINCH_POINT).applyQuaternion(this.glove.quaternion);
      this.glove.position.copy(this.v).sub(this.glovePosition);
      this.glove.position.x += 0.42 * gone;
      this.glove.position.y += 0.12 * gone;
    }
    // the line moves with the needle, and is where it belongs once the needle is in
    this.tubeLine.position.copy(this.needleDir).multiplyScalar(-(carry + NEEDLE_DEEP));

    const press = range(NEEDLE_PRESS, SKIN_GIVES, s) ** 1.6;
    const gives = 1 - 0.62 * ease(SKIN_GIVES, SKIN_GIVES + 0.5, s);
    this.dent.value.w = press * gives;
    const inside = Math.max(0, -carry);
    this.v.copy(this.entry).addScaledVector(this.needleDir, inside);
    this.ridgeFrom.value.copy(this.entry);
    this.ridgeTo.value.set(this.v.x, this.v.y, this.v.z, 0.0016 * range(0.003, NEEDLE_DEEP, inside));
    const bead = ease(NEEDLE_IN - 0.4, NEEDLE_IN + 0.8, s);
    this.bead.visible = bead > 0;
    if (this.bead.visible) this.bead.scale.set(0.0017 * bead, 0.001 * bead, 0.0017 * bead);
  }

  private updateFlow(frame: RoomFrame, s: number): void {
    const steps = this.threadSteps;
    const quad = this.threadSides * 6;
    const red = range(RED_FROM, RED_TOP, s);
    const white = range(WHITE_FROM - 0.2, WHITE_TOP, s);
    const redFront = Math.floor(red * steps);
    const whiteFront = Math.floor(white * steps);
    this.redThread.visible = redFront > whiteFront;
    if (this.redThread.visible) this.redThread.geometry.setDrawRange(whiteFront * quad, (redFront - whiteFront) * quad);
    this.whiteThread.visible = whiteFront > 0;
    if (this.whiteThread.visible) {
      this.whiteThread.geometry.setDrawRange(0, whiteFront * quad);
      const line = 1 - 0.76 * ease(LINE_MOTHER, 45, s);
      this.threadShade.color.setRGB(line, line, line);
    }
    // it was never empty: from the start something pale can be seen in the bag, and then the rest of it arrives
    const grow = 0.18 + 0.2 * range(RED_TOP - 2, WHITE_FROM, s) + 0.62 * ease(WHITE_FROM, WHITE_TOP + 0.3, s);
    this.bagFill.geometry.setDrawRange(0, Math.floor(grow * (this.bagIndices / 6)) * 6);
    this.bagPlastic.scale.z = 1 + 0.2 * ease(WHITE_FROM, WHITE_TOP, s);
    this.bagLight.intensity = 1.3 * ease(RED_TOP - 1, WHITE_TOP, s) * (1 - ease(LINE_MOTHER, LINE_MOTHER + 1.6, s));
    // the picture is taken when you are looking at it, or a moment later if you are not
    if (!this.shot && s >= SHUTTER_AT && ((Math.abs(frame.input.gazeYaw) < 0.4 && Math.abs(frame.input.gazePitch) < 0.4) || s >= SHUTTER_LATEST)) {
      this.shot = true;
      this.shutter();
    }
  }

  private updateNeighbour(frame: RoomFrame, s: number): void {
    // the sheet slips while you look at your arm, or when you are no longer looking at it
    if (s < SLIP_EARLIEST) this.slipped = false;
    else if (!this.slipped && (this.unseen(frame, 0, 0.7, HER_Z, 10) || s > SLIP_LATEST)) this.slipped = true;
    this.her.visible = this.slipped;
    this.covered.visible = !this.slipped;
    this.men.root.visible = this.slipped && s < SHEET_FROM;
    const grown = 0.72 + 0.28 * range(LINE_MOTHER, FLAT_AT, s);
    this.fan.geometry.setDrawRange(0, Math.floor(grown * (this.fanIndices / 6)) * 6);
  }

  private updateBeeps(s: number): void {
    if (s < this.beeps[0] - 0.4) this.nextBeep = 0;
    let last = 0;
    while (this.nextBeep < this.beeps.length && this.beeps[this.nextBeep] <= s) {
      const at = this.beeps[this.nextBeep++];
      if (s - at < 0.2) this.sound.play('rooms/monitor_beep.mp3', { gain: 0.16, reverb: 0.1, pan: 0.35 });
      last = at;
      if (this.nextBeep % 3 === 0) this.writeScreen(String(Math.round(60 / Math.max(0.36, this.beepGapAt(this.nextBeep)))), '');
    }
    const after = last > 0 ? s - last : 1;
    const flatGlow = s >= FLAT_AT ? 0.14 : 0.08;
    this.monitorLight.intensity = (flatGlow + 0.14 * Math.exp(-after * 8)) * (s < BEEP_FROM - 1 ? 0 : 1) * (1 - ease(HAND_OVER, SHEET_FROM, s));
  }

  /** The monitor's small print: a number, and at the end the time it is where you are. */
  private writeScreen(value: string, when: string): void {
    const c = this.screenCanvas;
    const w = c.canvas.width;
    const h = c.canvas.height;
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgb(90,255,160)';
    c.textAlign = 'right';
    c.font = `700 ${h * 0.62}px Arial, sans-serif`;
    c.fillText(value, w * 0.96, h * 0.66);
    if (when) {
      c.font = `${h * 0.26}px Arial, sans-serif`;
      c.fillText(when, w * 0.96, h * 0.96);
    }
    this.screenMap.needsUpdate = true;
  }

  private beepGapAt(i: number): number {
    if (i <= 0 || i >= this.beeps.length) return 1;
    return this.beeps[i] - this.beeps[i - 1];
  }
}
