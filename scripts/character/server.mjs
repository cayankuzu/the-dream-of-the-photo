/**
 * Dev-only helper for converting the Rocketbox characters listed in avatars.json (FBX + TGA, MIT
 * licensed) into glTF binaries inside a real browser (three.js FBXLoader -> GLTFExporter).
 *
 *   node scripts/character/server.mjs   then open http://localhost:4318/convert.html[?only=key,key]
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

const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/character/avatars.json'), 'utf8'));
const FOLDERS = { static: 'all_animations_max_motextr_static', xy: 'all_animations_max_motextr_xy', xyz: 'all_animations_max_motextr_xyz' };

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.fbx': 'application/octet-stream', '.tga': 'application/octet-stream' };

async function fetchSources() {
  const files = [['https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/LICENSE.md', 'LICENSE.md']];
  for (const a of CONFIG.avatars) {
    const base = `${RAW}/Avatars/${a.group}/${a.name}`;
    files.push([`${base}/Export/${a.name}.fbx`, `${a.name}.fbx`]);
    for (const m of a.maps ?? CONFIG.maps) files.push([`${base}/Textures/${a.prefix}_${m}.tga`, `${a.prefix}_${m}.tga`]);
    for (const c of a.clips) files.push([`${RAW}/Animations/${FOLDERS[c.folder]}/${c.name}.max.fbx`, `${c.name}.max.fbx`]);
  }
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
    else if (url === '/avatars.json') file = path.join(ROOT, 'scripts/character/avatars.json');
    else if (url.startsWith('/three/')) file = safe(path.join(ROOT, 'node_modules/three'), url.slice('/three/'.length));
    else if (url.startsWith('/src/')) file = safe(SOURCES, url.slice('/src/'.length));
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    send(res, file);
  })
  .listen(PORT, '127.0.0.1', () => console.log(`converter on http://localhost:${PORT}/convert.html`));
