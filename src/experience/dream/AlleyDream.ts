import {
  Group,
  Vector3,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type PerspectiveCamera,
  type Texture,
  type TubeGeometry,
  type WebGLRenderTarget,
} from 'three';
import { dreamConfig } from '../../config/dream.config';
import { REDUCED_MOTION } from '../../config/experience.config';
import { LAYOUT, type SpotSpec } from '../../config/nightmare.config';
import { lightingConfig } from '../../config/scene.config';
import { DEG, range, smootherstep } from '../math';
import type { DreamKit } from './DreamKit';
import type { DreamFrame, DreamModule } from './DreamModule';
import { randomFrom, type Crowd, type FigureSpec } from './FigureKit';
import { Blinks, Flicker } from './Flicker';
import { frozenRain, thickHair, type Strands } from './FrozenRain';
import type { DreamLight } from './LightPool';
import { PhotoLines } from './PhotoLines';
import { Ravens, type Perch } from './Ravens';

type V3 = readonly [number, number, number];

/** Which of the moments the piece keeps is the viewer's own face: the print on the lines that nobody has scratched. */
const YOU = 0;
const SEED = 0x7a11e3;

/** The alley loses its light for an instant at these points of the walk (hold in s). */
const BLINKS = [
  { at: 0.058, hold: 0.16 },
  { at: 0.118, hold: 0.2 },
];

/** Over this stretch of the walk the rain becomes hair. */
const GROW = dreamConfig.rain.hair.grow;
/** Nothing here can be seen from past the end wall. */
const SEEN_UNTIL = LAYOUT.hall.from - 2.5;

/** The three who are not in the real alley: only in the picture. */
const WATCHERS: readonly { spec: FigureSpec; slot: number }[] = [
  { spec: { avatar: 'figure_woman', clip: 'f_idle_touch_hair_01', time: 1.7, veil: true }, slot: 3 },
  { spec: { avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 5 }, slot: 4 },
  { spec: { avatar: 'figure_nurse', clip: 'f_listen_door', time: 1.5 }, slot: 1 },
];
const SIDE = 1.42;
/**
 * Where they may stand, from far to near (x, z): along the walls, clear of what stands there (the chair, the crates,
 * the bags, the payphone), never within 1.2 m of the way.
 */
const SLOTS: readonly (readonly [number, number])[] = [
  [-SIDE, -33.2],
  [SIDE, -32.4],
  [SIDE, -30.1],
  [-SIDE, -29.3],
  [SIDE, -27.7],
  [-SIDE, -25.5],
  [SIDE, -25.1],
  [-SIDE, -23.7],
  [SIDE, -23.2],
  [-SIDE, -20.7],
  [SIDE, -18.9],
  [-SIDE, -18],
  [-SIDE, -16.2],
  [SIDE, -15.1],
  [SIDE, -13.2],
  [-SIDE, -10.4],
  [SIDE, -7.4],
];
const WATCHER = {
  /** Each time they come at least this much closer (m), and stop this far ahead of the viewer (m). */
  step: 2.2,
  keepAhead: 3.5,
  /** Height of the point that decides whether one of them is seen (m). */
  look: 1.3,
};

/** The chair: where it stands, which way it faces (deg, 0 = toward +Z), the rockers' radius and where they touch the ground (m, measured on the model). */
const CHAIR = {
  at: [1.3, 0, -21] as V3,
  heading: -16,
  radius: 0.95,
  contact: 0.1375,
  /** Rock: angle (deg), period (s), and where it stands in the photograph (rad). */
  amplitude: 9,
  period: 2.6,
  still: 0.9,
  /** Looked at this directly (deg inside the view), from this near (m), for this long (s), and it stops dead. */
  lookMargin: -22,
  lookFrom: 10,
  lookSeconds: 2.2,
  height: 0.5,
};

/** The payphone on the wall (center) and the small bad lamp over it. */
const PAYPHONE = {
  at: [-1.75, 1.2, -27] as V3,
  socket: [-1.72, 2.12, -27] as V3,
  bulb: [-1.72, 1.97, -27] as V3,
  light: { at: [-1.5, 1.9, -27] as V3, color: 0xffcfa0, intensity: 3.2, distance: 5 },
  glow: 5,
  flicker: { every: [1.6, 6] as const, seed: 71 },
};

/** The far lamp over the door: it reaches the capture, so the three stand in the light of the photograph. */
const FAR_LAMP = { at: [-1.5, 2.85, -28.5] as V3, color: 0xffb985, intensity: 5, distance: 12 };

/** The alley's lamps go out behind you (z: starting, out), leaving the pool to the street's. */
const LAMPS_DIE = [-33, -38] as const;
/** The lantern behind the photographer and the light at the far end of the alley die as you come to the end (z), so nothing pops where the street takes over. */
const LANTERN_DIES = [-27, -35.5] as const;
const CROSS_LIGHT_DIES = [-24, -34] as const;

/** Birds on each of the alley's cables, how far from each wall they keep (share of the cable), and how they differ in size. */
const RAVENS = { perCable: 4, clear: 0.14, size: [0.85, 1.15] as const, sitsOn: 0.011 };

interface Watcher {
  crowd: Crowd;
  slot: number;
  /** Where it stands in the photograph (a place in SLOTS). */
  home: number;
  x: number;
  z: number;
  /** It has been seen since it last moved. */
  seen: boolean;
  /** The point that decides whether it is seen. */
  at: Vector3;
}

/**
 * Chapters I and II, the alley of the dream. The rain that the shutter stopped lengthens into white hair; three
 * people who are not there come closer each time they are not seen; then washing lines of scratched faces, a chair
 * rocking by itself, a telephone under a bad lamp, and the black birds on the wires.
 */
export class AlleyDream implements DreamModule {
  readonly root = new Group();
  readonly span = [40, -36] as const;
  readonly region = 'alley' as const;
  readonly spots: SpotSpec[];

  /** All of it: it costs a lot, and past the end wall no one can see it. */
  private readonly built = new Group();
  private readonly hair: readonly Strands[];
  private readonly lines: PhotoLines;
  private readonly watchers: Watcher[];
  private readonly ravens: Ravens;
  private readonly blinks = new Blinks(BLINKS);
  private readonly chair: Object3D;
  private readonly chairAt = new Vector3(CHAIR.at[0], CHAIR.height, CHAIR.at[2]);
  private chairPhase = CHAIR.still;
  private chairStopped = false;
  private chairLooked = 0;
  private readonly lampFlicker = new Flicker(PAYPHONE.flicker.seed, PAYPHONE.flicker.every);
  private readonly phoneLight: DreamLight;
  private readonly farLight: DreamLight;
  private readonly bulbGlass: MeshStandardMaterial | null;

  constructor(kit: DreamKit, moments: readonly Texture[]) {
    this.root.name = 'AlleyDream';
    this.root.add(this.built);
    this.spots = [{ ...lightingConfig.key }, { ...lightingConfig.security }, { ...lightingConfig.crossStreet }];

    this.hair = [frozenRain(kit), thickHair(kit)];
    this.lines = new PhotoLines(kit, moments[YOU]);
    for (const h of this.hair) this.built.add(h.mesh);
    this.built.add(this.lines.root);

    this.watchers = WATCHERS.map((w) => {
      const crowd = kit.figures.crowd(w.spec, 1);
      this.built.add(crowd.root);
      return { crowd, slot: w.slot, home: w.slot, x: 0, z: 0, seen: false, at: new Vector3() };
    });

    this.chair = kit.prop('rocking_chair', CHAIR.at, {}, this.built);
    this.chair.rotation.order = 'YXZ';

    kit.prop('payphone', PAYPHONE.at, { rotation: [0, 90, 0], anchor: 'center' }, this.built);
    kit.prop('pull_chain_socket', PAYPHONE.socket, { anchor: 'top' }, this.built);
    const bulb = kit.prop('lightbulb', PAYPHONE.bulb, { rotation: [180, 0, 0], anchor: 'top' }, this.built);
    this.bulbGlass = this.ownGlass(bulb);
    const p = PAYPHONE.light;
    this.phoneLight = kit.lights.add(p.at, p.color, p.intensity, p.distance);
    const f = FAR_LAMP;
    this.farLight = kit.lights.add(f.at, f.color, f.intensity, f.distance);

    this.ravens = new Ravens(kit, this.perches(kit));
    this.built.add(this.ravens.root);
    this.reset();
  }

  /** This bulb's own glass, so that it can fail by itself. */
  private ownGlass(bulb: Object3D): MeshStandardMaterial | null {
    let glass: MeshStandardMaterial | null = null;
    bulb.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || !/glass/.test((mesh.material as Material).name)) return;
      glass = (mesh.material as MeshStandardMaterial).clone();
      glass.emissive.set(PAYPHONE.light.color);
      glass.emissiveIntensity = PAYPHONE.glow;
      mesh.material = glass;
    });
    return glass;
  }

  /** Rows of birds along the alley's own cables, their backs to the way you come from. */
  private perches(kit: DreamKit): Perch[] {
    const random = randomFrom(SEED);
    const perches: Perch[] = [];
    for (const cable of kit.alley.cables) {
      const tube = cable.pivot.children[0] as Mesh<TubeGeometry>;
      const path = tube.geometry.parameters.path;
      for (let i = 0; i < RAVENS.perCable; i++) {
        const u = RAVENS.clear + (1 - 2 * RAVENS.clear) * ((i + 0.2 + random() * 0.6) / RAVENS.perCable);
        const at = path.getPointAt(u).add(cable.pivot.position);
        perches.push({
          x: at.x,
          y: at.y + RAVENS.sitsOn,
          z: at.z,
          heading: Math.PI / 2 + (random() - 0.5) * 0.6,
          scale: RAVENS.size[0] + random() * (RAVENS.size[1] - RAVENS.size[0]),
        });
      }
    }
    return perches;
  }

  /** Rolling on its rockers, as a real one does, about the center of their curve. */
  private rock(angle: number): void {
    const { radius: r, contact: c, heading } = CHAIR;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const yaw = heading * DEG;
    const along = c + r * angle - r * sin - c * cos;
    this.chair.position.set(CHAIR.at[0] + Math.sin(yaw) * along, CHAIR.at[1] + r - r * cos + c * sin, CHAIR.at[2] + Math.cos(yaw) * along);
    this.chair.rotation.set(angle, yaw, 0);
  }

  /** One of the three stands in a place, turned to where the viewer is. */
  private stand(w: Watcher, slot: number, eye: Vector3): void {
    const [x, z] = SLOTS[slot];
    w.slot = slot;
    w.x = x;
    w.z = z;
    this.face(w, eye);
    w.at.set(x, WATCHER.look, z);
  }

  private face(w: Watcher, eye: Vector3): void {
    w.crowd.set(0, w.x, 0, w.z, Math.atan2(eye.x - w.x, eye.z - w.z));
    w.crowd.commit();
  }

  /** The next free place nearer to the viewer, a few meters on; when the viewer has passed, it stays. */
  private comeCloser(w: Watcher, eye: Vector3): void {
    this.face(w, eye);
    if (eye.z < w.z) return;
    for (let s = w.slot + 1; s < SLOTS.length; s++) {
      const z = SLOTS[s][1];
      if (z - w.z < WATCHER.step) continue;
      if (eye.z - z < WATCHER.keepAhead) return;
      if (this.watchers.some((o) => o !== w && o.slot === s)) continue;
      this.stand(w, s, eye);
      return;
    }
  }

  update(frame: DreamFrame): void {
    if (frame.paused) return;
    const { eye, walk, dt } = frame;
    const seen = eye.z > SEEN_UNTIL;
    this.built.visible = seen;
    if (!seen) return;

    const b = this.blinks;
    b.update(walk, dt);
    const morph = range(GROW[0], GROW[1], walk);
    for (const h of this.hair) {
      h.morph = morph;
      h.dim = b.level;
      h.advance(dt);
      if (!REDUCED_MOTION) h.forget(eye.z);
    }
    this.lines.update(frame);

    // light
    this.spots[0].intensity = lightingConfig.key.intensity * b.level * (1 - smootherstep(range(LANTERN_DIES[0], LANTERN_DIES[1], eye.z)));
    this.spots[1].intensity = lightingConfig.security.intensity * b.level;
    this.spots[2].intensity = lightingConfig.crossStreet.intensity * b.level * (1 - smootherstep(range(CROSS_LIGHT_DIES[0], CROSS_LIGHT_DIES[1], eye.z)));

    this.lampFlicker.update(dt);
    const lamp = this.lampFlicker.level;
    const going = 1 - range(LAMPS_DIE[0], LAMPS_DIE[1], eye.z);
    this.phoneLight.intensity = PAYPHONE.light.intensity * lamp * b.level * going;
    if (this.bulbGlass) this.bulbGlass.emissiveIntensity = PAYPHONE.glow * lamp * b.level;
    this.farLight.intensity = FAR_LAMP.intensity * b.level * going;

    // what happens when it is not seen
    for (const w of this.watchers) {
      if (b.fell) {
        this.comeCloser(w, eye);
        w.seen = false;
      } else if (frame.unseen(w.at)) {
        if (w.seen) this.comeCloser(w, eye);
        w.seen = false;
      } else {
        w.seen = true;
      }
    }
    this.ravens.update(frame, b.dark);

    this.updateChair(frame);
  }

  /** It rocks by itself; looked at for a while it stops dead, wherever it was, and starts again when it is not seen. */
  private updateChair(frame: DreamFrame): void {
    if (frame.unseen(this.chairAt)) {
      this.chairStopped = false;
      this.chairLooked = 0;
    } else if (!this.chairStopped && !frame.unseen(this.chairAt, CHAIR.lookMargin) && frame.eye.distanceTo(this.chairAt) < CHAIR.lookFrom) {
      this.chairLooked += frame.dt;
      this.chairStopped = this.chairLooked >= CHAIR.lookSeconds;
    }
    if (this.chairStopped) return;
    this.chairPhase += (frame.dt * Math.PI * 2) / CHAIR.period;
    this.rock(Math.sin(this.chairPhase) * CHAIR.amplitude * DEG * (REDUCED_MOTION ? 0.5 : 1));
  }

  reset(): void {
    for (const h of this.hair) {
      h.morph = 0;
      h.dim = 1;
      h.remember();
    }
    this.built.visible = true;
    this.lines.reset();
    this.blinks.reset();
    this.spots[0].intensity = lightingConfig.key.intensity;
    this.spots[1].intensity = lightingConfig.security.intensity;
    this.spots[2].intensity = lightingConfig.crossStreet.intensity;
    this.phoneLight.intensity = PAYPHONE.light.intensity;
    this.farLight.intensity = FAR_LAMP.intensity;
    const lens = new Vector3(0, 0, 0);
    for (const w of this.watchers) {
      this.stand(w, w.home, lens);
      w.seen = false;
    }
    this.ravens.reset();
    this.chairPhase = CHAIR.still;
    this.chairStopped = false;
    this.chairLooked = 0;
    this.rock(Math.sin(this.chairPhase) * CHAIR.amplitude * DEG);
  }

  develop(renderDream: (target: WebGLRenderTarget, camera: PerspectiveCamera) => void): void {
    this.lines.develop(renderDream);
  }
}
