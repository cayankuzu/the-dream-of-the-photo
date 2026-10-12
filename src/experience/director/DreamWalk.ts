import { Vector3 } from 'three';
import { REDUCED_MOTION } from '../../config/experience.config';
import { walkConfig } from '../../config/walk.config';
import { DEG, range } from '../math';
import { GlideTrack } from '../timeline/Track';

const keys = walkConfig.keys;
/** The float fades in over this much of the walk, so the first step leaves the entry pose exactly. */
const FLOAT_IN = 0.04;

/**
 * Where the viewer is inside the dream, as a pure function of the walk (WORLD progress) and time:
 * scrolling forward walks, scrolling back walks back the same way. Walk-frame pose (see walk.config.ts).
 */
export class DreamWalk {
  readonly position = new Vector3();
  /** Heading (rad, positive turns left), pitch (rad, positive looks up), roll (rad) and vertical fov (deg). */
  yaw = 0;
  pitch = 0;
  roll = 0;
  fov: number = keys[0].fov;

  private tracks: GlideTrack[] = [];

  constructor() {
    this.setStart(new Vector3(...keys[0].position), keys[0].yaw * DEG);
  }

  /** The walk begins wherever the passage through the photograph left the viewer (yaw in rad). */
  setStart(position: Vector3, yaw: number): void {
    const at = keys.map((k) => k.at);
    const channel = (pick: (k: (typeof keys)[number]) => number, first: number) =>
      new GlideTrack(at, keys.map((k, i) => (i === 0 ? first : pick(k))));
    this.tracks = [
      channel((k) => k.position[0], position.x),
      channel((k) => k.position[1], position.y),
      channel((k) => k.position[2], position.z),
      channel((k) => k.yaw * DEG, yaw),
      channel((k) => k.pitch * DEG, keys[0].pitch * DEG),
      channel((k) => k.fov, keys[0].fov),
    ];
  }

  update(walk: number, time: number): void {
    const t = this.tracks;
    const f = walkConfig.float;
    const float = REDUCED_MOTION ? 0 : range(0, FLOAT_IN, walk);
    const phase = (time / f.period) * Math.PI * 2;
    this.position.set(t[0].at(walk), t[1].at(walk) + Math.sin(phase) * f.amount * float, t[2].at(walk));
    this.yaw = t[3].at(walk);
    this.pitch = t[4].at(walk);
    this.roll = Math.sin(phase * 0.7 + 1) * f.roll * DEG * float;
    this.fov = t[5].at(walk);
  }
}
