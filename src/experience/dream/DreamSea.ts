import {
  AdditiveBlending,
  BackSide,
  Box3,
  BoxGeometry,
  BufferAttribute,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SRGBColorSpace,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { say } from '../../ui/i18n';
import { dreamConfig } from '../../config/dream.config';
import { photoConfig, REDUCED_MOTION } from '../../config/experience.config';
import { fireEscape, LIGHT_COLORS } from '../../config/scene.config';
import { seaConfig } from '../../config/sea.config';
import type { Photographer } from '../character/Photographer';
import { DEG, lerp } from '../math';
import { Photograph } from '../photograph/Photograph';
import { Grade } from '../render/Grade';
import type { Alley } from '../world/Alley';
import { FLOOR, MODULE } from '../world/FacadeBuilder';
import { MirrorWater } from './MirrorWater';

type V3 = readonly [number, number, number];

export interface SeaContext {
  /** For props and kit modules. */
  alley: Alley;
  /** `makeDouble(clipTime)` gives a frozen body holding a camera. */
  photographer: Photographer;
  /** Pictures for the drifting prints. */
  moments: readonly Texture[];
  /** The moon's picture (a render of the opening view). */
  moonPhoto: Texture;
}

/** A soft glow at a point (walk frame): size across and up (m), and its color times its strength. */
interface Glow {
  at: Vector3;
  width: number;
  height: number;
  color: Color;
}

const { print, image } = photoConfig;
const ORIGIN = new Vector3();
/** The same paper as PrintCard.ts (front, edges, back colors, and one roughness for all of it). */
const PAPER = { front: 0xe9e5dc, edge: 0xdcd7cc, back: 0x1b1b1d, roughness: 0.7 };
/** Image center above the print's center, and its lift off the paper (m, at real print size). */
const IMAGE_CENTER_Y = print.height / 2 - image.offsetFromTop - image.size / 2;
const IMAGE_LIFT = 0.00006;
/** Light strips sit this far (m) in front of the face they light, clear of it in the depth buffer even far away. */
const SURFACE_GAP = 0.01;
/** The lit room starts this far (m) behind its wall, and its inside is this much (m) smaller than its shell. */
const WALL_GAP = 0.01;
const ROOM_INSET = 0.02;
/** BoxGeometry faces in order px, nx, py, ny, pz, nz: four vertices and six indices each. */
const FRONT_FACE = 4;
const BACK_FACE = 5;
/** Tries to place a drifting print clear of the way and of other things before taking the last try. */
const PLACE_TRIES = 64;
/** Glows are drawn after the other see-through things (additive: among themselves order never matters). */
const GLOW_ORDER = 1;

const box = new Box3();
const v1 = new Vector3();
const m1 = new Matrix4();
const q1 = new Quaternion();
const q2 = new Quaternion();

/** mulberry32: the sea is laid out, and drifts, the same way on every visit and in every render. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function meshesOf(root: Object3D): Mesh[] {
  const list: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) list.push(o as Mesh);
  });
  return list;
}

function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

const singlePassed = new Map<Material, Material>();
/**
 * A model's two-sided see-through parts (a lamp's glass) drawn in one pass: three.js otherwise draws
 * them twice, flagging the material for a program check before each half, in every render. A copy, so
 * the alley's own lamps stay as they are.
 */
function singlePass(material: Material | Material[]): Material | Material[] {
  if (Array.isArray(material)) return material.map((m) => singlePass(m) as Material);
  if (!material.transparent || material.side !== DoubleSide || material.forceSinglePass) return material;
  let copy = singlePassed.get(material);
  if (!copy) {
    copy = material.clone();
    copy.forceSinglePass = true;
    singlePassed.set(material, copy);
  }
  return copy;
}

/**
 * Place copies of a prop by its bounds (as the alley does) and bake them into one instanced mesh per
 * part: a row of lamps or a whole staircase costs a draw call per material, not per copy. The copies
 * themselves stay out of the scene (they are returned, placed, for measuring).
 */
function instancedProps(
  alley: Alley,
  key: string,
  placements: readonly { at: V3; rotation: V3 }[],
  nodes?: readonly string[],
): { group: Group; copies: Object3D[] } {
  const scratch = new Group();
  const copies = placements.map((p) => alley.prop(key, p.at, p.rotation, { nodes, castShadow: false }, scratch));
  scratch.updateMatrixWorld(true);
  const group = new Group();
  group.name = key;
  const parts = copies.map(meshesOf);
  parts[0]?.forEach((mesh, j) => {
    const inst = new InstancedMesh(mesh.geometry, singlePass(mesh.material), copies.length);
    inst.name = `${key}:${mesh.name}`;
    parts.forEach((list, i) => inst.setMatrixAt(i, list[j].matrixWorld));
    inst.computeBoundingSphere();
    group.add(inst);
  });
  return { group, copies };
}

/** A transform in a placed object's frame: offset (m) and size (m), in the frame the object was placed in. */
function within(parent: Object3D, x: number, y: number, z: number, sx: number, sy: number, sz: number): Matrix4 {
  return new Matrix4().compose(v1.set(x, y, z), q1.identity(), new Vector3(sx, sy, sz)).premultiply(parent.matrixWorld);
}

function instancedBoxes(geometry: BoxGeometry | PlaneGeometry, material: Material, matrices: readonly Matrix4[]): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.computeBoundingSphere();
  return mesh;
}

// ------------------------------------------------------------------ glows

const GLOW_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uPull;
varying vec2 vOffset;
varying vec3 vGlow;
void main() {
  #ifdef USE_INSTANCING
    mat4 placed = instanceMatrix;
  #else
    mat4 placed = mat4(1.0);
  #endif
  #ifdef USE_INSTANCING_COLOR
    vGlow = instanceColor;
  #else
    vGlow = vec3(1.0);
  #endif
  vOffset = position.xy * 2.0;
  vec2 size = vec2(length(placed[0].xyz), length(placed[1].xyz));
  // a quad facing the eye, moved toward it along its line of sight (never past halfway) so the thing it
  // surrounds does not cut it, and shrunk by as much, so it keeps its place and size on screen
  vec4 mvPosition = modelViewMatrix * placed * vec4(0.0, 0.0, 0.0, 1.0);
  float dist = length(mvPosition.xyz);
  float keep = 1.0 - min(uPull * min(size.x, size.y), dist * 0.5) / max(dist, 1e-4);
  mvPosition.xyz *= keep;
  mvPosition.xy += position.xy * size * keep;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const GLOW_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uScatter;
varying vec2 vOffset;
varying vec3 vGlow;
void main() {
  float r2 = dot(vOffset, vOffset);
  if (r2 >= 1.0) discard;
  // light scattered by the haze: inverse-square, brought down to nothing at the quad's edge
  float edge = 1.0 / (1.0 + uScatter);
  float glow = (1.0 / (1.0 + r2 * uScatter) - edge) / (1.0 - edge);
  vec3 c = vGlow * glow;
  #ifdef USE_FOG
    // on its way through the haze the glow fades; it does not take the haze's color
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    c *= 1.0 - fogFactor;
  #endif
  gl_FragColor = vec4(c, 1.0);
}
`;

function glowMaterial(scatter: number, pull: number, fog: boolean): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    uniforms: UniformsUtils.merge([UniformsLib.fog, { uScatter: { value: scatter }, uPull: { value: pull } }]),
    fog,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

/** All glows of one kind in one draw: camera-facing quads, sized and tinted per instance. */
function glowMesh(glows: readonly Glow[], material: ShaderMaterial): InstancedMesh {
  const mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, glows.length);
  mesh.name = 'Glows';
  let largest = 0;
  glows.forEach((g, i) => {
    mesh.setMatrixAt(i, m1.compose(g.at, q1.identity(), v1.set(g.width, g.height, 1)));
    mesh.setColorAt(i, g.color);
    largest = Math.max(largest, g.width, g.height);
  });
  mesh.computeBoundingSphere();
  // the quads turn to every eye and are drawn toward it
  if (mesh.boundingSphere) mesh.boundingSphere.radius += largest * material.uniforms.uPull.value;
  // after the see-through glass they sit in front of (a pane drawn later would dim them)
  mesh.renderOrder = GLOW_ORDER;
  return mesh;
}

// ------------------------------------------------------------------ geometry

/**
 * A box open at its front (+Z), UVs in kit units (a 3 m module = 1, like the kit's walls). With `lit`,
 * its inside is a room lit from its back wall: vertex colors from `near` (by the opening) to `far`.
 */
function roomBox(width: number, height: number, depth: number, lit?: { back: Color; near: Color; far: Color }): BoxGeometry {
  const geometry = new BoxGeometry(width, height, depth);
  const uv = geometry.attributes.uv;
  const faces = [
    [depth, height],
    [depth, height],
    [width, depth],
    [width, depth],
    [width, height],
    [width, height],
  ];
  faces.forEach(([u, v], f) => {
    for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, (uv.getX(i) * u) / MODULE, (uv.getY(i) * v) / MODULE);
  });
  const index = Array.from(geometry.index!.array);
  index.splice(FRONT_FACE * 6, 6);
  geometry.setIndex(index);
  geometry.clearGroups();
  if (lit) {
    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const c = new Color();
    for (let i = 0; i < position.count; i++) {
      if (i >= BACK_FACE * 4 && i < BACK_FACE * 4 + 4) c.copy(lit.back);
      else c.lerpColors(lit.near, lit.far, (depth / 2 - position.getZ(i)) / depth);
      c.toArray(colors, i * 3);
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
  }
  return geometry;
}

/** The paper of a print as one body: front, edges and back told apart by vertex colors (one draw for all). */
function paperGeometry(): BoxGeometry {
  const geometry = new BoxGeometry(print.width, print.height, print.thickness);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  const front = new Color(PAPER.front);
  const edge = new Color(PAPER.edge);
  const back = new Color(PAPER.back);
  for (let f = 0; f < 6; f++) {
    const c = f === FRONT_FACE ? front : f === BACK_FACE ? back : edge;
    for (let i = f * 4; i < f * 4 + 4; i++) c.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.clearGroups();
  return geometry;
}

/** The back of an instant print: dark film and a line written on it by hand (grain seeded: the same every time). */
function filmBack(caption: string): CanvasTexture {
  const B = seaConfig.printBack;
  const w = B.resolution;
  const h = Math.round((w * print.height) / print.width);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = B.film;
  ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const rnd = seeded(B.seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * B.grain;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = B.ink;
  ctx.font = `${Math.round(w * B.caption.size)}px "Homemade Apple", "Segoe Script", cursive`;
  ctx.textAlign = 'center';
  ctx.save();
  ctx.translate(w * 0.5, h * B.caption.at);
  ctx.rotate(B.caption.tilt);
  ctx.fillText(caption, 0, 0);
  ctx.restore();
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ------------------------------------------------------------------ drifting prints

interface Drifter {
  base: Vector3;
  /** Two drift directions (m per unit of sway), the sway rate (rad / s) and three phases. */
  a: Vector3;
  b: Vector3;
  rate: number;
  phase: readonly [number, number, number];
  /** Turning: axis and rate (rad / s); rocking axis; resting orientation. */
  axis: Vector3;
  spin: number;
  rockAxis: Vector3;
  rest: Quaternion;
  image: InstancedMesh | null;
  slot: number;
}

/**
 * Photographs drifting over the water like slow birds: each sways along its own two directions,
 * rocks and turns slowly about its own axis. All papers in one draw, the pictures in one per picture.
 */
class DriftingPrints {
  readonly group = new Group();
  private readonly paper: InstancedMesh;
  private readonly images: InstancedMesh[] = [];
  private readonly drifters: Drifter[] = [];
  private readonly scale: Vector3;
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();

  /** @param keepClear things standing in the water (only x and z are read) */
  constructor(pictures: readonly Texture[], keepClear: readonly Vector3[]) {
    const P = seaConfig.prints;
    const rnd = seeded(P.seed);
    const { x, y, z } = P.region;
    this.group.name = 'DriftingPrints';
    this.scale = new Vector3().setScalar(P.scale);

    const placed: Vector3[] = [];
    for (let i = 0; i < P.count; i++) {
      const at = new Vector3();
      for (let t = 0; t < PLACE_TRIES; t++) {
        at.set(lerp(x[0], x[1], rnd()), lerp(y[0], y[1], rnd()), lerp(z[0], z[1], rnd()));
        const overWay = Math.abs(at.x) < P.clear.halfWidth && at.y < P.clear.height;
        const crowded =
          keepClear.some((c) => Math.hypot(c.x - at.x, c.z - at.z) < P.keepAway) || placed.some((p) => p.distanceTo(at) < P.spacing);
        if (!overWay && !crowded) break;
      }
      placed.push(at);
    }

    const direction = (vertical: number) => new Vector3(rnd() * 2 - 1, (rnd() * 2 - 1) * vertical, rnd() * 2 - 1).normalize();
    const counts = pictures.map(() => 0);
    placed.forEach((base, i) => {
      const picture = pictures.length ? i % pictures.length : -1;
      const period = lerp(P.drift.period[0], P.drift.period[1], rnd());
      const yaw = rnd() * Math.PI * 2;
      const stray = () => (rnd() * 2 - 1) * P.spin.stray;
      const lean = () => (rnd() * 2 - 1) * P.lean * DEG;
      this.drifters.push({
        base,
        a: direction(P.drift.rise),
        b: direction(1),
        rate: (Math.PI * 2) / period,
        phase: [rnd() * Math.PI * 2, rnd() * Math.PI * 2, rnd() * Math.PI * 2],
        axis: new Vector3(stray(), 1, stray()).normalize(),
        spin: (rnd() < 0.5 ? -1 : 1) * P.spin.rate * DEG * lerp(P.spin.least, 1, rnd()),
        rockAxis: new Vector3(Math.cos(yaw), 0, Math.sin(yaw)),
        rest: new Quaternion().setFromEuler(new Euler(lean(), rnd() * Math.PI * 2, lean(), 'YXZ')),
        image: null,
        slot: picture >= 0 ? counts[picture]++ : 0,
      });
    });

    this.paper = new InstancedMesh(paperGeometry(), new MeshStandardMaterial({ vertexColors: true, roughness: PAPER.roughness, metalness: 0 }), placed.length);
    this.paper.name = 'DriftingPrints:paper';
    this.group.add(this.paper);
    const imageGeometry = new PlaneGeometry(image.size, image.size).translate(0, IMAGE_CENTER_Y, print.thickness / 2 + IMAGE_LIFT);
    pictures.forEach((photo, p) => {
      if (!counts[p]) return;
      // the picture is not lit: it shows the light it recorded (as on every print in the dream)
      const material = new MeshBasicMaterial({ map: photo, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const mesh = new InstancedMesh(imageGeometry, material, counts[p]);
      mesh.name = `DriftingPrints:picture${p}`;
      this.images.push(mesh);
      this.group.add(mesh);
      this.drifters.forEach((d, i) => {
        if (i % pictures.length === p) d.image = mesh;
      });
    });
    for (const mesh of [this.paper, ...this.images]) mesh.instanceMatrix.setUsage(DynamicDrawUsage);

    this.update(0, true);
    // bounds for the whole drift: the farthest sway, and the print turned any way
    const reach = P.drift.amount * (1 + P.drift.second) + Math.hypot(print.width, print.height) * P.scale;
    for (const mesh of [this.paper, ...this.images]) {
      mesh.computeBoundingSphere();
      if (mesh.boundingSphere) mesh.boundingSphere.radius += reach;
    }
  }

  update(time: number, force = false): void {
    if (REDUCED_MOTION && !force) return;
    const P = seaConfig.prints;
    const D = P.drift;
    const rock = P.rock * DEG;
    for (let i = 0; i < this.drifters.length; i++) {
      const d = this.drifters[i];
      const w = d.rate * time;
      this.position
        .copy(d.base)
        .addScaledVector(d.a, D.amount * Math.sin(w + d.phase[0]))
        .addScaledVector(d.b, D.amount * D.second * Math.sin(w * D.secondRate + d.phase[1]));
      q1.setFromAxisAngle(d.axis, d.spin * time);
      q2.setFromAxisAngle(d.rockAxis, rock * Math.sin(w * D.rockRate + d.phase[2]));
      this.quaternion.copy(q1).multiply(q2).multiply(d.rest);
      m1.compose(this.position, this.quaternion, this.scale);
      this.paper.setMatrixAt(i, m1);
      d.image?.setMatrixAt(d.slot, m1);
    }
    this.paper.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.images.length; i++) this.images[i].instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ the sea

/**
 * Behind the giant print: a mirror sea under the dusk, lit only by the sky and by what glows in it
 * (Magritte's Empire of Light). Street lamps stand in the water, doors without walls leak light from
 * rooms that are not there, pieces of houses drift with their rooms still lit, a fire escape climbs out
 * of the water into the sky, photographs drift like slow birds, and the moon is a photograph of the
 * moment you left. At the end of the way the photographer stands on the water, aiming back at you.
 * The root sits at the sea's offset; everything in it is placed in walk-frame coordinates.
 */
export class DreamSea {
  readonly root = new Group();
  readonly figure: Object3D;
  private readonly water: MirrorWater;
  private readonly prints: DriftingPrints;

  constructor(ctx: SeaContext) {
    this.root.name = 'Sea';
    const glows: Glow[] = [];

    this.water = new MirrorWater();
    this.root.add(this.water);
    const lamps = this.buildLamps(ctx.alley, glows);
    this.buildDoors(ctx.alley, glows);
    this.buildFragments(ctx.alley, glows);
    const stairs = this.buildStairs(ctx.alley);
    this.buildMoon(ctx.moonPhoto);
    this.buildPrintBack();

    const G = seaConfig.glow;
    this.root.add(glowMesh(glows, glowMaterial(G.scatter, G.pull, true)));

    const F = seaConfig.figure;
    this.figure = ctx.photographer.makeDouble(F.clipTime);
    this.figure.name = 'SeaFigure';
    this.figure.position.set(...F.position);
    this.figure.rotation.y = F.heading * DEG;
    this.root.add(this.figure);

    const standing = [
      ...lamps,
      ...seaConfig.doors.items.map((d) => new Vector3(...d.at)),
      ...seaConfig.fragments.items.map((f) => new Vector3(...f.at)),
      ...stairs,
      new Vector3(...F.position),
    ];
    this.prints = new DriftingPrints(ctx.moments, standing);
    this.root.add(this.prints.group);

    // far beyond the reach of the alley's only shadow-casting light
    this.root.traverse((o) => {
      if (!(o as Mesh).isMesh) return;
      o.castShadow = false;
      o.receiveShadow = false;
    });
    this.root.position.set(...seaConfig.offset);
  }

  update(time: number, _dt: number): void {
    this.water.update(time);
    this.prints.update(time);
  }

  // ------------------------------------------------------------------ building the sea

  /** Lamp posts standing in the water, a little sunk and leaning; a halo around each lamp. Returns where they stand. */
  private buildLamps(alley: Alley, glows: Glow[]): Vector3[] {
    const L = seaConfig.lamps;
    const rnd = seeded(L.seed);
    const level = seaConfig.water.level;
    const placements = L.z.map((z, i) => ({
      at: [(i % 2 === 0 ? 1 : -1) * L.x, level - lerp(L.sink[0], L.sink[1], rnd()), z] as V3,
      rotation: [(rnd() * 2 - 1) * L.lean, rnd() * 360, (rnd() * 2 - 1) * L.lean] as V3,
    }));
    const { group, copies } = instancedProps(alley, 'street_lamp_post', placements);
    this.root.add(group);
    const color = new Color(LIGHT_COLORS.tungsten).multiplyScalar(L.halo.strength);
    for (const copy of copies) {
      const glass = meshesOf(copy).find((m) => materialsOf(m).some((mat) => /glass/.test(mat.name)));
      if (glass) glows.push({ at: box.setFromObject(glass).getCenter(new Vector3()), width: L.halo.size, height: L.halo.size, color });
    }
    return placements.map((p) => new Vector3(...p.at));
  }

  /** Doors without walls, each with light leaking under it and a painted back. */
  private buildDoors(alley: Alley, glows: Glow[]): void {
    const D = seaConfig.doors;
    const L = D.light;
    const strips: Matrix4[] = [];
    const backs: Matrix4[] = [];
    const size = new Vector3();
    const center = new Vector3();
    const spill = new Color(LIGHT_COLORS.window).multiplyScalar(L.spill.strength);
    for (const door of D.items) {
      // measured in the module's own frame, then stood up on its center
      const kit = alley.modules([{ piece: door.piece, position: ORIGIN, rotationY: 0 }]);
      box.setFromObject(kit).getSize(size);
      box.getCenter(center);
      kit.position.set(-center.x, -box.min.y, -center.z);
      const pivot = new Group();
      pivot.name = door.piece;
      pivot.position.set(...door.at);
      pivot.rotation.y = door.yaw * DEG;
      pivot.add(kit);
      this.root.add(pivot);
      pivot.updateMatrixWorld(true);
      const front = size.z / 2 + SURFACE_GAP;
      strips.push(within(pivot, 0, L.height / 2, front, size.x * L.width, L.height, 1));
      backs.push(within(pivot, 0, size.y / 2, -size.z / 2 - D.backing.depth / 2, size.x, size.y, D.backing.depth));
      glows.push({ at: new Vector3(0, L.height / 2, front).applyMatrix4(pivot.matrixWorld), width: size.x * L.spill.width, height: L.spill.height, color: spill });
    }
    const light = new MeshBasicMaterial({ color: new Color(LIGHT_COLORS.window).multiplyScalar(L.intensity) });
    const strip = instancedBoxes(new PlaneGeometry(1, 1), light, strips);
    strip.name = 'DoorLight';
    const backing = instancedBoxes(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: D.backing.color, roughness: D.backing.roughness, metalness: 0 }), backs);
    backing.name = 'DoorBacks';
    this.root.add(strip, backing);
  }

  /** Pieces of houses, sunk and tilted, each with its room still lit behind the window (all rooms in a few draws). */
  private buildFragments(alley: Alley, glows: Glow[]): void {
    const F = seaConfig.fragments;
    const R = F.room;
    const warm = new Color(LIGHT_COLORS.window);
    const lit = {
      back: warm.clone().multiplyScalar(R.glow),
      near: warm.clone().multiplyScalar(R.glow * R.walls[0]),
      far: warm.clone().multiplyScalar(R.glow * R.walls[1]),
    };
    const B = seaConfig.doors.backing;
    const plain = new MeshStandardMaterial({ color: B.color, roughness: B.roughness, metalness: 0 });
    const halo = warm.clone().multiplyScalar(R.halo.strength);
    /** Room shells by the wall material they continue, and the lit insides. */
    const shells = new Map<Material, Matrix4[]>();
    const insides: Matrix4[] = [];
    for (const f of F.items) {
      const kit = alley.modules(f.pieces.map((piece) => ({ piece, position: ORIGIN, rotationY: 0 })));
      // a module spans x in [-3, 0] from its pivot: centered on the fragment's own pivot
      kit.position.x = MODULE / 2;
      const part = (piece: string) => kit.children.find((c) => c.name.startsWith(`${piece}:`)) as InstancedMesh | undefined;
      const wall = part(f.pieces[0]);
      // the room starts just behind the wall's back: a thick wall would otherwise share its sides with the room's
      let back = 0;
      if (wall) {
        if (!wall.boundingBox) wall.computeBoundingBox();
        back = Math.min(back, wall.boundingBox!.min.z);
      }
      const pivot = new Group();
      pivot.name = f.pieces[0];
      pivot.position.set(...f.at);
      pivot.rotation.set(0, f.yaw * DEG, f.tilt * DEG, 'YXZ');
      pivot.add(kit);
      this.root.add(pivot);
      pivot.updateMatrixWorld(true);
      const room = within(pivot, 0, FLOOR / 2, back - WALL_GAP - R.depth / 2, 1, 1, 1);
      // the house's own wall goes on around the room
      const material = wall && !Array.isArray(wall.material) ? wall.material : plain;
      shells.set(material, [...(shells.get(material) ?? []), room]);
      insides.push(room);
      const pane = part(f.pieces[1]);
      if (pane) glows.push({ at: box.setFromObject(pane).getCenter(new Vector3()), width: R.halo.size, height: R.halo.size, color: halo });
    }
    const shell = roomBox(MODULE, FLOOR, R.depth);
    shells.forEach((matrices, material) => {
      const mesh = instancedBoxes(shell, material, matrices);
      mesh.name = 'FragmentRooms';
      this.root.add(mesh);
    });
    const inside = roomBox(MODULE - ROOM_INSET * 2, FLOOR - ROOM_INSET * 2, R.depth - ROOM_INSET * 2, lit);
    const lights = instancedBoxes(inside, new MeshBasicMaterial({ vertexColors: true, side: BackSide }), insides);
    lights.name = 'FragmentRoomLights';
    this.root.add(lights);
  }

  /** Flights of a fire escape, each going on from the top of the last, out of the water into the sky. Returns where the low ones stand. */
  private buildStairs(alley: Alley): Vector3[] {
    const S = seaConfig.stairs;
    const yaw = S.yaw * DEG;
    const run = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(S.step[0]);
    const placements = Array.from({ length: S.flights }, (_, k) => ({
      at: [S.at[0] + run.x * k, S.at[1] + S.step[1] * k, S.at[2] + run.z * k] as V3,
      rotation: [0, S.yaw, 0] as V3,
    }));
    this.root.add(instancedProps(alley, 'fire_escape', placements, fireEscape.stairsNodes).group);
    const top = seaConfig.prints.region.y[1];
    return placements.filter((p) => p.at[1] < top).map((p) => new Vector3(...p.at));
  }

  /** The moon: a glowing photograph of the moment you left, turned toward the way, a soft halo behind it. */
  private buildMoon(photo: Texture): void {
    const M = seaConfig.moon;
    const moon = new Photograph({ photo, grade: new Grade(), glow: M.glow });
    moon.name = 'Moon';
    moon.uniforms.uDevelop.value = 1;
    moon.uniforms.uLit.value = M.glow;
    moon.scale.setScalar(M.scale);
    moon.position.set(...M.at);
    // still unparented: the walk frame is its world
    moon.lookAt(v1.set(...M.faces));
    // high above the haze: the sea's distance fog does not reach it
    for (const mesh of meshesOf(moon)) {
      for (const m of materialsOf(mesh)) if ('fog' in m) (m as Material & { fog: boolean }).fog = false;
    }
    this.root.add(moon);

    const H = M.halo;
    const size = print.height * M.scale * H.size;
    const at = new Vector3(0, 0, -H.behind).applyQuaternion(moon.quaternion).add(moon.position);
    const halo = glowMesh([{ at, width: size, height: size, color: new Color(H.color).multiplyScalar(H.strength) }], glowMaterial(H.scatter, 0, false));
    halo.name = 'MoonHalo';
    this.root.add(halo);
  }

  /**
   * The back of the giant print, seen once you have passed through it: dark film and a handwritten line.
   * It faces the sea only; from the alley side the live window looks through this very plane.
   */
  private buildPrintBack(): void {
    const G = dreamConfig.giantPrint;
    const B = seaConfig.printBack;
    const geometry = new PlaneGeometry(print.width * G.scale, print.height * G.scale);
    geometry.rotateY(Math.PI);
    const film = filmBack(say('printBack'));
    const material = new MeshStandardMaterial({
      map: film,
      roughness: B.roughness,
      metalness: 0,
      // the ink catches a little more light than there is
      emissive: 0xffffff,
      emissiveMap: film,
      emissiveIntensity: B.glow,
    });
    const back = new Mesh(geometry, material);
    back.name = 'GiantPrintBack';
    back.position.set(G.center[0], G.center[1], G.z - (print.thickness * G.scale) / 2);
    this.root.add(back);
  }
}

