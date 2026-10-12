import { MathUtils, Quaternion, Vector3 } from 'three';
import type { MemoryId } from '../../config/copy.config';
import { lookConfig, REDUCED_MOTION } from '../../config/experience.config';
import { damp, DEG } from '../math';

export interface PointOfInterest {
  position: Vector3;
  /** Angular radius (deg) in which the gaze counts as "looking at it". */
  radius: number;
  /** Field-of-view multiplier reached after dwelling (< 1 zooms in). */
  zoom: number;
  /** Points can exist only part of the time (e.g. after a change in the dream). */
  active?: () => boolean;
  /** A memory: a long enough look finds it (the HUD counts them). */
  memory?: MemoryId;
}

const forward = new Vector3();
const toPoi = new Vector3();

/**
 * Drag to look (mouse or touch). Full 360° yaw, clamped pitch, never upside down. "Grab the world":
 * dragging right turns the view left, dragging down looks up. While walking the gaze drifts back to
 * the way ahead; when disabled it unwinds back to the timeline's camera along the shortest path.
 */
export class LookControls {
  enabled = false;
  /** Degrees turned since enabled (drives the onboarding hint). */
  turned = 0;
  readonly pointsOfInterest: PointOfInterest[] = [];
  /** Current attention zoom multiplier (1 = none). */
  zoom = 1;
  /** What the gaze rests on now (only while looking is possible), and for how long (s). */
  focus: PointOfInterest | null = null;
  focusSeconds = 0;
  /** The viewer is walking (scrolling): attention does not narrow the view meanwhile. */
  moving = false;
  /** Whether a touch drag may turn the head (a sideways swipe looks, an upward one walks). */
  touchAllowed: () => boolean = () => true;

  private yaw = 0;
  private pitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private dwell = 0;
  private dwellTarget: PointOfInterest | null = null;
  private readonly pointers = new Set<number>();
  private keyTurn = 0;

  constructor(private readonly element: HTMLElement) {
    element.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  private onDown = (e: PointerEvent): void => {
    this.pointers.add(e.pointerId);
    // a second finger means scrolling through time, not looking
    if (this.pointers.size > 1) {
      this.dragging = false;
      return;
    }
    if (!this.enabled || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.element.classList.add('is-grabbing');
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.dragging || !this.enabled || !e.isPrimary) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (e.pointerType === 'touch' && !this.touchAllowed()) return;
    const s = lookConfig.sensitivity * (e.pointerType === 'touch' ? 1.4 : 1) * this.zoom;
    this.targetYaw += dx * s;
    this.targetPitch = MathUtils.clamp(
      this.targetPitch + dy * s,
      lookConfig.minPitch * DEG,
      lookConfig.maxPitch * DEG,
    );
    this.turned += Math.abs(dx * s) / DEG;
  };

  private onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    this.dragging = false;
    this.element.classList.remove('is-grabbing');
  };

  /** Left / right arrows turn the head (up / down stay the timeline's). */
  private onKey = (e: KeyboardEvent): void => {
    if (!this.enabled || (e.target instanceof HTMLElement && e.target.closest('button, a, input'))) return;
    if (e.key === 'ArrowLeft') this.keyTurn = 1;
    else if (e.key === 'ArrowRight') this.keyTurn = -1;
    else return;
    e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') this.keyTurn = 0;
  };

  /** While walking the gaze drifts back to the way ahead (`amount` 0..1 of full walking speed). */
  recenter(amount: number, dt: number): void {
    if (amount <= 0 || this.dragging) return;
    // the nearest equivalent of straight ahead, so it never spins the long way
    const turns = Math.round(this.targetYaw / (Math.PI * 2)) * Math.PI * 2;
    this.targetYaw -= turns;
    this.yaw -= turns;
    const rate = lookConfig.recenter * amount;
    this.targetYaw = damp(this.targetYaw, 0, rate, dt);
    this.targetPitch = damp(this.targetPitch, 0, rate, dt);
  }

  update(dt: number): void {
    if (this.enabled && this.keyTurn !== 0) {
      const turn = this.keyTurn * lookConfig.keySpeed * DEG * dt;
      this.targetYaw += turn;
      this.turned += Math.abs(turn) / DEG;
    }
    if (!this.enabled) {
      // unwind to the nearest equivalent of 0 so scrolling back never spins the long way
      this.targetYaw = 0;
      this.yaw = MathUtils.euclideanModulo(this.yaw + Math.PI, Math.PI * 2) - Math.PI;
      this.targetPitch = 0;
      this.dragging = false;
    }
    this.yaw = damp(this.yaw, this.targetYaw, lookConfig.damping, dt);
    this.pitch = damp(this.pitch, this.targetPitch, lookConfig.damping, dt);
  }

  /** The viewer's own turn of the head (rad), added to the walk's: yaw left, pitch up. */
  get yawOffset(): number {
    return this.yaw;
  }

  get pitchOffset(): number {
    return this.pitch;
  }

  /** Dream focus: dwelling on something slowly narrows the view toward it. */
  updateAttention(cameraQuat: Quaternion, cameraPos: Vector3, fov: number, dt: number): void {
    forward.set(0, 0, -1).applyQuaternion(cameraQuat);
    let best: PointOfInterest | null = null;
    let bestAngle = Infinity;
    for (const poi of this.pointsOfInterest) {
      if (poi.active && !poi.active()) continue;
      const angle = forward.angleTo(toPoi.subVectors(poi.position, cameraPos)) / DEG;
      if (angle < poi.radius && angle < bestAngle) {
        best = poi;
        bestAngle = angle;
      }
    }
    if (best !== this.dwellTarget) {
      this.dwellTarget = best;
      this.dwell = 0;
    }
    this.dwell += dt;
    this.focus = this.enabled ? best : null;
    this.focusSeconds = this.focus ? this.dwell : 0;
    const engaged = !REDUCED_MOTION && this.enabled && !this.moving && best && this.dwell > lookConfig.attention.dwellSeconds && !this.dragging;
    // never zoom so far that the thing looked at leaves the frame
    const keepInFrame = (bestAngle * DEG) / Math.atan(Math.tan((fov * DEG) / 2) * lookConfig.attention.frameShare);
    const goal = engaged ? Math.min(1, Math.max(best!.zoom, keepInFrame)) : 1;
    const rate = engaged ? lookConfig.attention.zoomRate : lookConfig.attention.releaseRate;
    this.zoom = damp(this.zoom, goal, rate, dt);
  }
}
