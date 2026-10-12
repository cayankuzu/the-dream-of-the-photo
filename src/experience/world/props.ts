import {
  AdditiveBlending,
  Box3,
  Euler,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
  type MeshPhysicalMaterial,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DEG } from '../math';

const box = new Box3();
const center = new Vector3();

export interface PlaceOptions {
  /** Target point for the anchor of the object's bounds. */
  at: readonly [number, number, number];
  /** Euler degrees (YXZ). */
  rotation?: readonly [number, number, number];
  scale?: number;
  /** Which point of the bounds lands on `at`: bottom-center (default), center or top-center. */
  anchor?: 'bottom' | 'center' | 'top';
  /** Casts shadows (default). Small parts flat against a wall gain nothing from it. */
  castShadow?: boolean;
}

/**
 * Clone a model (or some of its top-level nodes) and place it by its real bounds, so pivots
 * baked differently in every source file never matter. Every mesh receives shadows.
 */
export function instance(gltf: GLTF, opts: PlaceOptions, nodes?: readonly string[]): Object3D {
  const src = gltf.scene;
  const holder = new Object3D();
  const parts = nodes ? src.children.filter((c) => nodes.includes(c.name)) : [src];
  if (nodes && !parts.length) throw new Error(`nodes not found: ${nodes.join(',')}`);
  for (const p of parts) holder.add(p.clone());
  const pivot = new Object3D();
  pivot.add(holder);
  const [rx, ry, rz] = opts.rotation ?? [0, 0, 0];
  holder.rotation.copy(new Euler(rx * DEG, ry * DEG, rz * DEG, 'YXZ'));
  holder.scale.setScalar(opts.scale ?? 1);
  pivot.updateMatrixWorld(true);
  box.setFromObject(holder);
  box.getCenter(center);
  const anchorY = { bottom: box.min.y, center: center.y, top: box.max.y }[opts.anchor ?? 'bottom'];
  holder.position.set(-center.x, -anchorY, -center.z);
  pivot.position.set(...opts.at);
  pivot.traverse((o) => {
    if ((o as Mesh).isMesh) {
      o.castShadow = opts.castShadow ?? true;
      o.receiveShadow = true;
    }
  });
  return pivot;
}

/**
 * Fog for an additive layer: mixing toward the fog color would add that color on top of what is
 * already fogged behind it, so the layer instead fades out by the same fog factor.
 */
const FOG_FADE = /* glsl */ `
#ifdef USE_FOG
	vec3 unfogged = gl_FragColor.rgb;
#endif
#include <fog_fragment>
#ifdef USE_FOG
	gl_FragColor.rgb = unfogged * ( 1.0 - fogFactor );
#endif`;

/**
 * Replace transmissive glass in a model (in place, so every later clone shares it) with a reflection
 * laid over what is behind it. One visible transmissive object makes three.js re-render every opaque
 * object into a transmission target, for every render of the frame; thin clear glass (a clock face,
 * a bulb) is mostly its reflection anyway.
 */
export function reflectionOnlyGlass(root: Object3D): void {
  const swapped = new Map<MeshPhysicalMaterial, MeshStandardMaterial>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const src = mesh.material as MeshPhysicalMaterial;
    if (!src.isMeshPhysicalMaterial || src.transmission <= 0) return;
    let glass = swapped.get(src);
    if (!glass) {
      glass = new MeshStandardMaterial({
        name: `${src.name}_reflection`,
        color: 0x000000,
        metalness: 0,
        roughness: src.roughness,
        roughnessMap: src.roughnessMap,
        envMapIntensity: src.envMapIntensity,
        side: src.side,
        // additive light does not depend on draw order: both faces in one draw
        forceSinglePass: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      glass.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', FOG_FADE);
      };
      swapped.set(src, glass);
    }
    mesh.material = glass;
  });
}
