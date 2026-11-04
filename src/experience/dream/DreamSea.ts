import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
  BufferAttribute,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  UniformsLib,
  UniformsUtils,
  Vector3,
  Vector4,
  type BufferGeometry,
  type Material,
  type SkinnedMesh,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DreamKit } from './DreamKit';
import type { DreamFrame } from './DreamModule';
import { randomFrom, hairMap, headMap, type Crowd, type FigureSpec } from './FigureKit';
import { onLang, say } from '../../ui/i18n';
import { dreamConfig } from '../../config/dream.config';
import { photoConfig, REDUCED_MOTION } from '../../config/experience.config';
import { fireEscape, LIGHT_COLORS, lightingConfig } from '../../config/scene.config';
import { inSea, seaConfig, type CrowdPose } from '../../config/sea.config';
import { walkConfig } from '../../config/walk.config';
import { DEG, lerp, range, smootherstep, wobble } from '../math';
import { Photograph } from '../photograph/Photograph';
import { Grade } from '../render/Grade';
import { WARP_GLSL, warpUniforms } from '../render/Warp';
import type { Alley } from '../world/Alley';
import { MirrorWater, SWELL_GLSL, swellHeight } from './MirrorWater';

type V3 = readonly [number, number, number];
type Shader = WebGLProgramParametersWithUniforms;

export interface SeaContext {
  /** Pictures for the drifting prints. */
  moments: readonly Texture[];
  /** The moon's picture (a render of the opening view). */
  moonPhoto: Texture;
}

/** A soft glow at a point (walk frame): size across and up (m), and its color times its strength. */
interface Glow {
  at: Vector3;
  width: number;
  height: number;
  color: Color;
}

const { print, image } = photoConfig;
const ORIGIN = new Vector3();
const UP = new Vector3(0, 1, 0);
/** Where the walk frame is drawn in the sea. */
const SEA = new Vector3(...seaConfig.offset);
/** Burnt paper: front, edges, back colors, and one roughness for all of it; the picture on it keeps this share of its light. */
const PAPER = { front: 0x8f7c62, edge: 0x2c211a, back: 0x121112, roughness: 0.8, picture: 0.6 };
/** Image center above the print's center, and its lift off the paper (m, at real print size). */
const IMAGE_CENTER_Y = print.height / 2 - image.offsetFromTop - image.size / 2;
const IMAGE_LIFT = 0.00006;
/** Light strips sit this far (m) in front of the face they light, clear of it in the depth buffer even far away. */
const SURFACE_GAP = 0.01;
/** BoxGeometry faces in order px, nx, py, ny, pz, nz: four vertices and six indices each. */
const FRONT_FACE = 4;
const BACK_FACE = 5;
/** Tries to find a place clear of the way and of other things before taking the last try. */
const PLACE_TRIES = 64;
/** Glows are drawn after the other see-through things (additive: among themselves order never matters). */
const GLOW_ORDER = 1;
/** Drawn over everything, whatever the camera. */
const LID_ORDER = 100;
/** Under the oil, out of sight even in the deepest trough (m). */
const WAITING = -3.5;
/** Where a body's eyes are, near enough, to tell whether it is seen (m above the oil). */
const SEEN_AT = 0.9;
/** How wide (m) a place around a door or a lamp stays free of bodies; how wide around the duck, and the stairs' foot. */
const KEEP_OUT = { door: 2.4, lamp: 1.8, duck: 7.5, stairs: 3.2, figure: 5.5 };
/**
 * The ring around a body: how far from its middle (m) the oil stands up against it, how sharply (1/m), how strong the rings
 * leaving it are beside that; how far above the surface it lies (m, and more the farther off), and by how far away (m) it is gone.
 */
const RING = { waist: 0.3, lip: 11, waves: 0.42, lift: 0.03, liftPerMeter: 0.0015, fadeBy: 46 };
/** A lamp starts to dip when its slow wobble passes the first value, and is all the way down at the second. */
const LAMP_DIPS = [0.15, 0.62] as const;

const box = new Box3();
const v1 = new Vector3();
const v2 = new Vector3();
const m1 = new Matrix4();
const q1 = new Quaternion();
const q2 = new Quaternion();
const e1 = new Euler();
const c1 = new Color();

const glslFloat = (v: number) => v.toFixed(5);
const glslVec3 = (c: readonly number[]) => `vec3(${c.map(glslFloat).join(', ')})`;

function meshesOf(root: Object3D): Mesh[] {
  const list: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) list.push(o as Mesh);
  });
  return list;
}

/** Value noise for the sea's shaders (needs nothing). */
const NOISE_GLSL = /* glsl */ `
float seaCell(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float seaNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(seaCell(i), seaCell(i + vec2(1.0, 0.0)), f.x), mix(seaCell(i + vec2(0.0, 1.0)), seaCell(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

// ------------------------------------------------------------------ the sun's light, without a light

const L = seaConfig.sunlight;
/** Where the light comes from: from the middle of the crowd toward the sun, the same for all of it. */
const SUN_DIRECTION = new Vector3(...L.from).sub(new Vector3(0, 0, -262)).normalize();

/**
 * What the sun and the sky do to what they face: a term in the shader instead of a light, so nothing
 * recompiles and nothing costs a shadow. Its fronts burn when you have your back to it, its backs are
 * black against it with a thin rim of fire, and the sky comes down rust on everything.
 */
const SUNLIGHT_GLSL = /* glsl */ `
{
  vec3 sunward = normalize(mat3(viewMatrix) * ${glslVec3(SUN_DIRECTION.toArray())});
  float lit = saturate((dot(geometryNormal, sunward) + ${glslFloat(L.wrap)}) / ${glslFloat(1 + L.wrap)});
  reflectedLight.directDiffuse += ${glslVec3(L.color)} * lit * lit * BRDF_Lambert(material.diffuseContribution);
  float overhead = dot(geometryNormal, mat3(viewMatrix) * vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5;
  reflectedLight.indirectDiffuse += mix(${glslVec3(L.oil)}, ${glslVec3(L.sky)}, overhead) * BRDF_Lambert(material.diffuseContribution);
  float graze = 1.0 - saturate(dot(geometryNormal, geometryViewDir));
  float against = saturate(dot(-geometryViewDir, sunward));
  reflectedLight.directSpecular += ${glslVec3(L.color)} * graze * graze * graze * against * against * ${glslFloat(L.rim)} * (0.12 + material.diffuseContribution) * RECIPROCAL_PI;
}
`;

function sunlit(shader: Shader): void {
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${SUNLIGHT_GLSL}`);
}

/** A material of the sea: the same, sunlit (and whatever else `patch` does to its shader). */
function sunlitCopy(source: MeshStandardMaterial, key: string, patch?: (shader: Shader) => void): MeshStandardMaterial {
  const m = source.clone();
  m.forceSinglePass = true;
  m.onBeforeCompile = (shader, renderer) => {
    source.onBeforeCompile(shader, renderer);
    sunlit(shader);
    patch?.(shader);
  };
  m.customProgramCacheKey = () => `sea-${key}-${source.customProgramCacheKey()}`;
  return m;
}

// ------------------------------------------------------------------ stone

const T = seaConfig.stain;
const MOUTH = seaConfig.singer.mouth;
/** How the dark of her mouth falls off: from which share of its size, how deep it goes into the head (model's numbers). */
const MOUTH_DARK = { from: 0.72, depth: 0.16 };
/** How dark the grime can get, how light the stone between it (shares of its color), how dark the runs, and the oil where it has climbed. */
const STAIN = { grime: [0.36, 1.1] as const, runs: 0.42, oil: 0.025 };

/** Her jaw, dropped, in a copy of the scan's shape: everything below the lips and in front of the throat goes down with it. */
function jawDropped(mesh: Mesh): void {
  const geometry = mesh.geometry.clone();
  const p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const below = MOUTH.at[1] - p.getY(i);
    if (below <= 0) continue;
    const aside = Math.hypot(p.getX(i) - MOUTH.at[0], p.getZ(i) - MOUTH.at[2]);
    const share = (1 - smootherstep(range(MOUTH.wide * 0.45, MOUTH.wide, aside))) * smootherstep(range(0, MOUTH.reach * 0.05, below)) * (1 - smootherstep(range(MOUTH.reach * 0.55, MOUTH.reach, below)));
    p.setY(i, p.getY(i) - MOUTH.drop * share);
  }
  mesh.geometry = geometry;
}

/** The colossal heads are unwrapped scans: their stains come from where each point lies. With `mouth`, the dark inside hers. */
function stainedStone(color: number, mouth: boolean): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color, roughness: 0.93, metalness: 0 });
  const facing = MOUTH.facing * DEG;
  m.onBeforeCompile = (shader) => {
    sunlit(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStoneAt;\nvarying vec3 vScan;')
      .replace('#include <project_vertex>', 'vStoneAt = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvScan = position;\n#include <project_vertex>');
    const dark = mouth
      ? `vec3 inMouth = vScan - ${glslVec3([MOUTH.at[0], MOUTH.at[1] - MOUTH.drop / 2, MOUTH.at[2]])};
      float across = dot(inMouth.xz, vec2(${glslFloat(Math.cos(facing))}, ${glslFloat(-Math.sin(facing))})) / ${glslFloat(MOUTH.dark[0])};
      float down = inMouth.y / ${glslFloat(MOUTH.dark[1])};
      float front = dot(inMouth.xz, vec2(${glslFloat(Math.sin(facing))}, ${glslFloat(Math.cos(facing))}));
      diffuseColor.rgb *= 1.0 - (1.0 - smoothstep(${glslFloat(MOUTH_DARK.from)}, 1.0, across * across + down * down)) * step(${glslFloat(-MOUTH_DARK.depth)}, front);`
      : '';
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vStoneAt;\nvarying vec3 vScan;\n${NOISE_GLSL}`).replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      float grime = seaNoise(vec2(vStoneAt.x + vStoneAt.z * 0.7, vStoneAt.y * 0.4) * ${glslFloat(T.scale)});
      float runs = seaNoise(vec2((vStoneAt.x - vStoneAt.z) * ${glslFloat(T.scale * 3.1)}, vStoneAt.y * ${glslFloat(T.scale * 0.22)}));
      diffuseColor.rgb *= mix(${glslFloat(STAIN.grime[0])}, ${glslFloat(STAIN.grime[1])}, grime) * mix(${glslFloat(STAIN.runs)}, 1.0, runs);
      // how high the oil has climbed, running down from there
      diffuseColor.rgb *= mix(${glslFloat(STAIN.oil)}, 1.0, smoothstep(0.0, ${glslFloat(T.tide)}, vStoneAt.y + (runs - 0.5) * ${glslFloat(T.tide * 1.3)}));
      ${dark}`,
    );
  };
  m.customProgramCacheKey = () => `sea-stone-${mouth}`;
  return m;
}

// ------------------------------------------------------------------ half of them

/** A body that ends somewhere: triangles wholly below `cutAt` are gone, and with `cell` (m) vertices that close collapse into one. */
function trimmed(geometry: BufferGeometry, cutAt: number, cell: number): BufferGeometry {
  const p = geometry.getAttribute('position');
  const index = geometry.getIndex()!;
  const into = new Int32Array(p.count);
  const cells = new Map<number, number>();
  for (let i = 0; i < p.count; i++) {
    if (cell <= 0) {
      into[i] = i;
      continue;
    }
    // a body fits in 10 bits per axis at any cell worth using
    const key = (Math.round(p.getX(i) / cell) + 512) | ((Math.round(p.getY(i) / cell) + 512) << 10) | ((Math.round(p.getZ(i) / cell) + 512) << 20);
    const known = cells.get(key);
    if (known === undefined) cells.set(key, i);
    into[i] = known ?? i;
  }
  const kept: number[] = [];
  for (let t = 0; t + 2 < index.count; t += 3) {
    const a = into[index.getX(t)];
    const b = into[index.getX(t + 1)];
    const c = into[index.getX(t + 2)];
    if (a === b || b === c || a === c) continue;
    if (Math.max(p.getY(a), p.getY(b), p.getY(c)) < cutAt) continue;
    kept.push(a, b, c);
  }
  geometry.setIndex(kept);
  return geometry;
}

const crowdMaterials = new Map<Material, MeshStandardMaterial>();
/** One draw per material instead of one per part of the model, less of it, and sunlit. */
function slimmed(crowd: Crowd, cutAt: number, cell: number): void {
  const parts = new Map<Material, InstancedMesh[]>();
  for (const child of crowd.root.children) {
    const mesh = child as InstancedMesh;
    const material = mesh.material as Material;
    parts.set(material, [...(parts.get(material) ?? []), mesh]);
  }
  parts.forEach((meshes, material) => {
    const [first, ...rest] = meshes;
    first.geometry = trimmed(mergeGeometries(meshes.map((m) => m.geometry))!, cutAt, cell);
    let own = crowdMaterials.get(material);
    if (!own) {
      own = sunlitCopy(material as MeshStandardMaterial, 'body');
      crowdMaterials.set(material, own);
    }
    for (const mesh of meshes) mesh.material = own;
    for (const other of rest) other.visible = false;
  });
}

const F = seaConfig.figure;
const MEAT = F.meat;
/** The cut's own: how wet it is (roughness), and its fibres, patches and lines of fat (noise cells per m, across and down). */
const SLICE = { roughness: 0.3, fibres: [90, 4.5] as const, patches: [13, 3.5] as const, fat: [26, 2.6] as const };

/**
 * The photographer's half: cut by a plane in the world through the body as it stands, and solid. What is seen through
 * the cut (the inside of the far wall of the body) is drawn as what the ray met on its way in: a flat slice of meat on
 * the cut's plane. `solid` false (hair): only ends there.
 */
function sliced(cut: Vector4, tangent: Vector3, anchor: readonly number[], solid: boolean): (shader: Shader) => void {
  const plane = `vec4(${[cut.x, cut.y, cut.z, cut.w].map(glslFloat).join(', ')})`;
  return (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutAt;')
      .replace('#include <project_vertex>', 'vCutAt = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>');
    const slice = solid
      ? /* glsl */ `
      inSlice = !gl_FrontFacing;
      if (inSlice) {
        vec3 ray = vCutAt - cameraPosition;
        vec3 at = cameraPosition + ray * (CUT.w - dot(CUT.xyz, cameraPosition)) / dot(CUT.xyz, ray) - ${glslVec3(anchor)};
        float u = dot(at, ${glslVec3(tangent.toArray())});
        // long fibres, darker and redder in slow patches, and fat running down it in thin wandering lines
        float fibres = seaNoise(vec2(u * ${glslFloat(SLICE.fibres[0])}, at.y * ${glslFloat(SLICE.fibres[1])}));
        float marble = seaNoise(vec2(u * ${glslFloat(SLICE.patches[0])} + at.y * 2.0, at.y * ${glslFloat(SLICE.patches[1])}) + 7.3);
        diffuseColor.rgb = mix(${glslVec3(MEAT.deep)}, ${glslVec3(MEAT.red)}, smoothstep(0.2, 0.85, fibres * 0.45 + marble * 0.55));
        float fat = 1.0 - abs(seaNoise(vec2(u * ${glslFloat(SLICE.fat[0])} - at.y * 1.5, at.y * ${glslFloat(SLICE.fat[1])}) + 3.1) * 2.0 - 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, ${glslVec3(MEAT.fat)}, 0.8 * smoothstep(0.93, 0.99, fat));
        sliceColor = diffuseColor.rgb;
      }`
      : '';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCutAt;\nconst vec4 CUT = ${plane};\n${NOISE_GLSL}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        bool inSlice = false;
        vec3 sliceColor = vec3(0.0);
        float torn = sin(vCutAt.y * 37.0 + vCutAt.x * 61.0) * 0.007 + sin(vCutAt.z * 83.0 - vCutAt.y * 29.0) * 0.005;
        if (dot(CUT.xyz, vCutAt) - CUT.w + torn > 0.0) discard;
        ${slice}`,
      )
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nif (inSlice) roughnessFactor = ${glslFloat(SLICE.roughness)};`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nif (inSlice) metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nif (inSlice) normal = normalize(mat3(viewMatrix) * CUT.xyz);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\nif (inSlice) totalEmissiveRadiance += sliceColor * ${glslFloat(MEAT.glow)};`);
  };
}

// ------------------------------------------------------------------ glows

const GLOW_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${WARP_GLSL}
uniform float uPull;
varying vec2 vOffset;
varying vec3 vGlow;
void main() {
  #ifdef USE_INSTANCING
    mat4 placed = instanceMatrix;
  #else
    mat4 placed = mat4(1.0);
  #endif
  #ifdef USE_INSTANCING_COLOR
    vGlow = instanceColor;
  #else
    vGlow = vec3(1.0);
  #endif
  vOffset = position.xy * 2.0;
  vec2 size = vec2(length(placed[0].xyz), length(placed[1].xyz));
  // a quad facing the eye, moved toward it along its line of sight (never past halfway) so the thing it
  // surrounds does not cut it, and shrunk by as much, so it keeps its place and size on screen; curved
  // space takes it to where it takes what it surrounds
  vec4 mvPosition = dreamWarp(modelViewMatrix * placed * vec4(0.0, 0.0, 0.0, 1.0));
  float dist = length(mvPosition.xyz);
  float keep = 1.0 - min(uPull * min(size.x, size.y), dist * 0.5) / max(dist, 1e-4);
  mvPosition.xyz *= keep;
  mvPosition.xy += position.xy * size * keep;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const GLOW_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uScatter;
varying vec2 vOffset;
varying vec3 vGlow;
void main() {
  float r2 = dot(vOffset, vOffset);
  if (r2 >= 1.0) discard;
  // light scattered by the haze: inverse-square, brought down to nothing at the quad's edge
  float edge = 1.0 / (1.0 + uScatter);
  float glow = (1.0 / (1.0 + r2 * uScatter) - edge) / (1.0 - edge);
  vec3 c = vGlow * glow;
  #ifdef USE_FOG
    // on its way through the haze the glow fades; it does not take the haze's color
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    c *= 1.0 - fogFactor;
  #endif
  gl_FragColor = vec4(c, 1.0);
}
`;

function glowMaterial(scatter: number, pull: number, fog: boolean): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    uniforms: { ...UniformsUtils.merge([UniformsLib.fog, { uScatter: { value: scatter }, uPull: { value: pull } }]), ...warpUniforms },
    fog,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

/** All glows of one kind in one draw: camera-facing quads, sized and tinted per instance. */
function glowMesh(glows: readonly Glow[], material: ShaderMaterial): InstancedMesh {
  const mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, glows.length);
  mesh.name = 'Glows';
  let largest = 0;
  glows.forEach((g, i) => {
    mesh.setMatrixAt(i, m1.compose(g.at, q1.identity(), v1.set(g.width, g.height, 1)));
    mesh.setColorAt(i, g.color);
    largest = Math.max(largest, g.width, g.height);
  });
  mesh.computeBoundingSphere();
  // the quads turn to every eye and are drawn toward it
  if (mesh.boundingSphere) mesh.boundingSphere.radius += largest * material.uniforms.uPull.value;
  // after the see-through glass they sit in front of (a pane drawn later would dim them)
  mesh.renderOrder = GLOW_ORDER;
  return mesh;
}

// ------------------------------------------------------------------ the sun

const SUN = seaConfig.sun;
/**
 * How hot a point of the sun is: what is left at the limb (the rest grows with how much it faces you), what the cells
 * take away and add, how far the larger movement stirs them; and at what heat it goes from dirt to limb, to body, to heart.
 */
const HEAT = { limb: 0.42, cells: [0.45, 1.15] as const, stir: 3.2, stops: [0.1, 0.36, 0.72, 1.05] as const };

const SUN_VERT = /* glsl */ `
${WARP_GLSL}
varying vec2 vDisc;
void main() {
  vDisc = position.xy;
  gl_Position = projectionMatrix * dreamWarp(modelViewMatrix * vec4(position, 1.0));
}
`;

const SUN_FRAG = /* glsl */ `
uniform float uBoil;
varying vec2 vDisc;
${NOISE_GLSL}
float boiling(vec2 p, int depth) {
  float sum = 0.0;
  float share = 0.5;
  for (int i = 0; i < depth; i++) {
    sum += share * seaNoise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    share *= 0.5;
  }
  return sum;
}
void main() {
  float toward = sqrt(max(1.0 - dot(vDisc, vDisc), 0.0));
  float t = uBoil * ${glslFloat(SUN.boil.rate)};
  // the surface boils in small cells, each stirred by the larger movement under it
  vec2 p = vDisc * ${glslFloat(SUN.boil.scale)};
  vec2 stir = vec2(boiling(p * 0.5 + vec2(0.0, t), 3), boiling(p * 0.5 + vec2(5.2, 1.3 - t * 0.8), 3));
  float cells = boiling(p + ${glslFloat(HEAT.stir)} * stir + vec2(t * 0.7, -t * 0.4), 4);
  // before it, smoke: long dirty bands that drift by
  float smoke = boiling(vec2(vDisc.x * ${glslFloat(SUN.smoke.along)} + t * ${glslFloat(SUN.smoke.drift)}, vDisc.y * ${glslFloat(SUN.smoke.across)}), 4);
  // hottest where it enters the oil, dull and bloody toward the top and the limb
  float heat = (${glslFloat(HEAT.limb)} + ${glslFloat(1 - HEAT.limb)} * toward * toward) * (1.0 - ${glslFloat(SUN.cool)} * vDisc.y) * (${glslFloat(HEAT.cells[0])} + ${glslFloat(HEAT.cells[1])} * cells);
  heat *= 1.0 - ${glslFloat(SUN.smoke.strength)} * smoothstep(${glslFloat(SUN.smoke.from)}, ${glslFloat(SUN.smoke.to)}, smoke);
  vec3 c = mix(${glslVec3(SUN.vein)}, ${glslVec3(SUN.limb)}, smoothstep(${glslFloat(HEAT.stops[0])}, ${glslFloat(HEAT.stops[1])}, heat));
  c = mix(c, ${glslVec3(SUN.body)}, smoothstep(${glslFloat(HEAT.stops[1])}, ${glslFloat(HEAT.stops[2])}, heat));
  c = mix(c, ${glslVec3(SUN.heart)}, smoothstep(${glslFloat(HEAT.stops[2])}, ${glslFloat(HEAT.stops[3])}, heat));
  gl_FragColor = vec4(c, 1.0);
}
`;

const SHEET_VERT = /* glsl */ `
${WARP_GLSL}
varying vec2 vSheet;
void main() {
  vSheet = position.xy;
  gl_Position = projectionMatrix * dreamWarp(modelViewMatrix * vec4(position, 1.0));
  // it reaches high up: looking up, the far plane must not cut across what is left of the glow
  gl_Position.z = min(gl_Position.z, gl_Position.w);
}
`;

const SHEET_FRAG = /* glsl */ `
uniform float uBoil;
varying vec2 vSheet;
${NOISE_GLSL}
void main() {
  float r = length(vSheet);
  float beyond = max(r - 1.0, 0.0);
  // the rim licks: its reach goes in and out around the disc, slowly
  float lick = 0.65 + 0.7 * seaNoise(vSheet / max(r, 1e-3) * 4.5 + vec2(uBoil * 0.05, -uBoil * 0.03));
  vec3 c = ${glslVec3(SUN.rim.color)} * exp(-beyond * ${glslFloat(SUN.rim.falloff)} / lick);
  float far = beyond / ${glslFloat(SUN.halo.reach)};
  c += ${glslVec3(SUN.halo.color)} / (1.0 + far * far);
  c *= 1.0 - smoothstep(0.55, 1.0, r / ${glslFloat(SUN.sheet)});
  gl_FragColor = vec4(c, 1.0);
}
`;

// ------------------------------------------------------------------ the oil around a body

const R = seaConfig.rings;

const RING_VERT = /* glsl */ `
${WARP_GLSL}
${SWELL_GLSL}
varying vec2 vRing;
varying float vDepth;
void main() {
  // a body still under the oil has a ring of no size
  float size = length(instanceMatrix[0].xyz);
  vRing = position.xz * ${glslFloat(R.reach)};
  vec3 world = vec3(instanceMatrix[3].x + modelMatrix[3].x + vRing.x * size, modelMatrix[3].y, instanceMatrix[3].z + modelMatrix[3].z + vRing.y * size);
  world.y += swellHeight(world.xz);
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  vDepth = -mvPosition.z;
  mvPosition = viewMatrix * vec4(world + vec3(0.0, ${glslFloat(RING.lift)} + vDepth * ${glslFloat(RING.liftPerMeter)}, 0.0), 1.0);
  gl_Position = projectionMatrix * dreamWarp(mvPosition);
}
`;

const RING_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vRing;
varying float vDepth;
void main() {
  float r = length(vRing);
  // the oil stands up a little against the body; rings leave it, heavily
  float lip = (r - ${glslFloat(RING.waist)}) * ${glslFloat(RING.lip)};
  float wave = 0.5 + 0.5 * sin((r - uTime * ${glslFloat(R.speed)}) * ${glslFloat(R.frequency * Math.PI * 2)});
  float rings = wave * wave * wave * (1.0 - smoothstep(${glslFloat(RING.waist)}, ${glslFloat(R.reach)}, r));
  float light = (exp(-lip * lip) + rings * ${glslFloat(RING.waves)}) * ${glslFloat(R.light)} * (1.0 - smoothstep(0.0, ${glslFloat(RING.fadeBy)}, vDepth));
  gl_FragColor = vec4(${glslVec3(R.tint)} * light, 1.0);
}
`;

// ------------------------------------------------------------------ the ash

const A = seaConfig.ash;

const ASH_VERT = /* glsl */ `
${WARP_GLSL}
uniform float uFall;
attribute float aSpark;
varying vec2 vFlake;
varying float vSpark;
varying float vFade;
void main() {
  // each flake's place in the box is its instance's own (the box goes with the eye)
  vec3 seed = instanceMatrix[3].xyz;
  vec3 box = ${glslVec3(A.box)};
  float own = fract(seed.x * 7.13 + seed.z * 3.71);
  vec3 p = seed * box;
  p.y -= uFall * ${glslFloat(A.fall)} * (0.55 + own * 0.9);
  p.x += sin(uFall * 0.31 + own * 40.0) * ${glslFloat(A.sway)};
  p.z += cos(uFall * 0.23 + own * 57.0) * ${glslFloat(A.sway)};
  p = mod(p - cameraPosition + box * 0.5, box) - box * 0.5 + cameraPosition;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  float depth = -mvPosition.z;
  // gone before it could touch the eye, and before it wraps around the box
  vFade = smoothstep(0.35, 1.3, depth) * (1.0 - smoothstep(box.x * 0.3, box.x * 0.48, depth));
  vSpark = aSpark;
  float turn = own * 6.2831853 + uFall * 0.4 * (own - 0.5);
  float c = cos(turn), s = sin(turn);
  vFlake = position.xy * 2.0;
  vec2 corner = position.xy * vec2(1.0, 0.55) * ${glslFloat(A.size)} * (0.6 + own * 1.4);
  mvPosition = dreamWarp(mvPosition);
  mvPosition.xy += vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const ASH_FRAG = /* glsl */ `
varying vec2 vFlake;
varying float vSpark;
varying float vFade;
void main() {
  float a = (1.0 - smoothstep(0.55, 1.0, dot(vFlake, vFlake))) * vFade;
  gl_FragColor = vec4(mix(${glslVec3(A.dark)}, ${glslVec3(A.spark)}, vSpark), a);
}
`;

// ------------------------------------------------------------------ the eyelid

const LID_VERT = /* glsl */ `
varying vec2 vScreen;
void main() {
  vScreen = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** The lids' opening (half height, share of the frame's) when they are open, its soft edge, how it narrows to the corners. */
const LID = { open: 2.3, soft: 0.2, almond: 0.36 };

const LID_FRAG = /* glsl */ `
uniform float uClosed;
varying vec2 vScreen;
void main() {
  float gap = (1.0 - uClosed) * ${glslFloat(LID.open)} * (1.0 - ${glslFloat(LID.almond)} * vScreen.x * vScreen.x) - ${glslFloat(LID.soft)};
  gl_FragColor = vec4(0.0, 0.0, 0.0, smoothstep(gap, gap + ${glslFloat(LID.soft)}, abs(vScreen.y)));
}
`;

// ------------------------------------------------------------------ geometry

/** The paper of a print as one body: front, edges and back told apart by vertex colors (one draw for all). */
function paperGeometry(): BoxGeometry {
  const geometry = new BoxGeometry(print.width, print.height, print.thickness);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  const front = new Color(PAPER.front);
  const edge = new Color(PAPER.edge);
  const back = new Color(PAPER.back);
  for (let f = 0; f < 6; f++) {
    const c = f === FRONT_FACE ? front : f === BACK_FACE ? back : edge;
    for (let i = f * 4; i < f * 4 + 4; i++) c.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.clearGroups();
  return geometry;
}

/** Place copies of a prop by its bounds (as the alley does) and bake them into one instanced mesh per part. */
function instancedProps(alley: Alley, key: string, placements: readonly { at: V3; rotation: V3 }[], nodes?: readonly string[]): Group {
  const scratch = new Group();
  const copies = placements.map((p) => alley.prop(key, p.at, p.rotation, { nodes, castShadow: false }, scratch));
  scratch.updateMatrixWorld(true);
  const group = new Group();
  group.name = key;
  const parts = copies.map(meshesOf);
  parts[0]?.forEach((mesh, j) => {
    const inst = new InstancedMesh(mesh.geometry, mesh.material, copies.length);
    inst.name = `${key}:${mesh.name}`;
    parts.forEach((list, i) => inst.setMatrixAt(i, list[j].matrixWorld));
    inst.computeBoundingSphere();
    group.add(inst);
  });
  return group;
}

/** A transform in a placed object's frame: offset (m) and size (m), in the frame the object was placed in. */
function within(parent: Object3D, x: number, y: number, z: number, sx: number, sy: number, sz: number): Matrix4 {
  return new Matrix4().compose(v1.set(x, y, z), q1.identity(), new Vector3(sx, sy, sz)).premultiply(parent.matrixWorld);
}

function instancedBoxes(geometry: BoxGeometry | PlaneGeometry, material: Material, matrices: readonly Matrix4[]): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.computeBoundingSphere();
  return mesh;
}

/** The film's back, drawn into `canvas` with a handwritten `caption` (redrawn when the language changes). */
function drawFilmBack(canvas: HTMLCanvasElement, caption: string): void {
  const B = seaConfig.printBack;
  const w = B.resolution;
  const h = Math.round((w * print.height) / print.width);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = B.film;
  ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const rnd = randomFrom(B.seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * B.grain;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = B.ink;
  ctx.font = `${Math.round(w * B.caption.size)}px "Just Me Again Down Here", "Segoe Script", cursive`;
  ctx.textAlign = 'center';
  ctx.save();
  ctx.translate(w * 0.5, h * B.caption.at);
  ctx.rotate(B.caption.tilt);
  ctx.fillText(caption, 0, 0);
  ctx.restore();
}

// ------------------------------------------------------------------ drifting prints

interface Drifter {
  base: Vector3;
  /** Two drift directions (m per unit of sway), the sway rate (rad / s) and three phases. */
  a: Vector3;
  b: Vector3;
  rate: number;
  phase: readonly [number, number, number];
  /** Turning: axis and rate (rad / s); rocking axis; resting orientation. */
  axis: Vector3;
  spin: number;
  rockAxis: Vector3;
  rest: Quaternion;
  image: InstancedMesh | null;
  slot: number;
}

const BURN = seaConfig.prints.burn;
/** Each print burns by its own pattern: its noise has this many blotches across the paper. Where the paper starts to char and how far it is coal, and where it is alight (shares of the way to gone). */
const BURN_BLOTCHES = 4.2;
const BURN_EDGE = { char: [0.72, 0.93] as const, alight: [0.95, 0.995] as const, offset: 0.2 };

/** The fire has been at them: their edges are eaten away by the same pattern on the paper and on the picture, with a live rim. */
function burnt(material: Material): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSeed;\nvarying vec3 vPrint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPrint = vec3(position.xy, aSeed);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPrint;\n${NOISE_GLSL}`)
      .replace(
        '#include <opaque_fragment>',
        `vec2 onPaper = vPrint.xy / vec2(${glslFloat(print.width / 2)}, ${glslFloat(print.height / 2)});
        float grain = seaNoise(onPaper * ${glslFloat(BURN_BLOTCHES)} + vPrint.z) * 0.65 + seaNoise(onPaper * ${glslFloat(BURN_BLOTCHES * 2.7)} - vPrint.z) * 0.35;
        float burned = max(abs(onPaper.x), abs(onPaper.y)) + (grain - 0.5) * ${glslFloat(BURN.grain)} + ${glslFloat(BURN.reach - BURN_EDGE.offset)};
        if (burned > 1.0) discard;
        outgoingLight = mix(outgoingLight, vec3(${glslFloat(BURN.char)}), smoothstep(${glslFloat(BURN_EDGE.char[0])}, ${glslFloat(BURN_EDGE.char[1])}, burned));
        outgoingLight += ${glslVec3(BURN.ember)} * smoothstep(${glslFloat(BURN_EDGE.alight[0])}, ${glslFloat(BURN_EDGE.alight[1])}, burned);
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `sea-burnt-${material.type}`;
}

/**
 * Burnt photographs drifting over the oil like slow birds: each sways along its own two directions,
 * rocks and turns slowly about its own axis. All papers in one draw, the pictures in one per picture.
 */
class DriftingPrints {
  readonly group = new Group();
  private readonly paper: InstancedMesh;
  private readonly images: InstancedMesh[] = [];
  private readonly drifters: Drifter[] = [];
  private readonly scale: Vector3;
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();

  constructor(pictures: readonly Texture[]) {
    const P = seaConfig.prints;
    const rnd = randomFrom(P.seed);
    const { x, y, z } = P.region;
    this.group.name = 'DriftingPrints';
    this.scale = new Vector3().setScalar(P.scale);

    const placed: Vector3[] = [];
    for (let i = 0; i < P.count; i++) {
      const at = new Vector3();
      for (let t = 0; t < PLACE_TRIES; t++) {
        at.set(lerp(x[0], x[1], rnd()), lerp(y[0], y[1], rnd()), lerp(z[0], z[1], rnd()));
        const overWay = Math.abs(at.x) < P.clear.halfWidth && at.y < P.clear.height;
        if (!overWay && !placed.some((p) => p.distanceTo(at) < P.spacing)) break;
      }
      placed.push(at);
    }

    const direction = (vertical: number) => new Vector3(rnd() * 2 - 1, (rnd() * 2 - 1) * vertical, rnd() * 2 - 1).normalize();
    const counts = pictures.map(() => 0);
    const seeds = placed.map(() => rnd() * 100);
    placed.forEach((base, i) => {
      const picture = pictures.length ? i % pictures.length : -1;
      const period = lerp(P.drift.period[0], P.drift.period[1], rnd());
      const yaw = rnd() * Math.PI * 2;
      const stray = () => (rnd() * 2 - 1) * P.spin.stray;
      const lean = () => (rnd() * 2 - 1) * P.lean * DEG;
      this.drifters.push({
        base,
        a: direction(P.drift.rise),
        b: direction(1),
        rate: (Math.PI * 2) / period,
        phase: [rnd() * Math.PI * 2, rnd() * Math.PI * 2, rnd() * Math.PI * 2],
        axis: new Vector3(stray(), 1, stray()).normalize(),
        spin: (rnd() < 0.5 ? -1 : 1) * P.spin.rate * DEG * lerp(P.spin.least, 1, rnd()),
        rockAxis: new Vector3(Math.cos(yaw), 0, Math.sin(yaw)),
        rest: new Quaternion().setFromEuler(new Euler(lean(), rnd() * Math.PI * 2, lean(), 'YXZ')),
        image: null,
        slot: picture >= 0 ? counts[picture]++ : 0,
      });
    });

    const paperShape = paperGeometry();
    paperShape.setAttribute('aSeed', new InstancedBufferAttribute(new Float32Array(seeds), 1));
    const paperMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: PAPER.roughness, metalness: 0 });
    burnt(paperMaterial);
    this.paper = new InstancedMesh(paperShape, paperMaterial, placed.length);
    this.paper.name = 'DriftingPrints:paper';
    this.group.add(this.paper);
    pictures.forEach((photo, p) => {
      if (!counts[p]) return;
      // the picture is not lit: it shows the light it recorded (as on every print in the dream), what is left of it
      const material = new MeshBasicMaterial({ map: photo, color: new Color().setScalar(PAPER.picture), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      burnt(material);
      const shape = new PlaneGeometry(image.size, image.size).translate(0, IMAGE_CENTER_Y, print.thickness / 2 + IMAGE_LIFT);
      shape.setAttribute('aSeed', new InstancedBufferAttribute(new Float32Array(seeds.filter((_, i) => i % pictures.length === p)), 1));
      const mesh = new InstancedMesh(shape, material, counts[p]);
      mesh.name = `DriftingPrints:picture${p}`;
      this.images.push(mesh);
      this.group.add(mesh);
      this.drifters.forEach((d, i) => {
        if (i % pictures.length === p) d.image = mesh;
      });
    });
    for (const mesh of [this.paper, ...this.images]) mesh.instanceMatrix.setUsage(DynamicDrawUsage);

    this.update(0, true);
    // bounds for the whole drift: the farthest sway, and the print turned any way
    const reach = P.drift.amount * (1 + P.drift.second) + Math.hypot(print.width, print.height) * P.scale;
    for (const mesh of [this.paper, ...this.images]) {
      mesh.computeBoundingSphere();
      if (mesh.boundingSphere) mesh.boundingSphere.radius += reach;
    }
  }

  update(time: number, force = false): void {
    if (REDUCED_MOTION && !force) return;
    const P = seaConfig.prints;
    const D = P.drift;
    const rock = P.rock * DEG;
    for (let i = 0; i < this.drifters.length; i++) {
      const d = this.drifters[i];
      const w = d.rate * time;
      this.position
        .copy(d.base)
        .addScaledVector(d.a, D.amount * Math.sin(w + d.phase[0]))
        .addScaledVector(d.b, D.amount * D.second * Math.sin(w * D.secondRate + d.phase[1]));
      q1.setFromAxisAngle(d.axis, d.spin * time);
      q2.setFromAxisAngle(d.rockAxis, rock * Math.sin(w * D.rockRate + d.phase[2]));
      this.quaternion.copy(q1).multiply(q2).multiply(d.rest);
      m1.compose(this.position, this.quaternion, this.scale);
      this.paper.setMatrixAt(i, m1);
      d.image?.setMatrixAt(d.slot, m1);
    }
    this.paper.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.images.length; i++) this.images[i].instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ the crowd

/** Bodies of one pose: how many the mirror shows (0: none, far ones), whether their matrices changed this frame. */
interface CrowdGroup {
  crowd: Crowd;
  mirrored: number;
  dirty: boolean;
}

/** One of them. */
interface Body {
  group: CrowdGroup;
  slot: number;
  /** Its ring in the oil (bodies far out have none). */
  ring: number;
  /** Where it stands while its back is to you, and once it has turned. */
  x: number;
  z: number;
  turnedX: number;
  turnedZ: number;
  depth: number;
  scale: number;
  /** Which way it faces the sun (rad); how it stands off from upright (rad, forward and sideways), how far it leans to you once turned. */
  rest: number;
  tiltX: number;
  tiltZ: number;
  lean: number;
  /** Still under the oil until it has turned. */
  waits: boolean;
  /** When it wants to turn (walk). */
  turnAt: number;
  turned: boolean;
  heading: number;
}

/** A body's place in its crowd. */
interface Slot {
  group: CrowdGroup;
  slot: number;
}

/** Where the way runs at a walk-frame z (x of the path, straight between the keys). */
function wayAt(z: number): number {
  const keys = walkConfig.keys;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1].position;
    const b = keys[i].position;
    if (z <= a[2] && z >= b[2]) return lerp(a[0], b[0], (a[2] - z) / (a[2] - b[2]));
  }
  return keys[keys.length - 1].position[0];
}

/** The smallest turn between two headings (rad). */
function turnBetween(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/** Half of them, for the eye; the rest is simply not there (see `trimmed`), which spares the discard and the meat. */
const specOf = (pose: CrowdPose): FigureSpec => ({
  avatar: pose.avatar,
  clip: pose.clip,
  time: pose.time,
  face: 'blank',
  white: true,
  veil: pose.veil,
  tint: pose.tint,
  bleach: pose.bleach,
});

// ------------------------------------------------------------------ the sea

/**
 * Behind the giant print: a sea of black oil under a burning sky, the most beautiful thing in the piece
 * and the most hopeless. A half sun stands stopped in it; a colossal head sings with her lip on the
 * surface, another has sunk to the eyes; a ship lists, a rubber duck the size of a house turns to look,
 * doors stand without walls, a fire escape climbs into the sky, and the moon is a photograph of the
 * moment you left. And everywhere, up to the waist, with their backs to you, they stand and watch the
 * sun: all of them you, all of them white-haired. Whenever you do not see one it may turn. You blink.
 * At the end of the way the photographer stands on the oil, cut in half, aiming back at you.
 * The root sits at the sea's offset; everything in it is placed in walk-frame coordinates.
 */
export class DreamSea {
  readonly root = new Group();
  readonly figure: Object3D;
  readonly span = [-222, -420] as const;
  readonly inSea = true;
  readonly region = 'sea' as const;
  /** Over the sea only the sky lights anything (and, close by, the doors and lamps). */
  readonly spots = [null, null, null];

  private readonly water: MirrorWater;
  private readonly prints: DriftingPrints;
  private readonly sunUniform = { value: 0 };
  private readonly ashUniform = { value: 0 };
  private readonly lamps: { light: { intensity: number }; glass: MeshStandardMaterial; slot: number; seed: number }[] = [];
  private readonly lampHalos: InstancedMesh;
  private readonly duck = new Group();
  private readonly lid: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly rings: InstancedMesh;
  private readonly ash: InstancedMesh;

  private readonly bodies: Body[] = [];
  private readonly crowds: CrowdGroup[] = [];

  /** The piece's clock as the sea lives it: it stands still in a pause, and while you are not yet in it. */
  private clock = 0;
  /** Seconds since the lid began to fall; Infinity: it is up. */
  private blinkTime = Infinity;
  private lastWalk = 0;
  private lidWasVisible = false;

  constructor(kit: DreamKit, ctx: SeaContext) {
    this.root.name = 'Sea';
    const alley = kit.alley;

    this.water = new MirrorWater();
    this.root.add(this.water);
    this.buildSun(kit);

    const doorGlows: Glow[] = [];
    this.buildDoors(kit, doorGlows);
    const G = seaConfig.glow;
    this.root.add(glowMesh(doorGlows, glowMaterial(G.scatter, G.pull, true)));
    this.lampHalos = this.buildLamps(kit);
    this.root.add(this.lampHalos);
    this.root.add(instancedProps(alley, 'fire_escape', this.stairPlacements(), fireEscape.stairsNodes));

    this.buildMoon(kit, ctx.moonPhoto);
    this.buildPrintBack();
    this.buildHeads(kit);
    this.buildShip(kit);
    this.buildDuck(kit);
    this.figure = this.buildFigure(kit);

    this.buildCrowd(kit);
    this.rings = this.buildRings();
    this.prints = new DriftingPrints(ctx.moments);
    this.root.add(this.prints.group);
    this.ash = this.buildAsh();
    this.lid = this.buildLid();

    // far beyond the reach of the alley's only shadow-casting light
    this.root.traverse((o) => {
      if (!(o as Mesh).isMesh) return;
      o.castShadow = false;
      o.receiveShadow = false;
    });
    this.root.position.set(...seaConfig.offset);
    this.water.onMirror = this.mirroring;
    // as they are seen through the print, before you have come in
    this.floatDuck(0, walkConfig.printZ, 0, 0);
    this.rideFigure(0);
    this.updateLamps(0);
    this.reset();
  }

  /** Back to the instant before anyone turned. */
  reset(): void {
    this.blinkTime = Infinity;
    this.lastWalk = 0;
    this.lid.visible = false;
    for (const b of this.bodies) {
      b.turned = false;
      b.heading = b.rest;
      this.stand(b);
    }
    this.commitCrowds();
    this.rings.instanceMatrix.needsUpdate = true;
  }

  update(frame: DreamFrame): void {
    if (!frame.paused) this.clock += frame.dt;
    const time = this.clock;
    this.water.update(time);
    this.prints.update(time);
    const moving = REDUCED_MOTION ? 0 : time;
    this.sunUniform.value = moving;
    this.ashUniform.value = moving;
    this.floatDuck(frame.eye.x, frame.eye.z, frame.walk, moving);
    this.rideFigure(moving);
    this.updateLamps(moving);
    const closed = this.updateBlink(frame);
    if (!frame.paused) this.updateCrowd(frame, closed);
  }

  // ------------------------------------------------------------------ the blink

  /** The lid's fall and rise, once on going past its moment. True while the eye is wholly shut. */
  private updateBlink(frame: DreamFrame): boolean {
    const B = seaConfig.blink;
    if (!frame.paused) {
      this.blinkTime = this.lastWalk < B.at && frame.walk >= B.at ? 0 : this.blinkTime + frame.dt;
      this.lastWalk = frame.walk;
    }
    const t = this.blinkTime;
    const shut = smootherstep(range(0, B.close, t)) * (1 - smootherstep(range(B.close + B.hold, B.close + B.hold + B.open, t)));
    this.lid.visible = shut > 0;
    this.lid.material.uniforms.uClosed.value = shut;
    return shut >= 1;
  }

  private readonly bodyAt = new Vector3();

  /** Unseen, a body does what it wants: turn to you (or back, if you have gone back), stay facing you, come up, come closer. */
  private updateCrowd(frame: DreamFrame, closed: boolean): void {
    const C = seaConfig.crowd;
    const eye = frame.eye;
    const reaim = C.reaim * DEG;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      if (!closed && !frame.unseen(this.bodyAt.set(b.turnedX + SEA.x, SEEN_AT + SEA.y, b.turnedZ + SEA.z), C.margin)) continue;
      const wants = frame.walk >= b.turnAt;
      if (wants !== b.turned) {
        b.turned = wants;
        b.heading = wants ? Math.atan2(eye.x - b.turnedX, eye.z - b.turnedZ) : b.rest;
        this.stand(b);
      } else if (wants) {
        const aim = Math.atan2(eye.x - b.turnedX, eye.z - b.turnedZ);
        if (Math.abs(turnBetween(b.heading, aim)) < (closed ? 0.01 : reaim)) continue;
        b.heading = aim;
        this.stand(b);
      }
    }
    this.commitCrowds();
  }

  /** Write one body's place: rising, turned, leaning. */
  private stand(b: Body): void {
    const up = !b.waits || b.turned;
    const x = b.turned ? b.turnedX : b.x;
    const z = b.turned ? b.turnedZ : b.z;
    q1.setFromAxisAngle(UP, b.heading);
    q2.setFromEuler(e1.set(b.tiltX + (b.turned ? b.lean : 0), 0, b.tiltZ, 'YXZ'));
    m1.compose(v1.set(x, up ? -b.depth : WAITING, z), q1.multiply(q2), v2.setScalar(b.scale));
    b.group.crowd.setMatrix(b.slot, m1);
    b.group.dirty = true;
    if (b.ring < 0) return;
    this.rings.setMatrixAt(b.ring, m1.makeScale(up ? 1 : 0, 1, up ? 1 : 0).setPosition(x, 0, z));
    this.rings.instanceMatrix.needsUpdate = true;
  }

  private commitCrowds(): void {
    for (let i = 0; i < this.crowds.length; i++) {
      const c = this.crowds[i];
      if (!c.dirty) continue;
      c.crowd.commit();
      c.dirty = false;
    }
  }

  /** What the mirror need not show steps aside for it. */
  private readonly mirroring = (mirroring: boolean): void => {
    for (let i = 0; i < this.crowds.length; i++) {
      const c = this.crowds[i];
      if (c.mirrored > 0) c.crowd.drawn = mirroring ? c.mirrored : c.crowd.count;
      else c.crowd.root.visible = !mirroring;
    }
    this.rings.visible = !mirroring;
    this.ash.visible = !mirroring;
    if (mirroring) this.lidWasVisible = this.lid.visible;
    this.lid.visible = !mirroring && this.lidWasVisible;
  };

  // ------------------------------------------------------------------ what floats, what flickers

  /** It rides the swell, and its face comes around to wherever you are. */
  private floatDuck(eyeX: number, eyeZ: number, walk: number, time: number): void {
    const D = seaConfig.duck;
    const x = D.at[0];
    const z = D.at[2];
    const h = swellHeight(x, z, time);
    const rollSlope = (swellHeight(x + D.hull, z, time) - h) / D.hull;
    const pitchSlope = (swellHeight(x, z + D.hull, time) - h) / D.hull;
    const aim = Math.atan2(eyeX - x, eyeZ - z);
    this.duck.position.set(x, h - D.draught, z);
    this.duck.rotation.set(pitchSlope * D.tip, aim + D.away * (1 - smootherstep(range(D.turn[0], D.turn[1], walk))), -rollSlope * D.tip, 'YXZ');
  }

  /** The photographer stands on the oil, not in it: the swell lifts them and lets them down. */
  private rideFigure(time: number): void {
    this.figure.position.y = F.position[1] + swellHeight(F.position[0], F.position[2], time);
  }

  private updateLamps(time: number): void {
    const { intensity, dip, rate } = seaConfig.lamps.light;
    const H = seaConfig.lamps.halo;
    for (let i = 0; i < this.lamps.length; i++) {
      const lamp = this.lamps[i];
      // slow and irregular: it dips, it comes back; never faster than the eye can follow
      const down = smootherstep(range(LAMP_DIPS[0], LAMP_DIPS[1], wobble(time * rate, lamp.seed)));
      const level = 1 - dip * down;
      lamp.light.intensity = intensity * level;
      lamp.glass.emissiveIntensity = lightingConfig.lampGlow * level;
      this.lampHalos.setColorAt(lamp.slot, c1.setHex(LIGHT_COLORS.tungsten).multiplyScalar(H.strength * level));
    }
    if (this.lampHalos.instanceColor) this.lampHalos.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------------ building the sea

  /** The disc, a sheet behind it that carries its rim and its halo, and the long look that finds it. */
  private buildSun(kit: DreamKit): void {
    const sun = new Mesh(
      new RingGeometry(0, 1, 160, 10),
      new ShaderMaterial({ vertexShader: SUN_VERT, fragmentShader: SUN_FRAG, uniforms: { uBoil: this.sunUniform, ...warpUniforms } }),
    );
    sun.name = 'HalfSun';
    sun.scale.setScalar(SUN.radius);
    sun.position.set(...SUN.at);
    this.root.add(sun);

    const sheet = new Mesh(
      new PlaneGeometry(SUN.sheet * 2, SUN.sheet * 2, 24, 24),
      new ShaderMaterial({
        vertexShader: SHEET_VERT,
        fragmentShader: SHEET_FRAG,
        uniforms: { uBoil: this.sunUniform, ...warpUniforms },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    sheet.name = 'HalfSunHalo';
    sheet.scale.setScalar(SUN.radius);
    sheet.position.set(SUN.at[0], SUN.at[1], SUN.at[2] - SUN.behind);
    this.root.add(sheet);

    const P = SUN.poi;
    const [x, y, z] = inSea(SUN.at);
    kit.poi({ position: new Vector3(x, y + P.lift, z), radius: P.radius, zoom: P.zoom, reach: P.reach, memory: 'sun' });
  }

  /** Lamp posts standing in the oil, a little sunk and leaning, flickering; a halo around each lamp. Returns their halos. */
  private buildLamps(kit: DreamKit): InstancedMesh {
    const S = seaConfig.lamps;
    const glows: Glow[] = [];
    S.items.forEach((item, i) => {
      const lamp = kit.prop('street_lamp_post', item.at, { rotation: [item.lean[0], item.yaw, item.lean[1]] }, this.root);
      lamp.updateMatrixWorld(true);
      const panes = meshesOf(lamp).filter((m) => /glass/.test((m.material as Material).name));
      // its own glass, to flicker apart from every other lamp's
      const own = (panes[0].material as MeshStandardMaterial).clone();
      own.forceSinglePass = true;
      for (const pane of panes) pane.material = own;
      const at = box.setFromObject(panes[0]).getCenter(new Vector3());
      glows.push({ at, width: S.halo.size, height: S.halo.size, color: new Color(LIGHT_COLORS.tungsten).multiplyScalar(S.halo.strength) });
      const light = kit.lights.add(inSea([at.x, at.y, at.z]), LIGHT_COLORS.tungsten, S.light.intensity, S.light.distance);
      this.lamps.push({ light, glass: own, slot: i, seed: i * 3 + 2 });
    });
    const G = seaConfig.glow;
    return glowMesh(glows, glowMaterial(G.scatter, G.pull, true));
  }

  /** Doors without walls, each with light leaking under it, a painted back, and a little light on what stands near. */
  private buildDoors(kit: DreamKit, glows: Glow[]): void {
    const D = seaConfig.doors;
    const L = D.light;
    const strips: Matrix4[] = [];
    const backs: Matrix4[] = [];
    const size = new Vector3();
    const center = new Vector3();
    const spill = new Color(LIGHT_COLORS.window).multiplyScalar(L.spill.strength);
    for (const door of D.items) {
      // measured in the module's own frame, then stood up on its center
      const piece = kit.alley.modules([{ piece: door.piece, position: ORIGIN, rotationY: 0 }]);
      box.setFromObject(piece).getSize(size);
      box.getCenter(center);
      piece.position.set(-center.x, -box.min.y, -center.z);
      const pivot = new Group();
      pivot.name = door.piece;
      pivot.position.set(...door.at);
      pivot.rotation.y = door.yaw * DEG;
      pivot.add(piece);
      this.root.add(pivot);
      pivot.updateMatrixWorld(true);
      const front = size.z / 2 + SURFACE_GAP;
      // the strip goes down into the oil, so whatever the swell does the light still comes from under the door
      strips.push(within(pivot, 0, L.lip - L.height / 2, front, size.x * L.width, L.height, 1));
      backs.push(within(pivot, 0, size.y / 2, -size.z / 2 - D.backing.depth / 2, size.x, size.y, D.backing.depth));
      glows.push({ at: new Vector3(0, L.lip, front).applyMatrix4(pivot.matrixWorld), width: size.x * L.spill.width, height: L.spill.height, color: spill });
      const cast = new Vector3(0, L.cast.up, front + L.cast.ahead).applyMatrix4(pivot.matrixWorld);
      kit.lights.add(inSea([cast.x, cast.y, cast.z]), LIGHT_COLORS.window, L.cast.intensity, L.cast.distance);
    }
    const light = new MeshBasicMaterial({ color: new Color(LIGHT_COLORS.window).multiplyScalar(L.intensity) });
    const strip = instancedBoxes(new PlaneGeometry(1, 1), light, strips);
    strip.name = 'DoorLight';
    const backing = instancedBoxes(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: D.backing.color, roughness: D.backing.roughness, metalness: 0 }), backs);
    backing.name = 'DoorBacks';
    this.root.add(strip, backing);
  }

  /** Flights of a fire escape, each going on from the top of the last, out of the oil into the sky. */
  private stairPlacements(): { at: V3; rotation: V3 }[] {
    const S = seaConfig.stairs;
    const yaw = S.yaw * DEG;
    const run = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(S.step[0]);
    return Array.from({ length: S.flights }, (_, k) => ({
      at: [S.at[0] + run.x * k, S.at[1] + S.step[1] * k, S.at[2] + run.z * k] as V3,
      rotation: [0, S.yaw, 0] as V3,
    }));
  }

  /** The moon: a photograph of the moment you left, dim and reddish, turned toward the way, a soft halo behind it. */
  private buildMoon(kit: DreamKit, photo: Texture): void {
    const M = seaConfig.moon;
    const moon = new Photograph({ photo, grade: Grade.from(M.grade), glow: 1 });
    moon.name = 'Moon';
    moon.uniforms.uDevelop.value = 1;
    moon.scale.setScalar(M.scale);
    moon.position.set(...M.at);
    // still unparented: the walk frame is its world
    moon.lookAt(v1.set(...M.faces));
    // high above the haze: the sea's distance fog does not reach it
    for (const mesh of meshesOf(moon)) {
      for (const m of [mesh.material].flat()) {
        if ('fog' in m) (m as Material & { fog: boolean }).fog = false;
        const paper = m as MeshStandardMaterial;
        if (paper.emissiveMap) paper.emissive.setRGB(...M.glow);
      }
    }
    this.root.add(moon);

    const H = M.halo;
    const size = print.height * M.scale * H.size;
    const at = new Vector3(0, 0, -H.behind).applyQuaternion(moon.quaternion).add(moon.position);
    const halo = glowMesh([{ at, width: size, height: size, color: new Color(H.color).multiplyScalar(H.strength) }], glowMaterial(H.scatter, 0, false));
    halo.name = 'MoonHalo';
    this.root.add(halo);

    const P = M.poi;
    const [x, y, z] = inSea(M.at);
    kit.poi({ position: new Vector3(x, y + P.lift, z), radius: P.radius, zoom: P.zoom, reach: P.reach, memory: 'moon' });
  }

  /**
   * The back of the giant print, seen once you have passed through it: dark film and a handwritten line.
   * It faces the sea only; from the alley side the live window looks through this very plane.
   */
  private buildPrintBack(): void {
    const G = dreamConfig.giantPrint;
    const B = seaConfig.printBack;
    const geometry = new PlaneGeometry(print.width * G.scale, print.height * G.scale);
    geometry.rotateY(Math.PI);
    const canvas = document.createElement('canvas');
    const film = new CanvasTexture(canvas);
    film.colorSpace = SRGBColorSpace;
    film.anisotropy = 4;
    // the handwriting is in the visitor's language, and changes with it
    onLang(() => {
      drawFilmBack(canvas, say('printBack'));
      film.needsUpdate = true;
    });
    const material = new MeshStandardMaterial({
      map: film,
      roughness: B.roughness,
      metalness: 0,
      // the ink catches a little more light than there is
      emissive: 0xffffff,
      emissiveMap: film,
      emissiveIntensity: B.glow,
    });
    const back = new Mesh(geometry, sunlitCopy(material, 'film'));
    back.name = 'GiantPrintBack';
    back.position.set(G.center[0], G.center[1], G.z - (print.thickness * G.scale) / 2);
    this.root.add(back);
  }

  /** The two heads: she sings at the surface, he has sunk to the eyes. */
  private buildHeads(kit: DreamKit): void {
    const S = seaConfig.singer;
    const singer = kit.prop('singing_bust', S.at, { scale: S.scale, rotation: [0, S.heading, 0] }, this.root);
    meshesOf(singer).forEach(jawDropped);
    kit.paint(singer, stainedStone(S.color, true));
    const D = seaConfig.drowned;
    kit.paint(kit.prop('hercules_head', D.at, { scale: D.scale, rotation: [0, D.heading, 0] }, this.root), stainedStone(D.color, false));
  }

  /** The ship: black, with what is left of its sails a little paler against the burning sky. */
  private buildShip(kit: DreamKit): void {
    const S = seaConfig.ship;
    const ship = kit.prop('ghost_ship', S.at, { scale: S.scale, rotation: [S.list, S.heading, S.trim] }, this.root);
    for (const mesh of meshesOf(ship)) {
      const source = mesh.material as MeshStandardMaterial;
      const dark = sunlitCopy(source, 'ship');
      dark.color.setScalar(/sails/.test(source.name) ? S.sails : S.black);
      dark.metalness = 0;
      mesh.material = dark;
    }
  }

  /** The duck: its own yellow never quite goes out. */
  private buildDuck(kit: DreamKit): void {
    const D = seaConfig.duck;
    const toy = kit.prop('rubber_duck', [0, 0, 0], { scale: D.scale }, this.duck);
    for (const mesh of meshesOf(toy)) {
      const yellow = sunlitCopy(mesh.material as MeshStandardMaterial, 'duck');
      yellow.emissive.set(0xffffff);
      yellow.emissiveMap = yellow.map;
      yellow.emissiveIntensity = D.glow;
      mesh.material = yellow;
    }
    this.duck.name = 'Duck';
    this.root.add(this.duck);
  }

  /** The photographer on the oil: white-haired, a little too large, half of them; the camera whole. */
  private buildFigure(kit: DreamKit): Object3D {
    const figure = kit.photographer.makeDouble(F.clipTime);
    figure.name = 'SeaFigure';
    figure.position.set(...F.position);
    figure.rotation.y = F.heading * DEG;
    figure.scale.setScalar(F.scale);

    const opening = F.opening * DEG;
    const normal = new Vector3(Math.cos(opening), 0, Math.sin(opening)).applyAxisAngle(UP, F.heading * DEG);
    const anchor = inSea(F.position);
    const cut = new Vector4(normal.x, normal.y, normal.z, normal.dot(v1.set(...anchor)) + F.offset * F.scale);
    const tangent = new Vector3().crossVectors(UP, normal).normalize();
    const copies = new Map<Material, MeshStandardMaterial>();
    figure.traverse((o) => {
      const mesh = o as SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const source = mesh.material as MeshStandardMaterial;
      let half = copies.get(source);
      if (!half) {
        const hair = /opacity/.test(source.name);
        half = sunlitCopy(source, `half-${source.name}`, sliced(cut, tangent, anchor, !hair));
        half.side = DoubleSide;
        if (source.map) {
          if (hair) half.map = hairMap(source.map);
          else if (/head/.test(source.name)) half.map = headMap(source.map, 'keep', true, F.clipTime);
        }
        copies.set(source, half);
      }
      mesh.material = half;
    });
    this.root.add(figure);
    const P = F.poi;
    const [x, y, z] = inSea(walkConfig.ending.lens.position);
    kit.poi({ position: new Vector3(x, y, z), radius: P.radius, zoom: P.zoom, reach: P.reach, active: () => figure.visible, memory: 'photographer' });
    return figure;
  }

  /** Everyone, in loose rows on both sides of the way, nearest first. */
  private buildCrowd(kit: DreamKit): void {
    const C = seaConfig.crowd;
    const rnd = randomFrom(C.seed);
    const taken: { x: number; z: number }[] = [];
    const circles = [
      ...seaConfig.doors.items.map((d) => [d.at[0], d.at[2], KEEP_OUT.door] as const),
      ...seaConfig.lamps.items.map((l) => [l.at[0], l.at[2], KEEP_OUT.lamp] as const),
      [seaConfig.duck.at[0], seaConfig.duck.at[2], KEEP_OUT.duck] as const,
      [seaConfig.stairs.at[0], seaConfig.stairs.at[2], KEEP_OUT.stairs] as const,
      [F.position[0], F.position[2], KEEP_OUT.figure] as const,
    ];
    const clearOfThings = (x: number, z: number) => !circles.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r);
    const free = (x: number, z: number, spacing: number) =>
      clearOfThings(x, z) &&
      !taken.some((t) => Math.hypot(x - t.x, z - t.z) < spacing) &&
      !(Math.abs(x - wayAt(z)) < C.corridor.halfWidth && z < C.corridor.z[0] && z > C.corridor.z[1]);
    const row = (z: number) => Math.round(z / C.rowStep) * C.rowStep + (rnd() - 0.5) * C.rowStep * 0.35;

    /** A free place in a stretch and a reach from the way (the last try stands wherever it falls). */
    const somewhere = (zs: readonly [number, number], reach: readonly [number, number], spacing: number) => {
      let x = 0;
      let z = 0;
      for (let t = 0; t < PLACE_TRIES; t++) {
        z = row(lerp(zs[0], zs[1], rnd()));
        x = wayAt(z) + (rnd() < 0.5 ? -1 : 1) * lerp(reach[0], reach[1], rnd() ** 1.25);
        if (free(x, z, spacing)) break;
      }
      taken.push({ x, z });
      return { x, z };
    };

    /** All the places of one crowd: its lowest slots are what the mirror shows. */
    const slotsOf = (pose: CrowdPose, count: number, thin: number, mirrored: number): Slot[] => {
      if (count <= 0) return [];
      const crowd = kit.figures.crowd(specOf(pose), count);
      slimmed(crowd, C.cutAt, thin);
      this.root.add(crowd.root);
      const group: CrowdGroup = { crowd, mirrored, dirty: true };
      this.crowds.push(group);
      return Array.from({ length: count }, (_, slot) => ({ group, slot }));
    };
    const nearSlots = C.poses.flatMap((pose) => slotsOf(pose, pose.near, 0, Math.ceil(pose.near * C.mirrored)));
    const farSlots = C.poses.flatMap((pose) => slotsOf(pose, pose.far, C.thin, 0));
    // the poses mix, but every crowd's lowest slots come first: those go nearest the way
    const shuffled = (slots: readonly Slot[]) =>
      slots
        .map((s) => ({ s, key: s.slot + rnd() * 3 }))
        .sort((a, b) => a.key - b.key)
        .map((e) => e.s);

    const place = (slot: Slot, x: number, z: number, turnedX: number, turnedZ: number, lean: number, waits: boolean, ring: number) => {
      const rest = Math.atan2(SUN.at[0] - x, SUN.at[2] - z) + (rnd() - 0.5) * 0.14;
      const tilt = () => (rnd() * 2 - 1) * C.tilt * DEG;
      this.bodies.push({
        group: slot.group,
        slot: slot.slot,
        ring,
        x,
        z,
        turnedX,
        turnedZ,
        depth: lerp(C.depth[0], C.depth[1], rnd()),
        scale: lerp(C.scale[0], C.scale[1], rnd()),
        rest,
        tiltX: tilt(),
        tiltZ: tilt(),
        lean,
        waits,
        turnAt: lerp(C.turn[0], C.turn[1], rnd()),
        turned: false,
        heading: rest,
      });
    };

    const near = shuffled(nearSlots);
    let ring = 0;
    near.forEach((slot, i) => {
      if (i < C.beside.count) {
        const B = C.beside;
        const side = i % 2 === 0 ? 1 : -1;
        let x = 0;
        let z = 0;
        let turnedX = 0;
        for (let t = 0; t < PLACE_TRIES; t++) {
          z = row(lerp(B.z[0], B.z[1], (i + rnd()) / B.count));
          const way = wayAt(z);
          const reach = lerp(B.reach[0], B.reach[1], rnd() ** 1.4);
          x = way + side * reach;
          turnedX = way + side * Math.max(B.closest, reach * B.closer);
          if (clearOfThings(x, z) && clearOfThings(turnedX, z)) break;
        }
        taken.push({ x, z });
        place(slot, x, z, turnedX, z - (rnd() - 0.5) * 0.8, rnd() * C.lean * DEG, rnd() < C.risen, ring++);
      } else {
        const { x, z } = somewhere(C.around.z, C.around.reach, C.spacing);
        place(slot, x, z, x, z, 0, rnd() < C.risen * 0.5, ring++);
      }
    });
    for (const slot of shuffled(farSlots)) {
      const { x, z } = somewhere(C.afar.z, C.afar.reach, C.spacing * 2);
      place(slot, x, z, x, z, 0, false, -1);
    }
  }

  /** A ring of creeping oil where each body near the way stands. */
  private buildRings(): InstancedMesh {
    const near = this.bodies.filter((b) => b.ring >= 0).length;
    const mesh = new InstancedMesh(
      new PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      new ShaderMaterial({
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        uniforms: { uTime: this.water.timeUniform, ...warpUniforms },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
      near,
    );
    mesh.name = 'OilRings';
    mesh.position.y = seaConfig.water.level;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.root.add(mesh);
    return mesh;
  }

  /** Ash falling all around the eye, and a few sparks among it. */
  private buildAsh(): InstancedMesh {
    const rnd = randomFrom(seaConfig.prints.seed + 1);
    const shape = new PlaneGeometry(1, 1);
    const sparks = new Float32Array(A.count);
    for (let i = 0; i < A.count; i++) sparks[i] = rnd() < A.sparks ? 1 : 0;
    shape.setAttribute('aSpark', new InstancedBufferAttribute(sparks, 1));
    const mesh = new InstancedMesh(
      shape,
      new ShaderMaterial({
        vertexShader: ASH_VERT,
        fragmentShader: ASH_FRAG,
        uniforms: { uFall: this.ashUniform, ...warpUniforms },
        transparent: true,
        depthWrite: false,
      }),
      A.count,
    );
    // the instance's translation is only its seed: its place is worked out around whichever eye is looking
    for (let i = 0; i < A.count; i++) mesh.setMatrixAt(i, m1.makeTranslation(rnd(), rnd(), rnd()));
    mesh.name = 'Ash';
    this.root.add(mesh);
    return mesh;
  }

  /** The eye's own lid: it covers the frame of whichever render it is visible in. */
  private buildLid(): Mesh<PlaneGeometry, ShaderMaterial> {
    const lid = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        vertexShader: LID_VERT,
        fragmentShader: LID_FRAG,
        uniforms: { uClosed: { value: 0 } },
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    lid.name = 'Eyelid';
    lid.renderOrder = LID_ORDER;
    lid.visible = false;
    this.root.add(lid);
    return lid;
  }
}
