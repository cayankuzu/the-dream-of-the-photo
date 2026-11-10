import { Group, Vector3, type PerspectiveCamera, type WebGLRenderTarget } from 'three';
import type { Text } from '../../config/copy.config';
import type { RegionLook, SpotSpec, WarpKey } from '../../config/nightmare.config';
import { GlideTrack } from '../timeline/Track';
import { DEG } from '../math';
import type { DreamKit } from '../dream/DreamKit';
import type { DreamFrame, DreamModule } from '../dream/DreamModule';
import type { DreamLight } from '../dream/LightPool';
import type { Album } from './Album';
import type { RoomSound } from './RoomSound';
import { RoomKit } from './RoomKit';

type V3 = readonly [number, number, number];

/** One pose of the viewer through a room (`t`: fraction of the room's time; position in the room's own frame). */
export interface RoomKey {
  t: number;
  at: V3;
  /** Heading (deg, 0 looks along -Z, positive turns left), pitch (deg, positive looks up), roll (deg). */
  yaw: number;
  pitch: number;
  roll?: number;
  fov: number;
}

/** What a room needs from the network before it can be built. */
export interface RoomAssets {
  /** Keys in public/models. */
  models?: readonly string[];
  /** Keys in public/textures. */
  materials?: readonly string[];
  /** File names under public/audio. */
  sounds?: readonly string[];
}

/** What every room is given when it is built. */
export interface RoomContext {
  kit: DreamKit;
  sound: RoomSound;
  /** Where in the world its frame lies: rooms lie so far apart that none can ever see another. */
  origin: Vector3;
  /** Its id on the journey, and which visit to its file this is (`corridor@3` is the third). */
  id: string;
  visit: number;
  /** Seconds it lasts when nobody touches anything. */
  seconds: number;
  /** The pictures kept so far. */
  album: Album;
  /** The voice of the dream, the prompt at the foot of the picture, the shutter (see Room). */
  say(text: Text, seconds: number): void;
  hint(text: Text | null): void;
  shutter(): void;
}

/** The look of a room: as a space of the walk, except that it has no borders to blend across. */
export type RoomAir = Pick<RegionLook, 'fog' | 'env' | 'envIntensity' | 'sky' | 'grade'>;

/** What the room allows the viewer at this moment. */
export interface RoomControl {
  /** Dragging looks around. */
  look: boolean;
  /** Scrolling hurries or holds. */
  scroll: boolean;
  /** A click, a tap, Space and Enter are the room's (see RoomInput), and do not move time. */
  press?: boolean;
  /** How much faster than its own pace scrolling can drive the room at most (default 2.5). */
  hurry?: number;
}

/** What the viewer is doing, for rooms that answer it. */
export interface RoomInput {
  /** Pressed since the last frame: a click or a tap (not a drag), Space or Enter (only with `control.press`). */
  pressed: boolean;
  /** Held down right now: a pointer, Space or Enter (only with `control.press`). */
  holding: boolean;
  /** 0..1 how hard the viewer is scrolling forward right now: their legs. */
  legs: number;
  /** Seconds since the viewer last did anything at all. */
  idle: number;
  /** The gaze off the camera's way (rad): yaw (positive left), pitch (positive up). */
  gazeYaw: number;
  gazePitch: number;
  /** How fast the gaze is moving (rad/s). */
  gazeSpeed: number;
  /** Seconds the page was just away (the tab hidden), on the one frame it came back; else 0. */
  returned: number;
}

/** The dream's frame, with the room's own time and the eye in the room's frame. */
export interface RoomFrame extends DreamFrame {
  /** 0..1 through the room's time. */
  t: number;
  /** Seconds since the room began, at the piece's own pace (`t` times its length). */
  seconds: number;
  input: RoomInput;
}

/** The picture's own damage in a room (all default to rest; see `Look` in director/Scares.ts). */
export interface RoomFilm {
  bloom?: number;
  /** Where bloom starts (linear light) and its tint. */
  bloomFrom?: number;
  bloomTint?: readonly [number, number, number];
  ghost?: number;
  aberration?: number;
  barrel?: number;
  scratches?: number;
  weave?: number;
  flicker?: number;
  grain?: number;
  burn?: number;
}

/** Out-parameter of `Room.pose`. */
export interface RoomPose {
  position: Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  fov: number;
}

const CHANNELS = ['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'fov'] as const;

/**
 * A nightmare of its own: a place apart from everything, where the walk stands still. Subclasses build
 * everything in the constructor using their own frame (the root sits at `ctx.origin`); time arrives as `t`.
 * It lights, fogs and bends itself: see `air`, `spots`, `warp`.
 */
export abstract class Room implements DreamModule {
  readonly root = new Group();
  /**
   * What lies on or just before the lens: it stands at the eye at every render and looks where the eye looks
   * (in meters, -Z ahead, +Y up). Add to it in the constructor, like everything else: hair, flies, dirt, your own teeth.
   */
  readonly lens = new Group();
  readonly span = [Infinity, -Infinity] as const;
  /** The camera's way through the room. */
  abstract readonly keys: readonly RoomKey[];
  abstract readonly air: RoomAir;
  /** Curved space through the room (`at` is its `t`); straight when absent. */
  warp: readonly WarpKey[] | null = null;
  /** Up to three spotlights (absolute positions: use `this.spot`); the first casts shadows, rendered once unless `moving`. */
  spots: readonly (SpotSpec | null)[] = [null, null, null];
  /** The shadow map is rendered every frame (only when something that casts really moves). */
  movingShadows = false;
  /** May change with time: read every frame. */
  control: RoomControl = { look: true, scroll: true };
  /** The camera's lens: focus distance (m) and blur strength; 0 = everything sharp. */
  focus = 3;
  aperture = 0;
  /** How much the eye floats, as in the dream's walk (0 for what holds you still). */
  drift = 1;
  /** 0..1 how afraid the piece is in here: the heart follows it. */
  fear = 0.5;
  /** The film stock in here (see director/Scares.ts): whatever it does not name is at rest. */
  film: RoomFilm = {};
  /** 0..1 white over the picture right now (a flash gun, lightning: one hit, never a strobe). */
  white = 0;
  /** 0..1 black over the picture right now (eyelids, a blackout). */
  black = 0;

  protected readonly kit: DreamKit;
  protected readonly sound: RoomSound;
  protected readonly build: RoomKit;
  protected readonly origin: Vector3;
  protected readonly album: Album;
  /** Which visit to this room's file this is (1 unless its id says `room@n`). */
  protected readonly visit: number;
  readonly id: string;
  /** Seconds it lasts when nobody touches anything. */
  readonly seconds: number;
  private readonly ctx: RoomContext;
  private readonly beats: { t: number; fire: () => void }[] = [];
  private nextBeat = 0;
  private readonly scratch = new Vector3();
  private readonly ownLights: DreamLight[] = [];
  private tracks: Record<(typeof CHANNELS)[number], GlideTrack> | null = null;
  private warpTracks: GlideTrack[] | null = null;

  constructor(ctx: RoomContext) {
    this.ctx = ctx;
    this.kit = ctx.kit;
    this.sound = ctx.sound;
    this.origin = ctx.origin;
    this.album = ctx.album;
    this.visit = ctx.visit;
    this.id = ctx.id;
    this.seconds = ctx.seconds;
    this.build = new RoomKit(ctx.kit);
    this.root.position.copy(ctx.origin);
    this.root.add(this.lens);
  }

  /** The director, before every render: the lens goes where the eye is. */
  followEye(camera: PerspectiveCamera): void {
    this.lens.position.copy(camera.position).sub(this.origin);
    this.lens.quaternion.copy(camera.quaternion);
  }

  /** Called every frame while it runs (after the beats it has reached have fired). */
  abstract update(frame: RoomFrame): void;

  /** Something that happens once, when time first reaches second `at` of the room: register them in the constructor. */
  protected beat(at: number, fire: () => void): void {
    this.beats.push({ t: at / this.seconds, fire });
    this.beats.sort((a, b) => a.t - b.t);
  }

  /** The director: fire what time has reached. */
  advance(t: number): void {
    while (this.nextBeat < this.beats.length && this.beats[this.nextBeat].t <= t) this.beats[this.nextBeat++].fire();
  }

  /** The voice of the dream says a line, for this long. Few words, each on its own. */
  protected say(text: Text, seconds = 5): void {
    this.ctx.say(text, seconds);
  }

  /** A small prompt at the foot of the picture (null takes it away). It only ever tells what the viewer can do. */
  protected hint(text: Text | null): void {
    this.ctx.hint(text);
  }

  /** The shutter: a click, a flash, and the picture as it is now goes into the album. Once a room, at its worst moment. */
  protected shutter(): void {
    this.ctx.shutter();
  }

  /** Whether a point of the room's frame lies outside the view (`margin` deg widens the view). */
  protected unseen(frame: DreamFrame, x: number, y: number, z: number, margin = 5): boolean {
    return frame.unseen(this.world(x, y, z, this.scratch), margin);
  }

  /** A point of the room's frame in the world. */
  protected world(x: number, y: number, z: number, out = new Vector3()): Vector3 {
    return out.set(x, y, z).add(this.origin);
  }

  /** A point light of the room (position in its frame; write `.intensity` to flicker). */
  protected light(at: V3, color: number, intensity: number, reach: number): DreamLight {
    const l = this.kit.lights.add(this.world(at[0], at[1], at[2]), color, intensity, reach);
    this.ownLights.push(l);
    return l;
  }

  /** A spotlight spec (positions in the room's frame; it is read every render, so `intensity` may be written). */
  protected spot(at: V3, target: V3, color: number, intensity: number, angle: number, penumbra = 0.6): SpotSpec {
    const o = this.origin;
    return {
      position: [at[0] + o.x, at[1] + o.y, at[2] + o.z],
      target: [target[0] + o.x, target[1] + o.y, target[2] + o.z],
      color,
      intensity,
      angle,
      penumbra,
    };
  }

  /** Where the eye is at `t`. */
  pose(t: number, out: RoomPose): RoomPose {
    if (!this.tracks) {
      const at = this.keys.map((k) => k.t);
      const channel = (pick: (k: RoomKey) => number) => new GlideTrack(at, this.keys.map(pick));
      this.tracks = {
        x: channel((k) => k.at[0]),
        y: channel((k) => k.at[1]),
        z: channel((k) => k.at[2]),
        yaw: channel((k) => k.yaw * DEG),
        pitch: channel((k) => k.pitch * DEG),
        roll: channel((k) => (k.roll ?? 0) * DEG),
        fov: channel((k) => k.fov),
      };
    }
    const c = this.tracks;
    out.position.set(c.x.at(t), c.y.at(t), c.z.at(t)).add(this.origin);
    out.yaw = c.yaw.at(t);
    out.pitch = c.pitch.at(t);
    out.roll = c.roll.at(t);
    out.fov = c.fov.at(t);
    return out;
  }

  /** Before every render of the dream, for what depends on the camera of that render. */
  prepare?(camera: PerspectiveCamera): void;

  /** Curved space at `t`, written into `amount` (bendUp, bendAside, twist, wave). */
  warpAt(t: number, amount: { x: number; y: number; z: number; w: number }): void {
    if (!this.warp) {
      amount.x = amount.y = amount.z = amount.w = 0;
      return;
    }
    if (!this.warpTracks) {
      const at = this.warp.map((k) => k.at);
      this.warpTracks = [
        new GlideTrack(at, this.warp.map((k) => k.bendUp)),
        new GlideTrack(at, this.warp.map((k) => k.bendAside)),
        new GlideTrack(at, this.warp.map((k) => k.twist)),
        new GlideTrack(at, this.warp.map((k) => k.wave)),
      ];
    }
    const c = this.warpTracks;
    amount.x = c[0].at(t);
    amount.y = c[1].at(t);
    amount.z = c[2].at(t);
    amount.w = c[3].at(t);
  }

  /** Once its shaders are built: pictures it shows, taken with `renderDream`. */
  develop?(renderDream: (target: WebGLRenderTarget, camera: PerspectiveCamera) => void): void;

  /** Its lights leave the pool. Everything else it owns goes with the root (see JourneyDirector). */
  dispose(): void {
    for (const l of this.ownLights) this.kit.lights.remove(l);
    this.ownLights.length = 0;
    this.sound.stopAll(0.4);
    this.ctx.hint(null);
  }
}
