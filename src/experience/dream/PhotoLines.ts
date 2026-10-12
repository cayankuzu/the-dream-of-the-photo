import {
  BoxGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  TubeGeometry,
  Vector3,
  Vector4,
  type BufferGeometry,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { dreamConfig } from '../../config/dream.config';
import { photoConfig, REDUCED_MOTION } from '../../config/experience.config';
import { ALLEY } from '../../config/scene.config';
import { DEG } from '../math';
import { printCard } from './PrintCard';

const L = dreamConfig.lines;

/** The lines are tied this far in from each wall, like the alley's own cables (m). */
const WALL_INSET = 0.05;
/** A washing line, thinner than the power cables: radius (m), tube segments and sides; the cables' color. */
const WIRE = { radius: 0.004, segments: 64, sides: 6, color: 0x0d0d0e, roughness: 0.55 };
/**
 * A few meters off the line is thinner than a pixel and would break into crawling dashes: it is drawn
 * at least this many pixels wide, the coverage it lacks taken back by MSAA (alpha to coverage).
 */
const MIN_PIXELS = 1;
/** Points sampled on the sag before the spline smooths it. */
const SAG_SAMPLES = 16;
/** The eye bolt each end is tied to, reaching into the wall: radius, length (m), sides. */
const BOLT = { radius: 0.0075, length: 0.12, sides: 6 };
/** A peg is two jaws (width, length, thickness m) rising `above` m over the line, gripping only the print's
 *  white top border; the giant print's wood. */
const PEG = { jaw: [0.011, 0.07, 0.0045] as const, above: 0.04, color: 0x8a6a48, roughness: 0.8 };
/** The paper's top edge sits this far under the line, inside the jaws (m). */
const PAPER_DROP = 0.012;
/** Each print turns away from the line by up to this much (deterministic). */
const YAW_JITTER = 12 * DEG;
/** Not a metronome: a second, incommensurate swing (frequency ratio, share of the amplitude). */
const HARMONIC = { ratio: 2.37, share: 0.22 };
/** Hung from one point, a print also turns a little as it swings (share of the swing, a quarter out of step). */
const TWIST = 0.3;
/**
 * The gusts blow down the alley, so they reach a whole line at once: its prints swing nearly together,
 * the phase lagging a little along the line (rad / m), plus each print's own (± rad).
 */
const PHASE = { along: 0.3, own: 0.35 };
/** Between gusts the air never quite stills (share of the sway left); a gust reaches farther lines later (rad / m). */
const GUST = { floor: 0.4, travel: 0.14 };
/** Picture over paper: pulled toward the eye in depth so the two never fight far away. */
const PICTURE_OFFSET = { factor: -1, units: -2 };
const SEED = 0x51ed;

const TAU = Math.PI * 2;
const UNIT = new Vector3(1, 1, 1);
const euler = new Euler();
const quaternion = new Quaternion();
const matrix = new Matrix4();
const viewport = new Vector4();

/** Deterministic PRNG (mulberry32): the lines hang the same way every time the world is built. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A pegged print: where its peg grips the line, how it hangs there, and its pose now. */
interface Hung {
  /** Where the peg grips the line (on its axis). */
  at: Vector3;
  /** Turn about the vertical: the line's direction plus the print's own (rad). */
  yaw: number;
  /** The line's slope at the peg, which the top edge follows (rad). */
  roll: number;
  /** Phase of the swing, and of the gusts reaching this line (rad). */
  phase: number;
  gust: number;
  /** The peg's frame: origin on the line, x along the print's top edge, z out of its face. */
  readonly pose: Matrix4;
}

/** Per instance: the print it belongs to, and its matrix in that print's peg frame. */
type Items = { print: number; local: Matrix4 }[];

/** One part of a print (a paper, a picture, a peg's jaw) and all its copies. */
interface Part {
  name: string;
  template: Mesh;
  items: Items;
}

/** All copies of one part in one instanced draw. */
interface Batch {
  mesh: InstancedMesh;
  items: Items;
}

/**
 * Washing lines across the alley, pegged with photographs of places further along the walk.
 * Each line sags from wall to wall; its prints hang from one peg each, the top edge following the
 * line, and swing about it, nearly together, as slow gusts come down the alley.
 * Everything is instanced (prints as printCard builds them: a dozen draws for all of it).
 */
export class PhotoLines {
  readonly root = new Group();
  private readonly prints: Hung[] = [];
  private readonly batches: Batch[] = [];
  /** World size of one pixel at unit depth, for the render being drawn (several per frame). */
  private readonly pixel = { value: 0 };

  constructor(moments: readonly Texture[]) {
    this.root.name = 'PhotoLines';
    const wire = new Mesh(this.layout(moments.length), this.wireMaterial());
    wire.name = 'lines';
    wire.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getCurrentViewport(viewport);
      this.pixel.value = 2 / (camera.projectionMatrix.elements[5] * Math.max(1, viewport.w));
    };
    this.root.add(wire);
    this.build(this.parts(moments));
  }

  /**
   * The lines' material: never thinner than `MIN_PIXELS` on screen, so a far line stays a faint
   * continuous thread instead of a dotted one (the bolts, merged in, widen alike).
   */
  private wireMaterial(): MeshStandardMaterial {
    const material = new MeshStandardMaterial({ color: WIRE.color, roughness: WIRE.roughness, alphaToCoverage: true });
    const radius = WIRE.radius.toFixed(5);
    const half = (MIN_PIXELS / 2).toFixed(3);
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uPixel = this.pixel;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uPixel;\nvarying float vCover;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
float axisDepth = max(-(modelViewMatrix * vec4(position - normal * ${radius}, 1.0)).z, 0.0);
float drawnRadius = max(${radius}, ${half} * uPixel * axisDepth);
transformed += normal * (drawnRadius - ${radius});
vCover = ${radius} / drawnRadius;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vCover;')
        .replace('#include <opaque_fragment>', 'diffuseColor.a *= vCover;\n#include <opaque_fragment>');
    };
    return material;
  }

  /** Lay out the lines and where every print is pegged; returns the lines' geometry (one draw). */
  private layout(pictures: number): BufferGeometry {
    const rand = prng(SEED);
    const x = ALLEY.halfWidth - WALL_INSET;
    const pieces: BufferGeometry[] = [];
    L.spans.forEach(([zLeft, yLeft, zRight, yRight, sag], line) => {
      const a = new Vector3(-x, yLeft, zLeft);
      const b = new Vector3(x, yRight, zRight);
      const points: Vector3[] = [];
      for (let i = 0; i <= SAG_SAMPLES; i++) {
        const t = i / SAG_SAMPLES;
        const p = new Vector3().lerpVectors(a, b, t);
        p.y -= sag * 4 * t * (1 - t);
        points.push(p);
      }
      const curve = new CatmullRomCurve3(points);
      pieces.push(new TubeGeometry(curve, WIRE.segments, WIRE.radius, WIRE.sides), bolt(a, -1), bolt(b, 1));
      if (pictures === 0) return;

      // evenly along the line, a spacing's length clear of each wall
      const count = L.perLine[line];
      const across = Math.atan2(a.z - b.z, b.x - a.x);
      const linePhase = rand() * TAU;
      for (let i = 0; i < count; i++) {
        const u = (i + 1) / (count + 1);
        const at = curve.getPointAt(u);
        const tangent = curve.getTangentAt(u);
        this.prints.push({
          at,
          yaw: across + (rand() * 2 - 1) * YAW_JITTER,
          // the jaws hold the paper against the line: its top edge keeps the line's slope there
          roll: Math.atan2(tangent.y, Math.hypot(tangent.x, tangent.z)),
          phase: linePhase + at.x * PHASE.along + (rand() * 2 - 1) * PHASE.own,
          gust: at.z * GUST.travel,
          pose: new Matrix4(),
        });
      }
    });
    const geometry = mergeGeometries(pieces);
    for (const p of pieces) p.dispose();
    return geometry;
  }

  /** Every part of every print, as printCard builds it (cycling the pictures so neighbors differ), and its pegs. */
  private parts(moments: readonly Texture[]): Part[] {
    const byKey = new Map<string, Part>();
    const add = (name: string, template: Mesh, print: number, local: Matrix4) => {
      const materials = Array.isArray(template.material) ? template.material : [template.material];
      const key = `${template.geometry.uuid}:${materials.map((m) => m.uuid).join(',')}`;
      let part = byKey.get(key);
      if (!part) {
        part = { name, template, items: [] };
        byKey.set(key, part);
      }
      part.items.push({ print, local });
    };

    // a template card per picture: its meshes, placed in the peg frame
    const drop = new Matrix4().makeTranslation(0, -PAPER_DROP, 0);
    const templates = moments.map((photo) => {
      const card = printCard(photo, L.scale, 'top');
      card.updateMatrixWorld(true);
      const parts: { mesh: Mesh; local: Matrix4 }[] = [];
      card.traverse((o) => {
        if (o instanceof Mesh) parts.push({ mesh: o, local: new Matrix4().multiplyMatrices(drop, o.matrixWorld) });
      });
      return parts;
    });

    const jaw = new Mesh(new BoxGeometry(...PEG.jaw), new MeshStandardMaterial({ color: PEG.color, roughness: PEG.roughness }));
    const [, length, thickness] = PEG.jaw;
    const grip = (photoConfig.print.thickness * L.scale + thickness) / 2;
    const jaws = [-1, 1].map((side) => new Matrix4().makeTranslation(0, PEG.above - length / 2, side * grip));

    this.prints.forEach((_, i) => {
      for (const part of templates[i % templates.length]) add('line prints', part.mesh, i, part.local);
      for (const local of jaws) add('line pegs', jaw, i, local);
    });
    return [...byKey.values()];
  }

  /** One instanced mesh per part, with its own materials (instanced programs never swap with the single prints'). */
  private build(parts: readonly Part[]): void {
    const own = new Map<Material, Material>();
    const copy = (m: Material): Material => {
      let c = own.get(m);
      if (!c) {
        c = m.clone();
        if (c instanceof MeshBasicMaterial && c.map) {
          c.polygonOffset = true;
          c.polygonOffsetFactor = PICTURE_OFFSET.factor;
          c.polygonOffsetUnits = PICTURE_OFFSET.units;
        }
        own.set(m, c);
      }
      return c;
    };

    for (const { name, template, items } of parts) {
      const { geometry, material } = Array.isArray(template.material)
        ? fewerGroups(template.geometry, template.material.map(copy))
        : { geometry: template.geometry, material: copy(template.material) };
      const mesh = new InstancedMesh(geometry, material, items.length);
      mesh.name = name;
      mesh.castShadow = template.castShadow;
      mesh.receiveShadow = template.receiveShadow;
      if (!REDUCED_MOTION) mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      this.batches.push({ mesh, items });
      this.root.add(mesh);
    }

    // at rest, then bounds wide enough for every swing (they are not recomputed per frame)
    this.pose(0, 0);
    const { height, width } = photoConfig.print;
    const reach = (PAPER_DROP + (height + width / 2) * L.scale) * L.sway.amount * (1 + TWIST);
    for (const { mesh } of this.batches) {
      mesh.computeBoundingSphere();
      if (mesh.boundingSphere) mesh.boundingSphere.radius += reach;
    }
  }

  /** Swing every print for this moment (`motion` 0 = hanging still) and write the instances. */
  private pose(time: number, motion: number): void {
    const { amount, period } = L.sway;
    const w = TAU / period;
    const gustPeriod = dreamConfig.alive.gustPeriod;
    for (let i = 0; i < this.prints.length; i++) {
      const p = this.prints[i];
      const gust = GUST.floor + (1 - GUST.floor) * Math.max(0, Math.sin((time / gustPeriod) * TAU + p.gust)) ** 2;
      const amp = amount * gust * motion;
      const swing = amp * ((1 - HARMONIC.share) * Math.sin(time * w + p.phase) + HARMONIC.share * Math.sin(time * w * HARMONIC.ratio + p.phase * 2));
      const twist = amp * TWIST * Math.cos(time * w + p.phase);
      quaternion.setFromEuler(euler.set(swing, p.yaw + twist, p.roll, 'YZX'));
      p.pose.compose(p.at, quaternion, UNIT);
    }
    for (let b = 0; b < this.batches.length; b++) {
      const { mesh, items } = this.batches[b];
      for (let j = 0; j < items.length; j++) mesh.setMatrixAt(j, matrix.multiplyMatrices(this.prints[items[j].print].pose, items[j].local));
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Each print swings about its top edge, in its own phase (still for reduced motion). */
  update(time: number): void {
    if (REDUCED_MOTION) return;
    this.pose(time, 1);
  }
}

/** The bolt a line's end is tied to: a short rod from the end straight into the wall (side -1 left, 1 right). */
function bolt(end: Vector3, side: number): BufferGeometry {
  const g = new CylinderGeometry(BOLT.radius, BOLT.radius, BOLT.length, BOLT.sides);
  g.rotateZ(Math.PI / 2);
  g.translate(end.x + (side * BOLT.length) / 2, end.y, end.z);
  return g;
}

/** A copy of `geometry` whose neighboring groups with the same material are merged into one draw. */
function fewerGroups(geometry: BufferGeometry, materials: Material[]): { geometry: BufferGeometry; material: Material[] } {
  const out = geometry.clone();
  out.clearGroups();
  const used: Material[] = [];
  let last: { start: number; count: number; material: Material } | null = null;
  const flush = () => {
    if (!last) return;
    let index = used.indexOf(last.material);
    if (index < 0) index = used.push(last.material) - 1;
    out.addGroup(last.start, last.count, index);
  };
  for (const g of [...geometry.groups].sort((p, q) => p.start - q.start)) {
    const material = materials[g.materialIndex ?? 0];
    if (last && last.material === material && last.start + last.count === g.start) last.count += g.count;
    else {
      flush();
      last = { start: g.start, count: g.count, material };
    }
  }
  flush();
  return { geometry: out, material: used };
}
