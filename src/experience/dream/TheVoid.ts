import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  FrontSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  type Material,
  type SkinnedMesh,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { dreamConfig } from '../../config/dream.config';
import { photoConfig, REDUCED_MOTION } from '../../config/experience.config';
import { LAYOUT, type SpotSpec } from '../../config/nightmare.config';
import { LIGHT_COLORS } from '../../config/scene.config';
import { DEG, lerp, range, smootherstep } from '../math';
import { WARP_GLSL, warpUniforms } from '../render/Warp';
import { PropCrowd, type DreamKit } from './DreamKit';
import type { DreamFrame, DreamModule } from './DreamModule';
import { hairMap, headMap, randomFrom } from './FigureKit';
import type { GiantPrint } from './GiantPrint';

type V3 = readonly [number, number, number];

const voidConfig = {
  /** Nothing of this is drawn from farther up the walk than this (z, m): the meat hides it. */
  seenFrom: -160,
  /** The lights of this place come up over this many meters after the meat ends, so that nothing switches on. */
  lightUp: 6,

  /**
   * The one hard cold light, from high in front, narrowly on the print and its hooks. It comes down steeply, so that
   * its pool on the plane of the print is long: from under the paper's foot up the chains, which go dark around 14 m.
   */
  key: { position: [0, 30.8, -207.7] as V3, target: [0, 7.76, -222] as V3, color: 0xbfd3ff, intensity: 15000, angle: 9.5, penumbra: 0.5 },
  /** Very dim, skimming the water from far off behind the print: what stands in the water gets an edge, the chains a thread of light. */
  rake: { position: [40, 1.6, -255] as V3, target: [0, 0.6, -205] as V3, color: 0x9db8e0, intensity: 700, angle: 26, penumbra: 0.9 },

  water: {
    /** Half width (m) of the part that bends with curved space, then the far part: half width, far z, cells (x, z). */
    halfWidth: 60,
    far: { halfWidth: 150, to: -345, cells: [24, 10] as const },
    /** It runs under the closed mouth, but it only begins behind the teeth: it fades in between these z (m). */
    begins: [-187.3, -188.1] as const,
    /** Its own near-black. */
    body: 0x010102,
    /** Share of what lies above it that it mirrors, straight down and at grazing angles, and how fast it rises (power). */
    reflectance: [0.14, 0.96, 3] as const,
    /** How much a ripple's slope turns the surface for that mirroring. */
    tilt: 2.5,
    /** Flat water shows nothing of the raking light; a slope facing it catches this much (color, strength per unit of slope). */
    sheen: { color: 0x9db8e0, strength: 2.2 },
  },

  /** Rings on the water: the only thing that moves, and you make them. */
  rings: {
    /** How many at once from each source: your steps, the one who retreats, the chair, the arms. */
    slots: { viewer: 6, figure: 2, chair: 2, arms: 2 },
    /** Speed of the front (m/s), life (s; it dies in the last share of it), how fast it weakens (s) and how it spreads thin (m). */
    speed: 3.6,
    life: 5.6,
    dying: 0.6,
    decay: 3.5,
    spread: 4,
    /** It grows in over this many seconds. */
    born: 0.25,
    /** The train of waves around the front: half width (m) and its growth per m of radius, wavelength (m) and its growth per m. */
    width: 0.55,
    widen: 0.07,
    wave: 0.55,
    waveGrowth: 0.035,
    /** A wave fades as one pixel grows from the first to the second share of its wavelength (no shimmer far away). */
    fade: [0.2, 0.6] as const,
    /** How far a slope throws a reflection, per m of the reflected path (a real mirror would give 2). */
    bend: 2.4,
    /** Your steps: m walked between them, how far ahead of the eye the water feels them (m), each foot off the line (m), slope at birth. */
    step: { every: 1.5, lead: 2.5, foot: 0.18, strength: 0.045 },
    /** Those of the one who retreats, of the chair at each end of its rocking, of an arm coming up (m walked, slope at birth). */
    figure: { every: 1.2, strength: 0.03 },
    chair: { strength: 0.016 },
    arm: { strength: 0.03 },
  },

  /** The print in the water: the paper's brightness there (the image keeps its own), how far the rings may throw it (m), cells of its plane. */
  reflection: { paper: 0xdfe7f5, paperGain: 1.6, image: 1, margin: 1.4, cells: 8 },
  /** Things are darker just over the water that wets them: down to this share, over this height (m). */
  wet: { dark: 0.35, height: 0.22 },

  /** The photographer's double: it faces you, aims, and as you come closer it grows smaller and backs through the print. */
  figure: {
    clipTime: 2.9,
    /** Where it stands, ankle deep (m). */
    home: [0, -0.1, -212] as V3,
    /** deg; 0 faces +Z, back up the walk. */
    heading: 0,
    /** How far you are along the walk (m) from where it stood when it starts and has finished shrinking, and to what. */
    shrink: [19, 8] as const,
    least: 0.55,
    /** The same for its backing away, and where to (z, m): far enough behind the print that the gap under the paper hides it. */
    retreat: [17.5, 1] as const,
    toZ: -224.5,
    /** Its reflection does not go through: it stops here (z, m), at the print's foot, upside down, and waits there until you have passed. */
    reflectionStops: -221.6,
    /** Seed of its whitened hair, what its camera may cost, what its reflection may cost (triangles). */
    seed: 13,
    camera: 1500,
    reflected: 2400,
    /** A narrow cold light straight over it, only for it: its white hair (m over the water, m ahead of it, candela, half angle deg). */
    top: { height: 9, ahead: 0.5, color: 0xcfdcf5, intensity: 110, angle: 7, penumbra: 0.6 },
    /** It goes out over this share of the backing away. */
    topOut: [0.75, 0.97] as const,
  },

  /**
   * Things far off in the black, each seen only in its own bulb's small pool of light. They stand far enough along
   * the walk to be in the frame of the camera that looks straight ahead (nearer, nobody would ever see them unless
   * they turned), and never come closer than 12 m. The bulbs light their own things in the material: they need no
   * place among the dream's six lights, where the meat's own lamps would crowd them out.
   */
  stillLife: {
    bulb: {
      /** Times real size (one sees it from 25 m), from the socket's top to the filament (m at real size), the socket's seat of the bulb (m). */
      scale: 2.2,
      drop: 0.105,
      seat: 0.04,
      /** Linear brightness of the glass, triangles of socket and bulb each. */
      glow: 14,
      triangles: 120,
      /** Its halo in the air and its reflection drawn out on the water: size (m), strength. */
      halo: { size: 1.5, strength: 0.5 },
      streak: { width: 0.8, height: 5, strength: 0.35 },
      /** The small pool it makes on the water: radius (m), brightness of the still water, and how much a slope adds. */
      pool: { radius: 3.2, strength: 0.035, stirred: 60 },
    },
    /** The cords, straight up: radius (m), length (m), how fast they fall dark above the bulb (m), brightness near it. */
    cord: { radius: 0.012, length: 30, rows: 16, falloff: 1.5, glow: 0.18 },
    /** How tightly a halo gathers around its bulb. */
    haloTight: 5,
    chair: {
      at: [-13, -0.05, -226] as V3,
      /** Too large by this (nothing here gives away a size, and it has to be read from 30 m). */
      scale: 1.7,
      /** deg; it faces the way you come. */
      heading: 39,
      triangles: 1500,
      /** Bulb height (m), candela. */
      bulb: 3.4,
      candela: 12,
      /** Rocking: deg, s, and the radius of its runners (m). */
      rock: { angle: 7, period: 3.7, radius: 1.5 },
    },
    phone: {
      at: [22, 0, -227] as V3,
      /** Too large by this, as the chair. */
      scale: 1.6,
      /** deg: which way it faces, and how far the pole has gone over. */
      heading: -47,
      lean: [5, -9] as const,
      triangles: 1500,
      /** Its height on the pole and how far it sticks out in front of it (m); the pole: top and bottom (m), radius (m). */
      height: 1.35,
      out: 0.07,
      pole: { top: 1.65, bottom: -1.2, radius: 0.05, sides: 6 },
      bulb: 4.1,
      candela: 16,
    },
    car: {
      at: [-11, -0.5, -246] as V3,
      rotation: [5, 28, -4] as V3,
      bulb: 3.2,
      candela: 16,
    },
    cage: {
      /** The foot of the scan (chain and all): it hangs just over the water. */
      at: [-30, 2.2, -236] as V3,
      height: 9,
      triangles: 1600,
      /** Painted (the scan has no UVs): rust. */
      color: 0x6a3a20,
      roughness: 0.8,
      metalness: 0.35,
      /** The dim light inside it: height over its foot (m), candela. */
      lightAt: 1.7,
      candela: 6,
      /** It turns a little on its chain (deg, s). */
      turn: { angle: 12, period: 47 },
    },
  },

  /** Rocking and rings, but gently, for visitors who ask for less motion. */
  reducedMotion: 0.35,

  /** What has come up behind you: only after this share of the walk, and only while it is not seen. */
  arms: {
    count: 50,
    after: 0.8,
    /** Wider than the view by this (deg) for "not seen". */
    margin: 8,
    /**
     * They stand between these z (m), off the way by at least `clear` m and at most that plus `spread`, gathered toward
     * it. One only comes up once you are this far past it (m): wherever you turn, the nearest are just behind you.
     */
    z: [-190, -214] as const,
    behind: 2,
    clear: 1.7,
    spread: 16,
    gather: 1.6,
    spacing: 1.3,
    tries: 40,
    /** Height (m: the scan is 1 m tall) and how much of it stays under water (share). */
    scale: [1, 1.4] as const,
    sink: [0.08, 0.5] as const,
    /** The cast leans back (deg): stood up straight first; then each leans toward the way (deg), turned about that much (rad), all reaching for this point. */
    straighten: -16,
    lean: [6, 18] as const,
    astray: 0.35,
    reach: [0, -212] as const,
    /** Seconds not seen before one starts, and that it takes to come all the way up; it sinks in this many when you go back. */
    wait: [0, 2.5] as const,
    rise: [3, 5] as const,
    sinkBack: 3.5,
    /** Pale: no map (its map carries a museum's label). */
    color: 0xd6cfc2,
    roughness: 0.62,
    /** The few nearest the way are finer; triangles of a near one, a far one, a reflection. */
    near: 6,
    triangles: { near: 1500, far: 380, reflected: 180 },
    seed: 23,
  },

  /** Far beyond the print, higher than anything: black on black, only a thread of cold light around it. */
  idol: {
    at: [0, -5, -300] as V3,
    height: 60,
    heading: 0,
    triangles: 2200,
    /** Linear strength of the rim, how thin it is (power), the side it comes from, and the walk over which it appears. */
    rim: { color: 0xbcd0ff, strength: 0.032, power: 2.6, from: [-0.35, 0.9, 0.2] as V3 },
    fadeIn: [0.75, 0.82] as const,
  },
} as const;

const V = voidConfig;
const R = V.rings;
const RING_SLOTS = R.slots.viewer + R.slots.figure + R.slots.chair + R.slots.arms;
/** Three lamps over the water and the one in the cage: their pools. */
const POOLS = 4;
/** The reflections and their glows go down before the water, which then lies over them; the bulbs' halos come after it. */
const MIRROR_ORDER = -2;
const WATER_ORDER = -1;
const HALO_ORDER = 1;
const f = (v: number) => v.toFixed(5);

// ------------------------------------------------------------------ rings on the water

/** x, z, radius of the front, slope (one vec4 per ring), shared by the water and everything mirrored in it. */
const RINGS = { value: new Float32Array(RING_SLOTS * 4) };

const RINGS_GLSL = /* glsl */ `
#define RING_SLOTS ${RING_SLOTS}
uniform vec4 uRings[RING_SLOTS];
const float RING_BEND = ${f(R.bend)};
vec2 ringSlope(vec2 p, float footprint) {
  vec2 slope = vec2(0.0);
  for (int i = 0; i < RING_SLOTS; i++) {
    vec4 ring = uRings[i];
    if (ring.w <= 0.0) continue;
    vec2 away = p - ring.xy;
    float dist = length(away) + 0.001;
    float behind = dist - ring.z;
    float q = behind / (${f(R.width)} + ring.z * ${f(R.widen)});
    q *= q;
    if (q > 9.0) continue;
    float wave = ${f(R.wave)} + ring.z * ${f(R.waveGrowth)};
    float keep = 1.0 - smoothstep(${f(R.fade[0])}, ${f(R.fade[1])}, footprint / wave);
    slope += (away / dist) * (ring.w * keep * exp(-q) * sin(behind * 6.2831853 / wave));
  }
  return slope;
}
`;

interface RingSource {
  first: number;
  count: number;
  next: number;
  last: number;
}

const ringSource = (first: number, count: number): RingSource => ({ first, count, next: 0, last: -Infinity });

/** Every ring is a place on the water and a moment; the shaders are only told where each front has got to. */
class RingField {
  readonly viewer = ringSource(0, R.slots.viewer);
  readonly figure = ringSource(R.slots.viewer, R.slots.figure);
  readonly chair = ringSource(R.slots.viewer + R.slots.figure, R.slots.chair);
  readonly arms = ringSource(R.slots.viewer + R.slots.figure + R.slots.chair, R.slots.arms);
  private readonly x = new Float32Array(RING_SLOTS);
  private readonly z = new Float32Array(RING_SLOTS);
  private readonly strength = new Float32Array(RING_SLOTS);
  private readonly born = new Float64Array(RING_SLOTS).fill(-Infinity);

  /** Returns false while all of this source's rings are still alive: a ring is never cut short. */
  spawn(source: RingSource, x: number, z: number, strength: number, now: number): boolean {
    if (now - source.last < R.life / source.count) return false;
    source.last = now;
    const i = source.first + source.next;
    source.next = (source.next + 1) % source.count;
    this.x[i] = x;
    this.z[i] = z;
    this.strength[i] = strength;
    this.born[i] = now;
    return true;
  }

  update(now: number): void {
    const d = RINGS.value;
    for (let i = 0; i < RING_SLOTS; i++) {
      const age = now - this.born[i];
      const k = i * 4;
      if (age < 0 || age >= R.life) {
        d[k + 3] = 0;
        continue;
      }
      const radius = R.speed * age;
      d[k] = this.x[i];
      d[k + 1] = this.z[i];
      d[k + 2] = radius;
      d[k + 3] =
        (this.strength[i] * Math.exp(-age / R.decay) * range(0, R.born, age) * (1 - smootherstep(range(R.life * R.dying, R.life, age)))) /
        Math.sqrt(1 + radius / R.spread);
    }
  }

  clear(): void {
    this.born.fill(-Infinity);
    RINGS.value.fill(0);
    for (const s of [this.viewer, this.figure, this.chair, this.arms]) s.last = -Infinity;
  }
}

// ------------------------------------------------------------------ what stands in the water

/** A bulb lighting its own things: where it is, its color times candela. */
interface Lamp {
  at: { value: Vector3 };
  light: { value: Color };
}

const WATER_HEIGHT = 'varying float vWaterHeight;';
const LAMP_VERTEX = 'uniform vec3 uLampAt;\nvarying vec3 vLampTo;';
const LAMP_FRAGMENT = 'uniform vec3 uLampLight;\nvarying vec3 vLampTo;';
/** Every vertex's height over the water (at y = 0), whatever brought it there: instancing, bones or a parent. */
const HEIGHT_OVER_WATER = 'vWaterHeight = dot(mvPosition.xyz - viewMatrix[3].xyz, viewMatrix[1].xyz);';
const TO_LAMP = 'vLampTo = (viewMatrix * vec4(uLampAt, 1.0)).xyz - mvPosition.xyz;';
/**
 * The point goes where its reflection is seen, moved by the slope of the water where the line of sight crosses
 * it. Only the place on screen changes: light and fog are worked out at the real point, so it is lit as it is.
 */
const MIRRORED = /* glsl */ `
{
  vec3 mirrored = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
  mirrored.y = -mirrored.y;
  float crossing = clamp(cameraPosition.y / max(cameraPosition.y - mirrored.y, 0.001), 0.0, 1.0);
  vec2 slope = ringSlope(mix(cameraPosition.xz, mirrored.xz, crossing), 0.0);
  mirrored.xy += slope * (1.0 - crossing) * distance(cameraPosition, mirrored) * RING_BEND;
  gl_Position = projectionMatrix * dreamWarp(viewMatrix * vec4(mirrored, 1.0));
}
`;
const LAMP_LIGHT = /* glsl */ `
{
  float lampFar = dot(vLampTo, vLampTo);
  float lampLit = max(dot(normal, vLampTo / sqrt(lampFar)), 0.0) / lampFar;
  totalEmissiveRadiance += diffuseColor.rgb * (1.0 - metalnessFactor) * RECIPROCAL_PI * uLampLight * lampLit;
}
`;

/**
 * A material for something in the water: cut off where it goes under (the water is see-through, what is under it
 * must not show), wet just above that. With `mirror`, for its reflection: drawn upside down under the surface,
 * its faces wound the other way. With a lamp, lit by it.
 */
function forWater<T extends Material>(source: T, mirror: boolean, lamp?: Lamp): T {
  const m = source.clone() as T;
  if (mirror) {
    if (m.side === FrontSide) m.side = BackSide;
    // the tangents of a normal map would run the wrong way here, and no one could tell in a reflection
    (m as unknown as MeshStandardMaterial).normalMap = null;
  }
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    let pars = WATER_HEIGHT;
    let placed = HEIGHT_OVER_WATER;
    let fragmentPars = WATER_HEIGHT;
    if (lamp) {
      shader.uniforms.uLampAt = lamp.at;
      shader.uniforms.uLampLight = lamp.light;
      pars += `\n${LAMP_VERTEX}`;
      placed += `\n${TO_LAMP}`;
      fragmentPars += `\n${LAMP_FRAGMENT}`;
    }
    if (mirror) {
      shader.uniforms.uRings = RINGS;
      pars += `\n${RINGS_GLSL}`;
      placed += MIRRORED;
    }
    // BackSide is only there to wind the faces the other way: the normals stay the real ones
    shader.vertexShader = (mirror ? '#undef FLIP_SIDED\n' : '') + shader.vertexShader
      .replace('#include <common>', `#include <common>\n${pars}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${placed}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragmentPars}`)
      .replace('#include <clipping_planes_fragment>', 'if (vWaterHeight < 0.0) discard;\n#include <clipping_planes_fragment>')
      .replace('#include <map_fragment>', `#include <map_fragment>\ndiffuseColor.rgb *= mix(${f(V.wet.dark)}, 1.0, smoothstep(0.0, ${f(V.wet.height)}, vWaterHeight));`);
    if (lamp) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `${LAMP_LIGHT}\n#include <lights_physical_fragment>`);
  };
  m.customProgramCacheKey = () => `void-water/${mirror}/${Boolean(lamp)}`;
  return m;
}

// ------------------------------------------------------------------ fewer triangles

const trianglesOf = (g: BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
/** Share of a shape's size within which two vertices are the same point. */
const WELD = 1e-4;
/** A collapse may not turn a triangle further than this (cosine). */
const FLIP_LIMIT = 0.2;
/** How strongly an open edge holds its place, against the surface (the cut foot of an arm stays round). */
const EDGE_HOLD = 4;

/**
 * Fewer triangles over the same vertices: quadric edge collapse (Garland & Heckbert) keeping one end of each
 * collapsed edge, so a coarser model is only a new index and its normals and skin weights stay valid.
 * A few models here are enormously finer than the few pixels they ever cover.
 */
function simplify(geometry: BufferGeometry, target: number): BufferGeometry {
  if (trianglesOf(geometry) <= target) return geometry;
  const position = geometry.getAttribute('position');
  const source = geometry.index;
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < position.count; v++) {
    const xyz = [position.getX(v), position.getY(v), position.getZ(v)];
    for (let a = 0; a < 3; a++) {
      low[a] = Math.min(low[a], xyz[a]);
      high[a] = Math.max(high[a], xyz[a]);
    }
  }
  // the seams of a texture atlas repeat positions: the shape must not open along them
  const grid = Math.hypot(high[0] - low[0], high[1] - low[1], high[2] - low[2]) * WELD;
  const SPAN = 32768;
  const welded = new Map<number, number>();
  const compact = new Int32Array(position.count);
  const owner: number[] = [];
  const P: number[] = [];
  for (let v = 0; v < position.count; v++) {
    const x = position.getX(v);
    const y = position.getY(v);
    const z = position.getZ(v);
    const key = Math.round((x - low[0]) / grid) + Math.round((y - low[1]) / grid) * SPAN + Math.round((z - low[2]) / grid) * SPAN * SPAN;
    let id = welded.get(key);
    if (id === undefined) {
      id = owner.length;
      welded.set(key, id);
      owner.push(v);
      P.push(x, y, z);
    }
    compact[v] = id;
  }
  const count = owner.length;
  const tris: number[] = [];
  const corners = source ? source.count : position.count;
  for (let c = 0; c < corners; c += 3) {
    const a = compact[source ? source.getX(c) : c];
    const b = compact[source ? source.getX(c + 1) : c + 1];
    const d = compact[source ? source.getX(c + 2) : c + 2];
    if (a !== b && b !== d && a !== d) tris.push(a, b, d);
  }
  const triCount = tris.length / 3;
  const alive = new Uint8Array(triCount).fill(1);
  const Q = new Float64Array(count * 10);
  const around: number[][] = Array.from({ length: count }, () => []);
  const n = [0, 0, 0];
  const m = [0, 0, 0];
  const faceNormal = (t: number, out: number[]): number => {
    const a = tris[t * 3] * 3;
    const b = tris[t * 3 + 1] * 3;
    const c = tris[t * 3 + 2] * 3;
    const ux = P[b] - P[a];
    const uy = P[b + 1] - P[a + 1];
    const uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a];
    const vy = P[c + 1] - P[a + 1];
    const vz = P[c + 2] - P[a + 2];
    out[0] = uy * vz - uz * vy;
    out[1] = uz * vx - ux * vz;
    out[2] = ux * vy - uy * vx;
    return Math.hypot(out[0], out[1], out[2]);
  };
  const addPlane = (v: number, x: number, y: number, z: number, d: number, w: number): void => {
    const q = v * 10;
    Q[q] += w * x * x;
    Q[q + 1] += w * x * y;
    Q[q + 2] += w * x * z;
    Q[q + 3] += w * x * d;
    Q[q + 4] += w * y * y;
    Q[q + 5] += w * y * z;
    Q[q + 6] += w * y * d;
    Q[q + 7] += w * z * z;
    Q[q + 8] += w * z * d;
    Q[q + 9] += w * d * d;
  };
  const edgeKey = (a: number, b: number) => (a < b ? a * count + b : b * count + a);
  const edgeUse = new Map<number, number>();
  for (let t = 0; t < triCount; t++) {
    const area = faceNormal(t, n);
    for (let k = 0; k < 3; k++) {
      const a = tris[t * 3 + k];
      const b = tris[t * 3 + (k + 1) % 3];
      const e = edgeKey(a, b);
      edgeUse.set(e, (edgeUse.get(e) ?? 0) + 1);
      around[a].push(t);
      if (area > 0) addPlane(a, n[0] / area, n[1] / area, n[2] / area, -(n[0] * P[a * 3] + n[1] * P[a * 3 + 1] + n[2] * P[a * 3 + 2]) / area, area / 2);
    }
  }
  for (let t = 0; t < triCount; t++) {
    if (faceNormal(t, n) === 0) continue;
    for (let k = 0; k < 3; k++) {
      const a = tris[t * 3 + k];
      const b = tris[t * 3 + (k + 1) % 3];
      if (edgeUse.get(edgeKey(a, b)) !== 1) continue;
      const ex = P[b * 3] - P[a * 3];
      const ey = P[b * 3 + 1] - P[a * 3 + 1];
      const ez = P[b * 3 + 2] - P[a * 3 + 2];
      let px = ey * n[2] - ez * n[1];
      let py = ez * n[0] - ex * n[2];
      let pz = ex * n[1] - ey * n[0];
      const pl = Math.hypot(px, py, pz);
      if (pl === 0) continue;
      px /= pl;
      py /= pl;
      pz /= pl;
      const d = -(px * P[a * 3] + py * P[a * 3 + 1] + pz * P[a * 3 + 2]);
      const w = (ex * ex + ey * ey + ez * ez) * EDGE_HOLD;
      addPlane(a, px, py, pz, d, w);
      addPlane(b, px, py, pz, d, w);
    }
  }
  /** The error of putting both ends of an edge (a, b) at vertex v. */
  const errorAt = (v: number, a: number, b: number): number => {
    const x = P[v * 3];
    const y = P[v * 3 + 1];
    const z = P[v * 3 + 2];
    const qa = a * 10;
    const qb = b * 10;
    return (
      (Q[qa] + Q[qb]) * x * x +
      2 * (Q[qa + 1] + Q[qb + 1]) * x * y +
      2 * (Q[qa + 2] + Q[qb + 2]) * x * z +
      2 * (Q[qa + 3] + Q[qb + 3]) * x +
      (Q[qa + 4] + Q[qb + 4]) * y * y +
      2 * (Q[qa + 5] + Q[qb + 5]) * y * z +
      2 * (Q[qa + 6] + Q[qb + 6]) * y +
      (Q[qa + 7] + Q[qb + 7]) * z * z +
      2 * (Q[qa + 8] + Q[qb + 8]) * z +
      (Q[qa + 9] + Q[qb + 9])
    );
  };

  // the cheapest collapse first (a binary heap; entries go stale when an end has changed since)
  interface Collapse {
    cost: number;
    from: number;
    to: number;
    stampFrom: number;
    stampTo: number;
  }
  const stamp = new Uint32Array(count);
  const heap: Collapse[] = [];
  const push = (cost: number, from: number, to: number): void => {
    const item: Collapse = { cost, from, to, stampFrom: stamp[from], stampTo: stamp[to] };
    let i = heap.length;
    heap.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].cost <= cost) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = item;
  };
  const pop = (): Collapse => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= heap.length) break;
        if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++;
        if (heap[child].cost >= last.cost) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
    }
    return top;
  };
  const pushEdge = (a: number, b: number): void => {
    const ca = errorAt(a, a, b);
    const cb = errorAt(b, a, b);
    if (ca <= cb) push(ca, b, a);
    else push(cb, a, b);
  };
  const pushed = new Set<number>();
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const a = tris[t * 3 + k];
      const b = tris[t * 3 + (k + 1) % 3];
      const e = edgeKey(a, b);
      if (pushed.has(e)) continue;
      pushed.add(e);
      pushEdge(a, b);
    }
  }

  const gone = new Uint8Array(count);
  const neighbors = new Set<number>();
  let live = triCount;
  while (live > target && heap.length) {
    const { from, to, stampFrom, stampTo } = pop();
    if (gone[from] || gone[to] || stampFrom !== stamp[from] || stampTo !== stamp[to]) continue;
    let flips = false;
    for (const t of around[from]) {
      if (!alive[t]) continue;
      const a = tris[t * 3];
      const b = tris[t * 3 + 1];
      const c = tris[t * 3 + 2];
      if (a === to || b === to || c === to) continue;
      const before = faceNormal(t, n);
      if (before === 0) continue;
      const i = a === from ? 0 : b === from ? 1 : 2;
      tris[t * 3 + i] = to;
      const after = faceNormal(t, m);
      tris[t * 3 + i] = from;
      if (after === 0 || (n[0] * m[0] + n[1] * m[1] + n[2] * m[2]) / (before * after) < FLIP_LIMIT) {
        flips = true;
        break;
      }
    }
    if (flips) continue;
    gone[from] = 1;
    for (let k = 0; k < 10; k++) Q[to * 10 + k] += Q[from * 10 + k];
    stamp[to]++;
    for (const t of around[from]) {
      if (!alive[t]) continue;
      const i = t * 3;
      if (tris[i] === to || tris[i + 1] === to || tris[i + 2] === to) {
        alive[t] = 0;
        live--;
      } else {
        if (tris[i] === from) tris[i] = to;
        else if (tris[i + 1] === from) tris[i + 1] = to;
        else tris[i + 2] = to;
        around[to].push(t);
      }
    }
    around[from].length = 0;
    around[to] = around[to].filter((t) => alive[t]);
    neighbors.clear();
    for (const t of around[to]) {
      for (let k = 0; k < 3; k++) {
        const v = tris[t * 3 + k];
        if (v !== to) neighbors.add(v);
      }
    }
    for (const v of neighbors) pushEdge(to, v);
  }

  const kept: number[] = [];
  for (let t = 0; t < triCount; t++) {
    if (alive[t]) kept.push(owner[tris[t * 3]], owner[tris[t * 3 + 1]], owner[tris[t * 3 + 2]]);
  }
  const result = new BufferGeometry();
  for (const name of Object.keys(geometry.attributes)) result.setAttribute(name, geometry.getAttribute(name));
  result.setIndex(kept);
  return result;
}

const coarser = new Map<BufferGeometry, Map<number, BufferGeometry>>();
/** A shared coarser copy of a shared geometry (asked for again, it is the same one). */
function simplified(geometry: BufferGeometry, target: number): BufferGeometry {
  let known = coarser.get(geometry);
  if (!known) coarser.set(geometry, (known = new Map()));
  let result = known.get(target);
  if (!result) known.set(target, (result = simplify(geometry, target)));
  return result;
}

const meshesIn = (object: Object3D, only: (mesh: Mesh) => boolean = () => true): Mesh[] => {
  const list: Mesh[] = [];
  object.traverse((o) => {
    if ((o as Mesh).isMesh && only(o as Mesh)) list.push(o as Mesh);
  });
  return list;
};

/** Bring a model down to about this many triangles, each of its parts in proportion. */
function lighten(object: Object3D, triangles: number, only?: (mesh: Mesh) => boolean): void {
  const meshes = meshesIn(object, only);
  const total = meshes.reduce((sum, m) => sum + trianglesOf(m.geometry), 0);
  for (const m of meshes) m.geometry = simplified(m.geometry, Math.max(4, Math.ceil((triangles * trianglesOf(m.geometry)) / total)));
}

// ------------------------------------------------------------------ shaders of the place

/** For what is worked out per pixel from where it lies: the water, and the print in it. */
const WORLD_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${WARP_GLSL}
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * dreamWarp(mvPosition);
  #include <fog_vertex>
}
`;

const WATER_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${RINGS_GLSL}
uniform vec3 uBody;
uniform vec3 uReflectance;
uniform float uTilt;
uniform vec3 uSheen;
uniform vec2 uSheenFrom;
uniform vec3 uPools[${POOLS}];
uniform vec3 uPoolLight[${POOLS}];
uniform float uPoolStirred;
uniform vec2 uBegins;
varying vec3 vWorld;

void main() {
  vec2 p = vWorld.xz;
  vec2 slope = ringSlope(p, length(fwidth(p)));
  vec3 toEye = normalize(cameraPosition - vWorld);
  vec3 surface = normalize(vec3(-slope.x * uTilt, 1.0, -slope.y * uTilt));
  float grazing = 1.0 - clamp(dot(surface, toEye), 0.0, 1.0);
  float mirror = mix(uReflectance.x, uReflectance.y, pow(grazing, uReflectance.z));

  // still water shows no light of its own: only a slope turned to the light catches some
  vec3 caught = uSheen * max(dot(slope, uSheenFrom), 0.0);
  float stirred = 1.0 + length(slope) * uPoolStirred;
  for (int i = 0; i < ${POOLS}; i++) {
    vec2 d = (p - uPools[i].xy) * uPools[i].z;
    float pool = 1.0 / (1.0 + dot(d, d));
    caught += uPoolLight[i] * pool * pool * stirred;
  }

  // what is mirrored was fogged over its whole path; only the water's own body still lies behind the haze
  vec3 body = uBody;
  #ifdef USE_FOG
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    body = mix(body, fogColor, fogFactor);
    caught *= 1.0 - fogFactor;
  #endif

  float begun = 1.0 - smoothstep(uBegins.x, uBegins.y, vWorld.z);
  // what lies under it is drawn already: this adds light and lets through only what is mirrored
  gl_FragColor = vec4((body * (1.0 - mirror) + caught) * begun, (1.0 - mirror) * begun);
}
`;

/**
 * The print under the water, worked out per pixel so that the rings can break it up: where the line of sight
 * crosses the surface gives the slope; the slope gives the point of the print seen here.
 */
const REFLECTED_PRINT_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${RINGS_GLSL}
uniform sampler2D tStill;
uniform vec4 uPaper;
uniform vec4 uImage;
uniform vec3 uPaperColor;
varying vec3 vWorld;

void main() {
  float crossing = cameraPosition.y / (cameraPosition.y - vWorld.y);
  vec2 onWater = mix(cameraPosition.xz, vWorld.xz, crossing);
  vec2 slope = ringSlope(onWater, length(fwidth(onWater)));
  float leg = (1.0 - crossing) * distance(cameraPosition, vWorld);
  vec2 p = vec2(vWorld.x, -vWorld.y) + slope * leg * RING_BEND;

  vec2 outPaper = abs(p - uPaper.xy) - uPaper.zw;
  float inPaper = -max(outPaper.x, outPaper.y);
  float soft = max(fwidth(inPaper), 0.0001);
  float paperCover = clamp(inPaper / soft + 0.5, 0.0, 1.0);
  if (paperCover <= 0.0) discard;
  vec2 outImage = abs(p - uImage.xy) - uImage.zz;
  float imageCover = clamp(-max(outImage.x, outImage.y) / soft + 0.5, 0.0, 1.0);
  vec3 still = texture2D(tStill, (p - uImage.xy) / (2.0 * uImage.z) + 0.5).rgb * uImage.w;

  // as on the print itself: the paper lies in the haze, the image gives off its own light
  vec3 paper = uPaperColor;
  #ifdef USE_FOG
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    paper = mix(paper, fogColor, fogFactor);
  #endif
  gl_FragColor = vec4(mix(paper, still, imageCover) * paperCover, 1.0);
}
`;

const GLOW_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${WARP_GLSL}
varying vec2 vOffset;
varying vec3 vGlow;
void main() {
  vOffset = position.xy * 2.0;
  vGlow = instanceColor;
  vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mvPosition.xy += position.xy * size;
  gl_Position = projectionMatrix * dreamWarp(mvPosition);
  #include <fog_vertex>
}
`;

const GLOW_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTight;
varying vec2 vOffset;
varying vec3 vGlow;
void main() {
  float r2 = dot(vOffset, vOffset);
  if (r2 >= 1.0) discard;
  float rest = 1.0 - r2;
  vec3 c = vGlow * rest * rest * exp(-r2 * uTight);
  #ifdef USE_FOG
    // on its way through the haze a glow fades; it does not take the haze's color
    c *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #endif
  gl_FragColor = vec4(c, 1.0);
}
`;

const IDOL_VERT = /* glsl */ `
${WARP_GLSL}
uniform float uFlip;
varying vec3 vWorld;
varying vec3 vNormalWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalWorld = mat3(modelMatrix) * normal;
  world.y *= uFlip;
  gl_Position = projectionMatrix * dreamWarp(viewMatrix * world);
}
`;

const IDOL_FRAG = /* glsl */ `
uniform vec3 uRim;
uniform vec3 uRimFrom;
uniform float uRimPower;
varying vec3 vWorld;
varying vec3 vNormalWorld;
void main() {
  if (vWorld.y < 0.0) discard;
  vec3 facing = normalize(vNormalWorld);
  float edge = pow(1.0 - clamp(dot(facing, normalize(cameraPosition - vWorld)), 0.0, 1.0), uRimPower);
  float lit = clamp(dot(facing, uRimFrom) * 0.5 + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(uRim * edge * lit * lit, 1.0);
}
`;

interface Glow {
  at: Vector3;
  width: number;
  height: number;
  color: Color;
}

/** All glows of one kind in one draw: quads turned to the eye, sized and tinted per instance. */
function glowMesh(glows: readonly Glow[], material: ShaderMaterial, order: number): InstancedMesh {
  const mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, glows.length);
  const m = new Matrix4();
  const q = new Quaternion();
  const size = new Vector3();
  glows.forEach((g, i) => {
    mesh.setMatrixAt(i, m.compose(g.at, q, size.set(g.width, g.height, 1)));
    mesh.setColorAt(i, g.color);
  });
  mesh.renderOrder = order;
  return mesh;
}

interface Arm {
  x: number;
  z: number;
  scale: number;
  sink: number;
  turn: Quaternion;
  /** How much of the way up it comes per second not seen. */
  rate: number;
  /** Below 0 it has not started (down from -wait, in seconds not seen); 1 is all the way up. */
  rise: number;
  wait: number;
  crowd: PropCrowd;
  slot: number;
}

const probe = new Vector3();
const place = new Vector3();
const size = new Vector3();
const matrix = new Matrix4();

/**
 * VII, Boşluk. After the meat, nothing: black water to the end of the dark, and the print on its hooks with
 * its picture burning in the water. The only things that move are the rings your steps make. The one who stands
 * in front of it grows smaller the closer you come and backs through it. Far off, a chair rocks under a bulb. And
 * behind you, once you are past the middle and only while you are not looking, arms have come up out of the water.
 */
export class TheVoid implements DreamModule {
  readonly root = new Group();
  readonly span = [LAYOUT.void.from, LAYOUT.void.to] as const;
  readonly region = 'void' as const;
  readonly spots: readonly SpotSpec[];

  private readonly content = new Group();
  private readonly key: SpotSpec = { ...V.key };
  private readonly rake: SpotSpec = { ...V.rake };
  private readonly top: SpotSpec;
  private readonly topAt: [number, number, number] = [0, V.figure.top.height, 0];
  private readonly topTarget: [number, number, number] = [0, 0, 0];
  private readonly rings = new RingField();
  private readonly figure: Object3D;
  private readonly figureReflected: Object3D;
  private readonly chair: Object3D;
  private readonly chairReflected: Object3D;
  private readonly cage: Object3D;
  private readonly cageReflected: Object3D;
  private readonly arms: Arm[] = [];
  private readonly armCrowds: PropCrowd[] = [];
  private readonly armsReflected: PropCrowd;
  private readonly idolRim = { value: new Color() };
  private readonly idolColor = new Color(V.idol.rim.color).multiplyScalar(V.idol.rim.strength);

  /** The place's own clock: it stands still while the piece is paused. */
  private clock = 0;
  private lastEyeZ = Infinity;
  private walked = 0;
  private foot = 1;
  private figureZ: number = V.figure.home[2];
  private figureWalked = 0;
  private rockBeat = 0;

  constructor(kit: DreamKit, giant: GiantPrint) {
    this.root.name = 'TheVoid';
    this.root.add(this.content);

    const T = V.figure.top;
    this.top = { position: this.topAt, target: this.topTarget, color: T.color, intensity: 0, angle: T.angle, penumbra: T.penumbra };
    this.spots = [this.key, this.rake, this.top];

    const pools = new Float32Array(POOLS * 3);
    const poolLight = new Float32Array(POOLS * 3);
    this.buildReflectedPrint(giant);
    this.buildReflectedHardware(giant);

    const { figure, reflected } = this.buildFigure(kit);
    this.figure = figure;
    this.figureReflected = reflected;

    const still = this.buildStillLife(kit, pools, poolLight);
    this.chair = still.chair;
    this.chairReflected = still.chairReflected;
    this.cage = still.cage;
    this.cageReflected = still.cageReflected;

    this.armsReflected = this.buildArms(kit);
    this.buildIdol(kit);
    this.buildWater(kit, pools, poolLight);

    kit.poi({ position: giant.imageCenter, radius: dreamConfig.giantPrint.poi.radius, zoom: dreamConfig.giantPrint.poi.zoom, memory: 'giant' });
  }

  // ------------------------------------------------------------------ building

  private buildWater(kit: DreamKit, pools: Float32Array, poolLight: Float32Array): void {
    const W = V.water;
    const from = LAYOUT.void.from;
    const to = LAYOUT.void.to;
    const sheen = new Color(W.sheen.color).multiplyScalar(W.sheen.strength);
    const rake = new Vector2(V.rake.position[0] - V.rake.target[0], V.rake.position[2] - V.rake.target[2]).normalize();
    const material = new ShaderMaterial({
      vertexShader: WORLD_VERT,
      fragmentShader: WATER_FRAG,
      fog: true,
      transparent: true,
      // it adds its own light and only lets through what it mirrors
      premultipliedAlpha: true,
      depthWrite: false,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        ...warpUniforms,
        uRings: RINGS,
        uBody: { value: new Color(W.body) },
        uReflectance: { value: new Vector3(...W.reflectance) },
        uTilt: { value: W.tilt },
        uSheen: { value: sheen },
        uSheenFrom: { value: rake },
        uPools: { value: pools },
        uPoolLight: { value: poolLight },
        uPoolStirred: { value: V.stillLife.bulb.pool.stirred },
        uBegins: { value: new Vector2(W.begins[1], W.begins[0]) },
      },
    });
    const near = kit.floor(-W.halfWidth, W.halfWidth, from, to, 0, material);
    near.name = 'BlackWater';
    near.renderOrder = WATER_ORDER;
    // beyond the print nothing bends any more, and little can be seen: large cells
    const F = W.far;
    const far = new Mesh(new PlaneGeometry(F.halfWidth * 2, to - F.to, F.cells[0], F.cells[1]), material);
    far.name = 'BlackWaterFar';
    far.rotation.x = -Math.PI / 2;
    far.position.set(0, 0, (to + F.to) / 2);
    far.renderOrder = WATER_ORDER;
    this.content.add(near, far);
  }

  /** The print seen in the water. It is a still of the sea: the picture's window looks along another line, and no one can tell in the water. */
  private buildReflectedPrint(giant: GiantPrint): void {
    const G = dreamConfig.giantPrint;
    const { print, image } = photoConfig;
    const F = V.reflection;
    const halfWidth = (print.width * G.scale) / 2;
    const halfHeight = (print.height * G.scale) / 2;
    const center = giant.imageCenter;
    const top = G.center[1] + halfHeight;
    // large enough for the rings to throw the print around in it; never above the water
    const height = top + F.margin;
    const plane = new PlaneGeometry((halfWidth + F.margin) * 2, height, F.cells, F.cells);
    plane.translate(G.center[0], -height / 2, G.z);
    const material = new ShaderMaterial({
      vertexShader: WORLD_VERT,
      fragmentShader: REFLECTED_PRINT_FRAG,
      fog: true,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        ...warpUniforms,
        uRings: RINGS,
        tStill: { value: giant.stillRT.texture },
        uPaper: { value: new Vector4(G.center[0], G.center[1], halfWidth, halfHeight) },
        uImage: { value: new Vector4(center.x, center.y, (image.size * G.scale) / 2, F.image) },
        uPaperColor: { value: new Color(F.paper).multiplyScalar(F.paperGain) },
      },
    });
    const reflection = new Mesh(plane, material);
    reflection.name = 'PrintInTheWater';
    reflection.renderOrder = MIRROR_ORDER;
    this.content.add(reflection);
  }

  /** The hooks and the links the light reaches, in the water. */
  private buildReflectedHardware(giant: GiantPrint): void {
    const H = dreamConfig.giantPrint.hooks;
    for (const hook of giant.hooks) {
      const copy = hook.clone();
      lighten(copy, H.reflected);
      for (const mesh of meshesIn(copy)) {
        mesh.material = forWater(mesh.material as Material, true);
        mesh.renderOrder = MIRROR_ORDER;
      }
      this.content.add(copy);
    }
    const links = new InstancedMesh(giant.coarseLink, forWater(giant.chain.material as Material, true), giant.chain.count);
    links.name = 'ChainInTheWater';
    for (let i = 0; i < links.count; i++) {
      giant.chain.getMatrixAt(i, matrix);
      links.setMatrixAt(i, matrix);
    }
    links.renderOrder = MIRROR_ORDER;
    this.content.add(links);
  }

  /** The double and its reflection: its hair has gone white, on copies of the photographer's own materials. */
  private buildFigure(kit: DreamKit): { figure: Object3D; reflected: Object3D } {
    const F = V.figure;
    const white = new Map<Material, MeshStandardMaterial>();
    const whitened = (source: MeshStandardMaterial): MeshStandardMaterial => {
      let m = white.get(source);
      if (!m) {
        m = source.clone();
        if (source.map && /head/.test(source.name)) m.map = headMap(source.map, 'keep', true, F.seed);
        else if (source.map && /opacity/.test(source.name)) m.map = hairMap(source.map);
        white.set(source, m);
      }
      return m;
    };
    const isBody = (mesh: Mesh) => (mesh as SkinnedMesh).isSkinnedMesh === true;
    const dress = (holder: Object3D, mirror: boolean) => {
      for (const mesh of meshesIn(holder)) {
        mesh.castShadow = false;
        const source = mesh.material as MeshStandardMaterial;
        const body = isBody(mesh);
        const base = body ? whitened(source) : source;
        if (mirror) {
          mesh.material = forWater(base, true);
          mesh.renderOrder = MIRROR_ORDER;
        } else if (body) {
          mesh.material = forWater(base, false);
        }
      }
    };
    const figure = kit.photographer.makeDouble(F.clipTime);
    figure.name = 'TheOneWhoRetreats';
    lighten(figure, F.camera, (mesh) => !isBody(mesh));
    dress(figure, false);
    const reflected = kit.photographer.makeDouble(F.clipTime);
    reflected.name = 'TheOneWhoRetreatsInTheWater';
    lighten(reflected, F.reflected);
    dress(reflected, true);
    figure.rotation.y = reflected.rotation.y = F.heading * DEG;
    figure.position.set(...F.home);
    reflected.position.set(...F.home);
    this.content.add(figure, reflected);
    return { figure, reflected };
  }

  /** Cut it off at the water, and put its reflection under it. Returns the reflection. */
  private standInWater(thing: Object3D, lamp?: Lamp): Object3D {
    const reflected = thing.clone();
    const dress = (object: Object3D, mirror: boolean) => {
      for (const mesh of meshesIn(object)) {
        const source = mesh.material as Material;
        mesh.material = forWater(source, mirror, (source as MeshStandardMaterial).isMeshStandardMaterial ? lamp : undefined);
        if (mirror) mesh.renderOrder = MIRROR_ORDER;
      }
    };
    dress(reflected, true);
    dress(thing, false);
    this.content.add(thing, reflected);
    return reflected;
  }

  private buildStillLife(kit: DreamKit, pools: Float32Array, poolLight: Float32Array) {
    const S = V.stillLife;
    const B = S.bulb;
    const warm = new Color(LIGHT_COLORS.window);
    const glass = new MeshBasicMaterial({ color: warm.clone().multiplyScalar(B.glow) });
    const halos: Glow[] = [];
    const streaks: Glow[] = [];
    let lamps = 0;
    const shine = (x: number, y: number, z: number, candela: number): Lamp => {
      const pool = lamps++;
      pools[pool * 3] = x;
      pools[pool * 3 + 1] = z;
      pools[pool * 3 + 2] = 1 / B.pool.radius;
      poolLight[pool * 3] = warm.r * B.pool.strength * (candela / S.chair.candela);
      poolLight[pool * 3 + 1] = warm.g * B.pool.strength * (candela / S.chair.candela);
      poolLight[pool * 3 + 2] = warm.b * B.pool.strength * (candela / S.chair.candela);
      halos.push({ at: new Vector3(x, y, z), width: B.halo.size, height: B.halo.size, color: warm.clone().multiplyScalar(B.halo.strength) });
      streaks.push({ at: new Vector3(x, -y, z), width: B.streak.width, height: B.streak.height, color: warm.clone().multiplyScalar(B.streak.strength) });
      return { at: { value: new Vector3(x, y, z) }, light: { value: warm.clone().multiplyScalar(candela) } };
    };

    const C = S.cord;
    const cordGeometry = new CylinderGeometry(C.radius, C.radius, C.length, 4, C.rows, true);
    cordGeometry.translate(0, C.length / 2, 0);
    const heights = cordGeometry.getAttribute('position');
    const shades = new Float32Array(heights.count * 3);
    for (let i = 0; i < heights.count; i++) {
      const shade = Math.exp(-heights.getY(i) / C.falloff) * C.glow;
      shades[i * 3] = warm.r * shade;
      shades[i * 3 + 1] = warm.g * shade;
      shades[i * 3 + 2] = warm.b * shade;
    }
    cordGeometry.setAttribute('color', new Float32BufferAttribute(shades, 3));
    const bulbs = [S.chair, S.phone, S.car];
    const cords = new InstancedMesh(cordGeometry, new MeshBasicMaterial({ vertexColors: true }), bulbs.length);
    cords.name = 'Cords';

    const [chairLamp, phoneLamp, carLamp] = bulbs.map((spec, i) => {
      const [x, , z] = spec.at;
      const lamp = shine(x, spec.bulb, z, spec.candela);
      const fitting = new Group();
      fitting.position.set(x, spec.bulb + B.drop * B.scale, z);
      fitting.scale.setScalar(B.scale);
      const socket = kit.prop('pull_chain_socket', [0, 0, 0], { anchor: 'top' }, fitting);
      const bulb = kit.prop('lightbulb', [0, -B.seat, 0], { rotation: [180, 0, 0], anchor: 'top' }, fitting);
      lighten(socket, B.triangles);
      lighten(bulb, B.triangles);
      kit.paint(bulb, glass);
      this.standInWater(fitting, lamp);
      cords.setMatrixAt(i, matrix.makeTranslation(x, spec.bulb + B.drop * B.scale, z));
      return lamp;
    });
    this.content.add(cords);

    // the chair: rocks by itself, facing the way you come
    const Ch = S.chair;
    const chair = kit.prop('rocking_chair', Ch.at, { scale: Ch.scale });
    lighten(chair, Ch.triangles);
    chair.rotation.order = 'YXZ';
    chair.rotation.y = Ch.heading * DEG;
    const chairReflected = this.standInWater(chair, chairLamp);

    // the telephone: on its pole, gone over, half of it under the water
    const P = S.phone;
    const phone = new Group();
    phone.name = 'Payphone';
    phone.position.set(...P.at);
    phone.scale.setScalar(P.scale);
    phone.rotation.order = 'YXZ';
    phone.rotation.set(P.lean[0] * DEG, P.heading * DEG, P.lean[1] * DEG);
    const unit = kit.prop('payphone', [0, P.height, P.out], { anchor: 'center' }, phone);
    lighten(unit, P.triangles);
    const poleHeight = P.pole.top - P.pole.bottom;
    const pole = new Mesh(new CylinderGeometry(P.pole.radius, P.pole.radius, poleHeight, P.pole.sides, 1), kit.surface('rust_streaked', 1));
    pole.position.y = P.pole.bottom + poleHeight / 2;
    phone.add(pole);
    this.standInWater(phone, phoneLamp);

    // the car: only the body under its cover (its wheels are far under the water)
    const K = S.car;
    const car = kit.prop('covered_car', K.at, { rotation: K.rotation, nodes: ['covered_car'] });
    this.standInWater(car, carLamp);

    // the cage: on its long chain, a dim light inside it
    const G = S.cage;
    const cage = kit.prop('hanging_cage', G.at, { scale: G.height });
    lighten(cage, G.triangles);
    kit.paint(cage, new MeshStandardMaterial({ color: G.color, roughness: G.roughness, metalness: G.metalness }));
    const inside = G.at[1] + G.lightAt;
    const cageReflected = this.standInWater(cage, shine(G.at[0], inside, G.at[2], G.candela));

    const tight = { uTight: { value: S.haloTight } };
    const glow = () =>
      new ShaderMaterial({
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        fog: true,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { ...UniformsUtils.clone(UniformsLib.fog), ...warpUniforms, ...tight },
      });
    const halo = glowMesh(halos, glow(), HALO_ORDER);
    halo.name = 'BulbHalos';
    const streak = glowMesh(streaks, glow(), MIRROR_ORDER);
    streak.name = 'BulbsInTheWater';
    this.content.add(halo, streak);

    return { chair, chairReflected, cage, cageReflected };
  }

  /** Fifty left arms, waiting under the water behind where you will be. Returns their reflections. */
  private buildArms(kit: DreamKit): PropCrowd {
    const A = V.arms;
    const random = randomFrom(A.seed);
    const within = (span: readonly [number, number]) => lerp(span[0], span[1], random());

    // where each stands: thickest along the way, none on it
    const spots: { x: number; z: number }[] = [];
    for (let i = 0; i < A.count; i++) {
      let x = 0;
      let z = 0;
      for (let t = 0; t < A.tries; t++) {
        x = (random() < 0.5 ? -1 : 1) * (A.clear + A.spread * random() ** A.gather);
        z = within(A.z);
        const px = x;
        const pz = z;
        if (spots.every((s) => Math.hypot(s.x - px, s.z - pz) >= A.spacing)) break;
      }
      spots.push({ x, z });
    }
    // those nearest the way are the ones you stand nearest to when you turn: they get the finer model
    spots.sort((a, b) => Math.abs(a.x) - Math.abs(b.x));

    const skin = new MeshStandardMaterial({ color: A.color, roughness: A.roughness, metalness: 0 });
    const pose = kit.prop('forearm', [0, 0, 0], { rotation: [A.straighten, 0, 0] });
    const crowd = (count: number, triangles: number, material: Material) => {
      // each coarser model is made from the one before it
      lighten(pose, triangles);
      const made = new PropCrowd(pose, count, false);
      kit.paint(made.root, material);
      made.root.visible = false;
      this.content.add(made.root);
      return made;
    };
    const near = crowd(A.near, A.triangles.near, forWater(skin, false));
    const far = crowd(A.count - A.near, A.triangles.far, forWater(skin, false));
    const reflected = crowd(A.count, A.triangles.reflected, forWater(skin, true));
    this.armCrowds.push(near, far, reflected);

    const turn = new Quaternion();
    const aside = new Euler(0, 0, 0, 'YXZ');
    spots.forEach((s, i) => {
      // the palm (+x of the cast) toward where you are going, the fingers leaning that way
      const heading = Math.atan2(s.z - A.reach[1], A.reach[0] - s.x) + (random() * 2 - 1) * A.astray;
      turn.setFromEuler(aside.set((random() * 2 - 1) * A.astray * 0.5, heading, -within(A.lean) * DEG));
      const wait = within(A.wait);
      this.arms.push({
        x: s.x,
        z: s.z,
        scale: within(A.scale),
        sink: lerp(A.sink[0], A.sink[1], random() ** 2),
        turn: turn.clone(),
        rate: 1 / within(A.rise),
        rise: -wait,
        wait,
        crowd: i < A.near ? near : far,
        slot: i < A.near ? i : i - A.near,
      });
    });
    return reflected;
  }

  /** At the very limit of the dark. It is not in the fog: it has only ever been black. */
  private buildIdol(kit: DreamKit): void {
    const I = V.idol;
    const material = (flip: number) =>
      new ShaderMaterial({
        vertexShader: IDOL_VERT,
        fragmentShader: IDOL_FRAG,
        side: flip < 0 ? BackSide : FrontSide,
        uniforms: {
          ...warpUniforms,
          uFlip: { value: flip },
          uRim: this.idolRim,
          uRimFrom: { value: new Vector3(...I.rim.from).normalize() },
          uRimPower: { value: I.rim.power },
        },
      });
    const idol = kit.prop('dogu', I.at, { scale: I.height, rotation: [0, I.heading, 0] });
    lighten(idol, I.triangles);
    const reflected = idol.clone();
    kit.paint(idol, material(1));
    kit.paint(reflected, material(-1));
    this.content.add(idol, reflected);
  }

  // ------------------------------------------------------------------ per frame

  update(frame: DreamFrame): void {
    const z = frame.eye.z;
    this.content.visible = z < V.seenFrom;
    const arrived = smootherstep(range(LAYOUT.void.from, LAYOUT.void.from - V.lightUp, z));
    this.key.intensity = V.key.intensity * arrived;
    this.rake.intensity = V.rake.intensity * arrived;
    this.idolRim.value.copy(this.idolColor).multiplyScalar(smootherstep(range(V.idol.fadeIn[0], V.idol.fadeIn[1], frame.walk)));

    this.updateFigure(frame.eye, arrived);
    if (frame.paused) return;
    this.clock += frame.dt;
    this.updateSteps(frame.eye);
    this.updateStillLife();
    this.updateArms(frame);
    this.rings.update(this.clock);
  }

  /** Where it stands is a pure function of where you are: scroll back and it comes back. */
  private updateFigure(eye: Vector3, arrived: number): void {
    const F = V.figure;
    const away = eye.z - F.home[2];
    const scale = lerp(1, F.least, smootherstep(range(F.shrink[0], F.shrink[1], away)));
    const backing = range(F.retreat[0], F.retreat[1], away);
    const z = lerp(F.home[2], F.toZ, backing * backing * (3 - 2 * backing));
    const y = F.home[1] * scale;
    const present = backing < 1;
    this.figure.visible = present;
    this.figure.position.set(F.home[0], y, z);
    this.figureReflected.position.set(F.home[0], y, Math.max(z, F.reflectionStops));
    this.figure.scale.setScalar(scale);
    this.figureReflected.scale.setScalar(scale);

    // it leaves rings where it backs through the water (a jump of the walk is not a step)
    const moved = Math.abs(z - this.figureZ);
    this.figureZ = z;
    if (moved < R.figure.every) this.figureWalked += moved;
    if (this.figureWalked >= R.figure.every) {
      this.figureWalked = 0;
      this.rings.spawn(this.rings.figure, F.home[0], z, R.figure.strength, this.clock);
    }

    const T = F.top;
    this.topAt[0] = this.topTarget[0] = F.home[0];
    this.topAt[2] = z + T.ahead;
    this.topTarget[2] = z;
    this.top.intensity = present ? T.intensity * arrived * (1 - smootherstep(range(F.topOut[0], F.topOut[1], backing))) : 0;
  }

  /** Each step disturbs the water a little way ahead of you: the rings have to be seen, and you never look down. */
  private updateSteps(eye: Vector3): void {
    const S = R.step;
    if (this.lastEyeZ === Infinity) this.lastEyeZ = eye.z;
    const moved = eye.z - this.lastEyeZ;
    this.lastEyeZ = eye.z;
    // a jump (a deep link, a restart) is not a step
    if (Math.abs(moved) > S.every) return;
    this.walked += Math.abs(moved);
    if (this.walked < S.every || moved === 0) return;
    const strength = S.strength * (REDUCED_MOTION ? V.reducedMotion : 1);
    if (!this.rings.spawn(this.rings.viewer, eye.x + S.foot * this.foot, eye.z + Math.sign(moved) * S.lead, strength, this.clock)) return;
    this.walked = 0;
    this.foot = -this.foot;
  }

  private updateStillLife(): void {
    const S = V.stillLife;
    const calm = REDUCED_MOTION ? V.reducedMotion : 1;
    const Ch = S.chair;
    const phase = this.clock / Ch.rock.period;
    const rock = Math.sin(phase * Math.PI * 2) * Ch.rock.angle * DEG * calm;
    // it rolls on its runners: the point it rests on rises a little as it tips
    const y = Ch.at[1] + Ch.rock.radius * (1 - Math.cos(rock));
    this.chair.rotation.x = this.chairReflected.rotation.x = rock;
    this.chair.position.y = this.chairReflected.position.y = y;
    // its runners stir the water each time they come down
    const beat = Math.floor(phase * 2);
    if (beat !== this.rockBeat) {
      this.rockBeat = beat;
      this.rings.spawn(this.rings.chair, Ch.at[0], Ch.at[2], R.chair.strength * calm, this.clock);
    }
    const G = S.cage;
    this.cage.rotation.y = this.cageReflected.rotation.y = Math.sin((this.clock / G.turn.period) * Math.PI * 2) * G.turn.angle * DEG * calm;
  }

  /** They come up only while they are not looked at (caught halfway, they stay halfway), and go down again when you go back. */
  private updateArms(frame: DreamFrame): void {
    const A = V.arms;
    const after = frame.walk > A.after;
    let moved = false;
    let shown = false;
    for (let i = 0; i < this.arms.length; i++) {
      const arm = this.arms[i];
      let rise = arm.rise;
      if (after && frame.eye.z < arm.z - A.behind) {
        if (rise < 1 && frame.unseen(probe.set(arm.x, 1, arm.z), A.margin)) rise = Math.min(1, rise + frame.dt * (rise < 0 ? 1 : arm.rate));
      } else if (rise > -arm.wait) {
        rise = Math.max(-arm.wait, rise - frame.dt / A.sinkBack);
      }
      if (rise !== arm.rise) {
        if (arm.rise <= 0 && rise > 0) this.rings.spawn(this.rings.arms, arm.x, arm.z, R.arm.strength, this.clock);
        arm.rise = rise;
        this.placeArm(i);
        moved = true;
      }
      if (rise > 0) shown = true;
    }
    if (moved) {
      for (const crowd of this.armCrowds) {
        crowd.commit();
        crowd.root.visible = shown;
      }
    }
  }

  private placeArm(i: number): void {
    const arm = this.arms[i];
    const height = smootherstep(Math.max(0, arm.rise));
    place.set(arm.x, lerp(-arm.scale, -arm.scale * arm.sink, height), arm.z);
    matrix.compose(place, arm.turn, size.setScalar(arm.scale));
    arm.crowd.setMatrix(arm.slot, matrix);
    this.armsReflected.setMatrix(i, matrix);
  }

  reset(): void {
    this.rings.clear();
    this.lastEyeZ = Infinity;
    this.walked = 0;
    this.figureWalked = 0;
    for (let i = 0; i < this.arms.length; i++) {
      this.arms[i].rise = -this.arms[i].wait;
      this.placeArm(i);
    }
    for (const crowd of this.armCrowds) {
      crowd.commit();
      crowd.root.visible = false;
    }
  }
}
