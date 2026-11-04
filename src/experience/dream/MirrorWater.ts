import {
  Color,
  HalfFloatType,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Plane,
  RingGeometry,
  ShaderMaterial,
  Sphere,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type BufferGeometry,
  type Camera,
  type Line,
  type Object3D,
  type Points,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { REDUCED_MOTION } from '../../config/experience.config';
import { inSea, seaConfig } from '../../config/sea.config';
import { warp, WARP_GLSL, warpUniforms } from '../render/Warp';

const W = seaConfig.water;
const WAVES = W.swell;
const BEND = W.swellBend;
/** Where each wave train starts (rad): anything, as long as they never start together. */
const WAVE_PHASE = [0, 1.9, 4.1, 2.7, 5.3] as const;
const WAVE_K = WAVES.map((w) => (Math.PI * 2) / w.length);
const WAVE_RATE = WAVES.map((w) => (Math.PI * 2) / w.period);
/** The bend of the swell's ground runs this much finer across than along, and drifts this much slower that way. */
const BEND_ASPECT = 1.17;
const BEND_DRIFT = 0.85;
/** A wave fades out as one pixel grows from the first to the second share of its wave length (no shimmer far away). */
const WAVE_FADE = [0.18, 0.6] as const;
/** Sideways spread of a streak (share of its length). */
const STREAK_WIDTH = 0.12;
/** The column's folds: how long and how short they are (m), how fast they slide (m/s), and from which pixel size (m) they are gone. */
const FOLDS = { along: 2.4, across: 0.42, slide: 0.05, fade: [0.25, 1.6] as const };
/** The film's colors are a share of how bright the oil is there, up to this brightness. */
const SHEEN_CEILING = 3;
/** The film's colors turn with the angle of view (bands from straight down to flat), and are gone by these pixel sizes (m). */
const FILM_BY_ANGLE = 2;
const FILM_FADE = [1, 7] as const;
/** The mirrored image fades out over this share of its frame, at the top and bottom edges of the frame. */
const MIRROR_EDGE = 0.035;

const glslFloat = (v: number) => v.toFixed(5);
const glslFloats = (values: readonly number[]) => values.map(glslFloat).join(', ');
const glslVec3 = (c: readonly number[]) => `vec3(${glslFloats(c)})`;

/** The height of the swell (`swellHeight`), its slope (`swellSlope`), for any shader that lies on the oil. Needs `uniform float uTime` filled by MirrorWater. */
export const SWELL_GLSL = /* glsl */ `
uniform float uTime;
const vec2 WAVE_DIR[${WAVES.length}] = vec2[${WAVES.length}](${WAVES.map((w) => `vec2(${glslFloats(w.direction)})`).join(', ')});
const float WAVE_K[${WAVES.length}] = float[${WAVES.length}](${glslFloats(WAVE_K)});
const float WAVE_HEIGHT[${WAVES.length}] = float[${WAVES.length}](${glslFloats(WAVES.map((w) => w.height))});
const float WAVE_RATE[${WAVES.length}] = float[${WAVES.length}](${glslFloats(WAVE_RATE)});
const float WAVE_PHASE[${WAVES.length}] = float[${WAVES.length}](${glslFloats(WAVE_PHASE.slice(0, WAVES.length))});

// a slow bend of the swell's ground, so the trains never line up into a pattern
vec2 swellGround(vec2 p) {
  float t = uTime * ${glslFloat(BEND.rate)};
  float f = ${glslFloat(BEND.frequency)};
  return p + ${glslFloat(BEND.reach)} * vec2(sin(p.y * f + t), cos(p.x * f * ${glslFloat(BEND_ASPECT)} - t * ${glslFloat(BEND_DRIFT)}));
}

float swellHeight(vec2 p) {
  vec2 g = swellGround(p);
  float h = 0.0;
  for (int i = 0; i < ${WAVES.length}; i++) {
    h += WAVE_HEIGHT[i] * sin(dot(WAVE_DIR[i], g) * WAVE_K[i] + uTime * WAVE_RATE[i] + WAVE_PHASE[i]);
  }
  return h;
}

// footprint: the size (m) of a pixel on the surface; what it cannot resolve is left out
vec2 swellSlope(vec2 p, float footprint) {
  vec2 g = swellGround(p);
  vec2 slope = vec2(0.0);
  for (int i = 0; i < ${WAVES.length}; i++) {
    float keep = 1.0 - smoothstep(${glslFloat(WAVE_FADE[0])}, ${glslFloat(WAVE_FADE[1])}, footprint * WAVE_K[i] / 6.2831853);
    slope += WAVE_DIR[i] * (WAVE_HEIGHT[i] * WAVE_K[i] * keep * cos(dot(WAVE_DIR[i], g) * WAVE_K[i] + uTime * WAVE_RATE[i] + WAVE_PHASE[i]));
  }
  return slope;
}
`;

/** The same swell for those who ride it: its height (m) at a walk-frame point, at a time (s). */
export function swellHeight(x: number, z: number, time: number): number {
  const t = time * BEND.rate;
  const f = BEND.frequency;
  const gx = x + BEND.reach * Math.sin(z * f + t);
  const gz = z + BEND.reach * Math.cos(x * f * BEND_ASPECT - t * BEND_DRIFT);
  let h = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const d = WAVES[i].direction;
    h += WAVES[i].height * Math.sin((d[0] * gx + d[1] * gz) * WAVE_K[i] + time * WAVE_RATE[i] + WAVE_PHASE[i]);
  }
  return h;
}

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${WARP_GLSL}
${SWELL_GLSL}
uniform mat4 uTextureMatrix;
varying vec4 vReflect;
varying vec3 vWorld;
void main() {
  // the grid lies under the eye, whichever eye, following it in small steps; the surface it samples stays where it is
  vec2 under = floor(cameraPosition.xz / ${glslFloat(W.grid.snap)} + 0.5) * ${glslFloat(W.grid.snap)};
  vec3 world = vec3(position.x + under.x, modelMatrix[3].y, position.z + under.y);
  vReflect = uTextureMatrix * vec4(world, 1.0);
  float heave = 1.0 - smoothstep(${glslFloat(W.heaveFade[0])}, ${glslFloat(W.heaveFade[1])}, length(position.xz));
  world.y += swellHeight(world.xz) * heave;
  vWorld = world;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * dreamWarp(mvPosition);
  #include <fog_vertex>
}
`;

const SUN = inSea(seaConfig.sun.at);
const C = W.column;
const F = W.sheen;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${SWELL_GLSL}
uniform sampler2D tReflection;
varying vec4 vReflect;
varying vec3 vWorld;

// taps of the reflection along a streak
#define TAPS 5
// how tightly a streak's taps gather to its middle (gaussian falloff), and its length looking straight
// down (share of its length at grazing angles)
const float STREAK_FALLOFF = 2.5;
const float STREAK_DOWN = 0.3;

float cell(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cell(i), cell(i + vec2(1.0, 0.0)), f.x), mix(cell(i + vec2(0.0, 1.0)), cell(i + vec2(1.0, 1.0)), f.x), f.y);
}

vec3 reflection(vec2 uv, float len) {
  // dithered, so the taps of a long streak read as grain and not as copies
  float j = cell(gl_FragCoord.xy);
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < TAPS; i++) {
    float s = (float(i) + j) / float(TAPS) * 2.0 - 1.0;
    float w = exp(-s * s * STREAK_FALLOFF);
    vec2 o = vec2(s * (j - 0.5) * ${glslFloat(STREAK_WIDTH)}, s) * len;
    sum += texture2D(tReflection, clamp(uv + o, 0.0, 1.0)).rgb * w;
    total += w;
  }
  return sum / total;
}

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float footprint = length(fwidth(vWorld.xz));
  vec2 slope = swellSlope(vWorld.xz, footprint);
  vec3 tilt = vec3(-slope.x, 0.0, -slope.y);
  vec3 N = normalize(vec3(tilt.x, 1.0, tilt.z));
  float cosV = saturate(dot(N, V));
  float fresnel = ${glslFloat(W.reflectance[0])} + ${glslFloat(W.reflectance[1] - W.reflectance[0])} * pow(1.0 - cosV, ${glslFloat(W.fresnelPower)});

  // the tilted mirror turns the eye's ray away from where the level one sends it, by this; as seen in the frame
  // of the mirror's camera (its x runs the other way). Along the surface a sideways tilt does almost nothing.
  vec3 turned = 2.0 * (dot(V, tilt) * vec3(0.0, 1.0, 0.0) + saturate(V.y) * tilt);
  vec3 seen = mat3(viewMatrix) * vec3(turned.x, -turned.y, turned.z);
  vec2 uv = vReflect.xy / vReflect.w + vec2(-seen.x, seen.y) * vec2(${glslFloats(W.deflection)});
  float unresolved = 1.0 + min(footprint * ${glslFloat(W.streakGrowth[0])}, ${glslFloat(W.streakGrowth[1])});
  vec3 mirrored = reflection(uv, ${glslFloat(W.streak)} * mix(1.0, STREAK_DOWN, cosV) * unresolved);
  // (past the top or bottom of its frame the mirror has nothing to say)
  mirrored *= smoothstep(0.0, ${glslFloat(MIRROR_EDGE)}, uv.y) * smoothstep(0.0, ${glslFloat(MIRROR_EDGE)}, 1.0 - uv.y);

  // the sun's hot heart, drawn down the oil to the eye: a column, wherever a fold can send the ray up to it
  vec3 R = reflect(-V, N);
  vec2 away = normalize(R.xz + vec2(1e-5));
  vec2 toSun = normalize(${glslVec3(SUN)}.xz - vWorld.xz);
  float across = (away.x * toSun.y - away.y * toSun.x) / ${glslFloat(C.width)};
  float up = R.y / ${glslFloat(C.reach)};
  float column = exp(-across * across - up * up) * smoothstep(0.0, 0.015, R.y) * smoothstep(0.0, 0.5, dot(away, toSun));
  float folds = vnoise(vWorld.xz * vec2(1.0 / ${glslFloat(FOLDS.along)}, 1.0 / ${glslFloat(FOLDS.across)}) + vec2(0.0, uTime * ${glslFloat(FOLDS.slide)}));
  float crisp = 1.0 - smoothstep(${glslFloat(FOLDS.fade[0])}, ${glslFloat(FOLDS.fade[1])}, footprint);
  column *= mix(1.0, smoothstep(0.2, 0.8, folds) * 1.5, ${glslFloat(C.broken)} * crisp);
  mirrored += ${glslVec3(C.color)} * column;

  // a film of oil on it all: what is bright runs through colors, patch by patch, more of them the flatter it is seen
  float patchy = vnoise(vWorld.xz * ${glslFloat(F.scale)} + vec2(uTime * ${glslFloat(F.creep)}, -uTime * ${glslFloat(F.creep)} * 0.7));
  patchy += 0.5 * vnoise(vWorld.zx * ${glslFloat(F.scale)} * 2.3 - vec2(uTime * ${glslFloat(F.creep)} * 1.3, 0.0));
  vec3 film = 0.5 + 0.5 * cos(6.2831853 * (patchy * ${glslFloat(F.bands)} + cosV * ${glslFloat(FILM_BY_ANGLE)} + vec3(0.0, 0.33, 0.67)));
  float light = min(dot(mirrored, vec3(0.3, 0.6, 0.1)), ${glslFloat(SHEEN_CEILING)});
  mirrored += film * light * ${glslFloat(F.strength)} * (1.0 - smoothstep(${glslFloat(FILM_FADE[0])}, ${glslFloat(FILM_FADE[1])}, footprint));

  // the oil's own body lies behind the haze; the mirror image was fogged over its whole path when it was rendered.
  // Out at the rim, where nothing shines, it is haze and nothing else, the same as the sky behind it: no edge to be seen.
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  float outward = length(vWorld.xz - cameraPosition.xz) / ${glslFloat(W.grid.radius)};
  vec3 body = mix(${glslVec3(new Color(W.color).toArray())}, fogColor, max(fogFactor, smoothstep(${glslFloat(W.rim.body[0])}, ${glslFloat(W.rim.body[1])}, outward)));
  gl_FragColor = vec4(mix(body, mirrored, fresnel * (1.0 - smoothstep(${glslFloat(W.rim.mirror[0])}, ${glslFloat(W.rim.mirror[1])}, outward))), 1.0);
}
`;

/** Maps clip space to texture space. */
const BIAS = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const UP = new Vector3(0, 1, 0);
/** Closer to the surface than this (m) the mirror camera degenerates: no reflection is drawn. */
const MIN_HEIGHT = 0.01;
/**
 * How far (share of the reflection, either axis) a water pixel may read from its own mirrored spot:
 * the swell's steepest tilt turned into the frame (twice it, by the larger deflection) plus the longest streak.
 */
const READ_REACH = 2 * WAVES.reduce((sum, w, i) => sum + w.height * WAVE_K[i], 0) * Math.max(...W.deflection) + W.streak * (1 + W.streakGrowth[1]);

type Drawable = Mesh | Line | Points;
/** What may carry its own bounds (instanced, batched and skinned meshes). */
type Bounded = Object3D & { boundingSphere?: Sphere | null; computeBoundingSphere?: () => void; isSkinnedMesh?: boolean };

function isDrawable(o: Object3D): o is Drawable {
  return (o as Mesh).isMesh === true || (o as Line).isLine === true || (o as Points).isPoints === true;
}

/** Rings out from the middle, each `growth` times as far from the last as the last from the one before: fine at the eye, coarse where nothing shows it. */
function underTheEye(): BufferGeometry {
  const G = W.grid;
  const geometry = new RingGeometry(0, 1, G.sectors, G.rings);
  const outer = Math.pow(G.growth, G.rings) - 1;
  const p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i), p.getY(i));
    const stretch = r > 0 ? (((Math.pow(G.growth, r * G.rings) - 1) / outer) * G.radius) / r : 0;
    p.setXY(i, p.getX(i) * stretch, p.getY(i) * stretch);
  }
  return geometry.rotateX(-Math.PI / 2);
}

const surface = new Vector3();
const eye = new Vector3();
const lookAt = new Vector3();
const forward = new Vector3();
const toCenter = new Vector3();
const rotation = new Matrix4();
const plane = new Plane();
const clip = new Vector4();
const corner = new Vector4();
const bufferSize = new Vector2();
const viewport = new Vector4();
const sphere = new Sphere();

/**
 * A sea of black oil. Just before it is drawn from any camera, the scene is drawn from that camera's
 * reflection in the surface (HDR, same layers, nothing below the surface, nothing beyond the eye's far
 * plane, its own shadow maps reused, and straight space: the oil looks its reflection up where things
 * are before space curls, so the two agree); the oil shows that image through a long heavy swell, black
 * straight down and a mirror along the surface, with a film of colors on what is bright. Its grid lies
 * under the eye and bends with curved space.
 */
export class MirrorWater extends Mesh<BufferGeometry, ShaderMaterial> {
  /** A reflection never draws reflections (and only one mirror renders at a time). */
  private static reflecting = false;

  /** Told when a reflection starts (true) and ends (false): what the mirror need not show can step aside. */
  onMirror: ((mirroring: boolean) => void) | null = null;

  private readonly target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: W.samples });
  private readonly mirror = new PerspectiveCamera();
  private readonly textureMatrix = new Matrix4();
  /** Hidden for the length of one reflection (beyond the eye's far plane). */
  private readonly hidden: Object3D[] = [];
  /** View depth (m) past which the reflection being rendered drops whole objects. */
  private depthLimit = 0;

  constructor() {
    super(
      underTheEye(),
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        fog: true,
        uniforms: {
          ...UniformsUtils.clone(UniformsLib.fog),
          uTime: { value: 0 },
          // shared by reference (a clone would drop a render target's texture)
          tReflection: { value: null },
          uTextureMatrix: { value: null },
          ...warpUniforms,
        },
      }),
    );
    this.name = 'MirrorWater';
    // only the color of the reflection is ever read
    this.target.resolveDepthBuffer = false;
    this.material.uniforms.tReflection.value = this.target.texture;
    this.material.uniforms.uTextureMatrix.value = this.textureMatrix;
    this.position.y = W.level;
  }

  /** What rides the swell shares its clock (read it from here: `uTime`). */
  get timeUniform(): { value: number } {
    return this.material.uniforms.uTime;
  }

  /** Advance the swell (s). */
  update(time: number): void {
    this.timeUniform.value = REDUCED_MOTION ? 0 : time;
  }

  dispose(): void {
    this.target.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }

  override onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
    if (MirrorWater.reflecting) return;
    surface.setFromMatrixPosition(this.matrixWorld);
    eye.setFromMatrixPosition(camera.matrixWorld);
    // from under the surface there is nothing to mirror
    if (eye.y - surface.y < MIN_HEIGHT) return;
    const far = (camera as PerspectiveCamera).far;

    // the eye and its gaze, reflected in the surface
    const m = this.mirror;
    rotation.extractRotation(camera.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rotation).add(eye);
    lookAt.y = 2 * surface.y - lookAt.y;
    m.position.set(eye.x, 2 * surface.y - eye.y, eye.z);
    m.up.set(0, 1, 0).applyMatrix4(rotation);
    m.up.y = -m.up.y;
    m.lookAt(lookAt);
    m.far = far;
    m.updateMatrixWorld();
    m.projectionMatrix.copy(camera.projectionMatrix);
    m.layers.mask = camera.layers.mask;
    this.textureMatrix.copy(BIAS).multiply(m.projectionMatrix).multiply(m.matrixWorldInverse);

    // oblique near plane on the surface (Lengyel): nothing below the surface is drawn into the mirror
    plane.setFromNormalAndCoplanarPoint(UP, surface).applyMatrix4(m.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const p = m.projectionMatrix.elements;
    corner.set((Math.sign(clip.x) + p[8]) / p[0], (Math.sign(clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
    clip.multiplyScalar(2 / clip.dot(corner));
    p[2] = clip.x;
    p[6] = clip.y;
    p[10] = clip.z + 1;
    p[14] = clip.w;
    m.projectionMatrixInverse.copy(m.projectionMatrix).invert();

    renderer.getDrawingBufferSize(bufferSize);
    const width = Math.max(1, Math.round(bufferSize.x * W.resolution));
    const height = Math.max(1, Math.round(bufferSize.y * W.resolution));
    if (this.target.width !== width || this.target.height !== height) this.target.setSize(width, height);

    const previous = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace();
    const level = renderer.getActiveMipmapLevel();
    renderer.getCurrentViewport(viewport);
    // (the mirrored columns hold only for a centered projection, without a view offset)
    this.scissorTo(p[8] === 0 && p[9] === 0 ? previous : null, viewport);
    const shadows = renderer.shadowMap;
    const autoUpdate = shadows.autoUpdate;
    const needsUpdate = shadows.needsUpdate;
    const xr = renderer.xr.enabled;
    // the mirror looks in straight space: this pixel of oil asks what stands where its ray goes before space curls
    const curved = warp.amount;
    const { x: bendUp, y: bendAside, z: twist, w: wave } = curved;
    MirrorWater.reflecting = true;
    this.visible = false;
    this.onMirror?.(true);
    try {
      curved.x = curved.y = curved.z = curved.w = 0;
      this.hideBeyond(scene, far);
      // this frame's shadow maps are already drawn: the mirror reuses them
      shadows.autoUpdate = false;
      shadows.needsUpdate = false;
      renderer.xr.enabled = false;
      renderer.setRenderTarget(this.target);
      renderer.state.buffers.depth.setMask(true);
      if (!renderer.autoClear) renderer.clear();
      renderer.render(scene, m);
    } finally {
      for (const o of this.hidden) o.visible = true;
      this.hidden.length = 0;
      shadows.autoUpdate = autoUpdate;
      shadows.needsUpdate = needsUpdate;
      renderer.xr.enabled = xr;
      renderer.setRenderTarget(previous, face, level);
      renderer.state.viewport(viewport);
      curved.x = bendUp;
      curved.y = bendAside;
      curved.z = twist;
      curved.w = wave;
      this.onMirror?.(false);
      this.visible = true;
      MirrorWater.reflecting = false;
    }
  }

  /**
   * When the render the water is part of is cut to a scissor (the live window through the giant print),
   * only that part of the mirror is ever read: the same rows, the columns mirrored (the mirror camera's x
   * runs the other way), widened by how far the swell and the streaks reach. `outer` null: all of it.
   */
  private scissorTo(outer: WebGLRenderTarget | null, view: Vector4): void {
    const t = this.target;
    t.scissorTest = outer !== null && outer.scissorTest && view.z > 0 && view.w > 0;
    if (!outer || !t.scissorTest) return;
    const s = outer.scissor;
    const u0 = 1 - (s.x + s.z - view.x) / view.z - READ_REACH;
    const u1 = 1 - (s.x - view.x) / view.z + READ_REACH;
    const v0 = (s.y - view.y) / view.w - READ_REACH;
    const v1 = (s.y + s.w - view.y) / view.w + READ_REACH;
    const x0 = Math.max(0, Math.floor(u0 * t.width));
    const y0 = Math.max(0, Math.floor(v0 * t.height));
    const x1 = Math.min(t.width, Math.ceil(u1 * t.width));
    const y1 = Math.min(t.height, Math.ceil(v1 * t.height));
    t.scissor.set(x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
  }

  /**
   * The oblique near plane leaves the mirror's far end open: past the eye's far plane it would show
   * whatever stands there (seen from the sea, the alley 700 m away, in the water's reflection). What
   * lies wholly beyond that depth is hidden for the reflection, as the eye's own far plane hides it.
   */
  private hideBeyond(scene: Scene, far: number): void {
    this.mirror.getWorldDirection(forward);
    this.depthLimit = far;
    scene.traverseVisible(this.hideIfBeyond);
  }

  private readonly hideIfBeyond = (o: Object3D): void => {
    if (!isDrawable(o) || !o.layers.test(this.mirror.layers)) return;
    const b = o as Bounded;
    // skinned bounds would be recomputed on the CPU: their rest pose is close enough at this distance
    if (b.boundingSphere === null && b.computeBoundingSphere && !b.isSkinnedMesh) b.computeBoundingSphere();
    let local = b.boundingSphere;
    if (!local) {
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      local = o.geometry.boundingSphere;
    }
    if (!local) return;
    sphere.copy(local).applyMatrix4(o.matrixWorld);
    if (toCenter.subVectors(sphere.center, this.mirror.position).dot(forward) - sphere.radius <= this.depthLimit) return;
    o.visible = false;
    this.hidden.push(o);
  };
}
