import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Euler,
  Float32BufferAttribute,
  Group,
  HalfFloatType,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Quaternion,
  Ray,
  SRGBColorSpace,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Texture,
} from 'three';
import { LAYERS, photoConfig, REDUCED_MOTION, renderConfig } from '../../config/experience.config';
import { dreamConfig } from '../../config/dream.config';
import { seaConfig } from '../../config/sea.config';
import { DEG, lerp, range, smootherstep } from '../math';
import { Photograph } from '../photograph/Photograph';
import { Grade } from '../render/Grade';
import type { DreamKit } from './DreamKit';
import { randomFrom } from './FigureKit';

const G = dreamConfig.giantPrint;
const { print, image } = photoConfig;
/** Half the side of the giant print's image (m). */
const HALF = (image.size * G.scale) / 2;
/** Image center height above the print's center (m). */
const IMAGE_RISE = (print.height / 2 - image.offsetFromTop - image.size / 2) * G.scale;
/** The image must overlap every screen corner by this share of its half side before it counts as covering. */
const COVER_MARGIN = 0.02;
/** The window may be undersized by this many pixels around its screen bounds (soft edges of the scissor). */
const SCISSOR_PAD = 4;
/** The white border above the image (m), and how far from the image a wound stays (m). */
const BORDER = image.offsetFromTop * G.scale;
const BORDER_GAP = 0.002;
/** How many steps a link's wire takes around each end and along each side, and around itself: fine and coarse. */
const FINE_LINK = [6, 2, 6] as const;
const COARSE_LINK = [3, 1, 3] as const;

const corner = new Vector3();
const hit = new Vector3();
const local = new Vector3();
const ray = new Ray();
const plane = new Plane();
const normal = new Vector3();
const offset = new Vector3(...seaConfig.offset);

/**
 * One link: a round wire swept around a stadium, standing along y, lying in its own xy plane. UVs in
 * meters of wire, so rust is the same size on every link.
 */
function linkGeometry(perEnd: number, perSide: number, around: number): BufferGeometry {
  const { length, width, wire } = G.chain;
  const radius = (width - wire * 2) / 2;
  const side = length - wire * 2 - radius * 2;
  // the wire's middle line, counterclockwise from the bottom of its right side, with its outward direction
  const path: { x: number; y: number; nx: number; ny: number }[] = [];
  for (let i = 0; i < perSide; i++) path.push({ x: radius, y: -side / 2 + (side * i) / perSide, nx: 1, ny: 0 });
  for (let i = 0; i < perEnd; i++) {
    const a = (Math.PI * i) / perEnd;
    path.push({ x: Math.cos(a) * radius, y: side / 2 + Math.sin(a) * radius, nx: Math.cos(a), ny: Math.sin(a) });
  }
  for (let i = 0; i < perSide; i++) path.push({ x: -radius, y: side / 2 - (side * i) / perSide, nx: -1, ny: 0 });
  for (let i = 0; i < perEnd; i++) {
    const a = Math.PI + (Math.PI * i) / perEnd;
    path.push({ x: Math.cos(a) * radius, y: -side / 2 + Math.sin(a) * radius, nx: Math.cos(a), ny: Math.sin(a) });
  }
  path.push(path[0]);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  const row = around + 1;
  let along = 0;
  path.forEach((p, i) => {
    if (i > 0) along += Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y);
    for (let j = 0; j <= around; j++) {
      const b = (Math.PI * 2 * j) / around;
      const c = Math.cos(b);
      const s = Math.sin(b);
      positions.push(p.x + p.nx * c * wire, p.y + p.ny * c * wire, s * wire);
      normals.push(p.nx * c, p.ny * c, s);
      uvs.push(along, b * wire);
      if (i < path.length - 1 && j < around) {
        const a = i * row + j;
        index.push(a, a + row, a + 1, a + row, a + row + 1, a + 1);
      }
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
}

/** The paper where a hook went through it: a dark hole, a tear up to the edge, rust weeping down from it. */
function woundTexture(seed: number): CanvasTexture {
  const W = G.wound;
  const H = G.hooks;
  const height = BORDER - BORDER_GAP;
  const canvas = document.createElement('canvas');
  const w = (canvas.width = W.resolution);
  const h = (canvas.height = Math.round((w * height) / W.width));
  const ctx = canvas.getContext('2d')!;
  const random = randomFrom(seed);
  const perMeter = w / W.width;
  const cx = w / 2;
  const cy = ((H.bite - H.steel) / height) * h;

  const stain = ctx.createRadialGradient(cx, cy, W.hole * perMeter * 0.6, cx, cy, w * 0.2);
  stain.addColorStop(0, 'rgba(46,22,10,0.8)');
  stain.addColorStop(1, 'rgba(46,22,10,0)');
  ctx.fillStyle = stain;
  ctx.fillRect(0, 0, w, h);

  ctx.lineCap = 'round';
  for (let n = 0; n < W.runs; n++) {
    const x = cx + (random() - 0.5) * random() * w * 0.42;
    ctx.strokeStyle = `rgba(${52 + random() * 34},${24 + random() * 16},${9 + random() * 8},${0.06 + random() * 0.3})`;
    ctx.lineWidth = 0.6 + random() * random() * 7;
    ctx.beginPath();
    ctx.moveTo(x, cy - random() * h * 0.12);
    ctx.lineTo(x + (random() - 0.5) * 3, h);
    ctx.stroke();
  }

  // the weight of the print tore the paper from the hole to its edge
  ctx.strokeStyle = 'rgba(8,5,4,0.95)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  let x = cx;
  for (let y = cy; y > 0; y -= 2 + random() * 5) {
    x += (random() - 0.5) * 3.2;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(x, 0);
  ctx.stroke();

  ctx.fillStyle = '#050302';
  ctx.beginPath();
  ctx.ellipse(cx, cy, W.hole * perMeter * 1.15, W.hole * perMeter, 0, 0, Math.PI * 2);
  ctx.fill();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * The print at the end of everything, far too large, hanging over the void by two butcher's hooks:
 * a photograph of the sea. From afar it is a still; closer, it is a live window into the sea
 * (the sea seen from exactly where you stand, moved by the sea's offset); once its image fills
 * the view, the sea itself is drawn instead — the same move that took you into the first photograph.
 */
export class GiantPrint {
  readonly root = new Group();
  readonly photo: Photograph;
  readonly stillRT = new WebGLRenderTarget(G.still.resolution, G.still.resolution, { type: HalfFloatType, samples: 2 });
  /** Center of the image (world), for attention and distances. */
  readonly imageCenter = new Vector3(G.center[0], G.center[1] + IMAGE_RISE, G.z);
  /** The hooks, the links the light reaches, and a coarser link (their reflections are made from these). */
  readonly hooks: Object3D[] = [];
  readonly chain: InstancedMesh;
  readonly coarseLink = linkGeometry(...COARSE_LINK);

  private readonly hanger = new Group();
  private readonly hardware = new Group();
  private sway = 0;

  constructor(portal: Texture, kit: DreamKit) {
    this.root.name = 'GiantPrint';
    this.photo = new Photograph({ photo: this.stillRT.texture, grade: new Grade() });
    this.photo.scale.setScalar(G.scale);
    const u = this.photo.uniforms;
    u.tPortal.value = portal;
    u.uDevelop.value = 1;

    // the hanger swings around the print's top edge, on the hooks
    const top = G.center[1] + (print.height * G.scale) / 2;
    this.hanger.position.set(G.center[0], top, G.z);
    this.photo.position.set(0, -(print.height * G.scale) / 2, 0);
    this.hanger.add(this.photo);
    this.hardware.name = 'Hooks';
    this.root.add(this.hanger, this.hardware);
    this.chain = this.buildHardware(kit, top);

    const l = G.light;
    kit.lights.add([this.imageCenter.x, this.imageCenter.y, G.z - l.behind], l.color, l.intensity, l.distance);
  }

  /** Two hooks through the top edge, each on its chain, straight up into the dark. Returns the links the light reaches. */
  private buildHardware(kit: DreamKit, top: number): InstancedMesh {
    const H = G.hooks;
    const C = G.chain;
    const steel = kit.surface('rust_streaked', H.tile, { metalness: H.metalness });
    const wrought = kit.surface('rust_streaked', C.tile, { metalness: H.metalness });
    const bottom = top - H.bite;
    // a link hangs from the one above it with their wires touching
    const pitch = C.length - C.wire * 4;
    const first = bottom + H.bar[0] * H.height - H.steel - C.wire + (C.length - C.wire * 2) / 2;
    const rows = Math.ceil((C.top - first) / pitch);
    const lit = new InstancedMesh(linkGeometry(...FINE_LINK), wrought, C.lit * 2);
    const dark = new InstancedMesh(this.coarseLink, wrought, (rows - C.lit) * 2);
    lit.name = 'ChainLit';
    dark.name = 'ChainDark';

    // the paper's curl has taken it back this far where the hooks go through
    const across = H.x / ((print.width * G.scale) / 2);
    const sag = photoConfig.curl * across * across * G.scale;
    const random = randomFrom(C.seed);
    const J = C.jitter;
    const matrix = new Matrix4();
    const at = new Vector3();
    const turn = new Quaternion();
    const lean = new Euler(0, 0, 0, 'YXZ');
    const one = new Vector3(1, 1, 1);
    const tone = new Color();
    // both points come toward you, curving inward (the second hook is the first turned a half turn the long way)
    for (const [side, x, heading] of [[0, -H.x, -H.turn], [1, H.x, 180 + H.turn]] as const) {
      const hook = kit.prop('meat_hook', [x, bottom, G.z - sag], { scale: H.height, rotation: [0, heading, 0] }, this.hardware);
      kit.paint(hook, steel);
      this.hooks.push(hook);
      const yaw = heading * DEG;
      const bar = H.bar[1] * H.height;
      const cx = x + bar * Math.cos(yaw);
      const cz = G.z - sag - bar * Math.sin(yaw);
      for (let i = 0; i < rows; i++) {
        const stray = () => (random() * 2 - 1) * J.shift;
        const askew = (limit: number) => (random() * 2 - 1) * limit * DEG;
        // the lowest link closes around the hook's top bar; each next one lies a quarter turn from the last
        lean.set(askew(J.lean), yaw + (i % 2) * (Math.PI / 2) + askew(J.turn), askew(J.lean));
        matrix.compose(at.set(cx + stray(), first + i * pitch, cz + stray()), turn.setFromEuler(lean), one);
        tone.setScalar(lerp(J.tone[0], J.tone[1], random()));
        const links = i < C.lit ? lit : dark;
        const slot = (i < C.lit ? i : i - C.lit) * 2 + side;
        links.setMatrixAt(slot, matrix);
        links.setColorAt(slot, tone);
      }
      this.buildWound(x, sag, side);
    }
    this.hardware.add(lit, dark);
    return lit;
  }

  /** The hole a hook made, laid on the paper: it hangs with the paper, and stays clear of the image. */
  private buildWound(x: number, sag: number, seed: number): void {
    const W = G.wound;
    const height = BORDER - BORDER_GAP;
    const material = new MeshStandardMaterial({
      map: woundTexture(G.chain.seed + seed),
      transparent: true,
      depthWrite: false,
      roughness: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    const wound = new Mesh(new PlaneGeometry(W.width, height), material);
    wound.name = 'HookWound';
    wound.position.set(x, -height / 2, (print.thickness * G.scale) / 2 - sag + W.lift);
    // along the curl of the paper there
    wound.rotation.y = Math.atan((2 * sag) / x);
    this.hanger.add(wound);
  }

  /** Signed distance (m) of a point in front of the print's surface (walk frame, positive on the alley side). */
  distance(eye: Vector3): number {
    return eye.z - G.z;
  }

  /** 0 = still, 1 = live window, by the viewer's distance. */
  liveMix(eye: Vector3): number {
    return smootherstep(range(G.live[0], G.live[1], this.distance(eye)));
  }

  /** Is the image filling the whole view of `camera` (walk frame)? */
  covers(camera: PerspectiveCamera): boolean {
    const image = this.photo.image;
    image.updateWorldMatrix(true, false);
    normal.set(0, 0, 1).transformDirection(image.matrixWorld);
    plane.setFromNormalAndCoplanarPoint(normal, image.getWorldPosition(local));
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      corner.set(x, y, 0.5).unproject(camera);
      ray.origin.copy(camera.position);
      ray.direction.subVectors(corner, camera.position).normalize();
      if (!ray.intersectPlane(plane, hit)) return false;
      image.worldToLocal(hit);
      const limit = (photoConfig.image.size / 2) * (1 - COVER_MARGIN);
      if (Math.abs(hit.x) > limit || Math.abs(hit.y) > limit) return false;
    }
    return true;
  }

  /** The camera the still is taken from: on the image axis, `still.distance` in front, moved into the sea. */
  stillCamera(): PerspectiveCamera {
    const cam = new PerspectiveCamera(2 * Math.atan(HALF / G.still.distance) / DEG, 1, renderConfig.near, renderConfig.far);
    cam.position.copy(this.imageCenter).add(offset);
    cam.position.z += G.still.distance;
    cam.lookAt(local.copy(this.imageCenter).add(offset));
    cam.layers.set(LAYERS.WORLD);
    cam.layers.enable(LAYERS.DREAM);
    cam.updateMatrixWorld(true);
    return cam;
  }

  /**
   * The screen rectangle (drawing-buffer pixels) the image covers for `camera`, padded; null when it is
   * off screen. The live window only needs to be drawn there.
   */
  screenRect(camera: PerspectiveCamera, width: number, height: number, out: Vector4): Vector4 | null {
    const image = this.photo.image;
    image.updateWorldMatrix(true, false);
    const half = photoConfig.image.size / 2;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      corner.set(x * half, y * half, 0).applyMatrix4(image.matrixWorld);
      // behind the eye the projection flips: just draw everything
      if (local.copy(corner).applyMatrix4(camera.matrixWorldInverse).z > -camera.near) return out.set(0, 0, width, height);
      corner.project(camera);
      x0 = Math.min(x0, corner.x);
      x1 = Math.max(x1, corner.x);
      y0 = Math.min(y0, corner.y);
      y1 = Math.max(y1, corner.y);
    }
    if (x1 < -1 || x0 > 1 || y1 < -1 || y0 > 1) return null;
    const px = (v: number, size: number) => MathUtils.clamp(((v + 1) / 2) * size, 0, size);
    const left = Math.floor(px(x0, width)) - SCISSOR_PAD;
    const bottom = Math.floor(px(y0, height)) - SCISSOR_PAD;
    const right = Math.ceil(px(x1, width)) + SCISSOR_PAD;
    const top = Math.ceil(px(y1, height)) + SCISSOR_PAD;
    return out.set(Math.max(0, left), Math.max(0, bottom), Math.min(width, right) - Math.max(0, left), Math.min(height, top) - Math.max(0, bottom));
  }

  /** Sway on the hooks, settling as you come close (so its image can cover the view steadily). */
  update(time: number, eye: Vector3): void {
    const settle = range(G.sway.stillWithin, G.sway.stillWithin * 2, this.distance(eye));
    this.sway = REDUCED_MOTION ? 0 : Math.sin((time / G.sway.period) * Math.PI * 2) * G.sway.amount * DEG * settle;
    this.hanger.rotation.x = this.sway;
    this.hardware.visible = eye.z < G.hardwareFrom;
  }
}
