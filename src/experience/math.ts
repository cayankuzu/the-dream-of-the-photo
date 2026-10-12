export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Smoother C2 ease (quintic). */
export const smootherstep = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/** Remap v from [a, b] to [0, 1] (clamped). */
export const range = (a: number, b: number, v: number): number => clamp((v - a) / (b - a), 0, 1);

/** Frame-rate independent exponential damping toward a target. */
export const damp = (current: number, target: number, rate: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

export const DEG = Math.PI / 180;

/** Cheap deterministic smooth noise in [-1, 1] (sum of incommensurate sines). */
export const wobble = (t: number, seed = 0): number =>
  (Math.sin(t * 1.31 + seed * 7.1) * 0.5 +
    Math.sin(t * 2.17 + seed * 3.7) * 0.3 +
    Math.sin(t * 3.73 + seed * 1.3) * 0.2);
