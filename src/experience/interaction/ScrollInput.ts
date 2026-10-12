import { timelineConfig } from '../../config/experience.config';
import { clamp } from '../math';
import type { Timeline } from '../timeline/Timeline';

const LINE_HEIGHT = 16;

/**
 * Keys inside the menu belong to the menu; on any other focused control only Space (and Enter) press
 * it, while the arrows and Page keys still move through the piece.
 */
export function walkKey(e: KeyboardEvent): boolean {
  const t = e.target instanceof Element ? e.target : null;
  if (t?.closest('.menu, input, textarea')) return false;
  return !((e.key === ' ' || e.key === 'Enter') && t?.closest('button, a'));
}
/** Pixels a one-finger drag travels before it is decided to be a look (sideways) or a walk (up/down). */
const AXIS_LOCK = 10;

/**
 * Translates wheel / trackpad / touch / keyboard intent into timeline pixels.
 * The page itself never scrolls: the experience owns the scroll.
 */
export class ScrollInput {
  /**
   * While looking around is possible, a one-finger drag is a look when it starts sideways and a walk
   * when it starts up or down; two fingers always walk. Otherwise every drag walks.
   */
  lookEnabled = false;
  /** Off while the pause menu is open. */
  enabled = true;
  /** The axis the current one-finger gesture was decided on. */
  touchAxis: 'none' | 'x' | 'y' = 'none';
  private lastTouchY: number | null = null;
  private startX = 0;
  private startY = 0;

  constructor(
    private readonly timeline: Timeline,
    element: HTMLElement,
  ) {
    window.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('touchstart', this.onTouchStart, { passive: true });
    element.addEventListener('touchmove', this.onTouchMove, { passive: false });
    element.addEventListener('touchend', this.onTouchEnd, { passive: true });
    window.addEventListener('keydown', this.onKey);
  }

  private onWheel = (e: WheelEvent): void => {
    // the menu scrolls itself, and Ctrl + wheel (or a trackpad pinch) zooms the page as usual
    if (!this.enabled || e.ctrlKey || (e.target instanceof Element && e.target.closest('.menu'))) return;
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= LINE_HEIGHT;
    else if (e.deltaMode === 2) dy *= window.innerHeight;
    // A mouse notch reports ~100-120px at once, a trackpad many tiny deltas; clamping per event
    // makes both feel like the same continuous push.
    this.timeline.push(clamp(dy, -timelineConfig.maxWheelStep, timelineConfig.maxWheelStep));
  };

  private touchY(e: TouchEvent): number {
    let y = 0;
    for (let i = 0; i < e.touches.length; i++) y += e.touches[i].clientY;
    return y / e.touches.length;
  }

  private onTouchStart = (e: TouchEvent): void => {
    this.lastTouchY = e.touches.length <= 2 ? this.touchY(e) : null;
    this.startX = e.touches[0].clientX;
    this.startY = e.touches[0].clientY;
    this.touchAxis = e.touches.length === 1 && this.lookEnabled ? 'none' : 'y';
  };

  private onTouchMove = (e: TouchEvent): void => {
    if (e.touches.length > 2 || !this.enabled) return;
    e.preventDefault();
    if (this.touchAxis === 'none') {
      const dx = e.touches[0].clientX - this.startX;
      const dy = e.touches[0].clientY - this.startY;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK) return;
      this.touchAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      this.lastTouchY = this.touchY(e);
    }
    if (this.touchAxis !== 'y') return;
    const y = this.touchY(e);
    if (this.lastTouchY === null) {
      this.lastTouchY = y;
      return;
    }
    const dy = (this.lastTouchY - y) * timelineConfig.touchMultiplier;
    this.lastTouchY = y;
    this.timeline.push(clamp(dy, -timelineConfig.maxWheelStep * 2, timelineConfig.maxWheelStep * 2));
  };

  private onTouchEnd = (e: TouchEvent): void => {
    this.lastTouchY = e.touches.length ? this.touchY(e) : null;
    if (!e.touches.length) this.touchAxis = 'none';
  };

  private onKey = (e: KeyboardEvent): void => {
    if (!this.enabled || !walkKey(e)) return;
    const step = timelineConfig.keyStep;
    switch (e.key) {
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
        this.timeline.push(e.key === 'PageDown' ? step * 3 : step);
        break;
      case 'ArrowUp':
      case 'PageUp':
        this.timeline.push(e.key === 'PageUp' ? -step * 3 : -step);
        break;
      default:
        return;
    }
    e.preventDefault();
  };
}
