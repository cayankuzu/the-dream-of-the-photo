/**
 * Every tunable value of the experience lives here.
 * Units: meters, seconds, degrees (unless a name says otherwise).
 * Progress values are normalized timeline positions in [0, 1].
 */

export const PHASES = [
  'INTRO',
  'CAMERA_RAISE',
  'AIM',
  'FOCUS',
  'CAPTURE',
  'PHOTO_EJECT',
  'PHOTO_REVEAL',
  'PHOTO_APPROACH',
  'PHOTO_DEPTH',
  'PHOTO_ENTRY',
  'WORLD',
  'EXPLORATION',
] as const;

export type Phase = (typeof PHASES)[number];

/** A moment on the timeline as [phase, fraction of that phase]. */
export type Cue = readonly [Phase, number];

export const timelineConfig = {
  /** Start of every phase. A phase lasts until the next one starts; EXPLORATION ends at 1. */
  phaseStart: {
    INTRO: 0,
    CAMERA_RAISE: 0.02,
    AIM: 0.06,
    FOCUS: 0.09,
    CAPTURE: 0.115,
    PHOTO_EJECT: 0.135,
    PHOTO_REVEAL: 0.165,
    PHOTO_APPROACH: 0.195,
    PHOTO_DEPTH: 0.225,
    PHOTO_ENTRY: 0.255,
    /** The walk through the dream (see walk.config.ts): most of the piece. */
    WORLD: 0.28,
    /** The last photograph, and waking up. */
    EXPLORATION: 0.93,
  } satisfies Record<Phase, number>,
  /** Where inside CAPTURE the shutter fires (fraction of the phase). */
  shutterAt: 0.45,
  /** Wheel pixels needed to travel the whole timeline. */
  scrollLength: 13500,
  /** Clamp of a single wheel event (px) so one flick can never jump a state. */
  maxWheelStep: 120,
  touchMultiplier: 2.4,
  keyStep: 300,
  /** Exponential follow rate of the smoothed timeline (1/s). */
  damping: 3.2,
  /** Maximum timeline speed (progress / s). */
  maxSpeed: 0.19,
  /** Local slow-motion around important beats: cue, half-width (progress), speed multiplier. */
  tempo: [
    { at: ['CAPTURE', 0.3] as Cue, width: 0.005, scale: 0.42 }, // the shutter (centered just before it fires)
    { at: ['PHOTO_DEPTH', 0.5] as Cue, width: 0.012, scale: 0.65 }, // paper surface -> depth
    { at: ['PHOTO_ENTRY', 1 / 6] as Cue, width: 0.008, scale: 0.7 }, // passing through the paper
    { at: ['WORLD', 0.81] as Cue, width: 0.006, scale: 0.6 }, // through the giant print
  ],
  /** Micro hit-stop when the shutter fires. */
  shutterHoldSeconds: 0.14,
} as const;

export const renderConfig = {
  maxPixelRatio: 1.75,
  /** Pixel budget of the drawing buffer (the pixel ratio is lowered on very large or dense screens). */
  maxPixels: 2.4e6,
  /** Above this pixel ratio the render targets use fewer MSAA samples. */
  denseRatio: 1.4,
  denseSamples: 2,
  maxFps: 60,
  /** Tall phones: the widened vertical field of view stops here (deg). */
  maxPortraitFov: 76,
  fadeInSeconds: 2.4,
  minPixelRatio: 0.65,
  msaaSamples: 4,
  near: 0.05,
  /** Near plane while the camera is centimeters from the photograph. */
  photoNear: 0.004,
  far: 220,
  shadowMapSize: 2048,
  /** Adaptive resolution: frame-rate window (fps) outside which the pixel ratio steps. */
  adaptive: { lowFps: 42, highFps: 57, step: 0.1, sampleSeconds: 1.5 },
  /** Fraction of screen height used as the maximum DOF blur radius. */
  dofMaxBlur: 0.0085,
  grain: 0.035,
  vignette: 0.27,
} as const;

/** Photograph and the camera that takes it. */
export const photoConfig = {
  /** Instant print, meters. */
  print: { width: 0.088, height: 0.107, thickness: 0.0009 },
  image: { size: 0.079, offsetFromTop: 0.0065 },
  /** Vertical field of view of the capture camera (square frame). */
  captureFov: 54,
  captureResolution: 1024,
  /** Resting curl of the paper (meters of sag across the width). */
  curl: 0.0018,
  /** Instant-film development (fraction of PHOTO_REVEAL in which the image appears). */
  developEnd: 0.82,
  /** The print looks a little dimmer in the hand (lit by the alley) and evens out as you approach. */
  litFrom: 0.82,
  /** Photographic grade applied to everything seen "through" the photograph. */
  grade: { exposure: 1.18, saturation: 0.86, warmth: 0.06, tint: -0.015, flare: 0.006 },
} as const;

/** The photo -> world transition. */
export const transitionConfig = {
  /** Camera distance (photo-local, meters) where the approach locks onto the photo axis. */
  approachLockDistance: 0.17,
  /**
   * Photo-local waypoint the approach curves through, beside the photographer's right cheek
   * (+X is the photographer's right), so the viewer never passes through their head.
   */
  approachWaypoint: [0.22, 0.05, 0.24] as const,
  /** Fraction of PHOTO_DEPTH after which the screen must be fully covered by the image. */
  coverMargin: 0.82,
  /** Fraction of PHOTO_DEPTH over which the flat print hands over to the live window (they match). */
  portalFade: 0.035,
  /** Camera distance as a fraction of the cover distance at the end of the depth dolly (< 1, so the world takes over). */
  coverFactor: 0.92,
  /** PHOTO_APPROACH: the camera locks onto the print's axis by `lockEnd`, dollies in from `dollyStart`. */
  lockEnd: 0.55,
  dollyStart: 0.45,
  /** PHOTO_APPROACH span over which the aperture closes (the print is centimeters away). */
  apertureClose: [0.3, 0.85] as const,
  /** Below this distance to the print the viewer camera uses the photo near plane. */
  photoNearBelow: 0.6,
  /** Meters the virtual camera travels into the world during PHOTO_DEPTH (impossible depth). */
  depthTravel: 1.7,
  /** Meters traveled during PHOTO_ENTRY after the paper has been passed. */
  entryTravel: 2.6,
  /** Field of view while looking into the photograph (degrees, vertical). */
  depthFov: 38,
  /** Field of view of the dream world. */
  worldFov: 58,
  /**
   * Glossy paper sheen (linear light): rises from `rise` of PHOTO_DEPTH, fades over `fade` of PHOTO_ENTRY
   * while sliding `slide` screen-heights off by `slideEnd`; `lead` is its resting offset at the print.
   */
  sheen: { strength: 0.06, rise: 0.15, fade: [0.1, 0.75] as const, slide: 1.4, slideEnd: 0.8, lead: 0.12 },
  /** Share of PHOTO_ENTRY (vs WORLD) in the move from the photograph's grade to the dream's. */
  gradeEntryShare: 0.6,
} as const;

export const lookConfig = {
  sensitivity: 0.0032,
  damping: 7,
  maxPitch: 68,
  minPitch: -62,
  /** Fraction of the WORLD phase over which look control fades in (it unwinds the same way back). */
  blendIn: 0.03,
  /** While walking, the gaze drifts back to the way ahead (rate 1/s at full walking speed). */
  recenter: 0.9,
  /** Timeline speed (progress / s) that counts as full walking speed. */
  walkSpeed: 0.02,
  /** Arrow-key turning speed (deg / s). */
  keySpeed: 70,
  /**
   * Attention zoom: dwelling on a point of interest slowly narrows the view (dream focus), never so far
   * that the point leaves the inner `frameShare` of the half-frame.
   */
  attention: { dwellSeconds: 1.1, zoomRate: 0.35, releaseRate: 1.2, frameShare: 0.6 },
  /** Seconds a memory must hold the gaze before it is found. */
  discoverSeconds: 1.6,
  hintFadeAfterDegrees: 50,
} as const;

/** Visitors who ask for less motion get a steady camera (no hand-held breathing or recoil). */
export const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Debug overlay is opt-in (?debug) and only exists in dev builds. */
export const DEBUG_MODE =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('debug');

/** Render layers. */
export const LAYERS = {
  /** Shared by the real alley and the photograph's world. */
  WORLD: 0,
  /** Only exists in the real (outer) moment: the photographer, the held camera and print. */
  OUTER: 1,
  /** Only exists inside the photograph (also visible in the captured image itself). */
  DREAM: 2,
} as const;


/** The photographer's performance, keyed to the timeline. */
export const photographerConfig = {
  /** Where the photographer stands (feet) and which way they face (deg, 180 = down the alley, -Z). */
  position: [0, 0, 0] as const,
  heading: 180,
  /** Pitch of the designed framing (deg): level, a hair below the horizon. */
  aimPitch: -2.2,
  /** Fraction of the timeline after CAPTURE over which the lens lets go of the designed framing. */
  aimRelease: 0.01,
  /** Shutter button travel around the shutter beat (timeline progress before / release window after). */
  button: { lead: 0.003, release: [0.002, 0.006] as const },
  envMapIntensity: 0.8,
  /** Where the left elbow points while reaching (m below and to the side of the shoulder). */
  elbowPole: { down: 0.6, out: 0.35 },
  /** The head turns to the print within PHOTO_REVEAL [from, to]; the neck takes a share of it. */
  gaze: { from: 0.2, to: 0.7, neckShare: 0.4 },
  /** take_picture mocap time (s) at each beat: raise 0-2 s, eye 2-3.75 s, lower 3.75-5 s, look 5-7 s. */
  clip: [
    [['INTRO', 0], 1.0],
    [['CAMERA_RAISE', 0.08], 1.02],
    [['CAMERA_RAISE', 1], 2.15],
    [['AIM', 1], 2.6],
    [['FOCUS', 1], 3.15],
    [['CAPTURE', 1], 3.55],
    [['PHOTO_EJECT', 0.15], 3.7],
    [['PHOTO_EJECT', 1], 5.25],
    [['PHOTO_REVEAL', 1], 6.45],
  ] as readonly (readonly [Cue, number])[],
  /** Idle life before the shot: the clip breathes a few hundredths of a second around its pose. */
  idleSway: 0.035,
  breathing: 0.7,
  /** Gap between the right eye and the viewfinder (m). */
  eyepieceGap: 0.016,
  /** Mocap time at which the camera grip is calibrated (camera at the eye). */
  calibrateAt: 2.9,
  /** Print hand-off inside PHOTO_REVEAL (fractions of the phase). */
  print: {
    /** Part of PHOTO_EJECT during which the print slides out of the slot. */
    slide: [0.15, 0.85] as const,
    /** Height (m) of the arc the print travels when lifted. */
    arc: 0.06,
    reachEnd: 0.22,
    pullEnd: 0.42,
    liftEnd: 0.9,
    /** Where the print is held to be looked at, relative to the right eye in the body frame (x left, y up, z forward). */
    viewOffset: [0.06, -0.1, 0.33] as const,
    /** Tilt of the held print (deg): leans back a little, turned slightly to the right shoulder. */
    viewTilt: [-8, -10, 2] as const,
    tremor: 0.0012,
  },
} as const;

type ShotTarget = readonly [number, number, number] | 'camera' | 'print';

/**
 * Viewer camera shots before the transition (world space: the photographer stands at the origin
 * facing -Z, their right shoulder is +X). Each shot: beat, position, look target, vertical fov,
 * focus distance in m (or 'target' = the distance to the look target) and DOF strength.
 */
export const shotsConfig: readonly {
  at: Cue;
  position: readonly [number, number, number];
  target: ShotTarget;
  fov: number;
  focus: number | 'target';
  aperture: number;
}[] = [
  { at: ['INTRO', 0], position: [0.8, 1.6, 2.45], target: [-0.3, 1.36, -8], fov: 36, focus: 2.4, aperture: 7 },
  { at: ['CAMERA_RAISE', 0.15], position: [0.74, 1.63, 2.15], target: [-0.28, 1.38, -8], fov: 35.5, focus: 2.2, aperture: 7 },
  { at: ['CAMERA_RAISE', 1], position: [0.5, 1.73, 1.05], target: [-0.12, 1.5, -8], fov: 34, focus: 1.1, aperture: 8 },
  { at: ['AIM', 1], position: [0.33, 1.78, 0.52], target: [-0.02, 1.55, -10], fov: 33, focus: 0.7, aperture: 9 },
  { at: ['FOCUS', 1], position: [0.31, 1.78, 0.48], target: [0, 1.55, -10], fov: 32.5, focus: 14, aperture: 9 },
  { at: ['CAPTURE', 1], position: [0.31, 1.78, 0.48], target: [0, 1.55, -10], fov: 32.5, focus: 14, aperture: 9 },
  { at: ['PHOTO_EJECT', 0.35], position: [0.52, 1.9, 0.44], target: 'camera', fov: 31, focus: 'target', aperture: 10 },
  { at: ['PHOTO_EJECT', 1], position: [0.46, 1.92, 0.28], target: 'camera', fov: 30, focus: 'target', aperture: 11 },
  { at: ['PHOTO_REVEAL', 1], position: [0.3, 1.8, 0.36], target: 'print', fov: 30, focus: 'target', aperture: 12 },
];

/** Cinematic parameters that are not tied to a single shot. */
export const directorConfig = {
  /** Hand-held breathing of the viewer camera (m and rad). */
  breathe: { position: 0.0035, rotation: 0.0016, speed: 0.45, /** fraction of PHOTO_APPROACH over which it stops */ lockFade: 0.4 },
  /** Recoil of the viewer camera when the shutter fires (amount, decay rate, pitch and roll shares). */
  recoil: { amount: 0.006, decay: 7, pitch: 0.6, roll: 0.25 },
  /** Shots aimed at the instant camera look this far above its center (m). */
  cameraTargetLift: 0.03,
  /** Flash envelope (s) and how much of it the screen itself shows. */
  flash: { attack: 0.012, decay: 0.16, screen: 0.625 },
  /** Sound beats (cues) of the camera mechanics. */
  soundCues: {
    raise: ['CAMERA_RAISE', 0.04] as Cue,
    focus: ['FOCUS', 0.0667] as Cue,
    eject: ['PHOTO_EJECT', 0.1] as Cue,
    paper: ['PHOTO_REVEAL', 0.2] as Cue,
  },
  /** The ambience comes back between these timeline offsets after the shutter. */
  duckRelease: [0.005, 0.025] as const,
  /** Uniform lens softness while it hunts for focus during AIM and FOCUS. */
  lensHunt: 0.35,
  /** No adaptive resolution change within this distance (progress) of the shutter. */
  adaptQuiet: 0.005,
  /** Grades (see Grade.ts): the cold real alley and the dream. */
  outerGrade: { exposure: 1.0, saturation: 0.8, warmth: -0.05, tint: 0.0, flare: 0.0015 },
  dreamGrade: { exposure: 1.06, saturation: 0.9, warmth: 0.035, tint: 0.012, flare: 0.004 },
  /** Slow drift of the dream's light temperature (period s, amplitude in warmth). */
  dreamDrift: { period: 47, warmth: 0.05, tint: 0.015 },
} as const;
