import type { Group, PerspectiveCamera, SpotLight, Vector3, WebGLRenderTarget } from 'three';
import type { RegionName, SpotSpec } from '../../config/nightmare.config';

/** What every set piece of the nightmare is told once per frame. */
export interface DreamFrame {
  /** The piece's clock (s; it runs on during pause, so nothing should react to it while `paused`). */
  time: number;
  dt: number;
  paused: boolean;
  /** The viewer's eye in the walk frame (see walk.config.ts), whichever world they are drawn in. */
  eye: Vector3;
  /** The camera the viewer sees through this frame (world space). */
  view: PerspectiveCamera;
  /** 0..1 progress of the walk (WORLD phase). */
  walk: number;
  /** 0..1 how afraid the piece is right now (rises along the walk, spikes on scares). */
  fear: number;
  /** 0..1 the heartbeat: 1 on the beat, decaying to 0 (the walls of meat breathe with it). */
  heartbeat: number;
  /** True when a world point lies outside the view (margin in degrees widens the view). */
  unseen: (point: Vector3, margin?: number) => boolean;
}

/** A set piece: a group the director adds to the dream, and its per-frame life. */
export interface DreamModule {
  readonly root: Group;
  /** Near and far walk-frame z of what it draws: it is drawn (and told frames) around this span only. */
  readonly span: readonly [number, number];
  /** Drawn in the sea (at seaConfig.offset), not in the walk's own world. */
  readonly inSea?: boolean;
  /** The space it owns: its `spots` then light that space. */
  readonly region?: RegionName;
  /**
   * The three spotlights while the camera is in its region: the first casts the shadows (rendered once
   * on entering the region). `intensity` is read at every render, so writing it flickers the light.
   */
  readonly spots?: readonly (SpotSpec | null)[];
  update(frame: DreamFrame): void;
  /** Before every render of the dream, for what depends on the camera of that render. */
  prepare?(camera: PerspectiveCamera): void;
  /** Once, after shaders compile: render whatever the module shows as pictures. */
  develop?(renderDream: (target: WebGLRenderTarget, camera: PerspectiveCamera) => void): void;
  /** Back to the instant of capture (the piece was restarted, or scrolled all the way back). */
  reset?(): void;
}

export type { SpotLight };
