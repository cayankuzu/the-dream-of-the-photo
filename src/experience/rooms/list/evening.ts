import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  CustomBlending,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OneFactor,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SrcAlphaFactor,
  Vector2,
  Vector3,
  Vector4,
  ZeroFactor,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { Text } from '../../../config/copy.config';
import { REDUCED_MOTION } from '../../../config/experience.config';
import { clamp, range, smootherstep } from '../../math';
import type { RoomAir, RoomAssets, RoomContext, RoomFrame, RoomKey } from '../Room';
import { Room } from '../Room';
import type { RoomVoice } from '../RoomSound';

export const assets: RoomAssets = {
  models: ['antique_camera'],
  materials: ['wood_raw_boards'],
  sounds: [
    'rooms/tray_water.mp3',
    'rooms/darkroom_drip.mp3',
    'rooms/plate_set_2.mp3',
    'rooms/fluorescent_tick_1.mp3',
    'rooms/fluorescent_tick_3.mp3',
    'rooms/dream_drone_low.mp3',
    'rooms/dream_drone_glass.mp3',
    'rooms/cutlery_far.mp3',
  ],
};

/** The tray (m): outer width and depth, height, its rolled rim, how far its sides lean out, its corner radius, its floor. */
const TRAY = { w: 0.5, d: 0.4, h: 0.062, rim: 0.011, lean: 0.016, corner: 0.036, floor: 0.006 };
/** How far the tray lies turned on the bench (rad). */
const TRAY_TURN = 0.022;
/** The second tray's middle (m): half of it is out of the first frame. */
const OTHER_TRAY = [0.635, 0.03] as const;
/** The paper and the square picture on it (m), and how far the sheet has drifted round (rad). */
const SHEET = 0.29;
const PICTURE = 0.25;
const SHEET_TURN = -0.05;
/** A print comes up with the whole range of its picture: the share of it let go dark or light at each end, the least range that is stretched (on the paper's scale), the size of the copy that is measured (px), and the fixed levels when there is no picture. */
const LEVELS_CLIP = 0.02;
const LEVELS_LEAST = 0.3;
const LEVELS_PROBE = 48;
const LEVELS_PLAIN: readonly [number, number] = [0.12, 1.95];
/** How much harder than its picture the developed print is (0 is the picture as it was). */
const PRINT_GRADE = 1;
/** How much of their shine the enamel and the paper lose under the developer: the lamp is seen in the skin of the liquid, not as a glare on the floor of the tray. */
const WET_DULL = 0.85;
/** The eye of the whorl, which the current keeps clear of hair (m): there the picture always shows. */
const WHORL_EYE = 0.06;
/** The camera's height over the bench at the first and last moment (m); on the last evening it comes closer. */
const HEIGHT_FROM = 0.94;
const HEIGHT_TO = 0.69;
const HEIGHT_TO_LAST = 0.6;
/** The safelight (m): where it hangs, half the size of its glass. */
const LAMP = [-0.66, 1.65, -0.34] as const;
const GLASS = [0.13, 0.1] as const;
/** The glass as the liquid shows it, so that it reads as the lamp and not as glare: how soft its edge is and how wide the lip of its frame (m in the lamp's plane), how bright its pane and its middle, and how much the lip shades it. */
const GLASS_EDGE = 0.007;
const GLASS_LIP_WIDE = 0.02;
const GLASS_PANE = 0.42;
const GLASS_CORE = 0.26;
const GLASS_LIP = 0.45;
/** Its colour, key light (cd), the half-angle of its pool (deg), and the fill that keeps the edge of the dark alive (cd). */
const RED = 0xff1608;
const KEY_LIGHT = 10.5;
const POOL = 11.5;
const FILL_LIGHT = 0.35;
const FAR_LIGHT = 0.7;
/** A low light along the bench, so that its grain, its water and the apron's folds are there at the edge of seeing (cd), and what little the room gives back. */
const GRAZE_LIGHT = 0.16;
const ENV_LIGHT = 0.02;
/** The glass as seen when you look up at it (HDR red). */
const GLASS_GLOW = 3.2;
/** The drying wires overhead, a line in the lamp's plane through (x, y) with normal (nx, ny) (m from the lamp): they lie on the liquid as threads of light. */
const WIRES = [
  { x: 0.55, y: 0.35, nx: 0.28, ny: 0.96 },
  { x: 0.95, y: 0.1, nx: 0.91, ny: 0.41 },
] as const;
/** Hair (HDR red, it sits under the liquid), its half-width (m), length range (m) and points per strand. */
const HAIR_RED = 1.3;
const HAIR_HALF = 0.0003;
const HAIR_LONG = [0.16, 0.46] as const;
const HAIR_SEGMENTS = 26;
/** How much your own hair sways round the middle of the picture (rad/s). */
const FALLEN_TURN = 0.006;
/** The current: where its eye is in the tray (m), and how fast it turns (rad/s at the middle). */
const CURRENT_AT = [0.018, -0.012] as const;
const CURRENT = 0.21;
/** One row per evening (visits 2 to 7): liquid level (m), hairs in it, your own hair before the lens, and who stands behind you in the lamp's reflection [x, y, size] (m in the lamp's plane; size 0 is nobody). */
const EVENINGS = [
  { level: 0.034, hairs: 6, fallen: 0, someone: [0, 0, 0] },
  { level: 0.034, hairs: 10, fallen: 0, someone: [0.09, 0.095, 0.4] },
  { level: 0.055, hairs: 20, fallen: 0, someone: [0.05, 0.075, 0.55] },
  { level: 0.055, hairs: 40, fallen: 6, someone: [0.025, 0.05, 0.75] },
  { level: 0.055, hairs: 260, fallen: 10, someone: [0, 0.035, 1.05] },
  { level: 0.058, hairs: 1050, fallen: 24, someone: [0, 0.01, 1.6] },
] as const;
/** How slowly the one behind you comes closer within an evening (m/s in the lamp's plane). */
const SOMEONE_COMES = 0.0016;
/** How much the waves of the surface bend the light on the floor of the tray (0.02 is about what a shallow tray does). */
const CAUSTIC = 0.02;

/** Seconds into the ten-second evening. */
const TONGS_REST = 2;
const LINE_AT = 3.5;
const LINE_HOLD = 5.5;
const DEVELOP_FROM = 3.9;
const DEVELOP_TO = 9.7;
/** The light breathes once at the start: rises so much, and sinks so much (0..1 of its strength). */
const BREATH_UP = 0.08;
const BREATH_DOWN = 0.3;
/** On the sixth evening the breath is deep enough to hide what the tongs do. */
const BREATH_DOWN_TONGS = 0.94;
/** The filament ticks at these seconds, and the light jumps by this much (0..1). */
const TICK_AT = [0.85, 3.05, 4.7, 8.6];
const TICK_DIP = 0.05;
/** Evening 5: the lamp goes out and comes back (s); the print's faint light of its own (HDR); how far it gets by itself (0..1). */
const DARK_FROM = 5.4;
const DARK_TO = 6.5;
const OWN_LIGHT = 0.085;
const DARK_GAIN = 0.2;
/** The last evening: the shutter, just before the cut (s). */
const SHUTTER_AT = 9.4;
/** The drips in rooms/darkroom_drip.mp3 fall at these seconds: the rings answer them, where and how hard. */
const DRIPS = [
  { at: 2.5, x: 0.072, z: -0.061, amp: 0.012 },
  { at: 3.7, x: -0.066, z: 0.081, amp: 0.009 },
  { at: 8.3, x: 0.108, z: 0.041, amp: 0.008 },
];
const RINGS = 5;
/** The tongs: tips in the tray (m), heading and tilt (rad), and their length (m). */
const TONGS_LONG = 0.25;
const TONGS_HELD = { x: 0.176, y: 0.031, z: 0.038, heading: -0.24, tilt: 0.5 };
const TONGS_RESTING = { x: 0.168, y: 0.026, z: 0.052, heading: -0.305, tilt: 0.43 };
const TONGS_ACROSS = { x: -0.128, y: 0.0115, z: 0.086, heading: 0.57, tilt: 0 };
/** Where the brown bottle stands (m). */
const BOTTLE_AT = [-0.335, -0.168] as const;
/** Water standing on the bench: how many beads. */
const BEADS = 130;
/** The size of the marks painted on the bench (m). */
const MARKS = { w: 2, d: 1.2 };
/** The fingerprint, in the picture's own coordinates (0..1): its middle and half its size. A thumb too large for a hand. */
const PRINTED_AT = { x: 0.63, y: 0.56, w: 0.16, h: 0.2 };

/** What is said over the tray on each evening: the two halves of the motto take turns. */
const LINES: readonly Text[] = [
  { tr: 'Bir fotoğrafın rüyası her akşam yarım.', en: 'The dream of a photograph, every evening, half.' },
  { tr: 'Bir fotoğrafın rüyası saç beyazlatır.', en: 'The dream of a photograph turns hair white.' },
  { tr: 'Dün gece de buraya kadar gelmiştin.', en: 'You got this far last night too.' },
  { tr: 'Saçın artık kendi saçın değil.', en: 'Your hair is no longer your own.' },
  { tr: 'Bu akşam bitecek sandın.', en: 'You thought it would end this evening.' },
  { tr: 'Son akşam. Yemek soğudu.', en: 'The last evening. Dinner has gone cold.' },
];

const LIQUID_VERT = /* glsl */ `
varying vec3 vAt;
varying vec3 vView;
varying vec2 vTray;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vAt = world.xyz - modelMatrix[3].xyz;
  vView = cameraPosition - world.xyz;
  vTray = position.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const LIQUID_FRAG = /* glsl */ `
uniform float uTime, uLit, uCaustic;
uniform vec3 uLamp, uSomeone;
uniform vec2 uGlass, uHalf;
uniform vec4 uRings[RINGS], uWires[2];
varying vec3 vAt;
varying vec3 vView;
varying vec2 vTray;

// one travelling wave: its slope along x and z, and how it gathers the light under it
vec3 wave(vec2 p, float angle, float k, float w, float a) {
  vec2 dir = vec2(cos(angle), sin(angle));
  float phase = dot(p, dir) * k + uTime * w;
  return vec3(dir * a * k * cos(phase), -a * k * k * sin(phase));
}
// whoever stands between the lamp and the liquid
float someone(vec2 p) {
  float head = length(p * vec2(1.0, 0.82)) - 0.05;
  float neck = max(abs(p.x) - 0.021, abs(p.y - 0.07) - 0.05);
  float body = length((p - vec2(0.0, 0.2)) * vec2(0.55, 1.0)) - 0.095;
  return min(min(head, neck), body);
}
void main() {
  vec2 p = vTray;
  vec2 q = p + 0.03 * vec2(sin(p.y * 13.0 + uTime * 0.37), cos(p.x * 11.0 - uTime * 0.31)) + 0.011 * vec2(cos(p.x * 37.0 + p.y * 23.0 + uTime * 0.7), sin(p.y * 41.0 - p.x * 19.0 - uTime * 0.6));
  vec3 broad = wave(q, 0.21, 14.0, 1.6, 0.0011) + wave(q, 1.34, 43.0, 2.9, 0.00034) + wave(q, 2.46, 89.0, 4.7, 0.00014);
  vec3 fine = wave(q, 3.54, 157.0, 7.1, 0.00006) + wave(q, 4.9, 251.0, 9.7, 0.000026);
  for (int i = 0; i < RINGS; i++) {
    vec2 to = p - uRings[i].xy;
    float len = length(to) + 1e-4;
    float w = (len - uRings[i].z) / 0.016;
    float env = uRings[i].w * exp(-w * w);
    broad += vec3(to / len * env * sin(w * 3.0), 3.5 * env * (3.0 * cos(w * 3.0) - 2.0 * w * sin(w * 3.0)) / 0.016);
  }
  vec3 s = broad + fine;
  vec3 n = normalize(vec3(-s.x, 1.0, -s.y));
  vec3 v = normalize(vView);
  vec3 r = reflect(-v, normalize(vec3(-broad.x * 1.3, 1.0, -broad.y * 1.3)));
  // the safelight's glass, seen in the surface
  vec2 hit = vAt.xz + r.xz * (uLamp.y - vAt.y) / max(r.y, 0.05) - uLamp.xz;
  vec2 box = abs(hit + fine.xy * 1.2) - uGlass;
  float outside = max(box.x, box.y);
  float glass = smoothstep(${GLASS_EDGE.toFixed(4)}, -${GLASS_EDGE.toFixed(4)}, outside) * (${GLASS_PANE.toFixed(3)} + ${GLASS_CORE.toFixed(3)} * exp(-dot(hit, hit) * 55.0)) * (1.0 - ${GLASS_LIP.toFixed(3)} * smoothstep(-${GLASS_LIP_WIDE.toFixed(4)}, 0.0, outside));
  if (uSomeone.z > 0.0) glass *= smoothstep(-0.008, 0.008, someone((hit - uSomeone.xy) / uSomeone.z) * uSomeone.z);
  // the drying wires overhead: threads of light that crawl over the whole surface
  float wires = exp(-pow(dot(hit - uWires[0].xy, uWires[0].zw) / 0.032, 2.0)) + exp(-pow(dot(hit - uWires[1].xy, uWires[1].zw) / 0.026, 2.0));
  vec3 h = normalize(v + normalize(uLamp - vAt));
  float nh = max(dot(n, h), 0.0);
  float glint = 0.5 * pow(nh, 1400.0);
  // the skin climbs the wall, and is brightest there
  vec2 d = abs(p) - uHalf + 0.03;
  float wall = smoothstep(-0.008, 0.0, length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - 0.03);
  float bent = 1.0 / max(0.4, 1.0 + uCaustic * s.z);
  float through = clamp(0.84 * bent * bent * (1.0 + dot(s.xy, vec2(-0.8, -0.6)) * 1.2) * (1.0 - 0.25 * wall), 0.0, 1.0);
  gl_FragColor = vec4(vec3(1.0, 0.055, 0.025) * uLit * (glass + glint + wires * 0.2 + wall * wall * 0.1), through);
}`;

const PAPER_HEAD = /* glsl */ `
uniform float uDevelop, uSelf, uShiver;
uniform vec2 uLevels;
uniform sampler2D uMark;`;

const BORDER = ((SHEET - PICTURE) / 2 / SHEET).toFixed(4);
const PAPER_DEVELOP = /* glsl */ `
vec2 st = (vMapUv - vec2(${BORDER})) / (1.0 - 2.0 * vec2(${BORDER}));
// the picture wavers under its skin of liquid
st += 0.0028 * vec2(sin(vMapUv.y * 43.0 + uShiver * 1.9) + sin(vMapUv.y * 101.0 - uShiver * 3.4), cos(vMapUv.x * 37.0 - uShiver * 1.7) + sin(vMapUv.x * 93.0 + uShiver * 2.9));
float tone = clamp((pow(dot(texture2D(map, st).rgb, vec3(0.3, 0.59, 0.11)), 0.46) - uLevels.x) * uLevels.y, 0.0, 1.0);
// the paper is harder than the picture: deeper shadows, cleaner lights
tone = mix(tone, tone * tone * (3.0 - 2.0 * tone), ${PRINT_GRADE.toFixed(2)});
vec2 press = (st - vec2(${PRINTED_AT.x}, ${PRINTED_AT.y})) / vec2(${PRINTED_AT.w}, ${PRINTED_AT.h});
float mark = texture2D(uMark, press * 0.5 + 0.5).r * step(max(abs(press.x), abs(press.y)), 1.0);
// the chemistry is never even across a sheet, and a touched place runs ahead of the rest
float wash = 0.05 * sin(vMapUv.x * 9.0 + vMapUv.y * 4.0) + 0.04 * sin(vMapUv.y * 13.0 - vMapUv.x * 6.0 + 1.3);
float d = uDevelop * 1.32 + wash * smoothstep(0.0, 0.3, uDevelop) + mark * 0.4 * smoothstep(0.0, 0.1, uDevelop);
// the shadows arrive first, the lights last, as on real paper
float arrived = smoothstep(tone * 0.86, tone * 0.86 + 0.36, d);
float inside = smoothstep(0.0, 0.003, min(min(st.x, st.y), 1.0 - max(st.x, st.y)));
float ink = pow(max(tone * 0.93 + 0.012, 0.0), 2.2);
ink = mix(ink, mix(0.42, ink * 0.2, smoothstep(0.1, 0.3, ink)), mark * 0.9);
diffuseColor.rgb = vec3(mix(0.86, ink, arrived * inside));`;

const HAIR_VERT = /* glsl */ `
attribute vec2 hairAt;
uniform float uTurn, uTime, uFade;
uniform vec2 uCenter, uBounds;
uniform vec3 uDrop;
varying float vGleam;
void main() {
  vec3 p = position;
  vec2 rel = p.xz - uCenter;
  // the current carries each hair round, the inner ones faster
  float turn = uTurn * (0.6 + 0.4 * sin(hairAt.y)) / (0.5 + length(rel) * 5.0);
  float c = cos(turn), s = sin(turn);
  p.xz = uCenter + vec2(rel.x * c - rel.y * s, rel.x * s + rel.y * c);
  p.x += 0.0035 * sin(uTime * 0.37 + hairAt.y + hairAt.x * 4.0);
  p.z += 0.0035 * cos(uTime * 0.31 + hairAt.y * 1.7 + hairAt.x * 3.0);
  if (uBounds.x > 0.0) p.xz = clamp(p.xz, -uBounds, uBounds);
  p += uDrop;
  vGleam = (0.72 + 0.28 * sin(hairAt.x * 17.0 + hairAt.y + uTime * 0.5)) * mix(1.0, smoothstep(0.0, 0.4, hairAt.x), uFade);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const HAIR_FRAG = /* glsl */ `
uniform vec4 uColor;
varying float vGleam;
void main() { gl_FragColor = vec4(uColor.rgb * vGleam, uColor.a); }`;

/** So that a bench looks the same every evening, and yesterday's hairs are still there today. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function painted(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  return map;
}

function blotch(c: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, a: number): void {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(0.6, `rgba(${rgb},${a * 0.55})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

function chip(c: CanvasRenderingContext2D, x: number, y: number, r: number, random: () => number): void {
  const corners = 5 + Math.floor(random() * 5);
  c.beginPath();
  for (let k = 0; k < corners; k++) {
    const a = (k / corners) * Math.PI * 2;
    const reach = r * (0.45 + random() * 0.8);
    c.lineTo(x + Math.cos(a) * reach, y + Math.sin(a) * reach);
  }
  c.closePath();
  c.fill();
}

/** A soft dark rectangle: only the shadow of a rectangle drawn out of sight. */
function softRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, blur: number, color: string, turn = 0): void {
  c.save();
  c.translate(x + w / 2, y + h / 2);
  c.rotate(turn);
  c.shadowColor = color;
  c.shadowBlur = blur;
  c.shadowOffsetX = 20000;
  c.fillStyle = '#000';
  c.fillRect(-w / 2 - 20000, -h / 2, w, h);
  c.restore();
}

/** The marks of years, on a clear layer over the bench's boards: what has soaked in stays wet to the eye. */
function benchMarks(visit: number): CanvasTexture {
  return painted(2048, 1228, (c, w) => {
    const random = seeded(71);
    const k = w / MARKS.w;
    const X = (x: number) => (x + MARKS.w / 2) * k;
    const Z = (z: number) => (z + MARKS.d / 2) * k;
    for (let i = 0; i < 60; i++) {
      const close = random() < 0.7;
      const x = close ? -0.1 + (random() - 0.5) * 1.1 : (random() - 0.5) * MARKS.w;
      const z = close ? (random() - 0.5) * 0.7 : (random() - 0.5) * MARKS.d;
      blotch(c, X(x), Z(z), (0.03 + random() * 0.17) * k, '12,4,1', 0.05 + random() * 0.2);
    }
    // the ghosts of trays that stood here before this one
    c.lineJoin = 'round';
    for (let i = 0; i < 4; i++) {
      c.save();
      c.translate(X(-0.02 + (random() - 0.5) * 0.09), Z((random() - 0.5) * 0.07));
      c.rotate((random() - 0.5) * 0.12);
      c.strokeStyle = `rgba(5,2,0,${0.25 + random() * 0.3})`;
      c.lineWidth = (0.003 + random() * 0.005) * k;
      c.strokeRect((-TRAY.w / 2) * k, (-TRAY.d / 2) * k, TRAY.w * k, TRAY.d * k);
      c.restore();
    }
    softRect(c, X(-TRAY.w / 2 + 0.006), Z(-TRAY.d / 2 + 0.008), TRAY.w * k, TRAY.d * k, 0.03 * k, 'rgba(0,0,0,0.95)');
    softRect(c, X(OTHER_TRAY[0] - TRAY.w / 2 + 0.006), Z(OTHER_TRAY[1] - TRAY.d / 2 + 0.008), TRAY.w * k, TRAY.d * k, 0.03 * k, 'rgba(0,0,0,0.95)');
    blotch(c, X(BOTTLE_AT[0] + 0.012), Z(BOTTLE_AT[1] + 0.012), 0.082 * k, '0,0,0', 0.95);
    // rings left by bottles put down wet
    c.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const start = random() * 6.28;
      c.strokeStyle = `rgba(9,3,1,${0.35 + random() * 0.4})`;
      c.lineWidth = 1.6 + random() * 4;
      c.beginPath();
      c.arc(X(-0.5 + random() * 1.15), Z(-0.33 + random() * 0.66), (0.038 + random() * 0.024) * k, start, start + 2 + random() * 4.2);
      c.stroke();
    }
    // knife marks, cut paper, a pale nick in the wood with its dark lip
    for (let i = 0; i < 95; i++) {
      const x = X((random() - 0.5) * 1.7);
      const z = Z((random() - 0.5) * 1);
      const a = random() * Math.PI;
      const long = (0.02 + random() * random() * 0.22) * k;
      const width = 0.6 + random() * 1.4;
      c.lineWidth = width;
      c.strokeStyle = 'rgba(5,2,0,0.4)';
      c.beginPath();
      c.moveTo(x + 1.4, z + 1.4);
      c.lineTo(x + 1.4 + Math.cos(a) * long, z + 1.4 + Math.sin(a) * long);
      c.stroke();
      c.strokeStyle = `rgba(226,190,170,${0.07 + random() * 0.18})`;
      c.beginPath();
      c.moveTo(x, z);
      c.lineTo(x + Math.cos(a) * long, z + Math.sin(a) * long);
      c.stroke();
    }
    for (let i = 0; i < 520; i++) {
      const a = random() * 6.283;
      const reach = 0.26 + random() * random() * 0.32;
      c.fillStyle = `rgba(8,3,1,${0.2 + random() * 0.5})`;
      c.beginPath();
      c.arc(X(Math.cos(a) * reach * 1.25 - 0.02), Z(Math.sin(a) * reach * 0.95), 0.4 + random() * random() * 3.4, 0, 6.283);
      c.fill();
    }
    // someone has been counting the evenings on the bench, one stroke for each
    const atX = X(0.05);
    const atZ = Z(0.241);
    const strokes: [number, number, number, number][] = [];
    for (let i = 0; i < visit; i++) {
      const x = atX + (i > 4 ? i * 0.0125 + 0.009 : i * 0.0125) * k + (random() - 0.5) * 3;
      if (i === 4) strokes.push([atX - 0.004 * k, atZ + 0.029 * k, atX + 0.046 * k, atZ + 0.006 * k]);
      else strokes.push([x, atZ + (random() - 0.5) * 4, x + (random() - 0.5) * 7, atZ + 0.036 * k + (random() - 0.5) * 6]);
    }
    c.lineWidth = 3;
    for (const [x0, z0, x1, z1] of strokes) {
      c.strokeStyle = 'rgba(4,1,0,0.8)';
      c.beginPath();
      c.moveTo(x0 + 2, z0 + 2);
      c.lineTo(x1 + 2, z1 + 2);
      c.stroke();
      c.strokeStyle = 'rgba(244,214,196,0.72)';
      c.beginPath();
      c.moveTo(x0, z0);
      c.lineTo(x1, z1);
      c.stroke();
    }
  });
}

function enamelMap(): CanvasTexture {
  return painted(1200, 960, (c, w, h) => {
    const random = seeded(23);
    const k = w / TRAY.w;
    c.fillStyle = '#c7c0b1';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) blotch(c, random() * w, random() * h, 20 + random() * 150, '150,118,88', 0.03 + random() * 0.07);
    // years of developer gather in the corners and along the foot of the walls
    const foot = (TRAY.rim + TRAY.lean) * k;
    for (const [x, y] of [[foot, foot], [w - foot, foot], [w - foot, h - foot], [foot, h - foot]]) {
      for (let i = 0; i < 6; i++) blotch(c, x + (random() - 0.5) * 70, y + (random() - 0.5) * 70, 100 + random() * 210, '78,38,10', 0.2 + random() * 0.25);
    }
    // a tide line for every level it has stood at
    c.lineJoin = 'round';
    for (let i = 0; i < 9; i++) {
      const inset = foot * (0.75 + random() * 1.05);
      c.strokeStyle = `rgba(66,30,8,${0.08 + random() * 0.2})`;
      c.lineWidth = 0.8 + random() * 2.6;
      c.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
    }
    // the enamel crazed
    for (let i = 0; i < 150; i++) {
      let x = random() * w;
      let y = random() * h;
      let a = random() * 6.283;
      c.strokeStyle = `rgba(70,40,20,${0.05 + random() * 0.14})`;
      c.lineWidth = 0.5 + random();
      c.beginPath();
      c.moveTo(x, y);
      for (let n = 0; n < 7; n++) {
        a += (random() - 0.5) * 1.5;
        x += Math.cos(a) * (6 + random() * 22);
        y += Math.sin(a) * (6 + random() * 22);
        c.lineTo(x, y);
      }
      c.stroke();
    }
    softRect(c, w / 2 - (SHEET / 2) * k + 0.005 * k, h / 2 - (SHEET / 2) * k + 0.006 * k, SHEET * k, SHEET * k, 0.012 * k, 'rgba(30,12,4,0.85)', -SHEET_TURN);
    // chips: black iron showing through, most of them at the rim
    c.fillStyle = '#0a0807';
    for (let i = 0; i < 420; i++) {
      const side = Math.floor(random() * 4);
      const u = random();
      const inward = random() * random() * TRAY.rim * 1.35 * k;
      const x = side === 0 || side === 1 ? u * w : side === 2 ? inward : w - inward;
      const y = side === 0 ? inward : side === 1 ? h - inward : side === 2 ? u * h : u * h;
      chip(c, x, y, 1.2 + random() * random() * (Math.abs(u - 0.5) > 0.38 ? 15 : 9), random);
    }
    for (let i = 0; i < 16; i++) {
      c.fillStyle = 'rgba(26,12,5,0.9)';
      chip(c, foot * 0.7 + random() * (w - foot * 1.4), foot * 0.7 + random() * (h - foot * 1.4), 1 + random() * 3, random);
    }
    c.strokeStyle = 'rgba(10,8,7,0.95)';
    c.lineWidth = 5;
    c.strokeRect(1, 1, w - 2, h - 2);
  });
}

/** A thumb, seen from the paper's side: ridges round a core, with a few of the breaks that make it someone's. */
function fingerprint(): CanvasTexture {
  return painted(384, 480, (c, w, h) => {
    const random = seeded(19);
    c.fillStyle = '#000';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#fff';
    c.lineCap = 'round';
    const cx = w * 0.5;
    const cy = h * 0.48;
    for (let ring = 1; ring < 24; ring++) {
      c.lineWidth = 4.2 + random() * 1.6;
      c.beginPath();
      for (let a = 0; a <= 6.283; a += 0.08) {
        const bulge = 1 + 0.07 * Math.sin(a * 3 + ring * 0.35) + 0.035 * Math.sin(a * 7 + ring * 0.8);
        const r = (ring * 9.4 + a * 1.5) * bulge;
        const x = cx + Math.cos(a) * r * 0.82;
        const y = cy + Math.sin(a) * r * 1.02;
        if (a === 0 || random() < 0.012) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
    }
    c.globalCompositeOperation = 'multiply';
    const g = c.createRadialGradient(cx, cy, w * 0.12, cx, cy, w * 0.5);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.7, '#ddd');
    g.addColorStop(1, '#000');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });
}

/** A point of the tray's outline shrunk by `inset`: `corner` 0..3, `a` 0..1 along that corner's arc. */
function outline(inset: number, corner: number, a: number): [number, number] {
  const radius = Math.max(TRAY.corner - inset, 0.002);
  const sx = corner === 0 || corner === 3 ? 1 : -1;
  const sz = corner === 0 || corner === 1 ? 1 : -1;
  const angle = (corner + a) * (Math.PI / 2);
  return [sx * (TRAY.w / 2 - inset - radius) + Math.cos(angle) * radius, sz * (TRAY.d / 2 - inset - radius) + Math.sin(angle) * radius];
}

/** One pressed enamel tray: rings of the outline carried from the middle of its floor up the wall, over the rolled rim and down the outside. */
function trayGeometry(): BufferGeometry {
  const { rim, lean, h, floor, w, d } = TRAY;
  const edge = rim + lean + 0.006;
  const profile: readonly [number, number][] = [
    [d / 2 - 0.002, floor],
    [edge + 0.012, floor],
    [edge, floor],
    [rim + lean + 0.001, floor + 0.005],
    [rim + lean * 0.75, floor + 0.016],
    [rim + 0.001, h - 0.002],
    [rim * 0.62, h + 0.0035],
    [rim * 0.2, h + 0.002],
    [0, h - 0.003],
    [rim * 0.3, h - 0.0065],
    [rim * 0.4 + lean * 0.9, 0.0005],
  ];
  const perCorner = 7;
  const around = perCorner * 4;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  profile.forEach(([inset, y]) => {
    for (let corner = 0; corner < 4; corner++) {
      for (let k = 0; k < perCorner; k++) {
        const [x, z] = outline(inset, corner, k / (perCorner - 1));
        positions.push(x, y, z);
        uvs.push((x + w / 2) / w, 1 - (z + d / 2) / d);
      }
    }
  });
  for (let ring = 0; ring < profile.length - 1; ring++) {
    for (let i = 0; i < around; i++) {
      const a = ring * around + i;
      const b = ring * around + ((i + 1) % around);
      const c = a + around;
      const e = b + around;
      index.push(a, b, e, a, e, c);
    }
  }
  const g = new BufferGeometry();
  g.setIndex(index);
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

/** The liquid fills the tray to the wall at its level; depth hides what is a little too wide. */
function surfaceGeometry(inset: number): BufferGeometry {
  const shape = new Shape();
  for (let corner = 0; corner < 4; corner++) {
    for (let k = 0; k <= 8; k++) {
      const [x, z] = outline(inset, corner, k / 8);
      if (corner === 0 && k === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    }
  }
  return new ShapeGeometry(shape).rotateX(-Math.PI / 2);
}

/** Where the darkest and the lightest of a picture lie on the paper's scale, measured once on a small copy: [lowest, 1 / range]. */
function levels(picture: CanvasImageSource): readonly [number, number] {
  const probe = document.createElement('canvas');
  probe.width = probe.height = LEVELS_PROBE;
  const ink = probe.getContext('2d', { willReadFrequently: true });
  if (!ink) return LEVELS_PLAIN;
  let px: Uint8ClampedArray;
  try {
    ink.drawImage(picture, 0, 0, LEVELS_PROBE, LEVELS_PROBE);
    px = ink.getImageData(0, 0, LEVELS_PROBE, LEVELS_PROBE).data;
  } catch {
    return LEVELS_PLAIN;
  }
  const linear = (c: number) => (c <= 10.31 ? c / 3294.6 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const tones = new Float32Array(LEVELS_PROBE * LEVELS_PROBE);
  for (let i = 0; i < tones.length; i++) tones[i] = (0.3 * linear(px[i * 4]) + 0.59 * linear(px[i * 4 + 1]) + 0.11 * linear(px[i * 4 + 2])) ** 0.46;
  tones.sort();
  const low = tones[Math.floor((tones.length - 1) * LEVELS_CLIP)];
  const high = Math.max(tones[Math.ceil((tones.length - 1) * (1 - LEVELS_CLIP))], low + LEVELS_LEAST);
  return [low, 1 / (high - low)];
}

/** A sheet of wet paper: its corners want to curl. */
function sheetGeometry(): BufferGeometry {
  const g = new PlaneGeometry(SHEET, SHEET, 18, 18).rotateX(-Math.PI / 2);
  const at = g.getAttribute('position');
  for (let i = 0; i < at.count; i++) {
    const x = at.getX(i) / (SHEET / 2);
    const z = at.getZ(i) / (SHEET / 2);
    const corner = x * x * z * z;
    at.setY(i, 0.0011 + 0.0046 * corner * corner + 0.0006 * Math.sin(x * 3.1 + z * 1.7));
  }
  g.computeVertexNormals();
  return g;
}

function strands(positions: number[], at: number[], index: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setIndex(index);
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('hairAt', new Float32BufferAttribute(at, 2));
  return g;
}

/** Hairs lying along the current: each turns toward the whorl and curls a little by itself. Ribbons that face up. */
function trayHair(count: number, y: number, boundX: number, boundZ: number): BufferGeometry {
  const random = seeded(90);
  const positions: number[] = [];
  const at: number[] = [];
  const index: number[] = [];
  const whorl = (x: number, z: number) => Math.atan2(z - CURRENT_AT[1], x - CURRENT_AT[0]) + Math.PI / 2 + 0.3 + 0.55 * Math.sin(x * 11 + z * 7);
  for (let i = 0; i < count; i++) {
    let x = (random() * 2 - 1) * boundX;
    let z = (random() * 2 - 1) * boundZ;
    let heading = whorl(x, z) + (random() - 0.5) * 1.4;
    const step = (HAIR_LONG[0] + (HAIR_LONG[1] - HAIR_LONG[0]) * random()) / HAIR_SEGMENTS;
    const phase = random() * 6.283;
    const depth = y - random() * 0.006;
    const base = positions.length / 3;
    for (let k = 0; k <= HAIR_SEGMENTS; k++) {
      // the current keeps the eye of its whorl clear
      const out = WHORL_EYE / Math.max(Math.hypot(x - CURRENT_AT[0], z - CURRENT_AT[1]), 1e-4);
      if (out > 1) {
        x = CURRENT_AT[0] + (x - CURRENT_AT[0]) * out;
        z = CURRENT_AT[1] + (z - CURRENT_AT[1]) * out;
      }
      const nx = -Math.sin(heading) * HAIR_HALF;
      const nz = Math.cos(heading) * HAIR_HALF;
      positions.push(x - nx, depth, z - nz, x + nx, depth, z + nz);
      at.push(k / HAIR_SEGMENTS, phase, k / HAIR_SEGMENTS, phase);
      if (k < HAIR_SEGMENTS) {
        const a = base + k * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      let toward = whorl(x, z) - heading;
      toward = Math.atan2(Math.sin(toward), Math.cos(toward));
      heading += toward * 0.2 + (random() - 0.5) * 0.22;
      x = clamp(x + Math.cos(heading) * step, -boundX, boundX);
      z = clamp(z + Math.sin(heading) * step, -boundZ, boundZ);
    }
  }
  return strands(positions, at, index);
}

/** Your own hair, fallen forward as you lean over the tray: long strands just before the lens, in from the upper edge and the sides of the picture. Local -Y runs away from the eye, local +Z down the picture. */
function fallenHair(count: number): BufferGeometry {
  const random = seeded(12);
  const depth = 0.16;
  const halfHeight = depth * 0.325;
  const halfWidth = halfHeight * 1.78;
  const halfThick = 0.0001;
  const positions: number[] = [];
  const at: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < count; i++) {
    const side = random() < 0.55 ? 0 : random() < 0.5 ? -1 : 1;
    let x = side === 0 ? (random() * 2 - 1) * halfWidth : side * halfWidth * 1.06;
    let z = side === 0 ? -halfHeight * 1.08 : -halfHeight * (0.1 + random() * 0.8);
    let heading = side === 0 ? Math.PI / 2 + (random() - 0.5) * 0.5 : side > 0 ? Math.PI - 0.5 : 0.5;
    const step = (halfHeight * (0.45 + random() * 0.55)) / HAIR_SEGMENTS;
    const phase = random() * 6.283;
    const base = positions.length / 3;
    for (let k = 0; k <= HAIR_SEGMENTS; k++) {
      const nx = -Math.sin(heading) * halfThick;
      const nz = Math.cos(heading) * halfThick;
      positions.push(x - nx, -depth, z - nz, x + nx, -depth, z + nz);
      at.push(k / HAIR_SEGMENTS, phase, k / HAIR_SEGMENTS, phase);
      if (k < HAIR_SEGMENTS) {
        const a = base + k * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      heading += (Math.PI / 2 - heading) * 0.05 + (random() - 0.5) * 0.3;
      x += Math.cos(heading) * step;
      z += Math.sin(heading) * step;
    }
  }
  return strands(positions, at, index);
}

/** Bamboo print tongs: tips at the origin, the spring end along +X, flat. */
function printTongs(): Group {
  const root = new Group();
  root.rotation.order = 'YXZ';
  const cane = new MeshStandardMaterial({ color: 0xa58658, roughness: 0.58 });
  const rubber = new MeshStandardMaterial({ color: 0x090808, roughness: 0.4 });
  const steel = new MeshStandardMaterial({ color: 0x4d443b, roughness: 0.42, metalness: 0.8 });
  const L = TONGS_LONG;
  for (const side of [-1, 1]) {
    const leg = new Shape();
    leg.moveTo(0, side * 0.0215);
    leg.quadraticCurveTo(L * 0.3, side * 0.031, L, side * 0.0075);
    leg.lineTo(L, side * 0.0012);
    leg.quadraticCurveTo(L * 0.3, side * 0.0195, 0, side * 0.012);
    leg.closePath();
    const mesh = new Mesh(new ExtrudeGeometry(leg, { depth: 0.0032, bevelEnabled: true, bevelThickness: 0.0009, bevelSize: 0.0009, bevelSegments: 2, curveSegments: 14 }).rotateX(-Math.PI / 2), cane);
    mesh.castShadow = true;
    root.add(mesh);
    const tip = new Mesh(new CapsuleGeometry(0.0072, 0.03, 3, 10).rotateZ(Math.PI / 2), rubber);
    tip.scale.y = 0.62;
    tip.position.set(0.012, 0.0017, -side * 0.0168);
    tip.castShadow = true;
    root.add(tip);
  }
  const rivet = new Mesh(new CylinderGeometry(0.0115, 0.0115, 0.009, 16), steel);
  rivet.position.set(L - 0.008, 0.0018, 0);
  rivet.castShadow = true;
  root.add(rivet);
  return root;
}

function brownBottle(): Group {
  const root = new Group();
  const profile = [[0, 0], [0.047, 0], [0.055, 0.006], [0.057, 0.02], [0.057, 0.125], [0.052, 0.15], [0.034, 0.176], [0.022, 0.188], [0.02, 0.2], [0.021, 0.205], [0.021, 0.222]].map(([x, y]) => new Vector2(x, y));
  const body = new Mesh(new LatheGeometry(profile, 32), new MeshStandardMaterial({ color: 0x3a1706, roughness: 0.16 }));
  body.castShadow = true;
  root.add(body);
  const cap = new Mesh(new CylinderGeometry(0.0255, 0.0265, 0.034, 24), new MeshStandardMaterial({ color: 0x0a0807, roughness: 0.38 }));
  cap.position.y = 0.232;
  cap.castShadow = true;
  root.add(cap);
  const map = painted(420, 200, (c, w, h) => {
    const random = seeded(5);
    c.fillStyle = '#b9ad97';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 24; i++) blotch(c, random() * w, random() * h, 14 + random() * 70, '62,36,14', 0.12 + random() * 0.3);
    c.strokeStyle = 'rgba(20,12,8,0.9)';
    c.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      c.moveTo(40, 50 + i * 34);
      for (let x = 40; x < 340 - i * 40; x += 14) c.lineTo(x, 50 + i * 34 + (random() - 0.5) * 12);
      c.stroke();
    }
  });
  const label = new Mesh(new CylinderGeometry(0.0578, 0.0578, 0.085, 32, 1, true, 0, 1.9), new MeshStandardMaterial({ map, roughness: 0.75 }));
  label.position.y = 0.072;
  root.add(label);
  return root;
}

/** A glass thermometer laid over the corner of the tray, its bulb in the developer. */
function thermometer(): Group {
  const root = new Group();
  const from = new Vector3(0.132, 0.03, -0.112);
  const to = new Vector3(0.345, 0.112, -0.292);
  const axis = to.clone().sub(from);
  const long = axis.length();
  axis.normalize();
  const side = axis.clone().cross(new Vector3(0, 1, 0)).normalize();
  const up = side.clone().cross(axis).normalize();
  root.position.copy(from);
  root.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(side, axis, up));
  const map = painted(48, 768, (c, w, h) => {
    c.fillStyle = '#d9d3c6';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#16100e';
    for (let i = 0; i < 44; i++) c.fillRect(0, 30 + i * 16, i % 5 === 0 ? 20 : 12, 3);
    c.fillRect(w * 0.6, h * 0.55, 7, h * 0.45);
  });
  const strip = new Mesh(new PlaneGeometry(0.0058, long * 0.86), new MeshStandardMaterial({ map, roughness: 0.6 }));
  strip.position.set(0, long * 0.5, 0.0004);
  root.add(strip);
  const glass = new Mesh(new CapsuleGeometry(0.0043, long - 0.0086, 4, 10), new MeshStandardMaterial({ color: 0xd8d0c8, roughness: 0.08, transparent: true, opacity: 0.34, depthWrite: false }));
  glass.position.y = long * 0.5;
  glass.castShadow = true;
  glass.renderOrder = 6;
  root.add(glass);
  const bulb = new Mesh(new SphereGeometry(0.0062, 12, 8), new MeshStandardMaterial({ color: 0x20191a, roughness: 0.2, metalness: 0.85 }));
  bulb.scale.y = 1.5;
  root.add(bulb);
  return root;
}

/** Your rubber apron, come to rest on the bench as you lean over it: long folds that fall to a welded hem. */
function rubberApron(): Mesh {
  const g = new PlaneGeometry(1.3, 0.34, 120, 26).rotateX(-Math.PI / 2);
  const at = g.getAttribute('position');
  for (let i = 0; i < at.count; i++) {
    const x = at.getX(i);
    const z = at.getZ(i);
    const v = (z + 0.17) / 0.34;
    const fold = Math.sin(x * 23 + Math.sin(z * 9) * 1.3) * 0.5 + Math.sin(x * 51 + z * 7 + 1.1) * 0.25 + Math.sin(x * 9 - z * 3) * 0.6;
    at.setZ(i, z + (1 - v) * Math.sin(x * 14 + 0.6) * 0.012);
    at.setY(i, 0.003 + (0.006 + 0.018 * v) * (fold + 1.2));
  }
  g.computeVertexNormals();
  const map = painted(1536, 400, (c, w, h) => {
    const random = seeded(31);
    c.fillStyle = '#17120f';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) blotch(c, random() * w, random() * h, 16 + random() * 80, '60,44,36', 0.05 + random() * 0.12);
    c.strokeStyle = 'rgba(190,160,140,0.2)';
    for (let i = 0; i < 70; i++) {
      c.lineWidth = 0.6 + random();
      const x = random() * w;
      const y = random() * h;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + (random() - 0.5) * 90, y + (random() - 0.5) * 30);
      c.stroke();
    }
    c.fillStyle = 'rgba(205,180,160,0.5)';
    for (let x = 4; x < w; x += 9) c.fillRect(x, 19 + (random() - 0.5) * 2, 5, 2);
  });
  const mesh = new Mesh(g, new MeshStandardMaterial({ map, roughness: 0.3 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(-0.12, 0, 0.44);
  mesh.rotation.y = -0.09;
  return mesh;
}

/** A ring on the surface: where, when it was made, and how it spreads and dies. */
interface Ring {
  x: number;
  z: number;
  at: number;
  amp: number;
  speed: number;
  fade: number;
  start: number;
}

/**
 * Each evening begins here: a tray of developer under the red lamp, seen from straight above, as if your face were
 * being held over the bench. In it a print comes up, and it is the last picture the shutter took of you. There are
 * more white hairs in the tray than there were yesterday, and at the end they are the tray.
 */
export default class Evening extends Room {
  readonly keys: readonly RoomKey[];
  readonly air: RoomAir = {
    fog: { color: 0x030000, density: 0.02 },
    env: 'fire',
    envIntensity: ENV_LIGHT,
    sky: 0,
    grade: { exposure: 1.2, saturation: 1.3, warmth: 0, tint: 0, flare: 0.001 },
  };
  control = { look: true, scroll: true, hurry: 1.5 };
  drift = REDUCED_MOTION ? 0 : 0.35;
  fear = 0.3;
  film = { bloom: 0.3, bloomFrom: 1, grain: 0.5, scratches: 0, weave: 0.0004, bloomTint: [1, 0.05, 0.03] as const };
  focus = 0.85;
  aperture = 1.6;

  private readonly night: number;
  private readonly level: number;
  private readonly key;
  private readonly fill;
  private readonly far;
  private readonly graze;
  private readonly glassGlow = new Color();
  private readonly dust;
  private readonly clocks: { value: number }[] = [];
  private readonly developing = { value: 0 };
  private readonly shiver = { value: 0 };
  private readonly ownLight = { value: 0 };
  private readonly turn = { value: 0 };
  private readonly fallenTurn = { value: 0 };
  private readonly hairClock = { value: 0 };
  private readonly hairColor = new Vector4();
  private readonly hairShade = new Vector4(0, 0, 0, 0.4);
  private readonly fallenColor = new Vector4();
  private readonly fallen: Group | null;
  private readonly surface: ShaderMaterial;
  private readonly someoneY: number;
  private readonly rings: Ring[];
  private readonly ringValues: Vector4[] = [];
  private readonly tongs: Group;
  private readonly heard: { voice: RoomVoice; gain: number }[] = [];

  constructor(ctx: RoomContext) {
    super(ctx);
    const b = this.build;
    const night = clamp(this.visit, 2, 7);
    const row = EVENINGS[night - 2];
    const level = row.level;
    this.night = night;
    this.level = level;
    this.fear = 0.25 + night * 0.06;
    const closer = night === 7 ? HEIGHT_TO_LAST : HEIGHT_TO;
    this.keys = [
      { t: 0, at: [0.085, HEIGHT_FROM, 0.012], yaw: 0, pitch: -89.4, roll: 0.5, fov: 38 },
      { t: 1, at: [0, closer, -0.004], yaw: 0, pitch: -89.6, roll: -0.6, fov: 36 },
    ];

    // a wet bench, wall to wall, in a closed black room
    const walls = b.box(3.4, 3.4, 2.5, { walls: b.paint(0x2c1d18, 0.85), ceiling: b.paint(0x150d0a, 0.95) }, this.root);
    walls.position.z = 1.7;
    const planks = new PlaneGeometry(4, 4, 6, 6).rotateX(-Math.PI / 2);
    const planksUv = planks.getAttribute('uv');
    // uvs in meters, turned so that the boards run along the bench
    for (let i = 0; i < planksUv.count; i++) planksUv.setXY(i, planksUv.getY(i) * 4, planksUv.getX(i) * 4);
    const bench = new Mesh(planks, this.kit.surface('wood_raw_boards', 1.4, { color: new Color(0x8a7a70), roughness: 0.62 }));
    bench.receiveShadow = true;
    this.root.add(bench);
    const marks = new Mesh(new PlaneGeometry(MARKS.w, MARKS.d), new MeshStandardMaterial({ map: benchMarks(night), transparent: true, roughness: 0.2, depthWrite: false }));
    marks.rotation.x = -Math.PI / 2;
    marks.position.y = 0.001;
    marks.receiveShadow = true;
    this.root.add(marks);

    // water standing on the bench: every bead has the lamp in it
    const beads = new InstancedMesh(new SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new MeshStandardMaterial({ color: 0x060302, roughness: 0.07, metalness: 0.1 }), BEADS);
    const random = seeded(47);
    const m = new Matrix4();
    const place = new Vector3();
    const size = new Vector3();
    const flat = new Quaternion();
    for (let i = 0; i < BEADS; i++) {
      const a = random() * 6.283;
      const reach = 0.3 + random() * random() * 0.3;
      const r = 0.0016 + random() * random() * random() * 0.012;
      m.compose(place.set(Math.cos(a) * reach * 1.25 - 0.03, 0.0012, Math.sin(a) * reach * 0.92), flat, size.set(r, r * 0.42, r));
      beads.setMatrixAt(i, m);
    }
    beads.instanceMatrix.needsUpdate = true;
    beads.frustumCulled = false;
    beads.receiveShadow = true;
    this.root.add(beads);

    // the tray
    const shape = trayGeometry();
    const enamel = new MeshStandardMaterial({ map: enamelMap(), roughness: 0.26 });
    // under the developer the enamel all but loses its shine
    const wetLine = { value: level };
    enamel.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uWetLine = wetLine;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWetLine;\nvarying float vWet;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWet = 1.0 - smoothstep(uWetLine - 0.002, uWetLine + 0.002, transformed.y);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWet;')
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\nreflectedLight.directSpecular *= 1.0 - ${WET_DULL.toFixed(2)} * vWet;\nreflectedLight.indirectSpecular *= 1.0 - ${WET_DULL.toFixed(2)} * vWet;`);
    };
    enamel.customProgramCacheKey = () => 'evening-enamel';
    const tray = new Group();
    tray.rotation.y = TRAY_TURN;
    this.root.add(tray);
    const body = new Mesh(shape, enamel);
    body.castShadow = true;
    body.receiveShadow = true;
    tray.add(body);

    // the print: the last picture you were given, or nothing yet
    const last = this.album.pictures[this.album.pictures.length - 1];
    const blank = document.createElement('canvas');
    blank.width = blank.height = 4;
    const blankInk = blank.getContext('2d')!;
    blankInk.fillStyle = '#26211c';
    blankInk.fillRect(0, 0, 4, 4);
    const map = last ? this.album.texture(last) : new CanvasTexture(blank);
    map.colorSpace = SRGBColorSpace;
    let mark: CanvasTexture | DataTexture;
    if (night >= 3) {
      mark = fingerprint();
    } else {
      mark = new DataTexture(new Uint8Array(4), 1, 1);
      mark.needsUpdate = true;
    }
    const printLevels = last ? levels(last.canvas) : LEVELS_PLAIN;
    const paper = new MeshStandardMaterial({ map, roughness: 0.38 });
    paper.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uDevelop = this.developing;
      shader.uniforms.uSelf = this.ownLight;
      shader.uniforms.uShiver = this.shiver;
      shader.uniforms.uMark = { value: mark };
      shader.uniforms.uLevels = { value: new Vector2(printLevels[0], printLevels[1]) };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${PAPER_HEAD}`)
        .replace('#include <map_fragment>', PAPER_DEVELOP)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\nreflectedLight.directSpecular *= ${(1 - WET_DULL).toFixed(2)};\nreflectedLight.indirectSpecular *= ${(1 - WET_DULL).toFixed(2)};`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uSelf * vec3(1.0, 0.05, 0.02);');
    };
    paper.customProgramCacheKey = () => 'evening-print';
    const sheet = new Mesh(sheetGeometry(), paper);
    sheet.position.y = TRAY.floor;
    sheet.rotation.y = SHEET_TURN;
    sheet.receiveShadow = true;
    tray.add(sheet);

    // the hair, carried round by the current, and its shadow on the paper
    const boundX = TRAY.w / 2 - TRAY.rim - TRAY.lean - 0.006;
    const boundZ = TRAY.d / 2 - TRAY.rim - TRAY.lean - 0.006;
    const hairY = level - 0.002;
    const hairShape = trayHair(row.hairs, hairY, boundX, boundZ);
    const gap = level - TRAY.floor;
    const hair = new Mesh(hairShape, this.hairMaterial(this.hairColor, this.turn, [boundX, boundZ], [0, 0, 0], 0, false));
    hair.frustumCulled = false;
    tray.add(hair);
    const hairShadow = new Mesh(hairShape, this.hairMaterial(this.hairShade, this.turn, [boundX, boundZ], [gap * 0.4, TRAY.floor + 0.0078 - hairY, gap * 0.22], 0, true));
    hairShadow.frustumCulled = false;
    hairShadow.renderOrder = 1;
    tray.add(hairShadow);

    // the skin of liquid: the lamp lies on it and crawls
    const inset = TRAY.rim + TRAY.lean * (1 - (level - TRAY.floor) / (TRAY.h - TRAY.floor)) - 0.0025;
    for (let i = 0; i < RINGS; i++) this.ringValues.push(new Vector4());
    this.surface = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLit: { value: 1 },
        uCaustic: { value: CAUSTIC },
        uLamp: { value: new Vector3(LAMP[0], LAMP[1] - level, LAMP[2]) },
        uGlass: { value: new Vector2(GLASS[0], GLASS[1]) },
        uHalf: { value: new Vector2(TRAY.w / 2 - inset, TRAY.d / 2 - inset) },
        uSomeone: { value: new Vector3(row.someone[0], row.someone[1], row.someone[2]) },
        uRings: { value: this.ringValues },
        uWires: { value: WIRES.map((w) => new Vector4(w.x, w.y, w.nx, w.ny)) },
      },
      vertexShader: LIQUID_VERT,
      fragmentShader: `#define RINGS ${RINGS}\n${LIQUID_FRAG}`,
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: SrcAlphaFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
    });
    const liquid = new Mesh(surfaceGeometry(inset), this.surface);
    liquid.position.y = level;
    liquid.renderOrder = 5;
    tray.add(liquid);
    this.someoneY = row.someone[1];

    // what the tongs do and where the drips fall
    this.rings = DRIPS.map((d) => ({ x: d.x, z: d.z, at: d.at, amp: d.amp, speed: 0.095, fade: 0.42, start: 0 }));
    const landed = night === 6 ? TONGS_ACROSS : TONGS_RESTING;
    this.rings.push({ x: landed.x, z: landed.z, at: night === 7 ? 1e3 : TONGS_REST, amp: 0.009, speed: 0.11, fade: 0.55, start: 0 });
    // the fourth evening: the liquid is higher, and something has already made a ring in it
    this.rings.push({ x: CURRENT_AT[0], z: CURRENT_AT[1], at: night === 4 ? -0.1 : 1e3, amp: 0.02, speed: 0.0165, fade: 0, start: 0.03 });

    this.tongs = printTongs();
    tray.add(this.tongs);
    this.poseTongs(night === 7 ? TONGS_ACROSS : night === 6 ? TONGS_RESTING : TONGS_HELD);
    tray.add(thermometer());

    // the second tray, half out of the first frame, with a sheet gone wholly black
    const other = new Group();
    other.position.set(OTHER_TRAY[0], 0, OTHER_TRAY[1]);
    other.rotation.y = Math.PI - 0.03;
    this.root.add(other);
    const otherBody = new Mesh(shape, enamel);
    otherBody.castShadow = true;
    otherBody.receiveShadow = true;
    other.add(otherBody);
    const blackSheet = new Mesh(new PlaneGeometry(SHEET, SHEET).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: 0x040302, roughness: 0.5 }));
    blackSheet.position.y = TRAY.floor + 0.0015;
    blackSheet.rotation.y = 0.11;
    other.add(blackSheet);
    const fixer = new Mesh(surfaceGeometry(inset), new MeshStandardMaterial({ color: 0x050201, roughness: 0.08, transparent: true, opacity: 0.55, depthWrite: false }));
    fixer.position.y = 0.034;
    fixer.renderOrder = 1;
    other.add(fixer);

    const bottle = brownBottle();
    bottle.position.set(BOTTLE_AT[0], 0, BOTTLE_AT[1]);
    this.root.add(bottle);
    this.root.add(rubberApron());

    if (night >= 4) {
      // it has come over the rim once already
      const spill = new Shape();
      spill.moveTo(0, 0);
      spill.bezierCurveTo(0.08, 0.01, 0.13, -0.05, 0.22, -0.036);
      spill.bezierCurveTo(0.25, -0.06, 0.15, -0.1, 0.06, -0.085);
      spill.bezierCurveTo(-0.01, -0.09, -0.04, -0.03, 0, 0);
      const pool = new Mesh(new ShapeGeometry(spill).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: 0x050201, roughness: 0.05, transparent: true, opacity: 0.72, depthWrite: false }));
      pool.position.set(0.08, 0.0016, 0.205);
      this.root.add(pool);
    }

    // your own hair, once it has grown this long
    if (row.fallen > 0) {
      const lensHair = new Group();
      lensHair.rotation.x = Math.PI / 2;
      const mesh = new Mesh(fallenHair(row.fallen), this.hairMaterial(this.fallenColor, this.fallenTurn, [0, 0], [0, 0, 0], 1, false));
      mesh.frustumCulled = false;
      lensHair.add(mesh);
      this.lens.add(lensHair);
      this.fallen = lensHair;
    } else {
      this.fallen = null;
    }

    // the lamp itself, if you look up
    const housing = new Group();
    housing.position.set(LAMP[0], LAMP[1], LAMP[2]);
    housing.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(-LAMP[0], -LAMP[1], -LAMP[2]).normalize());
    housing.add(new Mesh(new BoxGeometry(0.5, 0.38, 0.11), new MeshStandardMaterial({ color: 0x0b0908, roughness: 0.6 })));
    const glassPane = new Mesh(new PlaneGeometry(GLASS[0] * 2, GLASS[1] * 2), new MeshBasicMaterial({ color: this.glassGlow }));
    glassPane.position.z = 0.056;
    housing.add(glassPane);
    this.root.add(housing);

    // the drying wires, and the last prints pegged on them
    const wireMetal = new MeshStandardMaterial({ color: 0x241a16, roughness: 0.5, metalness: 0.6 });
    const prints = this.album.pictures.slice(-3);
    WIRES.forEach((w, n) => {
      const wire = new Mesh(new CylinderGeometry(0.0035, 0.0035, 3.6, 6), wireMetal);
      const along = new Vector3(w.ny, 0, -w.nx);
      wire.position.set(LAMP[0] + w.x, LAMP[1], LAMP[2] + w.y);
      wire.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), along);
      this.root.add(wire);
      if (n === 0) {
        prints.forEach((picture, i) => {
          const print = b.print(this.album.texture(picture), 0.22);
          const reach = -0.55 + i * 0.5;
          print.position.set(LAMP[0] + w.x + along.x * reach, LAMP[1] - 0.15, LAMP[2] + w.y + along.z * reach);
          print.rotation.y = Math.atan2(along.z, -along.x) + Math.PI / 2;
          this.root.add(print);
        });
      }
    });

    this.key = this.spot([LAMP[0], LAMP[1], LAMP[2]], [0, 0, 0], RED, KEY_LIGHT, POOL, 1);
    this.spots = [this.key, null, null];
    this.fill = this.light([-0.2, 1.2, 0.2], RED, FILL_LIGHT, 3.2);
    this.far = this.light([0.25, 1.05, -1.15], RED, FAR_LIGHT, 2.3);
    this.graze = this.light([-0.62, 0.34, 0.36], RED, GRAZE_LIGHT, 1.4);
    this.kit.prop('antique_camera', [0.18, 0, -1.25], { scale: 1, rotation: [0, -14, 0] }, this.root);
    const motes = b.motes(70, { x: [-0.5, 0.6], y: [0.12, 0.62], z: [-0.33, 0.33] }, this.root, { color: 0xff3a20 });
    this.dust = motes.points;
    this.clocks.push(motes.time);

    this.beat(0, () => {
      const liquidGain = night === 7 ? 0.09 : 0.14;
      this.heard.push({ voice: this.sound.bed('rooms/tray_water.mp3', { gain: liquidGain, reverb: 0.3, lowpass: night === 7 ? 800 : 22000 }), gain: liquidGain });
      this.heard.push({ voice: this.sound.play('rooms/darkroom_drip.mp3', { gain: 0.3, reverb: 0.6, offset: 0 }), gain: 0.3 });
      this.heard.push({ voice: this.sound.bed('rooms/dream_drone_low.mp3', { gain: 0.07 }), gain: 0.07 });
      if (night >= 4 && night <= 6) {
        const dinner = 0.05 + (night - 4) * 0.02;
        this.heard.push({ voice: this.sound.bed('rooms/cutlery_far.mp3', { gain: dinner, lowpass: 900, reverb: 0.4, fade: 2 }), gain: dinner });
      }
    });
    TICK_AT.forEach((at, i) => this.beat(at, () => this.sound.play(i % 2 === 0 ? 'rooms/fluorescent_tick_1.mp3' : 'rooms/fluorescent_tick_3.mp3', { gain: 0.05, pan: -0.4, rate: 0.8, lowpass: 3000 })));
    if (night < 7) this.beat(TONGS_REST, () => this.sound.play('rooms/plate_set_2.mp3', { gain: 0.13, rate: 1.3, lowpass: 2400, reverb: 0.2, pan: night === 6 ? -0.1 : 0.3 }));
    this.beat(LINE_AT, () => this.say(LINES[night - 2], LINE_HOLD));
    this.beat(DEVELOP_FROM, () => {
      const glassGain = 0.03 + (night - 2) * 0.004;
      this.heard.push({ voice: this.sound.bed('rooms/dream_drone_glass.mp3', { gain: glassGain, fade: 5 }), gain: glassGain });
    });
    if (night === 5) {
      // the sound stops with the light: a real silence
      this.beat(DARK_FROM, () => this.heard.forEach((h) => h.voice.gain(0, 0.04)));
      this.beat(DARK_TO, () => {
        this.heard.forEach((h) => h.voice.gain(h.gain, 0.14));
        this.sound.play('rooms/fluorescent_tick_3.mp3', { gain: 0.1, pan: -0.4, lowpass: 3000 });
      });
    }
    if (night === 7) this.beat(SHUTTER_AT, () => this.shutter());
  }

  private hairMaterial(color: Vector4, turn: { value: number }, bounds: readonly [number, number], drop: readonly [number, number, number], fade: number, transparent: boolean): ShaderMaterial {
    return new ShaderMaterial({
      uniforms: {
        uTurn: turn,
        uTime: this.hairClock,
        uCenter: { value: new Vector2(bounds[0] > 0 ? CURRENT_AT[0] : 0, bounds[0] > 0 ? CURRENT_AT[1] : 0) },
        uBounds: { value: new Vector2(bounds[0], bounds[1]) },
        uDrop: { value: new Vector3(drop[0], drop[1], drop[2]) },
        uFade: { value: fade },
        uColor: { value: color },
      },
      vertexShader: HAIR_VERT,
      fragmentShader: HAIR_FRAG,
      side: DoubleSide,
      transparent,
      depthWrite: !transparent,
    });
  }

  private poseTongs(pose: typeof TONGS_RESTING): void {
    this.tongs.position.set(pose.x, pose.y, pose.z);
    this.tongs.rotation.set(0, pose.heading, pose.tilt);
  }

  /** How much of the safelight there is at second `s`: it breathes once at the start, and its filament is not quite sound. */
  private lampAt(s: number): number {
    const up = Math.sin(range(0, 1.2, s) * Math.PI) ** 2;
    const down = Math.sin(range(1, 3, s) * Math.PI) ** 2;
    let lit = 1 + BREATH_UP * up - (this.night === 6 ? BREATH_DOWN_TONGS : BREATH_DOWN) * down;
    for (let i = 0; i < TICK_AT.length; i++) {
      const since = s - TICK_AT[i];
      if (since >= 0 && since < 0.09) lit -= TICK_DIP * (1 - since / 0.09);
    }
    if (this.night === 5) lit *= 1 - range(DARK_FROM, DARK_FROM + 0.1, s) * (1 - range(DARK_TO, DARK_TO + 0.22, s));
    return Math.max(0, lit);
  }

  update(frame: RoomFrame): void {
    const s = frame.seconds;
    const lit = this.lampAt(s);
    this.key.intensity = KEY_LIGHT * lit;
    this.fill.intensity = FILL_LIGHT * lit;
    this.far.intensity = FAR_LIGHT * lit;
    this.graze.intensity = GRAZE_LIGHT * lit;
    this.glassGlow.setRGB(GLASS_GLOW * lit, 0.08 * lit, 0.03 * lit);
    this.dust.visible = lit > 0.05;
    this.air.envIntensity = ENV_LIGHT * lit;
    this.hairColor.set(HAIR_RED * lit, 0.05 * lit, 0.025 * lit, 1);
    this.fallenColor.set(0.4 * lit, 0.02 * lit, 0.01 * lit, 1);
    this.hairShade.w = 0.4 * Math.min(1, lit);

    // the print: on the fifth evening it goes on in the dark, by itself, faster than it should
    let develop = smootherstep(range(DEVELOP_FROM, DEVELOP_TO, s));
    let own = 0;
    if (this.night === 5) {
      develop += DARK_GAIN * range(DARK_FROM, DARK_TO, s);
      own = OWN_LIGHT * range(DARK_FROM, DARK_FROM + 0.2, s) * (1 - range(DARK_TO - 0.05, DARK_TO + 0.15, s));
    }
    this.developing.value = Math.min(1, develop);
    this.ownLight.value = own;
    this.shiver.value = frame.time;
    this.turn.value = CURRENT * s;
    this.fallenTurn.value = FALLEN_TURN * s;
    this.hairClock.value = frame.time;

    const u = this.surface.uniforms;
    u.uTime.value = frame.time;
    u.uLit.value = lit;
    (u.uSomeone.value as Vector3).y = this.someoneY - SOMEONE_COMES * s;
    for (let i = 0; i < RINGS; i++) {
      const ring = this.rings[i];
      const age = s - ring.at;
      const v = this.ringValues[i];
      v.set(ring.x, ring.z, ring.start + ring.speed * Math.max(0, age), age > 0 ? ring.amp * Math.exp(-age * ring.fade) : 0);
    }

    // the tongs come to rest; on the sixth evening, when the light comes back, they lie across the picture
    if (this.night < 6) {
      const t = smootherstep(range(TONGS_REST - 0.22, TONGS_REST, s));
      const shake = s > TONGS_REST ? 0.012 * Math.exp(-(s - TONGS_REST) * 14) * Math.sin((s - TONGS_REST) * 38) : 0;
      this.tongs.position.set(TONGS_HELD.x + (TONGS_RESTING.x - TONGS_HELD.x) * t, TONGS_HELD.y + (TONGS_RESTING.y - TONGS_HELD.y) * t, TONGS_HELD.z + (TONGS_RESTING.z - TONGS_HELD.z) * t);
      this.tongs.rotation.set(0, TONGS_HELD.heading + (TONGS_RESTING.heading - TONGS_HELD.heading) * t, TONGS_HELD.tilt + (TONGS_RESTING.tilt - TONGS_HELD.tilt) * t + shake);
    } else if (this.night === 6) {
      this.poseTongs(s < TONGS_REST ? TONGS_RESTING : TONGS_ACROSS);
    }
    this.movingShadows = this.night < 7 && s > TONGS_REST - 0.3 && s < TONGS_REST + 0.3;

    if (this.fallen) this.fallen.visible = lit > 0.05;
    this.focus = HEIGHT_FROM + (this.keys[1].at[1] - HEIGHT_FROM) * frame.t - this.level;
    for (let i = 0; i < this.clocks.length; i++) this.clocks[i].value = frame.time;
  }
}
