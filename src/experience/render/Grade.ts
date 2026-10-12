import { Matrix3, Vector3 } from 'three';

const LUMA = new Vector3(0.2126, 0.7152, 0.0722);

export interface GradeParams {
  exposure: number;
  saturation: number;
  /** + warm / - cool white balance shift. */
  warmth: number;
  /** + magenta / - green. */
  tint: number;
  /** Veiling flare added in linear light (lifts the blacks like real optics). */
  flare: number;
}

/**
 * An affine color transform in linear light (c' = A c + b).
 * Affine grades compose exactly, so "the outer grade applied to the photograph's grade"
 * can be handed over to a single screen grade without any visible jump.
 */
export class Grade {
  readonly A = new Matrix3();
  readonly b = new Vector3();

  static from(p: GradeParams): Grade {
    const g = new Grade();
    const s = p.saturation;
    const sat = new Matrix3().set(
      LUMA.x * (1 - s) + s, LUMA.y * (1 - s), LUMA.z * (1 - s),
      LUMA.x * (1 - s), LUMA.y * (1 - s) + s, LUMA.z * (1 - s),
      LUMA.x * (1 - s), LUMA.y * (1 - s), LUMA.z * (1 - s) + s,
    );
    const wb = new Matrix3().set(
      1 + p.warmth, 0, 0,
      0, 1 + p.tint * 0.5 - Math.abs(p.warmth) * 0.15, 0,
      0, 0, 1 - p.warmth,
    );
    g.A.multiplyMatrices(wb, sat).multiplyScalar(p.exposure);
    g.b.setScalar(p.flare);
    return g;
  }

  /** this = outer ∘ inner (apply inner first). */
  composeOf(outer: Grade, inner: Grade): this {
    this.A.multiplyMatrices(outer.A, inner.A);
    this.b.copy(inner.b).applyMatrix3(outer.A).add(outer.b);
    return this;
  }

  lerpGrades(a: Grade, b: Grade, t: number): this {
    const ea = a.A.elements;
    const eb = b.A.elements;
    const e = this.A.elements;
    for (let i = 0; i < 9; i++) e[i] = ea[i] + (eb[i] - ea[i]) * t;
    this.b.lerpVectors(a.b, b.b, t);
    return this;
  }

  copy(g: Grade): this {
    this.A.copy(g.A);
    this.b.copy(g.b);
    return this;
  }
}
