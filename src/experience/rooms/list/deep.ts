import {
  AdditiveBlending,
  AnimationMixer,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type PerspectiveCamera,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { clone as cloneRigged } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import { clamp, DEG, lerp, range, smootherstep } from '../../math';
import { randomFrom } from '../../dream/FigureKit';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['mri_head', 'teeth_upper', 'teeth_lower', 'shark'],
  sounds: [
    'rooms/underwater_muffled.mp3',
    'rooms/underwater_weight.mp3',
    'rooms/bubbles_rising.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/dream_drone_hollow.mp3',
    'rooms/dream_drone_metal.mp3',
    'rooms/dream_drone_glass.mp3',
    'rooms/heart_slow.mp3',
    'rooms/heart_fast.mp3',
    'rooms/bubbles_exhale_1.mp3',
    'rooms/bubbles_exhale_2.mp3',
    'rooms/bubbles_burst.mp3',
    'rooms/breath_held.mp3',
    'rooms/breath_let_go.mp3',
    'rooms/gasp_surface.mp3',
    'rooms/groan_whale_1.mp3',
    'rooms/groan_whale_2.mp3',
    'rooms/groan_ship_1.mp3',
    'rooms/groan_ship_2.mp3',
    'rooms/groan_low.mp3',
    'rooms/hull_creak_1.mp3',
    'rooms/hull_creak_2.mp3',
    'rooms/hull_bottom.mp3',
    'rooms/flash_underwater.mp3',
    'rooms/sonar_ping.mp3',
    'rooms/eye_turn.mp3',
    'rooms/current_rush.mp3',
    'rooms/wind_in_ears.mp3',
  ],
};

/** Seconds into the room of what happens once. */
const AT = { lineOne: 3, prompt: 24, fallback: 34, groan: 48, flash: 50, ping: 58, lidFrom: 59.3, lidTo: 61.8, current: 66, lineTwo: 68, cut: 74 };

/** The hero: how tall the head is (m), and where the eye stands when the flash fires. */
const HEAD_HEIGHT = 60;
const FLASH_EYE = new Vector3(0, -105, 0);
/** Seen from the flash: the middle of the face lies this far down (deg) and this far away (m), turned toward you. */
const FACE_DOWN = 12;
const FACE_DISTANCE = 30;
/** How far the head lies back (deg), how far it rolls, and turns. */
const HEAD_TILT = 62;
const HEAD_ROLL = -7;
const HEAD_TURN = 2;
/** The middle of the face in the head's own space (the model: y 0..1, front +z). */
const FACE_CENTER = new Vector3(0.0, 0.42, 0.34);

/** Cells of the height field the face is smoothed and sculpted in, to a side, and how far it is blurred (cells). */
const FIELD = 720;
const SMOOTHING = 5;
/** The eye that opens, in the head's space: center of the ball, its radius, half width of the opening. */
const EYE = { x: 0.138, y: 0.5165, z: 0.236, radius: 0.052, halfWidth: 0.056 };
const OTHER_EYE_X = -0.135;
/** How the lids part: how far they turn on the ball (rad), and how far above and below the slit the skin goes with them. */
const LID = { up: 0.86, down: 0.26, reachUp: 0.044, reachDown: 0.03, band: 0.004 };
/** The mouth: the middle of the lip line and half its width; how far the jaw turns about its hinge (rad). */
const MOUTH = { x: 0.012, y: 0.2505, halfWidth: 0.115, hingeY: 0.4, hingeZ: 0.02, half: 0.105, wide: 0.66, band: 0.0065 };
/** Teeth as they grow, not as a set: how many places round the row (each about a tooth), and as shares of their height how much longer or shorter one is, how far it leans, how far it stands out of the row, how chipped its edge is. */
const TOOTH_CELLS = 26;
const TOOTH_LENGTH = 0.22;
const TOOTH_LEAN = 0.14;
const TOOTH_CROWD = 0.08;
const TOOTH_CHIP = 0.07;
/** Their colour against the enamel: clean, yellowed, a dead one, the stain where they leave the gum; the share of them that is dead; how rough the enamel is. */
const TOOTH_CLEAN: readonly [number, number, number] = [1.06, 1.03, 0.98];
const TOOTH_YELLOW: readonly [number, number, number] = [1.0, 0.86, 0.64];
const TOOTH_DEAD: readonly [number, number, number] = [0.64, 0.58, 0.5];
const TOOTH_NECK: readonly [number, number, number] = [0.62, 0.5, 0.38];
const TOOTH_DEAD_FROM = 0.84;
const ENAMEL_ROUGH = 0.55;
/** The gums: a wet, bloodless colour (not a red), how wet (roughness), how lumpy (share of their height), how much their shine is broken up, how dark their mottling goes. */
const GUM_COLOR = 0x3b2e2f;
const GUM_WET = 0.22;
const GUM_LUMP = 0.012;
const GUM_BUMP = 0.55;
const GUM_MOTTLE = 0.7;

/** A smooth random value round a ring of `period` places (t counted in places): the same at t and at t + period. */
function ringNoise(t: number, seed: number, period: number): number {
  const at = (k: number): number => {
    const h = Math.sin((((k % period) + period) % period) * 127.1 + seed * 311.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const i = Math.floor(t);
  const f = t - i;
  const a = at(i);
  return a + (at(i + 1) - a) * f * f * (3 - 2 * f);
}

/** Smooth lumps in space (0..1), over coordinates that run about -1..1. */
function lumps(x: number, y: number, z: number, seed: number, rate: number): number {
  return (
    0.5 +
    0.25 * Math.sin(rate * (1.3 * x + 0.4 * z) + seed) * Math.cos(rate * (1.1 * z - 0.6 * x) + 1.7 * seed) +
    0.25 * Math.sin(rate * (1.7 * y + 0.9 * x - 1.2 * z) + 2.3 * seed)
  );
}

/**
 * Teeth that grew, not a set out of a box: on a copy of the model (its own stays as it is) each tooth gets its own
 * length, lean, place in the row, chips and stain, and the gum round them goes lumpy, mottled and wet.
 */
function weatherTeeth(prop: Object3D, gumName: string, seed: number): void {
  const meshes: Mesh[] = [];
  prop.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
  });
  const gum = meshes.find((m) => m.name === gumName);
  const middle = (m: Mesh): number => {
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox!;
    return m.position.y + (m.scale.y * (b.min.y + b.max.y)) / 2;
  };
  for (const mesh of meshes) {
    const g = mesh.geometry.clone();
    g.computeBoundingBox();
    const box = g.boundingBox!;
    const cx = (box.min.x + box.max.x) / 2;
    const cy = (box.min.y + box.max.y) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const sx = Math.max(1e-6, (box.max.x - box.min.x) / 2);
    const sy = Math.max(1e-6, (box.max.y - box.min.y) / 2);
    const sz = Math.max(1e-6, (box.max.z - box.min.z) / 2);
    const pos = g.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    if (mesh === gum) {
      const nor = g.getAttribute('normal');
      for (let i = 0; i < pos.count; i++) {
        const x = (pos.getX(i) - cx) / sx;
        const y = (pos.getY(i) - cy) / sy;
        const z = (pos.getZ(i) - cz) / sz;
        const swell = (lumps(x, y, z, seed, 9) - 0.5) * GUM_LUMP * sy * 2;
        let nx = nor.getX(i);
        let ny = nor.getY(i);
        let nz = nor.getZ(i);
        pos.setXYZ(i, pos.getX(i) + nx * swell, pos.getY(i) + ny * swell, pos.getZ(i) + nz * swell);
        nx += (lumps(x, y, z, seed + 1, 31) - 0.5) * GUM_BUMP * 2;
        ny += (lumps(y, z, x, seed + 2, 29) - 0.5) * GUM_BUMP * 2;
        nz += (lumps(z, x, y, seed + 3, 33) - 0.5) * GUM_BUMP * 2;
        const n = Math.hypot(nx, ny, nz) || 1;
        nor.setXYZ(i, nx / n, ny / n, nz / n);
        const mottle = GUM_MOTTLE + (1 - GUM_MOTTLE) * lumps(x, y, z, seed + 4, 14);
        const vein = smootherstep(range(0.6, 0.8, lumps(z, y, x, seed + 5, 11)));
        colors[i * 3] = mottle * (1 - 0.1 * vein);
        colors[i * 3 + 1] = mottle * (1 - 0.06 * vein);
        colors[i * 3 + 2] = mottle * (1 + 0.1 * vein);
      }
    } else {
      const tipUp = !gum || middle(mesh) > middle(gum);
      for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i);
        let y = pos.getY(i);
        let z = pos.getZ(i);
        const rx = x - cx;
        const rz = z - cz;
        const r = Math.hypot(rx, rz) || 1;
        const place = (Math.atan2(rx, rz) / (Math.PI * 2) + 0.5) * TOOTH_CELLS;
        const e = (y - cy) / sy;
        const tip = clamp(tipUp ? (e + 1) / 2 : (1 - e) / 2, 0, 1);
        const longer = (ringNoise(place, seed, TOOTH_CELLS) - 0.5) * TOOTH_LENGTH * sy * 2 * tip;
        const chip = -ringNoise(place * 4, seed + 1, TOOTH_CELLS * 4) * TOOTH_CHIP * sy * 2 * smootherstep(range(0.75, 1, tip));
        const out = (ringNoise(place, seed + 2, TOOTH_CELLS) - 0.5) * (TOOTH_CROWD + TOOTH_LEAN * tip) * sy * 2;
        const aside = (ringNoise(place, seed + 3, TOOTH_CELLS) - 0.5) * TOOTH_LEAN * sy * 2 * tip;
        y += (longer + chip) * (tipUp ? 1 : -1);
        x += (rx / r) * out + (rz / r) * aside;
        z += (rz / r) * out - (rx / r) * aside;
        pos.setXYZ(i, x, y, z);
        const yellow = ringNoise(place, seed + 4, TOOTH_CELLS);
        const dead = smootherstep(range(TOOTH_DEAD_FROM, TOOTH_DEAD_FROM + 0.06, ringNoise(place, seed + 5, TOOTH_CELLS)));
        const neck = smootherstep(range(0.05, 0.4, tip));
        for (let k = 0; k < 3; k++) {
          const own = lerp(lerp(TOOTH_CLEAN[k], TOOTH_YELLOW[k], yellow), TOOTH_DEAD[k], dead);
          colors[i * 3 + k] = own * lerp(TOOTH_NECK[k], 1, neck);
        }
      }
    }
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    mesh.geometry = g;
  }
}

/** The sink, before the flash: seconds into the room, and where the eye is. */
const SINK = [
  { s: 0, x: -1, y: 0, z: -62, yaw: -40, pitch: 44, fov: 62 },
  { s: 5, x: -0.7, y: -8, z: -63, yaw: -37, pitch: 36, fov: 62 },
  { s: 10, x: 0, y: -17, z: -64, yaw: -33, pitch: 13, fov: 62 },
  { s: 15, x: 0.6, y: -27, z: -64.8, yaw: -29, pitch: 3, fov: 60 },
  { s: 20.5, x: 0.9, y: -38.5, z: -65.5, yaw: -38, pitch: 50, fov: 50 },
  { s: 25, x: 1, y: -49, z: -66.2, yaw: -40, pitch: 53, fov: 48 },
  { s: 31.5, x: 0.8, y: -62, z: -63, yaw: -14, pitch: -14, fov: 60 },
  { s: 40, x: 0.3, y: -77, z: -50, yaw: -6, pitch: -33, fov: 62 },
  { s: 46, x: 4, y: -87, z: -43, yaw: -14, pitch: -43, roll: 12, fov: 64 },
  { s: 49.99, x: 6, y: -94, z: -41, yaw: -20, pitch: -40, roll: 19, fov: 66 },
  { s: 50, x: FLASH_EYE.x, y: FLASH_EYE.y, z: FLASH_EYE.z, yaw: 0, pitch: -8, fov: 78 },
] as const;
/** After the flash: where the eye is in the head's space, what it looks at there, and its lens. */
const CLOSE = [
  { s: 53.5, at: [0.05, 0.25, 0.7], look: [0.09, 0.42, 0.36], fov: 60 },
  { s: 57.4, at: [0.16, 0.535, 0.47], look: [0.136, 0.51, 0.29], fov: 50 },
  { s: 60, at: [0.158, 0.53, 0.465], look: [0.136, 0.51, 0.29], fov: 49 },
  { s: 66, at: [0.15, 0.52, 0.43], look: [0.135, 0.508, 0.29], fov: 46 },
  { s: 68, at: [0.13, 0.4, 0.6], look: [0.06, 0.26, 0.33], fov: 56 },
  { s: 70, at: [0.03, 0.185, 0.66], look: [0.012, 0.2, 0.3], fov: 60 },
  { s: 71.8, at: [0.015, 0.19, 0.52], look: [0.012, 0.195, 0.2], fov: 62 },
  { s: 73, at: [0.012, 0.195, 0.4], look: [0.012, 0.19, 0.0], fov: 66 },
  { s: 74, at: [0.012, 0.2, 0.29], look: [0.012, 0.19, -0.2], fov: 70 },
  { s: 76, at: [0.012, 0.2, 0.16], look: [0.012, 0.19, -0.3], fov: 72 },
] as const;
/** The same way for a viewer who asks for less motion: you stay before the mouth, and it opens. */
const CLOSE_CALM = [
  ...CLOSE.slice(0, 5),
  { s: 71, at: [0.025, 0.215, 0.74], look: [0.012, 0.2, 0.3], fov: 60 },
  { s: 76, at: [0.025, 0.215, 0.72], look: [0.012, 0.2, 0.3], fov: 60 },
] as const;

/** The bright oval: where it lies from the first look (deg off straight up, toward the viewer's first heading), and how large (tangent). */
const OVAL = { offZenith: 24, heading: -40, radius: 0.08, squash: 0.62 };
/** What crosses the oval, an outline the length of a bus: the second it is over the middle, m/s, m away along the line to the oval, scale of the model (1 is 6 m), how far it is banked to show its fins (deg), speed of the tail, and when it exists (s). */
const SHARK = { middle: 23, speed: 3.4, distance: 60, scale: 1.85, bank: 38, tail: 0.35, from: 15, to: 31 };
/** How much of the surface's light reaches each depth (seconds, 0..1). */
const LIGHT = { times: [0, 8, 22, 30, 40, 48], values: [1, 0.72, 0.32, 0.12, 0.03, 0.006] };
/** The water's colors at full light: straight up and level, and what lies below (linear). */
const WATER_TOP = new Color(0.015, 0.082, 0.125);
const WATER_LEVEL = new Color(0.002, 0.014, 0.026);
const WATER_DEEP = new Color(0.0003, 0.0016, 0.0034);
/** The fog: density in the dark, and in the flash. */
const FOG = { dark: 0.0115, flash: 0.0075 };

/** The flash: its candela, how long its first pop lasts and what share of it that is (s, 0..1), how it lingers (s), and when it has gone (s after it). */
const FLASH = { candela: 3000, popShare: 0.3, pop: 0.11, linger: 1.5, gone: 5, white: 0.82, whiteFall: 0.09 };

/** The low light from nowhere: where it stands by the eye (in the head's space), how strong it is there and at the mouth (cd), how far it reaches (m). */
const LOW_LIGHT = { at: [0.15, 0.61, 0.58] as const, eye: 150, mouth: 300, reach: 70 };

/** Marine snow: flakes in a near box and a far one (half side, m), and their size (m). */
const SNOW = { near: 700, nearBox: 5, far: 900, farBox: 17, size: [0.012, 0.06] as const };
/** Your bubbles: most alive at once, m/s of rising, m of size. */
const BUBBLES = { count: 200, ready: 44, rise: [0.75, 1.55] as const, size: [0.006, 0.055] as const };
/** Seconds in which you breathe out by yourself, and how many bubbles a second. */
const EXHALES = [
  [0.2, 5.4],
  [11.5, 15],
  [19.5, 23],
  [27.5, 30.5],
  [36, 39],
  [43.5, 46],
  [53.5, 55.5],
  [62.4, 64.6],
] as const;
const BUBBLE_RATE = 17;
/** The breath: when it can be held, and how long a viewer can hold it (s) before it goes by itself. */
const BREATH = { from: AT.prompt, until: 72, longest: 17, burst: 64 };

/** The hair: locks from the scalp (one rope and its fine hairs), and how many strands rise from each far head. */
const HAIR = { locks: 280, finePerLock: 3, ropeWidth: [0.04, 0.1] as const, fineWidth: [0.009, 0.024] as const, tipY: [-66, -15] as const, fan: 1.18, center: [0, -80] as const, farStrands: 8, clear: 1.6, closeLocks: 46, closeFrom: 1.1, opensLate: 1.7, clearClose: 11, haze: 5.5 };
/** The plain of the sleeping: distance between heads (m), how many rows behind and ahead, columns to each side, how far the rows are turned, and how far the heads lie back (deg). */
const ROWS = { step: 84, back: 3, ahead: 14, side: 9, turn: 9, tilt: 38 };
/** Lashes and brows, ropes of their own (count, length m, width m). */
const LASHES = { count: 120, length: [1.2, 2.5] as const, width: 0.02 };
const BROWS = { count: 130, length: [2.2, 5.5] as const, width: 0.024 };

const WATER_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  p.z = p.w * 0.99999;
  gl_Position = p;
}
`;
const WATER_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uLevel;
uniform vec3 uDeep;
uniform float uLight;
uniform float uTime;
uniform vec3 uOvalDir;
uniform vec3 uOvalU;
uniform vec3 uOvalV;
uniform float uOvalRadius;
uniform float uOvalSquash;
uniform float uFlash;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  return noise(p) * 0.55 + noise(p * 2.13 + 7.1) * 0.3 + noise(p * 4.7 + 3.3) * 0.15;
}

void main() {
  vec3 d = normalize(vDir);
  float along = dot(d, uOvalDir);
  // the water itself: lit from above, black below
  float up = d.y * 0.5 + 0.5;
  vec3 c = mix(uDeep, uLevel, smoothstep(0.1, 0.62, up));
  c = mix(c, uTop, pow(smoothstep(0.52, 1.0, up), 2.2));
  // layers of darker water drifting
  c *= 0.72 + 0.56 * fbm(vec2(d.x * 2.1 + uTime * 0.012, d.y * 5.5 - uTime * 0.008) + d.z * 1.7);
  // around the oval: tangent-plane place, angle, distance
  float safe = max(along, 0.02);
  vec2 q = vec2(dot(d, uOvalU), dot(d, uOvalV) / uOvalSquash) / safe;
  float r = length(q);
  vec2 ray = q / max(r, 1e-4);
  // shafts falling from it: bands around the oval that shift slowly, the far ends fainter
  float sweep = uTime * 0.03;
  float shaft = fbm(ray * 2.7 + sweep) * 0.6 + fbm(ray * 7.3 - sweep * 1.7) * 0.4;
  shaft = smoothstep(0.46, 0.74, shaft);
  float reach = exp(-max(r - uOvalRadius, 0.0) * 0.92) * smoothstep(-0.3, 0.3, along);
  c += uTop * shaft * shaft * reach * 1.25;
  // a veil of scattered light around it
  c += uTop * exp(-r * 4.2) * 1.1 * step(0.0, along);
  // the oval: broken by the waves far above
  float edge = fbm(q * 13.0 + vec2(uTime * 0.11, -uTime * 0.07));
  float inner = smoothstep(uOvalRadius * 1.02, uOvalRadius * 0.74, r + (edge - 0.5) * uOvalRadius * 0.34) * step(0.0, along);
  float caustic = 0.62 + 0.62 * fbm(q * 34.0 + vec2(-uTime * 0.2, uTime * 0.16));
  c += vec3(0.82, 1.0, 1.0) * inner * caustic * 6.0;
  c *= uLight;
  // the flash: light that comes straight back out of the water
  vec3 forward = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  c += vec3(0.0005, 0.004, 0.0085) * uFlash * (0.45 + 0.55 * pow(max(dot(d, forward), 0.0), 3.0));
  gl_FragColor = vec4(c, 1.0);
}
`;

const SNOW_VERT = /* glsl */ `
attribute vec4 aSeed;
attribute float aBox;
uniform vec3 uEye;
uniform float uTime;
uniform float uSize0;
uniform float uSize1;
uniform vec3 uVelocity;
uniform float uPixel;
varying vec2 vUv;
varying float vFade;
varying float vNear;
void main() {
  // flakes stay where they are in the water, and the box of them follows the eye
  vec3 p = aSeed.xyz * aBox * 2.0;
  p.x += sin(uTime * 0.13 + aSeed.w * 40.0) * 0.4;
  p.y += sin(uTime * 0.09 + aSeed.w * 90.0) * 0.3 + uTime * 0.025;
  p.z += cos(uTime * 0.11 + aSeed.w * 70.0) * 0.4;
  p = mod(p - uEye + aBox, aBox * 2.0) - aBox;
  float away = length(p);
  vFade = smoothstep(aBox, aBox * 0.6, away);
  vec4 mv = modelViewMatrix * vec4(p + uEye, 1.0);
  float size = mix(uSize0, uSize1, aSeed.w * aSeed.w);
  // never thinner than a pixel; thinner flakes only fade
  float least = uPixel * max(0.1, -mv.z);
  vFade *= min(1.0, size / least);
  size = max(size, least);
  // what you fall past draws a line
  vec3 ahead = mv.xyz - (viewMatrix * vec4(uVelocity, 0.0)).xyz * 0.05;
  vec2 along = ahead.xy * (mv.z / min(ahead.z, -0.06)) - mv.xy;
  float speed = length(along);
  vec2 dir = speed > 1e-4 ? along / speed : vec2(0.0, 1.0);
  vec2 side = vec2(-dir.y, dir.x);
  vec2 q = position.xy;
  mv.xy += mix(vec2(0.0), along, q.y + 0.5) + side * q.x * size + dir * q.y * size;
  vFade *= size / (size + speed * 0.5);
  vUv = position.xy;
  vNear = smoothstep(1.8, 0.35, -mv.z);
  gl_Position = projectionMatrix * mv;
  if (mv.z > -0.09) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const SNOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uFlash;
varying vec2 vUv;
varying float vFade;
varying float vNear;
void main() {
  float d = length(vUv) * 2.0;
  float a = smoothstep(1.0, 0.25, d);
  // close to the lens a flake is out of focus: a soft disc, brighter at its rim
  float disc = smoothstep(1.0, 0.86, d) * (0.42 + 0.58 * smoothstep(0.4, 0.95, d));
  a = mix(a, disc, vNear);
  // the flash comes back off whatever floats nearest the lens
  vec3 c = uColor + vec3(0.8, 0.95, 1.0) * uFlash * (0.3 + vNear * 2.6);
  gl_FragColor = vec4(c * a * vFade, 1.0);
}
`;

const BUBBLE_VERT = /* glsl */ `
attribute vec4 aBubble;
attribute float aWobble;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec4 mv = modelViewMatrix * vec4(aBubble.xyz, 1.0);
  float size = aBubble.w;
  vec2 q = position.xy * 2.0;
  // a large bubble is a wobbling cap, not a ball
  float big = smoothstep(0.012, 0.05, size);
  float w = sin(uTime * (7.0 + aWobble * 5.0) + aWobble * 40.0);
  q.y *= 1.0 - big * (0.1 + 0.07 * w);
  q.x *= 1.0 + big * 0.1 * w;
  mv.xy += q * size;
  vUv = position.xy * 2.0;
  gl_Position = projectionMatrix * mv;
  if (size <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const BUBBLE_FRAG = /* glsl */ `
uniform vec3 uLightColor;
varying vec2 vUv;
void main() {
  float d = length(vUv);
  if (d > 1.0) discard;
  // silver at the rim and along the top, where the light from above is turned back
  float rim = smoothstep(0.7, 0.97, d) * smoothstep(1.0, 0.96, d);
  float top = smoothstep(0.1, 0.95, vUv.y) * smoothstep(0.55, 0.95, d);
  float under = smoothstep(0.7, 0.0, length(vUv - vec2(0.1, -0.6))) * 0.16;
  gl_FragColor = vec4(uLightColor * (rim * 0.55 + top * 0.6 + under + 0.03), 1.0);
}
`;

const FAR_VERT = /* glsl */ `
attribute vec2 aLit;
varying vec3 vNormalV;
varying vec3 vViewV;
varying vec2 vUv;
varying vec2 vLit;
varying float vY;
void main() {
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * world;
  vNormalV = normalize(mat3(viewMatrix) * mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vViewV = -mv.xyz;
  vUv = uv;
  vLit = aLit;
  // how high it stands above its own neck, in its own size: below a certain height the plain is black
  vY = (world.y - instanceMatrix[3].y - modelMatrix[3].y) / length(instanceMatrix[1].xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const FAR_FRAG = /* glsl */ `
uniform sampler2D tSkin;
uniform float uFlash;
uniform vec3 uHaze;
varying vec3 vNormalV;
varying vec3 vViewV;
varying vec2 vUv;
varying vec2 vLit;
varying float vY;
void main() {
  vec3 albedo = texture2D(tSkin, vUv).rgb;
  vec3 v = normalize(vViewV);
  float ndv = max(dot(normalize(vNormalV), v), 0.0);
  vec3 c = albedo * (0.06 + 0.94 * ndv) * vLit.x * uFlash;
  // water eats red first
  c *= vec3(0.34 * (1.0 - vLit.y) + 0.12, 0.62, 0.9);
  // what stands low, or far, is the water
  vec3 water = uHaze * uFlash * (0.45 + 0.55 * pow(max(v.z, 0.0), 3.0));
  c = mix(water, c, smoothstep(0.24, 0.5, vY) * (1.0 - vLit.y * 0.9));
  gl_FragColor = vec4(c, 1.0);
}
`;

const HAIR_VERT = /* glsl */ `
attribute vec4 aRoot;
attribute vec4 aTop;
attribute vec4 aMove;
attribute vec4 aLook;
attribute vec3 aKick;
uniform float uTime;
uniform float uPixel;
uniform vec3 uEye;
uniform float uClear;
uniform float uLight;
uniform float uFlash;
uniform float uFlashTop;
uniform float uGlow;
uniform float uNear;
uniform float uHaze;
uniform float uLid;
uniform vec3 uBall;
uniform vec3 uBallAxis;
uniform float uPull;
uniform vec3 uMouth;
varying float vSide;
varying float vCover;
varying float vAmbient;
varying float vFlash;
varying float vMeters;
varying float vBright;
varying vec3 vSheen;
varying float vFar;
varying float vGlow;

vec3 strand(float s) {
  vec3 root = aRoot.xyz;
  // a lash turns with its lid, about the ball's axis
  if (aMove.y != 0.0) {
    float a = aMove.y * uLid;
    vec3 r = root - uBall;
    root = uBall + r * cos(a) + cross(uBallAxis, r) * sin(a) + uBallAxis * dot(uBallAxis, r) * (1.0 - cos(a));
  }
  float y = s * aTop.y;
  float spread = pow(s, ${HAIR.opensLate.toFixed(1)});
  vec3 p = root + vec3(aTop.x * spread, y, aTop.z * spread);
  // it leaves the scalp along the scalp, then gives in to the water
  p += aKick * (1.0 - exp(-y * 0.05)) * aMove.z;
  // slow waves travelling up it: a lock moves together
  float amp = min(y * 0.05, 3.2);
  float ph = y * 0.082 - uTime * 0.21 + aMove.x;
  p.x += amp * sin(ph);
  p.z += amp * cos(ph * 0.83 + 1.3);
  float ph2 = y * 0.26 - uTime * 0.34 + aMove.x * 2.3;
  p.x += amp * 0.6 * sin(ph2 + aRoot.w * 0.4);
  p.z += amp * 0.6 * cos(ph2 * 1.1 + aRoot.w * 0.6);
  float ph3 = y * 0.6 - uTime * 0.46 + aRoot.w;
  p.x += min(y * 0.03, 0.42) * sin(ph3);
  p.z += min(y * 0.03, 0.42) * cos(ph3 * 0.9);
  // up close it is never straight
  float ph4 = y * 1.05 - uTime * 0.6 + aRoot.w * 3.0;
  p.x += min(y * 0.02, 0.24) * sin(ph4);
  p.z += min(y * 0.02, 0.24) * cos(ph4 * 1.1);
  // the current, at the end: everything goes to the mouth
  if (uPull > 0.0 && aLook.w > 0.0) {
    vec3 m = uMouth - p;
    p += m * clamp(uPull * aLook.w * smoothstep(0.02, 0.5, s) * exp(-length(m) * 0.012), 0.0, 0.92);
  }
  return p;
}

void main() {
  float s = position.x;
  vec3 p = strand(s);
  vec3 q = strand(s + 0.012);
  vec3 T = normalize(q - p);
  // nothing goes through the eye: what comes near it parts
  vec3 e = p - uEye;
  float er = length(e);
  if (aMove.w < 0.5) p = uEye + e / max(er, 1e-3) * sqrt(er * er + uClear * uClear);
  vec3 toEye = uEye - p;
  float dist = length(toEye);
  vec3 V = toEye / dist;
  vec3 B = normalize(cross(T, V));
  float taper = aMove.w > 0.5 ? mix(1.0, 0.06, s) : mix(1.0, 0.12, smoothstep(0.68, 1.0, s));
  float width = aTop.w * taper;
  float least = uPixel * dist * 0.6;
  float w = max(width, least);
  // thinner than a pixel it only fades, and far off the water takes it
  vCover = (width / w) * exp(-dist * dist * aLook.z * uHaze);
  p += B * position.y * w;
  vSide = position.y;
  vMeters = s * aTop.y;
  vBright = aLook.x;
  // the light of the surface dies with depth; here it counts from where the eye is
  vAmbient = uLight * exp(clamp(p.y - uEye.y, -60.0, 12.0) * 0.024) * (0.3 + 0.7 * exp(-dist * 0.045));
  vGlow = uGlow * aMove.w + uNear * exp(-dist * 0.07);
  vFlash = uFlash * aLook.y / (1.0 + dist * dist / 3600.0) * smoothstep(uFlashTop + 34.0, uFlashTop - 6.0, p.y);
  vFar = smoothstep(15.0, 110.0, dist) * (1.0 - aMove.w);
  // a wet shine from above, along the strand
  vec3 H = normalize(vec3(0.0, 1.0, 0.0) + V);
  float along = dot(T, H);
  vSheen = vec3(0.7, 0.92, 1.0) * pow(max(0.0, 1.0 - along * along), 26.0) * vAmbient * 0.5;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;
const HAIR_FRAG = /* glsl */ `
varying float vSide;
varying float vCover;
varying float vAmbient;
varying float vFlash;
varying float vMeters;
varying float vBright;
varying vec3 vSheen;
varying float vFar;
varying float vGlow;
void main() {
  if (vCover < 0.01) discard;
  // round: a tube seen from the side, with its scales up close
  float n = sqrt(max(0.0, 1.0 - vSide * vSide));
  float scale = 0.9 + 0.1 * sin(vMeters * 34.0 + vSide * 3.0);
  float fibre = 0.86 + 0.14 * sin(vSide * 7.0 + vMeters * 0.9);
  vec3 hair = vec3(0.86, 0.86, 0.8) * vBright * scale * fibre;
  vec3 c = hair * mix(vec3(0.82, 0.94, 1.0), vec3(0.5, 0.82, 1.0), vFar) * vAmbient * (0.28 + 0.72 * n) * 0.8 + hair * mix(vec3(1.0), vec3(0.42, 0.72, 0.95), vFar) * vFlash * (0.3 + 0.7 * n) + vSheen * n + hair * vGlow * (0.4 + 0.6 * n);
  gl_FragColor = vec4(c, vCover);
}
`;

/** The line of the closed eye in the head's space, down from a straight line between its corners. */
function slitY(x: number, eyeX: number): number {
  const a = (x - eyeX) / EYE.halfWidth;
  return EYE.y - 0.0065 * (1 - a * a) - 0.0028 * a * Math.sign(eyeX);
}

/** A fold of old skin, in the head's space: where it runs, how wide it is, how deep it goes; a lip of skin stands beside it. */
interface Fold {
  points: readonly (readonly [number, number])[];
  width: number;
  depth: number;
  lip?: readonly [number, number];
}

/** The big folds of a face grown old: real grooves in the geometry, and painted over. */
function foldsOfTheFace(): Fold[] {
  const random = randomFrom(83);
  const folds: Fold[] = [];
  const arc = (x0: number, y0: number, x1: number, y1: number, bow: number, n = 9) => {
    const out: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      out.push([x0 + (x1 - x0) * t + (random() - 0.5) * 0.0025, y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * bow + (random() - 0.5) * 0.0025]);
    }
    return out;
  };
  // the forehead's furrows: broken, uneven
  for (let i = 0; i < 4; i++) {
    const y = 0.624 + i * 0.03 + (random() - 0.5) * 0.012;
    let from = -0.17 + random() * 0.06;
    while (from < 0.17) {
      const to = from + 0.06 + random() * 0.17;
      folds.push({ points: arc(from, y - from * from * 0.25 + (random() - 0.5) * 0.006, to, y - to * to * 0.25 + (random() - 0.5) * 0.006, 0.004 + random() * 0.007), width: 0.0048 + random() * 0.0034, depth: 0.0012 + random() * 0.0016, lip: [0, 0.006] });
      from = to + 0.008 + random() * 0.045;
    }
  }
  // between the brows
  for (const dx of [-0.018, 0.018]) folds.push({ points: arc(dx, 0.556, dx * 1.3, 0.612, 0, 5), width: 0.0052, depth: 0.0034 });
  for (const [side, ex] of [[1, EYE.x], [-1, OTHER_EYE_X]] as const) {
    const y = EYE.y;
    // above the lid, and the bags below it
    folds.push({ points: arc(ex - 0.06, y + 0.014, ex + 0.064, y + 0.008, 0.026, 12), width: 0.0052, depth: 0.0034 });
    folds.push({ points: arc(ex - 0.05, y - 0.024, ex + 0.06, y - 0.018, -0.012, 10), width: 0.0036, depth: 0.0016 });
    folds.push({ points: arc(ex - 0.062, y - 0.044, ex + 0.074, y - 0.036, -0.018, 11), width: 0.0064, depth: 0.0034, lip: [0, 0.008] });
    folds.push({ points: arc(ex - 0.05, y - 0.064, ex + 0.066, y - 0.056, -0.014, 9), width: 0.0046, depth: 0.002 });
    // crow's feet
    for (let i = 0; i < 6; i++) {
      const a = -0.75 + (i / 5) * 1.5 + (random() - 0.5) * 0.12;
      const r0 = 0.068 + random() * 0.008;
      const r1 = r0 + 0.035 + random() * 0.05;
      folds.push({ points: arc(ex + side * Math.cos(a) * r0, y + Math.sin(a) * r0, ex + side * Math.cos(a) * r1, y + Math.sin(a) * r1 - 0.006, 0.004, 5), width: 0.0036, depth: 0.0014 });
    }
    // from the nose to the mouth, and on down past it
    const m = side > 0 ? MOUTH.x + MOUTH.halfWidth : MOUTH.x - MOUTH.halfWidth;
    folds.push({ points: [[0.03 + side * 0.058, 0.372], [0.03 + side * 0.078, 0.338], [m + side * 0.012, 0.292], [m + side * 0.036, 0.242], [m + side * 0.052, 0.196]], width: 0.0095, depth: 0.0075, lip: [side * 0.0125, 0.003] });
    folds.push({ points: [[m + side * 0.002, 0.244], [m + side * 0.01, 0.205], [m + side * 0.014, 0.16], [m + side * 0.03, 0.112]], width: 0.008, depth: 0.0048, lip: [side * 0.01, 0] });
  }
  folds.push({ points: arc(MOUTH.x - 0.07, 0.172, MOUTH.x + 0.07, 0.172, -0.012, 9), width: 0.008, depth: 0.0036 });
  folds.push({ points: arc(MOUTH.x - MOUTH.halfWidth, MOUTH.y, MOUTH.x + MOUTH.halfWidth, MOUTH.y, 0, 12), width: 0.006, depth: 0.005, lip: [0, -0.012] });
  return folds;
}

/** The scan is a whole head, brain and skull and all: only the triangles of the shell that holds the tip of the nose. */
function outerSkin(position: Float32Array, index: ArrayLike<number>): number[] {
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

/** Half of a head's front is smooth enough to hold a texture laid straight on it: x, y of the model are its coordinates. */
function faceUv(x: number, y: number): [number, number] {
  return [x + 0.5, y];
}

/** Where in the head's space the surface bulges or sinks for a face grown old: added along +z, in big soft forms. */
function sculpt(x: number, y: number, z: number): number {
  if (z < 0.05) return 0;
  const front = Math.min(1, (z - 0.05) / 0.1);
  const bump = (cx: number, cy: number, rx: number, ry: number, amount: number) => {
    const u = (x - cx) / rx;
    const v = (y - cy) / ry;
    return amount * Math.exp(-(u * u + v * v));
  };
  let d = 0;
  // hollow cheeks and temples, jowls, heavy brows, bags under the eyes
  for (const [side, ex] of [[1, EYE.x], [-1, OTHER_EYE_X]] as const) {
    d += bump(ex + side * 0.03, 0.335, 0.05, 0.05, -0.012);
    d += bump(ex + side * 0.105, 0.625, 0.045, 0.06, -0.012);
    d += bump(ex + side * 0.01, 0.135, 0.06, 0.04, 0.008);
    d += bump(ex, 0.588, 0.075, 0.014, 0.006);
    d += bump(ex + side * 0.005, 0.468, 0.055, 0.012, 0.004);
  }
  return d * front;
}

/**
 * The scan's triangles as curved patches through their corners and normals (PN triangles), cut finer where the
 * eye will come close, and the old face sculpted onto them.
 */
function curvedHead(position: Float32Array, normal: Float32Array, index: ArrayLike<number>, folds: readonly Fold[]): { geometry: BufferGeometry; surfaceZ: (x: number, y: number) => number } {
  const levelOf = (x: number, y: number, z: number) => {
    if (z < -0.12) return 1;
    if (z < 0.1) return 2;
    const nearEye = Math.abs(y - EYE.y) < 0.06 && Math.abs(x - EYE.x) < 0.075;
    const nearMouth = Math.abs(x - MOUTH.x) < 0.14 && y > 0.22 && y < 0.285;
    return nearEye || nearMouth ? 4 : 3;
  };
  const triangles = index.length / 3;
  const levels = new Uint8Array(triangles);
  let outTris = 0;
  for (let t = 0; t < triangles; t++) {
    const a = index[t * 3];
    const b = index[t * 3 + 1];
    const c = index[t * 3 + 2];
    const cx = (position[a * 3] + position[b * 3] + position[c * 3]) / 3;
    const cy = (position[a * 3 + 1] + position[b * 3 + 1] + position[c * 3 + 1]) / 3;
    const cz = (position[a * 3 + 2] + position[b * 3 + 2] + position[c * 3 + 2]) / 3;
    levels[t] = levelOf(cx, cy, cz);
    outTris += 4 ** levels[t];
  }
  const pos = new Float32Array(outTris * 9);
  const nor = new Float32Array(outTris * 9);
  const uv = new Float32Array(outTris * 6);
  let w = 0;
  const P = [new Vector3(), new Vector3(), new Vector3()];
  const N = [new Vector3(), new Vector3(), new Vector3()];
  const b210 = new Vector3();
  const b120 = new Vector3();
  const b021 = new Vector3();
  const b012 = new Vector3();
  const b102 = new Vector3();
  const b201 = new Vector3();
  const b111 = new Vector3();
  const n110 = new Vector3();
  const n011 = new Vector3();
  const n101 = new Vector3();
  const tmp = new Vector3();
  const tmp2 = new Vector3();
  const edgeControl = (out: Vector3, a: Vector3, b: Vector3, na: Vector3) => {
    const w12 = tmp.subVectors(b, a).dot(na);
    out.copy(a).multiplyScalar(2).add(b).addScaledVector(na, -w12).multiplyScalar(1 / 3);
  };
  const edgeNormal = (out: Vector3, a: Vector3, b: Vector3, na: Vector3, nb: Vector3) => {
    tmp.subVectors(b, a);
    tmp2.addVectors(na, nb);
    const v = (2 * tmp.dot(tmp2)) / Math.max(1e-9, tmp.lengthSq());
    out.copy(tmp2).addScaledVector(tmp, -v).normalize();
  };
  const emit = (u: number, v: number) => {
    const t = 1 - u - v;
    const blend = (axis: 'x' | 'y' | 'z') => P[0][axis] * t * t * t + P[1][axis] * u * u * u + P[2][axis] * v * v * v + 3 * b210[axis] * t * t * u + 3 * b120[axis] * t * u * u + 3 * b201[axis] * t * t * v + 3 * b021[axis] * u * u * v + 3 * b102[axis] * t * v * v + 3 * b012[axis] * u * v * v + 6 * b111[axis] * t * u * v;
    const bendN = (axis: 'x' | 'y' | 'z') => N[0][axis] * t * t + N[1][axis] * u * u + N[2][axis] * v * v + n110[axis] * t * u + n011[axis] * u * v + n101[axis] * t * v;
    const px = blend('x');
    const py = blend('y');
    const pz = blend('z');
    const nx = bendN('x');
    const ny = bendN('y');
    const nz = bendN('z');
    const l = Math.hypot(nx, ny, nz) || 1;
    pos[w * 3] = px;
    pos[w * 3 + 1] = py;
    pos[w * 3 + 2] = pz;
    nor[w * 3] = nx / l;
    nor[w * 3 + 1] = ny / l;
    nor[w * 3 + 2] = nz / l;
    const [s, r] = faceUv(px, py);
    uv[w * 2] = s;
    uv[w * 2 + 1] = r;
    w++;
  };
  for (let t = 0; t < triangles; t++) {
    for (let k = 0; k < 3; k++) {
      const i = index[t * 3 + k];
      P[k].set(position[i * 3], position[i * 3 + 1], position[i * 3 + 2]);
      N[k].set(normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]);
    }
    edgeControl(b210, P[0], P[1], N[0]);
    edgeControl(b120, P[1], P[0], N[1]);
    edgeControl(b021, P[1], P[2], N[1]);
    edgeControl(b012, P[2], P[1], N[2]);
    edgeControl(b102, P[2], P[0], N[2]);
    edgeControl(b201, P[0], P[2], N[0]);
    b111.copy(b210).add(b120).add(b021).add(b012).add(b102).add(b201).multiplyScalar(1 / 6);
    tmp2.copy(P[0]).add(P[1]).add(P[2]).multiplyScalar(1 / 3);
    b111.addScaledVector(tmp.subVectors(b111, tmp2), 0.5);
    edgeNormal(n110, P[0], P[1], N[0], N[1]);
    edgeNormal(n011, P[1], P[2], N[1], N[2]);
    edgeNormal(n101, P[2], P[0], N[2], N[0]);
    const n = 2 ** levels[t];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        emit(i / n, j / n);
        emit((i + 1) / n, j / n);
        emit(i / n, (j + 1) / n);
        if (j < n - i - 1) {
          emit((i + 1) / n, j / n);
          emit((i + 1) / n, (j + 1) / n);
          emit(i / n, (j + 1) / n);
        }
      }
    }
  }

  // seen from the front the face is a height field: smoothed, it loses the scan's coarse facets; sculpted, it grows old
  const G = FIELD;
  const size = G * G;
  const height = new Float32Array(size).fill(-9);
  for (let i = 0; i + 2 < w; i += 3) {
    if (nor[i * 3 + 2] + nor[i * 3 + 5] + nor[i * 3 + 8] < 0.3) continue;
    const ax = (pos[i * 3] + 0.5) * G;
    const ay = pos[i * 3 + 1] * G;
    const bx = (pos[i * 3 + 3] + 0.5) * G;
    const by = pos[i * 3 + 4] * G;
    const cx = (pos[i * 3 + 6] + 0.5) * G;
    const cy = pos[i * 3 + 7] * G;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-6) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const x1 = Math.min(G - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(G - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const a = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
        const b = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
        const k = 1 - a - b;
        if (a < -0.02 || b < -0.02 || k < -0.02) continue;
        const z = a * pos[i * 3 + 2] + b * pos[i * 3 + 5] + k * pos[i * 3 + 8];
        if (z > height[y * G + x]) height[y * G + x] = z;
      }
    }
  }
  // box blurs, three passes each way, weighted so that the edge of the face does not sink
  const line = new Float32Array(G);
  const lineWeight = new Float32Array(G);
  const R = SMOOTHING;
  for (let pass = 0; pass < 3; pass++) {
    for (let way = 0; way < 2; way++) {
      for (let o = 0; o < G; o++) {
        let sum = 0;
        let weight = 0;
        for (let i = 0; i < G; i++) {
          const v = height[way ? i * G + o : o * G + i];
          line[i] = v;
          lineWeight[i] = v > -8 ? 1 : 0;
        }
        for (let i = -R; i < G; i++) {
          const add = i + R;
          const drop = i - R - 1;
          if (add < G && lineWeight[add]) {
            sum += line[add];
            weight++;
          }
          if (drop >= 0 && lineWeight[drop]) {
            sum -= line[drop];
            weight--;
          }
          if (i >= 0 && lineWeight[i]) height[way ? i * G + o : o * G + i] = sum / Math.max(1, weight);
        }
      }
    }
  }
  const carve = new Float32Array(size);
  const raise = new Float32Array(size);
  const stamp = (into: Float32Array, x: number, y: number, width: number, depth: number) => {
    const reach = Math.ceil(width * 2.3 * G);
    const cx = (x + 0.5) * G;
    const cy = y * G;
    for (let j = -reach; j <= reach; j++) {
      for (let i = -reach; i <= reach; i++) {
        const gx = Math.round(cx) + i;
        const gy = Math.round(cy) + j;
        if (gx < 0 || gy < 0 || gx >= G || gy >= G) continue;
        const d2 = ((gx - cx) ** 2 + (gy - cy) ** 2) / (width * G) ** 2;
        const c = gy * G + gx;
        into[c] = Math.max(into[c], depth * Math.exp(-d2));
      }
    }
  };
  for (const f of folds) {
    for (let k = 0; k < f.points.length - 1; k++) {
      const [x0, y0] = f.points[k];
      const [x1, y1] = f.points[k + 1];
      const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (f.width * 0.5));
      for (let n = 0; n <= steps; n++) {
        const x = lerp(x0, x1, n / steps);
        const y = lerp(y0, y1, n / steps);
        stamp(carve, x, y, f.width, f.depth);
        if (f.lip) stamp(raise, x + f.lip[0], y + f.lip[1], f.width * 1.3, f.depth * 0.4);
      }
    }
  }
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      const c = y * G + x;
      if (height[c] > -8) height[c] += sculpt(x / G - 0.5, y / G, height[c]) - carve[c] + raise[c];
    }
  }
  const at = (x: number, y: number) => {
    const fx = clamp((x + 0.5) * G - 0.5, 0, G - 1.001);
    const fy = clamp(y * G - 0.5, 0, G - 1.001);
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const a = height[iy * G + ix];
    const b = height[iy * G + ix + 1];
    const c = height[(iy + 1) * G + ix];
    const d = height[(iy + 1) * G + ix + 1];
    if (a < -8 || b < -8 || c < -8 || d < -8) return -9;
    return lerp(lerp(a, b, fx - ix), lerp(c, d, fx - ix), fy - iy);
  };
  const e = 1.5 / G;
  for (let i = 0; i < w; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const nz = nor[i * 3 + 2];
    const field = at(x, y);
    if (field < -8 || nz < 0.2 || z < 0.04) continue;
    const dx = at(x + e, y);
    const dxm = at(x - e, y);
    const dy = at(x, y + e);
    const dym = at(x, y - e);
    if (dx < -8 || dxm < -8 || dy < -8 || dym < -8) continue;
    // only where the surface really faces the front: under the nose and at the ears it keeps its own shape
    const k = smootherstep((nz - 0.2) / 0.3) * smootherstep((z - 0.04) / 0.08) * smootherstep((0.05 - Math.abs(field - z)) / 0.03);
    if (k <= 0) continue;
    const gx = -(dx - dxm) / (2 * e);
    const gy = -(dy - dym) / (2 * e);
    const gl = Math.hypot(gx, gy, 1);
    pos[i * 3 + 2] = lerp(z, field, k);
    const mx = lerp(nor[i * 3], gx / gl, k);
    const my = lerp(nor[i * 3 + 1], gy / gl, k);
    const mz = lerp(nz, 1 / gl, k);
    const ml = Math.hypot(mx, my, mz) || 1;
    nor[i * 3] = mx / ml;
    nor[i * 3 + 1] = my / ml;
    nor[i * 3 + 2] = mz / ml;
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return { geometry: g, surfaceZ: at };
}

/** The same head far off: vertices clustered into cells of this size (shares of its height), for a crowd of hills. */
function clusteredHead(position: Float32Array, normal: Float32Array, index: ArrayLike<number>, cell: number): BufferGeometry {
  const cells = new Map<string, number>();
  const sums: number[][] = [];
  const remap = new Int32Array(position.length / 3);
  for (let i = 0; i < remap.length; i++) {
    const key = `${Math.floor(position[i * 3] / cell)},${Math.floor(position[i * 3 + 1] / cell)},${Math.floor(position[i * 3 + 2] / cell)}`;
    let c = cells.get(key);
    if (c === undefined) {
      c = sums.length;
      cells.set(key, c);
      sums.push([0, 0, 0, 0, 0, 0, 0]);
    }
    const s = sums[c];
    s[0] += position[i * 3];
    s[1] += position[i * 3 + 1];
    s[2] += position[i * 3 + 2];
    s[3] += normal[i * 3];
    s[4] += normal[i * 3 + 1];
    s[5] += normal[i * 3 + 2];
    s[6]++;
    remap[i] = c;
  }
  const pos = new Float32Array(sums.length * 3);
  const nor = new Float32Array(sums.length * 3);
  const uv = new Float32Array(sums.length * 2);
  sums.forEach((s, i) => {
    pos[i * 3] = s[0] / s[6];
    pos[i * 3 + 1] = s[1] / s[6];
    pos[i * 3 + 2] = s[2] / s[6];
    const l = Math.hypot(s[3], s[4], s[5]) || 1;
    nor[i * 3] = s[3] / l;
    nor[i * 3 + 1] = s[4] / l;
    nor[i * 3 + 2] = s[5] / l;
    const [a, b] = faceUv(pos[i * 3], pos[i * 3 + 1]);
    uv[i * 2] = a;
    uv[i * 2 + 1] = b;
  });
  const out: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const a = remap[index[t]];
    const b = remap[index[t + 1]];
    const c = remap[index[t + 2]];
    if (a !== b && b !== c && a !== c) out.push(a, b, c);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(out);
  return g;
}

/** Skin grown old: its color and what it looks like up close, painted once on two canvases laid straight on the face. */
function paintSkin(folds: readonly Fold[]): { color: CanvasTexture; relief: CanvasTexture } {
  const S = 2048;
  const make = (fill: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, S, S);
    return { canvas, ctx };
  };
  const color = make('#c6baac');
  const relief = make('#808080');
  const random = randomFrom(61);
  const X = (x: number) => (x + 0.5) * S;
  const Y = (y: number) => (1 - y) * S;
  const c = color.ctx;
  const h = relief.ctx;

  // blotches: years of it
  const blot = (x: number, y: number, r: number, fill: string) => {
    const g = c.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), r * S);
    g.addColorStop(0, fill);
    g.addColorStop(1, fill.replace(/[\d.]+\)$/, '0)'));
    c.fillStyle = g;
    c.fillRect(X(x) - r * S, Y(y) - r * S, r * S * 2, r * S * 2);
  };
  for (let i = 0; i < 300; i++) {
    const tone = random();
    const fill = tone < 0.35 ? `rgba(140,122,105,${0.03 + random() * 0.07})` : tone < 0.62 ? `rgba(120,128,134,${0.04 + random() * 0.08})` : tone < 0.78 ? `rgba(150,118,112,${0.02 + random() * 0.05})` : `rgba(218,212,198,${0.05 + random() * 0.09})`;
    blot(random() - 0.5, random(), 0.015 + random() * 0.08, fill);
  }
  // a little blood left, at the cheeks and the nose, and the ears
  for (const [x, y, r] of [[-0.14, 0.36, 0.09], [0.17, 0.36, 0.09], [0.03, 0.39, 0.05], [-0.26, 0.47, 0.05], [0.28, 0.47, 0.05], [0.0, 0.17, 0.08]] as const) blot(x, y, r, 'rgba(176,112,102,0.2)');
  // age spots
  for (let i = 0; i < 130; i++) {
    const x = (random() - 0.5) * 0.6;
    const y = 0.12 + random() * 0.72;
    const r = 0.001 + random() ** 4 * 0.006;
    c.fillStyle = `rgba(${96 + random() * 18},${84 + random() * 16},${70 + random() * 14},${0.12 + random() * 0.26})`;
    c.beginPath();
    c.ellipse(X(x), Y(y), r * S, r * S * (0.6 + random() * 0.5), random() * 3, 0, Math.PI * 2);
    c.fill();
  }
  // broken veins on the nose and cheeks
  c.lineCap = 'round';
  for (let i = 0; i < 110; i++) {
    let x = 0.03 + (random() - 0.5) * 0.34;
    let y = 0.33 + random() * 0.14;
    c.strokeStyle = `rgba(${96 + random() * 40},${52 + random() * 18},${70 + random() * 26},${0.05 + random() * 0.11})`;
    c.lineWidth = 0.6 + random() * 1.5;
    c.beginPath();
    c.moveTo(X(x), Y(y));
    for (let k = 0; k < 7; k++) {
      x += (random() - 0.5) * 0.012;
      y += (random() - 0.5) * 0.009;
      c.lineTo(X(x), Y(y));
    }
    c.stroke();
  }
  // what the light does not reach, painted in: the thin skin of the lids, nostrils, the lips, under the chin
  for (const ex of [EYE.x, OTHER_EYE_X]) {
    blot(ex, 0.528, 0.085, 'rgba(92,82,92,0.22)');
    blot(ex, 0.553, 0.05, 'rgba(70,62,72,0.22)');
  }
  blot(MOUTH.x, MOUTH.y, 0.1, 'rgba(90,76,78,0.2)');
  for (const nx of [-0.012, 0.078]) blot(nx, 0.352, 0.022, 'rgba(14,9,9,0.9)');
  blot(MOUTH.x, 0.05, 0.2, 'rgba(30,26,28,0.7)');

  // a crease: dark in both maps, with a raised lip on one side in the relief
  const crease = (points: readonly (readonly [number, number])[], width: number, depth: number, jitter = 0.002) => {
    const path = new Path2D();
    const lit = new Path2D();
    points.forEach(([x, y], i) => {
      const jx = (random() - 0.5) * jitter;
      const jy = (random() - 0.5) * jitter;
      if (i === 0) {
        path.moveTo(X(x + jx), Y(y + jy));
        lit.moveTo(X(x + jx), Y(y + jy) - width * 1.2);
      } else {
        path.lineTo(X(x + jx), Y(y + jy));
        lit.lineTo(X(x + jx), Y(y + jy) - width * 1.2);
      }
    });
    c.lineJoin = h.lineJoin = 'round';
    c.lineCap = h.lineCap = 'round';
    h.strokeStyle = `rgba(255,255,255,${0.16 * depth})`;
    h.lineWidth = width * 2.4;
    h.stroke(lit);
    for (const [k, a] of [[3.2, 0.12], [1.8, 0.28], [0.8, 0.7]] as const) {
      h.strokeStyle = `rgba(0,0,0,${a * depth})`;
      h.lineWidth = width * k;
      h.stroke(path);
      c.strokeStyle = `rgba(62,52,50,${a * depth * 0.3})`;
      c.lineWidth = width * k;
      c.stroke(path);
    }
  };
  const arc = (x0: number, y0: number, x1: number, y1: number, bow: number, n = 9) => {
    const out: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const b = Math.sin(t * Math.PI) * bow;
      out.push([x0 + (x1 - x0) * t + (random() - 0.5) * 0.003, y0 + (y1 - y0) * t + b + (random() - 0.5) * 0.003]);
    }
    return out;
  };
  for (const f of folds) crease(f.points, f.width * S * 0.5, Math.min(1, f.depth * 240), 0);
  // finer lines, in the paint only
  for (let i = 0; i < 70; i++) {
    const y = 0.6 + random() * 0.17;
    const x = -0.2 + random() * 0.42;
    const to = x + 0.02 + random() * 0.07;
    crease(arc(x, y, to, y + (random() - 0.5) * 0.008, (random() - 0.5) * 0.006, 5), 1 + random() * 1.1, 0.24);
  }
  for (const [side, ex] of [[1, EYE.x], [-1, OTHER_EYE_X]] as const) {
    // the slit of the closed eye
    const slit: [number, number][] = [];
    for (let i = 0; i <= 14; i++) {
      const x = ex + (i / 7 - 1) * EYE.halfWidth;
      slit.push([x, slitY(x, ex)]);
    }
    crease(slit, 2.6, 1, 0.0002);
    // crepe on the lids
    for (let i = 0; i < 60; i++) {
      const x = ex + (random() - 0.5) * 0.11;
      const y = EYE.y + (random() - 0.5) * 0.06;
      crease(arc(x, y, x + (random() - 0.5) * 0.024, y + (random() - 0.5) * 0.008, 0, 3), 0.9 + random() * 0.6, 0.24);
    }
    // cheeks gone to paper
    for (let i = 0; i < 46; i++) {
      const x = ex + side * (0.02 + random() * 0.09);
      const y = 0.2 + random() * 0.22;
      crease(arc(x, y, x + side * (0.01 + random() * 0.03), y - 0.01 - random() * 0.03, (random() - 0.5) * 0.008, 4), 1 + random(), 0.26);
    }
    // the vein on the temple
    let vx = ex + side * 0.1;
    let vy = 0.6;
    const vein: [number, number][] = [];
    for (let i = 0; i < 9; i++) {
      vein.push([vx, vy]);
      vx += side * 0.006 * random() + (random() - 0.5) * 0.008;
      vy += 0.015 + random() * 0.006;
    }
    h.strokeStyle = 'rgba(255,255,255,0.3)';
    h.lineWidth = 7;
    h.beginPath();
    vein.forEach(([x, y], i) => (i ? h.lineTo(X(x), Y(y)) : h.moveTo(X(x), Y(y))));
    h.stroke();
  }
  // thin lines all round the mouth
  for (let i = 0; i < 46; i++) {
    const a = (i / 45 - 0.5) * 2;
    const x = MOUTH.x + a * MOUTH.halfWidth * 0.95;
    const top = random() < 0.5;
    const y0 = MOUTH.y + (top ? 0.012 : -0.022);
    const y1 = y0 + (top ? 1 : -1) * (0.016 + random() * 0.03);
    crease(arc(x, y0, x + a * 0.006, y1, 0, 3), 1.3 + random(), 0.42);
  }
  // the lips themselves: bled out
  c.fillStyle = 'rgba(96,82,88,0.3)';
  c.beginPath();
  c.ellipse(X(MOUTH.x), Y(MOUTH.y - 0.014), MOUTH.halfWidth * S, 0.022 * S, 0, 0, Math.PI * 2);
  c.ellipse(X(MOUTH.x), Y(MOUTH.y + 0.012), MOUTH.halfWidth * S * 0.96, 0.016 * S, 0, 0, Math.PI * 2);
  c.fill();
  // eyebrows: white, thin, wild
  for (const [side, ex] of [[1, EYE.x], [-1, OTHER_EYE_X]] as const) {
    for (let i = 0; i < 260; i++) {
      const a = random();
      const x = ex - side * 0.072 + side * a * 0.16;
      const y = 0.58 + Math.sin(a * Math.PI) * 0.02 - a * 0.012 + (random() - 0.5) * 0.018;
      const len = 0.006 + random() * 0.016;
      const dir = (side > 0 ? 0.4 + a * 0.6 : Math.PI - 0.4 - a * 0.6) + (random() - 0.5) * 0.9;
      c.strokeStyle = `rgba(${206 + random() * 40},${204 + random() * 40},${198 + random() * 40},${0.18 + random() * 0.4})`;
      c.lineWidth = 0.8 + random() * 1.2;
      c.beginPath();
      c.moveTo(X(x), Y(y));
      c.lineTo(X(x + Math.cos(dir) * len), Y(y + Math.sin(dir) * len));
      c.stroke();
    }
  }
  // the scalp: white stubble running back from the hairline, thick enough to hide the skin from afar
  for (let i = 0; i < 26000; i++) {
    const x = (random() - 0.5) * 0.96;
    const y = 0.6 + random() * 0.42;
    const line = 0.8 - 0.13 * (Math.abs(x - 0.02) / 0.3) ** 2;
    if (y < line + (random() - 0.5) * 0.04) continue;
    const dir = Math.PI / 2 + (x - 0.02) * -1.6 + (random() - 0.5) * 0.5;
    const len = 0.012 + random() * 0.03;
    const v = random() < 0.2 ? 90 + random() * 40 : 195 + random() * 60;
    c.strokeStyle = `rgba(${v},${v * 0.98},${v * 0.94},${0.35 + random() * 0.5})`;
    c.lineWidth = 1 + random() * 2.2;
    c.beginPath();
    c.moveTo(X(x), Y(y));
    c.lineTo(X(x + Math.cos(dir) * len), Y(y + Math.sin(dir) * len));
    c.stroke();
    if (i % 3 === 0) {
      h.strokeStyle = `rgba(${random() < 0.5 ? '255,255,255' : '0,0,0'},0.25)`;
      h.lineWidth = 1 + random() * 2;
      h.beginPath();
      h.moveTo(X(x), Y(y));
      h.lineTo(X(x + Math.cos(dir) * len), Y(y + Math.sin(dir) * len));
      h.stroke();
    }
  }
  // pores
  for (let i = 0; i < 70000; i++) {
    const x = random() * S;
    const y = random() * S;
    const v = random() < 0.65;
    h.fillStyle = v ? `rgba(0,0,0,${0.05 + random() * 0.16})` : `rgba(255,255,255,${0.03 + random() * 0.07})`;
    h.fillRect(x, y, 1 + random() * 1.6, 1 + random() * 1.6);
  }
  const texture = (canvas: HTMLCanvasElement, srgb: boolean) => {
    const t = new CanvasTexture(canvas);
    if (srgb) t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { color: texture(color.canvas, true), relief: texture(relief.canvas, false) };
}

/** An old eye: yellowed white, red threads, a pale iris with the ring of age; the pupil is drawn in the shader. */
function paintEye(): CanvasTexture {
  const S = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const c = canvas.getContext('2d')!;
  const random = randomFrom(29);
  const mid = S / 2;
  const g = c.createRadialGradient(mid, mid, S * 0.2, mid, mid, S * 0.5);
  g.addColorStop(0, '#d9d4c6');
  g.addColorStop(0.5, '#c9bda4');
  g.addColorStop(1, '#8c6d5c');
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  // veins creep in from the rim
  c.lineCap = 'round';
  for (let i = 0; i < 130; i++) {
    const a = random() * Math.PI * 2;
    let r = S * (0.5 - random() * 0.05);
    let x = mid + Math.cos(a) * r;
    let y = mid + Math.sin(a) * r;
    let dir = a + Math.PI + (random() - 0.5) * 0.8;
    const steps = 8 + Math.floor(random() * 18);
    c.beginPath();
    c.moveTo(x, y);
    for (let k = 0; k < steps; k++) {
      dir += (random() - 0.5) * 0.7;
      x += Math.cos(dir) * 9;
      y += Math.sin(dir) * 9;
      c.lineTo(x, y);
      r = Math.hypot(x - mid, y - mid);
      if (r < S * 0.26) break;
    }
    c.strokeStyle = `rgba(${130 + random() * 50},${30 + random() * 25},${30 + random() * 25},${0.18 + random() * 0.4})`;
    c.lineWidth = 0.7 + random() * 2.2;
    c.stroke();
  }
  // the iris
  const iris = S * 0.25;
  const ig = c.createRadialGradient(mid, mid, iris * 0.1, mid, mid, iris);
  ig.addColorStop(0, '#4c4a3e');
  ig.addColorStop(0.3, '#6a6c60');
  ig.addColorStop(0.68, '#5c6862');
  ig.addColorStop(0.88, '#39423f');
  ig.addColorStop(1, '#1e2424');
  c.fillStyle = ig;
  c.beginPath();
  c.arc(mid, mid, iris, 0, Math.PI * 2);
  c.fill();
  // its fibres, running out from the middle, and the pits between them
  for (let i = 0; i < 2600; i++) {
    const a = random() * Math.PI * 2;
    const r0 = iris * (0.14 + random() * 0.6);
    const r1 = r0 + iris * (0.04 + random() * 0.28);
    const pale = random() < 0.5;
    c.strokeStyle = pale ? `rgba(${170 + random() * 50},${172 + random() * 44},${150 + random() * 44},${0.04 + random() * 0.17})` : `rgba(8,10,10,${0.08 + random() * 0.24})`;
    c.lineWidth = 0.5 + random() * 1.5;
    c.beginPath();
    c.moveTo(mid + Math.cos(a) * r0, mid + Math.sin(a) * r0);
    const bend = a + (random() - 0.5) * 0.07;
    c.lineTo(mid + Math.cos(bend) * Math.min(r1, iris), mid + Math.sin(bend) * Math.min(r1, iris));
    c.stroke();
  }
  for (let i = 0; i < 46; i++) {
    const a = random() * Math.PI * 2;
    const r0 = iris * (0.34 + random() * 0.42);
    c.fillStyle = `rgba(6,8,8,${0.18 + random() * 0.3})`;
    c.beginPath();
    c.ellipse(mid + Math.cos(a) * r0, mid + Math.sin(a) * r0, 2 + random() * 7, 1.5 + random() * 3, a, 0, Math.PI * 2);
    c.fill();
  }
  // brown flecks of age
  for (let i = 0; i < 18; i++) {
    const a = random() * Math.PI * 2;
    const r0 = iris * (0.3 + random() * 0.6);
    c.fillStyle = `rgba(92,66,36,${0.2 + random() * 0.35})`;
    c.beginPath();
    c.arc(mid + Math.cos(a) * r0, mid + Math.sin(a) * r0, 1.5 + random() * 5, 0, Math.PI * 2);
    c.fill();
  }
  // the ring of age: pale, milky, just inside the rim
  const ring = c.createRadialGradient(mid, mid, iris * 0.8, mid, mid, iris * 1.02);
  ring.addColorStop(0, 'rgba(210,214,208,0)');
  ring.addColorStop(0.72, 'rgba(212,216,210,0.55)');
  ring.addColorStop(1, 'rgba(190,194,186,0)');
  c.fillStyle = ring;
  c.beginPath();
  c.arc(mid, mid, iris * 1.02, 0, Math.PI * 2);
  c.fill();
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const v1 = new Vector3();
const v2 = new Vector3();
const emitAt = new Vector3();
const scratchColor = new Color();
const gaze = new Vector3();
const rolled = new Vector3(0, 0.96, 0.28).normalize();
const FORWARD = new Vector3(0, 0, 1);

/**
 * Open water, very deep, and you are sinking. The light goes. Pale weed, and then it is hair. Far below there is a
 * slope, and at the worst moment the flash fires by itself and shows you whose. Everything here is a pure function of
 * the room's time, except your breath.
 */
export default class Deep extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x020810, density: FOG.dark },
    env: 'evening',
    envIntensity: 0,
    sky: 0,
    grade: { exposure: 1, saturation: 0.98, warmth: -0.01, tint: -0.01, flare: 0.0004 },
  };
  film = { bloom: 0.9, bloomFrom: 0.9, bloomTint: [0.8, 0.95, 1] as const, grain: 0.26, weave: 0.0003, ghost: 0 };
  control = { look: true, scroll: true, press: false };
  fear = 0.2;
  focus = 12;
  aperture = 0;

  private readonly shark: Object3D;
  private readonly swim: AnimationMixer;
  private readonly ovalDir: Vector3;
  private readonly ovalU: Vector3;
  private readonly head = new Group();
  private readonly headInverse = new Matrix4();
  private readonly water: ShaderMaterial;
  private readonly snow: ShaderMaterial;
  private readonly bubbleMaterial: ShaderMaterial;
  private readonly bubbleAttr: InstancedBufferAttribute;
  private readonly bubbleWobble: Float32Array;
  private readonly bubbleVelocity: Float32Array;
  private readonly farMaterial: ShaderMaterial;
  private readonly hairMaterial: ShaderMaterial;
  private readonly hills = new Group();
  private readonly flashSpot;
  private readonly eyeLight;
  private readonly ball: Mesh;
  private readonly lowerTeeth = new Object3D();
  private readonly random = randomFrom(913);
  private readonly shape = {
    uJaw: { value: MOUTH.half },
    uLid: { value: 0 },
    uPress: { value: new Vector3() },
    uTopLight: { value: new Color() },
    uFine: { value: 0 },
    uShadowFill: { value: new Color() },
  };
  private readonly eyeShape = { uPupil: { value: 0.3 }, uCatch: { value: 0 }, uOvalWorld: { value: new Vector3() }, uHeadInverse: { value: this.headInverse } };
  private readonly headTurnBack = new Quaternion();
  private readonly lastEye = new Vector3();
  private readonly velocity = new Vector3();
  private bubbleNext = 0;
  private bubbleDebt = 0;
  private lastSeconds = 0;
  private holding = false;
  private heldFor = 0;
  private forcedOut = false;
  private everHeld = false;
  private promptUp = false;
  /** Asked for the picture this very frame. */
  private flashed = false;
  private readonly beds = new Map<string, { voice: RoomVoice; gain: number }>();
  private heart: RoomVoice | null = null;
  private heartFast: RoomVoice | null = null;
  private groan: RoomVoice | null = null;

  constructor(ctx: RoomContext) {
    super(ctx);

    // the water itself
    const a = OVAL.offZenith * DEG;
    const h = OVAL.heading * DEG;
    const ovalDir = new Vector3(-Math.sin(h) * Math.sin(a), Math.cos(a), -Math.cos(h) * Math.sin(a)).normalize();
    const ovalU = new Vector3(Math.cos(h), 0, -Math.sin(h)).normalize();
    this.ovalDir = ovalDir;
    this.ovalU = ovalU;
    const ovalV = new Vector3().crossVectors(ovalU, ovalDir).normalize();
    this.eyeShape.uOvalWorld.value.copy(ovalDir);
    this.water = new ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      side: BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: WATER_TOP },
        uLevel: { value: WATER_LEVEL },
        uDeep: { value: WATER_DEEP },
        uLight: { value: 1 },
        uTime: { value: 0 },
        uOvalDir: { value: ovalDir },
        uOvalU: { value: ovalU },
        uOvalV: { value: ovalV },
        uOvalRadius: { value: OVAL.radius },
        uOvalSquash: { value: OVAL.squash },
        uFlash: { value: 0 },
      },
    });
    const dome = new Mesh(new SphereGeometry(1, 32, 24), this.water);
    dome.frustumCulled = false;
    // after everything solid: it only fills what nothing else covered
    dome.renderOrder = 3;
    this.root.add(dome);

    // what crosses the oval: nothing of it but its outline
    const sharkModel = this.kit.model('shark');
    this.shark = cloneRigged(sharkModel.scene);
    this.shark.scale.setScalar(SHARK.scale);
    this.shark.traverse((o) => {
      if ((o as Mesh).isMesh) o.frustumCulled = false;
    });
    this.kit.paint(this.shark, new MeshBasicMaterial({ color: 0x010408, fog: false }));
    const bank = SHARK.bank * DEG;
    v1.copy(ovalU).negate();
    v2.copy(ovalDir).multiplyScalar(Math.cos(bank)).addScaledVector(ovalV, Math.sin(bank));
    this.shark.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(new Vector3().crossVectors(v2, v1), v2, v1));
    this.shark.visible = false;
    this.root.add(this.shark);
    this.swim = new AnimationMixer(this.shark);
    this.swim.clipAction(sharkModel.animations[0]).play();

    // marine snow, a near box and a far one
    const rnd = randomFrom(77);
    const quad = new PlaneGeometry(1, 1);
    const flake = new InstancedBufferGeometry();
    flake.setIndex(quad.getIndex());
    flake.setAttribute('position', quad.getAttribute('position'));
    const flakes = SNOW.near + SNOW.far;
    const seeds = new Float32Array(flakes * 4);
    const boxes = new Float32Array(flakes);
    for (let i = 0; i < flakes; i++) {
      for (let k = 0; k < 4; k++) seeds[i * 4 + k] = rnd();
      boxes[i] = i < SNOW.near ? SNOW.nearBox : SNOW.farBox;
    }
    flake.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
    flake.setAttribute('aBox', new InstancedBufferAttribute(boxes, 1));
    flake.instanceCount = flakes;
    this.snow = new ShaderMaterial({
      vertexShader: SNOW_VERT,
      fragmentShader: SNOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uEye: { value: new Vector3() },
        uTime: { value: 0 },
        uSize0: { value: SNOW.size[0] },
        uSize1: { value: SNOW.size[1] },
        uVelocity: { value: new Vector3() },
        uPixel: { value: 0.002 },
        uColor: { value: new Color() },
        uFlash: { value: 0 },
      },
    });
    const snowMesh = new Mesh(flake, this.snow);
    snowMesh.frustumCulled = false;
    snowMesh.renderOrder = 5;
    this.root.add(snowMesh);

    // your bubbles
    const bubble = new InstancedBufferGeometry();
    bubble.setIndex(quad.getIndex());
    bubble.setAttribute('position', quad.getAttribute('position'));
    this.bubbleAttr = new InstancedBufferAttribute(new Float32Array(BUBBLES.count * 4), 4);
    this.bubbleAttr.setUsage(DynamicDrawUsage);
    bubble.setAttribute('aBubble', this.bubbleAttr);
    this.bubbleWobble = new Float32Array(BUBBLES.count);
    for (let i = 0; i < BUBBLES.count; i++) this.bubbleWobble[i] = rnd();
    bubble.setAttribute('aWobble', new InstancedBufferAttribute(this.bubbleWobble, 1));
    bubble.instanceCount = BUBBLES.count;
    this.bubbleVelocity = new Float32Array(BUBBLES.count);
    this.bubbleMaterial = new ShaderMaterial({
      vertexShader: BUBBLE_VERT,
      fragmentShader: BUBBLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uLightColor: { value: new Color() } },
    });
    const bubbles = new Mesh(bubble, this.bubbleMaterial);
    bubbles.frustumCulled = false;
    bubbles.renderOrder = 6;
    this.root.add(bubbles);
    // your breath is already on its way up when the picture opens
    const heading = SINK[0].yaw * DEG;
    const bubbleData = this.bubbleAttr.array as Float32Array;
    for (let i = 0; i < BUBBLES.ready; i++) {
      const ahead = 1 + rnd() * 0.7;
      const aside = (rnd() - 0.5) * 0.7;
      bubbleData[i * 4] = SINK[0].x - Math.sin(heading) * ahead + Math.cos(heading) * aside;
      bubbleData[i * 4 + 1] = SINK[0].y - 0.3 + rnd() ** 2 * 15;
      bubbleData[i * 4 + 2] = SINK[0].z - Math.cos(heading) * ahead - Math.sin(heading) * aside;
      bubbleData[i * 4 + 3] = BUBBLES.size[0] + (BUBBLES.size[1] - BUBBLES.size[0]) * rnd() ** 3;
      this.bubbleVelocity[i] = BUBBLES.rise[0] + (BUBBLES.rise[1] - BUBBLES.rise[0]) * rnd();
    }
    this.bubbleNext = BUBBLES.ready;

    // the head: where it lies is told from where you will stand when the flash fires
    this.head.rotation.set(-HEAD_TILT * DEG, HEAD_TURN * DEG, HEAD_ROLL * DEG, 'YXZ');
    this.head.scale.setScalar(HEAD_HEIGHT);
    const down = FACE_DOWN * DEG;
    const faceAt = new Vector3(0, -Math.sin(down), -Math.cos(down)).multiplyScalar(FACE_DISTANCE).add(FLASH_EYE);
    this.head.position.copy(faceAt).sub(v1.copy(FACE_CENTER).multiplyScalar(HEAD_HEIGHT).applyQuaternion(this.head.quaternion));
    this.head.updateMatrix();
    this.root.add(this.head);
    this.root.updateMatrixWorld(true);
    this.headInverse.copy(this.head.matrixWorld).invert();
    this.headTurnBack.copy(this.head.quaternion).invert();

    // the eye's way
    const inRoom = (p: readonly [number, number, number]) => new Vector3(p[0], p[1], p[2]).applyMatrix4(this.head.matrix);
    const keys: RoomKey[] = SINK.map((k) => ({ t: k.s / this.seconds, at: [k.x, k.y, k.z], yaw: k.yaw, pitch: k.pitch, roll: 'roll' in k ? k.roll : 0, fov: k.fov }));
    for (const k of REDUCED_MOTION ? CLOSE_CALM : CLOSE) {
      const at = inRoom(k.at);
      const dir = inRoom(k.look).sub(at).normalize();
      const yaw = Math.atan2(-dir.x, -dir.z);
      const pitch = Math.asin(dir.y);
      // looking down at it, a turn of the head would roll the picture: the face is kept upright
      const right = v1.set(Math.cos(yaw), 0, -Math.sin(yaw));
      const up = v2.crossVectors(right, dir);
      const headUp = new Vector3(0, 1, 0).applyQuaternion(this.head.quaternion);
      const roll = -Math.atan2(headUp.dot(right), headUp.dot(up));
      keys.push({ t: k.s / this.seconds, at: [at.x, at.y, at.z], yaw: yaw / DEG, pitch: pitch / DEG, roll: roll / DEG, fov: k.fov });
    }
    this.keys = keys;

    const scan = this.kit.model('mri_head').scene;
    scan.updateMatrixWorld(true);
    let found: Mesh | null = null;
    scan.traverse((o) => {
      if ((o as Mesh).isMesh) found = o as Mesh;
    });
    const scanMesh = found as unknown as Mesh;
    const source = scanMesh.geometry.clone().applyMatrix4(scanMesh.matrixWorld);
    const count = source.getAttribute('position').count;
    const srcPos = new Float32Array(count * 3);
    const srcNor = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const p = source.getAttribute('position');
      const n = source.getAttribute('normal');
      srcPos[i * 3] = p.getX(i);
      srcPos[i * 3 + 1] = p.getY(i);
      srcPos[i * 3 + 2] = p.getZ(i);
      srcNor[i * 3] = n.getX(i);
      srcNor[i * 3 + 1] = n.getY(i);
      srcNor[i * 3 + 2] = n.getZ(i);
    }
    const srcIndex = outerSkin(srcPos, source.getIndex()!.array);

    const folds = foldsOfTheFace();
    const skin = paintSkin(folds);
    const material = new MeshStandardMaterial({ map: skin.color, bumpMap: skin.relief, bumpScale: 2.2, roughness: 0.56, metalness: 0, side: DoubleSide });
    const u = this.shape;
    const f3 = (v: number) => v.toFixed(4);
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uJaw = u.uJaw;
      shader.uniforms.uLid = u.uLid;
      shader.uniforms.uPress = u.uPress;
      shader.uniforms.uTopLight = u.uTopLight;
      shader.uniforms.uFine = u.uFine;
      shader.uniforms.uShadowFill = u.uShadowFill;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uJaw;
          uniform float uLid;
          uniform vec3 uPress;
          varying vec3 vHead;
          float jawWeight(vec3 p) {
            float a = abs(p.x - ${f3(MOUTH.x)}) / ${f3(MOUTH.halfWidth)};
            float outside = smoothstep(0.82, 1.3, a);
            float top = ${f3(MOUTH.y)} + mix(0.0035, 0.08, outside);
            float bottom = ${f3(MOUTH.y)} - mix(0.0035, 0.035, outside);
            float w = smoothstep(top, bottom, p.y);
            w *= smoothstep(-0.08, 0.12, p.z);
            w *= smoothstep(0.32, 0.2, abs(p.x));
            return w;
          }
          vec2 turnBy(vec2 yz, float angle) {
            float c = cos(angle);
            float s = sin(angle);
            return vec2(yz.x * c - yz.y * s, yz.x * s + yz.y * c);
          }
          float lidAngle(vec3 p) {
            float a = (p.x - ${f3(EYE.x)}) / ${f3(EYE.halfWidth)};
            if (abs(a) >= 1.0 || p.z < 0.1) return 0.0;
            float d = p.y - ${f3(EYE.y)} + 0.0065 * (1.0 - a * a) + 0.0028 * a;
            float shape = pow(1.0 - a * a, 0.7);
            float up = smoothstep(-0.0012, 0.0012, d);
            float upper = up * (1.0 - smoothstep(0.0, ${f3(LID.reachUp)}, d));
            float lower = (1.0 - up) * (1.0 - smoothstep(0.0, ${f3(LID.reachDown)}, -d));
            return uLid * shape * (${f3(LID.up)} * upper - ${f3(LID.down)} * lower);
          }`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
          float jawAngle = uJaw * jawWeight(position);
          objectNormal.yz = turnBy(objectNormal.yz, jawAngle);
          float lidTurn = lidAngle(position);
          objectNormal.yz = turnBy(objectNormal.yz, -lidTurn);
          vec2 pressAt = (position.xy - uPress.xy) / 0.017;
          float pressBy = uPress.z * exp(-dot(pressAt, pressAt));
          objectNormal.xy += pressAt * pressBy * 118.0;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vHead = position;
          vec2 hinge = vec2(${f3(MOUTH.hingeY)}, ${f3(MOUTH.hingeZ)});
          transformed.yz = hinge + turnBy(transformed.yz - hinge, jawAngle);
          vec2 ballAt = vec2(${f3(EYE.y)}, ${f3(EYE.z)});
          transformed.yz = ballAt + turnBy(transformed.yz - ballAt, -lidTurn);
          transformed.z += pressBy;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec3 uTopLight;
          uniform vec3 uShadowFill;
          uniform float uLid;
          uniform float uFine;
          varying vec3 vHead;
          float shutLine(vec3 p, float cx, float flip) {
            float a = (p.x - cx) * flip / ${f3(EYE.halfWidth)};
            if (abs(a) >= 1.0 || p.z < 0.1) return 1.0;
            float d = abs(p.y - ${f3(EYE.y)} + 0.0065 * (1.0 - a * a) + 0.0028 * a);
            return mix(0.22, 1.0, smoothstep(0.0006, 0.0036, d));
          }
          float skinNoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            vec2 k = vec2(127.1, 311.7);
            return mix(mix(fract(sin(dot(i, k)) * 43758.5453), fract(sin(dot(i + vec2(1.0, 0.0), k)) * 43758.5453), f.x), mix(fract(sin(dot(i + vec2(0.0, 1.0), k)) * 43758.5453), fract(sin(dot(i + vec2(1.0, 1.0), k)) * 43758.5453), f.x), f.y);
          }`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          // the lips part along their line
          float mouthA = (vHead.x - ${f3(MOUTH.x)}) / ${f3(MOUTH.halfWidth)};
          float mouthD = abs(vHead.y - ${f3(MOUTH.y)});
          if (vHead.z > 0.1 && abs(mouthA) < 1.0) {
            float lip = ${f3(MOUTH.band)} * sqrt(1.0 - mouthA * mouthA) + 0.0006;
            if (mouthD < lip) discard;
            diffuseColor.rgb *= mix(vec3(0.42, 0.26, 0.26), vec3(1.0), smoothstep(lip, lip + 0.012, mouthD));
          }
          // shut, each eye is a dark line and nothing more
          diffuseColor.rgb *= shutLine(vHead, ${f3(EYE.x)}, 1.0) * shutLine(vHead, ${f3(OTHER_EYE_X)}, -1.0);
          // and so do the lids, when they do
          float lidA = (vHead.x - ${f3(EYE.x)}) / ${f3(EYE.halfWidth)};
          if (uLid > 0.0005 && vHead.z > 0.1 && abs(lidA) < 1.0) {
            float lidD = abs(vHead.y - ${f3(EYE.y)} + 0.0065 * (1.0 - lidA * lidA) + 0.0028 * lidA);
            float lidBand = ${f3(LID.band)} * smoothstep(0.0, 0.06, uLid) * sqrt(1.0 - lidA * lidA) + 0.0002;
            if (lidD < lidBand) discard;
            diffuseColor.rgb *= mix(vec3(0.46, 0.27, 0.26), vec3(1.0), smoothstep(lidBand, lidBand + 0.008, lidD) * 0.75 + 0.25 * (1.0 - smoothstep(0.0, 0.1, uLid)));
          }
          // inside a head there is no light to speak of
          if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.028, 0.006, 0.008);
          // the neck goes into the dark: below a certain height the plain is black
          diffuseColor.rgb *= smoothstep(0.02, 0.3, vHead.y * 0.47 + vHead.z * 0.88);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          if (uFine > 0.0) {
            float fine = skinNoise(vHead.xy * 560.0) * 0.6 + skinNoise(vHead.xy * 1400.0) * 0.4;
            normal = perturbNormalArb(-vViewPosition, normal, vec2(dFdx(fine), dFdy(fine)) * uFine, faceDirection);
          }`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          // the last of the surface's light, on what faces up and stands highest
          float topUp = max(dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)), 0.0);
          float topFacing = max(dot(normal, normalize(vViewPosition)), 0.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * uTopLight * topUp * topFacing * smoothstep(0.6, 0.68, vHead.y) * exp(-length(vViewPosition) * 0.04);
          // the water has its own color: in the flash the shadows fill with it
          reflectedLight.indirectDiffuse += diffuseColor.rgb * uShadowFill;`,
        );
    };
    material.customProgramCacheKey = () => 'deep-head';
    const shell = curvedHead(srcPos, srcNor, srcIndex, folds);
    const surfaceZ = shell.surfaceZ;
    const hero = new Mesh(shell.geometry, material);
    hero.castShadow = true;
    hero.receiveShadow = true;
    hero.frustumCulled = false;
    this.head.add(hero);

    // the eye behind the lid
    const ballGeometry = new SphereGeometry(EYE.radius, 48, 32);
    const ballPos = ballGeometry.getAttribute('position');
    const ballUv = ballGeometry.getAttribute('uv');
    for (let i = 0; i < ballPos.count; i++) ballUv.setXY(i, 0.5 + ballPos.getX(i) / (2 * EYE.radius), 0.5 + ballPos.getY(i) / (2 * EYE.radius));
    const ballMaterial = new MeshStandardMaterial({ map: paintEye(), roughness: 0.14, metalness: 0 });
    const e = this.eyeShape;
    ballMaterial.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uPupil = e.uPupil;
      shader.uniforms.uCatch = e.uCatch;
      shader.uniforms.uOvalWorld = e.uOvalWorld;
      shader.uniforms.uHeadInverse = e.uHeadInverse;
      shader.uniforms.uLid = u.uLid;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 uHeadInverse;\nvarying vec3 vInHead;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInHead = (uHeadInverse * modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uPupil;
          uniform float uCatch;
          uniform float uLid;
          uniform vec3 uOvalWorld;
          varying vec3 vInHead;`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          // only what the lids let out
          float a = (vInHead.x - ${f3(EYE.x)}) / ${f3(EYE.halfWidth)};
          if (abs(a) > 1.06) discard;
          float slit = ${f3(EYE.y)} - 0.0065 * (1.0 - a * a) - 0.0028 * a;
          float shape = pow(max(0.0, 1.0 - a * a), 0.7);
          float upper = slit + sin(uLid * ${f3(LID.up)}) * ${f3(EYE.radius)} * shape;
          float lower = slit - sin(uLid * ${f3(LID.down)}) * ${f3(EYE.radius)} * shape;
          if (vInHead.y > upper + 0.02 || vInHead.y < lower - 0.02) discard;
          // the lids throw their shadow on it
          diffuseColor.rgb *= smoothstep(0.0, 0.018, upper - vInHead.y) * 0.9 + 0.1;
          diffuseColor.rgb *= smoothstep(0.0, 0.008, vInHead.y - lower) * 0.7 + 0.3;
          // the pupil
          float irisR = length(vMapUv - 0.5) * 2.0;
          diffuseColor.rgb *= smoothstep(uPupil, uPupil + 0.012, irisR);`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          // up there the oval is still shining, and this is the only place you can see it now
          vec3 toEyeV = normalize(vViewPosition);
          vec3 mirrored = reflect(-toEyeV, normal);
          vec3 ovalV = normalize((viewMatrix * vec4(uOvalWorld, 0.0)).xyz);
          float catchAt = dot(mirrored, ovalV);
          reflectedLight.directSpecular += vec3(0.8, 0.95, 1.0) * uCatch * smoothstep(0.9935, 0.9975, catchAt);`,
        );
    };
    ballMaterial.customProgramCacheKey = () => 'deep-eye';
    this.ball = new Mesh(ballGeometry, ballMaterial);
    this.ball.position.set(EYE.x, EYE.y, EYE.z);
    this.ball.frustumCulled = false;
    this.ball.visible = false;
    this.head.add(this.ball);

    // teeth, in the half-open mouth
    const bone = new MeshStandardMaterial({ color: 0x8f877a, roughness: ENAMEL_ROUGH, vertexColors: true });
    const gum = new MeshStandardMaterial({ color: GUM_COLOR, roughness: GUM_WET, vertexColors: true });
    const upperTeeth = this.kit.prop('teeth_lower', [MOUTH.x, MOUTH.y + 0.03, 0.222], { scale: 0.062, anchor: 'center', castShadow: true }, this.head);
    this.kit.paint(upperTeeth, bone);
    this.kit.paint(upperTeeth.getObjectByName('Box030')!, gum);
    weatherTeeth(upperTeeth, 'Box030', 3);
    this.lowerTeeth.position.set(0, MOUTH.hingeY, MOUTH.hingeZ);
    this.head.add(this.lowerTeeth);
    const lowerTeeth = this.kit.prop('teeth_upper', [MOUTH.x, MOUTH.y - 0.042 - MOUTH.hingeY, 0.212 - MOUTH.hingeZ], { scale: 0.06, anchor: 'center', castShadow: true }, this.lowerTeeth);
    this.kit.paint(lowerTeeth, bone);
    this.kit.paint(lowerTeeth.getObjectByName('Box015')!, gum);
    weatherTeeth(lowerTeeth, 'Box015', 7);
    const tongueShape = new SphereGeometry(1, 28, 18);
    const tonguePos = tongueShape.getAttribute('position');
    for (let i = 0; i < tonguePos.count; i++) {
      // a groove down its middle, and it thickens toward the throat
      const x = tonguePos.getX(i);
      const y = tonguePos.getY(i);
      const z = tonguePos.getZ(i);
      tonguePos.setXYZ(i, x * (0.78 - z * 0.22), y - (y > 0 ? 0.3 * Math.exp(-((x / 0.3) ** 2)) : 0), z);
    }
    tongueShape.computeVertexNormals();
    const tongue = new Mesh(tongueShape, new MeshStandardMaterial({ color: 0x38292a, roughness: 0.5 }));
    tongue.scale.set(0.09, 0.03, 0.13);
    tongue.position.set(MOUTH.x, MOUTH.y - 0.082 - MOUTH.hingeY, 0.165 - MOUTH.hingeZ);
    tongue.frustumCulled = false;
    this.lowerTeeth.add(tongue);
    upperTeeth.traverse((o) => (o.frustumCulled = false));
    this.lowerTeeth.traverse((o) => (o.frustumCulled = false));

    // what lies around it, as far as the flash can reach and farther: hills of the same head
    this.farMaterial = new ShaderMaterial({
      vertexShader: FAR_VERT,
      fragmentShader: FAR_FRAG,
      uniforms: { tSkin: { value: skin.color }, uFlash: { value: 0 }, uHaze: { value: new Color(0.0005, 0.004, 0.0085) } },
    });
    this.root.add(this.hills);
    const rowFar: { root: number[]; top: number[]; move: number[]; look: number[]; kick: number[] } = { root: [], top: [], move: [], look: [], kick: [] };
    const scalp = this.scalpPicker(srcPos, srcIndex);
    const placeV = new Vector3();
    const matrix = new Matrix4();
    const scaleV = new Vector3();
    const instanceQ = new Quaternion();
    const instanceE = new Euler();
    const r = randomFrom(5);
    const near: number[][] = [];
    const far: number[][] = [];
    const reach = 205;
    // a plain of them in rows, turned a little off the way you look so that the rows run away to one side
    const plainY = this.head.position.y - 85;
    const cos = Math.cos(ROWS.turn * DEG);
    const sin = Math.sin(ROWS.turn * DEG);
    for (let row = -ROWS.back; row <= ROWS.ahead; row++) {
      const every = row > 7 ? 2 : 1;
      for (let col = -ROWS.side; col <= ROWS.side; col += every) {
        if (row === 0 && col === 0) continue;
        const gx = (col + (row % 2) * 0.5) * ROWS.step + (r() - 0.5) * ROWS.step * 0.3;
        const gz = -row * ROWS.step + (r() - 0.5) * ROWS.step * 0.3;
        const vx = this.head.position.x + gx * cos - gz * sin;
        const vz = this.head.position.z + gx * sin + gz * cos;
        const vy = plainY + (r() - 0.5) * 12;
        placeV.set(vx - FLASH_EYE.x, vy - FLASH_EYE.y, vz - FLASH_EYE.z);
        const virtual = placeV.length();
        // ahead of you they go on for a long way; around and behind you only as far as you could tell
        const ahead = -placeV.z / virtual;
        const limit = ahead > 0.3 ? 1250 : 330;
        if (virtual > limit || Math.hypot(placeV.x, placeV.z) < 46 || (placeV.y / virtual < -0.42 && virtual < 240)) continue;
        (virtual < 300 ? near : far).push([vx, vy, vz, virtual, r(), r(), r(), r()]);
      }
    }
    const rows = (geometry: BufferGeometry, list: number[][]) => {
      const mesh = new InstancedMesh(geometry, this.farMaterial, list.length);
      mesh.frustumCulled = false;
      const lit = new Float32Array(list.length * 2);
      list.forEach(([vx, vy, vz, virtual, r0, r1, r2, r3], n) => {
        placeV.set(vx - FLASH_EYE.x, vy - FLASH_EYE.y, vz - FLASH_EYE.z);
        const shrink = Math.min(1, reach / virtual);
        placeV.multiplyScalar(shrink).add(FLASH_EYE);
        const size = HEAD_HEIGHT * (0.86 + r0 * 0.28) * shrink;
        // they sleep with their faces up and a little your way, each a little differently; behind you, they face you too
        const facing = vz > FLASH_EYE.z ? Math.atan2(FLASH_EYE.x - vx, FLASH_EYE.z - vz) : Math.atan2(FLASH_EYE.x - vx, FLASH_EYE.z - vz) * 0.45;
        instanceE.set(-(ROWS.tilt + (r1 - 0.5) * 18) * DEG, facing + (r2 - 0.5) * 0.7, (r3 - 0.5) * 0.5, 'YXZ');
        instanceQ.setFromEuler(instanceE);
        matrix.compose(placeV, instanceQ, scaleV.setScalar(size));
        mesh.setMatrixAt(n, matrix);
        lit[n * 2] = 1 / (1 + (virtual / 430) ** 2);
        lit[n * 2 + 1] = 1 - Math.exp(-((virtual / 760) ** 2));
        // its own hair rises from it
        const tall = 130 * shrink;
        const strands = virtual < 500 ? HAIR.farStrands : Math.ceil(HAIR.farStrands / 2);
        for (let k2 = 0; k2 < strands; k2++) {
          const p = scalp(r).at.applyMatrix4(matrix);
          rowFar.root.push(p.x, p.y, p.z, r() * 6.28);
          rowFar.top.push((r() - 0.5) * 40 * shrink, tall * (0.7 + r() * 0.5), (r() - 0.5) * 40 * shrink, 0.03 * shrink);
          rowFar.move.push(r() * 6.28, 0, 0, 0);
          const realDist = p.distanceTo(FLASH_EYE);
          rowFar.look.push(1, lit[n * 2] * 1.5 * (1 + (realDist * realDist) / 3600), 0, 0);
          rowFar.kick.push(0, 0, 0);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      geometry.setAttribute('aLit', new InstancedBufferAttribute(lit, 2));
      this.hills.add(mesh);
    };
    rows(clusteredHead(srcPos, srcNor, srcIndex, 0.03), near);
    rows(clusteredHead(srcPos, srcNor, srcIndex, 0.1), far);

    // the hair: it is his, and you have been sinking through it
    this.hairMaterial = new ShaderMaterial({
      vertexShader: HAIR_VERT,
      fragmentShader: HAIR_FRAG,
      side: DoubleSide,
      transparent: true,
      uniforms: {
        uLight: { value: 1 },
        uFlash: { value: 0 },
        uFlashTop: { value: FLASH_EYE.y },
        uGlow: { value: 0 },
        uNear: { value: 0 },
        uHaze: { value: 1 },
        uTime: { value: 0 },
        uPixel: { value: 0.002 },
        uEye: { value: new Vector3() },
        uClear: { value: HAIR.clear },
        uLid: u.uLid,
        uBall: { value: new Vector3(EYE.x, EYE.y, EYE.z).applyMatrix4(this.head.matrix) },
        uBallAxis: { value: new Vector3(1, 0, 0).applyQuaternion(this.head.quaternion).normalize() },
        uPull: { value: 0 },
        uMouth: { value: new Vector3(MOUTH.x, MOUTH.y - 0.05, 0.33).applyMatrix4(this.head.matrix) },
      },
    });
    this.growHair(scalp, surfaceZ);
    this.hills.add(this.strands(8, rowFar));

    // the flash, from just above where you are
    this.flashSpot = this.spot([FLASH_EYE.x + 16, FLASH_EYE.y + 24, FLASH_EYE.z + 4], [faceAt.x, faceAt.y, faceAt.z], 0xf4f1ea, 0, 46, 0.4);
    this.spots = [this.flashSpot, null, null];
    // the low light from nowhere
    this.eyeLight = this.light([0, -100, -30], 0xc4d6da, 0, LOW_LIGHT.reach);

    this.scheduleSound();
  }

  /** Random places on the scalp, weighted by area, in the head's space. */
  private scalpPicker(position: Float32Array, index: ArrayLike<number>): (r: () => number) => { at: Vector3; normal: Vector3 } {
    const scalp: number[] = [];
    const weights: number[] = [];
    let total = 0;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const ab = new Vector3();
    const ac = new Vector3();
    for (let t = 0; t < index.length; t += 3) {
      a.fromArray(position, index[t] * 3);
      b.fromArray(position, index[t + 1] * 3);
      c.fromArray(position, index[t + 2] * 3);
      const cx = (a.x + b.x + c.x) / 3;
      const cy = (a.y + b.y + c.y) / 3;
      const cz = (a.z + b.z + c.z) / 3;
      const front = smootherstep((cz + 0.1) / 0.35);
      const line = 0.34 + (0.8 - 1.3 * (cx - 0.02) ** 2 - 0.34) * front;
      if (cy < line) continue;
      total += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length();
      scalp.push(t);
      weights.push(total);
    }
    return (r) => {
      const x = r() * total;
      let lo = 0;
      let hi = weights.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (weights[mid] < x) lo = mid + 1;
        else hi = mid;
      }
      const t = scalp[lo];
      a.fromArray(position, index[t] * 3);
      b.fromArray(position, index[t + 1] * 3);
      c.fromArray(position, index[t + 2] * 3);
      let u = r();
      let v = r();
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      return { at: new Vector3().copy(a).addScaledVector(ab, u).addScaledVector(ac, v), normal: new Vector3().crossVectors(ab, ac).normalize() };
    };
  }

  /** Long strands, each drawn as a ribbon that turns to face the eye, in one draw per kind. */
  private strands(segments: number, data: { root: number[]; top: number[]; move: number[]; look: number[]; kick: number[] }): Mesh {
    const geometry = new InstancedBufferGeometry();
    const position: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const s = i / segments;
      position.push(s, -1, 0, s, 1, 0);
      if (i < segments) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
    geometry.setIndex(index);
    geometry.setAttribute('aRoot', new InstancedBufferAttribute(new Float32Array(data.root), 4));
    geometry.setAttribute('aTop', new InstancedBufferAttribute(new Float32Array(data.top), 4));
    geometry.setAttribute('aMove', new InstancedBufferAttribute(new Float32Array(data.move), 4));
    geometry.setAttribute('aLook', new InstancedBufferAttribute(new Float32Array(data.look), 4));
    geometry.setAttribute('aKick', new InstancedBufferAttribute(new Float32Array(data.kick), 3));
    geometry.instanceCount = data.root.length / 4;
    const mesh = new Mesh(geometry, this.hairMaterial);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    this.root.add(mesh);
    return mesh;
  }

  /** Each lock is a rope and its fine hairs, fanning out from the crown as they rise. Lashes and brows are ropes too. */
  private growHair(scalp: (r: () => number) => { at: Vector3; normal: Vector3 }, surfaceZ: (x: number, y: number) => number): void {
    const r = randomFrom(404);
    const empty = () => ({ root: [] as number[], top: [] as number[], move: [] as number[], look: [] as number[], kick: [] as number[] });
    const ropes = empty();
    const fines = empty();
    const shorts = empty();
    const crown = new Vector3(0.02, 0.72, -0.1).applyMatrix4(this.head.matrix);
    const add = (into: typeof ropes, rx: number, ry: number, rz: number, topX: number, topY: number, topZ: number, width: number, lock: number, lid: number, kickBy: number, bright: number, fog: number, pull: number, kick: Vector3) => {
      into.root.push(rx, ry, rz, r() * 6.28);
      into.top.push(topX, topY, topZ, width);
      into.move.push(lock, lid, kickBy, kickBy === 0 ? 1 : 0);
      into.look.push(bright, 1, fog, pull);
      into.kick.push(kick.x, kick.y, kick.z);
    };
    const FOG_ROPE = 0.00022;
    const KICK = 6;
    for (let i = 0; i < HAIR.locks + HAIR.closeLocks; i++) {
      // more of them where they show: toward the front of the scalp
      let picked = scalp(r);
      for (let tries = 0; tries < 3 && picked.at.z < 0.02 && r() < 0.75; tries++) picked = scalp(r);
      const { at, normal } = picked;
      at.applyMatrix4(this.head.matrix);
      normal.applyQuaternion(this.head.quaternion);
      // few reach far up, so that it begins as a stray thread or two and thickens as you go down
      let tipY = HAIR.tipY[0] + (HAIR.tipY[1] - HAIR.tipY[0]) * r() ** 1.5;
      // fanning out from the crown: neighbours stay neighbours, so that it flows and does not cross
      let tipX = HAIR.center[0] + (at.x - crown.x) * HAIR.fan + (r() - 0.5) * 7;
      let tipZ = HAIR.center[1] + (at.z - crown.z) * HAIR.fan + (r() - 0.5) * 7;
      if (i >= HAIR.locks) {
        // and some go by close, where you sink: through a place near your way at a height you will pass
        const y = -17 - r() * 66;
        const angle = r() * Math.PI * 2;
        const away = HAIR.closeFrom + r() * r() * 7;
        tipY = Math.min(y + 5 + r() * 16, HAIR.tipY[1]);
        const share = Math.pow((y - at.y) / (tipY - at.y), HAIR.opensLate);
        tipX = at.x + (Math.cos(angle) * away - at.x) / share;
        tipZ = at.z + (HAIR.center[1] + 13 + Math.sin(angle) * away - at.z) / share;
      }
      const lock = (at.x * 0.09 + at.z * 0.07) % 6.28;
      add(ropes, at.x, at.y, at.z, tipX - at.x, tipY - at.y, tipZ - at.z, HAIR.ropeWidth[0] + (HAIR.ropeWidth[1] - HAIR.ropeWidth[0]) * r(), lock, 0, KICK, 0.55 + r() * 0.45, FOG_ROPE, 1, normal);
      for (let k = 0; k < HAIR.finePerLock; k++) {
        const near = 0.5 + r() * 2.2;
        const far = 0.8 + r() * 3.2;
        add(fines, at.x + (r() - 0.5) * near, at.y + (r() - 0.5) * near * 0.5, at.z + (r() - 0.5) * near, tipX - at.x + (r() - 0.5) * far, tipY - at.y - r() * 12, tipZ - at.z + (r() - 0.5) * far, HAIR.fineWidth[0] + (HAIR.fineWidth[1] - HAIR.fineWidth[0]) * r(), lock + (r() - 0.5) * 0.4, 0, KICK, 0.3 + r() * r() * 0.7, FOG_ROPE * 1.4, 1, normal);
      }
    }
    // the lashes of the eye that will open: on the lid's edge, floating up, turning with it
    const up = new Vector3();
    const none = new Vector3();
    const lashOut = new Vector3();
    for (let i = 0; i < LASHES.count; i++) {
      const upper = i % 5 !== 4;
      // in clumps, as they are
      const a = clamp(Math.round((r() * 2 - 1) * 9) / 9 + (r() - 0.5) * 0.09, -1, 1);
      const x = EYE.x + a * EYE.halfWidth * 0.97;
      const y = slitY(x, EYE.x) + (upper ? 0.0015 : -0.0015);
      const z = surfaceZ(x, y) + 0.001;
      up.set(x, y, z).applyMatrix4(this.head.matrix);
      const shape = Math.pow(Math.max(0, 1 - a * a), 0.7);
      const len = (LASHES.length[0] + (LASHES.length[1] - LASHES.length[0]) * r()) * (upper ? 1 : 0.4);
      // the lid's way up, away from the eye
      lashOut.set(a * 0.9 + (r() - 0.5) * 0.35, upper ? 0.9 : -0.5, 0.25).applyQuaternion(this.head.quaternion).multiplyScalar(len * 0.8);
      add(shorts, up.x, up.y, up.z, lashOut.x, len * 0.45 + lashOut.y, lashOut.z, LASHES.width * (0.6 + r() * 0.7), r() * 6.28, (upper ? -LID.up : LID.down) * shape, 0, 1, 0, 0, none);
    }
    // brows, thin and wild, floating up off the bone
    for (let i = 0; i < BROWS.count; i++) {
      const left = i % 2 === 0;
      const ex = left ? OTHER_EYE_X : EYE.x;
      const side = left ? -1 : 1;
      const a = r();
      const x = ex - side * 0.072 + side * a * 0.16;
      const y = 0.58 + Math.sin(a * Math.PI) * 0.02 - a * 0.012 + (r() - 0.5) * 0.016;
      up.set(x, y, surfaceZ(x, y) + 0.001).applyMatrix4(this.head.matrix);
      const len = BROWS.length[0] + (BROWS.length[1] - BROWS.length[0]) * r();
      add(shorts, up.x, up.y, up.z, (r() - 0.5) * 2, len, (r() - 0.5) * 2, BROWS.width * (0.6 + r() * 0.8), r() * 6.28, 0, 0, 0.8, 0, 0, none);
    }
    this.strands(90, ropes);
    this.strands(56, fines);
    this.strands(6, shorts);
  }

  /** A bed joins; what the breath silences is kept here with the gain it should have. */
  private bedUp(file: string, gain: number, options: { lowpass?: number; fade?: number; pan?: number; rate?: number } = {}): void {
    const voice = this.sound.bed(file, { ...options, gain: this.holding ? 0 : gain });
    this.beds.set(file, { voice, gain });
  }

  private bedTo(file: string, gain: number, seconds: number): void {
    const bed = this.beds.get(file);
    if (!bed) return;
    bed.gain = gain;
    if (!this.holding) bed.voice.gain(gain, seconds);
  }

  /** A sound of the deep: while the viewer holds their breath it is not heard. */
  private far(file: string, gain: number, pan: number, reverb: number, rate = 1): void {
    if (!this.holding) this.sound.play(file, { gain, pan, reverb, rate, lowpass: 1800 });
  }

  /** A breath out and its bubbles, by the sound of it. */
  private breatheOut(file: string, gain: number): void {
    if (!this.holding) this.sound.play(file, { gain, lowpass: 2600 });
  }

  private scheduleSound(): void {
    this.beat(0, () => {
      this.bedUp('rooms/underwater_muffled.mp3', 0.14, { fade: 1.5 });
      this.bedUp('rooms/dream_drone_low.mp3', 0.08, { fade: 4 });
      this.bedUp('rooms/bubbles_rising.mp3', 0.09, { lowpass: 3500, fade: 2 });
      this.heart = this.sound.bed('rooms/heart_slow.mp3', { gain: 0, lowpass: 800 });
    });
    this.beat(EXHALES[0][0], () => this.breatheOut('rooms/bubbles_exhale_1.mp3', 0.35));
    this.beat(EXHALES[1][0], () => this.breatheOut('rooms/bubbles_exhale_2.mp3', 0.35));
    this.beat(EXHALES[2][0], () => this.breatheOut('rooms/bubbles_exhale_1.mp3', 0.3));
    this.beat(EXHALES[3][0], () => this.breatheOut('rooms/bubbles_exhale_2.mp3', 0.26));
    this.beat(EXHALES[4][0], () => this.breatheOut('rooms/bubbles_exhale_2.mp3', 0.24));
    this.beat(EXHALES[5][0], () => this.breatheOut('rooms/bubbles_exhale_2.mp3', 0.2));
    this.beat(EXHALES[6][0], () => this.breatheOut('rooms/bubbles_exhale_2.mp3', 0.16));
    this.beat(EXHALES[7][0], () => this.breatheOut('rooms/bubbles_exhale_2.mp3', 0.22));
    // far off, whatever it is
    this.beat(12.5, () => this.far('rooms/groan_whale_1.mp3', 0.22, -0.35, 0.5));
    this.beat(17, () => this.far('rooms/hull_creak_1.mp3', 0.14, 0.5, 0.4));
    this.beat(20, () => this.heart?.gain(0.1, 4));
    // while it is over you the water holds still
    this.beat(20.5, () => this.bedTo('rooms/underwater_muffled.mp3', 0.05, 2.5));
    this.beat(26.5, () => this.bedTo('rooms/underwater_muffled.mp3', 0.14, 2));
    this.beat(27.5, () => this.far('rooms/groan_whale_2.mp3', 0.26, 0.4, 0.5));
    this.beat(30, () => {
      this.bedUp('rooms/dream_drone_hollow.mp3', 0.14, { fade: 9 });
      this.bedUp('rooms/underwater_weight.mp3', 0.16, { fade: 10 });
      this.bedTo('rooms/underwater_muffled.mp3', 0.09, 6);
      this.bedTo('rooms/bubbles_rising.mp3', 0.05, 6);
    });
    this.beat(36.5, () => this.far('rooms/hull_creak_2.mp3', 0.2, -0.6, 0.4));
    this.beat(40, () => {
      this.bedUp('rooms/dream_drone_glass.mp3', 0.04, { fade: 6 });
      this.heart?.gain(0.17, 4);
      this.heart?.rate(1.14, 4);
    });
    this.beat(44, () => this.far('rooms/groan_low.mp3', 0.2, 0.2, 0.4));
    // nothing, for a moment; then it comes through everything, held breath or not
    this.beat(46.9, () => {
      for (const file of this.beds.keys()) this.bedTo(file, 0, 1);
      this.heart?.gain(0, 0.8);
    });
    this.beat(AT.groan, () => {
      this.groan = this.sound.play('rooms/groan_ship_1.mp3', { gain: 0.5, lowpass: 1500, reverb: 0.4 });
      this.sound.play('rooms/groan_low.mp3', { gain: 0.42, reverb: 0.4, rate: 0.84 });
    });
    this.beat(49.3, () => this.groan?.gain(0.1, 0.6));
    this.beat(AT.flash, () => {
      this.sound.play('rooms/flash_underwater.mp3', { gain: 0.6, reverb: 0.4 });
      this.sound.play('rooms/hull_bottom.mp3', { gain: 0.5 });
      this.flashed = true;
      this.shutter();
    });
    this.beat(52.5, () => {
      this.bedTo('rooms/dream_drone_low.mp3', 0.1, 3);
      this.heart?.gain(0.14, 3);
      this.heart?.rate(1.3, 3);
    });
    // nothing again, and then it is right there
    this.beat(57.2, () => {
      for (const file of this.beds.keys()) this.bedTo(file, 0, 0.6);
      this.heart?.gain(0, 0.5);
    });
    this.beat(AT.ping, () => this.sound.play('rooms/sonar_ping.mp3', { gain: 0.28, lowpass: 3000 }));
    this.beat(AT.lidFrom, () => {
      this.sound.play('rooms/eye_turn.mp3', { gain: 0.4, reverb: 0.3, rate: 0.5, pan: 0.2 });
      this.bedUp('rooms/dream_drone_metal.mp3', 0.12, { fade: 2.5 });
    });
    this.beat(AT.lidFrom + 1, () => {
      this.sound.play('rooms/eye_turn.mp3', { gain: 0.34, reverb: 0.3, rate: 0.42, pan: 0.2 });
      this.bedTo('rooms/dream_drone_low.mp3', 0.12, 2);
      this.heartFast = this.sound.bed('rooms/heart_fast.mp3', { gain: 0, lowpass: 800 });
      this.heartFast.gain(0.26, 2.5);
    });
    this.beat(63, () => this.sound.play('rooms/hull_creak_2.mp3', { gain: 0.16, pan: -0.4, reverb: 0.4, rate: 0.8 }));
    this.beat(65.5, () => {
      for (const file of this.beds.keys()) this.bedTo(file, 0, 0.45);
      this.heartFast?.gain(0.1, 0.4);
    });
    this.beat(AT.current, () => {
      this.sound.play('rooms/current_rush.mp3', { gain: 0.5 });
      this.sound.play('rooms/groan_ship_2.mp3', { gain: 0.5, lowpass: 1500, reverb: 0.4 });
      this.bedUp('rooms/wind_in_ears.mp3', 0.25, { fade: 5 });
      this.heartFast?.gain(0.3, 3);
    });
    this.beat(AT.cut, () => this.sound.stopAll(0.25));
    this.beat(AT.lineOne, () => this.say({ tr: 'Aşağısı yok.', en: 'There is no bottom.' }, 4.5));
    this.beat(AT.lineTwo, () => this.say({ tr: 'Yıllardır seni bekliyor.', en: 'It has waited for you for years.' }, 4.5));
    this.beat(AT.prompt, () => {
      this.hint({ tr: 'Basılı tut: nefesini tut', en: 'Hold: hold your breath' });
      this.promptUp = true;
    });
    this.beat(AT.fallback, () => {
      if (this.promptUp) {
        this.hint(null);
        this.promptUp = false;
      }
      if (!this.everHeld) this.letGo();
    });
  }

  /** The breath goes: a burst of bubbles and a gasp. */
  private letGo(): void {
    this.bubbleDebt += BREATH.burst;
    this.sound.play('rooms/breath_let_go.mp3', { gain: 0.3 });
    this.sound.play('rooms/bubbles_burst.mp3', { gain: 0.4, lowpass: 3000 });
    this.sound.play('rooms/gasp_surface.mp3', { gain: 0.4, lowpass: 2200 });
  }

  private hush(silent: boolean): void {
    for (const bed of this.beds.values()) bed.voice.gain(silent ? 0 : bed.gain, silent ? 0.45 : 1.2);
  }

  prepare(camera: PerspectiveCamera): void {
    const pixel = (2 * Math.tan((camera.fov * DEG) / 2)) / Math.max(360, window.innerHeight);
    this.snow.uniforms.uPixel.value = pixel;
    this.hairMaterial.uniforms.uPixel.value = pixel;
  }

  private spawnBubble(eye: Vector3, view: PerspectiveCamera): void {
    const i = this.bubbleNext;
    this.bubbleNext = (i + 1) % BUBBLES.count;
    const r = this.random;
    // out of the mouth, but where you can see them: a little ahead and below
    emitAt.set((r() - 0.5) * 0.5, -0.4 - r() * 0.3, -1.0 - r() * 0.5).applyQuaternion(view.quaternion);
    emitAt.x += eye.x;
    emitAt.y += eye.y;
    emitAt.z += eye.z;
    const a = this.bubbleAttr.array as Float32Array;
    a[i * 4] = emitAt.x;
    a[i * 4 + 1] = emitAt.y;
    a[i * 4 + 2] = emitAt.z;
    a[i * 4 + 3] = BUBBLES.size[0] + (BUBBLES.size[1] - BUBBLES.size[0]) * r() ** 2.4;
    this.bubbleVelocity[i] = BUBBLES.rise[0] + (BUBBLES.rise[1] - BUBBLES.rise[0]) * r();
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const eye = frame.eye;
    const dt = frame.dt;
    const input = frame.input;

    // how much light there is
    const light = lightAt(s);
    const since = s - AT.flash;
    const flash = since < 0 ? 0 : (FLASH.popShare * Math.exp(-since / FLASH.pop) + (1 - FLASH.popShare) * Math.exp(-since / FLASH.linger)) * (1 - smootherstep((since - FLASH.gone * 0.6) / (FLASH.gone * 0.4)));
    this.flashSpot.intensity = FLASH.candela * flash;
    this.farMaterial.uniforms.uFlash.value = flash;
    this.hills.visible = flash > 0.001;
    // the flash on the frame of the shutter is the print: the white comes after it
    this.white = this.flashed ? 0 : since >= 0 && since < 0.6 ? (REDUCED_MOTION ? 0.3 : 1) * FLASH.white * Math.exp(-since / FLASH.whiteFall) : 0;
    this.flashed = false;
    this.air.fog.density = lerp(FOG.dark, FOG.flash, Math.min(1, flash * 5));
    scratchColor.copy(WATER_LEVEL).multiplyScalar(light * 0.5).add(WATER_DEEP);
    if (flash > 0) scratchColor.setRGB(scratchColor.r + 0.0005 * flash, scratchColor.g + 0.004 * flash, scratchColor.b + 0.0085 * flash);
    this.air.fog.color = scratchColor.getHex();

    // the slope: a little of the dying light, then nothing but the flash, then the low light from nowhere
    const pale = smootherstep(range(28, 42, s)) * (s < AT.flash ? 1 : 0) * 0.72;
    this.hairMaterial.uniforms.uNear.value = Math.min(pale * 0.16, 0.05);
    (this.shape.uTopLight.value as Color).setRGB(0.15 * pale, 0.24 * pale, 0.3 * pale);
    const close = smootherstep(range(AT.ping + 0.1, AT.ping + 1.6, s));
    const toMouth = smootherstep(range(AT.current, 70, s));
    this.eyeLight.intensity = lerp(LOW_LIGHT.eye, LOW_LIGHT.mouth, toMouth) * close;
    this.shape.uFine.value = Math.max(0.9 * close, 0.5 * smootherstep(range(38, 46, s)) * (s < AT.flash ? 1 : 0));
    (this.shape.uShadowFill.value as Color).setRGB(0.012 * flash, 0.05 * flash, 0.075 * flash);
    // first by the eye, and then it goes with you
    gaze.copy(eye).sub(this.head.position).applyQuaternion(this.headTurnBack).divideScalar(HEAD_HEIGHT);
    v1.set(lerp(LOW_LIGHT.at[0], gaze.x, toMouth), lerp(LOW_LIGHT.at[1], gaze.y - 0.03, toMouth), lerp(LOW_LIGHT.at[2], gaze.z, toMouth)).applyMatrix4(this.head.matrix);
    this.eyeLight.position.copy(v1).add(this.origin);

    // the jaw
    const mouth = smootherstep(range(AT.current, 72.5, s));
    const jaw = lerp(MOUTH.half, MOUTH.wide, mouth);
    this.shape.uJaw.value = jaw;
    this.lowerTeeth.rotation.x = jaw;

    // the lid, and the ball under it
    const opening = range(AT.lidFrom, AT.lidTo, s);
    const lid = smootherstep(opening * 2.2) * 0.32 + smootherstep((opening - 0.5) * 2) * 0.68;
    this.shape.uLid.value = lid;
    this.ball.visible = lid > 0.0005;
    // it comes down from under the lid, and then it has found you
    gaze.x -= EYE.x;
    gaze.y -= EYE.y;
    gaze.z -= EYE.z;
    gaze.normalize();
    const find = smootherstep(range(AT.lidFrom + 1, AT.lidTo + 0.4, s));
    v1.copy(rolled).lerp(gaze, find).normalize();
    this.ball.quaternion.setFromUnitVectors(FORWARD, v1);
    this.eyeShape.uPupil.value = lerp(0.3, 0.17, smootherstep(range(AT.lidTo, AT.lidTo + 1.4, s)));
    this.eyeShape.uCatch.value = 1.6 * close;
    // under the closed lid, it dreams
    const dream = smootherstep(range(AT.ping + 0.2, AT.ping + 0.8, s)) * (1 - smootherstep(range(AT.lidFrom, AT.lidFrom + 0.5, s)));
    this.shape.uPress.value.set(EYE.x + Math.sin(s * 2.7) * 0.022 + Math.sin(s * 6.1) * 0.006, EYE.y - 0.002 + Math.sin(s * 1.9 + 1) * 0.006, 0.0042 * dream);

    // the lens
    this.focus = s < AT.flash ? 12 : lerp(lerp(10, 20, smootherstep(range(AT.current, 68.5, s))), 9, smootherstep(range(70, 73, s)));
    this.aperture = s < 46 ? 3 : s < 56 ? 0 : 2;

    // water
    const w = this.water.uniforms;
    w.uLight.value = light;
    w.uTime.value = frame.time;
    w.uFlash.value = flash;

    // far above, something passes
    this.shark.visible = s > SHARK.from && s < SHARK.to;
    if (this.shark.visible) {
      this.swim.setTime(s * SHARK.tail);
      this.shark.position.copy(eye).addScaledVector(this.ovalDir, SHARK.distance).addScaledVector(this.ovalU, (SHARK.middle - s) * SHARK.speed);
    }

    // snow
    if (dt > 0) {
      v1.copy(eye).sub(this.lastEye).divideScalar(dt);
      if (v1.length() < 40) this.velocity.lerp(v1, 1 - Math.exp(-dt * 5));
    }
    this.lastEye.copy(eye);
    const sn = this.snow.uniforms;
    sn.uEye.value.copy(eye);
    sn.uTime.value = frame.time;
    sn.uFlash.value = flash;
    sn.uVelocity.value.copy(this.velocity);
    (sn.uColor.value as Color).setRGB(0.5, 0.72, 0.8).multiplyScalar(0.09 + light * 1.2 + close * 0.15);

    // hair
    const hu = this.hairMaterial.uniforms;
    hu.uLight.value = Math.max(light, 0.035) + close * 0.05;
    hu.uGlow.value = close * 0.07;
    hu.uFlash.value = flash;
    hu.uHaze.value = lerp(HAIR.haze, 1, Math.min(1, flash * 5));
    hu.uTime.value = frame.time;
    hu.uEye.value.copy(eye);
    hu.uPull.value = smootherstep(range(AT.current, 74, s)) * 1.6;
    // close to the face nothing comes between you and it
    hu.uClear.value = lerp(HAIR.clear, HAIR.clearClose, Math.max(0.55 * smootherstep(range(38, 47, s)) * (s < AT.flash ? 1 : 0), smootherstep(range(52, 56, s)) * (1 - 0.7 * smootherstep(range(AT.current, 70, s)))));

    // your breath
    const pressable = s >= BREATH.from && s < BREATH.until;
    this.control.press = pressable;
    if (!input.holding) this.forcedOut = false;
    const held = pressable && input.holding && !this.forcedOut;
    if (held && !this.holding) {
      this.holding = true;
      this.everHeld = true;
      this.heldFor = 0;
      this.sound.play('rooms/breath_held.mp3', { gain: 0.3 });
      this.hush(true);
      if (this.promptUp) {
        this.hint(null);
        this.promptUp = false;
      }
    } else if (!held && this.holding) {
      this.holding = false;
      this.hush(false);
      this.letGo();
    }
    if (this.holding) {
      this.heldFor += dt;
      if (this.heldFor > BREATH.longest) {
        this.forcedOut = true;
      }
    }
    let exhaling = false;
    for (let i = 0; i < EXHALES.length; i++) if (s >= EXHALES[i][0] && s < EXHALES[i][1]) exhaling = true;
    if (exhaling && !this.holding) this.bubbleDebt += (BUBBLE_RATE + 9 * Math.sin(s * 3.1)) * dt;
    // a viewer who jumped did not breathe
    if (Math.abs(s - this.lastSeconds) > 1) this.bubbleDebt = 0;
    this.lastSeconds = s;
    while (this.bubbleDebt >= 1) {
      this.bubbleDebt -= 1;
      this.spawnBubble(eye, frame.view);
    }
    const a = this.bubbleAttr.array as Float32Array;
    for (let i = 0; i < BUBBLES.count; i++) {
      if (a[i * 4 + 3] <= 0) continue;
      const wob = this.bubbleWobble[i] * 40;
      a[i * 4] += Math.sin(frame.time * 2.3 + wob) * 0.05 * dt;
      a[i * 4 + 2] += Math.cos(frame.time * 1.9 + wob) * 0.05 * dt;
      a[i * 4 + 1] += this.bubbleVelocity[i] * dt;
      if (a[i * 4 + 1] - eye.y > 40) a[i * 4 + 3] = 0;
    }
    this.bubbleAttr.needsUpdate = true;
    this.bubbleMaterial.uniforms.uTime.value = frame.time;
    (this.bubbleMaterial.uniforms.uLightColor.value as Color).setRGB(0.62, 0.92, 1).multiplyScalar(0.05 + light * 0.9 + flash * 1.4 + close * 0.14);

    // the end
    this.black = s >= AT.cut ? 1 : 0;
    this.fear = s < 30 ? 0.2 + s * 0.005 : s < 48 ? 0.35 + (s - 30) * 0.012 : s < 58 ? 0.55 : s < 66 ? 0.8 : 1;
    // the view is brought back for the two moments that must be seen
    this.control.look = !((s > 48.8 && s < 50.3) || (s > 56.6 && s < 58.4) || s > 71);
  }
}

function lightAt(s: number): number {
  const { times, values } = LIGHT;
  let i = 0;
  while (i < times.length - 1 && s > times[i + 1]) i++;
  if (i >= times.length - 1) return values[values.length - 1];
  return lerp(values[i], values[i + 1], smootherstep((s - times[i]) / (times[i + 1] - times[i])));
}
