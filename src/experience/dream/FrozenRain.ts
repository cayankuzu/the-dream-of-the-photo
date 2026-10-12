import {
  Box3,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  NormalBlending,
  PointLight,
  ShaderMaterial,
  Sphere,
  SpotLight,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  type Camera,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { REDUCED_MOTION } from '../../config/experience.config';
import { dreamConfig } from '../../config/dream.config';
import { lerp } from '../math';

const R = dreamConfig.rain;

/** Fixed seed: the photograph and the world must hold exactly the same drops. */
const SEED = 0x2f6b1d;
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
/** Lamps whose light the drops catch: how many at once, and how far from the rain (m) a lamp may stand. */
const MAX_LAMPS = 8;
const LAMP_REACH = 8;
/**
 * Water drops: share of the light they send on, how strongly forward (Henyey-Greenstein g), and the
 * closest a lamp counts as (m), so a drop touching the glass does not blaze.
 */
const DROP_ALBEDO = 0.08;
const FORWARD = 0.55;
const LAMP_NEAR = 0.5;
/** Keeps a hard-edged spot cone's smoothstep edges apart. */
const CONE_EPSILON = 1e-4;

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
`;

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${CONSTANTS}
attribute vec4 aDrop;   // rest position, replay phase
attribute vec4 aShape;  // length scale, lean (x, z of the axis), glint
attribute float aSpeed; // fall speed scale

uniform vec3 uEye;      // the walker (object space): parting, and where time runs again
uniform vec3 uView;     // the camera drawing this pass (object space): facing and scattering
uniform float uTime;
uniform vec4 uRegion;   // bottom, height, ceiling fade, floor fade (m)
uniform vec2 uFarEnd;   // far end z, fade depth (m)
uniform vec2 uSize;     // width, length (m)
uniform vec4 uFall;     // from, blend, speed, on
uniform vec2 uPart;     // radius, push
uniform float uPixel;   // size of a pixel at unit depth
uniform vec3 uColor;
uniform float uOpacity;
uniform int uLampCount;
uniform vec3 uLampPos[MAX_LAMPS];
uniform vec3 uLampColor[MAX_LAMPS];
uniform vec3 uLampDir[MAX_LAMPS];
uniform vec4 uLampCone[MAX_LAMPS]; // cos outer, cos inner, cutoff distance, decay

varying vec2 vUv;
varying float vAlpha;
varying vec3 vBase;
varying vec3 vCatch;

void main() {
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
  float alpha = uOpacity * mix(1.0, replay, stutter);
  alpha *= smoothstep(0.0, uRegion.w, h) * (1.0 - smoothstep(height - uRegion.z, height, h));
  alpha *= smoothstep(uFarEnd.x, uFarEnd.x + uFarEnd.y, p.z);

  // nobody walks through a drop: near the walker they part, away from the line walked along
  vec3 toDrop = p - uEye;
  float parting = 1.0 - smoothstep(0.0, uPart.x, length(toDrop));
  float fallback = aDrop.w * PI2;
  vec2 away = dot(toDrop.xy, toDrop.xy) > 1e-8 ? normalize(toDrop.xy) : vec2(cos(fallback), sin(fallback));
  p.xy += away * (uPart.y * parting);

  // the streak: its own slight lean, smeared longer while it falls (the same light spread thinner)
  vec3 axis = vec3(aShape.y, sqrt(max(1.0 - dot(aShape.yz, aShape.yz), 0.0)), aShape.z);
  float rest = uSize.y * aShape.x;
  float len = rest + wake * uFall.z * aSpeed * SMEAR;
  alpha *= rest / len;

  // turned about its own axis to face the camera drawing it
  vec3 viewDir = normalize(uView - p);
  vec3 across = cross(axis, viewDir);
  float sinView = length(across);
  across = sinView > 1e-3 ? across / sinView : normalize(cross(axis, vec3(1.0, 0.0, 0.0)));

  // never thinner or shorter on screen than a pixel or two: drawn larger and dimmer instead
  float depth = max(-(modelViewMatrix * vec4(p, 1.0)).z, 1e-3);
  float pixel = depth * uPixel;
  float width = max(uSize.x, MIN_WIDTH_PX * pixel);
  float stretch = clamp(MIN_LENGTH_PX * pixel / (len * max(sinView, 1e-3)), 1.0, MAX_STRETCH);
  alpha *= uSize.x / width / stretch * smoothstep(NEAR_FADE.x, NEAR_FADE.y, depth);
  len *= stretch;

  vec3 corner = p + across * (position.x * 0.5 * width) + axis * ((position.y - 0.5) * len);
  vec4 mvPosition = modelViewMatrix * vec4(corner, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>

  // light caught from the lamps nearby: water sends most of it onward, so a drop between you and a
  // lamp shines and one beside it barely shows
  vec3 caught = vec3(0.0);
  for (int i = 0; i < MAX_LAMPS; i++) {
    if (i >= uLampCount) break;
    vec3 toLamp = uLampPos[i] - p;
    float d = length(toLamp);
    vec3 l = toLamp / max(d, 1e-4);
    vec4 cone = uLampCone[i];
    float falloff = 1.0 / pow(max(d, LAMP_NEAR), cone.w);
    if (cone.z > 0.0) falloff *= pow2(saturate(1.0 - pow4(d / cone.z)));
    float spot = smoothstep(cone.x, cone.y, dot(l, uLampDir[i]));
    float g = 1.0 + FORWARD * FORWARD - 2.0 * FORWARD * dot(-l, viewDir);
    caught += uLampColor[i] * (falloff * spot * (1.0 - FORWARD * FORWARD) / (g * sqrt(g)));
  }

  vBase = uColor * aShape.w;
  vCatch = caught * (DROP_ALBEDO * RECIPROCAL_PI * aShape.w);
  vAlpha = alpha;
  vUv = position.xy;
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${CONSTANTS}
varying vec2 vUv;
varying float vAlpha;
varying vec3 vBase;
varying vec3 vCatch;

void main() {
  // a thread of water: soft across, tapering at both ends
  float across = 1.0 - vUv.x * vUv.x;
  float ends = smoothstep(0.0, TAPER, vUv.y) * (1.0 - smoothstep(1.0 - TAPER, 1.0, vUv.y));
  float a = vAlpha * across * ends;

  gl_FragColor = vec4(vBase, 1.0);
  #include <fog_fragment>
  // the light it lets through and the light it catches only dim with the air in between
  float clearAir = 1.0;
  #ifdef USE_FOG
    clearAir = 1.0 - fogFactor;
  #endif
  vec3 light = (1.0 - ADDITIVE) * gl_FragColor.rgb + clearAir * (ADDITIVE * vBase + vCatch);
  gl_FragColor = vec4(light * a, a * (1.0 - ADDITIVE)); // premultiplied
}
`;

type Lamp = PointLight | SpotLight;

function rainUniforms() {
  const slots = <T>(make: () => T): T[] => Array.from({ length: MAX_LAMPS }, make);
  return {
    ...UniformsUtils.clone(UniformsLib.fog),
    uEye: { value: new Vector3() },
    uView: { value: new Vector3() },
    uTime: { value: 0 },
    uRegion: { value: new Vector4() },
    uFarEnd: { value: new Vector2() },
    uSize: { value: new Vector2() },
    uFall: { value: new Vector4() },
    uPart: { value: new Vector2() },
    uPixel: { value: 1 },
    uColor: { value: new Color() },
    uOpacity: { value: 1 },
    uLampCount: { value: 0 },
    uLampPos: { value: slots(() => new Vector3()) },
    uLampColor: { value: slots(() => new Color()) },
    uLampDir: { value: slots(() => new Vector3(0, -1, 0)) },
    uLampCone: { value: slots(() => new Vector4()) },
  };
}

/** Small, fast, seeded PRNG (mulberry32): the same drops on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Whether an object is drawn in this scene at all (still attached to it, it and every parent visible). */
function shown(object: Object3D, scene: Scene): boolean {
  let o: Object3D = object;
  for (; o.parent; o = o.parent) if (!o.visible) return false;
  return o === scene && o.visible;
}

const toLocal = new Matrix4();
const viewport = new Vector4();
const lampAt = new Vector3();
const reach = new Box3();

/**
 * Rain stopped by the shutter: thin streaks hanging in the air exactly where the photograph caught
 * them, catching the light of the lamps near them. They part around the walker; behind the walker
 * time runs again, and the drops wake and fall. One instanced draw, every drop a pure function of the
 * eye and the clock, so the photograph, every camera and walking backwards all agree.
 */
export class FrozenRain {
  /** One instanced draw (thin streaks); the caller adds it to the dream root. */
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly u = rainUniforms();
  /** The walker's eye (world) given by the last update. */
  private readonly eye = new Vector3();
  /** Where the drops rest (object space). */
  private readonly region: Box3;
  /** Lamps near the rain (found once per scene) and, each pass, the nearest ones lit for its camera. */
  private readonly lamps: Lamp[] = [];
  private readonly nearest: Lamp[] = [];
  private readonly nearestDistance = new Float64Array(MAX_LAMPS);
  private scanned: Scene | null = null;

  constructor() {
    const { x, y, z } = R.region;
    this.region = new Box3().setFromArray([x[0], y[0], z[0], x[1], y[1], z[1]]);
    const min = this.region.min;
    const max = this.region.max;

    const rand = mulberry32(SEED);
    const count = R.count;
    const drops = new Float32Array(count * 4);
    const shapes = new Float32Array(count * 4);
    const speeds = new Float32Array(count);
    for (let i = 0, j = 0; i < count; i++, j += 4) {
      drops[j] = lerp(min.x, max.x, rand());
      drops[j + 1] = lerp(min.y, max.y, rand());
      drops[j + 2] = lerp(min.z, max.z, rand());
      drops[j + 3] = rand();
      const lean = LEAN * rand();
      const turn = rand() * Math.PI * 2;
      shapes[j] = 1 + LENGTH_JITTER * (rand() * 2 - 1);
      shapes[j + 1] = Math.sin(lean) * Math.cos(turn);
      shapes[j + 2] = Math.sin(lean) * Math.sin(turn);
      shapes[j + 3] = lerp(GLINT[0], GLINT[1], rand());
      speeds[i] = 1 + SPEED_JITTER * (rand() * 2 - 1);
    }

    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('aDrop', new InstancedBufferAttribute(drops, 4));
    geometry.setAttribute('aShape', new InstancedBufferAttribute(shapes, 4));
    geometry.setAttribute('aSpeed', new InstancedBufferAttribute(speeds, 1));
    geometry.instanceCount = count;
    // the base quad says nothing about where the drops are: bound the region, parted and stretched
    const longest = (R.size[1] * (1 + LENGTH_JITTER) + R.fall.speed * (1 + SPEED_JITTER) * SMEAR) * MAX_STRETCH;
    geometry.boundingBox = this.region.clone().expandByScalar(R.part.push + longest / 2);
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new Sphere());

    const u = this.u;
    u.uRegion.value.set(min.y, max.y - min.y, CEILING_FADE, FLOOR_FADE);
    // the alley runs along -Z: the far end is the region's smallest z
    u.uFarEnd.value.set(min.z, Math.min(FAR_FADE, max.z - min.z));
    u.uSize.value.set(R.size[0], R.size[1]);
    u.uFall.value.set(R.fall.from, Math.max(R.fall.blend, 1e-3), R.fall.speed, REDUCED_MOTION ? 0 : 1);
    u.uPart.value.set(R.part.radius, R.part.push);
    u.uColor.value.set(R.color).multiplyScalar(R.brightness);
    u.uOpacity.value = R.opacity;

    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: u,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      premultipliedAlpha: true,
      // each streak is turned to its camera anyway: both faces in one draw (three otherwise draws a
      // transparent double-sided mesh twice, back faces then front faces)
      side: DoubleSide,
      forceSinglePass: true,
      fog: true,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'FrozenRain';
    // every drop hangs in the alley's air, in front of any pane or curtain seen from inside it: draw the
    // rain after those instead of sorting a 40 m volume by its centre (dark panes would cover near drops)
    this.mesh.renderOrder = 1;
    this.mesh.onBeforeRender = (renderer, scene, camera) => this.prepare(renderer, scene, camera);
    // the base quad is not where any drop is: never report a hit on it
    this.mesh.raycast = () => {};
  }

  /** Before every dream render: the eye of that render (world space) and the clock (s). */
  update(eye: Vector3, time: number): void {
    this.eye.copy(eye);
    this.u.uTime.value = time;
  }

  /** Per pass: the eye and camera in the rain's own space, the pixel size, the lamps this camera sees. */
  private prepare(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
    const u = this.u;
    toLocal.copy(this.mesh.matrixWorld).invert();
    u.uEye.value.copy(this.eye).applyMatrix4(toLocal);
    u.uView.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(toLocal);
    renderer.getCurrentViewport(viewport);
    // abs: a mirror camera may flip its projection
    u.uPixel.value = 2 / (Math.max(Math.abs(camera.projectionMatrix.elements[5]), 1e-6) * Math.max(1, viewport.w));
    this.catchLamps(scene, camera);
  }

  /** The nearest lamps (to the walker) that light this pass, in the uniform slots. */
  private catchLamps(scene: Scene, camera: Camera): void {
    if (this.scanned !== scene) this.scan(scene);
    const nearest = this.nearest;
    const distance = this.nearestDistance;
    let count = 0;
    for (let k = 0; k < this.lamps.length; k++) {
      const lamp = this.lamps[k];
      if (lamp.intensity <= 0 || !lamp.layers.test(camera.layers) || !shown(lamp, scene)) continue;
      const d = lampAt.setFromMatrixPosition(lamp.matrixWorld).distanceToSquared(this.eye);
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
      u.uLampPos.value[i].setFromMatrixPosition(lamp.matrixWorld).applyMatrix4(toLocal);
      u.uLampColor.value[i].copy(lamp.color).multiplyScalar(lamp.intensity);
      const cone = u.uLampCone.value[i];
      if (lamp instanceof SpotLight) {
        // as three lights a spot: full inside the penumbra, nothing outside the cone
        const outer = Math.cos(lamp.angle);
        cone.set(outer, Math.max(Math.cos(lamp.angle * (1 - lamp.penumbra)), outer + CONE_EPSILON), lamp.distance, lamp.decay);
        u.uLampDir.value[i]
          .setFromMatrixPosition(lamp.matrixWorld)
          .sub(lampAt.setFromMatrixPosition(lamp.target.matrixWorld))
          .transformDirection(toLocal);
      } else {
        cone.set(-2, -1, lamp.distance, lamp.decay);
      }
    }
    u.uLampCount.value = count;
  }

  /** Find the lamps standing near enough to the rain to light it (once per scene, after it is built). */
  private scan(scene: Scene): void {
    this.scanned = scene;
    this.lamps.length = 0;
    reach.copy(this.region).applyMatrix4(this.mesh.matrixWorld).expandByScalar(LAMP_REACH);
    scene.traverse((o) => {
      if ((o instanceof PointLight || o instanceof SpotLight) && reach.containsPoint(lampAt.setFromMatrixPosition(o.matrixWorld))) {
        this.lamps.push(o);
      }
    });
  }
}
