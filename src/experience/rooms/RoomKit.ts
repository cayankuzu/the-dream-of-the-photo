import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WARP_GLSL, warpUniforms } from '../render/Warp';
import { meterUVs, type DreamKit } from '../dream/DreamKit';
import { Crowd, randomFrom, type AvatarKey, type FigureSpec } from '../dream/FigureKit';

type V3 = readonly [number, number, number];

/** Which way a wall or door faces into the room. */
export type Facing = '+x' | '-x' | '+z' | '-z';

const YAW: Record<Facing, number> = { '+z': 0, '-z': Math.PI, '+x': Math.PI / 2, '-x': -Math.PI / 2 };

/** The colors of the house of the evening. */
export const PALETTE = {
  /** Wallpaper: ground and pattern. */
  damaskGreen: ['#16261f', '#44634f'],
  damaskTeal: ['#0f272d', '#336068'],
  damaskRust: ['#2a1812', '#6b3a28'],
  /** Damp institutional green and bone. */
  ward: ['#1b2a29', '#9aa39b'],
  wood: ['#1d110a', '#3a2214'],
  /** Lamp light. */
  warm: 0xffc98a,
  sick: 0xbfe6d0,
  cold: 0xbcd4e6,
} as const;

/** A canvas as a repeating color map. */
function canvasMap(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void, tile: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.setScalar(1 / tile);
  t.anisotropy = 4;
  return t;
}

/** Damask with a spiral at the heart of each medallion: seen from afar a pattern, seen close, not. */
function drawDamask(ctx: CanvasRenderingContext2D, s: number, ground: string, ink: string): void {
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  const medallion = (cx: number, cy: number, r: number) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineWidth = r * 0.03;
    for (let k = 0; k < 2; k++) {
      ctx.save();
      if (k) ctx.scale(-1, 1);
      // leaves climbing either side
      for (let i = 0; i < 5; i++) {
        const y = r * (0.9 - i * 0.42);
        const w = r * (0.34 + 0.2 * Math.sin((i / 4) * Math.PI));
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(w * 0.4, y - r * 0.08, w, y - r * 0.28, w * 0.75, y - r * 0.42);
        ctx.bezierCurveTo(w * 0.55, y - r * 0.26, w * 0.2, y - r * 0.16, 0, y);
        ctx.fill();
      }
      ctx.restore();
    }
    // the spiral
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 6; a += 0.12) {
      const rr = (a / (Math.PI * 6)) * r * 0.26;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr - r * 0.05;
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = r * 0.028;
    ctx.strokeStyle = ground;
    ctx.stroke();
    ctx.restore();
  };
  for (const [x, y] of [[0.25, 0.25], [0.75, 0.75], [-0.25, 0.75], [1.25, 0.25]]) medallion(x * s, y * s, s * 0.19);
  // years of damp: blotches and streaks
  const random = randomFrom(s + ground.length);
  for (let i = 0; i < 26; i++) {
    const x = random() * s;
    const y = random() * s;
    const r = (0.05 + random() * 0.2) * s;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.26)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
}

/** Black and bone tiles, scuffed, the bone gone yellow. */
function drawChecker(ctx: CanvasRenderingContext2D, s: number): void {
  const n = 2;
  const q = s / n;
  const random = randomFrom(7);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const light = (x + y) % 2 === 0;
      ctx.fillStyle = light ? '#8d8473' : '#0c0b0a';
      ctx.fillRect(x * q, y * q, q, q);
      const blotches = 34;
      for (let i = 0; i < blotches; i++) {
        const r = (0.02 + random() * 0.09) * q;
        ctx.fillStyle = light ? `rgba(40,30,18,${random() * 0.12})` : `rgba(120,110,95,${random() * 0.05})`;
        ctx.beginPath();
        ctx.arc(x * q + random() * q, y * q + random() * q, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = s * 0.004;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath();
    ctx.moveTo(i * q, 0);
    ctx.lineTo(i * q, s);
    ctx.moveTo(0, i * q);
    ctx.lineTo(s, i * q);
    ctx.stroke();
  }
}

/** Acoustic ceiling tile: pale, pitted, stained, on a dark grid. */
function drawCeiling(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.fillStyle = '#6d6c62';
  ctx.fillRect(0, 0, s, s);
  const random = randomFrom(11);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  for (let i = 0; i < 2600; i++) ctx.fillRect(random() * s, random() * s, 1 + random() * 1.5, 1 + random() * 1.5);
  for (let i = 0; i < 5; i++) {
    const x = random() * s;
    const y = random() * s;
    const r = (0.08 + random() * 0.2) * s;
    const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
    g.addColorStop(0, 'rgba(60,44,22,0.42)');
    g.addColorStop(0.8, 'rgba(60,44,22,0.28)');
    g.addColorStop(1, 'rgba(60,44,22,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
  ctx.strokeStyle = '#1b1a17';
  ctx.lineWidth = s * 0.012;
  ctx.strokeRect(0, 0, s, s);
}

/** Dark stained wood: grain along the board. */
function drawWood(ctx: CanvasRenderingContext2D, s: number, dark: string, light: string): void {
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, s, s);
  const random = randomFrom(3);
  for (let i = 0; i < 260; i++) {
    const y = random() * s;
    ctx.strokeStyle = i % 3 ? `rgba(0,0,0,${0.1 + random() * 0.25})` : light;
    ctx.globalAlpha = i % 3 ? 1 : 0.1 + random() * 0.2;
    ctx.lineWidth = 0.5 + random() * 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(s * 0.3, y + (random() - 0.5) * 18, s * 0.6, y + (random() - 0.5) * 18, s, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Shaggy dark rug seen from above, a round of it. */
function drawCarpet(ctx: CanvasRenderingContext2D, s: number, base: string): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);
  const random = randomFrom(5);
  for (let i = 0; i < 14000; i++) {
    const v = random();
    ctx.strokeStyle = v < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(255,240,220,0.05)';
    ctx.lineWidth = 1;
    const x = random() * s;
    const y = random() * s;
    const a = random() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5);
    ctx.stroke();
  }
}

/** Skin of a neck stretched too far: pale, with veins and creases along its length. */
function drawNeck(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.fillStyle = '#b08d76';
  ctx.fillRect(0, 0, s, s);
  const random = randomFrom(13);
  for (let i = 0; i < 90; i++) {
    const y = random() * s;
    ctx.strokeStyle = `rgba(90,50,40,${0.05 + random() * 0.14})`;
    ctx.lineWidth = 1 + random() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(s * 0.3, y + (random() - 0.5) * 12, s * 0.6, y + (random() - 0.5) * 12, s, y);
    ctx.stroke();
  }
  for (let i = 0; i < 14; i++) {
    ctx.strokeStyle = `rgba(50,70,100,${0.08 + random() * 0.14})`;
    ctx.lineWidth = 1 + random() * 2;
    let x = random() * s;
    let y = 0;
    ctx.beginPath();
    ctx.moveTo(x, y);
    while (y < s) {
      x += (random() - 0.5) * 34;
      y += 18 + random() * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

const GLOW_VERT = /* glsl */ `
${WARP_GLSL}
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 center = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec4 mv = viewMatrix * vec4(center, 1.0);
  vec2 size = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * dreamWarp(mv);
}
`;
const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uPower;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), uPower);
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

/** Beam from a lamp: a soft additive cone, brighter at its source; `uIntensity` flickers it. */
const BEAM_VERT = /* glsl */ `
${WARP_GLSL}
varying vec3 vLocal;
varying vec3 vNormalV;
varying vec3 vView;
void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * dreamWarp(mv);
}
`;
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec3 vLocal;
varying vec3 vNormalV;
varying vec3 vView;
void main() {
  float along = clamp(-vLocal.y + 0.5, 0.0, 1.0);
  float rim = pow(abs(dot(normalize(vNormalV), normalize(vView))), 2.0);
  float a = rim * pow(1.0 - along, 1.6);
  gl_FragColor = vec4(uColor * a * uIntensity, 1.0);
}
`;

/** A mote of dust: drifting, its size falling off with distance, bright only for a moment now and then. */
const MOTE_VERT = /* glsl */ `
${WARP_GLSL}
uniform float uTime;
uniform float uSize;
varying float vShine;
void main() {
  vec3 p = position;
  float seed = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
  p.x += sin(uTime * 0.11 + seed * 40.0) * 0.25;
  p.y += sin(uTime * 0.07 + seed * 70.0) * 0.18;
  p.z += cos(uTime * 0.09 + seed * 20.0) * 0.25;
  vShine = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 0.5 + seed * 90.0), 3.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * dreamWarp(mv);
  gl_PointSize = clamp(uSize * 900.0 / max(0.2, -mv.z), 1.0, 7.0);
}
`;
const MOTE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vShine;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.2) * vShine;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

/**
 * The house of the evening: what every room is made of. Damp wallpaper, dark wainscot, checkered floors,
 * pitted ceilings, one lamp. A room is mostly darkness around one strong picture, as in a photograph.
 */
export class RoomKit {
  private readonly cache = new Map<string, Material>();
  private readonly maps = new Map<string, Texture>();

  constructor(private readonly kit: DreamKit) {}

  private map(key: string, make: () => Texture): Texture {
    let m = this.maps.get(key);
    if (!m) {
      m = make();
      this.maps.set(key, m);
    }
    return m;
  }

  private surface(key: string, make: () => Material): Material {
    let m = this.cache.get(key);
    if (!m) {
      m = make();
      this.cache.set(key, m);
    }
    return m;
  }

  /** The bump of old plaster under any wall (from the alley, always loaded). */
  private plasterRelief(tile: number): Partial<MeshStandardMaterial> {
    const maps = this.kit.assets.materials.get('plaster_damaged')!;
    const normalMap = maps.normalMap.clone();
    normalMap.repeat.setScalar(1 / tile);
    normalMap.needsUpdate = true;
    return { normalMap, normalScale: new Vector2(0.09, 0.09) };
  }

  /** Wallpaper, tile in m; its colors from PALETTE. */
  damask(colors: readonly [string, string] = PALETTE.damaskGreen, tile = 0.9): Material {
    return this.surface(`damask/${colors.join()}`, () => {
      const map = this.map(`damask/${colors.join()}`, () => canvasMap(1024, (c, s) => drawDamask(c, s, colors[0], colors[1]), tile));
      return new MeshStandardMaterial({ map, roughness: 0.82, metalness: 0, ...this.plasterRelief(2.4) });
    });
  }

  /** Checkered floor (a tile is `tile` m): waxed, it mirrors the lamp a little. */
  checker(tile = 0.55): Material {
    return this.surface(`checker/${tile}`, () => {
      const map = this.map(`checker/${tile}`, () => canvasMap(1024, drawChecker, tile * 2));
      return new MeshStandardMaterial({ map, roughness: 0.28, metalness: 0 });
    });
  }

  /** Acoustic ceiling. */
  ceiling(tile = 0.6): Material {
    return this.surface(`ceiling/${tile}`, () => {
      const map = this.map(`ceiling/${tile}`, () => canvasMap(512, drawCeiling, tile));
      return new MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 });
    });
  }

  /** Dark stained wood. */
  wood(tile = 1.2): Material {
    return this.surface(`wood/${tile}`, () => {
      const map = this.map(`wood/${tile}`, () => canvasMap(512, (c, s) => drawWood(c, s, PALETTE.wood[0], PALETTE.wood[1]), tile));
      return new MeshStandardMaterial({ map, roughness: 0.46, metalness: 0 });
    });
  }

  /** Dull carpet of a color. */
  carpet(base = '#26281f', tile = 0.8): Material {
    return this.surface(`carpet/${base}`, () => {
      const map = this.map(`carpet/${base}`, () => canvasMap(512, (c, s) => drawCarpet(c, s, base), tile));
      return new MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
    });
  }

  /** Painted institutional plaster, damp at the foot: any color. */
  paint(color: number, roughness = 0.75): Material {
    return this.surface(`paint/${color}/${roughness}`, () => new MeshStandardMaterial({ color, roughness, metalness: 0, ...this.plasterRelief(3) }));
  }

  /** Wall of size w × h, facing `facing`, its foot at y = 0, centered at (x, z); may be cut up by doors elsewhere. */
  wall(x: number, z: number, w: number, h: number, facing: Facing, material: Material, parent: Object3D, y = 0): Mesh {
    const m = this.kit.wall(w, h, material);
    m.position.set(x, y + h / 2, z);
    m.rotation.y = YAW[facing];
    parent.add(m);
    return m;
  }

  /** A room's box seen from inside: x -w/2..w/2, z 0..-d (open faces can be skipped); returns its group. */
  box(w: number, d: number, h: number, parts: { walls?: Material; floor?: Material; ceiling?: Material; skip?: readonly Facing[] }, parent: Object3D): Group {
    const g = new Group();
    const skip = new Set(parts.skip ?? []);
    if (parts.walls) {
      if (!skip.has('-x')) this.wall(w / 2, -d / 2, d, h, '-x', parts.walls, g);
      if (!skip.has('+x')) this.wall(-w / 2, -d / 2, d, h, '+x', parts.walls, g);
      if (!skip.has('+z')) this.wall(0, -d, w, h, '+z', parts.walls, g);
      if (!skip.has('-z')) this.wall(0, 0, w, h, '-z', parts.walls, g);
    }
    if (parts.floor) g.add(this.kit.floor(-w / 2, w / 2, -d, 0, 0, parts.floor));
    if (parts.ceiling) {
      const c = this.kit.floor(-w / 2, w / 2, -d, 0, h, parts.ceiling);
      c.rotation.x = Math.PI / 2;
      g.add(c);
    }
    parent.add(g);
    return g;
  }

  /** Wood panelling to `height` along a wall, with rails, stiles and a skirting (real relief, one mesh). */
  wainscot(x: number, z: number, length: number, facing: Facing, parent: Object3D, height = 1.05): Group {
    const g = new Group();
    const parts: BufferGeometry[] = [];
    const piece = (w: number, h: number, d: number, px: number, py: number, pz: number) => {
      parts.push(meterUVs(new BoxGeometry(w, h, d)).translate(px, py, pz));
    };
    const panel = 0.62;
    const count = Math.max(1, Math.round(length / panel));
    const step = length / count;
    piece(length, height, 0.012, 0, height / 2, 0.006);
    piece(length, 0.16, 0.035, 0, 0.08, 0.018);
    piece(length, 0.06, 0.05, 0, height - 0.03, 0.025);
    piece(length, 0.05, 0.03, 0, height * 0.5, 0.015);
    for (let i = 0; i <= count; i++) piece(0.06, height - 0.1, 0.028, -length / 2 + i * step, height / 2, 0.014);
    const panels = new Mesh(mergeGeometries(parts)!, this.wood());
    panels.frustumCulled = false;
    panels.receiveShadow = true;
    g.add(panels);
    g.position.set(x, 0, z);
    g.rotation.y = YAW[facing];
    parent.add(g);
    return g;
  }

  /**
   * A door in its frame against a wall (the wall behind it is not cut: behind the opening hangs `beyond`,
   * a dark or lit plane). `open` 0..1 swings the leaf inward. Returns the leaf's pivot, to swing later.
   */
  door(x: number, z: number, facing: Facing, parent: Object3D, opts: { open?: number; beyond?: number; color?: number; width?: number; height?: number } = {}): { root: Group; leaf: Object3D; beyond: Mesh } {
    const w = opts.width ?? 0.92;
    const h = opts.height ?? 2.1;
    const root = new Group();
    const paint = new MeshStandardMaterial({ color: opts.color ?? 0x2b241c, roughness: 0.55 });
    const whole = (parts: BufferGeometry[], material: Material, into: Object3D) => {
      const m = new Mesh(mergeGeometries(parts)!, material);
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
      into.add(m);
    };
    const piece = (geoW: number, geoH: number, geoD: number, px: number, py: number, pz: number) => meterUVs(new BoxGeometry(geoW, geoH, geoD)).translate(px, py, pz);
    const beyond = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: opts.beyond ?? 0x000000 }));
    beyond.position.set(0, h / 2, 0.004);
    beyond.frustumCulled = false;
    root.add(beyond);
    whole([piece(0.1, h + 0.1, 0.08, -w / 2 - 0.05, h / 2 + 0.05, 0.03), piece(0.1, h + 0.1, 0.08, w / 2 + 0.05, h / 2 + 0.05, 0.03), piece(w + 0.2, 0.12, 0.08, 0, h + 0.06, 0.03)], this.wood(), root);
    const leaf = new Group();
    leaf.position.set(-w / 2, 0, 0.02);
    leaf.rotation.y = (opts.open ?? 0) * (Math.PI * 0.55);
    const leafParts = [piece(w, h, 0.04, w / 2, h / 2, 0)];
    for (const [py, ph] of [[0.5, 0.72], [1.1, 0.34], [1.62, 0.66]] as const) {
      for (const px of [w * 0.27, w * 0.73]) leafParts.push(piece(w * 0.34, ph, 0.015, px, py + 0.02, 0.025));
    }
    whole(leafParts, paint, leaf);
    const brass = new MeshStandardMaterial({ color: 0x7a6236, roughness: 0.35, metalness: 1 });
    const knob = new Mesh(new CylinderGeometry(0.028, 0.028, 0.05, 12), brass);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(w - 0.08, 1.02, 0.05);
    knob.frustumCulled = false;
    leaf.add(knob);
    root.add(leaf);
    root.position.set(x, 0, z);
    root.rotation.y = YAW[facing];
    parent.add(root);
    return { root, leaf, beyond };
  }

  /** A small table with a shaded lamp on it; the lamp's shade glows: `glow` sets it. Its light is yours to add at `lightAt`. */
  lampTable(x: number, z: number, parent: Object3D, heading = 0): { root: Group; shade: MeshStandardMaterial; lightAt: V3; top: number } {
    const root = new Group();
    const parts: BufferGeometry[] = [];
    const part = (w: number, h: number, d: number, px: number, py: number, pz: number) => parts.push(meterUVs(new BoxGeometry(w, h, d)).translate(px, py, pz));
    const top = 0.74;
    part(0.82, 0.035, 0.52, 0, top, 0);
    part(0.74, 0.08, 0.44, 0, top - 0.06, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(0.04, top - 0.02, 0.04, sx * 0.36, (top - 0.02) / 2, sz * 0.22);
    const body = new Mesh(mergeGeometries(parts)!, this.wood());
    body.frustumCulled = false;
    body.castShadow = true;
    body.receiveShadow = true;
    root.add(body);
    // base and stem, turned
    const brass = new MeshStandardMaterial({ color: 0x5c4a28, roughness: 0.42, metalness: 1 });
    const stemProfile = [[0, 0], [0.075, 0], [0.078, 0.012], [0.03, 0.03], [0.014, 0.1], [0.012, 0.32], [0.022, 0.34], [0.01, 0.37], [0, 0.38]].map(([a, b]) => new Vector2(a, b));
    const stem = new Mesh(new LatheGeometry(stemProfile, 18), brass);
    stem.position.set(0.08, top + 0.018, 0);
    stem.frustumCulled = false;
    stem.castShadow = true;
    root.add(stem);
    const shade = new MeshStandardMaterial({ color: 0x9a8d74, roughness: 0.9, side: DoubleSide, emissive: new Color(PALETTE.warm), emissiveIntensity: 1.8 });
    const shadeMesh = new Mesh(new CylinderGeometry(0.1, 0.19, 0.2, 28, 1, true), shade);
    shadeMesh.position.set(0.08, top + 0.018 + 0.36, 0);
    shadeMesh.frustumCulled = false;
    root.add(shadeMesh);
    root.position.set(x, 0, z);
    root.rotation.y = heading;
    parent.add(root);
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    return { root, shade, top, lightAt: [x + 0.08 * c, top + 0.36, z - 0.08 * s] };
  }

  /**
   * The alarm clock of the evenings: two bells, a hammer, and for a face a burning spiral. It always says half past.
   * `spiral` is the face's material: write `emissiveIntensity` to make it breathe.
   */
  clock(x: number, y: number, z: number, parent: Object3D, scale = 1): { root: Group; spiral: MeshStandardMaterial } {
    const root = new Group();
    const body = new MeshStandardMaterial({ color: 0x24402f, roughness: 0.38, metalness: 0.75 });
    const metal = new MeshStandardMaterial({ color: 0x8f8460, roughness: 0.32, metalness: 1 });
    const add = (m: Mesh) => {
      m.frustumCulled = false;
      m.castShadow = true;
      root.add(m);
      return m;
    };
    const drum = add(new Mesh(new CylinderGeometry(0.075, 0.075, 0.05, 40), body));
    drum.rotation.x = Math.PI / 2;
    drum.position.y = 0.09;
    const rim = add(new Mesh(new TorusGeometry(0.073, 0.006, 8, 40), metal));
    rim.position.set(0, 0.09, 0.026);
    for (const side of [-1, 1]) {
      const bell = add(new Mesh(new LatheGeometry([[0, 0.04], [0.02, 0.038], [0.033, 0.02], [0.038, 0]].map(([a, b]) => new Vector2(a, b)), 20), metal));
      bell.position.set(side * 0.05, 0.165, -0.002);
      bell.rotation.z = -side * 0.5;
      const leg = add(new Mesh(new CylinderGeometry(0.005, 0.005, 0.035, 8), metal));
      leg.position.set(side * 0.055, 0.018, 0);
      leg.rotation.z = side * 0.4;
    }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#100703';
    c.fillRect(0, 0, 256, 256);
    c.strokeStyle = '#ffffff';
    c.lineWidth = 10;
    c.lineCap = 'round';
    c.beginPath();
    for (let a = 0; a < Math.PI * 7; a += 0.05) {
      const r = (a / (Math.PI * 7)) * 112;
      const px = 128 + Math.cos(a) * r;
      const py = 128 + Math.sin(a) * r;
      if (a === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.stroke();
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    const spiral = new MeshStandardMaterial({ color: 0x000000, roughness: 0.4, emissive: new Color(0xff7a1e), emissiveMap: map, emissiveIntensity: 4 });
    const face = add(new Mesh(new CylinderGeometry(0.066, 0.066, 0.002, 40), spiral));
    face.rotation.x = Math.PI / 2;
    face.position.set(0, 0.09, 0.0255);
    root.position.set(x, y, z);
    root.scale.setScalar(scale);
    parent.add(root);
    return { root, spiral };
  }

  /** A soft dark round on the floor under something (nothing casts on the floor unless the key light sees it). */
  contactShadow(x: number, z: number, radius: number, parent: Object3D, strength = 0.65, y = 0.004): Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const c = canvas.getContext('2d')!;
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, `rgba(0,0,0,${strength})`);
    g.addColorStop(0.55, `rgba(0,0,0,${strength * 0.6})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
    const m = new Mesh(new PlaneGeometry(radius * 2, radius * 2), new MeshBasicMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.frustumCulled = false;
    m.renderOrder = 1;
    parent.add(m);
    return m;
  }

  /** A soft additive glow always facing the eye (around a lamp, a hole of light). */
  glow(x: number, y: number, z: number, size: number, color: number, strength: number, parent: Object3D, power = 2.4): Mesh {
    const m = new Mesh(
      new PlaneGeometry(1, 1),
      new ShaderMaterial({
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        uniforms: { ...warpUniforms, uColor: { value: new Color(color).multiplyScalar(strength) }, uPower: { value: power } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    m.position.set(x, y, z);
    m.scale.set(size, size, 1);
    m.frustumCulled = false;
    m.renderOrder = 3;
    parent.add(m);
    return m;
  }

  /** A cone of lit air under a lamp: top radius, bottom radius, height; hangs from (x, y, z). `uIntensity` to flicker. */
  beam(x: number, y: number, z: number, top: number, bottom: number, height: number, color: number, intensity: number, parent: Object3D): Mesh {
    const m = new Mesh(
      new CylinderGeometry(top, bottom, height, 32, 8, true),
      new ShaderMaterial({
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        uniforms: { ...warpUniforms, uColor: { value: new Color(color) }, uIntensity: { value: intensity } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    );
    // shader reads local y in -0.5..0.5 of the unit: scale it in
    m.geometry.scale(1 / Math.max(top, bottom), 1 / height, 1 / Math.max(top, bottom));
    m.scale.set(Math.max(top, bottom), height, Math.max(top, bottom));
    m.position.set(x, y - height / 2, z);
    m.frustumCulled = false;
    m.renderOrder = 3;
    parent.add(m);
    return m;
  }

  /**
   * A flat picture you draw yourself: a printed notice, a number on a display, an exam paper, a stone. Draw on
   * the canvas (`px` per meter across its `width`); `emissive` makes it its own light; `draw` can be called again
   * to change it. Returns a mesh facing +Z, its center at the origin.
   */
  label(width: number, height: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, opts: { px?: number; emissive?: number; transparent?: boolean; roughness?: number } = {}): { mesh: Mesh; redraw: (draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) => void } {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * (opts.px ?? 512));
    canvas.height = Math.ceil(height * (opts.px ?? 512));
    const ctx = canvas.getContext('2d')!;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    const redraw = (paint: (c: CanvasRenderingContext2D, w: number, h: number) => void) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      paint(ctx, canvas.width, canvas.height);
      texture.needsUpdate = true;
    };
    redraw(draw);
    const material = opts.emissive
      ? new MeshStandardMaterial({ color: 0x000000, roughness: opts.roughness ?? 0.4, emissive: new Color(0xffffff), emissiveMap: texture, emissiveIntensity: opts.emissive, transparent: opts.transparent ?? false })
      : new MeshStandardMaterial({ map: texture, roughness: opts.roughness ?? 0.85, transparent: opts.transparent ?? false });
    const mesh = new Mesh(new PlaneGeometry(width, height), material);
    mesh.frustumCulled = false;
    return { mesh, redraw };
  }

  /** An instant print hanging on a wall: white paper, the picture, a little shadow behind it. Faces +Z. */
  print(picture: Texture, width = 0.32): Group {
    const g = new Group();
    const height = width * 1.2;
    const paper = new Mesh(new BoxGeometry(width, height, 0.002), new MeshStandardMaterial({ color: 0xd9d5c8, roughness: 0.7 }));
    paper.position.z = 0.004;
    paper.frustumCulled = false;
    const image = new Mesh(new PlaneGeometry(width * 0.88, width * 0.88), new MeshStandardMaterial({ map: picture, roughness: 0.35 }));
    image.position.set(0, (height - width * 0.88) / 2 - width * 0.06, 0.0055);
    image.frustumCulled = false;
    g.add(paper, image);
    return g;
  }

  /**
   * Long white hair hanging from `count` random points of a box (x0..x1, top y, z0..z1), down `length` m, swaying.
   * Hair is the piece's own material: use it wherever the motto wants to be felt. Update `time.value` each frame.
   */
  hair(count: number, box: { x: readonly [number, number]; y: number; z: readonly [number, number] }, length: readonly [number, number], parent: Object3D, opts: { width?: number; seed?: number; sway?: number; color?: number } = {}): { mesh: Mesh; time: { value: number } } {
    const random = randomFrom(opts.seed ?? 21);
    const width = opts.width ?? 0.0035;
    const segments = 10;
    const positions: number[] = [];
    const roots: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < count; i++) {
      const x = box.x[0] + (box.x[1] - box.x[0]) * random();
      const z = box.z[0] + (box.z[1] - box.z[0]) * random();
      const l = length[0] + (length[1] - length[0]) * random();
      const phase = random() * 6.283;
      const base = positions.length / 3;
      for (let k = 0; k <= segments; k++) {
        const along = k / segments;
        const w = width * (1 - along * 0.8);
        const y = box.y - l * along;
        positions.push(x - w, y, z, x + w, y, z);
        roots.push(along, phase, along, phase);
        if (k < segments) {
          const a = base + k * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }
    const geometry = new PlaneGeometry(1, 1);
    geometry.setIndex(indices);
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('hairAt', new Float32BufferAttribute(roots, 2));
    geometry.deleteAttribute('uv');
    geometry.deleteAttribute('normal');
    const time = { value: 0 };
    const sway = opts.sway ?? 0.05;
    const material = new MeshBasicMaterial({ color: opts.color ?? 0xbdb9ac, side: DoubleSide });
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uHairTime = time;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 hairAt;\nuniform float uHairTime;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float hairGrow = hairAt.x * hairAt.x;
        transformed.x += hairGrow * ${sway.toFixed(3)} * sin(uHairTime * 0.8 + hairAt.y + hairAt.x * 2.0);
        transformed.z += hairGrow * ${sway.toFixed(3)} * cos(uHairTime * 0.63 + hairAt.y * 1.7);`,
      );
    };
    material.customProgramCacheKey = () => `room-hair-${sway}`;
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    parent.add(mesh);
    return { mesh, time };
  }

  /**
   * White hairs lying loose on or floating over a flat place (x0..x1, height y, z0..z1): fine, curling, tangled.
   * For a tray, a floor, a table, a pillow. Update `time.value` each frame.
   */
  tangle(count: number, box: { x: readonly [number, number]; y: number; z: readonly [number, number] }, length: readonly [number, number], parent: Object3D, opts: { width?: number; seed?: number; color?: number; curl?: number; lift?: number } = {}): { mesh: Mesh; time: { value: number } } {
    const random = randomFrom(opts.seed ?? 8);
    const width = opts.width ?? 0.0007;
    const curl = opts.curl ?? 7;
    const lift = opts.lift ?? 0.004;
    const positions: number[] = [];
    const roots: number[] = [];
    const indices: number[] = [];
    const segments = 26;
    for (let i = 0; i < count; i++) {
      let x = box.x[0] + (box.x[1] - box.x[0]) * random();
      let z = box.z[0] + (box.z[1] - box.z[0]) * random();
      let heading = random() * Math.PI * 2;
      let bend = (random() - 0.5) * curl;
      const l = (length[0] + (length[1] - length[0]) * random()) / segments;
      const phase = random() * 6.283;
      const y = box.y + random() * lift;
      const base = positions.length / 3;
      for (let k = 0; k <= segments; k++) {
        const nx = Math.sin(heading) * width;
        const nz = -Math.cos(heading) * width;
        positions.push(x - nx, y, z - nz, x + nx, y, z + nz);
        roots.push(k / segments, phase, k / segments, phase);
        if (k < segments) {
          const a = base + k * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
        bend += (random() - 0.5) * curl * 0.5;
        heading += bend * l;
        x = Math.min(box.x[1], Math.max(box.x[0], x + Math.cos(heading) * l));
        z = Math.min(box.z[1], Math.max(box.z[0], z + Math.sin(heading) * l));
      }
    }
    const geometry = new BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('hairAt', new Float32BufferAttribute(roots, 2));
    const time = { value: 0 };
    const material = new MeshBasicMaterial({ color: opts.color ?? 0xbdb9ac, side: DoubleSide });
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uHairTime = time;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 hairAt;\nuniform float uHairTime;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed.x += 0.004 * sin(uHairTime * 0.31 + hairAt.y + hairAt.x * 3.0);
        transformed.z += 0.004 * cos(uHairTime * 0.27 + hairAt.y * 1.7 + hairAt.x * 2.0);`,
      );
    };
    material.customProgramCacheKey = () => 'room-tangle';
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    parent.add(mesh);
    return { mesh, time };
  }

  /**
   * Still black water, w × l at height y (x -w/2..w/2, z 0..-l). It only darkens: for it to mirror the room, call
   * `mirror` once everything is built: a copy of the room is hung upside down beneath it. `update(time)` makes it breathe.
   */
  blackWater(w: number, l: number, y: number, parent: Object3D, opts: { opacity?: number; ripple?: number } = {}): { mesh: Mesh; update(time: number): void; mirror(room: Object3D): void } {
    const normalMap = this.map('ripple', () => {
      const size = 256;
      const data = new Uint8Array(size * size * 4);
      const height = (x: number, z: number) => {
        const a = (x / size) * Math.PI * 2;
        const b = (z / size) * Math.PI * 2;
        return Math.sin(a * 3 + Math.sin(b * 2) * 1.4) * 0.5 + Math.sin(b * 5 + Math.cos(a * 3) * 1.1) * 0.3 + Math.sin((a + b) * 7) * 0.2;
      };
      for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
          const nx = height(i - 1, j) - height(i + 1, j);
          const ny = height(i, j - 1) - height(i, j + 1);
          const k = (j * size + i) * 4;
          data[k] = 128 + nx * 200;
          data[k + 1] = 128 + ny * 200;
          data[k + 2] = 255;
          data[k + 3] = 255;
        }
      }
      const t = new DataTexture(data, size, size);
      t.wrapS = t.wrapT = RepeatWrapping;
      t.generateMipmaps = true;
      t.minFilter = LinearMipmapLinearFilter;
      t.magFilter = LinearFilter;
      t.repeat.setScalar(0.5);
      t.needsUpdate = true;
      return t;
    });
    const scale = opts.ripple ?? 0.07;
    const material = new MeshStandardMaterial({ color: 0x020305, roughness: 0.06, metalness: 0.1, normalMap, normalScale: new Vector2(scale, scale), transparent: true, opacity: opts.opacity ?? 0.72 });
    const mesh = this.kit.floor(-w / 2, w / 2, -l, 0, y, material);
    mesh.renderOrder = 2;
    parent.add(mesh);
    return {
      mesh,
      update: (time) => normalMap.offset.set(time * 0.012, time * 0.008),
      mirror: (room) => {
        const seen = new Group();
        for (const child of room.children) if (child !== mesh) seen.add(child.clone());
        seen.position.y = y * 2;
        seen.scale.y = -1;
        room.add(seen);
      },
    };
  }

  /** Dust in the air of a box: a room without it looks like a render. Update `time.value` each frame. */
  motes(count: number, box: { x: readonly [number, number]; y: readonly [number, number]; z: readonly [number, number] }, parent: Object3D, opts: { size?: number; color?: number; strength?: number; seed?: number } = {}): { points: Points; time: { value: number } } {
    const random = randomFrom(opts.seed ?? 33);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = box.x[0] + (box.x[1] - box.x[0]) * random();
      positions[i * 3 + 1] = box.y[0] + (box.y[1] - box.y[0]) * random();
      positions[i * 3 + 2] = box.z[0] + (box.z[1] - box.z[0]) * random();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    const time = { value: 0 };
    const points = new Points(
      geometry,
      new ShaderMaterial({
        vertexShader: MOTE_VERT,
        fragmentShader: MOTE_FRAG,
        uniforms: { ...warpUniforms, uTime: time, uSize: { value: opts.size ?? 0.007 }, uColor: { value: new Color(opts.color ?? 0xcfd6c8).multiplyScalar(opts.strength ?? 0.35) } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    points.frustumCulled = false;
    points.renderOrder = 3;
    parent.add(points);
    return { points, time };
  }

  /** Bodies with no head: a suit, an empty collar and a dark stump (the man's jacket, trousers and shoes). */
  headless(count: number, spec: Partial<FigureSpec> = {}): Crowd {
    return this.kit.figures.crowd({ avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 0.2, half: 'lower', cutAt: 1.47, bleach: 0.35, ...spec }, count);
  }

  /** Bodies of stitched cloth: a sack for a body, a hole for a face. */
  sack(count: number, spec: Partial<FigureSpec> & { avatar?: AvatarKey } = {}): Crowd {
    return this.kit.figures.crowd({ avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 0.2, skin: 'sack', face: 'hollow', white: false, ...spec }, count);
  }

  /**
   * A neck grown far too long: a tube of skin along `points`, thick at the collar and thin at the end, that
   * sways by itself. `head` closes it with a stump at the far end. Update `time.value` each frame.
   */
  neck(points: readonly V3[], parent: Object3D, opts: { radius?: number; taper?: number; sway?: number; color?: number } = {}): { mesh: Mesh; time: { value: number } } {
    const radius = opts.radius ?? 0.055;
    const curve = new CatmullRomCurve3(points.map((p) => new Vector3(...p)));
    const length = curve.getLength();
    const segments = Math.max(24, Math.round(length * 26));
    const geo = new TubeGeometry(curve, segments, radius, 14, false);
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    const center = new Vector3();
    const p = new Vector3();
    const taper = opts.taper ?? 0.72;
    for (let i = 0; i < pos.count; i++) {
      const along = uv.getX(i);
      curve.getPointAt(along, center);
      p.fromBufferAttribute(pos, i).sub(center).multiplyScalar(1 - along * (1 - taper));
      p.add(center);
      pos.setXYZ(i, p.x, p.y, p.z);
      uv.setXY(i, uv.getX(i) * length * 2.2, uv.getY(i));
    }
    geo.computeVertexNormals();
    const time = { value: 0 };
    const map = this.map('neck', () => canvasMap(512, drawNeck, 1));
    map.repeat.set(1, 1);
    const material = new MeshStandardMaterial({ map, roughness: 0.56, metalness: 0, color: opts.color ?? 0xffffff });
    const sway = opts.sway ?? 0.05;
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uNeckTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uNeckTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float neckAlong = uv.x;
          float neckGrow = smoothstep(0.0, 1.5, neckAlong);
          transformed.x += neckGrow * ${sway.toFixed(3)} * sin(uNeckTime * 0.7 + neckAlong * 1.3);
          transformed.y += neckGrow * ${sway.toFixed(3)} * 0.6 * sin(uNeckTime * 0.53 + neckAlong * 1.7 + 1.0);
          transformed.z += neckGrow * ${sway.toFixed(3)} * cos(uNeckTime * 0.61 + neckAlong * 1.1);`,
        );
    };
    material.customProgramCacheKey = () => `neck-${sway}`;
    const mesh = new Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return { mesh, time };
  }
}
