/**
 * The walk through the dream: where the viewer is, and where they look, at every moment of the
 * WORLD phase; then the last photograph and the waking (EXPLORATION).
 *
 * Positions are in the walk frame: the alley's own frame (the photographer at the origin, the alley
 * running along -Z), continued straight on past the giant print at its end. Everything beyond that
 * print is drawn at `seaConfig.offset` from where the walk frame puts it (see sea.config.ts), so the
 * passage through the print is a pure translation and stays invisible.
 */
import type { HomeWindow } from './film.config';

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

/**
 * A key of the ending's camera (at: EXPLORATION fraction; fov: deg): a place in the street and what it looks at, or
 * `onPrint` m in front of the print in his hand, looking straight at the window of the house in its picture. The
 * way into a key bends through `via` (a point it passes near), to go round his head.
 */
export type EndingShot = { at: number; fov: number; via?: V3 } & ({ position: V3; target: V3 | 'print' } | { onPrint: number });

export const walkConfig = {
  /**
   * The first key is replaced by where the passage through the photograph left the viewer (its
   * position and heading); the rest is the dream's own path. Between keys the walk never stops:
   * every channel is a monotone cubic, so speed changes smoothly and nothing overshoots.
   */
  keys: [
    { at: 0, position: [0.15, 1.57, -4.5], yaw: 0, pitch: 0, fov: 58 }, // inside the picture (replaced)
    { at: 0.045, position: [0.05, 1.6, -10], yaw: 3, pitch: 5, fov: 60 }, // hair instead of rain
    { at: 0.09, position: [-0.1, 1.62, -16], yaw: -4, pitch: 12, fov: 62 }, // the first line of prints
    { at: 0.14, position: [0.05, 1.64, -24], yaw: 2, pitch: 15, fov: 62 }, // under the scratched faces
    { at: 0.19, position: [0.1, 1.62, -33], yaw: 0, pitch: 4, fov: 58 }, // where the street should end
    { at: 0.25, position: [0, 1.62, -45], yaw: -3, pitch: 1, fov: 60 }, // the ones who stand
    { at: 0.31, position: [-0.1, 1.62, -58], yaw: 2, pitch: 0, fov: 54 }, // half of them
    { at: 0.34, position: [0, 1.62, -64.5], yaw: 0, pitch: 3, fov: 70 }, // through the slit, into the hall
    { at: 0.4, position: [-3, 1.62, -78], yaw: 16, pitch: 2, fov: 68 }, // beds and a wheelchair
    { at: 0.45, position: [2, 1.62, -92], yaw: -14, pitch: 16, fov: 70 }, // the head, half sunk
    { at: 0.49, position: [0, 1.62, -108], yaw: 4, pitch: 2, fov: 62 }, // the screens
    { at: 0.525, position: [0, 1.62, -123.5], yaw: 0, pitch: 0, fov: 50 }, // the slit in the end wall
    { at: 0.56, position: [0, 1.62, -132], yaw: 4, pitch: 2, fov: 56 }, // red: the darkroom
    { at: 0.6, position: [0, 1.62, -141], yaw: -5, pitch: 3, fov: 56 }, // every frame one step closer
    { at: 0.635, position: [0, 1.62, -150.5], yaw: 0, pitch: 0, fov: 66 }, // into the meat
    { at: 0.69, position: [0, 1.7, -166], yaw: 3, pitch: 4, fov: 70 }, // the ribs, the eyes
    { at: 0.74, position: [0, 1.6, -184], yaw: 0, pitch: 0, fov: 62 }, // through the teeth
    { at: 0.77, position: [0, 1.7, -196], yaw: 0, pitch: 3, fov: 52 }, // the void, the print on its hooks
    { at: 0.83, position: [0, 2.05, -207], yaw: 0, pitch: 2, fov: 82 }, // the closer you come, the farther it waits
    { at: 0.88, position: [0, 2.4, -218.2], yaw: 0, pitch: 0.5, fov: 60 }, // rising to the middle of the picture
    { at: 0.895, position: [0, 2.47, -221.4], yaw: 0, pitch: 0, fov: 56 }, // the image covers everything
    { at: 0.91, position: [0, 2.2, -225], yaw: 0, pitch: 0, fov: 58 }, // the black sea behind it
    { at: 0.95, position: [0.4, 1.75, -234], yaw: 8, pitch: 6, fov: 62 }, // the sun stopped halfway
    { at: 0.98, position: [0.2, 1.65, -247], yaw: -6, pitch: 1, fov: 58 }, // among the ones who wait in the water
    { at: 1, position: [0.15, 1.62, -258], yaw: 0, pitch: 1, fov: 54 }, // the photographer, waiting
  ] satisfies readonly WalkKey[],
  /** Dream gliding instead of steps: a slow float (m), its period (s) and a little roll (deg). */
  float: { amount: 0.03, period: 6.5, roll: 0.6 },
  /** The giant print at the end of the alley: walk-frame z of its surface (the passage). */
  printZ: -222,
  /**
   * Near the passage the gaze is drawn to the print: the viewer's own look fades out within
   * `pull[1]` m of its surface and is gone within `pull[0]` m (it comes back on the other side).
   */
  pull: [1.5, 7] as const,
  /** Fraction of the walk over which the light of the photograph turns into the dream's. */
  gradeSpan: 0.06,
  /** The viewer's look fades out over this span before the last photograph (WORLD fraction, EXPLORATION fraction). */
  faceTheCamera: [0.985, 0.0147] as const,
  /**
   * The last photograph, taken by the photographer standing on the water; and the street again, thirty-three years
   * on, where the print in his hand comes up: it is the street as he photographed it, with four at the table.
   */
  ending: {
    /** EXPLORATION fractions: the flash peaks at `flash`; under the white the view goes back outside at `cut`. */
    flash: 0.0147,
    cut: 0.0257,
    /** Rise and fall of the white (fractions of EXPLORATION), and its strength (exposure multiplier). */
    whiteIn: 0.011,
    whiteOut: 0.0807,
    white: 14,
    /** The print in the photographer's hand develops the new picture over this span ("Belirdim" falls at its end). */
    develop: [0.03, 0.16] as const,
    /** Where the eye of the photographer standing on the water is (walk frame): the last picture is taken from there. */
    lens: { position: [0.15, 1.6, -269.6] as V3 },
    /** The window of the house in that picture: lit, and nobody's chair is empty. */
    picture: { light: 1, kind: 'lamp', seated: 4 } satisfies HomeWindow,
    /**
     * Back outside: over his shoulder onto the print; in, close over it, to the window of the house in it, held
     * there; at "Saçına bak" out again past his right shoulder, and away, while his head comes round.
     */
    shots: [
      { at: 0.0257, position: [0.3, 1.8, 0.36], target: 'print', fov: 30 },
      { at: 0.3, onPrint: 0.1, via: [0.42, 1.76, -0.05], fov: 9 },
      { at: 0.5, onPrint: 0.1, fov: 9 },
      { at: 0.66, position: [0.5, 1.86, 0.42], via: [0.45, 1.78, -0.1], target: 'print', fov: 26 },
      { at: 0.95, position: [1.05, 2.35, 3.4], target: [0, 1.45, -0.6], fov: 40 },
    ] as readonly EndingShot[],
    /** Depth of field of the waking shots. */
    aperture: 9,
    /**
     * They have followed you out: bodies standing down the real alley once you are awake, facing you
     * (avatar, clip and its time, x and z of each one).
     */
    followers: [
      { avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 2.5, veil: false, at: [[-1.25, -9], [1.3, -15.5], [-0.9, -23]] },
      { avatar: 'figure_woman', clip: 'f_listen_door', time: 1.5, veil: true, at: [[1.15, -7], [-1.35, -13.5], [0.4, -19.5]] },
      { avatar: 'figure_nurse', clip: 'f_idle_touch_hair_01', time: 0.5, veil: false, at: [[-0.2, -28], [1.2, -25]] },
    ],
  },
} as const;
