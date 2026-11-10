import { clamp } from '../math';
import type { RoomInput } from '../rooms/Room';
import { walkKey } from './ScrollInput';

/** A press that travels less than this (px) and is over this soon (ms) is a click, not a drag. */
const CLICK = { travel: 8, ms: 350 };
/** Timeline pixels of scrolling (see Timeline.legs) that count as running as hard as one can. */
const FULL_LEGS = 260;

const PRESS_KEYS = new Set([' ', 'Enter']);

/**
 * What a room can ask of the viewer besides looking: a press (the shutter in the dark), holding (a breath),
 * their legs (scrolling), or nothing at all. It only listens to clicks and keys while the room wants them.
 */
export class RoomInputs {
  /** The room wants clicks, Space and Enter. */
  listening = false;
  readonly state: RoomInput = { pressed: false, holding: false, legs: 0, idle: 0, gazeYaw: 0, gazePitch: 0, gazeSpeed: 0, returned: 0 };
  private clicked = false;
  private pointerDown = false;
  private keyDown = false;
  private downAt = 0;
  private downX = 0;
  private downY = 0;
  private lastActive = performance.now();

  constructor(element: HTMLElement) {
    const active = () => (this.lastActive = performance.now());
    for (const event of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchmove']) window.addEventListener(event, active, { passive: true });
    element.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.pointerDown = true;
      this.downAt = performance.now();
      this.downX = e.clientX;
      this.downY = e.clientY;
    });
    const up = (e: PointerEvent) => {
      if (this.pointerDown && performance.now() - this.downAt < CLICK.ms && Math.hypot(e.clientX - this.downX, e.clientY - this.downY) < CLICK.travel) this.clicked = true;
      this.pointerDown = false;
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', () => (this.pointerDown = false));
    window.addEventListener('keydown', (e) => {
      if (!this.listening || !PRESS_KEYS.has(e.key) || !walkKey(e)) return;
      e.preventDefault();
      if (!e.repeat) this.clicked = true;
      this.keyDown = true;
    });
    window.addEventListener('keyup', (e) => {
      if (PRESS_KEYS.has(e.key)) this.keyDown = false;
    });
  }

  /** Once a frame: what is true now. */
  update(dt: number, legs: number, yaw: number, pitch: number, returned: number): RoomInput {
    const s = this.state;
    s.pressed = this.listening && this.clicked;
    s.holding = this.listening && (this.pointerDown || this.keyDown);
    this.clicked = false;
    s.legs = clamp(legs / FULL_LEGS, 0, 1);
    s.idle = (performance.now() - this.lastActive) / 1000;
    s.gazeSpeed = Math.hypot(yaw - s.gazeYaw, pitch - s.gazePitch) / Math.max(dt, 1e-3);
    s.gazeYaw = yaw;
    s.gazePitch = pitch;
    s.returned = returned;
    return s;
  }
}
