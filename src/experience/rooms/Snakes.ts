import {
  BufferGeometry,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { randomFrom } from '../dream/FigureKit';

type V3 = readonly [number, number, number];

/** How a snake goes: over a floor, on water with its head up, or winding along itself in one place. */
export type SnakeWay = 'crawl' | 'swim' | 'knot';

/** Where one snake is and what it does. Everything but `at` and `heading` has a default for its `way`. */
export interface SnakePlace {
  /** x and z of its head at time 0, and y of the surface under it (for `swim`, the water's height). */
  at: V3;
  /** Rad: 0 goes along -Z, positive turns left (as a camera's yaw). */
  heading: number;
  /** The way the surface faces, unit length, if it is not a floor: a slope, a wall, a ceiling. It stays in that plane. */
  normal?: V3;
  way?: SnakeWay;
  /** Along its way, m/s (for `knot`, how fast the body slides along itself). */
  speed?: number;
  /** Whole length (m) and greatest radius (m). */
  length?: number;
  girth?: number;
  /** Seconds before its head reaches `at`: until then it is coming, from behind `at`. */
  delay?: number;
  /** Meters after which it starts again from `at` (hide both ends). 0 never. */
  loop?: number;
  /** Curve of its way (1/m, positive left): the body lies along the same curve. */
  bend?: number;
  /** How far above the rest of its body it holds its head (m). */
  lift?: number;
  /** Height gained per meter of way: with `bend`, it winds up a post. */
  climb?: number;
  /** The wave: its swing (rad off its way) and how many waves lie along the body. */
  swing?: number;
  waves?: number;
}

/**
 * What each way does unless told otherwise: its speed (m/s), swing (rad), waves along the body, lift (m), how much of
 * the wave reaches the head, the share of the wave's speed that the body really advances by, how high the wave lifts the body (radii).
 */
const WAYS: Record<SnakeWay, { speed: number; swing: number; waves: number; lift: number; headShare: number; advance: number; ride: number }> = {
  crawl: { speed: 0.22, swing: 0.92, waves: 1.7, lift: 0.012, headShare: 0.42, advance: 1, ride: 0 },
  // in water the wave runs faster than the body goes, and hardly moves the head
  swim: { speed: 0.3, swing: 0.62, waves: 1.3, lift: 0.055, headShare: 0.12, advance: 0.7, ride: 0.2 },
  // at a swing like this the way curls over itself, and the body slides along it, one strand riding over the other
  knot: { speed: 0.045, swing: 2.1, waves: 1.15, lift: 0, headShare: 1, advance: 1, ride: 2.2 },
};
/** Lengths drawn when none is given (m), and a radius as a share of the length. */
const LENGTHS = [0.6, 1.6] as const;
const GIRTH = 0.0165;
/** How deep a swimming body lies, in radii. */
const SINK = 0.7;

/** The head along z, in radii of the body, snout first: z, half width, top, bottom. Its top is flat, its jaw wide. */
const HEAD_RINGS: readonly (readonly [number, number, number, number])[] = [
  [0.05, 0.25, 0.52, 0.16],
  [0.28, 0.4, 0.72, 0.06],
  [0.8, 0.52, 0.88, 0.02],
  [1.4, 0.66, 0.99, 0],
  [2, 0.86, 1.08, 0],
  [2.6, 1.02, 1.12, 0],
  [3.2, 0.94, 1.08, 0.02],
  [3.8, 0.72, 1.02, 0.03],
  [4.4, 0.6, 1.08, 0.01],
  [5, 0.6, 1.2, 0],
];
const HEAD = 5;
/** The eye: its center (x on the right side, y, z in radii), radius, the way it looks (x, y), and sides of its dome. */
const EYE = [0.53, 0.66, 1.5] as const;
const EYE_RADIUS = 0.24;
const EYE_LOOK = [0.93, 0.37] as const;
const EYE_SIDES = 8;
/** How long a body is along z when it has its usual proportions. */
const WHOLE = 60;

/**
 * Drawing a snake, near and for crowds: the head's rings (which of HEAD_RINGS, how many sides, where the first lies),
 * the body's rings (flat on top and on the belly: how many, how many sides, how wide such a ring must be drawn to
 * keep its width), and every how many body rings the ground strip has a step.
 */
const DETAIL = {
  near: { head: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], headSides: 8, headFrom: 0, rings: 46, sides: 6, wide: 1, strip: 3, face: true },
  crowd: { head: [0, 2, 5, 9], headSides: 4, headFrom: 0.125, rings: 24, sides: 4, wide: 1.41, strip: 3, face: false },
} as const;

/** The radius of the body at a share of its length behind the neck: it swells, then runs out into a fine tail. */
function bodyRadius(f: number): number {
  const swell = Math.min(1, f / 0.38);
  const neck = 0.6 + 0.4 * swell * swell * (3 - 2 * swell);
  const tail = Math.min(1, Math.max(0, (f - 0.55) / 0.45));
  return neck * (1 - Math.pow(tail * tail * (3 - 2 * tail), 1.25) * 0.965);
}

/** A snake lying straight: x to its right, y up from the belly, z from the snout down the body, in radii of the body (see SNAKE_VERT_FRAME). */
function snakeGeometry(detail: (typeof DETAIL)[keyof typeof DETAIL]): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  interface Ring {
    start: number;
    count: number;
    /** Where its first point lies round the body (0 the belly, a half the spine), as a share. */
    from: number;
  }
  const ring = (count: number, from: number, z: number, width: number, top: number, bottom: number, square: number): Ring => {
    const start = positions.length / 3;
    for (let j = 0; j < count; j++) {
      const a = (j / count + from) * Math.PI * 2;
      const sin = Math.sin(a);
      const cos = Math.cos(a);
      positions.push(width * Math.sign(sin) * Math.pow(Math.abs(sin), square), (top + bottom) / 2 - ((top - bottom) / 2) * Math.sign(cos) * Math.pow(Math.abs(cos), square), z);
    }
    return { start, count, from };
  };
  const rings: Ring[] = [];
  // the snout first, closed by one point
  positions.push(0, 0.32, 0);
  for (const i of detail.head) {
    const [z, width, top, bottom] = HEAD_RINGS[i];
    rings.push(ring(detail.headSides, detail.headFrom, z, width, top, bottom, 0.8));
  }
  // a flat side of the ring lies on the ground: raised so that it rests at y = 0
  const flat = Math.cos(Math.PI / detail.sides);
  for (let i = 1; i <= detail.rings; i++) {
    const f = i / detail.rings;
    const r = bodyRadius(f);
    rings.push(ring(detail.sides, 0.5 / detail.sides, HEAD + f * (WHOLE - HEAD), r * detail.wide, r * (flat + 1), r * (flat - 1), 1));
  }
  for (let j = 0; j < detail.headSides; j++) indices.push(0, rings[0].start + ((j + 1) % detail.headSides), rings[0].start + j);
  // each ring to the next, walking round both by where their points lie
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    let ia = 0;
    let ib = 0;
    while (ia < a.count || ib < b.count) {
      const pa = a.start + (ia % a.count);
      const pb = b.start + (ib % b.count);
      if (ib >= b.count || (ia < a.count && (ia + 1) / a.count + a.from <= (ib + 1) / b.count + b.from)) {
        indices.push(pa, a.start + ((ia + 1) % a.count), pb);
        ia++;
      } else {
        indices.push(pa, b.start + ((ib + 1) % b.count), pb);
        ib++;
      }
    }
  }
  const tip = positions.length / 3;
  positions.push(0, 0.05, WHOLE + 0.4);
  const last = rings[rings.length - 1];
  for (let j = 0; j < last.count; j++) indices.push(tip, last.start + j, last.start + ((j + 1) % last.count));
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normals = Array.from(geometry.getAttribute('normal').array);

  // on the ground under it, its contact shadow, or on water its wake: y = -1 says so, and normal.x is the share across
  const stripWidth = 2.6;
  const stripFrom = positions.length / 3;
  const stripAt = (z: number, r: number) => {
    positions.push(-stripWidth * r, -1, z, stripWidth * r, -1, z);
    normals.push(-1, 0, 0, 1, 0, 0);
  };
  stripAt(0.2, 0.5);
  stripAt(2.6, 1);
  let strips = 2;
  for (let i = detail.strip; i <= detail.rings; i += detail.strip) {
    const f = i / detail.rings;
    stripAt(HEAD + f * (WHOLE - HEAD), bodyRadius(f));
    strips++;
  }
  for (let i = 0; i < strips - 1; i++) {
    const a = stripFrom + i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }

  if (detail.face) {
    // an eye is a little dome standing out of the head (the skin shader knows it by its distance from EYE)
    for (const side of [1, -1]) {
      const start = positions.length / 3;
      const point = (polar: number, turn: number) => {
        // the dome's top looks out and a little up
        const o = Math.cos(polar);
        const a = Math.sin(polar) * Math.cos(turn);
        const b = Math.sin(polar) * Math.sin(turn);
        const nx = o * EYE_LOOK[0] - a * EYE_LOOK[1];
        const ny = o * EYE_LOOK[1] + a * EYE_LOOK[0];
        positions.push(side * (EYE[0] + nx * EYE_RADIUS), EYE[1] + ny * EYE_RADIUS, EYE[2] + b * EYE_RADIUS);
        normals.push(side * nx, ny, b);
      };
      point(0, 0);
      for (const polar of [0.8, 1.6]) for (let j = 0; j < EYE_SIDES; j++) point(polar, (j / EYE_SIDES) * Math.PI * 2);
      const around = (band: number, j: number) => start + 1 + band * EYE_SIDES + ((j + EYE_SIDES) % EYE_SIDES);
      const triangle = (a: number, b: number, c: number) => (side > 0 ? indices.push(a, b, c) : indices.push(a, c, b));
      for (let j = 0; j < EYE_SIDES; j++) {
        triangle(start, around(0, j), around(0, j + 1));
        triangle(around(0, j), around(1, j), around(0, j + 1));
        triangle(around(0, j + 1), around(1, j), around(1, j + 1));
      }
    }

    // forked, flat, drawn from both sides; z < 0 says it is the tongue, and it comes out as far as the flick wants
    const t = positions.length / 3;
    const tongue = [
      [-0.05, 0.3, -0.001],
      [0.05, 0.3, -0.001],
      [-0.035, 0.27, -1.7],
      [0.035, 0.27, -1.7],
      [0, 0.27, -2],
      [-0.2, 0.31, -2.9],
      [0.2, 0.31, -2.9],
    ];
    for (const [x, y, z] of tongue) {
      positions.push(x, y, z);
      normals.push(0, 1, 0);
    }
    for (const [a, b, c] of [[0, 2, 1], [1, 2, 3], [2, 5, 4], [3, 4, 6], [2, 4, 3]]) indices.push(t + a, t + b, t + c, t + a, t + c, t + b);
  }
  const whole = new BufferGeometry();
  whole.setAttribute('position', new Float32BufferAttribute(positions, 3));
  whole.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  whole.setIndex(indices);
  return whole;
}

/** Bessel function of the first kind: what the serpenoid curve's harmonics weigh. */
function bessel(n: number, x: number): number {
  let term = 1;
  for (let i = 1; i <= n; i++) term *= x / 2 / i;
  let sum = term;
  for (let m = 1; m < 12; m++) {
    term *= (-x * x) / 4 / (m * (m + n));
    sum += term;
  }
  return sum;
}

/**
 * Each snake's numbers. Body: length, girth, wave number, how much of the wave reaches the head. Run: how far along its
 * way at time 0, how fast, the share of that which really advances, where it loops. Form: lift, ride, bend, climb. Ahead
 * and aside: the harmonics of its curve (see snakeLine). Mark: its own random number, 1 on water. Local to the instance:
 * x to the right, y up, -z ahead, the head at the origin at time 0.
 */
const SNAKE_VERT_PARS = /* glsl */ `
attribute vec4 snakeBody;
attribute vec4 snakeRun;
attribute vec4 snakeForm;
attribute vec3 snakeAhead;
attribute vec3 snakeAside;
attribute vec2 snakeMark;
uniform float uSnakeTime;
uniform vec4 uSnakeRaise;
uniform float uSnakeTurn;
varying vec4 vSnake;
varying vec3 vSnakeMark;
varying vec2 vSnakeRound;
varying vec3 vSnakeAhead;
varying vec3 vSnakeSide;
float snakeWay;
float snakeAdvance;
float snakeAnchor;
float snakeLift;
float snakeNeck;
float snakeHeadTurn;
vec3 snakePivot;

// A place on its way: so far along it, so far to the left of it, at this height.
vec3 snakeArc(float w, float aside, float y) {
  float a = snakeForm.z * w;
  float sa = sin(a);
  float sh = sin(a * 0.5);
  return vec3(-(2.0 * sh * sh / snakeForm.z + aside * cos(a)), y, -(sa / snakeForm.z - aside * sa));
}

// A serpenoid curve: its heading swings as sin(k s), so a point s along it lies at these harmonics. Being an
// exact function of the arc, the body keeps its length and each part of it follows where the head has been.
vec3 snakeLine(float d) {
  float phase = snakeBody.z * (snakeWay - d) + snakeMark.x * 6.2832;
  float s1 = sin(phase);
  float c1 = cos(phase);
  float s2 = 2.0 * s1 * c1;
  float c2 = 1.0 - 2.0 * s1 * s1;
  float c3 = c1 * (2.0 * c2 - 1.0);
  float c5 = 2.0 * c2 * c3 - c1;
  float aside = -mix(snakeBody.w, 1.0, smoothstep(0.0, 2.6 / snakeBody.z, d)) * dot(snakeAside, vec3(c1, c3, c5));
  float w = snakeAdvance - snakeAhead.x * d + snakeAhead.y * s2 + snakeAhead.z * 2.0 * s2 * c2 - snakeAnchor;
  float neck = 1.0 - smoothstep(0.0, snakeNeck, d);
  vec3 p = snakeArc(w, aside, snakeLift * neck + snakeForm.y * (0.5 + 0.5 * s1) + snakeForm.w * max(w, 0.0));
  if (snakeHeadTurn != 0.0) {
    float turn = snakeHeadTurn * neck;
    float st = sin(turn);
    float ct = cos(turn);
    vec2 r = p.xz - snakePivot.xz;
    p.xz = snakePivot.xz + vec2(ct * r.x + st * r.y, -st * r.x + ct * r.y);
  }
  return p;
}
`;

/** Where it is at this time, then a frame along its line. */
const SNAKE_VERT_FRAME = /* glsl */ `
snakeWay = snakeRun.x + snakeRun.y * uSnakeTime;
snakeAdvance = snakeAhead.x * snakeWay * snakeRun.z;
if (snakeRun.w > 0.0) snakeAdvance = mod(snakeAdvance, snakeRun.w);
snakeAnchor = 0.0;
if (snakeRun.y == 0.0) {
  // put by hand: its head is exactly where it was put
  float headPhase = snakeBody.z * snakeWay + snakeMark.x * 6.2832;
  float hs = sin(headPhase);
  float hc = cos(headPhase);
  snakeAnchor = snakeAhead.y * 2.0 * hs * hc + snakeAhead.z * 4.0 * hs * hc * (1.0 - 2.0 * hs * hs);
}
float snakeLength = snakeBody.x;
float snakeGirth = snakeBody.y;
snakeLift = snakeForm.x + uSnakeRaise.w * (0.75 + 0.5 * snakeMark.x);
snakeNeck = clamp(1.7 * snakeLift + 0.09, 0.09, 0.5 * snakeLength);
snakeHeadTurn = 0.0;
if (uSnakeTurn > 0.0) {
  // the front of it comes round, as a whole, until its head's way points at what it looks at from where the head then is
  snakePivot = snakeLine(snakeNeck);
  vec3 headAt = snakeLine(0.0);
  vec2 headWay = normalize((headAt - snakeLine(0.02)).xz * vec2(1.0, -1.0));
  vec2 headOff = (headAt.xz - snakePivot.xz) * vec2(1.0, -1.0);
  vec3 toLook = uSnakeRaise.xyz - instanceMatrix[3].xyz;
  vec2 lookOff = (vec2(dot(toLook, instanceMatrix[0].xyz), dot(toLook, instanceMatrix[2].xyz)) - snakePivot.xz) * vec2(1.0, -1.0);
  float skew = headWay.x * headOff.y - headWay.y * headOff.x;
  float off = atan(lookOff.y, lookOff.x) - atan(headWay.y, headWay.x) - asin(clamp(skew / max(length(lookOff), 0.01), -1.0, 1.0));
  snakeHeadTurn = atan(sin(off), cos(off)) * uSnakeTurn;
}
float snakeD = position.z <= ${HEAD.toFixed(1)}
  ? snakeGirth * max(position.z, 0.0)
  : snakeGirth * ${HEAD.toFixed(1)} + (position.z - ${HEAD.toFixed(1)}) / ${(WHOLE - HEAD).toFixed(1)} * (snakeLength - snakeGirth * ${HEAD.toFixed(1)});
vec3 snakeC = snakeLine(snakeD);
vec3 snakeF = normalize(snakeC - snakeLine(snakeD + 0.012));
vec3 snakeS = normalize(cross(snakeF, vec3(0.0, 1.0, 0.0)));
vec3 snakeU = cross(snakeS, snakeF);
vec3 objectNormal = snakeS * normal.x + snakeU * normal.y - snakeF * normal.z;
mat3 snakeTurnToRoom = mat3(instanceMatrix);
vSnakeAhead = normalMatrix * (snakeTurnToRoom * snakeF);
vSnakeSide = normalMatrix * (snakeTurnToRoom * snakeS);
vSnake = vec4(position.xyz, snakeD);
vSnakeMark = vec3(snakeMark, snakeGirth);
vSnakeRound = normal.xy;
`;

const SNAKE_VERT_PLACE = /* glsl */ `
vec3 transformed;
if (position.y < -0.5) {
  if (snakeMark.y > 0.5) {
    // its wake: two lines spreading from the head, straight behind it, whatever the body does
    float spread = 0.012 + snakeD * 0.34;
    transformed = snakeArc(snakeAdvance - snakeAhead.x * snakeD, -sign(position.x) * spread, ${SINK.toFixed(2)} * snakeGirth + 0.002);
  } else {
    // on the ground, whatever the body does above it
    transformed = vec3(snakeC.x, 0.002, snakeC.z) + snakeS * position.x * snakeGirth;
  }
  vSnake.x = normal.x;
  vSnake.y = -1.0 - snakeC.y;
} else if (position.z < 0.0) {
  // the tongue: out and back in short bursts of two or three
  float bursts = smoothstep(0.62, 0.8, sin(uSnakeTime * 1.1 + snakeMark.x * 40.0));
  float flick = bursts * max(0.0, sin(uSnakeTime * 15.0 + snakeMark.x * 90.0));
  transformed = snakeC + snakeF * (-position.z * snakeGirth * flick) + snakeS * position.x * snakeGirth + snakeU * position.y * snakeGirth;
} else {
  transformed = snakeC + snakeS * position.x * snakeGirth + snakeU * position.y * snakeGirth;
}
`;

const SNAKE_FRAG_PARS = /* glsl */ `
uniform float uSnakeTime;
varying vec4 vSnake;
varying vec3 vSnakeMark;
varying vec2 vSnakeRound;
varying vec3 vSnakeAhead;
varying vec3 vSnakeSide;

const vec3 SNAKE_BONE = vec3(0.56, 0.49, 0.36);
const vec3 SNAKE_PINK = vec3(0.44, 0.31, 0.26);
const vec3 SNAKE_MOSS = vec3(0.20, 0.235, 0.165);
const vec3 SNAKE_DARK = vec3(0.035, 0.04, 0.03);
const vec3 SNAKE_BELLY = vec3(0.70, 0.61, 0.52);
const vec3 SNAKE_EYE = vec3(${EYE.join(', ')});
const float SNAKE_EYE_R = ${EYE_RADIUS};

float snakeHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float snakeNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(snakeHash(i), snakeHash(i + vec2(1.0, 0.0)), f.x), mix(snakeHash(i + vec2(0.0, 1.0)), snakeHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Its skin at this point: color, gloss, how each scale tilts (along the body, round it), and the eye.
void snakeSkin(out vec3 color, out float rough, out vec2 tilt, out float eye) {
  float seed = vSnakeMark.x;
  float girth = vSnakeMark.z;
  float d = vSnake.w;
  vec3 b = vSnake.xyz;
  float onHead = 1.0 - smoothstep(${(HEAD * 0.82).toFixed(2)}, ${(HEAD * 1.08).toFixed(2)}, b.z);
  float around = atan(abs(vSnakeRound.x), -vSnakeRound.y) / PI;

  // rows of overlapping scales, a diamond lattice; belly scutes run right across
  float along = d / (girth * 0.62) + seed * 20.0;
  float rows = around * mix(9.0, 5.0, onHead);
  vec2 lattice = vec2(along * mix(1.0, 0.55, onHead) + rows, along * mix(1.0, 0.55, onHead) - rows);
  vec2 cell = floor(lattice);
  vec2 inCell = lattice - cell;
  float pixel = fwidth(lattice.x) + fwidth(lattice.y);
  float seen = 1.0 - smoothstep(0.35, 0.85, pixel);
  float seam = min(min(inCell.x, 1.0 - inCell.x), min(inCell.y, 1.0 - inCell.y));

  float bellyShare = (1.0 - smoothstep(0.23, 0.29, around)) * (1.0 - onHead);
  float scute = fract(along * 0.72);
  float scuteSeam = min(scute, 1.0 - scute);
  float scuteSeen = 1.0 - smoothstep(0.2, 0.5, fwidth(along) * 0.72);

  // back, flank and belly; each snake leans to its own color
  vec3 back = mix(SNAKE_MOSS, SNAKE_PINK, smoothstep(0.25, 0.75, seed));
  vec3 flank = mix(SNAKE_BONE, SNAKE_PINK * 1.2, smoothstep(0.4, 1.0, seed) * 0.55);
  color = mix(flank, back, smoothstep(0.42, 0.78, around));
  // broken dark saddles on the back, smaller marks down the flank
  float saddle = snakeNoise(vec2(d / (girth * 3.4) + seed * 37.0, around * 2.4 + seed * 11.0));
  float marks = smoothstep(0.56, 0.68, saddle) * smoothstep(0.5, 0.86, around);
  color = mix(color, SNAKE_DARK, marks * 0.78 * (1.0 - onHead));
  float freckle = snakeHash(cell + seed * 13.0);
  color *= 1.0 + (freckle - 0.5) * 0.34 * seen;
  color *= mix(1.0, mix(0.6, 0.82, onHead) + mix(0.4, 0.18, onHead) * smoothstep(0.0, 0.12, seam), seen);
  vec3 belly = SNAKE_BELLY * mix(1.0, 0.58 + 0.42 * smoothstep(0.0, 0.1, scuteSeam), scuteSeen);
  color = mix(color, belly, bellyShare);

  rough = 0.17 + 0.14 * snakeNoise(vec2(d * 11.0 + seed * 9.0, around * 5.0));
  tilt = vec2(inCell.x + inCell.y - 1.0, inCell.x - inCell.y) * mix(0.34, 0.14, onHead) * seen * (1.0 - bellyShare);
  tilt.x += (scute - 0.5) * 0.42 * scuteSeen * bellyShare;

  // the head: a lower jaw, a mouth line that smiles, a dark stripe back from the eye, a nostril
  eye = 0.0;
  if (onHead > 0.0) {
    float side = abs(b.x);
    float lineY = 0.3 + 0.17 * smoothstep(0.1, 3.1, b.z);
    float lower = (1.0 - smoothstep(lineY - 0.015, lineY + 0.015, b.y)) * (1.0 - smoothstep(3.0, 3.5, b.z));
    color = mix(color, SNAKE_BONE * 1.1, lower * 0.85 * onHead);
    float mouth = (1.0 - smoothstep(0.012, 0.042, abs(b.y - lineY))) * step(0.12, side) * (1.0 - smoothstep(3.0, 3.25, b.z));
    color = mix(color, SNAKE_DARK * 0.4, mouth * onHead);
    float stripeY = 0.78 - 0.1 * max(b.z - 1.5, 0.0);
    float stripe = (1.0 - smoothstep(0.05, 0.13, abs(b.y - stripeY))) * smoothstep(1.2, 1.7, b.z) * (1.0 - smoothstep(3.6, 4.6, b.z)) * smoothstep(0.3, 0.55, side);
    color = mix(color, SNAKE_DARK, stripe * 0.75 * onHead);
    float nostril = 1.0 - smoothstep(0.03, 0.06, length(vec3(side, b.y, b.z) - vec3(0.34, 0.55, 0.28)));
    color = mix(color, SNAKE_DARK * 0.2, nostril);
    float toEye = length(vec3(side, b.y, b.z) - SNAKE_EYE);
    color *= 1.0 - 0.6 * (1.0 - smoothstep(SNAKE_EYE_R, SNAKE_EYE_R * 1.5, toEye));
    eye = 1.0 - smoothstep(SNAKE_EYE_R * 0.97, SNAKE_EYE_R * 1.03, toEye);
    tilt *= 1.0 - eye;
    rough = mix(rough, 0.06, eye);
    color = mix(color, vec3(0.006, 0.005, 0.006), eye);
  }
  if (b.z < 0.0) {
    color = vec3(0.03, 0.006, 0.01);
    rough = 0.3;
    tilt = vec2(0.0);
  }
}
`;

/** The strip on the ground: a soft dark line under the body, or on water the lines of its wake, lit by what lights the water. */
const SNAKE_FRAG_STRIP = /* glsl */ `
if (vSnake.y < -0.5) {
  float acrossStrip = abs(vSnake.x);
  float strip = 0.0;
  vec3 stripColor = vec3(0.0);
  if (vSnakeMark.y > 0.5) {
    float share = vSnake.z / ${WHOLE.toFixed(1)};
    float line = smoothstep(0.6, 0.9, acrossStrip) * (1.0 - smoothstep(0.9, 1.0, acrossStrip)) + 0.45 * smoothstep(0.2, 0.42, acrossStrip) * (1.0 - smoothstep(0.42, 0.6, acrossStrip));
    float broken = snakeNoise(vec2(vSnake.z * 0.45 - uSnakeTime * 1.3, acrossStrip * 3.0 + sign(vSnake.x) * 5.0 + vSnakeMark.x * 30.0));
    strip = line * smoothstep(0.32, 0.72, broken) * exp(-share * 3.5) * smoothstep(0.0, 0.03, share) * 0.7;
    #if NUM_POINT_LIGHTS > 0
    for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
      IncidentLight wakeLight;
      getPointLightInfo(pointLights[i], -vViewPosition, wakeLight);
      stripColor += wakeLight.color;
    }
    #endif
    stripColor = stripColor * 0.24 + 0.012;
  } else {
    strip = pow(1.0 - acrossStrip, 1.25) * 0.92 * smoothstep(0.2, 2.4, vSnake.z) / (1.0 + max(-1.0 - vSnake.y, 0.0) * 40.0);
  }
  if (strip < 0.004) discard;
  #ifdef FOG_EXP2
    strip *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #endif
  gl_FragColor = vec4(stripColor, strip);
  return;
}
`;

/** Thin wet skin lets light through: what shines from behind it reaches the eye through the edges, reddened by the blood. */
const SNAKE_FRAG_THROUGH = /* glsl */ `
vec3 snakeThrough = vec3(0.0);
#if NUM_POINT_LIGHTS > 0
for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
  IncidentLight throughLight;
  getPointLightInfo(pointLights[i], geometryPosition, throughLight);
  float wrapped = saturate((dot(normal, throughLight.direction) + 0.65) / 1.65) - saturate(dot(normal, throughLight.direction));
  float behind = pow(saturate(dot(geometryViewDir, -normalize(throughLight.direction + normal * 0.45))), 2.5);
  snakeThrough += throughLight.color * (wrapped * 0.5 + behind * 1.1);
}
#endif
#if NUM_SPOT_LIGHTS > 0
for (int i = 0; i < NUM_SPOT_LIGHTS; i++) {
  IncidentLight throughLight;
  getSpotLightInfo(spotLights[i], geometryPosition, throughLight);
  float wrapped = saturate((dot(normal, throughLight.direction) + 0.65) / 1.65) - saturate(dot(normal, throughLight.direction));
  float behind = pow(saturate(dot(geometryViewDir, -normalize(throughLight.direction + normal * 0.45))), 2.5);
  snakeThrough += throughLight.color * (wrapped * 0.5 + behind * 1.1);
}
#endif
reflectedLight.directDiffuse += snakeThrough * vec3(0.95, 0.52, 0.42) * diffuseColor.rgb * RECIPROCAL_PI * (1.0 - snakeEye);
// and it is wet: at a glancing angle it mirrors whatever light there is
reflectedLight.directSpecular += pow(1.0 - saturate(dot(normal, geometryViewDir)), 4.0) * (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) * 1.4;
// the eye always holds a little of the room's light, as a wet black bead does
reflectedLight.directSpecular += snakeEye * pow(saturate(dot(normal, normalize(vec3(-0.3, 0.62, 0.72)))), 160.0) * (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + 0.02) * 22.0;
`;

const m = new Matrix4();
const q = new Quaternion();
const qHeading = new Quaternion();
const p = new Vector3();
const UP = new Vector3(0, 1, 0);
const ONE = new Vector3(1, 1, 1);

/**
 * Many snakes in one draw. Each has a head, a neck, a body running out into a tail and a skin of its own, and all
 * of them move by themselves in the vertex shader, as a pure function of `update(time)`: a travelling wave down the
 * body, along the very path its head took. `place` puts each one on a surface and sets it going, `reveal` says how
 * many exist, `pose` holds one by hand. Add `root` to the room.
 *
 * Draw it after the water it swims on (it comes after `blackWater`, before glows). It casts nothing, and brings its
 * own contact shadow; on water that same strip is its wake.
 */
export class Snakes {
  readonly root: InstancedMesh;
  private readonly body: InstancedBufferAttribute;
  private readonly run: InstancedBufferAttribute;
  private readonly form: InstancedBufferAttribute;
  private readonly ahead: InstancedBufferAttribute;
  private readonly aside: InstancedBufferAttribute;
  private readonly mark: InstancedBufferAttribute;
  private readonly sink: Float32Array;
  private readonly lengths: number[] = [];
  private placed = 0;
  private readonly time = { value: 0 };
  private readonly raised = { value: new Vector4(0, 0, 0, 0) };
  private readonly turned = { value: 0 };

  /** `detail: 'crowd'` is about 240 triangles a snake, for many of them further off; `near` about 800. */
  constructor(count: number, opts: { detail?: keyof typeof DETAIL; seed?: number } = {}) {
    const random = randomFrom(opts.seed ?? 1);
    const geometry = snakeGeometry(DETAIL[opts.detail ?? 'near']);
    const attribute = (name: string, size: number) => {
      const a = new InstancedBufferAttribute(new Float32Array(count * size), size);
      geometry.setAttribute(name, a);
      return a;
    };
    this.body = attribute('snakeBody', 4);
    this.run = attribute('snakeRun', 4);
    this.form = attribute('snakeForm', 4);
    this.ahead = attribute('snakeAhead', 3);
    this.aside = attribute('snakeAside', 3);
    this.mark = attribute('snakeMark', 2);
    this.sink = new Float32Array(count);
    const material = new MeshStandardMaterial({ metalness: 0.14, transparent: true });
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uSnakeTime = this.time;
      shader.uniforms.uSnakeRaise = this.raised;
      shader.uniforms.uSnakeTurn = this.turned;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${SNAKE_VERT_PARS}`)
        .replace('#include <beginnormal_vertex>', SNAKE_VERT_FRAME)
        .replace('#include <begin_vertex>', SNAKE_VERT_PLACE);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${SNAKE_FRAG_PARS}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${SNAKE_FRAG_STRIP}`)
        .replace(
          '#include <color_fragment>',
          `vec3 snakeColor;
          float snakeRough;
          vec2 snakeTilt;
          float snakeEye;
          snakeSkin(snakeColor, snakeRough, snakeTilt, snakeEye);
          diffuseColor.rgb = snakeColor;`,
        )
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = snakeRough;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * (1.0 - snakeEye);')
        .replace(
          '#include <normal_fragment_maps>',
          `vec3 snakeAheadV = normalize(vSnakeAhead);
          vec3 snakeSideV = normalize(vSnakeSide);
          vec3 snakeUpV = cross(snakeSideV, snakeAheadV);
          vec2 snakeRoundV = normalize(vec2(-vSnakeRound.y, abs(vSnakeRound.x)) + 1e-5);
          vec3 snakeRoundDir = snakeSideV * snakeRoundV.x * sign(vSnakeRound.x) + snakeUpV * snakeRoundV.y;
          normal = normalize(normal - snakeAheadV * snakeTilt.x + snakeRoundDir * snakeTilt.y);`,
        )
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${SNAKE_FRAG_THROUGH}`);
    };
    material.customProgramCacheKey = () => 'room-snake';
    this.root = new InstancedMesh(geometry, material, count);
    this.root.frustumCulled = false;
    this.root.castShadow = false;
    this.root.receiveShadow = true;
    this.root.renderOrder = 2.5;
    this.root.count = 0;
    for (let i = 0; i < count; i++) {
      this.mark.setX(i, random());
      this.lengths.push(LENGTHS[0] + (LENGTHS[1] - LENGTHS[0]) * random());
    }
  }

  /** Put one on a surface and set it going. */
  place(i: number, spec: SnakePlace): void {
    const way = WAYS[spec.way ?? 'crawl'];
    const seed = this.mark.getX(i);
    const knot = spec.way === 'knot';
    const swimming = spec.way === 'swim';
    const length = spec.length ?? this.lengths[i];
    const girth = spec.girth ?? length * GIRTH;
    // no two knots alike, and never quite the closed figure of eight that lies between these swings
    const swing = spec.swing ?? (knot ? (seed < 0.5 ? 1.9 + seed * 0.7 : 2.5 + seed * 0.5) : way.swing);
    const waves = spec.waves ?? way.waves * (knot ? 0.75 + ((seed * 7.3) % 1) * 0.6 : 1);
    const k = (Math.PI * 2 * waves) / length;
    const mean = bessel(0, swing);
    const speed = spec.speed ?? way.speed;
    this.ahead.setXYZ(i, mean, bessel(2, swing) / k, bessel(4, swing) / (2 * k));
    this.aside.setXYZ(i, (2 * bessel(1, swing)) / k, (2 * bessel(3, swing)) / (3 * k), (2 * bessel(5, swing)) / (5 * k));
    this.body.setXYZW(i, length, girth, k, way.headShare);
    // a knot has no mean advance to speak of: its speed is along the arc
    const rate = knot ? speed : speed / (mean * way.advance);
    this.run.setXYZW(i, -(spec.delay ?? 0) * rate, rate, way.advance, spec.loop ?? 0);
    const bend = spec.bend ?? 0;
    this.form.setXYZW(i, spec.lift ?? way.lift, way.ride * girth, Math.abs(bend) < 0.001 ? 0.001 : bend, spec.climb ?? 0);
    this.mark.setY(i, swimming ? 1 : 0);
    this.sink[i] = swimming ? SINK * girth : 0;
    this.pin(i, spec.at[0], spec.at[1], spec.at[2], spec.heading, spec.normal);
    this.body.needsUpdate = this.run.needsUpdate = this.form.needsUpdate = this.ahead.needsUpdate = this.aside.needsUpdate = this.mark.needsUpdate = true;
    this.placed = Math.max(this.placed, i + 1);
    this.root.count = this.placed;
  }

  /**
   * Hold one by hand (place it first, for its way and size; call this every frame): its head is exactly here (y
   * as in `place`), looking along `heading`, level, `lift` above its body, which trails behind it along a way
   * bent by `bend`. `travelled` is how far it has swum (m): the wave moves with it, and stops when you hold it.
   */
  pose(i: number, x: number, y: number, z: number, heading: number, travelled: number, bend = 0, lift = 0): void {
    this.body.setW(i, 0);
    this.run.setXYZW(i, travelled, 0, 0, 0);
    this.form.setX(i, lift);
    this.form.setZ(i, Math.abs(bend) < 0.001 ? 0.001 : bend);
    this.pin(i, x, y, z, heading);
    this.body.needsUpdate = this.run.needsUpdate = this.form.needsUpdate = true;
  }

  /** How many exist now: the first `count` of those placed (until this is called, all of them). */
  reveal(count: number): void {
    this.root.count = Math.max(0, Math.min(Math.floor(count), this.placed));
  }

  /**
   * All of them hold their heads this much higher (m, 0 lets them down); with `look`, a point of the room, the
   * front of each comes round toward it by the share `turn` (0..1).
   */
  raise(height: number, look?: V3, turn = 1): void {
    this.raised.value.w = height;
    if (look) this.raised.value.set(look[0], look[1], look[2], height);
    this.turned.value = look ? turn : 0;
  }

  /** The time, in seconds: everything they do follows from it. */
  update(time: number): void {
    this.time.value = time;
  }

  private pin(i: number, x: number, y: number, z: number, heading: number, normal?: V3): void {
    q.setFromUnitVectors(UP, normal ? p.set(normal[0], normal[1], normal[2]) : UP).multiply(qHeading.setFromAxisAngle(UP, heading));
    this.root.setMatrixAt(i, m.compose(p.set(x, y - this.sink[i], z), q, ONE));
    this.root.instanceMatrix.needsUpdate = true;
  }
}
