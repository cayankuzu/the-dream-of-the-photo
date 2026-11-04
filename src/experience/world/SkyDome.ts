import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, type Texture } from 'three';
import { seaConfig } from '../../config/sea.config';
import { warpUniforms } from '../render/Warp';

/**
 * The dream's sky is a soft pink evening, photographed: this is how it is burnt. Its brightness is taken
 * to a power around a pivot, then read through a ramp of rust and blood; warm clouds keep more of their
 * light than the cold ground of the sky. Colors are light (linear).
 */
const BURN = {
  pivot: 0.95,
  contrast: 1.6,
  /** Ramp by that brightness (each stop's start and end are in `stops`). */
  low: [0.012, 0.0035, 0.0028],
  mid: [0.2, 0.022, 0.009],
  high: [0.95, 0.15, 0.022],
  hot: [3.2, 1.0, 0.16],
  stops: [
    [0.15, 0.85],
    [0.8, 2.4],
    [2.4, 9],
  ],
  /** How much light the coldest and the warmest clouds keep, by their red over their blue. */
  cold: [0.62, 0.5, 0.5],
  warm: [1.25, 1.2, 1],
  warmth: [0.75, 1.5],
} as const;
/** Over the head it all goes to brown-black: the share of light left at the top, from and to which height (sine of the angle). */
const ZENITH = { left: 0.08, from: 0.34, to: 0.86 };
/**
 * Toward the horizon the sky goes into the haze of its space (the fog's color, so far ground melts into it). Where it has
 * gone by (sine of the angle over the curled-up ground's rim), and the same over the photograph's own horizon, which
 * has a town on it.
 */
const HAZE = { rim: [0.015, 0.22], photo: [0.05, 0.24], gain: 4 };

const glslVec3 = (c: readonly number[]) => `vec3(${c.map((v) => v.toFixed(5)).join(', ')})`;

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always on the far plane
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tReal;
uniform sampler2D tDream;
uniform float uDream;
uniform float uIntensity;
uniform float uRotation;
uniform float uDreamRotation;
uniform float uDreamTilt;
uniform float uDreamHorizon;
uniform vec4 uWarp;
uniform vec3 fogColor;
varying vec3 vDir;

vec2 equirect(vec3 d, float rot) {
  float phi = atan(d.z, d.x) + rot;
  // around and around: the maps do not repeat by themselves
  return vec2(fract(phi / 6.2831853 + 0.5), asin(clamp(d.y, -1.0, 1.0)) / 3.1415927 + 0.5);
}

vec3 burnt(vec3 sky) {
  float t = pow(max(dot(sky, vec3(0.2126, 0.7152, 0.0722)), 0.0) / ${BURN.pivot.toFixed(3)}, ${BURN.contrast.toFixed(3)});
  vec3 c = mix(${glslVec3(BURN.low)}, ${glslVec3(BURN.mid)}, smoothstep(${BURN.stops[0][0].toFixed(3)}, ${BURN.stops[0][1].toFixed(3)}, t));
  c = mix(c, ${glslVec3(BURN.high)}, smoothstep(${BURN.stops[1][0].toFixed(3)}, ${BURN.stops[1][1].toFixed(3)}, t));
  c = mix(c, ${glslVec3(BURN.hot)}, smoothstep(${BURN.stops[2][0].toFixed(3)}, ${BURN.stops[2][1].toFixed(3)}, t));
  float warm = smoothstep(${BURN.warmth[0].toFixed(3)}, ${BURN.warmth[1].toFixed(3)}, sky.r / max(sky.b, 0.001));
  return c * mix(${glslVec3(BURN.cold)}, ${glslVec3(BURN.warm)}, warm);
}

void main() {
  vec3 d = normalize(vDir);
  vec3 c = texture2D(tReal, equirect(d, uRotation)).rgb * uIntensity;
  if (uDream > 0.0) {
    // curved space curls the ground up toward the sky, less the farther to the side of the view: the sky's
    // horizon stays on the rim of the ground, wherever the eye looks
    vec3 seen = mat3(viewMatrix) * d;
    float ahead = max(-seen.z, 0.05);
    float curl = uWarp.x * ${seaConfig.water.grid.radius.toFixed(1)} * ahead / max(length(seen.xz), 0.05);
    vec3 lifted = normalize(vec3(seen.x / ahead, seen.y / ahead - curl, -1.0) * mat3(viewMatrix));
    // the dream sky is a real sky seen from an impossible angle: its horizon leans and slowly turns
    float s = sin(uDreamTilt), k = cos(uDreamTilt);
    vec3 dd = vec3(lifted.x, lifted.y * k - lifted.z * s, lifted.y * s + lifted.z * k);
    vec3 dream = burnt(texture2D(tDream, equirect(dd, uDreamRotation)).rgb) * uIntensity;
    dream *= mix(1.0, ${ZENITH.left.toFixed(3)}, smoothstep(${ZENITH.from.toFixed(3)}, ${ZENITH.to.toFixed(3)}, lifted.y));
    float clear = smoothstep(${HAZE.rim[0].toFixed(3)}, ${HAZE.rim[1].toFixed(3)}, lifted.y) * smoothstep(${HAZE.photo[0].toFixed(3)}, ${HAZE.photo[1].toFixed(3)}, dd.y);
    vec3 haze = fogColor * min(uIntensity * ${HAZE.gain.toFixed(1)}, 1.0);
    dream = mix(dream, mix(haze, dream, clear), uDreamHorizon);
    c = mix(c, dream, uDream);
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

/** Sky sphere that can drift from the real dusk to the dream's sky without changing the scene. */
export class SkyDome extends Mesh<SphereGeometry, ShaderMaterial> {
  constructor(real: Texture, dream: Texture, intensity: number) {
    super(
      new SphereGeometry(180, 48, 24),
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: BackSide,
        depthWrite: false,
        // not fogged: only told the fog's color, for what lies along its horizon
        fog: true,
        uniforms: {
          tReal: { value: real },
          tDream: { value: dream },
          uDream: { value: 0 },
          uIntensity: { value: intensity },
          uRotation: { value: 0 },
          uDreamRotation: { value: 0 },
          uDreamTilt: { value: 0 },
          uDreamHorizon: { value: 0 },
          fogColor: { value: new Color() },
          fogDensity: { value: 0 },
          ...warpUniforms,
        },
      }),
    );
    this.name = 'Sky';
    // drawn last among opaques (on the far plane, depth-tested): it only fills what nothing else covered
    this.renderOrder = 2;
    this.frustumCulled = false;
  }

  get uniforms() {
    return this.material.uniforms;
  }
}
