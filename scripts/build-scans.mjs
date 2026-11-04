/**
 * Museum scans and other free models that do not arrive as ready glTF: downloads them (see SOURCES;
 * licences in ASSET_MANIFEST.md), welds and decimates what is too heavy, stands them upright on the
 * ground at the origin, and writes plain GLBs to .asset-cache/scans/, where scripts/assets.json picks
 * them up as 'local' models. Scans are normalized to 1 m tall: a prop's `scale` is then its height in meters.
 *
 *   node scripts/build-scans.mjs [--only key1,key2]   then   npm run assets -- --only key1,key2
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, prune } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.asset-cache/scans');
const SRC = path.join(OUT, 'src');
fs.mkdirSync(SRC, { recursive: true });

const SMK = 'https://api.smk.dk/api/v1/download-3d';
const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons';
const OGA = 'https://opengameart.org/sites/default/files';
const SI = 'https://3d-api.si.edu/content/document';
const PIZZA = 'https://static.poly.pizza';
const KHRONOS = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models';

/**
 * up: which axis of the file points up. turn: degrees about the vertical, so it faces +Z.
 * plain: materials to strip of their textures, with the color they get instead.
 * tris: decimation target for a triangle soup (STL).
 */
const SOURCES = [
  { key: 'giant_head', url: `${SMK}/ft848w42r_KAS19-10_small.stl`, tris: 36000, up: 'z' },
  { key: 'angel', url: `${SMK}/q811kq43k_KAS1221_small.stl`, tris: 36000, up: 'z' },
  { key: 'hercules_head', url: `${SMK}/nk322j800_KAS701_small.stl`, tris: 30000, up: 'z' },
  { key: 'singing_bust', url: `${COMMONS}/0/0a/Bust_Of_A_Singing_Woman_-_3D_model_by_Limerick3D_-_Sketchfab.stl`, tris: 30000, up: 'z', turn: 90 },
  { key: 'satyr_head', url: `${COMMONS}/1/1c/MSR-Tete-de-Satyre-Ra131.stl`, tris: 12000, up: '-z', turn: 180 },
  { key: 'dogu', url: `${COMMONS}/e/ef/DoguMissUmataka.stl`, tris: 16000, up: 'x' },
  { key: 'heart', url: `${COMMONS}/d/d2/3D_model_of_a_human_heart.stl`, tris: 14000, up: 'y' },
  { key: 'mri_head', url: `${OGA}/head_0.obj`, up: 'y' },
  {
    key: 'skull',
    url: `${OGA}/skull-obj.zip`,
    entry: 'skull-Low4K.obj',
    maps: { color: 'Skull-Low.png', normal: 'Skull-Low-normal.png', ao: 'Skull-AO.png', rough: 'Skull-Low_r.png' },
    up: 'y',
  },
  { key: 'mannequin', url: `${OGA}/Mannequin%20male.zip`, entry: 'MannequinMale.obj', up: 'y' },
  {
    key: 'meat_hook',
    url: `${OGA}/meat_hook_5.zip`,
    entry: 'MeatHook5.obj',
    maps: { color: 'MeatHook5Albedo.png', normal: 'MeatHook5Normal.png', ao: 'MeatHook5AO.png', rough: 'MeatHook5Rough.png', metal: 'MeatHook5Metal.png' },
    up: 'y',
  },
  { key: 'forearm', url: `${SI}/3d_package:7f2659ba-2953-47a5-9358-921da9b0ce16/life-cast-of-left-forearm-and-hand-150k-1024-low.glb`, up: 'x' },
  { key: 'winged_monster', url: `${SI}/3d_package:0dc68216-3651-44c7-99cf-18e5d4d1eb9f/kneeling-winged-monster-150k-1024-low.glb`, up: 'y' },
  { key: 'shark_jaw', url: `${SI}/3d_package:d490078d-f538-4bbc-ba7f-977dcd69cd86/USNM_112589-150k-1024-low.glb`, up: 'y' },
  { key: 'empty_dress', url: `${SI}/3d_package:cce6919a-24ef-4849-9575-8aec57264fac/NMAH_1992_0102-150k-1024-low.glb`, up: 'z' },
  { key: 'corset_mannequin', url: `${KHRONOS}/Corset/glTF-Binary/Corset.glb`, up: 'y' },
  // its licence excludes a maker's logo painted on the tripod's texture: the tripod ships without textures
  { key: 'antique_camera', url: `${KHRONOS}/AntiqueCamera/glTF-Binary/AntiqueCamera.glb`, up: 'y', separate: true, plain: { tripod: [0.05, 0.028, 0.016, 1] } },
  { key: 'hanging_cage', url: `${PIZZA}/881e34da-006e-4ab7-990f-59ac6665c07b.glb`, up: 'y' },
  { key: 'guillotine', url: `${PIZZA}/b6e4e21e-03e6-42d4-a3ad-5bad10d82a03.glb`, up: 'y' },
  { key: 'iron_chair', url: `${PIZZA}/44d9fc70-fcae-4fcb-80af-86e4806f9eeb.glb`, up: 'y' },
  { key: 'dentist_chair', url: `${PIZZA}/5eabf9ea-6926-4928-87ea-fe4da4c0d9ae.glb`, up: 'y' },
  { key: 'raven', url: `${PIZZA}/6d999ed8-35e4-4faf-9916-7fda9e230998.glb`, up: 'y' },
  { key: 'teeth', url: `${PIZZA}/630546ef-d90c-4512-bba7-2a5c3330e587.glb`, up: 'y', arches: true },
];

const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null;

await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'meshopt.decoder': MeshoptDecoder,
});

/** Which axis of the file is up. */
const TO_UP = {
  y: (v) => v,
  z: ([x, y, z]) => [x, z, -y],
  '-z': ([x, y, z]) => [x, -z, y],
  x: ([x, y, z]) => [-y, x, z],
  '-x': ([x, y, z]) => [y, -x, z],
};
/** The same as a quaternion, for glTF sources. */
const R = Math.SQRT1_2;
const UP_ROTATION = { y: [0, 0, 0, 1], z: [-R, 0, 0, R], '-z': [R, 0, 0, R], x: [0, 0, R, R], '-x': [0, 0, -R, R] };

async function fetchSource(url) {
  const file = path.join(SRC, decodeURIComponent(url.split('/').pop()));
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  const res = await fetch(url, { headers: { 'User-Agent': 'the-dream-of-the-photo asset pipeline (dev tool)' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

// ------------------------------------------------------------------ triangle soups

function readStl(buffer) {
  const count = buffer.readUInt32LE(80);
  const seen = new Map();
  const positions = [];
  const index = new Uint32Array(count * 3);
  let o = 84;
  let k = 0;
  for (let t = 0; t < count; t++) {
    o += 12;
    for (let v = 0; v < 3; v++) {
      const x = buffer.readFloatLE(o);
      const y = buffer.readFloatLE(o + 4);
      const z = buffer.readFloatLE(o + 8);
      o += 12;
      const key = `${x},${y},${z}`;
      let i = seen.get(key);
      if (i === undefined) {
        i = positions.length / 3;
        seen.set(key, i);
        positions.push(x, y, z);
      }
      index[k++] = i;
    }
    o += 2;
  }
  return { positions: new Float32Array(positions), index };
}

function readObj(text) {
  const vs = [];
  const vts = [];
  const vns = [];
  const seen = new Map();
  const positions = [];
  const uvs = [];
  const normals = [];
  const index = [];
  const vertex = (token) => {
    let i = seen.get(token);
    if (i !== undefined) return i;
    const [a, b, c] = token.split('/').map((n) => (n ? Number(n) : 0));
    const at = (list, n) => list[n < 0 ? list.length + n : n - 1];
    i = positions.length / 3;
    positions.push(...at(vs, a));
    if (b) {
      const uv = at(vts, b);
      uvs.push(uv[0], 1 - uv[1]);
    } else if (vts.length) uvs.push(0, 0);
    if (c) normals.push(...at(vns, c));
    seen.set(token, i);
    return i;
  };
  for (const line of text.split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') vs.push([+p[1], +p[2], +p[3]]);
    else if (p[0] === 'vt') vts.push([+p[1], +p[2]]);
    else if (p[0] === 'vn') vns.push([+p[1], +p[2], +p[3]]);
    else if (p[0] === 'f') {
      const f = p.slice(1).map(vertex);
      for (let i = 1; i < f.length - 1; i++) index.push(f[0], f[i], f[i + 1]);
    }
  }
  return {
    positions: new Float32Array(positions),
    index: new Uint32Array(index),
    uvs: uvs.length ? new Float32Array(uvs) : null,
    normals: normals.length === positions.length ? new Float32Array(normals) : null,
  };
}

function decimate(mesh, tris) {
  if (mesh.index.length / 3 <= tris) return mesh;
  const [kept] = MeshoptSimplifier.simplify(mesh.index, mesh.positions, 3, tris * 3, 0.03);
  const remap = new Map();
  const positions = [];
  const index = new Uint32Array(kept.length);
  kept.forEach((old, n) => {
    let i = remap.get(old);
    if (i === undefined) {
      i = positions.length / 3;
      remap.set(old, i);
      positions.push(mesh.positions[old * 3], mesh.positions[old * 3 + 1], mesh.positions[old * 3 + 2]);
    }
    index[n] = i;
  });
  return { positions: new Float32Array(positions), index };
}

/** Upright, on the ground, at the origin, 1 m tall. */
function normalize(positions, up, turn = 0) {
  const p = positions;
  const c = Math.cos((turn * Math.PI) / 180);
  const s0 = Math.sin((turn * Math.PI) / 180);
  for (let i = 0; i < p.length; i += 3) {
    const [x, y, z] = TO_UP[up]([p[i], p[i + 1], p[i + 2]]);
    p[i] = x * c + z * s0;
    p[i + 1] = y;
    p[i + 2] = -x * s0 + z * c;
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p[i + a]);
      max[a] = Math.max(max[a], p[i + a]);
    }
  }
  const s = 1 / (max[1] - min[1]);
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  for (let i = 0; i < p.length; i += 3) {
    p[i] = (p[i] - cx) * s;
    p[i + 1] = (p[i + 1] - min[1]) * s;
    p[i + 2] = (p[i + 2] - cz) * s;
  }
}

function smoothNormals(positions, index) {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t] * 3, index[t + 1] * 3, index[t + 2] * 3];
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      n[v] += fx;
      n[v + 1] += fy;
      n[v + 2] += fz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

/** Ambient occlusion, roughness and metalness in one image (missing channels get neutral values). */
async function packOrm(ao, rough, metal) {
  const channel = async (b, fallback, size) =>
    b ? sharp(b).resize(size, size).greyscale().extractChannel(0).raw().toBuffer() : Buffer.alloc(size * size, fallback);
  const size = 1024;
  const [r, g, m] = await Promise.all([channel(ao, 255, size), channel(rough, 200, size), channel(metal, 0, size)]);
  const rgb = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    rgb[i * 3] = r[i];
    rgb[i * 3 + 1] = g[i];
    rgb[i * 3 + 2] = m[i];
  }
  return sharp(rgb, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

async function writeMesh(key, mesh, files) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(mesh.positions).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(mesh.normals ?? smoothNormals(mesh.positions, mesh.index)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(mesh.index).setBuffer(buffer));
  if (mesh.uvs) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(mesh.uvs).setBuffer(buffer));
  const material = doc.createMaterial(key).setRoughnessFactor(0.85).setMetallicFactor(0);
  if (files) {
    const image = (name, b) => doc.createTexture(name).setImage(new Uint8Array(b)).setMimeType('image/png');
    if (files.color) material.setBaseColorTexture(image(`${key}_color`, files.color));
    if (files.normal) material.setNormalTexture(image(`${key}_normal`, files.normal));
    if (files.ao || files.rough || files.metal) {
      const orm = image(`${key}_orm`, await packOrm(files.ao, files.rough, files.metal));
      material.setOcclusionTexture(orm).setMetallicRoughnessTexture(orm).setRoughnessFactor(1).setMetallicFactor(1);
    }
  }
  prim.setMaterial(material);
  doc.createScene().addChild(doc.createNode(key).setMesh(doc.createMesh(key).addPrimitive(prim)));
  await new NodeIO().write(path.join(OUT, `${key}.glb`), doc);
  console.log(`${key.padEnd(20)} ${mesh.index.length / 3} tris`);
}

// ------------------------------------------------------------------ glTF sources

/** Standing on the ground at the origin, 1 m tall, one mesh per material; `keep` selects mesh nodes. */
async function writeGltf(key, file, item, keep) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  for (const e of root.listExtensionsUsed()) if (e.extensionName === 'KHR_draco_mesh_compression' || e.extensionName === 'EXT_meshopt_compression') e.dispose();
  const scene = root.listScenes()[0];
  for (const [name, color] of Object.entries(item.plain ?? {})) {
    const material = root.listMaterials().find((m) => m.getName() === name);
    material.setBaseColorTexture(null).setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setBaseColorFactor(color).setRoughnessFactor(0.7).setMetallicFactor(0);
  }
  if (keep) scene.traverse((n) => n.getMesh() && !keep(n) && n.dispose());
  const upright = doc.createNode('upright').setRotation(UP_ROTATION[item.up]);
  for (const c of scene.listChildren()) {
    scene.removeChild(c);
    upright.addChild(c);
  }
  scene.addChild(upright);
  const b = getBounds(scene);
  const s = 1 / (b.max[1] - b.min[1]);
  const wrap = doc.createNode(key).setScale([s, s, s]).setTranslation([-((b.min[0] + b.max[0]) / 2) * s, -b.min[1] * s, -((b.min[2] + b.max[2]) / 2) * s]);
  for (const c of scene.listChildren()) {
    scene.removeChild(c);
    wrap.addChild(c);
  }
  scene.addChild(wrap);
  // the camera's body and tripod stay separate nodes; everything else merges into one mesh per material
  if (item.separate) await doc.transform(dedup(), prune());
  else await doc.transform(dedup(), flatten(), join({ keepNamed: false }), prune());
  await io.write(path.join(OUT, `${key}.glb`), doc);
  let tris = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  console.log(`${key.padEnd(20)} ${Math.round(tris)} tris, ${root.listMeshes().length} meshes`);
}

/** The denture: its upper and lower arches apart, so that a jaw can close. */
async function writeArches(key, file, item) {
  const doc = await io.read(file);
  const centers = [];
  doc.getRoot().listScenes()[0].traverse((n) => {
    if (!n.getMesh()) return;
    const box = getBounds(n);
    centers.push((box.min[1] + box.max[1]) / 2);
  });
  const middle = (Math.min(...centers) + Math.max(...centers)) / 2;
  const isUpper = (n) => {
    const box = getBounds(n);
    return (box.min[1] + box.max[1]) / 2 > middle;
  };
  await writeGltf(`${key}_upper`, file, item, isUpper);
  await writeGltf(`${key}_lower`, file, item, (n) => !isUpper(n));
}

for (const item of SOURCES) {
  if (only && !only.has(item.key)) continue;
  const file = await fetchSource(item.url);
  if (file.endsWith('.glb')) {
    if (item.arches) await writeArches(item.key, file, item);
    else await writeGltf(item.key, file, item);
    continue;
  }
  let mesh;
  let files = null;
  if (file.endsWith('.stl')) mesh = decimate(readStl(fs.readFileSync(file)), item.tris);
  else {
    let text;
    if (file.endsWith('.zip')) {
      const entries = unzipSync(new Uint8Array(fs.readFileSync(file)));
      const find = (name) => {
        const hit = Object.keys(entries).find((n) => n.split('/').pop() === name);
        return hit ? Buffer.from(entries[hit]) : null;
      };
      text = find(item.entry).toString();
      if (item.maps) files = Object.fromEntries(Object.entries(item.maps).map(([k, name]) => [k, find(name)]));
    } else text = fs.readFileSync(file, 'utf8');
    mesh = readObj(text);
  }
  normalize(mesh.positions, item.up, item.turn);
  await writeMesh(item.key, mesh, files);
}
