import {
  AddEquation,
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  ClampToEdgeWrapping,
  Color,
  CustomBlending,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HalfFloatType,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  TubeGeometry,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYERS, photoConfig, REDUCED_MOTION, renderConfig } from '../../config/experience.config';
import { LAYOUT, type SpotSpec } from '../../config/nightmare.config';
import { damp, DEG, lerp, range, smootherstep, wobble } from '../math';
import { WARP_GLSL, warpUniforms } from '../render/Warp';
import { rigClock, setClock } from './ClockRig';
import { BEND_STEP, meterUVs, type DreamKit, type PropCrowd } from './DreamKit';
import type { DreamFrame, DreamModule } from './DreamModule';
import type { DreamLight } from './LightPool';
import { randomFrom, type Crowd, type FigureSpec } from './FigureKit';

type V3 = readonly [number, number, number];

const { halfWidth: HALF, height: CEILING, to: END_Z } = LAYOUT.darkroom;
const { print, image } = photoConfig;

/** The safelight, as written and as light. */
const RED = 0xff2a12;
const RED_LINEAR = new Color(RED);

/**
 * Everything worth tuning after looking at it. Walk-frame meters, seconds, degrees; intensities in candela.
 * Sides: +1 is the right wall (x > 0), -1 the left.
 */
const darkroomConfig = {
  /** The corridor proper begins behind the hall's thick wall; its walls and floor run on into the collar of meat. */
  startZ: -126,
  pastEndZ: END_Z - 0.6,
  /** The hall's slit as it opens into the corridor (half width, height). */
  slit: { halfWidth: 1.5, height: 3.6 },
  /** A hair under the hall's own floor (it ends at the back of its wall): where the two overlap, the hall's wins. */
  floorY: -0.006,
  floorFromZ: -125.9,

  surfaces: {
    /** Tile up to the shoulder, standing proud of the paint: height, proudness, size of one texture repeat, tint. */
    tile: { top: 1.46, proud: 0.012, repeat: 1.8, color: 0xd8d2ca },
    paint: { repeat: 2.6, color: 0xb4a69e },
    ceiling: { repeat: 3.2, color: 0x4f4844 },
    /** Wet floor: its repeat and the roughness that multiplies the texture's own (.85). */
    floor: { repeat: 2.4, roughness: 0.36 },
    /** The dark glazed strip where tile meets paint: height and depth. */
    trim: { height: 0.045, depth: 0.035, color: 0x2a1512, roughness: 0.3 },
    pipe: { repeat: 1.2, color: 0x8a7f78 },
    /** The stand of steel benches and shelves. */
    steel: { color: 0x9a9c9f, metalness: 0.72, roughness: 0.62, brushed: 1.5 },
    /** Lamps have no shadows: under the benches and in the recess the dark is painted in (share of the wall's color; the under-bench color). */
    recessShade: 0.24,
    underBench: 0x040303,
  },

  /** The floor as a mirror: what wetness does to its roughness (damp, wet), how it darkens wet tile, and the reflection. */
  floorShine: {
    roughness: [1.25, 0.62] as const,
    /** The light on it never quite goes past this (a point of light in wet tile would burn to white; this keeps it red). */
    glare: 2.5,
    darken: 0.72,
    /** Share reflected looking straight down and at the horizon, how fast it rises (power of the grazing), and its ceiling. */
    reflect: { straight: 0.09, grazing: 1, power: 3.4, most: 0.9 },
    /** Share of the reflection left on tile that is only damp. */
    damp: 0.4,
  },

  /** What the floor reflects: the room below it, its light worked out once per vertex. */
  mirrorRoom: { step: 0.75, rows: [0, 0.9, 0.96, 1.46, 2.2, 3, 3.8], gain: 1.1, tileAlbedo: 0.45, paintAlbedo: 0.26, ceilingAlbedo: 0.06, underBench: 0.04 },

  recess: { from: -138, to: -140, depth: 0.75, height: 2.9 },

  lamps: {
    z: [-128.35, -133.75, -139.15, -144.55],
    /** Height of the light under the fixture, of the glow, intensity, reach (short: pools with dark between). */
    lightY: 3,
    haloY: 3.12,
    intensity: 11,
    reach: 5.2,
    /** Strength of the tube (deep red, not yet pink through the tone curve). */
    tube: 1.25,
    /** Triangles kept of each fixture (the chain's links survive this). */
    triangles: 5200,
    /** Slow irregular breathing: rate of the wobble and its depth; now and then a lamp sags (rate, wobble range, depth). */
    breath: { rate: 0.55, depth: 0.22, sagRate: 0.31, sag: [0.5, 0.92] as const, sagDepth: 0.55 },
    /** Size across and up of the glow in the haze, and its strength. */
    halo: { width: 3.1, height: 1.7, strength: 0.2 },
    /** The same seen in the floor. */
    haloBelow: { width: 1.8, height: 1.5, strength: 0.34 },
  },

  /** Pipes along the ceiling: x, y, radius; each sags a little (m) and is held by brackets every `bracketEvery`. */
  pipes: {
    runs: [
      { x: -1.55, y: 3.56, radius: 0.055, sag: 0.03 },
      { x: -1.26, y: 3.61, radius: 0.034, sag: 0.015 },
      { x: 1.85, y: 3.52, radius: 0.078, sag: 0.05 },
      { x: 2.22, y: 3.62, radius: 0.04, sag: 0.02 },
    ],
    bracketEvery: 1.8,
  },

  benches: {
    depth: 0.9,
    height: 0.9,
    top: 0.045,
    shelf: 0.22,
    legEvery: 1.5,
    spans: [
      { side: 1, from: -127, to: -137.7 },
      { side: 1, from: -140.3, to: -146.6 },
      { side: -1, from: -127, to: -134.2 },
      { side: -1, from: -138.4, to: -146 },
    ],
  },

  /** Developing trays: size (m), and on the benches side, z, size (share), what lies in them. */
  trays: {
    width: 0.6,
    depth: 0.46,
    height: 0.075,
    /** The liquid's level as a share of the height, and how far the tray stands in from the wall. */
    level: 0.62,
    wallGap: 0.5,
    /** A print lying in a tray: size, and how much of its light comes through the liquid. */
    printScale: 3.1,
    printGain: 0.42,
    items: [
      { side: -1, z: -128.1, size: 1, frame: 0 },
      { side: -1, z: -129.7, size: 1.15, rat: true },
      { side: -1, z: -131.2, size: 1, frame: 2 },
      { side: 1, z: -128.3, size: 1, frame: 1 },
      { side: 1, z: -132.3, size: 1.1, frame: 3 },
      { side: 1, z: -134.2, size: 1, raven: true },
      { side: 1, z: -135.8, size: 1.05, frame: 4 },
      { side: 1, z: -137.05, size: 0.9, rat: true },
      { side: -1, z: -139.3, size: 1, frame: 5 },
      { side: -1, z: -140.9, size: 1.1, raven: true },
      { side: -1, z: -142.6, size: 1, frame: 6 },
      { side: -1, z: -144.6, size: 1.05, frame: 7 },
      { side: 1, z: -141.1, size: 1, frame: 5 },
      { side: 1, z: -142.9, size: 1.1, rat: true },
      { side: 1, z: -144.8, size: 1.05, frame: 7 },
    ],
    /** Size and sink of what lies dead in them: rat (length share of real size), raven (height). */
    rat: { scale: 2.4, sink: 0.03, triangles: 1600 },
    raven: { scale: 0.24, sink: 0.02 },
    enamel: { color: 0xc9c4ba, roughness: 0.32 },
    liquid: { color: 0x060302, roughness: 0.05 },
  },

  /**
   * The sloped sink where a face comes up: a thin sheet of liquid runs down a print. Its pan's center, the way
   * the slope faces, the print's size, and between which z of the eye the face rises (shadows first).
   */
  facePrint: {
    at: [-2.14, 1.2, -132.95] as V3,
    faces: [0.62, 0.62, 0.48] as V3,
    width: 0.86,
    height: 0.64,
    rise: [-125, -130.6] as const,
    /** Brightness of the paper under the safelight (albedo), its own faint glow, and how the picture's light reads as tone. */
    paper: 0.78,
    glow: 0.05,
    toneGain: 4.5,
    /** The thin stream that feeds it: where it leaves the pipe and its radius. */
    streamTop: 1.72,
    streamRadius: 0.0045,
  },

  /** The archive of blank faces: three shelves on the left wall. */
  heads: {
    fromZ: -139,
    perShelf: 10,
    spacing: 0.5,
    shelves: [1.72, 2.3, 2.88],
    shelfDepth: 0.37,
    scale: 0.3,
    color: 0xd9d3c6,
    roughness: 0.82,
    /** The scan is far too fine to draw thirty times: triangles kept of each. */
    triangles: 1300,
    /** At rest they look at someone this far up the corridor. */
    gazeAhead: 4.5,
    /** Behind your back they all turn to you, this often (s), when no end of the shelves is in view (margin, deg). */
    turnEvery: 0.35,
    turnMargin: 6,
  },

  /** The bellows camera in its recess, its lens following you. */
  camera: { at: [2.1, 0, -139] as V3, scale: 1.9, follow: 1.4, startYaw: -16, woodColor: 0x1c100a, woodRoughness: 0.55 },

  /** It fires once as you come level with it: one hit of white, and what the hit shows. */
  flash: {
    atZ: -137.5,
    /** Back up here it is armed again. */
    rearmZ: -131,
    light: [1.72, 1.65, -139] as V3,
    color: 0xfff1e6,
    intensity: 260,
    reach: 18,
    /** Rise, hold and fall (s). */
    attack: 0.025,
    hold: 0.05,
    fall: 0.42,
    /** Share of all that for visitors who ask for less motion. */
    reduced: 0.22,
    glow: { width: 2.4, height: 2.4, strength: 5 },
    /** Who stands there only while it lasts: off the path, ahead of the eye (m), for how long (s). */
    ghost: { x: -1.02, ahead: 4, seconds: 0.2 },
  },

  /** The film projector on a bench, throwing a figure onto the wall ahead across the corridor. */
  projector: {
    at: [2.16, 0.9, -130.4] as V3,
    scale: 1.7,
    /** Its lens, in the model's own space (it looks along +Z). */
    lens: [-0.064, 0.085, 0.145] as V3,
    nodes: [
      'filmstrip_projector_8mm',
      'filmstrip_projector_8mm_takeup_holder',
      'filmstrip_projector_8mm_spool_takeup',
      'filmstrip_projector_8mm_spool_feed',
      'filmstrip_projector_8mm_spool_arm',
      'filmstrip_projector_8mm_switch',
      'filmstrip_projector_8mm_dial_speed',
      'filmstrip_projector_8mm_dial_mode',
      'filmstrip_projector_8mm_focus',
      'filmstrip_projector_8mm_feed_roller',
      'filmstrip_projector_8mm_feed_holder',
      'filmstrip_projector_8mm_01_film_side',
      'filmstrip_projector_8mm_film',
    ],
    spools: ['filmstrip_projector_8mm_spool_takeup', 'filmstrip_projector_8mm_spool_feed'],
    /** Turns of the reels (rad / s). */
    spin: 1.3,
    /** The picture on the wall: center, width along the wall, height. Its figure's feet stand on the floor. */
    picture: { center: [-2.584, 1.25, -136.3] as V3, width: 1.75, height: 2.44 },
    /** The color of the bulb, the light it puts on a wall of albedo 1, and its density in the dusty air. */
    tint: 0xffdcc0,
    light: 1.25,
    density: 0.22,
    /** Slow irregular flicker (all well under 3 Hz): base, depth and rate of the wobble; rare drop-outs (rate, wobble range, depth). */
    flicker: { base: 0.82, depth: 0.16, rate: 1.7, dropRate: 0.42, drop: [0.5, 0.78] as const, dropDepth: 0.72 },
    /** The loop: poses per second (with a wobble), and how far the film jumps in its gate on each (share of half its height). */
    reel: { rate: 2.3, wander: 0.45, weave: 0.006, reduced: 0.6 },
    /** The pale light the wall gives back to the floor around it: place, strength, reach. */
    spill: { at: [-1.95, 0.95, -136.3] as V3, intensity: 3.4, reach: 3.3 },
    glow: { width: 0.7, height: 0.7, strength: 1.6 },
    /** Frames of the loop: the figure rolling its head (clip time, s). */
    poses: [0, 1, 2, 3, 4, 5, 6, 7],
  },

  /** The eight frames, along the corridor. */
  prints: {
    /** Size of a print against a real instant print. */
    heroScale: 7,
    /** The hanging ones are pegged to a line along each side at this x, and height. */
    lineX: 1.75,
    lineY: 2.075,
    /** They turn toward whoever approaches (rad). */
    turn: 35 * DEG,
    heroes: [
      { frame: 0, side: 1, z: -128 },
      { frame: 1, side: -1, z: -130.7 },
      { frame: 2, side: 1, z: -133.4 },
      { frame: 3, side: 1, z: -136.1 },
      { frame: 4, side: -1, z: -137.9 },
      { frame: 5, side: 1, z: -141.6 },
      { frame: 6, side: 1, z: -144.3 },
    ],
    /** The side lines: from the door's wall to this z, where they are tied off to the side wall. */
    lines: [
      { side: 1, to: -145 },
      { side: -1, to: -138.6 },
    ],
    /** Frame eight: four times the others, hung from high up at the end of the left wall (center of its top, and its turn). */
    last: { top: [-1.92, 3.42, -147] as V3, turn: 58 * DEG, scale: 28, pegsAt: [-0.85, 0.85] as const, dripsAt: [-0.7, 0.5] as const },
    /** Rows of the same frame across the corridor, overhead: one row per frame, where along the line their prints hang (alternately), how they wander. */
    rows: {
      z: [-127, -129.7, -132.4, -135.1, -137.8, -140.5, -143.2, -145.9],
      x: [
        [-2.05, -0.85, 0.42, 1.78],
        [-1.58, -0.32, 0.98, 2.12],
      ],
      wander: 0.12,
      wireY: 3.02,
      sag: 0.05,
      scale: 3.7,
      jitter: 9 * DEG,
      gain: 0.92,
    },
    /** A few pinned flat to the upper walls: side, z, frame. */
    pins: {
      y: 2.42,
      scale: 4.4,
      gain: 0.72,
      items: [
        { side: -1, z: -128.9, frame: 0 },
        { side: -1, z: -131.6, frame: 1 },
        { side: 1, z: -129.4, frame: 0 },
        { side: 1, z: -132, frame: 2 },
        { side: 1, z: -135.3, frame: 3 },
        { side: 1, z: -137.3, frame: 4 },
        { side: 1, z: -142.5, frame: 5 },
        { side: 1, z: -145.4, frame: 6 },
      ],
    },
    /** Peg jaws (width, length, thickness), rising over the print's top edge; their wood. */
    peg: { jaw: [0.018, 0.075, 0.006] as V3, above: 0.035, color: 0x6e5238, roughness: 0.8 },
    /** The lines. */
    wire: { radius: 0.0055, color: 0x0d0a09, roughness: 0.5 },
    /** The paper is wet: its roughness, wet and glossier where a drop has run. */
    roughness: 0.22,
    wetRoughness: 0.05,
    /** Share of the light it recorded that a print shows. */
    lit: 1.2,
    /** The image on every print's back (the face), dimmer: its share. */
    backLit: 1.4,
    /** The scratched-out mark on a frame: the emulsion's color, how much of it, smallest size (share of the image). */
    scratch: { color: [0.82, 0.76, 0.7] as V3, amount: 0.8, least: 0.02 },
    /** Each hanging print sways a little (rad of the swing) and a drop only shows this close (m, from .. to). */
    sway: 0.035,
    dropsSeen: [3, 10] as const,
    /** How the sheet curls: sides forward, belly (shares of its width). */
    curl: 0.05,
    belly: 0.03,
  },

  /** The reflections of the big prints on the floor: how much of their light. */
  printBelow: 0.75,

  /** Drops falling from what is wet: time between drops per source (from, to), size, gravity. */
  drops: {
    period: [2.6, 5.4] as const,
    radius: 0.0065,
    gravity: 9.8,
    stretch: 2.6,
    /** Falling from nowhere but the ceiling too (x, z). */
    fromCeiling: [
      [-0.62, -131.4],
      [0.38, -137.2],
      [-0.28, -142.9],
      [0.85, -147.6],
    ] as readonly (readonly [number, number])[],
    color: [0.8, 0.34, 0.3] as V3,
  },

  /** Rings where a drop lands. */
  ripple: { life: 1.5, speed: 0.34, frequency: 62, band: 90, decay: 2.2, strength: 0.42, glint: 0.05 },

  /** Portraits in fancy frames on the upper walls, scratched out by hand. */
  portraits: {
    scale: 1.35,
    bottom: 2.62,
    items: [
      { side: -1, z: -128, image: 0 },
      { side: -1, z: -130.1, image: 1 },
      { side: -1, z: -132.1, image: 2 },
      { side: -1, z: -134.7, image: 0 },
      { side: -1, z: -137.9, image: 1 },
      { side: 1, z: -128.2, image: 1 },
      { side: 1, z: -130.7, image: 2 },
      { side: 1, z: -134.4, image: 0 },
      { side: 1, z: -136.5, image: 2 },
      { side: 1, z: -141.7, image: 1 },
      { side: 1, z: -143.9, image: 0 },
    ],
    roughness: 0.55,
    /** So that they do not sink entirely into the dark. */
    glow: 0.24,
    scratchColor: [0.8, 0.75, 0.68] as V3,
  },

  /** A darkroom timer, stopped at half past. */
  clock: { at: [2.585, 2.85, -132.6] as V3, scale: 1.5, stoppedAt: 18.5 * 3600 },

  /**
   * The one from the pictures. It stands at the far end with its back to you, head fallen to one side. The
   * light that throws its shadow down the floor burns inside the mouth of the gullet behind it: higher
   * than its head (a lower light would only lay its shins on the floor) and far enough back for the
   * shadow to keep a human shape.
   */
  figure: {
    at: [1.7, -148.6] as const,
    spec: { avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 4.5, face: 'scratched' } as FigureSpec,
    /** Height of what is looked at. */
    headY: 1.65,
    light: {
      position: [2.48, 2.6, -153] as V3,
      target: [-0.3, 0, -139] as V3,
      color: RED,
      intensity: 1500,
      angle: 22,
      penumbra: 0.3,
    },
    /** A glow in the air behind it (it stands dark against this), and the light on the meat behind it. */
    glare: { at: [1.6, 1.9, -149.4] as V3, width: 2, height: 2.1, strength: 0.75 },
    glareBelow: { width: 1.9, height: 2.2, strength: 0.7 },
    backGlow: { at: [1.75, 1.5, -149.3] as V3, intensity: 11, reach: 5 },
    /** The light's slow unrest. */
    waver: { rate: 0.8, depth: 0.06 },
  },

  /** How it goes: once you are past frame eight and it has been out of view for an instant, it is gone. */
  vanish: {
    pastZ: -147.2,
    margin: 5,
    instant: 0.08,
    /** Stared at, the lights dip instead after this long (s), for this long, and it is gone when they come back. */
    patience: 1,
    dip: 0.9,
    /** How dark the lamps go at the bottom of the dip. */
    floor: 0.03,
  },

  /** And then it stands behind you, somewhere you have just passed, off the path; closer each time you have looked. */
  follow: {
    x: 1.15,
    margin: 6,
    gap: 5.5,
    step: 1.15,
    nearest: 1.9,
    /** Not further on than the corridor (it waits at the mouth), nor nearer the door than this. */
    lastZ: -149.2,
    firstZ: -127.4,
    /** Past frame eight's corner there is only room on the right. */
    rightOnlyFrom: -145.6,
    /** Only worth writing when it has fallen this far behind (m). */
    moveOver: 0.25,
    /** Back through the slit, it is at the far end again. */
    homeZ: -124.5,
  },

  /** Flesh coming through the tiles near the end: patches, and veins creeping up the corridor. */
  flesh: {
    repeat: 0.62,
    color: 0xb33a2e,
    roughness: 0.5,
    breathe: 0.022,
    patches: [
      { at: [HALF, 1.25, -149.45] as V3, n: [-1, 0, 0] as V3, t: [0, 0, 1] as V3, radius: 1.55, rise: 0.17 },
      { at: [HALF, 2.95, -148.9] as V3, n: [-1, 0, 0] as V3, t: [0, 0, 1] as V3, radius: 1.05, rise: 0.12 },
      { at: [HALF, 0.42, -147.95] as V3, n: [-1, 0, 0] as V3, t: [0, 0, 1] as V3, radius: 0.72, rise: 0.08 },
      { at: [-HALF, 1.95, -149.55] as V3, n: [1, 0, 0] as V3, t: [0, 0, 1] as V3, radius: 1.65, rise: 0.18 },
      { at: [-HALF, 0.5, -148.75] as V3, n: [1, 0, 0] as V3, t: [0, 0, 1] as V3, radius: 0.9, rise: 0.09 },
      { at: [-HALF, 3.05, -148.4] as V3, n: [1, 0, 0] as V3, t: [0, 0, 1] as V3, radius: 0.8, rise: 0.08 },
      { at: [1.15, CEILING, -149.45] as V3, n: [0, -1, 0] as V3, t: [1, 0, 0] as V3, radius: 1.35, rise: 0.15 },
      { at: [-1.25, CEILING, -149.15] as V3, n: [0, -1, 0] as V3, t: [1, 0, 0] as V3, radius: 1.1, rise: 0.11 },
    ],
    rings: 9,
    spokes: 30,
    /** The tongue that hides the floor's end: where it begins (with some wander) and how far it droops into the gullet. */
    lip: { fromZ: -148.9, wander: 0.45, toZ: -151.7, rise: 0.1, droop: 1.25 },
    /** Veins per wall, how far up the corridor they creep (z), their radius at the root and tip. */
    veins: { perWall: 5, reachZ: -145.6, radius: [0.016, 0.004] as const, points: 13, meander: 0.26, seed: 0x41e3 },
    seed: 0xf1e5,
  },

  /**
   * Far below the world, seen only while it is photographed: the same corridor, you from behind, and behind
   * you in the depth of the picture the other one, closer in every frame.
   */
  stage: {
    y: -300,
    cameraX: 0,
    cameraZ: -131,
    /** The lens leans this far across at 8 m. */
    lookAside: -0.05,
    resolution: 256,
    /** The last is four times the others: as many pixels per meter of print. */
    lastResolution: 512,
    /** Never 0: materials that show these pictures are bound while each is taken, and a multisampled target is not the texture it resolves to. */
    samples: 2,
    /** From this frame on your white hair has grown long. */
    veilFrom: 4,
    /** Where a face is, on a body (m), and how large its scratched-out mark is around it (half size, m). */
    faceY: 1.66,
    scratchSize: 0.17,
    /** The red lamps as in the corridor, the flash at the lens and a pale light that goes with the other one (reach, height, ahead of it). */
    flashColor: 0xfff1e6,
    flashReach: 16,
    keyColor: 0xffe3d6,
    keyReach: 3.4,
    keyY: 1.98,
    keyAhead: 0.85,
    /** Per frame: lens height, field of view; you (x, how far ahead of the lens); it (x, how far behind you, its turn, clip, time); flash and pale light. */
    frames: [
      { eye: 1.54, fov: 46, foreX: -0.16, foreAhead: 1.05, x: 1.19, behind: 14.5, turn: 0, time: 0, flash: 3.2, key: 1.7 },
      { eye: 1.54, fov: 46, foreX: -0.16, foreAhead: 1.05, x: 0.95, behind: 10.4, turn: 0, time: 0.35, flash: 3.2, key: 1.6 },
      { eye: 1.54, fov: 46, foreX: -0.16, foreAhead: 1.05, x: 0.72, behind: 7.4, turn: 0, time: 0.7, flash: 3.2, key: 1.4 },
      { eye: 1.54, fov: 46, foreX: -0.16, foreAhead: 1.05, x: 0.6, behind: 5.2, turn: 0, time: 1.05, flash: 3.2, key: 1.2 },
      { eye: 1.54, fov: 46, foreX: -0.16, foreAhead: 1.05, x: 0.5, behind: 3.6, turn: 0, time: 1.4, flash: 3.2, key: 1 },
      { eye: 1.54, fov: 46, foreX: -0.16, foreAhead: 1.05, x: 0.44, behind: 2.4, turn: 0, time: 1.75, flash: 3.2, key: 0.8 },
      { eye: 1.54, fov: 46, foreX: -0.16, foreAhead: 1.05, x: 0.42, behind: 1.35, turn: 0, time: 2.1, flash: 3.2, key: 0.55 },
      // over the shoulder: the head turned away and the body turned back, so the face is square to the lens
      { eye: 1.57, fov: 34, foreX: -0.17, foreAhead: 0.82, x: 0.27, behind: 0.42, turn: 0.72, time: -1.7, flash: 2.2, key: 0.3 },
    ],
    /** The walk it comes closer with; a negative time above means this idle clip instead. */
    walkClip: 'm_walk_bruised',
    idleClip: 'm_idle_roll_head_01',
    /** A black room for portraits and the projector's loop. */
    studioY: -340,
    /** Sitters for the portraits (the first is also the face that rises, and is on every print's back). */
    sitters: [
      { avatar: 'figure_man', clip: 'm_idle_roll_head_01', time: 0.3, face: 'scratched' },
      { avatar: 'figure_woman', clip: 'f_idle_touch_hair_01', time: 0, face: 'scratched' },
      { avatar: 'figure_nurse', clip: 'f_idle_touch_hair_01', time: 0, face: 'scratched' },
    ] as FigureSpec[],
    /** Distance, field of view; how far under the crown the lens looks; the light (offset from the lens' subject, intensity). */
    portrait: { distance: 0.95, fov: 30, under: 0.17, light: [0.45, 0.28, 0.85] as V3, intensity: 1.6 },
    closeUp: { distance: 0.52, fov: 30, under: 0.14, intensity: 1.1 },
    /** The figure in the projector's loop: frame size (px), and the lens far away in front of it. */
    loop: { width: 128, height: 256, distance: 10, fov: 14, center: 1.2 },
  },
} as const;

const C = darkroomConfig;

// ------------------------------------------------------------------ shaders

/** Rings the floor can show at once: one per source of drops. */
const RIPPLES = C.prints.heroes.length + C.prints.last.dripsAt.length + C.drops.fromCeiling.length;

const f = (v: number): string => v.toFixed(5);

const NOISE_GLSL = /* glsl */ `
float dkHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float dkNoise(vec2 p) {
  vec2 i = floor(p), u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(dkHash(i), dkHash(i + vec2(1.0, 0.0)), u.x), mix(dkHash(i + vec2(0.0, 1.0)), dkHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

const FLOOR_PARS = /* glsl */ `
varying vec2 vFloor;
uniform vec4 uRipple[${RIPPLES}];
${NOISE_GLSL}
float floorWetness(vec2 p) {
  float n = dkNoise(p * 0.55) * 0.65 + dkNoise(p * 1.7 + 7.3) * 0.35;
  return smoothstep(0.36, 0.62, n);
}
vec2 floorRipples(vec2 p) {
  vec2 g = vec2(0.0);
  for (int i = 0; i < ${RIPPLES}; i++) {
    vec4 r = uRipple[i];
    if (r.w <= 0.0) continue;
    vec2 d = p - r.xy;
    float dist = length(d);
    float w = dist - r.z * ${f(C.ripple.speed)};
    g += d / max(dist, 0.001) * sin(w * ${f(C.ripple.frequency)}) * exp(-w * w * ${f(C.ripple.band)}) * r.w * exp(-r.z * ${f(C.ripple.decay)});
  }
  return g;
}
`;

/** Paper in shares of the print's own width and height: where its image lies. */
const IMAGE_U = (print.width - image.size) / 2 / print.width;
const IMAGE_DU = image.size / print.width;
const IMAGE_DV = image.size / print.height;
const IMAGE_V = 1 - image.offsetFromTop / print.height - IMAGE_DV;
/** Frames numbered in pencil on the white band under the image. */
const CAPTION_CELLS = 8;

const PRINT_VERTEX_PARS = /* glsl */ `
attribute vec2 aPrint;
varying vec2 vCard;
varying vec3 vCardT;
varying vec3 vCardB;
varying float vGain;
varying float vSize;
uniform float uClock;
`;

const PRINT_VERTEX = /* glsl */ `
vCard = uv;
vGain = aPrint.y;
vec3 cardAt = instanceMatrix[3].xyz;
vSize = length(instanceMatrix[0].xyz);
mat3 cardBasis = mat3(instanceMatrix);
vCardT = normalize(normalMatrix * (cardBasis * vec3(1.0, 0.0, 0.0)));
vCardB = normalize(normalMatrix * (cardBasis * vec3(0.0, 1.0, 0.0)));
// hung from its top edge: never in step with the print next to it
float cardSwing = aPrint.x * ${f(C.prints.sway)} * (sin(uClock * 0.7 + cardAt.z * 1.3 + cardAt.x * 2.1) * 0.75 + sin(uClock * 1.63 + cardAt.z * 2.9) * 0.25);
transformed.z += transformed.y * cardSwing;
`;

const PRINT_PARS = /* glsl */ `
varying vec2 vCard;
varying vec3 vCardT;
varying vec3 vCardB;
varying float vGain;
varying float vSize;
uniform sampler2D tPicture;
uniform sampler2D tBack;
uniform sampler2D tScratch;
uniform sampler2D tCaption;
uniform vec3 uScratch;
uniform float uCell;
uniform float uClock;
uniform float uLit;
float wetHash(float x) { return fract(sin(x * 91.17) * 47453.5453); }
// a column of slow drops running down the paper: p in meters (y up); the surface's slope (xy) and its wetness (z)
vec3 runnels(vec2 p, float cell, float t, float seed) {
  float col = floor(p.x / cell);
  float h = wetHash(col + seed);
  float span = mix(0.35, 0.8, wetHash(col + seed + 3.7));
  float s = t * mix(0.012, 0.045, wetHash(col + seed + 7.1)) + h * 9.0;
  // they stick and slip
  s += 0.01 * sin(s * 31.0 + h * 6.28);
  float above = fract((p.y + s) / span) * span;
  float up = above < span * 0.5 ? above : above - span;
  vec2 d = vec2(p.x - (col + 0.5 + (h - 0.5) * 0.5) * cell, up);
  float r = mix(0.007, 0.013, h);
  float head = 1.0 - smoothstep(0.55, 1.0, length(d * vec2(1.0, 0.72)) / r);
  float trail = (1.0 - smoothstep(0.0015, 0.004, abs(d.x))) * step(0.0, up) * (1.0 - smoothstep(0.0, span * 0.45, up));
  return vec3(d / r * head, max(head, trail));
}
`;

const PRINT_FRAGMENT = /* glsl */ `
vec2 cardP = vec2((vCard.x - 0.5) * ${f(print.width)}, (vCard.y - 1.0) * ${f(print.height)}) * vSize;
float cardNear = 1.0 - smoothstep(${f(C.prints.dropsSeen[0])}, ${f(C.prints.dropsSeen[1])}, length(vViewPosition));
vec3 cardWet = vec3(0.0);
if (cardNear > 0.0) cardWet = (runnels(cardP, 0.11, uClock, 0.0) + runnels(cardP, 0.17, uClock, 19.0)) * cardNear;
vec2 cardImg = (vCard - vec2(${f(IMAGE_U)}, ${f(IMAGE_V)})) / vec2(${f(IMAGE_DU)}, ${f(IMAGE_DV)});
vec2 cardEdge = fwidth(cardImg);
float onImage = smoothstep(-cardEdge.x, cardEdge.x, cardImg.x) * smoothstep(-cardEdge.x, cardEdge.x, 1.0 - cardImg.x)
  * smoothstep(-cardEdge.y, cardEdge.y, cardImg.y) * smoothstep(-cardEdge.y, cardEdge.y, 1.0 - cardImg.y);
vec3 printLight = vec3(0.0);
if (gl_FrontFacing) {
  vec2 cardAt = cardImg + cardWet.xy * 0.012;
  vec3 picture = texture2D(tPicture, cardAt).rgb;
  // someone has scratched the other one's head out of the emulsion
  vec2 cut = (cardAt - uScratch.xy) / uScratch.z * 0.5 + 0.5;
  float scratched = texture2D(tScratch, cut).r * step(0.0, cut.x) * step(cut.x, 1.0) * step(0.0, cut.y) * step(cut.y, 1.0);
  picture = mix(picture, vec3(${f(C.prints.scratch.color[0])}, ${f(C.prints.scratch.color[1])}, ${f(C.prints.scratch.color[2])}), scratched * ${f(C.prints.scratch.amount)});
  picture *= (1.0 - cardWet.z * 0.18) * (1.0 + length(cardWet.xy) * 0.6);
  printLight = picture * uLit * vGain * onImage;
  float ink = vCard.y < ${f(IMAGE_V)} ? texture2D(tCaption, vec2((uCell + vCard.x) / ${f(CAPTION_CELLS)}, vCard.y / ${f(IMAGE_V)})).r : 0.0;
  diffuseColor.rgb = mix(vec3(0.72, 0.7, 0.66) * (1.0 - ink * 0.9), vec3(0.02), onImage);
} else {
  // turn around: every one of them has the same face on its back
  printLight = texture2D(tBack, vec2(1.0 - cardImg.x, cardImg.y)).rgb * uLit * vGain * onImage * ${f(C.prints.backLit)};
  diffuseColor.rgb = vec3(0.02);
}
`;

const PLATE_PARS = /* glsl */ `
varying vec2 vPlate;
varying vec3 vPlateT;
varying vec3 vPlateB;
uniform sampler2D tFace;
uniform float uRise;
uniform float uClock;
${NOISE_GLSL}
`;

const PLATE_FRAGMENT = /* glsl */ `
vec2 plateFlow = vec2(dkNoise(vPlate * vec2(9.0, 5.0) + vec2(0.0, uClock * 0.55)), dkNoise(vPlate * vec2(7.0, 4.0) + vec2(4.0, uClock * 0.43))) - 0.5;
float plateTone = clamp(dot(texture2D(tFace, vPlate + plateFlow * 0.014).rgb, vec3(0.333)) * ${f(C.facePrint.toneGain)}, 0.0, 1.0);
// on paper the shadows come up first, the rest after them, unevenly
float plateRisen = smoothstep(0.0, 1.0, uRise * (1.0 + (1.0 - plateTone) * 1.7) - 0.15 * dkNoise(vPlate * 4.0));
float plateSheet = mix(1.0, plateTone, plateRisen);
diffuseColor.rgb = vec3(plateSheet * ${f(C.facePrint.paper)});
`;

const GLOW_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${WARP_GLSL}
varying vec2 vOffset;
varying vec3 vGlow;
void main() {
  vGlow = instanceColor;
  vOffset = position.xy * 2.0;
  vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mvPosition.xy += position.xy * size;
  gl_Position = projectionMatrix * dreamWarp(mvPosition);
  #include <fog_vertex>
}
`;

const GLOW_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
varying vec2 vOffset;
varying vec3 vGlow;
void main() {
  float r2 = dot(vOffset, vOffset);
  if (r2 >= 1.0) discard;
  // light scattered by the haze, brought down to nothing at the quad's edge
  float glow = (1.0 / (1.0 + r2 * 16.0) - 1.0 / 17.0) * 17.0 / 16.0;
  gl_FragColor = vec4(vGlow * glow * exp(-fogDensity * fogDensity * vFogDepth * vFogDepth), 1.0);
}
`;

/** What the beam and its picture on the wall both know: the lens, the beam's axes, the gate. */
const GATE_PARS = /* glsl */ `
uniform vec3 uLens;
uniform vec3 uAxisU;
uniform vec3 uAxisV;
uniform vec3 uAxisW;
uniform vec2 uGate;
uniform float uJump;
uniform float uGain;
uniform vec3 uTint;
uniform sampler2D tLoop;
`;

const BEAM_VERT = /* glsl */ `
${WARP_GLSL}
varying vec3 vP;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vP = world.xyz;
  gl_Position = projectionMatrix * dreamWarp(viewMatrix * world);
}
`;

const BEAM_FRAG = /* glsl */ `
#include <common>
uniform float fogDensity;
uniform float uDensity;
uniform float uClock;
${GATE_PARS}
varying vec3 vP;
void cut(float a, float b, inout float t0, inout float t1) {
  if (abs(b) < 1e-5) { if (a > 0.0) t1 = -1.0; return; }
  float t = -a / b;
  if (b > 0.0) t1 = min(t1, t); else t0 = max(t0, t);
}
void main() {
  vec3 ro = cameraPosition - uLens;
  vec3 rd = vP - cameraPosition;
  float t1 = length(rd);
  rd /= t1;
  vec3 o = vec3(dot(uAxisU, ro), dot(uAxisV, ro), dot(uAxisW, ro));
  vec3 d = vec3(dot(uAxisU, rd), dot(uAxisV, rd), dot(uAxisW, rd));
  float t0 = 0.0;
  // what of this line of sight lies inside the pyramid of light
  cut(o.x - uGate.x * o.z, d.x - uGate.x * d.z, t0, t1);
  cut(-o.x - uGate.x * o.z, -d.x - uGate.x * d.z, t0, t1);
  cut(o.y - uGate.y * o.z, d.y - uGate.y * d.z, t0, t1);
  cut(-o.y - uGate.y * o.z, -d.y - uGate.y * d.z, t0, t1);
  cut(-o.z, -d.z, t0, t1);
  if (t1 <= t0) discard;
  float step_ = (t1 - t0) * 0.25;
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float sum = 0.0;
  for (int i = 0; i < 4; i++) {
    vec3 q = o + d * (t0 + (float(i) + jitter) * step_);
    vec2 g = q.xy / (uGate * max(q.z, 0.02));
    // the figure on the film stands in the beam as a long shadow
    float blocked = texture2D(tLoop, vec2(g.x, g.y + uJump) * 0.5 + 0.5).r;
    float edge = (1.0 - smoothstep(0.82, 1.0, abs(g.x))) * (1.0 - smoothstep(0.9, 1.0, abs(g.y)));
    float dust = 0.72 + 0.28 * sin(q.x * 41.0 + uClock * 0.4) * sin(q.y * 37.0 - uClock * 0.27) * sin(q.z * 23.0 + uClock * 0.33);
    sum += edge * (1.0 - blocked) * dust / (1.0 + q.z * q.z * 0.12);
  }
  float seen = (t0 + t1) * 0.5;
  gl_FragColor = vec4(uTint * sum * step_ * uDensity * uGain * exp(-fogDensity * fogDensity * seen * seen), 1.0);
}
`;

const PICTURE_VERT = /* glsl */ `
#include <fog_pars_vertex>
${WARP_GLSL}
varying vec3 vP;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vP = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * dreamWarp(mvPosition);
  #include <fog_vertex>
}
`;

const PICTURE_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uLight;
uniform float uClock;
uniform sampler2D tTile;
uniform sampler2D tPaint;
uniform vec4 uWall;
${GATE_PARS}
varying vec3 vP;
void main() {
  // its reflection in the floor is the same picture, seen from under the floor
  vec3 p = vec3(vP.x, abs(vP.y), vP.z);
  vec3 o = p - uLens;
  vec3 q = vec3(dot(uAxisU, o), dot(uAxisV, o), dot(uAxisW, o));
  vec2 g = q.xy / (uGate * q.z);
  float edge = (1.0 - smoothstep(0.88, 1.0, abs(g.x))) * (1.0 - smoothstep(0.95, 1.0, abs(g.y)));
  if (edge <= 0.0) discard;
  vec2 u = vec2(g.x, g.y + uJump) * 0.5 + 0.5;
  float blocked = texture2D(tLoop, u).r;
  // old film: a scratch or two down its length
  float line = sin(u.x * 91.0 + floor(uClock * 2.0) * 7.3) * sin(u.x * 37.0 - floor(uClock * 1.3) * 3.1);
  float film = 0.9 + 0.1 * smoothstep(0.86, 0.98, line);
  // light does not lie on a wall: it shows what the wall is
  vec2 wall = vec2(uWall.x - p.z, p.y);
  vec3 wallColor = p.y < uWall.y ? texture2D(tTile, wall / uWall.z).rgb : texture2D(tPaint, wall / uWall.w).rgb;
  vec3 c = uTint * wallColor * edge * film * (1.0 - blocked * 0.97) * uGain * uLight;
  gl_FragColor = vec4(c * exp(-fogDensity * fogDensity * vFogDepth * vFogDepth), 1.0);
}
`;

// ------------------------------------------------------------------ geometry

const UP = new Vector3(0, 1, 0);
const UNIT = new Vector3(1, 1, 1);
const NOWHERE = new Matrix4().makeScale(0, 0, 0);
const v1 = new Vector3();
const v2 = new Vector3();
const m1 = new Matrix4();
const q1 = new Quaternion();
const c1 = new Color();

/** Tubes are cut this often along their length, to bend. */
const TUBE_STEP = 0.65;

function boxPart(w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry {
  const seg = (s: number) => Math.max(1, Math.ceil(s / BEND_STEP));
  return meterUVs(new BoxGeometry(w, h, d, seg(w), seg(h), seg(d)).translate(x, y, z));
}

function tubePart(points: Vector3[], radius: number, sides = 6): BufferGeometry {
  const curve = new CatmullRomCurve3(points);
  const length = curve.getLength();
  const tube = new TubeGeometry(curve, Math.max(2, Math.ceil(length / TUBE_STEP)), radius, sides);
  const uv = tube.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * length, uv.getY(i) * Math.PI * 2 * radius);
  tube.setAttribute('uv1', uv.clone());
  return tube;
}

/** A line sagging between two points. */
function wirePart(a: Vector3, b: Vector3, sag: number, radius: number): BufferGeometry {
  const points: Vector3[] = [];
  const samples = Math.max(4, Math.ceil(a.distanceTo(b) / TUBE_STEP));
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = new Vector3().lerpVectors(a, b, t);
    p.y -= sag * 4 * t * (1 - t);
    points.push(p);
  }
  return tubePart(points, radius, 4);
}

/** A rounded rectangle on the floor plane (x, z), going around so that a fan over it faces up. */
function outline(w: number, d: number, r: number): [number, number][] {
  const STEPS = 4;
  const points: [number, number][] = [];
  const hx = w / 2 - r;
  const hz = d / 2 - r;
  [[hx, hz], [-hx, hz], [-hx, -hz], [hx, -hz]].forEach(([cx, cz], corner) => {
    for (let i = 0; i <= STEPS; i++) {
      const a = ((corner + i / STEPS) * Math.PI) / 2;
      points.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  });
  return points;
}

/** A shallow developing tray, standing on y = 0: rounded corners, a rolled rim, a sloping wall. */
function trayGeometry(w: number, d: number, h: number): BufferGeometry {
  const WALL = 0.009;
  const SLOPE = 0.012;
  const RADIUS = 0.04;
  const rings: readonly (readonly [number, number])[] = [
    [SLOPE, 0],
    [0, h],
    [WALL, h + 0.003],
    [WALL + SLOPE, 0.006],
  ];
  const positions: number[] = [];
  for (const [inset, y] of rings) {
    for (const [x, z] of outline(w - inset * 2, d - inset * 2, Math.max(0.005, RADIUS - inset))) positions.push(x, y, z);
  }
  const n = positions.length / 3 / rings.length;
  const index: number[] = [];
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * n + i;
      const b = j * n + ((i + 1) % n);
      index.push(a, a + n, b, b, a + n, b + n);
    }
  }
  const last = (rings.length - 1) * n;
  for (let i = 2; i < n; i++) index.push(last, last + i, last + i - 1);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** The dark surface inside a tray, at height y. */
function liquidGeometry(w: number, d: number, y: number): BufferGeometry {
  const INSET = 0.016;
  const positions: number[] = [];
  const normals: number[] = [];
  const points = outline(w - INSET * 2, d - INSET * 2, 0.03);
  for (const [x, z] of points) {
    positions.push(x, y, z);
    normals.push(0, 1, 0);
  }
  const index: number[] = [];
  for (let i = 2; i < points.length; i++) index.push(0, i, i - 1);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setIndex(index);
  return g;
}

/** A wet sheet of paper hanging from its top edge, the size of a real instant print (the origin is the middle of its top edge). */
function cardGeometry(): BufferGeometry {
  const g = new PlaneGeometry(print.width, print.height, 6, 8).translate(0, -print.height / 2, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const across = p.getX(i) / (print.width / 2);
    const down = -p.getY(i) / print.height;
    p.setZ(i, print.width * (C.prints.curl * across * across * (0.25 + 0.75 * down) + C.prints.belly * down * down));
  }
  g.computeVertexNormals();
  return g;
}

/** A body of flesh pushing out of a surface: a lumpy dome with an irregular rim buried in the surface. */
function fleshPatch(at: V3, n: V3, t: V3, radius: number, rise: number, random: () => number): BufferGeometry {
  const { rings, spokes } = C.flesh;
  const normal = new Vector3(...n);
  const tangent = new Vector3(...t);
  const bi = new Vector3().crossVectors(normal, tangent);
  // on walls the rim must clear the tile, which stands proud of the paint
  const center = new Vector3(...at).addScaledVector(normal, Math.abs(n[1]) > 0.5 ? 0 : C.surfaces.tile.proud);
  const phase = [random() * 6.28, random() * 6.28, random() * 6.28, random() * 6.28];
  const edge = (a: number) => radius * (0.74 + 0.16 * Math.sin(a * 2 + phase[0]) + 0.1 * Math.sin(a * 5 + phase[1]) + 0.05 * Math.sin(a * 11 + phase[2]));
  const positions: number[] = [];
  const uvs: number[] = [];
  const risen: number[] = [];
  const put = (x: number, y: number, h: number) => {
    const p = v1.copy(center).addScaledVector(tangent, x).addScaledVector(bi, y).addScaledVector(normal, h);
    positions.push(p.x, p.y, p.z);
    uvs.push(x + phase[3], y + phase[0]);
    risen.push(Math.max(0, h / rise));
  };
  put(0, 0, rise * 1.1);
  for (let j = 1; j <= rings; j++) {
    const r = j / rings;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const x = Math.cos(a) * r * edge(a);
      const y = Math.sin(a) * r * edge(a);
      const dome = Math.pow(Math.max(0, 1 - r * r), 0.6);
      const lumps = 1 + 0.35 * Math.sin(x * 6.3 + phase[1]) * Math.sin(y * 7.1 + phase[2]) + 0.22 * Math.sin(x * 15 + phase[3]) * Math.sin(y * 13 + phase[0]);
      put(x, y, j === rings ? -0.014 : rise * dome * lumps);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < spokes; i++) index.push(0, 1 + i, 1 + ((i + 1) % spokes));
  for (let j = 0; j < rings - 1; j++) {
    for (let i = 0; i < spokes; i++) {
      const a = 1 + j * spokes + i;
      const b = 1 + j * spokes + ((i + 1) % spokes);
      index.push(a, a + spokes, b + spokes, a, b + spokes, b);
    }
  }
  return fleshBuffers(positions, uvs, risen, index);
}

/** The tongue of meat that lies over the floor's end and droops into the gullet. */
function fleshLip(random: () => number): BufferGeometry {
  const L = C.flesh.lip;
  const COLS = 18;
  const ROWS = 12;
  const phase = [random() * 6.28, random() * 6.28, random() * 6.28];
  const positions: number[] = [];
  const uvs: number[] = [];
  const risen: number[] = [];
  for (let j = 0; j <= ROWS; j++) {
    const s = j / ROWS;
    for (let i = 0; i <= COLS; i++) {
      const x = lerp(-HALF - 0.15, HALF + 0.15, i / COLS);
      const from = L.fromZ + L.wander * (Math.sin(x * 1.9 + phase[0]) * 0.6 + Math.sin(x * 4.3 + phase[1]) * 0.4);
      const z = lerp(from, L.toZ, s);
      const lumps = 1 + 0.4 * Math.sin(x * 5.3 + phase[2]) * Math.sin(z * 4.7 + phase[0]);
      const h = s < 0.6 ? L.rise * Math.sin((s / 0.6) * Math.PI) * lumps - 0.006 : (-(s - 0.6) / 0.4) * L.droop;
      positions.push(x, h, z);
      uvs.push(x, z);
      risen.push(s < 0.6 ? Math.max(0, h / L.rise) : 0);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const a = j * (COLS + 1) + i;
      index.push(a, a + 1, a + COLS + 1, a + 1, a + COLS + 2, a + COLS + 1);
    }
  }
  return fleshBuffers(positions, uvs, risen, index);
}

function fleshBuffers(positions: number[], uvs: number[], risen: number[], index: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setAttribute('uv1', new Float32BufferAttribute(uvs, 2));
  g.setAttribute('aRise', new Float32BufferAttribute(risen, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A vein along a surface: a thin tube narrowing to its tip, half sunk. */
function fleshVein(points: readonly Vector3[], outward: Vector3): BufferGeometry {
  const SIDES = 5;
  const [r0, r1] = C.flesh.veins.radius;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const risen: number[] = [];
  const along = new Vector3();
  const side = new Vector3();
  const normal = new Vector3();
  let length = 0;
  points.forEach((p, i) => {
    const r = lerp(r0, r1, i / (points.length - 1));
    along.subVectors(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)]).normalize();
    side.crossVectors(along, outward).normalize();
    if (i > 0) length += p.distanceTo(points[i - 1]);
    for (let j = 0; j < SIDES; j++) {
      const a = (j / SIDES) * Math.PI * 2;
      normal.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(outward, Math.sin(a));
      positions.push(p.x + normal.x * r, p.y + normal.y * r, p.z + normal.z * r);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(length, a * r);
      risen.push(0.35);
    }
  });
  const index: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = 0; j < SIDES; j++) {
      const a = i * SIDES + j;
      const b = i * SIDES + ((j + 1) % SIDES);
      index.push(a, a + SIDES, b, a + SIDES, b + SIDES, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setAttribute('uv1', new Float32BufferAttribute(uvs, 2));
  g.setAttribute('aRise', new Float32BufferAttribute(risen, 1));
  g.setIndex(index);
  return g;
}

/**
 * Keep only `triangles` of a model (for some it would cost more than the whole corridor): every mesh
 * given goes over to the lighter copy as soon as the simplifier has loaded, long before anyone gets here.
 */
function slim(meshes: readonly Mesh[], triangles: number): void {
  const source = meshes[0].geometry;
  const index = source.getIndex();
  if (!index) return;
  // quantized and maybe interleaved in the file: plain floats for the simplifier, whose copies assume them
  const plain = new BufferGeometry();
  for (const name of Object.keys(source.attributes)) {
    const a = source.getAttribute(name);
    const values = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) {
      values[i * a.itemSize] = a.getX(i);
      if (a.itemSize > 1) values[i * a.itemSize + 1] = a.getY(i);
      if (a.itemSize > 2) values[i * a.itemSize + 2] = a.getZ(i);
    }
    plain.setAttribute(name, new BufferAttribute(values, a.itemSize));
  }
  plain.setIndex(index.clone());
  const vertices = source.getAttribute('position').count;
  const remove = Math.max(0, Math.round(vertices * (1 - triangles / (index.count / 3))));
  // should it ever fail, the model simply stays whole
  void new SimplifyModifier().modify(plain, remove).then(
    (lean) => {
      for (const mesh of meshes) mesh.geometry = lean;
    },
    () => undefined,
  );
}

// ------------------------------------------------------------------ small pictures

/** Strokes of a nail through an emulsion: white on black, thickest around the middle. */
function scratchTexture(): CanvasTexture {
  const SIZE = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.lineCap = 'round';
  const random = randomFrom(0x5c2a7);
  for (let n = 0; n < 90; n++) {
    const a = random() * Math.PI * 2;
    const r = random() ** 1.4 * SIZE * 0.3;
    const x = SIZE / 2 + Math.cos(a) * r;
    const y = SIZE / 2 + Math.sin(a) * r;
    const dir = -1 + random() * 0.7 + (random() < 0.3 ? 1.5 : 0);
    const length = SIZE * (0.12 + random() * 0.38);
    ctx.strokeStyle = `rgba(255,255,255,${0.35 + random() * 0.65})`;
    ctx.lineWidth = 0.6 + random() * random() * 4.5;
    ctx.beginPath();
    ctx.moveTo(x - (Math.cos(dir) * length) / 2, y - (Math.sin(dir) * length) / 2);
    ctx.lineTo(x + (Math.cos(dir) * length) / 2, y + (Math.sin(dir) * length) / 2);
    ctx.stroke();
  }
  // nothing reaches the edge of the mark
  const fade = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.3, SIZE / 2, SIZE / 2, SIZE * 0.5);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  return texture;
}

/** The frames' numbers, in pencil: one cell per frame. */
function captionTexture(): CanvasTexture {
  const CELL = 128;
  const canvas = document.createElement('canvas');
  canvas.width = CELL * CAPTION_CELLS;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.font = '40px "Just Me Again Down Here", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let k = 0; k < CAPTION_CELLS; k++) ctx.fillText(String(k + 1), CELL * (k + 0.74), 25);
  return new CanvasTexture(canvas);
}

/** Roughness of brushed steel: fine lines along z. */
function brushedSteel(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 8;
  const ctx = canvas.getContext('2d')!;
  const random = randomFrom(0x57e1);
  for (let x = 0; x < canvas.width; x++) {
    const v = Math.round(110 + random() * 110);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, 0, 1, canvas.height);
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.setScalar(1 / C.surfaces.steel.brushed);
  return texture;
}

/** How high a body stands, in the crowd's own space (m). */
function crownOf(crowd: Crowd): number {
  let top = 0;
  crowd.root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    top = Math.max(top, mesh.geometry.boundingBox!.max.y);
  });
  return top;
}

/** A body as one flat color, without the cards of its hair (only their outline would remain). */
function flatBody(crowd: Crowd, material: Material): void {
  crowd.root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    if (/opacity/.test((mesh.material as Material).name)) mesh.visible = false;
    mesh.material = material;
  });
}

function meshesOf(root: Object3D): Mesh[] {
  const list: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) list.push(o as Mesh);
  });
  return list;
}

/** One drop's life: it swells on what it hangs from, falls, and leaves rings where it lands. */
interface Drip {
  x: number;
  top: number;
  z: number;
  period: number;
  offset: number;
  swell: number;
  fall: number;
}

/** A print placed somewhere: its pose, how much it sways, how bright it is. */
interface Placed {
  matrix: Matrix4;
  sway: number;
  gain: number;
}

type FigurePlace = 'end' | 'behind';

/**
 * Chapter V: a very long institutional darkroom in safelight red. Steel benches, trays with dead things
 * in them, an archive of blank plaster heads, a film of someone standing, thrown on the wall by a
 * projector. Along the way hang wet prints of you from behind, and with every frame the one behind you
 * in the picture is a step closer. At the far end it stands in the flesh, with its back to you, its
 * shadow on the floor reaching your feet. When you have gone past the last frame it is not there any
 * more. It is where you have just been.
 */
export class Darkroom implements DreamModule {
  readonly root = new Group();
  readonly span = [LAYOUT.darkroom.from, LAYOUT.darkroom.to] as const;
  readonly region = 'darkroom' as const;
  /** Which of the two like lights comes first is what makes the director draw its shadow map once more. */
  readonly spots: (SpotSpec | null)[];

  private readonly kit: DreamKit;
  private readonly shell = new Group();
  private readonly below = new Group();
  private readonly stage = new Group();
  private readonly studio = new Group();
  private readonly steelParts: BufferGeometry[] = [];
  /** Prints lying in trays, waiting for the batch their picture belongs to. */
  private readonly pendingTrayPrints: { frame: number; x: number; y: number; z: number; yaw: number }[] = [];

  private readonly surfaces: { tile: MeshStandardMaterial; paint: MeshStandardMaterial; steel: MeshStandardMaterial };

  // pictures taken once, in develop()
  private readonly lens = new PerspectiveCamera(46, 1, renderConfig.near, renderConfig.far);
  private readonly frames: WebGLRenderTarget[];
  private readonly portraits: WebGLRenderTarget[];
  private readonly face: WebGLRenderTarget;
  private readonly loop: WebGLRenderTarget[];
  private readonly scratchAt: Vector3[] = [];
  /** A scratched-out head, drawn once and shared. */
  private readonly scratchTexture = scratchTexture();

  // what the shaders share
  private readonly uClock = { value: 0 };
  private readonly uLit = { value: C.prints.lit as number };
  private readonly uBeat = { value: 0 };
  private readonly uRise = { value: 0 };
  private readonly uRipple = { value: Array.from({ length: RIPPLES }, () => new Vector4()) };
  private readonly beam = {
    uLens: { value: new Vector3() },
    uAxisU: { value: new Vector3() },
    uAxisV: { value: new Vector3() },
    uAxisW: { value: new Vector3() },
    uGate: { value: new Vector2() },
    uJump: { value: 0 },
    uGain: { value: C.projector.flicker.base as number },
    uTint: { value: new Color(C.projector.tint) },
    tLoop: { value: null as Texture | null },
    uClock: this.uClock,
  };

  // the room's life
  private readonly lamps: { light: DreamLight; material: MeshStandardMaterial; object: Object3D }[] = [];
  private readonly spill: DreamLight;
  private readonly backGlow: DreamLight;
  private readonly flashLight: DreamLight;
  private readonly halos: InstancedMesh;
  private readonly halosBelow: InstancedMesh;
  private readonly droplets: InstancedMesh;
  /** The room and the prints in the floor: they have no lights to follow when the lights dip. */
  private readonly belowDims: { material: MeshBasicMaterial; full: number }[] = [];
  private readonly drips: Drip[] = [];
  private readonly spools: Object3D[] = [];
  private readonly heads: PropCrowd;
  private readonly headAt: Vector3[] = [];
  /** Both ends of the shelves and their middle: all out of view, or nothing moves. */
  private readonly shelfProbes: Vector3[] = [];
  private pan!: Object3D;
  private clock = 0;
  private reel = 0;
  private reelFrame = -1;
  private headTimer = 0;
  private dim = 1;
  private dipAge = -1;
  private flashAge = -1;
  private flashArmed = true;
  private ghostShown = false;
  private lastEyeZ = Infinity;

  // the one from the pictures
  private readonly lightA: SpotSpec;
  private readonly lightB: SpotSpec;
  private readonly body: Crowd;
  private readonly bodyBelow: Crowd;
  private readonly lookedAt = new Vector3(C.figure.at[0], C.figure.headY, C.figure.at[1]);
  private readonly followAt = new Vector3();
  private place: FigurePlace = 'end';
  private placedBehind = false;
  private seenBehind = false;
  private gap: number = C.follow.gap;
  private side = 1;
  private unseenFor = 0;
  private staredFor = 0;

  // the stage
  private readonly foreShort: Crowd;
  private readonly foreLong: Crowd;
  private readonly followers: Crowd[];
  private readonly sitters: Crowd[];
  private readonly loopBodies: Crowd[];
  private readonly stageLamps: DreamLight[];
  private readonly stageFlash: DreamLight;
  private readonly stageKey: DreamLight;

  constructor(kit: DreamKit) {
    this.kit = kit;
    this.root.name = 'Darkroom';
    this.lens.layers.set(LAYERS.WORLD);
    this.lens.layers.enable(LAYERS.DREAM);
    const S = C.stage;

    // the pictures exist from the start: materials hold their textures, develop() fills them in
    const picture = (size: number, height = size) =>
      new WebGLRenderTarget(size, height, {
        type: HalfFloatType,
        samples: S.samples,
        generateMipmaps: true,
        minFilter: LinearMipmapLinearFilter,
        anisotropy: 4,
      });
    this.frames = S.frames.map((_, k) => picture(k === S.frames.length - 1 ? S.lastResolution : S.resolution));
    this.portraits = S.sitters.map(() => picture(S.resolution));
    this.face = picture(S.resolution);
    this.loop = C.projector.poses.map(() => picture(S.loop.width, S.loop.height));
    for (let k = 0; k < S.frames.length; k++) this.scratchAt.push(new Vector3(0.5, 0.5, C.prints.scratch.least));
    this.beam.tLoop.value = this.loop[0].texture;

    const steel = new MeshStandardMaterial({
      color: C.surfaces.steel.color,
      metalness: C.surfaces.steel.metalness,
      roughness: C.surfaces.steel.roughness,
      roughnessMap: brushedSteel(),
    });
    this.surfaces = {
      tile: kit.surface('tile_hospital_broken', C.surfaces.tile.repeat, { color: new Color(C.surfaces.tile.color) }),
      paint: kit.surface('paint_peeling', C.surfaces.paint.repeat, { color: new Color(C.surfaces.paint.color) }),
      steel,
    };

    const F = C.figure;
    const L = F.light;
    const spec = (): SpotSpec => ({ position: L.position, target: L.target, color: L.color, intensity: L.intensity, angle: L.angle, penumbra: L.penumbra });
    this.lightA = spec();
    this.lightB = spec();
    this.spots = [this.lightA, null, null];

    this.buildShell();
    this.buildPipes();
    this.buildBenches();
    this.buildTrays();
    this.buildFacePrint();
    this.heads = this.buildHeads();
    this.buildCamera();
    this.buildProjector();
    this.buildPortraits();
    this.buildClock();
    this.buildPrints();
    this.buildFlesh();
    this.buildMirrorRoom();

    // the lamps themselves come before the stage takes its copy of them
    this.buildLamps();
    this.buildSteel();

    this.flashLight = kit.lights.add(C.flash.light, C.flash.color, 0, C.flash.reach);
    const P = C.projector;
    this.spill = kit.lights.add(P.spill.at, P.tint, P.spill.intensity * P.flicker.base, P.spill.reach);
    this.backGlow = kit.lights.add(F.backGlow.at, RED, F.backGlow.intensity, F.backGlow.reach);

    this.droplets = this.buildDroplets();
    const glow = this.glowMaterial();
    const lampCount = C.lamps.z.length;
    // lamps, the glare behind the figure, the flash, the projector's lens
    this.halos = new InstancedMesh(new PlaneGeometry(1, 1), glow, lampCount + 3);
    this.halos.name = 'Halos';
    this.halos.renderOrder = 1;
    this.halosBelow = new InstancedMesh(new PlaneGeometry(1, 1), glow, lampCount + 1);
    this.halosBelow.name = 'HalosBelow';
    this.halosBelow.renderOrder = -2;
    this.placeHalos();
    this.root.add(this.halos, this.below);
    this.below.add(this.halosBelow);

    this.body = kit.figures.crowd(F.spec, 2);
    this.body.root.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = true;
    });
    this.bodyBelow = kit.figures.crowd(F.spec, 1);
    flatBody(this.bodyBelow, new MeshBasicMaterial({ color: 0x000000, side: DoubleSide, fog: false }));
    this.root.add(this.body.root);
    this.below.add(this.bodyBelow.root);
    kit.poi({ position: this.lookedAt, radius: 6, zoom: 0.84, reach: 20, active: () => this.place === 'end' });

    // the stage
    this.foreShort = kit.figures.crowd({ avatar: 'figure_man', clip: S.idleClip, time: 0.3, face: 'blank' }, 1);
    this.foreLong = kit.figures.crowd({ avatar: 'figure_man', clip: S.idleClip, time: 0.3, face: 'blank', veil: true }, 1);
    this.followers = S.frames.map((frame) =>
      kit.figures.crowd({ avatar: 'figure_man', clip: frame.time < 0 ? S.idleClip : S.walkClip, time: Math.abs(frame.time), face: 'scratched' }, 1),
    );
    this.sitters = S.sitters.map((sitter) => kit.figures.crowd(sitter, 1));
    const shadowOnFilm = new MeshBasicMaterial({ color: 0xffffff, fog: false });
    this.loopBodies = P.poses.map((time) => {
      const body = kit.figures.crowd({ avatar: 'figure_man', clip: S.idleClip, time, face: 'blank' }, 1);
      flatBody(body, shadowOnFilm);
      return body;
    });
    this.stageLamps = C.lamps.z.map((z) => kit.lights.add([0, S.y + C.lamps.lightY, z], RED, 0, C.lamps.reach));
    this.stageFlash = kit.lights.add([0, S.y, S.cameraZ], S.flashColor, 0, S.flashReach);
    this.stageKey = kit.lights.add([0, S.y, S.cameraZ], S.keyColor, 0, S.keyReach);
    this.buildStage();

    this.root.add(this.shell);
    this.stand();
    // the dream's own moments are photographed before the first frame: the room must already be lit
    this.updateLamps();
    this.updateProjector(0);
  }

  // ------------------------------------------------------------------ the room

  private buildShell(): void {
    const { kit } = this;
    const { tile, paint } = this.surfaces;
    const T = C.surfaces.tile;
    const R = C.recess;
    const near = C.startZ + 0.1;
    const far = C.pastEndZ;

    const shell = this.shell;
    shell.name = 'DarkroomShell';
    /** A stretch of side wall. */
    const side = (sign: number, z0: number, z1: number, y0: number, y1: number, material: Material, x: number = HALF) => {
      const zc = (z0 + z1) / 2;
      const yc = (y0 + y1) / 2;
      const wall = kit.wall(Math.abs(z0 - z1), y1 - y0, material, zc, yc);
      wall.rotation.y = (-sign * Math.PI) / 2;
      wall.position.set(sign * x, yc, zc);
      shell.add(wall);
    };
    const trim: BufferGeometry[] = [];
    const dado = (sign: number, z0: number, z1: number) => {
      trim.push(boxPart(C.surfaces.trim.depth, C.surfaces.trim.height, Math.abs(z0 - z1), sign * (HALF - C.surfaces.trim.depth / 2), T.top, (z0 + z1) / 2));
    };

    // the left wall runs unbroken; the projector's picture falls on it
    side(-1, near, far, 0, T.top, tile, HALF - T.proud);
    side(-1, near, far, T.top - 0.02, CEILING + 0.05, paint);
    dado(-1, near, far);
    // the right wall stops for the recess
    for (const [z0, z1] of [[near, R.from], [R.to, far]]) {
      side(1, z0, z1, 0, T.top, tile, HALF - T.proud);
      side(1, z0, z1, T.top - 0.02, CEILING + 0.05, paint);
      dado(1, z0, z1);
    }
    side(1, R.from, R.to, R.height, CEILING + 0.05, paint);

    // the recess: back, two sides, its low ceiling
    const tileShade = tile.clone();
    tileShade.color.multiplyScalar(C.surfaces.recessShade);
    const paintShade = paint.clone();
    paintShade.color.multiplyScalar(C.surfaces.recessShade);
    side(1, R.from, R.to, 0, T.top, tileShade, HALF + R.depth);
    side(1, R.from, R.to, T.top - 0.02, R.height + 0.02, paintShade, HALF + R.depth + T.proud);
    const zc = (R.from + R.to) / 2;
    const xr = HALF + R.depth / 2;
    for (const [z, turn] of [[R.from, Math.PI], [R.to, 0]]) {
      const wall = kit.wall(R.depth + 0.04, R.height, paintShade, xr, R.height / 2);
      wall.rotation.y = turn;
      wall.position.set(xr, R.height / 2, z);
      shell.add(wall);
    }

    const ceiling = kit.surface('conc_stained', C.surfaces.ceiling.repeat, { color: new Color(C.surfaces.ceiling.color) });
    const ceilingLength = Math.abs(far - near) + 0.2;
    const zMid = (near + far) / 2;
    const top = kit.wall((HALF + 0.1) * 2, ceilingLength, ceiling, 0, zMid);
    top.rotation.x = Math.PI / 2;
    top.position.set(0, CEILING, zMid);
    const recessTop = kit.wall(R.depth + 0.1, Math.abs(R.from - R.to) + 0.05, paintShade, xr, zc);
    recessTop.rotation.x = Math.PI / 2;
    recessTop.position.set(xr, R.height, zc);
    shell.add(top, recessTop);

    // the end you came through, from inside: the hall's wall has only a slit in it
    const S = C.slit;
    const cap = (x0: number, x1: number, y0: number, y1: number, material: Material) => {
      const xc = (x0 + x1) / 2;
      const yc = (y0 + y1) / 2;
      const wall = kit.wall(x1 - x0, y1 - y0, material, xc, yc);
      wall.rotation.y = Math.PI;
      wall.position.set(xc, yc, C.startZ - 0.02);
      shell.add(wall);
    };
    for (const [x0, x1] of [[-HALF - 0.05, -S.halfWidth], [S.halfWidth, HALF + 0.05]]) {
      cap(x0, x1, 0, T.top, tile);
      cap(x0, x1, T.top - 0.02, CEILING + 0.05, paint);
    }
    cap(-S.halfWidth, S.halfWidth, S.height, CEILING + 0.05, paint);

    const strip = new Mesh(mergeGeometries(trim)!, new MeshStandardMaterial({ color: C.surfaces.trim.color, roughness: C.surfaces.trim.roughness }));
    strip.name = 'DadoTrim';
    strip.receiveShadow = true;
    shell.add(strip);

    const floor = kit.floor(-HALF - 0.05, HALF + 0.05, C.floorFromZ, far, C.floorY, this.floorMaterial());
    floor.name = 'WetFloor';
    // it blends over what lies under it, and writes depth for what comes after
    floor.renderOrder = -1;
    const recessFloor = kit.floor(HALF, HALF + R.depth + 0.02, R.from, R.to, C.floorY, floor.material as Material);
    recessFloor.renderOrder = -1;
    shell.add(floor, recessFloor);
  }

  /**
   * The floor: dark tile under a film of water, and a mirror of what stands under it. Being seen through,
   * the room below is what it reflects; the steeper the glance, the more of it. No extra render.
   */
  private floorMaterial(): MeshStandardMaterial {
    const Sh = C.floorShine;
    const material = this.kit.surface('tile_floor_dark', C.surfaces.floor.repeat, {
      roughness: C.surfaces.floor.roughness,
      transparent: true,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
    });
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uRipple = this.uRipple;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFloor;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFloor = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FLOOR_PARS}`)
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          float floorWet = floorWetness(vFloor);
          roughnessFactor *= mix(${f(Sh.roughness[0])}, ${f(Sh.roughness[1])}, floorWet);
          diffuseColor.rgb *= mix(1.0, ${f(Sh.darken)}, floorWet);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          vec2 floorRing = floorRipples(vFloor);
          normal = normalize(normal + mat3(viewMatrix) * vec3(floorRing.x, 0.0, floorRing.y) * ${f(C.ripple.strength)});`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += vec3(${f(RED_LINEAR.r)}, ${f(RED_LINEAR.g)}, ${f(RED_LINEAR.b)}) * length(floorRing) * ${f(C.ripple.glint)};`,
        )
        .replace(
          '#include <opaque_fragment>',
          `outgoingLight /= 1.0 + outgoingLight / ${f(Sh.glare)};
          float floorFacing = saturate(dot(normal, normalize(vViewPosition)));
          float floorMirror = mix(${f(Sh.reflect.straight)}, ${f(Sh.reflect.grazing)}, pow(1.0 - floorFacing, ${f(Sh.reflect.power)})) * mix(${f(Sh.damp)}, 1.0, floorWet);
          diffuseColor.a = 1.0 - min(floorMirror, ${f(Sh.reflect.most)});
          #include <opaque_fragment>`,
        );
    };
    return material;
  }

  /** The red room upside down under the floor, each vertex lit once by the lamps as the real room is (it needs no light of its own). */
  private buildMirrorRoom(): void {
    const M = C.mirrorRoom;
    const zFrom = C.floorFromZ;
    const zTo = C.pastEndZ;
    const steps = Math.ceil(Math.abs(zFrom - zTo) / M.step);
    const sources: { at: Vector3; power: number; reach: number }[] = C.lamps.z.map((z) => ({
      at: new Vector3(0, C.lamps.lightY, z),
      power: C.lamps.intensity,
      reach: C.lamps.reach,
    }));
    sources.push({ at: new Vector3(...C.figure.backGlow.at), power: C.figure.backGlow.intensity, reach: C.figure.backGlow.reach });
    const lit = (x: number, y: number, z: number, nx: number, ny: number): number => {
      let e = 0;
      for (const s of sources) {
        v1.set(s.at.x - x, s.at.y - y, s.at.z - z);
        const d = v1.length();
        const facing = Math.max(0, (v1.x * nx + v1.y * ny) / d);
        const fade = Math.max(0, 1 - (d / s.reach) ** 4) ** 2;
        e += (s.power * facing * fade) / (d * d);
      }
      return e / Math.PI;
    };
    const underBench = (sign: number, z: number) => C.benches.spans.some((b) => b.side === sign && z < b.from && z > b.to);

    const positions: number[] = [];
    const colors: number[] = [];
    const index: number[] = [];
    const put = (x: number, y: number, z: number, radiance: number) => {
      positions.push(x, -y, z);
      colors.push(radiance * RED_LINEAR.r * M.gain, radiance * RED_LINEAR.g * M.gain, radiance * RED_LINEAR.b * M.gain);
    };
    const grid = (rows: number, columns: number) => {
      const base = positions.length / 3 - (rows + 1) * (columns + 1);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < columns; i++) {
          const a = base + j * (columns + 1) + i;
          index.push(a, a + 1, a + columns + 1, a + 1, a + columns + 2, a + columns + 1);
        }
      }
    };
    for (const sign of [1, -1]) {
      for (let j = 0; j <= steps; j++) {
        const z = lerp(zFrom, zTo, j / steps);
        for (const y of M.rows) {
          let albedo: number = y < C.surfaces.tile.top ? M.tileAlbedo : M.paintAlbedo;
          // the bench hides the wall behind it, and is dark under its top
          if (y < C.benches.height + 0.01 && underBench(sign, z)) albedo *= M.underBench;
          put(sign * HALF, y, z, lit(sign * HALF, y, z, -sign, 0) * albedo);
        }
      }
      grid(steps, M.rows.length - 1);
    }
    const across = [-HALF, -1.2, 0, 1.2, HALF];
    for (let j = 0; j <= steps; j++) {
      const z = lerp(zFrom, zTo, j / steps);
      for (const x of across) put(x, CEILING, z, lit(x, CEILING, z, 0, -1) * M.ceilingAlbedo);
    }
    grid(steps, across.length - 1);
    // its two ends close the space under the floor
    for (const z of [zFrom, zTo]) {
      for (const y of [0, 1.9, CEILING]) for (const x of across) put(x, y, z, 0);
      grid(2, across.length - 1);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    g.setIndex(index);
    const material = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
    this.belowDims.push({ material, full: 1 });
    const room = new Mesh(g, material);
    room.name = 'RoomInTheFloor';
    this.below.add(room);
  }

  /** Red fixtures hanging from the ceiling, across the corridor; each with its own short light. */
  private buildLamps(): void {
    const { kit } = this;
    const L = C.lamps;
    const fixtures: Mesh[] = [];
    L.z.forEach((z) => {
      const object = kit.prop('caged_light', [0, CEILING, z], { anchor: 'top' }, this.root);
      const meshes = meshesOf(object);
      const material = (meshes[0].material as MeshStandardMaterial).clone();
      material.emissive.copy(RED_LINEAR);
      material.emissiveIntensity = L.tube;
      kit.paint(object, material);
      fixtures.push(...meshes);
      this.lamps.push({ object, material, light: kit.lights.add([0, L.lightY, z], RED, L.intensity, L.reach) });
    });
    slim(fixtures, L.triangles);
  }

  private buildPipes(): void {
    const { pipes } = C;
    const parts: BufferGeometry[] = [];
    const from = C.startZ + 0.05;
    const to = C.pastEndZ;
    for (const run of pipes.runs) {
      const points: Vector3[] = [];
      for (let t = 0; t <= 8; t++) {
        const u = t / 8;
        points.push(new Vector3(run.x, run.y - run.sag * Math.sin(u * Math.PI * 5) * Math.sin(u * Math.PI), lerp(from, to, u)));
      }
      parts.push(tubePart(points, run.radius));
      for (let z = from - 0.8; z > to; z -= pipes.bracketEvery) {
        parts.push(boxPart(run.radius * 2.8, CEILING - run.y + run.radius, 0.05, run.x, (CEILING + run.y) / 2, z));
      }
    }
    // the branch that feeds the sloped sink: across to the left wall, down it, and out over the sink's top edge
    const stream = this.facePrintTop();
    const x = -HALF + 0.09;
    parts.push(
      tubePart(
        [
          new Vector3(pipes.runs[0].x, pipes.runs[0].y, stream.z),
          new Vector3(-2.2, 3.5, stream.z),
          new Vector3(x, 3.1, stream.z),
          new Vector3(x, 2.1, stream.z),
          new Vector3(x, C.facePrint.streamTop + 0.12, stream.z),
          new Vector3(stream.x, C.facePrint.streamTop + 0.03, stream.z),
        ],
        0.028,
      ),
    );
    const pipe = new Mesh(mergeGeometries(parts)!, this.kit.surface('rust_streaked', C.surfaces.pipe.repeat, { color: new Color(C.surfaces.pipe.color) }));
    pipe.name = 'Pipes';
    pipe.receiveShadow = true;
    this.shell.add(pipe);
  }

  /** The bench's steel, legs in one draw. */
  private buildBenches(): void {
    const B = C.benches;
    const legs: Matrix4[] = [];
    const dark: BufferGeometry[] = [];
    const legHeight = B.height - B.top;
    const front = HALF - B.depth;
    for (const { side, from, to } of B.spans) {
      const length = from - to;
      const zc = (from + to) / 2;
      const x = side * (HALF - B.depth / 2);
      this.steelParts.push(
        boxPart(B.depth, B.top, length, x, B.height - B.top / 2, zc),
        boxPart(0.03, 0.035, length, side * (front + 0.015), B.height + 0.012, zc),
        boxPart(0.02, 0.24, length, side * (HALF - C.surfaces.tile.proud - 0.012), B.height + 0.12, zc),
        boxPart(B.depth - 0.1, 0.025, length - 0.1, x, B.shelf, zc),
      );
      dark.push(boxPart(B.depth, 0.004, length, x, 0, zc), boxPart(0.006, legHeight, length, side * (HALF - C.surfaces.tile.proud - 0.004), legHeight / 2, zc));
      for (let z = from - 0.08; z > to - 0.02; z -= B.legEvery) {
        for (const lx of [front + 0.05, HALF - 0.06]) legs.push(new Matrix4().makeTranslation(side * lx, legHeight / 2, Math.max(z, to + 0.08)));
      }
    }
    const legMesh = new InstancedMesh(new BoxGeometry(0.045, legHeight, 0.045), this.surfaces.steel, legs.length);
    legMesh.name = 'BenchLegs';
    legs.forEach((m, i) => legMesh.setMatrixAt(i, m));
    legMesh.castShadow = true;
    legMesh.receiveShadow = true;
    const shade = new Mesh(mergeGeometries(dark)!, new MeshStandardMaterial({ color: C.surfaces.underBench, roughness: 0.9 }));
    shade.name = 'UnderBenches';
    this.shell.add(legMesh, shade);
  }

  private buildSteel(): void {
    const steel = new Mesh(mergeGeometries(this.steelParts)!, this.surfaces.steel);
    steel.name = 'Steel';
    steel.castShadow = true;
    steel.receiveShadow = true;
    this.shell.add(steel);
  }

  /** Trays along the benches: prints lying in them, developing; here and there something dead. */
  private buildTrays(): void {
    const { kit } = this;
    const T = C.trays;
    const B = C.benches;
    const level = B.height + T.height * T.level;
    const random = randomFrom(0x7a4);
    const enamel = new MeshStandardMaterial({ color: T.enamel.color, roughness: T.enamel.roughness });
    const liquidMaterial = new MeshStandardMaterial({ color: T.liquid.color, roughness: T.liquid.roughness, metalness: 0 });
    const trayMatrices: Matrix4[] = [];
    const liquidMatrices: Matrix4[] = [];
    const dead: Mesh[] = [];
    const black = new MeshStandardMaterial({ color: 0x050505, roughness: 0.6 });

    for (const item of T.items) {
      const x = item.side * (HALF - T.wallGap);
      const yaw = (random() - 0.5) * 0.14;
      const matrix = new Matrix4().compose(v1.set(x, B.height, item.z), q1.setFromAxisAngle(UP, yaw), v2.set(item.size, 1, item.size));
      trayMatrices.push(matrix.clone());
      liquidMatrices.push(matrix.clone());
      if ('frame' in item) {
        this.pendingTrayPrints.push({ frame: item.frame, x, y: level + 0.0015, z: item.z, yaw: yaw + (random() - 0.5) * 0.3 });
      }
      if ('rat' in item) {
        const rat = kit.prop('rat', [x, level - T.rat.sink, item.z], { scale: T.rat.scale, rotation: [random() * 30, random() * 360, 172] }, this.root);
        dead.push(...meshesOf(rat));
      }
      if ('raven' in item) {
        const raven = kit.prop('raven', [x, level - T.raven.sink, item.z], { scale: T.raven.scale, rotation: [96, random() * 360, 8] }, this.root);
        kit.paint(raven, black);
      }
    }
    slim(dead, T.rat.triangles);

    // the sloped sink's pan is a tray too
    const F = C.facePrint;
    const { n, x: across, u, center } = this.slope();
    const panMatrix = new Matrix4().makeBasis(across, n, v1.crossVectors(across, n)).scale(v2.set((F.width + 0.1) / T.width, 1, (F.height + 0.1) / T.depth));
    panMatrix.setPosition(center);
    trayMatrices.push(panMatrix);

    const trays = new InstancedMesh(trayGeometry(T.width, T.depth, T.height), enamel, trayMatrices.length);
    trays.name = 'Trays';
    trayMatrices.forEach((m, i) => trays.setMatrixAt(i, m));
    trays.receiveShadow = true;
    const liquids = new InstancedMesh(liquidGeometry(T.width, T.depth, T.height * T.level), liquidMaterial, liquidMatrices.length);
    liquids.name = 'Liquid';
    liquidMatrices.forEach((m, i) => liquids.setMatrixAt(i, m));
    this.root.add(trays, liquids);

    // what the pan rests on: a plate and four legs down to the bench
    const plate = new BoxGeometry(F.width + 0.06, 0.03, F.height + 0.06).applyMatrix4(new Matrix4().makeBasis(across, n, v1.crossVectors(across, n))).translate(center.x - n.x * 0.02, center.y - n.y * 0.02, center.z - n.z * 0.02);
    this.steelParts.push(meterUVs(plate));
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = v1.copy(center).addScaledVector(across, (a * F.width) / 2).addScaledVector(u, (b * F.height) / 2).addScaledVector(n, -0.03);
      const height = leg.y - B.height;
      this.steelParts.push(boxPart(0.035, height, 0.035, leg.x, B.height + height / 2, leg.z));
    }
  }

  /** The way the sloped sink lies: its normal, across (the image's right), up the slope (the image's up), and its pan's center. */
  private slope(): { n: Vector3; x: Vector3; u: Vector3; center: Vector3 } {
    const n = new Vector3(...C.facePrint.faces).normalize();
    const u = new Vector3().copy(UP).addScaledVector(n, -n.y).normalize();
    const x = new Vector3().crossVectors(u, n).normalize();
    return { n, x, u, center: new Vector3(...C.facePrint.at) };
  }

  /** The middle of the sloped sink's top edge. */
  private facePrintTop(): Vector3 {
    const { u, center } = this.slope();
    return center.addScaledVector(u, C.facePrint.height / 2);
  }

  /** On the sink's slope, under a running film of liquid, a print on which a face comes up as you pass. */
  private buildFacePrint(): void {
    const F = C.facePrint;
    const { n, x, u, center } = this.slope();
    const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.09, metalness: 0, emissive: RED_LINEAR, emissiveIntensity: F.glow });
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.tFace = { value: this.face.texture };
      shader.uniforms.uRise = this.uRise;
      shader.uniforms.uClock = this.uClock;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vPlate;\nvarying vec3 vPlateT;\nvarying vec3 vPlateB;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vPlate = uv;
          vPlateT = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));
          vPlateB = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${PLATE_PARS}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${PLATE_FRAGMENT}`)
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          normal = normalize(normal + (vPlateT * plateFlow.x + vPlateB * plateFlow.y) * 0.32);`,
        )
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= plateSheet;');
    };
    const sheet = new Mesh(new PlaneGeometry(F.width, F.height, 8, 6), material);
    sheet.name = 'RisingFace';
    sheet.matrixAutoUpdate = false;
    sheet.matrix.makeBasis(x, u, n).setPosition(center.clone().addScaledVector(n, C.trays.height * 0.75));
    sheet.receiveShadow = true;
    this.root.add(sheet);
    this.kit.poi({ position: center.clone(), radius: 8, zoom: 0.8, reach: 10 });

    // the thin stream that runs onto it
    const top = this.facePrintTop();
    const height = F.streamTop - top.y;
    const stream = new Mesh(new CylinderGeometry(F.streamRadius, F.streamRadius, height, 5, 1, true), new MeshStandardMaterial({ color: 0x1d0a08, roughness: 0.04 }));
    stream.name = 'Stream';
    stream.position.set(top.x, top.y + height / 2, top.z);
    this.root.add(stream);
  }

  /** Thirty identical plaster heads: an archive of blank faces, looking at the corridor. */
  private buildHeads(): PropCrowd {
    const H = C.heads;
    const crowd = this.kit.props('mri_head', H.perShelf * H.shelves.length, { scale: H.scale });
    this.kit.paint(crowd.root, new MeshStandardMaterial({ color: H.color, roughness: H.roughness }));
    slim(meshesOf(crowd.root), H.triangles);
    crowd.root.name = 'Heads';
    const x = -HALF + H.shelfDepth / 2 + 0.02;
    const length = (H.perShelf - 1) * H.spacing + 0.5;
    const zc = H.fromZ - ((H.perShelf - 1) * H.spacing) / 2;
    H.shelves.forEach((y) => {
      this.steelParts.push(boxPart(H.shelfDepth, 0.04, length, -HALF + H.shelfDepth / 2 + 0.01, y - 0.02, zc));
      for (let z = H.fromZ; z >= H.fromZ - (H.perShelf - 1) * H.spacing; z -= H.spacing * 3) {
        this.steelParts.push(boxPart(H.shelfDepth - 0.06, 0.03, 0.03, -HALF + H.shelfDepth / 2 - 0.01, y - 0.055, z));
      }
      for (let i = 0; i < H.perShelf; i++) {
        const z = H.fromZ - i * H.spacing;
        this.headAt.push(new Vector3(x, y, z));
      }
    });
    this.lookAtTheCorridor(crowd);
    const lastZ = H.fromZ - (H.perShelf - 1) * H.spacing;
    const midY = H.shelves[1] + H.scale / 2;
    this.shelfProbes.push(new Vector3(x, midY, H.fromZ), new Vector3(x, midY, (H.fromZ + lastZ) / 2), new Vector3(x, midY, lastZ));
    this.root.add(crowd.root);
    return crowd;
  }

  /** The plaster heads at rest, every one looking at someone a little way up the corridor. */
  private lookAtTheCorridor(crowd: PropCrowd): void {
    for (let i = 0; i < this.headAt.length; i++) {
      const p = this.headAt[i];
      crowd.setMatrix(i, m1.compose(p, q1.setFromAxisAngle(UP, Math.atan2(-p.x, C.heads.gazeAhead)), UNIT));
    }
    crowd.commit();
  }

  /** The bellows camera on its tripod, in the recess, panning after you. */
  private buildCamera(): void {
    const K = C.camera;
    const prop = this.kit.prop('antique_camera', K.at, { scale: K.scale }, this.root);
    const head = prop.getObjectByName('camera')!;
    const legs = prop.getObjectByName('tripod') as Mesh;
    // the tripod carries a maker's logo: dark wood instead, seen this close
    legs.material = new MeshStandardMaterial({ color: K.woodColor, roughness: K.woodRoughness });
    // it pans around the tripod's column, not the camera's own middle
    this.pan = new Object3D();
    this.pan.position.set(legs.position.x, head.position.y, legs.position.z);
    head.parent!.add(this.pan);
    head.position.sub(this.pan.position);
    this.pan.add(head);
    this.pan.rotation.y = K.startYaw * DEG;
  }

  /** The projector: the machine, a beam of dusty light through the corridor, and on the wall someone standing. */
  private buildProjector(): void {
    const P = C.projector;
    const target = new Vector3(...P.picture.center);
    const yaw = Math.atan2(target.x - P.at[0], target.z - P.at[2]) / DEG;
    const prop = this.kit.prop('projector', P.at, { scale: P.scale, rotation: [0, yaw, 0], nodes: P.nodes }, this.root);
    for (const name of P.spools) this.spools.push(prop.getObjectByName(name)!);
    prop.updateWorldMatrix(true, true);
    const lens = prop.children[0].localToWorld(new Vector3(...P.lens));

    const length = lens.distanceTo(target);
    const w = new Vector3().subVectors(target, lens).normalize();
    const a = new Vector3().crossVectors(w, UP).normalize();
    const b = new Vector3().crossVectors(a, w).normalize();
    const b0 = this.beam;
    b0.uLens.value.copy(lens);
    b0.uAxisU.value.copy(a);
    b0.uAxisV.value.copy(b);
    b0.uAxisW.value.copy(w);
    // the wall stands aslant to the beam: a gate this wide across the beam gives a picture this wide along the wall
    b0.uGate.value.set(((P.picture.width / 2) * Math.abs(w.x)) / length, P.picture.height / 2 / length);

    // the hull of the pyramid of light, ending a hair before the wall
    const wallX = target.x + 0.012;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => {
      const d = new Vector3().copy(w).addScaledVector(a, su * b0.uGate.value.x).addScaledVector(b, sv * b0.uGate.value.y);
      return lens.clone().addScaledVector(d, (wallX - lens.x) / d.x);
    });
    const middle = new Vector3().addVectors(corners[0], corners[2]).multiplyScalar(0.5).lerp(lens, 0.3);
    const hull: number[] = [];
    const triangle = (p: Vector3, q: Vector3, r: Vector3) => {
      // wound outward, whatever the order of the corners: only the far side is drawn
      const outward = v1.subVectors(q, p).cross(v2.subVectors(r, p)).dot(v2.copy(p).add(q).add(r).multiplyScalar(1 / 3).sub(middle)) > 0;
      for (const point of outward ? [p, q, r] : [p, r, q]) hull.push(point.x, point.y, point.z);
    };
    const STEPS_ALONG = 6;
    const STEPS_ACROSS = 2;
    const along = (edge: Vector3, s: number) => new Vector3().lerpVectors(lens, edge, s);
    corners.forEach((corner, i) => {
      const next = corners[(i + 1) % corners.length];
      for (let c = 0; c < STEPS_ACROSS; c++) {
        const e0 = new Vector3().lerpVectors(corner, next, c / STEPS_ACROSS);
        const e1 = new Vector3().lerpVectors(corner, next, (c + 1) / STEPS_ACROSS);
        for (let s = 0; s < STEPS_ALONG; s++) {
          const p00 = along(e0, s / STEPS_ALONG);
          const p01 = along(e0, (s + 1) / STEPS_ALONG);
          const p10 = along(e1, s / STEPS_ALONG);
          const p11 = along(e1, (s + 1) / STEPS_ALONG);
          triangle(p00, p01, p11);
          triangle(p00, p11, p10);
        }
      }
    });
    const bilinear = (s: number, t: number) => new Vector3().lerpVectors(new Vector3().lerpVectors(corners[0], corners[1], s), new Vector3().lerpVectors(corners[3], corners[2], s), t);
    for (let i = 0; i < STEPS_ACROSS; i++) {
      for (let j = 0; j < STEPS_ACROSS; j++) {
        const s0 = i / STEPS_ACROSS;
        const s1 = (i + 1) / STEPS_ACROSS;
        const t0 = j / STEPS_ACROSS;
        const t1 = (j + 1) / STEPS_ACROSS;
        triangle(bilinear(s0, t0), bilinear(s1, t0), bilinear(s1, t1));
        triangle(bilinear(s0, t0), bilinear(s1, t1), bilinear(s0, t1));
      }
    }
    const hullGeometry = new BufferGeometry();
    hullGeometry.setAttribute('position', new Float32BufferAttribute(hull, 3));
    const fog = UniformsUtils.merge([UniformsLib.fog]);
    const beam = new Mesh(
      hullGeometry,
      new ShaderMaterial({
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        uniforms: { ...fog, ...warpUniforms, ...b0, uDensity: { value: P.density } },
        fog: true,
        side: BackSide,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    beam.name = 'ProjectorBeam';
    beam.renderOrder = 1;
    this.root.add(beam);

    // the picture on the wall, and the same in the floor
    let y0 = Infinity;
    let y1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const corner of corners) {
      y0 = Math.min(y0, corner.y);
      y1 = Math.max(y1, corner.y);
      z0 = Math.min(z0, corner.z);
      z1 = Math.max(z1, corner.z);
    }
    // the gate is keystoned, and the plane stands a little further off than the hull's end
    const margin = 0.06;
    y0 = Math.max(0.004, y0 - margin);
    y1 += margin;
    z0 -= margin;
    z1 += margin;
    const { tile, paint } = this.surfaces;
    const wallU = C.startZ + 0.1 + C.pastEndZ;
    const pictureMaterial = new ShaderMaterial({
      vertexShader: PICTURE_VERT,
      fragmentShader: PICTURE_FRAG,
      uniforms: {
        ...UniformsUtils.merge([UniformsLib.fog]),
        ...warpUniforms,
        ...b0,
        uLight: { value: P.light },
        tTile: { value: tile.map },
        tPaint: { value: paint.map },
        uWall: { value: new Vector4(wallU, C.surfaces.tile.top, C.surfaces.tile.repeat, C.surfaces.paint.repeat) },
      },
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const onWall = this.kit.wall(z1 - z0, y1 - y0, pictureMaterial);
    onWall.name = 'FilmOnTheWall';
    onWall.rotation.y = Math.PI / 2;
    onWall.position.set(target.x, (y0 + y1) / 2, (z0 + z1) / 2);
    onWall.receiveShadow = false;
    onWall.renderOrder = 1;
    this.root.add(onWall);
    const inFloor = onWall.clone();
    inFloor.name = 'FilmInTheFloor';
    inFloor.position.y = -onWall.position.y;
    inFloor.scale.y = -1;
    inFloor.renderOrder = -2;
    this.below.add(inFloor);
  }

  /** Portraits on the upper walls: three sitters photographed in the black room, their faces scratched out by hand. */
  private buildPortraits(): void {
    const P = C.portraits;
    const crowd = this.kit.props('portrait_frame', P.items.length, { nodes: ['fancy_picture_frame_01'], scale: P.scale, rotation: [0, 0, 90] });
    crowd.root.name = 'PortraitFrames';
    const scratch = this.scratchTexture;
    const width = 0.4 * P.scale;
    const height = 0.54 * P.scale;
    // the canvas stands in the frame, a little behind its front
    const off = 0.016 - 0.005 * P.scale;
    const middle = P.bottom + 0.302 * P.scale;
    const plane = new PlaneGeometry(width, height);
    this.portraits.forEach((target, image) => {
      const hung = P.items.filter((item) => item.image === image);
      const material = new MeshStandardMaterial({ map: target.texture, roughness: P.roughness, emissive: 0xffffff, emissiveMap: target.texture, emissiveIntensity: P.glow });
      const [r, g, b] = P.scratchColor;
      material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
        shader.uniforms.tScratch = { value: scratch };
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D tScratch;')
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            float portraitCut = texture2D(tScratch, vMapUv).r;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${f(r)}, ${f(g)}, ${f(b)}), portraitCut);`,
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(${f(P.glow * r)}, ${f(P.glow * g)}, ${f(P.glow * b)}), portraitCut);`,
          );
      };
      const pictures = new InstancedMesh(plane, material, hung.length);
      pictures.name = 'Portraits';
      hung.forEach((item, i) => {
        const heading = (-item.side * Math.PI) / 2;
        pictures.setMatrixAt(i, m1.compose(v1.set(item.side * (HALF - off), middle, item.z), q1.setFromAxisAngle(UP, heading), UNIT));
      });
      this.root.add(pictures);
    });
    P.items.forEach((item, i) => {
      crowd.set(i, item.side * (HALF - 0.016), P.bottom, item.z, (-item.side * Math.PI) / 2);
    });
    crowd.commit();
    this.root.add(crowd.root);
  }

  /** A timer on the wall, stopped at half past. */
  private buildClock(): void {
    const K = C.clock;
    const prop = this.kit.prop('wall_clock', K.at, { scale: K.scale, rotation: [0, -90, 0], anchor: 'center' }, this.root);
    // the rig looks for the dial by its name, which the prop's own pivot also bears
    setClock(rigClock(prop.children[0]), K.stoppedAt);
  }

  // ------------------------------------------------------------------ the frames

  private buildPrints(): void {
    const K = C.prints;
    const placed: Placed[][] = C.stage.frames.map(() => []);
    const pegs: Matrix4[] = [];
    const wires: BufferGeometry[] = [];
    const random = randomFrom(0x9e11);
    const add = (frame: number, x: number, y: number, z: number, yaw: number, scale: number, sway: number, gain: number) => {
      placed[frame].push({ matrix: new Matrix4().compose(new Vector3(x, y, z), q1.setFromAxisAngle(UP, yaw), new Vector3(scale, scale, scale)), sway, gain });
    };
    const peg = (x: number, y: number, z: number, yaw: number, size: number) => {
      pegs.push(new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(UP, yaw), new Vector3(size, size, size)));
    };

    // the big ones, hung along each side at the height of the eye
    for (const hero of K.heroes) {
      const x = hero.side * K.lineX;
      const yaw = -hero.side * K.turn;
      add(hero.frame, x, K.lineY - 0.012, hero.z, yaw, K.heroScale, 1, 1);
      peg(x, K.lineY - 0.012, hero.z, yaw, 1);
      // a drop gathers at its lower corner nearest the way, and falls clear of the bench
      this.addDrip(x - hero.side * (print.width / 2) * K.heroScale * 0.85 * Math.cos(K.turn), K.lineY - 0.012 - print.height * K.heroScale, hero.z - (print.width / 2) * K.heroScale * 0.85 * Math.sin(K.turn), random);
    }
    for (const line of K.lines) {
      const end = new Vector3(line.side * K.lineX, K.lineY, line.to);
      wires.push(wirePart(new Vector3(line.side * K.lineX, K.lineY, C.startZ), end, 0.02, K.wire.radius));
      wires.push(wirePart(end, new Vector3(line.side * HALF, K.lineY + 0.03, line.to), 0.004, K.wire.radius));
    }

    // frame eight
    const L = K.last;
    const axis = new Vector3(Math.cos(L.turn), 0, -Math.sin(L.turn));
    add(C.stage.frames.length - 1, L.top[0], L.top[1], L.top[2], L.turn, L.scale, 0.25, 1);
    const pegAt = (offset: number) => new Vector3(...L.top).addScaledVector(axis, offset);
    const ends = L.pegsAt.map(pegAt);
    const freeEnd = pegAt(1.3);
    wires.push(wirePart(pegAt(-1.3), freeEnd, 0.015, K.wire.radius * 1.4), wirePart(freeEnd, new Vector3(freeEnd.x, CEILING, freeEnd.z), 0, K.wire.radius * 1.4));
    for (const end of ends) peg(end.x, end.y, end.z, L.turn, 3);
    for (const offset of L.dripsAt) {
      const corner = pegAt(offset);
      this.addDrip(corner.x, L.top[1] - print.height * L.scale, corner.z, random);
    }

    // the rows across the corridor, overhead: the same frame again and again
    const R = K.rows;
    R.z.forEach((z, frame) => {
      wires.push(wirePart(new Vector3(-HALF, R.wireY, z), new Vector3(HALF, R.wireY, z), R.sag, K.wire.radius));
      for (const at of R.x[frame % R.x.length]) {
        const x = at + (random() - 0.5) * 2 * R.wander;
        const share = (x + HALF) / (HALF * 2);
        const y = R.wireY - R.sag * 4 * share * (1 - share) - 0.012;
        const yaw = (random() - 0.5) * 2 * R.jitter;
        add(frame, x, y, z, yaw, R.scale, 1, R.gain);
        peg(x, y, z, yaw, 0.85);
      }
    });

    // a few pinned flat to the walls
    const P = K.pins;
    for (const pin of P.items) add(pin.frame, pin.side * (HALF - 0.006), P.y, pin.z, (-pin.side * Math.PI) / 2, P.scale, 0, P.gain);

    // and those lying in the trays, under the surface of the liquid
    const T = C.trays;
    for (const item of this.pendingTrayPrints) {
      const scale = T.printScale;
      const center = print.height * scale * 0.5;
      // the sheet's top edge is its origin: lying flat, it reaches along its own forward
      q1.setFromAxisAngle(UP, item.yaw).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2));
      v1.set(0, -center, 0).applyQuaternion(q1);
      placed[item.frame].push({ matrix: new Matrix4().compose(new Vector3(item.x - v1.x, item.y, item.z - v1.z), q1, new Vector3(scale, scale, scale)), sway: 0, gain: T.printGain });
    }

    // one draw per picture; each carries its own number and the same face on its back
    const card = cardGeometry();
    const caption = captionTexture();
    const lastFrame = this.frames.length - 1;
    placed.forEach((copies, frame) => {
      const g = new BufferGeometry();
      for (const name of ['position', 'normal', 'uv']) g.setAttribute(name, card.getAttribute(name));
      g.setIndex(card.getIndex());
      const values = new Float32Array(copies.length * 2);
      copies.forEach((copy, i) => {
        values[i * 2] = copy.sway;
        values[i * 2 + 1] = copy.gain;
      });
      g.setAttribute('aPrint', new InstancedBufferAttribute(values, 2));
      const mesh = new InstancedMesh(g, this.printMaterial(frame, caption), copies.length);
      mesh.name = `Frame${frame + 1}`;
      copies.forEach((copy, i) => mesh.setMatrixAt(i, copy.matrix));
      mesh.receiveShadow = true;
      this.root.add(mesh);
      // the floor reflects the ones at eye height, and the big one
      const hero = K.heroes.find((h) => h.frame === frame);
      if (hero || frame === lastFrame) this.reflectPrint(this.frames[frame].texture, copies[0].matrix);
    });
    this.pendingTrayPrints.length = 0;

    const pegMesh = new InstancedMesh(this.pegGeometry(), new MeshStandardMaterial({ color: K.peg.color, roughness: K.peg.roughness }), pegs.length);
    pegMesh.name = 'Pegs';
    pegs.forEach((m, i) => pegMesh.setMatrixAt(i, m));
    const lines = new Mesh(mergeGeometries(wires)!, new MeshStandardMaterial({ color: K.wire.color, roughness: K.wire.roughness }));
    lines.name = 'PrintLines';
    this.root.add(pegMesh, lines);

    // a long look finds the last one
    const centerY = L.top[1] - (image.offsetFromTop + image.size / 2) * L.scale;
    this.kit.poi({ position: new Vector3(L.top[0], centerY, L.top[2]), radius: 10, zoom: 0.82, memory: 'frame', reach: 16 });

    for (const [x, z] of C.drops.fromCeiling) this.addDrip(x, CEILING - 0.02, z, random);
  }

  private pegGeometry(): BufferGeometry {
    const [w, l, t] = C.prints.peg.jaw;
    const y = C.prints.peg.above - l / 2;
    return mergeGeometries([new BoxGeometry(w, l, t).translate(0, y, t * 0.6), new BoxGeometry(w, l, t).translate(0, y, -t * 0.6)])!;
  }

  private printMaterial(frame: number, caption: Texture): MeshStandardMaterial {
    const K = C.prints;
    const material = new MeshStandardMaterial({ color: 0xffffff, roughness: K.roughness, metalness: 0, side: DoubleSide });
    const uniforms = {
      tPicture: { value: this.frames[frame].texture },
      tBack: { value: this.face.texture },
      tScratch: { value: this.scratchTexture },
      tCaption: { value: caption },
      uScratch: { value: this.scratchAt[frame] },
      uCell: { value: frame },
      uClock: this.uClock,
      uLit: this.uLit,
    };
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${PRINT_VERTEX_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${PRINT_VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${PRINT_PARS}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${PRINT_FRAGMENT}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, ${f(K.wetRoughness)}, clamp(cardWet.z, 0.0, 1.0));`)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + (vCardT * cardWet.x + vCardB * cardWet.y) * 0.8);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += printLight;');
    };
    return material;
  }

  /** The print upside down under the floor. */
  private reflectPrint(picture: Texture, matrix: Matrix4): void {
    const plane = new PlaneGeometry(image.size, image.size, 2, 2).translate(0, -image.offsetFromTop - image.size / 2, 0);
    const material = new MeshBasicMaterial({ map: picture, side: DoubleSide });
    material.color.setScalar(C.printBelow);
    this.belowDims.push({ material, full: C.printBelow });
    const mesh = new Mesh(plane, material);
    mesh.name = 'PrintInTheFloor';
    mesh.matrixAutoUpdate = false;
    mesh.matrix.makeScale(1, -1, 1).multiply(matrix);
    this.below.add(mesh);
  }

  private addDrip(x: number, top: number, z: number, random: () => number): void {
    const D = C.drops;
    const fall = Math.sqrt((2 * Math.max(0.05, top)) / D.gravity);
    const period = lerp(D.period[0], D.period[1], random());
    this.drips.push({ x, top, z, period, offset: random() * period, fall, swell: Math.max(0.2, period - fall - C.ripple.life) });
  }

  private buildDroplets(): InstancedMesh {
    const material = new MeshBasicMaterial();
    material.color.setRGB(...C.drops.color);
    const mesh = new InstancedMesh(new IcosahedronGeometry(1, 1), material, this.drips.length);
    mesh.name = 'Droplets';
    for (let i = 0; i < this.drips.length; i++) mesh.setMatrixAt(i, NOWHERE);
    this.root.add(mesh);
    return mesh;
  }

  // ------------------------------------------------------------------ the end of the corridor

  /** Wet flesh coming through the tiles: the next chapter announcing itself. */
  private buildFlesh(): void {
    const F = C.flesh;
    const random = randomFrom(F.seed);
    const parts: BufferGeometry[] = F.patches.map((p) => fleshPatch(p.at, p.n, p.t, p.radius, p.rise, random));
    parts.push(fleshLip(random));

    // veins crawling out of the patches, up the corridor, along the tile
    const V = F.veins;
    const wander = randomFrom(V.seed);
    for (const sign of [1, -1]) {
      const outward = new Vector3(-sign, 0, 0);
      for (let n = 0; n < V.perWall; n++) {
        let y = 0.25 + wander() * 3.1;
        let z = -148.7 + wander() * 0.5;
        let climb = 0;
        const stride = (V.reachZ + wander() * 2.4 - z) / (V.points - 1);
        const points: Vector3[] = [];
        for (let i = 0; i < V.points; i++) {
          points.push(new Vector3(sign * (HALF - C.surfaces.tile.proud - 0.004), y, z));
          // it feels its way: the turn is what wanders, not the place
          climb = climb * 0.75 + (wander() - 0.5) * V.meander;
          y = Math.min(CEILING - 0.1, Math.max(0.1, y + climb));
          z += stride * (0.7 + wander() * 0.6);
        }
        parts.push(fleshVein(points, outward));
      }
    }

    const material = this.kit.surface('flesh_smeared', F.repeat, { color: new Color(F.color), roughness: F.roughness });
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uBeat = this.uBeat;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aRise;\nuniform float uBeat;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += objectNormal * aRise * uBeat * ${f(F.breathe)};`);
    };
    const flesh = new Mesh(mergeGeometries(parts)!, material);
    flesh.name = 'FleshThroughTheTiles';
    flesh.receiveShadow = true;
    this.root.add(flesh);
  }

  private glowMaterial(): ShaderMaterial {
    return new ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      uniforms: { ...UniformsUtils.merge([UniformsLib.fog]), ...warpUniforms },
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
  }

  private placeHalos(): void {
    const L = C.lamps;
    const G = C.figure.glare;
    const B = C.figure.glareBelow;
    const n = L.z.length;
    const at = (mesh: InstancedMesh, i: number, x: number, y: number, z: number, w: number, h: number) => {
      mesh.setMatrixAt(i, m1.compose(v1.set(x, y, z), q1.identity(), v2.set(w, h, 1)));
      mesh.setColorAt(i, c1.setRGB(0, 0, 0));
    };
    L.z.forEach((z, i) => {
      at(this.halos, i, 0, L.haloY, z, L.halo.width, L.halo.height);
      at(this.halosBelow, i, 0, -L.haloY, z, L.haloBelow.width, L.haloBelow.height);
    });
    at(this.halos, n, G.at[0], G.at[1], G.at[2], G.width, G.height);
    at(this.halosBelow, n, G.at[0], -G.at[1], G.at[2], B.width, B.height);
    const K = C.flash;
    at(this.halos, n + 1, K.light[0], K.light[1], K.light[2], K.glow.width, K.glow.height);
    const P = C.projector;
    const lens = this.beam.uLens.value;
    at(this.halos, n + 2, lens.x + this.beam.uAxisW.value.x * 0.03, lens.y, lens.z + this.beam.uAxisW.value.z * 0.03, P.glow.width, P.glow.height);
  }

  /** Far below the world: what only the pictures see. */
  private buildStage(): void {
    const S = C.stage;
    this.stage.name = 'DarkroomStage';
    this.stage.position.y = S.y;
    this.stage.visible = false;
    this.stage.add(this.shell.clone(true));
    for (const lamp of this.lamps) this.stage.add(lamp.object.clone(true));
    this.stage.add(this.foreShort.root, this.foreLong.root);
    for (const follower of this.followers) this.stage.add(follower.root);
    this.studio.name = 'DarkroomStudio';
    this.studio.position.y = S.studioY;
    this.studio.visible = false;
    for (const sitter of [...this.sitters, ...this.loopBodies]) this.studio.add(sitter.root);
    this.root.add(this.stage, this.studio);
  }

  // ------------------------------------------------------------------ the pictures

  private aim(x: number, y: number, z: number, tx: number, ty: number, tz: number, fov: number, aspect: number): void {
    const c = this.lens;
    c.fov = fov;
    c.aspect = aspect;
    c.position.set(x, y, z);
    c.lookAt(tx, ty, tz);
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
  }

  /**
   * Once: every frame of the sequence, taken on the stage; the portraits and the face in the black
   * room; the film of someone standing. Nothing here is drawn again.
   */
  develop(render: (target: WebGLRenderTarget, camera: PerspectiveCamera) => void): void {
    const S = C.stage;
    const z0 = S.cameraZ;

    this.stage.visible = true;
    for (const light of this.stageLamps) light.intensity = C.lamps.intensity;
    S.frames.forEach((frame, k) => {
      const fore = k >= S.veilFrom ? this.foreLong : this.foreShort;
      this.foreShort.root.visible = fore === this.foreShort;
      this.foreLong.root.visible = fore === this.foreLong;
      const foreZ = z0 - frame.foreAhead;
      fore.set(0, frame.foreX, 0, foreZ, Math.PI);
      fore.commit();
      const fz = foreZ - frame.behind;
      this.followers.forEach((follower, i) => (follower.root.visible = i === k));
      const follower = this.followers[k];
      follower.set(0, frame.x, 0, fz, Math.atan2(S.cameraX - frame.x, z0 - fz) + frame.turn);
      follower.commit();

      this.stageFlash.position.set(S.cameraX, S.y + frame.eye + 0.06, z0 + 0.06);
      this.stageFlash.intensity = frame.flash;
      this.stageKey.position.set(frame.x, S.y + S.keyY, fz + S.keyAhead);
      this.stageKey.intensity = frame.key;

      this.aim(S.cameraX, S.y + frame.eye, z0, S.cameraX + S.lookAside, S.y + frame.eye - 0.02, z0 - 8, frame.fov, 1);
      render(this.frames[k], this.lens);

      // where its face fell in this frame: someone will scratch it out of the print there
      v1.set(frame.x, S.y + S.faceY, fz).project(this.lens);
      v2.set(frame.x + S.scratchSize, S.y + S.faceY, fz).project(this.lens);
      this.scratchAt[k].set(v1.x * 0.5 + 0.5, v1.y * 0.5 + 0.5, Math.max(Math.abs(v2.x - v1.x) * 0.5, C.prints.scratch.least));
    });
    this.stage.visible = false;
    for (const light of this.stageLamps) light.intensity = 0;
    this.stageKey.intensity = 0;

    // the black room: portraits, each sitter alone
    this.studio.visible = true;
    const everyone = [...this.sitters, ...this.loopBodies];
    const alone = (body: Crowd) => {
      for (const other of everyone) other.root.visible = other === body;
    };
    const sit = (body: Crowd, distance: number, fov: number, under: number, intensity: number, target: WebGLRenderTarget) => {
      alone(body);
      const subject = z0 - distance;
      body.set(0, 0, 0, subject);
      body.commit();
      const y = S.studioY + crownOf(body) - under;
      const [lx, ly, lz] = S.portrait.light;
      this.stageFlash.position.set(lx, y + ly, subject + lz);
      this.stageFlash.intensity = intensity;
      this.aim(0, y, z0, 0, y, subject, fov, 1);
      render(target, this.lens);
    };
    const P = S.portrait;
    this.sitters.forEach((sitter, i) => sit(sitter, P.distance, P.fov, P.under, P.intensity, this.portraits[i]));
    const U = S.closeUp;
    sit(this.sitters[0], U.distance, U.fov, U.under, U.intensity, this.face);
    this.stageFlash.intensity = 0;

    // the film: white on black, the shape of someone rolling their head
    const O = S.loop;
    this.loopBodies.forEach((body, i) => {
      alone(body);
      const subject = z0 - O.distance;
      body.set(0, 0, 0, subject);
      body.commit();
      const y = S.studioY + O.center;
      this.aim(0, y, z0, 0, y, subject, O.fov, O.width / O.height);
      render(this.loop[i], this.lens);
    });
    this.studio.visible = false;
  }

  // ------------------------------------------------------------------ per frame

  update(frame: DreamFrame): void {
    if (frame.paused) return;
    this.clock += frame.dt;
    this.uClock.value = this.clock;
    this.uBeat.value = frame.heartbeat;
    this.uRise.value = smootherstep(range(C.facePrint.rise[0], C.facePrint.rise[1], frame.eye.z));
    this.updateFigure(frame);
    this.updateDip(frame.dt);
    this.updateLamps();
    this.updateProjector(frame.dt);
    this.updateFlash(frame);
    this.updateDrops();
    this.updateGazes(frame);
  }

  /** Every lamp breathes in its own slow, irregular way; now and then one sags. */
  private updateLamps(): void {
    const L = C.lamps;
    const B = L.breath;
    const n = L.z.length;
    for (let i = 0; i < n; i++) {
      const lamp = this.lamps[i];
      let breath = 1 - B.depth * 0.5;
      if (!REDUCED_MOTION) {
        const slow = wobble(this.clock * B.rate, 3 + i * 2.7);
        const sag = smootherstep(range(B.sag[0], B.sag[1], wobble(this.clock * B.sagRate, 11 + i * 4.1)));
        breath = (1 - B.depth * (0.5 + 0.5 * slow)) * (1 - B.sagDepth * sag);
      }
      const now = breath * this.dim;
      lamp.light.intensity = L.intensity * now;
      lamp.material.emissiveIntensity = L.tube * (0.25 + 0.75 * now);
      this.halos.setColorAt(i, c1.copy(RED_LINEAR).multiplyScalar(L.halo.strength * now));
      this.halosBelow.setColorAt(i, c1.copy(RED_LINEAR).multiplyScalar(L.haloBelow.strength * now));
    }

    // the light that throws the shadow, and the air and the meat around it
    const F = C.figure;
    const unrest = REDUCED_MOTION ? 1 : 1 - F.waver.depth * (0.5 + 0.5 * wobble(this.clock * F.waver.rate, 23));
    const spot = this.spots[0]!;
    spot.intensity = F.light.intensity * unrest * this.dim;
    this.backGlow.intensity = F.backGlow.intensity * unrest * this.dim;
    this.halos.setColorAt(n, c1.copy(RED_LINEAR).multiplyScalar(F.glare.strength * unrest * this.dim));
    this.halosBelow.setColorAt(n, c1.copy(RED_LINEAR).multiplyScalar(F.glareBelow.strength * unrest * this.dim));
    this.uLit.value = C.prints.lit * (0.2 + 0.8 * this.dim);
    for (const below of this.belowDims) below.material.color.setScalar(below.full * this.dim);
    this.halosBelow.instanceColor!.needsUpdate = true;
  }

  /** The film runs on, jumping, its light never steady: all of it slow enough not to strobe. */
  private updateProjector(dt: number): void {
    const P = C.projector;
    const K = P.flicker;
    const R = P.reel;
    let gain = K.base;
    if (!REDUCED_MOTION) {
      gain = K.base + K.depth * wobble(this.clock * K.rate, 5);
      gain *= 1 - K.dropDepth * smootherstep(range(K.drop[0], K.drop[1], wobble(this.clock * K.dropRate, 17)));
    }
    gain *= this.dim;
    this.beam.uGain.value = gain;
    this.spill.intensity = P.spill.intensity * gain;
    const n = C.lamps.z.length;
    this.halos.setColorAt(n + 2, c1.copy(this.beam.uTint.value).multiplyScalar(P.glow.strength * gain));

    const rate = REDUCED_MOTION ? R.reduced : R.rate + R.wander * wobble(this.clock * 0.5, 7);
    this.reel += dt * rate;
    const pose = Math.floor(this.reel) % this.loop.length;
    if (pose !== this.reelFrame) {
      this.reelFrame = pose;
      this.beam.tLoop.value = this.loop[pose].texture;
      this.beam.uJump.value = REDUCED_MOTION ? 0 : Math.sin(Math.floor(this.reel) * 91.7) * R.weave;
    }
    for (const spool of this.spools) spool.rotation.x -= dt * P.spin;
  }

  /** As you come level with the camera it takes your picture: one hit, and what stands in it. */
  private updateFlash(frame: DreamFrame): void {
    const K = C.flash;
    const z = frame.eye.z;
    if (z > K.rearmZ) this.flashArmed = true;
    if (this.flashArmed && z < K.atZ && this.lastEyeZ >= K.atZ) {
      this.flashArmed = false;
      this.flashAge = 0;
      const x = K.ghost.x;
      const gz = z - K.ghost.ahead;
      this.body.set(1, x, 0, gz, Math.atan2(frame.eye.x - x, z - gz));
      this.body.commit();
      this.ghostShown = true;
    }
    this.lastEyeZ = z;
    let env = 0;
    if (this.flashAge >= 0) {
      this.flashAge += frame.dt;
      const t = this.flashAge;
      if (t < K.attack) env = t / K.attack;
      else if (t < K.attack + K.hold) env = 1;
      else env = Math.max(0, 1 - (t - K.attack - K.hold) / K.fall) ** 2;
      if (this.ghostShown && t > K.ghost.seconds) {
        this.body.setMatrix(1, NOWHERE);
        this.body.commit();
        this.ghostShown = false;
      }
      if (t > K.attack + K.hold + K.fall) this.flashAge = -1;
    }
    const share = REDUCED_MOTION ? K.reduced : 1;
    this.flashLight.intensity = K.intensity * env * share;
    const n = C.lamps.z.length;
    this.halos.setColorAt(n + 1, c1.set(K.color).multiplyScalar(K.glow.strength * env * share));
    this.halos.instanceColor!.needsUpdate = true;
  }

  /** Drops swell on the prints' corners, fall, and leave rings on the floor. */
  private updateDrops(): void {
    const D = C.drops;
    const rings = this.uRipple.value;
    for (let i = 0; i < this.drips.length; i++) {
      const d = this.drips[i];
      const t = (this.clock + d.offset) % d.period;
      let age = -1;
      if (t < d.swell) {
        const r = D.radius * Math.sqrt(t / d.swell);
        this.droplets.setMatrixAt(i, m1.compose(v1.set(d.x, d.top - r * 0.7, d.z), q1.identity(), v2.set(r, r * 1.2, r)));
      } else if (t < d.swell + d.fall) {
        const s = t - d.swell;
        const y = d.top - 0.5 * D.gravity * s * s;
        this.droplets.setMatrixAt(i, m1.compose(v1.set(d.x, y, d.z), q1.identity(), v2.set(D.radius * 0.8, D.radius * (1 + (s / d.fall) * D.stretch), D.radius * 0.8)));
      } else {
        this.droplets.setMatrixAt(i, NOWHERE);
        age = t - d.swell - d.fall;
      }
      rings[i].set(d.x, d.z, Math.max(0, age), age >= 0 ? 1 : 0);
    }
    this.droplets.instanceMatrix.needsUpdate = true;
  }

  /** The lens pans after you; behind your back all the plaster heads have turned to you. */
  private updateGazes(frame: DreamFrame): void {
    const K = C.camera;
    const H = C.heads;
    const eye = frame.eye;
    // going by, the angle only ever grows: it never spins the long way round
    this.pan.rotation.y = damp(this.pan.rotation.y, Math.atan2(eye.x - K.at[0], eye.z - K.at[2]), K.follow, frame.dt);

    this.headTimer += frame.dt;
    if (this.headTimer < H.turnEvery) return;
    this.headTimer = 0;
    for (const probe of this.shelfProbes) if (!frame.unseen(probe, H.turnMargin)) return;
    for (let i = 0; i < this.headAt.length; i++) {
      const p = this.headAt[i];
      this.heads.setMatrix(i, m1.compose(p, q1.setFromAxisAngle(UP, Math.atan2(eye.x - p.x, eye.z - p.z)), UNIT));
    }
    this.heads.commit();
  }

  /** A dip of every light of this room: down and back once. */
  private updateDip(dt: number): void {
    if (this.dipAge < 0) {
      this.dim = 1;
      return;
    }
    const V = C.vanish;
    this.dipAge += dt;
    const t = this.dipAge / V.dip;
    if (t >= 1) {
      this.dipAge = -1;
      this.dim = 1;
      return;
    }
    // in the dark in the middle of it, it goes
    if (t >= 0.5 && this.place === 'end') this.leave();
    this.dim = lerp(V.floor, 1, smootherstep(Math.abs(t * 2 - 1)));
  }

  /** Where the one from the pictures is. */
  private updateFigure(frame: DreamFrame): void {
    const V = C.vanish;
    const eye = frame.eye;
    if (this.place === 'end') {
      if (eye.z > V.pastZ) {
        this.unseenFor = 0;
        this.staredFor = 0;
        return;
      }
      if (frame.unseen(this.lookedAt, V.margin)) {
        this.staredFor = 0;
        this.unseenFor += frame.dt;
        if (this.unseenFor >= V.instant) this.leave();
      } else {
        this.unseenFor = 0;
        this.staredFor += frame.dt;
        if (this.staredFor >= V.patience && this.dipAge < 0) this.dipAge = 0;
      }
      return;
    }

    const F = C.follow;
    // back out through the slit: everything is as it was
    if (eye.z > F.homeZ) {
      this.stand();
      this.redrawShadows();
      return;
    }
    if (this.placedBehind && !frame.unseen(this.followAt, F.margin)) {
      // seen: from here on it stands still, and its shadow is drawn where it stands
      if (!this.seenBehind) {
        this.seenBehind = true;
        this.redrawShadows();
      }
      return;
    }
    // looked away again: one step closer, and on the other side
    if (this.seenBehind) {
      this.seenBehind = false;
      this.gap = Math.max(F.nearest, this.gap - F.step);
      this.side = -this.side;
    }
    const z = Math.min(F.firstZ, Math.max(F.lastZ, eye.z + this.gap));
    const x = (z < F.rightOnlyFrom ? 1 : this.side) * F.x;
    if (this.placedBehind && Math.abs(z - this.followAt.z) < F.moveOver && Math.sign(x) === Math.sign(this.followAt.x)) return;
    v1.set(x, C.figure.headY, z);
    if (!frame.unseen(v1, F.margin)) return;
    this.followAt.copy(v1);
    this.placedBehind = true;
    this.stood(x, z, Math.atan2(eye.x - x, eye.z - z));
  }

  /** Write where the body stands, and its reflection. */
  private stood(x: number, z: number, heading: number): void {
    this.body.set(0, x, 0, z, heading);
    this.body.commit();
    m1.compose(v1.set(x, 0, z), q1.setFromAxisAngle(UP, heading), v2.set(1, -1, 1));
    this.bodyBelow.setMatrix(0, m1);
    this.bodyBelow.commit();
  }

  /** At the far end, its back to you. */
  private stand(): void {
    this.place = 'end';
    this.placedBehind = false;
    this.seenBehind = false;
    this.gap = C.follow.gap;
    this.side = 1;
    this.unseenFor = 0;
    this.staredFor = 0;
    this.stood(C.figure.at[0], C.figure.at[1], Math.PI);
    this.body.setMatrix(1, NOWHERE);
    this.body.commit();
    this.ghostShown = false;
  }

  /** Gone. Its shadow goes with it. */
  private leave(): void {
    this.place = 'behind';
    this.placedBehind = false;
    this.seenBehind = false;
    this.body.setMatrix(0, NOWHERE);
    this.body.commit();
    this.bodyBelow.setMatrix(0, NOWHERE);
    this.bodyBelow.commit();
    this.redrawShadows();
  }

  /** The space's shadow map is drawn once, when its first light changes: give it another one just like it. */
  private redrawShadows(): void {
    const next = this.spots[0] === this.lightA ? this.lightB : this.lightA;
    next.intensity = this.spots[0]!.intensity;
    this.spots[0] = next;
  }

  reset(): void {
    this.stand();
    this.redrawShadows();
    this.dipAge = -1;
    this.dim = 1;
    this.flashAge = -1;
    this.flashArmed = true;
    this.flashLight.intensity = 0;
    this.headTimer = 0;
    this.uRise.value = 0;
    this.lookAtTheCorridor(this.heads);
  }
}
