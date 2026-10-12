import { Euler, MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { directorConfig, REDUCED_MOTION, renderConfig, shotsConfig, transitionConfig } from '../../config/experience.config';
import { walkConfig } from '../../config/walk.config';
import type { Photographer } from '../character/Photographer';
import { range, smootherstep, wobble } from '../math';
import type { Photograph } from '../photograph/Photograph';
import { PhotoPortal } from '../transition/PhotoPortal';
import { cueToProgress, phaseProgress } from '../timeline/Timeline';

export interface ShotState {
  focus: number;
  aperture: number;
  /** Distance of the viewer camera from the print along its axis (Infinity before the lock). */
  photoDistance: number;
}

const shots = shotsConfig.map((s) => ({ ...s, p: cueToProgress(s.at) }));
const v1 = new Vector3();
const v2 = new Vector3();
const v3 = new Vector3();
const q1 = new Quaternion();
const m1 = new Matrix4();
const m2 = new Matrix4();
const m3 = new Matrix4();
const up = new Vector3(0, 1, 0);

/**
 * Where the viewer's camera is, what it looks at and where the lens focuses — before the picture.
 * Shots are deliberate beats; between them the camera glides. From PHOTO_APPROACH on, the camera
 * is expressed in the photograph's own frame, so the hand's tremor moves the world, not the print.
 */
export class CameraDirector {
  private recoil = 0;

  constructor(
    private readonly photographer: Photographer,
    private readonly print: Photograph,
    private readonly portal: PhotoPortal,
  ) {}

  kick(): void {
    this.recoil = 1;
  }

  private resolve(target: (typeof shots)[number]['target'], out: Vector3): Vector3 {
    if (target === 'camera') return this.photographer.camera.getWorldPosition(out).add(v3.set(0, directorConfig.cameraTargetLift, 0));
    if (target === 'print') return out.copy(this.photographer.printPosition);
    return out.set(...target);
  }

  /** Free shot (world space) for progress p. */
  private shot(p: number, cam: PerspectiveCamera): { focus: number; aperture: number } {
    let i = 0;
    while (i < shots.length - 2 && p > shots[i + 1].p) i++;
    const a = shots[i];
    const b = shots[Math.min(i + 1, shots.length - 1)];
    const t = smootherstep(b.p > a.p ? (p - a.p) / (b.p - a.p) : 1);
    cam.position.set(...a.position).lerp(v1.set(...b.position), t);
    const ta = this.resolve(a.target, new Vector3());
    const tb = this.resolve(b.target, new Vector3());
    const target = ta.lerp(tb, t);
    cam.up.copy(up);
    cam.lookAt(target);
    cam.fov = MathUtils.lerp(a.fov, b.fov, t);
    const dist = cam.position.distanceTo(target);
    const fa = a.focus === 'target' ? dist : a.focus;
    const fb = b.focus === 'target' ? dist : b.focus;
    // focus pulls happen in diopters, like a real lens
    const focus = 1 / MathUtils.lerp(1 / fa, 1 / fb, t);
    return { focus, aperture: MathUtils.lerp(a.aperture, b.aperture, t) };
  }

  /**
   * Awake again, after the last photograph (`e` = EXPLORATION progress): over the photographer's
   * shoulder onto the print in their hand, then slowly drawing away. The print stays in focus.
   */
  poseEnding(cam: PerspectiveCamera, e: number, time: number, aspect: number): ShotState {
    const [a, b] = walkConfig.ending.shots;
    const t = smootherstep(range(a.at, b.at, e));
    cam.position.set(...a.position).lerp(v1.set(...b.position), t);
    const target = this.resolve(a.target, new Vector3()).lerp(this.resolve(b.target, v2), t);
    cam.up.copy(up);
    cam.lookAt(target);
    const breathe = directorConfig.breathe;
    const bt = time * breathe.speed;
    const still = REDUCED_MOTION ? 0 : 1;
    cam.position.x += wobble(bt, 1) * breathe.position * still;
    cam.position.y += wobble(bt * 0.8, 2) * breathe.position * still;
    cam.fov = PhotoPortal.fitFov(MathUtils.lerp(a.fov, b.fov, t), aspect);
    cam.near = renderConfig.near;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    return { focus: cam.position.distanceTo(this.photographer.printPosition), aperture: walkConfig.ending.aperture, photoDistance: Infinity };
  }

  /** Pose the viewer camera for everything seen from outside the picture. */
  pose(cam: PerspectiveCamera, p: number, time: number, dt: number, aspect: number): ShotState {
    const free = this.shot(p, cam);
    // portrait screens keep a usable horizontal field of view
    cam.fov = PhotoPortal.fitFov(cam.fov, aspect);
    let focus = free.focus;
    let aperture = free.aperture;
    let photoDistance = Infinity;

    const approach = phaseProgress(p, 'PHOTO_APPROACH');
    const depth = phaseProgress(p, 'PHOTO_DEPTH');
    if (approach > 0) {
      // the print's frame: image center, +Z out of the picture
      this.print.image.updateMatrixWorld(true);
      m1.copy(this.print.image.matrixWorld);
      const ideal = this.portal.idealDistance;
      const fovDepth = PhotoPortal.fitFov(transitionConfig.depthFov, aspect);
      const cover = this.portal.coverDistance(fovDepth, aspect);
      const t = transitionConfig;
      const lockT = smootherstep(range(0, t.lockEnd, approach));
      const dollyT = smootherstep(range(t.dollyStart, 1, approach));
      let d = MathUtils.lerp(transitionConfig.approachLockDistance, ideal, dollyT);
      if (depth > 0) d = MathUtils.lerp(ideal, Math.min(cover * t.coverFactor, ideal), smootherstep(depth / transitionConfig.coverMargin));
      photoDistance = d;

      // free shot expressed in the print frame, then blended into the locked on-axis pose
      m2.copy(m1).invert().multiply(m3.compose(cam.position, cam.quaternion, v1.set(1, 1, 1)));
      const localPos = new Vector3();
      const localQuat = new Quaternion();
      m2.decompose(localPos, localQuat, v2);
      // a curve around the cheek: start -> waypoint -> on-axis lock (quadratic Bezier)
      const w = transitionConfig.approachWaypoint;
      const t1 = 1 - lockT;
      localPos.multiplyScalar(t1 * t1).add(v3.set(w[0], w[1], w[2]).multiplyScalar(2 * t1 * lockT)).add(v2.set(0, 0, d).multiplyScalar(lockT * lockT));
      localQuat.slerp(q1.identity(), lockT);
      m2.compose(localPos, localQuat, v2.set(1, 1, 1));
      m2.premultiply(m1);
      m2.decompose(cam.position, cam.quaternion, v2);
      cam.fov = MathUtils.lerp(cam.fov, fovDepth, smootherstep(approach));
      focus = MathUtils.lerp(focus, cam.position.distanceTo(this.photographer.printPosition), lockT);
      // the print is centimeters away: a real lens would blur its edges, so the aperture closes
      aperture *= 1 - smootherstep(range(t.apertureClose[0], t.apertureClose[1], approach));
    }

    // a held camera breathes; it stops breathing once it is locked onto the print
    const b = directorConfig.breathe;
    const free01 = REDUCED_MOTION ? 0 : 1 - smootherstep(range(0, b.lockFade, approach));
    const bt = time * b.speed;
    cam.position.x += wobble(bt, 1) * b.position * free01;
    cam.position.y += wobble(bt * 0.8, 2) * b.position * free01;
    this.recoil = Math.max(0, this.recoil - dt * directorConfig.recoil.decay);
    const kick = REDUCED_MOTION ? 0 : this.recoil * this.recoil * directorConfig.recoil.amount;
    cam.quaternion.multiply(
      q1.setFromEuler(new Euler(wobble(bt * 1.1, 3) * b.rotation * free01 + kick * directorConfig.recoil.pitch, wobble(bt * 0.9, 4) * b.rotation * free01, kick * directorConfig.recoil.roll)),
    );

    cam.near = photoDistance < transitionConfig.photoNearBelow ? renderConfig.photoNear : renderConfig.near;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    return { focus, aperture, photoDistance };
  }
}
