import {
  BackSide,
  Box3,
  BoxGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  Group,
  HalfFloatType,
  InstancedMesh,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  TubeGeometry,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type BufferGeometry,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { dreamConfig } from '../../config/dream.config';
import { LAYERS, photoConfig, REDUCED_MOTION, renderConfig } from '../../config/experience.config';
import { ALLEY } from '../../config/scene.config';
import { DEG, range } from '../math';
import type { DreamKit, PropCrowd } from './DreamKit';
import type { DreamFrame } from './DreamModule';
import { randomFrom, type Crowd, type FigureSpec } from './FigureKit';
import type { DreamLight } from './LightPool';
import { IMAGE_CENTER_Y, imageGeometry, paperGeometry, paperMaterials, PICTURE_LIFT } from './PrintCard';

const L = dreamConfig.lines;
const { print } = photoConfig;

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
/** A peg is two jaws (width, length, thickness m) rising `above` m over the line, gripping only the print's top border; old wood. */
const PEG = { jaw: [0.02, 0.11, 0.008] as const, above: 0.05, color: 0x6e5238, roughness: 0.85 };
/** The paper's top edge sits this far under the line, inside the jaws (m). */
const PAPER_DROP = 0.02;
/** A large sheet hangs mostly by its own weight: the share of the line's slope its top edge follows. */
const SLOPE_KEPT = 0.55;
/** Each print turns away from the line by up to this much (deterministic). */
const YAW_JITTER = 12 * DEG;
/** Prints away from the middle turn in toward the way, as if they were looking at it (rad / m). */
const FACE_IN = 0.09;
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
/** The swing starts this slowly after the capture, so the hanging prints of the photograph never jump (s). */
const STIR = 3;
/** Picture over paper: pulled toward the eye in depth so the two never fight far away. */
const PICTURE_OFFSET = { factor: -1, units: -2 };
const SEED = 0x51ed;

/** Where the portraits are taken: a place far below the world, inside the alley's span so it is drawn (m), one sitter every `spacing` m. */
const STAGE = { y: -300, z: -10, spacing: 8, room: [70, 24, 30] as const };
/** The flash on the lens: brightness (cd), reach (m), how far above the lens (m), and the color of its cold white. */
const FLASH = { intensity: 10, reach: 3.2, above: 0.08, color: 0xfff1e2 };
/** Side of a portrait (px), and how much of its recorded light the print shows. */
const PORTRAIT = { resolution: 256, samples: renderConfig.denseSamples, anisotropy: 4, gain: 0.42 };
/**
 * The scratches on the photographs themselves, down to the white paper: side of the mask (px), bursts of parallel
 * strokes over the face (their spread as shares of the picture, across and down), and the height of the eyes (share).
 */
const SCRATCH = {
  size: 512,
  bursts: 40,
  spread: [0.24, 0.27] as const,
  eyes: 0.4,
  eyeStrokes: 46,
  eyeBand: [0.16, 0.035] as const,
  paper: 0.72,
};

interface Sitting {
  spec: FigureSpec;
  /** From where (deg around it, 0 = straight in front; deg above it), how far (m), the lens (deg), its tilt (deg), and how far under the head it aims (m). */
  around: number;
  above: number;
  distance: number;
  fov: number;
  roll: number;
  drop: number;
}

/** Six sittings: different people, different angles, the same flash. */
const SITTINGS: readonly Sitting[] = [
  { spec: { avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 5, face: 'scratched' }, around: 0, above: -4, distance: 0.82, fov: 34, roll: 2, drop: 0.05 },
  { spec: { avatar: 'figure_woman', clip: 'f_idle_touch_hair_01', time: 1.7, face: 'scratched' }, around: -24, above: 3, distance: 0.8, fov: 36, roll: -5, drop: 0.05 },
  { spec: { avatar: 'figure_nurse', clip: 'f_listen_door', time: 1.5, face: 'scratched' }, around: 48, above: -2, distance: 1.05, fov: 38, roll: 0, drop: 0.07 },
  { spec: { avatar: 'figure_man', clip: 'm_gestic_laugh_extreme', time: 4.8, face: 'scratched' }, around: 12, above: -12, distance: 0.8, fov: 36, roll: 7, drop: 0.05 },
  { spec: { avatar: 'figure_nurse', clip: 'f_walk_injured', time: 0.4, face: 'scratched' }, around: -6, above: -14, distance: 0.8, fov: 36, roll: -3, drop: 0.05 },
  { spec: { avatar: 'figure_woman', clip: 'f_idle_touch_hair_01', time: 2.9, face: 'scratched', veil: true }, around: 30, above: 0, distance: 0.9, fov: 34, roll: 3, drop: 0.05 },
];

const TAU = Math.PI * 2;
const UNIT = new Vector3(1, 1, 1);
const euler = new Euler();
const quaternion = new Quaternion();
const matrix = new Matrix4();
const viewport = new Vector4();

/** A pegged thing: where its peg grips the line, how it hangs there, and its pose now. */
interface Hung {
  /** Where the peg grips the line (on its axis). */
  at: Vector3;
  /** Turn about the vertical: the line's direction plus its own (rad). */
  yaw: number;
  /** The line's slope at the peg, which the top edge follows (rad). */
  roll: number;
  /** Phase of the swing, and of the gusts reaching this line (rad). */
  phase: number;
  gust: number;
  /** The peg's frame: origin on the line, x along its top edge, z out of its face. */
  readonly pose: Matrix4;
}

/** Per instance: the thing it belongs to, and its matrix in that thing's peg frame. */
type Items = { hung: number; local: Matrix4 }[];

/** All copies of one part in one instanced draw. */
interface Batch {
  mesh: InstancedMesh;
  items: Items;
}

/** A print's picture: the photograph, and (for most) the scratches on it, down to the white of the paper. */
function pictureMaterial(photo: Texture, scratches: Texture | null): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    map: photo,
    polygonOffset: true,
    polygonOffsetFactor: PICTURE_OFFSET.factor,
    polygonOffsetUnits: PICTURE_OFFSET.units,
  });
  if (!scratches) return material;
  // a flash records far more light than the moment does
  material.color.setScalar(PORTRAIT.gain);
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.tScratches = { value: scratches };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tScratches;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${SCRATCH.paper.toFixed(2)}), texture2D(tScratches, vMapUv).r);`,
      );
  };
  material.customProgramCacheKey = () => 'scratched-picture';
  return material;
}

/** Someone went over this face again and again with something sharp: strokes in bursts, the eyes most of all. */
function scratchMask(seed: number): CanvasTexture {
  const random = randomFrom(seed);
  const size = SCRATCH.size;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  // near the middle more often than not
  const centered = () => (random() + random() + random()) / 1.5 - 1;
  const stroke = (x: number, y: number, dir: number, length: number, width: number, alpha: number) => {
    const bend = (random() - 0.5) * length * 0.18;
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(dir) * length * 0.5 - Math.sin(dir) * bend, y + Math.sin(dir) * length * 0.5 + Math.cos(dir) * bend, x + Math.cos(dir) * length, y + Math.sin(dir) * length);
    ctx.stroke();
  };
  for (let b = 0; b < SCRATCH.bursts; b++) {
    const x = size * (0.5 + centered() * SCRATCH.spread[0]);
    const y = size * (SCRATCH.eyes + centered() * SCRATCH.spread[1]);
    // one hand: mostly the same slant, with changes of mind
    const dir = -0.9 + (random() - 0.5) * 0.7 + (random() < 0.3 ? Math.PI / 2 : 0);
    const lines = 2 + Math.floor(random() * 7);
    const length = size * (0.08 + random() * 0.3);
    const gap = 2 + random() * 5;
    // through the point, not from it
    const fromX = x - (Math.cos(dir) * length) / 2;
    const fromY = y - (Math.sin(dir) * length) / 2;
    for (let j = 0; j < lines; j++) {
      const off = (j - lines / 2) * gap;
      stroke(fromX - Math.sin(dir) * off, fromY + Math.cos(dir) * off, dir + (random() - 0.5) * 0.08, length * (0.7 + random() * 0.5), 0.5 + random() * 1.3, 0.2 + random() * 0.7);
    }
  }
  for (let e = 0; e < SCRATCH.eyeStrokes; e++) {
    const x = size * (0.5 + (random() - 0.5) * 2 * SCRATCH.eyeBand[0]);
    const y = size * (SCRATCH.eyes + (random() - 0.5) * 2 * SCRATCH.eyeBand[1]);
    stroke(x - size * 0.06, y, (random() - 0.5) * 0.5, size * (0.05 + random() * 0.14), 0.8 + random() * 2, 0.35 + random() * 0.6);
  }
  const texture = new CanvasTexture(canvas);
  texture.anisotropy = PORTRAIT.anisotropy;
  return texture;
}

/** The bolt a line's end is tied to: a short rod from the end straight into the wall (side -1 left, 1 right). */
function bolt(end: Vector3, side: number): BufferGeometry {
  const g = new CylinderGeometry(BOLT.radius, BOLT.radius, BOLT.length, BOLT.sides);
  g.rotateZ(Math.PI / 2);
  g.translate(end.x + (side * BOLT.length) / 2, end.y, end.z);
  return g;
}

/** A copy of `geometry` whose neighboring groups with the same material are merged into one draw. */
function fewerGroups(geometry: BufferGeometry, materials: readonly Material[]): { geometry: BufferGeometry; material: Material[] } {
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

/**
 * Washing lines across the alley, pegged with photographs of faces someone has scratched away, enlarged far
 * beyond any print, and gas masks hung up by the head like laundry: you walk under a sky of them. Each line sags
 * from wall to wall; what hangs on it hangs from one peg, its top edge following the line, and swings about it,
 * nearly together, as slow gusts come down the alley. Among all of them one face is not scratched yet: yours.
 * The faces are photographed once, before the piece starts, on a stage far below the world.
 */
export class PhotoLines {
  readonly root = new Group();
  private readonly hung: Hung[] = [];
  private readonly batches: Batch[] = [];
  private readonly masks: PropCrowd;
  private readonly maskItems: Items = [];
  /** World size of one pixel at unit depth, for the render being drawn (several per frame). */
  private readonly pixel = { value: 0 };
  private readonly stage = new Group();
  private readonly flash: DreamLight;
  private readonly portraits: { film: WebGLRenderTarget; camera: PerspectiveCamera }[] = [];
  private clock = 0;

  constructor(kit: DreamKit, you: Texture) {
    this.root.name = 'PhotoLines';
    const wire = new Mesh(this.layout(), this.wireMaterial());
    wire.name = 'lines';
    wire.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getCurrentViewport(viewport);
      this.pixel.value = 2 / (camera.projectionMatrix.elements[5] * Math.max(1, viewport.w));
    };
    this.root.add(wire);

    this.flash = kit.lights.add([0, STAGE.y, STAGE.z], FLASH.color, 0, FLASH.reach);
    this.buildStage(kit);

    // what hangs where
    const pictures = this.portraits.map((p, i) => pictureMaterial(p.film.texture, scratchMask(SEED + i * 131)));
    const yours = pictureMaterial(you, null);
    const isMask = (line: number, place: number) => L.masks.some(([l, p]) => l === line && p === place);
    const items = new Map<Material, Items>();
    const add = (material: Material, hung: number, local: Matrix4) => {
      const list = items.get(material);
      if (list) list.push({ hung, local });
      else items.set(material, [{ hung, local }]);
    };

    const S = L.scale;
    const center = -PAPER_DROP - (print.height * S) / 2;
    const scale = new Vector3(S, S, S);
    const paper = new Matrix4().compose(new Vector3(0, center, 0), new Quaternion(), scale);
    const lift = (print.thickness / 2 + PICTURE_LIFT) * S;
    const front = new Matrix4().compose(new Vector3(0, center + IMAGE_CENTER_Y * S, lift), new Quaternion(), scale);
    const back = new Matrix4().compose(new Vector3(0, center + IMAGE_CENTER_Y * S, -lift), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI), scale);
    const [, jawLength, jawThickness] = PEG.jaw;
    const grip = (print.thickness * S + jawThickness) / 2;
    const jaws = [-1, 1].map((side) => new Matrix4().makeTranslation(0, PEG.above - jawLength / 2, side * grip));
    const maskBox = new Box3().setFromObject(kit.model('gas_mask').scene);
    const maskLocal = new Matrix4().makeTranslation(0, -PAPER_DROP - (maskBox.max.y - maskBox.min.y) * L.maskScale, 0);

    const paperItems: Items = [];
    const pegItems: Items = [];
    let i = 0;
    let n = 0;
    L.perLine.forEach((count, line) => {
      for (let place = 0; place < count; place++, i++) {
        for (const local of jaws) pegItems.push({ hung: i, local });
        if (isMask(line, place)) {
          this.maskItems.push({ hung: i, local: maskLocal });
          continue;
        }
        paperItems.push({ hung: i, local: paper });
        // neighbors differ; the back of a print shows someone else
        const theirs = pictures[n++ % pictures.length];
        const other = pictures[(n + 2) % pictures.length];
        add(line === L.densest && place === L.unscratched ? yours : theirs, i, front);
        add(other, i, back);
      }
    });

    this.masks = kit.props('gas_mask', this.maskItems.length, { scale: L.maskScale });
    this.root.add(this.masks.root);

    const { geometry, material } = fewerGroups(paperGeometry, paperMaterials);
    const jaw = new BoxGeometry(...PEG.jaw);
    this.addBatch('line prints', geometry, material, paperItems);
    this.addBatch('line pegs', jaw, new MeshStandardMaterial({ color: PEG.color, roughness: PEG.roughness }), pegItems);
    for (const [picture, list] of items) this.addBatch('line pictures', imageGeometry, picture, list);
    this.pose(0, 0);

    // the densest line draws the eye to it
    const [zLeft, yLeft, zRight, yRight, sag] = L.spans[L.densest];
    kit.poi({
      position: new Vector3(0, (yLeft + yRight) / 2 - sag - (print.height * S) / 2, (zLeft + zRight) / 2),
      radius: L.poi.radius,
      zoom: L.poi.zoom,
      memory: 'faces',
    });
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

  /** Lay out the lines and where everything is pegged; returns the lines' geometry (one draw). */
  private layout(): BufferGeometry {
    const rand = randomFrom(SEED);
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

      // evenly along the line, a spacing's length clear of each wall
      const count = L.perLine[line];
      const across = Math.atan2(a.z - b.z, b.x - a.x);
      const linePhase = rand() * TAU;
      for (let i = 0; i < count; i++) {
        const u = (i + 1) / (count + 1);
        const at = curve.getPointAt(u);
        const tangent = curve.getTangentAt(u);
        this.hung.push({
          at,
          yaw: across + (rand() * 2 - 1) * YAW_JITTER - at.x * FACE_IN,
          // the jaws hold the paper against the line: its top edge keeps some of the line's slope there
          roll: Math.atan2(tangent.y, Math.hypot(tangent.x, tangent.z)) * SLOPE_KEPT,
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

  private addBatch(name: string, geometry: BufferGeometry, material: Material | Material[], items: Items): void {
    const mesh = new InstancedMesh(geometry, material, items.length);
    mesh.name = name;
    if (!REDUCED_MOTION) mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.receiveShadow = true;
    this.batches.push({ mesh, items });
    this.root.add(mesh);
  }

  /** The sitters, each with a lens of their own, in a black room far below the world (seen only while photographed). */
  private buildStage(kit: DreamKit): void {
    this.stage.name = 'PortraitStage';
    this.stage.visible = false;
    this.stage.position.set(0, STAGE.y, STAGE.z);
    const [w, h, d] = STAGE.room;
    this.stage.add(new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial({ color: 0x000000, side: BackSide, fog: false })));
    const head = new Vector3();
    SITTINGS.forEach((s, i) => {
      const crowd = kit.figures.crowd(s.spec, 1);
      const x = (i - (SITTINGS.length - 1) / 2) * STAGE.spacing;
      crowd.set(0, x, 0, 0);
      crowd.commit();
      this.stage.add(crowd.root);

      this.headOf(crowd, head);
      const target = new Vector3(x, STAGE.y + head.y - s.drop, STAGE.z + head.z);
      target.x += head.x;
      const camera = new PerspectiveCamera(s.fov, 1, renderConfig.near, STAGE.room[2]);
      const around = s.around * DEG;
      const above = s.above * DEG;
      camera.position.set(
        target.x + Math.sin(around) * Math.cos(above) * s.distance,
        target.y + Math.sin(above) * s.distance,
        target.z + Math.cos(around) * Math.cos(above) * s.distance,
      );
      camera.lookAt(target);
      camera.rotateZ(s.roll * DEG);
      camera.layers.set(LAYERS.WORLD);
      camera.layers.enable(LAYERS.DREAM);
      camera.updateMatrixWorld(true);
      const film = new WebGLRenderTarget(PORTRAIT.resolution, PORTRAIT.resolution, {
        type: HalfFloatType,
        samples: PORTRAIT.samples,
        generateMipmaps: true,
        minFilter: LinearMipmapLinearFilter,
        anisotropy: PORTRAIT.anisotropy,
      });
      film.texture.name = `scratched face ${i}`;
      this.portraits.push({ film, camera });
    });
    this.root.add(this.stage);
  }

  /** Where a frozen body's head is, in its own space. */
  private headOf(crowd: Crowd, out: Vector3): void {
    out.set(0, 1.55, 0);
    for (const child of crowd.root.children) {
      const mesh = child as InstancedMesh;
      if (!/head/.test((mesh.material as Material).name)) continue;
      mesh.geometry.computeBoundingBox();
      mesh.geometry.boundingBox!.getCenter(out);
      return;
    }
  }

  /** Take the portraits (once, after the shaders are compiled). */
  develop(renderDream: (target: WebGLRenderTarget, camera: PerspectiveCamera) => void): void {
    this.stage.visible = true;
    this.flash.intensity = FLASH.intensity;
    for (const { film, camera } of this.portraits) {
      this.flash.position.copy(camera.position);
      this.flash.position.y += FLASH.above;
      renderDream(film, camera);
    }
    this.flash.intensity = 0;
    this.stage.visible = false;
  }

  /** Swing everything for this moment (`motion` 0 = hanging still) and write the instances. */
  private pose(time: number, motion: number): void {
    const { amount, period } = L.sway;
    const w = TAU / period;
    const gustPeriod = dreamConfig.alive.gustPeriod;
    for (let i = 0; i < this.hung.length; i++) {
      const p = this.hung[i];
      const gust = GUST.floor + (1 - GUST.floor) * Math.max(0, Math.sin((time / gustPeriod) * TAU + p.gust)) ** 2;
      const amp = amount * gust * motion;
      const swing = amp * ((1 - HARMONIC.share) * Math.sin(time * w + p.phase) + HARMONIC.share * Math.sin(time * w * HARMONIC.ratio + p.phase * 2));
      const twist = amp * TWIST * Math.cos(time * w + p.phase);
      quaternion.setFromEuler(euler.set(swing, p.yaw + twist, p.roll, 'YZX'));
      p.pose.compose(p.at, quaternion, UNIT);
    }
    for (let b = 0; b < this.batches.length; b++) {
      const { mesh, items } = this.batches[b];
      for (let j = 0; j < items.length; j++) mesh.setMatrixAt(j, matrix.multiplyMatrices(this.hung[items[j].hung].pose, items[j].local));
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (let j = 0; j < this.maskItems.length; j++) {
      const item = this.maskItems[j];
      this.masks.setMatrix(j, matrix.multiplyMatrices(this.hung[item.hung].pose, item.local));
    }
    this.masks.commit();
  }

  /** Each swings about its top edge, in its own phase (still for reduced motion). */
  update(frame: DreamFrame): void {
    if (REDUCED_MOTION || frame.paused) return;
    this.clock += frame.dt;
    this.pose(this.clock, range(0, STIR, this.clock));
  }

  /** Hanging still, as in the photograph. */
  reset(): void {
    this.clock = 0;
    this.pose(0, 0);
  }
}
