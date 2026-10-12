import { BackSide, Mesh, ShaderMaterial, SphereGeometry, type Texture } from 'three';

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
varying vec3 vDir;

vec2 equirect(vec3 d, float rot) {
  float phi = atan(d.z, d.x) + rot;
  return vec2(phi / 6.2831853 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.1415927 + 0.5);
}

void main() {
  vec3 d = normalize(vDir);
  vec3 real = texture2D(tReal, equirect(d, uRotation)).rgb;
  vec3 c = real;
  if (uDream > 0.0) {
    // the dream sky is a real sky seen from an impossible angle: its horizon leans and slowly turns
    float s = sin(uDreamTilt), k = cos(uDreamTilt);
    vec3 dd = vec3(d.x, d.y * k - d.z * s, d.y * s + d.z * k);
    c = mix(real, texture2D(tDream, equirect(dd, uDreamRotation)).rgb, uDream);
  }
  gl_FragColor = vec4(c * uIntensity, 1.0);
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
        fog: false,
        uniforms: {
          tReal: { value: real },
          tDream: { value: dream },
          uDream: { value: 0 },
          uIntensity: { value: intensity },
          uRotation: { value: 0 },
          uDreamRotation: { value: 0 },
          uDreamTilt: { value: 0 },
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
