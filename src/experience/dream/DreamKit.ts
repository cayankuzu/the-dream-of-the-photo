import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Material,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderTarget,
} from 'three';
import type { Assets } from '../assets/Assets';
import type { Photographer } from '../character/Photographer';
import type { LookControls, PointOfInterest } from '../interaction/LookControls';
import type { Alley } from '../world/Alley';
import { instance, reflectionOnlyGlass } from '../world/props';
import { FigureKit } from './FigureKit';
import { LightPool } from './LightPool';

/** Longest edge (m) of geometry that has to bend with curved space (see render/Warp.ts). */
export const BEND_STEP = 1.5;

type V3 = readonly [number, number, number];

export interface PropOptions {
  rotation?: V3;
  scale?: number;
  anchor?: 'bottom' | 'center' | 'top';
  castShadow?: boolean;
  nodes?: readonly string[];
}

const box3 = new Vector3();
const scratch = new Matrix4();
const q = new Quaternion();
const UP = new Vector3(0, 1, 0);

/** Texture coordinates in meters, picked by each vertex's facing, so a tile is the same size everywhere. */
export function meterUVs(geometry: BufferGeometry): BufferGeometry {
  const p = geometry.getAttribute('position');
  const n = geometry.getAttribute('normal');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    if (ay >= ax && ay >= az) {
      uv[i * 2] = p.getX(i);
      uv[i * 2 + 1] = p.getZ(i);
    } else if (ax >= az) {
      uv[i * 2] = p.getZ(i);
      uv[i * 2 + 1] = p.getY(i);
    } else {
      uv[i * 2] = p.getX(i);
      uv[i * 2 + 1] = p.getY(i);
    }
  }
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setAttribute('uv1', new Float32BufferAttribute(uv.slice(), 2));
  return geometry;
}

/** Many of one model drawn once per material: moving one is writing a matrix. */
export class PropCrowd {
  readonly root = new Group();
  readonly count: number;
  private readonly parts: { mesh: InstancedMesh; local: Matrix4 }[] = [];
  private readonly base = new Matrix4();

  constructor(source: Object3D, count: number, castShadow: boolean) {
    this.count = count;
    this.root.name = 'PropCrowd';
    source.updateMatrixWorld(true);
    source.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const mesh = new InstancedMesh(m.geometry, m.material as Material, count);
      mesh.frustumCulled = false;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      this.parts.push({ mesh, local: m.matrixWorld.clone() });
      this.root.add(mesh);
    });
  }

  /** Stand one here, turned `heading` rad, with this uniform scale. */
  set(i: number, x: number, y: number, z: number, heading = 0, scale = 1): void {
    this.base.compose(box3.set(x, y, z), q.setFromAxisAngle(UP, heading), new Vector3(scale, scale, scale));
    this.setMatrix(i, this.base);
  }

  setMatrix(i: number, matrix: Matrix4): void {
    for (const p of this.parts) p.mesh.setMatrixAt(i, scratch.multiplyMatrices(matrix, p.local));
  }

  commit(): void {
    for (const p of this.parts) p.mesh.instanceMatrix.needsUpdate = true;
  }

  set drawn(count: number) {
    for (const p of this.parts) p.mesh.count = count;
  }
}

export interface KitContext {
  assets: Assets;
  alley: Alley;
  photographer: Photographer;
  look: LookControls;
  /** Render the dream into a target from a camera (never from inside `prepare`). */
  renderDream: (target: WebGLRenderTarget, camera: PerspectiveCamera) => void;
}

/**
 * What every set piece builds with: the loaded assets, the people, the lights of the dream, and
 * surfaces and geometry that behave in curved space.
 */
export class DreamKit {
  readonly assets: Assets;
  readonly alley: Alley;
  readonly photographer: Photographer;
  readonly look: LookControls;
  readonly renderDream: KitContext['renderDream'];
  readonly figures: FigureKit;
  readonly lights = new LightPool();

  private readonly glassDone = new Set<string>();

  constructor(ctx: KitContext) {
    this.assets = ctx.assets;
    this.alley = ctx.alley;
    this.photographer = ctx.photographer;
    this.look = ctx.look;
    this.renderDream = ctx.renderDream;
    this.figures = new FigureKit(ctx.assets);
  }

  /** A loaded model (its transmissive glass replaced: it would cost a whole extra render). */
  model(key: string) {
    const gltf = this.assets.models.get(key);
    if (!gltf) throw new Error(`model not loaded: ${key}`);
    if (!this.glassDone.has(key)) {
      reflectionOnlyGlass(gltf.scene);
      this.glassDone.add(key);
    }
    return gltf;
  }

  /** Place a model by its real bounds (see world/props.ts). Shadows are off unless asked for. */
  prop(key: string, at: V3, opts: PropOptions = {}, parent?: Object3D): Object3D {
    const o = instance(this.model(key), { at, rotation: opts.rotation, scale: opts.scale, anchor: opts.anchor, castShadow: opts.castShadow ?? false }, opts.nodes);
    o.name = key;
    parent?.add(o);
    return o;
  }

  /** `count` copies of a model, resting on their base at the origin (`scale` is built in). */
  props(key: string, count: number, opts: { scale?: number; rotation?: V3; castShadow?: boolean; nodes?: readonly string[] } = {}): PropCrowd {
    const pivot = instance(this.model(key), { at: [0, 0, 0], scale: opts.scale, rotation: opts.rotation, castShadow: false }, opts.nodes);
    return new PropCrowd(pivot, count, opts.castShadow ?? false);
  }

  /** Give an untextured scan (or anything) a material of your choice. */
  paint<T extends Object3D>(object: T, material: Material): T {
    object.traverse((o) => {
      if ((o as Mesh).isMesh) (o as Mesh).material = material;
    });
    return object;
  }

  /** A PBR surface from public/textures, its image repeating every `tile` m (geometry UVs are in meters). */
  surface(key: string, tile: number, extra: Partial<MeshStandardMaterial> = {}): MeshStandardMaterial {
    const maps = this.assets.materials.get(key);
    if (!maps) throw new Error(`material not loaded: ${key}`);
    const clone = (t: Texture) => {
      const c = t.clone();
      c.repeat.setScalar(1 / tile);
      c.needsUpdate = true;
      return c;
    };
    const orm = clone(maps.ormMap);
    return new MeshStandardMaterial({
      map: clone(maps.map),
      normalMap: clone(maps.normalMap),
      roughnessMap: orm,
      aoMap: orm,
      aoMapIntensity: 0.8,
      metalness: 0,
      roughness: 1,
      ...extra,
    });
  }

  /**
   * A flat wall or floor that can bend: facing +Z, `width` × `height`, cut into BEND_STEP squares.
   * Rotate it into place; UVs are in meters from the given origin.
   */
  wall(width: number, height: number, material: Material, originU = 0, originV = 0): Mesh {
    const g = new PlaneGeometry(width, height, Math.max(1, Math.ceil(width / BEND_STEP)), Math.max(1, Math.ceil(height / BEND_STEP)));
    const p = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) + originU, p.getY(i) + originV);
    g.setAttribute('uv1', uv.clone());
    const mesh = new Mesh(g, material);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** A floor at height y over [x0, x1] × [z0, z1]. */
  floor(x0: number, x1: number, z0: number, z1: number, y: number, material: Material): Mesh {
    const mesh = this.wall(Math.abs(x1 - x0), Math.abs(z1 - z0), material, (x0 + x1) / 2, (z0 + z1) / 2);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    return mesh;
  }

  /** A solid block that can bend, UVs in meters. */
  block(width: number, height: number, depth: number, material: Material): Mesh {
    const seg = (s: number) => Math.max(1, Math.ceil(s / BEND_STEP));
    const mesh = new Mesh(meterUVs(new BoxGeometry(width, height, depth, seg(width), seg(height), seg(depth))), material);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Something a long look finds or draws the view to. */
  poi(point: PointOfInterest): void {
    this.look.pointsOfInterest.push(point);
  }
}

export { DoubleSide };
