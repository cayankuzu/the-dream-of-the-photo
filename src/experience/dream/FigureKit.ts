import {
  AnimationMixer,
  Bone,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SkinnedMesh,
  SRGBColorSpace,
  Vector3,
  type AnimationClip,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from '../assets/Assets';

export type AvatarKey = 'figure_man' | 'figure_nurse' | 'figure_woman' | 'figure_child';

/** Keep the avatar's own face, wash it out to blank plaster, or scratch it away (black holes for eyes). */
export type FaceStyle = 'keep' | 'blank' | 'scratched' | 'hollow';

/** Half of a body: the half that remains. */
export type Half = 'upper' | 'lower' | 'left' | 'right';

export interface FigureSpec {
  avatar: AvatarKey;
  /** The clip to freeze (default: the avatar's first), at this time (s). Any avatar can take the clips of its sex. */
  clip?: string;
  time?: number;
  face?: FaceStyle;
  /** Hair goes white (default true). */
  white?: boolean;
  /** Long white hair hanging from the head, over the face. */
  veil?: boolean;
  /** Only half of it is here; what is left shows meat where it ends. */
  half?: Half;
  /** Height (m above its feet) at which an 'upper' or 'lower' half ends (default: the waist of a standing body). */
  cutAt?: number;
  /** Multiplies the clothes (a hospital white, a grey). */
  tint?: number;
  /** How bleached the clothes are, 0..1 (default .5). */
  bleach?: number;
  /** Not skin and clothes but stitched cloth all over (with `face: 'hollow'`, a sack with a hole for a face). */
  skin?: 'sack';
}

/** Colors of what is left inside a body that ends. */
const MEAT = new Color(0.17, 0.012, 0.012);

/**
 * Where the face lies on the head maps (shares of the image as exported, chin toward the top of the
 * image, hair below it; measured on the images).
 */
const FACE = {
  center: [0.5, 0.685],
  radius: [0.165, 0.205],
  eyes: [
    [0.434, 0.72],
    [0.568, 0.72],
  ],
  eyeRadius: [0.042, 0.022],
  mouth: [0.5, 0.59],
  mouthRadius: [0.058, 0.012],
  /** The eyeball's own patch of the map, painted black so no eye survives. */
  eyeball: [0.264, 0.058],
  eyeballRadius: 0.085,
  /** Below this share of the image's height (the neck is above it) what lies outside the face is hair. */
  scalpFrom: 0.5,
} as const;

/** Veil: strands, their segments, width (m) and length (m; shares of their spread below the head). */
const VEIL = { strands: 340, segments: 7, width: [0.0022, 0.0052], length: [0.55, 1.1] } as const;
const BLEACH = 0.5;
/** White hair: its brightness, and how much of the strands' contrast shows. */
const HAIR_WHITE = 0.74;
const HAIR_STRANDS = 2.1;
const HEAD_BONE = 'Bip01_Head';
const ROOT_BONE = 'Bip01';
const FOOTSTEPS_BONE = 'Bip01_Footsteps';

/** A deterministic random sequence: every crowd is the same on every visit. */
function randomFrom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasOf(source: Texture): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; w: number; h: number } {
  const image = source.image as HTMLImageElement | ImageBitmap;
  const canvas = document.createElement('canvas');
  const w = (canvas.width = image.width);
  const h = (canvas.height = image.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, w, h);
  return { canvas, ctx, w, h };
}

function textureOf(canvas: HTMLCanvasElement, like: Texture): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.flipY = like.flipY;
  t.wrapS = like.wrapS;
  t.wrapT = like.wrapT;
  t.anisotropy = 4;
  return t;
}

/** Clothes and hands drained of their color. */
function bleached(source: Texture, amount: number): CanvasTexture {
  const { canvas, ctx, w, h } = canvasOf(source);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    d[i] += (l - d[i]) * amount;
    d[i + 1] += (l - d[i + 1]) * amount;
    d[i + 2] += (l - d[i + 2]) * amount;
  }
  ctx.putImageData(img, 0, 0);
  return textureOf(canvas, source);
}

/** The head map turned to plaster: hair white, skin dead, the face blank or scratched away. */
export function headMap(source: Texture, face: FaceStyle, white: boolean, seed: number): CanvasTexture {
  const { canvas, ctx, w, h } = canvasOf(source);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const scalpAt = (x: number, y: number) => {
    // hair lies around the face, on the far side of it from the neck
    const u = (x / w - FACE.center[0]) / FACE.radius[0];
    const v = (y / h - FACE.center[1]) / FACE.radius[1];
    return y / h > FACE.scalpFrom ? Math.min(1, Math.max(0, (Math.hypot(u, v) - 1) * 4)) : 0;
  };
  // its strands stay: brightened around its own mean, whatever color it had
  let sum = 0;
  let weight = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      const a = scalpAt(x, y);
      sum += a * (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11);
      weight += a;
    }
  }
  const hairMean = sum / Math.max(1, weight) / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
      const scalp = scalpAt(x, y);
      const pale = white ? Math.min(1, Math.max(0.34, HAIR_WHITE + (l - hairMean) * HAIR_STRANDS)) : l;
      const grey = face === 'keep' ? l : 0.74 + (l - 0.5) * 0.32;
      const value = scalp * (white ? pale : l) + (1 - scalp) * grey;
      if (face === 'keep' && !white) continue;
      const mix = face === 'keep' ? scalp : 0.92;
      d[i] += (value * 255 * 1.0 - d[i]) * mix;
      d[i + 1] += (value * 255 * 0.97 - d[i + 1]) * mix;
      d[i + 2] += (value * 255 * 0.91 - d[i + 2]) * mix;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (face === 'keep') return textureOf(canvas, source);

  const random = randomFrom(seed);
  const ellipse = (x: number, y: number, rx: number, ry: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(x * w, y * h, rx * w, ry * h, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  // no eye survives anywhere on the map
  ellipse(FACE.eyeball[0], FACE.eyeball[1], FACE.eyeballRadius, FACE.eyeballRadius, '#020101');
  for (const [x, y] of FACE.eyes) {
    const socket = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, FACE.eyeRadius[0] * w * 1.6);
    socket.addColorStop(0, 'rgba(0,0,0,1)');
    socket.addColorStop(0.5, 'rgba(6,3,3,0.96)');
    socket.addColorStop(1, 'rgba(40,24,24,0)');
    ctx.fillStyle = socket;
    ctx.save();
    ctx.translate(x * w, y * h);
    ctx.scale(1, FACE.eyeRadius[1] / FACE.eyeRadius[0]);
    ctx.translate(-x * w, -y * h);
    ctx.fillRect(0, 0, w, h / (FACE.eyeRadius[1] / FACE.eyeRadius[0]));
    ctx.restore();
  }
  if (face === 'blank') {
    ellipse(FACE.mouth[0], FACE.mouth[1], FACE.mouthRadius[0], FACE.mouthRadius[1], 'rgba(8,3,3,0.92)');
    return textureOf(canvas, source);
  }
  // scratched by hand: strokes across the whole face, some down to the blood
  ctx.lineCap = 'round';
  for (let n = 0; n < 150; n++) {
    const a = random() * Math.PI * 2;
    const r = random() ** 0.6;
    const x = FACE.center[0] + Math.cos(a) * r * FACE.radius[0];
    const y = FACE.center[1] + Math.sin(a) * r * FACE.radius[1];
    const dir = -0.9 + random() * 0.5 + (random() < 0.3 ? 1.4 : 0);
    const len = 0.03 + random() * 0.14;
    const deep = random();
    ctx.strokeStyle = deep < 0.45 ? `rgba(245,240,230,${0.25 + random() * 0.6})` : deep < 0.8 ? `rgba(14,8,8,${0.3 + random() * 0.6})` : `rgba(70,6,6,${0.4 + random() * 0.5})`;
    ctx.lineWidth = (0.0015 + random() * 0.006) * w;
    ctx.beginPath();
    ctx.moveTo(x * w, y * h);
    ctx.lineTo((x + Math.cos(dir) * len) * w, (y + Math.sin(dir) * len) * h);
    ctx.stroke();
  }
  return textureOf(canvas, source);
}

/** Stitched cloth over a body's own folds: the map's light and shade kept, its color gone; a hole where a face was. */
function sackMap(source: Texture, hollow: boolean): CanvasTexture {
  const { canvas, ctx, w, h } = canvasOf(source);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
      // weave: warp and weft, a little uneven
      const weave = 0.9 + 0.1 * Math.sin(x * 1.9) * Math.sin(y * 1.9) + 0.04 * Math.sin(x * 0.13 + y * 0.07);
      const v = (0.62 + (l - 0.4) * 0.3) * weave * 255;
      d[i] = v;
      d[i + 1] = v * 0.93;
      d[i + 2] = v * 0.8;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (hollow) {
    const cx = FACE.center[0] * w;
    const cy = (FACE.center[1] + 0.02) * h;
    const rx = FACE.radius[0] * 0.78 * w;
    const ry = FACE.radius[1] * 0.92 * h;
    ctx.fillStyle = '#020101';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    // a hem of stitches around the hole
    ctx.strokeStyle = 'rgba(30,22,14,0.8)';
    ctx.lineWidth = w * 0.006;
    for (let a = 0; a < Math.PI * 2; a += 0.22) {
      const c = Math.cos(a);
      const n = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(cx + c * rx * 1.02, cy + n * ry * 1.02);
      ctx.lineTo(cx + c * rx * 1.13, cy + n * ry * 1.13);
      ctx.stroke();
    }
    ctx.fillStyle = '#020101';
    ctx.beginPath();
    ctx.arc(FACE.eyeball[0] * w, FACE.eyeball[1] * h, FACE.eyeballRadius * w, 0, Math.PI * 2);
    ctx.fill();
  }
  return textureOf(canvas, source);
}

/** Hair cards: the color of bone, keeping only their shape. */
export function hairMap(source: Texture): CanvasTexture {
  const { canvas, ctx, w, h } = canvasOf(source);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.62 + (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
    d[i] = Math.min(255, 238 * l);
    d[i + 1] = Math.min(255, 232 * l);
    d[i + 2] = Math.min(255, 218 * l);
  }
  ctx.putImageData(img, 0, 0);
  return textureOf(canvas, source);
}

/** The waist of a standing body (m above its feet). */
const WAIST = 0.95;
/** The plane that ends a body, in its own space (normal towards what is gone, distance m). */
const cutPlane = (half: Half, at: number): readonly [number, number, number, number] =>
  ({ upper: [0, -1, 0, -at], lower: [0, 1, 0, at], left: [1, 0, 0, 0], right: [-1, 0, 0, 0] } as const)[half];

/** Make a material end at a torn plane and show meat from inside. */
export function cutMaterial(material: MeshStandardMaterial, half: Half, at = WAIST, meat = true): MeshStandardMaterial {
  const m = material.clone();
  const [x, y, z, w] = cutPlane(half, at);
  m.side = DoubleSide;
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBodyPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBodyPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBodyPos;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec3 cutAt = vBodyPos;
        float torn = sin(cutAt.x * 71.0 + cutAt.z * 53.0) * 0.012 + sin(cutAt.x * 23.0 - cutAt.z * 31.0 + cutAt.y * 17.0) * 0.02;
        if (dot(cutAt, vec3(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})) + torn > ${w.toFixed(3)}) discard;
        ${meat ? `if (!gl_FrontFacing) {
          float marbled = sin(cutAt.x * 41.0 + sin(cutAt.y * 67.0) * 2.3) * sin(cutAt.y * 59.0 + sin(cutAt.z * 73.0) * 2.1) * sin(cutAt.z * 37.0 + cutAt.x * 11.0);
          diffuseColor.rgb = vec3(${MEAT.r}, ${MEAT.g}, ${MEAT.b}) * (0.75 + 0.7 * marbled);
        }` : ''}`,
      )
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${meat ? 'if (!gl_FrontFacing) roughnessFactor = 0.32;' : ''}`);
  };
  m.customProgramCacheKey = () => `cut-${half}-${at}-${meat}`;
  return m;
}

interface BakedPart {
  geometry: BufferGeometry;
  material: Material;
}

const vp = new Vector3();
const vn = new Vector3();
const vq = new Vector3();
const mq = new Matrix4();
const headAt = new Vector3();

/**
 * Many frozen bodies for the price of a few: a body baked in one pose, drawn once per material with
 * instancing. Moving one (only ever while no one is looking) is writing a matrix.
 */
export class Crowd {
  readonly root = new Group();
  readonly count: number;
  private readonly meshes: InstancedMesh[];

  constructor(parts: readonly BakedPart[], count: number) {
    this.count = count;
    this.meshes = parts.map((p) => {
      const mesh = new InstancedMesh(p.geometry, p.material, count);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      // the bake is shared (see FigureKit.bake)
      mesh.userData.shared = true;
      return mesh;
    });
    this.root.add(...this.meshes);
    this.root.name = 'Crowd';
  }

  /** Stand body `i` here, turned `heading` rad (0 faces +Z, back up the walk). */
  set(i: number, x: number, y: number, z: number, heading = 0, scale = 1): void {
    mq.compose(vp.set(x, y, z), quat.setFromAxisAngle(UP, heading), vq.setScalar(scale));
    for (const m of this.meshes) m.setMatrixAt(i, mq);
  }

  /** Stand body `i` with a whole matrix (for what lies, hangs or leans). */
  setMatrix(i: number, matrix: Matrix4): void {
    for (const m of this.meshes) m.setMatrixAt(i, matrix);
  }

  /** Write the changes. */
  commit(): void {
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }

  /** Bodies drawn from now on (the rest wait). */
  set drawn(count: number) {
    for (const m of this.meshes) m.count = count;
  }
}

const UP = new Vector3(0, 1, 0);
const quat = new Quaternion();

/** An animated body (a few only: they are skinned on the GPU every frame). */
export interface HeroFigure {
  root: Group;
  /** Drive it (s). */
  update(dt: number): void;
  /** Play another clip of the same library. */
  play(clip: string, fade?: number): void;
  /** Its bones by name, e.g. to turn the head by hand after `update`. */
  bone(name: string): Bone | undefined;
}

/**
 * The people of the nightmare: ordinary clothes, blank heads, white hair. Rocketbox bodies (MIT),
 * see scripts/character/avatars.json.
 */
export class FigureKit {
  private readonly gltfs = new Map<AvatarKey, GLTF>();
  private readonly clips = new Map<string, AnimationClip>();
  private readonly baked = new Map<string, BakedPart[]>();
  private readonly materials = new Map<string, MeshStandardMaterial>();

  constructor(assets: Assets) {
    for (const key of ['figure_man', 'figure_nurse', 'figure_woman', 'figure_child'] as const) {
      const gltf = assets.models.get(key);
      if (!gltf) throw new Error(`figure not loaded: ${key}`);
      this.gltfs.set(key, gltf);
      // a helper bone only some bodies have; nothing moves with it
      for (const clip of gltf.animations) clip.tracks = clip.tracks.filter((t) => !t.name.startsWith(FOOTSTEPS_BONE));
      for (const clip of gltf.animations) if (key !== 'figure_child' || !this.clips.has(clip.name)) this.clips.set(`${key === 'figure_child' ? 'child:' : ''}${clip.name}`, clip);
    }
  }

  private clipFor(spec: FigureSpec): AnimationClip | undefined {
    const name = spec.clip ?? (spec.avatar === 'figure_child' ? 'm_idle_breathe_01' : spec.avatar === 'figure_man' ? 'm_idle_roll_head_01' : 'f_idle_touch_hair_01');
    return this.clips.get(spec.avatar === 'figure_child' ? `child:${name}` : name) ?? this.clips.get(name);
  }

  /** How one material of a body looks under this spec (shared between all bodies that look alike). */
  private material(spec: FigureSpec, source: MeshStandardMaterial): MeshStandardMaterial {
    const kind = /head/.test(source.name) ? 'head' : /opacity/.test(source.name) ? 'hair' : 'body';
    const white = spec.white ?? true;
    const face = spec.face ?? 'blank';
    const bleach = spec.bleach ?? BLEACH;
    const key = `${spec.avatar}/${kind}/${face}/${white}/${bleach}/${spec.tint ?? ''}/${spec.half ?? ''}/${spec.cutAt ?? ''}/${spec.skin ?? ''}`;
    let m = this.materials.get(key);
    if (m) return m;
    m = source.clone();
    m.roughness = 1;
    m.vertexColors = false;
    if (source.map && spec.skin === 'sack') {
      m.map = sackMap(source.map, kind === 'head' && face === 'hollow');
      m.normalMap = null;
      m.color.set(spec.tint ?? 0xffffff);
    } else if (source.map) {
      if (kind === 'head') m.map = headMap(source.map, face, white, spec.avatar.length * 97);
      else if (kind === 'hair' && white) m.map = hairMap(source.map);
      else if (kind === 'body' && bleach > 0) m.map = bleached(source.map, bleach);
    }
    if (kind === 'body' && spec.tint !== undefined) m.color.set(spec.tint);
    // hair cards show both faces: they have no inside to show
    if (spec.half) m = cutMaterial(m, spec.half, spec.cutAt, kind !== 'hair');
    this.materials.set(key, m);
    return m;
  }

  /** The body in its pose as static geometry: feet on the ground, standing at the origin. */
  private bake(spec: FigureSpec): BakedPart[] {
    const clip = this.clipFor(spec);
    const key = `${spec.avatar}/${clip?.name ?? ''}/${spec.time ?? 0}/${spec.face ?? 'blank'}/${spec.white ?? true}/${spec.veil ?? false}/${spec.half ?? ''}/${spec.cutAt ?? ''}/${spec.tint ?? ''}/${spec.bleach ?? ''}/${spec.skin ?? ''}`;
    const known = this.baked.get(key);
    if (known) return known;

    const body = cloneSkinned(this.gltfs.get(spec.avatar)!.scene);
    if (clip) {
      const mixer = new AnimationMixer(body);
      mixer.clipAction(clip).play();
      mixer.setTime(spec.time ?? 0);
    }
    body.updateMatrixWorld(true);
    const meshes: SkinnedMesh[] = [];
    body.traverse((o) => {
      if ((o as SkinnedMesh).isSkinnedMesh) meshes.push(o as SkinnedMesh);
    });

    // first pass: where everything ends up
    const baked = meshes.map((mesh) => {
      mesh.skeleton.update();
      const geo = mesh.geometry;
      const position = geo.getAttribute('position');
      const normal = geo.getAttribute('normal');
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const epsilon = geo.boundingSphere!.radius * 0.01;
      const positions = new Float32Array(position.count * 3);
      const normals = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        vp.fromBufferAttribute(position, i);
        vn.fromBufferAttribute(normal, i);
        vq.copy(vp).addScaledVector(vn, epsilon);
        mesh.applyBoneTransform(i, vp);
        mesh.applyBoneTransform(i, vq);
        vp.applyMatrix4(mesh.matrixWorld);
        vq.applyMatrix4(mesh.matrixWorld);
        vp.toArray(positions, i * 3);
        vq.sub(vp).normalize().toArray(normals, i * 3);
      }
      return { mesh, positions, normals };
    });

    let minY = Infinity;
    for (const b of baked) for (let i = 1; i < b.positions.length; i += 3) minY = Math.min(minY, b.positions[i]);
    const hips = body.getObjectByName(ROOT_BONE)?.getWorldPosition(new Vector3()) ?? new Vector3();
    for (const b of baked) {
      for (let i = 0; i < b.positions.length; i += 3) {
        b.positions[i] -= hips.x;
        b.positions[i + 1] -= minY;
        b.positions[i + 2] -= hips.z;
      }
    }

    const pieces = baked.map(({ mesh, positions, normals }) => {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(positions, 3));
      g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
      const uv = mesh.geometry.getAttribute('uv');
      const uvs = new Float32Array(uv.count * 2);
      for (let i = 0; i < uv.count; i++) {
        uvs[i * 2] = uv.getX(i);
        uvs[i * 2 + 1] = uv.getY(i);
      }
      g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
      const index = mesh.geometry.index!;
      g.setIndex(Array.from({ length: index.count }, (_, i) => index.getX(i)));
      return { geometry: g, material: this.material(spec, mesh.material as MeshStandardMaterial) };
    });
    // the file splits a body many times over: one draw per material is enough
    const parts: BakedPart[] = [...new Set(pieces.map((p) => p.material))].map((material) => ({
      geometry: mergeGeometries(pieces.filter((p) => p.material === material).map((p) => p.geometry))!,
      material,
    }));
    // a sack has no hair
    if (spec.skin === 'sack') parts.splice(0, parts.length, ...parts.filter((p) => !/opacity/.test(p.material.name)));

    if (spec.veil) {
      const head = body.getObjectByName(HEAD_BONE);
      if (head) {
        head.getWorldPosition(headAt);
        headAt.x -= hips.x;
        headAt.y -= minY;
        headAt.z -= hips.z;
        parts.push(this.veil(headAt.clone(), spec));
      }
    }
    this.baked.set(key, parts);
    return parts;
  }

  /** Long white hair over the whole head: strands from the crown down past the chest. */
  private veil(head: Vector3, spec: FigureSpec): BakedPart {
    const random = randomFrom(Math.round(head.y * 1000));
    const { strands, segments, width, length } = VEIL;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const index: number[] = [];
    let base = 0;
    for (let s = 0; s < strands; s++) {
      const a = random() * Math.PI * 2;
      const r = 0.035 + random() * 0.055;
      const x = head.x + Math.cos(a) * r;
      const z = head.z + Math.sin(a) * r + 0.012;
      const top = head.y + 0.09 + random() * 0.05;
      const fall = (length[0] + random() * (length[1] - length[0])) * (spec.avatar === 'figure_child' ? 0.5 : 1);
      // falling straight from the crown, hugging the head, then free
      const outward = 0.075 + random() * 0.05;
      const sway = (random() - 0.5) * 0.09;
      const kink = random() * 6.28;
      const thickness = width[0] + random() * (width[1] - width[0]);
      const bright = 0.55 + random() * 0.45;
      const facing = a + (random() - 0.5) * 1.6;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const swell = Math.min(1, t * 6);
        const wave = Math.sin(t * 7 + kink) * 0.012 * t;
        const px = x + Math.cos(a) * outward * swell + sway * t * t + wave;
        const py = top - t * fall;
        const pz = z + Math.sin(a) * outward * swell + sway * 0.6 * t * t;
        const w = thickness * (1 - t * 0.7);
        positions.push(px - w, py, pz, px + w, py, pz);
        normals.push(Math.cos(facing), 0.1, Math.sin(facing), Math.cos(facing), 0.1, Math.sin(facing));
        uvs.push(0, t, 1, t);
        colors.push(bright, bright, bright * 0.95, bright, bright, bright * 0.95);
        if (i < segments) {
          const b = base + i * 2;
          index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
      }
      base += (segments + 1) * 2;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    g.setIndex(index);
    const key = `veil/${spec.half ?? ''}/${spec.cutAt ?? ''}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.5, side: DoubleSide, vertexColors: true });
      if (spec.half) m = cutMaterial(m, spec.half, spec.cutAt, false);
      this.materials.set(key, m);
    }
    return { geometry: g, material: m };
  }

  /** The maps it painted for bodies (shared by all that look alike), to free once no one alive wears them. */
  painted(): Texture[] {
    return [...this.materials.values()].flatMap((m) => ((m.map as CanvasTexture | null)?.isCanvasTexture ? [m.map!] : []));
  }

  /** The poses it baked (shared by all crowds that stand alike), to free once no crowd alive stands in them. */
  bakedGeometries(): BufferGeometry[] {
    return [...this.baked.values()].flatMap((parts) => parts.map((p) => p.geometry));
  }

  /** `count` bodies frozen in one pose. Place them with `set`, then `commit`. */
  crowd(spec: FigureSpec, count: number): Crowd {
    return new Crowd(this.bake(spec), count);
  }

  /** A body that moves (skinned: use a handful at most). */
  hero(spec: FigureSpec): HeroFigure {
    const root = new Group();
    const body = cloneSkinned(this.gltfs.get(spec.avatar)!.scene);
    body.traverse((o) => {
      const mesh = o as SkinnedMesh;
      if (mesh.isMesh) {
        mesh.frustumCulled = false;
        mesh.material = this.material(spec, mesh.material as MeshStandardMaterial);
      }
    });
    root.add(body);
    const mixer = new AnimationMixer(body);
    let action = this.clipFor(spec) ? mixer.clipAction(this.clipFor(spec)!) : null;
    action?.play();
    return {
      root,
      update: (dt) => mixer.update(dt),
      play: (name, fade = 0.4) => {
        const clip = this.clips.get(name);
        if (!clip) return;
        const next = mixer.clipAction(clip);
        next.reset().play();
        if (action) next.crossFadeFrom(action, fade, false);
        action = next;
      },
      bone: (name) => body.getObjectByName(name) as Bone | undefined,
    };
  }
}

export { randomFrom };
