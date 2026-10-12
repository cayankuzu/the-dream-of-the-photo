import {
  DataTexture,
  Euler,
  EquirectangularReflectionMapping,
  FogExp2,
  HalfFloatType,
  LinearFilter,
  PerspectiveCamera,
  PMREMGenerator,
  PointLight,
  Quaternion,
  Scene,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three';
import { endTitleFrom } from '../config/copy.config';
import {
  DEBUG_MODE,
  directorConfig,
  LAYERS,
  lookConfig,
  photoConfig,
  renderConfig,
  timelineConfig,
  transitionConfig,
} from '../config/experience.config';
import { lightingConfig } from '../config/scene.config';
import { inSea, seaConfig } from '../config/sea.config';
import { walkConfig } from '../config/walk.config';
import { say } from '../ui/i18n';
import { Overlay } from '../ui/Overlay';
import { Assets } from './assets/Assets';
import { AudioEngine } from './audio/AudioEngine';
import { Photographer } from './character/Photographer';
import type { Debug } from './debug/Debug';
import { CameraDirector, type ShotState } from './director/CameraDirector';
import { DreamDirector } from './director/DreamDirector';
import { DreamWalk } from './director/DreamWalk';
import { LookControls } from './interaction/LookControls';
import { Memories } from './Memories';
import { ScrollInput } from './interaction/ScrollInput';
import { clamp, DEG, range, smootherstep } from './math';
import { Photograph } from './photograph/Photograph';
import { Grade } from './render/Grade';
import { Pipeline, type CompositeState } from './render/Pipeline';
import { cueToProgress, phaseEnd, phaseProgress, phaseStart, SHUTTER_PROGRESS, spanProgress, Timeline } from './timeline/Timeline';
import { PhotoPortal } from './transition/PhotoPortal';
import { Alley } from './world/Alley';
import { SkyDome } from './world/SkyDome';

/**
 * outer: the real moment. portal: the print is a window. world: inside the picture, in the alley.
 * sea: beyond the giant print. awake: outside again, after the last photograph.
 */
type View = 'outer' | 'portal' | 'world' | 'sea' | 'awake';

const MODELS = [
  'photographer', 'kit_apartments', 'kit_factory', 'street_lamp_wall', 'street_lamp_post', 'security_light',
  'pull_chain_socket', 'lightbulb', 'hanging_lamp', 'trash_can', 'trashbag', 'cardboard_box', 'wooden_crate',
  'plastic_crate', 'monobloc_chair', 'cafe_set', 'aircon', 'gutter_kit', 'cable_kit', 'utility_box', 'power_box',
  'manhole', 'fire_escape', 'wall_clock', 'potted_plant', 'weeds', 'planter_pot', 'security_camera',
] as const;
const MATERIALS = ['setts_wet', 'concrete_worn', 'asphalt', 'plaster_damaged'] as const;

const SEA = new Vector3(...seaConfig.offset);
const END = walkConfig.ending;
const WALK_START = phaseStart('WORLD');
const LOOK_IN = cueToProgress(['WORLD', lookConfig.blendIn]);
const GRADE_IN = cueToProgress(['WORLD', walkConfig.gradeSpan]);
const LAST_PICTURE = cueToProgress(['EXPLORATION', END.flash]);
const AWAKE = cueToProgress(['EXPLORATION', END.cut]);
const FACE_FROM = cueToProgress(['WORLD', walkConfig.faceTheCamera[0]]);
const FACE_TO = cueToProgress(['EXPLORATION', walkConfig.faceTheCamera[1]]);
const TITLE_BACK = cueToProgress(['EXPLORATION', endTitleFrom]);
/** Pitch limit of walk + look together (rad). */
const MAX_PITCH = 85 * DEG;

const euler = new Euler(0, 0, 0, 'YXZ');

/**
 * The piece: one scene, one continuous shot. The timeline (scroll) drives the photographer, the
 * viewer camera, the passage into the photograph and the walk through its dream; drag drives the gaze.
 */
export class Experience {
  private readonly pipeline: Pipeline;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(36, 1, renderConfig.near, renderConfig.far);
  /** The sea seen from where the viewer stands, for the giant print's live window. */
  private readonly seaWindow = new PerspectiveCamera(58, 1, renderConfig.near, renderConfig.far);
  private readonly lastLens = new PerspectiveCamera(photoConfig.captureFov, 1, renderConfig.near, renderConfig.far);
  private readonly timeline = new Timeline();
  private readonly overlay = new Overlay();
  private readonly audio = new AudioEngine();
  private readonly portal = new PhotoPortal();
  private readonly walk = new DreamWalk();
  private readonly look: LookControls;
  private readonly memories = new Memories();
  private readonly scroll: ScrollInput;
  private readonly assets = new Assets(import.meta.env.BASE_URL);
  private readonly captureRT = new WebGLRenderTarget(photoConfig.captureResolution, photoConfig.captureResolution, {
    type: HalfFloatType,
    samples: renderConfig.msaaSamples,
  });

  private alley!: Alley;
  private sky!: SkyDome;
  private photographer!: Photographer;
  private print!: Photograph;
  private director!: CameraDirector;
  private dream!: DreamDirector;
  private flash!: PointLight;
  private debug: Debug | null = null;

  private readonly gradeOuter = Grade.from(directorConfig.outerGrade);
  private readonly gradePhoto = Grade.from(photoConfig.grade);
  private readonly gradeThrough = new Grade().composeOf(this.gradeOuter, this.gradePhoto);
  private readonly gradeNow = new Grade();
  private readonly composite: CompositeState;

  private captured = false;
  private paused = false;
  private lastTaken = false;
  private shutterTime = -10;
  private time = 0;
  private last = 0;
  private lastProgress = 0;
  private view: View = 'outer';
  private readonly stand = new Vector3();
  private readonly walkEye = new Vector3();
  private readonly windowRect = new Vector4();
  private resizePending = false;
  private lastRender = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.pipeline = new Pipeline(canvas);
    this.look = new LookControls(canvas);
    this.scroll = new ScrollInput(this.timeline, canvas);
    this.scroll.enabled = false;
    this.look.touchAllowed = () => this.scroll.touchAxis === 'x';
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.overlay.fail(say('lost'));
    });
    this.camera.layers.set(LAYERS.WORLD);
    this.camera.layers.enable(LAYERS.OUTER);
    for (const cam of [this.portal.capture, this.portal.world, this.seaWindow, this.lastLens]) {
      cam.layers.set(LAYERS.WORLD);
      cam.layers.enable(LAYERS.DREAM);
    }
    // the last picture: from the eye of the photographer standing on the water
    this.lastLens.position.set(...inSea(END.lens.position));
    this.lastLens.lookAt(...inSea(END.lens.target));
    this.lastLens.updateMatrixWorld(true);
    this.composite = {
      focus: 10,
      aperture: 0,
      soft: 0,
      grade: this.gradeNow,
      exposure: lightingConfig.exposure,
      vignette: renderConfig.vignette,
      grain: renderConfig.grain,
      fade: 1,
      flash: 0,
      sheen: 0,
      sheenOffset: 0,
    };
    this.overlay.onSoundToggle = () => void this.audio.toggle().then((on) => this.overlay.setSound(on));
    // the first gesture anywhere switches sound on (pointerup and most keydowns are user activations, also
    // on touch; Esc is not); the sound switches handle their own clicks. It listens until the browser
    // actually lets the sound play.
    const unlock = (e: Event) => {
      if (this.overlay.isSoundControl(e.target) || (e instanceof KeyboardEvent && e.key === 'Escape')) return;
      void this.audio.unlock().then((on) => {
        this.overlay.setSound(on);
        if (!this.audio.running) return;
        window.removeEventListener('pointerup', unlock);
        window.removeEventListener('keydown', unlock);
      });
    };
    window.addEventListener('pointerup', unlock);
    window.addEventListener('keydown', unlock);
    // Begin (a click or a key) is a gesture too; beginning by scrolling is not, and waits for the next one
    this.overlay.onBegin = (gesture) => {
      if (gesture) void this.audio.unlock().then((on) => this.overlay.setSound(on));
    };
    this.overlay.onPause = (paused) => {
      this.paused = paused;
      this.scroll.enabled = !paused;
      this.audio.setPaused(paused);
    };
    this.overlay.onRestart = () => this.timeline.seek(0);
    window.addEventListener('resize', () => (this.resizePending = true));
    document.addEventListener('visibilitychange', () => this.audio.setHidden(document.hidden));
  }

  async start(): Promise<void> {
    this.resize();
    const progress = window.setInterval(() => this.overlay.setLoadProgress(this.assets.fraction), 100);
    await this.load();
    window.clearInterval(progress);
    this.overlay.setLoadProgress(1);
    this.build();
    await this.precompile();
    this.dream.develop();
    if (import.meta.env.DEV && DEBUG_MODE) {
      const { Debug } = await import('./debug/Debug');
      this.debug = new Debug(this.pipeline.renderer, this.timeline);
      const seek = new URLSearchParams(window.location.search).get('p');
      if (seek) this.timeline.seek(Number(seek));
      (window as unknown as { __exp: unknown }).__exp = this;
    }
    // input waits for the piece: a scroll during loading must not skip the title screen
    this.scroll.enabled = true;
    this.overlay.ready();
    this.last = performance.now();
    this.pipeline.renderer.setAnimationLoop((now) => this.frame(now));
  }

  /**
   * Lights follow layers, so the real moment and the dream light the scene differently and need their
   * own shader programs: compile both (and the dream with every change applied) before the first
   * frame, so nothing compiles on the shutter beat or on the way.
   */
  private async precompile(): Promise<void> {
    const r = this.pipeline.renderer;
    await r.compileAsync(this.scene, this.camera);
    this.dream.setPass('dream', this.portal.capture);
    await r.compileAsync(this.scene, this.portal.capture);
    await this.dream.whileFullyDreamt(() => r.compileAsync(this.scene, this.portal.capture), this.portal.capture);
    this.dream.setPass('real', this.camera);
  }

  private async load(): Promise<void> {
    const a = this.assets;
    await Promise.all([
      ...MODELS.map((k) => a.model(k, `${k}.glb`)),
      ...MATERIALS.map((k) => a.material(k, k)),
      a.environment('env_evening', 'env_evening.hdr'),
      a.environment('sky_dusk', 'sky_dusk.hdr'),
      a.environment('sky_dream', 'sky_dream.hdr'),
      a.environment('sky_impossible', 'sky_impossible.hdr'),
      document.fonts.load('48px "Homemade Apple"').catch(() => undefined),
    ]);
  }

  private build(): void {
    const renderer = this.pipeline.renderer;
    const pmrem = new PMREMGenerator(renderer);
    const env = this.assets.environments.get('env_evening')!;
    env.mapping = EquirectangularReflectionMapping;
    this.scene.environment = pmrem.fromEquirectangular(env).texture;
    this.scene.environmentIntensity = lightingConfig.environmentIntensity;
    const impossible = this.assets.environments.get('sky_impossible')!;
    impossible.mapping = EquirectangularReflectionMapping;
    const impossibleEnv = pmrem.fromEquirectangular(impossible).texture;
    pmrem.dispose();

    const skyTex = (k: string): DataTexture => {
      const t = this.assets.environments.get(k)!;
      t.minFilter = LinearFilter;
      t.generateMipmaps = false;
      return t;
    };
    const daySky = skyTex('sky_impossible');
    this.sky = new SkyDome(skyTex('sky_dusk'), daySky, lightingConfig.backgroundIntensity);
    this.sky.uniforms.uRotation.value = lightingConfig.skyRotation;
    this.sky.layers.set(LAYERS.WORLD);
    this.scene.add(this.sky);
    this.scene.fog = new FogExp2(lightingConfig.fog.color, lightingConfig.fog.density);

    this.alley = new Alley(this.assets);
    this.scene.add(this.alley.root);

    this.print = new Photograph({ photo: this.captureRT.texture, grade: this.gradePhoto });
    this.print.uniforms.tPortal.value = this.pipeline.portalRT.texture;
    this.photographer = new Photographer(this.assets.models.get('photographer')!, this.print);
    this.scene.add(this.photographer.root, this.photographer.ghost);
    this.photographer.update(0, 0);

    this.flash = new PointLight(0xfff4e8, 0, lightingConfig.flash.distance, lightingConfig.flash.decay);
    this.flash.layers.set(LAYERS.OUTER);
    const f = lightingConfig.fill;
    const fill = new PointLight(f.color, f.intensity, f.distance, 2);
    fill.position.set(f.position[0], f.position[1], f.position[2]);
    fill.layers.set(LAYERS.OUTER);
    this.scene.add(this.flash, fill);

    this.director = new CameraDirector(this.photographer, this.print, this.portal);
    this.dream = new DreamDirector({
      scene: this.scene,
      alley: this.alley,
      sky: this.sky,
      photographer: this.photographer,
      impossibleEnv,
      daySky,
      seaSky: skyTex('sky_dream'),
      portal: this.pipeline.portalRT.texture,
      gradePhoto: this.gradePhoto,
      look: this.look,
      renderReal: (target, camera, reuseShadows) => {
        const shadows = this.pipeline.renderer.shadowMap;
        shadows.autoUpdate = !reuseShadows;
        this.pipeline.renderTo(target, this.scene, camera);
        shadows.autoUpdate = true;
      },
      renderDream: (target, camera) => this.renderDream(target, camera),
    });

    // shutter, mechanics and paper as scroll crosses their beats
    this.timeline.onCross(SHUTTER_PROGRESS, (dir) => (dir > 0 ? this.takePicture() : this.untakePicture()));
    const cues = directorConfig.soundCues;
    this.timeline.onCross(cueToProgress(cues.raise), (dir) => dir > 0 && this.audio.raise());
    this.timeline.onCross(cueToProgress(cues.focus), (dir) => dir > 0 && this.audio.focus());
    this.timeline.onCross(cueToProgress(cues.eject), (dir) => dir > 0 && this.audio.eject());
    this.timeline.onCross(cueToProgress(cues.paper), (dir) => dir > 0 && this.audio.paper());
    // the photographer on the water takes the last picture
    this.timeline.onCross(LAST_PICTURE, (dir) => (dir > 0 ? this.takeLastPicture() : this.untakeLastPicture()));
  }

  // ------------------------------------------------------------------ the pictures

  /** Render the photograph from the lens, out of the very same world. */
  private takePicture(): void {
    this.captured = true;
    this.shutterTime = this.time;
    this.timeline.freeze(timelineConfig.shutterHoldSeconds);
    this.director.kick();
    this.audio.shutter();
    this.capture();
  }

  private capture(): void {
    const pos = new Vector3();
    const quat = new Quaternion();
    this.photographer.lensPose(pos, quat);
    this.photographer.aimQuaternion(quat);
    this.portal.setCapture(pos, quat);
    this.photographer.freezeGhost();
    this.dream.reset();
    this.renderPhotograph();
    // where the viewer will stand inside: straight ahead, at eye height; the walk starts there
    const forward = new Vector3(0, 0, -1).applyQuaternion(this.portal.heading);
    this.stand.copy(pos).addScaledVector(forward, transitionConfig.depthTravel + transitionConfig.entryTravel);
    this.stand.y = pos.y;
    this.walk.setStart(this.stand, Math.atan2(-forward.x, -forward.z));
  }

  /** The print's image: the dream as seen from the lens. */
  private renderPhotograph(): void {
    this.renderDream(this.captureRT, this.portal.capture);
    this.dream.setPass('real', this.camera);
  }

  private renderDream(target: WebGLRenderTarget, camera: PerspectiveCamera): void {
    this.dream.setPass('dream', camera);
    camera.updateMatrixWorld(true);
    this.pipeline.renderTo(target, this.scene, camera);
  }

  private untakePicture(): void {
    this.captured = false;
    this.photographer.ghost.visible = false;
  }

  /** The photographer standing on the water takes the last picture: of you, arriving. */
  private takeLastPicture(): void {
    this.lastTaken = true;
    this.dream.photographerGone = true;
    this.renderDream(this.captureRT, this.lastLens);
    this.audio.shutter();
  }

  private untakeLastPicture(): void {
    this.lastTaken = false;
    this.dream.photographerGone = false;
    this.renderPhotograph();
  }

  // ------------------------------------------------------------------ frame

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.pipeline.setSize(w, h);
  }

  private frame(now: number): void {
    // a cinematic frame rate: high-refresh panels do not render (and heat) twice as much
    if (now - this.lastRender < 1000 / renderConfig.maxFps - 2) return;
    this.lastRender = now;
    if (this.resizePending) {
      this.resizePending = false;
      this.resize();
    }
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.pipeline.renderer.info.reset();

    // paused, the dream goes on breathing but time in it stands still
    if (!this.paused) this.timeline.update(dt);
    const p = this.timeline.progress;
    if (p > SHUTTER_PROGRESS && !this.captured) {
      // arrived here without crossing the shutter (deep link): take the picture at its exact beat
      this.photographer.update(SHUTTER_PROGRESS, this.time);
      this.captured = true;
      this.capture();
    } else if (p < SHUTTER_PROGRESS && this.captured) {
      // jumped back before it (starting over)
      this.untakePicture();
    }
    // deep links (or the debug keys) jump without crossing: keep the last picture in step with the timeline
    if (p > LAST_PICTURE && !this.lastTaken) this.takeLastPicture();
    else if (p < LAST_PICTURE && this.lastTaken) this.untakeLastPicture();
    const speed = Math.abs(p - this.lastProgress) / Math.max(dt, 1e-3);
    this.lastProgress = p;
    this.photographer.update(p, this.time);
    const aspect = this.pipeline.size.x / Math.max(1, this.pipeline.size.y);
    const shot = p >= AWAKE ? this.director.poseEnding(this.camera, phaseProgress(p, 'EXPLORATION'), this.time, aspect) : this.director.pose(this.camera, p, this.time, dt, aspect);

    // the passage: flat print -> live window -> world
    const depth = phaseProgress(p, 'PHOTO_DEPTH');
    const travel = smootherstep(spanProgress(p, 'PHOTO_DEPTH', 'PHOTO_ENTRY'));
    const entry = phaseProgress(p, 'PHOTO_ENTRY');
    const covered = p >= phaseStart('PHOTO_DEPTH') && shot.photoDistance < this.portal.coverDistance(this.camera.fov, aspect);
    const portalMix = smootherstep(range(0, transitionConfig.portalFade, depth));

    // inside: the gaze is yours (except at the passage through the giant print and before the last picture)
    this.look.enabled = p >= WALK_START && p < LAST_PICTURE;
    this.scroll.lookEnabled = this.look.enabled;
    const walking = clamp(speed / lookConfig.walkSpeed, 0, 1);
    this.look.moving = walking > 0.05;
    if (p >= WALK_START) this.look.recenter(walking, dt);
    if (!this.paused) this.look.update(dt);
    const world = this.poseInside(p, travel, entry, aspect);
    const sea = p >= WALK_START && (this.walkEye.z < walkConfig.printZ || this.dream.giant.covers(world));
    if (sea) {
      world.position.add(SEA);
      world.updateMatrixWorld(true);
    }
    // paused, the gaze holds still: nothing is found behind the menu
    this.look.updateAttention(world.quaternion, world.position, world.fov, this.paused ? 0 : dt);
    if (!this.paused) this.discover();

    const previous = this.view;
    if (p < phaseStart('PHOTO_DEPTH')) this.view = 'outer';
    else if (p >= AWAKE) this.view = 'awake';
    else if (p < phaseEnd('PHOTO_DEPTH') && !covered) this.view = 'portal';
    else this.view = sea ? 'sea' : 'world';
    // leaving the picture backwards: the print now holds whatever happened inside, so going back stays seamless
    const inside = (v: View) => v === 'world' || v === 'sea';
    if (inside(previous) && (this.view === 'outer' || this.view === 'portal')) this.renderPhotograph();

    this.updateLights(p);
    this.updatePrintMaterial(p, depth, entry, portalMix);
    this.updateComposite(p, shot, entry);
    const within = inside(this.view) ? smootherstep(range(phaseStart('PHOTO_ENTRY'), phaseEnd('PHOTO_ENTRY'), p)) : 0;
    this.dream.update(this.time, dt, world, within, this.look.enabled, phaseProgress(p, 'WORLD'));
    this.updateGiantPrint(world);

    // render
    if (inside(this.view)) {
      // the alley's shadows mean nothing in the sea: the window into it and the sea itself reuse the last map
      const shadows = this.pipeline.renderer.shadowMap;
      shadows.autoUpdate = false;
      if (this.view === 'world') this.renderSeaWindow(world);
      shadows.autoUpdate = this.view === 'world';
      this.dream.setPass('dream', world);
      this.pipeline.renderTo(this.pipeline.sceneRT, this.scene, world);
      shadows.autoUpdate = true;
      this.pipeline.present(world, this.composite, this.time);
    } else {
      if (this.view === 'portal') {
        this.pipeline.portalRT.scissorTest = false;
        this.dream.setPass('dream', world);
        this.pipeline.renderTo(this.pipeline.portalRT, this.scene, world);
      }
      this.dream.setPass('real', this.camera);
      this.pipeline.renderTo(this.pipeline.sceneRT, this.scene, this.camera);
      this.pipeline.present(this.camera, this.composite, this.time);
    }

    const duck = directorConfig.duckRelease;
    const awake = this.view === 'awake';
    this.audio.update(
      {
        focusDuck: smootherstep(range(phaseStart('FOCUS'), phaseEnd('FOCUS'), p)) * (1 - range(SHUTTER_PROGRESS + duck[0], SHUTTER_PROGRESS + duck[1], p)),
        depth: awake ? 0 : spanProgress(p, 'PHOTO_APPROACH', 'PHOTO_DEPTH'),
        inside: within,
        sea: this.view === 'sea' ? 1 : 0,
        chord: awake ? 4 : this.view === 'sea' ? 3 : within > 0.5 ? 2 : p > SHUTTER_PROGRESS ? 1 : 0,
      },
      dt,
    );
    const focus = this.look.focus?.memory;
    this.overlay.update({
      progress: p,
      exploring: this.look.enabled,
      turned: this.look.turned,
      dragHintAfter: lookConfig.hintFadeAfterDegrees,
      ending: p >= TITLE_BACK,
      focus: focus ? { memory: focus, progress: this.look.focusSeconds / lookConfig.discoverSeconds, known: this.memories.has(focus) } : null,
      found: this.memories.count,
      total: this.memories.total,
    });
    // resolution never changes mid-transition, around the shutter or at the passages
    const quiet = this.view === 'portal' || Math.abs(p - SHUTTER_PROGRESS) < directorConfig.adaptQuiet || Math.abs(p - LAST_PICTURE) < directorConfig.adaptQuiet;
    this.pipeline.adapt(dt, !quiet);
    if (this.debug) {
      const c = inside(this.view) ? world.position : this.camera.position;
      this.debug.update(dt, {
        camera: { x: c.x, y: c.y, z: c.z },
        view: this.view,
        transition: `portal ${portalMix.toFixed(2)} travel ${travel.toFixed(2)} entry ${entry.toFixed(2)} walk ${phaseProgress(p, 'WORLD').toFixed(3)} d ${Number.isFinite(shot.photoDistance) ? shot.photoDistance.toFixed(3) : '-'}`,
        assets: `${this.assets.loaded}/${this.assets.total}${this.assets.failed.length ? ` failed ${this.assets.failed.length}` : ''}`,
      });
    }
  }

  /** A memory holding the gaze long enough is found. */
  private discover(): void {
    const id = this.look.focus?.memory;
    if (!id || this.look.focusSeconds < lookConfig.discoverSeconds || !this.memories.find(id)) return;
    this.overlay.memoryFound(id);
    this.audio.discover();
  }

  /**
   * The viewer's camera inside the picture (walk frame): the passage through the print, then the walk,
   * with the viewer's own look added on top.
   */
  private poseInside(p: number, travel: number, entry: number, aspect: number): PerspectiveCamera {
    const world = this.portal.world;
    if (p < WALK_START) {
      const fov = transitionConfig.depthFov + (transitionConfig.worldFov - transitionConfig.depthFov) * smootherstep(entry);
      this.portal.poseWorldCamera(travel, entry, this.stand, PhotoPortal.fitFov(fov * this.look.zoom, aspect), aspect);
      this.walkEye.copy(world.position);
      return world;
    }
    this.walk.update(phaseProgress(p, 'WORLD'), this.time);
    world.position.copy(this.walk.position);
    this.walkEye.copy(world.position);
    // the look fades in after the passage, is drawn to the giant print as you pass through it, and
    // gives way to the photographer's camera before the last picture
    const toPrint = Math.abs(this.walkEye.z - walkConfig.printZ);
    const lookIn =
      smootherstep(range(WALK_START, LOOK_IN, p)) *
      smootherstep(range(walkConfig.pull[0], walkConfig.pull[1], toPrint)) *
      (1 - smootherstep(range(FACE_FROM, FACE_TO, p)));
    const pitch = clamp(this.walk.pitch + this.look.pitchOffset * lookIn, -MAX_PITCH, MAX_PITCH);
    euler.set(pitch, this.walk.yaw + this.look.yawOffset * lookIn, this.walk.roll);
    world.quaternion.setFromEuler(euler);
    world.fov = PhotoPortal.fitFov(this.walk.fov * this.look.zoom, aspect);
    world.aspect = aspect;
    world.near = renderConfig.near;
    world.updateProjectionMatrix();
    world.updateMatrixWorld(true);
    return world;
  }

  /** The giant print: a still of the sea from afar, a live window into it up close. */
  private updateGiantPrint(world: PerspectiveCamera): void {
    const u = this.dream.giant.photo.uniforms;
    u.uResolution.value.copy(this.pipeline.resolution);
    u.uTime.value = this.time;
    u.uPortal.value = this.view === 'world' ? this.dream.giant.liveMix(this.walkEye) : 0;
    this.seaWindow.copy(world, false);
    this.seaWindow.position.add(SEA);
    this.seaWindow.updateMatrixWorld(true);
  }

  /** Draw the sea, seen from where the viewer stands, into the window — only where the giant print's image is on screen. */
  private renderSeaWindow(world: PerspectiveCamera): void {
    if (this.dream.giant.photo.uniforms.uPortal.value <= 0) return;
    const res = this.pipeline.resolution;
    const rect = this.dream.giant.screenRect(world, res.x, res.y, this.windowRect);
    if (!rect) return;
    const rt = this.pipeline.portalRT;
    rt.scissor.copy(rect);
    rt.scissorTest = true;
    this.renderDream(rt, this.seaWindow);
  }

  private updateLights(p: number): void {
    const since = this.time - this.shutterTime;
    const f = directorConfig.flash;
    const flash = this.captured && p < phaseEnd('CAPTURE') ? clamp(since / f.attack, 0, 1) * Math.exp(-Math.max(0, since - f.attack) / f.decay) : 0;
    this.flash.intensity = flash * lightingConfig.flash.intensity;
    this.photographer.camera.lensAnchor.getWorldPosition(this.flash.position);
    // the last picture: a white that takes the whole sea, and the photographer's flash at its heart
    const e = phaseProgress(p, 'EXPLORATION');
    const white = smootherstep(range(END.flash - END.whiteIn, END.flash, e)) * (1 - smootherstep(range(END.cut, END.whiteOut, e)));
    // the cameras share their flash window: it glows on the photographer on the water
    this.photographer.camera.flash = Math.max(flash, p < AWAKE ? white : 0);
    this.composite.flash = flash * f.screen + white * END.white;
  }

  private updatePrintMaterial(p: number, depth: number, entry: number, portalMix: number): void {
    const u = this.print.uniforms;
    u.uResolution.value.copy(this.pipeline.resolution);
    u.uTime.value = this.time;
    if (this.view === 'awake') {
      // the print in the photographer's hand develops the last picture
      u.uDevelop.value = range(END.develop[0], END.develop[1], phaseProgress(p, 'EXPLORATION'));
      u.uLit.value = photoConfig.litFrom;
      u.uPortal.value = 0;
      u.uSheen.value = 0;
      this.composite.sheen = 0;
      return;
    }
    u.uDevelop.value = range(0, photoConfig.developEnd, phaseProgress(p, 'PHOTO_REVEAL'));
    u.uLit.value = photoConfig.litFrom + (1 - photoConfig.litFrom) * smootherstep(phaseProgress(p, 'PHOTO_APPROACH'));
    u.uPortal.value = portalMix;
    // the glossy surface catches the light as we near it, then slides away as we pass through
    const sh = transitionConfig.sheen;
    const sheen = sh.strength * smootherstep(range(sh.rise, transitionConfig.coverMargin, depth)) * (1 - smootherstep(range(sh.fade[0], sh.fade[1], entry)));
    u.uSheen.value = sheen;
    u.uSheenOffset.value = -sh.slide * smootherstep(range(0, sh.slideEnd, entry)) + sh.lead * (1 - depth);
    // drawn once: by the print while it is a print or a window, by the screen once it is the world
    this.composite.sheen = this.view === 'world' ? sheen : 0;
    this.composite.sheenOffset = u.uSheenOffset.value;
  }

  private updateComposite(p: number, shot: ShotState, entry: number): void {
    const c = this.composite;
    c.fade = 1 - smootherstep(range(0, renderConfig.fadeInSeconds, this.time));
    if (this.view === 'world' || this.view === 'sea') {
      c.aperture = 0;
      c.soft = 0;
      const into = entry * transitionConfig.gradeEntryShare + range(WALK_START, GRADE_IN, p) * (1 - transitionConfig.gradeEntryShare);
      this.gradeNow.lerpGrades(this.gradeThrough, this.dream.grade, smootherstep(into));
    } else {
      c.focus = shot.focus;
      c.aperture = shot.aperture;
      // the lens hunting for focus while the camera is raised to the eye
      c.soft = this.view === 'awake' ? 0 : directorConfig.lensHunt * Math.sin(Math.PI * range(phaseStart('AIM'), phaseEnd('FOCUS'), p)) * (1 - range(phaseStart('FOCUS'), phaseEnd('FOCUS'), p));
      this.gradeNow.copy(this.gradeOuter);
    }
  }
}
