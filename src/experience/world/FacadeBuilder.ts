import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
  BackSide,
  type BufferGeometry,
  type Material,
} from 'three';

export type Facing = 'east' | 'west' | 'north' | 'south';

/** A facade assembled from a modular kit (modules are 3 m wide and 3 m tall, pivot bottom-right, facing +Z). */
export interface FacadeSpec {
  kit: string;
  /** Direction the facade looks at (east = +X). */
  facing: Facing;
  /** Corner where the first column starts (x, z). */
  start: readonly [number, number];
  /** Unit direction (x, z) along which columns are laid out. */
  run: readonly [number, number];
  /** Floors from the ground up; each lists its modules in order (a "garage" module takes two columns). */
  floors: readonly (readonly string[])[];
  /** Trim band repeated at every floor line, and its vertical offset from the line. */
  band?: string;
  bandOffset?: number;
  crown?: string;
  /** Opening frames/doors placed together with a wall module (kits store them separately). */
  inserts?: Readonly<Record<string, readonly string[]>>;
  /** Part of the street it belongs to ('far' = the cross street at the end of the alley). */
  region?: 'far';
  /** Degrees the whole building leans around its base line (positive leans out over the street). */
  lean?: number;
}

/** Kit modules are 3 m wide; floors are 3 m tall. */
export const MODULE = 3;
export const FLOOR = 3;
/** Dark building mass behind each facade: depth, setback behind the facade plane, overhang above it. */
const MASS = { depth: 6, setback: 0.3, overhang: 1 };
export const FACING_ANGLE: Record<Facing, number> = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 };

const interior = new MeshStandardMaterial({ color: 0x07080a, roughness: 1, side: BackSide });

/**
 * Instantiates kit modules with one InstancedMesh per (module, primitive), so a whole street of
 * facades costs a few dozen draw calls.
 */
export class FacadeBuilder {
  /** Primitives of each module with their module-relative transform. */
  private readonly pieces = new Map<string, { mesh: Mesh; local: Matrix4 }[]>();
  private readonly placements = new Map<string, Matrix4[]>();
  private readonly masses: Mesh[] = [];

  /** Register a kit; its modules become addressable as "<kit>/<module name>". */
  addKit(kit: string, root: Object3D): void {
    root.updateMatrixWorld(true);
    for (const node of root.children) {
      // modules sit at the origin (see scripts/build-assets.mjs); the node transform is dequantization
      node.updateMatrix();
      const nodeLocal = node.matrix.clone();
      const meshes: { mesh: Mesh; local: Matrix4 }[] = [];
      node.traverse((o) => {
        if (!(o as Mesh).isMesh) return;
        const local = o === node ? nodeLocal.clone() : nodeLocal.clone().multiply(o.matrix);
        meshes.push({ mesh: o as Mesh, local });
      });
      if (meshes.length) this.pieces.set(`${kit}/${node.name}`, meshes);
    }
  }

  private widthOf(piece: string): number {
    return /garage/.test(piece) ? MODULE * 2 : MODULE;
  }

  /** `transform` (optional) moves the placed module afterwards, e.g. a building's lean. */
  place(piece: string, position: Vector3, rotationY: number, scale = 1, transform?: Matrix4): void {
    if (!this.pieces.has(piece)) throw new Error(`unknown kit module: ${piece}`);
    const m = new Matrix4().compose(
      position,
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rotationY),
      new Vector3(scale, scale, scale),
    );
    if (transform) m.premultiply(transform);
    const list = this.placements.get(piece) ?? [];
    list.push(m);
    this.placements.set(piece, list);
  }

  /** The lean of a facade as a transform: a rotation around its base line, toward the way it faces. */
  static leanOf(spec: FacadeSpec): Matrix4 | undefined {
    if (!spec.lean) return undefined;
    const theta = FACING_ANGLE[spec.facing];
    const facing = new Vector3(Math.sin(theta), 0, Math.cos(theta));
    // rotating "up" around (up x facing) tips the top toward the facing direction
    const axis = new Vector3(0, 1, 0).cross(facing).normalize();
    const base = new Vector3(spec.start[0], 0, spec.start[1]);
    return new Matrix4()
      .makeTranslation(base.x, 0, base.z)
      .multiply(new Matrix4().makeRotationAxis(axis, (spec.lean * Math.PI) / 180))
      .multiply(new Matrix4().makeTranslation(-base.x, 0, -base.z));
  }

  facade(spec: FacadeSpec): void {
    const theta = FACING_ANGLE[spec.facing];
    const lean = FacadeBuilder.leanOf(spec);
    const r = new Vector3(Math.cos(theta), 0, -Math.sin(theta));
    const u = new Vector3(spec.run[0], 0, spec.run[1]);
    const alongR = u.dot(r) > 0;
    const start = new Vector3(spec.start[0], 0, spec.start[1]);
    const k = (name: string) => `${spec.kit}/${name}`;
    /** Pivot of a module that starts `offset` meters along the run and is `width` wide. */
    const pivot = (offset: number, width: number, y: number) =>
      start.clone().addScaledVector(u, offset + (alongR ? width : 0)).setY(y);

    let length = 0;
    spec.floors.forEach((floor, level) => {
      let offset = 0;
      for (const module of floor) {
        const width = this.widthOf(module);
        const y = level * FLOOR;
        this.place(k(module), pivot(offset, width, y), theta, 1, lean);
        for (const insert of spec.inserts?.[module] ?? []) this.place(k(insert), pivot(offset, width, y), theta, 1, lean);
        offset += width;
      }
      length = Math.max(length, offset);
    });
    const columns = length / MODULE;
    const height = spec.floors.length * FLOOR;
    for (let i = 0; i < columns; i++) {
      const at = (y: number) => pivot(i * MODULE, MODULE, y);
      if (spec.crown) this.place(k(spec.crown), at(height), theta, 1, lean);
      if (spec.band) for (let level = 1; level < spec.floors.length; level++) this.place(k(spec.band), at(level * FLOOR + (spec.bandOffset ?? 0)), theta, 1, lean);
    }

    // dark building mass behind the facade, so windows look into rooms, not into the void
    const n = new Vector3(Math.sin(theta), 0, Math.cos(theta));
    const mass = new Mesh(new BoxGeometry(length, height + MASS.overhang, MASS.depth), interior);
    mass.renderOrder = 1; // after the walls in front of it
    mass.position.copy(start).addScaledVector(u, length / 2).addScaledVector(n, -MASS.depth / 2 - MASS.setback);
    mass.position.y = height / 2;
    mass.rotation.y = theta;
    if (lean) mass.applyMatrix4(lean);
    this.masses.push(mass);
  }

  /** Bake all placements into instanced meshes (and start a fresh batch). */
  build(): Group {
    const group = new Group();
    group.name = 'Facades';
    const tmp = new Matrix4();
    for (const [piece, matrices] of this.placements) {
      for (const { mesh, local } of this.pieces.get(piece)!) {
        const inst = new InstancedMesh(mesh.geometry as BufferGeometry, mesh.material as Material, matrices.length);
        inst.name = `${piece}:${mesh.name}`;
        matrices.forEach((m, i) => inst.setMatrixAt(i, tmp.multiplyMatrices(m, local)));
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        // walls only receive: the alley's shadows come from bodies and props, not from flat facades
        inst.castShadow = false;
        inst.receiveShadow = true;
        group.add(inst);
      }
    }
    for (const m of this.masses) group.add(m);
    this.placements.clear();
    this.masses.length = 0;
    return group;
  }
}
