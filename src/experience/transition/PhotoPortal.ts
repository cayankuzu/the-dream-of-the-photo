import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { photoConfig, renderConfig, transitionConfig } from '../../config/experience.config';
import { smootherstep } from '../math';

const HALF_IMAGE = photoConfig.image.size / 2;
/** On portrait screens the horizontal view is kept this much wider than the landscape fov's tangent. */
const PORTRAIT_WIDEN = 1.25;

/**
 * The geometry that makes the photograph a door.
 *
 * The print is a picture taken by `capture` (the PhotoCamera). Seen from the "ideal viewpoint"
 * — on the image axis at `idealDistance` — every pixel of the print lies on exactly the same ray
 * that the capture camera recorded. So at that point the flat print, a live render of the world
 * from the capture camera (masked to the print), and the world itself are indistinguishable,
 * regardless of the viewer's field of view. The transition walks through those equivalences:
 *
 *   flat print ──(at ideal distance)──▶ live portal ──(when the image covers the screen)──▶ world
 *
 * and only moves the virtual camera forward once the hand-off is invisible.
 */
export class PhotoPortal {
  /** PhotoCamera: where the picture was taken from. */
  readonly capture = new PerspectiveCamera(photoConfig.captureFov, 1, renderConfig.near, renderConfig.far);
  /** WorldCamera: the viewer's camera inside the photograph. */
  readonly world = new PerspectiveCamera(transitionConfig.depthFov, 1, renderConfig.near, renderConfig.far);

  private readonly forward = new Vector3();
  private readonly tmp = new Vector3();
  private readonly endStraight = new Vector3();
  private readonly toStand = new Vector3();
  private readonly levelQuat = new Quaternion();

  /** Camera distance from the print at which the print matches the capture frustum exactly. */
  get idealDistance(): number {
    return HALF_IMAGE / Math.tan(MathUtils.degToRad(this.capture.fov) / 2);
  }

  /** Camera distance at which the image area covers the whole screen (camera on-axis). */
  coverDistance(fov: number, aspect: number): number {
    return HALF_IMAGE / (Math.tan(MathUtils.degToRad(fov) / 2) * Math.max(aspect, 1));
  }

  /** Vertical fov that keeps the horizontal view comfortable on portrait screens. */
  static fitFov(fov: number, aspect: number): number {
    if (aspect >= 1) return fov;
    const h = 2 * Math.atan(Math.tan(MathUtils.degToRad(fov) / 2) * PORTRAIT_WIDEN);
    return Math.min(renderConfig.maxPortraitFov, MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / aspect)));
  }

  /** Freeze the capture pose (called at the shutter). */
  setCapture(position: Vector3, quaternion: Quaternion): void {
    this.capture.position.copy(position);
    this.capture.quaternion.copy(quaternion);
    this.capture.updateMatrixWorld(true);
    this.forward.set(0, 0, -1).applyQuaternion(quaternion);
    // level orientation with the same heading, for standing inside the picture
    const yaw = Math.atan2(-this.forward.x, -this.forward.z);
    this.levelQuat.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  }

  get heading(): Quaternion {
    return this.levelQuat;
  }

  /**
   * Pose the world camera for the transition.
   * @param travel 0..1 across PHOTO_DEPTH + PHOTO_ENTRY
   * @param settle 0..1 across PHOTO_ENTRY (blend towards the standing pose)
   * @param standPosition where the viewer finally stands inside the picture
   */
  poseWorldCamera(travel: number, settle: number, standPosition: Vector3, fov: number, aspect: number): void {
    const total = transitionConfig.depthTravel + transitionConfig.entryTravel;
    const along = total * travel;
    const s = smootherstep(settle);
    const straight = this.tmp.copy(this.capture.position).addScaledVector(this.forward, along);
    // drift from the straight dolly line to the standing point as we settle
    const endStraight = this.endStraight.copy(this.capture.position).addScaledVector(this.forward, total);
    straight.addScaledVector(this.toStand.subVectors(standPosition, endStraight), s);
    this.world.position.copy(straight);
    this.world.quaternion.slerpQuaternions(this.capture.quaternion, this.levelQuat, s);
    this.world.fov = fov;
    this.world.aspect = aspect;
    this.world.updateProjectionMatrix();
    this.world.updateMatrixWorld(true);
  }
}
