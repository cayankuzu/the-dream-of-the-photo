import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Matrix3,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { photoConfig } from '../../config/experience.config';
import { GRADE_GLSL, HASH_GLSL, LUMA_GLSL, SHEEN_GLSL } from '../render/glsl';
import type { Grade } from '../render/Grade';

const { print, image } = photoConfig;

/** Vertical center of the image area in print-local coordinates. */
const IMAGE_CENTER_Y = print.height / 2 - image.offsetFromTop - image.size / 2;
const FRONT_Z = print.thickness / 2;

/** Same paper bend for the frame and the image: cylinder around the print's vertical axis. */
const CURL_GLSL = /* glsl */ `
uniform float uCurl;
float curlOffset(float x) {
  float u = x / ${(print.width / 2).toFixed(5)};
  return -uCurl * u * u;
}
`;

const IMAGE_VERT = /* glsl */ `
${CURL_GLSL}
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  p.z += curlOffset(p.x);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const IMAGE_FRAG = /* glsl */ `
uniform sampler2D tPhoto;
uniform sampler2D tPortal;
uniform float uPortal;
uniform vec2 uResolution;
uniform mat3 uGradeA;
uniform vec3 uGradeB;
uniform float uDevelop;
uniform float uLit;
uniform float uAge;
uniform float uSheen;
uniform float uSheenOffset;
uniform float uTime;
varying vec2 vUv;

${GRADE_GLSL}
${HASH_GLSL}
${SHEEN_GLSL}
${LUMA_GLSL}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec2 suv = gl_FragCoord.xy / uResolution;
  float aspect = uResolution.x / uResolution.y;
  vec3 still = texture2D(tPhoto, vUv).rgb;
  vec3 c = uPortal > 0.0 ? mix(still, texture2D(tPortal, suv).rgb, uPortal) : still;
  // the gloss is light on the surface: added before the photographic grade, exactly as the screen adds it
  c += paperSheenLight(suv, aspect, uSheenOffset, uSheen);
  c = applyGrade(c, uGradeA, uGradeB);

  // instant film: the image rises out of a murky green-brown, shadows last
  float lum = luma(c);
  float n = vnoise(vUv * 6.0) * 0.18;
  float t = smoothstep(0.0, 1.0, uDevelop * 1.25 - n - (1.0 - min(lum * 4.0, 1.0)) * 0.22);
  vec3 murky = vec3(0.020, 0.024, 0.018);
  c = mix(murky, c, t);

  // years: fading, yellowing, a drying stain from the edge
  if (uAge > 0.0) {
    float l2 = luma(c);
    vec3 faded = mix(vec3(l2), c, 0.45) * vec3(1.08, 0.98, 0.78) + vec3(0.018, 0.012, 0.004);
    float stain = smoothstep(0.55, 0.9, vnoise(vUv * 3.0 + 4.0) + (1.0 - vUv.y) * 0.25);
    c = mix(c, faded, uAge) * (1.0 - stain * 0.25 * uAge);
  }

  // the print's own grain fades as it becomes a window (the screen's grain takes over)
  float g = hash12(vUv * 2048.0 + floor(uTime * 24.0)) - 0.5;
  c *= (1.0 + g * 0.06 * (1.0 - uPortal)) * uLit;
  gl_FragColor = vec4(c, 1.0);
}
`;

function paperCanvas(aged: boolean, caption: string | null): CanvasTexture {
  const w = 352;
  const h = Math.round((w * print.height) / print.width);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = aged ? '#d9cfb4' : '#ebe8e1';
  ctx.fillRect(0, 0, w, h);
  // paper fibers and handling marks
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * (aged ? 16 : 7);
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n * 0.9;
  }
  ctx.putImageData(img, 0, 0);
  if (aged) {
    for (let i = 0; i < 6; i++) {
      const g = ctx.createRadialGradient(
        Math.random() * w, Math.random() * h, 2,
        Math.random() * w, Math.random() * h, 40 + Math.random() * 80,
      );
      g.addColorStop(0, 'rgba(120, 92, 40, 0.16)');
      g.addColorStop(1, 'rgba(120, 92, 40, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }
  if (caption) {
    ctx.fillStyle = aged ? 'rgba(38, 42, 70, 0.82)' : 'rgba(30, 30, 40, 0.8)';
    ctx.font = `${Math.round(w * 0.075)}px "Homemade Apple", "Segoe Script", cursive`;
    ctx.textAlign = 'center';
    ctx.save();
    ctx.translate(w * 0.5, h * 0.9);
    ctx.rotate(-0.025);
    ctx.fillText(caption, 0, 0);
    ctx.restore();
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export interface PhotographOptions {
  photo: Texture;
  grade: Grade;
  aged?: boolean;
  caption?: string | null;
  /** The paper gives off its own light (emissive intensity of its paper map), like a moon. */
  glow?: number;
}

/**
 * A physical instant print: paper body with thickness and edges, a matte back,
 * and an image layer that can show either the captured frame or, during the transition,
 * the live world behind its surface (screen-space portal).
 */
export class Photograph extends Group {
  private readonly imageMaterial: ShaderMaterial;
  private readonly frameMaterial: MeshStandardMaterial;
  private readonly curl: { value: number } = { value: photoConfig.curl };
  readonly image: Mesh;

  constructor(opts: PhotographOptions) {
    super();
    this.name = 'Photograph';
    const aged = opts.aged ?? false;

    const body = new BoxGeometry(print.width, print.height, print.thickness, 24, 1, 1);
    this.frameMaterial = new MeshStandardMaterial({
      map: paperCanvas(aged, opts.caption ?? null),
      roughness: aged ? 0.85 : 0.62,
      metalness: 0,
    });
    if (opts.glow) {
      this.frameMaterial.emissive.setRGB(1, 1, 1);
      this.frameMaterial.emissiveMap = this.frameMaterial.map;
      this.frameMaterial.emissiveIntensity = opts.glow;
    }
    const edge = new MeshStandardMaterial({ color: aged ? 0xc9bea2 : 0xe2ded5, roughness: 0.9 });
    const back = new MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.75 });
    for (const m of [this.frameMaterial, edge, back]) {
      m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
        shader.uniforms.uCurl = this.curl;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${CURL_GLSL}`)
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += curlOffset(transformed.x);');
      };
    }
    const paper = new Mesh(body, [edge, edge, edge, edge, this.frameMaterial, back]);
    paper.castShadow = true;
    paper.receiveShadow = true;
    this.add(paper);

    this.imageMaterial = new ShaderMaterial({
      vertexShader: IMAGE_VERT,
      fragmentShader: IMAGE_FRAG,
      uniforms: {
        tPhoto: { value: opts.photo },
        tPortal: { value: null },
        uPortal: { value: 0 },
        uResolution: { value: new Vector2(1, 1) },
        uGradeA: { value: new Matrix3().copy(opts.grade.A) },
        uGradeB: { value: new Vector3().copy(opts.grade.b) },
        uDevelop: { value: aged ? 1 : 0 },
        uLit: { value: 1 },
        uAge: { value: aged ? 1 : 0 },
        uSheen: { value: 0 },
        uSheenOffset: { value: 0 },
        uTime: { value: 0 },
        uCurl: this.curl,
      },
    });
    const imageGeo = new PlaneGeometry(image.size, image.size, 12, 12);
    this.image = new Mesh(imageGeo, this.imageMaterial);
    this.image.position.set(0, IMAGE_CENTER_Y, FRONT_Z + 0.00006);
    this.add(this.image);
  }

  set curlAmount(v: number) {
    this.curl.value = v;
  }

  get uniforms() {
    return this.imageMaterial.uniforms;
  }
}
