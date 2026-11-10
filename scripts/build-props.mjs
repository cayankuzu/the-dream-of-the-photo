/**
 * Models and one material made here for the rooms, from nothing or from sources scripts/build-scans.mjs already fetches:
 * cloth that really fell over things, an eye with lids, a doll, a bed whose sheet sits up, and so on. Everything
 * is deterministic. Writes plain GLBs to .asset-cache/scans/, where scripts/assets.json picks them up as 'local' models.
 *
 *   node scripts/build-scans.mjs   then   node scripts/build-props.mjs [--only key1,key2]   then   npm run assets -- --only key1,key2
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.asset-cache/scans');
const SRC = path.join(OUT, 'src');
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null;
const wanted = (key) => !only || only.has(key);

await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A deterministic random sequence. */
function randomFrom(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ geometry

/** Vertices and triangles; every builder below returns one. Positions in meters. */
class Geo {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.i = [];
  }

  vertex(p, n, uv = [0, 0]) {
    this.p.push(...p);
    this.n.push(...n);
    this.uv.push(...uv);
    return this.p.length / 3 - 1;
  }

  add(other, f = (p) => p) {
    const base = this.p.length / 3;
    for (let v = 0; v < other.p.length / 3; v++) {
      const p = f([other.p[v * 3], other.p[v * 3 + 1], other.p[v * 3 + 2]]);
      this.p.push(...p);
      this.uv.push(other.uv[v * 2], other.uv[v * 2 + 1]);
      this.n.push(other.n[v * 3], other.n[v * 3 + 1], other.n[v * 3 + 2]);
    }
    for (const i of other.i) this.i.push(i + base);
    return this;
  }

  /** Normals from the triangles. */
  smooth() {
    const n = new Float64Array(this.p.length);
    for (let t = 0; t < this.i.length; t += 3) {
      const [a, b, c] = [this.i[t] * 3, this.i[t + 1] * 3, this.i[t + 2] * 3];
      const ux = this.p[b] - this.p[a];
      const uy = this.p[b + 1] - this.p[a + 1];
      const uz = this.p[b + 2] - this.p[a + 2];
      const vx = this.p[c] - this.p[a];
      const vy = this.p[c + 1] - this.p[a + 1];
      const vz = this.p[c + 2] - this.p[a + 2];
      const fx = uy * vz - uz * vy;
      const fy = uz * vx - ux * vz;
      const fz = ux * vy - uy * vx;
      for (const k of [a, b, c]) {
        n[k] += fx;
        n[k + 1] += fy;
        n[k + 2] += fz;
      }
    }
    for (let k = 0; k < n.length; k += 3) {
      const l = Math.hypot(n[k], n[k + 1], n[k + 2]) || 1;
      this.n[k] = n[k] / l;
      this.n[k + 1] = n[k + 1] / l;
      this.n[k + 2] = n[k + 2] / l;
    }
    return this;
  }

  /** Each triangle on its own, for hard edges. */
  flat() {
    const g = new Geo();
    for (let t = 0; t < this.i.length; t += 3) {
      const c = [0, 1, 2].map((k) => {
        const v = this.i[t + k];
        return { p: [this.p[v * 3], this.p[v * 3 + 1], this.p[v * 3 + 2]], uv: [this.uv[v * 2], this.uv[v * 2 + 1]] };
      });
      const [a, b, d] = c.map((x) => x.p);
      const f = [(b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]), (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]), (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])];
      const l = Math.hypot(...f) || 1;
      for (const x of c) g.i.push(g.vertex(x.p, f.map((v) => v / l), x.uv));
    }
    return g;
  }

  /** Fewer triangles, keeping the vertices it keeps (and so their UVs). */
  crush(tris, error = 0.2) {
    if (this.i.length / 3 <= tris) return this;
    const [kept] = MeshoptSimplifier.simplify(new Uint32Array(this.i), new Float32Array(this.p), 3, tris * 3, error);
    const map = new Map();
    const g = new Geo();
    for (const old of kept) {
      if (!map.has(old)) map.set(old, g.vertex([this.p[old * 3], this.p[old * 3 + 1], this.p[old * 3 + 2]], [this.n[old * 3], this.n[old * 3 + 1], this.n[old * 3 + 2]], [this.uv[old * 2], this.uv[old * 2 + 1]]));
      g.i.push(map.get(old));
    }
    return g;
  }
}

/** Turned about Y (or `axis`): a profile of [radius, height]. UV: u around, v along. */
function lathe(profile, segments = 16, { uvRadial = false, smooth = true } = {}) {
  const g = new Geo();
  for (let j = 0; j < profile.length; j++) {
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const r = profile[j][0];
      g.vertex([Math.sin(a) * r, profile[j][1], Math.cos(a) * r], [0, 1, 0], uvRadial ? [0.5 + Math.sin(a) * 0.5 * (j / (profile.length - 1)), 0.5 + Math.cos(a) * 0.5 * (j / (profile.length - 1))] : [s / segments, j / (profile.length - 1)]);
    }
  }
  const row = segments + 1;
  for (let j = 0; j < profile.length - 1; j++) {
    for (let s = 0; s < segments; s++) {
      const a = j * row + s;
      g.i.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  return smooth ? g.smooth() : g;
}

/** A tube along points, of `sides` sides, tapering from r0 to r1; closed ends if `caps`. */
function tube(points, r0, r1 = r0, sides = 6, caps = true) {
  const g = new Geo();
  const up0 = [0.13, 1, 0.21];
  for (let j = 0; j < points.length; j++) {
    const a = points[Math.max(0, j - 1)];
    const b = points[Math.min(points.length - 1, j + 1)];
    let d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(...d) || 1;
    d = d.map((v) => v / l);
    let u = [d[1] * up0[2] - d[2] * up0[1], d[2] * up0[0] - d[0] * up0[2], d[0] * up0[1] - d[1] * up0[0]];
    const ul = Math.hypot(...u) || 1;
    u = u.map((v) => v / ul);
    const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
    const r = r0 + (r1 - r0) * (j / (points.length - 1));
    for (let s = 0; s <= sides; s++) {
      const t = (s / sides) * Math.PI * 2;
      const n = [0, 1, 2].map((k) => u[k] * Math.cos(t) + w[k] * Math.sin(t));
      g.vertex([0, 1, 2].map((k) => points[j][k] + n[k] * r), n, [s / sides, j / (points.length - 1)]);
    }
  }
  const row = sides + 1;
  for (let j = 0; j < points.length - 1; j++) {
    for (let s = 0; s < sides; s++) {
      const a = j * row + s;
      g.i.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  if (caps) {
    for (const [c, flip] of [[0, true], [(points.length - 1) * row, false]]) {
      for (let s = 1; s < sides - 1; s++) {
        if (flip) g.i.push(c, c + s, c + s + 1);
        else g.i.push(c, c + s + 1, c + s);
      }
    }
  }
  return g;
}

/** A box with its faces apart (hard edges), UVs in meters. */
function box(cx, cy, cz, hx, hy, hz) {
  const g = new Geo();
  const faces = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  const h = [hx, hy, hz];
  const c = [cx, cy, cz];
  for (const [n, u, v] of faces) {
    const hn = Math.abs(n[0]) * hx + Math.abs(n[1]) * hy + Math.abs(n[2]) * hz;
    const hu = Math.abs(u[0]) * hx + Math.abs(u[1]) * hy + Math.abs(u[2]) * hz;
    const hv = Math.abs(v[0]) * hx + Math.abs(v[1]) * hy + Math.abs(v[2]) * hz;
    const base = g.p.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = [0, 1, 2].map((k) => c[k] + n[k] * hn + u[k] * hu * a + v[k] * hv * b);
      g.vertex(p, n, [a * hu + (Math.abs(n[1]) > 0.5 ? cx : cx + cz), b * hv + (Math.abs(n[1]) > 0.5 ? cz : cy)]);
    }
    g.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  void h;
  return g;
}

// ------------------------------------------------------------------ writing

function createMaterial(doc, m, cache) {
  if (cache.has(m.name)) return cache.get(m.name);
  const mat = doc.createMaterial(m.name).setBaseColorFactor([...(m.color ?? [1, 1, 1]), m.alpha ?? 1]).setRoughnessFactor(m.rough ?? 0.8).setMetallicFactor(m.metal ?? 0);
  if (m.map) mat.setBaseColorTexture(doc.createTexture(`${m.name}_map`).setImage(new Uint8Array(m.map)).setMimeType('image/png'));
  if (m.normal) mat.setNormalTexture(doc.createTexture(`${m.name}_normal`).setImage(new Uint8Array(m.normal)).setMimeType(m.normalType ?? 'image/png'));
  if (m.alpha) mat.setAlphaMode('BLEND');
  if (m.double) mat.setDoubleSided(true);
  cache.set(m.name, mat);
  return mat;
}

/**
 * parts: [{ name, geo, material, at?, rotation?, parent? }]. `at` makes the part a node at that point with its mesh inside it,
 * so that it turns about that point (the geometry is given in the model's space); `parent` hangs it from an earlier such part.
 * Materials: { name, color, rough, metal, map, normal }.
 * targets: { partName: { name: { position, normal } } } adds morph targets (Float32Arrays of deltas).
 */
async function writeModel(key, parts, { targets } = {}) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const cache = new Map();
  const byName = new Map();
  for (const part of parts) {
    if (!byName.has(part.name)) byName.set(part.name, []);
    byName.get(part.name).push(part);
  }
  let tris = 0;
  const pivots = new Map();
  for (const [name, group] of byName) {
    const at = group[0].at;
    const mesh = doc.createMesh(name);
    const origin = at ?? [0, 0, 0];
    for (const part of group) {
      const P = new Float32Array(part.geo.p.length);
      for (let v = 0; v < part.geo.p.length / 3; v++) for (let k = 0; k < 3; k++) P[v * 3 + k] = part.geo.p[v * 3 + k] - origin[k];
      const prim = doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buffer))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.geo.n)).setBuffer(buffer))
        .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(part.geo.uv)).setBuffer(buffer))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(part.geo.i)).setBuffer(buffer))
        .setMaterial(createMaterial(doc, part.material, cache));
      tris += part.geo.i.length / 3;
      const t = targets?.[name];
      if (t) {
        for (const [targetName, delta] of Object.entries(t)) {
          const target = doc.createPrimitiveTarget(targetName).setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(delta.position).setBuffer(buffer));
          target.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(delta.normal).setBuffer(buffer));
          prim.addTarget(target);
        }
        mesh.setWeights(Object.keys(t).map(() => 0));
        mesh.setExtras({ targetNames: Object.keys(t) });
      }
      mesh.addPrimitive(prim);
    }
    if (at) {
      const pivot = doc.createNode(name).setTranslation(at);
      if (group[0].rotation) pivot.setRotation(group[0].rotation);
      pivot.addChild(doc.createNode(`${name}_mesh`).setMesh(mesh));
      pivots.set(name, { pivot, at });
      const parent = group[0].parent ? pivots.get(group[0].parent) : null;
      if (parent) {
        pivot.setTranslation(at.map((v, k) => v - parent.at[k]));
        parent.pivot.addChild(pivot);
      } else scene.addChild(pivot);
    } else {
      scene.addChild(doc.createNode(name).setMesh(mesh));
    }
  }
  await new NodeIO().write(path.join(OUT, `${key}.glb`), doc);
  console.log(`${key.padEnd(20)} ${tris} tris`);
}

/** Geometry from a primitive of a glTF file, in its node's world space. */
function primitiveGeo(prim, matrix) {
  const pos = prim.getAttribute('POSITION');
  const nor = prim.getAttribute('NORMAL');
  const uvs = prim.getAttribute('TEXCOORD_0');
  const idx = prim.getIndices();
  const g = new Geo();
  const a = [0, 0, 0];
  const n = [0, 0, 1];
  const u = [0, 0];
  for (let v = 0; v < pos.getCount(); v++) {
    pos.getElement(v, a);
    if (nor) nor.getElement(v, n);
    if (uvs) uvs.getElement(v, u);
    g.vertex(transformPoint(matrix, a), normalized(transformDirection(matrix, n)), [u[0], u[1]]);
  }
  for (let t = 0; t < (idx ? idx.getCount() : pos.getCount()); t++) g.i.push(idx ? idx.getScalar(t) : t);
  return g;
}

const transformPoint = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const transformDirection = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
const normalized = (v) => {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
};

async function firstMeshes(file) {
  const doc = await io.read(file);
  const out = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) out.push({ node, prim, geo: primitiveGeo(prim, node.getWorldMatrix()), material: prim.getMaterial() });
  }
  return out;
}

const svgToPng = (svg, size) => sharp(Buffer.from(svg), { density: 96 }).resize(size, size).png().toBuffer();

// ------------------------------------------------------------------ cloth

/** Distance to rounded boxes, capsules and spheres, kept in a grid so that a fall of many steps stays cheap. */
function fieldOf(shapes, step = 0.02, margin = 0.12) {
  const distance = (x, y, z) => {
    let d = Infinity;
    for (const s of shapes) {
      let v;
      if (s.box) {
        const r = s.round ?? 0.01;
        const qx = Math.abs(x - s.box[0]) - s.half[0] + r;
        const qy = Math.abs(y - s.box[1]) - s.half[1] + r;
        const qz = Math.abs(z - s.box[2]) - s.half[2] + r;
        v = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
      } else {
        const [ax, ay, az] = s.a;
        const [bx, by, bz] = s.b ?? s.a;
        const bax = bx - ax;
        const bay = by - ay;
        const baz = bz - az;
        const paX = x - ax;
        const paY = y - ay;
        const paZ = z - az;
        const len = bax * bax + bay * bay + baz * baz;
        const h = len > 0 ? Math.min(1, Math.max(0, (paX * bax + paY * bay + paZ * baz) / len)) : 0;
        v = Math.hypot(paX - bax * h, paY - bay * h, paZ - baz * h) - s.r;
      }
      if (v < d) d = v;
    }
    return d;
  };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const s of shapes) {
    const pts = s.box ? [[s.box[0] - s.half[0], s.box[1] - s.half[1], s.box[2] - s.half[2]], [s.box[0] + s.half[0], s.box[1] + s.half[1], s.box[2] + s.half[2]]] : [s.a, s.b ?? s.a].flatMap((p) => [p.map((v) => v - s.r), p.map((v) => v + s.r)]);
    for (const p of pts) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k] - margin);
        max[k] = Math.max(max[k], p[k] + margin);
      }
    }
  }
  const n = [0, 1, 2].map((k) => Math.ceil((max[k] - min[k]) / step) + 2);
  const grid = new Float32Array(n[0] * n[1] * n[2]);
  for (let k = 0; k < n[2]; k++) {
    for (let j = 0; j < n[1]; j++) {
      for (let i = 0; i < n[0]; i++) grid[i + n[0] * (j + n[1] * k)] = distance(min[0] + i * step, min[1] + j * step, min[2] + k * step);
    }
  }
  const sample = (x, y, z) => {
    const fx = (x - min[0]) / step;
    const fy = (y - min[1]) / step;
    const fz = (z - min[2]) / step;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= n[0] - 1 || fy >= n[1] - 1 || fz >= n[2] - 1) return 1;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const k = Math.floor(fz);
    const u = fx - i;
    const v = fy - j;
    const w = fz - k;
    const at = (a, b, c) => grid[i + a + n[0] * (j + b + n[1] * (k + c))];
    const x0 = (at(0, 0, 0) * (1 - u) + at(1, 0, 0) * u) * (1 - v) + (at(0, 1, 0) * (1 - u) + at(1, 1, 0) * u) * v;
    const x1 = (at(0, 0, 1) * (1 - u) + at(1, 0, 1) * u) * (1 - v) + (at(0, 1, 1) * (1 - u) + at(1, 1, 1) * u) * v;
    return x0 * (1 - w) + x1 * w;
  };
  return sample;
}

/**
 * A square sheet dropped on `shapes`, position-based: gravity, stretch, shear and a soft resistance to bending.
 * `move` may move the shapes during the fall: then it is called with 0..1 and returns the field to use.
 */
function dropCloth({ nx, nz, h, center, y, shapes, steps = 520, iterations = 16, seed = 1, floor = 0.004, thickness = 0.012, start = null, field = null, pin = null, bend = 0.25, friction = 0.55, grip = 0.25, solid = true, solidField = null }) {
  const n = nx * nz;
  const P = new Float64Array(n * 3);
  const random = randomFrom(seed);
  const at = (i, k) => i + k * nx;
  if (start) P.set(start);
  else {
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        const v = at(i, k) * 3;
        P[v] = center[0] + (i - (nx - 1) / 2) * h + (random() - 0.5) * h * 0.1;
        P[v + 1] = y + (random() - 0.5) * 0.004 + Math.sin(i * 0.31 + seed) * 0.006 + Math.cos(k * 0.27 + seed * 2) * 0.006;
        P[v + 2] = center[2] + (k - (nz - 1) / 2) * h + (random() - 0.5) * h * 0.1;
      }
    }
  }
  const Q = P.slice();
  const safe = P.slice();
  const A = [];
  const B = [];
  const R = [];
  const S = [];
  const add = (a, b, rest, stiff) => {
    A.push(a);
    B.push(b);
    R.push(rest);
    S.push(stiff);
  };
  const diag = Math.SQRT2 * h;
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      if (i + 1 < nx) add(at(i, k), at(i + 1, k), h, 1);
      if (k + 1 < nz) add(at(i, k), at(i, k + 1), h, 1);
      if (i + 1 < nx && k + 1 < nz) {
        add(at(i, k), at(i + 1, k + 1), diag, 0.6);
        add(at(i + 1, k), at(i, k + 1), diag, 0.6);
      }
      if (i + 2 < nx) add(at(i, k), at(i + 2, k), 2 * h, bend);
      if (k + 2 < nz) add(at(i, k), at(i, k + 2), 2 * h, bend);
    }
  }
  const pinned = new Uint8Array(n);
  if (pin) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) if (pin(i, k)) pinned[at(i, k)] = 1;
  const dt2 = (1 / 60) * (1 / 60);
  // a weak pull: the shape cloth comes to rest in does not depend on it, and a strong one only stretches the linen like rubber
  const gravity = 1.1 * dt2;
  const sampleFor = field ? null : fieldOf(shapes);
  for (let step = 0; step < steps; step++) {
    const sample = field ? field(step / (steps - 1)) : sampleFor;
    const damp = step < steps * 0.7 ? 0.985 : 0.94;
    for (let v = 0; v < n; v++) {
      if (pinned[v]) continue;
      const o = v * 3;
      const x = P[o];
      const yy = P[o + 1];
      const z = P[o + 2];
      // never more than a little in one step: faster than that it would pass through a thin seat
      const speed = (l, q) => Math.max(-MAX_STEP, Math.min(MAX_STEP, (l - q) * damp));
      P[o] += speed(x, Q[o]);
      P[o + 1] += speed(yy, Q[o + 1]) - gravity;
      P[o + 2] += speed(z, Q[o + 2]);
      Q[o] = x;
      Q[o + 1] = yy;
      Q[o + 2] = z;
    }
    for (let it = 0; it < iterations; it++) {
      for (let c = 0; c < A.length; c++) {
        const a = A[c] * 3;
        const b = B[c] * 3;
        const dx = P[b] - P[a];
        const dy = P[b + 1] - P[a + 1];
        const dz = P[b + 2] - P[a + 2];
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
        const stiff = S[c];
        // bending and shear only resist being squeezed or pulled softly; stretch is hard
        const e = ((l - R[c]) / l) * 0.5 * stiff;
        const wa = pinned[A[c]] ? 0 : 1;
        const wb = pinned[B[c]] ? 0 : 1;
        P[a] += dx * e * wa * (wb ? 1 : 2);
        P[a + 1] += dy * e * wa * (wb ? 1 : 2);
        P[a + 2] += dz * e * wa * (wb ? 1 : 2);
        P[b] -= dx * e * wb * (wa ? 1 : 2);
        P[b + 1] -= dy * e * wb * (wa ? 1 : 2);
        P[b + 2] -= dz * e * wb * (wa ? 1 : 2);
      }
      if (it % 3 === 2 || it === iterations - 1) {
        for (let v = 0; v < n; v++) {
          if (pinned[v]) continue;
          const o = v * 3;
          const d = sample(P[o], P[o + 1], P[o + 2]);
          if (d < thickness) {
            const e = 0.02;
            let gx = sample(P[o] + e, P[o + 1], P[o + 2]) - sample(P[o] - e, P[o + 1], P[o + 2]);
            let gy = sample(P[o], P[o + 1] + e, P[o + 2]) - sample(P[o], P[o + 1] - e, P[o + 2]);
            let gz = sample(P[o], P[o + 1], P[o + 2] + e) - sample(P[o], P[o + 1], P[o + 2] - e);
            const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
            gx /= gl;
            gy /= gl;
            gz /= gl;
            const push = thickness - d;
            P[o] += gx * push;
            P[o + 1] += gy * push;
            P[o + 2] += gz * push;
            Q[o] += (P[o] - Q[o]) * friction;
            Q[o + 1] += (P[o + 1] - Q[o + 1]) * friction;
            Q[o + 2] += (P[o + 2] - Q[o + 2]) * friction;
          }
          if (P[o + 1] < floor) {
            P[o + 1] = floor + (v % 7) * 0.0006;
            Q[o] += (P[o] - Q[o]) * 0.8;
            Q[o + 2] += (P[o + 2] - Q[o + 2]) * 0.8;
          }
        }
      }
    }
    // what lies on something stays where it lies: linen on a chair does not slide off under its own weight.
    // And nothing is ever let inside: a point pulled through a thin seat goes back to where it last was, on its own side.
    for (let v = 0; v < n; v++) {
      if (pinned[v]) continue;
      const o = v * 3;
      const d = sample(P[o], P[o + 1], P[o + 2]);
      if (solid && (solidField ? solidField(P[o], P[o + 1], P[o + 2]) : d) < 0.002) {
        for (let k = 0; k < 3; k++) {
          P[o + k] = safe[o + k];
          Q[o + k] = safe[o + k];
        }
        continue;
      }
      if (d < thickness * 1.5) {
        // lying on top of something it holds fast; against a side it may still slip a little
        const up = sample(P[o], P[o + 1] + 0.02, P[o + 2]) - d > 0.008;
        const hold = up ? 0 : grip;
        P[o] = safe[o] + (P[o] - safe[o]) * hold;
        P[o + 2] = safe[o + 2] + (P[o + 2] - safe[o + 2]) * hold;
      }
      safe[o] = P[o];
      safe[o + 1] = P[o + 1];
      safe[o + 2] = P[o + 2];
    }
  }
  return P;
}

function clothGeo(P, nx, nz, h) {
  const g = new Geo();
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const v = (i + k * nx) * 3;
      g.vertex([P[v], P[v + 1], P[v + 2]], [0, 1, 0], [i * h, k * h]);
    }
  }
  for (let k = 0; k < nz - 1; k++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = i + k * nx;
      g.i.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
    }
  }
  return g.smooth();
}

const MAX_STEP = 0.009;

const CLOTH = { name: 'sheet', color: [0.62, 0.6, 0.55], rough: 0.92, double: true };

const CLOTH_OBJECTS = {
  sheet_chair: {
    size: [1.75, 1.75],
    center: [0, 0.03],
    shapes: [
      { box: [0, 0.45, 0], half: [0.23, 0.045, 0.23], round: 0.02 },
      { box: [0, 0.74, -0.2], half: [0.22, 0.3, 0.035], round: 0.03 },
      ...[[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].map(([x, z]) => ({ a: [x, 0, z], b: [x, 0.45, z], r: 0.022 })),
    ],
  },
  sheet_armchair: {
    size: [2.3, 2.3],
    center: [0, 0.04],
    shapes: [
      { box: [0, 0.25, 0], half: [0.42, 0.22, 0.42], round: 0.05 },
      { box: [0, 0.65, -0.34], half: [0.42, 0.44, 0.09], round: 0.06 },
      { box: [-0.4, 0.45, 0.02], half: [0.09, 0.2, 0.4], round: 0.06 },
      { box: [0.4, 0.45, 0.02], half: [0.09, 0.2, 0.4], round: 0.06 },
    ],
  },
  sheet_sofa: {
    size: [3.3, 2.5],
    center: [0, 0.03],
    shapes: [
      { box: [0, 0.24, 0], half: [0.95, 0.2, 0.42], round: 0.05 },
      { box: [0, 0.62, -0.34], half: [0.95, 0.38, 0.09], round: 0.06 },
      { box: [-0.92, 0.42, 0.02], half: [0.09, 0.2, 0.4], round: 0.06 },
      { box: [0.92, 0.42, 0.02], half: [0.09, 0.2, 0.4], round: 0.06 },
    ],
  },
  sheet_table: {
    size: [2.9, 2.2],
    center: [0, 0],
    shapes: [
      { box: [0, 0.725, 0], half: [1.0, 0.045, 0.6], round: 0.02 },
      ...[[-0.92, -0.52], [0.92, -0.52], [-0.92, 0.52], [0.92, 0.52]].map(([x, z]) => ({ a: [x, 0, z], b: [x, 0.72, z], r: 0.035 })),
    ],
  },
  sheet_lamp: {
    size: [3.1, 3.1],
    center: [0.02, 0.01],
    shapes: [
      { a: [0, 0, 0], b: [0, 1.42, 0], r: 0.035 },
      { box: [0, 0.03, 0], half: [0.14, 0.03, 0.14], round: 0.02 },
      { box: [0, 1.5, 0], half: [0.2, 0.14, 0.2], round: 0.08 },
    ],
  },
  sheet_figure: {
    size: [2.5, 2.5],
    center: [0.01, 0.01],
    shapes: [
      { a: [0, 1.63, 0], r: 0.105 },
      { a: [0, 1.5, 0], b: [0, 1.4, 0], r: 0.06 },
      { a: [-0.2, 1.42, 0], b: [0.2, 1.42, 0], r: 0.07 },
      { a: [0, 1.38, 0], b: [0, 0.85, 0], r: 0.16 },
      { a: [-0.25, 1.4, 0], b: [-0.27, 0.78, 0.02], r: 0.05 },
      { a: [0.25, 1.4, 0], b: [0.27, 0.78, 0.02], r: 0.05 },
      { a: [-0.1, 0.85, 0], b: [-0.1, 0.03, 0], r: 0.075 },
      { a: [0.1, 0.85, 0], b: [0.1, 0.03, 0], r: 0.075 },
    ],
  },
  shroud_body: {
    size: [1.25, 2.35],
    center: [0, 0],
    drop: 0.7,
    shapes: [
      { box: [0, 0.2, 0], half: [0.44, 0.09, 1.0] },
      { a: [0, 0.39, -0.8], r: 0.105 },
      { a: [-0.19, 0.36, -0.55], b: [0.19, 0.36, -0.55], r: 0.07 },
      { a: [0, 0.37, -0.5], b: [0, 0.37, 0.02], r: 0.14 },
      { a: [-0.09, 0.35, 0.05], b: [-0.08, 0.33, 0.85], r: 0.075 },
      { a: [0.09, 0.35, 0.05], b: [0.08, 0.33, 0.85], r: 0.075 },
    ],
  },
};

async function writeCloth(key) {
  const o = CLOTH_OBJECTS[key];
  const h = 0.026;
  const nx = Math.round(o.size[0] / h) + 1;
  const nz = Math.round(o.size[1] / h) + 1;
  let top = 0;
  for (const s of o.shapes) top = Math.max(top, s.box ? s.box[1] + s.half[1] : (s.b ?? s.a)[1] + s.r, s.box ? 0 : s.a[1] + s.r);
  const P = dropCloth({ nx, nz, h, center: [o.center[0], 0, o.center[1]], y: top + 0.06, shapes: o.shapes, seed: key.length * 7 + 3, steps: 520 });
  await writeModel(key, [{ name: key, geo: clothGeo(P, nx, nz, h), material: CLOTH }]);
}

// ------------------------------------------------------------------ the iron bed whose sheet sits up

const BED = { width: 0.86, length: 1.95, mattressTop: 0.58 };

function ironBedFrame() {
  const g = new Geo();
  const { width: w, length: l } = BED;
  const r = 0.014;
  const rail = (x0, y0, z0, x1, y1, z1, radius = r) => g.add(tube([[x0, y0, z0], [x1, y1, z1]], radius, radius, 6));
  for (const [z, top, bars] of [[-l / 2, 1.08, 6], [l / 2, 0.86, 5]]) {
    for (const x of [-w / 2, w / 2]) rail(x, 0, z, x, top - 0.03, z, 0.019);
    // the rounded top bar of an old hospital bed
    const arc = [];
    for (let a = 0; a <= 8; a++) {
      const t = a / 8;
      arc.push([-w / 2 + w * t, top - 0.03 + Math.sin(t * Math.PI) * 0.06, z]);
    }
    g.add(tube(arc, 0.017, 0.017, 6));
    rail(-w / 2, 0.42, z, w / 2, 0.42, z);
    for (let b = 1; b < bars; b++) {
      const x = -w / 2 + (b / bars) * w;
      rail(x, 0.42, z, x, top - 0.02 + Math.sin((b / bars) * Math.PI) * 0.06, z, 0.008);
    }
  }
  for (const x of [-w / 2, w / 2]) rail(x, 0.46, -l / 2, x, 0.46, l / 2);
  return g;
}

/** The flat sheet, and what it becomes when someone under it sits up. */
function bedSheet() {
  const h = 0.042;
  const nx = 31;
  const nz = 51;
  const { width: w, length: l, mattressTop: top } = BED;
  const bed = [{ box: [0, top - 0.09, 0], half: [w / 2 - 0.01, 0.09, l / 2 - 0.01], round: 0.03 }];
  const pillow = { box: [0, top + 0.04, -l / 2 + 0.25], half: [0.3, 0.05, 0.17], round: 0.05 };
  const center = [0, 0, 0.04];
  const flat = dropCloth({ nx, nz, h, center, y: top + 0.14, shapes: [...bed, pillow], steps: 420, iterations: 16, seed: 5, thickness: 0.008, friction: 0.8 });
  const hip = [0, top + 0.12, 0.02];
  const shapesAt = (t) => {
    const e = smoothstep(0, 1, t);
    const size = 0.3 + 0.7 * e;
    // it starts inside the mattress, under the sheet, and comes up through where the sheet lies
    const hipNow = [0, top - 0.05 + 0.15 * e, hip[2]];
    const neck = [0, top - 0.06 + 0.66 * e, -0.3 - 0.02 * e];
    const head = [0, neck[1] - 0.02 + 0.2 * e, neck[2] - 0.12 * (1 - e) + 0.03 * e];
    return [
      ...bed,
      pillow,
      { a: hipNow, b: neck, r: 0.14 * size },
      { a: [-0.19, neck[1] - 0.03, neck[2]], b: [0.19, neck[1] - 0.03, neck[2]], r: 0.075 * size },
      { a: head, r: 0.105 * size },
    ];
  };
  const fields = [];
  for (let s = 0; s <= 16; s++) fields.push(fieldOf(shapesAt(s / 16)));
  const still = fieldOf([...bed, pillow]);
  const sat = dropCloth({
    nx,
    nz,
    h,
    center,
    y: 0,
    shapes: bed,
    steps: 520,
    iterations: 18,
    seed: 5,
    thickness: 0.01,
    friction: 0.2,
    grip: 0.9,
    start: flat,
    solidField: still,
    field: (t) => fields[Math.min(16, Math.round(Math.min(1, t / 0.8) * 16))],
  });
  return { nx, nz, h, flat, sat };
}

async function writeBed() {
  const white = { name: 'iron_white', color: [0.46, 0.46, 0.43], rough: 0.55, metal: 0.2 };
  const cloth = { name: 'bed_sheet', color: [0.66, 0.65, 0.6], rough: 0.92, double: true };
  const { width: w, length: l, mattressTop: top } = BED;
  const { nx, nz, h, flat, sat } = bedSheet();
  const geo = clothGeo(flat, nx, nz, h);
  const satGeo = clothGeo(sat, nx, nz, h);
  const position = new Float32Array(flat.length);
  const normal = new Float32Array(flat.length);
  for (let v = 0; v < flat.length; v++) {
    position[v] = sat[v] - flat[v];
    normal[v] = satGeo.n[v] - geo.n[v];
  }
  await writeModel(
    'bed_iron',
    [
      { name: 'frame', geo: ironBedFrame(), material: white },
      { name: 'frame', geo: box(0, top - 0.09, 0, w / 2 - 0.015, 0.075, l / 2 - 0.015), material: { name: 'mattress', color: [0.3, 0.29, 0.26], rough: 0.95 } },
      { name: 'sheet', geo, material: cloth },
    ],
    { targets: { sheet: { sit: { position, normal } } } },
  );
}

// ------------------------------------------------------------------ the eye

const EYE_RADIUS = 0.012;
/** Turn of the lids about X when the eye is open (rad); 0 closes them. */
const EYE_OPEN = { upper: -0.95, lower: 0.7 };

function eyeTexture() {
  const random = randomFrom(11);
  const size = 1024;
  const c = size / 2;
  const iris = size * 0.2;
  const pupil = size * 0.075;
  let fibres = '';
  for (let i = 0; i < 420; i++) {
    const a = random() * Math.PI * 2;
    const r0 = pupil * (0.9 + random() * 0.3);
    const r1 = iris * (0.65 + random() * 0.36);
    const shade = 60 + Math.round(random() * 110);
    fibres += `<line x1="${c + Math.cos(a) * r0}" y1="${c + Math.sin(a) * r0}" x2="${c + Math.cos(a + (random() - 0.5) * 0.12) * r1}" y2="${c + Math.sin(a + (random() - 0.5) * 0.12) * r1}" stroke="rgb(${shade + 10},${shade + 26},${shade + 20})" stroke-width="${1 + random() * 2.4}" opacity="${0.35 + random() * 0.5}"/>`;
  }
  let veins = '';
  for (let i = 0; i < 70; i++) {
    const a = random() * Math.PI * 2;
    let r = size * (0.42 + random() * 0.1);
    let x = c + Math.cos(a) * r;
    let y = c + Math.sin(a) * r;
    let d = `M${x} ${y}`;
    let dir = a + Math.PI + (random() - 0.5) * 0.8;
    const steps = 4 + Math.floor(random() * 5);
    for (let s = 0; s < steps; s++) {
      dir += (random() - 0.5) * 0.9;
      x += Math.cos(dir) * size * 0.022;
      y += Math.sin(dir) * size * 0.022;
      r = Math.hypot(x - c, y - c);
      if (r < iris * 1.08) break;
      d += ` L${x} ${y}`;
    }
    veins += `<path d="${d}" fill="none" stroke="rgb(${120 + Math.round(random() * 60)},${20 + Math.round(random() * 30)},${24})" stroke-width="${0.8 + random() * 2.2}" opacity="${0.35 + random() * 0.5}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <radialGradient id="s" cx="50%" cy="50%" r="50%"><stop offset="0.3" stop-color="#e6e0d0"/><stop offset="0.75" stop-color="#d8cdb4"/><stop offset="1" stop-color="#a88f78"/></radialGradient>
      <radialGradient id="i" cx="50%" cy="50%" r="50%"><stop offset="0.3" stop-color="#6f7a68"/><stop offset="0.72" stop-color="#4a5a56"/><stop offset="0.93" stop-color="#232c2c"/><stop offset="1" stop-color="#0c0e0e"/></radialGradient>
      <radialGradient id="l" cx="50%" cy="50%" r="50%"><stop offset="0.86" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#1a0d08" stop-opacity="0.8"/></radialGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#s)"/>
    ${veins}
    <circle cx="${c}" cy="${c}" r="${iris}" fill="url(#i)"/>
    ${fibres}
    <circle cx="${c}" cy="${c}" r="${iris}" fill="url(#l)"/>
    <circle cx="${c}" cy="${c}" r="${pupil}" fill="#030303"/>
  </svg>`;
  return svgToPng(svg, size);
}

/** The ball: a sphere with the cornea's bulge, looking along +Z, its picture projected from the front. */
function eyeBall() {
  const g = new Geo();
  const rings = 22;
  const seg = 28;
  const R = EYE_RADIUS;
  for (let j = 0; j <= rings; j++) {
    const t = (j / rings) * Math.PI;
    const bulge = 1 + 0.1 * smoothstep(0.62, 0.05, t);
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const x = Math.sin(t) * Math.cos(a);
      const y = Math.sin(t) * Math.sin(a);
      const z = Math.cos(t);
      g.vertex([x * R * bulge, y * R * bulge, z * R * bulge], [x, y, z], [0.5 + x * 0.5, 0.5 - y * 0.5]);
    }
  }
  const row = seg + 1;
  for (let j = 0; j < rings; j++) {
    for (let s = 0; s < seg; s++) {
      const a = j * row + s;
      g.i.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  return g.smooth();
}

/** An eyelid: a shell over the ball from its middle line up and back. Closed at rotation 0; open is a turn about X. */
function eyeLid(sign) {
  const g = new Geo();
  const R = EYE_RADIUS * 1.13;
  const rows = 8;
  const seg = 18;
  for (let j = 0; j <= rows; j++) {
    const lat = (j / rows) * Math.PI * 0.62;
    for (let s = 0; s <= seg; s++) {
      const lon = ((s / seg) * 2 - 1) * Math.PI * 0.62;
      const edge = 1 + 0.06 * (1 - j / rows) * Math.cos(lon * 1.5);
      const x = Math.sin(lon) * Math.cos(lat);
      const y = Math.sin(lat) * sign;
      const z = Math.cos(lon) * Math.cos(lat);
      g.vertex([x * R * edge, y * R * edge, z * R * edge], [x, y, z], [x * R, y * R]);
    }
  }
  const row = seg + 1;
  for (let j = 0; j < rows; j++) {
    for (let s = 0; s < seg; s++) {
      const a = j * row + s;
      if (sign > 0) g.i.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
      else g.i.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  return g.smooth();
}

/** The dark lump of bark an eye sits in: a thick ring. */
function eyeKnot() {
  const random = randomFrom(4);
  const g = new Geo();
  const seg = 18;
  const rows = 4;
  const R = EYE_RADIUS;
  const bumps = Array.from({ length: seg }, () => 0.8 + random() * 0.5);
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const b = bumps[s % seg];
      const r = R * (1.0 + t * 1.5 * b);
      const z = R * (0.62 * Math.sin(t * Math.PI) ** 0.7 * b + 0.3 - t * 0.9);
      g.vertex([Math.cos(a) * r, Math.sin(a) * r * 0.85, z], [0, 0, 1], [Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  const row = seg + 1;
  for (let j = 0; j < rows; j++) {
    for (let s = 0; s < seg; s++) {
      const a = j * row + s;
      g.i.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  return g.smooth();
}

async function writeEye() {
  const wet = { name: 'eye_wet', rough: 0.13, map: await eyeTexture() };
  const lid = { name: 'eye_lid', color: [0.3, 0.27, 0.22], rough: 0.8, double: true };
  const knot = { name: 'eye_knot', color: [0.015, 0.012, 0.01], rough: 0.85 };
  const c = [0, 0, 0];
  await writeModel('eyeball', [
    { name: 'ball', geo: eyeBall(), material: wet, at: c },
    { name: 'lid_upper', geo: eyeLid(1), material: lid, at: c, rotation: [Math.sin(EYE_OPEN.upper / 2), 0, 0, Math.cos(EYE_OPEN.upper / 2)] },
    { name: 'lid_lower', geo: eyeLid(-1), material: lid, at: c, rotation: [Math.sin(EYE_OPEN.lower / 2), 0, 0, Math.cos(EYE_OPEN.lower / 2)] },
    { name: 'knot', geo: eyeKnot(), material: knot, at: c },
  ]);
}

// ------------------------------------------------------------------ the party

async function writeParty() {
  const stripes = await svgToPng(
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#b9a56a"/>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M${i * 64 - 40} 256 L${i * 64 + 24} 256 L${i * 64 + 150} 0 L${i * 64 + 86} 0 Z" fill="${i % 2 ? '#7c2a24' : '#27475a'}"/>`).join('')}</svg>`,
    256,
  );
  const hat = lathe([[0.075, 0], [0.056, 0.05], [0.036, 0.1], [0.017, 0.15], [0.002, 0.2]], 16);
  const pom = lathe([[0, 0.195], [0.012, 0.2], [0.017, 0.21], [0.012, 0.22], [0, 0.225]], 8);
  await writeModel('party_hat', [
    { name: 'party_hat', geo: hat, material: { name: 'hat_paper', map: stripes, rough: 0.85, double: true } },
    { name: 'party_hat', geo: pom, material: { name: 'hat_pom', color: [0.5, 0.42, 0.25], rough: 0.95 } },
  ]);

  // a balloon that has lost a little of its air, with its string
  const profile = [];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    const a = t * Math.PI;
    const r = Math.sin(a) ** 0.85 * 0.135 * (1 - 0.32 * (1 - t) * (1 - t));
    profile.push([Math.max(r, 0.002), 0.34 * (1 - Math.cos(a)) * 0.5 + 0.02]);
  }
  profile.unshift([0.008, 0.0], [0.012, 0.012], [0.004, 0.02]);
  const string = tube(Array.from({ length: 9 }, (_, i) => [Math.sin(i * 1.3) * 0.012, -i * 0.07, Math.cos(i * 0.9) * 0.012]), 0.0012, 0.0012, 3, false);
  await writeModel('balloon', [
    { name: 'balloon', geo: lathe(profile, 18), material: { name: 'balloon_rubber', color: [0.28, 0.03, 0.03], rough: 0.25 } },
    { name: 'balloon', geo: string, material: { name: 'balloon_string', color: [0.3, 0.3, 0.28], rough: 0.9 } },
  ]);

  const stripe = await svgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#d8ccb0"/>${[0, 1, 2, 3].map((i) => `<path d="M0 ${i * 16 + 16} L64 ${i * 16} L64 ${i * 16 + 8} L0 ${i * 16 + 24} Z" fill="#8c3a34"/>`).join('')}</svg>`, 64);
  const wick = tube([[0, 0.062, 0], [0.0006, 0.072, 0]], 0.0006, 0.0005, 3);
  const flame = lathe([[0, 0.07], [0.0032, 0.074], [0.0038, 0.079], [0.0024, 0.087], [0, 0.098]], 6);
  await writeModel('candle_party', [
    { name: 'candle', geo: lathe([[0, 0], [0.0038, 0], [0.0036, 0.062], [0, 0.0625]], 7), material: { name: 'candle_wax', map: stripe, rough: 0.55 } },
    { name: 'candle', geo: wick, material: { name: 'candle_wick', color: [0.01, 0.01, 0.01], rough: 0.9 } },
    { name: 'flame', geo: flame, material: { name: 'candle_flame', color: [1, 0.72, 0.34], rough: 1 } },
  ]);
}

// ------------------------------------------------------------------ the music box

async function writeMusicBox() {
  const wood = { name: 'box_wood', color: [0.09, 0.045, 0.022], rough: 0.42 };
  const brass = { name: 'box_brass', color: [0.62, 0.44, 0.18], rough: 0.32, metal: 1 };
  const w = 0.075;
  const d = 0.055;
  const h = 0.05;
  const t = 0.005;
  const shell = new Geo();
  shell.add(box(0, t / 2, 0, w, t / 2, d));
  shell.add(box(-w + t / 2, h / 2, 0, t / 2, h / 2, d));
  shell.add(box(w - t / 2, h / 2, 0, t / 2, h / 2, d));
  shell.add(box(0, h / 2, -d + t / 2, w - t, h / 2, t / 2));
  shell.add(box(0, h / 2, d - t / 2, w - t, h / 2, t / 2));
  const comb = new Geo();
  comb.add(box(-0.01, 0.018, -0.012, 0.03, 0.012, 0.012));
  for (let i = 0; i < 18; i++) comb.add(box(-0.038 + i * 0.0034, 0.024, 0.012, 0.00115, 0.0009, 0.016 + i * 0.0006));
  const cylinder = tube([[-0.04, 0.026, 0.038], [0.022, 0.026, 0.038]], 0.011, 0.011, 12);
  const crank = new Geo();
  crank.add(tube([[w, 0.026, 0.02], [w + 0.012, 0.026, 0.02], [w + 0.012, 0.05, 0.02], [w + 0.022, 0.05, 0.02]], 0.0018, 0.0018, 5));
  crank.add(lathe([[0, 0.0], [0.004, 0.002], [0.004, 0.012], [0, 0.014]], 7), (p) => [p[1] + w + 0.022, p[0] * 0 + 0.05 + p[2] * 0, p[2] * 0 + 0.02]);
  const lid = box(0, h + 0.004, 0, w + 0.002, 0.004, d + 0.002);
  await writeModel('music_box', [
    { name: 'box', geo: shell, material: wood },
    { name: 'lid', geo: lid, material: wood, at: [0, h, -d] },
    { name: 'comb', geo: comb, material: brass },
    { name: 'comb', geo: cylinder, material: brass },
    { name: 'crank', geo: crank, material: brass, at: [w, 0.026, 0.02] },
  ]);
}

// ------------------------------------------------------------------ the doll

const DOLL = { height: 0.46, headBottom: 0.3 };

/** What a porcelain face is painted with, and patches of plain color for the rest of the body in the same image. */
async function dollFace() {
  const random = randomFrom(21);
  const size = 1024;
  let cracks = '';
  for (let i = 0; i < 7; i++) {
    let x = 300 + random() * 420;
    let y = 120 + random() * 500;
    let d = `M${x} ${y}`;
    let a = random() * Math.PI * 2;
    for (let s = 0; s < 6; s++) {
      a += (random() - 0.5) * 1.1;
      x += Math.cos(a) * 28;
      y += Math.sin(a) * 28;
      d += ` L${x} ${y}`;
    }
    cracks += `<path d="${d}" fill="none" stroke="#3a2c20" stroke-width="${1 + random() * 1.3}" opacity="0.55"/>`;
  }
  const eye = (cx) => `
    <ellipse cx="${cx}" cy="${FACE.eyeY}" rx="84" ry="52" fill="#d9d4c4"/>
    <circle cx="${cx}" cy="${FACE.eyeY}" r="50" fill="#1e282e"/>
    <circle cx="${cx}" cy="${FACE.eyeY}" r="24" fill="#040404"/>
    <path d="M${cx - 92} ${FACE.eyeY + 4} Q${cx} ${FACE.eyeY - 76} ${cx + 92} ${FACE.eyeY + 4}" fill="none" stroke="#120a06" stroke-width="12"/>
    <path d="M${cx - 80} ${FACE.eyeY + 12} Q${cx} ${FACE.eyeY + 56} ${cx + 80} ${FACE.eyeY + 12}" fill="none" stroke="#3a2418" stroke-width="5"/>
    ${Array.from({ length: 11 }, (_, i) => `<line x1="${cx - 76 + i * 15.2}" y1="${FACE.eyeY - 36 - Math.sin((i / 10) * Math.PI) * 14}" x2="${cx - 88 + i * 17.6}" y2="${FACE.eyeY - 70 - Math.sin((i / 10) * Math.PI) * 22}" stroke="#0e0804" stroke-width="4"/>`).join('')}
    <path d="M${cx - 86} ${FACE.eyeY - 104} Q${cx} ${FACE.eyeY - 138} ${cx + 86} ${FACE.eyeY - 104}" fill="none" stroke="#3a2212" stroke-width="7" opacity="0.85"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs><radialGradient id="c" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#c8605a" stop-opacity="0.6"/><stop offset="1" stop-color="#c8605a" stop-opacity="0"/></radialGradient></defs>
    <rect width="${size}" height="${size}" fill="#dcd2bc"/>
    <circle cx="${FACE.left}" cy="${FACE.cheekY}" r="105" fill="url(#c)"/>
    <circle cx="${FACE.right}" cy="${FACE.cheekY}" r="105" fill="url(#c)"/>
    ${eye(FACE.left)}${eye(FACE.right)}
    <path d="M${512 - 74} ${FACE.mouthY} Q${512 - 34} ${FACE.mouthY - 34} 512 ${FACE.mouthY - 14} Q${512 + 34} ${FACE.mouthY - 34} ${512 + 74} ${FACE.mouthY} Q512 ${FACE.mouthY + 38} ${512 - 74} ${FACE.mouthY} Z" fill="#8a1c1c"/>
    <path d="M${512 - 60} ${FACE.mouthY + 1} Q512 ${FACE.mouthY + 10} ${512 + 60} ${FACE.mouthY + 1}" stroke="#2a0606" stroke-width="5" fill="none"/>
    ${cracks}
    <rect x="0" y="880" width="144" height="144" fill="#dcd2bc"/>
    <rect x="144" y="880" width="144" height="144" fill="#b8b2a4"/>
    <rect x="288" y="880" width="144" height="144" fill="#070606"/>
  </svg>`;
  return svgToPng(svg, size);
}

/** Where things are in that image (pixels), set by eye against the head's own shape. */
const FACE = { eyeY: 502, left: 334, right: 690, cheekY: 620, mouthY: 728 };
const PATCH = { skin: [0.07, 0.93], hair: [0.21, 0.93], black: [0.35, 0.93] };

const patched = (geo, uv) => {
  for (let v = 0; v < geo.uv.length; v += 2) {
    geo.uv[v] = uv[0];
    geo.uv[v + 1] = uv[1];
  }
  return geo;
};

async function dollParts(detail) {
  // the head of a real person, at the size of a fist; the head was scanned with its neck
  const headFile = await firstMeshes(path.join(OUT, 'mri_head.glb'));
  const head = headFile[0].geo;
  const scale = 0.135;
  const headGeo = new Geo();
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let v = 0; v < head.p.length / 3; v++) {
    minY = Math.min(minY, head.p[v * 3 + 1]);
    maxY = Math.max(maxY, head.p[v * 3 + 1]);
    minX = Math.min(minX, head.p[v * 3]);
    maxX = Math.max(maxX, head.p[v * 3]);
    maxZ = Math.max(maxZ, head.p[v * 3 + 2]);
  }
  void maxZ;
  for (let v = 0; v < head.p.length / 3; v++) {
    const x = head.p[v * 3];
    const y = head.p[v * 3 + 1];
    const z = head.p[v * 3 + 2];
    headGeo.vertex([x * scale, (y - minY) * scale + DOLL.headBottom - 0.012, z * scale], [head.n[v * 3], head.n[v * 3 + 1], head.n[v * 3 + 2]], [(x - minX) / (maxX - minX), 1 - (y - minY) / (maxY - minY)]);
  }
  for (const i of head.i) headGeo.i.push(i);
  headGeo.smooth();
  return { fineHead: headGeo, crushedHead: headGeo.crush(detail.head, 0.3).smooth() };
}

/** Hair: the skull's upper and back part, a little outward: a molded wig, cut from the fine head so that its edge is clean. */
function dollHair(headGeo, tris) {
  let top = 0;
  for (let v = 1; v < headGeo.p.length; v += 3) top = Math.max(top, headGeo.p[v]);
  const keep = (x, y, z) => {
    const rel = (y - DOLL.headBottom) / (top - DOLL.headBottom);
    const line = 0.78 - 0.56 * smoothstep(0.03, -0.012, z);
    return rel > line - 0.05 * smoothstep(0.02, 0.05, Math.abs(x));
  };
  const g = new Geo();
  const map = new Map();
  for (let t = 0; t < headGeo.i.length; t += 3) {
    const tri = [headGeo.i[t], headGeo.i[t + 1], headGeo.i[t + 2]];
    if (!tri.every((v) => keep(headGeo.p[v * 3], headGeo.p[v * 3 + 1], headGeo.p[v * 3 + 2]))) continue;
    for (const v of tri) {
      if (!map.has(v)) {
        const off = 0.004 + 0.0012 * Math.sin(headGeo.p[v * 3] * 310) * Math.sin(headGeo.p[v * 3 + 2] * 270);
        map.set(v, g.vertex([0, 1, 2].map((k) => headGeo.p[v * 3 + k] + headGeo.n[v * 3 + k] * off), [headGeo.n[v * 3], headGeo.n[v * 3 + 1], headGeo.n[v * 3 + 2]], PATCH.hair));
      }
      g.i.push(map.get(v));
    }
  }
  return g.smooth().crush(tris, 0.3).smooth();
}

async function writeDoll(key, detail) {
  const { fineHead, crushedHead } = await dollParts(detail);
  const hair = dollHair(fineHead, detail.hair);

  // the dress of a real woman, at the size of a doll, its neck stand cut away by the head
  const dressFile = await firstMeshes(path.join(OUT, 'empty_dress.glb'));
  const dress = dressFile[0].geo;
  let maxY = -Infinity;
  for (let v = 1; v < dress.p.length; v += 3) maxY = Math.max(maxY, dress.p[v]);
  const s = (DOLL.headBottom + 0.012) / maxY;
  const dressGeo = new Geo();
  dressGeo.add(dress, (p) => [p[0] * s, p[1] * s, p[2] * s]);
  const crushedDress = dressGeo.crush(detail.dress, 0.3);

  const skin = new Geo();
  for (const side of [-1, 1]) {
    // arm, hand, leg, shoe
    skin.add(patched(tube([[side * 0.042, 0.262, 0], [side * 0.068, 0.2, 0.004], [side * 0.076, 0.135, 0.012]], 0.009, 0.007, detail.sides), PATCH.skin));
    skin.add(patched(lathe([[0, -0.02], [0.006, -0.018], [0.008, -0.008], [0.007, 0.002], [0, 0.004]], detail.sides).flat(), PATCH.skin), (p) => [p[0] + side * 0.077, p[1] + 0.128, p[2] * 0.7 + 0.014]);
    skin.add(patched(tube([[side * 0.024, 0.17, 0], [side * 0.026, 0.03, 0.002]], 0.0105, 0.008, detail.sides), PATCH.skin));
  }
  const shoes = new Geo();
  for (const side of [-1, 1]) {
    shoes.add(patched(lathe([[0, 0], [0.013, 0], [0.015, 0.008], [0.012, 0.022], [0.009, 0.03], [0, 0.03]], detail.sides), PATCH.black), (p) => [p[0] + side * 0.027, p[1], p[2] * 1.5 + 0.008]);
  }
  const face = { name: 'doll_porcelain', map: await dollFace(), rough: 0.22 };
  const cloth = dressFile[0].material;
  const dressMap = cloth?.getBaseColorTexture()?.getImage();
  const dressMaterial = { name: 'doll_dress', map: dressMap ? Buffer.from(await sharp(Buffer.from(dressMap)).modulate({ saturation: 0.55, brightness: 0.8 }).png().toBuffer()) : null, rough: 0.9, color: dressMap ? [1, 1, 1] : [0.3, 0.28, 0.25], double: true };
  const neck = [0, DOLL.headBottom + 0.004, 0];
  const parts = [
    { name: 'body', geo: crushedDress, material: dressMaterial },
    { name: 'body', geo: skin.add(shoes), material: face },
    { name: 'head', geo: crushedHead, material: face, at: neck },
    { name: 'head', geo: hair, material: face, at: neck },
  ];
  if (detail.jaw) {
    // the lower face, cut along the mouth, on a hinge under the ears: it drops open, and it is dark in there
    const y0 = DOLL.headBottom - 0.012;
    const scale = 0.135;
    const inJaw = (x, y, z) => y < y0 + 0.3 * scale && y > y0 + 0.135 * scale && z > 0.012 - Math.abs(x) * 0.05;
    const jaw = new Geo();
    const rest = new Geo();
    const mapJaw = new Map();
    const mapRest = new Map();
    const copy = (g, map, v) => {
      if (!map.has(v)) map.set(v, g.vertex([crushedHead.p[v * 3], crushedHead.p[v * 3 + 1], crushedHead.p[v * 3 + 2]], [crushedHead.n[v * 3], crushedHead.n[v * 3 + 1], crushedHead.n[v * 3 + 2]], [crushedHead.uv[v * 2], crushedHead.uv[v * 2 + 1]]));
      return map.get(v);
    };
    for (let t = 0; t < crushedHead.i.length; t += 3) {
      const tri = [crushedHead.i[t], crushedHead.i[t + 1], crushedHead.i[t + 2]];
      const low = tri.every((v) => inJaw(crushedHead.p[v * 3], crushedHead.p[v * 3 + 1], crushedHead.p[v * 3 + 2]));
      for (const v of tri) (low ? jaw : rest).i.push(copy(low ? jaw : rest, low ? mapJaw : mapRest, v));
    }
    parts[2].geo = rest;
    const hinge = [0, y0 + 0.335 * scale, 0.004];
    parts.push({ name: 'jaw', geo: jaw, material: face, at: hinge, parent: 'head' });
    const dark = { name: 'doll_inside', color: [0.006, 0.004, 0.004], rough: 0.9, double: true };
    parts.push({ name: 'head', geo: box(0, y0 + 0.27 * scale, 0.012, 0.016, 0.017, 0.018), material: dark, at: neck });
  }
  if (detail.eyes) {
    // glass eyes: a dark gloss that catches the bulb
    const glass = { name: 'doll_glass', color: [0.02, 0.025, 0.03], rough: 0.05 };
    const zEye = detail.eyeZ;
    const y = detail.eyeY;
    for (const side of [-1, 1]) {
      parts.push({ name: 'head', geo: lathe(Array.from({ length: 7 }, (_, i) => [Math.sin((i / 6) * Math.PI) * 0.0078, -Math.cos((i / 6) * Math.PI) * 0.0078]), 10), material: glass, at: neck, shift: [side * 0.0169, y, zEye] });
    }
  }
  for (const part of parts) {
    if (!part.shift) continue;
    const moved = new Geo();
    moved.add(part.geo, (p) => [p[0] + part.shift[0], p[1] + part.shift[1], p[2] + part.shift[2]]);
    part.geo = moved;
  }
  await writeModel(key, parts);
}

// ------------------------------------------------------------------ a coat that nobody is in

/** The man's jacket with his arms let down and him gone from it. */
async function writeCoat() {
  const doc = await io.read(path.join(ROOT, '.asset-cache/character/figure_man.glb'));
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const names = joints.map((j) => j.getName());
  const ibm = skin.getInverseBindMatrices();
  const mul = (a, b) => {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[r + 4] * b[c * 4 + 1] + a[r + 8] * b[c * 4 + 2] + a[r + 12] * b[c * 4 + 3];
    return o;
  };
  const rotateAbout = (p, angle) => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const r = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const t = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p[0], p[1], p[2], 1];
    const u = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1];
    return mul(t, mul(r, u));
  };
  // arms come down about the shoulders, in world space: each arm joint and all it carries
  const pose = joints.map((j) => j.getWorldMatrix());
  const descends = (j, top) => {
    for (let n = j; n; n = n.listParents().find((x) => x.propertyType === 'Node')) if (n === top) return true;
    return false;
  };
  const down = (nameRe, angle) => {
    const top = joints.find((j) => nameRe.test(j.getName()));
    const m = top.getWorldMatrix();
    const R = rotateAbout([m[12], m[13], m[14]], angle);
    joints.forEach((j, i) => {
      if (descends(j, top)) pose[i] = mul(R, pose[i]);
    });
  };
  down(/L.*UpperArm/, -COAT.drop);
  down(/R.*UpperArm/, COAT.drop);
  const inverse = joints.map((_, i) => {
    const a = [];
    ibm.getElement(i, a);
    return a;
  });
  const skinMatrix = joints.map((_, i) => mul(pose[i], inverse[i]));
  const gone = /Head|Neck|Hand|Finger|Thigh|Calf|Foot|Toe/;
  const parts = [];
  const seen = new Set();
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial();
      if (!/body/.test(material?.getName() ?? '') || seen.has(prim)) continue;
      seen.add(prim);
      const pos = prim.getAttribute('POSITION');
      const nor = prim.getAttribute('NORMAL');
      const uvs = prim.getAttribute('TEXCOORD_0');
      const jo = prim.getAttribute('JOINTS_0');
      const we = prim.getAttribute('WEIGHTS_0');
      const idx = prim.getIndices();
      const geo = new Geo();
      const keepVertex = [];
      const a = [0, 0, 0];
      const b = [0, 0, 1];
      const u = [0, 0];
      const j4 = [0, 0, 0, 0];
      const w4 = [0, 0, 0, 0];
      for (let v = 0; v < pos.getCount(); v++) {
        pos.getElement(v, a);
        nor.getElement(v, b);
        uvs.getElement(v, u);
        jo.getElement(v, j4);
        we.getElement(v, w4);
        const out = [0, 0, 0];
        const n = [0, 0, 0];
        let best = 0;
        let bestWeight = -1;
        for (let k = 0; k < 4; k++) {
          if (w4[k] <= 0) continue;
          if (w4[k] > bestWeight) {
            bestWeight = w4[k];
            best = j4[k];
          }
          const m = skinMatrix[j4[k]];
          const p = transformPoint(m, a);
          const d = transformDirection(m, b);
          for (let c = 0; c < 3; c++) {
            out[c] += p[c] * w4[k];
            n[c] += d[c] * w4[k];
          }
        }
        keepVertex.push(!gone.test(names[best]));
        geo.vertex(out, normalized(n), [u[0], u[1]]);
      }
      const count = idx ? idx.getCount() : pos.getCount();
      for (let t = 0; t < count; t += 3) {
        const tri = [0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k));
        if (tri.every((v) => keepVertex[v])) geo.i.push(...tri);
      }
      if (geo.i.length) parts.push({ geo, material });
    }
  }
  // stand it so its collar is at the top of the model, on the hanger's height
  const all = new Geo();
  for (const part of parts) all.add(part.geo);
  const map = parts[0].material.getBaseColorTexture()?.getImage();
  let minY = Infinity;
  for (let v = 1; v < all.p.length; v += 3) minY = Math.min(minY, all.p[v]);
  const moved = new Geo();
  moved.add(all, (p) => [p[0], p[1] - minY, p[2]]);
  await writeModel('coat', [{ name: 'coat', geo: moved, material: { name: 'coat_cloth', map: map ? Buffer.from(map) : null, rough: 0.85, double: true } }]);
}

const COAT = { drop: 0.72 };

// ------------------------------------------------------------------ a roach for a crowd

/** The roach, welded and crushed to very few triangles, one plain glossy material: one draw, however many. */
async function writeRoachLow() {
  const meshes = await firstMeshes(path.join(OUT, 'roach.glb'));
  const welded = new Geo();
  const seen = new Map();
  for (const m of meshes) {
    for (const old of m.geo.i) {
      const p = [m.geo.p[old * 3], m.geo.p[old * 3 + 1], m.geo.p[old * 3 + 2]];
      const k = p.map((v) => v.toFixed(5)).join();
      if (!seen.has(k)) seen.set(k, welded.vertex(p, [0, 1, 0]));
      welded.i.push(seen.get(k));
    }
  }
  await writeModel('roach_low', [{ name: 'roach_low', geo: welded.crush(170, 0.6).smooth(), material: { name: 'roach_shell', color: [0.05, 0.022, 0.012], rough: 0.3 } }]);
}

// ------------------------------------------------------------------ a birch's bark

const BARK_URL = 'https://ambientcg.com/get?file=Bark009_1K-JPG.zip';

/**
 * ambientCG's Bark009, whitened, with the short dark lines birches have. Normal and ORM are the source's, made as
 * scripts/build-assets.mjs makes those of an ambientCG material (ORM: R = occlusion, G = roughness, B = no metal).
 */
async function writeBirchBark() {
  const zip = path.join(ROOT, '.asset-cache/ambientcg/Bark009_1K.zip');
  if (!fs.existsSync(zip) || fs.statSync(zip).size === 0) {
    const res = await fetch(BARK_URL, { headers: { 'User-Agent': 'the-dream-of-the-photo asset pipeline (dev tool)' } });
    if (!res.ok) throw new Error(`${res.status} ${BARK_URL}`);
    fs.mkdirSync(path.dirname(zip), { recursive: true });
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  const entries = unzipSync(new Uint8Array(fs.readFileSync(zip)));
  const find = (suffix) => Buffer.from(entries[Object.keys(entries).find((n) => n.endsWith(`_${suffix}.jpg`) || n.endsWith(`_${suffix}.png`))]);
  const size = 1024;
  const random = randomFrom(9);
  let lines = '';
  for (let i = 0; i < 130; i++) {
    const x = random() * size;
    const y = random() * size;
    const w = 14 + random() ** 2 * 170;
    const h = 1.5 + random() * 5;
    for (const dx of [0, -size, size]) lines += `<ellipse cx="${x + dx}" cy="${y}" rx="${w}" ry="${h}" fill="#0c0a08" opacity="${0.45 + random() * 0.5}"/>`;
  }
  const overlay = await svgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${lines}</svg>`, size);
  const base = await sharp(find('Color')).resize(size, size).modulate({ saturation: 0.1, brightness: 1.18 }).linear(1.25, -22).composite([{ input: overlay }]).toBuffer();
  const out = path.join(ROOT, 'public/textures/bark_birch');
  await sharp(base).webp({ quality: 84 }).toFile(`${out}_color.webp`);
  await sharp(find('NormalGL')).resize(size, size).webp({ quality: 90 }).toFile(`${out}_normal.webp`);
  const [ao, rough] = await Promise.all(['AmbientOcclusion', 'Roughness'].map((map) => sharp(find(map)).resize(size, size).greyscale().extractChannel(0).raw().toBuffer()));
  const orm = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    orm[i * 3] = ao[i];
    orm[i * 3 + 1] = rough[i];
  }
  const packed = await sharp(orm, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
  await sharp(packed).resize(size, size).webp({ quality: 88 }).toFile(`${out}_orm.webp`);
  console.log('bark_birch');
}

// ------------------------------------------------------------------ small things nobody offers

/** A dentist's handpiece: the handle along +Z, its head at the far end, the burr pointing down, its hose behind. */
async function writeDentalDrill() {
  const steel = { name: 'drill_steel', color: [0.62, 0.62, 0.6], rough: 0.26, metal: 1 };
  const hose = { name: 'drill_hose', color: [0.025, 0.025, 0.025], rough: 0.6 };
  const handle = tube([[0, 0, -0.035], [0, 0, 0], [0, 0.002, 0.045], [0, 0.006, 0.09], [0, 0.007, 0.112]], 0.0105, 0.0048, 12);
  const head = lathe([[0, -0.008], [0.0066, -0.0075], [0.0072, -0.003], [0.0072, 0.004], [0.0062, 0.0075], [0, 0.008]], 12);
  const burr = tube([[0, -0.007, 0], [0, -0.019, 0], [0, -0.0255, 0]], 0.0009, 0.0006, 6);
  const tail = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    tail.push([Math.sin(t * 2.2) * 0.05, -0.2 * t * t, -0.035 - 0.26 * t]);
  }
  const whole = new Geo();
  whole.add(handle);
  whole.add(head, (p) => [p[0], p[1] + 0.008, p[2] + 0.118]);
  whole.add(burr, (p) => [p[0], p[1] + 0.008, p[2] + 0.118]);
  await writeModel('dental_drill', [
    { name: 'dental_drill', geo: whole, material: steel },
    { name: 'dental_drill', geo: tube(tail, 0.0042, 0.0042, 6), material: hose },
  ]);
}

/** The thin-waisted glass tea is drunk from, with its tea and its saucer. */
async function writeTeaGlass() {
  const glass = { name: 'tea_glass', color: [0.66, 0.7, 0.68], rough: 0.06, alpha: 0.3, double: true };
  const tea = { name: 'tea_itself', color: [0.2, 0.045, 0.012], rough: 0.08 };
  const china = { name: 'tea_saucer', color: [0.72, 0.7, 0.64], rough: 0.25 };
  const y0 = 0.012;
  const outline = [[0, y0], [0.019, y0], [0.0215, y0 + 0.006], [0.0245, y0 + 0.022], [0.0215, y0 + 0.045], [0.0205, y0 + 0.056], [0.0235, y0 + 0.078], [0.0262, y0 + 0.098]];
  const fill = outline.slice(0, 6).map(([r, y]) => [Math.max(0, r - 0.0014), y + 0.001]);
  fill.push([0.0215, y0 + 0.07], [0, y0 + 0.07]);
  await writeModel('tea_glass', [
    { name: 'glass', geo: lathe(outline, 16), material: glass },
    { name: 'tea', geo: lathe(fill, 14), material: tea },
    { name: 'saucer', geo: lathe([[0, 0.002], [0.03, 0.0015], [0.052, 0.008], [0.056, 0.012], [0.054, 0.0125], [0.03, 0.005], [0, 0.0055]], 18), material: china },
  ]);
}

// ------------------------------------------------------------------ the street dogs

/** Quaternius's animals (Poly Pizza, CC0): rigged, standing, one plain material per color. `eyes` are the materials of its eyes. */
const ANIMALS = {
  husky: { url: 'https://static.poly.pizza/611d25c7-430f-4bb5-ab2c-d8f5f3cb9712.glb', pale: 'Material.001', dark: 'Material', eyes: /Material\.00[23]/ },
  wolf: { url: 'https://static.poly.pizza/f1d12388-e39b-4157-b32a-646a1d089fc4.glb', pale: 'Main_Light', dark: 'Main', eyes: /Eyes/ },
  shiba: { url: 'https://static.poly.pizza/ba6d0ee3-bcc0-4ef0-9d3c-a3e245b41c77.glb', pale: 'Main_Light', dark: 'Main', eyes: /Eyes/ },
};

const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vscale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const qTimes = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qTurn = (axis, deg) => {
  const s = Math.sin((deg * Math.PI) / 360);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos((deg * Math.PI) / 360)];
};
const qApply = (q, v) => {
  const [x, y, z, w] = q;
  const u = [y * v[2] - z * v[1] + w * v[0], z * v[0] - x * v[2] + w * v[1], x * v[1] - y * v[0] + w * v[2]];
  return [v[0] + 2 * (y * u[2] - z * u[1]), v[1] + 2 * (z * u[0] - x * u[2]), v[2] + 2 * (x * u[1] - y * u[0])];
};
const qBetween = (from, to) => {
  const a = normalized(from);
  const b = normalized(to);
  const w = 1 + vdot(a, b);
  if (w < 1e-6) return [1, 0, 0, 0];
  const q = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0], w];
  const l = Math.hypot(...q);
  return q.map((v) => v / l);
};
/** A way in the side plane: `deg` above forward (+Z), turned `yaw` degrees to its left. */
const wayUp = (deg, yaw = 0) => qApply(qTurn([0, 1, 0], yaw), [0, Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)]);

/** A rigged animal as plain arrays: every node of its armature, its vertices in the rest pose with their weights. */
async function readAnimal(kind) {
  const animal = ANIMALS[kind];
  const source = path.join(SRC, `prop_animal_${kind}.glb`);
  if (!fs.existsSync(source) || fs.statSync(source).size === 0) {
    const res = await fetch(animal.url, { headers: { 'User-Agent': 'the-dream-of-the-photo asset pipeline (dev tool)' } });
    if (!res.ok) throw new Error(`${res.status} ${animal.url}`);
    fs.writeFileSync(source, Buffer.from(await res.arrayBuffer()));
  }
  const root = (await io.read(source)).getRoot();
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  let top = joints[0];
  while (top.getParentNode()) top = top.getParentNode();
  const nodes = [];
  top.traverse((n) => nodes.push(n));
  const index = new Map(nodes.map((n, i) => [n, i]));
  const ibm = skin.getInverseBindMatrices();
  const matrixOf = (a, b) => {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[r + 4] * b[c * 4 + 1] + a[r + 8] * b[c * 4 + 2] + a[r + 12] * b[c * 4 + 3];
    return o;
  };
  const bind = joints.map((j, i) => matrixOf(j.getWorldMatrix(), ibm.getElement(i, [])));
  const prims = [];
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const jo = prim.getAttribute('JOINTS_0');
      const we = prim.getAttribute('WEIGHTS_0');
      const idx = prim.getIndices();
      const vertices = [];
      for (let v = 0; v < pos.getCount(); v++) {
        const a = pos.getElement(v, []);
        const j4 = jo.getElement(v, []);
        const w4 = we.getElement(v, []);
        const p = [0, 0, 0];
        const bones = [];
        for (let k = 0; k < 4; k++) {
          if (!w4[k]) continue;
          const t = transformPoint(bind[j4[k]], a);
          for (let c = 0; c < 3; c++) p[c] += t[c] * w4[k];
          bones.push([index.get(joints[j4[k]]), w4[k]]);
        }
        vertices.push({ p, bones });
      }
      const triangles = [];
      for (let t = 0; t < idx.getCount(); t++) triangles.push(idx.getScalar(t));
      prims.push({ material: prim.getMaterial().getName(), vertices, triangles });
    }
  }
  return {
    animal,
    names: nodes.map((n) => n.getName()),
    parent: nodes.map((n) => (index.has(n.getParentNode()) ? index.get(n.getParentNode()) : -1)),
    rest: nodes.map((n) => {
      const m = n.getWorldMatrix();
      return [m[12], m[13], m[14]];
    }),
    prims,
  };
}

/**
 * Poses a skeleton in the model's own axes: each node gets a place and a turn, and a rest point x goes to place + turn (x - rest).
 * aim: { node: [child, way] } turns it so that the way to that child points there. turn: { node: quaternion } adds a turn.
 * place: { node: point } fixes where it is (a paw hangs from no leg in these rigs). shape: { node: [child, along, across] } shortens and thins what hangs on it.
 */
function solveSkeleton(rig, { aim = {}, turn = {}, place = {}, shape = {} }) {
  const { names, parent, rest } = rig;
  const byName = new Map(names.map((n, i) => [n, i]));
  const places = rest.slice();
  const turns = names.map(() => [0, 0, 0, 1]);
  const shapes = names.map(() => null);
  names.forEach((name, i) => {
    const up = parent[i];
    let q = up >= 0 ? turns[up] : [0, 0, 0, 1];
    if (up >= 0) places[i] = vadd(places[up], qApply(turns[up], shaped(vsub(rest[i], rest[up]), shapes[up])));
    if (place[name]) places[i] = place[name];
    if (turn[name]) q = qTimes(turn[name], q);
    if (aim[name]) q = qTimes(qBetween(qApply(q, vsub(rest[byName.get(aim[name][0])], rest[i])), aim[name][1]), q);
    turns[i] = q;
    if (shape[name]) shapes[i] = { axis: normalized(vsub(rest[byName.get(shape[name][0])], rest[i])), along: shape[name][1], across: shape[name][2] ?? 1 };
  });
  const at = (name) => places[byName.get(name)];
  const moved = ({ p, bones }) => {
    const out = [0, 0, 0];
    for (const [j, w] of bones) {
      const t = vadd(places[j], qApply(turns[j], shaped(vsub(p, rest[j]), shapes[j])));
      for (let c = 0; c < 3; c++) out[c] += t[c] * w;
    }
    return out;
  };
  return { at, moved };
}

function shaped(offset, shape) {
  if (!shape) return offset;
  const a = vdot(offset, shape.axis);
  return vadd(vscale(shape.axis, a * shape.along), vscale(vsub(offset, vscale(shape.axis, a)), shape.across));
}

/** The joint between a and c of a limb of these two lengths, bending toward `hint`. */
function limbJoint(a, c, l1, l2, hint) {
  const ac = vsub(c, a);
  const d = Math.min(vlen(ac), l1 + l2 - 1e-4);
  const u = normalized(ac);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const w = normalized(vsub(hint, vscale(u, vdot(hint, u))));
  return vadd(a, vadd(vscale(u, x), vscale(w, Math.sqrt(Math.max(0, l1 * l1 - x * x)))));
}

/** From the numbers in DOGS to the skeleton's pose: the spine first, then legs solved to reach their paws, ears, and a tail that stays above the ground. */
function poseDog(rig, o) {
  const at = (n) => rig.rest[rig.names.indexOf(n)];
  const length = (a, b) => vlen(vsub(at(b), at(a)));
  const spec = { aim: {}, turn: {}, place: {}, shape: {} };
  if (o.hip) spec.place.Back = o.hip;
  const yaw = o.headYaw ?? 0;
  for (const [node, child, deg] of o.spine) spec.aim[node] = [child, wayUp(deg, node === 'Neck3' ? yaw * 0.5 : node === 'Head' ? yaw : 0)];
  if (o.headRoll) spec.turn.Head = qTurn([0, 0, 1], o.headRoll);
  for (const [node, child, along, across] of o.shape ?? []) spec.shape[node] = [child, along, across];
  for (const sd of ['L', 'R']) {
    // the shoulder blade stays nearer its rest than the chest it hangs from
    if (o.scapula) spec.turn[`FrontShoulder.${sd}`] = qTurn([1, 0, 0], o.scapula);
    if (o.hind?.tibia) spec.shape[`BackUpperLeg.${sd}`] = [`BackLowerLeg.${sd}`, o.hind.tibia];
  }
  const body = solveSkeleton(rig, spec);
  for (const sd of ['L', 'R']) {
    const sign = sd === 'L' ? 1 : -1;
    const [shoulder, elbow, wristEnd] = [`FrontUpperLeg.${sd}`, `FrontLowerLeg.${sd}`, `FrontLowerLeg.${sd}_end`];
    const wristRest = at(wristEnd);
    const wrist = [wristRest[0] * (o.front.wide ?? 1), wristRest[1], (o.front.z ?? wristRest[2]) + (o.front.step?.[sd] ?? 0)];
    const elbowAt = limbJoint(body.at(shoulder), wrist, length(shoulder, elbow), length(elbow, wristEnd), [0, 0, -1]);
    spec.aim[shoulder] = [elbow, vsub(elbowAt, body.at(shoulder))];
    spec.aim[elbow] = [wristEnd, vsub(wrist, elbowAt)];
    spec.place[`IKFrontLeg.${sd}`] = wrist;

    const [hip, kneeBone, hockBone, ankleEnd] = [`BackLeg.${sd}`, `BackUpperLeg.${sd}`, `BackLowerLeg.${sd}`, `BackLowerLeg.${sd}_end`];
    const h = o.hind ?? {};
    const step = [0, 0, h.step?.[sd] ?? 0];
    const hock = vadd(h.z === undefined ? at(hockBone) : [sign * h.x, h.y, h.z], step);
    const ankle = h.z === undefined ? vadd(at(ankleEnd), step) : vadd(hock, vscale(normalized([sign * h.footOut, h.footDrop, 1]), length(hockBone, ankleEnd)));
    const kneeAt = limbJoint(body.at(hip), hock, length(hip, kneeBone), length(kneeBone, hockBone) * (h.tibia ?? 1), [sign * (h.kneeOut ?? 0), h.kneeUp ?? 0.3, 1]);
    spec.aim[hip] = [kneeBone, vsub(kneeAt, body.at(hip))];
    spec.aim[kneeBone] = [hockBone, vsub(hock, kneeAt)];
    spec.aim[hockBone] = [ankleEnd, vsub(ankle, hock)];
    spec.place[`IKBackLeg.${sd}`] = ankle;

    if (o.ears) {
      const chain = [`Ear1.${sd}`, `Ear2.${sd}`, `Ear3.${sd}`, `Ear4.${sd}`, `Ear4.${sd}_end`];
      o.ears.forEach((way, i) => {
        if (way) spec.aim[chain[i]] = [chain[i + 1], qApply(qTurn([0, 1, 0], yaw), [sign * way[0], way[1], way[2]])];
      });
      if (o.earShape) for (let i = 0; i < 4; i++) spec.shape[chain[i]] = [chain[i + 1], o.earShape];
    }
  }
  const tail = rig.names.filter((n) => /^Tail\d+$/.test(n));
  const chainOf = (i) => (i + 1 < tail.length ? tail[i + 1] : `${tail[i]}_end`);
  if (o.tailShape) tail.forEach((n, i) => (spec.shape[n] = [chainOf(i), o.tailShape[0], o.tailShape[1]]));
  let point = solveSkeleton(rig, spec).at(tail[0]);
  tail.forEach((n, i) => {
    const l = length(n, chainOf(i)) * (o.tailShape?.[0] ?? 1);
    const wish = normalized(o.tail(i / (tail.length - 1)));
    let next = vadd(point, vscale(wish, l));
    if (next[1] < o.tailY) {
      const flat = normalized([wish[0], 0, wish[2]]);
      const dy = o.tailY - point[1];
      next = dy < l ? vadd(point, vadd([0, dy, 0], vscale(flat, Math.sqrt(l * l - dy * dy)))) : vadd(point, vscale(flat, l));
    }
    spec.aim[n] = [chainOf(i), vsub(next, point)];
    point = next;
  });
  return solveSkeleton(rig, spec);
}

/** Thins the trunk and the neck: a street dog does not eat every day. */
const leanTrunk = (trunk, neck) => [
  ['Torso', 'Torso2', 1, trunk],
  ['Torso2', 'Torso3', 1, trunk],
  ['Torso3', 'Neck1', 1, neck],
];
const SPINE = ['Back', 'Torso', 'Torso2', 'Torso3', 'Neck1', 'Neck2', 'Neck3', 'Head'];
const spineOf = (angles) => angles.map((deg, i) => [SPINE[i + SPINE.length - angles.length], SPINE[i + SPINE.length - angles.length + 1] ?? 'Head_end', deg]);
const SITTING = {
  hip: [0, 0.5, -0.38],
  scapula: 30,
  front: { wide: 0.8, z: 1.0 },
  hind: { x: 0.47, y: 0.2, z: -0.5, kneeOut: 0.5, kneeUp: 0.6, tibia: 0.8, footOut: 0.12, footDrop: -0.02 },
  tailY: 0.1,
};

/**
 * size: the file's units to meters. coat: its darkest and palest color, dark enough to read as a shape in fog. Spine angles run from the pelvis (or the chest,
 * when standing) to the head, in degrees above forward. Nose +Z, on the ground, real meters, no bones left.
 */
const DOGS = {
  dog_sit_a: {
    ...SITTING,
    animal: 'husky',
    size: 0.25,
    coat: ['#14110e', '#6b5a45'],
    spine: spineOf([52, 44, 34, 50, 48, 46, 42, -14]),
    headYaw: -5,
    headRoll: 4,
    front: { ...SITTING.front, step: { L: 0.05 } },
    shape: [...leanTrunk(0.86, 0.9), ['Neck1', 'Neck2', 1, 0.88], ['Neck2', 'Neck3', 1, 0.88], ['Neck3', 'Head', 1, 0.9]],
    tailShape: [0.9, 0.55],
    tailY: 0.12,
    tail: (t) => [0.9 * t, -1.1 * (1 - t) ** 2, -0.8 + t * t],
  },
  dog_sit_b: {
    ...SITTING,
    animal: 'wolf',
    size: 0.25,
    coat: ['#1c1a18', '#6f6a60'],
    hip: [0, 0.45, -0.42],
    spine: spineOf([54, 44, 36, 40, 40, 40, 36, -10]),
    headYaw: 4,
    headRoll: -3,
    front: { wide: 0.8, z: 0.95, step: { R: 0.04 } },
    shape: leanTrunk(0.92, 0.95),
    tailShape: [0.62, 0.62],
    tailY: 0.08,
    tail: (t) => [-0.8 * t * t, -0.5 * (1 - t) ** 2, -0.9 + 0.5 * t],
  },
  dog_sit_c: {
    ...SITTING,
    animal: 'shiba',
    size: 0.235,
    coat: ['#2a2017', '#857354'],
    spine: spineOf([52, 44, 34, 44, 42, 40, 36, -16]),
    headYaw: 7,
    headRoll: 2,
    shape: leanTrunk(0.9, 0.92),
    // ears that have fallen forward at the tip, as on most dogs with no breed
    ears: [null, [0.8, 0.55, 0.25], [0.55, -0.45, 0.7], [0.3, -0.85, 0.45]],
    earShape: 1.25,
    tail: (t) => [0.75 * Math.sin(t * 3), -0.8 * (1 - t) ** 3, -0.8 * Math.cos(t * 3)],
  },
};

/** Value noise with no seams to speak of: patches in a coat. */
function coatNoise(x, y, z) {
  const lattice = (i, j, k) => {
    const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const [i, j, k] = [Math.floor(x), Math.floor(y), Math.floor(z)];
  const [u, v, w] = [x - i, y - j, z - k].map((t) => t * t * (3 - 2 * t));
  const mix = (a, b, t) => a + (b - a) * t;
  return mix(mix(mix(lattice(i, j, k), lattice(i + 1, j, k), u), mix(lattice(i, j + 1, k), lattice(i + 1, j + 1, k), u), v), mix(mix(lattice(i, j, k + 1), lattice(i + 1, j, k + 1), u), mix(lattice(i, j + 1, k + 1), lattice(i + 1, j + 1, k + 1), u), v), w);
}

/** One welded body and its dark eyes and nose, one material, one draw; its colors are places along a small picture of its coat. */
async function writeDog(key) {
  const o = DOGS[key];
  const rig = await readAnimal(o.animal);
  const { animal } = rig;
  const { moved } = poseDog(rig, o);
  const paws = /^(IK|FF)/;
  let floor = Infinity;
  const baked = rig.prims.map((prim) => prim.vertices.map((vertex) => {
    const p = vscale(moved(vertex), o.size);
    if (vertex.bones.some(([j]) => paws.test(rig.names[j]))) floor = Math.min(floor, p[1]);
    return p;
  }));
  const body = new Geo();
  const parts = new Geo();
  const welded = new Map();
  const eyePoints = [];
  rig.prims.forEach((prim, n) => {
    const isBody = prim.material === animal.pale || prim.material === animal.dark;
    const map = prim.vertices.map((_, v) => {
      const p = baked[n][v];
      p[1] = Math.max(p[1], floor) - floor;
      if (animal.eyes.test(prim.material)) eyePoints.push(p);
      if (!isBody) return parts.vertex(p, [0, 1, 0], [0.5, 0.92]);
      const id = p.map((c) => c.toFixed(4)).join();
      if (!welded.has(id)) welded.set(id, { index: body.vertex(p, [0, 1, 0]), pale: 0, count: 0 });
      const w = welded.get(id);
      w.pale += prim.material === animal.pale ? 1 : 0;
      w.count += 1;
      return w.index;
    });
    const target = isBody ? body : parts;
    for (let t = 0; t < prim.triangles.length; t += 3) {
      const [a, b, c] = [map[prim.triangles[t]], map[prim.triangles[t + 1]], map[prim.triangles[t + 2]]];
      if (a !== b && b !== c && a !== c) target.i.push(a, b, c);
    }
  });
  for (const w of welded.values()) {
    const [x, y, z] = [body.p[w.index * 3], body.p[w.index * 3 + 1], body.p[w.index * 3 + 2]];
    const patches = coatNoise(x * 7 + 3, y * 7, z * 7) - 0.5;
    const fine = coatNoise(x * 23, y * 23 + 5, z * 23) - 0.5;
    // mud on the paws, whatever the coat is
    const tone = ((w.pale / w.count) * 0.62 + 0.14 + patches * 0.8 + fine * 0.3) * (0.4 + 0.6 * smoothstep(0.015, 0.14, y));
    body.uv[w.index * 2] = 0.06 + 0.88 * Math.min(1, Math.max(0, tone));
    body.uv[w.index * 2 + 1] = 0.4;
  }
  body.smooth();
  parts.smooth();
  const whole = new Geo();
  whole.add(body).add(parts);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < whole.p.length; v += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], whole.p[v + k]);
      max[k] = Math.max(max[k], whole.p[v + k]);
    }
  }
  const origin = [(min[0] + max[0]) / 2, 0, (min[2] + max[2]) / 2];
  const placed = new Geo();
  placed.add(whole, (p) => vsub(p, origin));
  const size = 64;
  const picture = await svgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><linearGradient id="c"><stop offset="0" stop-color="${o.coat[0]}"/><stop offset="1" stop-color="${o.coat[1]}"/></linearGradient></defs><rect width="${size}" height="${size}" fill="url(#c)"/><rect y="${size * 0.8}" width="${size}" height="${size * 0.2}" fill="#050505"/></svg>`, size);
  await writeModel(key, [{ name: key, geo: placed, material: { name: 'dog_coat', map: picture, rough: 0.94 } }]);
  const middle = eyePoints.reduce((sum, p) => sum + p[0], 0) / eyePoints.length;
  const eye = (side) => {
    const of = eyePoints.filter((p) => (p[0] - middle) * side > 0);
    return [0, 1, 2].map((k) => (of.reduce((sum, p) => sum + p[k], 0) / of.length - origin[k]).toFixed(3));
  };
  console.log(`${key.padEnd(20)} ${max.map((v, k) => (v - min[k]).toFixed(3)).join(' x ')} m, left eye ${eye(1).join(', ')}, right eye ${eye(-1).join(', ')}`);
}

// ------------------------------------------------------------------ run

for (const key of Object.keys(DOGS)) if (wanted(key)) await writeDog(key);
for (const key of Object.keys(CLOTH_OBJECTS)) if (wanted(key)) await writeCloth(key);
if (wanted('bed_iron')) await writeBed();
if (wanted('eyeball')) await writeEye();
if (wanted('party_hat') || wanted('balloon') || wanted('candle_party')) await writeParty();
if (wanted('music_box')) await writeMusicBox();
if (wanted('doll')) await writeDoll('doll', { head: 3200, hair: 1600, dress: 2600, sides: 10, eyes: true, eyeY: 0.357, eyeZ: 0.0395, jaw: true });
if (wanted('doll_low')) await writeDoll('doll_low', { head: 420, hair: 160, dress: 320, sides: 4, eyes: false });
if (wanted('dental_drill')) await writeDentalDrill();
if (wanted('tea_glass')) await writeTeaGlass();
if (wanted('coat')) await writeCoat();
if (wanted('roach_low')) await writeRoachLow();
if (wanted('bark_birch')) await writeBirchBark();
