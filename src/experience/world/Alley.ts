import {
  Box3,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  SpotLight,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { HomeWindow, StreetFigure, WakeSpec } from '../../config/film.config';
import { ALLEY, curtainConfig, FACADES, fireEscape, LIGHT_COLORS, lightingConfig } from '../../config/scene.config';
import { LAYERS, REDUCED_MOTION, renderConfig } from '../../config/experience.config';
import { DEG } from '../math';
import type { Assets, MaterialMaps } from '../assets/Assets';
import type { Crowd, FigureKit, FigureSpec } from '../dream/FigureKit';
import { FACING_ANGLE, FacadeBuilder, type FacadeSpec } from './FacadeBuilder';
import { instance, reflectionOnlyGlass } from './props';

type V3 = readonly [number, number, number];

/**
 * The window of the house: the pair of windows on the first floor of the building across the end of the street,
 * straight ahead of the photographer (each 0.7 m wide, a wall between them; a big lower pane, six small lites
 * above). One curtain picture hangs behind both, lit from the room; it exists only in the real street (the dream
 * never draws the far end).
 */
export const HOME = {
  /** Center of the curtain (m, world: just behind the glass, in front of the frames' backs) and what it covers (m: a little more than the glass; the frames hide the rest). */
  center: [0, 4.3, -45.21] as V3,
  size: [2.24, 1.54] as const,
  /** Its picture (px), redrawn only when what it shows changes. */
  canvas: [512, 352] as const,
  /** The room's floor, below the bottom of the curtain (m). */
  floor: -0.53,
  /** Brightness of the lit curtain (linear multiplier of its picture), for the lamp and for the television. */
  glow: { lamp: 4, tv: 2.2 },
  /** Light the room spills into the street at full brightness (cd), how far it reaches (m), how far in front of the glass it sits (m). */
  spill: { intensity: 7, distance: 10, ahead: 0.9 },
  /** The television's slow flicker: how deep it is (share of its light), and the frequencies it is made of (Hz, all under 1). */
  flicker: { depth: 0.38, hz: [0.23, 0.41, 0.67] as const, weights: [0.5, 0.3, 0.2] as const },
  /** Under reduced motion the flicker keeps this share of its depth. */
  flickerReduced: 0.35,
  /** Color of the television's light. */
  tvColor: 0x8fb0ff,
} as const;

/**
 * Where those at the table sit (m across from the middle of the pair: two in each window's lower pane), and the
 * empty chair at the fourth place.
 */
const PLACES = { mother: -0.9, father: -0.56, little: 0.56, you: 0.87 } as const;
/**
 * Heights of their shadows on the curtain above the room's floor (m): the lamp hangs above them, so the shadows fall
 * a little lower than they sit (a seated head, the little one's, the table top, the top of a chair's back); and
 * the head of the one who stands close at the curtain, where her shadow is her own height.
 */
const HEIGHTS = { head: 0.98, littleHead: 0.86, table: 0.66, chair: 1, standing: 1.62 } as const;
/** Where the mother stands at the curtain (m across), and the lamp over the table (m across, m above the floor). */
const AT_CURTAIN = -0.72;
const LAMP = [-0.62, 1.85] as const;
/** How far the lamp's light reaches across the curtain (m). */
const LAMP_REACH = 2.1;

/** The ones who have left the window, as they stand in the street between the evenings (see FigureKit). */
const CAST: Record<StreetFigure, FigureSpec> = {
  /** Long white hair over a face that is not there. */
  mother: { avatar: 'figure_woman', clip: 'f_idle_touch_hair_01', time: 0, face: 'hollow', veil: true },
  /** The man with no head who walks every corridor. */
  father: { avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 0.2, half: 'lower', cutAt: 1.47, bleach: 0.35 },
  /** Stitched cloth, a hole for a face. */
  little: { avatar: 'figure_nurse', clip: 'f_idle_touch_hair_01', time: 0, skin: 'sack', face: 'hollow', white: false },
};

/** How much of its light a television gives at `time` (s): a slow, uneven breathing, never faster than once a second. */
function flicker(time: number): number {
  const f = HOME.flicker;
  let wave = 0;
  f.hz.forEach((hz, i) => (wave += f.weights[i] * Math.sin(Math.PI * 2 * hz * time + i * 1.7)));
  return 1 - f.depth * (REDUCED_MOTION ? HOME.flickerReduced : 1) * (0.5 + 0.5 * wave);
}

interface PropOptions {
  nodes?: readonly string[];
  scale?: number;
  anchor?: 'bottom' | 'center' | 'top';
  castShadow?: boolean;
  /** Named props become anchors the story can act upon. */
  name?: string;
}

function pbr(maps: MaterialMaps, repeatX: number, repeatY: number, extra: Partial<MeshStandardMaterial> = {}): MeshStandardMaterial {
  const clone = (t: Texture) => {
    const c = t.clone();
    c.repeat.set(repeatX, repeatY);
    c.needsUpdate = true;
    return c;
  };
  const orm = clone(maps.ormMap);
  return new MeshStandardMaterial({
    map: clone(maps.map),
    normalMap: clone(maps.normalMap),
    roughnessMap: orm,
    aoMap: orm,
    metalnessMap: extra.metalness === 0 ? null : orm,
    metalness: 1,
    roughness: 1,
    ...extra,
  });
}

/** A ground slab whose UVs are in meters, so texture repeat = 1 / tile size. */
function slab(width: number, depth: number, material: Material, x: number, y: number, z: number): Mesh {
  const geo = new PlaneGeometry(width, depth, Math.ceil(width), Math.ceil(depth));
  geo.rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * width, uv.getY(i) * depth);
  geo.setAttribute('uv1', uv.clone());
  const m = new Mesh(geo, material);
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

/**
 * The real alley: modular facades, wet setts, lived-in props and practical lights.
 * Everything here exists both in the real moment and inside the photograph (LAYERS.WORLD).
 */
export class Alley {
  readonly root = new Group();
  /** The end of the alley: the cross street and what stands across it (the dream can take it away). */
  readonly farEnd = new Group();
  /** Named objects the story and the dream director act upon. */
  readonly anchors = new Map<string, Object3D>();
  /** The wet setts (their puddles reflect another sky inside the picture). */
  wetGround!: MeshStandardMaterial;
  /** Overhead cables, each able to sway around the line between its two fixings. */
  readonly cables: { pivot: Object3D; axis: Vector3; phase: number }[] = [];
  /** The bare bulb over the far door. */
  bulbLight: PointLight | undefined;
  /** The three spotlights: shared by the real moment and (moved around) by every space of the dream. */
  spots: SpotLight[] = [];
  /** The alley's small lights: real only (the dream gives its fixed pool of lights to their places). */
  readonly pointLights: PointLight[] = [];

  private readonly facadeBuilder = new FacadeBuilder();
  private readonly curtainTime = { value: 0 };

  /** The window of the house: what it shows, its picture, and the light it spills into the street (see setHome). */
  private shown: HomeWindow | null = null;
  private readonly homeCanvas = Object.assign(document.createElement('canvas'), { width: HOME.canvas[0], height: HOME.canvas[1] });
  private readonly homeTexture = new CanvasTexture(this.homeCanvas);
  private readonly homeMaterial = new MeshBasicMaterial({ map: this.homeTexture, color: 0x000000 });
  private readonly homeCurtain = new Mesh(new PlaneGeometry(HOME.size[0], HOME.size[1]), this.homeMaterial);
  /**
   * The window unlit: black, and not hazed by the air the way a lit window is, so that from far off it still stands
   * out as a dark hole in the house (its glass still lies over it).
   */
  private readonly homeDark = new Mesh(this.homeCurtain.geometry, new MeshBasicMaterial({ color: 0x000000, fog: false }));
  private readonly homeLight = new PointLight(LIGHT_COLORS.window, 0, HOME.spill.distance, 2);
  /** Those who stand in the street, one body each, and the list they stand by now. */
  private readonly cast = new Map<StreetFigure, Crowd>();
  private placed: WakeSpec['people'] = undefined;

  constructor(private readonly assets: Assets) {
    this.root.name = 'Alley';
    this.farEnd.name = 'FarEnd';
    this.root.add(this.farEnd);
    this.facadeBuilder.addKit('apartments', this.model('kit_apartments').scene);
    this.facadeBuilder.addKit('factory', this.model('kit_factory').scene);
    for (const key of ['wall_clock', 'hanging_lamp', 'lightbulb']) reflectionOnlyGlass(this.model(key).scene);
    this.buildFacades();
    this.buildGround();
    this.buildProps();
    this.buildCables();
    this.buildLights();
    this.buildCurtain();
    this.root.traverse((o) => o.layers.set(LAYERS.WORLD));
    for (const l of this.pointLights) l.layers.set(LAYERS.OUTER);
    this.buildHome();
  }

  private model(key: string) {
    const m = this.assets.models.get(key);
    if (!m) throw new Error(`model not loaded: ${key}`);
    return m;
  }

  /** Place a model by its bounds (see props.ts) under `parent` (the alley by default). */
  prop(
    key: string,
    at: V3,
    rotation: V3 = [0, 0, 0],
    opts: PropOptions = {},
    parent: Object3D = this.root,
  ): Object3D {
    const o = instance(this.model(key), { at, rotation, scale: opts.scale, anchor: opts.anchor, castShadow: opts.castShadow }, opts.nodes);
    o.name = opts.name ?? key;
    if (opts.name) this.anchors.set(opts.name, o);
    parent.add(o);
    return o;
  }

  /** Individual kit modules (e.g. scaled ones) baked like facades. */
  modules(placements: readonly { piece: string; position: Vector3; rotationY: number; scale?: number }[]): Group {
    for (const m of placements) this.facadeBuilder.place(m.piece, m.position, m.rotationY, m.scale);
    const group = this.facadeBuilder.build();
    this.tuneKitMaterials(group);
    return group;
  }

  /** A stretch of the same wet setts (alley width, `depth` long, centered at z). */
  groundSlab(width: number, depth: number, z: number): Mesh {
    return slab(width, depth, this.wetGround, 0, 0, z);
  }

  /** A spot on the front of the electrical cabinet (facing the alley) where a print can be taped. */
  cabinetFront(height: number): Vector3 {
    const box = new Box3().setFromObject(this.anchors.get('utilityBox')!);
    return new Vector3(box.min.x - 0.003, height, (box.min.z + box.max.z) / 2);
  }

  /** Build a set of facades from the street's kits (the dream extends the street with this). */
  facades(specs: readonly FacadeSpec[]): Group {
    for (const spec of specs) this.facadeBuilder.facade(spec);
    const group = this.facadeBuilder.build();
    this.tuneKitMaterials(group);
    return group;
  }

  // ------------------------------------------------------------------ architecture

  private buildFacades(): void {
    this.root.add(this.facades(FACADES.filter((f) => !f.region)));
    this.farEnd.add(this.facades(FACADES.filter((f) => f.region === 'far')));
  }

  private tuneKitMaterials(group: Group): void {
    // cold, peeling off-white plaster instead of the kit's salmon render
    const plaster = this.assets.materials.get('plaster_damaged')!;
    group.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as MeshStandardMaterial;
      if (mat.name.endsWith('_plaster') && !mat.userData.retextured) {
        mat.map = plaster.map;
        mat.normalMap = plaster.normalMap;
        mat.roughnessMap = plaster.ormMap;
        mat.aoMap = null;
        mat.color = new Color(0xd8d6d0);
        mat.userData.retextured = true;
        mat.needsUpdate = true;
      }
      if (/glass/.test(mat.name) && !mat.userData.tuned) {
        // old, slightly dirty panes: they reflect the dusk and let a lit room (or something else) show through
        mat.color = new Color(0x1a1f26);
        mat.roughness = 0.08;
        mat.metalness = 0.1;
        mat.transparent = true;
        mat.opacity = 0.62;
        mat.depthWrite = false;
        mat.forceSinglePass = true;
        mat.envMapIntensity = 1.4;
        mat.userData.tuned = true;
        mat.needsUpdate = true;
      }
    });
  }

  private buildGround(): void {
    const { halfWidth: hw, back, front, crossStreet: cs, mouth } = ALLEY;
    const setts = this.assets.materials.get('setts_wet')!;
    const concrete = this.assets.materials.get('concrete_worn')!;
    const asphalt = this.assets.materials.get('asphalt')!;
    const tile = 2.2;
    const alleyLen = back - front;
    // the setts read darker when wet: albedo pulled down, the puddles' gloss kept
    this.wetGround = pbr(setts, 1 / tile, 1 / tile, { metalness: 0, envMapIntensity: 1.25, color: new Color(0.62, 0.63, 0.66) });
    this.root.add(slab(hw * 2, alleyLen, this.wetGround, 0, 0, (back + front) / 2));
    const concreteTrim = pbr(concrete, 1 / 2.5, 1 / 2.5, { metalness: 0 });
    for (const side of [-1, 1]) this.root.add(slab(0.32, alleyLen, concreteTrim, side * (hw - 0.16), 0.004, (back + front) / 2));
    const street = pbr(asphalt, 1 / 4, 1 / 4, { metalness: 0, roughness: 0.9 });
    this.farEnd.add(slab(cs.halfLength * 2, cs.near - cs.far, street, 0, -0.005, (cs.near + cs.far) / 2));
    this.root.add(slab(mouth.halfLength * 2, mouth.far - mouth.near, street, 0, -0.005, (mouth.near + mouth.far) / 2));
    for (const [z, depth, parent] of [
      [cs.far + 0.9, 1.8, this.farEnd],
      [cs.near - 0.9, 1.8, this.farEnd],
      [mouth.near + 0.9, 1.8, this.root],
      [mouth.far - 0.9, 1.8, this.root],
    ] as const) {
      parent.add(slab(cs.halfLength * 2, depth, concreteTrim, 0, 0.12, z));
    }
  }

  // ------------------------------------------------------------------ props

  private buildProps(): void {
    const hw = ALLEY.halfWidth;
    // foreground left: downspout, fuse box, bins, bags, boxes
    for (let y = 0; y < 12; y += 1) this.prop('gutter_kit', [-hw + 0.11, y + 0.05, -1.25], [0, 0, 0], { nodes: ['modular_metal_gutter_section'], castShadow: false });
    this.prop('gutter_kit', [-hw + 0.15, 0.0, -1.1], [0, 90, 0], { nodes: ['modular_metal_gutter_outlet'] });
    this.prop('power_box', [-hw + 0.2, 1.35, -2.25], [0, 90, 0], { anchor: 'center' });
    // its cable climbs the wall and runs back to the lantern
    const wall = -hw + 0.018;
    this.prop('cable_kit', [wall, 1.78, -2.25], [0, 90, 0], { nodes: ['cable_box_3way'], anchor: 'center', castShadow: false });
    for (let y = 2.18; y < 3.9; y += 0.6) this.prop('cable_kit', [wall, y, -2.25], [0, 90, 0], { nodes: ['cable_straight_long'], anchor: 'center', castShadow: false });
    this.prop('cable_kit', [wall, 4.0, -2.18], [0, 90, 0], { nodes: ['cable_turn_long'], anchor: 'center', castShadow: false });
    for (let z = -1.75; z < 2.6; z += 0.6) this.prop('cable_kit', [wall, 4.08, z], [0, 90, 90], { nodes: ['cable_straight_long'], anchor: 'center', castShadow: false });
    for (let z = -1.2; z < 2.6; z += 1.2) this.prop('cable_kit', [wall, 4.08, z], [0, 90, 90], { nodes: ['cable_mount'], anchor: 'center', castShadow: false });
    this.prop('trash_can', [-hw + 0.4, 0, -3.6], [0, 90, 0], { nodes: ['metal_trash_can', 'metal_trash_can_lid', 'metal_trash_can_handle_left', 'metal_trash_can_handle_right'] });
    this.prop('trash_can', [-hw + 0.38, 0, -4.4], [0, 70, 0], { nodes: ['metal_trash_can_rust', 'metal_trash_can_rust_handle_left', 'metal_trash_can_rust_handle_right'] });
    this.prop('trashbag', [-hw + 0.5, 0, -5.25], [0, 30, 0]);
    this.prop('trashbag', [-hw + 0.95, 0, -4.9], [0, 140, 0], { scale: 0.85 });
    this.prop('cardboard_box', [-hw + 0.35, 0, -2.85], [0, 15, 0]);
    this.prop('cardboard_box', [-hw + 0.33, 0.34, -2.9], [0, 80, 0], { scale: 0.9 });
    this.prop('weeds', [-hw + 0.22, 0, -6.4], [0, 90, 0], { nodes: ['weed_plant_02_a_LOD0'], castShadow: false });
    this.prop('weeds', [hw - 0.2, 0, -2.4], [0, -90, 0], { nodes: ['weed_plant_02_b_LOD0'], castShadow: false });
    this.prop('weeds', [hw - 0.18, 0, -16.2], [0, -90, 0], { nodes: ['weed_plant_02_c_LOD0'], castShadow: false });

    // foreground right: utility cabinet, apartment door with a plant, the stopped clock
    this.prop('utility_box', [hw - 0.24, 0, -1.6], [0, -90, 0], { name: 'utilityBox' });
    this.prop('potted_plant', [hw - 0.42, 0, -5.4], [0, 20, 0], { name: 'plant' });
    this.prop('planter_pot', [hw - 0.25, 0, -8.6], [0, 0, 0]);
    this.prop('wall_clock', [hw - 0.02, 3.35, -7.5], [0, -90, 0], { anchor: 'center', name: 'clock', castShadow: false });
    this.prop('monobloc_chair', [hw - 0.45, 0, -10.6], [0, -110, 0], { name: 'chair' });
    this.prop('aircon', [-hw + 0.2, 3.3, -8.2], [0, 90, 0], { nodes: ['exterior_aircon_unit'], anchor: 'center' });
    this.prop('aircon', [hw - 0.2, 6.4, -12.6], [0, -90, 0], { nodes: ['exterior_aircon_unit_rusted'], anchor: 'center' });
    this.prop('security_light', [hw - 0.12, 3.25, -13.5], [0, -90, 0], { anchor: 'center', name: 'securityLight' });
    this.prop('security_camera', [hw - 0.08, 4.4, -3.6], [0, -125, 0], { anchor: 'center', name: 'cctv' });
    this.prop('manhole', [0.35, 0.002, -9.2]);

    // mid / far: crates, the fire escape, a bare bulb over a far door
    this.prop('wooden_crate', [hw - 0.4, 0, -16.8], [0, 90, 0]);
    this.prop('plastic_crate', [hw - 0.35, 0.46, -16.6], [0, 80, 0]);
    this.prop('plastic_crate', [hw - 0.5, 0, -17.6], [0, 20, 0]);
    this.prop('trashbag', [-hw + 0.45, 0, -22.4], [0, 70, 0]);
    const fe = fireEscape;
    for (const y of fe.platforms) this.prop('fire_escape', [fe.x, y, fe.platformZ], [0, 90, 0], { nodes: fe.platformNodes });
    this.prop('fire_escape', [fe.x, fe.platforms[1] - fe.stairsDrop, fe.stairsZ], [0, 90, 0], { nodes: fe.stairsNodes });
    this.prop('hanging_lamp', [0.15, 6.05, -17.6], [0, 30, 0], { anchor: 'top', name: 'hangingLamp' });
    this.prop('pull_chain_socket', [-hw + 0.28, 3.05, -28.5], [0, 0, 0], { anchor: 'top' });
    this.prop('lightbulb', [-hw + 0.28, 2.88, -28.5], [180, 0, 0], { anchor: 'top', name: 'bulb' });

    // behind the photographer: the wall lantern (key light) and a small café corner
    this.prop('street_lamp_wall', [-hw + 0.43, 3.0, 3.0], [0, 90, 0], { anchor: 'center', name: 'lantern' });
    this.prop('cafe_set', [hw - 0.6, 0, 3.4], [0, 0, 0], { name: 'cafe' });
    this.prop('street_lamp_post', [2.8, 0.12, -39.6], [0, -90, 0], {}, this.farEnd);
    this.prop('street_lamp_post', [-6.5, 0.12, 16.2], [0, 90, 0]);

    // practical lamps glow
    this.root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as MeshStandardMaterial;
      if (/(street_lamp_0[12]_glass|security_light_glass|lightbulb_01_glass)/.test(mat.name) && !mat.userData.glow) {
        mat.emissive = new Color(/security/.test(mat.name) ? LIGHT_COLORS.coolLed : LIGHT_COLORS.tungsten);
        mat.emissiveIntensity = lightingConfig.lampGlow;
        mat.userData.glow = true;
      }
    });
  }

  /** Sagging overhead cables between the facades (catenaries as real tubes). */
  private buildCables(): void {
    const hw = ALLEY.halfWidth;
    const mat = new MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.55 });
    const spans: [number, number, number, number, number][] = [
      // z1, y1, z2, y2, sag
      [-4.5, 5.4, -6.0, 5.9, 0.55],
      [-6.2, 6.1, -5.4, 6.4, 0.7],
      [-14.0, 7.2, -15.5, 6.8, 0.6],
      [-19.0, 5.6, -19.8, 5.9, 0.45],
      [-26.0, 7.8, -24.5, 7.4, 0.8],
      [1.5, 5.8, 0.2, 6.2, 0.6],
    ];
    const cables = new Group();
    cables.name = 'cables';
    for (const [z1, y1, z2, y2, sag] of spans) {
      const a = new Vector3(-hw + 0.05, y1, z1);
      const b = new Vector3(hw - 0.05, y2, z2);
      const pivot = new Object3D();
      pivot.position.copy(a).add(b).multiplyScalar(0.5);
      const pts: Vector3[] = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        pts.push(new Vector3().lerpVectors(a, b, t).sub(pivot.position).add(new Vector3(0, -sag * 4 * t * (1 - t), 0)));
      }
      const tube = new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), 48, 0.011, 6), mat);
      tube.castShadow = true;
      pivot.add(tube);
      cables.add(pivot);
      this.cables.push({ pivot, axis: new Vector3().subVectors(b, a).normalize(), phase: z1 * 1.7 });
    }
    this.anchors.set('cables', cables);
    this.root.add(cables);
  }

  /** A sheer curtain in the lit room: real geometry, waved by a draught in the vertex shader. */
  private buildCurtain(): void {
    const glow = this.anchors.get(curtainConfig.window);
    if (!glow) return;
    const c = curtainConfig;
    const geo = new PlaneGeometry(c.width, c.height, 10, 24);
    const mat = new MeshStandardMaterial({
      color: c.color,
      roughness: 0.95,
      transparent: true,
      opacity: c.opacity,
      side: DoubleSide,
      forceSinglePass: true,
      depthWrite: false,
    });
    mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uTime = this.curtainTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uTime;`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float hang = clamp(0.5 - position.y / ${c.height.toFixed(3)}, 0.0, 1.0);
          float folds = sin(position.x * 26.0) * 0.012;
          transformed.z += folds + hang * hang * ${c.sway.toFixed(3)} * sin(uTime * ${c.speed.toFixed(2)} + position.x * 3.0 + sin(uTime * 0.37) * 1.5);`,
        );
    };
    const curtain = new Mesh(geo, mat);
    // in front of the room's back wall, drawn across the left half of the window
    curtain.position.copy(glow.position).add(new Vector3(0, 0, c.inset).applyQuaternion(glow.quaternion));
    curtain.position.add(new Vector3(-c.width * c.drawn, 0, 0).applyQuaternion(glow.quaternion));
    curtain.quaternion.copy(glow.quaternion);
    this.root.add(curtain);
  }

  /** Advance the small motions owned by the alley itself. */
  tick(time: number): void {
    this.curtainTime.value = time;
  }

  // ------------------------------------------------------------------ the window of the house

  private buildHome(): void {
    this.homeTexture.colorSpace = SRGBColorSpace;
    this.homeCurtain.name = 'homeWindow';
    this.homeCurtain.position.set(...HOME.center);
    this.homeDark.position.set(...HOME.center);
    this.homeDark.visible = false;
    this.homeLight.position.set(HOME.center[0], HOME.center[1], HOME.center[2] + HOME.spill.ahead);
    for (const o of [this.homeCurtain, this.homeDark, this.homeLight]) o.layers.set(LAYERS.OUTER);
    this.farEnd.add(this.homeCurtain, this.homeDark, this.homeLight);
  }

  /** What the window of the house shows now (null before it is first set). */
  get homeShown(): HomeWindow | null {
    return this.shown;
  }

  /** Show the window of the house in this state; `time` (s) drives the television's flicker. Its picture is redrawn only when what it shows changes. */
  setHome(state: HomeWindow, time: number): void {
    const was = this.shown;
    const dark = state.kind === 'dark';
    if (!dark && (!was || was.kind !== state.kind || was.seated !== state.seated || Boolean(was.standing) !== Boolean(state.standing) || (was.drawn ?? 0) !== (state.drawn ?? 0))) this.drawHome(state);
    this.shown = state;
    this.homeCurtain.visible = !dark;
    this.homeDark.visible = dark;
    const tv = state.kind === 'tv';
    const lit = dark ? 0 : state.light * (tv ? flicker(time) : 1);
    this.homeMaterial.color.setScalar(lit * (tv ? HOME.glow.tv : HOME.glow.lamp));
    this.homeLight.color.setHex(tv ? HOME.tvColor : LIGHT_COLORS.window);
    this.homeLight.intensity = lit * HOME.spill.intensity;
  }

  /**
   * Paint the curtain: the room's light coming through it and the shadows of those at the table, soft as a lamp
   * behind them throws them on the cloth (the one who stands at the curtain sharp); where it is drawn aside, the
   * room itself.
   */
  private drawHome(state: HomeWindow): void {
    const g = this.homeCanvas.getContext('2d')!;
    const [w, h] = HOME.canvas;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    this.homeTexture.needsUpdate = true;
    // from here on in meters: x across from the window's center, y up from the room's floor
    const s = w / HOME.size[0];
    g.setTransform(s, 0, 0, -s, w / 2, h - HOME.floor * s);
    const [left, right] = [-HOME.size[0] / 2, HOME.size[0] / 2];
    const [bottom, top] = [-HOME.floor, HOME.size[1] - HOME.floor];
    const tv = state.kind === 'tv';
    /** A shape filled only with its blurred shadow (`blur` px), which is how a shadow on a curtain looks. */
    const OFF = 10;
    const soft = (blur: number, color: string, shape: () => void) => {
      g.save();
      g.translate(OFF, 0);
      g.shadowColor = color;
      g.shadowBlur = blur;
      g.shadowOffsetX = -OFF * s;
      g.fillStyle = '#000';
      g.beginPath();
      shape();
      g.fill();
      g.restore();
    };
    /** Head and shoulders, down past the table (`size` 1: an adult); a bun of hair on the mother. */
    const person = (x: number, head: number, size: number, bun: boolean) => {
      g.moveTo(x + 0.085 * size, head);
      g.ellipse(x, head, 0.085 * size, 0.105 * size, 0, 0, Math.PI * 2);
      if (bun) {
        g.moveTo(x + 0.025 + 0.045 * size, head + 0.1 * size);
        g.ellipse(x + 0.025, head + 0.1 * size, 0.045 * size, 0.04 * size, 0, 0, Math.PI * 2);
      }
      g.moveTo(x - 0.04 * size, head - 0.07 * size);
      g.lineTo(x - 0.05 * size, head - 0.15 * size);
      g.quadraticCurveTo(x - 0.18 * size, head - 0.17 * size, x - 0.2 * size, head - 0.36 * size);
      g.lineTo(x - 0.21 * size, -0.2);
      g.lineTo(x + 0.21 * size, -0.2);
      g.lineTo(x + 0.2 * size, head - 0.36 * size);
      g.quadraticCurveTo(x + 0.18 * size, head - 0.17 * size, x + 0.05 * size, head - 0.15 * size);
      g.lineTo(x + 0.04 * size, head - 0.07 * size);
      g.closePath();
    };
    /** The back of a dining chair above the table: two posts with knobs, an arched top rail, three spindles. */
    const chair = (x: number) => {
      const top = HEIGHTS.chair;
      const half = 0.17;
      for (const side of [-1, 1]) {
        g.rect(x + side * half - 0.018, -0.2, 0.036, top + 0.2);
        g.moveTo(x + side * half + 0.028, top + 0.02);
        g.ellipse(x + side * half, top + 0.02, 0.028, 0.028, 0, 0, Math.PI * 2);
      }
      g.moveTo(x - half, top - 0.1);
      g.quadraticCurveTo(x, top + 0.02, x + half, top - 0.1);
      g.lineTo(x + half, top - 0.05);
      g.quadraticCurveTo(x, top + 0.07, x - half, top - 0.05);
      g.closePath();
      for (const at of [-0.07, 0, 0.07]) g.rect(x + at - 0.01, -0.2, 0.02, top - 0.03 + 0.2);
    };
    // who is at the table: those who leave go in the story's order, and the fourth place is yours
    const family = ['mother', 'father', 'little'] as const;
    const sitting = family.slice(family.length - Math.min(family.length, state.seated));
    const table = (blur: number, color: string) => {
      for (const who of sitting) soft(blur, color, () => person(PLACES[who], who === 'little' ? HEIGHTS.littleHead : HEIGHTS.head, who === 'little' ? 0.8 : 1, who === 'mother'));
      soft(blur, color, () => (state.seated > family.length ? person(PLACES.you, HEIGHTS.head, 1, false) : chair(PLACES.you)));
      soft(blur * 0.8, color, () => g.rect(left - 0.1, -0.2, HOME.size[0] + 0.2, HEIGHTS.table + 0.2));
    };

    // the curtain, lit from behind: brightest round the lamp over the table, or low by the television
    const glow = tv ? g.createRadialGradient(0.7, 0.75, 0, 0.7, 0.75, LAMP_REACH) : g.createRadialGradient(LAMP[0], LAMP[1], 0, LAMP[0], LAMP[1], LAMP_REACH);
    const stops: readonly (readonly [number, string])[] = tv
      ? [[0, '#e6f0ff'], [0.4, '#7d9be0'], [1, '#18223e']]
      : [[0, '#fff4dc'], [0.3, '#ffc98a'], [0.75, '#b06a30'], [1, '#4a2410']];
    for (const [at, color] of stops) glow.addColorStop(at, color);
    g.fillStyle = glow;
    g.fillRect(left, bottom, HOME.size[0], HOME.size[1]);
    // it hangs in soft vertical folds
    const folds = 90;
    for (let i = 0; i < folds; i++) {
      const f = 0.5 + 0.5 * Math.sin(i * 0.9 + Math.sin(i * 0.31) * 2.2);
      g.fillStyle = `rgba(0, 0, 0, ${(0.16 * f).toFixed(3)})`;
      g.fillRect(left + (i * HOME.size[0]) / folds, bottom, HOME.size[0] / folds, HOME.size[1]);
    }
    const shade = tv ? 'rgba(8, 12, 30, 0.85)' : 'rgba(38, 16, 6, 0.86)';
    table(6, shade);
    if (state.standing) {
      // the mother at the curtain, looking out: close to the cloth, so her shadow is sharp; a hand holds its edge
      soft(1.5, shade, () => {
        person(AT_CURTAIN, HEIGHTS.standing, 1.15, true);
        g.moveTo(AT_CURTAIN + 0.3, HEIGHTS.standing - 0.3);
        g.ellipse(AT_CURTAIN + 0.26, HEIGHTS.standing - 0.3, 0.04, 0.055, 0, 0, Math.PI * 2);
      });
    }

    const drawn = Math.min(1, state.drawn ?? 0) * HOME.size[0];
    if (drawn > 0) {
      g.save();
      g.beginPath();
      g.rect(left, bottom, drawn, HOME.size[1]);
      g.clip();
      // the room itself: its back wall bright round the lamp and dark in the corners
      const wall = g.createRadialGradient(LAMP[0], LAMP[1] - 0.1, 0, LAMP[0], LAMP[1] - 0.1, 1.6);
      for (const [at, color] of [[0, '#ffd9a0'], [0.25, '#c98a4e'], [0.7, '#5a3018'], [1, '#1e0e06']] as const) wall.addColorStop(at, color);
      g.fillStyle = wall;
      g.fillRect(left, bottom, HOME.size[0], HOME.size[1]);
      // the lamp: a dark shade and its bright mouth
      g.fillStyle = '#1a0d06';
      g.beginPath();
      g.moveTo(LAMP[0] - 0.06, LAMP[1] + 0.12);
      g.lineTo(LAMP[0] + 0.06, LAMP[1] + 0.12);
      g.lineTo(LAMP[0] + 0.18, LAMP[1] - 0.04);
      g.lineTo(LAMP[0] - 0.18, LAMP[1] - 0.04);
      g.closePath();
      g.rect(LAMP[0] - 0.006, LAMP[1] + 0.12, 0.012, top);
      g.fill();
      g.fillStyle = '#fff6e0';
      g.beginPath();
      g.ellipse(LAMP[0], LAMP[1] - 0.045, 0.17, 0.03, 0, 0, Math.PI * 2);
      g.fill();
      // those at the table, seen straight: dark against the wall; the cloth on the table catches the lamp
      table(1.2, 'rgba(12, 6, 3, 0.95)');
      g.fillStyle = '#f3dcb8';
      g.fillRect(left, HEIGHTS.table - 0.03, HOME.size[0], 0.03);
      g.restore();
      // the curtain gathered at the side
      const gathered = 0.16;
      const edge = g.createLinearGradient(left, 0, left + gathered, 0);
      edge.addColorStop(0, '#5a3418');
      edge.addColorStop(0.6, '#e8b27a');
      edge.addColorStop(1, '#7a4422');
      g.fillStyle = edge;
      g.fillRect(left, bottom, gathered, HOME.size[1]);
    }

    // the corners of the window are darker than its middle
    const corners = g.createRadialGradient(0, (bottom + top) / 2, 0.3, 0, (bottom + top) / 2, 1.4);
    corners.addColorStop(0, 'rgba(0, 0, 0, 0)');
    corners.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    g.fillStyle = corners;
    g.fillRect(left, bottom, right - left, top - bottom);
  }

  // ------------------------------------------------------------------ the people in the street

  /** Make the bodies of those who stand in the street between the evenings (each hidden until placed). */
  castFrom(figures: FigureKit): void {
    for (const who of Object.keys(CAST) as StreetFigure[]) {
      const crowd = figures.crowd(CAST[who], 1);
      crowd.root.traverse((o) => o.layers.set(LAYERS.OUTER));
      crowd.root.visible = false;
      this.cast.set(who, crowd);
      this.root.add(crowd.root);
    }
  }

  /** Stand them where a waking puts them, each facing the photographer (none given: nobody in the street). */
  setPeople(people: WakeSpec['people']): void {
    if (people === this.placed) return;
    this.placed = people;
    for (const crowd of this.cast.values()) crowd.root.visible = false;
    for (const { who, at: [x, z] } of people ?? []) {
      const crowd = this.cast.get(who);
      if (!crowd) continue;
      crowd.set(0, x, 0, z, Math.atan2(-x, -z));
      crowd.commit();
      crowd.root.visible = true;
    }
  }

  // ------------------------------------------------------------------ light

  private buildLights(): void {
    const spot = (cfg: { position: V3; target: V3; intensity: number; angle: number; penumbra: number; color: number }) => {
      const l = new SpotLight(cfg.color, cfg.intensity, 0, cfg.angle * DEG, cfg.penumbra, 2);
      l.position.set(...cfg.position);
      l.target.position.set(...cfg.target);
      this.root.add(l, l.target);
      return l;
    };
    // only the lantern behind the photographer casts shadows: the long shadow down the alley
    const key = spot(lightingConfig.key);
    const ks = lightingConfig.key.shadow;
    key.castShadow = true;
    key.shadow.mapSize.setScalar(renderConfig.shadowMapSize);
    key.shadow.camera.near = ks.near;
    key.shadow.camera.far = ks.far;
    key.shadow.bias = ks.bias;
    key.shadow.normalBias = ks.normalBias;
    key.shadow.radius = ks.radius;
    this.spots = [key, spot(lightingConfig.security), spot(lightingConfig.crossStreet)];

    const b = lightingConfig.bulb;
    this.bulbLight = new PointLight(b.color, b.intensity, b.distance, 2);
    this.bulbLight.position.set(...b.position);
    this.root.add(this.bulbLight);
    this.pointLights.push(this.bulbLight);

    // warm rooms behind a few windows
    const r = lightingConfig.room;
    for (const w of lightingConfig.windows) {
      const glow = new Mesh(
        new PlaneGeometry(w.width, w.height),
        new MeshStandardMaterial({ color: 0x000000, emissive: LIGHT_COLORS.window, emissiveIntensity: w.intensity * r.glow }),
      );
      const yaw = FACING_ANGLE[w.facing];
      glow.position.set(w.position[0], w.position[1], w.position[2]);
      glow.rotation.y = yaw;
      const parent = w.position[2] < ALLEY.crossStreet.near ? this.farEnd : this.root;
      parent.add(glow);
      if (w.name) this.anchors.set(w.name, glow);
      if (w.unlit) continue;
      // the room's light sits between its back wall and the window, so it spills into the alley
      const room = new PointLight(LIGHT_COLORS.window, w.intensity, r.distance, 2);
      room.position.copy(glow.position).add(new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(r.offset));
      parent.add(room);
      this.pointLights.push(room);
    }
  }
}
