import {
  Box3,
  Color,
  HalfFloatType,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  ShaderMaterial,
  Sphere,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type Line,
  type Object3D,
  type Points,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { REDUCED_MOTION } from '../../config/experience.config';
import { seaConfig } from '../../config/sea.config';

const W = seaConfig.water;

/** Share of the surface's slope carried by each wave train of the swell (longest first). */
const WAVE_SLOPE = [1.0, 0.72, 0.5, 0.36, 0.26] as const;
/** Sideways spread of a streak (share of its length). */
const STREAK_WIDTH = 0.12;
const glslFloats = (values: readonly number[]) => values.map((v) => v.toFixed(4)).join(', ');

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform mat4 uTextureMatrix;
varying vec4 vReflect;
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vReflect = uTextureMatrix * world;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D tReflection;
uniform vec3 uColor;
uniform vec2 uReflectance;
uniform float uTime;
uniform vec4 uRipple;
uniform float uStreak;
varying vec4 vReflect;
varying vec3 vWorld;

// taps of the reflection along a streak
#define TAPS 7
// wave trains of the swell: direction, wavenumber (x the swell's scale), share of the slope, phase
const vec2 WAVE_DIR[5] = vec2[5](vec2(0.8, 0.6), vec2(-0.47, 0.88), vec2(0.97, -0.24), vec2(-0.78, -0.62), vec2(0.13, 0.99));
const float WAVE_K[5] = float[5](1.0, 1.73, 2.91, 4.37, 6.29);
const float WAVE_SLOPE[5] = float[5](${glslFloats(WAVE_SLOPE)});
const float WAVE_PHASE[5] = float[5](0.0, 1.9, 4.1, 2.7, 5.3);
// a slow warp of the swell's domain, so the trains never line up into a pattern: frequency (x scale),
// reach (m), and its drift rates along y and x (x the swell's speed) and its x stretch
const float WARP_FREQ = 0.21;
const float WARP_REACH = 2.4;
const vec3 WARP_DRIFT = vec3(0.13, 0.11, 1.17);
// a wave fades out as one pixel grows from the first to the second share of its wavelength (no shimmer far away)
const vec2 WAVE_FADE = vec2(0.12, 0.45);
const float STREAK_WIDTH = ${STREAK_WIDTH.toFixed(4)};
// how tightly a streak's taps gather to its middle (gaussian falloff), and its length looking straight
// down (share of its length at grazing angles)
const float STREAK_FALLOFF = 2.5;
const float STREAK_DOWN = 0.3;

vec2 swell(vec2 p, float footprint) {
  float t = uTime * uRipple.z * PI2;
  float wf = uRipple.x * WARP_FREQ;
  p += WARP_REACH * vec2(sin(p.y * wf + t * WARP_DRIFT.x), cos(p.x * wf * WARP_DRIFT.z - t * WARP_DRIFT.y));
  vec2 slope = vec2(0.0);
  for (int i = 0; i < 5; i++) {
    float k = uRipple.x * WAVE_K[i];
    float keep = 1.0 - smoothstep(WAVE_FADE.x, WAVE_FADE.y, footprint * k / PI2);
    // deep water: the shorter the wave, the faster it turns over (frequency ~ sqrt of the wavenumber)
    float phase = dot(WAVE_DIR[i], p) * k + t * sqrt(WAVE_K[i]) + WAVE_PHASE[i];
    slope += WAVE_DIR[i] * (WAVE_SLOPE[i] * keep * cos(phase));
  }
  return slope;
}

// interleaved gradient noise: dithers the taps of a streak
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

vec3 reflection(vec2 uv, float len) {
  float j = ign(gl_FragCoord.xy);
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < TAPS; i++) {
    float s = (float(i) + j) / float(TAPS) * 2.0 - 1.0;
    float w = exp(-s * s * STREAK_FALLOFF);
    vec2 o = vec2(s * (j - 0.5) * STREAK_WIDTH, s) * len;
    sum += texture2D(tReflection, clamp(uv + o, 0.0, 1.0)).rgb * w;
    total += w;
  }
  return sum / total;
}

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float footprint = length(fwidth(vWorld.xz));
  vec2 slope = swell(vWorld.xz, footprint);
  vec3 N = normalize(vec3(-slope.x * uRipple.w, 1.0, -slope.y * uRipple.w));
  float cosV = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = uReflectance.x + (uReflectance.y - uReflectance.x) * pow(1.0 - cosV, 5.0);

  // the swell moves the mirror image: across the view by its sideways slope, up and down by its slope
  // toward the eye (along the view's depth when looking out, along its height when looking down)
  vec3 s = mat3(viewMatrix) * vec3(slope.x, 0.0, slope.y);
  vec2 uv = vReflect.xy / vReflect.w + vec2(s.x, s.y - s.z) * uRipple.y;
  // lights stretch into streaks, longer the more grazing the view
  vec3 mirrored = reflection(uv, uStreak * mix(1.0, STREAK_DOWN, cosV));

  // the reflection was fogged over its whole path when it was rendered; only the water's own body
  // still lies behind the haze between it and the eye
  vec3 body = uColor;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    body = mix(body, fogColor, fogFactor);
  #endif
  gl_FragColor = vec4(mix(body, mirrored, fresnel), 1.0);
}
`;

/** Maps clip space to texture space. */
const BIAS = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const UP = new Vector3(0, 1, 0);
/** Closer to the surface than this (m) the mirror camera degenerates: no reflection is drawn. */
const MIN_HEIGHT = 0.01;
/**
 * How far (share of the reflection, either axis) a water pixel may read from its own mirrored spot:
 * the swell's largest displacement (its slopes summed, across both screen axes) plus the longest streak.
 */
const READ_REACH = W.ripple.strength * Math.SQRT2 * WAVE_SLOPE.reduce((a, b) => a + b, 0) + W.streak;

type Drawable = Mesh | Line | Points;
/** What may carry its own bounds (instanced, batched and skinned meshes). */
type Bounded = Object3D & { boundingSphere?: Sphere | null; computeBoundingSphere?: () => void; isSkinnedMesh?: boolean };

function isDrawable(o: Object3D): o is Drawable {
  return (o as Mesh).isMesh === true || (o as Line).isLine === true || (o as Points).isPoints === true;
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
 * A calm sea that is a mirror. Just before it is drawn from any camera, the scene is drawn from that
 * camera's reflection in the surface (HDR, same layers, nothing below the water, nothing beyond the
 * eye's far plane, its own shadow maps reused); the water shows that image through a slow swell, dark
 * straight down and a mirror toward the horizon (Fresnel), with lights drawn out into soft streaks.
 */
export class MirrorWater extends Mesh<PlaneGeometry, ShaderMaterial> {
  /** A reflection never draws reflections (and only one mirror renders at a time). */
  private static reflecting = false;

  private readonly target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: W.samples });
  private readonly mirror = new PerspectiveCamera();
  private readonly textureMatrix = new Matrix4();
  private readonly bounds = new Box3();
  /** Hidden for the length of one reflection (beyond the eye's far plane). */
  private readonly hidden: Object3D[] = [];
  /** View depth (m) past which the reflection being rendered drops whole objects. */
  private depthLimit = 0;

  constructor() {
    const geometry = new PlaneGeometry(W.size, W.size);
    geometry.rotateX(-Math.PI / 2);
    super(
      geometry,
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        fog: true,
        uniforms: UniformsUtils.merge([
          UniformsLib.fog,
          {
            uColor: { value: new Color(W.color) },
            uReflectance: { value: new Vector2(...W.reflectance) },
            uTime: { value: 0 },
            uRipple: { value: new Vector4(W.ripple.scale, W.ripple.strength, W.ripple.speed, W.ripple.tilt) },
            uStreak: { value: W.streak },
          },
        ]),
      }),
    );
    this.name = 'MirrorWater';
    // only the color of the reflection is ever read
    this.target.resolveDepthBuffer = false;
    // shared by reference (a merge would copy them, and drop a render target's texture)
    this.material.uniforms.tReflection = { value: this.target.texture };
    this.material.uniforms.uTextureMatrix = { value: this.textureMatrix };
    this.position.set(W.center[0], W.level, W.center[1]);
  }

  /** Advance the swell (s). */
  update(time: number): void {
    this.material.uniforms.uTime.value = REDUCED_MOTION ? 0 : time;
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
    // from under the water, or from where none of it is within reach, there is nothing to mirror
    if (eye.y - surface.y < MIN_HEIGHT) return;
    const far = (camera as PerspectiveCamera).far;
    if (this.bounds.setFromObject(this).distanceToPoint(eye) > far) return;

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

    // oblique near plane on the surface (Lengyel): nothing below the water is drawn into the mirror
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
    MirrorWater.reflecting = true;
    this.visible = false;
    try {
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
