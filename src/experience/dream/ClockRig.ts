import { Object3D, Vector3 } from 'three';

export interface ClockHand {
  pivot: Object3D;
  /** Angle of the hand in its pivot at rest (rad). */
  base: number;
}

const HANDS = ['wall_clock_hours_hand', 'wall_clock_minute_hand', 'wall_clock_second_hand'];

/** Re-pivot a wall clock's hands (the clock model, or any clone of it) around the dial center. */
export function rigClock(clock: Object3D): ClockHand[] {
  const dial = clock.getObjectByName('wall_clock');
  if (!dial) return [];
  const hands: ClockHand[] = [];
  for (const name of HANDS) {
    const hand = clock.getObjectByName(name);
    if (!hand || !hand.parent) continue;
    const pivot = new Object3D();
    pivot.position.set(dial.position.x, dial.position.y, hand.position.z);
    hand.parent.add(pivot);
    const offset = new Vector3().subVectors(hand.position, pivot.position);
    pivot.add(hand);
    hand.position.copy(offset);
    hands.push({ pivot, base: Math.atan2(offset.y, offset.x) });
  }
  return hands;
}

/** Seconds per full turn of the hour, minute and second hands. */
const TURN = [12 * 3600, 3600, 60];

/** Show a time (seconds since midnight, continuous; it may run backwards). */
export function setClock(hands: readonly ClockHand[], seconds: number): void {
  for (let i = 0; i < hands.length; i++) {
    const u = seconds / TURN[i];
    hands[i].pivot.rotation.z = Math.PI / 2 - (u - Math.floor(u)) * Math.PI * 2 - hands[i].base;
  }
}
