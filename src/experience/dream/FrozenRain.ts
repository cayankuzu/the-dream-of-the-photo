import {
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  SpotLight,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  type Camera,
  type PointLight,
  type WebGLRenderer,
} from 'three';
import { REDUCED_MOTION } from '../../config/experience.config';
import { dreamConfig } from '../../config/dream.config';
import { lerp, range, smootherstep } from '../math';
import { WARP_GLSL, warpUniforms } from '../render/Warp';
import type { DreamKit } from './DreamKit';
import { randomFrom } from './FigureKit';

const R = dreamConfig.rain;
const H = R.hair;

/** Fixed seed: the photograph and the world must hold exactly the same drops. */
const SEED = 0x2f6b1d;
/** Others for the hair, so that nothing it asks of chance can move a drop. */
const HAIR_SEED = 0x51a7c3;
const LOCK_SEED = 0x7713f1;
/** Per-drop variation: streak length (± share), lean from vertical (max rad), brightness range, fall speed (± share). */
const LENGTH_JITTER = 0.35;
const LEAN = 0.045;
const GLINT = [0.6, 1.3] as const;
const SPEED_JITTER = 0.18;
/** A streak thinner or shorter on screen than this (px) is drawn at this size and dimmed as much, so it cannot shimmer. */
const MIN_WIDTH_PX = 1.4;
const MIN_LENGTH_PX = 2.5;
/** Most a streak seen end-on is lengthened to reach MIN_LENGTH_PX. */
const MAX_STRETCH = 6;
/** Share of a streak's length that tapers at either end. */
const TAPER = 0.3;
/** Share of a drop's light that adds to what is behind it instead of covering it (water lets light through). */
const ADDITIVE = 0.3;
/** A falling drop smears over about one frame of the eye (s). */
const SMEAR = 1 / 60;
/** Soft top and bottom of the rain (m): drops dissolve there, and falling ones wrap there unseen. */
const CEILING_FADE = 1.6;
const FLOOR_FADE = 0.12;
/** The far end of the rain thins out over this depth (m) instead of stopping at a plane you can see coming. */
const FAR_FADE = 4;
/** Drops nearer to the lens than this (m) dissolve: they would be large unfocused blurs. */
const NEAR_FADE = [0.12, 0.4] as const;
/** A waking drop replays a stretch of its fall; each replay dissolves over this share of it at both ends... */
const LOOP_FADE = 0.15;
/** ...from this much waking (below it the replay is too short to see) until this close to fully awake. */
const WAKE_EDGES = [0.01, 0.03] as const;
/** Lamps whose light the strands catch at once (the nearest of the dream's spots and pool). */
const MAX_LAMPS = 8;
/**
 * Water drops: share of the light they send on, how strongly forward (Henyey-Greenstein g), and the
 * closest a lamp counts as (m), so a drop touching the glass does not blaze.
 */
const DROP_ALBEDO = 0.08;
const FORWARD = 0.55;
const LAMP_NEAR = 0.5;
/** Keeps a hard-edged spot cone's smoothstep edges apart. */
const CONE_EPSILON = 1e-4;
/** Share of a strand on either side of a vertex used to find which way it runs there. */
const TANGENT_STEP = 0.02;
const TAU = Math.PI * 2;

/** A number as a GLSL float literal. */
const glf = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);

const CONSTANTS = /* glsl */ `
#define MAX_LAMPS ${MAX_LAMPS}
const float MIN_WIDTH_PX = ${glf(MIN_WIDTH_PX)};
const float MIN_LENGTH_PX = ${glf(MIN_LENGTH_PX)};
const float MAX_STRETCH = ${glf(MAX_STRETCH)};
const float TAPER = ${glf(TAPER)};
const float ADDITIVE = ${glf(ADDITIVE)};
const float SMEAR = ${glf(SMEAR)};
const vec2 NEAR_FADE = vec2(${glf(NEAR_FADE[0])}, ${glf(NEAR_FADE[1])});
const float LOOP_FADE = ${glf(LOOP_FADE)};
const vec2 WAKE_EDGES = vec2(${glf(WAKE_EDGES[0])}, ${glf(WAKE_EDGES[1])});
const float DROP_ALBEDO = ${glf(DROP_ALBEDO)};
const float FORWARD = ${glf(FORWARD)};
const float LAMP_NEAR = ${glf(LAMP_NEAR)};
const float TANGENT_STEP = ${glf(TANGENT_STEP)};
const float GROW_SHARE = ${glf(H.growShare)};
const float GATHER = ${glf(H.locks.gather)};
const float TIP_TAPER = ${glf(H.shape.tipTaper)};
const float ROOT_THIN = ${glf(H.shape.rootThin)};
const float ROOT_DARK = ${glf(H.shape.rootDark)};
const float HAIR_TIP = ${glf(H.shape.tipFade)};
const float FIBRES = ${glf(H.shape.fibres)};
const vec2 HAIR_NEAR = vec2(${glf(H.shape.nearFade[0])}, ${glf(H.shape.nearFade[1])});
const float WAVE_RATE = ${glf(H.wave.rate)};
const float CURL_RATE = ${glf(H.wave.curl)};
const float WIND_ALONG = ${glf(H.wind.along)};
const float WIND_ACROSS = ${glf(H.wind.across)};
const float WIND_SPEED = ${glf(H.wind.speed)};
const float WIND_LAG = ${glf(H.wind.lag)};
const float WIND_LOCK = ${glf(H.wind.lock)};
const float WIND_SIDE = ${glf(H.wind.side)};
const float WIND_SECOND = ${glf(H.wind.second)};
const float PART_FLAT = ${glf(H.part.flat)};
const float PART_TAIL = ${glf(H.part.tail)};
const float FALL_RATE = ${glf(H.fall.rate)};
const float FALL_FROM = ${glf(H.fall.from)};
const float FALL_BLEND = ${glf(H.fall.blend)};
const vec2 FALL_GONE = vec2(${glf(H.fall.gone[0])}, ${glf(H.fall.gone[1])});
const float FLOOR_Y = ${glf(H.fall.floor)};
const float FLOOR_LIE = ${glf(H.fall.lie)};
const float HAIR_DIFFUSE = ${glf(H.light.diffuse)};
const float HAIR_SHEEN = ${glf(H.light.sheen)};
const float SHINE = ${glf(H.light.shine)};
const float HAIR_ADDITIVE = ${glf(H.light.additive)};
const float HAIR_TINGE = ${glf(H.light.tinge)};
const float HAIR_LAMP_NEAR = ${glf(H.light.lampNear)};
`;

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${WARP_GLSL}
${CONSTANTS}
attribute vec4 aDrop;   // rest position, replay phase
attribute vec4 aShape;  // length scale, lean (x, z of the axis), glint
attribute float aSpeed; // fall speed scale
attribute vec4 aTip;    // hair: its free end (m), and when in the morph it starts to grow (0..1)
attribute vec4 aRoot;   // hair: what it hangs from (m), and its width (m)
attribute vec4 aSeed;   // hair: its lock's number, its own number (0..1), its share of the wind, its loose wave (m)

uniform vec3 uEye;      // the camera drawing this pass: parting, facing, and where time runs again
uniform float uTime;
uniform vec4 uRegion;   // bottom, height, ceiling fade, floor fade (m)
uniform vec2 uFarEnd;   // far end z, fade depth (m)
uniform vec2 uSize;     // width, length (m)
uniform vec4 uFall;     // from, blend, speed, on
uniform vec2 uPart;     // radius, push
uniform float uPixel;   // size of a pixel at unit depth
uniform vec3 uColor;
uniform float uOpacity;
uniform float uMorph;   // 0 = rain, 1 = every drop is a strand of hair
uniform float uDim;     // the light of the place (1 = as it is)
uniform vec3 uHairTint;   // its color
uniform float uHairGlow;  // what it shows with no lamp near
uniform float uHairOpacity;
uniform vec2 uHairPart; // radius, push
uniform vec2 uHairEnd;  // far end z where it is gone, where it is whole
uniform float uWind;    // sway of a free end per meter of strand
uniform int uLampCount;
uniform vec3 uLampPos[MAX_LAMPS];
uniform vec3 uLampColor[MAX_LAMPS];
uniform vec3 uLampDir[MAX_LAMPS];
uniform vec4 uLampCone[MAX_LAMPS]; // cos outer, cos inner, cutoff distance, decay

varying vec2 vUv;
varying float vAlpha;
varying vec3 vBase;
varying vec3 vCatch;
varying vec2 vHair;     // how much of it is hair, its own number

// A point of the strand: s is 0 at the free end, 1 at the root; slid is how far it has come down (m).
vec3 strand(float s, float slid) {
  float free = 1.0 - s;
  float span = aRoot.y - aTip.y;
  float along = s * span;
  // locks: every strand of one meets at a point, and spreads above it into hanging straight
  float gathered = 1.0 - min(s / GATHER, 1.0);
  vec2 spread = mix(aRoot.xz, aTip.xz, gathered * gathered);
  vec3 c = vec3(spread.x, mix(aTip.y, aRoot.y, s), spread.y);
  // a long loose wave, combed the same way through a whole lock, and a curl of its own where it ends
  float turn = along * WAVE_RATE * (0.7 + 0.6 * aSeed.x) + aSeed.x * 31.0 + aSeed.y * 0.7;
  c.xz += aSeed.w * free * vec2(sin(turn), cos(turn * 0.77 + aSeed.x * PI2));
  c.xz += aSeed.w * free * free * free * vec2(cos(along * CURL_RATE + aSeed.y * 17.0), sin(along * CURL_RATE));
  // the unseen wind: one slow wave down the whole alley, running down each strand; a lock moves as one
  float phase = aRoot.z * WIND_ALONG + aRoot.x * WIND_ACROSS - uTime * WIND_SPEED + s * WIND_LAG + aSeed.x * WIND_LOCK;
  float gust = sin(phase) + WIND_SECOND * sin(phase * 2.3 + 1.7);
  float sway = gust * uWind * span * aSeed.z * pow(free, 1.6);
  c.z += sway;
  c.x += sway * WIND_SIDE * sin(phase * 0.71 + aSeed.x * 4.0);
  // coming down, and what has reached the ground lies on it
  c.y -= slid;
  float under = FLOOR_Y - c.y;
  if (under > 0.0) {
    float lie = aSeed.y * PI2;
    c.y = FLOOR_Y;
    c.xz += vec2(cos(lie), sin(lie)) * under * FLOOR_LIE;
  }
  // no one walks through it: it bends aside around the eye, away from the line walked along, and is
  // slower to come back than to part
  vec3 toStrand = c - uEye;
  float lengthwise = toStrand.z < 0.0 ? toStrand.z : toStrand.z * PART_TAIL;
  float bend = 1.0 - smoothstep(0.0, uHairPart.x, length(vec3(toStrand.x, toStrand.y * PART_FLAT, lengthwise)));
  c.x += (aRoot.x + aSeed.y * 0.1 - 0.05 < 0.0 ? -1.0 : 1.0) * bend * uHairPart.y;
  return c;
}

void main() {
  float grow = smoothstep(aTip.w, aTip.w + GROW_SHARE, uMorph);
  vec3 lit = aDrop.xyz;
  vec3 axis = vec3(aShape.y, sqrt(max(1.0 - dot(aShape.yz, aShape.yz), 0.0)), aShape.z);
  vec3 tangent = axis;
  vec3 rainCorner = vec3(0.0);
  vec3 hairCorner = vec3(0.0);
  float rainAlpha = 0.0;
  float hairAlpha = 0.0;

  if (grow < 1.0) {
    vec3 p = aDrop.xyz;
    float height = uRegion.y;

    // behind the walker time runs again: over the blend the drops wake, replaying a growing stretch of
    // their fall (each replay dissolves where it restarts) until they simply fall, wrapping unseen
    float wake = uFall.w * smoothstep(0.0, 1.0, (p.z - uEye.z - uFall.x) / uFall.y);
    float loop = fract(uTime * uFall.z * aSpeed / height + aDrop.w);
    float h = fract((p.y - uRegion.x) / height - wake * loop) * height;
    p.y = uRegion.x + h;
    float replay = smoothstep(0.0, LOOP_FADE, loop) * (1.0 - smoothstep(1.0 - LOOP_FADE, 1.0, loop));
    float stutter = smoothstep(0.0, WAKE_EDGES.x, wake) * (1.0 - smoothstep(1.0 - WAKE_EDGES.y, 1.0, wake));
    rainAlpha = uOpacity * mix(1.0, replay, stutter);
    rainAlpha *= smoothstep(0.0, uRegion.w, h) * (1.0 - smoothstep(height - uRegion.z, height, h));
    rainAlpha *= smoothstep(uFarEnd.x, uFarEnd.x + uFarEnd.y, p.z);

    // nobody walks through a drop: near the walker they part, away from the line walked along
    vec3 toDrop = p - uEye;
    float parting = 1.0 - smoothstep(0.0, uPart.x, length(toDrop));
    float fallback = aDrop.w * PI2;
    vec2 away = dot(toDrop.xy, toDrop.xy) > 1e-8 ? normalize(toDrop.xy) : vec2(cos(fallback), sin(fallback));
    p.xy += away * (uPart.y * parting);

    // the streak: its own slight lean, smeared longer while it falls (the same light spread thinner)
    float rest = uSize.y * aShape.x;
    float len = rest + wake * uFall.z * aSpeed * SMEAR;
    rainAlpha *= rest / len;

    // turned about its own axis to face the camera drawing it
    vec3 toEye = normalize(uEye - p);
    vec3 across = cross(axis, toEye);
    float sinView = length(across);
    across = sinView > 1e-3 ? across / sinView : normalize(cross(axis, vec3(1.0, 0.0, 0.0)));

    // never thinner or shorter on screen than a pixel or two: drawn larger and dimmer instead
    float depth = max(-(modelViewMatrix * vec4(p, 1.0)).z, 1e-3);
    float pixel = depth * uPixel;
    float width = max(uSize.x, MIN_WIDTH_PX * pixel);
    float stretch = clamp(MIN_LENGTH_PX * pixel / (len * max(sinView, 1e-3)), 1.0, MAX_STRETCH);
    rainAlpha *= uSize.x / width / stretch * smoothstep(NEAR_FADE.x, NEAR_FADE.y, depth);
    len *= stretch;

    lit = p;
    rainCorner = p + across * (position.x * 0.5 * width) + axis * ((position.y - 0.5) * len);
  }

  if (grow > 0.0) {
    float s = position.y;
    // behind the walker it slowly comes down, and starts over where no one can see it start
    float wake = uFall.w * smoothstep(0.0, 1.0, (aDrop.z - uEye.z - FALL_FROM) / FALL_BLEND);
    float loop = fract(uTime * FALL_RATE * aSpeed + aDrop.w);
    float slid = wake * loop * aRoot.y;
    float replay = smoothstep(0.0, LOOP_FADE, loop) * (1.0 - smoothstep(1.0 - LOOP_FADE, 1.0, loop));

    vec3 a = strand(max(s - TANGENT_STEP, 0.0), slid);
    vec3 b = strand(min(s + TANGENT_STEP, 1.0), slid);
    vec3 q = 0.5 * (a + b);
    vec3 run = normalize(b - a);

    vec3 toEye = normalize(uEye - q);
    vec3 across = cross(run, toEye);
    float sinView = length(across);
    across = sinView > 1e-3 ? across / sinView : normalize(cross(run, vec3(1.0, 0.0, 0.0)));

    float wanted = aRoot.w * max(smoothstep(0.0, TIP_TAPER, s), 0.1) * mix(1.0, ROOT_THIN, s);
    float depth = max(-(modelViewMatrix * vec4(q, 1.0)).z, 1e-3);
    float width = max(wanted, MIN_WIDTH_PX * depth * uPixel);
    hairAlpha = uHairOpacity * mix(1.0, replay, smoothstep(0.0, WAKE_EDGES.x, wake)) * wanted / width;
    hairAlpha *= smoothstep(HAIR_NEAR.x, HAIR_NEAR.y, depth) * smoothstep(uHairEnd.x, uHairEnd.y, aDrop.z);
    // far enough behind the walker it has all come down, and is gone
    hairAlpha *= 1.0 - uFall.w * smoothstep(FALL_GONE.x, FALL_GONE.y, aDrop.z - uEye.z);

    hairCorner = q + across * (position.x * 0.5 * width);
    lit = mix(lit, q, grow);
    tangent = normalize(mix(axis, run, grow));
  }

  vec3 corner = mix(rainCorner, hairCorner, grow);
  vec4 mvPosition = modelViewMatrix * vec4(corner, 1.0);
  gl_Position = projectionMatrix * dreamWarp(mvPosition);
  #include <fog_vertex>

  // light caught from the lamps nearby. Water sends most of it onward, so a drop between you and a lamp
  // shines and one beside it barely shows. Hair is a bright thread: lit from the side, and with a band
  // of sheen where the eye and the lamp stand mirrored about its length.
  vec3 viewDir = normalize(uEye - lit);
  float cosV = dot(tangent, viewDir);
  float sinV = sqrt(max(1.0 - cosV * cosV, 0.0));
  vec3 caught = vec3(0.0);
  vec3 threadLight = vec3(0.0);
  vec3 sheenLight = vec3(0.0);
  float nearest = mix(LAMP_NEAR, HAIR_LAMP_NEAR, grow);
  for (int i = 0; i < MAX_LAMPS; i++) {
    if (i >= uLampCount) break;
    vec3 toLamp = uLampPos[i] - lit;
    float d = length(toLamp);
    vec3 l = toLamp / max(d, 1e-4);
    vec4 cone = uLampCone[i];
    float falloff = 1.0 / pow(max(d, nearest), cone.w);
    if (cone.z > 0.0) falloff *= pow2(saturate(1.0 - pow4(d / cone.z)));
    falloff *= smoothstep(cone.x, cone.y, dot(l, uLampDir[i]));
    vec3 lamp = uLampColor[i] * falloff;
    float g = 1.0 + FORWARD * FORWARD - 2.0 * FORWARD * dot(-l, viewDir);
    caught += lamp * ((1.0 - FORWARD * FORWARD) / (g * sqrt(g)));
    float cosL = dot(tangent, l);
    float sinL = sqrt(max(1.0 - cosL * cosL, 0.0));
    threadLight += lamp * sinL;
    sheenLight += lamp * pow(max(sinL * sinV - cosL * cosV, 0.0), SHINE);
  }

  // bone white under any lamp: it takes their brightness, and only a little of their color
  vec3 onHair = threadLight * HAIR_DIFFUSE + sheenLight * HAIR_SHEEN;
  onHair = mix(vec3(dot(onHair, vec3(0.2126, 0.7152, 0.0722))), onHair, HAIR_TINGE) * uHairTint;
  vec3 hairBase = uHairTint * uHairGlow * mix(1.0, ROOT_DARK, pow(position.y, 0.7));
  vBase = mix(uColor, hairBase, grow) * aShape.w * uDim;
  vCatch = mix(caught * DROP_ALBEDO * RECIPROCAL_PI, onHair, grow) * aShape.w;
  vAlpha = mix(rainAlpha, hairAlpha, grow);
  vHair = vec2(grow, aSeed.y);
  vUv = position.xy;
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${CONSTANTS}
uniform float uRootFade; // share of a strand's length that fades out at the root
varying vec2 vUv;
varying float vAlpha;
varying vec3 vBase;
varying vec3 vCatch;
varying vec2 vHair;

void main() {
  // a thread of water: soft across, tapering at both ends
  float across = 1.0 - vUv.x * vUv.x;
  float ends = smoothstep(0.0, TAPER, vUv.y) * (1.0 - smoothstep(1.0 - TAPER, 1.0, vUv.y));
  float additive = ADDITIVE;
  float hair = vHair.x;
  if (hair > 0.0) {
    // a strand: a few hairs side by side, gone to nothing at the tip and high up where it starts
    float fibres = 0.78 + 0.22 * sin(vUv.x * FIBRES + vHair.y * 40.0);
    float hairEnds = smoothstep(0.0, HAIR_TIP, vUv.y) * (1.0 - smoothstep(1.0 - uRootFade, 1.0, vUv.y));
    across *= mix(1.0, fibres, hair);
    ends = mix(ends, hairEnds, hair);
    additive = mix(ADDITIVE, HAIR_ADDITIVE, hair);
  }
  float a = vAlpha * across * ends;

  gl_FragColor = vec4(vBase, 1.0);
  #include <fog_fragment>
  // the light it lets through and the light it catches only dim with the air in between
  float clearAir = 1.0;
  #ifdef USE_FOG
    clearAir = 1.0 - fogFactor;
  #endif
  vec3 light = (1.0 - additive) * gl_FragColor.rgb + clearAir * (additive * vBase + vCatch);
  gl_FragColor = vec4(light * a, a * (1.0 - additive)); // premultiplied
}
`;

type Lamp = PointLight | SpotLight;

function strandUniforms() {
  const slots = <T>(make: () => T): T[] => Array.from({ length: MAX_LAMPS }, make);
  return {
    ...UniformsUtils.clone(UniformsLib.fog),
    ...warpUniforms,
    uEye: { value: new Vector3() },
    uTime: { value: 0 },
    uRegion: { value: new Vector4() },
    uFarEnd: { value: new Vector2() },
    uSize: { value: new Vector2() },
    uFall: { value: new Vector4() },
    uPart: { value: new Vector2() },
    uPixel: { value: 1 },
    uColor: { value: new Color() },
    uOpacity: { value: 1 },
    uMorph: { value: 0 },
    uDim: { value: 1 },
    uHairTint: { value: new Color() },
    uHairGlow: { value: 0 },
    uHairOpacity: { value: 1 },
    uHairPart: { value: new Vector2() },
    uHairEnd: { value: new Vector2() },
    uRootFade: { value: H.shape.rootFade as number },
    uWind: { value: 0 },
    uLampCount: { value: 0 },
    uLampPos: { value: slots(() => new Vector3()) },
    uLampColor: { value: slots(() => new Color()) },
    uLampDir: { value: slots(() => new Vector3(0, -1, 0)) },
    uLampCone: { value: slots(() => new Vector4()) },
  };
}

/** Per-strand data of one instanced draw (see the attributes of the vertex shader). */
export interface StrandSet {
  count: number;
  drops: Float32Array;
  shapes: Float32Array;
  speeds: Float32Array;
  tips: Float32Array;
  roots: Float32Array;
  seeds: Float32Array;
}

export function strandSet(count: number): StrandSet {
  return {
    count,
    drops: new Float32Array(count * 4),
    shapes: new Float32Array(count * 4),
    speeds: new Float32Array(count),
    tips: new Float32Array(count * 4),
    roots: new Float32Array(count * 4),
    seeds: new Float32Array(count * 4),
  };
}

export interface StrandOptions {
  /** Segments of each ribbon (default: as many as the rain has). */
  segments?: number;
  /** Hair from the start, with no end along the way, and no one ever near enough to part it. */
  always?: boolean;
  /** Hair comes down behind the walker. */
  falls?: boolean;
  /** It was never rain: nothing of it shows until it grows. */
  hairOnly?: boolean;
  /** Share of a strand's length that fades out at the root (default: from far out of sight). */
  rootFade?: number;
}

const lampAt = new Vector3();
const viewport = new Vector4();

/**
 * Long ribbons drawn in one instanced draw, each bending, swaying and catching the lamps in the vertex
 * shader. Every strand is a pure function of the eye and the clock, so the photograph, every camera and
 * walking backwards all agree. The same shader draws a strand when it was still a frozen drop of rain,
 * which is how the rain turns into hair (`morph`).
 */
export class Strands {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly set: StrandSet;
  private readonly u = strandUniforms();
  /** Everything that can light the dream: the spots of the space, and the pool. */
  private readonly lamps: Lamp[];
  private readonly nearest: Lamp[] = [];
  private readonly nearestDistance = new Float64Array(MAX_LAMPS);

  constructor(kit: DreamKit, set: StrandSet, options: StrandOptions = {}) {
    this.set = set;
    this.lamps = [...kit.alley.spots, ...(kit.lights.root.children as PointLight[])];

    const geometry = new InstancedBufferGeometry();
    const vertices: number[] = [];
    const index: number[] = [];
    const segments = options.segments ?? H.segments;
    for (let k = 0; k <= segments; k++) {
      const s = (k / segments) ** H.tipBias;
      vertices.push(-1, s, 0, 1, s, 0);
      if (k < segments) {
        const b = k * 2;
        index.push(b, b + 1, b + 3, b, b + 3, b + 2);
      }
    }
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    geometry.setIndex(index);
    geometry.setAttribute('aDrop', new InstancedBufferAttribute(set.drops, 4));
    geometry.setAttribute('aShape', new InstancedBufferAttribute(set.shapes, 4));
    geometry.setAttribute('aSpeed', new InstancedBufferAttribute(set.speeds, 1));
    geometry.setAttribute('aTip', new InstancedBufferAttribute(set.tips, 4));
    geometry.setAttribute('aRoot', new InstancedBufferAttribute(set.roots, 4));
    geometry.setAttribute('aSeed', new InstancedBufferAttribute(set.seeds, 4));
    geometry.instanceCount = set.count;

    const u = this.u;
    const { y, z } = R.region;
    u.uRegion.value.set(y[0], y[1] - y[0], CEILING_FADE, FLOOR_FADE);
    // the alley runs along -Z: the far end is the region's smallest z
    u.uFarEnd.value.set(z[1], Math.min(FAR_FADE, z[0] - z[1]));
    u.uSize.value.set(R.size[0], R.size[1]);
    u.uFall.value.set(R.fall.from, Math.max(R.fall.blend, 1e-3), R.fall.speed, !REDUCED_MOTION && options.falls ? 1 : 0);
    u.uPart.value.set(R.part.radius, R.part.push);
    u.uColor.value.set(R.color).multiplyScalar(R.brightness);
    u.uOpacity.value = options.hairOnly ? 0 : R.opacity;
    u.uHairTint.value.set(H.color);
    u.uHairGlow.value = H.brightness;
    u.uHairOpacity.value = H.opacity;
    u.uHairPart.value.set(H.part.radius, options.always ? 0 : H.part.push);
    if (options.always) {
      u.uHairEnd.value.set(-1e5, -1e5 + 1);
      u.uMorph.value = 1;
    } else {
      u.uHairEnd.value.set(H.shape.end[0], H.shape.end[1]);
    }
    u.uWind.value = H.wind.amount * (REDUCED_MOTION ? H.wind.reduced : 1);
    if (options.rootFade !== undefined) u.uRootFade.value = options.rootFade;

    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: u,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      premultipliedAlpha: true,
      // each strand is turned to its camera anyway: both faces in one draw (three otherwise draws a
      // transparent double-sided mesh twice, back faces then front faces)
      side: DoubleSide,
      forceSinglePass: true,
      fog: true,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'Strands';
    // every strand hangs in the alley's air, in front of any pane or curtain seen from inside it: draw it
    // after those instead of sorting a whole street by its centre (dark panes would cover near strands)
    this.mesh.renderOrder = 1;
    this.mesh.onBeforeRender = (renderer, _scene, camera) => this.prepare(renderer, camera);
    // the base ribbon is not where any strand is: never report a hit on it
    this.mesh.raycast = () => {};
  }

  /** 0 = frozen rain, 1 = hair. */
  set morph(value: number) {
    this.u.uMorph.value = value;
  }

  /** The light of the place (hair has a little of its own, which darkens with it). */
  set dim(value: number) {
    this.u.uDim.value = value;
  }

  /** The strands' own clock (s): it stands still while the piece is paused. */
  advance(dt: number): void {
    this.u.uTime.value += dt;
  }

  /** What has come down and gone behind the walker costs nothing (the strands are laid out far ones first). */
  forget(eyeZ: number): void {
    const { drops, count } = this.set;
    const limit = eyeZ + H.fall.gone[1];
    let low = 0;
    let high = count;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (drops[middle * 4 + 2] <= limit) low = middle + 1;
      else high = middle;
    }
    this.mesh.geometry.instanceCount = low;
  }

  /** Every strand again, as in the photograph. */
  remember(): void {
    this.mesh.geometry.instanceCount = this.set.count;
  }

  /** Per pass: the eye, the size of a pixel, the lamps nearest to this camera. */
  private prepare(renderer: WebGLRenderer, camera: Camera): void {
    const u = this.u;
    u.uEye.value.setFromMatrixPosition(camera.matrixWorld);
    renderer.getCurrentViewport(viewport);
    // abs: a mirror camera may flip its projection
    u.uPixel.value = 2 / (Math.max(Math.abs(camera.projectionMatrix.elements[5]), 1e-6) * Math.max(1, viewport.w));
    this.catchLamps(camera);
  }

  /** The nearest lamps (to the eye) that light this pass, in the uniform slots. */
  private catchLamps(camera: Camera): void {
    const nearest = this.nearest;
    const distance = this.nearestDistance;
    const eye = this.u.uEye.value;
    let count = 0;
    for (let k = 0; k < this.lamps.length; k++) {
      const lamp = this.lamps[k];
      if (lamp.intensity <= 0 || !lamp.layers.test(camera.layers)) continue;
      const d = lampAt.setFromMatrixPosition(lamp.matrixWorld).distanceToSquared(eye);
      if (count === MAX_LAMPS && d >= distance[MAX_LAMPS - 1]) continue;
      let i = count < MAX_LAMPS ? count++ : MAX_LAMPS - 1;
      for (; i > 0 && distance[i - 1] > d; i--) {
        distance[i] = distance[i - 1];
        nearest[i] = nearest[i - 1];
      }
      distance[i] = d;
      nearest[i] = lamp;
    }

    const u = this.u;
    for (let i = 0; i < count; i++) {
      const lamp = nearest[i];
      u.uLampPos.value[i].setFromMatrixPosition(lamp.matrixWorld);
      u.uLampColor.value[i].copy(lamp.color).multiplyScalar(lamp.intensity);
      const cone = u.uLampCone.value[i];
      if (lamp instanceof SpotLight) {
        // as three lights a spot: full inside the penumbra, nothing outside the cone
        const outer = Math.cos(lamp.angle);
        cone.set(outer, Math.max(Math.cos(lamp.angle * (1 - lamp.penumbra)), outer + CONE_EPSILON), lamp.distance, lamp.decay);
        u.uLampDir.value[i]
          .setFromMatrixPosition(lamp.matrixWorld)
          .sub(lampAt.setFromMatrixPosition(lamp.target.matrixWorld))
          .normalize();
      } else {
        cone.set(-2, -1, lamp.distance, lamp.decay);
      }
    }
    u.uLampCount.value = count;
  }
}

/** Height (m) under which the hair leaves the air free at this place: a vault over the way, lifted over the faces. */
function vaultAt(x: number, z: number): number {
  const v = H.vault;
  const across = Math.min(1, Math.abs(x) / R.region.x[1]);
  const lifted = smootherstep(range(v.liftFrom[0], v.liftFrom[1], z)) * (1 - smootherstep(range(v.liftTo[0], v.liftTo[1], z)));
  const forest = lerp(v.forest[0], v.forest[1], across ** v.forestShape);
  const faces = lerp(v.faces[0], v.faces[1], across ** v.facesShape);
  return lerp(forest, faces, lifted);
}

/** Where a lock of hair ends. */
interface Lock {
  x: number;
  z: number;
  tip: number;
}

/** Where the locks of hair end: some places hang thick, some thin. */
function layLocks(random: () => number): Lock[] {
  const { x, z } = R.region;
  const c = H.locks;
  const v = H.vault;
  const locks: Lock[] = [];
  while (locks.length < c.count) {
    const lx = lerp(x[0], x[1], random());
    const lz = lerp(z[1], z[0], random());
    const thick = 0.5 + 0.5 * Math.sin(lz * c.clumps[0] + 1.3) * Math.sin(lx * c.clumps[1] + lz * 0.37);
    if (random() > thick) continue;
    // a few reach down over the way itself: these are the ones that part around you
    const inside = Math.abs(lx) < v.low.within && vaultAt(lx, lz) < v.forest[0] + 0.5;
    const tip = inside && random() < v.low.share ? lerp(v.low.height[0], v.low.height[1], random()) : vaultAt(lx, lz) + random() ** v.spreadPower * v.spread;
    locks.push({ x: lx, z: lz, tip });
  }
  return locks;
}

/** The strand of hair that starts from a place (x, z), in slot `n` of the set. */
function growStrand(set: StrandSet, n: number, dx: number, dz: number, locks: readonly Lock[], hair: () => number): void {
  const L = H.locks;
  const j = n * 4;
  let best = -1;
  let bestDistance = L.reach * L.reach;
  for (let k = 0; k < locks.length; k++) {
    const ax = locks[k].x - dx;
    const az = locks[k].z - dz;
    const d = ax * ax + az * az;
    if (d < bestDistance) {
      bestDistance = d;
      best = k;
    }
  }

  // its free end, in its lock or (a loose one) by itself
  const lock = best >= 0 && hair() > L.loose ? locks[best] : null;
  const around = hair() * TAU;
  const off = hair() * L.tipRadius;
  const tipY = (lock ? lock.tip : vaultAt(dx, dz) + hair() ** H.vault.spreadPower * H.vault.spread) + hair() ** 2 * L.tipSpread;
  set.tips[j] = (lock ? lock.x : dx) + Math.cos(around) * off;
  set.tips[j + 1] = tipY;
  set.tips[j + 2] = (lock ? lock.z : dz) + Math.sin(around) * off;
  // near the way ahead it grows first, and spreads down the alley
  set.tips[j + 3] = range(H.growNear[0], H.growNear[1], -dz) * H.growWave + hair() * (1 - H.growShare - H.growWave);

  // what it hangs from: above the roofs, far out of sight
  set.roots[j] = dx;
  set.roots[j + 1] = lerp(Math.max(H.rootAbove, tipY + H.length[0]), tipY + H.length[1], hair());
  set.roots[j + 2] = dz;
  set.roots[j + 3] = lerp(H.width[0], H.width[1], hair() ** 1.6);

  const across = Math.min(1, Math.abs(dx) / R.region.x[1]);
  set.seeds[j] = best >= 0 ? best / locks.length : hair();
  set.seeds[j + 1] = hair();
  // near the walls there is no room to sway
  set.seeds[j + 2] = (1 - H.wind.walls * across * across) * lerp(0.7, 1.3, hair());
  set.seeds[j + 3] = lerp(H.wave.amount[0], H.wave.amount[1], hair());
}

/**
 * The drops the shutter stopped, exactly where they always hang, and for each the strand of hair it will
 * become. In their order along the alley, far ones first: walking down it, near strands are drawn over far ones.
 */
export function frozenRain(kit: DreamKit): Strands {
  const { x, y, z } = R.region;
  const count = R.count;
  const set = strandSet(count);

  const rand = randomFrom(SEED);
  const order = Array.from({ length: count }, (_, i) => i);
  const drop = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const shape = new Float32Array(count * 4);
  const speed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    drop[i * 3] = lerp(x[0], x[1], rand());
    drop[i * 3 + 1] = lerp(y[0], y[1], rand());
    drop[i * 3 + 2] = lerp(z[1], z[0], rand());
    phase[i] = rand();
    const lean = LEAN * rand();
    const turn = rand() * TAU;
    shape[i * 4] = 1 + LENGTH_JITTER * (rand() * 2 - 1);
    shape[i * 4 + 1] = Math.sin(lean) * Math.cos(turn);
    shape[i * 4 + 2] = Math.sin(lean) * Math.sin(turn);
    shape[i * 4 + 3] = lerp(GLINT[0], GLINT[1], rand());
    speed[i] = 1 + SPEED_JITTER * (rand() * 2 - 1);
  }
  order.sort((a, b) => drop[a * 3 + 2] - drop[b * 3 + 2]);

  const hair = randomFrom(HAIR_SEED);
  const locks = layLocks(randomFrom(LOCK_SEED));
  for (let n = 0; n < count; n++) {
    const i = order[n];
    const j = n * 4;
    set.drops[j] = drop[i * 3];
    set.drops[j + 1] = drop[i * 3 + 1];
    set.drops[j + 2] = drop[i * 3 + 2];
    set.drops[j + 3] = phase[i];
    set.shapes.set(shape.subarray(i * 4, i * 4 + 4), j);
    set.speeds[n] = speed[i];
    growStrand(set, n, drop[i * 3], drop[i * 3 + 2], locks, hair);
  }
  return new Strands(kit, set, { falls: true });
}

/**
 * Hair that was never rain, to thicken the first stretch of the walk, where nothing else stands in it: a little
 * coarser, nothing of it in the photograph. It joins the same locks.
 */
export function thickHair(kit: DreamKit): Strands {
  const T = H.thick;
  const random = randomFrom(HAIR_SEED + 1);
  const locks = layLocks(randomFrom(LOCK_SEED));
  const set = strandSet(T.count);
  const places = Array.from({ length: T.count }, () => lerp(T.z[1], T.z[0], random())).sort((a, b) => a - b);
  for (let n = 0; n < T.count; n++) {
    const j = n * 4;
    const x = lerp(R.region.x[0], R.region.x[1], random());
    set.drops[j] = x;
    set.drops[j + 1] = lerp(R.region.y[0], R.region.y[1], random());
    set.drops[j + 2] = places[n];
    set.drops[j + 3] = random();
    set.shapes[j] = 1;
    set.shapes[j + 3] = lerp(GLINT[0], GLINT[1], random());
    set.speeds[n] = 1 + SPEED_JITTER * (random() * 2 - 1);
    growStrand(set, n, x, places[n], locks, random);
  }
  return new Strands(kit, set, { falls: true, hairOnly: true, segments: T.segments });
}
