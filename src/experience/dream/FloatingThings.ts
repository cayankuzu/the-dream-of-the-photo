import { Box3, Group, Object3D, Vector3 } from 'three';
import { REDUCED_MOTION } from '../../config/experience.config';
import { dreamConfig, type FloatingThing } from '../../config/dream.config';
import { DEG, lerp } from '../math';
import type { Alley } from '../world/Alley';
import { rigClock, setClock, type ClockHand } from './ClockRig';

const F = dreamConfig.floating;
const ORIGIN = [0, 0, 0] as const;
const TAU = Math.PI * 2;

const box = new Box3();
const size = new Vector3();

/** One thing adrift: it bobs around its rest height and turns about its own axis. */
interface Drift {
  pivot: Object3D;
  /** Height (m) the bob swings around, chosen so the configured height is where it is at time 0. */
  center: number;
  axis: Vector3;
  /** Turning rate (rad / s). */
  spin: number;
  /** Bob angular frequency (rad / s) and phase (rad). */
  omega: number;
  phase: number;
}

/** mulberry32: a tiny seeded generator, so the things drift the same way on every visit and in every render. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Things that have forgotten gravity, between the giant chair and the giant print; the chair itself,
 * as large as a child remembers it, standing over the alley; and over the print a clock the size of a
 * window whose hands run backwards.
 */
export class FloatingThings {
  readonly root = new Group();

  private readonly drifts: Drift[] = [];
  private readonly hands: ClockHand[];
  /** Fewer turns of the hands for visitors who ask for less motion: backwards still, at the pace of real time. */
  private readonly clockRate = REDUCED_MOTION ? Math.sign(F.giantClock.rate) : F.giantClock.rate;

  constructor(private readonly alley: Alley) {
    this.root.name = 'FloatingThings';
    this.buildThings();
    this.buildChair();
    // (the clock's glass is already reflection-only: see reflectionOnlyGlass in props.ts)
    this.hands = this.buildClock();
  }

  /** Each thing in a pivot at its center, so it bobs and turns about itself, never about a corner. */
  private buildThings(): void {
    const things: readonly FloatingThing[] = F.things;
    things.forEach((t, i) => {
      const rnd = seeded(i + 1);
      const pivot = new Object3D();
      pivot.position.set(...t.at);
      const thing = this.alley.prop(t.key, ORIGIN, t.rotation, { anchor: 'center', scale: t.scale, nodes: t.nodes, castShadow: false }, pivot);
      // the prop carries its model key as name, which would shadow a clock's dial node of the same name
      thing.name = `Floating ${t.key}`;
      // a floating clock still shows the instant the alley's clock stopped at
      const hands = rigClock(thing);
      if (hands.length) setClock(hands, dreamConfig.clock.stoppedAt);
      this.root.add(pivot);

      // a uniformly random axis on the sphere
      const y = rnd() * 2 - 1;
      const a = rnd() * TAU;
      const r = Math.sqrt(1 - y * y);
      const phase = rnd() * TAU;
      this.drifts.push({
        pivot,
        center: t.at[1] - F.bob * Math.sin(phase),
        axis: new Vector3(r * Math.cos(a), y, r * Math.sin(a)),
        spin: lerp(F.spin[0], F.spin[1], rnd()) * DEG,
        omega: TAU / lerp(F.period[0], F.period[1], rnd()),
        phase,
      });
    });
  }

  /** The monobloc chair, standing in the alley at a size where you walk beneath its seat. */
  private buildChair(): void {
    const c = F.giantChair;
    // measured unturned, so the heading never changes how large it is
    const probe = this.alley.prop('monobloc_chair', ORIGIN, ORIGIN, {}, new Object3D());
    box.setFromObject(probe).getSize(size);
    const scale = c.width / Math.max(size.x, size.z);
    const chair = this.alley.prop('monobloc_chair', c.at, [0, c.heading, 0], { scale, castShadow: false }, this.root);
    chair.name = 'GiantChair';
  }

  /** The wall clock on the end wall, its dial `diameter` across. The model's dial faces +Z, as the viewer needs. */
  private buildClock(): ClockHand[] {
    const k = F.giantClock;
    const clock = this.alley.prop('wall_clock', ORIGIN, ORIGIN, { anchor: 'center', castShadow: false }, this.root);
    // renamed before rigging: the dial is found by its node name, which the prop also carries
    clock.name = 'GiantClock';
    box.setFromObject(clock).getSize(size);
    // scaled around the bounds' center, which `anchor: 'center'` put at the pivot
    clock.scale.setScalar(k.diameter / Math.max(size.x, size.y));
    clock.position.set(...k.at);
    return rigClock(clock);
  }

  /** @param time the piece's clock (s) */
  update(time: number): void {
    setClock(this.hands, dreamConfig.clock.stoppedAt + time * this.clockRate);
    if (REDUCED_MOTION) return;
    for (const d of this.drifts) {
      d.pivot.position.y = d.center + F.bob * Math.sin(d.omega * time + d.phase);
      d.pivot.quaternion.setFromAxisAngle(d.axis, d.spin * time);
    }
  }
}
