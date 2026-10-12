/**
 * Dev-only helper for converting the Rocketbox photographer (FBX + TGA, MIT licensed)
 * into a glTF binary inside a real browser (three.js FBXLoader -> GLTFExporter).
 *
 *   node scripts/character/server.mjs   then open http://localhost:4318/convert.html
 *
 * Serves the converter page, three.js from node_modules and the cached Rocketbox sources;
 * the page PUTs the exported GLB back, which is stored in .asset-cache/character/.
 * Never part of the production build.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 4318;
const OUT = path.join(ROOT, '.asset-cache/character');
const SOURCES = path.join(ROOT, '.asset-cache/rocketbox');
const RAW = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets';

const AVATAR = 'Male_Adult_07';
const TEXTURES = ['body_color', 'body_normal', 'body_specular', 'head_color', 'head_normal', 'head_specular', 'opacity_color'];
const ANIMATIONS = ['m_idle_breathe_01', 'm_take_picture'];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.fbx': 'application/octet-stream', '.tga': 'application/octet-stream' };

async function fetchSources() {
  const files = [
    [`${RAW}/Avatars/Adults/${AVATAR}/Export/${AVATAR}.fbx`, `${AVATAR}.fbx`],
    ...TEXTURES.map((t) => [`${RAW}/Avatars/Adults/${AVATAR}/Textures/m013_${t}.tga`, `m013_${t}.tga`]),
    ...ANIMATIONS.map((a) => [`${RAW}/Animations/all_animations_max_motextr_static/${a}.max.fbx`, `${a}.max.fbx`]),
    ['https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/LICENSE.md', 'LICENSE.md'],
  ];
  fs.mkdirSync(SOURCES, { recursive: true });
  for (const [url, name] of files) {
    const file = path.join(SOURCES, name);
    if (fs.existsSync(file)) continue;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log('fetched', name);
  }
}

function send(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

await fetchSources();
fs.mkdirSync(OUT, { recursive: true });

http
  .createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (req.method === 'PUT' && url.startsWith('/save/')) {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const file = path.join(OUT, path.basename(url));
        fs.writeFileSync(file, Buffer.concat(chunks));
        console.log('saved', file, Buffer.concat(chunks).length, 'bytes');
        res.writeHead(200).end('saved');
      });
      return;
    }
    const safe = (base, rel) => {
      const p = path.normalize(path.join(base, rel));
      return p.startsWith(base) ? p : null;
    };
    let file = null;
    if (url === '/convert.html') file = path.join(ROOT, 'scripts/character/convert.html');
    else if (url.startsWith('/three/')) file = safe(path.join(ROOT, 'node_modules/three'), url.slice('/three/'.length));
    else if (url.startsWith('/src/')) file = safe(SOURCES, url.slice('/src/'.length));
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    send(res, file);
  })
  .listen(PORT, '127.0.0.1', () => console.log(`converter on http://localhost:${PORT}/convert.html`));
