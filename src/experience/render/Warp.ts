import { ShaderChunk, ShaderLib } from 'three';

/**
 * Curved space: the dream's main device. Everything is drawn displaced by how far it lies in front of
 * the eye, so the way ahead curls up, drifts, screws around the line of sight, breathes. Only the
 * vertex's place on screen moves: its depth, its light, its fog and its shadows stay in straight space,
 * so nothing can tear, and nothing behind the eye moves at all. Long flat surfaces need vertices along
 * their length to bend (see DreamKit.wall).
 *
 * Plain objects, not Vector4: three clones vector uniforms into every program, but shares plain
 * objects (and reads their x, y, z, w all the same), so one write here reaches every material.
 */
export const warp = {
  /** bendUp (1/m), bendAside (1/m), twist (rad/m), wave (m). */
  amount: { x: 0, y: 0, z: 0, w: 0 },
  /** wave frequency (rad/m), wave phase (rad). */
  wave: { x: 0, y: 0 },
};

/** For a ShaderMaterial: spread into its uniforms, and put WARP_GLSL in its vertex shader. */
export const warpUniforms = {
  uWarp: { value: warp.amount },
  uWarpWave: { value: warp.wave },
};

/** `dreamWarp(viewPosition)`: where a view-space point is drawn. */
export const WARP_GLSL = /* glsl */ `
uniform vec4 uWarp;
uniform vec2 uWarpWave;
vec4 dreamWarp(vec4 p) {
  float d = max(0.0, -p.z);
  float a = uWarp.z * d;
  float s = sin(a), c = cos(a);
  p.xy = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  float near = min(d * 0.125, 1.0);
  p.y += uWarp.x * d * d + uWarp.w * near * sin(d * uWarpWave.x + uWarpWave.y);
  p.x += uWarp.y * d * d + uWarp.w * near * cos(d * uWarpWave.x * 0.73 + uWarpWave.y * 1.3);
  return p;
}
`;

// every built-in material draws through it; shadow maps stay straight
const STRAIGHT = 'project_vertex_straight';
const chunks = ShaderChunk as unknown as Record<string, string>;
const PROJECT = 'gl_Position = projectionMatrix * mvPosition;';
if (!chunks[STRAIGHT]) {
  chunks[STRAIGHT] = ShaderChunk.project_vertex;
  ShaderChunk.project_vertex = ShaderChunk.project_vertex.replace(PROJECT, 'gl_Position = projectionMatrix * dreamWarp(mvPosition);');
  // declared in a chunk every built-in vertex shader includes before main
  ShaderChunk.logdepthbuf_pars_vertex = `${WARP_GLSL}\n${ShaderChunk.logdepthbuf_pars_vertex}`;
  for (const shader of [ShaderLib.depth, ShaderLib.distance]) {
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <${STRAIGHT}>`);
  }
  for (const shader of Object.values(ShaderLib) as { uniforms: Record<string, unknown> }[]) {
    Object.assign(shader.uniforms, warpUniforms);
  }
}
