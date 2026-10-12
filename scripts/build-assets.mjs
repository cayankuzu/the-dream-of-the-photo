/**
 * Asset pipeline: downloads the free (CC0) source assets listed in scripts/assets.json,
 * optimizes them for the browser and writes them to public/.
 *
 *   models    -> public/models/<key>.glb      (pruned, welded, meshopt-compressed, WebP textures)
 *   materials -> public/textures/<key>_{color,normal,orm}.webp
 *   hdris     -> public/hdri/<key>.hdr
 *
 * Sources are cached in .asset-cache/ (gitignored). Run: npm run assets [-- --only key1,key2]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, resample, textureCompress, meshopt, simplify } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.asset-cache');
const OUT = path.join(ROOT, 'public');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/assets.json'), 'utf8'));
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null;
const wanted = (key) => !only || only.has(key);

for (const dir of ['models', 'textures', 'hdri']) fs.mkdirSync(path.join(OUT, dir), { recursive: true });

const HEADERS = { 'User-Agent': 'the-dream-of-the-photo asset pipeline' };

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function json(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const kb = (file) => `${(fs.statSync(file).size / 1024).toFixed(0)} KB`;

// ------------------------------------------------------------------ models

async function polyhavenModel(item) {
  const files = await json(`https://api.polyhaven.com/files/${item.id}`);
  const entry = files.gltf[item.res ?? '1k'].gltf;
  const dir = path.join(CACHE, 'polyhaven', item.id, item.res ?? '1k');
  const gltfFile = await download(entry.url, path.join(dir, path.basename(entry.url)));
  await Promise.all(Object.entries(entry.include ?? {}).map(([rel, f]) => download(f.url, path.join(dir, rel))));
  return gltfFile;
}

async function processModel(item) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
  });
  await MeshoptEncoder.ready;
  // 'local' sources are produced by another tool (the character converter, see scripts/character/)
  const src = item.source === 'local' ? path.join(ROOT, item.path) : await polyhavenModel(item);
  const doc = await io.read(src);
  const root = doc.getRoot();

  // keep only the modules we compose with (modular kits ship dozens of variants)
  if (item.keep) {
    const keep = item.keep.map((k) => new RegExp(`^${k}$`));
    for (const node of root.listNodes()) {
      const name = node.getName();
      const isKept = keep.some((re) => re.test(name));
      const hasKeptDescendant = (n) => n.listChildren().some((c) => keep.some((re) => re.test(c.getName())) || hasKeptDescendant(c));
      if (!isKept && !hasKeptDescendant(node) && node.getMesh()) node.dispose();
    }
  }
  // modular kits: modules are laid out side by side in the source; put every module at the origin
  // so its node transform only carries the (meshopt) dequantization afterwards
  if (item.zeroNodeTranslations) for (const node of root.listScenes()[0].listChildren()) node.setTranslation([0, 0, 0]);

  const transforms = [dedup(), prune({ keepAttributes: false }), weld()];
  if (item.simplify) transforms.push(simplify({ simplifier: MeshoptSimplifier, ratio: item.simplify, error: item.simplifyError ?? 0.002 }));
  transforms.push(
    resample(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [item.textureSize ?? 1024, item.textureSize ?? 1024], quality: 82 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await doc.transform(...transforms);
  const out = path.join(OUT, 'models', `${item.key}.glb`);
  await io.write(out, doc);
  console.log(`model    ${item.key.padEnd(34)} ${kb(out)}`);
}

// ------------------------------------------------------------------ materials

async function writeSet(key, size, color, normal, orm) {
  const base = path.join(OUT, 'textures', key);
  await sharp(color).resize(size, size).webp({ quality: 84 }).toFile(`${base}_color.webp`);
  await sharp(normal).resize(size, size).webp({ quality: 90 }).toFile(`${base}_normal.webp`);
  await sharp(orm).resize(size, size).webp({ quality: 88 }).toFile(`${base}_orm.webp`);
  console.log(`material ${key.padEnd(34)} ${kb(`${base}_color.webp`)} + ${kb(`${base}_normal.webp`)} + ${kb(`${base}_orm.webp`)}`);
}

/** Pack AO / roughness / metalness into one ORM image (missing maps get neutral values). */
async function packOrm(size, ao, rough, metal) {
  const channel = async (file, fallback) =>
    file
      ? sharp(file).resize(size, size).greyscale().extractChannel(0).raw().toBuffer()
      : Buffer.alloc(size * size, fallback);
  const [r, g, b] = await Promise.all([channel(ao, 255), channel(rough, 200), channel(metal, 0)]);
  const rgb = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    rgb[i * 3] = r[i];
    rgb[i * 3 + 1] = g[i];
    rgb[i * 3 + 2] = b[i];
  }
  return sharp(rgb, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

async function polyhavenMaterial(item) {
  const files = await json(`https://api.polyhaven.com/files/${item.id}`);
  const res = item.res ?? '1k';
  const dir = path.join(CACHE, 'polyhaven-tex', item.id, res);
  const get = async (map) => {
    const entry = files[map]?.[res]?.jpg ?? files[map]?.[res]?.png;
    return entry ? download(entry.url, path.join(dir, path.basename(entry.url))) : null;
  };
  const [color, normal, arm, rough, ao] = await Promise.all([get('Diffuse'), get('nor_gl'), get('arm'), get('Rough'), get('AO')]);
  const size = item.size ?? 1024;
  const orm = arm ?? (await packOrm(size, ao, rough, null));
  await writeSet(item.key, size, color, normal, orm);
}

async function ambientcgMaterial(item) {
  const res = item.res ?? '1K';
  const zipUrl = `https://ambientcg.com/get?file=${item.id}_${res}-JPG.zip`;
  const zipFile = await download(zipUrl, path.join(CACHE, 'ambientcg', `${item.id}_${res}.zip`));
  const entries = unzipSync(new Uint8Array(fs.readFileSync(zipFile)));
  const find = (suffix) => {
    const name = Object.keys(entries).find((n) => n.endsWith(`_${suffix}.jpg`) || n.endsWith(`_${suffix}.png`));
    return name ? Buffer.from(entries[name]) : null;
  };
  const size = item.size ?? 1024;
  const orm = await packOrm(size, find('AmbientOcclusion'), find('Roughness'), find('Metalness'));
  await writeSet(item.key, size, find('Color'), find('NormalGL'), orm);
}

// ------------------------------------------------------------------ hdris

async function polyhavenHdri(item) {
  const files = await json(`https://api.polyhaven.com/files/${item.id}`);
  const entry = files.hdri[item.res ?? '1k'].hdr;
  const out = path.join(OUT, 'hdri', `${item.key}.hdr`);
  fs.copyFileSync(await download(entry.url, path.join(CACHE, 'hdri', path.basename(entry.url))), out);
  console.log(`hdri     ${item.key.padEnd(34)} ${kb(out)}`);
}

// ------------------------------------------------------------------ run

const jobs = [
  ...manifest.models.filter((m) => wanted(m.key)).map((m) => () => processModel(m)),
  ...manifest.materials
    .filter((m) => wanted(m.key))
    .map((m) => () => (m.source === 'ambientcg' ? ambientcgMaterial(m) : polyhavenMaterial(m))),
  ...manifest.hdris.filter((h) => wanted(h.key)).map((h) => () => polyhavenHdri(h)),
];

let failed = 0;
const queue = [...jobs];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const job = queue.shift();
      try {
        await job();
      } catch (e) {
        failed++;
        console.error('FAILED', e.message);
      }
    }
  }),
);
if (failed) {
  console.error(`${failed} asset job(s) failed`);
  process.exit(1);
}
