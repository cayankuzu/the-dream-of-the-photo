import {
  Box3,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  SpotLight,
  TubeGeometry,
  Vector3,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { ALLEY, curtainConfig, FACADES, fireEscape, LIGHT_COLORS, lightingConfig } from '../../config/scene.config';
import { LAYERS, renderConfig } from '../../config/experience.config';
import { DEG } from '../math';
import type { Assets, MaterialMaps } from '../assets/Assets';
import { FACING_ANGLE, FacadeBuilder, type FacadeSpec } from './FacadeBuilder';
import { instance, reflectionOnlyGlass } from './props';

type V3 = readonly [number, number, number];

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

  private readonly facadeBuilder = new FacadeBuilder();
  private readonly curtainTime = { value: 0 };

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
    spot(lightingConfig.security);
    const cross = spot(lightingConfig.crossStreet);
    this.farEnd.add(cross, cross.target);

    const b = lightingConfig.bulb;
    this.bulbLight = new PointLight(b.color, b.intensity, b.distance, 2);
    this.bulbLight.position.set(...b.position);
    this.root.add(this.bulbLight);

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
    }
  }
}
