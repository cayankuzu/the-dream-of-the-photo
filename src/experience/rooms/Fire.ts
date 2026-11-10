import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  CustomBlending,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RepeatWrapping,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  type Material,
} from 'three';
import { WARP_GLSL, warpUniforms } from '../render/Warp';
import { randomFrom } from '../dream/FigureKit';

type V3 = readonly [number, number, number];

/** One line of fire: flames stand along it, from `from` to `to` (room frame), this tall. */
export interface FireLine {
  from: V3;
  to: V3;
  height: number;
}

/** Rows of a flame sheet: enough to bend with curved space and to lean. */
const SHEET_ROWS = 6;
/** How many flame sheets stand one behind another at any place on a line, and how wide each is as a share of its height. */
const SHEET_DEPTH = 2.2;
const SHEET_WIDTH = 0.72;
/** Embers per meter of line, how long each lives (s) and how far above the flames it can rise (share of their height). */
const EMBERS_PER_M = 9;
const EMBER_LIFE = 2.6;
const EMBER_RISE = 1.5;
/** Smoke: layers under a ceiling, how far apart (m), and quads of each along its longer side. */
const SMOKE_LAYERS = 5;
const SMOKE_STEP = 0.075;
const SMOKE_QUADS = 16;
/** The color of what the fire lights in the air, and how strongly heat streaks show it for each unit of their strength. */
const FIRELIGHT = 0xff6a20;
const SHIMMER_GLOW = 0.16;
/** Size of the tiling noise image (px). */
const NOISE_SIZE = 256;

/**
 * Firelight as it really moves: a fire breathes irregularly, and never faster than 3 Hz (the piece's limit). Around 1,
 * between about 0.45 and 1.45; a pure function of time. Multiply a light's intensity by it.
 */
export function fireFlicker(time: number, seed = 0): number {
  const t = time * Math.PI * 2;
  const a = seed * 5.7;
  const slow = Math.sin(t * 0.17 + 0.4 + a) * 0.11 + Math.sin(t * 0.41 + 2.1 + a) * 0.13;
  const quick = Math.sin(t * 0.97 + 4.4 + a) * 0.11 + Math.sin(t * 1.61 + 1.2 + a) * 0.08 + Math.sin(t * 2.37 + 3.3 + a) * 0.05;
  // it gutters now and then, for a moment
  const gutter = Math.max(0, Math.sin(t * 0.23 + 5.1 + a) * Math.sin(t * 0.61 + 0.7 + a) - 0.45) * 0.55;
  return 1 + slow + quick - gutter;
}

/** One channel of tiling gradient noise, in octaves, stretched to 0..1 and written every fourth byte. */
function noiseChannel(data: Uint8Array, channel: number, period: number, octaves: number, seed: number): void {
  const random = randomFrom(seed);
  const size = NOISE_SIZE;
  const values = new Float32Array(size * size);
  for (let o = 0; o < octaves; o++) {
    const cells = period << o;
    const gradients = new Float32Array(cells * cells * 2);
    for (let i = 0; i < gradients.length; i += 2) {
      const a = random() * Math.PI * 2;
      gradients[i] = Math.cos(a);
      gradients[i + 1] = Math.sin(a);
    }
    const amount = 1 / (1 << o);
    const dot = (cx: number, cy: number, dx: number, dy: number) => {
      const g = (((cy + cells) % cells) * cells + ((cx + cells) % cells)) * 2;
      return gradients[g] * dx + gradients[g + 1] * dy;
    };
    for (let y = 0; y < size; y++) {
      const v = (y / size) * cells;
      const cy = Math.floor(v);
      const fy = v - cy;
      const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
      for (let x = 0; x < size; x++) {
        const u = (x / size) * cells;
        const cx = Math.floor(u);
        const fx = u - cx;
        const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
        const top = dot(cx, cy, fx, fy) + (dot(cx + 1, cy, fx - 1, fy) - dot(cx, cy, fx, fy)) * sx;
        const bottom = dot(cx, cy + 1, fx, fy - 1) + (dot(cx + 1, cy + 1, fx - 1, fy - 1) - dot(cx, cy + 1, fx, fy - 1)) * sx;
        values[y * size + x] += (top + (bottom - top) * sy) * amount;
      }
    }
  }
  let low = Infinity;
  let high = -Infinity;
  for (const v of values) {
    low = Math.min(low, v);
    high = Math.max(high, v);
  }
  for (let i = 0; i < values.length; i++) data[i * 4 + channel] = ((values[i] - low) / (high - low)) * 255;
}

let noise: DataTexture | null = null;
/** Tiling noise for all fire and smoke: red and green are detailed, blue and alpha smooth, for bending the others. Made once and kept: it is small, and no room owns it. */
function fireNoise(): DataTexture {
  if (noise) return noise;
  const data = new Uint8Array(NOISE_SIZE * NOISE_SIZE * 4);
  noiseChannel(data, 0, 4, 5, 11);
  noiseChannel(data, 1, 7, 4, 23);
  noiseChannel(data, 2, 3, 2, 37);
  noiseChannel(data, 3, 3, 2, 51);
  noise = new DataTexture(data, NOISE_SIZE, NOISE_SIZE);
  noise.wrapS = noise.wrapT = RepeatWrapping;
  noise.generateMipmaps = true;
  noise.minFilter = LinearMipmapLinearFilter;
  noise.magFilter = LinearFilter;
  noise.needsUpdate = true;
  return noise;
}

const FLAME_VERT = /* glsl */ `
${WARP_GLSL}
attribute vec3 across;
attribute vec4 sheet;
uniform float uTime;
uniform float uFacing;
varying vec4 vSheet;
varying vec2 vPlace;
varying float vFogDepth;
void main() {
  vec3 base = (modelMatrix * vec4(position, 1.0)).xyz;
  vec4 mv;
  vSheet = sheet;
  if (sheet.w < 0.0) {
    // an ember: it climbs, it wanders, it dies; a pure function of time
    float seed = sheet.z;
    float life = fract(uTime / ${EMBER_LIFE.toFixed(2)} + seed * 17.3);
    float climb = life * (0.4 + 0.6 * fract(seed * 7.7)) * ${EMBER_RISE.toFixed(2)} * -sheet.w;
    vec3 at = base + vec3(sin(life * 6.0 + seed * 40.0) * 0.16 + (fract(seed * 3.1) - 0.5) * life * 0.7, climb, cos(life * 5.0 + seed * 23.0) * 0.16);
    mv = viewMatrix * vec4(at, 1.0);
    mv.xy += sheet.xy * 0.016 * (1.0 - life * 0.5);
    vPlace = vec2(life, fract(seed * 91.0));
  } else {
    float halfWidth = length(across);
    vec3 side = across;
    if (uFacing > 0.5) {
      vec3 toEye = cameraPosition - base;
      side = normalize(vec3(toEye.z, 0.0, -toEye.x)) * halfWidth;
    }
    // the whole sheet leans and wanders from the root up, slowly
    float lean = (sin(uTime * 0.83 + sheet.z * 31.0) + sin(uTime * 1.57 + sheet.z * 17.0) * 0.6) * 0.09 * sheet.w;
    vec3 at = base + side * sheet.x + normalize(side) * lean * sheet.y * sheet.y + vec3(0.0, sheet.y * sheet.w, 0.0);
    mv = viewMatrix * vec4(at, 1.0);
    vPlace = vec2(sheet.x * halfWidth / sheet.w, sheet.y);
  }
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * dreamWarp(mv);
}
`;

const FLAME_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uNoise;
uniform float uTime;
uniform float uFlare;
uniform float uHeat;
varying vec4 vSheet;
varying vec2 vPlace;

// What burning soot gives off at a temperature 0..1 and beyond, in linear light: red, then orange, then a white-yellow it
// cannot hold. Below its yellow, flame lies outside what a screen can show: hence less than no blue, or the grade turns it pink.
vec3 fireColor(float h) {
  return h * vec3(1.15, 0.1 + 0.42 * h * h, -0.11 + 0.1 * h * h * h * h);
}

void main() {
  float fade = 1.0;
  #ifdef FOG_EXP2
    fade = exp(-fogDensity * fogDensity * vFogDepth * vFogDepth * 0.7);
  #endif
  if (vSheet.w < 0.0) {
    float life = vPlace.x;
    float ember = pow(max(0.0, 1.0 - length(vSheet.xy)), 2.0) * (1.0 - life) * (1.0 - life) * smoothstep(0.0, 0.08, life);
    float twinkle = 0.55 + 0.45 * sin(uTime * 7.0 + vPlace.y * 60.0);
    gl_FragColor = vec4(vec3(3.2, 0.75, 0.05) * ember * twinkle * fade, 1.0);
    return;
  }
  float u = vSheet.x;
  float v = vSheet.y;
  float seed = vSheet.z * 61.0;
  float t = uTime;
  // a flame speeds up as it rises, so everything in it stretches with height
  vec2 q = vec2(vPlace.x, pow(v, 0.75));
  vec2 bend = texture2D(uNoise, q * vec2(0.55, 0.2) + vec2(seed * 0.73, seed * 0.31 - t * 0.1)).ba - 0.5;
  // everything flows along the same curving lines, and curves more the higher it is
  vec2 flow = q + bend * vec2(0.42, 0.22) * (0.25 + v);
  float tongues = texture2D(uNoise, flow * vec2(1.0, 0.3) + vec2(seed * 0.37, -t * 0.21)).r;
  float folds = texture2D(uNoise, flow * vec2(2.4, 0.6) + vec2(seed * 0.91, -t * 0.48)).r;
  float streaks = texture2D(uNoise, flow * vec2(3.6, 0.5) + vec2(seed * 0.19, -t * 0.45)).g;
  float n = tongues * 0.52 + folds * 0.38 + streaks * 0.1;
  // solid at the root, higher up only the crests of the noise burn: the flame's outline is the noise's, and never the sheet's
  float puff = sin(q.y * 5.0 - t * 2.1 + seed) * 0.022;
  float level = mix(0.3, 0.66, pow(v, 1.1)) + pow(v, 5.0) * 0.2 + u * u * 0.2 + puff - (uFlare - 1.0) * 0.1 * v;
  float inside = n - level;
  float window = smoothstep(1.0, 0.72, abs(u)) * smoothstep(1.0, 0.82, v) * smoothstep(0.0, 0.04, v);
  if (inside <= -0.12 || window <= 0.0) discard;
  // round it the hot air glows a little
  float glow = smoothstep(-0.12, 0.0, inside) * 0.09;
  // creases: where a thin sheet of flame folds and is seen edge on, it is far brighter; and within them, finer filaments
  float crease = 1.0 - abs(2.0 * folds - 1.0);
  crease *= crease;
  float filament = 1.0 - abs(2.0 * texture2D(uNoise, flow * vec2(5.5, 0.9) + vec2(seed * 0.53, -t * 0.7)).g - 1.0);
  filament *= filament;
  float heat = glow + smoothstep(0.0, 0.03, inside) * (0.2 + inside * 2.1) * (0.46 + crease * crease * 1.1 + filament * filament * 0.35) * (0.72 + streaks * 0.56);
  // the root of a fire is short of air: its brightest part lies a quarter of the way up
  heat *= window * uHeat * (0.82 + uFlare * 0.18) * (1.0 - v * 0.42) * mix(0.6, 1.0, smoothstep(0.0, 0.25, v));
  gl_FragColor = vec4(fireColor(heat) * fade, 1.0);
}
`;

/** One program for what the fire does to the air: smoke lying flat, or, with `uShimmer`, heat standing up and turned to the eye. */
const AIR_VERT = /* glsl */ `
${WARP_GLSL}
attribute vec2 airAt;
uniform float uShimmer;
uniform vec3 uStand;
varying vec3 vRoom;
varying vec2 vAirAt;
varying float vFogDepth;
void main() {
  vAirAt = airAt;
  vRoom = position;
  vec4 mv;
  if (uShimmer > 0.5) {
    vec3 base = (modelMatrix * vec4(uStand, 1.0)).xyz;
    vec3 toEye = cameraPosition - base;
    mv = viewMatrix * vec4(base + normalize(vec3(toEye.z, 0.0, -toEye.x)) * position.x + vec3(0.0, position.y, 0.0), 1.0);
  } else {
    mv = modelViewMatrix * vec4(position, 1.0);
  }
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * dreamWarp(mv);
}
`;

const AIR_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uNoise;
uniform float uTime;
uniform float uFlare;
uniform float uShimmer;
uniform vec4 uFlow;
uniform float uReach;
uniform float uStrength;
uniform vec3 uLit;
varying vec3 vRoom;
varying vec2 vAirAt;

void main() {
  float fog = 0.0;
  #ifdef FOG_EXP2
    fog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #endif
  if (uShimmer > 0.5) {
    // heat: there is no picture of the room here to bend, so wavering plumes rise that by turns lighten what lies behind them and dim it
    vec2 up = vec2(vRoom.x * 0.9, vRoom.y * 0.3 - uTime * 0.42);
    vec2 sway = texture2D(uNoise, up * 0.7).ba - 0.5;
    float plume = (texture2D(uNoise, up * vec2(1.5, 0.8) + sway * 0.75).r - 0.5) * 3.0;
    float side = sin(vAirAt.x * PI);
    float edge = side * side * smoothstep(0.0, 0.25, vAirAt.y) * smoothstep(1.0, 0.5, vAirAt.y) * (1.0 - fog);
    gl_FragColor = vec4(uLit * uFlare * max(plume, 0.0) * edge, max(-plume, 0.0) * uStrength * edge);
    return;
  }
  // smoke rolling under a ceiling: it moves with the draught, thickest at its source, thinning to nothing
  vec2 away = vRoom.xz - uFlow.xy;
  float far = length(away) / uReach;
  vec2 q = vRoom.xz - uFlow.zw * uTime;
  vec2 bend = texture2D(uNoise, q * 0.09 + uTime * 0.012).ba - 0.5;
  // the lower a layer lies, the fewer billows reach it; each has its own, or their outlines would stack up like contour lines
  float layer = vAirAt.y;
  vec2 billows = q * 0.17 + bend * 0.35 + layer * vec2(0.37, 0.61);
  float n = texture2D(uNoise, billows).r * 0.72 + texture2D(uNoise, q * 0.47 + bend * 0.6 + layer * vec2(0.71, 0.29)).g * 0.28;
  float d = n - 0.62 + ((1.0 - far) * 0.96 - layer * 0.56) * 0.62;
  float a = smoothstep(-0.04, 0.36, d) * uStrength * smoothstep(1.0, 0.7, far) * smoothstep(0.0, 0.12, vAirAt.x);
  if (a < 0.003) discard;
  // the fire lights it from below and from its side: the flank of a billow that faces it, the nearer the more
  float flank = clamp((texture2D(uNoise, billows + normalize(away + 1e-3) * 0.05, 3.0).r - texture2D(uNoise, billows, 3.0).r) * 16.0, 0.0, 1.0);
  vec3 color = vec3(0.018, 0.016, 0.014) + uLit * uFlare * pow(max(0.0, 1.0 - far), 2.5) * (0.12 + flank) * (0.3 + layer);
  #ifdef FOG_EXP2
    color = mix(color, fogColor, fog);
  #endif
  gl_FragColor = vec4(color, a * (1.0 - fog * 0.6));
}
`;

/**
 * Fire for behind a door ajar and for a floor rushing past: flame sheets along lines with embers rising off them,
 * smoke under a ceiling, heat in the air, all a pure function of `update(time)`. That also returns how bright it burns
 * right now: multiply your point light's intensity by it, and light and flame breathe together. Add `root` to the room.
 *
 * Sheets turn to the eye, so a line must stand off any wall by 0.4 of its height, or the wall cuts them; with
 * `facing: false` they lie along their lines, as a curtain of fire on a wall. `heat` is how hot it burns (default 0.9:
 * orange with a yellow heart; much more burns out to white).
 */
export class Fire {
  readonly root = new Group();
  private readonly time = { value: 0 };
  private readonly flare = { value: 1 };
  private readonly seed: number;

  constructor(lines: readonly FireLine[], opts: { seed?: number; facing?: boolean; heat?: number } = {}) {
    this.seed = opts.seed ?? 1;
    const random = randomFrom(this.seed);
    const positions: number[] = [];
    const across: number[] = [];
    const sheets: number[] = [];
    const indices: number[] = [];
    for (const line of lines) {
      const dx = line.to[0] - line.from[0];
      const dz = line.to[2] - line.from[2];
      const length = Math.hypot(dx, dz);
      const count = Math.max(3, Math.round(((length / line.height) * SHEET_DEPTH) / SHEET_WIDTH));
      for (let i = 0; i < count; i++) {
        const share = (i + 0.2 + random() * 0.6) / count;
        const x = line.from[0] + dx * share + (random() - 0.5) * 0.06 * line.height;
        const y = line.from[1] + (line.to[1] - line.from[1]) * share;
        const z = line.from[2] + dz * share + (random() - 0.5) * 0.06 * line.height;
        const tall = line.height * (0.62 + 0.42 * random());
        const halfWidth = (tall * SHEET_WIDTH * (0.75 + 0.5 * random())) / 2;
        const seed = random();
        const base = positions.length / 3;
        for (let row = 0; row <= SHEET_ROWS; row++) {
          for (const u of [-1, 1]) {
            positions.push(x, y, z);
            across.push(length > 0 ? (dx / length) * halfWidth : halfWidth, 0, length > 0 ? (dz / length) * halfWidth : 0);
            sheets.push(u, row / SHEET_ROWS, seed, tall);
          }
          if (row < SHEET_ROWS) {
            const a = base + row * 2;
            indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          }
        }
      }
      const embers = Math.round((length + line.height * 0.5) * EMBERS_PER_M);
      for (let i = 0; i < embers; i++) {
        const share = random();
        const seed = random();
        const base = positions.length / 3;
        for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          positions.push(line.from[0] + dx * share, line.from[1] + line.height * 0.25, line.from[2] + dz * share);
          across.push(0, 0, 0);
          sheets.push(a, b, seed, -line.height);
        }
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('across', new Float32BufferAttribute(across, 3));
    geometry.setAttribute('sheet', new Float32BufferAttribute(sheets, 4));
    geometry.setIndex(indices);
    const flames = new Mesh(
      geometry,
      new ShaderMaterial({
        vertexShader: FLAME_VERT,
        fragmentShader: FLAME_FRAG,
        uniforms: {
          ...UniformsUtils.merge([UniformsLib.fog]),
          ...warpUniforms,
          uNoise: { value: fireNoise() },
          uTime: this.time,
          uFlare: this.flare,
          uHeat: { value: opts.heat ?? 0.9 },
          uFacing: { value: opts.facing === false ? 0 : 1 },
        },
        fog: true,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    );
    flames.frustumCulled = false;
    flames.renderOrder = 3;
    this.root.add(flames);
  }

  /** It burns: pass the time (s). Returns how bright right now (around 1): see fireFlicker. */
  update(time: number): number {
    this.time.value = time;
    this.flare.value = fireFlicker(time, this.seed);
    return this.flare.value;
  }

  /**
   * Smoke drifting along a ceiling: a soft dark layer over the box x, z, its top at height `y`, thick at `from` (x, z),
   * thinning out over `reach` m, flowing along `drift` (x, z, m/s), lit from below by the fire near it. Keep the box
   * inside the walls: it fades only at its own edges. `strength` is how dark at its thickest, `lit` how much fire it shows.
   */
  smoke(box: { x: readonly [number, number]; z: readonly [number, number]; y: number }, from: readonly [number, number], drift: readonly [number, number], reach: number, opts: { strength?: number; lit?: number } = {}): void {
    const positions: number[] = [];
    const places: number[] = [];
    const indices: number[] = [];
    const across = box.x[1] - box.x[0];
    const along = box.z[1] - box.z[0];
    const longer = Math.max(Math.abs(across), Math.abs(along));
    const nx = Math.max(2, Math.round((SMOKE_QUADS * Math.abs(across)) / longer));
    const nz = Math.max(2, Math.round((SMOKE_QUADS * Math.abs(along)) / longer));
    for (let layer = 0; layer < SMOKE_LAYERS; layer++) {
      const base = positions.length / 3;
      for (let j = 0; j <= nz; j++) {
        for (let i = 0; i <= nx; i++) {
          positions.push(box.x[0] + (across * i) / nx, box.y - layer * SMOKE_STEP - 0.01, box.z[0] + (along * j) / nz);
          places.push(Math.min(i / nx, j / nz, 1 - i / nx, 1 - j / nz) * 2, layer / (SMOKE_LAYERS - 1));
          if (i < nx && j < nz) {
            const a = base + j * (nx + 1) + i;
            const b = a + nx + 1;
            indices.push(a, a + 1, b, a + 1, b + 1, b);
          }
        }
      }
    }
    this.air(positions, places, indices, 0, [0, 0, 0], [from[0], from[1], drift[0], drift[1]], reach, opts.strength ?? 0.6, opts.lit ?? 0.5, {});
  }

  /**
   * Heat you can see, standing with its foot at (x, y, z), above the fire or in a door: width by height meters of air,
   * turned to the eye, in which faint plumes rise that lighten and dim what lies behind them. It does not bend what is
   * seen through it (that would need a picture of the room). `strength` about 0.2.
   */
  shimmer(x: number, y: number, z: number, width: number, height: number, strength = 0.2): void {
    const positions: number[] = [];
    const places: number[] = [];
    const indices: number[] = [];
    for (let row = 0; row <= SHEET_ROWS; row++) {
      for (const u of [0, 1]) {
        positions.push((u - 0.5) * width, (row / SHEET_ROWS) * height, 0);
        places.push(u, row / SHEET_ROWS);
      }
      if (row < SHEET_ROWS) {
        const a = row * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.air(positions, places, indices, 1, [x, y, z], [0, 0, 0, 0], 1, strength, strength * SHIMMER_GLOW, {
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
    });
  }

  /** One mesh of smoke or heat: the same program, its blending aside. */
  private air(positions: number[], places: number[], indices: number[], shimmer: number, stand: V3, flow: readonly number[], reach: number, strength: number, lit: number, blend: Partial<Material>): void {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('airAt', new Float32BufferAttribute(places, 2));
    geometry.setIndex(indices);
    const mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        vertexShader: AIR_VERT,
        fragmentShader: AIR_FRAG,
        uniforms: {
          ...UniformsUtils.merge([UniformsLib.fog]),
          ...warpUniforms,
          uNoise: { value: fireNoise() },
          uTime: this.time,
          uFlare: this.flare,
          uShimmer: { value: shimmer },
          uStand: { value: stand },
          uFlow: { value: flow },
          uReach: { value: reach },
          uStrength: { value: strength },
          uLit: { value: new Color(FIRELIGHT).multiplyScalar(lit) },
        },
        fog: true,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        ...blend,
      }),
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    this.root.add(mesh);
  }
}
