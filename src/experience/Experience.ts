import {
  DataTexture,
  Euler,
  EquirectangularReflectionMapping,
  Group,
  type Light,
  type Object3D,
  type Texture,
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
import { LAST_WINDOW, STREET_CHOICE, WAKES } from '../config/film.config';
import { EVENINGS, eveningStarts, JOURNEY } from '../config/journey.config';
import {
  at,
  DEBUG_MODE,
  directorConfig,
  REDUCED_MOTION,
  LAYERS,
  lookConfig,
  photoConfig,
  renderConfig,
  timelineConfig,
  transitionConfig,
} from '../config/experience.config';
import { lightingConfig } from '../config/scene.config';
import { seaConfig } from '../config/sea.config';
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
import { Scares } from './director/Scares';
import { FourthWall } from './rooms/FourthWall';
import { JourneyDirector } from './rooms/JourneyDirector';
import type { Room, RoomPose } from './rooms/Room';
import { Film } from './film/Film';
import { RoomInputs } from './interaction/RoomInputs';
import { LookControls } from './interaction/LookControls';
import { ScrollInput } from './interaction/ScrollInput';
import { clamp, DEG, range, smootherstep } from './math';
import { Photograph } from './photograph/Photograph';
import { Grade } from './render/Grade';
import './render/Warp';
import { Pipeline, restingFx, type CompositeState } from './render/Pipeline';
import { cueToProgress, phaseEnd, phaseProgress, phaseStart, roomAt, SHUTTER_PROGRESS, spanProgress, stepAt, Timeline, wakeAt } from './timeline/Timeline';
import { PhotoPortal } from './transition/PhotoPortal';
import { Alley } from './world/Alley';
import { SkyDome } from './world/SkyDome';

/**
 * outer: the real moment. portal: the print is a window. world: inside the picture, in the alley.
 * sea: beyond the giant print. wake: the street again, where an evening broke off (and once more after the
 * credits). awake: outside again, after the last photograph.
 */
type View = 'outer' | 'portal' | 'world' | 'sea' | 'wake' | 'awake';

/** Only what the first minutes need: everything else comes when the journey nears it (see rooms/JourneyDirector.ts). */
const MODELS = [
  'photographer', 'kit_apartments', 'kit_factory', 'street_lamp_wall', 'street_lamp_post', 'security_light',
  'pull_chain_socket', 'lightbulb', 'hanging_lamp', 'trash_can', 'trashbag', 'cardboard_box', 'wooden_crate',
  'plastic_crate', 'monobloc_chair', 'cafe_set', 'aircon', 'gutter_kit', 'cable_kit', 'utility_box', 'power_box',
  'manhole', 'fire_escape', 'wall_clock', 'potted_plant', 'weeds', 'planter_pot', 'security_camera',
  // the people of the nightmare
  'figure_man', 'figure_nurse', 'figure_woman', 'figure_child',
] as const;
const MATERIALS = ['setts_wet', 'concrete_worn', 'asphalt', 'plaster_damaged'] as const;

const SEA = new Vector3(...seaConfig.offset);
const END = walkConfig.ending;
/** Of the loader's bar: the files; the rest is the building and the shaders. */
const FILES_SHARE = 0.6;
const WALK_START = phaseStart('WORLD');
const STREET_SEEN = phaseStart('INTRO');
/** The waking that is the glimpse of the cold open (the street as it will be): not a break in the dream. */
const GLIMPSE = WAKES.length - 1;
/** Under the names the world falls back to this share of itself (the voice and the score stay). */
const CREDITS_QUIET = 0.2;
/** After Begin, the film waits this long at most (s) for the sound to start before it runs without it. */
const START_WAIT = 0.6;
/** How far the print in the hand comes up when the viewer lets the last street be (0..1), and over how long (s). */
const STAY_DEVELOP = { to: 0.14, over: 1.6 };
const LOOK_IN = cueToProgress(['WORLD', lookConfig.blendIn]);
const GRADE_IN = cueToProgress(['WORLD', walkConfig.gradeSpan]);
const LAST_PICTURE = cueToProgress(['EXPLORATION', END.flash]);
const AWAKE = cueToProgress(['EXPLORATION', END.cut]);
const FACE_FROM = cueToProgress(['WORLD', walkConfig.faceTheCamera[0]]);
const FACE_TO = cueToProgress(['EXPLORATION', walkConfig.faceTheCamera[1]]);
/** Pitch limit of walk + look together (rad). */
const MAX_PITCH = 85 * DEG;
/** What has just come into the journey is drawn once more, unseen, into a picture of this size (px): only that it is drawn matters. */
const WARM_SIZE: readonly [number, number] = [64, 36];
/** A stretch of the walk gets that drawing only while the cut still covers this much of the picture (0..1). */
const WARM_UNDER = 0.9;

/** How far an earlier visit got (the evening's number; only here, on the viewer's own machine). */
const REACHED_KEY = 'dream-of-the-photo/evening';
const EVENING_AT = eveningStarts.map((step) => cueToProgress(['STEP', step, 0]));

function readReached(): number {
  try {
    return Math.min(EVENINGS.length - 1, Number(localStorage.getItem(REACHED_KEY) ?? 0) || 0);
  } catch {
    return 0;
  }
}

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
  /** The lens that took the first picture, seeing the real street: what comes up on the print at the end. */
  private readonly streetLens = new PerspectiveCamera(photoConfig.captureFov, 1, renderConfig.near, renderConfig.far);
  private readonly timeline = new Timeline();
  private readonly overlay = new Overlay();
  private readonly audio = new AudioEngine();
  private readonly portal = new PhotoPortal();
  private readonly walk = new DreamWalk();
  private readonly look: LookControls;
  private readonly followers = new Group();
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
  private scares!: Scares;
  private journey!: JourneyDirector;
  private room: Room | null = null;
  private readonly roomPose: RoomPose = { position: new Vector3(), yaw: 0, pitch: 0, roll: 0, fov: 60 };
  private readonly roomInputs: RoomInputs;
  private readonly fourthWall = new FourthWall();
  /** The narrator, the lines at the foot of the picture and the score. */
  private readonly film: Film;
  private inWake = false;
  /** When Begin was pressed (s of `time`; -1 before), and whether the film has started (the sound is ready, or it was waited for). */
  private begunAt = -1;
  private started = false;
  /** The share of itself the world is heard at now (see CREDITS_QUIET). */
  private quietNow = -1;
  /** The last street: what the viewer chose, when, and what of it has happened. */
  private choice: 'none' | 'home' | 'stay' = 'none';
  private choiceAt = 0;
  private choiceDone = false;
  /** The prompt of the choice is showing. */
  private overlayAsks = false;
  /** When a room's shutter last fired (see updateLights). */
  private roomShutter = -10;
  /** The evening reached, and the one an earlier visit reached (0 for none). */
  private evening = 0;
  private continued = false;
  private flash!: PointLight;
  private debug: Debug | null = null;
  /** Rooms, and the last stretch of the walk, already drawn once with all they keep hidden (see warm); what was hidden; where it is drawn. */
  private readonly warmed = new WeakSet<Room>();
  private warmedStep = -1;
  private readonly warmHidden: Object3D[] = [];
  private readonly warmTarget = new WebGLRenderTarget(WARM_SIZE[0], WARM_SIZE[1]);

  private readonly gradeOuter = Grade.from(directorConfig.outerGrade);
  private readonly gradePhoto = Grade.from(photoConfig.grade);
  private readonly gradeThrough = new Grade().composeOf(this.gradeOuter, this.gradePhoto);
  private readonly gradeNow = new Grade();
  private readonly composite: CompositeState;

  private captured = false;
  private paused = false;
  /** The dream moves on by itself unless the visitor switches that off. */
  private autoWalk = true;
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
    this.roomInputs = new RoomInputs(canvas);
    this.scroll = new ScrollInput(this.timeline, canvas);
    this.scroll.enabled = false;
    this.film = new Film(this.audio.film, this.overlay);
    this.look.touchAllowed = () => this.scroll.touchAxis === 'x';
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.overlay.fail(say('lost'));
    });
    this.camera.layers.set(LAYERS.WORLD);
    this.camera.layers.enable(LAYERS.OUTER);
    for (const cam of [this.portal.capture, this.portal.world, this.seaWindow]) {
      cam.layers.set(LAYERS.WORLD);
      cam.layers.enable(LAYERS.DREAM);
    }
    this.streetLens.layers.set(LAYERS.WORLD);
    this.streetLens.layers.enable(LAYERS.OUTER);
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
      fx: restingFx(),
    };
    this.overlay.onSoundToggle = () => void this.audio.toggle().then((on) => this.overlay.setSound(on));
    this.overlay.onVoiceToggle = (on) => (this.film.voiceOn = on);
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
      if (this.begunAt < 0) this.begunAt = this.time;
      if (!this.continued) this.journey.album.clear();
      this.timeline.auto = this.autoWalk;
      if (gesture) void this.audio.unlock().then((on) => this.overlay.setSound(on));
    };
    this.overlay.onAuto = (on) => {
      this.autoWalk = on;
      this.timeline.auto = on;
    };
    this.overlay.onPause = (paused) => {
      this.paused = paused;
      this.scroll.enabled = !paused;
      this.audio.setPaused(paused);
    };
    this.overlay.onRestart = () => {
      this.timeline.seek(0);
      this.journey.reset();
      this.evening = 0;
    };
    this.overlay.onSkip = () => {
      const p = this.timeline.progress;
      this.timeline.seek(p < WALK_START ? WALK_START : Math.max(p, stepAt(p).to + 1e-6));
    };
    this.overlay.onContinue = () => {
      this.continued = true;
      this.timeline.seek(EVENING_AT[readReached()]);
    };
    this.overlay.albumPictures = () => this.journey.album.pictures.map((p) => p.canvas);
    const reached = readReached();
    if (reached > 0) this.overlay.offerContinue(EVENINGS[reached].title);
    window.addEventListener('resize', () => (this.resizePending = true));
    document.addEventListener('visibilitychange', () => this.audio.setHidden(document.hidden));
  }

  async start(): Promise<void> {
    this.resize();
    const progress = window.setInterval(() => this.overlay.setLoadProgress(this.assets.fraction * FILES_SHARE), 100);
    await this.load();
    window.clearInterval(progress);
    this.overlay.setLoadProgress(FILES_SHARE);
    await new Promise((resolve) => setTimeout(resolve));
    this.build();
    await this.precompile();
    const face = this.photographer.faceToPrepare;
    if (face) this.pipeline.renderer.initTexture(face);
    this.dream.developFirst();
    this.scares.develop();
    this.overlay.setLoadProgress(FILES_SHARE + (1 - FILES_SHARE) * 0.4);
    const roomTest = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('room') : null;
    if (roomTest) {
      await this.journey.prepareRoom(roomTest);
      this.timeline.seek(cueToProgress(['ROOM', roomTest, 0]));
    } else await this.journey.prepareOpening();
    this.overlay.setLoadProgress(1);
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
    const p = this.pipeline;
    await p.compileScene(this.scene, this.camera);
    this.dream.setPass('dream', this.portal.capture);
    await p.compileScene(this.scene, this.portal.capture);
    await this.dream.whileFullyDreamt(() => p.compileScene(this.scene, this.portal.capture), this.portal.capture);
    this.dream.setPass('real', this.camera);
  }

  private async load(): Promise<void> {
    const a = this.assets;
    await Promise.all([
      ...MODELS.map((k) => a.model(k, `${k}.glb`)),
      ...MATERIALS.map((k) => a.material(k, k)),
      a.environment('env_evening', 'env_evening.hdr'),
      a.environment('sky_dusk', 'sky_dusk.hdr'),
      a.environment('sky_fire', 'sky_fire.hdr'),
      a.environment('env_bathroom', 'env_bathroom.hdr'),
      // what the dream writes on its walls and prints, with the letters Turkish needs
      ...['"Protest Revolution"', '"Just Me Again Down Here"', '"Special Elite"', 'Anton'].map((family) => document.fonts.load(`48px ${family}`, 'ĞğİıŞş Aa').catch(() => undefined)),
    ]);
  }

  private build(): void {
    const renderer = this.pipeline.renderer;
    const pmrem = new PMREMGenerator(renderer);
    const env = this.assets.environments.get('env_evening')!;
    env.mapping = EquirectangularReflectionMapping;
    this.scene.environment = pmrem.fromEquirectangular(env).texture;
    this.scene.environmentIntensity = lightingConfig.environmentIntensity;
    const reflections = (k: string): Texture => {
      const t = this.assets.environments.get(k)!;
      t.mapping = EquirectangularReflectionMapping;
      return pmrem.fromEquirectangular(t).texture;
    };
    const environments = { evening: this.scene.environment, fire: reflections('sky_fire'), bathroom: reflections('env_bathroom') };
    pmrem.dispose();

    const skyTex = (k: string): DataTexture => {
      const t = this.assets.environments.get(k)!;
      t.minFilter = LinearFilter;
      t.generateMipmaps = false;
      return t;
    };
    const fireSky = skyTex('sky_fire');
    this.sky = new SkyDome(skyTex('sky_dusk'), fireSky, lightingConfig.backgroundIntensity);
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
      assets: this.assets,
      alley: this.alley,
      sky: this.sky,
      photographer: this.photographer,
      environments,
      fireSky,
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

    this.scares = new Scares({ timeline: this.timeline, audio: this.audio, dream: this.dream, fx: this.composite.fx });
    this.journey = new JourneyDirector(
      this.assets,
      this.dream,
      this.audio,
      (root) => this.pipeline.compileScene(root, this.portal.capture, this.scene).then(() => undefined),
      {
        say: (text, seconds, voice) => this.film.speak(text, voice, seconds),
        hint: (text) => this.overlay.roomPrompt(text),
      },
      (material) => (this.pipeline.renderer.properties.get(material) as { uniforms?: Record<string, { value: unknown }> }).uniforms,
    );
    this.alley.castFrom(this.dream.kit.figures);
    this.buildFollowers();

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

  /** They have followed you out: down the real alley, only once you are awake. */
  private buildFollowers(): void {
    for (const f of END.followers) {
      const crowd = this.dream.kit.figures.crowd({ avatar: f.avatar, clip: f.clip, time: f.time, face: 'scratched', veil: f.veil }, f.at.length);
      f.at.forEach(([x, z], i) => crowd.set(i, x, 0, z, 0));
      crowd.commit();
      this.followers.add(crowd.root);
    }
    this.followers.traverse((o) => o.layers.set(LAYERS.OUTER));
    this.followers.visible = false;
    this.scene.add(this.followers);
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

  /**
   * What has just come into the journey is drawn once more, small and unseen, with everything it keeps hidden or
   * out of reach for later: a room on its first frame, the set pieces of a stretch of the walk on theirs. Both
   * lie under the cut. So what a late arrival needs for the first time (the shadow pass of a new kind of body, a
   * picture or a buffer never drawn before) is made where a held frame is not seen, and not in the middle of a
   * scene. The shaders of the picture itself are compiled when a thing is built (see Pipeline.compileScene).
   */
  private warm(p: number, room: Room | null, camera: PerspectiveCamera): void {
    const hidden = this.warmHidden;
    if (room) {
      if (this.warmed.has(room)) return;
      this.warmed.add(room);
      room.root.traverse((o) => {
        if (!o.visible && !(o as Light).isLight) hidden.push(o);
      });
    } else {
      const step = stepAt(p).index;
      if (step === this.warmedStep || this.journey.cover < WARM_UNDER || this.journey.buildingNow()) return;
      this.warmedStep = step;
      this.dream.hiddenNow(hidden);
    }
    if (hidden.length === 0) return;
    const shadows = this.pipeline.renderer.shadowMap;
    for (const o of hidden) o.visible = true;
    shadows.needsUpdate = true;
    try {
      this.pipeline.renderTo(this.warmTarget, this.scene, camera);
    } catch (reason) {
      console.error(`${room ? `room ${room.id}` : 'the walk'} could not be drawn ahead`, reason);
    } finally {
      for (const o of hidden) o.visible = false;
      hidden.length = 0;
      // the shadows this frame shows are those of what is really there
      shadows.needsUpdate = true;
    }
  }

  /** A room's worst moment: the picture on the screen goes into the album, and then the flash. */
  private roomPicture(): void {
    this.journey.shutterAsked = false;
    if (!this.room) return;
    this.journey.album.take(this.room.id, this.pipeline.renderer.domElement);
    if (this.journey.shutterFlash) this.roomShutter = this.time;
    this.audio.shutter();
  }

  /**
   * The last street, the one choice of the film (see STREET_CHOICE): pressed while it is asked, the house is heard
   * taking you back in the dark; not pressed, the print starts to come up and the picture is taken. Leaving the
   * street (going back, starting over) forgets the choice.
   */
  private lastStreet(seconds: number, asking: boolean, pressed: boolean): void {
    const C = STREET_CHOICE;
    if (seconds < 0) {
      if (this.choice !== 'none' || this.overlayAsks) this.overlay.roomPrompt(null);
      this.choice = 'none';
      this.choiceDone = this.overlayAsks = false;
      return;
    }
    if (asking !== this.overlayAsks) {
      this.overlayAsks = asking;
      this.overlay.roomPrompt(asking ? C.prompt : null);
    }
    if (this.choice === 'none' && asking && pressed) {
      this.choice = 'home';
      this.choiceAt = this.time;
      this.overlay.roomPrompt(null);
      this.film.cue(C.home.cue);
    } else if (this.choice === 'none' && seconds >= C.decide) {
      this.choice = 'stay';
      this.choiceAt = this.time;
      this.film.speak(C.stay.text, C.stay.voice);
    }
    const since = this.time - this.choiceAt;
    if (this.choice === 'home' && !this.choiceDone && since >= C.home.after) {
      this.choiceDone = true;
      this.film.speak(C.home.text, C.home.voice);
    } else if (this.choice === 'stay' && !this.choiceDone && since >= C.stay.shutterAfter) {
      this.choiceDone = true;
      this.roomShutter = this.time;
      this.audio.shutter();
    }
  }

  /** How black the last street has gone after the choice (0..1). */
  private streetBlack(): number {
    const C = STREET_CHOICE;
    const since = this.time - this.choiceAt;
    if (this.choice === 'home') return smootherstep(range(0, C.black.home, since));
    if (this.choice === 'stay') return since >= C.stay.shutterAfter + C.black.stay ? 1 : 0;
    return 0;
  }

  /** Remember how far the viewer got, so a half hour need not be sat through at once. */
  private noteEvening(p: number): void {
    let i = EVENING_AT.length - 1;
    while (i > 0 && p < EVENING_AT[i]) i--;
    if (i === this.evening || p < EVENING_AT[0]) return;
    this.evening = i;
    try {
      localStorage.setItem(REACHED_KEY, String(i));
    } catch {
      // private window: there is simply nothing to go on from next time
    }
  }

  /**
   * The photographer standing on the water takes the last picture. What comes up on the print in your hand is the
   * street as you photographed it, its window lit and four at the table: the real street, seen by the lens that
   * took the first picture, with nobody standing in it.
   */
  private takeLastPicture(): void {
    this.lastTaken = true;
    this.dream.photographerGone = true;
    const lens = this.streetLens;
    lens.position.copy(this.portal.capture.position);
    lens.quaternion.copy(this.portal.capture.quaternion);
    lens.updateMatrixWorld(true);
    const shown = this.alley.homeShown;
    this.alley.setHome(END.picture, this.time);
    const followers = this.followers.visible;
    this.photographer.root.visible = this.followers.visible = false;
    // the real street's shadows, not the dream's (the dream draws its own again on its next frame)
    const shadows = this.pipeline.renderer.shadowMap;
    const auto = shadows.autoUpdate;
    shadows.autoUpdate = true;
    this.dream.setPass('real', lens);
    this.pipeline.renderTo(this.captureRT, this.scene, lens);
    shadows.autoUpdate = auto;
    this.photographer.root.visible = true;
    this.followers.visible = followers;
    if (shown) this.alley.setHome(shown, this.time);
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

  /** For tools that look at one place of the journey. */
  progressOfRoom(id: string, t: number): number {
    return cueToProgress(['ROOM', id, t]);
  }

  progressOfWalk(t: number): number {
    return cueToProgress(['WORLD', t]);
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

    // the film begins once the sound can be heard (or has been waited for): the table in the dark is half of it
    if (!this.started && this.begunAt >= 0 && (this.audio.running || this.time - this.begunAt > START_WAIT)) this.started = true;
    // paused, the dream goes on breathing but time in it stands still
    if (!this.paused && (this.begunAt < 0 || this.started)) this.timeline.update(dt);
    const p = this.timeline.progress;
    const room = this.journey.update(p);
    this.room = room;
    if (this.journey.jump !== null) this.timeline.seek(this.journey.jump);
    else this.timeline.bounds = this.journey.bounds;
    this.timeline.locked = room ? !room.control.scroll : false;
    this.timeline.hurry = room ? (room.control.hurry ?? timelineConfig.hurryRoom) : p >= WALK_START && p < phaseStart('EXPLORATION') ? timelineConfig.hurryWalk : Infinity;
    const streetSeconds = p >= phaseStart('STREET') && p < phaseStart('CREDITS') ? (p - phaseStart('STREET')) / timelineConfig.autoRate : -1;
    const asking = this.choice === 'none' && streetSeconds >= STREET_CHOICE.ask && streetSeconds < STREET_CHOICE.decide;
    this.roomInputs.listening = Boolean(room?.control.press) || asking;
    this.scroll.spaceTaken = this.roomInputs.listening;
    const input = this.roomInputs.update(dt, this.timeline.legs, this.look.yawOffset, this.look.pitchOffset, this.fourthWall.returned);
    this.dream.setRoom(room, roomAt(p)?.t ?? 0, input);
    this.lastStreet(streetSeconds, asking, input.pressed);
    this.fourthWall.returned = 0;
    this.noteEvening(p);
    this.film.ahead(p < WALK_START ? -1 : p >= phaseStart('EXPLORATION') ? JOURNEY.length : stepAt(p).index);
    this.scares.journeyCut.cover = this.journey.cover;
    this.scares.journeyCut.white = this.journey.coverWhite;
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
    // the street between two evenings: the hair as white as it is by then, and a head that only looks at the print
    const wake = wakeAt(p);
    // the dream breaks off in the middle of a word: nothing of it is left in the air of the street (the glimpse in
    // the cold open is not a break: the table goes on being heard)
    const broken = wake !== null && wake.n !== GLIMPSE;
    if (broken && !this.inWake) this.film.cut();
    this.inWake = broken;
    this.audio.street(broken);
    if (this.started) this.film.update(p, this.paused);
    // only the table and the voices are heard in the dark of the cold open; under the names the world falls back
    const worldShare = p < STREET_SEEN ? 0 : p >= phaseStart('CREDITS') ? CREDITS_QUIET : 1;
    if (worldShare !== this.quietNow) {
      this.audio.film.quiet(worldShare, this.quietNow < 0 || worldShare === 0 ? 0 : renderConfig.fadeInSeconds);
      this.quietNow = worldShare;
    }
    this.photographer.whiteOverride = wake ? WAKES[wake.n].white : null;
    this.photographer.calm = wake !== null;
    // the window of the house as that evening left it, dark from the last picture to the end, else as at half past six; and who stands in the street
    this.alley.setHome(wake ? WAKES[wake.n].window : p >= LAST_PICTURE && p < phaseStart('STREET') ? LAST_WINDOW : WAKES[0].window, this.time);
    this.alley.setPeople(wake ? WAKES[wake.n].people : undefined);
    this.photographer.update(p, this.time);
    const aspect = this.pipeline.size.x / Math.max(1, this.pipeline.size.y);
    const shot = wake
      ? this.director.poseWake(this.camera, wake.n, wake.t, this.time, aspect)
      : p >= AWAKE
        ? this.director.poseEnding(this.camera, phaseProgress(p, 'EXPLORATION'), this.time, aspect)
        : this.director.pose(this.camera, p, this.time, dt, aspect);

    // the passage: flat print -> live window -> world
    const depth = phaseProgress(p, 'PHOTO_DEPTH');
    const travel = smootherstep(spanProgress(p, 'PHOTO_DEPTH', 'PHOTO_ENTRY'));
    const entry = phaseProgress(p, 'PHOTO_ENTRY');
    const covered = p >= phaseStart('PHOTO_DEPTH') && shot.photoDistance < this.portal.coverDistance(this.camera.fov, aspect);
    const portalMix = smootherstep(range(0, transitionConfig.portalFade, depth));

    // inside: the gaze is yours (except at the passage through the giant print and before the last picture)
    this.look.enabled = p >= WALK_START && p < LAST_PICTURE && !wake && (!room || room.control.look);
    this.scroll.lookEnabled = this.look.enabled;
    const walking = clamp(speed / lookConfig.walkSpeed, 0, 1);
    // the dream's own pace does not count as hurrying: attention can still narrow the view
    this.look.moving = speed > timelineConfig.autoRate * lookConfig.hurrying;
    if (p >= WALK_START) this.look.recenter(walking, dt);
    if (!this.paused) this.look.update(dt);
    const world = this.poseInside(p, travel, entry, aspect);
    const sea = !room && p >= WALK_START && (this.walkEye.z < walkConfig.printZ || this.dream.giant.covers(world));
    if (sea) {
      world.position.add(SEA);
      world.updateMatrixWorld(true);
    }
    // paused, the gaze holds still: nothing draws it in behind the menu
    this.look.updateAttention(world.quaternion, world.position, world.fov, this.paused ? 0 : dt);

    const previous = this.view;
    if (wake) this.view = 'wake';
    else if (p < phaseStart('PHOTO_DEPTH')) this.view = 'outer';
    else if (p >= AWAKE) this.view = 'awake';
    else if (p < phaseEnd('PHOTO_DEPTH') && !covered) this.view = 'portal';
    else this.view = sea ? 'sea' : 'world';
    // leaving the picture backwards: the print now holds whatever happened inside, so going back stays seamless
    const inside = (v: View) => v === 'world' || v === 'sea';
    if (inside(previous) && (this.view === 'outer' || this.view === 'portal')) this.renderPhotograph();

    this.followers.visible = this.view === 'awake';
    this.updateLights(p);
    const stayed = wake?.n === 0 && this.choice === 'stay' ? STAY_DEVELOP.to * smootherstep(range(this.choiceAt, this.choiceAt + STAY_DEVELOP.over, this.time)) : 0;
    this.updatePrintMaterial(p, depth, entry, portalMix, wake ? Math.max(WAKES[wake.n].develop, stayed) : -1);
    this.updateComposite(p, shot, entry);
    const within = inside(this.view) ? smootherstep(range(phaseStart('PHOTO_ENTRY'), phaseEnd('PHOTO_ENTRY'), p)) : 0;
    this.dream.update(this.time, dt, world, within, this.look.enabled, phaseProgress(p, 'WORLD'), this.paused);
    this.updateGiantPrint(world);
    this.scares.update(p, phaseProgress(p, 'WORLD'), this.time, dt, this.paused, wake !== null);
    this.composite.fx.black = Math.max(this.composite.fx.black, this.streetBlack());

    // render
    const shadows = this.pipeline.renderer.shadowMap;
    if (inside(this.view)) {
      // nothing casts a moving shadow in the dream: a space's shadow map is rendered once, on entering it
      shadows.autoUpdate = false;
      if (this.view === 'world') this.renderSeaWindow(world);
      this.dream.mainPass(world);
      if (this.dream.shadowDirty) {
        shadows.needsUpdate = true;
        this.dream.shadowDirty = false;
      }
      this.warm(p, room, world);
      this.pipeline.renderTo(this.pipeline.sceneRT, this.scene, world);
      this.pipeline.present(world, this.composite, this.time);
      if (this.journey.shutterAsked) this.roomPicture();
    } else {
      // the street between two evenings holds still (a breath moves nothing a shadow would show): its shadows are drawn once, on the cut to it
      shadows.autoUpdate = this.view !== 'wake';
      if (this.view === 'wake' && previous !== 'wake') shadows.needsUpdate = true;
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
    const street = awake || this.view === 'wake';
    // a room keeps its own sound and its own silences: to the story around it, it is the inside of the picture
    const picture = room ? 1 : within;
    this.audio.update(
      {
        focusDuck: smootherstep(range(phaseStart('FOCUS'), phaseEnd('FOCUS'), p)) * (1 - range(SHUTTER_PROGRESS + duck[0], SHUTTER_PROGRESS + duck[1], p)),
        depth: street ? 0 : spanProgress(p, 'PHOTO_APPROACH', 'PHOTO_DEPTH'),
        inside: picture,
        sea: this.view === 'sea' ? 1 : 0,
        chord: awake ? 4 : this.view === 'sea' ? 3 : picture > 0.5 ? 2 : p > SHUTTER_PROGRESS ? 1 : 0,
      },
      dt,
    );
    this.audio.nightmare(
      {
        walk: phaseProgress(p, 'WORLD'),
        fear: this.dream.fear,
        beat: this.dream.beat,
        region: this.dream.region,
        inside: room ? 0 : within,
      },
      dt,
    );
    this.overlay.update({
      progress: p,
      exploring: this.look.enabled,
      turned: this.look.turned,
      dragHintAfter: lookConfig.hintFadeAfterDegrees,
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

  /**
   * The viewer's camera inside the picture (walk frame): the passage through the print, then the walk,
   * with the viewer's own look added on top.
   */
  private poseInside(p: number, travel: number, entry: number, aspect: number): PerspectiveCamera {
    const world = this.portal.world;
    if (this.room) {
      const pose = this.room.pose(roomAt(p)?.t ?? 0, this.roomPose);
      world.position.copy(pose.position);
      this.walkEye.copy(pose.position);
      const f = walkConfig.float;
      const drift = REDUCED_MOTION ? 0 : this.room.drift;
      const phase = (this.time / f.period) * Math.PI * 2;
      world.position.y += Math.sin(phase) * f.amount * drift;
      const pitch = clamp(pose.pitch + this.look.pitchOffset, -MAX_PITCH, MAX_PITCH);
      euler.set(pitch, pose.yaw + this.look.yawOffset, pose.roll + Math.sin(phase * 0.7 + 1) * f.roll * DEG * drift);
      world.quaternion.setFromEuler(euler);
      world.fov = PhotoPortal.fitFov(pose.fov * this.look.zoom, aspect);
      world.aspect = aspect;
      world.near = renderConfig.near;
      world.updateProjectionMatrix();
      world.updateMatrixWorld(true);
      return world;
    }
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
    u.uPortal.value = this.view === 'world' && !this.room ? this.dream.giant.liveMix(this.walkEye) : 0;
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
    const sinceRoom = this.time - this.roomShutter;
    const roomFlash = clamp(sinceRoom / f.attack, 0, 1) * Math.exp(-Math.max(0, sinceRoom - f.attack) / f.decay);
    // the cameras share their flash window: it glows on the photographer on the water
    this.photographer.camera.flash = Math.max(flash, p < AWAKE ? white : 0);
    this.composite.flash = (flash + roomFlash) * f.screen + white * END.white;
  }

  private updatePrintMaterial(p: number, depth: number, entry: number, portalMix: number, wakeDevelop: number): void {
    const u = this.print.uniforms;
    u.uResolution.value.copy(this.pipeline.resolution);
    u.uTime.value = this.time;
    if (this.view === 'awake' || this.view === 'wake') {
      // the print in the photographer's hand: as far along as that evening left it; at the end it develops the last picture
      u.uDevelop.value = this.view === 'wake' ? wakeDevelop : range(END.develop[0], END.develop[1], phaseProgress(p, 'EXPLORATION'));
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
    // the picture comes up out of black twice: when the page opens, and when the street is first seen
    const seen = this.view === 'wake' ? 1 : smootherstep(range(STREET_SEEN, STREET_SEEN + at(renderConfig.fadeInSeconds), p));
    c.fade = 1 - Math.min(seen, smootherstep(range(0, renderConfig.fadeInSeconds, this.time)));
    if (this.view === 'world' || this.view === 'sea') {
      c.aperture = this.room?.aperture ?? 0;
      c.focus = this.room?.focus ?? c.focus;
      c.soft = 0;
      const into = entry * transitionConfig.gradeEntryShare + range(WALK_START, GRADE_IN, p) * (1 - transitionConfig.gradeEntryShare);
      this.gradeNow.lerpGrades(this.gradeThrough, this.dream.grade, smootherstep(into));
    } else {
      c.focus = shot.focus;
      c.aperture = shot.aperture;
      // the lens hunting for focus while the camera is raised to the eye
      c.soft = this.view === 'outer' ? directorConfig.lensHunt * Math.sin(Math.PI * range(phaseStart('AIM'), phaseEnd('FOCUS'), p)) * (1 - range(phaseStart('FOCUS'), phaseEnd('FOCUS'), p)) : 0;
      this.gradeNow.copy(this.gradeOuter);
    }
  }
}
