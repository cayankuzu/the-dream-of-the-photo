/**
 * The walk through the dream: where the viewer is, and where they look, at every moment of the
 * WORLD phase; then the last photograph and the waking (EXPLORATION).
 *
 * Positions are in the walk frame: the alley's own frame (the photographer at the origin, the alley
 * running along -Z), continued straight on past the giant print at its end. Everything beyond that
 * print is drawn at `seaConfig.offset` from where the walk frame puts it (see sea.config.ts), so the
 * passage through the print is a pure translation and stays invisible.
 */

/** One pose of the walk. */
export interface WalkKey {
  /** Fraction of the WORLD phase. */
  at: number;
  /** Walk-frame position of the eye (m). */
  position: readonly [number, number, number];
  /** Heading (deg, 0 = straight down the alley, positive turns left) and pitch (deg, positive looks up). */
  yaw: number;
  pitch: number;
  /** Vertical field of view (deg). */
  fov: number;
}

type V3 = readonly [number, number, number];

export const walkConfig = {
  /**
   * The first key is replaced by where the passage through the photograph left the viewer (its
   * position and heading); the rest is the dream's own path. Between keys the walk never stops:
   * every channel is a monotone cubic, so speed changes smoothly and nothing overshoots.
   */
  keys: [
    { at: 0, position: [0.15, 1.57, -4.5], yaw: 0, pitch: 0, fov: 58 }, // inside the picture (replaced)
    { at: 0.07, position: [0.05, 1.6, -9.5], yaw: 3, pitch: 4, fov: 60 }, // the rain that waits
    { at: 0.15, position: [-0.1, 1.62, -15.5], yaw: -4, pitch: 12, fov: 62 }, // the first line of prints
    { at: 0.23, position: [0.05, 1.64, -23], yaw: 2, pitch: 15, fov: 62 }, // under the prints
    { at: 0.31, position: [0.1, 1.62, -32], yaw: 0, pitch: 5, fov: 58 }, // where the street should end
    { at: 0.38, position: [0, 1.62, -40.5], yaw: 0, pitch: 18, fov: 66 }, // the chair, as large as remembered
    { at: 0.45, position: [-0.15, 1.75, -47.5], yaw: 10, pitch: 10, fov: 62 }, // gravity forgets
    { at: 0.53, position: [0.2, 2.1, -55], yaw: -12, pitch: 14, fov: 62 }, // and so do you, a little
    { at: 0.6, position: [0, 1.9, -62.5], yaw: 0, pitch: 3, fov: 52 }, // the print at the end
    { at: 0.7, position: [0, 2.05, -75], yaw: 0, pitch: 2, fov: 82 }, // the closer you come, the farther it waits
    { at: 0.78, position: [0, 2.4, -88.2], yaw: 0, pitch: 0.5, fov: 60 }, // rising to the middle of the picture
    { at: 0.81, position: [0, 2.47, -91.4], yaw: 0, pitch: 0, fov: 56 }, // the image covers everything
    { at: 0.835, position: [0, 2.2, -95], yaw: 0, pitch: 0, fov: 58 }, // the sea behind it
    { at: 0.88, position: [0.4, 1.75, -104], yaw: 12, pitch: 14, fov: 62 }, // the moon is a photograph
    { at: 0.94, position: [0.2, 1.65, -117], yaw: -6, pitch: 2, fov: 58 }, // the lamps on the water
    { at: 1, position: [0.15, 1.62, -128], yaw: 0, pitch: 1, fov: 54 }, // the photographer, waiting
  ] satisfies readonly WalkKey[],
  /** Dream gliding instead of steps: a slow float (m), its period (s) and a little roll (deg). */
  float: { amount: 0.03, period: 6.5, roll: 0.6 },
  /** The giant print at the end of the alley: walk-frame z of its surface (the passage). */
  printZ: -92,
  /**
   * Near the passage the gaze is drawn to the print: the viewer's own look fades out within
   * `pull[1]` m of its surface and is gone within `pull[0]` m (it comes back on the other side).
   */
  pull: [1.5, 7] as const,
  /** Fraction of the walk over which the light of the photograph turns into the dream's. */
  gradeSpan: 0.06,
  /** The viewer's look fades out over this span before the last photograph (WORLD fraction, EXPLORATION fraction). */
  faceTheCamera: [0.985, 0.04] as const,
  /** The last photograph: taken by the photographer standing on the water, from their eye. */
  ending: {
    /** EXPLORATION fractions: the flash peaks at `flash`; under the white the view goes back outside at `cut`. */
    flash: 0.04,
    cut: 0.07,
    /** Rise and fall of the white (fractions of EXPLORATION), and its strength (exposure multiplier). */
    whiteIn: 0.03,
    whiteOut: 0.22,
    white: 14,
    /** The print in the photographer's hand develops the new picture over this span. */
    develop: [0.12, 0.5] as const,
    /** Where the last picture is taken from (walk frame) and what it looks at. */
    lens: { position: [0.15, 1.6, -139.6] as V3, target: [0.1, 1.55, -100] as V3 },
    /** Back outside: over the photographer's shoulder, then pulling away (position, look target, fov). */
    shots: [
      { at: 0.07, position: [0.3, 1.8, 0.36] as V3, target: 'print' as const, fov: 30 },
      { at: 1, position: [1.05, 2.35, 3.4] as V3, target: [0, 1.45, -0.6] as V3, fov: 40 },
    ],
    /** Depth of field of the waking shots. */
    aperture: 9,
  },
} as const;
