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
