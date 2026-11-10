import {
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three';

/** A flat place things can crawl on: a corner, and two edges from it (the normal is `u` × `v`, toward the room). */
export interface CrawlSurface {
  corner: readonly [number, number, number];
  u: readonly [number, number, number];
  v: readonly [number, number, number];
}

interface Crawler {
  surface: number;
  /** Place on the surface (shares of its edges), heading (rad), speed (m/s). */
  a: number;
  b: number;
  heading: number;
  speed: number;
  /** Seconds until it changes its mind. */
  thought: number;
  scale: number;
  /** Stands still until this much time has passed. */
  rest: number;
}

const m = new Matrix4();
const q = new Quaternion();
const qHeading = new Quaternion();
const p = new Vector3();
const s = new Vector3();
const edgeU = new Vector3();
const edgeV = new Vector3();
const normal = new Vector3();
const toPoint = new Vector3();
const UP = new Vector3(0, 1, 0);
const AT_REST = new Matrix4().makeScale(0, 0, 0);

/** A deterministic random sequence: a swarm is the same on every visit. */
function randomFrom(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Many small things that crawl over flat surfaces: one model, drawn once per material, each one moved on the
 * CPU. Its legs tremble in the vertex shader, more the farther a vertex lies from the body's center line.
 * Things crawl over `surfaces`: `reveal` sets how many of them exist, `fleeFrom` and `toward` steer them.
 */
export class Swarm {
  readonly root = new Group();
  private readonly meshes: InstancedMesh[] = [];
  private readonly crawlers: Crawler[] = [];
  private readonly lengths: number[] = [];
  private readonly time = { value: 0 };
  /** Steer away from (or, with a negative strength, toward) this point. */
  private readonly goal = new Vector3();
  private goalPull = 0;
  private shown: number;
  private readonly lift: number;

  constructor(
    source: Object3D,
    count: number,
    private readonly surfaces: readonly CrawlSurface[],
    opts: { seed?: number; size?: readonly [number, number]; speed?: readonly [number, number]; lift?: number; tremble?: number; castShadow?: boolean } = {},
  ) {
    const random = randomFrom(opts.seed ?? 1);
    const size = opts.size ?? [0.8, 1.2];
    const speed = opts.speed ?? [0.1, 0.4];
    this.lift = opts.lift ?? 0.005;
    const tremble = opts.tremble ?? 0.14;
    source.updateMatrixWorld(true);
    source.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const geometry: BufferGeometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      const material = (mesh.material as MeshStandardMaterial).clone();
      material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
        shader.uniforms.uSwarmTime = this.time;
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uSwarmTime;').replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
          float swarmSide = abs(position.x) + abs(position.z);
          transformed.y += sin(uSwarmTime * 19.0 + instanceMatrix[3].x * 31.0 + position.x * 40.0) * ${tremble.toFixed(3)} * swarmSide;
          #endif`,
        );
      };
      material.customProgramCacheKey = () => `swarm-${tremble}`;
      const instanced = new InstancedMesh(geometry, material as Material, count);
      instanced.frustumCulled = false;
      instanced.castShadow = Boolean(opts.castShadow);
      instanced.receiveShadow = false;
      this.meshes.push(instanced);
      this.root.add(instanced);
    });
    for (const surface of surfaces) {
      this.lengths.push(Math.hypot(...surface.u), Math.hypot(...surface.v));
    }
    for (let i = 0; i < count; i++) {
      this.crawlers.push({
        surface: Math.floor(random() * surfaces.length),
        a: random(),
        b: random(),
        heading: random() * Math.PI * 2,
        speed: speed[0] + (speed[1] - speed[0]) * random(),
        thought: random() * 2,
        scale: size[0] + (size[1] - size[0]) * random(),
        rest: random() * 0.6,
      });
    }
    this.shown = count;
    this.writeAll();
  }

  /** How many exist now. */
  reveal(count: number): void {
    this.shown = Math.min(count, this.crawlers.length);
  }

  /** Put one somewhere by hand: on surface `surface`, at shares (a, b) of its edges. */
  place(i: number, surface: number, a: number, b: number, heading = 0, scale?: number): void {
    const c = this.crawlers[i];
    c.surface = surface;
    c.a = a;
    c.b = b;
    c.heading = heading;
    if (scale !== undefined) c.scale = scale;
  }

  /** From now on they run from this point (room frame), with this strength; negative runs toward it; 0 wanders. */
  steer(x: number, y: number, z: number, strength: number): void {
    this.goal.set(x, y, z);
    this.goalPull = strength;
  }

  /** Crawl. `rate` scales their speed (0 holds them still). */
  update(dt: number, rate = 1): void {
    this.time.value += dt * rate;
    if (rate === 0) return;
    for (let i = 0; i < this.shown; i++) {
      const c = this.crawlers[i];
      c.rest -= dt * rate;
      if (c.rest > 0) continue;
      c.thought -= dt * rate;
      const su = this.surfaces[c.surface];
      if (c.thought <= 0) {
        c.thought = 0.4 + ((i * 0.37) % 1) * 1.6;
        c.heading += ((((i * 7.13 + this.time.value * 3.1) % 1) + 1) % 1 - 0.5) * 2.2;
        if ((i + Math.floor(this.time.value * 3)) % 9 === 0) c.rest = 0.3;
      }
      if (this.goalPull !== 0) {
        edgeU.set(su.u[0], su.u[1], su.u[2]);
        edgeV.set(su.v[0], su.v[1], su.v[2]);
        p.set(su.corner[0], su.corner[1], su.corner[2]).addScaledVector(edgeU, c.a).addScaledVector(edgeV, c.b);
        toPoint.subVectors(this.goal, p);
        const away = this.goalPull > 0 ? -1 : 1;
        const along = Math.atan2(toPoint.dot(edgeV) * away, toPoint.dot(edgeU) * away);
        c.heading = along;
      }
      const lu = this.lengths[c.surface * 2];
      const lv = this.lengths[c.surface * 2 + 1];
      const step = c.speed * dt * rate * (this.goalPull !== 0 ? Math.abs(this.goalPull) : 1);
      c.a += (Math.cos(c.heading) * step) / lu;
      c.b += (Math.sin(c.heading) * step) / lv;
      if (c.a < 0 || c.a > 1 || c.b < 0 || c.b > 1) {
        c.a = Math.min(1, Math.max(0, c.a));
        c.b = Math.min(1, Math.max(0, c.b));
        c.heading += Math.PI * 0.75;
      }
    }
    this.writeAll();
  }

  private writeAll(): void {
    for (let i = 0; i < this.crawlers.length; i++) {
      if (i >= this.shown) {
        for (const mesh of this.meshes) mesh.setMatrixAt(i, AT_REST);
        continue;
      }
      const c = this.crawlers[i];
      const su = this.surfaces[c.surface];
      edgeU.set(su.u[0], su.u[1], su.u[2]);
      edgeV.set(su.v[0], su.v[1], su.v[2]);
      normal.crossVectors(edgeU, edgeV).normalize();
      p.set(su.corner[0], su.corner[1], su.corner[2]).addScaledVector(edgeU, c.a).addScaledVector(edgeV, c.b).addScaledVector(normal, this.lift);
      q.setFromUnitVectors(UP, normal);
      // the model's nose lies along +Z: `u` is the surface's own zero heading
      qHeading.setFromAxisAngle(UP, Math.PI / 2 - c.heading);
      q.multiply(qHeading);
      m.compose(p, q, s.setScalar(c.scale));
      for (const mesh of this.meshes) mesh.setMatrixAt(i, m);
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }
}
