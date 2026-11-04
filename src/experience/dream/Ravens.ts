import { Matrix4, MeshStandardMaterial, Quaternion, Vector3, type Group } from 'three';
import type { DreamKit, PropCrowd } from './DreamKit';
import type { DreamFrame } from './DreamModule';

/** Height of a raven (m; the scan is a meter tall). */
const SCALE = 0.3;
/** Black, and a little wet. */
const FEATHERS = new MeshStandardMaterial({ color: 0x050506, roughness: 0.42, metalness: 0.1 });
/** A bird that would have to turn by less than this stays as it is (rad): the viewer walks on all the time. */
const TURN_FROM = 0.35;

const UP = new Vector3(0, 1, 0);
const place = new Vector3();
const size = new Vector3();
const turn = new Quaternion();
const matrix = new Matrix4();

/** Where a bird sits, and which way it looks at first (rad; 0 = +X, the way the scan looks). */
export interface Perch {
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Times the usual size. */
  scale: number;
}

/**
 * Rows of black birds on the wires and sills, instanced. No one has seen them move: whenever they are not
 * looked at they have turned to look at the viewer.
 */
export class Ravens {
  private readonly crowd: PropCrowd;
  private readonly at: Vector3[];
  private readonly heading: Float32Array;

  constructor(kit: DreamKit, private readonly perches: readonly Perch[]) {
    this.crowd = kit.props('raven', perches.length, { scale: SCALE });
    kit.paint(this.crowd.root, FEATHERS);
    this.at = perches.map((p) => new Vector3(p.x, p.y + SCALE * p.scale * 0.5, p.z));
    this.heading = new Float32Array(perches.length);
    this.reset();
  }

  get root(): Group {
    return this.crowd.root;
  }

  private write(i: number, heading: number): void {
    const p = this.perches[i];
    this.heading[i] = heading;
    matrix.compose(place.set(p.x, p.y, p.z), turn.setFromAxisAngle(UP, heading), size.setScalar(p.scale));
    this.crowd.setMatrix(i, matrix);
  }

  /** @param dark the place is dark: whatever they do now cannot be seen, wherever the viewer looks */
  update(frame: DreamFrame, dark: boolean): void {
    let moved = false;
    for (let i = 0; i < this.perches.length; i++) {
      const at = this.at[i];
      if (!dark && !frame.unseen(at)) continue;
      const toward = Math.atan2(at.z - frame.eye.z, frame.eye.x - at.x);
      if (Math.abs(Math.atan2(Math.sin(toward - this.heading[i]), Math.cos(toward - this.heading[i]))) < TURN_FROM) continue;
      this.write(i, toward);
      moved = true;
    }
    if (moved) this.crowd.commit();
  }

  /** Back to the instant of capture. */
  reset(): void {
    for (let i = 0; i < this.perches.length; i++) this.write(i, this.perches[i].heading);
    this.crowd.commit();
  }
}
