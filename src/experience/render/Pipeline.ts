import {
  BufferGeometry,
  Camera,
  DepthTexture,
  Float32BufferAttribute,
  HalfFloatType,
  Mesh,
  NoToneMapping,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { renderConfig } from '../../config/experience.config';
import { clamp } from '../math';
import { AGX_GLSL, GRADE_GLSL, HASH_GLSL, LUMA_GLSL, SHEEN_GLSL } from './glsl';

/** Depth-of-field sizes are designed at this drawing-buffer height and scaled to the real one. */
const DOF_REFERENCE_HEIGHT = 1080;
import type { Grade } from './Grade';

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
varying vec2 vUv;

${GRADE_GLSL}
${LUMA_GLSL}
${AGX_GLSL}
${HASH_GLSL}
${SHEEN_GLSL}

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

void main() {
  vec3 c = (uAperture > 0.0 || uSoft > 0.0) ? depthOfField(vUv) : texture2D(tScene, vUv).rgb;
  float aspect = uResolution.x / uResolution.y;
  c += paperSheenLight(vUv, aspect, uSheenOffset, uSheen);
  c = applyGrade(c * uExposure * (1.0 + uFlash), uGradeA, uGradeB);
  c = agxToneMap(c);
  c = linearToSRGB(c);
  vec2 v = (vUv - 0.5) * vec2(aspect, 1.0);
  c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(v));
  float n = hash12(gl_FragCoord.xy + fract(uTime * 7.13) * 917.0) - 0.5;
  float l = luma(c);
  c += n * uGrain * (0.35 + 0.65 * (1.0 - l)) + (hash12(gl_FragCoord.yx) - 0.5) / 255.0;
  c *= 1.0 - uFade;
  gl_FragColor = vec4(c, 1.0);
}
`;

/**
 * One HDR scene pass, an optional portal pass (the world seen through the photograph)
 * and one composite pass (DOF, grade, AgX, grain). Nothing else.
 */
export class Pipeline {
  readonly renderer: WebGLRenderer;
  readonly sceneRT: WebGLRenderTarget;
  readonly portalRT: WebGLRenderTarget;
  readonly size = new Vector2();
  pixelRatio: number;

  private readonly composite: ShaderMaterial;
  private readonly screen: Scene;
  private readonly screenCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private frameTimes: number[] = [];
  private sampleClock = 0;

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

    this.pixelRatio = Pipeline.maxRatio(window.innerWidth, window.innerHeight);

    const rtOptions = { type: HalfFloatType, samples: renderConfig.msaaSamples };
    this.sceneRT = new WebGLRenderTarget(1, 1, { ...rtOptions, depthTexture: new DepthTexture(1, 1) });
    this.portalRT = new WebGLRenderTarget(1, 1, rtOptions);
    this.portalRT.resolveDepthBuffer = false;

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
      },
    });
    const tri = new BufferGeometry();
    tri.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const quad = new Mesh(tri, this.composite);
    quad.frustumCulled = false;
    this.screen = new Scene();
    this.screen.add(quad);
  }

  /** Highest pixel ratio allowed for a screen: device density, the cap, and the pixel budget. */
  private static maxRatio(width: number, height: number): number {
    const budget = Math.sqrt(renderConfig.maxPixels / Math.max(1, width * height));
    return Math.min(window.devicePixelRatio, renderConfig.maxPixelRatio, budget);
  }

  setSize(width: number, height: number): void {
    this.size.set(width, height);
    this.pixelRatio = Math.min(this.pixelRatio, Pipeline.maxRatio(width, height));
    // dense screens hide aliasing: fewer samples there (both targets equal, so the hand-off stays exact)
    const samples = this.pixelRatio >= renderConfig.denseRatio ? renderConfig.denseSamples : renderConfig.msaaSamples;
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
    this.composite.uniforms.uResolution.value.set(w, h);
    this.composite.uniforms.uPxScale.value = h / DOF_REFERENCE_HEIGHT;
  }

  /** Drawing-buffer resolution in device pixels. */
  get resolution(): Vector2 {
    return this.composite.uniforms.uResolution.value;
  }

  renderTo(target: WebGLRenderTarget | null, scene: Scene, camera: Camera): void {
    this.renderer.setRenderTarget(target);
    this.renderer.render(scene, camera);
  }

  present(camera: PerspectiveCamera, state: CompositeState, time: number): void {
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
    u.uExposure.value = state.exposure;
    u.uVignette.value = state.vignette;
    u.uGrain.value = state.grain;
    u.uFade.value = state.fade;
    u.uFlash.value = state.flash;
    u.uSheen.value = state.sheen;
    u.uSheenOffset.value = state.sheenOffset;
    u.uTime.value = time;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.screen, this.screenCamera);
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
    const max = Pipeline.maxRatio(this.size.x, this.size.y);
    let next = this.pixelRatio;
    // step down in proportion to how slow it is, up gently
    if (fps < cfg.lowFps) next = Math.max(renderConfig.minPixelRatio, this.pixelRatio * clamp(Math.sqrt(fps / cfg.highFps), 0.75, 0.95));
    else if (fps > cfg.highFps) next = Math.min(max, this.pixelRatio + cfg.step * 0.5);
    if (Math.abs(next - this.pixelRatio) < 1e-3) return;
    this.pixelRatio = next;
    this.setSize(this.size.x, this.size.y);
  }
}
