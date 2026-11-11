import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  Vector4,
  type Object3D,
  type PerspectiveCamera,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../../config/experience.config';
import type { SpotSpec } from '../../../config/nightmare.config';
import { meterUVs } from '../../dream/DreamKit';
import { randomFrom } from '../../dream/FigureKit';
import type { DreamLight } from '../../dream/LightPool';
import { clamp, lerp, range, smootherstep, wobble } from '../../math';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import type { RoomVoice } from '../RoomSound';

type V3 = readonly [number, number, number];

const RING = 'rooms/phone_ring.mp3';
const FAR_RING = 'rooms/phone_bell_thin.mp3';
const PICKUP = 'rooms/phone_pickup_1.mp3';
const LINE_HUM = 'rooms/phone_line_dead.mp3';
const BUZZ = 'rooms/sodium_lamp_buzz.mp3';
const WIND = 'rooms/night_wind_far.mp3';
const DRONE = 'rooms/dream_drone_low.mp3';
const LAMP_OFF = 'rooms/relay_clunk_3.mp3';
const LAMP_ON = 'rooms/breaker_clunk_1.mp3';
const STEPS = ['rooms/step_gallery_1.mp3', 'rooms/step_gallery_2.mp3', 'rooms/step_gallery_3.mp3'] as const;

export const assets: RoomAssets = {
  models: ['payphone'],
  materials: ['asphalt', 'steel_scuffed', 'duct_galvanized'],
  sounds: [RING, FAR_RING, PICKUP, LINE_HUM, BUZZ, WIND, DRONE, LAMP_OFF, LAMP_ON, ...STEPS],
};

/** The beats (s into the room): the telephone rings every three seconds; the last ring stops halfway. */
const RINGS = [0, 3, 6, 9];
const RING_CUT = 10;
/** The receiver lifts out of its cradle, falls, and the cord catches it (s). */
const SLIDES = 10.05;
const LIFT_TAKES = 0.22;
const FALL_TAKES = 0.4;
const HANGS = SLIDES + LIFT_TAKES + FALL_TAKES;
/** The voice in the receiver (s). */
const LINE_AT = 11;
/** The lamp sags once (s, how deep, how long in s), then goes out (s); its glass stays a dull red this long (s, time constant), this bright. */
const SAG_AT = 13.5;
const SAG = 0.35;
const SAG_TAKES = 0.6;
const LAMP_OUT = 15;
const EMBER_FADE = 1.1;
const EMBER_CORE = 0.3;
const EMBER_GLASS = 1.2;
/** How much the lamp's light wavers on the mains (share). */
const LAMP_WAVER = 0.03;
/** Everything but the receiver's hum falls silent here (s). */
const QUIET_AT = 14.2;
/** Far across the square another lamp comes on, and its telephone rings (s); it strikes at this share of its light and warms to full over FAR_WARM s. */
const FAR_ON = 16.5;
const FAR_WARM = 1.8;
const FAR_STRIKES = 0.14;
const FAR_RINGS = [17, 20];
/** The picture (s); if the viewer is looking further away than this (rad), it waits for them until the latest (s). */
const SHUTTER_AT = 18.6;
const LOOKING_AWAY = 0.6;
const SHUTTER_LATEST = 19.6;
const CUT = 21.5;

/** Where the walk ends (s), and the length of a slow step on it (m); how much the eye floats while walking and once it stands. */
const WALK_ENDS = 10;
const STRIDE = 0.74;
const DRIFT_WALK = 0.6;
const DRIFT_HELD = 0.3;

/** The near telephone stands at the room's origin; the far one, beside the same painted line, here (m). */
const FAR_AT: readonly [number, number] = [-3.3, -19];
/** The post (m): half its width, its height; the bottom of the telephone on it, and the gap between them. */
const POST_HALF = 0.045;
const POST_H = 1.84;
/** Grey paint on the post's steel. */
const POST_TINT = 0x55595a;
const PHONE_Y = 0.92;
const PHONE_GAP = 0.002;
/** Where the telephone's body lies in its file (m): side to side without the receiver, and its back. */
const BODY_X: readonly [number, number] = [-0.167, 0.1445];
const BODY_BACK = -0.1024;
/**
 * The receiver and its cord are islands of the telephone's one mesh, known by their bounds in the file (m): the
 * receiver from 0.32 to 0.59 up, wholly left of the body; the cord from the ground of the file up to 0.40.
 */
const RECEIVER_LOW: readonly [number, number] = [0.31, 0.34];
const RECEIVER_TOP: readonly [number, number] = [0.58, 0.6];
const RECEIVER_RIGHT = -0.175;
const CORD_LOW = 0.01;
const CORD_TOP: readonly [number, number] = [0.39, 0.41];
const CORD_RIGHT = -0.165;
/** In the file (m): where the cord leaves the body (a grommet on its left side), and where it goes into the receiver. */
const CORD_FROM: V3 = [-0.171, 0.4016, -0.0127];
const CORD_INTO: V3 = [-0.2172, 0.345, 0.104];
/** Which way the cord leaves the grommet, and the receiver (in the receiver's own frame). */
const GROMMET_OUT = new Vector3(-0.25, -1, 0.1).normalize();
const RECEIVER_OUT = new Vector3(0, -1, 0.25).normalize();
/** The cord (m): how far its ends reach into the loop while the receiver is on its hook, its length hanging, how thick, how finely it is drawn, its steel. */
const CORD_LOOP = 0.48;
const CORD_LENGTH = 0.55;
const CORD_RADIUS = 0.0045;
const CORD_SEGMENTS = 40;
const CORD_SIDES = 6;
const CORD_COLOR = 0x3a3c3e;
/** How the receiver leaves the cradle (m): up and out toward you; how far its top tips forward meanwhile (rad). */
const LIFT_BY = new Vector3(-0.012, 0.022, 0.05);
const TIP = 0.3;
/** How it swings on the cord: out to the side and toward you at first (rad), its rate (rad/s, a pendulum of about 0.7 m), how fast it dies (s). */
const SWING_REST = -0.1;
const SWING_SIDE = REDUCED_MOTION ? 0.06 : 0.15;
const SWING_FORE = REDUCED_MOTION ? 0.1 : 0.3;
const SWING_RATE = 3.75;
const SWING_DIES = 3.2;
/** How it turns on the cord as the cord unwinds (rad, rad/s, s); how far it bounces when the cord catches it (m, s). */
const TWIST = REDUCED_MOTION ? 0.4 : 0.9;
const TWIST_RATE = 1.1;
const TWIST_DIES = 6;
const BOUNCE = 0.03;
const BOUNCE_TAKES = 0.28;

/** The display in the file (m): its middle and size, how brightly it is lit (emissive). It always says half past six. */
const LCD_AT: V3 = [-0.0225, 0.659, 0.1132];
const LCD_SIZE: readonly [number, number] = [0.165, 0.048];
const LCD_GLOW = 0.55;

/** The lamp, from its telephone (m): its galvanized pole behind and to the right, the pole's height, the head over the receiver's side, how far its nose is raised (rad), the zinc's tint. */
const POLE_AT: readonly [number, number] = [1.25, -0.9];
const POLE_H = 7;
const HEAD_AT: V3 = [-0.3, 6.4, 0.7];
const HEAD_TILT = 0.06;
const POLE_TINT = 0x5f5e5a;
/** Where the posts and poles meet the asphalt, darker (x, z, radius m), and how much darker at most. */
const FEET: readonly V3[] = [
  [0, 0.08, 0.24],
  [POLE_AT[0], POLE_AT[1], 0.32],
  [FAR_AT[0], FAR_AT[1] + 0.08, 0.24],
  [FAR_AT[0] + POLE_AT[0], FAR_AT[1] + POLE_AT[1], 0.32],
];
const CONTACT = 0.6;
/** Sodium: the color of the lamps, and of one striking before it has warmed. */
const SODIUM = 0xff9a3c;
const STRIKE = 0xff3d22;
const EMBER = 0xff4a18;
/** The lamp's light: the key spot (cd, half angle deg, softness), where it points; the fill from its head (cd, m). */
const KEY_POWER = 150;
const KEY_ANGLE = 40;
const KEY_SOFT = 0.85;
const KEY_TARGET: V3 = [-0.15, 0, 0.1];
/** The far lamp is brighter than its twin, so that its telephone stands out against its pool through the fog (cd). */
const FAR_KEY_POWER = 190;
const LAMP_POINT = 1.4;
const LAMP_REACH = 16;
/** The far lamp's fill reaches the wet ground between you and it, where it makes its long reflection (cd, m). */
const FAR_POINT = 5;
const FAR_REACH = 32;
/** The lamp seen in the fog: halo size (m) and strength, core size and strength, the cone of lit air. */
const HALO_SIZE = 9;
const HALO = 0.07;
const CORE_SIZE = 1.1;
const CORE = 1;
const CORE_COLOR = 0xffd2a0;
const LENS = 3;
const BEAM = 0.075;
const BEAM_FOOT = 5.2;
/** A lamp seen in the wet asphalt: how bright its column of light is, and how narrow across and how long down the view (rad). */
const SHINE = 1.6;
const FAR_SHINE = 0.8;
const SHINE_ACROSS = 0.013;
const SHINE_DOWN = 0.13;
/** The ripples that break that column into bands (per m along the view). */
const RIPPLES = 23;
/** The mist that drifts in the lamp's light: how many motes, their color and strength. */
const MIST = 180;
const MIST_COLOR = 0xffcf9a;
const MIST_STRENGTH = 0.45;

/** The square (m): how far it goes, its asphalt's tile and tint, the painted lines (every so many m, their width). */
const GROUND_HALF = 130;
const ASPHALT_TILE = 3;
const ASPHALT_TINT = 0x6d6a64;
/** All of it is damp: its roughness is the map's times this. */
const ASPHALT_ROUGH = 0.72;
const LINE_X = -2.6;
const LINE_X_EVERY = 9;
const LINE_Z = -3.2;
const LINE_Z_EVERY = 20;
const LINE_HALF = 0.06;
/** The wet: how wide its pattern is (m) and its canvas (px); how dark and how glossy a puddle is, and the paint. */
const WET_TILE = 24;
const WET_PX = 512;
const WET_DARK = 0.62;
const WET_ROUGH = 0.16;
const PAINT_ROUGH = 0.62;
/** The puddles that matter (m, in the room): in front of the telephone, behind it on the way to the far one, on your way. Radius (m), stretch along z. */
const PUDDLES: readonly (readonly [number, number, number, number])[] = [
  [-0.3, 1.1, 0.9, 0.8],
  [1.5, 2.6, 0.55, 1.2],
  [-1.5, -3.4, 1.1, 2.3],
  [-1.6, 5.2, 0.8, 1.4],
  [-1.0, 8.6, 0.65, 1.1],
  [-2.1, 12.3, 0.9, 1.6],
];

/** The night: the fog, its color at the horizon, the sky straight up, how far the sky dome is (m), the faint light of the sky on things. */
const FOG_COLOR = 0x0e1514;
const FOG_DENSITY = 0.028;
const ZENITH = 0x040607;
const SKY_RADIUS = 200;
const ENV = 0.04;
/** The grade: as it is, and how far the eye opens in the dark (exposure), over how long (s). */
const EXPOSURE = 1.18;
const EXPOSURE_DARK = 1.55;
const EYE_OPENS = 1.3;

/** The lens: open at first, wider at the end, so that the near telephone goes soft against the far one. */
const APERTURE_WALK = 1.4;
const APERTURE_END = 3.2;
/** The middle of the near telephone, where the lens is focused while you walk; how far the far one is from the end of the walk (m), and when the focus is pulled there (s after it comes on). */
const PHONE_MIDDLE: V3 = [0, 1.25, 0.2];
const FAR_FOCUS = 21;
const FOCUS_PULL: readonly [number, number] = [0.4, 2];

/** Gains: the beds (the lamp's buzz grows between these seconds), and how loud each ring is as you come nearer (with less reverb, and more air: low-pass Hz). */
const BUZZ_FAR = 0.04;
const BUZZ_NEAR = 0.16;
const BUZZ_RISES: readonly [number, number] = [5, 8.5];
const WIND_GAIN = 0.07;
const DRONE_GAIN = 0.08;
const HUM_GAIN = 0.14;
const RING_GAIN = [0.45, 0.38, 0.45, 0.55];
const RING_REVERB = [0.7, 0.65, 0.55, 0.45];
const RING_AIR = [5000, 5500, 7000, 12000];
const RING_PAN = 0.12;
const STEP_GAIN = 0.16;
const FAR_GAIN = 0.25;
const FAR_PAN = -0.3;
/** The low dread comes back under the far bell (s). */
const DREAD_RETURNS = 18;

const TAU = Math.PI * 2;
const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** The fog's own color all round the horizon (where the square ends in it), going dark straight up. */
const SKY_FRAG = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uZenith;
varying vec3 vDir;
void main() {
  float up = max(normalize(vDir).y, 0.0);
  gl_FragColor = vec4(mix(uHorizon, uZenith, pow(min(up / 0.55, 1.0), 0.7)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * What the asphalt's shader adds: the wet map, the eye and the lamps for what the wet mirrors, where the feet stand,
 * and the square's painted lines, every so many meters, anti-aliased by how much a pixel covers.
 */
const GROUND_HEAD = /* glsl */ `
uniform sampler2D uWet;
uniform vec3 uEye;
uniform vec4 uNearLamp;
uniform vec4 uFarLamp;
uniform vec3 uNearColor;
uniform vec3 uFarColor;
varying vec2 vGround;
float groundWet;
float groundPaint;
const vec3 FEET[4] = vec3[4](${FEET.map(([x, z, r]) => `vec3(${x.toFixed(3)}, ${z.toFixed(3)}, ${r.toFixed(3)})`).join(', ')});
float paintedLine(float v, float at, float every) {
  float d = abs(mod(v - at + every * 0.5, every) - every * 0.5) - ${LINE_HALF.toFixed(3)};
  float aa = fwidth(v) * 1.2;
  return 1.0 - smoothstep(-aa, aa, d);
}
// a lamp (xyz, w its strength) seen in the wet, as rippled water draws it: a narrow column of its light, brightest
// where its mirror image lies under the ground, and running from there back to the lamp's foot
float wetShine(vec4 lamp) {
  vec3 a = vec3(vGround.x, 0.0, vGround.y) - uEye;
  vec3 m = vec3(lamp.x, -lamp.y, lamp.z) - uEye;
  vec3 f = vec3(lamp.x, 0.0, lamp.z) - uEye;
  float across = atan(a.x * m.z - a.z * m.x, a.x * m.x + a.z * m.z);
  float mirror = atan(m.y, length(m.xz));
  float up = atan(a.y, length(a.xz)) - mirror;
  float reach = max(atan(f.y, length(f.xz)) - mirror, 0.02) * 0.7;
  float along = up > 0.0 ? exp(-up * up / (reach * reach)) : exp(-up * up / ${(SHINE_DOWN * SHINE_DOWN).toFixed(5)});
  return lamp.w * along * exp(-across * across / ${(SHINE_ACROSS * SHINE_ACROSS).toFixed(6)});
}`;

/** Wet where the puddles are, a little lighter or darker in slow patches, worn white paint in lines. */
const GROUND_COLOR = /* glsl */ `
vec4 wetHere = texture2D(uWet, vGround / ${WET_TILE.toFixed(1)});
float patches = texture2D(uWet, vGround / ${(WET_TILE * 3.7).toFixed(1)} + vec2(0.37, 0.71)).b;
groundWet = smoothstep(0.42, 0.62, wetHere.r);
groundPaint = max(paintedLine(vGround.x, ${LINE_X.toFixed(2)}, ${LINE_X_EVERY.toFixed(1)}), paintedLine(vGround.y, ${LINE_Z.toFixed(2)}, ${LINE_Z_EVERY.toFixed(1)}));
groundPaint *= smoothstep(0.32, 0.62, wetHere.g);
diffuseColor.rgb *= 0.74 + 0.52 * patches;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.48, 0.41), groundPaint * 0.85);
diffuseColor.rgb *= mix(1.0, ${WET_DARK.toFixed(2)}, groundWet);
// what no shadow gives: the dark where the posts and the poles stand on the asphalt
for (int i = 0; i < 4; i++) {
  vec2 off = vGround - FEET[i].xy;
  diffuseColor.rgb *= 1.0 - ${CONTACT.toFixed(2)} * exp(-dot(off, off) / (FEET[i].z * FEET[i].z));
}`;

const ramp = (a: number, b: number, v: number): number => smootherstep(range(a, b, v));

/** A canvas drawn in grey, as numbers 0..255 per pixel (its red channel). */
function greyLayer(size: number, draw: (g: CanvasRenderingContext2D) => void): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  draw(g);
  return g.getImageData(0, 0, size, size).data;
}

/** A soft round of light added at every place it wraps to on a tiling canvas. */
function blot(g: CanvasRenderingContext2D, size: number, x: number, y: number, rx: number, ry: number, value: number): void {
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      const cx = x + dx;
      const cy = y + dy;
      const r = Math.max(rx, ry);
      if (cx < -r || cx > size + r || cy < -r || cy > size + r) continue;
      g.save();
      g.translate(cx, cy);
      g.scale(rx / r, ry / r);
      const c = g.createRadialGradient(0, 0, 0, 0, 0, r);
      c.addColorStop(0, `rgba(255,255,255,${value})`);
      c.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = c;
      g.fillRect(-r, -r, r * 2, r * 2);
      g.restore();
    }
  }
}

/** The wet of the square, tiling every WET_TILE m: r the puddles, g where the paint still holds, b slow patches of the tar. */
function wetMap(): CanvasTexture {
  const S = WET_PX;
  const m = S / WET_TILE;
  const random = randomFrom(31);
  // z grows up the canvas: it is turned over on its way to the GPU
  const px = (x: number) => (((x % WET_TILE) + WET_TILE) % WET_TILE) * m;
  const py = (z: number) => S - (((z % WET_TILE) + WET_TILE) % WET_TILE) * m;
  const puddles = greyLayer(S, (g) => {
    g.globalCompositeOperation = 'lighter';
    for (const [x, z, r, stretch] of PUDDLES) {
      for (let k = 0; k < 9; k++) {
        const a = random() * TAU;
        const off = random() * r * 0.6;
        blot(g, S, px(x + Math.cos(a) * off), py(z + Math.sin(a) * off * stretch), r * (0.45 + random() * 0.35) * m, r * stretch * (0.45 + random() * 0.35) * m, 0.42);
      }
    }
    for (let i = 0; i < 80; i++) {
      const r = (0.12 + random() * random() * 0.6) * m;
      blot(g, S, random() * S, random() * S, r, r * (0.6 + random() * 0.9), 0.22 + random() * 0.38);
    }
  });
  const paint = greyLayer(S, (g) => {
    g.fillStyle = '#c4c4c4';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(0,0,0,${0.2 + random() * 0.6})`;
      g.beginPath();
      g.ellipse(random() * S, random() * S, 0.5 + random() * 3.5, 0.5 + random() * 2, random() * 3, 0, TAU);
      g.fill();
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(0,0,0,${0.5 + random() * 0.5})`;
      g.fillRect(random() * S, random() * S, 4 + random() * 30, 4 + random() * 30);
    }
  });
  const patches = greyLayer(S, (g) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i++) {
      const r = (0.04 + random() * 0.16) * S;
      const light = random() < 0.5;
      const x = random() * S;
      const y = random() * S;
      for (const dx of [-S, 0, S]) {
        for (const dy of [-S, 0, S]) {
          const c = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
          c.addColorStop(0, light ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.26)');
          c.addColorStop(1, 'rgba(128,128,128,0)');
          g.fillStyle = c;
          g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
        }
      }
    }
  });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d')!;
  const image = g.createImageData(S, S);
  for (let i = 0; i < S * S * 4; i += 4) {
    image.data[i] = puddles[i];
    image.data[i + 1] = paint[i];
    image.data[i + 2] = patches[i];
    image.data[i + 3] = 255;
  }
  g.putImageData(image, 0, 0);
  const t = new CanvasTexture(canvas);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** The telephone's display: a dull lit green, the ghosts of all its segments, and the time. */
function drawDisplay(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#5f7a5a';
  c.fillRect(0, 0, w, h);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `bold ${Math.round(h * 0.74)}px "Courier New", monospace`;
  c.fillStyle = 'rgba(16,26,14,0.13)';
  c.fillText('88:88', w / 2, h * 0.55);
  c.fillStyle = '#101a0c';
  c.fillText('18:30', w / 2, h * 0.55);
  const shade = c.createLinearGradient(0, 0, 0, h);
  shade.addColorStop(0, 'rgba(0,0,0,0.35)');
  shade.addColorStop(0.3, 'rgba(0,0,0,0)');
  c.fillStyle = shade;
  c.fillRect(0, 0, w, h);
}

/** Parts of one solid as one geometry: all with the same attributes, none indexed. */
function solid(parts: BufferGeometry[]): BufferGeometry {
  return mergeGeometries(
    parts.map((g) => {
      g.deleteAttribute('uv1');
      return g.index ? g.toNonIndexed() : g;
    }),
  )!;
}

/** Cylinder or tube UVs from 0..1 to meters, so that a surface tiles at its true size. */
function inMeters(g: BufferGeometry, along: number, around: number, swap = false): BufferGeometry {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (swap) uv.setXY(i, v * around, u * along);
    else uv.setXY(i, u * around, v * along);
  }
  return g;
}

/** One telephone on its post under its lamp, and what the lamp makes of the fog. */
interface Station {
  root: Group;
  /** The telephone's file as placed (its own space), and its one mesh. */
  file: Object3D;
  phone: Mesh;
  lens: MeshBasicMaterial;
  halo: Color;
  core: Color;
  beam: { value: number };
  mist: Color;
  mistTime: { value: number };
}

/**
 * A square of wet asphalt at night, so wide that the fog ends it, and in the middle of it one telephone on its post
 * under one sodium lamp, ringing. You walk to it. The ring stops halfway, the receiver slides off its hook and hangs,
 * and a small voice in it asks for you. The lamp goes out. Far across the square another lamp comes on over another
 * telephone, beside the same painted line, and that one begins to ring.
 */
export default class Payphone extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: FOG_COLOR, density: FOG_DENSITY },
    env: 'evening',
    envIntensity: ENV,
    sky: 0,
    grade: { exposure: EXPOSURE, saturation: 0.8, warmth: 0.02, tint: -0.02, flare: 0.003 },
  };
  film = { bloom: 1, bloomFrom: 0.6, bloomTint: [1, 0.72, 0.42] as const, grain: 0.45, scratches: 0.05, flicker: 0.02, weave: REDUCED_MOTION ? 0 : 0.0004, aberration: 0.1 };
  focus = 15;
  aperture = APERTURE_WALK;
  drift = REDUCED_MOTION ? 0 : DRIFT_WALK;
  fear = 0.4;
  control = { look: true, scroll: true, hurry: 1.8 };

  private readonly dome: Mesh;
  private readonly near: Station;
  private readonly far: Station;
  private readonly key: SpotSpec;
  private readonly farKey: SpotSpec;
  private readonly nearLight: DreamLight;
  private readonly farLight: DreamLight;
  /** What the wet ground mirrors: the eye, and each lamp's place, strength and color (room frame). */
  private readonly shine = {
    uEye: { value: new Vector3() },
    uNearLamp: { value: new Vector4(HEAD_AT[0], HEAD_AT[1], HEAD_AT[2], SHINE) },
    uFarLamp: { value: new Vector4(FAR_AT[0] + HEAD_AT[0], HEAD_AT[1], FAR_AT[1] + HEAD_AT[2], 0) },
    uNearColor: { value: new Color(SODIUM) },
    uFarColor: { value: new Color(SODIUM) },
  };

  /** The receiver hangs from its own point (where its cord goes in), in the room's frame. */
  private readonly receiver = new Group();
  private readonly cordFrom = new Vector3();
  private readonly cordInto = new Vector3();
  private readonly cordPositions = new Float32Array((CORD_SEGMENTS + 1) * CORD_SIDES * 3);
  private readonly cordNormals = new Float32Array((CORD_SEGMENTS + 1) * CORD_SIDES * 3);
  private readonly cord: Mesh;
  private posed = -1;

  private readonly glowColor = new Color();
  private readonly farColor = new Color();
  private readonly sodium = new Color(SODIUM);
  private readonly strike = new Color(STRIKE);
  private readonly ember = new Color(EMBER);
  private readonly coreSodium = new Color(CORE_COLOR);

  private readonly lifted = new Vector3();
  private readonly hang = new Vector3();
  private readonly into = new Vector3();
  private readonly p1 = new Vector3();
  private readonly p2 = new Vector3();
  private readonly point = new Vector3();
  private readonly tangent = new Vector3();
  private readonly side = new Vector3();
  private readonly up = new Vector3();
  private readonly swing = new Quaternion();
  private readonly twist = new Quaternion();
  private readonly flip = new Quaternion().setFromAxisAngle(X_AXIS, Math.PI);
  private readonly tip = new Quaternion();
  private readonly hanging = new Quaternion();
  private readonly euler = new Euler();
  private readonly eye = new Vector3();

  private lastRing: RoomVoice | null = null;
  private buzz: RoomVoice | null = null;
  private wind: RoomVoice | null = null;
  private drone: RoomVoice | null = null;
  private hum: RoomVoice | null = null;
  private shot = false;

  constructor(ctx: RoomContext) {
    super(ctx);
    const k = (s: number, at: V3, yaw: number, pitch: number, fov: number): RoomKey => ({ t: s / this.seconds, at, yaw, pitch, fov });
    this.keys = [
      k(0, [-1.5, 1.63, 13.5], -6, 2.5, 44),
      k(3, [-1.38, 1.62, 10.3], -7, 1.5, 44),
      k(6, [-1.18, 1.61, 6.7], -9, -1, 43),
      k(8.5, [-0.98, 1.59, 3.9], -13, -4, 42),
      k(WALK_ENDS, [-0.88, 1.57, 2.3], -18, -7, 41.5),
      k(11.5, [-0.85, 1.55, 1.95], -20, -12.5, 42),
      k(14.5, [-0.84, 1.54, 1.88], -20.5, -13.5, 41.5),
      k(FAR_ON + 0.1, [-0.84, 1.54, 1.86], -20, -13, 41.5),
      k(18.3, [-0.86, 1.56, 1.85], -10, -4.5, 47),
      k(this.seconds, [-0.9, 1.57, 1.65], -9, -4, 46),
    ];

    this.dome = this.buildSky();
    this.buildGround();
    this.near = this.buildStation(0, 0, true);
    this.far = this.buildStation(FAR_AT[0], FAR_AT[1], false);
    this.far.root.visible = false;
    this.cord = this.buildReceiver();

    const [hx, hy, hz] = HEAD_AT;
    this.key = this.spot([hx, hy - 0.07, hz], KEY_TARGET, SODIUM, KEY_POWER, KEY_ANGLE, KEY_SOFT);
    this.farKey = this.spot([FAR_AT[0] + hx, hy - 0.07, FAR_AT[1] + hz], [FAR_AT[0] + KEY_TARGET[0], 0, FAR_AT[1] + KEY_TARGET[2]], SODIUM, 0, KEY_ANGLE, KEY_SOFT);
    this.spots = [this.key, this.farKey, null];
    this.nearLight = this.light([hx, hy - 0.2, hz], SODIUM, LAMP_POINT, LAMP_REACH);
    this.farLight = this.light([FAR_AT[0] + hx, hy - 0.2, FAR_AT[1] + hz], SODIUM, 0, FAR_REACH);

    this.writeBeats();
  }

  /** The night all round: the fog's color at the horizon, darker overhead. */
  private buildSky(): Mesh {
    const dome = new Mesh(
      new SphereGeometry(SKY_RADIUS, 32, 16),
      new ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: { uHorizon: { value: new Color(FOG_COLOR) }, uZenith: { value: new Color(ZENITH) } },
        side: BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    dome.frustumCulled = false;
    // after the piece's own black sky, and behind everything by depth
    dome.renderOrder = 2.5;
    this.root.add(dome);
    return dome;
  }

  /** Asphalt as far as the fog, wet in places, with the worn lines of a square far too big. */
  private buildGround(): void {
    const kit = this.kit;
    const geometry = new BufferGeometry();
    const h = GROUND_HALF;
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([-h, 0, h, h, 0, h, h, 0, -h, -h, 0, -h]), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array([-h, -h, h, -h, h, h, -h, h]), 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const material = kit.surface('asphalt', ASPHALT_TILE, { color: new Color(ASPHALT_TINT), roughness: ASPHALT_ROUGH });
    const wet = wetMap();
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uWet = { value: wet };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position.xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GROUND_HEAD}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${GROUND_COLOR}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(roughnessFactor, ${PAINT_ROUGH.toFixed(2)}, groundPaint), ${WET_ROUGH.toFixed(2)}, groundWet);`)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, groundWet * 0.9));')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float ripple = 0.5 + 0.5 * sin(vGround.y * ${RIPPLES.toFixed(1)} + vGround.x * 1.3 + wetHere.b * 9.0);
          totalEmissiveRadiance += (uNearColor * wetShine(uNearLamp) + uFarColor * wetShine(uFarLamp)) * (0.15 + 0.85 * groundWet) * (0.25 + 0.75 * ripple);`,
        );
      Object.assign(shader.uniforms, this.shine);
    };
    material.customProgramCacheKey = () => 'payphone-ground';
    const ground = new Mesh(geometry, material);
    ground.receiveShadow = true;
    ground.frustumCulled = false;
    this.root.add(ground);
  }

  /** A telephone on its post, its lamp, and the lit fog under the lamp (`x`, `z`: where the post stands). */
  private buildStation(x: number, z: number, near: boolean): Station {
    const { kit, build: b } = this;
    const root = new Group();
    root.position.set(x, 0, z);
    this.root.add(root);

    // the post: a steel square tube on a bolted plate, capped
    const steel = kit.surface('steel_scuffed', 1, { color: new Color(POST_TINT), metalness: 0.5, roughness: 0.62 });
    const postParts: BufferGeometry[] = [
      meterUVs(new BoxGeometry(POST_HALF * 2, POST_H, POST_HALF * 2)).translate(0, POST_H / 2, 0),
      meterUVs(new BoxGeometry(0.22, 0.012, 0.22)).translate(0, 0.006, 0),
      meterUVs(new BoxGeometry(POST_HALF * 2 + 0.016, 0.012, POST_HALF * 2 + 0.016)).translate(0, POST_H + 0.006, 0),
    ];
    for (const [bx, bz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) postParts.push(new CylinderGeometry(0.012, 0.013, 0.016, 8).translate(bx * 0.082, 0.018, bz * 0.082));
    const post = new Mesh(solid(postParts), steel);
    post.castShadow = near;
    post.receiveShadow = true;
    root.add(post);

    // the telephone, its back on the post's face
    const pivot = kit.prop('payphone', [0, PHONE_Y, 0], { castShadow: near }, root);
    const holder = pivot.children[0];
    const file = holder.children[0];
    pivot.position.set(-(holder.position.x + (BODY_X[0] + BODY_X[1]) / 2), PHONE_Y, POST_HALF + PHONE_GAP - (holder.position.z + BODY_BACK));
    const phone = file.getObjectByProperty('isMesh', true) as Mesh;
    const display = b.label(LCD_SIZE[0], LCD_SIZE[1], drawDisplay, { px: 1600, emissive: LCD_GLOW });
    display.mesh.position.set(...LCD_AT);
    file.add(display.mesh);

    // the lamp: a galvanized pole on a flange, an arm, and a flat head with its glass underneath
    const zinc = kit.surface('duct_galvanized', 1, { color: new Color(POLE_TINT), metalness: 0.55, roughness: 0.55 });
    const [px, pz] = POLE_AT;
    const [hx, hy, hz] = HEAD_AT;
    const poleParts: BufferGeometry[] = [
      inMeters(new CylinderGeometry(0.055, 0.085, POLE_H, 14, 1), POLE_H, TAU * 0.07).translate(px, POLE_H / 2, pz),
      inMeters(new CylinderGeometry(0.16, 0.17, 0.035, 18), 0.035, TAU * 0.165).translate(px, 0.0175, pz),
      new SphereGeometry(0.06, 12, 6, 0, TAU, 0, Math.PI / 2).translate(px, POLE_H, pz),
      meterUVs(new BoxGeometry(0.09, 0.26, 0.012)).translate(px, 0.62, pz + 0.083),
    ];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      poleParts.push(new CylinderGeometry(0.014, 0.014, 0.03, 8).translate(px + Math.cos(a) * 0.125, 0.045, pz + Math.sin(a) * 0.125));
    }
    const dir = new Vector2(hx - px, hz - pz).normalize();
    const back = new Vector3(hx - dir.x * 0.33, hy + 0.08, hz - dir.y * 0.33);
    const arm = new CatmullRomCurve3([
      new Vector3(px, POLE_H - 0.22, pz),
      new Vector3(px + dir.x * 0.22, POLE_H + 0.1, pz + dir.y * 0.22),
      new Vector3(px + dir.x * 0.9, POLE_H + 0.06, pz + dir.y * 0.9),
      back,
    ]);
    poleParts.push(inMeters(new TubeGeometry(arm, 28, 0.032, 8), arm.getLength(), TAU * 0.032, true));
    const pole = new Mesh(solid(poleParts), zinc);
    pole.castShadow = near;
    pole.receiveShadow = true;
    root.add(pole);

    const head = new Group();
    head.position.set(hx, hy + 0.06, hz);
    head.rotation.set(-HEAD_TILT, Math.atan2(dir.x, dir.y), 0, 'YXZ');
    const profile = [[0, 0], [0.07, 0.01], [0.12, 0.06], [0.15, 0.16], [0.16, 0.3], [0.155, 0.45], [0.13, 0.58], [0.09, 0.67], [0.04, 0.715], [0, 0.72]].map(([r, y]) => new Vector2(r, y));
    const shell = new LatheGeometry(profile, 20).translate(0, -0.36, 0).rotateX(Math.PI / 2).scale(1, 0.45, 1);
    head.add(new Mesh(shell, zinc));
    const lens = new MeshBasicMaterial({ color: new Color(SODIUM).multiplyScalar(LENS) });
    const glass = new Mesh(new SphereGeometry(1, 20, 8, 0, TAU, Math.PI / 2, Math.PI / 2), lens);
    glass.scale.set(0.115, 0.05, 0.25);
    glass.position.set(0, -0.045, 0.07);
    head.add(glass);
    root.add(head);

    const haloMesh = b.glow(hx, hy - 0.02, hz, HALO_SIZE, SODIUM, HALO, root);
    const coreMesh = b.glow(hx, hy - 0.02, hz, CORE_SIZE, CORE_COLOR, CORE, root);
    const beamMesh = b.beam(hx, hy - 0.05, hz, 0.2, BEAM_FOOT, hy - 0.05, SODIUM, BEAM, root);
    const mist = b.motes(MIST, { x: [hx - 2.6, hx + 2.6], y: [0.3, hy - 0.6], z: [hz - 2.6, hz + 2.6] }, root, { size: 0.007, color: MIST_COLOR, strength: MIST_STRENGTH, seed: near ? 11 : 12 });
    return {
      root,
      file,
      phone,
      lens,
      halo: (haloMesh.material as ShaderMaterial).uniforms.uColor.value as Color,
      core: (coreMesh.material as ShaderMaterial).uniforms.uColor.value as Color,
      beam: (beamMesh.material as ShaderMaterial).uniforms.uIntensity as { value: number },
      mist: (mist.points.material as ShaderMaterial).uniforms.uColor.value as Color,
      mistTime: mist.time,
    };
  }

  /**
   * The near telephone's receiver and its cord, cut out of its one mesh (they are islands of it: faces joined to
   * each other and to nothing else): the receiver is hung from its own point, and the cord is drawn anew each frame.
   */
  private buildReceiver(): Mesh {
    this.root.updateMatrixWorld(true);
    const phone = this.near.phone;
    const source = phone.geometry;
    const position = source.getAttribute('position');
    const index = source.getIndex()!;
    const v = new Vector3();

    // the same corner is the same point, whatever its UVs: weld by place, then join what shares a face
    const welded = new Map<number, number>();
    const id = new Int32Array(position.count);
    for (let i = 0; i < position.count; i++) {
      const q = (Math.round(position.getX(i) * 32767) + 32768) * 4294967296 + (Math.round(position.getY(i) * 32767) + 32768) * 65536 + (Math.round(position.getZ(i) * 32767) + 32768);
      let w = welded.get(q);
      if (w === undefined) {
        w = welded.size;
        welded.set(q, w);
      }
      id[i] = w;
    }
    const parent = new Int32Array(welded.size);
    for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = (a: number): number => {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    };
    const tris = index.count / 3;
    for (let t = 0; t < tris; t++) {
      const a = find(id[index.getX(t * 3)]);
      parent[find(id[index.getX(t * 3 + 1)])] = a;
      parent[find(id[index.getX(t * 3 + 2)])] = a;
    }
    // each island's bounds in the file's space
    const bounds = new Float64Array(welded.size * 6);
    for (let i = 0; i < welded.size; i++) bounds.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], i * 6);
    for (let i = 0; i < position.count; i++) {
      const r = find(id[i]) * 6;
      v.fromBufferAttribute(position, i).applyMatrix4(phone.matrix);
      bounds[r] = Math.min(bounds[r], v.x);
      bounds[r + 1] = Math.min(bounds[r + 1], v.y);
      bounds[r + 2] = Math.min(bounds[r + 2], v.z);
      bounds[r + 3] = Math.max(bounds[r + 3], v.x);
      bounds[r + 4] = Math.max(bounds[r + 4], v.y);
      bounds[r + 5] = Math.max(bounds[r + 5], v.z);
    }
    const isReceiver = (r: number) => bounds[r + 3] < RECEIVER_RIGHT && bounds[r + 1] > RECEIVER_LOW[0] && bounds[r + 1] < RECEIVER_LOW[1] && bounds[r + 4] > RECEIVER_TOP[0] && bounds[r + 4] < RECEIVER_TOP[1];
    const isCord = (r: number) => bounds[r + 3] < CORD_RIGHT && bounds[r + 1] < CORD_LOW && bounds[r + 4] > CORD_TOP[0] && bounds[r + 4] < CORD_TOP[1];
    const body: number[] = [];
    const receiver: number[] = [];
    for (let t = 0; t < tris; t++) {
      const r = find(id[index.getX(t * 3)]) * 6;
      const into = isReceiver(r) ? receiver : isCord(r) ? null : body;
      if (into) into.push(index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2));
    }
    const part = (faces: number[]) => {
      const g = new BufferGeometry();
      for (const name of Object.keys(source.attributes)) g.setAttribute(name, source.getAttribute(name));
      g.setIndex(new BufferAttribute(new Uint32Array(faces), 1));
      return g;
    };
    phone.geometry = part(body);

    // the receiver, turned about the point where its cord goes in
    const toRoom = new Matrix4().copy(this.root.matrixWorld).invert().multiply(this.near.file.matrixWorld);
    this.cordFrom.set(...CORD_FROM).applyMatrix4(toRoom);
    this.cordInto.set(...CORD_INTO).applyMatrix4(toRoom);
    const mesh = new Mesh(part(receiver), phone.material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.makeTranslation(-this.cordInto.x, -this.cordInto.y, -this.cordInto.z).multiply(toRoom).multiply(phone.matrix);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.receiver.position.copy(this.cordInto);
    this.receiver.add(mesh);
    this.root.add(this.receiver);

    // a steel-sheathed cord, a tube drawn from the grommet to the receiver
    const faces: number[] = [];
    const uvs = new Float32Array((CORD_SEGMENTS + 1) * CORD_SIDES * 2);
    for (let i = 0; i <= CORD_SEGMENTS; i++) {
      for (let j = 0; j < CORD_SIDES; j++) {
        uvs.set([(j / CORD_SIDES) * TAU * CORD_RADIUS, (i / CORD_SEGMENTS) * CORD_LENGTH], (i * CORD_SIDES + j) * 2);
        if (i === CORD_SEGMENTS) continue;
        const a = i * CORD_SIDES + j;
        const b = i * CORD_SIDES + ((j + 1) % CORD_SIDES);
        faces.push(a, b, a + CORD_SIDES, b, b + CORD_SIDES, a + CORD_SIDES);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.cordPositions, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('normal', new BufferAttribute(this.cordNormals, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setIndex(faces);
    const cord = new Mesh(geometry, this.kit.surface('duct_galvanized', 1, { color: new Color(CORD_COLOR), metalness: 0.8, roughness: 0.45 }));
    cord.castShadow = true;
    cord.frustumCulled = false;
    this.root.add(cord);
    this.poseReceiver(0);
    return cord;
  }

  /** Where the receiver is at second `s`: on its hook, lifting out, falling, then swinging and turning on its cord. */
  private poseReceiver(s: number): void {
    const r = this.receiver;
    let slack = 1;
    if (s < SLIDES) {
      r.position.copy(this.cordInto);
      r.quaternion.identity();
    } else if (s < SLIDES + LIFT_TAKES) {
      const k = ramp(SLIDES, SLIDES + LIFT_TAKES, s);
      r.position.copy(this.cordInto).addScaledVector(LIFT_BY, k);
      r.quaternion.setFromAxisAngle(X_AXIS, TIP * k);
    } else {
      // the pendulum it becomes: about the grommet, the cord straight
      const since = Math.max(0, s - HANGS);
      const dies = Math.exp(-since / SWING_DIES);
      const side = SWING_REST + SWING_SIDE * dies * Math.sin(SWING_RATE * since);
      const fore = -SWING_FORE * dies * Math.sin(SWING_RATE * 1.07 * since);
      this.swing.setFromEuler(this.euler.set(fore, 0, side));
      this.twist.setFromAxisAngle(Y_AXIS, TWIST * Math.exp(-since / TWIST_DIES) * Math.sin(TWIST_RATE * since));
      this.hanging.copy(this.swing).multiply(this.twist).multiply(this.flip);
      this.hang.set(0, -CORD_LENGTH, 0).applyQuaternion(this.swing).add(this.cordFrom);
      if (since < BOUNCE_TAKES) this.hang.y += BOUNCE * Math.sin((Math.PI * since) / BOUNCE_TAKES);
      const fall = range(SLIDES + LIFT_TAKES, HANGS, s);
      if (fall < 1) {
        this.lifted.copy(this.cordInto).add(LIFT_BY);
        const along = smootherstep(fall);
        r.position.set(lerp(this.lifted.x, this.hang.x, along), lerp(this.lifted.y, this.hang.y, fall * fall), lerp(this.lifted.z, this.hang.z, along));
        this.tip.setFromAxisAngle(X_AXIS, TIP);
        r.quaternion.slerpQuaternions(this.tip, this.hanging, along);
        slack = 1 - along;
      } else {
        r.position.copy(this.hang);
        r.quaternion.copy(this.hanging);
        slack = 0;
      }
    }
    this.into.copy(RECEIVER_OUT).applyQuaternion(r.quaternion);
    this.shapeCord(r.position, lerp(CORD_LENGTH / 3, CORD_LOOP, slack));
  }

  /** The cord as one curve from the grommet to the receiver; `reach` how far each end holds its direction (m). */
  private shapeCord(to: Vector3, reach: number): void {
    const from = this.cordFrom;
    this.p1.copy(from).addScaledVector(GROMMET_OUT, reach);
    this.p2.copy(to).addScaledVector(this.into, reach);
    const pos = this.cordPositions;
    const nor = this.cordNormals;
    for (let i = 0; i <= CORD_SEGMENTS; i++) {
      const t = i / CORD_SEGMENTS;
      const u = 1 - t;
      const b0 = u * u * u;
      const b1 = 3 * u * u * t;
      const b2 = 3 * u * t * t;
      const b3 = t * t * t;
      this.point.set(0, 0, 0).addScaledVector(from, b0).addScaledVector(this.p1, b1).addScaledVector(this.p2, b2).addScaledVector(to, b3);
      this.tangent
        .set(0, 0, 0)
        .addScaledVector(from, -3 * u * u)
        .addScaledVector(this.p1, 3 * u * u - 6 * u * t)
        .addScaledVector(this.p2, 6 * u * t - 3 * t * t)
        .addScaledVector(to, 3 * t * t)
        .normalize();
      this.side.crossVectors(this.tangent, X_AXIS).normalize();
      this.up.crossVectors(this.tangent, this.side);
      for (let j = 0; j < CORD_SIDES; j++) {
        const a = (j / CORD_SIDES) * TAU;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const o = (i * CORD_SIDES + j) * 3;
        const nx = this.side.x * c + this.up.x * s;
        const ny = this.side.y * c + this.up.y * s;
        const nz = this.side.z * c + this.up.z * s;
        nor[o] = nx;
        nor[o + 1] = ny;
        nor[o + 2] = nz;
        pos[o] = this.point.x + nx * CORD_RADIUS;
        pos[o + 1] = this.point.y + ny * CORD_RADIUS;
        pos[o + 2] = this.point.z + nz * CORD_RADIUS;
      }
    }
    if (this.cord) {
      this.cord.geometry.getAttribute('position').needsUpdate = true;
      this.cord.geometry.getAttribute('normal').needsUpdate = true;
    }
  }

  private writeBeats(): void {
    const sound = this.sound;
    this.beat(0, () => {
      this.buzz = sound.bed(BUZZ, { gain: BUZZ_FAR, pan: 0.1, fade: 0.3 });
      this.wind = sound.bed(WIND, { gain: WIND_GAIN, lowpass: 1200, fade: 1 });
      this.drone = sound.bed(DRONE, { gain: DRONE_GAIN, fade: 2 });
    });
    // a ring every three seconds in a place with no walls to stop it, each nearer than the last
    RINGS.forEach((at, i) =>
      this.beat(at, () => {
        const ring = sound.play(RING, { gain: RING_GAIN[i], pan: RING_PAN, reverb: RING_REVERB[i], lowpass: RING_AIR[i] });
        if (i === RINGS.length - 1) this.lastRing = ring;
      }),
    );
    this.beat(BUZZ_RISES[0], () => this.buzz?.gain((BUZZ_FAR + BUZZ_NEAR) / 2, BUZZ_RISES[1] - BUZZ_RISES[0]));
    this.beat(BUZZ_RISES[1], () => this.buzz?.gain(BUZZ_NEAR, WALK_ENDS - BUZZ_RISES[1]));
    // the walk, slow steps on the asphalt for as long as the eye goes on
    const random = randomFrom(5);
    const pose = { position: new Vector3(), yaw: 0, pitch: 0, roll: 0, fov: 0 };
    let walked = 0;
    let last = this.pose(0, pose).position.clone();
    let foot = 0;
    for (let s = 0.02; s <= WALK_ENDS; s += 0.02) {
      const here = this.pose(s / this.seconds, pose).position;
      walked += Math.hypot(here.x - last.x, here.z - last.z);
      last = here.clone();
      if (walked < STRIDE * (foot + 1)) continue;
      foot++;
      const file = STEPS[foot % STEPS.length];
      const pan = foot % 2 ? -0.08 : 0.08;
      const rate = 0.92 + random() * 0.1;
      this.beat(s, () => sound.play(file, { gain: STEP_GAIN, pan, rate, reverb: 0.35, lowpass: 3800 }));
    }
    // halfway through a ring it stops, and the receiver comes off its hook by itself
    this.beat(RING_CUT, () => this.lastRing?.stop(0.03));
    this.beat(SLIDES, () => sound.play(PICKUP, { gain: 0.4, pan: 0.2, reverb: 0.3 }));
    this.beat(HANGS, () => sound.play(PICKUP, { gain: 0.16, pan: 0.2, rate: 0.82, offset: 0.18, reverb: 0.35 }));
    this.beat(HANGS + 0.25, () => {
      this.hum = sound.bed(LINE_HUM, { gain: HUM_GAIN, pan: 0.18, fade: 0.4 });
    });
    this.beat(LINE_AT, () => this.say({ tr: 'Alo? Yavrum, sen misin?', en: 'Hello? Is that you, my dear?' }, 3.2, 'phone'));
    // a real silence: only the line's hum is left, then the lamp goes
    this.beat(QUIET_AT, () => {
      this.wind?.gain(0, 0.8);
      this.drone?.gain(0, 0.8);
    });
    this.beat(LAMP_OUT, () => {
      this.buzz?.gain(0, 0.03);
      sound.play(LAMP_OFF, { gain: 0.3, pan: 0.12, reverb: 0.45 });
      this.hum?.gain(HUM_GAIN * 0.6, 1.2);
    });
    this.beat(FAR_ON, () => sound.play(LAMP_ON, { gain: 0.14, pan: FAR_PAN, lowpass: 1800, reverb: 0.6 }));
    for (const at of FAR_RINGS) this.beat(at, () => sound.play(FAR_RING, { gain: FAR_GAIN, pan: FAR_PAN, reverb: 0.6, lowpass: 3200 }));
    this.beat(DREAD_RETURNS, () => this.drone?.gain(DRONE_GAIN * 0.7, CUT - DREAD_RETURNS));
    this.beat(CUT, () => sound.stopAll(0.04));
  }

  prepare(camera: PerspectiveCamera): void {
    this.dome.position.copy(camera.position).sub(this.origin);
    this.shine.uEye.value.copy(this.dome.position);
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const near = this.near;
    const far = this.far;

    // the near lamp: one slow sag, then out; its glass keeps a red that dies
    const sag = 1 - SAG * Math.sin(Math.PI * range(SAG_AT, SAG_AT + SAG_TAKES, s));
    const on = (s < LAMP_OUT ? 1 : 0) * sag * (1 + LAMP_WAVER * wobble(frame.time * 0.8, 3));
    const ember = s < LAMP_OUT ? 0 : Math.exp(-(s - LAMP_OUT) / EMBER_FADE);
    this.key.intensity = KEY_POWER * on;
    this.nearLight.intensity = LAMP_POINT * on;
    near.halo.copy(this.sodium).multiplyScalar(HALO * on);
    near.core.copy(this.coreSodium).multiplyScalar(CORE * on).add(this.glowColor.copy(this.ember).multiplyScalar(EMBER_CORE * ember));
    near.lens.color.copy(this.sodium).multiplyScalar(LENS * on).add(this.glowColor.copy(this.ember).multiplyScalar(EMBER_GLASS * ember));
    near.beam.value = BEAM * on;
    near.mist.setHex(MIST_COLOR).multiplyScalar(MIST_STRENGTH * on);
    near.mistTime.value = frame.time;
    this.shine.uNearLamp.value.w = SHINE * on;

    // the far lamp strikes red and warms to sodium
    far.root.visible = s >= FAR_ON - 0.05;
    const caught = s < FAR_ON ? 0 : FAR_STRIKES + (1 - FAR_STRIKES) * ramp(FAR_ON + 0.25, FAR_ON + FAR_WARM, s);
    this.farColor.copy(this.strike).lerp(this.sodium, ramp(FAR_ON + 0.15, FAR_ON + FAR_WARM, s));
    this.farKey.intensity = FAR_KEY_POWER * caught;
    this.farKey.color = this.farColor.getHex();
    this.farLight.intensity = FAR_POINT * caught;
    this.farLight.color.copy(this.farColor);
    far.halo.copy(this.farColor).multiplyScalar(HALO * caught);
    far.core.copy(this.coreSodium).lerp(this.farColor, 1 - caught).multiplyScalar(CORE * caught);
    far.lens.color.copy(this.farColor).multiplyScalar(LENS * caught);
    far.beam.value = BEAM * caught;
    far.mist.setHex(MIST_COLOR).multiplyScalar(MIST_STRENGTH * caught);
    far.mistTime.value = frame.time;
    this.shine.uFarLamp.value.w = FAR_SHINE * caught;
    this.shine.uFarColor.value.copy(this.farColor);

    // the receiver: only redrawn while it can have moved
    const moving = s >= SLIDES - 0.05 && s < CUT;
    if (moving || this.posed !== 0) {
      this.poseReceiver(s);
      this.posed = moving ? 1 : 0;
    }
    this.movingShadows = s > SLIDES - 0.1 && s < LAMP_OUT + 0.1;

    if (!this.shot && s >= SHUTTER_AT && (Math.abs(frame.input.gazeYaw) < LOOKING_AWAY || s >= SHUTTER_LATEST)) {
      this.shot = true;
      this.shutter(false);
    }

    // the eye: it opens in the dark, and the lens follows what you walk to, then the far light
    this.air.grade.exposure = lerp(EXPOSURE, EXPOSURE_DARK, ramp(LAMP_OUT, LAMP_OUT + EYE_OPENS, s) * (1 - ramp(FAR_ON, FAR_ON + EYE_OPENS, s)));
    this.eye.copy(frame.view.position).sub(this.origin);
    const toPhone = Math.hypot(this.eye.x - PHONE_MIDDLE[0], this.eye.y - PHONE_MIDDLE[1], this.eye.z - PHONE_MIDDLE[2]);
    this.focus = lerp(toPhone, FAR_FOCUS, ramp(FAR_ON + FOCUS_PULL[0], FAR_ON + FOCUS_PULL[1], s));
    this.aperture = lerp(APERTURE_WALK, APERTURE_END, ramp(FAR_ON, FAR_ON + FOCUS_PULL[1], s));
    this.drift = REDUCED_MOTION ? 0 : s < WALK_ENDS ? DRIFT_WALK : DRIFT_HELD;
    this.fear = clamp(0.4 + 0.15 * ramp(6, 10, s) + 0.15 * ramp(10, 11.5, s) + 0.2 * ramp(LAMP_OUT, LAMP_OUT + 0.5, s) - 0.1 * ramp(FAR_ON + 1, FAR_ON + 3, s), 0, 1);
    this.black = s >= CUT ? 1 : 0;
  }
}
