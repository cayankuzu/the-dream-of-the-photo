import { MathUtils, Object3D, Quaternion, Vector3 } from 'three';

const s = new Vector3();
const e = new Vector3();
const w = new Vector3();
const d = new Vector3();
const p = new Vector3();
const desiredElbow = new Vector3();
const from = new Vector3();
const to = new Vector3();
const q = new Quaternion();
const parentQ = new Quaternion();
const worldQ = new Quaternion();
const animated = new Quaternion();

/** Rotate `bone` in world space by `delta`, keeping the result expressed in its parent's frame. */
function rotateWorld(bone: Object3D, delta: Quaternion): void {
  bone.getWorldQuaternion(worldQ);
  worldQ.premultiply(delta);
  bone.parent!.getWorldQuaternion(parentQ);
  bone.quaternion.copy(parentQ.invert().multiply(worldQ));
  bone.updateMatrixWorld(true);
}

/** Set a bone's world orientation (expressed back in its parent's frame). */
export function setWorldQuaternion(bone: Object3D, target: Quaternion): void {
  bone.parent!.getWorldQuaternion(parentQ);
  bone.quaternion.copy(parentQ.invert().multiply(target));
  bone.updateMatrixWorld(true);
}

/**
 * Analytic two-bone IK (upper arm -> forearm -> hand) applied on top of the animated pose,
 * blended by weight so mocap and procedural intent mix without popping.
 */
export class TwoBoneIK {
  constructor(
    private readonly upper: Object3D,
    private readonly lower: Object3D,
    private readonly end: Object3D,
  ) {}

  solve(target: Vector3, pole: Vector3, weight: number): void {
    if (weight <= 0) return;
    const upperAnimated = this.upper.quaternion.clone();
    const lowerAnimated = this.lower.quaternion.clone();

    this.upper.getWorldPosition(s);
    this.lower.getWorldPosition(e);
    this.end.getWorldPosition(w);
    const a = s.distanceTo(e);
    const b = e.distanceTo(w);
    const c = MathUtils.clamp(s.distanceTo(target), Math.abs(a - b) + 1e-4, a + b - 1e-4);

    d.subVectors(target, s).normalize();
    p.subVectors(pole, s);
    p.addScaledVector(d, -p.dot(d)).normalize();
    const cosA = MathUtils.clamp((a * a + c * c - b * b) / (2 * a * c), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    desiredElbow.copy(s).addScaledVector(d, a * cosA).addScaledVector(p, a * sinA);

    // swing the upper arm so the elbow lands where it should
    from.subVectors(e, s).normalize();
    to.subVectors(desiredElbow, s).normalize();
    rotateWorld(this.upper, q.setFromUnitVectors(from, to));

    // then the forearm so the wrist reaches the target
    this.lower.getWorldPosition(e);
    this.end.getWorldPosition(w);
    from.subVectors(w, e).normalize();
    to.copy(d).multiplyScalar(c).add(s).sub(e).normalize();
    rotateWorld(this.lower, q.setFromUnitVectors(from, to));

    if (weight < 1) {
      this.upper.quaternion.copy(animated.copy(upperAnimated).slerp(this.upper.quaternion, weight));
      this.lower.quaternion.copy(animated.copy(lowerAnimated).slerp(this.lower.quaternion, weight));
      this.upper.updateMatrixWorld(true);
    }
  }
}
