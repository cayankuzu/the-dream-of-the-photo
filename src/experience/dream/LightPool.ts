import { Color, Group, PointLight, Vector3 } from 'three';
import { lightPoolConfig } from '../../config/nightmare.config';

/** A light is considered from this many times its reach (plus some meters) away. */
const REACH = 2.5;
const REACH_EXTRA = 6;

/**
 * Something in the dream that shines. Mutable: a set piece flickers its lights by writing `intensity`
 * in its update (positions are absolute world positions).
 */
export interface DreamLight {
  position: Vector3;
  color: Color;
  intensity: number;
  /** Reach (m): it is 0 from here on, so nothing pops when the pool picks it up. */
  distance: number;
}

/**
 * A fixed number of point lights, given to whichever lights of the dream are nearest to the camera
 * of each render. The number never changes, so no shader ever recompiles on the way; many lamps
 * can line the walk at the cost of six.
 */
export class LightPool {
  readonly root = new Group();
  /** Everything darkens together (0 = blackout). */
  dim = 1;

  private readonly pool: PointLight[] = [];
  private readonly lights: DreamLight[] = [];
  private readonly score = new Map<DreamLight, number>();

  constructor() {
    this.root.name = 'LightPool';
    for (let i = 0; i < lightPoolConfig.size; i++) {
      const l = new PointLight(0xffffff, 0, 1, 2);
      this.pool.push(l);
      this.root.add(l);
    }
  }

  /** Add a light of the dream. */
  add(position: Vector3 | readonly [number, number, number], color: number, intensity: number, distance: number): DreamLight {
    const p = position instanceof Vector3 ? position.clone() : new Vector3(...position);
    const light = { position: p, color: new Color(color), intensity, distance };
    this.lights.push(light);
    return light;
  }

  /** Give the pool to the lights that matter most from here. */
  assign(eye: Vector3): void {
    const near: DreamLight[] = [];
    for (const l of this.lights) {
      if (l.intensity <= 0) continue;
      const d = l.position.distanceTo(eye);
      // it reaches a little past where the eye stands, onto what the eye sees
      if (d > l.distance * REACH + REACH_EXTRA) continue;
      this.score.set(l, l.intensity / (1 + d * d));
      near.push(l);
    }
    near.sort((a, b) => this.score.get(b)! - this.score.get(a)!);
    this.pool.forEach((p, i) => {
      const l = near[i];
      if (!l) {
        p.intensity = 0;
        return;
      }
      p.position.copy(l.position);
      p.color.copy(l.color);
      p.intensity = l.intensity * this.dim;
      p.distance = l.distance;
    });
  }
}
