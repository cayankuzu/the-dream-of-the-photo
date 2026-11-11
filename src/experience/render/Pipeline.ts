import {
  BufferGeometry,
  Camera,
  CanvasTexture,
  Color,
  DepthTexture,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoToneMapping,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
  type Object3D,
  type Texture,
} from 'three';
import { renderConfig } from '../../config/experience.config';
import { randomFrom } from '../dream/FigureKit';
import { clamp, damp, lerp, wobble } from '../math';
import { AGX_GLSL, FILM_GLSL, FILM_SCRATCHES, GRADE_GLSL, HASH_GLSL, LUMA_GLSL, SHEEN_GLSL } from './glsl';
import type { Grade } from './Grade';

/** Graphics cards that get the sharper picture (see renderConfig.high), and those that never do, by their renderer's name. */
const STRONG_CARD = /nvidia|geforce|rtx|quadro|radeon rx|radeon pro|apple m\d/i;
const WEAK_CARD = /intel|uhd|iris|mali|adreno|powervr|swiftshader|llvmpipe|basic render/i;

/** Depth-of-field sizes are designed at this drawing-buffer height and scaled to the real one. */
const DOF_REFERENCE_HEIGHT = 1080;

/**
 * The glow. Its targets are shares of the drawing buffer, capped so a big screen costs no more; two levels of
 * separable blur (a tight one, and a wide one at half its size) make the long tail of a dirty lens.
 */
const bloomConfig = {
  /** The bright pass: share of the drawing buffer, and its longest side (px). */
  share: 0.25,
  maxSide: 480,
  /** Blur tap spacing (texels of its own level): the tight level, the wide level. */
  stride: [0.7, 1.25] as const,
  /** How the levels add up: the tight one in the warm color of film's halation, the wide one neutral. */
  tight: [0.62, 0.47, 0.38] as const,
  wide: 0.5,
  /** Brightest light it takes in: one spark must not swell into a blob. */
  limit: 24,
  /** How much the dirt on the lens shows in the glow (1 = from nothing to double), and how large it lies (tiles per screen height). */
  dirt: 1.6,
  dirtScale: 0.56,
} as const;

/** The long exposure: a history of the linear scene that bright things leave trails in. */
const ghostConfig = {
  share: 0.5,
  maxSide: 960,
  /** Seconds a trail takes to fall to a third at ghost 1 (it goes with ghost squared). */
  seconds: 3.5,
  /** How strongly the history shows over the picture, reached by this much ghost. */
  gain: 0.95,
  fadeIn: 0.12,
  /** The trails grow away from the middle of the frame (share of the frame per second, at ghost 1). */
  drift: 0.03,
} as const;

/** What fear and the heart do to the frame. */
const dreadConfig = {
  /** The vignette deepens (share of the picture) with fear and on the beat. */
  vignette: { fear: 0.2, beat: 0.1 },
  /** And closes in (screen heights). */
  tunnel: { fear: 0.14, beat: 0.05 },
  /** The beat reaches the vignette through this smoothing (1/s): lub and dub merge into one swell, well under 3 Hz. */
  beatRate: 12,
  /** Grain grows with fear (share of the resting grain at full fear). */
  grain: 1,
  /** A coarser grain joins the fine one as it grows (share of the extra grain; never more than `clumpMost`). */
  clump: 0.6,
  clumpMost: 0.8,
} as const;

/** The film running through the gate. */
const filmConfig = {
  /** Frames per second of everything that jumps: slower than the screen, like a hand-cranked print. */
  fps: 18,
  /** The gate's movement: a slow wander and a jump per frame (shares of fx.weave; they add up to 1). */
  weave: { wander: 0.55, jump: 0.45, sideways: 0.6 },
  /** Chromatic split: below this many pixels of split (at the corner's rate) the middle of the frame takes one look only. */
  splitFrom: 0.83,
  scratch: {
    /** Each scratch runs this long (s), then may be replaced. */
    period: [1.4, 5.5] as const,
    /** Share of them running, per unit of fx.scratches. */
    share: 1,
    /** Half width (shares of the frame's width) and never thinner than this many pixels. */
    width: [0.00028, 0.00085] as const,
    pixels: 0.7,
    strength: [0.12, 0.55] as const,
    /** They reach full strength by this much fx.scratches (1 / value). */
    rise: 2,
    /** Share that print dark instead of white. */
    dark: 0.2,
    /** Slow wander (share of the width, rad / s) and jitter per frame (share of the width). */
    drift: 0.0015,
    driftRate: 0.5,
    jitter: 0.0012,
  },
  /** Share of the dust's cells landing on a frame, per unit of fx.scratches. */
  dust: 0.5,
  hair: {
    /** One chance of a hair per this many seconds, per unit of fx.scratches; it stays for this share of them. */
    period: 6,
    chance: 1.2,
    stay: [0.25, 0.8] as const,
    /** Side of its image (screen heights), how far from square-on it enters (rad), its shake per frame (share of the frame). */
    size: [0.42, 0.78] as const,
    lean: 1.1,
    shake: 0.0014,
    strength: 0.9,
  },
  /** Where the burn starts (shares of the frame). */
  burnFrom: [1.04, 0.28] as const,
} as const;

/** The damage drawn once into one texture: lens dirt in red, dust in green, hairs in blue (one per quarter). */
const damageConfig = {
  size: 1024,
  seed: 77,
  /** Broad smears and the soft discs of dust out of focus on the lens. */
  smears: 46,
  motes: 90,
  /** Dust specks and lint fibres (px on the texture; they stay this far from its borders, for it tiles). */
  specks: 130,
  fibres: 26,
  margin: 90,
  /**
   * Each hair is a walk: its heading sways `sway` rad over `waves` waves, curls `curl` rad toward its free end
   * (sharper with `power`), leans `lean` rad at the root and trembles finely by `fine` rad.
   */
  hairs: [
    { sway: 0.48, waves: 1.2, curl: 3.7, power: 2.6, phase: 0.5, lean: 0.3, fine: 0.13 },
    { sway: 0.72, waves: 1.45, curl: -1.5, power: 2.2, phase: 2.4, lean: 0.42, fine: 0.16 },
    { sway: 0.3, waves: 0.8, curl: 7.2, power: 4.6, phase: 4.6, lean: 0.12, fine: 0.1 },
    { sway: 1.2, waves: 2.6, curl: 1.6, power: 1.6, phase: 3.3, lean: 0.1, fine: 0.08 },
  ],
  hairSteps: 240,
  /** Stroke width at the root and at the free end (px), and how many strokes make the taper. */
  hairWidth: [2.8, 1.1] as const,
  hairStrokes: 6,
} as const;

/** What the nightmare does to the picture itself (see director/Scares.ts). Everything rests at 0. */
export interface DreamFx {
  /** 0..1 how afraid the piece is: the vignette closes in, the grain grows. */
  fear: number;
  /** 0..1 the beat of the heart: the picture swells with it. */
  heartbeat: number;
  /** Strength of the glow around what is bright. */
  bloom: number;
  /** Linear light above which things glow. */
  bloomFrom: number;
  /** The color of the glow. */
  bloomTint: Color;
  /** 0..1 how much of the last frames stays on the eye (a long exposure's ghost). */
  ghost: number;
  /** Red and blue split at the corner of the frame (share of the frame). */
  aberration: number;
  /** The lens bulges (+) or pinches (-): how much larger the middle of the frame is drawn than its corners. */
  barrel: number;
  /** 0..1 damage on the film: scratches, dust, a hair in the gate. */
  scratches: number;
  /** The film jumps in its gate (share of the frame). */
  weave: number;
  /** The exposure wavers around 1 by this much, slowly (never above 3 Hz). */
  flicker: number;
  /** 0..1 the exposure falls by this share. */
  dip: number;
  /** 0..1 the film burns in from the edge. */
  burn: number;
  /** 0..1 the picture turns to its negative. */
  negative: number;
  /** 0..1 everything goes white (a cut made of a flash). */
  white: number;
  /** A picture cut in for a frame or two: what, and how much of it. */
  insert: Texture | null;
  insertMix: number;
  /** 0..1 the picture goes dark while the film runs on over it; at 1 the film has stopped: nothing at all, not even grain. */
  black: number;
  /** Extra grain (1 = twice the resting amount). */
  grain: number;
  /** The film's own clock (s). It stands still while the piece is paused, and all the damage with it. */
  film: number;
}

export const restingFx = (): DreamFx => ({
  fear: 0,
  heartbeat: 0,
  bloom: 0,
  bloomFrom: 1,
  bloomTint: new Color(1, 1, 1),
  ghost: 0,
  aberration: 0,
  barrel: 0,
  scratches: 0,
  weave: 0,
  flicker: 0,
  dip: 0,
  burn: 0,
  negative: 0,
  white: 0,
  insert: null,
  insertMix: 0,
  black: 0,
  grain: 0,
  film: 0,
});

export interface CompositeState {
  /** Focus distance (m). */
  focus: number;
  /** Depth-of-field strength (pixels of blur per diopter). 0 disables DOF. */
  aperture: number;
  /** Uniform lens softness 0..1 (searching for focus). */
  soft: number;
  grade: Grade;
  exposure: number;
  vignette: number;
  grain: number;
  /** 0 = visible, 1 = black. */
  fade: number;
  flash: number;
  sheen: number;
  sheenOffset: number;
  fx: DreamFx;
}

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform float uFocus;
uniform float uAperture;
uniform float uSoft;
uniform float uMaxBlur;
uniform float uPxScale;
uniform mat3 uGradeA;
uniform vec3 uGradeB;
uniform float uExposure;
uniform float uVignette;
uniform float uGrain;
uniform float uFade;
uniform float uFlash;
uniform float uSheen;
uniform float uSheenOffset;
uniform float uTime;
uniform sampler2D tBloom;
uniform sampler2D tGhost;
uniform sampler2D tInsert;
uniform float uLensOn;
// shift x, y; scale of the frame in its gate
uniform vec3 uGate;
// barrel; 1 / the corner's squared distance; the scale that keeps the corners on the corners
uniform vec3 uLens;
uniform float uAberration;
uniform float uAberrationFrom;
uniform float uGhost;
uniform float uBloom;
uniform vec3 uBloomTint;
uniform float uInsertMix;
uniform vec2 uInsertScale;
uniform float uNegative;
uniform float uBlack;
uniform float uWhite;
uniform float uScratches;
uniform float uTunnel;
uniform float uClump;
varying vec2 vUv;

${GRADE_GLSL}
${LUMA_GLSL}
${AGX_GLSL}
${HASH_GLSL}
${SHEEN_GLSL}
${FILM_GLSL}

const float RAD_SCALE = 0.9;
// one golden-angle step as a rotation (cos, sin of 2.39996323 rad)
const mat2 GOLDEN = mat2(-0.73736887, 0.67549029, -0.67549029, -0.73736887);

float viewDepth(vec2 uv) {
  float z = texture2D(tDepth, uv).x;
  return uNear * uFar / (uFar - z * (uFar - uNear));
}

float blurSize(float depth) {
  float coc = uAperture * abs(1.0 / uFocus - 1.0 / depth);
  return clamp(max(coc, uSoft * uMaxBlur), 0.0, uMaxBlur);
}

vec3 depthOfField(vec2 uv) {
  float centerDepth = viewDepth(uv);
  float centerSize = blurSize(centerDepth);
  vec3 color = texture2D(tScene, uv).rgb;
  float tot = 1.0;
  float radius = RAD_SCALE;
  vec2 dir = vec2(1.0, 0.0);
  for (int i = 0; i < 64; i++) {
    if (radius >= uMaxBlur) break;
    vec2 tc = uv + dir * radius * uPxScale / uResolution;
    vec3 sampleColor = texture2D(tScene, tc).rgb;
    float sampleDepth = viewDepth(tc);
    float sampleSize = blurSize(sampleDepth);
    if (sampleDepth > centerDepth) sampleSize = clamp(sampleSize, 0.0, centerSize * 2.0);
    float m = smoothstep(radius - 0.5, radius + 0.5, sampleSize);
    color += mix(color / tot, sampleColor, m);
    tot += 1.0;
    radius += RAD_SCALE / radius;
    dir = GOLDEN * dir;
  }
  return color / tot;
}

// the film jumps in its gate (the frame is enlarged just enough that its edge is never seen), the lens bulges
vec2 throughGate(vec2 uv, float aspect) {
  uv = 0.5 + (uv - 0.5) * uGate.z + uGate.xy;
  vec2 d = uv - 0.5;
  vec2 a = d * vec2(aspect, 1.0);
  return 0.5 + d * (1.0 + uLens.x * dot(a, a) * uLens.y) * uLens.z;
}

// red and blue part ways toward the edge; the middle of the frame needs one look only
vec3 splitScene(vec2 uv, float aspect) {
  vec2 d = uv - 0.5;
  vec2 a = d * vec2(aspect, 1.0);
  float r2 = dot(a, a) * uLens.y;
  if (r2 < uAberrationFrom) return textureLod(tScene, uv, 0.0).rgb;
  vec2 off = d * r2 * uAberration;
  return vec3(textureLod(tScene, uv + off, 0.0).r, textureLod(tScene, uv, 0.0).g, textureLod(tScene, uv - off, 0.0).b);
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 uv = uLensOn > 0.0 ? throughGate(vUv, aspect) : vUv;
  vec3 c = (uAperture > 0.0 || uSoft > 0.0) ? depthOfField(uv) : uAberration > 0.0 ? splitScene(uv, aspect) : texture2D(tScene, uv).rgb;
  // light that stays on the film, and light that spills in the lens; a cut-in picture replaces it all
  // (no mipmaps anywhere here: an explicit level keeps these branches real branches on Direct3D, so what rests costs nothing)
  if (uGhost > 0.0) c = max(c, textureLod(tGhost, uv, 0.0).rgb * uGhost);
  if (uBloom > 0.0) c += textureLod(tBloom, uv, 0.0).rgb * uBloomTint * uBloom;
  if (uInsertMix > 0.0) c = mix(c, textureLod(tInsert, 0.5 + (uv - 0.5) * uInsertScale, 0.0).rgb, uInsertMix);
  c += paperSheenLight(vUv, aspect, uSheenOffset, uSheen);
  c = applyGrade(c * uExposure * (1.0 + uFlash), uGradeA, uGradeB);
  c = agxToneMap(c);
  c = linearToSRGB(c);
  if (uNegative > 0.0) c = mix(c, 1.0 - c, uNegative);
  if (uBlack > 0.0) c *= 1.0 - uBlack;
  if (uWhite > 0.0) c = mix(c, vec3(1.0), uWhite);
  if (uScratches > 0.0) c = filmDamage(c, uv, aspect);
  if (uBurn > 0.0) c = filmBurn(c, uv, aspect);
  vec2 v = (vUv - 0.5) * vec2(aspect, 1.0);
  c *= 1.0 - uVignette * smoothstep(0.35 - uTunnel, 1.05 - uTunnel, length(v));
  float n = hash12(gl_FragCoord.xy + fract(uTime * 7.13) * 917.0) - 0.5;
  if (uClump > 0.0) n += (hash12(floor(gl_FragCoord.xy * 0.5) + fract(uTime * 3.71) * 613.0) - 0.5) * uClump;
  float l = luma(c);
  c += n * uGrain * (0.35 + 0.65 * (1.0 - l)) + (hash12(gl_FragCoord.yx) - 0.5) / 255.0;
  c *= 1.0 - uFade;
  if (uBlack >= 1.0) c = vec3(0.0);
  gl_FragColor = vec4(c, 1.0);
}
`;

/** What glows: four taps over the pixels under this one, what lies above the threshold, with a soft knee. */
const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform vec2 uTexel;
uniform float uFrom;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tScene, vUv + uTexel * vec2(-1.0, -1.0)).rgb
    + texture2D(tScene, vUv + uTexel * vec2(1.0, -1.0)).rgb
    + texture2D(tScene, vUv + uTexel * vec2(-1.0, 1.0)).rgb
    + texture2D(tScene, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float peak = max(c.r, max(c.g, c.b));
  // a broken pixel (NaN, infinity) must not swell into a square
  if (!(peak < 1e5)) {
    c = vec3(0.0);
    peak = 0.0;
  }
  float knee = uFrom * 0.5;
  float soft = clamp(peak - uFrom + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  c *= max(soft, peak - uFrom) / max(peak, 1e-4);
  gl_FragColor = vec4(min(c, vec3(${bloomConfig.limit.toFixed(1)})), 1.0);
}
`;

/** One direction of a Gaussian, thirteen taps in seven fetches. */
const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSource, vUv).rgb * 0.1964825501511404;
  c += (texture2D(tSource, vUv + uStep * 1.411764705882353).rgb + texture2D(tSource, vUv - uStep * 1.411764705882353).rgb) * 0.2969069646728344;
  c += (texture2D(tSource, vUv + uStep * 3.2941176470588234).rgb + texture2D(tSource, vUv - uStep * 3.2941176470588234).rgb) * 0.09447039785044732;
  c += (texture2D(tSource, vUv + uStep * 5.176470588235294).rgb + texture2D(tSource, vUv - uStep * 5.176470588235294).rgb) * 0.010381362401148057;
  gl_FragColor = vec4(c, 1.0);
}
`;

/** The levels together, on the dirt of the lens. */
const MERGE_FRAG = /* glsl */ `
uniform sampler2D tTight;
uniform sampler2D tWide;
uniform sampler2D tDamage;
uniform vec3 uTight;
uniform float uWide;
uniform vec2 uDirtScale;
uniform float uDirt;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tTight, vUv).rgb * uTight + texture2D(tWide, vUv).rgb * uWide;
  gl_FragColor = vec4(c * (1.0 + uDirt * (texture2D(tDamage, vUv * uDirtScale).r - 0.2)), 1.0);
}
`;

/** The long exposure: the brightest of now and of what is left of before. */
const GHOST_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBefore;
uniform float uKeep;
uniform float uDrift;
varying vec2 vUv;
void main() {
  vec3 now = texture2D(tScene, vUv).rgb;
  // it would stay in the history for good
  if (!(dot(now, vec3(1.0)) < 1e5)) now = vec3(0.0);
  gl_FragColor = vec4(max(now, texture2D(tBefore, 0.5 + (vUv - 0.5) * uDrift).rgb * uKeep), 1.0);
}
`;

/** A stateless random number per film frame (0..1): a paused film repeats the same frame exactly. */
function filmRandom(a: number, b: number, c = 0): number {
  let t = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b) ^ Math.imul(c + 1, 0xc2b2ae35);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The exposure's own waver, -1..1: only slow sines (0.31 to 2.3 Hz), so it can never flash. */
const filmWaver = (t: number): number => 0.4 * Math.sin(t * 1.95) + 0.3 * Math.sin(t * 4.59 + 1.1) + 0.2 * Math.sin(t * 8.6 + 2.3) + 0.1 * Math.sin(t * 14.45 + 0.7);

/** One hair, as a walk from its root (at the bottom middle of its cell), fitted into the cell. */
function drawHair(ctx: CanvasRenderingContext2D, h: (typeof damageConfig.hairs)[number], left: number, bottom: number, cell: number): void {
  const { hairSteps: steps, hairStrokes: strokes, hairWidth: width } = damageConfig;
  const xs: number[] = [];
  const ys: number[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const heading = -Math.PI / 2 + h.lean + h.sway * (Math.sin(t * h.waves * Math.PI * 2 + h.phase) - Math.sin(h.phase)) + h.curl * t ** h.power + h.fine * Math.sin(t * 31 + h.phase * 3) * Math.sin(t * 7.3 + h.phase);
    xs.push(x);
    ys.push(y);
    x += Math.cos(heading);
    y += Math.sin(heading);
  }
  const k = Math.min((0.47 * cell) / Math.max(-Math.min(...xs), Math.max(...xs)), (0.95 * cell) / -Math.min(...ys));
  // thinning toward the free end
  for (let s = 0; s < strokes; s++) {
    ctx.lineWidth = lerp(width[0], width[1], s / (strokes - 1));
    ctx.beginPath();
    const from = Math.floor((s / strokes) * steps);
    const to = Math.floor(((s + 1) / strokes) * steps);
    for (let i = from; i <= to; i++) {
      const px = left + cell / 2 + xs[i] * k;
      const py = bottom + ys[i] * k;
      if (i === from) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

/** Dirt on the lens (red), dust and lint on the film (green), hairs in the gate (blue). Drawn once. */
function drawDamage(): CanvasTexture {
  const D = damageConfig;
  const size = D.size;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  const random = randomFrom(D.seed);
  const anywhere = () => random() * size;

  // what sits on the lens builds up
  ctx.globalCompositeOperation = 'lighter';
  const smudge = (radius: number, middle: number, rim: number, rimAt: number) => {
    const x = anywhere();
    const y = anywhere();
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, `rgba(255,0,0,${middle})`);
    g.addColorStop(rimAt, `rgba(255,0,0,${rim})`);
    g.addColorStop(1, 'rgba(255,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };
  for (let i = 0; i < D.smears; i++) {
    const a = 0.04 + random() * 0.12;
    smudge((0.06 + random() * 0.16) * size, a, a * 0.6, 0.5);
  }
  // dust out of focus on the glass: soft discs, brighter at their rims
  for (let i = 0; i < D.motes; i++) {
    const a = 0.12 + random() * 0.3;
    smudge(6 + random() ** 2 * 30, a * 0.65, a, 0.82);
  }

  // everything else keeps to its own channel, over what is there
  ctx.globalCompositeOperation = 'lighten';
  const inside = () => D.margin + random() * (size - 2 * D.margin);
  ctx.fillStyle = 'rgb(0,255,0)';
  for (let i = 0; i < D.specks; i++) {
    const r = 0.7 + random() ** 3 * 2.4;
    ctx.beginPath();
    ctx.ellipse(inside(), inside(), r, r * (0.45 + random() * 0.55), random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgb(0,255,0)';
  ctx.lineCap = 'round';
  for (let i = 0; i < D.fibres; i++) {
    const x = inside();
    const y = inside();
    const a = random() * Math.PI * 2;
    const length = 12 + random() ** 2 * 70;
    const bend = (random() - 0.5) * length;
    ctx.lineWidth = 0.8 + random() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * length * 0.5 - Math.sin(a) * bend, y + Math.sin(a) * length * 0.5 + Math.cos(a) * bend, x + Math.cos(a) * length, y + Math.sin(a) * length);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgb(0,0,255)';
  const cell = size / 2;
  D.hairs.forEach((hair, n) => drawHair(ctx, hair, (n % 2) * cell, size - (n >> 1) * cell, cell));

  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

/** A full-screen pass of its own. */
const passMaterial = (fragmentShader: string, uniforms: ShaderMaterial['uniforms']) =>
  new ShaderMaterial({ vertexShader: FULLSCREEN_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });

/** A small target of a pass: linear light, no depth. */
const passTarget = () => new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });

/**
 * One HDR scene pass, an optional portal pass (the world seen through the photograph), one composite pass
 * (DOF, grade, AgX, film, grain) and, only while the nightmare asks for them, a few small passes that feed it:
 * the glow and the long exposure. One shader with cheap branches: nothing recompiles on the way, and with every
 * effect at rest the composite is exactly what it would be without them.
 */
export class Pipeline {
  readonly renderer: WebGLRenderer;
  readonly sceneRT: WebGLRenderTarget;
  readonly portalRT: WebGLRenderTarget;
  readonly size = new Vector2();
  pixelRatio: number;

  private readonly composite: ShaderMaterial;
  private readonly screen: Scene;
  private readonly quad: Mesh;
  private readonly screenCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private readonly brightRT = passTarget();
  private readonly tightH = passTarget();
  private readonly tightV = passTarget();
  private readonly wideH = passTarget();
  private readonly wideV = passTarget();
  private readonly bloomRT = passTarget();
  private readonly brightPass: ShaderMaterial;
  private readonly blurPass: ShaderMaterial;
  private readonly mergePass: ShaderMaterial;
  private ghostRead = passTarget();
  private ghostWrite = passTarget();
  private readonly ghostPass: ShaderMaterial;
  /** The history holds the last frames: it is seeded afresh whenever the long exposure starts. */
  private ghostLive = false;
  /** The beat, as the vignette feels it. */
  private breath = 0;
  private lastPresent = 0;
  private lastFilm = 0;

  private frameTimes: number[] = [];
  private sampleClock = 0;
  /** How much this graphics card is given to draw (see renderConfig.high). */
  readonly tier: 'high' | 'normal';
  private readonly quality: { maxPixelRatio: number; maxPixels: number; msaaSamples: number; denseSamples: number };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      // the canvas only ever receives the full-screen composite
      depth: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    // shader logs are a development aid; production skips the (costly, noisy) program checks
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    this.renderer.info.autoReset = false;

    this.tier = Pipeline.strongCard(this.renderer) ? 'high' : 'normal';
    this.quality = this.tier === 'high' ? { ...renderConfig, ...renderConfig.high } : renderConfig;
    this.pixelRatio = this.maxRatio(window.innerWidth, window.innerHeight);

    const rtOptions = { type: HalfFloatType, samples: this.quality.msaaSamples };
    this.sceneRT = new WebGLRenderTarget(1, 1, { ...rtOptions, depthTexture: new DepthTexture(1, 1) });
    this.portalRT = new WebGLRenderTarget(1, 1, rtOptions);
    this.portalRT.resolveDepthBuffer = false;

    const damage = drawDamage();
    this.composite = new ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.sceneRT.texture },
        tDepth: { value: this.sceneRT.depthTexture },
        uResolution: { value: new Vector2() },
        uNear: { value: 0.1 },
        uFar: { value: 100 },
        uFocus: { value: 10 },
        uAperture: { value: 0 },
        uSoft: { value: 0 },
        uMaxBlur: { value: DOF_REFERENCE_HEIGHT * renderConfig.dofMaxBlur },
        uPxScale: { value: 1 },
        uGradeA: { value: null },
        uGradeB: { value: null },
        uExposure: { value: 1 },
        uVignette: { value: 0 },
        uGrain: { value: 0 },
        uFade: { value: 1 },
        uFlash: { value: 0 },
        uSheen: { value: 0 },
        uSheenOffset: { value: 0 },
        uTime: { value: 0 },
        tBloom: { value: this.bloomRT.texture },
        tGhost: { value: this.ghostRead.texture },
        tInsert: { value: null },
        tDamage: { value: damage },
        uLensOn: { value: 0 },
        uGate: { value: new Vector3(0, 0, 1) },
        uLens: { value: new Vector3(0, 1, 1) },
        uAberration: { value: 0 },
        uAberrationFrom: { value: 0 },
        uGhost: { value: 0 },
        uBloom: { value: 0 },
        uBloomTint: { value: new Color(1, 1, 1) },
        uInsertMix: { value: 0 },
        uInsertScale: { value: new Vector2(1, 1) },
        uNegative: { value: 0 },
        uBlack: { value: 0 },
        uWhite: { value: 0 },
        uScratches: { value: 0 },
        uTunnel: { value: 0 },
        uClump: { value: 0 },
        uScratch: { value: new Float32Array(FILM_SCRATCHES * 4) },
        uDust: { value: new Vector4() },
        uHair: { value: new Vector4() },
        uHairPose: { value: new Vector3(0, -1, 1) },
        uHairCell: { value: new Vector2() },
        uBurn: { value: 0 },
        uBurnFrom: { value: new Vector3(filmConfig.burnFrom[0], filmConfig.burnFrom[1], 1) },
        uFilmTime: { value: 0 },
      },
    });
    this.brightPass = passMaterial(BRIGHT_FRAG, {
      tScene: { value: this.sceneRT.texture },
      uTexel: { value: new Vector2() },
      uFrom: { value: 1 },
    });
    this.blurPass = passMaterial(BLUR_FRAG, {
      tSource: { value: this.brightRT.texture },
      uStep: { value: new Vector2() },
    });
    this.mergePass = passMaterial(MERGE_FRAG, {
      tTight: { value: this.tightV.texture },
      tWide: { value: this.wideV.texture },
      tDamage: { value: damage },
      uTight: { value: new Vector3(...bloomConfig.tight) },
      uWide: { value: bloomConfig.wide },
      uDirtScale: { value: new Vector2(1, 1) },
      uDirt: { value: bloomConfig.dirt },
    });
    this.ghostPass = passMaterial(GHOST_FRAG, {
      tScene: { value: this.sceneRT.texture },
      tBefore: { value: this.ghostRead.texture },
      uKeep: { value: 0 },
      uDrift: { value: 1 },
    });
    const tri = new BufferGeometry();
    tri.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new Mesh(tri, this.composite);
    this.quad.frustumCulled = false;
    this.screen = new Scene();
    this.screen.add(this.quad);
    this.warm();
  }

  /** Every program is linked and used once now: the first frame that needs the glow must not stop to build it. */
  private warm(): void {
    this.renderer.compile(this.screen, this.screenCamera);
    this.draw(this.brightPass, this.brightRT);
    this.draw(this.blurPass, this.tightH);
    this.draw(this.mergePass, this.bloomRT);
    this.draw(this.ghostPass, this.ghostWrite);
    this.quad.material = this.composite;
    this.renderer.setRenderTarget(null);
  }

  /** One full-screen pass into a target (null: the screen). */
  private draw(material: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.screen, this.screenCamera);
  }

  /** Highest pixel ratio allowed for a screen: device density, the cap, and the pixel budget (of this card's tier). */
  private maxRatio(width: number, height: number): number {
    const budget = Math.sqrt(this.quality.maxPixels / Math.max(1, width * height));
    return Math.min(window.devicePixelRatio, this.quality.maxPixelRatio, budget);
  }

  /** Whether this graphics card is a strong one (see renderConfig.high): by its name, unless the address says otherwise. */
  private static strongCard(renderer: WebGLRenderer): boolean {
    const asked = new URLSearchParams(window.location.search).get('quality');
    if (asked === 'high' || asked === 'normal') return asked === 'high';
    const gl = renderer.getContext();
    // most browsers name the card themselves now; Chrome and Safari still hide it behind an extension (which
    // Firefox would warn about, so it is only asked for when needed)
    let name = String(gl.getParameter(gl.RENDERER));
    if (/webkit webgl/i.test(name)) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    }
    return STRONG_CARD.test(name) && !WEAK_CARD.test(name);
  }

  setSize(width: number, height: number): void {
    this.size.set(width, height);
    this.pixelRatio = Math.min(this.pixelRatio, this.maxRatio(width, height));
    // dense screens hide aliasing: fewer samples there (both targets equal, so the hand-off stays exact)
    const samples = this.pixelRatio >= renderConfig.denseRatio ? this.quality.denseSamples : this.quality.msaaSamples;
    for (const rt of [this.sceneRT, this.portalRT]) {
      if (rt.samples !== samples) {
        rt.samples = samples;
        rt.dispose();
      }
    }
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    const w = Math.max(1, Math.floor(width * this.pixelRatio));
    const h = Math.max(1, Math.floor(height * this.pixelRatio));
    this.sceneRT.setSize(w, h);
    this.portalRT.setSize(w, h);
    const u = this.composite.uniforms;
    u.uResolution.value.set(w, h);
    u.uPxScale.value = h / DOF_REFERENCE_HEIGHT;
    this.sizePasses(w, h);
  }

  /** The small passes at their shares of the drawing buffer, allocated now and not on the way. */
  private sizePasses(w: number, h: number): void {
    const u = this.composite.uniforms;
    const aspect = w / h;
    const longest = Math.max(w, h);
    const fit = (rt: WebGLRenderTarget, share: number) => {
      rt.setSize(Math.max(1, Math.round(w * share)), Math.max(1, Math.round(h * share)));
      this.renderer.initRenderTarget(rt);
    };
    const bright = Math.min(bloomConfig.share, bloomConfig.maxSide / longest);
    fit(this.brightRT, bright);
    for (const rt of [this.tightH, this.tightV, this.bloomRT]) fit(rt, bright / 2);
    for (const rt of [this.wideH, this.wideV]) fit(rt, bright / 4);
    const ghost = Math.min(ghostConfig.share, ghostConfig.maxSide / longest);
    const historyWidth = this.ghostRead.width;
    const historyHeight = this.ghostRead.height;
    for (const rt of [this.ghostRead, this.ghostWrite]) fit(rt, ghost);
    // a target that was resized has lost what it held
    if (this.ghostRead.width !== historyWidth || this.ghostRead.height !== historyHeight) this.ghostLive = false;
    this.brightPass.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.mergePass.uniforms.uDirtScale.value.set(aspect * bloomConfig.dirtScale, bloomConfig.dirtScale);
    u.uLens.value.y = 1 / (0.25 * (aspect * aspect + 1));
    // a square picture, cropped to cover the frame
    u.uInsertScale.value.set(Math.min(1, aspect), Math.min(1, 1 / aspect));
    const [bx, by] = filmConfig.burnFrom;
    u.uBurnFrom.value.z = 1 / Math.hypot(Math.max(bx, 1 - bx) * aspect, Math.max(by, 1 - by));
  }

  /** Drawing-buffer resolution in device pixels. */
  get resolution(): Vector2 {
    return this.composite.uniforms.uResolution.value;
  }

  renderTo(target: WebGLRenderTarget | null, scene: Scene, camera: Camera): void {
    this.renderer.setRenderTarget(target);
    this.renderer.render(scene, camera);
  }

  /**
   * Make the programs `root` needs before it is first drawn (lit as `scene` is, or as itself). A program is made
   * for the place it draws into, and the scene only ever draws into linear targets (the screen gets the composite):
   * so one of those stands as the target while they are made. Made for the screen they would never be used, and
   * each would be made a second time at its first frame, while everything waits.
   */
  compileScene(root: Object3D, camera: Camera, scene: Scene | null = null): Promise<unknown> {
    const target = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.sceneRT);
    const made = this.renderer.compileAsync(root, camera, scene);
    this.renderer.setRenderTarget(target);
    return made;
  }

  /** The glow: only while it is asked for. Everything before the grade: light spilling in the lens. */
  private drawBloom(fx: DreamFx): void {
    const tight = bloomConfig.stride[0];
    const wide = bloomConfig.stride[1];
    this.brightPass.uniforms.uFrom.value = Math.max(1e-3, fx.bloomFrom);
    this.draw(this.brightPass, this.brightRT);
    this.blur(this.brightRT, this.tightH, tight / this.tightH.width, 0);
    this.blur(this.tightH, this.tightV, 0, tight / this.tightV.height);
    this.blur(this.tightV, this.wideH, wide / this.wideH.width, 0);
    this.blur(this.wideH, this.wideV, 0, wide / this.wideV.height);
    this.draw(this.mergePass, this.bloomRT);
  }

  private blur(from: WebGLRenderTarget, to: WebGLRenderTarget, x: number, y: number): void {
    const b = this.blurPass.uniforms;
    b.tSource.value = from.texture;
    b.uStep.value.set(x, y);
    this.draw(this.blurPass, to);
  }

  /** The long exposure: only while it is asked for. It starts from the frame it starts on, and runs on the film's clock: paused, it holds. */
  private drawGhost(fx: DreamFx): void {
    const g = this.ghostPass.uniforms;
    const dt = Math.max(0, fx.film - this.lastFilm);
    const tau = ghostConfig.seconds * fx.ghost * fx.ghost;
    g.tBefore.value = this.ghostRead.texture;
    g.uKeep.value = this.ghostLive ? Math.exp(-dt / Math.max(tau, 1e-3)) : 0;
    g.uDrift.value = 1 - ghostConfig.drift * fx.ghost * dt;
    this.draw(this.ghostPass, this.ghostWrite);
    const written = this.ghostWrite;
    this.ghostWrite = this.ghostRead;
    this.ghostRead = written;
    this.ghostLive = true;
  }

  /** The film, this frame: scratches, dust and whether a hair is caught in the gate. All of it follows from the film's clock. */
  private writeDamage(fx: DreamFx, frame: number): void {
    const u = this.composite.uniforms;
    const amount = fx.scratches;
    u.uScratches.value = amount;
    if (amount <= 0) return;
    const F = filmConfig;
    const S = F.scratch;
    const film = fx.film;
    const scratch = u.uScratch.value as Float32Array;
    const thinnest = S.pixels / u.uResolution.value.x;
    for (let i = 0; i < FILM_SCRATCHES; i++) {
      const period = lerp(S.period[0], S.period[1], filmRandom(i, 0, 1));
      const cycle = Math.floor(film / period + filmRandom(i, 0, 2));
      const k = i * 4;
      if (filmRandom(i, cycle, 3) > amount * S.share) {
        scratch[k + 2] = 0;
        continue;
      }
      scratch[k] = filmRandom(i, cycle, 4) + Math.sin(film * S.driftRate + i) * S.drift + (filmRandom(i, frame, 5) - 0.5) * S.jitter;
      scratch[k + 1] = Math.max(thinnest, lerp(S.width[0], S.width[1], filmRandom(i, cycle, 6) ** 2));
      scratch[k + 2] = lerp(S.strength[0], S.strength[1], filmRandom(i, cycle, 7)) * Math.min(1, amount * S.rise) * (filmRandom(i, cycle, 8) < S.dark ? -1 : 1);
      scratch[k + 3] = filmRandom(i, cycle, 9) * Math.PI * 2;
    }
    u.uDust.value.set(filmRandom(11, frame), filmRandom(12, frame), Math.min(1, amount * F.dust), filmRandom(13, frame));

    const H = F.hair;
    const hair = u.uHair.value as Vector4;
    const visit = Math.floor(film / H.period);
    const stays = lerp(H.stay[0], H.stay[1], filmRandom(21, visit, 1));
    if (filmRandom(21, visit) > amount * H.chance || film / H.period - visit > stays) {
      hair.w = 0;
      return;
    }
    // in from the top or from a side, somewhere along that edge
    const edge = Math.floor(filmRandom(21, visit, 2) * 3);
    const along = lerp(0.12, 0.88, filmRandom(21, visit, 3));
    const heading = (edge === 0 ? -Math.PI / 2 : edge === 1 ? 0 : Math.PI) + (filmRandom(21, visit, 4) - 0.5) * H.lean;
    hair.set(
      (edge === 0 ? along : edge === 1 ? -0.01 : 1.01) + (filmRandom(22, frame) - 0.5) * H.shake,
      (edge === 0 ? 1.01 : along) + (filmRandom(23, frame) - 0.5) * H.shake,
      filmRandom(24, frame) * Math.PI * 2,
      H.strength,
    );
    u.uHairPose.value.set(Math.cos(heading), Math.sin(heading), lerp(H.size[0], H.size[1], filmRandom(21, visit, 5)));
    const which = Math.floor(filmRandom(21, visit, 6) * damageConfig.hairs.length);
    u.uHairCell.value.set(which % 2, which >> 1);
  }

  /** Everything the nightmare asks of the composite. With the fx at rest every value here leaves the picture exactly as it was. */
  private writeFx(state: CompositeState, dt: number): void {
    const fx = state.fx;
    const u = this.composite.uniforms;
    const F = filmConfig;
    const frame = Math.floor(fx.film * F.fps);

    u.uExposure.value = state.exposure * (1 + fx.flicker * filmWaver(fx.film)) * (1 - fx.dip);

    const lens = fx.weave > 0 || fx.barrel !== 0;
    u.uLensOn.value = lens ? 1 : 0;
    if (lens) {
      const w = F.weave;
      u.uGate.value.set(
        fx.weave * w.sideways * (w.wander * wobble(fx.film * 1.7, 1) + w.jump * (filmRandom(1, frame) * 2 - 1)),
        fx.weave * (w.wander * wobble(fx.film * 1.3, 2) + w.jump * (filmRandom(2, frame) * 2 - 1)),
        1 - 2 * fx.weave,
      );
      u.uLens.value.x = fx.barrel;
      u.uLens.value.z = 1 / (1 + Math.max(0, fx.barrel));
    }
    u.uAberration.value = fx.aberration;
    u.uAberrationFrom.value = fx.aberration > 0 ? Math.pow(F.splitFrom / (fx.aberration * u.uResolution.value.x), 2 / 3) : 0;

    u.uBloom.value = fx.bloom;
    u.uBloomTint.value = fx.bloomTint;
    u.tGhost.value = this.ghostRead.texture;
    u.uGhost.value = fx.ghost > 0 ? ghostConfig.gain * Math.min(1, fx.ghost / ghostConfig.fadeIn) : 0;

    u.tInsert.value = fx.insert;
    u.uInsertMix.value = fx.insert ? fx.insertMix : 0;
    u.uNegative.value = fx.negative;
    u.uBlack.value = fx.black;
    u.uWhite.value = fx.white;
    u.uBurn.value = fx.burn;
    u.uFilmTime.value = fx.film;
    this.writeDamage(fx, frame);

    const D = dreadConfig;
    this.breath = fx.fear > 0 ? damp(this.breath, fx.heartbeat, D.beatRate, dt) : 0;
    u.uVignette.value = state.vignette + fx.fear * D.vignette.fear + this.breath * D.vignette.beat;
    u.uTunnel.value = fx.fear * D.tunnel.fear + this.breath * D.tunnel.beat;
    const grain = fx.grain + fx.fear * D.grain;
    u.uGrain.value = state.grain * (1 + grain);
    u.uClump.value = Math.min(D.clumpMost, grain * D.clump);
  }

  present(camera: PerspectiveCamera, state: CompositeState, time: number): void {
    const fx = state.fx;
    const dt = Math.max(0, time - this.lastPresent);
    this.lastPresent = time;
    if (fx.bloom > 0) this.drawBloom(fx);
    if (fx.ghost > 0) this.drawGhost(fx);
    else this.ghostLive = false;
    this.lastFilm = fx.film;
    const u = this.composite.uniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uFocus.value = Math.max(0.01, state.focus);
    u.uAperture.value = state.aperture;
    // only the depth of field reads the scene's depth: skip its resolve otherwise
    this.sceneRT.resolveDepthBuffer = state.aperture > 0 || state.soft > 0;
    u.uSoft.value = state.soft;
    u.uGradeA.value = state.grade.A;
    u.uGradeB.value = state.grade.b;
    u.uFade.value = state.fade;
    u.uFlash.value = state.flash;
    u.uSheen.value = state.sheen;
    u.uSheenOffset.value = state.sheenOffset;
    u.uTime.value = time;
    this.writeFx(state, dt);
    this.draw(this.composite, null);
  }

  /** Adaptive resolution keeps the frame rate stable on weaker GPUs (only when `allowed`). */
  adapt(dt: number, allowed: boolean): void {
    if (!allowed) {
      this.frameTimes = [];
      this.sampleClock = 0;
      return;
    }
    this.frameTimes.push(dt);
    this.sampleClock += dt;
    const cfg = renderConfig.adaptive;
    if (this.sampleClock < cfg.sampleSeconds) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    this.sampleClock = 0;
    const fps = 1 / avg;
    const max = this.maxRatio(this.size.x, this.size.y);
    let next = this.pixelRatio;
    // step down in proportion to how slow it is, up gently
    if (fps < cfg.lowFps) next = Math.max(renderConfig.minPixelRatio, this.pixelRatio * clamp(Math.sqrt(fps / cfg.highFps), 0.75, 0.95));
    else if (fps > cfg.highFps) next = Math.min(max, this.pixelRatio + cfg.step * 0.5);
    if (Math.abs(next - this.pixelRatio) < 1e-3) return;
    this.pixelRatio = next;
    this.setSize(this.size.x, this.size.y);
  }
}
