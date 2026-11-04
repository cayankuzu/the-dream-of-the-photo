import {
  Color,
  FogExp2,
  Group,
  HalfFloatType,
  type InstancedMesh,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Quaternion,
  Scene,
  type Sphere,
  SpotLight,
  Vector3,
  WebGLRenderTarget,
  type Material,
  type Texture,
} from 'three';
import { LAYERS, REDUCED_MOTION, renderConfig, shotsConfig } from '../../config/experience.config';
import { dreamConfig as D } from '../../config/dream.config';
import { fearConfig, LAYOUT, REGION_BLEND, REGION_MARGIN, REGIONS, warpConfig, type RegionLook, type RegionName, type SpotSpec } from '../../config/nightmare.config';
import { ALLEY, fireEscape, lightingConfig } from '../../config/scene.config';
import { inSea, seaConfig } from '../../config/sea.config';
import type { Assets } from '../assets/Assets';
import type { Photographer } from '../character/Photographer';
import { rigClock, setClock, type ClockHand } from '../dream/ClockRig';
import { AlleyDream } from '../dream/AlleyDream';
import { Darkroom } from '../dream/Darkroom';
import { DreamKit } from '../dream/DreamKit';
import type { DreamFrame, DreamModule } from '../dream/DreamModule';
import { DreamSea } from '../dream/DreamSea';
import { FleshTunnel } from '../dream/FleshTunnel';
import { GiantPrint } from '../dream/GiantPrint';
import { HallShell } from '../dream/hall/HallShell';
import { HallTableaux } from '../dream/hall/HallTableaux';
import { Moments, type MomentPass } from '../dream/Moments';
import { Street } from '../dream/Street';
import { TheVoid } from '../dream/TheVoid';
import type { LookControls, PointOfInterest } from '../interaction/LookControls';
import { clamp, DEG, lerp, range, smootherstep, wobble } from '../math';
import { Photograph } from '../photograph/Photograph';
import { Grade, type GradeParams } from '../render/Grade';
import { warp } from '../render/Warp';
import { GlideTrack } from '../timeline/Track';
import type { Alley } from '../world/Alley';
import type { SkyDome } from '../world/SkyDome';

/** The reflections of a space: what lights it, by name (see RegionLook.env). */
export type DreamEnvironments = Readonly<Record<RegionLook['env'], Texture>>;

export interface DreamContext {
  scene: Scene;
  assets: Assets;
  alley: Alley;
  sky: SkyDome;
  photographer: Photographer;
  /** PMREMs of the same size: swapping them never recompiles anything. */
  environments: DreamEnvironments;
  /** The equirect sky over the dream. */
  fireSky: Texture;
  /** The live window target (the giant print looks into the sea through it). */
  portal: Texture;
  gradePhoto: Grade;
  look: LookControls;
  /** Render the real (outer) moment into a target from a camera (optionally reusing the last shadow maps). */
  renderReal: (target: WebGLRenderTarget, camera: PerspectiveCamera, reuseShadows?: boolean) => void;
  /** Render the dream into a target from a camera. */
  renderDream: (target: WebGLRenderTarget, camera: PerspectiveCamera) => void;
}

interface Pose {
  object: Object3D;
  position: Vector3;
  quaternion: Quaternion;
}

const v1 = new Vector3();
const forward = new Vector3();
const eye = new Vector3();
const windowAt = new Vector3();
const UP = new Vector3(0, 1, 0);
const SEA = new Vector3(...seaConfig.offset);
const VIEW_MARGIN = 12;
/** How far (m) curved space can move something of the alley off its place. */
const ALLEY_BEND = 12;
/** What ends this far (m) behind the eye is not drawn while the eye looks ahead. */
const BEHIND = 5;
/** Below this light nothing counts as seen. */
const BLACKOUT = 0.05;

/** True when a world point is outside the camera's view (margin in degrees; negative = well inside). */
function unseen(point: Vector3, camera: PerspectiveCamera, margin: number): boolean {
  forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const angle = forward.angleTo(v1.subVectors(point, camera.position)) / DEG;
  const halfV = camera.fov / 2;
  const halfH = Math.atan(Math.tan(halfV * DEG) * camera.aspect) / DEG;
  return angle > Math.max(halfV, halfH) + margin;
}

/** The opening shot: where the viewer first stood. */
function introCamera(aspect: number): PerspectiveCamera {
  const s = shotsConfig[0];
  const cam = new PerspectiveCamera(s.fov, aspect, renderConfig.near, renderConfig.far);
  cam.position.set(...s.position);
  const [x, y, z] = s.target as readonly [number, number, number];
  cam.lookAt(x, y, z);
  cam.updateMatrixWorld(true);
  cam.layers.set(LAYERS.WORLD);
  cam.layers.enable(LAYERS.OUTER);
  return cam;
}

const REAL_SPOTS: readonly SpotSpec[] = [lightingConfig.key, lightingConfig.security, lightingConfig.crossStreet];
/** The walk's own spaces, in order (the sea is apart). */
const WALK_REGIONS = REGIONS.filter((r) => r.name !== 'sea');
const SEA_REGION = REGIONS.find((r) => r.name === 'sea')!;
/** No warp near the start of the walk or while pictures develop. */
const WARP_CHANNELS = ['bendUp', 'bendAside', 'twist', 'wave'] as const;
const scratchColor = new Color();
/** Past the wall at the street's end nothing of the alley can be seen anymore (the slit is closed behind you). */
const ALLEY_SEEN_FROM = LAYOUT.hall.from - 6;
/** The beat of the heart comes in two: lub, dub. */
const SECOND_BEAT = { at: 0.28, strength: 0.65 };

/**
 * The nightmare: where everything is, how each space is lit and how curved it is, and who is told
 * what. The set pieces (dream/*) own what they show.
 * `setPass` switches shared objects between their real and dreamt state before each render.
 */
export class DreamDirector {
  readonly grade = new Grade();
  readonly giant: GiantPrint;
  readonly sea: DreamSea;
  readonly kit: DreamKit;
  /** A place for what only pictures see (put far below the world, shown only while it is photographed). */
  readonly stage = new Group();
  /** 0..1 how afraid the piece is, and its heart: the audio and the screen read these too. */
  fear = 0;
  heartbeat = 0;
  /** A beat fell this frame. */
  beat = false;
  /** A scare adds its own fear for a moment (decays by itself). */
  fearBoost = 0;
  /** The space of the camera of the last main pass. */
  region: RegionName = 'alley';
  /** The main pass needs its shadow map rendered once: the shadow-casting light has moved. */
  shadowDirty = true;
  /** Everything in the dream darkens together (0 = blackout), emissive things excepted. */
  set dim(value: number) {
    this.kit.lights.dim = value;
    this.dimmed = value;
  }

  private readonly root = new Group();
  private readonly modules: DreamModule[];
  private readonly far: DreamModule[];
  private readonly stairs = new Group();
  private readonly clockHands: ClockHand[];
  private readonly groundIntensity: number;
  private readonly fog: FogExp2;
  private readonly realFogColor = new Color(lightingConfig.fog.color);
  /** The opening view, aged: taped to the cabinet, and (mipmapped, for it is seen far away) the moon over the sea. */
  private readonly foundRT = new WebGLRenderTarget(D.found.resolution, D.found.resolution, {
    type: HalfFloatType,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
  });
  private readonly windowRT = new WebGLRenderTarget(D.window.resolution, Math.round(D.window.resolution / D.window.aspect), { type: HalfFloatType });
  private readonly windowCamera = introCamera(D.window.aspect);
  private readonly windowMaterial = new MeshBasicMaterial({ map: this.windowRT.texture, fog: false });
  private readonly windowGlow: Mesh | undefined;
  private readonly windowRoomMaterial: Material | undefined;
  private readonly chair: Pose | null;
  private readonly cctv: Pose | null;
  private readonly bulb: PointLight | undefined;
  private readonly bulbIntensity: number;
  private readonly moments = new Moments();
  private readonly spots: readonly SpotLight[];
  private readonly spotsByRegion = new Map<RegionName, readonly (SpotSpec | null)[]>();
  private readonly warpTracks: Record<(typeof WARP_CHANNELS)[number], GlideTrack>;
  private readonly fearTrack: GlideTrack;
  /** In a blackout nothing is seen: everything that moves when unseen moves then. */
  private readonly unseenAt = (point: Vector3, margin = VIEW_MARGIN) => this.dimmed < BLACKOUT || unseen(point, this.view, margin);
  private readonly frame: DreamFrame;
  private view!: PerspectiveCamera;
  private keySpot: SpotSpec | null = null;
  private previousPass: 'real' | 'dream' = 'real';
  private dimmed = 1;
  /** Space stays straight while the pictures develop. */
  private straight = false;
  private heartPhase = 0;
  private secondBeat = false;

  private insideTime = 0;
  private dreamClock = 0;
  private time = 0;
  private walk = 0;
  private frameCount = 0;
  private readonly state = { window: false, chair: false, stairs: false };

  constructor(private readonly ctx: DreamContext) {
    this.root.name = 'Dream';
    ctx.scene.add(this.root);
    this.fog = ctx.scene.fog as FogExp2;
    this.groundIntensity = ctx.alley.wetGround.envMapIntensity;
    // the rig outlives the alley: it stays in the scene (and in every shader) while the alley is not drawn
    this.spots = ctx.alley.spots;
    for (const l of this.spots) ctx.scene.add(l, l.target);

    const anchors = ctx.alley.anchors;
    const pose = (name: string): Pose | null => {
      const object = anchors.get(name);
      return object ? { object, position: object.position.clone(), quaternion: object.quaternion.clone() } : null;
    };
    this.chair = pose('chair');
    this.cctv = pose('cctv');
    this.windowGlow = anchors.get('roomWindow') as Mesh | undefined;
    this.windowMaterial.color.setScalar(D.window.brightness);
    if (this.windowGlow) {
      ctx.look.pointsOfInterest.push({ position: this.windowGlow.getWorldPosition(new Vector3()), radius: D.window.poiRadius, zoom: D.window.zoom, active: () => this.state.window, memory: 'window' });
    }
    this.windowRoomMaterial = this.windowGlow?.material as Material | undefined;
    this.bulb = ctx.alley.bulbLight;
    this.bulbIntensity = this.bulb?.intensity ?? 0;

    this.kit = new DreamKit({ assets: ctx.assets, alley: ctx.alley, photographer: ctx.photographer, look: ctx.look, renderDream: ctx.renderDream });
    // the alley's small lights, in the dream: from the same pool as everything else
    for (const l of ctx.alley.pointLights) this.kit.lights.add(l.getWorldPosition(new Vector3()), l.color.getHex(), l.intensity, l.distance);

    this.buildStairs();
    this.buildFoundPhotograph();
    this.giant = new GiantPrint(ctx.portal, this.kit);
    this.sea = new DreamSea(this.kit, { moments: this.moments.textures, moonPhoto: this.foundRT.texture });
    this.modules = [
      new AlleyDream(this.kit, this.moments.textures),
      new Street(this.kit),
      new HallShell(this.kit),
      new HallTableaux(this.kit),
      new Darkroom(this.kit),
      new FleshTunnel(this.kit),
      new TheVoid(this.kit, this.giant),
      this.sea,
    ];
    // compiled one by one, after what the first minutes need
    this.far = this.modules.filter((m) => !(m instanceof AlleyDream));
    for (const m of this.modules) {
      if (m.region && m.spots) this.spotsByRegion.set(m.region, m.spots);
      this.root.add(m.root);
    }
    this.root.add(this.stairs, this.giant.root, this.kit.lights.root, this.stage);
    this.root.traverse((o) => {
      o.layers.set(LAYERS.DREAM);
      // curved space moves things off their bounds: the dream is culled by whole set pieces instead
      o.frustumCulled = false;
    });
    // the alley stays culled by its bounds, widened by what curved space can do to it
    const widened = new Set<object>();
    ctx.alley.root.updateMatrixWorld(true);
    ctx.alley.root.traverse((o) => {
      const mesh = o as Mesh & { boundingSphere?: Sphere | null; computeBoundingSphere?: () => void };
      if (!mesh.isMesh || !mesh.frustumCulled) return;
      const instanced = 'boundingSphere' in mesh && (mesh as unknown as InstancedMesh).isInstancedMesh;
      if (instanced && !mesh.boundingSphere) mesh.computeBoundingSphere?.();
      if (!instanced && !mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      const holder = instanced ? mesh : mesh.geometry;
      if (widened.has(holder)) return;
      widened.add(holder);
      const sphere = instanced ? mesh.boundingSphere! : mesh.geometry.boundingSphere!;
      sphere.radius += ALLEY_BEND / mesh.matrixWorld.getMaxScaleOnAxis();
    });
    for (const m of this.far) this.root.remove(m.root);

    const keys = warpConfig.keys;
    const at = keys.map((k) => k.at);
    this.warpTracks = Object.fromEntries(
      WARP_CHANNELS.map((c) => [c, new GlideTrack(at, keys.map((k) => k[c] * (REDUCED_MOTION ? warpConfig.reducedMotion : 1)))]),
    ) as DreamDirector['warpTracks'];
    this.fearTrack = new GlideTrack(fearConfig.keys.map((k) => k[0]), fearConfig.keys.map((k) => k[1]));
    this.frame = {
      time: 0,
      dt: 0,
      paused: false,
      eye,
      view: null as unknown as PerspectiveCamera,
      walk: 0,
      fear: 0,
      heartbeat: 0,
      unseen: this.unseenAt,
    };

    const clock = anchors.get('clock');
    this.clockHands = clock ? rigClock(clock) : [];
    this.reset();
  }

  // ------------------------------------------------------------------ building the dream

  private buildStairs(): void {
    const { alley } = this.ctx;
    const fe = fireEscape;
    for (let y = D.stairs.from; y <= D.stairs.to; y += D.stairs.step) {
      alley.prop('fire_escape', [fe.x, y, fe.platformZ], [0, 90, 0], { nodes: fe.platformNodes, castShadow: false }, this.stairs);
      alley.prop('fire_escape', [fe.x, y - fe.stairsDrop, fe.stairsZ], [0, 90, 0], { nodes: fe.stairsNodes, castShadow: false }, this.stairs);
    }
  }

  /** A worn print of the very first view, taped to the cabinet behind you, dated today. */
  private buildFoundPhotograph(): void {
    const date = new Date().toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
    const print = new Photograph({ photo: this.foundRT.texture, grade: this.ctx.gradePhoto, aged: true, caption: date });
    print.curlAmount = D.found.curl;
    const spot = this.ctx.alley.cabinetFront(D.found.height);
    print.position.copy(spot);
    print.rotation.set(0, -Math.PI / 2, D.found.tilt * DEG, 'YXZ');
    this.root.add(print);
    this.ctx.look.pointsOfInterest.push({ position: spot, radius: D.found.radius, zoom: D.found.zoom, memory: 'found' } satisfies PointOfInterest);
  }

  /**
   * Develop everything the dream shows as pictures (once, after the shaders are compiled): the found
   * print and the moon (the opening view), the giant print's still of the sea, the moments.
   */
  developFirst(): void {
    this.renderReal(this.foundRT, introCamera(1));
    for (const m of this.modules) if (!this.far.includes(m)) m.develop?.(this.picture);
  }

  /**
   * What lies further on is made ready one set piece at a time: `compile` builds its shaders, then it
   * takes its pictures, so nothing stops once the piece plays, and the loader moves in the meantime.
   */
  async prepareFar(compile: (root: Group) => Promise<void>, onProgress: (share: number) => void): Promise<void> {
    const breathe = () => new Promise((resolve) => setTimeout(resolve));
    const steps = this.far.length + 1;
    for (let i = 0; i < this.far.length; i++) {
      const m = this.far[i];
      this.root.add(m.root);
      await compile(m.root);
      await breathe();
      m.develop?.(this.picture);
      onProgress((i + 1) / steps);
      await breathe();
    }
    const still = this.giant.stillCamera();
    // the still and the moments see each other (the giant print in a moment, the prints over the sea in
    // the still): develop the still on both sides of the moments
    this.picture(this.giant.stillRT, still);
    await this.moments.develop(
      (target: WebGLRenderTarget, camera: PerspectiveCamera, pass: MomentPass) => (pass === 'real' ? this.renderReal(target, camera) : this.picture(target, camera)),
      breathe,
    );
    this.picture(this.giant.stillRT, still);
  }

  /** A picture of the dream, in straight space, under the sky of the end. */
  private readonly picture = (target: WebGLRenderTarget, camera: PerspectiveCamera): void => {
    const walk = this.walk;
    this.straight = true;
    this.walk = 1;
    this.ctx.renderDream(target, camera);
    this.walk = walk;
    this.straight = false;
  };

  /** Run `work` (e.g. a shader precompile) with every behind-your-back change applied, then restore the state. */
  async whileFullyDreamt<T>(work: () => Promise<T>, camera: PerspectiveCamera): Promise<T> {
    const saved = { ...this.state };
    Object.assign(this.state, { window: true, chair: true, stairs: true });
    this.setPass('dream', camera);
    try {
      return await work();
    } finally {
      Object.assign(this.state, saved);
      this.setPass('dream', camera);
    }
  }

  /** The real moment, rendered into a target (shared objects switched to their real state first). */
  private renderReal(target: WebGLRenderTarget, camera: PerspectiveCamera, reuseShadows = false): void {
    const pass = this.previousPass;
    this.setPass('real', camera);
    this.ctx.renderReal(target, camera, reuseShadows);
    if (reuseShadows) this.previousPass = pass;
  }

  // ------------------------------------------------------------------ state

  /** Back to the instant of capture. */
  reset(): void {
    this.insideTime = 0;
    this.dreamClock = D.clock.stoppedAt;
    Object.assign(this.state, { window: false, chair: false, stairs: false });
    this.sea.figure.visible = true;
    for (const m of this.modules) m.reset?.();
  }

  /** Is this camera standing in the sea (beyond the giant print)? */
  static inSea(camera: PerspectiveCamera): boolean {
    return camera.position.z < seaConfig.boundaryZ;
  }

  /** The look of the air at a walk-frame z, blended around each border. */
  private readonly air = {
    fogColor: new Color(),
    fogDensity: 0,
    envIntensity: 0,
    sky: 0,
    env: 'evening' as RegionLook['env'],
    region: 'alley' as RegionName,
    grade: { exposure: 1, saturation: 1, warmth: 0, tint: 0, flare: 0 } as GradeParams,
  };

  private readAir(z: number, sea: boolean): void {
    const a = this.air;
    let from = SEA_REGION;
    let to = SEA_REGION;
    let t = 0;
    if (!sea) {
      // the last border already passed, and how far around it the camera stands
      let i = 0;
      while (i < WALK_REGIONS.length - 1 && z < WALK_REGIONS[i + 1].from - REGION_BLEND) i++;
      from = WALK_REGIONS[i];
      to = WALK_REGIONS[Math.min(i + 1, WALK_REGIONS.length - 1)];
      t = to === from ? 0 : smootherstep(range(to.from + REGION_BLEND, to.from - REGION_BLEND, z));
    }
    a.fogColor.setHex(from.fog.color).lerp(scratchColor.setHex(to.fog.color), t);
    a.fogDensity = lerp(from.fog.density, to.fog.density, t);
    a.envIntensity = lerp(from.envIntensity, to.envIntensity, t);
    a.sky = lerp(from.sky, to.sky, t);
    const near = t < 0.5 ? from : to;
    a.env = near.env;
    a.region = near.name;
    for (const k of ['exposure', 'saturation', 'warmth', 'tint', 'flare'] as const) a.grade[k] = lerp(from.grade[k], to.grade[k], t);
  }

  setPass(kind: 'real' | 'dream', camera: PerspectiveCamera): void {
    const dream = kind === 'dream';
    const sea = dream && DreamDirector.inSea(camera);
    const z = sea ? camera.position.z - SEA.z : camera.position.z;
    const { alley, sky, scene } = this.ctx;
    const walkLook = smootherstep(range(0, D.sky.fullAt, this.walk));

    // space
    const amount = warp.amount;
    if (dream && !this.straight) {
      const t = this.warpTracks;
      amount.x = t.bendUp.at(this.walk);
      amount.y = t.bendAside.at(this.walk);
      amount.z = t.twist.at(this.walk);
      amount.w = t.wave.at(this.walk);
    } else {
      amount.x = amount.y = amount.z = amount.w = 0;
    }

    // air, sky and reflections
    sky.position.copy(camera.position);
    sky.updateMatrixWorld();
    const s = sky.uniforms;
    if (dream) {
      this.readAir(z, sea);
      const a = this.air;
      this.fog.color.copy(a.fogColor);
      this.fog.density = a.fogDensity;
      scene.environment = this.ctx.environments[a.env];
      scene.environmentIntensity = a.envIntensity * this.dimmed;
      alley.wetGround.envMap = this.ctx.environments.fire;
      alley.wetGround.envMapIntensity = D.puddles.intensity * this.dimmed;
      s.tDream.value = this.ctx.fireSky;
      s.uDream.value = D.sky.captured + (1 - D.sky.captured) * walkLook;
      s.uDreamTilt.value = D.sky.tilt * DEG * walkLook;
      s.uDreamHorizon.value = 1;
      s.uIntensity.value = lightingConfig.backgroundIntensity * a.sky * this.dimmed;
    } else {
      this.fog.color.copy(this.realFogColor);
      this.fog.density = lightingConfig.fog.density;
      scene.environment = this.ctx.environments.evening;
      scene.environmentIntensity = lightingConfig.environmentIntensity;
      alley.wetGround.envMap = null;
      alley.wetGround.envMapIntensity = this.groundIntensity;
      s.uDream.value = 0;
      s.uDreamHorizon.value = 0;
      s.uIntensity.value = lightingConfig.backgroundIntensity;
    }

    // light
    const specs = dream ? (this.spotsByRegion.get(this.air.region) ?? REAL_SPOTS) : REAL_SPOTS;
    this.spots.forEach((light, i) => {
      const spec = specs[i];
      if (!spec) {
        light.intensity = 0;
        return;
      }
      light.position.set(...spec.position);
      light.target.position.set(...spec.target);
      light.color.setHex(spec.color);
      light.angle = spec.angle * DEG;
      light.penumbra = spec.penumbra;
      light.intensity = spec.intensity * (dream ? this.dimmed : 1);
    });
    if (dream) this.kit.lights.assign(camera.position);
    if (!dream) this.previousPass = 'real';

    // what exists from here; while the eye looks ahead nothing behind it can be seen, whatever the way
    forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const tanV = Math.tan((camera.fov * DEG) / 2);
    const corner = Math.atan(Math.hypot(tanV, tanV * camera.aspect));
    const seesBehind = Math.acos(clamp(-forward.z, -1, 1)) + corner > Math.PI / 2;
    alley.farEnd.visible = !dream;
    alley.root.visible = !dream || (!sea && z > ALLEY_SEEN_FROM && (seesBehind || z > ALLEY.front - BEHIND));
    for (const m of this.modules) {
      const inWorld = dream && Boolean(m.inSea) === sea;
      m.root.visible = inWorld && z < m.span[0] + REGION_MARGIN && z > m.span[1] - REGION_MARGIN && (seesBehind || z > m.span[1] - BEHIND);
      if (m.root.visible) m.prepare?.(camera);
    }
    this.stairs.visible = dream && this.state.stairs && !sea && z > ALLEY_SEEN_FROM;
    this.giant.root.visible = dream && !sea && z < LAYOUT.void.from + REGION_MARGIN;

    if (this.windowGlow && this.windowRoomMaterial) this.windowGlow.material = dream && this.state.window ? this.windowMaterial : this.windowRoomMaterial;
    if (this.chair) this.placeChair(dream && this.state.chair);
    if (this.cctv) this.turnCctv(dream ? smootherstep(range(D.beats.cctv, D.beats.cctv + D.cctvTurn, this.insideTime)) : 0, camera.position);
    if (this.bulb) this.bulb.intensity = this.bulbIntensity * (dream ? 1 - D.alive.bulbFlicker * Math.max(0, wobble(this.time * 2.3, 11)) : 1);

    // real time stopped at one instant (its second hand only twitches); the dream's clock runs on
    if (dream) setClock(this.clockHands, this.dreamClock);
    else {
      const tw = D.clock.twitch;
      setClock(this.clockHands, D.clock.stoppedAt + (Math.sin(this.time * tw.rate) > tw.threshold ? tw.seconds : 0));
    }
  }

  /** The render the viewer sees: on entering a space (or coming from the real moment) its shadows are drawn once. */
  mainPass(camera: PerspectiveCamera): void {
    this.setPass('dream', camera);
    const key = this.spotsByRegion.get(this.air.region)?.[0] ?? REAL_SPOTS[0];
    if (key !== this.keySpot || this.previousPass === 'real') {
      this.keySpot = key;
      this.previousPass = 'dream';
      this.shadowDirty = true;
    }
  }

  private placeChair(dreamt: boolean): void {
    const c = this.chair!;
    if (dreamt) {
      c.object.position.set(...D.chair.position);
      c.object.quaternion.setFromAxisAngle(UP, D.chair.heading * DEG);
    } else {
      c.object.position.copy(c.position);
      c.object.quaternion.copy(c.quaternion);
    }
  }

  private turnCctv(amount: number, toward: Vector3): void {
    const c = this.cctv!;
    c.object.quaternion.copy(c.quaternion);
    if (amount <= 0) return;
    const target = new Quaternion().setFromAxisAngle(UP, Math.atan2(toward.x - c.position.x, toward.z - c.position.z));
    c.object.quaternion.slerp(target, amount);
  }

  /** The last photograph has been taken: its taker is gone (and back when you scroll back). */
  set photographerGone(gone: boolean) {
    this.sea.figure.visible = !gone;
  }

  // ------------------------------------------------------------------ per frame

  /**
   * @param view the camera the dream is seen from this frame (world space)
   * @param inside 0..1 how far inside the picture the viewer is
   * @param exploring the viewer is free inside (look enabled)
   * @param walk 0..1 progress of the walk (WORLD phase)
   * @param progress 0..1 of the whole piece (the prologue has its own small fear)
   */
  update(time: number, dt: number, view: PerspectiveCamera, inside: number, exploring: boolean, walk: number, paused: boolean): void {
    this.time = time;
    this.walk = walk;
    this.frameCount++;
    this.view = view;
    if (inside > 0.5) this.insideTime += dt;
    this.dreamClock += dt * D.clock.rate;
    this.alive(time);
    this.updateHeart(walk, dt, paused);

    // the walk frame: in the sea the eye is drawn at the sea's offset
    const sea = DreamDirector.inSea(view);
    eye.copy(view.position);
    if (sea) eye.sub(SEA);
    this.ctx.sky.uniforms.uDreamRotation.value = D.sky.rotation + time * D.sky.turnRate;

    const f = this.frame;
    f.time = time;
    f.dt = dt;
    f.paused = paused;
    f.view = view;
    f.walk = walk;
    f.fear = this.fear;
    f.heartbeat = this.heartbeat;
    this.giant.update(time, eye);
    if (inside > 0) {
      for (const m of this.modules) {
        if (Boolean(m.inSea) !== sea || eye.z > m.span[0] + REGION_MARGIN || eye.z < m.span[1] - REGION_MARGIN) continue;
        m.update(f);
      }
    }

    this.readAir(eye.z, sea);
    this.region = this.air.region;

    if (exploring) {
      const m = D.beats.margin;
      const t = this.insideTime;
      const s = this.state;
      // changes that only happen behind your back
      const win = this.windowGlow?.getWorldPosition(windowAt);
      if (!s.window && win && t > D.beats.window && unseen(win, view, m)) s.window = true;
      if (!s.chair && this.chair && t > D.beats.chair && unseen(new Vector3(...D.chair.position), view, m) && unseen(this.chair.position, view, m)) s.chair = true;
      if (!s.stairs && t > D.beats.stairs && unseen(new Vector3(fireEscape.x, D.stairs.probeHeight, fireEscape.platformZ), view, m)) s.stairs = true;
      // the window that looks back into the real moment
      if (s.window && win && !sea && eye.z > ALLEY.front && this.frameCount % D.window.everyNthFrame === 0 && !unseen(win, view, D.window.renderMargin)) {
        // a few dozen pixels far away: the last shadow map is good enough
        this.renderReal(this.windowRT, this.windowCamera, true);
      }
    }

    this.grade.copy(Grade.from(this.air.grade));
  }

  /** Fear rises along the walk and with every scare; the heart follows it. */
  private updateHeart(walk: number, dt: number, paused: boolean): void {
    if (paused) return;
    this.fearBoost = Math.max(0, this.fearBoost - dt * 0.35);
    const base = walk > 0 ? this.fearTrack.at(walk) : fearConfig.prologue;
    this.fear = clamp(base + this.fearBoost, 0, 1);
    const h = fearConfig.heart;
    this.heartPhase += dt * lerp(h.calm, h.panic, this.fear);
    this.heartbeat *= Math.exp(-h.decay * dt);
    this.beat = false;
    if (this.heartPhase >= 1) {
      this.heartPhase -= 1;
      this.heartbeat = 1;
      this.beat = true;
      this.secondBeat = true;
    } else if (this.secondBeat && this.heartPhase >= SECOND_BEAT.at) {
      this.heartbeat = Math.max(this.heartbeat, SECOND_BEAT.strength);
      this.secondBeat = false;
    }
  }

  /**
   * Small motions in the alley, real and dreamt alike. Each comes and goes in its own slow gust,
   * so things rarely move together, and nothing moves much.
   */
  private alive(time: number): void {
    if (REDUCED_MOTION) return;
    const a = D.alive;
    const gust = (seed: number) => Math.max(0, Math.sin((time / a.gustPeriod) * Math.PI * 2 + seed)) ** 2;
    this.ctx.alley.tick(time);
    for (const c of this.ctx.alley.cables) {
      const sway = Math.sin((time / a.cablePeriod) * Math.PI * 2 + c.phase) * a.cableSway * gust(c.phase);
      c.pivot.quaternion.setFromAxisAngle(c.axis, sway);
    }
    const lamp = this.ctx.alley.anchors.get('hangingLamp');
    const swing = (time / a.lampPeriod) * Math.PI * 2;
    const g = gust(2.1);
    if (lamp) lamp.rotation.set(Math.sin(swing) * a.lampSwing * g, 0, Math.sin(swing + 1.3) * a.lampSwing * 0.4 * g);
    const plant = this.ctx.alley.anchors.get('plant');
    if (plant) plant.rotation.z = wobble(time * 0.7, 21) * a.plantSway * gust(4.2);
  }
}

export { inSea };
