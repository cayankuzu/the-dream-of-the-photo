import {
  Color,
  FogExp2,
  Group,
  HalfFloatType,
  InstancedMesh,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderTarget,
  type Material,
  type Texture,
} from 'three';
import { directorConfig, LAYERS, REDUCED_MOTION, renderConfig, shotsConfig } from '../../config/experience.config';
import { dreamConfig as D, type DreamBuilding } from '../../config/dream.config';
import { ALLEY, apt, factory, fireEscape, LIGHT_COLORS, lightingConfig } from '../../config/scene.config';
import { inSea, seaConfig } from '../../config/sea.config';
import type { Photographer } from '../character/Photographer';
import { rigClock, setClock, type ClockHand } from '../dream/ClockRig';
import { DreamSea } from '../dream/DreamSea';
import { FloatingThings } from '../dream/FloatingThings';
import { FrozenRain } from '../dream/FrozenRain';
import { GiantPrint } from '../dream/GiantPrint';
import { Moments, type MomentPass } from '../dream/Moments';
import { PhotoLines } from '../dream/PhotoLines';
import type { LookControls, PointOfInterest } from '../interaction/LookControls';
import { DEG, range, smootherstep, wobble } from '../math';
import { Photograph } from '../photograph/Photograph';
import { Grade } from '../render/Grade';
import type { Alley } from '../world/Alley';
import { FacadeBuilder, FLOOR, MODULE, type FacadeSpec } from '../world/FacadeBuilder';
import type { SkyDome } from '../world/SkyDome';

export interface DreamContext {
  scene: Scene;
  alley: Alley;
  sky: SkyDome;
  photographer: Photographer;
  impossibleEnv: Texture;
  /** Equirect skies: daylight over the dream's night street, dusk over the sea. */
  daySky: Texture;
  seaSky: Texture;
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
const W = 'wall_standard_standard_01';
/**
 * Lit rooms of the lengthened alley: depth of the glowing back wall behind the facade (m), its size and
 * height above the floor line, the share of windows lit, and the range of their brightness.
 */
const ROOM = { depth: 0.6, width: 1.6, height: 1.9, sill: 1.55, lit: 0.34, glow: [0.9, 2.5] as const };

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

/** Deterministic 0..1 hash of three integers (which windows are lit). */
function hash3(a: number, b: number, c: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Everything that makes the picture's world a dream rather than a copy, and the way through it.
 *  - captured (already in the photograph): rain stopped in the air, the alley going on far past its end
 *    under a sky that is already turning to day, a small figure aiming back, the photographer's shadow
 *    staying without them, a giant print at the very end.
 *  - along the walk: photographs of places you have not reached yet, things at the size you remember
 *    them, things that forgot gravity, buildings leaning in, a clock running backwards, and the sea
 *    behind the giant print, where the moon is a photograph.
 *  - behind your back: a window shows the real alley, the chair walks to the middle, the stairs keep
 *    climbing, the camera on the wall turns to you, the stopped clock runs.
 * `setPass` switches shared objects between their real and dreamt state before each render.
 */
export class DreamDirector {
  readonly grade = new Grade();
  readonly giant: GiantPrint;
  readonly sea: DreamSea;
  private readonly root = new Group();
  private readonly extension = new Group();
  private readonly stairs = new Group();
  private readonly figure: Object3D;
  private readonly figureHome: Vector3;
  private readonly figurePoi: PointOfInterest;
  private readonly clockHands: ClockHand[];
  private readonly groundIntensity: number;
  private readonly fog: FogExp2;
  private readonly realFogColor = new Color(lightingConfig.fog.color);
  private readonly dreamFogColor = new Color(D.fog.color);
  private readonly seaFogColor = new Color(seaConfig.fog.color);
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
  private readonly rain = new FrozenRain();
  private readonly floating: FloatingThings;
  private readonly moments = new Moments();
  private readonly lines: PhotoLines;

  private insideTime = 0;
  private dreamClock = 0;
  private time = 0;
  private walk = 0;
  private frameCount = 0;
  private retreat = 0;
  private readonly state = { window: false, chair: false, stairs: false };

  constructor(private readonly ctx: DreamContext) {
    this.root.name = 'Dream';
    ctx.scene.add(this.root);
    this.fog = ctx.scene.fog as FogExp2;
    this.groundIntensity = ctx.alley.wetGround.envMapIntensity;

    // the figure at the far end: the photographer again, aiming back at us
    this.figure = ctx.photographer.makeDouble(D.figure.clipTime);
    this.figureHome = new Vector3(...D.figure.position);
    this.figure.position.copy(this.figureHome);
    this.figure.rotation.y = D.figure.heading * DEG;
    this.figurePoi = {
      position: new Vector3(D.figure.position[0], D.figure.poi.height, D.figure.position[2]),
      radius: D.figure.poi.radius,
      zoom: D.figure.poi.zoom,
      active: () => this.retreat < 0.5,
      memory: 'figure',
    };
    ctx.look.pointsOfInterest.push(this.figurePoi);

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

    this.buildExtension();
    this.buildStairs();
    this.buildFoundPhotograph();
    this.giant = new GiantPrint(ctx.portal);
    ctx.look.pointsOfInterest.push({ position: this.giant.imageCenter, radius: D.giantPrint.poi.radius, zoom: D.giantPrint.poi.zoom, memory: 'giant' });
    this.floating = new FloatingThings(ctx.alley);
    const { giantChair, giantClock } = D.floating;
    ctx.look.pointsOfInterest.push(
      { position: new Vector3(giantChair.at[0], giantChair.poi.height, giantChair.at[2]), radius: giantChair.poi.radius, zoom: giantChair.poi.zoom, memory: 'chair' },
      { position: new Vector3(...giantClock.at), radius: giantClock.poi.radius, zoom: giantClock.poi.zoom, memory: 'clock' },
    );
    this.lines = new PhotoLines(this.moments.textures);
    this.sea = new DreamSea({ alley: ctx.alley, photographer: ctx.photographer, moments: this.moments.textures, moonPhoto: this.foundRT.texture });
    ctx.look.pointsOfInterest.push(
      { position: new Vector3(...inSea(seaConfig.moon.at)), radius: seaConfig.moon.poi.radius, zoom: seaConfig.moon.poi.zoom, memory: 'moon' },
      {
        position: new Vector3(...inSea(seaConfig.figure.position)).setY(D.figure.poi.height),
        radius: D.figure.poi.radius,
        zoom: D.figure.poi.zoom,
        memory: 'photographer',
      },
    );
    this.root.add(this.figure, this.extension, this.stairs, this.giant.root, this.rain.mesh, this.floating.root, this.lines.root, this.sea.root);
    this.root.traverse((o) => o.layers.set(LAYERS.DREAM));

    const clock = anchors.get('clock');
    this.clockHands = clock ? rigClock(clock) : [];
    this.reset();
  }

  // ------------------------------------------------------------------ building the dream

  /** The alley goes on where the cross street was: taller, more crooked, lit rooms, and a wall at its end. */
  private buildExtension(): void {
    const { alley } = this.ctx;
    const hw = ALLEY.halfWidth;
    const e = D.extension;
    const specs: FacadeSpec[] = [];
    const rooms: Matrix4[] = [];
    const roomTint: number[] = [];

    const side = (buildings: readonly DreamBuilding[], facing: 'east' | 'west', x: number, parity: number) => {
      let z = e.from;
      const out = facing === 'east' ? -1 : 1; // which way "into the building" is along x
      buildings.forEach((b, n) => {
        const isApt = (n + parity) % 2 === 0;
        const floors = Array.from({ length: b.floors }, (_, level) =>
          Array.from({ length: b.columns }, (_, i) => (isApt ? aptModule(level, i, n) : factoryModule(level, i, n, b.floors))),
        );
        const spec = (isApt ? apt : factory)({ facing, start: [x, z], run: [0, -1], floors, lean: b.lean });
        specs.push(spec);
        const lean = FacadeBuilder.leanOf(spec);
        floors.forEach((row, level) =>
          row.forEach((module, i) => {
            if (level === 0 || module === W || hash3(n * 7 + parity, level, i) > ROOM.lit) return;
            const m = new Matrix4().compose(
              v1.set(x + out * ROOM.depth, level * FLOOR + ROOM.sill, z - (i + 0.5) * MODULE),
              new Quaternion().setFromAxisAngle(UP, (-out * Math.PI) / 2),
              new Vector3(1, 1, 1),
            );
            if (lean) m.premultiply(lean);
            rooms.push(m);
            roomTint.push(hash3(level, i, n));
          }),
        );
        z -= b.columns * MODULE;
      });
    };
    side(e.left, 'east', -hw, 0);
    side(e.right, 'west', hw, 1);
    // the end: a tall blank wall over the giant print, a few lit windows near the top
    specs.push(
      apt({
        facing: 'south',
        start: [-MODULE, e.endWall.z],
        run: [1, 0],
        floors: Array.from({ length: e.endWall.floors }, (_, level) => (level < 5 ? [W, W] : ['wall_window_centered_small_02', level % 2 ? W : 'wall_window_centered_small_02'])),
      }),
    );
    this.extension.add(alley.facades(specs));

    // warm rooms behind a third of the windows: the night street under a daylight sky
    const glow = new InstancedMesh(new PlaneGeometry(ROOM.width, ROOM.height), new MeshBasicMaterial({ color: 0xffffff }), rooms.length);
    const warm = new Color(LIGHT_COLORS.window);
    const tint = new Color();
    rooms.forEach((m, i) => {
      glow.setMatrixAt(i, m);
      glow.setColorAt(i, tint.copy(warm).multiplyScalar(ROOM.glow[0] + roomTint[i] * (ROOM.glow[1] - ROOM.glow[0])));
    });
    glow.computeBoundingSphere();
    this.extension.add(glow);

    // the same wet setts, continuing, and lanterns on alternate walls
    this.extension.add(alley.groundSlab(hw * 2, e.from - e.to + 2, (e.from + e.to) / 2));
    const ll = e.lanternLight;
    e.lanterns.forEach((z, i) => {
      const s = i % 2 ? 1 : -1;
      alley.prop('street_lamp_wall', [s * (hw - 0.43), 3.0, z], [0, -s * 90, 0], { anchor: 'center', castShadow: false }, this.extension);
      const l = new PointLight(LIGHT_COLORS.tungsten, ll.intensity, ll.distance, 2);
      l.position.set(s * (hw - ll.out), ll.height, z);
      this.extension.add(l);
    });
  }

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
    this.ctx.look.pointsOfInterest.push({ position: spot, radius: D.found.radius, zoom: D.found.zoom, memory: 'found' });
  }

  /**
   * Develop everything the dream shows as pictures (once, after the shaders are compiled): the found
   * print and the moon (the opening view), the giant print's still of the sea, the moments.
   */
  develop(): void {
    this.renderReal(this.foundRT, introCamera(1));
    // the pictures of places further on are taken under the sky you will find there
    const walk = this.walk;
    this.walk = 1;
    const still = this.giant.stillCamera();
    // the still and the moments see each other (the giant print in a moment, the prints over the sea in
    // the still): develop the still on both sides of the moments
    this.ctx.renderDream(this.giant.stillRT, still);
    this.moments.develop((target: WebGLRenderTarget, camera: PerspectiveCamera, pass: MomentPass) =>
      pass === 'real' ? this.renderReal(target, camera) : this.ctx.renderDream(target, camera),
    );
    this.ctx.renderDream(this.giant.stillRT, still);
    this.walk = walk;
  }

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
    this.setPass('real', camera);
    this.ctx.renderReal(target, camera, reuseShadows);
  }

  // ------------------------------------------------------------------ state

  /** Back to the instant of capture. */
  reset(): void {
    this.insideTime = 0;
    this.dreamClock = D.clock.stoppedAt;
    Object.assign(this.state, { window: false, chair: false, stairs: false });
    this.figure.visible = true;
    this.figure.scale.setScalar(1);
    this.figure.position.copy(this.figureHome);
    this.sea.figure.visible = true;
  }

  /** Is this camera standing in the sea (beyond the giant print)? */
  static inSea(camera: PerspectiveCamera): boolean {
    return camera.position.z < seaConfig.boundaryZ;
  }

  setPass(kind: 'real' | 'dream', camera: PerspectiveCamera): void {
    const dream = kind === 'dream';
    const sea = dream && DreamDirector.inSea(camera);
    const { alley, sky } = this.ctx;
    const day = smootherstep(range(0, D.sky.fullAt, this.walk));

    alley.wetGround.envMap = dream ? this.ctx.impossibleEnv : null;
    alley.wetGround.envMapIntensity = dream ? D.puddles.intensity : this.groundIntensity;
    sky.position.copy(camera.position);
    sky.updateMatrixWorld();
    const s = sky.uniforms;
    s.tDream.value = sea ? this.ctx.seaSky : this.ctx.daySky;
    s.uDream.value = !dream ? 0 : sea ? 1 : D.sky.captured + (1 - D.sky.captured) * day;
    s.uDreamTilt.value = sea ? 0 : D.sky.tilt * DEG * day;

    if (!dream) {
      this.fog.color.copy(this.realFogColor);
      this.fog.density = lightingConfig.fog.density;
    } else if (sea) {
      this.fog.color.copy(this.seaFogColor);
      this.fog.density = seaConfig.fog.density;
    } else {
      this.fog.color.copy(this.dreamFogColor);
      this.fog.density = D.fog.density + (D.fog.far - D.fog.density) * range(ALLEY.crossStreet.near, D.extension.to, camera.position.z);
    }

    alley.farEnd.visible = !dream;
    this.extension.visible = dream;
    this.stairs.visible = dream && this.state.stairs;
    if (this.windowGlow && this.windowRoomMaterial) this.windowGlow.material = dream && this.state.window ? this.windowMaterial : this.windowRoomMaterial;
    if (this.chair) this.placeChair(dream && this.state.chair);
    if (this.cctv) this.turnCctv(dream ? smootherstep(range(D.beats.cctv, D.beats.cctv + D.cctvTurn, this.insideTime)) : 0, camera.position);
    if (this.bulb) this.bulb.intensity = this.bulbIntensity * (dream ? 1 - D.alive.bulbFlicker * Math.max(0, wobble(this.time * 2.3, 11)) : 1);
    if (dream) this.rain.update(camera.position, this.time);

    // real time stopped at one instant (its second hand only twitches); the dream's clock runs on
    if (dream) setClock(this.clockHands, this.dreamClock);
    else {
      const tw = D.clock.twitch;
      setClock(this.clockHands, D.clock.stoppedAt + (Math.sin(this.time * tw.rate) > tw.threshold ? tw.seconds : 0));
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
   */
  update(time: number, dt: number, view: PerspectiveCamera, inside: number, exploring: boolean, walk: number): void {
    this.time = time;
    this.walk = walk;
    this.frameCount++;
    if (inside > 0.5) this.insideTime += dt;
    this.dreamClock += dt * D.clock.rate;
    this.alive(time);

    // the walk frame: in the sea the eye is drawn at the sea's offset
    eye.copy(view.position);
    if (DreamDirector.inSea(view)) eye.sub(SEA);
    this.ctx.sky.uniforms.uDreamRotation.value = D.sky.rotation + time * D.sky.turnRate;

    // the far figure grows smaller as you approach it, then backs into the giant print
    const f = D.figure;
    const dist = eye.distanceTo(this.figureHome);
    this.figure.scale.setScalar(Math.min(1, Math.max(f.minScale, (dist - f.shrinkFrom) / f.shrinkSpan + f.minScale)));
    this.retreat = smootherstep(range(f.retreat.from, f.retreat.to, dist));
    this.figure.position.z = this.figureHome.z + (f.retreat.toZ - this.figureHome.z) * this.retreat;
    this.figure.visible = this.retreat < 1;

    this.giant.update(time, eye);
    this.floating.update(time);
    this.lines.update(time);
    this.sea.update(time, dt);

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
      if (s.window && win && this.frameCount % D.window.everyNthFrame === 0 && !unseen(win, view, D.window.renderMargin)) {
        // a few dozen pixels far away: the last shadow map is good enough
        this.renderReal(this.windowRT, this.windowCamera, true);
      }
    }

    // light temperature drifts inside
    const dd = directorConfig.dreamDrift;
    const g = directorConfig.dreamGrade;
    const w = Math.sin((time / dd.period) * Math.PI * 2);
    this.grade.copy(Grade.from({ ...g, warmth: g.warmth + w * dd.warmth, tint: g.tint + Math.cos((time / dd.period) * 3.1) * dd.tint }));
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

/** Apartment rows of the lengthened alley: doors on the ground, windows above, varied per building. */
function aptModule(level: number, i: number, building: number): string {
  const v = level === 1 ? '01' : '02';
  if (level === 0) return i % 4 === (building % 3) ? 'wall_door_centered_small_01' : i % 3 === 2 ? 'wall_window_offset_small_01' : W;
  const pattern = ['large', 'small', 'double', 'small'];
  return (i + building) % 5 === 4 ? W : `wall_window_centered_${pattern[(i + level + building) % pattern.length]}_${v}`;
}

/** Factory rows: a garage-free ground floor, tall windows, medium ones under the roof. */
function factoryModule(level: number, i: number, building: number, floors: number): string {
  const v = level === 1 ? '01' : '02';
  if (level === 0) return i % 5 === (building % 2) + 1 ? 'wall_window_centered_small_01' : i % 4 === 3 ? 'wall_door_centered_large_01' : W;
  if (level === floors - 1) return i % 3 === 1 ? W : `wall_window_centered_medium_${v}`;
  return `wall_window_tall_${(i + building) % 3 ? 'small' : 'large'}_${v}`;
}
