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
import { clearNodeTransform } from '@gltf-transform/functions';
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

// ------------------------------------------------------------------ props in real meters

/**
 * Small free models for the rooms. Unlike the scans above they keep their real size, because a room places
 * many of them side by side. Licences in ASSET_MANIFEST.md.
 *
 * url: a GLB, or a ZIP with the GLB `entry` in it. pick, drop: which nodes (regex on the node's name).
 * up, turn: as in SOURCES. rotate: [x, y, z] degrees, applied before them, for a thing that lies in its file as it should not.
 * height, width, depth, long (the longest side), scale: its real size; none of them: the file is in meters already.
 * parts: { name in the file: name here } stay single nodes (a lid, a drawer, a door); all the others join into one node called after the key.
 * paint: a look from LOOKS for all of it. mats: { material name: look }, the others stay as they are.
 * tint: { saturation, brightness } changes the base color images. double: draw both faces. rough: its roughness, all of it. rig: keeps its bones and clips as they are.
 * Painted models get UVs in meters (see boxUvs), so that kit.surface(key, tile) tiles on them as on a wall.
 */
const BASEMESH = 'https://www.thebasemesh.com/_files/archives';

/** Linear colors, as glTF wants them. */
const LOOKS = {
  ceramic: { color: [0.78, 0.75, 0.68], rough: 0.25 },
  plastic_bone: { color: [0.56, 0.53, 0.44], rough: 0.5 },
  plastic_grey: { color: [0.3, 0.31, 0.29], rough: 0.55 },
  bakelite: { color: [0.012, 0.01, 0.01], rough: 0.22 },
  steel: { color: [0.6, 0.6, 0.58], rough: 0.3, metal: 1 },
  steel_dull: { color: [0.42, 0.42, 0.4], rough: 0.5, metal: 1 },
  iron: { color: [0.035, 0.035, 0.035], rough: 0.6, metal: 0.6 },
  iron_paint: { color: [0.2, 0.2, 0.18], rough: 0.55, metal: 0.3 },
  brass: { color: [0.62, 0.42, 0.17], rough: 0.38, metal: 1 },
  wood_dark: { color: [0.085, 0.048, 0.026], rough: 0.55 },
  wood: { color: [0.2, 0.11, 0.055], rough: 0.6 },
  wood_pale: { color: [0.42, 0.3, 0.17], rough: 0.7 },
  paint_cream: { color: [0.6, 0.56, 0.45], rough: 0.65 },
  paint_grey: { color: [0.36, 0.37, 0.35], rough: 0.6 },
  paint_white: { color: [0.72, 0.7, 0.64], rough: 0.6 },
  stone: { color: [0.3, 0.29, 0.27], rough: 0.92 },
  cloth_white: { color: [0.7, 0.68, 0.62], rough: 0.95 },
  cloth_dark: { color: [0.05, 0.05, 0.055], rough: 0.95 },
  leather_brown: { color: [0.11, 0.045, 0.02], rough: 0.42 },
  felt_grey: { color: [0.2, 0.19, 0.18], rough: 0.95 },
  glass: { color: [0.62, 0.66, 0.64], rough: 0.08, alpha: 0.28 },
  paper: { color: [0.7, 0.66, 0.54], rough: 0.9 },
  bone: { color: [0.72, 0.66, 0.52], rough: 0.4 },
  meat: { color: [0.26, 0.06, 0.04], rough: 0.42 },
};

// PROPS TABLE START
const PROPS = [
  { key: 'phone_ornate', url: `${BASEMESH}/b36d2d_138889ed95904ab684df438492214e8c.zip?dn=vintage_rotary_phone.zip`, entry: 'vintage_rotary_phone.glb', paint: 'bakelite', scale: 0.62, parts: { vintage_rotary_phone: 'handset' } },
  { key: 'tv_retro', url: `${BASEMESH}/b36d2d_89c47f904bcd4dea841f342061ded465.zip?dn=retro_tv.zip`, entry: 'retro_tv.glb', paint: 'plastic_grey', parts: { screen: 'screen' }, width: 0.62 },
  { key: 'chair_plastic', url: `${BASEMESH}/b36d2d_2b7f7a69f4b24dff896c022fe671a347.zip?dn=plastic_chair_01.zip`, entry: 'plastic_chair_01.glb', paint: 'plastic_grey', height: 0.84 },
  { key: 'chair_ladder', url: `${BASEMESH}/b36d2d_6edb964142704a59b951d57d2f10e8df.zip?dn=dining_chair_01.zip`, entry: 'dining_chair_01.glb', paint: 'wood' },
  { key: 'bench_urban', url: `${BASEMESH}/b36d2d_0a94db87ca724aaba11426d55c8b3ec6.zip?dn=urban_bench_01.zip`, entry: 'urban_bench_01.glb', paint: 'iron_paint' },
  { key: 'bench_changing', url: `${BASEMESH}/b36d2d_2a4b14577893441496b64060946fecbf.zip?dn=changing_room_bench.zip`, entry: 'changing_room_bench.glb', paint: 'paint_grey' },
  { key: 'seats_row', url: `${PIZZA}/7a34ec4b-b314-4c30-b863-415883c3e1d2.glb`, mats: { mat17: 'iron_paint', mat19: 'plastic_bone' }, width: 1.65, turn: 90 },
  { key: 'seat_theatre', url: `${PIZZA}/a546c279-7ba4-4f24-a39b-eb06626fec39.glb`, mats: { mat8: 'cloth_dark', mat23: 'iron' }, height: 0.86 },
  { key: 'filing_cabinet', url: `${BASEMESH}/b36d2d_2a3044407b8f482b9e74dd7622307d2d.zip?dn=filing_cabinet.zip`, entry: 'filing_cabinet.glb', paint: 'paint_grey', parts: { filing_cabinet_drawer_01: 'drawer_1', filing_cabinet_drawer_02: 'drawer_2', filing_cabinet_drawer_03: 'drawer_3', filing_cabinet_drawer_04: 'drawer_4' } },
  { key: 'locker', url: `${BASEMESH}/b36d2d_398da6fb9a5d4583badb76aadf69fa3a.zip?dn=locker.zip`, entry: 'locker.glb', paint: 'paint_grey', parts: { locker_door_top: 'door_top', locker_door_bottom: 'door_bottom' } },
  { key: 'door_six', url: `${BASEMESH}/b36d2d_31995b393be74325afecb3232f09ad4f.zip?dn=door_04.zip`, entry: 'door_04.glb', paint: 'paint_cream' },
  { key: 'door_flush', url: `${BASEMESH}/b36d2d_f60fadc2f7de44c6931ce543eabd66af.zip?dn=door_05.zip`, entry: 'door_05.glb', paint: 'paint_grey' },
  { key: 'door_knob', url: `${BASEMESH}/b36d2d_e239afcdc1d54765abf3d78ccba47d24.zip?dn=door_knob.zip`, entry: 'doorknob.glb', paint: 'brass' },
  { key: 'door_frame', url: `${BASEMESH}/b36d2d_fd78cce3e7334d609bbf7b3bae65f14e.zip?dn=architrave_ogee.zip`, entry: 'architrave_ogee.glb', paint: 'paint_white' },
  { key: 'sink', url: `${BASEMESH}/b36d2d_4888c2def6f3440892aded5fec468ef3.zip?dn=sink_01.zip`, entry: 'sink_01.glb', paint: 'ceramic' },
  { key: 'tap', url: `${BASEMESH}/b36d2d_cef6f708caee4788ad4515b5f117f422.zip?dn=kitchen_tap.zip`, entry: 'kitchen_tap.glb', paint: 'steel' },
  { key: 'faucet', url: `${BASEMESH}/b36d2d_df2fefba1b584983a53d84e233e32c36.zip?dn=water_faucet_01.zip`, entry: 'water_faucet_01.glb', paint: 'steel_dull' },
  { key: 'soap_dispenser', url: `${BASEMESH}/b36d2d_91549d59ce434ddba4f9bf12bd21bafe.zip?dn=soap_dispenser.zip`, entry: 'soap_dispenser.glb', paint: 'plastic_bone' },
  { key: 'towel_ring', url: `${BASEMESH}/b36d2d_520a8e78f6254a30ace2af9f9be6e613.zip?dn=towel_holder.zip`, entry: 'towel_holder.glb', paint: 'steel' },
  { key: 'sink_drain', url: `${BASEMESH}/b36d2d_f2d0d546c2304770ac6732c782203e9f.zip?dn=sink_drain_01.zip`, entry: 'sink_drain_01.glb', paint: 'steel' },
  { key: 'drinking_fountain', url: `${BASEMESH}/b36d2d_e87ed419b32940a8b9e984ac25591f23.zip?dn=drinking_fountain.zip`, entry: 'drinking_fountain.glb', paint: 'steel_dull' },
  { key: 'toothbrush', url: `${BASEMESH}/b36d2d_cbfaee2754b74054afc0eb1f3d1234c9.zip?dn=toothbrush.zip`, entry: 'toothbrush.glb', paint: 'plastic_bone' },
  { key: 'comb', url: `${BASEMESH}/b36d2d_d59d6796338c417992545853555a724e.zip?dn=comb.zip`, entry: 'comb.glb', paint: 'bakelite' },
  { key: 'plate', url: `${BASEMESH}/b36d2d_8a920d64d2544dd7a230b1d9db1342cb.zip?dn=plate_01.zip`, entry: 'plate_01.glb', paint: 'ceramic' },
  { key: 'bowl', url: `${BASEMESH}/b36d2d_c63fd32c0bfa4b84910a7343c336a790.zip?dn=bowl_01.zip`, entry: 'bowl_01.glb', paint: 'ceramic' },
  { key: 'fork', url: `${BASEMESH}/b36d2d_36a59d76259c4f33af53cf1692b9d02f.zip?dn=fork.zip`, entry: 'fork.glb', paint: 'steel' },
  { key: 'knife', url: `${BASEMESH}/b36d2d_66e5c0aaeb3c453fb21bdcf769269038.zip?dn=butter_knife.zip`, entry: 'butter_knife.glb', paint: 'steel' },
  { key: 'spoon', url: `${BASEMESH}/b36d2d_54b49d6692c3489a88533459632253cd.zip?dn=spoon.zip`, entry: 'spoon.glb', paint: 'steel' },
  { key: 'mug', url: `${BASEMESH}/b36d2d_21e46a830496421cbcb190407eb6aac0.zip?dn=mug.zip`, entry: 'mug.glb', paint: 'ceramic' },
  { key: 'tumbler', url: `${BASEMESH}/b36d2d_1e795e801fae4ec38e72dfceb14a48b4.zip?dn=whiskey_glass.zip`, entry: 'whiskey_glass.glb', paint: 'glass' },
  { key: 'salt_shaker', url: `${BASEMESH}/b36d2d_42ae838c030a447f86dd04533574355a.zip?dn=salt_shaker_01.zip`, entry: 'salt_shaker_01.glb', paint: 'ceramic' },
  { key: 'bread_half', url: `${PIZZA}/10e99c2b-5dd7-4893-a210-af0088476ee4.glb`, height: 0.11 },
  { key: 'pillow', url: `${BASEMESH}/b36d2d_7407ed40798442ce87f669c5c6e5e12a.zip?dn=cushion_02.zip`, entry: 'cushion_02.glb', paint: 'cloth_white', scale: 1.3 },
  { key: 'hanger', url: `${BASEMESH}/b36d2d_843261c285b346e89076611823b0fea8.zip?dn=clothes_hanger_01.zip`, entry: 'clothes_hanger_01.glb', paint: 'wood_pale' },
  { key: 'coat_stand', url: `${BASEMESH}/b36d2d_7981bb681def4b58b7822db839f24f6f.zip?dn=coat_stand_01.zip`, entry: 'coat_stand_01.glb', paint: 'wood_dark' },
  { key: 'coat_hook', url: `${BASEMESH}/b36d2d_bce2bd4b535d44198a334611430b5623.zip?dn=double_coat_hook_01.zip`, entry: 'double_coat_hook_01.glb', paint: 'brass' },
  { key: 'fedora', url: `${BASEMESH}/b36d2d_bbd3d62768b441c0b9e6a4390cdd7425.zip?dn=fedora.zip`, entry: 'fedora.glb', paint: 'felt_grey' },
  { key: 'boot_felt', url: `${BASEMESH}/b36d2d_3bc6c230f8d54462b85c67cc345125b4.zip?dn=sheepskin_boot.zip`, entry: 'sheepskin_boot.glb', paint: 'felt_grey' },
  { key: 'sandal', url: `${BASEMESH}/b36d2d_54c7d4368c2f4fa2a2a392fa79e21d59.zip?dn=sandal_01.zip`, entry: 'sandal_01.glb', paint: 'leather_brown' },
  { key: 'shoes_leather', url: `${PIZZA}/ce8465ac-c14d-4a86-b312-d7e8b5da6b80.glb`, depth: 0.3 },
  { key: 'slippers', url: `${PIZZA}/69d4f7cf-6eb6-42bb-8477-761d2dd9ce24.glb`, width: 0.3 },
  { key: 'booties', url: `${PIZZA}/8e56ff49-c0ff-40b3-bc30-9b7b2038db44.glb`, width: 0.14 },
  { key: 'tweezers', url: `${BASEMESH}/b36d2d_3c90be78c3444a2bbc55790ce42bde20.zip?dn=tweezers.zip`, entry: 'tweezers.glb', paint: 'steel' },
  { key: 'pliers', url: `${BASEMESH}/b36d2d_16d9f984b56542e7814119283fb3691c.zip?dn=pliers.zip`, entry: 'pliers.glb', paint: 'steel', parts: { pliers_left_handle: 'handle' } },
  { key: 'molar', url: `${BASEMESH}/b36d2d_84ac9be36f5842c49b774cf1e92567f0.zip?dn=tooth_molar.zip`, entry: 'tooth_molar.glb', paint: 'bone', scale: 1.0 },
  { key: 'molar_low', url: `${BASEMESH}/b36d2d_84ac9be36f5842c49b774cf1e92567f0.zip?dn=tooth_molar.zip`, entry: 'tooth_molar.glb', paint: 'bone', source: 'molar' },
  { key: 'syringe', url: `${PIZZA}/c5127c4c-320c-4a52-aaf0-5ca79ddafbfb.glb`, height: 0.14 },
  { key: 'dental_mirror', url: `${PIZZA}/c9b82205-6f6e-46ec-8366-bc127e201c27.glb`, long: 0.16, paint: 'steel' },
  { key: 'scalpel', url: `${PIZZA}/599a2561-157a-475b-93ce-5c1806bea477.glb`, long: 0.15, mats: { _crayfishdiffuse: 'steel', '03___Default': 'steel', '02___Default': 'steel' } },
  { key: 'tube_light', url: `${BASEMESH}/b36d2d_6d960778ebd148e6abe86dc75d3e82cf.zip?dn=fluorescent_light.zip`, entry: 'fluorescent_light.glb', paint: 'paint_white', parts: { fluorescent_lightbulb: 'tube' }, width: 1.2 },
  { key: 'lamp_floor', url: `${PIZZA}/9f195509-33d8-41bb-9f06-b442d1610b92.glb`, height: 1.7 },
  { key: 'radiator', url: `${BASEMESH}/b36d2d_887c4821eda342e2b27adcf6b220e6f7.zip?dn=iron_radiator.zip`, entry: 'iron_radiator.glb', paint: 'iron_paint' },
  { key: 'baluster_turned', url: `${BASEMESH}/b36d2d_4cc8a0affed248548db293d25ac3f1b4.zip?dn=baluster_oxford.zip`, entry: 'baluster_oxford.glb', paint: 'wood_dark', height: 0.86 },
  { key: 'newel_cap', url: `${BASEMESH}/b36d2d_6ae27da43401451f9fb502ac79c7a591.zip?dn=newel_cap_01.zip`, entry: 'newel_cap_01.glb', paint: 'wood_dark' },
  { key: 'handrail', url: `${BASEMESH}/b36d2d_6cb2090880ce42cdb4265659f683014b.zip?dn=stair_handrail_profile_01.zip`, entry: 'stair_handrail_profile_01.glb', paint: 'wood_dark' },
  { key: 'vent_cover', url: `${BASEMESH}/b36d2d_9a8340205618469eab848b046d883134.zip?dn=vent_cover_01.zip`, entry: 'vent_cover_01.glb', paint: 'steel_dull' },
  { key: 'air_vent', url: `${BASEMESH}/b36d2d_90e29da8c4ae43c98074ec7e7da5a8b5.zip?dn=air_vent_01.zip`, entry: 'air_vent_01.glb', paint: 'steel_dull' },
  { key: 'drain_grate', url: `${BASEMESH}/b36d2d_5b5eedca0f4a477ba5b393e65c086874.zip?dn=drainage_grate_01.zip`, entry: 'drainage_grate_01.glb', paint: 'iron' },
  { key: 'light_switch', url: `${BASEMESH}/b36d2d_e78030949525409d877f885d2b58d06e.zip?dn=light_switch_01.zip`, entry: 'light_switch_01.glb', paint: 'plastic_bone' },
  { key: 'window_wood', url: `${PIZZA}/c192dca1-715c-4a12-ab93-cd921d6c572d.glb`, height: 1.5, mats: { lambert8SG: 'wood_dark', lambert10SG: 'wood_dark' } },
  { key: 'curtains', url: `${PIZZA}/916e6097-7598-470e-80db-8436c300ee48.glb`, height: 2.3, paint: 'cloth_dark', double: true },
  { key: 'staircase', url: `${PIZZA}/7fde4c0e-8a4e-4709-b50f-67df1a270523.glb`, height: 2.9 },
  { key: 'pool_ladder', url: `${BASEMESH}/b36d2d_b14d949a13774037acfe74268edebf79.zip?dn=pool_ladder_01.zip`, entry: 'pool_ladder_01.glb', paint: 'steel' },
  { key: 'bus_shelter', url: `${PIZZA}/7a1ec2af-89e6-4785-976f-7c0991608a88.glb`, height: 2.6, paint: 'iron_paint' },
  { key: 'bus_city', url: `${PIZZA}/acc9ab7a-ed54-4c1c-adb1-f5fe161eebd5.glb`, long: 11.0, turn: 45 },
  { key: 'coffin', url: `${BASEMESH}/b36d2d_1c9d1e8d905842f4a9995bc8d5f375d8.zip?dn=coffin_01.zip`, entry: 'coffin_01.glb', paint: 'wood_dark' },
  { key: 'coffin_lid', url: `${BASEMESH}/b36d2d_39518386517f4132a9da64b1de1567ad.zip?dn=coffin_lid_01.zip`, entry: 'coffin_lid_01.glb', paint: 'wood_dark' },
  { key: 'urn', url: `${BASEMESH}/b36d2d_4c5221389b4a46a389641fead14f506d.zip?dn=urn_01.zip`, entry: 'urn_01.glb', paint: 'stone' },
  { key: 'vase', url: `${BASEMESH}/b36d2d_a66f4a43b7704ad586ea451aecc3bb7f.zip?dn=flower_vase_01.zip`, entry: 'flower_vase_01.glb', paint: 'ceramic' },
  { key: 'easel', url: `${PIZZA}/a092d765-621a-4059-b53b-b4a8d3f1aed8.glb`, height: 1.75, paint: 'wood' },
  { key: 'roses', url: `${PIZZA}/b622d8cb-e9e2-46c0-8efc-fb1374700e11.glb`, long: 0.42, mats: { mat8: 'meat', mat9: 'cloth_dark' } },
  { key: 'horn_bulb', url: `${BASEMESH}/b36d2d_16f255167d1944f1a2c62c0900053ea4.zip?dn=honk_honk_horn.zip`, entry: 'honk_honk_horn.glb', paint: 'brass' },
  { key: 'cake_stand', url: `${BASEMESH}/b36d2d_6d213bda22a54e9eb3fef3eee44da618.zip?dn=cake_stand.zip`, entry: 'cake_stand.glb', paint: 'ceramic' },
  { key: 'gramophone', url: `${PIZZA}/3436ca32-2562-4edd-9258-8b93c5c3f9b6.glb`, height: 0.62 },
  { key: 'dolly_peg', url: `${BASEMESH}/b36d2d_f9037ba034c74cac8e1d19715beb4e24.zip?dn=wooden_dolly_peg.zip`, entry: 'wooden_dolly_peg.glb', paint: 'wood_pale' },
  { key: 'bell_service', url: `${BASEMESH}/b36d2d_27c2257612d24b63bffa99238e261807.zip?dn=service_bell.zip`, entry: 'service_bell.glb', paint: 'brass' },
  { key: 'ticket_stub', url: `${BASEMESH}/b36d2d_d0b1b34872184e12bb18765d3418f746.zip?dn=ticket_stub.zip`, entry: 'ticket_stub.glb', paint: 'paper' },
  { key: 'pencil', url: `${BASEMESH}/b36d2d_7795547c7676474cbf4b7f83d9806c8b.zip?dn=pencil_01.zip`, entry: 'pencil_01.glb', paint: 'wood_pale' },
  { key: 'noticeboard', url: `${BASEMESH}/b36d2d_5344880205fe47539a9e874ff9da15b8.zip?dn=noticeboard_01.zip`, entry: 'noticeboard_01.glb', paint: 'wood' },
  { key: 'bucket', url: `${BASEMESH}/b36d2d_b7557eb4653a4f4e9a87d5833c5501ad.zip?dn=bucket.zip`, entry: 'bucket.glb', paint: 'steel_dull' },
  { key: 'roach', url: `${PIZZA}/1a4aec55-200b-438c-90f2-293be4f0da09.glb`, long: 0.09, rough: 0.32 },
  { key: 'fly', url: `${PIZZA}/afd2f2cd-8a36-49e4-9d18-5bb7dd657e8d.glb`, long: 0.012, mats: { White: 'glass', Orange: 'iron', Dark_Green: 'bakelite', Black: 'bakelite' } },
  { key: 'fridge', url: `${PIZZA}/c97d5699-bcfe-40b8-894b-8b77419f0cb1.glb`, height: 1.62, parts: { Environment_Fridge_Door: 'door' }, tint: { saturation: 0.12, brightness: 1.15 } },
  { key: 'iv_stand', url: `${PIZZA}/d8989cd8-33d1-49a1-8139-31215dbdcf84.glb`, source: 'gradd', pick: 'IV_Bag_Holder_001_1', scale: 0.0254 },
  { key: 'monitor_ecg', url: `${PIZZA}/d8989cd8-33d1-49a1-8139-31215dbdcf84.glb`, source: 'gradd', pick: 'Monitor_Wall_Mount_and_Arm_001_1', scale: 0.0254 },
  { key: 'xray_light', url: `${PIZZA}/d8989cd8-33d1-49a1-8139-31215dbdcf84.glb`, source: 'gradd', pick: 'X_Ray_Viewing_Light_001', scale: 0.0254 },
  { key: 'stage_light', url: `${PIZZA}/164d67f5-1d1f-4f57-b4ae-3aeedf6172f3.glb`, height: 0.42 },
  { key: 'shark', url: `${PIZZA}/d2d374ea-eb1d-4659-8cc7-816a83b82470.glb`, long: 6, rig: true },
];
// PROPS TABLE END

/** A faint stain that repeats every meter. */
function stainImage() {
  const size = 128;
  const seed = (x, y, p) => {
    const s = Math.sin((((x % p) + p) % p) * 127.1 + (((y % p) + p) % p) * 311.7 + p * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const raw = Buffer.alloc(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let weight = 0.5;
      for (const p of [6, 12, 24, 48]) {
        const fx = (x / size) * p;
        const fy = (y / size) * p;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = smooth(fx - ix);
        const ty = smooth(fy - iy);
        const a = seed(ix, iy, p) * (1 - tx) + seed(ix + 1, iy, p) * tx;
        const b = seed(ix, iy + 1, p) * (1 - tx) + seed(ix + 1, iy + 1, p) * tx;
        v += (a * (1 - ty) + b * ty) * weight;
        weight *= 0.5;
      }
      raw[y * size + x] = Math.round(255 * Math.min(1, 0.72 + v * 0.3));
    }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 1 } }).png().toBuffer();
}

/** Every triangle takes its UVs from the plane it faces most: meters, whatever the file's unwrap was. */
function boxUvs(doc, prim) {
  const pos = prim.getAttribute('POSITION');
  const nor = prim.getAttribute('NORMAL');
  const idx = prim.getIndices();
  const count = idx ? idx.getCount() : pos.getCount();
  const P = new Float32Array(count * 3);
  const N = new Float32Array(count * 3);
  const U = new Float32Array(count * 2);
  const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const n = [0, 0, 0];
  for (let t = 0; t < count; t += 3) {
    for (let k = 0; k < 3; k++) pos.getElement(idx ? idx.getScalar(t + k) : t + k, c[k]);
    const [a, b, d] = c;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = d[0] - a[0];
    const vy = d[1] - a[1];
    const vz = d[2] - a[2];
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    const ax = Math.abs(fx);
    const ay = Math.abs(fy);
    const az = Math.abs(fz);
    const l = Math.hypot(fx, fy, fz) || 1;
    for (let k = 0; k < 3; k++) {
      const v = t + k;
      P.set(c[k], v * 3);
      if (nor) {
        nor.getElement(idx ? idx.getScalar(v) : v, n);
        N.set(n, v * 3);
      } else N.set([fx / l, fy / l, fz / l], v * 3);
      if (ax >= ay && ax >= az) U.set([c[k][2], c[k][1]], v * 2);
      else if (ay >= az) U.set([c[k][0], c[k][2]], v * 2);
      else U.set([c[k][0], c[k][1]], v * 2);
    }
  }
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  prim.setIndices(null);
  for (const semantic of prim.listSemantics()) prim.setAttribute(semantic, null);
  prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buffer));
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N).setBuffer(buffer));
  prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(U).setBuffer(buffer));
}

function quatMultiply(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function quatFromEuler(x = 0, y = 0, z = 0) {
  const axis = (i, deg) => {
    const q = [0, 0, 0, Math.cos((deg * Math.PI) / 360)];
    q[i] = Math.sin((deg * Math.PI) / 360);
    return q;
  };
  return quatMultiply(axis(1, y), quatMultiply(axis(0, x), axis(2, z)));
}

async function propSource(item) {
  const isZip = item.url.includes('.zip');
  const glb = path.join(SRC, `prop_${item.source ?? item.key}.glb`);
  if (fs.existsSync(glb) && fs.statSync(glb).size > 0) return glb;
  const res = await fetch(item.url, { headers: { 'User-Agent': 'the-dream-of-the-photo asset pipeline (dev tool)' } });
  if (!res.ok) throw new Error(`${res.status} ${item.url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!isZip) fs.writeFileSync(glb, bytes);
  else {
    const entries = unzipSync(bytes);
    const name = Object.keys(entries).find((n) => n.split('/').pop() === item.entry);
    if (!name) throw new Error(`${item.entry} not in ${item.url}`);
    fs.writeFileSync(glb, entries[name]);
  }
  return glb;
}

let stain = null;

async function writeProp(item) {
  const doc = await io.read(await propSource(item));
  const root = doc.getRoot();
  for (const e of root.listExtensionsUsed()) if (e.extensionName === 'KHR_draco_mesh_compression' || e.extensionName === 'EXT_meshopt_compression') e.dispose();
  const scene = root.listScenes()[0];
  for (const light of root.listNodes()) if (light.getExtension('KHR_lights_punctual')) light.setExtension('KHR_lights_punctual', null);
  if (item.pick || item.drop) {
    const pick = item.pick ? new RegExp(item.pick) : null;
    const drop = item.drop ? new RegExp(item.drop) : null;
    for (const n of root.listNodes()) {
      if (!n.getMesh()) continue;
      const name = n.getName();
      if ((pick && !pick.test(name)) || (drop && drop.test(name))) n.setMesh(null);
    }
  }
  const upright = doc.createNode('upright').setRotation(quatMultiply(quatFromEuler(0, item.turn ?? 0, 0), quatMultiply(UP_ROTATION[item.up ?? 'y'], quatFromEuler(...(item.rotate ?? [0, 0, 0])))));
  for (const c of scene.listChildren()) {
    scene.removeChild(c);
    upright.addChild(c);
  }
  scene.addChild(upright);
  const b = getBounds(scene);
  const size = b.max.map((v, i) => v - b.min[i]);
  const s = item.scale ?? (item.height ? item.height / size[1] : item.width ? item.width / size[0] : item.depth ? item.depth / size[2] : item.long ? item.long / Math.max(...size) : 1);
  const wrap = doc.createNode('wrap').setScale([s, s, s]).setTranslation([-((b.min[0] + b.max[0]) / 2) * s, -b.min[1] * s, -((b.min[2] + b.max[2]) / 2) * s]);
  scene.removeChild(upright);
  wrap.addChild(upright);
  scene.addChild(wrap);
  if (item.rig) {
    await doc.transform(dedup(), prune());
    await io.write(path.join(OUT, `${item.key}.glb`), doc);
    console.log(`${item.key.padEnd(20)} rigged, ${root.listAnimations().map((a) => a.getName()).join(', ')}`);
    return;
  }
  await doc.transform(flatten({ cleanup: false }));

  // into meters, in the model's own space: each part's node is left with no transform of its own
  const uses = new Map();
  for (const node of scene.listChildren()) {
    const mesh = node.getMesh();
    if (mesh) uses.set(mesh, (uses.get(mesh) ?? 0) + 1);
  }
  for (const node of scene.listChildren()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    if (uses.get(mesh) > 1) node.setMesh(mesh.clone());
    clearNodeTransform(node);
  }

  const parts = item.parts ?? {};
  const whole = doc.createMesh(item.key);
  for (const node of [...scene.listChildren()]) {
    const mesh = node.getMesh();
    if (mesh && parts[node.getName()]) {
      const name = parts[node.getName()];
      node.setName(name);
      mesh.setName(name);
      continue;
    }
    if (mesh) for (const prim of mesh.listPrimitives()) whole.addPrimitive(prim);
    node.dispose();
  }
  if (whole.listPrimitives().length) scene.addChild(doc.createNode(item.key).setMesh(whole));

  // the look
  const looks = new Map();
  const lookMaterial = async (name) => {
    if (looks.has(name)) return looks.get(name);
    const look = LOOKS[name];
    if (!stain) stain = await stainImage();
    const material = doc.createMaterial(name).setBaseColorFactor([...look.color, look.alpha ?? 1]).setRoughnessFactor(look.rough).setMetallicFactor(look.metal ?? 0);
    material.setBaseColorTexture(doc.createTexture(`${name}_stain`).setImage(new Uint8Array(stain)).setMimeType('image/png'));
    if (look.alpha) material.setAlphaMode('BLEND');
    looks.set(name, material);
    return material;
  };
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const was = prim.getMaterial();
      const look = item.paint ?? item.mats?.[was?.getName()];
      if (!look) continue;
      prim.setMaterial(await lookMaterial(look));
      boxUvs(doc, prim);
    }
  }
  if (item.tint) {
    for (const texture of new Set(root.listMaterials().map((m) => m.getBaseColorTexture()).filter(Boolean))) {
      const png = await sharp(Buffer.from(texture.getImage())).modulate({ saturation: item.tint.saturation ?? 1, brightness: item.tint.brightness ?? 1 }).png().toBuffer();
      texture.setImage(new Uint8Array(png)).setMimeType('image/png');
    }
  }
  if (item.double) for (const m of root.listMaterials()) m.setDoubleSided(true);
  if (item.rough !== undefined) for (const m of root.listMaterials()) m.setRoughnessFactor(item.rough).setMetallicFactor(0);
  await doc.transform(join({ keepMeshes: true, keepNamed: false, cleanup: false }), dedup(), prune());
  await io.write(path.join(OUT, `${item.key}.glb`), doc);
  let tris = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  const e = getBounds(scene);
  console.log(`${item.key.padEnd(20)} ${Math.round(tris)} tris, ${e.max.map((v, i) => (v - e.min[i]).toFixed(3)).join(' x ')} m, ${root.listNodes().length} nodes`);
}

for (const item of PROPS) {
  if (only && !only.has(item.key)) continue;
  await writeProp(item);
}

// ------------------------------------------------------------------ a Blender 2.49 file: the spider

/** Reads a .blend of that age as data: its meshes (with UVs and vertex normals) and the objects that place them. */
function readOldBlend(b) {
  const pointer = b[7] === 0x2d ? 8 : 4;
  const readPointer = (o) => (pointer === 8 ? Number(b.readBigUInt64LE(o)) : b.readUInt32LE(o));
  const blocks = [];
  const byPointer = new Map();
  for (let o = 12; o + 16 + pointer <= b.length; ) {
    const code = b.toString('latin1', o, o + 4);
    const size = b.readInt32LE(o + 4);
    const block = { code, size, old: readPointer(o + 8), dna: b.readInt32LE(o + 8 + pointer), count: b.readInt32LE(o + 12 + pointer), at: o + 16 + pointer };
    blocks.push(block);
    byPointer.set(block.old, block);
    o = block.at + size;
    if (code === 'ENDB') break;
  }
  let o = blocks.find((x) => x.code === 'DNA1').at + 8;
  const strings = () => {
    const n = b.readInt32LE(o);
    o += 4;
    const out = [];
    for (let i = 0; i < n; i++) {
      const e = b.indexOf(0, o);
      out.push(b.toString('latin1', o, e));
      o = e + 1;
    }
    o = (o + 3) & ~3;
    return out;
  };
  const names = strings();
  o += 4;
  const types = strings();
  o += 4;
  const lengths = [];
  for (let i = 0; i < types.length; i++, o += 2) lengths.push(b.readInt16LE(o));
  o = (o + 3) & ~3;
  o += 4;
  const structCount = b.readInt32LE(o);
  o += 4;
  const structs = [];
  const byName = {};
  for (let i = 0; i < structCount; i++) {
    const typeIndex = b.readInt16LE(o);
    const fieldCount = b.readInt16LE(o + 2);
    o += 4;
    const fields = {};
    let offset = 0;
    for (let f = 0; f < fieldCount; f++, o += 4) {
      const name = names[b.readInt16LE(o + 2)];
      const dims = [...name.matchAll(/\[(\d+)\]/g)].reduce((m, d) => m * Number(d[1]), 1);
      const size = (/[*(]/.test(name) ? pointer : lengths[b.readInt16LE(o)]) * dims;
      fields[name.replace(/\[.*/, '').replace(/[*()]/g, '')] = offset;
      offset += size;
    }
    structs.push({ type: types[typeIndex], fields, size: lengths[typeIndex] });
    byName[types[typeIndex]] = structs[structs.length - 1];
  }
  const ofType = (type) => blocks.filter((x) => x.dna >= 0 && x.dna < structs.length && structs[x.dna].type === type && x.code !== 'DNA1' && x.code !== 'ENDB');
  const meshes = new Map();
  const M = byName.Mesh.fields;
  const V = byName.MVert;
  const F = byName.MFace;
  const T = byName.MTFace;
  // only two of the legs kept their UVs: the others are copies of them, face for face
  const uvsOfSize = new Map();
  for (const block of ofType('Mesh')) {
    const uvs = readPointer(block.at + M.mtface);
    if (uvs) uvsOfSize.set(byPointer.get(uvs).count, byPointer.get(uvs));
  }
  for (const block of ofType('Mesh')) {
    const verts = byPointer.get(readPointer(block.at + M.mvert));
    const faces = byPointer.get(readPointer(block.at + M.mface));
    const uvs = uvsOfSize.get(faces.count);
    const position = (i) => [0, 4, 8].map((k) => b.readFloatLE(verts.at + i * V.size + V.fields.co + k));
    const normal = (i) => [0, 2, 4].map((k) => b.readInt16LE(verts.at + i * V.size + V.fields.no + k) / 32767);
    const corners = [];
    for (let i = 0; i < faces.count; i++) {
      const v = ['v1', 'v2', 'v3', 'v4'].map((k) => b.readInt32LE(faces.at + i * F.size + F.fields[k]));
      const uv = [0, 1, 2, 3].map((k) => [b.readFloatLE(uvs.at + i * T.size + T.fields.uv + k * 8), 1 - b.readFloatLE(uvs.at + i * T.size + T.fields.uv + k * 8 + 4)]);
      for (const k of v[3] ? [0, 1, 2, 0, 2, 3] : [0, 1, 2]) corners.push({ p: position(v[k]), n: normal(v[k]), uv: uv[k] });
    }
    meshes.set(block.old, corners);
  }
  const objects = [];
  for (const block of ofType('Object')) {
    const corners = meshes.get(readPointer(block.at + byName.Object.fields.data));
    if (!corners) continue;
    const matrix = [];
    for (let i = 0; i < 16; i++) matrix.push(b.readFloatLE(block.at + byName.Object.fields.obmat + i * 4));
    objects.push({ corners, matrix });
  }
  return objects;
}

/** Up is Z in that file; the spider's nose turns to +Z. */
const blendPoint = (m, [x, y, z], w = 1) => {
  const p = [x * m[0] + y * m[4] + z * m[8] + w * m[12], x * m[1] + y * m[5] + z * m[9] + w * m[13], x * m[2] + y * m[6] + z * m[10] + w * m[14]];
  return [-p[0], p[2], -p[1]];
};

/**
 * The spider by p0ss: a body and eight legs. In `spider` each leg hangs from a node at its hip, named leg_L1 .. leg_L4 and leg_R1 .. leg_R4
 * (its own left and right, front to back), so that a leg turns about its hip. In `spider_low` it is all one mesh, for a crowd.
 */
const SPIDER = { blend: `${OGA}/spider-textured.blend`, textures: `${OGA}/spider_textures.zip`, span: 0.2, lowBody: 90, lowLeg: 24 };

async function writeSpider(key, merged) {
  const objects = readOldBlend(fs.readFileSync(await fetchSource(SPIDER.blend)));
  const entries = unzipSync(new Uint8Array(fs.readFileSync(await fetchSource(SPIDER.textures))));
  const image = (name) => Buffer.from(entries[Object.keys(entries).find((n) => n.split('/').pop() === name)]);
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const object of objects) {
    for (const c of object.corners) {
      const p = blendPoint(object.matrix, c.p);
      min = min.map((v, i) => Math.min(v, p[i]));
      max = max.map((v, i) => Math.max(v, p[i]));
    }
  }
  const s = SPIDER.span / Math.max(max[0] - min[0], max[2] - min[2]);
  const place = (p) => [(p[0] - (min[0] + max[0]) / 2) * s, (p[1] - min[1]) * s, (p[2] - (min[2] + max[2]) / 2) * s];
  const doc = new Document();
  const buffer = doc.createBuffer();
  const texture = (name, png) => doc.createTexture(name).setImage(new Uint8Array(png)).setMimeType('image/png');
  const material = (name, color, normal) => doc.createMaterial(name).setRoughnessFactor(0.58).setMetallicFactor(0).setBaseColorTexture(texture(`${name}_color`, image(color))).setNormalTexture(texture(`${name}_normal`, image(normal)));
  const bodyMaterial = material('spider_body', 'Spider-body-brown-tex.png', 'Spider-body-nm.png');
  const legMaterial = material('spider_leg', 'Spider-leg-brown-tex.png', 'Spider-leg-nm.png');
  const primitive = (corners, m, origin) => {
    const P = new Float32Array(corners.length * 3);
    const N = new Float32Array(corners.length * 3);
    const U = new Float32Array(corners.length * 2);
    corners.forEach((c, i) => {
      const at = place(blendPoint(m, c.p));
      P.set(at.map((v, k) => v - origin[k]), i * 3);
      const d = blendPoint(m, c.n, 0);
      const l = Math.hypot(...d) || 1;
      N.set(d.map((v) => v / l), i * 3);
      U.set(c.uv, i * 2);
    });
    return doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(U).setBuffer(buffer));
  };
  const scene = doc.createScene();
  const body = objects.reduce((a, c) => (c.corners.length > a.corners.length ? c : a));
  const legs = objects.filter((o) => o !== body).map((o) => {
    const points = o.corners.map((c) => place(blendPoint(o.matrix, c.p)));
    const tip = points.reduce((a, p) => (Math.hypot(p[0], p[2]) > Math.hypot(a[0], a[2]) ? p : a));
    // the hip is where the leg enters the body, its end nearest the body's axis (the file's own origin lies under the body, 5 cm too low)
    const inner = [...points].sort((a, b) => Math.hypot(a[0], a[2]) - Math.hypot(b[0], b[2])).slice(0, 12);
    return { object: o, tip, hip: [0, 1, 2].map((k) => inner.reduce((sum, p) => sum + p[k], 0) / inner.length) };
  });
  if (merged) {
    // welded and crushed part by part, or the thin legs would go first; one plain material, one draw
    const positions = [];
    const index = [];
    const crush = (corners, m, tris) => {
      const seen = new Map();
      const p = [];
      const i = [];
      for (const c of corners) {
        const at = place(blendPoint(m, c.p));
        const k = at.join();
        if (!seen.has(k)) {
          seen.set(k, p.length / 3);
          p.push(...at);
        }
        i.push(seen.get(k));
      }
      const [kept] = MeshoptSimplifier.simplify(new Uint32Array(i), new Float32Array(p), 3, tris * 3, 0.5);
      const base = positions.length / 3;
      positions.push(...p);
      for (const v of kept) index.push(v + base);
    };
    crush(body.corners, body.matrix, SPIDER.lowBody);
    for (const leg of legs) crush(leg.object.corners, leg.object.matrix, SPIDER.lowLeg);
    await writeMesh(key, { positions: new Float32Array(positions), index: new Uint32Array(index) });
    // spider_low color: near black, and a little glossy
    const low = await io.read(path.join(OUT, `${key}.glb`));
    low.getRoot().listMaterials()[0].setBaseColorFactor([0.018, 0.014, 0.012, 1]).setRoughnessFactor(0.45);
    await io.write(path.join(OUT, `${key}.glb`), low);
    return;
  }
  {
    scene.addChild(doc.createNode('body').setMesh(doc.createMesh('body').addPrimitive(primitive(body.corners, body.matrix, [0, 0, 0]).setMaterial(bodyMaterial))));
    for (const side of [1, -1]) {
      legs.filter((l) => Math.sign(l.tip[0]) === side).sort((a, b) => b.tip[2] - a.tip[2]).forEach((leg, n) => {
        const name = `leg_${side > 0 ? 'L' : 'R'}${n + 1}`;
        const hip = doc.createNode(name).setTranslation(leg.hip);
        hip.addChild(doc.createNode(`${name}_mesh`).setMesh(doc.createMesh(`${name}_mesh`).addPrimitive(primitive(leg.object.corners, leg.object.matrix, leg.hip).setMaterial(legMaterial))));
        scene.addChild(hip);
      });
    }
  }
  await new NodeIO().write(path.join(OUT, `${key}.glb`), doc);
  const e = getBounds(scene);
  console.log(`${key.padEnd(20)} ${e.max.map((v, i) => (v - e.min[i]).toFixed(3)).join(' x ')} m`);
}

for (const [key, merged] of [['spider', false], ['spider_low', true]]) {
  if (only && !only.has(key)) continue;
  await writeSpider(key, merged);
}
