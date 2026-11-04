/** Shared GLSL snippets. Kept in one place so the photograph and the screen grade stay identical. */

/** Affine color grade in linear light: c' = A * c + b. */
export const GRADE_GLSL = /* glsl */ `
vec3 applyGrade(vec3 c, mat3 A, vec3 b) {
  return max(A * c + b, vec3(0.0));
}
`;

/** Glossy paper reflection band, in screen space so it survives the hand-off from print to screen. */
export const SHEEN_GLSL = /* glsl */ `
float paperSheen(vec2 suv, float aspect, float offset) {
  vec2 p = vec2((suv.x - 0.5) * aspect, suv.y - 0.5);
  float d = dot(p, normalize(vec2(0.82, 0.57))) - offset;
  float band = exp(-d * d * 55.0) * 0.8 + exp(-d * d * 9.0) * 0.2;
  return band;
}
/** The sheen as light, added before any grade (identically by the print and by the screen). */
vec3 paperSheenLight(vec2 suv, float aspect, float offset, float strength) {
  return vec3(1.0, 0.97, 0.92) * strength * paperSheen(suv, aspect, offset);
}
`;

/** Rec. 709 luminance. */
export const LUMA_GLSL = /* glsl */ `
float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}
`;

export const HASH_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

/** AgX tone mapping (Troy Sobotka's AgX, polynomial fit by B. Wrensch), linear Rec.709 in/out. */
export const AGX_GLSL = /* glsl */ `
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agxToneMap(vec3 c) {
  const mat3 inset = mat3(
    0.842479062253094, 0.0423282422610123, 0.0423756549057051,
    0.0784335999999992, 0.878468636469772, 0.0784336,
    0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 outset = mat3(
    1.19687900512017, -0.0528968517574562, -0.0529716355144438,
    -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
    -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  const float minEv = -12.47393;
  const float maxEv = 4.026069;
  c = inset * max(c, vec3(1e-10));
  c = clamp(log2(c), minEv, maxEv);
  c = (c - minEv) / (maxEv - minEv);
  c = agxContrast(c);
  // gentle "punch" look: a touch of contrast and saturation, filmic rather than flat
  float l = luma(c);
  c = l + (c - l) * 1.12;
  c = outset * c;
  return pow(max(c, vec3(0.0)), vec3(2.2));
}
vec3 linearToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`;

/** How many scratches the film can carry at once (see Pipeline). */
export const FILM_SCRATCHES = 7;

/**
 * What happens to the film itself, in display light (needs HASH_GLSL and LUMA_GLSL): scratches down its
 * length, dust and lint that change with every frame, a hair caught in the gate, and the burn when it jams.
 * The shapes are drawn once into tDamage (dust in green, hairs in blue); where they fall is written per frame.
 */
export const FILM_GLSL = /* glsl */ `
uniform sampler2D tDamage;
// x, half width (shares of the frame's width), strength (negative: dark), shape
uniform vec4 uScratch[${FILM_SCRATCHES}];
// shift x, y; the share of the dust's cells that land this frame; this frame's seed
uniform vec4 uDust;
// root x, y (shares of the frame); phase of its shiver; strength
uniform vec4 uHair;
// direction into the frame x, y; side of its cell (screen heights)
uniform vec3 uHairPose;
uniform vec2 uHairCell;
uniform float uBurn;
// where it starts x, y (shares of the frame); 1 / distance to the farthest corner
uniform vec3 uBurnFrom;
uniform float uFilmTime;

float filmNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

vec3 filmDamage(vec3 c, vec2 uv, float aspect) {
  float white = 0.0;
  float dark = 0.0;
  for (int i = 0; i < ${FILM_SCRATCHES}; i++) {
    vec4 s = uScratch[i];
    if (s.z == 0.0) continue;
    // never quite straight
    float d = abs(uv.x - s.x - 0.0016 * sin(uv.y * 4.0 + s.w)) / s.y;
    if (d >= 1.0) continue;
    // it catches and lets go along its length, differently on every frame
    float a = abs(s.z) * (1.0 - d * d) * smoothstep(0.2, 0.62, filmNoise(vec2(uv.y * 23.0 + s.w, uDust.w * 61.0 + s.w)));
    if (s.z > 0.0) white = max(white, a);
    else dark = max(dark, a);
  }
  // dust and lint: most of it prints white, as dirt on a negative does
  vec2 q = uv * vec2(aspect, 1.0) + uDust.xy;
  float mark = textureLod(tDamage, q, 0.0).g;
  if (mark > 0.02) {
    float h = hash12(floor(q * 5.0) + uDust.w * 97.0);
    if (h < uDust.z) {
      if (fract(h * 41.0) < 0.8) white = max(white, mark * 0.85);
      else dark = max(dark, mark * 0.9);
    }
  }
  c = mix(c, vec3(0.93, 0.91, 0.84), white);
  c *= 1.0 - dark;
  if (uHair.w > 0.0) {
    vec2 from = (uv - uHair.xy) * vec2(aspect, 1.0);
    vec2 p = vec2(from.x * uHairPose.y - from.y * uHairPose.x, dot(from, uHairPose.xy)) / uHairPose.z;
    // its root is held by the gate; the free end shivers
    p.x += 0.5 + 0.018 * p.y * p.y * sin(p.y * 6.0 + uHair.z);
    if (p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0) {
      // white on what is dark, black on what is bright: it is seen either way
      vec3 hair = mix(vec3(0.9, 0.88, 0.82), vec3(0.02), smoothstep(0.35, 0.6, luma(c)));
      c = mix(c, hair, textureLod(tDamage, (p + uHairCell) * 0.5, 0.0).b * uHair.w);
    }
  }
  return c;
}

/** The film stops in the gate and the lamp eats through it: brown, then orange, then the bare white of the lamp. */
vec3 filmBurn(vec3 c, vec2 uv, float aspect) {
  vec2 q = uv * vec2(aspect, 1.0);
  float reach = length((uv - uBurnFrom.xy) * vec2(aspect, 1.0)) * uBurnFrom.z;
  float t = uFilmTime;
  float n = filmNoise(q * 3.1 + vec2(t * 0.13, -t * 0.21)) * 0.55 + filmNoise(q * 7.7 + vec2(-t * 0.31, t * 0.17)) * 0.3 + filmNoise(q * 19.0 + t * 0.5) * 0.15;
  // how far the fire has come past this point (it starts as a point: its unevenness grows with it)
  float f = uBurn * 1.5 - reach - (n - 0.5) * 0.62 * min(uBurn * 5.0, 1.0);
  if (f < -0.09) return c;
  c *= mix(vec3(1.0), vec3(0.42, 0.2, 0.08), smoothstep(-0.09, -0.01, f));
  vec3 fire = mix(vec3(0.95, 0.3, 0.03), vec3(1.0, 0.72, 0.22), smoothstep(0.015, 0.07, f));
  fire = mix(fire, vec3(1.0, 0.98, 0.9), smoothstep(0.07, 0.2, f));
  return mix(c, fire, smoothstep(-0.012, 0.012, f));
}
`;
